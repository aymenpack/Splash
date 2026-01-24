import {
  ACTION_TYPES,
  PLAYER_TYPE,
  ZONE,
  createPrng,
  createInitialState,
  getPlayerStage,
  getPublicView,
  applyAction,
} from "./engine.js";
import { chooseAiAction } from "./ai.js";
import { createUi } from "./ui.js";

class GameController {
  constructor() {
    this.state = null;
    this.prng = null;
    this.ui = null;
    this.lastError = null;
  }

  attachUi(ui) {
    this.ui = ui;
    this.render();
  }

  startNewGame(options) {
    const name = (options.name || "You").trim() || "You";
    const totalPlayers = clampInt(options.playerCount, 1, 5);
    const seed = options.seed && options.seed.trim().length ? options.seed.trim() : null;

    const players = [];
    for (let i = 0; i < totalPlayers; i++) {
      if (i === 0) {
        players.push({ name, type: PLAYER_TYPE.HUMAN });
      } else {
        players.push({ name: `AI ${i + 1}`, type: PLAYER_TYPE.AI });
      }
    }

    this.prng = createPrng(seed || `${Date.now()}`);
    this.state = createInitialState({
      numPlayers: totalPlayers,
      players,
      seed: seed || null,
    });

    this.lastError = null;
    this.runAiIfNeeded();
    this.render();
  }

  handleHumanPlaySelected(zone, cardIds) {
    if (!this.state) {
      this.setError("No active game.");
      return;
    }

    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.type !== PLAYER_TYPE.HUMAN) {
      this.setError("It is not your turn.");
      return;
    }

    const stage = getPlayerStage(current);
    if (!stage) {
      this.setError("You have no cards to play.");
      return;
    }

    if (stage === ZONE.FACE_DOWN) {
      this.setError("You must click a face-down card to play.");
      return;
    }

    if (!cardIds || !cardIds.length) {
      this.setError("Select at least one card.");
      return;
    }

    if (zone !== stage) {
      this.setError("You must play from your current zone.");
      return;
    }

    try {
      applyAction(this.state, {
        type: ACTION_TYPES.PLAY_CARDS,
        playerIndex: current.id,
        zone,
        cardIds,
      });
      this.lastError = null;
      this.runAiIfNeeded();
    } catch (e) {
      this.setError(e?.message || "Illegal move.");
    }

    this.render();
  }

  handleHumanFaceDown(index) {
    if (!this.state) {
      this.setError("No active game.");
      this.render();
      return;
    }

    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.type !== PLAYER_TYPE.HUMAN) {
      this.setError("It is not your turn.");
      this.render();
      return;
    }

    const stage = getPlayerStage(current);
    if (stage !== ZONE.FACE_DOWN) {
      this.setError("You can only play a face-down card after using all other cards.");
      this.render();
      return;
    }

    try {
      applyAction(this.state, {
        type: ACTION_TYPES.PLAY_FACE_DOWN,
        playerIndex: current.id,
        index,
      });
      this.lastError = null;
      this.runAiIfNeeded();
    } catch (e) {
      this.setError(e?.message || "Illegal move.");
    }

    this.render();
  }

  handleHumanPickup() {
    if (!this.state) {
      this.setError("No active game.");
      this.render();
      return;
    }

    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.type !== PLAYER_TYPE.HUMAN) {
      this.setError("It is not your turn.");
      this.render();
      return;
    }

    const stage = getPlayerStage(current);
    if (stage === ZONE.FACE_DOWN) {
      this.setError("You must reveal a face-down card instead of picking up.");
      this.render();
      return;
    }

    try {
      applyAction(this.state, {
        type: ACTION_TYPES.PICK_UP,
        playerIndex: current.id,
      });
      this.lastError = null;
      this.runAiIfNeeded();
    } catch (e) {
      this.setError(e?.message || "Pickup not allowed.");
    }

    this.render();
  }

  stopGame() {
    this.state = null;
    this.prng = null;
    this.lastError = null;
    this.render();
  }

  runAiIfNeeded() {
    if (!this.state) return;
    let guard = 50;
    while (this.state.phase === "playing" && guard-- > 0) {
      const current = this.state.players[this.state.currentPlayerIndex];
      if (!current || current.type !== PLAYER_TYPE.AI) break;

      const action = chooseAiAction(this.state, current.id, this.prng);
      applyAction(this.state, action);
    }
  }

  setError(msg) {
    this.lastError = msg;
  }

  buildView() {
    if (!this.state) {
      return {
        hasGame: false,
        error: this.lastError,
      };
    }

    const base = getPublicView(this.state);
    const hero = this.state.players[0];

    return {
      hasGame: true,
      error: this.lastError,
      phase: base.phase,
      winnerIndex: base.winnerIndex,
      scores: base.scores,
      currentPlayerIndex: base.currentPlayerIndex,
      pile: base.pile,
      players: base.players,
      hero: {
        id: hero.id,
        name: hero.name,
        type: hero.type,
        hand: hero.hand.slice(),
        faceUp: hero.faceUp.slice(),
        faceDownCount: hero.faceDown.length,
        stage: getPlayerStage(hero),
      },
      log: base.log,
    };
  }

  render() {
    if (!this.ui) return;
    const view = this.buildView();
    this.ui.render(view);
  }
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Bootstrapping
const controller = new GameController();
const ui = createUi(controller);
controller.attachUi(ui);

