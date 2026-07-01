// Public read-only lineup endpoints used by the analytics dashboard to show
// starting XIs / bench for one or many matches.

const { sendJson } = require("../lib/http");
const { getLineup, getLineupsForMatches } = require("../../db/queries");

// GET /api/lineup?matchId=N — a single match's lineup payload.
function handleGetLineup(req, res) {
  const id = Number(new URL(req.url, "http://x").searchParams.get("matchId"));
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { error: "Invalid matchId" });
    return;
  }
  try {
    const data = getLineup(id);
    if (!data) {
      sendJson(res, 404, { error: "No lineup for this match" });
      return;
    }
    sendJson(res, 200, data);
  } catch (err) {
    console.error("Lineup error:", err);
    sendJson(res, 500, { error: "Failed to load lineup." });
  }
}

// GET /api/lineups?matchIds=1,2,3 — batched lineup lookup.
function handleGetLineups(req, res) {
  const raw = new URL(req.url, "http://x").searchParams.get("matchIds") || "";
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  try {
    sendJson(res, 200, getLineupsForMatches(ids));
  } catch (err) {
    console.error("Lineups error:", err);
    sendJson(res, 500, { error: "Failed to load lineups." });
  }
}

module.exports = { handleGetLineup, handleGetLineups };
