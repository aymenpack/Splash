/* =========================================================
   ui.js — Splash UI (MODULE)
========================================================= */

import {
  connect,
  disconnect,
  subscribe,
  FIXED_ROOM,
  identities,
  mySeat,
  gameState,
  syncNamesFromIdentities,
  isMyTurn,
  isHost,
  newGame,
  tryPlaySelected,
  pickupPile,
  canPlayOnTop,
  topRank,
  getMe
} from "./app.js";

/* ===== DOM ===== */
const $ = (id) => document.getElementById(id);

// Views
const lobbyView = $("lobbyView");
const gameView  = $("gameView");

// Lobby
const nameInput = $("nameInput");
const enterBtn = $("enterBtn");
const resetNameBtn = $("resetNameBtn");
const lobbyStatus = $("lobbyStatus");
const themeSelectLobby = $("themeSelectLobby");

// Game header
const themeSelectGame = $("themeSelectGame");
const newGameBtn = $("newGameBtn");
const leaveBtn = $("leaveBtn");

// Game UI
const playersRow = $("playersRow");
const pileVisual = $("pileVisual");
const handStacks = $("handStacks");
const yourTable  = $("yourTable");
const tableTitle = $("tableTitle");
const turnInfo   = $("turnInfo");
const turnHint   = $("turnHint");

// Counters
const deckCount = $("deckCount");
const discardCount = $("discardCount");
const pileCount = $("pileCount");
const topValue = $("topValue");

// Panel
const playBtn = $("playBtn");
const pickupBtn = $("pickupBtn");
const clearSelBtn = $("clearSelBtn");
const selPill = $("selPill");

// Log
const logEl = $("log");

/* ===== UI STATE ===== */
let selectedIds = new Set();
const drag = { active:false, ids:null, el:null, pointerId:null, moved:false, sx:0, sy:0 };

/* ===== Theme ===== */
const THEMES = ["purple","ocean","emerald","desert"];
function applyTheme(key){
  const t = THEMES.includes(key) ? key : "purple";
  document.body.classList.remove(...THEMES.map(x=>"theme-"+x));
  document.body.classList.add("theme-"+t);
  localStorage.setItem("splash_theme", t);
  if (themeSelectLobby) themeSelectLobby.value = t;
  if (themeSelectGame) themeSelectGame.value = t;
}

/* ===== Views ===== */
function showLobby(){
  gameView.style.display = "none";
  lobbyView.style.display = "flex";
}
function showGame(){
  lobbyView.style.display = "none";
  gameView.style.display = "flex";
}

/* ===== Status ===== */
function setLobbyStatus(text, ok=false){
  lobbyStatus.textContent = text;
  lobbyStatus.style.borderColor = ok ? "rgba(126,231,135,.55)" : "rgba(255,255,255,.18)";
}

/* ===== Logging ===== */
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}
function logLine(text, tone=""){
  const div = document.createElement("div");
  div.className = "logLine";
  const ts = new Date().toLocaleTimeString();
  const dot = tone ? `<span style="color:${tone}">●</span> ` : "";
  div.innerHTML = `<span class="muted">[${ts}]</span> ${dot}${escapeHtml(text)}`;
  logEl.prepend(div);
}

/* ===== Render helpers ===== */
function cardHTML(c){
  return `
    <div class="corner top">${c.rank}<br>${c.suit}</div>
    <div class="pip">${c.suit}</div>
    <div class="corner bottom">${c.rank}<br>${c.suit}</div>
  `;
}
function groupByRank(cards){
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  }
  const order = ["A","2","3","4","5","6","7","8","9","10","J","Q","K","JOKER"];
  const ranks = Array.from(map.keys()).sort((a,b) => order.indexOf(a) - order.indexOf(b));
  return ranks.map(r => ({ rank:r, cards: map.get(r) }));
}

/* ===== Selection ===== */
function renderSelectionPill(){
  if (!selectedIds.size) {
    selPill.textContent = "Selected: —";
    return;
  }
  const me = getMe();
  if (!me) {
    selPill.textContent = `Selected: ${selectedIds.size}`;
    return;
  }
  const anyId = selectedIds.values().next().value;
  const anyCard = me.hand.find(c=>c.id===anyId) || me.tableUp.find(c=>c && c.id===anyId);
  selPill.textContent = anyCard ? `Selected: ${anyCard.rank} × ${selectedIds.size}` : `Selected: ${selectedIds.size}`;
}
function clearSelection(){
  selectedIds.clear();
  renderSelectionPill();
  render();
}

/* ===== Snap animation ===== */
function animateElementToPile(fromEl){
  if (!fromEl) return;
  const from = fromEl.getBoundingClientRect();
  const to = pileVisual.getBoundingClientRect();
  const clone = fromEl.cloneNode(true);
  clone.classList.add("snapClone");
  document.body.appendChild(clone);
  clone.style.left = from.left + "px";
  clone.style.top  = from.top + "px";
  clone.style.width = from.width + "px";
  clone.style.height= from.height+ "px";

  const tx = (to.left + to.width/2) - (from.left + from.width/2);
  const ty = (to.top + to.height/2) - (from.top + from.height/2);

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${tx}px, ${ty}px) scale(.72)`;
    clone.style.opacity = "0";
  });
  setTimeout(() => clone.remove(), 260);
}

/* ===== Drag to pile ===== */
function isOverPile(x,y){
  const r = pileVisual.getBoundingClientRect();
  return x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;
}
function dragStart(ids, el, pointerId, x, y){
  drag.active = true;
  drag.ids = ids;
  drag.el = el;
  drag.pointerId = pointerId;
  drag.moved = false;
  drag.sx = x;
  drag.sy = y;
  try { el.setPointerCapture(pointerId); } catch {}
}
function dragMove(x,y){
  if (!drag.active) return;
  const dx = Math.abs(x - drag.sx);
  const dy = Math.abs(y - drag.sy);
  if (dx + dy > 6) drag.moved = true;
  pileVisual.classList.toggle("dragOver", isOverPile(x,y));
}
function dragEnd(x,y){
  if (!drag.active) return;
  pileVisual.classList.remove("dragOver");
  try { drag.el.releasePointerCapture(drag.pointerId); } catch {}

  if (drag.moved && isOverPile(x,y)) {
    animateElementToPile(drag.el);

    // play dragged selection
    selectedIds.clear();
    drag.ids.forEach(id => selectedIds.add(id));
    renderSelectionPill();

    const res = tryPlaySelected(Array.from(selectedIds));
    handleActionResult(res);
  }

  drag.active = false;
  drag.ids = null;
  drag.el = null;
  drag.pointerId = null;
  drag.moved = false;
}

/* ===== Action results ===== */
function handleActionResult(res){
  if (!res) return;
  if (res.ok) {
    if (res.special === "clear") logLine("Clear! Play again.", "#7ee787");
    else if (res.special === "triple_clear") logLine("Triple clear! Play again.", "#7ee787");
    else logLine("Action OK.", "#7ee787");
    clearSelection();
    return;
  }

  const map = {
    not_connected: "Not connected.",
    not_host: "Only Host can start.",
    no_game: "Host must start a game.",
    not_your_turn: "Not your turn.",
    empty: "Select a stack first.",
    mixed_rank: "Must play same rank.",
    must_play_hand_first: "Play hand first.",
    illegal: "Illegal play.",
    not_found: "Card not found.",
    no_player: "Player not ready."
  };
  logLine(map[res.error] || ("Error: " + res.error), "#ff7b72");
}

/* ===== Main render ===== */
function render(){
  // turn and counters
  if (gameState?.players?.length) {
    const cur = gameState.players[gameState.currentPlayer];
    turnInfo.textContent = "Turn: " + (cur?.name || "—");
  } else {
    turnInfo.textContent = "Turn: —";
  }
  turnHint.textContent = isMyTurn() ? "👉 Your turn!" : "Waiting…";

  deckCount.textContent = gameState?.deck ? String(gameState.deck.length) : "—";
  discardCount.textContent = gameState?.discard ? String(gameState.discard.length) : "—";
  pileCount.textContent = gameState?.pile ? String(gameState.pile.length) : "—";
  topValue.textContent = gameState ? (gameState.mustPlayAny ? "ANY" : (topRank() || "—")) : "—";

  newGameBtn.disabled = !isHost();
  playBtn.disabled = !(isMyTurn() && selectedIds.size);
  pickupBtn.disabled = !isMyTurn();

  renderSelectionPill();
  renderPlayers();
  renderPile();
  renderHand();
  renderTable();
}

function renderPlayers(){
  playersRow.innerHTML = "";

  if (gameState?.players?.length) {
    gameState.players.forEach((p, idx) => {
      const chip = document.createElement("div");
      chip.className = "playerChip" + (idx === gameState.currentPlayer ? " active" : "");
      const isMe = (mySeat !== null && idx === mySeat);

      const handCount = p.hand?.length ?? 0;
      const tableCount = p.tableUp?.filter(c => c).length ?? 0;

      chip.innerHTML = `
        <div class="avatar">${p.emoji || "🙂"}<span class="seat">${idx+1}</span></div>
        <div style="min-width:0">
          <div style="font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.name || ("Player "+(idx+1)))}</div>
          <div class="muted" style="font-size:11px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span>Hand:</span>
            ${isMe ? `<span>${handCount}</span>` : `<span class="cardBack"></span><span>×${handCount}</span>`}
            <span>| Table: ${tableCount}</span>
          </div>
        </div>
      `;
      playersRow.appendChild(chip);
    });
    return;
  }

  // fallback identities
  if (identities?.length) {
    identities.forEach(p => {
      const chip = document.createElement("div");
      chip.className = "playerChip";
      chip.innerHTML = `
        <div class="avatar">🙂<span class="seat">${p.seat+1}</span></div>
        <div style="min-width:0">
          <div style="font-weight:900">${escapeHtml(p.name || ("Player "+(p.seat+1)))}</div>
          <div class="muted" style="font-size:11px">Waiting…</div>
        </div>`;
      playersRow.appendChild(chip);
    });
  }
}

function renderPile(){
  pileVisual.innerHTML = "";
  if (!gameState?.pile?.length) return;

  const last = gameState.pile.slice(-6);
  last.forEach((c,i) => {
    const d = document.createElement("div");
    d.className = "c";
    d.style.position = "absolute";
    d.style.left = "50%";
    d.style.top = `${14 + i*4}px`;
    d.style.transform = `translateX(-50%) rotate(${i*4 - 8}deg)`;
    d.innerHTML = cardHTML(c);
    pileVisual.appendChild(d);
  });
}

function renderHand(){
  handStacks.innerHTML = "";

  const me = getMe();
  if (!me) {
    handStacks.innerHTML = `<div class="muted" style="padding:10px;text-align:center;">Waiting…</div>`;
    return;
  }

  const groups = groupByRank(me.hand || []);
  groups.forEach(g => {
    const ids = g.cards.map(c => c.id);
    const top = g.cards[g.cards.length-1];

    const stack = document.createElement("div");
    stack.className = "cardStack";

    if (g.cards.length >= 2) {
      const ghost1 = document.createElement("div");
      ghost1.className = "c stackGhost g1";
      ghost1.innerHTML = cardHTML(top);
      stack.appendChild(ghost1);
    }
    if (g.cards.length >= 3) {
      const ghost2 = document.createElement("div");
      ghost2.className = "c stackGhost g2";
      ghost2.innerHTML = cardHTML(top);
      stack.appendChild(ghost2);
    }

    const card = document.createElement("div");
    card.className = "c";
    card.innerHTML = cardHTML(top);

    const selectedThisRank = ids.some(id => selectedIds.has(id));
    if (selectedThisRank) card.classList.add("selected");
    if (!canPlayOnTop(g.rank)) card.classList.add("illegal");

    stack.appendChild(card);

    if (g.cards.length > 1) {
      const badge = document.createElement("div");
      badge.className = "stackCount";
      badge.textContent = g.cards.length;
      stack.appendChild(badge);
    }

    stack.onclick = () => {
      if (!isMyTurn()) { logLine("Not your turn.", "#f2cc60"); return; }
      if (!canPlayOnTop(g.rank)) { logLine(`Illegal: ${g.rank} on ${topRank()}`, "#ff7b72"); return; }
      const already = ids.some(id => selectedIds.has(id));
      selectedIds.clear();
      if (!already) ids.forEach(id => selectedIds.add(id));
      renderSelectionPill();
      render();
    };

    stack.addEventListener("pointerdown", (e) => {
      if (!isMyTurn()) return;
      if (!canPlayOnTop(g.rank)) return;

      selectedIds.clear();
      ids.forEach(id => selectedIds.add(id));
      renderSelectionPill();
      render();

      dragStart(ids, stack, e.pointerId, e.clientX, e.clientY);
    });
    stack.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY));
    stack.addEventListener("pointerup", (e) => dragEnd(e.clientX, e.clientY));
    stack.addEventListener("pointercancel", (e) => dragEnd(e.clientX, e.clientY));

    handStacks.appendChild(stack);
  });
}

function renderTable(){
  yourTable.innerHTML = "";
  const me = getMe();
  if (!me) return;

  // mobile hide until hand empty
  const isSmall = window.matchMedia("(max-width: 600px)").matches;
  const showTable = !isSmall || (me.hand.length === 0);
  yourTable.classList.toggle("hidden", !showTable);
  tableTitle.classList.toggle("hidden", !showTable);

  const tableUp = me.tableUp || Array.from({length:4},()=>null);
  for (let i=0;i<4;i++){
    const up = tableUp[i];
    if (up){
      const d = document.createElement("div");
      d.className = "c";
      d.innerHTML = cardHTML(up);

      if (!canPlayOnTop(up.rank)) d.classList.add("illegal");
      if (selectedIds.has(up.id)) d.classList.add("selected");

      d.onclick = () => {
        if (!isMyTurn()) { logLine("Not your turn.", "#f2cc60"); return; }
        if (me.hand.length > 0) { logLine("Play hand first.", "#f2cc60"); return; }
        if (!canPlayOnTop(up.rank)) { logLine(`Illegal: ${up.rank} on ${topRank()}`, "#ff7b72"); return; }

        selectedIds.clear();
        selectedIds.add(up.id);
        renderSelectionPill();
        render();
      };

      d.addEventListener("pointerdown",(e)=>{
        if (!isMyTurn()) return;
        if (me.hand.length > 0) return;
        if (!canPlayOnTop(up.rank)) return;

        selectedIds.clear();
        selectedIds.add(up.id);
        renderSelectionPill();
        render();

        dragStart([up.id], d, e.pointerId, e.clientX, e.clientY);
      });
      d.addEventListener("pointermove",(e)=>dragMove(e.clientX, e.clientY));
      d.addEventListener("pointerup",(e)=>dragEnd(e.clientX, e.clientY));
      d.addEventListener("pointercancel",(e)=>dragEnd(e.clientX, e.clientY));

      yourTable.appendChild(d);
    } else {
      const empty = document.createElement("div");
      empty.className = "c";
      empty.style.opacity = "0.18";
      empty.innerHTML = `<div class="pip">—</div>`;
      yourTable.appendChild(empty);
    }
  }

  // filler for 5 columns
  const filler = document.createElement("div");
  filler.style.width = "var(--card-w)";
  filler.style.height = "var(--card-h)";
  filler.style.opacity = "0";
  yourTable.appendChild(filler);
}

/* ===== UI actions ===== */
enterBtn.onclick = () => {
  const nm = (nameInput.value || "").trim();
  if (!nm) { logLine("Enter your name.", "#ff7b72"); return; }

  localStorage.setItem("splash_name", nm);
  setLobbyStatus("Connecting…", false);
  connect(nm);
  showGame();
};

resetNameBtn.onclick = () => {
  localStorage.removeItem("splash_name");
  nameInput.value = "";
};

leaveBtn.onclick = () => {
  disconnect();
  clearSelection();
  showLobby();
  setLobbyStatus("Not connected", false);
};

newGameBtn.onclick = () => {
  const res = newGame();
  handleActionResult(res);
};

playBtn.onclick = () => {
  if (!selectedIds.size) return;
  const stack = handStacks.querySelector(".c.selected")?.parentElement;
  if (stack) animateElementToPile(stack);
  else {
    const c = yourTable.querySelector(".c.selected");
    if (c) animateElementToPile(c);
  }
  const res = tryPlaySelected(Array.from(selectedIds));
  handleActionResult(res);
};

pickupBtn.onclick = () => {
  const res = pickupPile();
  handleActionResult(res);
};

clearSelBtn.onclick = () => clearSelection();

themeSelectLobby.onchange = () => applyTheme(themeSelectLobby.value);
themeSelectGame.onchange = () => applyTheme(themeSelectGame.value);
window.addEventListener("resize", render);

/* ===== App events ===== */
subscribe((evt) => {
  if (evt.type === "conn") {
    if (evt.status === "open") setLobbyStatus("Connected", true);
    if (evt.status === "closed") setLobbyStatus("Disconnected", false);
    if (evt.status === "error") setLobbyStatus("Error", false);
  }
  if (evt.type === "players") {
    // Update names only if we already have gameState
    try { syncNamesFromIdentities(); } catch {}
  }
  if (evt.type === "state") {
    selectedIds.clear();
  }
  render();
});

/* ===== Init ===== */
(function init(){
  const savedTheme = localStorage.getItem("splash_theme") || "purple";
  applyTheme(savedTheme);

  const savedName = localStorage.getItem("splash_name") || "";
  if (savedName) nameInput.value = savedName;

  setLobbyStatus("Not connected", false);
  showLobby();
  logLine(`Ready. Room: ${FIXED_ROOM}`, "#7ee787");
})();
