// THE CAPTAIN INVESTIGATION GUARD — the `mpd` preset's TOP-LEVEL session does not do reconnaissance.
//
// WHY THIS EXISTS (the user's requirement, 2026-10-08): the user-facing main agent must keep its context
// small enough to drive very large projects, and RECONNAISSANCE — finding files, reading source, grepping
// for symbols — is what inflates it. The captain DELEGATES that work (a roster specialist: `Explorer` for
// "find the file and the code", `Researcher` for evidence-based search, or a team member) and consumes
// the REPORT.
//
// WHAT IT DENIES: every registered tool that RETURNS workspace source, on a SOURCE path — the harness's
// `read` / `grep` / `glob`, the hashline file reader, the ast-grep syntax search and the LSP readers; a
// source-returning tool with NO path argument (the code graph's `codegraph_explore`, the LSP's
// `find_workspace_symbols`) is refused by the fail-closed bare-call rule. The session is one where
// `sessionIsMpdCaptain` is true — §5's top-level session (not a delegated child — `origin: "subagent"` or
// depth `1`+ — and never a preset name: T-92) AND a session whose `agentPreset` is `mpd`: this rule is
// part of what the `mpd` preset means, so a user working in another preset (`cordis` is the deployment
// default) keeps its own reconnaissance. The write rule beside it reads the SAME predicate.
//
// WHAT STAYS OPEN — THE DOCUMENTATION BAND: `.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`;
// ANY `AGENT.md` / `AGENTS.md` / `CLAUDE.md` by BASENAME at any depth, inside this workspace OR outside
// its root, because the motivating read is a SIBLING project's instruction file (C4, D14); and at the
// workspace root only `README.md` / `README.zh-CN.md` / `CHANGELOG.md` / `LICENSE*.md` — exactly those
// two README spellings, since there is no `README*` glob. Integration stays possible because the
// contract, the records and the manual remain readable; the SOURCES do not.
//
// THE DECISION IS PURE ({@link captainInvestigationDecision}), so it is unit-testable without a harness,
// and the INSTALL is ONE `guardTool` registration through the adapter, beside the captain's write rule.
// The knob is `captain.investigation` in `mpd.jsonc`: `"deny"` (default) | `"allow"`; the row's boot line
// reports the mode it installed.
//
// HONEST BOUNDS, stated rather than implied. (1) The guard reads a TOOL CALL's arguments and its path is
// judged by SPELLING: a symlink is never resolved, and an MCP tool is covered only by NAME — one that
// returns workspace source under a name absent from {@link INVESTIGATION_TOOLS} stays open until it is
// added there. A LIST-shaped argument is judged ENTRY BY ENTRY, not by its first member: every non-empty
// string in ast-grep's `paths` must be inside the band, so a later entry cannot smuggle source past a
// permitted first one, and an element that is not a non-empty string REFUSES the call rather than being
// ignored. (2) Shell access is NOT this file's subject: `bash` belongs to the captain-shell
// guard beside it, whose own decision family judges the file-reading commands it is given — and ANY such
// rule is TOKEN-based, so a path assembled at runtime (`cat "$F"`) is not judged.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { readTargetPath } from "../../mpd-verify-plugin/src/law.ts"
import { sessionIsMpdCaptain } from "./complexity-gate.ts"

/** The `mpd.jsonc` key the modes are read from, through the config layer this bundle already uses. */
export const INVESTIGATION_CONFIG_KEY = "captain.investigation"

/** The two modes `captain.investigation` accepts; anything else reads as {@link DEFAULT_INVESTIGATION_MODE}. */
export type InvestigationMode = "deny" | "allow"

/** The mode a session gets when `mpd.jsonc` says nothing: the requirement's own default, fail-closed. */
export const DEFAULT_INVESTIGATION_MODE: InvestigationMode = "deny"

/**
 * The path-consuming tools reconnaissance is done with; every other tool is somebody else's rule.
 *
 * The three harness tools are the original set. The captain recon fence wave (2026-11-09) closed the
 * remaining registered doors that return workspace source: the hashline full-file reader (`path`), the
 * ast-grep syntax SEARCH (`paths` — EVERY entry is judged, see {@link astGrepSearchPaths}) and the LSP
 * readers (`file_path`). The wave's repair (T8, same day) replaced the earlier "judge the first entry"
 * rule for the search: a later entry naming a source path was a live bypass, so order no longer matters.
 * `mcp__codegraph__codegraph_explore` is the last row and has no path argument at all — it returns
 * verbatim source for a query — so it is REFUSED by the fail-closed bare-call rule in the decision below
 * rather than by a path test, and no path argument is invented for it. The LSP's own
 * `find_workspace_symbols` is the same case from the other side: it takes only a `query`, so the same
 * bare-call rule refuses it and its door needs no path judgement.
 *
 * BOUND: the MCP half of this list is a deny by TOOL NAME. An MCP tool that returns workspace source
 * under a name not listed here is NOT covered until it is added here — the LSP server's write-side
 * `rename_symbol` / `rename_symbol_strict` are deliberately absent (they are WRITES, and the member
 * read-only deny list already carries them), but any FUTURE reader of that class must be added by hand.
 */
export const INVESTIGATION_TOOLS: readonly string[] = [
  "read",
  "glob",
  "grep",
  "mpd_hashline_read",
  "mcp__ast_grep__search",
  "mcp__lsp__find_definition",
  "mcp__lsp__get_hover",
  "mcp__lsp__find_references",
  "mcp__lsp__get_diagnostics",
  "mcp__lsp__find_workspace_symbols",
  "mcp__lsp__find_implementation",
  "mcp__lsp__prepare_call_hierarchy",
  "mcp__lsp__get_incoming_calls",
  "mcp__lsp__get_outgoing_calls",
  "mcp__codegraph__codegraph_explore",
]

/** The documentation BANDS the captain may still read: contracts, records, evidence and the reference. */
export const CAPTAIN_READABLE_PREFIXES: readonly string[] = [".mpd/", "docs/", "evidence/", "agent-references/"]

/**
 * The three project instruction files a reader may consult at ANY depth, by BASENAME (C4, D14).
 *
 * They are band-EXEMPT in {@link captainReadablePath}: depth, a `..` hop and a location outside the
 * workspace root all still admit them, because the read this class exists for is a SIBLING project's
 * `AGENT.md`. Matching is case-insensitive, like the licence band, so a Windows spelling cannot smuggle
 * the file out of a band the reader is meant to have.
 */
export const CAPTAIN_INSTRUCTION_BASENAMES: readonly string[] = ["AGENT.md", "AGENTS.md", "CLAUDE.md"]

/**
 * The ROOT instruction/overview files the captain may still read, by exact workspace-relative name.
 *
 * The three instruction basenames are ALSO here, and that is not a contradiction: the list admits them at
 * the root, while {@link CAPTAIN_INSTRUCTION_BASENAMES} admits them at any depth and outside the root.
 */
export const CAPTAIN_READABLE_ROOT_FILES: readonly string[] = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
]

/** The licence band at the workspace root (`LICENSE.md`, `LICENSE-NOTICES.md`), matched by basename. */
export const ROOT_LICENSE_PATTERN = /^LICENSE.*\.md$/i

/** Everything {@link captainInvestigationDecision} needs, so the decision stays pure and harness-free. */
export interface CaptainInvestigationInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object, as the harness validated it. */
  args: Record<string, unknown> | undefined
  /** The session workspace root, as the adapter resolved it. */
  workspaceRoot: string
  /** Whether the calling session is the `mpd` preset's TOP-LEVEL session — the captain this rule is scoped to (`sessionIsMpdCaptain`). */
  topLevel: boolean
  /** The mode in force. */
  mode: InvestigationMode
}

/**
 * Read `captain.investigation` as a mode.
 *
 * FAIL-CLOSED, by design: only the exact string `"allow"` turns the rule off, so a typo, an absent key or
 * a value of another type leaves the captain's reconnaissance denied rather than silently permitted.
 *
 * @param raw - the raw config value.
 * @returns `"allow"` for the exact opt-out spelling, `"deny"` otherwise.
 */
export function resolveInvestigationMode(raw: unknown): InvestigationMode {
  return raw === "allow" ? "allow" : "deny"
}

/**
 * Whether one path argument falls inside the documentation band the captain keeps.
 *
 * The order is the contract: an INSTRUCTION file is admitted by its basename whatever its parent segments
 * say (C4, D14); otherwise a path that escapes the workspace (`..`), an absolute path outside the root and
 * every spelling that reaches no band are REFUSED, while the bands and the named root files are ALLOWED.
 *
 * @param workspaceRoot - the session workspace root.
 * @param raw - the path the tool call carried.
 * @returns true when the captain may read that path.
 */
export function captainReadablePath(workspaceRoot: string, raw: string): boolean {
  /** The path normalised to POSIX, so a Windows separator cannot smuggle a band past the test. */
  const posix = String(raw ?? "").replace(/\\/g, "/")
  if (posix === "") return false
  // THE INSTRUCTION FILES COME FIRST (C4, D14) — BEFORE the `..` and outside-root rules below. Their
  // BASENAME is the whole test, because the read this class exists for is a SIBLING project's `AGENT.md`:
  // a depth or root test here would refuse exactly the document a reader consults to learn the rules.
  if (isInstructionFile(posix)) return true
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
  const inBand = CAPTAIN_READABLE_PREFIXES.some((prefix) => rel!.startsWith(prefix) || rel === prefix.replace(/\/$/, ""))
  if (inBand) return true
  // THE ROOT FILES ARE EXACT: a nested `AGENTS.md` under a source tree is NOT this band, so a reader
  // cannot reach a source directory by spelling an instruction file inside it.
  if (CAPTAIN_READABLE_ROOT_FILES.includes(rel)) return true
  return rel.indexOf("/") === -1 && ROOT_LICENSE_PATTERN.test(rel)
}

/**
 * Whether one path's BASENAME is a project instruction file (`AGENT.md`, `AGENTS.md`, `CLAUDE.md`).
 *
 * The parent segments are IGNORED on purpose — that IS the C4 (D14) rule: the file is readable at any
 * depth and outside the workspace root, so only the last segment decides. Comparison is case-insensitive so
 * a Windows spelling cannot drop the file out of the band.
 *
 * @param path - the path as the caller spelled it, already normalised to POSIX.
 * @returns true when the last segment names one of the instruction files.
 */
function isInstructionFile(path: string): boolean {
  /** The last path segment, lower-cased for the comparison. */
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  if (base === "") return false
  return CAPTAIN_INSTRUCTION_BASENAMES.some((name) => name.toLowerCase() === base)
}

/**
 * The ast-grep tool whose path argument is a LIST that must be judged ENTRY BY ENTRY.
 *
 * `mcp__ast_grep__rewrite` is deliberately NOT here: it is a WRITE tool, it sits on the member read-only
 * deny list, and its reader is `readTargetPath`'s `paths[0]` contract, which this repair leaves alone.
 */
const AST_GREP_SEARCH_TOOL = "mcp__ast_grep__search"

/** The first `paths` element that is not a non-empty string, recorded so the refusal can name it. */
interface InvalidSearchPathEntry {
  /** Its position in the caller's list, so the refusal points at the element, not the list. */
  index: number
  /** The element as the harness validated it, stringified into the refusal sentence. */
  value: unknown
}

/**
 * One ast-grep search call's `paths` list: the entries a band check can judge, plus the FIRST element
 * that is not a non-empty string.
 *
 * A non-empty string is the ONLY usable shape (§3 C2 of the recon-fence contract): an absent or non-array
 * `paths` and an empty list yield no entries, while an element of any other shape is recorded here instead
 * of being filtered out, so the caller refuses the WHOLE call rather than letting a malformed element ride
 * beside a permitted one.
 */
interface AstGrepSearchPathList {
  /** The non-empty string entries, in call order, for the every-element band check. */
  entries: string[]
  /** The first element that is not a non-empty string; absent when every element is usable. */
  invalid?: InvalidSearchPathEntry
}

/**
 * Split an ast-grep search call's `paths` array into judgeable entries and the first unusable element.
 *
 * The caller refuses a call whose list yields NOTHING, which is the fail-closed bare-call case (the same
 * shape a missing `path` has for `glob`/`grep`); an unusable element BESIDE usable ones is refused as an
 * offending shape rather than ignored, so `["docs/", 42]` cannot pass as a docs-only search.
 *
 * @param args - the call's argument object, as the harness validated it.
 * @returns the entries to judge and, when one exists, the first element that is not a non-empty string.
 */
function astGrepSearchPaths(args: Record<string, unknown> | undefined): AstGrepSearchPathList {
  /** The raw argument, accepted only as a list. */
  const paths = args?.paths
  if (!Array.isArray(paths)) return { entries: [] }
  /** The usable entries, collected so the band check sees every string the call names. */
  const entries: string[] = []
  /** The first element that is not a non-empty string; the caller refuses the whole call when set. */
  let invalid: InvalidSearchPathEntry | undefined
  for (let index = 0; index < paths.length; index += 1) {
    /** The element at this position, judged by its TYPE first: only a non-empty string is a path. */
    const entry: unknown = paths[index]
    if (typeof entry === "string" && entry !== "") {
      entries.push(entry)
      continue
    }
    if (invalid === undefined) invalid = { index, value: entry }
  }
  return invalid === undefined ? { entries } : { entries, invalid }
}

/**
 * Decide one call for the captain's investigation rule.
 *
 * Pure with respect to the harness, like `captainWriteDecision` beside it: the caller passes the tool
 * name, the arguments, the resolved root, the `mpd`-captain classification and the mode, and gets back the
 * denial sentence to hand the harness or `undefined` to let the call through.
 *
 * @param input - the call, its target and the mode in force.
 * @returns the denial the harness turns into a refusal result, or `undefined` to allow the call.
 */
export function captainInvestigationDecision(input: CaptainInvestigationInput): string | undefined {
  // THE MODE COMES FIRST: `"allow"` restores today's freedom exactly, for every session.
  if (input.mode !== "deny") return undefined
  // ONLY THE CAPTAIN: members, single-call specialists, workmate spawns and verifier seats keep their
  // reconnaissance — the verifier's own envelope scopes ITS reads separately and must not be doubled.
  if (!input.topLevel) return undefined
  /** The tool name, read defensively so an unexpected shape is a pass-through. */
  const toolName = String(input.toolName ?? "")
  if (!INVESTIGATION_TOOLS.includes(toolName)) return undefined
  // THE LIST-SHAPED DOOR IS JUDGED WHOLE (T8): checking only `paths[0]` let `["docs/", "packages/x.ts"]`
  // read source, so EVERY entry is judged and the FIRST one outside the band names the refusal.
  if (toolName === AST_GREP_SEARCH_TOOL) {
    /** What this call's `paths` argument carries: its judgeable entries and its first unusable element. */
    const searchPaths = astGrepSearchPaths(input.args)
    // FAIL-CLOSED with no usable entry: a search with no path covers the whole workspace.
    if (searchPaths.entries.length === 0) return investigationRefusal(toolName, "(no path argument — a bare search covers the whole workspace)")
    /** The first entry outside the readable band, or `undefined` when every entry is inside it. */
    const offending = searchPaths.entries.find((entry) => !captainReadablePath(input.workspaceRoot, entry))
    if (offending !== undefined) return investigationRefusal(toolName, JSON.stringify(offending))
    // A NON-STRING OR EMPTY-STRING ENTRY REFUSES THE WHOLE CALL (F5): filtering it out let
    // `["docs/", 42]` pass as a docs-only search, and the frozen contract refuses any such element.
    if (searchPaths.invalid !== undefined) {
      return investigationRefusal(toolName, "(`paths` entry " + searchPaths.invalid.index
        + " is not a non-empty string: " + String(JSON.stringify(searchPaths.invalid.value)) + ")")
    }
    return undefined
  }
  /** The path this call names: `read` and the LSP tools under `file_path`, `glob`/`grep`/`mpd_hashline_read` under `path`; `codegraph_explore` names none. */
  const raw = readTargetPath(toolName, input.args)
  // FAIL-CLOSED on a missing path: `glob`/`grep` without a `path` search the WHOLE workspace, and the
  // pattern's own directory prefix is deliberately NOT a substitute (contract §2.2) — while a tool that
  // returns source and takes no path at all (`codegraph_explore`) has nothing that could be judged.
  if (raw === undefined) return investigationRefusal(toolName, "(no path argument — a bare call has no path to judge: it searches the whole workspace, or returns source for a query)")
  if (captainReadablePath(input.workspaceRoot, raw)) return undefined
  return investigationRefusal(toolName, JSON.stringify(raw))
}

/**
 * The sentence a refused reconnaissance call carries: WHY, the ROUTE OUT and the band that stays open.
 *
 * @param toolName - the tool that was attempted.
 * @param target - the path as the caller spelled it, or the reason none could be read.
 * @returns the denial sentence.
 */
function investigationRefusal(toolName: string, target: string): string {
  return "captain investigation rule: `" + toolName + "` on " + target + " is refused — the `mpd`"
    + " preset's TOP-LEVEL session does not run reconnaissance, so its context stays small enough for very large"
    + " projects. Delegate it: `mpd_role_spawn` with the `Explorer` role (find files and code) or the"
    + " `Researcher` role (evidence-based search), or hand the search to a team member, and consume the"
    + " REPORT. The documentation band stays open to you, and this is the whole of it: `AGENT.md`,"
    + " `AGENTS.md` and `CLAUDE.md` at ANY depth — inside this workspace or outside its root, so a sibling"
    + " project's instruction file is readable; the trees `.mpd/**`, `docs/**`, `evidence/**` and"
    + " `agent-references/**`; and, at the workspace root only, `README.md`, `README.zh-CN.md`,"
    + " `CHANGELOG.md` and `LICENSE*.md` — those two README spellings exactly, since there is no"
    + " `README*` glob. Every source path stays refused, and `captain.investigation: \"allow\"` in"
    + " mpd.jsonc restores full access."
}

/**
 * What installing the captain's investigation guard needs.
 *
 * The config reader is the row's own `configValue`, so the knob follows the EXISTING mechanism — the
 * mounted `mpdConfig` service first (a `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18) and this
 * row's own patch config second — and no second config mechanism is introduced.
 */
export interface CaptainInvestigationOptions {
  /** The workspace root of one call, from the adapter. */
  workspaceRootOf: (exec: DshToolExec) => string
  /** Raw config reader for `captain.investigation`. */
  configValue: (key: string) => unknown
  /** One-line reporter: an install-time degradation, or the ONE internal guard error that passes a call through. */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface CaptainInvestigationInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** The mode observed at install time, which the row's boot line reports. */
  mode: InvestigationMode
  /** Why it did not install, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Install the captain's investigation guard through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule is
 * a stated absence rather than an enforcement, and the row's boot line says so.
 *
 * The callback body is ERROR-BOUNDED: a malformed/throwing exec handle or an unreadable config layer
 * passes the call through (returning `undefined`) and is reported once — the guard must never deny or
 * fail an unrelated tool call for a reason of its own.
 *
 * The MODE is read per call inside the decision — so a live `mpd.jsonc` edit takes effect without a
 * restart — while the returned `mode` is the install-time observation the boot line reports.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the root resolver, the config reader and the reporter.
 * @returns the install outcome.
 */
export function installCaptainInvestigationGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: CaptainInvestigationOptions,
): CaptainInvestigationInstall {
  /** The mode at install time, reported by the caller's boot line. */
  const mode = resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY))
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the captain investigation guard is NOT installed "
        + "(the top-level session keeps read/grep/glob on source paths; the rule lives in the instruction text only)")
      return { installed: false, mode, reason: "no-guard-seam" }
    }
    /**
     * Whether the internal-error warning has already been reported, so a persistently malformed exec
     * call is visible in the row log ONCE instead of on every tool call.
     */
    let reportedInternalError = false
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => {
      // AN INTERNAL ERROR MUST NEVER FAIL AN UNRELATED TOOL CALL: a throwing exec/args proxy or a config
      // layer that refuses a read is a PASS-THROUGH, reported once, never a deny and never a throw.
      try {
        return captainInvestigationDecision({
          toolName: String(exec?.name ?? ""),
          args: exec?.arguments,
          workspaceRoot: ((): string => { try { return options.workspaceRootOf(exec) } catch { return "" } })(),
          topLevel: sessionIsMpdCaptain(exec?.agent),
          mode: resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY)),
        })
      } catch (error) {
        if (!reportedInternalError) {
          reportedInternalError = true
          options.warn("the captain investigation guard hit an internal error and passed the call through ("
            + (error instanceof Error ? error.message : String(error)) + ")")
        }
        return undefined
      }
    })
    return { installed: true, mode, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the captain investigation guard failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, mode, reason: "install-failed" }
  }
}
