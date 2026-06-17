// /predict-football [match_id] [score] — any member.

const { SlashCommandBuilder } = require("discord.js");
const {
  db,
  getMatch,
  ensureUser,
  isMatchOpenForPredictions,
} = require("../../db/queries");
const { normalizeFootballScore } = require("../../utils/scoring");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");

// Upsert: overwrite an existing prediction while the match is still open.
const upsertPrediction = db.prepare(
  `INSERT INTO predictions (match_id, discord_id, predicted_value, points_earned)
   VALUES (?, ?, ?, 0)
   ON CONFLICT(match_id, discord_id)
   DO UPDATE SET predicted_value = excluded.predicted_value, points_earned = 0`,
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("predict-football")
    .setDescription("Predict a football score (e.g. 2-1)")
    .addIntegerOption((o) =>
      o.setName("match_id").setDescription("ID of the match").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("score")
        .setDescription('Score in "X-Y" format, e.g. 2-1')
        .setRequired(true),
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger("match_id");
    const scoreRaw = interaction.options.getString("score");

    const score = normalizeFootballScore(scoreRaw);
    if (!score) {
      return interaction.reply(
        ephemeral(
          "❌ Invalid score. Use the `X-Y` format, e.g. `2-1` or `0-0`.",
        ),
      );
    }

    const match = getMatch(matchId);
    if (!match) {
      return interaction.reply(
        ephemeral(`❌ No match found with ID \`${matchId}\`.`),
      );
    }
    if (match.type !== "football") {
      return interaction.reply(
        ephemeral(
          `❌ Match \`${matchId}\` is a cricket match. Use \`/predict-cricket\`.`,
        ),
      );
    }
    if (!isMatchOpenForPredictions(match)) {
      const reason =
        match.status !== "open"
          ? "predictions are locked"
          : `the deadline passed (${toDiscordTimestamp(match.end_time)})`;
      return interaction.reply(
        ephemeral(`❌ Cannot predict on match \`${matchId}\` — ${reason}.`),
      );
    }

    ensureUser(interaction.user.id);
    upsertPrediction.run(matchId, interaction.user.id, score);

    return interaction.reply(
      ephemeral(
        `✅ Prediction saved for **${match.team_a}** vs **${match.team_b}**: **${score}**.\n` +
          `You can change it until ${toDiscordTimestamp(match.end_time)}.`,
      ),
    );
  },
};
