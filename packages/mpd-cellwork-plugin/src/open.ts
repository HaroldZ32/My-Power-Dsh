// CELLWORK OPEN — the ONE path that creates a cell, shared by the `/cellwork` command and the
// `cellwork_open` tool.
//
// WHY IT IS A SHARED FUNCTION AND NOT TWO HANDLERS. The command writes the record and submits the
// activation directive as the invoking agent's next user turn; the tool (contract §4.5) must do the SAME
// thing so an autoproject escalation enters cell mode through the same gate — the refusals, the record
// shape and the directive are one sequence, and two copies would drift the moment either side changed.
//
// THE TWO DOCUMENTED DIFFERENCES from a command, both structural rather than policy:
//   * a TOOL has no `invocation.submit`, so the caller receives the directive TEXT back and relays or
//     injects it — `openCell` takes the submit seam as an optional member and never assumes one;
//   * a command runs on the user's own turn, while a tool call may come from any member session, so the
//     TOOL arm checks the caller is the captain before calling this (see `cellwork_open` in `index.ts`).
//
// WHAT IT REFUSES, in order: an empty objective, an empty captain session (a record no later call could
// read), a workspace whose active cell scan failed, an ALREADY ACTIVE cell, and a `mandate` that names no
// `.mpd/autoproject/<runId>/escalation.json`. Nothing is written before every check has passed.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { freeCellId, newCellState, readActiveCell, recordTransition, writeCell, type CellReadFailure, type CellState } from "./state"
import { activationDirective } from "./prompts"

/**
 * What one open attempt produced.
 *
 * A refusal carries no cell id: the arm that failed wrote NOTHING (every check runs before the first
 * write), except the documented no-live-turn rollback, which reports the archived id it created.
 */
export type OpenCellOutcome =
  | {
    /** True when the cell was created and is active. */
    ok: true
    /** The minted cell id. */
    cellId: string
    /** The phase the cell entered (`requirements`). */
    phase: string
    /** The absolute state record path. */
    statePath: string
    /** The activation directive text the caller relays (or the command submitted). */
    directive: string
  }
  | {
    /** False for every refusal. */
    ok: false
    /** ONE sentence naming what was refused and what to do instead. */
    error: string
    /** The record path, when the refusal is about a state this build could not read. */
    path?: string
  }

/** What {@link openCell} needs: who, where, what, and the optional turn surface a command has. */
export interface OpenCellInput {
  /** The caller's workspace root (resolved by the caller through the adapter, per call). */
  workspace: string
  /** The user's objective, verbatim after trimming. */
  objective: string
  /** The session that becomes this cell's captain. */
  captainSessionId: string
  /** The escalation run id an autoproject hand-off claims; checked against the artifact on disk. */
  mandate?: string
  /** The instant the cell is minted at (the caller's own clock reading, as the store's convention). */
  now: Date
  /**
   * The live-turn surface a COMMAND has: it receives the directive text and answers whether it landed.
   *
   * ABSENT for a tool: the directive is then returned to the caller instead, and nothing is rolled back —
   * a tool caller can relay it, while a command that cannot submit has no way to start the mode at all.
   */
  submit?: (directive: string) => boolean
}

/**
 * The escalation artifact a `mandate` must name, or the refusal sentence when it names none.
 *
 * The run id is read as ONE path segment: a mandate is a run identity, never a path, so a separator or a
 * `..` segment is refused rather than normalised into a different directory.
 * @param workspace - the workspace root.
 * @param mandate - the run id the caller claims.
 * @returns the absolute artifact path when it exists, or the refusal sentence.
 */
function mandateArtifact(workspace: string, mandate: string): { path: string } | { refusal: string } {
  /** The trimmed run id the caller named. */
  const runId = mandate.trim()
  if (runId === "") return { refusal: "cellwork_open: `mandate` names no run id — omit it, or pass the autoproject run whose escalation.json should authorise this cell" }
  if (runId.includes("/") || runId.includes("\\") || runId === "." || runId === "..") {
    return { refusal: "cellwork_open: `mandate` " + JSON.stringify(mandate) + " is not a run id — it must be ONE path segment under .mpd/autoproject" }
  }
  /** The escalation artifact this run would have written. */
  const path = join(workspace, ".mpd", "autoproject", runId, "escalation.json")
  return existsSync(path) ? { path } : { refusal: "cellwork_open: no escalation artifact at " + path + " — a mandated cell is opened ONLY from a real autoproject escalation, so nothing was written" }
}

/**
 * Create one cell, refusing unless every documented precondition holds.
 *
 * THE ORDER IS THE CONTRACT: every refusal is decided BEFORE the first write, so a refused call leaves
 * the workspace byte-identical. The one exception is the no-live-turn rollback a COMMAND performs: the
 * record is created and then archived with the reason, because leaving it active would fence a captain
 * whose turn never received the directive.
 * @param input - who is opening what, where, and the optional submit seam.
 * @returns the created cell and its directive, or one refusal sentence.
 */
export function openCell(input: OpenCellInput): OpenCellOutcome {
  /** The objective as it will be stored. */
  const objective = input.objective.trim()
  if (objective === "") return { ok: false, error: "cellwork_open: `objective` is required — it is the user's own words for what the cell must build" }
  // THE SESSION ID IS CHECKED BEFORE ANYTHING IS WRITTEN. `normalizeCellState` treats an empty
  // `captainSessionId` as an identity failure, so a record written without one is a record no later
  // call can read — and every later call would refuse with "cannot be read", leaving a cell only a hand
  // edit could clear.
  if (input.captainSessionId === "") return { ok: false, error: "cellwork_open refused: the caller carries no session id, so no captain can be recorded — nothing was written" }
  /** The mandate check, when one was claimed. */
  if (input.mandate !== undefined) {
    /** The artifact path or the refusal. */
    const mandate = mandateArtifact(input.workspace, input.mandate)
    if ("refusal" in mandate) return { ok: false, error: mandate.refusal }
  }
  /** The workspace's current cell scan. */
  const active = readActiveCell(input.workspace)
  if (!active.ok) return { ok: false, error: "cellwork_open refused: " + readFailureText(active), path: active.path }
  if (active.cell !== null) {
    return {
      ok: false,
      error: "cellwork_open refused: cell " + active.cell.state.cellId + " is still active in this workspace (phase " + active.cell.state.phase + ") — one cell at a time, and a second one would fight the first for the same team board. Read it with `cellwork_status`, finish it, or end it with `cellwork_stop` first.",
    }
  }
  /** The fresh record, phase `requirements`, capturing the captain session. */
  const created: CellState = newCellState({ cellId: freeCellId(input.workspace, input.now), objective, captainSessionId: input.captainSessionId, now: input.now })
  writeCell(input.workspace, created)
  recordTransition(input.workspace, created, { event: "start", phase: created.phase, objective, captainSessionId: created.captainSessionId }, input.now)
  /** The activation directive, as the text a command submits and a tool returns. */
  const directive = activationDirective({ state: created, workspace: input.workspace })
  // A TOOL CALLER RECEIVES THE TEXT. It has no turn surface of its own, so there is nothing to roll back
  // — the caller (an autoproject run, or the model) injects or relays it.
  if (input.submit === undefined) {
    return { ok: true, cellId: created.cellId, phase: created.phase, statePath: join(input.workspace, ".mpd", "cellwork", created.cellId, "state.json"), directive }
  }
  if (input.submit(directive) !== true) {
    // NOTHING RUNS IF NOTHING WAS INJECTED. Leaving the record active would fence a captain whose turn
    // never received the directive, so the just-created cell is archived with the reason.
    recordTransition(input.workspace, { ...created, phase: "stopped", archived: true, stopReason: "no-live-turn-surface" }, { event: "stop", reason: "no-live-turn-surface", forced: false }, input.now)
    return { ok: false, error: "cellwork could not start: no live agent turn surface to submit the activation directive, so cell " + created.cellId + " was archived immediately and no mode is active" }
  }
  return { ok: true, cellId: created.cellId, phase: created.phase, statePath: join(input.workspace, ".mpd", "cellwork", created.cellId, "state.json"), directive }
}

/**
 * The sentence for a cell scan that could not read a record.
 *
 * `state.ts` owns the failure vocabulary; this module only needs ONE rendering of it, so the mapping is
 * kept local and total rather than re-deriving each reason.
 * @param failure - the unreadable-record failure the scan answered.
 * @returns one sentence naming the record and the reason.
 */
function readFailureText(failure: CellReadFailure): string {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first"
}
