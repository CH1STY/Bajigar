// Helpers for parsing, formatting & suggesting prediction deadlines.
// All "wall-clock" times are interpreted in config.TIMEZONE (an IANA zone),
// because Discord never tells the bot the user's own timezone.

const { TIMEZONE } = require("../config/config");

/**
 * Offset (in ms) of a timezone at a given instant: zoneTime - utcTime.
 * Uses Intl so it correctly accounts for DST.
 */
function tzOffset(timeZone, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Convert a wall-clock time in `timeZone` to epoch milliseconds. */
function zonedWallTimeToEpoch(y, mo, d, h, mi, timeZone) {
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = tzOffset(timeZone, new Date(utcGuess));
  return utcGuess - offset;
}

/** Break an epoch down into the wall-clock parts seen in `timeZone`. */
function zoneDateParts(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  if (parts.hour === 24) parts.hour = 0;
  return parts; // { year, month, day, hour, minute }
}

/**
 * Parse a user-supplied deadline into epoch milliseconds.
 * Accepts:
 *   - Unix timestamp in seconds ("1782604800") or ms ("1782604800000")
 *   - "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" (interpreted in `timeZone`)
 *   - Relative: "in 30 minutes", "in 2 hours", "in 3 days"
 *   - "today HH:mm" / "tomorrow HH:mm" (or bare "tomorrow")
 *   - A trailing "UTC"/"GMT" forces UTC, e.g. "18:00 UTC", "2026-06-20 18:00 UTC"
 *   - ISO strings carrying an explicit offset/Z (parsed as-is)
 *
 * @param {string} input
 * @param {string} [timeZone]
 * @returns {number|null} epoch ms, or null when it can't be parsed.
 */
function parseEndTime(input, timeZone = TIMEZONE) {
  if (!input) return null;
  let raw = String(input).trim();
  let lower = raw.toLowerCase();

  // A trailing "UTC"/"GMT" marker forces the wall-clock value to be read in
  // UTC instead of the configured TIMEZONE (e.g. "18:00 UTC").
  const utcMark = /\s+(?:utc|gmt)$/i;
  if (utcMark.test(raw)) {
    timeZone = "UTC";
    raw = raw.replace(utcMark, "").trim();
    lower = raw.toLowerCase();
  }

  // 0) "now".
  if (lower === "now") return Date.now();

  // 1) Pure Unix timestamp.
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    return num < 1e12 ? num * 1000 : num;
  }

  // 2) Relative: "in N minutes/hours/days".
  const rel = /^in\s+(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|hrs?|days?)$/.exec(
    lower,
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    let ms = 0;
    if (unit.startsWith("min")) ms = n * 60_000;
    else if (unit.startsWith("d")) ms = n * 86_400_000;
    else ms = n * 3_600_000; // hours
    return Date.now() + ms;
  }

  // 3) "today"/"tomorrow" with optional "HH:mm".
  const rel2 = /^(today|tomorrow)(?:\s+(\d{1,2}):(\d{2}))?$/.exec(lower);
  if (rel2) {
    const base = zoneDateParts(Date.now(), timeZone);
    let { year, month, day } = base;
    const h = rel2[2] !== undefined ? Number(rel2[2]) : 12;
    const mi = rel2[3] !== undefined ? Number(rel2[3]) : 0;
    if (rel2[1] === "tomorrow") {
      // Advance one day via UTC arithmetic, then re-read the zone date.
      const next = zoneDateParts(
        zonedWallTimeToEpoch(year, month, day, 12, 0, timeZone) + 86_400_000,
        timeZone,
      );
      year = next.year;
      month = next.month;
      day = next.day;
    }
    if (h > 23 || mi > 59) return null;
    return zonedWallTimeToEpoch(year, month, day, h, mi, timeZone);
  }

  // 4) Bare clock time: "17:00", "9:30", "5pm", "5:30 pm". Resolved to the next
  //    occurrence of that time (today if still ahead, otherwise tomorrow).
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(lower);
  if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
    let h = Number(clock[1]);
    const mi = clock[2] !== undefined ? Number(clock[2]) : 0;
    const ap = clock[3];
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === "pm" && h !== 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    if (h > 23 || mi > 59) return null;
    const base = zoneDateParts(Date.now(), timeZone);
    let epoch = zonedWallTimeToEpoch(
      base.year,
      base.month,
      base.day,
      h,
      mi,
      timeZone,
    );
    if (epoch <= Date.now()) {
      const next = zoneDateParts(epoch + 86_400_000, timeZone);
      epoch = zonedWallTimeToEpoch(
        next.year,
        next.month,
        next.day,
        h,
        mi,
        timeZone,
      );
    }
    return epoch;
  }

  // 5) Absolute "YYYY-MM-DD" with optional time, interpreted in the zone.
  const abs = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(
    lower,
  );
  if (abs) {
    const [, y, mo, d, h, mi] = abs;
    const hour = h !== undefined ? Number(h) : 12;
    const minute = mi !== undefined ? Number(mi) : 0;
    if (Number(mo) > 12 || Number(d) > 31 || hour > 23 || minute > 59) {
      return null;
    }
    return zonedWallTimeToEpoch(
      Number(y),
      Number(mo),
      Number(d),
      hour,
      minute,
      timeZone,
    );
  }

  // 6) Fallback: ISO strings that carry their own offset/Z.
  if (/[zZ]|[+-]\d{2}:?\d{2}/.test(raw) && /\d{4}-\d{2}-\d{2}t/i.test(raw)) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }

  return null;
}

/** Render an epoch as a Discord dynamic timestamp (shows in each user's zone). */
function toDiscordTimestamp(epochMs) {
  return `<t:${Math.floor(epochMs / 1000)}:f>`;
}

/** Human-readable time in the configured zone, e.g. "20 Jun 2026, 18:00 GMT+6". */
function formatInZone(epochMs, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(epochMs));
}

/**
 * Build up to 25 autocomplete choices for an end-time field.
 * Each choice's value is a Unix timestamp (seconds) so it parses unambiguously.
 *
 * @param {string} query  what the user has typed so far
 * @param {string} [timeZone]
 * @returns {Array<{ name: string, value: string }>}
 */
function buildEndTimeSuggestions(query, timeZone = TIMEZONE) {
  const now = Date.now();
  const choices = [];

  // If the typed value already parses to a future time, surface it first.
  const q = (query || "").trim();
  if (q) {
    const parsed = parseEndTime(q, timeZone);
    if (parsed && parsed > now) {
      choices.push({
        name: `📅 ${formatInZone(parsed, timeZone)}`.slice(0, 100),
        value: String(Math.floor(parsed / 1000)),
      });
    }
  }

  const presets = [
    ["in 30 minutes", 30 * 60_000],
    ["in 1 hour", 60 * 60_000],
    ["in 2 hours", 2 * 60 * 60_000],
    ["in 6 hours", 6 * 60 * 60_000],
    ["in 12 hours", 12 * 60 * 60_000],
    ["in 1 day", 24 * 60 * 60_000],
    ["in 2 days", 2 * 24 * 60 * 60_000],
    ["in 1 week", 7 * 24 * 60 * 60_000],
  ];
  for (const [label, delta] of presets) {
    const epoch = now + delta;
    choices.push({
      name: `${label} — ${formatInZone(epoch, timeZone)}`.slice(0, 100),
      value: String(Math.floor(epoch / 1000)),
    });
  }

  return choices.slice(0, 25);
}

/**
 * Build up to 25 autocomplete choices for a start-time field.
 * Includes a "Now" option first, then the typed value, then presets.
 * The "Now" choice uses the literal value "now".
 *
 * @param {string} query
 * @param {string} [timeZone]
 * @returns {Array<{ name: string, value: string }>}
 */
function buildStartTimeSuggestions(query, timeZone = TIMEZONE) {
  const now = Date.now();
  const choices = [{ name: "▶️ Now (open immediately)", value: "now" }];

  // Surface a typed custom time (e.g. "17:00", "5pm", "tomorrow 09:00").
  const q = (query || "").trim();
  if (q && q.toLowerCase() !== "now") {
    const parsed = parseEndTime(q, timeZone);
    if (parsed) {
      choices.push({
        name: `📅 ${formatInZone(parsed, timeZone)}`.slice(0, 100),
        value: String(Math.floor(parsed / 1000)),
      });
    }
  }

  const presets = [
    ["in 15 minutes", 15 * 60_000],
    ["in 30 minutes", 30 * 60_000],
    ["in 1 hour", 60 * 60_000],
    ["in 3 hours", 3 * 60 * 60_000],
    ["in 6 hours", 6 * 60 * 60_000],
    ["in 1 day", 24 * 60 * 60_000],
  ];
  for (const [label, delta] of presets) {
    const epoch = now + delta;
    choices.push({
      name: `${label} — ${formatInZone(epoch, timeZone)}`.slice(0, 100),
      value: String(Math.floor(epoch / 1000)),
    });
  }

  return choices.slice(0, 25);
}

module.exports = {
  parseEndTime,
  toDiscordTimestamp,
  formatInZone,
  buildEndTimeSuggestions,
  buildStartTimeSuggestions,
};
