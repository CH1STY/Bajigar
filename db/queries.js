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

/**
 * Determine whether a match is currently accepting predictions.
 * A match is open when status === 'open' AND the deadline hasn't passed.
 * @param {object} match
 * @returns {boolean}
 */
function isMatchOpenForPredictions(match) {
  if (!match) return false;
  if (match.status !== "open") return false;
  return Date.now() < match.end_time;
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
  getMatchesNeedingReminder,
  markReminded,
  isMatchOpenForPredictions,
  transaction,
};
