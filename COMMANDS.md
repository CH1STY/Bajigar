# Command Reference

Accessibility legend:

- 🛡️ **Manager** — requires the management role (set via `MANAGER_ROLE` in `.env`,
  default `Sports_Manager`).
- 🌍 **Everyone** — any member of the server can use it.

## Management commands 🛡️

> Restricted to members with the `MANAGER_ROLE`. Non-managers receive a
> permission error.

| Command              | Access     | Parameters                                                                  | Description                                                                                                                                                |
| -------------------- | ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tournament-create` | 🛡️ Manager | `name`                                                                      | Creates a tournament and a dedicated text channel for its matches. Posts a server-wide announcement.                                                       |
| `/match-add`         | 🛡️ Manager | `type` (football/cricket), `team_a`, `team_b`, `end_time`, `tournament_id?` | Adds a match. Tournament is inferred from the current channel; omit context for a standalone match. `end_time` supports autocomplete and natural language. |
| `/prediction-lock`   | 🛡️ Manager | `match_id`                                                                  | Manually locks a match so no further predictions are accepted.                                                                                             |
| `/match-resolve`     | 🛡️ Manager | `match_id`, `result`                                                        | Stores the result, scores all predictions, and updates points. Football result is a score (`2-1`); cricket result is the winning team.                     |

## Prediction commands 🌍

> Available to everyone. Only accepted while a match is `open` and before its
> `end_time`; predictions can be overwritten until then.

| Command             | Access      | Parameters           | Description                                                    |
| ------------------- | ----------- | -------------------- | -------------------------------------------------------------- |
| `/predict-football` | 🌍 Everyone | `match_id`, `score`  | Predict a football score in `X-Y` format, e.g. `2-1` or `0-0`. |
| `/predict-cricket`  | 🌍 Everyone | `match_id`, `winner` | Predict the winning team of a cricket match.                   |

## Leaderboard commands 🌍

> Available to everyone.

| Command                   | Access      | Parameters      | Description                                  |
| ------------------------- | ----------- | --------------- | -------------------------------------------- |
| `/leaderboard-global`     | 🌍 Everyone | —               | Server-wide top predictors by total points.  |
| `/leaderboard-tournament` | 🌍 Everyone | `tournament_id` | Top predictors within a specific tournament. |

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
- **Predictions closing soon** — alert sent ~30 minutes before a match deadline
  (once per match) to the tournament channel, falling back to the announcement
  channel.
