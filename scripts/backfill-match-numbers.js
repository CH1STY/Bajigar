#!/usr/bin/env node
// Adds the per-tournament `match_number` column to an existing (production)
// database and backfills numbers for any matches that don't have one yet.
//
// Safe to run multiple times (idempotent):
//   - Adds the column only if it's missing.
//   - Only assigns numbers to matches whose match_number is NULL, continuing
//     the sequence after the highest existing number in each group.
//   - Numbering is per tournament; standalone matches (tournament_id IS NULL)
//     form their own group. Ordering follows creation order (by id).
//
// Usage:
//   node scripts/backfill-match-numbers.js [path/to/sports.db]
// The path defaults to data/sports.db (or the SPORTS_DB_PATH env var).

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dbPath =
  process.argv[2] ||
  process.env.SPORTS_DB_PATH ||
  path.join(__dirname, "..", "data", "sports.db");

if (!fs.existsSync(dbPath)) {
  console.error(`✗ Database file not found: ${dbPath}`);
  console.error(
    "  Pass the path explicitly: node scripts/backfill-match-numbers.js <path>",
  );
  process.exit(1);
}

console.log(`📂 Using database: ${dbPath}`);
const db = new DatabaseSync(dbPath);

try {
  // 1) Ensure the column exists.
  const columns = db
    .prepare("PRAGMA table_info(matches)")
    .all()
    .map((c) => c.name);

  if (!columns.includes("match_number")) {
    db.exec("ALTER TABLE matches ADD COLUMN match_number INTEGER");
    console.log("✓ Added `match_number` column to matches.");
  } else {
    console.log("ℹ️  `match_number` column already exists.");
  }

  // 2) Backfill any NULL match numbers, per group, continuing the sequence.
  const groups = db.prepare("SELECT DISTINCT tournament_id FROM matches").all();

  const usedNumbers = db.prepare(
    "SELECT match_number FROM matches WHERE tournament_id IS ? AND match_number IS NOT NULL",
  );
  const missingRows = db.prepare(
    "SELECT id FROM matches WHERE tournament_id IS ? AND match_number IS NULL ORDER BY id ASC",
  );
  const setNumber = db.prepare(
    "UPDATE matches SET match_number = ? WHERE id = ?",
  );

  let totalAssigned = 0;

  db.exec("BEGIN");
  try {
    for (const group of groups) {
      const tournamentId = group.tournament_id;
      const used = new Set(
        usedNumbers.all(tournamentId).map((r) => r.match_number),
      );
      const toAssign = missingRows.all(tournamentId);
      if (toAssign.length === 0) continue;

      let next = used.size ? Math.max(...used) + 1 : 1;
      for (const row of toAssign) {
        while (used.has(next)) next += 1;
        setNumber.run(next, row.id);
        used.add(next);
        next += 1;
        totalAssigned += 1;
      }

      const label =
        tournamentId === null
          ? "standalone matches"
          : `tournament ${tournamentId}`;
      console.log(`  • ${label}: numbered ${toAssign.length} match(es).`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (totalAssigned === 0) {
    console.log("✓ Nothing to do — every match already has a number.");
  } else {
    console.log(`✅ Done. Assigned numbers to ${totalAssigned} match(es).`);
  }
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
