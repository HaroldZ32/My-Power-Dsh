// T8 RE-REVIEW PROBES (R3 — permit/wait + the tool-surface re-baseline). Part 1 measures the whole
// registered surface with the SHIPPED cost function and attributes the delta to the permit/wait
// interface. Part 2 exercises the permit/wait RULES. Black-box; never edits the package.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply } from "../../../../packages/mpd-team-core-plugin/src/index.ts"
import {
  PERMIT_DEFAULT_TTL_MS,
  PERMIT_MAX_TTL_MS,
  WAIT_MAX_TIMEOUT_MS,
  checkPermit,
  checkWaitTarget,
  foldPermits,
  issuePermit,
  readPermits,
  waitForReply,
  type PermitCaller,
} from "../../../../packages/mpd-team-core-plugin/src/mail-permit.ts"
import { readMailbox, appendRecord } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** What one registration costs the context, EXACTLY as test/tool-surface.test.ts computes it. */
const costOf = (tool: { name: string; description: string; parameters: unknown }): number => JSON.stringify({ n: tool.name, d: tool.description, p: tool.parameters }).length

/** Apply the plugin to a stub adapter and return the registrations. */
function captureSurface(): { tools: Array<{ name: string; description: string; parameters: unknown; output?: { schema?: unknown } }>; commands: Array<{ name: string }> } {
  const out = { tools: [] as Array<{ name: string; description: string; parameters: unknown; output?: { schema?: unknown } }>, commands: [] as Array<{ name: string }> }
  const noop = (): (() => void) => () => {}
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, prop) => {
      if (prop === "registerTool") return (d: { name: string; description: string; parameters: unknown; output?: { schema?: unknown } }) => { out.tools.push(d); return () => {} }
      if (prop === "registerCommand") return (d: { name: string }) => { out.commands.push(d); return () => {} }
      if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "r3-surface-"))
      if (prop === "capabilities") return () => ({})
      return noop
    },
  })
  const ctx = { get: (name: string) => (name === "mpdDsh" ? dsh : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: noop, inject: noop }
  apply(ctx as never)
  return out
}

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

// ── PART 1: the budget, measured and attributed ────────────────────────────────────────────────────
const surface = captureSurface()
const perTool = surface.tools.map((tool) => ({ name: tool.name, chars: costOf(tool), descriptionChars: tool.description.length, parameterChars: JSON.stringify(tool.parameters).length }))
const total = surface.tools.reduce((sum, tool) => sum + costOf(tool), 0) + surface.commands.length * 96
show("B1 surface total", total)
show("B2 per-tool", perTool)
show("B3 tools+commands", { tools: surface.tools.length, commands: surface.commands.length, sum: surface.tools.length + surface.commands.length })

/** The T2-era mail description the re-baseline comment says measured 5,414 (reconstructed from the T2 diff). */
const T2_DESCRIPTION = "The team mailbox. `send` messages one member (through the official transport) and records it; `unread` lists what a member has NOT acknowledged; `read` acknowledges ids; `summary` counts total/unread/undelivered per member. Delivery and reading are separate facts: a message the transport accepted is still unread until the recipient acknowledges it. A `question`/`answer` object makes the row that kind; answers echo LABELS verbatim, never an index."
/** The T2-era per-tool costs measured by R2 (T7) on the same cost function. */
const T2_PER_TOOL = { agent_teams_plan: 1767, agent_teams_task: 880, agent_teams_dispatch: 782, agent_teams_mail: 1400, agent_teams_control: 489 }
const T2_TOTAL = 5414
const mail = surface.tools.find((tool) => tool.name === "agent_teams_mail")
if (mail !== undefined) {
  const parameters = mail.parameters as { properties?: Record<string, unknown> }
  const properties = parameters.properties ?? {}
  const NEW_KEYS = ["holder", "scope", "ttlMs", "permitId", "messageId", "timeoutMs", "questionId"]
  const newKeySizes = NEW_KEYS.map((key) => ({ key, chars: JSON.stringify({ [key]: properties[key] }).length - 2, description: String((properties[key] as { description?: string } | undefined)?.description ?? "") }))
  const action = properties.action as { enum?: string[] } | undefined
  const currentEnum = JSON.stringify(action?.enum ?? []).length
  const t2Enum = JSON.stringify(["send", "unread", "read", "summary"]).length
  const outputSchemaChars = JSON.stringify(mail.output?.schema ?? {}).length
  const t2Output = JSON.stringify({ type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, scope: { type: "string" }, legacyUnstamped: { type: "number" }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" }, broadcast: { type: "boolean" } } }).length
  show("B4 other tools unchanged vs the R2 measurement", Object.fromEntries(Object.entries(T2_PER_TOOL).filter(([name]) => name !== "agent_teams_mail").map(([name, chars]) => [name, { then: chars, now: perTool.find((tool) => tool.name === name)?.chars }])))
  show("B5 mail tool chars", { then: T2_PER_TOOL.agent_teams_mail, now: costOf(mail), delta: costOf(mail) - T2_PER_TOOL.agent_teams_mail })
  show("B6 delta decomposition", {
    totalDelta: total - T2_TOTAL,
    newPropertyKeysChars: newKeySizes.reduce((sum, entry) => sum + entry.chars, 0),
    actionEnumDelta: currentEnum - t2Enum,
    descriptionDelta: mail.description.length - T2_DESCRIPTION.length,
    outputSchemaDelta: outputSchemaChars - t2Output,
    newProperties: newKeySizes,
    currentEnum: action?.enum,
  })
}

// ── PART 2: the permit/wait rules ──────────────────────────────────────────────────────────────────
{
  const box = mkdtempSync(join(tmpdir(), "r3-permit-"))
  const now = new Date("2026-10-31T10:00:00.000Z")
  const member: PermitCaller = { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session", leadIds: ["lead-session"], requestedTimeoutMs: 999_999 }
  const otherLead: PermitCaller = { holderId: "M1", holderName: "Senior Engineer", sessionId: "member-session", leadIds: ["other-lead"], requestedTimeoutMs: 60_000 }

  // Issue + fold round-trip.
  const issued = issuePermit(box, { permitId: "p1", issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, now)
  show("P1 issue a permit", issued.ok ? { ok: true, expiresAt: (issued as { ok: true; permit: { expiresAt: string } }).permit.expiresAt } : issued)
  // A non-answer scope, a bad TTL and a good wait must not corrupt the log.
  show("P2 bad scope refused", issuePermit(box, { permitId: "p2", issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "nope" as never, ttlMs: 60_000 }, now))
  show("P3 bad TTL refused", issuePermit(box, { permitId: "p3", issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 0 }, now))
  show("P4 permits after refusals", readPermits(box).permits.map((permit) => permit.permitId))

  // checkPermit: valid, expired, foreign holder, foreign issuer, bounded timeout.
  const fold = readPermits(box)
  const permit = fold.permits[0]
  show("P5 valid permit", permit === undefined ? "missing" : checkPermit(permit, member, now))
  show("P6 expired permit", permit === undefined ? "missing" : checkPermit(permit, member, new Date(now.getTime() + 60_001)))
  show("P7 foreign holder", permit === undefined ? "missing" : checkPermit(permit, { ...member, holderId: "M2", holderName: "other" }, now))
  show("P8 foreign issuer", permit === undefined ? "missing" : checkPermit(permit, otherLead, now))
  show("P9 timeout is the smallest of request / hard bound / remainder", permit === undefined ? "missing" : { effective: (checkPermit(permit, { ...member, requestedTimeoutMs: 999_999 }, now) as { ok: true; timeoutMs: number }).timeoutMs, hardBound: WAIT_MAX_TIMEOUT_MS })
  rmSync(box, { recursive: true, force: true })
}

// ── waitForReply: finite, timeout, no busy loop ───────────────────────────────────────────────────
{
  const box = mkdtempSync(join(tmpdir(), "r3-wait-"))
  appendRecord(box, { t: "send", id: "q1", kind: "question", fromId: "lead-session", fromName: "captain", toId: "M1", toName: "Senior Engineer", subject: "q", body: "q", at: "2026-10-31T10:00:00.000Z", threadId: "q1", question: { questionId: "q1", question: "which?", options: [{ label: "A. one" }] } } as never)
  const question = readMailbox(box).messages[0]
  const permit = { t: "permit" as const, permitId: "w1", issuerId: "lead-session", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer" as const, ttlMs: 60_000, expiresAt: "2026-10-31T11:00:00.000Z", questionId: "q1", at: "2026-10-31T10:00:00.000Z" }
  const frozen = new Date("2026-10-31T10:00:00.000Z")
  const wait = await waitForReply({
    permit,
    target: question,
    timeoutMs: 0,
    intervalMs: 50,
    read: () => readMailbox(box),
    sleep: async (_ms: number): Promise<void> => undefined,
    now: () => frozen,
  })
  show("W1 timeout 0 waits at most one poll", { ok: (wait as { ok: boolean }).ok, reason: (wait as { reason?: string }).reason, polls: (wait as { polls: number }).polls })
  // The answer arrives: scope answer matches answerTo AND questionId.
  appendRecord(box, { t: "send", id: "a1", kind: "answer", replyTo: "q1", fromId: "M1", fromName: "Senior Engineer", toId: "lead-session", toName: "captain", subject: "a", body: "a", at: "2026-10-31T10:00:01.000Z", threadId: "q1", answer: { questionId: "q1", answerTo: "q1", selected: ["A. one"] } } as never)
  const wait2 = await waitForReply({ permit, target: question, timeoutMs: 5_000, intervalMs: 10, read: () => readMailbox(box), sleep: async (_ms: number): Promise<void> => undefined, now: () => new Date("2026-10-31T10:00:02.000Z") })
  show("W2 an answer already present is returned", { ok: (wait2 as { ok: boolean }).ok, ids: ((wait2 as { messages?: Array<{ id: string }> }).messages ?? []).map((message) => message.id), polls: (wait2 as { polls: number }).polls })
  // A FROZEN clock still terminates: the poll ceiling bounds the loop independently of time.
  const emptyBox = mkdtempSync(join(tmpdir(), "r3-wait-empty-"))
  const frozenWait = await waitForReply({ permit, target: question, timeoutMs: 50, intervalMs: 10, read: () => readMailbox(emptyBox), sleep: async (_ms: number): Promise<void> => undefined, now: () => frozen })
  show("W3 frozen clock terminates on the poll ceiling", { ok: (frozenWait as { ok: boolean }).ok, reason: (frozenWait as { reason?: string }).reason, polls: (frozenWait as { polls: number }).polls })
  const aborter = new AbortController()
  aborter.abort()
  const abortedWait = await waitForReply({ permit, target: question, timeoutMs: 5_000, intervalMs: 10, read: () => readMailbox(emptyBox), sleep: async (_ms: number): Promise<void> => undefined, now: () => frozen, signal: aborter.signal })
  show("W4 aborted wait stops", { ok: (abortedWait as { ok: boolean }).ok, reason: (abortedWait as { reason?: string }).reason, polls: (abortedWait as { polls: number }).polls })
  rmSync(emptyBox, { recursive: true, force: true })
  // Scope checks.
  show("W5 scope answer rejects a non-question target", checkWaitTarget(permit, { ...readMailbox(box).messages[0], kind: "message", question: undefined } as never))
  show("W6 wrong question refused", checkWaitTarget({ ...permit, questionId: "q-other" }, question as never))
  show("W7 right question accepted", checkWaitTarget(permit, question as never))
  rmSync(box, { recursive: true, force: true })
}
