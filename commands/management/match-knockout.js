// /match-knockout [match_number] [knockout] [tournament_id?] — Sports_Manager only.
// Turns an existing match into a knockout tie (or back into a regular match).
// Useful when a match was added with knockout=false and later needs a winner
// decided by a tie-breaker. The match is addressed by its per-tournament number;
// the tournament is taken from this channel unless tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const {
  getMatch,
  resolveMatchByNumber,
  getMatchPredictions,
  setMatchKnockout,
} = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-knockout")
    .setDescription(
      "Make an existing football match a knockout (or revert it) — Sports_Manager only",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number to edit (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("knockout")
        .setDescription(
          "true = decided by a tie-breaker (no draws); false = regular match",
        )
        .setRequired(true),
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
    const knockout = interaction.options.getBoolean("knockout");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

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

    // Knockout / tie-breakers only apply to football (cricket is winner-only).
    if (match.type !== "football") {
      return interaction.reply(
        ephemeral(
          "❌ Only football matches can be knockout — cricket is winner-only with no tie-breaker.",
        ),
      );
    }

    // Don't retroactively change a resolved match: its scoring already depends
    // on whether it was a knockout. Re-resolve it instead if that's wrong.
    if (match.status === "resolved") {
      return interaction.reply(
        ephemeral(
          "❌ This match is already resolved. Use `/match-resolve` to re-grade it with the correct knockout/tie-breaker handling.",
        ),
      );
    }

    // No-op guard: flag already matches the requested value.
    if (Boolean(match.is_knockout) === knockout) {
      return interaction.reply(
        ephemeral(
          `ℹ️ Match \`#${matchNumber}\` is already ${
            knockout ? "a knockout" : "a regular match"
          } — nothing changed.`,
        ),
      );
    }

    // Apply the change.
    try {
      setMatchKnockout(match.id, knockout);
    } catch (err) {
      console.error("Error updating match knockout flag:", err);
      return interaction.reply(
        ephemeral("❌ Failed to update the match. Please try again."),
      );
    }

    // Warn about predictions that now need a tie-breaker pick added. When
    // enabling knockout, anyone who already predicted (without a tie-breaker)
    // should re-run /predict-football to add one before the deadline.
    let note = "";
    if (knockout) {
      const preds = getMatchPredictions(match.id);
      const missingTb = preds.filter((p) => !p.tiebreaker_value).length;
      if (missingTb > 0) {
        note =
          `\n⚠️ ${missingTb} existing prediction(s) have no tie-breaker yet. ` +
          "Those players should re-run `/predict-football` with a `tiebreaker` " +
          "score before the deadline, or they'll miss the tie-breaker bonus.";
      }
    }

    await interaction.reply(
      ephemeral(
        knockout
          ? `✅ Match \`#${matchNumber}\` (**${match.team_a}** 🆚 **${match.team_b}**) is now a 🥅 **knockout**.\n` +
              "Predictors must also pick a tie-breaker (penalty) score with a winner.\n" +
              "Resolve it with `/match-resolve match_number:" +
              `${matchNumber} result:<X-Y> tiebreaker:<X-Y>` +
              "` if it goes to penalties." +
              note
          : `✅ Match \`#${matchNumber}\` (**${match.team_a}** 🆚 **${match.team_b}**) is now a **regular** match.\n` +
              "Tie-breaker predictions will be ignored, and no tie-breaker is needed to resolve it.",
      ),
    );

    // Refresh the dashboard for the match's tournament, if any.
    const updatedMatch = getMatch(match.id);
    if (updatedMatch && updatedMatch.tournament_id) {
      await refreshDashboard(interaction.client, updatedMatch.tournament_id);
    }
  },
};
