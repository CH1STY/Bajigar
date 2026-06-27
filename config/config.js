// Central configuration & constants for the Sports Prediction Bot.

module.exports = {
  // Role required to run management commands. Set MANAGER_ROLE in .env.
  MANAGER_ROLE: process.env.MANAGER_ROLE || "Sports_Manager",

  // Whether the manager-role check is enforced. Enforced by default; set
  // ENFORCE_MANAGER_ROLE=false in .env to let anyone run management commands
  // (handy for testing).
  ENFORCE_MANAGER_ROLE: process.env.ENFORCE_MANAGER_ROLE !== "false",

  // IANA timezone used to interpret typed/suggested match deadlines.
  // Change this to your local zone, e.g. "Europe/London", "America/New_York".
  TIMEZONE: "Asia/Dhaka",

  // Channel for server-wide notifications (tournament created, closing-soon
  // alerts for standalone matches). Set ANNOUNCEMENT_CHANNEL_ID in .env.
  ANNOUNCEMENT_CHANNEL_ID: process.env.ANNOUNCEMENT_CHANNEL_ID || null,

  // Web dashboard: tournament selected by default in the Tournaments dropdown.
  // Set WEB_DEFAULT_TOURNAMENT in .env to a tournament id (e.g. "2") or its
  // name (e.g. "World Cup 2026", case-insensitive). Empty = first tournament.
  WEB_DEFAULT_TOURNAMENT: process.env.WEB_DEFAULT_TOURNAMENT || null,

  // Admin lineup upload page (/admin/lineup). Lets an admin upload Player-
  // Analysis JSON from the browser instead of a Discord command. Disabled by
  // default — set LINEUP_UPLOAD_ENABLED=true in .env to switch it on, and set
  // a strong LINEUP_ADMIN_PASSWORD that must be entered to upload. When
  // disabled the page and its API return 404 as if they don't exist.
  LINEUP_UPLOAD_ENABLED: process.env.LINEUP_UPLOAD_ENABLED === "true",
  LINEUP_ADMIN_PASSWORD: process.env.LINEUP_ADMIN_PASSWORD || "",

  // Server redeploy page (/admin/deploy). Lets a sysadmin pull the latest code
  // and restart the app from the browser by running scripts/redeploy.sh.
  // Disabled by default — set REDEPLOY_ENABLED=true in .env to switch it on,
  // and set a strong SYSADMIN_PASSWORD that must be entered to trigger it.
  // When disabled the page and its API return 404 as if they don't exist.
  REDEPLOY_ENABLED: process.env.REDEPLOY_ENABLED === "true",
  SYSADMIN_PASSWORD: process.env.SYSADMIN_PASSWORD || "",

  // How long before a match deadline to send the "closing soon" alert.
  REMINDER_LEAD_MS: 30 * 60 * 1000, // 30 minutes

  // How often the reminder scheduler checks for upcoming deadlines.
  REMINDER_CHECK_INTERVAL_MS: 60 * 1000, // 1 minute

  // Supported match types.
  MATCH_TYPES: ["football", "cricket"],

  // Scoring rules (see README / task spec).
  SCORING: {
    football: {
      exact: 10, // Predicted score exactly matches the result.
      near: 2.5, // Total goal difference from the actual result is exactly 1.
      outcome: 5, // Correct winner or draw (right result, wrong score).
      // Knockout tie-breaker bonuses. Only awarded when a knockout match is
      // decided by a tie-breaker (penalty shootout) AND the user predicted one.
      // These stack on top of the regular-time score (which is unaffected).
      tiebreakerWinner: 5, // Correct tie-breaker winner.
      tiebreakerExact: 5, // Exact tie-breaker score (added on top of winner).
    },
    cricket: {
      correct: 10, // Correct winning team.
    },
  },

  // How many entries to show on a leaderboard.
  LEADERBOARD_LIMIT: 10,
};
