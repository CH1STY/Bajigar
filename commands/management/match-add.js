// /match-add [type] [team_a] [team_b] [end_time] [tournament_id?] — Sports_Manager only.
// The tournament is inferred from the channel; tournament_id overrides it.
// With no tournament context, the match is created standalone (tournament_id NULL).

const { SlashCommandBuilder } = require("discord.js");
const {
  db,
  getTournament,
  getTournamentByChannel,
} = require("../../db/queries");
const {
  parseEndTime,
  toDiscordTimestamp,
  buildEndTimeSuggestions,
} = require("../../utils/time");
const { ephemeral } = require("../../utils/embeds");
const { TIMEZONE } = require("../../config/config");

const insertMatch = db.prepare(
  `INSERT INTO matches (tournament_id, type, team_a, team_b, status, end_time)
   VALUES (?, ?, ?, ?, 'open', ?)`,
);

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("match-add")
    .setDescription("Add a match to a tournament (Sports_Manager only)")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Match type")
        .setRequired(true)
        .addChoices(
          { name: "football", value: "football" },
          { name: "cricket", value: "cricket" },
        ),
    )
    .addStringOption((o) =>
      o.setName("team_a").setDescription("First team").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("team_b").setDescription("Second team").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("end_time")
        .setDescription(
          `Deadline (${TIMEZONE}): pick a suggestion or type "tomorrow 18:00", "in 2 hours"`,
        )
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("tournament_id")
        .setDescription(
          "Tournament ID (defaults to this channel's; omit for a standalone match)",
        )
        .setRequired(false),
    ),

  // Suggests deadline options as the manager types the `end_time` field.
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "end_time") {
      return interaction.respond([]);
    }
    return interaction.respond(buildEndTimeSuggestions(focused.value));
  },

  async execute(interaction) {
    const type = interaction.options.getString("type");
    const teamA = interaction.options.getString("team_a").trim();
    const teamB = interaction.options.getString("team_b").trim();
    const endTimeRaw = interaction.options.getString("end_time");
    const tournamentIdOption = interaction.options.getInteger("tournament_id");

    // Resolve the tournament:
    //   1. explicit tournament_id, else
    //   2. the tournament linked to this channel, else
    //   3. none -> standalone match.
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

    const endTime = parseEndTime(endTimeRaw);
    if (endTime === null) {
      return interaction.reply(
        ephemeral(
          "❌ Could not understand `end_time`. Use a Unix timestamp or a date like `2026-06-20 18:00`.",
        ),
      );
    }
    if (endTime <= Date.now()) {
      return interaction.reply(
        ephemeral("❌ `end_time` must be in the future."),
      );
    }

    const info = insertMatch.run(
      tournament?.id ?? null,
      type,
      teamA,
      teamB,
      endTime,
    );

    const context = tournament
      ? `to **${tournament.name}**`
      : "as a **standalone match** (no tournament)";

    return interaction.reply(
      ephemeral(
        `✅ Match \`${info.lastInsertRowid}\` added ${context}:\n` +
          `**${teamA}** vs **${teamB}** (${type})\n` +
          `🔒 Predictions close: ${toDiscordTimestamp(endTime)}`,
      ),
    );
  },
};
