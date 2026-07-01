// Scope-block computation + caching and the small shaping/pagination helpers
// shared by the analytics section endpoints.
//
// The dashboard fetches one lightweight slice per section (each with its own
// skeleton loader) instead of the whole payload at once. A scope-level block is
// computed on demand and briefly cached so a burst of section requests for the
// same tournament only computes once.

const { computeScopeBlock } = require("../analytics");
const { currentNameOf } = require("./names");

// Short-lived cache of a computed scope block, keyed by "global" or a
// tournament id. Keeps switching between sections cheap.
const blockCache = new Map();
const BLOCK_TTL_MS = 4000;

// Parse the ?t= scope param: absent/empty/"global" => null (global), else the
// numeric tournament id (or null when unparseable).
function parseScope(req) {
  const t = new URL(req.url, "http://x").searchParams.get("t");
  if (t == null || t === "" || t === "global") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

async function getScopeBlock(tournamentId) {
  const key = tournamentId == null ? "global" : String(tournamentId);
  const hit = blockCache.get(key);
  if (hit && Date.now() - hit.at < BLOCK_TTL_MS) return hit.value;
  const nameOf = await currentNameOf();
  const value = computeScopeBlock(tournamentId, nameOf); // {block,tournament}|null
  blockCache.set(key, { at: Date.now(), value });
  return value;
}

// Strip the heavy per-match arrays so match cards / lists stay lightweight.
function lightMatch(m) {
  const { predictions, distribution, ...rest } = m;
  return rest;
}

// Which explorer column a match belongs to (mirrors the client bucket logic).
function bucketOf(m) {
  if (m.state === "open") return "open";
  if (m.state === "pending") return "upcoming";
  if (m.status === "resolved") return "resolved";
  return "closed";
}

// Clamp + slice rows into a { items, page, pageSize, total, totalPages } page.
function paginate(rows, url, defaultSize = 25) {
  const total = rows.length;
  let pageSize = Number(url.searchParams.get("pageSize")) || defaultSize;
  pageSize = Math.min(Math.max(Math.trunc(pageSize), 1), 500);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  let page = Number(url.searchParams.get("page")) || 1;
  page = Math.min(Math.max(Math.trunc(page), 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}

module.exports = {
  parseScope,
  getScopeBlock,
  lightMatch,
  bucketOf,
  paginate,
};
