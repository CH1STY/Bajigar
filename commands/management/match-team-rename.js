// /match-team-rename [match_number] [from] [to] [tournament_id?] — Sports_Manager only.
// Corrects a team name on a SINGLE match only (not across the tournament). Use
// this when one fixture has a mis-typed team but the same team is spelled
// correctly elsewhere. For cricket it also fixes the stored winner and any
// predicted-winner that named the old team. The match is addressed by its
// per-tournament number; the tournament is taken from this channel unless
// tournament_id is given.

const { SlashCommandBuilder } = require("discord.js");
const {
  resolveMatchByNumber,
  renameTeamInMatch,
  getMatch,
} = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-team-rename")
    .setDescription(
      "Rename a team on a single match only (Sports_Manager only)",
    )
    .addIntegerOption((o) =>
      o
        .setName("match_number")
        .setDescription("Match number to edit (as shown on the dashboard)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("from")
        .setDescription("The current team name on this match to replace")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o.setName("to").setDescription("The correct team name").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; use for standalone/other tournaments)",
        )
        .setRequired(false),
    ),

  // Suggest the two teams of the chosen match for `from`.
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "from") return interaction.respond([]);

    const matchNumber = interaction.options.getInteger("match_number");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");
    if (!matchNumber) return interaction.respond([]);

    const lookup = resolveMatchByNumber({
      number: matchNumber,
      channelId: interaction.channelId,
      tournamentId: tournamentIdOption,
    });
    if (lookup.error || !lookup.match) return interaction.respond([]);

    const q = String(focused.value || "").toLowerCase();
    const choices = [lookup.match.team_a, lookup.match.team_b]
      .filter((name) => name.toLowerCase().includes(q))
      .map((name) => ({ name, value: name }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const matchNumber = interaction.options.getInteger("match_number");
    const fromRaw = interaction.options.getString("from");
    const toRaw = interaction.options.getString("to");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    const from = fromRaw.trim();
    const to = toRaw.trim();

    if (!from || !to) {
      return interaction.reply(
        ephemeral("❌ Both `from` and `to` team names are required."),
      );
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      return interaction.reply(
        ephemeral("❌ The `from` and `to` names are the same — nothing to do."),
      );
    }

    const lookup = resolveMatchByNumber({
      number: matchNumber,
      channelId: interaction.channelId,
      tournamentId: tournamentIdOption,
    });
    if (lookup.error) {
      return interaction.reply(ephemeral(`❌ ${lookup.error}`));
    }
    const match = lookup.match;

    // `from` must be one of this match's two teams.
    const matchesA = match.team_a.toLowerCase() === from.toLowerCase();
    const matchesB = match.team_b.toLowerCase() === from.toLowerCase();
    if (!matchesA && !matchesB) {
      return interaction.reply(
        ephemeral(
          `❌ Match \`#${matchNumber}\` has no team called **${from}**. ` +
            `Its teams are **${match.team_a}** and **${match.team_b}**.`,
        ),
      );
    }

    let summary;
    try {
      summary = renameTeamInMatch(match.id, from, to);
    } catch (err) {
      console.error("Error renaming team on match:", err);
      return interaction.reply(
        ephemeral("❌ Failed to rename the team. Please try again."),
      );
    }

    const extras = [];
    if (summary.results) extras.push("result winner");
    if (summary.predictions)
      extras.push(`${summary.predictions} prediction(s)`);
    const extraLine = extras.length
      ? `\nAlso updated: ${extras.join(", ")}.`
      : "";

    await interaction.reply(
      ephemeral(
        `✅ Match \`#${matchNumber}\`: renamed **${from}** → **${to}** ` +
          `(${summary.side === "team_a" ? "home" : "away"} side).` +
          extraLine,
      ),
    );

    const updated = getMatch(match.id);
    if (updated && updated.tournament_id) {
      await refreshDashboard(interaction.client, updated.tournament_id);
    }
  },
};
