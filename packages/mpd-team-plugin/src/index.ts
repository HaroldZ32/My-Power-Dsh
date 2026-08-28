// B2 mpd-team-plugin: parallel role delegation ("team mode") on the DSH subagent seam.
// Each member = one fresh child. Member roles resolve against the mpd-roles ROSTER
// (ctx.get("mpdRoles")): roster roles get their real persona text, the role's model
// chain and the read-only write-deny filter; unknown/custom roles fall back to the
// caller prompt with a default specialist persona. Outputs are collected and stored
// in the team state file (.mpd/team/<id>.json) as a mailbox; the tool returns an
// aggregated convergence report for the main agent.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export const name = "mpd-team"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; get?: (k: string) => any; [k: string]: any }
type Config = { provider?: string; model?: string; stateDir?: string }

const DEFAULT_SPECIALIST_PERSONA = "You are a specialist working on a shared task."
const WRITE_DENY = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit"]

const MEMBER_SCHEMA = {
  type: "object",
  properties: { role: { type: "string" }, summary: { type: "string" }, recommendation: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
  required: ["role", "summary", "recommendation", "evidence"],
  additionalProperties: false
}

function textBlock(text: string): any { return [{ type: "text", text }] }

/** Normalize a member role key to the roster spelling (or null for custom roles). */
function rosterKey(role: string): string | null {
  const k = String(role ?? "").trim()
  if (!k) return null
  if (k.startsWith("mpd-")) return k.slice(4)
  if (k === "sisyphusJunior") return "sisyphus-junior"
  if (k === "multimodalLooker") return "multimodal-looker"
  return k
}

export function apply(ctx: Ctx, config: Config = {}): void {
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd()

  function confStateDir(): string {
    const mpdConfig = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
    const v = mpdConfig?.get?.("team.stateDir")
    return typeof v === "string" && v ? v : (config.stateDir ?? join(cwd, ".mpd", "team"))
  }

  ctx.tools.register({
    name: "mpd_team_spawn",
    description: "Spawn a small parallel team (2-4 members) for one task. Each member is either a roster role (oracle/prometheus/librarian/hephaestus/explore/metis/momus/atlas/sisyphus/sisyphus-junior/multimodal-looker - roster persona + model route + read-only discipline applied automatically; legacy mpd-<id> keys accepted) or a custom role with an explicit prompt. Results land in the team mailbox state file and an aggregated report is returned.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string" },
        roles: { type: "array", items: { type: "object", properties: { role: { type: "string" }, prompt: { type: "string" } }, required: ["role", "prompt"] } }
      },
      required: ["task", "roles"]
    },
    output: { schema: { type: "object", properties: { teamId: { type: "string" }, members: { type: "integer" }, report: { type: "string" }, stateFile: { type: "string" } }, required: ["teamId", "members", "report"] },
      render: (_a: unknown, v: any) => textBlock("team " + v.teamId + " (" + v.members + " members)\n" + v.report + "\nstate: " + v.stateFile) },
    execute: async (args: any, exec: any) => {
      const roles: any[] = (args?.roles ?? []).slice(0, 4)
      if (roles.length < 2) throw new Error("mpd_team_spawn: need 2..4 roles")
      const task = String(args.task)
      const id = "team-" + randomUUID().slice(0, 8)
      const stateDir = confStateDir()
      mkdirSync(stateDir, { recursive: true })
      const stateFile = join(stateDir, id + ".json")

      const rolesService = ctx.get?.("mpdRoles") as { get?: (k: string) => any } | undefined

      const starts = roles.map((r) => {
        const role = String(r.role)
        const key = rosterKey(role)
        const spec = key ? rolesService?.get?.(key) : null
        const route = config?.provider
          ? { provider: config.provider, model: config.model ?? spec?.chain?.[0]?.model ?? "deepseek-v4-flash" }
          : (spec?.chain?.[0] ?? { provider: "deepseek-official", model: "deepseek-v4-flash" })
        const persona = typeof spec?.persona === "string" && spec.persona ? spec.persona : DEFAULT_SPECIALIST_PERSONA
        const prompt = "TEAM ROLE: " + role + "\n\nShared task: " + task + "\n\nYour brief: " + String(r.prompt) + "\n\nWork independently with tools" + (spec?.readonly ? " (read-only: never modify anything)" : "") + "; end with ONLY the structured report (role/summary/recommendation/evidence)."
        return ctx.subagents.start("spawn", {
          label: id + "-" + role,
          prompt: textBlock(prompt),
          parent: exec.agent,
          signal: exec.signal,
          agentOptions: { provider: route.provider, model: route.model },
          persona,
          outputSchema: MEMBER_SCHEMA,
          ...(spec?.readonly ? { toolFilter: { deny: WRITE_DENY } } : {})
        }).then(async (run: any) => ({ role, result: await run.result }))
      })

      const settled = await Promise.all(starts)
      const mailbox: any = {}
      for (const s of settled) mailbox[s.role] = { role: s.role, structured: s.result.structured ?? {}, stopReason: s.result.stopReason }
      writeFileSync(stateFile, JSON.stringify({ id, task, mailbox, updatedAt: new Date().toISOString() }, null, 2))
      const report = settled.map((s) => {
        const r = s.result.structured ?? {}
        return "- [" + s.role + "] " + String(r.summary ?? s.result.stopReason ?? "no output") + "\n  recommendation: " + String(r.recommendation ?? "-")
      }).join("\n")
      return { teamId: id, members: settled.length, report, stateFile }
    }
  })

  ctx.tools.register({
    name: "mpd_team_status",
    description: "Read the mailbox state file of a spawned team.",
    parameters: { type: "object", properties: { teamId: { type: "string" } }, required: ["teamId"] },
    output: { schema: { type: "object", properties: { found: { type: "boolean" }, report: { type: "string" } }, required: ["found", "report"] }, render: (_a: unknown, v: any) => textBlock(v.report) },
    execute: async (args: any) => {
      const id = String(args.teamId)
      try {
        const { readFileSync } = await import("node:fs")
        const state = JSON.parse(readFileSync(join(confStateDir(), id + ".json"), "utf8"))
        return { found: true, report: JSON.stringify(state.mailbox ?? {}) }
      } catch { return { found: false, report: "team state not found: " + id } }
    }
  })
}