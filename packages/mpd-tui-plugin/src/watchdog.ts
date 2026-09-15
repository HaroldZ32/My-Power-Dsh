// w6/w6b — the TUI front door for the team watchdog.
//
// A stuck (held) team must hold a ROW on the status line while the condition lasts, offer a dialog
// whose acknowledge action ends the replay, and INFORM a user who was not watching on the next
// start. This module owns the read side of that contract.
//
// SERVICE BOUNDARY (w6b): every store access goes through the `mpdWatchdog` service the watchdog
// package publishes. This package must NOT link the watchdog's sidecar writers into its own build —
// the repo's lane pins the invariant from the BUILT BYTES (T7 rejects writeFileSync/appendFileSync/
// mkdirSync/cpSync/rmSync/unlinkSync/createWriteStream in `packages/mpd-tui-plugin/dist/index.js`).
// Only `import type` for the shared record shapes survives here; it is erased at build time.
//
// ABSENT SERVICE: the watchdog is a bundle row, so the service is normally present. When it is NOT,
// this module degrades safely and states exactly what a user sees: no watchdog text on the status
// line (the plain board line), no replay dialog, and an `acknowledge()` that reports failure instead
// of pretending — a front door must never offer an action it cannot honour.
import type { IncidentRecord } from "../../mpd-team-watchdog-plugin/src/sidecars.js"
import type { DialogSeam } from "./dialogs.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"
import type { PluginContextLike } from "./types.js"

/** The service id the watchdog package publishes. */
export const WATCHDOG_SERVICE = "mpdWatchdog"
/** The reader key this front door owns in the per-reader watermark map. */
export const WATCHDOG_READER = "mpd-tui"
/** Every notice this module produces starts with this prefix (the status line stays greppable). */
export const WATCHDOG_NOTICE_PREFIX = "watchdog"
/** The dialog option id that acknowledges the replayed incidents. */
export const ACKNOWLEDGE_OPTION = "acknowledge"

/**
 * The slice of the `mpdWatchdog` service this front door uses.
 *
 * Every member is optional in the TYPE because the service is resolved at call time from a foreign
 * context: a partial or older service must degrade, never throw into a render path.
 */
export interface WatchdogServiceLike {
  heldTeams?(workspace?: string): string[]
  unread?(reader: string, workspace?: string): IncidentRecord[]
  acknowledge?(reader: string, upTo: number, workspace?: string): { ok: boolean; watermark: number; error?: string }
  view?(reader: string, workspace?: string): { workspace: string | null; holds: string[]; unread: IncidentRecord[] }
}

/** The durable state a single read observes. */
export interface WatchdogView {
  /** Team ids currently held by the watchdog (sorted). */
  readonly holds: readonly string[]
  /** Incidents this reader has not acknowledged yet (append order). */
  readonly unread: readonly IncidentRecord[]
}

/** An empty view: what the front door reports when the service is absent or the store is broken. */
export const EMPTY_WATCHDOG_VIEW: WatchdogView = { holds: [], unread: [] }

/**
 * One read of the durable state through the service.
 *
 * @param service - the `mpdWatchdog` service, or undefined when the row is absent.
 * @param reader - the reader key whose watermark decides "unread".
 * @param workspace - the workspace to read.
 * @returns the view; all-empty when the service is absent, partial or failing.
 */
export function readWatchdogView(service: WatchdogServiceLike | undefined, reader: string, workspace: string): WatchdogView {
  if (service === undefined || service === null) return EMPTY_WATCHDOG_VIEW
  try {
    if (typeof service.view === "function") {
      const view = service.view(reader, workspace)
      if (view !== undefined && view !== null) return { holds: [...(view.holds ?? [])], unread: [...(view.unread ?? [])] }
    }
    const holds = typeof service.heldTeams === "function" ? (service.heldTeams(workspace) ?? []) : []
    const unread = typeof service.unread === "function" ? (service.unread(reader, workspace) ?? []) : []
    return { holds: [...holds], unread: [...unread] }
  } catch {
    return EMPTY_WATCHDOG_VIEW
  }
}

/** The held teams for one workspace, through the service (empty when it cannot answer). */
export function heldTeams(service: WatchdogServiceLike | undefined, workspace: string): string[] {
  if (service === undefined || service === null || typeof service.heldTeams !== "function") return []
  try {
    return [...(service.heldTeams(workspace) ?? [])]
  } catch {
    return []
  }
}

/**
 * The status-line notice for a view, or undefined when there is nothing to say.
 *
 * Both halves are stated separately so a user can tell "a team is held RIGHT NOW" (live condition)
 * from "you missed N incident(s)" (replay), and the acknowledge is what retires the replay.
 */
export function watchdogNotice(view: WatchdogView): string | undefined {
  const parts: string[] = []
  if (view.holds.length > 0) parts.push(`held ${view.holds.join(", ")}`)
  if (view.unread.length > 0) parts.push(`${view.unread.length} unread incident${view.unread.length === 1 ? "" : "s"}`)
  return parts.length === 0 ? undefined : `${WATCHDOG_NOTICE_PREFIX}: ${parts.join(" · ")}`
}

/** Join the notice providers the status line renders, or undefined when none has anything to say. */
export function composeNotices(...notices: readonly (string | undefined)[]): string | undefined {
  const parts = notices.filter((notice): notice is string => typeof notice === "string" && notice.length > 0)
  return parts.length === 0 ? undefined : parts.join(" · ")
}

/** The dialog request for the replayed condition; returned so a test can assert the exact text. */
export interface WatchdogDialogRequest {
  readonly title: string
  readonly options: readonly { id: string; label: string; description?: string }[]
}

/** Build the replay dialog: the notice text plus the acknowledge action. */
export function watchdogDialog(view: WatchdogView): WatchdogDialogRequest {
  const detail =
    view.holds.length > 0
      ? `Team ${view.holds.join(", ")} is held by the team watchdog (a member went silent).`
      : "The team watchdog recorded incidents while nobody was watching."
  return {
    title: `${watchdogNotice(view) ?? WATCHDOG_NOTICE_PREFIX} — ${detail}`,
    options: [
      { id: ACKNOWLEDGE_OPTION, label: "Acknowledge", description: "mark these incidents as read so they stop being replayed" },
      { id: "later", label: "Later", description: "keep them unread; they will be shown again on the next start" },
    ],
  }
}

/** The front door facade. */
export interface WatchdogFrontDoor {
  /** True once the `mpdWatchdog` service has been resolved (the store is then readable). */
  available(): boolean
  /** The current notice for the status line (a live read; undefined when there is nothing to say). */
  notice(): string | undefined
  /** The current durable view (read-only). */
  view(): WatchdogView
  /**
   * Show the replay dialog when there is something unread, and acknowledge on request.
   * @returns the option id the user chose, or undefined when nothing was unread / no service / no dialog.
   */
  offer(): Promise<string | undefined>
  /** Advance this reader's watermark up to an incident timestamp (through the service). */
  acknowledge(upTo: number): { ok: boolean; watermark: number; error?: string }
}

/**
 * Attach the front door.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param options - workspace resolver, the dialog facade and the post-ack hook.
 * @returns the facade.
 */
export function attachWatchdogFrontDoor(
  ctx: PluginContextLike,
  log: Log,
  options: {
    workspaceRoot: () => string
    dialogs: DialogSeam
    onAcknowledged?: () => void
    /** Run the replay as soon as the service AND the dialog seam are composed (the default). */
    replayOnAttach?: boolean
  },
): WatchdogFrontDoor {
  let service: WatchdogServiceLike | undefined
  let dialogsReady = false
  let warnedAbsent = false
  let replayed = false

  const available = (): boolean => service !== undefined && service !== null

  const read = (): WatchdogView => {
    try {
      return readWatchdogView(service, WATCHDOG_READER, options.workspaceRoot())
    } catch (error) {
      log.debug(`watchdog read failed: ${String((error as Error)?.message ?? error)}`)
      return EMPTY_WATCHDOG_VIEW
    }
  }

  const acknowledge: WatchdogFrontDoor["acknowledge"] = (upTo) => {
    if (!available() || typeof service?.acknowledge !== "function") {
      // Never pretend an acknowledge landed: the caller and the user are told it did not.
      return { ok: false, watermark: 0, error: `the ${WATCHDOG_SERVICE} service is not mounted — the watchdog store was not written` }
    }
    try {
      const result = service.acknowledge(WATCHDOG_READER, upTo, options.workspaceRoot())
      if (result !== undefined && result !== null && result.ok === true) options.onAcknowledged?.()
      return result ?? { ok: false, watermark: 0, error: "the acknowledge returned nothing" }
    } catch (error) {
      return { ok: false, watermark: 0, error: String((error as Error)?.message ?? error) }
    }
  }

  const offer: WatchdogFrontDoor["offer"] = async () => {
    if (!available()) {
      // The absent-service path, stated once: no store, therefore nothing to replay and no action
      // to offer. The status line stays the plain board line and the user sees no dialog.
      if (!warnedAbsent) {
        warnedAbsent = true
        log.warn(
          `the ${WATCHDOG_SERVICE} service is not mounted: the watchdog notice and its acknowledge are unavailable (no held team or unread incident can be shown)`,
        )
      }
      return undefined
    }
    const view = read()
    if (view.unread.length === 0) return undefined
    if (!options.dialogs.available()) return undefined
    const request = watchdogDialog(view)
    const choice = await options.dialogs.select(request.title, request.options)
    if (choice === ACKNOWLEDGE_OPTION) {
      const upTo = view.unread.reduce((max, record) => Math.max(max, record.at), 0)
      acknowledge(upTo)
    }
    return choice
  }

  const maybeReplay = (): void => {
    if (replayed || !dialogsReady || !available()) return
    replayed = true
    void offer().catch((error: unknown) => {
      log.debug(`watchdog replay failed: ${String((error as Error)?.message ?? error)}`)
    })
  }

  // The service is resolved whether or not the automatic replay is enabled (the flag only controls
  // the once-only attach replay; offer()/acknowledge() must work in every configuration). Both seams
  // are reached with the deferred inject form.
  onService(ctx, WATCHDOG_SERVICE, (_scoped, resolved) => {
    service = resolved as WatchdogServiceLike
    if (options.replayOnAttach !== false) maybeReplay()
  })
  if (options.replayOnAttach !== false) {
    onService(ctx, "tuiDialogs", () => {
      dialogsReady = true
      maybeReplay()
    })
  }

  return { available, notice: () => watchdogNotice(read()), view: read, offer, acknowledge }
}
