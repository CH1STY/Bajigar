// Analytics JSON endpoints. Each section serves one lightweight slice of a
// computed scope block so the dashboard can lazy-load per panel.

const { sendJson } = require("../lib/http");
const {
  parseScope,
  getScopeBlock,
  lightMatch,
  bucketOf,
  paginate,
} = require("../lib/scope");
const { buildMeta } = require("../analytics");

// GET /api/meta — scoring rules, tournament list + default selection.
function handleMeta(res) {
  try {
    sendJson(res, 200, buildMeta());
  } catch (err) {
    console.error("Meta error:", err);
    sendJson(res, 500, { error: "Failed to build metadata." });
  }
}

// Generic section responder: resolve the scope block, then hand `pick` the
// block (+ url + tournament meta) to produce the JSON slice.
async function handleSection(req, res, pick) {
  try {
    const scope = parseScope(req);
    const result = await getScopeBlock(scope);
    if (!result) {
      sendJson(res, 404, { error: "Unknown tournament." });
      return;
    }
    const url = new URL(req.url, "http://x");
    sendJson(res, 200, pick(result.block, url, result.tournament));
  } catch (err) {
    console.error("Section error:", err);
    sendJson(res, 500, { error: "Failed to build analytics." });
  }
}

// GET /api/section/matches?t=&bucket=&page=&pageSize=&search= — one paginated
// explorer column (lightweight cards, no per-match predictions).
async function handleSectionMatches(req, res) {
  try {
    const scope = parseScope(req);
    const result = await getScopeBlock(scope);
    if (!result) {
      sendJson(res, 404, { error: "Unknown tournament." });
      return;
    }
    const url = new URL(req.url, "http://x");
    const bucket = url.searchParams.get("bucket");
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();

    let rows = result.block.matchList.map(lightMatch);
    if (bucket) rows = rows.filter((m) => bucketOf(m) === bucket);
    if (search) {
      rows = rows.filter((m) =>
        `${m.teamA} ${m.teamB}`.toLowerCase().includes(search),
      );
    }

    const num = (m) => m.matchNumber ?? m.id;
    if (bucket === "open" || bucket === "upcoming") {
      rows.sort(
        (a, b) =>
          (a.endTime ?? Infinity) - (b.endTime ?? Infinity) || num(a) - num(b),
      );
    } else {
      rows.sort((a, b) => num(b) - num(a));
    }

    sendJson(res, 200, { bucket: bucket || "all", ...paginate(rows, url, 20) });
  } catch (err) {
    console.error("Section matches error:", err);
    sendJson(res, 500, { error: "Failed to load matches." });
  }
}

// GET /api/section/players?t=&page=&pageSize=&search= — paginated standings.
async function handleSectionPlayers(req, res) {
  try {
    const scope = parseScope(req);
    const result = await getScopeBlock(scope);
    if (!result) {
      sendJson(res, 404, { error: "Unknown tournament." });
      return;
    }
    const url = new URL(req.url, "http://x");
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    let rows = result.block.players;
    if (search) {
      rows = rows.filter((r) => String(r.name).toLowerCase().includes(search));
    }
    sendJson(res, 200, paginate(rows, url, 25));
  } catch (err) {
    console.error("Section players error:", err);
    sendJson(res, 500, { error: "Failed to load players." });
  }
}

// GET /api/section/match?matchId= — one match with predictions + distribution.
async function handleSectionMatchDetail(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const matchId = Number(url.searchParams.get("matchId"));
    if (!Number.isInteger(matchId) || matchId <= 0) {
      sendJson(res, 400, { error: "Invalid matchId" });
      return;
    }
    const result = await getScopeBlock(null); // global block holds every match
    const m = result.block.matchList.find((x) => x.id === matchId);
    if (!m) {
      sendJson(res, 404, { error: "No such match" });
      return;
    }
    sendJson(res, 200, m);
  } catch (err) {
    console.error("Section match error:", err);
    sendJson(res, 500, { error: "Failed to load match." });
  }
}

// GET /api/section/player-history?t=&playerId= — a predictor's per-match rows.
async function handleSectionPlayerHistory(req, res) {
  try {
    const scope = parseScope(req);
    const result = await getScopeBlock(scope);
    if (!result) {
      sendJson(res, 404, { error: "Unknown tournament." });
      return;
    }
    const url = new URL(req.url, "http://x");
    const playerId = url.searchParams.get("playerId");
    if (!playerId) {
      sendJson(res, 400, { error: "Invalid playerId" });
      return;
    }
    const entries = [];
    for (const m of result.block.matchList) {
      const pred = (m.predictions || []).find(
        (p) => String(p.id) === String(playerId),
      );
      if (pred) entries.push({ match: lightMatch(m), pred });
    }
    const player =
      result.block.players.find((r) => String(r.id) === String(playerId)) ||
      null;
    sendJson(res, 200, { entries, player });
  } catch (err) {
    console.error("Section player-history error:", err);
    sendJson(res, 500, { error: "Failed to load player history." });
  }
}

module.exports = {
  handleMeta,
  handleSection,
  handleSectionMatches,
  handleSectionPlayers,
  handleSectionMatchDetail,
  handleSectionPlayerHistory,
};
