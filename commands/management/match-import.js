// /match-import — Sports_Manager only.
// Bulk-add matches to a tournament from JSON, either as a .json attachment or
// pasted inline. The tournament is inferred from the channel; tournament_id
// overrides it. With no tournament context, matches are created standalone.
//
// Accepted JSON shapes:
//   { "matches": [ { ...match }, ... ] }   or   [ { ...match }, ... ]
// Each match: { type, team_a, team_b, end_time, start_time?, result? }
//   - type:       "football" | "cricket"
//   - end_time:   future time ("2026-06-20 18:00", "in 3 hours", "17:00", unix)
//                 optional when "result" is given (defaults to now)
//   - start_time: optional; "now"/omitted = open immediately, else a future time
//   - result:     optional; if present the match is imported already RESOLVED
//                 (football "X-Y" score, or cricket winning team name)
//   - is_knockout: optional boolean (football only); predictors also pick a
//                 tie-breaker score and resolving can award tie-breaker bonuses
//   - tiebreaker: optional; for a resolved knockout decided on penalties, the
//                 tie-breaker "X-Y" score (must have a winner)
//   - match_number: optional custom per-tournament number; omitted entries are
//                 auto-numbered after the existing/used numbers in the group

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const {
  db,
  getTournament,
  getTournamentByChannel,
  getUsedMatchNumbers,
  transaction,
} = require("../../db/queries");
const { parseEndTime, toDiscordTimestamp } = require("../../utils/time");
const {
  normalizeFootballScore,
  normalizeTiebreakerScore,
} = require("../../utils/scoring");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const { runStartAnnouncementCheck } = require("../../utils/notifications");

const MAX_MATCHES = 100;
const MAX_BYTES = 256 * 1024; // 256 KB attachment cap

const insertMatch = db.prepare(
  `INSERT INTO matches (tournament_id, type, team_a, team_b, status, match_number, is_knockout, start_time, end_time, result, tiebreaker_result)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/** Pull the array of match objects out of either accepted JSON shape. */
function extractMatches(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.matches)) return parsed.matches;
  return null;
}

/**
 * Validate one raw match entry.
 * @returns {{ ok: true, value: {type,team_a,team_b,startTime,endTime,status,result} } | { ok: false, error: string }}
 */
function validateMatch(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "not an object" };
  }
  const type = String(raw.type ?? "").toLowerCase();
  if (type !== "football" && type !== "cricket") {
    return { ok: false, error: `type must be "football" or "cricket"` };
  }
  const teamA = String(raw.team_a ?? "").trim();
  const teamB = String(raw.team_b ?? "").trim();
  if (!teamA || !teamB) {
    return { ok: false, error: "team_a and team_b are required" };
  }

  // is_knockout: optional boolean (football only). Accept is_knockout/isKnockout.
  const isKnockout = Boolean(raw.is_knockout ?? raw.isKnockout ?? false);
  if (isKnockout && type !== "football") {
    return { ok: false, error: "knockout is only available for football" };
  }

  // result: optional. If present, the match is imported already resolved.
  const hasResult =
    raw.result !== undefined &&
    raw.result !== null &&
    String(raw.result).trim() !== "";
  let result = null;
  if (hasResult) {
    if (type === "football") {
      result = normalizeFootballScore(String(raw.result).trim());
      if (!result) {
        return {
          ok: false,
          error: `result must be a score like "2-1" (got "${raw.result}")`,
        };
      }
    } else {
      const lower = String(raw.result).trim().toLowerCase();
      if (lower !== teamA.toLowerCase() && lower !== teamB.toLowerCase()) {
        return {
          ok: false,
          error: `result must be the winning team ("${teamA}" or "${teamB}")`,
        };
      }
      result = lower === teamA.toLowerCase() ? teamA : teamB;
    }
  }

  // tiebreaker: optional knockout penalty result (only for resolved knockouts).
  const rawTb = raw.tiebreaker;
  const hasTiebreaker =
    rawTb !== undefined && rawTb !== null && String(rawTb).trim() !== "";
  let tiebreakerResult = null;
  if (hasTiebreaker) {
    if (!isKnockout) {
      return {
        ok: false,
        error: "tiebreaker is only valid for knockout matches",
      };
    }
    if (!hasResult) {
      return {
        ok: false,
        error: "tiebreaker only applies to a resolved match (needs result)",
      };
    }
    tiebreakerResult = normalizeTiebreakerScore(String(rawTb).trim());
    if (!tiebreakerResult) {
      return {
        ok: false,
        error: `tiebreaker must be a score with a winner like "4-3" (got "${rawTb}")`,
      };
    }
  }
  // end_time: required, except for resolved matches where it defaults to now.
  let endTime;
  if (
    raw.end_time === undefined ||
    raw.end_time === null ||
    String(raw.end_time).trim() === ""
  ) {
    if (!hasResult) {
      return { ok: false, error: "end_time is required" };
    }
    endTime = Date.now();
  } else {
    endTime = parseEndTime(String(raw.end_time));
    if (endTime === null) {
      return { ok: false, error: `could not parse end_time "${raw.end_time}"` };
    }
    // Only open matches must close in the future; resolved ones may be past.
    if (!hasResult && endTime <= Date.now()) {
      return { ok: false, error: "end_time must be in the future" };
    }
  }

  // start_time: optional. "now"/empty => open immediately (null).
  // Irrelevant for an already-resolved match.
  let startTime = null;
  if (!hasResult) {
    const rawStart = raw.start_time;
    if (
      rawStart !== undefined &&
      rawStart !== null &&
      String(rawStart).toLowerCase() !== "now" &&
      String(rawStart).trim() !== ""
    ) {
      const parsedStart = parseEndTime(String(rawStart));
      if (parsedStart === null) {
        return { ok: false, error: `could not parse start_time "${rawStart}"` };
      }
      if (parsedStart > Date.now()) startTime = parsedStart;
    }
    if (startTime !== null && startTime >= endTime) {
      return { ok: false, error: "start_time must be before end_time" };
    }
  }

  // match_number: optional custom per-tournament number. Validated for
  // uniqueness later (once the tournament context is known).
  let matchNumber = null;
  if (
    raw.match_number !== undefined &&
    raw.match_number !== null &&
    String(raw.match_number).trim() !== ""
  ) {
    const n = Number(raw.match_number);
    if (!Number.isInteger(n) || n < 1) {
      return {
        ok: false,
        error: `match_number must be a positive integer (got "${raw.match_number}")`,
      };
    }
    matchNumber = n;
  }

  return {
    ok: true,
    value: {
      type,
      teamA,
      teamB,
      startTime,
      endTime,
      status: hasResult ? "resolved" : "open",
      result,
      isKnockout,
      tiebreakerResult,
      matchNumber,
    },
  };
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-import")
    .setDescription(
      "Bulk-add matches to a tournament from JSON (Sports_Manager only)",
    )
    .addAttachmentOption((o) =>
      o
        .setName("file")
        .setDescription(
          "A .json file of matches (see examples/matches.example.json)",
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("json")
        .setDescription(
          'Inline JSON: {"matches":[{ "type", "team_a", "team_b", "end_time" }]}',
        )
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; omit for standalone matches)",
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment("file");
    const inlineJson = interaction.options.getString("json");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    if (!attachment && !inlineJson) {
      return interaction.reply(
        ephemeral(
          "❌ Provide a `.json` file or paste JSON in the `json` option.",
        ),
      );
    }

    // Resolve the tournament (explicit id > channel > standalone).
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
    if (tournament && tournament.status !== "active") {
      return interaction.reply(
        ephemeral(`❌ Tournament **${tournament.name}** is not active.`),
      );
    }

    // Fetching an attachment is async — defer so we don't time out.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Load the raw JSON text.
    let text;
    if (attachment) {
      if (attachment.size > MAX_BYTES) {
        return interaction.editReply(
          `❌ File is too large (max ${Math.round(MAX_BYTES / 1024)} KB).`,
        );
      }
      try {
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } catch (err) {
        console.error("match-import: failed to fetch attachment:", err);
        return interaction.editReply("❌ Couldn't download the attached file.");
      }
    } else {
      text = inlineJson;
    }

    // Parse + shape-check.
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return interaction.editReply(
        "❌ That isn't valid JSON. Check for missing commas, quotes, or brackets.",
      );
    }
    const list = extractMatches(parsed);
    if (!list) {
      return interaction.editReply(
        '❌ JSON must be an array of matches or an object like `{ "matches": [ ... ] }`.',
      );
    }
    if (list.length === 0) {
      return interaction.editReply("❌ No matches found in the JSON.");
    }
    if (list.length > MAX_MATCHES) {
      return interaction.editReply(
        `❌ Too many matches (${list.length}). The limit is ${MAX_MATCHES} per import.`,
      );
    }

    // Validate everything first — all or nothing, so a typo doesn't half-import.
    const valid = [];
    const errors = [];
    list.forEach((raw, i) => {
      const result = validateMatch(raw);
      if (result.ok) valid.push(result.value);
      else errors.push(`• Match #${i + 1}: ${result.error}`);
    });

    if (errors.length) {
      const shown = errors.slice(0, 10).join("\n");
      const more =
        errors.length > 10 ? `\n…and ${errors.length - 10} more.` : "";
      return interaction.editReply(
        `❌ Import aborted — ${errors.length} invalid entr${errors.length === 1 ? "y" : "ies"} (nothing was added):\n${shown}${more}`,
      );
    }

    // Assign per-tournament match numbers. Honour any custom numbers (checking
    // they don't clash with existing matches or each other), then fill the rest
    // with the next free numbers in the group.
    const tournamentId = tournament?.id ?? null;
    const used = new Set(getUsedMatchNumbers(tournamentId));
    const numberErrors = [];
    valid.forEach((m, i) => {
      if (m.matchNumber !== null) {
        if (used.has(m.matchNumber)) {
          numberErrors.push(
            `• Match #${i + 1}: match_number ${m.matchNumber} is already used`,
          );
        } else {
          used.add(m.matchNumber);
        }
      }
    });
    if (numberErrors.length) {
      return interaction.editReply(
        `❌ Import aborted — duplicate match numbers (nothing was added):\n${numberErrors.join("\n")}`,
      );
    }
    let nextNumber = used.size ? Math.max(...used) + 1 : 1;
    valid.forEach((m) => {
      if (m.matchNumber === null) {
        while (used.has(nextNumber)) nextNumber += 1;
        m.matchNumber = nextNumber;
        used.add(nextNumber);
        nextNumber += 1;
      }
    });

    // Insert all in a single transaction.
    transaction(() =>
      valid.forEach((m) =>
        insertMatch.run(
          tournamentId,
          m.type,
          m.teamA,
          m.teamB,
          m.status,
          m.matchNumber,
          m.isKnockout ? 1 : 0,
          m.startTime,
          m.endTime,
          m.result,
          m.tiebreakerResult,
        ),
      ),
    );

    const context = tournament
      ? `to **${tournament.name}**`
      : "as **standalone matches** (no tournament)";
    const preview = valid
      .slice(0, 10)
      .map((m) =>
        m.status === "resolved"
          ? `• \`#${m.matchNumber}\` ${m.teamA} vs ${m.teamB} (${m.type}) — 🏁 result **${m.result}**`
          : `• \`#${m.matchNumber}\` ${m.teamA} vs ${m.teamB} (${m.type}) — closes ${toDiscordTimestamp(m.endTime)}`,
      )
      .join("\n");
    const more = valid.length > 10 ? `\n…and ${valid.length - 10} more.` : "";

    const resolvedCount = valid.filter((m) => m.status === "resolved").length;
    const summary =
      resolvedCount > 0 ? ` (${resolvedCount} already resolved)` : "";

    await interaction.editReply(
      `✅ Imported **${valid.length}** match${valid.length === 1 ? "" : "es"}${summary} ${context}:\n${preview}${more}`,
    );

    if (tournament) {
      await refreshDashboard(interaction.client, tournament.id);
    }

    // Announce any matches that are already open for predictions (the scheduler
    // covers any imported with a future start_time when their time arrives).
    // Resolved imports are never announced as "predictions open".
    if (valid.some((m) => m.status === "open" && m.startTime === null)) {
      await runStartAnnouncementCheck(interaction.client);
    }
  },
};
