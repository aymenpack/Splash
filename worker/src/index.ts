export interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const room = url.searchParams.get("room");
    if (!room) return new Response("Missing room", { status: 400 });

    const id = env.ROOM.idFromName(room);
    return env.ROOM.get(id).fetch(req);
  }
};

type Player = {
  id: string;
  name: string;
  seat: number;
};

export class Room {
  state: DurableObjectState;
  sockets = new Map<string, WebSocket>();
  players: Player[] = [];
  hostId: string | null = null;
  gameState: any = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSocket(ws: WebSocket) {
    ws.accept();
    let clientId: string | null = null;

    ws.addEventListener("message", evt => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      /* -------- JOIN -------- */
      if (msg.type === "join") {
        clientId = msg.id;

        if (!this.players.find(p => p.id === clientId)) {
          const seat = this.players.length;
          this.players.push({ id: clientId, name: msg.name, seat });

          if (seat === 0) this.hostId = clientId;
        }

        this.sockets.set(clientId, ws);

        this.sendPlayers();
        this.sendState(ws);
        return;
      }

      if (!clientId) return;

      /* -------- ACTIONS -------- */
      if (msg.type === "action") {
        if (clientId !== this.hostId) {
          // Only host can mutate state
          return;
        }

        this.applyAction(msg.action);
        this.broadcastState();
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.addEventListener("close", () => {
      if (!clientId) return;
      this.sockets.delete(clientId);
      this.players = this.players.filter(p => p.id !== clientId);
      this.sendPlayers();
    });
  }

  /* ==========================
     GAME AUTHORITY
  ========================== */

  applyAction(action: any) {
    if (action.type === "START") {
      this.gameState = action.state;
    }

    if (action.type === "UPDATE") {
      this.gameState = action.state;
    }
  }

  /* ==========================
     BROADCAST HELPERS
  ========================== */

  sendPlayers() {
    this.broadcast({
      type: "players",
      players: this.players
    });
  }

  sendState(ws: WebSocket) {
    if (!this.gameState) return;
    ws.send(JSON.stringify({
      type: "state",
      payload: { state: this.gameState }
    }));
  }

  broadcastState() {
    this.broadcast({
      type: "state",
      payload: { state: this.gameState }
    });
  }

  broadcast(msg: any) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      try { ws.send(data); } catch {}
    }
  }
}
