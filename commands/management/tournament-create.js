// /tournament-create [name] — Sports_Manager only.
// Creates the tournament and a dedicated text channel for its matches.

const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");
const { db } = require("../../db/queries");
const { ephemeral } = require("../../utils/embeds");
const { announceTournamentCreated } = require("../../utils/notifications");

const insertTournament = db.prepare(
  "INSERT INTO tournaments (name, status, channel_id) VALUES (?, 'active', ?)",
);

/** Convert a tournament name into a valid Discord channel name. */
function toChannelName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || "tournament";
}

module.exports = {
  managerOnly: true,
  data: new SlashCommandBuilder()
    .setName("tournament-create")
    .setDescription("Create a new tournament (Sports_Manager only)")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription('Tournament name, e.g. "WC 2026"')
        .setRequired(true)
        .setMaxLength(100),
    ),

  async execute(interaction) {
    const name = interaction.options.getString("name").trim();
    if (!name) {
      return interaction.reply(
        ephemeral("❌ Tournament name cannot be empty."),
      );
    }

    // Try to create a dedicated text channel for this tournament's matches.
    let channel = null;
    let channelWarning = "";
    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      channelWarning =
        "\n⚠️ I couldn't create a channel — grant me **Manage Channels** permission.";
    } else {
      try {
        channel = await interaction.guild.channels.create({
          name: toChannelName(name),
          type: ChannelType.GuildText,
          topic: `🏆 ${name} — add matches here with /match-add`,
        });
      } catch (err) {
        console.error("❌ Failed to create tournament channel:", err);
        channelWarning =
          "\n⚠️ I couldn't create the channel (check my permissions).";
      }
    }

    const info = insertTournament.run(name, channel?.id ?? null);

    // Server-wide announcement (announcement channel + the tournament channel).
    await announceTournamentCreated(
      interaction.client,
      { id: info.lastInsertRowid, name },
      channel,
    );

    const channelLine = channel
      ? `\n📺 Matches channel: <#${channel.id}> (run \`/match-add\` there)`
      : "";

    return interaction.reply(
      ephemeral(
        `✅ Tournament **${name}** created with ID \`${info.lastInsertRowid}\`.` +
          channelLine +
          channelWarning,
      ),
    );
  },
};
