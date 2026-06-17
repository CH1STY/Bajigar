// /predict-cricket [match_id] [winner] — any member.

const { SlashCommandBuilder } = require("discord.js");
const {
  getMatch,
  upsertPrediction,
  isMatchOpenForPredictions,
  predictionState,
} = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("predict-cricket")
    .setDescription("Predict the winning team of a cricket match")
    .addIntegerOption((o) =>
      o.setName("match_id").setDescription("ID of the match").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("winner")
        .setDescription("Name of the team you think will win")
        .setRequired(true),
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger("match_id");
    const winnerRaw = interaction.options.getString("winner").trim();

    const match = getMatch(matchId);
    if (!match) {
      return interaction.reply(
        ephemeral(`❌ No match found with ID \`${matchId}\`.`),
      );
    }
    if (match.type !== "cricket") {
      return interaction.reply(
        ephemeral(
          `❌ Match \`${matchId}\` is a football match. Use \`/predict-football\`.`,
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

    // Winner must be one of the two teams.
    const lower = winnerRaw.toLowerCase();
    let winner = null;
    if (lower === match.team_a.toLowerCase()) winner = match.team_a;
    else if (lower === match.team_b.toLowerCase()) winner = match.team_b;

    if (!winner) {
      return interaction.reply(
        ephemeral(
          `❌ Pick one of the teams: **${match.team_a}** or **${match.team_b}**.`,
        ),
      );
    }

    upsertPrediction(matchId, interaction.user.id, winner);

    await interaction.reply(
      ephemeral(
        `✅ Prediction saved for **${match.team_a}** vs **${match.team_b}**: **${winner}** to win.\n` +
          `You can change it until ${toDiscordTimestamp(match.end_time)}.`,
      ),
    );
    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
