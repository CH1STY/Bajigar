// Server-wide notifications: tournament announcements & closing-soon alerts.

const { EmbedBuilder } = require("discord.js");
const {
  ANNOUNCEMENT_CHANNEL_ID,
  REMINDER_LEAD_MS,
  REMINDER_CHECK_INTERVAL_MS,
} = require("../config/config");
const { getMatchesNeedingReminder, markReminded } = require("../db/queries");
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
        `${context} · Match \`${match.id}\`\n` +
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
  return setInterval(
    () => runReminderCheck(client),
    REMINDER_CHECK_INTERVAL_MS,
  );
}

module.exports = { announceTournamentCreated, startReminderScheduler };
