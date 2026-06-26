// /match-delete [match_number] [confirm] [tournament_id?] — Sports_Manager only.
// Permanently removes a match together with its predictions and any stored
// Player-Analysis lineup. If the match was resolved, the points it awarded are
// reversed from the global leaderboard first. The match is addressed by its
// per-tournament number; the tournament is taken from this channel unless
// tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const { resolveMatchByNumber, deleteMatch } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-delete")
    .setDescription(
      "Permanently delete a match and its predictions (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number to delete (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("confirm")
        .setDescription(
          "Set to true to confirm — this permanently deletes the match and cannot be undone",
        )
        .setRequired(false),
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
    const confirm = interaction.options.getBoolean("confirm") ?? false;
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

    const label = `**${match.team_a}** vs **${match.team_b}** (${match.type}${
      match.status === "resolved" ? `, resolved ${match.result}` : ""
    })`;

    // Require explicit confirmation before destroying data.
    if (!confirm) {
      return interaction.reply(
        ephemeral(
          `⚠️ This will permanently delete match \`#${matchNumber}\` — ${label} — ` +
            "along with every prediction and any lineup data. Points it awarded " +
            "will be removed from the leaderboard.\n\n" +
            `Re-run with \`confirm: true\` to proceed:\n` +
            `\`/match-delete match_number:${matchNumber} confirm:true\``,
        ),
      );
    }

    let summary;
    try {
      summary = deleteMatch(match.id);
    } catch (err) {
      console.error("Error deleting match:", err);
      return interaction.reply(
        ephemeral("❌ Failed to delete the match. Please try again."),
      );
    }

    const pts = Number.isInteger(summary.pointsReversed)
      ? summary.pointsReversed
      : Number(summary.pointsReversed.toFixed(2));

    await interaction.reply(
      ephemeral(
        `🗑️ Deleted match \`#${matchNumber}\` — ${label}.\n` +
          `Removed **${summary.predictionsRemoved}** prediction(s)` +
          (pts ? `; reversed **${pts}** point(s) from the leaderboard.` : "."),
      ),
    );

    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
