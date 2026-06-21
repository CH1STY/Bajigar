// /leaderboard-tournament [tournament_id] — any member. Per-tournament top scores.

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { db, getTournament } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { buildPaginatedResponse } = require("../../utils/pagination");

const ITEMS_PER_PAGE = 10;

// Sum points earned from predictions whose match belongs to the tournament.
const tournamentTop = db.prepare(
  `SELECT p.discord_id AS discord_id, SUM(p.points_earned) AS points
   FROM predictions p
   JOIN matches m ON m.id = p.match_id
   WHERE m.tournament_id = ?
   GROUP BY p.discord_id
   HAVING points > 0
   ORDER BY points DESC`,
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard-tournament")
    .setDescription("Show the top predictors for a specific tournament")
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription("ID of the tournament")
        .setRequired(true),
    ),

  async execute(interaction) {
    const tournamentId = interaction.options.getInteger("tournament_id");
    const tournament = getTournament(tournamentId);
    if (!tournament) {
      return interaction.reply(
        ephemeral(`❌ No tournament found with ID \`${tournamentId}\`.`),
      );
    }

    const rows = tournamentTop.all(tournamentId);

    if (rows.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${tournament.name} — Leaderboard`)
        .setColor(0xf1c40f)
        .setDescription("No scores recorded yet.");
      return interaction.reply({ embeds: [embed] });
    }

    const sessionKey = `lt:${tournamentId}:${interaction.user.id}`;

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
          .setTitle(`🏆 ${tournament.name} — Leaderboard`)
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
