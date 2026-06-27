/* Entry point (ES module).
 *
 * The former monolithic app.js (~3700 lines / 125 KB) has been split into
 * focused ES modules under web/public/mod_*.js. This entry simply pulls them
 * all in so they evaluate; mod_ui.js registers the global event listeners and
 * kicks off the initial render (startTrivia(); load();) at the end.
 *
 * Load order note: ES modules are evaluated in dependency order regardless of
 * the order listed here, and each module is evaluated exactly once. mod_ui.js
 * is imported last so its bootstrap runs after every other module is ready. */
import "./mod_state.js";
import "./mod_core.js";
import "./mod_tables.js";
import "./mod_lineup.js";
import "./mod_bracket.js";
import "./mod_tournament.js";
import "./mod_analytics.js";
import "./mod_matches.js";
import "./mod_overview.js";
import "./mod_ui.js";
