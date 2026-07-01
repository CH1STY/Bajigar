// In-memory cache of Discord display names so repeated API hits don't re-query
// Discord. Exposes currentNameOf(): a fresh id -> name lookup function.

const { getDistinctUserIds } = require("../analytics");
const { resolveMany } = require("../usernames");

let namesCache = {};
let namesCachedAt = 0;
const NAMES_TTL = 60 * 1000;

// Resolve/refresh display names, then return a name(id) lookup.
async function currentNameOf() {
  const ids = getDistinctUserIds();
  if (Date.now() - namesCachedAt > NAMES_TTL) {
    namesCache = await resolveMany(ids);
    namesCachedAt = Date.now();
  } else {
    const missing = ids.filter((id) => !(id in namesCache));
    if (missing.length) {
      Object.assign(namesCache, await resolveMany(missing));
    }
  }
  return (id) => namesCache[id] || `User ${String(id).slice(-4)}`;
}

module.exports = { currentNameOf };
