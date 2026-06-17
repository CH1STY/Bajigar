// /match-import — Sports_Manager only.
// Bulk-add matches to a tournament from JSON, either as a .json attachment or
// pasted inline. The tournament is inferred from the channel; tournament_id
// overrides it. With no tournament context, matches are created standalone.
//
// Accepted JSON shapes:
//   { "matches": [ { ...match }, ... ] }   or   [ { ...match }, ... ]
// Each match: { type, team_a, team_b, end_time, start_time? }
//   - type:       "football" | "cricket"
//   - end_time:   future time ("2026-06-20 18:00", "in 3 hours", "17:00", unix)
//   - start_time: optional; "now"/omitted = open immediately, else a future time

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const {
  db,
  getTournament,
  getTournamentByChannel,
  transaction,
} = require("../../db/queries");
const { parseEndTime, toDiscordTimestamp } = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const { runStartAnnouncementCheck } = require("../../utils/notifications");

const MAX_MATCHES = 100;
const MAX_BYTES = 256 * 1024; // 256 KB attachment cap

const insertMatch = db.prepare(
  `INSERT INTO matches (tournament_id, type, team_a, team_b, status, start_time, end_time)
   VALUES (?, ?, ?, ?, 'open', ?, ?)`,
);

/** Pull the array of match objects out of either accepted JSON shape. */
function extractMatches(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.matches)) return parsed.matches;
  return null;
}

/**
 * Validate one raw match entry.
 * @returns {{ ok: true, value: {type,team_a,team_b,startTime,endTime} } | { ok: false, error: string }}
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

  if (raw.end_time === undefined || raw.end_time === null) {
    return { ok: false, error: "end_time is required" };
  }
  const endTime = parseEndTime(String(raw.end_time));
  if (endTime === null) {
    return { ok: false, error: `could not parse end_time "${raw.end_time}"` };
  }
  if (endTime <= Date.now()) {
    return { ok: false, error: "end_time must be in the future" };
  }

  // start_time: optional. "now"/empty => open immediately (null).
  let startTime = null;
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

  return { ok: true, value: { type, teamA, teamB, startTime, endTime } };
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

    // Insert all in a single transaction.
    const tournamentId = tournament?.id ?? null;
    const ids = transaction(() =>
      valid.map(
        (m) =>
          insertMatch.run(
            tournamentId,
            m.type,
            m.teamA,
            m.teamB,
            m.startTime,
            m.endTime,
          ).lastInsertRowid,
      ),
    );

    const context = tournament
      ? `to **${tournament.name}**`
      : "as **standalone matches** (no tournament)";
    const preview = valid
      .slice(0, 10)
      .map(
        (m, i) =>
          `• \`#${ids[i]}\` ${m.teamA} vs ${m.teamB} (${m.type}) — closes ${toDiscordTimestamp(m.endTime)}`,
      )
      .join("\n");
    const more = valid.length > 10 ? `\n…and ${valid.length - 10} more.` : "";

    await interaction.editReply(
      `✅ Imported **${valid.length}** match${valid.length === 1 ? "" : "es"} ${context}:\n${preview}${more}`,
    );

    if (tournament) {
      await refreshDashboard(interaction.client, tournament.id);
    }

    // Announce any matches that are already open for predictions (the scheduler
    // covers any imported with a future start_time when their time arrives).
    if (valid.some((m) => m.startTime === null)) {
      await runStartAnnouncementCheck(interaction.client);
    }
  },
};
