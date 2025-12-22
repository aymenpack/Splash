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

type Player = { id: string; name: string; seat: number };

export class Room {
  state: DurableObjectState;
  sockets = new Map<string, WebSocket>();
  players: Player[] = [];
  gameState: any = null;

  constructor(state: DurableObjectState) { this.state = state; }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
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

      if (msg.type === "join") {
        clientId = msg.id;

        let p = this.players.find(x => x.id === clientId);
        if (!p) {
          p = { id: clientId, name: msg.name || "Player", seat: this.players.length };
          this.players.push(p);
        } else {
          p.name = msg.name || p.name;
        }

        this.sockets.set(clientId, ws);

        // ✅ Seat is explicit (fixes Player 2)
        ws.send(JSON.stringify({ type: "welcome", seat: p.seat }));

        this.broadcast({ type: "players", players: this.players });
        if (this.gameState) ws.send(JSON.stringify({ type: "state", payload: { state: this.gameState } }));
        return;
      }

      if (!clientId) return;

      if (msg.type === "action") {
        const p = this.players.find(x => x.id === clientId);
        if (!p) return;

        if (msg.action?.type === "START") {
          if (p.seat !== 0) return; // host only
          this.gameState = msg.action.state;
          this.broadcast({ type: "state", payload: { state: this.gameState } });
          return;
        }

        if (!this.gameState) return;
        if (p.seat !== this.gameState.currentPlayer) return; // turn enforcement

        if (msg.action?.type === "UPDATE") {
          this.gameState = msg.action.state;
          this.broadcast({ type: "state", payload: { state: this.gameState } });
          return;
        }
      }

      if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });

    ws.addEventListener("close", () => {
      if (!clientId) return;
      this.sockets.delete(clientId);
      // keep players stable (no reshuffle)
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
