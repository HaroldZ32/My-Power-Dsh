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
import { apply } from "../lib/index.js"
import { INTERJECTION_TTL_MS, enqueueInterjection, readInterjections } from "../lib/state.js"

const STATE_DIR = join(".mpd", "team")
const TEAM = "root-team"
const PAST_DUE_TS = 1_000_000

/** The minimum ctx `apply` touches, plus a collector for every registered listener. */
function harness() {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-root-"))
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  const listeners = []
  const ctx = {
    on: (name, handler, options) => { listeners.push({ name, handler, options }) },
    tools: { register: () => {}, get: () => undefined, has: () => false },
    llm: { resolveCallConfig: async (r) => r, listModels: async () => [] },
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

async function seedPastDue(stateRoot) {
  await enqueueInterjection(stateRoot, TEAM, {
    id: "ij-root", from: "Senior Engineer", content: "please unblock me",
    ts: PAST_DUE_TS, summary: "blocked", reason: "gate is red", location: "t52",
  })
}

/** Drive every pre-step handler apply() registered, as the harness would. */
async function drivePreStep(listeners, workspace) {
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
  const { workspace, stateRoot, ctx, listeners, cleanup } = harness()
  try {
    await seedPastDue(stateRoot)
    apply(ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("pending") // nothing ran yet
    const driven = await drivePreStep(listeners, workspace)
    expect(driven).toBeGreaterThan(0)
    // the capability actually FIRED through the root's wiring, with the policy off
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("expired")
  } finally { cleanup() }
})

test("t52 COMPOSITION ROOT NEGATIVE CONTROL: with no apply() the request stays pending", async () => {
  const { stateRoot, cleanup } = harness()
  try {
    await seedPastDue(stateRoot)
    // no apply() => no listener exists => the row must remain pending. This is what makes
    // the assertion above falsifiable rather than a property of the fixture.
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("pending")
  } finally { cleanup() }
})
