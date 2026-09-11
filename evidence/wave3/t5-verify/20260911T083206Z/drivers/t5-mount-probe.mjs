// t5 MOUNT probe (verification-only): proves the adopted agent-teams row APPLIED in a real
// boot and that the freshly-loaded module registers the full tool set AND the fixed
// `agent_teams_update_task` contract. The expected tool list is NOT hardcoded here: it is
// produced by this driver's own scan of lib/tools.js (`expected-tools.json`), so the probe
// cannot agree with a stale hand-maintained list.
// Dependency-free plain JS: the host imports this file directly.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const name = "mpd-t5-agent-teams-mount-probe"
export const inject = ["tools"]

const here = dirname(fileURLToPath(import.meta.url))
const EXPECTED = JSON.parse(readFileSync(join(here, "expected-tools.json"), "utf8"))

export function apply(ctx) {
    // The loader applies rows concurrently: a settle window makes the registry read deterministic.
    setTimeout(() => {
        try {
            const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
            const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
            const defOf = (n) => {
                try { return tools?.get?.(n) } catch { return undefined }
            }
            const has = (n) => {
                try { return dsh && typeof dsh.hasTool === "function" ? dsh.hasTool(n) : defOf(n) !== undefined } catch { return false }
            }
            const present = EXPECTED.filter(has)
            console.log("[t5-mount-probe] AGENT_TEAMS_TOOLS_PRESENT=" + present.length + "/" + EXPECTED.length)
            console.log("[t5-mount-probe] AGENT_TEAMS_TOOLS=" + EXPECTED.map((n) => n + ":" + (has(n) ? "ok" : "MISSING")).join(","))
            const update = defOf("agent_teams_update_task")
            const samples = [update, update?.definition, update?.tool, update?.spec].filter((value) => value !== undefined)
            let required
            let description
            for (const sample of samples) {
                required = required ?? sample?.parameters?.required
                description = description ?? sample?.description
            }
            console.log("[t5-mount-probe] UPDATE_TASK_REQUIRED=" + JSON.stringify(required ?? null))
            console.log("[t5-mount-probe] UPDATE_TASK_STATUS_REQUIRED=" + String((required ?? []).includes("status")))
            console.log("[t5-mount-probe] UPDATE_TASK_DESCRIPTION_HAS_REQUIRED_WORDING=" + String(/status` is REQUIRED/.test(description ?? "")))
            console.log("[t5-mount-probe] T4_TOOL_agent_teams_task_contract=" + (has("agent_teams_task_contract") ? "REGISTERED" : "MISSING"))
            console.log("[t5-mount-probe] DEFINITION_KEYS=" + JSON.stringify(update === undefined ? null : Object.keys(update)))
            console.log("[t5-mount-probe] DONE")
        }
        catch (error) {
            console.log("[t5-mount-probe] FAIL=" + String(error?.message ?? error))
        }
    }, 8000)
}
