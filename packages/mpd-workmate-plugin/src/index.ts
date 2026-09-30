// mpd-workmate-plugin: durable, evolving agent library under the user's HOME
// (~/.mpd/workmate). The roster specialists are BASE templates only: a workmate
// is an instantiated copy with an independent name that self-summarizes after each
// work session (persona + independent memory, size-capped to keep spawned context
// bounded) and keeps a short searchable note. Reuse via note-matching — when no note
// matches well enough, initialize a NEW workmate instead of forcing a weak match.
//
// Tools: mpd_workmate_list / mpd_workmate_init / mpd_workmate_spawn /
//        mpd_workmate_reflect / mpd_workmate_match / mpd_workmate_rename /
//        mpd_workmate_delete  (+ mpdWorkmate service).
// The library root is deliberately the user's HOME (cross-project), a user-approved
// exception to the workspace-scoped state rule (AGENTS.md §6); QA boots with
// HOME=<sandbox> so tests never touch the real home.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { join, resolve, sep } from "node:path"
import { workspaceRootOf, type DshAdapter, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-workmate"
/** The seams this row needs declared: the tool registry and the subagent spawner, both read through the adapter. */
export const inject = ["tools", "subagents"]

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
  "mcp__lsp__rename",
]

/** A refused mutation, carrying the wire reason of the shared protocol (contract §D) so the HTTP
 * layer maps it verbatim and the GUI can branch on it. */
export class WorkmateError extends Error {
  /** The §D wire reason (`invalid-name`, `collision`, `in-use`, `real-home-refused`, …) the HTTP layer maps verbatim. */
  code: string
  /** The HTTP status the web routes answer with for this refusal. */
  status: number
  /** The team members that block an `in-use` refusal, so the GUI can name them. */
  blocking: { teamId: string; member: string }[]
  /** Build a refusal carrying its wire reason, its HTTP status and the teams that block it. */
  constructor(code: string, message: string, status: number, blocking: { teamId: string; member: string }[] = []) {
    super(message)
    this.name = "WorkmateError"
    this.code = code
    this.status = status
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
 * T-43 — the REAL-HOME guard. The workmate library is the ONE state root that deliberately lives
 * under the user's HOME (cross-project, user-owned), so a QA/verification boot that forgets
 * `HOME=<sandbox>` writes the REAL `~/.mpd/workmate` library — the exact failure the register's T-43
 * names and the `workmate-library` QA lane asserts. This guard refuses a MUTATION in that case and
 * does nothing else:
 *   · it fires ONLY when the process looks isolated (`DSH_HOME` is set) AND the resolved library
 *     would land in the real user home — i.e. `HOME` is absent/empty, or equals the real home, or
 *     does not cover the library root;
 *   · a NORMAL session (`DSH_HOME` unset) is never refused, and reads are never guarded;
 *   · the deliberate escape hatch is `MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1`.
 * Proven by one positive and one negative case in `evidence/platform/harness-close/` (the plugin's
 * own test files are outside this change's scope; they set HOME to a temp dir, so they stay green).
 */
export const WORKMATE_ALLOW_REAL_HOME_ENV = "MPD_DSH_WORKMATE_ALLOW_REAL_HOME"

/** A HOME-INDEPENDENT home for the real user. `homedir()` must NOT be used for that comparison:
 * on POSIX it reads $HOME, so comparing $HOME against it is a tautology — which is how the T-43 guard
 * came to refuse the SANCTIONED sandboxed boot while being unable to tell it from the real home. node's
 * `userInfo()` is passwd-derived, but bun's follows $HOME, so the passwd entry for the effective uid is
 * consulted first and `userInfo()` stays as the fallback. `undefined` means undeterminable. */
function realUserHome(): string | undefined {
  // Windows first: %USERPROFILE% is the OS profile variable and is HOME-INDEPENDENT by
  // construction, which is exactly what this function needs. It is also the only source that
  // survives a failing libuv passwd emulation — measured on a Windows host: node's
  // `userInfo()` throws `uv_os_get_passwd returned ENOMEM`, which collapsed the real home to
  // `undefined` and made the guard REFUSE the sanctioned sandboxed boot (T-43).
  if (process.platform === "win32") {
    /** %USERPROFILE% on Windows: the HOME-independent profile variable this comparison needs. */
    const profile = process.env.USERPROFILE
    if (typeof profile === "string" && profile !== "") return profile
  }
  try {
    /** The effective uid, or undefined on a host that cannot report one. */
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined
    if (uid !== undefined) {
      /** The /etc/passwd entry for that uid — passwd-derived, so it cannot follow $HOME. */
      const line = readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.split(":")[2] === String(uid))
      /** The passwd home field, when the entry carries one. */
      const home = line === undefined ? undefined : line.split(":")[5]
      if (home !== undefined && home !== "") return home
    }
  } catch { /* fall through to the API below */ }
  try {
    /** The OS API's home, consulted only when passwd could not answer (and only when it differs from $HOME). */
    const api = userInfo().homedir
    if (api !== "" && resolve(api) !== resolve(process.env.HOME ?? api)) return api
  } catch { /* undeterminable on this host */ }
  return undefined
}

/** Refuse a MUTATION that would land in the real `~/.mpd/workmate` while `DSH_HOME` marks an isolated boot (T-43); reads are never guarded. */
export function assertMutationSandboxed(operation: string): void {
  /** The isolation marker: unset means a normal session, which is never refused. */
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined || dshHome === "") return                 // normal session: unaffected
  if (process.env[WORKMATE_ALLOW_REAL_HOME_ENV] === "1") return       // explicit, documented override
  /** The library root this mutation would write, used by the containment test below. */
  const root = workmateRoot()
  /** The sandbox HOME this process was booted with, if any. */
  const home = process.env.HOME
    /** The real user's home, determined WITHOUT reading $HOME, so the comparison is not a tautology. */
    const realHome = realUserHome()
  /** Whether the library root would land inside a given home directory. */
  const inside = (h: string): boolean => root === h || root.startsWith(h.endsWith(sep) ? h : h + sep)
  if (home !== undefined && home !== "" && realHome !== undefined && resolve(home) !== resolve(realHome) && inside(resolve(home))) return
  throw new WorkmateError(
    "real-home-refused",
    "mpd_workmate: refusing to " + operation + " inside the REAL library " + root
      + " while DSH_HOME=" + dshHome + " marks an isolated/QA boot — set HOME=<sandbox> (T-43), or set "
      + WORKMATE_ALLOW_REAL_HOME_ENV + "=1 to override deliberately"
      + (realHome === undefined ? " (the real home could not be determined on this host)" : ""),
    403,
  )
}

/** Instance path. Guarded (§B): `wmDir("")` would resolve to the LIBRARY ROOT itself, so an empty
 * name can never name a directory — the root is not an instance and can never be moved or removed. */
function wmDir(name: string): string {
  /** The sanitized key; an empty one would name the library root itself, which is not an instance. */
  const key = sanitizeName(name)
  if (key === "") throw new WorkmateError("invalid-name", "mpd_workmate: empty workmate name — the library root is not an instance", 400)
  return join(workmateRoot(), key)
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

/** Cap a text: keep head + tail with a truncation marker (bounded context). */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text
  /** How much of the head survives (three quarters of the cap). */
  const head = Math.floor(max * 0.75)
  /** How much of the tail survives; head + tail + marker stay within the cap. */
  const tail = max - head
  return text.slice(0, head) + `\n…[truncated ${text.length - max} chars]…\n` + text.slice(-tail)
}

/** An instance's on-disk metadata; `baseId` inside it is INTERNAL provenance, never published. */
type Meta = {
  name: string; baseId: string; baseName: string; description: string
  provider: string; model: string; readonly: boolean
  createdAt: string; updatedAt: string; uses: number; lastTask: string | null
  renamedFrom: string[]
}

/** Read and normalize `meta.json`; a missing or unparsable file reads as null, never a throw. */
function readMeta(dir: string): Meta | null {
  try {
    if (!existsSync(join(dir, "meta.json"))) return null
    /** The parsed metadata, normalized field by field so a hand-edited file cannot break a caller. */
    const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask), renamedFrom: Array.isArray(m.renamedFrom) ? m.renamedFrom.map(String) : [] }
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

/** Merge a persona revision; keep the base + latest revisions within the cap. */
function mergePersona(key: string, revision: string): string {
  /** The persona file of this instance. */
  const path = join(wmDir(key), "persona.md")
  /** The persona as it stands, or the empty string for a fresh workmate. */
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim()
  /** The persona with the revision appended and the whole text capped. */
  const merged = capText(existing + (revision ? `\n\n## Persona revision (${now()})\n${revision.trim()}` : ""), PERSONA_CAP)
  writeFileSync(path, merged + "\n")
  return merged
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
    return { id: String(base.id), name: String(base.name), description: String(base.description ?? ""), readonly: Boolean(base.readonly), provider: base.chain?.[0]?.provider ?? "deepseek-official", model: base.chain?.[0]?.model ?? "", persona: String(base.persona ?? "") }
  }

  /** Create one instance directory from a base template, under an independent name. */
  function initWorkmate(baseKey: string, nameArg: string, noteArg: string): { name: string; baseName: string; readonly: boolean; provider: string; model: string; path: string; note: string } {
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
    /** The fresh metadata; `baseId` is recorded here as INTERNAL provenance and never leaves disk. */
    const meta: Meta = { name, baseId: base.id, baseName: base.name, description: base.description, provider: base.provider, model: base.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null, renamedFrom: [] }
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
    writeFileSync(join(dir, "persona.md"), capText(base.persona, PERSONA_CAP) + "\n")
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
    output: { schema: { type: "object", properties: { workmates: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["workmates", "count"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmates (" + v.count + "):\n" + (v.workmates as any[]).map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " :: " + String(w.note).slice(0, 140)).join("\n") || "(empty)") },
    execute: async () => {
      /** The tool's row set: public fields plus the note that makes matching possible. */
      const list = listInstances().map(({ name, meta, note }) => ({ name, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, renamedFrom: meta.renamedFrom, note }))
      return { workmates: list, count: list.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_init",
    description: "Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = the specialist's functional NAME (mpd_roles_list), e.g. \"Deep Worker\". The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.",
    parameters: { type: "object", properties: { base: { type: "string", description: "the specialist's functional name (e.g. \"Deep Worker\")" }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated from the functional name if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + ")\nnote: " + v.note) },
    execute: async (args: any) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""))
  })

  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a one-shot subagent carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). The subagent must call mpd_workmate_reflect with a self-summary before finishing. For team work, instead add a member whose name equals the workmate name (its persona/memory are injected automatically).",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "")) },
    execute: async (args: any, exec: any) => {
      /** The instance being spawned, resolved by key. */
      const { meta, key } = ensureInstance(String(args?.name ?? ""))
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
        /** The spawn result, whose structured report is echoed into this tool's output. */
        const result = await dsh.spawnAgent({
          // Name unification: the workmate's OWN name is the label — the same word a
          // team member would carry (a team member is added under the workmate name so
          // its persona/memory are injected). Never a `workmate-<key>-<random>` alias:
          // one agent, one name, on every surface.
          label: key,
          prompt,
          parent: exec.agent,
          signal: exec.signal,
          provider: meta.provider,
          model: meta.model,
          persona,
          outputSchema: REPORT_SCHEMA,
          ...(meta.readonly ? { toolFilter: { deny: READONLY_DENY } } : {})
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
    execute: async (args: any) => {
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
      /** The persona after the optional revision was merged and capped. */
      const persona = mergePersona(key, String(args?.persona_delta ?? "").trim())
      /** The memory after the new entry landed and eviction ran. */
      const memory = readMemory(key)
      meta.uses += 1
      meta.lastTask = task
      meta.updatedAt = now()
      // Repair the display mirror on write (§B): the directory key is the identity.
      meta.name = key
      writeFileSync(join(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + "\n")
      /** The replacement note: the caller's, or one regenerated from the new state. */
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(key)), NOTE_CAP)
      writeFileSync(join(wmDir(key), "note.md"), note + "\n")
      writeIndexEntry(key, meta)
      return { name: key, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + "\n" + (v.matches as any[]).map((m) => "- " + m.name + " score=" + m.score.toFixed(2) + " [" + m.baseName + "] :: " + String(m.note).slice(0, 120)).join("\n") + (v.suggestion ? "\n" + v.suggestion : "")) },
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
    /** Map a thrown value onto the §D body: a `WorkmateError` keeps its reason and blocking teams, anything else reports a CODE only (never a filesystem path). */
    const failure = (res: any, e: unknown): void => {
      if (e instanceof WorkmateError) {
        json(res, e.status, { error: e.message, reason: e.code, ...(e.blocking.length > 0 ? { blocking: e.blocking } : {}) })
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
          const created = initWorkmate(String(body?.base ?? ""), String(body?.name ?? ""), String(body?.note ?? ""))
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
