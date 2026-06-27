/* Shared mutable application state across modules. */
export const appState = {
  /** The tournament id currently selected in the tournament view (null on Overview). */
  currentTournament: null,
  /** The scoring rules config (set on data load, read by the scoring modal). */
  scoringConfig: null,
};
