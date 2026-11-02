// THE PROJECT-ARCHIVE HOOK (wave W3-D, decision D6): when a project closes, record a DETERMINISTIC
// digest of it in the GLOBAL memory store, so a later session IN ANY WORKSPACE can recall what was
// built, what proved it and what stayed open.
//
// WHAT COUNTS AS A CLOSED PROJECT, and the key it is filed under:
//   · `mpd_boulder_complete`                   → the completed workId;
//   · `cellwork_stop` (an accepted stop only)  → the archived cell id;
//   · `agent_teams_plan {action:"delete"}` whose archived plan carries an `approvedAt`
//                                              → the plan's teamId (else its planId).
// A key is namespaced `<workspace>:<projectKey>`, so two workspaces never collide inside the shared
// store, and a SECOND event on the same key OVERWRITES its entry while journaling `superseded` — the
// fact of the second close survives even though there is still exactly one memory per project.
//
// NO MODEL CALL, NO NETWORK: the digest is built from the workspace's own files (the boulder ledger,
// the cell record, the archived plan, the verify ledger and the gate table). A source that cannot be
// read is REPORTED as unreadable inside the digest; it is never invented.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { rowLogLine, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  appendJournalLine,
  assertMemoryMutationSandboxed,
  commitAll,
  ensureGlobalDirs,
  ensureVcs,
  globalRoot,
  safeMemoryPath,
  type Config,
  type StoreDirs,
} from "./store"

/** The event kinds the hook recognises; each is also the digest's third tag (`project`, `archive`, this). */
export type ArchiveEventKind = "boulder_complete" | "cellwork_stop" | "team_plan_archive"

/** One archived plan as the `mpdTeams` service reports it: the hook needs identity, approval and team. */
export interface ArchivedPlanView {
  /** The archived plan's identity, which is also its archive directory name. */
  planId: string
  /** ISO instant the plan was approved; absent means it was archived WITHOUT approval. */
  approvedAt?: string
  /** The team this plan was approved into, when a team record still names the plan. */
  teamId?: string
  /** Absolute path of the archived plan document (`plan.json`). */
  path: string
}

/** The board-task fields the digest reads out of a team record or a split verdict. */
export interface TeamTaskView {
  /** The task id (`T1`, …), when the source names one. */
  id?: string
  /** The task's title. */
  subject?: string
  /** The task's own state; only `completed` is treated as closed. */
  status?: string
  /** The ids this task waits on, when the source names them. */
  blockedBy?: string[]
  /** The paths the task declared it may write. */
  writeScopes?: string[]
}

/** The team-record fields the digest reads; the record itself is a wider shape owned by the team row. */
export interface TeamRecordView {
  /** The team id. */
  teamId: string
  /** The team's display name. */
  name?: string
  /** The board tasks, of which the digest names titles, open rows and declared write scopes. */
  tasks?: TeamTaskView[]
}

/** The `mpdTeams` surface the hook reads; a composition without the service archives no team plan. */
export interface TeamsServiceView {
  /** Every archived plan this workspace holds, newest first. */
  archivedPlans: (workspace: string) => ArchivedPlanView[]
  /** One team record by id, when the composition also serves live records. */
  get?: (workspace: string, teamId: string) => TeamRecordView | undefined
}

/** The per-call context the hook needs: where it runs, the effective config and the team service. */
export interface ArchiveCallContext {
  /** The workspace root of the observed call, resolved per call and never cached. */
  workspace: string
  /** The effective row config (VCS mode and global store root), shared with the tools. */
  config: Config
  /** The mounted team service, or undefined when this composition has none. */
  teams: TeamsServiceView | undefined
}

/** What one observed call amounts to when it closes a project. */
export interface ArchiveEvent {
  /** Which tool closed the project, which is also the digest's third tag. */
  kind: ArchiveEventKind
  /** The project key inside its workspace (`workId` / `cellId` / `teamId`|`planId`). */
  projectKey: string
  /** The archived plan for a team-plan event, as the service reported it. */
  plan?: ArchivedPlanView
}

/** One row of the global store's project index: which entry file one namespaced key owns. */
export interface GlobalIndexEntry {
  /** The namespaced key, `<workspace>:<projectKey>`. */
  key: string
  /** The absolute workspace the project belongs to. */
  workspace: string
  /** The project key inside that workspace. */
  projectKey: string
  /** The event kind that wrote this entry LAST. */
  eventKind: ArchiveEventKind
  /** The entry file name, relative to the store's `repo/memory/` directory. */
  file: string
  /** ISO instant of the last write. */
  at: string
  /** How many later events on this key superseded an earlier entry (0 on the first write). */
  superseded: number
}

/** The whole `runtime/index.json` document: a format version plus one row per project key. */
export interface GlobalIndex {
  /** Format version; a reader that does not know it starts a fresh index. */
  version: 1
  /** The rows, keyed by the namespaced key. */
  entries: Record<string, GlobalIndexEntry>
}

/** What one archive-event write produced, for the caller's log line and for the tests. */
export interface ArchiveWriteOutcome {
  /** The namespaced key the digest was filed under. */
  key: string
  /** The absolute path of the entry file that now holds the digest. */
  file: string
  /** True when this write REPLACED an earlier entry for the same key. */
  superseded: boolean
  /** The commit backends' error lines; empty means every configured backend committed. */
  errors: string[]
}

/** Everything one digest renders; every field is read from disk, and `unreadable` names what was not. */
interface Digest {
  /** One line naming what closed (the work/plan name, the cell's objective). */
  objective: string
  /** The task titles the sources name, in source order and capped. */
  tasks: string[]
  /** The declared write scopes, deduplicated and sorted. */
  scopes: string[]
  /** Everything still open or unresolved, in the vocabulary of its source. */
  open: string[]
  /** The verify-proof lines: loop ids, verdict records, evidence paths and the gate table identity. */
  proof: string[]
  /** Sources this digest could not read, stated instead of guessed. */
  unreadable: string[]
}

/** One JSON read: the parsed value, or the reason it could not be read. */
interface JsonReading {
  /** The parsed document, present exactly when `problem` is absent. */
  value?: any
  /** Why the file could not be read, present exactly when `value` is absent. */
  problem?: string
}

/** The plan-title reading of one markdown plan: its item titles plus how many are still unticked. */
interface PlanItems {
  /** The item titles (numbered TODO items and final-wave items), in plan order. */
  titles: string[]
  /** How many of those items were unticked when read. */
  remaining: number
}

/** A heading that opens the TODO section, whose numbered `N. ` items are the work. */
const TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i
/** A heading that opens the final-verification wave, whose items carry the `F<n>. ` id form. */
const FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i
/** Any level-1/2 heading, which ends the section a previous heading opened. */
const SECTION_BOUNDARY = /^#{1,2}(?:[ \t]+|$)/
/** A top-level checkbox bullet: `- [ ] text` or `- [x] text`, indented no more than three spaces. */
const CHECKBOX_ITEM = /^ {0,3}[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/
/** A fenced-code opener, so a plan that quotes the checkbox syntax is not miscounted. */
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/

/**
 * Register the ONE post-execute listener this row owns.
 *
 * The listener ALWAYS returns `undefined`, so the adapter passes the downstream decision through
 * unchanged: this hook observes, it never alters or vetoes a tool result. It contains its own
 * failures (one log line) because the adapter does not document post-listener containment.
 *
 * @param dsh - the adapter's post-execute seam; a composition with no event bus answers a no-op disposer.
 * @param contextOf - resolves the per-call workspace, config and team service from one execution.
 * @returns the registration's disposer, which the row releases on dispose.
 */
export function installArchiveHook(
  dsh: Pick<DshAdapter, "onPostToolExecute">,
  contextOf: (exec: unknown) => ArchiveCallContext,
): () => void {
  try {
    /** The adapter's disposer for the listener installed here. */
    const dispose = dsh.onPostToolExecute((exec: unknown, result: unknown) => {
      try {
        // The harness hands both objects over opaquely; this hook reads exactly `name`/`arguments` and
        // `isError`/`value`, so the casts below name what it touches instead of trusting a whole shape.
        /** The execution object, narrowed to the two fields this hook reads. */
        const call = (exec ?? {}) as { name?: unknown; arguments?: unknown }
        /** The settled result, narrowed to the error flag and value the matcher reads. */
        const settled = (result ?? {}) as { isError?: unknown; value?: unknown }
        /** The call's argument object, when the harness passed one. */
        const args = call.arguments !== null && typeof call.arguments === "object" ? call.arguments as Record<string, unknown> : undefined
        handleArchiveCall(contextOf(exec), String(call.name ?? ""), args, settled)
      } catch (error) {
        rowLogLine("mpd-memory", "[mpd-memory] archive hook listener failed: " + String((error as Error)?.message ?? error))
      }
      // A post-execute listener that returns a decision REPLACES it; `undefined` passes the downstream one through.
      return undefined
    })
    return typeof dispose === "function" ? dispose : () => { /* no event bus: nothing to release */ }
  } catch (error) {
    rowLogLine("mpd-memory", "[mpd-memory] archive hook could not be installed: " + String((error as Error)?.message ?? error))
    return () => { /* nothing to release */ }
  }
}

/**
 * Handle ONE settled tool call: when it closes a project, write the global archive digest.
 *
 * Total by construction: a call that closes nothing is a no-op, and every failure (a refusal from the
 * shared HOME guard, an unreadable source, a failed commit) is contained into ONE log line instead of
 * escaping into the post-execute waterfall.
 *
 * @param context - the per-call workspace, config and team service.
 * @param toolName - the settled tool's registered name.
 * @param args - the call's validated arguments, when the harness passed any.
 * @param result - the settled result, narrowed to the two fields the matcher reads.
 * @param log - the diagnostic sink; defaults to this row's own file log (`mpd-memory.log`).
 * @returns the write this call produced, or `null` when it closed nothing (or could not be recorded).
 */
export function handleArchiveCall(
  context: ArchiveCallContext,
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: { isError?: unknown; value?: unknown },
  log: (line: string) => void = (line: string): void => { rowLogLine("mpd-memory", "[mpd-memory] " + line) },
): ArchiveWriteOutcome | null {
  try {
    /** The archive event this call closes, or null when it closes nothing that qualifies. */
    const event = matchArchiveEvent(context, toolName, args, result, log)
    if (event === null) return null
    /** The write this event produced. */
    const outcome = writeArchiveEntry(context, event)
    if (outcome.errors.length > 0) log("project memory " + outcome.key + " was written but its commit reported: " + outcome.errors.join("; "))
    return outcome
  } catch (error) {
    log("project-archive memory was not written for " + toolName + ": " + String((error as Error)?.message ?? error))
    return null
  }
}

/**
 * Decide whether one settled call closes a project, and under which key.
 *
 * THE THREE MATCHERS, exactly as the contract states them: a completed boulder work, an accepted cell
 * stop, and a team-plan DELETE whose archived plan carries an `approvedAt` (an unapproved plan was
 * never a project, so deleting it archives nothing).
 *
 * @param context - the per-call workspace and team service.
 * @param toolName - the settled tool's registered name.
 * @param args - the call's validated arguments.
 * @param result - the settled result; an error result never closes a project.
 * @param log - the diagnostic sink for the cases that must be stated but not written.
 * @returns the event to record, or `null` when this call closes nothing qualified.
 */
export function matchArchiveEvent(
  context: ArchiveCallContext,
  toolName: string,
  args: Record<string, unknown> | undefined,
  result: { isError?: unknown; value?: unknown },
  log: (line: string) => void,
): ArchiveEvent | null {
  if (result.isError === true) return null
  /** The settled result value, when the tool produced one. */
  const value = result.value !== null && typeof result.value === "object" ? result.value as Record<string, unknown> : undefined
  if (toolName === "mpd_boulder_complete") {
    /** The completed work id: the result's own first, the caller's argument as its fallback. */
    const workId = textOf(value?.workId) || textOf(args?.workId)
    return workId === "" ? null : { kind: "boulder_complete", projectKey: workId }
  }
  if (toolName === "cellwork_stop") {
    // A REFUSED stop answers `{ok:false, error}` instead of throwing, and an unarchived cell was never a
    // closed project, so the accepted-stop filter is the `ok !== false` test.
    if (value?.ok === false) return null
    /** The archived cell's id, which is what the digest is filed under. */
    const cellId = textOf(value?.cellId)
    return cellId === "" ? null : { kind: "cellwork_stop", projectKey: cellId }
  }
  if (toolName === "agent_teams_plan") {
    if (textOf(args?.action) !== "delete") return null
    /** The archive directory the delete wrote its plan into; an empty delete answers no path at all. */
    const archivedTo = textOf(value?.archivedTo)
    if (archivedTo === "") return null
    if (context.teams === undefined) {
      log("agent_teams_plan archived a plan but the mpdTeams service is absent — no project memory was written")
      return null
    }
    /** The archived plan the delete just wrote, matched by its archive directory (never by recency). */
    const plan = findArchivedPlan(context, archivedTo, log)
    if (plan === undefined) return null
    // THE APPROVAL FILTER: an unapproved plan never became a project, so its archive is not a memory.
    if (textOf(plan.approvedAt) === "") return null
    return { kind: "team_plan_archive", projectKey: textOf(plan.teamId) || plan.planId, plan }
  }
  return null
}

/**
 * Write one archive digest into the global store, committing it exactly like a workspace entry.
 *
 * @param context - the per-call workspace, config and team service.
 * @param event - the event to record.
 * @returns the key, the entry path, whether it superseded an earlier entry, and any commit errors.
 */
export function writeArchiveEntry(context: ArchiveCallContext, event: ArchiveEvent): ArchiveWriteOutcome {
  // THE T-43 GUARD runs through the shared predicate: a global write is the one home-scoped mutation
  // this row performs, so an isolated boot whose HOME does not contain the root is refused, not written.
  assertMemoryMutationSandboxed(globalRoot(context.config), "record a global project-archive memory")
  /** The global store's directories, created on demand (the first archive bootstraps the store). */
  const d = ensureGlobalDirs(context.config)
  ensureVcs(context.config, d)
  /** The instant this digest is recorded, stamped in both the body and the index row. */
  const at = new Date().toISOString()
  /** The namespaced key: two workspaces never collide inside the shared store. */
  const key = resolve(context.workspace) + ":" + event.projectKey
  /** The index as it stands, before this write. */
  const index = readIndex(d)
  /** The row an earlier event on the same key left, when there was one. */
  const previous = Object.prototype.hasOwnProperty.call(index.entries, key) ? index.entries[key] : undefined
  /** The entry file name: deterministic from the key, so a second event OVERWRITES instead of adding one. */
  const fileName = "project-" + slugForFile(event.projectKey) + "-" + shortHash(resolve(context.workspace)) + ".md"
  /** The entry's absolute path, containment-checked against the memory directory. */
  const file = safeMemoryPath(d.memoryDir, fileName)
  /** The digest this event renders, built ONLY from the workspace's own files. */
  const digest = digestFor(context, event)
  writeFileSync(file, frontmatterFor(event) + renderDigest(event, context.workspace, at, digest))
  appendJournalLine(d, "archive", { eventKind: event.kind, projectKey: event.projectKey, key, file: fileName })
  // THE SUPERSEDE FACT: the entry above replaced an earlier one, and the journal is where that survives.
  if (previous !== undefined) appendJournalLine(d, "superseded", { by: event.kind, key, file: fileName, previous: previous.eventKind })
  /** The index row this write leaves behind. */
  index.entries[key] = { key, workspace: resolve(context.workspace), projectKey: event.projectKey, eventKind: event.kind, file: fileName, at, superseded: (previous?.superseded ?? 0) + (previous === undefined ? 0 : 1) }
  writeIndex(d, index)
  /** The commit backends' error lines; a commit failure is reported, never thrown away silently. */
  const errors = commitAll(context.config, d, "memory: project archive " + event.projectKey + " (" + event.kind + ")")
  return { key, file, superseded: previous !== undefined, errors }
}

/**
 * Build the digest one event renders, reading only the workspace's own files plus the team service.
 *
 * @param context - the per-call workspace, config and team service.
 * @param event - the event whose sources are read.
 * @returns the digest, with every unreadable source named in `unreadable`.
 */
function digestFor(context: ArchiveCallContext, event: ArchiveEvent): Digest {
  /** The kind-specific half of the digest. */
  const digest = event.kind === "boulder_complete"
    ? boulderDigest(context.workspace, event.projectKey)
    : event.kind === "cellwork_stop"
      ? cellDigest(context, event.projectKey)
      : planDigest(context, event)
  /** The workspace's verify-proof reading, which every event kind shares. */
  const proof = proofLines(context.workspace)
  digest.proof = proof.lines
  digest.unreadable.push(...proof.unreadable)
  return digest
}

/**
 * The digest of a completed boulder work, read from `.mpd/boulder.json` and its plan file.
 *
 * @param workspace - the workspace root.
 * @param workId - the completed work's id.
 * @returns the digest; an unreadable ledger or plan is named instead of guessed.
 */
function boulderDigest(workspace: string, workId: string): Digest {
  /** The digest being filled. */
  const digest: Digest = { objective: "boulder work " + workId, tasks: [], scopes: [], open: [], proof: [], unreadable: [] }
  /** The boulder ledger, read structurally: the digest needs identity and titles, not the full schema. */
  const ledger = readJsonFile(join(workspace, ".mpd", "boulder.json"))
  if (ledger.problem !== undefined) {
    digest.unreadable.push(".mpd/boulder.json (" + ledger.problem + ")")
    return digest
  }
  /** The ledger's work map, when the record carries one. */
  const works = ledger.value?.works
  /** The completed work's own record, from the `works` map (the ledger this tool writes). */
  const work = works !== null && typeof works === "object" && Object.prototype.hasOwnProperty.call(works, workId) ? works[workId] : undefined
  if (work === null || typeof work !== "object") {
    digest.unreadable.push(".mpd/boulder.json holds no work \"" + workId + "\"")
    return digest
  }
  /** The plan file the work is bound to, workspace-relative as the ledger stores it. */
  const planPath = textOf(work.active_plan)
  /** The work's plan name, which is its display name. */
  const planName = textOf(work.plan_name)
  /** The work's wall-clock duration, when the completion stamped one. */
  const elapsed = typeof work.elapsed_ms === "number" ? work.elapsed_ms : undefined
  digest.objective = "boulder work " + workId + (planName === "" ? "" : " (\"" + planName + "\")") + " completed" + (elapsed === undefined ? "" : " after " + String(elapsed) + "ms")
  /** The plan's own item reading, when the plan file is readable. */
  const items = planPath === "" ? undefined : planItems(join(workspace, planPath))
  if (items === undefined) {
    digest.unreadable.push(planPath === "" ? "the boulder work names no plan file" : planPath + " (unreadable)")
  } else {
    digest.tasks = capList(items.titles, 12)
    if (items.remaining > 0) digest.open.push(String(items.remaining) + " plan item(s) still unticked in " + planPath)
  }
  // The per-task timers are the ledger's own title record; they are the fallback when the plan file is
  // unreadable, and they also name a timer that never closed.
  /** The work's per-task timers, when the ledger carries them. */
  const timers = work.task_sessions !== null && typeof work.task_sessions === "object" ? work.task_sessions : undefined
  if (timers !== undefined) {
    for (const [key, timer] of Object.entries<any>(timers)) {
      /** The timer's recorded title, falling back to its plan key. */
      const title = textOf(timer?.task_title) || String(key)
      if (digest.tasks.length === 0) digest.tasks.push(title)
      /** The timer's lifecycle; only `completed` is closed. */
      const status = textOf(timer?.status)
      if (status !== "" && status !== "completed") digest.open.push("task timer " + String(key) + " (" + title + ") is " + status)
    }
  }
  // A boulder ledger declares no write scopes: the plan file is prose, not a scope list. The digest says
  // so through its empty `scopes`, which renders as "the event's sources declare no write scopes".
  return digest
}

/**
 * The digest of a stopped cell, read from `.mpd/cellwork/<cellId>/state.json`, the team record and the
 * cell's own split verdict.
 *
 * @param context - the per-call workspace and team service.
 * @param cellId - the archived cell's id.
 * @returns the digest; every source that could not be read is named.
 */
function cellDigest(context: ArchiveCallContext, cellId: string): Digest {
  /** The digest being filled. */
  const digest: Digest = { objective: "cell " + cellId, tasks: [], scopes: [], open: [], proof: [], unreadable: [] }
  /** The cell's archived state record. */
  const cell = readJsonFile(join(context.workspace, ".mpd", "cellwork", cellId, "state.json"))
  if (cell.problem !== undefined) {
    digest.unreadable.push(".mpd/cellwork/" + cellId + "/state.json (" + cell.problem + ")")
    return digest
  }
  /** The user's stated objective for the cell. */
  const objective = textOf(cell.value?.objective)
  /** Why the cell was stopped (the tool's `reason`, or its default). */
  const stopReason = textOf(cell.value?.stopReason)
  digest.objective = "cell " + cellId + (objective === "" ? "" : " (\"" + objective + "\")") + " stopped" + (stopReason === "" ? "" : ": " + stopReason)
  if (stopReason !== "") digest.open.push("stopReason: " + stopReason)
  /** The team the cell drove, when it approved one. */
  const teamId = textOf(cell.value?.teamId)
  /** The accepted split revision, when a split was ever accepted. */
  const splitRevision = typeof cell.value?.splitRevision === "number" ? cell.value.splitRevision : undefined
  // THE TEAM RECORD IS THE RICHEST SOURCE when the cell drove a team: it names the board titles, the
  // terminal states and the scopes the split declared.
  if (teamId !== "") {
    /** The team record, when the composition serves live records. */
    const record = context.teams?.get?.(context.workspace, teamId)
    if (record === undefined) digest.unreadable.push("the team record " + teamId + " (mpdTeams.get absent or unknown)")
    else mergeTeamRecord(digest, record)
  } else if (splitRevision !== undefined) {
    // No team: the cell's own split verdict is then the record of what was planned and what was refused.
    /** The measured split this cell accepted. */
    const split = readJsonFile(join(context.workspace, ".mpd", "cellwork", cellId, "split", String(splitRevision) + ".json"))
    if (split.problem !== undefined) digest.unreadable.push(".mpd/cellwork/" + cellId + "/split/" + String(splitRevision) + ".json (" + split.problem + ")")
    else mergeSplit(digest, split.value)
  } else {
    digest.unreadable.push("cell " + cellId + " approved no team and accepted no split — no task titles exist")
  }
  return digest
}

/**
 * The digest of an archived team plan, read from the archived `plan.json` plus the plan's team record.
 *
 * @param context - the per-call workspace and team service.
 * @param event - the plan-archive event, whose `plan` names the archived document and its team.
 * @returns the digest; an unreadable plan document is named instead of guessed.
 */
function planDigest(context: ArchiveCallContext, event: ArchiveEvent): Digest {
  /** The digest being filled. */
  const digest: Digest = { objective: "team plan " + (event.plan?.planId ?? event.projectKey), tasks: [], scopes: [], open: [], proof: [], unreadable: [] }
  /** The archived plan document, which is the approval record itself. */
  const plan = event.plan === undefined ? { problem: "the mpdTeams service named no plan document" } as JsonReading : readJsonFile(event.plan.path)
  if (plan.problem !== undefined) {
    digest.unreadable.push((event.plan?.path ?? "the archived plan") + " (" + plan.problem + ")")
  } else {
    /** The plan's display name. */
    const planName = textOf(plan.value?.name)
    /** What the plan was for, as the captain wrote it. */
    const description = textOf(plan.value?.description)
    digest.objective = "team plan " + textOf(plan.value?.planId) + (planName === "" ? "" : " (\"" + planName + "\")") + " approved at " + textOf(plan.value?.approvedAt) + " and archived"
    if (description !== "") digest.objective += ": " + description
    /** The staged tasks, from which the digest takes titles and declared scopes. */
    const staged = Array.isArray(plan.value?.tasks) ? plan.value.tasks : []
    digest.tasks = capList(staged.map((task: any): string => textOf(task?.subject)).filter((title: string): boolean => title !== ""), 12)
    digest.scopes = capList(uniqueStrings(staged.flatMap((task: any): string[] => Array.isArray(task?.writeScopes) ? task.writeScopes.map(textOf) : [])), 20)
    /** The staged blockers approval could not resolve, when the archived plan recorded any. */
    const unresolved = Array.isArray(plan.value?.created?.unresolved) ? plan.value.created.unresolved : []
    for (const row of unresolved) {
      /** The board task whose references did not resolve. */
      const taskId = textOf(row?.taskId)
      /** The references that named nothing on the board. */
      const references = Array.isArray(row?.references) ? row.references.map(textOf).filter((r: string): boolean => r !== "") : []
      if (taskId !== "" && references.length > 0) digest.open.push("unresolved blocker reference(s) on " + taskId + ": " + references.join(", "))
    }
  }
  // The live team record adds the board states the archived plan cannot know (what closed, what stayed open).
  if (context.teams === undefined) digest.unreadable.push("the team record (mpdTeams absent)")
  else {
    /** The team this plan became, when the listing still names it. */
    const teamId = textOf(event.plan?.teamId)
    /** The live team record, when the composition serves one. */
    const record = teamId === "" ? undefined : context.teams.get?.(context.workspace, teamId)
    if (record === undefined) digest.unreadable.push("the live team record " + (teamId === "" ? "(the plan names no team)" : teamId))
    else mergeTeamRecord(digest, record)
  }
  return digest
}

/**
 * Fold a live team record into a digest: task titles, declared scopes and the rows that stayed open.
 *
 * Merging never duplicates a title or a scope and never invents a status: a task whose status is
 * missing is counted as open with the status it actually carries.
 *
 * @param digest - the digest to extend, mutated in place.
 * @param record - the team record as the service reported it.
 * @returns nothing; the digest carries the result.
 */
function mergeTeamRecord(digest: Digest, record: TeamRecordView): void {
  /** The board tasks the record carries, when it carries any. */
  const tasks = Array.isArray(record.tasks) ? record.tasks : []
  /** The titles this record adds, before the digest's cap is applied. */
  const titles = digest.tasks.concat(tasks.map((task): string => textOf(task.subject)).filter((title: string): boolean => title !== ""))
  digest.tasks = capList(uniqueStrings(titles), 12)
  /** The scopes this record adds, before the digest's cap is applied. */
  const scopes = digest.scopes.concat(tasks.flatMap((task): string[] => Array.isArray(task.writeScopes) ? task.writeScopes.map(textOf) : []))
  digest.scopes = capList(uniqueStrings(scopes), 20)
  for (const task of tasks) {
    /** The task's own state; absent means "not recorded", which the digest states honestly. */
    const status = textOf(task.status)
    if (status === "completed") continue
    /** The ids this task still waits on. */
    const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy.map(textOf).filter((id: string): boolean => id !== "") : []
    digest.open.push(textOf(task.id) + (textOf(task.subject) === "" ? "" : " (" + textOf(task.subject) + ")") + " status=" + (status === "" ? "unknown" : status) + (blockedBy.length === 0 ? "" : ", blocked by " + blockedBy.join(", ")))
  }
}

/**
 * Fold a cell's measured split verdict into a digest: titles, declared scopes and the refused rows.
 *
 * @param digest - the digest to extend, mutated in place.
 * @param split - the parsed split verdict document.
 * @returns nothing; the digest carries the result.
 */
function mergeSplit(digest: Digest, split: any): void {
  /** The measured tasks the split verdict carries. */
  const tasks = Array.isArray(split?.tasks) ? split.tasks : []
  digest.tasks = capList(tasks.map((task: any): string => textOf(task?.subject)).filter((title: string): boolean => title !== ""), 12)
  digest.scopes = capList(uniqueStrings(tasks.flatMap((task: any): string[] => Array.isArray(task?.writeScopes) ? task.writeScopes.map(textOf) : [])), 20)
  for (const task of tasks) {
    if (task?.accepted === true) continue
    digest.open.push("split task " + textOf(task?.key) + " (" + textOf(task?.subject) + ") was not accepted")
  }
  /** The graph findings the split recorded, which are unresolved by construction. */
  const findings = Array.isArray(split?.findings) ? split.findings : []
  for (const finding of findings.slice(0, 5)) digest.open.push("split finding: " + textOf(finding?.message ?? finding?.kind))
}

/**
 * Read the workspace's verify-proof sources: recent loop ids, verdict records, evidence paths and the
 * gate table's identity.
 *
 * Every list is bounded to the five newest entries, so one archive event costs a bounded number of
 * reads. The gate table's identity is a sha256 of `mpd-gates.json` — the frozen table a verify loop
 * certifies against — and an absent table is stated as absent rather than reported as an empty hash.
 *
 * @param workspace - the workspace root.
 * @returns the proof lines plus the sources that could not be read.
 */
function proofLines(workspace: string): { lines: string[]; unreadable: string[] } {
  /** The rendered proof lines. */
  const lines: string[] = []
  /** The sources that could not be read. */
  const unreadable: string[] = []
  /** The verify ledger's root, which every proof source hangs from. */
  const verify = join(workspace, ".mpd", "verify")
  // The three listings share one shape: newest-first file names, at most five of each.
  /** The newest verify loop records. */
  const loops = newestJsonFiles(join(verify, "loops")).slice(0, 5)
  if (loops.length === 0) lines.push("no verify loops recorded under .mpd/verify/loops")
  for (const name of loops) {
    /** One loop record's reading. */
    const loop = readJsonFile(join(verify, "loops", name))
    if (loop.problem !== undefined) { unreadable.push(".mpd/verify/loops/" + name + " (" + loop.problem + ")"); continue }
    lines.push("verify loop " + textOf(loop.value?.loopId) + " status=" + (textOf(loop.value?.status) || "unknown") + (textOf(loop.value?.verifier?.id) === "" ? "" : " verifier=" + textOf(loop.value?.verifier?.id)))
  }
  /** The newest verdict records. */
  const records = newestJsonFiles(join(verify, "records")).slice(0, 5)
  if (records.length === 0) lines.push("no verdict records under .mpd/verify/records")
  for (const name of records) {
    /** One verdict record's reading. */
    const record = readJsonFile(join(verify, "records", name))
    if (record.problem !== undefined) { unreadable.push(".mpd/verify/records/" + name + " (" + record.problem + ")"); continue }
    lines.push("verdict " + textOf(record.value?.recordId) + " " + (textOf(record.value?.verdict) || "unknown") + (textOf(record.value?.loopId) === "" ? "" : " on " + textOf(record.value?.loopId)))
  }
  /** The newest evidence metadata rows, named by path so a verifier can open them. */
  const evidence = newestJsonFiles(join(verify, "evidence")).slice(0, 5)
  if (evidence.length === 0) lines.push("no evidence rows under .mpd/verify/evidence")
  for (const name of evidence) lines.push("evidence .mpd/verify/evidence/" + name)
  /** The workspace gate table the verify tool freezes for a loop. */
  const gatesPath = join(workspace, "mpd-gates.json")
  if (!existsSync(gatesPath)) lines.push("gate table mpd-gates.json absent (the built-in gate table applies)")
  else {
    try {
      /** The gate table's bytes, hashed for the identity this digest records. */
      const bytes = readFileSync(gatesPath)
      lines.push("gate table mpd-gates.json sha256=" + createHash("sha256").update(bytes).digest("hex") + " bytes=" + String(bytes.length))
    } catch (error) {
      unreadable.push("mpd-gates.json (" + String((error as Error)?.message ?? error) + ")")
    }
  }
  return { lines, unreadable }
}

/**
 * Read a markdown plan's top-level item titles and how many are unticked.
 *
 * Two grammars, the same ones the boulder reader uses: a plan carrying a `## TODOs` or
 * `## Final Verification Wave` heading is read STRUCTURALLY (only that section's checkboxes count),
 * and any other plan falls back to every top-level checkbox. Fenced code is skipped so a plan that
 * quotes the syntax is not miscounted.
 *
 * @param planPath - the absolute plan file path.
 * @returns the item reading, or `undefined` when the file cannot be read.
 */
function planItems(planPath: string): PlanItems | undefined {
  /** The plan's text, or undefined when it cannot be read at all. */
  let text: string
  try { text = readFileSync(planPath, "utf8") } catch { return undefined }
  /** The titles found, in plan order. */
  const titles: string[] = []
  /** How many of those items were unticked. */
  let remaining = 0
  /** Which structured section the scan is in; `other` counts nothing until a fallback decides. */
  let section: "todo" | "final-wave" | "other" = "other"
  /** Whether the plan carried either structured heading, which decides whether the fallback applies. */
  let structured = false
  /** The open code fence, so fenced content is skipped. */
  let fence = ""
  for (const line of text.split("\n")) {
    /** The fence opener this line is, if any. */
    const opener = FENCE_OPEN.exec(line)
    if (opener !== null) {
      if (fence === "") fence = opener[1]
      else if (line.trimStart().startsWith(fence)) fence = ""
      continue
    }
    if (fence !== "") continue
    if (TODO_HEADING.test(line)) { section = "todo"; structured = true; continue }
    if (FINAL_WAVE_HEADING.test(line)) { section = "final-wave"; structured = true; continue }
    if (SECTION_BOUNDARY.test(line)) { section = "other"; continue }
    /** The checkbox this line is, if any. */
    const box = CHECKBOX_ITEM.exec(line)
    if (box === null) continue
    if (structured && section === "other") continue
    /** The item text with its bullet and box removed. */
    const label = box[2].trim()
    if (label === "") continue
    titles.push(label)
    if (box[1] === "") remaining += 1
  }
  return { titles, remaining }
}

/**
 * Find the archived plan one delete wrote, matched by its archive DIRECTORY (never by recency).
 *
 * @param context - the per-call workspace and team service.
 * @param archivedTo - the archive directory the delete reported.
 * @param log - the diagnostic sink for a listing that does not contain the reported directory.
 * @returns the matching plan, or `undefined` when the listing cannot identify it.
 */
function findArchivedPlan(context: ArchiveCallContext, archivedTo: string, log: (line: string) => void): ArchivedPlanView | undefined {
  /** The reported archive directory, resolved for comparison with the listing's absolute paths. */
  const dir = resolve(archivedTo)
  // The service is documented non-throwing, but a memory hook must survive a broken listing anyway.
  /** The workspace's archived plans, or none when the listing failed. */
  let plans: ArchivedPlanView[] = []
  try { plans = context.teams?.archivedPlans(context.workspace) ?? [] } catch { plans = [] }
  /** The plan whose own document sits inside the reported directory. */
  const match = plans.find((plan): boolean => dirname(resolve(plan.path)) === dir)
  if (match === undefined) log("agent_teams_plan reported archive " + dir + " but the mpdTeams listing does not contain it — no project memory was written")
  return match
}

/**
 * Render one digest as the markdown body every archived entry carries.
 *
 * @param event - the event the digest describes.
 * @param workspace - the workspace the project lived in.
 * @param at - the ISO instant of the write.
 * @param digest - the digest to render.
 * @returns the entry body, ending with a newline.
 */
function renderDigest(event: ArchiveEvent, workspace: string, at: string, digest: Digest): string {
  /** The rendered lines, joined at the end. */
  const lines: string[] = []
  lines.push("# " + event.projectKey)
  lines.push("")
  lines.push("event: " + event.kind)
  lines.push("workspace: " + resolve(workspace))
  lines.push("archived: " + at)
  lines.push("")
  lines.push("## What was built")
  lines.push(digest.objective)
  if (digest.tasks.length === 0) lines.push("- no task titles in the readable sources above")
  for (const task of digest.tasks) lines.push("- " + task)
  lines.push("")
  lines.push("## Proof")
  for (const line of digest.proof) lines.push("- " + line)
  lines.push("")
  lines.push("## Where")
  if (digest.scopes.length === 0) lines.push("- the event's sources declare no write scopes")
  for (const scope of digest.scopes) lines.push("- " + scope)
  lines.push("")
  lines.push("## Open")
  if (digest.open.length === 0) lines.push("- nothing unresolved in the sources this digest could read")
  for (const item of digest.open) lines.push("- " + item)
  if (digest.unreadable.length > 0) {
    lines.push("")
    lines.push("## Unreadable")
    for (const item of digest.unreadable) lines.push("- " + item)
  }
  return lines.join("\n") + "\n"
}

/**
 * The frontmatter every global archive entry carries: a `fact`, scoped `global`, tagged
 * `project`/`archive`/<eventKind> — exactly the vocabulary the contract fixes for the digest.
 *
 * @param event - the event the entry records.
 * @returns the serialized JSON frontmatter block, including its closing delimiter and newline.
 */
function frontmatterFor(event: ArchiveEvent): string {
  /** The metadata record serialized as the file's JSON frontmatter block. */
  const meta = { description: "project archive: " + event.projectKey + " (" + event.kind + ")", kind: "fact", scope: "global", tags: ["project", "archive", event.kind] }
  return "---\n" + JSON.stringify(meta) + "\n---\n"
}

/**
 * Read the global store's project index, tolerating a missing, unparseable or foreign-version file.
 *
 * @param d - the global store's directories.
 * @returns the index; anything unreadable starts an empty one, because a lost index must not block a write.
 */
function readIndex(d: StoreDirs): GlobalIndex {
  /** The index file's reading. */
  const reading = readJsonFile(join(d.runtime, "index.json"))
  if (reading.problem !== undefined || reading.value?.version !== 1 || reading.value?.entries === null || typeof reading.value?.entries !== "object") {
    return { version: 1, entries: {} }
  }
  return { version: 1, entries: reading.value.entries as Record<string, GlobalIndexEntry> }
}

/**
 * Persist the global store's project index, pretty-printed so a human can read the rows.
 *
 * @param d - the global store's directories.
 * @param index - the whole document to write.
 * @returns nothing; an unwritable runtime directory surfaces as the thrown IO error.
 */
function writeIndex(d: StoreDirs, index: GlobalIndex): void {
  writeFileSync(join(d.runtime, "index.json"), JSON.stringify(index, null, 2))
}

/**
 * Read one JSON file without throwing.
 *
 * @param path - the absolute file path.
 * @returns the parsed value, or the reason it could not be read.
 */
function readJsonFile(path: string): JsonReading {
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) }
  } catch (error) {
    /** The OS/parse message, which names a missing file or a malformed one. */
    const message = String((error as Error)?.message ?? error)
    return { problem: message.includes("ENOENT") ? "absent" : message }
  }
}

/**
 * List one directory's `*.json` file names, newest first.
 *
 * @param dir - the absolute directory path.
 * @returns the file names; a missing or unreadable directory lists as none.
 */
function newestJsonFiles(dir: string): string[] {
  try { return readdirSync(dir).filter((name): boolean => name.endsWith(".json")).sort().reverse() } catch { return [] }
}

/**
 * Read one value as trimmed text.
 *
 * @param value - the value to read, of any type.
 * @returns the text, or `""` when the value is not a non-empty string.
 */
function textOf(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : ""
}

/**
 * Deduplicate and sort strings, dropping empties.
 *
 * @param items - the strings to fold, in source order.
 * @returns the unique non-empty strings, sorted for a deterministic digest.
 */
function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter((item: string): boolean => item !== ""))).sort()
}

/**
 * Cap a rendered list, stating how many entries were left out instead of dropping them silently.
 *
 * @param items - the list to cap.
 * @param max - the most entries the digest renders.
 * @returns the list, or a truncated copy whose last entry counts the remainder.
 */
function capList(items: string[], max: number): string[] {
  return items.length <= max ? items : [...items.slice(0, max), "… and " + String(items.length - max) + " more"]
}

/**
 * The file-name slug of one project key: lowercase ASCII, hyphen-separated, bounded.
 *
 * @param key - the project key (a work id, a cell id or a team id).
 * @returns the slug, or `project` when nothing usable remains.
 */
function slugForFile(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project"
}

/**
 * A short, stable hash of one workspace path, so two workspaces with the same project key never share
 * a file even though their entries already differ by that path.
 *
 * @param text - the text to hash (the resolved workspace root).
 * @returns eight lowercase hex characters.
 */
function shortHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 8)
}
