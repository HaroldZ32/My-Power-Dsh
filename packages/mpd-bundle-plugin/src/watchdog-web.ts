// Web front door for the team watchdog's store: a read-only state route plus an
// acknowledge route, served from OUR bundle package.
//
// The watchdog package and the ADOPTED agent-teams package are never edited here. This
// module reads (and, for the acknowledge, advances exactly one per-reader key in) the
// store whose layout is the watchdog package's documented contract
// (packages/mpd-team-watchdog-plugin/README.md, "Where the state lives"):
//
//   <workspace>/<stateDir>/watchdog/hold/<teamId>.json        the durable hold sidecar
//   <workspace>/<stateDir>/watchdog/incidents.jsonl           one record per WARN/ESCALATE
//   <workspace>/<stateDir>/watchdog/read-watermark.json       { <reader>: <lastAckedIncidentTs> }
//   <workspace>/<stateDir>/watchdog/scene/<teamId>/latest.json the scene pointer
//
// The state route is READ-ONLY. The acknowledge route is a read-merge-atomic-rename of
// the watermark file that touches ONLY its own reader key, so another front door's
// watermark (the TUI reader, a second browser) can never be dropped by this write.
// Nothing else in the store is written, and team.json is never opened for writing.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { errorMessage as message } from "../../mpd-dsh-adapter-plugin/src/index"

/** The exact-path routes this module owns. */
export const WATCHDOG_STATE_PATH = "/plugins/mpd-team-watchdog/state"
/** The exact-path acknowledge route, whose POST body carries the reader and an optional incident timestamp. */
export const WATCHDOG_ACK_PATH = "/plugins/mpd-team-watchdog/ack"
/** The web reader's stable watermark key (recorded in the evidence; keep it stable). */
export const WATCHDOG_WEB_READER = "web-panel"
/** The adopted plugin's default team state directory (the watchdog row's default too). */
export const DEFAULT_TEAM_STATE_DIR = join(".mpd", "team")
/** At most this many unread incidents are shipped in one payload (newest first). */
export const MAX_ACTIVITY_RECORDS = 20

/** One durable hold, as the sidecar stores it. */
export interface WatchdogHold {
  /** The hold's own id, unique within the watchdog store. */
  id: string
  /** The team the hold applies to; the sidecar's filename is derived from it. */
  teamId: string
  /** Epoch milliseconds the hold was applied. */
  since: number
  /** Human-readable cause recorded with the hold. */
  cause: string
  /** The task the stall was observed on, or null when the hold names none. */
  taskId: string | null
  /** The attempt the stall was observed on, or null when the hold names none. */
  attemptId: string | null
  /** Epoch milliseconds of the scene snapshot the hold points at. */
  sceneAt: number
}

/** One incident, as incidents.jsonl stores it. */
export interface WatchdogIncident {
  /** The incident's own id, unique within the log. */
  id: string
  /** The team the incident was raised for. */
  teamId: string
  /** How loud the incident is: a WARN, or the ESCALATE that follows one. */
  kind: "warn" | "escalate"
  /** Epoch milliseconds the incident was recorded; the reader's watermark is compared against it. */
  at: number
  /** The stall cause and the duration it was measured over. */
  cause: { kind: string; ms: number }
  /** The task the stall was observed on, or null. */
  taskId: string | null
  /** The attempt the stall was observed on, or null. */
  attemptId: string | null
  /** Path of the scene pointer written for this incident, or null when none was. */
  scene: string | null
  /** Whether the durable hold was applied, refused, or never requested. */
  hold: "applied" | "not-applied" | "not-requested"
  /** The readers that have already acknowledged this incident. */
  acknowledgedBy: string[]
}

/** The banner the panel renders at the TOP: either the hold or the newest unread incident. */
export interface WatchdogBanner {
  /** Which banner wins: a live hold, a fresh escalation, or the newest warning. */
  kind: "held" | "escalated" | "warned"
  /** The team the banner names. */
  teamId: string
  /** The matching hold's id, or null when the banner is not backed by one. */
  holdId: string | null
  /** The matching incident's id, or null when the banner comes from a hold alone. */
  incidentId: string | null
  /** Human-readable cause shown in the banner. */
  cause: string
  /** Epoch milliseconds the banner's event started. */
  since: number
  /** The task the banner's event names, or null. */
  taskId: string | null
  /** The attempt the banner's event names, or null. */
  attemptId: string | null
  /** Scene pointer path for the banner's team, or null when nothing was recorded. */
  scene: string | null
  /** The workspace the banner's state was read from. */
  workspace: string
}

/** One activity record, derived from an incident (or from a hold with no incident). */
export interface WatchdogActivity {
  /** The originating incident's id. */
  id: string
  /** The team the record belongs to. */
  teamId: string
  /** The record's kind: an incident's warn/escalate, or a bare hold. */
  kind: "warn" | "escalate" | "hold"
  /** Epoch milliseconds of the originating event. */
  at: number
  /** The verb the panel renders ("warned" / "escalated"). */
  label: string
  /** Human-readable cause, with the duration folded in when the record has one. */
  cause: string
  /** The measured stall duration in milliseconds, or null when the record carries none. */
  ms: number | null
  /** The task the record names, or null. */
  taskId: string | null
  /** The attempt the record names, or null. */
  attemptId: string | null
  /** Scene pointer path for the record's team, or null. */
  scene: string | null
  /** The hold outcome as a plain string, so a panel can render it without a union. */
  hold: string
  /** The readers that have already acknowledged the originating incident. */
  acknowledgedBy: string[]
  /** Whether this record still needs an acknowledge from the requesting reader. */
  ackRequired: boolean
  /** The workspace the record was read from. */
  workspace: string
}

/** The whole payload the web panel consumes. */
export interface WatchdogStatePayload {
  /** Always true on a served payload; a failure is answered as a 500 with its own body. */
  ok: true
  /** The watermark key this payload was built for. */
  reader: string
  /** ISO instant the payload was built. */
  generatedAt: string
  /** The state directory the payload was read from. */
  stateDir: string
  /** Every root that was searched, in resolution order. */
  workspaces: string[]
  /** The first root that carried state, else the first searched root, else null. */
  workspace: string | null
  /** Whether the watchdog reports anything a reader must act on. */
  stuck: boolean
  /** Every hold sidecar found across the searched roots. */
  held: WatchdogHold[]
  /** The single banner the panel renders, or null when nothing is unread. */
  banner: WatchdogBanner | null
  /** The newest unread incidents, capped at {@link MAX_ACTIVITY_RECORDS}. */
  activity: WatchdogActivity[]
  /** Ids of every unread incident, newest first. */
  unread: string[]
  /** The per-reader watermark map, merged across the searched roots. */
  watermarks: Record<string, number>
  /** Whether this payload is a replay, i.e. whether it carries unread incidents at all. */
  replay: boolean
  /** Per-root read failures, so a panel can say why a workspace is missing. */
  errors: string[]
}

/** The narrow slice of the adapter this module needs (resolved per request, never cached). */
export interface WorkspaceResolver {
  /** Every live session workspace, or the single fallback root when none is registered. */
  workspaceRootsAll: () => string[]
  /** The one root a writer-side route should use. */
  workspaceRoot: () => string
}


/** Parse a JSON file, or undefined when it is missing, unreadable, or not a non-null object. */
function readJson<T>(path: string): T | undefined {
  try {
    /** The parsed value, returned only when it is a non-null object. */
    const parsed = JSON.parse(readFileSync(path, "utf8")) as T
    return parsed !== null && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The watchdog store directory inside one workspace. */
function watchdogDir(workspace: string, stateDir: string): string {
  return join(workspace, stateDir, "watchdog")
}

/** Every hold sidecar in one workspace, in a stable (teamId-sorted) order. */
export function readHolds(workspace: string, stateDir: string): WatchdogHold[] {
  /** The hold directory inside this workspace's watchdog store. */
  const dir = join(watchdogDir(workspace, stateDir), "hold")
  /** The directory entries; an unreadable directory means this workspace has no holds. */
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  /** The sidecars that parsed and carried the two ids the panel keys on. */
  const holds: WatchdogHold[] = []
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue
    /** One sidecar's contents, or undefined when it is unreadable or malformed. */
    const parsed = readJson<WatchdogHold>(join(dir, name))
    if (parsed !== undefined && typeof parsed.id === "string" && typeof parsed.teamId === "string") holds.push(parsed)
  }
  return holds
}

/** Every incident line (malformed lines skipped, append order preserved). */
export function readIncidents(workspace: string, stateDir: string): WatchdogIncident[] {
  /** The whole incident log; a missing file means this workspace has no incidents. */
  let text: string
  try {
    text = readFileSync(join(watchdogDir(workspace, stateDir), "incidents.jsonl"), "utf8")
  } catch {
    return []
  }
  /** The incidents that parsed, in the log's own append order. */
  const out: WatchdogIncident[] = []
  for (const raw of text.split("\n")) {
    /** One trimmed log line; blanks are skipped without ending the scan. */
    const line = raw.trim()
    if (line === "") continue
    try {
      /** One parsed line, kept only when it carries the id and timestamp the panel needs. */
      const parsed = JSON.parse(line) as WatchdogIncident
      if (parsed !== null && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.at === "number") out.push(parsed)
    } catch {
      // a torn line is skipped; the rest of the log stays readable
    }
  }
  return out
}

/** The per-reader watermark map; non-numeric entries are dropped rather than guessed. */
export function readWatermarks(workspace: string, stateDir: string): Record<string, number> {
  /** The raw watermark document, or undefined when it is unreadable or malformed. */
  const parsed = readJson<Record<string, unknown>>(join(watchdogDir(workspace, stateDir), "read-watermark.json"))
  /** Only the numeric entries survive: a reader key with any other value is dropped. */
  const out: Record<string, number> = {}
  if (parsed === undefined) return out
  for (const [reader, value] of Object.entries(parsed)) if (typeof value === "number") out[reader] = value
  return out
}

/** The scene pointer a restart reads, when the escalation wrote one. */
export function readScenePointer(workspace: string, stateDir: string, teamId: string): string | null {
  /** The pointer's conventional location, returned only when the file really exists. */
  const path = join(watchdogDir(workspace, stateDir), "scene", teamId, "latest.json")
  return existsSync(path) ? path : null
}

/** Render one incident's cause as panel text: the cause kind, plus its duration when it states one. */
function describeCause(incident: WatchdogIncident): string {
  /** The cause kind, or "unknown" when the record carries no usable cause object. */
  const kind = incident.cause !== null && typeof incident.cause === "object" ? String(incident.cause.kind) : "unknown"
  /** The cause's measured duration in milliseconds, when the record states one. */
  const ms = incident.cause !== null && typeof incident.cause === "object" ? incident.cause.ms : undefined
  return typeof ms === "number" ? `${kind} for ${ms} ms` : kind
}

/**
 * Build the payload for one reader over the roots the caller resolved. A root with no
 * watchdog directory still appears in `workspaces` (the panel can then say "nothing
 * recorded here" instead of guessing), and the FIRST root that has any state is the one
 * the payload reports in `workspace`.
 */
export function buildWatchdogState(options: {
  roots: string[]
  stateDir: string
  reader: string
  now?: () => number
}): WatchdogStatePayload {
  /** The three inputs every read below is parameterized by. */
  const { roots, stateDir, reader } = options
  /** Per-root read failures, collected so one bad root cannot hide the others. */
  const errors: string[] = []
  /** The holds merged across every root that carried state. */
  let held: WatchdogHold[] = []
  /** The incidents merged across those roots. */
  let incidents: WatchdogIncident[] = []
  /** The watermark map merged across those roots; on a key clash the earlier root wins. */
  let watermarks: Record<string, number> = {}
  /** The first root that carried any state, or null while none has. */
  let home: string | null = null

  for (const root of roots) {
    try {
      /** This root's hold sidecars. */
      const rootHolds = readHolds(root, stateDir)
      /** This root's incidents. */
      const rootIncidents = readIncidents(root, stateDir)
      /** This root's watermark map. */
      const rootWatermarks = readWatermarks(root, stateDir)
      if (rootHolds.length > 0 || rootIncidents.length > 0) {
        held = held.concat(rootHolds)
        incidents = incidents.concat(rootIncidents)
        watermarks = { ...rootWatermarks, ...watermarks }
        if (home === null) home = root
      }
    } catch (error) {
      errors.push(`${root}: ${message(error)}`)
    }
  }

  /** This reader's own watermark; an absent or non-numeric entry reads as 0, i.e. everything is unread. */
  const watermark = typeof watermarks[reader] === "number" ? watermarks[reader] : 0
  /** Every incident newer than that watermark, newest first. */
  const unreadIncidents = incidents.filter((incident) => incident.at > watermark).sort((a, b) => b.at - a.at)

  /** The newest unread incidents, mapped to the panel's record shape and capped at the payload limit. */
  const activity: WatchdogActivity[] = unreadIncidents.slice(0, MAX_ACTIVITY_RECORDS).map((incident) => ({
    id: incident.id,
    teamId: incident.teamId,
    kind: incident.kind,
    at: incident.at,
    label: incident.kind === "escalate" ? "escalated" : "warned",
    cause: describeCause(incident),
    ms: incident.cause !== null && typeof incident.cause === "object" && typeof incident.cause.ms === "number" ? incident.cause.ms : null,
    taskId: incident.taskId,
    attemptId: incident.attemptId,
    scene: incident.scene,
    hold: incident.hold,
    acknowledgedBy: Array.isArray(incident.acknowledgedBy) ? incident.acknowledgedBy : [],
    ackRequired: true,
    workspace: home ?? roots[0] ?? "",
  }))

  /** The most recent hold, used to attach a hold id to an escalation banner. */
  const newestHold = [...held].sort((a, b) => b.since - a.since)[0]
  /** The newest unread incident, which outranks a hold when both exist. */
  const newestIncident = unreadIncidents[0]
  /** The banner the panel renders, or null when nothing is unread and no hold stands. */
  let banner: WatchdogBanner | null = null
  if (newestIncident !== undefined) {
    banner = {
      kind: newestIncident.kind === "escalate" ? "held" : "warned",
      teamId: newestIncident.teamId,
      holdId: newestHold !== undefined && newestHold.teamId === newestIncident.teamId ? newestHold.id : null,
      incidentId: newestIncident.id,
      cause: describeCause(newestIncident),
      since: newestIncident.at,
      taskId: newestIncident.taskId,
      attemptId: newestIncident.attemptId,
      scene: newestIncident.scene,
      workspace: home ?? roots[0] ?? "",
    }
  } else if (newestHold !== undefined) {
    banner = {
      kind: "held",
      teamId: newestHold.teamId,
      holdId: newestHold.id,
      incidentId: null,
      cause: newestHold.cause,
      since: newestHold.since,
      taskId: newestHold.taskId,
      attemptId: newestHold.attemptId,
      scene: readScenePointer(home ?? roots[0] ?? "", stateDir, newestHold.teamId),
      workspace: home ?? roots[0] ?? "",
    }
  }

  return {
    ok: true,
    reader,
    generatedAt: new Date(options.now === undefined ? Date.now() : options.now()).toISOString(),
    stateDir,
    workspaces: [...roots],
    workspace: home ?? roots[0] ?? null,
    stuck: held.length > 0 || unreadIncidents.length > 0,
    held,
    banner,
    activity,
    unread: unreadIncidents.map((incident) => incident.id),
    watermarks,
    replay: unreadIncidents.length > 0,
    errors,
  }
}

/**
 * Advance ONE reader's watermark (the explicit acknowledge). Only that reader's key is
 * touched: the file is re-read, the key is raised to `Math.max(current, upTo)`, and the
 * result is written to a sibling temp file and renamed, so a concurrent reader's entry
 * survives and a torn write cannot be observed.
 */
export function acknowledge(options: {
  workspace: string
  stateDir: string
  reader: string
  upTo: number
}): { ok: boolean; reader: string; before: number; after: number; path: string; error?: string } {
  /** The three inputs the merge is parameterized by. */
  const { workspace, stateDir, reader } = options
  /** The watermark file this call rewrites. */
  const path = join(watchdogDir(workspace, stateDir), "read-watermark.json")
  /** The whole watermark map as it stands, so no other reader's key is lost. */
  const current = readWatermarks(workspace, stateDir)
  /** This reader's watermark before the call; 0 when it has never acknowledged. */
  const before = typeof current[reader] === "number" ? current[reader] : 0
  /** The watermark to store: never behind `before`, and never a fractional millisecond. */
  const after = Math.max(before, Math.floor(options.upTo))
  try {
    mkdirSync(dirname(path), { recursive: true })
    /** The sibling temp file the merged map is written to before the atomic rename. */
    const temp = join(dirname(path), "." + basename(path) + ".tmp-" + String(process.pid))
    writeFileSync(temp, JSON.stringify({ ...current, [reader]: after }, null, 2) + "\n", "utf8")
    renameSync(temp, path)
    return { ok: true, reader, before, after, path }
  } catch (error) {
    return { ok: false, reader, before, after: before, path, error: message(error) }
  }
}

/**
 * Register the two routes on the host's web server. The caller owns the server probe and
 * the lifetime (`ctx.effect`); this function only tolerates a server that cannot register.
 */
export function registerWatchdogRoutes(
  webServer: { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => unknown },
  deps: {
    roots: () => string[]
    stateDir: () => string
    effect: (fn: () => unknown, label: string) => unknown
  },
): { state: boolean; ack: boolean } {
  /** Answer one JSON response, using only the two response methods a route handler may rely on. */
  const json = (res: unknown, status: number, body: unknown): void => {
    /** The response, narrowed to the write surface this module uses. */
    const out = res as { writeHead: (status: number, headers: Record<string, string>) => void; end: (text: string) => void }
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    out.end(JSON.stringify(body))
  }
  /** Read and parse an acknowledge request body; anything unusable reads as an empty object. */
  const readBody = async (req: unknown): Promise<Record<string, unknown>> => {
    /** The body text accumulated from the request stream. */
    let raw = ""
    /** The request read as an async iterable of chunks. */
    const source = req as AsyncIterable<unknown>
    try {
      for await (const chunk of source) raw += String(chunk)
    } catch {
      return {}
    }
    if (raw === "") return {}
    try {
      /** The parsed body, kept only when it is a non-null object. */
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed !== null && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  }
  /** The reader named by the request's `reader` query parameter, or the caller's fallback. */
  const readerOf = (req: unknown, fallback: string): string => {
    /** The request URL, or "" when the request carries none. */
    const url = String((req as { url?: unknown }).url ?? "")
    /** Offset of the query string, or -1 when the request has none. */
    const at = url.indexOf("?")
    if (at < 0) return fallback
    /** The parsed query string, which is where the explicit reader override lives. */
    const query = new URLSearchParams(url.slice(at + 1))
    /** The raw `reader` value, or null when the parameter is absent. */
    const value = query.get("reader")
    return value !== null && value.trim() !== "" ? value.trim() : fallback
  }

  /** Whether the read-only state route was registered. */
  let state = false
  /** Whether the acknowledge route was registered. */
  let ack = false
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_STATE_PATH,
      handler: (req: unknown, res: unknown) => {
        try {
          /** The payload for the reader this request names, over the roots resolved right now. */
          const payload = buildWatchdogState({
            roots: deps.roots(),
            stateDir: deps.stateDir(),
            reader: readerOf(req, WATCHDOG_WEB_READER),
          })
          json(res, 200, payload)
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${message(error)})` })
        }
      },
    }), "mpd-team-watchdog: web state route")
    state = true
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_ACK_PATH,
      handler: async (req: unknown, res: unknown) => {
        try {
          /** The POST body, when the caller sent one. */
          const body = await readBody(req)
          /** The reader to advance: the body's own field first, then the query parameter, then the web key. */
          const reader = typeof body.reader === "string" && body.reader.trim() !== "" ? body.reader.trim() : readerOf(req, WATCHDOG_WEB_READER)
          /** The roots to look for incidents under, resolved per request. */
          const roots = deps.roots()
          /** The state directory those roots are read with, resolved per request. */
          const stateDir = deps.stateDir()
          /** The explicit incident timestamp the caller acknowledged, when it sent one. */
          const requested = typeof body.incidentTs === "number" ? body.incidentTs : undefined
          /** The watermark to store: the explicit timestamp, else the newest incident found anywhere. */
          const upTo = requested ?? Math.max(0, ...roots.flatMap((root) => readIncidents(root, stateDir).map((incident) => incident.at)))
          /** The workspace whose watermark file is rewritten: the body's own field, else the first root. */
          const target = typeof body.workspace === "string" && body.workspace !== "" ? String(body.workspace) : roots[0] ?? ""
          /** What the merge did, echoed back so a client can show the before/after pair. */
          const result = acknowledge({ workspace: target, stateDir, reader, upTo })
          json(res, result.ok ? 200 : 500, result)
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${message(error)})` })
        }
      },
    }), "mpd-team-watchdog: web acknowledge route")
    ack = true
  } catch {
    // A server that cannot register is not fatal: the panel then shows no banner.
  }
  return { state, ack }
}
