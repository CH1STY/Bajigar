// Sysadmin surface (separate SYSADMIN_PASSWORD realm): trigger a git pull &
// restart via scripts/redeploy.sh, and download a self-contained snapshot of
// the live SQLite database.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { sendJson, sendNotFound, readBody } = require("../lib/http");
const { redeployReady, DB_FILE_PATH } = require("../lib/config");
const { sysadminPasswordMatches } = require("../lib/auth");

// Read + validate the sysadmin password from header or JSON body.
async function readSysadminPassword(req) {
  let password = req.headers["x-sysadmin-password"];
  if (password == null) {
    // Fall back to a JSON body { password }.
    try {
      const body = await readBody(req, 4096);
      password = body ? (JSON.parse(body).password ?? "") : "";
    } catch {
      password = "";
    }
  }
  return password;
}

// Guard so two clicks can't kick off two overlapping redeploys.
let redeployInFlight = false;

// POST /api/admin/redeploy — sysadmin-password-gated "pull & restart".
// Validates the password, then spawns scripts/redeploy.sh fully detached so
// the script survives this server being stopped by the script itself.
async function handleRedeploy(req, res) {
  // Behave as if the route doesn't exist when the feature is off.
  if (!redeployReady()) {
    sendNotFound(res);
    return;
  }
  const password = await readSysadminPassword(req);
  if (!sysadminPasswordMatches(password)) {
    sendJson(res, 401, { error: "Incorrect sysadmin password." });
    return;
  }
  if (redeployInFlight) {
    sendJson(res, 409, { error: "A redeploy is already in progress." });
    return;
  }
  redeployInFlight = true;

  const scriptPath = path.join(__dirname, "..", "..", "scripts", "redeploy.sh");
  if (!fs.existsSync(scriptPath)) {
    redeployInFlight = false;
    sendJson(res, 500, { error: "Redeploy script is missing on the server." });
    return;
  }

  try {
    // Detached + ignored stdio + unref so the child keeps running (and can
    // stop/restart this very server) after this process exits.
    const child = spawn("bash", [scriptPath], {
      cwd: path.join(__dirname, "..", ".."),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      console.error("Failed to start redeploy script:", err);
      redeployInFlight = false;
    });
    child.unref();
  } catch (err) {
    redeployInFlight = false;
    console.error("Redeploy spawn error:", err);
    sendJson(res, 500, { error: "Failed to start the redeploy script." });
    return;
  }

  sendJson(res, 202, {
    ok: true,
    message:
      "Redeploy started: pulling latest code and restarting. The server will be briefly unavailable.",
  });
}

// POST /api/admin/db-download — sysadmin-password-gated database snapshot.
// Validates the password, flushes the WAL into the main file, then streams the
// SQLite database as a download so the production DB can be tested locally.
async function handleDbDownload(req, res) {
  // Behave as if the route doesn't exist when the feature is off.
  if (!redeployReady()) {
    sendNotFound(res);
    return;
  }
  const password = await readSysadminPassword(req);
  if (!sysadminPasswordMatches(password)) {
    sendJson(res, 401, { error: "Incorrect sysadmin password." });
    return;
  }
  if (!fs.existsSync(DB_FILE_PATH)) {
    sendJson(res, 500, { error: "Database file is missing on the server." });
    return;
  }

  // Flush the write-ahead log into the main db file so the snapshot we send is
  // complete and self-contained (no separate -wal needed).
  try {
    const db = require("../../db/database");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.error("DB checkpoint before download failed:", err);
    // Continue — the snapshot is still usable, just possibly missing the most
    // recent uncheckpointed writes.
  }

  let stat;
  try {
    stat = fs.statSync(DB_FILE_PATH);
  } catch (err) {
    console.error("DB stat before download failed:", err);
    sendJson(res, 500, { error: "Could not read the database file." });
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="sports-${stamp}.db"`,
    "Content-Length": stat.size,
    "Cache-Control": "no-store",
  });

  const stream = fs.createReadStream(DB_FILE_PATH);
  stream.on("error", (err) => {
    console.error("DB download stream error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "Download failed." });
    else res.destroy();
  });
  stream.pipe(res);
}

module.exports = { handleRedeploy, handleDbDownload };
