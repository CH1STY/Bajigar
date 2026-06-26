// /match-predictions [match_number] [tournament_id?] — any member.
// Lists everyone's predictions for a match. To avoid copying, the predicted
// values stay hidden while the match is still open; only the list of who has
// predicted is shown. Once predictions close, full values (and points) appear.
// The match is addressed by its per-tournament number (taken from this channel
// unless tournament_id is given).

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  getMatchPredictions,
  isMatchOpenForPredictions,
  resolveMatchByNumber,
} = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
const MAX_ROWS = 40;

/**
 * Build the predictions embed for a match.
 * @param {object} match - a match row (already fetched)
 * @returns {EmbedBuilder}
 */
function buildMatchPredictionsEmbed(match) {
  const predictions = getMatchPredictions(match.id);
  const open = isMatchOpenForPredictions(match);
  const resolved = match.status === "resolved";
  const emoji = TYPE_EMOJI[match.type] ?? "🎯";

  const status = resolved
    ? `✅ Resolved — result: **${match.result ?? "?"}**` +
      (match.is_knockout && match.tiebreaker_result
        ? ` · 🥅 tie-breaker **${match.tiebreaker_result}**`
        : "")
    : open
      ? `🟢 Open · closes ${toDiscordTimestamp(match.end_time)}`
      : "🔒 Closed";

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Predictions — Match #${match.match_number ?? match.id}`)
    .setColor(0x9b59b6)
    .setTimestamp();

  if (predictions.length === 0) {
    embed.setDescription(
      `**${match.team_a}** 🆚 **${match.team_b}**\n${status}\n\n` +
        "_No predictions yet._",
    );
    return embed;
  }

  let lines;
  if (open) {
    // Hide values until predictions close — only reveal who has predicted.
    lines = predictions.slice(0, MAX_ROWS).map((p) => `• <@${p.discord_id}>`);
  } else {
    lines = predictions.slice(0, MAX_ROWS).map((p) => {
      const points =
        resolved && p.points_earned > 0 ? ` · **+${p.points_earned}** pts` : "";
      const tb =
        match.is_knockout && p.tiebreaker_value
          ? ` · TB \`${p.tiebreaker_value}\``
          : "";
      return `• <@${p.discord_id}> — \`${p.predicted_value}\`${tb}${points}`;
    });
  }

  if (predictions.length > MAX_ROWS) {
    lines.push(`…and ${predictions.length - MAX_ROWS} more.`);
  }

  const hiddenNote = open
    ? "\n\n🔒 Predicted values are hidden until predictions close."
    : "";

  embed.setDescription(
    `**${match.team_a}** 🆚 **${match.team_b}** (${match.type}${match.is_knockout ? ", knockout" : ""})\n` +
      `${status}\n🗳️ ${predictions.length} prediction${predictions.length === 1 ? "" : "s"}\n\n` +
      lines.join("\n") +
      hiddenNote,
  );

  return embed;
}

module.exports = {
  buildMatchPredictionsEmbed,
  data: new SlashCommandBuilder()
    .setName("match-predictions")
    .setDescription("See everyone's predictions for a match")
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

    const embed = buildMatchPredictionsEmbed(lookup.match);
    return interaction.reply({ embeds: [embed] });
  },
};
