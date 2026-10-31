// T26 PROBE 1 — CR#14 (program+argv header), CR#13 (spawn-error cause), CR#11 (control chars in the
// header) and CR#12 (per-loop mpd-gates.json freeze), driven through the shipped tool definitions.
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde2/probe-verify-cr.ts
// Scratch workspaces live under mktemp (R9); only this probe's LOG lands under evidence/.
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { registerVerifyTools } from "../../../../packages/mpd-verify-plugin/src/tools.ts"
import { createVerifyRuntime } from "../../../../packages/mpd-verify-plugin/src/observe.ts"
import { armDelegateLoop } from "../../../../packages/mpd-verify-plugin/src/observe.ts"

/** One review result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one review verdict.
 * @param id - the review item id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** A fresh temp workspace under the OS temp root (R9). */
function ws0(tag: string): string {
  return mkdtempSync(join(tmpdir(), "mpd-t26v-" + tag + "-"))
}

/** Write one mpd-gates.json. */
function writeGates(ws: string, value: unknown): void {
  writeFileSync(join(ws, "mpd-gates.json"), JSON.stringify(value, null, 2) + "\n")
}

/** The sha256 of a text, for the evidence metadata comparison. */
function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** Count the evidence rows in one workspace. */
function evidenceCount(ws: string): number {
  const dir = join(ws, ".mpd/verify/evidence")
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).length : 0
}

/** Build the captured tool registry and its deps for one workspace. */
function harness(ws: string) {
  const registered: any[] = []
  const fakeDsh = { registerTools: (defs: any[]) => { registered.push(...defs); return () => undefined } }
  const runtime = createVerifyRuntime({ dsh: { workspaceRoot: () => ws }, warn: () => undefined, configValue: () => undefined, defaultEscapeUses: 3, loopTtlMs: 86_400_000 })
  const deps: any = { runtime, configValue: (key: string) => key === "verify.gateTimeoutMs" ? 5000 : undefined, dsh: { workspaceRoot: () => ws, teamMembership: () => undefined }, log: () => undefined }
  registerVerifyTools(fakeDsh as any, deps)
  return {
    open: registered.find((def) => def.name === "mpd_verify_open"),
    evidence: registered.find((def) => def.name === "mpd_verify_evidence"),
    record: registered.find((def) => def.name === "mpd_verify_record"),
    exec: { agent: { session: { id: "session-T26" } } },
    execVerifier: { agent: { session: { id: "session-VER" } } },
  }
}

/** Read a loop file by id. */
function loopPath(ws: string, loopId: string): string {
  return join(ws, ".mpd/verify/loops", loopId + ".json")
}

/** Read an evidence row by id. */
function evidencePath(ws: string, evidenceId: string): string {
  return join(ws, ".mpd/verify/evidence", evidenceId + ".json")
}

// ===================================================================================================
// CR#14 — the header names the PROGRAM and the ARGV that ran; `cmd` is a separate label.
// ===================================================================================================
{
  const ws = ws0("cr14")
  writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
  writeGates(ws, { version: 1, gates: { tests: { cmd: "bun test packages", argv: ["true"] } } })
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const run = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  const logText = run.refused === undefined && typeof run.logPath === "string" ? readFileSync(join(ws, run.logPath), "utf8") : ""
  const header = logText.split("\n")[0]
  const meta = run.evidenceId !== undefined ? JSON.parse(readFileSync(evidencePath(ws, run.evidenceId), "utf8")) as any : undefined
  check("CR14/program-argv-header",
    run.refused === undefined && run.exit === 0 && run.cmd === "bun test packages" && run.gateFreeze === "frozen"
      && header === '# gate tests cmd: "bun test packages" program: "true" argv: []'
      && logText.split("\n").length === 2
      && meta?.cmd === "bun test packages" && meta?.gateFreeze === "frozen" && meta?.logSha256 === sha(logText),
    JSON.stringify({ exit: run.exit, cmdLabel: run.cmd, gateFreeze: run.gateFreeze, header, logLines: logText.split("\n").length, metaCmd: meta?.cmd, metaGateFreeze: meta?.gateFreeze, metaLogHashMatches: meta?.logSha256 === sha(logText), labelClaimedBun: header.includes('program: "bun') }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// CR#13 — a missing program leaves the SPAWN ERROR in the log (and therefore in the tail).
// ===================================================================================================
{
  const ws = ws0("cr13")
  writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
  writeGates(ws, { version: 1, gates: { tests: { argv: ["definitely-no-such-program-t26-xyz"] } } })
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const run = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  const logText = run.refused === undefined && typeof run.logPath === "string" ? readFileSync(join(ws, run.logPath), "utf8") : ""
  const meta = run.evidenceId !== undefined ? JSON.parse(readFileSync(evidencePath(ws, run.evidenceId), "utf8")) as any : undefined
  check("CR13/spawn-error-cause",
    run.refused === undefined && run.exit === -1
      && logText.split("\n")[0].startsWith("# gate tests cmd: ")
      && logText.includes("[spawn-error]") && /not found|ENOENT/i.test(logText)
      && String(run.tail ?? "").includes("[spawn-error]") && /not found|ENOENT/i.test(String(run.tail ?? ""))
      && meta?.exit === -1,
    JSON.stringify({ exit: run.exit, logHasSpawnError: logText.includes("[spawn-error]"), logHasENOENT: logText.includes("ENOENT"), tailHasCause: String(run.tail ?? "").includes("[spawn-error]"), metaExit: meta?.exit, cause: String(run.tail ?? "").split("\n").filter((line: string) => line.includes("[spawn-error]")).join(" | ").slice(0, 220) }))
  rmSync(ws, { recursive: true, force: true })
}

// ===================================================================================================
// CR#11 — control characters in `cmd` or an `argv` element cannot forge a log line. The landed design
// ESCAPES them in the header instead of refusing the entry (the captain's final criterion); the probe
// asserts the line-count/forgery guarantee AND records explicitly that the file was accepted.
// ===================================================================================================
{
  /** Run one accepted-file arm and return the observed log facts. */
  const arm = async (tag: string, gates: unknown): Promise<{ accepted: boolean; lines: number; forged: boolean; rawControl: boolean; header: string }> => {
    const ws = ws0(tag)
    writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
    writeGates(ws, gates)
    const h = harness(ws)
    const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
    const run = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
    const logText = run.refused === undefined && typeof run.logPath === "string" ? readFileSync(join(ws, run.logPath), "utf8") : ""
    const lines = logText.split("\n")
    const header = lines[0] ?? ""
    const forged = lines.slice(1).some((line: string) => line.startsWith("FORGED-"))
    const rawControl = /[\u007f-\u009f\u2028\u2029]/.test(header)
    rmSync(ws, { recursive: true, force: true })
    return { accepted: run.refused === undefined, lines: lines.length, forged, rawControl, header }
  }
  const cmdNewline = await arm("cr11a", { version: 1, gates: { tests: { cmd: "bun test\nFORGED-CMD", argv: ["node", "-e", "process.stdout.write('OK')"] } } })
  const argvNewline = await arm("cr11b", { version: 1, gates: { tests: { argv: ["node", "-e", "process.stdout.write('OK')", "\nFORGED-ARGV"] } } })
  const separator = await arm("cr11c", { version: 1, gates: { tests: { cmd: "bun test\u2028FORGED-SEP\u007f", argv: ["node", "-e", "process.stdout.write('OK')"] } } })
  check("CR11/control-chars-one-line",
    cmdNewline.accepted && cmdNewline.lines === 2 && !cmdNewline.forged && !cmdNewline.rawControl && cmdNewline.header.includes("\\n")
      && argvNewline.accepted && argvNewline.lines === 2 && !argvNewline.forged && !argvNewline.rawControl && argvNewline.header.includes("\\n")
      && separator.accepted && separator.lines === 2 && !separator.forged && !separator.rawControl && separator.header.includes("\\u2028") && separator.header.includes("\\u007f"),
    JSON.stringify({ cmdNewline, argvNewline, separator, note: "landed design ESCAPES control chars in the header; the entry is accepted, not refused (task-row wording said refuse)" }))
}

// ===================================================================================================
// CR#12 — the per-loop freeze of the workspace `mpd-gates.json`.
// ===================================================================================================
{
  const ws = ws0("cr12")
  writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
  writeGates(ws, { version: 1, gates: { tests: { argv: ["node", "-e", "process.stdout.write('A')"] } } })
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const loopStored = loop.loopId !== undefined ? JSON.parse(readFileSync(loopPath(ws, loop.loopId), "utf8")) as any : undefined
  const before = evidenceCount(ws)
  const unchanged = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  check("CR12/d-unchanged", unchanged.refused === undefined && unchanged.exit === 0 && unchanged.gateFreeze === "frozen" && evidenceCount(ws) === before + 1 && loopStored?.gateFile?.state === "present",
    JSON.stringify({ refused: unchanged.refused, exit: unchanged.exit, gateFreeze: unchanged.gateFreeze, loopGateFile: loopStored?.gateFile, evidenceRows: evidenceCount(ws) - before }))

  writeGates(ws, { version: 1, gates: { tests: { argv: ["true"] } } })
  const countBeforeChanged = evidenceCount(ws)
  const changed = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  check("CR12/a-changed", typeof changed.refused === "string" && changed.refused.includes("gate-freeze") && changed.refused.includes("changed after loop") && changed.refused.includes(String(loop.loopId)) && evidenceCount(ws) === countBeforeChanged,
    JSON.stringify({ refused: String(changed.refused).slice(0, 240), evidenceRows: evidenceCount(ws) - countBeforeChanged }))

  rmSync(join(ws, "mpd-gates.json"))
  const countBeforeDeleted = evidenceCount(ws)
  const deleted = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  check("CR12/b-deleted", typeof deleted.refused === "string" && deleted.refused.includes("gate-freeze") && deleted.refused.includes("absent") && evidenceCount(ws) === countBeforeDeleted,
    JSON.stringify({ refused: String(deleted.refused).slice(0, 240), evidenceRows: evidenceCount(ws) - countBeforeDeleted }))
  rmSync(ws, { recursive: true, force: true })
}
{
  // (c) APPEARED: a loop opened with NO project file freezes `absent`; a file that appears later refuses.
  const ws = ws0("cr12c")
  writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const loopStored = JSON.parse(readFileSync(loopPath(ws, loop.loopId), "utf8")) as any
  writeGates(ws, { version: 1, gates: { tests: { argv: ["true"] } } })
  const countBefore = evidenceCount(ws)
  const appeared = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  check("CR12/c-appeared", loopStored.gateFile?.state === "absent" && typeof appeared.refused === "string" && appeared.refused.includes("gate-freeze") && evidenceCount(ws) === countBefore,
    JSON.stringify({ frozen: loopStored.gateFile, refused: String(appeared.refused).slice(0, 240), evidenceRows: evidenceCount(ws) - countBefore }))
  rmSync(ws, { recursive: true, force: true })
}
{
  // (e) LEGACY TOOL LOOP (no gateFile): refuses with the distinct reason; other verify paths still work.
  const ws = ws0("cr12e")
  writeFileSync(join(ws, "AGENTS.md"), "# frozen contract for the probe\n")
  writeGates(ws, { version: 1, gates: { tests: { argv: ["true"] } } })
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const stored = JSON.parse(readFileSync(loopPath(ws, loop.loopId), "utf8")) as any
  delete stored.gateFile
  writeFileSync(loopPath(ws, loop.loopId), JSON.stringify(stored, null, 2) + "\n")
  const countBefore = evidenceCount(ws)
  const refusedGate = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loop.loopId }, h.exec)
  const afterRefusal = evidenceCount(ws)
  const probe = await h.evidence.execute({ kind: "probe", paths: ["AGENTS.md"], loop_id: loop.loopId }, h.exec)
  const record = await h.record.execute({ loop_id: loop.loopId, verdict: "FAIL", findings: [{ id: "F1", severity: "blocker", symptom: "probe", expected: "probe", doc_source: "AGENTS.md" }], basis_kind: "blind" }, h.execVerifier)
  check("CR12/e-unfrozen",
    typeof refusedGate.refused === "string" && refusedGate.refused.includes("carries NO frozen") && refusedGate.refused.includes("open a NEW loop") && afterRefusal === countBefore
      && probe.refused === undefined && probe.evidenceId !== undefined
      && record.refused === undefined && record.recordId !== undefined,
    JSON.stringify({ refused: String(refusedGate.refused).slice(0, 240), evidenceRowsAfterRefusal: afterRefusal - countBefore, probeWorks: probe.refused === undefined, recordWorks: record.refused === undefined }))
  rmSync(ws, { recursive: true, force: true })
}
{
  // OBSERVER PATH: freezes at arm time; an editing afterwards refuses; a legacy observer loop ADOPTS on re-arm.
  const ws = ws0("cr12obs")
  writeGates(ws, { version: 1, gates: { tests: { argv: ["true"] } } })
  const loopId = armDelegateLoop(ws, "session-OBS", "mpd_role_spawn", 86_400_000)
  const armed = loopId === undefined ? undefined : JSON.parse(readFileSync(loopPath(ws, loopId), "utf8")) as any
  const h = harness(ws)
  const run = loopId === undefined ? { refused: "no loop" } : await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loopId }, h.exec)
  writeGates(ws, { version: 1, gates: { tests: { argv: ["false"] } } })
  const refusedAfterEdit = loopId === undefined ? { refused: "no loop" } : await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: loopId }, h.exec)
  // Legacy observer loop: strip the freeze, then re-arm; the SAME id is reused and the freeze adopted.
  const legacy = JSON.parse(readFileSync(loopPath(ws, loopId as string), "utf8")) as any
  delete legacy.gateFile
  writeFileSync(loopPath(ws, loopId as string), JSON.stringify(legacy, null, 2) + "\n")
  const reArmedId = armDelegateLoop(ws, "session-OBS", "mpd_role_spawn", 86_400_000)
  const afterReArm = JSON.parse(readFileSync(loopPath(ws, reArmedId as string), "utf8")) as any
  const runAfterReArm = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: reArmedId }, h.exec)
  check("CR12/observer",
    loopId !== undefined && armed?.gateFile?.state === "present" && run.refused === undefined && run.gateFreeze === "frozen"
      && typeof refusedAfterEdit.refused === "string" && refusedAfterEdit.refused.includes("gate-freeze")
      && reArmedId === loopId && afterReArm.gateFile?.state === "present" && runAfterReArm.refused === undefined && runAfterReArm.gateFreeze === "frozen",
    JSON.stringify({ loopId, armedGateFile: armed?.gateFile, firstRun: run.refused === undefined ? run.gateFreeze : run.refused, afterEdit: String(refusedAfterEdit.refused).slice(0, 160), reArmedId, adoptedFreeze: afterReArm.gateFile, afterReArmRun: runAfterReArm.refused === undefined ? runAfterReArm.gateFreeze : runAfterReArm.refused }))
  rmSync(ws, { recursive: true, force: true })
}
{
  // THE DECLARED BOUND: evidence bound to NO known loop is `unfrozen` and can never be cited for a real loop.
  const ws = ws0("cr12bound")
  writeFileSync(join(ws, "AGENTS.md"), "# contract\n")
  writeGates(ws, { version: 1, gates: { tests: { argv: ["true"] } } })
  const h = harness(ws)
  const loop = await h.open.execute({ writer: "delegate", writer_id: "session-T26", contract: "AGENTS.md" }, h.exec)
  const unbound = await h.evidence.execute({ kind: "gate", gate: "tests", loop_id: "waveloop-probe-slug" }, h.exec)
  const unboundRow = unbound.evidenceId !== undefined ? JSON.parse(readFileSync(evidencePath(ws, unbound.evidenceId), "utf8")) as any : undefined
  const cite = unbound.evidenceId === undefined ? { refused: "no evidence" } : await h.record.execute({ loop_id: loop.loopId, verdict: "PASS", sources: ["AGENTS.md"], evidence_ids: [unbound.evidenceId], basis_kind: "blind" }, h.execVerifier)
  check("CR12/unbound-bound",
    unbound.refused === undefined && unbound.gateFreeze === "unfrozen" && unboundRow?.gateFreeze === "unfrozen" && unboundRow?.loopId === "waveloop-probe-slug"
      && cite.refused?.reason === "forged-evidence",
    JSON.stringify({ unboundRun: unbound.refused === undefined ? unbound.gateFreeze : unbound.refused, evidenceRow: { loopId: unboundRow?.loopId, gateFreeze: unboundRow?.gateFreeze }, citableForRealLoop: cite.refused === undefined ? "CITABLE (would be a Blocker)" : cite.refused.reason }))
  rmSync(ws, { recursive: true, force: true })
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
