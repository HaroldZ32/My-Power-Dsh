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

/** A minimal fake harness: command registry, one live agent turn seam, event bus. */
function makeHarness() {
  const commandsRegistered: any[] = []
  const preStep: Array<(...args: any[]) => any> = []
  const tools: any[] = []
  const submitted: any[] = []
  const agent = { id: "captain", followup: (message: any) => { submitted.push(message) } }
  const commands = {
    register(definition: any) {
      commandsRegistered.push(definition)
      return () => { const at = commandsRegistered.indexOf(definition); if (at >= 0) commandsRegistered.splice(at, 1) }
    },
  }
  const ctx: any = {
    tools: { register(def: any) { tools.push(def) }, get: (name: string) => tools.find((t) => t.name === name) },
    subagents: { start: () => ({ result: Promise.resolve({ structured: {} }) }) },
    agents: { list: () => [agent] },
    effect(fn: () => unknown) { fn() },
    get(service: string) { return ({ tools: ctx.tools, subagents: ctx.subagents, agents: ctx.agents, commands } as Record<string, unknown>)[service] },
    on(event: string, listener: any) {
      if (event === "agent/pre-step") preStep.push(listener)
      return () => { const at = preStep.indexOf(listener); if (at >= 0) preStep.splice(at, 1) }
    },
  }
  return { ctx, commandsRegistered, preStep, tools, submitted, agent }
}

function workdirs() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-cmd-"))
  return { planDir: join(dir, "plans"), stateDir: join(dir, "state") }
}

/** The model-facing text of one message. */
function textOf(message: any): string {
  return (message?.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n")
}

test("both /ulw and /ultrawork are registered through the adapter seam (bare names, identical behaviour)", async () => {
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs())
  expect(commandsRegistered.length).toBe(2)
  expect(commandsRegistered.map((definition: any) => definition.name)).toEqual(["ulw", "ultrawork"])
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
  const viaUltrawork = await commandsRegistered[1].handler({ rawInput: "ship the widget", agent })
  expect(viaUltrawork).toEqual(viaUlw)
  expect(submitted.length).toBe(2)
  expect(textOf(submitted[1])).toBe(textOf(submitted[0]))
})

test("empty input returns usage naming the objective form and starts nothing", async () => {
  const { ctx, commandsRegistered, submitted } = makeHarness()
  apply(ctx, workdirs())
  for (const raw of ["", "   ", "\t\n"]) {
    const result = await commandsRegistered[0].handler({ rawInput: raw, agent: undefined })
    expect(result.kind).toBe("error")
    expect(String(result.text)).toContain("/ulw <objective>")
    expect(String(result.text)).toContain("/ultrawork <objective>")
  }
  expect(submitted.length).toBe(0)
})

test("a non-empty invocation submits the activation directive as the invoking agent's next user turn", async () => {
  const { ctx, commandsRegistered, submitted, agent } = makeHarness()
  apply(ctx, workdirs())
  // The host hands a handler {rawInput, agent, …}; the adapter adds the submission
  // surface, so calling the REGISTERED definition exercises the full seam.
  const result = await commandsRegistered[1].handler({ rawInput: "  ship the widget  ", agent })
  expect(result.kind).toBe("success")
  expect(String(result.text)).toContain("ship the widget")
  expect(submitted.length).toBe(1) // a run was actually STARTED, not merely acknowledged
  const message = submitted[0]
  expect(message.role).toBe("user")
  expect(typeof message.id).toBe("string")
  expect(message.source.kind).toBe("plugin")
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
  const directive = activationDirective("make the widget ship")
  const clauses = ["ULTRAWORK ACTIVATION", "TRIAGE FIRST", "GATE:", "TEAM WHEN WARRANTED", "LOOP TO COMPLETION", "FIX ON SIGHT", "CLOSE OUT ON PROOF"]
  let previous = -1
  for (const clause of clauses) {
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
  const { ctx, preStep, submitted } = makeHarness()
  apply(ctx, workdirs())
  expect(preStep.length).toBe(1)
  const gesture = { id: "m1", role: "user", content: [{ type: "text", text: "/ultrawork ship the widget" }], source: { kind: "user" } }
  const inner = { kind: "enter", messages: [gesture] }
  let delegated = 0
  const result = await preStep[0]({ agent: undefined, messages: [gesture] }, async () => { delegated += 1; return inner })
  // Waterfall discipline: the composed decision is awaited FIRST, then rewritten.
  expect(delegated).toBe(1)
  expect(result.kind).toBe("enter")
  expect(result.messages.length).toBe(1) // the gesture is CONSUMED, not duplicated
  const message = result.messages[0]
  expect(message.id).toBe("m1") // the message identity survives the rewrite
  const text = textOf(message)
  expect(text).toBe(activationDirective("ship the widget")) // the SAME constant as the command path
  // 0.1.7: the directive names the OFFICIAL staging tools, never the retired approval flow.
  expect(text).toContain("spawn_teammate({name, description, prompt})")
  expect(text).not.toContain('approval="automatic"')
  expect(submitted.length).toBe(0) // a pre-step decision, never a turn submission
})

test("the gesture fires in the REAL composition shape — the prompt FOLLOWED BY user-role notices (t15 regression)", async () => {
  const { ctx, preStep } = makeHarness()
  apply(ctx, workdirs())
  const listener = preStep[0]
  const prompt = { id: "u1", role: "user", content: [{ type: "text", text: "/ultrawork ship the widget" }], source: { kind: "user" } }
  // The shape a real boot exposed (t7 finding F1): plugin-injected USER-ROLE notices land
  // AFTER the user's prompt, so the LAST user-role message is a notice, not the gesture.
  const runtimeContext = { id: "n1", role: "user", content: [{ type: "text", text: "[runtime context] workspace=/root/x, os=linux, model=deepseek-v4-flash" }], source: { kind: "plugin", plugin: "runtime-context" } }
  const skillCatalog = { id: "n2", role: "user", content: [{ type: "text", text: "<system-reminder>Available skills: ulw-plan, ulw-execute, dsh-qa</system-reminder>" }], source: { kind: "plugin", plugin: "skills" } }
  const decision = { kind: "enter", messages: [prompt, runtimeContext, skillCatalog] }
  const result = await listener({ agent: undefined, messages: decision.messages }, async () => decision)
  expect(textOf(result.messages[0])).toBe(activationDirective("ship the widget"))
  expect(result.messages[0].id).toBe("u1") // identity preserved; the notices are untouched
  expect(result.messages[1]).toBe(runtimeContext)
  expect(result.messages[2]).toBe(skillCatalog)
  // LABELLED REGRESSION ARM: the retired claim was "the LAST user-role message carrying
  // text". Reproduce it and show it selects a NOTICE — the old implementation had nothing
  // to match and injected nothing for exactly this shape.
  const retiredClaim = [...decision.messages].reverse().find((message: any) => message?.role === "user" && textOf(message) !== "")
  expect(retiredClaim).toBe(skillCatalog)
  const retiredText = textOf(retiredClaim!).trim()
  expect(retiredText.startsWith("/ulw")).toBe(false)
  expect(retiredText.startsWith("/ultrawork")).toBe(false)
  // The scan reads EVERY user-role text: a notice arriving before the prompt does not hide
  // it, and a text-less user message (attachment-only) does not stop the scan.
  const reordered = { kind: "enter", messages: [runtimeContext, prompt] }
  expect(textOf((await listener({ agent: undefined, messages: reordered.messages }, async () => reordered)).messages[1])).toBe(activationDirective("ship the widget"))
  const attachmentOnly = { id: "a1", role: "user", content: [{ type: "attachment", ref: "x" }], source: { kind: "user" } }
  const skipped = { kind: "enter", messages: [attachmentOnly, prompt, skillCatalog] }
  expect(textOf((await listener({ agent: undefined, messages: skipped.messages }, async () => skipped)).messages[1])).toBe(activationDirective("ship the widget"))
})

test("the gesture boundary leaves every non-gesture step untouched", async () => {
  const { ctx, preStep } = makeHarness()
  apply(ctx, workdirs())
  const listener = preStep[0]
  const plain = { id: "p1", role: "user", content: [{ type: "text", text: "refactor the widget" }], source: { kind: "user" } }
  const decision = { kind: "enter", messages: [plain] }
  expect(await listener({ agent: undefined, messages: [plain] }, async () => decision)).toBe(decision)
  // A bare `/ulw` carries no objective: the command path answers usage, the gesture
  // has no reply surface, so the step is left exactly as composed.
  const bare = { id: "b1", role: "user", content: [{ type: "text", text: "/ulw" }], source: { kind: "user" } }
  const bareDecision = { kind: "enter", messages: [bare] }
  expect(await listener({ agent: undefined, messages: [bare] }, async () => bareDecision)).toBe(bareDecision)
  // Mentioning /ulw mid-text is not a gesture: the pattern is anchored at the start.
  const mentioned = { id: "n1", role: "user", content: [{ type: "text", text: "please run /ulw later" }], source: { kind: "user" } }
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
  const { ctx, tools } = makeHarness()
  const bare: any = { tools: ctx.tools, subagents: ctx.subagents }
  expect(() => apply(bare, workdirs())).not.toThrow()
  expect(tools.find((tool: any) => tool.name === "mpd_ultrawork")).toBeTruthy()
})
