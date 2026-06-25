// /predict-cricket [match_number] [winner] [tournament_id?] — any member.
// The match is addressed by its per-tournament number (taken from this channel
// unless tournament_id is given).

const { SlashCommandBuilder } = require("discord.js");
const {
  upsertPrediction,
  isMatchOpenForPredictions,
  predictionState,
  resolveMatchByNumber,
} = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("predict-cricket")
    .setDescription("Predict the winning team of a cricket match")
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("winner")
        .setDescription("Name of the team you think will win")
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
    const winnerRaw = interaction.options.getString("winner").trim();
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    const lookup = resolveMatchByNumber({
      number: matchNumber,
      channelId: interaction.channelId,
      tournamentId: tournamentIdOption,
    });
    if (lookup.error) {
      return interaction.reply(ephemeral(`❌ ${lookup.error}`));
    }
    const match = lookup.match;
    if (match.type !== "cricket") {
      return interaction.reply(
        ephemeral(
          `❌ Match \`#${matchNumber}\` is a football match. Use \`/predict-football\`.`,
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

    upsertPrediction(match.id, interaction.user.id, winner);

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
