// Authentication helpers for the admin + sysadmin surfaces.
//
// Two password realms exist:
//   - LINEUP_ADMIN_PASSWORD  -> lineup upload page (cookie session below)
//   - SYSADMIN_PASSWORD      -> redeploy / db-download (password per request)
//
// The lineup admin uses a stateless, signed cookie: after a correct password
// the client gets an HttpOnly cookie holding "<expiryMs>.<hmac>". The HMAC is
// keyed by the admin password so changing the password instantly invalidates
// every outstanding session, and no server-side session store is needed.

const crypto = require("crypto");
const {
  LINEUP_ADMIN_PASSWORD,
  SYSADMIN_PASSWORD,
} = require("../../config/config");

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_COOKIE = "admin_session";

// Constant-time password comparison to avoid leaking length/timing.
function passwordMatches(supplied) {
  if (typeof supplied !== "string" || !LINEUP_ADMIN_PASSWORD) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(LINEUP_ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Constant-time comparison for the separate sysadmin (redeploy) password.
function sysadminPasswordMatches(supplied) {
  if (typeof supplied !== "string" || !SYSADMIN_PASSWORD) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(SYSADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

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

module.exports = {
  SESSION_TTL_MS,
  SESSION_COOKIE,
  passwordMatches,
  sysadminPasswordMatches,
  issueSessionToken,
  sessionValid,
  sessionRemainingMs,
  parseCookies,
  isAuthorised,
};
