import { esc, parseScore } from "./mod_core.js";

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
export async function loadLineup(m, host, onLoaded) {
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
export function ratingClass(r) {
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
export function textOn(bg) {
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
export function discStyle(color) {
  if (!color) return "";
  const t = textOn(color);
  return ` style="background:${esc(color)}${t ? `;color:${t}` : ""}"`;
}

/** Parse a formation string ("4-3-3") into outfield row counts. */
export function parseFormation(f) {
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
export function lineupPositions(team, side) {
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
export function minutesList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return arr.map((x) => String(x).trim()).filter((x) => x !== "");
}

/** Small event-icon cluster for a player (goals, assists, cards) with minutes. */
export function playerEventIcons(p) {
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
export function playerMarker(node, color, pid, isMotm) {
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
export function benchColumn(team, idOf) {
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
export function teamStrip(team, pos) {
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
export function resolveMotm(data) {
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
export function motmBanner(motm) {
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
export function renderLineup(host, data, m) {
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
export const STAT_LOWER_BETTER = new Set([
  "fouls",
  "yellow",
  "red",
  "offsides",
]);

/** The team-stats comparison block (image-3 style), if data is present. */
export function teamStatsSection(data, home, away) {
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
        ? ` style="background:${esc(homeColor)};color:${textOn(homeColor) || "#fff"}"`
        : "";
      const aPill = aWin
        ? ` style="background:${esc(awayColor)};color:${textOn(awayColor) || "#fff"}"`
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
export function playerStatRows(p, isGK) {
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

export function statRow(label, value) {
  return `<div class="ps-row"><span class="ps-label">${esc(label)}</span><span class="ps-value">${value}</span></div>`;
}

/** Open the individual player detail modal (image 1 / image 2). */
export function openPlayerModal(entry, data, m) {
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

export function closePlayerModal() {
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
