import { zstdDecompressSync } from "node:zlib"
import { scanZstdFrames } from "../../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { projectKey } from "../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { Inputs, instant, key, object, type Row } from "./input.ts"

/** Current assignment captured from the MPD board, before joining any retained receipts. */
export interface Assignment {
  /** Durable board identity, needed because task IDs repeat across boards. */
  readonly teamId: string
  /** Task identifier within that board. */
  readonly taskId: string
  /** Captured claimed or in-progress status. */
  readonly status: string
  /** Verbatim owner field from the board. */
  readonly owner: string | null
  /** The unique roster seat matching that owner, where resolvable. */
  readonly seat: string | null
  /** The durable executor handle recorded for that seat. */
  readonly executor: string | null
  /** Lead session ID, which identifies the captain's retained trace. */
  readonly captain: string | null
  /** Per-task claim attempt counter. */
  readonly attempt: number | null
  /** Board mutation number used as the watchdog's attemptId. */
  readonly revision: number | null
  /** Corroborated dispatch time in Unix milliseconds. */
  readonly pairedAt: number | null
  /** Lower bound in Unix milliseconds from the board's current revision and corroborated dispatch. */
  readonly assignmentNotBefore: number | null
  /** Whether the board seat is an ordinary worker and eligible for attribution. */
  readonly ordinary: boolean | "unknown"
}

/** Only receipt coordinates are emitted. The structured payload stays in memory. */
interface ToolReceipt {
  /** Registered name from the actual harness tool-call event. */
  readonly tool: string
  /** Call key scoped to the matching actor session. */
  readonly callId: string
  /** Start time in Unix milliseconds. */
  readonly startedAt: number
  /** Successful result time in Unix milliseconds. */
  readonly at: number
  /** Session artifact relative to the workspace. */
  readonly path: string
  /** One-based line in the decompressed session artifact. */
  readonly line: number
  /** Structured output when preserved, inspected to detect logical refusals. */
  readonly payload: Row | undefined
  /** Structured call arguments when preserved, inspected to distinguish tool verbs. */
  readonly args: Row | undefined
}

/** Retain only linkage keys and timing in the serialized report. */
function receiptRef(receipt: ToolReceipt): object {
  return { tool: receipt.tool, callId: receipt.callId, at: new Date(receipt.at).toISOString(), path: receipt.path, line: receipt.line }
}

/** Some tools keep JSON in their rendered text; standalone text is a valid result too. */
function structured(value: unknown): Row | undefined {
  if (typeof value !== "string") return object(value)
  try { return object(JSON.parse(value)) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/** Read exactly one session artifact from its native v3/v4 workspace-keyed directory. */
function sessionReceipts(input: Inputs, root: string, session: string): ToolReceipt[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) return []
  /** The exact actor identity is carried in both the path and the session header. */
  const dir = `${root}/${session}`
  /** Selection is deterministic and refuses an ambiguous capture. */
  const files = input.directory(dir).filter(({ name }) => /^session\.v[34]\.jsonl(?:\.zstd)?$/.test(name))
  if (files.length !== 1 || files[0] === undefined) {
    if (files.length > 1) input.malformed(dir, "multiple session artifacts for one actor")
    return []
  }
  /** The source path becomes a compact pointer for the user's replay. */
  const path = `${dir}/${files[0].name}`
  /** Hash the same raw bytes the harness format decoder receives. */
  const bytes = input.bytes(path)
  if (bytes === undefined) return []
  /** Preserve the valid prefix of an interrupted append using the existing frame scanner. */
  let text: string
  try {
    if (path.endsWith(".zstd")) {
      /** Each independent zstd frame has to be decompressed on its own. */
      const scan = scanZstdFrames(bytes)
      if (scan.tornStart !== undefined) input.malformed(path, "torn zstd frame at end of session")
      text = scan.frames.map(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)).toString("utf8")).join("")
    } else text = bytes.toString("utf8")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    input.malformed(path, "unreadable session compression")
    return []
  }
  /** Do not accept another executor's trace copied to the expected filename. */
  const lines = input.lines(path, text)
  /** The first line is the harness's own identity header. */
  const header = lines[0]?.row
  if (lines[0]?.line !== 1 || header?.type !== "session" || header.id !== session || header.cwd !== input.root || (header.version !== 3 && header.version !== 4)) {
    input.malformed(path, "session header does not identify this workspace and actor")
    return []
  }
  /** Match exactly one call and exactly one result by call ID within this actor's session. */
  const calls = new Map<string, { tool: string; at: number; args: Row | undefined }>()
  /** Duplicates must never let an unrelated outcome overwrite the original. */
  const seenResults = new Set<string>()
  /** Both duplicate calls and duplicate results poison the corresponding key. */
  const ambiguous = new Set<string>()
  /** Receipt payloads stay local to the join and classification. */
  const receipts: ToolReceipt[] = []
  for (const { row, line } of lines) {
    /** v3 and v4 both carry the tool event under data. */
    const data = object(row.data)
    /** The host clock is epoch ms in native event records. */
    const at = instant(row.time ?? row.at)
    if (row.type === "tool/call") {
      /** The tool name and call ID are required to correlate the result. */
      const callId = key(data?.callId)
      /** The harness's registered name is the safe action descriptor. */
      const tool = key(data?.name)
      if (callId === undefined || tool === undefined || at === undefined) {
        input.malformed(path, "tool call missing name, id, or time", line)
        continue
      }
      if (calls.has(callId)) ambiguous.add(callId)
      calls.set(callId, { tool, at, args: structured(data?.arguments) })
    }
    if (row.type !== "tool/result") continue
    /** v4 hoists the tool result. v3 wraps it as one tool-result content block. */
    const message = object(data?.message)
    /** The v3 block and the v4 message expose the same outcome fields. */
    const result = key(message?.toolCallId) !== undefined ? message : Array.isArray(message?.content) ? object(message.content[0]) : undefined
    /** A missing id or timestamp cannot prove success for a known call. */
    const callId = key(result?.toolCallId)
    if (callId === undefined || at === undefined || typeof result?.isError !== "boolean") {
      input.malformed(path, "tool result missing id, success flag, or time", line)
      continue
    }
    if (seenResults.has(callId)) ambiguous.add(callId)
    seenResults.add(callId)
    /** Settled results only count when their actual call previously appeared. */
    const call = calls.get(callId)
    if (call === undefined || result.isError || at < call.at) continue
    /** A structured false/refused outcome overrides a non-error transport result. */
    const blocks: readonly unknown[] = Array.isArray(result.content) ? result.content : []
    /** A payload split across text blocks is rendered as one logical value. */
    const payload = structured(blocks.map((block) => key(object(block)?.text) ?? "").join(""))
    if (payload?.ok === false || payload?.success === false || payload?.refused !== undefined || payload?.error !== undefined) continue
    receipts.push({ tool: call.tool, callId, startedAt: call.at, at, path, line, payload, args: call.args })
  }
  return receipts.filter(({ callId }) => !ambiguous.has(callId))
}

/** A status observation must prove the same board, claim attempt, logical seat and executor. */
function observes(receipt: ToolReceipt, assignment: Assignment): boolean {
  if (receipt.tool !== "agent_teams_plan" || receipt.args?.action !== "status") return false
  /** The native plan status result includes the authoritative team, when retained losslessly. */
  const team = object(receipt.payload?.team)
  if (team?.teamId !== assignment.teamId || team.leadSessionId !== assignment.captain) return false
  /** Short task IDs alone are insufficient, even on the correct board. */
  const tasks: readonly unknown[] = Array.isArray(team.tasks) ? team.tasks : []
  /** A roster row in the observation must corroborate the worker identity at that time. */
  const members: readonly unknown[] = Array.isArray(team.members) ? team.members : []
  return tasks.map(object).some((task) => task?.id === assignment.taskId && task.owner === assignment.owner && task.attempt === assignment.attempt && (task.revision === assignment.revision || ((task.status === "completed" || task.status === "failed") && task.revision === Number(assignment.revision) + 1)))
    && members.map(object).some((member) => member?.name === assignment.seat && member.executorRef === assignment.executor)
}

/** Predicates identify only successful lifecycle operations that name the assignment. */
function lifecycle(receipt: ToolReceipt, assignment: Assignment): boolean {
  if (receipt.tool === "cellwork_handoff" || (receipt.tool === "agent_teams_task" && receipt.args?.action === "handoff")) {
    return receipt.payload?.ok === true && receipt.payload.member === assignment.seat && key(receipt.payload.path) !== undefined
  }
  return receipt.tool === "agent_teams_task" && (receipt.args?.action === "complete" || receipt.args?.action === "fail")
    && receipt.args.task_id === assignment.taskId && receipt.payload?.taskId === assignment.taskId
    && receipt.payload.status === (receipt.args.action === "complete" ? "completed" : "failed")
    && receipt.payload.attempt === assignment.attempt && receipt.payload.revision === Number(assignment.revision) + 1
}

/** Observe only actual actions, excluding the known wake, dispatch and mail-only surfaces. */
function workAction(receipt: ToolReceipt): boolean {
  if (receipt.tool === "agent_teams_task") return false
  return !/^(?:cellwork_handoff|cellwork_supervise|cellwork_send|agent_teams_mail|send_message|.*dispatch|.*wake)$/i.test(receipt.tool)
}

/** Resolve the attribution chain for each open assignment from optional local session captures. */
export function workerLoss(input: Inputs, assignments: readonly Assignment[], empty: boolean): object {
  /** Real host home is never searched. A retained sandbox can use this native layout. */
  const root = `.dsh/sessions/${projectKey(input.root)}`
  /** An empty workspace needs no optional sidecar probes. */
  const sourceStart = input.sources.length
  /** Disjoint actor traces cannot be substituted for one another. */
  const available = new Set((empty || assignments.length === 0 ? [] : input.directory(root)).map(({ name }) => name))
  /** Memoize exact actor reads when a seat owns more than one open row. */
  const sessions = new Map<string, ToolReceipt[]>()
  /** Use watchdog call coordinates only when tool results can be independently loaded. */
  const heartbeatDir = ".mpd/team/watchdog/heartbeat"
  /** Files use sanitized names; each stamp carries the verbatim logical seat. */
  const stampFiles = available.size === 0 ? [] : input.directory(heartbeatDir).filter(({ name }) => name.endsWith(".jsonl"))
  /** Index starts by call ID rather than re-scanning the heartbeat history for every receipt. */
  const stamps = new Map<string, Row[]>()
  for (const { name } of stampFiles) {
    for (const { row } of input.lines(`${heartbeatDir}/${name}`)) {
      /** A board-scoped call must have a usable id in the exact workload workspace. */
      const callId = key(row.callId)
      if (row.kind !== "tool-start" || row.workspace !== input.root || callId === undefined) continue
      /** Call IDs can collide across sessions and remain subject to identity and clock checks. */
      const candidates = stamps.get(callId) ?? []
      candidates.push(row)
      stamps.set(callId, candidates)
    }
  }
  /** Retain unknown values explicitly, including assignments for which no roster member resolved. */
  const rows = assignments.map(({ captain, pairedAt, ...row }) => {
    /** The capture can lack either a usable attempt stamp or the actual executing actor. */
    const unknown = { ...row, pairedAt, lastSuccessfulAction: "unknown", subsequentHandoffOrTerminal: "unknown", nextCaptainObservation: "unknown" }
    /** Require a positive assignment clock even if the generation and actor happen to match. */
    const notBefore = row.assignmentNotBefore
    if (row.ordinary !== true || row.executor === null || row.seat === null || row.revision === null || row.attempt === null || notBefore === null || !available.has(row.executor)) return unknown
    /** The actor identity is confirmed by the session header before any join. */
    const receipts = sessions.get(row.executor) ?? sessionReceipts(input, root, row.executor)
    sessions.set(row.executor, receipts)
    /** The watchdog uses the board revision as its generation token, never the claim attempt. */
    const ownReceipts = receipts.filter((receipt) => (stamps.get(receipt.callId) ?? []).some((stamp) => {
      /** The start must be on the current revision before the recorded tool completion. */
      const start = instant(stamp.at)
      return stamp.teamId === row.teamId && stamp.taskId === row.taskId && stamp.member === row.seat
        && stamp.attemptId === String(row.revision) && stamp.tool === receipt.tool && stamp.callId === receipt.callId
        && start !== undefined && start >= receipt.startedAt && start <= receipt.at && receipt.startedAt >= notBefore
    })).sort((a, b) => a.at - b.at)
    /** The last work receipt anchors the following lifecycle and captain observations. */
    const last = ownReceipts.filter(workAction).at(-1)
    if (last === undefined) return unknown
    /** Avoid accepting same-time records whose cross-source order cannot be proved. */
    const after = ownReceipts.find((receipt) => receipt.startedAt > last.at && lifecycle(receipt, { ...row, captain, pairedAt }))
    /** Prefer a captain read after the lifecycle event when one was observed. */
    const floor = after?.at ?? last.at
    /** Unrelated captain tool reads need no special handling because observes() validates identity. */
    const captainReceipts = captain === null || !available.has(captain) ? [] : sessions.get(captain) ?? sessionReceipts(input, root, captain)
    if (captain !== null && available.has(captain)) sessions.set(captain, captainReceipts)
    /** Earliest compatible observation after the last observed worker transition. */
    const seen = captainReceipts.filter((receipt) => receipt.startedAt > floor && observes(receipt, { ...row, captain, pairedAt })).sort((a, b) => a.at - b.at)[0]
    return { ...unknown, lastSuccessfulAction: receiptRef(last), subsequentHandoffOrTerminal: after === undefined ? "unknown" : receiptRef(after), nextCaptainObservation: seen === undefined ? "unknown" : receiptRef(seen) }
  })
  return { assignments: rows, retainedSessionCoverage: empty || assignments.length === 0 ? "not-needed" : available.size === 0 ? "unavailable" : input.complete(sourceStart, true) ? "present" : "partial", retainedSessionRoot: root }
}
