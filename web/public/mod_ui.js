import { closePlayerModal } from "./mod_lineup.js";
import { closeMatchModal } from "./mod_matches.js";
import { load } from "./mod_overview.js";
import { appState } from "./mod_state.js";

/** Switch the main view tab (overview / tournaments) and refresh the navbar. */
export function switchMainTab(target) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${target}`);
  });
  updateNav();
}

/** Switch a sub-tab inside the Tournaments tab and refresh the navbar. */
export function switchSubtab(target) {
  document.querySelectorAll(".subtab").forEach((s) => {
    const on = s.dataset.subtab === target;
    s.classList.toggle("active", on);
    s.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".subtab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tn-sub-${target}`);
  });
  updateNav();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchMainTab(tab.dataset.tab));
});

document.querySelectorAll(".subtab").forEach((subtab) => {
  subtab.addEventListener("click", () => switchSubtab(subtab.dataset.subtab));
});

/** Which analytics block prefix is currently visible. */
export function activePrefix() {
  const active = document.querySelector(".tab.active");
  return active && active.dataset.tab === "overview" ? "ov" : "tn";
}

/** A tournament offers a Knockout bracket view when it's grouped (World Cup
 * style). That's the only place the bracket is rendered, so the nav shortcut
 * is tied to it to guarantee the jump always lands on the bracket. */
export function tournamentHasKnockout(t) {
  return !!(
    t &&
    t.grouped &&
    Array.isArray(t.groups) &&
    t.groups.length &&
    t.teamGroups
  );
}

/** Jump to the Knockout bracket: open Teams sub-tab, flip the KO view on. */
export function gotoKnockout() {
  switchMainTab("tournaments");
  switchSubtab("teams");
  const koBtn = document.querySelector('.kt-tab[data-view="knockout"]');
  if (koBtn && !koBtn.classList.contains("active")) koBtn.click();
  const target =
    document.getElementById("tn-team-table") ||
    document.getElementById("tn-sub-teams");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Show the "See Brackets" shortcut only when the selected tournament has a
 * knockout bracket; hide it otherwise.
 */
export function updateNav() {
  const btn = document.getElementById("nav-brackets");
  if (!btn) return;
  btn.hidden = !tournamentHasKnockout(appState.currentTournament);
}

export const bracketsBtn = document.getElementById("nav-brackets");
if (bracketsBtn) bracketsBtn.addEventListener("click", gotoKnockout);

document.querySelectorAll(".nav-jump").forEach((btn) => {
  btn.addEventListener("click", () => {
    const jump = btn.dataset.jump;
    if (!jump) return; // e.g. "See Brackets" has its own handler.
    if (jump === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (jump === "player-leaderboard") {
      // Switch to tournaments tab and player standings subtab
      const tabBtn = document.querySelector('button[data-tab="tournaments"]');
      if (tabBtn) tabBtn.click();
      const subtabBtn = document.querySelector('button[data-subtab="players"]');
      if (subtabBtn) subtabBtn.click();
      setTimeout(() => {
        const node = document.getElementById("tn-player-table");
        if (!node) return;
        // Scroll a bit past the table's top so its header/controls clear the
        // sticky nav and the rows are properly in view.
        const y = node.getBoundingClientRect().top + window.scrollY + 160;
        window.scrollTo({ top: y, behavior: "smooth" });
      }, 100);
      return;
    }
    const p = activePrefix();
    // The explorer and players sections live in the Predictions sub-tab, so
    // make sure it's visible before scrolling to them.
    if (p === "tn") switchSubtab("predictions");
    const node = document.getElementById(`${p}-${jump}`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
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
export let WC_TRIVIA = [];

export let triviaTimer = null;
export let triviaOrder = [];
export let triviaIdx = 0;

export function shuffledTrivia() {
  const a = WC_TRIVIA.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function showNextTrivia() {
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

export function startTrivia() {
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

export function fmtPts(n) {
  return Number(n) === 1 ? "1 pt" : `${n} pts`;
}

export function buildScoringHTML() {
  const s = appState.scoringConfig || {
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

export function openScoringModal() {
  const overlay = document.getElementById("scoring-modal");
  const body = document.getElementById("scoring-modal-body");
  if (!overlay || !body) return;
  body.innerHTML = buildScoringHTML();
  overlay.hidden = false;
  document.body.classList.add("modal-open");
}

export function closeScoringModal() {
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
