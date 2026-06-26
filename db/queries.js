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
  SELECT discord_id, predicted_value, tiebreaker_value, points_earned, updated_at
  FROM predictions
  WHERE match_id = ?
  ORDER BY points_earned DESC, updated_at ASC
`);
// A single user's prediction history with each match's details.
const getUserPredictionsStmt = db.prepare(`
  SELECT p.predicted_value, p.tiebreaker_value, p.points_earned, p.updated_at,
         m.id AS match_id, m.match_number, m.type, m.team_a, m.team_b,
         m.status, m.result, m.is_knockout, m.tiebreaker_result,
         m.start_time, m.end_time,
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
  INSERT INTO predictions (match_id, discord_id, predicted_value, tiebreaker_value, points_earned, updated_at)
  VALUES (?, ?, ?, ?, 0, ?)
  ON CONFLICT(match_id, discord_id)
  DO UPDATE SET predicted_value = excluded.predicted_value,
                tiebreaker_value = excluded.tiebreaker_value,
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

// --- Team name maintenance --------------------------------------------------
// Team names are plain strings stored on each match (team_a / team_b) and, for
// cricket, also in matches.result (winner) and predictions.predicted_value
// (predicted winner). Renaming a team therefore updates all of those places so
// spelling variants can be merged into one canonical name. Matching is
// case-insensitive so "brazil"/"Brazil" collapse together. Scope is a single
// number group: a tournament id, or NULL for the standalone group.
const distinctTeamsStmt = db.prepare(`
  SELECT team AS team FROM (
    SELECT team_a AS team FROM matches WHERE tournament_id IS ?
    UNION
    SELECT team_b AS team FROM matches WHERE tournament_id IS ?
  )
  ORDER BY team COLLATE NOCASE ASC
`);
const renameTeamAStmt = db.prepare(
  "UPDATE matches SET team_a = ? WHERE tournament_id IS ? AND team_a = ? COLLATE NOCASE",
);
const renameTeamBStmt = db.prepare(
  "UPDATE matches SET team_b = ? WHERE tournament_id IS ? AND team_b = ? COLLATE NOCASE",
);
const renameCricketResultStmt = db.prepare(
  "UPDATE matches SET result = ? WHERE tournament_id IS ? AND type = 'cricket' AND result = ? COLLATE NOCASE",
);
const renameCricketPredictionStmt = db.prepare(`
  UPDATE predictions
  SET predicted_value = ?
  WHERE predicted_value = ? COLLATE NOCASE
    AND match_id IN (
      SELECT id FROM matches WHERE type = 'cricket' AND tournament_id IS ?
    )
`);

/**
 * @param {number|null} tournamentId - tournament id, or null for the standalone group
 * @returns {string[]} distinct team names used in that group (case-insensitive sort)
 */
function getTeamsInTournament(tournamentId) {
  const tid = tournamentId ?? null;
  return distinctTeamsStmt.all(tid, tid).map((r) => r.team);
}

/**
 * Rename (and thereby merge) a team within a single tournament / standalone group.
 * Updates match line-ups plus cricket results and cricket predicted winners.
 * Runs in one transaction.
 * @param {number|null} tournamentId - tournament id, or null for the standalone group
 * @param {string} fromName - the (mis-spelled) name to replace, matched case-insensitively
 * @param {string} toName - the canonical name to use
 * @returns {{ teamA:number, teamB:number, results:number, predictions:number, total:number }}
 */
function renameTeamInTournament(tournamentId, fromName, toName) {
  const tid = tournamentId ?? null;
  const from = fromName.trim();
  const to = toName.trim();
  return transaction(() => {
    const teamA = renameTeamAStmt.run(to, tid, from).changes;
    const teamB = renameTeamBStmt.run(to, tid, from).changes;
    const results = renameCricketResultStmt.run(to, tid, from).changes;
    const predictions = renameCricketPredictionStmt.run(to, from, tid).changes;
    return {
      teamA,
      teamB,
      results,
      predictions,
      total: teamA + teamB + results + predictions,
    };
  });
}

// --- Per-tournament match numbers -------------------------------------------
// Matches are shown and addressed by a per-tournament sequence number rather
// than the internal auto-increment id. Standalone matches (tournament_id IS
// NULL) share their own number group.
const getMatchByNumberStmt = db.prepare(
  "SELECT * FROM matches WHERE tournament_id = ? AND match_number = ?",
);
const getStandaloneMatchByNumberStmt = db.prepare(
  "SELECT * FROM matches WHERE tournament_id IS NULL AND match_number = ?",
);
const usedNumbersTournamentStmt = db.prepare(
  "SELECT match_number FROM matches WHERE tournament_id = ? AND match_number IS NOT NULL",
);
const usedNumbersStandaloneStmt = db.prepare(
  "SELECT match_number FROM matches WHERE tournament_id IS NULL AND match_number IS NOT NULL",
);

/** @returns {object|undefined} match by its per-tournament number */
function getMatchByNumber(tournamentId, matchNumber) {
  return tournamentId == null
    ? getStandaloneMatchByNumberStmt.get(matchNumber)
    : getMatchByNumberStmt.get(tournamentId, matchNumber);
}

/** @returns {number[]} match numbers already used within a number group */
function getUsedMatchNumbers(tournamentId) {
  const rows =
    tournamentId == null
      ? usedNumbersStandaloneStmt.all()
      : usedNumbersTournamentStmt.all(tournamentId);
  return rows.map((r) => r.match_number);
}

/** @returns {number} the next free match number for a number group */
function nextMatchNumber(tournamentId) {
  const used = getUsedMatchNumbers(tournamentId);
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * Resolve a match from a per-tournament number within a tournament context.
 * The context is taken from an explicit tournament id when provided, otherwise
 * from the tournament linked to the given channel.
 * @param {{ number:number, channelId?:string|null, tournamentId?:number|null }} opts
 * @returns {{ match?:object, tournament?:object|null, error?:string }}
 */
function resolveMatchByNumber({ number, channelId, tournamentId }) {
  let tournament = null;
  if (tournamentId != null) {
    tournament = getTournament(tournamentId) ?? null;
    if (!tournament) {
      return { error: `No tournament found with ID \`${tournamentId}\`.` };
    }
  } else if (channelId) {
    tournament = getTournamentByChannel(channelId) ?? null;
  }
  const match = getMatchByNumber(tournament ? tournament.id : null, number);
  if (!match) {
    const where = tournament
      ? `**${tournament.name}**`
      : "the standalone matches";
    return {
      tournament,
      error: `No match **#${number}** found in ${where}.`,
    };
  }
  return { match, tournament };
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
 * @param {number} matchId
 * @param {string} discordId
 * @param {string} predictedValue regular-time score / winning team
 * @param {string|null} [tiebreakerValue] knockout tie-breaker score, if any
 */
function upsertPrediction(
  matchId,
  discordId,
  predictedValue,
  tiebreakerValue = null,
) {
  ensureUser(discordId);
  upsertPredictionStmt.run(
    matchId,
    discordId,
    predictedValue,
    tiebreakerValue ?? null,
    Date.now(),
  );
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

// Update match start and/or end times
const updateMatchTimesStmt = db.prepare(`
  UPDATE matches
  SET start_time = ?, end_time = ?
  WHERE id = ?
`);

/**
 * Update a match's start and end times. Both values are written directly,
 * so the caller must pass the desired final values (use the existing value
 * for any field that should stay unchanged).
 * @param {number} matchId
 * @param {number|null} newStartTime - epoch ms, or null to open immediately
 * @param {number} newEndTime - epoch ms deadline
 */
function updateMatchTimes(matchId, newStartTime, newEndTime) {
  updateMatchTimesStmt.run(newStartTime, newEndTime, matchId);
}

// Toggle a match's knockout flag (football only). Clearing it also drops any
// recorded tie-breaker result so the data stays consistent.
const setMatchKnockoutStmt = db.prepare(`
  UPDATE matches
  SET is_knockout = ?, tiebreaker_result = CASE WHEN ? = 1 THEN tiebreaker_result ELSE NULL END
  WHERE id = ?
`);

/**
 * Enable or disable the knockout flag on an existing match.
 * @param {number} matchId
 * @param {boolean} isKnockout
 */
function setMatchKnockout(matchId, isKnockout) {
  const flag = isKnockout ? 1 : 0;
  setMatchKnockoutStmt.run(flag, flag, matchId);
}

// ---- Player Analysis (lineups) -------------------------------------------
const upsertLineupStmt = db.prepare(`
  INSERT INTO match_lineups (match_id, data, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(match_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
const getLineupStmt = db.prepare(
  "SELECT data FROM match_lineups WHERE match_id = ?",
);
const deleteLineupStmt = db.prepare(
  "DELETE FROM match_lineups WHERE match_id = ?",
);

/**
 * Insert or replace the Player-Analysis JSON for a match.
 * @param {number} matchId
 * @param {object} data - lineup/stats object (serialised to JSON)
 */
function upsertLineup(matchId, data) {
  upsertLineupStmt.run(matchId, JSON.stringify(data), Date.now());
}

/**
 * Fetch the parsed Player-Analysis object for a match, or null when none.
 * @param {number} matchId
 * @returns {object | null}
 */
function getLineup(matchId) {
  const row = getLineupStmt.get(matchId);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Remove the Player-Analysis data for a match.
 * @param {number} matchId
 * @returns {boolean} true when a row was deleted
 */
function deleteLineup(matchId) {
  return deleteLineupStmt.run(matchId).changes > 0;
}

/**
 * Fetch parsed Player-Analysis objects for several matches at once.
 * @param {number[]} ids - match ids
 * @returns {Object<string, object>} map of matchId → parsed lineup data
 */
function getLineupsForMatches(ids) {
  const list = (ids || [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) return {};
  const placeholders = list.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT match_id, data FROM match_lineups WHERE match_id IN (${placeholders})`,
    )
    .all(...list);
  const out = {};
  for (const r of rows) {
    try {
      out[r.match_id] = JSON.parse(r.data);
    } catch {
      /* skip malformed rows */
    }
  }
  return out;
}

module.exports = {
  db,
  ensureUser,
  getTournament,
  getTournamentByChannel,
  getMatch,
  getTournamentMatches,
  getTeamsInTournament,
  renameTeamInTournament,
  getMatchByNumber,
  getUsedMatchNumbers,
  nextMatchNumber,
  resolveMatchByNumber,
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
  updateMatchTimes,
  setMatchKnockout,
  upsertLineup,
  getLineup,
  deleteLineup,
  getLineupsForMatches,
};
