// T27 PROBE — the first wave's four guarantees (spot-check) plus the CR#2 / CR#4 / CR#5(T28) closures,
// and the user-authority rows recorded in gates/user-asks.log, re-derived on the final tree.
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/sweep2/probe-regressions.ts
// Scratch workspaces live under mktemp (R9); only this probe's LOG lands under evidence/.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captainInvestigationDecision, captainReadablePath } from "../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"
import { cellworkGuardDecision } from "../../../../packages/mpd-cellwork-plugin/src/guard.ts"
import { applyReassignments, dispatchOwnerOnly } from "../../../../packages/mpd-cellwork-plugin/src/dispatch.ts"
import { appendCellMail, deliverCellMail } from "../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import { roleKey, validateGraph } from "../../../../packages/mpd-cellwork-plugin/src/split.ts"

/** One result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one verdict.
 * @param id - the item id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** A fresh temp workspace under the OS temp root. */
function ws0(tag: string): string {
  return mkdtempSync(join(tmpdir(), "mpd-sweep2-" + tag + "-"))
}

/** One dispatch task view. */
function task(id: string, owner: string): any {
  return { id, subject: "subject " + id, owner, status: "pending", kind: "work", description: "d" }
}

/** One roster member view. */
function member(name: string, status: string, handle: string): any {
  return { name, role: "Senior Engineer", status, executorRef: handle, mode: "member" }
}

/** One split task input for validateGraph. */
function splitTask(key: string, over: Record<string, unknown> = {}): any {
  return { key, subject: "s " + key, description: "d " + key, ownerRole: "Senior Engineer", writeScopes: [], blockedBy: [], independent: true, inputs: [], verify: false, ...over }
}

// ===================================================================================================
// 1) The first wave's user-authority rows (replicates gates/user-asks.log on the final predicates).
// ===================================================================================================
{
  const ROOT = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
  const SIB = "/home/haroldzhao/MyProj/DshProj/VEdit"
  const rows: Array<[string, boolean]> = [
    [SIB + "/AGENT.md", true],
    [SIB + "/docs/x.md", false],
    ["../VEdit/AGENTS.md", true],
    ["./AGENTS.md", true],
    ["packages/mpd-roles-plugin/src/index.ts", false],
    [SIB + "/src/main.rs", false],
    ["docs/../packages/x/src/y.ts", false],
  ]
  const captain = rows.map(([path, expected]) => ({ path, expected, actual: captainReadablePath(ROOT, path) }))
  const plannerSeat = { cellId: "cell-1", name: "cell-planner", mode: "member" as const }
  const plannerRows: Array<[string, boolean]> = [
    [SIB + "/CLAUDE.md", true],
    ["packages/mpd-cellwork-plugin/src/activate.ts", false],
    ["docs/cellwork.md", true],
    [".mpd/plans/cellwork-vedit-wave.md", true],
  ]
  const planner = plannerRows.map(([path, expected]) => ({ path, expected, actual: cellworkGuardDecision(plannerSeat, "read", { args: { file_path: path }, workspaceRoot: ROOT }) === undefined }))
  const plannerRefusal = cellworkGuardDecision(plannerSeat, "read", { args: { file_path: "packages/mpd-cellwork-plugin/src/activate.ts" }, workspaceRoot: ROOT })
  const memberAllows = cellworkGuardDecision({ cellId: "cell-1", name: "Alice", mode: "member" }, "read", { args: { file_path: "packages/x/src/y.ts" }, workspaceRoot: ROOT })
  const captainDecision = captainInvestigationDecision({ toolName: "read", args: { file_path: SIB + "/AGENT.md" }, workspaceRoot: ROOT, topLevel: true, mode: "deny" })
  check("regression/user-asks",
    captain.every((row) => row.actual === row.expected)
      && planner.every((row) => row.actual === row.expected)
      && typeof plannerRefusal === "string" && plannerRefusal.includes("DELEGATED")
      && memberAllows === undefined && captainDecision === undefined,
    JSON.stringify({ captain, planner, plannerTeaches: typeof plannerRefusal === "string" && plannerRefusal.includes("DELEGATED"), memberSeatSourceAllowed: memberAllows === undefined }))
}

// ===================================================================================================
// 2) A fenced member is still never messaged; a healthy pair still delivers once.
// ===================================================================================================
{
  const ws = ws0("fence")
  const cell = { cellId: "cell-1", members: { "Member A": { name: "Member A", mode: "member", handoffReady: true }, "Member B": { name: "Member B", mode: "member" } } } as any
  const record = { teamId: "t1", members: [member("Member A", "running", "h-a"), member("Member B", "running", "h-b")], tasks: [task("T1", "Member A"), task("T2", "Member B")] }
  const delivered: string[] = []
  const report = await dispatchOwnerOnly({ workspace: ws, cell, record, now: new Date("2026-10-31T07:00:00.000Z"), send: async (handle: string) => { delivered.push(handle) } })
  const fenced = report.skipped.find((row: any) => row.taskId === "T1")
  check("regression/fenced-never-messaged",
    delivered.length === 1 && delivered[0] === "h-b" && fenced !== undefined && String(fenced.reason).includes("FENCED") && String(fenced.reason).includes("reassign"),
    JSON.stringify({ delivered, fencedSkip: fenced?.reason.slice(0, 150), pairs: report.pairs.map((row: any) => row.taskId) }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// 3) Mail is still durable-first (send row -> wake attempt -> wake record; a failed send wakes nothing).
// ===================================================================================================
{
  const ws = ws0("mail")
  const cellId = "cell-1"
  const order: string[] = []
  const ok = await deliverCellMail({
    appendSend: () => { order.push("send"); return appendCellMail(ws, cellId, { t: "send", id: "m1", cellId, from: "captain", to: "cell-planner", subject: "s", body: "b", at: "2026-10-31T07:00:00.000Z", wakeSent: false }) },
    attemptWake: async () => { order.push("attempt"); return { sent: true } },
    appendWake: (outcome) => { order.push("record"); return appendCellMail(ws, cellId, { t: "wake", id: "m1", sent: outcome.sent, at: "2026-10-31T07:00:00.000Z" }) },
  })
  const failedOrder: string[] = []
  const failed = await deliverCellMail({ appendSend: () => { failedOrder.push("send"); return false }, attemptWake: async () => { failedOrder.push("attempt"); return { sent: true } }, appendWake: () => { failedOrder.push("record"); return true } })
  check("regression/mail-durable-first",
    ok.landed === true && ok.wakeSent === true && JSON.stringify(order) === '["send","attempt","record"]'
      && failed.landed === false && JSON.stringify(failedOrder) === '["send"]',
    JSON.stringify({ order, failedOrder, okWakeSent: ok.wakeSent, failedLanded: failed.landed }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// 4) CR#2 — the reassign path applies the SAME status rule as the dispatch pass.
// ===================================================================================================
{
  const ws = ws0("cr2")
  const cell = { cellId: "cell-1", members: { "Member A": { name: "Member A", mode: "member" }, "Member B": { name: "Member B", mode: "member" }, "Member C": { name: "Member C", mode: "member" } } } as any
  const record = { teamId: "t1", members: [member("Member A", "running", "h-a"), member("Member B", "failed", "h-b"), member("Member C", "provisioning", "h-c")], tasks: [task("T1", "Member A")] }
  const claimed: string[] = []
  const sent: string[] = []
  const base = { workspace: ws, cell, record, now: new Date("2026-10-31T07:00:00.000Z"), claim: async (id: string, owner: string) => { claimed.push(id + ":" + owner); return { ok: true } }, send: async (handle: string) => { sent.push(handle) } }
  const toFailed = await applyReassignments({ ...base, pairs: [{ taskId: "T1", owner: "Member B" }] })
  const toProvisioning = await applyReassignments({ ...base, pairs: [{ taskId: "T1", owner: "Member C" }] })
  const toHealthy = await applyReassignments({ ...base, pairs: [{ taskId: "T1", owner: "Member A" }] })
  check("CR2/reassign-status",
    toFailed[0].claimed === false && /FAILED/i.test(String(toFailed[0].reason))
      && toProvisioning[0].claimed === false && /being raised|provisioning/i.test(String(toProvisioning[0].reason))
      && toHealthy[0].claimed === true && toHealthy[0].delivered === true && JSON.stringify(claimed) === '["T1:Member A"]' && JSON.stringify(sent) === '["h-a"]',
    JSON.stringify({ failed: toFailed[0], provisioning: toProvisioning[0], healthy: toHealthy[0], claimed, sent }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// 5) CR#4 — an EMPTY (or whitespace) cell handle falls through to the live roster handle.
// ===================================================================================================
{
  const ws = ws0("cr4")
  const cell = { cellId: "cell-1", members: { "Member A": { name: "Member A", mode: "member", executorRef: "   " } } } as any
  const record = { teamId: "t1", members: [member("Member A", "running", "h-live")], tasks: [task("T1", "Member A")] }
  const delivered: string[] = []
  const report = await dispatchOwnerOnly({ workspace: ws, cell, record, now: new Date("2026-10-31T07:00:00.000Z"), send: async (handle: string) => { delivered.push(handle) }, handleFor: () => "   " })
  const claimed: string[] = []
  const reassigned = await applyReassignments({ workspace: ws, cell, record, now: new Date("2026-10-31T07:00:00.000Z"), pairs: [{ taskId: "T1", owner: "Member A" }], claim: async (id: string) => { claimed.push(id); return { ok: true } }, send: async (handle: string) => { delivered.push(handle) }, handleFor: () => "" })
  check("CR4/empty-handle-fallthrough",
    report.pairs.length === 1 && report.pairs[0].handle === "h-live" && JSON.stringify(delivered) === '["h-live","h-live"]' && reassigned[0].delivered === true,
    JSON.stringify({ dispatchHandle: report.pairs.map((row: any) => row.handle), delivered, reassigned: reassigned[0], claimed }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// 6) CR#5 + T28 — member identity is the SAME key validation and activation use, unicode-aware.
// ===================================================================================================
{
  const work = (memberName: string) => splitTask("T1", { verify: true, member: memberName })
  const review = (memberName: string, role = "Senior Engineer") => splitTask("T2", { kind: "review", ownerRole: role, blockedBy: ["T1"], member: memberName })
  const codes = (findings: Array<{ code: string }>) => findings.map((finding) => finding.code)

  const sameRole = validateGraph([work("Seat A"), review("seat-a")], ["Senior Engineer"])
  const diffRole = validateGraph([work("Seat A"), review("seat-a", "Reviewer")], ["Senior Engineer", "Reviewer"])
  const punctuation = validateGraph([splitTask("T1", { member: "---" })], ["Senior Engineer"])
  const chinese = validateGraph([splitTask("T1", { member: "工程师甲" }), splitTask("T2", { member: "工程师乙" })], ["Senior Engineer"])
  const chineseReview = validateGraph([work("工程师甲"), review("工程师甲")], ["Senior Engineer"])
  const sameSpelling = validateGraph([splitTask("T1", { member: "Seat A" }), splitTask("T2", { member: "Seat A" })], ["Senior Engineer"])
  check("CR5/identity-key",
    codes(sameRole).includes("self-review")
      && codes(diffRole).includes("member-role-conflict") && codes(diffRole).includes("self-review")
      && codes(punctuation).includes("member-invalid")
      && !codes(chinese).includes("member-invalid") && !codes(chinese).includes("member-role-conflict")
      && codes(chineseReview).includes("self-review")
      && !codes(sameSpelling).includes("member-role-conflict")
      && roleKey("工程师甲") !== "" && roleKey("工程师甲") !== roleKey("工程师乙") && roleKey("Seat A") === roleKey("seat-a"),
    JSON.stringify({ sameRole: codes(sameRole), diffRole: codes(diffRole), punctuation: codes(punctuation), chinese: codes(chinese), chineseReview: codes(chineseReview), sameSpelling: codes(sameSpelling), keys: { jia: roleKey("工程师甲"), yi: roleKey("工程师乙"), seatA: roleKey("Seat A") } }))
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
