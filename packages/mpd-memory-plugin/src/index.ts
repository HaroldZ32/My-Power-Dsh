// C6 mpd-memory-plugin: git/svn-backed memory engine with a reflection state machine.
// mpd-owned code: the engine's semantics — markdown memory files with frontmatter (description/
// kind/aliases/read_only), a journal plus a facts queue, and a step-count reflection reducer —
// are RE-EXPRESSED here from the DOCUMENTED BEHAVIOUR of the upstream project `memory-core`
// (base 8c57e46, SUL-1.0); no upstream source is translated.
// HISTORY: an earlier draft of the reducer mirrored upstream's state-machine vocabulary
// (`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`,
// `completeTransition`); de-omo wave F replaced it with the vocabulary below and left a READ-ONLY
// compatibility path for records already persisted under those names.
// OURS, not upstream's: the svn backend and the VCS abstraction over git AND svn
// (memory.vcs: git | svn | both; `both` commits to each). Upstream `memory-core` is Git-only —
// its `GitMemoryRepo` has no svn counterpart.
// Paths: <workspace>/.mpd/memory/agents/<slug>/{repo, runtime/...}.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { basename, dirname, join, resolve, sep } from "node:path"
import { DSH_SEAM_TOOLS, dshSeamInject, type DshAdapter, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-memory"
/** The tool registry the five `mpd_memory_*` tools are registered into, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the row context this plugin reads: the tool registry plus the optional runtime config service. */
type Ctx = { tools: any; get?: (k: string) => any }
/** The row's config keys: the VCS mode, the state-root override, the agent slug and the reflection threshold. */
type Config = { vcs?: "git" | "svn" | "both"; dir?: string; agentSlug?: string; reflectionEvery?: number }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  /** The mounted runtime config service, when the composition has one. */
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  /** Dotted-key reader bound to the service; its answer is exactly what the service's own `get` returns. */
  const v = (k: string): ReturnType<NonNullable<typeof svc>["get"]> => svc.get(k)
  /** The configured VCS mode, accepted only when it names one of the three known modes. */
  const vcs = v("memory.vcs")
  return {
    ...config,
    vcs: vcs === "git" || vcs === "svn" || vcs === "both" ? vcs : config.vcs,
    dir: typeof v("memory.dir") === "string" ? v("memory.dir") : config.dir,
    agentSlug: typeof v("memory.agentSlug") === "string" ? v("memory.agentSlug") : config.agentSlug,
    reflectionEvery: typeof v("memory.reflectionEvery") === "number" ? v("memory.reflectionEvery") : config.reflectionEvery,
  }
}


// Explicit config (memory.dir / memory.agentSlug) wins; otherwise the memory store lives
// under the CALLING SESSION's workspace (adapter workspaceRoot), never the dsh process cwd.
function slugOf(config: Config, dsh: DshAdapter, exec?: any): string {
  if (config.agentSlug) return config.agentSlug
  /** The workspace directory's own name, which the derived slug is built from. */
  const base = basename(dsh.workspaceRoot(exec))
  return "agent-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent"
}

/** The agent's private state root: `<workspace>/<config.dir or ".mpd">/memory/agents/<slug>`. */
function bumpRoot(config: Config, slug: string, dsh: DshAdapter, exec?: any): string {
  return join(dsh.workspaceRoot(exec), config.dir ?? ".mpd", "memory", "agents", slug)
}

/** Create the agent's state directories and return the four paths every tool call needs. */
function ensureDirs(config: Config, dsh: DshAdapter, exec?: any): { root: string; repo: string; runtime: string; memoryDir: string; slug: string } {
  /** The agent slug this session writes under. */
  const slug = slugOf(config, dsh, exec)
  /** The agent's state root, which holds the VCS working copy and the runtime files. */
  const root = bumpRoot(config, slug, dsh, exec)
  /** The VCS working copy whose `memory/` subdirectory holds the entries. */
  const repo = join(root, "repo")
  /** The non-versioned directory holding the reflection state and the journal. */
  const runtime = join(root, "runtime")
  /** The directory the markdown entries themselves live in. */
  const memoryDir = join(repo, "memory")
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  return { root, repo, runtime, memoryDir, slug }
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
function ensureVcs(config: Config, d: { root: string; repo: string }): void {
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
function commitAll(config: Config, d: { root: string; repo: string }, msg: string): string[] {
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
function parseFrontmatter(file: string): { meta: any; body: string } {
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
function normalizeLogEntry(meta: any, file: string, body: string): any {
  return { ...meta, description: meta.description ?? "", content: body.trim(), file: basename(file) }
}

/** Resolve `name` inside `memoryDir`, refusing any name that would escape it. */
function safeMemoryPath(memoryDir: string, name: string): string {
  // The containment prefix must use the PLATFORM separator: on win32 `resolve()` answers
  // `C:\...\memory`, so a hard-coded "/" suffix made EVERY memory name look like an escape
  // and the whole store was unusable (the C6 backend threw on the first write).
  const base = resolve(memoryDir)
  /** The resolved candidate path, checked against the directory prefix before it is used. */
  const target = resolve(base, name)
  if (!target.startsWith(base + sep)) throw new Error("mpd-memory: path escapes memory dir: " + name)
  return target
}

/** One reflection claim: `due` while the completion is still owed, and `at` the instant it was raised or settled. */
type PendingReflection = { due: boolean; at: string }

/** The reflection state persisted at `<runtime>/reflection.json`: the write counter, the completion counter and the claim. */
type ReflectionState = {
  /** Every memory write recorded for this agent, ever. */
  steps: number
  /** How many reflections have been completed. */
  reflectionsCompleted: number
  /** Writes since the last completed reflection; crossing `reflectionEvery` raises a claim. */
  stepsSinceReflection: number
  /** The outstanding claim, or null when none is open. */
  pendingReflection: PendingReflection | null
  /** True from the threshold crossing until the completion that settles the claim. */
  triggered: boolean
}

/** The state of an agent that has never written: every counter zero and no claim outstanding. */
function initialState(): ReflectionState {
  return { steps: 0, reflectionsCompleted: 0, stepsSinceReflection: 0, pendingReflection: null, triggered: false }
}

/**
 * Put a parsed state record under the field names this package writes today.
 *
 * THE COMPATIBILITY BOUND: records persisted before de-omo wave F carry the earlier draft's names
 * (`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`) and real ones
 * exist on disk, so a legacy name is READ here and never written again — the next `writeReflection`
 * persists the current names only.
 *
 * @param raw - the parsed state file, of unknown shape because it may predate this vocabulary.
 * @returns the state under the current names; an unreadable record degrades to the initial state.
 */
function adoptLegacyState(raw: any): ReflectionState {
  /** The parsed record, or an empty stand-in when the file held a non-object. */
  const s: any = raw && typeof raw === "object" ? raw : {}
  /** The pre-wave-F claim object, mapped below when the current name is absent. */
  const legacyClaim = s.reservation
  return {
    steps: s.steps ?? 0,
    reflectionsCompleted: s.reflectionsCompleted ?? s.reflected_completed_steps ?? 0,
    stepsSinceReflection: s.stepsSinceReflection ?? s.steps_since_last_successful_reflection ?? 0,
    pendingReflection: s.pendingReflection !== undefined
      ? (s.pendingReflection ?? null)
      : legacyClaim == null || typeof legacyClaim !== "object"
        ? null
        : { due: legacyClaim.status === "pending", at: String(legacyClaim.at ?? "") },
    triggered: s.triggered ?? false
  }
}

/**
 * Register the five memory tools and the reflection state machine behind them.
 *
 * @param ctx - the row context; the runtime config service is read here, the workspace root per call.
 * @param config - row overrides for the VCS mode, the state root, the slug and the reflection threshold.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  /** The effective config: the row's own keys, overlaid by the runtime config layer. */
  const cfg = mergedConfig(ctx, config)
  /** How many writes may pass between two reflections before the machine marks one due. */
  const reflectionEvery = cfg.reflectionEvery ?? 10

  /** Path of the reflection state file inside the agent's runtime directory. */
  function statePath(d: any): string { return join(d.runtime, "reflection.json") }
  /** Path of the append-only facts queue; declared for the store's documented layout, no tool writes it yet. */
  function factsPath(d: any): string { return join(d.runtime, "facts.jsonl") }
  /** Path of the append-only journal, one JSON record per tool effect. */
  function journalPath(d: any): string { return join(d.runtime, "journal.jsonl") }

  /** Read the reflection state, adopting a record persisted under the pre-wave-F names; a missing or unparseable file reads as the initial state, so the machine can always be driven. */
  function readReflection(d: any): ReflectionState {
    try { return adoptLegacyState(JSON.parse(readFileSync(statePath(d), "utf8"))) } catch { return initialState() }
  }
  /** Persist the reflection state, pretty-printed so a human can read the counters. */
  function writeReflection(d: any, s: any): void { writeFileSync(statePath(d), JSON.stringify(s, null, 2)) }

  /** Append one journal record, stamped with the instant it was written. */
  function appendJournal(d: any, kind: string, detail: any): void {
    appendFileSync(journalPath(d), JSON.stringify({ at: new Date().toISOString(), kind, ...detail }) + "\n")
  }

  dsh.registerTool({
    name: "mpd_memory_write",
    description: "Persist a memory entry (markdown file with frontmatter description/kind/aliases/read_only) into the VCS-backed memory store and commit. Increments the reflection step counter; when the reflection threshold is crossed the result announces a reflection is due. kind: note | fact | reflection.",
    parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, kind: { type: "string", enum: ["note", "fact", "reflection"] }, tags: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" } }, required: ["title", "content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { file: { type: "string" }, committedTo: { type: "array", items: { type: "string" } }, reflectionDue: { type: "boolean" }, vcs: { type: "string" }, errors: { type: "array", items: { type: "string" } } }, required: ["file", "vcs"] }, render: (_a: unknown, v: any) => textBlock("memory written: " + v.file + " (vcs=" + v.vcs + " committed=" + v.committedTo.join(",") + " reflectionDue=" + v.reflectionDue + ")") },
    execute: async (args: any, exec: any) => {
      /** The agent's state directories, created on demand so a first write works in an empty workspace. */
      const d = ensureDirs(cfg, dsh, exec)
      ensureVcs(cfg, d)
      /** The entry's file stem: the slugged title plus a base-36 timestamp, so equal titles never collide. */
      const name = String(args?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) + "-" + Date.now().toString(36)
      /** The entry's absolute path, containment-checked against the memory directory. */
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      /** The frontmatter record: description falls back to the title, kind to `note`, tags to an empty list. */
      const meta: any = { description: String(args?.description ?? args?.title ?? name), kind: String(args?.kind ?? "note"), tags: Array.isArray(args?.tags) ? args.tags : [] }
      if (args?.readOnly === true) meta.read_only = true
      /** The serialized frontmatter block the file starts with. */
      const front = "---\n" + JSON.stringify(meta) + "\n---\n"
      writeFileSync(file, front + String(args?.content) + (String(args?.content).endsWith("\n") ? "" : "\n"))
      /** The error lines of the backends that failed to commit this entry; a commit failure never fails the write. */
      const errs = commitAll(cfg, d, "memory: " + name + " (" + meta.kind + ")")
      /** The reflection state after this write's step increment. */
      const ref = readReflection(d)
      ref.steps = (ref.steps ?? 0) + 1
      ref.stepsSinceReflection = (ref.stepsSinceReflection ?? 0) + 1
      if ((ref.stepsSinceReflection ?? 0) >= reflectionEvery) { ref.triggered = true; ref.pendingReflection = { due: true, at: new Date().toISOString() } }
      writeReflection(d, ref)
      appendJournal(d, "write", { file: basename(file), kind: meta.kind, vcs: cfg.vcs ?? "git" })
      return { file, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: ref.triggered === true, vcs: cfg.vcs ?? "git", errors: errs }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_read",
    description: "Read memory entries by optional kind filter and/or a substring query (matched against description/content/tags/aliases), limited to `limit` entries; returns normalized entries with frontmatter metadata and body content.",
    parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { entries: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["entries", "count"] }, render: (_a: unknown, v: any) => textBlock("memory entries: " + v.count + "\n" + v.entries.map((e: any) => "- [" + (e.kind ?? "note") + "] " + e.description + ": " + e.content.slice(0, 200)).join("\n")) },
    execute: async (args: any, exec: any) => {
      /** The agent's state directories, created on demand so a read of a fresh workspace answers an empty list. */
      const d = ensureDirs(cfg, dsh, exec)
      /** The entry filenames in the memory directory; a directory that does not exist yet reads as none. */
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : []
      /** The entries that pass both filters, in directory order. */
      let entries: any[] = []
      /** The requested kind filter, or null when the caller wants every kind. */
      const kind = args?.kind ? String(args.kind) : null
      /** The requested substring query, lower-cased once for the per-entry comparison. */
      const query = args?.query ? String(args.query).toLowerCase() : null
      for (const f of files) {
        /** The entry's absolute path. */
        const p = join(d.memoryDir, f)
        /** The entry's frontmatter and body, split out of the file. */
        const { meta, body } = parseFrontmatter(p)
        /** The normalized record both filters below run against. */
        const e = normalizeLogEntry(meta, f, body)
        if (kind && e.kind !== kind) continue
        if (query) {
          /** The searchable text: description, content, tags and aliases folded into one lower-cased haystack. */
          const hay = (e.description + " " + e.content + " " + (e.tags ?? []).join(" ") + " " + (e.aliases ?? []).join(" ")).toLowerCase()
          if (!hay.includes(query)) continue
        }
        entries.push(e)
      }
      /** The page size actually applied: the caller's `limit`, clamped to 1..50 and defaulting to 20. */
      const limit = Math.min(Math.max(Number(args?.limit ?? 20) || 20, 1), 50)
      return { entries: entries.slice(0, limit), count: entries.length }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect",
    description: "Inspect the reflection state machine: trigger status, the pending claim and the step counters; returns the due hint when a reflection is owed. Crossing the step-count threshold raises the claim; `mpd_memory_reflect_complete` settles it.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { state: { type: "object" }, due: { type: "boolean" } }, required: ["state", "due"] }, render: (_a: unknown, v: any) => textBlock("reflection state: " + JSON.stringify(v.state, null, 1) + (v.due ? "\nREFLECTION DUE" : "")) },
    execute: async (_args: any, exec: any) => {
      /** The agent's state directories, so a status read on a fresh workspace still answers the initial state. */
      const d = ensureDirs(cfg, dsh, exec)
      /** The current reflection state, as persisted by the last write or completion. */
      const s = readReflection(d)
      return { state: s, due: s.triggered === true || s.pendingReflection?.due === true }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect_complete",
    description: "Complete the reflection this agent owes: writes the reflection content as a memory entry (kind=reflection), advances reflectionsCompleted, resets stepsSinceReflection, settles the pending claim and commits.",
    parameters: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { completed: { type: "boolean" }, file: { type: "string" } }, required: ["completed", "file"] }, render: (_a: unknown, v: any) => textBlock("reflection completed: " + (v.completed ? "yes" : "no") + " " + v.file) },
    execute: async (args: any, exec: any) => {
      /** The agent's state directories, created on demand so a reflection can complete in a fresh workspace. */
      const d = ensureDirs(cfg, dsh, exec)
      /** The reflection state as persisted, and the value this transition mutates when it is legal. */
      const s = readReflection(d)
      // THE PRECONDITION: `mpd_memory_reflect` reports `due` under exactly this predicate. Without it a
      // completion ran with nothing owed: it wrote a reflection entry, bumped
      // `reflectionsCompleted`, zeroed `stepsSinceReflection` and stamped
      // `pendingReflection: {due:false}`, stranding the counters of a machine that never triggered.
      if (s.triggered !== true && s.pendingReflection?.due !== true) {
        // The message renders what the predicate above has already established: `triggered` is exactly
        // false here, so the only distinction left is "a claim exists but is settled" vs "no claim".
        throw new Error("mpd-memory: no reflection is due — refusing to complete (triggered=" + String(s.triggered) + ", pendingReflection=" + (s.pendingReflection?.due === false ? "settled" : "none") + ", stepsSinceReflection=" + String(s.stepsSinceReflection ?? 0) + "); call mpd_memory_reflect to inspect the state machine.")
      }
      ensureVcs(cfg, d)
      /** The reflection entry's file stem: a fixed prefix plus a base-36 timestamp. */
      const name = "reflection-" + Date.now().toString(36)
      /** The reflection entry's absolute path, containment-checked against the memory directory. */
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      /** The reflection entry's frontmatter: the caller's title, or the generic `reflection`. */
      const meta = { description: String(args?.title ?? "reflection"), kind: "reflection" }
      writeFileSync(file, "---\n" + JSON.stringify(meta) + "\n---\n" + String(args?.content) + "\n")
      commitAll(cfg, d, "memory: reflection " + name)
      // The state read at the top of this call, advanced by one completed reflection: the claim is
      // settled and the step counter re-armed for the next threshold.
      s.reflectionsCompleted = (s.reflectionsCompleted ?? 0) + 1
      s.stepsSinceReflection = 0
      s.triggered = false
      s.pendingReflection = { due: false, at: new Date().toISOString() }
      writeReflection(d, s)
      appendJournal(d, "reflection", { file: basename(file) })
      return { completed: true, file }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_status",
    description: "Show memory engine status: vcs mode, repo paths, entry count, journal/facts line counts, reflection counters.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { vcs: { type: "string" }, root: { type: "string" }, entries: { type: "integer" }, journalLines: { type: "integer" }, reflection: { type: "object" } }, required: ["vcs", "root", "entries"] }, render: (_a: unknown, v: any) => textBlock("memory status: vcs=" + v.vcs + " root=" + v.root + " entries=" + v.entries + " journal=" + v.journalLines + "\nreflection: " + JSON.stringify(v.reflection)) },
    execute: async (_args: any, exec: any) => {
      /** The agent's state directories; a fresh workspace reports zero entries rather than failing. */
      const d = ensureDirs(cfg, dsh, exec)
      /** The entry filenames in the memory directory, counted but not read. */
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : []
      /** Non-empty journal lines, i.e. the number of recorded effects; a missing journal counts as zero. */
      const journalLines = existsSync(journalPath(d)) ? readFileSync(journalPath(d), "utf8").split("\n").filter(Boolean).length : 0
      return { vcs: cfg.vcs ?? "git", root: d.root, entries: files.length, journalLines, reflection: readReflection(d) }
    }
  })
}
