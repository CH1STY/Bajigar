require("dotenv").config();

const { Client, GatewayIntentBits, MessageFlags } = require("discord.js");
const { loadCommands } = require("./utils/commandLoader");
const { isManager } = require("./utils/permissions");
const { startReminderScheduler } = require("./utils/notifications");
const { MANAGER_ROLE } = require("./config/config");

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
  intents: [GatewayIntentBits.Guilds],
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

  // Role-based access control for management commands.
  if (command.managerOnly && !(await isManager(interaction))) {
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

client.login(token);
