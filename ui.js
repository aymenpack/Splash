import {
  connect,
  disconnect,
  subscribe,
  FIXED_ROOM,
  identities,
  mySeat,
  gameState,
  isHost,
  isMyTurn,
  newGame,
  tryPlaySelected,
  pickupPile,
  canPlayOnTop,
  topRank,
  getMe
} from "./app.js";

/* =========================================================
   DOM HELPERS
========================================================= */
const $ = (id) => document.getElementById(id);

/* =========================================================
   DOM REFERENCES
========================================================= */
const lobbyView = $("lobbyView");
const gameView  = $("gameView");

const nameInput = $("nameInput");
const enterBtn = $("enterBtn");
const resetNameBtn = $("resetNameBtn");
const lobbyStatus = $("lobbyStatus");
const themeSelectLobby = $("themeSelectLobby");

const themeSelectGame = $("themeSelectGame");
const newGameBtn = $("newGameBtn");
const leaveBtn = $("leaveBtn");

const playersRow = $("playersRow");
const pileVisual = $("pileVisual");
const handStacks = $("handStacks");
const yourTable = $("yourTable");
const tableTitle = $("tableTitle");

const deckCount = $("deckCount");
const discardCount = $("discardCount");
const pileCount = $("pileCount");
const topValue = $("topValue");

const turnInfo = $("turnInfo");
const turnHint = $("turnHint");

const playBtn = $("playBtn");
const pickupBtn = $("pickupBtn");
const clearSelBtn = $("clearSelBtn");

const logEl = $("log");

/* =========================================================
   UI STATE
========================================================= */
let selectedIds = new Set();

/* =========================================================
   THEME
========================================================= */
const THEMES = ["purple","ocean","emerald","desert"];

function applyTheme(theme){
  const t = THEMES.includes(theme) ? theme : "purple";
  document.body.classList.remove(...THEMES.map(x => "theme-" + x));
  document.body.classList.add("theme-" + t);
  localStorage.setItem("splash_theme", t);
  themeSelectLobby.value = t;
  themeSelectGame.value = t;
}

/* =========================================================
   VIEW CONTROL
========================================================= */
function showLobby(){
  lobbyView.style.display = "flex";
  gameView.style.display = "none";
}

function showGame(){
  lobbyView.style.display = "none";
  gameView.style.display = "flex";
}

/* =========================================================
   STATUS + LOG
========================================================= */
function setLobbyStatus(text, ok=false){
  lobbyStatus.textContent = text;
  lobbyStatus.style.borderColor = ok
    ? "rgba(126,231,135,.6)"
    : "rgba(255,255,255,.2)";
}

function logLine(text){
  const div = document.createElement("div");
  div.className = "logLine";
  const ts = new Date().toLocaleTimeString();
  div.innerHTML = `<span class="muted">[${ts}]</span> ${text}`;
  logEl.prepend(div);
}

/* =========================================================
   SELECTION
========================================================= */
function clearSelection(){
  selectedIds.clear();
  render();
}

/* =========================================================
   RENDER
========================================================= */
function render(){
  /* ---------- HEADER ---------- */
  if (gameState?.players?.length) {
    turnInfo.textContent =
      "Turn: " + (gameState.players[gameState.currentPlayer]?.name || "—");
  } else {
    turnInfo.textContent = "Turn: —";
  }

  /* ---------- NO GAME YET ---------- */
  if (!gameState) {
    turnHint.textContent = "⏳ Waiting for host to start the game";

    handStacks.innerHTML = `
      <div class="muted" style="padding:18px;text-align:center;">
        Waiting for host to start the game…
      </div>
    `;

    playersRow.innerHTML = "";
    identities.forEach(p => {
      const d = document.createElement("div");
      d.className = "playerChip";
      d.innerHTML = `
        <div class="avatar">🙂<span class="seat">${p.seat+1}</span></div>
        <div class="playerMeta">
          <div class="playerName">${p.name}</div>
          <div class="playerCounts muted">Waiting…</div>
        </div>
      `;
      playersRow.appendChild(d);
    });

    pileVisual.innerHTML = "";
    yourTable.innerHTML = "";

    deckCount.textContent = "—";
    discardCount.textContent = "—";
    pileCount.textContent = "—";
    topValue.textContent = "—";

    playBtn.disabled = true;
    pickupBtn.disabled = true;
    newGameBtn.disabled = !isHost();

    return;
  }

  /* ---------- COUNTERS ---------- */
  deckCount.textContent = gameState.deck.length;
  discardCount.textContent = gameState.discard.length;
  pileCount.textContent = gameState.pile.length;
  topValue.textContent = gameState.mustPlayAny ? "ANY" : (topRank() || "—");

  /* ---------- BUTTON STATES ---------- */
  newGameBtn.disabled = !isHost();
  playBtn.disabled = !(isMyTurn() && selectedIds.size);
  pickupBtn.disabled = !isMyTurn();

  turnHint.textContent = isMyTurn()
    ? "👉 Your turn"
    : "Waiting for other player…";

  /* ---------- PLAYERS ---------- */
  playersRow.innerHTML = "";
  gameState.players.forEach((p, idx) => {
    const isMe = (idx === mySeat);
    const d = document.createElement("div");
    d.className = "playerChip" + (idx === gameState.currentPlayer ? " active" : "");
    d.innerHTML = `
      <div class="avatar">${p.emoji}<span class="seat">${idx+1}</span></div>
      <div class="playerMeta">
        <div class="playerName">${p.name}</div>
        <div class="playerCounts">
          Hand: ${isMe ? p.hand.length : "?"} · Table: ${p.tableUp.filter(c=>c).length}
        </div>
      </div>
    `;
    playersRow.appendChild(d);
  });

  /* ---------- PILE ---------- */
  pileVisual.innerHTML = "";
  gameState.pile.slice(-5).forEach((c,i)=>{
    const d = document.createElement("div");
    d.className = "c";
    d.style.position = "absolute";
    d.style.left = "50%";
    d.style.top = `${12 + i*4}px`;
    d.style.transform = `translateX(-50%) rotate(${i*4 - 8}deg)`;
    d.innerHTML = `
      <div class="corner top">${c.rank}<br>${c.suit}</div>
      <div class="pip">${c.suit}</div>
      <div class="corner bottom">${c.rank}<br>${c.suit}</div>
    `;
    pileVisual.appendChild(d);
  });

  /* ---------- HAND ---------- */
  handStacks.innerHTML = "";
  const me = getMe();
  if (me) {
    const byRank = {};
    me.hand.forEach(c => (byRank[c.rank] ??= []).push(c));

    Object.values(byRank).forEach(cards => {
      const top = cards[cards.length-1];
      const stack = document.createElement("div");
      stack.className = "cardStack";

      const card = document.createElement("div");
      card.className = "c";
      card.innerHTML = `
        <div class="corner top">${top.rank}<br>${top.suit}</div>
        <div class="pip">${top.suit}</div>
        <div class="corner bottom">${top.rank}<br>${top.suit}</div>
      `;
      stack.appendChild(card);

      stack.onclick = () => {
        if (!isMyTurn()) return;
        if (!canPlayOnTop(top.rank)) return;
        selectedIds.clear();
        cards.forEach(c => selectedIds.add(c.id));
        render();
      };

      handStacks.appendChild(stack);
    });
  }

  /* ---------- TABLE ---------- */
  yourTable.innerHTML = "";
  tableTitle.style.display = me && me.hand.length === 0 ? "block" : "none";
}

/* =========================================================
   EVENTS
========================================================= */
enterBtn.onclick = () => {
  const name = nameInput.value.trim();
  if (!name) return;
  localStorage.setItem("splash_name", name);
  setLobbyStatus("Connecting…", false);
  connect(name);
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
  if (!res.ok) logLine("Only host can start the game.");
};

playBtn.onclick = () => {
  if (!selectedIds.size) return;
  const res = tryPlaySelected([...selectedIds]);
  if (!res.ok) logLine("Invalid play.");
  clearSelection();
};

pickupBtn.onclick = () => {
  const res = pickupPile();
  if (!res.ok) logLine("Cannot pick up now.");
};

clearSelBtn.onclick = clearSelection;

themeSelectLobby.onchange = () => applyTheme(themeSelectLobby.value);
themeSelectGame.onchange = () => applyTheme(themeSelectGame.value);

/* =========================================================
   APP EVENTS
========================================================= */
subscribe((evt)=>{
  if (evt.type === "conn") {
    setLobbyStatus(
      evt.status === "open" ? "Connected" : "Disconnected",
      evt.status === "open"
    );
  }
  render();
});

/* =========================================================
   INIT
========================================================= */
(function init(){
  applyTheme(localStorage.getItem("splash_theme") || "purple");
  nameInput.value = localStorage.getItem("splash_name") || "";
  setLobbyStatus("Not connected", false);
  showLobby();
})();
