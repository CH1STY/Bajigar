import { renderPlayerStandings, renderTeamAnalytics } from "./mod_analytics.js";
import {
  buildLeagueTableEl,
  renderGroupedLeagueTables,
  renderKnockoutBracket,
} from "./mod_bracket.js";
import { el, esc, parseScore } from "./mod_core.js";
import { blockHTML, render, renderBlock } from "./mod_overview.js";
import { appState } from "./mod_state.js";
import { rankMedal, sortableTable } from "./mod_tables.js";
import { updateNav } from "./mod_ui.js";

export function renderTournamentSummary(tournaments) {
  const kpis = document.getElementById("tournament-kpis");
  const empty = document.getElementById("tournament-empty");
  kpis.innerHTML = "";

  if (!tournaments.length) {
    empty.textContent = "No tournaments yet.";
    empty.classList.add("show");
    document.getElementById("tournament-podium").innerHTML =
      '<div class="empty">No tournaments yet</div>';
    return;
  }
  empty.classList.remove("show");

  const active = tournaments.filter((t) => t.status === "active").length;
  const kpiItems = [
    ["Tournaments", tournaments.length],
    ["Active", active],
    ["Completed", tournaments.length - active],
    [
      "Total Predictions",
      tournaments.reduce((s, t) => s + t.overview.totalPredictions, 0),
    ],
  ];
  for (const [label, value] of kpiItems) {
    kpis.append(
      el("div", { className: "kpi" }, [
        el("div", { className: "value", textContent: String(value) }),
        el("div", { className: "label", textContent: label }),
      ]),
    );
  }
}

/** Podium of the top players within a single (selected) tournament. */
export function renderTournamentLeaders(t) {
  const podium = document.getElementById("tournament-podium");
  podium.innerHTML = "";

  const rows = (t.topScorers || []).slice(0, 3);
  if (!rows.length) {
    podium.innerHTML = '<div class="empty">No points yet</div>';
    return;
  }

  // Visual order: 2nd on the left, 1st in the middle, 3rd on the right.
  const order = [1, 0, 2];
  const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
  for (const idx of order) {
    const r = rows[idx];
    if (!r) continue;
    const place = idx + 1;
    podium.append(
      el("div", { className: `podium-spot place-${place}` }, [
        el("div", { className: "podium-medal", textContent: medals[idx] }),
        el("div", {
          className: "podium-name",
          title: r.name,
          textContent: r.name,
        }),
        el("div", {
          className: "podium-points",
          textContent: `${r.points} pts`,
        }),
        el("div", { className: "podium-bar" }, [
          el("span", { className: "podium-rank", textContent: `#${place}` }),
        ]),
      ]),
    );
  }
}

export function setupTournamentPicker(tournaments, defaultId) {
  const select = document.getElementById("tn-select");
  const block = document.getElementById("tn-block");
  const standings = document.getElementById("tn-standings");
  const statusPill = document.getElementById("tn-status");

  if (!tournaments.length) {
    select.innerHTML = "";
    statusPill.textContent = "";
    block.innerHTML = '<div class="empty">No tournaments yet.</div>';
    block.dataset.ready = "";
    standings.innerHTML = "";
    return;
  }

  // Preserve current selection across refreshes; otherwise honor the
  // configured default (WEB_DEFAULT_TOURNAMENT), falling back to the first.
  const prev = select.value;
  select.innerHTML = "";
  for (const t of tournaments) {
    select.append(el("option", { value: String(t.id), textContent: t.name }));
  }
  if (prev && tournaments.some((t) => String(t.id) === prev)) {
    select.value = prev;
  } else if (
    defaultId != null &&
    tournaments.some((t) => String(t.id) === String(defaultId))
  ) {
    select.value = String(defaultId);
  }

  // Build the block template once.
  if (!block.dataset.ready) {
    block.innerHTML = blockHTML("tn");
    block.dataset.ready = "1";
  }

  const draw = () => {
    const t = tournaments.find((x) => String(x.id) === select.value);
    if (!t) return;
    appState.currentTournament = t;
    statusPill.textContent = t.status;
    statusPill.className = `pill ${t.status === "active" ? "pill-active" : "pill-done"}`;
    renderTournamentLeaders(t);
    renderBlock("tn", t);
    renderStandings(standings, t);
    renderTeamAnalytics(t);
    renderPlayerStandings(t);
    updateNav();
  };

  select.onchange = draw;
  draw();
}

export function renderStandings(container, t) {
  container.innerHTML = "";
  if (!t.players.length) {
    container.innerHTML = '<div class="empty">No predictions yet.</div>';
    return;
  }
  const columns = [
    {
      label: "#",
      numeric: true,
      value: (r) => r.rank,
      render: (r) => rankMedal(r.rank),
    },
    { label: "Player", value: (r) => r.name, render: (r) => esc(r.name) },
    {
      label: "Points",
      numeric: true,
      value: (r) => r.points,
      render: (r) => `<strong>${r.points}</strong>`,
    },
    {
      label: "Predictions",
      numeric: true,
      value: (r) => r.predictions,
      render: (r) => r.predictions,
    },
    {
      label: "Hits",
      numeric: true,
      value: (r) => r.hits,
      render: (r) => (r.hits == null ? 0 : r.hits),
    },
  ];
  container.append(
    sortableTable(t.players, columns, {
      className: "data-table standings-table",
      rowClass: (r) => (r.rank <= 3 ? "top-rank" : ""),
      emptyText: "No predictions yet.",
    }),
  );
}

/* ---- Team Standings (real-time football league table) ----
 * Computed entirely from resolved football match scores — no DB column.
 * Win = 3 pts, Draw = 1 pt, Loss = 0 pt.
 * parseScore is imported from core.js (identical implementation). */

export function computeLeagueTable(matchList) {
  const teams = new Map();
  const get = (name) => {
    if (!teams.has(name)) {
      teams.set(name, {
        team: name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
      });
    }
    return teams.get(name);
  };

  for (const m of matchList || []) {
    if (m.type !== "football") continue;
    if (m.status !== "resolved" || !m.result) continue;
    const sc = parseScore(m.result);
    if (!sc) continue;
    const a = get(m.teamA);
    const b = get(m.teamB);
    a.played++;
    b.played++;
    a.gf += sc.a;
    a.ga += sc.b;
    b.gf += sc.b;
    b.ga += sc.a;
    if (sc.a > sc.b) {
      a.won++;
      b.lost++;
    } else if (sc.a < sc.b) {
      b.won++;
      a.lost++;
    } else {
      a.drawn++;
      b.drawn++;
    }
  }

  const rows = [...teams.values()].map((r) => ({
    ...r,
    gd: r.gf - r.ga,
    points: r.won * 3 + r.drawn,
  }));
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team),
  );
  rows.forEach((r, i) => (r.pos = i + 1));
  return rows;
}

export function renderTeamTable(container, t) {
  if (!container) return;
  container.innerHTML = "";

  const titleEl = document.getElementById("tn-team-table-title");
  const hintEl = document.getElementById("tn-team-table-hint");

  // World Cup tournaments: per-group League Tables plus a Knockout view,
  // switchable via a Groups/Knockout toggle.
  if (t.grouped && Array.isArray(t.groups) && t.groups.length && t.teamGroups) {
    if (titleEl) titleEl.textContent = "Group Tables";
    if (hintEl) hintEl.textContent = "group stage · top teams advance";
    // Let the knockout bracket break out of the .table-wrap overflow context
    // so its full-bleed wrapper can reach the viewport edges.
    container.classList.add("kt-standings");
    renderGroupedStandings(container, t);
    return;
  }

  container.classList.remove("kt-standings");
  if (titleEl) titleEl.textContent = "League Table";
  if (hintEl) {
    hintEl.textContent =
      "W = 3 · D = 1 · L = 0 · from resolved football scores";
  }

  const rows = computeLeagueTable(t.matchList);
  if (!rows.length) {
    container.innerHTML =
      '<div class="empty">No resolved football matches yet.</div>';
    return;
  }
  container.append(buildLeagueTableEl(rows));
}

/**
 * Count resolved football matches played strictly within a single group.
 * Used to decide which tab opens by default once the group stage is complete.
 */
export function countResolvedGroupMatches(t) {
  const teamGroups = t.teamGroups || {};
  const groupOf = (name) => teamGroups[String(name).trim().toLowerCase()];
  let count = 0;
  for (const m of t.matchList || []) {
    if (m.type !== "football" || m.status !== "resolved" || !m.result) continue;
    const ga = groupOf(m.teamA);
    const gb = groupOf(m.teamB);
    if (ga && gb && ga === gb) count++;
  }
  return count;
}

/**
 * Render the World Cup standings card: a Groups/Knockout toggle on top of the
 * per-group League Tables and a list of knockout (cross-group) matches.
 */
export function renderGroupedStandings(container, t) {
  // Once all 72 group-stage games are resolved, default to the Knockout tab.
  const GROUP_STAGE_GAMES = 72;
  const groupStageDone = countResolvedGroupMatches(t) >= GROUP_STAGE_GAMES;

  const toggle = el("div", { className: "kt-toggle", role: "tablist" });
  const groupsBtn = el("button", {
    className: groupStageDone ? "kt-tab" : "kt-tab active",
    type: "button",
    textContent: "Groups",
  });
  groupsBtn.dataset.view = "groups";
  const knockoutBtn = el("button", {
    className: groupStageDone ? "kt-tab active" : "kt-tab",
    type: "button",
    textContent: "Knockout",
  });
  knockoutBtn.dataset.view = "knockout";
  toggle.append(groupsBtn, knockoutBtn);

  const groupsView = el("div", {
    className: groupStageDone ? "kt-view" : "kt-view active",
  });
  renderGroupedLeagueTables(groupsView, t);

  const knockoutView = el("div", {
    className: groupStageDone ? "kt-view active" : "kt-view",
  });
  renderKnockoutBracket(knockoutView, t);

  const swap = (view) => {
    const groups = view === "groups";
    groupsBtn.classList.toggle("active", groups);
    knockoutBtn.classList.toggle("active", !groups);
    groupsView.classList.toggle("active", groups);
    knockoutView.classList.toggle("active", !groups);
  };
  groupsBtn.addEventListener("click", () => swap("groups"));
  knockoutBtn.addEventListener("click", () => swap("knockout"));

  container.append(toggle, groupsView, knockoutView);
}

/**
 * FIFA World Cup 2026 knockout bracket template (source: Wikipedia / FIFA
 * regulations). Match numbers follow the official schedule: group stage is
 * 1–72, the knockout stage is 73–104. For each match we record the two
 * "slots" that feed it, so the diagram can show real teams when a match exists
 * in the tournament data, or a descriptive placeholder otherwise.
 *
 * Slot kinds:
 *   { g: "A", pos: 1 } group winner; { g: "A", pos: 2 } group runner-up
 *   { third: ["A","B","C","D","F"] } one of the best third-placed teams
 *   { win: 73 } winner of match 73; { lose: 101 } loser of match 101
 */
