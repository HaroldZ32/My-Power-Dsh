// The memory engine's STORE layer (wave W3-D): where a memory store lives, the VCS backends behind it
// and the ONE home-scoped mutation guard both stores share. `index.ts` registers the five tools and
// `archive.ts` records the project-archive digest, so neither module has to import the other.
//
// TWO STORES, ONE DATA SHAPE. The WORKSPACE store is per-agent and lives at
// `<workspace>/<memory.dir or ".mpd">/memory/agents/<slug>/{repo,runtime}`; the GLOBAL store is shared
// across every project and lives at `<HOME>/.mpd/memory/{repo,runtime}` (`memory.globalDir` overrides
// the root). Both keep markdown entries under `repo/memory/` and one journal at
// `runtime/journal.jsonl`; the global store also carries `runtime/index.json`, the project-archive
// index that `archive.ts` owns.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { assertHomeMutationSandboxed } from "../../mpd-dsh-adapter-plugin/src/index"

/** The row's config keys: the VCS mode, the workspace state dir, the agent slug, the reflection threshold and the global store root. */
export interface Config {
  /** Which VCS backends a commit runs through: `git` (the default), `svn`, or both. */
  vcs?: "git" | "svn" | "both"
  /** The workspace state directory the agent store hangs under; `.mpd` when the row names none. */
  dir?: string
  /** Explicit agent slug; derived from the workspace basename when absent. */
  agentSlug?: string
  /** Writes allowed between two reflections before one is due; 10 when the row names none. */
  reflectionEvery?: number
  /** The global store root override; `<HOME>/.mpd/memory` when absent. */
  globalDir?: string
}

/** The two stores one memory call may address: the per-agent workspace store (the default) or the shared global store. */
export type MemoryScope = "workspace" | "global"

/** The four directories one memory store hangs from. */
export interface StoreDirs {
  /** The store's own root: holds the VCS working copy, the auxiliary repositories and the runtime directory. */
  root: string
  /** The VCS working copy whose `memory/` subdirectory holds the markdown entries. */
  repo: string
  /** The non-versioned directory holding the journal (and, globally, the project-archive index). */
  runtime: string
  /** The directory the markdown entries themselves live in. */
  memoryDir: string
}

/** One AGENT's workspace store directories: {@link StoreDirs} plus the slug the store belongs to. */
export interface AgentDirs extends StoreDirs {
  /** The agent slug this workspace store writes under. */
  slug: string
}

/**
 * The current user's home directory, used to derive the GLOBAL store root.
 *
 * `$HOME` is preferred over `os.homedir()` because QA/verification boots run with
 * `HOME=<sandbox>` (T-43), and bun caches `os.homedir()`'s initial value: the API alone would ignore
 * a runtime HOME change and write the real library. This mirrors the workmate row's `homeDir()`.
 *
 * @returns the home directory this process must treat as the user's, `$HOME` first.
 */
export function homeDir(): string {
  return process.env.HOME || homedir()
}

/**
 * The shared GLOBAL store root: `memory.globalDir` when the row/config names one, else
 * `<HOME>/.mpd/memory`.
 *
 * The root is resolved on EVERY call so a sandbox `HOME` is honoured, and it is never cached
 * (AGENTS.md §6). A `memory.globalDir` OUTSIDE `$HOME` is refused on a mutation while `DSH_HOME`
 * marks an isolated boot — that is the shared guard's containment rule (see
 * {@link assertMemoryMutationSandboxed} and the package README).
 *
 * @param config - the effective row config, whose `globalDir` overrides the derived root.
 * @returns the absolute global store root.
 */
export function globalRoot(config: Config): string {
  return config.globalDir ?? join(homeDir(), ".mpd", "memory")
}

/**
 * The global store's directories, COMPUTED without creating anything.
 *
 * A READ must not bootstrap `~/.mpd/memory`: creating a home-scoped directory is a MUTATION, and the
 * shared guard deliberately never covers reads — so the read path uses this pure function and
 * answers "no store yet" instead of creating one.
 *
 * @param config - the effective row config.
 * @returns the global store's four absolute paths.
 */
export function globalDirs(config: Config): StoreDirs {
  /** The global store root. */
  const root = globalRoot(config)
  /** The VCS working copy whose `memory/` subdirectory holds the entries. */
  const repo = join(root, "repo")
  /** The non-versioned directory holding the journal and the project-archive index. */
  const runtime = join(root, "runtime")
  /** The directory the markdown entries themselves live in. */
  const memoryDir = join(repo, "memory")
  return { root, repo, runtime, memoryDir }
}

/**
 * Create the global store's directories on demand (a first global write bootstraps the store).
 *
 * @param config - the effective row config.
 * @returns the global store's four absolute paths, created.
 */
export function ensureGlobalDirs(config: Config): StoreDirs {
  /** The global store's computed paths, created below. */
  const d = globalDirs(config)
  mkdirSync(d.memoryDir, { recursive: true })
  mkdirSync(d.runtime, { recursive: true })
  return d
}

/**
 * The deliberate escape hatch of the shared T-43 guard for THIS row: `=1` lets an isolated boot
 * mutate a home-scoped store on purpose, and the refusal message names it so the fix is discoverable.
 */
export const MEMORY_ALLOW_REAL_HOME_ENV = "MPD_DSH_MEMORY_ALLOW_REAL_HOME"

/**
 * T-43 — refuse a GLOBAL-store MUTATION that would land in the real user home while `DSH_HOME` marks
 * an isolated (QA/verification) boot; reads are never guarded.
 *
 * The PREDICATE lives in the adapter's shared {@link assertHomeMutationSandboxed} (wave W0), because
 * the workmate row guards `~/.mpd/workmate` the same way. This row supplies only its own root, its
 * message prefix and its override variable; the refusal is the adapter's `HomeGuardRefusal`, whose
 * `code`/`status` a transport maps verbatim. The rule it really enforces is CONTAINMENT in `$HOME`:
 * under a `DSH_HOME`-set boot a root OUTSIDE `$HOME` is refused too, even when it is not the real
 * home — which is why the package README states that a `memory.globalDir` outside `$HOME` is refused
 * on a mutation in that boot.
 *
 * @param root - the global store root the mutation would write.
 * @param operation - the operation the refusal names (e.g. "write a global memory entry").
 * @returns nothing; it THROWS the adapter's `HomeGuardRefusal` (403 `real-home-refused`) when it fires.
 */
export function assertMemoryMutationSandboxed(root: string, operation: string): void {
  assertHomeMutationSandboxed({ root, operation, label: "mpd_memory", allowEnv: MEMORY_ALLOW_REAL_HOME_ENV })
}

/**
 * The agent slug a workspace store writes under: `memory.agentSlug` when configured, else derived
 * from the workspace basename.
 *
 * @param config - the effective row config, whose `agentSlug` wins when present.
 * @param workspace - the calling session's workspace root.
 * @returns the slug the workspace store's directory is named after.
 */
export function slugOf(config: Config, workspace: string): string {
  if (config.agentSlug) return config.agentSlug
  /** The workspace directory's own name, which the derived slug is built from. */
  const base = basename(workspace)
  return "agent-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent"
}

/**
 * One agent's workspace store directories: `<workspace>/<memory.dir or ".mpd">/memory/agents/<slug>`,
 * COMPUTED without creating anything (used by the read paths and by the global-write reflection read).
 *
 * @param config - the effective row config.
 * @param workspace - the calling session's workspace root.
 * @returns the workspace store's four absolute paths plus the slug.
 */
export function agentPaths(config: Config, workspace: string): AgentDirs {
  /** The agent slug this session writes under. */
  const slug = slugOf(config, workspace)
  /** The agent's state root, which holds the VCS working copy and the runtime files. */
  const root = join(workspace, config.dir ?? ".mpd", "memory", "agents", slug)
  /** The VCS working copy whose `memory/` subdirectory holds the entries. */
  const repo = join(root, "repo")
  /** The non-versioned directory holding the reflection state and the journal. */
  const runtime = join(root, "runtime")
  /** The directory the markdown entries themselves live in. */
  const memoryDir = join(repo, "memory")
  return { root, repo, runtime, memoryDir, slug }
}

/**
 * Create one agent's workspace store directories and return the four paths every tool call needs.
 *
 * @param config - the effective row config.
 * @param workspace - the calling session's workspace root.
 * @returns the workspace store's four absolute paths plus the slug, created.
 */
export function ensureDirs(config: Config, workspace: string): AgentDirs {
  /** The computed directories this call creates on demand. */
  const d = agentPaths(config, workspace)
  mkdirSync(d.memoryDir, { recursive: true })
  mkdirSync(d.runtime, { recursive: true })
  return d
}

/**
 * The store scope one tool call names.
 *
 * `workspace` is the DEFAULT so no existing call changes meaning; only the literal `global` selects
 * the shared store, and anything else (a typo, a missing argument) stays on the workspace store.
 *
 * @param args - the tool call's argument payload, as the harness validated it.
 * @returns the scope this call addresses.
 */
export function scopeOf(args: unknown): MemoryScope {
  // The harness types a tool call's arguments as `any`; this narrows the ONE field the selector reads
  // instead of trusting the whole payload.
  const a = args !== null && typeof args === "object" ? args as { scope?: unknown } : undefined
  return a?.scope === "global" ? "global" : "workspace"
}

/**
 * The journal path of one store.
 *
 * @param d - the store's directories.
 * @returns the absolute path of its append-only journal.
 */
export function journalPath(d: StoreDirs): string { return join(d.runtime, "journal.jsonl") }

/**
 * Append one journal record to a store's journal, stamped with the instant it was written.
 *
 * @param d - the store whose journal receives the record.
 * @param kind - the record kind (`write`, `archive`, `superseded`, `reflection`, …).
 * @param detail - the record's own fields, merged beside `at` and `kind`.
 * @returns nothing; a write failure propagates like any other IO error of the tool that caused it.
 */
export function appendJournalLine(d: StoreDirs, kind: string, detail: Record<string, unknown>): void {
  appendFileSync(journalPath(d), JSON.stringify({ at: new Date().toISOString(), kind, ...detail }) + "\n")
}

/** Run one VCS command synchronously; a spawn failure is reported as a failure, never thrown. */
function run(cmd: string, args: string[], cwdDir: string): { ok: boolean; out: string } {
  /** The child's own result: exit status, both streams and any spawn error. */
  const r = spawnSync(cmd, args, { cwd: cwdDir, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: process.env })
  /** The child's combined output, which every error message below quotes. */
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  if (r.error) return { ok: false, out: "spawn error: " + String(r.error.message ?? r.error) }
  return { ok: r.status === 0, out }
}

/** Make `repo` a git working copy, initializing it (with a local identity) when it is not one yet. */
function gitEnsure(repo: string): string {
  if (!existsSync(join(repo, ".git"))) {
    /** The `git init` result; a failure here is fatal because the later commits would have no repository. */
    const r = run("git", ["init", "-q"], repo)
    if (!r.ok) throw new Error("mpd-memory: git init failed: " + r.out)
    run("git", ["config", "user.name", "mpd-memory"], repo)
    run("git", ["config", "user.email", "mpd-memory@local"], repo)
  }
  return "git"
}

/** Create the agent's `svn-repo` and check it out into `repo/`, skipping whichever half already exists. */
function svnEnsure(root: string, repo: string): string {
  /** The local repository directory beside the working copy. */
  const svnRepo = join(root, "svn-repo")
  /** The `file://` URL of that repository, spelled the way the svn CLI expects it. */
  const url = "file://" + svnRepo
  if (!existsSync(join(svnRepo, "db"))) {
    /** The `svnadmin create` result; a failure here is fatal because the checkout below would fail anyway. */
    const r = run("svnadmin", ["create", svnRepo], root)
    if (!r.ok) throw new Error("mpd-memory: svnadmin create failed: " + r.out)
  }
  if (!existsSync(join(repo, ".svn"))) {
    mkdirSync(dirname(repo), { recursive: true })
    /** The `svn checkout` result; a failure here is fatal because later commits need a working copy. */
    const r = run("svn", ["checkout", url, repo], dirname(repo))
    if (!r.ok) throw new Error("mpd-memory: svn checkout failed: " + r.out)
  }
  return "svn"
}

/** Initialize whichever VCS backends the configured mode names. */
export function ensureVcs(config: Config, d: { root: string; repo: string }): void {
  /** The effective mode; a row that names none gets git only. */
  const vcs = config.vcs ?? "git"
  if (vcs === "git" || vcs === "both") gitEnsure(d.repo)
  if (vcs === "svn" || vcs === "both") svnEnsure(d.root, d.repo)
}

/** Stage and commit everything in `repo`; returns an error line, or "" when there was nothing to commit. */
function gitCommit(repo: string, msg: string): string {
  /** The `git add -A` result; a failure aborts before the commit is attempted. */
  const a = run("git", ["add", "-A"], repo)
  if (!a.ok) return "git add failed: " + a.out
  /** The commit result; "nothing to commit" is success, because an idempotent write leaves no change. */
  const c = run("git", ["commit", "-q", "-m", msg], repo)
  return c.ok ? "" : (c.out.includes("nothing to commit") ? "" : "git commit failed: " + c.out)
}

/** Add any new working-copy files and commit them; returns an error line, or "" on success. */
function svnCommit(repo: string, msg: string): string {
  /** The `svn add --force` result, deliberately not inspected: the commit below reports the real error. */
  const a = run("svn", ["add", "--force", "--quiet", "."], repo)
  /** The commit result, whose combined output becomes the returned error line when it failed. */
  const c = run("svn", ["commit", "-m", msg], repo)
  return c.ok ? "" : ("svn commit failed: " + c.out)
}

/** Commit through every backend the configured mode names, and collect one error line per backend that failed. */
export function commitAll(config: Config, d: { root: string; repo: string }, msg: string): string[] {
  /** The error lines of the backends that failed; empty means every configured backend committed. */
  const errs: string[] = []
  /** The effective mode; a row that names none gets git only. */
  const vcs = config.vcs ?? "git"
  if (vcs === "git" || vcs === "both") {
    /** The git backend's error line, kept only when it failed. */
    const e = gitCommit(d.repo, msg)
    if (e) errs.push(e)
  }
  if (vcs === "svn" || vcs === "both") {
    /** The svn backend's error line, kept only when it failed. */
    const e = svnCommit(d.repo, msg)
    if (e) errs.push(e)
  }
  return errs
}

/** Split a memory file into its JSON frontmatter and its body; a header-less file reads as empty meta plus the whole text. */
export function parseFrontmatter(file: string): { meta: any; body: string } {
  /** The file's whole text, read once for both the header scan and the body slice. */
  const raw = readFileSync(file, "utf8")
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw }
  /** Offset of the closing `---` line, or -1 when the block is never terminated. */
  const end = raw.indexOf("\n---\n", 4)
  if (end < 0) return { meta: {}, body: raw }
  /** The parsed frontmatter; an unparseable header degrades to `{}` instead of failing the read. */
  let meta: any = {}
  try { meta = JSON.parse(raw.slice(4, end)) } catch { meta = {} }
  return { meta, body: raw.slice(end + 5) }
}

/** Flatten one entry's frontmatter and body into the record the read tool answers with. */
export function normalizeLogEntry(meta: any, file: string, body: string): any {
  return { ...meta, description: meta.description ?? "", content: body.trim(), file: basename(file) }
}

/** Resolve `name` inside `memoryDir`, refusing any name that would escape it. */
export function safeMemoryPath(memoryDir: string, name: string): string {
  // The containment prefix must use the PLATFORM separator: on win32 `resolve()` answers
  // `C:\...\memory`, so a hard-coded "/" suffix made EVERY memory name look like an escape
  // and the whole store was unusable (the C6 backend threw on the first write).
  const base = resolve(memoryDir)
  /** The resolved candidate path, checked against the directory prefix before it is used. */
  const target = resolve(base, name)
  if (!target.startsWith(base + sep)) throw new Error("mpd-memory: path escapes memory dir: " + name)
  return target
}
