// CELLWORK RECON — the planner's READ-ONLY consult (contract B5, plan §4.12; batch form added by the
// cellwork-async-delegation contract).
//
// WHAT IT ADDS OVER `mpd_role_spawn`. The consult is raised through the `mpdConsults` service the
// `mpd-roles` row provides over its ONE consult supervisor, with `role` set to EXACTLY the read-only
// roster name — which is what makes the roles row apply the exported READ-ONLY deny list to the child's
// tool scope mechanically — and with the cell's own ABSOLUTE cap (`cellwork.depthMax`) instead of the
// caller-depth arithmetic that would refuse a cell member. The cell-context line travels as `context`.
//
// TWO FORMS, ONE TOOL. `{role, task}` is the legacy blocking form and keeps its exact result fields. The
// batch form `{role, questions}` starts every question, settles ALL of them with `Promise.all` and answers
// only when every one is settled — so N questions cost one call and run concurrently, never one after the
// other. Exactly ONE of `task` / `questions` is required.
//
// DECLARED BOUNDS. The mechanical read-only guarantee is the roles row's `toolFilter` (it resolves the
// role as read-only); a composition whose roster does not mark the role read-only degrades to the prose in
// {@link reconContext}, and the result says `personaInjected:false` when no persona text was readable
// rather than claiming a guarantee the deployment cannot make. The shared `MPD_DSH_CONSULT_MAX` cap still
// governs: over-cap questions QUEUE inside the supervisor and this call waits for every one.
import type { CellState } from "./state"
import { appendJournal } from "./state"
import type { CellworkConfig } from "./config"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { consultRowOf, missingConsultsServiceRefusal, reportRowOf, type ConsultServiceView } from "./consults"

/** The two read-only roster roles a consult may use; the label must be EXACTLY one of these names. */
export const RECON_ROLES: readonly string[] = ["Explorer", "Researcher"]

/** Characters of the consult report kept in the journal; the full text is the tool result. */
const JOURNAL_REPORT_CHARS = 2000

/** The most questions ONE batch recon call may settle (contract §3.2). */
export const RECON_MAX_QUESTIONS = 8

/** What {@link runRecon} needs: the service, the cell, the caller's identity and the persona reader. */
export interface ReconDeps {
  /** The `mpdConsults` service slice, or undefined when the `mpd-roles` row is not mounted. */
  consults: ConsultServiceView | undefined
  /** The calling dispatch, forwarded to the service as `exec` (the child is raised under its authority). */
  exec: DshToolExec
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The cell the consult is charged to. */
  cell: CellState
  /** The caller's cell name (`cell-planner`, …) and enforced seat mode. */
  caller: { member: string; mode: string }
  /** The resolved knobs; `depthMax` travels as the consult's ABSOLUTE nesting cap. */
  config: CellworkConfig
  /** The roster persona text for one label, or null when the roster service cannot answer. */
  personaFor: (label: string) => string | null
  /** The instant to journal with. */
  now: Date
}

/** The input one recon call carries: exactly one of `task` (legacy) or `questions` (batch). */
export interface ReconInput {
  /** The read-only role: `Explorer` or `Researcher` (any case spelling is normalised). */
  role: string
  /** The single legacy question. */
  task?: string
  /** The batch form: 1..8 questions, run concurrently and awaited together. */
  questions?: string[]
}

/** One question's outcome in the batch answer. */
export interface ReconReport {
  /** The question as it was asked. */
  question: string
  /** The consult's report, or the failure text when that question failed on its own. */
  report: string
  /** Why the child stopped, `"failed"` for a failed question, or null when the host declared none. */
  stopReason: string | null
  /** Present and true when the consult was interrupted (the deadman or a cancel). */
  interrupted?: boolean
  /** The handoff document an interruption wrote. */
  handoff?: string
}

/** The consult's result: the report(s), or the refusal sentence. */
export type ReconResult =
  | {
    /** True on success. */
    ok: true
    /** The canonical role, lowercased (the legacy spelling). */
    role: string
    /** The canonical roster label. */
    label: string
    /** Whether a persona text was readable and therefore travelled in the prompt. */
    personaInjected: boolean
    /** The batch rows; present for the `questions` form only. */
    reports?: ReconReport[]
    /** The legacy single report: present for `{role, task}` and for a one-question batch. */
    report?: string
    /** The legacy stop reason, with the same presence rule as `report`. */
    stopReason?: string | null
  }
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
 * Build the CONTEXT block every consult of this cell carries: the cell id and the read-only contract.
 *
 * The persona and the question are NOT here: the roles row prepends the persona itself and appends the
 * task, so a caller that also embedded either would state it twice in one prompt.
 *
 * @param deps - the cell the consult is charged to.
 * @returns the context text.
 */
export function reconContext(deps: Pick<ReconDeps, "cell">): string {
  return [
    "Cell " + deps.cell.cellId + " is in its planning phase. Answer the ONE question below from the repository",
    "itself: read files, search, and cite what you found by path. You cannot write, edit or run a shell;",
    "that is the point of this consult.",
    "",
    "RETURN: the evidence you found (paths and the few relevant excerpts), then a direct answer. If the",
    "question is unanswerable from the tree, say exactly what is missing rather than guessing.",
  ].join("\n")
}

/**
 * Read the questions one call asks, in the caller's order.
 *
 * @param input - the raw input (one `task`, or a `questions` array).
 * @returns the questions, or the refusal sentence.
 */
function questionsOf(input: ReconInput): { questions: string[] } | { error: string } {
  /** Whether the legacy single-question field was supplied at all. */
  const hasTask = typeof input.task === "string"
  /** Whether the batch field was supplied at all. */
  const hasQuestions = Array.isArray(input.questions)
  if (hasTask === hasQuestions) return { error: "cellwork_recon: supply EXACTLY ONE of `task` (one question) or `questions` (1.." + String(RECON_MAX_QUESTIONS) + " questions)" }
  if (hasTask) {
    /** The trimmed legacy question. */
    const task = String(input.task ?? "").trim()
    if (task === "") return { error: "cellwork_recon: the task/question is empty — one consult answers one concrete question" }
    return { questions: [task] }
  }
  /** The declared questions. */
  const declared = Array.isArray(input.questions) ? input.questions : []
  if (declared.length === 0) return { error: "cellwork_recon: `questions` is empty — ask at least one question" }
  if (declared.length > RECON_MAX_QUESTIONS) return { error: "cellwork_recon: `questions` carries " + String(declared.length) + " entries, more than the " + String(RECON_MAX_QUESTIONS) + " one call settles — split it into batches" }
  /** The trimmed questions, in order. */
  const questions: string[] = []
  for (let index = 0; index < declared.length; index += 1) {
    /** One raw entry. */
    const entry = declared[index]
    /** The trimmed question text. */
    const text = typeof entry === "string" ? entry.trim() : ""
    if (text === "") return { error: "cellwork_recon: questions[" + String(index) + "] is empty — every question must be a non-empty string" }
    questions.push(text)
  }
  return { questions }
}

/**
 * Run ONE or MANY read-only consults and journal every outcome.
 *
 * The question set is validated BEFORE anything starts, so an empty question, a forbidden role or a
 * missing service refuses the whole call and starts nothing. Once started, one question failing does not
 * cancel the others: its row carries the failure text and `stopReason: "failed"`.
 *
 * @param deps - the service, the cell, the caller and the knobs.
 * @param input - the role and the question(s).
 * @returns the report rows, or the refusal sentence.
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
  /** The question set, or the refusal that replaced it. */
  const asked = questionsOf(input)
  if ("error" in asked) return { ok: false, error: asked.error }
  /** The service, or the honest absence refusal (never an unsupervised spawn). */
  const service = deps.consults
  if (service?.start === undefined || service.settle === undefined || service.collect === undefined) {
    return { ok: false, error: missingConsultsServiceRefusal("cellwork_recon") }
  }
  /** The persona text, when readable — the ONE fact `personaInjected` reports. */
  const persona = deps.personaFor(label)
  /** The cell context every question of this call carries. */
  const context = reconContext(deps)
  /** One started question: its id, or the failure text when it could not be started at all. */
  const starts: Array<{ question: string; consultId?: string; failure?: string }> = []
  for (const question of asked.questions) {
    try {
      // ONE start per question, all in this pass: the supervisor answers at once, so N questions overlap
      // instead of serialising, and an over-cap one QUEUES on the shared cap rather than failing.
      /** The service's answer for this question. */
      const answer = await service.start({ role: label, task: question, context, exec: deps.exec, maxDepth: deps.config.depthMax })
      /** The minted id. */
      const view = consultRowOf(answer)
      if (view === undefined) starts.push({ question, failure: "the `mpdConsults` service answered without a consultId" })
      else starts.push({ question, consultId: view.consultId })
    } catch (error) {
      starts.push({ question, failure: error instanceof Error ? error.message : String(error) })
    }
  }
  // EVERY question is settled and collected CONCURRENTLY. `settle` has no timeout (the supervisor's `wait`
  // stops at 60 s, and a long child must not be cut off by a bound the caller never asked for); `collect`
  // is what releases the record and yields the report.
  /** The per-question outcome rows, in the caller's order. */
  const reports: ReconReport[] = await Promise.all(starts.map(async (start): Promise<ReconReport> => {
    if (start.consultId === undefined) return { question: start.question, report: "cellwork_recon: starting the " + label + " consult failed: " + String(start.failure ?? "unknown error"), stopReason: "failed" }
    try {
      await service.settle?.(start.consultId)
      /** The outcome `collect` released. */
      const outcome = consultRowOf(await Promise.resolve(service.collect?.(start.consultId)))
      /** The settled report inside that outcome. */
      const report = reportRowOf(outcome?.report)
      if (report === undefined) {
        // A settled record always carries a report; a FAILED consult carries its failure text instead.
        return { question: start.question, report: "cellwork_recon: the " + label + " consult for this question failed: " + String(outcome?.error ?? "the supervisor released no report"), stopReason: "failed" }
      }
      return {
        question: start.question,
        report: report.summary,
        stopReason: report.stopReason,
        ...(report.status === "interrupted" ? { interrupted: true } : {}),
        ...(report.handoff === undefined ? {} : { handoff: report.handoff }),
      }
    } catch (error) {
      return { question: start.question, report: "cellwork_recon: settling the " + label + " consult failed: " + (error instanceof Error ? error.message : String(error)), stopReason: "failed" }
    }
  }))
  // ONE journal row per question: the cell's history records that the consult happened without duplicating
  // a long report into every reader.
  for (const row of reports) {
    appendJournal(deps.workspace, deps.cell.cellId, {
      event: row.stopReason === "failed" ? "recon-failed" : "recon",
      role: label,
      question: row.question.slice(0, 400),
      reportChars: row.report.length,
      excerpt: row.report.slice(0, JOURNAL_REPORT_CHARS),
      stopReason: row.stopReason,
      personaInjected: persona !== null,
    }, deps.now)
  }
  /** The single outcome a legacy-shaped answer repeats at the top level. */
  const single = reports.length === 1 ? reports[0] : undefined
  /** Whether this call used the LEGACY single-question form, whose answer carries exactly today's fields. */
  const legacyOnly = input.task !== undefined && asked.questions.length === 1
  // The LEGACY shape (`{role, task}`) answers exactly today's fields; the BATCH form adds `reports` and
  // repeats the legacy pair when — and only when — it asked exactly one question.
  return {
    ok: true,
    role: label.toLowerCase(),
    label,
    personaInjected: persona !== null,
    ...(single === undefined ? { reports } : legacyOnly ? { report: single.report, stopReason: single.stopReason } : { reports, report: single.report, stopReason: single.stopReason }),
  }
}
