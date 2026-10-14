// Boulder core: path constants of the durable work ledger.
//
// This tree is mpd-owned code (wave de-omo C). It was written here against the CONTRACT this
// bundle's tools already documented — a `.mpd`-rooted JSON ledger plus per-task timers — and
// carries no third-party source.

/** State root of this workspace-scoped state, shared with every other mpd row. */
export const BOULDER_DIR = ".mpd"

/** File name of the ledger inside the state root: two-space JSON, exactly one file per workspace. */
export const BOULDER_FILE = "boulder.json"

/**
 * Display path of the ledger relative to the workspace root, for messages and docs only.
 * A caller needing the real location must resolve it through `getBoulderFilePath`, because an
 * explicit `boulder.dir` override relocates the root and this literal would then be wrong.
 */
export const BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`

/** Notepads subdirectory of the state root; kept for layout parity, read and written by no tool here. */
export const NOTEPAD_DIR = "notepads"

/** Display path of the notepads subdirectory relative to the workspace root; unused by the tools. */
export const NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`

/** Plan directory the plans/progress tools scan, relative to the workspace root. */
export const PROMETHEUS_PLANS_DIR = ".mpd/plans"
