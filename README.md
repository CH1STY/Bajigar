# Sports Prediction Discord Bot

A Discord bot (Node.js + discord.js v14) that lets server members predict the
outcomes of football and cricket matches across tournaments, with automatic
scoring and leaderboards. Data is stored in SQLite via Node's built-in
`node:sqlite` module (no native build step required).

## Quick Start

### Prerequisites
- Node.js 22.5+ (required for built-in `node:sqlite` module)
- A Discord bot token and client ID from [Discord Developer Portal](https://discord.com/developers/applications)

### Installation & Running

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CH1STY/Bajigar.git
   cd Bajigar
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure `.env`:**
   Create or update `.env` with your Discord credentials:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   MANAGER_ROLE=SportsManager        # Role required for manager commands
   ENFORCE_MANAGER_ROLE=true          # Set to 'false' to disable role enforcement (dev only)
   ANNOUNCEMENT_CHANNEL_ID=optional   # Channel ID for server-wide notifications
   ```

4. **Deploy commands & start the bot:**
   ```bash
   npm start
   ```
   
   Or separately:
   - Deploy commands: `npm run deploy`
   - Start bot: `node bot.js`

> **Note:** Timezone for match deadlines is set in `config/config.js` (currently `Asia/Dhaka`).
> Adjust as needed for your server's timezone.

## Dashboard Table

The bot displays a **live matches & predictions table** in each tournament channel.
The table is automatically updated when matches or predictions change.

**Table Features:**
- Shows 10 most relevant matches (active matches first)
- Compact design optimized for Discord mobile display (43 characters max per row)
- Columns: ID | Match (50 chars) | Type (C/F) | Status | Result | Predictions
- Interactive buttons for open matches allow users to predict directly
- Status indicators: Open | Upcoming | Closed | Resolved

**Team Name Cleanup:**
The bot automatically strips emojis and special characters from team names. 
If you have existing matches with emoji flags or symbols, run:
```bash
node scripts/cleanup-team-names.js
```
This cleans the database and ensures team names display properly in the compact table.

## Roles & Permissions

- **Sports_Manager** role: required for all management commands (configurable in `.env`).
- **Everyone**: can use prediction and leaderboard commands.
- **Bot permissions required:**
  - Send Messages
  - Embed Links
  - Add Reactions
  - Manage Channels (for `/tournament-create`)
  - Manage Messages (for channel cleanup)

## Notifications

The bot posts server-wide notifications:

- **Tournament created** — when `/tournament-create` runs, an announcement is
  posted to the new tournament channel and optionally to the announcement channel.
- **Predictions closing soon** — a scheduler checks every 60 seconds and alerts when
  a match is **30 minutes** from its deadline (each match alerts once).
- **Predictions open** — when a match becomes available for predictions, users are notified once.

Notifications are posted to the tournament's channel when available, otherwise to
`ANNOUNCEMENT_CHANNEL_ID`. Set `ANNOUNCEMENT_CHANNEL_ID` in `.env` for server-wide
notifications on standalone matches.

**Configuration:** Edit timing constants in `config/config.js`:
- `REMINDER_CHECK_INTERVAL_MS` — how often to check for closing matches
- `REMINDER_LEAD_MS` — minutes before deadline to alert

## Project Structure

```
bot.js                       # Client setup, command dispatch, event handlers
deploy.js                    # Registers slash commands with Discord API
package.json                 # Dependencies (discord.js, dotenv)
.env                         # Configuration (tokens, channel IDs, role names)

config/
  config.js                  # Bot constants (timezone, scoring, role names, thresholds)

db/
  database.js                # SQLite connection + schema initialization
  queries.js                 # Database queries, transactions, helpers

utils/
  dashboard.js               # Live matches & predictions table display
  notifications.js           # Tournament, closing-soon, and open alerts
  permissions.js             # Sports_Manager role validation
  scoring.js                 # Prediction validation & point calculations
  time.js                    # Deadline parsing & Discord timestamp formatting
  embeds.js                  # Embed & reply builders
  predictionPanel.js         # Prediction modal & button handlers
  commandLoader.js           # Dynamic command module loader

commands/
  management/                # Manager-only commands
    tournament-create.js     # Create tournaments & channels
    match-add.js             # Add individual matches
    match-import.js          # Bulk import matches from JSON
    match-resolve.js         # Score matches & calculate points
    prediction-lock.js       # Manually lock predictions
  prediction/                # User prediction commands
    predict-football.js      # Predict football scores
    predict-cricket.js       # Predict cricket winners
    match-predictions.js     # View all predictions for a match
    my-predictions.js        # View personal prediction history
  leaderboard/               # Leaderboard commands
    leaderboard-global.js    # Server-wide top predictors
    leaderboard-tournament.js # Tournament-specific leaderboard

scripts/
  cleanup-team-names.js      # Utility to remove emojis/special chars from team names

examples/
  matches.example.json       # Sample data for /match-import

data/
  sports.db                  # SQLite database (generated at runtime, gitignored)
```

**Database Tables:**
- `users` — Discord user IDs and global points
- `tournaments` — Tournament names, channels, dashboard message IDs
- `matches` — Match data (teams, type, times, status, scores)
- `predictions` — User predictions and earned points

## Commands

### Management (Sports_Manager only)

- `/tournament-create [name]` — Create a tournament (e.g., `WC 2026`)
  - Automatically creates a dedicated text channel
  - Posts an announcement to the announcement channel
  
- `/match-add [type] [team_a] [team_b] [end_time] [start_time?] [tournament_id?]`
  - `type`: `football` or `cricket`
  - `end_time`: Deadline for predictions (required)
  - `start_time`: When predictions open (optional, defaults to immediately)
  - `tournament_id`: If omitted, inferred from current channel
  - **End time syntax:**
    - Natural language: `tomorrow 18:00`, `in 2 hours`, `in 90 minutes`
    - Specific date: `2026-06-20 18:00`, `2026-06-20 18:00 UTC`
    - Unix timestamp or ISO format accepted
    - Default timezone: `Asia/Dhaka` (set in `config/config.js`)

- `/match-import [file?] [json?] [tournament_id?]`
  - Bulk-add matches from JSON (up to 100 per import)
  - `file` or `json` required (file takes precedence)
  - Format: `[{type, team_a, team_b, end_time, start_time?}]` or `{matches: [...]}`

- `/prediction-lock [match_id]` — Prevent further predictions on a match

- `/match-resolve [match_id] [result]`
  - `result` format:
    - Football: `2-1` (score)
    - Cricket: Team name (e.g., `Pakistan`)

### Predictions (everyone)

- `/predict-football [match_id] [score]` — Predict a score (e.g., `2-1`, `0-0`)
- `/predict-cricket [match_id] [winner]` — Predict the winning team

**Notes:**
- Predictions only accepted while match is **open** and before **end_time**
- Users can overwrite their prediction until the deadline
- Dashboard shows active (open) matches with prediction buttons

### Leaderboards (everyone)

- `/leaderboard-global` — Top predictors across all tournaments
- `/leaderboard-tournament [tournament_id]` — Top predictors in a specific tournament
- `/match-predictions [match_id]` — View all predictions for a match
  - Hidden values while match is open (privacy)
  - Shows values & points once match closes
- `/my-predictions` — Personal prediction history with points earned

## Scoring System

**Football:**
- Exact score match → 10 points
- Off by 1 goal total (e.g., predicted 2-1, actual 1-1) → 2.5 points
- No match → 0 points

**Cricket:**
- Correct winning team → 10 points
- Wrong team → 0 points

## Troubleshooting

### Bot won't start
- Check `DISCORD_TOKEN` and `CLIENT_ID` in `.env` are valid
- Ensure Node.js 22.5+ is installed: `node --version`
- Run `npm install` to ensure dependencies are installed

### Commands not showing up
- Run `npm run deploy` to register commands
- Bot must have permission to create slash commands in the guild
- You may need to restart the bot after registering new commands

### Table alignment issues in Discord
- Team names are truncated at 26 characters; longer names display with "…"
- Table is optimized for 43 characters per row for mobile display
- Run `node scripts/cleanup-team-names.js` if emoji flags appear

### Database issues
- Database file (`data/sports.db`) is auto-created on first run
- To reset: delete `data/sports.db` and restart the bot
- Ensure `data/` folder has write permissions

## Contributing

To add new commands:
1. Create a file in `commands/{category}/`
2. Export `{ data: SlashCommandBuilder, execute: async function }`
3. Optionally include `managerOnly: true` to restrict to Sports_Manager role
4. Run `npm run deploy` to register with Discord

## License

MIT
