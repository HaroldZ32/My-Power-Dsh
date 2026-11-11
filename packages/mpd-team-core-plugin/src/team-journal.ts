// THE TEAM JOURNAL: the append-only record of what the team PLANE did to a team's state.
//
// WHY IT EXISTS. A board row carries its CURRENT state, never how it got there: after a reassignment
// the record shows the new owner and nothing about the fenced seat the row was taken from, and after a
// handoff it shows `mode: checkpoint` with no evidence of when the document was written. A reader
// repairing a stalled wave — the captain, `agent_teams_plan {action:"status"}`, a reviewer reading the
// evidence directory — needs that history, and the team record is the wrong shape to hold it: every
// write to the record rewrites the WHOLE record, so a history array inside it would be a second
// growing document under a mutate-in-place API.
//
// The journal is therefore ONE line per event, in `.mpd/team/journal.jsonl`, shared by every team of the
// workspace and scoped by the `teamId` each row carries (the same discipline the dispatch ledger
// follows, so a new team reusing `T1..Tn` cannot read another team's history).
//
// WHAT IT IS NOT. The journal is EVIDENCE, never a source of truth: no reader decides what a member is
// or which team is live from it. Losing it costs history, never correctness — which is why a torn or
// unparsable line is skipped by the reader rather than failing the caller.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { teamRoot } from "./team-store"

/**
 * Every event the team plane journals.
 *
 * `task-reassigned` is the hand-over the dispatch repair performs and `task-cancelled` is the abandonment
 * that makes a row undispatchable; the next three are the seat events (a fence, its removal, and a
 * member's handoff), journaled here because they change what a later dispatch pass may do with that seat;
 * `team-ended` is the TERMINAL transition of the whole team (`agent_teams_control {action:"end"}`), the
 * one row that says when and why the wave closed — written once, never on the idempotent repeat.
 *
 * `wedged-force` is D3's supervisor event: a member was interrupted at the force bound, its row
 * requeued and the work split. It is written whatever the captain's mailbox did, which is what makes
 * the journal — not the mailbox — the DURABLE notification of a force. The SAME event carries a
 * `force-skipped` reason when the row reached a terminal state (or moved) during the interrupt: the
 * force then requeues nothing and splits nothing, and the reason states the observed status/revision.
 *
 * `wedged-grace` is S4's FIRST phase: the member was sent the ONE directive to write its handoff and
 * end its turn, and NOTHING was interrupted. It is the durable `graceSentAt` a reader compares the
 * later `wedged-force` row against.
 *
 * `consult-upsert` and `consult-clear` are the CELLWORK plane's two consult writes: one background
 * consult was recorded or updated, or a whole team's consult rows were removed when the cell ended.
 * They are EVIDENCE of a graph-only fact — a consult is never a board row — so they carry the consult
 * id and ordinal instead of a `taskId`.
 *
 * `member-role-omitted` is the §7.1b non-blocking warning: a member was appended to a LIVE roster with
 * NO `role`, so route resolution may fail to match a role route (the description head and the member name
 * are the remaining channels, and neither is guaranteed) — in which case the seat inherits the calling
 * session's route. The `reason` carries the one-sentence warning; the append itself still happens.
 */
export type TeamJournalEvent = "task-reassigned" | "task-cancelled" | "member-fenced" | "member-unfenced" | "handoff-written" | "team-ended" | "wedged-force" | "wedged-grace" | "consult-upsert" | "consult-clear" | "member-role-omitted"

/** One team-journal row. */
export interface TeamJournalEntry {
  /** What happened. */
  event: TeamJournalEvent
  /** The team the change belongs to; every reader scopes by it. */
  teamId: string
  /** ISO instant the change was recorded, supplied by the caller's own clock reading. */
  at: string
  /** The board row the change is about, for the task-shaped events. */
  taskId?: string
  /** The member the change is about — the NEW owner of a reassigned row. */
  member?: string
  /** The member a reassigned row was taken FROM. */
  from?: string
  /** Why the change happened, for the events that carry a reason (a fence, a hand-over). */
  reason?: string
  /** The handoff document a `handoff-written` event names. */
  path?: string
  /** The consult a `consult-upsert` event is about. */
  consultId?: string
  /** The ordinal that consult holds, so a reader can match the row against a drawn node. */
  consultNumber?: number
  /** The lifecycle word a `consult-upsert` event recorded. */
  state?: string
  /** The consult ids a `consult-clear` event removed, in row order. */
  cleared?: string[]
  /** The consult ids a upsert's retention cap dropped. */
  pruned?: string[]
}

/** The journal file: ONE workspace-wide append-only log, beside the dispatch ledger. */
const journalPath = (workspace: string): string => join(teamRoot(workspace), "journal.jsonl")

/**
 * Append one row to the workspace's team journal.
 *
 * The caller supplies `at` (the store's mutation convention: the ONE clock reading a caller already
 * took), so this function never reads a clock of its own. Throws only on a real write failure, which is
 * a disk-level failure the caller reports.
 * @param workspace - the workspace whose journal is appended to.
 * @param entry - the row to append; its `at` is stamped by the caller.
 * @returns the absolute path of the journal file written.
 */
export function appendTeamJournal(workspace: string, entry: TeamJournalEntry): string {
  /** The journal file this row lands in. */
  const path = journalPath(workspace)
  mkdirSync(teamRoot(workspace), { recursive: true })
  appendFileSync(path, JSON.stringify(entry) + "\n")
  return path
}

/**
 * Read every readable row of the workspace's team journal, oldest first.
 *
 * Never throws: an absent journal is an empty history, and a line that is not a JSON object with a
 * string `event` and `teamId` is SKIPPED — a torn append must not take down the reader that inspects it.
 * @param workspace - the workspace whose journal is read.
 * @returns the readable rows, in file order.
 */
export function readTeamJournal(workspace: string): TeamJournalEntry[] {
  /** The journal file; an absent one is an empty history. */
  const path = journalPath(workspace)
  if (!existsSync(path)) return []
  /** The rows read, accumulated before the return. */
  const out: TeamJournalEntry[] = []
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue
    try {
      /** The parsed row, read structurally because the file is evidence rather than a schema. */
      const row = JSON.parse(line) as Partial<TeamJournalEntry>
      if (typeof row.event !== "string" || typeof row.teamId !== "string") continue
      out.push(row as TeamJournalEntry)
    } catch {
      // A torn or hand-edited line is not history this reader can prove; skipping it keeps the rest.
    }
  }
  return out
}
