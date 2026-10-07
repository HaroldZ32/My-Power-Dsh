// THE VERIFICATION LAW, as pure decisions.
//
// The law, in one sentence: code written by A is verified by B, where B is a DIFFERENT agent, B works
// from the frozen contract and the documentation (never from the implementation), B records its verdict
// BEFORE reading any implementation, and a FAIL bounces the work back to a writer as a repair task.
//
// WHY THIS FILE IS PURE. A guard is the one piece of code that must never throw and must never be
// approximately right, and a rule that can only be observed by booting a harness cannot be checked in
// both directions. Everything here is a function of its arguments — no filesystem, no service, no
// clock — so the QA case can drive every branch offline, and the live guard is a thin caller of exactly
// the function the case proved.
//
// TWO DECISIONS LIVE HERE:
//   1. {@link captainWriteDecision} — may THIS caller write THIS path right now?
//   2. {@link verifierEnvelopeDecision} — may a bound VERIFIER call THIS tool with THESE arguments?
// The record validator (what makes A-writes/B-verifies mechanical rather than aspirational) is the
// sibling module `record.ts`.

/** The write-capable tool names the captain's rule covers (spec (a), frozen). */
export const GATED_WRITE_TOOLS: readonly string[] = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
]

/**
 * The CODE extensions, as the spec freezes them.
 *
 * Anything NOT listed here counts as code too, unless it is an always-writable path or carries no
 * extension at all on a `write` whose argument is not a string — the classifier is deliberately
 * fail-closed, because "an extension I did not think of" must never be a way around the law.
 */
export const DEFAULT_CODE_EXTENSIONS: readonly string[] = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonc", ".yml", ".yaml", ".toml",
  ".sh", ".bash", ".zsh", ".ps1", ".cmd", ".bat",
  ".py", ".rs", ".go", ".css", ".html", ".vue", ".sql",
]

/** Basenames that are code whatever their extension (they have none). */
export const CODE_BASENAMES: readonly string[] = ["Dockerfile", "Makefile"]

/** Workspace-relative prefixes that are ALWAYS writable, by any caller, with no loop. */
export const ALWAYS_WRITABLE_PREFIXES: readonly string[] = [".mpd/", "docs/", "evidence/", "agent-references/"]

/**
 * The directories a BLIND verifier may read: the loop's own frozen basis plus the documentation band.
 *
 * The point is that B works from the CONTRACT and the DOCS. `packages/**` and `scripts/**` are not on
 * this list, so a blind verifier's `read` of the implementation is denied until it has recorded a
 * verdict — and only a FAIL unlocks it (the two-way ratchet).
 *
 * `evidence/**` IS on the band, by the captain's ruling (2026-10-07): a verifier asked to rest a verdict
 * on an artifact must be able to READ that artifact, while the content-free probe only ever reports what
 * exists, how big it is and its hash. THE RESIDUAL IS DECLARED, not implied: an `evidence/**` artifact
 * may EMBED source frames — a gate log's tail prints whatever the runner printed, and a captured listing
 * is a listing — so this band is CONTROLLED BLACK-BOX EVIDENCE and never a proof of reading nothing.
 * Blindness is what the plugin's own observation log proves (see `observe.ts`), not the width of a list.
 */
export const VERIFIER_DOC_PREFIXES: readonly string[] = [".mpd/plans/", "docs/", "agent-references/", ".mpd/verify/", "evidence/"]

/**
 * The package documents a BLIND verifier may read: one level under `packages/`, and the README pair only.
 *
 * A package's README is its own published contract — the document a verifier checks the shipped behaviour
 * against — so it belongs to the blind band (captain's ruling, 2026-10-07), exactly as a `docs/**` page
 * does. The pattern is deliberately DEPTH-ONE and NAME-EXACT: `packages/<pkg>/README.md` and
 * `packages/<pkg>/README.zh-CN.md` and nothing else, so `packages/<pkg>/src/**` and
 * `packages/<pkg>/test/**` stay outside the band whatever the caller spells.
 */
const VERIFIER_README_PATTERN = /^packages\/[^/]+\/README(?:\.zh-CN)?\.md$/

/**
 * The contract a loop that named NONE is checked against — DECLARED, and never a wave's plan file.
 *
 * A wave's contract is per-loop (`mpd_verify_open {contract}`): the seat of loop X is handed X's own
 * document. A loop opened with no contract must still be handed something STABLE, because the failure
 * this default replaces was a hardcoded pair that handed every later wave the PREVIOUS wave's plan. The
 * binding manual is the document that states the law itself (§4/§5) in every workspace, so it is the
 * honest fallback: it is not a wave's artifact, it cannot go stale when a wave ends, and a verifier
 * reading it has read exactly what a contract-less verification can be judged against.
 */
export const DEFAULT_CONTRACT_PATH = "AGENTS.md"

/**
 * The contract one loop freezes for its seat: the loop's OWN path, else the declared default.
 *
 * ONE resolution site, used by both `mpd_verify_seat` and `mpd_verify_record`, so the docPaths handed to
 * a seat and the `basis.frozenContract` hashed into its record can never disagree. A loop file written
 * by an older revision carries no `contract` field at all; it takes the same fallback, which is why the
 * legacy shape stays readable.
 *
 * @param loop - the loop record, or `undefined` when the caller's loop is unknown (a `pre-plugin` record).
 * @returns the workspace-relative contract path in force, never empty.
 */
export function loopContractPath(loop: { contract?: string } | undefined): string {
  /** The loop's own contract, normalised; empty when it never named one. */
  const named = normalizeContractPath(loop?.contract)
  return named === undefined ? DEFAULT_CONTRACT_PATH : named
}

/**
 * Normalise one caller-supplied contract spelling to the workspace-relative POSIX form the ledger stores.
 *
 * @param raw - the contract as the caller or the loop file spelled it.
 * @returns the normalised path, or `undefined` when nothing usable was given (absent, empty, or `.`).
 */
export function normalizeContractPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  /** The spelling with separators normalised, a leading `./` dropped and a trailing `/` trimmed. */
  const normalized = stripLeadingDot(toPosix(raw.trim())).replace(/\/+$/, "")
  return normalized === "" || normalized === "." ? undefined : normalized
}

/** The only directory a verifier may WRITE: its own evidence and records are written by the tool. */
export const VERIFIER_WRITE_PREFIX = ".mpd/verify/"

/** Tools a bound verifier may never call, whatever their arguments (spec (c), frozen). */
export const VERIFIER_DENIED_TOOLS: readonly string[] = [
  "bash", "powershell", "pwsh",
  "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename",
  "mcp__codegraph__codegraph_explore",
  "mcp__lsp__diagnostics", "mcp__lsp__goto_definition", "mcp__lsp__find_references",
  "mcp__lsp__symbols", "mcp__lsp__prepare_rename",
]

/**
 * The tool-name PREFIXES a bound verifier may never call: every other team/board mutation.
 *
 * `mpd_verify_*` is subtracted first — those five tools ARE the verifier's job, and denying them would
 * make the envelope unusable rather than strict.
 */
export const VERIFIER_DENIED_PREFIXES: readonly string[] = ["agent_teams_", "mpd_", "spawn_teammate", "team_task_", "team_"]

/** The prefix that exempts a name from {@link VERIFIER_DENIED_PREFIXES}: the law's own surface. */
export const VERIFY_TOOL_PREFIX = "mpd_verify_"

/** The kinds of path this module can classify. */
export type WriteTargetKind =
  /** The call carries no usable path — never guess, let it pass. */
  | "pass"
  /** Always writable: runtime state, docs, evidence, the agent-facing reference band, any `*.md`. */
  | "always"
  /** Code: gated by the captain's loop rule. */
  | "code"

/** One classified write target. */
export interface WriteTarget {
  /** What the classifier decided. */
  kind: WriteTargetKind
  /** The path as the caller wrote it, for the denial sentence. */
  raw: string
  /** The workspace-relative spelling, POSIX-separated; absent when the call carried no usable path. */
  rel?: string
  /** True when the raw path was absolute and resolved OUTSIDE the workspace root. */
  outside?: boolean
  /** True when the extension is one the declared set names, reported so a denial can say why. */
  declared?: boolean
}

/** The arguments a tool call may carry its target path under, in the order they are read. */
const PATH_ARG_KEYS: readonly string[] = ["file_path", "path", "filePath", "target"]

/**
 * Read the target path of one tool call, if it carries exactly one usable spelling.
 *
 * @param toolName - the tool being dispatched.
 * @param args - the validated argument object.
 * @returns the raw path, or `undefined` when the call carries none this law can act on.
 */
export function readTargetPath(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
  if (toolName === "mcp__ast_grep__rewrite") {
    /** The ast-grep rewrite carries a LIST of paths; its first entry is the one classified. */
    const paths = args?.paths
    if (Array.isArray(paths) && typeof paths[0] === "string") return paths[0]
  }
  for (const key of PATH_ARG_KEYS) {
    /** The raw value under this key, accepted only when it is a non-empty string. */
    const value = args?.[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

/**
 * Classify one write target against the workspace root.
 *
 * THE ORDER IS THE CONTRACT (never reorder it): an always-writable band wins first, then the code set,
 * then the fail-closed default. A relative path is resolved against the root; an absolute path outside
 * the root is CODE whatever it looks like, because the law cannot see what it is.
 *
 * @param workspaceRoot - the session workspace root, as the adapter resolved it.
 * @param raw - the path the call carried, already read by {@link readTargetPath}.
 * @param extensions - the code extensions; defaults to {@link DEFAULT_CODE_EXTENSIONS}.
 * @returns the classification, with the relative spelling the scope test uses.
 */
export function classifyWriteTarget(
  workspaceRoot: string,
  raw: string | undefined,
  extensions: readonly string[] = DEFAULT_CODE_EXTENSIONS,
): WriteTarget {
  if (typeof raw !== "string" || raw === "") return { kind: "pass", raw: String(raw ?? "") }
  /** The root, normalised to a POSIX path with no trailing separator. */
  const root = toPosix(workspaceRoot).replace(/\/+$/, "")
  /** True when the caller spelled an absolute path. */
  const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw)
  /** The path normalised to POSIX, so a Windows separator cannot smuggle a band past the test. */
  const posixRaw = toPosix(raw)
  /** The workspace-relative spelling, or `undefined` when the path is not under the root. */
  let rel: string | undefined
  if (!absolute) rel = stripLeadingDot(posixRaw)
  else if (root !== "" && posixRaw.startsWith(root + "/")) rel = posixRaw.slice(root.length + 1)
  if (rel === undefined) return { kind: "code", raw, outside: true }
  /** The basename, which the always-writable band matches for `*.md` and `LICENSE*`. */
  const base = rel.slice(rel.lastIndexOf("/") + 1)
  if (ALWAYS_WRITABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return { kind: "always", raw, rel }
  // THE BAND AS A WHOLE: `.mpd`, `docs`, `evidence` and `agent-references` named WITHOUT a trailing
  // slash are the directories themselves, and a directory is documentation by the same rule its
  // contents are.
  if (ALWAYS_WRITABLE_PREFIXES.some((prefix) => rel === prefix.replace(/\/$/, ""))) return { kind: "always", raw, rel }
  // A MARKDOWN FILE IS DOCUMENTATION WHEREVER IT LIVES. The manual, a package README and a plan file
  // are all agent-facing prose; gating them would block the very documents that state the law.
  if (/\.mdx?$/i.test(base) || /^LICENSE/i.test(base)) return { kind: "always", raw, rel }
  if (anyAlwaysWritableSegment(rel)) return { kind: "always", raw, rel }
  if (CODE_BASENAMES.includes(base)) return { kind: "code", raw, rel }
  /** The lowercase extension of the basename, or the empty string when it carries none. */
  const dot = base.lastIndexOf(".")
  /** The extension this basename declares, or the empty string when it declares none. */
  const ext = dot <= 0 ? "" : base.slice(dot).toLowerCase()
  // FAIL-CLOSED, BY DESIGN (spec (a.2)): an extension inside the declared set, an extension nobody
  // declared, and no extension at all are all CODE. The declared set therefore does not WIDEN or
  // NARROW the gate — it is the vocabulary the classification reports, so a denial can say WHY. A
  // gate that admitted "an extension I did not think of" would be a gate with a documented hole.
  return { kind: "code", raw, rel, ...(ext !== "" && extensions.includes(ext) ? { declared: true } : {}) }
}

/**
 * Whether any SEGMENT of a relative path is an always-writable band.
 *
 * `docs/` at the root and `packages/x/docs/` are the same kind of content, and a README inside a
 * package is already `*.md`; this clause exists for the non-`.md` members of those bands (an image, a
 * JSON fixture, a locale file) so their home directory does not become a code gate.
 *
 * THE BASENAME COUNTS TOO, because a caller may write about or into a DIRECTORY: `docs`,
 * `agent-references` and `.mpd` are band names, and a guard that classified the directory itself as code
 * would refuse a `grep` over the documentation band — measured on the first run of the envelope arm.
 *
 * @param rel - the workspace-relative POSIX path.
 * @returns true when the path sits inside (or IS) an always-writable directory anywhere in the tree.
 */
function anyAlwaysWritableSegment(rel: string): boolean {
  /** Every segment, the basename included. */
  const segments = rel.split("/")
  return segments.some((segment) => ["docs", "evidence", "agent-references", ".mpd"].includes(segment))
}

/**
 * Normalise a path to POSIX separators, collapsing nothing else.
 *
 * @param value - the path to normalise.
 * @returns the same path with backslashes replaced by slashes.
 */
function toPosix(value: string): string {
  return String(value ?? "").replace(/\\/g, "/")
}

/**
 * Drop a leading `./` so a caller's relative spelling matches the band prefixes.
 *
 * @param value - the relative path.
 * @returns the path without a leading `./`.
 */
function stripLeadingDot(value: string): string {
  return value.startsWith("./") ? value.slice(2) : value
}

/**
 * Whether a resolved path falls inside one loop's declared scope.
 *
 * An EMPTY scope means the whole workspace — that is the spec's contract, and it is why `scope` is
 * optional on `mpd_verify_open`: a captain who names no scope has scoped the loop to everything.
 *
 * @param rel - the workspace-relative path.
 * @param scope - the loop's declared scopes, as written (relative, POSIX or not).
 * @returns true when the path is inside the scope.
 */
export function pathInScope(rel: string | undefined, scope: readonly string[] | undefined): boolean {
  if (rel === undefined) return false
  if (scope === undefined || scope.length === 0) return true
  /** The path normalised once, so every comparison costs one `startsWith`. */
  const target = stripLeadingDot(toPosix(rel)).replace(/\/+$/, "")
  return scope.some((entry) => {
    /** This scope entry, normalised and stripped of a trailing `/**`. */
    const prefix = stripLeadingDot(toPosix(String(entry ?? ""))).replace(/\/+$/, "").replace(/\/\*\*$/, "")
    if (prefix === "" || prefix === ".") return true
    return target === prefix || target.startsWith(prefix + "/")
  })
}

/** One ARMED loop, as the guard needs it (the ledger stores the whole record). */
export interface ArmedLoopView {
  /** The loop's id. */
  loopId: string
  /** The captain session this loop belongs to. */
  sessionId: string
  /** `armed` is the only status that authorises a write. */
  status: string
  /** Who writes: `self` (the captain, counted) or `delegate`. */
  writerKind: "self" | "delegate"
  /** The writer's agent key. */
  writerId: string
  /** The verifier's agent key; `unbound` until a seat binds. */
  verifierId: string
  /** The scopes the loop covers; empty means the whole workspace. */
  scope: readonly string[]
  /** ISO instant after which the loop authorises nothing. */
  expiresAt: string
}

/** Everything {@link captainWriteDecision} needs, so the decision stays pure. */
export interface CaptainWriteInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object. */
  args: Record<string, unknown> | undefined
  /** The session workspace root. */
  workspaceRoot: string
  /** The calling session's key. */
  sessionId: string
  /** True when the caller is this workspace's TOP-LEVEL mpd agent (never a child session). */
  topLevel: boolean
  /** The loops known to the ledger. */
  loops: readonly ArmedLoopView[]
  /** The number of escape uses the caller still holds (in-memory, consumed on use). */
  escapeUses: number
  /** The code extensions in force. */
  extensions?: readonly string[]
  /** The instant to compare `expiresAt` against. */
  now: Date
}

/** The outcome of {@link captainWriteDecision}: a denial sentence, or a note about what authorised it. */
export interface WriteDecision {
  /** The denial to hand the harness, or `undefined` to allow the call. */
  deny?: string
  /** What authorised an allowed code write: a loop id, `escape`, or `always` for an exempt band. */
  allow?: "always" | "escape" | "loop"
  /** The loop that authorised it, when one did. */
  loopId?: string
  /** True when this call CONSUMES one escape use (the caller must decrement). */
  consumesEscape?: boolean
  /** The classification, reported so a caller can log exactly what it decided about. */
  target: WriteTarget
}

/**
 * Decide one write-family call by the workspace's top-level agent.
 *
 * THE THREE ROUTES, stated in the denial itself so the model does not have to guess: delegate the write
 * to a write-capable member (or a team task), open a self-writer loop with a DIFFERENT verifier, or take
 * a counted escape. Anything else is refused — and the refusal is a sentence, not a bare "denied",
 * because a gate whose escape route is undocumented produces a stuck agent, not a verified one.
 *
 * @param input - the call, the caller, the ledger's loops and the escape allowance.
 * @returns the decision; `deny` is absent when the call may proceed.
 */
export function captainWriteDecision(input: CaptainWriteInput): WriteDecision {
  /** The classification of this call's target. */
  const target = classifyWriteTarget(input.workspaceRoot, readTargetPath(input.toolName, input.args), input.extensions)
  if (!GATED_WRITE_TOOLS.includes(input.toolName)) return { allow: "always", target }
  if (target.kind === "pass") return { allow: "always", target }
  if (target.kind === "always") return { allow: "always", target }
  // A CHILD SESSION IS NOT THE CAPTAIN. This is the whole delegation doctrine in one line: a member,
  // a subagent, a workflow worker and a ralph round are all children, and they are exactly who the
  // captain is supposed to hand code to. Only the workspace's top-level mpd agent is gated.
  if (!input.topLevel) return { allow: "always", target }
  /** The instant the loop's expiry is compared against, as epoch milliseconds. */
  const nowMs = input.now.getTime()
  /** The first armed, in-scope, unexpired SELF loop with an independent verifier. */
  const loop = input.loops.find((candidate) => candidate.status === "armed"
    && candidate.sessionId === input.sessionId
    && candidate.writerKind === "self"
    && candidate.writerId === input.sessionId
    && candidate.verifierId !== candidate.writerId
    && pathInScope(target.rel, candidate.scope)
    && Date.parse(candidate.expiresAt) > nowMs)
  if (loop !== undefined) return { allow: "loop", loopId: loop.loopId, target }
  if (input.escapeUses > 0) return { allow: "escape", consumesEscape: true, target }
  return { deny: writeDenial(input.toolName, target), target }
}

/**
 * The denial sentence a gated captain write receives: what happened, and the three ways out.
 *
 * @param toolName - the tool that was refused.
 * @param target - the classification of the path it named.
 * @returns the sentence handed back to the model.
 */
export function writeDenial(toolName: string, target: WriteTarget): string {
  /** The path as the caller spelled it, quoted, so the sentence names what was refused. */
  const where = target.rel ?? target.raw
  return "verification law: `" + toolName + "` on the CODE path " + JSON.stringify(where)
    + " is refused for this workspace's top-level agent"
    + (target.outside === true ? " (an absolute path outside the workspace root counts as code)" : "")
    + ". Code written here must be verified by a DIFFERENT agent working from the docs, so take one of the three routes: "
    + "(1) DELEGATE the write — give the scope to a write-capable member (a team work task, or mpd_role_spawn / a subagent), "
    + "which is the normal path; "
    + "(2) OPEN A SELF-WRITER LOOP with mpd_verify_open {writer:\"self\", selfWriteReason:\"…\", verifier:\"<another agent>\"} "
    + "naming a verifier that is NOT you, which permits writes inside the loop's scope until it expires; "
    + "(3) take the COUNTED ESCAPE with mpd_verify_escape {reason:\"…\"}, which logs a row and allows one write. "
    + "Docs, `*.md`, `LICENSE*`, `.mpd/**`, `docs/**`, `evidence/**` and `agent-references/**` are never gated."
}

/** One bound verifier seat, as the envelope needs it. */
export interface VerifierSeatView {
  /** The loop the seat is bound to. */
  loopId: string
  /** The seat's agent key. */
  verifierId: string
  /** True once a FAIL has unlocked implementation reading for this seat (the ratchet). */
  unlocked: boolean
  /** The docs the loop froze, plus the loop's own basis; relative paths. */
  docPaths: readonly string[]
}

/** Everything {@link verifierEnvelopeDecision} needs, so the decision stays pure. */
export interface VerifierEnvelopeInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object. */
  args: Record<string, unknown> | undefined
  /** The session workspace root. */
  workspaceRoot: string
  /** The seat bound to the calling session, or `undefined` when it is not a bound verifier. */
  seat: VerifierSeatView | undefined
}

/** The outcome of {@link verifierEnvelopeDecision}. */
export interface EnvelopeDecision {
  /** The denial to hand the harness, or `undefined` to allow the call. */
  deny?: string
  /** True when the call is an implementation read that the FAIL unlock permitted (counted). */
  countedRead?: boolean
}

/**
 * Decide one call by a BOUND VERIFIER seat: the tool envelope of spec (c).
 *
 * Three rules, in order: a denied tool is refused whatever it names; a write is confined to
 * `.mpd/verify/**`; and a `read`/`glob`/`grep` is confined to the documentation band while the seat is
 * BLIND, with a bare path argument refused because a default path searches the whole workspace.
 *
 * @param input - the call and the seat bound to its caller.
 * @returns the decision; `deny` is absent when the call may proceed.
 */
export function verifierEnvelopeDecision(input: VerifierEnvelopeInput): EnvelopeDecision {
  /** The seat, or a fast pass for every caller that is not a bound verifier. */
  const seat = input.seat
  if (seat === undefined) return {}
  /** The tool name, read defensively. */
  const tool = String(input.toolName ?? "")
  if (VERIFIER_DENIED_TOOLS.includes(tool)) {
    return { deny: "verification law: a bound VERIFIER seat may not call `" + tool + "`. The verifier works from the"
      + " frozen contract and the documentation and proves its verdict with mpd_verify_evidence"
      + " (a whitelisted gate runner and a content-free artifact probe). Shell access, source-returning"
      + " tools and every board/team mutation are outside the envelope." }
  }
  if (VERIFIER_DENIED_PREFIXES.some((prefix) => tool.startsWith(prefix)) && !tool.startsWith(VERIFY_TOOL_PREFIX)) {
    return { deny: "verification law: a bound VERIFIER seat may not call `" + tool + "` — staging, dispatching or"
      + " mutating a team is not verification. Use mpd_verify_evidence / mpd_verify_record." }
  }
  /** The path this call names, if any. */
  const raw = readTargetPath(tool, input.args)
  /** Whether the call is a path-consuming read. */
  const isRead = tool === "read" || tool === "glob" || tool === "grep"
  /** Whether the call is a path-consuming write. */
  const isWrite = tool === "write" || tool === "edit" || tool === "mpd_hashline_edit"
  if (isWrite) {
    /** The write target, classified. */
    const target = classifyWriteTarget(input.workspaceRoot, raw)
    if (target.kind !== "pass" && target.rel !== undefined && target.rel.startsWith(VERIFIER_WRITE_PREFIX) && target.outside !== true) return {}
    return { deny: "verification law: a bound VERIFIER seat may only write under `" + VERIFIER_WRITE_PREFIX + "` (the tool"
      + " writes the verification record itself). A verifier never fixes what it found — record the finding and a"
      + " FAIL bounces the work back to a writer as a repair task." }
  }
  if (!isRead) return {}
  if (raw === undefined) {
    return { deny: "verification law: a bound VERIFIER seat must NAME the path it reads while it is blind — a bare"
      + " `" + tool + "` would search the whole workspace, implementation included. Name one of the frozen docs or a"
      + " path under " + VERIFIER_DOC_PREFIXES.map((prefix) => "`" + prefix + "`").join(", ") + ". After a recorded FAIL"
      + " the ratchet unlocks implementation reading for diagnosis only." }
  }
  /** The read target, classified. */
  const target = classifyWriteTarget(input.workspaceRoot, raw)
  if (target.kind === "pass") return {}
  // ALWAYS WRITABLE BANDS ARE NOT AUTOMATICALLY DOCS — but the ruling of 2026-10-07 puts `evidence/`
  // and the package READMEs INTO the blind band deliberately: a verifier that may only probe an artifact
  // for size and hash cannot check what the artifact says. The residual is declared on
  // {@link VERIFIER_DOC_PREFIXES} and stays declared here: an `evidence/**` artifact may embed source
  // frames, so this is CONTROLLED BLACK-BOX EVIDENCE, and blindness is proven by the observation log.
  if (isAllowedVerifierRead(target, seat)) return seat.unlocked ? { countedRead: true } : {}
  if (seat.unlocked) return { countedRead: true }
  return { deny: "verification law: a bound VERIFIER seat may not read " + JSON.stringify(target.rel ?? target.raw)
    + " while it is BLIND. Record your verdict with mpd_verify_record first, from the frozen contract and the docs:"
    + " the blindness requirement is that the verdict precedes any implementation read, and reading first makes the"
    + " verification unprovable. A recorded FAIL unlocks implementation reading for diagnosis, counted." }
}

/**
 * Whether a classified path is inside the blind verifier's documented allowlist.
 *
 * Three clauses, and every one of them is a DOCUMENT: the declared band ({@link VERIFIER_DOC_PREFIXES},
 * which since the captain's 2026-10-07 ruling includes `evidence/**`), a package's published README pair
 * ({@link VERIFIER_README_PATTERN}), and the loop's own frozen contract plus whatever the seat file
 * froze. A path that is none of those — `packages/<pkg>/src/**`, `packages/<pkg>/test/**`, `scripts/**`,
 * a build file — stays outside the band while the seat is blind.
 *
 * @param target - the classified read target.
 * @param seat - the seat, whose frozen docs extend the band.
 * @returns true when the blind verifier may read it.
 */
function isAllowedVerifierRead(target: WriteTarget, seat: VerifierSeatView): boolean {
  if (target.rel === undefined || target.outside === true) return false
  // NO PARENT HOPS. `evidence/../packages/x/src/y.ts` STARTS with an allowed prefix and ENDS outside it,
  // and this function never normalises a path: it compares spellings. A relative spelling carrying a `..`
  // segment is therefore refused outright rather than resolved — fail-closed, exactly as the classifier's
  // own order is, and the reason the widened band cannot be walked back out of by a caller who spells the
  // way out. (The same clause closes the pre-existing shape for the `docs/` and `.mpd/plans/` bands.)
  if (target.rel.split("/").includes("..")) return false
  // A PREFIX OR THE BAND ITSELF: a verifier may name the directory (`grep path:"docs"`), and the band it
  // names is exactly the band it is allowed to search.
  if (VERIFIER_DOC_PREFIXES.some((prefix) => target.rel!.startsWith(prefix) || target.rel === prefix.replace(/\/$/, ""))) return true
  if (VERIFIER_README_PATTERN.test(target.rel)) return true
  return seat.docPaths.some((doc) => {
    /** The frozen doc path, normalised to a workspace-relative POSIX spelling. */
    const normalized = stripLeadingDot(toPosix(String(doc ?? "")))
    return normalized !== "" && target.rel === normalized
  })
}

/**
 * The session key of one agent: `agent.session.id ?? agent.sessionId ?? agent.id`, else `"workspace"`.
 *
 * MIRRORED, not imported, from `mpd-team-core-plugin`'s `where()` chain — the `??` order and the
 * fallback ARE the contract, and two modules that disagree about which agent is calling would silently
 * exempt the captain.
 *
 * @param agent - the raw agent handle forwarded by the harness.
 * @returns the key, never empty.
 */
export function sessionKeyOf(agent: unknown): string {
  /** The agent viewed as a record, so a stub handle cannot throw here. */
  const view = agent as { session?: { id?: unknown }; sessionId?: unknown; id?: unknown } | undefined
  /** The three spellings, in the frozen order. */
  const candidates = [view?.session?.id, view?.sessionId, view?.id]
  for (const candidate of candidates) if (typeof candidate === "string" && candidate !== "") return candidate
  return "workspace"
}

/**
 * Resolve `verify.mode` to one of its three values.
 *
 * `hard` (the default) denies; `advisory` records the decision and lets the call through; `off` does
 * neither. The mode is read RAW from the config service — it is deliberately NOT part of the settings
 * schema, so the pinned knob count does not move.
 *
 * @param raw - the config value, as the layer reported it.
 * @returns the mode in force.
 */
export function resolveVerifyMode(raw: unknown): "hard" | "advisory" | "off" {
  /** The value lowercased, so `HARD` and `Hard` both resolve. */
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (value === "off") return "off"
  if (value === "advisory") return "advisory"
  return "hard"
}

/**
 * Read a positive integer knob, falling back to a declared default.
 *
 * @param raw - the config value, as the layer reported it.
 * @param fallback - the default to use when the value is absent, non-numeric or non-positive.
 * @returns the knob in force.
 */
export function resolvePositiveInt(raw: unknown, fallback: number): number {
  /** The value as a number; `Number` of a non-numeric string is NaN, which fails the check below. */
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Read a list-of-strings knob, falling back to a declared default.
 *
 * @param raw - the config value, as the layer reported it.
 * @param fallback - the default to use when the value is absent or carries no usable entry.
 * @returns the list in force.
 */
export function resolveStringList(raw: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(raw)) return fallback
  /** The usable entries: non-empty strings, in the caller's order. */
  const values = raw.filter((entry): entry is string => typeof entry === "string" && entry !== "")
  return values.length === 0 ? fallback : values
}

/**
 * The git subcommands that WRITE — AGENTS.md §5's one-git-writer rule, made mechanical.
 *
 * The list is a SUPERSET of the rule's own enumeration on purpose: a command that can move a ref, the
 * index or the working tree belongs here whatever its spelling, and missing one is the failure mode that
 * matters. Read-only git is deliberately NOT listed (see {@link GIT_READONLY_SUBCOMMANDS}).
 */
export const GIT_WRITE_SUBCOMMANDS: readonly string[] = [
  "commit", "add", "rm", "mv", "checkout", "switch", "restore", "reset", "stash", "merge", "branch",
  "rebase", "tag", "cherry-pick", "revert", "clean", "apply", "am", "update-index", "worktree",
  "init", "clone", "push", "fetch", "pull", "reflog",
]

/** The git subcommands that only READ — open to every session, per §5. */
export const GIT_READONLY_SUBCOMMANDS: readonly string[] = [
  "status", "log", "diff", "show", "grep", "ls-files", "rev-parse", "merge-base", "describe", "blame",
  "cat-file", "ls-tree", "shortlog", "whatchanged", "config", "remote", "notes",
]

/**
 * Whether one bash command INVOKES a git write, or merely mentions one.
 *
 * THE MENTION CLAUSE IS THE POINT. A heredoc carrying a commit message, an `echo "git commit …"`, a
 * `grep` for the string in a document and a `git log --grep=commit` are all commands that CONTAIN the
 * word `git` without running a git write, and a guard that reddened on prose would be the defect rather
 * than the fix. The matcher therefore looks for `git` where a COMMAND can start: at the beginning of the
 * string, after a separator (`;`, `&&`, `||`, `|`, `&`, `\n`, `(`, `{`), or after one of the wrapper
 * tokens that are followed by another command (`sudo`, `env`, `time`, `nice`, `command`, `exec`).
 *
 * THE HONEST BOUND, stated here because the alternative is an implication the code cannot keep: this
 * reads a command STRING, so an obfuscated invocation (`g"it" commit`, `sh -c "$X"`, a script file the
 * guard never sees) can evade it. It is a speed bump that makes §5 real for ordinary use — never a
 * sandbox, and never a claim of one.
 *
 * @param command - the `bash` tool's `command` argument.
 * @returns the git write subcommand this command invokes, or `undefined` when it invokes none.
 */
export function gitWriteSubcommand(command: unknown): string | undefined {
  if (typeof command !== "string" || command === "") return undefined
  /** The command with every heredoc BODY removed, so a commit message is not read as a commit. */
  const stripped = stripHeredocBodies(command)
  // A COMMAND BOUNDARY: the start of the string, a shell separator, or a wrapper token's follower.
  /** The boundary expression the command is split on; the captured tail starts at `git`'s arguments. */
  const boundary = /(?:^|[;&|()\n{}]|\b(?:sudo|env|time|nice|command|exec|nohup|xargs)\s+)\s*git\s+/
  for (const segment of stripped.split(boundary).slice(1)) {
    /** The tokens after `git`, whitespace-split; the subcommand is the first non-flag one. */
    const tokens = segment.trim().split(/\s+/)
    /** The index being read, advanced past flags and past the values of the flags that take one. */
    let index = 0
    while (index < tokens.length) {
      /** This token, lowercased only for the flag comparison below. */
      const token = tokens[index]
      if (!token.startsWith("-")) break
      // `git -C <dir> commit` and `git -c <k=v> commit` take a VALUE; every other flag does not.
      index += GIT_VALUE_FLAGS.includes(token) ? 2 : 1
    }
    /** The first non-flag token, which is the subcommand — empty when the command ends at the flags. */
    const sub = (tokens[index] ?? "").toLowerCase().replace(/[^a-z-].*$/, "")
    if (sub !== "" && GIT_WRITE_SUBCOMMANDS.includes(sub)) return sub
  }
  return undefined
}

/** The `git` flags that consume the NEXT token as their value, so it must not be read as a subcommand. */
export const GIT_VALUE_FLAGS: readonly string[] = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]

/**
 * Remove every heredoc BODY from a command string.
 *
 * WHY: `cat <<EOF … git commit … EOF` CONTAINS the words `git commit` and RUNS nothing — the text is the
 * heredoc's payload. A matcher that denied it would redden on exactly the case §5's own text describes
 * (a commit-MESSAGE heredoc), which is the defect class this rule must not introduce. Only the body is
 * removed; the command that opens the heredoc stays, so `git commit -F - <<EOF …` is still seen.
 *
 * @param command - the raw command string.
 * @returns the command with heredoc bodies replaced by a space.
 */
function stripHeredocBodies(command: string): string {
  // `<<` or `<<-`, an optional quoted marker, the body, then the marker on its own line.
  return command.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$|\n)/g, " ")
}

/** Everything {@link gitWriterDecision} needs. */
export interface GitWriterInput {
  /** The `bash` tool's `command` argument. */
  command: unknown
  /** True when the caller IS the workspace's top-level captain (§5's ONE git writer). */
  topLevelCaptain: boolean
}

/**
 * Decide one `bash` call against §5's one-git-writer rule.
 *
 * @param input - the command and whether the caller is the captain.
 * @returns the denial sentence, or `undefined` when the call may proceed.
 */
export function gitWriterDecision(input: GitWriterInput): string | undefined {
  // THE CAPTAIN IS THE ONE GIT WRITER: the rule binds everybody else, and it binds nobody else.
  if (input.topLevelCaptain) return undefined
  /** The git write subcommand this command really invokes, if any. */
  const sub = gitWriteSubcommand(input.command)
  if (sub === undefined) return undefined
  return "one-git-writer rule (AGENTS.md §5): this session is NOT the workspace's top-level captain, so it may not run"
    + " `git " + sub + "`. Teammates share the captain's checkout and two writers race on the single `.git/HEAD` —"
    + " measured 2026-09-14, a member's `reset HEAD~1` moved the `dev` tip. Read-only git (`git status` / `log` /"
    + " `diff` / `show` / `grep` / `ls-files` / `rev-parse` / `merge-base` / `describe` / `blame`) stays open to you:"
    + " edit files, run gates and write evidence, and ask the captain to commit."
}
