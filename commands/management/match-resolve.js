// /match-resolve [match_id] [result] — Sports_Manager only.
// Closes a match, stores the result, scores every prediction and updates points.

const { SlashCommandBuilder } = require("discord.js");
const { db, getMatch, transaction } = require("../../db/queries");
const {
  normalizeFootballScore,
  scoreFootball,
  scoreCricket,
} = require("../../utils/scoring");
const { ephemeral } = require("../../utils/embeds");

const getPredictions = db.prepare(
  "SELECT * FROM predictions WHERE match_id = ?",
);
const updatePrediction = db.prepare(
  "UPDATE predictions SET points_earned = ? WHERE id = ?",
);
const adjustGlobalPoints = db.prepare(
  "UPDATE users SET global_points = global_points + ? WHERE discord_id = ?",
);
const resolveMatchStmt = db.prepare(
  "UPDATE matches SET status = 'resolved', result = ? WHERE id = ?",
);

// Run the entire resolution atomically.
function resolveMatch(match, result) {
  return transaction(() => {
    const predictions = getPredictions.all(match.id);
    let awarded = 0;

    for (const pred of predictions) {
      const points =
        match.type === "football"
          ? scoreFootball(pred.predicted_value, result)
          : scoreCricket(pred.predicted_value, result);

      // Apply the delta so re-resolving a match stays consistent.
      const delta = points - pred.points_earned;
      if (delta !== 0) {
        adjustGlobalPoints.run(delta, pred.discord_id);
      }
      updatePrediction.run(points, pred.id);
      if (points > 0) awarded += 1;
    }

    resolveMatchStmt.run(result, match.id);
    return { total: predictions.length, awarded };
  });
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-resolve")
    .setDescription(
      "Resolve a match and score predictions (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o.setName("match_id").setDescription("ID of the match").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("result")
        .setDescription('Football: "X-Y" score. Cricket: winning team name.')
        .setRequired(true),
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger("match_id");
    const resultRaw = interaction.options.getString("result").trim();

    const match = getMatch(matchId);
    if (!match) {
      return interaction.reply(
        ephemeral(`❌ No match found with ID \`${matchId}\`.`),
      );
    }
    if (match.status === "resolved") {
      return interaction.reply(
        ephemeral(`❌ Match \`${matchId}\` has already been resolved.`),
      );
    }

    // Validate & normalize the result depending on match type.
    let result = resultRaw;
    if (match.type === "football") {
      const normalized = normalizeFootballScore(resultRaw);
      if (!normalized) {
        return interaction.reply(
          ephemeral("❌ Football result must be a score like `2-1`."),
        );
      }
      result = normalized;
    } else {
      // cricket — must be one of the two teams.
      const lower = resultRaw.toLowerCase();
      if (
        lower !== match.team_a.toLowerCase() &&
        lower !== match.team_b.toLowerCase()
      ) {
        return interaction.reply(
          ephemeral(
            `❌ Result must be the winning team: **${match.team_a}** or **${match.team_b}**.`,
          ),
        );
      }
      result =
        lower === match.team_a.toLowerCase() ? match.team_a : match.team_b;
    }

    const { total, awarded } = resolveMatch(match, result);

    return interaction.reply(
      ephemeral(
        `🏁 Match \`${matchId}\` resolved — result: **${result}**.\n` +
          `Scored **${total}** prediction(s); **${awarded}** earned points.`,
      ),
    );
  },
};
