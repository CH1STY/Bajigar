// Pagination utility for displaying large lists with Discord buttons.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// Cache for pagination data: sessionKey -> { data, expiresAt }
// Cleaned up after 15 minutes of inactivity.
const paginationCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Store pagination data in the cache.
 * @param {string} sessionKey - Unique key for this pagination session (e.g., "mp:<userId>")
 * @param {Array} fullData - The full array of items to paginate
 */
function cachePaginationData(sessionKey, fullData) {
  paginationCache.set(sessionKey, {
    data: fullData,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Retrieve pagination data from the cache.
 * @param {string} sessionKey
 * @returns {Array|null}
 */
function getPaginationData(sessionKey) {
  const entry = paginationCache.get(sessionKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    paginationCache.delete(sessionKey);
    return null;
  }
  return entry.data;
}

/**
 * Build a paginated embed and buttons for a list of items.
 * @param {Object} options
 * @param {string} options.sessionKey - Session key for caching
 * @param {Array} options.items - Full array of items to display
 * @param {number} options.itemsPerPage - Items per page (default 10)
 * @param {number} options.page - Current page (1-indexed)
 * @param {Function} options.formatItems - Function to format items: (items) => string (description)
 * @param {Function} options.buildEmbed - Function to build the embed: (description, currentPage, totalPages) => EmbedBuilder
 * @returns {Object} { embed, components } or { embed } if no pagination needed
 */
function buildPaginatedResponse(options) {
  const {
    sessionKey,
    items,
    itemsPerPage = 10,
    page = 1,
    formatItems,
    buildEmbed,
  } = options;

  // Cache the full data
  cachePaginationData(sessionKey, items);

  const totalPages = Math.ceil(items.length / itemsPerPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * itemsPerPage;
  const endIdx = startIdx + itemsPerPage;
  const pageItems = items.slice(startIdx, endIdx);

  // Format the description for this page
  const description = formatItems(pageItems);

  // Build the embed
  const embed = buildEmbed(description, currentPage, totalPages);

  // Build pagination buttons only if more than one page
  let components;
  if (totalPages > 1) {
    const row = new ActionRowBuilder();

    // Previous button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${sessionKey}:prev:${currentPage}`)
        .setLabel("◀ Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1),
    );

    // Page indicator
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("page-indicator")
        .setLabel(`Page ${currentPage} / ${totalPages}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );

    // Next button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${sessionKey}:next:${currentPage}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages),
    );

    components = [row];
  }

  return { embed, components };
}

/**
 * Handle a pagination button interaction (prev/next).
 * @param {Interaction} interaction
 * @param {string} sessionKey - Session key
 * @param {string} action - "prev" or "next"
 * @param {number} currentPage - Current page
 * @param {Object} options
 * @param {number} options.itemsPerPage
 * @param {Function} options.formatItems
 * @param {Function} options.buildEmbed
 * @returns {Object} { embed, components }
 */
function handlePaginationButton(
  interaction,
  sessionKey,
  action,
  currentPage,
  options,
) {
  const cachedData = getPaginationData(sessionKey);
  if (!cachedData) {
    // Data expired, can't navigate
    throw new Error(
      "Pagination session expired. Please run the command again.",
    );
  }

  const nextPage =
    action === "next" ? currentPage + 1 : Math.max(1, currentPage - 1);

  return buildPaginatedResponse({
    sessionKey,
    items: cachedData,
    page: nextPage,
    ...options,
  });
}

/**
 * Clean up expired pagination sessions periodically.
 * Call this once on bot startup.
 */
function startPaginationCleanup() {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of paginationCache.entries()) {
        if (now > entry.expiresAt) {
          paginationCache.delete(key);
        }
      }
    },
    5 * 60 * 1000,
  ); // Check every 5 minutes
}

module.exports = {
  buildPaginatedResponse,
  handlePaginationButton,
  getPaginationData,
  cachePaginationData,
  startPaginationCleanup,
};
