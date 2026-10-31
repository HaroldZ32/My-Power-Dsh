// CELLWORK PROTOCOL TOOLS — the seven registrations and the two listeners behind B8/B9.
//
// The tools: `cellwork_dispatch`, `cellwork_supervise`, `cellwork_context`, `cellwork_handoff`,
// `cellwork_subteam`, `cellwork_send`, `cellwork_inbox`. The listeners: the host-plane `agent/pre-step`
// checkpoint detector and the `agent/turn-stopping` compaction barrier. The decision logic they share
// lives in `protocol-core.ts` (pure, unit-testable); this file binds it to the adapter and to disk.
import { appendJournal, freeCellId, handoffPath, newCellState, readCell, writeCell, type CellMemberRecord, type CellState } from "./state"
import { callerContext, type CallerContext, type TeamsServiceView } from "./caller"
import type { CellworkConfig } from "./config"
import { applyReassignments, dispatchOwnerOnly, fenceReasonOf, nameKey, reassignPairs, sendThroughExecutor, type DispatchRecordView, type DispatchReport, type ReassignOutcome } from "./dispatch"
import { validateHandoffText, writeHandoff } from "./handoff"
import { appendCellMail, deliverCellMail, foldCellMail, mailId, readCellMail, unreadFor, wakeFailures, type CellMailMessage } from "./mail"
import {
  applyCheckpoint,
  checkpointDirective,
  checkpointUnrecoverableEntry,
  compactionJournalEntry,
  handoffWrittenDirective,
  memberAfterBarrier,
  nextStepOf,
  planCheckpoint,
  promoteAfterHandoff,
  subteamDirective,
  type CheckpointPlan,
} from "./protocol-core"
import { readFileSync } from "node:fs"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { ProtocolDeps } from "./protocol-core"

/** One protocol tool's answer: a structured success (any documented fields) or the refusal sentence. */
type ProtocolResult = Record<string, unknown> | ProtocolFailure

/** The refusals every protocol tool answers with — never a throw, so the model can act on the sentence. */
interface ProtocolFailure {
  /** Always false. */
  ok: false
  /** ONE sentence naming what was refused and what to do instead. */
  error: string
  /** The record path, when the refusal is about a state this build could not read. */
  path?: string
}

/**
 * Read one tool's arguments as a record.
 *
 * @param args - the harness-validated arguments (the schema is not enforced inside the handler).
 * @returns the arguments, or an empty record.
 */
function readArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {}
  return args as Record<string, unknown>
}

/**
 * Read one string field from untrusted arguments.
 *
 * @param args - the argument record.
 * @param key - the field name.
 * @returns the string, or "" when absent or not a string.
 */
function argString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] as string : ""
}

/**
 * One harness content block holding text.
 *
 * @param value - the text.
 * @returns the content blocks array.
 */
function render(value: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: value }]
}

/**
 * The sentence a refusing cell read answers with.
 *
 * @param failure - the failed read.
 * @returns the refusal naming the path and the reason.
 */
function refusalText(failure: { path: string; reason: string; detail: string }): string {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed"
}

/**
 * A message from an unknown thrown value, without assuming it is an Error.
 *
 * @param error - the thrown value.
 * @returns its message text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one member row out of a call's cell record.
 *
 * @param caller - the caller context.
 * @returns the member row, or undefined when the caller is not a member.
 */
function memberOf(caller: CallerContext): CellMemberRecord | undefined {
  return caller.cell === null || caller.member === "" ? undefined : caller.cell.members[caller.member]
}

/**
 * One board row as `cellwork_supervise` reports it, with NO own key holding `undefined`.
 *
 * The live record's rows are `Record<string, unknown>`: any field may be ABSENT (a task with no owner is
 * legal), and the harness REFUSES a tool result carrying an `undefined` own key — so this projection is a
 * conditional spread. Absence stays absence, never an undefined value.
 *
 * @param task - the raw board row.
 * @returns the lossless projection.
 */
function superviseTaskRow(task: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof task.id === "string" ? { id: task.id } : {}),
    ...(typeof task.subject === "string" ? { subject: task.subject } : {}),
    ...(typeof task.status === "string" ? { status: task.status } : {}),
    ...(typeof task.owner === "string" ? { owner: task.owner } : {}),
    ...(typeof task.kind === "string" ? { kind: task.kind } : {}),
  }
}

/**
 * Install the seven protocol tools and the two protocol listeners.
 *
 * @param deps - the adapter, the host context, the knobs and the log sink.
 * @returns one disposer per registration.
 */
export function installCellworkProtocol(deps: ProtocolDeps): Array<() => void> {
  /** The adapter, named once so the bodies read cleanly. */
  const dsh = deps.dsh
  /** The resolved knobs. */
  const config = deps.config
  /** Every registration's disposer. */
  const disposers: Array<() => void> = []
  /** The per-process mail id sequence. */
  let mailSequence = 0
  /** The compaction barriers currently running, keyed `cellId/member`, so one turn cannot start two. */
  const inFlight = new Set<string>()
  /** The team service, probed per call. */
  const teams = (): TeamsServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdTeams", false)
    return typeof service === "object" && service !== null ? service as TeamsServiceView : undefined
  }
  /** The caller's context for one dispatch. */
  const callerFor = (exec: DshToolExec): CallerContext => callerContext(dsh, exec, { teams })
  /**
   * Read one live team record.
   *
   * @param workspace - the caller's workspace root.
   * @param teamId - the team id.
   * @returns the record, or undefined.
   */
  const recordOf = (workspace: string, teamId: string): Record<string, unknown> | undefined => {
    if (teamId === "" || workspace === "") return undefined
    /** The service's own read. */
    const record = teams()?.get?.(workspace, teamId)
    return typeof record === "object" && record !== null ? record as Record<string, unknown> : undefined
  }
  /**
   * Persist one transition: journal first, then the record.
   *
   * @param workspace - the caller's workspace root.
   * @param next - the record after the transition.
   * @param entry - the journal fields.
   * @param now - the instant to stamp.
   * @returns the record as persisted.
   */
  const transition = (workspace: string, next: CellState, entry: Record<string, unknown>, now: Date): CellState => {
    /** The journal line count after the append. */
    const lines = appendJournal(workspace, next.cellId, entry, now)
    /** The record carrying the updated cursor. */
    const stamped: CellState = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor }
    writeCell(workspace, stamped)
    return { ...stamped, updatedAt: now.toISOString() }
  }
  /** The captain-only refusal sentence, shared by the captain tools. */
  const captainOnly = (caller: CallerContext, tool: string): ProtocolFailure | undefined =>
    caller.sessionId === "" || caller.cell === null || caller.sessionId !== caller.cell.captainSessionId
      ? { ok: false, error: tool + " is CAPTAIN-ONLY: the captain of this cell is session " + String(caller.cell?.captainSessionId ?? "none") + ", which is not this caller" }
      : undefined

  // ── cellwork_dispatch ────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_dispatch",
    description: "CAPTAIN only: one owner-only dispatch pass over the live board. A ready task is paired ONLY with its declared owner; a busy, absent, FENCED or failed owner is REPORTED and the task left pending — never substituted (a fenced member is never messaged). `reassign` hands named rows to another member FIRST: each row is claimed for that member through the board, journaled as `task-reassigned`, then delivered — the repair for a fenced owner. Delivery goes through the team executor and is journaled.",
    parameters: {
      type: "object",
      properties: {
        reassign: {
          type: "array",
          description: "Rows to hand to another member BEFORE the pass: each is claimed for that member on the board, journaled, then delivered to it. Use it to repair the rows a fenced owner still holds.",
          items: {
            type: "object",
            properties: {
              task_id: { type: "string", description: "The board row to hand over (`T17`)." },
              owner: { type: "string", description: "The member that should own and receive the row." },
            },
            required: ["task_id", "owner"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          pairs: { type: "array", items: { type: "object" } },
          skipped: { type: "array", items: { type: "object" } },
          reassigned: { type: "array", items: { type: "object" }, description: "One entry per readable `reassign` pair: whether the board claim landed and whether the message was delivered." },
          reassignInvalid: { type: "array", items: { type: "string" }, description: "One sentence per `reassign` entry this call refused to read." },
          refused: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_dispatch refused: " + String(result.error ?? "unknown refusal"))
        /** The delivered pairs. */
        const pairs = Array.isArray(result.pairs) ? result.pairs as Array<Record<string, unknown>> : []
        /** The reported skips. */
        const skipped = Array.isArray(result.skipped) ? result.skipped as Array<Record<string, unknown>> : []
        /** The reassignment outcomes, reported before the pass because they run before it. */
        const reassigned = Array.isArray(result.reassigned) ? result.reassigned as Array<Record<string, unknown>> : []
        /** The refused `reassign` entries. */
        const invalid = Array.isArray(result.reassignInvalid) ? result.reassignInvalid.map((entry) => String(entry)) : []
        /** One line per hand-over, claiming and delivery reported as the SEPARATE facts they are. */
        const handovers = reassigned.map((row) => "reassign " + String(row.taskId) + " -> " + String(row.owner) + ": " + (row.delivered === true ? "claimed on the board and delivered" : row.claimed === true ? "CLAIMED, delivery failed: " + String(row.reason ?? "unknown") : "not claimed: " + String(row.reason ?? "unknown")))
        if (typeof result.refused === "string") return render([...handovers, ...invalid, "cellwork_dispatch refused: " + result.refused].join("\n"))
        return render([...handovers, ...invalid, ...(pairs.length === 0
          ? ["nothing else dispatched" + (skipped.length === 0 ? "" : " (" + skipped.map((row) => String(row.subject) + ": " + String(row.reason)).join("; ") + ")")]
          : [...pairs.map((row) => String(row.subject) + " -> " + String(row.memberName)), ...(skipped.length === 0 ? [] : ["reported: " + skipped.length])])].join("\n"))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      /** The captain-only refusal, when this caller is not the captain. */
      const refused = captainOnly(caller, "cellwork_dispatch")
      if (refused !== undefined) return refused
      /** The active cell. */
      const cell = caller.cell as CellState
      if (cell.phase === "stopped") return { ok: false, error: "cellwork_dispatch: cell " + cell.cellId + " is stopped and archived" }
      /** The delivery binding, when this composition exposes the team executor. */
      const send = sendThroughExecutor(dsh.teamExecutor(), exec.agent)
      if (send === undefined) return { ok: false, error: "cellwork_dispatch: this composition exposes no team executor, so no member can be woken" }
      /** The instant this pass is stamped with, shared so no row of the pass reads earlier than its neighbour. */
      const now = new Date()
      /** The `reassign` pairs this call could read, and the entries it refused. */
      const handover = reassignPairs(readArgs(args)["reassign"])
      /** What the hand-over did, one entry per readable pair. */
      let reassigned: ReassignOutcome[] = []
      // THE HAND-OVER RUNS BEFORE THE PASS (C6): claim on the board, journal, then deliver — the order a
      // member depends on, because a message for a row it cannot see on the board is the D4/D5 livelock.
      if (handover.pairs.length > 0) {
        /** The live record the claims target, read per call. */
        const before = recordOf(caller.workspace, cell.teamId)
        reassigned = await applyReassignments({
          workspace: caller.workspace,
          cell,
          record: before as DispatchRecordView | undefined,
          pairs: handover.pairs,
          claim: async (taskId: string, owner: string): Promise<{ ok: boolean; error?: string }> => {
            try {
              /** The board's own answer to `agent_teams_task {action:"claim"}`. */
              const claimed = await dsh.executeTool({ name: "agent_teams_task", arguments: { action: "claim", task_id: taskId, claimant: owner }, agent: exec.agent })
              return claimed.ok ? { ok: true } : { ok: false, error: String(claimed.error ?? "the board refused the claim") }
            } catch (error) {
              return { ok: false, error: errorText(error) }
            }
          },
          send,
          now,
          handleFor: (name) => cell.members[name]?.executorRef,
        })
        appendJournal(caller.workspace, cell.cellId, { event: "dispatch-reassign", claimed: reassigned.filter((row) => row.claimed).length, delivered: reassigned.filter((row) => row.delivered).length, rejected: reassigned.filter((row) => !row.claimed).length, invalid: handover.invalid.length }, now)
      }
      /** The live record, RE-READ after the hand-over: the claims just moved those rows to `in_progress`. */
      const record = recordOf(caller.workspace, cell.teamId)
      /** The report. */
      const report: DispatchReport = await dispatchOwnerOnly({
        workspace: caller.workspace,
        cell,
        record: record as DispatchRecordView | undefined,
        send,
        now,
        handleFor: (name) => cell.members[name]?.executorRef,
        excludedTaskIds: Object.values(cell.cancelledTasks),
      })
      appendJournal(caller.workspace, cell.cellId, { event: "dispatch-pass", pairs: report.pairs.length, skipped: report.skipped.length }, now)
      return {
        ok: true,
        pairs: report.pairs,
        skipped: report.skipped,
        ...(reassigned.length === 0 ? {} : { reassigned }),
        ...(handover.invalid.length === 0 ? {} : { reassignInvalid: handover.invalid }),
        ...(report.refused === undefined ? {} : { refused: report.refused }),
      }
    },
  }))

  // ── cellwork_supervise ───────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_supervise",
    description: "CAPTAIN only: one READ-ONLY sweep of the cell — every member's mode / handoff state / live context ratio, the pending board tasks, the stale-split flags, the FENCED members together with the open rows they own (reassign those), and the unread mail (including rows whose wake-up never went out). Call it on every wake-up; it mutates nothing.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          staleSplit: { type: "boolean" },
          splitRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          requirementsRevision: { type: "number" },
          handoffReady: { type: "array", items: { type: "string" } },
          fenced: { type: "array", items: { type: "object" }, description: "Every fenced member with the reason and the OPEN board rows it still owns — the rows a `reassign` pass repairs." },
          unreadMail: { type: "number" },
          wakeFailures: { type: "array", items: { type: "object" } },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_supervise refused: " + String(result.error ?? "unknown refusal"))
        /** The member rows. */
        const members = Array.isArray(result.members) ? result.members as Array<Record<string, unknown>> : []
        /** The task rows. */
        const tasks = Array.isArray(result.tasks) ? result.tasks as Array<Record<string, unknown>> : []
        /** The fenced members, with the rows a reassignment would move. */
        const fenced = Array.isArray(result.fenced) ? result.fenced as Array<Record<string, unknown>> : []
        return render([
          "cell " + String(result.cellId ?? "") + " · phase " + String(result.phase ?? "") + " · split " + String(result.splitRevision ?? "none") + (result.staleSplit === true ? " (STALE)" : "") + " · requirements rev " + String(result.requirementsRevision ?? 0),
          "members: " + members.map((row) => String(row.name) + "[" + String(row.mode) + (row.handoffReady === true ? ",handoff-ready" : "") + (typeof row.ratio === "number" ? "," + Math.round((row.ratio as number) * 100) + "%" : "") + "]").join(" "),
          "tasks: " + (tasks.length === 0 ? "none" : tasks.map((row) => String(row.id) + " " + String(row.status) + (row.owner === undefined ? "" : "(" + String(row.owner) + ")")).join(" ")),
          "fenced: " + (fenced.length === 0
            ? "none"
            : fenced.map((row) => String(row.name) + " (" + String(row.reason) + ") owns " + (Array.isArray(row.tasks) && row.tasks.length > 0 ? (row.tasks as unknown[]).map((id) => String(id)).join(", ") : "no open row") + " — repair with cellwork_dispatch {reassign:[{task_id, owner}]}").join("; ")),
          "unread mail: " + String(result.unreadMail ?? 0) + (Array.isArray(result.wakeFailures) && result.wakeFailures.length > 0 ? " · " + String((result.wakeFailures as unknown[]).length) + " without a wake-up" : ""),
        ].join("\n"))
      },
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      /** The captain-only refusal, when this caller is not the captain. */
      const refused = captainOnly(caller, "cellwork_supervise")
      if (refused !== undefined) return refused
      /** The active cell. */
      const cell = caller.cell as CellState
      /** The live record. */
      const record = recordOf(caller.workspace, cell.teamId)
      /** The board rows this build can read. */
      const tasks = record !== undefined && Array.isArray(record.tasks) ? (record.tasks as Array<Record<string, unknown>>) : []
      /** Every member's live reading. */
      const members = Object.values(cell.members).map((member) => {
        /** The live pressure reading, which is total on the adapter. */
        const pressure = dsh.contextPressure(member.sessionId === "" ? member.name : member.sessionId)
        return { name: member.name, mode: member.mode, role: member.role, handoffReady: member.handoffReady, handoffs: member.handoffs, ratio: pressure.ratio, usedTokens: pressure.usedTokens, windowTokens: pressure.windowTokens, provenance: pressure.provenance }
      })
      /** The folded mail. */
      const messages = foldCellMail(readCellMail(caller.workspace, cell.cellId))
      // THE FENCED MEMBERS AND THEIR OPEN ROWS (C7): a fenced seat cannot claim, so the captain reads the
      // rows to reassign HERE, from the read-only sweep, instead of reconstructing them from the journal.
      /** Every fenced member, with the reason and the open board rows it still owns. */
      const fenced = Object.values(cell.members).flatMap((member) => {
        /** Why this member is fenced, or undefined when it can work. */
        const reason = fenceReasonOf(member)
        if (reason === undefined) return []
        /** The open rows credited to this member — the ones a `reassign` pass could move. */
        const owned = tasks.filter((task) => {
          /** The row's status: a terminal row is finished work, never a row to hand over. */
          const status = String(task.status ?? "")
          return status !== "completed" && status !== "failed" && nameKey(String(task.owner ?? "")) === nameKey(member.name)
        }).map((task) => String(task.id ?? ""))
        return [{ name: member.name, mode: member.mode, reason, tasks: owned }]
      })
      return {
        ok: true,
        cellId: cell.cellId,
        phase: cell.phase,
        members,
        tasks: tasks.map((task) => superviseTaskRow(task)),
        staleSplit: cell.splitStale,
        splitRevision: cell.splitRevision,
        requirementsRevision: cell.requirementsRevision,
        handoffReady: Object.values(cell.members).filter((member) => member.handoffReady).map((member) => member.name),
        fenced,
        unreadMail: messages.filter((message) => !message.read).length,
        wakeFailures: wakeFailures(messages).map((message) => ({ id: message.id, to: message.to, subject: message.subject, reason: message.wakeReason ?? "no wake-up was attempted" })),
      }
    },
  }))

  // ── cellwork_context ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_context",
    description: "Any cell seat: the caller's OWN live context occupancy — used tokens, the observed window and its provenance, the ratio, the checkpoint threshold in force, and whether a checkpoint would fire at this step. Read-only; never guesses a window (provenance `no-window`/`unavailable` answers null).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          member: { type: "string" },
          mode: { type: "string" },
          usedTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          windowTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          ratio: { oneOf: [{ type: "number" }, { type: "null" }] },
          provenance: { type: "string" },
          checkpointRatio: { type: "number" },
          willCheckpoint: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_context refused: " + String(result.error ?? "unknown refusal"))
        return render(String(result.member ?? "?") + " [" + String(result.mode ?? "?") + "] used " + String(result.usedTokens ?? "?") + " / " + String(result.windowTokens ?? "no window") + " (" + String(result.provenance) + ")" + (typeof result.ratio === "number" ? " = " + Math.round((result.ratio as number) * 100) + "%" : "") + " · checkpoint at " + String(Math.round(Number(result.checkpointRatio ?? 0) * 100)) + "% · would fire: " + String(result.willCheckpoint === true) + (String(result.reason ?? "") === "" ? "" : " (" + String(result.reason) + ")"))
      },
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_context: this session belongs to no active cell" }
      /** The live reading for the caller's own session. */
      const pressure = dsh.contextPressure(exec.agent)
      /** The checkpoint decision this reading would produce. */
      const plan: CheckpointPlan = planCheckpoint(caller.cell, caller.member, pressure, config, null)
      return {
        ok: true,
        member: caller.member,
        mode: caller.seat?.mode ?? "member",
        usedTokens: pressure.usedTokens,
        windowTokens: pressure.windowTokens,
        ratio: pressure.ratio,
        provenance: pressure.provenance,
        checkpointRatio: config.checkpointRatio,
        willCheckpoint: plan.inject,
        reason: plan.reason,
      }
    },
  }))

  // ── cellwork_handoff ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_handoff",
    description: "A MEMBER's checkpoint duty: validate a handoff document (task, state, decisions, artifacts, verified facts, open questions, next step), write `handoff/<member>-<n>.md`, mark the member handoff-ready and journal it. The result tells the agent to END ITS TURN; the plugin then compacts and promotes (or reseeds) it.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete handoff document (markdown headings or `Key:` lines)." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          member: { type: "string" },
          ordinal: { type: "number" },
          missing: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "object" } },
          directive: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_handoff refused: " + String(result.error ?? "unknown refusal") + (Array.isArray(result.missing) && result.missing.length > 0 ? "\nmissing sections: " + result.missing.join(", ") : ""))
        return render(String(result.directive ?? ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_handoff: this session belongs to no active cell" }
      /** The member row. */
      const member = caller.cell.members[caller.member]
      if (member === undefined) return { ok: false, error: "cellwork_handoff: " + JSON.stringify(caller.member) + " is not a recorded cell member" }
      if (caller.sessionId === caller.cell.captainSessionId) return { ok: false, error: "cellwork_handoff: the captain is never checkpointed (declared bound) — it dispatches, it does not hand off" }
      // ONE HANDOFF PER CHECKPOINT (C7): a second document while the first still waits for the barrier is
      // the 3-handoffs-in-7-minutes livelock D5 recorded, and the barrier reads only the LATEST ordinal —
      // so the refusal is what saves the continuity, not the write.
      if (member.handoffReady) {
        return { ok: false, error: "cellwork_handoff: the handoff " + JSON.stringify(caller.member) + " already wrote (handoff/" + String(member.handoffs) + ") is STILL WAITING for the compaction barrier — END YOUR TURN now instead of writing a second document; the barrier compacts and promotes you from the FIRST one" }
      }
      /** The document the member wrote. */
      const content = argString(readArgs(args), "content")
      if (content.trim() === "") return { ok: false, error: "cellwork_handoff: `content` is required — the handoff document IS the continuity, so there is nothing to validate without it" }
      /** The section validation. */
      const validation = validateHandoffText(content)
      if (!validation.ok) return { ok: false, error: "cellwork_handoff: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", "), ...{ missing: validation.missing, sections: validation.sections } }
      /** The ordinal of this handoff (one past the last one written). */
      const ordinal = member.handoffs + 1
      /** The absolute path written. */
      const path = writeHandoff(caller.workspace, caller.cell.cellId, caller.member, ordinal, content)
      /** The instant of the write. */
      const now = new Date()
      /** The record after the handoff. */
      const next: CellState = { ...caller.cell, members: { ...caller.cell.members, [caller.member]: { ...member, handoffReady: true, handoffs: ordinal } } }
      transition(caller.workspace, next, { event: "handoff", member: caller.member, ordinal, path, nextStep: nextStepOf(content) }, now)
      return { ok: true, path, member: caller.member, ordinal, sections: validation.sections, directive: handoffWrittenDirective(path) }
    },
  }))

  // ── cellwork_subteam ─────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_subteam",
    description: "A promoted SUBCAPTAIN's tool: register a sub-cell (parentCellId, depth+1) and receive the sub-captain directive. REFUSES `depth + 1 > cellwork.depth.max` with the exact bound. The sub-team itself is staged by the promoted agent with `agent_teams_plan`.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The sub-cell's objective, in the user's terms." },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          parentCellId: { type: "string" },
          // The parent cell's TEAM id, recorded on the sub-cell: the box this sub-team will nest inside.
          parentTeamId: { type: "string" },
          depth: { type: "number" },
          directive: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_subteam refused: " + String(result.error ?? "unknown refusal"))
        return render(String(result.directive ?? ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_subteam: this session belongs to no active cell" }
      // TWO SEATS MAY NEST, and they are the same person seen from two frames: a promoted member (a
      // `subcaptain` seat in the PARENT cell) and the CAPTAIN of a cell that is itself a sub-cell —
      // which is where R1's tree resolution puts that member once its own cell exists. The TOP cell's
      // captain is excluded, because promotion is what earns a sub-cell.
      /** Whether this caller may register a sub-cell. */
      const mayNest = caller.seat?.mode === "subcaptain" || (caller.seat?.mode === "captain" && caller.cell.parentCellId !== null)
      if (!mayNest) return { ok: false, error: "cellwork_subteam is SUBCAPTAIN ONLY: this session is " + JSON.stringify(caller.member) + " in mode " + JSON.stringify(caller.seat?.mode ?? "none") + " — a sub-cell is registered by a member the plugin promoted after its handoff+compaction (or by the captain of a sub-cell, to nest deeper)" }
      /** The parent cell. */
      const parent = caller.cell
      if (parent.phase === "stopped") return { ok: false, error: "cellwork_subteam: cell " + parent.cellId + " is stopped and archived" }
      /** The depth the child would take. */
      const childDepth = parent.depth + 1
      if (childDepth > config.depthMax) {
        return { ok: false, error: "cellwork_subteam: REFUSED — a sub-cell at depth " + String(childDepth) + " exceeds cellwork.depth.max = " + String(config.depthMax) + " (this cell is depth " + String(parent.depth) + "). Do the work inside this cell instead." }
      }
      /** The objective in the user's terms. */
      const objective = argString(readArgs(args), "objective").trim()
      if (objective === "") return { ok: false, error: "cellwork_subteam: `objective` is required — a sub-cell needs its own objective" }
      /** The instant the sub-cell is minted. */
      const now = new Date()
      // THE ID MUST NOT COLLIDE WITH AN EXISTING CELL (`cellIdAt` is millisecond-precision and a sub-cell
      // registered inside the parent's own minting millisecond would OVERWRITE that record). Measured while
      // proving D5: the collision silently replaced the parent cell's record with the sub-cell's. The
      // command path already mints through `freeCellId` for exactly this reason; this path now does too.
      /** The new sub-cell's id, free of every cell directory this workspace already has. */
      const subcellId = freeCellId(caller.workspace, now)
      // THE CELL PLANE'S HALF OF THE NESTING (cellwork wave 4, contract D5): the parent CELL already
      // knows which TEAM it drives, so the sub-cell records that team here. The sub-team's own
      // `parentTeamId` is passed nowhere — the team plane derives it at approval from the parent team's
      // roster, which records this promoted member's session — but the cell record can now be read
      // against it, and the directive tells the subcaptain where its box will land.
      /** The parent cell's live team id, or `""` when that cell never approved a team. */
      const parentTeamId = parent.teamId
      /** The sub-cell record: its captain is the promoted member calling this tool. */
      const subcell: CellState = { ...newCellState({ cellId: subcellId, objective, captainSessionId: caller.sessionId, now, depth: childDepth, parentCellId: parent.cellId }), parentTeamId }
      writeCell(caller.workspace, subcell)
      /** The parent record after registering the link. */
      const next: CellState = { ...parent, subcellIds: [...parent.subcellIds, subcellId] }
      transition(caller.workspace, next, { event: "subcell", subcellId, depth: childDepth, parentCellId: parent.cellId, parentTeamId, objective }, now)
      appendJournal(caller.workspace, subcellId, { event: "subcell-created", parentCellId: parent.cellId, depth: childDepth, captainSessionId: caller.sessionId, parentTeamId }, now)
      return { ok: true, cellId: subcellId, parentCellId: parent.cellId, parentTeamId, depth: childDepth, directive: subteamDirective(subcellId, childDepth, parent.cellId, parentTeamId) }
    },
  }))

  // ── cellwork_send ────────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_send",
    description: "Any cell seat: send one durable cell message to `captain`, a member of this cell by name, or `<cellId>/<captain|member>` for a cell in this cell's tree (a sub-cell it registered, or its parent). The row is appended to the RECIPIENT cell's own mail log FIRST (durable), then a wake-up is attempted through the team executor when the sender is this cell's captain and the recipient holds a handle; the attempt's outcome is appended to that same log as a `wake` record, so a failed wake-up leaves the row in place and is surfaced on `cellwork_supervise`. The journal carries the `cell:<cellId>` stamp.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "`captain`, a cell member's board name, or `<cellId>/<captain|member>` for a cross-cell recipient in this cell's tree." },
        subject: { type: "string", description: "One-line subject." },
        body: { type: "string", description: "The message text, delivered verbatim." },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          id: { type: "string" },
          to: { type: "string" },
          crossCell: { type: "string", description: "The cell id the row was written into, when the send crossed cells." },
          fromCell: { type: "string", description: "The sender's own cell id, mirrored onto a cross-cell row." },
          wakeSent: { type: "boolean" },
          wakeReason: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_send refused: " + String(result.error ?? "unknown refusal"))
        // THE ANSWER NAMES WHICH HALF FAILED (repair N1): "no wake-up" plus a reason that says the
        // transport refused it reads differently from a reason that says the RECORD of it was lost.
        return render("mail " + String(result.id ?? "") + " -> " + String(result.to ?? "") + (result.wakeSent === true ? " (wake-up sent)" : " (durable; " + String(result.wakeReason ?? "no wake-up was attempted") + ")"))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      // NARROWED ONCE, for the callbacks below: a closure cannot rely on the property narrowing above,
      // so the cell is bound to a local and every later read (including the two appends) uses it.
      /** The caller's own cell. */
      const cell = caller.cell
      if (cell === null || caller.member === "") return { ok: false, error: "cellwork_send: this session belongs to no active cell" }
      /** The requested recipient. */
      const requested = argString(argv, "to").trim()
      if (requested === "") return { ok: false, error: "cellwork_send: `to` is required (`captain`, a member name, or `<cellId>/<captain|member>` for a cell in this cell's tree)" }
      /** The subject. */
      const subject = argString(argv, "subject").trim()
      /** The body. */
      const body = argString(argv, "body")
      if (subject === "" || body.trim() === "") return { ok: false, error: "cellwork_send: `subject` and `body` are both required" }
      /**
       * The CROSS-CELL spelling `<cellId>/<name>`.
       *
       * A sub-cell and its parent address each other by the same rule (§4.9's "cross-cell"), and the
       * recipient may only be a cell IN THIS CELL'S TREE — a sub-cell it registered, or its own parent.
       * Cell ids and member names alike contain no `/`, so the last slash is the separator.
       */
      const slash = requested.lastIndexOf("/")
      /** The cell the row is addressed to: the caller's own cell, or the tree member named before the slash. */
      const targetCellId = slash < 0 ? cell.cellId : requested.slice(0, slash).trim()
      /** The name the recipient answers to inside the target cell. */
      const requestedName = slash < 0 ? requested : requested.slice(slash + 1).trim()
      if (requestedName === "") return { ok: false, error: "cellwork_send: " + JSON.stringify(requested) + " names no recipient — use `<cellId>/<captain|member>`" }
      /** Whether this send crosses into another cell of the tree. */
      const crossCell = targetCellId !== cell.cellId
      /** The target cell's record, when this send crosses cells. */
      let target: CellState = cell
      if (crossCell) {
        if (targetCellId !== cell.parentCellId && !cell.subcellIds.includes(targetCellId)) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(targetCellId) + " is not in this cell's tree — a cross-cell recipient must be a SUB-CELL of " + cell.cellId + " (" + (cell.subcellIds.join(", ") || "none") + ") or its parent cell (" + (cell.parentCellId ?? "none") + ")" }
        }
        /** The target cell's record, or the refusal this send answers with. */
        const read = readCell(caller.workspace, targetCellId)
        if (!read.ok) return { ok: false, error: "cellwork_send: the cross-cell recipient's record at " + read.path + " cannot be read (" + read.reason + ": " + read.detail + ") — nothing was sent", path: read.path }
        target = read.state
      }
      /** Whether the recipient is the target cell's captain. */
      const toCaptain = nameKey(requestedName) === "captain"
      /** The member row the recipient names, when it is a member of the target cell. */
      const recipientMember = toCaptain ? undefined : Object.values(target.members).find((member) => nameKey(member.name) === nameKey(requestedName))
      if (!toCaptain && recipientMember === undefined) {
        return { ok: false, error: "cellwork_send: " + JSON.stringify(requestedName) + " is neither `captain` nor a member of cell " + targetCellId + " (members: " + Object.keys(target.members).join(", ") + ")" }
      }
      /** The canonical recipient name. */
      const to = toCaptain ? "captain" : String(recipientMember?.name ?? requestedName)
      if (!crossCell && nameKey(to) === nameKey(caller.member)) return { ok: false, error: "cellwork_send: a seat cannot message itself" }
      /** The instant this row is stamped with. */
      const now = new Date()
      // THE ID EXISTS BEFORE ANYTHING IS WRITTEN (D6): the durable row and the `wake` record that follows
      // it must name the SAME message, so the id is minted first and both appends quote it.
      /** The id already used by the log this row is appended to, so a cross-cell id cannot shadow one. */
      const taken = new Set(readCellMail(caller.workspace, targetCellId).map((record) => record.id))
      /** The next unused id: the per-process sequence advanced until it is free in the target log. */
      let id = mailId(now, (mailSequence += 1))
      while (taken.has(id)) id = mailId(now, (mailSequence += 1))
      /**
       * The wake-up attempt, handed to {@link deliverCellMail} so it runs AFTER the durable row landed.
       *
       * It resolves its refusal instead of throwing there, because "no wake-up was attempted" and "the
       * transport failed" are different facts a reader needs; the wrapper classifies a throw as the latter.
       */
      const attemptWake = async (): Promise<{ sent: boolean; reason?: string }> => {
        if (crossCell) return { sent: false, reason: "cross-cell mail is DURABLE ONLY — this cell holds no Lead authority over " + targetCellId + ", so its captain wakes the row (it shows on that cell's `cellwork_supervise`)" }
        if (toCaptain) return { sent: false, reason: "the Lead has no executor handle in this composition; the captain reads it on `cellwork_inbox`" }
        if (caller.sessionId !== cell.captainSessionId) return { sent: false, reason: "only the captain holds the Lead authority the executor needs; a member-to-member message is durable and read on `cellwork_inbox`" }
        if (String(recipientMember?.executorRef ?? "") === "") return { sent: false, reason: "the recipient has no executor handle (never raised)" }
        /** The delivery binding, when the executor exists. */
        const send = sendThroughExecutor(dsh.teamExecutor(), exec.agent)
        if (send === undefined) return { sent: false, reason: "this composition exposes no team executor" }
        await send(String(recipientMember?.executorRef ?? ""), "[mpd-cellwork] mail from " + caller.member + ": " + subject + "\n\n" + body + "\n\n(full row: cell " + cell.cellId + ")")
        return { sent: true }
      }
      // THE ROW LANDS WHERE THE RECIPIENT READS IT: a cross-cell message is appended to the TARGET cell's
      // log (its `cellwork_inbox` reads that log), while the SENDER's journal records that it went out.
      /** The durable-first delivery: the row, then the wake-up attempt, then the attempt's outcome. */
      const delivery = await deliverCellMail({
        appendSend: () => appendCellMail(caller.workspace, targetCellId, { t: "send", id, cellId: targetCellId, from: caller.member, to, subject, body, at: now.toISOString(), wakeSent: false, ...(crossCell ? { fromCell: cell.cellId } : {}) }),
        attemptWake,
        appendWake: (outcome) => appendCellMail(caller.workspace, targetCellId, { t: "wake", id, sent: outcome.sent, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), at: now.toISOString() }),
      })
      if (!delivery.landed) return { ok: false, error: "cellwork_send: the message row could not be written — no message was sent and no wake-up was attempted (mail is durable first)" }
      appendJournal(caller.workspace, cell.cellId, { event: "mail", cell: "cell:" + cell.cellId, id, from: caller.member, to, ...(crossCell ? { toCell: targetCellId } : {}), subject, wakeSent: delivery.wakeSent }, now)
      return { ok: true, id, to, wakeSent: delivery.wakeSent, ...(crossCell ? { crossCell: targetCellId, fromCell: cell.cellId } : {}), ...(delivery.wakeReason === undefined ? {} : { wakeReason: delivery.wakeReason }) }
    },
  }))

  // ── cellwork_inbox ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_inbox",
    description: "Any cell seat: read and ACKNOWLEDGE the unread cell mail addressed to this seat (its member name, or `captain`). The rows are durable; reading them appends `read` records, so a second call does not return them again.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          seat: { type: "string" },
          messages: { type: "array", items: { type: "object" } },
          acknowledged: { type: "number" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return render("cellwork_inbox refused: " + String(result.error ?? "unknown refusal"))
        /** The delivered rows. */
        const messages = Array.isArray(result.messages) ? result.messages as Array<Record<string, unknown>> : []
        if (messages.length === 0) return render("no unread cell mail for " + String(result.seat ?? "?") + " — if a question is blocked here, ask the captain to check `cellwork_supervise`")
        return render(messages.map((message) => "[" + String(message.from) + "] " + String(message.subject) + "\n" + String(message.body)).join("\n\n---\n\n"))
      },
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<ProtocolResult> => {
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.member === "") return { ok: false, error: "cellwork_inbox: this session belongs to no active cell" }
      /** The seat's own names. */
      const seat = caller.member === "captain" ? "captain" : caller.member
      /** The folded mail. */
      const messages: CellMailMessage[] = foldCellMail(readCellMail(caller.workspace, caller.cell.cellId))
      /** The unread rows addressed here. */
      const unread = unreadFor(messages, [seat])
      /** The instant of the acknowledgement. */
      const now = new Date()
      /** How many acknowledgements were appended. */
      let acknowledged = 0
      for (const message of unread) {
        if (appendCellMail(caller.workspace, caller.cell.cellId, { t: "read", id: message.id, by: seat, at: now.toISOString() })) acknowledged += 1
      }
      if (acknowledged > 0) appendJournal(caller.workspace, caller.cell.cellId, { event: "mail-read", cell: "cell:" + caller.cell.cellId, seat, ids: unread.slice(0, acknowledged).map((message) => message.id) }, now)
      return { ok: true, seat, messages: unread.map((message) => ({ id: message.id, from: message.from, subject: message.subject, body: message.body, at: message.at })), acknowledged }
    },
  }))

  // ── the checkpoint listener (agent/pre-step) ─────────────────────────────
  /** The pre-step listener: detect, inject ONE message, flip the seat. Contained on every path. */
  const onPreStep = (payload: { agent?: unknown; turn?: number; messages?: readonly unknown[] }, decision: { kind?: string; messages?: readonly unknown[] } | undefined): { kind: "enter"; messages: readonly unknown[] } | undefined => {
    try {
      /** The step's agent, when the dispatcher fused it in. */
      const agent = payload?.agent
      if (agent === undefined || agent === null) return undefined
      /** The caller's context. */
      const caller = callerContext(dsh, { agent } as DshToolExec, { teams })
      if (caller.cell === null || caller.member === "" || caller.member === "captain") return undefined
      /** The live reading for this agent. */
      const pressure = dsh.contextPressure(agent)
      /** The decision, computed before anything is written. */
      const plan = planCheckpoint(caller.cell, caller.member, pressure, config, typeof payload.turn === "number" ? payload.turn : null)
      if (!plan.inject) return undefined
      /** The instant of the injection. */
      const now = new Date()
      /** The record after the flip. */
      const next = applyCheckpoint(caller.cell, plan, String(caller.cell.members[caller.member]?.sessionId ?? caller.sessionId), now)
      transition(caller.workspace, next, { event: "checkpoint", member: caller.member, usedTokens: plan.usedTokens, windowTokens: plan.windowTokens, turn: plan.turn, reason: plan.reason }, now)
      /** The ONE message this step receives. */
      const message = dsh.userMessage({ text: checkpointDirective(caller.member, plan), source: { kind: "mpd-cellwork", reason: "checkpoint" } })
      return { kind: "enter", messages: [...(decision?.messages ?? payload?.messages ?? []), message] }
    } catch (error) {
      deps.warn("[mpd-cellwork] the checkpoint listener failed: " + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }
  /** The host-plane pre-step registration (a composition with no event bus is a stated absence). */
  const preStepDispose = dsh.onAgentPreStep(onPreStep)
  if (typeof preStepDispose === "function") disposers.push(preStepDispose)

  // ── the compaction barrier (agent/turn-stopping) ─────────────────────────
  /**
   * Run the post-handoff barrier for one agent, when that member is handoff-ready.
   *
   * @param agent - the stopping agent handle.
   */
  const runBarrier = async (agent: unknown): Promise<void> => {
    /** The caller's context. */
    const caller = callerContext(dsh, { agent } as DshToolExec, { teams })
    if (caller.cell === null || caller.member === "") return
    /** The member row as the event found it. */
    const member = caller.cell.members[caller.member]
    if (member === undefined || !member.handoffReady) return
    /** The in-flight key, so one turn cannot start two barriers. */
    const key = caller.cell.cellId + "/" + caller.member
    if (inFlight.has(key)) return
    inFlight.add(key)
    try {
      /** The latest handoff document's text. */
      let handoffText = ""
      try {
        handoffText = readFileSync(handoffPath(caller.workspace, caller.cell.cellId, caller.member, member.handoffs), "utf8")
      } catch {
        handoffText = "(the handoff document could not be read back; the journal names its path)"
      }
      /** The barrier's outcome. */
      const result = await promoteAfterHandoff({
        dsh,
        agent,
        memberName: caller.member,
        sessionId: member.sessionId,
        cell: caller.cell,
        config,
        handoffText,
        nextStep: nextStepOf(handoffText),
        injectDirective: (text): void => {
          try {
            dsh.injectAgentMessage(agent, dsh.userMessage({ text, source: { kind: "mpd-cellwork", reason: "promotion" } }))
          } catch (error) {
            deps.warn("[mpd-cellwork] the promotion directive could not be injected: " + (error instanceof Error ? error.message : String(error)))
          }
        },
        sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
      })
      /** The instant the outcome is stamped with. */
      const now = new Date()
      // RE-READ before writing: a concurrent claim/complete may have moved the record during the await.
      const fresh = readCell(caller.workspace, caller.cell.cellId)
      if (!fresh.ok) {
        deps.warn("[mpd-cellwork] the compaction barrier could not re-read " + fresh.path + ": " + fresh.detail)
        return
      }
      /** The member row after the barrier (this outcome decides the fence markers and may mint a handle). */
      const updated: CellMemberRecord = memberAfterBarrier(fresh.state.members[caller.member] ?? member, result)
      /** The record after the barrier. */
      const next: CellState = { ...fresh.state, members: { ...fresh.state.members, [caller.member]: updated } }
      // THE GIVEN-UP BARRIER GETS ITS OWN JOURNAL ROW (C7): the compaction row below reports the attempt,
      // this one reports that the member is now OUT OF SERVICE and which verb repairs its rows.
      if (result.outcome === "refused") appendJournal(caller.workspace, caller.cell.cellId, checkpointUnrecoverableEntry(caller.member, result), now)
      transition(caller.workspace, next, compactionJournalEntry(caller.member, result), now)
    } finally {
      inFlight.delete(key)
    }
  }
  /** The turn-stopping listener: fire-and-forget, contained, never blocks the harness's own stop. */
  const stopDispose = dsh.onEvent("agent/turn-stopping", (payload: unknown) => {
    try {
      /** The stopping agent, when the event payload carries it. */
      const agent = typeof payload === "object" && payload !== null ? (payload as { agent?: unknown }).agent : undefined
      if (agent === undefined || agent === null) return
      void runBarrier(agent).catch((error: unknown) => deps.warn("[mpd-cellwork] the compaction barrier failed: " + (error instanceof Error ? error.message : String(error))))
    } catch (error) {
      deps.warn("[mpd-cellwork] the turn-stopping listener failed: " + (error instanceof Error ? error.message : String(error)))
    }
  })
  if (typeof stopDispose === "function") disposers.push(stopDispose)
  return disposers
}
