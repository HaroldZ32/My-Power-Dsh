// THE CONSULT PLANE WRITES (`.mpd/plans/cellwork-consult-dag-nodes.md` §5, acceptance 1-4 and 8).
//
// WHY THESE ARMS EXIST. A background consult has to reach the DAG without a seat ever asking how it is
// doing, so the write path is measured directly here rather than through a rendered surface:
//   - a `cellwork_delegate` call writes one `running` row PER start, with the cell and the excerpt;
//   - the roles row's `onSettled` callback flips that row to its terminal state WITHOUT any `wait` or
//     `collect` — the property the whole "the DAG must not lie" requirement rests on;
//   - a cancel records the interrupted row immediately;
//   - `cellwork_stop` clears the rows AND the book, and a late settlement then writes nothing;
//   - a cell with `teamId === ""` records NOTHING (the declared bound) and still answers the call.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCellConsults, createConsultBook, runConsultAction, startDelegation, type ConsultDeps } from "../src/consults.ts"

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One row the fake team plane received. */
interface PlaneRow {
  /** The team the write was addressed to. */
  teamId: string
  /** The consulted record, read structurally. */
  record: Record<string, unknown>
}

/** The fake team plane: every `upsertConsult`, every `clearConsults`, in call order. */
interface Plane {
  /** The rows received. */
  rows: PlaneRow[]
  /** How many times the clear verb was called. */
  cleared: number
  /** The service object the deps resolve. */
  service: {
    upsertConsult: (input: { workspace: string; teamId: string; record: Record<string, unknown> }) => Promise<unknown>
    clearConsults: (input: { workspace: string; teamId: string }) => Promise<unknown>
  }
}

/**
 * Build the fake plane.
 * @returns the plane, with its recorded calls.
 */
function fakePlane(): Plane {
  /** The recorded state. */
  const plane: Plane = {
    rows: [],
    cleared: 0,
    service: {
      upsertConsult: async (input): Promise<unknown> => { plane.rows.push({ teamId: input.teamId, record: input.record }); return { ok: true } },
      clearConsults: async (): Promise<unknown> => { plane.cleared += 1; return { ok: true, cleared: [] } },
    },
  }
  return plane
}

/** One started consult the fake service minted. */
interface FakeConsult {
  /** The id the start answered, which every later write is keyed by. */
  consultId: string
  /** The role it was started under, echoed back as the view's role. */
  role: string
  /** When it started, epoch milliseconds. */
  startedAt: number
  /** The settlement observer the caller armed, when it armed one. */
  onSettled?: (outcome: unknown) => void
}

/** The fake `mpdConsults` service the deps resolve. */
interface FakeService {
  /** Every consult started, in order. */
  started: FakeConsult[]
  /** The service object. */
  service: {
    canonicalRole: (role: string) => string
    start: (spec: { role: string; task: string; onSettled?: (outcome: unknown) => void }) => Promise<unknown>
    wait: (consultId: string, timeoutMs?: number) => Promise<unknown>
    collect: (consultId: string) => unknown
    cancel: (consultId: string) => unknown
    list: () => unknown
  }
}

/**
 * Build the fake consult service.
 * @returns the service, with the starts it recorded.
 */
function fakeService(): FakeService {
  /** The recorded state. */
  const fake: FakeService = {
    started: [],
    service: {
      canonicalRole: (role: string): string => role,
      start: async (spec): Promise<unknown> => {
        /** The id this start mints. */
        const consultId = "consult-" + String(fake.started.length + 1)
        fake.started.push({ consultId, role: spec.role, startedAt: 1000 + fake.started.length, ...(spec.onSettled === undefined ? {} : { onSettled: spec.onSettled }) })
        return { consultId, role: spec.role, state: "running", startedAt: 1000 + fake.started.length - 1 }
      },
      wait: async (consultId: string): Promise<unknown> => ({ consultId, role: "Explorer", state: "complete", startedAt: 1000, elapsedMs: 500 }),
      collect: (consultId: string): unknown => ({ consultId, role: "Explorer", state: "complete", startedAt: 1000, elapsedMs: 500, report: { consultId, role: "Explorer", status: "complete", summary: "done" } }),
      cancel: (consultId: string): unknown => ({ consultId, role: "Explorer", state: "interrupted", startedAt: 1000, elapsedMs: 120 }),
      list: (): unknown => [],
    },
  }
  return fake
}

/** The sandbox one arm drives. */
interface Sandbox {
  /** The temp workspace the journal resolves under. */
  workspace: string
  /** The fake team plane. */
  plane: Plane
  /** The fake consult service. */
  consults: FakeService
  /**
   * The deps for one `cellwork_delegate` call.
   * @param extra - the fields this arm overrides (`teamId` is the one that matters).
   * @returns the deps object.
   */
  deps: (extra?: Partial<ConsultDeps>) => ConsultDeps
}

/**
 * Build one sandbox.
 * @returns the workspace, both fakes and a deps factory.
 */
function sandbox(): Sandbox {
  /** A fresh temp workspace, so no arm sees another arm's journal. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-consult-writes-"))
  sandboxes.push(workspace)
  /** The fake plane. */
  const plane = fakePlane()
  /** The fake consult service. */
  const consults = fakeService()
  /** The process-local book, fresh per sandbox so the stop marker starts clean. */
  const book = createConsultBook()
  return {
    workspace,
    plane,
    consults,
    deps: (extra: Partial<ConsultDeps> = {}): ConsultDeps => ({
      service: (): typeof consults.service => consults.service,
      rosterNames: (): string[] => ["Explorer", "Researcher", "Deep Worker"],
      cellId: "cell-1",
      workspace,
      exec: { agent: { session: { id: "session-member", header: { cwd: workspace } } } } as never,
      now: new Date("2026-11-10T09:00:00.000Z"),
      book,
      teamId: "team-1",
      teamActions: (): typeof plane.service => plane.service,
      ...extra,
    }),
  }
}

/**
 * Flush the microtask queue so a fire-and-forget plane write lands.
 * @returns a promise that resolves after the queued writes ran.
 */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

describe("acceptance 1: one `running` row per start", () => {
  test("a two-task delegate writes two rows, each with the cell, the role and the excerpt", async () => {
    /** The sandbox under test. */
    const box = sandbox()
    /** The tool's answer. */
    const answer = await startDelegation(box.deps(), [{ role: "Explorer", task: "map the parser" }, { role: "Researcher", task: "find the rule" }])
    expect(answer.ok).toBe(true)
    expect(box.plane.rows.length).toBe(2)
    expect(box.plane.rows.map((row) => row.record.state)).toEqual(["running", "running"])
    expect(box.plane.rows[0].teamId).toBe("team-1")
    expect(box.plane.rows[0].record.cellId).toBe("cell-1")
    expect(box.plane.rows[0].record.role).toBe("Explorer")
    expect(box.plane.rows[0].record.task).toBe("map the parser")
    expect(box.plane.rows[0].record.consultId).toBe("consult-1")
  })
})

describe("acceptance 2: a settlement reaches the record WITHOUT wait/collect", () => {
  test("the observer the start armed flips the row to its terminal state on its own", async () => {
    /** The sandbox under test. */
    const box = sandbox()
    await startDelegation(box.deps(), [{ role: "Explorer", task: "map the parser" }])
    /** The observer the fake service was handed. */
    const observer = box.consults.started[0].onSettled
    expect(typeof observer).toBe("function")
    // THE WHOLE POINT: nobody calls `wait` or `collect` — the roles row fires this when the child settles.
    observer?.({ consultId: "consult-1", role: "Explorer", state: "complete", startedAt: 1000, elapsedMs: 700 })
    await flush()
    /** The terminal row the plane received. */
    const terminal = box.plane.rows[box.plane.rows.length - 1]
    expect(terminal.record.state).toBe("complete")
    expect(terminal.record.elapsedMs).toBe(700)
    expect(terminal.record.finishedAt).toBeNumber()
    // The excerpt survives the settlement even though the outcome carries none.
    expect(terminal.record.task).toBe("map the parser")
  })
})

describe("acceptance 3: a cancel records the interrupted row immediately", () => {
  test("`cellwork_consult cancel` writes the observed row", async () => {
    /** The sandbox under test. */
    const box = sandbox()
    await startDelegation(box.deps(), [{ role: "Explorer", task: "map the parser" }])
    /** The cancel's answer. */
    const answer = await runConsultAction(box.deps(), { action: "cancel", consultId: "consult-1", timeoutMs: 0 })
    expect(answer.ok).toBe(true)
    /** The terminal row the plane received. */
    const cancelled = box.plane.rows[box.plane.rows.length - 1]
    expect(cancelled.record.state).toBe("interrupted")
    expect(cancelled.record.consultId).toBe("consult-1")
  })
})

describe("acceptance 4: `cellwork_stop` clears the rows and a late settlement writes nothing", () => {
  test("the clear runs, the book forgets the cell, and a late observer is journaled instead of recorded", async () => {
    /** The sandbox under test. */
    const box = sandbox()
    await startDelegation(box.deps(), [{ role: "Explorer", task: "map the parser" }])
    /** The observer armed at start, captured before the stop. */
    const observer = box.consults.started[0].onSettled
    /** How many plane rows existed before the stop. */
    const before = box.plane.rows.length
    await clearCellConsults(box.deps())
    expect(box.plane.cleared).toBe(1)
    expect(box.deps().book.has("cell-1")).toBe(false)
    // THE LATE SETTLEMENT: the cell is gone, so it must NOT re-create a row.
    observer?.({ consultId: "consult-1", role: "Explorer", state: "complete", startedAt: 1000, elapsedMs: 700 })
    await flush()
    expect(box.plane.rows.length).toBe(before)
  })
})

describe("the declared bound: a cell with no team records nothing", () => {
  test("`teamId === \"\"` writes no row, journals `consult-unattached`, and the answer is unchanged", async () => {
    /** The sandbox whose cell never approved a team. */
    const box = sandbox()
    /** The tool's answer. */
    const answer = await startDelegation(box.deps({ teamId: "" }), [{ role: "Explorer", task: "map the parser" }])
    expect(answer.ok).toBe(true)
    expect(answer.ok === true ? answer.started : 0).toBe(1)
    expect(box.plane.rows.length).toBe(0)
    /** The journal text the row wrote, read from disk. */
    const journal = await import("node:fs").then((fs) => fs.readFileSync(join(box.workspace, ".mpd", "cellwork", "cell-1", "journal.jsonl"), "utf8"))
    expect(journal).toContain("consult-unattached")
  })
})

describe("a plane refusal never changes the tool answer", () => {
  test("an absent `upsertConsult` verb journals and still answers `ok`", async () => {
    /** The sandbox whose composition mounts no plane writer. */
    const box = sandbox()
    /** The tool's answer. */
    const answer = await startDelegation(box.deps({ teamActions: (): undefined => undefined }), [{ role: "Explorer", task: "map the parser" }])
    expect(answer.ok).toBe(true)
    expect(box.plane.rows.length).toBe(0)
    /** The journal text the row wrote, read from disk. */
    const journal = await import("node:fs").then((fs) => fs.readFileSync(join(box.workspace, ".mpd", "cellwork", "cell-1", "journal.jsonl"), "utf8"))
    expect(journal).toContain("consult-unrecorded")
  })
})
