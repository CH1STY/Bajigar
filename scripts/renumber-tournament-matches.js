#!/usr/bin/env node
// Renumber every match in a tournament so its match numbers start from a given
// value and increase by 1 in creation order (by id).
//
// Example: a start of 4 renumbers the tournament's matches to 4, 5, 6, 7, ...
//
// The resulting numbers are always unique within the tournament (each match
// gets a distinct value). The update runs in a transaction and uses a temporary
// negative pass first, so it stays collision-free even mid-update.
//
// Usage:
//   node scripts/renumber-tournament-matches.js <tournament> <startNumber> [path/to/sports.db]
//
//   <tournament>   Tournament id (e.g. 1), name (case-insensitive, quote if it
//                  has spaces), or "standalone" for matches with no tournament.
//   <startNumber>  Positive integer the numbering should start from.
//
// The db path defaults to data/sports.db (or the SPORTS_DB_PATH env var).

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const [, , tournamentArg, startArg, dbArg] = process.argv;

if (!tournamentArg || startArg === undefined) {
  console.error(
    "Usage: node scripts/renumber-tournament-matches.js <tournament> <startNumber> [dbPath]",
  );
  console.error(
    '  <tournament> = id, name, or "standalone"   <startNumber> = positive integer',
  );
  process.exit(1);
}

const startNumber = Number(startArg);
if (!Number.isInteger(startNumber) || startNumber < 1) {
  console.error(
    `✗ startNumber must be a positive integer (got "${startArg}").`,
  );
  process.exit(1);
}

const dbPath =
  dbArg ||
  process.env.SPORTS_DB_PATH ||
  path.join(__dirname, "..", "data", "sports.db");

if (!fs.existsSync(dbPath)) {
  console.error(`✗ Database file not found: ${dbPath}`);
  process.exit(1);
}

console.log(`📂 Using database: ${dbPath}`);
const db = new DatabaseSync(dbPath);

try {
  // Make sure the column exists (older DBs may predate the feature).
  const columns = db
    .prepare("PRAGMA table_info(matches)")
    .all()
    .map((c) => c.name);
  if (!columns.includes("match_number")) {
    console.error(
      "✗ This database has no `match_number` column yet. Run " +
        "`npm run migrate:match-numbers` first.",
    );
    process.exit(1);
  }

  // Resolve the target tournament group.
  const standalone = /^(standalone|null|none)$/i.test(tournamentArg.trim());
  let tournamentId = null;
  let label;

  if (standalone) {
    label = "standalone matches (no tournament)";
  } else if (/^\d+$/.test(tournamentArg.trim())) {
    const t = db
      .prepare("SELECT id, name FROM tournaments WHERE id = ?")
      .get(Number(tournamentArg));
    if (!t) {
      console.error(`✗ No tournament found with id ${tournamentArg}.`);
      process.exit(1);
    }
    tournamentId = t.id;
    label = `tournament ${t.id} — ${t.name}`;
  } else {
    const matches = db
      .prepare("SELECT id, name FROM tournaments WHERE name = ? COLLATE NOCASE")
      .all(tournamentArg.trim());
    if (matches.length === 0) {
      console.error(`✗ No tournament found named "${tournamentArg}".`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(
        `✗ Multiple tournaments named "${tournamentArg}" (ids: ${matches
          .map((m) => m.id)
          .join(", ")}). Re-run using the id.`,
      );
      process.exit(1);
    }
    tournamentId = matches[0].id;
    label = `tournament ${matches[0].id} — ${matches[0].name}`;
  }

  // Fetch the group's matches in creation order.
  const rows = db
    .prepare(
      "SELECT id, match_number, team_a, team_b FROM matches WHERE tournament_id IS ? ORDER BY id ASC",
    )
    .all(tournamentId);

  if (rows.length === 0) {
    console.log(`ℹ️  No matches found for ${label}. Nothing to do.`);
    process.exit(0);
  }

  console.log(`🎯 Renumbering ${rows.length} match(es) in ${label}`);
  console.log(
    `   New numbers: ${startNumber}..${startNumber + rows.length - 1}\n`,
  );

  const setNumber = db.prepare(
    "UPDATE matches SET match_number = ? WHERE id = ?",
  );

  db.exec("BEGIN");
  try {
    // Phase 1: park every row on a unique temporary negative number so the
    // final pass can never momentarily clash with an existing number.
    rows.forEach((row, i) => setNumber.run(-(i + 1), row.id));
    // Phase 2: assign the final sequential numbers.
    rows.forEach((row, i) => {
      const newNumber = startNumber + i;
      setNumber.run(newNumber, row.id);
      console.log(
        `  • id ${row.id}: #${row.match_number ?? "—"} → #${newNumber}  (${row.team_a} v ${row.team_b})`,
      );
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // Safety check: confirm numbers are unique within the group.
  const dupes = db
    .prepare(
      `SELECT match_number, COUNT(*) AS cnt FROM matches
       WHERE tournament_id IS ? AND match_number IS NOT NULL
       GROUP BY match_number HAVING cnt > 1`,
    )
    .all(tournamentId);
  if (dupes.length > 0) {
    console.error(
      `\n✗ Uniqueness check failed — duplicate numbers remain: ${dupes
        .map((d) => `#${d.match_number}`)
        .join(", ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\n✅ Done. All match numbers in ${label} are unique.`);
  }
} catch (err) {
  console.error("✗ Renumber failed:", err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
