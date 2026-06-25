// Server-wide notifications: tournament announcements & closing-soon alerts.

const { EmbedBuilder } = require("discord.js");
const {
  ANNOUNCEMENT_CHANNEL_ID,
  REMINDER_LEAD_MS,
  REMINDER_CHECK_INTERVAL_MS,
} = require("../config/config");
const {
  getMatchesNeedingReminder,
  markReminded,
  getMatchesNeedingStartAnnouncement,
  markStartAnnounced,
} = require("../db/queries");
const { toDiscordTimestamp, formatInZone } = require("./time");

/** Fetch a sendable text channel by ID, or null if unavailable. */
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
 * Announce a newly created tournament server-wide.
 * Posts to the configured announcement channel and the tournament's channel.
 */
async function announceTournamentCreated(
  client,
  tournament,
  tournamentChannel,
) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 New Tournament Created!")
    .setDescription(
      `**${tournament.name}** is now open for predictions!` +
        (tournamentChannel
          ? `\nMatches will be posted in <#${tournamentChannel.id}>.`
          : ""),
    )
    .setColor(0x2ecc71)
    .setTimestamp();

  const targets = new Set();
  const announce = await resolveChannel(client, ANNOUNCEMENT_CHANNEL_ID);
  if (announce) targets.add(announce);
  if (tournamentChannel) targets.add(tournamentChannel);

  for (const channel of targets) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

/** Build the "closing soon" embed for a match row. */
function closingSoonEmbed(match) {
  const context = match.tournament_name
    ? `🏆 ${match.tournament_name}`
    : "Standalone match";
  return new EmbedBuilder()
    .setTitle("⏰ Predictions closing soon!")
    .setDescription(
      `**${match.team_a}** vs **${match.team_b}** (${match.type})\n` +
        `${context} · Match \`#${match.match_number ?? match.id}\`\n` +
        `Closes ${toDiscordTimestamp(match.end_time)} ` +
        `(${formatInZone(match.end_time)})\n` +
        `Get your predictions in now!`,
    )
    .setColor(0xe67e22)
    .setTimestamp();
}

/** Check once for matches closing within the lead window and alert. */
async function runReminderCheck(client) {
  let matches;
  try {
    matches = getMatchesNeedingReminder(REMINDER_LEAD_MS);
  } catch (err) {
    console.error("❌ Reminder query failed:", err);
    return;
  }

  for (const match of matches) {
    const channel =
      (await resolveChannel(client, match.tournament_channel_id)) ||
      (await resolveChannel(client, ANNOUNCEMENT_CHANNEL_ID));

    // No place to post (e.g. standalone match with no announcement channel):
    // leave it unmarked so it can fire once a channel becomes available.
    if (!channel) continue;

    await channel.send({ embeds: [closingSoonEmbed(match)] }).catch(() => {});
    markReminded(match.id);
  }
}

/**
 * Start the recurring closing-soon reminder scheduler.
 * @returns {NodeJS.Timeout} the interval handle
 */
function startReminderScheduler(client) {
  runReminderCheck(client); // run once on startup
  runStartAnnouncementCheck(client);
  return setInterval(() => {
    runReminderCheck(client);
    runStartAnnouncementCheck(client);
  }, REMINDER_CHECK_INTERVAL_MS);
}

/** Build the "predictions are open" embed for a match row. */
function predictionsOpenEmbed(match) {
  const context = match.tournament_name
    ? `🏆 ${match.tournament_name}`
    : "Standalone match";
  return new EmbedBuilder()
    .setTitle("🟢 Predictions are open!")
    .setDescription(
      `**${match.team_a}** vs **${match.team_b}** (${match.type})\n` +
        `${context} · Match \`#${match.match_number ?? match.id}\`\n` +
        `Predictions close ${toDiscordTimestamp(match.end_time)} ` +
        `(${formatInZone(match.end_time)})\n` +
        `Get your predictions in!`,
    )
    .setColor(0x2ecc71)
    .setTimestamp();
}

/**
 * Check once for matches that have just opened for predictions and announce
 * them. Covers both manager-created matches that open immediately and
 * scheduled matches whose start_time has arrived.
 */
async function runStartAnnouncementCheck(client) {
  let matches;
  try {
    matches = getMatchesNeedingStartAnnouncement();
  } catch (err) {
    console.error("❌ Start-announcement query failed:", err);
    return;
  }

  for (const match of matches) {
    const channel =
      (await resolveChannel(client, match.tournament_channel_id)) ||
      (await resolveChannel(client, ANNOUNCEMENT_CHANNEL_ID));

    // No place to post yet — leave unmarked so it can fire once a channel
    // becomes available.
    if (!channel) continue;

    await channel
      .send({ embeds: [predictionsOpenEmbed(match)] })
      .catch(() => {});
    markStartAnnounced(match.id);
  }
}

/**
 * Announce a resolved match (result, counts and the top scorers).
 * Posts to the tournament channel (if any) and the announcement channel.
 *
 * @param {import('discord.js').Client} client
 * @param {{
 *   match: object,
 *   result: string,
 *   total: number,
 *   awarded: number,
 *   topEarners?: Array<{ discord_id: string, points_earned: number }>,
 *   tournamentName?: string|null,
 *   tournamentChannelId?: string|null,
 * }} info
 */
async function announceMatchResolved(client, info) {
  const { match, result, total, awarded, topEarners = [] } = info;
  const context = info.tournamentName
    ? `🏆 ${info.tournamentName}`
    : "Standalone match";

  const medals = ["🥇", "🥈", "🥉"];
  const scorers =
    topEarners.length > 0
      ? topEarners
          .map(
            (r, i) =>
              `${medals[i] ?? "🏅"} <@${r.discord_id}> — **${r.points_earned}** pts`,
          )
          .join("\n")
      : "_No one earned points this time._";

  const embed = new EmbedBuilder()
    .setTitle("🏁 Match Resolved")
    .setDescription(
      `**${match.team_a}** vs **${match.team_b}** (${match.type})\n` +
        `${context} · Match \`#${match.match_number ?? match.id}\`\n` +
        `Result: **${result}**\n` +
        `🗳️ ${total} prediction${total === 1 ? "" : "s"} scored · ` +
        `🎯 ${awarded} earned points\n\n` +
        `**Top scorers**\n${scorers}`,
    )
    .setColor(0x3498db)
    .setTimestamp();

  const targets = new Set();
  const tournamentChannel = await resolveChannel(
    client,
    info.tournamentChannelId,
  );
  if (tournamentChannel) targets.add(tournamentChannel);
  const announce = await resolveChannel(client, ANNOUNCEMENT_CHANNEL_ID);
  if (announce) targets.add(announce);

  for (const channel of targets) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

module.exports = {
  announceTournamentCreated,
  startReminderScheduler,
  announceMatchResolved,
  runStartAnnouncementCheck,
};
