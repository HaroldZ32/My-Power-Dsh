// Boulder core: the tree's public surface.
//
// mpd-owned code (wave de-omo C): a durable, workspace-scoped JSON ledger plus per-task timers,
// written here against the contract this bundle's tools already documented. It carries no
// third-party source and no third-party licence obligation.
//
// The specifiers are extensionless because `bun build` bundles this tree into
// `packages/mpd-boulder-plugin/dist/index.js`; only the SOURCE tree uses them.

/** Path constants of the state root, ledger file and plan directory. */
export { BOULDER_DIR, BOULDER_FILE, BOULDER_STATE_PATH, NOTEPAD_BASE_PATH, NOTEPAD_DIR, PROMETHEUS_PLANS_DIR } from "./constants"
/** Plan-markdown parsing: checklist counts and the next actionable task. */
export { getPlanChecklist, parsePlanChecklist } from "./plan-checklist"
/** The next actionable task of a plan FILE, rather than of plan text. */
export { readCurrentTopLevelTask } from "./top-level-task"
/** The whole ledger API: reads, session attachment, timers and mutations. */
export {
  addBoulderWork,
  appendSessionId,
  appendSessionIdForWork,
  clearBoulderState,
  completeBoulder,
  createBoulderState,
  endTaskTimer,
  findPrometheusPlans,
  generateWorkId,
  getActiveWorks,
  getBoulderFilePath,
  getBoulderWorks,
  getPlanName,
  getPlanProgress,
  getTaskSessionState,
  getWorkById,
  getWorkByPlanName,
  getWorkForSession,
  getWorkResumeOptions,
  normalizeSessionId,
  readBoulderState,
  resolveBoulderPlanPath,
  resolveBoulderPlanPathForWork,
  selectActiveWork,
  startTaskTimer,
  upsertTaskSessionState,
  upsertTaskSessionStateForWork,
  writeBoulderState,
} from "./storage"
/** The persisted data contract every entry point above speaks in. */
export type {
  BoulderSessionOrigin,
  BoulderState,
  BoulderTaskStatus,
  BoulderWorkResumeOption,
  BoulderWorkState,
  BoulderWorkStatus,
  PlanChecklist,
  PlanProgress,
  TaskSessionState,
  TopLevelTaskRef,
} from "./types"
