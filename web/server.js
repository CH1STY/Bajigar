// Standalone analytics web server (no Discord gateway connection).
// Serves a static dashboard and a JSON analytics API on port 2026.
//
// Usage: npm run web   (or: node web/server.js)

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildAnalytics, getDistinctUserIds } = require("./analytics");
const { resolveMany } = require("./usernames");
const {
  getLineup,
  getLineupsForMatches,
  upsertLineup,
  deleteLineup,
  transaction,
  listMatchesBrief,
} = require("../db/queries");
const { validatePayload } = require("./lineupImport");
const {
  LINEUP_UPLOAD_ENABLED,
  LINEUP_ADMIN_PASSWORD,
} = require("../config/config");

const PORT = Number(process.env.WEB_PORT) || 2026;
const publicDir = path.join(__dirname, "public");
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB upload cap

// The admin upload feature is only usable when explicitly enabled AND a
// password is configured. A blank password never matches.
const adminUploadReady = () =>
  LINEUP_UPLOAD_ENABLED &&
  typeof LINEUP_ADMIN_PASSWORD === "string" &&
  LINEUP_ADMIN_PASSWORD.length > 0;

// Constant-time password comparison to avoid leaking length/timing.
function passwordMatches(supplied) {
  if (typeof supplied !== "string" || !LINEUP_ADMIN_PASSWORD) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(LINEUP_ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- Short-lived admin session (stateless, signed cookie) ------------------
// After a correct password, the client gets an HttpOnly cookie holding a
// signed token "<expiryMs>.<hmac>". The HMAC is keyed by the admin password so
// changing the password instantly invalidates every outstanding session, and
// no server-side session store is needed. Upload requests then ride on the
// cookie instead of resending the password each time.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_COOKIE = "admin_session";

function signSession(expMs) {
  const mac = crypto
    .createHmac("sha256", LINEUP_ADMIN_PASSWORD)
    .update(String(expMs))
    .digest("hex");
  return `${expMs}.${mac}`;
}

function issueSessionToken() {
  return signSession(Date.now() + SESSION_TTL_MS);
}

function sessionValid(token) {
  if (typeof token !== "string" || !LINEUP_ADMIN_PASSWORD) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = signSession(expMs);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Remaining lifetime (ms) of a valid session token, or 0 if invalid/expired.
function sessionRemainingMs(token) {
  if (!sessionValid(token)) return 0;
  const expMs = Number(token.slice(0, token.indexOf(".")));
  return Math.max(0, expMs - Date.now());
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// A request is authorised if it carries a valid session cookie OR the correct
// password header (the latter keeps scripted/curl uploads working).
function isAuthorised(req) {
  const cookies = parseCookies(req);
  if (sessionValid(cookies[SESSION_COOKIE])) return true;
  return passwordMatches(req.headers["x-admin-password"]);
}

// Read a request body up to a byte cap, rejecting anything larger.
function readBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

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

// POST /api/admin/login — exchange the password for a short-lived session
// cookie so subsequent uploads don't resend the password.
async function handleAdminLogin(req, res) {
  if (!adminUploadReady()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  let password = req.headers["x-admin-password"];
  if (password == null) {
    // Fall back to a JSON body { password }.
    try {
      const body = await readBody(req, 4096);
      password = body ? (JSON.parse(body).password ?? "") : "";
    } catch {
      password = "";
    }
  }
  if (!passwordMatches(password)) {
    sendJson(res, 401, { error: "Incorrect password." });
    return;
  }
  const token = issueSessionToken();
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  });
  res.end(JSON.stringify({ ok: true, expiresInMs: SESSION_TTL_MS }));
}

// POST /api/admin/logout — clear the session cookie.
function handleAdminLogout(res) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  });
  res.end(JSON.stringify({ ok: true }));
}

// POST /api/admin/lineup — session/password-gated lineup upload.
async function handleAdminUpload(req, res) {
  // Behave as if the route doesn't exist when the feature is off.
  if (!adminUploadReady()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  // Authorise before reading the (potentially large) body.
  if (!isAuthorised(req)) {
    sendJson(res, 401, {
      error: "Not authenticated. Unlock with the password first.",
    });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err && err.message === "PAYLOAD_TOO_LARGE") {
      sendJson(res, 413, { error: "Payload too large (max 1 MB)." });
      return;
    }
    sendJson(res, 400, { error: "Could not read request body." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, {
      error:
        "That isn't valid JSON. Check for missing commas, quotes, or brackets.",
    });
    return;
  }
  // Optional fallback matchId from the UI, used only for a single entry that
  // doesn't carry its own matchId.
  const qsMatchId = new URL(req.url, "http://x").searchParams.get("matchId");
  const fallbackMatchId =
    qsMatchId != null && qsMatchId !== "" ? Number(qsMatchId) : null;
  const result = validatePayload(parsed, fallbackMatchId);
  if (!result.ok) {
    sendJson(res, 422, { error: "Validation failed.", details: result.errors });
    return;
  }
  try {
    transaction(() =>
      result.valid.forEach((v) => upsertLineup(v.matchId, v.data)),
    );
  } catch (err) {
    console.error("Admin lineup upload error:", err);
    sendJson(res, 500, { error: "Failed to save lineups." });
    return;
  }
  const saved = result.valid.map((v) => ({
    matchId: v.matchId,
    label: `${v.match.team_a} v ${v.match.team_b}`,
  }));
  sendJson(res, 200, { ok: true, count: saved.length, saved });
}

// POST /api/admin/lineup/delete?matchId=N — session-gated lineup removal.
async function handleAdminDeleteLineup(req, res) {
  // Behave as if the route doesn't exist when the feature is off.
  if (!adminUploadReady()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  if (!isAuthorised(req)) {
    sendJson(res, 401, {
      error: "Not authenticated. Unlock with the password first.",
    });
    return;
  }
  const id = Number(new URL(req.url, "http://x").searchParams.get("matchId"));
  if (!Number.isInteger(id) || id <= 0) {
    sendJson(res, 400, { error: "A valid matchId is required." });
    return;
  }
  try {
    const removed = deleteLineup(id);
    if (!removed) {
      sendJson(res, 404, { error: "No lineup found for that match." });
      return;
    }
    sendJson(res, 200, { ok: true, matchId: id });
  } catch (err) {
    console.error("Admin lineup delete error:", err);
    sendJson(res, 500, { error: "Failed to delete lineup." });
  }
}

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
  // The admin page is only reachable through the gated /admin/lineup route.
  if (rel.toLowerCase() === "admin-lineup.html") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
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
  // Admin lineup upload page — only exists when the feature is enabled.
  if (req.method === "GET" && pathname === "/admin/lineup") {
    if (!adminUploadReady()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    fs.readFile(path.join(publicDir, "admin-lineup.html"), (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end("Failed to load page");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(content);
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/login") {
    handleAdminLogin(req, res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/admin/session") {
    if (!adminUploadReady()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const remaining = sessionRemainingMs(parseCookies(req)[SESSION_COOKIE]);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({ authorised: remaining > 0, expiresInMs: remaining }),
    );
    return;
  }
  if (req.method === "GET" && pathname === "/api/matches") {
    if (!adminUploadReady()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    try {
      sendJson(res, 200, listMatchesBrief());
    } catch (err) {
      console.error("Matches list error:", err);
      sendJson(res, 500, { error: "Failed to load matches." });
    }
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/logout") {
    handleAdminLogout(res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/lineup") {
    handleAdminUpload(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/admin/lineup/delete") {
    handleAdminDeleteLineup(req, res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/lineup") {
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
    return;
  }
  if (req.method === "GET" && pathname === "/api/lineups") {
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
});
