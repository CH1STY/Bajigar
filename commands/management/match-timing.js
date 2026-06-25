// /match-timing [match_number] [start_time?] [end_time?] [tournament_id?] — Sports_Manager only.
// Allows editing the start time and/or end time of a prediction match.
// The match is addressed by its per-tournament number; the tournament is taken
// from this channel unless tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const {
  getMatch,
  resolveMatchByNumber,
  updateMatchTimes,
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
    .setName("match-timing")
    .setDescription(
      "Edit the start/end time of a prediction match (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number to edit (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("start_time")
        .setDescription(
          `When predictions open (${TIMEZONE}): "now", "17:00", "in 1 hour", etc. (leave blank to keep current)`,
        )
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("end_time")
        .setDescription(
          `Deadline (${TIMEZONE}): "tomorrow 18:00", "in 2 hours", etc. (leave blank to keep current)`,
        )
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; use for standalone/other tournaments)",
        )
        .setRequired(false),
    ),

  // Suggest time options as the manager types
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
    const startTimeRaw = interaction.options.getString("start_time");
    const endTimeRaw = interaction.options.getString("end_time");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    // getString() returns null when an option isn't provided.
    const startProvided = startTimeRaw !== null;
    const endProvided = endTimeRaw !== null;

    // At least one time must be provided
    if (!startProvided && !endProvided) {
      return interaction.reply(
        ephemeral(
          "❌ Please provide at least one of `start_time` or `end_time` to update.",
        ),
      );
    }

    // Resolve the match by its per-tournament number.
    const lookup = resolveMatchByNumber({
      number: matchNumber,
      channelId: interaction.channelId,
      tournamentId: tournamentIdOption,
    });
    if (lookup.error) {
      return interaction.reply(ephemeral(`❌ ${lookup.error}`));
    }
    const match = lookup.match;

    // Can't edit resolved matches
    if (match.status === "resolved") {
      return interaction.reply(
        ephemeral("❌ Cannot edit timing for a resolved match."),
      );
    }

    // Start with the match's existing values; only overwrite what was provided.
    let finalStartTime = match.start_time;
    let finalEndTime = match.end_time;

    // Parse start_time if provided
    if (startProvided) {
      if (startTimeRaw.toLowerCase() === "now") {
        // "now" => open immediately (clear the scheduled start)
        finalStartTime = null;
      } else {
        const parsedStart = parseEndTime(startTimeRaw);
        if (parsedStart === null) {
          return interaction.reply(
            ephemeral(
              "❌ Could not understand `start_time`. Try `now`, `17:00`, or `in 1 hour`.",
            ),
          );
        }
        // Treat a start at/under the current time as "open now".
        finalStartTime = parsedStart > Date.now() ? parsedStart : null;
      }
    }

    // Parse end_time if provided
    if (endProvided) {
      const parsedEnd = parseEndTime(endTimeRaw);
      if (parsedEnd === null) {
        return interaction.reply(
          ephemeral(
            "❌ Could not understand `end_time`. Use a date like `tomorrow 18:00`, `in 2 hours`, or `17:00`.",
          ),
        );
      }
      if (parsedEnd <= Date.now()) {
        return interaction.reply(
          ephemeral("❌ `end_time` must be in the future."),
        );
      }
      finalEndTime = parsedEnd;
    }

    // Smart validation: the start (if any) must come before the end.
    // This covers all cases — changing only start, only end, or both.
    if (finalStartTime !== null && finalStartTime >= finalEndTime) {
      const detail = startProvided
        ? "the new `start_time` must be before the match's end time"
        : "the new `end_time` must be after the match's start time";
      return interaction.reply(ephemeral(`❌ Invalid timing: ${detail}.`));
    }

    // Update the match times (writes both final values directly).
    try {
      updateMatchTimes(match.id, finalStartTime, finalEndTime);
    } catch (err) {
      console.error("Error updating match times:", err);
      return interaction.reply(
        ephemeral("❌ Failed to update match timing. Please try again."),
      );
    }

    // Build confirmation message
    const updates = [];
    if (startProvided) {
      if (finalStartTime === null) {
        updates.push(`⏱️ Predictions now open immediately`);
      } else {
        updates.push(
          `⏱️ Predictions open: ${toDiscordTimestamp(finalStartTime)}`,
        );
      }
    }
    if (endProvided) {
      updates.push(`🔒 Predictions close: ${toDiscordTimestamp(finalEndTime)}`);
    }

    await interaction.reply(
      ephemeral(
        `✅ Match \`#${matchNumber}\` timing updated:\n${updates.join("\n")}`,
      ),
    );

    // Refresh the dashboard if the match is in a tournament
    // Re-fetch the match to ensure we have current tournament_id
    const updatedMatch = getMatch(match.id);
    if (updatedMatch && updatedMatch.tournament_id) {
      console.log(
        `🔄 Refreshing dashboard for tournament ${updatedMatch.tournament_id} after match timing update`,
      );
      await refreshDashboard(interaction.client, updatedMatch.tournament_id);
    } else if (!updatedMatch) {
      console.warn(
        `⚠️ Could not re-fetch match #${matchNumber} after timing update`,
      );
    } else {
      console.log(
        `ℹ️ Match #${matchNumber} has no tournament (standalone), skipping dashboard refresh`,
      );
    }

    // If the match is now open or newly scheduled to open,
    // trigger the start announcement check
    await runStartAnnouncementCheck(interaction.client);
  },
};
