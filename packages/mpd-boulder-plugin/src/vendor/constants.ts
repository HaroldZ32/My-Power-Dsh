// mpd adaptation: state root uses the .mpd convention (renamed from the legacy upstream layout).
export const BOULDER_DIR = ".mpd"
/** File name of the ledger inside the state root; two-space JSON, one file per workspace. */
export const BOULDER_FILE = "boulder.json"
/** Display path of the ledger relative to the workspace root; resolve the real file through `getBoulderFilePath` instead. */
export const BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`

/** Notepads subdirectory of the state root; vendored for API parity, no tool of this bundle reads or writes it. */
export const NOTEPAD_DIR = "notepads"
/** Display path of the notepads subdirectory relative to the workspace root; unused by this bundle's tools. */
export const NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`

/** Plan directory scanned by the plans/progress tools, relative to the workspace root. */
export const PROMETHEUS_PLANS_DIR = ".mpd/plans"
