// T9 SWEEP PROBE 2 — the two user-requested items, D17's maxDepth parity, C1's activate half and
// C6/C7's dispatch decisions, driven against the shipped source with fakes (no harness).
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/sweep/probes/probe-user-dispatch-d17.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captainReadablePath } from "../../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"
import { spawnMaxDepthOf as roleSpawnMaxDepthOf } from "../../../../../packages/mpd-roles-plugin/src/index.ts"
import { spawnMaxDepthOf as workmateSpawnMaxDepthOf } from "../../../../../packages/mpd-workmate-plugin/src/index.ts"
import { cellworkGuardDecision, plannerReadablePath } from "../../../../../packages/mpd-cellwork-plugin/src/guard.ts"
import {
  applyReassignments,
  dispatchOwnerOnly,
  fenceReasonOf,
  reassignPairs,
} from "../../../../../packages/mpd-cellwork-plugin/src/dispatch.ts"
import { buildContractDoc, resolvedMemberName } from "../../../../../packages/mpd-cellwork-plugin/src/activate.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../../../../../packages/mpd-cellwork-plugin/src/config.ts"
import { cellDir, CELL_JOURNAL_FILE } from "../../../../../packages/mpd-cellwork-plugin/src/state.ts"

/** One checklist result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one sweep verdict.
 * @param id - the checklist id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** A fresh temp workspace under the OS temp root (R9). */
function tempWorkspace(tag: string): string {
  return mkdtempSync(join(tmpdir(), "mpd-sweep2-" + tag + "-"))
}

// ===================================================================================================
// The two user-requested items (T9 §3).
// ===================================================================================================
{
  const ROOT = "/ws"
  const sibling = captainReadablePath(ROOT, "../VEdit/AGENT.md")
  const siblingAbsolute = captainReadablePath(ROOT, "/home/haroldzhao/MyProj/DshProj/VEdit/CLAUDE.md")
  const siblingSrc = captainReadablePath(ROOT, "../VEdit/src/main.rs")
  const siblingSrcAbsolute = captainReadablePath(ROOT, "/home/haroldzhao/MyProj/DshProj/VEdit/src/main.rs")
  const ownDocs = captainReadablePath(ROOT, "docs/cellwork.md")
  const ownSrc = captainReadablePath(ROOT, "packages/mpd-cellwork-plugin/src/mail.ts")
  check("USER-a/captain-sibling", sibling && siblingAbsolute && !siblingSrc && !siblingSrcAbsolute && ownDocs && !ownSrc,
    JSON.stringify({ sibling, siblingAbsolute, siblingSrc, siblingSrcAbsolute, ownDocs, ownSrc }))

  /** The planner seat the cell record carries. */
  const plannerSeat = { cellId: "cell-1", name: "cell-planner", mode: "member" as const }
  const sourceRead = cellworkGuardDecision(plannerSeat, "read", { args: { file_path: "packages/mpd-cellwork-plugin/src/mail.ts" }, workspaceRoot: ROOT })
  const sourceGrep = cellworkGuardDecision(plannerSeat, "grep", { args: { path: "src" }, workspaceRoot: ROOT })
  const docsRead = cellworkGuardDecision(plannerSeat, "read", { args: { file_path: "docs/cellwork.md" }, workspaceRoot: ROOT })
  const bandRead = plannerReadablePath(ROOT, ".mpd/plans/cellwork-vedit-wave.md") && plannerReadablePath(ROOT, "evidence/x.json")
  const teaching = typeof sourceRead === "string"
    && sourceRead.includes("DELEGATED") && sourceRead.includes("cellwork_recon") && sourceRead.includes("mpd_role_spawn")
    && sourceRead.includes("Explorer") && sourceRead.includes("Researcher") && sourceRead.includes("AGENT.md")
  check("USER-b/planner-guard", typeof sourceRead === "string" && typeof sourceGrep === "string" && docsRead === undefined && bandRead && teaching,
    JSON.stringify({ sourceRead: typeof sourceRead, sourceGrep: typeof sourceGrep, docsRead, bandRead, teaching, refusalHead: String(sourceRead ?? "").slice(0, 160) }))
}

// ===================================================================================================
// D17 — `mpd_workmate_spawn` forwards maxDepth = caller depth + 1, parity-pinned against roles.
// ===================================================================================================
{
  const headers: Array<Record<string, unknown>> = [
    {}, { delegationDepth: 0 }, { delegationDepth: 1 }, { delegationDepth: 2 },
    { origin: "subagent" }, { origin: "subagent", delegationDepth: 1 },
    { delegationDepth: "3" }, { delegationDepth: -2 }, { delegationDepth: 1.9 },
  ]
  const rows = headers.map((header) => ({ header, workmate: workmateSpawnMaxDepthOf({ session: { header } }), roles: roleSpawnMaxDepthOf({ session: { header } }) }))
  const divergent = rows.filter((row) => row.workmate !== row.roles)
  const expected = [1, 1, 2, 3, 2, 2, 4, 1, 2]
  check("D17/parity", divergent.length === 0 && rows.every((row, index) => row.workmate === expected[index]),
    JSON.stringify({ divergent: divergent.length, rows: rows.map((row) => [JSON.stringify(row.header), row.workmate, row.roles]) }))
}

// ===================================================================================================
// C1 (activate half) — one member per distinct `member`; the contract names role AND member.
// ===================================================================================================
{
  const memberName = resolvedMemberName({ key: "T1", member: "Seat 1", ownerRole: "Senior Engineer" } as any)
  const roleName = resolvedMemberName({ key: "T2", ownerRole: "Senior Engineer" } as any)
  const doc = buildContractDoc(
    { cell: { cellId: "cell-1" } as any, config: DEFAULT_CELLWORK_CONFIG, split: { revision: 2, submittedAt: "2026-10-31T06:00:00.000Z" } as any },
    { key: "T1", subject: "work", description: "do it", ownerRole: "Senior Engineer", member: "Seat 1", writeScopes: ["a"] } as any,
    { key: "R1", ownerRole: "Reviewer" } as any,
    "T1",
  )
  check("C1/activate-half", memberName === "Seat 1" && roleName === "Senior Engineer" && doc.includes("**Senior Engineer**") && doc.includes("member `Seat 1`") && doc.includes("Verifier: **Reviewer**"),
    JSON.stringify({ memberName, roleName, ownerLine: doc.split("\n").find((line) => line.startsWith("Owner:")) }))
}

// ===================================================================================================
// C6/C7 — the fence predicate, the reassign parser, and the two passes with fakes.
// ===================================================================================================
{
  check("C7/fence-predicate",
    typeof fenceReasonOf({ mode: "checkpoint" }) === "string"
      && typeof fenceReasonOf({ handoffReady: true }) === "string"
      && typeof fenceReasonOf({ fenced: true, fencedReason: "barrier gave up" }) === "string"
      && fenceReasonOf({ mode: "member" }) === undefined,
    JSON.stringify({ checkpoint: fenceReasonOf({ mode: "checkpoint" }), handoff: fenceReasonOf({ handoffReady: true }), flag: fenceReasonOf({ fenced: true, fencedReason: "barrier gave up" }), free: fenceReasonOf({ mode: "member" }) }))

  const parsed = reassignPairs([{ task_id: "T1", owner: "Member B" }, { task_id: "T1", owner: "Member B" }, { task_id: "", owner: "X" }, "nope"])
  const parsedInvalidArray = reassignPairs("T1")
  check("C6/reassign-parser",
    parsed.pairs.length === 1 && parsed.invalid.length === 3 && parsedInvalidArray.pairs.length === 0 && parsedInvalidArray.invalid.length === 1,
    JSON.stringify({ pairs: parsed.pairs.length, invalid: parsed.invalid.length, nonArray: parsedInvalidArray.invalid }))

  const ws = tempWorkspace("dispatch")
  const now = new Date("2026-10-31T06:00:00.000Z")
  const cell = { cellId: "cell-1", members: { "Member A": { name: "Member A", mode: "checkpoint", handoffReady: true }, "Member B": { name: "Member B", mode: "member" } } } as any
  const record = {
    teamId: "team-1",
    members: [
      { name: "Member A", role: "Senior Engineer", status: "running", executorRef: "h-a", mode: "checkpoint", handoffReady: true },
      { name: "Member B", role: "Senior Engineer", status: "running", executorRef: "h-b", mode: "member" },
    ],
    tasks: [
      { id: "T1", subject: "one", owner: "Member A", status: "pending", kind: "work", description: "d" },
      { id: "T2", subject: "two", owner: "Member B", status: "pending", kind: "work", description: "d" },
      { id: "T3", subject: "three", owner: "Member B", status: "pending", kind: "work", description: "d" },
    ],
  }
  const delivered: Array<{ handle: string; content: string }> = []
  const report = await dispatchOwnerOnly({ workspace: ws, cell, record, now, send: async (handle, content) => { delivered.push({ handle, content }) } })
  const t1 = report.skipped.find((row) => row.taskId === "T1")
  const busy = report.skipped.find((row) => row.taskId === "T3")
  check("C6/C7/dispatch-pass",
    delivered.length === 1 && delivered[0].handle === "h-b"
      && t1 !== undefined && t1.reason.includes("FENCED") && t1.reason.includes("reassign")
      && busy !== undefined && busy.reason.includes("already paired") && report.pairs.length === 1 && report.pairs[0].taskId === "T2",
    JSON.stringify({ delivered: delivered.map((row) => row.handle), pairs: report.pairs.map((row) => row.taskId), fencedSkip: t1?.reason.slice(0, 150), busySkip: busy?.reason.slice(0, 120), skipped: report.skipped.length }))

  // REASSIGN: claim -> journal -> deliver, and every failure reported rather than thrown.
  const claimed: Array<[string, string]> = []
  const sent: Array<[string, string]> = []
  const outcomes = await applyReassignments({
    workspace: ws, cell, record, pairs: [{ taskId: "T1", owner: "Member B" }], now,
    claim: async (taskId, owner) => { claimed.push([taskId, owner]); return { ok: true } },
    send: async (handle, content) => { sent.push([handle, content]) },
  })
  const journalPath = join(cellDir(ws, "cell-1"), CELL_JOURNAL_FILE)
  const journal = existsSync(journalPath) ? readFileSync(journalPath, "utf8") : ""
  // A FENCED target is refused with the reason, and nothing is claimed for it.
  const fencedTarget = await applyReassignments({
    workspace: ws, cell, record, pairs: [{ taskId: "T1", owner: "Member A" }], now,
    claim: async () => ({ ok: true }), send: async () => undefined,
  })
  const refusedClaim = await applyReassignments({
    workspace: ws, cell, record, pairs: [{ taskId: "T2", owner: "Member B" }], now,
    claim: async () => ({ ok: false, error: "board refused it" }), send: async () => undefined,
  })
  check("C6/reassign", outcomes.length === 1 && outcomes[0].claimed === true && outcomes[0].delivered === true
    && JSON.stringify(claimed) === '[["T1","Member B"]]' && sent.length === 1 && sent[0][0] === "h-b"
    && journal.includes("task-reassigned") && journal.includes("\"to\":\"Member B\"")
    && fencedTarget[0].claimed === false && String(fencedTarget[0].reason).includes("FENCED")
    && refusedClaim[0].claimed === false && String(refusedClaim[0].reason).includes("board refused"),
    JSON.stringify({ outcome: outcomes[0], claimed, sent: sent.map((row) => row[0]), journalHasReassigned: journal.includes("task-reassigned"), fencedTarget: fencedTarget[0], refusedClaim: refusedClaim[0] }))
  rmSync(ws, { recursive: true, force: true })
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
