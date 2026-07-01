// Lineup admin surface: password login -> signed session cookie, then
// session/password-gated lineup upload + delete. Also exposes the session
// status probe and the brief match list the admin UI uses to pick a target.

const { sendJson, sendNotFound, readBody } = require("../lib/http");
const { adminUploadReady } = require("../lib/config");
const {
  SESSION_TTL_MS,
  SESSION_COOKIE,
  passwordMatches,
  issueSessionToken,
  sessionRemainingMs,
  parseCookies,
  isAuthorised,
} = require("../lib/auth");
const { validatePayload } = require("../lineupImport");
const {
  upsertLineup,
  deleteLineup,
  transaction,
  listMatchesBrief,
} = require("../../db/queries");

// POST /api/admin/login — exchange the password for a short-lived session
// cookie so subsequent uploads don't resend the password.
async function handleAdminLogin(req, res) {
  if (!adminUploadReady()) {
    sendNotFound(res);
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

// GET /api/admin/session — remaining session lifetime (for the UI clock).
function handleAdminSession(req, res) {
  if (!adminUploadReady()) {
    sendNotFound(res);
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
}

// POST /api/admin/lineup — session/password-gated lineup upload.
async function handleAdminUpload(req, res) {
  // Behave as if the route doesn't exist when the feature is off.
  if (!adminUploadReady()) {
    sendNotFound(res);
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
    sendNotFound(res);
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

// GET /api/matches — brief match list for the admin target picker.
function handleAdminMatches(res) {
  if (!adminUploadReady()) {
    sendNotFound(res);
    return;
  }
  try {
    sendJson(res, 200, listMatchesBrief());
  } catch (err) {
    console.error("Matches list error:", err);
    sendJson(res, 500, { error: "Failed to load matches." });
  }
}

module.exports = {
  handleAdminLogin,
  handleAdminLogout,
  handleAdminSession,
  handleAdminUpload,
  handleAdminDeleteLineup,
  handleAdminMatches,
};
