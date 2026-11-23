import { realpathSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Inputs, counter, instant, key, object, type Row } from "./input.ts"
import { readCells } from "./cells.ts"
import { workerLoss, type Assignment } from "./receipts.ts"

/** Stored board statuses, including open statuses and terminal exclusions. */
const statuses: ReadonlySet<unknown> = new Set(["pending", "claimed", "in_progress", "completed", "failed", "cancelled"])

/** Statuses that have a current assignment to examine. */
const assigned: ReadonlySet<unknown> = new Set(["claimed", "in_progress"])

/** Board-terminal states never contribute to the handle-owned count. */
const terminal: ReadonlySet<unknown> = new Set(["completed", "failed", "cancelled"])

/** Normalize a logical owner by the team dispatch rule. */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** One captured team file and its independently parsed roster and task arrays. */
interface Board {
  /** Durable team key, checked against the filename. */
  readonly teamId: string
  /** Lead session ID recorded by this board, when available. */
  readonly captain: string | undefined
  /** Roster array, unknown when its shape cannot support a count. */
  readonly members: readonly Row[] | undefined
  /** Task array, unknown when its shape cannot support a count. */
  readonly tasks: readonly Row[] | undefined
}

/** Read known-sized team arrays as a unit so corrupt rows cannot look like a smaller board. */
function boardRows(input: Inputs, path: string, field: string, rows: unknown): readonly Row[] | undefined {
  if (Array.isArray(rows)) {
    /** Only identity-bearing rows are useful to the caller. */
    const parsed = rows.map(object)
    if (parsed.every((row) => key(row?.id) !== undefined && (field === "members" ? key(row?.name) !== undefined : statuses.has(row?.status)))) {
      /** Full IDs must be unique within one board. */
      const ids = new Set(parsed.map((row) => row?.id))
      if (ids.size === parsed.length) return parsed.filter((row) => row !== undefined)
    }
  }
  input.malformed(path, `invalid ${field} array`)
  return undefined
}

/** Read MPD's authoritative current board files, including ended and staged records. */
function readBoards(input: Inputs): Board[] {
  return input.directory(".mpd/team/teams").filter((entry) => entry.name.endsWith(".json")).flatMap((entry) => {
    /** Filename and record id must agree before linking by either. */
    const path = `.mpd/team/teams/${entry.name}`
    /** Only the declared native format is understood. */
    const record = input.json(path)
    if (record === undefined) return []
    /** The generated filename is the producer's storage key. */
    const teamId = basename(entry.name, ".json")
    if (record.version !== 1 || record.teamId !== teamId) {
      input.malformed(path, "unsupported team version or filename/id mismatch")
      return []
    }
    return [{ teamId, captain: key(record.leadSessionId), members: boardRows(input, path, "members", record.members), tasks: boardRows(input, path, "tasks", record.tasks) }]
  })
}

/** Use the exact roster binding before considering a uniquely normalized logical name. */
function memberFor(owner: string, members: readonly Row[]): Row | undefined {
  /** A session handle or verbatim display name can identify an ordinary seat. */
  const exact = members.filter((member) => member.name === owner || member.executorRef === owner)
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined
  /** The store accepts normalized logical names, but ambiguous matches prove nothing. */
  const normalized = nameKey(owner)
  if (normalized === "") return undefined
  /** Preserve collisions as unresolved rather than selecting the first roster entry. */
  const matches = members.filter((member) => typeof member.name === "string" && nameKey(member.name) === normalized)
  return matches.length === 1 ? matches[0] : undefined
}

/** Read current dispatch pairings without treating legacy ledger rows as authoritative. */
function readLedger(input: Inputs): ReadonlyMap<string, Row> {
  /** A legacy entry can be reported as incomplete while retaining modern keyed entries. */
  const path = ".mpd/team/dispatch.json"
  /** Dispatch's workspace-wide map is keyed by board and task together. */
  const ledger = input.json(path)
  /** The validated rows retain compact identity fields for the assignment join. */
  const rows = new Map<string, Row>()
  for (const [id, value] of Object.entries(ledger ?? {})) {
    /** Unknown legacy and shape-mismatched rows cannot bind a claimed task. */
    const row = object(value)
    if (row === undefined || key(row.teamId) === undefined || key(row.taskId) === undefined || id !== `${row.teamId}::${row.taskId}` || key(row.memberId) === undefined || key(row.memberName) === undefined || instant(row.assignedAt) === undefined) {
      input.malformed(path, "unscoped or invalid dispatch pairing")
      continue
    }
    rows.set(id, row)
  }
  return rows
}

/** Project the exact current owner binding and any corroborating pairing time. */
function assignment(board: Board, task: Row, member: Row | undefined, pairing: Row | undefined): Assignment {
  /** A current roster handle carries more authority than an unmatched old ledger row. */
  const executor = key(member?.executorRef)
  /** The current roster's ordinary seat name, when ownership resolves uniquely. */
  const seat = key(member?.name)
  /** Use the ledger timestamp only when the recorded pair agrees with both owner identities. */
  const pairMatches = executor !== undefined && seat !== undefined && pairing?.memberId === executor && pairing?.memberName === seat
  /** A conflicting or missing ledger pairing cannot override the task's own timestamps. */
  const pairedAt = pairMatches ? instant(pairing?.assignedAt) ?? null : null
  /** updatedAt dates the current revision; startedAt survives reopen and is also a hard lower bound. */
  const taskClocks = [instant(task.createdAt), instant(task.startedAt), instant(task.updatedAt), pairedAt ?? undefined]
    .filter((value): value is number => value !== undefined)
  return {
    teamId: board.teamId, taskId: String(task.id), status: String(task.status), owner: key(task.owner) ?? null,
    seat: seat ?? null, executor: executor ?? null, captain: board.captain ?? null,
    attempt: counter(task.attempt) ?? null, revision: counter(task.revision) ?? null,
    pairedAt,
    assignmentNotBefore: taskClocks.length === 0 ? null : Math.max(...taskClocks),
    ordinary: member === undefined ? "unknown" : member.mode !== "checkpoint" && member.fenced !== true && member.status !== "failed",
  }
}

/** The initial reference remains explicitly dated and independent of the workspace scanned. */
const historicalReference = {
  asOf: "2026-11-13",
  MailCollect: { teamRecords: 9, unapprovedShells: 0, checkpoints: 4 },
  VEdit: { teamRecords: 24, cells: 10, unapprovedShells: 1, checkpoints: 21 },
} as const

/** Capture one workspace with separate coverage for inventories, histories and receipts. */
function collect(root: string): object {
  /** Timestamp brackets independently read files and does not imply an atomic snapshot. */
  const startedAt = new Date().toISOString()
  /** Record all file outcomes, including missing optional producers. */
  const input = new Inputs(root)
  input.directory(".mpd")
  /** An absent state root is the ordinary empty workspace case. */
  const empty = input.sources[0]?.state === "absent"
  /** Boundary of the board count's own sources. */
  const boardStart = input.sources.length
  /** Retain boards even when no cell links to them. */
  const boards = empty ? [] : readBoards(input)
  /** Partial board coverage cannot support a zero handle-owner count. */
  const boardsComplete = (empty || input.sources[0]?.state === "read") && input.complete(boardStart, false)
    && input.sources.slice(boardStart).every(({ path, state }) => state !== "absent" || path === ".mpd/team/teams")
  /** Pairing is advisory for timing and does not contribute to the board-row totals. */
  const ledger = empty ? new Map<string, Row>() : readLedger(input)
  /** Lookup IDs of records actually observed by this capture. */
  const teamIds = new Set(boards.map((board) => board.teamId))
  /** Metrics from retained cell state and journals. */
  const cells = readCells(input, teamIds, empty)
  /** Each reported link is proven by a cell record or its scoped journal. */
  const linked = new Set(cells.teamsPerCell.flatMap((cell) => cell.presentTeamIds))
  /** Current open assignments are independent of whether a progress receipt was retained. */
  const assignments: Assignment[] = []
  /** Count positive matches and disclose rows that could not be resolved. */
  const ownership = { observed: 0, unresolvedOwners: 0, complete: boardsComplete }
  for (const board of boards) {
    for (const task of board.tasks ?? []) {
      /** An owner can be a logical name or a legacy executor handle. */
      const owner = key(task.owner)
      /** A pairing must belong to this exact board and task. */
      const pairing = ledger.get(`${board.teamId}::${task.id}`)
      /** Prefer the current unique roster seat to an unverified pairing. */
      const member = owner === undefined ? undefined : memberFor(owner, board.members ?? [])
      if (!terminal.has(task.status) && owner !== undefined) {
        if (member?.executorRef === owner || pairing?.memberId === owner) ownership.observed++
        else if (member === undefined && owner !== board.captain) ownership.unresolvedOwners++
      }
      if (assigned.has(task.status)) assignments.push(assignment(board, task, member, pairing))
    }
  }
  ownership.complete &&= ownership.unresolvedOwners === 0
  /** Resolve optional receipts before stamping the end of the capture interval. */
  const workerEvidence = workerLoss(input, assignments, empty)
  return {
    schemaVersion: 1,
    workspace: root,
    invocation: ["node", fileURLToPath(import.meta.url), root],
    capture: { startedAt, finishedAt: new Date().toISOString(), atomic: false },
    teamsPerCell: cells.teamsPerCell,
    teamRecords: { observed: boards.length, complete: boardsComplete },
    membersPerTeam: boards.map(({ teamId, members }) => ({ teamId, count: members?.length ?? null })),
    tasksPerTeam: boards.map(({ teamId, tasks }) => ({ teamId, count: tasks?.length ?? null })),
    unmatchedTeams: boards.filter(({ teamId }) => !linked.has(teamId)).map(({ teamId }) => ({ teamId, cellRelation: "unknown" })),
    nonTerminalHandleOwnedRows: ownership,
    ...cells.metrics,
    hostReseedInvocations: "unknown",
    workerLoss: workerEvidence,
    coverage: { sources: input.sources },
    historicalReference,
    semantics: {
      teamsPerCell: "Distinct IDs explicitly linked by a cell's state or scoped journal; count includes present team records only. Missing records and unlinked teams remain visible.",
      nonTerminalHandleOwnedRows: "Nonterminal board rows whose raw owner equals a recorded team roster executor or an exact board/task dispatch pairing executor.",
      workerLoss: "Current claimed/in_progress rows. Board claim attempt and watchdog board revision are separate. Unknown means the retained evidence does not prove this receipt.",
      reseedAttempts: "Observed fallback outcomes in retained Cellwork journals. Host spawn invocations lack their own durable counter.",
    },
  }
}

/** Emit one parseable JSON document and reserve exit 2 for an unusable CLI invocation. */
function main(args: readonly string[]): void {
  try {
    if (args.length !== 1 || !args[0]) throw new Error("expected one workspace directory")
    /** Canonicalize only the explicitly requested workspace, before opening state. */
    const root = realpathSync(resolve(args[0]))
    if (!statSync(root).isDirectory()) throw new Error("expected a workspace directory")
    /** Finish the capture clock after all coverage, including receipt reads, is available. */
    const report = collect(root)
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    process.stdout.write(JSON.stringify({ error: error.message, usage: "node scripts/baseline/collect.ts <workspace>" }) + "\n")
    process.exitCode = 2
  }
}

main(process.argv.slice(2))
