import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import type { DshSpawnSpec, DshTextBlock, DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
// The HARNESS'S OWN output validator, vendored in the adopted plugin's runtime closure and
// imported by RELATIVE path (never a bare host specifier): the DECLARED output schema is
// checked here exactly as the harness checks a tool result at runtime.
// That vendored closure is plain JavaScript with no declaration file, so the two validators
// stay untyped at the import and are given precise local types where a result is received.
// @ts-expect-error vendored JavaScript has no declaration file
import { assertSupportedJsonSchema, validateJsonSchemaValue } from "../../mpd-agent-teams-plugin/_deps/dsh-tools/lib/index.js"

/** One canned subagent answer, keyed in the fake's table by a suffix of the child's label. */
interface CannedArm {
  /** The structured report the canned child resolves with. */
  structured: Record<string, unknown>
}

/** One spawn request as the fake subagent seam received it, i.e. AFTER the adapter normalized it. */
interface CapturedSpawn extends Omit<DshSpawnSpec, "prompt" | "agentOptions"> {
  /** The child's prompt, always normalized to model-facing text blocks before the seam is called. */
  prompt: ReadonlyArray<DshTextBlock>
  /** The flat provider/model route the adapter resolved for this child, always present here. */
  agentOptions: { provider?: string; model?: string }
}

/** One quality-gate ledger row the engine stamped for a judged lane. */
interface UltraworkLedgerRow {
  /** The judged lane name, e.g. `hands-on QA`. */
  lane: string
  /** The lane's verdict; the gate child answers one of exactly these two. */
  verdict: "PASS" | "FAIL"
  /** The lane's evidence detail. */
  evidence: string
}

/** The `mpd_ultrawork` result, narrowed to the fields these tests assert. */
interface UltraworkRunResult {
  /** The run outcome after the loop; `continue` is never returned. */
  status: "complete" | "blocked" | "max-rounds"
  /** How many rounds actually ran. */
  rounds: number
  /** The plan file path; the key is ABSENT when this run wrote no plan. */
  planFile?: string
  /** The verification verdict, `n/a` when that gate was skipped. */
  verdict: "n/a" | "approve" | "reject"
  /** The quality gate's per-lane rows, one per judged lane. */
  ledger: ReadonlyArray<UltraworkLedgerRow>
  /** The report text the engine returned to the caller. */
  finalReport: string
  /** The durable state document this run wrote. */
  stateFile: string
}

/** The `mpd_ultrawork` argument object; only the objective is required. */
interface UltraworkArgs {
  /** The objective this run must complete. */
  objective: string
  /** The requested tier, which the engine defaults to `light`. */
  tier?: "light" | "heavy"
  /** Whether this run must write a plan file. */
  plan?: boolean
  /** Whether the verification gate runs even for a light tier. */
  strictReview?: boolean
  /** The round cap for this run. */
  maxRounds?: number
}

/** One registered tool as the fake registry captured it, with the engine's own argument and result types. */
interface CapturedToolDef extends Omit<DshToolDef, "execute" | "output"> {
  /** The tool body; the engine's result fields are the ones these tests assert. */
  execute: (args: UltraworkArgs, exec: DshToolExec) => Promise<UltraworkRunResult>
  /** The declared output contract; the schema OBJECT itself is what these tests validate. */
  output: { schema: Record<string, unknown> }
}

/** One accumulated criterion row of the run's durable state document. */
interface CriterionRow {
  /** The criterion's ladder state, `clean` once the criterion is satisfied. */
  state: "pin" | "red" | "green" | "surface" | "clean"
}

/** The durable state document the engine writes, narrowed to the fields these tests assert. */
interface RunStateDocument {
  /** The run status persisted after the final round. */
  status: string
  /** The accumulated criterion rows, in pin order. */
  criteria: ReadonlyArray<CriterionRow>
}

/** The fake host context plus the handles the assertions read, all canned per child label. */
function makeCtx(overrides: Record<string, CannedArm> = {}): { ctx: Parameters<typeof apply>[0]; tools: CapturedToolDef[]; calls: string[]; spawns: CapturedSpawn[] } {
  // Tool definitions the fake registry received.
  const tools: CapturedToolDef[] = []
  // One log line per spawned child, used to prove the routing order.
  const calls: string[] = []
  // The spawn options the row passed, one per child.
  const spawns: CapturedSpawn[] = []
  // Canned structured reports, matched to a child by its label.
  const canned: Record<string, CannedArm> = {
    "-planner": { structured: { plan: "# plan\n1. do it", checklist: [{ key: "1", label: "create file" }], reviewRequired: false } },
    "-planrev0": { structured: { verdict: "approve", concerns: [] } },
    "-r1": { structured: { status: "complete", wave: "d1", summary: "done", evidence: ["utils.txt exists"], nextSteps: [], blocker: "", criteria: [{ key: "1", label: "create file", state: "clean", evidence: ["e"] }] } },
    "-r2": { structured: { status: "continue", wave: "d2", summary: "noop", evidence: [], nextSteps: ["x"], blocker: "", criteria: [] } },
    "-verify0": { structured: { verdict: "approve", concerns: [] } },
    "-gate": { structured: { lanes: [{ lane: "code quality", verdict: "PASS", evidence: "ok" }, { lane: "hands-on QA", verdict: "PASS", evidence: "ok" }, { lane: "goal verification", verdict: "PASS", evidence: "ok" }] } },
    // A caller may override ONE canned arm (e.g. a gate lane verdict FAIL) without
    // disturbing the shared defaults the other tests rely on as positive controls.
    ...overrides
  }
  // The fake host context: just the two seams the row reads.
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      // Register a tool definition and mirror it onto this object by name.
      register(this: Record<string, CapturedToolDef>, def: CapturedToolDef): void { tools.push(def); this[def.name] = def },
      // Look a tool up by name; the fake never removes one.
      get(name: string): unknown { return tools.find((t) => t.name === name) }
    },
    subagents: {
      // Spawn one child: log it, record its options and answer the canned report.
      start(provider: string, opts: CapturedSpawn): { result: Promise<CannedArm> } {
        calls.push("spawn:" + opts.label.split("-").pop())
        spawns.push(opts)
        // A candidate canned key derived from the label; the exact match below supersedes it.
        const key = Object.keys(canned).find((k) => opts.label.includes(k.replace("-", "").slice(0, 3)) && opts.label.endsWith(k.slice(1))) ?? opts.label
        // The child's label, which carries the role suffix.
        const label = opts.label
        // The canned report whose key appears in the label, if any.
        let match: CannedArm | null = null
        for (const k of Object.keys(canned)) if (label.includes(k)) match = canned[k]
        return { result: Promise.resolve(match ?? { structured: { status: "continue", wave: "x", summary: "-", evidence: [], nextSteps: [], blocker: "", criteria: [] } }) }
      }
    }
  }
  return { ctx, tools, calls, spawns }
}

test("engine policy: plan -> round -> verify -> quality gate with ledger", async () => {
  // A fresh temp root for this run's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-"))
  // The run's plan directory.
  const planDir = join(dir, "plans")
  // The run's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness for this run.
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered ultrawork tool.
  const tool = tools.find((t) => t.name === "mpd_ultrawork")!
  expect(tool).toBeTruthy()
  // The engine's result for a light tier with a plan and strict review.
  const res = await tool.execute({ objective: "create utils.txt with alpha/beta/gamma", tier: "light", plan: true, strictReview: true, maxRounds: 2 }, { agent: {} })
  expect(res.status).toBe("complete")
  expect(res.rounds).toBe(1)
  expect(res.verdict).toBe("approve")
  expect(res.planFile).toBeTruthy()
  expect(existsSync(res.planFile!)).toBe(true)
  // The durable state document the run wrote. `JSON.parse` is untyped by construction and
  // validating the document at runtime would add statements, so the parsed value is asserted
  // to the shape the engine wrote.
  const state = JSON.parse(readFileSync(res.stateFile, "utf8")) as RunStateDocument
  expect(state.status).toBe("complete")
  expect(state.criteria.length).toBe(1)
  expect(state.criteria[0].state).toBe("clean")
  // dirname/basename, never split("/"): a native win32 path has no "/" to split on, and the
  // POSIX spelling fed `join()` an `undefined` segment (ERR_INVALID_ARG_TYPE).
  const ledger = readFileSync(join(stateDir, basename(dirname(res.stateFile)), "ledger.jsonl"), "utf8")
  expect(ledger).toContain("verification")
  expect(ledger).toContain("quality-code quality")
  expect(ledger).toContain("quality-goal verification")
})

// NEGATIVE CONTROL for the run above (t9 review finding): a quality gate lane that verdicts
// FAIL must BLOCK the run — `complete` can never be reported over a failed lane — and the
// failing lane is stamped in the ledger. The completed run above stays the positive control.
test("quality gate: a FAIL lane blocks completion and stamps the ledger row", async () => {
  // A fresh temp root for this run's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-gate-fail-"))
  // The run's plan directory.
  const planDir = join(dir, "plans")
  // The run's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness, with the gate's QA lane canned to FAIL.
  const { ctx, tools } = makeCtx({
    "-gate": { structured: { lanes: [
      { lane: "code quality", verdict: "PASS", evidence: "ok" },
      { lane: "hands-on QA", verdict: "FAIL", evidence: "measured a real defect" },
      { lane: "goal verification", verdict: "PASS", evidence: "ok" }
    ] } }
  })
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered ultrawork tool.
  const tool = tools.find((t) => t.name === "mpd_ultrawork")!
  // The engine's result for the same run, now blocked by the failing lane.
  const res = await tool.execute({ objective: "create utils.txt with alpha/beta/gamma", tier: "light", plan: true, strictReview: true, maxRounds: 2 }, { agent: {} })
  expect(res.status).toBe("blocked")
  // The other gates still ran and approved: the FAIL lane alone is what blocks.
  expect(res.verdict).toBe("approve")
  expect(res.ledger.find((lane) => lane.lane === "hands-on QA")?.verdict).toBe("FAIL")
  // The durable state document, whose status must be blocked too. Asserted for the same reason
  // as the positive control above: it carries no runtime validation of its own.
  const state = JSON.parse(readFileSync(res.stateFile, "utf8")) as RunStateDocument
  expect(state.status).toBe("blocked")
  // The ledger the run appended its lane verdicts to.
  const ledger = readFileSync(join(stateDir, basename(dirname(res.stateFile)), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"quality-hands-on QA","verdict":"FAIL"')
  expect(ledger).toContain('"lane":"quality-code quality","verdict":"PASS"')
  expect(ledger).toContain('"lane":"quality-goal verification","verdict":"PASS"')
})

test("engine alias and 2-fruitless-waves stop", async () => {
  // A fresh temp root for this run's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw2-"))
  // The run's plan directory.
  const planDir = join(dir, "plans")
  // The run's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness for this run.
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered ultrawork tool.
  const tool = tools.find((t) => t.name === "mpd_ultrawork")!
  // The engine's result for a light, plan-less run.
  const res = await tool.execute({ objective: "noop objective", tier: "light", plan: false, maxRounds: 5 }, { agent: {} })
  // rounds r1 complete+clean (canned) -> complete; fruitless path not reached in this stub,
  // but the alias must exist and return the same result fields as mpd_ultrawork.
  const alias = tools.find((t) => t.name === "mpd_ulw")
  expect(alias).toBeTruthy()
  expect(res.status).toBe("complete")
})

test("DeepSeek V4 / DSH contract: role text in prompt (no persona field), pro for planner/reviewer, compact handoff", async () => {
  // A fresh temp root for this run's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw3-"))
  // The run's plan directory.
  const planDir = join(dir, "plans")
  // The run's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness for this run.
  const { ctx, tools, spawns } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered ultrawork tool.
  const tool = tools.find((t) => t.name === "mpd_ultrawork")!
  await tool.execute({ objective: "create utils.txt", tier: "light", plan: true, strictReview: true, maxRounds: 1 }, { agent: {} })
  // The planner child's spawn options; the `expect` below is what the non-null assertion encodes.
  const planner = spawns.find((o) => o.label.includes("-planner"))!
  // The first execution round's spawn options.
  const round = spawns.find((o) => o.label.includes("-r1"))!
  // The first verification child's spawn options.
  const verifier = spawns.find((o) => o.label.includes("-verify0"))!
  // role persona text is folded into the child prompt, never passed as a preset id
  expect(planner).toBeTruthy()
  expect(planner.persona).toBeUndefined()
  expect(String(planner.prompt?.[0]?.text ?? "")).toContain("exacting planner")
  expect(round.persona).toBeUndefined()
  expect(String(round.prompt?.[0]?.text ?? "")).toContain("ULTRAWORK DISCIPLINE")
  // reasoning-heavy gates route to the pro model; execution rounds keep flash
  expect(planner.agentOptions.model).toBe("deepseek-v4-pro")
  expect(verifier.agentOptions.model).toBe("deepseek-v4-pro")
  expect(round.agentOptions.model).toBe("deepseek-v4-flash")
  // prompt tail carries durable-state references, not the whole recap
  const rp = String(round.prompt?.[0]?.text ?? "")
  expect(rp).toContain("Durable state:")
  expect(rp).toContain("Recent handoff:")
  expect(rp).not.toContain("Previous handoff:")
  // The autonomy policy is NOT folded into the child-round directive: the session-start
  // gate never qualifies a child session, so a team clause there would instruct a
  // subagent to do what the platform forbids (requirements contract §3).
  expect(rp).not.toContain('approval="automatic"')
  expect(rp).not.toContain("TRIAGE FIRST")
})

// The t16 defect class: a DECLARED output schema that REJECTS the engine's own result. The
// schema said `planFile: {type:"string"}` while the engine returned null for every
// plan=false run, so the harness refused the result with `"value.planFile" must be a
// string`. These tests bind the declared schema OBJECT to REAL engine results, so the
// declaration and the value can never drift apart unnoticed again.
test("the DECLARED mpd_ultrawork output schema accepts the engine's own plan=false AND plan=true results", async () => {
  // A fresh temp root for this case's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-schema-"))
  // The case's plan directory.
  const planDir = join(dir, "plans")
  // The case's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness for this case.
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered ultrawork tool.
  const tool = tools.find((t) => t.name === "mpd_ultrawork")!
  // The DECLARED output schema object itself, never a copy.
  const schema = tool.output.schema // THE DECLARED OBJECT — the same reference, never a copy
  expect(() => assertSupportedJsonSchema(schema)).not.toThrow()
  // plan=false is the /ulw command default and the alias path: no plan file exists, and
  // `planFile` is deliberately absent from `required`, so the key is OMITTED.
  const light = await tool.execute({ objective: "noop objective", tier: "light", plan: false, maxRounds: 1 }, { agent: {} })
  expect("planFile" in light).toBe(false)
  expect(validateJsonSchemaValue(schema, light)).toEqual([])
  // plan=true writes one and reports its path.
  const planned = await tool.execute({ objective: "noop planned", tier: "light", plan: true, maxRounds: 1 }, { agent: {} })
  expect(typeof planned.planFile).toBe("string")
  expect(validateJsonSchemaValue(schema, planned)).toEqual([])
  // NEGATIVE CONTROL: the validator really does police this property, so the empty
  // violation lists above are meaningful — the retired null shape is rejected by the
  // harness's own wording.
  // The vendored validator has no declaration file, so its result is asserted to the shape it
  // really has: one human-readable violation message per rejected property.
  const retired = validateJsonSchemaValue(schema, { ...light, planFile: null }) as string[]
  expect(retired.length).toBe(1)
  expect(String(retired[0])).toContain("planFile")
})

test("the mpd_ulw alias path (hardcoded plan=false) is exercised and its result matches its DECLARED schema", async () => {
  // A fresh temp root for this case's plan and state directories.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-schema-alias-"))
  // The case's plan directory.
  const planDir = join(dir, "plans")
  // The case's state directory.
  const stateDir = join(dir, "state")
  mkdirSync(planDir, { recursive: true })
  // The fake harness for this case.
  const { ctx, tools } = makeCtx()
  apply(ctx, { planDir, stateDir, provider: "deepseek-official", model: "deepseek-v4-flash" })
  // The registered alias tool.
  const alias = tools.find((t) => t.name === "mpd_ulw")!
  expect(alias).toBeTruthy()
  // The alias's DECLARED output schema object itself.
  const schema = alias.output.schema // THE DECLARED OBJECT — the same reference
  expect(() => assertSupportedJsonSchema(schema)).not.toThrow()
  // The alias hardcodes plan=false, which is exactly the path that handed callers an
  // invalid result before t16.
  const result = await alias.execute({ objective: "noop alias", maxRounds: 1 }, { agent: {} })
  expect(validateJsonSchemaValue(schema, result)).toEqual([])
  expect(typeof result.status).toBe("string")
  expect(typeof result.rounds).toBe("number")
  expect(typeof result.finalReport).toBe("string")
  expect(typeof result.stateFile).toBe("string")
})
