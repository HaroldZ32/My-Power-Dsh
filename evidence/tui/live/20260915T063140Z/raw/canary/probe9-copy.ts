import { writeFileSync } from "node:fs"
export const name = "t4probe9"
const OUT = "/root/dshProj/my-power-dsh/evidence/tui/live/20260915T063140Z/raw/canary/probe9-copy-report.json"
const TYPES = ["mpd-tui/board-opened", "mpd-tui/never-used-before-9", "t4probe/plain9"]
export function apply(ctx) {
  const out = { when: new Date().toISOString(), steps: [] }
  const report = () => { try { writeFileSync(OUT, JSON.stringify(out, null, 2)) } catch {} }
  ctx.inject(["tuiRenderers"], (scoped) => {
    try {
      const r = scoped.get("tuiRenderers", false)
      for (const t of TYPES) out.steps.push(`${t}: ${typeof r.register(t, () => ({ title: "ROW " + t, lines: ["body " + t] }))}`)
    } catch (e) { out.steps.push("register threw: " + String((e && e.message) || e)) }
    report()
  })
  ctx.inject(["commands"], (scoped) => {
    try {
      const c = scoped.get("commands", false)
      c.register({ name: "t4probe9", description: "append used vs never-used types", handler: (inv) => {
        for (const t of TYPES) { try { inv?.agent?.session?.append(t, { t }); out.steps.push("appended " + t) } catch (e) { out.steps.push("append " + t + " threw") } }
        report(); return { kind: "success" }
      } })
      report()
    } catch (e) { out.steps.push("command threw: " + String((e && e.message) || e)); report() }
  })
  report()
}
