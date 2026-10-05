// C8 mpd-goal-plugin: the persisted GOAL as the durable basis of continuous execution.
//
// WHY THIS ROW EXISTS. The harness already ships the whole goal domain — `@deepseek-ai/dsh-goal`
// (the per-session state machine), `@deepseek-ai/dsh-tool-goal` (`get_goal` / `create_goal` /
// `update_goal`) and `@deepseek-ai/dsh-goal-round-driver` (the automatic continuation rounds) — and
// the `mpd` preset mounts the tool and command rows. What NO row did is INVOKE them: a long mpd run
// (a heavy ULW run, a plan-bound boulder work) finished inside one turn and left nothing durable
// for the driver to continue, so "keep going until it is done" depended on the user typing again.
//
// This row closes that gap in two halves, both routed through the adapter's goal seam so the
// harness's own authorisation keeps applying:
//   · three tools (`mpd_goal_status` / `mpd_goal_anchor` / `mpd_goal_finish`) plus the `mpdGoal`
//     service, which other mpd rows consume;
//   · the AUTO-ANCHOR contract: `mpd-ulw` and `mpd-boulder` call `mpdGoal.anchor(...)` when a
//     long run starts and `mpdGoal.finish(...)` when it ends, so the goal — not the turn — is the
//     basis of record (see `goal.autoAnchor` below).
//
// POLICY STAYS THE HARNESS'S. Every mutation goes through the goal TOOLS, never the service: the
// tools require a direct human turn for create/edit/pause/resume and the configured consecutive
// round count for `blocked`. A row that wrote `ctx.goals` directly could arm a goal the model
// itself could not, so this plugin deliberately cannot.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  DSH_SEAM_TOOLS,
  dshSeamInject,
  resolveDshAdapter,
  textBlock,
  type DshAdapter,
  type DshGoalSnapshot,
  type DshToolExec,
} from "../../mpd-dsh-adapter-plugin/src/index"

/** Cordis plugin name of this row; the loader keys the mounted instance on it. */
export const name = "mpd-goal"
/** Harness services required before `apply` runs: only the tool registrar, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the cordis context this plugin uses: the registrar, the optional service lookup. */
type Ctx = { tools: any; get?: (key: string) => any; provide?: (name: string, value: unknown) => void }

/** Row config for this plugin; every key is also readable from the mpd.jsonc `goal` block, which wins. */
interface Config {
  /** Master switch for the row's tools and for the `mpdGoal` service; `false` makes both inert. */
  enabled?: boolean
  /** Whether a long run (ULW/boulder) anchors a goal by itself, or only an explicit tool call does. */
  autoAnchor?: boolean
  /** Round cap an AUTO-anchored goal is created with; an explicit `mpd_goal_anchor` may override it. */
  autoRounds?: number
}

/** The L0 defaults, mirrored in the row config and in `docs/`: one literal, three layers cannot drift. */
export const GOAL_DEFAULTS = { enabled: true, autoAnchor: true, autoRounds: 32 } as const

/** One durable anchor: which goal the plugin armed for a session, and for which run. */
export interface GoalAnchor {
  /** The goal id this plugin created, as the harness reported it. */
  goalId: string
  /** The revision at creation time; informational, because updates re-read the live revision. */
  revision: number
  /** The objective the anchor was created with. */
  objective: string
  /** Which row asked for the anchor (`ulw`, `boulder`, or `tool`). */
  source: string
  /** ISO timestamp of the creation, for the sidecar's own readability. */
  at: string
}

/** One anchor outcome, as the tools and the `mpdGoal` service report it. */
export interface GoalAnchorOutcome {
  /** Whether a goal is in place after the call (created now, or already current). */
  ok: boolean
  /** Whether THIS call created the goal; false means an unfinished goal was already current. */
  created: boolean
  /** The goal in place after the call, when the harness reported one. */
  goal?: DshGoalSnapshot | null
  /** Why the call could not put a goal in place; absent on success. */
  error?: string
  /** A human-readable note about a non-obvious outcome (an existing goal was kept, a policy refusal). */
  note?: string
}

/** One finish outcome, as the tools and the `mpdGoal` service report it. */
export interface GoalFinishOutcome {
  /** Whether the harness admitted the terminal transition. */
  ok: boolean
  /** The transition that was attempted. */
  outcome: "complete" | "blocked"
  /** The goal after the call, when the harness reported one. */
  goal?: DshGoalSnapshot | null
  /** Why the transition was refused (a policy refusal, no current goal, a missing seam). */
  error?: string
}

/** The `mpdGoal` service this row provides; ULW and boulder consume exactly this surface. */
export interface MpdGoalService {
  /** Whether the row is enabled and the harness goal surface is reachable. */
  available(): boolean
  /** Whether long runs anchor a goal by themselves. */
  autoAnchor(): boolean
  /** Read the calling session's current goal, or `undefined` when the composition cannot tell. */
  status(exec?: unknown): Promise<DshGoalSnapshot | null | undefined>
  /** Put a durable goal in place for a long run, keeping any unfinished goal already current. */
  anchor(exec: unknown, input: { objective: string; source: string; maxRounds?: number }): Promise<GoalAnchorOutcome>
  /** Finish a goal this plugin ANCHORED; a goal it did not anchor is left to the model and the user. */
  finish(exec: unknown, input: { outcome: "complete" | "blocked"; source: string; reason?: string }): Promise<GoalFinishOutcome>
}

/** Merge the row config with the mpd.jsonc runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Required<Config> {
  // The mpdConfig service, present only when mpd-config-plugin is mounted in the same composition.
  const svc = ctx.get?.("mpdConfig") as { get: (key?: string) => any } | undefined
  /** Whether a keyed read is available at all; without it only the row config applies. */
  const read = (key: string): unknown => (svc?.get ? svc.get(key) : undefined)
  /** The configured master switch, accepted only as a boolean. */
  const enabled = read("goal.enabled")
  /** The configured auto-anchor switch, accepted only as a boolean. */
  const autoAnchor = read("goal.autoAnchor")
  /** The configured auto round cap, accepted only as a positive safe integer. */
  const autoRounds = read("goal.autoRounds")
  return {
    enabled: typeof enabled === "boolean" ? enabled : config.enabled ?? GOAL_DEFAULTS.enabled,
    autoAnchor: typeof autoAnchor === "boolean" ? autoAnchor : config.autoAnchor ?? GOAL_DEFAULTS.autoAnchor,
    autoRounds: safeRounds(autoRounds) ?? safeRounds(config.autoRounds) ?? GOAL_DEFAULTS.autoRounds,
  }
}

/**
 * Accept one round cap only when it is a usable positive safe integer.
 * @param value - the configured value, of any type.
 * @returns the value, or undefined when the configuration is unusable.
 */
function safeRounds(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined
}

/** The session key one exec belongs to; the sidecar is keyed by it, so two sessions never share an anchor. */
function sessionKeyOf(exec: unknown): string {
  /** The calling agent's session, read from the exec payload rather than from a service. */
  const session = (exec as { agent?: { session?: { id?: unknown } } } | undefined)?.agent?.session
  return typeof session?.id === "string" && session.id !== "" ? session.id : "unkeyed"
}

/** The anchor sidecar path under one state root. */
export function anchorsPath(root: string): string {
  return join(root, ".mpd", "goal", "anchors.json")
}

/** Read the anchor sidecar; a missing, unreadable or malformed file reads as "no anchors". */
export function readAnchors(file: string): Record<string, GoalAnchor> {
  try {
    if (!existsSync(file)) return {}
    /** The parsed document, validated member by member because this file is hand-editable state. */
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    if (parsed === null || typeof parsed !== "object") return {}
    /** The validated map: only entries with a string goal id survive. */
    const out: Record<string, GoalAnchor> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      /** One candidate record, judged field by field. */
      const record = value as Partial<GoalAnchor> | undefined
      if (record === undefined || typeof record.goalId !== "string" || record.goalId === "") continue
      out[key] = {
        goalId: record.goalId,
        revision: typeof record.revision === "number" ? record.revision : 0,
        objective: typeof record.objective === "string" ? record.objective : "",
        source: typeof record.source === "string" ? record.source : "unknown",
        at: typeof record.at === "string" ? record.at : "",
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Write the anchor sidecar atomically (temp file + rename), never leaving a half-written document. */
export function writeAnchors(file: string, anchors: Record<string, GoalAnchor>): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true })
    // A UNIQUE scratch sibling per writer: two sessions anchoring at the same moment must not share
    // one temp path, or the rename could publish a document the other writer is still filling.
    /** The scratch sibling the rename publishes; same directory, so the rename stays atomic. */
    const scratch = file + "." + String(process.pid) + "." + Math.random().toString(36).slice(2, 8) + ".tmp"
    writeFileSync(scratch, JSON.stringify(anchors, null, 2) + "\n")
    renameSync(scratch, file)
    return true
  } catch {
    // A sidecar that cannot be written costs durability of OWNERSHIP only: the goal itself lives in
    // the session log, so the run must never fail because a bookkeeping file did. The CALLER decides
    // how loud that is — `anchor` reports it as a note and a row-log line rather than swallowing it.
    return false
  }
}

/** Remove one session's anchor record, returning the map that was written. */
export function dropAnchor(file: string, sessionKey: string): Record<string, GoalAnchor> {
  /** The current map, re-read so a concurrent session's record is not clobbered. */
  const anchors = readAnchors(file)
  if (!(sessionKey in anchors)) return anchors
  delete anchors[sessionKey]
  writeAnchors(file, anchors)
  return anchors
}

/** Register the goal bridge: the `mpdGoal` service, its three tools and the auto-anchor contract. */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: DshAdapter = resolveDshAdapter(ctx)
  // Effective config for this apply: the row config with the mpd.jsonc `goal` block layered over it.
  const cfg = mergedConfig(ctx, config)
  // Per-call state root: the calling session's workspace (never the dsh process cwd).
  const rootOf = (exec?: unknown): string => dsh.workspaceRoot(exec as DshToolExec | undefined)
  // One boot line, so a mounted row is visible in the workspace log even when it stays inert.
  dsh.rowLog("mpd-goal", "mounted: enabled=" + String(cfg.enabled) + " autoAnchor=" + String(cfg.autoAnchor) + " autoRounds=" + String(cfg.autoRounds))

  /**
   * Read the calling session's current goal, preferring the durable service read.
   * @param exec - the tool exec (or any object carrying the calling agent).
   * @returns the goal, `null` when the session has none, `undefined` when this composition cannot tell.
   */
  async function readGoal(exec: unknown): Promise<DshGoalSnapshot | null | undefined> {
    /** The agent the goal belongs to. */
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    /** The service read, which is cheap and never mutates; `undefined` means "cannot tell". */
    const direct = dsh.goalState(agent)
    if (direct !== undefined) return direct
    if (!enabled()) return undefined
    /** The tool read, the second half of the same question; it authenticates the calling agent. */
    const viaTool = await dsh.goalControl({ agent, action: "read", signal: (exec as { signal?: AbortSignal } | undefined)?.signal })
    return viaTool.ok ? viaTool.goal ?? null : undefined
  }

  /** Whether the row may act at all: enabled, and a goal path exists (service or tools). */
  function enabled(): boolean {
    if (!cfg.enabled) return false
    /** The adapter's own degradation contract, sampled per call so a late row is not frozen out. */
    const caps = dsh.capabilities()
    return caps.goals || caps.goalTools
  }

  /**
   * Put a durable goal in place for one long run.
   * @param exec - the tool exec that carries the calling agent.
   * @param input - the objective, the requesting row, and an optional round cap.
   * @returns the outcome; an unfinished goal already current is KEPT, never replaced.
   */
  async function anchor(exec: unknown, input: { objective: string; source: string; maxRounds?: number }): Promise<GoalAnchorOutcome> {
    if (!cfg.enabled) return { ok: false, created: false, error: "mpd-goal is disabled (goal.enabled=false)" }
    if (!dsh.capabilities().goalTools) return { ok: false, created: false, error: "the goal tools are not mounted in this composition" }
    /** The objective as given; an empty one is refused before any state is touched. */
    const objective = typeof input?.objective === "string" ? input.objective.trim() : ""
    if (objective === "") return { ok: false, created: false, error: "mpd_goal_anchor: objective required" }
    /** The calling agent, forwarded verbatim: the goal tools authenticate the exact live instance. */
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    /** The goal already current, if any. */
    const current = await readGoal(exec)
    if (current !== null && current !== undefined && current.phase !== "complete") {
      // ONE GOAL PER SESSION is the harness's rule, and replacing an unfinished one is not a
      // transition it offers: keeping it is the honest answer, and the caller reads `created:false`.
      return { ok: true, created: false, goal: current, note: "an unfinished goal is already current; it was kept" }
    }
    /** The round cap: the caller's, else the configured auto cap. */
    const maxGoalRounds = Number.isSafeInteger(input?.maxRounds) && (input.maxRounds as number) > 0 ? (input.maxRounds as number) : cfg.autoRounds
    /** The harness's answer for the create. */
    const created = await dsh.goalControl({
      agent,
      action: "create",
      objective,
      maxGoalRounds,
      signal: (exec as { signal?: AbortSignal } | undefined)?.signal,
    })
    if (!created.ok) return { ok: false, created: false, error: String(created.error ?? "the goal could not be created") }
    /** The goal the harness reported after the create. */
    const goal = created.goal ?? null
    /** Why the ownership record could not be written; empty when it was. */
    let ownershipProblem = goal === null ? "the harness reported no goal after the create" : ""
    if (goal !== null) {
      /** The sidecar path for the calling workspace. */
      const file = anchorsPath(rootOf(exec))
      /** The sidecar with this session's record added. */
      const anchors = readAnchors(file)
      anchors[sessionKeyOf(exec)] = { goalId: goal.id, revision: goal.revision, objective: goal.objective, source: String(input?.source ?? "unknown"), at: new Date().toISOString() }
      if (!writeAnchors(file, anchors)) {
        // LOUD, never silent: the goal EXISTS and must not be reported as a failure (a retry would be
        // refused with "a goal is already current"), but an anchor nobody recorded leaves a goal the
        // round driver keeps continuing while no run can auto-finish it — so the note and the row log
        // both say exactly that, and the caller can still close it with `mpd_goal_finish`.
        ownershipProblem = "the ownership record could not be written to " + file
      }
    }
    if (ownershipProblem !== "") dsh.rowLog("mpd-goal", "anchor " + String(goal?.id ?? "?") + " has no ownership record: " + ownershipProblem)
    return { ok: true, created: true, goal, ...(ownershipProblem === "" ? {} : { note: ownershipProblem + "; mpd-goal cannot auto-finish this goal — close it with mpd_goal_finish" }) }
  }

  /**
   * Finish a goal, but only one THIS row anchored (unless the caller marked it explicit).
   * @param exec - the tool exec that carries the calling agent.
   * @param input - the outcome, the requesting row, an optional blocked reason, and the ownership flag.
   * @returns the outcome; a harness policy refusal comes back as `ok:false` with the harness's own text.
   */
  async function finish(exec: unknown, input: { outcome: "complete" | "blocked"; source: string; reason?: string; explicit?: boolean }): Promise<GoalFinishOutcome> {
    /** The transition requested; anything else is read as `complete`. */
    const outcome = input?.outcome === "blocked" ? "blocked" : "complete"
    if (!cfg.enabled) return { ok: false, outcome, error: "mpd-goal is disabled (goal.enabled=false)" }
    /** The sidecar path for the calling workspace. */
    const file = anchorsPath(rootOf(exec))
    /** This session's anchor record, when the plugin armed one. */
    const record = readAnchors(file)[sessionKeyOf(exec)]
    if (input?.explicit !== true && record === undefined) {
      return { ok: false, outcome, error: "this session's goal was not anchored by mpd-goal; leaving it to the model and the user" }
    }
    /** The calling agent, forwarded verbatim. */
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    /** The current goal, read for the exact revision the CAS requires. */
    const current = await readGoal(exec)
    if (current === null || current === undefined) return { ok: false, outcome, error: "no current goal" }
    if (input?.explicit !== true && record !== undefined && record.goalId !== current.id) {
      return { ok: false, outcome, error: "the current goal is not the one mpd-goal anchored; leaving it in place" }
    }
    // OWNERSHIP IS PER RUN, not merely per session: a boulder work must not complete the goal a ULW
    // run anchored (the harness allows one goal per session, so the second run inherits the first's
    // goal and would otherwise close an objective it never carried). The refusal is reported, and the
    // owner's own finish still works.
    if (input?.explicit !== true && record !== undefined && record.source !== input.source) {
      return { ok: false, outcome, error: "the current goal is anchored by \"" + record.source + "\", not \"" + String(input.source) + "\"; leaving it to its owner" }
    }
    /** The harness's answer for the terminal transition. */
    const done = await dsh.goalControl({
      agent,
      action: outcome,
      goalId: current.id,
      revision: current.revision,
      ...(outcome === "blocked" ? { blockedReason: String(input?.reason ?? "mpd-goal: the run reported a blocker") } : {}),
      signal: (exec as { signal?: AbortSignal } | undefined)?.signal,
    })
    if (!done.ok) return { ok: false, outcome, error: String(done.error ?? "the goal could not be finished") }
    // The anchor is spent once the goal is terminal: dropping it is what keeps a LATER run free to
    // anchor a new goal, and it is why `dropAnchor` re-reads the map before writing.
    dropAnchor(file, sessionKeyOf(exec))
    return { ok: true, outcome, goal: done.goal ?? null }
  }

  // ── the service other mpd rows consume ─────────────────────────────────────
  // Registered through `provide` when the ctx exposes it (a unit-test double may not), and always
  // optional for the CALLER: a composition without this row leaves ULW/boulder with `undefined`,
  // and those rows degrade to "no durable goal" instead of failing.
  ctx.provide?.("mpdGoal", {
    available: () => enabled(),
    autoAnchor: () => cfg.enabled && cfg.autoAnchor,
    status: (exec?: unknown) => readGoal(exec),
    anchor,
    finish,
  } satisfies MpdGoalService)

  // ── tools ──────────────────────────────────────────────────────────────────
  dsh.registerTool({
    name: "mpd_goal_status",
    description: "Read the calling session's persisted goal — the durable basis of continuous execution: id, revision, objective, phase, rounds used, round cap, activation and whether mpd-goal anchored it. Reads the harness goal service and needs no driver.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: { type: "object", properties: { goal: { type: "object" }, anchored: { type: "object" }, enabled: { type: "boolean" }, autoAnchor: { type: "boolean" } }, required: ["enabled"] },
      render: (_a: unknown, v: any) => textBlock("mpd goal: " + (v.goal ? JSON.stringify(v.goal) : "none") + " (enabled=" + String(v.enabled) + ", autoAnchor=" + String(v.autoAnchor) + ")"),
    },
    execute: async (_args: unknown, exec: any) => {
      /** The current goal as the harness reports it; `undefined` means this composition cannot tell. */
      const goal = await readGoal(exec)
      /** This session's anchor record, read from the workspace sidecar. */
      const record = readAnchors(anchorsPath(rootOf(exec)))[sessionKeyOf(exec)]
      return {
        ...(goal === undefined || goal === null ? {} : { goal }),
        ...(record === undefined ? {} : { anchored: record }),
        enabled: cfg.enabled,
        autoAnchor: cfg.autoAnchor,
        ...(goal === undefined ? { unknown: true } : {}),
      }
    },
  })

  dsh.registerTool({
    name: "mpd_goal_anchor",
    description: "Put a persisted goal in place for a long-running objective, so the harness keeps this session working across automatic continuation rounds (the durable basis of continuous execution). An unfinished goal already current is KEPT, never replaced; the harness's own rule still applies — creating a goal needs a direct human turn on this top-level agent.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The concrete completion objective for the goal." },
        maxRounds: { type: "integer", description: "Optional round cap for automatic continuation rounds." },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, created: { type: "boolean" }, goal: { type: "object" }, error: { type: "string" }, note: { type: "string" } }, required: ["ok", "created"] },
      render: (_a: unknown, v: any) => textBlock("mpd goal anchor: ok=" + String(v.ok) + " created=" + String(v.created) + (v.goal ? " goal=" + JSON.stringify(v.goal) : "") + (v.error ? " error: " + v.error : "") + (v.note ? " note: " + v.note : "")),
    },
    execute: async (args: any, exec: any) => {
      /** The anchor outcome; a refusal is reported, not thrown, so the model reads the harness's own text. */
      const outcome = await anchor(exec, { objective: String(args?.objective ?? ""), source: "tool", ...(args?.maxRounds === undefined ? {} : { maxRounds: Number(args.maxRounds) }) })
      return { ok: outcome.ok, created: outcome.created, ...(outcome.goal ? { goal: outcome.goal } : {}), ...(outcome.error === undefined ? {} : { error: outcome.error }), ...(outcome.note === undefined ? {} : { note: outcome.note }) }
    },
  })

  dsh.registerTool({
    name: "mpd_goal_finish",
    description: "Mark the calling session's persisted goal complete (or blocked, with a reason) and disarm automatic continuation. Call it when the objective is actually achieved: complete is admitted on a human turn or inside the current goal round; blocked additionally needs the harness's consecutive-round threshold, so a refusal is expected early in a goal.",
    parameters: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["complete", "blocked"], description: "The terminal transition to attempt." },
        blockedReason: { type: "string", description: "Required with outcome=blocked: the concrete condition that persisted." },
      },
      required: ["outcome"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, outcome: { type: "string" }, goal: { type: "object" }, error: { type: "string" } }, required: ["ok", "outcome"] },
      render: (_a: unknown, v: any) => textBlock("mpd goal finish: " + v.outcome + " ok=" + String(v.ok) + (v.goal ? " goal=" + JSON.stringify(v.goal) : "") + (v.error ? " error: " + v.error : "")),
    },
    execute: async (args: any, exec: any) => {
      /** The finish outcome; a policy refusal comes back as `ok:false` with the harness's message. */
      const outcome = await finish(exec, {
        outcome: args?.outcome === "blocked" ? "blocked" : "complete",
        source: "tool",
        ...(args?.blockedReason === undefined ? {} : { reason: String(args.blockedReason) }),
        // An EXPLICIT tool call may finish any current goal: the model asked, and the harness tools
        // still decide whether the transition is admissible.
        explicit: true,
      })
      return { ok: outcome.ok, outcome: outcome.outcome, ...(outcome.goal ? { goal: outcome.goal } : {}), ...(outcome.error === undefined ? {} : { error: outcome.error }) }
    },
  })
}
