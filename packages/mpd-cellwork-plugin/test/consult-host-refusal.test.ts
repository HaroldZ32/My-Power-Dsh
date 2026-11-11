// THE CELLWORK VIEW OF A HOST-REFUSED CONSULT (R3 repair, F3): the row projection, the count helper, the
// journal row and the list field an operator render can read.
//
// WHY THIS FILE EXISTS. The supervisor's own view (`ConsultView.hostRetries`) and `effectiveBudgetOf`
// already have arms in `packages/mpd-roles-plugin/test/cap-queue.test.ts`. What had NO arm is this
// package's boundary: `consultRowOf` dropping a valid `hostRetries`, `hostRefusalsOf` counting the wrong
// rows, and the durable `consult-host-refused` journal row the operator advice is derived from. These
// arms use the REAL `startDelegation`/`runConsultAction` paths with a fake service, so the shape they
// assert is the shape a render actually receives — not a hand-built object.
import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  consultRowOf,
  createConsultBook,
  hostRefusalsOf,
  runConsultAction,
  startDelegation,
  type ConsultDeps,
  type ConsultServiceView,
} from "../src/consults.ts"
import { journalPath } from "../src/state.ts"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell every arm works in. */
const CELL_ID = "cell-20261111T000000000Z"

/** One settled consult outcome, as the supervisor would hand it to the observer. */
interface SettledOutcome {
  /** The consult identity. */
  consultId: string
  /** The roster role. */
  role: string
  /** The terminal state. */
  state: string
  /** How many host refusals the consult survived, when any. */
  hostRetries?: number
}

/** The fake `mpdConsults` service plus what the arm needs to drive it. */
interface Fixture {
  /** The dependencies `startDelegation` / `runConsultAction` take. */
  deps: ConsultDeps
  /** Every `onSettled` observer the starts armed, in start order. */
  observers: Array<(outcome: unknown) => void>
  /** The workspace root (journal path). */
  workspace: string
}

/**
 * Build a fixture: a temp workspace, the process-local consult book and a scripted service.
 *
 * @param listRows - the rows the service's `list` answers (the process-wide view a render reads).
 * @returns the dependencies, the armed observers and the workspace.
 */
function makeFixture(listRows: Array<Record<string, unknown>>): Fixture {
  /** The temp workspace the journal lives under. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-host-retries-"))
  /** The observers every start armed. */
  const observers: Array<(outcome: unknown) => void> = []
  /** The monotonic part of a minted id. */
  let sequence = 0
  /** The service slice this package reads. */
  const service: ConsultServiceView = {
    canonicalRole: (role: string): unknown => (role.trim().toLowerCase() === "explorer" ? "Explorer" : undefined),
    start: async (spec): Promise<unknown> => {
      sequence += 1
      /** The minted id. */
      const consultId = "consult-" + String(sequence)
      if (spec.onSettled !== undefined) observers.push(spec.onSettled)
      return { consultId, role: "Explorer", state: "running", startedAt: 1, elapsedMs: 0 }
    },
    list: (): unknown => listRows.map((row) => ({ ...row })),
  }
  /** The dependencies both call paths take. */
  const deps: ConsultDeps = {
    service: (): ConsultServiceView | undefined => service,
    rosterNames: (): string[] => ["Explorer", "Researcher"],
    cellId: CELL_ID,
    workspace,
    // The fake service ignores `exec`; it exists because the real seam forwards it.
    exec: {} as unknown as DshToolExec,
    now: new Date("2026-11-11T00:00:01.000Z"),
    book: createConsultBook(),
    teamId: "",
    teamActions: (): undefined => undefined,
  }
  return { deps, observers, workspace }
}

/**
 * Read every journal row a cell wrote.
 *
 * @param workspace - the workspace root.
 * @returns the parsed rows, oldest first (empty when nothing was written).
 */
function journalRows(workspace: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(journalPath(workspace, CELL_ID), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    return []
  }
}

test("F3: consultRowOf keeps a POSITIVE hostRetries and drops 0, a string and an absent value", () => {
  /** A settled view with the refusal count the supervisor publishes. */
  const withRetries = consultRowOf({ consultId: "c1", role: "Explorer", state: "complete", startedAt: 1, elapsedMs: 5, hostRetries: 2 })
  expect(withRetries?.hostRetries).toBe(2)
  // ZERO MEANS "admitted first time": the field is absent rather than a misleading 0.
  expect(consultRowOf({ consultId: "c2", state: "running", hostRetries: 0 })?.hostRetries).toBeUndefined()
  // A non-numeric answer is dropped, never coerced.
  expect(consultRowOf({ consultId: "c3", state: "running", hostRetries: "2" })?.hostRetries).toBeUndefined()
  expect(consultRowOf({ consultId: "c4", state: "running" })?.hostRetries).toBeUndefined()
  // A row without an id is not a row at all, whatever else it carries.
  expect(consultRowOf({ hostRetries: 3 })).toBeUndefined()
})

test("F3: hostRefusalsOf counts only rows that survived a host refusal, ignoring junk", () => {
  /** One refused view, one clean view, one zero, one unreadable entry. */
  const views: unknown[] = [
    { consultId: "c1", state: "complete", hostRetries: 3 },
    { consultId: "c2", state: "complete" },
    { consultId: "c3", state: "complete", hostRetries: 0 },
    null,
    "not a view",
  ]
  expect(hostRefusalsOf(views)).toBe(1)
  // A clean cell prints no advice line at all.
  expect(hostRefusalsOf([{ consultId: "c2", state: "running" }])).toBe(0)
  expect(hostRefusalsOf([])).toBe(0)
})

test("F3: a settled refused consult writes ONE consult-host-refused journal row; a clean one writes none", async () => {
  /** The fixture with two starts. */
  const fixture = makeFixture([{ consultId: "consult-1", role: "Explorer", state: "complete", startedAt: 1, elapsedMs: 5, hostRetries: 2 }])
  /** Two consult tasks in ONE delegation. */
  const started = await startDelegation(fixture.deps, [
    { role: "Explorer", task: "probe the tree" },
    { role: "Explorer", task: "probe the docs" },
  ])
  expect(started.ok).toBe(true)
  expect(fixture.observers.length).toBe(2)
  // THE SETTLEMENT PATH IS THE REAL OBSERVER: consult-1 survived two host refusals, consult-2 none.
  const first: SettledOutcome = { consultId: "consult-1", role: "Explorer", state: "complete", hostRetries: 2 }
  /** The CLEAN settlement of consult-2: it must write no host-refusal row at all. */
  const second: SettledOutcome = { consultId: "consult-2", role: "Explorer", state: "complete" }
  fixture.observers[0](first)
  fixture.observers[1](second)
  /** Every row the cell journaled. */
  const rows = journalRows(fixture.workspace)
  /** The host-refusal rows only. */
  const refusals = rows.filter((row) => row.event === "consult-host-refused")
  expect(refusals.length).toBe(1)
  // THE SHAPE THE OPERATOR ADVICE READS: event, the consult id and the refusal count, stamped with `at`.
  expect(refusals[0].consultId).toBe("consult-1")
  expect(refusals[0].hostRetries).toBe(2)
  expect(typeof refusals[0].at).toBe("string")
  // The delegation itself journaled its starts, so the row above is distinguishable from them.
  expect(rows.some((row) => row.event === "delegate-start")).toBe(true)
})

test("F3: cellwork_consult `list` carries hostRetries through to the answer a render reads", async () => {
  /** The fixture whose service reports one refused consult. */
  const fixture = makeFixture([{ consultId: "consult-1", role: "Explorer", state: "complete", startedAt: 1, elapsedMs: 5, hostRetries: 2 }])
  /** One consult this cell owns. */
  const started = await startDelegation(fixture.deps, [{ role: "Explorer", task: "probe the tree" }])
  expect(started.ok).toBe(true)
  /** The list answer. */
  const listed = await runConsultAction(fixture.deps, { action: "list", consultId: "", timeoutMs: undefined })
  expect(listed.ok).toBe(true)
  /** The rows this cell reads back. */
  const rows = listed.consults as Array<Record<string, unknown>>
  expect(rows.length).toBe(1)
  // THE FIELD T1's RENDER MAY RELY ON: `consults[].hostRetries`, present only when the host refused.
  expect(rows[0].hostRetries).toBe(2)
  expect(rows[0].consultId).toBe("consult-1")
  expect(rows[0].state).toBe("complete")
})
