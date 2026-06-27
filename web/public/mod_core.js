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

/** HTML template for one analytics block, with element IDs namespaced by prefix. */
