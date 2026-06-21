// /leaderboard-global — any member. Server-wide top scores.

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { db } = require("../../db/queries");
const { buildPaginatedResponse } = require("../../utils/pagination");

const ITEMS_PER_PAGE = 10;

const topUsers = db.prepare(
  `SELECT discord_id, global_points AS points
   FROM users
   WHERE global_points > 0
   ORDER BY global_points DESC`,
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard-global")
    .setDescription("Show the server-wide top predictors"),

  async execute(interaction) {
    const rows = topUsers.all();

    if (rows.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle("🌍 Global Leaderboard")
        .setColor(0xf1c40f)
        .setDescription("No scores recorded yet.");
      return interaction.reply({ embeds: [embed] });
    }

    const sessionKey = "lg";

    const { embed, components } = buildPaginatedResponse({
      sessionKey,
      items: rows,
      itemsPerPage: ITEMS_PER_PAGE,
      page: 1,
      formatItems: (pageItems) => {
        const medals = ["🥇", "🥈", "🥉"];
        const lines = pageItems.map((row, i) => {
          // Calculate rank based on position in full list
          const fullIndex = rows.indexOf(row);
          const rank = medals[fullIndex] ?? `**${fullIndex + 1}.**`;
          return `${rank} <@${row.discord_id}> — **${row.points}** pts`;
        });
        return lines.join("\n");
      },
      buildEmbed: (description, currentPage, totalPages) => {
        const embed = new EmbedBuilder()
          .setTitle("🌍 Global Leaderboard")
          .setColor(0xf1c40f)
          .setDescription(description)
          .setFooter({
            text: `${rows.length} user${rows.length === 1 ? "" : "s"} · Page ${currentPage}/${totalPages}`,
          });
        return embed;
      },
    });

    return interaction.reply({ embeds: [embed], components: components || [] });
  },
};
