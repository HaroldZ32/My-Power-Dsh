// mpd-workmate-plugin: durable, evolving agent library under the user's HOME
// (~/.mpd/workmate). The OMO roster specialists are BASE templates only: a workmate
// is an instantiated copy with an independent name that self-summarizes after each
// work session (persona + independent memory, size-capped to keep spawned context
// bounded) and keeps a short searchable note. Reuse via note-matching — when no note
// matches well enough, initialize a NEW workmate instead of forcing a weak match.
//
// Tools: mpd_workmate_list / mpd_workmate_init / mpd_workmate_spawn /
//        mpd_workmate_reflect / mpd_workmate_match  (+ mpdWorkmate service).
// The library root is deliberately the user's HOME (cross-project), a user-approved
// exception to the workspace-scoped state rule (AGENTS.md §6); QA boots with
// HOME=<sandbox> so tests never touch the real home.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-workmate"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; provide: (n: string, v: any) => void; effect?: (fn: () => unknown, label?: string) => any; on?: (event: string, handler: (...args: any[]) => any) => any; get?: (k: string) => any; [k: string]: any }

// Size caps (bytes): keep every injected workmate context bounded.
export const PERSONA_CAP = 8 * 1024
export const MEMORY_CAP = 8 * 1024
export const NOTE_CAP = 1536
export const MATCH_THRESHOLD = 0.35

const READONLY_DENY = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit"]

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

function textBlock(text: string): any { return [{ type: "text", text }] }

function now(): string { return new Date().toISOString() }

// Home resolution: prefer $HOME (set at process start; QA boots dsh with
// HOME=<sandbox>) over os.homedir() — bun caches os.homedir()'s initial value and
// would ignore a runtime HOME change.
function homeDir(): string { return process.env.HOME || homedir() }

function workmateRoot(): string { return join(homeDir(), ".mpd", "workmate") }
function wmDir(name: string): string { return join(workmateRoot(), sanitizeName(name)) }

/** Instance name → filesystem-safe, lowercase, kebab-ish. */
export function sanitizeName(s: string): string {
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
  const head = Math.floor(max * 0.75)
  const tail = max - head
  return text.slice(0, head) + `\n…[truncated ${text.length - max} chars]…\n` + text.slice(-tail)
}

type Meta = {
  name: string; baseId: string; baseName: string; description: string
  provider: string; model: string; readonly: boolean
  createdAt: string; updatedAt: string; uses: number; lastTask: string | null
}

function readMeta(dir: string): Meta | null {
  try {
    if (!existsSync(join(dir, "meta.json"))) return null
    const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask) }
  } catch { return null }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

function indexPath(): string { return join(workmateRoot(), "index.json") }

function readIndex(): Record<string, { name: string; baseId: string; baseName: string; uses: number; updatedAt: string }> {
  try {
    if (!existsSync(indexPath())) return {}
    const v = JSON.parse(readFileSync(indexPath(), "utf8"))
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}
  } catch { return {} }
}

function writeIndexEntry(meta: Meta): void {
  const idx = readIndex()
  idx[meta.name] = { name: meta.name, baseId: meta.baseId, baseName: meta.baseName, uses: meta.uses, updatedAt: meta.updatedAt }
  writeJson(indexPath(), idx)
}

function readNote(name: string): string {
  try { return readFileSync(join(wmDir(name), "note.md"), "utf8").trim() } catch { return "" }
}

function readMemory(name: string, tailBytes = MEMORY_CAP): string {
  try {
    const t = readFileSync(join(wmDir(name), "memory.md"), "utf8").trim()
    if (t.length <= tailBytes) return t
    return "…[earlier memory trimmed]…\n" + t.slice(-tailBytes)
  } catch { return "" }
}

function readPersona(name: string): string {
  try { return readFileSync(join(wmDir(name), "persona.md"), "utf8").trim() } catch { return "" }
}

/** Auto-generate a short note card: keep the accumulated specialty (previous note or
 * persona head) and append the most recent task, so the note stays a stable matchable
 * identity plus freshness. The base-name prefix is added once only (dedupes re-reflect). */
export function autoNote(meta: Meta, persona: string, memory: string, previous = ""): string {
  const prefix = `${meta.baseName}-based workmate "${meta.name}".`
  const prev = previous.trim()
  const identity = prev === "" ? prefix : (prev.startsWith(prefix) ? prev : `${prefix} ${prev}`)
  const last = memory.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("## ")).pop() || ""
  const task = meta.lastTask ? "Last task: " + meta.lastTask : "No task history yet"
  return capText(`${identity} ${task}.${last ? " " + last.replace(/^##\s*/, "") : ""}`, NOTE_CAP)
}

/** Append a bounded memory entry; evict oldest "## "-blocks that exceed the cap. */
function appendMemory(name: string, entry: string): string {
  const path = join(wmDir(name), "memory.md")
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim()
  const next = (existing ? existing + "\n\n" : "") + entry.trim()
  if (next.length <= MEMORY_CAP) { writeFileSync(path, next + "\n"); return next }
  const blocks = next.split(/\n## /).map((b, i) => (i === 0 ? b : "## " + b)).filter((b) => b.trim().length > 0)
  let kept: string[] = []
  let len = 0
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (len + b.length > MEMORY_CAP) break
    kept.unshift(b)
    len += b.length
  }
  const out = kept.join("\n\n")
  writeFileSync(path, out + "\n")
  return out
}

/** Merge a persona revision; keep the base + latest revisions within the cap. */
function mergePersona(name: string, revision: string): string {
  const path = join(wmDir(name), "persona.md")
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim()
  const merged = capText(existing + (revision ? `\n\n## Persona revision (${now()})\n${revision.trim()}` : ""), PERSONA_CAP)
  writeFileSync(path, merged + "\n")
  return merged
}

function ensureInstance(name: string): { meta: Meta; dir: string } {
  const dir = wmDir(name)
  const meta = readMeta(dir)
  if (!meta) throw new Error(`mpd_workmate: no workmate named "${sanitizeName(name)}" — run mpd_workmate_init first`)
  return { meta, dir }
}

function listInstances(): { name: string; meta: Meta; note: string }[] {
  const root = workmateRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "meta.json")))
    .map((e) => {
      const meta = readMeta(join(root, e.name))!
      return { name: meta.name, meta, note: readNote(meta.name) }
    })
    .sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
}

function unique(xs: string[]): string[] { return [...new Set(xs)] }

/** Deterministic note-matching score (0..1). Not an embedding: keyword overlap + base-name boost. */
export function scoreMatch(task: string, wm: { note: string; baseName: string; description: string; memoryTail: string }): number {
  const taskTokens = unique(tokenize(task))
  if (taskTokens.length === 0) return 0
  const corpus = unique(tokenize(`${wm.note} ${wm.baseName} ${wm.description} ${wm.memoryTail}`))
  const hit = taskTokens.filter((t) => corpus.includes(t)).length
  let score = hit / taskTokens.length
  const baseWords = unique(tokenize(wm.baseName))
  if (baseWords.some((w) => taskTokens.includes(w))) score += 0.15
  return Math.min(1, score)
}

export function apply(ctx: Ctx): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  // The roster BASE templates come from mpdRoles (mpd-roles-plugin). Resolve the
  // service LAZILY inside tool execution (not at apply time): by the time a tool runs,
  // every bundle plugin has applied, so the sibling-provided mpdRoles service is
  // guaranteed visible (same proven pattern as the QA roles probe).
  function rolesService(): any {
    return ctx.get ? ctx.get("mpdRoles") : undefined
  }

  function resolveBase(key: string): { id: string; name: string; description: string; readonly: boolean; provider: string; model: string; persona: string } {
    const roles = rolesService()
    if (!roles) throw new Error("mpd_workmate: mpdRoles service unavailable (mpd-roles-plugin not mounted)")
    const k = String(key ?? "").trim()
    if (!k) throw new Error("mpd_workmate: base required (roster id or normal name)")
    const direct = roles.get(k)
    if (direct) return { id: direct.id, name: direct.name, description: direct.description, readonly: Boolean(direct.readonly), provider: direct.chain?.[0]?.provider ?? "deepseek-official", model: direct.chain?.[0]?.model ?? "", persona: String(direct.persona ?? "") }
    const byName = roles.list().find((r: any) => String(r.name).toLowerCase() === k.toLowerCase())
    if (byName) return { id: byName.id, name: byName.name, description: byName.description, readonly: Boolean(byName.readonly), provider: byName.chain?.[0]?.provider ?? "deepseek-official", model: byName.chain?.[0]?.model ?? "", persona: String(byName.persona ?? "") }
    throw new Error(`mpd_workmate: unknown base "${k}" — run mpd_roles_list (ids or normal names like "Deep Worker")`)
  }

  function initWorkmate(baseKey: string, nameArg: string, noteArg: string) {
    const base = resolveBase(baseKey)
    const given = sanitizeName(nameArg)
    let name = given
    if (!name) {
      const n = listInstances().filter((i) => i.meta.baseId === base.id).length + 1
      name = `${base.id}-${n}`
    }
    const dir = wmDir(name)
    if (existsSync(dir)) throw new Error(`mpd_workmate: "${name}" already exists — pick another name or reuse it via mpd_workmate_spawn`)
    mkdirSync(dir, { recursive: true })
    const meta: Meta = { name, baseId: base.id, baseName: base.name, description: base.description, provider: base.provider, model: base.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null }
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
    writeFileSync(join(dir, "persona.md"), capText(base.persona, PERSONA_CAP) + "\n")
    writeFileSync(join(dir, "memory.md"), "")
    const note = capText(String(noteArg ?? "").trim() || autoNote(meta, base.persona, ""), NOTE_CAP)
    writeFileSync(join(dir, "note.md"), note + "\n")
    writeIndexEntry(meta)
    return { name, baseId: base.id, baseName: base.name, readonly: base.readonly, provider: base.provider, model: base.model, path: dir, note }
  }

  const workmateLibrary = {
    list: () => listInstances().map(({ name, meta, note }) => ({ name, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, updatedAt: meta.updatedAt, note })),
    get: (name: string) => {
      try { const { meta } = ensureInstance(name); return { ...meta, note: readNote(meta.name) } } catch { return null }
    },
    read: (name: string) => {
      try {
        const { meta } = ensureInstance(name)
        return { ...meta, persona: readPersona(meta.name), memory: readMemory(meta.name), note: readNote(meta.name) }
      } catch { return null }
    }
  }
  ctx.provide("mpdWorkmate", workmateLibrary)

  dsh.registerTool({
    name: "mpd_workmate_list",
    description: "List the workmate library (~/.mpd/workmate): each durable evolving agent instance with its base specialist, use count, last-updated time and note summary. Use before delegating a task: if a workmate's note matches well you can reuse it; otherwise initialize a new one.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { workmates: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["workmates", "count"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmates (" + v.count + "):\n" + (v.workmates as any[]).map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " :: " + String(w.note).slice(0, 140)).join("\n") || "(empty)") },
    execute: async () => {
      const list = listInstances().map(({ name, meta, note }) => ({ name, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, note }))
      return { workmates: list, count: list.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_init",
    description: "Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = roster id or normal name (mpd_roles_list). The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.",
    parameters: { type: "object", properties: { base: { type: "string", description: "roster id or normal name (e.g. hephaestus or \"Deep Worker\")" }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseId: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + ")\nnote: " + v.note) },
    execute: async (args: any) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""))
  })

  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a one-shot subagent carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). The subagent must call mpd_workmate_reflect with a self-summary before finishing. For team work, instead add a member whose name equals the workmate name (its persona/memory are injected automatically).",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "")) },
    execute: async (args: any, exec: any) => {
      const { meta } = ensureInstance(String(args?.name ?? ""))
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_workmate_spawn: task required")
      const persona = readPersona(meta.name)
      const memory = readMemory(meta.name)
      const note = readNote(meta.name)
      const prompt = persona
        + "\n\nYour independent memory (bounded, latest first):\n" + (memory || "(empty — you are a fresh workmate)")
        + "\n\nWorkmate note:\n" + (note || "(none)")
        + "\n\nTask: " + task
        + (args?.context ? "\n\nContext:\n" + String(args.context) : "")
        + "\n\nWork with the tools your role requires (read-only workmates must never modify anything)."
        + " BEFORE your final report, call mpd_workmate_reflect with a concise self-summary (task / outcome / what you learned / optional persona_delta / optional new note) so your workmate persona and memory evolve. Then end with ONLY the structured report (name/summary/recommendation/details/evidence)."
      const result = await dsh.spawnAgent({
        label: "workmate-" + meta.name + "-" + randomUUID().slice(0, 8),
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider: meta.provider,
        model: meta.model,
        persona,
        outputSchema: REPORT_SCHEMA,
        ...(meta.readonly ? { toolFilter: { deny: READONLY_DENY } } : {})
      })
      const st = result.structured ?? {}
      return { name: meta.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_reflect",
    description: "Self-evolve a workmate after a completed work session: append a bounded memory entry (oldest evicted past the cap), merge an optional persona revision, regenerate its short note, and bump the use count. Call this at the end of every task a workmate did — the workmate itself is instructed to do so; the caller may also call it on its behalf.",
    parameters: { type: "object", properties: { name: { type: "string" }, task: { type: "string" }, outcome: { type: "string" }, persona_delta: { type: "string", description: "optional persona revision text (merged, capped)" }, note: { type: "string", description: "optional replacement note card; auto-generated if omitted" } }, required: ["name", "task", "outcome"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, uses: { type: "integer" }, personaChars: { type: "integer" }, memoryChars: { type: "integer" }, noteChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock("workmate " + v.name + " reflected (uses=" + v.uses + ", persona " + v.personaChars + "B / memory " + v.memoryChars + "B / note " + v.noteChars + "B)") },
    execute: async (args: any) => {
      const { meta } = ensureInstance(String(args?.name ?? ""))
      const task = String(args?.task ?? "").trim()
      const outcome = String(args?.outcome ?? "").trim()
      if (!task || !outcome) throw new Error("mpd_workmate_reflect: task and outcome required")
      appendMemory(meta.name, `## ${now()} — ${capText(task, 200)}\n${capText(outcome, 1200)}`)
      const persona = mergePersona(meta.name, String(args?.persona_delta ?? "").trim())
      const memory = readMemory(meta.name)
      meta.uses += 1
      meta.lastTask = task
      meta.updatedAt = now()
      writeFileSync(join(wmDir(meta.name), "meta.json"), JSON.stringify(meta, null, 2) + "\n")
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(meta.name)), NOTE_CAP)
      writeFileSync(join(wmDir(meta.name), "note.md"), note + "\n")
      writeIndexEntry(meta)
      return { name: meta.name, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length }
    }
  })

  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a: unknown, v: any) => textBlock((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + "\n" + (v.matches as any[]).map((m) => "- " + m.name + " score=" + m.score.toFixed(2) + " [" + m.baseName + "] :: " + String(m.note).slice(0, 120)).join("\n") + (v.suggestion ? "\n" + v.suggestion : "")) },
    execute: async (args: any) => {
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_workmate_match: task required")
      const matches = listInstances().map(({ name, meta, note }) => {
        const memoryTail = readMemory(name, 600)
        const score = scoreMatch(task, { note, baseName: meta.baseName, description: meta.description, memoryTail })
        return { name, score: Math.round(score * 100) / 100, baseName: meta.baseName, baseId: meta.baseId, readonly: meta.readonly, uses: meta.uses, note }
      }).sort((a, b) => b.score - a.score)
      const best = matches[0]
      const matched = !!best && best.score >= MATCH_THRESHOLD
      return { matched, threshold: MATCH_THRESHOLD, matches, suggestion: matched ? `Delegate to "${best!.name}" (score ${best!.score}).` : "No note matches well enough — initialize a NEW workmate with mpd_workmate_init instead of forcing a weak match." }
    }
  })

  // Web GUI data routes (mirrors the agent-teams web surface pattern): the browser
  // workmate library floater polls /plugins/mpd-workmate/list and POSTs init from the
  // form. Register lazily — try at apply, retry on service binding — so a webless
  // profile stays tool-only; effect-owned.
  let webRegistered = false
  const registerWebSurface = () => {
    if (webRegistered) return
    const webServer = (ctx.get ? ctx.get("webServer") : undefined) ?? (ctx.get ? ctx.get("httpServer") : undefined)
    if (webServer === undefined || typeof ctx.effect !== "function") return
    webRegistered = true
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/list",
      handler: async (_req: any, res: any) => {
        const list = listInstances().map(({ name, meta, note }) => ({ name, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, note }))
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
        res.end(JSON.stringify({ workmates: list }))
      }
    }) as any, "mpd-workmate: list route")
    // Roster route: the sidebar tab's base picker reads the same roster the tools
    // use, so the GUI never asks the user to type a base id from memory.
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/roster",
      handler: async (_req: any, res: any) => {
        const roles = (ctx.get ? ctx.get("mpdRoles") : undefined) as any
        let bases: any[] = []
        try {
          bases = (typeof roles?.list === "function" ? roles.list() : []).map((r: any) => ({ id: String(r.id), name: String(r.name), description: String(r.description ?? ""), readonly: Boolean(r.readonly) }))
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
        const name = String(new URL(String(req.url ?? "/"), "http://dsh.invalid").searchParams.get("name") ?? "").trim()
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
        let raw = ""
        for await (const chunk of req) raw += String(chunk)
        let body: any = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "invalid JSON" })); return }
        try {
          const created = initWorkmate(String(body?.base ?? ""), String(body?.name ?? ""), String(body?.note ?? ""))
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
          res.end(JSON.stringify(created))
        } catch (e: any) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" })
          res.end(JSON.stringify({ error: String(e?.message ?? e) }))
        }
      }
    }) as any, "mpd-workmate: init route")
  }
  registerWebSurface()
  if (typeof ctx.on === "function") {
    ctx.on("internal/service", (n: string) => {
      if (n === "webServer" || n === "httpServer") registerWebSurface()
    })
  }
}
