// Role-based access control helpers.

const { MANAGER_ROLE } = require("../config/config");

/**
 * Returns true when the interacting member has the manager role.
 * Uses a fast cache check, then refreshes the role/member cache and re-checks
 * (handles roles created after startup or partial member objects).
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function isManager(interaction) {
  if (!interaction.guild) return false;

  const target = MANAGER_ROLE.trim().toLowerCase();
  const hasRole = (member) =>
    !!member?.roles?.cache?.some(
      (role) => role.name.trim().toLowerCase() === target,
    );

  // Fast path: cached data is usually enough.
  if (hasRole(interaction.member)) return true;

  // Slow path: refresh caches in case the role or member is stale.
  try {
    await interaction.guild.roles.fetch();
    const member = await interaction.guild.members.fetch(interaction.user.id);
    return hasRole(member);
  } catch (err) {
    console.error("❌ isManager role check failed:", err);
    return false;
  }
}

module.exports = { isManager };
