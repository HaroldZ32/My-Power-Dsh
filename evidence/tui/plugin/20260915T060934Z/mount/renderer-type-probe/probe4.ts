import { writeFileSync } from "node:fs"
export const name = "t4probe4"
const OUT = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report4.json"
export function apply(ctx) {
  const out = { when: new Date().toISOString(), steps: [] }
  const report = () => { try { writeFileSync(OUT, JSON.stringify(out, null, 2)) } catch {} }
  ctx.inject(["tuiRenderers"], (scoped) => {
    out.steps.push("renderers inject fired")
    try {
      const r = scoped.get("tuiRenderers", false)
      const d = r.register("t4probe/notice", (payload) => ({ title: "PROBE ROW", lines: ["probe payload: " + JSON.stringify(payload).slice(0, 60)] }))
      out.steps.push("renderer register returned: " + typeof d)
    } catch (e) { out.steps.push("renderer threw: " + String((e && e.message) || e)) }
    try { const l = scoped.get("tuiEffectLedger", false); out.steps.push("ledger: " + (l === undefined || l === null ? "absent" : typeof l)) } catch (e) { out.steps.push("ledger threw: " + String((e && e.message) || e)) }
    report()
  })
  ctx.inject(["commands"], (scoped) => {
    try {
      const c = scoped.get("commands", false)
      c.register({
        name: "t4probe4",
        description: "append a probe event",
        handler: (inv) => {
          try {
            inv?.agent?.session?.append("t4probe/notice", { text: "hello from probe4", at: Date.now() })
            out.steps.push("appended t4probe/notice")
            report()
            return { kind: "success" }
          } catch (e) { out.steps.push("append threw: " + String((e && e.message) || e)); report(); return { kind: "error", text: "append failed" } }
        },
      })
      out.steps.push("command registered")
      report()
    } catch (e) { out.steps.push("command threw: " + String((e && e.message) || e)); report() }
  })
  report()
}
