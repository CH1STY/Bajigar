// /lineup-add — Sports_Manager only.
// Add (or update) Player-Analysis lineup & stats data for one or more matches,
// stored in the match_lineups table and shown on the dashboard's match modal
// ("Player Analysis" tab). Data is supplied as a .json attachment or inline.
//
// Download a ready-to-edit template from the dashboard at /lineup-example.json
//
// Accepted JSON shapes (a single match, or many at once):
//   { "matchId": 12, "home": {…}, "away": {…}, "teamStats": {…} }
//   [ { "matchId": 12, … }, { "matchId": 13, … } ]
//   { "lineups": [ { "matchId": 12, … }, … ] }
//
// Each entry:
//   - matchId:   REQUIRED database match id (shown as "id N" on each card).
//                May be omitted for a single object if the match_id option is
//                given instead.
//   - home/away: team blocks (bottom/top of pitch). At least one is required.
//                Each: { name, formation, color, flag, starters[], bench[] }.
//   - teamStats: optional { home:{…}, away:{…} } side-by-side comparison.
//
// Use the `clear` option with `match_id` to remove a match's lineup instead.

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const {
  getMatch,
  upsertLineup,
  deleteLineup,
  transaction,
} = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");

const MAX_MATCHES = 50;
const MAX_BYTES = 512 * 1024; // 512 KB attachment cap

/** Pull the array of lineup objects out of any accepted JSON shape. */
function extractLineups(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.lineups)) return parsed.lineups;
  if (parsed && typeof parsed === "object") return [parsed];
  return null;
}

/** Validate one team block (home/away). */
function validateTeam(side, t) {
  if (t == null) return null;
  if (typeof t !== "object" || Array.isArray(t)) {
    return `${side} must be an object`;
  }
  if (t.starters != null && !Array.isArray(t.starters)) {
    return `${side}.starters must be an array`;
  }
  if (t.bench != null && !Array.isArray(t.bench)) {
    return `${side}.bench must be an array`;
  }
  return null;
}

/**
 * Validate one lineup entry.
 * @returns {{ ok: true, value: { matchId, match, data } } | { ok: false, error: string }}
 */
function validateLineup(raw, fallbackMatchId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "not an object" };
  }
  const idSource = raw.matchId ?? raw.match_id ?? fallbackMatchId;
  const matchId = Number(idSource);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return {
      ok: false,
      error: 'missing/invalid "matchId" (the DB id shown as "id N")',
    };
  }
  const match = getMatch(matchId);
  if (!match) {
    return { ok: false, error: `no match with id ${matchId} exists` };
  }
  if (raw.home == null && raw.away == null) {
    return { ok: false, error: "needs at least one of home/away" };
  }
  for (const side of ["home", "away"]) {
    const err = validateTeam(side, raw[side]);
    if (err) return { ok: false, error: err };
  }
  if (
    raw.teamStats != null &&
    (typeof raw.teamStats !== "object" || Array.isArray(raw.teamStats))
  ) {
    return { ok: false, error: "teamStats must be an object" };
  }
  // Normalise the stored id so the API/import stay consistent.
  const data = { ...raw, matchId };
  return { ok: true, value: { matchId, match, data } };
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("lineup-add")
    .setDescription(
      "Add Player-Analysis data for matches from JSON (Sports_Manager only)",
    )
    .addAttachmentOption((o) =>
      o
        .setName("file")
        .setDescription(
          "A .json file (see /lineup-example.json on the dashboard)",
        )
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("json")
        .setDescription(
          'Inline JSON: { "matchId": 12, "home": {…}, "away": {…} }',
        )
        .setRequired(false),
    )
    .addIntegerOption((o) =>
      o
        .setName("match_id")
        .setDescription(
          "DB match id — fills in matchId for a single entry, or the target for clear",
        )
        .setRequired(false),
    )
    .addBooleanOption((o) =>
      o
        .setName("clear")
        .setDescription(
          "Remove the Player-Analysis data for match_id instead of adding",
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment("file");
    const inlineJson = interaction.options.getString("json");
    const matchIdOption = interaction.options.getInteger("match_id");
    const clear = interaction.options.getBoolean("clear") ?? false;

    // Clear mode — remove a single match's lineup.
    if (clear) {
      if (matchIdOption === null) {
        return interaction.reply(
          ephemeral(
            "❌ To clear, provide the `match_id` of the match to reset.",
          ),
        );
      }
      if (!getMatch(matchIdOption)) {
        return interaction.reply(
          ephemeral(`❌ No match with id \`${matchIdOption}\` exists.`),
        );
      }
      const removed = deleteLineup(matchIdOption);
      return interaction.reply(
        ephemeral(
          removed
            ? `🗑️ Cleared Player-Analysis data for match \`${matchIdOption}\`.`
            : `ℹ️ Match \`${matchIdOption}\` had no Player-Analysis data.`,
        ),
      );
    }

    if (!attachment && !inlineJson) {
      return interaction.reply(
        ephemeral(
          "❌ Attach a `.json` file or paste JSON in the `json` option. Grab a template from `/lineup-example.json` on the dashboard.",
        ),
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
        console.error("lineup-add: failed to fetch attachment:", err);
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
    const list = extractLineups(parsed);
    if (!list) {
      return interaction.editReply(
        '❌ JSON must be a lineup object, an array of them, or `{ "lineups": [ … ] }`.',
      );
    }
    if (list.length === 0) {
      return interaction.editReply("❌ No lineups found in the JSON.");
    }
    if (list.length > MAX_MATCHES) {
      return interaction.editReply(
        `❌ Too many entries (${list.length}). The limit is ${MAX_MATCHES} per import.`,
      );
    }

    // Validate everything first — all or nothing, so a typo doesn't half-import.
    const fallbackId = list.length === 1 ? matchIdOption : null;
    const valid = [];
    const errors = [];
    const seen = new Set();
    list.forEach((raw, i) => {
      const result = validateLineup(raw, fallbackId);
      if (!result.ok) {
        errors.push(`• Entry #${i + 1}: ${result.error}`);
        return;
      }
      if (seen.has(result.value.matchId)) {
        errors.push(
          `• Entry #${i + 1}: duplicate matchId ${result.value.matchId} in this payload`,
        );
        return;
      }
      seen.add(result.value.matchId);
      valid.push(result.value);
    });

    if (errors.length) {
      const shown = errors.slice(0, 10).join("\n");
      const more =
        errors.length > 10 ? `\n…and ${errors.length - 10} more.` : "";
      return interaction.editReply(
        `❌ Import aborted — ${errors.length} invalid entr${errors.length === 1 ? "y" : "ies"} (nothing was saved):\n${shown}${more}`,
      );
    }

    // Save all in a single transaction.
    transaction(() => valid.forEach((v) => upsertLineup(v.matchId, v.data)));

    const preview = valid
      .slice(0, 10)
      .map((v) => `• \`id ${v.matchId}\` ${v.match.team_a} v ${v.match.team_b}`)
      .join("\n");
    const more = valid.length > 10 ? `\n…and ${valid.length - 10} more.` : "";

    await interaction.editReply(
      `✅ Saved Player-Analysis data for **${valid.length}** match${valid.length === 1 ? "" : "es"}:\n${preview}${more}\n\nOpen a match on the dashboard → **Player Analysis** tab to view it.`,
    );
  },
};
