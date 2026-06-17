require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

async function deploy() {
  try {
    const commands = [
      new SlashCommandBuilder()
        .setName("time")
        .setDescription("Show the current server time")
        .toJSON(),
    ];

    console.log(`🔄 Deploying ${commands.length} slash command(s) globally...`);

    const result = await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    console.log(`✅ Successfully deployed ${result.length} command(s)`);
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
    process.exit(1);
  }
}

deploy();
