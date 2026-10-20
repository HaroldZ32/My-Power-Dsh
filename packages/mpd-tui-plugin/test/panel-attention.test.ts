// THE PANEL'S ATTENTION SURFACE (G2 of the stateless-deployment wave, 2026-10-20).
//
// WHY THESE ARMS EXIST. The badge used to be published by the DAG page, and dsh-tui mounts a plugin
// panel only while it is the ACTIVE page of its column — so the old publisher could only decorate a
// page the user was already looking at, and the auto-open had no implementation at all. The surface
// moved to apply, driven by the team feed, and every fact below is one a regression could silently
// undo: the badge reaching a CLOSED panel, the auto-open firing exactly once and only for a team that
// APPEARED, a refusal never becoming a retry loop, and disposal leaving no subscriber behind.
import { describe, expect, test } from "bun:test"

import { armPanelAttention, attentionBadge, panelsSummaryLine, type PanelAttentionDeps } from "../src/panel-attention.js"
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
 * @returns the projection, structurally sufficient for the surface under test.
 */
function workflow(tasks: readonly TaskVisual[], holds: readonly string[] = []): TeamWorkflow {
  return { workspace: "/w", tasks: tasks as unknown as TeamWorkflow["tasks"], holds } as unknown as TeamWorkflow
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

  test("a watchdog HOLD is at least a warning, and it upgrades a quiet running badge", () => {
    expect(attentionBadge(workflow([], ["team-1"]))).toEqual({ level: "warning", unread: 1 })
    expect(attentionBadge(workflow([{ visual: "running" }], ["team-1"]))).toEqual({ level: "warning", unread: 1 })
    // A failure still outranks a hold: the level ladder is not flattened by the hold clause.
    expect(attentionBadge(workflow([{ visual: "failed" }, { visual: "blocked" }], ["team-1"]))?.level).toBe("error")
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
