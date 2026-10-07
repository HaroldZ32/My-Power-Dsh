// t8 MOUNT probe (verification-only): proves the agent-teams row APPLIED and the adopted
// server-side tool set REGISTERED — including the t4 tool `agent_teams_task_contract`, which
// exists only in the post-fix module (the pre-fix tree registers 13 tools).
// Mounted through a `--patch` overlay row, like the repo's other mount probes.
// Dependency-free plain JS: the host imports this file directly.
export const name = "mpd-qa-agent-teams-mount-probe"
export const inject = ["tools"]

const EXPECTED = [
    "agent_teams_create",
    "agent_teams_approve",
    "agent_teams_edit_plan",
    "agent_teams_add_member",
    "agent_teams_remove_member",
    "agent_teams_create_task",
    "agent_teams_reassign_task",
    "agent_teams_claim_task",
    "agent_teams_update_task",
    "agent_teams_send_message",
    "agent_teams_status",
    "agent_teams_resume",
    "agent_teams_delete",
    "agent_teams_task_contract",
]

export function apply(ctx) {
    // The loader applies rows concurrently: a short settle window makes the registry read deterministic.
    setTimeout(() => {
        try {
            const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
            const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
            const has = (n) => {
                try { return dsh && typeof dsh.hasTool === "function" ? dsh.hasTool(n) : tools?.get?.(n) !== undefined } catch { return false }
            }
            const present = EXPECTED.filter(has)
            console.log("[mount-probe] AGENT_TEAMS_TOOLS_PRESENT=" + present.length + "/" + EXPECTED.length)
            console.log("[mount-probe] AGENT_TEAMS_TOOLS=" + EXPECTED.map((n) => n + ":" + (has(n) ? "ok" : "MISSING")).join(","))
            console.log("[mount-probe] T4_TOOL_agent_teams_task_contract=" + (has("agent_teams_task_contract") ? "REGISTERED" : "MISSING"))
            for (const fn of ["list", "names", "definitions", "entries"]) {
                try {
                    if (typeof tools?.[fn] === "function") {
                        const out = tools[fn]()
                        console.log("[mount-probe] TOOLS_" + fn.toUpperCase() + "=" + (Array.isArray(out) ? out.length : typeof out))
                    }
                } catch (e) {
                    console.log("[mount-probe] TOOLS_" + fn.toUpperCase() + "_ERR=" + String(e?.message ?? e))
                }
            }
            console.log("[mount-probe] DONE")
        } catch (e) {
            console.log("[mount-probe] FAIL=" + String(e?.message ?? e))
        }
    }, 8000)
}
