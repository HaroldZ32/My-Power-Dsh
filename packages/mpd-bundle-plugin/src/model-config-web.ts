// The Web settings card reads effective routes here and saves only the selected session's
// workspace model fields. Workspace resolution and JSONC updates stay in their owning services.
import { Buffer } from "node:buffer"
/** The exact-path route this module owns (the path the settings card fetches). */
export const MODEL_CONFIG_PATH = "/plugins/mpd/model-config"

/**
 * The eleven roster display names, in the four groups' declared order — a MIRROR of
 * `TEAM_MODEL_SLOT_GROUPS`'s member lists in `mpd-config-plugin/src/settings-schema.ts`.
 *
 * The route does not import that declaration (this package's server half stays dependency-free: the
 * bundled `dist/index.js` would inline the whole config schema for eleven strings), so the list is
 * mirrored here and a test pins it against the shared declaration. The four groups are DISPLAY-only
 * (contract §7): the route neither knows nor serves any persisted slot.
 */
export const ROSTER_MEMBERS: readonly string[] = [
  "Architect",
  "Planner",
  "Reviewer",
  "Lead",
  "Senior Engineer",
  "Researcher",
  "Explorer",
  "Plan Reviewer",
  "Deep Worker",
  "Junior Engineer",
  "Vision Analyst",
]

/** Editable route fields accepted from the settings card. */
const EDITABLE_LEAVES = ["provider", "model", "reasoningEffort"] as const

/** A single edit of a project file's route selection. */
interface RouteEdit {
  /** Roster display name checked at the HTTP boundary. */
  readonly agent: string
  /** The card field that was edited. */
  readonly leaf: (typeof EDITABLE_LEAVES)[number]
  /** Omitted to remove the project value and inherit from the remaining layers. */
  readonly value?: string
}

/** The config service operations used by the authenticated Web route. */
export interface ConfigServiceLike {
  /** Read a resolved config key for a workspace, or use the legacy unscoped form. */
  get?: (key?: string, workspace?: string) => unknown
  /** Resolve one roster route for the indicated workspace. */
  agentRouteResolutionOf?: (member: string, workspace?: string) => unknown
  /** Effective and workspace-file values for the model controls. */
  workspaceAgentRoutes?: (workspace: string) => unknown
  /** Apply the entire set of route field edits to one workspace. */
  editWorkspaceAgentRoutes?: (workspace: string, edits: readonly RouteEdit[]) => { ok: true } | { ok: false; reason: string }
}

/** The route body when the read succeeded. */
interface ModelConfigOk {
  /** The success marker the card's projection keys on. */
  ok: true
  /** One typed route resolution per roster member, keyed by display name — never an empty table. */
  agents: Record<string, unknown>
  /** The configured `modelchain` chains ({} when none are). */
  modelchain: unknown
  /** The selected workspace's editable values, when this request has a session. */
  workspaceRoutes?: unknown
}

/** The route body when the service could not answer. */
interface ModelConfigUnavailable {
  /** The failure marker the card's projection keys on. */
  ok: false
  /** Why the read is unavailable — the sentence the card renders as its notice. */
  reason: string
}

/**
 * Build the route body from the live config service, read PER REQUEST so the answer always
 * reflects the service's CURRENT state (L1's watcher and entry-config subscription refresh it —
 * a save made seconds ago is what this route serves next).
 * @param config - the `mpdConfig` service, or undefined when the row is not composed.
 * @param workspace - the named session's resolved root when the request addresses one.
 * @returns the JSON body: one typed resolution per roster agent plus the chains, or the refusal reason.
 */
export function buildModelConfigBody(config: ConfigServiceLike | undefined, workspace?: string): ModelConfigOk | ModelConfigUnavailable {
  if (config === undefined || config === null) {
    return { ok: false, reason: "the mpdConfig service is not composed in this profile" }
  }
  if (typeof config.agentRouteResolutionOf !== "function") {
    return { ok: false, reason: "the mpdConfig service exposes no per-agent route resolver (agentRouteResolutionOf)" }
  }
  if (workspace !== undefined && typeof config.workspaceAgentRoutes !== "function") {
    return { ok: false, reason: "the config service cannot read a specific workspace" }
  }
  try {
    /** One typed resolution per roster member, in the declared roster order. */
    const agents: Record<string, unknown> = {}
    for (const member of ROSTER_MEMBERS) agents[member] = config.agentRouteResolutionOf(member, workspace)
    return {
      ok: true,
      agents,
      modelchain: config.get?.("modelchain", workspace) ?? {},
      ...(workspace === undefined ? {} : { workspaceRoutes: config.workspaceAgentRoutes?.(workspace) }),
    }
  } catch (error) {
    return { ok: false, reason: `the config read threw (${String((error as { message?: unknown })?.message ?? error)})` }
  }
}

/** The outcome of parsing the card's bounded JSON request. */
type RouteEdits = { ok: true; edits: RouteEdit[] } | { ok: false; status: 400 | 413; reason: string }

/** Decode only the three roster fields the settings card can change. */
async function readEdits(request: Partial<AsyncIterable<unknown>>): Promise<RouteEdits> {
  /** Response shared by malformed bodies and unsupported edit shapes. */
  const bad = { ok: false, status: 400, reason: "Expected JSON edits for roster provider, model or reasoning effort fields." } as const
  if (typeof request[Symbol.asyncIterator] !== "function") return bad
  /** Input chunks kept as bytes until decoding, including split multibyte characters. */
  const parts: Buffer[] = []
  /** Total encoded length, limited before allocating the joined body. */
  let size = 0
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) return bad
    /** The chunk as bytes accepted by the HTTP server. */
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 16 * 1024) return { ok: false, status: 413, reason: "The route edit request exceeds 16 KiB." }
    parts.push(bytes)
  }
  /** JSON from the joined body, narrowed before the config service sees it. */
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(parts).toString("utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) return bad
    throw error
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > ROSTER_MEMBERS.length * EDITABLE_LEAVES.length) return bad
  /** Validated operations in the order the browser staged them. */
  const edits: RouteEdit[] = []
  for (const raw of parsed) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return bad
    /** HTTP fields accessed only after confirming the object shape. */
    const { agent, leaf, value } = raw as Record<string, unknown>
    /** The supported leaf matching the incoming string, if present. */
    const field = EDITABLE_LEAVES.find((candidate) => candidate === leaf)
    if (typeof agent !== "string" || !ROSTER_MEMBERS.includes(agent) || field === undefined || (value !== undefined && (typeof value !== "string" || value.trim() === ""))) return bad
    edits.push({ agent, leaf: field, value })
  }
  return { ok: true, edits }
}

/** The route's dependencies, all resolved at request time. */
interface RouteDependencies {
  /** The latest config service, which can mount after the Web bundle. */
  config: () => ConfigServiceLike | undefined
  /** Workspace bound to a named live session by the harness. */
  workspace?: (sessionId: string) => string | undefined
  /** Distinct live roots, used to refuse ambiguous legacy requests without a session. */
  roots?: () => readonly string[]
  /** The host's browser/API authentication and request-origin fence. */
  authorize?: (request: unknown) => 401 | 403 | undefined
  /** Own the registration for the lifetime of the bundle row. */
  effect: (fn: () => unknown, label: string) => unknown
}

/** Register both methods on the exact model-config path. */
export function registerModelConfigRoute(
  webServer: { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => unknown },
  deps: RouteDependencies,
): boolean {
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: MODEL_CONFIG_PATH,
      handler: async (request: unknown, response: unknown): Promise<void> => {
        /** The handler's Node response surface. */
        const out = response as { writeHead: (status: number, headers: Record<string, string>) => void; end: (text: string) => void }
        /** Responses share the cache policy, including replies to an invalid session. */
        const send = (status: number, body: ModelConfigOk | ModelConfigUnavailable): void => {
          out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(status === 405 ? { allow: "GET, POST" } : {}) })
          out.end(JSON.stringify(body))
        }
        try {
          /** The Node request carries routing metadata and streams a body for POST. */
          const req = request as ({ method?: string; url?: string } & Partial<AsyncIterable<unknown>>) | undefined
          /** Absent method is supported by the legacy registration doubles. */
          const method = req?.method ?? "GET"
          if (method !== "GET" && method !== "POST") return send(405, { ok: false, reason: "Use GET to read or POST to edit model config." })
          /** Decoded session parameters, with duplicates treated as ambiguous. */
          const sessions = new URL(req?.url ?? MODEL_CONFIG_PATH, "http://localhost").searchParams.getAll("sessionId")
          if (sessions.length > 1 || sessions[0]?.trim() === "") return send(400, { ok: false, reason: "The request must name one valid session." })
          /** Legacy read clients may omit a session when the host has at most one workspace. */
          const session = sessions[0]
          if (method === "POST" || session !== undefined) {
            /** A host without the auth seam cannot admit a scoped request. */
            const rejection = deps.authorize === undefined ? 401 : deps.authorize(request)
            if (rejection !== undefined) return send(rejection, { ok: false, reason: "The host did not authorize access to the session's model config." })
          }
          if (session === undefined && (method === "POST" || new Set(deps.roots?.()).size > 1)) {
            return send(409, { ok: false, reason: "Select a live session to identify the workspace." })
          }
          /** A named session must resolve directly, even when there is only one other workspace. */
          const workspace = session === undefined ? undefined : deps.workspace?.(session)
          if (session !== undefined && !workspace) return send(409, { ok: false, reason: "The named session has no live workspace." })
          /** The config service may bind or change between requests. */
          const config = deps.config()
          if (method === "POST" && req !== undefined && session !== undefined && workspace !== undefined) {
            if (typeof config?.editWorkspaceAgentRoutes !== "function") return send(503, { ok: false, reason: "The config service cannot edit workspace model routes." })
            /** The bounded set of workspace model edits from the browser. */
            const body = await readEdits(req)
            if (!body.ok) return send(body.status, { ok: false, reason: body.reason })
            if (deps.workspace?.(session) !== workspace) return send(409, { ok: false, reason: "The session's workspace changed while reading the edit." })
            /** The file writer's result, before reading back the applied config. */
            const result = config.editWorkspaceAgentRoutes(workspace, body.edits)
            if (!result.ok) return send(409, result)
          }
          /** Read the same workspace whether serving GET or returning the result of a save. */
          const body = buildModelConfigBody(config, workspace)
          send(body.ok ? 200 : 503, body)
        } catch {
          send(500, { ok: false, reason: "Could not complete the model config request." })
        }
      },
    }), "mpd-bundle: model-config web route")
    return true
  } catch {
    return false
  }
}
