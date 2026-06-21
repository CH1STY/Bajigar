require("dotenv").config();

const { Client, GatewayIntentBits, MessageFlags } = require("discord.js");
const { loadCommands } = require("./utils/commandLoader");
const { isManager } = require("./utils/permissions");
const { startReminderScheduler } = require("./utils/notifications");
const { getTournamentByChannel } = require("./db/queries");
const { MATCH_BUTTON_PREFIX } = require("./utils/dashboard");
const {
  handleMatchButton,
  handleFootballScoreButton,
  handleFootballModal,
  handleCricketButton,
} = require("./utils/predictionPanel");
const {
  startPaginationCleanup,
  handlePaginationButton,
  getPaginationData,
} = require("./utils/pagination");
const { MANAGER_ROLE, ENFORCE_MANAGER_ROLE } = require("./config/config");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

// Initialize the database (creates tables on first run).
require("./db/database");

const commands = loadCommands();
console.log(`📦 Loaded ${commands.size} command(s).`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once("clientReady", (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  // Start the recurring "predictions closing soon" notifier.
  startReminderScheduler(readyClient);
  // Start pagination cleanup.
  startPaginationCleanup();
});

client.on("interactionCreate", async (interaction) => {
  // Autocomplete: route to the command's optional `autocomplete` handler.
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(
          `❌ Autocomplete error for /${interaction.commandName}:`,
          error,
        );
        if (!interaction.responded) {
          await interaction.respond([]).catch(() => {});
        }
      }
    }
    return;
  }

  // Buttons & modals from the tournament dashboard / prediction panel.
  if (interaction.isButton() || interaction.isModalSubmit()) {
    try {
      await routeComponent(interaction);
    } catch (error) {
      console.error("❌ Component interaction error:", error);
      const payload = {
        content: "An error occurred while handling that action.",
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else if (!interaction.isModalSubmit() || !interaction.replied) {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  // Slash commands must run inside a guild (roles & members are guild-scoped).
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Role-based access control for management commands (toggled via config).
  if (
    command.managerOnly &&
    ENFORCE_MANAGER_ROLE &&
    !(await isManager(interaction))
  ) {
    return interaction.reply({
      content: `🚫 You need the **${MANAGER_ROLE}** role to use this command.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Error executing /${interaction.commandName}:`, error);
    const payload = {
      content: "An error occurred while executing this command.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

/** Route a button / modal interaction by its custom_id prefix. */
async function routeComponent(interaction) {
  const id = interaction.customId;

  if (interaction.isButton()) {
    // Pagination buttons for my-predictions
    if (id.startsWith("mp:")) {
      const parts = id.split(":");
      const action = parts[2]; // "prev" or "next"
      const page = Number(parts[3]);
      const { getPaginationData } = require("./utils/pagination");
      const { getUserPredictions, predictionState } = require("./db/queries");
      const { toDiscordTimestamp } = require("./utils/time");
      const { buildPaginatedResponse } = require("./utils/pagination");
      const { EmbedBuilder } = require("discord.js");

      const TYPE_EMOJI = { football: "⚽", cricket: "🏏" };
      const STATE_TAG = {
        resolved: "✅ Resolved",
        open: "🟢 Open",
        pending: "🕒 Upcoming",
        ended: "🔒 Closed",
        locked: "🔒 Closed",
        missing: "❔ Unknown",
      };

      const cachedData = getPaginationData(`mp:${interaction.user.id}`);
      if (!cachedData) {
        const rows = getUserPredictions(interaction.user.id);
        if (rows.length === 0) {
          return interaction.reply({
            content: "No predictions to display.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      const rows = cachedData || getUserPredictions(interaction.user.id);
      let totalPoints = 0;
      let resolvedCount = 0;
      rows.forEach((r) => {
        if (predictionState(r) === "resolved") {
          resolvedCount += 1;
          totalPoints += r.points_earned;
        }
      });

      const nextPage = action === "next" ? page + 1 : Math.max(1, page - 1);
      const ITEMS_PER_PAGE = 5;

      const { embed, components } = buildPaginatedResponse({
        sessionKey: `mp:${interaction.user.id}`,
        items: rows,
        itemsPerPage: ITEMS_PER_PAGE,
        page: nextPage,
        formatItems: (pageItems) => {
          const blocks = pageItems.map((r) => {
            const state = predictionState(r);
            const emoji = TYPE_EMOJI[r.type] ?? "🎯";
            const tag = STATE_TAG[state] ?? "❔";
            const where = r.tournament_name ? ` · ${r.tournament_name}` : "";

            let outcome;
            if (state === "resolved") {
              const hit = r.points_earned > 0;
              outcome =
                `result: **${r.result ?? "?"}** · ` +
                (hit ? `🏅 **+${r.points_earned}** pts` : "❌ 0 pts");
            } else {
              outcome = `closes ${toDiscordTimestamp(r.end_time)}`;
            }

            return (
              `**#${r.match_id} ${emoji} ${r.team_a} 🆚 ${r.team_b}**${where}\n` +
              `> ${tag} · your pick: \`${r.predicted_value}\`\n` +
              `> ${outcome}`
            );
          });
          return blocks.join("\n\n");
        },
        buildEmbed: (description, currentPage, totalPages) => {
          const summary = `📊 **Total: ${totalPoints} pts earned** · ${resolvedCount} resolved\n\n`;
          const embed = new EmbedBuilder()
            .setTitle("🗒️ Your Predictions")
            .setColor(0x2ecc71)
            .setDescription(summary + description)
            .setFooter({
              text: `${rows.length} prediction${rows.length === 1 ? "" : "s"} • Page ${currentPage}/${totalPages}`,
            })
            .setTimestamp();
          return embed;
        },
      });

      return interaction.update({ embeds: [embed], components });
    }

    // Pagination buttons for leaderboard-global
    if (id.startsWith("lg:")) {
      const parts = id.split(":");
      const userId = parts[1];
      const action = parts[2]; // "prev" or "next"
      const page = Number(parts[3]);
      const { getPaginationData } = require("./utils/pagination");
      const { buildPaginatedResponse } = require("./utils/pagination");
      const { EmbedBuilder } = require("discord.js");

      // Use cached data (don't re-query database)
      const rows = getPaginationData(`lg:${userId}`);
      if (!rows) {
        return interaction.reply({
          content:
            "Pagination session expired. Please run `/leaderboard-global` again.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const nextPage = action === "next" ? page + 1 : Math.max(1, page - 1);
      const ITEMS_PER_PAGE = 10;

      const { embed, components } = buildPaginatedResponse({
        sessionKey: `lg:${userId}`,
        items: rows,
        itemsPerPage: ITEMS_PER_PAGE,
        page: nextPage,
        formatItems: (pageItems) => {
          const medals = ["🥇", "🥈", "🥉"];
          const lines = pageItems.map((row, i) => {
            const fullIndex = rows.indexOf(row);
            const rank = medals[fullIndex] ?? `**${fullIndex + 1}.**`;
            return `${rank} <@${row.discord_id}> — **${row.points}** pts`;
          });
          return lines.join("\n");
        },
        buildEmbed: (description, currentPage, totalPages) => {
          const embed = new EmbedBuilder()
            .setTitle("🌍 Global Leaderboard")
            .setColor(0xf1c40f)
            .setDescription(description)
            .setFooter({
              text: `${rows.length} user${rows.length === 1 ? "" : "s"} · Page ${currentPage}/${totalPages}`,
            });
          return embed;
        },
      });

      return interaction.update({ embeds: [embed], components });
    }

    // Pagination buttons for leaderboard-tournament
    if (id.startsWith("lt:")) {
      const parts = id.split(":");
      const tournamentId = Number(parts[1]);
      const userId = parts[2];
      const action = parts[3]; // "prev" or "next"
      const page = Number(parts[4]);
      const { getTournament } = require("./db/queries");
      const { getPaginationData } = require("./utils/pagination");
      const { buildPaginatedResponse } = require("./utils/pagination");
      const { EmbedBuilder } = require("discord.js");

      const tournament = getTournament(tournamentId);
      if (!tournament) {
        return interaction.reply({
          content: `❌ No tournament found with ID \`${tournamentId}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Use cached data (don't re-query database)
      const rows = getPaginationData(`lt:${tournamentId}:${userId}`);
      if (!rows) {
        return interaction.reply({
          content:
            "Pagination session expired. Please run `/leaderboard-tournament` again.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const nextPage = action === "next" ? page + 1 : Math.max(1, page - 1);
      const ITEMS_PER_PAGE = 10;

      const { embed, components } = buildPaginatedResponse({
        sessionKey: `lt:${tournamentId}:${userId}`,
        items: rows,
        itemsPerPage: ITEMS_PER_PAGE,
        page: nextPage,
        formatItems: (pageItems) => {
          const medals = ["🥇", "🥈", "🥉"];
          const lines = pageItems.map((row, i) => {
            const fullIndex = rows.indexOf(row);
            const rank = medals[fullIndex] ?? `**${fullIndex + 1}.**`;
            return `${rank} <@${row.discord_id}> — **${row.points}** pts`;
          });
          return lines.join("\n");
        },
        buildEmbed: (description, currentPage, totalPages) => {
          const embed = new EmbedBuilder()
            .setTitle(`🏆 ${tournament.name} — Leaderboard`)
            .setColor(0xf1c40f)
            .setDescription(description)
            .setFooter({
              text: `${rows.length} user${rows.length === 1 ? "" : "s"} · Page ${currentPage}/${totalPages}`,
            });
          return embed;
        },
      });

      return interaction.update({ embeds: [embed], components });
    }

    if (id.startsWith(MATCH_BUTTON_PREFIX)) {
      const matchId = Number(id.slice(MATCH_BUTTON_PREFIX.length));
      return handleMatchButton(interaction, matchId);
    }
    if (id.startsWith("pp:fb:")) {
      return handleFootballScoreButton(interaction, Number(id.slice(6)));
    }
    if (id.startsWith("pp:ck:")) {
      const [, , matchId, side] = id.split(":");
      return handleCricketButton(interaction, Number(matchId), side);
    }
    return;
  }

  // Modal submit.
  if (id.startsWith("pp:fbm:")) {
    return handleFootballModal(interaction, Number(id.slice(7)));
  }
}

// Keep tournament channels clean: only the bot's table & announcements stay.
client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author?.id === client.user?.id) return;
  if (!getTournamentByChannel(message.channelId)) return;
  try {
    if (message.deletable) await message.delete();
  } catch {
    // Missing Manage Messages permission, or the message is already gone.
  }
});

client.login(token);
