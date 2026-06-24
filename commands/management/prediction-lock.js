// /prediction-lock [match_id] — Sports_Manager only.

const { SlashCommandBuilder } = require("discord.js");
const { db, getMatch, getTournament } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const {
  buildMatchPredictionsEmbed,
} = require("../prediction/match-predictions");

const lockMatch = db.prepare(
  "UPDATE matches SET status = 'closed' WHERE id = ?",
);

/**
 * Post the match-predictions list to the tournament channel for a closed match.
 * Best-effort: failures are logged and never block the command.
 */
async function postClosedPredictions(client, match) {
  if (!match.tournament_id) return;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || !tournament.channel_id) return;
  try {
    const channel = await client.channels.fetch(tournament.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const embed = buildMatchPredictionsEmbed(match);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Error posting closed-match predictions:", err);
  }
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("prediction-lock")
    .setDescription(
      "Manually lock a match from further predictions (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o.setName("match_id").setDescription("ID of the match").setRequired(true),
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger("match_id");
    const match = getMatch(matchId);

    if (!match) {
      return interaction.reply(
        ephemeral(`❌ No match found with ID \`${matchId}\`.`),
      );
    }
    if (match.status === "resolved") {
      return interaction.reply(
        ephemeral(`❌ Match \`${matchId}\` is already resolved.`),
      );
    }
    if (match.status === "closed") {
      return interaction.reply(
        ephemeral(`ℹ️ Match \`${matchId}\` is already locked.`),
      );
    }

    lockMatch.run(matchId);
    match.status = "closed";
    await interaction.reply(
      ephemeral(
        `🔒 Predictions locked for match \`${matchId}\` (**${match.team_a}** vs **${match.team_b}**).`,
      ),
    );

    // Post the full predictions list and refresh the tournament dashboard.
    await postClosedPredictions(interaction.client, match);
    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
