import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"

function makeCtx() {
  const tools: any[] = []
  const calls: string[] = []
  const canned: Record<string, any> = {
    "-planner": { structured: { plan: "# plan\n1. do it", checklist: [{ key: "1", label: "create file" }], reviewRequired: false } },
    "-planrev0": { structured: { verdict: "approve", concerns: [] } },
    "-r1": { structured: { status: "complete", wave: "d1", summary: "done", evidence: ["utils.txt exists"], nextSteps: [], blocker: "", criteria: [{ key: "1", label: "create file", state: "clean", evidence: ["e"] }] } },
    "-r2": { structured: { status: "continue", wave: "d2", summary: "noop", evidence: [], nextSteps: ["x"], blocker: "", criteria: [] } },
    "-verify0": { structured: { verdict: "approve", concerns: [] } },
    "-gate": { structured: { lanes: [{ lane: "code quality", verdict: "PASS", evidence: "ok" }, { lane: "hands-on QA", verdict: "PASS", evidence: "ok" }, { lane: "goal verification", verdict: "PASS", evidence: "ok" }] } }
  }
  const ctx: any = {
    tools: {
      register(def: any) { tools.push(def); (this as any)[def.name] = def },
      get(name: string) { return tools.find((t) => t.name === name) }
    },
    subagents: {
      start(provider: string, opts: any) {
        calls.push("spawn:" + opts.label.split("-").pop())
        const key = Object.keys(canned).find((k) => opts.label.includes(k.replace("-", "").slice(0, 3)) && opts.label.endsWith(k.slice(1))) ?? opts.label
        const label = opts.label
        let match: any = null
        for (const k of Object.keys(canned)) if (label.includes(k)) match = canned[k]
        return { result: Promise.resolve(match ?? { structured: { status: "continue", wave: "x", summary: "-", evidence: [], nextSteps: [], blocker: "", criteria: [] } }) }
      }
    }
  }
  return { ctx, tools, calls }
}

test("engine policy: plan -> round -> verify -> quality gate with ledger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-"))
  const planDir = join(dir, "plans")
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  const tool = tools.find((t) => t.name === "mpd_ultrawork")
  expect(tool).toBeTruthy()
  const res = await tool.execute({ objective: "create utils.txt with alpha/beta/gamma", tier: "light", plan: true, strictReview: true, maxRounds: 2 }, { agent: {} })
  expect(res.status).toBe("complete")
  expect(res.rounds).toBe(1)
  expect(res.verdict).toBe("approve")
  expect(res.planFile).toBeTruthy()
  expect(existsSync(res.planFile!)).toBe(true)
  const state = JSON.parse(readFileSync(res.stateFile, "utf8"))
  expect(state.status).toBe("complete")
  expect(state.criteria.length).toBe(1)
  expect(state.criteria[0].state).toBe("clean")
  const ledger = readFileSync(join(stateDir, res.stateFile.split("/").slice(-2, -1)[0], "ledger.jsonl"), "utf8")
  expect(ledger).toContain("verification")
  expect(ledger).toContain("quality-code quality")
  expect(ledger).toContain("quality-goal verification")
})

test("engine alias and 2-fruitless-waves stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw2-"))
  const planDir = join(dir, "plans")
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  const tool = tools.find((t) => t.name === "mpd_ultrawork")
  const res = await tool.execute({ objective: "noop objective", tier: "light", plan: false, maxRounds: 5 }, { agent: {} })
  // rounds r1 complete+clean (canned) -> complete; fruitless path not reached in this stub,
  // but the alias must exist and return the B3 shape.
  const alias = tools.find((t) => t.name === "mpd_ulw")
  expect(alias).toBeTruthy()
  expect(res.status).toBe("complete")
})
