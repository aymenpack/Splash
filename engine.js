// SPLASH core game engine
// Pure, deterministic rules and turn management. No DOM or network here.

export const PLAYER_TYPE = {
  HUMAN: "human",
  AI: "ai",
};

export const ZONE = {
  HAND: "hand",
  FACE_UP: "faceUp",
  FACE_DOWN: "faceDown",
};

export const ACTION_TYPES = {
  PLAY_CARDS: "playCards",
  PLAY_FACE_DOWN: "playFaceDown",
  PICK_UP: "pickup",
};

export const CARD_RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

export const CARD_SUITS = ["♠", "♥", "♦", "♣"];

const RANK_ORDER = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  JOKER: 15,
};

// Scoring values (penalty points for remaining cards at end of round)
export function scoreCard(card) {
  if (card.rank === "JOKER") return 50;
  if (card.rank === "10") return 20;
  if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
  if (card.rank === "A") return 1; // Assumption: Ace scores 1 point
  return parseInt(card.rank, 10) || 0;
}

export function scoreRemainingCards(state) {
  const scores = state.players.map((p) => {
    const all = [...p.hand, ...p.faceUp, ...p.faceDown];
    return all.reduce((sum, c) => sum + scoreCard(c), 0);
  });
  return scores;
}

// Deterministic PRNG (LCG) with string seed
export function createPrng(seedString) {
  const seed =
    typeof seedString === "string" && seedString.length
      ? hashString(seedString)
      : hashString(String(Date.now()));

  let state = seed >>> 0;

  function nextInt32() {
    // Numerical Recipes LCG
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  }

  return {
    next() {
      return nextInt32() / 0xffffffff;
    },
    nextInt(max) {
      if (!Number.isFinite(max) || max <= 0) throw new Error("Invalid max");
      return nextInt32() % max;
    },
    getState() {
      return state >>> 0;
    },
  };
}

function hashString(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createDeck(numDecks, prng) {
  const deck = [];
  let idCounter = 0;

  for (let d = 0; d < numDecks; d++) {
    for (const suit of CARD_SUITS) {
      for (const rank of CARD_RANKS) {
        deck.push({
          id: `D${d}-${rank}${suit}-${idCounter++}`,
          rank,
          suit,
          type: "standard",
        });
      }
    }
    // Two jokers per deck
    for (let j = 0; j < 2; j++) {
      deck.push({
        id: `D${d}-JOKER-${j}-${idCounter++}`,
        rank: "JOKER",
        suit: "★",
        type: "joker",
      });
    }
  }

  shuffleInPlace(deck, prng);
  return deck;
}

function shuffleInPlace(array, prng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = prng.nextInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export function createInitialState(config) {
  const {
    numPlayers,
    players,
    seed,
    maxFaceDown = 4,
    maxFaceUp = 4,
    handSize = 11,
  } = config;

  if (!Number.isInteger(numPlayers) || numPlayers < 1 || numPlayers > 5) {
    throw new Error("numPlayers must be between 1 and 5");
  }

  const prng = createPrng(seed);

  const cardsPerPlayer = maxFaceDown + maxFaceUp + handSize;
  const minCardsNeeded = numPlayers * cardsPerPlayer + 1; // +1 for starting pile card
  const singleDeckSize = 52 + 2; // standard deck + 2 jokers
  const numDecks = Math.max(1, Math.ceil(minCardsNeeded / singleDeckSize));

  const deck = createDeck(numDecks, prng);

  if (deck.length < minCardsNeeded) {
    throw new Error("Not enough cards to start game with given configuration");
  }

  const playerStates = [];

  for (let i = 0; i < numPlayers; i++) {
    const info = players?.[i] || {};
    const faceDown = deck.splice(0, maxFaceDown);
    const faceUp = deck.splice(0, maxFaceUp);
    const hand = deck.splice(0, handSize);

    playerStates.push({
      id: i,
      name: info.name || `Player ${i + 1}`,
      type: info.type || PLAYER_TYPE.HUMAN,
      hand,
      faceUp,
      faceDown,
      isFinished: false,
    });
  }

  // Starting card for pile
  const startCard = deck.shift();
  const pile = [startCard];

  const state = {
    config: {
      numPlayers,
      players: playerStates.map((p) => ({ name: p.name, type: p.type })),
      seed,
      maxFaceDown,
      maxFaceUp,
      handSize,
      numDecks,
    },
    rngState: prng.getState(),
    players: playerStates,
    pile,
    stock: deck, // unused for now, but kept for future variants
    currentPlayerIndex: 0,
    phase: "playing", // "playing" | "finished"
    winnerIndex: null,
    scores: null,
    log: [],
  };

  logLine(
    state,
    `Game started with ${numPlayers} player(s), ${numDecks} deck(s), seed=${seed ||
      "auto"}.`,
  );
  logLine(
    state,
    `Starting pile card is ${describeCard(startCard)} (player 1 to act).`,
  );

  return state;
}

export function cloneState(state) {
  // Simple explicit clone to avoid relying on structuredClone
  return JSON.parse(JSON.stringify(state));
}

export function hasAnyCards(player) {
  return (
    player.hand.length > 0 ||
    player.faceUp.length > 0 ||
    player.faceDown.length > 0
  );
}

export function getPlayerStage(player) {
  if (player.hand.length > 0) return ZONE.HAND;
  if (player.faceUp.length > 0) return ZONE.FACE_UP;
  if (player.faceDown.length > 0) return ZONE.FACE_DOWN;
  return null;
}

export function getTopCard(state) {
  if (!state.pile.length) return null;
  return state.pile[state.pile.length - 1];
}

export function isCardPlayableOnTop(card, topCard) {
  // After a clear, pile is empty and any card is allowed.
  if (!topCard) return true;

  // 10s and Jokers may always be played
  if (card.rank === "10" || card.rank === "JOKER") return true;

  const topRank = topCard.rank;

  // If top card is a 10 or Joker, it still counts as its rank for comparison
  // (they do not automatically unlock "any" — only clears do that).
  const playedVal = RANK_ORDER[card.rank];
  const topVal = RANK_ORDER[topRank];

  return playedVal <= topVal;
}

export function getLegalActions(state, playerIndex) {
  if (state.phase !== "playing") return [];
  const player = state.players[playerIndex];
  if (!player || player.isFinished) return [];

  const stage = getPlayerStage(player);
  const topCard = getTopCard(state);

  const actions = [];

  if (!stage) {
    // No cards: nothing to do
    return actions;
  }

  if (stage === ZONE.FACE_DOWN) {
    // Blind play: any face-down index is a legal attempt
    for (let i = 0; i < player.faceDown.length; i++) {
      actions.push({
        type: ACTION_TYPES.PLAY_FACE_DOWN,
        playerIndex,
        index: i,
      });
    }
    return actions;
  }

  const zoneCards = stage === ZONE.HAND ? player.hand : player.faceUp;

  // Group cards by rank to form allowed stacks
  const byRank = new Map();
  for (const card of zoneCards) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card);
  }

  for (const [rank, cards] of byRank.entries()) {
    // We allow playing 1..N of this rank as long as that rank is legal on the pile.
    const sampleCard = cards[0];
    if (!isCardPlayableOnTop(sampleCard, topCard)) continue;

    for (let count = 1; count <= cards.length; count++) {
      const subset = cards.slice(0, count);
      actions.push({
        type: ACTION_TYPES.PLAY_CARDS,
        playerIndex,
        zone: stage,
        cardIds: subset.map((c) => c.id),
      });
    }
  }

  if (!actions.length && state.pile.length > 0) {
    // No legal plays -> must pick up
    actions.push({
      type: ACTION_TYPES.PICK_UP,
      playerIndex,
    });
  }

  return actions;
}

export function applyAction(state, action) {
  if (state.phase !== "playing") {
    throw new Error("Game already finished");
  }
  if (action.playerIndex !== state.currentPlayerIndex) {
    throw new Error("Not this player's turn");
  }

  const player = state.players[action.playerIndex];
  if (!player || player.isFinished) {
    throw new Error("Invalid player");
  }

  const stage = getPlayerStage(player);

  if (!stage) {
    throw new Error("Player has no cards to play");
  }

  switch (action.type) {
    case ACTION_TYPES.PLAY_CARDS:
      return applyPlayCards(state, player, stage, action);
    case ACTION_TYPES.PLAY_FACE_DOWN:
      return applyPlayFaceDown(state, player, stage, action);
    case ACTION_TYPES.PICK_UP:
      return applyPickup(state, player, stage, action);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

function applyPlayCards(state, player, stage, action) {
  if (stage === ZONE.FACE_DOWN) {
    throw new Error("Must use PLAY_FACE_DOWN for face-down cards");
  }

  if (!Array.isArray(action.cardIds) || !action.cardIds.length) {
    throw new Error("cardIds required");
  }

  if (action.zone !== stage) {
    throw new Error("Must play from current zone");
  }

  const source =
    stage === ZONE.HAND ? player.hand : player.faceUp;

  const selected = [];
  for (const id of action.cardIds) {
    const idx = source.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error("Card not found in zone");
    selected.push(source[idx]);
  }

  // All selected cards must share the same rank
  const rank = selected[0].rank;
  if (!selected.every((c) => c.rank === rank)) {
    throw new Error("All played cards must share the same rank");
  }

  const top = getTopCard(state);
  if (!isCardPlayableOnTop(selected[0], top)) {
    throw new Error("Illegal play on current pile");
  }

  // Move selected cards from zone to pile
  for (const card of selected) {
    const idx = source.findIndex((c) => c.id === card.id);
    if (idx !== -1) source.splice(idx, 1);
    state.pile.push(card);
  }

  const cleared = didPlayClearPile(selected, rank);

  logLine(
    state,
    `${player.name} plays ${describeCards(selected)}${cleared ? " and clears the pile" : ""
    }.`,
  );

  if (cleared) {
    state.pile = [];
    // Same player goes again if they still have cards
    maybeFinishOrAdvance(state, player, { samePlayer: true });
  } else {
    maybeFinishOrAdvance(state, player, { samePlayer: false });
  }
}

function applyPlayFaceDown(state, player, stage, action) {
  if (stage !== ZONE.FACE_DOWN) {
    throw new Error("Cannot play face-down until hand and face-up are empty");
  }

  const idx = action.index;
  if (
    !Number.isInteger(idx) ||
    idx < 0 ||
    idx >= player.faceDown.length
  ) {
    throw new Error("Invalid face-down index");
  }

  const card = player.faceDown.splice(idx, 1)[0];
  const top = getTopCard(state);

  const legal = isCardPlayableOnTop(card, top);

  state.pile.push(card);

  if (!legal) {
    // Illegal blind play -> pick up entire pile (including this card)
    logLine(
      state,
      `${player.name} blindly reveals ${describeCard(card)} (illegal) and picks up the pile.`,
    );
    player.hand.push(...state.pile);
    state.pile = [];
    maybeFinishOrAdvance(state, player, { samePlayer: false });
    return;
  }

  const cleared = didPlayClearPile([card], card.rank);

  logLine(
    state,
    `${player.name} blindly reveals ${describeCard(card)}${cleared ? " and clears the pile" : ""
    }.`,
  );

  if (cleared) {
    state.pile = [];
    maybeFinishOrAdvance(state, player, { samePlayer: true });
  } else {
    maybeFinishOrAdvance(state, player, { samePlayer: false });
  }
}

function applyPickup(state, player, stage) {
  if (state.pile.length === 0) {
    throw new Error("Cannot pick up from an empty pile");
  }

  if (stage === ZONE.FACE_DOWN) {
    throw new Error("Face-down stage must reveal a card instead of manual pickup");
  }

  // Only allowed when there are no legal plays
  const legal = getLegalActions(state, player.id).filter(
    (a) => a.type !== ACTION_TYPES.PICK_UP,
  );
  if (legal.length > 0) {
    throw new Error("Pickup not allowed when a legal play exists");
  }

  logLine(
    state,
    `${player.name} cannot play and picks up ${state.pile.length} card(s) from the pile.`,
  );

  player.hand.push(...state.pile);
  state.pile = [];

  maybeFinishOrAdvance(state, player, { samePlayer: false });
}

function didPlayClearPile(cardsPlayed, rank) {
  if (rank === "10" || rank === "JOKER") return true;
  return cardsPlayed.length >= 3;
}

function maybeFinishOrAdvance(state, player, opts) {
  if (!hasAnyCards(player)) {
    // This player has emptied all zones and wins immediately
    state.phase = "finished";
    state.winnerIndex = player.id;
    state.scores = scoreRemainingCards(state);
    logLine(
      state,
      `${player.name} has played all cards and wins the round.`,
    );
    return;
  }

  if (opts.samePlayer) {
    state.currentPlayerIndex = player.id;
    return;
  }

  const n = state.players.length;
  let idx = player.id;
  for (let step = 1; step <= n; step++) {
    idx = (idx + 1) % n;
    const p = state.players[idx];
    if (!p.isFinished && hasAnyCards(p)) {
      state.currentPlayerIndex = idx;
      return;
    }
  }

  // Fallback: everyone else is out of cards; treat current player as winner
  state.phase = "finished";
  state.winnerIndex = player.id;
  state.scores = scoreRemainingCards(state);
}

export function describeCard(card) {
  if (card.rank === "JOKER") return "Joker";
  return `${card.rank}${card.suit}`;
}

export function describeCards(cards) {
  return cards.map(describeCard).join(", ");
}

function logLine(state, text) {
  state.log.push(text);
  if (state.log.length > 500) state.log.shift();
}

export function getPublicView(state) {
  const pileTop = getTopCard(state);

  return {
    config: state.config,
    phase: state.phase,
    winnerIndex: state.winnerIndex,
    scores: state.scores,
    currentPlayerIndex: state.currentPlayerIndex,
    pile: {
      size: state.pile.length,
      topCard: pileTop ? { rank: pileTop.rank, suit: pileTop.suit } : null,
    },
    players: state.players.map((p, idx) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      isFinished: p.isFinished || !hasAnyCards(p),
      totalCards: p.hand.length + p.faceUp.length + p.faceDown.length,
      handCount: p.hand.length,
      faceUp: p.faceUp.slice(),
      faceDownCount: p.faceDown.length,
      stage: getPlayerStage(p),
      isCurrent: idx === state.currentPlayerIndex,
    })),
    log: state.log.slice().reverse(), // newest first for UI
  };
}

