#!/usr/bin/env node
// QA probe for the idle-member guard (contract `.mpd/plans/team-idle-member-guard.md`, §4 live case).
//
// Mounted INSIDE a real headless boot by `team-idle-member-guard.ts` through a `dsh --patch` overlay.
// The probe is the LEAD's hands: it stages a plan with TWO members and ONE task through the REAL
// `agent_teams_plan` tool and approves it, so the team executor raises both members (a spawn turn
// each). It asserts nothing — the case reads the harness session log and the team record.
//
// WHY A PROBE: a model stub cannot be trusted to issue five ordered tool calls, and the point of the
// case is the PLUGIN's behaviour under a real approval, not the model's. The probe calls the same tool
// the Lead calls, as the Lead's live agent, and records every answer to `config.outFile`.
import { writeFileSync } from "node:fs"

/** The probe row's plugin id, asserted by the case's overlay and by the offline self-test. */
export const name = "team-idle-member-guard-probe"

// The tool registry is a harness seam; a PROBE may read it directly (the adapter rule binds plugin
// rows, not QA instrumentation), and `inject` makes the mount wait for the service instead of racing it.
/** The harness service the mount waits for. */
export const inject: readonly string[] = ["tools"]

/** One recorded tool call: the label the plan names, the outcome, and the raw value. */
export interface ProbeCall {
  /** The plan step this call ran (`create`, `add-owner`, …). */
  readonly label: string
  /** Whether the tool answered `ok: true`. */
  readonly ok: boolean
  /** The tool's structured value, or null. */
  readonly value: unknown
  /** The tool's refusal text, or the empty string. */
  readonly error: string
}

/** The probe's record, written after every call so a crashed boot still leaves its evidence. */
export interface ProbeRecord {
  /** The Lead session the plan was staged from. */
  readonly lead: string
  /** Whether the plan was started at all. */
  readonly started: boolean
  /** Every call, in plan order. */
  readonly calls: ProbeCall[]
  /** Anything that went wrong outside the tool calls (a missing adapter, a thrown call). */
  readonly errors: string[]
}

/** The probe row config the overlay supplies. */
export interface ProbeConfig {
  /** The absolute path the record is written to. */
  readonly outFile?: string
}

/** The two adapter members this probe calls (a structural slice; the adapter row provides the rest). */
export interface ProbeAdapter {
  /** Every live Agent in the process, or undefined when the registry is absent. */
  liveAgents?(): readonly unknown[]
  /** The harness event seam. */
  onEvent?(event: string, handler: (payload: unknown) => unknown): (() => void) | undefined
  /** Run one registered tool as one agent. */
  executeTool?(request: { name: string; arguments?: unknown; agent?: unknown }): Promise<{ ok?: boolean; value?: unknown; error?: unknown }>
}

/** The minimal harness context the probe reads (the adapter service and the event bus). */
export interface ProbeCtx {
  /** Resolve one mounted service. */
  get?(id: string, strict?: boolean): unknown
  /** Subscribe to one harness event. */
  on?(event: string, handler: (payload: unknown) => unknown): (() => void) | undefined
}

/** The Lead's plan: TWO members and ONE ready task, approved at the end (contract §4). */
const PLAN: ReadonlyArray<{ label: string; arguments: Record<string, unknown> }> = [
  { label: "create", arguments: { action: "create", name: "idle-guard-live", description: "P2a live QA: one task, two members", approval: "required" } },
  {
    label: "add-owner",
    arguments: {
      action: "add_member",
      member: {
        name: "cell-owner",
        description: "owns the one board task",
        role: "Senior Engineer",
        prompt: "IDLE-QA-OWNER: you own the one board task of this live QA team.",
      },
    },
  },
  {
    label: "add-idle",
    arguments: {
      action: "add_member",
      member: {
        name: "cell-idle",
        description: "a member with no board task",
        role: "Senior Engineer",
        prompt: "You are the taskless member of this live QA team.",
      },
    },
  },
  {
    label: "create-task",
    arguments: {
      action: "create_task",
      task: { subject: "the one task", description: "The only task on this board.", owner: "cell-owner", blocked_by: [], write_scopes: [] },
    },
  },
  { label: "approve", arguments: { action: "approve" } },
]

/**
 * The session id one agent carries, from its session first and the agent row second.
 * @param agent - a live Agent or an event payload.
 * @returns the session id, or the empty string.
 */
export function sessionIdOf(agent: unknown): string {
  /** The value viewed as the two shapes the harness uses. */
  const candidate = agent as { session?: { id?: unknown }; id?: unknown } | undefined
  /** The session id, when present. */
  const sessionId = candidate?.session?.id
  if (typeof sessionId === "string" && sessionId !== "") return sessionId
  /** The agent's own id. */
  const id = candidate?.id
  return typeof id === "string" ? id : ""
}

/**
 * Mount the probe: find the Lead (the first live agent, or the first `agent/created`), run the plan,
 * and write the record after every call.
 * @param ctx - the harness context.
 * @param config - the row config (`outFile`).
 */
export function apply(ctx: ProbeCtx, config: ProbeConfig = {}): void {
  /** The record path the overlay supplies. */
  const outFile = typeof config.outFile === "string" ? config.outFile : ""
  /** The record under construction. */
  const record = { lead: "", started: false, calls: [] as ProbeCall[], errors: [] as string[] }
  /** Persist the record; a failed write is reported into the record itself, never thrown. */
  const save = (): void => {
    if (outFile === "") return
    try {
      // The probe owns this file; the case reads it after the boot.
      writeFileSync(outFile, JSON.stringify(record, null, 2))
    } catch (error) {
      record.errors.push("the probe could not write its record: " + (error instanceof Error ? error.message : String(error)))
    }
  }
  /**
   * Run the whole plan as one agent.
   * @param agent - the Lead's live agent.
   */
  const run = async (agent: unknown): Promise<void> => {
    /** The adapter service, read lazily so a late-ACTIVE row is not frozen out. */
    const dsh = ctx.get?.("mpdDsh", false) as ProbeAdapter | undefined
    if (dsh === undefined || typeof dsh.executeTool !== "function") {
      record.errors.push("no mpdDsh adapter with executeTool is mounted; the plan cannot be staged")
      save()
      return
    }
    record.lead = sessionIdOf(agent)
    for (const step of PLAN) {
      try {
        /** The tool's answer. */
        const answer = await dsh.executeTool({ name: "agent_teams_plan", arguments: step.arguments, agent })
        record.calls.push({
          label: step.label,
          ok: answer?.ok === true,
          value: answer?.value ?? null,
          error: typeof answer?.error === "string" ? answer.error : String(answer?.error ?? ""),
        })
      } catch (error) {
        record.calls.push({ label: step.label, ok: false, value: null, error: error instanceof Error ? error.message : String(error) })
      }
      save()
    }
  }
  /**
   * Start the plan exactly once, on the first agent the probe sees.
   * @param agent - a candidate Lead agent.
   */
  const start = (agent: unknown): void => {
    if (record.started || sessionIdOf(agent) === "") return
    record.started = true
    void run(agent).catch((error: unknown): void => {
      record.errors.push("the plan run threw: " + (error instanceof Error ? error.message : String(error)))
      save()
    })
  }
  // The boot session may already be live when the probe mounts; else `agent/created` names it.
  try {
    /** The adapter, read once here only to ask the live registry. */
    const dsh = ctx.get?.("mpdDsh", false) as ProbeAdapter | undefined
    for (const agent of dsh?.liveAgents?.() ?? []) {
      start(agent)
      break
    }
  } catch (error) {
    record.errors.push("reading the live registry failed: " + (error instanceof Error ? error.message : String(error)))
  }
  try {
    ctx.on?.("agent/created", (payload: unknown): undefined => {
      start((payload as { agent?: unknown } | undefined)?.agent ?? payload)
      return undefined
    })
  } catch (error) {
    record.errors.push("subscribing to agent/created failed: " + (error instanceof Error ? error.message : String(error)))
  }
  save()
}
