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

/** The exact-path routes this module owns. */
export const WATCHDOG_STATE_PATH = "/plugins/mpd-team-watchdog/state"
export const WATCHDOG_ACK_PATH = "/plugins/mpd-team-watchdog/ack"
/** The web reader's stable watermark key (recorded in the evidence; keep it stable). */
export const WATCHDOG_WEB_READER = "web-panel"
/** The adopted plugin's default team state directory (the watchdog row's default too). */
export const DEFAULT_TEAM_STATE_DIR = join(".mpd", "team")
/** At most this many unread incidents are shipped in one payload (newest first). */
export const MAX_ACTIVITY_RECORDS = 20

/** One durable hold, as the sidecar stores it. */
export interface WatchdogHold {
  id: string
  teamId: string
  since: number
  cause: string
  taskId: string | null
  attemptId: string | null
  sceneAt: number
}

/** One incident, as incidents.jsonl stores it. */
export interface WatchdogIncident {
  id: string
  teamId: string
  kind: "warn" | "escalate"
  at: number
  cause: { kind: string; ms: number }
  taskId: string | null
  attemptId: string | null
  scene: string | null
  hold: "applied" | "not-applied" | "not-requested"
  acknowledgedBy: string[]
}

/** The banner the panel renders at the TOP: either the hold or the newest unread incident. */
export interface WatchdogBanner {
  kind: "held" | "escalated" | "warned"
  teamId: string
  holdId: string | null
  incidentId: string | null
  cause: string
  since: number
  taskId: string | null
  attemptId: string | null
  scene: string | null
  workspace: string
}

/** One activity record, derived from an incident (or from a hold with no incident). */
export interface WatchdogActivity {
  id: string
  teamId: string
  kind: "warn" | "escalate" | "hold"
  at: number
  label: string
  cause: string
  ms: number | null
  taskId: string | null
  attemptId: string | null
  scene: string | null
  hold: string
  acknowledgedBy: string[]
  ackRequired: boolean
  workspace: string
}

/** The whole payload the web panel consumes. */
export interface WatchdogStatePayload {
  ok: true
  reader: string
  generatedAt: string
  stateDir: string
  workspaces: string[]
  workspace: string | null
  stuck: boolean
  held: WatchdogHold[]
  banner: WatchdogBanner | null
  activity: WatchdogActivity[]
  unread: string[]
  watermarks: Record<string, number>
  replay: boolean
  errors: string[]
}

/** The narrow slice of the adapter this module needs (resolved per request, never cached). */
export interface WorkspaceResolver {
  workspaceRootsAll: () => string[]
  workspaceRoot: () => string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readJson<T>(path: string): T | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as T
    return parsed !== null && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

function watchdogDir(workspace: string, stateDir: string): string {
  return join(workspace, stateDir, "watchdog")
}

/** Every hold sidecar in one workspace, in a stable (teamId-sorted) order. */
export function readHolds(workspace: string, stateDir: string): WatchdogHold[] {
  const dir = join(watchdogDir(workspace, stateDir), "hold")
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const holds: WatchdogHold[] = []
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json")) continue
    const parsed = readJson<WatchdogHold>(join(dir, name))
    if (parsed !== undefined && typeof parsed.id === "string" && typeof parsed.teamId === "string") holds.push(parsed)
  }
  return holds
}

/** Every incident line (malformed lines skipped, append order preserved). */
export function readIncidents(workspace: string, stateDir: string): WatchdogIncident[] {
  let text: string
  try {
    text = readFileSync(join(watchdogDir(workspace, stateDir), "incidents.jsonl"), "utf8")
  } catch {
    return []
  }
  const out: WatchdogIncident[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (line === "") continue
    try {
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
  const parsed = readJson<Record<string, unknown>>(join(watchdogDir(workspace, stateDir), "read-watermark.json"))
  const out: Record<string, number> = {}
  if (parsed === undefined) return out
  for (const [reader, value] of Object.entries(parsed)) if (typeof value === "number") out[reader] = value
  return out
}

/** The scene pointer a restart reads, when the escalation wrote one. */
export function readScenePointer(workspace: string, stateDir: string, teamId: string): string | null {
  const path = join(watchdogDir(workspace, stateDir), "scene", teamId, "latest.json")
  return existsSync(path) ? path : null
}

function describeCause(incident: WatchdogIncident): string {
  const kind = incident.cause !== null && typeof incident.cause === "object" ? String(incident.cause.kind) : "unknown"
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
  const { roots, stateDir, reader } = options
  const errors: string[] = []
  let held: WatchdogHold[] = []
  let incidents: WatchdogIncident[] = []
  let watermarks: Record<string, number> = {}
  let home: string | null = null

  for (const root of roots) {
    try {
      const rootHolds = readHolds(root, stateDir)
      const rootIncidents = readIncidents(root, stateDir)
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

  const watermark = typeof watermarks[reader] === "number" ? watermarks[reader] : 0
  const unreadIncidents = incidents.filter((incident) => incident.at > watermark).sort((a, b) => b.at - a.at)

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

  const newestHold = [...held].sort((a, b) => b.since - a.since)[0]
  const newestIncident = unreadIncidents[0]
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
  const { workspace, stateDir, reader } = options
  const path = join(watchdogDir(workspace, stateDir), "read-watermark.json")
  const current = readWatermarks(workspace, stateDir)
  const before = typeof current[reader] === "number" ? current[reader] : 0
  const after = Math.max(before, Math.floor(options.upTo))
  try {
    mkdirSync(dirname(path), { recursive: true })
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
  const json = (res: unknown, status: number, body: unknown): void => {
    const out = res as { writeHead: (status: number, headers: Record<string, string>) => void; end: (text: string) => void }
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    out.end(JSON.stringify(body))
  }
  const readBody = async (req: unknown): Promise<Record<string, unknown>> => {
    let raw = ""
    const source = req as AsyncIterable<unknown>
    try {
      for await (const chunk of source) raw += String(chunk)
    } catch {
      return {}
    }
    if (raw === "") return {}
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed !== null && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  }
  const readerOf = (req: unknown, fallback: string): string => {
    const url = String((req as { url?: unknown }).url ?? "")
    const at = url.indexOf("?")
    if (at < 0) return fallback
    const query = new URLSearchParams(url.slice(at + 1))
    const value = query.get("reader")
    return value !== null && value.trim() !== "" ? value.trim() : fallback
  }

  let state = false
  let ack = false
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_STATE_PATH,
      handler: (req: unknown, res: unknown) => {
        try {
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
          const body = await readBody(req)
          const reader = typeof body.reader === "string" && body.reader.trim() !== "" ? body.reader.trim() : readerOf(req, WATCHDOG_WEB_READER)
          const roots = deps.roots()
          const stateDir = deps.stateDir()
          const requested = typeof body.incidentTs === "number" ? body.incidentTs : undefined
          const upTo = requested ?? Math.max(0, ...roots.flatMap((root) => readIncidents(root, stateDir).map((incident) => incident.at)))
          const target = typeof body.workspace === "string" && body.workspace !== "" ? String(body.workspace) : roots[0] ?? ""
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
