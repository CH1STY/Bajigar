require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("❌ Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("clientReady", (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "time") {
    try {
      const now = new Date();
      const timeString = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });

      await interaction.reply({
        content: `🕐 Current time: **${timeString}**`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("❌ Error executing /time:", error);
      await interaction.reply({
        content: "An error occurred while executing this command.",
        ephemeral: true,
      });
    }
  }
});

client.login(token);
