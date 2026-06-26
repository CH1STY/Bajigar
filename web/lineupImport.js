// Shared validation + import logic for Player-Analysis lineup JSON.
// Used by the admin web upload page (web/server.js) and the import-lineups
// script. Accepts the same JSON shapes the old /lineup-add command did.
//
// Accepted JSON shapes (a single match, or many at once):
//   { "matchId": 12, "home": {…}, "away": {…}, "teamStats": {…} }
//   [ { "matchId": 12, … }, { "matchId": 13, … } ]
//   { "lineups": [ { "matchId": 12, … }, … ] }

const { getMatch } = require("../db/queries");

const MAX_MATCHES = 50;

/** Pull the array of lineup objects out of any accepted JSON shape. */
function extractLineups(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.lineups)) return parsed.lineups;
  if (parsed && typeof parsed === "object") return [parsed];
  return null;
}

/** Validate one team block (home/away). */
function validateTeam(side, t) {
  if (t == null) return null;
  if (typeof t !== "object" || Array.isArray(t)) {
    return `${side} must be an object`;
  }
  if (t.starters != null && !Array.isArray(t.starters)) {
    return `${side}.starters must be an array`;
  }
  if (t.bench != null && !Array.isArray(t.bench)) {
    return `${side}.bench must be an array`;
  }
  return null;
}

/**
 * Validate one lineup entry.
 * @returns {{ ok: true, value: { matchId, match, data } } | { ok: false, error: string }}
 */
function validateLineup(raw, fallbackMatchId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "not an object" };
  }
  const idSource = raw.matchId ?? raw.match_id ?? fallbackMatchId;
  const matchId = Number(idSource);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return {
      ok: false,
      error: 'missing/invalid "matchId" (the DB id shown as "id N")',
    };
  }
  const match = getMatch(matchId);
  if (!match) {
    return { ok: false, error: `no match with id ${matchId} exists` };
  }
  if (raw.home == null && raw.away == null) {
    return { ok: false, error: "needs at least one of home/away" };
  }
  for (const side of ["home", "away"]) {
    const err = validateTeam(side, raw[side]);
    if (err) return { ok: false, error: err };
  }
  if (
    raw.teamStats != null &&
    (typeof raw.teamStats !== "object" || Array.isArray(raw.teamStats))
  ) {
    return { ok: false, error: "teamStats must be an object" };
  }
  // Normalise the stored id so the API/import stay consistent.
  const data = { ...raw, matchId };
  return { ok: true, value: { matchId, match, data } };
}

/**
 * Validate a parsed JSON payload of one or more lineups.
 * Strips helper keys, enforces the per-import cap and rejects duplicates.
 * @returns {{ ok: true, valid: Array<{matchId, match, data}> } |
 *           { ok: false, errors: string[] }}
 */
function validatePayload(parsed, fallbackMatchId = null) {
  const list = extractLineups(parsed);
  if (!list) {
    return {
      ok: false,
      errors: [
        'JSON must be a lineup object, an array of them, or { "lineups": [ … ] }.',
      ],
    };
  }
  if (list.length === 0) {
    return { ok: false, errors: ["No lineups found in the JSON."] };
  }
  if (list.length > MAX_MATCHES) {
    return {
      ok: false,
      errors: [
        `Too many entries (${list.length}). The limit is ${MAX_MATCHES} per upload.`,
      ],
    };
  }

  const fallbackId = list.length === 1 ? fallbackMatchId : null;
  const valid = [];
  const errors = [];
  const seen = new Set();
  list.forEach((raw, i) => {
    const result = validateLineup(raw, fallbackId);
    if (!result.ok) {
      errors.push(`Entry #${i + 1}: ${result.error}`);
      return;
    }
    if (seen.has(result.value.matchId)) {
      errors.push(
        `Entry #${i + 1}: duplicate matchId ${result.value.matchId} in this payload`,
      );
      return;
    }
    seen.add(result.value.matchId);
    valid.push(result.value);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, valid };
}

module.exports = {
  MAX_MATCHES,
  extractLineups,
  validateTeam,
  validateLineup,
  validatePayload,
};
