// Recursively loads command modules from the commands/ directory.
// Each command module must export: { data: SlashCommandBuilder, execute, managerOnly? }

const fs = require("fs");
const path = require("path");

const COMMANDS_DIR = path.join(__dirname, "..", "commands");

/** Recursively collect every .js file under a directory. */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Load all command modules.
 * @returns {Map<string, { data: object, execute: Function, managerOnly?: boolean }>}
 */
function loadCommands() {
  const commands = new Map();
  if (!fs.existsSync(COMMANDS_DIR)) return commands;

  for (const file of collectFiles(COMMANDS_DIR)) {
    const command = require(file);
    if (command?.data?.name && typeof command.execute === "function") {
      commands.set(command.data.name, command);
    } else {
      console.warn(`⚠️  Skipping invalid command file: ${file}`);
    }
  }
  return commands;
}

module.exports = { loadCommands };
