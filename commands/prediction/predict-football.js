// /predict-football [match_number] [score] [tournament_id?] — any member.
// The match is addressed by its per-tournament number (taken from this channel
// unless tournament_id is given).

const { SlashCommandBuilder } = require("discord.js");
const {
  upsertPrediction,
  isMatchOpenForPredictions,
  predictionState,
  resolveMatchByNumber,
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
      o
        .setName("match_number")
        .setDescription("Match number (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("score")
        .setDescription(
          "Goals as firstTeam-secondTeam (same order as the match), e.g. 2-1",
        )
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; use for standalone/other tournaments)",
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    const matchNumber = interaction.options.getInteger("match_number");
    const scoreRaw = interaction.options.getString("score");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    const score = normalizeFootballScore(scoreRaw);
    if (!score) {
      return interaction.reply(
        ephemeral(
          "❌ Invalid score. Use the `X-Y` format, e.g. `2-1` or `0-0`.",
        ),
      );
    }

    const lookup = resolveMatchByNumber({
      number: matchNumber,
      channelId: interaction.channelId,
      tournamentId: tournamentIdOption,
    });
    if (lookup.error) {
      return interaction.reply(ephemeral(`❌ ${lookup.error}`));
    }
    const match = lookup.match;
    if (match.type !== "football") {
      return interaction.reply(
        ephemeral(
          `❌ Match \`#${matchNumber}\` is a cricket match. Use \`/predict-cricket\`.`,
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
        ephemeral(
          `❌ Cannot predict on match \`#${matchNumber}\` — ${reason}.`,
        ),
      );
    }

    upsertPrediction(match.id, interaction.user.id, score);

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
