// THE PANEL'S ATTENTION SURFACE — published from APPLY, never from a mounted page (G2 of the
// stateless-deployment wave, 2026-10-20).
//
// WHY IT CANNOT LIVE IN THE PAGE. dsh-tui mounts a plugin panel only while it is the ACTIVE page of
// its column (`mountPolicy: 'active'` in the host's own `TuiPanelRuntime.register`), so a page can
// only ever badge ITSELF while the user is already looking at it — the one moment a badge is
// worthless. The host's registry accepts `badge(id, …)` for any panel of ours at any time, and the
// reference implementation this wave follows publishes its warning badge from the HOST side for
// exactly that reason (`dsh-blender-plugin` v2.2.0, `src/tui-panel.ts` + the host's `tuiPanels.badge`).
//
// THE TRIGGER IS THE TEAM FEED — the same `mpdTeams` push the pages subscribe to — so a badge lands
// when the team state changes rather than on a timer. The auto-open uses the SAME observation and
// fires at most ONCE per process, the first time a team becomes live AFTER this process started: it
// deliberately does NOT fire on the first observation, so booting into a workspace that already has a
// team never steals the sidebar from the user.
//
// THE LIMIT THIS ACCEPTS, stated rather than papered over: the feed is WORKSPACE-scoped (it carries
// no session id), so the trigger cannot be "a team appeared in the session on screen". The page itself
// stays session-accurate — it reads its own session off `host.snapshot()` and draws the explicit
// `no team in this session` marker when the trigger came from another session — and that marker is
// the honest answer rather than a wrong board.
import type { Log } from "./log.js"
import type { PanelBadge } from "./panel-core.js"
import { dagBadge } from "./panel-dag.js"
import type { TeamFeedAccessor, TeamWorkflow } from "./team-state.js"
import type { WatchdogView } from "./watchdog.js"

/**
 * How often the watchdog half of the badge is re-taken when the caller asks for a poll.
 *
 * WHY A POLL AND NOT ONLY THE FEED: a hold is raised by the watchdog's OWN timer after a silence
 * window, and that write never touches the team record — so the team feed carries no event for it,
 * which is exactly the moment a closed page must start asking for attention. Five seconds is the
 * watchdog's own observation scale rounded up; each pass is one synchronous service read.
 */
export const WATCHDOG_BADGE_POLL_MS = 5000

/**
 * What the attention surface needs from the composition.
 *
 * Every panel-side member takes the id it was DISCOVERED under: the host composes a panel id as
 * `<pluginId>:<slug>` and a loader row has no Component identity, so the id is the host's `act<N>`
 * fallback and is knowable only from the registration read-back — never from a source constant.
 */
export interface PanelAttentionDeps {
  /** The registered panel's final host id, read per call (the seam may bind late). */
  readonly panelId: () => string | undefined
  /** Opens (and focuses) the panel; false when the host refused or no seam serves it. */
  readonly openPanel: (id: string) => boolean
  /**
   * Sets or clears the panel's badge.
   *
   * THE THREE ANSWERS ARE DIFFERENT FACTS and the surface treats them so: `true` accepted, `false`
   * the host HAS a badge member and refused this call (retry on the next state change), `undefined`
   * the host exposes no badge member at all (never retry — no later call can succeed, and a per-event
   * retry would only repeat a line forever).
   */
  readonly badgePanel: (id: string, badge: PanelBadge | null) => boolean | undefined
  /** Reads the CURRENT workspace's team projection; undefined when the composition has none. */
  readonly readWorkflow: () => TeamWorkflow | undefined
  /** The live team feed accessor; undefined when this composition publishes none. */
  readonly feed: TeamFeedAccessor | undefined
  /** Whether the first-live-team auto-open is enabled (the row's `panelAutoOpen` knob). */
  readonly autoOpen: boolean
  /**
   * The PROCESS-WIDE one-shot latch for the auto-open, shared across every surface this activation
   * arms. A panel-seam RE-BIND replaces the surface (and its own `opened` flag with it), so without a
   * latch in `apply` scope a re-bind would let a later team open the page a second time in the same
   * process — the promise the knob's documentation makes is "once per process", not "once per
   * binding". Omitted by a unit arm that wants the per-surface behaviour.
   */
  readonly autoOpenLatch?: { spent: boolean }
  /**
   * The WATCHDOG page's final host id, read per call; omitted when this composition has no such page.
   *
   * The watchdog badge is published on that page's OWN tab: an operator who is not looking at it must
   * see the tab asking for attention, which is the same reason the MPD page's badge is published from
   * here rather than from the page body.
   */
  readonly watchdogPanelId?: () => string | undefined
  /**
   * The durable watchdog view the badge is derived from; omitted disables the watchdog half entirely.
   *
   * Contract `.mpd/plans/watchdog-tui-panel.md` §7: unread incidents and holds raise the panel's
   * attention ladder. The read is the front door's own service read — never a store file — and it is
   * contained by that read, so a broken store answers the empty view rather than throwing here.
   */
  readonly readWatchdog?: () => WatchdogView
  /**
   * How often the watchdog badge is re-taken; {@link WATCHDOG_BADGE_POLL_MS} when omitted, `0` disables
   * the poll (the initial pass and every team-feed event still publish).
   */
  readonly watchdogPollMs?: number
  /** Diagnostics; never a terminal. */
  readonly log: Log
}

/** The live attention surface one registration keeps for its lifetime. */
export interface PanelAttention {
  /**
   * One observation pass.
   * @param event - true when a FEED notification triggered it, false for the initial read. Only an
   *   event may auto-open, which is what keeps a boot with an existing team from stealing the panel.
   */
  observe(event: boolean): void
  /** The badge this surface last published; `null` when it published nothing (or cleared it). */
  current(): PanelBadge | null
  /** Whether the one-shot auto-open has already fired (whatever the host answered). */
  opened(): boolean
  /**
   * Re-resolve the team feed and subscribe again, then publish the current badge.
   *
   * WHY THIS EXISTS: the two services bind INDEPENDENTLY. When the panel seam binds before `mpdTeams`,
   * the feed accessor answers `undefined` at arm, and without a second attempt this surface would
   * never subscribe — no badge, no auto-open, silently. The caller invokes this from the team
   * service's own bind callback, and it is idempotent (the previous subscription is released first).
   */
  resubscribe(): void
  /** Releases the feed subscription and makes every later observation a no-op. */
  stop(): void
}

/**
 * Whether two badges say the same thing, so a publish happens on a CHANGE rather than per event.
 * @param left - one badge, or `null` for "nothing to report".
 * @param right - the other badge.
 * @returns true when both are `null`, or both carry the same level and count.
 */
function sameBadge(left: PanelBadge | null, right: PanelBadge | null): boolean {
  if (left === null || right === null) return left === right
  return left.level === right.level && left.unread === right.unread
}

/**
 * The badge one workflow earns, by the SAME level ladder the page used to derive
 * ({@link dagBadge}): failed work is `error`, a blocked task `warning`, a running task a quiet
 * `info`; a team-watchdog HOLD of the DISPLAYED team is at least `warning`, because a hold is a team
 * the watchdog stopped.
 *
 * THE HOLD LEDGER IS WORKSPACE-WIDE, so it is filtered to the team this projection displays — the
 * same membership test the page's hold row uses (`workflow.holds.includes(team.id)`). Another
 * team's hold must neither warn this panel nor raise its count, and a projection with no team id
 * has no membership to prove, so it reports no hold at all.
 * @param workflow - the projection, or undefined when the composition has no readable team.
 * @returns the badge to publish, or `null` for "nothing to report".
 */
export function attentionBadge(workflow: TeamWorkflow | undefined): PanelBadge | null {
  if (workflow === undefined) return null
  /** The task-derived badge: the drawer's own ladder, reused rather than re-typed here. */
  const fromTasks = dagBadge(workflow.tasks)
  /** The id of the team this projection DISPLAYS; absent means no hold can be proved ours. */
  const teamId = workflow.team?.id
  /** How many watchdog holds name the DISPLAYED team — never another team's holds. */
  const holds = teamId !== undefined && Array.isArray(workflow.holds)
    ? workflow.holds.filter((held) => held === teamId).length
    : 0
  if (fromTasks === null) return holds > 0 ? { level: "warning", unread: holds } : null
  // A HOLD OUTRANKS A QUIET `info`: a running task is worth a glance, a held team is not running.
  if (holds > 0 && fromTasks.level === "info") return { level: "warning", unread: Math.max(fromTasks.unread, holds) }
  return fromTasks
}

/**
 * The badge the WATCHDOG page earns: a hold is `warning`, unread incidents alone are `info`.
 *
 * The count is the sum, because the host's tab chip shows ONE number and an operator asking "is there
 * anything for me here?" is answered by the whole queue: every held team and every incident the
 * `mpd-tui` reader has not acknowledged. `null` means nothing to report — and it is the value that
 * CLEARS a badge a previous observation left behind.
 * @param view - the durable view this pass read (the empty view when the service is absent).
 * @returns the badge to publish, or `null`.
 */
export function watchdogAttentionBadge(view: WatchdogView): PanelBadge | null {
  /** How many teams the watchdog currently holds. */
  const held = view.holds.length
  /** How many incidents this reader has not acknowledged. */
  const unread = view.unread.length
  if (held === 0 && unread === 0) return null
  return { level: held > 0 ? "warning" : "info", unread: held + unread }
}

/**
 * Arm the panel's attention surface: publish the badge on every team-state change, and auto-open the
 * panel once when a team first becomes live.
 *
 * NOTHING HERE THROWS: a missing feed, a reader that throws, a host that refuses the badge or the open
 * — each is contained and logged once, because this surface is a decoration on top of a page that must
 * keep working.
 * @param deps - the panel's id/open/badge routes, the workspace reader and the row's auto-open knob.
 * @returns the live surface; the caller must call {@link PanelAttention.stop} from a fiber-owned effect.
 */
export function armPanelAttention(deps: PanelAttentionDeps): PanelAttention {
  /** The last badge this surface SETTLED, or null before the first settle (see {@link settled}). */
  let last: PanelBadge | null = null
  /**
   * Whether a publish has ever SETTLED — an accepted call, or a host with no badge member.
   *
   * WHY A FLAG ON TOP OF `last`: `last === null` means BOTH "nothing published yet" and "published
   * the null badge", so a first pass with no badge would compare equal by `sameBadge` and publish
   * nothing — leaving a badge a previous binding left on the panel. The first observation after
   * arming must publish exactly once, the null badge included, which is what clears it.
   */
  let settled = false
  /** The last WATCHDOG badge this surface settled; null before its first settle (same reason as above). */
  let lastWatchdog: PanelBadge | null = null
  /** Whether the watchdog half has ever settled, so its FIRST pass publishes (the null badge included). */
  let settledWatchdog = false
  /** Whether the one-shot auto-open already fired, whatever the host answered. */
  let opened = false
  /** Whether the PREVIOUS pass saw a live team, which is what turns a state into an APPEARANCE. */
  let wasLive = false
  /** Whether {@link PanelAttention.stop} retired this surface. */
  let stopped = false
  /** The watchdog badge poll, once one was scheduled. */
  let pollTimer: ReturnType<typeof setInterval> | undefined = undefined
  /** The feed's own unsubscribe, once a subscription landed. */
  let release: (() => void) | undefined
  /** Whether the "the host exposes no badge member" degrade was already said. */
  let badgeMissing = false
  /** The panel's final id, or undefined while the seam is unbound / the registration unconfirmed. */
  const id = (): string | undefined => {
    try {
      return deps.panelId()
    } catch {
      return undefined
    }
  }
  /** The WATCHDOG page's final id; undefined on a composition that registers no such page. */
  const watchdogId = (): string | undefined => {
    if (deps.watchdogPanelId === undefined) return undefined
    try {
      return deps.watchdogPanelId()
    } catch {
      return undefined
    }
  }
  /** The workspace projection, or undefined when the read fails (never a throw into the feed). */
  const read = (): TeamWorkflow | undefined => {
    try {
      return deps.readWorkflow()
    } catch {
      return undefined
    }
  }
  /** The durable watchdog view, or the empty view when the read is absent or throws. */
  const readWatchdog = (): WatchdogView => {
    if (deps.readWatchdog === undefined) return { holds: [], unread: [] }
    try {
      return deps.readWatchdog()
    } catch {
      return { holds: [], unread: [] }
    }
  }
  /**
   * Publish one badge TO ONE PAGE, tolerating a host that offers no badge member.
   * @param address - the discovered panel id, or undefined when nothing is registered to address.
   * @param next - the badge to publish, or `null` to clear.
   * @returns `true` accepted, `false` a callable host refused it (or there is no address), `undefined`
   *   the host has no badge member (the fact {@link badgeMissing} remembers so the retry stops).
   */
  const publishTo = (address: string | undefined, next: PanelBadge | null): boolean | undefined => {
    // AN UNREGISTERED PAGE IS NOT A REFUSAL TO RETRY FOREVER: nothing can be addressed yet, so the call
    // is skipped and the next pass (a re-bind, a registration that landed late) tries again.
    if (address === undefined) return false
    try {
      /** The host's own answer, kept three-valued so a refusal can retry and an absence cannot. */
      const accepted = deps.badgePanel(address, next)
      if (accepted === undefined && !badgeMissing) {
        badgeMissing = true
        deps.log.debug(`panel badge: ${address} has no badge member on this host; the panel keeps its tab chip only`)
      }
      return accepted
    } catch {
      return false
    }
  }
  /**
   * Publish one badge on the MPD page, tolerating a host that offers no badge member.
   * @param next - the badge to publish, or `null` to clear.
   * @returns the host's three-valued answer, as {@link publishTo} documents.
   */
  const publish = (next: PanelBadge | null): boolean | undefined => publishTo(id(), next)
  /**
   * Publish BOTH badges for one projection: the MPD page's, then the watchdog page's.
   *
   * Extracted so the POLL can publish without the auto-open edge (CodeRabbit #15): a poll tick that
   * ran the edge logic would set `wasLive` between a team write and the feed's coalesced delivery (50
   * ms by default), and the feed pass would then see no appearance — silently losing the one auto-open.
   * @param workflow - the projection this pass read.
   */
  const publishBadges = (workflow: TeamWorkflow | undefined): void => {
    /** The badge this state earns. */
    const next = attentionBadge(workflow)
    if (!settled || !sameBadge(last, next)) {
      // THE LAST VALUE SETTLES ON AN ACCEPTANCE OR AN ABSENT MEMBER, and on nothing else: a host that
      // HAS the member and refused this call leaves the value unset, so the next state change retries
      // it. An absent member settles it, because no later event can change that fact and a per-event
      // retry would log the same sentence forever.
      /** The publish's own three-valued answer. */
      const result = publish(next)
      if (result === true || (result === undefined && badgeMissing)) {
        last = next
        settled = true
      }
    }
    // THE WATCHDOG HALF (contract §7): unread incidents and holds raise the WATCHDOG page's own badge,
    // on the same pass. It is a SEPARATE badge on a SEPARATE page — merging it into the MPD badge would
    // make one tab's count describe two surfaces — and it settles independently, so a host that refuses
    // one badge call cannot stall the other's state tracking.
    if (deps.readWatchdog !== undefined) {
      /** The discovered watchdog page id; undefined when the page is not registered (yet). */
      const watchdogAddress = watchdogId()
      /** The badge this watchdog view earns. */
      const nextWatchdog = watchdogAttentionBadge(readWatchdog())
      if (watchdogAddress !== undefined && (!settledWatchdog || !sameBadge(lastWatchdog, nextWatchdog))) {
        /** The host's own three-valued answer for the watchdog page. */
        const result = publishTo(watchdogAddress, nextWatchdog)
        if (result === true || (result === undefined && badgeMissing)) {
          lastWatchdog = nextWatchdog
          settledWatchdog = true
        }
      }
    }
  }
  /**
   * The POLL's pass: badges only. It must NOT touch `wasLive` or the auto-open edge, or a tick landing
   * inside the feed's coalescing window would consume the one-shot auto-open (CodeRabbit #15).
   */
  const observeBadges = (): void => {
    if (stopped) return
    publishBadges(read())
  }
  /**
   * One observation pass, as {@link PanelAttention.observe} documents.
   * @param event - whether a feed notification caused this pass.
   */
  const observe = (event: boolean): void => {
    if (stopped) return
    /** The current projection, re-read per pass: a page-scoped surface would be a frame stale. */
    const workflow = read()
    // THE BADGES ARE THE SAME WORK IN BOTH MODES: publish them, then run the edge below.
    publishBadges(workflow)
    // AUTO-OPEN IS AN EDGE, NOT A STATE (CodeRabbit finding, 2026-10-20): a team that already existed
    // when this surface armed is NOT an appearance, and the first feed event after it (a status change,
    // a task update) must not open the page for it. `wasLive` carries the previous pass's answer and is
    // updated on EVERY OBSERVATION pass (the arm-time one included) — and, since #15, NEVER by the poll.
    /** Whether this pass sees a live team (a team with at least one task). */
    const live = workflow !== undefined && workflow.tasks.length > 0
    /** Whether a live team APPEARED since the previous OBSERVATION pass. */
    const appeared = live && !wasLive
    wasLive = live
    if (!event || !deps.autoOpen || opened || deps.autoOpenLatch?.spent === true || !appeared) return

    /** The discovered id at the moment the first live team was seen. */
    const address = id()
    if (address === undefined) return
    // LATCHED BEFORE THE CALL, in BOTH scopes: the host's `open()` is rate-limited per plugin (one per
    // 5 s) and can refuse for reasons the next event would hit again, so one refusal must not become a
    // loop — and the process-wide latch is what carries that across a panel-seam re-bind.
    opened = true
    if (deps.autoOpenLatch !== undefined) deps.autoOpenLatch.spent = true
    try {
      if (deps.openPanel(address)) deps.log.info(`panel auto-open: opened ${address} on the first live team`)
      else deps.log.debug(`panel auto-open: the host refused the one auto-open of ${address}; the panel stays reachable through the command and the panel bar`)
    } catch (error) {
      deps.log.debug(`panel auto-open: the open of ${address} threw (${String((error as Error)?.message ?? error)}); the panel stays reachable through the command and the panel bar`)
    }
  }
  /**
   * Resolve the feed and subscribe, releasing any previous subscription first.
   *
   * A feed that is not available YET is not a failure: the accessor answers `undefined` while
   * `mpdTeams` is unbound, and {@link PanelAttention.resubscribe} is the caller's second attempt from that
   * service's own bind callback.
   */
  const attach = (): void => {
    /** The previous subscription, released so a re-subscribe cannot double-deliver. */
    const previous = release
    release = undefined
    if (previous !== undefined) {
      try {
        previous()
      } catch {
        // A host unsubscribe that throws must not break a re-subscribe.
      }
    }
    /** This attempt's subscribe function, narrowed before it is trusted. */
    let subscribe: ReturnType<TeamFeedAccessor> | undefined
    try {
      subscribe = deps.feed === undefined ? undefined : deps.feed()
    } catch {
      subscribe = undefined
    }
    if (typeof subscribe !== "function") return
    try {
      release = subscribe((): void => observe(true))
    } catch {
      release = undefined
    }
  }
  attach()
  // THE INITIAL PASS publishes the badge a reboot must not forget, but may NOT auto-open (see the
  // header): a team that already existed before this process started is not an appearance, and it
  // seeds `wasLive` so the next event cannot turn it into one.
  observe(false)
  // THE WATCHDOG POLL, when the composition supplies a watchdog read. A hold is raised by the
  // watchdog's OWN timer and touches no team record, so the team feed carries no event for the one
  // state change an operator most needs to see; the poll is what publishes that badge. `unref` (when
  // the host's timer supports it) keeps a passive badge from holding a process open.
  if (deps.readWatchdog !== undefined) {
    /** The requested period; `0` is the caller's explicit "no poll". */
    const period = deps.watchdogPollMs ?? WATCHDOG_BADGE_POLL_MS
    if (period > 0) {
      try {
        pollTimer = setInterval((): void => observeBadges(), period)
        /** The timer's `unref`, when this runtime exposes one. */
        const unref = (pollTimer as { unref?: () => void }).unref
        if (typeof unref === "function") unref.call(pollTimer)
      } catch {
        // A runtime that refuses a timer keeps the feed-driven and initial passes; nothing else is lost.
        pollTimer = undefined
      }
    }
  }
  return {
    observe,
    /** Re-resolve the feed and re-publish; see {@link PanelAttention.resubscribe}. */
    resubscribe(): void {
      if (stopped) return
      attach()
      observe(false)
    },
    /** The badge this surface last published; see {@link PanelAttention.current}. */
    current(): PanelBadge | null {
      return last
    },
    /** Whether the one-shot auto-open already fired; see {@link PanelAttention.opened}. */
    opened(): boolean {
      return opened
    },
    /** Release the feed and retire the surface; see {@link PanelAttention.stop}. */
    stop(): void {
      if (stopped) return
      stopped = true
      // THE POLL DIES WITH THE SURFACE: a panel-seam re-bind arms a new surface, and two intervals
      // publishing badges would double every count and outlive the fiber the old one belonged to.
      if (pollTimer !== undefined) {
        try {
          clearInterval(pollTimer)
        } catch {
          // already cleared
        }
        pollTimer = undefined
      }
      /** The feed's unsubscribe, taken so a throwing one cannot be run twice. */
      const disposer = release
      release = undefined
      if (disposer === undefined) return
      try {
        disposer()
      } catch {
        // A host unsubscribe that throws must not break an unload.
      }
    },
  }
}

/**
 * The facts the panel-deployment line reports.
 *
 * Named as one bag rather than five parameters because the line is a DIAGNOSTIC: a reader (and a
 * support run) compares this line across boots, so the shape it reports is the contract, and a caller
 * cannot silently drop one fact by passing fewer arguments.
 */
export interface PanelDeploymentFacts {
  /** The MPD page's discovered id, or undefined while its registration is unconfirmed. */
  readonly teamId: string | undefined
  /** The workmate page's discovered id, or undefined. */
  readonly workmateId: string | undefined
  /** Whether the host offers the sidebar panel seam at all. */
  readonly seamBound: boolean
  /** The enable-keeper's measured state — since G1 `read-only` on a host that owns the list. */
  readonly keeper: { readonly state: string; readonly detail: string }
}

/**
 * The panel-deployment sentence `/mpd status` prints (G4 of the stateless-deployment wave).
 *
 * WHY THE HOST-ASSIGNED IDS AND NOTHING DERIVED: a panel's final id is `<pluginId>:<slug>` and the
 * `<pluginId>` half belongs to the HOST (a loader row has no Component identity, so the host composes
 * its `act<N>` fallback), which makes the id the ONE fact neither a user nor a document can derive —
 * the reference implementation's doctor prints exactly this for the same reason. The keeper half is
 * the other fact a user cannot see: whether THIS bundle still writes the host's enable list (it must
 * not, on a host that owns it).
 * @param facts - the ids, the seam state and the keeper's verdict.
 * @returns the one line, newline-free.
 */
export function panelsSummaryLine(facts: PanelDeploymentFacts): string {
  /** Each page's label, with its discovered id or an honest "unregistered". */
  const ids = ["team=" + (facts.teamId ?? "unregistered"), "workmate=" + (facts.workmateId ?? "unregistered")]
  return "panels: " + ids.join(" ") + " · " + (facts.seamBound ? "seam bound" : "no panel seam") + " · keeper " + facts.keeper.state + " — " + facts.keeper.detail
}
