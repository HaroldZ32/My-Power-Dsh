// Clause-2 tests: `/ulw` + `/ultrawork` registered through the adapter's command
// seam, the activation directive's autonomy clauses, the turn submission that
// actually STARTS a run (a command handler runs without sending anything to the
// model, so a bare {kind:'success'} return would start nothing), and the plain-text
// gesture boundary for surfaces that have no command registry (headless).
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, activationDirective, ULW_ACTIVATION_DIRECTIVE } from "../src/index.ts"
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

/** A minimal fake harness: command registry, one live agent turn seam, event bus. */
function makeHarness(): {
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
} {
  // Command definitions the fake registry received, in registration order.
  const commandsRegistered: CapturedCommandDef[] = []
  // The `agent/pre-step` listeners the plugin installed.
  const preStep: PreStepListener[] = []
  // Tool definitions the fake registry received.
  const tools: DshToolDef[] = []
  // Messages the fake live turn seam received.
  const submitted: DshUserMessage[] = []
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
  // The fake host context, one member per seam the row reads.
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      /** Push a tool definition into the fake registry. */
      register(def: DshToolDef): void { tools.push(def) },
      get: (name: string) => tools.find((t) => t.name === name)
    },
    subagents: { start: () => ({ result: Promise.resolve({ structured: {} }) }) },
    agents: { list: () => [agent] },
    // Run the cleanup callback immediately, as a real ctx.effect does on dispose.
    effect(fn: () => unknown): void { fn() },
    // Resolve one of the four services the adapter asks for. The table is indexed by the
    // requested name, which an object literal cannot do, so the lookup is asserted to a record.
    get(service: string): unknown { return ({ tools: ctx.tools, subagents: ctx.subagents, agents: ctx.agents, commands } as Record<string, unknown>)[service] },
    // Subscribe one listener; only the pre-step event is recorded.
    on(event: string, listener: PreStepListener): () => void {
      if (event === "agent/pre-step") preStep.push(listener)
      return () => {
        /** Where that listener sits, -1 once it was already removed. */
        const at = preStep.indexOf(listener); if (at >= 0) preStep.splice(at, 1)
      }
    },
  }
  return { ctx, commandsRegistered, preStep, tools, submitted, agent }
}

/** A fresh temp workdir pair, so no run touches the repository's own state roots. */
function workdirs(): { planDir: string; stateDir: string } {
  // The temp root both directories live under.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-cmd-"))
  return { planDir: join(dir, "plans"), stateDir: join(dir, "state") }
}

/** The model-facing text of one message. */
function textOf(message: HarnessMessage): string {
  return (message?.content ?? []).filter((block) => block?.type === "text").map((block) => block.text).join("\n")
}

test("both /ulw and /ultrawork are registered through the adapter seam (bare names, identical behaviour)", async () => {
  // The fake harness for this case.
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs())
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
  // The fake harness for this case.
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs())
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
  // 0.1.7: the directive names the OFFICIAL staging tools, never the retired approval flow.
  expect(text).toContain("spawn_teammate({name, description, prompt})")
  expect(text).not.toContain('approval="automatic"')
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
  // 0.1.7: the retired `agent_teams_*` tools must NOT be named, and the OFFICIAL pair that
  // replaces them must be — the team is staged through spawn_teammate + team_task_create.
  expect(directive).not.toContain("agent_teams_create")
  expect(directive).toContain("spawn_teammate({name, description, prompt})")
  expect(directive).toContain("team_task_create({subject, description, blocked_by?, write_scopes?})")
  expect(directive).toContain("explicit `team:`/`!team` flag OR any matched signal A-D")
  expect(directive).toContain("no user confirmation")
  expect(directive).toContain("never stop early to ask the user")
  expect(directive).toContain("never report-and-wait")
  expect(directive).toContain("verification gate and the quality-gate ledger both approve")
  expect(directive).toContain("OBJECTIVE: make the widget ship")
  // Stable policy head, mutable objective tail (DeepSeek V4 prefix-cache discipline).
  expect(directive.startsWith(ULW_ACTIVATION_DIRECTIVE)).toBe(true)
})

test("the pre-step gesture boundary injects the same directive and delegates to next()", async () => {
  // The fake harness for this case.
  const { ctx, preStep, submitted } = makeHarness()
  apply(ctx, workdirs())
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
  // Its model-facing text.
  const text = textOf(message)
  expect(text).toBe(activationDirective("ship the widget")) // the SAME constant as the command path
  // 0.1.7: the directive names the OFFICIAL staging tools, never the retired approval flow.
  expect(text).toContain("spawn_teammate({name, description, prompt})")
  expect(text).not.toContain('approval="automatic"')
  expect(submitted.length).toBe(0) // a pre-step decision, never a turn submission
})

test("the gesture fires in the REAL composition shape — the prompt FOLLOWED BY user-role notices (t15 regression)", async () => {
  // The fake harness for this case.
  const { ctx, preStep } = makeHarness()
  apply(ctx, workdirs())
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
  expect(textOf(result.messages[0])).toBe(activationDirective("ship the widget"))
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
  expect(textOf((await listener({ agent: undefined, messages: reordered.messages }, async () => reordered)).messages[1])).toBe(activationDirective("ship the widget"))
  // A user message with no text block at all.
  const attachmentOnly = { id: "a1", role: "user", content: [{ type: "attachment", ref: "x" }], source: { kind: "user" } }
  // A batch whose first message carries no text.
  const skipped = { kind: "enter", messages: [attachmentOnly, prompt, skillCatalog] }
  expect(textOf((await listener({ agent: undefined, messages: skipped.messages }, async () => skipped)).messages[1])).toBe(activationDirective("ship the widget"))
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
