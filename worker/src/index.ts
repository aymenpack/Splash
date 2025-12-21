export interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const room = (url.searchParams.get("room") || "FAMILY").toUpperCase();
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

  async fetch(req: Request): Promise<Response> {
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

    ws.addEventListener("message", (evt) => {
      let msg: any;
      try { msg = JSON.parse(evt.data as any); } catch { return; }

      // JOIN
      if (msg.type === "join") {
        clientId = msg.id;

        let player = this.players.find(p => p.id === clientId);
        if (!player) {
          player = { id: clientId, name: msg.name || "Player", seat: this.players.length };
          this.players.push(player);
        } else {
          player.name = msg.name || player.name;
        }

        this.sockets.set(clientId, ws);

        // ✅ Explicit seat assignment (fixes “Player 2 doesn’t see their hand”)
        ws.send(JSON.stringify({ type: "welcome", seat: player.seat }));

        this.broadcast({ type: "players", players: this.players });

        if (this.gameState) {
          ws.send(JSON.stringify({ type: "state", payload: { state: this.gameState } }));
        }
        return;
      }

      if (!clientId) return;

      // ACTIONS (server-authoritative)
      if (msg.type === "action") {
        const player = this.players.find(p => p.id === clientId);
        if (!player) return;

        // Host-only START
        if (msg.action?.type === "START") {
          if (player.seat !== 0) return;
          this.gameState = msg.action.state;
          this.broadcast({ type: "state", payload: { state: this.gameState } });
          return;
        }

        if (!this.gameState) return;

        // Turn enforcement
        if (player.seat !== this.gameState.currentPlayer) return;

        if (msg.action?.type === "UPDATE") {
          this.gameState = msg.action.state;
          this.broadcast({ type: "state", payload: { state: this.gameState } });
          return;
        }
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.addEventListener("close", () => {
      if (!clientId) return;
      this.sockets.delete(clientId);

      // Keep players stable to avoid seat reshuffles.
      // (Cleanup policy can be added later.)
      this.broadcast({ type: "players", players: this.players });
    });
  }

  broadcast(msg: any) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      try { ws.send(data); } catch {}
    }
  }
}
