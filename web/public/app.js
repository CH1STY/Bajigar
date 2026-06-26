/* Front-end: fetch analytics and render charts + tables.
 * The Overview tab and each Tournament render the SAME analytics "block"
 * (KPIs, charts, spotlights, players) via renderBlock(prefix, block). */

const PALETTE = [
  "#9b59b6",
  "#5865f2",
  "#57f287",
  "#faa61a",
  "#ed4245",
  "#1abc9c",
  "#e67e22",
  "#3498db",
  "#e91e63",
  "#2ecc71",
  "#f1c40f",
  "#00bcd4",
];

const charts = {};

Chart.defaults.color = "#93a0b5";
Chart.defaults.borderColor = "#2a3242";
Chart.defaults.font.family = "Segoe UI, Roboto, sans-serif";

function destroy(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

/** Parse an "X-Y" score string into { a, b } numbers (or null). */
function parseScore(v) {
  const m = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(String(v || ""));
  return m ? { a: +m[1], b: +m[2] } : null;
}

/** HTML template for one analytics block, with element IDs namespaced by prefix. */
function blockHTML(p) {
  return `
    <section id="${p}-kpis" class="kpi-grid"></section>
    <div class="banner" id="${p}-hidden-note"></div>
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
        <h2>Prediction Volume Trend <span class="hint">picks per match, over time</span></h2>
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
    <section class="card wide">
      <h2>Match Explorer <span class="hint">search by team, click a match for predictions &amp; analysis</span></h2>
      <div class="match-explorer-controls">
        <input type="search" id="${p}-match-search" class="match-search" placeholder="🔎 Search by team…" autocomplete="off" />
      </div>
      <div class="match-columns">
        <div class="match-col">
          <h3 class="match-col-head resolved">Resolved <span class="col-count" id="${p}-col-resolved-count">0</span></h3>
          <div class="match-list" id="${p}-col-resolved"></div>
        </div>
        <div class="match-col">
          <h3 class="match-col-head open">Open <span class="col-count" id="${p}-col-open-count">0</span></h3>
          <div class="match-list" id="${p}-col-open"></div>
        </div>
        <div class="match-col">
          <h3 class="match-col-head upcoming">Upcoming <span class="col-count" id="${p}-col-upcoming-count">0</span></h3>
          <div class="match-list" id="${p}-col-upcoming"></div>
        </div>
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
    <section class="card">
      <h2>Players</h2>
      <div class="table-wrap" id="${p}-players-table"></div>
    </section>`;
}

async function load() {
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

function render(data) {
  scoringConfig = data.scoring || scoringConfig;
  // Overview tab = global block (same shape as each tournament block).
  document.getElementById("ov-block").innerHTML = blockHTML("ov");
  renderBlock("ov", data);

  // Tournaments tab.
  renderTournamentSummary(data.tournaments || []);
  setupTournamentPicker(data.tournaments || [], data.defaultTournamentId);
}

/** Render one analytics block into the elements prefixed by `p`. */
function renderBlock(p, block) {
  renderKpis(p, block.overview);
  renderHiddenNote(p, block.overview);
  renderTopScorers(p, block.topScorers);
  renderOutcome(p, block.outcomeBreakdown);
  renderVolume(p, block.predictionVolume);
  renderAccuracy(p, block.avgGoalDiff);
  renderNear(p, block.nearMisses);
  renderScorelines(p, block.predictedScorelines);
  renderSpotlight(`${p}-best-body`, block.bestPredictor, "lowest");
  renderSpotlight(`${p}-worst-body`, block.worstPredictor, "highest");
  renderPlayers(p, block.players);
  renderMatchExplorer(p, block.matchList || []);
}

function renderKpis(p, o) {
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

function renderHiddenNote(p, o) {
  const note = document.getElementById(`${p}-hidden-note`);
  if (o.hiddenPredictions > 0) {
    note.textContent = `🔒 ${o.hiddenPredictions} prediction(s) are hidden because their match is still open — those picks are excluded from value-level charts.`;
    note.classList.add("show");
  } else {
    note.classList.remove("show");
  }
}

function barChart(id, labels, values, label, colorFn, opts) {
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

function emptyCanvas(id, msg) {
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

function renderTopScorers(p, rows) {
  const id = `${p}-chart-top`;
  if (!rows.length) return emptyCanvas(id, "No points yet");
  barChart(
    id,
    rows.map((r) => r.name),
    rows.map((r) => r.points),
    "Points",
  );
}

function renderOutcome(p, b) {
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

function renderVolume(p, rows) {
  const id = `${p}-chart-volume`;
  destroy(id);
  if (!rows.length) return emptyCanvas(id, "No predictions yet");
  charts[id] = new Chart(document.getElementById(id), {
    type: "line",
    data: {
      labels: rows.map((r) => `#${r.matchNumber ?? r.matchId}`),
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
          callbacks: { title: (items) => rows[items[0].dataIndex].label },
        },
      },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderAccuracy(p, rows) {
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

function renderNear(p, rows) {
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

function renderScorelines(p, rows) {
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

function renderSpotlight(bodyId, player, kind) {
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

function renderPlayers(p, rows) {
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

const MATCH_STATE_LABEL = {
  open: "Open",
  pending: "Upcoming",
  closed: "Closed",
  locked: "Locked",
  ended: "Closed",
  resolved: "Resolved",
  missing: "—",
};

function matchTypeIcon(type) {
  return type === "football" ? "⚽" : "🏏";
}

function fmtTime(epoch) {
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

// Per-prefix cache of the match list so team search can re-filter client-side.
const matchExplorerData = {};

function matchBucket(m) {
  if (m.state === "open") return "open";
  if (m.state === "pending") return "upcoming";
  return "resolved";
}

function renderMatchExplorer(p, matches) {
  matchExplorerData[p] = matches || [];
  const search = document.getElementById(`${p}-match-search`);
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", () => drawMatchColumns(p));
  }
  drawMatchColumns(p);
}

function drawMatchColumns(p) {
  const matches = matchExplorerData[p] || [];
  const search = document.getElementById(`${p}-match-search`);
  const q = (search ? search.value : "").trim().toLowerCase();
  const filtered = q
    ? matches.filter((m) => `${m.teamA} ${m.teamB}`.toLowerCase().includes(q))
    : matches;

  const buckets = { open: [], upcoming: [], resolved: [] };
  for (const m of filtered) buckets[matchBucket(m)].push(m);
  const byMatchNumber = (a, b) =>
    (b.matchNumber ?? b.id) - (a.matchNumber ?? a.id);
  buckets.open.sort(byMatchNumber);
  buckets.upcoming.sort(byMatchNumber);
  buckets.resolved.sort(byMatchNumber);
  renderMatchColumn(p, "resolved", buckets.resolved);
  renderMatchColumn(p, "open", buckets.open);
  renderMatchColumn(p, "upcoming", buckets.upcoming);
}

function renderMatchColumn(p, key, matches) {
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
      </span>`;
    item.addEventListener("click", () => openMatchModal(m));
    listEl.append(item);
  }
}

function openMatchModal(m) {
  const overlay = document.getElementById("match-modal");
  const body = document.getElementById("match-modal-body");
  if (!overlay || !body) return;
  renderMatchDetail(body, m, "modal-match-dist");
  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

function closeMatchModal() {
  const overlay = document.getElementById("match-modal");
  if (!overlay || overlay.hidden) return;
  destroy("modal-match-dist");
  overlay.hidden = true;
  document.body.classList.remove("modal-open");
}

/** Human round name for a World Cup knockout match number. */
function roundName(num) {
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
function openBracketProjectionModal(t, num, info) {
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

function renderMatchDetail(container, m, chartId) {
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
function renderPredictionPane(container, m, chartId) {
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

/* ============================ Player Analysis ============================ *
 * SofaScore-style lineup pitch for resolved football matches. Data is stored
 * in the match_lineups DB table and served at /api/lineup?matchId=N. Authoring
 * lives in data/lineups/*.json → run `node scripts/import-lineups.js`.
 * A missing record simply hides the Player Analysis tab.
 * ----------------------------------------------------------------------- */

/**
 * Fetch and render the lineup panel. Calls onLoaded() only when data exists so
 * the caller can reveal the Player Analysis tab; otherwise it is a silent no-op.
 */
async function loadLineup(m, host, onLoaded) {
  try {
    const res = await fetch(`api/lineup?matchId=${encodeURIComponent(m.id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || (!data.home && !data.away)) return;
    renderLineup(host, data, m);
    if (typeof onLoaded === "function") onLoaded();
  } catch {
    /* network/parse error → leave the panel hidden */
  }
}

/** Theme colour class for a player rating badge. */
function ratingClass(r) {
  if (r == null || isNaN(r)) return "rt-none";
  if (r < 5) return "rt-vlow";
  if (r < 6) return "rt-low";
  if (r < 7) return "rt-mid";
  if (r < 8) return "rt-good";
  return "rt-great";
}

/**
 * Pick a readable text colour (dark or light) for a given background so the
 * player number stays visible on any jersey colour. Returns null for values
 * we can't parse (e.g. CSS vars), leaving the stylesheet default in place.
 */
function textOn(bg) {
  if (typeof bg !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const toLin = (c) => {
    const x = parseInt(c, 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * toLin(h.slice(0, 2)) +
    0.7152 * toLin(h.slice(2, 4)) +
    0.0722 * toLin(h.slice(4, 6));
  return L > 0.55 ? "#0e1116" : "#ffffff";
}

/** Inline style attribute for a coloured disc, with auto-contrasted text. */
function discStyle(color) {
  if (!color) return "";
  const t = textOn(color);
  return ` style="background:${esc(color)}${t ? `;color:${t}` : ""}"`;
}

/** Parse a formation string ("4-3-3") into outfield row counts. */
function parseFormation(f) {
  const rows = String(f || "")
    .split("-")
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  return rows.length ? rows : null;
}

/**
 * Compute {x,y} (percent) for each starter of one team. Order is GK first,
 * then defence, midfield, attack (left→right within each row). `side` is
 * "top" (attacks downward) or "bottom" (attacks upward). Explicit per-player
 * x/y override the auto-layout.
 */
function lineupPositions(team, side) {
  const starters = team.starters || [];
  const rows = parseFormation(team.formation) || [starters.length - 1];
  const top = side === "top";
  // Bands (percent of full pitch height) for GK and the outfield rows. Wide
  // bands keep adjacent rows from overlapping even for deep formations.
  const gkY = top ? 4 : 96;
  const bandStart = top ? 14 : 86; // nearest own goal
  const bandEnd = top ? 43 : 57; // nearest halfway line (gap keeps opposing forwards apart)
  const rowY = (r) =>
    rows.length === 1
      ? (bandStart + bandEnd) / 2
      : bandStart + ((bandEnd - bandStart) * r) / (rows.length - 1);

  const out = [];
  let idx = 0;
  // GK
  if (starters[idx]) {
    const p = starters[idx];
    out.push({ p, x: p.x ?? 50, y: p.y ?? gkY });
    idx++;
  }
  rows.forEach((count, r) => {
    for (let i = 0; i < count && starters[idx]; i++, idx++) {
      const p = starters[idx];
      const autoX = ((i + 1) / (count + 1)) * 100;
      out.push({ p, x: p.x ?? autoX, y: p.y ?? rowY(r) });
    }
  });
  // Any leftover starters (formation/count mismatch) drop near halfway.
  while (starters[idx]) {
    const p = starters[idx];
    out.push({ p, x: p.x ?? 50, y: p.y ?? (top ? 43 : 57) });
    idx++;
  }
  return out;
}

/** Normalise a minute value (number, array, or "23,67") into a list of strings. */
function minutesList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return arr.map((x) => String(x).trim()).filter((x) => x !== "");
}

/** Small event-icon cluster for a player (goals, assists, cards) with minutes. */
function playerEventIcons(p) {
  const goalsAt = minutesList(p.goalsAt);
  const assistsAt = minutesList(p.assistsAt);
  const yellowAt = minutesList(p.yellowAt);
  const redAt = minutesList(p.redAt);
  const bits = [];
  const add = (emoji, label, count, mins) => {
    const n = count != null ? Number(count) : mins.length;
    for (let i = 0; i < n; i++) {
      const m = mins[i];
      const title = m != null ? `${label} ${m}'` : label;
      bits.push(
        `<span class="ev" title="${esc(title)}">${emoji}${m != null ? `<i class="ev-min">${esc(m)}'</i>` : ""}</span>`,
      );
    }
  };
  add("⚽", "Goal", p.goals, goalsAt);
  add("🅰️", "Assist", p.assists, assistsAt);
  add("🟨", "Yellow card", p.yellow, yellowAt);
  add("🟥", "Red card", p.red, redAt);
  if (!bits.length) return "";
  return `<span class="pl-events">${bits.join("")}</span>`;
}

/** One player marker positioned on the pitch. `pid` enables the detail modal. */
function playerMarker(node, color, pid, isMotm) {
  const { p, x, y } = node;
  const initials =
    p.photo == null
      ? esc(p.number != null ? String(p.number) : (p.name || "?").charAt(0))
      : "";
  const avatar = p.photo
    ? `<img class="pl-photo" src="${esc(p.photo)}" alt="" loading="lazy">`
    : `<span class="pl-disc"${discStyle(color)}>${initials}</span>`;
  const rating =
    p.rating != null && !isNaN(p.rating)
      ? `<span class="pl-rating ${ratingClass(p.rating)}">${Number(p.rating).toFixed(1)}</span>`
      : `<span class="pl-rating rt-none">–</span>`;
  const cap = p.captain ? `<span class="pl-cap" title="Captain">C</span>` : "";
  const motmStar = isMotm
    ? `<span class="pl-motm" title="Player of the Match">⭐</span>`
    : "";
  const subOff =
    p.subbedOffAt != null
      ? `<span class="pl-suboff" title="Substituted off ${esc(p.subbedOffAt)}'">↓${esc(p.subbedOffAt)}'</span>`
      : "";
  return `
    <button type="button" class="pl-marker${isMotm ? " pl-marker--motm" : ""}" data-pid="${pid}" style="left:${x}%;top:${y}%">
      <div class="pl-avatar">
        ${avatar}
        ${rating}
        ${cap}
        ${motmStar}
        ${playerEventIcons(p)}
        ${subOff}
      </div>
      <div class="pl-name">${p.number != null ? `<span class="pl-num">${esc(p.number)}</span> ` : ""}${esc(p.name || "")}</div>
    </button>`;
}

/** Bench list for one team. `idOf(player)` supplies each row's detail-modal id. */
function benchColumn(team, idOf) {
  const bench = team.bench || [];
  if (!bench.length)
    return `<div class="bench-col"><div class="bench-team">${esc(team.name || "")}</div><div class="empty">No bench data</div></div>`;
  const rows = bench
    .map((p) => {
      const rt =
        p.rating != null && !isNaN(p.rating)
          ? `<span class="pl-rating ${ratingClass(p.rating)}">${Number(p.rating).toFixed(1)}</span>`
          : "";
      const on =
        p.subbedOnAt != null
          ? `<span class="bench-on" title="Came on ${esc(p.subbedOnAt)}'">↑${esc(p.subbedOnAt)}'</span>`
          : "";
      return `<button type="button" class="bench-row" data-pid="${idOf(p)}">
          <span class="bench-name">${p.number != null ? `<span class="pl-num">${esc(p.number)}</span> ` : ""}${esc(p.name || "")}</span>
          <span class="bench-meta">${on}${playerEventIcons(p)}${rt}</span>
        </button>`;
    })
    .join("");
  return `<div class="bench-col"><div class="bench-team">${esc(team.name || "")}</div>${rows}</div>`;
}

/** Team header strip (flag · name · formation) shown above/below the pitch. */
function teamStrip(team, pos) {
  if (!team) return "";
  const flag = team.flag
    ? `<span class="ts-flag">${esc(team.flag)}</span>`
    : "";
  const form = team.formation
    ? `<span class="ts-form">${esc(team.formation)}</span>`
    : "";
  return `<div class="team-strip team-strip--${pos}">${flag}<span class="ts-name">${esc(team.name || "")}</span>${form}</div>`;
}

/**
 * Resolve the Man of the Match player from `data.motm`. Accepts a player name
 * string, or an object { team:"home"|"away", number } / { team, name }. Returns
 * { p, team, side, color } or null.
 */
function resolveMotm(data) {
  const spec = data && data.motm;
  if (!spec) return null;
  const sides = [
    { team: data.home, side: "home" },
    { team: data.away, side: "away" },
  ];
  const wantTeam = typeof spec === "object" ? spec.team : null;
  const wantNum =
    typeof spec === "object" && spec.number != null
      ? Number(spec.number)
      : null;
  const wantName =
    typeof spec === "string" ? spec : (spec && spec.name) || null;
  for (const { team, side } of sides) {
    if (!team) continue;
    if (wantTeam && wantTeam !== side) continue;
    const all = [...(team.starters || []), ...(team.bench || [])];
    const found = all.find((p) => {
      if (wantNum != null) return Number(p.number) === wantNum;
      if (wantName)
        return (p.name || "").toLowerCase() === wantName.toLowerCase();
      return false;
    });
    if (found) return { p: found, team, side, color: team.color || null };
  }
  return null;
}

/** Headline "Player of the Match" banner, if `motm` resolves to a player. */
function motmBanner(motm) {
  if (!motm) return "";
  const { p, team, color } = motm;
  const num =
    p.number != null ? `<span class="motm-num">#${esc(p.number)}</span> ` : "";
  const rating =
    p.rating != null && !isNaN(p.rating)
      ? `<span class="motm-rating ${ratingClass(p.rating)}">${Number(p.rating).toFixed(1)}</span>`
      : "";
  const goals = minutesList(p.goalsAt);
  const assists = minutesList(p.assistsAt);
  const bits = [];
  if (goals.length) bits.push(`${goals.length} ⚽`);
  if (assists.length) bits.push(`${assists.length} 🅰️`);
  if (p.saves != null && Number(p.saves) > 0)
    bits.push(`${Number(p.saves)} 🧤`);
  const contrib = bits.length
    ? `<span class="motm-contrib">${bits.join(" · ")}</span>`
    : "";
  const initial = esc(
    p.number != null ? String(p.number) : (p.name || "?").charAt(0),
  );
  const disc = `<span class="motm-disc"${discStyle(color)}>${initial}</span>`;
  return `
    <div class="motm-banner">
      <span class="motm-star">⭐</span>
      <span class="motm-label">Player of the Match</span>
      ${disc}
      <span class="motm-name">${num}${esc(p.name || "")}<span class="motm-team">${esc(team.name || "")}</span></span>
      ${contrib}
      ${rating}
    </div>`;
}

/** Render the full Player Analysis panel into `host`. */
function renderLineup(host, data, m) {
  const away = data.away || null; // top half
  const home = data.home || null; // bottom half
  // Always take the team names from the match itself rather than the lineup
  // JSON, which may store blank or stale names. The JSON name is only used as
  // a fallback when the match has none. Mutating the shared team objects means
  // the team strips, bench, MOTM banner and player modal all pick up the names.
  if (m) {
    if (home) home.name = m.teamA || m.team_a || home.name || "";
    if (away) away.name = m.teamB || m.team_b || away.name || "";
  }

  // Index every player (starters + bench, both teams) so a click can open the
  // detail modal. `entries[pid]` = { p, team, side }.
  const entries = [];
  const idMap = new Map();
  const register = (team, side) => {
    if (!team) return;
    for (const p of team.starters || []) {
      idMap.set(p, entries.length);
      entries.push({ p, team, side });
    }
    for (const p of team.bench || []) {
      idMap.set(p, entries.length);
      entries.push({ p, team, side });
    }
  };
  register(away, "away");
  register(home, "home");
  const idOf = (p) => idMap.get(p);

  const motm = resolveMotm(data);
  const motmP = motm && motm.p;

  const markers = [];
  if (away)
    for (const node of lineupPositions(away, "top"))
      markers.push(
        playerMarker(node, away.color, idOf(node.p), node.p === motmP),
      );
  if (home)
    for (const node of lineupPositions(home, "bottom"))
      markers.push(
        playerMarker(node, home.color, idOf(node.p), node.p === motmP),
      );

  host.innerHTML = `
    ${motmBanner(motm)}
    ${teamStrip(away, "top")}
    <div class="pitch">
      <svg class="pitch-lines" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
        <rect x="2" y="2" width="96" height="146" rx="1"/>
        <line x1="2" y1="75" x2="98" y2="75"/>
        <circle cx="50" cy="75" r="11"/>
        <circle cx="50" cy="75" r="0.8" class="spot"/>
        <rect x="22" y="2" width="56" height="22"/>
        <rect x="37" y="2" width="26" height="8"/>
        <circle cx="50" cy="18" r="0.8" class="spot"/>
        <path d="M 40 24 A 11 11 0 0 0 60 24"/>
        <rect x="22" y="126" width="56" height="22"/>
        <rect x="37" y="140" width="26" height="8"/>
        <circle cx="50" cy="132" r="0.8" class="spot"/>
        <path d="M 40 126 A 11 11 0 0 1 60 126"/>
      </svg>
      <div class="pitch-players">${markers.join("")}</div>
    </div>
    ${teamStrip(home, "bottom")}
    <div class="lineup-legend">
      <span><i class="lg rt-great"></i>8+</span>
      <span><i class="lg rt-good"></i>7–7.9</span>
      <span><i class="lg rt-mid"></i>6–6.9</span>
      <span><i class="lg rt-low"></i>5–5.9</span>
      <span><i class="lg rt-vlow"></i>&lt;5</span>
      <span>⚽ goal</span>
      <span>🅰️ assist</span>
      <span>🟨🟥 card</span>
      <span>↓ off · ↑ on</span>
      <span class="lg-cap"><b>C</b> captain</span>
    </div>
    <p class="lineup-hint">Tip: tap any player for their match stats.</p>
    ${teamStatsSection(data, home, away)}
    <h3 class="md-section">Bench</h3>
    <div class="bench-grid">
      ${home ? benchColumn(home, idOf) : ""}
      ${away ? benchColumn(away, idOf) : ""}
    </div>`;

  // One delegated handler opens the detail modal for any player (pitch/bench).
  host.addEventListener("click", (e) => {
    const node = e.target.closest("[data-pid]");
    if (!node) return;
    const entry = entries[Number(node.dataset.pid)];
    if (entry) openPlayerModal(entry, data, m);
  });
}

/** Whether lower is the "better" value for a team-stat metric. */
const STAT_LOWER_BETTER = new Set(["fouls", "yellow", "red", "offsides"]);

/** The team-stats comparison block (image-3 style), if data is present. */
function teamStatsSection(data, home, away) {
  const ts = data.teamStats;
  if (!ts || (!ts.home && !ts.away)) return "";
  const H = ts.home || {};
  const A = ts.away || {};
  const homeColor = (home && home.color) || "var(--accent)";
  const awayColor = (away && away.color) || "var(--accent-2)";
  const metrics = [
    ["shots", "Shots"],
    ["shotsOnTarget", "Shots on target"],
    ["possession", "Possession", "%"],
    ["passes", "Passes"],
    ["passAccuracy", "Pass accuracy", "%"],
    ["fouls", "Fouls"],
    ["yellow", "Yellow cards"],
    ["red", "Red cards"],
    ["offsides", "Offsides"],
    ["corners", "Corners"],
  ];
  const rows = metrics
    .filter(([k]) => H[k] != null || A[k] != null)
    .map(([k, label, suffix]) => {
      const hv = H[k] == null ? null : Number(H[k]);
      const av = A[k] == null ? null : Number(A[k]);
      const sfx = suffix || "";
      let hWin = false;
      let aWin = false;
      if (hv != null && av != null && hv !== av) {
        const homeBetter = STAT_LOWER_BETTER.has(k) ? hv < av : hv > av;
        hWin = homeBetter;
        aWin = !homeBetter;
      }
      const hPill = hWin
        ? ` style="background:${esc(homeColor)};color:#fff"`
        : "";
      const aPill = aWin
        ? ` style="background:${esc(awayColor)};color:#fff"`
        : "";
      return `<div class="tstat-row">
          <span class="tstat-val tstat-home"><span class="tstat-pill"${hPill}>${hv != null ? esc(hv) + sfx : "–"}</span></span>
          <span class="tstat-label">${esc(label)}</span>
          <span class="tstat-val tstat-away"><span class="tstat-pill"${aPill}>${av != null ? esc(av) + sfx : "–"}</span></span>
        </div>`;
    })
    .join("");
  if (!rows) return "";
  return `
    <h3 class="md-section">Team Stats</h3>
    <div class="tstat-head">
      <span>${esc((home && home.name) || "Home")}</span>
      <span></span>
      <span>${esc((away && away.name) || "Away")}</span>
    </div>
    <div class="tstat-table">${rows}</div>`;
}

/** Stat rows for the player detail modal — varies for goalkeepers. */
function playerStatRows(p, isGK) {
  const rows = [];
  const num = (v) => (v == null ? 0 : Number(v));
  if (p.rating != null && !isNaN(p.rating)) {
    rows.push(
      `<div class="ps-row ps-rating-row">
        <span class="ps-label">Player rating<small>Based on match data</small></span>
        <span class="pl-rating ${ratingClass(p.rating)}">${Number(p.rating).toFixed(1)}</span>
      </div>`,
    );
  }
  if (p.subbedOffAt != null) {
    rows.push(
      statRow(
        "Substitution time",
        `<span class="ps-sub off">↓ ${esc(p.subbedOffAt)}'</span>`,
      ),
    );
  } else if (p.subbedOnAt != null) {
    rows.push(
      statRow(
        "Substitution time",
        `<span class="ps-sub on">↑ ${esc(p.subbedOnAt)}'</span>`,
      ),
    );
  }
  if (p.minutes != null) rows.push(statRow("Minutes played", esc(p.minutes)));
  // Count with optional event minutes, e.g. "2 (23', 67')".
  const withMins = (count, src) => {
    const mins = minutesList(src);
    const c = num(count != null ? count : mins.length);
    return mins.length
      ? `${c} <span class="ps-mins">(${mins.map((m) => esc(m) + "'").join(", ")})</span>`
      : String(c);
  };
  if (isGK) {
    rows.push(statRow("Keeper saves", num(p.saves)));
  } else {
    rows.push(statRow("Total shots", num(p.shots)));
    rows.push(statRow("Goals", withMins(p.goals, p.goalsAt)));
    rows.push(statRow("Assists", withMins(p.assists, p.assistsAt)));
  }
  rows.push(statRow("Yellow cards", withMins(p.yellow, p.yellowAt)));
  rows.push(statRow("Red cards", withMins(p.red, p.redAt)));
  return rows.join("");
}

function statRow(label, value) {
  return `<div class="ps-row"><span class="ps-label">${esc(label)}</span><span class="ps-value">${value}</span></div>`;
}

/** Open the individual player detail modal (image 1 / image 2). */
function openPlayerModal(entry, data, m) {
  const overlay = document.getElementById("player-modal");
  const body = document.getElementById("player-modal-body");
  if (!overlay || !body) return;
  const { p, team } = entry;
  const isGK = String(p.pos || "").toUpperCase() === "GK";

  const sc = m && m.result ? parseScore(m.result) : null;
  const scoreLine =
    sc && m
      ? `<div class="ps-score">
          <span>${data.home && data.home.flag ? esc(data.home.flag) + " " : ""}${esc(m.teamA)}</span>
          <strong>${sc.a} — ${sc.b}</strong>
          <span>${esc(m.teamB)}${data.away && data.away.flag ? " " + esc(data.away.flag) : ""}</span>
          <span class="ps-ft">Full-time</span>
        </div>`
      : "";

  const initials = esc(
    p.number != null ? String(p.number) : (p.name || "?").charAt(0),
  );
  const avatar = p.photo
    ? `<img class="ps-photo" src="${esc(p.photo)}" alt="">`
    : `<span class="ps-disc"${discStyle(team && team.color)}>${initials}</span>`;

  body.innerHTML = `
    <div class="ps-head">
      ${avatar}
      <div class="ps-id">
        <div class="ps-name">${esc(p.name || "")}</div>
        <div class="ps-team">${team && team.flag ? esc(team.flag) + " " : ""}${esc((team && team.name) || "")}${p.number != null ? ` #${esc(p.number)}` : ""}</div>
      </div>
    </div>
    ${scoreLine}
    <h3 class="md-section">Match stats</h3>
    <div class="ps-stats">${playerStatRows(p, isGK)}</div>`;

  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

function closePlayerModal() {
  const overlay = document.getElementById("player-modal");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  // Keep modal-open while the underlying match modal is still showing.
  const matchOpen = !document.getElementById("match-modal").hidden;
  if (!matchOpen) document.body.classList.remove("modal-open");
}

/**

 * Build a table whose columns can be sorted client-side. Sorting happens
 * entirely in the browser on the already-loaded `rows` (no server call). The
 * initial order is preserved until a header is clicked.
 */
function sortableTable(rows, columns, opts = {}) {
  const table = document.createElement("table");
  if (opts.className) table.className = opts.className;

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((col, i) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    th.classList.add("sortable");
    th.addEventListener("click", () => applySort(i));
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  table.append(tbody);

  const headers = headRow.querySelectorAll("th");
  let view = rows.slice();
  let sortIdx = null;
  let dir = 1; // 1 = ascending, -1 = descending

  function renderBody() {
    tbody.innerHTML = "";
    if (!view.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">${opts.emptyText || "No data."}</td></tr>`;
      return;
    }
    for (const r of view) {
      const tr = document.createElement("tr");
      const cls = opts.rowClass ? opts.rowClass(r) : "";
      if (cls) tr.className = cls;
      tr.innerHTML = columns.map((col) => `<td>${col.render(r)}</td>`).join("");
      tbody.append(tr);
    }
  }

  function applySort(i) {
    const col = columns[i];
    if (sortIdx === i) {
      dir = -dir;
    } else {
      sortIdx = i;
      dir = col.numeric ? -1 : 1; // numbers high→low first, text A→Z first
    }
    view = rows.slice().sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      const an = av == null;
      const bn = bv == null;
      if (an && bn) return 0;
      if (an) return 1; // nulls always last
      if (bn) return -1;
      const cmp = col.numeric ? av - bv : String(av).localeCompare(String(bv));
      return cmp * dir;
    });
    headers.forEach((th, idx) => {
      th.classList.toggle("sort-asc", idx === sortIdx && dir === 1);
      th.classList.toggle("sort-desc", idx === sortIdx && dir === -1);
    });
    renderBody();
  }

  renderBody();
  return table;
}

function rankMedal(rank) {
  return { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `#${rank || "-"}`;
}

/**
 * A standings table with a name search box, page-size control (50/100/200) and
 * prev/next pagination. Reuses the same column shape as sortableTable (each
 * column has { label, numeric?, value(r), render(r) }) and keeps clickable
 * header sorting. `opts.defaultSortIndex` sets the initial sort column.
 */
function paginatedStandingsTable(rows, columns, opts = {}) {
  const PAGE_SIZES = [50, 100, 200];
  const searchValue = opts.searchValue || (() => "");
  let query = "";
  let pageSize = PAGE_SIZES[0];
  let page = 1;
  let sortIdx =
    opts.defaultSortIndex != null && opts.defaultSortIndex >= 0
      ? opts.defaultSortIndex
      : null;
  let dir = -1; // initial numeric sort is high → low

  const wrap = document.createElement("div");
  wrap.className = "ps-table-wrap";

  // Controls: search + page size + result count.
  const controls = document.createElement("div");
  controls.className = "ps-controls";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "ps-search";
  search.placeholder = opts.searchPlaceholder || "Search…";
  const sizeLabel = document.createElement("label");
  sizeLabel.className = "ps-pagesize";
  sizeLabel.append(document.createTextNode("Per page "));
  const sizeSel = document.createElement("select");
  for (const n of PAGE_SIZES) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = String(n);
    sizeSel.append(o);
  }
  sizeLabel.append(sizeSel);
  const count = document.createElement("span");
  count.className = "ps-count";
  controls.append(search, sizeLabel, count);

  // Table.
  const table = document.createElement("table");
  if (opts.className) table.className = opts.className;
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((col, i) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    th.classList.add("sortable");
    th.addEventListener("click", () => applySort(i));
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);
  const headers = headRow.querySelectorAll("th");
  const tbody = document.createElement("tbody");
  table.append(tbody);

  // Pager.
  const pager = document.createElement("div");
  pager.className = "ps-pager";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "ps-page-btn";
  prev.textContent = "‹ Prev";
  const pageInfo = document.createElement("span");
  pageInfo.className = "ps-page-info";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "ps-page-btn";
  next.textContent = "Next ›";
  pager.append(prev, pageInfo, next);

  function currentRows() {
    let view = rows.slice();
    const q = query.trim().toLowerCase();
    if (q) {
      view = view.filter((r) =>
        String(searchValue(r)).toLowerCase().includes(q),
      );
    }
    if (sortIdx != null) {
      const col = columns[sortIdx];
      view.sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        const an = av == null;
        const bn = bv == null;
        if (an && bn) return 0;
        if (an) return 1; // nulls always last
        if (bn) return -1;
        const cmp = col.numeric
          ? av - bv
          : String(av).localeCompare(String(bv));
        return cmp * dir;
      });
    }
    return view;
  }

  function render() {
    const view = currentRows();
    const total = view.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) page = pages;
    const start = (page - 1) * pageSize;
    const slice = view.slice(start, start + pageSize);

    tbody.innerHTML = "";
    if (!slice.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">${opts.emptyText || "No data."}</td></tr>`;
    } else {
      for (const r of slice) {
        const tr = document.createElement("tr");
        const cls = opts.rowClass ? opts.rowClass(r) : "";
        if (cls) tr.className = cls;
        tr.innerHTML = columns
          .map((col) => `<td>${col.render(r)}</td>`)
          .join("");
        tbody.append(tr);
      }
    }

    headers.forEach((th, idx) => {
      th.classList.toggle("sort-asc", idx === sortIdx && dir === 1);
      th.classList.toggle("sort-desc", idx === sortIdx && dir === -1);
    });

    const from = total ? start + 1 : 0;
    const to = Math.min(start + pageSize, total);
    count.textContent = `Showing ${from}–${to} of ${total}`;
    pageInfo.textContent = `Page ${page} / ${pages}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  function applySort(i) {
    const col = columns[i];
    if (sortIdx === i) {
      dir = -dir;
    } else {
      sortIdx = i;
      dir = col.numeric ? -1 : 1; // numbers high→low first, text A→Z first
    }
    page = 1;
    render();
  }

  search.addEventListener("input", () => {
    query = search.value;
    page = 1;
    render();
  });
  sizeSel.addEventListener("change", () => {
    pageSize = Number(sizeSel.value) || PAGE_SIZES[0];
    page = 1;
    render();
  });
  prev.addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      render();
    }
  });
  next.addEventListener("click", () => {
    page += 1;
    render();
  });

  wrap.append(controls, table, pager);
  render();
  return wrap;
}

/* ---- Tournaments tab ---- */

function renderTournamentSummary(tournaments) {
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
function renderTournamentLeaders(t) {
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

function setupTournamentPicker(tournaments, defaultId) {
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
    statusPill.textContent = t.status;
    statusPill.className = `pill ${t.status === "active" ? "pill-active" : "pill-done"}`;
    renderTournamentLeaders(t);
    renderBlock("tn", t);
    renderStandings(standings, t);
    renderTeamAnalytics(t);
    renderPlayerStandings(t);
  };

  select.onchange = draw;
  draw();
}

function renderStandings(container, t) {
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
 * Win = 3 pts, Draw = 1 pt, Loss = 0 pt. */
function parseScore(value) {
  if (typeof value !== "string") return null;
  const m = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(value);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]) };
}

function computeLeagueTable(matchList) {
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

function renderTeamTable(container, t) {
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
function countResolvedGroupMatches(t) {
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
function renderGroupedStandings(container, t) {
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
const WC_BRACKET = {
  // Round columns, in top-to-bottom bracket order so the tree lines up.
  rounds: [
    {
      name: "Round of 32",
      matches: [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
    },
    { name: "Round of 16", matches: [89, 90, 93, 94, 91, 92, 95, 96] },
    { name: "Quarter-finals", matches: [97, 98, 99, 100] },
    { name: "Semi-finals", matches: [101, 102] },
    { name: "Final", matches: [104] },
  ],
  slots: {
    73: [
      { g: "A", pos: 2 },
      { g: "B", pos: 2 },
    ],
    74: [{ g: "E", pos: 1 }, { third: ["A", "B", "C", "D", "F"] }],
    75: [
      { g: "F", pos: 1 },
      { g: "C", pos: 2 },
    ],
    76: [
      { g: "C", pos: 1 },
      { g: "F", pos: 2 },
    ],
    77: [{ g: "I", pos: 1 }, { third: ["C", "D", "F", "G", "H"] }],
    78: [
      { g: "E", pos: 2 },
      { g: "I", pos: 2 },
    ],
    79: [{ g: "A", pos: 1 }, { third: ["C", "E", "F", "H", "I"] }],
    80: [{ g: "L", pos: 1 }, { third: ["E", "H", "I", "J", "K"] }],
    81: [{ g: "D", pos: 1 }, { third: ["B", "E", "F", "I", "J"] }],
    82: [{ g: "G", pos: 1 }, { third: ["A", "E", "H", "I", "J"] }],
    83: [
      { g: "K", pos: 2 },
      { g: "L", pos: 2 },
    ],
    84: [
      { g: "H", pos: 1 },
      { g: "J", pos: 2 },
    ],
    85: [{ g: "B", pos: 1 }, { third: ["E", "F", "G", "I", "J"] }],
    86: [
      { g: "J", pos: 1 },
      { g: "H", pos: 2 },
    ],
    87: [{ g: "K", pos: 1 }, { third: ["D", "E", "I", "J", "L"] }],
    88: [
      { g: "D", pos: 2 },
      { g: "G", pos: 2 },
    ],
    89: [{ win: 74 }, { win: 77 }],
    90: [{ win: 73 }, { win: 75 }],
    91: [{ win: 76 }, { win: 78 }],
    92: [{ win: 79 }, { win: 80 }],
    93: [{ win: 83 }, { win: 84 }],
    94: [{ win: 81 }, { win: 82 }],
    95: [{ win: 86 }, { win: 88 }],
    96: [{ win: 85 }, { win: 87 }],
    97: [{ win: 89 }, { win: 90 }],
    98: [{ win: 93 }, { win: 94 }],
    99: [{ win: 91 }, { win: 92 }],
    100: [{ win: 95 }, { win: 96 }],
    101: [{ win: 97 }, { win: 98 }],
    102: [{ win: 99 }, { win: 100 }],
    103: [{ lose: 101 }, { lose: 102 }],
    104: [{ win: 101 }, { win: 102 }],
  },
};

/**
 * Official 2026 FIFA World Cup knockout kick-off times by match number, stored
 * as UTC instants (source: FIFA match schedule). Shown as the scheduled
 * date/time until a match is actually added to the tournament, at which point
 * the prediction-closing time is used instead. All bracket times are rendered
 * in GMT+6 (Asia/Dhaka).
 */
const WC_SCHEDULE = {
  73: "2026-06-28T19:00:00Z",
  74: "2026-06-29T20:30:00Z",
  75: "2026-06-30T01:00:00Z",
  76: "2026-06-29T17:00:00Z",
  77: "2026-06-30T21:00:00Z",
  78: "2026-06-30T17:00:00Z",
  79: "2026-07-01T01:00:00Z",
  80: "2026-07-01T16:00:00Z",
  81: "2026-07-02T00:00:00Z",
  82: "2026-07-01T20:00:00Z",
  83: "2026-07-02T23:00:00Z",
  84: "2026-07-02T19:00:00Z",
  85: "2026-07-03T03:00:00Z",
  86: "2026-07-03T22:00:00Z",
  87: "2026-07-04T01:30:00Z",
  88: "2026-07-03T18:00:00Z",
  89: "2026-07-04T21:00:00Z",
  90: "2026-07-04T17:00:00Z",
  91: "2026-07-05T20:00:00Z",
  92: "2026-07-06T00:00:00Z",
  93: "2026-07-06T19:00:00Z",
  94: "2026-07-07T00:00:00Z",
  95: "2026-07-07T16:00:00Z",
  96: "2026-07-07T20:00:00Z",
  97: "2026-07-09T20:00:00Z",
  98: "2026-07-10T19:00:00Z",
  99: "2026-07-11T21:00:00Z",
  100: "2026-07-12T01:00:00Z",
  101: "2026-07-14T19:00:00Z",
  102: "2026-07-15T19:00:00Z",
  103: "2026-07-18T21:00:00Z",
  104: "2026-07-19T19:00:00Z",
};

/** Format an instant as a short Dhaka-time (GMT+6) date + time string. */
function fmtDhaka(value) {
  if (!value) return null;
  const d = new Date(typeof value === "string" ? value : Number(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Dhaka",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Human-readable description of how a bracket slot's team is determined. */
function slotDescription(slot) {
  if (!slot) return "To be determined";
  if (slot.g && slot.pos === 1) return `Winner of Group ${slot.g}`;
  if (slot.g && slot.pos === 2) return `Runner-up of Group ${slot.g}`;
  if (slot.third)
    return `Best 3rd-placed team (from Group ${slot.third.join("/")})`;
  if (slot.win) return `Winner of Match ${slot.win}`;
  if (slot.lose) return `Loser of Match ${slot.lose}`;
  return "To be determined";
}

/*
 * Lightweight, body-anchored tooltip used to explain the round-of-32 pairings.
 * Anchored to <body> with fixed positioning so it is never clipped by the
 * bracket's horizontally-clipped scroll container, and shown on hover, keyboard
 * focus and tap for full accessibility.
 */
let bracketTipEl = null;
function getBracketTip() {
  if (!bracketTipEl) {
    bracketTipEl = el("div", { className: "bx-tip", role: "tooltip" });
    bracketTipEl.setAttribute("aria-hidden", "true");
    document.body.append(bracketTipEl);
    window.addEventListener("scroll", hideBracketTip, true);
    window.addEventListener("resize", hideBracketTip);
  }
  return bracketTipEl;
}

function showBracketTip(anchor, text) {
  const tip = getBracketTip();
  tip.textContent = text;
  tip.classList.add("visible");
  tip.setAttribute("aria-hidden", "false");
  const a = anchor.getBoundingClientRect();
  const r = tip.getBoundingClientRect();
  let left = a.left + a.width / 2 - r.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
  let top = a.top - r.height - 8;
  if (top < 8) top = a.bottom + 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideBracketTip() {
  if (!bracketTipEl) return;
  bracketTipEl.classList.remove("visible");
  bracketTipEl.setAttribute("aria-hidden", "true");
}

function attachInfoTip(icon, text) {
  const show = () => showBracketTip(icon, text);
  icon.addEventListener("mouseenter", show);
  icon.addEventListener("focus", show);
  icon.addEventListener("mouseleave", hideBracketTip);
  icon.addEventListener("blur", hideBracketTip);
  icon.addEventListener("click", (e) => {
    // Don't trigger the parent match's click (modal); show for touch users.
    e.stopPropagation();
    e.preventDefault();
    show();
  });
}

/** Index a tournament's matches by their (per-tournament) match number. */
function matchesByNumber(t) {
  const map = new Map();
  for (const m of t.matchList || []) {
    if (m.matchNumber != null) map.set(m.matchNumber, m);
  }
  return map;
}

/**
 * Winner/loser of a resolved match, or null when undecided. A level full-time
 * score is decided by the tie-breaker (penalty shootout) for knockout matches;
 * if there is no tie-breaker recorded, a drawn result yields null and the
 * bracket keeps the placeholder.
 */
function decisiveTeam(m, which) {
  if (!m || m.type !== "football" || m.status !== "resolved" || !m.result) {
    return null;
  }
  const sc = parseScore(m.result);
  if (!sc) return null;
  let winner, loser;
  if (sc.a === sc.b) {
    // Level after regular/extra time: only a knockout tie-breaker can decide it.
    if (!m.isKnockout || !m.tiebreakerResult) return null;
    const tb = parseScore(m.tiebreakerResult);
    if (!tb || tb.a === tb.b) return null;
    winner = tb.a > tb.b ? m.teamA : m.teamB;
    loser = tb.a > tb.b ? m.teamB : m.teamA;
  } else {
    winner = sc.a > sc.b ? m.teamA : m.teamB;
    loser = sc.a > sc.b ? m.teamB : m.teamA;
  }
  return which === "win" ? winner : loser;
}

/**
 * The team finishing in `pos` (1 = winner, 2 = runner-up) of a group, but only
 * once every group game is resolved so the standings are final; otherwise null.
 */
function groupPositionTeam(t, group, pos) {
  const teamGroups = t.teamGroups || {};
  const inGroup = (name) =>
    teamGroups[String(name).trim().toLowerCase()] === group;
  const teamsInGroup = Object.values(teamGroups).filter(
    (g) => g === group,
  ).length;
  if (!teamsInGroup) return null;
  const expectedGames = (teamsInGroup * (teamsInGroup - 1)) / 2;
  const groupMatches = (t.matchList || []).filter(
    (m) => inGroup(m.teamA) && inGroup(m.teamB),
  );
  const resolved = groupMatches.filter(
    (m) => m.type === "football" && m.status === "resolved" && m.result,
  );
  const rows = computeLeagueTable(groupMatches);
  if (!rows[pos - 1]) return null;
  // `final` once every group game is played; otherwise it's a current-standings
  // projection that can still change.
  return { team: rows[pos - 1].team, final: resolved.length >= expectedGames };
}

/**
 * Whether every group has played all of its games, so the final standings
 * (and therefore the best third-placed ranking) are settled.
 */
function allGroupsComplete(t) {
  const teamGroups = t.teamGroups || {};
  for (const g of t.groups || []) {
    const teamsInGroup = Object.values(teamGroups).filter(
      (x) => x === g,
    ).length;
    if (!teamsInGroup) return false;
    const expected = (teamsInGroup * (teamsInGroup - 1)) / 2;
    const inGroup = (n) => teamGroups[String(n).trim().toLowerCase()] === g;
    const groupMatches = (t.matchList || []).filter(
      (m) => inGroup(m.teamA) && inGroup(m.teamB),
    );
    const resolved = groupMatches.filter(
      (m) => m.type === "football" && m.status === "resolved" && m.result,
    );
    if (resolved.length < expected) return false;
  }
  return true;
}

/**
 * Assign the eight best third-placed teams to their round-of-32 matches.
 * Each of those matches accepts a third-placed team from one of a fixed set of
 * groups (the `third` list on its slot); a bipartite matching pairs the
 * qualifying groups to those matches so every fillable slot shows a team.
 * Works from current standings (each entry flagged `projected` until all groups
 * finish), returning a Map of matchNumber -> { team, projected }.
 */
function assignThirdPlaces(t) {
  const result = new Map();
  const thirds = computeThirdPlaced(t);
  if (!thirds.length) return result;
  const projected = !allGroupsComplete(t);
  const top = thirds.slice(0, 8);
  const groupToTeam = new Map(top.map((r) => [r.group, r.team]));
  const qualGroups = new Set(top.map((r) => r.group));

  // Matches whose slot draws from a best third-placed team, with eligible groups.
  const slotDefs = [];
  for (const [numStr, slots] of Object.entries(WC_BRACKET.slots)) {
    const ts = slots.find((s) => s.third);
    if (ts) slotDefs.push({ num: Number(numStr), eligible: ts.third });
  }
  const slotByNum = new Map(slotDefs.map((s) => [s.num, s]));
  const groupToSlot = new Map(); // group letter -> match number
  const augment = (slot, visited) => {
    for (const g of slot.eligible) {
      if (!qualGroups.has(g) || visited.has(g)) continue;
      visited.add(g);
      const occupant = groupToSlot.get(g);
      if (occupant === undefined || augment(slotByNum.get(occupant), visited)) {
        groupToSlot.set(g, slot.num);
        return true;
      }
    }
    return false;
  };
  for (const slot of slotDefs) augment(slot, new Set());

  for (const [g, num] of groupToSlot) {
    result.set(num, { team: groupToTeam.get(g), group: g, projected });
  }
  return result;
}

/**
 * Resolve one bracket slot to { text, real, projected }. `real` marks an actual
 * team (vs. a placeholder like "Winner Group A"); `projected` marks a team taken
 * from current, not-yet-final standings.
 */
function resolveSlot(t, slot, byNumber, thirdInfo) {
  if (slot.g) {
    const gp = groupPositionTeam(t, slot.g, slot.pos);
    if (gp) return { text: gp.team, real: true, projected: !gp.final };
    const label = slot.pos === 1 ? "Winner Group " : "Runner-up Group ";
    return { text: label + slot.g, real: false };
  }
  if (slot.third) {
    if (thirdInfo) {
      return {
        text: thirdInfo.team,
        real: true,
        projected: thirdInfo.projected,
      };
    }
    return { text: "3rd " + slot.third.join("/"), real: false };
  }
  if (slot.win != null || slot.lose != null) {
    const ref = slot.win != null ? slot.win : slot.lose;
    const which = slot.win != null ? "win" : "lose";
    const team = decisiveTeam(byNumber.get(ref), which);
    if (team) return { text: team, real: true };
    const label = which === "win" ? "Winner Match " : "Loser Match ";
    return { text: label + ref, real: false };
  }
  return { text: "TBD", real: false };
}

/**
 * Resolve both teams of a bracket match: real names + scoreline when the match
 * exists in the tournament data, otherwise placeholders from the template.
 */
function resolveBracketMatch(t, num, byNumber, thirdByMatch) {
  const dbMatch = byNumber.get(num);
  if (dbMatch) {
    const sc = dbMatch.result ? parseScore(dbMatch.result) : null;
    const tb =
      dbMatch.isKnockout && dbMatch.tiebreakerResult
        ? parseScore(dbMatch.tiebreakerResult)
        : null;
    const decidedReg = sc && sc.a !== sc.b;
    const decidedTb = sc && sc.a === sc.b && tb && tb.a !== tb.b;
    return {
      match: dbMatch,
      a: {
        text: dbMatch.teamA,
        real: true,
        score: sc ? sc.a : null,
        tbScore: decidedTb ? tb.a : null,
        winner: decidedReg ? sc.a > sc.b : decidedTb ? tb.a > tb.b : false,
      },
      b: {
        text: dbMatch.teamB,
        real: true,
        score: sc ? sc.b : null,
        tbScore: decidedTb ? tb.b : null,
        winner: decidedReg ? sc.b > sc.a : decidedTb ? tb.b > tb.a : false,
      },
    };
  }
  const slots = WC_BRACKET.slots[num] || [{}, {}];
  const thirdTeam = thirdByMatch ? thirdByMatch.get(num) : null;
  return {
    match: null,
    a: {
      ...resolveSlot(t, slots[0], byNumber, thirdTeam),
      score: null,
      winner: false,
    },
    b: {
      ...resolveSlot(t, slots[1], byNumber, thirdTeam),
      score: null,
      winner: false,
    },
  };
}

/** Build one bracket match cell. */
function buildBracketMatch(t, num, byNumber, thirdByMatch) {
  const info = resolveBracketMatch(t, num, byNumber, thirdByMatch);
  const wrap = el("div", { className: "bx-match" });

  // The matchup is "confirmed" once an actual match exists, or once both sides
  // are real teams drawn from final (not projected) standings. Everything else
  // is still pending. Every card is clickable: confirmed cards open the match
  // detail modal; pending cards open a projection modal explaining the path.
  const bothReal = info.a.real && info.b.real;
  const anyProjected = info.a.projected || info.b.projected;
  const confirmed = !!info.match || (bothReal && !anyProjected);

  const box = el("button", { className: "bx-box clickable" });
  box.type = "button";
  box.classList.add(confirmed ? "bx-box--confirmed" : "bx-box--pending");
  box.addEventListener("click", () => {
    if (info.match) openMatchModal(info.match);
    else openBracketProjectionModal(t, num, info);
  });

  const teamRow = (side) => {
    const cls = ["bx-team"];
    if (!side.real) cls.push("placeholder");
    if (side.winner) cls.push("winner");
    if (side.projected) cls.push("projected");
    const title = side.projected
      ? ' title="Projected from current standings — not yet final"'
      : "";
    const score =
      side.score != null
        ? `<span class="bx-score">${side.score}${
            side.tbScore != null
              ? `<span class="bx-pens" title="Penalty shootout">(${side.tbScore})</span>`
              : ""
          }</span>`
        : `<span class="bx-score"></span>`;
    return `<div class="${cls.join(" ")}"${title}><span class="bx-name">${esc(
      side.text,
    )}</span>${score}</div>`;
  };

  // Use the prediction-closing time once the match exists; otherwise the
  // official scheduled kick-off. Both are rendered in GMT+6 (Dhaka) time.
  const dateText = info.match
    ? fmtDhaka(info.match.endTime)
    : fmtDhaka(WC_SCHEDULE[num]);
  const dateTitle = info.match
    ? "Predictions close (GMT+6 Dhaka)"
    : "Scheduled kick-off (GMT+6 Dhaka)";
  const dateLine = dateText
    ? `<div class="bx-date" title="${dateTitle}">${esc(dateText)}</div>`
    : "";

  // Round of 32 only: a visible info badge reveals how each side's team is
  // determined (group winners / runners-up / best third-placed sides), plus the
  // origin of the assigned third-placed team and whether it is final.
  let r32Text = "";
  if (num >= 73 && num <= 88) {
    const slots = WC_BRACKET.slots[num] || [];
    const thirdInfo = thirdByMatch ? thirdByMatch.get(num) : null;
    const lines = [`Match ${num}`];
    for (const slot of slots) {
      let line = `• ${slotDescription(slot)}`;
      if (slot.third && thirdInfo && thirdInfo.team) {
        const tag = thirdInfo.projected ? "projected" : "confirmed";
        line += `\n    ↳ currently ${thirdInfo.team} — 3rd place of Group ${thirdInfo.group} (${tag})`;
      }
      lines.push(line);
    }
    const anyProjected = info.a.projected || info.b.projected;
    const bothReal = info.a.real && info.b.real;
    if (anyProjected) {
      lines.push("Projected from current standings — not final yet.");
    } else if (bothReal) {
      lines.push("Matchup confirmed.");
    } else {
      lines.push("Awaiting group-stage results.");
    }
    r32Text = lines.join("\n");
  }
  const infoBadge = r32Text
    ? `<span class="bx-info" tabindex="0" role="button" aria-label="${esc(
        r32Text,
      )}">i</span>`
    : "";

  box.innerHTML = `
    <div class="bx-num">Match ${num}${infoBadge}</div>
    ${dateLine}
    ${teamRow(info.a)}
    ${teamRow(info.b)}`;

  if (r32Text) {
    const icon = box.querySelector(".bx-info");
    if (icon) attachInfoTip(icon, r32Text);
  }

  wrap.append(box);
  return wrap;
}

/**
 * Render the World Cup knockout stage as a fixtures bracket. Real teams are
 * pulled from the tournament data by match number; missing matches fall back to
 * descriptive placeholders (group positions for the round of 32, otherwise
 * "Winner/Loser Match N"). The match-for-third-place is shown beneath.
 */
function renderKnockoutBracket(container, t) {
  const byNumber = matchesByNumber(t);
  const thirdByMatch = assignThirdPlaces(t);

  if (!allGroupsComplete(t)) {
    container.append(
      el("div", {
        className: "bracket-note",
        textContent:
          "Dotted teams are projected from current group standings and may change as group matches are resolved.",
      }),
    );
  }

  const bracket = el("div", { className: "bracket bracket-2sided" });
  const splitRounds = WC_BRACKET.rounds.slice(0, -1); // Round of 32 … Semi-finals
  const finalRound = WC_BRACKET.rounds[WC_BRACKET.rounds.length - 1];

  const buildCol = (round, nums, sideClass) => {
    const col = el("div", { className: "bracket-col " + sideClass });
    col.append(
      el("div", { className: "bracket-col-title", textContent: round.name }),
    );
    const roundEl = el("div", { className: "bracket-round" });
    for (const num of nums) {
      roundEl.append(buildBracketMatch(t, num, byNumber, thirdByMatch));
    }
    col.append(roundEl);
    return col;
  };

  // Left half: the first half of each round's matches, outer → inner.
  splitRounds.forEach((round, i) => {
    const half = round.matches.slice(0, round.matches.length / 2);
    let cls = "side-left depth-" + (splitRounds.length - i); // R32=4 … SF=1
    if (i === 0) cls += " side-outer";
    if (i === splitRounds.length - 1) cls += " side-inner";
    bracket.append(buildCol(round, half, cls));
  });

  // Final sits in the centre.
  bracket.append(
    buildCol(finalRound, finalRound.matches, "bracket-final depth-0"),
  );

  // Right half mirrors the left: rounds reversed (inner → outer), 2nd half.
  [...splitRounds].reverse().forEach((round, i, arr) => {
    const half = round.matches.slice(round.matches.length / 2);
    let cls = "side-right depth-" + (i + 1); // SF=1 … R32=4
    if (i === 0) cls += " side-inner";
    if (i === arr.length - 1) cls += " side-outer";
    bracket.append(buildCol(round, half, cls));
  });

  const scroller = el("div", { className: "bracket-scroll" });
  scroller.append(bracket);
  container.append(scroller);

  // Match for third place sits outside the main tree.
  const third = el("div", { className: "bracket-third" });
  third.append(
    el("div", {
      className: "bracket-col-title",
      textContent: "Match for third place",
    }),
  );
  third.append(buildBracketMatch(t, 103, byNumber, thirdByMatch));
  container.append(third);
}

/** Render one League Table per group for a grouped (World Cup) tournament. */
function renderGroupedLeagueTables(container, t) {
  const teamGroups = t.teamGroups || {};
  const inGroup = (name, g) =>
    teamGroups[String(name).trim().toLowerCase()] === g;

  for (const g of t.groups) {
    // Only count matches played strictly within this group.
    const groupMatches = (t.matchList || []).filter(
      (m) => inGroup(m.teamA, g) && inGroup(m.teamB, g),
    );
    const rows = computeLeagueTable(groupMatches);

    const section = el("div", { className: "group-table" });
    const head = el("h3", { className: "group-table-head" });
    head.innerHTML = `Group ${esc(g)} <span class="col-count">${rows.length}</span>`;
    section.append(head);
    if (rows.length) {
      section.append(buildLeagueTableEl(rows));
    } else {
      section.append(
        el("div", {
          className: "empty small",
          textContent: "No resolved football matches yet.",
        }),
      );
    }
    container.append(section);
  }
}

/**
 * Collect and rank every group's 3rd-placed team for a grouped tournament.
 * Sort priority: 1) points, 2) goal difference (then goals for, then name).
 * Returns [] when the tournament isn't grouped.
 */
function computeThirdPlaced(t) {
  if (
    !(t.grouped && Array.isArray(t.groups) && t.groups.length && t.teamGroups)
  ) {
    return [];
  }
  const teamGroups = t.teamGroups || {};
  const inGroup = (name, g) =>
    teamGroups[String(name).trim().toLowerCase()] === g;

  const thirdPlaced = [];
  for (const g of t.groups) {
    const groupMatches = (t.matchList || []).filter(
      (m) => inGroup(m.teamA, g) && inGroup(m.teamB, g),
    );
    const rows = computeLeagueTable(groupMatches);
    // Top two of every group advance automatically; capture the 3rd-placed team.
    if (rows.length >= 3) {
      thirdPlaced.push({ ...rows[2], group: g });
    }
  }
  thirdPlaced.sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team),
  );
  thirdPlaced.forEach((r, i) => (r.rank = i + 1));
  return thirdPlaced;
}

/**
 * Render the Best Third-Placed Teams ranking into its top-row card.
 * The card is hidden for tournaments that aren't grouped (non-World Cup).
 * The top 8 qualify for the next round (World Cup 2026 format).
 */
function renderThirdPlacedCard(t) {
  const card = document.getElementById("tn-third-card");
  const container = document.getElementById("tn-third-table");
  if (!card || !container) return;

  const thirdPlaced = computeThirdPlaced(t);
  if (!thirdPlaced.length) {
    card.style.display = "none";
    container.innerHTML = "";
    return;
  }
  card.style.display = "";
  container.innerHTML = "";
  container.append(buildThirdPlacedTableEl(thirdPlaced));
}

/** Build the sortable Best Third-Placed Teams table element. */
function buildThirdPlacedTableEl(thirdPlaced) {
  const QUALIFY = 8;
  const fmtGd = (n) => (n > 0 ? `+${n}` : String(n));
  const columns = [
    {
      label: "Rank",
      numeric: true,
      value: (r) => r.rank,
      render: (r) => r.rank,
    },
    {
      label: "Group",
      value: (r) => r.group,
      render: (r) => esc(r.group),
    },
    { label: "Team", value: (r) => r.team, render: (r) => esc(r.team) },
    {
      label: "P",
      numeric: true,
      value: (r) => r.played,
      render: (r) => r.played,
    },
    { label: "W", numeric: true, value: (r) => r.won, render: (r) => r.won },
    {
      label: "D",
      numeric: true,
      value: (r) => r.drawn,
      render: (r) => r.drawn,
    },
    { label: "L", numeric: true, value: (r) => r.lost, render: (r) => r.lost },
    { label: "GF", numeric: true, value: (r) => r.gf, render: (r) => r.gf },
    { label: "GA", numeric: true, value: (r) => r.ga, render: (r) => r.ga },
    {
      label: "GD",
      numeric: true,
      value: (r) => r.gd,
      render: (r) => fmtGd(r.gd),
    },
    {
      label: "Pts",
      numeric: true,
      value: (r) => r.points,
      render: (r) => `<strong>${r.points}</strong>`,
    },
  ];
  return sortableTable(thirdPlaced, columns, {
    className: "data-table league-table",
    rowClass: (r) => (r.rank <= QUALIFY ? "top-rank" : ""),
    emptyText: "No third-placed teams yet.",
  });
}

/** Build a sortable League Table element from precomputed rows. */
function buildLeagueTableEl(rows) {
  const fmtGd = (n) => (n > 0 ? `+${n}` : String(n));
  const columns = [
    { label: "#", numeric: true, value: (r) => r.pos, render: (r) => r.pos },
    { label: "Team", value: (r) => r.team, render: (r) => esc(r.team) },
    {
      label: "P",
      numeric: true,
      value: (r) => r.played,
      render: (r) => r.played,
    },
    { label: "W", numeric: true, value: (r) => r.won, render: (r) => r.won },
    {
      label: "D",
      numeric: true,
      value: (r) => r.drawn,
      render: (r) => r.drawn,
    },
    { label: "L", numeric: true, value: (r) => r.lost, render: (r) => r.lost },
    { label: "GF", numeric: true, value: (r) => r.gf, render: (r) => r.gf },
    { label: "GA", numeric: true, value: (r) => r.ga, render: (r) => r.ga },
    {
      label: "GD",
      numeric: true,
      value: (r) => r.gd,
      render: (r) => fmtGd(r.gd),
    },
    {
      label: "Pts",
      numeric: true,
      value: (r) => r.points,
      render: (r) => `<strong>${r.points}</strong>`,
    },
  ];
  return sortableTable(rows, columns, {
    className: "data-table league-table",
    rowClass: (r) => (r.pos <= 3 ? "top-rank" : ""),
    emptyText: "No resolved football matches yet.",
  });
}

/** Resolved football matches (with a parseable X-Y score) for a tournament. */
function resolvedFootballMatches(matchList) {
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
function renderTeamAnalytics(t) {
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

function renderTeamKpis(rows, games) {
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

function renderTeamBars(id, rows, valueFn, label, highFirst) {
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

function renderTeamHighlights(games) {
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
function countEvent(count, mins) {
  const fromMins = minutesList(mins).length;
  if (fromMins) return fromMins;
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Total goals scored by one team (sum of its players' goals). */
function teamGoals(team) {
  if (!team) return 0;
  const all = [...(team.starters || []), ...(team.bench || [])];
  return all.reduce((s, p) => s + (p ? countEvent(p.goals, p.goalsAt) : 0), 0);
}

/** Roll up player profiles across a map of {matchId: lineupData}. */
function aggregatePlayers(lineups, matchTeams) {
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
async function renderPlayerStandings(t) {
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
        `${r.number != null ? `<span class="ps-num">${esc(String(r.number))}</span> ` : ""}${esc(r.name)}`,
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
  tableWrap.append(
    paginatedStandingsTable(ranked, columns, {
      className: "data-table standings-table",
      rowClass: (r) => (r.rank <= 3 ? "top-rank" : ""),
      emptyText: "No player data.",
      searchValue: (r) => r.name,
      searchPlaceholder: "Search player…",
      defaultSortIndex: columns.findIndex((c) => c.label === "Avg"),
    }),
  );
}

/* ---- Tab switching ---- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${target}`);
    });
  });
});

/* ---- Sub-tab switching (inside the Tournaments tab) ---- */
document.querySelectorAll(".subtab").forEach((subtab) => {
  subtab.addEventListener("click", () => {
    const target = subtab.dataset.subtab;
    document.querySelectorAll(".subtab").forEach((s) => {
      const on = s === subtab;
      s.classList.toggle("active", on);
      s.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".subtab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tn-sub-${target}`);
    });
  });
});

/* ---- Match detail modal wiring ---- */
document
  .getElementById("match-modal-close")
  .addEventListener("click", closeMatchModal);
document.getElementById("match-modal").addEventListener("click", (e) => {
  // Close when clicking the backdrop (outside the dialog panel).
  if (e.target.id === "match-modal") closeMatchModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // The player modal sits on top of the match modal — close it first.
  const playerOverlay = document.getElementById("player-modal");
  if (playerOverlay && !playerOverlay.hidden) {
    closePlayerModal();
    return;
  }
  closeMatchModal();
});

/* ---- Player detail modal wiring ---- */
document
  .getElementById("player-modal-close")
  .addEventListener("click", closePlayerModal);
document.getElementById("player-modal").addEventListener("click", (e) => {
  if (e.target.id === "player-modal") closePlayerModal();
});

document.getElementById("refresh").addEventListener("click", load);

/* ---- World Cup trivia ticker (rotates every 15s) ---- */
let WC_TRIVIA = [];

let triviaTimer = null;
let triviaOrder = [];
let triviaIdx = 0;

function shuffledTrivia() {
  const a = WC_TRIVIA.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showNextTrivia() {
  const node = document.getElementById("trivia-text");
  if (!node) return;
  if (triviaIdx >= triviaOrder.length) {
    triviaOrder = shuffledTrivia();
    triviaIdx = 0;
  }
  const text = triviaOrder[triviaIdx++];
  node.classList.remove("show");
  // Allow the fade-out to start, then swap text and fade back in.
  window.setTimeout(() => {
    node.textContent = text;
    node.classList.add("show");
  }, 250);
}

function startTrivia() {
  const node = document.getElementById("trivia-text");
  if (!node) return;
  fetch("trivia.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      WC_TRIVIA = Array.isArray(data?.trivia) ? data.trivia : [];
      if (!WC_TRIVIA.length) {
        document.getElementById("trivia")?.setAttribute("hidden", "");
        return;
      }
      triviaOrder = shuffledTrivia();
      triviaIdx = 0;
      showNextTrivia();
      if (triviaTimer) window.clearInterval(triviaTimer);
      triviaTimer = window.setInterval(showNextTrivia, 15000);
    })
    .catch(() => {
      document.getElementById("trivia")?.setAttribute("hidden", "");
    });
}

/* ---- "How points work" scoring modal ---- */
let scoringConfig = null;

function fmtPts(n) {
  return Number(n) === 1 ? "1 pt" : `${n} pts`;
}

function buildScoringHTML() {
  const s = scoringConfig || {
    football: {
      exact: 10,
      near: 2.5,
      outcome: 5,
      tiebreakerWinner: 5,
      tiebreakerExact: 5,
    },
    cricket: { correct: 10 },
  };
  const f = s.football || {};
  const c = s.cricket || {};
  const maxRegular = (f.outcome || 0) + (f.exact || 0);
  const maxKnockout =
    maxRegular + (f.tiebreakerWinner || 0) + (f.tiebreakerExact || 0);

  return `
    <div class="md-head">
      <div class="md-title">🎯 How points are scored</div>
      <div class="md-sub">
        <span class="md-result muted">Rewards stack — you can earn several bonuses on one prediction.</span>
      </div>
    </div>

    <h3 class="md-section">⚽ Football — regular time</h3>
    <p class="scoring-note">Your <strong>regular-time</strong> score is always graded this way, even for knockout matches that later go to a tie-breaker. The rewards below stack together.</p>
    <table class="data-table scoring-table">
      <thead><tr><th>What you got right</th><th>Reward</th></tr></thead>
      <tbody>
        <tr><td>Correct winner or draw <span class="hint">right result, wrong score</span></td><td class="pts">+${fmtPts(f.outcome)}</td></tr>
        <tr><td>Exact scoreline <span class="hint">added on top of the outcome reward</span></td><td class="pts">+${fmtPts(f.exact)}</td></tr>
        <tr><td>Near miss <span class="hint">total goal difference from the result is exactly 1</span></td><td class="pts">+${fmtPts(f.near)}</td></tr>
        <tr><td>Wrong outcome and not close</td><td class="pts muted">0 pts</td></tr>
      </tbody>
    </table>
    <p class="scoring-note">Best case in regular time: correct outcome <em>and</em> exact score = <strong>${fmtPts(maxRegular)}</strong>. The "near miss" bonus only applies when you didn't hit the exact score.</p>

    <h3 class="md-section">🥅 Knockout tie-breakers <span class="hint">football only</span></h3>
    <p class="scoring-note">Knockout matches can't end in a draw. When a knockout match is decided by a <strong>tie-breaker</strong> (penalty shootout) and you predicted one, these <strong>bonus</strong> points stack on top of your regular-time score. If the match is settled in regular/extra time, the tie-breaker is ignored — no bonus and no penalty.</p>
    <table class="data-table scoring-table">
      <thead><tr><th>Tie-breaker prediction</th><th>Bonus</th></tr></thead>
      <tbody>
        <tr><td>Correct tie-breaker winner</td><td class="pts">+${fmtPts(f.tiebreakerWinner)}</td></tr>
        <tr><td>Exact tie-breaker score <span class="hint">added on top of the winner bonus</span></td><td class="pts">+${fmtPts(f.tiebreakerExact)}</td></tr>
      </tbody>
    </table>
    <p class="scoring-note">Maximum on a knockout match that goes to penalties: <strong>${fmtPts(maxKnockout)}</strong> (perfect regular-time score + correct &amp; exact tie-breaker).</p>

    <h3 class="md-section">🏏 Cricket</h3>
    <table class="data-table scoring-table">
      <thead><tr><th>Prediction</th><th>Reward</th></tr></thead>
      <tbody>
        <tr><td>Correct winning team</td><td class="pts">+${fmtPts(c.correct)}</td></tr>
        <tr><td>Wrong team</td><td class="pts muted">0 pts</td></tr>
      </tbody>
    </table>
    <p class="scoring-note">Cricket is winner-only — no score prediction, no draws, and no tie-breakers.</p>

    <h3 class="md-section">🧮 Worked examples</h3>
    <ul class="scoring-examples">
      <li><strong>Result 2–1, you said 2–1</strong> → correct outcome (+${f.outcome}) and exact score (+${f.exact}) = <strong>${fmtPts(maxRegular)}</strong>.</li>
      <li><strong>Result 2–1, you said 3–1</strong> → correct outcome (+${f.outcome}) and goal diff = 1 (+${f.near}) = <strong>${fmtPts((f.outcome || 0) + (f.near || 0))}</strong>.</li>
      <li><strong>Result 2–1, you said 1–2</strong> → wrong outcome, goal diff = 2 = <strong>0 pts</strong>.</li>
      <li><strong>Knockout 1–1 (pens 4–3), you said 1–1 with tie-breaker 4–3</strong> → regular exact (+${maxRegular}) + correct TB winner (+${f.tiebreakerWinner}) + exact TB (+${f.tiebreakerExact}) = <strong>${fmtPts(maxKnockout)}</strong>.</li>
      <li><strong>Knockout settled 2–0 in regular time</strong> → only your regular-time score counts; your tie-breaker pick is ignored.</li>
    </ul>`;
}

function openScoringModal() {
  const overlay = document.getElementById("scoring-modal");
  const body = document.getElementById("scoring-modal-body");
  if (!overlay || !body) return;
  body.innerHTML = buildScoringHTML();
  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

function closeScoringModal() {
  const overlay = document.getElementById("scoring-modal");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if (document.getElementById("match-modal").hidden) {
    document.body.classList.remove("modal-open");
  }
}

document
  .getElementById("scoring-help")
  .addEventListener("click", openScoringModal);
document
  .getElementById("scoring-modal-close")
  .addEventListener("click", closeScoringModal);
document.getElementById("scoring-modal").addEventListener("click", (e) => {
  if (e.target.id === "scoring-modal") closeScoringModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeScoringModal();
});

startTrivia();
load();
