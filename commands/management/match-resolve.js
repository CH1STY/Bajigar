// /match-resolve [match_number] [result] [tournament_id?] — Sports_Manager only.
// Closes a match, stores the result, scores every prediction and updates points.
// The match is addressed by its per-tournament number; the tournament is taken
// from this channel unless tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const {
  db,
  getTournament,
  resolveMatchByNumber,
  transaction,
} = require("../../db/queries");
const {
  normalizeFootballScore,
  normalizeTiebreakerScore,
  scoreFootball,
  scoreTiebreaker,
  scoreCricket,
} = require("../../utils/scoring");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");
const { announceMatchResolved } = require("../../utils/notifications");

const getPredictions = db.prepare(
  "SELECT * FROM predictions WHERE match_id = ?",
);
const getMatchTopEarners = db.prepare(
  `SELECT discord_id, points_earned FROM predictions
   WHERE match_id = ? AND points_earned > 0
   ORDER BY points_earned DESC LIMIT 20`,
);
const updatePrediction = db.prepare(
  "UPDATE predictions SET points_earned = ? WHERE id = ?",
);
const adjustGlobalPoints = db.prepare(
  "UPDATE users SET global_points = global_points + ? WHERE discord_id = ?",
);
const resolveMatchStmt = db.prepare(
  "UPDATE matches SET status = 'resolved', result = ?, tiebreaker_result = ? WHERE id = ?",
);

// Run the entire resolution atomically.
// For knockout football matches, `tiebreakerResult` (a penalty "X-Y" score, or
// null when the match settled in regular time) adds bonus points on top of the
// unchanged regular-time score; it is ignored entirely when null.
function resolveMatch(match, result, tiebreakerResult) {
  return transaction(() => {
    const predictions = getPredictions.all(match.id);
    let awarded = 0;

    for (const pred of predictions) {
      let points;
      if (match.type === "football") {
        points = scoreFootball(pred.predicted_value, result);
        if (match.is_knockout && tiebreakerResult) {
          points += scoreTiebreaker(pred.tiebreaker_value, tiebreakerResult);
        }
      } else {
        points = scoreCricket(pred.predicted_value, result);
      }

      // Apply the delta so re-resolving a match stays consistent.
      const delta = points - pred.points_earned;
      if (delta !== 0) {
        adjustGlobalPoints.run(delta, pred.discord_id);
      }
      updatePrediction.run(points, pred.id);
      if (points > 0) awarded += 1;
    }

    resolveMatchStmt.run(result, tiebreakerResult ?? null, match.id);
    return { total: predictions.length, awarded };
  });
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-resolve")
    .setDescription(
      "Resolve a match and score predictions (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("result")
        .setDescription('Football: "X-Y" score. Cricket: winning team name.')
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("tiebreaker")
        .setDescription(
          'Knockout only: the tie-breaker "X-Y" score if it went to penalties (omit if settled in regular time)',
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

  async execute(interaction) {
    const matchNumber = interaction.options.getInteger("match_number");
    const resultRaw = interaction.options.getString("result").trim();
    const tiebreakerRaw = interaction.options.getString("tiebreaker");
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
    if (
      match.status !== "resolved" &&
      match.status !== "open" &&
      match.status !== "upcoming" &&
      match.status !== "closed"
    ) {
      return interaction.reply(
        ephemeral(
          `❌ Cannot resolve match \`#${matchNumber}\` — status is \`${match.status}\`.`,
        ),
      );
    }

    // Validate & normalize the result depending on match type.
    let result = resultRaw;
    if (match.type === "football") {
      const normalized = normalizeFootballScore(resultRaw);
      if (!normalized) {
        return interaction.reply(
          ephemeral("❌ Football result must be a score like `2-1`."),
        );
      }
      result = normalized;
    } else {
      // cricket — must be one of the two teams.
      const lower = resultRaw.toLowerCase();
      if (
        lower !== match.team_a.toLowerCase() &&
        lower !== match.team_b.toLowerCase()
      ) {
        return interaction.reply(
          ephemeral(
            `❌ Result must be the winning team: **${match.team_a}** or **${match.team_b}**.`,
          ),
        );
      }
      result =
        lower === match.team_a.toLowerCase() ? match.team_a : match.team_b;
    }

    // Validate the optional knockout tie-breaker (penalty) result.
    const hasTiebreaker = tiebreakerRaw !== null && tiebreakerRaw.trim() !== "";
    let tiebreakerResult = null;
    if (hasTiebreaker) {
      if (!match.is_knockout) {
        return interaction.reply(
          ephemeral(
            `❌ Match \`#${matchNumber}\` isn't a knockout match, so it has no tie-breaker.`,
          ),
        );
      }
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

    const { total, awarded } = resolveMatch(match, result, tiebreakerResult);

    const isResolve = match.status === "resolved";
    const action = isResolve ? "Re-resolved" : "Resolved";

    await interaction.reply(
      ephemeral(
        `🏁 Match \`#${matchNumber}\` ${action.toLowerCase()} — result: **${result}**` +
          (tiebreakerResult ? ` (tie-breaker **${tiebreakerResult}**)` : "") +
          `.\n` +
          `Scored **${total}** prediction(s); **${awarded}** earned points.`,
      ),
    );

    // Server-wide "match resolved" notification with the top scorers.
    const tournament = match.tournament_id
      ? getTournament(match.tournament_id)
      : null;
    await announceMatchResolved(interaction.client, {
      match,
      result,
      tiebreakerResult,
      total,
      awarded,
      topEarners: getMatchTopEarners.all(match.id),
      tournamentName: tournament?.name ?? null,
      tournamentChannelId: tournament?.channel_id ?? null,
    });

    if (match.tournament_id) {
      await refreshDashboard(interaction.client, match.tournament_id);
    }
  },
};
