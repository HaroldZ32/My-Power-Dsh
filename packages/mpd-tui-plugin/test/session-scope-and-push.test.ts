// PART D (the reported defect) and PART P (the push), measured on the two surfaces that can be MOUNTED
// in-process: the sidebar DAG page and the merged full-screen scene.
//
// THE DEFECT, VERBATIM: 「我new了一个session，老session的DAG图还摆在那儿」 — a NEW session still drew the
// OLD session's DAG. Its cause was a SELECTION rule, not a renderer: every surface asked for "the newest
// not-ended team of the WORKSPACE" (`principalRecord`), which is session-blind, and the session id that
// was already reachable on all three surfaces was never used for team selection.
//
// HOW THE DEFECT IS REPRODUCED. The pre-fix wiring is not a copy of old code: it is the SAME page, the
// SAME fixtures and the SAME `mpdTeams` double, wired with a reader that IGNORES the session id it is
// handed — exactly what `readWorkflow: () => readDashboardWorkflow(workspaceRoot, …)` did. The post-fix
// arm differs in ONE thing, the reader forwarding that id, so the two frames isolate the repair.
//
// THE HARNESS IS THE INSTALLED HOST. React, the themed `Box`/`Text` and the ink root are imported from
// the real `@deepseek-harness-tui/dsh-tui` package on this machine, so the frames below are frames a
// user would see, not a flattening this file invented. An absent host THROWS rather than skipping: a
// skip on the clause this file exists for would be a vacuous pass.
//
// THE FEED IS A TEST DOUBLE, deliberately: `packages/mpd-team-core-plugin` is another lane's package and
// this arm must not depend on its landing order. The double implements the interface FROZEN in
// `.mpd/plans/lane-s-change-feed.md` §3.1 — `subscribe(workspace, listener) => disposer` — including the
// disposal counter and the workspace it was asked for, which is what the lifetime arms assert.
import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { createDagPanelComponent } from "../src/panel-dag"
import { createSubagentSceneComponent } from "../src/subagent-scene"
import {
  NO_SESSION_TEAM_MARKER,
  principalRecord,
  readScopedWorkflow,
  teamWorkflowLines,
  WORKSPACE_SCOPE_MARKER,
  type MpdTeamsLike,
  type TeamFeedAccessor,
  type TeamFeedSubscribe,
} from "../src/team-state"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"

/** The frozen instant every fixture in this file is stamped with, so no arm depends on the clock. */
const NOW = "2026-10-08T08:00:00.000Z"

/** The workspace every arm scopes to. Never a real path: nothing here touches the filesystem. */
const WORKSPACE = "/tmp/mpd-session-scope"

/**
 * One mpd team record bound to ONE session.
 * @param sessionId - the Lead session this team belongs to.
 * @param teamId - the record's own id.
 * @param name - the team's display name, which is what a frame is searched for.
 * @param subject - the single task's subject, so a drawing has something to lay out.
 * @returns the record.
 */
function record(sessionId: string, teamId: string, name: string, subject: string): TeamRecord {
  return {
    version: 1,
    teamId,
    name,
    description: `board for ${sessionId}`,
    leadSessionId: sessionId,
    phase: "active",
    createdAt: NOW,
    approvedAt: NOW,
    members: [{ id: "M1", name: "Senior Engineer", description: "implements", role: "Senior Engineer", status: "running", spawnedAt: NOW }],
    tasks: [{ id: "T1", subject, description: subject, kind: "work", status: "in_progress", blockedBy: [], writeScopes: [], owner: "Senior Engineer", createdAt: NOW, updatedAt: NOW, revision: 1 }],
    nextMemberNumber: 2,
    nextTaskNumber: 2,
  }
}

/** The `mpdTeams` double: the frozen read face plus the frozen feed, with the counters the arms read. */
interface TeamsDouble {
  /** The service object a surface would be handed. */
  service: MpdTeamsLike
  /** How many times `subscribe` was CALLED (one per mounted, armed surface). */
  subscribeCalls: number
  /** How many times a returned disposer RAN — the lifetime assertion. */
  disposals: number
  /** The workspace the last `subscribe` was asked for, so per-call resolution is assertable. */
  lastSubscribeWorkspace?: string
  /** The workspace the last `active` was asked for. */
  lastActiveWorkspace?: string
  /**
   * Deliver one change notification to every live listener.
   *
   * The real service debounces and fires ASYNCHRONOUSLY; an arm that wants a deterministic order calls
   * this itself and awaits its own settle, which is exactly what the contract lets a listener assume.
   */
  notify(): void
}

/**
 * Build the team-service double over a MUTABLE record list.
 * @param records - a getter for the records `list`/`active` answer with, so an arm can change the board
 *   and observe a surface re-read it.
 * @returns the double.
 */
function teamsDouble(records: () => readonly TeamRecord[]): TeamsDouble {
  /** The live listeners, in subscribe order. */
  const listeners: Array<() => void> = []
  /** The double under construction; its counters are mutated by the members below. */
  const double: TeamsDouble = {
    service: {},
    subscribeCalls: 0,
    disposals: 0,
    /** Deliver one notification to every live listener; see {@link TeamsDouble.notify}. */
    notify(): void {
      // A copy, so a listener that unsubscribes during the walk cannot skip its neighbour.
      for (const listener of [...listeners]) listener()
    },
  }
  double.service = {
    list: () => [...records()],
    active: (workspace: string, sessionId?: string) => {
      double.lastActiveWorkspace = workspace
      return records().find((candidate) => candidate.leadSessionId === sessionId)
    },
    subscribe: (workspace: string, listener: () => void) => {
      double.subscribeCalls += 1
      double.lastSubscribeWorkspace = workspace
      listeners.push(listener)
      /** The idempotent disposer the contract requires. */
      let disposed = false
      return (): void => {
        if (disposed) return
        disposed = true
        double.disposals += 1
        /** Where this listener sits, or -1 when it was already removed. */
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
  return double
}

/**
 * A reader wired the way a surface is wired, over a mutable record list and session id.
 *
 * `scoped: false` is the PRE-FIX wiring reproduced faithfully: the reader is handed a session id and
 * DROPS it, which is precisely what `() => readDashboardWorkflow(workspaceRoot, …)` did. `scoped: true`
 * forwards it, which is the repair.
 * @param teams - the service double.
 * @param records - the mutable record list.
 * @param scoped - whether the reader uses the session id it is handed.
 * @returns the reader a page or scene is built with.
 */
function reader(teams: TeamsDouble, records: () => readonly TeamRecord[], scoped: boolean): (sessionId?: string) => ReturnType<typeof readScopedWorkflow> {
  return (sessionId?: string) =>
    readScopedWorkflow({
      workspace: WORKSPACE,
      ...(scoped && sessionId !== undefined && sessionId !== "" ? { sessionId } : {}),
      holds: [],
      teams: teams.service,
      records: records(),
      views: [],
    })
}

// ── THE MOUNTED HOST ────────────────────────────────────────────────────────

/**
 * The installed DSH-TUI package root, resolved from the launcher on `PATH`.
 * @returns the host package's absolute root directory.
 */
function hostRoot(): string {
  /** The launcher's path on `PATH`, or null when the host is not installed at all. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: the mounted arms need the real host")
  /** The launcher's real path, with the package manager's symlink resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  return dirname(dirname(real))
}

/** The installed host package root, read once for every arm below. */
const HOST = hostRoot()

/** The host's React, whose hooks and `createElement` a surface receives as its kit. */
const hostReact = createRequire(join(HOST, "lib", "types", "ui.js"))("react") as Record<string, unknown> & {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}

/** The host's own rendering surface: the themed components a surface draws with. */
const hostUi = (await import(join(HOST, "lib", "types", "ui.js"))) as { Box: unknown; Text: unknown; ThemeProvider: unknown }

/** The host's ink root, whose `createRoot` accepts a managed stdout — the same call the host makes. */
const hostInk = (await import(join(HOST, "lib", "types", "ink", "root.js"))) as {
  createRoot(options: Record<string, unknown>): Promise<{ render(node: unknown): unknown; unmount(): void }>
}

/** A stdout double: a TTY-shaped stream that keeps every chunk the renderer wrote, in order. */
class InkStdout extends EventEmitter {
  /** The columns this fake terminal reports. */
  columns: number
  /** The rows this fake terminal reports. */
  rows: number
  /** Every chunk written so far, one entry per renderer write. */
  chunks: string[] = []
  /**
   * Build the fake terminal at one geometry.
   * @param columns - the width the renderer lays out for.
   * @param rows - the height the renderer lays out for.
   */
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  /**
   * Accept a renderer write and keep it.
   * @param chunk - what the renderer wrote.
   * @returns true, as a stream write reports.
   */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
}

/** Strip hyperlink and SGR escapes from one chunk, leaving its text. */
function stripEscapes(value: string): string {
  return value.replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
}

/** The terminal geometry the mounted arms use: wide enough that a marker row cannot be wrapped. */
const COLUMNS = 100

/** The rows the fake terminal reports: past the page's content, so scrolling cannot hide a row. */
const ROWS = 120

/** A mounted surface: the frame it last wrote, and the drives the arms need. */
interface Mounted {
  /** The frame as the renderer last wrote it, as one string. */
  text(): string
  /** Let the renderer commit; 120 ms is far past it at this fixture size. */
  settle(): Promise<void>
  /** Tear the surface down, so the effect cleanup — and the disposer — runs. */
  unmount(): void
}

/**
 * Mount one surface component with the INSTALLED host's React and ink.
 *
 * The component is mounted AS A COMPONENT: it is handed to the host's React, never invoked directly,
 * because a component called as a plain function runs its hooks outside a render and React refuses it.
 * @param component - the component a factory already built.
 * @param props - the props the surface's own contract needs, merged over the panel defaults.
 * @returns the mounted surface.
 */
async function mount(component: unknown, props: Record<string, unknown> = {}): Promise<Mounted> {
  /** The host kit the surface receives, with `createElement` forwarded to the host's own React. */
  const kitReact: Record<string, unknown> = { ...hostReact }
  /** The fake terminal the renderer writes into. */
  const stdout = new InkStdout(COLUMNS, ROWS)
  /** The host's own root over it. */
  const root = await hostInk.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
  /** The host's measured geometry, reported exactly as the host reports it to a surface. */
  const ui = { Box: hostUi.Box, Text: hostUi.Text, useTerminalSize: () => ({ columns: COLUMNS, rows: ROWS }) }
  /** The frame the renderer last wrote, as text. */
  const text = (): string => stripEscapes(stdout.chunks.length === 0 ? "" : (stdout.chunks[stdout.chunks.length - 1] ?? ""))
  /** Let the renderer commit. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  await root.render(hostReact.createElement(hostUi.ThemeProvider, null, hostReact.createElement(component as never, {
    React: kitReact,
    ui,
    focused: true,
    visible: true,
    host: { snapshot: () => ({ subagents: [] }), onKey: () => () => {}, notify: () => {}, clearBadge: () => {} },
    ...props,
  } as never)))
  await settle()
  return { text, settle, unmount: () => root.unmount() }
}

/**
 * The accessor a surface is handed, resolved the way `index.ts`'s `teamFeed` resolves it.
 *
 * The SERVICE's member takes `(workspace, listener)` and a SURFACE's subscribe takes `(listener)`, so
 * the workspace is bound here — at subscribe time, per call, which is the §6 rule. Passing the service
 * member straight through would put the listener in the workspace position, which is what an early
 * draft of this file did and what the `lastSubscribeWorkspace` assertion caught.
 * @param teams - the teams double.
 * @returns the accessor.
 */
function feedAccessor(teams: TeamsDouble): TeamFeedAccessor {
  /** The subscribe function, minted ONCE and handed out unchanged: a fresh closure per render would */
  /** make `useTeamFeed`'s effect dependency move every frame and re-subscribe on every render. */
  const subscribe = (listener: () => void): (() => void) => teams.service.subscribe?.(WORKSPACE, listener) ?? ((): void => {})
  return () => subscribe
}

/**
 * The panel's host API, whose snapshot carries the CALLING session's id — the field the defect threw
 * away. It reads a mutable cell so an arm can change the session under a mounted page.
 * @param session - a getter for the session id this host reports.
 * @returns the host API a panel receives.
 */
function panelHost(session: () => string | undefined): Record<string, unknown> {
  return {
    snapshot: () => {
      /** The session id as the host would publish it, or nothing when this host has none. */
      const id = session()
      return { subagents: [], ...(id === undefined ? {} : { sessionId: id }) }
    },
    focused: true,
    visible: true,
    onKey: () => () => {},
    notify: () => {},
    clearBadge: () => {},
  }
}

// ── T-D1/T-D2: THE SELECTION RULE, AS A UNIT ────────────────────────────────

describe("PART D · the team a surface draws is THIS session's", () => {
  test("T-D1 REPRODUCTION (pre-fix rule): with A's record on disk, B's ask received A's team", () => {
    /** Session A's board — the older, still-open team. */
    const a = record("sess-A", "team-a", "wave-a", "A's integration task")
    /** Session B's board does NOT exist; B is the session the user just created. */
    const records = [a]
    // THE PRE-FIX SELECTION, still reachable and still exported: "newest that has not ended". It has no
    // session argument at all, which is the whole defect — B cannot be told apart from A here.
    expect(principalRecord(records)?.teamId).toBe("team-a")
    // And that is what the surface drew, for ANY asking session.
  })

  test("T-D2a session id readable + no record of its own: the marked EMPTY state, never A's DAG", () => {
    /** The teams double over session A's board only. */
    const teams = teamsDouble(() => [record("sess-A", "team-a", "wave-a", "A's integration task")])
    /** Session B's projection, through the repaired reader. */
    const workflow = reader(teams, () => [record("sess-A", "team-a", "wave-a", "A's integration task")], true)("sess-B")
    expect(workflow.team).toBeUndefined()
    expect(workflow.source?.scope).toBe("none")
    expect(workflow.source?.sessionId).toBe("sess-B")
    // The informational count is allowed by the contract, and it is NOT used to select a team.
    expect(workflow.source?.workspaceTeams).toBe(1)
    /** The scene body, which is where the marker must be VISIBLE. */
    const lines = teamWorkflowLines(workflow).join("\n")
    expect(lines).toContain(NO_SESSION_TEAM_MARKER)
    expect(lines).not.toContain("wave-a")
    // The service was asked for THIS session's team, with the CALLING workspace.
    expect(teams.lastActiveWorkspace).toBe(WORKSPACE)
    expect(teams.service.active?.(WORKSPACE, "sess-B")).toBeUndefined()
  })

  test("T-D2b session id readable + its OWN record: that record is drawn, session-scoped", () => {
    /** Two live boards, one per session. */
    const records = [record("sess-A", "team-a", "wave-a", "A's task"), record("sess-B", "team-b", "wave-b", "B's task")]
    /** The teams double over both. */
    const teams = teamsDouble(() => records)
    /** Session A's projection. */
    const a = reader(teams, () => records, true)("sess-A")
    /** Session B's projection. */
    const b = reader(teams, () => records, true)("sess-B")
    expect(a.team?.id).toBe("team-a")
    expect(b.team?.id).toBe("team-b")
    expect(a.source?.scope).toBe("session")
    expect(b.source?.scope).toBe("session")
    expect(teamWorkflowLines(b).join("\n")).toContain("wave-b")
    expect(teamWorkflowLines(b).join("\n")).not.toContain("wave-a")
  })

  test("T-D2c NO session id readable: today's rule survives, MARKED workspace-level", () => {
    /** A live board owned by some other session. */
    const records = [record("sess-A", "team-a", "wave-a", "A's task")]
    /** The teams double over it. */
    const teams = teamsDouble(() => records)
    /** The projection a session-less surface produces. */
    const workflow = reader(teams, () => records, true)(undefined)
    expect(workflow.team?.id).toBe("team-a")
    expect(workflow.source?.scope).toBe("workspace")
    // THE MARKER IS THE POINT: the drawing is visible, and so is the fact that it is not this
    // session's board. A silent fallback is exactly what the clause forbids.
    expect(teamWorkflowLines(workflow).join("\n")).toContain(WORKSPACE_SCOPE_MARKER)
  })

  test("T-D2d the durable scan cannot leak either: no `active` member, no other session's board", () => {
    /** Two live boards. */
    const records = [record("sess-A", "team-a", "wave-a", "A's task"), record("sess-B", "team-b", "wave-b", "B's task")]
    /** A service face WITHOUT `active`, which is the half a narrower composition exposes. */
    const narrow: MpdTeamsLike = { list: () => [...records] }
    /** Session A's projection through the durable scan. */
    const a = readScopedWorkflow({ workspace: WORKSPACE, sessionId: "sess-A", holds: [], teams: narrow, records, views: [] })
    /** An unknown session's projection through the same scan. */
    const stranger = readScopedWorkflow({ workspace: WORKSPACE, sessionId: "sess-nobody", holds: [], teams: narrow, records, views: [] })
    expect(a.team?.id).toBe("team-a")
    expect(a.source?.scope).toBe("session")
    // THE HALF THAT MATTERS: a session with no record gets the empty marker, NOT the newest board.
    expect(stranger.team).toBeUndefined()
    expect(stranger.source?.scope).toBe("none")
    expect(teamWorkflowLines(stranger).join("\n")).not.toContain("wave-b")
  })
})

// ── T-D1/T-D2 ON A MOUNTED INSTANCE ─────────────────────────────────────────

describe("PART D · the mounted sidebar page", () => {
  test("T-D1 REPRODUCTION: a mounted page wired with the pre-fix reader draws A's DAG for session B", async () => {
    /** Session A's board, which session B must never be shown. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task")]
    /** The teams double over it. */
    const teams = teamsDouble(() => records)
    /** The page, wired EXACTLY as the defect did: the reader is handed no session. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, false)), { host: panelHost(() => "sess-B") })
    /** The mounted frame. */
    const text = page.text()
    expect(text).toContain("wave-a")
    expect(text).not.toContain(NO_SESSION_TEAM_MARKER)
    page.unmount()
  })

  test("T-D2 the SAME mount, repaired: B gets the empty marker and never A's drawing", async () => {
    /** Session A's board. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task")]
    /** The teams double over it. */
    const teams = teamsDouble(() => records)
    /** The page, wired as the repair does: the reader forwards the page's own session id. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true)), { host: panelHost(() => "sess-B") })
    /** The mounted frame. */
    const text = page.text()
    expect(text).toContain(NO_SESSION_TEAM_MARKER)
    // INVERTED ON PURPOSE (the blind verifier's orthogonality finding, fixed in the FOCUS lane): this
    // arm used to assert `WORKSPACE_SCOPE_MARKER` HERE, because the informational count row was
    // prefixed with it — which made `workspace-level` match state 2 AND state 3 and left the three
    // states NOT machine-distinguishable. The token now names the no-session-id state ALONE, so state
    // 2 must NOT carry it; `no team in this session` is state 2's unique marker.
    expect(text).not.toContain(WORKSPACE_SCOPE_MARKER)
    expect(text).not.toContain("wave-a")
    // The count is informational, and it is on screen.
    expect(text).toContain("1 team(s)")
    page.unmount()
  })

  test("T-D2 a session WITH a record still gets ITS OWN drawing, on the mounted page", async () => {
    /** Two live boards. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task"), record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double over both. */
    const teams = teamsDouble(() => records)
    /** The page asked for by session B. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true)), { host: panelHost(() => "sess-B") })
    /** The mounted frame. */
    const text = page.text()
    expect(text).toContain("wave-b")
    expect(text).not.toContain("wave-a")
    expect(text).not.toContain(NO_SESSION_TEAM_MARKER)
    // The session-scoped drawing carries NO workspace marker: it IS this session's board.
    expect(text).not.toContain(WORKSPACE_SCOPE_MARKER)
    page.unmount()
  })

  test("a team of THIS session with an EMPTY board is not reported as 'no team in this workspace'", async () => {
    /** Session B's own record, resolved for B — with a board that has no tasks yet. */
    const own = record("sess-B", "team-b", "wave-b", "unused")
    /** The same record, emptied: the team exists and its board does not. */
    const empty = { ...own, tasks: [] }
    /** The teams double over it. */
    const teams = teamsDouble(() => [empty])
    /** The page asked for by session B. */
    const page = await mount(createDagPanelComponent(reader(teams, () => [empty], true)), { host: panelHost(() => "sess-B") })
    /** The mounted frame. */
    const text = page.text()
    // THE RECORD RESOLVED, so the workspace empty state would be a false statement about what exists.
    expect(text).toContain("this session's team has no tasks yet")
    expect(text).not.toContain("no team in this workspace")
    expect(text).not.toContain(NO_SESSION_TEAM_MARKER)
    page.unmount()
  })

  test("T-D2d an UNAVAILABLE session id gets the MARKED workspace-level fallback", async () => {
    /** Two live boards, neither of them this surface's. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task"), record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double over both. */
    const teams = teamsDouble(() => records)
    /** The page on a host whose snapshot carries NO session id (an older host). */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true)), { host: panelHost(() => undefined) })
    /** The mounted frame. */
    const text = page.text()
    expect(text).toContain(WORKSPACE_SCOPE_MARKER)
    expect(text).toContain("no session id on this surface")
    // Today's rule survives on this arm: the workspace's principal board is drawn — and labelled.
    expect(text).toContain("wave-a")
    page.unmount()
  })
})

// ── T-P1/T-P2: THE PUSH, ON A MOUNTED INSTANCE ──────────────────────────────

describe("PART P · the push re-renders a mounted surface", () => {
  test("T-P1 the listener re-renders with the NEW content, while the timer has not fired", async () => {
    /** The live board, which the arm mutates under the mounted page. */
    let records = [record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double over the mutable list. */
    const teams = teamsDouble(() => records)
    /** The mounted page, with the feed wired the way the composition root wires it. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true), { subscribeTeams: feedAccessor(teams) }), { host: panelHost(() => "sess-B") })
    /** The instant the frame below is about to be read, for the "the tick did not fire" argument. */
    const startedAt = Date.now()
    expect(page.text()).toContain("wave-b")
    // THE BOARD CHANGES UNDER THE OPEN PAGE — the same on-disk change the user makes when a teammate
    // claims or closes a task.
    records = [record("sess-B", "team-b", "wave-b-NEW", "B's NEWLY claimed task")]
    expect(page.text()).toContain("wave-b")
    expect(page.text()).not.toContain("wave-b-NEW")
    // THE PUSH: the service notifies, and the page re-reads WITHOUT a key press and without its tick.
    teams.notify()
    await page.settle()
    /** How long the whole arm took, which is what makes "the tick did not fire" checkable. */
    const elapsedMs = Date.now() - startedAt
    expect(page.text()).toContain("wave-b-NEW")
    expect(page.text()).not.toContain("wave-b  phase")
    // THE FALLBACK TIMER IS STILL THERE: the page's own tick is 1000 ms and this arm finished well
    // inside one period, so the ONLY thing that could have re-read the board is the notification.
    expect(elapsedMs).toBeLessThan(1000)
    // The subscription was armed ONCE, against the CALLING workspace, and not yet disposed.
    expect(teams.subscribeCalls).toBe(1)
    expect(teams.lastSubscribeWorkspace).toBe(WORKSPACE)
    expect(teams.disposals).toBe(0)
    page.unmount()
  })

  test("T-P2a `subscribe` ABSENT: the surface still renders and its 1000 ms tick still refreshes", async () => {
    /** The live board. */
    let records = [record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** A service face with NO feed member at all — the pre-Lane-S composition. */
    const teams = teamsDouble(() => records)
    /** The mounted page, whose accessor answers `undefined` because the face carries no `subscribe`. */
    const accessor: TeamFeedAccessor = (): TeamFeedSubscribe | undefined => undefined
    /** The mounted page, whose feed accessor answers nothing at all. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true), { subscribeTeams: accessor }), { host: panelHost(() => "sess-B") })
    expect(page.text()).toContain("wave-b")
    expect(teams.subscribeCalls).toBe(0)
    // THE FALLBACK IS EXACTLY WHAT IT WAS: no push, and the page's own tick re-reads it.
    records = [record("sess-B", "team-b", "wave-b-ticked", "B's ticked task")]
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(page.text()).toContain("wave-b-ticked")
    page.unmount()
  })

  test("T-P2b `subscribe` THROWS: the surface still renders, and the push is simply lost", async () => {
    /** The live board. */
    const records = [record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double, unused: the accessor throws before it is reached. */
    const teams = teamsDouble(() => records)
    /** An accessor whose subscribe call THROWS — the one degradation the contract names. */
    const throwing: TeamFeedAccessor = (): ((listener: () => void) => () => void) => (): (() => void) => {
      throw new Error("the feed refuses this listener")
    }
    /** The mounted page, whose subscribe call throws on every render. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true), { subscribeTeams: throwing }), { host: panelHost(() => "sess-B") })
    expect(page.text()).toContain("wave-b")
    expect(teams.subscribeCalls).toBe(0)
    page.unmount()
  })

  test("T-P2c UNMOUNT disposes the subscription (the disposer ran, effectively once)", async () => {
    /** The live board. */
    const records = [record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double. */
    const teams = teamsDouble(() => records)
    /** The mounted page. */
    const page = await mount(createDagPanelComponent(reader(teams, () => records, true), { subscribeTeams: feedAccessor(teams) }), { host: panelHost(() => "sess-B") })
    expect(teams.subscribeCalls).toBe(1)
    expect(teams.disposals).toBe(0)
    page.unmount()
    // The effect cleanup runs synchronously with `unmount`; the settle is the renderer's own teardown.
    await page.settle()
    expect(teams.disposals).toBe(1)
    // A notification after disposal reaches NOBODY: the listener was removed, so nothing throws and
    // nothing re-renders.
    teams.notify()
    expect(teams.disposals).toBe(1)
  })
})

// ── THE MERGED FULL-SCREEN SCENE ───────────────────────────────────────────

describe("PART D · the mounted merged scene", () => {
  test("the scene reads ITS OWN session's channel and never another session's board", async () => {
    /** Two live boards. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task"), record("sess-B", "team-b", "wave-b", "B's integration task")]
    /** The teams double over both. */
    const teams = teamsDouble(() => records)
    /** The merged scene, handed the reader the wiring builds and a channel bound to session B. */
    const scene = await mount(
      createSubagentSceneComponent(reader(teams, () => records, true), undefined, () => undefined, feedAccessor(teams)),
      { channel: { sessionId: "sess-B", subagents: [] }, close: () => {} },
    )
    /** The mounted frame. */
    const text = scene.text()
    expect(text).toContain("wave-b")
    expect(text).not.toContain("wave-a")
    expect(teams.lastSubscribeWorkspace).toBe(WORKSPACE)
    scene.unmount()
  })

  test("the merged scene shows the session-empty MARKER when its own session has no team", async () => {
    /** Session A's board only. */
    const records = [record("sess-A", "team-a", "wave-a", "A's integration task")]
    /** The teams double. */
    const teams = teamsDouble(() => records)
    /** The merged scene, whose channel names session B — a session with no team. */
    const scene = await mount(
      createSubagentSceneComponent(reader(teams, () => records, true), undefined, () => undefined),
      { channel: { sessionId: "sess-B", subagents: [] }, close: () => {} },
    )
    /** The mounted frame. */
    const text = scene.text()
    expect(text).toContain(NO_SESSION_TEAM_MARKER)
    expect(text).not.toContain("wave-a")
    scene.unmount()
  })
})
