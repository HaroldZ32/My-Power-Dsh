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
// The adopted state module is vendored JavaScript with no declaration file, so its exports arrive
// untyped instead of re-authoring upstream to type them. The specifier list is kept on ONE line
// because the TS7016 diagnostic points at the module specifier, which the directive must precede.
// @ts-expect-error vendored JavaScript has no declaration file
import { INTERJECTION_TTL_MS, enqueueInterjection, expireInterjectionsEverywhere, readInterjections, readUnreadMailbox } from "../lib/state.js"
// The adopted session-start module is vendored JavaScript with no declaration file, for the same reason.
// @ts-expect-error vendored JavaScript has no declaration file
import { installInterjectionExpirySweep, installSessionTeamPolicy } from "../lib/session-start.js"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** Team id the dormant fixture writes its request rows under. */
const TEAM = "dormant-team"
/** Epoch milliseconds far enough in the past that the TTL is already exceeded. */
const PAST_DUE_TS = 1_000_000

/** One registration the stub ctx collected: the event name and the handler the installer passed. */
type RegisteredListener = {
  /** Event the listener subscribed to (`agent/pre-step` holds the dormancy sweep). */
  readonly name: string
  /** The listener body, invoked exactly as the harness waterfall invokes it. */
  readonly handler: (payload: { agent: { id: string; session: { header: { cwd: string } } } }, next: () => Promise<{ kind: string }>) => Promise<unknown>
}

/** One recorded request row, naming only the fields these arms assert on. */
type InterjectionRow = {
  /** Request id the expiry notice and the assertions are keyed by. */
  readonly id: string
  /** Lifecycle status: `pending` until the sweep expires it. */
  readonly status?: string
}

/** One mailbox row, naming only the fields these arms assert on. */
type MailboxRecord = {
  /** Row kind; the expiry notice must leave this unset so it stays an ordinary record. */
  readonly kind?: string
  /** Notice body, which must explain the default-deny outcome. */
  readonly content?: string
  /** Display name of the session the notice was written for. */
  readonly from?: string
}

/** One workspace plus the state root the fixture team record lives under. */
function fixture(): {
  /** Absolute workspace every stub session reports as its cwd. */
  workspace: string
  /** The `<workspace>/.mpd/team` root the request rows are written into. */
  stateRoot: string
  /** Removes the temporary workspace tree. */
  cleanup: () => void
} {
  /** Temporary workspace every stub session reports as its cwd. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t53-"))
  /** The state root under that workspace, where the dormant team's rows live. */
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  return { workspace, stateRoot, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/** A request enqueued long enough ago that its TTL is already past. */
async function seedPastDueRequest(stateRoot: string, over: Record<string, unknown> = {}): Promise<unknown> {
  return enqueueInterjection(stateRoot, TEAM, {
    id: "ij-dormant", from: "Senior Engineer", content: "please unblock me",
    ts: PAST_DUE_TS, summary: "blocked", reason: "gate is red", location: "t53",
    ...over,
  })
}

/** A second past-due request, to distinguish "swept once" from "swept again". */
async function seedSecondPastDue(stateRoot: string): Promise<unknown> {
  return enqueueInterjection(stateRoot, TEAM, {
    id: "ij-second", from: "Junior Engineer", content: "second request",
    ts: PAST_DUE_TS, summary: "second", reason: "still blocked", location: "t53",
  })
}

test("R1 DORMANT: a past-due request is expired and its requester TOLD without any scheduler kick", async () => {
  // The fixture's state root and temp-dir remover.
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    // nothing kicks this team: the ONLY thing that runs is the session-start sweep
    /** The sweep's tally: which rows expired, under which team ids. */
    const swept = await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS + 1 })
    expect(swept.expired).toEqual(["ij-dormant"])
    expect(swept.teamIds).toEqual([TEAM])
    // the row is resolved (silence = DENY), not left pending
    /** The request lane after the sweep: the row must now read expired. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, TEAM)
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe("expired")
    // and the requester is actually told, through the ordinary (non-interjection) lane
    /** The requester's unread mailbox: exactly the expiry notice, as an ordinary record. */
    const inbox: MailboxRecord[] = await readUnreadMailbox(stateRoot, TEAM, "Senior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("EXPIRED")
    expect(inbox[0].content).toContain("denied by default")
  } finally { cleanup() }
})

test("R1 DORMANT NEGATIVE CONTROL: a request still inside its TTL is left ALONE", async () => {
  // The fixture's state root and temp-dir remover.
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    // one millisecond BEFORE the deadline
    /** The sweep's tally at the deadline minus one: nothing may be expired. */
    const swept = await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS - 1 })
    expect(swept.expired).toEqual([])
    expect(swept.teamIds).toEqual([])
    /** The request lane: the row must still be pending inside its TTL. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("pending")
    expect((await readUnreadMailbox(stateRoot, TEAM, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("R1 DORMANT NEGATIVE CONTROL: an empty/absent state root is a no-op, never a throw", async () => {
  // The fixture's state root and temp-dir remover.
  const { stateRoot, cleanup } = fixture()
  try {
    // a root with no team directories at all
    /** The tally for a root that holds no teams: empty on both fields. */
    const empty = await expireInterjectionsEverywhere(stateRoot)
    expect(empty).toEqual({ teamIds: [], expired: [] })
    // a root that does not exist yet
    /** The tally for a root that does not exist: empty, and never a throw. */
    const missing = await expireInterjectionsEverywhere(join(stateRoot, "does-not-exist"))
    expect(missing).toEqual({ teamIds: [], expired: [] })
  } finally { cleanup() }
})

test("R1 DORMANT: the sweep is ONCE PER SESSION, not once per step", async () => {
  // The fixture's workspace, state root and temp-dir remover.
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    /** Registrations the stub ctx collected; the sweep registers exactly one pre-step hook. */
    const listeners: RegisteredListener[] = []
    /** Every info line the sweep logged, counted to prove the second step was a no-op. */
    const logs: string[] = []
    /** The stub ctx the sweep is installed on: one registration seam and one logger. */
    const ctx = {
      on: (name: string, handler: RegisteredListener["handler"]) => listeners.push({ name, handler }),
      logger: { info: (message: unknown) => logs.push(String(message)), warn: () => {}, error: () => {}, debug: () => {} },
    }
    installInterjectionExpirySweep(ctx, { stateDir: STATE_DIR })
    /** The first session's pre-step payload, whose cwd roots the sweep. */
    const payload = { agent: { id: "t53-once", session: { header: { cwd: workspace } } } }
    await listeners[0].handler(payload, async () => ({ kind: "accept" }))
    expect((await readInterjections(stateRoot, TEAM))[0].status).toBe("expired")
    /** The log length after the first step, which the second step must not change. */
    const logCountAfterFirst = logs.length
    // `agent/pre-step` fires on EVERY step. The guard must make the second one a no-op, so
    // the boundary statement ("expiry is evaluated at ... a session start") is true of the
    // code and not only of the comment.
    await seedSecondPastDue(stateRoot)
    await listeners[0].handler(payload, async () => ({ kind: "accept" }))
    /** Both request rows after the second step: the new one must NOT have been swept. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, TEAM)
    expect(rows.find((row) => row.id === "ij-second")?.status).toBe("pending") // NOT swept
    expect(logs.length).toBe(logCountAfterFirst)
    // a DIFFERENT session still gets its own sweep — the guard is per agent, not global
    await listeners[0].handler({ agent: { id: "t53-other", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect((await readInterjections(stateRoot, TEAM)).find((row: InterjectionRow) => row.id === "ij-second")?.status).toBe("expired")
  } finally { cleanup() }
})

test("R1 DORMANT: the SHIPPED session-start hook runs the sweep (and only the session's own workspace)", async () => {
  // The fixture's workspace, state root and temp-dir remover.
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    /** Registrations the stub ctx collected; the policy installer must add none of them. */
    const listeners: RegisteredListener[] = []
    /** Every info line the sweep logged, which must name the expired request. */
    const logs: string[] = []
    /** The stub ctx the policy installer and the sweep are both installed on. */
    const ctx = {
      on: (name: string, handler: RegisteredListener["handler"]) => listeners.push({ name, handler }),
      logger: { info: (message: unknown) => logs.push(String(message)), warn: () => {}, error: () => {}, debug: () => {} },
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
    /** The decision the hook returned, which must be the one the harness passed in. */
    const decision = await listeners[0].handler({ agent: { id: "t53-ok", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect(decision).toEqual({ kind: "accept" }) // the hook never replaces the decision
    /** The request lane after the shipped hook ran: the row must read expired. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, TEAM)
    expect(rows[0].status).toBe("expired")
    expect(logs.join("\n")).toContain("ij-dormant")
  } finally { cleanup() }
})

test("R1 DORMANT: a failing sweep degrades to a warning and still returns the decision", async () => {
  // The fixture's workspace, state root and temp-dir remover.
  const { workspace, stateRoot, cleanup } = fixture()
  try {
    /** Every warning the sweep logged; the degraded path must log exactly one. */
    const warnings: string[] = []
    /** The stub ctx, whose single registration is captured as `handler` for the drive below. */
    const ctx: {
      /** Captures the one registration the installer makes. */
      on: (name: string, handler: RegisteredListener["handler"]) => void
      /** Captures the installer's warning line. */
      logger: { info: () => void; warn: (message: unknown) => void; error: () => void; debug: () => void }
      /** The registration the installer made; absent until the installer runs. */
      handler?: RegisteredListener["handler"]
    } = {
      on: (name: string, handler: RegisteredListener["handler"]) => { ctx.handler = handler },
      logger: { info: () => {}, warn: (message: unknown) => warnings.push(String(message)), error: () => {}, debug: () => {} },
    }
    // make the state root a REGULAR FILE, so readdir throws ENOTDIR — a real failure
    // the sweep must degrade rather than propagate.
    //
    // The file must be the state root ITSELF, not a component of its path: only
    // "readdir(<file>)" answers ENOTDIR at both platforms. A path THROUGH a file
    // answers ENOTDIR on POSIX but ENOENT on Windows (measured: Node maps
    // ERROR_PATH_NOT_FOUND to ENOENT there), and ENOENT is the one code the sweep
    // deliberately reads as "no state root yet" — so the transient-path shape would
    // assert nothing on a Windows host.
    writeFileSync(join(workspace, "blocker"), "not a directory")
    installInterjectionExpirySweep(ctx, { stateDir: "blocker" })
    /** The decision the degraded hook returned, which must still be the harness's own. */
    const decision = await ctx.handler!({ agent: { id: "t53-failing", session: { header: { cwd: workspace } } } }, async () => ({ kind: "accept" }))
    expect(decision).toEqual({ kind: "accept" })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("session-start interjection sweep failed")
    // the pre-existing team state is untouched by the failed sweep
    expect((await readInterjections(stateRoot, TEAM)).length).toBe(0)
  } finally { cleanup() }
})

test("R1 DORMANT: room left for the durable side effect — the notice is an ordinary record", async () => {
  // The fixture's state root and temp-dir remover.
  const { stateRoot, cleanup } = fixture()
  try {
    await seedPastDueRequest(stateRoot)
    await expireInterjectionsEverywhere(stateRoot, { now: PAST_DUE_TS + INTERJECTION_TTL_MS + 1 })
    /** The requester's inbox file, read as raw JSONL so the durable bytes are asserted. */
    const raw = readFileSync(join(stateRoot, TEAM, "inbox", "senior-engineer.jsonl"), "utf8")
    /** The persisted rows, parsed one per line; the notice must be the only one. */
    const records = raw.trim().split("\n").map((line) => JSON.parse(line))
    expect(records.length).toBe(1)
    expect(records[0].id).toBe("interjection-expired-ij-dormant")
    expect(records[0].from).toBe("captain")
    // no interjection kind: it can never be filtered out by the interjection gate again
    expect(records[0].kind).toBeUndefined()
    expect(existsSync(join(stateRoot, TEAM, "inbox"))).toBe(true)
  } finally { cleanup() }
})
