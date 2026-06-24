// Standalone analytics web server (no Discord gateway connection).
// Serves a static dashboard and a JSON analytics API on port 2026.
//
// Usage: npm run web   (or: node web/server.js)

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { buildAnalytics, getDistinctUserIds } = require("./analytics");
const { resolveMany } = require("./usernames");

const PORT = Number(process.env.WEB_PORT) || 2026;
const publicDir = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

// In-memory cache of names so repeated API hits don't re-query Discord.
let namesCache = {};
let namesCachedAt = 0;
const NAMES_TTL = 60 * 1000;

async function handleStats(res) {
  try {
    const ids = getDistinctUserIds();
    if (Date.now() - namesCachedAt > NAMES_TTL) {
      namesCache = await resolveMany(ids);
      namesCachedAt = Date.now();
    } else {
      // Resolve any IDs we haven't seen yet (mostly served from disk cache).
      const missing = ids.filter((id) => !(id in namesCache));
      if (missing.length) {
        Object.assign(namesCache, await resolveMany(missing));
      }
    }
    const nameOf = (id) => namesCache[id] || `User ${String(id).slice(-4)}`;
    const data = buildAnalytics(nameOf);
    sendJson(res, 200, data);
  } catch (err) {
    console.error("Analytics error:", err);
    sendJson(res, 500, { error: "Failed to build analytics." });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  // Prevent path traversal: resolve and ensure it stays under publicDir.
  const filePath = path.normalize(path.join(publicDir, rel));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  if (req.method === "GET" && pathname === "/api/stats") {
    handleStats(res);
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
});
