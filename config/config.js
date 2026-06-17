// Central configuration & constants for the Sports Prediction Bot.

module.exports = {
  // Role required to run management commands. Set MANAGER_ROLE in .env.
  MANAGER_ROLE: process.env.MANAGER_ROLE || "Sports_Manager",

  // IANA timezone used to interpret typed/suggested match deadlines.
  // Change this to your local zone, e.g. "Europe/London", "America/New_York".
  TIMEZONE: "Asia/Dhaka",

  // Channel for server-wide notifications (tournament created, closing-soon
  // alerts for standalone matches). Set ANNOUNCEMENT_CHANNEL_ID in .env.
  ANNOUNCEMENT_CHANNEL_ID: process.env.ANNOUNCEMENT_CHANNEL_ID || null,

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
    },
    cricket: {
      correct: 10, // Correct winning team.
    },
  },

  // How many entries to show on a leaderboard.
  LEADERBOARD_LIMIT: 10,
};
