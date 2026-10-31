// THE CAPTAIN MAY READ PROJECT INSTRUCTION FILES ANYWHERE (contract C4, defect D14).
//
// WHAT THIS LOCKS. D14 was observed live: a captain could NOT read a sibling project's `AGENT.md`, and the
// refusal text under-advertised the band it did keep (it omitted `AGENT.md`/`CLAUDE.md` and spelled
// `README*.md` as though a glob were admitted). So the band is asserted TWICE here — as BEHAVIOUR through
// the real predicate, path by path, and as PROSE through the sentence a refused call carries.
//
// WHY THE INSTRUCTION FILE IS BAND-EXEMPT BY BASENAME: it is the document a reader consults to learn the
// rules, so a depth test or a root test on it refuses the one file a newcomer needs first. Everything else
// stays exactly as it was: source paths and `..` hops are still refused, and a nested README is not the band.
import { expect, test } from "bun:test"

import {
  CAPTAIN_INSTRUCTION_BASENAMES,
  CAPTAIN_READABLE_PREFIXES,
  CAPTAIN_READABLE_ROOT_FILES,
  captainInvestigationDecision,
  captainReadablePath,
} from "../src/captain-investigation.ts"
import { sessionIsMpdCaptain } from "../src/complexity-gate.ts"

/** The workspace root every arm resolves against; the predicate reads no disk. */
const WORKSPACE = "/ws-c4-instruction-files"

/** The `mpd` preset's TOP-LEVEL session — the one session this rule is scoped to. */
const CAPTAIN = { id: "captain-session", session: { id: "captain-session", header: { agentPreset: "mpd", delegationDepth: 0 } } }

/** A member session (`delegationDepth: 1`): it keeps full reconnaissance, and C4 must not change that. */
const MEMBER = { id: "member-session", session: { id: "member-session", header: { agentPreset: "mpd", delegationDepth: 1 } } }

/**
 * Run one call through the REAL decision, in the shipped default mode.
 *
 * @param toolName - the tool being dispatched.
 * @param args - the call's argument object.
 * @param agent - the calling agent double; the `mpd` captain by default.
 * @returns the denial the guard would hand the harness, or `undefined` when the call is allowed.
 */
function decide(toolName: string, args: Record<string, unknown>, agent: Record<string, unknown> = CAPTAIN): string | undefined {
  return captainInvestigationDecision({ toolName, args, workspaceRoot: WORKSPACE, topLevel: sessionIsMpdCaptain(agent), mode: "deny" })
}

/**
 * A `read` of one path by one caller, as the harness would dispatch it.
 *
 * @param path - the path the call names.
 * @param agent - the calling agent double; the `mpd` captain by default.
 * @returns the decision for that call.
 */
function read(path: string, agent: Record<string, unknown> = CAPTAIN): string | undefined {
  return decide("read", { file_path: path }, agent)
}

test("each of the three instruction basenames is readable at ANY depth, inside the workspace", () => {
  for (const name of CAPTAIN_INSTRUCTION_BASENAMES) {
    // The root spelling, its `./` form, a nested one and a DEEP one are all the same band.
    expect(read(name)).toBeUndefined()
    expect(read("./" + name)).toBeUndefined()
    expect(read("packages/x/" + name)).toBeUndefined()
    expect(read("packages/x/src/deeper/" + name)).toBeUndefined()
    // The ABSOLUTE spelling of a nested instruction file is the same band, not a source path.
    expect(read(WORKSPACE + "/packages/x/" + name)).toBeUndefined()
  }
  // The band is non-empty and is exactly the three names the contract lists.
  expect([...CAPTAIN_INSTRUCTION_BASENAMES].sort()).toEqual(["AGENT.md", "AGENTS.md", "CLAUDE.md"])
})

test("a SIBLING project's instruction file is readable — the D14 motivating case", () => {
  // A `..` hop is normally refused; it is ADMITTED here because the basename is the whole test.
  expect(read("../VEdit/AGENTS.md")).toBeUndefined()
  expect(read("../../other-project/CLAUDE.md")).toBeUndefined()
  // An absolute path OUTSIDE the workspace root, which no band prefix or root file covers.
  expect(read("/home/haroldzhao/MyProj/DshProj/VEdit/AGENT.md")).toBeUndefined()
  expect(read("/etc/AGENTS.md")).toBeUndefined()
  // Case is not part of the test (the licence band matches case-insensitively too), and a Windows
  // separator is normalised to POSIX BEFORE the basename test.
  expect(read("packages/x/agents.md")).toBeUndefined()
  expect(read("packages\\x\\AGENTS.md")).toBeUndefined()
  // The PREDICATE agrees with the decision, so this is the band itself and not a decision-only shortcut.
  expect(captainReadablePath(WORKSPACE, "packages/x/AGENTS.md")).toBe(true)
  expect(captainReadablePath(WORKSPACE, "/home/elsewhere/VEdit/AGENT.md")).toBe(true)
})

test("the rest of the band is UNCHANGED — the prefix trees, the root files and the licence band", () => {
  for (const prefix of CAPTAIN_READABLE_PREFIXES) expect(read(prefix + "a.md")).toBeUndefined()
  for (const name of CAPTAIN_READABLE_ROOT_FILES) expect(read(name)).toBeUndefined()
  expect(read("LICENSE.md")).toBeUndefined()
  expect(read("LICENSE-NOTICES.md")).toBeUndefined()
  // The band directory itself stays readable, as before.
  expect(read(".mpd")).toBeUndefined()
})

test("NOTHING ELSE moved: nested overview files, source paths and `..` hops stay refused", () => {
  /** Paths that reach no band, including the ones C4 must NOT have widened. */
  const refused: readonly string[] = [
    // A README/CHANGELOG/LICENSE is admitted at the ROOT only — there is no basename rule for them.
    "packages/x/README.md",
    "packages/x/README.zh-CN.md",
    "packages/x/CHANGELOG.md",
    "packages/x/LICENSE.md",
    // Sources, absolute sources outside the root, and a sibling project's SOURCE tree.
    "packages/x/src/y.ts",
    "src/main.ts",
    WORKSPACE + "/packages/x/src/y.ts",
    "/home/haroldzhao/MyProj/DshProj/VEdit/src/main.ts",
    "../VEdit/src/main.ts",
    // A sibling project's README is not the instruction band either.
    "../VEdit/README.md",
    // No parent hops out of a band, no unrelated absolute file, no empty or bare-dot spelling.
    "docs/../packages/x/src/y.ts",
    "/etc/passwd",
    "",
    ".",
  ]
  for (const path of refused) {
    expect(String(read(path) ?? "")).toContain("captain investigation rule")
  }
})

test("grep and glob judge their `path` argument by the SAME rule (an instruction file, not its directory)", () => {
  expect(String(decide("grep", { pattern: "x", path: "packages/x/src" }) ?? "")).toContain("captain investigation rule")
  expect(decide("grep", { pattern: "x", path: "packages/x/AGENTS.md" })).toBeUndefined()
  // A DIRECTORY outside the root is not the band: only the instruction FILE itself is readable there.
  expect(String(decide("glob", { pattern: "*.md", path: "../VEdit" }) ?? "")).toContain("captain investigation rule")
  expect(decide("glob", { pattern: "*.md", path: "../VEdit/AGENT.md" })).toBeUndefined()
  // A bare pattern with no `path` still FAILS CLOSED — C4 did not touch that arm.
  expect(String(decide("glob", { pattern: "**/*.ts" }) ?? "")).toContain("no path argument")
})

test("the refusal names the TRUE band and promises no `README*` glob (D14's second half)", () => {
  /** The sentence a refused source read carries. */
  const denial = String(read("packages/x/src/y.ts") ?? "")
  // The three instruction basenames, with the sibling-project case stated as the reason they are exempt.
  expect(denial).toContain("AGENT.md")
  expect(denial).toContain("AGENTS.md")
  expect(denial).toContain("CLAUDE.md")
  expect(denial).toContain("sibling")
  // The two README spellings EXACTLY — and no glob shape that does not exist.
  expect(denial).toContain("README.md")
  expect(denial).toContain("README.zh-CN.md")
  expect(denial).toContain("there is no")
  expect(denial).not.toContain("README*.md")
  // The route out and the band sentence survive the correction, because a refusal is read as a tool result.
  expect(denial).toContain("mpd_role_spawn")
  expect(denial).toContain("Explorer")
  expect(denial).toContain("Researcher")
  expect(denial).toContain("documentation band stays open")
})

test("CONTROL: a NON-captain session keeps full reconnaissance — C4 widened the band, not the scope", () => {
  expect(sessionIsMpdCaptain(CAPTAIN)).toBe(true)
  expect(sessionIsMpdCaptain(MEMBER)).toBe(false)
  expect(read("packages/x/src/y.ts", MEMBER)).toBeUndefined()
  expect(decide("grep", { pattern: "x", path: "packages/x/src" }, MEMBER)).toBeUndefined()
  expect(decide("glob", { pattern: "**/*.ts" }, MEMBER)).toBeUndefined()
  // The same call IS refused for the captain, so the arm above is not vacuous.
  expect(String(read("packages/x/src/y.ts") ?? "")).toContain("captain investigation rule")
})
