// mpd-roles-plugin: the OMO-origin agents live as a SPECIALIST ROSTER, not as
// presets. Each role = { stable id (chain key), normal display name, persona
// text, DeepSeek model chain, read-only discipline }. Consumers: mpd_role_spawn
// (one-shot specialist from anywhere), mpd_role_persona (text for spawn
// surfaces like agent_teams_add_member), and the mpdRoles service (mpd-modelchain
// chain lookup). Team mode lives in the adopted dsh-agent-teams plugin, whose
// normal-named member templates are configured in the bundle patch.
// Persona texts are assets under personas/<id>.md resolved relative to this
// plugin's package location.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { ROLES, ROLE_BY_ID, type MpdRoleSpec } from "./roles.data.ts"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-roles"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; provide: (n: string, v: any, check?: any) => void; get?: (k: string) => any; [k: string]: any }
type Config = { personasDir?: string }

// Every entry must be a tool this profile actually registers: the harness
// validates the WHOLE deny list at spawn time and rejects the child when any
// name is unknown, so one dead entry breaks EVERY read-only spawn. That was the
// defect here: two legacy editor patch-row names were listed although their row
// is not composed into this profile. The remaining names are live-registered and
// deliberately kept — `bash` can write files, so it stays denied (that is the
// read-only guarantee, not an oversight). roles.test.ts pins all three
// properties: the coverage, the absence of the dead names, and parity with the
// workmate plugin's list.
export const READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename",
]

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string" },
    summary: { type: "string" },
    recommendation: { type: "string" },
    details: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["role", "summary"],
  additionalProperties: false
}

function textBlock(text: string): any { return [{ type: "text", text }] }

export function pkgRoot(): string {
  // this file lives at <pkg-root>/packages/mpd-roles-plugin/dist/index.js
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

/** Resolve a role key: canonical id, modelchain-style chain key, or legacy "mpd-<id>" preset alias. */
export function normalizeRoleKey(key: string): string | null {
  const k = String(key ?? "").trim()
  if (!k) return null
  if (ROLE_BY_ID[k]) return k
  if (k.startsWith("mpd-") && ROLE_BY_ID[k.slice(4)]) return k.slice(4)
  if (k === "sisyphusJunior") return "sisyphus-junior"
  if (k === "multimodalLooker") return "multimodal-looker"
  return null
}

function personaPath(config: Config, spec: MpdRoleSpec): string {
  return config.personasDir
    ? join(resolve(config.personasDir), spec.id + ".md")
    : join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md")
}

export function readPersona(config: Config, spec: MpdRoleSpec): string {
  const p = personaPath(config, spec)
  try { if (existsSync(p)) { const t = readFileSync(p, "utf8").trim(); if (t) return t } } catch { /* fall through */ }
  return spec.description
}

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  ctx.provide("mpdRoles", {
    list: () => ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: readPersona(config, r) })),
    get: (key: string) => {
      const id = normalizeRoleKey(key)
      if (!id) return null
      const spec = ROLE_BY_ID[id]
      return { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: readPersona(config, spec) }
    }
  })

  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster (ids → normal display names): Architect(oracle), Researcher(librarian), Planner(prometheus), Deep Worker(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), Plan Reviewer(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). Use before mpd_role_spawn. Team mode uses the dsh-agent-teams profiles (agent_teams_create profile=mpd).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["roles", "count"] }, render: (_a: unknown, v: any) => textBlock("roster (" + v.count + "):\n" + v.roles.map((r: any) => "- " + r.id + " [" + r.model + (r.readonly ? " readonly" : "") + "] " + r.description).join("\n")) },
    execute: async () => ({ roles: ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null })), count: ROLES.length })
  })

  dsh.registerTool({
    name: "mpd_role_spawn",
    description: "Spawn one specialist as a one-shot subagent with its roster persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Use ids from mpd_roles_list: Architect(oracle), Researcher(librarian), Planner(prometheus), Deep Worker(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), Plan Reviewer(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). For multi-member team work prefer the adopted dsh-agent-teams protocol (agent_teams_create + agent_teams_add_member), not repeated one-shot spawns.",
    parameters: { type: "object", properties: { role: { type: "string", description: "roster role id (mpd_roles_list)" }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" }, model: { type: "string", description: "optional model override (default: the role's primary route)" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a: unknown, v: any) => textBlock("role " + v.role + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "") + (v.evidence?.length ? "\nevidence:\n- " + v.evidence.join("\n- ") : "")) },
    execute: async (args: any, exec: any) => {
      const id = normalizeRoleKey(String(args?.role ?? ""))
      if (!id) throw new Error("mpd_role_spawn: unknown role '" + String(args?.role) + "' — call mpd_roles_list first")
      const spec = ROLE_BY_ID[id]
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_role_spawn: task required")
      const persona = readPersona(config, spec)
      const provider = spec.chain[0]?.provider ?? "deepseek-official"
      const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : spec.chain[0]?.model
      const prompt = persona + "\n\nTask: " + task + (args?.context ? "\n\nContext:\n" + String(args.context) : "") + "\n\nWork with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence)."
      const result = await dsh.spawnAgent({
        label: "role-" + id + "-" + randomUUID().slice(0, 8),
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider,
        model,
        persona,
        outputSchema: REPORT_SCHEMA,
        ...(spec.readonly ? { toolFilter: { deny: READONLY_DENY } } : {})
      })
      const st = result.structured ?? {}
      return { role: id, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null }
    }
  })

  dsh.registerTool({
    name: "mpd_role_persona",
    description: "Return the full persona text of one roster role. Use it when a spawn surface takes the persona as TEXT (e.g. agent_teams_add_member persona=...), so the member gets the real role instructions instead of a bare id.",
    parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a: unknown, v: any) => textBlock("persona " + v.role + " (" + v.chars + " chars):\n" + v.persona) },
    execute: async (args: any) => {
      const id = normalizeRoleKey(String(args?.role ?? ""))
      if (!id) throw new Error("mpd_role_persona: unknown role '" + String(args?.role) + "'")
      const persona = readPersona(config, ROLE_BY_ID[id])
      return { role: id, persona, chars: persona.length }
    }
  })
}