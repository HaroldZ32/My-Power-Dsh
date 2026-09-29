// Sandbox-only instrumentation: which idiom makes an optional service reachable?
import { writeFileSync } from "node:fs"
export const name = "t4-probe2"
// (a) the blocking declaration form, for one HARNESS service
export const inject = ["commands"]
const OUT = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report2.json"
export function apply(ctx) {
  const report = { when: new Date().toISOString(), withInjectExport: {}, injected: {}, registerInInject: null }
  for (const id of ["commands", "tuiStatus", "tuiPluginHost"]) {
    try { const v = ctx.get(id, false); report.withInjectExport[id] = v === undefined || v === null ? "absent" : typeof v } catch (e) { report.withInjectExport[id] = "threw: " + String((e && e.message) || e) }
  }
  const ids = ["commands", "settings", "tuiStatus", "tuiRenderers", "tuiSettingsSections", "tuiScenes", "tuiCommandTrees", "tuiShortcuts", "tuiDialogs", "tuiPluginHost"]
  for (const id of ids) {
    try {
      ctx.inject([id], (scoped) => {
        let seen = "?"
        try { const v = scoped.get(id, false); seen = v === undefined || v === null ? "absent" : typeof v } catch (e) { seen = "threw: " + String((e && e.message) || e) }
        report.injected[id] = seen
        if (id === "commands") {
          try {
            const svc = scoped.commands
            const d = svc.register({ name: "t4probe2", description: "t4 probe 2", handler: () => ({ kind: "success", text: "t4probe2 ok" }) })
            report.registerInInject = typeof d === "function" ? "ok" : "no disposer"
          } catch (e) { report.registerInInject = "threw: " + String((e && e.message) || e) }
        }
        if (id === "tuiStatus") {
          try {
            const d = scoped.tuiStatus.set("t4probe2", "probe2 live")
            report.statusSet = typeof d === "function" ? "ok" : "no disposer"
          } catch (e) { report.statusSet = "threw: " + String((e && e.message) || e) }
        }
        if (id === "tuiScenes") {
          try {
            const d = scoped.tuiScenes.register({ id: "t4probe2-scene", title: "probe2", component: () => null })
            report.sceneRegister = typeof d === "function" ? "ok" : "no disposer"
          } catch (e) { report.sceneRegister = "threw: " + String((e && e.message) || e) }
        }
        try { writeFileSync(OUT, JSON.stringify(report, null, 2)) } catch {}
      })
    } catch (e) { report.injected[id] = "inject() threw: " + String((e && e.message) || e) }
  }
  try { writeFileSync(OUT, JSON.stringify(report, null, 2)) } catch {}
  return report
}
