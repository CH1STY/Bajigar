// /prediction-lock [match_id] — Sports_Manager only.

const { SlashCommandBuilder } = require("discord.js");
const { db, getMatch } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");

const lockMatch = db.prepare(
  "UPDATE matches SET status = 'closed' WHERE id = ?",
);

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
    return interaction.reply(
      ephemeral(
        `🔒 Predictions locked for match \`${matchId}\` (**${match.team_a}** vs **${match.team_b}**).`,
      ),
    );
  },
};
