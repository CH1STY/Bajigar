// /my-predictions — any member.
// Shows the caller their own prediction history with each match's result and
// the points they earned. Private (ephemeral) so it never leaks open picks.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { getUserPredictions, predictionState } = require("../../db/queries");
const { toDiscordTimestamp } = require("../../utils/time");

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
const MAX_ROWS = 25;

const STATE_TAG = {
  resolved: "✅ Resolved",
  open: "🟢 Open",
  pending: "🕒 Upcoming",
  ended: "🔒 Closed",
  locked: "🔒 Closed",
  missing: "❔ Unknown",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("my-predictions")
    .setDescription("See your own prediction history and results"),

  async execute(interaction) {
    const rows = getUserPredictions(interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle("🗒️ Your Predictions")
      .setColor(0x2ecc71)
      .setTimestamp();

    if (rows.length === 0) {
      embed.setDescription(
        "You haven't made any predictions yet. Use `/predict-football`, " +
          "`/predict-cricket`, or tap a match on a tournament dashboard.",
      );
      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    let totalPoints = 0;
    let resolvedCount = 0;

    const blocks = rows.slice(0, MAX_ROWS).map((r) => {
      const state = predictionState(r);
      const emoji = TYPE_EMOJI[r.type] ?? "🎯";
      const tag = STATE_TAG[state] ?? "❔";
      const where = r.tournament_name ? ` · ${r.tournament_name}` : "";

      let outcome;
      if (state === "resolved") {
        resolvedCount += 1;
        totalPoints += r.points_earned;
        const hit = r.points_earned > 0;
        outcome =
          `result: **${r.result ?? "?"}** · ` +
          (hit ? `🏅 **+${r.points_earned}** pts` : "❌ 0 pts");
      } else {
        outcome = `closes ${toDiscordTimestamp(r.end_time)}`;
      }

      return (
        `**#${r.match_id} ${emoji} ${r.team_a} 🆚 ${r.team_b}**${where}\n` +
        `> ${tag} · your pick: \`${r.predicted_value}\`\n` +
        `> ${outcome}`
      );
    });

    if (rows.length > MAX_ROWS) {
      blocks.push(`…and ${rows.length - MAX_ROWS} more.`);
    }

    embed.setDescription(blocks.join("\n\n"));
    embed.setFooter({
      text: `${rows.length} prediction${rows.length === 1 ? "" : "s"} · ${resolvedCount} resolved · ${totalPoints} pts earned`,
    });

    return interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};
