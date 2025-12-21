export interface Env {
  ROOM: DurableObjectNamespace;
}

/* ================================
   MAIN WORKER ENTRY
================================ */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const roomCode = url.searchParams.get("room");

    if (!roomCode) {
      return new Response("Missing room", { status: 400 });
    }

    const id = env.ROOM.idFromName(roomCode);
    const room = env.ROOM.get(id);
    return room.fetch(req);
  }
};

/* ================================
   TYPES
================================ */

type Player = {
  id: string;
  name: string;
  seat: number;
};

/* ================================
   DURABLE OBJECT: ROOM
================================ */

export class Room {
  state: DurableObjectState;

  sockets: Map<string, WebSocket> = new Map();
  players: Player[] = [];
  hostId: string | null = null;

  // Entire game state lives here
  gameState: any = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /* ================================
     FETCH → WEBSOCKET
  ================================ */

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.handleSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  /* ================================
     SOCKET HANDLING
  ================================ */

  handleSocket(ws: WebSocket) {
    ws.accept();
    let clientId: string | null = null;

    ws.addEventListener("message", (evt) => {
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      /* ---------- JOIN ---------- */
      if (msg.type === "join") {
        clientId = msg.id;

        if (!this.players.find(p => p.id === clientId)) {
          const seat = this.players.length;
          this.players.push({
            id: clientId,
            name: msg.name || `Player ${seat + 1}`,
            seat
          });

          if (seat === 0) {
            this.hostId = clientId;
          }
        }

        this.sockets.set(clientId, ws);

        this.broadcastPlayers();
        this.sendState(ws);
        return;
      }

      if (!clientId) return;

      /* ---------- ACTION ---------- */
      if (msg.type === "action") {
        this.handleAction(clientId, msg.action);
        return;
      }

      /* ---------- PING ---------- */
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.addEventListener("close", () => {
      if (!clientId) return;

      this.sockets.delete(clientId);
      this.players = this.players.filter(p => p.id !== clientId);

      this.broadcastPlayers();
    });
  }

  /* ================================
     GAME AUTHORITY LOGIC
  ================================ */

  handleAction(clientId: string, action: any) {
    const player = this.players.find(p => p.id === clientId);
    if (!player) return;

    /* ----- HOST-ONLY ACTIONS ----- */
    if (action.type === "START") {
      if (clientId !== this.hostId) return;

      this.gameState = action.state;
      this.broadcastState();
      return;
    }

    if (!this.gameState) return;

    /* ----- TURN ENFORCEMENT ----- */
    if (player.seat !== this.gameState.currentPlayer) {
      return;
    }

    /* ----- APPLY GAME UPDATE ----- */
    if (action.type === "UPDATE") {
      this.gameState = action.state;
      this.broadcastState();
    }
  }

  /* ================================
     BROADCAST HELPERS
  ================================ */

  broadcastPlayers() {
    this.broadcast({
      type: "players",
      players: this.players
    });
  }

  sendState(ws: WebSocket) {
    if (!this.gameState) return;
    ws.send(JSON.stringify({
      type: "state",
      payload: {
        state: this.gameState
      }
    }));
  }

  broadcastState() {
    this.broadcast({
      type: "state",
      payload: {
        state: this.gameState
      }
    });
  }

  broadcast(msg: any) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      try {
        ws.send(data);
      } catch {
        // ignore broken sockets
      }
    }
  }
}
