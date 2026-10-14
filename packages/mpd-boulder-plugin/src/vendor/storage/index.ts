// Boulder core: the storage barrel, re-exporting the ledger API grouped by concern.
//
// The specifiers are extensionless on purpose: this tree is compiled by `bun build` into
// `dist/index.js`, the same form every other file under `packages/*/src` uses.

/** Ledger location and plan-path resolution. */
export { getBoulderFilePath, resolveBoulderPlanPath, resolveBoulderPlanPathForWork } from "./path"
/** Plan discovery, naming and checklist progress. */
export { findPrometheusPlans, getPlanName, getPlanProgress } from "./plan-progress"
/** Session-id normalization, the one primitive callers outside storage still need. */
export { normalizeSessionId } from "./shared"
/** Read-side queries over the ledger. */
export {
  getActiveWorks,
  getBoulderWorks,
  getTaskSessionState,
  getWorkById,
  getWorkByPlanName,
  getWorkForSession,
  getWorkResumeOptions,
  readBoulderState,
} from "./read-state"
/** Attaching sessions to the ledger or to one work. */
export { appendSessionId, appendSessionIdForWork } from "./session"
/** Per-task timer mutation. */
export { endTaskTimer, startTaskTimer, upsertTaskSessionState, upsertTaskSessionStateForWork } from "./task"
/** Ledger creation, selection, extension, completion and persistence. */
export { addBoulderWork, clearBoulderState, completeBoulder, createBoulderState, generateWorkId, selectActiveWork, writeBoulderState } from "./write-state"
