export function sortableTable(rows, columns, opts = {}) {
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

export function rankMedal(rank) {
  return { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `#${rank || "-"}`;
}

/**
 * A standings table with a name search box, page-size control (50/100/200) and
 * prev/next pagination. Reuses the same column shape as sortableTable (each
 * column has { label, numeric?, value(r), render(r) }) and keeps clickable
 * header sorting. `opts.defaultSortIndex` sets the initial sort column.
 */
export function paginatedStandingsTable(rows, columns, opts = {}) {
  const PAGE_SIZES =
    Array.isArray(opts.pageSizes) && opts.pageSizes.length
      ? opts.pageSizes
      : [50, 100, 200];
  const searchValue = opts.searchValue || (() => "");
  let query = "";
  let pageSize = PAGE_SIZES.includes(opts.defaultPageSize)
    ? opts.defaultPageSize
    : PAGE_SIZES[0];
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
