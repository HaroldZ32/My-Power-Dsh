// THE SHARED `mpdTeamActions` DOUBLE — one in-memory team plane for every cellwork test harness.
//
// WHY ONE FILE. W2-D makes cellwork DELEGATE dispatch pairing, reassignment, hand-off and fencing to
// `mpdTeamActions`. A harness that faked that service per file would copy the same five members into a
// dozen tools, and each copy would drift the moment the plane's contract moved — the failure the
// repository's "one definition" rule exists to prevent. This module is that ONE definition.
//
// WHAT IT IS: a faithful STAND-IN for the plane's CONTRACT — the result envelopes, the owner-only
// decision with the plane's own refusal sentences, the reassignment checks (including W2-C's readiness
// refusal), the hand-off record, the fence pair and the cancellation. It mutates the SAME team record
// the harness's `mpdTeams` double answers, so a tool that delegates and then reads the record sees one
// board. A harness that still needs a bespoke fake must say why in one line.
//
// WHAT IT IS NOT: the production plane. It keeps no dispatch ledger, writes no files, journals nothing
// and runs no C7-3 consistency pass — none of which a cellwork arm asserts. The engine's own arms live
// in `packages/mpd-team-core-plugin/test/`.

/** One member row, in the shape the double mutates. */
export interface DoubleMember {
  /** Stable row id (`M1`, …). */
  id: string
  /** The display name the board uses. */
  name: string
  /** The member's state; only `inactive` is free for a pairing. */
  status: string
  /** The roster role label, when the harness set one. */
  role?: string
  /** The executor's handle — the session a hand-off or a delivery addresses. */
  executorRef?: string
  /** The seat mode (`member` | `checkpoint`); `checkpoint` is a closed seat. */
  mode?: string
  /** True when the seat is fenced. */
  fenced?: boolean
  /** Why it was fenced. */
  fencedReason?: string
  /** MUTABLE extras a harness relies on (cellwork's own mirror fields, for instance). */
  [key: string]: unknown
}

/** One task row, in the shape the double mutates. */
export interface DoubleTask {
  /** Board id (`T1`, …). */
  id: string
  /** One-line title. */
  subject: string
  /** The acceptance text; the delivery message carries it VERBATIM. */
  description?: string
  /** The task's state. */
  status: string
  /** Declared blockers. */
  blockedBy?: readonly string[]
  /** The declared owner's display name. */
  owner?: string
  /** Paths the task may write (C7-2 reads this). */
  writeScopes?: readonly string[]
  /** MUTABLE extras a harness relies on. */
  [key: string]: unknown
}

/** The team record slice the double reads and mutates — the SAME object `mpdTeams.get` answers. */
export interface DoubleTeamRecord {
  /** The team id. */
  teamId: string
  /** The roster. */
  members: DoubleMember[]
  /** The board. */
  tasks: DoubleTask[]
  /** MUTABLE extras a harness relies on. */
  [key: string]: unknown
}

/** The normalized name key two spellings must agree on (`Senior Engineer` → `senior-engineer`). */
function nameKey(name: string): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * Why one seat is CLOSED, or undefined when it is open — the plane's ONE spelling.
 * @param member - the roster row.
 * @returns the reason clause, or undefined.
 */
function closedReason(member: DoubleMember): string | undefined {
  if (member.fenced === true) return "the compaction barrier gave up and fenced it" + (typeof member.fencedReason === "string" && member.fencedReason !== "" ? " (" + member.fencedReason + ")" : "")
  if (member.mode === "checkpoint") return "its mode is `checkpoint` — the seat is fenced to the handoff tools until the barrier compacts it"
  return undefined
}

/** What the harness supplies to build one double. */
export interface TeamActionsDoubleOptions {
  /** The live record the double reads and MUTATES; a getter, because harnesses swap the object. */
  record: () => DoubleTeamRecord | undefined
  /** Deliver one dispatch message (handle, text). Absent means the harness records nothing. */
  send?: (handle: string, text: string) => void
  /** Roster names whose seats are READ-ONLY (the C7-2 parity the real plane enforces). */
  readonlyNames?: readonly string[]
}

/** The double as a harness sees it. */
export interface TeamActionsDouble {
  /** The service object a harness publishes under the `mpdTeamActions` id. */
  service: {
    /** One dispatch pass, owner-only by default. */
    dispatch: (input: Record<string, unknown>) => Promise<Record<string, any>>
    /** Fence one seat. */
    fence: (input: Record<string, unknown>) => Promise<Record<string, any>>
    /** Clear one seat's fence and its checkpoint window. */
    unfence: (input: Record<string, unknown>) => Promise<Record<string, any>>
    /** Write a member's hand-off document and close its seat. */
    handoff: (input: Record<string, unknown>) => Promise<Record<string, any>>
    /** Cancel named board rows. */
    cancelTasks: (input: Record<string, unknown>) => Promise<Record<string, any>>
  }
  /** Every dispatch input forwarded, in call order — so an arm can prove the DELEGATION. */
  dispatches: Array<Record<string, unknown>>
  /** Every hand-off input forwarded. */
  handoffs: Array<Record<string, unknown>>
  /** Every fence/unfence input forwarded. */
  fences: Array<Record<string, unknown>>
  /** Every cancellation input forwarded. */
  cancellations: Array<Record<string, unknown>>
}

/**
 * Build one in-memory `mpdTeamActions`.
 * @param options - the record getter, the delivery seam and the read-only roster names.
 * @returns the service and the call logs an arm can assert on.
 */
export function createTeamActionsDouble(options: TeamActionsDoubleOptions): TeamActionsDouble {
  /** Every dispatch input forwarded. */
  const dispatches: Array<Record<string, unknown>> = []
  /** Every hand-off input forwarded. */
  const handoffs: Array<Record<string, unknown>> = []
  /** Every fence input forwarded. */
  const fences: Array<Record<string, unknown>> = []
  /** Every cancellation input forwarded. */
  const cancellations: Array<Record<string, unknown>> = []
  /** The read-only name keys, normalized once. */
  const readonly = new Set((options.readonlyNames ?? []).map((name) => nameKey(name)))

  /**
   * Deliver one message, when the harness records deliveries.
   * @param member - the seat the message addresses.
   * @param task - the board row.
   */
  const deliver = (member: DoubleMember, task: DoubleTask): void => {
    options.send?.(member.executorRef ?? "", "You have been assigned shared task " + task.id + ": " + task.subject + "\n\n" + String(task.description ?? "") + "\n\nWork it on your own; do not wait for another member to start it.")
  }

  /**
   * Read the `reassign` argument as the plane does.
   * @param value - the raw value.
   * @returns the readable pairs and one sentence per entry refused.
   */
  const readPairs = (value: unknown): { pairs: Array<{ taskId: string; owner: string }>; invalid: string[] } => {
    /** The readable pairs. */
    const pairs: Array<{ taskId: string; owner: string }> = []
    /** One sentence per unreadable entry. */
    const invalid: string[] = []
    if (value === undefined) return { pairs, invalid }
    if (!Array.isArray(value)) return { pairs, invalid: ["`reassign` must be an array of {task_id, owner} objects"] }
    for (const entry of value) {
      /** The entry as a record. */
      const row = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : undefined
      /** The task id, from either spelling. */
      const taskId = typeof row?.task_id === "string" ? row.task_id.trim() : typeof row?.taskId === "string" ? row.taskId.trim() : ""
      /** The member name. */
      const owner = typeof row?.owner === "string" ? row.owner.trim() : ""
      if (taskId === "" || owner === "") {
        invalid.push("every `reassign` entry needs a non-empty `task_id` and `owner` (got " + JSON.stringify(entry) + ")")
        continue
      }
      pairs.push({ taskId, owner })
    }
    return { pairs, invalid }
  }

  /**
   * The blockers of one row that still block, through the plane's readiness predicate.
   * @param record - the live record.
   * @param task - the row.
   * @returns the blocking ids.
   */
  const unmet = (record: DoubleTeamRecord, task: DoubleTask): string[] => {
    /** The ids that block. */
    const out: string[] = []
    for (const id of task.blockedBy ?? []) {
      /** The blocker's own status; an unknown id blocks (the plane's rule). */
      const status = record.tasks.find((row) => row.id === id)?.status
      if (status === "completed" || status === "cancelled") continue
      out.push(id)
    }
    return out
  }

  /**
   * Whether one seat is FREE for a pairing, by the plane's own pool rule (`idleMembers`).
   *
   * `inactive` is not the only free state: a member that is `running` but owns no open task is free too —
   * that is exactly the approved-but-not-yet-settled window, and the plane's pool includes it. Only a
   * FAILED seat and one still being raised are excluded.
   * @param record - the live record.
   * @param member - the seat under consideration.
   * @returns true when the seat may take a pairing.
   */
  const isFree = (record: DoubleTeamRecord, member: DoubleMember): boolean => {
    if (member.status === "failed" || member.status === "provisioning") return false
    return !record.tasks.some((task) => (task.status === "in_progress" || task.status === "claimed") && nameKey(task.owner ?? "") === nameKey(member.name))
  }

  return {
    dispatches,
    handoffs,
    fences,
    cancellations,
    service: {
      dispatch: async (input: Record<string, unknown>): Promise<Record<string, any>> => {
        dispatches.push(input)
        /** The requested pairing rule. */
        const mode = input.mode
        if (mode !== undefined && mode !== "owner-only" && mode !== "roster") return { ok: false, error: `agent_teams_dispatch: unknown mode "${String(mode)}" (owner-only | roster)` }
        /** The readable hand-overs. */
        const handover = readPairs(input.reassign)
        if (handover.invalid.length > 0) return { ok: false, error: "agent_teams_dispatch: " + handover.invalid.join("; ") }
        /** The live record. */
        const record = options.record()
        if (record === undefined) return { ok: false, error: "no team record in this workspace — approve a plan first" }
        /** The pairing rule in force. */
        const rule = mode === "roster" ? "roster" : "owner-only"
        /** The rows this pass claimed, so it does not pair them again. */
        const claimedRows = new Set<string>()
        /** The hand-over outcomes. */
        const reassigned: Array<Record<string, unknown>> = []
        for (const pair of handover.pairs) {
          /** The row the pair names. */
          const task = record.tasks.find((row) => row.id === pair.taskId)
          if (task === undefined) { reassigned.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no board row is named ${JSON.stringify(pair.taskId)} — nothing was reassigned` }); continue }
          if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") { reassigned.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is already ${task.status} — a terminal row is never reopened` }); continue }
          if (task.status !== "pending") { reassigned.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is ${task.status}; release it first` }); continue }
          /** The target seat. */
          const member = record.members.find((row) => row.id === pair.owner || nameKey(row.name) === nameKey(pair.owner))
          if (member === undefined) { reassigned.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no member ${JSON.stringify(pair.owner)} is on the roster of team ${record.teamId}` }); continue }
          /** Why the seat is closed, when it is. */
          const closed = closedReason(member)
          if (closed !== undefined) { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is FENCED (${closed}) — a fenced member is never messaged` }); continue }
          if (member.status === "failed") { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} FAILED to start, so it cannot take the row — pick a live member, and raise this seat again first` }); continue }
          if (member.status === "provisioning") { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is still being raised, so it cannot take the row yet — wait for its handle, then reassign` }); continue }
          if ((task.writeScopes ?? []).length > 0 && readonly.has(nameKey(member.name))) { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `refused a WRITE-TASK-ON-READ-ONLY pairing: task ${pair.taskId} has write scopes (${(task.writeScopes ?? []).join(", ")}) while member ${JSON.stringify(member.name)} is a read-only specialist` }); continue }
          // W2-C'S READINESS REFUSAL, in the plane's own wording.
          /** The blockers that still block. */
          const blocking = unmet(record, task)
          if (blocking.length > 0) { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `task ${task.id} ${JSON.stringify(task.subject)} is BLOCKED by ${blocking.join(", ")}: the declared ${blocking.length === 1 ? "blocker is" : "blockers are"} not satisfied — close ${blocking[0]} first (agent_teams_task {action:"complete", task_id:"${blocking[0]}"}) or fail it, which releases its dependents, then reassign ${pair.taskId}` }); continue }
          if ((member.executorRef ?? "") === "") { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} has no executor handle (never raised)` }); continue }
          if (input.dryRun === true) { reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: "dry run — nothing was claimed, journaled or sent" }); continue }
          task.status = "in_progress"
          task.owner = member.name
          claimedRows.add(task.id)
          deliver(member, task)
          reassigned.push({ taskId: pair.taskId, owner: member.name, claimed: true, delivered: true })
        }
        /** The pairings this pass decided. */
        const pairs: Array<Record<string, unknown>> = []
        /** Every row left out. */
        const skipped: Array<Record<string, unknown>> = []
        /** The seats paired in this pass. */
        const paired = new Set<string>()
        for (const task of record.tasks) {
          if (claimedRows.has(task.id)) continue
          /** The declared owner's key. */
          const ownerKey = nameKey(task.owner ?? "")
          /** The blockers that still block, and whether the pass may consider the row at all. */
          const pendingBlocked = task.status === "pending" && unmet(record, task).length > 0
          if (task.status === "cancelled") { skipped.push({ taskId: task.id, subject: task.subject, reason: "cancelled" }); continue }
          if (task.status === "completed") { skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" }); continue }
          if (task.status !== "pending") { skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready (status ${task.status})` }); continue }
          if (pendingBlocked) { skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready (blocked by ${unmet(record, task).join(", ")})` }); continue }
          if (ownerKey === "") { skipped.push({ taskId: task.id, subject: task.subject, reason: "the row declares no owner — owner-only dispatch never substitutes a member (declare `owner` on the row, or run the pass with mode:\"roster\")" }); continue }
          /** The owner row. */
          const owner = record.members.find((member) => nameKey(member.name) === ownerKey)
          if (owner === undefined) { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(String(task.owner ?? ""))} is not on this team's roster — the row stays pending` }); continue }
          /** Why the owner's seat is closed, when it is. */
          const closed = closedReason(owner)
          if (closed !== undefined) { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(owner.name)} is FENCED (${closed}) — a fenced member is never messaged; reassign the row: agent_teams_dispatch {reassign:[{task_id:${JSON.stringify(task.id)}, owner:"<another member>"}]}` }); continue }
          if (owner.status === "failed") { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(owner.name)} FAILED to start` }); continue }
          if (owner.status === "provisioning") { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(owner.name)} is still being raised` }); continue }
          if (paired.has(ownerKey)) { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(owner.name)} was already paired in this pass (one task per member)` }); continue }
          if (!isFree(record, owner)) { skipped.push({ taskId: task.id, subject: task.subject, reason: `declared owner ${JSON.stringify(owner.name)} is not idle (status ${JSON.stringify(owner.status)})` }); continue }
          if ((task.writeScopes ?? []).length > 0 && readonly.has(ownerKey)) { skipped.push({ taskId: task.id, subject: task.subject, reason: `refused a WRITE-TASK-ON-READ-ONLY pairing: task ${task.id} has write scopes (${(task.writeScopes ?? []).join(", ")}) while member ${JSON.stringify(owner.name)} is a read-only specialist` }); continue }
          if (rule === "roster") {
            /** The first free seat in roster order. */
            const fallback = record.members.find((member) => isFree(record, member) && closedReason(member) === undefined && !paired.has(nameKey(member.name)))
            if (fallback === undefined) { skipped.push({ taskId: task.id, subject: task.subject, reason: "no idle member is free" }); continue }
            task.status = "in_progress"
            task.owner = fallback.name
            paired.add(nameKey(fallback.name))
            deliver(fallback, task)
            pairs.push({ taskId: task.id, subject: task.subject, memberId: fallback.executorRef ?? fallback.id, memberName: fallback.name })
            continue
          }
          task.status = "in_progress"
          paired.add(ownerKey)
          deliver(owner, task)
          pairs.push({ taskId: task.id, subject: task.subject, memberId: owner.executorRef ?? owner.id, memberName: owner.name })
        }
        return { ok: true, pairs, skipped, ...(reassigned.length === 0 ? {} : { reassigned }) }
      },
      fence: async (input: Record<string, unknown>): Promise<Record<string, any>> => {
        fences.push(input)
        /** The live record. */
        const record = options.record()
        if (record === undefined) return { ok: false, error: "no team record in this workspace — approve a plan first" }
        /** The named seat. */
        const member = record.members.find((row) => row.name === input.member || row.id === input.member)
        if (member === undefined) return { ok: false, error: `no member ${JSON.stringify(String(input.member ?? ""))} is on the roster of team ${record.teamId}` }
        member.fenced = true
        if (typeof input.reason === "string" && input.reason !== "") member.fencedReason = input.reason
        return { ok: true, teamId: record.teamId, member: member.name, mode: member.mode }
      },
      unfence: async (input: Record<string, unknown>): Promise<Record<string, any>> => {
        fences.push(input)
        /** The live record. */
        const record = options.record()
        if (record === undefined) return { ok: false, error: "no team record in this workspace — approve a plan first" }
        /** The named seat. */
        const member = record.members.find((row) => row.name === input.member || row.id === input.member)
        if (member === undefined) return { ok: false, error: `no member ${JSON.stringify(String(input.member ?? ""))} is on the roster of team ${record.teamId}` }
        delete member.fenced
        delete member.fencedReason
        member.mode = "member"
        return { ok: true, teamId: record.teamId, member: member.name, mode: member.mode }
      },
      handoff: async (input: Record<string, unknown>): Promise<Record<string, any>> => {
        handoffs.push(input)
        /** The live record. */
        const record = options.record()
        if (record === undefined) return { ok: false, error: "no team record in this workspace — approve a plan first" }
        /** The seat whose executor handle is the calling session. */
        const member = record.members.find((row) => row.executorRef === input.sessionId)
        if (member === undefined) return { ok: false, error: `session ${String(input.sessionId ?? "")} is on no roster of team ${record.teamId} — only a member writes its own handoff` }
        /** The previous hand-off row. */
        const previous = typeof member.handoff === "object" && member.handoff !== null ? member.handoff as Record<string, unknown> : undefined
        /** The ordinal of this hand-off. */
        const ordinal = (typeof previous?.ordinal === "number" ? previous.ordinal : 0) + 1
        /** The document path the plane would write. */
        const path = ".mpd/team/handoff/" + record.teamId + "/" + nameKey(member.name) + "-" + String(ordinal) + ".md"
        member.handoff = { path, ordinal }
        member.mode = "checkpoint"
        return { ok: true, teamId: record.teamId, member: member.name, path, ordinal, mode: "checkpoint", directive: "[mpd-team] handoff written to " + path + ". END YOUR TURN NOW" }
      },
      cancelTasks: async (input: Record<string, unknown>): Promise<Record<string, any>> => {
        cancellations.push(input)
        /** The live record. */
        const record = options.record()
        if (record === undefined) return { ok: false, error: `no team record is named ${JSON.stringify(String(input.teamId ?? ""))} in this workspace` }
        /** The ids cancelled. */
        const cancelled: string[] = []
        /** One entry per id refused. */
        const skipped: Array<{ taskId: string; reason: string }> = []
        /** The ids this call names, read defensively off the tool argument. */
        const ids = Array.isArray(input.taskIds) ? input.taskIds.map(String) : []
        for (const taskId of ids) {
          /** The row this id names. */
          const row = record.tasks.find((task) => task.id === taskId)
          if (row === undefined) { skipped.push({ taskId, reason: `no board row is named ${JSON.stringify(taskId)}` }); continue }
          if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") { skipped.push({ taskId, reason: `row ${taskId} is already ${row.status} — a terminal row is never re-cancelled` }); continue }
          row.status = "cancelled"
          if (typeof input.note === "string" && input.note !== "") row.note = input.note
          cancelled.push(taskId)
        }
        return { ok: true, teamId: record.teamId, cancelled, skipped }
      },
    },
  }
}
