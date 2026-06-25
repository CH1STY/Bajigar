# Command Examples

A hands-on cheat sheet showing **what each slash command does** with concrete
examples. For the quick parameter reference table, see [COMMANDS.md](COMMANDS.md).

> 🛡️ = **Manager only** (needs the `Sports_Manager` role) · 🌍 = **Everyone**
>
> Most match commands are addressed by the **match number** shown on the
> dashboard (e.g. `#3`), _not_ the internal database id. The tournament is taken
> from the channel you run the command in; add `tournament_id` to target another
> tournament or a standalone match.

---

## 🛡️ Management commands

### `/tournament-create`

Creates a tournament **and** a dedicated text channel for its matches, then posts
a server-wide announcement.

```text
/tournament-create name: World Cup 2026
```

➡️ Creates the tournament, makes a `#world-cup-2026` channel, and posts the live
dashboard there.

---

### `/match-add`

Adds a single match. The tournament is inferred from the current channel.

**Upcoming match (opens now, closes at a time):**

```text
/match-add type: football  team_a: Brazil  team_b: Portugal  end_time: tomorrow 18:00
```

**Schedule when predictions open:**

```text
/match-add type: cricket  team_a: India  team_b: Australia  start_time: 17:00  end_time: 21:00
```

**Give it a custom match number** (otherwise the next free number is used):

```text
/match-add type: football  team_a: France  team_b: Spain  end_time: in 2 hours  match_number: 5
```

**Back-fill an already-finished match** (pass `result`; `end_time` may be in the past):

```text
/match-add type: football  team_a: England  team_b: Croatia  end_time: 2026-06-10 20:00  result: 2-1
```

➡️ Adds the match, refreshes the dashboard, and (for open matches) announces that
predictions are open. `end_time`/`start_time` accept natural language
(`tomorrow 18:00`, `in 2 hours`, `17:00`, `5pm`) with autocomplete.

---

### `/match-import`

Bulk-add matches from JSON — attach a `.json` file or paste it inline. Validates
everything first (all-or-nothing).

```text
/match-import file: worldcup-next5.example.json
```

```text
/match-import json: {"matches":[{"type":"football","team_a":"Spain","team_b":"Germany","end_time":"in 3 hours"}]}
```

Each match may include an optional `match_number` (auto-assigned when omitted) and
an optional `result` (imports the match already resolved). See
[examples/matches.example.json](examples/matches.example.json),
[examples/worldcup-next5.example.json](examples/worldcup-next5.example.json), and
[examples/resolved-matches.example.json](examples/resolved-matches.example.json).

---

### `/match-timing`

Edits a match's start and/or end time (addressed by match number). Leave a field
blank to keep it unchanged.

```text
/match-timing match_number: 3  end_time: tomorrow 20:00
```

```text
/match-timing match_number: 3  start_time: now
```

➡️ Updates the deadline/open time and refreshes the dashboard.

---

### `/prediction-lock`

Manually locks a match so no further predictions are accepted (and posts the full
predictions list).

```text
/prediction-lock match_number: 3
```

➡️ Match `#3` becomes **Closed**; everyone's picks are revealed.

---

### `/match-resolve`

Stores the result, scores every prediction, and updates points.

**Football** (score as `X-Y`):

```text
/match-resolve match_number: 3  result: 2-1
```

**Cricket** (winning team name):

```text
/match-resolve match_number: 4  result: India
```

**Resolve a match in another tournament from any channel:**

```text
/match-resolve match_number: 2  result: 0-0  tournament_id: 2
```

➡️ Awards points, posts a "Match Resolved" announcement with the top scorers, and
refreshes the dashboard. Re-resolving applies the point _difference_, so it stays
consistent.

---

### `/dashboard-refresh`

Manually re-posts/refreshes the tournament's live dashboard message.

```text
/dashboard-refresh
```

```text
/dashboard-refresh tournament_id: 2
```

---

## 🌍 Prediction commands

> Accepted only while a match is **open** and before its `end_time`. You can
> overwrite your prediction until then.

### `/predict-football`

Predict a football score in `X-Y` format (same team order as the match).

```text
/predict-football match_number: 3  score: 2-1
```

➡️ Saves your pick for match `#3`; you can change it until predictions close.

### `/predict-cricket`

Predict the winning team of a cricket match.

```text
/predict-cricket match_number: 4  winner: India
```

### `/match-predictions`

List everyone's predictions for a match. Values stay **hidden** while the match is
open (only who has predicted is shown); revealed once it closes.

```text
/match-predictions match_number: 3
```

### `/my-predictions`

Privately (ephemeral) shows **your own** prediction history with each match's
result and the points you earned. Paginated.

```text
/my-predictions
```

---

## 🌍 Leaderboard commands

### `/leaderboard-global`

Shows everyone's total points across all tournaments. Paginated.

```text
/leaderboard-global
```

### `/leaderboard-tournament`

Shows the standings for one tournament. Paginated.

```text
/leaderboard-tournament tournament_id: 1
```

---

## 🔢 Match numbers — quick notes

- Match numbers are **per tournament** (and a separate group for standalone
  matches). They're what you see on the dashboard and what every command expects.
- New matches auto-get the next free number; you can override with `match_number`
  on `/match-add` or in import JSON.
- Numbers stay unique within a tournament. To re-sequence an existing tournament,
  use the DB scripts: `npm run renumber:matches -- <tournament> <startNumber>`
  (and `npm run migrate:match-numbers` to backfill numbers on an older database).
