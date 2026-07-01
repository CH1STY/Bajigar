// HTTP plumbing shared by every route: MIME table, JSON/error responders,
// a size-capped body reader and the static-file server.

const fs = require("fs");
const path = require("path");
const { publicDir, MAX_UPLOAD_BYTES } = require("./config");

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

// Send a bare "Not found" — used by gated routes that should look absent when
// their feature flag is off.
function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  // The admin page is only reachable through the gated /admin/lineup route.
  if (rel.toLowerCase() === "admin-lineup.html") {
    sendNotFound(res);
    return;
  }
  // The deploy page is only reachable through the gated /admin/deploy route.
  if (rel.toLowerCase() === "deploy.html") {
    sendNotFound(res);
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
      sendNotFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(content);
  });
}

module.exports = { MIME, sendJson, sendNotFound, readBody, serveStatic };
