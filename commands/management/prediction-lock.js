// /prediction-lock [match_number] [tournament_id?] — Sports_Manager only.
// The match is addressed by its per-tournament number; the tournament is taken
// from this channel unless tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const { db, getTournament, resolveMatchByNumber } = require("../../db/queries");
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
      o
        .setName("match_number")
        .setDescription("Match number (as shown on the dashboard)")
        .setMinValue(1)
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

    if (match.status === "resolved") {
      return interaction.reply(
        ephemeral(`❌ Match \`#${matchNumber}\` is already resolved.`),
      );
    }
    if (match.status === "closed") {
      return interaction.reply(
        ephemeral(`ℹ️ Match \`#${matchNumber}\` is already locked.`),
      );
    }

    lockMatch.run(match.id);
    match.status = "closed";
    await interaction.reply(
      ephemeral(
        `🔒 Predictions locked for match \`#${matchNumber}\` (**${match.team_a}** vs **${match.team_b}**).`,
      ),
    );

    // Post the full predictions list and refresh the tournament dashboard.
    await postClosedPredictions(interaction.client, match);
    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
