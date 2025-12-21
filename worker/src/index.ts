export interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const room = url.searchParams.get("room") || "FAMILY";
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
      let msg: any;
      try { msg = JSON.parse(evt.data); } catch { return; }

      /* JOIN */
      if (msg.type === "join") {
        clientId = msg.id;

        let player = this.players.find(p => p.id === clientId);
        if (!player) {
          player = {
            id: clientId,
            name: msg.name || "Player",
            seat: this.players.length
          };
          this.players.push(player);
        }

        this.sockets.set(clientId, ws);

        // 🔑 SEND SEAT EXPLICITLY (FIX)
        ws.send(JSON.stringify({
          type: "welcome",
          seat: player.seat
        }));

        this.broadcastPlayers();
        if (this.gameState) this.sendState(ws);
        return;
      }

      if (!clientId) return;

      /* ACTIONS */
      if (msg.type === "action") {
        const player = this.players.find(p => p.id === clientId);
        if (!player) return;

        if (msg.action.type === "START") {
          if (player.seat !== 0) return;
          this.gameState = msg.action.state;
          this.broadcastState();
          return;
        }

        if (!this.gameState) return;
        if (player.seat !== this.gameState.currentPlayer) return;

        if (msg.action.type === "UPDATE") {
          this.gameState = msg.action.state;
          this.broadcastState();
        }
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.addEventListener("close", () => {
      if (!clientId) return;
      this.sockets.delete(clientId);
    });
  }

  broadcastPlayers() {
    this.broadcast({
      type: "players",
      players: this.players
    });
  }

  sendState(ws: WebSocket) {
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
