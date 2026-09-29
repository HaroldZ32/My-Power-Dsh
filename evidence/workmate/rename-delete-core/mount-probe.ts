// QA-only MOUNT probe (t12): proves the plugin tree APPLIED and the workmate tools REGISTERED.
// Mounted by an overlay patch (see mount-proof.sh) so it runs in a real boot of the full profile.
// Deliberately dependency-free plain JS: the host imports this file directly, so it must not import
// TypeScript. The adapter service (mpdDsh) is resolved lazily; a direct tools-service fallback keeps
// the probe useful even if the adapter row is absent.
export const name = "mpd-qa-mount-probe"
export const inject = ["tools"]

const WORKMATE_TOOLS = [
  "mpd_workmate_list",
  "mpd_workmate_init",
  "mpd_workmate_spawn",
  "mpd_workmate_reflect",
  "mpd_workmate_match",
  "mpd_workmate_rename",
  "mpd_workmate_delete",
]

export function apply(ctx) {
  // Defer: the loader applies rows concurrently, so reading the registry immediately would race the
  // rows still registering. A short settle window makes the read deterministic.
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const has = (n) => {
        try { return dsh && typeof dsh.hasTool === "function" ? dsh.hasTool(n) : tools?.get?.(n) !== undefined } catch { return false }
      }
      const present = WORKMATE_TOOLS.filter(has)
      console.log("[mount-probe] WORKMATE_TOOLS_PRESENT=" + present.length + "/" + WORKMATE_TOOLS.length)
      console.log("[mount-probe] WORKMATE_TOOLS=" + WORKMATE_TOOLS.map((n) => n + ":" + (has(n) ? "ok" : "MISSING")).join(","))
      // Registration inventory, if this harness exposes one (the count is reported as-is, never assumed).
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
      // A registered tool must also be CALLABLE end to end (read-only call, no library mutation).
      if (dsh && typeof dsh.executeTool === "function") {
        const call = await dsh.executeTool({ name: "mpd_workmate_list", arguments: {}, callId: "mount-probe-list" })
        const value = call?.value ?? {}
        console.log("[mount-probe] WORKMATE_LIST_CALL=" + (call?.ok ? "ok" : "fail:" + String(call?.error)) + " count=" + String(value.count ?? (Array.isArray(value.workmates) ? value.workmates.length : "-")))
        // The repaired field, exercised live: an invalid name must be refused with the §D reason.
        const refused = await dsh.executeTool({ name: "mpd_workmate_delete", arguments: { name: "Alice" }, callId: "mount-probe-delete" })
        const msg = String(refused?.error ?? refused?.raw?.error?.message ?? "")
        console.log("[mount-probe] WORKMATE_DELETE_INVALID_NAME=" + (refused?.ok ? "UNEXPECTED-OK" : "refused") + " msg=" + JSON.stringify(msg.slice(0, 160)))
      } else {
        console.log("[mount-probe] ADAPTER=missing (tools-service fallback used)")
      }
      console.log("[mount-probe] DONE")
    } catch (e) {
      console.log("[mount-probe] FAIL=" + String(e?.message ?? e))
    }
  }, 8000)
}
