// /predict-cricket [match_id] [winner] — any member.

const { SlashCommandBuilder } = require("discord.js");
const {
  db,
  getMatch,
  ensureUser,
  isMatchOpenForPredictions,
} = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");

const upsertPrediction = db.prepare(
  `INSERT INTO predictions (match_id, discord_id, predicted_value, points_earned)
   VALUES (?, ?, ?, 0)
   ON CONFLICT(match_id, discord_id)
   DO UPDATE SET predicted_value = excluded.predicted_value, points_earned = 0`,
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("predict-cricket")
    .setDescription("Predict the winning team of a cricket match")
    .addIntegerOption((o) =>
      o.setName("match_id").setDescription("ID of the match").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("winner")
        .setDescription("Name of the team you think will win")
        .setRequired(true),
    ),

  async execute(interaction) {
    const matchId = interaction.options.getInteger("match_id");
    const winnerRaw = interaction.options.getString("winner").trim();

    const match = getMatch(matchId);
    if (!match) {
      return interaction.reply(
        ephemeral(`❌ No match found with ID \`${matchId}\`.`),
      );
    }
    if (match.type !== "cricket") {
      return interaction.reply(
        ephemeral(
          `❌ Match \`${matchId}\` is a football match. Use \`/predict-football\`.`,
        ),
      );
    }
    if (!isMatchOpenForPredictions(match)) {
      const reason =
        match.status !== "open"
          ? "predictions are locked"
          : `the deadline passed (${toDiscordTimestamp(match.end_time)})`;
      return interaction.reply(
        ephemeral(`❌ Cannot predict on match \`${matchId}\` — ${reason}.`),
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

    ensureUser(interaction.user.id);
    upsertPrediction.run(matchId, interaction.user.id, winner);

    return interaction.reply(
      ephemeral(
        `✅ Prediction saved for **${match.team_a}** vs **${match.team_b}**: **${winner}** to win.\n` +
          `You can change it until ${toDiscordTimestamp(match.end_time)}.`,
      ),
    );
  },
};
