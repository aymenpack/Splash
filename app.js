/* =========================================================
   app.js
   - Multiplayer
   - Game rules
   - State management
   - NO DOM manipulation
========================================================= */

export const FIXED_ROOM = "FAMILY";
export const WS_BASE = "wss://splash-multiplayer.azimaymen.workers.dev";

export const clientId = crypto.randomUUID();

export let mySeat = null;
export let gameState = null;
export let identities = [];

let ws = null;

export function connect(name, onMessage){
  ws = new WebSocket(`${WS_BASE}?room=${FIXED_ROOM}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "join",
      id: clientId,
      name
    }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "welcome") mySeat = msg.seat;
    if (msg.type === "players") identities = msg.players;
    if (msg.type === "state") gameState = msg.payload.state;
    onMessage(msg);
  };

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type:"ping" }));
    }
  }, 30000);
}

export function sendAction(type){
  if (!ws || !gameState) return;
  ws.send(JSON.stringify({
    type:"action",
    action:{ type, state: JSON.parse(JSON.stringify(gameState)) }
  }));
}

/* FULL SPLASH RULES CONTINUE HERE (NEXT STEP) */
