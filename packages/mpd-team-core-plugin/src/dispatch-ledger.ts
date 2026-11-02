// The DISPATCH LEDGER file: one workspace-wide map of who is working which task.
//
// WHY IT IS ITS OWN MODULE. The ledger is the ONE piece of dispatch state that lives on disk, and it is
// read and written from two places now: the row's tool handlers (release, and the review path) and the
// exec-free `runDispatch` action in `team-actions.ts`. A module-level helper in `index.ts` cannot be
// reached from there without a module cycle, and copying the reader would give the workspace TWO
// definitions of its own ledger file — exactly the drift this bundle refuses elsewhere. Both consumers
// therefore import these three symbols, and the path is spelled once.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DispatchLedger } from "./dispatch"

/**
 * The dispatch ledger path: `<workspace>/.mpd/team/dispatch.json`.
 *
 * ONE file holds EVERY team of the workspace. The rows are keyed by `teamId + "::" + taskId`
 * (`dispatch.ts#ledgerKey`) and each row carries its own `teamId`, so a caller scopes the file by the
 * pure helpers rather than by path — which is what stops a new team reusing `T1..Tn` from inheriting
 * a dead team's pairings.
 */
const dispatchPath = (workspace: string): string => join(workspace, ".mpd", "team", "dispatch.json")

/** Read the ledger; a missing or unreadable file is an empty ledger, never a crash. */
export function readLedger(workspace: string): DispatchLedger {
  try {
    /** The parsed ledger, accepted only when it is a plain object; anything else reads as empty. */
    const raw = JSON.parse(readFileSync(dispatchPath(workspace), "utf8")) as DispatchLedger
    return raw !== null && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

/**
 * Persist the ledger. Throws only on a real write failure.
 *
 * ATOMIC (T7): the bytes land in a sibling temp file that is then renamed over the target — the same
 * shape `team-store.ts#writeJson` uses — so a reader sees either the whole old ledger or the whole new
 * one. Before this the plain `writeFileSync` could be observed half-written, and a reader who caught it
 * mid-write got a `JSON.parse` throw and the `catch` above answering `{}` — i.e. it silently read a
 * ledger that had LOST every existing pairing. The temp file lives in the SAME directory, so the
 * rename stays on one filesystem.
 */
export function writeLedger(workspace: string, ledger: DispatchLedger): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  /** The sibling temp file this write lands in before the rename. */
  const temp = dispatchPath(workspace) + ".tmp-" + process.pid
  writeFileSync(temp, JSON.stringify(ledger, null, 2) + "\n")
  renameSync(temp, dispatchPath(workspace))
}
