import { ZONE } from "./engine.js";

export function createUi(controller) {
  const $ = (id) => document.getElementById(id);

  // DOM references
  const lobbyView = $("lobbyView");
  const gameView = $("gameView");

  const nameInput = $("nameInput");
  const enterBtn = $("enterBtn");
  const resetNameBtn = $("resetNameBtn");
  const lobbyStatus = $("lobbyStatus");
  const themeSelectLobby = $("themeSelectLobby");
  const playerCountSelect = $("playerCountSelect");
  const seedInput = $("seedInput");

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
  const logDrawer = $("logDrawer");
  const toggleLogBtn = $("toggleLogBtn");
  const closeLogBtn = $("closeLogBtn");

  const THEMES = ["purple", "ocean", "emerald", "desert"];

  let selectedIds = new Set();
  let selectedZone = null; // "hand" | "faceUp" | null

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : "purple";
    document.body.classList.remove(...THEMES.map((x) => "theme-" + x));
    document.body.classList.add("theme-" + t);
    localStorage.setItem("splash_theme", t);
    themeSelectLobby.value = t;
    themeSelectGame.value = t;
  }

  function showLobby() {
    lobbyView.style.display = "flex";
    gameView.style.display = "none";
  }

  function showGame() {
    lobbyView.style.display = "none";
    gameView.style.display = "flex";
  }

  function setLobbyStatus(text, ok = false) {
    lobbyStatus.textContent = text;
    lobbyStatus.style.borderColor = ok
      ? "rgba(126,231,135,.6)"
      : "rgba(255,255,255,.2)";
  }

  function logLine(text) {
    const div = document.createElement("div");
    div.className = "logLine";
    const ts = new Date().toLocaleTimeString();
    div.innerHTML = `<span class="muted">[${ts}]</span> ${text}`;
    logEl.prepend(div);
  }

  function clearSelection() {
    selectedIds.clear();
    selectedZone = null;
  }

  function render(view) {
    // No active game yet -> lobby / idle state
    if (!view.hasGame) {
      turnInfo.textContent = "Turn: —";
      turnHint.textContent = "Configure a game in the lobby.";

      handStacks.innerHTML = `
        <div class="muted" style="padding:18px;text-align:center;">
          No active game. Start one from the lobby.
        </div>
      `;

      playersRow.innerHTML = "";
      pileVisual.innerHTML = "";
      yourTable.innerHTML = "";

      deckCount.textContent = "—";
      discardCount.textContent = "—";
      pileCount.textContent = "—";
      topValue.textContent = "—";

      playBtn.disabled = true;
      pickupBtn.disabled = true;
      newGameBtn.disabled = false;

      if (view.error) {
        setLobbyStatus(view.error, false);
      } else {
        setLobbyStatus("Configure a game and press Start", false);
      }

      return;
    }

    const { hero, players, pile, phase, winnerIndex, scores, currentPlayerIndex } = view;

    showGame();

    // Header / turn info
    const current = players.find((p) => p.id === currentPlayerIndex);
    turnInfo.textContent = current
      ? `Turn: ${current.name}`
      : "Turn: —";

    if (phase === "finished" && typeof winnerIndex === "number") {
      const winner = players[winnerIndex];
      const winnerName = winner ? winner.name : `Player ${winnerIndex + 1}`;
      turnHint.textContent = `🏁 ${winnerName} wins. Lower scores are better.`;
    } else if (hero.id === currentPlayerIndex) {
      turnHint.textContent = "👉 Your turn";
    } else {
      turnHint.textContent = "Waiting for opponents…";
    }

    // Counters
    deckCount.textContent = "—"; // stock currently unused in engine view
    discardCount.textContent = "—";
    pileCount.textContent = pile.size;
    topValue.textContent = pile.topCard
      ? `${pile.topCard.rank}${pile.topCard.suit}`
      : "ANY";

    // Buttons
    const isHeroTurn = hero.id === currentPlayerIndex && phase === "playing";
    const inFaceDownStage = hero.stage === ZONE.FACE_DOWN;

    playBtn.disabled = !(
      isHeroTurn &&
      !inFaceDownStage &&
      selectedIds.size > 0
    );

    pickupBtn.disabled = !(
      isHeroTurn &&
      !inFaceDownStage &&
      pile.size > 0
    );

    newGameBtn.disabled = false;

    // Players row
    playersRow.innerHTML = "";
    players.forEach((p, idx) => {
      const d = document.createElement("div");
      d.className =
        "playerChip" + (idx === currentPlayerIndex ? " active" : "");

      const isHero = p.id === hero.id;
      const labelHand = isHero ? hero.hand.length : p.handCount;

      d.innerHTML = `
        <div class="avatar">${isHero ? "🙂" : "🤖"}<span class="seat">${p.id + 1}</span></div>
        <div class="playerMeta">
          <div class="playerName">${p.name}</div>
          <div class="playerCounts">
            Hand: ${labelHand} · Table: ${p.faceUp.length} · Face-down: ${p.faceDownCount}
          </div>
        </div>
      `;
      playersRow.appendChild(d);
    });

    // Pile visuals (up to last 5 cards)
    pileVisual.innerHTML = "";
    const maxVisible = 5;
    const pileCardsForUi = view._pileCards || []; // optional internal hook, usually empty
    const cardsToShow =
      pileCardsForUi.length > 0
        ? pileCardsForUi.slice(-maxVisible)
        : [];

    cardsToShow.forEach((c, i) => {
      const d = document.createElement("div");
      d.className = "c";
      d.style.position = "absolute";
      d.style.left = "50%";
      d.style.top = `${12 + i * 4}px`;
      d.style.transform = `translateX(-50%) rotate(${i * 4 - 8}deg)`;
      d.innerHTML = `
        <div class="corner top">${c.rank}<br>${c.suit}</div>
        <div class="pip">${c.suit}</div>
        <div class="corner bottom">${c.rank}<br>${c.suit}</div>
      `;
      pileVisual.appendChild(d);
    });

    // Hero hand
    handStacks.innerHTML = "";
    if (hero.hand.length) {
      const byRank = {};
      hero.hand.forEach((c) => {
        (byRank[c.rank] ??= []).push(c);
      });

      Object.values(byRank).forEach((cards) => {
        const top = cards[cards.length - 1];
        const stack = document.createElement("div");
        stack.className = "cardStack";

        const card = document.createElement("div");
        const isSelected = cards.every((c) => selectedIds.has(c.id));
        card.className = "c" + (isSelected ? " selected" : "");
        card.innerHTML = `
          <div class="corner top">${top.rank}<br>${top.suit}</div>
          <div class="pip">${top.suit}</div>
          <div class="corner bottom">${top.rank}<br>${top.suit}</div>
        `;
        stack.appendChild(card);

        const badge = document.createElement("div");
        badge.className = "badgeCount";
        badge.textContent = `x${cards.length}`;
        stack.appendChild(badge);

        stack.onclick = () => {
          if (!isHeroTurn || inFaceDownStage) return;
          clearSelection();
          cards.forEach((c) => selectedIds.add(c.id));
          selectedZone = "hand";
          render(view);
        };

        handStacks.appendChild(stack);
      });
    } else {
      handStacks.innerHTML = `
        <div class="muted" style="padding:18px;text-align:center;">
          Your hand is empty. Use your face-up cards next.
        </div>
      `;
    }

    // Hero table (face-up or face-down depending on stage)
    yourTable.innerHTML = "";
    tableTitle.style.display = "block";

    if (hero.stage === ZONE.FACE_UP || hero.stage === ZONE.HAND) {
      // Show face-up cards; only clickable when stage is FACE_UP
      if (!hero.faceUp.length) {
        yourTable.innerHTML = `
          <div class="muted" style="padding:10px;text-align:center;">
            No face-up cards available.
          </div>
        `;
      } else {
        hero.faceUp.forEach((cardObj) => {
          const card = document.createElement("div");
          const isSelected = selectedIds.has(cardObj.id);
          card.className = "c" + (isSelected ? " selected" : "");
          card.innerHTML = `
            <div class="corner top">${cardObj.rank}<br>${cardObj.suit}</div>
            <div class="pip">${cardObj.suit}</div>
            <div class="corner bottom">${cardObj.rank}<br>${cardObj.suit}</div>
          `;

          card.onclick = () => {
            if (!isHeroTurn || hero.stage !== ZONE.FACE_UP) return;
            clearSelection();
            hero.faceUp
              .filter((c) => c.rank === cardObj.rank)
              .forEach((c) => selectedIds.add(c.id));
            selectedZone = "faceUp";
            render(view);
          };

          yourTable.appendChild(card);
        });
      }
    } else if (hero.stage === ZONE.FACE_DOWN) {
      // Show facedown placeholders; clicking reveals via controller
      if (!hero.faceDownCount) {
        yourTable.innerHTML = `
          <div class="muted" style="padding:10px;text-align:center;">
            No face-down cards remaining.
          </div>
        `;
      } else {
        for (let i = 0; i < hero.faceDownCount; i++) {
          const back = document.createElement("div");
          back.className = "c";
          back.style.background =
            "linear-gradient(135deg, #312e81, #1f2937)";
          back.style.color = "#e5e7eb";
          back.innerHTML = `
            <div class="corner top">?</div>
            <div class="pip">🃏</div>
            <div class="corner bottom">?</div>
          `;

          back.onclick = () => {
            if (!isHeroTurn) return;
            controller.handleHumanFaceDown(i);
          };

          yourTable.appendChild(back);
        }
      }
    }

    // Scores in log area if finished
    if (phase === "finished" && Array.isArray(scores)) {
      logLine(
        "Round scores: " +
          players
            .map((p, idx) => `${p.name}: ${scores[idx]} pts`)
            .join(" · "),
      );
    }

    // Error surface
    if (view.error) {
      setLobbyStatus(view.error, false);
    } else {
      setLobbyStatus("In game", true);
    }
  }

  // Events
  enterBtn.onclick = () => {
    const name = nameInput.value.trim() || "You";
    const playerCount = playerCountSelect.value;
    const seed = seedInput.value.trim();

    localStorage.setItem("splash_name", name);
    setLobbyStatus("Starting local game…", true);
    controller.startNewGame({ name, playerCount, seed });
    showGame();
  };

  resetNameBtn.onclick = () => {
    localStorage.removeItem("splash_name");
    nameInput.value = "";
  };

  leaveBtn.onclick = () => {
    controller.stopGame();
    clearSelection();
    showLobby();
    setLobbyStatus("Configure a game and press Start", false);
  };

  newGameBtn.onclick = () => {
    const name = nameInput.value.trim() || "You";
    const playerCount = playerCountSelect.value;
    const seed = seedInput.value.trim();
    controller.startNewGame({ name, playerCount, seed });
  };

  playBtn.onclick = () => {
    if (!selectedIds.size || !selectedZone) return;
    controller.handleHumanPlaySelected(selectedZone, [...selectedIds]);
    clearSelection();
  };

  pickupBtn.onclick = () => {
    controller.handleHumanPickup();
    clearSelection();
  };

  clearSelBtn.onclick = () => {
    clearSelection();
    // A lightweight re-render from controller will be triggered
    controller.render?.();
  };

  themeSelectLobby.onchange = () => applyTheme(themeSelectLobby.value);
  themeSelectGame.onchange = () => applyTheme(themeSelectGame.value);

  toggleLogBtn.onclick = () => {
    logDrawer.classList.toggle("open");
  };

  closeLogBtn.onclick = () => {
    logDrawer.classList.remove("open");
  };

  // Init
  (function init() {
    applyTheme(localStorage.getItem("splash_theme") || "purple");
    nameInput.value = localStorage.getItem("splash_name") || "";
    setLobbyStatus("Configure a game and press Start", false);
    showLobby();
  })();

  return {
    render,
  };
}

