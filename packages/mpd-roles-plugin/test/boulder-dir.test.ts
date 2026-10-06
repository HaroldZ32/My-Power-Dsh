// SIGNAL D's STATE ROOT — the defect that made the gate unable to fire on the documented path.
//
// MEASURED 2026-10-06 (live, evidence/dsh-qa/session-start-team/): the ledger seeded at the contract
// path `<ws>/.mpd/boulder.json` read `active:false`, while the SAME bytes at
// `<ws>/.mpd/.mpd/boulder.json` fired the gate with `signals=D`. The cause was the knob's retired
// schema default: `boulder.dir` declared `.default(".mpd")` resolved to `".mpd"` in a real boot, the
// consumers treated that value as a workspace-like ROOT, and each then joined `.mpd/boulder.json`
// onto it. These arms pin the PATH, not a read's return value, so a future re-introduction of a
// default (or a consumer that forgets the shared normalization) reddens here instead of silently
// making signal D unreachable again.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readBoulderGate, resolveBoulderDir, WORKSPACE_ROOT_SPELLINGS } from "../src/complexity-gate.ts"

/** The session workspace every arm below reads from. */
const WORKSPACE = "/tmp/mpd-boulder-dir-ws"
/** The ledger path the CONTRACT names, which is the only one signal D may read. */
const CONTRACT_PATH = join(WORKSPACE, ".mpd", "boulder.json")

/**
 * Read the ledger through the gate while recording WHICH path it asked for.
 * @param options - the `boulder.dir` override to pass, if any.
 * @returns the path the gate read and its verdict.
 */
async function tracedRead(options: { boulderDir?: string } = {}): Promise<{ path: string; active: boolean }> {
  /** Every path the injected reader was asked for, in call order. */
  const asked: string[] = []
  /** An ACTIVE ledger body, so a correct path is also observable in the verdict. */
  const ledger = JSON.stringify({ active_work_id: "w1", works: { w1: { status: "active" } } })
  /** The gate's verdict for the ledger body above. */
  const read = await readBoulderGate(WORKSPACE, {
    readFile: async (path: string): Promise<string> => { asked.push(path); return ledger },
    ...(options.boulderDir === undefined ? {} : { boulderDir: options.boulderDir }),
  })
  return { path: asked[0] ?? "", active: read.active }
}

describe("resolveBoulderDir — the ONE reading of the knob", () => {
  test("every state-directory spelling means the SESSION WORKSPACE, never a root to join onto", () => {
    // The rule is a class, not the one string that happened to be measured: `.mpd` with or without a
    // leading `./` and with or without a trailing slash all name the conventional state dir.
    for (const spelling of WORKSPACE_ROOT_SPELLINGS) {
      expect(resolveBoulderDir(spelling)).toBeUndefined()
    }
    expect(resolveBoulderDir(".mpd")).toBeUndefined()
    // Non-strings and blank values are "unset" too, so a caller can pass a raw config value.
    expect(resolveBoulderDir(undefined)).toBeUndefined()
    expect(resolveBoulderDir(null)).toBeUndefined()
    expect(resolveBoulderDir("")).toBeUndefined()
    expect(resolveBoulderDir("   ")).toBeUndefined()
    expect(resolveBoulderDir(42)).toBeUndefined()
  })

  test("a real root override is kept, trimmed and otherwise verbatim", () => {
    expect(resolveBoulderDir("/srv/state")).toBe("/srv/state")
    expect(resolveBoulderDir("  /srv/state  ")).toBe("/srv/state")
    expect(resolveBoulderDir("relative/state")).toBe("relative/state")
  })
})

describe("readBoulderGate reads the CONTRACT path", () => {
  test("with boulder.dir UNSET the ledger is read at <ws>/.mpd/boulder.json", async () => {
    /** The read the gate performed with no override at all. */
    const unset = await tracedRead()
    expect(unset.path).toBe(CONTRACT_PATH)
    expect(unset.active).toBe(true)
    // An explicit empty string is the same state as absent: the empty value is not a root.
    expect((await tracedRead({ boulderDir: "" })).path).toBe(CONTRACT_PATH)
  })

  test("a `.mpd` override — the retired default — STILL reads the contract path, not a doubled one", async () => {
    // This is the measured failure written as an assertion: accepting `.mpd` as a root produced
    // `<ws>/.mpd/.mpd/boulder.json`, and the doubling is what made signal D unreachable.
    /** The read the gate performed for the legacy spelling. */
    const legacy = await tracedRead({ boulderDir: ".mpd" })
    expect(legacy.path).toBe(CONTRACT_PATH)
    expect(legacy.path).not.toContain(join(".mpd", ".mpd"))
    expect(legacy.active).toBe(true)
    expect((await tracedRead({ boulderDir: "./.mpd/" })).path).toBe(CONTRACT_PATH)
    // `.` is the workspace itself, so it reads the contract path too.
    expect((await tracedRead({ boulderDir: "." })).path).toBe(CONTRACT_PATH)
  })

  test("an explicitly SET boulder.dir still overrides for the gate", async () => {
    /** The read the gate performed for a real override. */
    const overridden = await tracedRead({ boulderDir: "/srv/state" })
    expect(overridden.path).toBe(join("/srv/state", ".mpd", "boulder.json"))
    expect(overridden.active).toBe(true)
  })
})
