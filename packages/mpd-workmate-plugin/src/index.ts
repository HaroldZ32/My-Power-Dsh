// mpd-workmate-plugin: durable, evolving agent library under the user's HOME
// (~/.mpd/workmate). The roster specialists are BASE templates only: a workmate
// is an instantiated copy with an independent name that self-summarizes after each
// work session (persona + independent memory, size-capped to keep spawned context
// bounded) and keeps a short searchable note. Reuse via note-matching — when no note
// matches well enough, initialize a NEW workmate instead of forcing a weak match.
//
// Tools: mpd_workmate_list / mpd_workmate_init / mpd_workmate_spawn /
//        mpd_workmate_reflect / mpd_workmate_match / mpd_workmate_rename /
//        mpd_workmate_delete / mpd_workmate_optimize  (+ mpdWorkmate service,
//        the /workmate-optimize command, and the team plane's W3-C binding seam).
// The library root is deliberately the user's HOME (cross-project), a user-approved
// exception to the workspace-scoped state rule (AGENTS.md §6); QA boots with
// HOME=<sandbox> so tests never touch the real home.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { DSH_SEAM_SUBAGENTS, DSH_SEAM_TOOLS, HomeGuardRefusal, assertHomeMutationSandboxed, dshSeamInject, installChildPersonaSeam, restrictToolsTolerant, rowLogLine, resolveRunRoute, workspaceRootOf, agentUnconfiguredRefusal, type DshAdapter, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { WORKMATE_LIST_CARD, WORKMATE_MATCH_CARD } from "./dshgo-cards"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-workmate"
/** The seams this row needs declared: the tool registry and the subagent spawner, both named by their adapter constants. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS)

/** The slice of a cordis context this row uses: tools, subagents, the `mpdWorkmate` provision, an effect seam and a service reader. */
type Ctx = { tools: any; subagents: any; provide: (n: string, v: any) => void; effect?: (fn: () => unknown, label?: string) => any; on?: (event: string, handler: (...args: any[]) => any) => any; get?: (k: string) => any; [k: string]: any }

// Size caps (bytes): keep every injected workmate context bounded.
export const PERSONA_CAP = 8 * 1024
/** Byte cap on the independent memory injected into a spawned workmate. */
export const MEMORY_CAP = 8 * 1024
/** Byte cap on the note card, which is the whole matching corpus for `mpd_workmate_match`. */
export const NOTE_CAP = 1536
/** The score below which a match is NOT forced and a new workmate must be initialized instead. */
export const MATCH_THRESHOLD = 0.35

/** Read-only spawns are guarded by a tool-filter deny list. Every entry must be a tool this profile
 * actually registers: the harness validates the WHOLE list at spawn time and rejects the child when
 * any single name is unknown, so one dead entry breaks EVERY read-only spawn. `bash` is denied on
 * purpose — a shell can write files, so it is part of the read-only guarantee, not an oversight.
 * Kept exactly equal to the roles plugin's list (captain decision A2); the two exported arrays are
 * asserted equal by packages/mpd-roles-plugin/test/roles.test.ts. */
export const READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
]

/**
 * The bundle's OWN spawn tools, denied in the scope of every child this row raises (CR repair E).
 *
 * WHY: the pinned host treats `maxDepth` as an absolute cap for the child being started and does NOT carry it
 * into the child as a descendant restriction, so a child that could call a spawn tool again would raise its
 * own cap and nest past the consultation boundary. Denying BOTH names in the child's own tool scope makes
 * every consult a LEAF by construction — and it is what stops a READ-ONLY workmate delegating a write to a
 * write-capable role.
 *
 * It is a SEPARATE list from {@link READONLY_DENY} on purpose: that list is the read-only guarantee, exactly
 * eight names and asserted equal to the roles plugin's copy; this one applies to EVERY child. The roles row
 * keeps its own copy (no runtime cross-package import) and `test/leaf-boundary.test.ts` pins the two equal.
 */
export const LEAF_SPAWN_DENY: readonly string[] = ["mpd_role_spawn", "mpd_workmate_spawn"]

/** A refused mutation, carrying the wire reason of the shared protocol (contract §D) so the HTTP
 * layer maps it verbatim and the GUI can branch on it. It EXTENDS the adapter's shared home-guard
 * refusal (wave W0), so the T-43 guard — whose predicate lives in the adapter — keeps this row's wire
 * shape instead of a private copy. */
export class WorkmateError extends HomeGuardRefusal {
  /** The team members that block an `in-use` refusal, so the GUI can name them. */
  blocking: { teamId: string; member: string }[]
  /** Build a refusal carrying its wire reason, its HTTP status and the teams that block it. */
  constructor(code: string, message: string, status: number, blocking: { teamId: string; member: string }[] = []) {
    super(code, message, status)
    this.name = "WorkmateError"
    this.blocking = blocking
  }
}

/** Name predicate (D5/§B): a name is accepted iff it is ALREADY its own sanitized form, so "Alice",
 * CJK, "a/b", ".." and ".archive" are all rejected BEFORE any filesystem call. This is a superset of
 * every key the library has ever written, so no existing instance becomes un-addressable. */
export function nameKey(raw: unknown, label: string): string {
  /** The raw argument, stringified so a non-string cannot throw before the predicate runs. */
  const s = String(raw ?? "")
  /** The argument's sanitized form, which the predicate requires it to ALREADY equal. */
  const key = sanitizeName(s)
  if (s === "" || s !== key || key.length > 255) {
    throw new WorkmateError("invalid-name", `mpd_workmate: invalid ${label} "${s}" — names are ASCII, lowercase, [a-z0-9_-] only and must already be sanitized`, 400)
  }
  return key
}

/** Output schema of a spawned workmate's structured report, so the tool result is validated rather than guessed. */
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    recommendation: { type: "string" },
    details: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["name", "summary"],
  additionalProperties: false
}


/** The current instant as an ISO string; every persisted timestamp comes from here. */
function now(): string { return new Date().toISOString() }

// Home resolution: prefer $HOME (set at process start; QA boots dsh with
// HOME=<sandbox>) over os.homedir() — bun caches os.homedir()'s initial value and
// would ignore a runtime HOME change.
function homeDir(): string { return process.env.HOME || homedir() }

/** The library root (`~/.mpd/workmate`), resolved from HOME on EVERY call so a sandbox HOME is honoured. */
function workmateRoot(): string { return join(homeDir(), ".mpd", "workmate") }

/**
 * The deliberate escape hatch of the shared T-43 guard for THIS row: `=1` lets an isolated boot mutate
 * the real library on purpose, and the refusal message names it so the fix is discoverable.
 */
export const WORKMATE_ALLOW_REAL_HOME_ENV = "MPD_DSH_WORKMATE_ALLOW_REAL_HOME"

/**
 * T-43 — this row's refusal of a MUTATION that would land in the real `~/.mpd/workmate` while
 * `DSH_HOME` marks an isolated (QA/verification) boot; reads are never guarded.
 *
 * The workmate library is the ONE state root that deliberately lives under the user's HOME
 * (cross-project, user-owned), so a QA boot that forgets `HOME=<sandbox>` would write the REAL
 * library. The PREDICATE lives in the adapter's shared {@link assertHomeMutationSandboxed} (wave W0),
 * because the global-memory row guards `~/.mpd/memory` the same way; this row supplies only its own
 * root, message prefix and override variable, so its refusal text stays BYTE-IDENTICAL to the private
 * copy this replaced. The refusal is the adapter's `HomeGuardRefusal`, whose `code`/`status` the web
 * layer maps exactly as it mapped this row's own error. Proven by one positive and one negative case
 * in `evidence/platform/harness-close/`.
 *
 * @param operation the operation named in the refusal (e.g. "rename a workmate").
 * @returns nothing; it THROWS the adapter's `HomeGuardRefusal` (403 `real-home-refused`) when it fires.
 */
export function assertMutationSandboxed(operation: string): void {
  assertHomeMutationSandboxed({
    root: workmateRoot(),
    operation,
    label: "mpd_workmate",
    allowEnv: WORKMATE_ALLOW_REAL_HOME_ENV,
  })
}

/**
 * How many workspaces ONE instance may remember, most recent first.
 *
 * Bounded on purpose (R-W3C B2): the attribution exists to answer "does this workspace own this instance",
 * and a workmate reused across a dozen projects only has to remember the recent ones. Eight keeps the
 * field small enough that `meta.json` stays a record, not a log, while covering a realistic rotation.
 */
export const WORKSPACE_ATTRIBUTION_CAP = 8

/**
 * The bounded attribution list after ONE use from `workspace`: most recent first, de-duplicated, capped.
 *
 * A blank workspace (an agentless surface, a boot without a session) attributes NOTHING — inventing an
 * owner there would corrupt the budget the list exists to feed.
 *
 * @param existing - the instance's current attribution list.
 * @param workspace - the workspace the instance is being used from, or "" when unknown.
 * @returns the new list; the SAME array when nothing would change (so a caller can skip the write).
 */
export function attuneWorkspaces(existing: readonly string[], workspace: string): string[] {
  /** The workspace being attributed, trimmed; blank attributes nothing. */
  const key = String(workspace ?? "").trim()
  if (key === "") return [...existing]
  if (existing[0] === key && existing.length <= WORKSPACE_ATTRIBUTION_CAP) return [...existing]
  return [key, ...existing.filter((entry) => entry !== key)].slice(0, WORKSPACE_ATTRIBUTION_CAP)
}

/** Instance path. Guarded (§B): `wmDir("")` would resolve to the LIBRARY ROOT itself, so an empty
 * name can never name a directory — the root is not an instance and can never be moved or removed. */
function wmDir(name: string): string {
  /** The sanitized key; an empty one would name the library root itself, which is not an instance. */
  const key = sanitizeName(name)
  if (key === "") throw new WorkmateError("invalid-name", "mpd_workmate: empty workmate name — the library root is not an instance", 400)
  return join(workmateRoot(), key)
}

/**
 * The workmate KEY one child label names, or `null` when the label is not already a canonical key.
 *
 * A workmate child's label IS its sanitized library key, so the comparison is EXACT: any other
 * spelling belongs to another seam. Sanitizing here would be an identity collision — a ROSTER child
 * labelled "Explorer" sanitizes to `explorer`, so it would resolve to a workmate of that name and
 * inherit that record's `readonly` flag, letting one seam answer for the other's child.
 * @param label - the child's own delegation label.
 * @returns the canonical key, or `null` when this label is not a workmate key.
 */
export function workmateKeyFromLabel(label: unknown): string | null {
  /** The label as text; a non-string is not a workmate key. */
  const text = typeof label === "string" ? label : ""
  if (text === "") return null
  return sanitizeName(text) === text ? text : null
}

/** Instance name → filesystem-safe, lowercase, kebab-ish. */
export function sanitizeName(s: string): string {
  /** The sanitized form: trimmed, lowercased, runs of illegal characters collapsed to one hyphen. */
  const t = String(s ?? "")
    .trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
  return t
}

/** Cap a text: keep head + tail with a truncation marker, all of it WITHIN the cap. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text
  /** The truncation marker, whose own bytes are paid for OUT of `max` rather than added on top (S6). */
  const marker = `\n…[truncated ${text.length - max} chars]…\n`
  // A cap too small to carry the marker cannot report one: the hard slice keeps the declared bound.
  if (marker.length >= max) return text.slice(0, Math.max(0, max))
  /** The room left for the content once the marker's own bytes are accounted for. */
  const budget = max - marker.length
  /** How much of the head survives (three quarters of that room). */
  const head = Math.floor(budget * 0.75)
  /** How much of the tail survives; head + tail + marker sum to exactly `max`. */
  const tail = budget - head
  return text.slice(0, head) + marker + text.slice(-tail)
}

/** An instance's on-disk metadata; `baseId` inside it is INTERNAL provenance, never published. */
type Meta = {
  name: string; baseId: string; baseName: string; description: string
  provider: string; model: string; readonly: boolean
  createdAt: string; updatedAt: string; uses: number; lastTask: string | null
  renamedFrom: string[]
  // ── the persona bookkeeping (wave W4-A3). The two `*Revision` names are a TRAP worth reading twice:
  //   personaRevision  is the INTEGER CAS token of THIS instance's persona history (1 at birth);
  //   baseRevision     is the SHA-256 of the BASE ROSTER PERSONA the instance was born from (drift
  //                    baseline, never moved by an instance-local write);
  //   personaHash      is the SHA-256 of the CURRENT persona text, or "unknown" when unreadable.
  // An instance created before this wave carries none of them: they are BACKFILLED on the next write
  // (`personaRecordOf` + `applyPersonaWrite`), never guessed at read time.
  /** Monotone integer, 1 at birth, +1 per persona write; `0` means "not versioned yet". */
  personaRevision: number
  /** sha256 of the current persona text (trimmed), or `UNKNOWN_HASH`. */
  personaHash: string
  /** sha256 of the base persona text the instance was born from, or `UNKNOWN_HASH`. */
  baseRevision: string
  /**
   * The WORKSPACES this instance has served, most recent first, capped at
   * {@link WORKSPACE_ATTRIBUTION_CAP}.
   *
   * The library is HOME-scoped and cross-project, so `workmates.max` can only be a PER-WORKSPACE budget
   * if an instance says which projects it belongs to (R-W3C B2). Written at init and at every reuse/bind —
   * `mpd_workmate_spawn`, `mpd_workmate_reflect`, `mpd_workmate_persona_set` — and never guessed: a legacy
   * instance carries an empty list, so it counts toward a workspace only after it is used there, which is
   * what keeps an old cross-project library from blocking a fresh project forever.
   */
  workspaces: string[]
}

/** Read and normalize `meta.json`; a missing or unparsable file reads as null, never a throw. */
function readMeta(dir: string): Meta | null {
  try {
    if (!existsSync(join(dir, "meta.json"))) return null
    /** The parsed metadata, normalized field by field so a hand-edited file cannot break a caller. */
    const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask), renamedFrom: Array.isArray(m.renamedFrom) ? m.renamedFrom.map(String) : [], personaRevision: Number.isInteger(m.personaRevision) && Number(m.personaRevision) > 0 ? Number(m.personaRevision) : 0, personaHash: typeof m.personaHash === "string" ? m.personaHash : "", baseRevision: typeof m.baseRevision === "string" ? m.baseRevision : "", workspaces: Array.isArray(m.workspaces) ? m.workspaces.map(String).filter((workspace: string) => workspace !== "").slice(0, WORKSPACE_ATTRIBUTION_CAP) : [] }
  } catch { return null }
}

/** Public projection of an instance's metadata (C3): the roster `baseId` is INTERNAL provenance.
 * It stays on disk (meta.json / index.json) and is never returned by a tool, an output schema, a
 * web route or a GUI surface — so a consumer can only know the base by its functional name. */
function publicMeta(meta: Meta): Record<string, unknown> {
  /** The metadata minus `baseId`, which no tool, output schema, web route or GUI ever exposes. */
  const out: Record<string, unknown> = { ...meta }
  delete out.baseId
  return out
}

/** Write pretty JSON with a trailing newline, creating the parent directory first. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

/** The library index: the file that answers a list without reading every instance directory. */
function indexPath(): string { return join(workmateRoot(), "index.json") }

/** The cheap per-instance row the index keeps; the directory name is its key. */
type IndexEntry = { name: string; baseId: string; baseName: string; uses: number; updatedAt: string }

/** The parsed index; a missing, unreadable or non-object file reads as an empty index. */
function readIndex(): Record<string, IndexEntry> {
  try {
    if (!existsSync(indexPath())) return {}
    /** The parsed index value, accepted only when it is a plain object. */
    const v = JSON.parse(readFileSync(indexPath(), "utf8"))
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}
  } catch { return {} }
}

/** Persist the whole index; every key move goes through ONE write, never a delete-then-add. */
function writeIndex(idx: Record<string, IndexEntry>): void { writeJson(indexPath(), idx) }

/** Project an instance's metadata onto its index row. */
function indexEntryOf(key: string, meta: Meta): IndexEntry {
  return { name: key, baseId: meta.baseId, baseName: meta.baseName, uses: meta.uses, updatedAt: meta.updatedAt }
}

/** Index writes are keyed by the DIRECTORY name (A3), never by `meta.name` — the directory is the
 * identity, `meta.name` is only a display mirror. */
function writeIndexEntry(key: string, meta: Meta): void {
  /** The index, mutated and then written back in the same call. */
  const idx = readIndex()
  idx[key] = indexEntryOf(key, meta)
  writeIndex(idx)
}

/** Move the index key in ONE write: the stale key must never be left behind in index.json. */
function renameIndexKey(oldKey: string, newKey: string, meta: Meta): void {
  /** The index with the old key removed and the new one added before the single write. */
  const idx = readIndex()
  delete idx[oldKey]
  idx[newKey] = indexEntryOf(newKey, meta)
  writeIndex(idx)
}

/** Drop the index key and return the previous entry, so a failed mutation can restore it. */
function dropIndexKey(key: string): IndexEntry | undefined {
  /** The index; the key is removed only when it is actually present. */
  const idx = readIndex()
  if (!(key in idx)) return undefined
  /** The removed row, returned so a failed mutation can restore it verbatim. */
  const prev = idx[key]
  delete idx[key]
  writeIndex(idx)
  return prev
}

/** Put a removed index row back, which is how a failed delete leaves the library as it was. */
function restoreIndexEntry(key: string, entry: IndexEntry): void {
  /** The index, restored and written back. */
  const idx = readIndex()
  idx[key] = entry
  writeIndex(idx)
}

// Read/write helpers take the instance KEY (the directory name), never `meta.name`.
function readNote(key: string): string {
  try { return readFileSync(join(wmDir(key), "note.md"), "utf8").trim() } catch { return "" }
}

/** Read an instance's memory, trimmed to the newest `tailBytes` bytes so injected context stays bounded. */
function readMemory(key: string, tailBytes: number = MEMORY_CAP): string {
  try {
    /** The whole memory text; only its tail is ever injected. */
    const t = readFileSync(join(wmDir(key), "memory.md"), "utf8").trim()
    if (t.length <= tailBytes) return t
    return "…[earlier memory trimmed]…\n" + t.slice(-tailBytes)
  } catch { return "" }
}

/** Read an instance's persona; a missing file reads as the empty string. */
function readPersona(key: string): string {
  try { return readFileSync(join(wmDir(key), "persona.md"), "utf8").trim() } catch { return "" }
}

/** Auto-generate a short note card: keep the accumulated specialty (previous note or
 * persona head) and append the most recent task, so the note stays a stable matchable
 * identity plus freshness. The base-name prefix is added once only (dedupes re-reflect). */
/** Build the short note card: the base-name identity plus the most recent task, capped to `NOTE_CAP`. */
export function autoNote(meta: Meta, persona: string, memory: string, previous: string = ""): string {
  /** The identity prefix this function writes, and the exact prefix a rename rewrites. */
  const prefix = `${meta.baseName}-based workmate "${meta.name}".`
  /** The previous note, whose accumulated specialty must survive a re-reflect. */
  const prev = previous.trim()
  /** The identity line: the prefix, with the previous note appended once when it adds something. */
  const identity = prev === "" ? prefix : (prev.startsWith(prefix) ? prev : `${prefix} ${prev}`)
  /** The newest memory heading (`## …`), which is the freshness half of the note. */
  const last = memory.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("## ")).pop() || ""
  /** The last task line, or a placeholder for a workmate that has not worked yet. */
  const task = meta.lastTask ? "Last task: " + meta.lastTask : "No task history yet"
  return capText(`${identity} ${task}.${last ? " " + last.replace(/^##\s*/, "") : ""}`, NOTE_CAP)
}

/** Append a bounded memory entry; evict oldest "## "-blocks that exceed the cap. */
function appendMemory(key: string, entry: string): string {
  /** The memory file of this instance. */
  const path = join(wmDir(key), "memory.md")
  /** The memory as it stands, or the empty string for a workmate that has none. */
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim()
  /** The memory with the new entry appended, before the cap is applied. */
  const next = (existing ? existing + "\n\n" : "") + entry.trim()
  if (next.length <= MEMORY_CAP) { writeFileSync(path, next + "\n"); return next }
  /** The memory split into `## ` blocks, so eviction drops whole entries rather than half of one. */
  const blocks = next.split(/\n## /).map((b, i) => (i === 0 ? b : "## " + b)).filter((b) => b.trim().length > 0)
  /** The blocks that fit, rebuilt oldest-first so the file keeps reading in time order. */
  let kept: string[] = []
  /** Running byte count of `kept`, which is what the cap is measured against. */
  let len = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    /** The block under consideration; one that would overflow the cap ends the walk. */
    const b = blocks[i]
    if (len + b.length > MEMORY_CAP) break
    kept.unshift(b)
    len += b.length
  }
  /** The surviving memory text, which is also what gets written. */
  const out = kept.join("\n\n")
  writeFileSync(path, out + "\n")
  return out
}

// ── PERSONA VERSIONS AND BASE DRIFT (wave W4-A3) ────────────────────────────────────────────────
//
// A workmate persona EVOLVES, and the roster BASE template it was copied from evolves too. Without a
// recorded baseline the second kind of change is invisible, and the instance silently diverges from the
// family it claims to belong to. The record therefore separates three things:
//
//   meta.personaRevision  the INTEGER CAS token of this instance's own history (1 at birth, +1 per write);
//   meta.baseRevision     sha256 of the BASE ROSTER PERSONA the instance was born from (the drift
//                         baseline — instance-local writes never move it);
//   meta.personaHash      sha256 of the CURRENT persona text.
//
// Every persona write also stores the whole text under `persona.versions/<revision>.md` (monotone, never
// overwritten), and the birth text of the base under `persona.base.md`, so a later reader can DIFF two
// real documents instead of trusting a number.

/** The marker recorded when a hash cannot be computed: never a fabricated digest. */
export const UNKNOWN_HASH = "unknown"

/** The sub-directory holding one file per persona revision. */
function versionsDir(dir: string): string { return join(dir, "persona.versions") }

/** The path of the snapshot of the BASE persona this instance was born from. */
function baseSnapshotPath(dir: string): string { return join(dir, "persona.base.md") }

/** Read the persona text of one INSTANCE DIRECTORY, trimmed — the exact shape every hash is computed over. */
function readPersonaIn(dir: string): string {
  try { return readFileSync(join(dir, "persona.md"), "utf8").trim() } catch { return "" }
}

/** Read the stored base snapshot, or null for an instance that predates the baseline. */
function readBaseSnapshot(dir: string): string | null {
  try {
    /** The snapshot path; an absent file is "no baseline", not an empty text. */
    const path = baseSnapshotPath(dir)
    return existsSync(path) ? readFileSync(path, "utf8").trim() : null
  } catch { return null }
}

/** Write the base snapshot ONCE: the baseline is the BIRTH text, so an existing snapshot is kept. */
function writeBaseSnapshot(dir: string, baseText: string): void {
  /** The snapshot path, created on the first write only. */
  const path = baseSnapshotPath(dir)
  if (existsSync(path)) return
  writeFileSync(path, baseText.trim() + "\n")
}

/** Above this many lines on either side, the diff falls back to a multiset count instead of the LCS. */
const MAX_DIFF_LINES = 800

/**
 * The length of the longest common subsequence of two line arrays, in O(min) memory.
 *
 * @param a - the left line array.
 * @param b - the right line array.
 * @returns how many lines the two share, in order.
 */
function lcsLines(a: readonly string[], b: readonly string[]): number {
  /** The shorter side is the DP row, which is what keeps the memory bounded. */
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  /** The previous DP row, one cell per position of the longer side plus one. */
  let prev = new Array<number>(long.length + 1).fill(0)
  for (let i = 1; i <= short.length; i++) {
    /** The row being built for this line of the shorter side. */
    const cur = new Array<number>(long.length + 1).fill(0)
    for (let j = 1; j <= long.length; j++) cur[j] = short[i - 1] === long[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    prev = cur
  }
  return prev[long.length]
}

/**
 * How many LINES differ between two texts — the number `baseDriftLines` reports.
 *
 * It is `|a| + |b| - 2 * LCS(a, b)`, i.e. the deletions plus the insertions a diff would show. Above
 * {@link MAX_DIFF_LINES} on either side the LCS is skipped (a quadratic walk over a pathological input
 * would hang a list call) and a multiset difference is counted instead: the same number for an append or
 * a rewrite, an upper bound for a reordering.
 *
 * @param a - the left text, usually the stored base snapshot.
 * @param b - the right text, usually the current base persona.
 * @returns the line count that changed; 0 for identical texts (including two empty ones).
 */
export function lineDiffCount(a: string, b: string): number {
  /** The left text's lines. */
  const left = String(a ?? "").split("\n")
  /** The right text's lines. */
  const right = String(b ?? "").split("\n")
  // Two empty documents are identical, even though splitting "" yields one empty line on each side.
  if (String(a ?? "").trim() === "" && String(b ?? "").trim() === "") return 0
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    /** The right side's line multiset, so the fallback can count what the left side still owes. */
    const pool = new Map<string, number>()
    for (const line of right) pool.set(line, (pool.get(line) ?? 0) + 1)
    /** Lines of the left side with no partner left in the right side. */
    let changed = 0
    for (const line of left) {
      /** Remaining copies of this exact line on the right. */
      const count = pool.get(line) ?? 0
      if (count > 0) pool.set(line, count - 1)
      else changed += 1
    }
    for (const count of pool.values()) changed += count
    return changed
  }
  return left.length + right.length - 2 * lcsLines(left, right)
}

/**
 * The next revision number at or above `from` whose version file does not exist.
 *
 * A version file is NEVER overwritten, so the walk exists for the one case a monotone counter cannot
 * cover: a hand-restored directory whose counter fell behind its files.
 *
 * @param dir - the instance directory.
 * @param from - the smallest revision to consider.
 * @returns a free revision number.
 */
function nextFreeRevision(dir: string, from: number): number {
  /** The directory the version files live in. */
  const versions = versionsDir(dir)
  /** The candidate revision, never below 1. */
  let revision = Math.max(1, Math.trunc(from))
  // Bounded on purpose: an unbounded walk over a corrupt directory would hang a tool call.
  for (let step = 0; step < 100000; step++) {
    if (!existsSync(join(versions, revision + ".md"))) return revision
    revision += 1
  }
  throw new Error("mpd_workmate: this workmate's persona version history is corrupt (no free revision number below 100000)")
}

/**
 * Write ONE persona version file.
 *
 * @param dir - the instance directory.
 * @param revision - the revision number the file is named after.
 * @param text - the persona text at that revision.
 */
function writePersonaVersion(dir: string, revision: number, text: string): void {
  mkdirSync(versionsDir(dir), { recursive: true })
  /** The version file's path. */
  const path = join(versionsDir(dir), revision + ".md")
  // NEVER overwrite: an existing revision is history, and clobbering it would make a diff a lie.
  if (existsSync(path)) throw new Error("mpd_workmate: persona revision " + revision + " already exists and is never overwritten")
  writeFileSync(path, text + "\n")
}

/** The persona bookkeeping of ONE instance, computed from disk (this function NEVER writes). */
export interface PersonaRecord {
  /** The revision the next write would record; a legacy instance's current text is revision 1. */
  revision: number
  /** sha256 of the current persona text, or `UNKNOWN_HASH` when the file could not be read. */
  hash: string
  /** sha256 of the base persona the instance was born from, or `UNKNOWN_HASH`. */
  baseRevision: string
  /** Whether any of the three fields had to be filled in for a legacy instance. */
  backfilled: boolean
}

/**
 * Read one instance's persona bookkeeping without touching the disk.
 *
 * THE READ-COMPAT RULE: a legacy instance (no fields) is not an error and not a guess — its current
 * persona text IS revision 1, its `baseRevision` is the CURRENT base hash (recorded on the next write,
 * because that is the first moment this instance can be said to have a baseline), and a base the roster
 * cannot resolve records `UNKNOWN_HASH` rather than a fabricated digest.
 *
 * @param dir - the instance directory.
 * @param meta - the instance's metadata.
 * @param currentBase - the current base persona text, or null when the roster cannot answer.
 * @returns the computed record, plus whether it needed backfilling.
 */
function personaRecordOf(dir: string, meta: Meta, currentBase: string | null): PersonaRecord {
  /** The persona as it stands on disk. */
  const persona = readPersonaIn(dir)
  /** Whether the persona file exists at all; an absent file cannot be hashed. */
  const hasFile = existsSync(join(dir, "persona.md"))
  /** The recorded revision, else the highest version file, else the legacy "revision 1". */
  const revision = meta.personaRevision > 0 ? meta.personaRevision : Math.max(1, highestVersionOf(dir))
  /** The baseline: the stored one, else the current base's hash, else the honest unknown. */
  const baseRevision = meta.baseRevision !== "" ? meta.baseRevision : currentBase !== null ? sha256Of(String(currentBase).trim()) : UNKNOWN_HASH
  return { revision, hash: hasFile ? sha256Of(persona) : UNKNOWN_HASH, baseRevision, backfilled: meta.personaRevision <= 0 || meta.personaHash === "" || meta.baseRevision === "" }
}

/**
 * The highest revision number present in `persona.versions/`, or 0 when the directory is absent.
 *
 * @param dir - the instance directory.
 * @returns the highest file number, or 0.
 */
function highestVersionOf(dir: string): number {
  /** The version directory, read per call so a hand-edited history is seen. */
  const versions = versionsDir(dir)
  try {
    if (!existsSync(versions)) return 0
    /** The highest numeric file stem found. */
    let highest = 0
    for (const file of readdirSync(versions)) {
      /** The numeric stem of this file, when it is a version file. */
      const n = /^([1-9]\d*)\.md$/.exec(file)?.[1]
      if (n === undefined) continue
      if (Number(n) > highest) highest = Number(n)
    }
    return highest
  } catch { return 0 }
}

/**
 * Persist one persona write: the version file, the base snapshot and the metadata triple.
 *
 * This is the ONLY path that moves `personaRevision`, so the counter cannot drift from the files: a
 * `bump` write commits `text` as the next free revision, and a non-bumping write (a reflect with no
 * persona delta) merely backfills whatever the legacy record was missing.
 *
 * @param input.dir - the instance directory.
 * @param input.meta - the instance's metadata, mutated in place and written by the caller.
 * @param input.text - the persona text to commit, ignored when `bump` is false.
 * @param input.currentBase - the current base persona text, or null when the roster cannot answer.
 * @param input.bump - whether this write creates a NEW revision.
 * @returns the resulting persona text, revision and hash.
 */
function applyPersonaWrite(input: { dir: string; meta: Meta; text: string; currentBase: string | null; bump: boolean }): { persona: string; revision: number; hash: string } {
  /** What the record says before this write, which is also what gets backfilled. */
  const record = personaRecordOf(input.dir, input.meta, input.currentBase)
  // BACKFILL FIRST (read-compat): the current text becomes its own version file and the base snapshot is
  // taken now, so the history is complete from this point on rather than starting mid-story.
  if (!existsSync(join(versionsDir(input.dir), record.revision + ".md"))) writePersonaVersion(input.dir, record.revision, readPersonaIn(input.dir))
  if (input.currentBase !== null) writeBaseSnapshot(input.dir, input.currentBase)
  /** The persona text this write leaves on disk. */
  const persona = input.bump ? capText(String(input.text ?? ""), PERSONA_CAP).trim() : readPersonaIn(input.dir)
  /** The revision this write records. */
  const revision = input.bump ? nextFreeRevision(input.dir, record.revision + 1) : record.revision
  if (input.bump) {
    writeFileSync(join(input.dir, "persona.md"), persona + "\n")
    writePersonaVersion(input.dir, revision, persona)
  }
  /** The hash of the text that is now current. */
  const hash = sha256Of(persona)
  input.meta.personaRevision = revision
  input.meta.personaHash = hash
  input.meta.baseRevision = record.baseRevision
  return { persona, revision, hash }
}

/** One instance's divergence from the base template it was copied from. */
export interface PersonaDrift {
  /** Whether the base persona has moved away from the recorded baseline. */
  defaultUpdated: boolean
  /** How many lines the stored base snapshot and the current base text disagree by. */
  baseDriftLines: number
  /** Whether the comparison could NOT be made (no baseline recorded, or the roster cannot resolve it). */
  baseDriftUnknown: boolean
}

/**
 * Compare an instance's recorded base baseline with the CURRENT base persona.
 *
 * @param meta - the instance's metadata.
 * @param dir - the instance directory, whose `persona.base.md` is the diff's left-hand side.
 * @param currentBase - the current base persona text, or null when the roster cannot answer.
 * @returns the drift verdict; `baseDriftUnknown` is the honest answer when no comparison is possible.
 */
export function personaDrift(meta: Meta, dir: string, currentBase: string | null): PersonaDrift {
  if (currentBase === null || meta.baseRevision === "" || meta.baseRevision === UNKNOWN_HASH) return { defaultUpdated: false, baseDriftLines: 0, baseDriftUnknown: true }
  /** The current base text under the ONE normalization the baseline was recorded with. */
  const current = String(currentBase).trim()
  if (sha256Of(current) === meta.baseRevision) return { defaultUpdated: false, baseDriftLines: 0, baseDriftUnknown: false }
  // An instance with no stored snapshot predates the baseline: every line of the current base is new to it.
  return { defaultUpdated: true, baseDriftLines: lineDiffCount(readBaseSnapshot(dir) ?? "", current), baseDriftUnknown: false }
}

/**
 * The note card as a reader should see it: the stored text plus, when the base moved, ONE marker line
 * carrying both fields the contract names.
 *
 * @param note - the note card text.
 * @param drift - the instance's drift verdict.
 * @returns the marked note, capped to {@link NOTE_CAP}.
 */
export function noteWithDrift(note: string, drift: PersonaDrift): string {
  // IDEMPOTENT: a reflect PERSISTS the marked note, so a later read must replace the marker rather than
  // stack a second one (and must REMOVE it when the base caught up, which is why the strip runs first).
  /** The note with any previously written marker line removed. */
  const bare = note.replace(/\n?\[defaultUpdated=[^\]]*\]/g, "").trim()
  if (!drift.defaultUpdated) return bare
  return capText(bare + "\n[defaultUpdated=true baseDriftLines=" + drift.baseDriftLines + " — the base persona moved ahead of this workmate]", NOTE_CAP)
}

/** Merge a persona revision into the current text, capped; the caller commits the result. */
function mergedPersonaText(existing: string, revision: string): string {
  /** The persona with the revision appended and the whole text capped. */
  const merged = capText(existing + (revision ? `\n\n## Persona revision (${now()})\n${revision.trim()}` : ""), PERSONA_CAP)
  return merged.trim()
}

/** Resolve a READ target by key; a name with no instance throws rather than returning a half-object. */
function ensureInstance(name: string): { meta: Meta; dir: string; key: string } {
  /** The sanitized key, which is the directory name and therefore the identity. */
  const key = sanitizeName(name)
  /** The instance directory. */
  const dir = wmDir(key)
  /** The instance metadata; absent means the name is not addressable. */
  const meta = readMeta(dir)
  if (!meta) throw new Error(`mpd_workmate: no workmate named "${key}" — run mpd_workmate_init first`)
  return { meta, dir, key }
}

/** `lstat` without throwing: null means nothing is there (a dangling symlink still answers). */
function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(path) } catch { return null }
}

/** Resolve a MUTATION target. The directory must exist as a real (non-symlink) directory carrying
 * `meta.json`: a dangling/orphan directory is not addressable and is never touched (§M3, §H). */
function resolveTarget(key: string): { meta: Meta; dir: string } {
  /** The directory a mutation would touch. */
  const dir = wmDir(key)
  /** The lstat result, which distinguishes a real directory from a symlink or a plain file. */
  const st = lstatOrNull(dir)
  if (st == null) throw new WorkmateError("unknown", `mpd_workmate: no workmate named "${key}"`, 404)
  if (st.isSymbolicLink()) throw new WorkmateError("unknown", `mpd_workmate: "${key}" is a symlink — the library refuses to mutate through a link (replace it by hand)`, 404)
  if (!st.isDirectory()) throw new WorkmateError("unknown", `mpd_workmate: "${key}" is not a directory`, 404)
  /** The metadata that makes this directory a real instance rather than an orphan. */
  const meta = readMeta(dir)
  if (!meta) throw new WorkmateError("unknown", `mpd_workmate: "${key}" has no meta.json (orphan directory — remove it by hand)`, 404)
  return { meta, dir }
}

/** Every listable instance, newest-updated first; a symlinked or orphan directory is never listed. */
function listInstances(): { name: string; meta: Meta; note: string }[] {
  /** The library root, or absent — which lists as empty rather than throwing. */
  const root = workmateRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    // The DIRECTORY name is the instance key and therefore the identity (A3); `meta.name` is only a
    // display mirror, so a list entry can never advertise a name that does not resolve. A symlinked
    // instance dir is not a directory entry here and is therefore never listed (§H).
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "meta.json")))
    .map((e) => {
      /** The directory name, which IS the instance key and the identity a caller cites. */
      const key = e.name
      /** The instance's metadata, read only for a directory that already proved it has one. */
      const meta = readMeta(join(root, key))!
      return { name: key, meta, note: readNote(key) }
    })
    .sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
}

/** Split text into lowercase tokens of three or more characters — the matching corpus's unit. */
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
}

/** Deduplicate while keeping first-seen order, so scoring is deterministic. */
function unique(xs: string[]): string[] { return [...new Set(xs)] }

/** Deterministic note-matching score (0..1). Not an embedding: keyword overlap + base-name boost. */
export function scoreMatch(task: string, wm: { note: string; baseName: string; description: string; memoryTail: string }): number {
  /** The task's distinct tokens; an empty list scores zero by definition. */
  const taskTokens = unique(tokenize(task))
  if (taskTokens.length === 0) return 0
  /** The workmate's searchable text, deduplicated so a repeated word cannot inflate the score. */
  const corpus = unique(tokenize(`${wm.note} ${wm.baseName} ${wm.description} ${wm.memoryTail}`))
  /** How many distinct task tokens the corpus contains. */
  const hit = taskTokens.filter((t) => corpus.includes(t)).length
  /** Keyword overlap as a 0..1 fraction, before the base-name boost. */
  let score = hit / taskTokens.length
  /** The base specialist's own name words, which earn a fixed boost when the task names them. */
  const baseWords = unique(tokenize(wm.baseName))
  if (baseWords.some((w) => taskTokens.includes(w))) score += 0.15
  return Math.min(1, score)
}

/** §E(a) in-use gate, part 1: workmates this PROCESS is currently spawning. The counter is
 * incremented before `spawnAgent` and released in a `finally`, so a failed spawn cannot leak a
 * permanent block on that workmate. */
const inUse = new Map<string, number>()

/** How many in-flight spawns this process currently holds for one key. */
function inUseCount(key: string): number { return inUse.get(key) ?? 0 }

/** Take one in-flight hold, before `spawnAgent` is called. */
function noteSpawnStart(key: string): void { inUse.set(key, inUseCount(key) + 1) }

/** Release one in-flight hold; the last release drops the entry so the map cannot grow forever. */
function noteSpawnEnd(key: string): void {
  /** Holds remaining after this release. */
  const left = inUseCount(key) - 1
  if (left <= 0) inUse.delete(key)
  else inUse.set(key, left)
}

/** §E(b) in-use gate, part 2: READ-ONLY scan of the current workspace's team records.
 *
 * TWO layouts are read, because the bundle has had two and a workspace may hold either:
 *  • `.mpd/team/<dir>/team.json` — the RETIRED vendored plugin's record, scanned unchanged so a
 *    workspace that still carries one keeps working;
 *  • `.mpd/team/teams/<teamId>.json` — the mpd-OWNED record (`mpd-team-core-plugin/src/team-store.ts`),
 *    which is what a team approved today actually writes.
 *
 * The second layout is why this function was fixed: it used to read ONLY the retired one, so every
 * teammate spawned after the 0.1.7 rebase was invisible here and a workmate could be renamed or
 * deleted out from under a live team. Reading this state is permitted; WRITING it is not.
 *
 * A record counts as IN USE while the team has not ended AND the named member has not settled
 * (`inactive`/`failed`) — a finished team must not keep a workmate frozen forever. Fail-open on any
 * read error: an unreadable record is not a block. */
export function busyTeams(key: string, roots?: string[]): { teamId: string; member: string }[] {
  /** Every (team, member) pair currently using this workmate's name. */
  const hits: { teamId: string; member: string }[] = []
  /** Record one member name against a team, deduplicated, when it normalises to the workmate key. */
  const note = (teamId: string, memberName: string): void => {
    if (memberName === "" || sanitizeName(memberName) !== key) return
    if (hits.some((hit) => hit.teamId === teamId && hit.member === memberName)) return
    hits.push({ teamId, member: memberName })
  }
  // `roots` are the WORKSPACE roots whose .mpd/team records are scanned; the team state dir itself
  // stays hardcoded (§M6). Callers pass the calling session's workspace (tool path), an explicit
  // root (service path), or the union of live session workspaces (GUI path). The default keeps
  // direct/module-level callers on the adapter's ONE resolution (env -> process.cwd()).
  const scanRoots = roots && roots.length > 0 ? roots : [workspaceRootOf()]
  for (const root of scanRoots) {
    // ── layout 1: the retired one-directory-per-team record ──────────────────
    try {
      /** This root's team state directory; absent means the workspace has no teams to scan. */
      const teamRoot = join(root, ".mpd", "team")
      if (!existsSync(teamRoot)) continue
      for (const entry of readdirSync(teamRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        /** The record file of one team; an archived team has no `team.json` and is skipped here. */
        const file = join(teamRoot, entry.name, "team.json")
        if (!existsSync(file)) continue
        try {
          /** The parsed team record; an unreadable one is skipped rather than failing the whole scan. */
          const team = JSON.parse(readFileSync(file, "utf8"))
          /** The team's members, or an empty list when the record carries none. */
          const members = Array.isArray(team?.members) ? team.members : []
          for (const m of members) note(String(team?.id ?? entry.name), typeof m?.name === "string" ? m.name : "")
        } catch { /* fail-open */ }
      }
    } catch { /* fail-open */ }
    // ── layout 2: the mpd-owned one-file-per-team record ─────────────────────
    try {
      /** `<root>/.mpd/team/teams`, absent in a workspace that never approved an mpd team. */
      const records = join(root, ".mpd", "team", "teams")
      if (!existsSync(records)) continue
      for (const name of readdirSync(records)) {
        if (!name.endsWith(".json")) continue
        try {
          /** One mpd team record, read for its lifecycle stamps and its roster. */
          const team = JSON.parse(readFileSync(join(records, name), "utf8"))
          // An ended team holds nobody: the record outlives the team by design.
          if (team?.endedAt !== undefined) continue
          /** The team's members, or an empty list when the record carries none. */
          const members = Array.isArray(team?.members) ? team.members : []
          for (const m of members) {
            // A settled member is not using the workmate, so a finished team cannot freeze a rename.
            if (m?.status === "inactive" || m?.status === "failed") continue
            note(String(team?.teamId ?? name.replace(/\.json$/, "")), typeof m?.name === "string" ? m.name : "")
          }
        } catch { /* fail-open */ }
      }
    } catch { /* fail-open */ }
  }
  return hits
}

/** §E: the gate and the filesystem mutation must run in ONE synchronous block (no `await` between
 * them), which is what makes a mutate-vs-spawn race impossible in-process — no lock file needed.
 * EVERY key the mutation touches is checked: for a rename that is the instance AND the name it would
 * take over (§E's documented consequence is exactly "renaming oracle-1 to architect is refused while
 * such a team record exists", and A6 uses that case as the deterministic 409). The refusal names the
 * blocking team id AND member so it is actionable. */
function assertNotBusy(keys: string[], roots?: string[]): void {
  /** The distinct (team, member) pairs blocking this mutation. */
  const hits: { teamId: string; member: string }[] = []
  /** Descriptions of the in-flight spawns blocking it, each named with its hold count. */
  const running: string[] = []
  for (const key of keys) {
    for (const h of busyTeams(key, roots)) {
      if (!hits.some((x) => x.teamId === h.teamId && x.member === h.member)) hits.push(h)
    }
    /** How many in-flight holds this process has on the key. */
    const n = inUseCount(key)
    if (n > 0) running.push(`${key} (${n} in-flight mpd_workmate_spawn)`)
  }
  if (hits.length === 0 && running.length === 0) return
  /** The refusal's clauses, one per kind of blocker, each naming what must finish first. */
  const parts: string[] = []
  if (hits.length > 0) parts.push(`team member(s) ${hits.map((h) => `${h.teamId}/${h.member}`).join(", ")}`)
  if (running.length > 0) parts.push(running.join(", "))
  throw new WorkmateError("in-use", `mpd_workmate: ${keys.map((k) => `"${k}"`).join(" / ")} is in use by ${parts.join(" and ")} — archive or retire those teams and let running spawns finish first`, 409, hits)
}

/** Team-state roots for an AGENTLESS surface (web route, service without an explicit root): the
 * union of every live session workspace, or the adapter's env -> process.cwd() form when none is
 * registered. Never cached: one host serves many sessions. */
function agentlessRoots(dsh: DshAdapter): string[] {
  /** Every live session workspace, or an empty list when the agent registry is absent. */
  const all = dsh.workspaceRootsAll()
  return all.length > 0 ? all : [dsh.workspaceRoot()]
}

/** UTC stamp for archive directory names: colons stripped and milliseconds dropped, so the name is
 * portable to Windows and stays readable (`.archive/oracle-1-2026-09-10T124503Z`). */
function compactUtcStamp(): string { return new Date().toISOString().replace(/:/g, "").replace(/\.\d+Z$/, "Z") }

/** Archive destination `.archive/<key>-<compactUtcStamp>/`. A numeric suffix keeps two deletes of the
 * same key inside the same second apart. */
function archivePathFor(key: string): string {
  /** The archive root, created here so the destination path below can be probed. */
  const archiveRoot = join(workmateRoot(), ".archive")
  mkdirSync(archiveRoot, { recursive: true })
  /** This delete's UTC stamp, the readable half of the archive name. */
  const stamp = compactUtcStamp()
  /** The first candidate destination; a numeric suffix disambiguates a same-second repeat. */
  let candidate = join(archiveRoot, `${key}-${stamp}`)
  for (let i = 2; lstatOrNull(candidate) != null && i < 1000; i++) candidate = join(archiveRoot, `${key}-${stamp}-${i}`)
  return candidate
}

/** A5: rewrite ONLY a LEADING `<baseName>-based workmate "<oldKey>".` prefix — the exact prefix
 * `autoNote` writes. A custom note (one that does not start with it) keeps its bytes untouched,
 * which also keeps autoNote's `prev.startsWith(prefix)` dedupe correct after a rename. */
function rewriteNoteIdentity(dir: string, baseName: string, oldKey: string, newKey: string): void {
  /** The note file this rewrite targets. */
  const path = join(dir, "note.md")
  /** The note's bytes, untouched unless they start with the exact identity prefix. */
  let raw: string
  try { raw = readFileSync(path, "utf8") } catch { return }
  /** The identity prefix carrying the OLD key, the only thing a rename rewrites. */
  const prefix = `${baseName}-based workmate "${oldKey}".`
  if (!raw.startsWith(prefix)) return
  writeFileSync(path, `${baseName}-based workmate "${newKey}".` + raw.slice(prefix.length))
}

/** Rename = MOVE the evolved identity, never re-instantiate it (§F). Directory key, `meta.name`, the
 * index key, the note self-reference and `renamedFrom` move together; persona/memory/note bytes, the
 * caps, `uses`, `lastTask` and `createdAt` are preserved byte-for-byte. Archived team records are
 * historical and are deliberately NOT rewritten.
 *
 * The gate, the collision guard and the mutation run in ONE synchronous block (§E, §J): no `await`
 * appears between them, so no spawn or reflect can interleave. */
export function renameWorkmate(nameArg: unknown, newNameArg: unknown, teamRoots?: string[]): { ok: boolean; name: string; from: string; renamedFrom: string[] } {
  assertMutationSandboxed("rename a workmate")
  /** The current key, validated as already-sanitized before any filesystem call. */
  const oldKey = nameKey(nameArg, "name")
  /** The requested key, validated the same way. */
  const newKey = nameKey(newNameArg, "new_name")
  if (newKey === oldKey) throw new WorkmateError("invalid-name", `mpd_workmate: new_name "${newKey}" equals the current key — nothing to rename`, 400)
  // ── one synchronous block ─────────────────────────────────────────────────────────────────────
  const { meta, dir } = resolveTarget(oldKey)
  /** The destination path; ANY lstat hit on it is a collision, even a dangling symlink. */
  const dst = wmDir(newKey)
  // §M5: ANY lstat hit on the target is a collision. `existsSync` alone is not a sufficient guard —
  // renameSync silently overwrites an existing EMPTY directory, and a dangling symlink is invisible
  // to existsSync. Mapping every hit to `collision` also keeps raw fs errors out of the response.
  if (lstatOrNull(dst) != null) throw new WorkmateError("collision", `mpd_workmate: rename target "${newKey}" already exists`, 409)
  assertNotBusy([oldKey, newKey], teamRoots)
  /** The previous keys, newest last and bounded, so the history stays informational only. */
  const renamedFrom = unique([...meta.renamedFrom, oldKey]).slice(-10)
  /** The metadata written at the new key: the display mirror follows the directory key. */
  const nextMeta: Meta = { ...meta, name: newKey, renamedFrom, updatedAt: now() }
  renameSync(dir, dst)
  try {
    writeFileSync(join(dst, "meta.json"), JSON.stringify(nextMeta, null, 2) + "\n")
    renameIndexKey(oldKey, newKey, nextMeta)
  } catch (e) {
    // Best-effort rollback: the directory key IS the identity, so moving the directory back restores
    // a fully addressable instance at its original key (only `meta.name`, a display mirror the next
    // write repairs, could still differ). Error bodies never leak filesystem paths (§D).
    try { renameSync(dst, dir) } catch { /* the directory key stays authoritative */ }
    throw new WorkmateError("internal", `mpd_workmate: rename of "${oldKey}" failed (${String((e as any)?.code ?? "error")}) and was rolled back`, 500)
  }
  // Cosmetic and therefore best-effort: a note that cannot be rewritten is regenerated on reflect.
  try { rewriteNoteIdentity(dst, meta.baseName, oldKey, newKey) } catch { /* note is cosmetic */ }
  return { ok: true, name: newKey, from: oldKey, renamedFrom }
}

/** Delete = ARCHIVE-FIRST (D1): the instance leaves the library (hidden from list/match, restorable)
 * into `.archive/`. Real removal requires `purge: true` AND `confirm === name`. The index key is
 * dropped on BOTH paths, and a failed delete leaves the instance fully intact. */
export function deleteWorkmate(nameArg: unknown, purgeArg: unknown, confirmArg: unknown, teamRoots?: string[]): { ok: boolean; name: string; archived: string | null; purged: boolean } {
  assertMutationSandboxed("delete a workmate")
  /** The key to remove, validated before the in-use gate runs. */
  const key = nameKey(nameArg, "name")
  // Strictly boolean: a non-true `purge` archives instead of destroying, which is the safe direction.
  const purge = purgeArg === true
  if (purge && String(confirmArg ?? "") !== key) {
    throw new WorkmateError("confirm-required", `mpd_workmate: purging "${key}" requires confirm to equal the name exactly`, 400)
  }
  // ── one synchronous block (§E): gate + mutation, no await between ──────────────────────────────
  const { dir } = resolveTarget(key)
  assertNotBusy([key], teamRoots)
  /** The index row removed first, so a failed destructive step can put the library back. */
  let previous: IndexEntry | undefined
  /** Whether the instance has already left the library, which decides the failure's wording. */
  let removed = false
  try {
    // The index key goes first because a single map write is the only step that can be UNDONE: if the
    // destructive step fails, the key is restored and the library is exactly as it was (§F).
    previous = dropIndexKey(key)
    if (purge) {
      // Purge moves the directory out of the library before removing the bytes, so the instance is
      // never left half-removed from the library (rm of a deep tree is not atomic).
      const stash = join(workmateRoot(), ".archive", `.purging-${key}-${compactUtcStamp()}`)
      mkdirSync(join(workmateRoot(), ".archive"), { recursive: true })
      renameSync(dir, stash)
      removed = true
      rmSync(stash, { recursive: true, force: true })
      return { ok: true, name: key, archived: null, purged: true }
    }
    /** Where the instance landed, reported so a caller can restore it by hand. */
    const archived = archivePathFor(key)
    renameSync(dir, archived)
    removed = true
    return { ok: true, name: key, archived, purged: false }
  } catch (e) {
    if (!removed && previous !== undefined) { try { restoreIndexEntry(key, previous) } catch { /* derived listing */ } }
    /** What a caller can expect to find after the failure, in the two materially different cases. */
    const fate = removed ? "the workmate left the library but leftover bytes may remain under the archive directory" : "the workmate is unchanged"
    throw new WorkmateError("internal", `mpd_workmate: delete of "${key}" failed (${String((e as any)?.code ?? "error")}) — ${fate}`, 500)
  }
}

// ── LIBRARY OPTIMIZATION (W3-C, requirement 4) ────────────────────────────────────────────────────
// `mpd_workmate_optimize` merges workmates that are THE SAME SPECIALTY grown apart by two sessions:
// the same roster base, the same readonly posture, neither archived, neither busy in a live team, and
// either a strong note match or substantial tag overlap. A merge PRESERVES the evolved record (memory,
// persona, use count, name history) and ARCHIVES the source — it never deletes: the archive path has
// no purge branch at all, which is why a merge can never destroy work.

/** The note score at or above which two instances are merge candidates (contract §4.6). */
export const MERGE_THRESHOLD = 0.6

/** The tag-overlap (Jaccard) at or above which two instances are merge candidates. */
export const MERGE_TAG_THRESHOLD = 0.5

/** The `merge.json` version a merge archive records. */
export const MERGE_RECORD_VERSION = 1

/** SHA-256 of a text, hex-encoded: the identity a dedup and the archive record both use. */
function sha256Of(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex") }

/**
 * Split a memory body into whole `## ` blocks.
 *
 * The unit is a BLOCK, never a line: an entry is what a reflect wrote, and a merge that cut one in half
 * would corrupt the record it is supposed to preserve.
 * @param text - the memory body, as stored.
 * @returns the blocks, oldest first, with empty ones dropped.
 */
function memoryBlocksOf(text: string): string[] {
  /** The body split on the `## ` heading that opens every entry. */
  return String(text ?? "").split(/\n## /).map((block, index) => (index === 0 ? block : "## " + block)).map((block) => block.trim()).filter((block) => block !== "")
}

/**
 * The tag set a note card contributes to the Jaccard test.
 *
 * The library has no free-form tag field, so the "tags" are the distinct three-or-more-character words
 * of the note plus the base specialist's name — the SAME tokenizer the matcher scores with, so two
 * surfaces cannot disagree about what a workmate is about.
 * @param note - the note card.
 * @param baseName - the roster base the instance was copied from.
 * @returns the distinct tags.
 */
function tagsOf(note: string, baseName: string): Set<string> { return new Set(unique(tokenize(note + " " + baseName))) }

/**
 * The Jaccard overlap of two tag sets (|A ∩ B| / |A ∪ B|).
 * @param a - the first tag set.
 * @param b - the second tag set.
 * @returns the overlap as a 0..1 fraction; two empty sets answer 0.
 */
function jaccardOf(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  /** How many tags both sets carry. */
  let shared = 0
  for (const tag of a) if (b.has(tag)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** The archive directories already under `.archive/` that came from one library key. */
function archivedCopiesOf(key: string): string[] {
  try {
    /** The archive root; absent means this library has never archived anything. */
    const root = join(workmateRoot(), ".archive")
    if (!existsSync(root)) return []
    // ONLY a directory this library itself created for that key: a plain delete's `<key>-<stamp>` or a
    // merge's `<key>-merged-<into>-<stamp>`. A bare prefix test would read `oracle-1`'s archive as
    // `oracle`'s, which would freeze a key nobody archived.
    /** The two archive-name shapes this library writes for one key. */
    const shapes = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:-\\d{8}T\\d{6}Z(?:-\\d+)?|-merged-.+)$")
    return readdirSync(root).filter((entry) => entry === key || shapes.test(entry))
  } catch { return [] }
}

/** One proposed merge, with the reason it can or cannot run. */
export interface MergePlanRow {
  /** The instance that would leave the library. */
  from: string
  /** The instance that keeps the evolved record. */
  into: string
  /** The note score between the two (0..1). */
  score: number
  /** The tag overlap between the two (0..1). */
  jaccard: number
  /** Whether every gate passed. */
  mergeable: boolean
  /** Why the pair cannot merge, when it cannot. */
  reason?: string
}

/** What one optimize call did. */
export interface OptimizeResult {
  /** The decision table, in proposal order. */
  plan: MergePlanRow[]
  /** The merges this call actually applied, with the archive each source landed in. */
  applied: Array<{ from: string; into: string; archive: string }>
  /** The proposals a gate refused, with the gate's reason. */
  skipped: Array<{ from: string; into: string; reason: string }>
}

/**
 * Decide which workmates may merge, deterministically and without touching the disk.
 *
 * THE AUTO RULE: inside one `baseName` group, ordered by (uses desc, name asc), the first instance is
 * the group's survivor and every other member is proposed INTO it — so an optimize call collapses a
 * fork back into its most-used instance. An explicit `pairs` list replaces that proposal entirely.
 * @param options - the threshold override, an explicit pair list, and the team roots the busy scan reads.
 * @returns one row per proposal, in proposal order.
 */
export function planWorkmateMerges(options: { mergeThreshold?: number; pairs?: Array<{ from: string; into: string }>; teamRoots?: string[] } = {}): MergePlanRow[] {
  /** Every instance in the library, with its note, read once. */
  const instances = listInstances()
  /** A fast key → instance view for the explicit-pair path. */
  const byName = new Map(instances.map((instance) => [instance.name, instance]))
  /** The threshold this call uses; a non-numeric or out-of-range override keeps the contract's value. */
  const threshold = typeof options.mergeThreshold === "number" && options.mergeThreshold >= 0 && options.mergeThreshold <= 1 ? options.mergeThreshold : MERGE_THRESHOLD
  /** The proposals, before any gate runs. */
  const proposals: Array<{ from: string; into: string }> = []
  if (options.pairs !== undefined && options.pairs.length > 0) {
    for (const pair of options.pairs) proposals.push({ from: sanitizeName(pair?.from ?? ""), into: sanitizeName(pair?.into ?? "") })
  } else {
    /** The instances grouped by their roster base. */
    const groups = new Map<string, typeof instances>()
    for (const instance of instances) {
      /** The group this instance belongs to; an unnamed base groups with the empty string. */
      const group = groups.get(instance.meta.baseName) ?? []
      group.push(instance)
      groups.set(instance.meta.baseName, group)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      /** The group in survivor order: the most-used instance first, ties broken by name. */
      const ordered = [...group].sort((a, b) => (b.meta.uses - a.meta.uses) || a.name.localeCompare(b.name))
      for (const source of ordered.slice(1)) proposals.push({ from: source.name, into: ordered[0].name })
    }
  }
  /** One evaluated row per proposal. */
  const rows: MergePlanRow[] = []
  // A SOURCE MAY BE CONSUMED ONCE (R-W3C Medium 2): two rows naming the same `from` can both pass every
  // other gate, but the first merge ARCHIVES that instance and the second can only fail. Rejecting the
  // repeat at PLAN time is what keeps the dry-run table honest about what an apply would do.
  /** The sources an earlier row already claimed. */
  const claimedSources = new Set<string>()
  for (const proposal of proposals) {
    /** Whether an earlier row in this same plan already named this source. */
    const repeatedSource = claimedSources.has(proposal.from)
    claimedSources.add(proposal.from)
    /** The source instance, when the library still carries it. */
    const source = byName.get(proposal.from)
    /** The target instance, when the library still carries it. */
    const target = byName.get(proposal.into)
    /** The note score: the source's own note read against the target's corpus. */
    const score = source === undefined || target === undefined ? 0 : scoreMatch(source.note, { note: target.note, baseName: target.meta.baseName, description: target.meta.description, memoryTail: readMemory(target.name, 600) })
    /** The tag overlap between the two notes. */
    const jaccard = source === undefined || target === undefined ? 0 : jaccardOf(tagsOf(source.note, source.meta.baseName), tagsOf(target.note, target.meta.baseName))
    /** The rounded score, so the table and the record agree. */
    const roundedScore = Math.round(score * 100) / 100
    /** The rounded overlap. */
    const roundedJaccard = Math.round(jaccard * 100) / 100
    /** The gate that refused this pair, if any. */
    const reason = repeatedSource ? "duplicate-source"
      : source === undefined || target === undefined ? "missing"
      : proposal.from === proposal.into ? "same"
      : source.meta.baseName !== target.meta.baseName ? "base-mismatch"
      : source.meta.readonly !== target.meta.readonly ? "readonly-mismatch"
      : archivedCopiesOf(proposal.from).length > 0 || archivedCopiesOf(proposal.into).length > 0 ? "archived"
      : busyTeams(proposal.from, options.teamRoots).length > 0 || busyTeams(proposal.into, options.teamRoots).length > 0 || inUseCount(proposal.from) > 0 || inUseCount(proposal.into) > 0 ? "in-use"
      : !(roundedScore >= threshold || roundedJaccard >= MERGE_TAG_THRESHOLD) ? "not-similar"
      : undefined
    rows.push({ from: proposal.from, into: proposal.into, score: roundedScore, jaccard: roundedJaccard, mergeable: reason === undefined, ...(reason === undefined ? {} : { reason }) })
  }
  return rows
}

/** The archive destination for one merged source: `.archive/<from>-merged-<into>-<stamp>`. */
function mergeArchivePathFor(fromKey: string, intoKey: string): string {
  /** The archive root, created so the destination can be probed. */
  const root = join(workmateRoot(), ".archive")
  mkdirSync(root, { recursive: true })
  /** This merge's UTC stamp, the readable half of the name. */
  const stamp = compactUtcStamp()
  /** The first candidate; a numeric suffix keeps two merges inside one second apart. */
  let candidate = join(root, `${fromKey}-merged-${intoKey}-${stamp}`)
  for (let i = 2; lstatOrNull(candidate) != null && i < 1000; i++) candidate = join(root, `${fromKey}-merged-${intoKey}-${stamp}-${i}`)
  return candidate
}

/**
 * Merge ONE source instance into a target, preserving the evolved record and archiving the source.
 *
 * ORDER MATTERS: the target's files are written FIRST (a failure there leaves the library exactly as it
 * was, because nothing has moved), then the source directory is moved into `.archive/`, then its index
 * key is dropped and `merge.json` is written beside the archived bytes. A failure after the move is
 * reported as `internal` with the archive path named, so the bytes are never lost silently.
 * @param fromKey - the instance that leaves the library.
 * @param intoKey - the instance that keeps the record.
 * @returns the archive directory the source landed in.
 */
function mergeOneWorkmate(fromKey: string, intoKey: string): string {
  /** The source instance on disk. */
  const source = resolveTarget(fromKey)
  /** The target instance on disk. */
  const target = resolveTarget(intoKey)
  /** The source's persona. */
  const sourcePersona = readPersona(fromKey)
  /** The target's persona. */
  const targetPersona = readPersona(intoKey)
  /** The LONGER persona wins, so a merge never loses accumulated detail. */
  const longerPersona = sourcePersona.length > targetPersona.length ? sourcePersona : targetPersona
  /** The merged persona: the longer body plus ONE provenance line, capped. */
  const persona = capText(longerPersona === "" ? "" : longerPersona + "\n\nmerged-from: " + fromKey, PERSONA_CAP)
  /** The merged memory blocks, deduplicated by sha256, target blocks first. */
  const seen = new Set<string>()
  /** The blocks that survive the dedup, oldest first. */
  const blocks: string[] = []
  for (const block of [...memoryBlocksOf(readMemory(intoKey, Number.MAX_SAFE_INTEGER)), ...memoryBlocksOf(readMemory(fromKey, Number.MAX_SAFE_INTEGER))]) {
    /** This block's content identity. */
    const sha = sha256Of(block)
    if (seen.has(sha)) continue
    seen.add(sha)
    blocks.push(block)
  }
  /** The memory kept under the cap, newest last: the OLDEST entries are evicted first. */
  let memory = ""
  for (let index = blocks.length - 1; index >= 0; index--) {
    /** The candidate body if this block were kept. */
    const candidate = blocks[index] + (memory === "" ? "" : "\n\n" + memory)
    if (candidate.length > MEMORY_CAP) break
    memory = candidate
  }
  /** The source's memory block identities, recorded in the archive so the fold is auditable. */
  const sourceMemoryShas = memoryBlocksOf(readMemory(fromKey, Number.MAX_SAFE_INTEGER)).map(sha256Of)
  /** The merged metadata: use counts summed, history accumulated, freshness stamped. */
  const meta: Meta = {
    ...target.meta,
    uses: target.meta.uses + source.meta.uses,
    renamedFrom: unique([...target.meta.renamedFrom, fromKey, ...source.meta.renamedFrom]).slice(-10),
    updatedAt: now()
  }
  /** The regenerated note card, so the survivor's matchable identity describes the merged record. */
  const note = autoNote(meta, persona, memory, readNote(intoKey))
  // ── 1. the TARGET's files, before anything moves ───────────────────────────────────────────────
  // THE MERGED PERSONA IS A PERSONA WRITE (wave W4-A3): it goes through the SAME commit path as a
  // reflect or a `persona_set`, so the survivor's revision, hash and version history stay truthful
  // instead of the file moving while the metadata keeps describing the pre-merge text. The base
  // baseline is left alone (`currentBase: null`): a merge folds two instances of the SAME base.
  applyPersonaWrite({ dir: target.dir, meta, text: persona, currentBase: null, bump: true })
  writeFileSync(join(target.dir, "memory.md"), memory === "" ? "" : memory + "\n")
  writeFileSync(join(target.dir, "note.md"), note + "\n")
  writeFileSync(join(target.dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
  writeIndexEntry(intoKey, meta)
  // ── 2. the SOURCE leaves the library, into the archive (never a purge) ────────────────────────
  /** The archive directory this merge writes the source into. */
  const archive = mergeArchivePathFor(fromKey, intoKey)
  renameSync(source.dir, archive)
  dropIndexKey(fromKey)
  // ── 3. the archive's own record, so the fold is auditable byte by byte ────────────────────────
  writeJson(join(archive, "merge.json"), {
    version: MERGE_RECORD_VERSION,
    from: fromKey,
    into: intoKey,
    at: now(),
    memoryShas: sourceMemoryShas,
    personaSha: sha256Of(persona)
  })
  return archive
}

/**
 * Merge similar workmates, DRY-RUN BY DEFAULT.
 *
 * The confirmation discipline mirrors `mpd_workmate_delete`'s: nothing is mutated unless `confirm` is
 * literally `true`, so a caller that omits it (or an agent that guesses) gets the plan table and no
 * disk change. A pair refused for live-team use skips ONLY that pair; the rest of the plan still runs.
 * @param options - the thresholds, an explicit pair list, the dry-run/confirm flags and the team roots.
 * @returns the plan, what was applied, and what each refused pair's gate was.
 */
export function optimizeWorkmates(options: {
  dryRun?: boolean
  confirm?: boolean
  pairs?: Array<{ from: string; into: string }>
  mergeThreshold?: number
  teamRoots?: string[]
} = {}): OptimizeResult {
  /** The decision table; every gate except the confirmation has already run. */
  const plan = planWorkmateMerges({ ...(options.mergeThreshold === undefined ? {} : { mergeThreshold: options.mergeThreshold }), ...(options.pairs === undefined ? {} : { pairs: options.pairs }), ...(options.teamRoots === undefined ? {} : { teamRoots: options.teamRoots }) })
  /** Every proposal a gate refused. */
  const skipped = plan.filter((row) => !row.mergeable).map((row) => ({ from: row.from, into: row.into, reason: row.reason ?? "refused" }))
  /** Whether this call may write: an explicit `confirm:true` and no explicit dry run. */
  const apply = options.confirm === true && options.dryRun !== true
  if (!apply) return { plan, applied: [], skipped }
  assertMutationSandboxed("merge workmates")
  /** What actually merged, in plan order. */
  const applied: Array<{ from: string; into: string; archive: string }> = []
  for (const row of plan) {
    if (!row.mergeable) continue
    // ONE PAIR'S FAILURE IS ONE PAIR'S SKIP (R-W3C Medium 2): a confirmed call must never throw once it
    // has mutated anything, and a defect in row N must not drop rows N+1.. silently. The catch records
    // the pair with the refusal text, so the caller sees exactly which pair was not applied and why.
    try {
      // THE IN-USE GATE IS RE-READ here, inside the same synchronous block as the mutation: a team that
      // adopted the workmate between the plan and this line must stop the merge, not be overrun by it.
      assertNotBusy([row.from, row.into], options.teamRoots)
      applied.push({ from: row.from, into: row.into, archive: mergeOneWorkmate(row.from, row.into) })
    } catch (error) {
      /** The refusal text this pair produced: a WorkmateError's message, or the thrown value itself. */
      const message = error instanceof Error ? error.message : String(error)
      skipped.push({ from: row.from, into: row.into, reason: "failed: " + message })
    }
  }
  return { plan, applied, skipped }
}

/**
 * Render an optimize result as the table the tool and `/workmate-optimize` print.
 * @param result - what `optimizeWorkmates` answered.
 * @returns the text table, one line per proposal plus the outcome line.
 */
export function renderOptimizeTable(result: OptimizeResult): string {
  /** The heading, which states whether anything was written. */
  const head = result.applied.length > 0 ? "workmate merge — APPLIED " + result.applied.length + " pair(s)" : "workmate merge — DRY RUN (nothing written)"
  /** One line per proposal: the pair, its two scores and the verdict. */
  const rows = result.plan.length === 0
    ? ["  (nothing to merge: no base group carries two instances and no pair was named)"]
    : result.plan.map((row) => "  " + row.from + " -> " + row.into + "  score=" + row.score.toFixed(2) + " jaccard=" + row.jaccard.toFixed(2) + "  " + (row.mergeable ? (result.applied.some((entry) => entry.from === row.from) ? "MERGED" : "MERGE") : "skip:" + String(row.reason)))
  /** The closing hint, so a reader knows the exact next call. */
  const tail = result.applied.length > 0
    ? ["archived: " + result.applied.map((entry) => entry.archive).join(", ")]
    : ["re-run with confirm:true to apply (mpd_workmate_optimize {confirm:true} or /workmate-optimize confirm)"]
  return [head, ...rows, ...tail].join("\n")
}

/**
 * The explicit `maxDepth` one `mpd_workmate_spawn` forwards: the caller's recorded delegation depth plus one.
 *
 * WHY IT MUST BE EXPLICIT (defect D17 — the SAME rule as `mpd_role_spawn`'s helper): with no `maxDepth` the
 * host applies its own depth default, and a NESTED caller — a depth-1 cell planner or a team member is the
 * measured shape — has its consult refused there with a `SubagentDepthError`, even though THIS consult is a
 * leaf that spawns nothing. Forwarding the caller's depth plus one places the child exactly one level below
 * the caller, so a top-level caller keeps the historical `maxDepth: 1` as an EXPLICIT value.
 *
 * THE READING IS DELIBERATELY IDENTICAL to `spawnMaxDepthOf` in `mpd-roles-plugin/src/index.ts`, and the
 * duplication is a TEST pin rather than an accident: this package ships no runtime dependency on that row's
 * module (only on the adapter's), so `test/workmate-spawn-maxdepth.test.ts` imports BOTH helpers from source
 * and compares them on every header shape. A caller with no recorded depth reads as `0`; a session the
 * harness recorded as `origin: "subagent"` WITHOUT a depth reads as depth `1`, exactly as `sessionRank`
 * classifies it — answering `0` there would hand a child's child the top-level cap.
 *
 * @param agent - the calling agent handle, whose session header carries the recorded depth.
 * @returns the cap to forward, a positive integer.
 */
export function spawnMaxDepthOf(agent: unknown): number {
  /** The agent's session header, where the harness records the origin and the delegation depth. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  /** The recorded depth; a non-numeric or negative value is not a depth and reads as `0` below. */
  const raw = Number(header?.delegationDepth)
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw) + 1
  return header?.origin === "subagent" ? 2 : 1
}

/**
 * The refusal `mpd_workmate_spawn` answers when the CALLER is already too deep to raise a consult (CR repair E).
 *
 * THE BOUNDARY. The two bundle spawn tools forward `maxDepth = caller depth + 1` — which makes the child a
 * leaf — AND the child's own tool scope denies both spawn tools, so a consult can never delegate and can
 * never raise its own cap. This refusal is the HARD FLOOR under that scope control: a session at depth 2 or
 * deeper is refused even when the scope restriction never landed (a label no seam resolved, a composition
 * without the `agent/created` bus, a session raised by something other than these two rows).
 *
 * DEPTH 0 AND 1 STAY OPEN ON PURPOSE: the captain raises its consults (0 → 1), and the cell PLANNER — a team
 * member at depth 1, NOT a child of these tools — keeps its own `mpd_role_spawn` route. The consult it raises
 * lands at depth 2 and is itself a leaf.
 *
 * THE TEXT AND THE READING ARE DELIBERATELY IDENTICAL to `consultDepthRefusal` in
 * `mpd-roles-plugin/src/index.ts`: this package ships no runtime dependency on that row's module (only on the
 * adapter's), so `test/leaf-boundary.test.ts` imports BOTH from source and compares them — a test-only pin,
 * exactly like {@link spawnMaxDepthOf}'s twin there.
 *
 * @param agent - the calling agent handle, whose session header carries the recorded depth.
 * @returns the denial sentence, or undefined when the caller may still spawn.
 */
export function consultDepthRefusal(agent: unknown): string | undefined {
  /** The agent's session header, where the harness records the origin and the delegation depth. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  /** The recorded depth; a non-numeric or negative value is not a depth and reads as `0` below. */
  const raw = Number(header?.delegationDepth)
  /** The depth this call is judged at: a subagent-origin session without a depth is a CHILD (depth 1). */
  const depth = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : header?.origin === "subagent" ? 1 : 0
  if (depth < 2) return undefined
  return "mpd spawn rule: refused — this session is at delegation depth " + depth + ", two or more levels below"
    + " the session that started the work, so it may not raise another consult. `mpd_role_spawn` and"
    + " `mpd_workmate_spawn` forward a depth cap that makes their child a LEAF, and a session at depth 2 or"
    + " deeper IS that leaf: the consults it would raise are exactly the runaway nesting the cap exists to"
    + " prevent (CR repair E). Do the work here, or hand the question UP — report what you need to the session"
    + " that raised you and end your turn."
}

/** Row entry point: the seven workmate tools, the mutation routes and the `mpdWorkmate` service. */
export function apply(ctx: Ctx): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // The roster BASE templates come from mpdRoles (mpd-roles-plugin). Resolve the
  // service LAZILY inside tool execution (not at apply time): by the time a tool runs,
  // every bundle plugin has applied, so the sibling-provided mpdRoles service is
  // guaranteed visible (same proven pattern as the QA roles probe).
  function rolesService(): any {
    return ctx.get ? ctx.get("mpdRoles") : undefined
  }

  /**
   * The runtime `mpdConfig` service, read PER SPAWN and never cached at apply — the same
   * lazy-sibling pattern as {@link rolesService}.
   *
   * @returns the service double, or undefined when it is absent or refuses the lookup.
   */
  function configService(): { agentRouteResolutionOf?: (m: string) => unknown } | undefined {
    try {
      return ctx.get ? (ctx.get("mpdConfig") as { agentRouteResolutionOf?: (m: string) => unknown } | undefined) : undefined
    } catch {
      // An agent-scoped cordis ctx is a proxy that THROWS on any key missing from `inject`.
      return undefined
    }
  }

  /**
   * The route ONE spawn runs on, resolved from the base's OWN `agentRoutes` entry ONLY (contract §5).
   *
   * The frozen `meta.provider`/`meta.model` are PROVENANCE now (a snapshot taken at init), never a
   * routing decision; so is the roster base's declared chain for a roster agent. The agent's own
   * entry is the one route source, resolved PER SPAWN so a config saved between two spawns is what
   * the SECOND spawn runs on.
   *
   * Two cases keep their OWN declared route, because `agentRoutes` decides neither:
   *   * an EXTENSION role's base answers `unrouted`, and its route is its extension's own declaration
   *     (the roster service reports it as the base's chain head);
   *   * a `mpdConfig` that answers nothing at all for a BASE agent is a REFUSAL, not a fallback: the
   *     shipped `roles.data.ts` chain is not a default layer (contract §1), so the spawn fails with
   *     the canonical `AGENT_UNCONFIGURED` sentence and NOTHING is started.
   *
   * @param meta - the instance's metadata, whose `baseName` addresses the base.
   * @returns the primary route plus the agent's own fallback chain (empty when the route is not one).
   * @throws the structured `AGENT_UNCONFIGURED` failure when a roster agent's route is unusable.
   */
  function spawnRouteOf(meta: Meta): { route: { provider: string; model: string; reasoningEffort?: string }; fallbacks: readonly unknown[] } {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = configService()
    if (typeof live?.agentRouteResolutionOf === "function") {
      /** The service's TOTAL resolution, never an exception (contract §2). */
      const resolution = live.agentRouteResolutionOf(meta.baseName) as
        | { ok: true; agent: string; route: { provider: string; model: string; reasoningEffort?: string; fallbacks?: readonly unknown[] } }
        | { ok: false; reason: "unconfigured"; agent: string; missing: readonly string[] }
        | { ok: false; reason: "invalid"; agent: string; problem: string }
        | { ok: false; reason: "unrouted" }
        | undefined
      if (resolution !== null && typeof resolution === "object" && typeof resolution.ok === "boolean") {
        if (resolution.ok) return { route: resolution.route, fallbacks: resolution.route.fallbacks ?? [] }
        // NOT routed by `agentRoutes` (an extension base): its own declared chain below is the route.
        if (resolution.reason === "unrouted") return { route: declaredRouteOfBase(meta), fallbacks: [] }
        // Routed but unusable: the ONE structured failure every spawn applier reports.
        /** The detail the canonical sentence names: the missing leaves, or the malformed path. */
        const detail = resolution.reason === "invalid" ? resolution.problem + " must be a string" : "missing " + resolution.missing.join(", ")
        throw agentUnconfiguredRefusal(resolution.agent, detail)
      }
    }
    return { route: declaredRouteOfBase(meta), fallbacks: [] }
  }

  /**
   * The route a workmate base DECLARES for itself, for the case no agent route decides it.
   *
   * Only an extension role reaches this: its route is the provider/model its extension declared, which
   * the roster service reports as the base's chain head. A base with no declared route is an ERROR —
   * the frozen `meta` values are provenance and must never silently become a route (§5).
   * @param meta - the instance's metadata.
   * @returns the base's own declared route.
   * @throws when the mounted roster reports no route for this base.
   */
  function declaredRouteOfBase(meta: Meta): { provider: string; model: string; reasoningEffort?: string } {
    try {
      /** The base as the roster sees it NOW — an extension base carries its declared route here. */
      const base = resolveBase(meta.baseName)
      if (base.provider !== "" && base.model !== "") return { provider: base.provider, model: base.model }
    } catch {
      // No roster row (or an unreadable one): the error below names the missing route.
    }
    throw new Error("mpd_workmate: no route configured for " + meta.baseName + " — its extension declares no provider+model, and a workmate never runs on the frozen meta values (they are provenance). Configure a route for the base, or re-initialize the workmate from a base that declares one.")
  }

  /**
   * The read-only deny list ONE workmate spawn really sends, validated by the harness itself.
   *
   * WHY (measured defect F2, 2026-10-10): `tools.restrict()` rejects the WHOLE list when a single name
   * is not registered in this profile, so the two `mcp__lsp__*` entries killed EVERY read-only spawn —
   * including a read-only workmate — on a host without `cclsp`. The canonical `READONLY_DENY` is NOT
   * changed and never pre-filtered with a `hasTool` probe (AGENTS.md §13): the restriction is applied to
   * THIS agent's own scope and released in the same synchronous turn, so the harness's own verdict is the
   * only pruner, and the pruned names are reported ONCE on this row's log.
   *
   * @param agent - the spawning session's own agent handle, whose scope is the harness's validation site.
   * @returns the list to hand the child as `toolFilter.deny`.
   */
  function validatedReadonlyDeny(agent: unknown): string[] {
    // THIS IS A PROBE, NOT AN APPLICATION. `restrictToolsTolerant` applies each attempt and
    // RELEASES it at once (its contract), so the returned list is what a caller applies for real.
    // Routing a real deny through it left a read-only child fully write-capable — measured live.
    /** The caller's own scope; without it the canonical list is returned unvalidated. */
    const scope = dsh.agentScope(agent)
    if (scope === undefined) {
      reportPrunedNames("read-only workmate spawn: this agent exposes no scoped context, so the canonical deny list is returned unvalidated")
      return [...READONLY_DENY]
    }
    /** The harness's verdict on the canonical list, with the contract's one permitted pruning round. */
    const outcome = restrictToolsTolerant((names) => scope.tools.restrict({ deny: names }), READONLY_DENY)
    if (outcome.pruned.length > 0) {
      reportPrunedNames("read-only workmate spawn: pruned tool name(s) this profile does not register: " + outcome.pruned.join(", "))
    }
    return [...outcome.applied]
  }

  /** The validation lines already reported, so a repeated spawn cannot spam the row's log. */
  const reportedValidationLines = new Set<string>()

  /** Report one validation line on this row's log, ONCE per line: a repeated spawn must not spam it. */
  function reportPrunedNames(line: string): void {
    if (reportedValidationLines.has(line)) return
    reportedValidationLines.add(line)
    try {
      rowLogLine("mpd-workmate", "[mpd-workmate] " + line)
    } catch { /* logging must never take a spawn down */ }
  }

  // ── the child's CURRENT persona and read-only discipline (harness 0.2.1-rc.2) ───────────────
  //
  // 0.2.1-rc.2 REMOVED `persona` and `toolFilter` from the subagent start request, so a workmate
  // raised by `mpd_workmate_spawn` lost its persona — the very thing a workmate EVOLVES through
  // `mpd_workmate_reflect` — and a READ-ONLY workmate lost its write denial. `installChildPersonaSeam`
  // restores both on the CHILD's own scoped context from an `agent/created` listener, which is the
  // window the harness itself guarantees (publication, and with it the dispatch, precedes the
  // child's first prompt).
  //
  // THE PERSONA IS READ FROM DISK HERE, never frozen at apply time: a workmate that reflected
  // between two spawns must spawn with the persona it has NOW. The child is identified by the label
  // its own descriptor carries, which for a workmate is its library key.
  /**
   * Apply the canonical read-only deny to one CHILD's own scope, for real and without pruning.
   *
   * The disposer is deliberately NOT called: the restriction must outlive this call and is released
   * by the host with the child's own scope. A failure is reported with the reason, because a
   * read-only workmate that can write is the defect this seam exists to prevent.
   * @param agent - the freshly created child whose own scope is restricted.
   */
  function applyChildReadonlyDeny(agent: unknown): void {
    try {
      // RETAINED + TOLERANT: a scope that does not know `mcp__lsp__*` (a profile without `cclsp`)
      // rejects the WHOLE list, so an unpruned apply would deny NOTHING and leave this workmate
      // writable. The applier prunes exactly the names the host reports and retries once.
      // THE LEAF NAMES RIDE THIS SAME CALL (CR repair E): ONE restriction per child, never two layers, so a
      // read-only workmate also cannot delegate its work to a write-capable role.
      /** The accepted names and whatever the host pruned as unknown here. */
      const outcome = dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY, ...LEAF_SPAWN_DENY])
      // ONE line per child, carrying BOTH numbers, so a pruning regression is visible on disk.
      reportPrunedNames("read-only workmate child: applied " + outcome.applied.length + " denials (+ the leaf spawn boundary) to its own tool scope"
        + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"))
    } catch (error) {
      reportPrunedNames("read-only workmate child: the deny could NOT be applied (" + String((error as Error)?.message ?? error) + ") — this workmate may be able to write and to delegate")
    }
  }

  /**
   * Apply ONLY the leaf boundary to one WRITE-CAPABLE workmate child's own scope, retained.
   *
   * PARTITIONED FROM {@link applyChildReadonlyDeny} ON PURPOSE: `installChildPersonaSeam` calls the read-only
   * applier for read-only children ONLY, and that applier already carries the leaf names — so this one covers
   * the write-capable child and NO child's scope is restricted twice by this row.
   * @param agent - the freshly created child whose own scope is restricted.
   */
  function applyChildLeafDeny(agent: unknown): void {
    try {
      /** The accepted names and whatever the host pruned as unknown here. */
      const outcome = dsh.restrictAgentToolsRetained(agent, [...LEAF_SPAWN_DENY])
      reportPrunedNames("workmate child leaf boundary: applied " + outcome.applied.length + " spawn denials to its own tool scope"
        + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"))
    } catch (error) {
      // Reported, never thrown: a degradation here must not fail the spawn, and the depth floor in the spawn
      // tool still refuses any caller at depth 2 or deeper.
      reportPrunedNames("workmate child leaf boundary: the deny could NOT be applied (" + String((error as Error)?.message ?? error) + ") — this child may be able to delegate further")
    }
  }

  installChildPersonaSeam(dsh, {
    resolve: (label) => {
      // EXACT-KEY MATCH: a non-canonical label (a roster NAME like "Explorer", uppercase, spaces)
      // is another seam's child. Sanitizing it here would resolve the Explorer ROSTER child to an
      // `explorer` WORKMATE and hand it that record — including its readonly flag.
      /** The canonical workmate key this label is, or null when it is not one. */
      const key = workmateKeyFromLabel(label)
      if (key === null) return null
      /** The library record this key names, or null for a key with no instance. */
      const meta = readMeta(wmDir(key))
      if (meta === null) return null
      // An empty `persona.md` means there is no text to contribute; the seam skips registering an
      // empty section, but the READ-ONLY half still applies from the record.
      /** The workmate's current persona text. */
      const persona = readPersona(key)
      return { persona, readonly: meta.readonly }
    },
    // The read-only deny is validated against the CHILD's scope — the surface it truly filters.
    // APPLY FOR REAL, AND NEVER PRUNE HERE. `validatedReadonlyDeny` is a PROBE that applies each
    // attempt and RELEASES it (so a real deny routed through it denied nothing), and it also PRUNES
    // names the agent's surface does not yet show — inside `agent/created` a child's surface may
    // still be empty, collapsing the canonical eight names to `[]`, and `restrict({deny: []})`
    // succeeds while restricting NOTHING. The canonical list is applied verbatim instead.
    restrictReadonly: (agent) => { applyChildReadonlyDeny(agent) },
    warn: (line) => reportPrunedNames(line),
    // Guarded: the event bus is optional, and a row must never lose its boot over a listener it
    // cannot attach (a mounted-adapter double may expose none of the two seams).
    onEvent: typeof dsh.onEvent === "function" ? dsh.onEvent : undefined,
  })

  // ── THE LEAF BOUNDARY on every child this row raises (CR repair E) ──────────────────────────────
  //
  // WHY A SECOND LISTENER. `installChildPersonaSeam` restricts the READ-ONLY workmate child and only that one,
  // so a write-capable consult would otherwise keep both spawn tools — and could then raise its own `maxDepth`
  // cap and nest past the consultation boundary. The two listeners are PARTITIONED (this one skips read-only
  // workmates, whose applier already carries the same names), so no child's scope is restricted twice.
  //
  // The identity read MIRRORS the seam's `resolve`: the canonical workmate KEY, exact-match, then its library
  // record — a label that names no instance is the ROSTER row's child and is left alone here. Never throws
  // inside `agent/created`: a throw there fails the whole spawn, and a missing restriction must be a log line.
  if (typeof dsh.onEvent === "function") {
    dsh.onEvent("agent/created", (payload: unknown) => {
      try {
        /** The agent the payload carries; a build that hands the agent itself still works. */
        const agent = (payload as { agent?: unknown } | undefined)?.agent ?? payload
        /** The child's own delegation label; absent for a child this composition did not raise. */
        const label = dsh.subagentLabelOf(agent)
        if (label === undefined) return
        /** The library key that label is, or null when it names no workmate instance. */
        const key = workmateKeyFromLabel(label)
        if (key === null) return
        /** The instance's record; a key with no instance is not this row's child. */
        const meta = readMeta(wmDir(key))
        if (meta === null || meta.readonly) return
        applyChildLeafDeny(agent)
      } catch (error) {
        reportPrunedNames("workmate child leaf boundary: a child could not be identified, so its spawn tools were left open ("
          + String((error as Error)?.message ?? error) + ")")
      }
    })
  }

  /** Normalize a base KEY: case/space/hyphen insensitive, so "Deep Worker", "deep worker" and
   * "deep-worker" all name the same specialist. */
  function normalizeBaseKey(s: string): string {
    return String(s ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "")
  }

  /** Resolve a base by its functional NAME; a roster `id` is refused exactly like any unknown key. */
  function resolveBase(key: string): { id: string; name: string; description: string; readonly: boolean; provider: string; model: string; persona: string } {
    /** The mpdRoles service, or undefined when the roles plugin is not mounted. */
    const roles = rolesService()
    if (!roles) throw new Error("mpd_workmate: mpdRoles service unavailable (mpd-roles-plugin not mounted)")
    /** The requested base key, trimmed. */
    const k = String(key ?? "").trim()
    if (!k) throw new Error('mpd_workmate: base required (the specialist\'s functional name, e.g. "Deep Worker")')
    // The functional NAME is the ONLY base key. The roster's stable `id` is INTERNAL provenance:
    // it is never accepted here, so an omo/legacy roster id is refused exactly like any other
    // unknown key — and the refusal lists the valid NAMES, never an id.
    const all: any[] = typeof roles.list === "function" ? roles.list() : []
    /** The comparison form of that key: case, spaces and hyphens are all insignificant. */
    const wanted = normalizeBaseKey(k)
    /** The matched roster entry, or undefined — in which case the refusal lists NAMES only. */
    const base = all.find((r: any) => normalizeBaseKey(String(r?.name ?? "")) === wanted)
    if (!base) {
      // NAMES only: the offending key is deliberately NOT echoed, so a rejected omo id can never
      // reappear inside the refusal (the criterion is that no id appears in the message at all).
      const names = all.map((r: any) => String(r?.name ?? "")).filter((n) => n !== "")
      throw new Error(`mpd_workmate: unknown base — use a functional NAME from mpd_roles_list (${names.join(", ")})`)
    }
    return { id: String(base.id), name: String(base.name), description: String(base.description ?? ""), readonly: Boolean(base.readonly), provider: String(base.chain?.[0]?.provider ?? ""), model: String(base.chain?.[0]?.model ?? ""), persona: String(base.persona ?? "") }
  }

  /**
   * The workspace a tool call comes from, trimmed; "" when it cannot be resolved.
   *
   * Every attribution write goes through this ONE read, so an agentless surface (a web route, a boot with
   * no session) attributes nothing rather than a process cwd that names no project.
   *
   * @param adapter - the adapter slice.
   * @param exec - the tool exec the call carries.
   * @returns the workspace root, or "".
   */
  function workspaceOf(adapter: DshAdapter, exec: unknown): string {
    try { return String(adapter.workspaceRoot(exec as any) ?? "").trim() } catch { return "" }
  }

  /**
   * The CURRENT base persona text for one instance's base, trimmed.
   *
   * The trim is the ONE normalization the baseline, the snapshot and the diff all use, so a trailing
   * newline in the roster's text can never fake a drift. A roster that cannot answer (unmounted row, a
   * base removed from the roster) answers null — the honest "cannot compare", never an empty base.
   *
   * @param meta - the instance's metadata, whose `baseName` is the functional base name.
   * @returns the current base persona text, or null when the roster cannot answer.
   */
  function currentBaseTextOf(meta: Meta): string | null {
    try { return String(resolveBase(meta.baseName).persona ?? "").trim() } catch { return null }
  }

  /** Create one instance directory from a base template, under an independent name. */
  function initWorkmate(baseKey: string, nameArg: string, noteArg: string, workspace: string): { name: string; baseName: string; readonly: boolean; provider: string; model: string; path: string; note: string } {
    assertMutationSandboxed("initialize a workmate")
    /** The resolved base template this instance copies. */
    const base = resolveBase(baseKey)
    /** The caller's name, sanitized; empty asks for an auto-generated one. */
    const given = sanitizeName(nameArg)
    /** The instance key: the caller's name, or the auto-generated `<base-slug>-<n>`. */
    let name = given
    if (!name) {
      // An auto-generated name derives from the base's FUNCTIONAL name (Deep Worker →
      // deep-worker-1), never from its internal roster id.
      const slug = sanitizeName(base.name) || "workmate"
      /** Every current instance, used to derive a free auto-generated name. */
      const existing = listInstances()
      /** The next ordinal for this base, raised until the candidate name is free. */
      let n = existing.filter((i) => i.meta.baseId === base.id).length + 1
      while (existing.some((i) => i.name === `${slug}-${n}`)) n += 1
      name = `${slug}-${n}`
    }
    /** The instance directory; an existing one is a refusal, never a reuse. */
    const dir = wmDir(name)
    if (existsSync(dir)) throw new Error(`mpd_workmate: "${name}" already exists — pick another name or reuse it via mpd_workmate_spawn`)
    mkdirSync(dir, { recursive: true })
    /** The route the instance is BORN with, recorded as provenance only: the base agent's own usable
     *  `agentRoutes` entry, else the base's own declared route (an extension role), else empty — never
     *  the shipped roster chain, which is not a route any spawn may run on (contract §1/§5). */
    const born = ((): { provider: string; model: string } => {
      /** The live agent-route resolution of the base, when the config row is mounted. */
      const live = configService()
      if (typeof live?.agentRouteResolutionOf === "function") {
        /** The total resolution; only a usable route names one here. */
        const resolution = live.agentRouteResolutionOf(base.name) as { ok: true; route: { provider: string; model: string } } | { ok: false } | undefined
        if (resolution !== undefined && resolution !== null && resolution.ok === true) return { provider: resolution.route.provider, model: resolution.route.model }
      }
      return { provider: base.provider, model: base.model }
    })()
    // THE BIRTH RECORD (wave W4-A3): the persona this instance starts from, its revision 1, and the base
    // text it was copied from. The base hash is the DRIFT BASELINE — trimming is the ONE normalization
    // every producer and consumer applies, so a trailing newline in the roster's text cannot fake a change.
    /** The birth persona text: the base's own persona, capped once. */
    const bornPersona = capText(base.persona, PERSONA_CAP).trim()
    /** The base text as the baseline is computed over. */
    const bornBase = String(base.persona ?? "").trim()
    /** The fresh metadata; `baseId` is recorded here as INTERNAL provenance and never leaves disk. */
    const meta: Meta = { name, baseId: base.id, baseName: base.name, description: base.description, provider: born.provider, model: born.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null, renamedFrom: [], personaRevision: 1, personaHash: sha256Of(bornPersona), baseRevision: bornBase === "" ? UNKNOWN_HASH : sha256Of(bornBase), workspaces: attuneWorkspaces([], workspace) }
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
    writeFileSync(join(dir, "persona.md"), bornPersona + "\n")
    // The versioned history starts AT BIRTH, and the base snapshot is what a later drift diff reads.
    writePersonaVersion(dir, 1, bornPersona)
    if (bornBase !== "") writeBaseSnapshot(dir, bornBase)
    writeFileSync(join(dir, "memory.md"), "")
    /** The note card: the caller's, or one auto-generated from the base and this instance. */
    const note = capText(String(noteArg ?? "").trim() || autoNote(meta, base.persona, ""), NOTE_CAP)
    writeFileSync(join(dir, "note.md"), note + "\n")
    writeIndexEntry(name, meta)
    return { name, baseName: base.name, readonly: base.readonly, provider: base.provider, model: base.model, path: dir, note }
  }

  /** The `mpdWorkmate` service: the same operations the tools expose, for route and plugin callers. */
  const workmateLibrary = {
    list: () => listInstances().map(({ name, meta, note }) => ({ name, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, updatedAt: meta.updatedAt, renamedFrom: meta.renamedFrom, note })),
    get: (name: string) => {
      try {
        /** The instance projected WITHOUT `baseId`, which the service never exposes. */
        const { meta, key } = ensureInstance(name)
        return { ...publicMeta(meta), name: key, note: readNote(key) }
      } catch { return null }
    },
    read: (name: string) => {
      try {
        /** The instance's full read model: public metadata plus persona, memory and note. */
        const { meta, key } = ensureInstance(name)
        return { ...publicMeta(meta), name: key, persona: readPersona(key), memory: readMemory(key), note: readNote(key) }
      } catch { return null }
    },
    // `rename` / `delete` are the service half of the mutation surface (§C). `delete` MUST be an
    // object-literal property: a bare `delete(...)` member is a parse error.
    // The service has no calling agent, so its default roots are the union of live session
    // workspaces (`workspaceRootsAll`), falling back to the adapter's env -> process.cwd() form
    // when no session is registered. A caller that knows its workspace passes it explicitly.
    rename: (name: string, newName: string, roots?: string[]) => renameWorkmate(name, newName, roots ?? agentlessRoots(dsh)),
    delete: (name: string, purge = false, confirm = "", roots?: string[]) => deleteWorkmate(name, purge, confirm, roots ?? agentlessRoots(dsh))
  }
  ctx.provide("mpdWorkmate", workmateLibrary)

  dsh.registerTool({
    name: "mpd_workmate_list",
    description: "List the workmate library (~/.mpd/workmate): each durable evolving agent instance with its base specialist, use count, last-updated time and note summary. Use before delegating a task: if a workmate's note matches well you can reuse it; otherwise initialize a new one.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { workmates: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["workmates", "count"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmates (" + v.count + "):\n" + (v.workmates as any[]).map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " rev=" + w.personaRevision + (w.defaultUpdated ? " default-updated:" + w.baseDriftLines + "L" : w.baseDriftUnknown ? " default-unverified" : "") + " :: " + String(w.note).slice(0, 140)).join("\n") || "(empty)"), presentationMeta: WORKMATE_LIST_CARD },
    execute: async () => {
      /** The tool's row set: the public fields, the note that makes matching possible, and the persona record. */
      const list = listInstances().map(({ name, meta, note }) => {
        /** The current base text for this instance's base, or null when the roster cannot answer. */
        const base = currentBaseTextOf(meta)
        /** The persona bookkeeping a READ computes; nothing is written by this call. */
        const record = personaRecordOf(wmDir(name), meta, base)
        /** The divergence from the base template this instance was copied from. */
        const drift = personaDrift(meta, wmDir(name), base)
        return {
          name, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model,
          uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, renamedFrom: meta.renamedFrom,
          // THE PER-WORKSPACE ATTRIBUTION (R-W3C B2): the workspaces this instance has served, most
          // recent first. A consumer that budgets PER WORKSPACE counts the rows carrying its own root;
          // an instance with none counts nowhere until it is used, which is what keeps a legacy
          // cross-project library from blocking a fresh project forever.
          workspaces: meta.workspaces,
          // The note AS RENDERED: the stored card plus the drift marker when the base moved.
          note: noteWithDrift(note, drift),
          // THE PERSONA RECORD: the revision a CAS writer must name, the hash a reader can verify, the
          // baseline, and the drift verdict.
          personaRevision: record.revision,
          personaHash: record.hash,
          baseRevision: meta.baseRevision === "" ? UNKNOWN_HASH : meta.baseRevision,
          defaultUpdated: drift.defaultUpdated,
          baseDriftLines: drift.baseDriftLines,
          baseDriftUnknown: drift.baseDriftUnknown,
        }
      })
      return { workmates: list, count: list.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_init",
    description: "Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = the specialist's functional NAME (mpd_roles_list), e.g. \"Deep Worker\". The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.",
    parameters: { type: "object", properties: { base: { type: "string", description: "the specialist's functional name (e.g. \"Deep Worker\")" }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated from the functional name if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + ")\nnote: " + v.note) },
    execute: async (args: any, exec: any) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""), workspaceOf(dsh, exec))
  })

  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a ONE-SHOT single-call consult — one bounded delegation, one report — carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). On a host exposing `startActivation` the adapter disposes that activation once the report settles (the retired `start` fallback is inherently one-shot), so the consult is NOT reused: ask a new question with a NEW spawn, and rely on the workmate RECORD (persona/memory/note) for durable continuity, not on the child session (the harness catalog is append-only, so a settled child may still list as `inactive`). The subagent must call mpd_workmate_reflect with a self-summary before finishing. This uses the SAME spawn mechanics as `mpd_role_spawn` (plus the library's persona/memory); for team work, instead add a member whose name equals the workmate name and give it the persona in the staged prompt yourself — the TEAM path injects no persona or memory. A CONSULT IS A LEAF (CR repair E): the child this tool raises has BOTH bundle spawn tools denied in its own scope, so it cannot delegate again, and a caller already at delegation depth 2 or deeper is refused outright.",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "")) },
    execute: async (args: any, exec: any) => {
      // THE LEAF BOUNDARY, ENFORCED AT THE TOOL (CR repair E): a session at depth 2 or deeper may not raise a
      // consult, whatever its own tool scope looks like (a composition without the `agent/created` bus, a
      // child whose label no seam resolved). Refused BEFORE the instance is resolved, so nothing is read and
      // no child is started.
      /** The refusal for a caller that is already too deep, or undefined when it may still spawn. */
      const tooDeep = consultDepthRefusal(exec?.agent)
      if (tooDeep !== undefined) throw new Error(tooDeep)
      /** The instance being spawned, resolved by key. */
      const { meta, key } = ensureInstance(String(args?.name ?? ""))
      // A REUSE ATTRIBUTES THE INSTANCE to the workspace using it (R-W3C B2), which is what makes
      // `workmates.max` a per-workspace budget. Written only when the list actually changed, so a repeat
      // spawn from the same project touches no byte.
      /** The attribution list after this reuse. */
      const attributed = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec))
      if (attributed.join("\u0000") !== meta.workspaces.join("\u0000")) {
        meta.workspaces = attributed
        writeFileSync(join(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + "\n")
        writeIndexEntry(key, meta)
      }
      /** The task text; empty is a caller error and must never spawn an empty prompt. */
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_workmate_spawn: task required")
      /** The evolved persona, sent both inside the prompt and as the subagent's persona. */
      const persona = readPersona(key)
      /** The bounded independent memory, newest last. */
      const memory = readMemory(key)
      /** The note card, included so the workmate sees its own matching summary. */
      const note = readNote(key)
      /** The assembled prompt: persona, memory, note, task, optional context and the reflect instruction. */
      const prompt = persona
        + "\n\nYour independent memory (bounded, latest first):\n" + (memory || "(empty — you are a fresh workmate)")
        + "\n\nWorkmate note:\n" + (note || "(none)")
        + "\n\nTask: " + task
        + (args?.context ? "\n\nContext:\n" + String(args.context) : "")
        + "\n\nWork with the tools your role requires (read-only workmates must never modify anything)."
        + " BEFORE your final report, call mpd_workmate_reflect with a concise self-summary (task / outcome / what you learned / optional persona_delta / optional new note) so your workmate persona and memory evolve. Then end with ONLY the structured report (name/summary/recommendation/details/evidence)."
      // §E(a): hold the in-use gate for the whole spawn so a rename/delete cannot land mid-flight.
      // The counter is released in `finally`, so even a THROWING spawn cannot leave a permanent
      // mutation block on this workmate.
      noteSpawnStart(key)
      try {
        // THE AGENT'S OWN ROUTE IS THE ONLY ROUTE SOURCE (contract §5), resolved PER SPAWN, so a
        // config saved between two spawns is what the SECOND spawn runs on — an in-flight task keeps
        // its route. The frozen `meta.provider`/`meta.model` are provenance and never decide a route.
        /** The primary route plus the agent's own fallback chain, or the structured refusal. */
        const decided = spawnRouteOf(meta)
        /** The route this spawn actually sends: the winning candidate after the ONE pre-spawn
         *  consumption of the fallback chain and the effort adaptation (contract §8). */
        const run = await resolveRunRoute(dsh, decided.route, decided.fallbacks)
        /** The adapted route, named for the spawn spec below. */
        const route = run.route
        /** The spawn result, whose structured report is echoed into this tool's output. */
        const result = await dsh.spawnAgent({
          // Name unification: the workmate's OWN name is the label — the same word a
          // team member would carry when its caller adds it under that name. ONLY this
          // single-call consult carries the persona; a TEAM member is given the persona by
          // the caller in the staged prompt. Never a `workmate-<key>-<random>` alias:
          // one agent, one name, on every surface.
          label: key,
          prompt,
          parent: exec.agent,
          signal: exec.signal,
          provider: route.provider,
          model: route.model,
          persona,
          outputSchema: REPORT_SCHEMA,
          // AN EXPLICIT LEAF BOUND (defect D17) — see `spawnMaxDepthOf`: the caller's own recorded depth plus
          // one, forwarded by the adapter on BOTH harness generations, so a NESTED caller's one-shot consult
          // is never refused by a host depth default it cannot see.
          maxDepth: spawnMaxDepthOf(exec.agent),
          // The route's OWN effort keyword rides along when it states one — AFTER the catalog
          // adaptation above. An absent keyword passes nothing and the harness keeps its resolution.
          ...(route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: route.reasoningEffort } }),
          ...(meta.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {})
        })
        /** The structured report, or an empty object when the subagent answered none. */
        const st = result.structured ?? {}
        return { name: key, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null }
      } finally {
        noteSpawnEnd(key)
      }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_reflect",
    description: "Self-evolve a workmate after a completed work session: append a bounded memory entry (oldest evicted past the cap), merge an optional persona revision, regenerate its short note, and bump the use count. Call this at the end of every task a workmate did — the workmate itself is instructed to do so; the caller may also call it on its behalf.",
    parameters: { type: "object", properties: { name: { type: "string" }, task: { type: "string" }, outcome: { type: "string" }, persona_delta: { type: "string", description: "optional persona revision text (merged, capped)" }, note: { type: "string", description: "optional replacement note card; auto-generated if omitted" } }, required: ["name", "task", "outcome"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, uses: { type: "integer" }, personaChars: { type: "integer" }, memoryChars: { type: "integer" }, noteChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " reflected (uses=" + v.uses + ", persona " + v.personaChars + "B / memory " + v.memoryChars + "B / note " + v.noteChars + "B)") },
    execute: async (args: any, exec: any) => {
      assertMutationSandboxed("reflect a workmate")
      // M4: a reflect arriving with a LEGACY (pre-rename) key does NOT resolve through renamedFrom —
      // ensureInstance fails with "no workmate named X" and zero side effects, so a legacy key can
      // never resurrect a directory. renamedFrom stays purely informational (list/get/read).
      const { meta, key } = ensureInstance(String(args?.name ?? ""))
      /** The task just done; it becomes `lastTask` and the note's freshness half. */
      const task = String(args?.task ?? "").trim()
      /** What happened; appended to memory, capped, and never left empty. */
      const outcome = String(args?.outcome ?? "").trim()
      if (!task || !outcome) throw new Error("mpd_workmate_reflect: task and outcome required")
      appendMemory(key, `## ${now()} — ${capText(task, 200)}\n${capText(outcome, 1200)}`)
      /** The persona delta this reflect carries; empty means "no persona change". */
      const delta = String(args?.persona_delta ?? "").trim()
      // THE PERSONA RECORD (wave W4-A3): a delta is a NEW revision (and therefore a new version file);
      // a reflect without one still BACKFILLS a legacy instance's missing fields, without inventing a
      // revision the caller did not make.
      const written = applyPersonaWrite({ dir: wmDir(key), meta, text: mergedPersonaText(readPersonaIn(wmDir(key)), delta), currentBase: currentBaseTextOf(meta), bump: delta !== "" })
      /** The persona after this reflect, capped. */
      const persona = written.persona
      /** The memory after the new entry landed and eviction ran. */
      const memory = readMemory(key)
      meta.uses += 1
      meta.lastTask = task
      meta.updatedAt = now()
      // A reflect BINDS the instance to the workspace that worked it (R-W3C B2), so the per-workspace
      // budget follows real use rather than a creation-time guess.
      meta.workspaces = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec))
      // Repair the display mirror on write (§B): the directory key is the identity.
      meta.name = key
      writeFileSync(join(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + "\n")
      // The note card carries the drift marker when the roster base moved, so the FILE says it too.
      /** The replacement note: the caller's, or one regenerated from the new state, marked for drift. */
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(key)), NOTE_CAP)
      writeFileSync(join(wmDir(key), "note.md"), noteWithDrift(note, personaDrift(meta, wmDir(key), currentBaseTextOf(meta))) + "\n")
      writeIndexEntry(key, meta)
      return { name: key, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_persona_set",
    description: "REPLACE a workmate's persona text under a COMPARE-AND-SET guard. The caller names the revision its draft was based on (`baseRevision` = the INTEGER `personaRevision` reported by mpd_workmate_list, which is a DIFFERENT thing from the meta.json baseline of the same name); a stale token is REFUSED and NOTHING is written — the result carries the current revision and the current persona length so the caller can rebase and retry. A matching write replaces persona.md, bumps personaRevision, rewrites personaHash and stores the whole text as persona.versions/<revision>.md, where a version file is NEVER overwritten, so any two revisions can be diffed. Use it to prune or rewrite a persona that has evolved; mpd_workmate_reflect remains the append-a-delta path.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "workmate instance name" },
        persona: { type: "string", description: "the COMPLETE new persona text — this REPLACES the current one" },
        baseRevision: { type: "integer", description: "the personaRevision this draft is based on (from mpd_workmate_list); a stale value is refused" }
      },
      required: ["name", "persona", "baseRevision"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, revision: { type: "integer" }, personaChars: { type: "integer" }, personaHash: { type: "string" }, refused: { type: "string" }, currentRevision: { type: "integer" }, currentPersonaChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false },
      render: (_a: unknown, v: any) => textBlock(v.updated === true
        ? "workmate " + v.name + " persona set at revision " + v.revision + " (" + v.personaChars + "B, sha256 " + String(v.personaHash).slice(0, 12) + ")"
        : "workmate " + v.name + " persona REFUSED — " + String(v.refused) + " (current revision " + v.currentRevision + ", " + v.currentPersonaChars + "B)")
    },
    execute: async (args: any, exec: any) => {
      assertMutationSandboxed("set a workmate persona")
      /** The instance this write targets; resolveTarget refuses an orphan or a symlinked directory. */
      const { meta, dir } = resolveTarget(sanitizeName(String(args?.name ?? "")))
      /** The caller's replacement persona text. */
      const next = String(args?.persona ?? "")
      // An empty persona would erase the instance's identity, which is not an update but a delete of what
      // makes it a workmate — refused before anything is read or written.
      if (next.trim() === "") throw new Error("mpd_workmate_persona_set: persona required (an empty persona would erase this workmate's identity)")
      /** The current base persona text, or null when the roster cannot answer; computed ONCE per call. */
      const base = currentBaseTextOf(meta)
      /** The bookkeeping the CAS compares against (a legacy instance resolves its effective revision here). */
      const record = personaRecordOf(dir, meta, base)
      /** The revision the caller says its draft is based on. */
      const expected = Number(args?.baseRevision)
      if (!Number.isInteger(expected) || expected !== record.revision) {
        // THE CAS REFUSAL: nothing on disk changes — not the persona, not the metadata, not a version file.
        // The two numbers a caller needs to rebase (the current revision and the current persona length)
        // ride the result, so the draft is never silently dropped on the floor.
        rowLogLine("mpd-workmate", "persona_set refused (stale baseRevision) for " + meta.name)
        return { name: meta.name, updated: false, refused: "stale baseRevision: the draft was based on revision " + String(args?.baseRevision) + " but this workmate is at revision " + record.revision + "; re-read the persona and rebase", currentRevision: record.revision, currentPersonaChars: readPersonaIn(dir).length }
      }
      /** The committed write: a NEW revision, its version file and the metadata triple. */
      const written = applyPersonaWrite({ dir, meta, text: next, currentBase: base, bump: true })
      meta.updatedAt = now()
      // A persona write is a BIND (R-W3C B2): the workspace that rewrote the instance now owns it too.
      meta.workspaces = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec))
      // Repair the display mirror on write (§B): the directory key is the identity.
      meta.name = sanitizeName(String(args?.name ?? ""))
      writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
      writeIndexEntry(meta.name, meta)
      // ONE journal line per accepted write, which is what makes a persona rewrite auditable.
      rowLogLine("mpd-workmate", "persona_set " + meta.name + " revision " + record.revision + " -> " + written.revision + " (sha256 " + written.hash.slice(0, 12) + ")")
      return { name: meta.name, updated: true, revision: written.revision, personaChars: written.persona.length, personaHash: written.hash }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + "\n" + (v.matches as any[]).map((m) => "- " + m.name + " score=" + m.score.toFixed(2) + " [" + m.baseName + "] :: " + String(m.note).slice(0, 120)).join("\n") + (v.suggestion ? "\n" + v.suggestion : "")), presentationMeta: WORKMATE_MATCH_CARD },
    execute: async (args: any) => {
      /** The task to match against, required. */
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_workmate_match: task required")
      /** Every instance scored against the task, best first. */
      const matches = listInstances().map(({ name, meta, note }) => {
        /** The newest slice of memory, part of the workmate's matchable text. */
        const memoryTail = readMemory(name, 600)
        /** The 0..1 match score, rounded to two decimals for the output. */
        const score = scoreMatch(task, { note, baseName: meta.baseName, description: meta.description, memoryTail })
        return { name, score: Math.round(score * 100) / 100, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, note }
      }).sort((a, b) => b.score - a.score)
      /** The top match, or undefined for an empty library. */
      const best = matches[0]
      /** Whether the best score clears the threshold — below it a NEW workmate must be initialized. */
      const matched = !!best && best.score >= MATCH_THRESHOLD
      return { matched, threshold: MATCH_THRESHOLD, matches, suggestion: matched ? `Delegate to "${best!.name}" (score ${best!.score}).` : "No note matches well enough — initialize a NEW workmate with mpd_workmate_init instead of forcing a weak match." }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_rename",
    description: "Rename a workmate instance: MOVES its evolved identity (directory key, metadata, index key, note self-reference, previous-name history) instead of re-instantiating it — persona, memory, caps, use count and history are preserved byte-for-byte. Refused while the workmate is in use by a team member or an in-flight spawn, and refused if the target name already exists. Names are ASCII [a-z0-9_-] only: uppercase, CJK, spaces and punctuation are rejected before anything is touched.",
    parameters: { type: "object", properties: { name: { type: "string", description: "current workmate name (its directory key)" }, new_name: { type: "string", description: "new name — ASCII, lowercase, [a-z0-9_-]" } }, required: ["name", "new_name"], additionalProperties: false },
    // DEFECT HISTORY (t15): the execute value carries `ok: true`, exactly like the §D route body, but
    // `ok` was missing from this schema while `additionalProperties: false` was set — so the harness
    // output validator rejected EVERY successful call ("value.ok is not a declared property") *after*
    // the mutation had already been applied. `ok` is DECLARED here rather than dropped from the value:
    // the service, these tests and the §D route bodies all speak one shape, and the success flag is
    // the first thing any consumer reads. Kept required so the flag cannot silently disappear.
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" }, from: { type: "string" }, renamedFrom: { type: "array", items: { type: "string" } } }, required: ["ok", "name", "from"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate \"" + v.from + "\" renamed to \"" + v.name + "\"" + (Array.isArray(v.renamedFrom) && v.renamedFrom.length ? "\nprevious names: " + v.renamedFrom.join(", ") : "")) },
    execute: async (args: any, exec: any) => renameWorkmate(args?.name, args?.new_name, [dsh.workspaceRoot(exec)])
  })

  dsh.registerTool({
    name: "mpd_workmate_delete",
    description: "Delete a workmate instance. ARCHIVE-FIRST by default: the instance leaves the library (no longer listed or matchable, and restorable) into ~/.mpd/workmate/.archive/. Real removal requires purge: true together with confirm set to the exact name — without both, nothing is destroyed. Refused while the workmate is in use by a team member or an in-flight spawn.",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate name to delete" }, purge: { type: "boolean", description: "true = permanently remove instead of archiving (requires confirm)" }, confirm: { type: "string", description: "must equal name exactly when purge is true" } }, required: ["name"], additionalProperties: false },
    // JSON-schema shape note (defect history, §N1): the `type` ARRAY form (`["string","null"]`) is
    // REJECTED by this harness validator — `unsupported JSON schema: schema.properties.archived.type
    // must be a single type string` — and that abort takes the WHOLE plugin tree down. The accepted way
    // to allow null is `oneOf`. The tool so returns the service's `null` verbatim: tool, service and the
    // contract §D HTTP body all report ONE shape, so no consumer needs to know which surface it reads.
    // t15: `ok` is declared and required here too — the same missing-property defect rejected both
    // archive and purge results (the value has always carried `ok: true`, like the §D route body).
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" }, archived: { oneOf: [{ type: "string" }, { type: "null" }] }, purged: { type: "boolean" } }, required: ["ok", "name", "archived", "purged"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate \"" + v.name + "\" " + (v.purged ? "PURGED (permanently removed)" : "archived (gone from the library, still restorable)")) },
    execute: async (args: any, exec: any) => deleteWorkmate(args?.name, args?.purge, args?.confirm, [dsh.workspaceRoot(exec)])
  })

  dsh.registerTool({
    name: "mpd_workmate_optimize",
    description: "Merge similar workmates and shrink the library. Two instances are MERGEABLE when they share the same roster base and readonly posture, neither is archived, neither is busy in a live team, AND (their note score clears the merge threshold OR their tag overlap is at least 0.5). A merge PRESERVES the evolved record — memory blocks concatenated and deduplicated by sha256 under the cap, the LONGER persona plus one merged-from line, use counts summed, name history accumulated, the note regenerated — and ARCHIVES the source to ~/.mpd/workmate/.archive/<name>-merged-<target>-<ts>/ with a merge.json record. It never deletes and cannot purge. DRY RUN BY DEFAULT: it returns the plan table and writes nothing unless confirm is literally true. A pair refused for live-team use skips ONLY that pair, and a pair that cannot run at all is REPORTED in `skipped` instead of aborting the rest. The in-use gate scans EVERY live workspace of this process (the library is cross-project); DECLARED BOUND: a live team in ANOTHER dsh process is not visible to this gate.",
    parameters: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "true = print the plan only (the default when confirm is absent)" },
        confirm: { type: "boolean", description: "true = APPLY the plan; without it nothing is written" },
        pairs: { type: "array", description: "explicit merge pairs; omitted = every fork in one base group", items: { type: "object", properties: { from: { type: "string" }, into: { type: "string" } }, required: ["from", "into"], additionalProperties: false } },
        mergeThreshold: { type: "number", description: "note-score floor, 0..1; defaults to 0.6" }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { plan: { type: "array", items: { type: "object" } }, applied: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } } }, required: ["plan", "applied", "skipped"], additionalProperties: false },
      render: (_a: unknown, v: any) => textBlock(renderOptimizeTable(v as OptimizeResult))
    },
    execute: async (args: any, exec: any) => optimizeWorkmates({
      dryRun: args?.dryRun === true,
      confirm: args?.confirm === true,
      ...(Array.isArray(args?.pairs) ? { pairs: (args.pairs as Array<Record<string, unknown>>).map((pair) => ({ from: String(pair?.from ?? ""), into: String(pair?.into ?? "") })) } : {}),
      ...(typeof args?.mergeThreshold === "number" ? { mergeThreshold: args.mergeThreshold } : {}),
      // THE IN-USE GATE IS HOME-WIDE (R-W3C High 1): the library is HOME-scoped and cross-project, so the
      // merge gate must see a live team in ANY workspace — handing it the caller's own root let a pair be
      // merged while another project's teammate was using it. `agentlessRoots` is the union of every live
      // session workspace. DECLARED BOUND: a session in ANOTHER dsh PROCESS is invisible to
      // `workspaceRootsAll`, so a cross-process live team remains unprotected by this gate.
      teamRoots: agentlessRoots(dsh)
    })
  })

  // `/workmate-optimize` is the human-facing half: no args prints the plan table, and the single
  // argument `confirm` applies it. It answers with the same table the tool renders, so the two
  // surfaces cannot drift.
  dsh.registerCommand({
    name: "workmate-optimize",
    description: "Merge/optimise the workmate library: prints the merge plan (dry run) — add the word `confirm` to apply it",
    input: { hint: "confirm" },
    handler: (invocation: { rawInput?: unknown; agent?: unknown }) => {
      /** Whether the caller asked to APPLY: the only accepted argument is the word `confirm`. */
      const confirm = String(invocation?.rawInput ?? "").trim().toLowerCase() === "confirm"
      /** The optimize call the table is rendered from. */
      // Same HOME-wide root set as the tool (R-W3C High 1): a command run from project B must see the
      // live team in project A. DECLARED BOUND: another dsh PROCESS is invisible to the union.
      const result = optimizeWorkmates({ confirm, teamRoots: agentlessRoots(dsh) })
      return { kind: "success" as const, text: renderOptimizeTable(result) }
    }
  })

  // Web GUI data routes (mirrors the agent-teams web surface pattern): the browser
  // workmate library floater polls /plugins/mpd-workmate/list and POSTs init from the
  // form. Register lazily — try at apply, retry on service binding — so a webless
  // profile stays tool-only; effect-owned.
  let webRegistered = false
  /** Register the web data routes ONCE, retried when the web-server service binds later. */
  const registerWebSurface = (): void => {
    if (webRegistered) return
    // THROUGH THE ADAPTER (AGENTS.md §6): the web server is a harness seam, and the adapter owns the
    // two names it may bind under plus the tolerant probe.
    const webServer = typeof dsh.webServerOf === "function" ? dsh.webServerOf() : undefined
    if (webServer === undefined || typeof ctx.effect !== "function") return
    webRegistered = true
    // Every workmate response carries the shared wire headers (§D).
    /** Answer one JSON response with the shared §D headers. */
    const json = (res: any, status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
      res.end(JSON.stringify(body))
    }
    /** A refusal keeps its §D reason (and the blocking teams for `in-use`) so the GUI can branch on
     * it. An unexpected internal failure is reported by error CODE only: an error body never leaks an
     * absolute filesystem path, which is exactly what an fs message would contain (§D). */
    /** Map a thrown value onto the §D body: a `HomeGuardRefusal` (every `WorkmateError` AND the shared
     * T-43 guard, which throws the adapter's base class) keeps its reason, and a workmate refusal also
     * keeps its blocking teams; anything else reports a CODE only (never a filesystem path). */
    const failure = (res: any, e: unknown): void => {
      if (e instanceof HomeGuardRefusal) {
        json(res, e.status, { error: e.message, reason: e.code, ...(e instanceof WorkmateError && e.blocking.length > 0 ? { blocking: e.blocking } : {}) })
        return
      }
      json(res, 500, { error: `mpd_workmate: internal error (${String((e as any)?.code ?? "error")})`, reason: "internal" })
    }
    /** Read and parse a request body; an unparsable one asks the route to answer 400. */
    const readBody = async (req: any): Promise<{ ok: true; body: any } | { ok: false }> => {
      /** The request body accumulated from the stream. */
      let raw = ""
      for await (const chunk of req) raw += String(chunk)
      try { return { ok: true, body: raw ? JSON.parse(raw) : {} } } catch { return { ok: false } }
    }
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/list",
      handler: async (_req: any, res: any) => {
        /** The library as the browser floater shows it: the same public projection the tool returns. */
        const list = listInstances().map(({ name, meta, note }) => ({ name, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, renamedFrom: meta.renamedFrom, note }))
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        res.end(JSON.stringify({ workmates: list }))
      }
    }) as any, "mpd-workmate: list route")
    // Roster route: the sidebar tab's base picker reads the same roster the tools
    // use, so the GUI never asks the user to type a base name from memory. The roster's
    // internal `id` is deliberately NOT carried: the functional NAME is the only base key.
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/roster",
      handler: async (_req: any, res: any) => {
        /** The mpdRoles service, read through the ctx because this route has no tool exec. */
        const roles = (ctx.get ? ctx.get("mpdRoles") : undefined) as any
        /** The base picker's rows: functional NAME, description and the read-only flag — never the roster id. */
        let bases: any[] = []
        try {
          bases = (typeof roles?.list === "function" ? roles.list() : []).map((r: any) => ({ name: String(r.name), description: String(r.description ?? ""), readonly: Boolean(r.readonly) }))
        } catch (e: any) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end(JSON.stringify({ error: String(e?.message ?? e) }))
          return
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        res.end(JSON.stringify({ bases }))
      }
    }) as any, "mpd-workmate: roster route")
    // Detail route: persona + memory + note of one workmate, for the tab's detail view.
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/get",
      handler: async (req: any, res: any) => {
        /** The `name` query parameter, which selects the instance to detail. */
        const name = String(new URL(String(req.url ?? "/"), "http://dsh.invalid").searchParams.get("name") ?? "").trim()
        /** The detail read model, or null when the name does not resolve. */
        const detail = name === "" ? null : workmateLibrary.read(name)
        if (detail == null) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end(JSON.stringify({ error: "unknown workmate: " + name }))
          return
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        res.end(JSON.stringify(detail))
      }
    }) as any, "mpd-workmate: get route")
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/init",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") { res.writeHead(405, { allow: "POST", "cache-control": "no-store" }); res.end(); return }
        /** The POST body accumulated from the stream. */
        let raw = ""
        for await (const chunk of req) raw += String(chunk)
        /** The parsed body, or the empty object when the request carried none. */
        let body: any = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "invalid JSON" })); return }
        try {
          /** The created instance, reported exactly as the init tool would report it. */
          // AN AGENTLESS ROUTE ATTRIBUTES NOTHING: there is no session to resolve a workspace from, and a
          // process cwd would name whichever directory the server was started in, not a project.
          const created = initWorkmate(String(body?.base ?? ""), String(body?.name ?? ""), String(body?.note ?? ""), "")
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end(JSON.stringify(created))
        } catch (e: any) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: String(e?.message ?? e) }))
        }
      }
    }) as any, "mpd-workmate: init route")
    // Mutation routes (§D): POST-only, reason-coded refusals the GUI branches on.
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/rename",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end()
          return
        }
        /** The parsed rename body, or a 400 answer that has already been sent. */
        const parsed = await readBody(req)
        if (!parsed.ok) return json(res, 400, { error: "invalid JSON" })
        try { json(res, 200, renameWorkmate(parsed.body?.name, parsed.body?.new_name, agentlessRoots(dsh))) } catch (e) { failure(res, e) }
      }
    }) as any, "mpd-workmate: rename route")
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/delete",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end()
          return
        }
        /** The parsed delete body, or a 400 answer that has already been sent. */
        const parsed = await readBody(req)
        if (!parsed.ok) return json(res, 400, { error: "invalid JSON" })
        try { json(res, 200, deleteWorkmate(parsed.body?.name, parsed.body?.purge, parsed.body?.confirm, agentlessRoots(dsh))) } catch (e) { failure(res, e) }
      }
    }) as any, "mpd-workmate: delete route")
  }
  registerWebSurface()
  if (typeof ctx.on === "function") {
    // The REBIND subscription goes through the adapter as well: `internal/service` is the runtime's
    // own binding event and the adapter owns which names count as "the web server".
    dsh.onServiceBound(["webServer", "httpServer"], () => { registerWebSurface() })
  }
}
