// R2 LANE-E PROBE — the reviewer's OWN check of C4 and C5 (never the lane's tests).
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde/probes/probe-lane-e.ts
// The predicates are pure, so this probe needs no harness and no temp workspace; it imports the shipped
// modules directly and drives its own path table.
import {
  CAPTAIN_INSTRUCTION_BASENAMES,
  CAPTAIN_READABLE_PREFIXES,
  CAPTAIN_READABLE_ROOT_FILES,
  ROOT_LICENSE_PATTERN,
  captainInvestigationDecision,
  captainReadablePath,
} from "../../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"
import { spawnMaxDepthOf } from "../../../../../packages/mpd-roles-plugin/src/index.ts"
import {
  PLANNER_INSTRUCTION_BASENAMES,
  PLANNER_LICENSE_PATTERN,
  PLANNER_READABLE_PREFIXES,
  PLANNER_READABLE_ROOT_FILES,
  cellworkGuardDecision,
  plannerReadablePath,
  PLANNER_RECON_TOOLS,
} from "../../../../../packages/mpd-cellwork-plugin/src/guard.ts"
import { plannerPrompt } from "../../../../../packages/mpd-cellwork-plugin/src/staging.ts"
import { PLANNER_RECON_LINES } from "../../../../../packages/mpd-cellwork-plugin/src/prompts.ts"

/** One checklist result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one checklist verdict.
 * @param id - the checklist id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** The workspace root every path case below judges against. */
const ROOT = "/ws"

/** One decision-input helper: the captain, one tool, one path argument. */
function captainOn(tool: string, path: string | undefined, topLevel = true, mode: "deny" | "allow" = "deny"): string | undefined {
  const args = path === undefined ? {} : tool === "read" ? { file_path: path } : { path }
  return captainInvestigationDecision({ toolName: tool, args, workspaceRoot: ROOT, topLevel, mode })
}

/** One decision-input helper: the cell planner. */
function plannerOn(tool: string, path: string | undefined, workspaceRoot = ROOT): string | undefined {
  const args = path === undefined ? {} : tool === "read" ? { file_path: path } : { path }
  return cellworkGuardDecision({ cellId: "cell-1", name: "cell-planner", mode: "member" }, tool, { args, workspaceRoot })
}

// ---------------------------------------------------------------------------------------------------
// C4: the captain's band — instruction files anywhere (inside AND outside the root), the rest unchanged.
// ---------------------------------------------------------------------------------------------------
{
  const allowed = [
    "AGENTS.md", "AGENT.md", "CLAUDE.md", "./AGENTS.md",
    "packages/x/AGENTS.md", "packages/x/src/CLAUDE.md",
    "../VEdit/AGENT.md", "/home/someone/VEdit/AGENTS.md",
    ROOT + "/packages/x/AGENTS.md",
    "docs/a.md", "evidence/x/y.json", "agent-references/glossary.md", ".mpd/plans/p.md", ".mpd",
    "README.md", "README.zh-CN.md", "CHANGELOG.md", "LICENSE.md", "LICENSE-NOTICES.md",
    ROOT + "/docs/a.md",
  ]
  const refused = [
    "packages/x/src/index.ts", "src/a.ts", "..", "../VEdit/src/x.ts", "/home/elsewhere/proj/src/a.ts",
    "docs/../packages/x/src/a.ts", "packages/x/README.md", "packages/x/README.zh-CN.md",
    "packages/x/LICENSE.md", ROOT + "/src/a.ts", "/ws2/docs/a.md", "",
  ]
  const badAllowed = allowed.filter((path) => !captainReadablePath(ROOT, path))
  const badRefused = refused.filter((path) => captainReadablePath(ROOT, path))
  check("E01", badAllowed.length === 0, "instruction files at any depth/outside root and the documented band are readable; unexpected refusals=" + JSON.stringify(badAllowed))
  check("E02", badRefused.length === 0, "source paths, non-instruction `..` spellings, nested non-instruction files and empty paths stay refused; unexpected admissions=" + JSON.stringify(badRefused))

  const decided = {
    sourceRead: captainOn("read", "packages/x/src/index.ts"),
    sourceGlob: captainOn("glob", "src"),
    sourceGrep: captainOn("grep", "src"),
    siblingRead: captainOn("read", "../VEdit/AGENT.md"),
    docRead: captainOn("read", "docs/a.md"),
    noPath: captainOn("read", undefined),
    memberSession: captainOn("read", "packages/x/src/index.ts", false),
    allowMode: captainOn("read", "packages/x/src/index.ts", true, "allow"),
    writeTool: captainOn("write", "packages/x/src/index.ts"),
  }
  check("E02/decision", typeof decided.sourceRead === "string" && typeof decided.sourceGlob === "string" && typeof decided.sourceGrep === "string" && typeof decided.noPath === "string",
    "read/grep/glob on a source path — and a bare call — are refused: " + JSON.stringify({ read: typeof decided.sourceRead, glob: typeof decided.sourceGlob, grep: typeof decided.sourceGrep, bare: typeof decided.noPath }))
  check("E02/scope", decided.siblingRead === undefined && decided.docRead === undefined && decided.memberSession === undefined && decided.allowMode === undefined && decided.writeTool === undefined,
    "sibling instruction file and docs pass; a child session, `allow` mode and a non-reconnaissance tool pass: " + JSON.stringify({ sibling: decided.siblingRead, doc: decided.docRead, child: decided.memberSession, allow: decided.allowMode, write: decided.writeTool }))

  const text = String(decided.sourceRead ?? "")
  const advertised: Array<[string, boolean]> = [
    ["AGENT.md", text.includes("`AGENT.md`")],
    ["AGENTS.md", text.includes("`AGENTS.md`")],
    ["CLAUDE.md", text.includes("`CLAUDE.md`")],
    ["README.md", text.includes("`README.md`")],
    ["README.zh-CN.md", text.includes("`README.zh-CN.md`")],
    ["CHANGELOG.md", text.includes("`CHANGELOG.md`")],
    ["LICENSE*.md", text.includes("`LICENSE*.md`")],
    ["no README* glob", text.includes("no `README*` glob")],
    ["delegation routes", text.includes("mpd_role_spawn") && text.includes("Explorer") && text.includes("Researcher")],
    ["mpd.jsonc opt-out", text.includes("captain.investigation")],
  ]
  check("E03", advertised.every(([, present]) => present), "refusal text advertises the true band and the routes: " + JSON.stringify(advertised))
}

// ---------------------------------------------------------------------------------------------------
// C5-a: the explicit maxDepth mpd_role_spawn forwards.
// ---------------------------------------------------------------------------------------------------
{
  const cases: Array<[string, unknown, number]> = [
    ["no header at all", {}, 1],
    ["top-level depth 0", { delegationDepth: 0 }, 1],
    ["nested depth 1", { delegationDepth: 1 }, 2],
    ["nested depth 3", { delegationDepth: 3 }, 4],
    ["origin subagent, no depth", { origin: "subagent" }, 2],
    ["origin subagent, depth 2", { origin: "subagent", delegationDepth: 2 }, 3],
    ["negative depth", { delegationDepth: -1 }, 1],
    ["numeric string depth", { delegationDepth: "2" }, 3],
    ["fractional depth 1.9", { delegationDepth: 1.9 }, 2],
  ]
  const bad = cases.filter(([, header, expected]) => spawnMaxDepthOf({ session: { header } }) !== expected)
  check("E04", bad.length === 0, "maxDepth = recorded caller depth + 1; top-level stays 1: " + JSON.stringify(cases.map(([name, header, expected]) => [name, spawnMaxDepthOf({ session: { header } }), expected]) .concat(bad.map(([name]) => [name, "MISMATCH"]))))
}

// ---------------------------------------------------------------------------------------------------
// C5-b: the cell planner's delegation arm.
// ---------------------------------------------------------------------------------------------------
{
  const allowed = ["docs/a.md", ".mpd/plans/p.md", "evidence/x.json", "agent-references/g.md", "packages/x/AGENTS.md", "../VEdit/AGENT.md", "/vault/other/CLAUDE.md", "README.md", "LICENSE-NOTICES.md", "CHANGELOG.md", ROOT + "/docs/a.md"]
  const refused = ["packages/x/src/index.ts", "src/a.ts", "../VEdit/src/x.ts", "packages/x/README.md", "docs/../src/a.ts", ROOT + "/src/a.ts", ""]
  const badAllowed = allowed.filter((path) => plannerOn("read", path) !== undefined)
  const badRefused = refused.filter((path) => plannerOn("read", path) === undefined)
  check("E05", badAllowed.length === 0 && badRefused.length === 0,
    "planner band: unexpected refusals=" + JSON.stringify(badAllowed) + " unexpected admissions=" + JSON.stringify(badRefused))

  const bare = plannerOn("read", undefined)
  const nonPlanner = cellworkGuardDecision({ cellId: "cell-1", name: "Alice", mode: "member" }, "read", { args: { file_path: "packages/x/src/index.ts" }, workspaceRoot: ROOT })
  const bash = plannerOn("bash", "packages/x/src/index.ts")
  const caseName = cellworkGuardDecision({ cellId: "cell-1", name: " Cell-Planner ", mode: "member" }, "read", { args: { file_path: "src/a.ts" }, workspaceRoot: ROOT })
  const noRoot = plannerReadablePath("", "docs/a.md") && !plannerReadablePath("", "/abs/docs/a.md")
  check("E05/decisions", typeof bare === "string" && nonPlanner === undefined && bash === undefined && typeof caseName === "string" && noRoot && PLANNER_RECON_TOOLS.join(",") === "read,grep,glob",
    "bare call refused, other members untouched, only read/grep/glob intercepted, the name is trimmed+lower-cased, an unresolved root fails closed: " + JSON.stringify({ bare: typeof bare, nonPlanner, bash, caseName: typeof caseName, noRoot }))

  const text = String(plannerOn("read", "src/a.ts") ?? "")
  const teaches: Array<[string, boolean]> = [
    ["cellwork_recon", text.includes("cellwork_recon")],
    ["Explorer", text.includes("Explorer")],
    ["Researcher", text.includes("Researcher")],
    ["mpd_role_spawn", text.includes("mpd_role_spawn")],
    ["read-only roster role", text.includes("read-only roster role")],
    ["why (context)", text.includes("context")],
    ["the band it may read", text.includes("`.mpd/**`") && text.includes("`AGENT.md`")],
  ]
  check("E06", teaches.every(([, present]) => present), "the planner refusal teaches BOTH routes and says why: " + JSON.stringify(teaches))
}

// ---------------------------------------------------------------------------------------------------
// C5-c: the planner prompt carries the delegation block (lane E exports it; lane C spreads it).
// ---------------------------------------------------------------------------------------------------
{
  const prompt = plannerPrompt({ cell: { cellId: "cell-1", objective: "probe objective" }, personaFor: () => null } as any)
  const missing = PLANNER_RECON_LINES.filter((line) => !prompt.includes(line))
  check("E07", missing.length === 0 && prompt.includes("RECONNAISSANCE IS DELEGATED, NEVER RUN BY YOU") && prompt.includes("cellwork_recon") && prompt.includes("mpd_role_spawn"),
    "plannerPrompt carries every PLANNER_RECON_LINES line (" + PLANNER_RECON_LINES.length + "): missing=" + JSON.stringify(missing))
}

// ---------------------------------------------------------------------------------------------------
// C5-d: the two band lists are ONE contract — literals AND semantics.
// ---------------------------------------------------------------------------------------------------
{
  const sameLiterals =
    JSON.stringify(CAPTAIN_READABLE_PREFIXES) === JSON.stringify(PLANNER_READABLE_PREFIXES)
    && JSON.stringify(CAPTAIN_READABLE_ROOT_FILES) === JSON.stringify(PLANNER_READABLE_ROOT_FILES)
    && JSON.stringify(CAPTAIN_INSTRUCTION_BASENAMES) === JSON.stringify(PLANNER_INSTRUCTION_BASENAMES)
    && ROOT_LICENSE_PATTERN.source === PLANNER_LICENSE_PATTERN.source
    && ROOT_LICENSE_PATTERN.flags === PLANNER_LICENSE_PATTERN.flags
  const table: Array<[string, boolean]> = [
    ["docs/a.md", true], ["docs", true], [".mpd", true], [".mpd/x.md", true],
    ["packages/x/AGENTS.md", true], ["../VEdit/AGENT.md", true], ["/home/x/VEdit/AGENTS.md", true],
    [ROOT + "/packages/x/CLAUDE.md", true],
    ["README.md", true], ["README.zh-CN.md", true], ["CHANGELOG.md", true], ["LICENSE.md", true], ["LICENSE-NOTICES.md", true],
    ["packages/x/README.md", false], ["src/a.ts", false], ["../VEdit/src/a.ts", false],
    ["docs/../src/a.ts", false], ["", false], ["/elsewhere/src/a.ts", false], [ROOT + "/src/a.ts", false],
  ]
  const divergent = table.filter(([path, expected]) => captainReadablePath(ROOT, path) !== expected || plannerReadablePath(ROOT, path) !== expected)
  check("E08", sameLiterals && divergent.length === 0,
    "the two bands agree with each other AND with the contract on a " + table.length + "-path table; literal equality=" + String(sameLiterals) + " divergent=" + JSON.stringify(divergent.map(([path]) => path)))
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
