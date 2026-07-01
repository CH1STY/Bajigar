// Gated HTML pages: the admin lineup uploader and the sysadmin redeploy page.
// Each only exists (serves HTML) when its feature flag + password are set;
// otherwise it 404s so the page looks absent.

const fs = require("fs");
const path = require("path");
const { MIME, sendNotFound } = require("../lib/http");
const { publicDir, adminUploadReady, redeployReady } = require("../lib/config");

function servePage(res, fileName) {
  fs.readFile(path.join(publicDir, fileName), (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end("Failed to load page");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    res.end(content);
  });
}

// GET /admin/lineup — admin lineup upload page (feature-gated).
function handleAdminLineupPage(req, res) {
  if (!adminUploadReady()) {
    sendNotFound(res);
    return;
  }
  servePage(res, "admin-lineup.html");
}

// GET /admin/deploy — sysadmin redeploy page (feature-gated).
function handleDeployPage(req, res) {
  if (!redeployReady()) {
    sendNotFound(res);
    return;
  }
  servePage(res, "deploy.html");
}

module.exports = { handleAdminLineupPage, handleDeployPage };
