// THE COMPOSER STRIP AND THE MENU ACTIONS: the two surfaces that are NOT a panel (contract D5).
//
// WHY THEY LIVE TOGETHER: both are thin adapters over the SAME workbench read (`readPanelSnapshot`), and
// both are registered at one moment — when the DSH Go bridge binds. Keeping them in one module is what
// makes "the bridge appeared" a single decision instead of three independent retries.
//
// THE STRIP IS ONE LINE, 24 CHARACTERS, AND EMITS ONLY ON CHANGE. The app clips the line and redraws on
// every emit, so an emit-every-tick strip would be a permanent redraw at 0.5 Hz. The line is selected by
// `caps.locale`: Chinese when the app asks for `zh`, English otherwise.
//
// EVERY MENU HANDLER IGNORES A MISSING SERVICE. A composition without the team-actions service, the
// memory row or a clipboard effect answers a toast — the protocol's own failure shape — and never throws
// into the bridge.
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import type { DshGoCaps, DshGoStripValue } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { DSHGO_POLL_MS, readPanelSnapshot, sessionIdOfScope, type PanelBridge, type PanelEffect, type PanelReply, type PanelServices, type PanelTeamActionsFace } from "./dshgo-panel"

/** The composer.action id that runs one dispatch pass (declared in the manifest). */
export const DSHGO_DISPATCH_ACTION = "mpd-dispatch"

/** The message.action id that saves the long-pressed reply as one memory entry. */
export const DSHGO_SAVE_MEMORY_ACTION = "mpd-save-memory"

/** The message.action id that copies the long-pressed reply to the clipboard. */
export const DSHGO_COPY_REPLY_ACTION = "mpd-copy-reply"

/** The strip's own id, matching the manifest's `composer.strip` row. */
export const DSHGO_STRIP_ID = "mpd-status"

/** The app's own ceiling on one strip line, in characters. */
const STRIP_MAX_CHARS = 24

/** The app's ceiling on a toast, in characters. */
const MAX_TOAST_CHARS = 40

/** The app's ceiling on a copied effect, in characters. */
const MAX_COPY_CHARS = 8000

/** The memory entry's description bound (contract D5). */
const MAX_MEMORY_DESCRIPTION_CHARS = 120

/** The memory entry's body bound (contract D5). */
const MAX_MEMORY_CONTENT_CHARS = 4000

/** The tool that writes one memory entry; the memory row publishes tools, not a service. */
const MEMORY_WRITE_TOOL = "mpd_memory_write"

/** What the strip and the actions need: the same seam the panels drive. */
export interface SurfaceOptions {
  /** The adapter's DSH Go seam. */
  dsh: PanelBridge
  /** The row context, read only through `get(name, false)`. */
  ctx: PanelServices
  /** Resolve a session's workspace root when the bridge cannot answer it. */
  workspace?: (sessionId: string) => string | undefined
  /** The diagnostic sink; the default is this row's own log file. */
  log?: (line: string) => void
  /** The poll period, defaulting to {@link DSHGO_POLL_MS}. */
  pollMs?: number
}

/** The tool runtime the menu handlers drive, when the composition exposes one. */
interface SurfaceToolFace {
  /** Call one registered tool in-process and normalize the result. */
  executeTool?: (input: { name: string; arguments?: unknown }) => Promise<unknown>
}

/** Read one string field from an unknown value, answering `""` for anything else. */
function stringOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Narrow an unknown to a plain record. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Run a probe, answering `fallback` when it throws. */
function probe<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** Clip one line to a character budget and flatten its whitespace. */
function clip(value: string, max: number): string {
  /** The flattened line the cap applies to. */
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : flat.slice(0, max)
}

/**
 * Whether the app's locale asks for Chinese.
 * @param caps - the capabilities the bridge handed the data function.
 * @returns true only for a `zh` primary subtag.
 */
function speaksChinese(caps: DshGoCaps | null | undefined): boolean {
  /** The locale tag, lower-cased. */
  const tag = typeof caps?.locale === "string" ? caps.locale.toLowerCase() : ""
  return tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_")
}

/**
 * Build the strip's one line from the workbench snapshot.
 * @param ready - how many rows are ready to dispatch.
 * @param active - how many rows are in flight.
 * @param parked - whether a question waits for the user.
 * @param warns - whether a plan waits for approval.
 * @param chinese - whether the app's locale asks for Chinese.
 * @returns the line and its tone, inside the app's 24-character ceiling.
 */
export function stripLine(ready: number, active: number, parked: boolean, warns: boolean, chinese: boolean): DshGoStripValue {
  /** The counters, in the app's language. */
  const counters = chinese ? String(ready) + " 就绪 · " + String(active) + " 进行" : String(ready) + " ready · " + String(active) + " active"
  /** The line, prefixed with the question marker when one is parked. */
  const text = (parked ? "❓" : "") + counters
  return { text: clip(text, STRIP_MAX_CHARS), icon: "team", tone: warns ? "warn" : "info" }
}

/**
 * Read the live line for one scope.
 * @param options - the seam and the resolvers.
 * @param scope - the invocation scope.
 * @param caps - what the app can draw and which language it speaks.
 * @returns the strip value the app renders.
 */
function stripValueOf(options: SurfaceOptions, scope: unknown, caps: DshGoCaps | null | undefined): DshGoStripValue {
  /** The session this strip reports on. */
  const sessionId = sessionIdOfScope(scope)
  /** The workspace the read is scoped to. */
  const workspace = probe(() => (typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined), undefined) ?? probe(() => options.workspace?.(sessionId), undefined)
  // The LIGHT read skips the workmate and memory projections: the strip needs two counters, a question
  // flag and a plan flag, and nothing else costs a file scan at 0.5 Hz.
  /** The snapshot the line is computed from. */
  const snapshot = readPanelSnapshot({ services: options.ctx, workspace, sessionId }, { light: true })
  return stripLine(snapshot.counts.ready, snapshot.counts.active, snapshot.question !== null, snapshot.plan?.ready === true, speaksChinese(caps))
}

/**
 * The reply text a message action was about: the long-pressed message's body, read defensively.
 * @param event - the invocation event the bridge sent.
 * @returns the reply text, or `""` when the event carries none.
 */
export function replyTextOf(event: unknown): string {
  /** The event as a record. */
  const record = recordOf(event)
  if (record === undefined) return ""
  /** The `value` the bridge fills for a message action. */
  const value = recordOf(record.value)
  return (
    stringOf(record.text) ||
    stringOf(value?.text) ||
    stringOf(value?.reply) ||
    stringOf(recordOf(record.message)?.text) ||
    stringOf(record.reply)
  )
}

/**
 * Build the three menu handlers.
 * @param options - the seam and the resolvers.
 * @returns the action map, keyed by the ids the manifest declares.
 */
export function createSurfaceActions(options: SurfaceOptions): Record<string, (scope: unknown, event: unknown) => Promise<PanelReply>> {
  /** The tool runtime, when the composition exposed one. */
  const tools = (): SurfaceToolFace => options.dsh as unknown as SurfaceToolFace
  /** Call one tool, answering its refusal or a confirmation as a toast. */
  const callTool = async (name: string, args: Record<string, unknown>, success: string): Promise<PanelEffect> => {
    /** The runtime, or undefined when this host has none. */
    const runtime = tools()
    if (runtime?.executeTool === undefined) return { toast: "Unavailable here" }
    /** The call's settled outcome; a throw is a refusal, never a rejection. */
    const outcome = await Promise.resolve().then(() => runtime.executeTool?.({ name, arguments: args })).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, value: error }))
    if (outcome.ok === false) return { toast: clip(outcome.value instanceof Error ? outcome.value.message : "The action was refused", MAX_TOAST_CHARS) }
    /** The tool's value as a record, so `ok`/`error` are typed reads. */
    const record = recordOf(outcome.value)
    if (record !== undefined && (record.ok === false || stringOf(record.error) !== "")) return { toast: clip(stringOf(record.error) || "The action was refused", MAX_TOAST_CHARS) }
    return { toast: clip(success, MAX_TOAST_CHARS) }
  }
  /** The dispatch handler: one pass over the conversation's team, deferred when it outlives the window. */
  const dispatch = async (scope: unknown): Promise<PanelReply> => {
    /** The conversation this tap belongs to. */
    const sessionId = sessionIdOfScope(scope)
    if (sessionId === "") return { toast: "Open a conversation first" }
    /** The team-actions service, resolved per tap. */
    const face = probe(() => options.ctx.get?.("mpdTeamActions", false), undefined) as PanelTeamActionsFace | undefined
    if (face?.dispatch === undefined) return { toast: "Unavailable here" }
    /** The pass, once it settles at all. */
    const running = Promise.resolve()
      .then(() => face.dispatch?.({ sessionId }))
      .then((value): PanelEffect => (recordOf(value)?.ok === false ? { toast: clip(stringOf(recordOf(value)?.error) || "The action was refused", MAX_TOAST_CHARS) } : { toast: "Dispatched" }), (error: unknown) => ({ toast: clip(error instanceof Error ? error.message : "The action was refused", MAX_TOAST_CHARS) }))
    // The app runs an effect only inside its three-second tap window; a longer pass is acknowledged
    // first and its result delivered by the deferred shape.
    return deferredOr(running, "Dispatching…")
  }
  /** The save handler: ONE memory entry whose description is the reply's first line. */
  const saveMemory = async (_scope: unknown, event: unknown): Promise<PanelReply> => {
    /** The reply the action was invoked on. */
    const reply = replyTextOf(event)
    if (reply.trim() === "") return { toast: "Nothing to save" }
    /** The entry's description: the reply's first non-empty line, clipped to the contract's bound. */
    const description = clip(reply.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? reply, MAX_MEMORY_DESCRIPTION_CHARS)
    // The BODY keeps its line breaks: `clip` flattens, which is right for a one-line description and
    // wrong for the markdown a memory entry carries.
    return callTool(MEMORY_WRITE_TOOL, { title: description, description, content: reply.slice(0, MAX_MEMORY_CONTENT_CHARS), kind: "note" }, "Saved to memory")
  }
  /** The copy handler: the reply, clipped to the app's copy ceiling. */
  const copyReply = async (_scope: unknown, event: unknown): Promise<PanelReply> => {
    /** The reply the action was invoked on. */
    const reply = replyTextOf(event)
    if (reply === "") return { toast: "Nothing to copy" }
    return { copy: reply.slice(0, MAX_COPY_CHARS) }
  }
  return { [DSHGO_DISPATCH_ACTION]: dispatch, [DSHGO_SAVE_MEMORY_ACTION]: saveMemory, [DSHGO_COPY_REPLY_ACTION]: copyReply }
}

/**
 * Wait for an effect, or acknowledge with the app's deferred shape when it outlives the tap window.
 * @param running - the effect, already started.
 * @param label - the waiting-state word, at most 16 characters.
 * @returns the effect, or `{ pending, result }`.
 */
async function deferredOr(running: Promise<PanelEffect>, label: string): Promise<PanelReply> {
  /** The deadline's resolution function, captured so the timer can be replaced by the race. */
  let settle: ((value: PanelEffect | symbol) => void) | undefined
  /** The marker a timeout resolves with. */
  const marker = Symbol("mpd-surface-timeout")
  /** The deadline promise. */
  const deadline = new Promise<PanelEffect | symbol>((resolve) => {
    settle = resolve
  })
  /** The deadline timer, cleared on the fast path. */
  const timer = setTimeout(() => settle?.(marker), 2000)
  try {
    /** Whichever settles first: the effect or the deadline. */
    const raced = await Promise.race([running, deadline])
    if (raced !== marker) return raced as PanelEffect
    return { pending: { label, timeoutMs: 60000 }, result: (): Promise<PanelEffect> => running }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Publish the composer strip and register the three menu actions, once, on a host that carries the bridge.
 * @param options - the seam, the service registry and the injectable sinks.
 * @returns whether the registrations landed now, plus the release for this module's work.
 */
export function registerDshGoSurfaces(options: SurfaceOptions): { registered: boolean; dispose: () => void } {
  /** The diagnostic sink: the row's file log unless a caller (a test) injects one. */
  const log = options.log ?? ((line: string): void => { rowLogLine("mpd-bundle", line) })
  /** The poll period this registration uses. */
  const pollMs = options.pollMs ?? DSHGO_POLL_MS
  /** Whether the strip and the actions are published; a second attempt after a success is a no-op. */
  let registered = false
  /** The last state this module announced, so one decision logs one token. */
  let announced = false
  /** The late-bind subscription's disposer, once one was installed. */
  let offBound: (() => void) | undefined
  /** Every interval a strip subscription owns, so the release can clear all of them. */
  const timers = new Set<ReturnType<typeof setInterval>>()
  /** The strip's data function: seed, poll, emit on change, cancel cleanly. */
  const data = (scope: unknown, emit: unknown, caps: DshGoCaps): (() => void) => {
    /** The app's emit callback, when the bridge handed one. */
    const send = typeof emit === "function" ? (emit as (value: DshGoStripValue) => void) : undefined
    /** The last line emitted for this subscription, so a steady state stays silent. */
    let last = ""
    /** Read once and emit only when the line changed. */
    const tick = (): void => {
      /** The line this tick renders. */
      const value = probe(() => stripValueOf(options, scope, caps), null)
      if (value === null) return
      /** The line's serialized form, which is what "changed" is measured on. */
      const serialized = JSON.stringify(value)
      if (serialized === last) return
      last = serialized
      probe(() => send?.(value), undefined)
    }
    tick()
    /** The interval this subscription owns. */
    const timer = setInterval(tick, pollMs)
    timers.add(timer)
    return (): void => {
      clearInterval(timer)
      timers.delete(timer)
    }
  }
  /** Try to publish the strip and the actions; stay silent and wait for a bind without the bridge. */
  const attempt = (): void => {
    if (registered) return
    /** Whether the bridge is bound right now. */
    const present = probe(() => options.dsh.dshGoPresent() === true, false)
    if (!present) {
      if (offBound === undefined) {
        offBound = probe(() => {
          /** The subscription's disposer, or a no-op when the runtime answered none. */
          const off = options.dsh.onServiceBound(["dshGo"], () => { attempt() })
          return typeof off === "function" ? off : (): void => {}
        }, (): void => {})
      }
      return
    }
    /** Whether the strip landed; the actions are registered regardless, so one refusal costs one surface. */
    const strip = probe(() => options.dsh.dshGoStrip?.(DSHGO_STRIP_ID, data) === true, false)
    /** Every action id the manifest declares, each registered on its own. */
    const surfaceActions = createSurfaceActions(options)
    /** How many action handlers the bridge accepted. */
    let accepted = 0
    for (const [id, handler] of Object.entries(surfaceActions)) {
      if (probe(() => options.dsh.dshGoOn?.(id, handler as (scope: unknown, event: unknown) => unknown) === true, false)) accepted += 1
    }
    registered = strip || accepted > 0
    if (!announced) {
      announced = true
      log("[mpd] dshGo=surfaces strip=" + (strip ? "on" : "off") + " actions=" + String(accepted))
    }
  }
  attempt()
  return {
    registered,
    dispose: (): void => {
      for (const timer of timers) clearInterval(timer)
      timers.clear()
      probe(() => offBound?.(), undefined)
      offBound = undefined
    },
  }
}
