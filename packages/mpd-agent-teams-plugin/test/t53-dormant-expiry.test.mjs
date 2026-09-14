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
import { installSessionTeamPolicy } from "../lib/session-start.js"

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
    // the policy is DISABLED here on purpose: the sweep must not depend on auto-routing
    installSessionTeamPolicy(ctx, { stateDir: STATE_DIR, sessionTeamPolicy: { mode: "off" } })
    expect(listeners.length).toBe(1)
    expect(listeners[0].name).toBe("agent/pre-step")
    // drive the listener exactly as the harness does, with the session's own cwd
    const decision = await listeners[0].handler({ agent: { session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
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
    installSessionTeamPolicy(ctx, { stateDir: "blocker/team", sessionTeamPolicy: { mode: "off" } })
    const decision = await ctx.handler({ agent: { session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
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
