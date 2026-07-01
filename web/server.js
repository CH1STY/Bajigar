// Standalone analytics web server (no Discord gateway connection).
// Serves a static dashboard and a JSON analytics API on port 2026.
//
// Usage: npm run web   (or: node web/server.js)
//
// This file is only the composition root: it wires the modular route handlers
// (web/routes/*) that build on the shared helpers (web/lib/*) into a small
// method+path dispatch table, then starts listening. All real logic lives in
// those modules.

require("dotenv").config();

const http = require("http");
const {
  PORT,
  LINEUP_UPLOAD_ENABLED,
  REDEPLOY_ENABLED,
  adminUploadReady,
  redeployReady,
} = require("./lib/config");
const { serveStatic } = require("./lib/http");
const sections = require("./routes/sections");
const admin = require("./routes/admin");
const sysadmin = require("./routes/sysadmin");
const lineup = require("./routes/lineup");
const pages = require("./routes/pages");

// Exact method+path routes. The value is (req, res) => void. Section endpoints
// that only differ by which block slice they return share handleSection via a
// tiny picker closure.
const routes = {
  "GET /api/meta": (req, res) => sections.handleMeta(res),
  "GET /api/section/matches": sections.handleSectionMatches,
  "GET /api/section/players": sections.handleSectionPlayers,
  "GET /api/section/match": sections.handleSectionMatchDetail,
  "GET /api/section/player-history": sections.handleSectionPlayerHistory,
  // Full lightweight match set for the scope (no per-match predictions).
  // Powers league tables, the knockout bracket, head-to-head history and the
  // player-standings lineup lookups — all of which need every match.
  "GET /api/section/matchset": (req, res) =>
    sections.handleSection(req, res, (block) =>
      block.matchList.map(({ predictions, distribution, ...rest }) => rest),
    ),
  "GET /api/section/kpis": (req, res) =>
    sections.handleSection(req, res, (block) => block.overview),
  "GET /api/section/top-scorers": (req, res) =>
    sections.handleSection(req, res, (block) => block.topScorers),
  "GET /api/section/outcome": (req, res) =>
    sections.handleSection(req, res, (block) => block.outcomeBreakdown),
  "GET /api/section/volume": (req, res) =>
    sections.handleSection(req, res, (block) => block.predictionVolume),
  "GET /api/section/accuracy": (req, res) =>
    sections.handleSection(req, res, (block) => block.avgGoalDiff),
  "GET /api/section/near-misses": (req, res) =>
    sections.handleSection(req, res, (block) => block.nearMisses),
  "GET /api/section/scorelines": (req, res) =>
    sections.handleSection(req, res, (block) => block.predictedScorelines),
  "GET /api/section/spotlight": (req, res) =>
    sections.handleSection(req, res, (block) => ({
      best: block.bestPredictor,
      worst: block.worstPredictor,
    })),

  // Gated HTML pages.
  "GET /admin/lineup": pages.handleAdminLineupPage,
  "GET /admin/deploy": pages.handleDeployPage,

  // Sysadmin actions.
  "POST /api/admin/redeploy": sysadmin.handleRedeploy,
  "POST /api/admin/db-download": sysadmin.handleDbDownload,

  // Admin lineup surface.
  "POST /api/admin/login": admin.handleAdminLogin,
  "POST /api/admin/logout": (req, res) => admin.handleAdminLogout(res),
  "GET /api/admin/session": admin.handleAdminSession,
  "GET /api/matches": (req, res) => admin.handleAdminMatches(res),
  "POST /api/admin/lineup": admin.handleAdminUpload,
  "POST /api/admin/lineup/delete": admin.handleAdminDeleteLineup,

  // Public lineup lookups.
  "GET /api/lineup": lineup.handleGetLineup,
  "GET /api/lineups": lineup.handleGetLineups,
};

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  const handler = routes[`${req.method} ${pathname}`];
  if (handler) {
    handler(req, res);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  console.log(`📊 Analytics dashboard running at http://localhost:${PORT}`);
  if (adminUploadReady()) {
    console.log(
      `🔐 Admin lineup upload enabled at http://localhost:${PORT}/admin/lineup`,
    );
  } else if (LINEUP_UPLOAD_ENABLED) {
    console.log(
      "⚠️  LINEUP_UPLOAD_ENABLED is true but LINEUP_ADMIN_PASSWORD is empty — upload page disabled.",
    );
  }
  if (redeployReady()) {
    console.log(
      `🚀 Redeploy page enabled at http://localhost:${PORT}/admin/deploy`,
    );
  } else if (REDEPLOY_ENABLED) {
    console.log(
      "⚠️  REDEPLOY_ENABLED is true but SYSADMIN_PASSWORD is empty — redeploy page disabled.",
    );
  }
});
