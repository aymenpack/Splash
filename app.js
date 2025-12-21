/* =========================================================
   app.js — Splash core (NO DOM)
   =========================================================
   Responsibilities:
   - WebSocket connection + reconnection
   - Seat assignment via { type:"welcome", seat }
   - Identity list via { type:"players", players:[{id,name,seat}] }
     (identity never overwrites hands)
   - Authoritative game state via { type:"state", payload:{state} }
   - Full Splash rules:
       * deck creation (2 decks + 4 jokers)
       * deal: tableDown(4), tableUp(4), hand(11)
       * play legality
       * 10/JOKER clear
       * triple clear (>=3 of played rank on pile)
       * pickup pile
       * turn advance
       * mustPlayAny (play again / any card)
   - State changes are sent as ACTION:
       * START: host only
       * UPDATE: current player only (server checks)
========================================================= */

export const FIXED_ROOM = "FAMILY";
export const WS_BASE = "wss://splash-multiplayer.azimaymen.workers.dev";
export const clientId = crypto.randomUUID();

// Multiplayer identity
export let mySeat = null;          // set by welcome
export let identities = [];        // array of {id,name,seat} from "players"

// Game state (source of truth for hands)
export let gameState = null;       // full snapshot from "state"

// Connection
let ws = null;
let isConnected = false;
let pingTimer = null;

// Listener system (ui.js subscribes)
const listeners = new Set();
export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(event){
  for (const fn of listeners){
    try { fn(event); } catch {}
  }
}

// ----------------------------
// Constants / helpers
// ----------------------------
const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function rankIndex(r){ return RANK_ORDER.indexOf(r); }
function isFace(r){ return r === "J" || r === "Q" || r === "K"; }

export function isMyTurn(){
  return mySeat !== null && gameState && mySeat === gameState.currentPlayer;
}
export function isHost(){
  return mySeat === 0;
}

// ----------------------------
// WebSocket connect
// ----------------------------
export function connect(name){
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(`${WS_BASE}?room=${FIXED_ROOM}`);

  ws.onopen = () => {
    isConnected = true;
    ws.send(JSON.stringify({
      type:"join",
      id: clientId,
      name: (name || "Player").trim() || "Player"
    }));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type:"ping" }));
      }
    }, 30000);
    emit({ type:"conn", status:"open" });
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === "welcome") {
      mySeat = msg.seat;
      emit({ type:"seat", seat: mySeat });
      return;
    }

    if (msg.type === "players") {
      identities = msg.players || [];
      emit({ type:"players", players: identities });
      return;
    }

    if (msg.type === "state") {
      gameState = msg.payload?.state || null;
      emit({ type:"state", state: gameState });
      return;
    }

    if (msg.type === "pong") return;
  };

  ws.onclose = () => {
    isConnected = false;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    emit({ type:"conn", status:"closed" });
  };

  ws.onerror = () => {
    emit({ type:"conn", status:"error" });
  };
}

export function disconnect(){
  try { ws && ws.close(); } catch {}
  ws = null;
  isConnected = false;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  emit({ type:"conn", status:"closed" });
}

function sendAction(actionType){
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (!gameState) return false;

  ws.send(JSON.stringify({
    type: "action",
    action: {
      type: actionType,
      state: JSON.parse(JSON.stringify(gameState))
    }
  }));
  return true;
}

// =========================================================
// Splash Rules
// =========================================================

/**
 * Ensure gameState exists and has the correct player array length.
 * We DO NOT use identities as truth for hands, but we can use it to size players before first start.
 */
function ensureGameSkeleton(){
  if (gameState && Array.isArray(gameState.players) && gameState.players.length) return;

  const n = Math.max(2, identities.length || 2);
  gameState = {
    players: Array.from({ length:n }, (_,i)=>({
      name: identities[i]?.name || `Player ${i+1}`,
      emoji: defaultEmoji(i),
      hand: [],
      tableUp: Array.from({ length:4 }, ()=>null),
      tableDown: Array.from({ length:4 }, ()=>null),
    })),
    deck: [],
    discard: [],
    pile: [],
    currentPlayer: 0,
    mustPlayAny: false
  };
}

function defaultEmoji(i){
  const EMOJIS = ["🦊","🐼","🐯","🦁","🐸","🐙","🦉","🦄","🐲","🐶","🐱","🐵"];
  return EMOJIS[i % EMOJIS.length];
}

export function makeDeck(){
  const d = [];
  // 2 full decks
  for (let k=0;k<2;k++){
    for (const s of SUITS){
      for (const r of RANKS){
        d.push({ id: crypto.randomUUID(), rank:r, suit:s });
      }
    }
  }
  // 4 jokers
  for (let j=0;j<4;j++){
    d.push({ id: crypto.randomUUID(), rank:"JOKER", suit:"★" });
  }
  // shuffle
  for (let i=d.length-1;i>0;i--){
    const k = Math.floor(Math.random()*(i+1));
    [d[i], d[k]] = [d[k], d[i]];
  }
  return d;
}

export function topRank(){
  if (!gameState || !gameState.pile?.length) return null;
  return gameState.pile[gameState.pile.length - 1].rank;
}

export function canPlayOnTop(rank){
  if (!gameState) return false;
  if (gameState.mustPlayAny) return true;

  const top = topRank();
  if (!top) return true;

  if (rank === "10" || rank === "JOKER") return true;
  if (top === "10" || top === "JOKER") return false;

  // Faces can't go on number
  if (isFace(rank) && !isFace(top)) return false;

  // Lower/equal rank index can go on higher
  return rankIndex(rank) <= rankIndex(top);
}

/**
 * Host starts a new game: build full deck, reset, deal, set initial pile.
 * Sends START action.
 */
export function newGame(){
  if (!isConnected) return { ok:false, error:"not_connected" };
  if (!isHost()) return { ok:false, error:"not_host" };

  ensureGameSkeleton();

  // reset
  gameState.deck = makeDeck();
  gameState.discard = [];
  gameState.pile = [];
  gameState.currentPlayer = 0;
  gameState.mustPlayAny = false;

  // reset players
  gameState.players.forEach((p,i)=>{
    p.name = identities[i]?.name || p.name || `Player ${i+1}`;
    p.emoji = p.emoji || defaultEmoji(i);
    p.hand = [];
    p.tableUp = Array.from({ length:4 }, ()=>null);
    p.tableDown = Array.from({ length:4 }, ()=>null);
  });

  // deal 4 down, 4 up, 11 hand
  for (let i=0;i<4;i++) gameState.players.forEach(p => p.tableDown[i] = gameState.deck.pop());
  for (let i=0;i<4;i++) gameState.players.forEach(p => p.tableUp[i] = gameState.deck.pop());
  for (let i=0;i<11;i++) gameState.players.forEach(p => p.hand.push(gameState.deck.pop()));

  // start pile
  const start = gameState.deck.pop();
  gameState.pile.push(start);

  // if start clears
  if (start.rank === "10" || start.rank === "JOKER") {
    gameState.discard.push(...gameState.pile);
    gameState.pile = [];
    gameState.mustPlayAny = true;
  }

  // clear any local selection in UI
  emit({ type:"local", action:"newGame_local" });

  const sent = sendAction("START");
  return { ok: sent };
}

/**
 * Determine if selected IDs are playable right now for current player.
 * Returns {ok, error, rank}
 */
export function validateSelection(selectedIds){
  if (!gameState) return { ok:false, error:"no_game" };
  if (!isMyTurn()) return { ok:false, error:"not_your_turn" };
  if (!selectedIds?.length) return { ok:false, error:"empty" };

  const me = gameState.players[mySeat];
  if (!me) return { ok:false, error:"no_player" };

  // Map IDs to cards in allowed zones: hand and tableUp (only if hand empty)
  const chosen = [];
  for (const id of selectedIds){
    const h = me.hand.find(c => c.id === id);
    if (h) { chosen.push({ card:h, zone:"hand" }); continue; }

    const upIdx = me.tableUp.findIndex(c => c && c.id === id);
    if (upIdx !== -1) {
      if (me.hand.length > 0) return { ok:false, error:"must_play_hand_first" };
      chosen.push({ card: me.tableUp[upIdx], zone:"tableUp", idx: upIdx });
      continue;
    }

    // Ignore unknown ids
  }

  if (!chosen.length) return { ok:false, error:"not_found" };

  const rank = chosen[0].card.rank;
  if (!chosen.every(x => x.card.rank === rank)) return { ok:false, error:"mixed_rank" };
  if (!canPlayOnTop(rank)) return { ok:false, error:"illegal", rank };

  return { ok:true, rank, chosen };
}

/**
 * Apply a validated play to local gameState and send UPDATE.
 * This supports playing multiple of same rank at once.
 */
export function tryPlaySelected(selectedIds){
  const v = validateSelection(selectedIds);
  if (!v.ok) return v;

  const { rank, chosen } = v;
  const me = gameState.players[mySeat];

  // remove from zones and push to pile
  chosen.forEach(x=>{
    if (x.zone === "hand") {
      me.hand = me.hand.filter(c => c.id !== x.card.id);
    } else if (x.zone === "tableUp") {
      me.tableUp[x.idx] = null;
    }
    gameState.pile.push(x.card);
  });

  // clears
  if (rank === "10" || rank === "JOKER") {
    gameState.discard.push(...gameState.pile);
    gameState.pile = [];
    gameState.mustPlayAny = true;
    // play again (same currentPlayer)
    sendAction("UPDATE");
    return { ok:true, special:"clear" };
  }

  // triple clear: if pile contains 3+ of this rank
  const cnt = gameState.pile.reduce((a,c)=>a + (c.rank===rank ? 1:0), 0);
  if (cnt >= 3) {
    gameState.discard.push(...gameState.pile);
    gameState.pile = [];
    gameState.mustPlayAny = true;
    sendAction("UPDATE");
    return { ok:true, special:"triple_clear" };
  }

  // normal next turn
  gameState.mustPlayAny = false;
  gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;

  sendAction("UPDATE");
  return { ok:true };
}

/**
 * Pickup pile: add pile to current player's hand.
 * Turn advances, mustPlayAny true.
 */
export function pickupPile(){
  if (!gameState) return { ok:false, error:"no_game" };
  if (!isMyTurn()) return { ok:false, error:"not_your_turn" };
  const me = gameState.players[mySeat];
  if (!me) return { ok:false, error:"no_player" };

  me.hand.push(...gameState.pile);
  gameState.pile = [];
  gameState.mustPlayAny = true;
  gameState.currentPlayer = (gameState.currentPlayer + 1) % gameState.players.length;

  sendAction("UPDATE");
  return { ok:true };
}

/**
 * Utility: update local player names from identities, without touching hands.
 * Call this whenever you get a `players` message if you already have gameState.
 */
export function syncNamesFromIdentities(){
  if (!gameState?.players?.length) return;
  identities.forEach(p=>{
    if (gameState.players[p.seat]) gameState.players[p.seat].name = p.name;
  });
}

/**
 * For UI: get safe view of "me"
 */
export function getMe(){
  if (!gameState || mySeat === null) return null;
  return gameState.players?.[mySeat] || null;
}
