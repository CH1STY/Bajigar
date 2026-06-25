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

function barChart(id, labels, values, label, colorFn) {
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
        ${m.result ? `<span class="mi-result">${esc(m.result)}</span>` : ""}
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
      <span class="mi-state state-${esc(m.state)}">${esc(MATCH_STATE_LABEL[m.state] || m.state)}</span>
      ${
        m.result
          ? `<span class="md-result">Result: <strong>${esc(m.result)}</strong></span>`
          : `<span class="md-result muted">No result yet</span>`
      }
    </div>
    ${
      opens || closes
        ? `<div class="md-times">${opens ? `Opens ${esc(opens)}` : ""}${opens && closes ? " · " : ""}${closes ? `Closes ${esc(closes)}` : ""}</div>`
        : ""
    }`;
  container.append(head);

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
  const rows = computeLeagueTable(t.matchList);
  if (!rows.length) {
    container.innerHTML =
      '<div class="empty">No resolved football matches yet.</div>';
    return;
  }
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
  container.append(
    sortableTable(rows, columns, {
      className: "data-table league-table",
      rowClass: (r) => (r.pos <= 3 ? "top-rank" : ""),
      emptyText: "No resolved football matches yet.",
    }),
  );
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
  if (e.key === "Escape") closeMatchModal();
});

document.getElementById("refresh").addEventListener("click", load);
load();
