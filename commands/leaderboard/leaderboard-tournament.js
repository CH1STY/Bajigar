// /leaderboard-tournament [tournament_id] — any member. Per-tournament top scores.

const { SlashCommandBuilder } = require("discord.js");
const { db, getTournament } = require("../../db/queries");
const { leaderboardEmbed, ephemeral } = require("../../utils/embeds");
const { LEADERBOARD_LIMIT } = require("../../config/config");

// Sum points earned from predictions whose match belongs to the tournament.
const tournamentTop = db.prepare(
  `SELECT p.discord_id AS discord_id, SUM(p.points_earned) AS points
   FROM predictions p
   JOIN matches m ON m.id = p.match_id
   WHERE m.tournament_id = ?
   GROUP BY p.discord_id
   HAVING points > 0
   ORDER BY points DESC
   LIMIT ?`,
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

    const rows = tournamentTop.all(tournamentId, LEADERBOARD_LIMIT);
    const embed = leaderboardEmbed(`🏆 ${tournament.name} — Leaderboard`, rows);
    return interaction.reply({ embeds: [embed] });
  },
};
