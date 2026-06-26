// /match-reset [match_number] [end_time] [start_time?] [confirm] [tournament_id?]
// — Sports_Manager only.
// Reopens a (usually resolved) match for predictions: clears its result and
// tie-breaker, reverses every point it awarded, zeroes each prediction's score,
// and applies a fresh prediction window. Existing predictions are kept so users
// don't have to re-enter them. The match is addressed by its per-tournament
// number; the tournament is taken from this channel unless tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const {
  resolveMatchByNumber,
  resetMatch,
  getMatch,
} = require("../../db/queries");
const {
  parseEndTime,
  toDiscordTimestamp,
  buildEndTimeSuggestions,
  buildStartTimeSuggestions,
} = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const { runStartAnnouncementCheck } = require("../../utils/notifications");
const { TIMEZONE } = require("../../config/config");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-reset")
    .setDescription(
      "Reopen a match for predictions with a new window (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number to reset (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("end_time")
        .setDescription(
          `New deadline (${TIMEZONE}): "tomorrow 18:00", "in 2 hours", "17:00"`,
        )
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("start_time")
        .setDescription(
          `When predictions reopen (${TIMEZONE}): defaults to now; or "17:00", "in 1 hour"`,
        )
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("confirm")
        .setDescription(
          "Set to true to confirm — this clears the result and the points it awarded",
        )
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; use for standalone/other tournaments)",
        )
        .setRequired(false),
    ),

  // Suggest start/end time options as the manager types those fields.
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "end_time") {
      return interaction.respond(buildEndTimeSuggestions(focused.value));
    }
    if (focused.name === "start_time") {
      return interaction.respond(buildStartTimeSuggestions(focused.value));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    const matchNumber = interaction.options.getInteger("match_number");
    const endTimeRaw = interaction.options.getString("end_time");
    const startTimeRaw = interaction.options.getString("start_time");
    const confirm = interaction.options.getBoolean("confirm") ?? false;
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

    // Resolve the new prediction window. End must be in the future.
    const endTime = parseEndTime(endTimeRaw);
    if (endTime === null) {
      return interaction.reply(
        ephemeral(
          "❌ Could not understand `end_time`. Use a date like `tomorrow 18:00`, `in 2 hours`, or `17:00`.",
        ),
      );
    }
    if (endTime <= Date.now()) {
      return interaction.reply(
        ephemeral("❌ `end_time` must be in the future."),
      );
    }

    // Start time: default / "now" => open immediately (null).
    let startTime = null;
    if (startTimeRaw && startTimeRaw.toLowerCase() !== "now") {
      const parsedStart = parseEndTime(startTimeRaw);
      if (parsedStart === null) {
        return interaction.reply(
          ephemeral(
            "❌ Could not understand `start_time`. Try `now`, `17:00`, or `in 1 hour`.",
          ),
        );
      }
      if (parsedStart > Date.now()) startTime = parsedStart;
    }
    if (startTime !== null && startTime >= endTime) {
      return interaction.reply(
        ephemeral("❌ `start_time` must be before `end_time`."),
      );
    }

    const label = `**${match.team_a}** vs **${match.team_b}** (${match.type}${
      match.status === "resolved"
        ? `, was ${match.result}`
        : `, ${match.status}`
    })`;

    // Require explicit confirmation before clearing a result and its points.
    if (!confirm) {
      return interaction.reply(
        ephemeral(
          `⚠️ This will reopen match \`#${matchNumber}\` — ${label} — clearing its ` +
            "result and the points it awarded, then reopen predictions with the new " +
            "window. Existing predictions are kept (their points are zeroed).\n\n" +
            `Re-run with \`confirm: true\` to proceed.`,
        ),
      );
    }

    let summary;
    try {
      summary = resetMatch(match.id, startTime, endTime);
    } catch (err) {
      console.error("Error resetting match:", err);
      return interaction.reply(
        ephemeral("❌ Failed to reset the match. Please try again."),
      );
    }

    const pts = Number.isInteger(summary.pointsReversed)
      ? summary.pointsReversed
      : Number(summary.pointsReversed.toFixed(2));

    const openLine = startTime
      ? `⏱️ Predictions reopen: ${toDiscordTimestamp(startTime)}`
      : "▶️ Predictions open: now";

    await interaction.reply(
      ephemeral(
        `♻️ Reset match \`#${matchNumber}\` — ${label}.\n` +
          `Cleared **${summary.predictionsCleared}** prediction score(s)` +
          (pts ? `; reversed **${pts}** point(s).` : ".") +
          `\n${openLine}\n🔒 Predictions close: ${toDiscordTimestamp(endTime)}`,
      ),
    );

    const updated = getMatch(match.id);
    if (updated && updated.tournament_id) {
      await refreshDashboard(interaction.client, updated.tournament_id);
    }
    // Re-fire the "predictions open" announcement now the match is open again.
    await runStartAnnouncementCheck(interaction.client);
  },
};
