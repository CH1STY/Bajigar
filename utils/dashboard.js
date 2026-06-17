// The live "matches & predictions" table posted in each tournament channel.
// It is a single bot message that gets edited in place whenever matches or
// predictions change. Users interact with it through the per-match buttons.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const {
  getTournament,
  getTournamentMatches,
  getPredictionCounts,
  setDashboardMessageId,
  predictionState,
} = require("../db/queries");
const { toDiscordTimestamp } = require("./time");

// Custom-id prefix for the per-match buttons on the dashboard.
const MATCH_BUTTON_PREFIX = "dash:m:";

const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
const MAX_BUTTONS = 25; // 5 rows × 5 buttons (Discord limit)
const DASHBOARD_LIMIT = 10; // most time-relevant matches shown on the table

/** Is the match currently accepting predictions? */
function isActive(match) {
  return match.status === "open" && Date.now() < match.end_time;
}

/**
 * Classify a match for display.
 * @returns {{ key: string, label: string }}
 */
function matchState(match) {
  switch (predictionState(match)) {
    case "resolved":
      return { key: "resolved", label: `✅ Resolved — ${match.result ?? "?"}` };
    case "open":
      return { key: "open", label: "🟢 Open" };
    case "pending":
      return { key: "pending", label: "🕜 Upcoming" };
    default:
      return { key: "closed", label: "🔒 Closed" };
  }
}

/**
 * Sort matches for the table:
 *   1) active matches first, then inactive/completed
 *   2) active by soonest deadline; inactive by most recently ended
 */
function sortMatches(matches) {
  return [...matches].sort((a, b) => {
    const ga = isActive(a) ? 0 : 1;
    const gb = isActive(b) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    // Active: ascending end_time (closest first). Inactive: descending.
    return ga === 0 ? a.end_time - b.end_time : b.end_time - a.end_time;
  });
}

// Plain-text (no emoji) state label so it stays aligned inside a code block.
const STATE_TEXT = {
  resolved: "Resolved",
  open: "Open",
  pending: "Upcoming",
  closed: "Closed",
};

const MAX_TEAMS_WIDTH = 26; // keep the table from getting too wide on mobile

/** Truncate a string to a max length with an ellipsis. */
function clip(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Render the matches as an aligned monospace table. */
function buildMatchTable(matches, counts) {
  const rows = matches.map((m) => {
    const key = matchState(m).key;
    const resolved = key === "resolved";
    return {
      id: `#${m.id}`,
      teams: clip(`${m.team_a} v ${m.team_b}`, MAX_TEAMS_WIDTH),
      type: m.type === "cricket" ? "Cricket" : "Football",
      status: STATE_TEXT[key] ?? "Closed",
      result: resolved ? (m.result ?? "?") : "—",
      predictions: String(counts.get(m.id) ?? 0),
    };
  });

  const headers = {
    id: "ID",
    teams: "Match",
    type: "Type",
    status: "Status",
    result: "Result",
    predictions: "Predictions",
  };
  const cols = ["id", "teams", "type", "status", "result", "predictions"];
  const width = {};
  for (const c of cols) {
    width[c] = Math.max(headers[c].length, ...rows.map((r) => r[c].length));
  }

  const line = (cells) =>
    cols
      .map((c) => cells[c].padEnd(width[c]))
      .join("  ")
      .trimEnd();

  const sep = cols.map((c) => "─".repeat(width[c])).join("──");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

/** Build the table embed listing every match in the tournament. */
function buildDashboardEmbed(tournament, matches, counts, totalMatches) {
  const total = totalMatches ?? matches.length;
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name} — Matches & Predictions`)
    .setColor(0x5865f2)
    .setTimestamp();

  if (matches.length === 0) {
    embed.setDescription(
      "No matches yet. A manager can add one with `/match-add`.",
    );
    return embed;
  }

  // The aligned table (code block keeps columns lined up everywhere).
  let table = buildMatchTable(matches, counts);

  // Timestamps don't render inside code blocks, so list the actionable
  // open/upcoming deadlines underneath where they render as live times.
  const timing = matches
    .map((m) => {
      const key = matchState(m).key;
      if (key === "open")
        return `⏳ \`#${m.id}\` closes ${toDiscordTimestamp(m.end_time)}`;
      if (key === "pending")
        return `🕒 \`#${m.id}\` opens ${toDiscordTimestamp(m.start_time)}`;
      return null;
    })
    .filter(Boolean);

  // Note when the list is capped so people know there are more matches.
  const moreNote =
    total > matches.length
      ? `\n\nShowing the ${matches.length} most relevant of ${total} matches.`
      : "";

  // Guard against Discord's 4096-char description limit.
  const fence = "```\n";
  const closeFence = "\n```";
  const extras = (timing.length ? "\n\n" + timing.join("\n") : "") + moreNote;
  const budget = 4096 - fence.length - closeFence.length - extras.length - 16;
  if (table.length > budget) table = table.slice(0, budget) + "\n… (more)";

  embed.setDescription(fence + table + closeFence + extras);
  embed.setFooter({
    text: "Tap a match button below to predict. Predictions = how many people have predicted so far.",
  });
  return embed;
}

/** Build the per-match button rows — only for matches open for predictions. */
function buildDashboardComponents(matches) {
  const rows = [];
  let current = new ActionRowBuilder();

  for (const m of matches.slice(0, MAX_BUTTONS)) {
    // Only show a button while predictions are ongoing (open).
    if (matchState(m).key !== "open") continue;

    const label = `🟢 Predict #${m.id} · ${m.team_a} v ${m.team_b}`.slice(
      0,
      80,
    );
    const button = new ButtonBuilder()
      .setCustomId(`${MATCH_BUTTON_PREFIX}${m.id}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary);

    if (current.components.length === 5) {
      rows.push(current);
      current = new ActionRowBuilder();
    }
    current.addComponents(button);
  }
  if (current.components.length > 0) rows.push(current);
  return rows;
}

/** Fetch a sendable text channel by ID, or null. */
async function resolveChannel(client, id) {
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    return channel && channel.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

/**
 * Re-render (or create) a tournament's live table.
 * Safe to call after any match/prediction change.
 * @param {import('discord.js').Client} client
 * @param {number} tournamentId
 */
async function refreshDashboard(client, tournamentId) {
  const tournament = getTournament(tournamentId);
  if (!tournament || !tournament.channel_id) return;

  const channel = await resolveChannel(client, tournament.channel_id);
  if (!channel) return;

  const allMatches = sortMatches(getTournamentMatches(tournamentId));
  const matches = allMatches.slice(0, DASHBOARD_LIMIT);
  const counts = getPredictionCounts(tournamentId);
  const payload = {
    embeds: [
      buildDashboardEmbed(tournament, matches, counts, allMatches.length),
    ],
    components: buildDashboardComponents(matches),
  };

  // Edit the existing message when we can; otherwise post a fresh one.
  const existingId = tournament.dashboard_message_id;

  // Keep the dashboard as the newest message so nobody has to scroll up.
  // If it's already the last message in the channel, edit it in place;
  // otherwise delete the old one and re-post it at the bottom.
  if (existingId) {
    try {
      const recent = await channel.messages.fetch({ limit: 1 });
      const last = recent.first();
      if (last && last.id === existingId) {
        await last.edit(payload);
        return;
      }
    } catch {
      // Couldn't read recent history — fall through and re-post.
    }
    try {
      const old = await channel.messages.fetch(existingId);
      await old.delete();
    } catch {
      // Already gone — nothing to remove.
    }
  }

  try {
    const msg = await channel.send(payload);
    setDashboardMessageId(tournamentId, msg.id);
  } catch (err) {
    console.error("❌ Failed to post tournament dashboard:", err);
  }
}

module.exports = {
  MATCH_BUTTON_PREFIX,
  isActive,
  matchState,
  sortMatches,
  refreshDashboard,
};
