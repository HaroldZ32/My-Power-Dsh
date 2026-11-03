// VEDIT-P0 / LANE B — contract `.mpd/plans/cellwork-vedit-p0-fix-r2.md`, C3 + C4 (the team-core side).
//
// TWO MEASURED DEFECTS this file pins on Band 2 (`d2032bf3`):
//   D2 — `cellwork_send` refuses a recipient at EIGHT undelivered messages, and that bound was a bare
//        `?? 8` inside `sendMany`: no workspace knob, no disclosure in either tool description, and a
//        refusal sentence that named the count but offered no way out. "Use the official mail as a
//        fallback" was never an escape, because `agent_teams_mail` sends through the SAME store.
//   D3 — `agent_teams_plan {action:"create_task"}` with no `write_scopes` froze a contract that allows
//        no path, silently: the writer stops on its first edit (a `repair` row is the worst case).
//
// EVERY arm reads the surface a caller really sees — the store's own verdict, the tool's result and the
// tool's OWN renderer — never an internal field alone.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { apply } from "../src/index"
import {
  DEFAULT_MAIL_MAX_UNDELIVERED,
  MAIL_MAX_UNDELIVERED_KEY,
  acknowledge,
  mailMaxUndeliveredOf,
  markDelivered,
  readMailbox,
  send,
  type SendInput,
  type SendResult,
} from "../src/mailbox-store"
import { activeTeamId } from "../src/team-store"

/** The checkout root: `mpd-gates.json` must never be left here, so its absence is asserted in place. */
const REPO_ROOT = resolve(import.meta.dir, "../../..")

/** The rented sandbox workspaces, removed after each arm so a red run leaves nothing behind. */
const sandboxes: string[] = []

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One captured tool registration, with the halves a caller's surface has: the executor, the schema, the render. */
interface CapturedTool {
  /** The registered tool name. */
  name: string
  /** The one-line description the model reads before it calls. */
  description: string
  /** The argument schema; only its declared properties are read here. */
  parameters?: { properties?: Record<string, { description?: string }> }
  /** The output half: the declared allowlist and the renderer a caller reads. */
  output?: {
    schema?: { properties?: Record<string, unknown> }
    render?: (args: unknown, value: unknown) => Array<{ text?: string }>
  }
  /** The executor, exactly as the harness calls it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The stub composition one arm drives: the sandbox, its tools, and the two switches the arms need. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the real plugin registered. */
  tools: Map<string, CapturedTool>
  /** The `mpd.jsonc` layer this composition exposes as the `mpdConfig` service. */
  config: Record<string, unknown>
  /** Drive one registered tool as a given session. */
  call: (name: string, args: unknown, sessionId?: string) => Promise<any>
  /** Paint one tool's value through its OWN declared renderer — the text a caller reads. */
  render: (name: string, value: unknown) => string
  /** Make the transport accept (false) or refuse (true) every delivery from now on. */
  setDeliveryFailure: (fails: boolean) => void
}

/**
 * Build the harness: the REAL plugin applied over a stub adapter, stub executor and stub config layer.
 * @param config - the `mpd.jsonc` leaves this composition declares, read through `mpdConfig.get(dottedKey)`.
 * @returns the harness an arm drives.
 */
function harness(config: Record<string, unknown> = {}): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-vedit-lane-b-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered, by name. */
  const tools = new Map<string, CapturedTool>()
  /** Whether the transport refuses every delivery; arms flip it to model a stalled member. */
  let deliveryFails = false
  /** The stub executor: mints a name-derived handle, and delivers only while `deliveryFails` is false. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    send: async (): Promise<void> => {
      if (deliveryFails) throw new Error("the transport is full")
    },
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The config service the row reads through `ctx.get("mpdConfig")`, on the documented `get(dottedKey)`. */
  const configService = { get: (key?: string): unknown => (key === undefined ? config : config[key]) }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdConfig" ? configService : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    config,
    setDeliveryFailure: (fails: boolean): void => { deliveryFails = fails },
    call: async (name: string, args: unknown, sessionId = LEAD): Promise<any> => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace } } }, signal: undefined })
    },
    render: (name: string, value: unknown): string => {
      /** The registered tool whose renderer is being driven. */
      const tool = tools.get(name)
      return (tool?.output?.render?.({}, value) ?? []).map((part) => part.text ?? "").join("")
    },
  }
}

/** The captain session every arm approves its team as. */
const LEAD = "sess-lead"

/**
 * Stage and approve a one-member team AS the captain.
 * @param h - the harness to approve in.
 * @param member - the single member's display name.
 * @param scopes - the write scopes its row declares; a non-empty list keeps the C4 warning out of the way.
 * @returns the approved team's id.
 */
async function approveTeam(h: Harness, member: string, scopes: string[] = ["src/**"]): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "lane-b", description: "the mail bound" })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: member, description: "a worker", prompt: `You are ${member}.` } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "row", description: "one row", blocked_by: [], write_scopes: scopes } })
  await h.call("agent_teams_plan", { action: "approve" })
  /** The team the approval bound to the captain session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the captain session")
  return teamId
}

// ── D2: the bound is a DECLARED workspace knob ────────────────────────────────────────────────────

describe("C3 — the mail bound is a declared workspace knob", () => {
  test("the key and the shipped default are exactly the ones the contract names", () => {
    expect(MAIL_MAX_UNDELIVERED_KEY).toBe("mail.maxUndelivered")
    expect(DEFAULT_MAIL_MAX_UNDELIVERED).toBe(8)
  })

  test("the resolver reads the config layer, defaults to 8, and accepts 0 as `no bound`", () => {
    // Nothing declared, a blank, a negative, a fraction and a non-number all fall back to the default
    // rather than refusing mail: a misconfigured knob must not turn the mailbox off.
    expect(mailMaxUndeliveredOf(() => undefined)).toBe(8)
    expect(mailMaxUndeliveredOf(() => "8")).toBe(8)
    expect(mailMaxUndeliveredOf(() => -1)).toBe(8)
    expect(mailMaxUndeliveredOf(() => 1.5)).toBe(8)
    expect(mailMaxUndeliveredOf((): unknown => { throw new Error("an unreadable layer") })).toBe(8)
    // A whole number in range is HONOURED, and 0 disables the bound (the store's own documented rule).
    expect(mailMaxUndeliveredOf((key) => (key === MAIL_MAX_UNDELIVERED_KEY ? 3 : undefined))).toBe(3)
    expect(mailMaxUndeliveredOf((key) => (key === MAIL_MAX_UNDELIVERED_KEY ? 0 : undefined))).toBe(0)
  })

  test("the refusal NAMES the recipient, the count, the bound and BOTH recovery paths", () => {
    /** A sandbox whose mailbox is driven directly, so the refusal sentence is the store's own. */
    const box = mkdtempSync(join(tmpdir(), "mpd-vedit-bound-"))
    sandboxes.push(box)
    /** The frozen clock. */
    const now = new Date("2026-11-03T00:00:00.000Z")
    /** A well-formed send for the sandbox's two-member roster. */
    const msg = (over: Partial<SendInput> = {}): SendInput => ({
      fromId: "lead", fromName: "lead", toId: "senior", toName: "senior",
      subject: "s", body: "b", memberIds: ["lead", "senior"], maxUndelivered: 2, ...over,
    })
    for (let index = 0; index < 2; index += 1) expect(send(box, msg({ subject: "row " + index }), now).ok).toBe(true)
    /** The send that exceeds the declared bound. */
    const refused = send(box, msg({ subject: "row 2" }), now)
    expect(refused.ok).toBe(false)
    /** The refusal sentence, which is what a captain reads instead of a bare count. */
    const detail = String((refused as Extract<SendResult, { ok: false }>).detail)
    // The recipient, the current count and the declared bound.
    expect(detail).toContain('"senior"')
    expect(detail).toContain("2 undelivered")
    expect(detail).toContain("bound")
    expect(detail).toContain("2")
    // …the knob is NAMED, so the operator knows where the number comes from…
    expect(detail).toContain(MAIL_MAX_UNDELIVERED_KEY)
    // …and BOTH ways out: acknowledge the inbox, or reassign the rows.
    expect(detail).toContain("cellwork_inbox")
    expect(detail).toContain('agent_teams_mail {action:"read"}')
    expect(detail).toContain("cellwork_dispatch")
    expect(detail).toContain("reassign")
    // The bound still refuses without writing: nothing was appended for the refused send.
    expect(readMailbox(box).messages).toHaveLength(2)
  })

  test("an ACK frees exactly one slot, and so does a DELIVERY", () => {
    /** A sandbox mailbox with one undelivered row against a bound of one. */
    const box = mkdtempSync(join(tmpdir(), "mpd-vedit-free-"))
    sandboxes.push(box)
    /** The frozen clock. */
    const now = new Date("2026-11-03T00:00:00.000Z")
    /** A well-formed send against the bound of one. */
    const msg = (over: Partial<SendInput> = {}): SendInput => ({
      fromId: "lead", fromName: "lead", toId: "senior", toName: "senior",
      subject: "s", body: "b", memberIds: ["lead", "senior"], maxUndelivered: 1, ...over,
    })
    /** The first row, which fills the bound. */
    const first = send(box, msg({ subject: "first" }), now)
    expect(first.ok).toBe(true)
    expect(send(box, msg({ subject: "second" }), now).ok).toBe(false)
    // DELIVERY frees exactly one: the transport accepted the row, so it is no longer outstanding.
    if (!first.ok) return
    expect(markDelivered(box, [first.message.id], now)).toEqual([first.message.id])
    expect(send(box, msg({ subject: "after delivery" }), now).ok).toBe(true)
    expect(send(box, msg({ subject: "over again" }), now).ok).toBe(false)
    // …and an ACK frees exactly one too, which is the operator's release valve.
    /** The row now filling the bound. */
    const outstanding = readMailbox(box).messages.find((message) => message.deliveredAt === undefined && message.readAt === undefined)
    if (outstanding === undefined) throw new Error("the sandbox holds no outstanding row")
    expect(acknowledge(box, [outstanding.id], { byId: outstanding.toId, byName: outstanding.toName }, now).moved).toEqual([outstanding.id])
    expect(send(box, msg({ subject: "after ack" }), now).ok).toBe(true)
  })

  test("counting stays PER TEAM: a retired team's rows count for nobody, and so do unstamped legacy rows", () => {
    /** A sandbox mailbox shared by a retired team and the live one. */
    const box = mkdtempSync(join(tmpdir(), "mpd-vedit-scope-"))
    sandboxes.push(box)
    /** The frozen clock. */
    const now = new Date("2026-11-03T00:00:00.000Z")
    /** A well-formed send, stamped with the team it belongs to. */
    const msg = (over: Partial<SendInput> = {}): SendInput => ({
      fromId: "lead", fromName: "lead", toId: "M1", toName: "senior",
      subject: "s", body: "b", memberIds: ["M1"], maxUndelivered: 2, ...over,
    })
    // An UNSTAMPED legacy row predates the field, so no team can prove it owns it. It goes FIRST, while
    // this sandbox is empty, because an unstamped SEND has no team to scope by and reads the whole fold.
    expect(send(box, msg({ subject: "legacy" }), now).ok).toBe(true)
    // A FINISHED wave exhausted its own bound under the same member id (`M1` is per-team and reused).
    for (let index = 0; index < 2; index += 1) expect(send(box, msg({ subject: "retired " + index, teamId: "team-retired" }), now).ok).toBe(true)
    // The live team starts with an EMPTY backlog: neither the retired wave's rows nor the legacy row count.
    expect(send(box, msg({ subject: "live 0", teamId: "team-live" }), now).ok).toBe(true)
    expect(send(box, msg({ subject: "live 1", teamId: "team-live" }), now).ok).toBe(true)
    // …while ITS OWN third row is still refused, so the scoping never disables the bound.
    expect(send(box, msg({ subject: "live 2", teamId: "team-live" }), now).ok).toBe(false)
  })

  test("the ONE sendMany path applies the config bound to agent_teams_mail, end to end", async () => {
    // A workspace declaring two, NOT the shipped eight: the tool must read the knob through `mpdConfig`.
    const h = harness({ "mail.maxUndelivered": 2 })
    await approveTeam(h, "Senior Engineer")
    h.setDeliveryFailure(true)
    /** The ids of the two rows the bound admits. */
    const ids: string[] = []
    for (let index = 0; index < 2; index += 1) {
      /** The tool's answer for one admitted send. */
      const sent = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row " + index, body: "work" })
      ids.push(String(sent.message.id))
    }
    /** The third send, which the DECLARED bound must refuse. */
    const refused = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row 2", body: "work" })
    expect(String(refused.refused)).toContain("2 undelivered")
    expect(String(refused.refused)).toContain("bound")
    expect(String(refused.refused)).toContain("cellwork_inbox")
    expect(String(refused.refused)).toContain("cellwork_dispatch")
    // The member acknowledges ONE row under its own handle, and exactly one slot opens.
    const acked = await h.call("agent_teams_mail", { action: "read", ids: [ids[0]] }, "child-Senior-Engineer")
    expect(acked.moved).toEqual([ids[0]])
    /** The send the freed slot admits. */
    const afterAck = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row 3", body: "work" })
    expect(afterAck.message).toBeDefined()
    // …and the bound closes again: one ack moved exactly one slot, never two.
    const closed = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row 4", body: "work" })
    expect(String(closed.refused)).toContain("2 undelivered")
  })

  test("with no config the tool applies the shipped DEFAULT 8", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await approveTeam(h, "Senior Engineer")
    h.setDeliveryFailure(true)
    for (let index = 0; index < 8; index += 1) {
      /** The tool's answer for one admitted send. */
      const sent = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row " + index, body: "work" })
      expect(sent.message).toBeDefined()
    }
    /** The ninth send, which the shipped default must refuse. */
    const refused = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "row 8", body: "work" })
    expect(String(refused.refused)).toContain("8 undelivered")
    expect(String(refused.refused)).toContain(MAIL_MAX_UNDELIVERED_KEY)
  })

  test("BOTH tool descriptions disclose the bound and the shared enforcement", () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The mail tool's own description, which is what the model reads before it sends. */
    const mail = h.tools.get("agent_teams_mail")?.description ?? ""
    // The bound, its config key, and the fact that cellwork sends through the same store.
    expect(mail).toContain(MAIL_MAX_UNDELIVERED_KEY)
    expect(mail).toContain("cellwork_send")
  })

  test("no mpd-gates.json is created in the checkout by any of this", async () => {
    expect(existsSync(join(REPO_ROOT, "mpd-gates.json"))).toBe(false)
    /** The harness this arm drives. */
    const h = harness()
    await approveTeam(h, "Senior Engineer")
    await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "s", body: "b" })
    expect(existsSync(join(REPO_ROOT, "mpd-gates.json"))).toBe(false)
  })
})

// ── D3: an empty write_scopes list is LOUD, never silent ─────────────────────────────────────────

describe("C4 — create_task WARNS about empty write scopes", () => {
  test("a work task with no scopes is still created AND carries the warning", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "lane-b", description: "warn" })
    /** The staged create_task answer — the value a captain reads at write time. */
    const answer = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "no scopes", description: "d", blocked_by: [] } })
    // NON-BREAKING: the row really was staged…
    expect(answer.plan.tasks).toHaveLength(1)
    expect(answer.plan.tasks[0].writeScopes ?? []).toEqual([])
    // …and the warning names the CONSEQUENCE and the REMEDY, not just "no scopes".
    const warning = String(answer.warning ?? "")
    expect(warning).toContain("NO write scopes")
    expect(warning).toContain("allows NO path")
    expect(warning).toContain("must stop")
    expect(warning).toContain("declare the scopes now")
    expect(warning).toContain("amend the contract before the first write")
    // The renderer PAINTS it: a field the captain never sees would be silent in practice.
    expect(h.render("agent_teams_plan", answer)).toContain("NO write scopes")
  })

  test("every WRITING kind warns, and an explicit empty list warns too", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "lane-b", description: "warn" })
    /** One arm: the kind under test, and the write-scope spelling it sends. */
    const arms: Array<{ kind?: string; writeScopes?: string[]; warns: boolean }> = [
      { kind: undefined, warns: true },
      { kind: "work", warns: true },
      { kind: "repair", warns: true },
      { kind: "integration", warns: true },
      { kind: "work", writeScopes: [], warns: true },
      { kind: "requirement", warns: false },
      { kind: "review", warns: false },
      { kind: "review", writeScopes: ["docs/**"], warns: false },
    ]
    for (const [index, arm] of arms.entries()) {
      /** The task argument, carrying only the keys this arm declares. */
      const task: Record<string, unknown> = { subject: "row " + index, description: "d", blocked_by: [] }
      if (arm.kind !== undefined) task.kind = arm.kind
      if (arm.writeScopes !== undefined) task.write_scopes = arm.writeScopes
      /** The tool's answer for this kind. */
      const answer = await h.call("agent_teams_plan", { action: "create_task", task })
      if (arm.warns) {
        expect(String(answer.warning ?? "")).toContain("NO write scopes")
      } else {
        expect(answer.warning).toBeUndefined()
      }
    }
  })

  test("a declared scope list does NOT warn", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "lane-b", description: "warn" })
    /** The tool's answer for the scoped row. */
    const answer = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "scoped", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    expect(answer.warning).toBeUndefined()
    expect(answer.plan.tasks[0].writeScopes).toEqual(["packages/x/**"])
  })

  test("the MID-RUN append warns the same way", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await approveTeam(h, "Senior Engineer")
    /** The live board's answer for a repair row with no scopes — the worst case the defect named. */
    const answer = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "mid-run repair", description: "d", blocked_by: [], kind: "repair" } })
    expect(String(answer.appended ?? "")).toContain("appended")
    expect(String(answer.warning ?? "")).toContain("NO write scopes")
    expect(String(answer.warning ?? "")).toContain("repair")
  })

  test("the output-schema allowlist DECLARES the field, and the pass-through description states the rule", () => {
    /** The harness this arm drives. */
    const h = harness()
    /** The plan tool's declared output allowlist. */
    const schema = h.tools.get("agent_teams_plan")?.output?.schema?.properties ?? {}
    expect(Object.prototype.hasOwnProperty.call(schema, "warning")).toBe(true)
    /** The plan tool's description, which must say the warning rule so a caller expects it. */
    const description = h.tools.get("agent_teams_plan")?.description ?? ""
    expect(description).toContain("write_scopes")
    expect(description).toContain("WARNS")
  })

  test("no scope-clash regression: the overlap refusal still names the pair and both remedies", async () => {
    /** The harness this arm drives. */
    const h = harness()
    await h.call("agent_teams_plan", { action: "create", name: "lane-b", description: "clash" })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "other", description: "d", blocked_by: [], write_scopes: ["packages/x"] } })
    /** The approval's refusal, captured rather than thrown out of the arm. */
    const refusal = await h.call("agent_teams_plan", { action: "approve" }).then(() => undefined, (error: unknown) => error)
    expect(refusal).toBeDefined()
    /** The refusal sentence the approval raised. */
    const message = String((refusal as Error)?.message ?? "")
    expect(message).toContain("T1")
    expect(message).toContain("T2")
    expect(message.toLowerCase()).toContain("disjoint")
    // …and making the scopes disjoint approves the same plan.
    /** A second harness, so the refused staging file cannot leak into the repaired plan. */
    const repaired = harness()
    await repaired.call("agent_teams_plan", { action: "create", name: "lane-b", description: "clash" })
    await repaired.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "d", blocked_by: [], write_scopes: ["packages/x/**"] } })
    await repaired.call("agent_teams_plan", { action: "create_task", task: { subject: "other", description: "d", blocked_by: [], write_scopes: ["packages/y"] } })
    await repaired.call("agent_teams_plan", { action: "approve" })
    expect(activeTeamId(repaired.workspace, LEAD)).toBeDefined()
  })
})
