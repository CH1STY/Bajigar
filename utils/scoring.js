// Prediction validation & scoring logic.

const { SCORING } = require("../config/config");

/**
 * Parse a football score string of the form "X-Y" into numbers.
 * @param {string} value
 * @returns {{ a: number, b: number }|null}
 */
function parseFootballScore(value) {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(value);
  if (!match) return null;
  return { a: Number(match[1]), b: Number(match[2]) };
}

/**
 * Normalize a score back to canonical "X-Y" form (or null if invalid).
 * @param {string} value
 */
function normalizeFootballScore(value) {
  const parsed = parseFootballScore(value);
  return parsed ? `${parsed.a}-${parsed.b}` : null;
}

/**
 * Determine the outcome of a parsed score: home win, away win, or draw.
 * @param {{ a: number, b: number }} score
 * @returns {'home'|'away'|'draw'}
 */
function footballOutcome({ a, b }) {
  if (a > b) return "home";
  if (a < b) return "away";
  return "draw";
}

/**
 * Score a football prediction against the actual result.
 * Rewards stack:
 *  - Correct winner/draw  -> SCORING.football.outcome
 *  - Exact score          -> SCORING.football.exact (added on top of outcome)
 *  - Total goal diff = 1   -> SCORING.football.near (added on top of outcome)
 *  - Otherwise            -> 0
 *
 * @param {string} predicted "X-Y"
 * @param {string} result    "X-Y"
 * @returns {number}
 */
function scoreFootball(predicted, result) {
  const p = parseFootballScore(predicted);
  const r = parseFootballScore(result);
  if (!p || !r) return 0;

  let points = 0;
  if (footballOutcome(p) === footballOutcome(r)) {
    points += SCORING.football.outcome;
  }

  const totalDiff = Math.abs(p.a - r.a) + Math.abs(p.b - r.b);
  if (totalDiff === 0) {
    points += SCORING.football.exact;
  } else if (totalDiff === 1) {
    points += SCORING.football.near;
  }

  return points;
}

/**
 * Score a cricket prediction (correct winning team).
 * @param {string} predicted team name
 * @param {string} result    winning team name
 * @returns {number}
 */
function scoreCricket(predicted, result) {
  if (typeof predicted !== "string" || typeof result !== "string") return 0;
  return predicted.trim().toLowerCase() === result.trim().toLowerCase()
    ? SCORING.cricket.correct
    : 0;
}

module.exports = {
  parseFootballScore,
  normalizeFootballScore,
  scoreFootball,
  scoreCricket,
};
