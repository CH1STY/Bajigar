# Command Reference

Accessibility legend:

- 🛡️ **Manager** — requires the management role (set via `MANAGER_ROLE` in `.env`,
  default `Sports_Manager`).
- 🌍 **Everyone** — any member of the server can use it.

> **Enforcement toggle:** the manager check is controlled by `ENFORCE_MANAGER_ROLE`
> in `.env`. It is **enforced by default**; set `ENFORCE_MANAGER_ROLE=false` to let
> anyone run management commands (useful for testing).

## Management commands 🛡️

> Restricted to members with the `MANAGER_ROLE`. Non-managers receive a
> permission error.

| Command              | Access     | Parameters                                                                                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tournament-create` | 🛡️ Manager | `name`                                                                                                                 | Creates a tournament and a dedicated text channel for its matches. Posts a server-wide announcement.                                                                                                                                                                                                                                                                                                                                          |
| `/match-add`         | 🛡️ Manager | `type` (football/cricket), `team_a`, `team_b`, `end_time`, `start_time?`, `result?`, `match_number?`, `tournament_id?` | Adds a match. Tournament is inferred from the current channel; omit context for a standalone match. `start_time` (optional) sets when predictions open — defaults to **now**; or type `17:00`, `5pm`, `in 1 hour`. Pass `result` to back-fill an already-finished match. `match_number` (optional) sets a custom per-tournament number — defaults to the next free number. `end_time`/`start_time` support autocomplete and natural language. |
| `/match-timing`      | 🛡️ Manager | `match_number`, `start_time?`, `end_time?`, `tournament_id?`                                                           | Edit the start and/or end time of a match (addressed by its per-tournament number). Leave a field blank to keep it unchanged. Supports the same natural language as `/match-add` (`17:00`, `in 1 hour`, etc.).                                                                                                                                                                                                                                |
| `/dashboard-refresh` | 🛡️ Manager | `tournament_id?`                                                                                                       | Manually refresh the tournament's live dashboard. Tournament is inferred from the current channel; omit `tournament_id` to refresh the channel's tournament.                                                                                                                                                                                                                                                                                  |
| `/match-import`      | 🛡️ Manager | `file?` (.json), `json?` (inline), `tournament_id?`                                                                    | Bulk-add matches from JSON — attach a `.json` file or paste it inline. Validates everything first (all-or-nothing). See [examples/matches.example.json](examples/matches.example.json).                                                                                                                                                                                                                                                       |
| `/prediction-lock`   | 🛡️ Manager | `match_number`, `tournament_id?`                                                                                       | Manually locks a match (addressed by its per-tournament number) so no further predictions are accepted.                                                                                                                                                                                                                                                                                                                                       |
| `/match-resolve`     | 🛡️ Manager | `match_number`, `result`, `tournament_id?`                                                                             | Stores the result, scores all predictions, and updates points. The match is addressed by its per-tournament number. Football result is a score (`2-1`); cricket result is the winning team.                                                                                                                                                                                                                                                   |

### Bulk-import JSON format

`/match-import` accepts either an array of matches or an object with a `matches` array. Each match needs `type`, `team_a`, `team_b`, and `end_time`; `start_time` is optional (`"now"` or omitted = open immediately). Add `result` to import an already-resolved match (then `end_time` is optional). `match_number` is optional — set a custom per-tournament number, otherwise entries are auto-numbered after the existing matches. Times accept the same natural language as `/match-add` (`"2026-06-20 18:00"`, `"in 3 hours"`, `"17:00"`, or a unix timestamp). Wall-clock times default to the configured timezone; add `UTC`/`GMT` (e.g. `"2026-06-20 18:00 UTC"`) or use an ISO string with `Z`/offset to specify UTC.

```json
{
  "matches": [
    {
      "type": "football",
      "team_a": "Brazil",
      "team_b": "Portugal",
      "start_time": "now",
      "end_time": "2026-06-20 18:00"
    },
    {
      "type": "cricket",
      "team_a": "India",
      "team_b": "Australia",
      "end_time": "in 3 hours"
    }
  ]
}
```

## Prediction commands 🌍

> Available to everyone. Only accepted while a match is `open` and before its
> `end_time`; predictions can be overwritten until then.

| Command              | Access      | Parameters                                 | Description                                                                                                         |
| -------------------- | ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `/predict-football`  | 🌍 Everyone | `match_number`, `score`, `tournament_id?`  | Predict a football score in `X-Y` format, e.g. `2-1` or `0-0`. The match is addressed by its per-tournament number. |
| `/predict-cricket`   | 🌍 Everyone | `match_number`, `winner`, `tournament_id?` | Predict the winning team of a cricket match. The match is addressed by its per-tournament number.                   |
| `/match-predictions` | 🌍 Everyone | `match_number`, `tournament_id?`           | List everyone's predictions for a match. Values stay hidden while the match is open; revealed once it closes.       |
| `/my-predictions`    | 🌍 Everyone | _none_                                     | Privately show your own prediction history with each match's result and the points you earned.                      |

## Leaderboard commands 🌍

> Available to everyone.

| Command                   | Access      | Parameters      | Description                                  |
| ------------------------- | ----------- | --------------- | -------------------------------------------- |
| `/leaderboard-global`     | 🌍 Everyone | —               | Server-wide top predictors by total points.  |
| `/leaderboard-tournament` | 🌍 Everyone | `tournament_id` | Top predictors within a specific tournament. |

## Tournament dashboard & in-channel predictions 🌍

Each tournament has a dedicated text channel containing a single, always-updated
**Matches & Predictions** table (posted by the bot). It always sits at the
**bottom** of the channel — after any update, prediction, or announcement the
bot re-posts it as the newest message so you never have to scroll up. Matches are
sorted active-first (soonest deadline first), then completed/closed ones, and the
table shows the 10 most relevant matches.

The table columns are **ID**, **Match**, **Type**, **Status**, **Result**, and
**Predictions** (how many people have predicted so far).

| Action                       | Access      | How                                                                                       |
| ---------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| View all matches             | 🌍 Everyone | The live table in the tournament channel.                                                 |
| Predict / update a football  | 🌍 Everyone | Tap the match button → the score modal opens immediately to enter the `X-Y` score.        |
| Predict / update a cricket   | 🌍 Everyone | Tap the match button → team buttons appear immediately to pick the winner.                |
| See your prediction & status | 🌍 Everyone | Tap a closed/upcoming match's button — shows your pick and (once resolved) points earned. |

> The tournament channel only holds the bot's table and announcements: any other
> message posted there is automatically removed (requires the bot's **Manage
> Messages** permission).

## Scoring summary

**Football**

- Exact score → **10 points**
- Total goal difference of 1 (e.g. predicted `2-1`, actual `1-1` or `3-1`) → **2.5 points**
- Otherwise → **0 points**

**Cricket**

- Correct winning team → **10 points**
- Otherwise → **0 points**

## Notifications

- **Tournament created** — announced in the new tournament channel and the
  `ANNOUNCEMENT_CHANNEL_ID` channel.
- **Predictions open** — posted once when a match's predictions start, whether
  it opened immediately (manager added it) or its `start_time` arrived (time
  check), to the tournament channel, falling back to the announcement channel.
- **Predictions closing soon** — alert sent ~30 minutes before a match deadline
  (once per match) to the tournament channel, falling back to the announcement
  channel.
