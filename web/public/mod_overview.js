import { charts, destroy, el, esc, PALETTE } from "./mod_core.js";
import { openMatchModal, renderMatchExplorer } from "./mod_matches.js";
import { rankMedal, sortableTable } from "./mod_tables.js";
import {
  renderTournamentSummary,
  setupTournamentPicker,
} from "./mod_tournament.js";
import { appState } from "./mod_state.js";

export function blockHTML(p) {
  return `
    <section id="${p}-kpis" class="kpi-grid"></section>
    <div class="banner" id="${p}-hidden-note"></div>
    <section class="card wide" id="${p}-explorer">
      <h2>Match Explorer <span class="hint">search by team, click a match for predictions, analysis &amp; head-to-head</span></h2>
      <div class="match-explorer-controls">
        <input type="search" id="${p}-match-search" class="match-search" placeholder="🔎 Search by team…" autocomplete="off" />
      </div>
      <div class="match-columns match-columns-4">
        <div class="match-col">
          <h3 class="match-col-head open">Open <span class="col-count" id="${p}-col-open-count">0</span></h3>
          <div class="match-list" id="${p}-col-open"></div>
        </div>
        <div class="match-col">
          <h3 class="match-col-head closed">Closed <span class="col-count" id="${p}-col-closed-count">0</span></h3>
          <div class="match-list" id="${p}-col-closed"></div>
        </div>
        <div class="match-col">
          <h3 class="match-col-head upcoming">Upcoming <span class="col-count" id="${p}-col-upcoming-count">0</span></h3>
          <div class="match-list" id="${p}-col-upcoming"></div>
        </div>
        <div class="match-col">
          <h3 class="match-col-head resolved">Resolved <span class="col-count" id="${p}-col-resolved-count">0</span></h3>
          <div class="match-list" id="${p}-col-resolved"></div>
        </div>
      </div>
    </section>
    <section class="card-grid">
      <div class="card">
        <h2>Top Scorers</h2>
        <canvas id="${p}-chart-top"></canvas>
      </div>
      <div class="card">
        <h2>Outcome Breakdown <span class="hint">resolved football</span></h2>
        <canvas id="${p}-chart-outcome"></canvas>
      </div>
      <div class="card wide">
        <h2>Prediction Volume Trend <span class="hint" id="${p}-volume-hint">picks per match, over time</span></h2>
        <div class="volume-filter">
          <label>From <input type="date" id="${p}-volume-from" /></label>
          <label>To <input type="date" id="${p}-volume-to" /></label>
          <button type="button" class="volume-clear" id="${p}-volume-clear">Clear</button>
        </div>
        <canvas id="${p}-chart-volume"></canvas>
      </div>
      <div class="card">
        <h2>Sharpest Predictors <span class="hint">lowest avg goal diff</span></h2>
        <canvas id="${p}-chart-accuracy"></canvas>
      </div>
      <div class="card">
        <h2>Near-Miss Leaders <span class="hint">goal diff = 1</span></h2>
        <canvas id="${p}-chart-near"></canvas>
      </div>
      <div class="card wide">
        <h2>Most Predicted Scorelines</h2>
        <canvas id="${p}-chart-scorelines"></canvas>
      </div>
    </section>
    <section class="card-grid">
      <div class="card">
        <h2>🎯 Sharpest Predictor</h2>
        <div id="${p}-best-body" class="spotlight"></div>
      </div>
      <div class="card">
        <h2>🌪️ Furthest Off</h2>
        <div id="${p}-worst-body" class="spotlight"></div>
      </div>
    </section>
    <section class="card" id="${p}-players">
      <h2>Players</h2>
      <div class="table-wrap" id="${p}-players-table"></div>
    </section>`;
}

export async function load() {
  const btn = document.getElementById("refresh");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error("Request failed");
    const data = await res.json();
    render(data);
    document.getElementById("updated").textContent =
      "Updated " + new Date(data.generatedAt).toLocaleTimeString();
  } catch (err) {
    document.getElementById("ov-block").innerHTML =
      '<div class="empty">Could not load analytics. Is the server running?</div>';
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh";
  }
}

export function render(data) {
  appState.scoringConfig = data.scoring || appState.scoringConfig;
  // Overview tab = global block (same shape as each tournament block).
  document.getElementById("ov-block").innerHTML = blockHTML("ov");
  renderBlock("ov", data);

  // Tournaments tab.
  renderTournamentSummary(data.tournaments || []);
  setupTournamentPicker(data.tournaments || [], data.defaultTournamentId);
}

/** Render one analytics block into the elements prefixed by `p`. */
export function renderBlock(p, block) {
  renderKpis(p, block.overview);
  renderHiddenNote(p, block.overview);
  renderTopScorers(p, block.topScorers);
  renderOutcome(p, block.outcomeBreakdown);
  renderVolume(p, block.predictionVolume, block.matchList);
  renderAccuracy(p, block.avgGoalDiff);
  renderNear(p, block.nearMisses);
  renderScorelines(p, block.predictedScorelines);
  renderSpotlight(`${p}-best-body`, block.bestPredictor, "lowest");
  renderSpotlight(`${p}-worst-body`, block.worstPredictor, "highest");
  renderPlayers(p, block.players);
  renderMatchExplorer(p, block.matchList || []);
}

export function renderKpis(p, o) {
  const items = [
    ["Matches", o.totalMatches],
    ["Resolved", o.resolvedMatches],
    ["Open Now", o.openMatches],
    ["Predictions", o.totalPredictions],
    ["Players", o.totalPlayers],
    ["Avg Picks / Match", o.avgPredictionsPerMatch],
  ];
  const wrap = document.getElementById(`${p}-kpis`);
  wrap.innerHTML = "";
  for (const [label, value] of items) {
    wrap.append(
      el("div", { className: "kpi" }, [
        el("div", { className: "value", textContent: String(value) }),
        el("div", { className: "label", textContent: label }),
      ]),
    );
  }
}

export function renderHiddenNote(p, o) {
  const note = document.getElementById(`${p}-hidden-note`);
  if (o.hiddenPredictions > 0) {
    const preds = `${o.hiddenPredictions} prediction${o.hiddenPredictions === 1 ? "" : "s"}`;
    const matchCount = o.hiddenMatches || 0;
    const matches = `${matchCount} match${matchCount === 1 ? "" : "es"}`;
    note.textContent = `🔒 ${preds} across ${matches} ${
      o.hiddenPredictions === 1 ? "is" : "are"
    } hidden because the match is still open — those picks are excluded from value-level charts.`;
    note.classList.add("show");
  } else {
    note.classList.remove("show");
  }
}

export function barChart(id, labels, values, label, colorFn, opts) {
  destroy(id);
  const ctx = document.getElementById(id);
  charts[id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: labels.map((_, i) =>
            colorFn ? colorFn(i) : PALETTE[i % PALETTE.length],
          ),
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      ...(opts || {}),
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

export function emptyCanvas(id, msg) {
  destroy(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#93a0b5";
  ctx.font = "14px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(msg, canvas.width / 2, 40);
}

export function renderTopScorers(p, rows) {
  const id = `${p}-chart-top`;
  if (!rows.length) return emptyCanvas(id, "No points yet");
  barChart(
    id,
    rows.map((r) => r.name),
    rows.map((r) => r.points),
    "Points",
  );
}

export function renderOutcome(p, b) {
  const id = `${p}-chart-outcome`;
  destroy(id);
  const total = b.exact + b.near + b.outcomeOnly + b.miss;
  if (!total) return emptyCanvas(id, "No resolved football yet");
  charts[id] = new Chart(document.getElementById(id), {
    type: "doughnut",
    data: {
      labels: ["Exact score", "Near (diff 1)", "Right outcome", "Missed"],
      datasets: [
        {
          data: [b.exact, b.near, b.outcomeOnly, b.miss],
          backgroundColor: ["#57f287", "#faa61a", "#5865f2", "#ed4245"],
          borderColor: "#171c26",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

// Per-prefix cache of the volume rows so the date filter can re-draw client-side.
const volumeData = {};

// Compact date + 24-hour time (no AM/PM) to keep x-axis labels narrow.
function fmtVol(epoch) {
  if (!epoch) return null;
  const d = new Date(Number(epoch));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Local timezone label, e.g. "GMT+6" or "GMT-3:30".
function gmtLabel() {
  const offMin = -new Date().getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

// Map prefixes to their match lists so drawVolume can look up matches on click.
const volumeMatches = {};

export function renderVolume(p, rows, matches) {
  volumeData[p] = rows || [];
  volumeMatches[p] = matches || [];
  const hint = document.getElementById(`${p}-volume-hint`);
  if (hint)
    hint.textContent = `picks per match · dates as “MMM D, HH:MM” (24h, ${gmtLabel()})`;
  // Bind the date filter controls once.
  const from = document.getElementById(`${p}-volume-from`);
  const to = document.getElementById(`${p}-volume-to`);
  const clear = document.getElementById(`${p}-volume-clear`);
  if (from && !from.dataset.bound) {
    from.dataset.bound = "1";
    from.addEventListener("change", () => drawVolume(p));
    to.addEventListener("change", () => drawVolume(p));
    clear.addEventListener("click", () => {
      from.value = "";
      to.value = "";
      drawVolume(p);
    });
  }
  drawVolume(p);
}

function drawVolume(p) {
  const id = `${p}-chart-volume`;
  destroy(id);
  const all = volumeData[p] || [];
  const fromEl = document.getElementById(`${p}-volume-from`);
  const toEl = document.getElementById(`${p}-volume-to`);
  const fromTs =
    fromEl && fromEl.value
      ? new Date(`${fromEl.value}T00:00:00`).getTime()
      : -Infinity;
  const toTs =
    toEl && toEl.value
      ? new Date(`${toEl.value}T23:59:59.999`).getTime()
      : Infinity;
  const rows = all.filter((r) => {
    const t = r.endTime;
    return t == null || (t >= fromTs && t <= toTs);
  });
  if (!rows.length)
    return emptyCanvas(
      id,
      all.length ? "No matches in this date range" : "No predictions yet",
    );
  charts[id] = new Chart(document.getElementById(id), {
    type: "line",
    data: {
      labels: rows.map((r, i) => {
        const num = `#${r.matchNumber ?? r.matchId}`;
        const when = fmtVol(r.endTime);
        if (!when) return [num];
        // Keep the date line "discreet": only print it when the day changes
        // from the previous match, but always show every match number.
        const prev = rows[i - 1];
        const sameDay =
          prev &&
          r.endTime &&
          prev.endTime &&
          new Date(r.endTime).toDateString() ===
            new Date(prev.endTime).toDateString();
        return sameDay ? [num] : [num, when];
      }),
      datasets: [
        {
          label: "Predictions",
          data: rows.map((r) => r.count),
          borderColor: "#9b59b6",
          backgroundColor: "rgba(155,89,182,0.18)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: "#9b59b6",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => rows[items[0].dataIndex].label,
            afterTitle: (items) => {
              const r = rows[items[0].dataIndex];
              const now = Date.now();
              const opens = fmtVol(r.startTime);
              const closes = fmtVol(r.endTime);
              const lines = [];
              if (opens)
                lines.push(
                  `\u23F1 ${r.startTime <= now ? "Opened" : "Opens"}  ${opens}`,
                );
              if (closes)
                lines.push(
                  `\uD83C\uDFC1 ${r.endTime <= now ? "Closed" : "Closes"} ${closes}`,
                );
              return lines;
            },
            label: (item) =>
              ` ${item.parsed.y} prediction${item.parsed.y === 1 ? "" : "s"}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 },
        },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
      onClick: (event, activeElements) => {
        if (activeElements.length === 0) return;
        const dataIndex = activeElements[0].index;
        const row = rows[dataIndex];
        if (!row || !row.matchId) return;
        const matches = volumeMatches[p] || [];
        const match = matches.find((m) => (m.id ?? m.matchId) === row.matchId);
        if (match) openMatchModal(match, p);
      },
    },
  });
}

export function renderAccuracy(p, rows) {
  const id = `${p}-chart-accuracy`;
  const top = rows.slice(0, 12);
  if (!top.length) return emptyCanvas(id, "No graded football yet");
  barChart(
    id,
    top.map((r) => r.name),
    top.map((r) => r.avgDiff),
    "Avg goal diff",
    () => "#57f287",
  );
}

export function renderNear(p, rows) {
  const id = `${p}-chart-near`;
  if (!rows.length) return emptyCanvas(id, "No near-misses yet");
  barChart(
    id,
    rows.map((r) => r.name),
    rows.map((r) => r.count),
    "Near misses",
    () => "#faa61a",
  );
}

export function renderScorelines(p, rows) {
  const id = `${p}-chart-scorelines`;
  if (!rows.length) return emptyCanvas(id, "No revealed scores yet");
  barChart(
    id,
    rows.map((r) => r.score),
    rows.map((r) => r.count),
    "Times predicted",
    () => "#5865f2",
  );
}

export function renderSpotlight(bodyId, player, kind) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.innerHTML = "";
  if (!player) {
    body.append(
      el("div", { className: "empty", textContent: "Not enough data yet." }),
    );
    return;
  }
  body.append(el("div", { className: "name", textContent: player.name }));
  body.append(
    el("div", {
      className: "stat",
      textContent: `Avg goal difference: ${player.avgDiff} over ${player.games} match(es) · ${player.exact} exact · ${player.near} near`,
    }),
  );
  const preds = (player.preds || []).slice(0, 6);
  if (preds.length) {
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Match</th><th>Pick</th><th>Result</th><th>Diff</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const pr of preds) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(pr.label)}</td><td>${esc(pr.predicted)}</td><td>${esc(
        pr.result,
      )}</td><td class="${kind === "lowest" ? "diff-good" : "diff-bad"}">${pr.diff}</td>`;
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);
  }
}

export function renderPlayers(p, rows) {
  const container = document.getElementById(`${p}-players-table`);
  container.innerHTML = "";
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
      label: "Graded",
      numeric: true,
      value: (r) => r.gradedGames,
      render: (r) => r.gradedGames,
    },
    {
      label: "Avg Goal Diff",
      numeric: true,
      value: (r) => r.avgDiff,
      render: (r) => (r.avgDiff == null ? "—" : r.avgDiff),
    },
    {
      label: "Exact",
      numeric: true,
      value: (r) => r.exact,
      render: (r) => r.exact,
    },
    {
      label: "Near",
      numeric: true,
      value: (r) => r.near,
      render: (r) => r.near,
    },
    {
      label: "Hits",
      numeric: true,
      value: (r) => r.hits,
      render: (r) => (r.hits == null ? 0 : r.hits),
    },
  ];
  container.append(
    sortableTable(rows, columns, {
      className: "data-table players-table",
      rowClass: (r) => (r.rank && r.rank <= 3 ? "top-rank" : ""),
      emptyText: "No players yet.",
    }),
  );
}

/* ---- Match explorer (team search + open / upcoming / resolved + modal) ---- */
