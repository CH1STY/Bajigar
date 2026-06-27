import { renderThirdPlacedCard } from "./mod_bracket.js";
import { charts, el, esc, parseScore } from "./mod_core.js";
import {
  discStyle,
  minutesList,
  ratingClass,
  resolveMotm,
} from "./mod_lineup.js";
import { barChart, emptyCanvas, render } from "./mod_overview.js";
import { paginatedStandingsTable, rankMedal } from "./mod_tables.js";
import { computeLeagueTable, renderTeamTable } from "./mod_tournament.js";

export function resolvedFootballMatches(matchList) {
  const out = [];
  for (const m of matchList || []) {
    if (m.type !== "football") continue;
    if (m.status !== "resolved" || !m.result) continue;
    const sc = parseScore(m.result);
    if (!sc) continue;
    out.push({ ...m, sc });
  }
  return out;
}

/** Render KPIs, charts, spotlights and the league table for one tournament. */
export function renderTeamAnalytics(t) {
  const rows = computeLeagueTable(t.matchList);
  const games = resolvedFootballMatches(t.matchList);

  renderTeamKpis(rows, games);
  renderTeamBars("tn-team-gf", rows, (r) => r.gf, "Goals for", true);
  renderTeamBars("tn-team-ga", rows, (r) => r.ga, "Goals conceded", false);
  renderTeamBars("tn-team-wins", rows, (r) => r.won, "Wins", true);
  renderTeamBars("tn-team-gd", rows, (r) => r.gd, "Goal difference", true);
  renderThirdPlacedCard(t);
  renderTeamHighlights(games);
  renderTeamTable(document.getElementById("tn-team-table"), t);
}

export function renderTeamKpis(rows, games) {
  const wrap = document.getElementById("tn-team-kpis");
  const empty = document.getElementById("tn-team-empty");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!games.length) {
    if (empty) {
      empty.textContent = "No resolved football matches yet.";
      empty.classList.add("show");
    }
    return;
  }
  if (empty) empty.classList.remove("show");

  const totalGoals = games.reduce((s, g) => s + g.sc.a + g.sc.b, 0);
  const avg = (totalGoals / games.length).toFixed(2);
  const items = [
    ["Teams", rows.length],
    ["Matches Played", games.length],
    ["Goals Scored", totalGoals],
    ["Avg Goals / Match", avg],
  ];
  for (const [label, value] of items) {
    wrap.append(
      el("div", { className: "kpi" }, [
        el("div", { className: "value", textContent: String(value) }),
        el("div", { className: "label", textContent: label }),
      ]),
    );
  }
}

export function renderTeamBars(id, rows, valueFn, label, highFirst) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!rows.length) return emptyCanvas(id, "No resolved football yet");
  const sorted = rows
    .slice()
    .sort((a, b) =>
      highFirst ? valueFn(b) - valueFn(a) : valueFn(a) - valueFn(b),
    )
    .slice(0, 10);
  barChart(
    id,
    sorted.map((r) => r.team),
    sorted.map((r) => valueFn(r)),
    label,
    null,
    { maintainAspectRatio: false },
  );
}

export function renderTeamHighlights(games) {
  const biggest = document.getElementById("tn-team-biggest");
  const highest = document.getElementById("tn-team-highest");

  if (!games.length) {
    if (biggest) biggest.innerHTML = '<div class="empty">No matches yet</div>';
    if (highest) highest.innerHTML = '<div class="empty">No matches yet</div>';
    return;
  }

  // Biggest win = largest winning margin (skip draws).
  let bestMargin = null;
  // Highest-scoring = most total goals.
  let mostGoals = null;
  for (const g of games) {
    const margin = Math.abs(g.sc.a - g.sc.b);
    const total = g.sc.a + g.sc.b;
    if (margin > 0 && (!bestMargin || margin > bestMargin.margin)) {
      bestMargin = { g, margin };
    }
    if (!mostGoals || total > mostGoals.total) {
      mostGoals = { g, total };
    }
  }

  const matchLine = (g) => {
    const winnerA = g.sc.a > g.sc.b;
    const a = winnerA ? `<strong>${esc(g.teamA)}</strong>` : esc(g.teamA);
    const b =
      !winnerA && g.sc.b > g.sc.a
        ? `<strong>${esc(g.teamB)}</strong>`
        : esc(g.teamB);
    return `${a} ${g.sc.a}–${g.sc.b} ${b}`;
  };

  if (biggest) {
    biggest.innerHTML = bestMargin
      ? `<div class="name">${matchLine(bestMargin.g)}</div>
         <div class="stat">${bestMargin.margin}-goal margin</div>`
      : '<div class="empty">No decisive results yet</div>';
  }
  if (highest) {
    highest.innerHTML = `<div class="name">${matchLine(mostGoals.g)}</div>
       <div class="stat">${mostGoals.total} goals</div>`;
  }
}

/* ---- Player Standings (aggregated from per-match player analysis) ---------
 * Pulls every lineup for the tournament's matches and rolls each player's
 * goals, assists, cards, minutes, ratings and Player-of-the-Match awards into
 * a single season-long profile. */

/** Count an event from either an explicit count or a minute list. */
export function countEvent(count, mins) {
  const fromMins = minutesList(mins).length;
  if (fromMins) return fromMins;
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Total goals scored by one team (sum of its players' goals). */
export function teamGoals(team) {
  if (!team) return 0;
  const all = [...(team.starters || []), ...(team.bench || [])];
  return all.reduce((s, p) => s + (p ? countEvent(p.goals, p.goalsAt) : 0), 0);
}

/** Roll up player profiles across a map of {matchId: lineupData}. */
export function aggregatePlayers(lineups, matchTeams) {
  const teamsFor = matchTeams || {};
  const agg = new Map(); // key `${team}::${name}` → profile
  for (const [matchId, data] of Object.entries(lineups)) {
    if (!data) continue;
    // Identify teams from the match when the lineup JSON omits the names.
    const mt = teamsFor[matchId] || {};
    const nameFor = (side) => mt[side] || (data[side] && data[side].name) || "";
    const motm = resolveMotm(data);
    for (const side of ["home", "away"]) {
      const team = data[side];
      if (!team) continue;
      const oppSide = side === "home" ? "away" : "home";
      const oppTeam = data[oppSide];
      const opponent = nameFor(oppSide) || "—";
      const conceded = teamGoals(oppTeam);
      const teamName = nameFor(side);
      const starters = team.starters || [];
      const all = [...starters, ...(team.bench || [])];
      for (const p of all) {
        if (!p) continue;
        const isStarter = starters.includes(p);
        const minutes = Number(p.minutes) || 0;
        const rating =
          p.rating != null && !isNaN(p.rating) ? Number(p.rating) : null;
        // Skip unused players (e.g. a backup keeper who never came on).
        if (!isStarter && minutes <= 0 && rating == null) continue;

        const key = `${teamName}::${p.name}`;
        let rec = agg.get(key);
        if (!rec) {
          rec = {
            name: p.name || "?",
            number: p.number != null ? p.number : null,
            team: teamName,
            color: team.color || null,
            pos: p.pos || null,
            apps: 0,
            starts: 0,
            minutes: 0,
            goals: 0,
            assists: 0,
            yellow: 0,
            red: 0,
            saves: 0,
            cleanSheets: 0,
            ratingSum: 0,
            ratingCount: 0,
            motm: 0,
            best: null,
          };
          agg.set(key, rec);
        }

        const g = countEvent(p.goals, p.goalsAt);
        const a = countEvent(p.assists, p.assistsAt);
        const y = countEvent(p.yellow, p.yellowAt);
        const rd = countEvent(p.red, p.redAt);
        const saves = Number(p.saves) || 0;
        const isMotm = motm && motm.p === p;

        rec.apps += 1;
        if (isStarter) rec.starts += 1;
        rec.minutes += minutes;
        rec.goals += g;
        rec.assists += a;
        rec.yellow += y;
        rec.red += rd;
        rec.saves += saves;
        if (rating != null) {
          rec.ratingSum += rating;
          rec.ratingCount += 1;
        }
        if (isMotm) rec.motm += 1;
        if (p.pos && !rec.pos) rec.pos = p.pos;

        // Clean sheet: a goalkeeper or defender whose team conceded nothing.
        const posU = (p.pos || rec.pos || "").toUpperCase();
        if ((posU === "GK" || posU === "DEF") && conceded === 0) {
          rec.cleanSheets += 1;
        }

        // Best single-match performance: highest rating, then most G+A.
        if (rating != null) {
          const better =
            !rec.best ||
            rating > rec.best.rating ||
            (rating === rec.best.rating &&
              g + a > rec.best.goals + rec.best.assists);
          if (better) {
            rec.best = {
              rating,
              goals: g,
              assists: a,
              opponent,
              matchId: Number(matchId),
              motm: !!isMotm,
            };
          }
        }
      }
    }
  }

  // Derived fields.
  const list = [...agg.values()];
  for (const r of list) {
    r.avg = r.ratingCount ? r.ratingSum / r.ratingCount : null;
    r.ga = r.goals + r.assists;
    r.bestRating = r.best ? r.best.rating : null;
    // Composite season score: consistency (rating) + end product + awards.
    r.score =
      r.ratingSum + r.goals * 2 + r.assists * 1.5 + r.motm * 2 + r.saves * 0.1;
  }
  return list;
}

/** Render the Player Standings sub-tab for tournament `t`. */
export async function renderPlayerStandings(t) {
  const empty = document.getElementById("tn-player-empty");
  const kpis = document.getElementById("tn-player-kpis");
  const tableWrap = document.getElementById("tn-player-table");
  const pott = document.getElementById("tn-player-pott");
  const best = document.getElementById("tn-player-best");
  const chartIds = [
    "tn-player-goals",
    "tn-player-assists",
    "tn-player-rating",
    "tn-player-ga",
    "tn-player-minutes",
    "tn-player-motm",
  ];

  const showEmpty = (msg) => {
    if (empty) {
      empty.textContent = msg;
      empty.classList.add("show");
    }
    if (kpis) kpis.innerHTML = "";
    if (tableWrap) tableWrap.innerHTML = "";
    if (pott) pott.innerHTML = '<div class="empty">No data yet</div>';
    if (best) best.innerHTML = '<div class="empty">No data yet</div>';
    chartIds.forEach((id) => emptyCanvas(id, "No player data yet"));
  };

  const ids = (t.matchList || []).map((m) => m.id);
  if (!ids.length) return showEmpty("No matches in this tournament yet.");

  let lineups = {};
  try {
    const res = await fetch(`api/lineups?matchIds=${ids.join(",")}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) lineups = await res.json();
  } catch {
    /* network/parse error → treated as no data */
  }

  // Guard against a stale async response after the user switched tournaments.
  const select = document.getElementById("tn-select");
  if (select && select.value !== String(t.id)) return;

  if (!lineups || !Object.keys(lineups).length) {
    return showEmpty(
      "No player analysis data for this tournament yet. Add match lineups to populate player standings.",
    );
  }
  if (empty) empty.classList.remove("show");

  // Map each match id to its DB team names so players still group correctly
  // when a lineup's JSON has blank team names.
  const matchTeams = {};
  (t.matchList || []).forEach((m) => {
    matchTeams[m.id] = { home: m.teamA || "", away: m.teamB || "" };
  });

  const players = aggregatePlayers(lineups, matchTeams);
  if (!players.length) {
    return showEmpty("No player appearances recorded yet.");
  }

  const matchesAnalysed = Object.keys(lineups).length;
  const totalGoals = players.reduce((s, p) => s + p.goals, 0);
  const totalAssists = players.reduce((s, p) => s + p.assists, 0);
  const totalMotm = players.reduce((s, p) => s + p.motm, 0);

  // KPIs.
  if (kpis) {
    kpis.innerHTML = "";
    const items = [
      ["Players", players.length],
      ["Matches Analysed", matchesAnalysed],
      ["Goals", totalGoals],
      ["Assists", totalAssists],
      ["⭐ Awards", totalMotm],
    ];
    for (const [label, value] of items) {
      kpis.append(
        el("div", { className: "kpi" }, [
          el("div", { className: "value", textContent: String(value) }),
          el("div", { className: "label", textContent: label }),
        ]),
      );
    }
  }

  // Spotlights.
  const byScore = players.slice().sort((a, b) => b.score - a.score);
  const top = byScore[0];
  if (pott && top) {
    const disc = `<span class="ps-disc"${discStyle(top.color)}>${esc(top.number != null ? String(top.number) : (top.name || "?").charAt(0))}</span>`;
    const bits = [];
    if (top.goals) bits.push(`${top.goals} ⚽`);
    if (top.assists) bits.push(`${top.assists} 🅰️`);
    if (top.motm) bits.push(`${top.motm} ⭐`);
    if (top.avg != null) bits.push(`${top.avg.toFixed(2)} avg`);
    pott.innerHTML = `
      <div class="ps-spot">
        ${disc}
        <div class="ps-spot-main">
          <div class="name">${esc(top.name)} <span class="ps-team">${esc(top.team)}</span></div>
          <div class="stat">${bits.join(" · ") || "—"} · ${top.apps} app${top.apps === 1 ? "" : "s"}</div>
        </div>
      </div>`;
  }

  // Best single-match performance across all players.
  let bestPerf = null;
  for (const r of players) {
    if (r.best && (!bestPerf || r.best.rating > bestPerf.best.rating)) {
      bestPerf = r;
    }
  }
  if (best && bestPerf) {
    const b = bestPerf.best;
    const extra = [];
    if (b.goals) extra.push(`${b.goals} ⚽`);
    if (b.assists) extra.push(`${b.assists} 🅰️`);
    if (b.motm) extra.push("⭐ MOTM");
    best.innerHTML = `
      <div class="name">${esc(bestPerf.name)} <span class="ps-team">${esc(bestPerf.team)}</span></div>
      <div class="stat"><strong class="ps-rating ${ratingClass(b.rating)}">${b.rating.toFixed(1)}</strong> vs ${esc(b.opponent)}${extra.length ? ` · ${extra.join(" · ")}` : ""}</div>`;
  }

  // Charts.
  const topBy = (valueFn, n = 8) =>
    players
      .filter((p) => valueFn(p) > 0)
      .sort((a, b) => valueFn(b) - valueFn(a))
      .slice(0, n);
  const drawBar = (id, rows, valueFn, label, fixed) => {
    if (!rows.length) return emptyCanvas(id, "No data yet");
    barChart(
      id,
      rows.map((r) => r.name),
      rows.map((r) =>
        fixed != null ? Number(valueFn(r).toFixed(fixed)) : valueFn(r),
      ),
      label,
      null,
      { maintainAspectRatio: false },
    );
  };

  drawBar(
    "tn-player-goals",
    topBy((p) => p.goals),
    (p) => p.goals,
    "Goals",
  );
  drawBar(
    "tn-player-assists",
    topBy((p) => p.assists),
    (p) => p.assists,
    "Assists",
  );
  // Prefer players with 2+ appearances; fall back to 1 when none qualify yet.
  const rated = players.filter((p) => p.avg != null);
  const multiApp = rated.filter((p) => p.apps >= 2);
  drawBar(
    "tn-player-rating",
    (multiApp.length ? multiApp : rated)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8),
    (p) => p.avg,
    "Avg rating",
    2,
  );
  drawBar(
    "tn-player-ga",
    topBy((p) => p.ga),
    (p) => p.ga,
    "Goals + assists",
  );
  drawBar(
    "tn-player-minutes",
    topBy((p) => p.minutes),
    (p) => p.minutes,
    "Minutes",
  );
  drawBar(
    "tn-player-motm",
    topBy((p) => p.motm),
    (p) => p.motm,
    "⭐ awards",
  );

  // Standings table (default order: average match rating, high → low).
  const byRating = players.slice().sort((a, b) => {
    if (a.avg == null && b.avg == null) return 0;
    if (a.avg == null) return 1; // players without a rating sink to the bottom
    if (b.avg == null) return -1;
    return b.avg - a.avg;
  });
  const ranked = byRating.map((r, i) => ({ ...r, rank: i + 1 }));
  const columns = [
    {
      label: "#",
      numeric: true,
      value: (r) => r.rank,
      render: (r) => rankMedal(r.rank),
    },
    {
      label: "Player",
      value: (r) => r.name,
      render: (r) =>
        `<button class="ps-player-btn" data-player-name="${esc(r.name)}" style="border:none;background:none;color:var(--link);cursor:pointer;text-decoration:underline;padding:0;font-size:inherit;font-family:inherit">${r.number != null ? `<span class="ps-num">${esc(String(r.number))}</span> ` : ""}${esc(r.name)}</button>`,
    },
    {
      label: "Pos",
      value: (r) => r.pos || "",
      render: (r) =>
        r.pos ? `<span class="ps-pos">${esc(r.pos)}</span>` : "–",
    },
    { label: "Team", value: (r) => r.team, render: (r) => esc(r.team) },
    {
      label: "Apps",
      numeric: true,
      value: (r) => r.apps,
      render: (r) => r.apps,
    },
    {
      label: "Goals",
      numeric: true,
      value: (r) => r.goals,
      render: (r) => r.goals,
    },
    {
      label: "Assists",
      numeric: true,
      value: (r) => r.assists,
      render: (r) => r.assists,
    },
    {
      label: "Avg",
      numeric: true,
      value: (r) => (r.avg == null ? null : r.avg),
      render: (r) =>
        r.avg == null
          ? "–"
          : `<span class="ps-rating ${ratingClass(r.avg)}">${r.avg.toFixed(2)}</span>`,
    },
    {
      label: "Best",
      numeric: true,
      value: (r) => (r.bestRating == null ? null : r.bestRating),
      render: (r) =>
        r.bestRating == null
          ? "–"
          : `<span class="ps-rating ${ratingClass(r.bestRating)}">${r.bestRating.toFixed(1)}</span>`,
    },
    {
      label: "Saves",
      numeric: true,
      value: (r) => r.saves,
      render: (r) => r.saves || 0,
    },
    {
      label: "CS",
      numeric: true,
      value: (r) => r.cleanSheets,
      render: (r) => r.cleanSheets || 0,
    },
    {
      label: "⭐",
      numeric: true,
      value: (r) => r.motm,
      render: (r) => r.motm || 0,
    },
  ];
  tableWrap.innerHTML = "";
  const table = paginatedStandingsTable(ranked, columns, {
    className: "data-table standings-table",
    rowClass: (r) => (r.rank <= 3 ? "top-rank" : ""),
    emptyText: "No player data.",
    searchValue: (r) => r.name,
    searchPlaceholder: "Search player…",
    defaultSortIndex: columns.findIndex((c) => c.label === "Avg"),
  });
  tableWrap.append(table);

  // Add click handlers to player name buttons
  table.querySelectorAll(".ps-player-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openPlayerPredictionHistory(btn.dataset.playerName, t);
    });
  });
}

/**
 * Show a modal with a player's prediction history for a tournament.
 * @param {string} playerName - The player's name (Discord username)
 * @param {Object} tournament - The tournament object with matchList
 */
export async function openPlayerPredictionHistory(playerName, tournament) {
  const modal = document.getElementById("player-modal");
  const body = document.getElementById("player-modal-body");
  if (!modal || !body) return;

  body.innerHTML = `<div style="text-align: center; padding: 20px;"><em>Loading...</em></div>`;
  modal.hidden = false;
  document.body.classList.add("modal-open");

  try {
    // Fetch all predictions for this tournament
    const matchIds = (tournament.matchList || []).map((m) => m.id);
    const res = await fetch(
      `/api/predictions?matchIds=${matchIds.join(",")}&playerName=${encodeURIComponent(playerName)}`,
      { headers: { Accept: "application/json" } },
    );

    if (!res.ok) {
      body.innerHTML = `<div style="padding: 20px;"><strong>${esc(playerName)}</strong><p style="color:var(--red)">No prediction data found.</p></div>`;
      return;
    }

    const predictions = await res.json();
    const matches = new Map(tournament.matchList.map((m) => [m.id, m]));

    // Sort predictions by match number (descending)
    const sorted = (predictions || []).sort((a, b) => {
      const numA = matches.get(a.matchId)?.matchNumber ?? a.matchId;
      const numB = matches.get(b.matchId)?.matchNumber ?? b.matchId;
      return numB - numA;
    });

    if (!sorted.length) {
      body.innerHTML = `<div style="padding: 20px;"><strong>${esc(playerName)}</strong><p><em>No predictions in this tournament.</em></p></div>`;
      return;
    }

    let html = `<div style="padding: 20px;">
      <h2 style="margin-top: 0; margin-bottom: 16px;">${esc(playerName)} — Match Predictions</h2>
      <table style="width:100%; border-collapse: collapse; font-size:14px;">
        <thead style="background:var(--bg-accent); border-bottom:2px solid var(--border);">
          <tr>
            <th style="padding:8px; text-align:left;">Match</th>
            <th style="padding:8px; text-align:left;">Prediction</th>
            <th style="padding:8px; text-align:left;">Result</th>
            <th style="padding:8px; text-align:center;">Points</th>
          </tr>
        </thead>
        <tbody>`;

    for (const pred of sorted) {
      const match = matches.get(pred.matchId);
      if (!match) continue;

      const label = `#${match.matchNumber ?? match.id} ${esc(match.teamA)} v ${esc(match.teamB)}`;
      const result = match.result ? esc(match.result) : "—";
      const points = pred.points_earned ?? 0;
      const pointsColor = points > 0 ? "var(--green)" : "var(--muted)";

      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;">${label}</td>
        <td style="padding:8px;"><code>${esc(pred.value || "—")}</code></td>
        <td style="padding:8px;"><code>${result}</code></td>
        <td style="padding:8px; text-align:center; color:${pointsColor}; font-weight:600;">${points}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div style="padding: 20px;"><strong>${esc(playerName)}</strong><p style="color:var(--red)">Error loading predictions: ${esc(err.message)}</p></div>`;
  }
}

/* ---- Tab + sub-tab switching and the dynamic navbar ---------------------- */
