// THE TEAM PLANE'S ID SPACE (T1 + T3).
//
// The watchdog's hold is filed per team, and `agent_teams_dispatch` asks about a team by the id the
// MPD TEAM RECORD carries (`team-<stamp>`). The watchdog used to build its universe from the
// OFFICIAL readout alone (`dsh.teamLiveTeams()`), whose `teamId` is the Lead Session id — two id
// spaces, one lookup, so `isHeld(team-<stamp>)` could never find a hold filed under a session id and
// the whole ladder watched zero teams in the DEFAULT (native) composition.
//
// Every arm below therefore makes the two planes DISAGREE: the official readout is registered under
// a session-shaped id while the mpd record carries `team-<stamp>`, so a regression to "read the
// official plane first" reddens instead of passing quietly.
import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { TeamRecord as MpdTeamRecord } from "../../mpd-team-core-plugin/src/team-store"
import { STATUS_TOOL } from "../src/actions"
import { apply } from "../src/index"
import { holdPath } from "../src/paths"
import { listTeamIds, readTeam, readTeams, type MpdTeamsRead } from "../src/team"
import { pluginCtx, sandbox, stubAdapter, writeTeam, type Sandbox } from "./support"

/** The mpd record's own id space: the id `agent_teams_dispatch` asks the watchdog about. */
const MPD_TEAM_ID = "team-20261006120000"
/** The OFFICIAL readout's id space: the Lead Session id, which is deliberately a DIFFERENT string. */
const OFFICIAL_TEAM_ID = "sess-lead-1"

/** One mpd team record, in the shape `mpd-team-core-plugin/src/team-store.ts` persists. */
function mpdRecord(): MpdTeamRecord {
  return {
    version: 1,
    teamId: MPD_TEAM_ID,
    name: "wave-3",
    description: "split the plane",
    leadSessionId: OFFICIAL_TEAM_ID,
    phase: "active",
    createdAt: "2026-10-06T12:00:00.000Z",
    approvedAt: "2026-10-06T12:00:01.000Z",
    members: [
      { id: "M1", name: "Senior Engineer", description: "implements", status: "running", spawnedAt: "2026-10-06T12:00:01.000Z", executorRef: "sess-m1" },
    ],
    tasks: [
      { id: "T1", subject: "core", description: "own the record", kind: "work", status: "pending", blockedBy: [], writeScopes: ["packages/**"], createdAt: "2026-10-06T12:00:01.000Z", updatedAt: "2026-10-06T12:00:02.000Z", revision: 3 },
    ],
    nextMemberNumber: 2,
    nextTaskNumber: 2,
  }
}

/** Persist one mpd record where the real store writes it, so a path read is exercised too. */
function writeMpdRecord(box: Sandbox, record: MpdTeamRecord): void {
  // The real store's directory, so the fixture sits exactly where a shipped record sits.
  const dir = join(box.workspace, ".mpd", "team", "teams")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, record.teamId + ".json"), JSON.stringify(record, null, 2) + "\n")
}

/** The `mpdTeams` service face, answering one record per call (the service is read PER CALL). */
const mpdTeamsWith = (record: MpdTeamRecord | undefined): MpdTeamsRead => ({
  list: () => (record === undefined ? [] : [record]),
})

describe("the watchdog's team universe (T3)", () => {
  test("the ids ARE the mpd record's ids, so the hold the watchdog files is the hold dispatch asks about", () => {
    // THE DEFECT THIS PINS: `readTeams` read ONLY `dsh.teamLiveTeams()`, whose `teamId` is the Lead
    // Session id, while `agent_teams_dispatch` asks `isHeld(record.teamId)` with `team-<stamp>`.
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The mpd record, persisted where the real store writes it. */
      const record = mpdRecord()
      writeMpdRecord(box, record)
      // The OFFICIAL readout is registered too, and it disagrees on purpose.
      writeTeam(box, { id: OFFICIAL_TEAM_ID, captainSessionId: OFFICIAL_TEAM_ID, members: [{ id: "sess-m9", name: "Reviewer", status: "running" }], tasks: [{ id: "x1", status: "pending" }] })
      /** The teams the watchdog watches, read through the mpd plane. */
      const teams = readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, mpdTeamsWith(record))
      expect(teams.map((team) => team.id)).toEqual([MPD_TEAM_ID])
      // The official id is NOT the answer: if it were, the two id spaces would still disagree.
      expect(teams.map((team) => team.id)).not.toContain(OFFICIAL_TEAM_ID)
      // The file the hold LANDS IN is named after the id dispatch will ask about: `safeSegment`
      // must not fold `team-<stamp>` into something else, or the two planes would drift again.
      expect(holdPath(box.workspace, box.stateDir, teams[0].id)).toBe(holdPath(box.workspace, box.stateDir, MPD_TEAM_ID))
    } finally {
      box.cleanup()
    }
  })

  test("the projection carries the roster and the board the fold reads, with the executor's own handles", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The mpd record under test. */
      const record = mpdRecord()
      /** The projected record. */
      const team = readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, mpdTeamsWith(record))[0]
      // The member's identity is the EXECUTOR's handle (the session id the agent registry keys on),
      // not mpd's own short id — the watchdog resolves agents by session.
      expect(team.members).toEqual([{ id: "sess-m1", name: "Senior Engineer", status: "running" }])
      // The board's generation token is the task's own mpd revision, which is what scopes a stamp.
      // `dispatched` is ABSENT for an unowned row, exactly as the official projection leaves it.
      expect(team.tasks).toEqual([
        { id: "T1", status: "pending", attempt: 3, attemptId: "3", dependencies: [] },
      ])
      expect(team.captainSessionId).toBe(OFFICIAL_TEAM_ID)
      expect(team.phase).toBe("active")
    } finally {
      box.cleanup()
    }
  })

  test("a task with an owner is DISPATCHED, and the owner is the assignee", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The mpd record whose single task is owned. */
      const record = mpdRecord()
      record.tasks[0].owner = "Senior Engineer"
      /** The projected record. */
      const team = readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, mpdTeamsWith(record))[0]
      expect(team.tasks[0].assignee).toBe("Senior Engineer")
      expect(team.tasks[0].dispatched).toBe(true)
    } finally {
      box.cleanup()
    }
  })

  test("with NO mpd service the OFFICIAL fold still answers — the fallback is kept", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      writeTeam(box, { id: OFFICIAL_TEAM_ID, captainSessionId: OFFICIAL_TEAM_ID, members: [{ id: "sess-m9", name: "Reviewer", status: "running" }], tasks: [{ id: "x1", status: "pending" }] })
      expect(readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace).map((team) => team.id)).toEqual([OFFICIAL_TEAM_ID])
    } finally {
      box.cleanup()
    }
  })

  test("an mpd service that answers NOTHING falls back, and with NEITHER plane the read degrades to []", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The adapter over a workspace whose official readout carries one team. */
      const adapter = stubAdapter({ workspace: box.workspace }).adapter
      writeTeam(box, { id: OFFICIAL_TEAM_ID, captainSessionId: OFFICIAL_TEAM_ID, members: [{ id: "sess-m9", name: "Reviewer", status: "running" }], tasks: [{ id: "x1", status: "pending" }] })
      // An mpd plane that exists but knows no team must not HIDE the official one.
      expect(readTeams(adapter, box.workspace, mpdTeamsWith(undefined)).map((team) => team.id)).toEqual([OFFICIAL_TEAM_ID])
      // And a workspace with NO fixture on EITHER plane answers nothing at all, never a throw.
      expect(readTeams(stubAdapter({ workspace: join(box.workspace, "empty") }).adapter, join(box.workspace, "empty"), mpdTeamsWith(undefined))).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("an mpd read that THROWS degrades to the official fold instead of taking the tick down", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      writeTeam(box, { id: OFFICIAL_TEAM_ID, captainSessionId: OFFICIAL_TEAM_ID, members: [{ id: "sess-m9", name: "Reviewer", status: "running" }], tasks: [{ id: "x1", status: "pending" }] })
      /** The service face whose read throws, as a half-mounted service would. */
      const broken: MpdTeamsRead = { list: () => { throw new Error("mpdTeams is not ACTIVE yet") } }
      expect(readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, broken).map((team) => team.id)).toEqual([OFFICIAL_TEAM_ID])
    } finally {
      box.cleanup()
    }
  })

  test("a STAGED shell with no roster and no board is not watched", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The mpd record of a team nothing has been spawned into yet. */
      const shell = mpdRecord()
      shell.members = []
      shell.tasks = []
      expect(readTeams(stubAdapter({ workspace: box.workspace }).adapter, box.workspace, mpdTeamsWith(shell))).toEqual([])
    } finally {
      box.cleanup()
    }
  })

  test("readTeam and listTeamIds answer from the SAME universe as readTeams", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The mpd record under test. */
      const record = mpdRecord()
      /** The adapter over the sandbox. */
      const adapter = stubAdapter({ workspace: box.workspace }).adapter
      /** The mpd faces, answering the record. */
      const service = mpdTeamsWith(record)
      expect(listTeamIds(adapter, box.workspace, service)).toEqual([MPD_TEAM_ID])
      expect(readTeam(adapter, box.workspace, MPD_TEAM_ID, service)?.name).toBe("wave-3")
      expect(readTeam(adapter, box.workspace, OFFICIAL_TEAM_ID, service)).toBeUndefined()
    } finally {
      box.cleanup()
    }
  })
})

describe("the applied row reads the MPD plane PER CALL (T3 wiring)", () => {
  // `readTeams` is unit-tested above; these two arms pin the WIRING around it — that the applied row
  // resolves the `mpdTeams` service at CALL time (never at apply) and that the ENGINE, not just the
  // status view, resolves an mpd team from it. Both would read nothing if the service were captured
  // at apply or if the engine still consulted only the official fold.
  test("the status view names the mpd team, and the service mounted AFTER apply is still read", async () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The plugin context whose adapter is the real registration surface. */
      const ctx = pluginCtx(box.workspace)
      /** The apply report; its engine is stopped at the end of the arm. */
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        // MOUNTED AFTER APPLY, on purpose: a service captured during `apply` would answer `[]` here.
        ctx.services.set("mpdTeams", mpdTeamsWith(mpdRecord()))
        /** The status payload, driven through the adapter's own tool runtime. */
        const view = (await ctx.__stub.adapter.toolRuntime().execute({ name: STATUS_TOOL, arguments: {} })) as { teams: Array<{ teamId: string }> }
        expect(view.teams.map((row) => row.teamId)).toEqual([MPD_TEAM_ID])
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the ENGINE resolves a member through the mpd record, so the heartbeat is keyed by the member", () => {
    /** The sandbox workspace, cleaned up even when an assertion fails. */
    const box = sandbox()
    try {
      /** The plugin context whose adapter is the real registration surface. */
      const ctx = pluginCtx(box.workspace)
      /** The apply report; its engine is driven directly below. */
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      try {
        // The service is mounted after apply here too, and the engine's read is per call.
        ctx.services.set("mpdTeams", mpdTeamsWith(mpdRecord()))
        /** The live agent as the harness reports it: the id IS the member's executor handle. */
        const agent = { id: "sess-m1", session: { id: "sess-m1", header: { cwd: box.workspace } } }
        /** The stamp the engine wrote for that member. */
        const stamp = report.engine?.stamp("turn-start", agent)
        // The team resolved to the MPD id, and the member to its NAME — which is only possible when
        // the engine's fold saw the mpd record rather than the (empty) official readout.
        expect(stamp?.teamId).toBe(MPD_TEAM_ID)
        expect(stamp?.member).toBe("Senior Engineer")
        expect(stamp?.memberKey).toBe("Senior Engineer")
      } finally {
        report.engine?.stop()
        ctx.__dispose()
      }
    } finally {
      box.cleanup()
    }
  })
})
