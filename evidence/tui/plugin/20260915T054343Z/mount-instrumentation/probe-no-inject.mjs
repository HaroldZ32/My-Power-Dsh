// Sandbox-only instrumentation row (never committed): reports what a plugin
// context sees at apply time in a real dsh-tui boot.
import { writeFileSync } from "node:fs"
export const name = "t4-probe"
export function apply(ctx) {
  const report = { when: new Date().toISOString(), probes: {}, strict: {}, register: null, effect: null, logger: typeof ctx.logger }
  for (const id of ["commands", "settings", "tuiStatus", "tuiRenderers", "tuiSettingsSections", "tuiScenes", "tuiCommandTrees", "tuiShortcuts", "tuiDialogs", "tuiPluginHost", "mpdDsh", "agents", "skills"]) {
    try { const v = ctx.get(id, false); report.probes[id] = v === undefined || v === null ? "absent" : typeof v } catch (e) { report.probes[id] = "threw(soft): " + String((e && e.message) || e) }
    try { const v = ctx.get(id); report.strict[id] = v === undefined || v === null ? "absent" : typeof v } catch (e) { report.strict[id] = "threw(strict): " + String((e && e.message) || e) }
  }
  try {
    const commands = ctx.get("commands", false)
    if (commands && typeof commands.register === "function") {
      const d = commands.register({ name: "t4probe", description: "t4 instrumentation probe", handler: () => ({ kind: "success", text: "t4probe ok" }) })
      report.register = typeof d === "function" ? "ok" : "no disposer"
    } else report.register = "service absent"
  } catch (e) { report.register = "threw: " + String((e && e.message) || e) }
  try { report.effect = typeof ctx.effect } catch (e) { report.effect = "threw: " + String((e && e.message) || e) }
  try { writeFileSync("/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report.json", JSON.stringify(report, null, 2)) } catch {}
  return report
}
