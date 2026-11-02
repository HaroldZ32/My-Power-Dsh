// THE TEAM'S DERIVED STAGE (contract §10 item A1).
//
// A board a human reads is not a state machine: it answers ONE question first — "is this team waiting on
// ME, or is it working?". `derivePhase` cannot answer that (it says `active` for any live team, however
// hopelessly blocked), and every surface used to re-derive its own answer from task statuses, which is how
// a record whose stored fields imply BLOCKED ended up rendered as WORKING.
//
// So the classification lives HERE, once, as a FIRST-MATCH table read top-to-bottom. It is PURE and TOTAL:
// it reads only fields the record already carries, never throws, never writes, and adds no persisted
// `stage` field anywhere — a stored stage would be a second truth that can drift from the board.
//
// THE TABLE, in order (the first match wins — this order IS the contract):
//   1. person(failed)   — a task is `failed`: a human decides repair, retry or acceptance.
//   2. person(review)   — a REVIEW task carries a verdict that is not `pass`: the next move is the captain's.
//   3. person(blocked)  — an open task still waits on an unfinished blocker: only someone OUTSIDE the team
//                         can clear it.
//   4. person(delivery) — every task is terminal and none failed: the work is DONE and awaits acceptance.
//   5. person(answer)   — nothing in flight, and a member stopped carrying a handoff: a seat asked for a
//                         decision and is waiting for it.
//   6. working(queued)  — a task is claimed or in progress (`queued` says ready work waits behind it).
//   7. idle             — live, nothing in flight and nothing waiting on a human.
//   8. ended            — the record's own phase is `ended`.
//
// WHY person(blocked) OUTRANKS working: a blocked task is the fact that will not change by itself, while a
// running one may; a surface that says "working" over a board that cannot advance is the defect the order
// exists to prevent.
import type { TeamMemberRecord, TeamRecord, TeamTaskRecord } from "./team-store"
import { derivePhase, taskVisual } from "./team-store"

/** Why a team is waiting on a PERSON — the five board facts no member can resolve alone. */
export type PersonReason = "delivery" | "answer" | "review" | "blocked" | "failed"

/** The derived stage of a team (or of one task on it, when the caller names one). */
export type TeamStage =
  /** The team cannot advance without a human. */
  | { kind: "person"; reason: PersonReason; taskId?: string }
  /** Work is in flight; `queued` is true when READY work is also waiting behind it. */
  | { kind: "working"; queued: boolean }
  /** Live, nothing in flight, nothing waiting on a human. */
  | { kind: "idle" }
  /** The record itself says the team is over (`endedAt` set). */
  | { kind: "ended" }

/** The verdicts a review may carry that still leave a decision to the captain. */
const UNRESOLVED_VERDICTS: readonly string[] = ["fail", "failed", "changes", "change-requested"]

/**
 * Whether this task is TERMINAL.
 *
 * @param task - the task row.
 * @returns true for `completed`, `failed` and `cancelled`.
 */
function isTerminal(task: TeamTaskRecord): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled"
}

/**
 * Whether this task is IN FLIGHT.
 *
 * @param task - the task row.
 * @returns true for `claimed` and `in_progress`.
 */
function isInFlight(task: TeamTaskRecord): boolean {
  return task.status === "claimed" || task.status === "in_progress"
}

/**
 * The member a handoff belongs to, when the team is waiting for an ANSWER: a seat that stopped (not
 * running) and left a document behind is asking for a decision nobody else can give.
 *
 * @param members - the record's roster.
 * @returns the first such member, or undefined.
 */
function waitingForAnswer(members: readonly TeamMemberRecord[]): TeamMemberRecord | undefined {
  return members.find((member) => member.status !== "running" && member.status !== "provisioning" && member.handoff !== undefined)
}

/**
 * Classify ONE team record (or ONE of its tasks) into the stage a reader should act on.
 *
 * @param record - the team record; only its existing fields are read.
 * @param taskId - when given, the person checks are restricted to that task (the rest stay board-level).
 * @returns the classification, never throwing.
 */
export function teamStage(record: TeamRecord, taskId?: string): TeamStage {
  // TOTAL BY CONSTRUCTION: a render path may be handed a record a migration or a fixture left partial, and
  // a classifier that THROWS there would turn a status read into a 500. Both collections are normalized
  // to arrays once, and every rule below reads only these.
  /** The board, as an array even on a partial record. */
  const tasks: readonly TeamTaskRecord[] = Array.isArray(record?.tasks) ? record.tasks : []
  /** The roster, as an array even on a partial record. */
  const members: readonly TeamMemberRecord[] = Array.isArray(record?.members) ? record.members : []
  /** The tasks the person checks read: the named one, or the whole board. */
  const scope: readonly TeamTaskRecord[] = taskId === undefined ? tasks : tasks.filter((task) => task.id === taskId)
  // 1. A FAILURE the board holds. A named task that is not on the board cannot be failed.
  /** The first failed task in scope. */
  const failed = scope.find((task) => task.status === "failed")
  if (failed !== undefined) return { kind: "person", reason: "failed", taskId: failed.id }
  // 2. A REVIEW that did not pass: the verdict is recorded, the decision is not.
  /** The first review whose verdict still needs a decision. */
  const review = scope.find((task) => task.kind === "review" && task.verdict !== undefined && !String(task.verdict).toLowerCase().startsWith("pass") && UNRESOLVED_VERDICTS.includes(String(task.verdict).toLowerCase()))
  if (review !== undefined) return { kind: "person", reason: "review", taskId: review.id }
  // 3. A BLOCKED open task: the board cannot advance and no member can fix that.
  /** The first open task whose blockers are all unresolved. */
  const blocked = scope.find((task) => !isTerminal(task) && !isInFlight(task) && taskVisual(task, tasks) === "blocked")
  if (blocked !== undefined) return { kind: "person", reason: "blocked", taskId: blocked.id }
  // 4. NOTHING LEFT TO DO on a live team: the board is finished, so the delivery is the human's to accept.
  //    A record whose own phase is `ended` is NOT a delivery waiting: rule 8 answers that.
  /** Whether every task on the board reached a terminal state with no failure among them. */
  const boardFinished = tasks.length > 0 && tasks.every((task) => isTerminal(task) && task.status !== "failed")
  if (taskId === undefined && boardFinished && derivePhase(record) !== "ended") return { kind: "person", reason: "delivery" }
  // 5. A SEAT that stopped and left a handoff: it asked for a decision, and only a human can give one.
  if (taskId === undefined && !tasks.some(isInFlight)) {
    /** The member waiting for an answer, when one is. */
    const waiting = waitingForAnswer(members)
    if (waiting !== undefined) return { kind: "person", reason: "answer" }
  }
  // 6. WORK IN FLIGHT — and whether more work is already waiting behind it.
  /** Whether any task is claimed or in progress. */
  const inFlight = tasks.some(isInFlight)
  if (inFlight) {
    /** Whether a ready, unowned task is queued behind the in-flight work. */
    const queued = tasks.some((task) => task.status === "pending" && task.owner === undefined && !isTerminal(task) && taskVisual(task, tasks) !== "blocked")
    return { kind: "working", queued }
  }
  // 7. LIVE AND QUIET. 8. OVER.
  return derivePhase(record) === "ended" ? { kind: "ended" } : { kind: "idle" }
}

/**
 * The stage as ONE stable token: `person:blocked`, `working:queued`, `working`, `idle`, `ended`.
 *
 * Every surface renders this token rather than its own paraphrase, so the TUI, the web payload and a
 * tool's status answer cannot drift into three spellings of the same stage.
 *
 * @param stage - a classification from {@link teamStage}.
 * @returns the token.
 */
export function stageLabel(stage: TeamStage): string {
  if (stage.kind === "working") return stage.queued ? "working:queued" : "working"
  if (stage.kind === "person") return "person:" + stage.reason
  return stage.kind
}
