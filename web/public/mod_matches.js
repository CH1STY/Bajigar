import {
  fmtDhaka,
  slotDescription,
  WC_BRACKET,
  WC_SCHEDULE,
} from "./mod_bracket.js";
import { destroy, el, esc, parseScore } from "./mod_core.js";
import { loadLineup } from "./mod_lineup.js";
import { barChart } from "./mod_overview.js";
import { sortableTable } from "./mod_tables.js";

export const MATCH_STATE_LABEL = {
  open: "Open",
  pending: "Upcoming",
  closed: "Closed",
  locked: "Locked",
  ended: "Closed",
  resolved: "Resolved",
  missing: "—",
};

export function matchTypeIcon(type) {
  return type === "football" ? "⚽" : "🏏";
}

export function fmtTime(epoch) {
  if (!epoch) return null;
  const d = new Date(Number(epoch));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Normalise a time value (epoch ms number, numeric string, or ISO date string)
 * into epoch milliseconds. Returns NaN when it can't be parsed.
 */
function toEpoch(value) {
  if (value == null) return NaN;
  if (typeof value === "number") return value;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const d = new Date(value).getTime();
  return Number.isNaN(d) ? NaN : d;
}

/**
 * Human-readable remaining time from now until `value` (epoch ms or ISO date).
 * Returns e.g. "2d 3h", "3h 15m", "12m 04s" or null when the time has passed
 * or is invalid.
 */
export function fmtCountdown(value) {
  const epoch = toEpoch(value);
  if (!Number.isFinite(epoch)) return null;
  const diff = epoch - Date.now();
  if (diff <= 0) return null;
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  // 1 day or more: keep it coarse (days + hours). Under a day: count all the
  // way down to seconds so the chip visibly ticks every second.
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Text for a countdown chip: "Match starts in …" or a fallback once it's due. */
function countdownText(epoch) {
  const left = fmtCountdown(epoch);
  return left ? `⏳ Match starts in ${left}` : "⏳ Match starting now";
}

/** HTML for a live countdown chip; empty string when there's no future time. */
export function countdownChipHtml(value) {
  const epoch = toEpoch(value);
  if (!Number.isFinite(epoch) || epoch - Date.now() <= 0) return "";
  return `<span class="mi-countdown" data-countdown-end="${epoch}">${countdownText(epoch)}</span>`;
}

// One shared ticker keeps every rendered countdown chip up to date each second.
let countdownTicker = null;
export function startCountdownTicker() {
  if (countdownTicker) return;
  const tick = () => {
    for (const node of document.querySelectorAll("[data-countdown-end]")) {
      node.textContent = countdownText(Number(node.dataset.countdownEnd));
    }
  };
  tick();
  countdownTicker = setInterval(tick, 1000);
}
startCountdownTicker();

// Per-prefix cache of the match list so team search can re-filter client-side.
export const matchExplorerData = {};

export function matchBucket(m) {
  if (m.state === "open") return "open";
  if (m.state === "pending") return "upcoming";
  // Predictions are closed/revealed but no final result yet → match is in
  // progress ("currently running"). Only fully resolved matches go to resolved.
  if (m.status === "resolved") return "resolved";
  return "closed";
}

export function renderMatchExplorer(p, matches) {
  matchExplorerData[p] = matches || [];
  const search = document.getElementById(`${p}-match-search`);
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", () => drawMatchColumns(p));
  }
  drawMatchColumns(p);
}

export function drawMatchColumns(p) {
  const matches = matchExplorerData[p] || [];
  const search = document.getElementById(`${p}-match-search`);
  const q = (search ? search.value : "").trim().toLowerCase();
  const filtered = q
    ? matches.filter((m) => `${m.teamA} ${m.teamB}`.toLowerCase().includes(q))
    : matches;

  const buckets = { open: [], closed: [], upcoming: [], resolved: [] };
  for (const m of filtered) buckets[matchBucket(m)].push(m);
  const byMatchNumber = (a, b) =>
    (b.matchNumber ?? b.id) - (a.matchNumber ?? a.id);
  // Open/Upcoming: soonest first so the shortest countdown sits at the top.
  // Matches without an end time fall to the bottom; ties break by match number.
  const bySoonest = (a, b) =>
    (a.endTime ?? Infinity) - (b.endTime ?? Infinity) ||
    (a.matchNumber ?? a.id) - (b.matchNumber ?? b.id);
  buckets.open.sort(bySoonest);
  buckets.closed.sort(byMatchNumber);
  buckets.upcoming.sort(bySoonest);
  buckets.resolved.sort(byMatchNumber);
  renderMatchColumn(p, "open", buckets.open);
  renderMatchColumn(p, "closed", buckets.closed);
  renderMatchColumn(p, "upcoming", buckets.upcoming);
  renderMatchColumn(p, "resolved", buckets.resolved);
}

export function renderMatchColumn(p, key, matches) {
  const listEl = document.getElementById(`${p}-col-${key}`);
  const countEl = document.getElementById(`${p}-col-${key}-count`);
  if (!listEl) return;
  if (countEl) countEl.textContent = matches.length;
  listEl.innerHTML = "";
  if (!matches.length) {
    listEl.innerHTML = '<div class="empty small">None</div>';
    return;
  }
  for (const m of matches) {
    const item = el("button", { className: "match-item", type: "button" });
    const showCountdown = key === "open" || key === "upcoming";
    item.innerHTML = `
      <span class="mi-id">#${m.matchNumber ?? m.id}</span>
      <span class="mi-dbid" title="Database id">id ${m.id}</span>
      <span class="mi-teams">${esc(m.teamA)} <em>v</em> ${esc(m.teamB)}</span>
      <span class="mi-meta">
        <span class="mi-type" title="${esc(m.type)}">${matchTypeIcon(m.type)}</span>
        ${m.isKnockout ? `<span class="mi-ko" title="Knockout match">KO</span>` : ""}
        ${
          m.result
            ? `<span class="mi-result">${esc(m.result)}${
                m.isKnockout && m.tiebreakerResult
                  ? ` <span class="mi-tb">(${esc(m.tiebreakerResult)})</span>`
                  : ""
              }</span>`
            : ""
        }
        <span class="mi-picks">${m.predictionCount} pick${m.predictionCount === 1 ? "" : "s"}</span>
      </span>
      ${showCountdown ? countdownChipHtml(m.endTime) : ""}`;
    item.addEventListener("click", () => openMatchModal(m, p));
    listEl.append(item);
  }
}

export function openMatchModal(m, p) {
  const overlay = document.getElementById("match-modal");
  const body = document.getElementById("match-modal-body");
  if (!overlay || !body) return;
  renderMatchDetail(body, m, "modal-match-dist", p);
  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

export function closeMatchModal() {
  const overlay = document.getElementById("match-modal");
  if (!overlay || overlay.hidden) return;
  destroy("modal-match-dist");
  overlay.hidden = true;
  document.body.classList.remove("modal-open");
}

/** Result (W/D/L) of a resolved match `h` from `team`'s point of view. */
export function teamResultOutcome(team, h) {
  if (h.type === "football") {
    const s = parseScore(h.result);
    if (!s) return { res: "?" };
    const [gf, ga] = h.teamA === team ? [s.a, s.b] : [s.b, s.a];
    return { res: gf > ga ? "W" : gf < ga ? "L" : "D", gf, ga };
  }
  // Cricket: the result string is the winning team's name.
  const won =
    String(h.result).trim().toLowerCase() === String(team).trim().toLowerCase();
  return { res: won ? "W" : "L" };
}

/** One compact history row (badge + opponent + score) for `team` in match `h`. */
export function historyRowHtml(team, h) {
  const o = teamResultOutcome(team, h);
  const opp = h.teamA === team ? h.teamB : h.teamA;
  const tb =
    h.isKnockout && h.tiebreakerResult
      ? ` <span class="hist-tb">(${esc(h.tiebreakerResult)})</span>`
      : "";
  return `<div class="hist-row">
      <span class="form-badge form-${o.res}">${o.res}</span>
      <span class="hist-opp">v ${esc(opp)}</span>
      <span class="hist-score">${esc(h.result)}${tb}</span>
      <span class="hist-num">#${h.matchNumber ?? h.id}</span>
    </div>`;
}

/**
 * Build a "history in this tournament" panel for an upcoming/open match: the
 * head-to-head record between the two sides plus each team's recent form,
 * drawn from the resolved matches in the same block (current tournament).
 * Returns null when there's nothing to show.
 */
export function renderTeamHistorySection(m, blockMatches) {
  const resolved = (blockMatches || []).filter(
    (h) => h.id !== m.id && h.status === "resolved" && h.result,
  );
  const involves = (h, t) => h.teamA === t || h.teamB === t;
  const byRecent = (a, b) =>
    (b.endTime || 0) - (a.endTime || 0) ||
    (b.matchNumber ?? b.id) - (a.matchNumber ?? a.id);

  const h2h = resolved
    .filter((h) => involves(h, m.teamA) && involves(h, m.teamB))
    .sort(byRecent);
  const formA = resolved
    .filter((h) => involves(h, m.teamA))
    .sort(byRecent)
    .slice(0, 5);
  const formB = resolved
    .filter((h) => involves(h, m.teamB))
    .sort(byRecent)
    .slice(0, 5);

  if (!h2h.length && !formA.length && !formB.length) return null;

  const sec = el("div", { className: "md-history" });
  let html = `<h3 class="md-history-title">📜 History in this tournament</h3>`;
  if (h2h.length) {
    html += `<div class="hist-block">
        <div class="hist-head">Head-to-head</div>
        ${h2h.map((h) => historyRowHtml(m.teamA, h)).join("")}
      </div>`;
  }
  const formCol = (team, form) =>
    `<div class="hist-block">
        <div class="hist-head">${esc(team)} — recent</div>
        ${
          form.length
            ? form.map((h) => historyRowHtml(team, h)).join("")
            : '<div class="empty small">No matches yet</div>'
        }
      </div>`;
  html += `<div class="hist-cols">
      ${formCol(m.teamA, formA)}
      ${formCol(m.teamB, formB)}
    </div>`;
  sec.innerHTML = html;
  return sec;
}

/** Human round name for a World Cup knockout match number. */
export function roundName(num) {
  if (num >= 73 && num <= 88) return "Round of 32";
  if (num >= 89 && num <= 96) return "Round of 16";
  if (num >= 97 && num <= 100) return "Quarter-final";
  if (num >= 101 && num <= 102) return "Semi-final";
  if (num === 103) return "Third-place play-off";
  if (num === 104) return "Final";
  return "Knockout";
}

/**
 * Open the match modal for a bracket slot that has no created match yet,
 * showing the projected matchup, each side's qualification path and whether it
 * is confirmed, projected or still undetermined.
 */
export function openBracketProjectionModal(t, num, info) {
  const overlay = document.getElementById("match-modal");
  const body = document.getElementById("match-modal-body");
  if (!overlay || !body) return;
  destroy("modal-match-dist");

  const slots = WC_BRACKET.slots[num] || [{}, {}];
  const sideHtml = (slot, side) => {
    let status, statusClass;
    if (side.real && side.projected) {
      status = "projected from current standings";
      statusClass = "proj-status proj-projected";
    } else if (side.real) {
      status = "confirmed";
      statusClass = "proj-status proj-confirmed";
    } else {
      status = "not determined yet";
      statusClass = "proj-status proj-tbd";
    }
    return `<div class="proj-side">
        <div class="proj-team">${side.real ? esc(side.text) : "TBD"}</div>
        <div class="proj-from">${esc(slotDescription(slot))}</div>
        <div class="${statusClass}">${status}</div>
      </div>`;
  };

  const sched = fmtDhaka(WC_SCHEDULE[num]);
  body.innerHTML = `
    <div class="md-head">
      <div class="md-title">${info.a.real ? esc(info.a.text) : "TBD"} <span class="md-v">v</span> ${info.b.real ? esc(info.b.text) : "TBD"}</div>
      <div class="md-sub">
        <span class="mi-type">⚽ Football</span>
        <span class="md-ko">🥅 Knockout</span>
        <span class="mi-state">${esc(roundName(num))} · Match ${num}</span>
        ${sched ? `<span class="md-result">Scheduled: <strong>${esc(sched)}</strong> (GMT+6)</span>` : ""}
      </div>
      ${
        countdownChipHtml(WC_SCHEDULE[num])
          ? `<div class="md-countdown">${countdownChipHtml(WC_SCHEDULE[num])}</div>`
          : ""
      }
    </div>
    <div class="proj-grid">
      ${sideHtml(slots[0], info.a)}
      <div class="proj-vs">vs</div>
      ${sideHtml(slots[1], info.b)}
    </div>
    <p class="proj-note">This match hasn't been created yet — once it is added, predictions and results will appear here.</p>`;

  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

export function renderMatchDetail(container, m, chartId, p) {
  if (!container) return;
  destroy(chartId);
  container.innerHTML = "";

  const head = el("div", { className: "md-head" });
  const opens = fmtTime(m.startTime);
  const closes = fmtTime(m.endTime);
  head.innerHTML = `
    <div class="md-title">${esc(m.teamA)} <span class="md-v">v</span> ${esc(m.teamB)}</div>
    <div class="md-sub">
      <span class="mi-type">${matchTypeIcon(m.type)} ${esc(m.type === "football" ? "Football" : "Cricket")}</span>
      ${m.isKnockout ? `<span class="md-ko">🥅 Knockout</span>` : ""}
      <span class="mi-state state-${esc(m.state)}">${esc(MATCH_STATE_LABEL[m.state] || m.state)}</span>
      ${
        m.result
          ? `<span class="md-result">Result: <strong>${esc(m.result)}</strong>${
              m.isKnockout && m.tiebreakerResult
                ? ` <span class="md-tb">· tie-breaker ${esc(m.tiebreakerResult)}</span>`
                : m.isKnockout
                  ? ` <span class="md-tb muted">· settled in regular time</span>`
                  : ""
            }</span>`
          : `<span class="md-result muted">No result yet</span>`
      }
    </div>
    ${
      opens || closes
        ? `<div class="md-times">${opens ? `Opens ${esc(opens)}` : ""}${opens && closes ? " · " : ""}${closes ? `Closes ${esc(closes)}` : ""}</div>`
        : ""
    }`;
  container.append(head);

  // For Upcoming/Open matches, surface a live human-readable countdown to the
  // moment the match starts (the prediction deadline / kick-off time).
  if ((m.state === "open" || m.state === "pending") && m.endTime) {
    const chip = countdownChipHtml(m.endTime);
    if (chip) {
      const cd = el("div", { className: "md-countdown" });
      cd.innerHTML = chip;
      container.append(cd);
    }
  }

  // For matches that haven't been played yet (Upcoming) or are still taking
  // picks (Open), surface how each side has fared so far in this tournament.
  if (m.state === "open" || m.state === "pending") {
    const history = renderTeamHistorySection(m, matchExplorerData[p]);
    if (history) container.append(history);
  }

  // Two tabs: Prediction Analysis (always) and Player Analysis (only shown
  // when a lineup exists for this match). The tab bar stays hidden until the
  // Player Analysis data loads, so non-lineup matches look unchanged.
  const tabs = el("div", { className: "md-tabs", hidden: true });
  const tabPred = el("button", {
    className: "md-tab active",
    type: "button",
    textContent: "Prediction Analysis",
  });
  const tabPlay = el("button", {
    className: "md-tab",
    type: "button",
    textContent: "Player Analysis",
  });
  tabs.append(tabPred, tabPlay);
  const predPane = el("div", { className: "md-pane" });
  const playPane = el("div", { className: "md-pane", hidden: true });
  container.append(tabs, predPane, playPane);

  const activate = (which) => {
    const pred = which === "pred";
    tabPred.classList.toggle("active", pred);
    tabPlay.classList.toggle("active", !pred);
    predPane.hidden = !pred;
    playPane.hidden = pred;
  };
  tabPred.addEventListener("click", () => activate("pred"));
  tabPlay.addEventListener("click", () => activate("play"));

  renderPredictionPane(predPane, m, chartId);

  // Player Analysis — resolved football matches only. Loaded on demand from
  // /api/lineup?matchId=…; a missing record just leaves the tab hidden.
  if (m.type === "football" && m.status === "resolved") {
    loadLineup(m, playPane, () => {
      tabs.hidden = false;
      // If there are no predictions to read, open straight to Player Analysis.
      if (!m.predictionCount) activate("play");
    });
  }
}

/** Render the prediction analytics (chart + per-prediction table) into a pane. */
export function renderPredictionPane(container, m, chartId) {
  if (!m.revealed) {
    container.append(
      el("div", {
        className: "banner show",
        textContent: `🔒 ${m.predictionCount} prediction(s) hidden until this match closes.`,
      }),
    );
    return;
  }

  if (!m.predictionCount) {
    container.append(
      el("div", {
        className: "empty",
        textContent: "No predictions for this match.",
      }),
    );
    return;
  }

  // Distribution chart (predicted scorelines / team picks).
  if (m.distribution && m.distribution.length) {
    const chartCard = el("div", { className: "md-chart" });
    chartCard.append(
      el("h3", {
        textContent:
          m.type === "football" ? "Predicted Scorelines" : "Team Picks",
      }),
    );
    chartCard.append(el("canvas", { id: chartId }));
    container.append(chartCard);
    barChart(
      chartId,
      m.distribution.map((d) => d.label),
      m.distribution.map((d) => d.count),
      "Picks",
    );
  }

  // Per-prediction table.
  const resolved = m.status === "resolved" && !!m.result;
  const isFootball = m.type === "football";
  const columns = [
    { label: "Player", value: (r) => r.name, render: (r) => esc(r.name) },
    {
      label: "Pick",
      value: (r) => r.value,
      render: (r) => `<strong>${esc(r.value)}</strong>`,
    },
  ];
  if (isFootball && m.isKnockout) {
    const tbActual = resolved ? m.tiebreakerResult : null;
    columns.push({
      label: "Tie-breaker",
      value: (r) => r.tiebreaker || "",
      render: (r) => {
        if (!r.tiebreaker) return '<span class="muted">—</span>';
        let cls = "";
        let mark = "";
        if (tbActual) {
          const pick = parseScore(r.tiebreaker);
          const act = parseScore(tbActual);
          if (pick && act) {
            const exact = pick.a === act.a && pick.b === act.b;
            const winner =
              Math.sign(pick.a - pick.b) === Math.sign(act.a - act.b);
            if (exact) {
              cls = "diff-good";
              mark = " ✅";
            } else if (winner) {
              cls = "tb-half";
              mark = " ◐";
            } else {
              cls = "diff-bad";
              mark = " ✗";
            }
          }
        }
        return `<span class="${cls}">${esc(r.tiebreaker)}${mark}</span>`;
      },
    });
  }
  if (resolved && isFootball) {
    columns.push({
      label: "Goal Diff",
      numeric: true,
      value: (r) => r.diff,
      render: (r) =>
        r.diff == null
          ? "—"
          : `<span class="${r.diff === 0 ? "diff-good" : "diff-bad"}">${r.diff}</span>`,
    });
  }
  if (resolved) {
    columns.push({
      label: "Outcome",
      value: (r) => (r.correct ? 0 : r.outcomeHit ? 1 : 2),
      render: (r) => {
        if (r.correct) return '<span class="tag tag-good">✅ Exact</span>';
        if (isFootball && r.outcomeHit)
          return '<span class="tag tag-mid">Right side</span>';
        return '<span class="tag tag-bad">Missed</span>';
      },
    });
    columns.push({
      label: "Points",
      numeric: true,
      value: (r) => r.points,
      render: (r) => `<strong>${r.points}</strong>`,
    });
  }
  container.append(
    el("h3", {
      className: "md-section",
      textContent: `Predictions (${m.predictions.length})`,
    }),
  );
  container.append(
    sortableTable(m.predictions, columns, {
      className: "data-table match-preds-table",
      emptyText: "No predictions for this match.",
    }),
  );
}
