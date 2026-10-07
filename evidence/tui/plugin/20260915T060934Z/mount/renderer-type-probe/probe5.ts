import { writeFileSync } from "node:fs"
export const name = "t4probe5"
const OUT = "/root/dshProj/my-power-dsh/.mpd/recon/qa/t4-probe/report5.json"
export function apply(ctx) {
  const out = { when: new Date().toISOString(), steps: [] }
  const report = () => { try { writeFileSync(OUT, JSON.stringify(out, null, 2)) } catch {} }
  ctx.inject(["tuiRenderers"], (scoped) => {
    out.steps.push("renderers inject fired")
    try {
      const r = scoped.get("tuiRenderers", false)
      // Variant A: exactly our package's shape (identity arg + scoped.effect cleanup)
      const dA = r.register("t4probe/with-identity", (payload) => ({ title: "PROBE-A ROW", lines: ["A " + JSON.stringify(payload).slice(0, 40)] }), scoped)
      out.steps.push("A registered: " + typeof dA)
      try { scoped.effect(() => () => dA(), "probe5 A cleanup"); out.steps.push("A effect wired") } catch (e) { out.steps.push("A effect threw: " + String((e && e.message) || e)) }
      // Variant B: the plain host idiom (no identity, no effect)
      const dB = r.register("t4probe/plain", (payload) => ({ title: "PROBE-B ROW", lines: ["B " + JSON.stringify(payload).slice(0, 40)] }))
      out.steps.push("B registered: " + typeof dB)
    } catch (e) { out.steps.push("register threw: " + String((e && e.message) || e)) }
    report()
  })
  ctx.inject(["commands"], (scoped) => {
    try {
      const c = scoped.get("commands", false)
      c.register({
        name: "t4probe5",
        description: "append two probe events",
        handler: (inv) => {
          const s = inv?.agent?.session
          try { s.append("t4probe/with-identity", { n: "A" }); out.steps.push("appended A") } catch (e) { out.steps.push("append A threw: " + String((e && e.message) || e)) }
          try { s.append("t4probe/plain", { n: "B" }); out.steps.push("appended B") } catch (e) { out.steps.push("append B threw: " + String((e && e.message) || e)) }
          report()
          return { kind: "success" }
        },
      })
      out.steps.push("command registered"); report()
    } catch (e) { out.steps.push("command threw: " + String((e && e.message) || e)); report() }
  })
  report()
}
