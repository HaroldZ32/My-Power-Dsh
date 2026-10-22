// THE PANEL'S ATTENTION SURFACE (G2 of the stateless-deployment wave, 2026-10-20).
//
// WHY THESE ARMS EXIST. The badge used to be published by the DAG page, and dsh-tui mounts a plugin
// panel only while it is the ACTIVE page of its column — so the old publisher could only decorate a
// page the user was already looking at, and the auto-open had no implementation at all. The surface
// moved to apply, driven by the team feed, and every fact below is one a regression could silently
// undo: the badge reaching a CLOSED panel, the auto-open firing exactly once and only for a team that
// APPEARED, a refusal never becoming a retry loop, and disposal leaving no subscriber behind.
import { describe, expect, test } from "bun:test"

import { armPanelAttention, attentionBadge, panelsSummaryLine, watchdogAttentionBadge, type PanelAttentionDeps } from "../src/panel-attention.js"
import type { PanelBadge } from "../src/panel-core.js"
import type { Log } from "../src/log.js"
import type { TeamWorkflow } from "../src/team-state.js"

/** A silent logger, shaped as the plugin's own (never a terminal). */
function silentLog(): Log {
  return { info: (): void => {}, warn: (): void => {}, debug: (): void => {} }
}

/** The task rows a workflow fixture carries, as the projection would hand them over. */
type TaskVisual = { readonly visual: string }

/**
 * A workflow fixture: the projection members the attention surface reads, and nothing else.
 * @param tasks - the task visuals the badge ladder reads.
 * @param holds - the team-watchdog holds the projection carries.
 * @param teamId - the DISPLAYED team's id, when the fixture has one; a hold only counts against it.
 * @returns the projection, structurally sufficient for the surface under test.
 */
function workflow(tasks: readonly TaskVisual[], holds: readonly string[] = [], teamId?: string): TeamWorkflow {
  /** The minimal projection, cast once at this fixture boundary. */
  const fixture = {
    workspace: "/w",
    tasks: tasks as unknown as TeamWorkflow["tasks"],
    holds,
    team: teamId === undefined ? undefined : { id: teamId },
  }
  return fixture as unknown as TeamWorkflow
}

/**
 * A controllable team feed: the surface under test subscribes once and the arm drives the events.
 * @param options - `noopDisposer` returns an unsubscribe that does nothing (a host that gave none),
 *   which is what makes the surface's own STOPPED latch observable; `unbound` starts the accessor
 *   answering `undefined` (the panel seam bound before `mpdTeams`), and `bind()` flips it.
 * @returns the accessor, the subscription ledger, an event driver and the binding control.
 */
function fakeFeed(options: { readonly noopDisposer?: boolean; readonly unbound?: boolean } = {}): {
  readonly accessor: () => ((listener: () => void) => () => void) | undefined
  readonly events: () => number
  readonly listeners: () => number
  readonly fire: () => void
  readonly bind: () => void
} {
  /** The listeners the surface registered. */
  const listeners = new Set<() => void>()
  /** How many subscriptions were made. */
  let events = 0
  /** Whether the accessor answers (see `unbound`). */
  let bound = options.unbound !== true
  return {
    accessor: (): ((listener: () => void) => () => void) | undefined => {
      if (!bound) return undefined
      return (listener: () => void): (() => void) => {
        events += 1
        listeners.add(listener)
        if (options.noopDisposer === true) return (): void => {}
        return (): void => {
          listeners.delete(listener)
        }
      }
    },
    events: (): number => events,
    listeners: (): number => listeners.size,
    fire: (): void => {
      for (const listener of [...listeners]) listener()
    },
    bind: (): void => {
      bound = true
    },
  }
}

/** The panel routes the surface calls, with every call recorded. */
function fakePanel(): {
  readonly deps: Pick<PanelAttentionDeps, "panelId" | "openPanel" | "badgePanel">
  readonly opens: () => number
  readonly badges: () => PanelBadge[]
  readonly setOpenResult: (value: boolean) => void
  readonly setId: (value: string | undefined) => void
} {
  /** Every badge the surface asked the host to show, in call order. */
  const badges: PanelBadge[] = []
  /** How many open attempts were made. */
  let opens = 0
  /** What the host answers to an open. */
  let openResult = true
  /** The discovered id; undefined models an unbound seam. */
  let id: string | undefined = "act1:team"
  return {
    deps: {
      panelId: (): string | undefined => id,
      openPanel: (): boolean => {
        opens += 1
        return openResult
      },
      badgePanel: (_id: string, badge: PanelBadge | null): boolean => {
        if (badge !== null) badges.push(badge)
        return true
      },
    },
    opens: (): number => opens,
    badges: (): PanelBadge[] => badges,
    setOpenResult: (value: boolean): void => {
      openResult = value
    },
    setId: (value: string | undefined): void => {
      id = value
    },
  }
}

describe("the attention badge ladder", () => {
  test("failed outranks blocked outranks running; no team is no badge", () => {
    expect(attentionBadge(workflow([{ visual: "failed" }, { visual: "blocked" }]))).toEqual({ level: "error", unread: 2 })
    expect(attentionBadge(workflow([{ visual: "blocked" }, { visual: "running" }]))).toEqual({ level: "warning", unread: 1 })
    expect(attentionBadge(workflow([{ visual: "running" }]))).toEqual({ level: "info", unread: 0 })
    expect(attentionBadge(workflow([{ visual: "completed" }]))).toBeNull()
    expect(attentionBadge(undefined)).toBeNull()
  })

  test("a watchdog HOLD on the DISPLAYED team is at least a warning, and it upgrades a quiet running badge", () => {
    expect(attentionBadge(workflow([], ["team-1"], "team-1"))).toEqual({ level: "warning", unread: 1 })
    expect(attentionBadge(workflow([{ visual: "running" }], ["team-1"], "team-1"))).toEqual({ level: "warning", unread: 1 })
    // A failure still outranks a hold: the level ladder is not flattened by the hold clause.
    expect(attentionBadge(workflow([{ visual: "failed" }, { visual: "blocked" }], ["team-1"], "team-1"))?.level).toBe("error")
  })

  test("a FOREIGN team's hold neither warns nor raises the count", () => {
    // The hold ledger is workspace-wide; only the displayed team's id is this panel's business.
    expect(attentionBadge(workflow([], ["team-OTHER"], "team-MINE"))).toBeNull()
    // A quiet running badge is not raised by another team's hold either.
    expect(attentionBadge(workflow([{ visual: "running" }], ["team-OTHER"], "team-MINE"))).toEqual({ level: "info", unread: 0 })
    // Nor does it inflate a badge the board already earned.
    expect(attentionBadge(workflow([{ visual: "failed" }], ["team-OTHER"], "team-MINE"))).toEqual({ level: "error", unread: 1 })
    // With NO displayed team id there is no membership to prove, so no hold is ours.
    expect(attentionBadge(workflow([], ["team-OTHER"]))).toBeNull()
  })

  test("only the DISPLAYED team's holds are counted", () => {
    expect(attentionBadge(workflow([], ["team-MINE"], "team-MINE"))).toEqual({ level: "warning", unread: 1 })
    // A mixed ledger counts this team's holds only, not the workspace total.
    expect(attentionBadge(workflow([], ["team-OTHER", "team-MINE", "team-MINE"], "team-MINE"))).toEqual({ level: "warning", unread: 2 })
  })
})

describe("the apply-side attention surface", () => {
  test("publishes the badge of an EXISTING team at arm, and does NOT auto-open for it", () => {
    /** The team feed (no event is fired in this arm). */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    // THE BADGE ARRIVES EVEN THOUGH NO PAGE IS MOUNTED — the whole point of publishing from apply.
    expect(panel.badges()).toEqual([{ level: "error", unread: 1 }])
    // A team that predates this process is not an APPEARANCE: booting must not steal the sidebar.
    expect(panel.opens()).toBe(0)
    expect(attention.opened()).toBe(false)
    attention.stop()
  })

  test("the FIRST live team on a feed event opens the panel ONCE, and never again", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The workflow the surface will read: empty at arm, a live team after the first event. */
    let current: TeamWorkflow | undefined = workflow([])
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    expect(panel.opens()).toBe(0)
    current = workflow([{ visual: "running" }])
    feed.fire()
    expect(panel.opens()).toBe(1)
    expect(attention.opened()).toBe(true)
    // A SECOND event with more work does not re-open: one per process.
    feed.fire()
    expect(panel.opens()).toBe(1)
    // The badge is still published on the change (an `info` for the running task).
    expect(panel.badges()).toEqual([{ level: "info", unread: 0 }])
    attention.stop()
  })

  test("autoOpen:false keeps the badge and never opens", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "blocked" }]),
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    feed.fire()
    expect(panel.opens()).toBe(0)
    expect(panel.badges()).toEqual([{ level: "warning", unread: 1 }])
    attention.stop()
  })

  test("a REFUSED open latches: one attempt, no retry loop", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes, refusing the open (the host's 5 s rate limit is exactly this answer). */
    const panel = fakePanel()
    panel.setOpenResult(false)
    /** The surface under test. */
    let current: TeamWorkflow | undefined = workflow([])
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    current = workflow([{ visual: "open" }])
    feed.fire()
    feed.fire()
    feed.fire()
    expect(panel.opens()).toBe(1)
    expect(attention.opened()).toBe(true)
    attention.stop()
  })

  test("an UNBOUND seam (no id yet) opens nothing and badges nothing, without throwing", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes with an id the seam has not discovered yet. */
    const panel = fakePanel()
    panel.setId(undefined)
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    feed.fire()
    expect(panel.opens()).toBe(0)
    expect(panel.badges()).toEqual([])
    expect(attention.current()).toBeNull()
    attention.stop()
  })

  test("the badge publishes on a CHANGE only, and clears when the team settles", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The workflow the surface reads, advanced by the arm. */
    let current: TeamWorkflow | undefined = workflow([{ visual: "failed" }])
    /** Every badge the host was asked for, clears included. */
    const cleared: (PanelBadge | null)[] = []
    /** The surface under test; the badge route records clears separately. */
    const attention = armPanelAttention({
      ...panel.deps,
      badgePanel: (_id: string, badge: PanelBadge | null): boolean => {
        cleared.push(badge)
        return true
      },
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    // Arm published the error; a second read of the SAME state publishes nothing.
    expect(cleared).toEqual([{ level: "error", unread: 1 }])
    feed.fire()
    expect(cleared).toHaveLength(1)
    // The board settles: the next change CLEARS the badge.
    current = workflow([{ visual: "completed" }])
    feed.fire()
    expect(cleared).toEqual([{ level: "error", unread: 1 }, null])
    expect(attention.current()).toBeNull()
    attention.stop()
  })

  test("the FIRST observation after arming publishes badgePanel(id, null) exactly once", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** Every badge call the host received, clears included (the helper's `badges` drops nulls). */
    const calls: { id: string; badge: PanelBadge | null }[] = []
    /** The surface under test, armed over a projection with no team and no holds. */
    const attention = armPanelAttention({
      panelId: () => "act1:team",
      openPanel: () => false,
      badgePanel: (id: string, badge: PanelBadge | null): boolean => {
        calls.push({ id, badge })
        return true
      },
      readWorkflow: () => workflow([]),
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    // A null badge IS a publish: it clears a badge a previous binding may have left on the panel.
    expect(calls).toEqual([{ id: "act1:team", badge: null }])
    expect(attention.current()).toBeNull()
    attention.stop()
  })

  test("a second IDENTICAL pass publishes nothing", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** Every badge call, clears included. */
    const calls: (PanelBadge | null)[] = []
    /** The surface under test, armed over a projection with no team. */
    const attention = armPanelAttention({
      panelId: () => "act1:team",
      openPanel: () => false,
      badgePanel: (_id: string, badge: PanelBadge | null): boolean => {
        calls.push(badge)
        return true
      },
      readWorkflow: () => workflow([]),
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    // The arm-time sentinel published the null badge exactly once.
    expect(calls).toEqual([null])
    feed.fire()
    feed.fire()
    // THE SAME STATE twice more: nothing to publish, so nothing is published.
    expect(calls).toEqual([null])
    attention.stop()
  })

  test("a throwing reader is contained: no badge, no open, no throw", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test, over a reader that throws. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: (): TeamWorkflow | undefined => {
        throw new Error("projection unavailable")
      },
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    feed.fire()
    expect(panel.opens()).toBe(0)
    expect(panel.badges()).toEqual([])
    attention.stop()
  })

  test("stop() releases the feed: a late event does nothing", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "running" }]),
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    expect(feed.listeners()).toBe(1)
    attention.stop()
    expect(feed.listeners()).toBe(0)
    // A host that returns no disposer leaves the listener attached; the STOPPED latch is what keeps a
    // late event from opening or badging after disposal.
    feed.fire()
    expect(panel.opens()).toBe(0)
  })

  test("a host with NO badge member is not retried on every event (one absent member, no loop)", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** How many badge attempts the surface made. */
    let attempts = 0
    /** The surface under test, over a host that exposes NO badge member (undefined, not false). */
    const attention = armPanelAttention({
      panelId: () => "act1:team",
      openPanel: () => false,
      badgePanel: (): boolean | undefined => {
        attempts += 1
        return undefined
      },
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    feed.fire()
    feed.fire()
    // An ABSENT member is remembered as a fact that cannot change: no per-event retry.
    expect(attempts).toBe(1)
    attention.stop()
  })

  test("a CALLABLE badge member that REFUSES is retried on the next state change (false ≠ absent)", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** How many badge attempts the surface made. */
    let attempts = 0
    /** What the host answers: a refusal on the first call, acceptance afterwards. */
    let answer: boolean = false
    /** The badges the host finally accepted, in order. */
    const accepted: PanelBadge[] = []
    /** The surface under test. */
    const attention = armPanelAttention({
      panelId: () => "act1:team",
      openPanel: () => false,
      badgePanel: (_id, badge): boolean | undefined => {
        attempts += 1
        if (answer === true && badge !== null) accepted.push(badge)
        return answer
      },
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: feed.accessor,
      autoOpen: false,
      log: silentLog(),
    })
    // The arm-time publish was refused, so the value stayed UNSET (the retry is the point).
    expect(attempts).toBe(1)
    expect(attention.current()).toBeNull()
    answer = true
    feed.fire()
    // The next event retried the SAME badge and this time it landed.
    expect(attempts).toBe(2)
    expect(accepted).toEqual([{ level: "error", unread: 1 }])
    expect(attention.current()).toEqual({ level: "error", unread: 1 })
    attention.stop()
  })

  test("a team present at ARM is not an appearance: a later event does not open the page", () => {
    /** The team feed. */
    const feed = fakeFeed()
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test, armed over an already-live team. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "running" }, { visual: "open" }]),
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    expect(panel.opens()).toBe(0)
    // THE EDGE, NOT THE STATE: a status change on the same team fires a feed event, and the boot-time
    // team must still not open anything.
    feed.fire()
    feed.fire()
    expect(panel.opens()).toBe(0)
    expect(attention.opened()).toBe(false)
    attention.stop()
  })

  test("stop() LATCHES: a host that returned no disposer still cannot act through a late event", () => {
    /** A feed whose unsubscribe does nothing, so the listener outlives `stop()` — the latch's case. */
    const feed = fakeFeed({ noopDisposer: true })
    /** The panel routes. */
    const panel = fakePanel()
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    /** How many badges the arm-time pass already published. */
    const publishedAtArm = panel.badges().length
    expect(publishedAtArm).toBe(1)
    attention.stop()
    // The listener is STILL attached (the host gave no disposer), so this is the stopped latch working,
    // not the unsubscribe.
    expect(feed.listeners()).toBe(1)
    feed.fire()
    expect(panel.badges()).toHaveLength(publishedAtArm)
    expect(panel.opens()).toBe(0)
  })

  test("resubscribe() attaches a feed that bound AFTER the panel seam, then publishes and opens", () => {
    /** A feed that answers nothing at first — the panel seam bound first. */
    const feed = fakeFeed({ unbound: true })
    /** The panel routes. */
    const panel = fakePanel()
    /** The workflow the surface reads: no team until after the rebind. */
    let current: TeamWorkflow | undefined = workflow([])
    /** The surface under test. */
    const attention = armPanelAttention({
      ...panel.deps,
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: true,
      log: silentLog(),
    })
    // Nothing was subscribed: the accessor answered undefined at arm.
    expect(feed.events()).toBe(0)
    // `mpdTeams` binds: the caller re-subscribes, which subscribes and republishes.
    feed.bind()
    current = workflow([{ visual: "failed" }])
    attention.resubscribe()
    expect(feed.events()).toBe(1)
    expect(panel.badges()).toEqual([{ level: "error", unread: 1 }])
    // The auto-open did NOT fire on the re-subscribe's own observation (it is not an event)…
    expect(panel.opens()).toBe(0)
    // …and the next APPEARANCE does.
    current = workflow([])
    feed.fire()
    current = workflow([{ visual: "running" }])
    feed.fire()
    expect(panel.opens()).toBe(1)
    // A second re-subscribe releases the previous subscription instead of double-delivering.
    attention.resubscribe()
    expect(feed.listeners()).toBe(1)
    attention.stop()
  })
})

describe("the /mpd status panel-deployment line (G4)", () => {
  test("names the discovered ids, the seam state and the keeper's read-only verdict", () => {
    expect(panelsSummaryLine({
      teamId: "act1:team",
      workmateId: "act1:workmate",
      seamBound: true,
      keeper: { state: "confirmed", detail: "read-only: the host 0.16.1 owns the enable list (>= 0.16.1), so this keeper writes nothing" },
    })).toBe("panels: team=act1:team workmate=act1:workmate · seam bound · keeper confirmed — read-only: the host 0.16.1 owns the enable list (>= 0.16.1), so this keeper writes nothing")
  })

  test("an unregistered page and an absent seam are SAID, never omitted", () => {
    /** The line for a host with no panel seam and no discovered ids. */
    const line = panelsSummaryLine({
      teamId: undefined,
      workmateId: undefined,
      seamBound: false,
      keeper: { state: "absent", detail: "the host exposes no side-panel enable store" },
    })
    expect(line).toContain("team=unregistered")
    expect(line).toContain("workmate=unregistered")
    expect(line).toContain("no panel seam")
    expect(line).toContain("keeper absent")
    // One line, always: a status print must not grow a second row by accident.
    expect(line).not.toContain("\n")
  })
})

describe("the process-wide auto-open latch (a panel-seam re-bind)", () => {
  test("a RE-BOUND surface cannot open the page a second time in the same process", () => {
    /** One latch stands in for the `apply`-scoped one the plugin passes to every surface. */
    const latch = { spent: false }
    /** The feed. */
    const feed = fakeFeed()
    /** The first surface's panel routes. */
    const first = fakePanel()
    /** What the first surface reads: no team yet. */
    let current: TeamWorkflow | undefined = workflow([])
    /** The first binding. */
    const before = armPanelAttention({
      ...first.deps,
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: true,
      autoOpenLatch: latch,
      log: silentLog(),
    })
    current = workflow([{ visual: "running" }])
    feed.fire()
    expect(first.opens()).toBe(1)
    expect(latch.spent).toBe(true)
    before.stop()
    // THE RE-BIND: a fresh surface (its own `opened` flag is false) over a live team, sharing the latch.
    const second = fakePanel()
    /** The re-bound surface. */
    const after = armPanelAttention({
      ...second.deps,
      readWorkflow: () => current,
      feed: feed.accessor,
      autoOpen: true,
      autoOpenLatch: latch,
      log: silentLog(),
    })
    // The team is live already, so this is not an appearance anyway; make one appear to prove the latch
    // (not the edge rule) is what stops it.
    current = workflow([])
    feed.fire()
    current = workflow([{ visual: "failed" }])
    feed.fire()
    expect(second.opens()).toBe(0)
    expect(after.opened()).toBe(false)
    after.stop()
  })
})

// ── the WATCHDOG half of the badge (contract `.mpd/plans/watchdog-tui-panel.md` §7) ──────────────
//
// A hold is raised by the watchdog's OWN timer and touches no team record, so the team feed carries no
// event for the state change an operator most needs to see. The surface therefore publishes a SECOND
// badge on the WATCHDOG page's own tab, and re-takes it on its own poll. These arms pin: the badge
// ladder (hold > unread), the separate PAGE it is published to, the CLEAR path, that it never opens a
// page, and that the poll is what carries a hold the feed never announced.
describe("the watchdog page's own badge arm", () => {
  /** One badge call, with the page it addressed. */
  type BadgeCall = { readonly id: string; readonly badge: PanelBadge | null }

  /** The two pages' routes, with every badge call recorded per id. */
  function fakeTwoPages(): {
    readonly deps: Pick<PanelAttentionDeps, "panelId" | "openPanel" | "badgePanel" | "watchdogPanelId">
    readonly calls: BadgeCall[]
    readonly opens: number
  } {
    /** Every badge call, in order. */
    const calls: BadgeCall[] = []
    /** How many open attempts were made (the watchdog half must never open anything). */
    let opens = 0
    return {
      deps: {
        panelId: (): string => "act1:team",
        watchdogPanelId: (): string => "act1:watchdog",
        openPanel: (): boolean => {
          opens += 1
          return true
        },
        badgePanel: (id: string, badge: PanelBadge | null): boolean => {
          calls.push({ id, badge })
          return true
        },
      },
      calls,
      /** How many open attempts were made (the watchdog half must never open anything). */
      get opens(): number {
        return opens
      },
    }
  }

  /** A watchdog view fixture. */
  const view = (holds: readonly string[], unread: readonly unknown[] = []): never =>
    ({ holds, unread }) as never

  test("a hold is a warning and counts with the unread incidents; unread alone is info; nothing clears", () => {
    expect(watchdogAttentionBadge(view([]))).toBeNull()
    expect(watchdogAttentionBadge(view(["team-a"]))).toEqual({ level: "warning", unread: 1 })
    expect(watchdogAttentionBadge(view([], [{}]))).toEqual({ level: "info", unread: 1 })
    // The count is the SUM: the tab chip shows ONE number, and the operator asks "anything for me here?".
    expect(watchdogAttentionBadge(view(["team-a", "team-b"], [{}, {}]))).toEqual({ level: "warning", unread: 4 })
  })

  test("the badge is published on the WATCHDOG page's id, and the team page keeps its own badge", () => {
    /** The recorded routes. */
    const pages = fakeTwoPages()
    /** The surface under test: a failed task on the team page, a hold on the watchdog page. */
    const attention = armPanelAttention({
      ...pages.deps,
      readWorkflow: () => workflow([{ visual: "failed" }]),
      feed: undefined,
      autoOpen: true,
      readWatchdog: () => view(["team-a"]),
      // The initial pass is the arm's only trigger, so no poll may disturb the call order.
      watchdogPollMs: 0,
      log: silentLog(),
    })
    // TWO pages, TWO badges: the team badge is the task ladder's, the watchdog badge the hold's.
    expect(pages.calls).toEqual([
      { id: "act1:team", badge: { level: "error", unread: 1 } },
      { id: "act1:watchdog", badge: { level: "warning", unread: 1 } },
    ])
    // The watchdog half NEVER opens the page: the command and the tab are the operator's own choice.
    expect(pages.opens).toBe(0)
    attention.stop()
  })

  test("an emptied view CLEARS the watchdog badge — one null publish, not a stale number", () => {
    /** The recorded routes. */
    const pages = fakeTwoPages()
    /** The view the surface reads; emptied after the first pass. */
    let current: never = view(["team-a"])
    /** The surface under test. */
    const attention = armPanelAttention({
      ...pages.deps,
      readWorkflow: () => undefined,
      feed: undefined,
      autoOpen: false,
      readWatchdog: () => current,
      watchdogPollMs: 0,
      log: silentLog(),
    })
    expect(pages.calls.at(-1)).toEqual({ id: "act1:watchdog", badge: { level: "warning", unread: 1 } })
    current = view([])
    attention.observe(false)
    expect(pages.calls.at(-1)).toEqual({ id: "act1:watchdog", badge: null })
    attention.stop()
  })

  test("the POLL re-takes the badge: a hold raised after arming reaches the closed tab", async () => {
    /** The recorded routes. */
    const pages = fakeTwoPages()
    /** The view the surface reads: empty at arm, held once the test flips it. */
    let current: never = view([])
    /** The surface under test, polling far faster than production so the arm stays deterministic. */
    const attention = armPanelAttention({
      ...pages.deps,
      readWorkflow: () => undefined,
      feed: undefined,
      autoOpen: false,
      readWatchdog: () => current,
      watchdogPollMs: 20,
      log: silentLog(),
    })
    // The arm-time pass published the null badge (the clear), and nothing else yet.
    expect(pages.calls.filter((call) => call.id === "act1:watchdog")).toEqual([{ id: "act1:watchdog", badge: null }])
    current = view(["team-a"])
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(pages.calls.filter((call) => call.id === "act1:watchdog")).toContainEqual({ id: "act1:watchdog", badge: { level: "warning", unread: 1 } })
    attention.stop()
    // AFTER stop THE POLL IS GONE: no call arrives once the surface is retired.
    /** How many calls had landed when the surface stopped. */
    const settled = pages.calls.length
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(pages.calls.length).toBe(settled)
  })
})
