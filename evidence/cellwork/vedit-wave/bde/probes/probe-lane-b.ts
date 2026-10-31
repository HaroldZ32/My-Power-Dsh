// R2 LANE-B PROBE — the reviewer's OWN check of C1-validation, C9 and C10 (never the lane's tests).
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde/probes/probe-lane-b.ts
// The probe imports the shipped SOURCE modules directly, builds its own temp workspaces under the
// evidence directory (contract §6: never a mpd-gates.json or a cell tree in the checkout root) and
// prints one PASS/FAIL line per checklist item, ending with a machine-readable summary.
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_CELLWORK_CONFIG } from "../../../../../packages/mpd-cellwork-plugin/src/config.ts"
import { submitSplit, validateGraph, latestSplit, readSplit } from "../../../../../packages/mpd-cellwork-plugin/src/split.ts"
import { validateRequirementsText } from "../../../../../packages/mpd-cellwork-plugin/src/requirements.ts"
import type { SplitTaskInput } from "../../../../../packages/mpd-cellwork-plugin/src/split.ts"

/** One checklist result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one checklist verdict.
 * @param id - the checklist id the assertion answers.
 * @param ok - whether it passed.
 * @param detail - the observed value, quoted into the evidence.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** A fresh temp workspace under the OS temp root (contract §6: never a gate file in the checkout). */
function tempWorkspace(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mpd-r2b-" + tag + "-"))
  if (dir === "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh") throw new Error("refusing to use the checkout root as a probe workspace")
  return dir
}

/** The deps one submitSplit call needs, with a certified window so budgets stay honest. */
function depsOf(workspace: string, cellId: string) {
  return {
    workspace,
    cellId,
    config: DEFAULT_CELLWORK_CONFIG,
    roster: ["Senior Engineer", "Reviewer", "Deep Worker", "Lead"],
    window: async () => ({ provider: "probe", model: "probe-model", window: 200000, provenance: "catalog", maxOutputTokens: 8192 }),
    now: new Date("2026-10-31T05:00:00.000Z"),
  }
}

/**
 * One split task with the fields the graph rules require, overridable per case.
 * @param key - the task key.
 * @param over - the fields this case changes.
 * @returns the task input.
 */
function task(key: string, over: Partial<SplitTaskInput> = {}): SplitTaskInput {
  return { key, subject: "subject " + key, description: "description " + key, ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [], independent: true, inputs: [], verify: false, ...over }
}

/** Whether any finding carries one code. */
function hasCode(findings: Array<{ code: string }>, code: string): boolean {
  return findings.some((finding) => finding.code === code)
}

// ---------------------------------------------------------------------------------------------------
// C1-validation: the member field, its findings, and the self-review comparison.
// ---------------------------------------------------------------------------------------------------
{
  const ws = tempWorkspace("c1")
  const verdict = await submitSplit(depsOf(ws, "cell-c1"), {
    revision: 1,
    tasks: [task("A"), task("B", { member: "Seat 1" }), task("C", { member: "Seat 2" })],
  })
  const members = verdict.tasks.map((row) => row.member)
  check("B02/B06", verdict.accepted === true && members[0] === "Senior Engineer" && members[1] === "Seat 1" && members[2] === "Seat 2",
    "accepted=" + verdict.accepted + " resolved members=" + JSON.stringify(members) + " (absent ⇒ ownerRole; several members share one role)")
  rmSync(ws, { recursive: true, force: true })
}

{
  const ws = tempWorkspace("c1-invalid")
  const cases: Array<{ name: string; member: string }> = [
    { name: "empty", member: "" },
    { name: "whitespace-only", member: "   " },
    { name: "too-long-65", member: "m".repeat(65) },
    { name: "control-char", member: "a\u0001b" },
    { name: "slash", member: "a/b" },
    { name: "backslash", member: "a\\b" },
  ]
  for (const testCase of cases) {
    const findings = validateGraph([task("A", { member: testCase.member })], ["Senior Engineer"])
    check("B04/" + testCase.name, hasCode(findings, "member-invalid"), "member-invalid present for " + testCase.name + ": " + JSON.stringify(findings.map((row) => row.code)))
  }
  // The boundary the contract names: 64 characters is still usable.
  const boundary = validateGraph([task("A", { member: "m".repeat(64) })], ["Senior Engineer"])
  check("B04/boundary-64", !hasCode(boundary, "member-invalid"), "64-char member produces findings " + JSON.stringify(boundary.map((row) => row.code)))
  rmSync(ws, { recursive: true, force: true })
}

{
  const conflict = validateGraph(
    [task("A", { member: "Shared Seat", ownerRole: "Senior Engineer" }), task("B", { member: "Shared Seat", ownerRole: "Reviewer" })],
    ["Senior Engineer", "Reviewer"],
  )
  check("B05", hasCode(conflict, "member-role-conflict"), "member-role-conflict for one member under two ownerRoles: " + JSON.stringify(conflict.map((row) => row.code)))
  const legal = validateGraph(
    [task("A", { ownerRole: "Senior Engineer" }), task("B", { member: "Seat 1", ownerRole: "Senior Engineer" }), task("C", { member: "Seat 2", ownerRole: "Senior Engineer" }), task("D", { member: "Seat 1", ownerRole: "Senior Engineer" })],
    ["Senior Engineer"],
  )
  check("B06/legal", !hasCode(legal, "member-role-conflict") && legal.length === 0, "one role, several members AND two tasks sharing one member are legal: " + JSON.stringify(legal.map((row) => row.code)))
  const unknownRole = validateGraph([task("A", { ownerRole: "Nope" }), task("B", { member: "Seat 1", ownerRole: "Senior Engineer" })], ["Senior Engineer"])
  check("B03", hasCode(unknownRole, "unknown-owner-role"), "ownerRole is still validated beside a declared member: " + JSON.stringify(unknownRole.map((row) => row.code)))
}

{
  const ws = tempWorkspace("c1-selfreview")
  const work = (member: string | undefined) => task("T1", { verify: true, ...(member === undefined ? {} : { member }) })
  const review = (member: string | undefined, ownerRole = "Reviewer") => task("T2", { kind: "review", ownerRole, blockedBy: ["T1"], ...(member === undefined ? {} : { member }) })

  const sameMember = validateGraph([work("Alice"), review("Alice")], ["Senior Engineer", "Reviewer"])
  check("B07/same-member", hasCode(sameMember, "self-review"), "same resolved member refuses: " + JSON.stringify(sameMember.map((row) => row.code)))

  const differentMember = validateGraph([work("Alice"), review("Bob")], ["Senior Engineer", "Reviewer"])
  check("B07/different-member", !hasCode(differentMember, "self-review"), "different resolved members allowed: " + JSON.stringify(differentMember.map((row) => row.code)))

  const fallbackSameRole = validateGraph([work(undefined), review(undefined, "Senior Engineer")], ["Senior Engineer", "Reviewer"])
  check("B07/fallback-same-role", hasCode(fallbackSameRole, "self-review"), "no members declared ⇒ ownerRole comparison refuses: " + JSON.stringify(fallbackSameRole.map((row) => row.code)))

  const fallbackDifferentRole = validateGraph([work(undefined), review(undefined, "Reviewer")], ["Senior Engineer", "Reviewer"])
  check("B07/fallback-different-role", !hasCode(fallbackDifferentRole, "self-review"), "no members declared, different roles allowed: " + JSON.stringify(fallbackDifferentRole.map((row) => row.code)))
  rmSync(ws, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------------------------------
// C9: a refused submission always leaves its findings; an accepted verdict is never overwritten.
// ---------------------------------------------------------------------------------------------------
{
  const ws = tempWorkspace("c9")
  const cellId = "cell-c9"
  const refused = await submitSplit(depsOf(ws, cellId), { revision: 1, tasks: [task("A", { subject: "  " })] })
  const refusedPath = join(ws, ".mpd/cellwork", cellId, "split", "1.refused.json")
  const refusedDoc = existsSync(refusedPath) ? JSON.parse(readFileSync(refusedPath, "utf8")) as { accepted?: boolean; findings?: unknown[]; file?: string } : undefined
  check("B08", refused.accepted === false && refusedDoc !== undefined && refusedDoc.accepted === false && Array.isArray(refusedDoc.findings) && (refusedDoc.findings?.length ?? 0) === refused.findings.length,
    "refused artifact exists=" + existsSync(refusedPath) + " accepted=" + String(refusedDoc?.accepted) + " findings=" + String(refusedDoc?.findings?.length) + " (verdict findings=" + refused.findings.length + ")")

  const accepted = await submitSplit(depsOf(ws, cellId), { revision: 1, tasks: [task("A")] })
  const acceptedPath = join(ws, ".mpd/cellwork", cellId, "split", "1.json")
  const acceptedBytes = existsSync(acceptedPath) ? readFileSync(acceptedPath, "utf8") : ""
  check("B09/coexist", accepted.accepted === true && acceptedBytes !== "" && existsSync(refusedPath),
    "accepted=" + accepted.accepted + " canonical exists=" + existsSync(acceptedPath) + " refused artifact still exists=" + existsSync(refusedPath))

  await submitSplit(depsOf(ws, cellId), { revision: 1, tasks: [task("A", { subject: " " })] })
  const afterBytes = existsSync(acceptedPath) ? readFileSync(acceptedPath, "utf8") : ""
  check("B09/never-overwritten", afterBytes === acceptedBytes && afterBytes !== "",
    "canonical byte-identical after a later refusal=" + String(afterBytes === acceptedBytes) + " bytes=" + String(afterBytes.length))

  const latest = latestSplit(ws, cellId)
  check("B09/latest", latest !== null && latest.read.ok === true && latest.read.verdict.accepted === true,
    "latestSplit returns the ACCEPTED record (accepted=" + String(latest?.read.ok === true ? latest.read.verdict.accepted : "unreadable") + ")")
  rmSync(ws, { recursive: true, force: true })
}

// B10 (the journal row) is a flow.ts append the pure module cannot reach; it is verified by inspection of
// the `split-refused` append site and recorded in the evidence document, never claimed as probed here.

// ---------------------------------------------------------------------------------------------------
// C10: a ### subheading belongs to its parent section; a whitespace-only body is still empty.
// ---------------------------------------------------------------------------------------------------
{
  const withSubheading = [
    "# Requirements", "",
    "## Goal", "Ship the wave.", "",
    "## Non-goals", "Nothing else.", "",
    "## Users / consumers", "The operators.", "",
    "## Constraints", "### Assumptions", "- the route is certified", "",
    "## Acceptance criteria", "Gates are green.", "",
    "## Open questions", "None.", "",
  ].join("\n")
  const ok = validateRequirementsText(withSubheading)
  check("B11", ok.ok === true, "a ### subheading inside Constraints finalizes: ok=" + ok.ok + " missing=" + JSON.stringify(ok.missing))

  const whitespaceOnly = withSubheading.replace("## Constraints\n### Assumptions\n- the route is certified", "## Constraints\n   \n\t")
  const refused = validateRequirementsText(whitespaceOnly)
  check("B12", refused.ok === false && refused.missing.includes("Constraints"),
    "whitespace-only Constraints still refused: ok=" + refused.ok + " missing=" + JSON.stringify(refused.missing))
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
