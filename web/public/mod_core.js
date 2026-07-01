/* Front-end: fetch analytics and render charts + tables.
 * The Overview tab and each Tournament render the SAME analytics "block"
 * (KPIs, charts, spotlights, players) via renderBlock(prefix, block). */

export const PALETTE = [
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

export const charts = {};

Chart.defaults.color = "#93a0b5";
Chart.defaults.borderColor = "#2a3242";
Chart.defaults.font.family = "Segoe UI, Roboto, sans-serif";

export function destroy(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

export function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

/** Parse an "X-Y" score string into { a, b } numbers (or null). */
export function parseScore(v) {
  const m = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(String(v || ""));
  return m ? { a: +m[1], b: +m[2] } : null;
}

/* ---- API + skeleton helpers (per-section lazy loading) ------------------- */

/** Fetch JSON from an API path, throwing on a non-2xx response. */
export async function apiGet(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

/**
 * Scope query suffix for a block: "" for the global overview or "?t=<id>" for a
 * single tournament. Used to point each section endpoint at the right data set.
 * @param {number|null} scope
 */
export function scopeQuery(scope) {
  return scope == null ? "" : `?t=${encodeURIComponent(scope)}`;
}

/**
 * Fill a container with shimmering skeleton placeholders while its real data
 * loads. `opts.count` sets how many bars, `opts.className` their shape class.
 * @param {string|HTMLElement} target
 * @param {{count?: number, className?: string}} [opts]
 */
export function skeletonFill(target, opts = {}) {
  const node =
    typeof target === "string" ? document.getElementById(target) : target;
  if (!node) return;
  const count = opts.count || 3;
  const cls = opts.className || "sk-line";
  node.innerHTML = Array.from(
    { length: count },
    () => `<div class="skeleton ${cls}"></div>`,
  ).join("");
}

/** HTML template for one analytics block, with element IDs namespaced by prefix. */
