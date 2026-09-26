import { writeFileSync } from "node:fs"
export const name = "t4probe6"
const OUT = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report6.json"
export function apply(ctx) {
  const out = { when: new Date().toISOString(), steps: [] }
  const report = () => { try { writeFileSync(OUT, JSON.stringify(out, null, 2)) } catch {} }
  ctx.inject(["tuiRenderers"], (scoped) => {
    try {
      const r = scoped.get("tuiRenderers", false)
      // If the package already registered this type, this is a duplicate and the
      // host refuses it silently (no row from the probe). If it is accepted, the
      // probe's row proves the package's registration is missing.
      const d = r.register("mpd-tui/board-opened", () => ({ title: "PROBE-C ROW", lines: ["probe C"] }))
      out.steps.push("mpd-tui/board-opened register: " + typeof d)
      const d2 = r.register("t4probe/plain6", () => ({ title: "PROBE-D ROW", lines: ["probe D"] }))
      out.steps.push("control register: " + typeof d2)
    } catch (e) { out.steps.push("register threw: " + String((e && e.message) || e)) }
    report()
  })
  ctx.inject(["commands"], (scoped) => {
    try {
      const c = scoped.get("commands", false)
      c.register({
        name: "t4probe6",
        description: "append our own event type without opening any scene",
        handler: (inv) => {
          const s = inv?.agent?.session
          try { s.append("mpd-tui/board-opened", { view: "probe6", via: "command", at: Date.now() }); out.steps.push("appended mpd-tui/board-opened") } catch (e) { out.steps.push("append threw: " + String((e && e.message) || e)) }
          try { s.append("t4probe/plain6", { n: "D" }); out.steps.push("appended control") } catch (e) { out.steps.push("append control threw: " + String((e && e.message) || e)) }
          report()
          return { kind: "success" }
        },
      })
      out.steps.push("command registered"); report()
    } catch (e) { out.steps.push("command threw: " + String((e && e.message) || e)); report() }
  })
  report()
}
