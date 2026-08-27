// Plan F / W3 mpd-leaf-plugin: leaf layer on the DSH subagent seam.
//   - mpd_gate_run: the repo gate suite as a tool (bun test / tsgo / qa self-test),
//     used as a leaf's real completion criterion (owner decision Q4: gates into runtime).
//   - mpd_leaf_iterate: fresh-round one-shot leaves (Ralph pattern) with an mpd-* OMO
//     preset as base persona, hard round cap, toolFilter denying re-delegation, and
//     evidence under .mpd/leaf/<id>/.
// Depth/size policy (Q5): the tree is capped by the agent-teams memberMaxDepth config
// (default 3); leaves deny delegation tools so the terminal layer is hard.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

export const name = "mpd-leaf"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; logger?: any; [k: string]: any }
type Config = {
  provider?: string
  model?: string
  maxRounds?: number
  gates?: string[]
  stateDir?: string
  advisorDeny?: string[]
}
type ToolExec = { signal: AbortSignal; agent?: any }
type GateResult = { name: string; ok: boolean; exit: number | null; errors: number; tail: string }

const ADVISOR_BASES = new Set([
  "mpd-oracle", "mpd-librarian", "mpd-explore", "mpd-metis",
  "mpd-momus", "mpd-prometheus", "mpd-multimodal-looker",
])
const ALL_LEAF_DENY = [
  "subagent", "subagent_fork", "workflow",
  "agent_teams_create", "agent_teams_add_member", "agent_teams_remove_member",
  "agent_teams_create_task", "agent_teams_reassign_task", "agent_teams_resume",
  "agent_teams_delete", "agent_teams_approve", "agent_teams_edit_plan",
  "agent_teams_send_message", "agent_teams_status",
  "mpd_leaf_iterate",
]
const ADVISOR_DENY_EXTRA = ["bash", "write", "edit", "str_replace_editor", "create_goal", "update_goal", "mpd_gate_run", "ralph"]

const GATE_DEFS: Record<string, { command: string; timeoutMs: number; allowErrors: number; prependPath?: string }> = {
  "bun-test": { command: "bun test packages --test-timeout 60000", timeoutMs: 300000, allowErrors: 0 },
  "tsgo": { command: "tsgo --noEmit", timeoutMs: 300000, allowErrors: 108, prependPath: ".toolchain/node_modules/.bin" },
  "qa-self": { command: "node skills/dsh-qa/scripts/mount-assert.mjs --self-test", timeoutMs: 300000, allowErrors: 0 },
}

const ROUND_SCHEMA = {
  type: "object",
  properties: {
    round: { type: "integer" },
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    gates: { type: "object", properties: { ran: { type: "boolean" }, passed: { type: "boolean" } }, required: ["ran", "passed"] },
    uncertain: { type: "array", items: { type: "string" } },
  },
  required: ["round", "summary", "changes", "gates", "uncertain"],
  additionalProperties: false,
}

function textBlock(text: string): any { return [{ type: "text", text }] }
function cwd(): string { return process.env.DSH_WORKSPACE_ROOT ?? process.cwd() }
function stateRoot(config: Config): string {
  return resolve(config.stateDir ?? join(cwd(), ".mpd", "leaf"))
}
function pkgRoot(): string {
  // this file lives at <pkg-root>/packages/mpd-leaf-plugin/dist/index.js
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}
function presetDirRoot(): string {
  const home = process.env.DSH_HOME || join(process.env.HOME ?? "/", ".dsh")
  return join(home, ".agent-presets")
}
function extractPersonaText(raw: string): string | undefined {
  const m = raw.match(/text:\s*>-([\s\S]*?)\n- id:/)
  if (!m) return undefined
  return m[1].replace(/^ {6}/gm, "").trim()
}
function presetPersona(basePreset: string): string | undefined {
  const candidates = [
    join(pkgRoot(), "presets", basePreset, "agent.cordis.yml"),
    join(presetDirRoot(), basePreset, "agent.cordis.yml"),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const t = extractPersonaText(readFileSync(p, "utf8"))
    if (t) return t
  }
  return undefined
}

function runGate(name: string, prependPath?: string): GateResult {
  const def = GATE_DEFS[name]
  if (!def) return { name, ok: false, exit: null, errors: 0, tail: "unknown gate: " + name }
  const env: Record<string, string> = { ...(process.env as any) }
  if (def.prependPath ?? prependPath) {
    const p = join(cwd(), def.prependPath ?? prependPath ?? "")
    env.PATH = p + (process.platform === "win32" ? ";" : ":") + (env.PATH ?? "")
  }
  const r = spawnSync(def.command, [], { shell: true, cwd: cwd(), env, encoding: "utf8", timeout: def.timeoutMs, maxBuffer: 16 * 1024 * 1024 })
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).toString()
  const errors = (out.match(/error TS\d+/g) ?? []).length
  const ok = r.status === 0 || (name === "tsgo" && errors <= def.allowErrors)
  return { name, ok, exit: r.status, errors, tail: out.slice(-1800) }
}

function runGates(names?: string[]): GateResult[] {
  const list = (names && names.length > 0 ? names : Object.keys(GATE_DEFS)).slice(0, 6)
  return list.map((n) => runGate(n))
}

function writeEvidence(root: string, id: string, data: unknown): string {
  mkdirSync(root, { recursive: true })
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const f = join(dir, "run.json")
  writeFileSync(f, JSON.stringify(data, null, 2))
  return f
}

export function apply(ctx: Ctx, config: Config = {}): void {
  const provider = config.provider ?? "deepseek-official"
  const model = config.model ?? "deepseek-v4-pro"
  const maxRounds = Math.min(Math.max(config.maxRounds ?? 3, 1), 12)
  const defaultGates = config.gates ?? ["bun-test"]

  ctx.tools.register({
    name: "mpd_gate_run",
    description: "Run the repository gate suite (bun test packages / tsgo with the 108-error debt baseline / dsh-qa self-test) in the current project and report structured results. Use as a leaf's completion criterion.",
    parameters: {
      type: "object",
      properties: { gates: { type: "array", items: { type: "string", enum: Object.keys(GATE_DEFS) } } },
      required: [],
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, results: { type: "array", items: { type: "object" } } }, required: ["ok", "results"] },
      render: (_a: unknown, v: any) => textBlock("gates ok=" + String(v.ok) + "\n" + (v.results ?? []).map((g: any) => "- " + String(g.name) + " ok=" + String(g.ok) + " exit=" + String(g.exit) + " errors=" + String(g.errors)).join("\n")),
    },
    execute: async (args: any) => {
      const results = runGates(args?.gates)
      const ok = results.every((g) => g.ok)
      if (ctx.logger?.info) ctx.logger.info("mpd_gate_run ok=" + ok + " results=" + JSON.stringify(results.map((g) => ({ name: g.name, ok: g.ok, exit: g.exit, errors: g.errors }))))
      return { ok, results: results.map((g) => ({ name: g.name, ok: g.ok, exit: g.exit, errors: g.errors, tail: g.tail })) }
    },
  })

  ctx.tools.register({
    name: "mpd_leaf_iterate",
    description: "Run a leaf task in fresh one-shot rounds (Ralph pattern) with an mpd-* OMO preset as the leaf base persona. Each round is a new child with compact prior-round context; the loop exits when the real project gates pass or maxRounds is hit. Leaves deny re-delegation (toolFilter).",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        basePreset: { type: "string" },
        maxRounds: { type: "integer" },
        context: { type: "string" },
        requireGate: { type: "boolean" },
      },
      required: ["objective", "basePreset"],
    },
    output: {
      schema: { type: "object", properties: { leafId: { type: "string" }, rounds: { type: "integer" }, done: { type: "boolean" }, gatePassed: { type: "boolean" }, evidenceFile: { type: "string" }, roundSummaries: { type: "array", items: { type: "string" } } }, required: ["leafId", "rounds", "done", "gatePassed", "roundSummaries"] },
      render: (_a: unknown, v: any) => textBlock("leaf " + v.leafId + " rounds=" + v.rounds + " done=" + v.done + " gatePassed=" + v.gatePassed + "\n" + (v.roundSummaries ?? []).map((s: string) => "- " + s).join("\n") + "\nevidence: " + v.evidenceFile),
    },
    execute: async (args: any, exec: ToolExec) => {
      const objective = String(args.objective ?? "")
      const basePreset = String(args.basePreset ?? "")
      if (!objective || !basePreset.startsWith("mpd-")) throw new Error("mpd_leaf_iterate: objective and basePreset (mpd-*) are required")
      const persona = presetPersona(basePreset)
      if (!persona) throw new Error("mpd_leaf_iterate: persona text for basePreset '" + basePreset + "' not found in presets/ or $DSH_HOME/.agent-presets")
      const advisor = ADVISOR_BASES.has(basePreset)
      const rounds = Math.min(Math.max(args?.maxRounds ?? maxRounds, 1), 12)
      const requireGate = Boolean(args?.requireGate ?? !advisor)
      const deny = [...ALL_LEAF_DENY, ...(advisor ? (config.advisorDeny ?? ADVISOR_DENY_EXTRA) : [])]
      const id = "leaf-" + randomUUID().slice(0, 8)
      const root = stateRoot(config)
      const records: any[] = []
      const summaries: string[] = []
      let gatePassed = false

      for (let round = 1; round <= rounds; round++) {
        const prior = records.slice(-2).map((rec) => {
          const s = rec.structured ?? {}
          return "r" + String(rec.round) + ": " + String(s.summary ?? (rec.tail ? String(rec.tail).slice(0, 200) : "no summary"))
        }).join("\n")
        const prompt = [
          "ROUND " + round + " / " + rounds + " of a single-project leaf iteration.",
          "BASE PERSONA (mpd-* OMO preset): " + basePreset,
          "",
          persona,
          "",
          "OBJECTIVE (single project, this workspace):",
          objective,
          "",
          args?.context ? "CAPTAIN CONTEXT:\n" + String(args.context) : "",
          prior ? "PRIOR ROUNDS (compact):\n" + prior : "",
          "",
          advisor
            ? "Advisory leaf: read-only work. Do not modify files. Answer with evidence and citations; end with the structured report."
            : "Executor leaf: do the work IN THIS PROJECT, then call mpd_gate_run before finishing; if any gate fails, fix and re-run (bounded by this round). Stop when gates pass.",
          "",
          "End with ONLY the structured report {round, summary, changes, gates:{ran,passed}, uncertain}.",
        ].filter(Boolean).join("\n")

        let run: any
        try {
          run = await ctx.subagents.start("spawn", {
            label: id + "-r" + round,
            prompt: textBlock(prompt),
            parent: exec.agent,
            signal: exec.signal,
            agentOptions: { provider, model },
            persona,
            toolFilter: { deny },
            outputSchema: ROUND_SCHEMA,
          })
          const result = await run.result
          const structured = (result.structured ?? {}) as any
          const tail = (result.output ?? []).map((b: any) => b.text ?? "").join("").slice(-1500)
          const gates = requireGate ? runGates(defaultGates) : []
          const ok = !requireGate || gates.every((g) => g.ok)
          records.push({ round, structured, tail, gates: gates.map((g) => ({ name: g.name, ok: g.ok, errors: g.errors })), ok })
          summaries.push("r" + round + ": " + String(structured.summary ?? "no summary") + (ok ? " [gates PASS]" : " [gates FAIL]"))
          if (ok) { gatePassed = true; break }
        } catch (e) {
          records.push({ round, error: String(e) })
          summaries.push("r" + round + ": ERROR " + String(e).slice(0, 160))
          if (round === rounds) break
        } finally {
          if (run?.dispose) { try { await run.dispose() } catch { /* quiesce */ } }
        }
      }

      const evidenceFile = writeEvidence(root, id, { id, objective, basePreset, advisor, maxRounds: rounds, requireGate, gatePassed, records, updatedAt: new Date().toISOString() })
      return {
        leafId: id,
        rounds: records.length,
        done: gatePassed || records.length >= rounds,
        gatePassed,
        roundSummaries: summaries,
        evidenceFile,
      }
    },
  })
}
