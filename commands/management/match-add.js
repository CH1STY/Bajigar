// /match-add [type] [team_a] [team_b] [end_time] [tournament_id?] — Sports_Manager only.
// The tournament is inferred from the channel; tournament_id overrides it.
// With no tournament context, the match is created standalone (tournament_id NULL).

const { SlashCommandBuilder } = require("discord.js");
const {
  db,
  getTournament,
  getTournamentByChannel,
  getUsedMatchNumbers,
  nextMatchNumber,
} = require("../../db/queries");
const {
  parseEndTime,
  toDiscordTimestamp,
  buildEndTimeSuggestions,
  buildStartTimeSuggestions,
} = require("../../utils/time");
const {
  normalizeFootballScore,
  normalizeTiebreakerScore,
} = require("../../utils/scoring");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const { runStartAnnouncementCheck } = require("../../utils/notifications");
const { TIMEZONE } = require("../../config/config");

const insertMatch = db.prepare(
  `INSERT INTO matches (tournament_id, type, team_a, team_b, status, match_number, is_knockout, start_time, end_time, result, tiebreaker_result)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-add")
    .setDescription("Add a match to a tournament (Sports_Manager only)")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Match type")
        .setRequired(true)
        .addChoices(
          { name: "football", value: "football" },
          { name: "cricket", value: "cricket" },
        ),
    )
    .addStringOption((o) =>
      o.setName("team_a").setDescription("First team").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("team_b").setDescription("Second team").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("end_time")
        .setDescription(
          `Deadline (${TIMEZONE}): pick a suggestion or type "tomorrow 18:00", "in 2 hours", "17:00"`,
        )
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("start_time")
        .setDescription(
          `When predictions open (${TIMEZONE}): defaults to Now; or type "17:00", "in 1 hour"`,
        )
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("result")
        .setDescription(
          'Add an already-finished match: football "X-Y" score, or cricket winning team name',
        )
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o
        .setName("knockout")
        .setDescription(
          "Knockout football match: needs a winner; predictors also pick the tie-breaker score",
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("tiebreaker")
        .setDescription(
          'For a resolved knockout that went to penalties: the tie-breaker "X-Y" score',
        )
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription(
          "Custom match number (defaults to the next number in the tournament)",
        )
        .setMinValue(1)
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; omit for a standalone match)",
        )
        .setRequired(false),
    ),

  // Suggests start/end time options as the manager types those fields.
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
    const type = interaction.options.getString("type");
    const teamA = interaction.options.getString("team_a").trim();
    const teamB = interaction.options.getString("team_b").trim();
    const endTimeRaw = interaction.options.getString("end_time");
    const startTimeRaw = interaction.options.getString("start_time");
    const resultRaw = interaction.options.getString("result");
    const isKnockout = interaction.options.getBoolean("knockout") ?? false;
    const tiebreakerRaw = interaction.options.getString("tiebreaker");
    const matchNumberOption = interaction.options.getInteger("match_number");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    const hasResult = resultRaw !== null && resultRaw.trim() !== "";
    const hasTiebreaker = tiebreakerRaw !== null && tiebreakerRaw.trim() !== "";

    // Knockout is a football-only concept (cricket already requires a winner).
    if (isKnockout && type !== "football") {
      return interaction.reply(
        ephemeral("❌ `knockout` is only available for football matches."),
      );
    }
    if (hasTiebreaker && !isKnockout) {
      return interaction.reply(
        ephemeral("❌ `tiebreaker` is only valid for knockout matches."),
      );
    }
    if (hasTiebreaker && !hasResult) {
      return interaction.reply(
        ephemeral(
          "❌ A `tiebreaker` score only applies to an already-finished match (provide `result` too).",
        ),
      );
    }

    // Resolve the tournament:
    //   1. explicit tournament_id, else
    //   2. the tournament linked to this channel, else
    //   3. none -> standalone match.
    let tournament = null;
    if (tournamentIdOption !== null) {
      tournament = getTournament(tournamentIdOption);
      if (!tournament) {
        return interaction.reply(
          ephemeral(
            `❌ No tournament found with ID \`${tournamentIdOption}\`.`,
          ),
        );
      }
    } else {
      tournament = getTournamentByChannel(interaction.channelId) ?? null;
    }

    // Only block adding *open* matches to a non-active tournament. Historical
    // (already-resolved) matches may be back-filled into any tournament.
    if (tournament && tournament.status !== "active" && !hasResult) {
      return interaction.reply(
        ephemeral(`❌ Tournament **${tournament.name}** is not active.`),
      );
    }

    const endTime = parseEndTime(endTimeRaw);
    if (endTime === null) {
      return interaction.reply(
        ephemeral(
          "❌ Could not understand `end_time`. Use a Unix timestamp or a date like `2026-06-20 18:00`.",
        ),
      );
    }
    // An open match must close in the future; a resolved one can be in the past.
    if (!hasResult && endTime <= Date.now()) {
      return interaction.reply(
        ephemeral("❌ `end_time` must be in the future."),
      );
    }

    // Validate & normalize the result for an already-finished match.
    let result = null;
    if (hasResult) {
      if (type === "football") {
        const normalized = normalizeFootballScore(resultRaw.trim());
        if (!normalized) {
          return interaction.reply(
            ephemeral("❌ Football `result` must be a score like `2-1`."),
          );
        }
        result = normalized;
      } else {
        const lower = resultRaw.trim().toLowerCase();
        if (lower !== teamA.toLowerCase() && lower !== teamB.toLowerCase()) {
          return interaction.reply(
            ephemeral(
              `❌ Cricket \`result\` must be the winning team: **${teamA}** or **${teamB}**.`,
            ),
          );
        }
        result = lower === teamA.toLowerCase() ? teamA : teamB;
      }
    }

    // Validate the tie-breaker (penalty) score for a resolved knockout match.
    let tiebreakerResult = null;
    if (hasTiebreaker) {
      const normalizedTb = normalizeTiebreakerScore(tiebreakerRaw.trim());
      if (!normalizedTb) {
        return interaction.reply(
          ephemeral(
            "❌ `tiebreaker` must be a score with a winner, e.g. `4-3` (no draws).",
          ),
        );
      }
      tiebreakerResult = normalizedTb;
    }
    // Resolve the start time. Default / "now" => null (open immediately).
    // Irrelevant for an already-resolved match.
    let startTime = null;
    if (!hasResult && startTimeRaw && startTimeRaw.toLowerCase() !== "now") {
      const parsedStart = parseEndTime(startTimeRaw);
      if (parsedStart === null) {
        return interaction.reply(
          ephemeral(
            "❌ Could not understand `start_time`. Try `now`, `17:00`, or `in 1 hour`.",
          ),
        );
      }
      // Treat a start at/under the current time as "open now".
      if (parsedStart > Date.now()) startTime = parsedStart;
    }
    if (startTime !== null && startTime >= endTime) {
      return interaction.reply(
        ephemeral("❌ `start_time` must be before `end_time`."),
      );
    }

    // Assign the per-tournament match number: a custom one (validated unique
    // within its number group) or the next free number.
    const groupId = tournament ? tournament.id : null;
    let matchNumber;
    if (matchNumberOption !== null) {
      if (getUsedMatchNumbers(groupId).includes(matchNumberOption)) {
        return interaction.reply(
          ephemeral(
            `❌ Match number **#${matchNumberOption}** is already used` +
              (tournament
                ? ` in **${tournament.name}**.`
                : " by a standalone match."),
          ),
        );
      }
      matchNumber = matchNumberOption;
    } else {
      matchNumber = nextMatchNumber(groupId);
    }

    insertMatch.run(
      tournament?.id ?? null,
      type,
      teamA,
      teamB,
      hasResult ? "resolved" : "open",
      matchNumber,
      isKnockout ? 1 : 0,
      startTime,
      endTime,
      result,
      tiebreakerResult,
    );

    const context = tournament
      ? `to **${tournament.name}**`
      : "as a **standalone match** (no tournament)";

    if (hasResult) {
      await interaction.reply(
        ephemeral(
          `✅ Resolved match **#${matchNumber}** added ${context}:\n` +
            `**${teamA}** vs **${teamB}** (${type}${isKnockout ? ", knockout" : ""})\n` +
            `🏁 Result: **${result}**` +
            (tiebreakerResult
              ? `\n🥅 Tie-breaker: **${tiebreakerResult}**`
              : ""),
        ),
      );
      if (tournament) {
        await refreshDashboard(interaction.client, tournament.id);
      }
      return;
    }

    const opensLine = startTime
      ? `⏳ Predictions open: ${toDiscordTimestamp(startTime)}`
      : "▶️ Predictions open: now";

    await interaction.reply(
      ephemeral(
        `✅ Match **#${matchNumber}** added ${context}:\n` +
          `**${teamA}** vs **${teamB}** (${type}${isKnockout ? ", knockout" : ""})\n` +
          (isKnockout
            ? "🥅 Knockout — predictors also pick the tie-breaker score.\n"
            : "") +
          `${opensLine}\n` +
          `🔒 Predictions close: ${toDiscordTimestamp(endTime)}`,
      ),
    );

    // Keep the tournament's live table in sync.
    if (tournament) {
      await refreshDashboard(interaction.client, tournament.id);
    }

    // Announce immediately-open matches right away (the scheduler also covers
    // matches that open later when their start_time arrives).
    if (!startTime) {
      await runStartAnnouncementCheck(interaction.client);
    }
  },
};
