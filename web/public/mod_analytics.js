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
import { appState } from "./mod_state.js";

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
            matches: [],
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
        const isCleanSheet =
          (posU === "GK" || posU === "DEF") && conceded === 0;
        if (isCleanSheet) {
          rec.cleanSheets += 1;
        }

        // Per-match breakdown for the player detail modal.
        rec.matches.push({
          matchId: Number(matchId),
          opponent,
          started: isStarter,
          minutes,
          rating,
          goals: g,
          assists: a,
          yellow: y,
          red: rd,
          saves,
          conceded,
          cleanSheet: isCleanSheet,
          motm: !!isMotm,
        });

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

  // Spotlights — rendered as ranked lists rather than a single name.
  // Player of the Tournament: highest composite score first, breaking ties by
  // appearances and then average match rating.
  const byScore = players.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.apps !== a.apps) return b.apps - a.apps;
    return (b.avg ?? 0) - (a.avg ?? 0);
  });
  if (pott) {
    const topN = byScore.slice(0, 5);
    if (!topN.length) {
      pott.innerHTML = '<div class="empty">No data yet</div>';
    } else {
      pott.innerHTML = topN
        .map((r, i) => {
          const disc = `<span class="ps-disc"${discStyle(r.color)}>${esc(r.number != null ? String(r.number) : (r.name || "?").charAt(0))}</span>`;
          const bits = [];
          if (r.goals) bits.push(`${r.goals} ⚽`);
          if (r.assists) bits.push(`${r.assists} 🅰️`);
          if (r.motm) bits.push(`${r.motm} ⭐`);
          if (r.avg != null) bits.push(`${r.avg.toFixed(2)} avg`);
          return `<div class="ps-spot ps-spot-row">
            <span class="ps-spot-rank">${rankMedal(i + 1)}</span>
            ${disc}
            <div class="ps-spot-main">
              <div class="name">${esc(r.name)} <span class="ps-team">${esc(r.team)}</span></div>
              <div class="stat">${bits.join(" · ") || "—"} · ${r.apps} app${r.apps === 1 ? "" : "s"}</div>
            </div>
          </div>`;
        })
        .join("");
    }
  }

  // Best individual performances: highest single-match rating first, breaking
  // ties by goals + assists in that match and then total appearances.
  const perfList = players
    .filter((r) => r.best)
    .sort((a, b) => {
      if (b.best.rating !== a.best.rating) return b.best.rating - a.best.rating;
      const aga = a.best.goals + a.best.assists;
      const bga = b.best.goals + b.best.assists;
      if (bga !== aga) return bga - aga;
      return b.apps - a.apps;
    })
    .slice(0, 5);
  if (best) {
    if (!perfList.length) {
      best.innerHTML = '<div class="empty">No data yet</div>';
    } else {
      best.innerHTML = perfList
        .map((r, i) => {
          const b = r.best;
          const disc = `<span class="ps-disc"${discStyle(r.color)}>${esc(r.number != null ? String(r.number) : (r.name || "?").charAt(0))}</span>`;
          const extra = [];
          if (b.goals) extra.push(`${b.goals} ⚽`);
          if (b.assists) extra.push(`${b.assists} 🅰️`);
          if (b.motm) extra.push("⭐ MOTM");
          return `<div class="ps-spot ps-spot-row">
            <span class="ps-spot-rank">${rankMedal(i + 1)}</span>
            ${disc}
            <div class="ps-spot-main">
              <div class="name">${esc(r.name)} <span class="ps-team">${esc(r.team)}</span></div>
              <div class="stat"><strong class="ps-rating ${ratingClass(b.rating)}">${b.rating.toFixed(1)}</strong> vs ${esc(b.opponent)}${extra.length ? ` · ${extra.join(" · ")}` : ""}</div>
            </div>
          </div>`;
        })
        .join("");
    }
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
        `<button class="ps-player-btn" data-player-name="${esc(r.name)}" data-player-team="${esc(r.team || "")}" style="border:none;background:none;color:var(--link);cursor:pointer;text-decoration:underline;padding:0;font-size:inherit;font-family:inherit">${r.number != null ? `<span class="ps-num">${esc(String(r.number))}</span> ` : ""}${esc(r.name)}</button>`,
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
      const name = btn.dataset.playerName;
      const team = btn.dataset.playerTeam || "";
      const rec =
        ranked.find((r) => r.name === name && (r.team || "") === team) ||
        ranked.find((r) => r.name === name);
      if (rec) openPlayerStats(rec, t);
    });
  });
}

/**
 * Show a modal with an individual player's match-by-match analysis for a
 * tournament. Uses the already-computed standings record (per-match goals,
 * assists, ratings, etc.) — this is player performance data, not predictions.
 * @param {Object} player - The aggregated player record from aggregatePlayers.
 * @param {Object} tournament - The tournament object (used for match labels).
 */
export function openPlayerStats(player, tournament) {
  const modal = document.getElementById("player-modal");
  const body = document.getElementById("player-modal-body");
  if (!modal || !body) return;

  const disc = `<span class="ps-disc"${discStyle(player.color)}>${esc(
    player.number != null
      ? String(player.number)
      : (player.name || "?").charAt(0),
  )}</span>`;

  const avgTxt =
    player.avg == null
      ? "–"
      : `<span class="ps-rating ${ratingClass(player.avg)}">${player.avg.toFixed(2)}</span>`;

  // Summary chips above the per-match table.
  const chip = (label, value) =>
    `<span class="ps-chip" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border:1px solid var(--border); border-radius:999px; background:var(--bg-accent); font-size:13px;"><strong>${esc(String(value))}</strong> ${esc(label)}</span>`;
  const chips = [
    chip("apps", player.apps || 0),
    chip("⚽", player.goals || 0),
    chip("🅰️", player.assists || 0),
    chip("⭐", player.motm || 0),
    chip("CS", player.cleanSheets || 0),
    chip("min", player.minutes || 0),
  ].join("");

  // Match-by-match rows (most recent / highest match number first).
  const matchMap = new Map((tournament.matchList || []).map((m) => [m.id, m]));
  const rows = (player.matches || []).slice().sort((a, b) => {
    const na = matchMap.get(a.matchId)?.matchNumber ?? a.matchId;
    const nb = matchMap.get(b.matchId)?.matchNumber ?? b.matchId;
    return nb - na;
  });

  let tableRows = "";
  for (const mr of rows) {
    const m = matchMap.get(mr.matchId);
    const label = m ? `#${m.matchNumber ?? m.id}` : `#${mr.matchId}`;
    const result = m && m.result ? esc(m.result) : "—";
    const ratingCell =
      mr.rating == null
        ? "–"
        : `<span class="ps-rating ${ratingClass(mr.rating)}">${mr.rating.toFixed(1)}</span>`;
    const badges = [];
    if (mr.motm) badges.push("⭐");
    if (mr.cleanSheet) badges.push("🧤");
    if (mr.yellow) badges.push(`${mr.yellow}🟨`);
    if (mr.red) badges.push(`${mr.red}🟥`);
    tableRows += `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:8px; white-space:nowrap;">${label}</td>
      <td style="padding:8px;">${esc(mr.opponent || "—")}</td>
      <td style="padding:8px; text-align:center;"><code>${result}</code></td>
      <td style="padding:8px; text-align:center;">${mr.started ? "Start" : "Sub"}</td>
      <td style="padding:8px; text-align:center;">${mr.minutes || 0}'</td>
      <td style="padding:8px; text-align:center;">${mr.goals || 0}</td>
      <td style="padding:8px; text-align:center;">${mr.assists || 0}</td>
      <td style="padding:8px; text-align:center;">${mr.saves || 0}</td>
      <td style="padding:8px; text-align:center;">${ratingCell}</td>
      <td style="padding:8px; text-align:center; white-space:nowrap;">${badges.join(" ") || "—"}</td>
    </tr>`;
  }

  const tableHtml = rows.length
    ? `<table style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead style="background:var(--bg-accent); border-bottom:2px solid var(--border);">
          <tr>
            <th style="padding:8px; text-align:left;">Match</th>
            <th style="padding:8px; text-align:left;">Opponent</th>
            <th style="padding:8px; text-align:center;">Result</th>
            <th style="padding:8px; text-align:center;">Role</th>
            <th style="padding:8px; text-align:center;">Min</th>
            <th style="padding:8px; text-align:center;">⚽</th>
            <th style="padding:8px; text-align:center;">🅰️</th>
            <th style="padding:8px; text-align:center;">Saves</th>
            <th style="padding:8px; text-align:center;">Rating</th>
            <th style="padding:8px; text-align:center;">Notes</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`
    : `<p style="color:var(--muted)"><em>No match appearances recorded.</em></p>`;

  body.innerHTML = `<div style="padding:20px;">
    <div class="ps-spot" style="margin-bottom:12px;">
      ${disc}
      <div class="ps-spot-main">
        <div class="name">${esc(player.name)} <span class="ps-team">${esc(player.team || "")}</span></div>
        <div class="stat">${player.pos ? `<span class="ps-pos">${esc(player.pos)}</span> · ` : ""}Avg rating ${avgTxt}</div>
      </div>
    </div>
    <div class="ps-chips" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">${chips}</div>
    <h3 style="margin:0 0 8px;">Match-by-Match</h3>
    ${tableHtml}
  </div>`;

  const dialog = modal.querySelector(".modal");
  if (dialog) {
    dialog.classList.remove("modal--narrow");
    dialog.classList.add("modal--wide");
  }
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

/**
 * Show a modal with a Discord predictor's match-by-match prediction history for
 * an analytics block (global overview or a single tournament). Uses the
 * per-match prediction rows already present in `block.matchList[].predictions`
 * (each has id, value, points, diff, outcomeHit, correct) so no extra fetch is
 * needed. Renders each match: their pick, the actual score, points earned and a
 * point breakdown (correct outcome / near miss / exact / bonus).
 * @param {Object} player - Standings row for the predictor ({ id, name, ... }).
 * @param {Object} block  - Analytics block with a `matchList` array.
 */
export function openPredictorHistory(player, block) {
  const modal = document.getElementById("player-modal");
  const body = document.getElementById("player-modal-body");
  if (!modal || !body || !player) return;

  const sc = appState.scoringConfig || {};
  const fb = sc.football || {
    exact: 10,
    near: 2.5,
    outcome: 5,
    tiebreakerWinner: 5,
    tiebreakerExact: 5,
  };
  const ck = sc.cricket || { correct: 10 };

  // Collect this player's predictions across every match in the block.
  const matchList = (block && block.matchList) || [];
  const entries = [];
  for (const m of matchList) {
    const pred = (m.predictions || []).find((p) => p.id === player.id);
    if (!pred) continue;
    entries.push({ m, pred });
  }
  entries.sort(
    (a, b) => (b.m.matchNumber ?? b.m.id) - (a.m.matchNumber ?? a.m.id),
  );

  // Point breakdown for a single prediction. Derived from the *awarded* points
  // (the authoritative leaderboard value) by decomposing them into the scoring
  // components, so the badges always reconcile with the points actually earned
  // — even when a match result was edited after the prediction was scored.
  const cmp = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const breakdown = (m, pred) => {
    if (m.status !== "resolved" || !m.result) {
      return `<span class="pb-chip pb-pending">Pending</span>`;
    }
    const pts = Math.round((Number(pred.points) || 0) * 100) / 100;
    let chips = [];
    if (m.type !== "football") {
      if (pts <= 0) chips = [{ label: "Miss", cls: "pb-miss" }];
      else if (Math.abs(pts - ck.correct) < 0.001)
        chips = [{ label: "Correct", cls: "pb-ok", pts: ck.correct }];
      else chips = [{ label: "Awarded", cls: "pb-ok", pts }];
    } else if (pts <= 0) {
      chips = [{ label: "Miss", cls: "pb-miss" }];
    } else {
      const menu = [
        {
          key: "outcome",
          label: "Correct outcome",
          pts: fb.outcome,
          cls: "pb-ok",
          tb: false,
        },
        {
          key: "exact",
          label: "Exact score",
          pts: fb.exact,
          cls: "pb-exact",
          tb: false,
        },
        {
          key: "near",
          label: "Near miss",
          pts: fb.near,
          cls: "pb-near",
          tb: false,
        },
      ];
      if (m.isKnockout) {
        menu.push({
          key: "tbWinner",
          label: "Tiebreaker winner",
          pts: fb.tiebreakerWinner,
          cls: "pb-bonus",
          tb: true,
        });
        menu.push({
          key: "tbExact",
          label: "Tiebreaker exact",
          pts: fb.tiebreakerExact,
          cls: "pb-bonus",
          tb: true,
        });
      }
      const n = menu.length;
      let best = null;
      for (let mask = 1; mask < 1 << n; mask++) {
        const sel = [];
        for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(menu[i]);
        const keys = new Set(sel.map((s) => s.key));
        if (keys.has("exact") && keys.has("near")) continue;
        if (keys.has("exact") && !keys.has("outcome")) continue;
        if (keys.has("tbExact") && !keys.has("tbWinner")) continue;
        const sum = sel.reduce((s, x) => s + x.pts, 0);
        if (Math.abs(sum - pts) > 0.001) continue;
        const tbCount = sel.filter((s) => s.tb).length;
        const rank = [tbCount, sel.length, keys.has("exact") ? 0 : 1];
        if (!best || cmp(rank, best.rank) < 0) best = { sel, rank };
      }
      chips = best
        ? best.sel.map((s) => ({ label: s.label, cls: s.cls, pts: s.pts }))
        : [{ label: "Awarded", cls: "pb-ok", pts }];
    }
    return chips
      .map(
        (c) =>
          `<span class="pb-chip ${c.cls}">${esc(c.label)}${c.pts != null ? ` <strong>+${c.pts}</strong>` : ""}</span>`,
      )
      .join(" ");
  };

  // Columns for the paginated/searchable history table.
  const columns = [
    {
      label: "Match",
      value: (r) => r.m.matchNumber ?? r.m.id,
      numeric: true,
      render: (r) =>
        `<strong>#${esc(String(r.m.matchNumber ?? r.m.id))}</strong> ${esc(r.m.teamA)} v ${esc(r.m.teamB)}`,
    },
    {
      label: "Prediction",
      value: (r) => r.pred.value || "",
      render: (r) =>
        r.pred.value
          ? `<code>${esc(r.pred.value)}</code>${r.pred.tiebreaker ? ` <span class="muted">(${esc(r.pred.tiebreaker)})</span>` : ""}`
          : "—",
    },
    {
      label: "Result",
      value: (r) => r.m.result || "",
      render: (r) =>
        r.m.status === "resolved" && r.m.result
          ? `<code>${esc(r.m.result)}</code>${r.m.tiebreakerResult ? ` <span class="muted">(${esc(r.m.tiebreakerResult)} pens)</span>` : ""}`
          : `<span class="muted">${esc(r.m.status || "—")}</span>`,
    },
    {
      label: "Breakdown",
      value: (r) => Number(r.pred.points) || 0,
      render: (r) => breakdown(r.m, r.pred),
    },
    {
      label: "Pts",
      numeric: true,
      value: (r) => Number(r.pred.points) || 0,
      render: (r) => {
        const pts = Number(r.pred.points) || 0;
        const color = pts > 0 ? "var(--green)" : "var(--muted)";
        return `<span style="color:${color}; font-weight:700;">${pts}</span>`;
      },
    },
  ];

  const chip = (label, value) =>
    `<span class="ps-chip" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border:1px solid var(--line); border-radius:999px; background:var(--panel-2); font-size:13px;"><strong>${esc(String(value))}</strong> ${esc(label)}</span>`;
  const chips = [
    chip("pts", player.points ?? 0),
    chip("predictions", player.predictions ?? 0),
    chip("exact", player.exact ?? 0),
    chip("near", player.near ?? 0),
    chip("hits", player.hits ?? 0),
  ].join("");

  body.innerHTML = `<div style="padding:20px;">
    <h2 style="margin:0 0 8px;">${esc(player.name)} — Prediction History</h2>
    <div class="ps-chips" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px;">${chips}</div>
    <div id="predictor-history-table"></div>
  </div>`;

  const tableHost = body.querySelector("#predictor-history-table");
  if (!entries.length) {
    tableHost.innerHTML = `<p style="color:var(--muted)"><em>No revealed predictions yet.</em></p>`;
  } else {
    const table = paginatedStandingsTable(entries, columns, {
      className: "data-table standings-table",
      emptyText: "No matching predictions.",
      searchValue: (r) =>
        `#${r.m.matchNumber ?? r.m.id} ${r.m.teamA} ${r.m.teamB}`,
      searchPlaceholder: "Search match or team…",
      defaultSortIndex: 0,
      pageSizes: [10, 20, 50, 100],
      defaultPageSize: 20,
    });
    tableHost.append(table);
  }

  const dialog = modal.querySelector(".modal");
  if (dialog) {
    dialog.classList.remove("modal--narrow");
    dialog.classList.add("modal--wide");
  }
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

/* ---- Tab + sub-tab switching and the dynamic navbar ---------------------- */
