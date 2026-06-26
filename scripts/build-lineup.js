#!/usr/bin/env node
"use strict";

/**
 * Build a Player-Analysis lineup JSON (our schema) by merging two sources:
 *
 *   --opta     <file>  Primary. An Opta/Stats-Perform "MA2" match-stats feed
 *                      (the one with matchInfo + liveData.lineUp[].players[]).
 *                      Supplies squads, numbers, positions, minutes, goals,
 *                      team stats and xG.
 *
 *   --ratings  <file>  Secondary. A Sofascore payload that only fills the gaps
 *                      Opta does not provide: player `rating` and the official
 *                      `motm`. Accepts either the "best-players" shape
 *                      (bestHomeTeamPlayers / bestAwayTeamPlayers /
 *                      playerOfTheMatch) or a full "lineups" shape
 *                      ({ home:{players:[{player,statistics:{rating}}]}, away }).
 *
 * Optional:
 *   --matchId <n>      Our DB match id. If omitted it's left out so you can
 *                      pick the match in the web upload UI.
 *   --out <file>       Write result here instead of stdout.
 *
 * Example:
 *   node scripts/build-lineup.js --opta opta.json --ratings sofa.json \
 *        --matchId 46 --out out.json
 *
 * Fields Opta cannot supply (left blank for manual entry): color, flag,
 * goal/card/sub minutes (goalsAt, yellowAt, subbedOffAt, forNumber...).
 */

const fs = require("fs");

// --- tiny arg parser -------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

// --- helpers ---------------------------------------------------------------

/** Lowercase, strip accents/dots/extra spaces for fuzzy name matching. */
function normName(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Last token of a name, normalised (e.g. "J. Quiñones" -> "quinones"). */
function lastToken(s) {
  const n = normName(s);
  const parts = n.split(" ");
  return parts[parts.length - 1] || "";
}

/** Map an Opta position string to our GK/DEF/MID/FWD. */
function mapPos(position, subPosition) {
  const decide = (raw) => {
    const x = (raw || "").toLowerCase();
    if (!x) return null;
    if (x.includes("keeper") || x === "gk" || x === "g") return "GK";
    if (x.includes("back") || x.includes("defen")) return "DEF";
    if (x.includes("midfield") || x === "m") return "MID";
    if (
      x.includes("strik") ||
      x.includes("forward") ||
      x.includes("attack") ||
      x.includes("wing") ||
      x === "f"
    )
      return "FWD";
    return null;
  };
  const p = (position || "").toLowerCase();
  if (p === "substitute") return decide(subPosition);
  return decide(position);
}

/** Sum every Opta goal-type stat into a single goal count. */
function goalCount(stats) {
  if (!stats) return 0;
  const keys = [
    "attHdGoal",
    "attRfGoal",
    "attLfGoal",
    "attOboxGoal",
    "attIboxGoal",
    "attPenGoal",
    "attFreekickGoal",
  ];
  let g = 0;
  for (const k of keys) if (typeof stats[k] === "number") g += stats[k];
  return g;
}

const num = (v) => (typeof v === "number" && !isNaN(v) ? v : undefined);

/** "41231" -> "4-1-2-3-1". Returns undefined if not a digit string. */
function formationDashes(f) {
  if (typeof f !== "string" || !/^\d{3,5}$/.test(f)) return undefined;
  return f.split("").join("-");
}

// --- Opta side -------------------------------------------------------------

/** Build one team object (name/formation/starters/bench) from an Opta entry. */
function buildTeamFromOpta(entry) {
  const team = {
    name: entry.name || entry.official_name || "",
    starters: [],
    bench: [],
  };
  const formation = formationDashes(entry.formationUsed);
  if (formation) team.formation = formation;

  for (const pl of entry.players || []) {
    const s = pl.stats || {};
    const isStarter = s.gameStarted === 1;
    const player = {
      number: pl.shirtNumber,
      name: pl.matchName || pl.lastName || "",
      pos: mapPos(pl.position, pl.subPosition),
    };
    const mins = num(s.minsPlayed);
    if (mins != null) player.minutes = mins;
    const goals = goalCount(s);
    if (goals > 0) player.goals = goals;
    if (num(s.saves) > 0) player.saves = s.saves;
    if (pl.captain === true) player.captain = true;

    if (isStarter) team.starters.push(player);
    else team.bench.push(player);
  }
  return team;
}

/** Build teamStats from an Opta team-level stats block (only present fields). */
function buildTeamStats(stats) {
  if (!stats) return undefined;
  const out = {};
  const shots =
    num(stats.totalScoringAtt) != null
      ? stats.totalScoringAtt
      : num(stats.attemptsIbox) != null || num(stats.attemptsObox) != null
        ? (stats.attemptsIbox || 0) + (stats.attemptsObox || 0)
        : undefined;
  if (shots != null) out.shots = shots;
  if (num(stats.ontargetScoringAtt) != null)
    out.shotsOnTarget = stats.ontargetScoringAtt;
  if (num(stats.possessionPercentage) != null)
    out.possession = Math.round(stats.possessionPercentage);
  if (num(stats.totalPass) != null) out.passes = stats.totalPass;
  if (num(stats.accuratePass) != null && num(stats.totalPass) != null)
    out.passAccuracy = Math.round((stats.accuratePass / stats.totalPass) * 100);
  if (num(stats.fkFoulLost) != null) out.fouls = stats.fkFoulLost;
  if (num(stats.totalOffside) != null) out.offsides = stats.totalOffside;
  if (num(stats.wonCorners) != null) out.corners = stats.wonCorners;
  else if (num(stats.cornerTaken) != null) out.corners = stats.cornerTaken;
  if (num(stats.expectedGoals) != null)
    out.expectedGoals = Math.round(stats.expectedGoals * 100) / 100;
  return Object.keys(out).length ? out : undefined;
}

// --- Sofascore (ratings + motm) -------------------------------------------

/**
 * Pull { home:[{name,shortName,rating}], away:[...], motm:{name,shortName} }
 * from a Sofascore payload. Handles both the "best-players" and full
 * "lineups" shapes.
 */
function extractRatings(sofa) {
  const home = [];
  const away = [];
  let motm = null;

  const pushFromBest = (arr, bucket) => {
    for (const it of arr || []) {
      const p = it.player || {};
      const r = parseFloat(it.value);
      if (!isNaN(r))
        bucket.push({ name: p.name, shortName: p.shortName, rating: r });
    }
  };

  // best-players shape
  if (sofa.bestHomeTeamPlayers || sofa.bestAwayTeamPlayers) {
    pushFromBest(sofa.bestHomeTeamPlayers, home);
    pushFromBest(sofa.bestAwayTeamPlayers, away);
  }

  // full lineups shape: { home:{players:[{player,statistics:{rating}}]}, away }
  const pushFromLineup = (side, bucket) => {
    const players = (side && side.players) || [];
    for (const it of players) {
      const p = it.player || {};
      const r = parseFloat(
        (it.statistics && it.statistics.rating) != null
          ? it.statistics.rating
          : NaN,
      );
      if (!isNaN(r))
        bucket.push({ name: p.name, shortName: p.shortName, rating: r });
    }
  };
  if (sofa.home && sofa.home.players) pushFromLineup(sofa.home, home);
  if (sofa.away && sofa.away.players) pushFromLineup(sofa.away, away);

  if (sofa.playerOfTheMatch && sofa.playerOfTheMatch.player) {
    motm = {
      name: sofa.playerOfTheMatch.player.name,
      shortName: sofa.playerOfTheMatch.player.shortName,
    };
  }

  return { home, away, motm };
}

/** Find the rating for an Opta player from a list of Sofascore ratings. */
function findRating(player, ratings) {
  const targetShort = normName(player.name);
  const targetLast = lastToken(player.name);
  // 1) exact normalised shortName
  for (const r of ratings) {
    if (r.shortName && normName(r.shortName) === targetShort) return r.rating;
  }
  // 2) last-name match
  for (const r of ratings) {
    if (lastToken(r.shortName) === targetLast) return r.rating;
    if (lastToken(r.name) === targetLast) return r.rating;
  }
  return null;
}

// --- main ------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.opta || !args.ratings || args.help) {
    console.error(
      "Usage: node scripts/build-lineup.js --opta <optaFile> --ratings <sofaFile> [--matchId N] [--out file]",
    );
    process.exit(args.help ? 0 : 1);
  }

  const opta = readJson(args.opta);
  const sofa = readJson(args.ratings);

  const lineUp = (opta.liveData && opta.liveData.lineUp) || opta.lineUp || [];
  const homeEntry = lineUp.find((t) => t.position === "home") || lineUp[0];
  const awayEntry = lineUp.find((t) => t.position === "away") || lineUp[1];
  if (!homeEntry || !awayEntry) {
    console.error("Could not find home/away teams in the Opta feed.");
    process.exit(1);
  }

  const result = {};
  if (args.matchId) result.matchId = Number(args.matchId);

  const home = buildTeamFromOpta(homeEntry);
  const away = buildTeamFromOpta(awayEntry);

  // Merge ratings from Sofascore.
  const ratings = extractRatings(sofa);
  let matched = 0;
  let missing = 0;
  const applyRatings = (team, list) => {
    for (const p of [...team.starters, ...team.bench]) {
      const r = findRating(p, list);
      if (r != null) {
        p.rating = r;
        matched++;
      } else {
        missing++;
      }
    }
  };
  applyRatings(home, ratings.home);
  applyRatings(away, ratings.away);

  // Resolve MOTM to { team, number } using our (Opta) numbers.
  if (ratings.motm) {
    const target = normName(ratings.motm.shortName || ratings.motm.name);
    const targetLast = lastToken(ratings.motm.shortName || ratings.motm.name);
    const findIn = (team) =>
      [...team.starters, ...team.bench].find(
        (p) => normName(p.name) === target || lastToken(p.name) === targetLast,
      );
    const inHome = findIn(home);
    const inAway = inHome ? null : findIn(away);
    if (inHome) result.motm = { team: "home", number: inHome.number };
    else if (inAway) result.motm = { team: "away", number: inAway.number };
  }

  result.home = home;
  result.away = away;

  const homeStats = buildTeamStats(homeEntry.stats);
  const awayStats = buildTeamStats(awayEntry.stats);
  if (homeStats || awayStats) {
    result.teamStats = {};
    if (homeStats) result.teamStats.home = homeStats;
    if (awayStats) result.teamStats.away = awayStats;
  }

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json + "\n");
    console.error(`Wrote ${args.out}`);
  } else {
    process.stdout.write(json + "\n");
  }

  // Summary to stderr (doesn't pollute stdout JSON).
  console.error(
    `Ratings matched: ${matched}, missing: ${missing}` +
      (result.motm
        ? `  MOTM: ${result.motm.team} #${result.motm.number}`
        : "  MOTM: (not resolved)"),
  );
  console.error(
    "Not filled by this feed (add manually if wanted): color, flag, " +
      "goal/card/sub minutes (goalsAt, yellowAt, subbedOffAt, forNumber).",
  );
}

main();
