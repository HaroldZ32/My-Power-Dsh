// C6 mpd-memory-plugin: git/svn-backed memory engine with a reflection state machine.
// Focused port of the upstream project memory-core semantics (base 8c57e46;
// SUL-1.0, inherited from upstream): markdown memory files with frontmatter (description/
// kind/aliases/read_only), journal + facts queues, reflection reducer with
// step-count/manual/dream triggers and reservation state, VCS abstraction with
// git AND svn backends (memory.vcs: git | svn | both; both commits to each).
// Paths: <workspace>/.mpd/memory/agents/<slug>/{repo, runtime/...}.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { basename, dirname, join, resolve, sep } from "node:path"
import { createDshAdapter, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-memory"
export const inject = ["tools"]

type Ctx = { tools: any; get?: (k: string) => any }
type Config = { vcs?: "git" | "svn" | "both"; dir?: string; agentSlug?: string; reflectionEvery?: number }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  const v = (k: string) => svc.get(k)
  const vcs = v("memory.vcs")
  return {
    ...config,
    vcs: vcs === "git" || vcs === "svn" || vcs === "both" ? vcs : config.vcs,
    dir: typeof v("memory.dir") === "string" ? v("memory.dir") : config.dir,
    agentSlug: typeof v("memory.agentSlug") === "string" ? v("memory.agentSlug") : config.agentSlug,
    reflectionEvery: typeof v("memory.reflectionEvery") === "number" ? v("memory.reflectionEvery") : config.reflectionEvery,
  }
}

function textBlock(text: string): any { return [{ type: "text", text }] }

// Explicit config (memory.dir / memory.agentSlug) wins; otherwise the memory store lives
// under the CALLING SESSION's workspace (adapter workspaceRoot), never the dsh process cwd.
function slugOf(config: Config, dsh: DshAdapter, exec?: any): string {
  if (config.agentSlug) return config.agentSlug
  const base = basename(dsh.workspaceRoot(exec))
  return "agent-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent"
}

function bumpRoot(config: Config, slug: string, dsh: DshAdapter, exec?: any): string {
  return join(dsh.workspaceRoot(exec), config.dir ?? ".mpd", "memory", "agents", slug)
}

function ensureDirs(config: Config, dsh: DshAdapter, exec?: any): { root: string; repo: string; runtime: string; memoryDir: string; slug: string } {
  const slug = slugOf(config, dsh, exec)
  const root = bumpRoot(config, slug, dsh, exec)
  const repo = join(root, "repo")
  const runtime = join(root, "runtime")
  const memoryDir = join(repo, "memory")
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  return { root, repo, runtime, memoryDir, slug }
}

function run(cmd: string, args: string[], cwdDir: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd: cwdDir, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: process.env })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  if (r.error) return { ok: false, out: "spawn error: " + String(r.error.message ?? r.error) }
  return { ok: r.status === 0, out }
}

function gitEnsure(repo: string): string {
  if (!existsSync(join(repo, ".git"))) {
    const r = run("git", ["init", "-q"], repo)
    if (!r.ok) throw new Error("mpd-memory: git init failed: " + r.out)
    run("git", ["config", "user.name", "mpd-memory"], repo)
    run("git", ["config", "user.email", "mpd-memory@local"], repo)
  }
  return "git"
}

function svnEnsure(root: string, repo: string): string {
  const svnRepo = join(root, "svn-repo")
  const url = "file://" + svnRepo
  if (!existsSync(join(svnRepo, "db"))) {
    const r = run("svnadmin", ["create", svnRepo], root)
    if (!r.ok) throw new Error("mpd-memory: svnadmin create failed: " + r.out)
  }
  if (!existsSync(join(repo, ".svn"))) {
    mkdirSync(dirname(repo), { recursive: true })
    const r = run("svn", ["checkout", url, repo], dirname(repo))
    if (!r.ok) throw new Error("mpd-memory: svn checkout failed: " + r.out)
  }
  return "svn"
}

function ensureVcs(config: Config, d: { root: string; repo: string }): void {
  const vcs = config.vcs ?? "git"
  if (vcs === "git" || vcs === "both") gitEnsure(d.repo)
  if (vcs === "svn" || vcs === "both") svnEnsure(d.root, d.repo)
}

function gitCommit(repo: string, msg: string): string {
  const a = run("git", ["add", "-A"], repo)
  if (!a.ok) return "git add failed: " + a.out
  const c = run("git", ["commit", "-q", "-m", msg], repo)
  return c.ok ? "" : (c.out.includes("nothing to commit") ? "" : "git commit failed: " + c.out)
}

function svnCommit(repo: string, msg: string): string {
  const a = run("svn", ["add", "--force", "--quiet", "."], repo)
  const c = run("svn", ["commit", "-m", msg], repo)
  return c.ok ? "" : ("svn commit failed: " + c.out)
}

function commitAll(config: Config, d: { root: string; repo: string }, msg: string): string[] {
  const errs: string[] = []
  const vcs = config.vcs ?? "git"
  if (vcs === "git" || vcs === "both") { const e = gitCommit(d.repo, msg); if (e) errs.push(e) }
  if (vcs === "svn" || vcs === "both") { const e = svnCommit(d.repo, msg); if (e) errs.push(e) }
  return errs
}

function parseFrontmatter(file: string): { meta: any; body: string } {
  const raw = readFileSync(file, "utf8")
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw }
  const end = raw.indexOf("\n---\n", 4)
  if (end < 0) return { meta: {}, body: raw }
  let meta: any = {}
  try { meta = JSON.parse(raw.slice(4, end)) } catch { meta = {} }
  return { meta, body: raw.slice(end + 5) }
}

function normalizeLogEntry(meta: any, file: string, body: string): any {
  return { ...meta, description: meta.description ?? "", content: body.trim(), file: basename(file) }
}

function safeMemoryPath(memoryDir: string, name: string): string {
  // The containment prefix must use the PLATFORM separator: on win32 `resolve()` answers
  // `C:\...\memory`, so a hard-coded "/" suffix made EVERY memory name look like an escape
  // and the whole store was unusable (the C6 backend threw on the first write).
  const base = resolve(memoryDir)
  const target = resolve(base, name)
  if (!target.startsWith(base + sep)) throw new Error("mpd-memory: path escapes memory dir: " + name)
  return target
}

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  const cfg = mergedConfig(ctx, config)
  const reflectionEvery = cfg.reflectionEvery ?? 10

  function statePath(d: any): string { return join(d.runtime, "reflection.json") }
  function factsPath(d: any): string { return join(d.runtime, "facts.jsonl") }
  function journalPath(d: any): string { return join(d.runtime, "journal.jsonl") }

  function readReflection(d: any): any {
    try { return JSON.parse(readFileSync(statePath(d), "utf8")) } catch {
      return { steps: 0, reflected_completed_steps: 0, steps_since_last_successful_reflection: 0, reservation: null, triggered: false }
    }
  }
  function writeReflection(d: any, s: any) { writeFileSync(statePath(d), JSON.stringify(s, null, 2)) }

  function appendJournal(d: any, kind: string, detail: any) {
    appendFileSync(journalPath(d), JSON.stringify({ at: new Date().toISOString(), kind, ...detail }) + "\n")
  }

  dsh.registerTool({
    name: "mpd_memory_write",
    description: "Persist a memory entry (markdown file with frontmatter description/kind/aliases/read_only) into the VCS-backed memory store and commit. Increments the reflection step counter; when the reflection threshold is crossed the result announces a reflection is due. kind: note | fact | reflection.",
    parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, kind: { type: "string", enum: ["note", "fact", "reflection"] }, tags: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" } }, required: ["title", "content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { file: { type: "string" }, committedTo: { type: "array", items: { type: "string" } }, reflectionDue: { type: "boolean" }, vcs: { type: "string" }, errors: { type: "array", items: { type: "string" } } }, required: ["file", "vcs"] }, render: (_a: unknown, v: any) => textBlock("memory written: " + v.file + " (vcs=" + v.vcs + " committed=" + v.committedTo.join(",") + " reflectionDue=" + v.reflectionDue + ")") },
    execute: async (args: any, exec: any) => {
      const d = ensureDirs(cfg, dsh, exec)
      ensureVcs(cfg, d)
      const name = String(args?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) + "-" + Date.now().toString(36)
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      const meta: any = { description: String(args?.description ?? args?.title ?? name), kind: String(args?.kind ?? "note"), tags: Array.isArray(args?.tags) ? args.tags : [] }
      if (args?.readOnly === true) meta.read_only = true
      const front = "---\n" + JSON.stringify(meta) + "\n---\n"
      writeFileSync(file, front + String(args?.content) + (String(args?.content).endsWith("\n") ? "" : "\n"))
      const errs = commitAll(cfg, d, "memory: " + name + " (" + meta.kind + ")")
      const ref = readReflection(d)
      ref.steps = (ref.steps ?? 0) + 1
      ref.steps_since_last_successful_reflection = (ref.steps_since_last_successful_reflection ?? 0) + 1
      if ((ref.steps_since_last_successful_reflection ?? 0) >= reflectionEvery) { ref.triggered = true; ref.reservation = { status: "pending", at: new Date().toISOString() } }
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
      const d = ensureDirs(cfg, dsh, exec)
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : []
      let entries: any[] = []
      const kind = args?.kind ? String(args.kind) : null
      const query = args?.query ? String(args.query).toLowerCase() : null
      for (const f of files) {
        const p = join(d.memoryDir, f)
        const { meta, body } = parseFrontmatter(p)
        const e = normalizeLogEntry(meta, f, body)
        if (kind && e.kind !== kind) continue
        if (query) {
          const hay = (e.description + " " + e.content + " " + (e.tags ?? []).join(" ") + " " + (e.aliases ?? []).join(" ")).toLowerCase()
          if (!hay.includes(query)) continue
        }
        entries.push(e)
      }
      const limit = Math.min(Math.max(Number(args?.limit ?? 20) || 20, 1), 50)
      return { entries: entries.slice(0, limit), count: entries.length }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect",
    description: "Inspect the reflection state machine: trigger status, reservation, step counters; returns the due hint when a reflection is pending. Crossing the step-count threshold marks a pending reflection; completeTransition equivalent is mpd_memory_reflect_complete.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { state: { type: "object" }, due: { type: "boolean" } }, required: ["state", "due"] }, render: (_a: unknown, v: any) => textBlock("reflection state: " + JSON.stringify(v.state, null, 1) + (v.due ? "\nREFLECTION DUE" : "")) },
    execute: async (_args: any, exec: any) => {
      const d = ensureDirs(cfg, dsh, exec)
      const s = readReflection(d)
      return { state: s, due: s.triggered === true || s.reservation?.status === "pending" }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect_complete",
    description: "Complete a pending reflection transition: writes the reflection content as a memory entry (kind=reflection), advances reflected_completed_steps / resets steps_since_last_successful_reflection, clears the reservation and commits.",
    parameters: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { completed: { type: "boolean" }, file: { type: "string" } }, required: ["completed", "file"] }, render: (_a: unknown, v: any) => textBlock("reflection completed: " + (v.completed ? "yes" : "no") + " " + v.file) },
    execute: async (args: any, exec: any) => {
      const d = ensureDirs(cfg, dsh, exec)
      ensureVcs(cfg, d)
      const name = "reflection-" + Date.now().toString(36)
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      const meta = { description: String(args?.title ?? "reflection"), kind: "reflection" }
      writeFileSync(file, "---\n" + JSON.stringify(meta) + "\n---\n" + String(args?.content) + "\n")
      commitAll(cfg, d, "memory: reflection " + name)
      const s = readReflection(d)
      s.reflected_completed_steps = (s.reflected_completed_steps ?? 0) + 1
      s.steps_since_last_successful_reflection = 0
      s.triggered = false
      s.reservation = { status: "completed", at: new Date().toISOString() }
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
      const d = ensureDirs(cfg, dsh, exec)
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : []
      const journalLines = existsSync(journalPath(d)) ? readFileSync(journalPath(d), "utf8").split("\n").filter(Boolean).length : 0
      return { vcs: cfg.vcs ?? "git", root: d.root, entries: files.length, journalLines, reflection: readReflection(d) }
    }
  })
}
