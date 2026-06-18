#!/usr/bin/env node
// Script to remove user points either for a single user or all users

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const readline = require("readline");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "sports.db"));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Prompt user for input
 * @param {string} question
 * @returns {Promise<string>}
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Remove points from a single user
 * @param {string} discordId
 * @param {number} pointsToRemove
 */
function removeUserPoints(discordId, pointsToRemove) {
  const userStmt = db.prepare("SELECT * FROM users WHERE discord_id = ?");
  const user = userStmt.get(discordId);

  if (!user) {
    console.log(`✗ User with ID "${discordId}" not found in database.`);
    return false;
  }

  const newPoints = Math.max(0, user.global_points - pointsToRemove);
  const updateStmt = db.prepare(
    "UPDATE users SET global_points = ? WHERE discord_id = ?",
  );
  updateStmt.run(newPoints, discordId);

  console.log(`\n✓ Updated user ${discordId}`);
  console.log(`  Previous points: ${user.global_points}`);
  console.log(`  Points removed: ${pointsToRemove}`);
  console.log(`  New points: ${newPoints}`);
  return true;
}

/**
 * Remove points from all users
 * @param {number} pointsToRemove
 */
function removeAllUsersPoints(pointsToRemove) {
  const users = db
    .prepare("SELECT * FROM users ORDER BY global_points DESC")
    .all();

  if (users.length === 0) {
    console.log("✗ No users found in database.");
    return false;
  }

  console.log(
    `\nFound ${users.length} users. Removing ${pointsToRemove} points from each...\n`,
  );

  const updateStmt = db.prepare(
    "UPDATE users SET global_points = ? WHERE discord_id = ?",
  );

  let updated = 0;
  users.forEach((user) => {
    const newPoints = Math.max(0, user.global_points - pointsToRemove);
    updateStmt.run(newPoints, user.discord_id);
    console.log(`  ${user.discord_id}: ${user.global_points} → ${newPoints}`);
    updated++;
  });

  console.log(`\n✓ Updated ${updated} users.`);
  return true;
}

/**
 * Reset all users to 0 points (global + tournament/prediction points)
 */
function resetAllUsersPoints() {
  const users = db
    .prepare("SELECT * FROM users ORDER BY global_points DESC")
    .all();

  if (users.length === 0) {
    console.log("✗ No users found in database.");
    return false;
  }

  console.log(`\nFound ${users.length} users. Resetting ALL points...\n`);
  console.log("  - Resetting global_points in users table");
  console.log("  - Resetting points_earned in predictions table\n");

  // Reset global points
  const updateUserStmt = db.prepare(
    "UPDATE users SET global_points = 0 WHERE discord_id = ?",
  );

  let userUpdated = 0;
  users.forEach((user) => {
    if (user.global_points !== 0) {
      updateUserStmt.run(user.discord_id);
      console.log(`  Global: ${user.discord_id}: ${user.global_points} → 0`);
      userUpdated++;
    }
  });

  // Reset prediction points (tournament points)
  const predictionCount = db
    .prepare(
      "SELECT COUNT(*) as count FROM predictions WHERE points_earned > 0",
    )
    .get();
  const resetPredictionsStmt = db.prepare(
    "UPDATE predictions SET points_earned = 0 WHERE points_earned > 0",
  );
  resetPredictionsStmt.run();

  console.log(`\n✓ Reset ${userUpdated} users' global points`);
  console.log(
    `✓ Reset ${predictionCount.count} prediction entries (tournament/match points)`,
  );
  console.log("\n✓ All leaderboards are now reset: Global ✓ & Tournament ✓");
  return true;
}

/**
 * Get all users with their points
 */
function listAllUsers() {
  const users = db
    .prepare("SELECT * FROM users ORDER BY global_points DESC")
    .all();

  if (users.length === 0) {
    console.log("✗ No users found in database.");
    return;
  }

  console.log(`\nTotal users: ${users.length}\n`);
  console.log("Discord ID".padEnd(20) + "Points");
  console.log("-".repeat(50));

  users.forEach((user) => {
    console.log(user.discord_id.padEnd(20) + user.global_points);
  });
}

/**
 * Main menu
 */
async function main() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("       USER POINTS REMOVAL SCRIPT");
  console.log("═══════════════════════════════════════════════════\n");

  let running = true;

  while (running) {
    console.log("\nChoose an action:");
    console.log("  1. Remove points from a single user");
    console.log("  2. Remove points from all users");
    console.log("  3. Reset all users to 0 points");
    console.log("  4. List all users and their points");
    console.log("  5. Exit\n");

    const choice = await prompt("Enter your choice (1-5): ");

    switch (choice.trim()) {
      case "1": {
        const discordId = await prompt("Enter the Discord user ID: ");
        if (!discordId.trim()) {
          console.log("✗ Invalid user ID.");
          break;
        }

        const pointsStr = await prompt("Enter number of points to remove: ");
        const points = parseInt(pointsStr, 10);

        if (isNaN(points) || points < 0) {
          console.log("✗ Invalid point value.");
          break;
        }

        removeUserPoints(discordId.trim(), points);
        break;
      }

      case "2": {
        const pointsStr = await prompt(
          "Enter number of points to remove from each user: ",
        );
        const points = parseInt(pointsStr, 10);

        if (isNaN(points) || points < 0) {
          console.log("✗ Invalid point value.");
          break;
        }

        const confirm = await prompt(
          `Remove ${points} points from ALL users? (yes/no): `,
        );

        if (confirm.toLowerCase() === "yes") {
          removeAllUsersPoints(points);
        } else {
          console.log("✗ Operation cancelled.");
        }
        break;
      }

      case "3": {
        const confirm = await prompt(
          "Reset ALL users to 0 points? This cannot be undone! (yes/no): ",
        );

        if (confirm.toLowerCase() === "yes") {
          resetAllUsersPoints();
        } else {
          console.log("✗ Operation cancelled.");
        }
        break;
      }

      case "4": {
        listAllUsers();
        break;
      }

      case "5": {
        running = false;
        console.log("\n✓ Goodbye!\n");
        break;
      }

      default:
        console.log("✗ Invalid choice. Please enter 1-5.");
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Error:", err.message);
  rl.close();
  process.exit(1);
});
