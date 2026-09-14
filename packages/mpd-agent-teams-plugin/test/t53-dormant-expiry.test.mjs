// t53 — the DORMANT-team half of R1's expiry contract.
//
// The scheduler's expiry tick rides a member IDLE EDGE, so a team that never kicks
// again leaves a past-due request `pending` forever and its requester is never told.
// These tests drive the SHIPPED session-start sweep (the same function the
// agent/pre-step listener calls) and its negative controls.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  INTERJECTION_TTL_MS,
  enqueueInterjection,
  expireInterjectionsEverywhere,
  readInterjections,
  readUnreadMailbox,
} from "../lib/state.js"
import { installInterjectionExpirySweep, installSessionTeamPolicy } from "../lib/session-start.js"

const STATE_DIR = join(".mpd", "team")
const TEAM = "dormant-team"
const PAST_DUE_TS = 1_000_000

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t53-"))
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  return { workspace, stateRoot, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/** A request enqueued long enough ago that its TTL is already past. */
async function seedPastDueRequest(stateRoot, over = {}) {
  return enqueueInterjection(stateRoot, TEAM, {
    id: "ij-dormant", from: "Senior Engineer", content: "please unblock me",
    ts: PAST_DUE_TS, summary: "blocked", reason: "gate is red", location: "t53",
    ...over,
  })
}

/** A second past-due request, to distinguish "swept once" from "swept again". */
async function seedSecondPastDue(stateRoot) {
  return enqueueInterjection(stateRoot, TEAM, {
    id: "ij-second", from: "Junior Engineer", content: "second request",
    ts: PAST_DUE_TS, summary: "second", reason: "still blocked", location: "t53",
  })
}

test("R1 DORMANT: a past-due request is expired and its requester TOLD without any scheduler kick", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    // nothing kicks this team: the ONLY thing that runs is the session-start sweep
    const swept = await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS + 1 })
    expect(swept.expired).toEqual(["ij-dormant"])
    expect(swept.teamIds).toEqual([TEAM])
    // the row is resolved (silence = DENY), not left pending
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe("expired")
    // and the requester is actually told, through the ordinary (non-interjection) lane
    const inbox = await readUnreadMailbox(stateRoot, TEAM, "Senior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("EXPIRED")
    expect(inbox[0].content).toContain("denied by default")
  } finally { cleanup() }
})

test("R1 DORMANT NEGATIVE CONTROL: a request still inside its TTL is left ALONE", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    // one millisecond BEFORE the deadline
    const swept = await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS - 1 })
    expect(swept.expired).toEqual([])
    expect(swept.teamIds).toEqual([])
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("pending")
    expect((await readUnreadMailbox(stateRoot, TEAM, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("R1 DORMANT NEGATIVE CONTROL: an empty/absent state root is a no-op, never a throw", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    // a root with no team directories at all
    const empty = await expireInterjectionsEverywhere(stateRoot)
    expect(empty).toEqual({ teamIds: [], expired: [] })
    // a root that does not exist yet
    const missing = await expireInterjectionsEverywhere(join(stateRoot, "does-not-exist"))
    expect(missing).toEqual({ teamIds: [], expired: [] })
  } finally { cleanup() }
})

test("R1 DORMANT: the sweep is ONCE PER SESSION, not once per step", async () => {
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    const listeners = []
    const logs = []
    const ctx = {
      on: (name, handler) => listeners.push({ name, handler }),
      logger: { info: (message) => logs.push(String(message)), warn: () => {}, error: () => {}, debug: () => {} },
    }
    installInterjectionExpirySweep(ctx, { stateDir: STATE_DIR })
    const payload = { agent: { id: "t53-once", session: { header: { cwd: workspace } } } }
    await listeners[0].handler(payload, async () => ({ kind: "accept" }))
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("expired")
    const logCountAfterFirst = logs.length
    // `agent/pre-step` fires on EVERY step. The guard must make the second one a no-op, so
    // the boundary statement ("expiry is evaluated at ... a session start") is true of the
    // code and not only of the comment.
    await seedSecondPastDue(stateRoot)
    await listeners[0].handler(payload, async () => ({ kind: "accept" }))
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows.find((row) => row.id === "ij-second")?.status).toBe("pending") // NOT swept
    expect(logs.length).toBe(logCountAfterFirst)
    // a DIFFERENT session still gets its own sweep — the guard is per agent, not global
    await listeners[0].handler({ agent: { id: "t53-other", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect((await readInterjections(stateRoot, TEAM)).find((row) => row.id === "ij-second")?.status).toBe("expired")
  } finally { cleanup() }
})

test("R1 DORMANT: the SHIPPED session-start hook runs the sweep (and only the session's own workspace)", async () => {
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    const listeners = []
    const logs = []
    const ctx = {
      on: (name, handler) => listeners.push({ name, handler }),
      logger: { info: (message) => logs.push(String(message)), warn: () => {}, error: () => {}, debug: () => {} },
    }
    // The sweep's registration lives in the COMPOSITION ROOT (lib/index.js), not inside
    // installSessionTeamPolicy: it is bookkeeping every session needs, so it must not be
    // gated behind the team policy. Installing the sweep directly is therefore the
    // shipped behaviour, and the policy installer is asserted to NOT register it.
    installSessionTeamPolicy(ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
    expect(listeners.length).toBe(0)
    installInterjectionExpirySweep(ctx, { stateDir: STATE_DIR })
    expect(listeners.length).toBe(1)
    expect(listeners[0].name).toBe("agent/pre-step")
    // drive the listener exactly as the harness does, with the session's own cwd
    const decision = await listeners[0].handler({ agent: { id: "t53-ok", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect(decision).toEqual({ kind: "accept" }) // the hook never replaces the decision
    const rows = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("expired")
    expect(logs.join("\n")).toContain("ij-dormant")
  } finally { cleanup() }
})

test("R1 DORMANT: a failing sweep degrades to a warning and still returns the decision", async () => {
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    const warnings = []
    const ctx = {
      on: (name, handler) => { ctx.handler = handler },
      logger: { info: () => {}, warn: (message) => warnings.push(String(message)), error: () => {}, debug: () => {} },
    }
    // make the state root a path THROUGH a regular file, so readdir throws ENOTDIR —
    // a real failure the sweep must degrade rather than propagate.
    writeFileSync(join(workspace, "blocker"), "not a directory")
    installInterjectionExpirySweep(ctx, { stateDir: "blocker/team" })
    const decision = await ctx.handler({ agent: { id: "t53-failing", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect(decision).toEqual({ kind: "accept" })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("session-start interjection sweep failed")
    // the pre-existing team state is untouched by the failed sweep
    expect((await readInterjections(stateRoot, TEAM)).length).toBe(0)
  } finally { cleanup() }
})

test("R1 DORMANT: room left for the durable side effect — the notice is an ordinary record", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS + 1 })
    const raw = readFileSync(join(stateRoot, TEAM, "inbox", "senior-engineer.jsonl"), "utf8")
    const records = raw.trim().split("\n").map((line) => JSON.parse(line))
    expect(records.length).toBe(1)
    expect(records[0].id).toBe("interjection-expired-ij-dormant")
    expect(records[0].from).toBe("captain")
    // no interjection kind: it can never be filtered out by the interjection gate again
    expect(records[0].kind).toBeUndefined()
    expect(existsSync(join(stateRoot, TEAM, "inbox"))).toBe(true)
  } finally { cleanup() }
})
