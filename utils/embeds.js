// Small helpers for building consistent embeds & replies.

const { EmbedBuilder, MessageFlags } = require("discord.js");

/** A standard ephemeral reply (private to the user). */
function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

/**
 * Build a leaderboard embed from ranked rows.
 * @param {string} title
 * @param {Array<{ discord_id: string, points: number }>} rows
 */
function leaderboardEmbed(title, rows) {
  const embed = new EmbedBuilder().setTitle(title).setColor(0xf1c40f);

  if (rows.length === 0) {
    embed.setDescription("No scores recorded yet.");
    return embed;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((row, i) => {
    const rank = medals[i] ?? `**${i + 1}.**`;
    return `${rank} <@${row.discord_id}> — **${row.points}** pts`;
  });

  embed.setDescription(lines.join("\n"));
  return embed;
}

module.exports = { ephemeral, leaderboardEmbed };
