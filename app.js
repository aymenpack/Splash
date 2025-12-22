export const FIXED_ROOM = "FAMILY";
export const WS_BASE = "wss://splash-multiplayer.azimaymen.workers.dev";
export const clientId = crypto.randomUUID();

export let mySeat = null;
export let identities = [];
export let gameState = null;

let ws = null;
let pingTimer = null;

const listeners = new Set();
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function emit(e){ for (const fn of listeners) { try{ fn(e); } catch{} } }

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const EMOJIS = ["🦊","🐼","🐯","🦁","🐸","🐙","🦉","🦄","🐲","🐶","🐱","🐵"];

const rankIndex = (r)=>RANK_ORDER.indexOf(r);
const isFace = (r)=>r==="J"||r==="Q"||r==="K";
const emoji = (i)=>EMOJIS[i % EMOJIS.length];

export function connect(name){
  ws = new WebSocket(`${WS_BASE}?room=${FIXED_ROOM}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type:"join", id:clientId, name:(name||"Player").trim() || "Player" }));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(()=>{ if (ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:"ping"})); }, 30000);
    emit({type:"conn", status:"open"});
  };
  ws.onmessage = (e) => {
    let msg; try{ msg = JSON.parse(e.data); } catch { return; }
    if (msg.type==="welcome"){ mySeat = msg.seat; emit({type:"welcome", seat:mySeat}); return; }
    if (msg.type==="players"){ identities = msg.players||[]; syncNamesFromIdentities(); emit({type:"players", players:identities}); return; }
    if (msg.type==="state"){ gameState = msg.payload?.state || null; ensureEmojis(); emit({type:"state", state:gameState}); return; }
  };
  ws.onclose = () => { if (pingTimer) clearInterval(pingTimer); pingTimer=null; emit({type:"conn", status:"closed"}); };
  ws.onerror = () => emit({type:"conn", status:"error"});
}

export function disconnect(){
  try{ ws?.close(); }catch{}
  ws=null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer=null;
  emit({type:"conn", status:"closed"});
}

function sendAction(type){
  if (!ws || ws.readyState!==WebSocket.OPEN || !gameState) return false;
  ws.send(JSON.stringify({ type:"action", action:{ type, state: JSON.parse(JSON.stringify(gameState)) }}));
  return true;
}

export function isHost(){ return mySeat===0; }
export function isMyTurn(){ return mySeat!==null && gameState && mySeat===gameState.currentPlayer; }
export function getMe(){ return (gameState && mySeat!==null) ? gameState.players?.[mySeat] : null; }

export function syncNamesFromIdentities(){
  if (!gameState?.players?.length) return;
  for (const p of identities){
    if (gameState.players[p.seat]) gameState.players[p.seat].name = p.name;
  }
}

function ensureEmojis(){
  if (!gameState?.players?.length) return;
  gameState.players.forEach((p,i)=>{ if(!p.emoji) p.emoji = emoji(i); if(!p.name) p.name = identities[i]?.name || `Player ${i+1}`; });
}

export function makeDeck(){
  const d=[];
  for(let k=0;k<2;k++){
    for(const s of SUITS) for(const r of RANKS) d.push({ id: crypto.randomUUID(), rank:r, suit:s });
  }
  for(let j=0;j<4;j++) d.push({ id: crypto.randomUUID(), rank:"JOKER", suit:"★" });
  for(let i=d.length-1;i>0;i--){
    const k=Math.floor(Math.random()*(i+1));
    [d[i],d[k]]=[d[k],d[i]];
  }
  return d;
}

function ensureSkeleton(){
  if (gameState?.players?.length) return;
  const n = Math.max(2, identities.length || 2);
  gameState = {
    players: Array.from({length:n}, (_,i)=>({
      name: identities[i]?.name || `Player ${i+1}`,
      emoji: emoji(i),
      hand: [],
      tableUp: Array.from({length:4}, ()=>null),
      tableDown: Array.from({length:4}, ()=>null)
    })),
    deck: [],
    discard: [],
    pile: [],
    currentPlayer: 0,
    mustPlayAny: false
  };
}

export function topRank(){
  return gameState?.pile?.length ? gameState.pile[gameState.pile.length-1].rank : null;
}

export function canPlayOnTop(rank){
  if (!gameState) return false;
  if (gameState.mustPlayAny) return true;
  const top = topRank();
  if (!top) return true;
  if (rank==="10" || rank==="JOKER") return true;
  if (top==="10" || top==="JOKER") return false;
  if (isFace(rank) && !isFace(top)) return false;
  return rankIndex(rank) <= rankIndex(top);
}

export function newGame(){
  if (!isHost()) return { ok:false, error:"not_host" };
  ensureSkeleton();

  gameState.deck = makeDeck();
  gameState.discard = [];
  gameState.pile = [];
  gameState.currentPlayer = 0;
  gameState.mustPlayAny = false;

  gameState.players.forEach((p,i)=>{
    p.name = identities[i]?.name || p.name || `Player ${i+1}`;
    p.emoji = p.emoji || emoji(i);
    p.hand = [];
    p.tableUp = Array.from({length:4}, ()=>null);
    p.tableDown = Array.from({length:4}, ()=>null);
  });

  for(let i=0;i<4;i++) gameState.players.forEach(p=>p.tableDown[i]=gameState.deck.pop());
  for(let i=0;i<4;i++) gameState.players.forEach(p=>p.tableUp[i]=gameState.deck.pop());
  for(let i=0;i<11;i++) gameState.players.forEach(p=>p.hand.push(gameState.deck.pop()));

  const start = gameState.deck.pop();
  gameState.pile.push(start);

  if (start.rank==="10" || start.rank==="JOKER"){
    gameState.discard.push(...gameState.pile);
    gameState.pile=[];
    gameState.mustPlayAny=true;
  }

  return { ok: sendAction("START") };
}

export function validateSelection(ids){
  if (!gameState) return { ok:false, error:"no_game" };
  if (!isMyTurn()) return { ok:false, error:"not_your_turn" };
  if (!ids?.length) return { ok:false, error:"empty" };

  const me = getMe();
  if (!me) return { ok:false, error:"no_player" };

  const chosen=[];
  for(const id of ids){
    const h = me.hand.find(c=>c.id===id);
    if (h){ chosen.push({card:h, zone:"hand"}); continue; }

    const upIdx = me.tableUp.findIndex(c=>c && c.id===id);
    if (upIdx!==-1){
      if (me.hand.length>0) return { ok:false, error:"must_play_hand_first" };
      chosen.push({card:me.tableUp[upIdx], zone:"tableUp", idx:upIdx});
    }
  }
  if (!chosen.length) return { ok:false, error:"not_found" };

  const rank = chosen[0].card.rank;
  if (!chosen.every(x=>x.card.rank===rank)) return { ok:false, error:"mixed_rank" };
  if (!canPlayOnTop(rank)) return { ok:false, error:"illegal", rank };
  return { ok:true, rank, chosen };
}

export function tryPlaySelected(ids){
  const v = validateSelection(ids);
  if (!v.ok) return v;

  const me = getMe();
  const { rank, chosen } = v;

  chosen.forEach(x=>{
    if (x.zone==="hand") me.hand = me.hand.filter(c=>c.id!==x.card.id);
    if (x.zone==="tableUp") me.tableUp[x.idx]=null;
    gameState.pile.push(x.card);
  });

  if (rank==="10" || rank==="JOKER"){
    gameState.discard.push(...gameState.pile);
    gameState.pile=[];
    gameState.mustPlayAny=true;
    sendAction("UPDATE");
    return { ok:true, special:"clear" };
  }

  const cnt = gameState.pile.reduce((a,c)=>a+(c.rank===rank?1:0),0);
  if (cnt>=3){
    gameState.discard.push(...gameState.pile);
    gameState.pile=[];
    gameState.mustPlayAny=true;
    sendAction("UPDATE");
    return { ok:true, special:"triple_clear" };
  }

  gameState.mustPlayAny=false;
  gameState.currentPlayer=(gameState.currentPlayer+1)%gameState.players.length;
  sendAction("UPDATE");
  return { ok:true };
}

export function pickupPile(){
  if (!gameState) return { ok:false, error:"no_game" };
  if (!isMyTurn()) return { ok:false, error:"not_your_turn" };
  const me = getMe();
  me.hand.push(...gameState.pile);
  gameState.pile=[];
  gameState.mustPlayAny=true;
  gameState.currentPlayer=(gameState.currentPlayer+1)%gameState.players.length;
  sendAction("UPDATE");
  return { ok:true };
}
