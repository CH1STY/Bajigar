#!/usr/bin/env node
// Cleanup script to remove special characters from team names in the database

const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "sports.db"));

/**
 * Clean team name: remove special characters, keep only alphanumeric, spaces, and hyphens
 * @param {string} name
 * @returns {string}
 */
function cleanTeamName(name) {
  if (!name) return name;
  // Keep only letters, numbers, spaces, and hyphens
  return name.replace(/[^a-zA-Z0-9\s\-]/g, "").trim();
}

try {
  const matches = db.prepare("SELECT id, team_a, team_b FROM matches").all();

  if (matches.length === 0) {
    console.log("✓ No matches found in database.");
    process.exit(0);
  }

  console.log(`Found ${matches.length} matches. Cleaning team names...\n`);

  const updateStmt = db.prepare(
    "UPDATE matches SET team_a = ?, team_b = ? WHERE id = ?",
  );

  let updated = 0;
  matches.forEach((match) => {
    const cleanedA = cleanTeamName(match.team_a);
    const cleanedB = cleanTeamName(match.team_b);

    if (cleanedA !== match.team_a || cleanedB !== match.team_b) {
      updateStmt.run(cleanedA, cleanedB, match.id);
      console.log(`  Match #${match.id}:`);
      if (cleanedA !== match.team_a) {
        console.log(`    team_a: "${match.team_a}" → "${cleanedA}"`);
      }
      if (cleanedB !== match.team_b) {
        console.log(`    team_b: "${match.team_b}" → "${cleanedB}"`);
      }
      updated++;
    }
  });

  console.log(`\n✓ Updated ${updated} matches.`);
  process.exit(0);
} catch (err) {
  console.error("❌ Error cleaning team names:", err);
  process.exit(1);
}
