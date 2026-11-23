import { realpathSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import { counter, Inputs, instant, key, object } from "./input.ts"
import type { Row } from "./input.ts"

/** A missing pass-time fact has no numeric substitute. */
const unmeasured = "UNMEASURED"
/** The receipt never returns free-form skip reasons from production records. */
type Reason = "busy-owner" | "owner-not-on-roster" | "not-ready" | "other" | typeof unmeasured

/** Count only valid unique identifiers from an explicit set. */
function idSet(value: unknown, field?: string): Set<string> | undefined {
  if (!Array.isArray(value)) return undefined
  /** Duplicate or malformed entries make a set unusable. */
  const ids = new Set<string>()
  for (const entry of value) {
    /** The planner's pairs carry taskId, while readyIds is an array of IDs. */
    const id = key(field === undefined ? entry : object(entry)?.[field])
    if (id === undefined || ids.has(id)) return undefined
    ids.add(id)
  }
  return ids
}

/** Interpret the team's recorded reason without exporting its embedded names or text. */
function classify(value: unknown): Reason {
  /** Only stable words in the production dispatch reasons identify these categories. */
  const reason = key(value)
  if (reason === undefined) return unmeasured
  if (reason === "not ready" || reason.startsWith("not ready (")) return "not-ready"
  if (reason.startsWith("declared owner ")) {
    if (reason.endsWith(" is not on this team's roster — the row stays pending")) return "owner-not-on-roster"
    if (reason.endsWith(" is BUSY on another task — reported, never substituted")
      || reason.endsWith(" was already paired in this pass (one task per member)")
      || reason.endsWith(' is not idle (status "running")')) return "busy-owner"
  }
  return "other"
}

/** Known skip rows and an independently measured ready set may cover different task IDs. */
function reasons(skips: unknown, unpaired: readonly string[] | undefined): Readonly<Record<Reason, Count>> | typeof unmeasured {
  /** Exact IDs with retained skip rows that can explain an unpaired task. */
  const skippedIds = idSet(skips, "taskId")
  /** A known unpaired row has an unknown explanation when its skip row is missing. */
  const missing = unpaired?.filter((id) => !skippedIds?.has(id)).length ?? 0
  if (skippedIds === undefined || !Array.isArray(skips)) {
    return missing === 0 ? unmeasured : {
      "busy-owner": unmeasured, "owner-not-on-roster": unmeasured, "not-ready": unmeasured, other: unmeasured,
      UNMEASURED: missing,
    }
  }
  /** Explicit rows with unknown reasons are counted once, regardless of readiness. */
  const counts = { "busy-owner": 0, "owner-not-on-roster": 0, "not-ready": 0, other: 0, UNMEASURED: missing }
  for (const entry of skips) counts[classify(object(entry)?.reason)]++
  return counts
}

/** The pass counts may be independently available when a capture is incomplete. */
type Count = number | typeof unmeasured
/** A pass is scoped by the retained team identity and journal coordinate. */
type Pass = {
  readonly source: string
  readonly line: number
  readonly at: string
  readonly teamId: string
  readonly readyRowsPerPass: Count
  readonly pairedPerPass: Count
  readonly readyButUnpaired: Count
  readonly pairedReadyRatio: Count
  readonly skipped: Count
  readonly grown: Count
  readonly reasons: ReturnType<typeof reasons>
  readonly readyButUnpairedIds?: readonly string[]
}

/** Interpret a legacy counts-only row or a separately captured pass with three explicit sets. */
function measure(row: Row, source: string, line: number): Pass {
  /** Captures must explicitly carry the ready IDs recorded at the decision. */
  const ready = idSet(row.readyIds)
  /** The delivery array of that same pass is independent of any later ledger snapshot. */
  const paired = idSet(row.pairs, "taskId")
  /** An out-of-set pairing contradicts the snapshot and cannot certify a difference. */
  const consistent = ready !== undefined && paired !== undefined && [...paired].every((id) => ready.has(id))
  /** Compute the difference once so the reason reconciliation uses the exact same IDs. */
  const unpaired = consistent ? [...ready].filter((id) => !paired.has(id)) : undefined
  /** A missing or invalid timestamp is recorded as such alongside a stable source coordinate. */
  const time = instant(row.at)
  return {
    source, line, at: time === undefined ? unmeasured : new Date(time).toISOString(),
    teamId: key(row.teamId) ?? unmeasured,
    readyRowsPerPass: ready?.size ?? unmeasured,
    pairedPerPass: paired?.size ?? counter(row.pairs) ?? unmeasured,
    readyButUnpaired: unpaired?.length ?? unmeasured,
    pairedReadyRatio: consistent && ready.size > 0 ? paired.size / ready.size : unmeasured,
    skipped: idSet(row.skipped, "taskId")?.size ?? counter(row.skipped) ?? unmeasured,
    grown: counter(row.grown) ?? unmeasured,
    reasons: reasons(row.skipped, unpaired),
    ...(unpaired === undefined ? {} : { readyButUnpairedIds: unpaired }),
  }
}

/** Scan only pass-time evidence and keep current ledger receipts visibly separate. */
function report(root: string, capture: string | undefined): object {
  /** Capture begins before any of the changing workspace state is read. */
  const startedAt = new Date().toISOString()
  /** Fingerprints cover exactly the bytes consumed by this run. */
  const input = new Inputs(root)
  /** Board IDs and task counts only; current board rows are never used to backfill readiness. */
  const boards = new Map<string, number>()
  for (const entry of input.directory(".mpd/team/teams")) {
    if (!entry.name.endsWith(".json")) continue
    /** A current board may only establish that a team exists or its task list is empty. */
    const path = `.mpd/team/teams/${entry.name}`
    /** ID consistency avoids mixing tasks from misnamed records. */
    const board = input.json(path)
    if (board?.version === 1 && board.teamId === basename(entry.name, ".json") && Array.isArray(board.tasks)) {
      boards.set(board.teamId, board.tasks.length)
    } else if (board !== undefined) input.malformed(path, "invalid team record")
  }
  /** Use explicit journal attribution only; cell state may point to a newer board. */
  const journalPaths = input.directory(".mpd/cellwork")
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("cell-"))
    .map((entry) => `.mpd/cellwork/${entry.name}/journal.jsonl`)
  /** The explicit capture can name a journal already found by the workspace scan. */
  const passPaths = new Set(journalPaths)
  if (capture !== undefined) passPaths.add(capture)
  /** Retained passes may lack a ready set, a reason list or an explicit team ID. */
  const passes = [...passPaths].flatMap((path) =>
    input.lines(path).filter(({ row }) => row.event === "dispatch-pass").map(({ row, line }) => measure(row, path, line)))
  /** A ledger receipt only confirms an assignment still present at this scan. */
  const ledgerPath = ".mpd/team/dispatch.json"
  /** Dedupe receipts by authoritative scoped key; old unscoped entries stay separate. */
  const ledger = input.json(ledgerPath)
  /** Retain counts rather than executor identities. */
  const ledgerCounts = new Map<string, number>()
  /** Entries without attributable team/task/clock fields. */
  let unscopedLedgerEntries = 0
  for (const [receiptKey, value] of Object.entries(ledger ?? {})) {
    /** Read only the scope and clock fields of a pairing receipt. */
    const receipt = object(value)
    /** The ledger key must agree before an ID can be attributed. */
    const teamId = key(receipt?.teamId)
    /** The task ID joins the receipt to its board scope. */
    const taskId = key(receipt?.taskId)
    if (teamId === undefined || taskId === undefined || receiptKey !== `${teamId}::${taskId}`
      || key(receipt?.memberId) === undefined || instant(receipt?.assignedAt) === undefined) {
      unscopedLedgerEntries++
      continue
    }
    ledgerCounts.set(teamId, (ledgerCounts.get(teamId) ?? 0) + 1)
  }
  /** A team may only be retained in journal or ledger evidence. */
  const teamIds = [...new Set([...boards.keys(), ...ledgerCounts.keys(), ...passes.map((pass) => pass.teamId)])]
    .filter((id) => id !== unmeasured).sort()
  /** Most of the historical passes came from the Cellwork log, rather than a complete pass capture. */
  const unassignedPasses = passes.filter((pass) => pass.teamId === unmeasured)
  return {
    schemaVersion: 1, workspace: root, capture: { startedAt, finishedAt: new Date().toISOString(), atomic: false },
    teams: teamIds.map((teamId) => {
      /** Ready counts, pairing counts and differences have separate coverage. */
      const teamPasses = passes.filter((pass) => pass.teamId === teamId)
      /** A board with a known empty task list and no retained passes is the explicit empty control. */
      const empty = boards.get(teamId) === 0 && teamPasses.length === 0
      return {
        teamId, taskCountAtScan: boards.get(teamId) ?? unmeasured, passes: teamPasses,
        readyRowsPerPass: empty ? 0 : teamPasses.length === 0 ? unmeasured : teamPasses.map((pass) => pass.readyRowsPerPass),
        pairedPerPass: empty ? 0 : teamPasses.length === 0 ? unmeasured : teamPasses.map((pass) => pass.pairedPerPass),
        readyButUnpaired: empty ? 0 : teamPasses.length === 0 ? unmeasured : teamPasses.map((pass) => pass.readyButUnpaired),
        currentDeliveryReceipts: ledger === undefined ? unmeasured : ledgerCounts.get(teamId) ?? 0,
      }
    }),
    unattributedPasses: unassignedPasses, unscopedLedgerEntries, sources: input.sources,
    units: { ratio: "paired ready rows / ready rows in the same captured pass", ledger: "current scoped assignments; no historical backfill" },
  }
}

/** Emit one JSON document; bad CLI usage has its own exit status. */
function main(args: readonly string[]): void {
  try {
    if (!args[0] || (args.length !== 1 && (args.length !== 3 || args[1] !== "--pass-capture" || !args[2]))) {
      throw new Error("expected a workspace and optionally one workspace-relative capture")
    }
    /** Resolve only the requested workspace root. */
    const root = realpathSync(resolve(args[0]))
    if (!statSync(root).isDirectory()) throw new Error("expected a workspace directory")
    process.stdout.write(JSON.stringify(report(root, args[2]), null, 2) + "\n")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    process.stdout.write(JSON.stringify({ usage: "node scripts/baseline/serial.ts <workspace> [--pass-capture <relative-jsonl>]" }) + "\n")
    process.exitCode = 2
  }
}

main(process.argv.slice(2))
