// The pool-capability guard: a pooled task a member cannot EXECUTE is left in the
// pool for a member that can, and the withholding is loud.
//
// DEFECT (measured 2026-09-14, twice): read-only members received pooled
// implementation tasks, because the pool branch of the selection had no capability
// test at all — `nextReadyTask` returns the first ready unassigned task. The fix is
// region-registered adopted-code change (`mpd-delta pool-capability-guard` +
// `mpd-delta pool-capability-select`), so this file pins BOTH the behaviour and the
// registration invariants (nothing unmarked, and a re-materialize is REFUSED loudly
// instead of silently resurrecting the defect).
import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { MPD_DELTAS } from "../lib/mpd-deltas.ts"
import { codeOf } from "./lib-absence.ts"
import { applyAgentTeamsFixes } from "../../../scripts/patch-agent-teams-fixes.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import * as scheduler from "../lib/scheduler.ts"
import { stageScript } from "./scratch-scripts.ts"

// Namespace import on purpose: the fix may be ABSENT (pre-fix tree, or a re-materialize
// that dropped the region), and each test below must then fail on its own behaviour
// instead of the whole file failing to LINK.
const nextCapableTask = scheduler.nextCapableTask

/** One task of the pool fixture, in the shape the capability guard reads. */
interface PoolTask {
    /** The task's id, which the picked candidate and the withholdings are reported by. */
    readonly id: string
    /** The task's subject text. */
    readonly subject: string
    /** The task's kind; `review` needs no write tool where `implementation` does. */
    readonly kind: string
    /** The task's status. */
    readonly status: string
    /** Ids this task depends on. */
    readonly dependencies: readonly string[]
    /** The write scope the task declares, which the capability need is computed from. Absent on a review, which declares no write scope of its own. */
    readonly inScope?: readonly string[]
    /** The verification commands the task declares. Absent on a review, which declares no write scope of its own. */
    readonly verify?: readonly string[]
    /** The task this one reviews, for the review kind. */
    readonly reviewedTaskId?: string
    /** The criteria the review records, for the review kind. */
    readonly acceptance?: readonly string[]
    /** The seat the task is assigned to, present on an explicit pairing. */
    readonly assignee?: string
}

/** One member row as the pool selection reads its capability. */
interface PoolMember {
    /** The member's display name, which the selection and the gap predicate read. */
    readonly name: string
    /** The tool names this seat cannot call; the capability gap is computed from them. */
    readonly toolDeny: readonly string[]
}

/** One candidate the guard withheld from a member, as the withholding callback reports it. */
interface WithheldCandidate {
    /** The withheld task's id. */
    readonly id: string
    /** The tools the member would need and does not have; absent when the callback omits the gap. */
    readonly gap?: readonly string[]
    /** Whether the pairing was the captain's EXPLICIT assignment rather than a pool pick. */
    readonly explicit: boolean
}

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id, which the registration arms pin against. */
    readonly id: string
}

/** The vendored plugin's root directory, derived from this file's own URL. */
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
/** The repository root, derived from the plugin root above. */
const repoRoot = join(pluginRoot, "..", "..")
/** The vendored scheduler module the registration arms read. */
const SCHEDULER = join(pluginRoot, "lib", "scheduler.ts")

/** The roster's read-only restriction, verbatim from the profile data. */
const READONLY_DENY = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]

/** One pooled IMPLEMENTATION task: it needs a write tool, which a read-only seat lacks. */
const implementationTask = (id: string): PoolTask => ({
  id,
  subject: `implement ${id}`,
  kind: "implementation",
  status: "pending",
  dependencies: [],
  inScope: ["packages/thing/src/index.ts"],
  verify: ["./verify.sh"],
})
/** One pooled REVIEW task: it needs no write tool, so every seat can execute it. */
const reviewTask = (id: string): PoolTask => ({
  id,
  subject: `review ${id}`,
  kind: "review",
  status: "pending",
  dependencies: [],
  reviewedTaskId: "t1",
  acceptance: ["verdict recorded"],
})
/** A member carrying the roster's read-only deny list verbatim. */
const readOnly = (name: string): PoolMember => ({ name, toolDeny: READONLY_DENY })
/** A member that withholds nothing, so the guard must not refuse it anything. */
const writer = (name: string): PoolMember => ({ name, toolDeny: [] })

test("a pooled write task is LEFT IN THE POOL for a read-only member and reported", () => {
/** The pool the read-only seat chooses from. */
  const tasks = [implementationTask("t1"), reviewTask("t2")]
/** Every candidate the guard withheld from that seat, with the tools it lacked. */
  const withheld: WithheldCandidate[] = []
/** The task the guard picked for the read-only seat. */
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task: PoolTask, gap: readonly string[], explicit: boolean) => withheld.push({ id: task.id, gap, explicit }))

  // The review task is the one it can execute; the implementation task stays pooled.
  expect(picked?.id).toBe("t2")
  expect(withheld).toEqual([{ id: "t1", gap: ["write", "edit", "mpd_hashline_edit", "bash"], explicit: false }])
})

test("a write-capable member still gets the pooled write task (the guard is not a blanket refusal)", () => {
/** The same pool, offered to a write-capable seat. */
  const tasks = [implementationTask("t1"), reviewTask("t2")]
/** Every candidate the guard withheld from that seat, which must stay empty. */
  const withheld: WithheldCandidate[] = []
/** The task the guard picked for the write-capable seat. */
  const picked = nextCapableTask(tasks, writer("Senior Engineer"), (task: PoolTask, gap: readonly string[], explicit: boolean) => withheld.push({ id: task.id, gap, explicit }))
  expect(picked?.id).toBe("t1")
  expect(withheld).toEqual([])
})

test("a member whose deny blocks nothing relevant is unaffected by an unrelated deny entry", () => {
/** The pool for the unrelated-deny arm. */
  const tasks = [implementationTask("t1")]
/** A seat whose deny list blocks nothing this task needs. */
  const partial = { name: "Vision Analyst", toolDeny: ["mcp__lsp__rename"] }
  expect(nextCapableTask(tasks, partial, () => {})?.id).toBe("t1")
})

test("an EXPLICIT assignment is still dispatched to a restricted member, and says so", () => {
  // The captain's explicit pairing is the captain's decision: refusing it silently
  // would stall the DAG. It is dispatched, with a note that names the restriction.
  const tasks = [{ ...implementationTask("t1"), assignee: "Architect" }]
/** Every candidate the guard withheld from the explicitly paired seat. */
  const withheld: WithheldCandidate[] = []
/** The explicitly assigned task, which must be dispatched despite the restriction. */
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task: PoolTask, gap: readonly string[], explicit: boolean) => withheld.push({ id: task.id, gap, explicit }))
  expect(picked?.id).toBe("t1")
  expect(withheld).toEqual([{ id: "t1", gap: ["write", "edit", "mpd_hashline_edit", "bash"], explicit: true }])
})

test("a member's own ready task outranks a pooled task it could also run", () => {
/** A pool mixing an owned review, a pooled review and a pooled implementation task. */
  const tasks = [{ ...reviewTask("t1"), assignee: "Architect" }, reviewTask("t2"), implementationTask("t3")]
/** The task the guard picked, which must be the seat's own ready review. */
  const picked = nextCapableTask(tasks, readOnly("Architect"), () => {})
  expect(picked?.id).toBe("t1")
})

test("nothing executable is left: undefined, and every withheld candidate is reported", () => {
/** A pool of two implementation tasks, neither of which the seat can execute. */
  const tasks = [implementationTask("t1"), implementationTask("t2")]
/** Every candidate the guard withheld, reported without a gap by this callback. */
  const withheld: WithheldCandidate[] = []
/** The pick, which must be undefined when nothing executable is left. */
  const picked = nextCapableTask(tasks, readOnly("Architect"), (task: PoolTask, gap: readonly string[], explicit: boolean) => withheld.push({ id: task.id, explicit }))
  expect(picked).toBeUndefined()
  expect(withheld.map((entry) => entry.id)).toEqual(["t1", "t2"])
})

test("the guard is region-registered and its replacement is REFUSED after a re-materialize", () => {
/** The canonical scheduler source the registration arms read. */
  const source = readFileSync(SCHEDULER, "utf8")
  // (1) Nothing unmarked: every introduced symbol lives inside a delta region.
  const stripped = source.replace(/\/\/#region mpd-delta [\s\S]*?\/\/#endregion mpd-delta [A-Za-z0-9-]+/g, "")
  for (const token of ["nextCapableTask", "taskCapabilityGap", "taskCapabilityNeed", "pool-capability"])
    expect(stripped).not.toContain(token)
  // (2) The replacement is registered where the seam is.
  const ids = MPD_DELTAS.filter((delta: DeltaEntry) => delta.file.endsWith("scheduler.ts")).map((delta: DeltaEntry) => delta.id)
  expect(ids).toContain("mpd-delta pool-capability-guard")
  expect(ids).toContain("mpd-delta pool-capability-select")

  // (3) A re-materialize that restores the upstream call site REFUSES loudly (the
  // replacement-shaped class: the seam's context pair no longer brackets an empty gap).
  const root = mkdtempSync(join(tmpdir(), "mpd-pool-cap-"))
  try {
/** The scratch tree's `lib/` directory, which the registry's files are copied into. */
    const libDir = join(root, "packages", "mpd-agent-teams-plugin", "lib")
    mkdirSync(libDir, { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of [...new Set<string>(MPD_DELTAS.map((delta: DeltaEntry): string => delta.file.split("/").pop()!))])
      cpSync(join(pluginRoot, "lib", name), join(libDir, name))
    stageScript(root, "patch-agent-teams-fixes.ts")
/** The scratch copy of the scheduler the re-materialize is simulated on. */
    const target = join(libDir, "scheduler.ts")
    // Simulate the re-materialize: the upstream selection comes back, our region is gone.
    const materialized = readFileSync(target, "utf8").replace(
      /[ ]*\/\/#region mpd-delta pool-capability-select[\s\S]*?\/\/#endregion mpd-delta pool-capability-select\n/,
      "                    const task = recoverOwned ? owned : owned === undefined\n                        ? nextReadyTask(fresh.tasks, currentMember.name)\n                        : undefined;\n")
    // T-92 (t43): the absence is a statement about the REGION, so it is asserted against the
    // comment-stripped text — a comment naming the region id must not redden it.
    expect(codeOf(materialized)).not.toContain("mpd-delta pool-capability-select")
    writeFileSync(target, materialized)
    expect(() => applyAgentTeamsFixes({ root, write: true })).toThrow(/pool-capability-select/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
