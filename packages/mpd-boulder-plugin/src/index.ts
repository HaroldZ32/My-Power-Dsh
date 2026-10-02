// C5 mpd-boulder-plugin: durable work-state machine (boulder) on the DSH tool seam.
// Vendored core: the upstream project packages/boulder-state (base 8c57e46;
// SUL-1.0, inherited from upstream; see LICENSE.md). Adaptations: state root -> .mpd convention and
// session platform default -> "dsh" (legacy host prefixes still readable; see vendor/constants.ts, storage/shared.ts).
import {
  readBoulderState,
  createBoulderState,
  writeBoulderState,
  completeBoulder,
  addBoulderWork,
  getActiveWorks,
  getWorkById,
  getWorkForSession,
  getWorkResumeOptions,
  getPlanProgress,
  findPrometheusPlans,
  startTaskTimer,
  endTaskTimer,
} from "./vendor/index.ts"
import { join } from "node:path"
import { DSH_SEAM_TOOLS, dshSeamInject, type DshAdapter, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** Cordis plugin name of this row; the loader keys the mounted instance on it. */
export const name = "mpd-boulder"
/** Harness services required before `apply` runs: only the tool registrar, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the cordis context this plugin uses: the tool registrar plus an optional service lookup. */
type Ctx = { tools: any; get?: (k: string) => any }
/** Row config: `boulderDir` is an explicit state-root override that outranks workspace resolution. */
type Config = { boulderDir?: string }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  // The mpdConfig service, present only when mpd-config-plugin is mounted in the same composition.
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  // Runtime-layer value for the override; only a string is accepted, anything else keeps the row config.
  const v = svc.get("boulder.dir")
  return typeof v === "string" ? { ...config, boulderDir: v } : config
}


// Explicit override (config.boulderDir / mpd.jsonc boulder.dir) wins; otherwise the
// CALLING SESSION's workspace (adapter workspaceRoot) — never the dsh process cwd.
function boulderRoot(config: Config, dsh: DshAdapter, exec?: any): string {
  return config.boulderDir ? config.boulderDir : dsh.workspaceRoot(exec)
}

/** Register every boulder tool on the adapter; `config` is the row config, which `mpd.jsonc` may override per key. */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // Effective config for this apply: the row config with the mpd.jsonc `boulder.dir` layered over it.
  const merged = mergedConfig(ctx, config)
  // Per-call state root: the calling session's workspace, unless an explicit override is configured.
  const root = (exec?: any): string => boulderRoot(merged, dsh, exec)

  dsh.registerTool({
    name: "mpd_boulder_status",
    description: "Show the boulder work ledger: active works, statuses, session ids, task timers, resume options and (optionally) the progress of one plan file. State lives in .mpd/boulder.json.",
    parameters: { type: "object", properties: { planPath: { type: "string" } } },
    output: { schema: { type: "object", properties: { stateFile: { type: "string" }, activeWorks: { type: "array", items: { type: "object" } }, resumeOptions: { type: "array", items: { type: "object" } }, planProgress: { type: "object" }, state: { type: "object" } }, required: ["stateFile", "activeWorks", "resumeOptions"] }, render: (_a: unknown, v: any) => textBlock("boulder status: " + v.stateFile + "\nactive works: " + JSON.stringify(v.activeWorks, null, 1) + "\nresume: " + JSON.stringify(v.resumeOptions, null, 1) + (v.planProgress ? "\nplan: " + JSON.stringify(v.planProgress) : "")) },
    execute: async (args: any, exec: any) => {
      // State root for this call: the calling session's workspace, unless `boulder.dir` overrides it.
      const dir = root(exec)
      // The persisted ledger, or null when this workspace has never started a work.
      const state = readBoulderState(dir)
      // Works that are not terminal (completed/abandoned), re-read so parallel sessions agree.
      const activeWorks = getActiveWorks(dir)
      // Resumable works with their plan checklist, the list a caller resumes from.
      const resumeOptions = getWorkResumeOptions(dir)
      // Filled only when the caller names a plan; the schema types it `object` and does not require it.
      let planProgress: any = null
      if (args?.planPath) {
        try { planProgress = getPlanProgress(String(args.planPath)) } catch (e: any) { planProgress = { error: String(e?.message ?? e) } }
      }
      // Response envelope: the ledger path is always reported, so a caller sees where state lives.
      const result: any = { stateFile: join(dir, ".mpd", "boulder.json"), activeWorks, resumeOptions }
      if (state) result.state = { active_work_id: state.active_work_id, status: state.status }
      // The schema declares planProgress as `type: object`: a present null fails
      // the host validator ("value.planProgress must be an object"), so the field
      // is omitted entirely when no plan path was requested (it is not required).
      if (planProgress) result.planProgress = planProgress
      return result
    }
  })

  dsh.registerTool({
    name: "mpd_boulder_start",
    description: "Start a boulder work bound to a plan markdown file (e.g. .mpd/plans/<slug>.md). Creates .mpd/boulder.json if absent; the work becomes active with status active and the calling session recorded.",
    parameters: { type: "object", properties: { planPath: { type: "string" }, agent: { type: "string" }, worktreePath: { type: "string" }, sessionId: { type: "string" } }, required: ["planPath"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, stateFile: { type: "string" } }, required: ["workId", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder started: " + v.workId + " (" + v.status + ") " + v.stateFile) },
    execute: async (args: any, exec: any) => {
      // Per-call state root, identical to the other boulder tools; never cached at module scope.
      const dir = root(exec)
      // Plan file the work is bound to; the tool schema makes it required.
      const planPath = String(args?.planPath)
      // Session recorded on the work; normalizeSessionId turns "current" into a `dsh:`-prefixed id.
      const sessionId = String(args?.sessionId ?? "current")
      // Readable ledger already in this workspace; null also when the file is absent or unparsable.
      const existing = readBoulderState(dir)
      // Ledger after the mutation, or null when the vendor write was refused.
      let next: any
      if (existing) {
        next = addBoulderWork(dir, { planPath, sessionId, agent: args?.agent, worktreePath: args?.worktreePath })
      } else {
        // Create ONCE: createBoulderState generates a random workId, so a second
        // call would return an id that does not match the persisted state.
        const created = createBoulderState(planPath, sessionId, args?.agent, args?.worktreePath)
        next = writeBoulderState(dir, created) ? created : null
      }
      if (!next) throw new Error("mpd-boulder: failed to start work on " + planPath)
      // Id of the work this call made active: the mirror pointer both vendor paths set, optional in the stored shape.
      const wid = next.active_work_id
      // Effective lifecycle, defaulting to `active` for a work whose status field is unset.
      const status = wid ? next.works?.[wid]?.status ?? "active" : "active"
      return { workId: wid ?? "?", status, stateFile: join(dir, ".mpd", "boulder.json") }
    }
  })

  dsh.registerTool({
    name: "mpd_boulder_complete",
    description: "Complete the active boulder work (or one given by workId): sets status completed, records ended_at + elapsed_ms and persists .mpd/boulder.json.",
    parameters: { type: "object", properties: { workId: { type: "string" } } },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, elapsedMs: { type: "integer" } }, required: ["workId", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder completed: " + v.workId + " status=" + v.status + " elapsedMs=" + v.elapsedMs) },
    execute: async (args: any, exec: any) => {
      // Per-call state root, resolved from the calling session rather than the process cwd.
      const dir = root(exec)
      // Ledger after completion, or null when the workspace has none or no work matched (reported as an error below).
      const state = completeBoulder(dir, args?.workId)
      if (!state) throw new Error("mpd-boulder: no work to complete (start one first with mpd_boulder_start)")
      // Work actually completed: the requested id, else whatever the mirror points at.
      const workId = args?.workId ?? state.active_work_id ?? "?"
      // Record re-read from disk, the source of the status and elapsed_ms reported back.
      const work = getWorkById(dir, workId)
      return { workId, status: work?.status ?? "completed", elapsedMs: work?.elapsed_ms ?? 0 }
    }
  })

  dsh.registerTool({
    name: "mpd_boulder_task_timer",
    description: "Start or end a per-task session timer inside a boulder work (taskKey = TODO id in the plan, e.g. '1' or 'F1'). action=start marks running; action=end marks completed and records elapsed_ms.",
    parameters: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, action: { type: "string", enum: ["start", "end"] }, taskLabel: { type: "string" }, taskTitle: { type: "string" }, sessionId: { type: "string" } }, required: ["workId", "taskKey", "action"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, status: { type: "string" } }, required: ["workId", "taskKey", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder timer: " + v.taskKey + " (" + v.status + ") in " + v.workId) },
    execute: async (args: any, exec: any) => {
      // Per-call state root; the ledger is workspace-scoped, so it is re-resolved on every invocation.
      const dir = root(exec)
      // Work the timer belongs to; the tool schema makes it required.
      const workId = String(args?.workId)
      // Plan task key (`1`, `F1`, …), the map key of the timer inside that work.
      const taskKey = String(args?.taskKey)
      // Ledger after the timer mutation, or null when the upsert, lookup or write failed.
      let next: any
      if (args?.action === "start") {
        next = startTaskTimer(dir, workId, { taskKey, taskLabel: String(args?.taskLabel ?? taskKey), taskTitle: String(args?.taskTitle ?? taskKey), sessionId: String(args?.sessionId ?? "current") })
        if (!next) throw new Error("mpd-boulder: timer start failed (workId/taskKey invalid)")
      } else {
        next = endTaskTimer(dir, workId, taskKey)
        if (!next) throw new Error("mpd-boulder: timer end failed (no running task)")
      }
      // The mutated work, whose task_sessions carries the timer's status; undefined on a pre-`works` ledger.
      const work = next.works?.[workId]
      return { workId, taskKey, status: work?.task_sessions?.[taskKey]?.status ?? (args?.action === "start" ? "running" : "completed") }
    }
  })

  dsh.registerTool({
    name: "mpd_boulder_plan_progress",
    description: "Parse a plan markdown file for its checklist progress: '## TODOs' items (N.) and '## Final Verification Wave' items (F<n>.), returning done/remaining with the plan path resolution.",
    parameters: { type: "object", properties: { planPath: { type: "string" } }, required: ["planPath"] },
    output: { schema: { type: "object", properties: { planPath: { type: "string" }, progress: { type: "object" } }, required: ["planPath", "progress"] }, render: (_a: unknown, v: any) => textBlock("plan progress " + v.planPath + ": " + JSON.stringify(v.progress, null, 1)) },
    execute: async (args: any, exec: any) => {
      // Resolved for parity with the other tools; this one reads only the plan file the caller named.
      const dir = root(exec)
      // Plan file to parse; the tool schema makes it required.
      const planPath = String(args?.planPath)
      // Checklist counts parsed from disk; a missing or checkbox-less plan yields zeroes, not an error.
      const progress = getPlanProgress(planPath)
      return { planPath, progress }
    }
  })

  dsh.registerTool({
    name: "mpd_boulder_plans",
    description: "List plan markdown files under .mpd/plans that can be started as boulder works.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { plans: { type: "array", items: { type: "string" } } }, required: ["plans"] }, render: (_a: unknown, v: any) => textBlock("plans: " + v.plans.join("\n")) },
    execute: async (_args: any, exec: any) => ({ plans: findPrometheusPlans(root(exec)) })
  })
}
