import { writeFileSync } from "node:fs"
export const name = "t4probe7"
const OUT = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report7.json"
const TYPES = ["mpd-tui/probe-xyz", "agent-teams/task-updated", "t4probe/plain7"]
export function apply(ctx) {
  const out = { when: new Date().toISOString(), steps: [] }
  const report = () => { try { writeFileSync(OUT, JSON.stringify(out, null, 2)) } catch {} }
  ctx.inject(["tuiRenderers"], (scoped) => {
    try {
      const r = scoped.get("tuiRenderers", false)
      for (const t of TYPES) {
        const d = r.register(t, () => ({ title: "ROW " + t, lines: ["body " + t] }))
        out.steps.push(`${t}: ${typeof d}`)
      }
    } catch (e) { out.steps.push("register threw: " + String((e && e.message) || e)) }
    report()
  })
  ctx.inject(["commands"], (scoped) => {
    try {
      const c = scoped.get("commands", false)
      c.register({ name: "t4probe7", description: "append three typed events", handler: (inv) => {
        for (const t of TYPES) {
          try { inv?.agent?.session?.append(t, { t }); out.steps.push("appended " + t) } catch (e) { out.steps.push("append " + t + " threw: " + String((e && e.message) || e)) }
        }
        report(); return { kind: "success" }
      } })
      out.steps.push("command registered"); report()
    } catch (e) { out.steps.push("command threw: " + String((e && e.message) || e)); report() }
  })
  report()
}
