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
 * Normalize a tie-breaker (penalty shootout) score. Like a football score but
 * a tie-breaker MUST have a winner, so a draw (e.g. "3-3") is rejected.
 * @param {string} value
 * @returns {string|null} canonical "X-Y" with a winner, or null if invalid/draw
 */
function normalizeTiebreakerScore(value) {
  const parsed = parseFootballScore(value);
  if (!parsed || parsed.a === parsed.b) return null;
  return `${parsed.a}-${parsed.b}`;
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
 * Score a knockout tie-breaker (penalty shootout) prediction. This is a BONUS
 * that stacks on top of the regular-time football score and is only ever
 * awarded when the match actually went to a tie-breaker.
 *  - Correct tie-breaker winner -> SCORING.football.tiebreakerWinner
 *  - Exact tie-breaker score    -> SCORING.football.tiebreakerExact (added on top)
 *
 * @param {string} predicted "X-Y" predicted tie-breaker score
 * @param {string} result    "X-Y" actual tie-breaker score
 * @returns {number}
 */
function scoreTiebreaker(predicted, result) {
  const p = parseFootballScore(predicted);
  const r = parseFootballScore(result);
  if (!p || !r) return 0;

  let points = 0;
  if (footballOutcome(p) === footballOutcome(r)) {
    points += SCORING.football.tiebreakerWinner;
  }
  if (p.a === r.a && p.b === r.b) {
    points += SCORING.football.tiebreakerExact;
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
  normalizeTiebreakerScore,
  scoreFootball,
  scoreTiebreaker,
  scoreCricket,
};
