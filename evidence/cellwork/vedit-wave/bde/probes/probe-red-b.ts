// R2 RED ARM — executes the PRE-CHANGE modules (git show HEAD:…) to prove the new lane-B assertions
// would have failed before the fix. Read-only git (`show`) is the only git command used.
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde/probes/probe-red-b.ts
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import { DEFAULT_CELLWORK_CONFIG } from "../../../../../packages/mpd-cellwork-plugin/src/config.ts"

// R9: the scratch copy lives under mktemp — only this probe's LOG lands under evidence/.
/** The mktemp root holding the pre-change copies and their one-hop shims. */
const SCRATCH = mkdtempSync(join(tmpdir(), "mpd-r2-red-b-"))
/** The materialised pre-change tree (removed at the end of the run). */
const OLD = join(SCRATCH, "old")
/** The temp workspaces are created beside the scratch tree, never in the checkout. */
const EVIDENCE = SCRATCH
/** One checklist result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one RED-arm verdict (ok=true means "the pre-change code really lacked the fixed behaviour").
 * @param id - the checklist id whose RED arm this is.
 * @param ok - whether the pre-change code exhibits the defect.
 * @param detail - the observed behaviour.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "RED-CONFIRMED" : "NOT-RED") + " " + id + " — " + detail)
}

rmSync(OLD, { recursive: true, force: true })
mkdirSync(OLD, { recursive: true })
/** The repository root's cellwork sources, spelled RELATIVE to the mktemp scratch tree. */
const ROOT_REL = ((): string => {
  const rel = relative(OLD, join(process.cwd(), "packages/mpd-cellwork-plugin/src")).replace(/\\/g, "/")
  return rel.startsWith(".") ? rel : "./" + rel
})()
writeFileSync(join(OLD, "split.ts"), execSync("git show HEAD:packages/mpd-cellwork-plugin/src/split.ts", { encoding: "utf8" }))
writeFileSync(join(OLD, "requirements.ts"), execSync("git show HEAD:packages/mpd-cellwork-plugin/src/requirements.ts", { encoding: "utf8" }))
// The pre-change copies import `./state` and `./budget`; these shims re-export the CURRENT helpers, which
// are unchanged by this lane, so the only difference exercised is the pre-change logic under test.
writeFileSync(join(OLD, "state.ts"), "export { atomicWriteText, refusedSplitPath, splitPath, CELL_SPLIT_DIR, cellDir, requirementsPath } from \"" + ROOT_REL + "/state.ts\"\n")
writeFileSync(join(OLD, "budget.ts"), "export { applyBudget, estimateTask, measureInput } from \"" + ROOT_REL + "/budget.ts\"\n")

const oldSplit: any = await import(join(OLD, "split.ts"))
const oldRequirements: any = await import(join(OLD, "requirements.ts"))

/** One split task with the fields the graph rules require, overridable per case. */
function task(key: string, over: Record<string, unknown> = {}): any {
  return { key, subject: "subject " + key, description: "description " + key, ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [], independent: true, inputs: [], verify: false, ...over }
}
/** The deps one submitSplit call needs, with a certified window. */
function depsOf(workspace: string, cellId: string): any {
  return {
    workspace, cellId, config: DEFAULT_CELLWORK_CONFIG,
    roster: ["Senior Engineer", "Reviewer"],
    window: async () => ({ provider: "probe", model: "probe-model", window: 200000, provenance: "catalog", maxOutputTokens: 8192 }),
    now: new Date("2026-10-31T05:00:00.000Z"),
  }
}

// C9 RED: the pre-change code writes a refusal to the CANONICAL per-revision path, so a later accepted
// resubmission overwrites the breakdown — the refused split leaves no artifact of its own.
{
  const ws = mkdtempSync(join(EVIDENCE, "ws-red-c9-"))
  const cellId = "cell-red"
  await oldSplit.submitSplit(depsOf(ws, cellId), { revision: 1, tasks: [task("A", { subject: "  " })] })
  const canonical = join(ws, ".mpd/cellwork", cellId, "split", "1.json")
  const refused = join(ws, ".mpd/cellwork", cellId, "split", "1.refused.json")
  const firstCanonical = existsSync(canonical) ? JSON.parse(readFileSync(canonical, "utf8")) as { accepted?: boolean } : undefined
  await oldSplit.submitSplit(depsOf(ws, cellId), { revision: 1, tasks: [task("A")] })
  const secondCanonical = existsSync(canonical) ? JSON.parse(readFileSync(canonical, "utf8")) as { accepted?: boolean } : undefined
  check("B08/B09", existsSync(canonical) && firstCanonical?.accepted === false && !existsSync(refused) && secondCanonical?.accepted === true,
    "pre-change: refusal landed at 1.json (accepted=" + String(firstCanonical?.accepted) + "), no 1.refused.json existed=" + String(!existsSync(refused)) + ", the accepted resubmission overwrote it (accepted=" + String(secondCanonical?.accepted) + ")")
  rmSync(ws, { recursive: true, force: true })
}

// C10 RED: the pre-change parser ends a section at ANY later heading, so `###` truncates its parent.
{
  const doc = [
    "# Requirements", "",
    "## Goal", "Ship the wave.", "",
    "## Non-goals", "Nothing else.", "",
    "## Users / consumers", "The operators.", "",
    "## Constraints", "### Assumptions", "- the route is certified", "",
    "## Acceptance criteria", "Gates are green.", "",
    "## Open questions", "None.", "",
  ].join("\n")
  const verdict = oldRequirements.validateRequirementsText(doc)
  check("B11", verdict.ok === false && verdict.missing.includes("Constraints"),
    "pre-change: a ### subheading inside Constraints was refused as empty (ok=" + String(verdict.ok) + ", missing=" + JSON.stringify(verdict.missing) + ")")
}

// C1 RED: the pre-change graph ignores a declared member entirely.
{
  const invalid = oldSplit.validateGraph([task("A", { member: "a/b" })], ["Senior Engineer"])
  const sameMember = oldSplit.validateGraph(
    [task("T1", { verify: true, member: "Alice" }), task("T2", { kind: "review", ownerRole: "Reviewer", member: "Alice", blockedBy: ["T1"] })],
    ["Senior Engineer", "Reviewer"],
  )
  const withMember = await (async () => {
    const ws = mkdtempSync(join(EVIDENCE, "ws-red-c1-"))
    const verdict = await oldSplit.submitSplit(depsOf(ws, "cell-red-c1"), { revision: 1, tasks: [task("A", { member: "Seat 9" })] })
    rmSync(ws, { recursive: true, force: true })
    return verdict
  })()
  check("B04/B07", !invalid.some((row: any) => row.code === "member-invalid") && !sameMember.some((row: any) => row.code === "self-review") && withMember.tasks[0]?.member === undefined,
    "pre-change: no member-invalid for a path separator, no self-review for one shared member, and the verdict row carries NO resolved member at all (member=" + JSON.stringify(withMember.tasks[0]?.member) + ")")
}

rmSync(SCRATCH, { recursive: true, force: true })
const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, redConfirmed: results.length - failed.length, notRed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
