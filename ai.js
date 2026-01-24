// Basic strategic AI for SPLASH.
// Prefers plays that clear the pile and shed high-point cards.

import {
  ACTION_TYPES,
  ZONE,
  getLegalActions,
  scoreCard,
} from "./engine.js";

export function chooseAiAction(state, playerIndex, prngLike) {
  const legal = getLegalActions(state, playerIndex);
  if (!legal.length) {
    throw new Error("AI has no legal actions");
  }

  // If we're in face-down stage, just pick a random face-down index.
  const anyFaceDown = legal.find((a) => a.type === ACTION_TYPES.PLAY_FACE_DOWN);
  if (anyFaceDown) {
    if (prngLike && typeof prngLike.nextInt === "function") {
      const choices = legal.filter((a) => a.type === ACTION_TYPES.PLAY_FACE_DOWN);
      return choices[prngLike.nextInt(choices.length)];
    }
    return anyFaceDown;
  }

  // If only pickup is legal, do it.
  const nonPickup = legal.filter((a) => a.type !== ACTION_TYPES.PICK_UP);
  if (!nonPickup.length) {
    return legal[0];
  }

  // Score each play.
  const scored = nonPickup.map((action) => {
    const score = evaluatePlayAction(state, action);
    return { action, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Break ties deterministically if we have prng, otherwise pick first.
  const bestScore = scored[0].score;
  const best = scored.filter((x) => x.score === bestScore);
  if (best.length === 1 || !prngLike || typeof prngLike.nextInt !== "function") {
    return best[0].action;
  }
  return best[prngLike.nextInt(best.length)].action;
}

function evaluatePlayAction(state, action) {
  if (action.type !== ACTION_TYPES.PLAY_CARDS) {
    return 0;
  }

  const player = state.players[action.playerIndex];
  const zoneCards = action.zone === ZONE.HAND ? player.hand : player.faceUp;
  const playedCards = action.cardIds.map((id) =>
    zoneCards.find((c) => c.id === id),
  );

  const rank = playedCards[0]?.rank;
  const clears =
    rank === "10" ||
    rank === "JOKER" ||
    playedCards.length >= 3;

  const totalPoints = playedCards.reduce(
    (sum, c) => sum + scoreCard(c),
    0,
  );

  // Heuristics:
  // - Strongly prefer clearing the pile, especially when it's large.
  // - Otherwise, prefer dumping more total points (high-value cards).
  const pileSize = state.pile.length;

  let value = 0;
  if (clears) {
    value += 1000 + pileSize * 50;
  }

  value += totalPoints * 5;

  // Prefer using hard-to-play high ranks when pile top is high.
  const top = state.pile[state.pile.length - 1];
  if (top && rank && top.rank !== "10" && top.rank !== "JOKER") {
    const hardPlayBonus = rankValue(rank) >= rankValue(top.rank) ? 20 : 0;
    value += hardPlayBonus;
  }

  // Slightly prefer larger combinations (2 or 3 cards vs 1).
  value += playedCards.length * 10;

  return value;
}

function rankValue(rank) {
  const order = {
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
  return order[rank] ?? 0;
}

