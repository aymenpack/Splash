/* =========================================================
   ui.js — Splash UI (MODULE)
   ---------------------------------------------------------
   Responsibilities:
   - DOM wiring (lobby/game)
   - Theme switching + persistence
   - Rendering (players/pile/hand/table)
   - Interaction (select, drag, snap)
   - Logging
   - NO game rules beyond UI selection grouping
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

/* =========================
   DOM
========================= */
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

// Game header controls
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

/* =========================
   UI STATE
========================= */
let selectedIds = new Set();   // selected card ids (always single-rank)
let lastRenderToken = 0;

// drag state
const drag = {
  active: false,
  ids: null,
  el: null,
  pointerId: null,
  moved: false,
  sx: 0,
  sy: 0
};

/* =========================
   THEME
========================= */
const THEME_KEYS = ["purple","ocean","emerald","desert"];

function applyTheme(key) {
  const theme = THEME_KEYS.includes(key) ? key : "purple";
  document.body.classList.remove(...THEME_KEYS.map(t => "theme-" + t));
  document.body.classList.add("theme-" + theme);
  localStorage.setItem("splash_theme", theme);

  // sync selects
  if (themeSelectLobby) themeSelectLobby.value = theme;
  if (themeSelectGame) themeSelectGame.value = theme;
}

function initTheme() {
  const saved = localStorage.getItem("splash_theme") || "purple";
  applyTheme(saved);
}

/* =========================
   VIEW CONTROL
========================= */
function showLobby() {
  lobbyView.style.display = "flex";
  gameView.style.display = "none";
}

function showGame() {
  lobbyView.style.display = "none";
  gameView.style.display = "flex";
}

/* =========================
   LOBBY STATUS
========================= */
function setLobbyStatus(text, ok=false) {
  lobbyStatus.textContent = text;
  lobbyStatus.style.borderColor = ok ? "rgba(126,231,135,.55)" : "rgba(255,255,255,.18)";
}

/* =========================
   LOGGING
========================= */
function logLine(text, tone="") {
  const div = document.createElement("div");
  div.className = "logLine";
  const ts = new Date().toLocaleTimeString();
  const dot = tone ? `<span style="color:${tone}">●</span> ` : "";
  div.innerHTML = `<span class="muted">[${ts}]</span> ${dot}${escapeHtml(text)}`;
  logEl.prepend(div);
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

/* =========================
   RENDER SCHEDULING
========================= */
function scheduleRender(reason="") {
  // coalesce renders
  const token = ++lastRenderToken;
  requestAnimationFrame(() => {
    if (token !== lastRenderToken) return;
    renderAll(reason);
  });
}

/* =========================
   RENDER HELPERS
========================= */
function cardHTML(c){
  return `
    <div class="corner top">${c.rank}<br>${c.suit}</div>
    <div class="pip">${c.suit}</div>
    <div class="corner bottom">${c.rank}<br>${c.suit}</div>
  `;
}

/**
 * Group cards by rank for stack rendering.
 * This is UI-only grouping, not game rules.
 */
function groupByRank(cards){
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  }
  // sort ranks
  const order = ["A","2","3","4","5","6","7","8","9","10","J","Q","K","JOKER"];
  const ranks = Array.from(map.keys()).sort((a,b) => order.indexOf(a) - order.indexOf(b));
  return ranks.map(r => ({ rank:r, cards: map.get(r) }));
}

function setSelection(ids){
  selectedIds.clear();
  for (const id of ids) selectedIds.add(id);
  renderSelectionPill();
  scheduleRender("selection");
}

function clearSelection(){
  selectedIds.clear();
  renderSelectionPill();
  scheduleRender("clearSelection");
}

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
  const anyCard = me.hand.find(c => c.id === anyId) || me.tableUp.find(c => c && c.id === anyId);
  if (!anyCard) {
    selPill.textContent = `Selected: ${selectedIds.size}`;
    return;
  }
  selPill.textContent = `Selected: ${anyCard.rank} × ${selectedIds.size}`;
}

/* =========================
   SNAP ANIMATION
========================= */
function animateElementToPile(fromEl){
  if (!fromEl) return;
  const from = fromEl.getBoundingClientRect();
  const to = pileVisual.getBoundingClientRect();

  const clone = fromEl.cloneNode(true);
  clone.classList.add("snapClone");
  document.body.appendChild(clone);

  clone.style.left = from.left + "px";
  clone.style.top = from.top + "px";
  clone.style.width = from.width + "px";
  clone.style.height = from.height + "px";

  const tx = (to.left + to.width/2) - (from.left + from.width/2);
  const ty = (to.top + to.height/2) - (from.top + from.height/2);

  requestAnimationFrame(() => {
    clone.style.transform = `translate(${tx}px, ${ty}px) scale(.72)`;
    clone.style.opacity = "0";
  });

  setTimeout(() => clone.remove(), 260);
}

/* =========================
   DRAG TO PILE
========================= */
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
    // snap + play
    animateElementToPile(drag.el);

    // set selection to dragged ids (single rank)
    setSelection(drag.ids);

    const result = tryPlaySelected(Array.from(drag.ids));
    handlePlayResult(result);
  }

  drag.active = false;
  drag.ids = null;
  drag.el = null;
  drag.pointerId = null;
  drag.moved = false;
}

/* =========================
   ACTION HANDLERS
========================= */
function handlePlayResult(res){
  if (!res) return;
  if (res.ok) {
    // selection cleared by game update render; but clear local immediately too
    clearSelection();
    if (res.special === "clear") logLine("Clear! Play again.", "#7ee787");
    else if (res.special === "triple_clear") logLine("Triple clear! Play again.", "#7ee787");
    else logLine("Played.", "#7ee787");
  } else {
    // show a friendly error
    const map = {
      not_connected: "Not connected.",
      not_host: "Only Host (Player 1) can start.",
      no_game: "Host must start a game.",
      not_your_turn: "Not your turn.",
      empty: "Select a stack first.",
      mixed_rank: "Must play same rank.",
      must_play_hand_first: "Must play hand first.",
      illegal: "Illegal play.",
      not_found: "Selection not found.",
      no_player: "Player not ready."
    };
    const msg = map[res.error] || ("Error: " + res.error);
    logLine(msg, "#ff7b72");
  }
}

/* =========================
   RENDER MAIN
========================= */
function renderAll(reason="") {
  // view-level
  const me = getMe();

  // Header turn info
  if (gameState && gameState.players && gameState.players.length) {
    const cur = gameState.players[gameState.currentPlayer];
    turnInfo.textContent = "Turn: " + (cur?.name || "—");
  } else {
    turnInfo.textContent = "Turn: —";
  }
  turnHint.textContent = (isMyTurn() ? "👉 Your turn!" : "Waiting…");

  // Counters
  deckCount.textContent = gameState?.deck ? String(gameState.deck.length) : "—";
  discardCount.textContent = gameState?.discard ? String(gameState.discard.length) : "—";
  pileCount.textContent = gameState?.pile ? String(gameState.pile.length) : "—";
  topValue.textContent = gameState ? (gameState.mustPlayAny ? "ANY" : (topRank() || "—")) : "—";

  // Buttons
  newGameBtn.disabled = !(isHost());
  playBtn.disabled = !(isMyTurn() && selectedIds.size);
  pickupBtn.disabled = !(isMyTurn());

  // Players row
  renderPlayersRow();

  // Pile visual
  renderPile();

  // Hand
  renderHand(me);

  // Table
  renderTable(me);

  // Selection pill
  renderSelectionPill();

  // Optional: hide table cards on small screens while hand not empty
  if (me) {
    const isSmall = window.matchMedia("(max-width: 600px)").matches;
    const showTable = !isSmall || (me.hand.length === 0);
    yourTable.classList.toggle("hidden", !showTable);
    tableTitle.classList.toggle("hidden", !showTable);
  }
}

function renderPlayersRow(){
  playersRow.innerHTML = "";

  // Prefer gameState.players for counts (has hands)
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

  // If no gameState yet, show identities only
  if (identities?.length) {
    identities.forEach(p => {
      const chip = document.createElement("div");
      chip.className = "playerChip";
      chip.innerHTML = `
        <div class="avatar">🙂<span class="seat">${p.seat+1}</span></div>
        <div style="min-width:0">
          <div style="font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.name || ("Player "+(p.seat+1)))}</div>
          <div class="muted" style="font-size:11px">Waiting for game…</div>
        </div>`;
      playersRow.appendChild(chip);
    });
  } else {
    const chip = document.createElement("div");
    chip.className = "muted";
    chip.style.padding = "8px";
    chip.textContent = "Waiting for players…";
    playersRow.appendChild(chip);
  }
}

function renderPile(){
  pileVisual.innerHTML = "";
  if (!gameState?.pile?.length) return;

  const last = gameState.pile.slice(-6);
  last.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "c";
    d.style.position = "absolute";
    d.style.left = "50%";
    d.style.top = `${14 + i * 4}px`;
    d.style.transform = `translateX(-50%) rotate(${i * 4 - 8}deg)`;
    d.innerHTML = cardHTML(c);
    pileVisual.appendChild(d);
  });
}

function renderHand(me){
  handStacks.innerHTML = "";
  if (!me) {
    handStacks.innerHTML = `<div class="muted" style="padding:10px;text-align:center;">Join a room / waiting…</div>`;
    return;
  }

  const groups = groupByRank(me.hand || []);
  if (!groups.length) {
    handStacks.innerHTML = `<div class="muted" style="padding:10px;text-align:center;">No hand cards</div>`;
    return;
  }

  groups.forEach(g => {
    const ids = g.cards.map(c => c.id);
    const top = g.cards[g.cards.length - 1];

    const stack = document.createElement("div");
    stack.className = "cardStack";

    // Ghosts
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

    const anySelected = ids.some(id => selectedIds.has(id));
    if (anySelected) card.classList.add("selected");
    if (!canPlayOnTop(g.rank)) card.classList.add("illegal");

    stack.appendChild(card);

    if (g.cards.length > 1) {
      const badge = document.createElement("div");
      badge.className = "stackCount";
      badge.textContent = g.cards.length;
      stack.appendChild(badge);
    }

    // click = toggle select whole rank
    stack.onclick = () => {
      if (!isMyTurn()) { logLine("Not your turn.", "#f2cc60"); return; }
      if (!canPlayOnTop(g.rank)) { logLine(`Illegal: ${g.rank} on ${topRank()}`, "#ff7b72"); return; }

      // only one rank selection at a time
      const already = ids.some(id => selectedIds.has(id));
      selectedIds.clear();
      if (!already) ids.forEach(id => selectedIds.add(id));
      renderSelectionPill();
      scheduleRender("stackClick");
    };

    // drag to pile
    stack.addEventListener("pointerdown", (e) => {
      if (!isMyTurn()) return;
      if (!canPlayOnTop(g.rank)) return;

      // set selection to this rank
      selectedIds.clear();
      ids.forEach(id => selectedIds.add(id));
      renderSelectionPill();
      scheduleRender("stackDragSelect");

      dragStart(ids, stack, e.pointerId, e.clientX, e.clientY);
    });
    stack.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY));
    stack.addEventListener("pointerup", (e) => dragEnd(e.clientX, e.clientY));
    stack.addEventListener("pointercancel", (e) => dragEnd(e.clientX, e.clientY));

    handStacks.appendChild(stack);
  });
}

function renderTable(me){
  yourTable.innerHTML = "";
  if (!me) return;

  // 4 tableUp slots + 1 filler
  for (let i=0;i<4;i++){
    const up = me.tableUp?.[i] || null;
    if (up) {
      const d = document.createElement("div");
      d.className = "c";
      d.innerHTML = cardHTML(up);

      if (!canPlayOnTop(up.rank)) d.classList.add("illegal");
      if (selectedIds.has(up.id)) d.classList.add("selected");

      // click select single
      d.onclick = () => {
        if (!isMyTurn()) { logLine("Not your turn.", "#f2cc60"); return; }
        if (me.hand.length > 0) { logLine("Play hand first.", "#f2cc60"); return; }
        if (!canPlayOnTop(up.rank)) { logLine(`Illegal: ${up.rank} on ${topRank()}`, "#ff7b72"); return; }
        selectedIds.clear();
        selectedIds.add(up.id);
        renderSelectionPill();
        scheduleRender("tableSelect");
      };

      // drag to pile
      d.addEventListener("pointerdown", (e) => {
        if (!isMyTurn()) return;
        if (me.hand.length > 0) return;
        if (!canPlayOnTop(up.rank)) return;

        selectedIds.clear();
        selectedIds.add(up.id);
        renderSelectionPill();
        scheduleRender("tableDragSelect");

        dragStart([up.id], d, e.pointerId, e.clientX, e.clientY);
      });
      d.addEventListener("pointermove", (e) => dragMove(e.clientX, e.clientY));
      d.addEventListener("pointerup", (e) => dragEnd(e.clientX, e.clientY));
      d.addEventListener("pointercancel", (e) => dragEnd(e.clientX, e.clientY));

      yourTable.appendChild(d);
    } else {
      const empty = document.createElement("div");
      empty.className = "c";
      empty.style.opacity = "0.18";
      empty.innerHTML = `<div class="pip">—</div>`;
      yourTable.appendChild(empty);
    }
  }

  const filler = document.createElement("div");
  filler.style.width = "var(--card-w)";
  filler.style.height = "var(--card-h)";
  filler.style.opacity = "0";
  yourTable.appendChild(filler);
}

/* =========================
   UI EVENTS
========================= */
enterBtn.onclick = () => {
  const name = (nameInput.value || "").trim();
  if (!name) {
    logLine("Enter your name first.", "#ff7b72");
    return;
  }
  localStorage.setItem("splash_name", name);

  setLobbyStatus("Connecting…", false);
  connect(name);

  showGame();
  logLine(`Joining room ${FIXED_ROOM}…`, "#7ee787");
};

resetNameBtn.onclick = () => {
  localStorage.removeItem("splash_name");
  nameInput.value = "";
};

leaveBtn.onclick = () => {
  disconnect();
  selectedIds.clear();
  mySeat = null; // local UI reference; app.js holds actual, but UI can reset display
  showLobby();
  setLobbyStatus("Not connected", false);
  logLine("Left room.", "#ff7b72");
};

newGameBtn.onclick = () => {
  const res = newGame();
  if (!res.ok) {
    if (res.error === "not_host") logLine("Only Host (Player 1) can start.", "#f2cc60");
    else logLine("Cannot start game.", "#ff7b72");
  } else {
    logLine("New game started.", "#7ee787");
  }
};

playBtn.onclick = () => {
  if (!selectedIds.size) return;
  // animate the selected stack/card if visible
  const stack = handStacks.querySelector(".c.selected")?.parentElement;
  if (stack) animateElementToPile(stack);
  else {
    const card = yourTable.querySelector(".c.selected");
    if (card) animateElementToPile(card);
  }
  const res = tryPlaySelected(Array.from(selectedIds));
  handlePlayResult(res);
};

pickupBtn.onclick = () => {
  const res = pickupPile();
  handlePlayResult(res);
};

clearSelBtn.onclick = () => clearSelection();

themeSelectLobby.onchange = () => applyTheme(themeSelectLobby.value);
themeSelectGame.onchange = () => applyTheme(themeSelectGame.value);

window.addEventListener("resize", () => scheduleRender("resize"));

/* =========================
   APP EVENTS (from app.js)
========================= */
subscribe((evt) => {
  if (evt.type === "conn") {
    if (evt.status === "open") setLobbyStatus("Connected", true);
    if (evt.status === "closed") setLobbyStatus("Disconnected", false);
    if (evt.status === "error") setLobbyStatus("Error", false);
    scheduleRender("conn");
  }
  if (evt.type === "seat") {
    logLine(`Seat assigned: Player ${evt.seat + 1}`, "#7ee787");
    scheduleRender("seat");
  }
  if (evt.type === "players") {
    // if we already have gameState, update names without touching hands
    try { syncNamesFromIdentities(); } catch {}
    scheduleRender("players");
  }
  if (evt.type === "state") {
    // state update is authoritative; clear local selection
    selectedIds.clear();
    renderSelectionPill();
    scheduleRender("state");
  }
});

/* =========================
   INIT
========================= */
(function init(){
  initTheme();

  // prefill name
  const savedName = localStorage.getItem("splash_name") || "";
  if (savedName) nameInput.value = savedName;

  // sync theme dropdowns
  const savedTheme = localStorage.getItem("splash_theme") || "purple";
  applyTheme(savedTheme);

  setLobbyStatus("Not connected", false);
  showLobby();
  logLine("Welcome! Enter your name and tap Enter Game.", "#7ee787");
})();
