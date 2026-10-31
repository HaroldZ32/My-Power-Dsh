// THE CELL PLANNER DELEGATES ITS RECONNAISSANCE (contract C5, defect D15).
//
// WHAT THIS LOCKS. D15's second half: nothing restricted the planner's OWN source reads, and the planner's
// instantiation prompt mentioned `cellwork_recon` only in passing. The rule is now MECHANICAL for the seat
// named `cell-planner` in mode `member`: `read`/`grep`/`glob` are refused on a SOURCE path, and the refusal
// names BOTH delegation routes and says WHY. Every other member keeps the untouched work surface — the
// CONTROL arms below prove that, so the restriction cannot leak into the ordinary worker.
//
// TWO SURFACES ARE DRIVEN. The pure decision is walked path by path, and then the INSTALL CALLBACK the row
// really hands the adapter is driven: that second surface is what proves the call's ARGUMENTS and the
// resolved workspace ROOT reach the decision, because a predicate that is right and never fed refuses
// nothing. It also pins the cost rule — the root is resolved ONLY for the planner's three tools.
import { expect, test } from "bun:test"

import {
  PLANNER_RECON_TOOLS,
  PLANNER_SEAT_NAME,
  cellworkGuardDecision,
  installCellworkGuard,
  plannerReadablePath,
  type CellworkSeat,
} from "../src/guard.ts"
import { PLANNER_RECON_LINES } from "../src/prompts.ts"
import { plannerPrompt } from "../src/staging.ts"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The workspace root every arm resolves against; the predicate reads no disk. */
const WORKSPACE = "/ws-planner-guard"

/** The PLANNER's seat: mode `member`, under the name the cell flow stages. */
const PLANNER: CellworkSeat = { cellId: "cell-1", name: PLANNER_SEAT_NAME, mode: "member" }

/** An ordinary member's seat: the untouched work surface, and the control that the rule stays SCOPED. */
const WORKER: CellworkSeat = { cellId: "cell-1", name: "senior-engineer", mode: "member" }

/**
 * Run one call through the REAL decision, with the call's arguments and the resolved root.
 *
 * @param seat - the caller's seat.
 * @param toolName - the tool being dispatched.
 * @param args - the call's argument object, or `undefined` for a bare call.
 * @returns the denial paragraph, or `undefined` when the call is allowed.
 */
function decide(seat: CellworkSeat, toolName: string, args?: Record<string, unknown>): string | undefined {
  return cellworkGuardDecision(seat, toolName, { args, workspaceRoot: WORKSPACE })
}

/**
 * One dispatch handle carrying a tool name and its arguments, as the harness hands it to a guard.
 *
 * @param name - the registered tool name.
 * @param args - the call's argument object.
 * @returns the exec double.
 */
function execOf(name: string, args: Record<string, unknown>): DshToolExec {
  return { name, arguments: args } as unknown as DshToolExec
}

test("a SOURCE read is refused, and the sentence teaches BOTH routes and the reason", () => {
  /** The denial a planner's source read produces. */
  const denial = String(decide(PLANNER, "read", { file_path: "packages/x/src/y.ts" }) ?? "")
  // WHO was refused and WHAT was refused, so the model cannot mistake which call it was.
  expect(denial).toContain("CELL PLANNER")
  expect(denial).toContain("packages/x/src/y.ts")
  // BOTH delegation routes, with the roster names a planner can actually address.
  expect(denial).toContain("cellwork_recon")
  expect(denial).toContain("mpd_role_spawn")
  expect(denial).toContain("Explorer")
  expect(denial).toContain("Researcher")
  // WHY: a delegated report is cheaper than the tree, and the interview needs the context more.
  expect(denial).toContain("DELEGATED")
  expect(denial).toContain("read-only")
  // The band it does keep is advertised, so the refusal is a route rather than a wall.
  expect(denial).toContain(".mpd/**")
  expect(denial).toContain("AGENT.md")
})

test("the band it keeps is the captain's band — prefixes, the root files, and instruction files ANYWHERE", () => {
  // The documentation band, including the cell's own record and the requirements file.
  expect(decide(PLANNER, "read", { file_path: ".mpd/cellwork/cell-1/requirements.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "docs/a.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "evidence/x/y.json" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "agent-references/glossary.md" })).toBeUndefined()
  // The three instruction basenames at any depth, inside the root and OUTSIDE it.
  expect(decide(PLANNER, "read", { file_path: "AGENTS.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "packages/x/AGENTS.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "../VEdit/AGENT.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "/home/other/VEdit/CLAUDE.md" })).toBeUndefined()
  // The root files and the licence band, and the absolute spelling of an allowed band.
  expect(decide(PLANNER, "read", { file_path: "README.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "README.zh-CN.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: "LICENSE.md" })).toBeUndefined()
  expect(decide(PLANNER, "read", { file_path: WORKSPACE + "/docs/a.md" })).toBeUndefined()
  // A NESTED overview file is NOT the band — the same rule the captain's band states.
  expect(String(decide(PLANNER, "read", { file_path: "packages/x/README.md" }) ?? "")).toContain("CELL PLANNER")
  // The predicate agrees with the decision, so this is the band itself, not a decision-only shortcut.
  expect(plannerReadablePath(WORKSPACE, "packages/x/AGENTS.md")).toBe(true)
  expect(plannerReadablePath(WORKSPACE, "packages/x/src/y.ts")).toBe(false)
})

test("grep and glob judge their `path`, and a bare call FAILS CLOSED", () => {
  expect(String(decide(PLANNER, "grep", { pattern: "x", path: "src" }) ?? "")).toContain("CELL PLANNER")
  expect(decide(PLANNER, "grep", { pattern: "x", path: "docs" })).toBeUndefined()
  expect(String(decide(PLANNER, "glob", { pattern: "*.ts", path: "packages" }) ?? "")).toContain("CELL PLANNER")
  expect(decide(PLANNER, "glob", { pattern: "*.md", path: ".mpd" })).toBeUndefined()
  // A bare call searches the whole workspace, which includes every source path.
  expect(String(decide(PLANNER, "read") ?? "")).toContain("no path argument")
  expect(String(decide(PLANNER, "glob", { pattern: "**/*.ts" }) ?? "")).toContain("no path argument")
})

test("the rule covers exactly the THREE path-shaped tools and exactly ONE seat", () => {
  expect([...PLANNER_RECON_TOOLS]).toEqual(["read", "grep", "glob"])
  // Every other tool is somebody else's rule: the planner still writes the requirements document, mails the
  // captain and raises a consult.
  for (const toolName of ["write", "edit", "bash", "mpd_hashline_edit", "mcp__ast_grep__rewrite", "cellwork_recon", "cellwork_requirements", "cellwork_send"]) {
    expect(decide(PLANNER, toolName, { file_path: "packages/x/src/y.ts", command: "cat packages/x/src/y.ts" })).toBeUndefined()
  }
  // An ordinary MEMBER keeps full reconnaissance — the work surface D15 must not narrow.
  expect(decide(WORKER, "read", { file_path: "packages/x/src/y.ts" })).toBeUndefined()
  expect(decide(WORKER, "grep", { pattern: "x", path: "packages/x/src" })).toBeUndefined()
  expect(decide(WORKER, "glob", { pattern: "**/*.ts", path: "src" })).toBeUndefined()
})

test("the seat name is matched after trimming and lower-casing, and only in mode `member`", () => {
  expect(String(decide({ cellId: "c", name: " Cell-Planner ", mode: "member" }, "read", { file_path: "src/y.ts" }) ?? "")).toContain("CELL PLANNER")
  // A CHECKPOINTED planner answers the checkpoint arm, which is a different rule for a different reason.
  expect(String(decide({ cellId: "c", name: PLANNER_SEAT_NAME, mode: "checkpoint" }, "read", { file_path: "src/y.ts" }) ?? "")).toContain("CONTEXT CHECKPOINT")
  // Another cell member whose name merely CONTAINS the word is not the planner.
  expect(decide({ cellId: "c", name: "cell-planner-assistant", mode: "member" }, "read", { file_path: "src/y.ts" })).toBeUndefined()
})

test("THE INSTALL: the callback feeds the decision the ARGUMENTS and the ROOT — and only for the planner", () => {
  /** The callback the install hands the adapter, plus how often the root seam was asked. */
  const capture: { guard?: (exec: DshToolExec) => string | undefined; rootCalls: number } = { rootCalls: 0 }
  /** The seat this arm's lookup answers; switched between the arms below. */
  let seat: CellworkSeat | undefined = PLANNER
  /** A minimal adapter double: the probe, the ONE guard seam and the root seam under test. */
  const dsh = {
    capabilities: () => ({ toolsGuard: true }),
    guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
      capture.guard = guard
      return () => { /* this arm asserts the callback, not disposal */ }
    },
    workspaceRoot: (): string => {
      capture.rootCalls += 1
      return WORKSPACE
    },
  } as unknown as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
  /** The install outcome under the planner seat. */
  const install = installCellworkGuard(dsh, {
    seatOf: () => seat,
    warn: () => { /* the arms assert the decisions, not the row log */ },
  })
  expect(install.installed).toBe(true)
  // A SOURCE read is refused by the INSTALLED callback, and the target it read came from `exec.arguments`.
  expect(String(capture.guard?.(execOf("read", { file_path: WORKSPACE + "/src/y.ts" })) ?? "")).toContain("CELL PLANNER")
  // The ROOT reached the decision: an absolute band spelling is allowed only when it was relativised.
  expect(capture.guard?.(execOf("read", { file_path: WORKSPACE + "/docs/a.md" }))).toBeUndefined()
  // The root is resolved ONLY for the planner's three tools — every other dispatch pays nothing.
  capture.rootCalls = 0
  capture.guard?.(execOf("write", { file_path: "src/y.ts" }))
  expect(capture.rootCalls).toBe(0)
  seat = WORKER
  capture.guard?.(execOf("read", { file_path: "src/y.ts" }))
  expect(capture.rootCalls).toBe(0)
  seat = PLANNER
  capture.guard?.(execOf("read", { file_path: "docs/a.md" }))
  expect(capture.rootCalls).toBe(1)
  // A session in NO cell passes through untouched, whatever it reads.
  seat = undefined
  expect(capture.guard?.(execOf("read", { file_path: "src/y.ts" }))).toBeUndefined()
})

test("THE PROMPT: the planner's instantiation prompt carries the delegation block (C5, ruling R2)", () => {
  // `plannerPrompt` reads exactly two facts of the cell (the id and the objective) plus the persona reader, so
  // a structural double is enough. The cast is this file's ONE shortcut and it is stated here, not hidden:
  // the full `CellState` is not what this arm measures — the SPLICE is.
  const deps = {
    cell: { cellId: "cell-1", objective: "ship the widget" } as unknown as Parameters<typeof plannerPrompt>[0]["cell"],
    personaFor: (): string | null => null,
  }
  /** The planner's instantiation prompt, as `cellwork_start` would build it. */
  const prompt = plannerPrompt(deps)
  // The block is exported by `prompts.ts` (this lane) and spliced by `staging.ts` (lane C, ruling R2), so this
  // arm proves the END of that contract: the planner really READS the guidance, in its own reading order.
  for (const line of PLANNER_RECON_LINES) {
    if (line.trim() === "") continue
    expect(prompt).toContain(line)
  }
  expect(prompt).toContain("RECONNAISSANCE IS DELEGATED, NEVER RUN BY YOU")
  expect(prompt).toContain("cellwork_recon")
  expect(prompt).toContain("mpd_role_spawn")
  // The cell it announces is still the record's, so the block did not displace the prompt it joins.
  expect(prompt).toContain("cell-1")
  expect(prompt).toContain("ship the widget")
})

test("a malformed exec or a throwing root resolver never throws and never denies for its own reason", () => {
  /** The callback of the second install, whose root seam throws. */
  const capture: { guard?: (exec: DshToolExec) => string | undefined } = {}
  /** An adapter whose root seam fails, which is a transient in a real boot. */
  const dsh = {
    capabilities: () => ({ toolsGuard: true }),
    guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
      capture.guard = guard
      return () => { /* this arm asserts the callback, not disposal */ }
    },
    workspaceRoot: (): string => { throw new Error("no workspace root") },
  } as unknown as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
  installCellworkGuard(dsh, {
    seatOf: () => PLANNER,
    warn: () => { /* the arms assert the decisions, not the row log */ },
  })
  // A RELATIVE band path still works without a root, so a transient root failure does not blind the band.
  expect(capture.guard?.(execOf("read", { file_path: "docs/a.md" }))).toBeUndefined()
  // An ABSOLUTE one cannot be judged without a root, so it fails CLOSED rather than passing as code.
  expect(String(capture.guard?.(execOf("read", { file_path: "/abs/docs/a.md" })) ?? "")).toContain("CELL PLANNER")
  // A malformed exec is a PASS-THROUGH: the guard must never take an unrelated call down, nor deny it.
  const throwingExec = new Proxy({}, { get: () => { throw new Error("malformed exec") } }) as unknown as DshToolExec
  expect(() => capture.guard?.(throwingExec)).not.toThrow()
  expect(capture.guard?.(throwingExec)).toBeUndefined()
})
