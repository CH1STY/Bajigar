// Shared, reusable database queries (keeps command files DRY).

const db = require("./database");

// Ensure a user row exists before we attach predictions/points to it.
const ensureUserStmt = db.prepare(
  "INSERT OR IGNORE INTO users (discord_id, global_points) VALUES (?, 0)",
);

const getTournamentStmt = db.prepare("SELECT * FROM tournaments WHERE id = ?");
const getTournamentByChannelStmt = db.prepare(
  "SELECT * FROM tournaments WHERE channel_id = ?",
);
const getMatchStmt = db.prepare("SELECT * FROM matches WHERE id = ?");

// All matches belonging to a tournament.
const getTournamentMatchesStmt = db.prepare(
  "SELECT * FROM matches WHERE tournament_id = ?",
);
// One user's prediction for a single match.
const getPredictionStmt = db.prepare(
  "SELECT * FROM predictions WHERE match_id = ? AND discord_id = ?",
);
// Every prediction for a match (best scorers first, then earliest predicted).
const getMatchPredictionsStmt = db.prepare(`
  SELECT discord_id, predicted_value, points_earned, updated_at
  FROM predictions
  WHERE match_id = ?
  ORDER BY points_earned DESC, updated_at ASC
`);
// A single user's prediction history with each match's details.
const getUserPredictionsStmt = db.prepare(`
  SELECT p.predicted_value, p.points_earned, p.updated_at,
         m.id AS match_id, m.type, m.team_a, m.team_b,
         m.status, m.result, m.start_time, m.end_time,
         t.name AS tournament_name
  FROM predictions p
  JOIN matches m ON m.id = p.match_id
  LEFT JOIN tournaments t ON t.id = m.tournament_id
  WHERE p.discord_id = ?
  ORDER BY m.end_time DESC
`);
// Prediction counts per match for a tournament.
const getPredictionCountsStmt = db.prepare(`
  SELECT p.match_id AS match_id, COUNT(*) AS cnt
  FROM predictions p
  JOIN matches m ON m.id = p.match_id
  WHERE m.tournament_id = ?
  GROUP BY p.match_id
`);
// Upsert a prediction while recording when it changed.
const upsertPredictionStmt = db.prepare(`
  INSERT INTO predictions (match_id, discord_id, predicted_value, points_earned, updated_at)
  VALUES (?, ?, ?, 0, ?)
  ON CONFLICT(match_id, discord_id)
  DO UPDATE SET predicted_value = excluded.predicted_value,
                points_earned = 0,
                updated_at = excluded.updated_at
`);
const setDashboardMessageIdStmt = db.prepare(
  "UPDATE tournaments SET dashboard_message_id = ? WHERE id = ?",
);

/** Make sure a user exists in the users table. */
function ensureUser(discordId) {
  ensureUserStmt.run(discordId);
}

/** @returns {object|undefined} tournament row */
function getTournament(id) {
  return getTournamentStmt.get(id);
}

/** @returns {object|undefined} tournament row linked to a Discord channel */
function getTournamentByChannel(channelId) {
  return getTournamentByChannelStmt.get(channelId);
}

/** @returns {object|undefined} match row */
function getMatch(id) {
  return getMatchStmt.get(id);
}

/** @returns {object[]} every match in a tournament */
function getTournamentMatches(tournamentId) {
  return getTournamentMatchesStmt.all(tournamentId);
}

/** @returns {object|undefined} a user's prediction for one match */
function getPrediction(matchId, discordId) {
  return getPredictionStmt.get(matchId, discordId);
}

/** @returns {object[]} every prediction for a match (ranked) */
function getMatchPredictions(matchId) {
  return getMatchPredictionsStmt.all(matchId);
}

/** @returns {object[]} a user's predictions with match details (newest first) */
function getUserPredictions(discordId) {
  return getUserPredictionsStmt.all(discordId);
}

/** @returns {Map<number, number>} match_id -> number of predictions */
function getPredictionCounts(tournamentId) {
  const map = new Map();
  for (const row of getPredictionCountsStmt.all(tournamentId)) {
    map.set(row.match_id, row.cnt);
  }
  return map;
}

/**
 * Create or update a user's prediction (resets points until re-resolved).
 * Records the change time so the dashboard can show "last predicted".
 */
function upsertPrediction(matchId, discordId, predictedValue) {
  ensureUser(discordId);
  upsertPredictionStmt.run(matchId, discordId, predictedValue, Date.now());
}

/** Remember which message holds a tournament's live table. */
function setDashboardMessageId(tournamentId, messageId) {
  setDashboardMessageIdStmt.run(messageId, tournamentId);
}

// Matches whose deadline is within the lead window and not yet announced.
const matchesNeedingReminderStmt = db.prepare(`
  SELECT m.*, t.name AS tournament_name, t.channel_id AS tournament_channel_id
  FROM matches m
  LEFT JOIN tournaments t ON t.id = m.tournament_id
  WHERE m.status = 'open' AND m.reminded = 0
    AND m.end_time > ? AND m.end_time <= ?
  ORDER BY m.end_time ASC
`);
const markRemindedStmt = db.prepare(
  "UPDATE matches SET reminded = 1 WHERE id = ?",
);

/**
 * @param {number} leadMs how far ahead of the deadline to alert (e.g. 30 min)
 * @returns {object[]} matches closing within the window, with tournament info
 */
function getMatchesNeedingReminder(leadMs) {
  const now = Date.now();
  return matchesNeedingReminderStmt.all(now, now + leadMs);
}

/** Mark a match's closing-soon alert as sent. */
function markReminded(matchId) {
  markRemindedStmt.run(matchId);
}

// Matches that are now open for predictions but whose "predictions open"
// announcement hasn't been posted yet (covers both manager-created matches
// that open immediately and scheduled matches whose start_time has arrived).
const matchesNeedingStartAnnouncementStmt = db.prepare(`
  SELECT m.*, t.name AS tournament_name, t.channel_id AS tournament_channel_id
  FROM matches m
  LEFT JOIN tournaments t ON t.id = m.tournament_id
  WHERE m.status = 'open' AND m.start_announced = 0
    AND (m.start_time IS NULL OR m.start_time <= ?)
    AND m.end_time > ?
  ORDER BY m.start_time ASC
`);
const markStartAnnouncedStmt = db.prepare(
  "UPDATE matches SET start_announced = 1 WHERE id = ?",
);

/** @returns {object[]} matches that just opened and need a start announcement */
function getMatchesNeedingStartAnnouncement() {
  const now = Date.now();
  return matchesNeedingStartAnnouncementStmt.all(now, now);
}

/** Mark a match's "predictions open" alert as sent. */
function markStartAnnounced(matchId) {
  markStartAnnouncedStmt.run(matchId);
}

/**
 * Classify a match's prediction window.
 * @param {object} match
 * @returns {'missing'|'resolved'|'locked'|'pending'|'ended'|'open'}
 */
function predictionState(match) {
  if (!match) return "missing";
  if (match.status === "resolved") return "resolved";
  if (match.status !== "open") return "locked";
  const now = Date.now();
  if (match.start_time && now < match.start_time) return "pending";
  if (now >= match.end_time) return "ended";
  return "open";
}

/**
 * Determine whether a match is currently accepting predictions.
 * Open when status === 'open', the start time (if any) has passed, and the
 * deadline hasn't.
 * @param {object} match
 * @returns {boolean}
 */
function isMatchOpenForPredictions(match) {
  return predictionState(match) === "open";
}

/**
 * Run a function inside a single SQLite transaction.
 * Commits on success, rolls back if the callback throws.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

module.exports = {
  db,
  ensureUser,
  getTournament,
  getTournamentByChannel,
  getMatch,
  getTournamentMatches,
  getPrediction,
  getMatchPredictions,
  getPredictionCounts,
  upsertPrediction,
  setDashboardMessageId,
  getMatchesNeedingReminder,
  markReminded,
  getMatchesNeedingStartAnnouncement,
  markStartAnnounced,
  isMatchOpenForPredictions,
  predictionState,
  transaction,
  getUserPredictions,
};
