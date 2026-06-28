import { el, esc, parseScore } from "./mod_core.js";
import {
  countdownChipHtml,
  openBracketProjectionModal,
  openMatchModal,
} from "./mod_matches.js";
import { render } from "./mod_overview.js";
import { sortableTable } from "./mod_tables.js";
import { computeLeagueTable } from "./mod_tournament.js";

export const WC_BRACKET = {
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
export const WC_SCHEDULE = {
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
export function fmtDhaka(value) {
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
export function slotDescription(slot) {
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
export let bracketTipEl = null;
export function getBracketTip() {
  if (!bracketTipEl) {
    bracketTipEl = el("div", { className: "bx-tip", role: "tooltip" });
    bracketTipEl.setAttribute("aria-hidden", "true");
    document.body.append(bracketTipEl);
    window.addEventListener("scroll", hideBracketTip, true);
    window.addEventListener("resize", hideBracketTip);
  }
  return bracketTipEl;
}

export function showBracketTip(anchor, text) {
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

export function hideBracketTip() {
  if (!bracketTipEl) return;
  bracketTipEl.classList.remove("visible");
  bracketTipEl.setAttribute("aria-hidden", "true");
}

export function attachInfoTip(icon, text) {
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
export function matchesByNumber(t) {
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
export function decisiveTeam(m, which) {
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
export function groupPositionTeam(t, group, pos) {
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
export function allGroupsComplete(t) {
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
export function assignThirdPlaces(t) {
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
export function resolveSlot(t, slot, byNumber, thirdInfo) {
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
export function resolveBracketMatch(t, num, byNumber, thirdByMatch) {
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
export function buildBracketMatch(t, num, byNumber, thirdByMatch) {
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
    if (info.match) openMatchModal(info.match, "tn");
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

  // Live countdown to kick-off. Uses the match's own time once it exists,
  // otherwise the scheduled bracket time. Empty once the match has started.
  const cdChip = countdownChipHtml(
    info.match ? info.match.endTime : WC_SCHEDULE[num],
  );
  const cdLine = cdChip ? `<div class="bx-countdown">${cdChip}</div>` : "";

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
    ${cdLine}
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
export function renderKnockoutBracket(container, t) {
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
export function renderGroupedLeagueTables(container, t) {
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
export function computeThirdPlaced(t) {
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
export function renderThirdPlacedCard(t) {
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
export function buildThirdPlacedTableEl(thirdPlaced) {
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
export function buildLeagueTableEl(rows) {
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
