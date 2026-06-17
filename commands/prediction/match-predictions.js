// /match-predictions [match_id] — any member.
// Lists everyone's predictions for a match. To avoid copying, the predicted
// values stay hidden while the match is still open; only the list of who has
// predicted is shown. Once predictions close, full values (and points) appear.

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  getMatch,
  getMatchPredictions,
  isMatchOpenForPredictions,
} = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
const MAX_ROWS = 40;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("match-predictions")
    .setDescription("See everyone's predictions for a match")
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

    const predictions = getMatchPredictions(matchId);
    const open = isMatchOpenForPredictions(match);
    const resolved = match.status === "resolved";
    const emoji = TYPE_EMOJI[match.type] ?? "🎯";

    const status = resolved
      ? `✅ Resolved — result: **${match.result ?? "?"}**`
      : open
        ? `🟢 Open · closes ${toDiscordTimestamp(match.end_time)}`
        : "🔒 Closed";

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} Predictions — Match #${match.id}`)
      .setColor(0x9b59b6)
      .setTimestamp();

    if (predictions.length === 0) {
      embed.setDescription(
        `**${match.team_a}** 🆚 **${match.team_b}**\n${status}\n\n` +
          "_No predictions yet._",
      );
      return interaction.reply({ embeds: [embed] });
    }

    let lines;
    if (open) {
      // Hide values until predictions close — only reveal who has predicted.
      lines = predictions.slice(0, MAX_ROWS).map((p) => `• <@${p.discord_id}>`);
    } else {
      lines = predictions.slice(0, MAX_ROWS).map((p) => {
        const points =
          resolved && p.points_earned > 0
            ? ` · **+${p.points_earned}** pts`
            : "";
        return `• <@${p.discord_id}> — \`${p.predicted_value}\`${points}`;
      });
    }

    if (predictions.length > MAX_ROWS) {
      lines.push(`…and ${predictions.length - MAX_ROWS} more.`);
    }

    const hiddenNote = open
      ? "\n\n🔒 Predicted values are hidden until predictions close."
      : "";

    embed.setDescription(
      `**${match.team_a}** 🆚 **${match.team_b}** (${match.type})\n` +
        `${status}\n🗳️ ${predictions.length} prediction${predictions.length === 1 ? "" : "s"}\n\n` +
        lines.join("\n") +
        hiddenNote,
    );

    return interaction.reply({ embeds: [embed] });
  },
};
