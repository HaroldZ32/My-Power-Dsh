// THE CELLWORK GUARD — the dispatch-only captain, mechanically (user clause 1; contract B2).
//
// WHAT IT IS: ONE `dsh.guardTool` predicate for the whole process. The harness calls it at DISPATCH
// with the tool name and the live agent, and a returned STRING denies the call: the tool never runs and
// the model sees exactly that sentence. So the refusal is the product — every paragraph below names
// what was refused, what the caller may do instead, and how to leave the mode.
//
// WHO IS COVERED. Only sessions a live cell knows about: the captain (matched by the cell record's
// `captainSessionId`) and the cell's own members (matched by recorded session id or by the team
// record's executor handle). A session with no cell passes through untouched, which is what makes the
// mode cost nothing while it is off.
//
// THE FOUR MODES, and why a plain member has none:
//   * captain    — dispatch only: `cellwork_*` except `cellwork_handoff`, `agent_teams_*`,
//                  `ask_user_question`, `todo_write`, `mpd_memory_*`. Everything else is refused.
//   * verifier   — never writes: the eight read-only names are refused, and reading, gates, bash and
//                  the five `mpd_verify_*` calls stay available.
//   * checkpoint — the context threshold was hit: only `cellwork_handoff`, `cellwork_context` and
//                  `cellwork_status` answer, so an agent that ignores the prose still cannot keep
//                  working.
//   * subcaptain — a MINI-CAPTAIN (Amendment 4, contract B2): the captain's dispatch allowlist MINUS
//                  `cellwork_start`/`cellwork_stop` (only the captain may open or close the cell) plus the
//                  four sub-cell verbs. It gets NO file-work tool, because clause 5 runs a promoted agent
//                  "under the same rules as the main agent" and the main agent is dispatch-only.
//   * member     — the ordinary work surface, untouched — with ONE named exception, the CELL PLANNER,
//                  which delegates its reconnaissance instead of reading source itself (C5, D15) and so is
//                  refused `read`/`grep`/`glob` on a source path, with a refusal that teaches both
//                  delegation routes.
//
// DECLARED BOUNDS (README): the guard is process-wide, fires at DISPATCH only, never sees intent, and
// covers no row that calls a service directly instead of going through a tool. A cell record that
// cannot be read releases every caller, because a guard cannot enforce a mode it cannot see — and the
// refusal then surfaces on `cellwork_status`/`cellwork_start` with the record's path.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The prefix family the captain may call: every `cellwork_*`, `agent_teams_*` and `mpd_memory_*` tool. */
export const CAPTAIN_TOOL_PREFIXES: readonly string[] = ["cellwork_", "agent_teams_", "mpd_memory_"]

/**
 * The exact names the captain may call besides the prefix families.
 *
 * `mpd_verify_open` is here BY NAME and is the ONLY `mpd_verify_*` entry (P1 A5): the captain opens the
 * loops an activation arms, while `mpd_verify_seat`, `mpd_verify_evidence`, `mpd_verify_record` and
 * `mpd_verify_escape` stay refused — a captain that could bind or verdict would verify its own work.
 */
export const CAPTAIN_TOOL_NAMES: readonly string[] = ["ask_user_question", "todo_write", "mpd_verify_open"]

/**
 * Member-side tools the captain may NOT call even though they carry a `cellwork_` prefix.
 *
 * `cellwork_handoff` is a WORKER's duty: a captain that could hand off would be able to present the
 * writer's own end-of-task statement as its own.
 */
export const CAPTAIN_FORBIDDEN_NAMES: readonly string[] = ["cellwork_handoff"]

/**
 * The write-capable tools a VERIFIER never gets.
 *
 * Byte-for-byte the roster's read-only deny list (its long form lives in
 * `agent-references/glossary.md`): `mcp__lsp__rename_symbol_strict` is spelled out because the roster's
 * own list names both rename tools, and a verifier's discipline must not depend on which spelling a
 * composition mounts.
 */
export const VERIFIER_DENY_TOOLS: readonly string[] = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
]

/** The ONLY tools a checkpointed member may call, so ignoring the directive cannot continue the work. */
export const CHECKPOINT_ALLOW_TOOLS: readonly string[] = ["cellwork_handoff", "cellwork_context", "cellwork_status"]

/**
 * The documentation band the CELL PLANNER keeps — the SAME band the `mpd` captain keeps (C5, D14 parity).
 *
 * DUPLICATED here rather than imported: this package ships no runtime dependency on `mpd-roles-plugin`, and
 * the two copies may not drift. The pin is `test/band-parity.test.ts`, which imports BOTH modules from
 * source and reddens the moment a list or the predicate's behaviour diverges — a TEST, never a shipped
 * import (the contract's design note).
 */
export const PLANNER_READABLE_PREFIXES: readonly string[] = [".mpd/", "docs/", "evidence/", "agent-references/"]

/**
 * The exact workspace-relative files the planner may read at the ROOT, mirroring the captain's root band.
 *
 * The three instruction basenames are also in {@link PLANNER_INSTRUCTION_BASENAMES}, which admits them at
 * any depth: this list covers the root spelling, that one covers every depth and the world outside the root.
 */
export const PLANNER_READABLE_ROOT_FILES: readonly string[] = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
]

/** The three project instruction files the planner may read at ANY depth, by basename (C5, D14). */
export const PLANNER_INSTRUCTION_BASENAMES: readonly string[] = ["AGENT.md", "AGENTS.md", "CLAUDE.md"]

/** The licence band at the workspace root (`LICENSE.md`, `LICENSE-NOTICES.md`), matched by basename. */
export const PLANNER_LICENSE_PATTERN = /^LICENSE.*\.md$/i

/** The three path-shaped reconnaissance tools the planner is refused on when the path is a SOURCE path. */
export const PLANNER_RECON_TOOLS: readonly string[] = ["read", "grep", "glob"]

/** The cell member name that carries the planner's rule; the cell record and the team board use it verbatim. */
export const PLANNER_SEAT_NAME = "cell-planner"

/**
 * The two cell-lifecycle verbs ONLY the captain may call: a subcaptain opens sub-cells, never cells.
 *
 * Excluding them from the subcaptain surface is what keeps the mode single-owner: a promoted member that
 * could `cellwork_stop` would be able to close a cell its captain still supervises.
 */
export const SUBCAPTAIN_FORBIDDEN_NAMES: readonly string[] = ["cellwork_start", "cellwork_stop"]

/**
 * The four sub-cell verbs a subcaptain may call, named explicitly even though the `cellwork_` prefix
 * already admits them: the surface is the contract, and a reviewer should read it here rather than
 * derive it from a prefix rule.
 */
export const SUBCAPTAIN_TOOL_NAMES: readonly string[] = ["cellwork_subteam", "cellwork_activate", "cellwork_dispatch", "cellwork_supervise"]

/**
 * Every file-work tool a subcaptain must NOT reach (contract B2, Amendment 4).
 *
 * The PREDICATE is a positive allowlist, so this list is documentation plus test data rather than an
 * input to the decision — kept beside it so the two can never drift into disagreeing about which
 * capabilities count as "doing the work instead of dispatching it".
 */
export const FILE_WORK_TOOLS: readonly string[] = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
]

/** What the guard enforces for one session: the mode, and the cell it belongs to. */
export type CellSeatMode = "captain" | "verifier" | "checkpoint" | "subcaptain" | "member"

/** One guarded seat: the cell a session belongs to, its name there, and the mode in force. */
export interface CellworkSeat {
  /** The cell whose rules apply. */
  cellId: string
  /** The captain's own name (`captain`) or the member name on the board. */
  name: string
  /** The mode the guard enforces. */
  mode: CellSeatMode
}

/**
 * One dispatch's ARGUMENTS, as far as the CELL PLANNER's path rule needs them.
 *
 * Only that one arm reads this: every other mode is decided by (seat, toolName) alone, which is why the
 * argument is OPTIONAL and why the decision stays a pure function of its inputs.
 */
export interface CellworkGuardCall {
  /** The call's argument object, as the harness validated it. */
  args?: Record<string, unknown> | undefined
  /** The session workspace root, as the adapter resolved it; `""` when it could not be resolved. */
  workspaceRoot?: string
}

/** The install outcome, mirroring the other guards this bundle ships. */
export interface CellworkGuardInstall {
  /** Whether a predicate is registered. */
  installed: boolean
  /** Why it is not: the harness exposes no guard seam, or the registration itself failed. */
  reason?: "no-guard-seam" | "install-failed"
  /** The registry's disposer, when the harness returned one. */
  dispose?: () => void
}

/** What `installCellworkGuard` needs from the row: the seat lookup and the logging sink. */
export interface CellworkGuardOptions {
  /**
   * Resolve ONE dispatch's seat, or undefined when the session is in no cell.
   *
   * The implementation MUST be total (never throw) and MUST be cheap enough to run on every tool call;
   * the row resolves it from the cell record, so the guard itself stays a pure predicate.
   */
  seatOf: (exec: DshToolExec | undefined) => CellworkSeat | undefined
  /** The row's own log sink, called once when the guard could not be installed. */
  warn: (line: string) => void
}

/** Whether one name belongs to the captain's dispatch allowlist. */
export function isCaptainAllowed(toolName: string): boolean {
  if (CAPTAIN_FORBIDDEN_NAMES.includes(toolName)) return false
  if (CAPTAIN_TOOL_NAMES.includes(toolName)) return true
  return CAPTAIN_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))
}

/**
 * Whether one name belongs to the SUBCAPTAIN's dispatch surface.
 *
 * The surface is the captain's allowlist with the two cell-lifecycle verbs removed; the four sub-cell
 * verbs are admitted by the prefix rule already, and {@link SUBCAPTAIN_TOOL_NAMES} states them so the
 * contract is readable.
 *
 * @param toolName - the registered tool name being dispatched.
 * @returns whether a subcaptain may call it.
 */
export function isSubcaptainAllowed(toolName: string): boolean {
  if (SUBCAPTAIN_FORBIDDEN_NAMES.includes(toolName)) return false
  if (SUBCAPTAIN_TOOL_NAMES.includes(toolName)) return true
  return isCaptainAllowed(toolName)
}

/**
 * The captain's refusal: what was refused, the allowed surface verb by verb, and how to leave.
 *
 * ONE paragraph on purpose: it is read as a tool result, and the replacement calls have to be
 * copy-pasteable from it.
 *
 * @param toolName - the tool the model tried, named first so it cannot mistake which call was refused.
 * @returns the teaching paragraph.
 */
export function captainRefusal(toolName: string): string {
  return "cellwork: `" + toolName + "` is refused — while a cell is running the CAPTAIN DISPATCHES ONLY "
    + "(user clause 1): it edits no file, runs no shell, does no reconnaissance and verifies nothing. "
    + "Allowed here: `cellwork_*` except `cellwork_handoff` (`cellwork_status`, `cellwork_start`, "
    + "`cellwork_dispatch`, `cellwork_supervise`, `cellwork_activate`, `cellwork_send`, `cellwork_inbox`), "
    + "`agent_teams_*` (`agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail`), "
    + "`mpd_verify_open` (opening a loop only — binding, evidence and verdict stay refused), "
    + "`ask_user_question`, `todo_write` and `mpd_memory_*`. Put the work on the team: stage or extend it "
    + "with `agent_teams_plan`, then DISPATCH WITH `cellwork_dispatch` — owner-only, and a busy or absent "
    + "owner is REPORTED and the task left pending, never substituted. (`agent_teams_dispatch` stays allowed "
    + "but it is NOT the verb for this board: it falls back to roster order, which can hand review work to "
    + "its own writer.) Relay the planner's questions with `ask_user_question`. To leave the mode and get "
    + "every tool back, call `cellwork_stop`."
}

/**
 * The verifier's refusal: read the contract and the docs, run the gates, record a verdict, never fix.
 *
 * @param toolName - the write-capable tool the verifier tried.
 * @returns the teaching paragraph.
 */
export function verifierRefusal(toolName: string): string {
  return "cellwork: `" + toolName + "` is refused — this session is a VERIFIER of the cell, so it never "
    + "fixes what it judges. Read the frozen contract and the documentation (not the implementation), run "
    + "the gates, then record the verdict with `mpd_verify_record` (a PASS needs the documents it cites "
    + "and its gate evidence ids); reading, `bash`, `grep`, `glob` and `mpd_verify_*` stay available. A "
    + "FAIL bounces the work back to its writer as a repair task, and only a RECORDED FAIL makes "
    + "implementation reading legitimate, for diagnosis."
}

/**
 * The checkpoint refusal: hand off now, then end the turn; the plugin compacts and promotes.
 *
 * @param toolName - the tool the checkpointed member tried.
 * @returns the teaching paragraph.
 */
export function checkpointRefusal(toolName: string): string {
  return "cellwork: `" + toolName + "` is refused — this session reached its CONTEXT CHECKPOINT, so the "
    + "work stops at this boundary. Call `cellwork_handoff` now with the task, the current state, the "
    + "decisions (and why), the artifacts, the verified facts, the open questions and the single next "
    + "step, then END YOUR TURN. The plugin compacts this agent's context and promotes it (or reseeds it "
    + "from that handoff), so anything you did not write down is lost. `cellwork_status` and "
    + "`cellwork_context` stay readable meanwhile."
}

/**
 * The subcaptain's refusal: it DISPATCHES rather than works, and it cannot open or close the cell.
 *
 * ONE paragraph, and it deliberately does not advertise `cellwork_stop` as available — the verb is
 * refused here, so naming it as an option would teach a call that fails.
 *
 * @param toolName - the tool the promoted agent tried.
 * @returns the teaching paragraph.
 */
export function subcaptainRefusal(toolName: string): string {
  return "cellwork: `" + toolName + "` is refused — this session is a SUBCAPTAIN of the cell: it builds and "
    + "dispatches the next-level team under the SAME rules as the captain, so it dispatches rather than works, "
    + "and it never edits a file, runs a shell, does reconnaissance or verifies. Allowed here: `cellwork_*` "
    + "except `cellwork_handoff`, `cellwork_start` and `cellwork_stop` (stage the sub-cell with "
    + "`cellwork_subteam`, materialise an accepted split with `cellwork_activate`, dispatch with "
    + "`cellwork_dispatch` and sweep with `cellwork_supervise`), `agent_teams_*`, `ask_user_question`, "
    + "`todo_write` and `mpd_memory_*`. Only the CAPTAIN opens or closes a cell: if this cell needs that, "
    + "send the request with `cellwork_send` and end your turn."
}

/**
 * The CELL PLANNER's refusal: DELEGATE the reconnaissance, with both routes named and the reason stated.
 *
 * ONE paragraph on purpose: it is read as a tool result, and the replacement calls have to be
 * copy-pasteable from it.
 *
 * @param toolName - the tool the planner tried, named first so it cannot mistake which call was refused.
 * @param target - the path as the caller spelled it, or the reason none could be read.
 * @returns the teaching paragraph.
 */
export function plannerRefusal(toolName: string, target: string): string {
  return "cellwork: `" + toolName + "` on " + target + " is refused — this session is the CELL PLANNER, so"
    + " its reconnaissance is DELEGATED, never run itself: its context has to carry the interview and the"
    + " requirements document, and a source tree spent here is context the interview then lacks. Two"
    + " read-only routes, both one-shot: `cellwork_recon` {role:\"Explorer\"|\"Researcher\", task} — its"
    + " report comes straight back, and it forwards its own depth cap so it is never refused by the host's"
    + " nesting default — or `mpd_role_spawn` with a read-only roster role (Explorer, Researcher, Architect)"
    + " when the cellwork tool is not mounted. The band stays open to you: `.mpd/**`, `docs/**`,"
    + " `evidence/**`, `agent-references/**`; any `AGENT.md`, `AGENTS.md` or `CLAUDE.md` at any depth, inside"
    + " this workspace or outside its root; and at the workspace root only `README.md`, `README.zh-CN.md`,"
    + " `CHANGELOG.md` and `LICENSE*.md`."
}

/**
 * Whether one path argument falls inside the band the CELL PLANNER keeps.
 *
 * The ORDER is the captain's order, because the two bands are ONE contract (C5, D14): an INSTRUCTION file is
 * admitted by its BASENAME whatever its parent segments say; otherwise a spelling with a `..` segment, an
 * absolute path outside the root and every spelling that reaches no band are REFUSED, while the band
 * prefixes, the named root files and the root licence band are ALLOWED.
 *
 * @param workspaceRoot - the workspace root this call resolved, or `""` when none could be resolved.
 * @param raw - the path the tool call carried.
 * @returns true when the planner may read that path.
 */
export function plannerReadablePath(workspaceRoot: string, raw: string): boolean {
  /** The path normalised to POSIX, so a Windows separator cannot smuggle a band past the test. */
  const posix = String(raw ?? "").replace(/\\/g, "/")
  if (posix === "") return false
  // INSTRUCTION FILES FIRST, exactly as the captain's band does: their BASENAME decides, so a nested one and
  // a SIBLING project's own `AGENT.md` are readable — the documents a planner consults to learn the rules.
  if (isPlannerInstructionFile(posix)) return true
  /** The workspace root, normalised with no trailing separator. */
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  /** True when the caller spelled an absolute path. */
  const absolute = posix.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(posix)
  /** The workspace-relative spelling, or `undefined` when the path is not under the root. */
  let rel: string | undefined
  if (!absolute) rel = posix.startsWith("./") ? posix.slice(2) : posix
  else if (root !== "" && posix.startsWith(root + "/")) rel = posix.slice(root.length + 1)
  if (rel === undefined || rel === "") return false
  // NO PARENT HOPS: a spelling carrying a `..` segment is refused outright rather than resolved, so
  // `docs/../packages/x/src/y.ts` cannot start inside a band and end outside it.
  if (rel.split("/").includes("..")) return false
  /** True when the path is inside a documentation band, or IS the band directory itself. */
  const inBand = PLANNER_READABLE_PREFIXES.some((prefix) => rel!.startsWith(prefix) || rel === prefix.replace(/\/$/, ""))
  if (inBand) return true
  if (PLANNER_READABLE_ROOT_FILES.includes(rel)) return true
  return rel.indexOf("/") === -1 && PLANNER_LICENSE_PATTERN.test(rel)
}

/**
 * Whether one path's BASENAME is a project instruction file (`AGENT.md`, `AGENTS.md`, `CLAUDE.md`).
 *
 * The parent segments are IGNORED on purpose — that IS the rule: the file is readable at any depth and
 * outside the workspace root, so only the last segment decides.
 *
 * @param path - the path as the caller spelled it, already normalised to POSIX.
 * @returns true when the last segment names one of the instruction files.
 */
function isPlannerInstructionFile(path: string): boolean {
  /** The last path segment, lower-cased for the comparison. */
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  if (base === "") return false
  return PLANNER_INSTRUCTION_BASENAMES.some((name) => name.toLowerCase() === base)
}

/** The argument keys a path-shaped call may spell its target under, in the verification law's own order. */
const PLANNER_PATH_ARG_KEYS: readonly string[] = ["file_path", "path", "filePath", "target"]

/**
 * The path one reconnaissance-shaped call names, when it carries a usable spelling.
 *
 * @param args - the call's argument object, as the harness validated it.
 * @returns the path, or undefined when no key carried a non-empty string.
 */
function plannerTargetPath(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of PLANNER_PATH_ARG_KEYS) {
    /** The raw value under this key, accepted only when it is a non-empty string. */
    const value = args?.[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

/**
 * Whether one seat belongs to the CELL PLANNER.
 *
 * Compared after trimming and lower-casing: the member name travels through the cell record AND the team
 * board, and the two spellings are not guaranteed to agree on case.
 *
 * @param seat - the caller's seat.
 * @returns true when that seat is the planner.
 */
function isPlannerSeat(seat: CellworkSeat): boolean {
  return seat.name.trim().toLowerCase() === PLANNER_SEAT_NAME
}

/**
 * The pure decision: the sentence that denies one call, or undefined when it is allowed.
 *
 * Every arm but ONE is a total function of (seat, name); the CELL PLANNER's arm additionally reads the
 * call's path and the workspace root, which is why `call` exists and why it is optional. Nothing here reads
 * disk, a clock or a service, so the whole policy is unit-testable without a harness.
 *
 * @param seat - the caller's seat, or undefined when the session is in no cell (always allowed).
 * @param toolName - the registered tool name being dispatched.
 * @param call - the call's arguments and resolved root, read ONLY by the planner's path arm.
 * @returns the refusal paragraph, or undefined to allow.
 */
export function cellworkGuardDecision(seat: CellworkSeat | undefined, toolName: string, call?: CellworkGuardCall): string | undefined {
  // NO CELL, NO RULE: an unrelated session — and a cell whose record could not be read — is untouched.
  if (seat === undefined) return undefined
  if (toolName === "") return undefined
  if (seat.mode === "captain") return isCaptainAllowed(toolName) ? undefined : captainRefusal(toolName)
  if (seat.mode === "verifier") return VERIFIER_DENY_TOOLS.includes(toolName) ? verifierRefusal(toolName) : undefined
  if (seat.mode === "checkpoint") return CHECKPOINT_ALLOW_TOOLS.includes(toolName) ? undefined : checkpointRefusal(toolName)
  // SUBCAPTAIN is a MINI-CAPTAIN (Amendment 4): the same dispatch-only discipline one level down.
  if (seat.mode === "subcaptain") return isSubcaptainAllowed(toolName) ? undefined : subcaptainRefusal(toolName)
  // MEMBER is ordinarily the untouched work surface; the CELL PLANNER is its ONE exception (C5, D15). Its
  // reconnaissance is delegation, so the three path-shaped tools are refused on a SOURCE path — judged by the
  // SAME band the captain keeps, because a planner reads the manual, the contract and the requirements record.
  if (seat.mode === "member" && isPlannerSeat(seat)) {
    if (!PLANNER_RECON_TOOLS.includes(toolName)) return undefined
    /** The path this call names; absent means a bare call, which FAILS CLOSED exactly as the captain's arm does. */
    const raw = plannerTargetPath(call?.args)
    if (raw === undefined) return plannerRefusal(toolName, "(no path argument — a bare call searches the whole workspace)")
    if (plannerReadablePath(call?.workspaceRoot ?? "", raw)) return undefined
    return plannerRefusal(toolName, JSON.stringify(raw))
  }
  return undefined
}

/**
 * Install the cellwork guard ONCE, through the adapter's `tools.guard` seam.
 *
 * A composition without that seam is a stated absence, not a failure: the mode still records and the
 * refusal surfaces on its tools, but the captain is not mechanically fenced (the README says so).
 *
 * The adapter slice carries the workspace-root seam TOO: the planner's path arm has to relativise an
 * absolute spelling, and the root is resolved through the adapter rather than from the process — see
 * {@link pathBandRootOf}, which also keeps every other dispatch free of that resolution.
 *
 * @param dsh - the adapter's capability probe, its `guardTool` registration and its workspace-root seam.
 * @param options - the seat lookup and the logging sink.
 * @returns the install outcome, carrying the disposer when one was returned.
 */
export function installCellworkGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">,
  options: CellworkGuardOptions,
): CellworkGuardInstall {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("[mpd-cellwork] the harness exposes no tools.guard seam — the captain/verifier/checkpoint guard is NOT installed; the mode still records and its tools still refuse, but the dispatch fence is absent")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The registry's disposer, returned so the row can release the guard on teardown. */
    const dispose = dsh.guardTool((exec) => {
      try {
        /** The dispatched tool's registered name, read defensively so an unexpected shape passes. */
        const toolName = String(exec?.name ?? "")
        /** The caller's seat; undefined when the session is in no cell, which passes through untouched. */
        const seat = options.seatOf(exec)
        return cellworkGuardDecision(seat, toolName, {
          args: exec?.arguments,
          workspaceRoot: pathBandRootOf(dsh, seat, toolName, exec),
        })
      } catch {
        // A throwing guard would take an unrelated call down; an unreadable call is a pass-through.
        return undefined
      }
    })
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("[mpd-cellwork] installing the guard failed (" + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}

/**
 * The workspace root one decision should judge a path against, or `""` when no arm reads a path.
 *
 * TWO POINTED REASONS. The root is resolved THROUGH THE ADAPTER — never `process.cwd()`, never a cached
 * constant (AGENTS.md §6) — and only for the cell planner's three reconnaissance tools, so every other tool
 * call of every other member pays nothing for a fact it never reads. A throwing resolver answers `""`, which
 * keeps the RELATIVE band working and refuses the rest: the fail-closed direction, not a silent pass.
 *
 * @param dsh - the adapter, for its workspace-root seam.
 * @param seat - the caller's seat, or undefined when it is in no cell.
 * @param toolName - the registered tool name being dispatched.
 * @param exec - the dispatch being guarded.
 * @returns the root to judge against, or `""`.
 */
function pathBandRootOf(
  dsh: Pick<DshAdapter, "workspaceRoot">,
  seat: CellworkSeat | undefined,
  toolName: string,
  exec: DshToolExec | undefined,
): string {
  if (seat === undefined || seat.mode !== "member" || !isPlannerSeat(seat) || !PLANNER_RECON_TOOLS.includes(toolName)) return ""
  try {
    return dsh.workspaceRoot(exec)
  } catch {
    return ""
  }
}
