// CODE RABBIT CR1 (PR #93) — the end-journal CONTAINMENT arm.
//
// WHY IT EXISTS. `endTeam` persists the terminal record with `endTeamRecord` BEFORE it appends the
// `team-ended` journal row. When the append threw, the outer catch answered a FAILED end even though the
// team WAS ended on disk — and a retry answered `changed:false`, so the missing history row could never
// be written. The ending is the event; the journal is its record. A journal failure must be REPORTED on
// the row's diagnostic sink and must not turn a completed ending into a failed one.
//
// The arm drives the REAL `endTeam` body with the row's seams injected (the same `TeamActionDeps` the
// plugin passes), because that is the only way to supply a throwing journal AND observe `deps.log` — the
// tool path's log sink is a file outside the sandbox.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { endTeam, type TeamActionCaller, type TeamActionDeps } from "../src/team-actions"
import { addTeamMember, createTeam, readTeam, writeTeam } from "../src/team-store"

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe("CodeRabbit CR1 — a journal failure never fails a landed ending", () => {
  test("the end is ok/changed:true, the record is ended, the failure is logged, and a retry is a no-op", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-cr1-"))
    sandboxes.push(workspace)
    /** The fixed clock every write is stamped with. */
    const now = new Date("2026-11-03T00:00:00.000Z")
    /** The recorded Lead session. */
    const lead = "sess-lead"
    /** The team minted by the store, so the record under test is a real durable one. */
    const created = createTeam(workspace, { name: "cr1-wave", description: "probe", leadSessionId: lead }, now)
    writeTeam(workspace, addTeamMember(created, { name: "member-1", description: "seat", role: "Senior Engineer" }, now))
    // A DIRECTORY where `journal.jsonl` belongs makes `appendFileSync` throw (EISDIR) — the failure shape
    // a full disk or a read-only mount would produce, without mocking the journal module itself.
    mkdirSync(join(workspace, ".mpd", "team", "journal.jsonl"), { recursive: true })
    /** Every line the row's diagnostic sink received. */
    const logs: string[] = []
    /** The row seams `endTeam` reads, with the journal deliberately broken on disk. */
    const deps: TeamActionDeps = {
      now: () => now,
      executor: (() => ({ kind: "unavailable", reason: "stub" })) as never,
      bundleApprovalEffects: async () => {},
      deriveParentTeam: () => undefined,
      resolveTeam: (ws: string, sessionId: string) => {
        /** The team this session would resolve, read fresh so the retry sees the terminal record. */
        const record = readTeam(ws, created.teamId)
        return record === undefined ? {} : { record }
      },
      readWatchdogHold: () => ({ state: "free" }),
      service: () => undefined,
      log: (line: string) => { logs.push(line) },
      beginDispatch: () => () => {},
      assertPlanGraph: () => {},
      assertScopesOrdered: () => {},
    }
    /** The caller: the recorded Lead, with no ancestry. */
    const caller: TeamActionCaller = { workspace, sessionId: lead, lineage: [] }
    /** The ending whose journal append throws. */
    const first = await endTeam(deps, caller, { reason: "the wave landed" })
    if (!first.ok) throw new Error(`the ending was reported as a failure: ${first.error}`)
    expect(first.changed).toBe(true)
    expect(first.teamId).toBe(created.teamId)
    expect(first.reason).toBe("the wave landed")
    // THE RECORD REALLY IS TERMINAL — the reply is not claiming an ending that did not land.
    expect(readTeam(workspace, created.teamId)?.phase).toBe("ended")
    expect(readTeam(workspace, created.teamId)?.endedAt).toBe(now.toISOString())
    // THE FAILURE IS REPORTED, with the exact contract sentence and the append's own refusal.
    expect(logs.length).toBe(1)
    expect(logs[0]).toContain(`team ${created.teamId} ended but its journal row was not written:`)
    // THE RETRY IS THE REPORTED NO-OP: `changed:false`, the first reason preserved, no second log line.
    /** The repeated ending. */
    const retry = await endTeam(deps, caller, { reason: "a retry with a new story" })
    if (!retry.ok) throw new Error(`the retry was reported as a failure: ${retry.error}`)
    expect(retry.changed).toBe(false)
    expect(retry.reason).toBe("the wave landed")
    expect(retry.endedAt).toBe(first.endedAt)
    expect(logs.length).toBe(1)
  })
})
