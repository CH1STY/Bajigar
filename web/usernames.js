// Resolve Discord user IDs to display names using the bot token over the REST
// API only (NO gateway connection). Results are cached on disk to stay within
// rate limits and to work even if the token is missing.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

const cacheFile = path.join(__dirname, "..", "data", "usernames.json");
const TTL_MS = 24 * 60 * 60 * 1000; // refresh cached names once a day

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
} catch {
  cache = {};
}

let rest = null;
const token = process.env.DISCORD_TOKEN;
if (token) {
  rest = new REST({ version: "10" }).setToken(token);
} else {
  console.warn(
    "⚠️  DISCORD_TOKEN not set — usernames will fall back to short IDs.",
  );
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch (err) {
      console.error("Failed to write username cache:", err.message);
    }
  }, 250);
}

function fallback(id) {
  return `User ${String(id).slice(-4)}`;
}

/** Fetch a single user's display name (global name preferred), with caching. */
async function fetchName(id) {
  const cached = cache[id];
  if (cached && Date.now() - cached.at < TTL_MS) return cached.name;
  if (!rest) return cached?.name || fallback(id);
  try {
    const user = await rest.get(Routes.user(id));
    const name = user.global_name || user.username || fallback(id);
    cache[id] = { name, at: Date.now() };
    scheduleSave();
    return name;
  } catch (err) {
    if (err?.status !== 404) {
      console.error(`Username lookup failed for ${id}:`, err.message);
    }
    return cached?.name || fallback(id);
  }
}

/**
 * Resolve many IDs to a { id -> name } map. Lookups run with light concurrency;
 * @discordjs/rest transparently queues to respect Discord rate limits.
 * @param {string[]} ids
 * @returns {Promise<Record<string,string>>}
 */
async function resolveMany(ids) {
  const unique = [...new Set(ids)];
  const result = {};
  const concurrency = 5;
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const names = await Promise.all(batch.map((id) => fetchName(id)));
    batch.forEach((id, idx) => {
      result[id] = names[idx];
    });
  }
  return result;
}

module.exports = { resolveMany, fetchName };
