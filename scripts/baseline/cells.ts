import { Inputs, instant, key } from "./input.ts"
import type { Line, Row } from "./input.ts"

/** A cell's explicit links, including IDs whose board was not available. */
interface CellTeams {
  /** Cell directory key, retained even if part of the record cannot be read. */
  readonly cellId: string
  /** Positively identified boards, or null when there is no basis for a zero. */
  readonly count: number | null
  /** Named boards backed by a surviving team record. */
  readonly presentTeamIds: readonly string[]
  /** Explicit links whose board record could not be confirmed. */
  readonly missingTeamIds: readonly string[]
  /** True when both link sources were read and their explicit team references resolved. */
  readonly complete: boolean
}

/** The result of classifying the retained compaction and reseed events. */
type Reseed = "reseeded" | "spawn-failed" | "refused-before-spawn" | "not-reseed" | "unknown"

/** Pinned producer reason strings distinguish a failed call from a skipped launch. */
function reseedOf(row: Row): Reseed {
  if (row.event === "member-reseeded" || row.outcome === "reseeded") return "reseeded"
  if (row.event === "compaction" && row.outcome !== "refused") return row.outcome === "promoted" ? "not-reseed" : "unknown"
  /** The reason is only inspected for producer wording and is never copied to the report. */
  const reason = key(row.reason) ?? ""
  if (/(?:^|; )reseed-parent-unavailable \(/.test(reason)) return "refused-before-spawn"
  if (/(?:^|; )(?:the reseed (?:failed\b|reported no child id)|the fresh child was started but its seat could not be bound)/.test(reason)) return "spawn-failed"
  if (reason === "the caller cancelled the barrier") return "not-reseed"
  return "unknown"
}

/** A barrier can emit both a canonical outcome row and a companion row. */
interface PairCount {
  /** Canonical compaction rows sharing this event identity. */
  outcomes: number
  /** Matching member-reseeded or checkpoint-unrecoverable journal entries. */
  companions: number
}

/** Keep barrier multiplicity when outcomes share a clock reading, and reconcile only partner events. */
function reseedCounts(entries: readonly Line[], input: Inputs, path: string): Record<Reseed, number> {
  /** At most one partner of each kind per observed barrier; include identity to avoid a cross-seat join. */
  const groups = new Map<string, { readonly outcome: Reseed; readonly counts: PairCount }>()
  for (const { row, line } of entries) {
    if (row.event !== "compaction" && row.event !== "checkpoint-unrecoverable" && row.event !== "member-reseeded") continue
    /** All known outcome producers stamp a logical member and clock. */
    const member = key(row.member)
    /** Clock deduplication is limited to the current cell's journal. */
    const at = instant(row.at)
    if (member === undefined || at === undefined) {
      input.malformed(path, "barrier event missing member or timestamp", line)
      continue
    }
    /** Historical rows may have only the companion, and older refusals may have only compaction. */
    const outcome = reseedOf(row)
    /** The fresh handle distinguishes separate successes with equal member and millisecond. */
    const identity = JSON.stringify([member, at, outcome, outcome === "reseeded" ? row.newHandle ?? row.newSessionId ?? null : row.reason ?? null])
    /** Companion multiplicity is preserved even when the append timestamp is the same. */
    const counts = groups.get(identity)?.counts ?? { outcomes: 0, companions: 0 }
    if (row.event === "compaction") counts.outcomes++
    else counts.companions++
    groups.set(identity, { outcome, counts })
  }
  /** Paired rows are one observable barrier; unpaired historical rows remain observable. */
  const totals: Record<Reseed, number> = { reseeded: 0, "spawn-failed": 0, "refused-before-spawn": 0, "not-reseed": 0, unknown: 0 }
  for (const { outcome, counts } of groups.values()) totals[outcome] += Math.max(counts.outcomes, counts.companions)
  return totals
}

/** The scoped lifecycle events which persist a cell-to-board link. */
const teamLinkEvents: ReadonlySet<unknown> = new Set(["planning-team-staged", "planning-team-partial", "activate", "cell-activation", "cell-activation-partial", "cell-activation-progress", "dispatch-pass"])

/** Read cells and summarize retained journal metrics without projecting names onto unrelated boards. */
export function readCells(input: Inputs, teamIds: ReadonlySet<string>, empty: boolean): {
  readonly teamsPerCell: readonly CellTeams[]
  readonly metrics: Record<string, { readonly observed: number; readonly complete: boolean; readonly unit: string }>
} {
  /** A missing cellwork root can represent an ordinary workspace without Cellwork. */
  const root = ".mpd/cellwork"
  /** Only cell-directory names enter the scan. */
  const rootStart = input.sources.length
  /** Active/index sidecars at the root are separate producer state. */
  const entries = empty ? [] : input.directory(root).filter((entry) => entry.name.startsWith("cell-"))
  /** Counts from present journals remain lower bounds when any known journal is unusable. */
  let historyComplete = (empty || input.sources[0]?.state === "read") && input.complete(rootStart, false)
  /** Per-cell links are usually 1 or 2 and never inferred from reused task IDs. */
  const teamsPerCell: CellTeams[] = []
  /** The count of observed checkpoint requests. */
  let checkpoints = 0
  /** The count of dispatch passes that took the reassign option and journaled the outcome. */
  let dispatchReassignCalls = 0
  /** Reseed counts aggregate observations across all retained cell journals. */
  const reseeds: Record<Reseed, number> = { reseeded: 0, "spawn-failed": 0, "refused-before-spawn": 0, "not-reseed": 0, unknown: 0 }
  for (const cell of entries) {
    /** State and journal are independent sources of positive links. */
    const stateStart = input.sources.length
    /** State is stored beside the cell's append-only journal. */
    const statePath = `${root}/${cell.name}/state.json`
    /** Invalid state must not be confused with an explicit empty team association. */
    const state = input.json(statePath)
    /** The versioned cell id and team link are each emitted by every valid state writer. */
    const valid = state?.version === 1 && state.cellId === cell.name && typeof state.teamId === "string"
    if (state !== undefined && !valid) input.malformed(statePath, "unsupported cell version, id, or missing teamId")
    /** A mounted worktree might retain a journal after its state file has gone missing. */
    const journalStart = input.sources.length
    /** The journal itself scopes any board links to this cell. */
    const journal = `${root}/${cell.name}/journal.jsonl`
    /** Parsed rows stay in persisted order. */
    const lines = input.lines(journal)
    /** A Set keeps repeated state and journal evidence from increasing the reported relation count. */
    const links = new Set<string>()
    if (valid) {
      for (const value of [state.teamId, state.planningTeamId, state.mintedTeamId]) {
        /** Empty ids represent an as-yet unbound state. */
        const teamId = key(value)
        if (teamId !== undefined) links.add(teamId)
      }
    }
    for (const { row, line } of lines) {
      if (key(row.event) === undefined || instant(row.at) === undefined) {
        input.malformed(journal, "missing event name or timestamp", line)
        continue
      }
      if (row.event === "checkpoint") checkpoints++
      if (row.event === "dispatch-reassign") dispatchReassignCalls++
      if (!teamLinkEvents.has(row.event)) continue
      for (const value of [row.teamId, row.mintedTeamId, row.planningTeamId, row.resolvedTeamId, row.recordedTeamId]) {
        /** Some legacy dispatch summaries do not carry a board id. */
        const teamId = key(value)
        if (teamId !== undefined) links.add(teamId)
      }
    }
    /** This journal's classified outcomes, with paired summaries removed. */
    const counts = reseedCounts(lines, input, journal)
    reseeds.reseeded += counts.reseeded
    reseeds["spawn-failed"] += counts["spawn-failed"]
    reseeds["refused-before-spawn"] += counts["refused-before-spawn"]
    reseeds["not-reseed"] += counts["not-reseed"]
    reseeds.unknown += counts.unknown
    historyComplete &&= input.complete(journalStart, true)
    /** Split positive links from IDs that could not be checked against a surviving board. */
    const presentTeamIds = [...links].filter((id) => teamIds.has(id)).sort()
    /** Missing and unreadable board records leave the count open-ended. */
    const missingTeamIds = [...links].filter((id) => !teamIds.has(id)).sort()
    /** A measured zero requires readable state/journal and resolution of any named boards. */
    const complete = valid && input.complete(stateStart, true) && missingTeamIds.length === 0
    teamsPerCell.push({ cellId: cell.name, count: complete || presentTeamIds.length > 0 ? presentTeamIds.length : null, presentTeamIds, missingTeamIds, complete })
  }
  /** Unclassifiable refusals could hide a launch, even with complete file reads. */
  const reseedsComplete = historyComplete && reseeds.unknown === 0
  return {
    teamsPerCell,
    metrics: {
      checkpoints: { observed: checkpoints, complete: historyComplete, unit: "Cellwork checkpoint journal entry" },
      reseedAttempts: { observed: reseeds.reseeded + reseeds["spawn-failed"], complete: reseedsComplete, unit: "Retained reseed fallback outcome, excluding explicit pre-spawn refusals" },
      reseedFailures: { observed: reseeds["spawn-failed"], complete: reseedsComplete, unit: "Retained unsuccessful reseed fallback outcome, excluding explicit pre-spawn refusals" },
      reseedRefusedBeforeSpawn: { observed: reseeds["refused-before-spawn"], complete: reseedsComplete, unit: "Retained barrier outcome with a parent precondition refusal before spawn" },
      barrierOutcomes: { observed: reseeds.reseeded + reseeds["spawn-failed"] + reseeds["refused-before-spawn"] + reseeds["not-reseed"] + reseeds.unknown, complete: historyComplete, unit: "Retained barrier outcome, matching companion rows counted once" },
      unclassifiedReseedOutcomes: { observed: reseeds.unknown, complete: historyComplete, unit: "Retained refusal with no recognized launch classification" },
      dispatchReassignCalls: { observed: dispatchReassignCalls, complete: historyComplete, unit: "Cellwork dispatch-reassign call summary, never a per-row Team task-reassigned entry" },
    },
  }
}
