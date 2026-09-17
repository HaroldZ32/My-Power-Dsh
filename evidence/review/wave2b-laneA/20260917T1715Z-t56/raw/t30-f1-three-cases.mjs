// t56 — t30's F1 reproduced BY ME with three cases, plus the arm case run in its REVERT state.
// The defect: `renderStatus` appends `unresolvedDependencyNote` to EVERY task line, so an over-claiming
// note tells a captain that a DISPATCHABLE task has an unresolved dependency.
// T depends on B; B <-> C form a cycle. Cases differ only in the members' STATUS.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const REPO = "/root/dshProj/my-power-dsh"
const LIB = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
const shipped = await import(join(LIB, "state.js"))
const T = (id, status, dependencies = []) => ({ id, subject: id, status, assignee: "Architect", dependencies, attempt: 0, createdAt: 1, updatedAt: 1 })
const CASES = {
  pending: [T("T", "pending", ["B"]), T("B", "pending", ["C"]), T("C", "pending", ["B"])],
  failed: [T("T", "pending", ["B"]), T("B", "failed", ["C"]), T("C", "failed", ["B"])],
  completed: [T("T", "pending", ["B"]), T("B", "completed", ["C"]), T("C", "completed", ["B"])],
}
const read = (mod) => Object.fromEntries(Object.entries(CASES).map(([name, tasks]) => {
  const t = tasks[0]
  return [name, { note: mod.unresolvedDependencyNote(t, tasks), blocking: mod.dependencyStates(tasks, t.dependencies).blocking, claimable: mod.unsatisfiedDependencies(tasks, t.dependencies).length === 0 }]
}))
const shippedReading = read(shipped)
// REVERT state: a scratch copy of lib/ with the F1 condition removed from unresolvedDependencyNote.
const root = mkdtempSync(join(tmpdir(), "t56-f1-"))
cpSync(LIB, join(root, "lib"), { recursive: true })
symlinkSync(join(REPO, "packages", "mpd-agent-teams-plugin", "_deps"), join(root, "_deps"), "dir")
const stateFile = join(root, "lib", "state.js")
const text = readFileSync(stateFile, "utf8")
const anchor = "if (cycle.length > 0 && dependencyStates(tasks, dependencies).blocking.length > 0)"
if (text.split(anchor).length - 1 !== 1) throw new Error("revert anchor not unique")
writeFileSync(stateFile, text.replace(anchor, "if (cycle.length > 0)"))
const reverted = await import(stateFile)
const revertedReading = read(reverted)
const checks = {
  "pending: the cycle IS named and blocking=['B']": shippedReading.pending.note.includes("cycle B") && JSON.stringify(shippedReading.pending.blocking) === '["B"]' && shippedReading.pending.claimable === false,
  "failed: the note is NOT emitted and T is claimable": shippedReading.failed.note === "" && shippedReading.failed.claimable === true,
  "completed: the note is NOT emitted": shippedReading.completed.note === "",
  "REVERT state REDDENS on both non-blocking cases": revertedReading.failed.note !== "" && revertedReading.completed.note !== "" && revertedReading.pending.note !== "",
}
console.log(JSON.stringify({ shippedReading, revertedReading, checks, verdict: Object.values(checks).every(Boolean) ? "PASS — the three cases hold and the condition is load-bearing" : "FAIL" }, null, 2))
rmSync(root, { recursive: true, force: true })
