// Shared configuration + feature-flag helpers for the analytics web server.
// Centralises the paths, size caps and "is this admin feature usable?" checks
// that several route modules depend on.

const path = require("path");
const {
  LINEUP_UPLOAD_ENABLED,
  LINEUP_ADMIN_PASSWORD,
  REDEPLOY_ENABLED,
  SYSADMIN_PASSWORD,
} = require("../../config/config");

const PORT = Number(process.env.WEB_PORT) || 2026;
const publicDir = path.join(__dirname, "..", "public");
const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB upload cap

// Path to the live SQLite database file (used by the sysadmin DB download).
const DB_FILE_PATH = path.join(__dirname, "..", "..", "data", "sports.db");

// The admin upload feature is only usable when explicitly enabled AND a
// password is configured. A blank password never matches.
const adminUploadReady = () =>
  LINEUP_UPLOAD_ENABLED &&
  typeof LINEUP_ADMIN_PASSWORD === "string" &&
  LINEUP_ADMIN_PASSWORD.length > 0;

// The redeploy feature is only usable when explicitly enabled AND a sysadmin
// password is configured. A blank password never matches.
const redeployReady = () =>
  REDEPLOY_ENABLED &&
  typeof SYSADMIN_PASSWORD === "string" &&
  SYSADMIN_PASSWORD.length > 0;

module.exports = {
  PORT,
  publicDir,
  MAX_UPLOAD_BYTES,
  DB_FILE_PATH,
  LINEUP_UPLOAD_ENABLED,
  REDEPLOY_ENABLED,
  adminUploadReady,
  redeployReady,
};
