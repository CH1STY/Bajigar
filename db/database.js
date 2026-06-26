// SQLite database initialization & schema.
// Uses Node's built-in node:sqlite module (no native build step required).

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

// Keep the database file inside a dedicated data/ directory.
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, "sports.db"));

// Pragmas for reliability & relational integrity.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// --- Schema -----------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id    TEXT PRIMARY KEY,
    global_points REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'active', -- active | completed
    channel_id           TEXT,  -- dedicated Discord text channel
    dashboard_message_id TEXT   -- the live matches/predictions table message
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER,                  -- NULL for standalone matches
    type          TEXT NOT NULL,            -- football | cricket
    team_a        TEXT NOT NULL,
    team_b        TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open', -- open | closed | resolved
    match_number  INTEGER,                  -- per-tournament display number (NULL group for standalone)
    is_knockout   INTEGER NOT NULL DEFAULT 0, -- 1 = knockout (football) needing a winner via tie-breaker
    start_time    INTEGER,                  -- epoch ms predictions open (NULL = immediately)
    end_time      INTEGER NOT NULL,         -- epoch milliseconds
    result        TEXT,                     -- "X-Y" score or winning team name
    tiebreaker_result TEXT,                 -- knockout tie-breaker (penalty) "X-Y"; NULL = settled in regular time
    reminded      INTEGER NOT NULL DEFAULT 0, -- 1 once the closing-soon alert was sent
    start_announced INTEGER NOT NULL DEFAULT 0, -- 1 once the "predictions open" alert was sent
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL,
    discord_id      TEXT NOT NULL,
    predicted_value TEXT NOT NULL,          -- "X-Y" score or team name
    tiebreaker_value TEXT,                  -- knockout tie-breaker (penalty) "X-Y" prediction; NULL otherwise
    points_earned   REAL NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL DEFAULT 0, -- epoch ms of last change
    UNIQUE (match_id, discord_id),
    FOREIGN KEY (match_id)   REFERENCES matches(id)   ON DELETE CASCADE,
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
  );
`);

// --- Lightweight migrations (for databases created before a column existed) --
const tournamentColumns = db
  .prepare("PRAGMA table_info(tournaments)")
  .all()
  .map((c) => c.name);
if (!tournamentColumns.includes("channel_id")) {
  db.exec("ALTER TABLE tournaments ADD COLUMN channel_id TEXT");
}
if (!tournamentColumns.includes("dashboard_message_id")) {
  db.exec("ALTER TABLE tournaments ADD COLUMN dashboard_message_id TEXT");
}

// Allow standalone matches: drop the NOT NULL constraint on matches.tournament_id.
// SQLite can't ALTER a column's nullability, so rebuild the table when needed.
const matchTournamentCol = db
  .prepare("PRAGMA table_info(matches)")
  .all()
  .find((c) => c.name === "tournament_id");
if (matchTournamentCol && matchTournamentCol.notnull === 1) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE matches_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER,
        type          TEXT NOT NULL,
        team_a        TEXT NOT NULL,
        team_b        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'open',
        end_time      INTEGER NOT NULL,
        result        TEXT,
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
      );
      INSERT INTO matches_new
        SELECT id, tournament_id, type, team_a, team_b, status, end_time, result
        FROM matches;
      DROP TABLE matches;
      ALTER TABLE matches_new RENAME TO matches;
    `);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  db.exec("PRAGMA foreign_keys = ON");
}

// Add the "reminded" flag used by the closing-soon notifier.
const matchColumns = db
  .prepare("PRAGMA table_info(matches)")
  .all()
  .map((c) => c.name);
if (!matchColumns.includes("reminded")) {
  db.exec("ALTER TABLE matches ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0");
}
if (!matchColumns.includes("start_time")) {
  db.exec("ALTER TABLE matches ADD COLUMN start_time INTEGER");
}
if (!matchColumns.includes("start_announced")) {
  db.exec(
    "ALTER TABLE matches ADD COLUMN start_announced INTEGER NOT NULL DEFAULT 0",
  );
}
// Knockout matches need a winner; a tie-breaker (penalty) result decides it.
if (!matchColumns.includes("is_knockout")) {
  db.exec(
    "ALTER TABLE matches ADD COLUMN is_knockout INTEGER NOT NULL DEFAULT 0",
  );
}
if (!matchColumns.includes("tiebreaker_result")) {
  db.exec("ALTER TABLE matches ADD COLUMN tiebreaker_result TEXT");
}

// Per-tournament match numbers shown/handled in place of the internal id.
// Backfill existing rows sequentially by creation order within each tournament
// (standalone matches, tournament_id IS NULL, form their own group).
if (!matchColumns.includes("match_number")) {
  db.exec("ALTER TABLE matches ADD COLUMN match_number INTEGER");
  const groups = db.prepare("SELECT DISTINCT tournament_id FROM matches").all();
  const idsForGroup = db.prepare(
    "SELECT id FROM matches WHERE tournament_id IS ? ORDER BY id ASC",
  );
  const setNumber = db.prepare(
    "UPDATE matches SET match_number = ? WHERE id = ?",
  );
  for (const group of groups) {
    const rows = idsForGroup.all(group.tournament_id);
    rows.forEach((row, index) => setNumber.run(index + 1, row.id));
  }
}

// Track when each prediction was last set/changed (for the dashboard).
const predictionColumns = db
  .prepare("PRAGMA table_info(predictions)")
  .all()
  .map((c) => c.name);
if (!predictionColumns.includes("updated_at")) {
  db.exec(
    "ALTER TABLE predictions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
  );
}
// Knockout tie-breaker (penalty) score prediction, set alongside the regular score.
if (!predictionColumns.includes("tiebreaker_value")) {
  db.exec("ALTER TABLE predictions ADD COLUMN tiebreaker_value TEXT");
}

module.exports = db;
