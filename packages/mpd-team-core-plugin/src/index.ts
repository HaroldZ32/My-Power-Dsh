// mpd-team-core-plugin: the team RECORD and the team WORKFLOW the official Agent Teams plugin does not ship.
//
// WHY THIS EXISTS. Harness 0.1.7-rc.2 replaced the vendored `agent-teams` body with an official
// plugin that owns the RUNTIME — roster, shared board, mailbox, continuable teammates — and
// nothing else. The retired body also carried a WORKFLOW around that runtime: a team staged as a
// plan the user can read, edit and approve before anybody exists; a task contract frozen at claim
// time with a monotonic attempt counter; a halt that stops new dispatch without ending the team;
// and an archive instead of a delete. Every one of those is a deliberate review point, and none
// of them has a field on the official service, so they live here as a SIDECAR:
//
//   <workspace>/.mpd/team/staging/<sessionId>.json   the staged plan
//   <workspace>/.mpd/team/contracts/<taskId>.json    the frozen contract + attempt
//   <workspace>/.mpd/team/hold.json                  the halt
//   <workspace>/.mpd/team/dispatch.json              the dispatch ledger (who is working what)
//   <workspace>/.mpd/team/archive/<planId>/          what was staged, kept
//
// THE RECORD IS THE AUTHORITATIVE TEAM TRUTH. The roster and the board live in
// `.mpd/team/teams/<teamId>.json`, written and read by THIS row; the official Agent Teams service is
// the FALLBACK for a composition that runs the official executor (reached only through the adapter's
// `dsh.team*` seams), and NO mpd surface treats `dsh.teamLiveTeams()` as truth. The sidecar files
// below are the workflow state AROUND that record, never a second copy of it.
//
// NAMING. The tools keep the retired `agent_teams_*` names on purpose. They are the vocabulary
// this bundle's captains, skills and docs already use, and a plan/task contract is the same
// concept under either implementation — the alternative (inventing new names for old ideas) is
// what makes a migration unreadable.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { rowLogLine, createLazyDshAdapter, dshSeamInject, DSH_SEAM_COMMANDS, DSH_SEAM_TOOLS, type DshAdapter, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  inboxOf,
  markDelivered,
  markRead,
  readMailbox,
  send as sendMail,
  summarise,
  undeliveredOf,
  unreadOf as unreadMessages,
} from "./mailbox-store"
import {
  assign,
  dispatchMessage,
  forgetTeam,
  isReadonlyMemberName,
  ledgerKey,
  ledgerOfTeam,
  planDispatch,
  readonlyMemberKeys,
  reconcile,
  release,
  type DispatchLedger,
  type RosterRow,
} from "./dispatch"
import {
  addMember,
  addTask,
  archivePlan,
  claimContract,
  classifyBlocker,
  clearHold,
  listContracts,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  writePlan,
  type BlockerForm,
  type StagedMember,
  type StagedPlan,
  type StagedTask,
} from "./plan-store"
// THE DEPENDENCY GUARD (R1–R3 of `.mpd/plans/task-dependency-guard.md`): the pure decisions behind the
// three refusals. The alias/argument READING stays here, at the tool boundary, because it is about the
// wire shape; the graph and scope reasoning lives in its own module so `create_task`, `approve` and
// `claim` cannot drift into three definitions of "ready" or "overlapping".
import { boardDependencyEdges, dependencyCycle, dependencyPath, planDependencyEdges, planGraphDefect, planReferenceTarget, planTaskId, scopeClashes } from "./dependency-guard.ts"
import { installTeamDoorGuard } from "./team-door-guard.ts"
import { planForSession, registerTeamRoutes, TEAM_ROUTES, type TeamWebPlan } from "./team-web"
import { installIdleGuard, withIdlePreamble } from "./idle-guard"
import { GraphModels } from "./graph-model"
import type { GraphModel } from "../../mpd-graph-core/src/index.ts"
import { ChangeFeed } from "./change-feed"
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  authorizeRelease,
  bindActiveTeam,
  blockingDependencies,
  casClaimTask,
  casCloseTask,
  casReleaseTask,
  createTeam,
  idleMembers,
  memberNamedBy,
  readyTasks,
  deleteTeam,
  derivePhase,
  listTeams,
  losslessSummary,
  memberProgress,
  onTeamStateWritten,
  readTeam,
  recordNamesLead,
  recordNamesMember,
  resolveBlockers,
  settleMember,
  rememberLead,
  summariseTeam,
  taskDepths,
  removeTeamMember,
  taskVisual,
  unbindActiveTeam,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
  TASK_KINDS,
  type TaskKind,
  type TeamMemberRecord,
  type TeamRecord,
  type TeamTaskRecord,
} from "./team-store"
import {
  isLiveTeam,
  readArchivedPlanIndex,
  reapReapedTeams,
  resolveTeamRecord,
  type TeamResolution,
} from "./team-lifecycle"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-team-core"
// INJECT: the TOOLS and COMMANDS seams (both resolved through the adapter, never on the raw
// ctx — the D6 gate polices that) and NOT the team plane itself: `ctx.agentTeams` is reached
// exclusively through `dsh.team*`, so a harness rename lands in the adapter. The two NAMES come
// from the adapter's seam vocabulary, so a renamed harness service is an edit in ONE file.
export const inject: string[] = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)

/**
 * The service id this row publishes: the bundle's OWN team read surface.
 *
 * Every mpd surface that used to reconstruct a team from `dsh.teamLiveTeams()` — the TUI scenes,
 * the web panel, the watchdog, the workmate in-use gate — resolves this instead. It is the seam
 * that makes the separation real: a consumer reads the mpd record and never asks the official
 * plane what the team is, so the team plane survives a composition where the official service is
 * absent or unmountable (which is exactly the `dsh-tui` case).
 */
export const TEAMS_SERVICE = "mpdTeams"

/** The read surface published as {@link TEAMS_SERVICE}; every member is synchronous and non-throwing. */
export interface MpdTeamsService {
  /** Every team this workspace holds, newest first. */
  list: (workspace: string) => TeamRecord[]
  /** One team by id, or undefined. */
  get: (workspace: string, teamId: string) => TeamRecord | undefined
  /** The team bound to one Lead session, or undefined when that session has none. */
  active: (workspace: string, sessionId?: string) => TeamRecord | undefined
  /** The tallies, edges, cycles and per-task rank of one team. */
  summary: (record: TeamRecord) => ReturnType<typeof summariseTeam>
  /** The visual state a renderer draws for one task of one team (`blocked` is derived here). */
  visual: (record: TeamRecord, taskId: string) => string
  /** The completed/total counts and the current task of one member. */
  progress: (record: TeamRecord, name: string) => ReturnType<typeof memberProgress>
  /** The team ids this workspace holds, so a gate can ask "is any of these live?" without reading. */
  teamIds: (workspace: string) => string[]
  /** The member display names of one team, which is what the workmate in-use gate matches on. */
  memberNames: (workspace: string) => string[]
  /**
   * The STAGED PLAN of one session — what exists BEFORE an approval — or a null-plan payload.
   *
   * THE SAME PROJECTION THE `/plan` ROUTE SERVES, deliberately: a surface that re-read the staging
   * file itself would be a second implementation of both the projection and the approval gate, free to
   * drift from the Web panel's. This is the shared half; a surface only decides how to DRAW it.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose staged plan is wanted.
   * @returns the payload, with `plan: null` when that session has nothing staged.
   */
  planFor: (workspace: string, sessionId: string) => TeamWebPlan
  /**
   * The ONE graph model both planes draw, computed here with the shared core.
   *
   * ADDRESSED BY TEAM, not by session: `teamId` GIVEN returns that team's model (the TUI passes the id
   * of the record it just read), and OMITTED returns the workspace principal's — the session-less
   * fallback. A workspace-scoped answer would put one team's plan-only ghosts into another team's DAG.
   * @param workspace - the caller's workspace root.
   * @param teamId - the team to draw, or undefined for the workspace principal.
   * @returns the same value the web payload carries, or undefined when that team is not on disk.
   */
  graph: (workspace: string, teamId?: string) => GraphModel | undefined
  /** Subscribe to change notifications for one workspace; the returned disposer is idempotent. */
  subscribe: (workspace: string, listener: () => void) => () => void
  /** A monotonically increasing revision of one workspace's team state; 0 before any change is seen. */
  revision: (workspace: string) => number
  /**
   * Exempt ONE session from the idle-member guard — the explicit registration a cell's dispatcher or a
   * promoted subcaptain needs (never a name prefix, so an ordinary member cannot inherit it by being
   * named `cell-*`).
   *
   * The caller is the row that OWNS the seat (cellwork registers its dispatcher at staging and its
   * promoted subcaptain at promotion) and must call the returned release when the seat ends. Idempotent:
   * registering the same session twice leaves one exemption.
   * @param sessionId - the exempt session's id.
   * @returns the release for that exemption.
   */
  registerControlSeat: (sessionId: string) => () => void
}

/** A tool result narrow enough for the adapter's renderer. */
const text = (value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]

/**
 * The watchdog's answer for one session's team.
 *
 * THREE STATES, because two cannot be honest: `held` refuses the dispatch pass, `free` lets it
 * through, and `not-readable` lets it through WHILE SAYING SO — a hold that cannot be read is
 * reported as `not-readable`, never as a hold, so a broken reader can neither park a team nor lie
 * about why it did.
 */
export interface WatchdogHoldRead {
  /** What the watchdog service answered. */
  state: "held" | "free" | "not-readable"
  /** Why, for `held` and `not-readable`; absent for `free`. */
  reason?: string
}

/**
 * What one task release did: both halves a release must free, plus the refusal when a half would not.
 *
 * A release is TWO writes now (R3): the dispatch ledger row and the task row. Either half can be
 * absent on its own — a task claimed through `agent_teams_task` never had a ledger row, and a ledger
 * row can outlive a row that reached a terminal status out of band — so the result reports each half
 * rather than folding them into one boolean.
 */
export interface TaskReleaseResult {
  /** True when a ledger pairing was actually there and was freed. */
  released: boolean
  /** The task the call named. */
  taskId: string
  /** The task's status AFTER the reset (`pending` on success); absent when the row refused. */
  status?: string
  /** The task's revision after the reset, so a caller can chain a claim against it. */
  revision?: number
  /** Why the TASK row would not reset; the ledger half is still reported beside it. */
  refused?: string
}

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
function readLedger(workspace: string): DispatchLedger {
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
function writeLedger(workspace: string, ledger: DispatchLedger): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  /** The sibling temp file this write lands in before the rename. */
  const temp = dispatchPath(workspace) + ".tmp-" + process.pid
  writeFileSync(temp, JSON.stringify(ledger, null, 2) + "\n")
  renameSync(temp, dispatchPath(workspace))
}

/** The rendered one-line summary of a staged plan. */
function describePlan(plan: StagedPlan | undefined): string {
  if (plan === undefined) return "no staged plan"
  /** The plan's lifecycle word, derived in approval-before-discard order so it cannot be both. */
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged"
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`
}

/**
 * One raw board field as text, or `-` when it is absent.
 *
 * A `status` call may answer from the mpd record (every field present) or, in a composition with no
 * record, from the official readout whose rows carry a different vocabulary — so the renderer reads
 * every field defensively instead of assuming the record's shape.
 * @param value - the raw value at one key.
 * @returns the string form, or `-` when the key carries nothing printable.
 */
function fieldText(value: unknown): string {
  if (typeof value === "string") return value === "" ? "-" : value
  return typeof value === "number" ? String(value) : "-"
}

/**
 * The task line the `status` render prints: id, owner, status, kind, blockedBy and subject.
 *
 * THE LINE IS THE POINT (contract: team-tool plan surface §1). The status VALUE always carried the
 * full task records, but the printed form was one summary line, so a flat board and a wired one
 * looked identical to the operator staging the wave.
 * @param task - one raw board row, from either plane.
 * @returns the single-line description.
 */
function describeTaskLine(task: unknown): string {
  /** The row read as a record, because the value crosses a tool boundary untyped. */
  const row = (task ?? {}) as Record<string, unknown>
  /** The blocker entries that can be printed; an empty or absent list renders as `-`. */
  const blockedBy = Array.isArray(row.blockedBy) ? row.blockedBy.map(String).filter((entry) => entry !== "") : []
  /** The subject, quoted so a multi-word title stays one readable field. */
  const subject = typeof row.subject === "string" ? JSON.stringify(row.subject) : JSON.stringify("")
  return `task id=${fieldText(row.id)} owner=${fieldText(row.owner)} status=${fieldText(row.status)} kind=${fieldText(row.kind)} blockedBy=${blockedBy.length === 0 ? "-" : blockedBy.join(",")} subject=${subject}`
}

/**
 * The full `status` render: the established summary line, then one line per member and per task.
 * @param value - the status branch's value.
 * @returns the multi-line text a caller reads.
 */
function describeStatus(value: unknown): string {
  /** The status payload read as a record. */
  const board = (value ?? {}) as Record<string, unknown>
  /** The roster rows, from whichever plane answered. */
  const members = Array.isArray(board.members) ? board.members : []
  /** The board rows, from whichever plane answered. */
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  /** The staged/approved plan, when this session has one. */
  const plan = (board.plan ?? {}) as Record<string, unknown>
  /** The summary line's plan id, or `(none)` when nothing is staged. */
  const planId = typeof plan.planId === "string" && plan.planId !== "" ? plan.planId : "(none)"
  /** The one-line summary the status view always printed, kept as the heading. */
  const summary = `plan ${planId} · members ${members.length} · tasks ${tasks.length} · hold ${board.hold === null || board.hold === undefined ? "none" : "held"}`
  /** The heading followed by one line per member and one per task. */
  const lines = [summary]
  for (const member of members) {
    /** One member row read as a record. */
    const row = (member ?? {}) as Record<string, unknown>
    lines.push(`member id=${fieldText(row.id)} name=${fieldText(row.name)} status=${fieldText(row.status)}`)
  }
  for (const task of tasks) lines.push(describeTaskLine(task))
  return lines.join("\n")
}

/**
 * The `depend` render: the row's edge set after the call, plus a loud line for references that name
 * nothing on this board.
 *
 * The unresolved half is the same R21 discipline the write-time blocker reading follows: the text is
 * KEPT verbatim on the row (it is the only record of what the caller meant), so the answer must say
 * out loud that it drew no edge instead of letting it read as a real one.
 * @param value - the depend branch's value.
 * @returns the single-line text a caller reads.
 */
function describeDepend(value: unknown): string {
  /** The answer read as a record. */
  const answer = (value ?? {}) as Record<string, unknown>
  /** The updated row this call echoes. */
  const task = (answer.task ?? {}) as Record<string, unknown>
  /** The row's blockers after the call, in stored order. */
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy.map(String).filter((entry) => entry !== "") : []
  /** The stored references that matched no task id and no subject. */
  const unresolved = Array.isArray(answer.unresolved) ? answer.unresolved.map(String) : []
  /** How many edges this call actually appended. */
  const added = Array.isArray(answer.added) ? answer.added.length : 0
  /** The row's edge set as text; `-` when it carries none. */
  const edges = blockedBy.length === 0 ? "-" : blockedBy.join(",")
  /** The edge sentence, naming a no-op as a no-op rather than a silent success. */
  const outcome = answer.idempotent === true ? "unchanged; the reference was already an edge" : `appended ${added} edge(s)`
  return `${fieldText(answer.taskId)} blockedBy=[${edges}] (${outcome})` + (unresolved.length === 0 ? "" : ` — WARNING: ${unresolved.join(", ")} name(s) no task on this board; kept verbatim`)
}

/**
 * The staged-plan render: the summary line, then one line per staged task.
 *
 * STAGED ROWS HAVE NO ID — approval mints `T1…` when the task reaches the board — so the id column
 * prints `-` rather than a number the record may later contradict. The lines carry subject, owner and
 * blockedBy, which is the DAG a captain needs to see BEFORE approving.
 * @param plan - the staged plan to render, or undefined when none is staged.
 * @returns the multi-line text a caller reads.
 */
function describeStagedPlan(plan: StagedPlan | undefined): string {
  if (plan === undefined) return "no staged plan"
  /** One line per staged task, in plan order. */
  const lines = plan.tasks.map((task) => {
    /** The blockers as written, or `-` when the task carries none. */
    const blockedBy = (task.blockedBy ?? []).filter((entry) => entry !== "")
    return `staged task id=- owner=${task.owner ?? "-"} blockedBy=${blockedBy.length === 0 ? "-" : blockedBy.join(",")} subject=${JSON.stringify(task.subject)}`
  })
  return [describePlan(plan), ...lines].join("\n")
}

/**
 * One list argument as a string array, or `undefined` when the caller sent no list at that key.
 *
 * The tool surface reads its arguments defensively (the registered parameter schema is advisory —
 * the harness's strict argument validation belongs to the typed `defineTool` path, not to the
 * `tools.register` seam this row uses), so every list is normalised here before it reaches a store.
 *
 * @param value - the raw argument at one key, of unknown shape.
 * @returns the entries as strings, or `undefined` when the key held no array.
 */
function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined
}

/**
 * Parse the `kind` a `create_task` call carries, refusing a word the board does not know.
 *
 * PARSE-DON'T-VALIDATE at the tool boundary (C7-4 F1): the requirement chain is a typed vocabulary, and
 * silently storing a typo would make a `repair` row indistinguishable from a typo'd one. An absent value
 * answers `undefined` so the store's own `work` default applies.
 * @param value - the raw argument at `task.kind` or its top-level alias.
 * @returns the parsed kind, or undefined when the caller sent none.
 * @throws when the value is not one of the five known kinds.
 */
function parseTaskKind(value: unknown): TaskKind | undefined {
  if (value === undefined || value === null || value === "") return undefined
  /** The word as the caller wrote it. */
  const text = String(value)
  if (!TASK_KINDS.includes(text as TaskKind)) throw new Error(`unknown task kind "${text}" (${TASK_KINDS.join(" | ")})`)
  return text as TaskKind
}

/**
 * Read a written blocker list back to the caller, one entry per reference, in written order.
 *
 * The WRITE-TIME half of R21: `agent_teams_plan {action:"create_task"}` answers with this, so a captain
 * learns what their text means while they are still writing the plan, instead of meeting it at approval
 * time as a board whose graph quietly flattened. Nothing here refuses a reference — a forward position
 * is legitimate — the reading only names the form.
 * @param plan - the plan as it stands, including the task just appended.
 * @param references - the references exactly as the caller wrote them.
 * @returns one `{ reference, form }` entry per reference, in order.
 */
function blockerReading(plan: StagedPlan, references: readonly string[]): Array<{ reference: string; form: BlockerForm }> {
  return references.map((reference) => ({ reference, form: classifyBlocker(plan, reference) }))
}

/**
 * The sentence the write-time reading prints: what resolved, and what named nothing this plan can
 * resolve. An empty string when every reference read as a form the approval can resolve.
 * @param blockers - the reading the tool is returning.
 * @returns one line, or `""` when nothing needs saying.
 */
function blockerSentence(blockers: unknown): string {
  if (!Array.isArray(blockers) || blockers.length === 0) return ""
  /** The entries whose form names nothing this plan can resolve. */
  const unknown = blockers.filter((entry: { form?: string }) => entry?.form === "unknown").map((entry: { reference?: string }) => String(entry?.reference ?? ""))
  /** The forms seen, in written order, so the answer shows how the rest WILL resolve. */
  const forms = [...new Set(blockers.map((entry: { form?: string }) => String(entry?.form ?? "?")))].join("/")
  if (unknown.length === 0) return ` — blocked_by reads as ${forms}`
  return ` — WARNING: blocked_by ${unknown.map((reference) => `"${reference}"`).join(", ")} name(s) no task this plan can resolve (only a position like "2", a staged subject, or a board id like "T2" resolves); approval will report it and draw no edge`
}

/**
 * Describe one wire value for a refusal message, bounded so a long argument cannot bloat the sentence.
 * @param value - the raw argument at one key, of unknown shape.
 * @returns a short human reading of what the caller actually sent.
 */
function describeWireValue(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return `an array of ${value.length}`
  if (typeof value === "object") return "an object"
  if (typeof value === "string") return value.length > 60 ? `a string ${JSON.stringify(value.slice(0, 60) + "…")}` : `a string ${JSON.stringify(value)}`
  return `a ${typeof value} (${String(value)})`
}

/** One `blocked_by` spelling exactly as the wire carried it, kept so a disagreement can name both sides. */
interface BlockerDeclaration {
  /** The argument path the caller used, spelled the way the tool documents it. */
  spelling: string
  /** The raw value at that path, of unknown shape. */
  value: unknown
}

/**
 * The task a `create_task` call is about to mint, named the way every R1 refusal names it (R4).
 * @param nextId - the id the call would mint (`T<n>`, the position approval mints).
 * @param subject - the subject as the caller wrote it.
 * @returns the `T1 ("subject")` form the refusal quotes.
 */
function namedTask(nextId: string, subject: string): string {
  return `${nextId} (${JSON.stringify(subject)})`
}

/**
 * Read the ONE dependency answer a `create_task` call must state (R1).
 *
 * The answer is either `blocked_by: [...]` — an array, possibly EMPTY, which is an explicit declaration
 * of independence — or `independent: true`. Every refusal here is deliberate:
 *   · a NON-ARRAY list is refused instead of dropped, because dropping it is exactly how the measured
 *     defect let a task become independently ready when its caller meant otherwise;
 *   · two aliases carrying DIFFERENT lists are refused instead of letting the nested one silently win;
 *   · a non-empty list beside `independent: true` is a contradiction, not an answer;
 *   · no answer at all is refused, because an edge is never inferred (`Out of scope`: a captain that
 *     does not know its DAG is asked, never guessed for).
 * @param raw - the `task` object as the caller sent it.
 * @param args - the whole tool arguments, which carry the top-level aliases.
 * @param nextId - the id this call would mint.
 * @param subject - the subject this call would store.
 * @returns the declared blockers (empty for a genuine root).
 * @throws when the call carries no answer, a non-array list, disagreeing aliases or a contradiction.
 */
function readDependencyAnswer(raw: Record<string, unknown>, args: any, nextId: string, subject: string): string[] {
  /** The task every refusal below names, so a caller never reads a bare "invalid". */
  const task = namedTask(nextId, subject)
  /** Every alias the call supplied, in the order the tool documents them. */
  const declarations: BlockerDeclaration[] = []
  if (raw.blocked_by !== undefined) declarations.push({ spelling: "task.blocked_by", value: raw.blocked_by })
  if (raw.blockedBy !== undefined) declarations.push({ spelling: "task.blockedBy", value: raw.blockedBy })
  if (args?.blocked_by !== undefined) declarations.push({ spelling: "blocked_by", value: args.blocked_by })
  for (const declaration of declarations) {
    if (Array.isArray(declaration.value)) continue
    throw new Error(`create_task for ${task} was given a NON-ARRAY blocked_by at ${declaration.spelling} (${describeWireValue(declaration.value)}): a non-array is never silently dropped. Fix: send an array of references — blocked_by: [] for a genuine root, or blocked_by: ["<blocker id or subject>"] — or independent: true, which is the only other accepted spelling.`)
  }
  /** Each supplied alias as a string list, so two of them can be compared. */
  const lists = declarations.map((declaration) => ({ spelling: declaration.spelling, list: (declaration.value as unknown[]).map(String) }))
  if (lists.length > 1) {
    // The FIRST supplied alias is the reference the others are measured against; which one wins is not
    // the point — any disagreement is refused, so no alias can quietly override another.
    /** The first spelling, and the first other spelling that disagrees with it. */
    const [first, ...rest] = lists
    /** The first disagreeing alias, if any. */
    const disagreement = rest.find((candidate) => candidate.list.length !== first.list.length || candidate.list.some((entry, at) => entry !== first.list[at]))
    if (disagreement !== undefined) {
      throw new Error(`create_task for ${task} was given TWO disagreeing spellings of blocked_by: ${first.spelling} reads ${JSON.stringify(first.list)} while ${disagreement.spelling} reads ${JSON.stringify(disagreement.list)}. All three spellings (task.blocked_by, task.blockedBy and top-level blocked_by) are accepted, but they must state ONE answer: send the list in a single spelling (or make both agree), or independent: true for a genuine root.`)
    }
  }
  /** Whether the caller declared independence with the boolean spelling. */
  const independent = raw.independent === true || args?.independent === true
  /** The declared blockers, or undefined when the caller supplied no list at all. */
  const blockedBy = lists.length === 0 ? undefined : lists[0].list
  if (blockedBy === undefined && !independent) {
    throw new Error(`create_task for ${task} must state its DEPENDENCY ANSWER: send blocked_by: [...] — an array, possibly [] for a genuine root — or independent: true. Nothing was staged and no edge was guessed for you, because a captain that does not know its DAG is asked, never guessed for. Fix: send blocked_by: [] for a genuine root, or list what must close first — blocked_by: ["<blocker id or subject>"] — or independent: true.`)
  }
  if (independent && blockedBy !== undefined && blockedBy.length > 0) {
    throw new Error(`create_task for ${task} is CONTRADICTORY: blocked_by is non-empty (${JSON.stringify(blockedBy)}) while independent: true says the task has no blockers. Fix: either keep the blockers and drop independent: true, or drop the list and send blocked_by: [] if this task really is a root.`)
  }
  return blockedBy ?? []
}

/**
 * Refuse a self-reference or a cycle before the prospective graph is written (R1).
 *
 * A task that blocks itself, or a group that blocks each other, can never become ready: `readyTasks`
 * never releases it, so it can never be claimed or dispatched, and neither `claim` nor `depend` can
 * remove an edge afterwards. Both are refused HERE, at write time, not only by `depend` — the measured
 * defect was that only `depend` checked.
 * @param edges - the prospective graph, task id → resolved blocker ids.
 * @param subjects - the prospective graph's subjects, so the refusal can quote a readable label.
 * @param nextId - the id the call would mint, which is the task the refusal names.
 * @param task - the `T1 ("subject")` form of that task.
 * @param selfReferences - the declarations of this call that resolved back to its own id.
 * @throws when this task refers to itself, or when the prospective graph carries a cycle.
 */
function assertNoDependencyCycle(
  edges: ReadonlyMap<string, readonly string[]>,
  subjects: ReadonlyMap<string, string>,
  nextId: string,
  task: string,
  selfReferences: readonly string[],
): void {
  /** One id, labelled with its subject when the prospective graph has one. */
  const label = (id: string): string => subjects.has(id) ? namedTask(id, subjects.get(id) as string) : id
  if (selfReferences.length > 0) {
    throw new Error(`create_task for ${task} declares a SELF-REFERENCE: blocked_by names ${selfReferences.map((reference) => JSON.stringify(reference)).join(", ")}, which is this very task (${nextId}). A task that blocks itself can never become ready, so it could never be claimed or dispatched. Fix: remove its own subject and its own id (${nextId}) from blocked_by and name the task that must close first — or send blocked_by: [] / independent: true for a genuine root.`)
  }
  /** The first cycle the prospective graph carries, if any. */
  const cycle = dependencyCycle(edges)
  if (cycle === undefined) return
  throw new Error(`create_task for ${task} would create a dependency CYCLE ${cycle.map(label).join(" -> ")} — every task on it would wait for itself, so no task on it could ever be claimed or dispatched, and no verb can remove an edge afterwards. Fix: leave this task out of the loop — send it with blocked_by: [] (or independent: true) and give the ordering to the other task, then re-send this call.`)
}

/**
 * Refuse write-scope overlap that no dependency path orders (R2), the approval-time guard.
 *
 * Two tasks that may write the SAME paths and neither of which runs after the other could edit one file
 * concurrently. Approval names the first such pair and the two remedies it accepts, because those are
 * the only exits the contract allows: an edge, or disjoint scopes (there is no override flag).
 * @param plan - the plan about to be approved.
 * @throws when a clashing pair exists, naming the pair, the scopes and both remedies.
 */
function assertScopesOrdered(plan: StagedPlan): void {
  /** The first unordered, overlapping pair the plan carries. */
  const [clash] = scopeClashes(plan)
  if (clash === undefined) return
  throw new Error(`plan ${plan.planId} was REFUSED: ${namedTask(clash.first.id, clash.first.subject)} and ${namedTask(clash.second.id, clash.second.subject)} declare OVERLAPPING write scopes (${JSON.stringify(clash.first.scope)} and ${JSON.stringify(clash.second.scope)}) and NEITHER depends on the other, so both could write the same files at the same time. Fix it either way: add a dependency edge so one runs after the other (create ${clash.second.id} with blocked_by: ["${clash.first.id}"], or agent_teams_task {action:"depend", task_id:"${clash.second.id}", blocked_by:["${clash.first.id}"]}), or make the two scopes disjoint so each task owns its own paths.`)
}

/**
 * Refuse an incomplete or cyclic staged graph at approval (R11), whichever verb staged it.
 *
 * `create_task` checks its own edge at write time, but `edit` BULK-REPLACES the task list: before R11
 * it accepted a task carrying no `blockedBy` at all, a self-reference and a cycle, and approval wrote
 * whatever it was given. Approval is where every staging path meets, so it re-validates the WHOLE plan
 * through the same pure predicate `create_task` uses: every task must answer (`blockedBy: []` is a
 * complete answer for a genuine root) and the graph must contain no self-edge and no cycle. Nothing
 * legitimate is refused — the empty-plan sentence keeps its own precedence, and the 0-member/0-task
 * shell carries no task to answer for.
 * @param plan - the plan about to be approved.
 * @throws when a staged task states no dependency answer, or the graph carries a self-edge or a cycle.
 */
function assertPlanGraph(plan: StagedPlan): void {
  /** The first whole-graph defect the plan carries, in plan order. */
  const defect = planGraphDefect(plan)
  if (defect === undefined) return
  if (defect.kind === "unanswered") {
    throw new Error(`plan ${plan.planId} was REFUSED: staged task ${namedTask(defect.id, defect.subject)} states NO dependency answer, so the plan's graph is incomplete — every staged task MUST answer, a task a bulk edit replaced included. The accepted answers are blocked_by: [...] (an array, possibly [] for a genuine root) or independent: true; nothing was approved, because a captain that does not know its DAG is asked, never guessed for. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} giving ${defect.id} blocked_by: [] (or the tasks that must close first), then approve again.`)
  }
  /** The plan's own ids → subjects, so a refusal prints a readable path. */
  const subjects = new Map(plan.tasks.map((task, index) => [planTaskId(index), task.subject]))
  /** One id, labelled with its subject when the plan answers for it. */
  const label = (id: string): string => subjects.has(id) ? namedTask(id, subjects.get(id) as string) : id
  if (defect.kind === "self-edge") {
    throw new Error(`plan ${plan.planId} was REFUSED: its staged graph carries a dependency SELF-EDGE ${label(defect.id)} -> ${label(defect.id)} — the task is its own blocker, so it could never become ready, and no verb can remove the edge afterwards. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} without that task's own id or subject in its blocked_by — blocked_by: [] for a genuine root, or name the task that must close first — then approve again.`)
  }
  throw new Error(`plan ${plan.planId} was REFUSED: its staged graph carries a dependency CYCLE ${defect.path.map(label).join(" -> ")} — every task on it waits for itself, so none could ever be claimed or dispatched, and no verb can remove an edge afterwards. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} and drop one edge of the loop — give one task on that path blocked_by: [] (or a blocker outside the loop) — then approve again.`)
}

/**
 * Refuse a parent chain that revisits an id, naming the loop.
 *
 * The chain is walked from the derived parent upward through the records. A cycle can only reach disk
 * through a hand-edited record — the link is written once, at approval, and no verb rewrites it — which
 * is exactly why the walk must terminate on data it did not write: the projection in `graph-model.ts`
 * follows the same field, and an unbounded walk there would hang a render instead of refusing a write.
 * @param workspace - the workspace holding the records.
 * @param parent - the derived parent, already read.
 * @throws when following `parentTeamId` from the parent revisits an id.
 */
function assertParentChainAcyclic(workspace: string, parent: TeamRecord): void {
  /** The ids already walked, mapped to their position in the path, so the loop can be quoted. */
  const at = new Map<string, number>()
  /** The chain walked so far, oldest first. */
  const path: string[] = []
  /** The record being walked; `undefined` once the chain reaches a root team. */
  let cursor: TeamRecord | undefined = parent
  while (cursor !== undefined) {
    /** The position this id already occupies, when it was walked before — the cycle. */
    const seenAt = at.get(cursor.teamId)
    if (seenAt !== undefined) {
      throw new Error(`agent_teams_plan approve REFUSED: the parent chain of ${parent.teamId} comes back to ${cursor.teamId} — it carries a CYCLE ${[...path.slice(seenAt), cursor.teamId].join(" -> ")}, and a graph projection would never terminate on it. Nothing was created. This chain cannot be written by any tool (the link is stamped ONCE, at approval), so the record was edited by hand: fix the \`parentTeamId\` field of ${cursor.teamId} under .mpd/team/teams/ and approve again.`)
    }
    at.set(cursor.teamId, path.length)
    path.push(cursor.teamId)
    cursor = cursor.parentTeamId === undefined || cursor.parentTeamId === "" ? undefined : readTeam(workspace, cursor.parentTeamId)
  }
}

/**
 * The team an approval NESTS the new team under, DERIVED from the records instead of from an argument.
 *
 * THE SEAM (`cellwork` wave 4, contract D2 option b). A subcell's subcaptain is a MEMBER of the parent
 * team's roster — the executor recorded its handle there when the parent raised it — so the parent link
 * is a fact the workspace already holds, not a value a caller must restate. Deriving it here means the
 * tool surface spends no context on a new argument, a plan carries nothing a model can mistype, and no
 * caller can file its team inside a box that was never granted to it.
 *
 * THREE DELIBERATE NEGATIVES, each with a consequence a test can observe:
 *   - NOTHING RESOLVES when the session is on no live roster (or on a team that ENDED, or whose staged
 *     plan was archived without approval — {@link isLiveTeam} is the filter): the new team is a ROOT
 *     team. A sub-team is therefore never born inside a finished parent.
 *   - A LEAD NEVER NESTS UNDER ITS OWN TEAM: a captain that stages a second wave in the same session is
 *     still that team's Lead, so its new team is a SIBLING, not a child. Without this rule every later
 *     wave would silently become a subcell of the previous one.
 *   - TWO ROSTERS REFUSE, they never guess: a session recorded on more than one live roster makes the
 *     box ambiguous, and an approval that guessed would draw a nesting the records do not state.
 * @param workspace - the workspace the records live in.
 * @param sessionId - the approving session.
 * @param lineage - the ancestors the harness recorded for this caller (a forked or resumed session).
 * @returns the single live team this session is a MEMBER of, or undefined for a root team.
 * @throws when the caller is on more than one live roster, or the derived chain carries a cycle.
 */
function deriveParentTeam(workspace: string, sessionId: string, lineage: readonly string[]): TeamRecord | undefined {
  /** Every spelling that identifies this caller, the same set the board verbs resolve by. */
  const caller = [sessionId, ...lineage].filter((value) => value !== "")
  /** The archive index, read once for the liveness test every candidate passes. */
  const archive = readArchivedPlanIndex(workspace)
  /** The LIVE teams whose ROSTER records this caller, a team it merely leads excluded. */
  const candidates = listTeams(workspace).filter((record) =>
    recordNamesMember(record, caller) && !recordNamesLead(record, caller) && isLiveTeam(record, archive))
  /** The single parent this session belongs to, if exactly one. */
  const [parent, ...rest] = candidates
  if (parent === undefined) return undefined
  if (rest.length > 0) {
    throw new Error(`agent_teams_plan approve REFUSED: this session is on the roster of ${candidates.length} live teams (${candidates.map((record) => record.teamId).join(", ")}), so a sub-team nested under one of them would be a guess — and a box in the wrong team is a picture the records do not state. Nothing was created. Fix: approve from a session that belongs to ONE team (each team's own roster is on agent_teams_plan {action:"status"}), or wait for all but the parent team to end.`)
  }
  assertParentChainAcyclic(workspace, parent)
  return parent
}

/**
 * Refuse a claim whose declared blockers are not satisfied (R3), through dispatch's OWN predicate.
 *
 * `blockingDependencies` is what `readyTasks` and `taskVisual` call, so the claim path and the dispatch
 * path cannot disagree about readiness — that disagreement was the measured defect: dispatch refused the
 * pairing with "not ready (blocked by T1)" while `claim` wrote `in_progress` anyway. OPT-1 is preserved
 * by construction: a FAILED blocker is in the predicate's `failed` list, never in `blocking`.
 * @param board - the record's tasks, as the claim read them.
 * @param task - the row being claimed.
 * @throws when at least one declared blocker still blocks, naming the blockers and a concrete fix.
 */
function assertClaimReady(board: readonly TeamTaskRecord[], task: TeamTaskRecord): void {
  /** The blockers that still block, through the predicate every readiness read uses. */
  const { blocking } = blockingDependencies(board, task.blockedBy)
  if (blocking.length === 0) return
  /** One blocker, labelled with its subject when the board holds the row. */
  const label = (id: string): string => {
    /** The blocker's own row, when the board has one. */
    const row = board.find((candidate) => candidate.id === id)
    return row === undefined ? id : namedTask(id, row.subject)
  }
  /** The blockers whose ids name no task on this board — references that can never be satisfied. */
  const dangling = blocking.filter((id) => !board.some((candidate) => candidate.id === id))
  /** The first blocker, which is the one the fix acts on. */
  const first = blocking[0]
  throw new Error(`task ${namedTask(task.id, task.subject)} is BLOCKED by ${blocking.map(label).join(", ")}: ${blocking.length === 1 ? "the declared blocker is" : "the declared blockers are"} not satisfied, and agent_teams_dispatch refuses the same pairing through the same readiness predicate (its reason reads "not ready (blocked by ${blocking.join(", ")})"). Fix: close ${first} first with agent_teams_task {action:"complete", task_id:"${first}"} — or use {action:"fail", task_id:"${first}"} if it will never be done, because a failed blocker releases its dependents (OPT-1) — then claim ${task.id} again.` + (dangling.length === 0 ? "" : ` NOTE: ${dangling.join(", ")} name(s) no task on this board (a dangling reference that can never be satisfied), so ${namedTask(task.id, task.subject)} can never be claimed. Fix: fail this row with agent_teams_task {action:"fail", task_id:"${task.id}"}, then have the team's Lead append a REPLACEMENT task with agent_teams_plan {action:"create_task", task:{subject, description, blocked_by:[...]}} that carries the corrected blocked_by. A failed row is never reopened, and re-creating the dangling reference will not make it satisfiable.`))
}

/**
 * The adapter facade for THIS apply.
 *
 * LAZY, like every other row that reaches the shared adapter: the facade probes `mpdDsh` on each use
 * and caches only a successful STRICT read, so a sibling row's provider that is still starting cannot
 * hand this row a private adapter for the session. The one-time diagnostic line (`mounted:` /
 * `pending:` / `fallback:`) is the shared resolver's, labelled with this row's id.
 */
function adapterFor(ctx: any): DshAdapter {
  return createLazyDshAdapter(ctx, { label: "mpd-team-core" })
}

/** The calling session's id, or `"workspace"` when the surface has no session (a web route). */
function sessionIdOf(exec: DshToolExec | undefined): string {
  /** The calling agent, read defensively: a route-driven call may carry no session at all. */
  const agent = exec?.agent as any
  /** Candidate session id, trying the session, then the flattened field, then the agent id. */
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id
  return typeof id === "string" && id !== "" ? id : "workspace"
}

/**
 * The OTHER session ids this call's own session descends from, as the harness recorded them (C7-4 F5).
 *
 * A captain session that FORKS or RESUMES is given a fresh id while `teams.json` and the team record
 * keep the original, and the one durable link back is the parent the harness stamps on the new session
 * (`agent.session.header.parentSession`). Resolution accepts it, so the team is not lost to the churn —
 * and an ordinary session, whose header carries no parent, degrades to the exact-id match it always had.
 * @param exec - the tool execution, read defensively because a route-driven call may carry no session.
 * @returns the recorded ancestor session ids, deduplicated; empty when the harness recorded none.
 */
function sessionLineageOf(exec: DshToolExec | undefined): string[] {
  /** The calling agent, read defensively. */
  const agent = exec?.agent as any
  /** The session header, where the harness records the lineage it knows. */
  const session = agent?.session
  /** The parent spellings the harness may carry, at either nesting the other reads use. */
  const candidates = [session?.header?.parentSession, session?.parentSession]
  /** The usable ids, deduplicated. */
  const ids = candidates.filter((value): value is string => typeof value === "string" && value !== "")
  return [...new Set(ids)]
}

/**
 * Whether the harness RECORDED this call's session as a DELEGATION CHILD (C7-4 F5's heal guard).
 *
 * A member's own session names the captain as its parent, so without this guard a member's board write
 * would read as a churned Lead and be healed into `leadHistory` — the opposite of the fix. The predicate
 * is the repository's OWN captain rule (`origin: "subagent"` or a depth of 1+), and a SEEDED FORK carries
 * neither, which is exactly the session churn this arm serves.
 * @param exec - the tool execution, read defensively.
 * @returns true when the session is a recorded delegation child.
 */
function sessionIsDelegatedChild(exec: DshToolExec | undefined): boolean {
  /** The session header, where the harness records the delegation facts. */
  const header = (exec?.agent as any)?.session?.header
  if (header?.origin === "subagent") return true
  /** The recorded depth, non-numeric when the harness never set one. */
  const depth = Number(header?.delegationDepth)
  return Number.isFinite(depth) && depth >= 1
}

/** The session TITLE the harness gives a caller (the persona prompt prefix), or `""`. */
function sessionTitleOf(exec: DshToolExec | undefined): string {
  return String((exec?.agent as any)?.session?.header?.title ?? "")
}

/** Who a caller's own identity says it is on one team record — see {@link callerIdentity}. */
interface CallerIdentity {
  /** The roster row this caller IS, or undefined when the durable roster does not name it. */
  ownMember?: TeamMemberRecord
  /**
   * The recorded ancestors this caller may present as its own identity.
   *
   * NON-EMPTY only for a caller the roster does not name; see {@link callerIdentity}.
   */
  ancestry: readonly string[]
}

/**
 * The identity a caller may present on ONE record: its own member row, and the ancestors it may borrow.
 *
 * WHY THE NARROWING EXISTS (PR #42 review, F-B/CWE-863). `lineage` is the CAPTAIN-continuity link
 * (C7-4 F5): a forked or resumed Lead gets a fresh session id while the record keeps the original, and
 * the harness-recorded `parentSession` is the one durable way back. But a SPAWNED MEMBER's session
 * names the Lead as its parent too, so adding the ancestors unconditionally let a roster member
 * inherit the Lead's spelling — and with it the Lead close override on another member's row (F-B) and
 * the live-append authorization (F-A, CWE-862). A member is therefore identified by its OWN id, then
 * by the session title the record's roster names, and borrows NO ancestry; a caller the roster does
 * not name (the ordinary Lead, the forked captain) keeps the C7-4 behaviour unchanged.
 * @param record - the record the caller's membership is decided against.
 * @param sessionId - the caller's own session id.
 * @param title - the session title the harness gave the caller (the persona prompt prefix).
 * @param lineage - the ancestors the harness recorded for this caller.
 * @returns the caller's member row (when the roster names it) and the ancestry it may present.
 */
function callerIdentity(record: TeamRecord, sessionId: string, title: string, lineage: readonly string[]): CallerIdentity {
  /** The member this session is: its own id first, then a roster name the session title contains. */
  const ownMember = memberNamedBy(record, [sessionId])
    ?? (Array.isArray(record.members) ? record.members : []).find((member) => member.name !== "" && title.includes(member.name))
  return ownMember === undefined ? { ancestry: lineage } : { ownMember, ancestry: [] }
}

/** The tool whose WHOLE-LIST write carries a wave's checklist; probed before it is ever called. */
const TODO_TOOL_NAME = "todo_write"

/**
 * The longest the bundled `todo_write` seed may take, in milliseconds.
 *
 * WHY THE ROW OWNS THIS BOUND. `dsh.executeTool` uses a caller `signal` INSTEAD of any timeout
 * (`input.signal ?? timeoutSignal(input.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS)` in the adapter), so a
 * call that supplies neither is bounded only by the adapter's 120 s default. The seed is the LAST act
 * of an approval that already succeeded, so it must not hold the answer for minutes: a whole-list
 * checklist write is local and small, and 10 s is generous for it. {@link seedSignal} composes this
 * bound with the caller's own cancellation.
 */
const SEED_TIMEOUT_MS = 10_000

/**
 * The cancellation the bundled `todo_write` seed runs under.
 *
 * BOTH sources, because the adapter accepts only ONE: `executeTool` computes
 * `input.signal ?? timeoutSignal(input.timeoutMs ?? default)`, so a caller signal REPLACES the timeout
 * (verified against the shipped adapter before this fix). Handing over `exec.signal` alone would let a
 * wedged write outlive its turn; handing over a timeout alone would drop the caller's cancellation.
 * Composition ends the seed on EITHER event. The goal ANCHOR is deliberately not wrapped this way:
 * `mpdGoal.anchor` owns its own cancellation through the goal tools' contract.
 * @param upstream - the approving call's own cancellation, when the harness supplied one.
 * @returns the combined signal; a runtime without `AbortSignal.any`/`timeout` degrades to the caller's
 *          own signal — exactly what this row passed before the bound existed.
 */
function seedSignal(upstream: AbortSignal | undefined): AbortSignal | undefined {
  try {
    /**
     * The platform's signal constructors, read structurally: the type surface differs between the
     * Node and Bun programs, and a partial runtime must degrade rather than fail an approval.
     */
    const platform = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal; any?: (signals: AbortSignal[]) => AbortSignal }
    if (typeof platform?.timeout !== "function") return upstream
    /** The bounded seed clock, minted per approval so two approvals never share one. */
    const bounded = platform.timeout(SEED_TIMEOUT_MS)
    if (upstream === undefined) return bounded
    return typeof platform.any === "function" ? platform.any([upstream, bounded]) : upstream
  } catch {
    // A runtime that refuses the composition keeps the caller's signal — never "no cancellation".
    return upstream
  }
}

/**
 * The slice of the `mpdGoal` service this row consumes, declared STRUCTURALLY on purpose.
 *
 * The authoritative declaration is `packages/mpd-goal-plugin/src/index.ts` (`MpdGoalService`); a
 * source import would add a cross-package coupling the independence inventory may only SHRINK, and
 * the two rows meet through a SERVICE at runtime anyway. A composition without the goal row leaves
 * `ctx.get("mpdGoal")` undefined, and an approval simply anchors no goal.
 */
interface GoalBridge {
  /**
   * Put a durable goal in place, keeping any unfinished goal already current.
   * @param exec - the tool exec carrying the calling agent, forwarded verbatim.
   * @param input - the objective the goal carries and the token naming what asked for it.
   * @returns the anchor outcome; `ok:false` carries the harness's own refusal in `error`.
   */
  anchor(exec: unknown, input: { objective: string; source: string }): Promise<{ ok: boolean; created: boolean; goal?: { id?: string } | null; error?: string; note?: string }>
}

/**
 * Whether `todo_write` is registered in the CALLING agent's own view.
 *
 * The probe is `hasTool` WITH the live agent, exactly like the roster gate's `hasStagingTool`: that
 * is the view that would EXECUTE the call (host globals + the preset plane mounted as the scope's
 * parent), so a probe and the call it promises cannot come from different planes. A missing seam (a
 * partial adapter double) or a throwing probe reads FALSE — the degrade step, never a throw.
 * @param dsh - the adapter facade.
 * @param agent - the live agent whose own view is probed.
 * @returns true only when the adapter answered positively for that agent's view.
 */
function hasTodoTool(dsh: DshAdapter, agent: unknown): boolean {
  if (typeof dsh.hasTool !== "function") return false
  try {
    return dsh.hasTool(TODO_TOOL_NAME, agent) === true
  } catch {
    return false
  }
}

/**
 * Bundle the durable GOAL and the TODO checklist into ONE successful approval (wave requirement 4).
 *
 * WHY HERE. Approval is the one moment a wave stops being text and becomes work, so it is the only
 * place the three mechanisms can start TOGETHER: the team record is already written (and the plan
 * archived unless a member's spawn stopped the sequence) by the time this runs, and the caller is
 * about to read "approved". Both effects are ADDITIONS to an approval that has already succeeded —
 * each is wrapped on its own, a failure logs ONE line and never changes the result, and a composition
 * without the service or the tool simply skips the effect rather than failing the wave.
 * @param ctx - the cordis context, read for the optional `mpdGoal` service.
 * @param dsh - the adapter facade: the tool probe, the internal call and the row log.
 * @param exec - the approving call's exec, carrying the live agent the effects are attributed to.
 * @param plan - the plan this approval built the team from.
 */
async function bundleApprovalEffects(ctx: { get?: (id: string) => unknown }, dsh: DshAdapter, exec: DshToolExec, plan: StagedPlan): Promise<void> {
  // ── 1. THE DURABLE GOAL ────────────────────────────────────────────────────
  // The objective a later reader sees is what the team is FOR; the plan's name is the fallback a
  // plan staged without a description leaves, so the goal is never created with an empty objective.
  /** The objective the goal carries: the plan's description, falling back to its name. */
  const objective = plan.description !== "" ? plan.description : plan.name
  try {
    /** The goal row's service; absent in a composition that does not mount that row. */
    const bridge = ctx.get?.("mpdGoal") as GoalBridge | undefined
    if (bridge !== undefined && typeof bridge.anchor === "function") {
      /** The anchor outcome; the service KEEPS any unfinished goal already current. */
      const outcome = await bridge.anchor(exec, { objective, source: "team" })
      if (outcome?.ok === false) dsh.rowLog("mpd-team-core", "goal anchor refused after approval: " + String(outcome.error ?? "unknown"))
    }
  } catch (error) {
    // Never fatal: the approval already happened, so a broken bridge costs one diagnostic line.
    dsh.rowLog("mpd-team-core", "goal anchor failed after approval: " + String((error as Error)?.message ?? error))
  }
  // ── 2. THE TODO CHECKLIST ──────────────────────────────────────────────────
  // ONE pending item per staged task, written through `todo_write` — a WHOLE-LIST replace, which is
  // the right effect here and only here: an approval starts a new wave, so the checklist it seeds
  // IS the wave's checklist. A plan with NO tasks seeds nothing, because writing `[]` would ERASE a
  // checklist the captain already holds, the opposite of what this requirement asks for.
  if (plan.tasks.length === 0) return
  if (!hasTodoTool(dsh, exec.agent)) return
  try {
    /** The harness's own result; a marked error is logged, never thrown at the approval. */
    const result = await dsh.executeTool({
      name: TODO_TOOL_NAME,
      arguments: { todos: plan.tasks.map((task) => ({ content: task.subject, status: "pending" })) },
      agent: exec.agent,
      // BOUNDED AND CANCELLABLE: a caller signal would REPLACE the adapter's timeout, so the two are
      // composed here instead of trusting either one alone.
      signal: seedSignal(exec.signal),
    })
    if (result.isError === true) dsh.rowLog("mpd-team-core", "todo seed failed after approval: " + String(result.error ?? "the tool returned an error result"))
  } catch (error) {
    // Same rule as the anchor: the wave is already approved, so one line and no rethrow.
    dsh.rowLog("mpd-team-core", "todo seed failed after approval: " + String((error as Error)?.message ?? error))
  }
}

/** Row entry point: build the adapter once, then register the five tools and the `/agent-teams` command. */
export function apply(ctx: any): void {
  /** The adapter facade — the only contact surface this row has with the harness seams. */
  const dsh = adapterFor(ctx)
  /** Registration disposers, run together on row disposal and counted in the boot line below. */
  const disposers: Array<() => void> = []
  /** How many TOOLS this apply() registered, counted as they happen so the boot line never guesses a number. */
  let toolRegistrations = 0
  /** The clock seam: one place to substitute in a test, and the reason every store takes a `Date`. */
  const now = (): Date => new Date()

  /**
   * THE CHANGE FEED: the push substrate every other mpd surface subscribes to.
   *
   * It is built FIRST, before the service that publishes it, for the same reason the service is
   * published before the tools: a consumer that resolves `mpdTeams` during this row's own activation
   * must find a live feed rather than a member that throws when called. Constructing it also registers
   * its hook on the store's writers (`onTeamStateWritten`), which is what makes this process's OWN
   * mutations — a tool call, an approval, a dispatch pass — notify without polling anything.
   *
   * DISPOSED WITH THE ROW: the hook, the debounce timers and every `fs.watch` handle go together, so a
   * reload cannot leave a dead feed observing writes or a stale watcher holding the teams directory.
   */
  const feed = new ChangeFeed({ warn: (line: string): void => { rowLogLine("mpd-team-core", line) } })
  disposers.push((): void => { feed.dispose() })

  // ── THE ONE GRAPH MODEL: computed here, served to BOTH planes ───────────────
  // `mpd-graph-core` owns the derivation and the merge; this row owns the record, so this is the ONE
  // place the two are combined. The result goes to the `mpdTeams` service (the TUI) and to the web
  // payload (`.mpd/plans/living-graph.md`, Amendment 3). A plan-file edit fires no notification from
  // the feed, so the cache arms the core's plan watcher and funnels its batches into `feed.notify` —
  // the SAME one channel, never a second one.
  /** The per-team model cache, invalidated by the feed revision and the plan watch. */
  const graphModels = new GraphModels({
    revision: (workspace: string): number => feed.revision(workspace),
    notify: (workspace: string): void => { feed.notify(workspace) },
    warn: (line: string): void => { rowLogLine("mpd-team-core", line) },
  })
  disposers.push((): void => { graphModels.dispose() })

  /**
   * THE TEAM EXECUTOR: the ONE seam a member is raised through and a message delivered to.
   *
   * Resolved per CALL rather than cached, because which backend is active can change when a
   * service becomes ACTIVE later — and because `teamExecutor()` is TOTAL, so a caller never has to
   * feature-detect: a composition with no backend at all gets an executor whose every call refuses
   * with a sentence. That is what lets this row register its tools unconditionally and work in a
   * `dsh-tui` composition, where the official service cannot mount.
   */
  const executor = (): ReturnType<DshAdapter["teamExecutor"]> => dsh.teamExecutor()

  /**
   * Resolve the workspace, the caller's own session id and its recorded ancestors for one call.
   *
   * `lineage` is the C7-4 F5 addition: a forked/resumed session's NEW id plus the parent the harness
   * stamped on it, so resolution can still find the team the session came from. It is EMPTY for a
   * recorded DELEGATION CHILD, deliberately: a teammate and a captain's subagent both carry the captain
   * as `parentSession`, and letting that link grant the Lead arm would widen captaincy to every child.
   * A child resolves through its own identity (the member arm) and nothing else.
   */
  const where = (exec: DshToolExec | undefined): { workspace: string; sessionId: string; lineage: string[] } => ({
    workspace: dsh.workspaceRoot(exec),
    sessionId: sessionIdOf(exec),
    lineage: sessionIsDelegatedChild(exec) ? [] : sessionLineageOf(exec),
  })

  /**
   * The staged, not-yet-approved plan for a session, or `undefined` when nothing is staged.
   *
   * C7-4 F1 keeps BOTH of the old refusals: a plan that IS staged and already approved still refuses with
   * the exact sentence, while a session with NO staged plan answers `undefined` so the caller can fall
   * through to its live APPROVED team — the mid-run append verb the old surface never had. The third
   * sentence ("no team is staged in this session") is produced by the caller when NEITHER exists.
   */
  const stagedPlan = (workspace: string, sessionId: string): StagedPlan | undefined => {
    /** The session's staged plan, or undefined when nothing is staged yet. */
    const plan = readPlan(workspace, sessionId)
    if (plan !== undefined && plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`)
    return plan
  }

  /**
   * Persist a forked/resumed Lead's NEW session id onto the record and the registry (C7-4 F5).
   *
   * WHY IT WRITES AT ALL. Resolution accepting the ancestor would be enough for ONE call, but the record's
   * `leadHistory` and `teams.json` are what make the captaincy durable — exactly what the hand rebind
   * rewrote this wave. The write is narrowly gated so it can never invent a Lead: only a session the
   * record does NOT already name by its own id, whose recorded ancestor IS the record's Lead, that is
   * neither on the record's roster (a member resolves through the member arm) nor a DELEGATION CHILD
   * (`origin: "subagent"` or a depth of 1+, which is what the harness records for a subagent — a seeded
   * fork carries none of them). Anything else leaves the record untouched.
   * @param workspace - the workspace holding the record.
   * @param sessionId - the caller's own session id.
   * @param lineage - the ancestors the harness recorded for this call.
   * @param record - the record resolution found.
   * @param delegated - true when the caller is a recorded delegation child.
   * @returns the record to use (the healed one, or the input untouched).
   */
  const healLeadBinding = (workspace: string, sessionId: string, lineage: readonly string[], record: TeamRecord, delegated: boolean): TeamRecord => {
    /** Whether the record already names the caller's OWN id as its Lead — nothing to heal then. */
    const ownLead = record.leadSessionId === sessionId || (record.leadHistory ?? []).includes(sessionId)
    if (ownLead || delegated) return record
    if (recordNamesMember(record, [sessionId])) return record
    /** Whether a recorded ancestor of this call IS this record's Lead. */
    const fromLead = lineage.some((id) => id === record.leadSessionId || (record.leadHistory ?? []).includes(id))
    if (!fromLead) return record
    /** The record carrying the caller in its Lead history; `leadSessionId` stays the durable identity. */
    const healed = rememberLead(record, [sessionId])
    writeTeam(workspace, healed)
    bindActiveTeam(workspace, sessionId, record.teamId)
    rowLogLine("mpd-team-core", `[mpd-team-core] rebound team ${record.teamId} to resumed/forked lead session ${sessionId}`)
    return healed
  }

  /**
   * The hold the TEAM WATCHDOG has placed on this session's team, as a refusal sentence.
   *
   * The watchdog's hold used to be carried and consulted by nobody, while `agent_teams_dispatch`
   * read only its own workspace-wide `hold.json` — so a team the watchdog had parked stayed
   * dispatchable, which is the one thing a preserve-hold exists to prevent. The two holds are
   * different things and BOTH stop a pass: `hold.json` halts the workspace, the watchdog's halts one
   * team. Reading the record is what makes this possible at all, because only the record says which
   * team this session's dispatch belongs to.
   *
   * Fail-open: an absent service, an unknown team or a throwing read answers `free` (or
   * `not-readable`, which is REPORTED and still lets the pass through), so a composition without the
   * watchdog dispatches exactly as it did before.
   * @param workspace - the workspace the pass runs in.
   * @param sessionId - the Lead session whose team is being dispatched.
   * @param lineage - the ancestors the harness recorded for this caller (C7-4 F5); empty by default.
   * @returns the discriminated reading; see {@link WatchdogHoldRead}.
   */
  const readWatchdogHold = (workspace: string, sessionId: string, lineage: readonly string[] = []): WatchdogHoldRead => {
    try {
      /** This session's team, or undefined when nothing has been approved here. */
      const record = recordFor(workspace, sessionId, lineage)
      if (record === undefined) return { state: "free" }
      /** The watchdog's own service, read defensively: it is another row and may be absent. */
      const watchdog = typeof (ctx as { get?: unknown })?.get === "function" ? (ctx as { get: (id: string) => any }).get("mpdWatchdog") : undefined
      // The ROW IS ABSENT: the watchdog's own FAIL-OPEN RULE applies ("the watchdog can only ever ADD
      // a decline; it can never keep a team stopped because its own row failed to load"), so this is
      // `free` — not `not-readable`, which is reserved for a service that answered badly.
      if (watchdog === undefined || watchdog === null) return { state: "free" }
      if (typeof watchdog.isHeld !== "function") return { state: "not-readable", reason: "the mpdWatchdog service exposes no isHeld()" }
      // THE ONLY FIELD A GATE MAY BRANCH ON is `held` (the watchdog's own documented gate call is
      // `isHeld(teamId, workspace)?.held === true`). Reading the OBJECT for truthiness is the defect
      // measured on 2026-10-02: every answer is a HoldView object, so `{held: false}` refused every
      // pass with "the team watchdog holds <team>" while the watchdog's own store said not-held —
      // while `session-watchdog-resume` and `agent_teams_control resume` both answered "not held".
      const view = watchdog.isHeld(record.teamId, workspace)
      if (view === null || typeof view !== "object" || typeof view.held !== "boolean") {
        return { state: "not-readable", reason: "mpdWatchdog.isHeld() answered without a boolean `held`" }
      }
      if (view.held !== true) return { state: "free" }
      return { state: "held", reason: `the team watchdog holds ${record.teamId}` }
    } catch (error) {
      return { state: "not-readable", reason: String((error as Error)?.message ?? error) }
    }
  }

  /**
   * The mpd team record bound to one session — the team itself, once one has been approved.
   *
   * THREE ARMS, IN THIS ORDER, so nothing that resolved before changes meaning:
   *   1. THE BOUND INDEX (the fast path) — the id `approve` wrote for this session.
   *   2. THE RECORDED LEAD — when the index is missing (a hand-removed `teams.json`, a workspace copied
   *      without it, a record written by another surface) the newest record whose `leadSessionId` is
   *      this session answers instead, so the team is never lost to a bookkeeping file.
   *   3. THE RECORDED MEMBER (defect D5a) — a teammate is neither the index's key nor any record's lead,
   *      so before this arm existed a MEMBER resolved nothing and every board action refused with
   *      `no team record in this workspace — approve a plan first`; MEASURED on a real session during
   *      the tui-dag-highlight wave, where a member could claim a task but never close its own row.
   *      The roster read is the DURABLE one (`recordNamesMember` matches the member's recorded handle
   *      and name), never a guess from the session's shape.
   *
   * AMBIGUITY IS REFUSED, NOT GUESSED: a session recorded on the roster of more than one team resolves
   * NONE and says so, because binding a board write to the wrong team is worse than refusing it.
   *
   * C7-3 (plan amendment, 2026-10-14): only LIVE teams are candidates. A record whose phase is terminal
   * (the hand-patched `archived` included) or whose plan was archived without approval is FILTERED OUT
   * inside `team-lifecycle.ts#resolveTeamRecord`, so a reaped ghost can bind nothing and resolution
   * falls through to the next candidate or to none. This closure only supplies the raw rows and the
   * archive evidence, which keeps the whole rule unit-testable without a harness.
   *
   * Never throws — a status render cannot be taken down by a bad record.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose team is wanted.
   * @param lineage - the ancestors the harness recorded for this caller (C7-4 F5); empty for an ordinary
   *   session, in which case resolution is exactly the pre-C7-4 exact-id match.
   * @returns the resolution; see {@link TeamResolution}.
   */
  const resolveTeam = (workspace: string, sessionId: string, lineage: readonly string[] = []): TeamResolution => {
    try {
      /** The archive index, read ONCE for every candidate this call classifies. */
      const archive = readArchivedPlanIndex(workspace)
      /** Every id the registry may have bound this caller under, own id first, then its ancestors. */
      const keys = [sessionId, ...lineage]
      /** The bound team id, when the index still carries one — under ANY of the caller's spellings. */
      const bound = keys.map((key) => activeTeamId(workspace, key)).find((id) => id !== undefined)
      /** The bound record, which may have been deleted — or REAPED — out from under the index. */
      const boundRecord = bound === undefined ? undefined : readTeam(workspace, bound)
      return resolveTeamRecord({
        ...(boundRecord === undefined ? {} : { bound: boundRecord }),
        teams: listTeams(workspace),
        sessionId,
        ...(lineage.length === 0 ? {} : { alsoSessions: lineage }),
        index: archive,
      })
    } catch {
      return {}
    }
  }

  /**
   * Resolve the caller's team for a WRITE, healing a forked/resumed Lead's binding first (C7-4 F5).
   *
   * The heal is a write, so it is kept OFF the render paths ({@link recordFor} stays pure) and reached
   * only from the mutating tools that already write the team. When the caller is already its own Lead the
   * call is a no-op, so an ordinary write costs one comparison and nothing else.
   * @param workspace - the workspace the write lands in.
   * @param sessionId - the caller's own session id.
   * @param lineage - the ancestors the harness recorded for this caller.
   * @param delegated - true when the caller is a recorded delegation child.
   * @returns the resolution, with a healed record when a rebind was owed.
   */
  const resolveForWrite = (workspace: string, sessionId: string, lineage: readonly string[], delegated: boolean): TeamResolution => {
    /** The resolution over the caller's own id plus its recorded ancestors. */
    const resolved = resolveTeam(workspace, sessionId, lineage)
    if (resolved.record === undefined) return resolved
    /** The record after the churn heal, or the same one when no rebind was owed. */
    const healed = healLeadBinding(workspace, sessionId, lineage, resolved.record, delegated)
    return healed === resolved.record ? resolved : { ...resolved, record: healed }
  }

  /**
   * The team bound to one session, or `undefined` when it has none — the reading a RENDER takes.
   *
   * The sentence-carrying form is {@link resolveTeam}; this one is the same resolution with the
   * refusal dropped, for the callers that only draw (the `mpdTeams` service, the status payload, the
   * mailbox roster) and have nothing to refuse.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose team is wanted.
   * @param lineage - the ancestors the harness recorded for this caller (C7-4 F5); empty by default.
   * @returns the record, or undefined when this session has no single team.
   */
  const recordFor = (workspace: string, sessionId: string, lineage: readonly string[] = []): TeamRecord | undefined => resolveTeam(workspace, sessionId, lineage).record

  /**
   * Release ONE dispatched task: the ledger row AND the task row.
   *
   * WHY BOTH (R3). `release` used to delete only the ledger pairing, leaving the task `in_progress`;
   * `readyTasks`/`casClaimTask` are pending-only, so a released task could never be dispatched again.
   * The task row now returns to `pending` through `casReleaseTask` (CAS on the caller's revision when
   * one is supplied), and the LEDGER row is freed first — a ledger row is a cache of "in flight" and a
   * terminal or missing task row makes it stale by definition, so the ledger half is repaired even
   * when the task half refuses.
   *
   * WHO MAY RELEASE (PR #60 review F1/CWE-862) is decided BEFORE either half writes: this team's Lead
   * or the task's own owner, through the store's own {@link authorizeRelease}. An unauthorized caller
   * must not unbook the pairing either, so the refusal returns before the ledger is touched — the
   * ledger-half repair above applies to an AUTHORIZED caller only.
   *
   * The TEAM is resolved by the CALLER before this runs: the ledger is team-scoped, and an ambiguous
   * roster must refuse rather than guess which team's row to free.
   * @param workspace - the workspace the team lives in.
   * @param record - the team record the release was resolved against.
   * @param taskId - the task to reopen.
   * @param expectedRevision - the revision the caller decided on, or undefined for no CAS.
   * @param caller - every spelling that identifies the calling session, never a name it typed.
   * @param lead - true when the ROSTER says the caller leads this team.
   * @returns what each half did; see {@link TaskReleaseResult}.
   */
  const releaseDispatchedTask = (workspace: string, record: TeamRecord, taskId: string, expectedRevision: number | undefined, caller: readonly string[], lead: boolean): TaskReleaseResult => {
    // Re-read immediately before deciding, the dispatch pass's own discipline: the record was opened
    // before this call and a concurrent write may have moved the task's owner or revision. The SAME
    // reading serves the authorization and the CAS below — nothing writes the team record between them.
    /** The record as it stands on disk right now. */
    const fresh = readTeam(workspace, record.teamId) ?? record
    /** Why this caller may not release the task, or undefined when it may. */
    const refusal = authorizeRelease(fresh, taskId, caller, lead)
    if (refusal !== undefined) return { released: false, taskId, refused: refusal }
    /** The ledger half: only THIS team's pairing is freed. */
    const freed = release(readLedger(workspace), record.teamId, taskId)
    if (freed.released) writeLedger(workspace, freed.ledger)
    /** The task half's decision, or the refusal and its reason. */
    const outcome = casReleaseTask(fresh, taskId, expectedRevision, now())
    if (!outcome.applied) return { released: freed.released, taskId, refused: outcome.reason }
    // The phase is re-derived on the write: reopening the last open task takes a team out of `idle`.
    writeTeam(workspace, withDerivedPhase(outcome.record))
    /** The reopened task as the record now holds it. */
    const view = outcome.record.tasks.find((candidate) => candidate.id === taskId)
    return { released: freed.released, taskId, status: view?.status, revision: view?.revision }
  }

  /**
   * The ONE graph model for one team, or the workspace principal when the caller named none.
   *
   * CONTAINED LIKE EVERY SERVICE MEMBER: it is called from a render path and from a web route, so an
   * unreadable record or a failed build answers `undefined` rather than throwing into a surface. The
   * TEAM ID is the address, never the session: a caller that named a team gets THAT team's model, and a
   * workspace-scoped answer would hand it the principal team's ghosts.
   * @param workspace - the CALLING SESSION's workspace root.
   * @param teamId - the team to draw, or undefined for the workspace principal.
   * @returns the shared model, or undefined when that team is not on disk.
   */
  const graphOf = (workspace: string, teamId?: string): GraphModel | undefined => {
    try {
      /** The team named, or the principal when none was named (the session-less fallback). */
      const record = teamId === undefined ? recordFor(workspace, "workspace") : readTeam(workspace, teamId)
      return record === undefined ? undefined : graphModels.get(workspace, record)
    } catch {
      return undefined
    }
  }

  // ── THE IDLE-MEMBER GUARD (contract `.mpd/plans/team-idle-member-guard.md`) ──
  // A team member with NO board task performs ZERO tool calls: the per-agent pre-step marks it and
  // injects one directive, the process-wide tool guard denies every call, and an open task clears the
  // mark at the next pre-step (Amendment A2 — the cellwork dispatch sends through `TeamExecutor.send`,
  // which this row never observes, so the pre-step is the only reliable clear). The service exposes the
  // explicit control-seat registration a cell dispatcher/subcaptain needs; a name prefix is never an
  // exemption. The guard's own registrations join this row's disposal list.
  const idleGuard = installIdleGuard({
    liveAgents: () => dsh.liveAgents(),
    registerAgentPreStep: (agent, listener) => dsh.registerAgentPreStep(agent, listener),
    onEvent: (event, handler) => dsh.onEvent(event, handler),
    guardTool: (guard) => dsh.guardTool(guard),
    workspaceRoot: (exec) => dsh.workspaceRoot(exec),
    rowLog: (line) => { rowLogLine("mpd-team-core", line) },
  })
  for (const dispose of idleGuard.disposers) disposers.push(dispose)

  // ── the mpd team read surface: THE seam every other mpd plugin reads ────────
  // Published before the tools so a consumer that resolves the service during this row's own
  // activation still finds it. Every member is synchronous and non-throwing: it is called from
  // render paths (the TUI scene, the web panel) and from a mutation gate (workmate rename/delete),
  // and neither may be taken down by a bad record.
  if (typeof (ctx as { provide?: unknown })?.provide === "function") {
    try {
      ;(ctx as { provide: (id: string, value: unknown) => unknown }).provide(TEAMS_SERVICE, {
        list: (workspace: string) => { try { return listTeams(workspace) } catch { return [] } },
        get: (workspace: string, teamId: string) => { try { return readTeam(workspace, teamId) } catch { return undefined } },
        active: (workspace: string, sessionId?: string) => recordFor(workspace, sessionId ?? "workspace"),
        summary: (record: TeamRecord) => summariseTeam(record),
        visual: (record: TeamRecord, taskId: string) => {
          /** The task asked about, or undefined when the id is not on this board. */
          const task = record.tasks.find((candidate) => candidate.id === taskId)
          return task === undefined ? "unknown" : taskVisual(task, record.tasks)
        },
        progress: (record: TeamRecord, name: string) => memberProgress(record, name),
        teamIds: (workspace: string) => { try { return listTeams(workspace).map((record) => record.teamId) } catch { return [] } },
        memberNames: (workspace: string) => {
          try {
            /** Every member name of every team in this workspace, deduplicated. */
            const names = new Set<string>()
            for (const record of listTeams(workspace)) for (const member of record.members) names.add(member.name)
            return [...names]
          } catch {
            return []
          }
        },
        // THE ONE MODEL both planes draw, addressed by TEAM. Computed once with the shared core and
        // served here and on `/plugins/mpd-team/state`, so a TUI page and a browser tab render the SAME
        // ranks and edges rather than two derivations that agree today and drift tomorrow.
        graph: (workspace: string, teamId?: string) => graphOf(workspace, teamId),
        // THE SHARED PROJECTION. The TUI calls this and the `/plan` route calls `planForSession`
        // directly; both resolve through the same function, so a surface cannot disagree with the Web
        // panel about what is staged or what phrase the gate demands. It never throws: a broken
        // staging file must redden a surface's empty state, not take its render down.
        planFor: (workspace: string, sessionId: string) => {
          try {
            return planForSession(workspace, sessionId)
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] reading the staged plan failed: ${String((error as Error)?.message ?? error)}`)
            return { ok: true, workspace, sessionId, plan: null }
          }
        },
        // THE PUSH SUBSTRATE, and the two members that make a surface stop polling. `subscribe` is
        // the in-process half of the feed — the same one the `/events` route serves over the wire —
        // so a TUI page and a browser tab are watching the same observation, not two of them.
        //
        // BOTH ARE CONTAINED LIKE EVERY OTHER MEMBER HERE: they are resolved during activation and
        // called from a render path, so a broken feed must answer (a dead disposer, a zero revision)
        // rather than throw into a surface that cannot catch.
        subscribe: (workspace: string, listener: () => void) => {
          try { return feed.subscribe(workspace, listener) } catch { return (): void => {} }
        },
        revision: (workspace: string) => {
          try { return feed.revision(workspace) } catch { return 0 }
        },
        // THE CONTROL-SEAT EXEMPTION (contract §3.5): the cellwork row registers its dispatcher and a
        // promoted subcaptain here, so those seats keep their control tools while owning no board task.
        // Explicit registration only — an ordinary member named `cell-*` inherits nothing.
        registerControlSeat: (sessionId: string) => idleGuard.registerControlSeat(sessionId),
      } satisfies MpdTeamsService)
    } catch (error) {
      rowLogLine("mpd-team-core", `[mpd-team-core] publishing the ${TEAMS_SERVICE} service failed: ${String((error as Error)?.message ?? error)}`)
    }
  }

  // ── the tool surface: FIVE tools, not fourteen ──────────────────────────────
  //
  // WHY CONSOLIDATED. Every tool's name, description and parameter schema sits in the model's context
  // on every turn, and the hand-written surface had grown to 14 tools costing ~7,600 characters
  // (~1,900 tokens) before a single word of the actual task. The actions below were never independent
  // decisions — they are steps of ONE workflow — so they are `action` values on five tools, with the
  // descriptions trimmed to what a caller must know to pick the right action.
  //
  // What is preserved: every action the old surface exposed, unchanged in meaning. What changed: how
  // many places the model must read to find it.

  toolRegistrations += 1
  disposers.push(dsh.registerTool({
    name: "agent_teams_plan",
    description:
      "The team PLAN. `create` stages (spawns nothing); `add_member`/`create_task` append to it or the live team; `edit` reads or replaces it; `approve` EXECUTES through the TEAM EXECUTOR (native default, official fallback), REFUSING an EMPTY plan; `delete` archives; `status` shows plan, hold, roster and board.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
        name: { type: "string", description: "create: team name." },
        description: { type: "string", description: "create/edit: what the team is for." },
        approval: { type: "string", enum: ["required", "automatic"], description: "create: `required` (default) waits for approve." },
        replace: { type: "boolean", description: "create: to replace an ALREADY APPROVED plan." },
        member: { type: "object", description: "add_member: {name, prompt, description?, role?}; prompt is the instantiation prompt." },
        // The canonical shape stays in the description because the context budget below is binding:
        // only the keys a caller really put somewhere else are declared as their own properties. The
        // C7-4 F1 requirement-chain fields (kind/coverageOf/sourceTaskId) ride inside `task`; `kind`
        // gained its own alias because a live call sent it BESIDE `task` and the arm read the nested
        // key only, silently storing `work` (contract amendment 2).
        task: { type: "object", description: "create_task: {subject, description, blocked_by, write_scopes?, owner?, kind?, coverageOf?, sourceTaskId?}; blocked_by or independent:true required." },
        owner: { type: "string", description: "create_task: alias of task.owner." },
        blocked_by: { type: "array", items: { type: "string" }, description: "create_task: [] = root." },
        kind: { type: "string", description: "create_task: alias of task.kind." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement members." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement tasks." },
        dry_run: { type: "boolean", description: "approve: report what would be created; write nothing." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      // THE DECLARED SHAPE OF EVERY BRANCH, stated honestly rather than loosely: `status` answers
      // `plan`/`hold`/`team`/`summary` as an OBJECT or as `null` when this session has no staged
      // plan, no hold and no team (measured 2026-10-02, defect 1: the schema said `object` only, so
      // the harness rejected the nulls with `"value.plan" must be an object`). The harness's schema
      // subset has no `type` arrays, so the nullable form is an exact-one `oneOf`.
      schema: {
        type: "object",
        properties: {
          plan: { oneOf: [{ type: "object" }, { type: "null" }] },
          hold: { oneOf: [{ type: "object" }, { type: "null" }] },
          team: { oneOf: [{ type: "object" }, { type: "null" }] },
          summary: { oneOf: [{ type: "object" }, { type: "null" }] },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          contracts: { type: "array", items: { type: "object" } },
          created: { type: "object" },
          // The F1 live-team append: the sentence naming the row and the team it landed on, plus the row
          // (and, for `add_member`, the handle the raise minted).
          appended: { type: "string" },
          task: { type: "object" },
          spawned: { type: "string" },
          stoppedAt: { type: "string" },
          archivedTo: { type: "string" },
          // The write-time blocker reading of `create_task` / `edit`: one `{ reference, form }` per
          // reference, declared so the harness's own output validation accepts it.
          blockers: { type: "array", items: { type: "object" } },
        },
      },
      render: (_args: any, value: any) =>
        text(
          value?.archivedTo !== undefined ? `archived to ${value.archivedTo}`
            : value?.created !== undefined ? `approved ${value.plan?.planId ?? ""}: ${value.created.members?.length ?? 0} member(s), ${value.created.tasks?.length ?? 0} task(s)` + (value.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`)
              // THE LOUD HALF. An approval that carried a blocker naming no task says so HERE, in the
              // answer the captain reads, with the board task and the exact text — because the whole
              // defect was a plan whose dangling references were accepted, stored and never mentioned.
              + (Array.isArray(value.created.unresolved) && value.created.unresolved.length > 0
                ? ` — WARNING: ${value.created.unresolved.length} task(s) carry blockers that name no task (${value.created.unresolved.map((entry: { taskId?: string; references?: string[] }) => `${entry.taskId ?? "?"}:[${(entry.references ?? []).join(",")}]`).join(" ")}); they draw no edge`
                : "")
            : value?.members !== undefined ? describeStatus(value)
            // The F1 live-team append says WHAT it appended and to which team, instead of the misleading
            // "no plan staged" the staged-plan render would answer for a call that never had one.
            : typeof value?.appended === "string" ? value.appended
            // The task-writing branches answer with the blockers reading, which is the sentence that
            // tells a captain at WRITE time whether their references can resolve (R21).
            : Array.isArray(value?.blockers) && value.blockers.length > 0 ? `task "${value.plan?.tasks?.at?.(-1)?.subject ?? ""}" staged${blockerSentence(value.blockers)}`
            : describeStagedPlan(value?.plan),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")
      /** The call's workspace, session and recorded ancestors; every branch below stays inside them. */
      const { workspace, sessionId, lineage } = where(exec)
      /** Whether this caller is a recorded delegation child (the C7-4 F5 heal guard). */
      const delegated = sessionIsDelegatedChild(exec)

      if (action === "status") {
        /** Read one seam defensively: a status call must answer even when a service is absent. */
        const read = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }
        /** The mpd record bound to this session — the team, when one was ever approved here. */
        const record = recordFor(workspace, sessionId)
        // THE AUTHORITATIVE HALF: with a record present, the roster and the board are MPD's. The
        // official readout is still reported, but BESIDE it and under its own key, so a reader can
        // see the executor's view without confusing it for the team.
        return {
          plan: readPlan(workspace, sessionId) ?? null,
          hold: readHold(workspace) ?? null,
          team: record ?? null,
          // A `failed` row is a raise that never happened: the live append and the approval REMOVE it, and
          // a legacy record may still carry one — rendering it as a live roster row is exactly the defect
          // this contract closes, so the status answer names only the members the team actually has.
          members: record === undefined ? read(() => dsh.teamListMembers(exec.agent), []) : record.members.filter((member) => member.status !== "failed"),
          tasks: record === undefined ? read(() => dsh.teamListTasks(exec.agent), []) : record.tasks,
          // The summary crosses a TOOL boundary, so it is projected to lossless JSON here: the store's
          // own `depths` is a Map and a Map cannot survive the harness's snapshot (defect 1).
          summary: record === undefined ? null : losslessSummary(summariseTeam(record)),
          contracts: read(() => listContracts(workspace), []),
        }
      }

      if (action === "create") {
        /** The plan already staged here, whose approval state decides whether this create may replace it. */
        const existing = readPlan(workspace, sessionId)
        if (existing?.approvedAt !== undefined && args?.replace !== true) {
          throw new Error(`plan ${existing.planId} is already approved; pass replace:true to stage a different team`)
        }
        // NO NESTING ARGUMENT IS STAGED HERE, deliberately (cellwork wave 4): the parent team is derived
        // at APPROVAL from the record's own roster (see `deriveParentTeam`), so a plan carries no value a
        // model could mistype and this tool surface spends no context on one.
        return { plan: stagePlan(workspace, sessionId, {
          name: String(args?.name ?? "team"),
          description: String(args?.description ?? ""),
          approval: args?.approval === "automatic" ? "automatic" : "required",
        }, now()) }
      }

      if (action === "add_member") {
        /** The raw member argument, read as a record because the tool schema is not enforced here. */
        const raw = (args?.member ?? {}) as Record<string, unknown>
        /** The member the caller wants, in the store's own input shape. */
        const input = {
          name: String(raw.name ?? ""),
          description: String(raw.description ?? ""),
          prompt: String(raw.prompt ?? ""),
          ...(raw.role === undefined ? {} : { role: String(raw.role) }),
        }
        /** The staged, not-yet-approved plan this call appends to, when one exists. */
        const plan = stagedPlan(workspace, sessionId)
        if (plan !== undefined) {
          /** The plan with the member appended (trimmed and duplicate-checked by the store). */
          const next = addMember(plan, input)
          writePlan(workspace, next)
          return { plan: next }
        }
        // ── THE MID-RUN ARM (C7-4 F1) ─────────────────────────────────────────
        // With NO staged plan the caller used to get "no team is staged in this session" even though it
        // HAD approved a team minutes earlier (approval archives the staging file). Resolution finds the
        // live APPROVED record and the append lands on it, persisted through `writeTeam` so the change
        // feed every panel follows fires.
        /** The caller's live team, or the sentence saying why none unambiguous resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team is staged in this session — call agent_teams_create first")
        // ── LEAD AUTHORIZATION ON THE LIVE ROSTER (PR #42 review F-A, CWE-862) ──
        // The staged-plan arm above is the caller's OWN staging file; this arm writes a LIVE team every
        // surface already reads, so it is the Lead's to change. `agent_teams_plan` is NOT on the
        // read-only deny list, so without this check a member could raise a write-capable teammate onto
        // the roster. The ancestry is the NARROWED one (`callerIdentity`): a member that carries the
        // Lead as its `parentSession` must not inherit the Lead's spelling here either.
        if (!recordNamesLead(resolved.record, [sessionId, ...callerIdentity(resolved.record, sessionId, sessionTitleOf(exec), lineage).ancestry])) {
          throw new Error(`only the Lead of team ${resolved.record.teamId} may append to its live roster or board`)
        }
        /** The trimmed name, which is both the duplicate key and the stored value. */
        const name = input.name.trim()
        if (name === "") throw new Error("a teammate needs a non-empty name")
        if (resolved.record.members.some((member) => member.name === name)) throw new Error(`teammate "${name}" is already on the roster of team ${resolved.record.teamId}`)
        /** The live record with the member appended. */
        const roster = addTeamMember(resolved.record, input, now())
        /** The member this append minted — the LAST row of the new roster. */
        const added = roster.members[roster.members.length - 1]
        writeTeam(workspace, withDerivedPhase(roster))
        // THE MEMBER IS RAISED HERE, exactly as approval raises one: a roster row nothing ever spawned
        // would be the C7-3 ghost class again. A failed raise is written on the row AND reported in the
        // answer, never left silent.
        try {
          /** The backend's answer, whose handle the record keeps beside our own member id. */
          const spawned = await executor().spawn(exec.agent, {
            teamId: roster.teamId,
            memberId: added.id,
            name: added.name,
            description: added.description === "" ? added.name : added.description,
            // THE SPAWN PREAMBLE IS THE PROSE LAYER OF THE IDLE GUARD (§3.3): the fixed rule travels
            // with the prompt the executor hands the member, so a spawn-time turn starts with the rule
            // in view. The GUARANTEE is the tool-boundary denial, not this text.
            prompt: withIdlePreamble(input.prompt === "" ? added.description : input.prompt),
            // THE SAME IDENTITY CONTRACT AS APPROVAL: the role is the executor's first roster
            // channel, so a member appended to a LIVE roster is routed by its slot — not by the
            // staging session that happens to be running this append.
            ...(added.role === undefined ? {} : { role: added.role }),
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          /** The record re-read immediately before the handle is written, so the raise cannot clobber a concurrent write. */
          const running = updateTeamMember(readTeam(workspace, roster.teamId) ?? roster, added.id, { executorRef: spawned.handle, status: "running" })
          writeTeam(workspace, withDerivedPhase(running))
          return { team: running, member: { ...added, executorRef: spawned.handle, status: "running" }, spawned: spawned.handle, appended: `member ${added.name} (${added.id}) appended to the live team ${running.teamId}` }
        } catch (error) {
          // A FAILED RAISE LEAVES NO ZOMBIE (contract `.mpd/plans/agent-slot-hygiene.md`). The row this
          // append wrote is REMOVED, not marked `failed`: a member the harness never raised is counted by
          // the active-child capacity and rendered by every roster consumer, and five such rows exhausted
          // the harness's pool in the cellwork wave. The failure is reported in the ANSWER (`stoppedAt`
          // and `appended`), and whatever slot the executor took is released by the executor itself.
          /** The record with the never-raised row dropped, so the roster and the capacity agree. */
          const released = removeTeamMember(readTeam(workspace, roster.teamId) ?? roster, added.id)
          writeTeam(workspace, withDerivedPhase(released))
          return { team: released, member: { ...added, status: "failed" }, stoppedAt: `member ${added.name}: ${String((error as Error)?.message ?? error)}`, appended: `member ${added.name} (${added.id}) was NOT added to team ${released.teamId}: the raise FAILED, and its roster row was REMOVED so no failed slot is held` }
        }
      }

      if (action === "create_task") {
        /** The raw task argument, read as a record because the tool schema is not enforced here. */
        const raw = (args?.task ?? {}) as Record<string, unknown>
        // BOTH SPELLINGS, ONE READING (measured 2026-10-02, defects 4 and 5): the caller sent
        // `owner` and `blocked_by` BESIDE `task` in 9 of 10 live create_task calls, and this branch
        // read only the nested pair — so the board came back `owner: null, blockedBy: []` while the
        // call plainly carried both. The nested key wins; the top-level alias is the caller's.
        // THE BLOCKERS ARE NOT READ HERE (R1): the dependency answer is read where the task is actually
        // appended, so a call that resolves NO plan and NO team keeps its own refusal sentence instead
        // of being turned away for an argument the caller never got to use.
        /** The write scopes, from the nested key or its top-level alias. */
        const writeScopes = stringList(raw.write_scopes ?? raw.writeScopes ?? args?.write_scopes)
        /** The owning teammate's display name, from the nested key or its top-level alias. */
        const owner = raw.owner ?? args?.owner
        /** The requirement-chain fields (C7-4 F1), declared inside `task` to keep the context budget. */
        // BOTH SPELLINGS, ONE READING (contract amendment 2, 2026-10-23): the doc comment above has
        // always promised `task.kind` OR its top-level alias, but only the nested key was read — so a
        // live `create_task` carrying `kind` beside `task` (the spelling the `owner`/`blocked_by`
        // aliases invite) silently reached the board as `work`. The nested key still wins.
        /** The parsed task kind, refused at this boundary when the word is unknown. */
        const kind = parseTaskKind(raw.kind ?? args?.kind)
        /** The user clause this task serves, when the caller named one. */
        const coverageOf = raw.coverageOf
        /** The task a repair row was opened from, when the caller named one. */
        const sourceTaskId = raw.sourceTaskId
        /** The staged, not-yet-approved plan this call appends to, when one exists. */
        const plan = stagedPlan(workspace, sessionId)
        if (plan !== undefined) {
          // THE STAGED ARM CARRIES THE SAME THREE FIELDS AS THE LIVE ONE (PR #42 review F-J). It used to
          // parse `kind` and drop it together with `coverageOf`/`sourceTaskId`, so `approve` wrote
          // `kind: "work"` for every staged task and a `repair` row reached the board as a plain work row
          // with no warning anywhere. Carried rather than refused: staging a `repair` row BEFORE approval
          // is the documented requirement-chain flow this field pair exists for.
          // R1 LIVES HERE: the dependency answer is read and checked BEFORE the plan is written, so a
          // refused call leaves the staging file byte-identical and the captain can simply re-send it.
          /** The dependency answer this call declares — `blocked_by` (empty for a root) or `independent`. */
          const blockedBy = readDependencyAnswer(raw, args, planTaskId(plan.tasks.length), String(raw.subject ?? "").trim())
          /** The plan with the task appended (trimmed by the store). */
          const next = addTask(plan, {
            subject: String(raw.subject ?? ""),
            description: String(raw.description ?? ""),
            ...(kind === undefined ? {} : { kind }),
            blockedBy,
            ...(writeScopes === undefined ? {} : { writeScopes }),
            ...(owner === undefined ? {} : { owner: String(owner) }),
            ...(coverageOf === undefined ? {} : { coverageOf: String(coverageOf) }),
            ...(sourceTaskId === undefined ? {} : { sourceTaskId: String(sourceTaskId) }),
          })
          // THE PROSPECTIVE GRAPH IS CHECKED BEFORE THE PLAN IS PERSISTED (R1): a self-reference or a
          // cycle makes a row permanently unready, and nothing in the tool surface can remove an edge.
          /** The row this append staged — the LAST task of the new plan. */
          const stagedTask = next.tasks[next.tasks.length - 1]
          /** The id approval will mint for it. */
          const stagedId = planTaskId(next.tasks.length - 1)
          assertNoDependencyCycle(
            planDependencyEdges(next),
            new Map(next.tasks.map((task, index) => [planTaskId(index), task.subject])),
            stagedId,
            namedTask(stagedId, stagedTask.subject),
            blockedBy.filter((reference) => planReferenceTarget(next, reference) === stagedId),
          )
          writePlan(workspace, next)
          // SAID AT WRITE TIME (R21): each reference is classified against the plan AS IT NOW STANDS, so
          // a captain sees immediately which forms will resolve and which name nothing this plan can
          // resolve — the sentence the defect never produced. Advisory, never a refusal: a forward
          // reference (`3` before task 3 exists) is legitimate and reads as `position`.
          return { plan: next, ...(blockedBy.length === 0 ? {} : { blockers: blockerReading(next, blockedBy) }) }
        }
        // ── THE MID-RUN ARM (C7-4 F1) ─────────────────────────────────────────
        // The measured defect: after approval this exact call answered "no team is staged in this
        // session", so a DAG could never grow a repair row mid-run. It now appends to the live APPROVED
        // record through `addTeamTask` + `writeTeam`, carrying the requirement-chain fields.
        /** The caller's live team, or the sentence saying why none unambiguous resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team is staged in this session — call agent_teams_create first")
        // ── LEAD AUTHORIZATION ON THE LIVE BOARD (PR #42 review F-A, CWE-862) ──
        // Same rule as the live roster arm: a member must not assign arbitrary ownership or
        // `write_scopes` on a running team's board. See that arm's comment for the narrowing.
        if (!recordNamesLead(resolved.record, [sessionId, ...callerIdentity(resolved.record, sessionId, sessionTitleOf(exec), lineage).ancestry])) {
          throw new Error(`only the Lead of team ${resolved.record.teamId} may append to its live roster or board`)
        }
        if (String(raw.subject ?? "").trim() === "") throw new Error("a task needs a non-empty subject")
        // R1 ON THE LIVE BOARD TOO: a mid-run row states its dependency answer exactly like a staged
        // one, and the answer is checked against the board this append will produce.
        /** The dependency answer this call declares — `blocked_by` (empty for a root) or `independent`. */
        const blockedBy = readDependencyAnswer(raw, args, "T" + resolved.record.nextTaskNumber, String(raw.subject ?? "").trim())
        /** The live record with the task appended (blockers split and reported by the store). */
        const next = addTeamTask(resolved.record, {
          subject: String(raw.subject ?? ""),
          description: String(raw.description ?? ""),
          ...(kind === undefined ? {} : { kind }),
          blockedBy,
          ...(writeScopes === undefined ? {} : { writeScopes }),
          ...(owner === undefined ? {} : { owner: String(owner) }),
          ...(coverageOf === undefined ? {} : { coverageOf: String(coverageOf) }),
          ...(sourceTaskId === undefined ? {} : { sourceTaskId: String(sourceTaskId) }),
        }, now())
        /** The row this append minted — the LAST task of the new board. */
        const appendedTask = next.tasks[next.tasks.length - 1]
        // THE PROSPECTIVE BOARD IS CHECKED BEFORE IT IS PERSISTED (R1): the store resolved every
        // reference it could, so a self-edge or a cycle is now visible — and a cycle on a live board is
        // permanent, because no verb removes an edge. A reference equals the new SUBJECT only when
        // nothing on the OLD board answered it (the store would otherwise have resolved it to that
        // task's id), which makes the subject comparison exactly the "names itself" case.
        assertNoDependencyCycle(
          boardDependencyEdges(next.tasks),
          new Map(next.tasks.map((task) => [task.id, task.subject])),
          appendedTask.id,
          namedTask(appendedTask.id, appendedTask.subject),
          appendedTask.blockedBy.filter((reference) => reference === appendedTask.id || reference === appendedTask.subject),
        )
        writeTeam(workspace, withDerivedPhase(next))
        return {
          team: next,
          task: appendedTask,
          appended: `task ${appendedTask.id} "${appendedTask.subject}" appended to the live team ${next.teamId}`,
          ...(appendedTask.unresolvedBlockers === undefined
            ? {}
            : { blockers: appendedTask.unresolvedBlockers.map((reference) => ({ reference, form: "unknown" })) }),
        }
      }

      if (action === "edit") {
        /** The plan being edited, or undefined when the session has nothing staged. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) throw new Error("no team is staged in this session — use action:\"create\" first")
        if (args?.members === undefined && args?.tasks === undefined && args?.description === undefined) return { plan }
        if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved and cannot be edited`)
        /** The replacement plan, assembled immutably so a rejected edit leaves the stored one untouched. */
        const next: StagedPlan = {
          ...plan,
          ...(args?.description === undefined ? {} : { description: String(args.description) }),
          ...(Array.isArray(args?.members)
            ? { members: args.members.map((raw: any): StagedMember => {
                if (typeof raw?.name !== "string" || raw.name.trim() === "") throw new Error("every staged member needs a name")
                if (typeof raw?.prompt !== "string" || raw.prompt.trim() === "") throw new Error(`staged member "${raw.name}" needs a prompt`)
                return { name: raw.name, description: String(raw?.description ?? ""), prompt: raw.prompt, ...(raw?.role === undefined ? {} : { role: String(raw.role) }) }
              }) }
            : {}),
          ...(Array.isArray(args?.tasks)
            ? { tasks: args.tasks.map((raw: any): StagedTask => {
                if (typeof raw?.subject !== "string" || raw.subject.trim() === "") throw new Error("every staged task needs a subject")
                return {
                  subject: raw.subject,
                  description: String(raw?.description ?? ""),
                  ...(Array.isArray(raw?.blockedBy) || Array.isArray(raw?.blocked_by) ? { blockedBy: (raw.blockedBy ?? raw.blocked_by).map(String) } : {}),
                  ...(Array.isArray(raw?.writeScopes) || Array.isArray(raw?.write_scopes) ? { writeScopes: (raw.writeScopes ?? raw.write_scopes).map(String) } : {}),
                  ...(raw?.owner === undefined ? {} : { owner: String(raw.owner) }),
                }
              }) }
            : {}),
        }
        writePlan(workspace, next)
        // An edit REPLACES the task list, so the same write-time reading is answered here: every
        // reference of every task that survived the edit, classified against the plan as it now stands.
        /** Every blocker reference the edited plan carries, in task order. */
        const editedReferences = next.tasks.flatMap((task) => task.blockedBy ?? [])
        return { plan: next, ...(editedReferences.length === 0 ? {} : { blockers: blockerReading(next, editedReferences) }) }
      }

      if (action === "delete") {
        /** The plan to archive, or undefined when there is nothing to archive. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) return {}
        return { archivedTo: archivePlan(workspace, plan) }
      }

      if (action === "approve") {
        /** The plan being approved; it must exist and must not already be approved. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) throw new Error("no team is staged in this session — use action:\"create\" first")
        if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved`)
        // ── AN EMPTY SHELL IS NOT A TEAM (D4a) ────────────────────────────────
        // A plan can be staged mechanically — the session-start gate (D5) does exactly that, with
        // `approval:"required"` and nothing in it — and approving one used to MINT A TEAM RECORD with
        // no member and no task: a name in `.mpd/team/teams/`, a row in every panel, and no work
        // behind it. The refusal is a sentence that says what to do instead, so the caller is not left
        // guessing which of the two lists it must fill. Its trailing clause (R13, Amendment 2) names
        // the dependency answer too: obeying the sentence's own advice would otherwise stage a task
        // that `create_task` REFUSES for answering nothing, so the advice must be a working call.
        // THE CHECK SITS ABOVE `dry_run` DELIBERATELY: a preview of an empty plan would report "0
        // members, 0 tasks" for a CALL THAT CANNOT SUCCEED, which reads as a successful dry run and
        // invites the very approval this refuses. Both spellings answer with the same actionable
        // sentence instead, which is also what the /agent-teams command's own usage line promises.
        /** How many members and tasks the plan actually carries (zero on either side is fine). */
        const staged = plan.members.length + plan.tasks.length
        if (staged === 0) {
          throw new Error(`plan ${plan.planId} is EMPTY — it has 0 members and 0 tasks, and approving it would create a team with nothing in it; add a member with agent_teams_plan {action:"add_member", member:{name, prompt}} and/or a task with {action:"create_task", task:{subject, description}} first — a task added there must also declare its dependency answer with blocked_by: [...] (possibly []) or independent: true`)
        }
        // ── THE WHOLE GRAPH IS RE-VALIDATED, WHICHEVER VERB STAGED IT (R11) ──
        // `create_task` reads its dependency answer at write time, but `edit` BULK-REPLACES the task
        // list and accepted a task with no answer at all — and neither verb re-checked the graph it
        // left behind. Approval is the one place every path meets, so it checks the WHOLE plan here:
        // every task must carry a `blockedBy` array (`[]` is a valid explicit root) and the graph must
        // carry no self-edge and no cycle. This sits BELOW the empty-plan sentence (which keeps its
        // precedence) and ABOVE `dry_run`, like the scope check: a preview of a call that cannot
        // succeed would read as a successful dry run.
        assertPlanGraph(plan)
        // ── TWO UNORDERED TASKS MAY NOT SHARE A WRITE SCOPE (R2) ──────────────
        // The plan can declare `write_scopes` on every task, and it could declare two tasks that may
        // write the SAME paths while neither runs after the other — the exact condition under which two
        // teammates edit one file concurrently. The refusal names the pair and the two remedies the
        // contract allows (an edge, or disjoint scopes); there is deliberately NO override flag.
        // THE CHECK SITS ABOVE `dry_run` for the same reason the empty-plan check does: a preview of a
        // call that CANNOT succeed reads as a successful dry run and invites exactly that approval.
        assertScopesOrdered(plan)
        // ── THE NESTING SEAM, AT THE MOMENT THE RECORD IS BORN (cellwork wave 4) ──
        // The parent is DERIVED from the records (contract D2 option b): a promoted subcaptain is on
        // the parent team's roster, so approving its sub-team nests it without any argument. Derived
        // BEFORE `dry_run` like every other approval-time guard, because a preview of an approval that
        // cannot succeed reads as a successful dry run and invites it.
        /** The team this approval nests under, or undefined for a root team. */
        const parent = deriveParentTeam(workspace, sessionId, lineage)
        if (args?.dry_run === true) {
          return { plan, created: { members: plan.members.map((m) => ({ name: m.name, id: "" })), tasks: plan.tasks.map((t) => ({ subject: t.subject, id: "" })) } }
        }
        // ── the separation, at the one moment it matters ──────────────────────
        // The mpd record is materialised BEFORE anything is spawned and carries its OWN ids, so
        // the team exists as mpd data from the first instant. Everything below only fills in
        // `executorRef` — the backend's handle — which is why a crash mid-approval leaves a record
        // naming exactly what was attempted instead of nothing at all, and why an executor swap
        // (W2) changes no id any surface has already shown.
        /** The mpd record this approval builds; persisted at the end, and on failure too. */
        let record = createTeam(workspace, {
          name: plan.name,
          description: plan.description,
          leadSessionId: sessionId,
          planId: plan.planId,
          // THE SEAM MADE DURABLE: the derived parent becomes the record's `parentTeamId`, and a root
          // team writes no key at all (so its record carries the exact field set it always had).
          ...(parent === undefined ? {} : { parentTeamId: parent.teamId }),
        }, now())
        for (const member of plan.members) {
          record = addTeamMember(record, { name: member.name, description: member.description, ...(member.role === undefined ? {} : { role: member.role }) }, now())
        }
        // THE ORDER IS THE FIX (defect 2026-10-06). Every staged task is minted FIRST and the blockers
        // are resolved afterwards, against the COMPLETE board: a plan may legitimately name a task that
        // comes LATER (a forward reference), and resolving per insert could only ever see the tasks
        // before it — which is how a plan written in its own POSITIONS (`["2"]`, `["7","8","9"]`) used to
        // reach the board as references no task answered, flattening the whole DAG to one column with no
        // warning anywhere. `blockedBy` is therefore added in a second pass, through `updateTeamTask`,
        // once the plan's own namespace can be mapped to real board ids.
        for (const task of plan.tasks) {
          record = addTeamTask(record, {
            subject: task.subject,
            description: task.description,
            // THE STAGED KIND IS THE BOARD KIND (PR #42 review F-J): `work` remains the default for a
            // plan that never named one, which is exactly what every staged task used to become.
            kind: task.kind ?? "work",
            ...(task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy }),
            ...(task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes }),
            ...(task.owner === undefined ? {} : { owner: task.owner }),
            ...(task.coverageOf === undefined ? {} : { coverageOf: task.coverageOf }),
            ...(task.sourceTaskId === undefined ? {} : { sourceTaskId: task.sourceTaskId }),
          }, now())
        }
        /** The plan's own references → the board ids this approval minted, in plan order. */
        const planAlias = new Map<string, string>()
        plan.tasks.forEach((task, index) => {
          /** The board task the staged task at this position was minted as; absent for an empty subject. */
          const minted = record.tasks[index]
          if (minted === undefined) return
          // BOTH FORMS THE PLAN CAN MEAN are mapped, position first: `"2"` is the second staged task,
          // and the subject is what the plan-store's own documentation has always promised.
          planAlias.set(String(index + 1), minted.id)
          if (!planAlias.has(task.subject)) planAlias.set(task.subject, minted.id)
        })
        for (const [index, task] of plan.tasks.entries()) {
          /** The board task this staged task became. */
          const minted = record.tasks[index]
          if (minted === undefined || (task.blockedBy ?? []).length === 0) continue
          /** What this task's references resolve to now that the whole plan is on the board. */
          const mapped = (task.blockedBy ?? []).map((reference) => planAlias.get(reference) ?? reference)
          // UNCHANGED MEANS ALREADY RIGHT. A subject or a backward id was resolved when the task was
          // minted, so re-writing it would only move the task's own revision for nothing; only a
          // reference the first pass could NOT resolve (a plan position, a forward reference) is
          // rewritten — and a rewrite is what turns that dangling entry into a real edge.
          if (mapped.length === minted.blockedBy.length && mapped.every((id, at) => minted.blockedBy[at] === id)) continue
          record = updateTeamTask(record, minted.id, { blockedBy: mapped }, now())
        }
        /** What approval actually created, recorded onto the plan so a reader can reconcile plan with reality. */
        const created: NonNullable<StagedPlan["created"]> = { members: [], tasks: [] }
        // THE REPORT A CAPTAIN SEES AT APPROVAL TIME, not three layers downstream: every staged blocker
        // that named no task is named HERE, with the board task it landed on. It travels in the
        // approval ANSWER (rendered by the tool) and into the archived plan's `created.unresolved`, and
        // the same list is on each board task as `unresolvedBlockers` for every later reader.
        /** The board tasks carrying a blocker nothing answered, in board order. */
        const unresolvedBlockers = record.tasks
          .filter((task) => (task.unresolvedBlockers ?? []).length > 0)
          .map((task) => ({ taskId: task.id, references: [...(task.unresolvedBlockers ?? [])] }))
        if (unresolvedBlockers.length > 0) created.unresolved = unresolvedBlockers
        /** The executor's own task handle per mpd task id, so a blocker can be named in ITS vocabulary. */
        const executorTaskId = new Map<string, string>()
        /** The first failure's description; set means approval stopped rather than half-build the team. */
        let stoppedAt: string | undefined
        for (const member of record.members) {
          try {
            // THE EXECUTOR RAISES THE MEMBER. On the native backend the member's ROLE travels as an
            // ordinary argument and the executor turns it into the child's `agentOptions` — the two
            // things the official tool row cannot forward — so a roster slot route, a persona and the
            // read-only deny list reach a teammate directly, and nothing here needs the official
            // plugin mounted.
            /** The backend's answer, whose handle the record keeps BESIDE our own member id. */
            const spawned = await executor().spawn(exec.agent, {
              teamId: record.teamId,
              memberId: member.id,
              name: member.name,
              description: member.description === "" ? member.name : member.description,
              // THE SPAWN PREAMBLE (§3.3), applied where the prompt is HANDED TO THE EXECUTOR (Amendment
              // A6), never where `add_member` stores the row: the member's first turn must carry it.
              prompt: withIdlePreamble(plan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description),
              // THE ROLE IS THE ROUTE'S FIRST IDENTITY CHANNEL, not a decoration: the native executor
              // matches it against the roster before the description's head and the name, and an
              // unmatched member inherits the staging session's route. `TeamMemberRecord.route` is
              // written by NO production path (only the store's input type admits it), so this arm
              // forwards no `provider` — the route is the executor's to resolve.
              ...(member.role === undefined ? {} : { role: member.role }),
              ...(exec.signal === undefined ? {} : { signal: exec.signal }),
            })
            created.members.push({ name: member.name, id: spawned.handle })
            record = updateTeamMember(record, member.id, { executorRef: spawned.handle, status: "running" })
          } catch (error) {
            // THE SAME RULE AS THE LIVE APPEND (contract `.mpd/plans/agent-slot-hygiene.md`): a member
            // the harness never raised is DROPPED rather than kept as a `failed` row, because a partial
            // approval would otherwise hand the roster — and the capacity — a teammate that does not
            // exist, and a repaired approval could never reuse the name.
            record = removeTeamMember(record, member.id)
            stoppedAt = `member ${member.name}: ${String((error as Error)?.message ?? error)}`
            break
          }
        }
        // THE TASKS ARE NOT POSTED TO A BACKEND BOARD. The mpd record IS the board — the dependency
        // edges, the attempts, the review fields and the executor handles are all here, and a
        // second board would be a second source of truth for the same team. The official backend's
        // `executorRef` is filled in only where a backend actually minted something to point at.
        if (stoppedAt === undefined) for (const task of record.tasks) {
          created.tasks.push({ subject: task.subject, id: task.id })
        }
        /** The record stamped approved, its phase brought in line with what actually happened. */
        const approvedRecord = withDerivedPhase({ ...record, approvedAt: now().toISOString() })
        writeTeam(workspace, approvedRecord)
        /** The plan marked approved, carrying what was created. */
        const approved: StagedPlan = { ...plan, approvedAt: now().toISOString(), created }
        writePlan(workspace, approved)
        // The plan is archived so the STAGING slot is free for the next wave while the approved
        // plan stays readable; the record is what every surface reads from here on.
        if (stoppedAt === undefined) archivePlan(workspace, { ...approved })
        // ── WAVE REQUIREMENT 4: ONE APPROVAL, THREE MECHANISMS ────────────────
        // The team RECORD exists (it is written above even when a spawn stopped the sequence), so
        // this is the moment the wave's durable GOAL and its TODO checklist start too — bundled
        // here instead of left to the captain's next turn. The effects are deliberately AFTER the
        // persistence: `dry_run` returned earlier, `create`/`add_member`/`edit` never reach this
        // line, and an approval that throws (empty shell, already approved, executor refusal) does
        // not leak a goal or a checklist. NON-FATAL by contract: see {@link bundleApprovalEffects}.
        await bundleApprovalEffects(ctx, dsh, exec, plan)
        return { plan: approved, team: approvedRecord, created, ...(stoppedAt === undefined ? {} : { stoppedAt }) }
      }

      throw new Error(`agent_teams_plan: unknown action "${action}" (create | add_member | create_task | edit | approve | delete | status)`)
    },
  }))

  toolRegistrations += 1
  disposers.push(dsh.registerTool({
    name: "agent_teams_task",
    description:
      "Shared board tasks: `claim` (freezes the contract), `contract`, `release`, terminal `complete`/`fail` (owner-only; optional `note`/`expected_revision`; a FAIL unblocks dependents), `depend` (append `blocked_by`; owner or lead).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "contract", "release", "complete", "fail", "depend"], description: "What to do." },
        task_id: { type: "string", description: "the task id." },
        claimant: { type: "string", description: "claim: who claims (default: caller)." },
        note: { type: "string", description: "complete/fail: one line on the row." },
        expected_revision: { type: "number", description: "the revision you decided on; stale refused." },
        blocked_by: { type: "array", items: { type: "string" }, description: "depend: blockers to append." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } }, task: { type: "object" }, released: { type: "boolean" }, refused: { type: "string" }, taskId: { type: "string" }, status: { type: "string" }, closedBy: { type: "string" }, attempt: { type: "number" }, revision: { type: "number" }, dependents: { type: "array", items: { type: "object" } }, note: { oneOf: [{ type: "string" }, { type: "null" }] }, added: { type: "array", items: { type: "string" } }, idempotent: { type: "boolean" }, unresolved: { type: "array", items: { type: "string" } } } },
      // THE RELEASE BRANCH COMES FIRST (PR #60 review F2). A successful release ALSO answers the task's
      // new `status` (`pending`), so with `status` checked first the CLOSE line was printed for a
      // release that closed nothing: `T1 -> pending (by undefined, attempt undefined)`. The release
      // line renders BOTH halves honestly — whether a pairing was freed, and where the row now stands.
      render: (_args: any, value: any) =>
        text(
          value?.refused !== undefined ? `refused: ${value.refused}`
            : value?.idempotent !== undefined ? describeDepend(value)
            : value?.released !== undefined
              ? (value.released
                ? `${value.taskId} -> ${value.status ?? "pending"} (pairing freed)`
                : (value.status !== undefined ? `${value.taskId} -> ${value.status} (no pairing to free)` : "that task was not dispatched"))
              : value?.status !== undefined ? `${value.taskId} -> ${value.status} (by ${value.closedBy}, attempt ${value.attempt})`
              : value?.contract !== undefined ? `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}`
              : value?.contracts !== undefined ? `${value.contracts.length} contract(s)`
              : "no contract",
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, session and recorded ancestors; contracts and the ledger live here. */
      const { workspace, sessionId, lineage } = where(exec)
      /** Whether this caller is a recorded delegation child (the C7-4 F5 heal guard). */
      const delegated = sessionIsDelegatedChild(exec)
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")

      if (action === "release") {
        // THE TEAM IS RESOLVED FIRST (R3). The ledger is team-scoped, so the team must be known before
        // a row can be named at all; on an ambiguous roster `resolveForWrite` carries the refusal that
        // names the teams, and the release REFUSES rather than guessing which team's row to free.
        /** The team this release works on, or the sentence saying why none resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The task this release names; the empty string is refused by the task half. */
        const taskId = String(args?.task_id ?? "")
        if (taskId === "") throw new Error("agent_teams_task release: task_id is required")
        // ── WHO MAY RELEASE (PR #60 review F1, CWE-862) ───────────────────────
        // The caller's identity is built EXACTLY as the close branch builds it: its own session id, the
        // session TITLE, the official membership name when there is one, its OWN roster row, and the
        // ancestry `callerIdentity` narrows (a spawned member borrows none). `claimant` is never read
        // here — accepting a name the caller TYPES would let any agent release any row by naming it.
        /** The caller's team identity from the OFFICIAL plane, when that service is mounted at all. */
        const membership = ((): { role?: string; name?: string } | undefined => {
          try { return dsh.teamMembership(exec.agent) as { role?: string; name?: string } | undefined } catch { return undefined }
        })()
        /** The session header title the harness gives this caller (the persona prompt prefix). */
        const title = sessionTitleOf(exec)
        /** The caller's team identity: its member row, and the ancestry it may present. */
        const identity = callerIdentity(resolved.record, sessionId, title, lineage)
        /** The caller's own spellings. */
        const caller = [sessionId, title, String(membership?.name ?? ""), ...(identity.ownMember === undefined ? [] : [identity.ownMember.name]), ...identity.ancestry].filter((value) => value !== "")
        return releaseDispatchedTask(workspace, resolved.record, taskId, typeof args?.expected_revision === "number" ? args.expected_revision : undefined, caller, membership?.role === "lead")
      }

      if (action === "depend") {
        // APPEND-ONLY EDGES (contract: team-tool plan surface §2). The board could grow a row mid-run
        // but never GROW AN EDGE: `create_task` was the only writer of `blockedBy`, and it mints a NEW
        // row — so a lane added after approval could not depend on anything and the DAG stayed flat.
        // This verb wires an EXISTING row and never removes an edge.
        /** The team this call works on, or the sentence saying why none resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The row the caller named. */
        const taskId = String(args?.task_id ?? "")
        if (taskId === "") throw new Error("agent_teams_task depend: task_id is required")
        /** The references to append; `blocked_by` is the documented spelling, its camel twin accepted. */
        const references = stringList(args?.blocked_by ?? args?.blockedBy) ?? []
        if (references.length === 0) throw new Error("agent_teams_task depend: blocked_by is required")
        // Re-read immediately before deciding, the release branch's own discipline: the record was
        // opened above and a concurrent write may have closed the row or moved its revision.
        /** The record as it stands on disk right now. */
        const fresh = readTeam(workspace, resolved.record.teamId) ?? resolved.record
        /** The task as the FRESH record holds it, or the refusal that names what is missing. */
        const task = fresh.tasks.find((candidate) => candidate.id === taskId)
        if (task === undefined) return { taskId, refused: `no task "${taskId}" in team ${fresh.teamId}` }
        // ── WHO MAY WIRE A ROW: the release gate, reused (PR #60 F1 rule) ─────────
        // The caller's identity is built EXACTLY as `release` builds it: its own session id, the session
        // TITLE, the official membership name when there is one, its OWN roster row, and the ancestry
        // `callerIdentity` narrows. A name the caller TYPES is never read.
        /** The caller's team identity from the OFFICIAL plane, when that service is mounted at all. */
        const membership = ((): { role?: string; name?: string } | undefined => {
          try { return dsh.teamMembership(exec.agent) as { role?: string; name?: string } | undefined } catch { return undefined }
        })()
        /** The session header title the harness gives this caller (the persona prompt prefix). */
        const title = sessionTitleOf(exec)
        /** The caller's team identity: its member row, and the ancestry it may present. */
        const identity = callerIdentity(fresh, sessionId, title, lineage)
        /** The caller's own spellings. */
        const caller = [sessionId, title, String(membership?.name ?? ""), ...(identity.ownMember === undefined ? [] : [identity.ownMember.name]), ...identity.ancestry].filter((value) => value !== "")
        /** Why this caller may not wire the row, or undefined when it may. */
        const refusal = authorizeRelease(fresh, taskId, caller, membership?.role === "lead")
        if (refusal !== undefined) return { taskId, refused: refusal }
        // A TERMINAL ROW KEEPS ITS VERDICT: a closure is a fact about work that already happened, so a
        // closed row's edge set is frozen instead of being rewired after the fact.
        if (task.status === "completed" || task.status === "failed") return { taskId, refused: `task ${taskId} is "${task.status}" and its edges are frozen` }
        /** The blocker list with the new references appended; an existing edge is never removed. */
        const merged = [...task.blockedBy]
        /** The entries this call actually APPENDED, in caller order. */
        const added: string[] = []
        /**
         * Whether `fromId`'s own blocker chain REACHES `targetId` (CodeRabbit #11).
         *
         * The board is append-only, so a cycle it stores is permanent: the row would stay `pending`
         * forever (`readyTasks` never releases it) with no verb able to remove the edge. The walk is
         * over the FRESH record, whose edges are already cycle-free, so it terminates.
         * @param fromId - the task id whose ancestors are walked.
         * @param targetId - the id that must not appear among them.
         * @returns true when the chain from `fromId` reaches `targetId`.
         */
        const chainReaches = (fromId: string, targetId: string): boolean => {
          /** The ids already visited, so a malformed stored cycle cannot hang the walk. */
          const seen = new Set<string>()
          /** The ids still to expand. */
          const queue: string[] = [fromId]
          while (queue.length > 0) {
            /** The next id to expand. */
            const id = queue.pop() as string
            if (id === targetId) return true
            if (seen.has(id)) continue
            seen.add(id)
            /** The stored row for that id, when the board holds one. */
            const row = fresh.tasks.find((candidate) => candidate.id === id)
            if (row === undefined) continue
            for (const parent of resolveBlockers(fresh, row.blockedBy).blockedBy) queue.push(parent)
          }
          return false
        }
        for (const reference of references) {
          /** What this one reference resolves to on the board as it stands. */
          const wired = resolveBlockers(fresh, [reference]).blockedBy[0]
          // A SELF-EDGE is refused before any write: the row could never become ready, and this verb
          // cannot remove the edge afterwards. The verb's OWN refusal idiom (`refused`, nothing
          // written) is used, so the renderer paints it like every other refusal.
          if (wired === taskId) return { taskId, refused: `task ${taskId} cannot be its own blocker — a self-edge would leave it pending forever, and depend can never remove an edge` }
          // A CYCLE is refused for the same reason: a blocker that already depends (directly or
          // transitively) on this row would make both rows permanently unready.
          if (chainReaches(wired, taskId)) return { taskId, refused: `${wired} already depends on ${taskId}, so blocking ${taskId} on it would create a cycle — depend appends edges and can never remove one` }
          if (merged.includes(wired)) continue
          merged.push(wired)
          added.push(wired)
        }
        /** What the merged list resolves to: the stored entries, and the ones nothing answered. */
        const outcome = resolveBlockers(fresh, merged)
        // IDEMPOTENT: re-adding an edge is a NO-OP, reported as such — a second call must not move the
        // row's revision or rewrite the record, or two callers wiring the same edge would race.
        if (added.length === 0) return { taskId, task, idempotent: true, added, unresolved: outcome.unresolved }
        /** The record carrying the appended edges; the store recomputes `unresolvedBlockers` beside them. */
        const next = updateTeamTask(fresh, taskId, { blockedBy: merged }, now())
        writeTeam(workspace, withDerivedPhase(next))
        /** The updated row, echoed with both its `blockedBy` and its `unresolvedBlockers`. */
        const view = next.tasks.find((candidate) => candidate.id === taskId) ?? task
        return { taskId, task: view, idempotent: false, added, unresolved: outcome.unresolved }
      }

      if (action === "contract") {
        if (args?.task_id === undefined) return { contracts: listContracts(workspace) }
        /** The frozen contract for the requested task, or undefined when it was never claimed here. */
        const contract = readContract(workspace, String(args.task_id))
        if (contract === undefined) throw new Error(`no contract for task "${String(args.task_id)}" — it has never been claimed through this tool`)
        return { contract }
      }

      if (action === "claim") {
        // THE RECORD IS THE BOARD (W2): the task, its acceptance text and its blockers are read
        // from mpd's own team, so a contract can be frozen in a composition where no backend board
        // exists at all. The `revision` the contract freezes is the record's own, which moves on
        // every mpd mutation and never on somebody else's.
        // THE SPECIFIC SENTENCE WHERE THERE IS ONE: an ambiguous roster gets the refusal that names the
        // teams instead of the standing "approve a plan first", which would be a lie about the cause.
        /** The team this call works on, or the sentence saying why none resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The team this call works on. */
        const record = resolved.record
        /** The task being claimed. */
        const task = record.tasks.find((candidate) => candidate.id === String(args?.task_id ?? ""))
        if (task === undefined) throw new Error(`no task "${String(args?.task_id ?? "")}" in team ${record.teamId}`)
        // ── THE READINESS GATE (R3) ───────────────────────────────────────────
        // PROBE 1, the measured defect: a task blocked by a still-`pending` task was CLAIMED
        // (`in_progress`, `startedAt` stamped) while `agent_teams_dispatch` refused the same pairing with
        // "not ready (blocked by T1)". The claim path is the verb a captain actually uses, so it must ask
        // the SAME question — `assertClaimReady` calls `blockingDependencies`, the predicate `readyTasks`
        // and `taskVisual` are built on — and it asks it BEFORE the contract is written, so a refusal
        // leaves no frozen attempt behind.
        assertClaimReady(record.tasks, task)
        /** The claimer, defaulting to the calling session. */
        const claimant = String(args?.claimant ?? sessionId)
        /** The contract for this attempt, written before the record is told about the claim. */
        const contract = claimContract(workspace, {
          id: task.id,
          subject: task.subject,
          description: task.description,
          blockedBy: task.blockedBy,
          writeScopes: task.writeScopes,
          revision: task.revision,
        }, claimant, now())
        /** The record after the claim: owned, in flight, and carrying the new attempt counter. */
        const claimed = updateTeamTask(record, task.id, { status: "in_progress", owner: claimant === "" ? undefined : claimant, attempt: contract.attempt }, now())
        /** The roster row the claimant names, when the claimant IS a member of this team. */
        const claimedMember = memberNamedBy(claimed, [claimant])
        // THE CLAIMED MEMBER IS `running` AGAIN (PR #60 review F3). This path used to write the task and
        // nothing else, so a SETTLED member woken by a Lead message and claiming its own row stayed
        // `inactive`: the workmate in-use gate read it as free, and `settleMember` only settles a
        // `running` row, so nothing ever corrected it. The roster row is resolved from the claimant's
        // spelling and flipped exactly as a dispatch pass flips the member it paired; a `failed` or
        // `provisioning` row is deliberately left alone, and a claimant the roster does not name is a
        // no-op. THE PHASE IS RE-DERIVED either way, because a claim can take a SETTLED team out of
        // `idle` (R2): the stored phase is what a reader trusts, and leaving it idle beside an in-flight
        // row is the exact drift `withDerivedPhase` exists to prevent.
        /** The record to persist: the claim, plus the member flip when a settled row was named. */
        const next = withDerivedPhase(claimedMember?.status === "inactive" ? updateTeamMember(claimed, claimedMember.id, { status: "running" }) : claimed)
        writeTeam(workspace, next)
        /** This task as the record now holds it. */
        const view = next.tasks.find((candidate) => candidate.id === task.id) ?? task
        return { contract, task: view }
      }

      if (action === "complete" || action === "fail") {
        // THE MISSING TERMINAL VERB (captain amendment, 2026-10-07). The mpd-native plane could open a
        // plan, add members and create tasks, and then NOTHING could close a row: the official
        // `team_task_*` verbs are disabled in a dsh-tui boot (the host refuses the root-bound effect
        // their activation needs), so this board is the only board — and a board whose rows never reach
        // a terminal state can never satisfy a dependency, so `agent_teams_dispatch` could not pair a
        // blocked task and the whole DAG was frozen. MEASURED on this wave's own board.
        // THE SPECIFIC SENTENCE WHERE THERE IS ONE: an ambiguous roster gets the refusal that names the
        // teams instead of the standing "approve a plan first", which would be a lie about the cause.
        /** The team this call works on, or the sentence saying why none resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The team this call works on. */
        const record = resolved.record
        /** The task to close. */
        const taskId = String(args?.task_id ?? "")
        if (taskId === "") throw new Error(`agent_teams_task ${action}: task_id is required`)
        /** The raw calling agent, read for the title the harness gives it. */
        const self = exec.agent as any
        /** The caller's team identity, when the official plane knows one. */
        const membership = ((): { role?: string; name?: string } | undefined => {
          try { return dsh.teamMembership(exec.agent) as { role?: string; name?: string } | undefined } catch { return undefined }
        })()
        /** The session header title the harness gives this caller (the persona prompt prefix). */
        const title = String(self?.session?.header?.title ?? "")
        // ── C7-4 F2: THE MEMBER'S OWN NAME ────────────────────────────────────
        // A member's session id IS the `executorRef` the record kept at spawn, while its row's `owner`
        // may be the member's NAME — and the caller's other spelling is the session TITLE, which in this
        // composition is the persona prompt prefix ("You are the Senior Engineer,"), not a name. So the
        // caller could not normalize to its own row and the captain closed every task by hand. The
        // record ALREADY knows which member this session is: match it by the recorded handle, then fall
        // back to a member name the title CONTAINS, and add that name to the caller's spellings.
        /** The member this session is, as the resolved record names it. */
        // THE ROSTER NAMES THE CALLER BY ITS OWN ID ONLY (PR #42 review F-B, CWE-863): a member's
        // session carries the Lead as its `parentSession`, so searching the roster with the lineage
        // would let a member match the LEAD's spelling and take the Lead close override below.
        /** Who this call's own identity says it is: its member row, and the ancestry it may borrow. */
        const identity = callerIdentity(record, sessionId, title, lineage)
        // THE CALLER'S OWN SPELLINGS, never a name the caller TYPES: `claimant` is deliberately NOT read
        // here, because accepting it would let any agent close any row by naming its owner. `ancestry`
        // is EMPTY for a roster member and is the C7-4 F5 captain-continuity link for everyone else.
        const caller = [sessionId, title, String(membership?.name ?? ""), ...(identity.ownMember === undefined ? [] : [identity.ownMember.name]), ...identity.ancestry].filter((value) => value !== "")
        // RE-READ IMMEDIATELY BEFORE THE CAS, the dispatch pass's own discipline: the record was opened
        // before this branch and a concurrent write may have moved it.
        const fresh = readTeam(workspace, record.teamId) ?? record
        /** The closure decision, or the refusal and its reason. */
        const outcome = casCloseTask(fresh, {
          taskId,
          status: action === "complete" ? "completed" : "failed",
          caller,
          lead: membership?.role === "lead",
          ...(typeof args?.expected_revision === "number" ? { expectedRevision: args.expected_revision } : {}),
          ...(args?.note === undefined ? {} : { note: String(args.note) }),
          now: now(),
        })
        if (!outcome.applied) return { refused: outcome.reason, taskId }
        // R2: SETTLE THE CLOSED TASK'S OWNER DETERMINISTICALLY, in the SAME write as the closure. The
        // owner may be recorded by NAME (a planned owner) while `settleMember` is keyed by the one
        // durable handle (`executorRef`), so the roster row is resolved first. A member that still owns
        // another open task is left `running` by the store's own gate — this call cannot over-settle.
        /** The record after the closure, settled for the member that owned the closed task. */
        let next = outcome.record
        /** The closed task's recorded owner, in whichever spelling the board stamped. */
        const ownerSpelling = outcome.task.owner
        if (ownerSpelling !== undefined && ownerSpelling !== "") {
          /** The roster row that owner names, if any. */
          const owner = memberNamedBy(outcome.record, [ownerSpelling])
          /** The session handle settlement is keyed by; absent while nothing was ever spawned. */
          const ownerHandle = owner?.executorRef
          if (ownerHandle !== undefined && ownerHandle !== "") next = settleMember(outcome.record, ownerHandle, now())
        }
        writeTeam(workspace, withDerivedPhase(next))
        // A FAILED ROW IS RELEASED FROM THE DISPATCH LEDGER, so the repair can be dispatched again on the
        // next pass: the pairing is what makes a member look busy, and a closed row must not hold one.
        // TEAM-SCOPED: only this team's row is freed, never a same-named task of another team.
        /** Whether this closure also freed a dispatch pairing. */
        let releasedFromDispatch = false
        if (outcome.status === "failed") {
          /** The ledger after freeing this row's pairing, and whether one was there to free. */
          const freed = release(readLedger(workspace), record.teamId, taskId)
          if (freed.released) { writeLedger(workspace, freed.ledger); releasedFromDispatch = true }
        }
        rowLogLine("mpd-team-core", `[mpd-team-core] task ${taskId} ${outcome.status} by ${outcome.closedBy}`)
        return {
          taskId,
          status: outcome.status,
          closedBy: outcome.closedBy,
          attempt: outcome.attempt,
          revision: outcome.task.revision,
          note: outcome.task.note ?? null,
          dependents: outcome.dependents,
          releasedFromDispatch,
        }
      }

      throw new Error(`agent_teams_task: unknown action "${action}" (claim | contract | release | complete | fail | depend)`)
    },
  }))

  toolRegistrations += 1
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description:
      "Pair READY shared tasks with IDLE members. `run` pairs each ready task with one idle member and RECORDS the pairing (no second pass can hand it to another member; the ledger is TEAM-SCOPED, so two teams in one workspace never shadow each other). Unpaired tasks are reported with their reason. `release` frees a pairing and reopens the task row to `pending`.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "release"], description: "What to do." },
        task_id: { type: "string", description: "release: the task to free." },
        dry_run: { type: "boolean", description: "run: report, send nothing." },
        limit: { type: "number", description: "run: cap pairs (0/omitted = no cap)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      // `refused` and `holdRead` are declared because BOTH really appear: a pass with no team record
      // is refused, and a watchdog hold that could not be read is REPORTED rather than guessed at.
      // `reaped` is the C7-3 consistency pass's own report: the team ids it marked terminal on disk.
      // `forgotten` carries what the prune dropped: this team's dead rows, LEGACY bare-key rows, and
      // the rows of any team the reap just marked terminal.
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, refused: { type: "string" }, holdRead: { type: "string" }, forgotten: { type: "array", items: { type: "string" } }, reaped: { type: "array", items: { type: "string" } }, released: { type: "boolean" }, taskId: { type: "string" }, status: { type: "string" }, revision: { type: "number" } } },
      render: (_args: any, value: any) =>
        text(
          // `refused` is checked FIRST: a release whose task half refused still carries `released`, and
          // reporting the ledger half alone would present a half-done release as a whole one.
          value?.refused !== undefined ? `refused: ${value.refused}`
            : value?.released !== undefined ? (value.released ? "released" : "that task was not dispatched")
            : value?.halted !== undefined ? `halted: ${value.halted}`
            : (value?.pairs?.length ?? 0) === 0 ? "nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row: any) => row.subject + ": " + row.reason).join("; ") + ")")
            : value.pairs.map((pair: any) => `${pair.subject} -> ${pair.memberName}` + (typeof pair.note === "string" && pair.note !== "" ? ` [${pair.note}]` : "")).join("\n"),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, session and recorded ancestors; the dispatch ledger lives here. */
      const { workspace, sessionId, lineage } = where(exec)
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")

      /** Whether this caller is a recorded delegation child (the C7-4 F5 heal guard). */
      const delegated = sessionIsDelegatedChild(exec)

      if (action === "release") {
        // RESOLVE THE TEAM BEFORE TOUCHING THE LEDGER (R3). The ledger is team-scoped, so a bare task id
        // cannot name a row; and a session on several rosters must be REFUSED rather than guessed at,
        // because freeing the wrong team's pairing would let that team dispatch the task twice.
        /** The team this release works on, or the sentence saying why none resolved. */
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated)
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The task this release names. */
        const taskId = String(args?.task_id ?? "")
        if (taskId === "") throw new Error("agent_teams_dispatch release: task_id is required")
        // NO CAS REVISION ON THIS SURFACE: `expected_revision` lives on `agent_teams_task release`, where
        // the caller has just read the row. This one is the captain's "free that pairing", and it must
        // always be able to repair a stale row.
        // WHO MAY RELEASE is the SAME rule as the task surface (PR #60 review F1, CWE-862), built from
        // the same identity spellings the close branch uses — a member's own roster row, the session
        // title, the official membership name and the narrowed ancestry. A member resolves its team
        // through the roster arm, so without this gate every teammate could unbook a stranger's pairing.
        /** The caller's team identity from the OFFICIAL plane, when that service is mounted at all. */
        const membership = ((): { role?: string; name?: string } | undefined => {
          try { return dsh.teamMembership(exec.agent) as { role?: string; name?: string } | undefined } catch { return undefined }
        })()
        /** The session header title the harness gives this caller (the persona prompt prefix). */
        const title = sessionTitleOf(exec)
        /** The caller's team identity: its member row, and the ancestry it may present. */
        const identity = callerIdentity(resolved.record, sessionId, title, lineage)
        /** The caller's own spellings; no name the caller TYPES is accepted here either. */
        const caller = [sessionId, title, String(membership?.name ?? ""), ...(identity.ownMember === undefined ? [] : [identity.ownMember.name]), ...identity.ancestry].filter((value) => value !== "")
        return releaseDispatchedTask(workspace, resolved.record, taskId, undefined, caller, membership?.role === "lead")
      }

      /** The workspace hold, if any; its reason refuses the WHOLE pass inside `planDispatch`. */
      const hold = readHold(workspace)
      // THE C7-3 CONSISTENCY PASS runs on the ONE write path a team already has: a record that is not
      // live (the hand-patched `archived` phase included, or a plan archived without approval) is
      // rewritten to `ended` WITH a reason here, so a reaped ghost cannot survive on disk and
      // `derivePhase` agrees with it afterwards. Reported as `reaped` so the caller sees the repair.
      // It runs on the `run` action whatever `dry_run` says: the repair is not a dispatch, `dry_run`
      // scopes the PAIRING ("send nothing"), and a ghost left on disk is the defect itself.
      /** The team ids this pass marked terminal on disk. */
      const reaped = reapReapedTeams(workspace, now())
      // A TERMINAL RECORD KEEPS NO DISPATCH ROWS (R1). The prune is anchored on the ONE terminal write
      // path above: the ids it reports are the teams that just ended, and their ledger rows are dropped
      // here so a later team reusing `T1..Tn` cannot inherit a dead pairing. Reported in `forgotten`.
      /** The ledger after dropping every ended team's rows. */
      let ledgerAfterReap = readLedger(workspace)
      /** The task ids the terminal prune forgot, across every team it ended. */
      const terminalForgotten: string[] = []
      for (const endedTeamId of reaped) {
        /** The ledger with this ended team's rows left out. */
        const dropped = forgetTeam(ledgerAfterReap, endedTeamId)
        ledgerAfterReap = dropped.ledger
        terminalForgotten.push(...dropped.forgotten)
      }
      if (terminalForgotten.length > 0) writeLedger(workspace, ledgerAfterReap)
      // The WATCHDOG's hold is a second, per-team pause. It is composed into the same refusal so a
      // caller reads one sentence whichever hold stopped the pass.
      /** This session's team, which names the team a watchdog hold would apply to. */
      const teamId = recordFor(workspace, sessionId, lineage)?.teamId
      // ONE AUTHORITATIVE SOURCE for the watchdog's hold: its own `mpdWatchdog` service, read through
      // the gate call the watchdog documents (`isHeld(teamId, workspace)?.held === true`). A hold that
      // cannot be read is NOT a hold — it is reported as `not-readable` and the pass continues.
      /** The watchdog's reading for this session's team. */
      const watchdog = teamId === undefined ? ({ state: "free" } as WatchdogHoldRead) : readWatchdogHold(workspace, sessionId, lineage)
      /** The refusal reason, whichever of the two holds applies first. */
      const holdReason = hold?.reason ?? (watchdog.state === "held" ? watchdog.reason : undefined)
      /** The honest note a caller reads when the watchdog's hold could not be read at all. */
      const holdNote = watchdog.state === "not-readable" ? `not-readable: ${String(watchdog.reason ?? "the watchdog's hold could not be read")}` : undefined
      // THE RECORD IS THE BOARD (W2). Both loops below read mpd's own team, so a dispatch pass
      // works in a composition where the official service cannot mount — which is the whole point
      // of owning the record — and the readiness rule is the store's own OPT-1 rule rather than a
      // projection of somebody else's.
      /** The team this pass dispatches, or the sentence saying why none resolved. */
      const resolvedDispatch = resolveTeam(workspace, sessionId, lineage)
      if (resolvedDispatch.record === undefined) return { pairs: [], skipped: [], refused: resolvedDispatch.refusal ?? "no team record in this workspace — approve a plan first", ...(reaped.length === 0 ? {} : { reaped }) }
      /** The team this pass dispatches. */
      let record: TeamRecord = resolvedDispatch.record
      // Bound to a const because `record` is REASSIGNED as pairs are accepted, so a captured `let`
      // would change under the two closures below; the tip carries its own `TeamRecord` annotation.
      /** The team as this pass read it. */
      const opened: TeamRecord = record
      /** The tasks this pass may dispatch, by the store's own OPT-1 readiness rule. */
      const readyIds = new Set(readyTasks(opened).map((candidate) => candidate.id))
      /** The board, in the dispatch engine's shape. */
      const tasks = opened.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        // OPT-1: a FAILED blocker does not hold a task back, and `readyTasks` is the ONE place
        // that rule lives, so the dispatch engine cannot drift from the store.
        ready: readyIds.has(task.id),
        blockedBy: task.blockedBy,
        // C7-1: the team this task belongs to, on the task side of the pairing guard.
        teamId: opened.teamId,
        // C7-2: a task with write scopes is a WRITE task, whatever its kind says.
        writeScopes: task.writeScopes,
        ...(task.owner === undefined ? {} : { ownerName: task.owner }),
      }))
      // The roster, in the dispatch engine's shape; the engine pairs only with `inactive` (idle).
      // `idleMembers` counts a SETTLED member (`inactive`) as free, which is what keeps the pool
      // non-empty once R2 writes settlement — the reason settlement and this projection ship together.
      /** The members free to take work right now, by the store's own rule. */
      const idle = new Set(idleMembers(opened).map((member) => member.name))
      // C7-2's SOURCE, read PER CALL and never copied: mpd-roles-plugin's OWN published service, whose
      // `readonly` flag is the same one that decides whether a spawn passes `READONLY_DENY`. The guard
      // FAILS OPEN when the row is absent (no read-only key, so the pairing is left as it was) and says
      // so ONCE, so a composition without the roster can never have its dispatch silently narrowed.
      /** The roster rows the `mpdRoles` service publishes, or none when that row is absent. */
      const rosterRows: readonly RosterRow[] = (() => {
        try {
          /** The mpd-owned roster service; absent in a composition that does not mount the roles row. */
          const roles = (ctx as { get?: (id: string, required?: boolean) => unknown }).get?.("mpdRoles", false) as { list?: () => RosterRow[] } | undefined
          return typeof roles?.list === "function" ? roles.list() : []
        } catch {
          return []
        }
      })()
      if (rosterRows.length === 0) rowLogLine("mpd-team-core", "[mpd-team-core] the mpdRoles service is absent or empty — the C7-2 read-only dispatch guard has no roster to classify against and fails OPEN")
      /** The read-only member keys, indexed from that roster by the shared key rule. */
      const readonlyKeys = readonlyMemberKeys(rosterRows)
      /** The roster in the dispatch engine's shape: a member is `inactive` when it is free. */
      const members = opened.members.map((member) => ({
        id: member.executorRef ?? member.id,
        name: member.name,
        status: idle.has(member.name) ? "inactive" : "running",
        // C7-1: the SAME record's team id on the member side; the guard refuses any mismatch.
        teamId: opened.teamId,
        // C7-2: readonly when the record's role label OR its display name is a read-only roster member
        // (the two spellings of the same specialist); an unknown member is treated as write-capable.
        readonly: isReadonlyMemberName(member.name, readonlyKeys) || (member.role !== undefined && isReadonlyMemberName(member.role, readonlyKeys)),
      }))
      // PRUNE FIRST: a task deleted or completed out of band must not keep its member busy forever.
      // TEAM-SCOPED (R1): this team's rows are pruned against THIS board, other teams' rows pass
      // through untouched, and a LEGACY bare-key row is dropped and reported in `forgotten`.
      const pruned = reconcile(readLedger(workspace), opened.teamId, tasks)
      /** Everything this pass forgot: the ended teams' rows plus the prune's own drops, deduplicated. */
      const forgotten = [...new Set([...terminalForgotten, ...pruned.forgotten])]
      /** The pure decision for this pass: the pairs to dispatch and a reason for every task left out. */
      const plan = planDispatch({
        tasks,
        members,
        // ONLY this team's rows: another team's pairing must not book a member of this roster.
        ledger: ledgerOfTeam(pruned.ledger, opened.teamId),
        ...(holdReason === undefined ? {} : { hold: holdReason }),
        ...(typeof args?.limit === "number" ? { limit: args.limit } : {}),
      })
      if (plan.halted !== undefined || args?.dry_run === true || plan.pairs.length === 0) {
        if (pruned.forgotten.length > 0) writeLedger(workspace, pruned.ledger)
        return { ...plan, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }) }
      }
      // The pass's OWN view of the ledger: the pre-await prune, extended by each accepted pairing.
      // It is deliberately NOT what gets written — the merge before the write (T7) re-reads the file
      // and takes ONLY this pass's `sent` entries from here, so a concurrent release survives.
      /** The ledger this pass carries: the pre-await prune plus its own accepted pairings. */
      let ledger = pruned.ledger
      /** The pairs the transport actually accepted, which are the ones recorded. */
      const sent: typeof plan.pairs = []
      /** The plan's skips plus any pairing whose message failed, so nothing is dropped silently. */
      const skipped = [...plan.skipped]
      for (const pair of plan.pairs) {
        // THE DISPATCH WINDOW (CodeRabbit #81 D2): the send below cold-resumes an absent child, whose
        // first `agent/pre-step` runs BEFORE this pass writes the owner. The window is open around the
        // WHOLE pairing — send, re-read and compare-and-set — so that first step is neither marked idle
        // nor denied (the claim the dispatch exists to hand over would otherwise be lost). A genuinely
        // taskless member never enters a window and keeps the hard denial.
        const endDispatchWindow = idleGuard.beginDispatch(pair.memberId)
        try {
          /** The board's own record for this pair, used for the acceptance text. */
          const task = tasks.find((candidate) => candidate.id === pair.taskId)
          try {
            // DELIVERED THROUGH THE EXECUTOR, which on the native backend cold-resumes a child that
            // is not currently live — the behaviour a dispatch pass depends on.
            await executor().send(exec.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String((task as any).description ?? "")), exec.signal)
            // COMPARE-AND-SET (T2), AFTER the await and never before it. `opened` was read before the
            // loop, and another caller — a member's own `agent_teams_task {action:"claim"}` — may have
            // written the record while this pass was suspended. Re-reading here and applying the patch
            // to the FRESH record is what keeps that write: a blind `writeTeam(record)` rewrote the
            // whole file from the stale snapshot and silently reverted it. The pairing is still
            // recorded in the RECORD as well as the ledger — the assignment is what makes the member
            // non-idle on the NEXT pass, and a ledger alone would leave the record claiming the task
            // is unowned.
            /** The record as it stands on disk right now. */
            const onDisk = readTeam(workspace, opened.teamId)
            if (onDisk === undefined) {
              skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: "the team record disappeared while the pass was in flight" })
              continue
            }
            /** The revision this pass's decision was based on, from the record it has been carrying. */
            const expected = record.tasks.find((candidate) => candidate.id === pair.taskId)?.revision
            if (expected === undefined) {
              skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `task ${pair.taskId} is no longer on the pass's board` })
              continue
            }
            /** The compare-and-set outcome for this pairing. */
            const claimed = casClaimTask(onDisk, pair.taskId, pair.memberName, expected, now())
            if (!claimed.applied) {
              // REPORTED, not silently dropped: the message was delivered, but the board's own record
              // refused the claim, so the caller must see why the task is not marked in flight.
              skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the board refused the claim: ${claimed.reason}` })
              continue
            }
            // The FRESH record, carrying this one pairing and everything a concurrent writer added.
            record = claimed.record
            // THE PAIRED MEMBER IS `running` AGAIN (R2). Settlement writes `inactive` once a member owns
            // no open task, so a pass that pairs a settled member must flip the row back — otherwise the
            // record would report idle work and the next settlement pass could race the claim.
            // The phase is re-derived with the claim: pairing a SETTLED member takes the team out of
            // `idle`, and a stored phase that disagrees with the row is a ghost a reader would trust.
            record = withDerivedPhase(updateTeamMember(record, pair.memberName, { status: "running" }))
            writeTeam(workspace, record)
            ledger = assign(ledger, { teamId: opened.teamId, taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName }, now())
            sent.push(pair)
          } catch (error) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String((error as Error)?.message ?? error)}` })
          }
        } finally {
          endDispatchWindow()
        }
      }
      // MERGE (T7), never a blind overwrite. `pruned` was read BEFORE the first `await`, and the
      // ledger has a SECOND writer that runs across this pass's suspension — `agent_teams_task
      // {action:"release"}` reads the same file and writes it back with one entry removed. Writing
      // this pass's whole pre-await map back erased that release: the member stayed recorded as busy
      // and the freed task could never be dispatched again. So the map is re-read, re-pruned against
      // the SAME board this pass decided on, and only this pass's OWN accepted operations are applied.
      /** The ledger as it stands on disk right now, pruned by the rule `pruned` was built with. */
      const fresh = reconcile(readLedger(workspace), opened.teamId, tasks)
      /** The merged ledger: everything a concurrent writer left, plus this pass's own pairings. */
      const merged: DispatchLedger = { ...fresh.ledger }
      // DELIBERATE CONFLICT RULE: when the fresh read shows that a task THIS PASS ASSIGNED was
      // meanwhile released, the pass's assignment still wins — the send really went out, so recording
      // it is the honest outcome, and dropping it would leave a delivered task unowned on the board.
      // Only `sent` is re-applied; an entry this pass merely inherited is never resurrected.
      for (const pair of sent) merged[ledgerKey(opened.teamId, pair.taskId)] = ledger[ledgerKey(opened.teamId, pair.taskId)]
      writeLedger(workspace, merged)
      return { pairs: sent, skipped, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }) }
    },
  }))

  // ── the mailbox: OURS, with a read state the harness cannot provide ─────────
  //
  // The official mailbox keeps `messages` and `delivered` and nothing else — "read" is not observable
  // anywhere in it, so a captain's real question ("did they SEE it?") has no answer there. This
  // sidecar owns the whole `sent → delivered → read` lifecycle; delivery still rides the official
  // transport so a member really receives the message. `mailbox-store.ts` holds the rules.
  toolRegistrations += 1
  disposers.push(dsh.registerTool({
    name: "agent_teams_mail",
    description:
      "The team mailbox. `send` messages one member (through the official transport) and records it; `unread` lists what a member has NOT acknowledged; `read` acknowledges ids; `summary` counts total/unread/undelivered per member. Delivery and reading are separate facts: a message the transport accepted is still unread until the recipient acknowledges it.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "unread", "read", "summary"], description: "What to do." },
        to: { type: "string", description: "send: the member name or id to message." },
        subject: { type: "string", description: "send: one line the recipient sees first." },
        body: { type: "string", description: "send: the message." },
        member: { type: "string", description: "unread: whose inbox (defaults to the caller)." },
        ids: { type: "array", items: { type: "string" }, description: "read: the message ids to acknowledge." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, scope: { type: "string" }, legacyUnstamped: { type: "number" }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" } } },
      render: (_args: any, value: any) =>
        text(
          value?.refused !== undefined ? `refused: ${value.refused}`
            : value?.message !== undefined ? `sent ${value.message.id} to ${value.message.toName}`
            : value?.moved !== undefined ? `acknowledged ${value.moved.length} message(s)`
            // C7-4 F3: the scope is printed, so a workspace-global fold is never mistaken for this team's.
            // F-C adds the counted legacy note: an unstamped row is left out of a team-scoped answer, and
            // the caller reads HOW MANY rather than a silently smaller total.
            : value?.summary !== undefined ? (value.summary.length === 0 ? `no mail (${value.scope ?? "workspace"} scope)` : value.summary.map((row: any) => `${row.memberName}: ${row.unread} unread / ${row.total} total`).join("\n") + ` (${value.scope ?? "workspace"} scope)`) + (typeof value?.legacyUnstamped === "number" ? ` · ${value.legacyUnstamped} unstamped row(s) excluded (sent before team stamping)` : "")
            : (value?.messages?.length ?? 0) === 0 ? "nothing unread"
            : value.messages.map((mail: any) => `${mail.id} from ${mail.fromName}: ${mail.subject}`).join("\n"),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, session and recorded ancestors; the mailbox log lives here. */
      const { workspace, sessionId, lineage } = where(exec)
      /** The caller's id, used when the payload carries no session of its own. */
      const caller = sessionId
      /** The raw calling agent, read for the display name the official payload carries. */
      const self = exec.agent as any
      // THE RECORD IS THE ROSTER (W2): a mailbox call must answer with no official plane mounted,
      // and the handle a message is delivered to is the one the EXECUTOR recorded at spawn time.
      /** This session's team, when one was approved here (C7-4 F5: its recorded ancestors count too). */
      const mailTeam = recordFor(workspace, caller, lineage)
      /** The roster in the shape this tool addresses members by: id OR name, plus the handle. */
      const roster = (mailTeam?.members ?? []).map((member) => ({ id: member.id, name: member.name, status: member.status, handle: member.executorRef ?? "" }))
      /** Resolve a member by name OR by id, because a captain addresses people by name. */
      const resolve = (name: string): { id: string; name: string; status: string; handle: string } | undefined => roster.find((member) => member.id === name || member.name === name)

      if (args?.action === "send") {
        /** The addressed member, or undefined — in which case the refusal names the whole roster. */
        const target = resolve(String(args?.to ?? ""))
        if (target === undefined) {
          return { refused: `"${String(args?.to ?? "")}" is not a member of this team (members: ${roster.map((m) => m.name).join(", ") || "none"})` }
        }
        /** The store's verdict: the recorded message, or the refusal and its reason. */
        const result = sendMail(workspace, {
          fromId: self?.session?.id ?? caller,
          fromName: self?.session?.header?.title ?? caller,
          toId: target.id,
          toName: target.name,
          subject: String(args?.subject ?? ""),
          body: String(args?.body ?? ""),
          memberIds: roster.map((member) => member.id),
          // THE TEAM STAMP (PR #42 review F-C): `toId` is a per-team id every team reuses, so the row's
          // team identity is recorded HERE, at the one moment the sending team is known.
          ...(mailTeam === undefined ? {} : { teamId: mailTeam.teamId }),
        }, now())
        if (!result.ok) return { refused: result.detail }
        // The transport carries it; a delivery failure does NOT lose the record — the message stays
        // undelivered in the ledger, which is exactly what `summary` reports.
        try {
          // A member with no handle was never raised, so there is nothing to deliver to and the
          // message stays UNDELIVERED in the ledger — which is exactly what `summary` reports.
          if (target.handle === "") throw new Error(`${target.name} has no executor handle — it was never raised`)
          await executor().send(exec.agent, target.handle, `[${result.message.subject}]\n\n${result.message.body}`, exec.signal)
          markDelivered(workspace, [result.message.id], now())
        } catch (error) {
          rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${result.message.id} but the transport refused it: ${String((error as Error)?.message ?? error)}`)
        }
        return { message: result.message }
      }

      if (args?.action === "read") {
        return { moved: markRead(workspace, Array.isArray(args?.ids) ? args.ids.map(String) : [], now()) }
      }

      if (args?.action === "summary") {
        /** The folded ledger, read ONCE so every count below describes the same read. */
        const state = readMailbox(workspace)
        /** The whole fold's per-member summary — what a caller with no resolved team reads. */
        const rows = summarise(state)
        // ── C7-4 F3 + PR #42 review F-C: THE SCOPE IS TEAM IDENTITY, NOT MEMBER IDS ──
        // The fold is WORKSPACE-GLOBAL, so a brand-new team read a stale roster from a wave that ended
        // days earlier (C7-4 F3). The first fix filtered on member ids, names and handles — but every
        // team mints its members from `M1` upward, so a stale row addressed to the OLD `M1` matched the
        // NEW team's `M1` and was still counted under `scope:"team"` (F-C). A row of this team is now
        // the row whose `teamId` stamp IS this team's — the identity, never a reusable id.
        if (mailTeam === undefined) return { summary: rows, scope: "workspace" }
        /** The messages stamped with THIS team's identity — the only rows this team can claim. */
        const mine = state.messages.filter((message) => message.teamId === mailTeam.teamId)
        // THE LEGACY RULE, stated rather than guessed: a row with NO stamp predates the field, so no team
        // can PROVE it owns it — it is EXCLUDED and COUNTED in the answer. Claiming every unstamped row
        // that merely matches this team's member ids is the defect itself; the `createdAt` fallback
        // cannot close it either, because an OLDER team that is still live mints the same `M1` and its
        // rows would be admitted whenever they were sent after this team's `createdAt`.
        /** Unstamped rows this scoped answer left out, so the exclusion is visible and never silent. */
        const legacyUnstamped = state.messages.length - state.messages.filter((message) => message.teamId !== undefined).length
        return { summary: summarise({ messages: mine }), scope: "team", ...(legacyUnstamped === 0 ? {} : { legacyUnstamped }) }
      }

      /** The folded mailbox, read once so the unread/undelivered/total counts agree. */
      const state = readMailbox(workspace)
      /** The member whose inbox was asked for, when the call named one. */
      const wanted = args?.member === undefined ? undefined : resolve(String(args.member))
      /** The inbox owner: the named member, else the caller's own session. */
      const memberId = wanted?.id ?? self?.session?.id ?? caller
      return {
        messages: unreadMessages(state, memberId).map((message) => ({
          id: message.id,
          fromName: message.fromName,
          subject: message.subject,
          body: message.body,
          sentAt: message.sentAt,
          delivered: message.deliveredAt !== undefined,
        })),
        undelivered: undeliveredOf(state, memberId).length,
        total: inboxOf(state, memberId).length,
        memberName: wanted?.name ?? memberId,
      }
    },
  }))

  toolRegistrations += 1
  disposers.push(dsh.registerTool({
    name: "agent_teams_control",
    description:
      "Halt or resume the team. `halt` stops NEW DISPATCH and leaves the team and every teammate alive (use agent_teams_plan action:\"delete\" to end a team). `resume` clears the hold.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["halt", "resume"], description: "What to do." },
        reason: { type: "string", description: "halt: why the team is halted; shown to anyone who asks for status." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { hold: { type: "object" }, resumed: { type: "boolean" } } },
      render: (_args: any, value: any) =>
        text(value?.resumed !== undefined ? (value.resumed ? "resumed" : "was not halted") : value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, where the hold record lives. */
      const { workspace } = where(exec)
      if (String(args?.action ?? "") === "resume") return { resumed: clearHold(workspace) }
      if (String(args?.action ?? "") !== "halt") throw new Error(`agent_teams_control: unknown action "${String(args?.action ?? "")}" (halt | resume)`)
      return { hold: placeHold(workspace, String(args?.reason ?? ""), sessionIdOf(exec), now()) }
    },
  }))

  // ── the command ─────────────────────────────────────────────────────────────
  disposers.push(dsh.registerCommand({
    name: "agent-teams",
    description: "Stage a team for the current goal: /agent-teams <what the team is for>",
    input: { hint: "what the team is for" },
    handler: async (invocation: any) => {
      /** The command's workspace: a command has no tool exec, so it resolves from the process view. */
      const workspace = dsh.workspaceRoot()
      /** The invoking session, so the plan is staged where that session will approve it. */
      const sessionId = sessionIdOf({ agent: invocation?.agent } as DshToolExec)
      /** The command's argument, trimmed; empty means the user gets usage instead of a plan. */
      const goal = String(invocation?.rawInput ?? "").trim()
      if (goal === "") {
        // THE NAMES ARE THE REGISTERED ONES. These lines used to send the user to `agent_teams_approve`,
        // `agent_teams_add_member` and `agent_teams_create_task` — three tools the RETIRED vendored
        // plugin registered and this one does not. The real surface is the `action` enum on
        // `agent_teams_plan`, so a user following the old sentence looked up a tool that is not there.
        return { kind: "message", text: "Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_plan {action: \"approve\"}." }
      }
      /** The staged plan, awaiting approval — which the reply says explicitly. */
      const plan = stagePlan(workspace, sessionId, { name: goal.slice(0, 60), description: goal, approval: "required" }, now())
      return {
        kind: "message",
        text: `Staged ${describePlan(plan)}.\nAdd members and tasks with agent_teams_plan {action: \"add_member\" | \"create_task\"}, then approve with agent_teams_plan {action: \"approve\"}. Nobody is spawned before that.`,
      }
    },
  }))

  // ── THE TEAM DOOR: mpd is the SINGLE team front door ─────────────────────────
  // ONE `tools.guard` registration (process-wide and monotonic) refuses the five official AUTHORING verbs
  // and teaches the mpd door in the refusal itself — the whole contract and the reason the delegation
  // gate's preset bypass is NOT mirrored live in `./team-door-guard.ts`. It is installed HERE, after the
  // tool/command surface and before the boot line, so the line below can report it without guessing.
  /** The door's outcome: a composition without the `tools.guard` seam warns once instead of failing. */
  const teamDoor = installTeamDoorGuard(dsh, { warn: (line: string): void => { rowLogLine("mpd-team-core", line) } })
  if (teamDoor.dispose !== undefined) disposers.push(teamDoor.dispose)

  // A durable sidecar that survives a reload is the only thing this plugin keeps; report it once
  // so a boot log shows the plane is live without a tool call.
  const root = (() => { try { return dsh.workspaceRoot() } catch { return "" } })()
  if (root !== "") {
    try {
      /** The staging directory whose file count is the boot line's "staged" number. */
      const staging = join(root, ".mpd", "team", "staging")
      /** How many sessions currently have a staged plan in this workspace. */
      const pending = existsSync(staging) ? readdirSync(staging).filter((file) => file.endsWith(".json")).length : 0
      // The count is DERIVED from the registrations this apply() made: a literal here said "10" while
      // the plane had grown to 12, which is exactly the kind of boot line a reader trusts and should
      // not.
      // COUNT WHAT IT SAYS: `disposers` holds the tool registrations AND the command, so calling the
      // total "tools" read 14 for 13 tools. The label is the honest one now.
      // DERIVED, both numbers: `disposers` holds the tool registrations plus the ONE command this
      // apply() registers last. The literal that used to sit here said "13 tools" while the plane had
      // grown to 14 — a boot line a reader trusts must not be hand-maintained.
      // THE EXECUTOR IS NAMED ON A LOG LINE, because which backend raises a member is the ONE fact
      // an operator needs when a team behaves differently than expected — and because a silent fall
      // back to the official plane is exactly the regression the split exists to prevent.
      //
      // TIMING, MEASURED: `subagents` is a HOST-plane service and this row can apply BEFORE it is
      // ACTIVE, so an apply-time read answers "unavailable" in a perfectly healthy composition
      // (`evidence/dsh-qa/preset-conformance/*/boot.log`, the run that produced the deferred branch
      // below). The TOOLS are unaffected — every call re-resolves the executor lazily, which is why
      // that is the design — so only this LINE has to wait for the binding to become true.
      /** Log the executor as it stands right now. Called at apply, and again on a late binding. */
      const reportExecutor = (): void => {
        /** The executor at this instant, contained: the seam is total but a log line must not throw. */
        const view = (() => { try { return executor() } catch (error) { return { kind: "unavailable", reason: String((error as Error)?.message ?? error) } } })()
        rowLogLine("mpd-team-core", `[mpd-team-core] team executor: ${view.kind} (${view.reason})`)
      }
      rowLogLine("mpd-team-core", `[mpd-team-core] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${toolRegistrations} tools + the /agent-teams command${teamDoor.installed ? " + the team-door guard" : ""})`)
      reportExecutor()
      // ── THE WEB ROUTE: the mpd team, served to the browser ───────────────────
      // Registered through the adapter's `webServerOf()` (never a raw ctx service read), and
      // re-attempted when the web server binds LATER — the same host-plane ordering that made the
      // executor line lie once already, so the second attempt is not speculative.
      /**
       * The workspace a BROWSER request is attributed to, resolved from the session it names.
       *
       * WHY THE QUERY'S SESSION DECIDES (measured 2026-10-19, Docker web lane): a route request has no
       * agent exec, so `dsh.workspaceRoot()` alone falls through to the dsh process cwd — `/work` in
       * that lane while the panel's session lives in `/work/ws`. The panel then read a workspace with
       * no team and rendered "No team in this workspace yet" beside a completed board. The session's
       * own root is discovered from the artifact that names it (the bound team record, or the staged
       * plan before approval), over the adapter's documented `workspaceRootsAll()` union; a
       * single-root composition answers that root for a session with neither yet, and only an
       * ambiguous composition falls back to the process root.
       *
       * @param sessionId - the session the request's query names, or "" for a session-less read.
       * @returns the absolute workspace root the read belongs to.
       */
      const workspaceForRequest = (sessionId: string): string => {
        if (sessionId === "") return dsh.workspaceRoot()
        // THE AUTHORITATIVE ANSWER FIRST: the agent registry knows this session's own cwd, so a live
        // session is resolved WITHOUT inferring anything from its artifacts. The scan below is the
        // fallback for a registry that does not expose the id (an older host, an agentless boot).
        try {
          /** The workspace of the live session this request names, when the adapter can resolve it. */
          const own = dsh.workspaceRootForSession(sessionId)
          if (own !== undefined && own !== "") return own
        } catch {
          // A composition whose adapter predates the method falls through to the artifact scan.
        }
        /** The live session roots, plus the process root as a last resort. */
        const roots = dsh.workspaceRootsAll()
        for (const root of roots) {
          try {
            if (recordFor(root, sessionId) !== undefined) return root
            if (readPlan(root, sessionId) !== undefined) return root
          } catch {
            // One unreadable root must not blind the scan of the others.
          }
        }
        // NO FALLBACK FOR A NAMED SESSION (CodeRabbit round 2, Major): if neither the live registry
        // nor a workspace artifact claims this id, answering from `roots[0]` / the process root would
        // let a bogus id read ANOTHER workspace's team listings, contracts, holds or mailbox. The
        // request is refused instead; a SESSION-LESS read (`sessionId === ""`) keeps the process-root
        // behaviour above, which is what a panel outside a session means.
        throw new Error(`mpd-team-core: no workspace is bound to session "${sessionId}" — refusing to answer from another workspace`)
      }
      /** Register the route against whatever web server this composition has right now. */
      const mountTeamRoute = (): boolean => registerTeamRoutes(dsh.webServerOf() as never, {
        recordFor: (sessionId: string) => recordFor(workspaceForRequest(sessionId), sessionId),
        workspace: (sessionId?: string) => workspaceForRequest(sessionId ?? ""),
        // THE HOST'S FENCE, delegated through the adapter: the same Host/Origin check and browser/API
        // credential check the harness's own `/api` routes use. See `webRequestRejection`.
        authorize: (request: unknown) => dsh.webRequestRejection(request),
        executor: () => {
          /** The executor as of this request, contained so a route never throws into a response. */
          const view = executor()
          return { kind: view.kind, reason: view.reason }
        },
        effect: (fn: () => unknown, label: string) => { try { return ctx?.effect?.(fn, label) } catch { return undefined } },
        warn: (line: string) => rowLogLine("mpd-team-core", `[mpd-team-core] ${line}`),
        // The SAME feed the service publishes, handed to the stream route as its two doors. A route
        // that had its own feed would be a second observer of the same writes and a second watcher on
        // the same directory — the exact duplication the ONE substrate exists to prevent.
        subscribe: (workspace: string, listener: () => void) => feed.subscribe(workspace, listener),
        revision: (workspace: string) => feed.revision(workspace),
        // THE SAME COMPUTATION SITE the service answers: the route asks for the model by TEAM, so the
        // payload and the TUI cannot draw different graphs for one record.
        graph: (workspace: string, teamId?: string) => graphOf(workspace, teamId),
      })
      // Mounted ONCE here and retried on the binding below; the route is idempotent by path on the
      // host's own registry, and a second registration attempt against the SAME server is harmless
      // because the composition only ever has one.
      if (mountTeamRoute()) rowLogLine("mpd-team-core", `[mpd-team-core] team web routes: ${TEAM_ROUTES.join(" ")}`)
      try {
        dsh.onServiceBound(["webServer", "httpServer"], () => { mountTeamRoute() })
      } catch { /* an adapter without the seam keeps the single attempt above */ }

      // Re-report ONCE when the NATIVE backend's service binds, so the line the operator reads is
      // the composition's real answer rather than an ordering artefact. A composition that never
      // binds it keeps the apply-time line, which is the honest thing to print.
      //
      // ONLY `subagents` IS NAMED, and not the official service beside it: naming that service by
      // string outside the adapter is EXACTLY what the D6 gate forbids (`node
      // packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts` reported this line the
      // first time it was written with both). The gate is right, and nothing is lost — the executor
      // re-resolves its backend on every CALL, so a late-binding official service is picked up
      // where it matters whether or not this line is ever re-printed.
      try {
        dsh.onServiceBound(["subagents"], () => reportExecutor())
      } catch { /* an adapter without the seam keeps the apply-time line */ }
    } catch { /* a read-only workspace must not break the boot */ }
  }

  // ── R2: THE TURN-BOUNDARY SETTLEMENT — the backstop the deterministic call cannot cover ──────
  //
  // `complete`/`fail` settles the CLOSED TASK'S OWNER, which covers a member closing its own row. The
  // other order — the Lead closes a member's stranded row, or the row is repaired out of band — leaves
  // the member `running` with nothing to do, and NOTHING else in the process would ever write
  // `inactive`: `derivePhase` stayed `active`, the compaction pass could never read a team as finished,
  // the TUI drew a member working forever, and the workmate in-use gate never released. This listener
  // settles the member when ITS OWN TURN ENDS — the one instant the harness reports a session between
  // turns for a session that wants nothing.
  //
  // SERIAL-DISPATCH SAFETY (binding): `agent/turn-stopping` is a `serial` dispatch — a listener that
  // RETURNS a value BAILS the rest of the chain, and a returned promise is awaited. This handler
  // therefore returns NOTHING, contains its own failures, and does the work in a detached async block;
  // the record is RE-READ inside that block (never the snapshot a tool call opened) and written only
  // when the settlement actually changed it (identity is the store's "nothing changed" signal).
  if (typeof dsh.onEvent === "function") {
    /** The disposer the event bus handed back, pushed so a row reload cannot leave a stale listener. */
    const offTurnStopping = dsh.onEvent("agent/turn-stopping", (payload: unknown): undefined => {
      try {
        /** The agent whose turn is ending, taken from the payload instead of a registry lookup. */
        const agent = (payload as { agent?: { session?: { id?: unknown; header?: { cwd?: unknown } } } } | undefined)?.agent
        /** The settling session id, which is the `executorRef` a member row records. */
        const sessionId = String(agent?.session?.id ?? "")
        if (sessionId === "") return undefined
        /** The session's own cwd, which outranks the process-wide workspace root on every event path. */
        const cwd = String(agent?.session?.header?.cwd ?? "")
        /** The workspace this settlement belongs to. */
        const workspace = cwd !== "" ? cwd : dsh.workspaceRoot()
        if (workspace === "") return undefined
        void (async () => {
          try {
            for (const team of listTeams(workspace)) {
              if (!team.members.some((member) => member.executorRef === sessionId)) continue
              /** The record as it stands on disk RIGHT NOW, never a snapshot from an earlier read. */
              const fresh = readTeam(workspace, team.teamId)
              if (fresh === undefined) continue
              /** The record after settlement; the SAME object when the member still owns open work. */
              const settled = settleMember(fresh, sessionId, now())
              if (settled === fresh) continue
              writeTeam(workspace, withDerivedPhase(settled))
              rowLogLine("mpd-team-core", `[mpd-team-core] member ${sessionId} settled to inactive in ${team.teamId}`)
            }
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] turn-boundary settlement failed: ${String((error as Error)?.message ?? error)}`)
          }
        })()
      } catch (error) {
        rowLogLine("mpd-team-core", `[mpd-team-core] turn-boundary listener failed: ${String((error as Error)?.message ?? error)}`)
      }
      // A `serial` listener that returns a value BAILS the chain; `undefined` is the only safe answer.
      return undefined
    })
    if (typeof offTurnStopping === "function") disposers.push(offTurnStopping)
  }

  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}

// Re-exported for the unit tests, which drive the state machine without a ctx.
export { addMember, addTask, archivePlan, claimContract, clearHold, listContracts, placeHold, readContract, readHold, readPlan, stagePlan, writePlan, newPlanId }
export * from "./plan-store"
