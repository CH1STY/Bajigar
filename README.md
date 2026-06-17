# Sports Prediction Discord Bot

A Discord bot (Node.js + discord.js v14) that lets server members predict the
outcomes of football and cricket matches across tournaments, with automatic
scoring and leaderboards. Data is stored in SQLite via Node's built-in
`node:sqlite` module (no native build step required).

## Setup

1. Fill in `.env` with your `DISCORD_TOKEN` and `CLIENT_ID`.
2. Install dependencies: `npm install`.
3. Deploy slash commands: `npm run deploy`.
4. Start the bot: `npm start`.

> Requires Node.js 22.5+ (for the built-in `node:sqlite` module). Tested on Node 25.

> **Timezone:** typed/suggested match deadlines are interpreted in the
> `TIMEZONE` set in `config/config.js` (currently `Asia/Dhaka`). Discord can't
> show a native date/clock picker for slash commands, so `end_time` uses
> autocomplete suggestions plus natural-language text instead.

## Roles & Permissions

- **Sports_Manager** role: required for all management commands.
- Everyone: can use prediction and leaderboard commands.
- The bot needs the **Manage Channels** permission so `/tournament-create` can
  create a dedicated channel for each tournament.

## Notifications

The bot posts server-wide notifications:

- **Tournament created** — when `/tournament-create` runs, an announcement is
  posted to the new tournament channel and to the announcement channel.
- **Predictions closing soon** — a scheduler checks every minute and alerts when
  a match is **30 minutes** from its deadline (each match alerts once). The alert
  goes to the tournament's channel, falling back to the announcement channel.

Set `ANNOUNCEMENT_CHANNEL_ID` in `.env` to choose the server-wide channel (needed
for closing-soon alerts on standalone matches). The lead time and check interval
are configurable in `config/config.js`.

## Commands

### Management (Sports_Manager only)

- `/tournament-create [name]` — Create a tournament, e.g. `WC 2026`. This also
  creates a dedicated text channel for the tournament's matches.
- `/match-add [type] [team_a] [team_b] [end_time] [tournament_id?]` — Add a match.
  The tournament is inferred from the channel you run it in (the one created by
  `/tournament-create`); pass `tournament_id` to override. With no tournament
  context, the match is created as a **standalone match** (not tied to any
  tournament). `type` is `football` or `cricket`. For `end_time`, pick one of the
  autocomplete suggestions (e.g. _in 2 hours_, _in 1 day_) or type a value such as
  `tomorrow 18:00`, `2026-06-20 18:00`, `in 90 minutes`, or a Unix timestamp.
  Predictions are blocked automatically once `end_time` passes.
- `/prediction-lock [match_id]` — Manually lock a match from new predictions.
- `/match-resolve [match_id] [result]` — Store the result and score predictions.
  Football result is a score (`2-1`); cricket result is the winning team name.

### Predictions (everyone)

- `/predict-football [match_id] [score]` — Predict a score like `2-1` or `0-0`.
- `/predict-cricket [match_id] [winner]` — Predict the winning team.

Predictions are only accepted while a match is `open` and before its `end_time`.
You may overwrite your prediction until then.

### Leaderboards (everyone)

- `/leaderboard-global` — Server-wide top predictors.
- `/leaderboard-tournament [tournament_id]` — Top predictors for one tournament.

## Scoring

**Football**

- Exact score → 10 points
- Off by a single goal in total (e.g. predicted `2-1`, actual `1-1` or `3-1`) → 2.5 points
- Otherwise → 0 points

**Cricket**

- Correct winning team → 10 points
- Otherwise → 0 points

## Project Structure

```
bot.js                       # Client setup, command dispatch, permission checks
deploy.js                    # Registers slash commands with Discord
config/config.js             # Role name, scoring rules, constants
db/
  database.js                # SQLite connection + schema
  queries.js                 # Shared queries & transaction helper
utils/
  commandLoader.js           # Recursively loads command modules
  permissions.js             # Sports_Manager role check
  scoring.js                 # Validation & scoring logic
  time.js                    # Deadline parsing/formatting
  embeds.js                  # Reply/embed helpers
commands/
  management/                # tournament-create, match-add, prediction-lock, match-resolve
  prediction/                # predict-football, predict-cricket
  leaderboard/               # leaderboard-global, leaderboard-tournament
```

The SQLite database file is generated at runtime in `data/sports.db` (gitignored).
