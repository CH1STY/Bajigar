// Import Player-Analysis lineup data from data/lineups/*.json into the
// match_lineups table. Each file must contain a numeric `matchId` (the DB id
// shown as "id N" on each match card). Re-running re-imports (upsert).
//
// Usage:
//   node scripts/import-lineups.js                 # import every file
//   node scripts/import-lineups.js path/to/one.json

const fs = require("fs");
const path = require("path");
const { db, getMatch, upsertLineup } = require("../db/queries");

const dir = path.join(__dirname, "..", "data", "lineups");

function fileList() {
  const arg = process.argv[2];
  if (arg) return [path.resolve(arg)];
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function importFile(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✗ ${path.basename(file)} — invalid JSON: ${err.message}`);
    return false;
  }
  const matchId = Number(data.matchId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    console.error(`✗ ${path.basename(file)} — missing/invalid "matchId".`);
    return false;
  }
  const match = getMatch(matchId);
  if (!match) {
    console.error(
      `✗ ${path.basename(file)} — no match with id ${matchId} in the DB.`,
    );
    return false;
  }
  upsertLineup(matchId, data);
  console.log(
    `✓ ${path.basename(file)} → match ${matchId} (${match.team_a} v ${match.team_b})`,
  );
  return true;
}

function main() {
  const files = fileList();
  if (!files.length) {
    console.log("No lineup files found in data/lineups/.");
    return;
  }
  let ok = 0;
  for (const f of files) if (importFile(f)) ok++;
  console.log(`\nImported ${ok}/${files.length} file(s).`);
  db.close();
}

main();
