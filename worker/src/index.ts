export interface Env {
  ROOM: DurableObjectNamespace;
}

/* ================================
   MAIN WORKER
================================ */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const roomCode = url.searchParams.get("room");

    if (!roomCode) {
      return new Response("Missing room code", { status: 400 });
    }

    const id = env.ROOM.idFromName(roomCode);
    const room = env.ROOM.get(id);

    return room.fetch(req);
  }
};

/* ================================
   DURABLE OBJECT: ROOM
================================ */

export class Room {
  state: DurableObjectState;
  sockets: Map<string, WebSocket>;
  players: { id: string; name: string }[];
  gameState: any;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sockets = new Map();
    this.players = [];
    this.gameState = null;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    await this.handleSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async handleSocket(ws: WebSocket) {
    ws.accept();

    let clientId: string | null = null;

    ws.addEventListener("message", async (evt) => {
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
          this.players.push({
            id: clientId,
            name: msg.name || "Player"
          });
        }

        this.sockets.set(clientId, ws);

        this.broadcast({
          type: "players",
          players: this.players
        });

        if (this.gameState) {
          ws.send(JSON.stringify({
            type: "state",
            payload: {
              senderId: "server",
              state: this.gameState
            }
          }));
        }

        return;
      }

      /* ---------- GAME STATE UPDATE (HOST) ---------- */
      if (msg.type === "broadcast") {
        // Only accept authoritative updates
        this.gameState = msg.payload.state;

        this.broadcast({
          type: "state",
          payload: {
            senderId: msg.payload.senderId,
            state: this.gameState
          }
        });

        return;
      }

      /* ---------- RESET ---------- */
      if (msg.type === "reset") {
        this.gameState = null;

        this.broadcast({
          type: "reset"
        });
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

      this.broadcast({
        type: "players",
        players: this.players
      });
    });
  }

  broadcast(msg: any) {
    const data = JSON.stringify(msg);

    for (const ws of this.sockets.values()) {
      try {
        ws.send(data);
      } catch {}
    }
  }
}
