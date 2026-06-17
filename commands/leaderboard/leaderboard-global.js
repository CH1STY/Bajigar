// /leaderboard-global — any member. Server-wide top scores.

const { SlashCommandBuilder } = require("discord.js");
const { db } = require("../../db/queries");
const { leaderboardEmbed } = require("../../utils/embeds");
const { LEADERBOARD_LIMIT } = require("../../config/config");

const topUsers = db.prepare(
  `SELECT discord_id, global_points AS points
   FROM users
   WHERE global_points > 0
   ORDER BY global_points DESC
   LIMIT ?`,
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard-global")
    .setDescription("Show the server-wide top predictors"),

  async execute(interaction) {
    const rows = topUsers.all(LEADERBOARD_LIMIT);
    const embed = leaderboardEmbed("🌍 Global Leaderboard", rows);
    return interaction.reply({ embeds: [embed] });
  },
};
