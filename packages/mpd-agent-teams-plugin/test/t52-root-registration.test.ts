// t52 — the composition root WIRES the dormancy sweep. This is the guard for the
// registration move: the sweep used to be installed from inside
// `installSessionTeamPolicy`, which returns early when the team policy is off, and it now
// lives in `lib/index.js#apply`. Nothing else in the suite would notice if that one call
// were deleted, and the capability would silently go dark — the exact "written, tested,
// never called" class this wave exists to eliminate.
//
// The assertion is BEHAVIOURAL on purpose: listener COUNTING breaks whenever an unrelated
// row registers another pre-step hook, so instead the test drives every pre-step handler
// apply() registered and asserts that the past-due request actually got resolved.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The adopted composition root is vendored JavaScript with no declaration file, so `apply` is
// expected to arrive untyped instead of re-authoring upstream to type it.
// @ts-expect-error vendored JavaScript has no declaration file
import { apply } from "../lib/index.js"
// The adopted state module is vendored JavaScript with no declaration file, for the same reason.
// @ts-expect-error vendored JavaScript has no declaration file
import { INTERJECTION_TTL_MS, enqueueInterjection, readInterjections } from "../lib/state.js"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** Team id the stub root must sweep, distinct from any real workspace team. */
const TEAM = "root-team"
/** Epoch milliseconds far enough in the past that the sweep must treat the request as overdue. */
const PAST_DUE_TS = 1_000_000

/** One registration the stub root collected: the event, the body, and the options it was given. */
type RegisteredListener = {
  /** Event the listener subscribed to (`agent/pre-step` holds the dormancy sweep). */
  readonly name: string
  /** The listener body, invoked exactly as the harness waterfall invokes it. */
  readonly handler: (payload: { agent: { session: { header: { cwd: string } } } }, next: () => Promise<{ kind: string }>) => Promise<unknown>
  /** Subscription options, kept verbatim so a registration can be inspected. */
  readonly options?: unknown
}

/** The minimum ctx `apply` touches, plus a collector for every registered listener. */
function harness(): {
  /** Absolute workspace directory the stub sessions report as their cwd. */
  workspace: string
  /** The `<workspace>/.mpd/team` root the seeded team record lives under. */
  stateRoot: string
  /** The stub composition root, opaque here and handed only to the real `apply`. */
  ctx: Record<string, unknown>
  /** Every listener `apply` registered, in registration order. */
  listeners: RegisteredListener[]
  /** Removes the temporary workspace tree. */
  cleanup: () => void
} {
  /** Temporary workspace the stub sessions report as their cwd. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-root-"))
  /** The state root under that workspace, where the seeded team record must be found. */
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  /** Registrations collected by the stub; the sweep is proved by DRIVING these, not by counting. */
  const listeners: RegisteredListener[] = []
  /** The stub composition root: only the seams `apply` is known to touch. */
  const ctx = {
    on: (name: string, handler: RegisteredListener["handler"], options?: unknown) => { listeners.push({ name, handler, options }) },
    tools: { register: () => {}, get: () => undefined, has: () => false },
    llm: { resolveCallConfig: async (r: unknown) => r, listModels: async () => [] },
    subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} },
    systemPrompt: { section: () => {} },
    agents: { get: () => undefined, list: () => [] },
    effect: () => {}, get: () => undefined,
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    // later optional rows await services this stub does not provide; never invoking the
    // callback is exactly how cordis behaves when the service is absent
    inject: () => () => {},
  }
  return { workspace, stateRoot, ctx, listeners, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/** Seed one interjection whose TTL has already elapsed, so any sweep must resolve it. */
async function seedPastDue(stateRoot: string): Promise<void> {
  await enqueueInterjection(stateRoot, TEAM, {
    id: "ij-root", from: "Senior Engineer", content: "please unblock me",
    ts: PAST_DUE_TS, summary: "blocked", reason: "gate is red", location: "t52",
  })
}

/** Drive every pre-step handler apply() registered, as the harness would. */
async function drivePreStep(listeners: RegisteredListener[], workspace: string): Promise<number> {
  /** The pre-step registrations, in the order the root registered them. */
  const preStep = listeners.filter((entry) => entry.name === "agent/pre-step")
  for (const entry of preStep) {
    try {
      await entry.handler({ agent: { session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    } catch {
      // a policy handler may legitimately need more of the harness than this stub; the
      // sweep is the one that must work with nothing but a session cwd
    }
  }
  return preStep.length
}

test("t52 COMPOSITION ROOT: apply() resolves a past-due request even with the team policy OFF", async () => {
  // The fixture's workspace, state root, stub root and registration collector.
  const { workspace, stateRoot, ctx, listeners, cleanup } = harness()
  try {
    await seedPastDue(stateRoot)
    apply(ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("pending") // nothing ran yet
    /** How many pre-step handlers the root registered; a zero would make the drive vacuous. */
    const driven = await drivePreStep(listeners, workspace)
    expect(driven).toBeGreaterThan(0)
    // the capability actually FIRED through the root's wiring, with the policy off
    /** The request rows after the drive; the seeded one must now be resolved. */
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("expired")
  } finally { cleanup() }
})

test("t52 COMPOSITION ROOT NEGATIVE CONTROL: with no apply() the request stays pending", async () => {
  // Only the state root is needed: this arm never calls apply().
  const { stateRoot, cleanup } = harness()
  try {
    await seedPastDue(stateRoot)
    // no apply() => no listener exists => the row must remain pending. This is what makes
    // the assertion above falsifiable rather than a property of the fixture.
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("pending")
  } finally { cleanup() }
})
