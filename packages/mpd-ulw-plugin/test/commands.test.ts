// Clause-2 tests: `/ulw` + `/ultrawork` registered through the adapter's command
// seam, the activation directive's autonomy clauses, the turn submission that
// actually STARTS a run (a command handler runs without sending anything to the
// model, so a bare {kind:'success'} return would start nothing), the plain-text
// gesture boundary for surfaces that have no command registry (headless), and the
// MECHANICAL team gate the activation now runs BEFORE injecting the directive
// (predicate -> plan shell through `agent_teams_plan` -> trailing TEAM GATE block).
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, activationDirective, ULW_ACTIVATION_DIRECTIVE, type UlwGateReport } from "../src/index.ts"
import type { DshAgentPreStep, DshCommandDef, DshCommandInvocation, DshLiveAgent, DshPreStepDecision, DshToolDef, DshUserMessage, DshUserMessageSource } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The answer one registered command handler returns: the surface kind plus the text it renders. */
interface CommandResult {
  /** Which surface answers the invocation: `success` acknowledges, `error` reports the refusal. */
  kind: "error" | "success"
  /** The text the command surface renders. */
  text: string
}

/** One command definition the fake registry captured, with the handler's own answer type written down. */
interface CapturedCommandDef extends Omit<DshCommandDef, "handler"> {
  /** The handler the adapter wrapped; calling it exercises the full command seam. */
  handler: (invocation: DshCommandInvocation) => CommandResult
}

/** One content block of a message these tests build: the model-facing `text` kind or an `attachment` reference. */
interface MessageBlock {
  /** The block kind; the gesture scan reads only `text` blocks. */
  type: string
  /** The block's model-facing text, present on a `text` block only. */
  text?: string
  /** The referenced artifact, present on an `attachment` block only. */
  ref?: string
}

/** One harness message as these tests build it: identity, role, content blocks and producer tag. */
interface HarnessMessage {
  /** The message identity, which a rewrite must preserve. */
  id?: string
  /** The message role; only a `user` message can carry the gesture. */
  role?: string
  /** The content blocks; an attachment-only (text-less) message is deliberately representable. */
  content?: MessageBlock[]
  /** The producer tag, which the harness's format-v4 gate requires to be producer-owned. */
  source?: DshUserMessageSource
}

/**
 * One `agent/pre-step` listener: the step and the downstream `next()` it must delegate to.
 * Generic over the decision so each call site keeps the decision type it composed itself.
 */
type PreStepListener = <T extends DshPreStepDecision>(step: DshAgentPreStep, next: () => Promise<T>) => Promise<T>

/** The one live agent the fake registry reports: its id plus the turn seam the adapter submits through. */
interface FakeLiveAgent extends DshLiveAgent {
  /** The turn-submission seam, which records the user-role message the plugin injected. */
  followup: (message: DshUserMessage) => void
}

/** One tool the fake REGISTRY holds by name, which is what `dsh.hasTool` and `dsh.executeTool` resolve. */
interface FakeSeamTool {
  /** The tool's own execute: receives `(arguments, exec)` and answers the raw tool value. */
  execute: (args: unknown, exec: unknown) => unknown
}

/** What one `agent_teams_plan` call recorded, in the shape the gate arms assert on. */
interface StagingCall {
  /** The `arguments` object the plugin passed to the call. */
  arguments?: Record<string, unknown>
  /** The agent handle the call was attributed to — the LIVE agent, never a stand-in. */
  agent?: unknown
}

/** The options a gate arm varies: what the seam tool answers and whether it is registered at all. */
interface HarnessOptions {
  /** The plan already staged for the session (`mpdTeams.planFor(...).plan`); omitted means none. */
  stagedPlan?: unknown
  /** Whether the fake `agent_teams_plan` is registered in the seam registry at all. */
  withStagingTool?: boolean
  /** What the fake `agent_teams_plan` answers; the default wraps a plan id the directive must name. */
  stagingValue?: unknown
  /** Whether the fake `agent_teams_plan` REFUSES by throwing, which is the degraded route. */
  stagingThrows?: boolean
}

/** A minimal fake harness: command registry, one live agent turn seam, event bus, tool registry. */
function makeHarness(options: HarnessOptions = {}): {
  /** The fake host context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** Command definitions the fake registry received, in registration order. */
  commandsRegistered: CapturedCommandDef[]
  /** The `agent/pre-step` listeners the plugin installed. */
  preStep: PreStepListener[]
  /** Tool definitions the fake registry received. */
  tools: DshToolDef[]
  /** Messages the fake live turn seam received. */
  submitted: DshUserMessage[]
  /** The one live agent the fake registry reports. */
  agent: FakeLiveAgent
  /** Every `agent_teams_plan` call the gate made, in call order. */
  stagingCalls: StagingCall[]
} {
  // Command definitions the fake registry received, in registration order.
  const commandsRegistered: CapturedCommandDef[] = []
  // The `agent/pre-step` listeners the plugin installed.
  const preStep: PreStepListener[] = []
  // Tool definitions the fake registry received.
  const tools: DshToolDef[] = []
  // Messages the fake live turn seam received.
  const submitted: DshUserMessage[] = []
  // Every `agent_teams_plan` call the gate made, in call order.
  const stagingCalls: StagingCall[] = []
  // The tools the SEAM resolves by name: what `hasTool` probes and `executeTool` drives.
  const seamTools = new Map<string, FakeSeamTool>()
  if (options.withStagingTool !== false) {
    seamTools.set("agent_teams_plan", {
      // Record the call FIRST, so a refusing tool is still visible to the assertions.
      execute: (args: unknown, exec: unknown): unknown => {
        stagingCalls.push({
          ...(typeof args === "object" && args !== null ? { arguments: args as Record<string, unknown> } : {}),
          agent: (exec as { agent?: unknown } | undefined)?.agent,
        })
        if (options.stagingThrows === true) throw new Error("staging refused by the fake tool")
        return options.stagingValue ?? { plan: { planId: STAGED_PLAN_ID } }
      },
    })
  }
  // The one live agent the fake registry reports.
  const agent: FakeLiveAgent = { id: "captain", followup: (message: DshUserMessage): void => { submitted.push(message) } }
  // The fake command registry, modelled on the host's own.
  const commands = {
    // Register one definition and return its unregister function.
    register(definition: CapturedCommandDef): () => void {
      commandsRegistered.push(definition)
      return () => {
        /** Where that definition sits, -1 once it was already removed. */
        const at = commandsRegistered.indexOf(definition); if (at >= 0) commandsRegistered.splice(at, 1)
      }
    },
  }
  // The fake tool registry: the seam the adapter's `hasTool` / `executeTool` go through.
  const toolsService = {
    // Register a definition the plugin itself contributes.
    register(def: DshToolDef): void { tools.push(def) },
    // The registry's own VIEW of one name — exactly what `dsh.hasTool` probes for.
    get(name: string): unknown { return seamTools.get(name) ?? tools.find((tool) => tool.name === name) },
    // Execute one tool by name, normalized to the harness's `{value}` / `{isError}` result shape.
    async execute(input: { name?: unknown; arguments?: unknown; agent?: unknown }): Promise<unknown> {
      /** The tool name the caller asked for. */
      const name = String(input?.name ?? "")
      /** The seam tool of that name, when this composition holds one. */
      const handler = seamTools.get(name)
      if (handler === undefined) return { isError: true, error: { message: "unknown tool " + name } }
      return { value: await handler.execute(input?.arguments, { agent: input?.agent }) }
    },
  }
  // The fake subagent seam, unused by these cases but required for `apply` to reach the engine.
  const subagentsService = { start: (): { result: Promise<{ structured: Record<string, unknown> }> } => ({ result: Promise.resolve({ structured: {} }) }) }
  // The services the adapter resolves by name; `mpdTeams` is the staged-plan probe's seam.
  const services: Record<string, unknown> = {
    tools: toolsService,
    subagents: subagentsService,
    agents: { list: (): FakeLiveAgent[] => [agent] },
    commands,
    mpdTeams: { planFor: (): { plan: unknown } => ({ plan: options.stagedPlan ?? null }) },
  }
  // The fake host context, one member per seam the row reads.
  const ctx: Parameters<typeof apply>[0] = {
    tools: toolsService,
    subagents: subagentsService,
    // Run the cleanup callback immediately, as a real ctx.effect does on dispose.
    effect(fn: () => unknown): void { fn() },
    // Resolve one of the services the adapter asks for, from the table above.
    get(service: string): unknown { return services[service] },
    // Subscribe one listener; only the pre-step event is recorded.
    on(event: string, listener: PreStepListener): () => void {
      if (event === "agent/pre-step") preStep.push(listener)
      return () => {
        /** Where that listener sits, -1 once it was already removed. */
        const at = preStep.indexOf(listener); if (at >= 0) preStep.splice(at, 1)
      }
    },
  }
  return { ctx, commandsRegistered, preStep, tools, submitted, agent, stagingCalls }
}

/** The plan id the fake `agent_teams_plan` returns, which the injected directive must name verbatim. */
const STAGED_PLAN_ID = "plan-ulw-e2e"
/** The objective every gate arm uses: it trips signal C deterministically (>= 3 action clauses, >= 3 action verbs). */
const TRIPPING_OBJECTIVE = "refactor the widget, migrate the store, audit the logs"
/** The report the `off` mode renders: no predicate evaluated, nothing staged. */
const OFF_REPORT: UlwGateReport = { mode: "off", trigger: false, signals: [], explicit: false, staged: false, planId: "", alreadyStaged: false }

/**
 * A fresh temp workdir triple, so no run touches the repository's own state roots.
 *
 * `boulder.dir` points at an EMPTY temp directory on purpose: that makes signal D deterministic
 * (`active:false`) whatever the repository's own `.mpd/boulder.json` happens to say, so a gate arm
 * asserts on the predicate it means to exercise. An omitted `gate` leaves the row config silent,
 * which is the MECHANICAL default; the legacy arms pass `"off"` so their bytes stay deterministic.
 *
 * @param gate - the `team.gate` mode to configure, or undefined for the mechanical default.
 * @returns the row config handed to `apply`.
 */
function workdirs(gate?: "mechanical" | "advisory" | "off"): NonNullable<Parameters<typeof apply>[1]> {
  // The temp root both directories live under.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-cmd-"))
  return {
    planDir: join(dir, "plans"),
    stateDir: join(dir, "state"),
    boulder: { dir: join(dir, "boulder") },
    ...(gate === undefined ? {} : { team: { gate } }),
  }
}

/** The model-facing text of one message. */
function textOf(message: HarnessMessage): string {
  return (message?.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("\n")
}

test("both /ulw and /ultrawork are registered through the adapter seam (bare names, identical behaviour)", async () => {
  // The fake harness for this case; the gate is OFF so the assertion is about the COMMAND seam.
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs("off"))
  expect(commandsRegistered.length).toBe(2)
  expect(commandsRegistered.map((definition) => definition.name)).toEqual(["ulw", "ultrawork"])
  for (const definition of commandsRegistered) {
    // The host parses `/ulw` itself: a leading slash in the registered name is invalid.
    expect(String(definition.name).startsWith("/")).toBe(false)
    expect(typeof definition.description).toBe("string")
    expect(definition.input?.hint).toBeTruthy()
    // The description is per-NAME (t9 review): each entry advertises the OTHER spelling and
    // never presents itself as the alias.
    const other = definition.name === "ulw" ? "/ultrawork" : "/ulw"
    expect(String(definition.description)).toContain(other)
    expect(String(definition.description)).not.toContain("/" + String(definition.name) + ")")
  }
  // ONE handler for both spellings. The adapter wraps each registration in its own
  // closure, so identity is proven BEHAVIOURALLY: same input, same result, same
  // directive bytes.
  const viaUlw = await commandsRegistered[0].handler({ rawInput: "ship the widget", agent })
  // The same invocation through the second spelling.
  const viaUltrawork = await commandsRegistered[1].handler({ rawInput: "ship the widget", agent })
  expect(viaUltrawork).toEqual(viaUlw)
  expect(submitted.length).toBe(2)
  expect(textOf(submitted[1])).toBe(textOf(submitted[0]))
})

test("empty input returns usage naming the objective form and starts nothing", async () => {
  // The fake harness for this case.
  const { ctx, commandsRegistered, submitted } = makeHarness()
  apply(ctx, workdirs())
  for (const raw of ["", "   ", "\t\n"]) {
    // The handler's answer for empty input.
    const result = await commandsRegistered[0].handler({ rawInput: raw, agent: undefined })
    expect(result.kind).toBe("error")
    expect(String(result.text)).toContain("/ulw <objective>")
    expect(String(result.text)).toContain("/ultrawork <objective>")
  }
  expect(submitted.length).toBe(0)
})

test("a non-empty invocation submits the activation directive as the invoking agent's next user turn", async () => {
  // The fake harness for this case; the gate is OFF so the injection bytes are fixed.
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs("off"))
  // The host hands a handler {rawInput, agent, …}; the adapter adds the submission
  // surface, so calling the REGISTERED definition exercises the full seam.
  const result = await commandsRegistered[1].handler({ rawInput: "  ship the widget  ", agent })
  expect(result.kind).toBe("success")
  expect(String(result.text)).toContain("ship the widget")
  expect(submitted.length).toBe(1) // a run was actually STARTED, not merely acknowledged
  // The message the handler submitted.
  const message = submitted[0]
  expect(message.role).toBe("user")
  expect(typeof message.id).toBe("string")
  // The harness format-v4 gate REFUSES the retired shared `plugin` member ("format v4
  // message requires a producer-owned source kind", measured on 0.1.7-rc.2 — it took the
  // whole boot down), so the activation directive names its own producer.
  expect(message.source.kind).toBe("mpd-ulw")
  // Its model-facing text.
  const text = textOf(message)
  expect(text).toContain("ULTRAWORK ACTIVATION")
  expect(text).toContain("OBJECTIVE: ship the widget")
  // The mpd plan plane replaced the retired official-tool sentence: the directive points at
  // `agent_teams_plan`, and the official pair is NOT named any more.
  expect(text).toContain("agent_teams_plan")
  expect(text).not.toContain("spawn_teammate")
  expect(text).not.toContain("team_task_create")
  // The gate is OFF for this config, and the trailing block says exactly that.
  expect(text).toBe(activationDirective("ship the widget", OFF_REPORT))
  // No live turn surface: the failure is reported, not swallowed.
  const failed = await commandsRegistered[0].handler({ rawInput: "another objective", agent: undefined })
  expect(failed.kind).toBe("error")
  expect(String(failed.text)).toContain("could not start")
})

test("the activation directive carries the six autonomy behaviours in order", () => {
  // The activation directive for a fixed objective.
  const directive = activationDirective("make the widget ship")
  // The autonomy clauses, in the order the directive must state them.
  const clauses = ["ULTRAWORK ACTIVATION", "TRIAGE FIRST", "GATE:", "TEAM WHEN WARRANTED", "LOOP TO COMPLETION", "FIX ON SIGHT", "CLOSE OUT ON PROOF"]
  // Offset of the clause matched last, so each must come after its predecessor.
  let previous = -1
  for (const clause of clauses) {
    // Where this clause starts in the directive.
    const at = directive.indexOf(clause)
    expect(at).toBeGreaterThan(previous)
    previous = at
  }
  // Clause 2 states that the predicate was ALREADY evaluated mechanically, never that the model
  // should evaluate it: the plugin runs the SAME predicate the session-start gate uses.
  expect(directive).toContain("ALREADY EVALUATED MECHANICALLY")
  expect(directive).toContain("explicit `team:`/`!team` flag OR any matched signal A-E")
  expect(directive).toContain("Never invent a second predicate")
  // Clause 3 points at OUR plan plane (`agent_teams_plan` create / add_member / create_task /
  // approve), and the retired official-tool sentence is GONE.
  expect(directive).toContain("agent_teams_plan {action:\"add_member\"}")
  expect(directive).toContain("agent_teams_plan {action:\"approve\"}")
  expect(directive).not.toContain("spawn_teammate")
  expect(directive).not.toContain("team_task_create")
  // THE PREFIX-VS-FAMILY TRAP (independent review, 2026-10-06): the retired family is named
  // EXPLICITLY, and the shared `agent_teams_` prefix is explicitly declared NOT to be a retirement
  // signal — the old blanket sentence ("the retired `agent_teams_*` tools do not exist") is gone,
  // because our own staging tool is spelled with that same prefix.
  expect(directive).not.toContain("the retired `agent_teams_*` tools do not exist")
  expect(directive).toContain("EXACTLY five `agent_teams_*` tools exist on this harness")
  for (const live of ["agent_teams_plan", "agent_teams_task", "agent_teams_dispatch", "agent_teams_mail", "agent_teams_control"]) {
    // Every LIVE name is stated to exist, so no reader can retire one of them.
    expect(directive).toContain(live)
  }
  // The retired names ARE named (the assertion `not.toContain("agent_teams_create")` was replaced by
  // this one: naming them is the fix, and the verbatim list is what `mpd-team-core-plugin`'s own
  // `tool-surface.test.ts` pins as retired).
  for (const retired of ["agent_teams_create", "agent_teams_add_member", "agent_teams_create_task", "agent_teams_approve", "agent_teams_status"]) {
    expect(directive).toContain(retired)
  }
  // The trap-killer sentence itself: the prefix must never be read as "skip the plan tool".
  expect(directive).toContain("never read the shared `agent_teams_` prefix as a reason to skip `agent_teams_plan`")
  expect(directive).toContain("no user confirmation")
  expect(directive).toContain("never stop early to ask the user")
  expect(directive).toContain("never report-and-wait")
  expect(directive).toContain("verification gate and the quality-gate ledger both approve")
  expect(directive).toContain("OBJECTIVE: make the widget ship")
  // Stable policy head, mutable objective + verdict tail (DeepSeek V4 prefix-cache discipline).
  expect(directive.startsWith(ULW_ACTIVATION_DIRECTIVE)).toBe(true)
})

test("the QA case's c3.2 probe still matches and the c3.3 probe it needs is the one this text matches", () => {
  // The activation directive for a fixed objective.
  const directive = activationDirective("make the widget ship")
  // C3.2 as it still ships in `skills/dsh-qa/scripts/ulw-command.ts` (`CLAUSE_PROBES` id "gate"):
  // the clause rewrite had to stay readable to the probe that guards it.
  const c32 = /GATE:[\s\S]{0,120}complexity predicate[\s\S]{0,160}signal A-E/
  expect(c32.test(directive)).toBe(true)
  // C3.3 is the probe the SKILLS LANE must change (this package cannot edit `skills/**`): the
  // shipped probe still demands `spawn_teammate` + `team_task_create`, which the mpd plan plane
  // replaced. The regex below is the exact replacement requested from that lane, and this assertion
  // proves the SHIPPED text matches it — so the probe change is a one-line edit, not a re-derivation.
  const c33Replacement = /TEAM WHEN WARRANTED[\s\S]{0,400}agent_teams_plan[\s\S]{0,400}(add_member|create_task)/
  expect(c33Replacement.test(directive)).toBe(true)
  // The retired pair really is absent, which is why the old probe can only fail.
  expect(directive.includes("spawn_teammate")).toBe(false)
  expect(directive.includes("team_task_create")).toBe(false)
})

test("the frozen head is byte-stable across objectives AND verdicts (prefix-cache discipline)", () => {
  // The sha256 of the shipped head — the bytes the model's prefix cache keys on.
  const headHash = createHash("sha256").update(ULW_ACTIVATION_DIRECTIVE, "utf8").digest("hex")
  // Two activations that differ in BOTH mutable parts: different objective, different verdict.
  const first = activationDirective("ship the widget", OFF_REPORT)
  // The second activation, whose verdict FIRED and staged a plan: the head must not move.
  const second = activationDirective(TRIPPING_OBJECTIVE, { mode: "mechanical", trigger: true, signals: ["C"], explicit: true, staged: true, planId: STAGED_PLAN_ID, alreadyStaged: false })
  // The head slice of each is the constant byte for byte, and both hash to the same digest.
  expect(first.slice(0, ULW_ACTIVATION_DIRECTIVE.length)).toBe(ULW_ACTIVATION_DIRECTIVE)
  expect(second.slice(0, ULW_ACTIVATION_DIRECTIVE.length)).toBe(ULW_ACTIVATION_DIRECTIVE)
  expect(createHash("sha256").update(first.slice(0, ULW_ACTIVATION_DIRECTIVE.length), "utf8").digest("hex")).toBe(headHash)
  expect(createHash("sha256").update(second.slice(0, ULW_ACTIVATION_DIRECTIVE.length), "utf8").digest("hex")).toBe(headHash)
  // The verdict lives AFTER the objective, so it can never invalidate the cached prefix.
  expect(first.indexOf("TEAM GATE:")).toBeGreaterThan(first.indexOf("OBJECTIVE:"))
  expect(second.indexOf("TEAM GATE:")).toBeGreaterThan(second.indexOf("OBJECTIVE:"))
})

test("the gate is MECHANICAL: a tripping objective stages EXACTLY ONE plan and the directive names the returned id", async () => {
  // The fake harness for this case; no `team` key, so `team.gate` resolves to the MECHANICAL default.
  const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness()
  apply(ctx, workdirs())
  // One activation whose objective trips signal C.
  const result = await commandsRegistered[0].handler({ rawInput: TRIPPING_OBJECTIVE, agent })
  expect(result.kind).toBe("success")
  // EXACTLY ONE staging call, on the LIVE agent, carrying the gate-filled shell.
  expect(stagingCalls.length).toBe(1)
  expect(stagingCalls[0].agent).toBe(agent)
  expect(stagingCalls[0].arguments?.action).toBe("create")
  // `approval:"automatic"` is the ULW label (the run approves the plan itself); the store records it.
  expect(stagingCalls[0].arguments?.approval).toBe("automatic")
  expect(String(stagingCalls[0].arguments?.name)).toBe(TRIPPING_OBJECTIVE.slice(0, 60))
  expect(String(stagingCalls[0].arguments?.description)).toContain("complexity signals C")
  // The injected directive reports the plan id the CALL returned, never a claimed one.
  const text = textOf(submitted[0])
  expect(text).toContain("TEAM GATE: MECHANICAL")
  expect(text).toContain("a team PLAN was STAGED")
  expect(text).toContain(STAGED_PLAN_ID)
  expect(text).toContain("NOTHING has been spawned; the plan is INERT until approved")
})

test("the gesture path runs the SAME mechanical gate with the agent the payload carries", async () => {
  // The fake harness for this case.
  const { ctx, preStep, agent, stagingCalls } = makeHarness()
  apply(ctx, workdirs())
  expect(preStep.length).toBe(1)
  // A user message that opens with the `/ulw` gesture and a tripping objective.
  const gesture = { id: "g1", role: "user", content: [{ type: "text", text: "/ulw " + TRIPPING_OBJECTIVE }], source: { kind: "user" } }
  // The decision the rest of the chain composes.
  const inner = { kind: "enter", messages: [gesture] }
  // The rewritten decision; the agent rides the payload exactly as the harness fuses it.
  const result = await preStep[0]({ agent, messages: [gesture] }, async () => inner)
  expect(stagingCalls.length).toBe(1)
  expect(stagingCalls[0].agent).toBe(agent)
  // The injected text carries the verdict block and the objective (with the gesture consumed).
  const text = textOf(result.messages[0])
  expect(text).toContain("OBJECTIVE: " + TRIPPING_OBJECTIVE)
  expect(text).toContain(STAGED_PLAN_ID)
})

test("mode advisory and mode off stage nothing and say so", async () => {
  for (const mode of ["advisory", "off"] as const) {
    // A fresh harness per mode, so the two arms cannot borrow each other's state.
    const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness()
    apply(ctx, workdirs(mode))
    // The activation itself, which must still succeed with the gate configured this way.
    const result = await commandsRegistered[0].handler({ rawInput: TRIPPING_OBJECTIVE, agent })
    expect(result.kind).toBe("success")
    // Nothing was staged, and the call was never even attempted.
    expect(stagingCalls.length).toBe(0)
    // The directive says so, in its own words, and never implies a team exists.
    const text = textOf(submitted[0])
    expect(text).toContain("NO team was staged")
    expect(text).not.toContain("was STAGED:")
    expect(text).toContain(mode === "off" ? "TEAM GATE: OFF" : "TEAM GATE: ADVISORY")
  }
})

test("an already-staged plan is never re-staged, and the directive names the existing one", async () => {
  // The fake harness whose team record already holds an in-progress plan.
  const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness({ stagedPlan: { planId: "plan-existing" } })
  apply(ctx, workdirs())
  // The activation whose objective trips the predicate.
  const result = await commandsRegistered[0].handler({ rawInput: TRIPPING_OBJECTIVE, agent })
  expect(result.kind).toBe("success")
  // A second `create` would ARCHIVE the in-progress plan, so the gate must not call the tool.
  expect(stagingCalls.length).toBe(0)
  // The directive the run received, which must name the plan already there.
  const text = textOf(submitted[0])
  expect(text).toContain("a team PLAN is ALREADY STAGED")
  expect(text).toContain("plan-existing")
  expect(text).toContain("The gate did NOT stage again")
})

test("a composition without the staging tool degrades honestly — no throw, no claimed team", async () => {
  // The fake harness whose seam registry does NOT hold `agent_teams_plan`.
  const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness({ withStagingTool: false })
  apply(ctx, workdirs())
  // The activation still STARTS: the gate degrades, it never vetoes the run.
  const result = await commandsRegistered[0].handler({ rawInput: TRIPPING_OBJECTIVE, agent })
  expect(result.kind).toBe("success")
  expect(stagingCalls.length).toBe(0)
  // The directive the run received: it must say the gate FIRED and nothing was staged.
  const text = textOf(submitted[0])
  expect(text).toContain("TEAM GATE: MECHANICAL")
  expect(text).toContain("the gate FIRED, but staging did NOT happen")
  expect(text).toContain("agent_teams_plan is not registered")
  expect(text).toContain("NO team was staged")
})

test("a REFUSING staging call degrades without throwing: the run starts and the block says so", async () => {
  // The fake harness whose staging tool throws, i.e. the tool refused the call.
  const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness({ stagingThrows: true })
  apply(ctx, workdirs())
  // The activation whose objective trips the predicate.
  const result = await commandsRegistered[0].handler({ rawInput: TRIPPING_OBJECTIVE, agent })
  expect(result.kind).toBe("success")
  expect(stagingCalls.length).toBe(1) // the call really was attempted
  // The directive the run received: a refusal is reported, never hidden.
  const text = textOf(submitted[0])
  expect(text).toContain("staging did NOT happen")
  expect(text).toContain("staging refused by the fake tool")
  expect(text).toContain("NO team was staged")
})

test("a tripping objective that carries the explicit `team:` marker has the marker CONSUMED", async () => {
  // The fake harness for this case.
  const { ctx, commandsRegistered, submitted, agent, stagingCalls } = makeHarness()
  apply(ctx, workdirs())
  // The activation whose objective carries the explicit marker AND trips signal C.
  const result = await commandsRegistered[0].handler({ rawInput: "team: " + TRIPPING_OBJECTIVE, agent })
  expect(result.kind).toBe("success")
  expect(stagingCalls.length).toBe(1)
  // The marker activated signal A AND was removed, so neither the objective nor the name carries it.
  expect(String(stagingCalls[0].arguments?.name)).toBe(TRIPPING_OBJECTIVE.slice(0, 60))
  expect(textOf(submitted[0])).toContain("complexity signals A/C")
  expect(textOf(submitted[0])).toContain("OBJECTIVE: " + TRIPPING_OBJECTIVE)
})

test("the pre-step gesture boundary injects the same directive and delegates to next()", async () => {
  // The fake harness for this case; the gate is OFF so the legacy assertions stay byte-exact.
  const { ctx, preStep, submitted } = makeHarness()
  apply(ctx, workdirs("off"))
  expect(preStep.length).toBe(1)
  // A user message that opens with the `/ultrawork` gesture.
  const gesture = { id: "m1", role: "user", content: [{ type: "text", text: "/ultrawork ship the widget" }], source: { kind: "user" } }
  // The decision the rest of the chain composes.
  const inner = { kind: "enter", messages: [gesture] }
  // How many times the listener delegated downstream.
  let delegated = 0
  // The rewritten decision the listener returned.
  const result = await preStep[0]({ agent: undefined, messages: [gesture] }, async () => { delegated += 1; return inner })
  // Waterfall discipline: the composed decision is awaited FIRST, then rewritten.
  expect(delegated).toBe(1)
  expect(result.kind).toBe("enter")
  expect(result.messages.length).toBe(1) // the gesture is CONSUMED, not duplicated
  // The rewritten message.
  const message = result.messages[0]
  expect(message.id).toBe("m1") // the message identity survives the rewrite
  // Its model-facing text: the SAME renderer the command path uses.
  const text = textOf(message)
  expect(text).toBe(activationDirective("ship the widget", OFF_REPORT))
  expect(text).toContain("agent_teams_plan")
  expect(text).not.toContain("spawn_teammate")
  expect(submitted.length).toBe(0) // a pre-step decision, never a turn submission
})

test("the gesture fires in the REAL composition shape — the prompt FOLLOWED BY user-role notices (t15 regression)", async () => {
  // The fake harness for this case; the gate is OFF so the head/objective bytes stay deterministic.
  const { ctx, preStep } = makeHarness()
  apply(ctx, workdirs("off"))
  // The installed pre-step listener.
  const listener = preStep[0]
  // The user's own prompt, which carries the gesture.
  const prompt = { id: "u1", role: "user", content: [{ type: "text", text: "/ultrawork ship the widget" }], source: { kind: "user" } }
  // The shape a real boot exposed (t7 finding F1): plugin-injected USER-ROLE notices land
  // AFTER the user's prompt, so the LAST user-role message is a notice, not the gesture.
  const runtimeContext = { id: "n1", role: "user", content: [{ type: "text", text: "[runtime context] workspace=/root/x, os=linux, model=deepseek-v4-flash" }], source: { kind: "plugin", plugin: "runtime-context" } }
  // A plugin-injected notice appended after the prompt.
  const skillCatalog = { id: "n2", role: "user", content: [{ type: "text", text: "<system-reminder>Available skills: ulw-plan, ulw-execute, dsh-qa</system-reminder>" }], source: { kind: "plugin", plugin: "skills" } }
  // The composed decision: prompt first, then the notices.
  const decision = { kind: "enter", messages: [prompt, runtimeContext, skillCatalog] }
  // The rewritten decision.
  const result = await listener({ agent: undefined, messages: decision.messages }, async () => decision)
  expect(textOf(result.messages[0])).toBe(activationDirective("ship the widget", OFF_REPORT))
  expect(result.messages[0].id).toBe("u1") // identity preserved; the notices are untouched
  expect(result.messages[1]).toBe(runtimeContext)
  expect(result.messages[2]).toBe(skillCatalog)
  // LABELLED REGRESSION ARM: the retired claim was "the LAST user-role message carrying
  // text". Reproduce it and show it selects a NOTICE — the old implementation had nothing
  // to match and injected nothing for exactly this shape.
  const retiredClaim = [...decision.messages].reverse().find((message) => message?.role === "user" && textOf(message) !== "")
  expect(retiredClaim).toBe(skillCatalog)
  // What the retired claim would have matched.
  const retiredText = textOf(retiredClaim!).trim()
  expect(retiredText.startsWith("/ulw")).toBe(false)
  expect(retiredText.startsWith("/ultrawork")).toBe(false)
  // The scan reads EVERY user-role text: a notice arriving before the prompt does not hide
  // it, and a text-less user message (attachment-only) does not stop the scan.
  const reordered = { kind: "enter", messages: [runtimeContext, prompt] }
  expect(textOf((await listener({ agent: undefined, messages: reordered.messages }, async () => reordered)).messages[1])).toBe(activationDirective("ship the widget", OFF_REPORT))
  // A user message with no text block at all.
  const attachmentOnly = { id: "a1", role: "user", content: [{ type: "attachment", ref: "x" }], source: { kind: "user" } }
  // A batch whose first message carries no text.
  const skipped = { kind: "enter", messages: [attachmentOnly, prompt, skillCatalog] }
  expect(textOf((await listener({ agent: undefined, messages: skipped.messages }, async () => skipped)).messages[1])).toBe(activationDirective("ship the widget", OFF_REPORT))
})

test("the gesture boundary leaves every non-gesture step untouched", async () => {
  // The fake harness for this case.
  const { ctx, preStep } = makeHarness()
  apply(ctx, workdirs())
  // The installed pre-step listener.
  const listener = preStep[0]
  // A user message with no gesture.
  const plain = { id: "p1", role: "user", content: [{ type: "text", text: "refactor the widget" }], source: { kind: "user" } }
  // The composed decision for that message.
  const decision = { kind: "enter", messages: [plain] }
  expect(await listener({ agent: undefined, messages: [plain] }, async () => decision)).toBe(decision)
  // A bare `/ulw` carries no objective: the command path answers usage, the gesture
  // has no reply surface, so the step is left exactly as composed.
  const bare = { id: "b1", role: "user", content: [{ type: "text", text: "/ulw" }], source: { kind: "user" } }
  // The composed decision for a bare `/ulw`.
  const bareDecision = { kind: "enter", messages: [bare] }
  expect(await listener({ agent: undefined, messages: [bare] }, async () => bareDecision)).toBe(bareDecision)
  // Mentioning /ulw mid-text is not a gesture: the pattern is anchored at the start.
  const mentioned = { id: "n1", role: "user", content: [{ type: "text", text: "please run /ulw later" }], source: { kind: "user" } }
  // The composed decision for a mid-text mention.
  const mentionDecision = { kind: "enter", messages: [mentioned] }
  expect(await listener({ agent: undefined, messages: [mentioned] }, async () => mentionDecision)).toBe(mentionDecision)
  // A rejected step is returned as-is.
  const rejected = { kind: "reject" }
  expect(await listener({ agent: undefined, messages: [] }, async () => rejected)).toBe(rejected)
  // A step with no user message is untouched.
  const assistantOnly = { kind: "enter", messages: [{ role: "assistant", content: [{ type: "text", text: "x" }] }] }
  expect(await listener({ agent: undefined, messages: [] }, async () => assistantOnly)).toBe(assistantOnly)
})

test("the plugin reaches the seams only through the adapter (no direct command service, event bus or host import)", () => {
  // The plugin source, read as text for the seam assertions.
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")
  expect(source).not.toMatch(/ctx\.commands/)
  expect(source).not.toMatch(/ctx\.get\(\s*["']commands["']\s*\)/)
  expect(source).not.toMatch(/ctx\.on\s*\(/)
  expect(source).not.toMatch(/from\s+["']@deepseek-ai\//)
  expect(source).toContain("dsh.registerCommand(")
  expect(source).toContain("dsh.onEvent(")
  expect(source).toContain("dsh.userMessage(")
})

test("apply degrades safely when the composition has no command registry and no event bus", () => {
  // The fake harness for this case.
  const { ctx, tools } = makeHarness()
  // A composition with only the two seams the row needs to apply.
  const bare: Parameters<typeof apply>[0] = { tools: ctx.tools, subagents: ctx.subagents }
  expect(() => apply(bare, workdirs())).not.toThrow()
  expect(tools.find((tool) => tool.name === "mpd_ultrawork")).toBeTruthy()
})
