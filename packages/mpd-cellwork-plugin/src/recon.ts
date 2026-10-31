// CELLWORK RECON — the planner's one-shot READ-ONLY consult (contract B5, plan §4.12).
//
// WHY A CELLWORK TOOL OF ITS OWN. `mpd_role_spawn` now forwards an explicit `maxDepth` (the caller's
// recorded depth + 1), so this path has no depth advantage over it — the two AGREE on the depth rule. What
// recon adds is the cell's own plumbing: the consult is raised through the adapter's DIRECT start seam with
// an explicit ABSOLUTE cap (`request.maxDepth = cellwork.depthMax`), `label` set to EXACTLY the read-only
// roster name, which is what makes the child-persona seam apply the exported deny list mechanically, and
// the report journaled inside the cell so the planner's own record carries the evidence.
//
// DECLARED BOUND: on a composition without that seam the label buys nothing and the read-only discipline
// is prose in the prompt. The result says `personaInjected: false` in that case rather than claiming a
// mechanical guarantee the deployment cannot make.
import type { CellState } from "./state"
import { appendJournal } from "./state"
import type { CellworkConfig } from "./config"
import type { DshSpawnSpec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The two read-only roster roles a consult may use; the label must be EXACTLY one of these names. */
export const RECON_ROLES: readonly string[] = ["Explorer", "Researcher"]

/** Characters of the consult report kept in the journal; the full text is the tool result. */
const JOURNAL_REPORT_CHARS = 2000

/** What {@link runRecon} needs: the spawn seam, the cell, the caller's identity and the persona reader. */
export interface ReconDeps {
  /** The adapter slice the consult is raised through (the direct one-shot start path). */
  spawn: (spec: DshSpawnSpec) => Promise<{ output: string; stopReason: string | null }>
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The cell the consult is charged to. */
  cell: CellState
  /** The calling agent handle, used as the spawn's authorizing parent. */
  parent: unknown
  /** The caller's cell name (`cell-planner`, …) and enforced seat mode. */
  caller: { member: string; mode: string }
  /** The resolved knobs (the depth cap travels in the spawn request). */
  config: CellworkConfig
  /** The roster persona text for one label, or null when the roster service cannot answer. */
  personaFor: (label: string) => string | null
  /** The instant to journal with. */
  now: Date
}

/** The input one consult carries. */
export interface ReconInput {
  /** The read-only role: `Explorer` or `Researcher` (any case spelling is normalised). */
  role: string
  /** The question to answer; one consult answers one question. */
  task: string
}

/** The consult's result: the report, or the refusal sentence. */
export type ReconResult =
  | { ok: true; role: string; label: string; report: string; stopReason: string | null; personaInjected: boolean }
  | { ok: false; error: string }

/**
 * Canonicalise one requested role to its exact roster label.
 *
 * @param role - the caller's spelling.
 * @returns the canonical label, or undefined when it names no read-only consult role.
 */
export function canonicalReconRole(role: string): string | undefined {
  /** The trimmed, lowercased spelling. */
  const wanted = role.trim().toLowerCase()
  return RECON_ROLES.find((candidate) => candidate.toLowerCase() === wanted)
}

/**
 * Build the consult prompt: the persona (when readable), the question, and the read-only contract.
 *
 * @param deps - the cell, the persona reader and the knobs.
 * @param label - the canonical read-only role label.
 * @param task - the question to answer.
 * @returns the prompt text.
 */
export function reconPrompt(deps: Pick<ReconDeps, "cell" | "personaFor">, label: string, task: string): string {
  /** The persona text, when the roster service answered. */
  const persona = deps.personaFor(label)
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] ONE-SHOT READ-ONLY CONSULT — " + label,
    "",
    "Cell " + deps.cell.cellId + " is in its planning phase. Answer the question below from the repository",
    "itself: read files, search, and cite what you found by path. You cannot write, edit or run a shell;",
    "that is the point of this consult.",
    "",
    "QUESTION:",
    task,
    "",
    "RETURN: the evidence you found (paths and the few relevant excerpts), then a direct answer. If the",
    "question is unanswerable from the tree, say exactly what is missing rather than guessing.",
  ].join("\n")
}

/**
 * Run ONE read-only consult and journal its outcome.
 *
 * The result is the tool's answer; the journal keeps a bounded excerpt plus the full character count, so a
 * cell's history records that the consult happened without duplicating a long report into every reader.
 *
 * @param deps - the spawn seam, the cell, the caller and the knobs.
 * @param input - the role label and the question.
 * @returns the report, or the refusal sentence.
 */
export async function runRecon(deps: ReconDeps, input: ReconInput): Promise<ReconResult> {
  if (deps.cell.phase === "stopped") return { ok: false, error: "cellwork_recon: cell " + deps.cell.cellId + " is stopped and archived — reconnaissance is refused after the mode ends" }
  /** Whether the caller may consult: the planner, or a promoted subcaptain (B5). */
  const allowed = deps.caller.member === "cell-planner" || deps.caller.mode === "subcaptain"
  if (!allowed) {
    return { ok: false, error: "cellwork_recon is PLANNER/SUBCAPTAIN ONLY: this session is " + JSON.stringify(deps.caller.member === "" ? "not a cell member" : deps.caller.member) + " in mode " + JSON.stringify(deps.caller.mode) + ". Ask the planner to run the consult, or ask the captain to relay the question." }
  }
  /** The canonical label, or the refusal naming the allowed set. */
  const label = canonicalReconRole(input.role)
  if (label === undefined) return { ok: false, error: "cellwork_recon: role " + JSON.stringify(input.role) + " is not a read-only consult role — use exactly " + RECON_ROLES.join(" or ") }
  /** The trimmed question. */
  const task = input.task.trim()
  if (task === "") return { ok: false, error: "cellwork_recon: the task/question is empty — one consult answers one concrete question" }
  /** The persona text, when readable. */
  const persona = deps.personaFor(label)
  try {
    /** The completed consult. */
    const result = await deps.spawn({
      label,
      prompt: reconPrompt(deps, label, task),
      maxDepth: deps.config.depthMax,
      parent: deps.parent,
    })
    appendJournal(deps.workspace, deps.cell.cellId, {
      event: "recon",
      role: label,
      question: task.slice(0, 400),
      reportChars: result.output.length,
      excerpt: result.output.slice(0, JOURNAL_REPORT_CHARS),
      stopReason: result.stopReason,
      personaInjected: persona !== null,
    }, deps.now)
    return { ok: true, role: label.toLowerCase(), label, report: result.output, stopReason: result.stopReason, personaInjected: persona !== null }
  } catch (error) {
    /** The failure's message. */
    const message = error instanceof Error ? error.message : String(error)
    appendJournal(deps.workspace, deps.cell.cellId, { event: "recon-failed", role: label, question: task.slice(0, 400), error: message }, deps.now)
    return { ok: false, error: "cellwork_recon: raising the " + label + " consult failed: " + message }
  }
}
