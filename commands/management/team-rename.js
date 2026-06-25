// /team-rename <from> <to> [tournament_id?] — Sports_Manager only.
// Fixes spelling mistakes by renaming (and merging) a team within a single
// tournament. The tournament is taken from this channel unless tournament_id is
// given; with no tournament context it operates on the standalone match group.
//
// Team names live as plain strings on each match (team_a / team_b) and, for
// cricket, also in the match result (winner) and in each prediction's predicted
// winner — so this updates all of them at once. Matching is case-insensitive,
// which means variants like "brazil" and "Brazil" are merged into <to>.

const { SlashCommandBuilder } = require("discord.js");
const {
  getTournament,
  getTournamentByChannel,
  getTeamsInTournament,
  renameTeamInTournament,
} = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { refreshDashboard } = require("../../utils/dashboard");

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("team-rename")
    .setDescription(
      "Rename/merge a team to fix a spelling mistake (Sports_Manager only)",
    )
    .addStringOption((o) =>
      o
        .setName("from")
        .setDescription("The current (misspelled) team name to replace")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("to")
        .setDescription("The correct team name to use instead")
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

  // Suggest existing team names (within the resolved tournament) for `from`.
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "from") return interaction.respond([]);

    const tournamentIdOption = interaction.options.getInteger("tournament_id");
    let tournamentId = null;
    if (tournamentIdOption != null) {
      const t = getTournament(tournamentIdOption);
      tournamentId = t ? t.id : null;
    } else {
      const t = getTournamentByChannel(interaction.channelId);
      tournamentId = t ? t.id : null;
    }

    const q = String(focused.value || "").toLowerCase();
    const teams = getTeamsInTournament(tournamentId)
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));
    return interaction.respond(teams);
  },

  async execute(interaction) {
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

    // Resolve the tournament context (explicit id > channel > standalone group).
    let tournament = null;
    if (tournamentIdOption != null) {
      tournament = getTournament(tournamentIdOption) ?? null;
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
    const tournamentId = tournament ? tournament.id : null;
    const where = tournament
      ? `**${tournament.name}**`
      : "the standalone matches";

    const result = renameTeamInTournament(tournamentId, from, to);

    if (result.total === 0) {
      return interaction.reply(
        ephemeral(
          `❌ No matches in ${where} use the team **${from}**. ` +
            `Check the spelling, or pass \`tournament_id\` to target another tournament.`,
        ),
      );
    }

    const lines = [
      `✅ Renamed **${from}** → **${to}** in ${where}.`,
      `• Match line-ups updated: **${result.teamA + result.teamB}**`,
    ];
    if (result.results > 0) {
      lines.push(`• Cricket results updated: **${result.results}**`);
    }
    if (result.predictions > 0) {
      lines.push(`• Cricket predictions updated: **${result.predictions}**`);
    }

    await interaction.reply(ephemeral(lines.join("\n")));

    // Team names appear on the dashboard — refresh it for tournaments.
    if (tournamentId) {
      await refreshDashboard(interaction.client, tournamentId);
    }
  },
};
