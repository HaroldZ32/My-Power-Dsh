// QA-only verification probe (task t8) — mounted ONLY by the scratch overlay in this
// directory (adapter-disabled-boot.mjs). It answers the two questions the shipped QA probe
// cannot answer for this lane:
//   1. are ALL 21 agent_teams_* tools registered in the live registry? (the shipped probe
//      instruments only 7 named tools, so its 7/7 line is NOT the 21/21 claim AC10 makes)
//   2. in the adapter-DISABLED arm, does the REAL bridge (lib/mpd-adapter-ctx.js) return the
//      uniform {context, tools, on, effect} shape for a hostile per-agent ctx WITHOUT a read
//      throwing — i.e. is the F1 field failure really gone at boot level, not only in unit tests?
//
// Reading the raw registry here is the same QA-only licence the shipped roles-probe uses
// (packages/mpd-qa-roles-probe/src/index.ts): `--dump-config` composes rows and never executes
// plugin code, so only an in-boot read can witness registration (AGENTS.md §4).
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
export const name = "mpd-verif-probe"
// `tools` MUST be declared: an agent-scoped cordis ctx throws on any property not in `inject`
// (`cannot get property "tools" without inject`), and the instrumentation would report nothing.
export const inject = ["tools"]

/** Every agent_teams_* tool the adopted plugin defines (extracted from lib/tools.js). */
const TOOLS_21 = [
  "agent_teams_add_member",
  "agent_teams_approve",
  "agent_teams_claim_task",
  "agent_teams_create",
  "agent_teams_create_task",
  "agent_teams_delete",
  "agent_teams_edit_plan",
  "agent_teams_interject_decide",
  "agent_teams_interject_request",
  "agent_teams_mailbox_check",
  "agent_teams_mailbox_clear",
  "agent_teams_move_path",
  "agent_teams_path_owner",
  "agent_teams_reassign_task",
  "agent_teams_remove_member",
  "agent_teams_resume",
  "agent_teams_rollover",
  "agent_teams_send_message",
  "agent_teams_status",
  "agent_teams_task_contract",
  "agent_teams_update_task",
]

export async function apply(ctx) {
  // ── 1) the 21-tool registration count ─────────────────────────────────────
  try {
    const tools = ctx?.tools
    const seen = (name) => {
      if (tools === undefined) return false
      if (typeof tools.get === "function") return tools.get(name) !== undefined
      if (typeof tools.has === "function") return tools.has(name)
      return false
    }
    // Rows apply concurrently; poll briefly instead of racing a sibling plugin.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !TOOLS_21.every(seen)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const missing = TOOLS_21.filter((tool) => !seen(tool))
    console.log("[verif-probe] VERIF_AGENT_TEAMS_TOOLS=" + (TOOLS_21.length - missing.length) + "/21"
      + (missing.length > 0 ? " MISSING=" + missing.join(",") : ""))
  } catch (error) {
    console.log("[verif-probe] VERIF_AGENT_TEAMS_TOOLS=fail:" + String(error?.message ?? error))
  }

  // ── 2) the F1 arm at boot level: hostile per-agent ctx through the REAL bridge ──
  try {
    // The bridge is reached by ABSOLUTE repo path: this probe lives in
    // evidence/agent-teams/adapter-wiring/verification/<stamp>/, i.e. five levels below the
    // repo root, and a relative specifier that is off by one resolves outside the repo
    // (measured: `Cannot find module '/root/dshProj/packages/...`).
    const repo = resolve(join(dirname(fileURLToPath(import.meta.url)), "../../../../.."))
    const bridge = await import(pathToFileURL(join(repo, "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js")).href)
    // The composition root (lib/index.js) hands `agentScopeOf` its FACADE — a plain object —
    // never a scoped cordis ctx, whose non-injected property reads THROW (measured here:
    // `cannot get property "agentScope" without inject`). Build the same facade over a raw ctx
    // with no adapter behind it, and route its witness to a NO-OP sink so this probe cannot add
    // a second fallback line to the boot log that the AC11 witness count is measured from.
    const facade = bridge.createAgentTeamsCtx({ get: () => undefined }, { witness: () => {} })
    const hostileCtx = new Proxy({}, {
      get() { throw new Error("hostile ctx read") },
      has() { throw new Error("hostile ctx has") },
    })
    const agent = { id: "verif-hostile-agent", ctx: hostileCtx }
    const scope = bridge.agentScopeOf(facade, agent)
    const members = Object.keys(scope ?? {}).sort().join(",")
    console.log("[verif-probe] VERIF_SCOPE_MEMBERS=" + (members || "none"))
    console.log("[verif-probe] VERIF_SCOPE_IDENTITY=" + String(scope?.context === hostileCtx))
    console.log("[verif-probe] VERIF_SCOPE_NOTHROW=true")
  } catch (error) {
    console.log("[verif-probe] VERIF_SCOPE=THREW:" + String(error?.message ?? error))
  }

  console.log("[verif-probe] VERIF_DONE=true")
}
