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
