// /predict-football [match_id] [score] — any member.

const { SlashCommandBuilder } = require("discord.js");
const {
  getMatch,
  upsertPrediction,
  isMatchOpenForPredictions,
  predictionState,
} = require("../../db/queries");
const { normalizeFootballScore } = require("../../utils/scoring");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

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
        .setDescription(
          "Goals as firstTeam-secondTeam (same order as the match), e.g. 2-1",
        )
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
      const state = predictionState(match);
      const reason =
        state === "pending"
          ? `predictions open ${toDiscordTimestamp(match.start_time)}`
          : state === "ended"
            ? `the deadline passed (${toDiscordTimestamp(match.end_time)})`
            : "predictions are locked";
      return interaction.reply(
        ephemeral(`❌ Cannot predict on match \`${matchId}\` — ${reason}.`),
      );
    }

    upsertPrediction(matchId, interaction.user.id, score);

    const [ga, gb] = score.split("-");
    await interaction.reply(
      ephemeral(
        `✅ Prediction saved: **${match.team_a} ${ga} – ${gb} ${match.team_b}** (\`${score}\`).\n` +
          `You can change it until ${toDiscordTimestamp(match.end_time)}.`,
      ),
    );
    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
