// /my-predictions — any member.
// Shows the caller their own prediction history with each match's result and
// the points they earned. Private (ephemeral) so it never leaks open picks.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { getUserPredictions, predictionState } = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { buildPaginatedResponse } = require("../../utils/pagination");

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
const ITEMS_PER_PAGE = 5;

const STATE_TAG = {
  resolved: "✅ Resolved",
  open: "🟢 Open",
  pending: "🕒 Upcoming",
  ended: "🔒 Closed",
  locked: "🔒 Closed",
  missing: "❔ Unknown",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("my-predictions")
    .setDescription("See your own prediction history and results"),

  async execute(interaction) {
    const rows = getUserPredictions(interaction.user.id);

    if (rows.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("🗒️ Your Predictions")
        .setColor(0x2ecc71)
        .setDescription(
          "You haven't made any predictions yet. Use `/predict-football`, " +
            "`/predict-cricket`, or tap a match on a tournament dashboard.",
        )
        .setTimestamp();
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Calculate totals from all predictions
    let totalPoints = 0;
    let resolvedCount = 0;
    rows.forEach((r) => {
      if (predictionState(r) === "resolved") {
        resolvedCount += 1;
        totalPoints += r.points_earned;
      }
    });

    const sessionKey = `mp:${interaction.user.id}`;

    const { embed, components } = buildPaginatedResponse({
      sessionKey,
      items: rows,
      itemsPerPage: ITEMS_PER_PAGE,
      page: 1,
      formatItems: (pageItems) => {
        const blocks = pageItems.map((r) => {
          const state = predictionState(r);
          const emoji = TYPE_EMOJI[r.type] ?? "🎯";
          const tag = STATE_TAG[state] ?? "❔";
          const where = r.tournament_name ? ` · ${r.tournament_name}` : "";

          let outcome;
          if (state === "resolved") {
            const hit = r.points_earned > 0;
            outcome =
              `result: **${r.result ?? "?"}** · ` +
              (hit ? `🏅 **+${r.points_earned}** pts` : "❌ 0 pts");
          } else {
            outcome = `closes ${toDiscordTimestamp(r.end_time)}`;
          }

          return (
            `**#${r.match_number ?? r.match_id} ${emoji} ${r.team_a} 🆚 ${r.team_b}**${where}\n` +
            `> ${tag} · your pick: \`${r.predicted_value}\`\n` +
            `> ${outcome}`
          );
        });
        return blocks.join("\n\n");
      },
      buildEmbed: (description, currentPage, totalPages) => {
        const summary = `📊 **Total: ${totalPoints} pts earned** · ${resolvedCount} resolved\n\n`;
        const embed = new EmbedBuilder()
          .setTitle("🗒️ Your Predictions")
          .setColor(0x2ecc71)
          .setDescription(summary + description)
          .setFooter({
            text: `${rows.length} prediction${rows.length === 1 ? "" : "s"} • Page ${currentPage}/${totalPages}`,
          })
          .setTimestamp();
        return embed;
      },
    });

    return interaction.reply({
      embeds: [embed],
      components: components || [],
      flags: MessageFlags.Ephemeral,
    });
  },
};
