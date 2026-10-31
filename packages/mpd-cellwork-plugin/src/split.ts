// CELLWORK SPLIT — the submitted task graph, MEASURED and VALIDATED before anything is materialised
// (contract B6, plan §4.5).
//
// WHAT THIS MODULE REFUSES TO TRUST. A splitter is an agent, and an agent's self-reported cost is not a
// measurement: every declared input is `stat`-ed and sampled by {@link measureInput}, every task's window
// is READ from the adapter's catalog (or an operator override), and the graph is checked against the
// rules the plan states rather than against the splitter's confidence. A refused split still WRITES its
// verdict — to `split/<revision>.refused.json`, beside (never on top of) an accepted record — because the
// breakdown is what tells the splitter how much to cut (C9/D8).
//
// THE GRAPH RULES (contract B6, plus C1):
//   * every task answers its dependency with `blockedBy` (an array, `[]` = explicit root) or
//     `independent: true`;
//   * references name tasks in the same split;
//   * the graph is ACYCLIC;
//   * two tasks may share a write scope only when a dependency path orders them;
//   * every `verify: true` task has exactly one review task owned by a DIFFERENT role, and that review
//     is blocked by the task it reviews;
//   * every owner role exists in the roster or is a cell role;
//   * a task MAY declare its board `member` (several members per role, several tasks per member), the
//     name must be usable, and one member may not carry two different owner roles.
//
// Everything here is pure apart from `node:fs`; the window reader and the clock are injected.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { atomicWriteText, refusedSplitPath, splitPath, CELL_SPLIT_DIR, cellDir } from "./state"
import { applyBudget, estimateTask, measureInput, type BudgetVerdict, type TaskEstimate, type WindowReading } from "./budget"
import type { CellworkConfig } from "./config"

/** The task kinds a split may declare; anything else is refused rather than defaulted. */
export const SPLIT_KINDS: readonly string[] = ["requirement", "work", "review", "repair", "integration"]

/** The cell's OWN planning roles, which a split may name as an owner without them being on the roster. */
export const CELL_ROLES: readonly string[] = ["cell-planner", "cell-splitter"]

/** One task of a submitted split, in the shape B6 fixes. */
export interface SplitTaskInput {
  /** Stable key the rest of the graph references (`T1`, `work-a`, …); also the contract file name. */
  key: string
  /** One-line title the board shows. */
  subject: string
  /** The acceptance text the owner receives. */
  description: string
  /** The chain kind; omitted means `work`. */
  kind?: string
  /** The roster (or cell) role that owns the task. */
  ownerRole: string
  /**
   * The BOARD MEMBER this task is raised for; absent means the member name IS the owner role (C1).
   *
   * Several tasks MAY share one member and several members MAY share one owner role — that is how one
   * role gets more than one concurrent seat instead of queueing every task on a single agent. The name
   * is judged by {@link memberProblem} and resolved by {@link resolvedMember}.
   */
  member?: string
  /** Paths the task may write. */
  writeScopes: readonly string[]
  /** Keys of tasks that must close first; absent means "not declared" and is a refusal. */
  blockedBy: readonly string[] | undefined
  /** The explicit root declaration, an alternative to `blockedBy: []`. */
  independent: boolean
  /** Declared input paths, MEASURED by the plugin rather than priced by the splitter. */
  inputs: readonly string[]
  /** Whether this task's work must be verified by a review task. */
  verify: boolean
}

/** One split submission: the graph plus the requirements revision it was written against. */
export interface SplitSubmission {
  /** The requirements revision this split targets; it must match the accepted one. */
  revision: number
  /** The tasks, in submission order. */
  tasks: readonly SplitTaskInput[]
}

/** One graph-rule violation, keyed by the task it is charged to. */
export interface GraphFinding {
  /** The task key the finding names. */
  taskKey: string
  /** A stable machine-readable code (rendered beside the sentence). */
  code: string
  /** One sentence saying what is wrong and what the splitter must change. */
  detail: string
}

/** One role's window reading, kept on the verdict so a reader can audit the certification. */
export interface RoleWindowRecord {
  /** The role exactly as a task declared it. */
  role: string
  /** The resolved provider id, or "". */
  provider: string
  /** The resolved model id, or "". */
  model: string
  /** The readable window, or null when uncertified. */
  window: number | null
  /** How the window was certified, or `uncertified`. */
  provenance: string
  /** Why it is uncertified; absent when certified. */
  reason?: string
}

/** One task's measured verdict. */
export interface SplitTaskVerdict {
  /** The task's key. */
  key: string
  /** The task's title. */
  subject: string
  /** The owner's acceptance text, carried into the frozen contract. */
  description: string
  /** The task's kind. */
  kind: string
  /** The owner role, as declared. */
  ownerRole: string
  /** The RESOLVED board member name: the declared `member` (trimmed), else the owner role. */
  member: string
  /** The declared write scopes. */
  writeScopes: readonly string[]
  /** The declared blockers (resolved to keys, as written). */
  blockedBy: readonly string[]
  /** The declared inputs, with their measurements. */
  inputs: TaskEstimate["inputs"]
  /** Whether this task wants a review. */
  verify: boolean
  /** The measured estimate, every term retained. */
  estimate: TaskEstimate
  /** The budget verdict for this task. */
  budget: BudgetVerdict
  /** Whether this task passes every condition (graph findings are reported separately). */
  accepted: boolean
}

/** The complete measured verdict one submission produced. */
export interface SplitVerdict {
  /** Format version; a reader refuses an unknown one. */
  version: 1
  /** The cell the split belongs to. */
  cellId: string
  /** The requirements revision this split targeted. */
  revision: number
  /** The instant the verdict was written. */
  submittedAt: string
  /** Whether the whole graph was accepted. */
  accepted: boolean
  /** Every graph-rule violation, in task order. */
  findings: GraphFinding[]
  /** Every distinct owner role's window reading. */
  roles: RoleWindowRecord[]
  /** Every task's measured verdict, in submission order. */
  tasks: SplitTaskVerdict[]
  /** The summed estimates and the counts a renderer shows. */
  totals: { estimate: number; taskCount: number; acceptedCount: number; refusedCount: number }
  /**
   * The absolute path this verdict was persisted to.
   *
   * The path NAMES the outcome (C9/D8): an ACCEPTED verdict lands at the canonical per-revision file
   * (`split/<revision>.json`), while EVERY refusal lands beside it at `split/<revision>.refused.json`, so
   * a refusal always has an artifact and an accepted record is never overwritten.
   */
  file?: string
}

/** What {@link submitSplit} needs: where to measure, the roster, the window reader and the clock. */
export interface SubmitDeps {
  /** The caller's workspace root (declared inputs resolve against it). */
  workspace: string
  /** The cell the split belongs to. */
  cellId: string
  /** The resolved knobs. */
  config: CellworkConfig
  /** The roster names the graph is validated against (`mpdRoles.list()`), plus {@link CELL_ROLES}. */
  roster: readonly string[]
  /** Read one role's window; called once per distinct role. */
  window: (role: string) => Promise<WindowReading>
  /** The instant to stamp on the verdict. */
  now: Date
}

/** A split's key normalised for comparison: lowercase, runs of non-alphanumerics collapsed to `-`. */
export function roleKey(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** The longest board member name a split may declare; a longer name is refused, never truncated. */
const MEMBER_NAME_MAX_CHARS = 64

/**
 * Why a declared board member name cannot be used, or null when it can (C1).
 *
 * The name is TRIMMED before judging, because the trimmed string is what the board would carry: a
 * whitespace-only name is EMPTY (a row with no name can never be dispatched) and the length limit applies
 * to the name itself rather than to its padding. A control character or a path separator is refused so a
 * name cannot smuggle a path or break the line a board row is rendered on.
 *
 * @param member - the declared `member` field.
 * @returns a one-sentence reason, or null when the name is usable.
 */
function memberProblem(member: string): string | null {
  /** The name as the board would carry it. */
  const name = member.trim()
  if (name === "") return "member is empty — name the board member this task is raised for, or omit `member` to use the owner role"
  if (name.length > MEMBER_NAME_MAX_CHARS) return "member " + JSON.stringify(name) + " is longer than " + String(MEMBER_NAME_MAX_CHARS) + " characters"
  if (/[\u0000-\u001f\u007f/\\]/.test(name)) return "member " + JSON.stringify(name) + " contains a control character or a path separator"
  return null
}

/**
 * The board member one task resolves to: its declared `member`, else its owner role.
 *
 * @param task - the task, input or verdict row, whose member is resolved.
 * @returns the trimmed name the board would carry.
 */
function resolvedMember(task: { member?: string; ownerRole: string }): string {
  return (task.member ?? task.ownerRole).trim()
}

/**
 * Whether a declared key is safe to use as a contract FILE NAME and a graph reference.
 *
 * @param key - the declared task key.
 * @returns true when the key is non-empty, path-free and starts with an alphanumeric character.
 */
export function isSafeTaskKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) && key !== "." && key !== ".."
}

/**
 * Whether two write scopes overlap.
 *
 * Both are normalised (leading `./`, trailing `/`); equality and path-prefix containment both count,
 * because a task writing `src/auth/` and one writing `src/auth/token.ts` share a file.
 *
 * @param left - one declared scope.
 * @param right - another declared scope.
 * @returns true when the two scopes can touch the same file.
 */
export function scopesOverlap(left: string, right: string): boolean {
  /** One scope, normalised so two spellings of the same directory compare equal. */
  const normalize = (scope: string): string => scope.trim().replace(/^\.\//, "").replace(/\/+$/, "")
  /** The first scope. */
  const a = normalize(left)
  /** The second scope. */
  const b = normalize(right)
  if (a === "" || b === "") return a === b
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/")
}

/**
 * Validate the graph rules against one submission, without measuring anything.
 *
 * @param tasks - the submitted tasks.
 * @param roster - the roster names plus {@link CELL_ROLES}.
 * @returns every violation found, in task order.
 */
export function validateGraph(tasks: readonly SplitTaskInput[], roster: readonly string[]): GraphFinding[] {
  /** Every violation found. */
  const findings: GraphFinding[] = []
  /** Task keys already seen, so a duplicate is refused instead of silently shadowing one. */
  const seen = new Set<string>()
  /** The known role keys. */
  const roles = new Set([...roster, ...CELL_ROLES].map(roleKey))
  if (tasks.length === 0) {
    findings.push({ taskKey: "", code: "empty-split", detail: "the split is empty: submit at least one task" })
    return findings
  }
  /** The keys a reference may name once the first pass is done. */
  const keys = new Set<string>()
  for (const task of tasks) if (isSafeTaskKey(task.key)) keys.add(task.key)
  for (const task of tasks) {
    if (!isSafeTaskKey(task.key)) {
      findings.push({ taskKey: task.key, code: "bad-key", detail: "task key " + JSON.stringify(task.key) + " is not usable as a graph reference and a contract file name (allowed: letters, digits, dot, dash, underscore; no path separators)" })
    } else if (seen.has(task.key)) {
      findings.push({ taskKey: task.key, code: "duplicate-key", detail: "task key " + JSON.stringify(task.key) + " is declared more than once" })
    }
    seen.add(task.key)
    if (task.subject.trim() === "") findings.push({ taskKey: task.key, code: "empty-subject", detail: "the task needs a non-empty subject" })
    if (task.description.trim() === "") findings.push({ taskKey: task.key, code: "empty-description", detail: "the task needs a non-empty description (it is the owner's acceptance text)" })
    if (!SPLIT_KINDS.includes(task.kind ?? "work")) findings.push({ taskKey: task.key, code: "unknown-kind", detail: "kind " + JSON.stringify(task.kind) + " is not one of " + SPLIT_KINDS.join(", ") })
    if (task.ownerRole.trim() === "") {
      findings.push({ taskKey: task.key, code: "missing-owner", detail: "the task needs an ownerRole" })
    } else if (!roles.has(roleKey(task.ownerRole))) {
      findings.push({ taskKey: task.key, code: "unknown-owner-role", detail: "ownerRole " + JSON.stringify(task.ownerRole) + " is neither a roster role nor a cell role (" + CELL_ROLES.join(", ") + ")" })
    }
    if (task.member !== undefined) {
      /** Why the declared member name is unusable, or null when it is fine. */
      const memberReason = memberProblem(task.member)
      if (memberReason !== null) findings.push({ taskKey: task.key, code: "member-invalid", detail: memberReason })
    }
    if (task.blockedBy === undefined && task.independent !== true) {
      findings.push({ taskKey: task.key, code: "no-dependency-answer", detail: "the task declares no dependency answer: pass blockedBy (an array; [] is an explicit root) or independent: true" })
    }
    if (task.kind === "review" && (task.blockedBy ?? []).length === 0) {
      findings.push({ taskKey: task.key, code: "review-without-target", detail: "a review task must be blocked by the task it reviews" })
    }
    if (task.kind === "review" && task.verify === true) {
      findings.push({ taskKey: task.key, code: "review-of-review", detail: "a review task cannot itself carry verify: true — the review IS the verification" })
    }
    for (const reference of task.blockedBy ?? []) {
      if (!keys.has(reference)) findings.push({ taskKey: task.key, code: "unknown-blocker", detail: "blockedBy names " + JSON.stringify(reference) + ", which is not a task key in this split" })
    }
  }
  // ONE MEMBER, ONE ROLE (C1). A member is a real seat, so two tasks naming the same member under
  // DIFFERENT owner roles would raise ONE agent with two jobs. A shared ROLE is legal — that is how
  // several members of one role are declared — and an unusable name is already charged as member-invalid.
  /** The usable declared member names, each with the owner roles its tasks declare. */
  const memberRoles = new Map<string, { roles: Set<string>; keys: string[] }>()
  for (const task of tasks) {
    if (task.member === undefined || memberProblem(task.member) !== null) continue
    /** The name as the board would carry it. */
    const name = task.member.trim()
    /** The entry accumulated for that member, when it was declared before. */
    const entry = memberRoles.get(name)
    if (entry === undefined) {
      memberRoles.set(name, { roles: new Set([roleKey(task.ownerRole)]), keys: [task.key] })
    } else {
      entry.roles.add(roleKey(task.ownerRole))
      entry.keys.push(task.key)
    }
  }
  for (const [name, entry] of memberRoles) {
    if (entry.roles.size <= 1) continue
    findings.push({ taskKey: entry.keys[0], code: "member-role-conflict", detail: "member " + JSON.stringify(name) + " is declared with DIFFERENT owner roles by tasks " + entry.keys.map((key) => JSON.stringify(key)).join(", ") + " — one member has one role; declare a separate member per role, or align the owner roles" })
  }
  // ACYCLICITY: a depth-first walk over the resolved edges; the first back edge names the cycle's entry.
  /** The keys currently on the walk's stack. */
  const visiting = new Set<string>()
  /** The keys already fully explored. */
  const done = new Set<string>()
  /** The task rows by key, for edge lookup. */
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  /**
   * Walk one key's blockers.
   * @param key - the key being expanded.
   * @returns the key that closes a cycle, or undefined.
   */
  const walk = (key: string): string | undefined => {
    if (visiting.has(key)) return key
    if (done.has(key)) return undefined
    visiting.add(key)
    for (const reference of byKey.get(key)?.blockedBy ?? []) {
      /** The cycle entry this edge reaches, when it reaches one. */
      const cyclic = walk(reference)
      if (cyclic !== undefined) return cyclic
    }
    visiting.delete(key)
    done.add(key)
    return undefined
  }
  for (const task of tasks) {
    /** The cycle entry this task's edges reach, when they reach one. */
    const cyclic = walk(task.key)
    if (cyclic !== undefined) {
      findings.push({ taskKey: cyclic, code: "cycle", detail: "blockedBy edges form a cycle through " + JSON.stringify(cyclic) + " — a cycle makes every task in it permanently unready" })
      break
    }
  }
  /** Whether `from` reaches `target` through blockedBy edges (dependency PATH, either direction). */
  const reaches = (from: string, target: string): boolean => {
    /** The keys still to expand. */
    const queue = [from]
    /** The keys already expanded. */
    const walked = new Set<string>()
    while (queue.length > 0) {
      /** The next key to expand. */
      const key = queue.pop() as string
      if (key === target) return true
      if (walked.has(key)) continue
      walked.add(key)
      for (const reference of byKey.get(key)?.blockedBy ?? []) queue.push(reference)
    }
    return false
  }
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      /** One task of the pair. */
      const left = tasks[i]
      /** The other task of the pair. */
      const right = tasks[j]
      /** Whether any scope of the pair overlaps. */
      const overlap = left.writeScopes.some((a) => right.writeScopes.some((b) => scopesOverlap(a, b)))
      if (!overlap) continue
      if (reaches(left.key, right.key) || reaches(right.key, left.key)) continue
      findings.push({ taskKey: left.key, code: "write-scope-overlap", detail: "tasks " + JSON.stringify(left.key) + " and " + JSON.stringify(right.key) + " declare overlapping write scopes with NO dependency path between them — add an edge or make the scopes disjoint" })
    }
  }
  // ONE REVIEW PER VERIFIED TASK, owned by a DIFFERENT role — or, when BOTH sides declare a member, by a
  // DIFFERENT member (two seats of one role may review each other; one member may not review itself).
  for (const task of tasks) {
    if (task.verify !== true || task.kind === "review") continue
    /** The review tasks that name this task as their target. */
    const reviews = tasks.filter((candidate) => candidate.kind === "review" && (candidate.blockedBy ?? []).includes(task.key))
    if (reviews.length !== 1) {
      findings.push({ taskKey: task.key, code: "review-count", detail: "verify: true requires EXACTLY one review task blocked by " + JSON.stringify(task.key) + "; this split declares " + String(reviews.length) })
      continue
    }
    /** The work task's declared member, when it declared one. */
    const workMember = task.member
    /** The review task's declared member, when it declared one. */
    const reviewMember = reviews[0].member
    if (workMember !== undefined && reviewMember !== undefined) {
      if (resolvedMember(task) === resolvedMember(reviews[0])) {
        findings.push({ taskKey: task.key, code: "self-review", detail: "the review task " + JSON.stringify(reviews[0].key) + " is raised for the SAME member as the work it reviews (" + JSON.stringify(resolvedMember(task)) + ") — the verifier must be a different member" })
      }
    } else if (roleKey(reviews[0].ownerRole) === roleKey(task.ownerRole)) {
      findings.push({ taskKey: task.key, code: "self-review", detail: "the review task " + JSON.stringify(reviews[0].key) + " is owned by the SAME role as the work it reviews (" + JSON.stringify(task.ownerRole) + ") — the verifier must be a different declared role" })
    }
  }
  return findings
}

/**
 * Measure and validate one submission, and persist its verdict to the path its OUTCOME names.
 *
 * An ACCEPTED verdict is written to `split/<revision>.json`; a REFUSED one is written beside it at
 * `split/<revision>.refused.json`. The refusal is written too: the per-task breakdown is the product a
 * refused splitter needs, and losing it would leave "refused" with no reason on disk (C9/D8).
 *
 * @param deps - the workspace, the knobs, the roster, the window reader and the clock.
 * @param submission - the graph to measure.
 * @returns the verdict, already persisted.
 */
export async function submitSplit(deps: SubmitDeps, submission: SplitSubmission): Promise<SplitVerdict> {
  /** The graph-rule findings, computed before any measurement so a structurally broken graph is not priced. */
  const findings = validateGraph(submission.tasks, deps.roster)
  /** One window reading per distinct role (the FIRST spelling is the one resolved). */
  const readings = new Map<string, WindowReading>()
  for (const task of submission.tasks) {
    /** The role's comparison key. */
    const key = roleKey(task.ownerRole)
    if (key === "" || readings.has(key)) continue
    readings.set(key, await deps.window(task.ownerRole))
  }
  /** The verdict rows, in submission order. */
  const tasks: SplitTaskVerdict[] = []
  for (const task of submission.tasks) {
    /** The measured inputs, one entry per declaration. */
    const inputs = task.inputs.map((declared) => measureInput(deps.workspace, declared, deps.config))
    /** The reading this task's role resolved to, or the uncertified default. */
    const reading = readings.get(roleKey(task.ownerRole)) ?? { provider: "", model: "", window: null, provenance: "uncertified" as const, maxOutputTokens: null, reason: "the owner role resolved no window" }
    /** The route key used for the fixed-overhead lookup. */
    const routeKey = reading.provider === "" || reading.model === "" ? "" : reading.provider + "/" + reading.model
    /** The task's estimate. */
    const estimate = estimateTask({ subject: task.subject, description: task.description, inputs, config: deps.config, routeKey, modelMaxTokens: reading.maxOutputTokens })
    /** The budget verdict. */
    const budget = applyBudget(estimate, reading, deps.config)
    /** Whether an input could not be measured, which refuses the task on its own. */
    const unreadable = inputs.filter((entry) => entry.error !== undefined)
    for (const entry of unreadable) {
      findings.push({ taskKey: task.key, code: "input-unreadable", detail: "declared input " + JSON.stringify(entry.path) + " could not be measured: " + String(entry.error) })
    }
    tasks.push({
      key: task.key,
      subject: task.subject,
      description: task.description,
      kind: task.kind ?? "work",
      ownerRole: task.ownerRole,
      member: resolvedMember(task),
      writeScopes: [...task.writeScopes],
      blockedBy: [...(task.blockedBy ?? [])],
      inputs,
      verify: task.verify === true,
      estimate,
      budget,
      accepted: budget.accepted && unreadable.length === 0,
    })
  }
  /** The role records, in first-declaration order. */
  const roles: RoleWindowRecord[] = []
  /** The role keys already recorded. */
  const recorded = new Set<string>()
  for (const task of submission.tasks) {
    /** The role's comparison key. */
    const key = roleKey(task.ownerRole)
    if (recorded.has(key)) continue
    recorded.add(key)
    /** The reading for that role. */
    const reading = readings.get(key)
    if (reading === undefined) continue
    roles.push({ role: task.ownerRole, provider: reading.provider, model: reading.model, window: reading.window, provenance: reading.provenance, ...(reading.reason === undefined ? {} : { reason: reading.reason }) })
  }
  /** Whether the whole submission passes: no findings AND every task accepted. */
  const accepted = findings.length === 0 && tasks.every((task) => task.accepted)
  /** The summed estimates, kept so a renderer does not re-add them. */
  const totalEstimate = tasks.reduce((sum, task) => sum + task.estimate.estimate, 0)
  /** The verdict. */
  const verdict: SplitVerdict = {
    version: 1,
    cellId: deps.cellId,
    revision: submission.revision,
    submittedAt: deps.now.toISOString(),
    accepted,
    findings,
    roles,
    tasks,
    totals: {
      estimate: totalEstimate,
      taskCount: tasks.length,
      acceptedCount: tasks.filter((task) => task.accepted).length,
      refusedCount: tasks.filter((task) => !task.accepted).length,
    },
  }
  // THE VERDICT PATH NAMES THE OUTCOME (C9/D8). The canonical per-revision file is the record of what was
  // ACCEPTED, and EVERY refusal lands beside it at `split/<revision>.refused.json`: a refusal therefore
  // always has an artifact on disk, and an accepted record is never overwritten by a later refusal.
  /** The canonical per-revision verdict path, reserved for ACCEPTANCE. */
  const canonical = splitPath(deps.workspace, deps.cellId, submission.revision)
  /** The path this verdict is written to: canonical when accepted, beside it when refused. */
  const file = accepted ? canonical : refusedSplitPath(deps.workspace, deps.cellId, submission.revision)
  /** The persisted document, carrying its own path so a reader never has to guess which file it read. */
  const persisted: SplitVerdict = { ...verdict, file }
  atomicWriteText(file, JSON.stringify(persisted, null, 2) + "\n")
  return persisted
}

/** The result of reading one stored split: the verdict, or the refusal naming the path. */
export type SplitRead = { ok: true; verdict: SplitVerdict } | { ok: false; path: string; detail: string }

/**
 * Read one stored split document at an EXACT path.
 *
 * @param path - the absolute verdict path to read.
 * @returns the verdict, or the refusal naming the path and what was wrong.
 */
function readVerdictFile(path: string): SplitRead {
  /** The file's text. */
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    return { ok: false, path, detail: "the split verdict cannot be read (" + errorText(error) + ")" }
  }
  /** The parsed JSON. */
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, path, detail: "the split verdict is not valid JSON (" + errorText(error) + ")" }
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as { version?: unknown }).version !== 1) {
    return { ok: false, path, detail: "the split verdict is not a version-1 record" }
  }
  /** The verdict, narrowed to the record shape this build writes. */
  const verdict = parsed as SplitVerdict
  if (!Array.isArray(verdict.tasks) || typeof verdict.accepted !== "boolean" || typeof verdict.revision !== "number") {
    return { ok: false, path, detail: "the split verdict does not have the shape of a verdict" }
  }
  return { ok: true, verdict }
}

/**
 * Read one stored ACCEPTED split verdict at `split/<revision>.json`.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell that owns the split.
 * @param revision - the requirements revision the split was written against.
 * @returns the verdict, or the refusal naming the path and what was wrong.
 */
export function readSplit(workspace: string, cellId: string, revision: number): SplitRead {
  return readVerdictFile(splitPath(workspace, cellId, revision))
}

/**
 * The highest-revision split verdict this cell has on disk, or null when none exists.
 *
 * A revision whose only document is a refusal is still the LAST verdict the splitter was given, so it is
 * returned (with `accepted: false`) rather than reported as "no split submitted"; when the same revision
 * also has an accepted record, the ACCEPTANCE wins, because that is the durable one (C9).
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell whose split directory is scanned.
 * @returns the revision and its read outcome, or null.
 */
export function latestSplit(workspace: string, cellId: string): { revision: number; read: SplitRead } | null {
  /** The absolute split directory. */
  const dir = dirname(splitPath(workspace, cellId, 0))
  /** The directory entries, or an empty list when it does not exist yet. */
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  /** The highest revision carrying a canonical OR a beside document, 0 when there is none. */
  let latest = 0
  for (const entry of entries) {
    /** The revision a `<n>.json` or `<n>.refused.json` entry names. */
    const match = /^(\d+)(?:\.refused)?\.json$/.exec(entry)
    if (match === null) continue
    /** The revision that entry names. */
    const revision = Number(match[1])
    if (Number.isInteger(revision) && revision > latest) latest = revision
  }
  if (latest === 0) return null
  /** The canonical path, present only when this revision was ACCEPTED. */
  const canonical = splitPath(workspace, cellId, latest)
  return { revision: latest, read: readVerdictFile(existsSync(canonical) ? canonical : refusedSplitPath(workspace, cellId, latest)) }
}

/**
 * The split directory of one cell, exported so a status render can name it without rebuilding the path.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param cellId - the cell.
 * @returns the absolute directory that holds the verdicts.
 */
export function splitDirOf(workspace: string, cellId: string): string {
  return cellDir(workspace, cellId) + "/" + CELL_SPLIT_DIR
}

/**
 * A message from an unknown thrown value, without assuming it is an Error.
 *
 * @param error - the thrown value.
 * @returns its message text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
