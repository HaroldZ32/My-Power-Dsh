import { realpathSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import { activationLinks } from "./activation-links.ts"
import { Inputs, instant, key } from "./input.ts"

/** A missing timestamp, identity or count is unavailable for analysis. */
const unknown = "unknown"
/** Previously recorded November 13 reference counts; no historical rows are inferred. */
const historical = {
  MailCollect: { teamRecords: 9, emptyShells: 0 },
  VEdit: { teamRecords: 24, cells: 10, emptyShells: 1 },
  "My-Power-Dsh": { emptyShells: 7 },
} as const

/** Format a known timestamp without passing through other persisted content. */
function timestamp(time: number | undefined): string {
  return time === undefined ? unknown : new Date(time).toISOString()
}

/** Numeric cost may be unavailable when a team's record lacks an operand. */
type Cost = number | typeof unknown
/** Board-side clocks and the current roster and task sizes. */
type Team = {
  readonly teamId: string
  readonly createdAt: string
  readonly approvedAt: string
  readonly minutesToApproval: Cost
  readonly members: Cost
  readonly tasks: Cost
}
/** Controls whether an archived plan contributes to the shell count. */
type Plan = {
  readonly planId: string
  readonly source: string
  readonly approval: "approved" | "unapproved" | typeof unknown
  readonly structurallyEmpty: boolean | typeof unknown
}
/** Explicit cell-to-board signal with a replayable source coordinate. */
type Link = { readonly teamId: string; readonly source: string; readonly field: string; readonly line?: number }
/** Cell-side observations before cross-cell claims are reconciled. */
type Cell = {
  readonly cellId: string
  readonly state: "read" | typeof unknown
  readonly createdAt: string
  readonly startedAt: string
  readonly links: readonly Link[]
  readonly unverifiedLinks: readonly Link[]
}

/** Read team records independently of their staged plan history. */
function teamRecords(input: Inputs): readonly Team[] {
  return input.directory(".mpd/team/teams").flatMap((entry) => {
    if (!entry.name.endsWith(".json")) return []
    /** Current board record, never an archive plan. */
    const path = `.mpd/team/teams/${entry.name}`
    /** The filename and version must agree with the claimed board identity. */
    const row = input.json(path)
    if (row === undefined) return []
    if (row.version !== 1 || row.teamId !== basename(entry.name, ".json")) {
      input.malformed(path, "invalid team identity or version")
      return []
    }
    /** Approval latency uses the two clocks from the same board and a nonnegative interval. */
    const created = instant(row.createdAt)
    /** A partially approved or malformed board can still expose its identity. */
    const approved = instant(row.approvedAt)
    return [{
      teamId: row.teamId, createdAt: timestamp(created), approvedAt: timestamp(approved),
      minutesToApproval: created !== undefined && approved !== undefined && approved >= created ? (approved - created) / 60_000 : unknown,
      members: Array.isArray(row.members) ? row.members.length : unknown,
      tasks: Array.isArray(row.tasks) ? row.tasks.length : unknown,
    }]
  })
}

/** Distinguish approved archived plans from archived unapproved staging attempts. */
function archive(input: Inputs): readonly Plan[] {
  /** A generated archive basename is the plan ID across both supported versions. */
  return input.directory(".mpd/team/archive").filter((entry) => entry.isDirectory() || entry.name.startsWith("plan-")).map((entry) => {
    /** Exact staged-plan record, which survives plan cleanup. */
    const path = `.mpd/team/archive/${entry.name}/plan.json`
    /** The workspace may contain legacy version 1 plan archives. */
    const row = input.json(path)
    if (row === undefined || (row.version !== 1 && row.version !== 2) || row.planId !== entry.name) {
      if (row !== undefined) input.malformed(path, "unsupported archive plan version or identity")
      return { planId: entry.name, source: path, approval: unknown, structurallyEmpty: unknown }
    }
    /** Malformed approval stamps cannot be counted as either approved or unapproved. */
    const approval = row.approvedAt === undefined ? "unapproved" : instant(row.approvedAt) === undefined ? unknown : "approved"
    if (approval === unknown) input.malformed(path, "invalid approval stamp")
    return { planId: row.planId, source: path, approval, structurallyEmpty: Array.isArray(row.members) && Array.isArray(row.tasks)
      ? row.members.length === 0 && row.tasks.length === 0 : unknown }
  })
}

/** Collect cell-side claims and distinguish unverified resolution from deliberate attribution. */
function cellRecords(input: Inputs): readonly Cell[] {
  return input.directory(".mpd/cellwork").filter((entry) => entry.name.startsWith("cell-")).map((entry) => {
    /** Cell state can carry two board identities over its lifetime. */
    const path = `.mpd/cellwork/${entry.name}/state.json`
    /** Read tracked fields without retaining objectives or prompts. */
    const decoded = input.json(path)
    /** An invalid state contributes no attribution. */
    const state = decoded?.version === 1 && decoded.cellId === entry.name ? decoded : undefined
    if (decoded !== undefined && state === undefined) input.malformed(path, "invalid cell identity or version")
    /** Explicit claims, with one or more receipts per distinct board. */
    const links: Link[] = []
    /** Plausible but unsupported claims remain visible outside the known attribution tally. */
    const unverifiedLinks: Link[] = []
    for (const field of ["planningTeamId", "mintedTeamId"]) {
      /** Empty IDs are a normal Cellwork state. */
      const teamId = key(state?.[field])
      if (teamId !== undefined) links.push({ teamId, source: path, field })
    }
    /** Materialisation receipts can identify a board since removed from the state. */
    const journal = `.mpd/cellwork/${entry.name}/journal.jsonl`
    for (const { row, line } of input.lines(journal)) {
      if (row.event === "activate") {
        for (const { teamId, field, confirmed } of activationLinks(row)) {
          (confirmed ? links : unverifiedLinks).push({ teamId, source: journal, field, line })
        }
      } else if (row.event === "cell-activation" || row.event === "cell-activation-partial") {
        /** These receipts only carry an explicit minted board identity. */
        const teamId = key(row.mintedTeamId)
        if (teamId !== undefined) links.push({ teamId, source: journal, field: "mintedTeamId", line })
      }
    }
    /** An execution pointer explicitly weakened by a receipt stays a candidate. */
    const stateTeamId = key(state?.teamId)
    if (stateTeamId !== undefined) {
      (unverifiedLinks.some(({ teamId }) => teamId === stateTeamId) ? unverifiedLinks : links)
        .push({ teamId: stateTeamId, source: path, field: "teamId" })
    }
    return { cellId: entry.name, state: state === undefined ? unknown : "read", createdAt: timestamp(instant(state?.createdAt)),
      startedAt: timestamp(instant(state?.startedAt)), links, unverifiedLinks }
  })
}

/** Explain the input that prevents an exact total while preserving confirmed observations. */
type Gap = { readonly path: string; readonly state: "absent" | "malformed" | "unreadable"; readonly reason?: string }

/** A missing collection is empty; candidate files inside an existing collection require evidence. */
function gaps(input: Inputs, since: number, collection: string): readonly Gap[] {
  return input.sources.slice(since).flatMap(({ path, state, reason }) => {
    if (state === "read" || (state === "absent" && path === collection)) return []
    return [{ path, state, reason }]
  })
}

/** Keep the headline total exact only when no qualifying input is missing or unreadable. */
function measureCount(observed: number, gaps: readonly Gap[]): {
  readonly observed: number; readonly complete: boolean; readonly total: Cost; readonly gaps: readonly Gap[]
} {
  return { observed, complete: gaps.length === 0, total: gaps.length === 0 ? observed : unknown, gaps }
}

/** Reconcile all cells and boards without transferring a shared claim to either cell. */
function report(root: string): object {
  /** Coverage is a scan interval because the live workspace may change. */
  const startedAt = new Date().toISOString()
  /** Read-only access with per-input fingerprints. */
  const input = new Inputs(root)
  /** The independently enumerable board inventory. */
  const teams = teamRecords(input)
  /** An invalid candidate can conceal one or more board records. */
  const boards = measureCount(teams.length, gaps(input, 0, ".mpd/team/teams"))
  /** Locate diagnostics emitted by archive reads only. */
  const archiveStart = input.sources.length
  /** Archive entries identify unapproved plans separately from actual boards. */
  const archivedPlans = archive(input)
  /** An unknown approval leaves both kinds of plan totals incomplete. */
  const archiveGaps = gaps(input, archiveStart, ".mpd/team/archive")
  /** Locate diagnostics for the cell inventory. */
  const cellStart = input.sources.length
  /** The cells and their explicit board links. */
  const cellRows = cellRecords(input)
  /** A missing journal limits link evidence, while a missing state prevents counting the cell. */
  const cells = measureCount(cellRows.filter((cell) => cell.state === "read").length,
    gaps(input, cellStart, ".mpd/cellwork").filter((gap) => !gap.path.endsWith("/journal.jsonl")))
  /** Only a present board can contribute to a cell cost. */
  const present = new Set(teams.map((team) => team.teamId))
  /** Index distinct claimants so multiple receipts by the same cell count once. */
  const claimants = new Map<string, Set<string>>()
  for (const { cellId, links } of cellRows) {
    for (const { teamId } of links) {
      /** Multiple distinct cells sharing a claim make cost attribution ambiguous. */
      const ids = claimants.get(teamId) ?? new Set<string>()
      ids.add(cellId)
      claimants.set(teamId, ids)
    }
  }
  /** Plan approval fields classify shells even if a staging attempt carries members or tasks. */
  const shells = archivedPlans.filter((plan) => plan.approval === "unapproved")
  /** Array shape only affects the structural subset, not whether the plan was approved. */
  const structuralGaps: readonly Gap[] = shells.filter((plan) => plan.structurallyEmpty === unknown)
    .map(({ source }) => ({ path: source, state: "malformed", reason: "missing or invalid members or tasks array" }))
  /** Keep independent lower bounds for each reported inventory. */
  const coverage = {
    teamRecords: boards, cells,
    emptyShells: measureCount(shells.length, archiveGaps),
    archivedApprovedPlans: measureCount(archivedPlans.filter((plan) => plan.approval === "approved").length, archiveGaps),
    structurallyEmptyShells: measureCount(shells.filter((plan) => plan.structurallyEmpty === true).length, [...archiveGaps, ...structuralGaps]),
  }
  return {
    schemaVersion: 1, workspace: root, capture: { startedAt, finishedAt: new Date().toISOString(), atomic: false },
    teamRecords: coverage.teamRecords.total, emptyShells: coverage.emptyShells.total, cells: coverage.cells.total,
    archivedApprovedPlans: coverage.archivedApprovedPlans.total, structurallyEmptyShells: coverage.structurallyEmptyShells.total,
    coverage, shellPlans: shells, unknownApprovalPlans: archivedPlans.filter((plan) => plan.approval === unknown),
    teams: teams.map((team) => {
      /** Attribute only when exactly one cell claims this present record. */
      const cellIds = [...(claimants.get(team.teamId) ?? [])]
      return { ...team, cellIds, cellRelation: cellIds.length === 1 ? "explicit" : unknown }
    }),
    cellRecords: cellRows.map((cell) => {
      /** Keep unmatched and ambiguous IDs separate from attributable board counts. */
      const ids = [...new Set(cell.links.map((link) => link.teamId))].sort()
      return { ...cell,
        attributedTeamIds: ids.filter((id) => present.has(id) && claimants.get(id)?.size === 1),
        unmatchedTeamIds: ids.filter((id) => !present.has(id)),
        ambiguousTeamIds: ids.filter((id) => (claimants.get(id)?.size ?? 0) > 1),
      }
    }),
    unmatchedTeamIds: [...claimants.keys()].filter((id) => !present.has(id)).sort(),
    unattributedTeamIds: teams.filter((team) => !claimants.has(team.teamId)).map((team) => team.teamId),
    historicalReference: { date: "2026-11-13", workspaces: historical },
    sources: input.sources,
    units: { minutesToApproval: "team approvedAt minus createdAt, divided by 60000", emptyShells: "archived plans without approvedAt; structurally empty plans are also counted separately" },
  }
}

/** Emit a single parseable document even when input coverage is incomplete. */
function main(args: readonly string[]): void {
  try {
    if (args.length !== 1 || !args[0]) throw new Error("expected one workspace")
    /** Resolve only the workspace explicitly provided by the caller. */
    const root = realpathSync(resolve(args[0]))
    if (!statSync(root).isDirectory()) throw new Error("expected a workspace directory")
    process.stdout.write(JSON.stringify(report(root), null, 2) + "\n")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    process.stdout.write(JSON.stringify({ usage: "node scripts/baseline/ceremony.ts <workspace>" }) + "\n")
    process.exitCode = 2
  }
}

main(process.argv.slice(2))
