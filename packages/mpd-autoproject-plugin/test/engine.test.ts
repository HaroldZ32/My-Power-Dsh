// THE ENGINE'S CONTRACT, arm by arm (wave W1-B2).
//
// These arms exist to prove the four cuts the wave made, and they are written against the SEAMS rather
// than against the implementation's private helpers:
//
//   1. ROSTER ROUTING — every child is one `mpd_role_spawn` call, and the fake subagent seam THROWS if
//      anything reaches for it, so a resurrected `dsh.spawnAgent` (or a persona/provider override) is a
//      red test, not a code-review note.
//   2. VERIFY PLANE — `complete` needs a RECORD the verify plane wrote on disk. An arm where the child
//      merely SAYS `VERDICT: PASS` and no record exists must end `blocked`, which is the "never fake a
//      second verdict" rule in executable form.
//   3. BOULDER LEDGER — a plan run starts a work, drives a timer per criterion and completes it, and the
//      emitted plan's `## TODOs` count equals the criteria count when read by the REAL
//      `mpd_boulder_plan_progress` tool this package registers.
//   4. ESCALATION — the pure predicate's firing combinations, the three modes, the artifact, and the
//      anchored goal staying ARMED.
//
// The fake registry executes the package's own registered tools (the boulder ledger) for real, so those
// arms exercise the shipped code; the roster and verify tools are seam doubles because their bodies live
// in other rows.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import { ESCALATION_DEFAULTS, evaluateEscalation, evidenceAttribution, recommendationStatus, recommendationVerdict, resolveEscalationMode, topLevelScope } from "../src/escalation.ts"
// The HARNESS'S OWN output validator (vendored): the DECLARED output schema is checked exactly as the
// harness checks a tool result at runtime, so a schema/result drift is a red arm.
import { assertSupportedJsonSchema, validateJsonSchemaValue } from "../../mpd-schemastery/harness/dsh-tools/lib/index.ts"

/** The loop id the fake verify plane mints. */
const LOOP_ID = "loop-autoproject-test"

/** One registered tool definition, as the fake registry captured it. */
interface CapturedToolDef {
  /** The tool's name. */
  name: string
  /** The tool body, called with `(arguments, exec)` exactly as the harness calls it. */
  execute: (args: any, exec: any) => unknown
  /** The declared output contract, when the tool has one. */
  output?: { schema: Record<string, unknown> }
  /** The DECLARED argument schema, kept loose: these arms only read `properties.scope`. */
  parameters?: { properties?: Record<string, any> }
}

/** One `executeTool` call the engine made, in call order. */
interface ExecutedCall {
  /** The tool name. */
  name: string
  /** The arguments object the engine passed. */
  arguments: any
  /** The agent handle the call was attributed to. */
  agent?: unknown
}

/** One seam tool: what the fake `executeTool` answers for a name it does not find in the registry. */
interface SeamTool {
  /** The seam body; receives `(arguments, exec)` and answers the raw tool value. */
  execute: (args: any, exec: any) => unknown
}

/** The knobs one arm varies on the fake roster/verify plane. */
interface HarnessOptions {
  /** Whether the verifying Reviewer really writes a PASS record into the workspace. */
  recordPass?: boolean
  /** What the verifying Reviewer declares on its first line. */
  verifyVerdict?: "VERDICT: PASS" | "VERDICT: FAIL"
  /** The per-lane quality verdicts, in quality-lane order. */
  lanes?: ("VERDICT: PASS" | "VERDICT: FAIL")[]
  /** What every execution round declares on the first line of its `recommendation`. */
  roundStatus?: "STATUS: complete" | "STATUS: continue" | "STATUS: blocked"
  /** The criteria the planner reports in `evidence`. */
  criteria?: string[]
  /** Whether the goal bridge auto-anchors, i.e. whether this run holds a durable goal at all. */
  goal?: boolean
  /** Whether `cellwork_open` is registered (the wave-W2 hand-off route). */
  cellwork?: boolean
  /** A role whose spawn REFUSES with the unconfigured-route error, proving the degrade rule. */
  unconfiguredRole?: string
  /** What the PLAN REVIEWER declares: the plan gate's own verdict. */
  planReviewVerdict?: "VERDICT: PASS" | "VERDICT: FAIL"
  /** The LIVE `autoproject.slots` value this arm sets, or undefined to leave the live layer silent. */
  slots?: number
  /** The LIVE `autoproject.slotBoundMs` value this arm sets, or undefined for the shipped default. */
  slotBoundMs?: number
  /** A role whose consult NEVER settles, which is how a hung child is simulated. */
  hangRole?: string
  /** A role whose consult reports `status:"interrupted"` — the roster deadman's settlement (§D0.2). */
  interruptRole?: string
  /** Any further LIVE `mpd.jsonc` keys this arm sets, so a run can switch escalation off. */
  liveConfig?: Record<string, unknown>
}

/** The fake harness plus every handle the assertions read. */
interface Harness {
  /** The host context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** Every tool the package registered, in registration order. */
  tools: CapturedToolDef[]
  /** Every `executeTool` call the engine made, in call order. */
  calls: ExecutedCall[]
  /** The one live agent, whose session cwd IS the sandbox workspace. */
  agent: { session: { header: { cwd: string } } }
  /** The sandbox workspace root. */
  workspace: string
  /** The objectives the goal bridge anchored, in call order. */
  goalAnchors: string[]
  /** The outcome words the goal bridge was asked to record, in call order. */
  goalFinishes: string[]
  /** The highest number of roster consults in flight at once, which is what the slot cap bounds. */
  peakInFlight: () => number
}

/**
 * The plan file's counted checklist items, read the way boulder's structured grammar reads them.
 *
 * @param planPath - the plan document to scan.
 * @returns the numbered `- [ ] N. label` lines, in document order.
 */
function checklistItems(planPath: string): string[] {
  return readFileSync(planPath, "utf8").split(/\r?\n/).filter((line) => /^- \[[ xX]\] [1-9]\d*\. /.test(line))
}

/**
 * Build one fake harness whose seams answer like the real rows do.
 *
 * @param options - the knobs this arm varies.
 * @returns the harness handles the arm asserts on.
 */
function makeHarness(options: HarnessOptions = {}): Harness {
  /** A fresh sandbox workspace: no arm may touch the repository's own state roots. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-autoproject-engine-"))
  /** Tool definitions the fake registry received. */
  const tools: CapturedToolDef[] = []
  /** Every `executeTool` call, in call order. */
  const calls: ExecutedCall[] = []
  /** The goal anchors the fake bridge made. */
  const goalAnchors: string[] = []
  /** The goal finishes the fake bridge received. */
  const goalFinishes: string[] = []
  /** The one live agent; its session cwd is the workspace the adapter resolves. */
  const agent = { session: { header: { cwd: workspace } } }
  /** The criteria the planner reports; one criterion per entry. */
  const criteria = options.criteria ?? ["criterion one"]
  /** Roster consults currently in flight, and the high-water mark this arm asserts on. */
  let inFlight = 0
  /** The highest concurrency observed during the run. */
  let peakInFlight = 0

  /**
   * Write the verify plane's PASS record for one loop, the way a real verifier's call would.
   *
   * @param loopId - the loop the record belongs to.
   */
  function recordPass(loopId: string): void {
    /** The verify plane's record directory, under the sandbox workspace. */
    const dir = join(workspace, ".mpd", "verify", "records")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "rec-" + loopId + ".json"), JSON.stringify({ recordId: "rec-" + loopId, loopId, writerId: "w", verifierId: "v", verdict: "PASS", createdAt: new Date().toISOString() }))
  }

  /**
   * Answer one roster consult the way the roster would, keyed by role.
   *
   * The execution-role answer attributes ONE proof per criterion with the `<key>:: ` prefix, which is
   * the single attribution rule the engine parses.
   *
   * @param args - the `mpd_role_spawn` arguments.
   * @returns the fixed report shape the roster's own `REPORT_SCHEMA` declares.
   */
  function roleReport(args: any): Record<string, unknown> | Promise<Record<string, unknown>> {
    /** The role the engine asked for. */
    const role = String(args?.role ?? "")
    // AN INTERRUPTED CONSULT — the roster's deadman already wrote the handoff and interrupted the
    // child (§D2.6), so the engine must see a KILLED slot, never a silent null (§D0.2).
    if (options.interruptRole !== undefined && role === options.interruptRole) {
      return { role, status: "interrupted", summary: "consult interrupted by the 15-minute deadman", recommendation: "", details: "", evidence: [], stopReason: "interrupted", consultId: "consult-test", handoff: join(workspace, ".mpd", "handoff", "consult-test.md"), elapsedMs: 900_000 }
    }
    // A HUNG CHILD: the promise never settles, which is exactly the failure the hard bound exists for.
    if (options.hangRole !== undefined && role === options.hangRole) return new Promise<Record<string, unknown>>(() => {})
    /** The task text, which is how these doubles tell the verify consult from a quality lane. */
    const task = String(args?.task ?? "")
    if (role === options.unconfiguredRole) {
      throw new Error("AGENT_UNCONFIGURED: " + role + " has no configured route (agentRoutes." + role + ".provider/.model are unset)")
    }
    if (role === "Planner") {
      return { role, status: "complete", summary: "plan written", recommendation: "REVIEW: optional", details: "# Plan\n\nDo the work.", evidence: criteria }
    }
    if (role === "Plan Reviewer") return { role, status: "complete", summary: options.planReviewVerdict === "VERDICT: FAIL" ? "the plan is not actionable yet" : "plan approved", recommendation: options.planReviewVerdict ?? "VERDICT: PASS", details: "", evidence: [] }
    if (role === "Architect") return { role, status: "complete", summary: "angle: scope creep is unstated", recommendation: "", details: "", evidence: [] }
    if (role === "Deep Worker" || role === "Senior Engineer" || role === "Junior Engineer") {
      return {
        role,
        status: "complete",
        summary: "round done",
        recommendation: options.roundStatus ?? "STATUS: complete",
        details: "",
        evidence: criteria.map((label, index) => (index + 1) + ":: proven: " + label),
      }
    }
    if (role === "Reviewer") {
      // A verification consult opens with its loop instruction; a quality lane names the lane it judges.
      if (task.startsWith("Verify this autoproject run")) {
        /** The verdict this Reviewer declares. */
        const declared = options.verifyVerdict ?? "VERDICT: PASS"
        // A REAL verifier writes the record; the arm that omits it is the "claims PASS, proves nothing" case.
        if (declared === "VERDICT: PASS" && options.recordPass === true) recordPass(LOOP_ID)
        return { role, status: "complete", summary: declared === "VERDICT: PASS" ? "verified" : "criterion 1 still fails", recommendation: declared, details: "", evidence: [] }
      }
      /** Which quality lane this consult judges, by position in the task text. */
      const lane = ["code quality", "hands-on QA", "goal verification"].findIndex((name) => task.includes("lane of this autoproject run: " + name))
      return { role, status: "complete", summary: "lane judged", recommendation: options.lanes?.[lane] ?? "VERDICT: PASS", details: "", evidence: [] }
    }
    return { role, status: "complete", summary: "ok", recommendation: "", details: "", evidence: [] }
  }

  /** The seam tools the fake `executeTool` answers before it falls back to the package's own registry. */
  const seam = new Map<string, SeamTool>()
  seam.set("mpd_role_spawn", { execute: (args: any) => roleReport(args) })
  seam.set("mpd_verify_open", { execute: () => ({ loopId: LOOP_ID, writer: { kind: "delegate" }, verifier: { id: "unbound" }, scope: [], expiresAt: new Date().toISOString() }) })
  if (options.cellwork === true) seam.set("cellwork_open", { execute: () => ({ cellId: "cell-test" }) })

  /** The tools registry: what `registerTool` writes, `hasTool` reads and `executeTool` drives. */
  const toolsService = {
    /** Register one definition; the fake never removes one. */
    register(definition: CapturedToolDef): void { tools.push(definition) },
    /** Resolve one name, seam first so a shared name stays a seam double. */
    get(name: string): unknown { return seam.get(name) ?? tools.find((tool) => tool.name === name) },
    /**
     * Execute one tool by name. The package's OWN tools run for real (the boulder ledger), while the
     * cross-row tools are seam doubles.
     *
     * @param input - the harness's call description.
     * @returns the harness's `{value}` / `{isError}` result shape.
     */
    async execute(input: { name?: unknown; arguments?: unknown; agent?: unknown }): Promise<unknown> {
      /** The name the caller asked for. */
      const name = String(input?.name ?? "")
      calls.push({ name, arguments: input?.arguments, agent: input?.agent })
      /** The seam double of that name, when this arm holds one. */
      const doubled = seam.get(name)
      try {
        if (doubled !== undefined) {
          // IN-FLIGHT ACCOUNTING: one bracket per roster consult, so the slot cap is observable.
          inFlight += 1
          if (inFlight > peakInFlight) peakInFlight = inFlight
          try {
            return { value: await doubled.execute(input?.arguments, { agent: input?.agent }) }
          } finally {
            // A HUNG child never reaches this line, which is the point: it is still in flight when the
            // bound fires, and the SLOT (not this counter) is what the engine must release.
            inFlight -= 1
          }
        }
        /** The package's own registered tool. */
        const registered = tools.find((tool) => tool.name === name)
        if (registered === undefined) return { isError: true, error: { message: "unknown tool " + name } }
        return { value: await registered.execute(input?.arguments, { agent: input?.agent }) }
      } catch (error) {
        return { isError: true, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    },
  }
  /** The fake goal bridge: it records both anchor and finish, which the escalation arm asserts on. */
  const goalService = {
    /** Whether this arm's run holds a durable goal at all. */
    autoAnchor: (): boolean => options.goal === true,
    /** Record one anchor and answer the same goal id every time. */
    anchor: async (_exec: unknown, input: { objective: string }): Promise<{ ok: boolean; created: boolean; goal: { id: string } }> => { goalAnchors.push(input.objective); return { ok: true, created: true, goal: { id: "goal-test" } } },
    /** Record one finish request; the engine must never send one for an escalated run. */
    finish: async (_exec: unknown, input: { outcome: string }): Promise<{ ok: boolean; outcome: string }> => { goalFinishes.push(input.outcome); return { ok: true, outcome: input.outcome } },
  }
  /** The services the adapter resolves by name. `subagents` THROWS on purpose: no child may use it. */
  const services: Record<string, unknown> = {
    // THE LIVE LAYER the slot knobs are read from, present only when an arm set one: the engine reads
    // `autoproject.slots` / `autoproject.slotBoundMs` per run and must NOT capture them at mount.
    ...(options.slots === undefined && options.slotBoundMs === undefined && options.liveConfig === undefined ? {} : {
      mpdConfig: {
        /** Answer one live config key; an unset knob reads as undefined so the default applies. */
        get: (key: string): unknown => (key === "autoproject.slots" ? options.slots : key === "autoproject.slotBoundMs" ? options.slotBoundMs : options.liveConfig?.[key])
      }
    }),
    tools: toolsService,
    agents: { list: (): unknown[] => [agent] },
    commands: { register: (): (() => void) => () => {} },
    mpdGoal: goalService,
    subagents: {
      start: (): never => { throw new Error("the fake subagent seam must never be reached: every child is a roster consult") },
      startActivation: (): never => { throw new Error("the fake subagent seam must never be reached: every child is a roster consult") },
    },
  }
  /** The fake host context. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: toolsService,
    // The row declares the subagent seam at mount, but NOTHING in this package may use it: the value is
    // the throwing double, so a resurrected direct spawn reddens instead of quietly running.
    subagents: services.subagents,
    /** Run the cleanup callback immediately, as a real `ctx.effect` does on dispose. */
    effect(fn: () => unknown): void { fn() },
    /** Resolve one of the services the adapter asks for, from the table above. */
    get(service: string): unknown { return services[service] },
    /** Subscribe a listener; these arms install none, so the disposer is a no-op. */
    on(_event: string): () => void { return () => {} },
  }
  return { ctx, tools, calls, agent, workspace, goalAnchors, goalFinishes, peakInFlight: () => peakInFlight }
}

/**
 * The row config every arm starts from: temp roots under the sandbox workspace, no live config layer.
 *
 * @param workspace - the sandbox workspace root.
 * @returns the config handed to `apply`.
 */
function rowConfig(workspace: string): NonNullable<Parameters<typeof apply>[1]> {
  return { planDir: join(workspace, "plans"), stateDir: join(workspace, "state"), maxReReviews: 2 }
}

test("the run routes EVERY child through mpd_role_spawn and completes through the verify plane", async () => {
  // The fake harness: a plan run whose verifier really records a PASS.
  const h = makeHarness({ recordPass: true, criteria: ["create the file", "cover the edge case"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  expect(tool).toBeTruthy()
  // The run itself.
  const res = await tool.execute({ objective: "create the widget with the edge case covered", tier: "light", plan: true, strictReview: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("complete")
  expect(res.rounds).toBe(1)
  expect(res.verdict).toBe("approve")
  expect(typeof res.planFile).toBe("string")
  // ACCEPTANCE (1): every child is a roster consult, and NOTHING reached the subagent seam (which throws).
  const consults = h.calls.filter((call) => call.name === "mpd_role_spawn")
  expect(consults.length).toBeGreaterThan(0)
  for (const consult of consults) {
    expect(typeof consult.arguments.role).toBe("string")
    expect(typeof consult.arguments.task).toBe("string")
    // No per-child route override survives the cut: the roster's agentRoutes entry decides the model.
    expect("provider" in consult.arguments).toBe(false)
    expect("model" in consult.arguments).toBe(false)
    expect("persona" in consult.arguments).toBe(false)
  }
  // The role map the contract fixes: Planner for the plan, Senior Engineer for a planned light round,
  // Reviewer for verification and for each quality lane.
  const roles = consults.map((consult) => String(consult.arguments.role))
  expect(roles).toContain("Planner")
  expect(roles).toContain("Senior Engineer")
  expect(roles.filter((role) => role === "Reviewer").length).toBeGreaterThanOrEqual(4)
  // The verify plane was opened once, and the boulder ledger was started and completed once.
  expect(h.calls.filter((call) => call.name === "mpd_verify_open").length).toBe(1)
  expect(h.calls.filter((call) => call.name === "mpd_boulder_start").length).toBe(1)
  expect(h.calls.filter((call) => call.name === "mpd_boulder_complete").length).toBe(1)
  // The journal carries the three quality lanes and the approval; it is a JOURNAL, never a verdict.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain("quality-code quality")
  expect(ledger).toContain("quality-hands-on QA")
  expect(ledger).toContain("quality-goal verification")
  expect(ledger).toContain('"lane":"verification","verdict":"approve"')
})

test("a run can NOT report complete when the verifier claims PASS but no record was written", async () => {
  // The child SAYS PASS and writes nothing: the exact second-verdict shape the wave deletes.
  const h = makeHarness({ recordPass: false, verifyVerdict: "VERDICT: PASS", criteria: ["one criterion"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run, which must not be able to claim completion.
  const res = await tool.execute({ objective: "do the one thing", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).toBe("blocked")
  expect(res.verdict).toBe("reject")
  expect(String(res.finalReport)).toContain("no PASS record")
  // The state document agrees with the result.
  const state = JSON.parse(readFileSync(res.stateFile, "utf8")) as { status: string }
  expect(state.status).toBe("blocked")
})

test("a quality-gate lane that FAILs blocks completion and is stamped in the ledger", async () => {
  // The fake harness with the QA lane canned to FAIL; verification itself passes.
  const h = makeHarness({ recordPass: true, lanes: ["VERDICT: PASS", "VERDICT: FAIL", "VERDICT: PASS"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run, blocked by the single failing lane.
  const res = await tool.execute({ objective: "do the thing", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).toBe("blocked")
  expect(res.verdict).toBe("approve")
  expect(res.ledger.find((row: any) => row.lane === "hands-on QA")?.verdict).toBe("FAIL")
  // The journal records the failing lane, so the bounce is auditable.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"quality-hands-on QA","verdict":"FAIL"')
})

test("a plan run drives the boulder ledger, and the emitted checklist matches the criteria count", async () => {
  // The fake harness with three criteria, so an off-by-one in the emitted checklist is visible.
  const h = makeHarness({ recordPass: true, criteria: ["first criterion", "second criterion", "third criterion"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run.
  const res = await tool.execute({ objective: "ship three things", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  // The emitted plan is the CHECKLIST the engine generated, not the planner's prose.
  const items = checklistItems(res.planFile)
  expect(items.length).toBe(3)
  // The REAL boulder progress tool this package registers reads the same count.
  const progress = h.tools.find((entry) => entry.name === "mpd_boulder_plan_progress")!
  /** The progress the REAL boulder reader reports for the emitted plan. */
  const measured = await progress.execute({ planPath: res.planFile }, { agent: h.agent }) as { progress: { total: number; completed: number } }
  expect(measured.progress.total).toBe(3)
  expect(measured.progress.completed).toBe(0)
  // A per-criterion timer was started AND ended for every criterion, inside the work this run started.
  const timers = h.calls.filter((call) => call.name === "mpd_boulder_task_timer")
  /** The criterion keys whose timer was STARTED. */
  const started = timers.filter((call) => call.arguments.action === "start").map((call) => String(call.arguments.taskKey))
  /** The criterion keys whose timer was ENDED. */
  const ended = timers.filter((call) => call.arguments.action === "end").map((call) => String(call.arguments.taskKey))
  expect(started.sort()).toEqual(["1", "2", "3"])
  expect(ended.sort()).toEqual(["1", "2", "3"])
  // The ledger the boulder tools wrote is the durable truth the TUI and complexity signal D read.
  expect(existsSync(join(h.workspace, ".mpd", "boulder.json"))).toBe(true)
})

test("an unconfigured roster role is journaled and the run continues, never a hard failure", async () => {
  // The Planner's route is missing: the roster refuses that ONE consult, and the run must survive it.
  const h = makeHarness({ recordPass: true, unconfiguredRole: "Planner", criteria: ["only criterion"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run: it falls back to the objective as its one criterion and still completes.
  const res = await tool.execute({ objective: "do the only thing", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).toBe("complete")
  // The contract's exact ledger token for this class, plus the fallback it forced.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain("route-unconfigured:Planner")
  expect(ledger).toContain("criteria-fallback")
})

test("a HEAVY run raises its round as a Deep Worker and its angle wave as Architect consults", async () => {
  // The fake harness, complete with the hyperplan wave.
  const h = makeHarness({ recordPass: true, criteria: ["heavy criterion"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The heavy run with the adversarial wave.
  const res = await tool.execute({ objective: "replace the auth store", tier: "heavy", hyperplan: true, maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).toBe("complete")
  // Every angle is an Architect consult whose CONTEXT carries the angle text (an angle, never a persona).
  const angles = h.calls.filter((call) => call.name === "mpd_role_spawn" && call.arguments.role === "Architect")
  expect(angles.length).toBe(5)
  for (const angle of angles) expect(String(angle.arguments.context)).toContain("Angle ")
  // The execution round of a heavy tier is the Deep Worker, and a heavy plan is always reviewed.
  const roles = h.calls.filter((call) => call.name === "mpd_role_spawn").map((call) => String(call.arguments.role))
  expect(roles).toContain("Deep Worker")
  expect(roles).toContain("Plan Reviewer")
})

test("escalation: the frozen predicate fires on the contract's combinations and nowhere else", () => {
  // A boundary that trips nothing: every counter under its threshold and no self-sufficient signal.
  const calm = { criteria: 3, status: "complete", fruitlessWaves: 0, ledgerBytes: 1024, scopeTrees: 2, sameCriterionVerifyFails: 0, config: ESCALATION_DEFAULTS }
  expect(evaluateEscalation(calm).escalate).toBe(false)
  // S2 ALONE is self-sufficient: the round cap means the engine ran out of its own budget.
  expect(evaluateEscalation({ ...calm, status: "max-rounds" }).escalate).toBe(true)
  // S3 ALONE is self-sufficient: the discovery stall the discipline already stops on.
  expect(evaluateEscalation({ ...calm, fruitlessWaves: 2 }).escalate).toBe(true)
  // ONE counter alone is NOT enough — S1 included, which is the R-W1B2 repair: 13 criteria used to supply
  // a SECOND counter (S5) from the same number and escalate on that one fact.
  expect(evaluateEscalation({ ...calm, criteria: 13 }).escalate).toBe(false)
  expect(evaluateEscalation({ ...calm, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax + 1 }).escalate).toBe(false)
  // TWO counters together ARE: the composite threshold is the point (S4 is the second one here).
  expect(evaluateEscalation({ ...calm, criteria: 13, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax + 1 }).escalate).toBe(true)
  expect(evaluateEscalation({ ...calm, scopeTrees: 21, sameCriterionVerifyFails: 2 }).escalate).toBe(true)
  // The fired list names the signals in id order, with the value and the threshold it was read against.
  const fired = evaluateEscalation({ ...calm, criteria: 13, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax + 1 }).signals
  expect(fired.map((signal) => signal.id)).toEqual(["S1", "S4"])
  expect(fired[0]).toEqual({ id: "S1", value: 13, threshold: ESCALATION_DEFAULTS.criteriaMax })
  // THE RETIRED ID IS ABSENT, not renumbered: S5 cannot appear, and S6/S7 kept their ids.
  expect(fired.some((signal) => signal.id === "S5")).toBe(false)
  // The MODE never decides whether a signal fired — it only selects what happens next.
  expect(resolveEscalationMode("off")).toBe("off")
  expect(resolveEscalationMode("auto")).toBe("auto")
  expect(resolveEscalationMode(undefined)).toBe("ask")
})

test("escalation: mode=ask ends the run escalated, writes the artifact and LEAVES THE GOAL ARMED", async () => {
  // A run that can never finish its criterion: every round declares `continue`, so S2 fires at the cap.
  const h = makeHarness({ recordPass: true, roundStatus: "STATUS: continue", goal: true, criteria: ["never satisfied"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run, which must hand over instead of claiming anything.
  const res = await tool.execute({ objective: "a project that will not fit", tier: "light", plan: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("escalated")
  // The artifact names the decision, its signals, the objective, the mandate and the hand-off path.
  const artifact = JSON.parse(readFileSync(join(dirname(res.stateFile), "escalation.json"), "utf8")) as any
  expect(artifact.mode).toBe("ask")
  expect(artifact.signals.map((signal: any) => signal.id)).toContain("S2")
  expect(artifact.objective).toBe("a project that will not fit")
  expect(artifact.mandate.source).toBe("autoproject")
  expect(artifact.mandate.planFile).toBe(res.planFile)
  expect(artifact.handoff.path).toBe("instruction")
  // The state document records the escalation, and the run NEVER completed the goal it anchored.
  const state = JSON.parse(readFileSync(res.stateFile, "utf8")) as { status: string; goalId?: string }
  expect(state.status).toBe("escalated")
  expect(state.goalId).toBe("goal-test")
  expect(h.goalAnchors.length).toBeGreaterThan(0)
  expect(h.goalFinishes).toEqual([])
  // The report tells the caller the one instruction that continues the project elsewhere.
  expect(String(res.finalReport)).toContain("/cellwork a project that will not fit")
})

test("escalation: mode=off records the firing and takes NO consequence", async () => {
  // The same never-finishing run, with the consequence suppressed in the row config.
  const h = makeHarness({ recordPass: true, roundStatus: "STATUS: continue", criteria: ["never satisfied"] })
  apply(h.ctx, { ...rowConfig(h.workspace), escalate: { mode: "off" } })
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run keeps the ordinary round-cap outcome.
  const res = await tool.execute({ objective: "a project that will not fit", tier: "light", plan: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("max-rounds")
  expect(existsSync(join(dirname(res.stateFile), "escalation.json"))).toBe(false)
  // The firing is still on the record: the mode never decides whether a signal fired.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"escalation","verdict":"suppressed"')
})

test("escalation: mode=auto hands off through cellwork_open when that tool exists", async () => {
  // The same run, with wave W2's programmatic cellwork entry registered.
  const h = makeHarness({ recordPass: true, roundStatus: "STATUS: continue", criteria: ["never satisfied"], cellwork: true })
  apply(h.ctx, { ...rowConfig(h.workspace), escalate: { mode: "auto" } })
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run, which hands off instead of instructing a human.
  const res = await tool.execute({ objective: "a project that will not fit", tier: "light", plan: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("escalated")
  // The programmatic route is the one that was taken, and the artifact says so.
  const artifact = JSON.parse(readFileSync(join(dirname(res.stateFile), "escalation.json"), "utf8")) as any
  expect(artifact.handoff.path).toBe("cellwork_open")
  expect(h.calls.some((call) => call.name === "cellwork_open")).toBe(true)
})

test("a plan-less run still verifies through the plane, and its result matches the DECLARED schema", async () => {
  // The fake harness: no plan, so the objective is the one criterion and the loop takes the default contract.
  const h = makeHarness({ recordPass: true })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool, with its DECLARED output schema object itself.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The DECLARED output schema object itself, never a copy. */
  const schema = tool.output!.schema
  expect(() => assertSupportedJsonSchema(schema)).not.toThrow()
  // The plan-less run.
  const light = await tool.execute({ objective: "noop objective", tier: "light", plan: false, maxRounds: 1 }, { agent: h.agent }) as any
  expect(light.status).toBe("complete")
  // The plan file key is OMITTED, never null: the declared schema types it as a string when present.
  expect("planFile" in light).toBe(false)
  expect(validateJsonSchemaValue(schema, light)).toEqual([])
  // The verify loop carried no `contract`: there is no plan file to freeze.
  const opened = h.calls.find((call) => call.name === "mpd_verify_open")!
  expect("contract" in opened.arguments).toBe(false)
  // The negative control: the retired null shape really is rejected by the harness's own validator.
  const retired = validateJsonSchemaValue(schema, { ...light, planFile: null }) as string[]
  expect(retired.length).toBe(1)
  expect(String(retired[0])).toContain("planFile")
})

test("a rejected plan gate keeps the run from completing, however clean its rounds are", async () => {
  // The plan reviewer rejects and keeps rejecting: the rounds still come back clean, which is exactly the
  // combination a toothless plan gate would let through as `complete`.
  const h = makeHarness({ recordPass: true, planReviewVerdict: "VERDICT: FAIL", criteria: ["one criterion"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // A HEAVY run forces the plan review, and its round reports `complete`.
  const res = await tool.execute({ objective: "ship the reviewed plan", tier: "heavy", maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).not.toBe("complete")
  // The journal shows the gate that refused, so the outcome is attributable to the plan and not to a round.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"plan-review"')
  expect(ledger).toContain('"verdict":"reject"')
  // Verification never ran, so no verdict may be claimed for it.
  expect(res.verdict).toBe("n/a")
})

test("the pure readers turn a roster report into engine state the way the contract states", () => {
  // The status token lives on the FIRST line and nowhere else.
  expect(recommendationStatus("STATUS: complete\nrest of the report")).toBe("complete")
  expect(recommendationStatus("**STATUS:** blocked")).toBe("blocked")
  expect(recommendationStatus("nothing to see here")).toBeUndefined()
  // Both accepted verdict spellings answer the same token, so a synonym cannot slip a lane through.
  expect(recommendationVerdict("VERDICT: PASS")).toBe("PASS")
  expect(recommendationVerdict("verdict=approve")).toBe("PASS")
  expect(recommendationVerdict("VERDICT: FAIL")).toBe("FAIL")
  expect(recommendationVerdict("looks fine to me")).toBeUndefined()
  // The attribution rule is a strict prefix match, never a mention inside prose.
  expect(evidenceAttribution("2:: the edge case is covered")).toEqual({ key: "2", text: "the edge case is covered" })
  expect(evidenceAttribution("criterion 2 is mentioned in prose")).toBeUndefined()
  // The scope derivation counts distinct top-level trees and ignores non-relative spellings.
  expect(topLevelScope(["packages/a/x.ts", "packages/b/y.ts", "/abs/path", "https://example.com/x", "no-slash", "../up/x", "./tests/z.ts"])).toEqual(["packages", "tests"])
})

// ── R-W1B2: the escalation repair, proved AT THE ENGINE BOUNDARY ─────────────────────────────────
//
// The reviewer's High 1 was an ENGINE-boundary defect that a pure-predicate arm could not see: the engine
// fed `checklist: criteria.size`, so a 13-criteria run supplied TWO counters (S1 and S5) for ONE fact.
// The probe that proved it (`evidence/autoproject-refactor/w1b2/probe-s1s5-collapse.log`) reads:
//   criteria=13 checklist=13 -> {"escalate":true,"signals":[{"id":"S1","value":13,"threshold":12},{"id":"S5","value":13,"threshold":8}]}
// The arms below run the SHIPPED engine and read its own `escalation.json`, which is why the same
// scenario now ends `complete` with no artifact: S5 is gone, and S1 alone is one counter.
//
// FALSIFIABILITY: restoring S5 (or feeding the predicate a second counter from the criteria) turns arm
// (a) red, because that run would escalate again; dropping the declared-scope wiring turns arm (c)'s
// positive half red; removing the fallback turns arm (d) red.

/** The number of criteria the repair arms use: one more than `criteriaMax`, so S1 fires and nothing else. */
const REPAIR_CRITERIA = 13

/** The criteria labels for a 13-criteria run, one per S1 unit. */
const REPAIR_LABELS = Array.from({ length: REPAIR_CRITERIA }, (_, index) => "criterion " + (index + 1))

/**
 * Read the escalation artifact of one run.
 *
 * @param stateFile - the run's `state.json` path, whose directory holds `escalation.json`.
 * @returns the parsed artifact, untyped on purpose (each arm asserts the fields it means).
 */
function artifactOf(stateFile: string): any {
  return JSON.parse(readFileSync(join(dirname(stateFile), "escalation.json"), "utf8"))
}

test("(a) a 13-criteria run with NO other signal does NOT escalate at the engine boundary", async () => {
  // The exact shape the reviewer proved broken: 13 criteria, no round cap, no stall, no drift.
  const h = makeHarness({ recordPass: true, criteria: REPAIR_LABELS })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run completes all 13 criteria in one round, so the only over-limit number is the criteria count.
  const res = await tool.execute({ objective: "ship thirteen criteria", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  // Before the repair this ended `escalated` with [S1,S5]; S5 is gone, so S1 is ONE counter and the run finishes.
  expect(res.status).toBe("complete")
  expect(existsSync(join(dirname(res.stateFile), "escalation.json"))).toBe(false)
  // The journal still records the scope provenance, because a non-escalated run is auditable too.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"scope","verdict":"evidence"')
})

test("(b) the SAME 13-criteria run escalates once a SECOND counter fires", async () => {
  // One behavioural knob is tightened so S4 (ledger bytes) fires alongside S1 — an INDEPENDENT counter.
  const h = makeHarness({ recordPass: true, criteria: REPAIR_LABELS })
  apply(h.ctx, { ...rowConfig(h.workspace), escalate: { ledgerBytesMax: 1 } })
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The same run, now two counters.
  const res = await tool.execute({ objective: "ship thirteen criteria", tier: "light", plan: true, maxRounds: 1 }, { agent: h.agent }) as any
  expect(res.status).toBe("escalated")
  // The artifact names BOTH counters and no retired id.
  const artifact = artifactOf(res.stateFile)
  expect(artifact.signals.map((signal: any) => signal.id)).toEqual(["S1", "S4"])
  expect(artifact.signals.some((signal: any) => signal.id === "S5")).toBe(false)
})

test("(c) a DECLARED scope drives S6, and the artifact says which source answered", async () => {
  // A ceiling of two trees, and three trees DECLARED: S6 fires on the declaration, not on the evidence.
  const declared = ["packages/mpd-autoproject-plugin/src", "docs/plans", "skills/dsh-qa"]
  /** The fake harness for the declared-scope run. */
  const h = makeHarness({ recordPass: true, criteria: REPAIR_LABELS })
  apply(h.ctx, { ...rowConfig(h.workspace), escalate: { scopePathsMax: 2 } })
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // THE DECLARED-SCOPE INPUT IS PART OF THE TOOL'S OWN SURFACE, not a hidden engine option: a caller
  // that cannot see it cannot declare anything.
  expect(tool.parameters?.properties?.scope.type).toBe("array")
  expect(tool.parameters?.properties?.scope.items.type).toBe("string")
  // S1 (13 criteria) + S6 (three declared trees) is two counters, so the run escalates.
  const res = await tool.execute({ objective: "ship thirteen criteria across three trees", tier: "light", plan: true, maxRounds: 1, scope: declared }, { agent: h.agent }) as any
  expect(res.status).toBe("escalated")
  /** The artifact of the declared-scope run. */
  const artifact = artifactOf(res.stateFile)
  expect(artifact.scopeSource).toBe("declared")
  expect(artifact.scope).toEqual(declared)
  expect(artifact.signals.map((signal: any) => signal.id)).toEqual(["S1", "S6"])
  // THE NEGATIVE CONTROL: the identical run WITHOUT the declaration derives its scope from the paths its
  // children evidenced — this harness's children cite none, so S6 does not fire and S1 is alone.
  const bare = makeHarness({ recordPass: true, criteria: REPAIR_LABELS })
  apply(bare.ctx, { ...rowConfig(bare.workspace), escalate: { scopePathsMax: 2 } })
  // The second run, which must NOT escalate.
  const bareRes = await bare.tools.find((entry) => entry.name === "mpd_autoproject")!.execute({ objective: "ship thirteen criteria across three trees", tier: "light", plan: true, maxRounds: 1 }, { agent: bare.agent }) as any
  expect(bareRes.status).toBe("complete")
  expect(existsSync(join(dirname(bareRes.stateFile), "escalation.json"))).toBe(false)
})

test("(d) an ABSENT scope keeps the evidence fallback, and the artifact says so", async () => {
  // A run that can never finish its criterion, so S2 (the round cap) alone escalates it.
  const h = makeHarness({ recordPass: true, roundStatus: "STATUS: continue", criteria: ["never satisfied"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  // The run, with no `scope` argument at all.
  const res = await tool.execute({ objective: "a project that will not fit", tier: "light", plan: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("escalated")
  /** The artifact of the fallback run. */
  const artifact = artifactOf(res.stateFile)
  // The evidence-derived trees are an array (empty here: the children cited no workspace path).
  expect(Array.isArray(artifact.scope)).toBe(true)
  expect(artifact.scopeSource).toBe("evidence")
  // The ledger says the same thing, exactly once.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger.split('"lane":"scope"').length - 1).toBe(1)
  expect(ledger).toContain('"lane":"scope","verdict":"evidence"')
})

test("(e) the retired S5 id never appears, and every renderer consumes a list without it", async () => {
  // A grid over the boundary inputs: a single signal at a time, then pairs, then everything at once.
  const base = { criteria: 0, status: "complete", fruitlessWaves: 0, ledgerBytes: 0, scopeTrees: 0, sameCriterionVerifyFails: 0, config: ESCALATION_DEFAULTS }
  /** The inputs the grid evaluates, one over-limit value at a time plus the combinations. */
  const grid = [
    { ...base, criteria: 99 },
    { ...base, status: "max-rounds" },
    { ...base, fruitlessWaves: 9 },
    { ...base, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax * 4 },
    { ...base, scopeTrees: 99 },
    { ...base, sameCriterionVerifyFails: 9 },
    { ...base, criteria: 99, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax * 4 },
    { ...base, criteria: 99, status: "max-rounds", fruitlessWaves: 9, ledgerBytes: ESCALATION_DEFAULTS.ledgerBytesMax * 4, scopeTrees: 99, sameCriterionVerifyFails: 9 },
  ]
  /** The live signal vocabulary a reader must expect — S5 ABSENT, every later id unmoved. */
  const live = ["S1", "S2", "S3", "S4", "S6", "S7"]
  for (const input of grid) {
    for (const signal of evaluateEscalation(input).signals) {
      expect(signal.id).not.toBe("S5")
      expect(live).toContain(signal.id)
    }
  }
  // The every-signal input really does fire several counters, so the grid is not vacuously empty.
  expect(evaluateEscalation(grid[grid.length - 1]).signals.length).toBeGreaterThan(4)
  // THE READERS: a produced artifact whose `signals` is missing S5, its ledger line, and the report text
  // all render a list the pre-repair build could not have produced. The run below escalates on S2 alone.
  const h = makeHarness({ recordPass: true, roundStatus: "STATUS: continue", criteria: ["never satisfied"] })
  apply(h.ctx, rowConfig(h.workspace))
  // The run that produces the S2-only artifact.
  const res = await h.tools.find((entry) => entry.name === "mpd_autoproject")!.execute({ objective: "a project that will not fit", tier: "light", plan: true, maxRounds: 2 }, { agent: h.agent }) as any
  /** The artifact of the S2-only escalation. */
  const artifact = artifactOf(res.stateFile)
  expect(artifact.signals.map((signal: any) => signal.id)).toEqual(["S2"])
  expect(JSON.stringify(artifact.signals).includes("S5")).toBe(false)
  // The ledger's escalation line carries exactly the fired ids, with no retired one.
  const ledger = readFileSync(join(dirname(res.stateFile), "ledger.jsonl"), "utf8")
  expect(ledger).toContain('"lane":"escalation","verdict":"fired"')
  expect(ledger).toContain("S2=1/1")
  expect(ledger.includes("S5=")).toBe(false)
  // The report the caller reads renders the same list.
  expect(String(res.finalReport)).toContain("escalated [S2]")
})

// ── W4-A2 — WORKER SLOTS AND THE HARD BOUND ────────────────────────────────────────────────────────
// A run must never be able to IMPLY "still working" while a child has hung. Every child holds a slot
// from launch to report, the slots are capped, and a child past `autoproject.slotBoundMs` is aborted,
// recorded, and turns the run BLOCKED.
test("(a) a child that NEVER settles is killed at the bound, its slot is released, and the run ends blocked", async () => {
  // A run whose execution child hangs forever, with ONE slot and a 30 ms bound.
  // Escalation is switched OFF for this arm on purpose: two fruitless rounds would otherwise fire S3 and
  // make the run `escalated`, which would hide the fact the arm is about — a killed child blocking it.
  const h = makeHarness({ hangRole: "Junior Engineer", slots: 1, slotBoundMs: 30, recordPass: true, criteria: ["create the file"], liveConfig: { "autoproject.escalate.mode": "off" } })
  apply(h.ctx, rowConfig(h.workspace))
  // The registered autoproject tool.
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The run's answer. */
  const res = await tool.execute({ objective: "create the widget", tier: "light", plan: false, maxRounds: 2 }, { agent: h.agent }) as any
  // BLOCKED, never `complete` and never "still running".
  expect(res.status).toBe("blocked")
  expect(String(res.finalReport)).toContain("slots: 2 child(ren) killed at the 30 ms bound")
  expect(String(res.finalReport)).toContain("Junior Engineer@")
  // THE DURABLE RECORD: state.json carries the bound, the cap, the peak and one timestamped kill row.
  /** The run's state document, read from disk. */
  const state = JSON.parse(readFileSync(res.stateFile, "utf8"))
  expect(state.slots).toBe(1)
  expect(state.slotBoundMs).toBe(30)
  expect(Array.isArray(state.kills)).toBe(true)
  // TWO kills: round 1's child hung, and round 2's child could only be RAISED because round 1's slot
  // came back — with ONE slot, a leaked slot would have deadlocked there instead.
  expect(state.kills.length).toBe(2)
  expect(state.kills[0]).toMatchObject({ role: "Junior Engineer", boundMs: 30 })
  expect(state.kills[0].elapsedMs).toBeGreaterThanOrEqual(25)
  expect(typeof state.kills[0].at).toBe("string")
  // THE JOURNAL carries `late/killed:<role>`, which is what a later reader greps for.
  /** The run's journal lines. */
  const journal = readFileSync(res.stateFile.replace(/state\.json$/, "ledger.jsonl"), "utf8")
  expect(journal).toContain("late/killed:Junior Engineer")
  // THE SLOT WAS RELEASED: with ONE slot, the verification and quality consults that come AFTER the
  // kill could only run if the killed child gave its slot back — a leaked slot would deadlock here.
  /** The consults that ran after the kill. */
  const roundConsults = h.calls.filter((call) => call.name === "mpd_role_spawn" && call.arguments?.role === "Junior Engineer")
  expect(roundConsults.length).toBe(2)
})

test("(b) autoproject.slots REALLY caps concurrent children (observed high-water mark)", async () => {
  // The hyperplan wave raises FIVE Architects in parallel, so a cap of 2 must be visible.
  const h = makeHarness({ slots: 2, slotBoundMs: 5_000, recordPass: true, criteria: ["create the file"] })
  apply(h.ctx, rowConfig(h.workspace))
  /** The registered autoproject tool. */
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The run's answer. */
  const res = await tool.execute({ objective: "create the widget", tier: "light", plan: false, hyperplan: true, maxRounds: 1 }, { agent: h.agent }) as any
  // Five angles were consulted …
  expect(h.calls.filter((call) => call.name === "mpd_role_spawn" && call.arguments?.role === "Architect").length).toBe(5)
  // … and never more than TWO were in flight at once.
  expect(h.peakInFlight()).toBe(2)
  expect(res.status).not.toBe("blocked")
})

test("(c) a THROWING child still releases its slot (the release is a finally, not a happy path)", async () => {
  // The execution role REFUSES with the unconfigured-route error; with one slot, a leaked slot would
  // deadlock every consult after it.
  const h = makeHarness({ unconfiguredRole: "Junior Engineer", slots: 1, slotBoundMs: 5_000, recordPass: true, criteria: ["create the file"] })
  apply(h.ctx, rowConfig(h.workspace))
  /** The registered autoproject tool. */
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The run's answer. */
  const res = await tool.execute({ objective: "create the widget", tier: "light", plan: false, maxRounds: 2 }, { agent: h.agent }) as any
  // The refusal degraded round 1, and round 2 was RAISED anyway: with ONE slot, a leaked slot would
  // have deadlocked the second consult instead of raising it.
  expect(h.calls.filter((call) => call.name === "mpd_role_spawn" && call.arguments?.role === "Junior Engineer").length).toBe(2)
  // Nothing was KILLED: a refusal is not a hang.
  /** The run's state document. */
  const state = JSON.parse(readFileSync(res.stateFile, "utf8"))
  expect(state.kills).toEqual([])
})

test("(d) a run that stays UNDER the bound reports complete exactly as before", async () => {
  // A normal plan run with slots and a generous bound: the accounting must not change the outcome.
  const h = makeHarness({ slots: 3, slotBoundMs: 5_000, recordPass: true, criteria: ["create the file", "cover the edge case"] })
  apply(h.ctx, rowConfig(h.workspace))
  /** The registered autoproject tool. */
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The run's answer. */
  const res = await tool.execute({ objective: "create the widget with the edge case covered", tier: "light", plan: true, strictReview: true, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("complete")
  /** The run's state document. */
  const state = JSON.parse(readFileSync(res.stateFile, "utf8"))
  expect(state.kills).toEqual([])
  expect(state.slots).toBe(3)
  expect(state.slotBoundMs).toBe(5_000)
  expect(state.slotsPeak).toBeGreaterThanOrEqual(1)
})

// §D0.2: an INTERRUPTED consult is a killed slot record, never a silent null — the existing `kills`
// ledger stays the only accounting, and the run is blocked exactly as a hard-bound kill blocks it.
test("(e) an interrupted consult records a SlotKill row and the ledger stamp, and blocks the run", async () => {
  /** The fake harness, whose Junior Engineer consult reports `interrupted`. */
  const h = makeHarness({ interruptRole: "Junior Engineer", recordPass: true, criteria: ["create the file"], slotBoundMs: 5_000, liveConfig: { "autoproject.escalate.mode": "off" } })
  apply(h.ctx, rowConfig(h.workspace))
  /** The registered autoproject tool. */
  const tool = h.tools.find((entry) => entry.name === "mpd_autoproject")!
  /** The run's answer. */
  const res = await tool.execute({ objective: "create the widget", tier: "light", plan: false, maxRounds: 2 }, { agent: h.agent }) as any
  expect(res.status).toBe("blocked")
  /** The run's state document, read from disk. */
  const state = JSON.parse(readFileSync(res.stateFile, "utf8"))
  expect(Array.isArray(state.kills)).toBe(true)
  expect(state.kills.length).toBeGreaterThanOrEqual(1)
  expect(state.kills[0]).toMatchObject({ role: "Junior Engineer", elapsedMs: 900_000, boundMs: 5_000 })
  /** The run's journal lines. */
  const journal = readFileSync(res.stateFile.replace(/state\.json$/, "ledger.jsonl"), "utf8")
  expect(journal).toContain("late/interrupted:Junior Engineer")
})
