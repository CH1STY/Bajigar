// /dashboard-refresh [tournament_id?] — Sports_Manager only.
// Manually refresh the tournament's live dashboard.
// Tournament is inferred from the current channel; tournament_id overrides it.

const { SlashCommandBuilder } = require("discord.js");
const { getTournament, getTournamentByChannel } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("dashboard-refresh")
    .setDescription(
      "Manually refresh the tournament dashboard (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID to refresh (defaults to this channel's tournament)",
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    // Resolve the tournament:
    //   1. explicit tournament_id, else
    //   2. the tournament linked to this channel.
    let tournament = null;
    if (tournamentIdOption !== null) {
      tournament = getTournament(tournamentIdOption);
      if (!tournament) {
        return interaction.reply(
          ephemeral(
            `❌ No tournament found with ID \`${tournamentIdOption}\`.`,
          ),
        );
      }
    } else {
      tournament = getTournamentByChannel(interaction.channelId);
      if (!tournament) {
        return interaction.reply(
          ephemeral(
            "❌ This channel is not linked to a tournament. Provide a `tournament_id` or use this command in a tournament channel.",
          ),
        );
      }
    }

    // Check that the tournament has a channel
    if (!tournament.channel_id) {
      return interaction.reply(
        ephemeral(
          `❌ Tournament **${tournament.name}** has no associated Discord channel.`,
        ),
      );
    }

    try {
      await interaction.reply(
        ephemeral(`🔄 Refreshing dashboard for **${tournament.name}**...`),
      );

      await refreshDashboard(interaction.client, tournament.id);

      await interaction.editReply(
        ephemeral(`✅ Dashboard refreshed for **${tournament.name}**.`),
      );
    } catch (err) {
      console.error("Error refreshing dashboard:", err);
      await interaction.editReply(
        ephemeral("❌ Failed to refresh dashboard. Check logs for details."),
      );
    }
  },
};
