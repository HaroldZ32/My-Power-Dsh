// C5 mpd-boulder-plugin: durable work-state machine (boulder) on the DSH tool seam.
// Vendored core: upstream oh-my-openagent packages/boulder-state (base 8c57e46,
// SUL-1.0 fork terms; see LICENSE.md). Adaptations: state root .omo -> .mpd and
// session platform default "opencode" -> "dsh" (see vendor/constants.ts, storage/shared.ts).
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

export const name = "mpd-boulder"
export const inject = ["tools"]

type Ctx = { tools: any }
type Config = { boulderDir?: string }

function textBlock(text: string): any { return [{ type: "text", text }] }

function cwd(): string { return process.env.DSH_WORKSPACE_ROOT ?? process.cwd() }

function boulderRoot(config: Config): string { return config.boulderDir ? config.boulderDir : cwd() }

export function apply(ctx: Ctx, config: Config = {}): void {
  const root = () => boulderRoot(config)

  ctx.tools.register({
    name: "mpd_boulder_status",
    description: "Show the boulder work ledger: active works, statuses, session ids, task timers, resume options and (optionally) the progress of one plan file. State lives in .mpd/boulder.json.",
    parameters: { type: "object", properties: { planPath: { type: "string" } } },
    output: { schema: { type: "object", properties: { stateFile: { type: "string" }, activeWorks: { type: "array", items: { type: "object" } }, resumeOptions: { type: "array", items: { type: "object" } }, planProgress: { type: "object" } }, required: ["stateFile", "activeWorks", "resumeOptions"] }, render: (_a: unknown, v: any) => textBlock("boulder status: " + v.stateFile + "\nactive works: " + JSON.stringify(v.activeWorks, null, 1) + "\nresume: " + JSON.stringify(v.resumeOptions, null, 1) + (v.planProgress ? "\nplan: " + JSON.stringify(v.planProgress) : "")) },
    execute: async (args: any) => {
      const dir = root()
      const state = readBoulderState(dir)
      const activeWorks = getActiveWorks(dir)
      const resumeOptions = getWorkResumeOptions(dir)
      let planProgress: any = null
      if (args?.planPath) {
        try { planProgress = getPlanProgress(String(args.planPath)) } catch (e: any) { planProgress = { error: String(e?.message ?? e) } }
      }
      return { stateFile: dir + "/.mpd/boulder.json", activeWorks, resumeOptions, planProgress, state: state ? { active_work_id: state.active_work_id, status: state.status } : null }
    }
  })

  ctx.tools.register({
    name: "mpd_boulder_start",
    description: "Start a boulder work bound to a plan markdown file (e.g. .mpd/plans/<slug>.md). Creates .mpd/boulder.json if absent; the work becomes active with status active and the calling session recorded.",
    parameters: { type: "object", properties: { planPath: { type: "string" }, agent: { type: "string" }, worktreePath: { type: "string" }, sessionId: { type: "string" } }, required: ["planPath"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, stateFile: { type: "string" } }, required: ["workId", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder started: " + v.workId + " (" + v.status + ") " + v.stateFile) },
    execute: async (args: any) => {
      const dir = root()
      const planPath = String(args?.planPath)
      const sessionId = String(args?.sessionId ?? "current")
      const existing = readBoulderState(dir)
      const next = existing
        ? addBoulderWork(dir, { planPath, sessionId, agent: args?.agent, worktreePath: args?.worktreePath })
        : writeBoulderState(dir, createBoulderState(planPath, sessionId, args?.agent, args?.worktreePath)) ? createBoulderState(planPath, sessionId, args?.agent, args?.worktreePath) : null
      if (!next) throw new Error("mpd-boulder: failed to start work on " + planPath)
      return { workId: next.active_work_id ?? "?", status: next.works?.[next.active_work_id ?? ""]?.status ?? "active", stateFile: dir + "/.mpd/boulder.json" }
    }
  })

  ctx.tools.register({
    name: "mpd_boulder_complete",
    description: "Complete the active boulder work (or one given by workId): sets status completed, records ended_at + elapsed_ms and persists .mpd/boulder.json.",
    parameters: { type: "object", properties: { workId: { type: "string" } } },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, elapsedMs: { type: "integer" } }, required: ["workId", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder completed: " + v.workId + " status=" + v.status + " elapsedMs=" + v.elapsedMs) },
    execute: async (args: any) => {
      const dir = root()
      const state = completeBoulder(dir, args?.workId)
      if (!state) throw new Error("mpd-boulder: no work to complete (start one first with mpd_boulder_start)")
      const workId = args?.workId ?? state.active_work_id ?? "?"
      const work = getWorkById(dir, workId)
      return { workId, status: work?.status ?? "completed", elapsedMs: work?.elapsed_ms ?? 0 }
    }
  })

  ctx.tools.register({
    name: "mpd_boulder_task_timer",
    description: "Start or end a per-task session timer inside a boulder work (taskKey = TODO id in the plan, e.g. '1' or 'F1'). action=start marks running; action=end marks completed and records elapsed_ms.",
    parameters: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, action: { type: "string", enum: ["start", "end"] }, taskLabel: { type: "string" }, taskTitle: { type: "string" }, sessionId: { type: "string" } }, required: ["workId", "taskKey", "action"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, status: { type: "string" } }, required: ["workId", "taskKey", "status"] }, render: (_a: unknown, v: any) => textBlock("boulder timer: " + v.taskKey + " (" + v.status + ") in " + v.workId) },
    execute: async (args: any) => {
      const dir = root()
      const workId = String(args?.workId)
      const taskKey = String(args?.taskKey)
      let next: any
      if (args?.action === "start") {
        next = startTaskTimer(dir, workId, { taskKey, taskLabel: String(args?.taskLabel ?? taskKey), taskTitle: String(args?.taskTitle ?? taskKey), sessionId: String(args?.sessionId ?? "current") })
        if (!next) throw new Error("mpd-boulder: timer start failed (workId/taskKey invalid)")
      } else {
        next = endTaskTimer(dir, workId, taskKey)
        if (!next) throw new Error("mpd-boulder: timer end failed (no running task)")
      }
      const work = next.works?.[workId]
      return { workId, taskKey, status: work?.task_sessions?.[taskKey]?.status ?? (args?.action === "start" ? "running" : "completed") }
    }
  })

  ctx.tools.register({
    name: "mpd_boulder_plan_progress",
    description: "Parse a plan markdown file for its checklist progress: '## TODOs' items (N.) and '## Final Verification Wave' items (F<n>.), returning done/remaining with the plan path resolution.",
    parameters: { type: "object", properties: { planPath: { type: "string" } }, required: ["planPath"] },
    output: { schema: { type: "object", properties: { planPath: { type: "string" }, progress: { type: "object" } }, required: ["planPath", "progress"] }, render: (_a: unknown, v: any) => textBlock("plan progress " + v.planPath + ": " + JSON.stringify(v.progress, null, 1)) },
    execute: async (args: any) => {
      const dir = root()
      const planPath = String(args?.planPath)
      const progress = getPlanProgress(planPath)
      return { planPath, progress }
    }
  })

  ctx.tools.register({
    name: "mpd_boulder_plans",
    description: "List plan markdown files under .mpd/plans (and legacy .omo/plans) that can be started as boulder works.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { plans: { type: "array", items: { type: "string" } } }, required: ["plans"] }, render: (_a: unknown, v: any) => textBlock("plans: " + v.plans.join("\n")) },
    execute: async () => ({ plans: findPrometheusPlans(root()) })
  })
}
