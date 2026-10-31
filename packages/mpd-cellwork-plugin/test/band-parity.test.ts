// THE TWO BANDS ARE ONE CONTRACT — pinned HERE, in a test, never in shipped code (C5's design note).
//
// WHY A PARITY TEST AT ALL. The cellwork guard duplicates the captain's band lists on purpose: that package
// ships NO runtime dependency on `mpd-roles-plugin`, so a shared import would couple two rows' dists and
// drag the roles module into the cellwork bundle. The duplication is safe only while something FAILS the
// moment the two disagree — and that something is this file. It imports BOTH modules from source, compares
// every list and the licence regex, and then drives one path TABLE through BOTH predicates, so the
// SEMANTICS are pinned as well as the literals: a copy that kept the strings and changed the order of the
// checks would still redden here.
//
// The table's expected column is the CONTRACT's answer, not either implementation's: each row is asserted
// against the requirement and then against both predicates, so a shared mistake cannot pass as parity.
import { expect, test } from "bun:test"

import {
  CAPTAIN_INSTRUCTION_BASENAMES,
  CAPTAIN_READABLE_PREFIXES,
  CAPTAIN_READABLE_ROOT_FILES,
  ROOT_LICENSE_PATTERN,
  captainReadablePath,
} from "../../mpd-roles-plugin/src/captain-investigation.ts"
import {
  PLANNER_INSTRUCTION_BASENAMES,
  PLANNER_LICENSE_PATTERN,
  PLANNER_READABLE_PREFIXES,
  PLANNER_READABLE_ROOT_FILES,
  plannerReadablePath,
} from "../src/guard.ts"

/** The root BOTH predicates judge against, so the table measures the RULE and not the caller. */
const WORKSPACE = "/ws-band-parity"

/** One path the two predicates must classify IDENTICALLY, with the answer the frozen contract requires. */
interface BandCase {
  /** The path as a tool call would spell it. */
  path: string
  /** Whether the contract admits that spelling. */
  readable: boolean
}

/** The table: every class of the band, one admitted and one refused spelling for each. */
const CASES: readonly BandCase[] = [
  // The documentation band prefixes, including the band directory itself and the `./` spelling of a member.
  { path: ".mpd/plans/p.md", readable: true },
  { path: "docs/a.md", readable: true },
  { path: "evidence/x/y.json", readable: true },
  { path: "agent-references/glossary.md", readable: true },
  { path: ".mpd", readable: true },
  { path: "./docs/a.md", readable: true },
  // The three instruction basenames at ANY depth, inside the root and OUTSIDE it (C4, D14).
  { path: "AGENTS.md", readable: true },
  { path: "AGENT.md", readable: true },
  { path: "CLAUDE.md", readable: true },
  { path: "packages/x/AGENTS.md", readable: true },
  { path: "src/deep/CLAUDE.md", readable: true },
  { path: "../VEdit/AGENT.md", readable: true },
  { path: "/home/elsewhere/VEdit/AGENT.md", readable: true },
  { path: WORKSPACE + "/packages/x/AGENTS.md", readable: true },
  // The root files and the licence band, which are the ROOT only — there is no nested README band.
  { path: "README.md", readable: true },
  { path: "README.zh-CN.md", readable: true },
  { path: "CHANGELOG.md", readable: true },
  { path: "LICENSE.md", readable: true },
  { path: "LICENSE-NOTICES.md", readable: true },
  { path: WORKSPACE + "/docs/a.md", readable: true },
  // Everything the band does NOT admit: sources, nested overview files, `..` hops and unrelated absolutes.
  { path: "packages/x/README.md", readable: false },
  { path: "packages/x/LICENSE.md", readable: false },
  { path: "packages/x/src/y.ts", readable: false },
  { path: "src/main.ts", readable: false },
  { path: WORKSPACE + "/packages/x/src/y.ts", readable: false },
  { path: "../VEdit/src/main.ts", readable: false },
  { path: "/etc/passwd", readable: false },
  { path: "docs/../packages/x/src/y.ts", readable: false },
  { path: "", readable: false },
  { path: ".", readable: false },
]

test("the LITERALS are equal: prefixes, root files, instruction basenames and the licence regex", () => {
  expect([...PLANNER_READABLE_PREFIXES]).toEqual([...CAPTAIN_READABLE_PREFIXES])
  expect([...PLANNER_READABLE_ROOT_FILES]).toEqual([...CAPTAIN_READABLE_ROOT_FILES])
  expect([...PLANNER_INSTRUCTION_BASENAMES]).toEqual([...CAPTAIN_INSTRUCTION_BASENAMES])
  // The regex is compared by its SOURCE and FLAGS, because two equal literals are two different objects.
  expect(PLANNER_LICENSE_PATTERN.source).toBe(ROOT_LICENSE_PATTERN.source)
  expect(PLANNER_LICENSE_PATTERN.flags).toBe(ROOT_LICENSE_PATTERN.flags)
  // GUARD AGAINST A VACUOUS PASS: an empty list on both sides would be "equal" and admit nothing.
  expect(CAPTAIN_READABLE_PREFIXES.length).toBeGreaterThan(0)
  expect(CAPTAIN_READABLE_ROOT_FILES.length).toBeGreaterThan(0)
  expect(CAPTAIN_INSTRUCTION_BASENAMES.length).toBe(3)
})

test("the SEMANTICS are equal, row by row, and each row is the CONTRACT's answer", () => {
  for (const bandCase of CASES) {
    /** The CAPTAIN's answer for this row. */
    const captain = captainReadablePath(WORKSPACE, bandCase.path)
    /** The PLANNER's answer for the same row; parity means these two are always equal. */
    const planner = plannerReadablePath(WORKSPACE, bandCase.path)
    // The contract's answer first, so a shared implementation mistake cannot masquerade as parity.
    expect({ path: bandCase.path, readable: captain }).toEqual({ path: bandCase.path, readable: bandCase.readable })
    expect({ path: bandCase.path, readable: planner }).toEqual({ path: bandCase.path, readable: bandCase.readable })
    // And then the parity itself, stated once more so a failure names the divergence directly.
    expect(planner).toBe(captain)
  }
})

test("the instruction basenames are the ONLY class admitted outside the workspace root", () => {
  // A sibling project's instruction file is the motivating read; its SOURCE tree and its README are not.
  for (const path of ["../VEdit/AGENTS.md", "/home/elsewhere/VEdit/AGENT.md"]) {
    expect(captainReadablePath(WORKSPACE, path)).toBe(true)
    expect(plannerReadablePath(WORKSPACE, path)).toBe(true)
  }
  for (const path of ["../VEdit/src/main.ts", "/home/elsewhere/VEdit/README.md", "/etc/passwd"]) {
    expect(captainReadablePath(WORKSPACE, path)).toBe(false)
    expect(plannerReadablePath(WORKSPACE, path)).toBe(false)
  }
})
