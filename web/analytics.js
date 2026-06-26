// Read-only analytics over the SQLite database for the web dashboard.
//
// IMPORTANT PRIVACY RULE:
//   Individual predicted values are HIDDEN while a match is still open for
//   predictions (predictionState === "open" or "pending"). Those rows are
//   never included in any per-prediction breakdown — only aggregate counts
//   (which are already public in Discord) ever reflect still-open matches.

const fs = require("fs");
const path = require("path");
const db = require("../db/queries").db;
const { predictionState } = require("../db/queries");
const { parseFootballScore } = require("../utils/scoring");
const { WEB_DEFAULT_TOURNAMENT, SCORING } = require("../config/config");

// --- World Cup team grouping (web UI only; no DB involvement) ----------------
// Tournaments whose name contains "world cup" show their League Table split into
// Group A/B/C… instead of one big table. The team→group mapping lives in a
// separate JSON file so the database is untouched.

function loadGroupConfig() {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, "..", "config", "world-cup-groups.json"),
      "utf8",
    );
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const GROUP_CONFIG = loadGroupConfig();

/**
 * Resolve the group definition for a tournament, if any.
 * Only applies to tournaments whose name contains "world cup" AND have an entry
 * (matched case-insensitively by exact name) in world-cup-groups.json.
 * @param {string} tournamentName
 * @returns {{ order: string[], teamGroup: Map<string,string> } | null}
 */
function getTournamentGroups(tournamentName) {
  if (!tournamentName || !tournamentName.toLowerCase().includes("world cup")) {
    return null;
  }
  const key = Object.keys(GROUP_CONFIG).find(
    (k) => k.toLowerCase() === tournamentName.toLowerCase(),
  );
  if (!key) return null;
  const groups = GROUP_CONFIG[key];
  if (!groups || typeof groups !== "object") return null;

  const order = Object.keys(groups).filter((g) => Array.isArray(groups[g]));
  const teamGroup = new Map();
  for (const label of order) {
    for (const team of groups[label]) {
      teamGroup.set(String(team).trim().toLowerCase(), label);
    }
  }
  return order.length ? { order, teamGroup } : null;
}

/**
 * Attach grouping metadata to a tournament block so the web UI can split the
 * League Table by group. Mutates the block in place.
 *   block.grouped    = true
 *   block.groups     = ordered group labels (e.g. ["A","B",…])
 *   block.teamGroups = { lowercased team name: group label }
 * @param {object} block
 * @param {{ order: string[], teamGroup: Map<string,string> }} groups
 */
function annotateGroups(block, groups) {
  block.grouped = true;
  block.groups = groups.order.slice();
  block.teamGroups = Object.fromEntries(groups.teamGroup);
}

// --- Raw fetch helpers ------------------------------------------------------

const allMatchesStmt = db.prepare(`
  SELECT m.*, t.name AS tournament_name
  FROM matches m
  LEFT JOIN tournaments t ON t.id = m.tournament_id
`);

const allPredictionsStmt = db.prepare(`
  SELECT p.match_id, p.discord_id, p.predicted_value, p.tiebreaker_value, p.points_earned, p.updated_at
  FROM predictions p
`);

const allUsersStmt = db.prepare("SELECT discord_id, global_points FROM users");

const allTournamentsStmt = db.prepare(
  "SELECT id, name, status FROM tournaments ORDER BY id ASC",
);

/**
 * A prediction's value is revealable once the prediction window has closed.
 * Open (still accepting picks) and pending (not yet open) matches stay hidden.
 * @param {object} match
 * @returns {boolean}
 */
function predictionsRevealed(match) {
  const state = predictionState(match);
  return (
    state === "closed" ||
    state === "locked" ||
    state === "ended" ||
    state === "resolved"
  );
}

/** @returns {string[]} every discord_id that appears in the data set */
function getDistinctUserIds() {
  const ids = new Set();
  for (const u of allUsersStmt.all()) ids.add(u.discord_id);
  for (const p of allPredictionsStmt.all()) ids.add(p.discord_id);
  return [...ids];
}

/** Total absolute goal difference between a predicted and actual football score. */
function totalGoalDiff(predicted, result) {
  const p = parseFootballScore(predicted);
  const r = parseFootballScore(result);
  if (!p || !r) return null;
  return Math.abs(p.a - r.a) + Math.abs(p.b - r.b);
}

function outcomeOf(score) {
  const s = parseFootballScore(score);
  if (!s) return null;
  if (s.a > s.b) return "home";
  if (s.a < s.b) return "away";
  return "draw";
}

/**
 * Compute the full analytics block for a given set of matches.
 * Used both for the global Overview (all matches) and for each tournament
 * (its matches only), so both views present exactly the same data shapes.
 * Player points are summed from points_earned within this match set.
 *
 * @param {object[]} matches
 * @param {object[]} allPredictions - every prediction row (filtered internally)
 * @param {(id: string) => string} name
 * @returns {object}
 */
function computeBlock(matches, allPredictions, name) {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const predictions = allPredictions.filter((p) => matchById.has(p.match_id));

  const resolvedMatches = matches.filter((m) => m.status === "resolved");
  const openMatches = matches.filter((m) => predictionState(m) === "open");
  const footballMatches = matches.filter((m) => m.type === "football");
  const cricketMatches = matches.filter((m) => m.type === "cricket");

  // Only revealable predictions feed the value-level analytics.
  const revealed = predictions.filter((p) => {
    const m = matchById.get(p.match_id);
    return m && predictionsRevealed(m);
  });

  const playerIds = new Set(predictions.map((p) => p.discord_id));

  const overview = {
    totalMatches: matches.length,
    resolvedMatches: resolvedMatches.length,
    openMatches: openMatches.length,
    footballMatches: footballMatches.length,
    cricketMatches: cricketMatches.length,
    totalPredictions: predictions.length,
    revealedPredictions: revealed.length,
    hiddenPredictions: predictions.length - revealed.length,
    totalPlayers: playerIds.size,
    avgPredictionsPerMatch: matches.length
      ? +(predictions.length / matches.length).toFixed(2)
      : 0,
  };

  // ---- Prediction volume per match (trend over time) ----
  const countByMatch = new Map();
  for (const p of predictions) {
    countByMatch.set(p.match_id, (countByMatch.get(p.match_id) || 0) + 1);
  }
  const predictionVolume = matches
    .filter((m) => countByMatch.has(m.id))
    .sort((a, b) => (a.end_time || 0) - (b.end_time || 0))
    .map((m) => ({
      matchId: m.id,
      matchNumber: m.match_number,
      label: `#${m.match_number ?? m.id} ${m.team_a} v ${m.team_b}`,
      type: m.type,
      count: countByMatch.get(m.id) || 0,
      endTime: m.end_time,
    }));

  // ---- Football outcome breakdown (revealed + resolved only) ----
  const breakdown = { exact: 0, near: 0, outcomeOnly: 0, miss: 0 };
  const scorelineCounts = new Map();
  for (const p of revealed) {
    const m = matchById.get(p.match_id);
    if (!m || m.type !== "football") continue;
    const canonical = parseFootballScore(p.predicted_value);
    if (canonical) {
      const key = `${canonical.a}-${canonical.b}`;
      scorelineCounts.set(key, (scorelineCounts.get(key) || 0) + 1);
    }
    if (m.status !== "resolved" || !m.result) continue;
    const diff = totalGoalDiff(p.predicted_value, m.result);
    if (diff === null) continue;
    const sameOutcome = outcomeOf(p.predicted_value) === outcomeOf(m.result);
    if (diff === 0) breakdown.exact += 1;
    else if (diff === 1) breakdown.near += 1;
    else if (sameOutcome) breakdown.outcomeOnly += 1;
    else breakdown.miss += 1;
  }

  const predictedScorelines = [...scorelineCounts.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // ---- Per-player football accuracy (avg goal difference) ----
  const perPlayer = new Map(); // id -> { diffs:[], near:0, exact:0, preds:[] }
  for (const p of revealed) {
    const m = matchById.get(p.match_id);
    if (!m || m.type !== "football" || m.status !== "resolved" || !m.result) {
      continue;
    }
    const diff = totalGoalDiff(p.predicted_value, m.result);
    if (diff === null) continue;
    if (!perPlayer.has(p.discord_id)) {
      perPlayer.set(p.discord_id, { diffs: [], near: 0, exact: 0, preds: [] });
    }
    const rec = perPlayer.get(p.discord_id);
    rec.diffs.push(diff);
    if (diff === 0) rec.exact += 1;
    if (diff === 1) rec.near += 1;
    rec.preds.push({
      matchId: m.id,
      label: `#${m.match_number ?? m.id} ${m.team_a} v ${m.team_b}`,
      predicted: p.predicted_value,
      result: m.result,
      diff,
      points: +p.points_earned,
    });
  }

  const avgGoalDiff = [...perPlayer.entries()]
    .map(([id, rec]) => ({
      id,
      name: name(id),
      games: rec.diffs.length,
      avgDiff: +(
        rec.diffs.reduce((s, d) => s + d, 0) / rec.diffs.length
      ).toFixed(2),
      exact: rec.exact,
      near: rec.near,
      preds: rec.preds,
    }))
    .filter((r) => r.games > 0)
    .sort((a, b) => a.avgDiff - b.avgDiff);

  const bestPredictor = avgGoalDiff[0] || null;
  const worstPredictor =
    avgGoalDiff.length > 1 ? avgGoalDiff[avgGoalDiff.length - 1] : null;

  // ---- Near-miss leaders (diff === 1) ----
  const nearMisses = avgGoalDiff
    .filter((r) => r.near > 0)
    .map((r) => ({ id: r.id, name: r.name, count: r.near }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ---- Per-player points & standings (points summed within this set) ----
  const pointsById = new Map();
  const predsById = new Map();
  const correctById = new Map(); // cricket correct picks (resolved)
  for (const p of predictions) {
    pointsById.set(
      p.discord_id,
      (pointsById.get(p.discord_id) || 0) + +p.points_earned,
    );
    predsById.set(p.discord_id, (predsById.get(p.discord_id) || 0) + 1);
    const m = matchById.get(p.match_id);
    if (
      m &&
      m.type === "cricket" &&
      m.status === "resolved" &&
      m.result &&
      String(p.predicted_value).trim().toLowerCase() ===
        String(m.result).trim().toLowerCase()
    ) {
      correctById.set(p.discord_id, (correctById.get(p.discord_id) || 0) + 1);
    }
  }

  const players = [...playerIds]
    .map((id) => {
      const rec = perPlayer.get(id);
      const exact = rec ? rec.exact : 0;
      const correct = correctById.get(id) || 0;
      return {
        id,
        name: name(id),
        points: +(pointsById.get(id) || 0).toFixed(2),
        predictions: predsById.get(id) || 0,
        gradedGames: rec ? rec.diffs.length : 0,
        avgDiff: rec
          ? +(rec.diffs.reduce((s, d) => s + d, 0) / rec.diffs.length).toFixed(
              2,
            )
          : null,
        exact,
        near: rec ? rec.near : 0,
        correct,
        hits: exact + correct,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.hits - a.hits ||
        a.predictions - b.predictions ||
        a.name.localeCompare(b.name),
    )
    .map((r, i) => ({ rank: i + 1, ...r }));

  const topScorers = players
    .filter((p) => p.points > 0)
    .slice(0, 15)
    .map((p) => ({ id: p.id, name: p.name, points: p.points }));

  const leader = players[0] || null;

  // ---- Per-match explorer (list + per-match predictions / results / analysis) ----
  const predsByMatch = new Map();
  for (const p of predictions) {
    if (!predsByMatch.has(p.match_id)) predsByMatch.set(p.match_id, []);
    predsByMatch.get(p.match_id).push(p);
  }

  const matchList = [...matches]
    .sort((a, b) => (b.end_time || 0) - (a.end_time || 0) || b.id - a.id)
    .map((m) => {
      const mPreds = predsByMatch.get(m.id) || [];
      const revealedNow = predictionsRevealed(m);
      const state = predictionState(m);
      const isFootball = m.type === "football";

      // Per-prediction rows are only exposed once the match has closed.
      let predRows = [];
      if (revealedNow) {
        predRows = mPreds
          .map((p) => {
            const row = {
              id: p.discord_id,
              name: name(p.discord_id),
              value: p.predicted_value,
              tiebreaker: p.tiebreaker_value || null,
              points: +p.points_earned,
              correct: null,
            };
            if (m.status === "resolved" && m.result) {
              if (isFootball) {
                const diff = totalGoalDiff(p.predicted_value, m.result);
                row.diff = diff;
                row.correct = diff === 0;
                row.outcomeHit =
                  outcomeOf(p.predicted_value) === outcomeOf(m.result);
              } else {
                row.correct =
                  String(p.predicted_value).trim().toLowerCase() ===
                  String(m.result).trim().toLowerCase();
              }
            }
            return row;
          })
          .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      }

      // Pick distribution (revealed only): scoreline for football, team for cricket.
      const distMap = new Map();
      if (revealedNow) {
        for (const p of mPreds) {
          let key = null;
          if (isFootball) {
            const c = parseFootballScore(p.predicted_value);
            if (c) key = `${c.a}-${c.b}`;
          } else {
            key = String(p.predicted_value).trim();
          }
          if (key) distMap.set(key, (distMap.get(key) || 0) + 1);
        }
      }
      const distribution = [...distMap.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      return {
        id: m.id,
        matchNumber: m.match_number,
        type: m.type,
        teamA: m.team_a,
        teamB: m.team_b,
        status: m.status,
        result: m.result || null,
        isKnockout: !!m.is_knockout,
        tiebreakerResult: m.tiebreaker_result || null,
        startTime: m.start_time || null,
        endTime: m.end_time || null,
        state,
        revealed: revealedNow,
        predictionCount: mPreds.length,
        predictions: predRows,
        distribution,
      };
    });

  return {
    overview,
    topScorers,
    predictionVolume,
    outcomeBreakdown: breakdown,
    predictedScorelines,
    avgGoalDiff: avgGoalDiff.map(({ preds, ...rest }) => rest),
    bestPredictor,
    worstPredictor,
    nearMisses,
    players,
    leader,
    matchList,
  };
}

/**
 * Build the full analytics payload (global Overview + per-tournament blocks).
 * @param {(id: string) => string} nameOf - resolves a discord_id to a display name
 * @returns {object} JSON-serialisable analytics
 */
function buildAnalytics(nameOf) {
  const matches = allMatchesStmt.all();
  const predictions = allPredictionsStmt.all();

  const name = (id) => {
    try {
      return nameOf ? nameOf(id) : id;
    } catch {
      return id;
    }
  };

  const global = computeBlock(matches, predictions, name);

  // ---- Per-tournament blocks (same shape as the global block) ----
  const tournaments = allTournamentsStmt.all().map((t) => {
    const tMatches = matches.filter((m) => m.tournament_id === t.id);
    const block = computeBlock(tMatches, predictions, name);
    const groups = getTournamentGroups(t.name);
    if (groups) annotateGroups(block, groups);
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      ...block,
    };
  });

  // Resolve the configured default tournament (by id or case-insensitive name).
  const wanted = WEB_DEFAULT_TOURNAMENT
    ? String(WEB_DEFAULT_TOURNAMENT).trim().toLowerCase()
    : null;
  const defaultMatch = wanted
    ? tournaments.find(
        (t) => String(t.id) === wanted || t.name.toLowerCase() === wanted,
      )
    : null;
  const defaultTournamentId = defaultMatch
    ? defaultMatch.id
    : (tournaments[0]?.id ?? null);

  return {
    generatedAt: Date.now(),
    scoring: SCORING,
    ...global,
    tournaments,
    defaultTournamentId,
  };
}

module.exports = { buildAnalytics, getDistinctUserIds };
