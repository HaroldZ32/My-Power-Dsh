// R2 LANE-D PROBE — the reviewer's OWN check of C2-server and C3 (never the lane's tests).
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde/probes/probe-lane-d.ts
// It drives the SHIPPED tool definitions through registerVerifyTools with a captured registry and a
// throwaway workspace under the evidence directory (contract §6: mpd-gates.json never at this repo root).
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadProjectGates, resolveGate, runGate, GATE_TABLE } from "../../../../../packages/mpd-verify-plugin/src/gates.ts"
import { registerVerifyTools } from "../../../../../packages/mpd-verify-plugin/src/tools.ts"
import { createVerifyRuntime } from "../../../../../packages/mpd-verify-plugin/src/observe.ts"

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

/** A fresh temp workspace under the OS temp root (contract §6: never a gate file in the checkout). */
function tempWorkspace(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mpd-r2d-" + tag + "-"))
  if (dir === "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh") throw new Error("refusing to use the checkout root as a probe workspace")
  return dir
}

/** Write one mpd-gates.json at a temp workspace root. */
function writeGates(ws: string, value: unknown): void {
  writeFileSync(join(ws, "mpd-gates.json"), JSON.stringify(value, null, 2) + "\n")
}

/** A mutable gate timeout the tool's config reader sees, so the timeout arm is driven cheaply. */
let gateTimeoutMs = 5000

// ---------------------------------------------------------------------------------------------------
// C3: the project gate file — resolution, refusal, spawn shape, evidence header.
// ---------------------------------------------------------------------------------------------------
{
  const ws = tempWorkspace("c3")
  // ABSENT FILE: today's frozen table, unchanged.
  const absent = resolveGate(ws, "tests")
  check("D08", absent.ok === true && absent.spec.runner === "bun" && absent.spec.cmd === "bun test packages",
    "absent file resolves the frozen entry: " + JSON.stringify(absent.ok === true ? { runner: absent.spec.runner, cmd: absent.spec.cmd } : absent))

  // A VALID project file overriding `tests` and adding `audit`.
  writeGates(ws, {
    version: 1,
    gates: {
      tests: { argv: ["node", "-e", "process.stdout.write('RAN:' + process.cwd() + ':' + process.argv.slice(1).join('|'))", "$((1+1)) && echo SHELL"] },
      audit: { cmd: "project audit label", argv: ["node", "-e", "process.stdout.write('AUDIT')"] },
    },
  })
  const overridden = resolveGate(ws, "tests")
  check("D09/D15/override", overridden.ok === true && overridden.spec.runner === "argv" && overridden.spec.id === "tests" && overridden.spec.cmd === "node -e process.stdout.write('RAN:' + process.cwd() + ':' + process.argv.slice(1).join('|')) $((1+1)) && echo SHELL",
    "project entry overrides the frozen id and cmd defaults to argv.join(' '): " + JSON.stringify(overridden.ok === true ? overridden.spec : overridden))

  const added = resolveGate(ws, "audit")
  check("D09/added", added.ok === true && added.spec.cmd === "project audit label",
    "project entry ADDS a new id and keeps an explicit cmd: " + JSON.stringify(added.ok === true ? { id: added.spec.id, cmd: added.spec.cmd } : added))

  const frozenStillThere = resolveGate(ws, "docs")
  check("D15/fallback", frozenStillThere.ok === true && frozenStillThere.spec.id === "docs" && frozenStillThere.spec.runner === "bun",
    "an id the project does not declare still resolves the frozen entry: " + JSON.stringify(frozenStillThere.ok === true ? frozenStillThere.spec : frozenStillThere))

  // RUN: cwd = workspace, shell:false (the metacharacter arrives VERBATIM as one argument), header names cmd.
  const spec = overridden.ok === true ? overridden.spec : undefined
  const ran = spec === undefined ? undefined : runGate(ws, spec, 5000)
  const expectedCwd = realpathSync(ws)
  check("D16/cwd", ran !== undefined && ran.output.includes("RAN:" + expectedCwd + ":"),
    "the child's cwd is the workspace: " + JSON.stringify(ran?.output.slice(0, 160)))
  check("D16/shell-false", ran !== undefined && ran.output.includes(":$((1+1)) && echo SHELL"),
    "the shell metacharacter arrives as ONE verbatim argv element (no shell): " + JSON.stringify(ran?.output.slice(0, 200)))
  check("D16/exit", ran !== undefined && ran.exit === 0, "exit code observed: " + String(ran?.exit))
  check("D17/header", ran !== undefined && ran.log.startsWith("# gate tests cmd: " + spec?.cmd + "\n"),
    "the log's ONE header line names the EFFECTIVE cmd: " + JSON.stringify(ran?.log.split("\n")[0]))

  // The TOOL path: the same file through mpd_verify_evidence, and the evidence metadata names the cmd.
  const registered: any[] = []
  const fakeDsh = { registerTools: (defs: any[]) => { registered.push(...defs); return () => undefined } }
  const runtime = createVerifyRuntime({ dsh: { workspaceRoot: () => ws }, warn: () => undefined, configValue: () => undefined, defaultEscapeUses: 3, loopTtlMs: 86_400_000 })
  const deps: any = { runtime, configValue: (key: string) => key === "verify.gateTimeoutMs" ? gateTimeoutMs : undefined, dsh: { workspaceRoot: () => ws, teamMembership: () => undefined }, log: () => undefined }
  registerVerifyTools(fakeDsh as any, deps)
  const evidenceDef = registered.find((def) => def.name === "mpd_verify_evidence")
  const evidenceResult = await evidenceDef.execute({ kind: "gate", gate: "tests", loop_id: "loop-probe" }, { agent: { session: { id: "session-T" } } })
  check("D15/tool-override", evidenceResult.refused === undefined && evidenceResult.exit === 0 && evidenceResult.cmd === spec?.cmd,
    "the tool ran the PROJECT entry through the project file: " + JSON.stringify({ exit: evidenceResult.exit, cmd: evidenceResult.cmd, refused: evidenceResult.refused }))
  const logOnDisk = typeof evidenceResult.logPath === "string" ? join(ws, evidenceResult.logPath) : ""
  const logText = logOnDisk !== "" && existsSync(logOnDisk) ? readFileSync(logOnDisk, "utf8") : ""
  check("D17/tool-header", logText.startsWith("# gate tests cmd: " + spec?.cmd + "\n"),
    "the evidence log on disk names the effective cmd: " + JSON.stringify(logText.split("\n")[0]))
  const metaPath = join(ws, ".mpd/verify/evidence", String(evidenceResult.evidenceId) + ".json")
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) as { cmd?: string; exit?: number; loopId?: string } : undefined
  check("D15/meta", meta?.cmd === spec?.cmd && meta.exit === 0 && meta.loopId === "loop-probe",
    "evidence metadata names the effective cmd and the loop: " + JSON.stringify(meta))

  // MALFORMED FILES: each refuses the CALL, names the file and the problem, and produces NO fallback run.
  const malformed: Array<{ id: string; value: unknown; problem: RegExp }> = [
    { id: "version-2", value: { version: 2, gates: { tests: { argv: ["node", "-e", "0"] } } }, problem: /version must be 1/ },
    { id: "unknown-top-key", value: { version: 1, gates: {}, extra: 1 }, problem: /unknown top-level key/ },
    { id: "unknown-entry-key", value: { version: 1, gates: { tests: { argv: ["node"], note: "x" } } }, problem: /unknown key/ },
    { id: "argv-not-array", value: { version: 1, gates: { tests: { argv: "node -e 0" } } }, problem: /needs `argv` to be an array/ },
    { id: "argv-empty", value: { version: 1, gates: { tests: { argv: [] } } }, problem: /argv` must carry 1/ },
    { id: "argv-number", value: { version: 1, gates: { tests: { argv: ["node", 7] } } }, problem: /non-empty string/ },
    { id: "argv-too-long", value: { version: 1, gates: { tests: { argv: ["node", "x".repeat(4097)] } } }, problem: /characters long, and the limit is 4096/ },
    { id: "bad-id", value: { version: 1, gates: { "Bad_Id": { argv: ["node"] } } }, problem: /must match/ },
    { id: "too-many", value: { version: 1, gates: Object.fromEntries(Array.from({ length: 33 }, (_, index) => ["g" + String(index), { argv: ["node"] }])) }, problem: /limit is 32/ },
    { id: "gates-missing", value: { version: 1 }, problem: /`gates` is missing/ },
  ]
  for (const testCase of malformed) {
    writeGates(ws, testCase.value)
    const before = existsSync(join(ws, ".mpd/verify/evidence")) ? readdirSync(join(ws, ".mpd/verify/evidence")).length : 0
    const refused = resolveGate(ws, "tests")
    const refusedByTool = await evidenceDef.execute({ kind: "gate", gate: "tests", loop_id: "loop-probe" }, { agent: { session: { id: "session-T" } } })
    const after = existsSync(join(ws, ".mpd/verify/evidence")) ? readdirSync(join(ws, ".mpd/verify/evidence")).length : 0
    const sentence = refused.ok === false ? refused.refused : ""
    check("D13/" + testCase.id,
      refused.ok === false && sentence.includes("mpd-gates.json") && testCase.problem.test(sentence) && typeof refusedByTool.refused === "string" && after === before,
      "refused=" + String(refused.ok === false) + " file+problem named=" + String(sentence.includes("mpd-gates.json") && testCase.problem.test(sentence)) + " tool refused=" + String(typeof refusedByTool.refused === "string") + " evidence written=" + String(after - before) + " sentence=" + JSON.stringify(sentence.slice(0, 180)))
  }

  // The 32-entry boundary is ACCEPTED.
  writeGates(ws, { version: 1, gates: Object.fromEntries(Array.from({ length: 32 }, (_, index) => ["g" + String(index), { argv: ["node", "-e", "0"] }])) })
  const atLimit = loadProjectGates(ws)
  check("D14/boundary-32", atLimit.ok === true && atLimit.specs.length === 32, "32 entries accepted: ok=" + String(atLimit.ok) + " entries=" + String(atLimit.ok === true ? atLimit.specs.length : "refused"))

  // A well-formed file with an id nothing declares: refused, naming the whole vocabulary.
  writeGates(ws, { version: 1, gates: { audit: { argv: ["node", "-e", "0"] } } })
  const unknown = resolveGate(ws, "nope")
  check("D15/unknown", unknown.ok === false && unknown.refused.includes("unknown-gate") && unknown.refused.includes("audit") && unknown.refused.includes("typecheck"),
    "unknown id refused with the effective vocabulary: " + JSON.stringify(unknown.ok === false ? unknown.refused.slice(0, 200) : unknown))

  // TIMEOUT: the existing gateTimeoutMs is the budget; a killed child reports 124.
  writeGates(ws, { version: 1, gates: { slow: { argv: ["node", "-e", "setTimeout(() => {}, 3000)"] } } })
  gateTimeoutMs = 300
  const startedAt = Date.now()
  const timedOut = await evidenceDef.execute({ kind: "gate", gate: "slow", loop_id: "loop-probe" }, { agent: { session: { id: "session-T" } } })
  gateTimeoutMs = 5000
  check("D16/timeout", timedOut.exit === 124 && Date.now() - startedAt < 2500,
    "a killed child reports exit 124 within the budget: exit=" + String(timedOut.exit) + " elapsedMs=" + String(Date.now() - startedAt))

  // The project file is resolved PER CALL: rewriting it changes the next resolution.
  writeGates(ws, { version: 1, gates: { tests: { argv: ["node", "-e", "process.stdout.write('SECOND')"] } } })
  const second = resolveGate(ws, "tests")
  check("D18/per-call", second.ok === true && second.spec.cmd === "node -e process.stdout.write('SECOND')",
    "a rewrite is observed by the next call (no module-level cache): " + JSON.stringify(second.ok === true ? second.spec.cmd : second))
  rmSync(ws, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------------------------------
// C2-server: writer_id / writer_reason on mpd_verify_open, and the same-agent refusal it revives.
// ---------------------------------------------------------------------------------------------------
{
  const ws = tempWorkspace("c2")
  writeFileSync(join(ws, "AGENTS.md"), "# probe contract\n\nA frozen contract for the probe.\n")
  const registered: any[] = []
  const fakeDsh = { registerTools: (defs: any[]) => { registered.push(...defs); return () => undefined } }
  const runtime = createVerifyRuntime({ dsh: { workspaceRoot: () => ws }, warn: () => undefined, configValue: () => undefined, defaultEscapeUses: 3, loopTtlMs: 86_400_000 })
  const deps: any = { runtime, configValue: (key: string) => key === "verify.gateTimeoutMs" ? 5000 : undefined, dsh: { workspaceRoot: () => ws, teamMembership: () => undefined }, log: () => undefined }
  registerVerifyTools(fakeDsh as any, deps)
  const openDef = registered.find((def) => def.name === "mpd_verify_open")
  const evidenceDef = registered.find((def) => def.name === "mpd_verify_evidence")
  const recordDef = registered.find((def) => def.name === "mpd_verify_record")
  const execS = { agent: { session: { id: "session-S" } } }
  const execT = { agent: { session: { id: "session-T" } } }

  const delegated = await openDef.execute({ writer: "delegate", writer_id: "session-S", writer_reason: "member: Alice", contract: "AGENTS.md" }, execS)
  const loopFile = typeof delegated.loopId === "string" ? join(ws, ".mpd/verify/loops", delegated.loopId + ".json") : ""
  const loopStored = loopFile !== "" && existsSync(loopFile) ? JSON.parse(readFileSync(loopFile, "utf8")) as { writer?: { kind?: string; id?: string; reason?: string } } : undefined
  check("D01/D02", delegated.refused === undefined && loopStored?.writer?.kind === "delegate" && loopStored?.writer?.id === "session-S",
    "writer_id is stored as the loop's writer.id (no placeholder): " + JSON.stringify(loopStored?.writer))
  check("D05", loopStored?.writer?.reason === "member: Alice",
    "writer_reason is stored on writer.reason: " + JSON.stringify(loopStored?.writer?.reason))

  const placeholder = await openDef.execute({ writer: "delegate", contract: "AGENTS.md" }, execS)
  const placeholderFile = join(ws, ".mpd/verify/loops", placeholder.loopId + ".json")
  const placeholderStored = JSON.parse(readFileSync(placeholderFile, "utf8")) as { writer?: { id?: string } }
  check("D03", placeholderStored.writer?.id === "delegate:pending", "absent writer_id keeps the placeholder: " + JSON.stringify(placeholderStored.writer?.id))

  const selfWriter = await openDef.execute({ writer: "self", self_write_reason: "probe", verifier: "someone-else", writer_id: "session-X", contract: "AGENTS.md" }, execS)
  check("D04", typeof selfWriter.refused === "string" && selfWriter.refused.includes("writer_id"),
    "writer:self + writer_id is refused: " + JSON.stringify(selfWriter.refused))

  const selfReason = await openDef.execute({ writer: "self", self_write_reason: "probe", verifier: "someone-else", writer_reason: "member: X", contract: "AGENTS.md" }, execS)
  check("D04/reason", typeof selfReason.refused === "string" && selfReason.refused.includes("writer_reason"),
    "writer:self + writer_reason is refused: " + JSON.stringify(selfReason.refused))

  const emptyId = await openDef.execute({ writer: "delegate", writer_id: "   ", contract: "AGENTS.md" }, execS)
  const longId = await openDef.execute({ writer: "delegate", writer_id: "x".repeat(201), contract: "AGENTS.md" }, execS)
  const maxId = await openDef.execute({ writer: "delegate", writer_id: "y".repeat(200), contract: "AGENTS.md" }, execS)
  check("D01/bounds", typeof emptyId.refused === "string" && typeof longId.refused === "string" && maxId.refused === undefined,
    "trimmed-empty refused, 201 chars refused, 200 chars accepted: empty=" + String(typeof emptyId.refused === "string") + " long=" + String(typeof longId.refused === "string") + " max=" + String(maxId.refused === undefined))

  // SAME-AGENT: the loop's writer is session-S, so a verdict recorded BY session-S is refused;
  // the same loop recorded by session-T is accepted.
  const loopId = delegated.loopId
  const finding = [{ id: "F1", severity: "blocker", symptom: "probe symptom", expected: "probe expected", doc_source: "AGENTS.md" }]
  const byWriter = await recordDef.execute({ loop_id: loopId, verdict: "FAIL", findings: finding, basis_kind: "blind" }, execS)
  check("D06/refused", byWriter.refused?.reason === "same-agent",
    "a verdict from the named writer is refused with same-agent: " + JSON.stringify(byWriter.refused))

  const byOther = await recordDef.execute({ loop_id: loopId, verdict: "FAIL", findings: finding, basis_kind: "blind" }, execT)
  check("D06/accepted", byOther.refused === undefined && byOther.writerId === "session-S" && byOther.verifierId === "session-T",
    "the same loop recorded by a DIFFERENT session is accepted: " + JSON.stringify({ refused: byOther.refused, writerId: byOther.writerId, verifierId: byOther.verifierId, verdict: byOther.verdict }))

  // A PASS arm too, so the acceptance is proven for the rule that actually demands evidence.
  writeFileSync(join(ws, "mpd-gates.json"), JSON.stringify({ version: 1, gates: { tests: { argv: ["node", "-e", "process.stdout.write('PASS-GATE')"] } } }) + "\n")
  const evidence = await evidenceDef.execute({ kind: "gate", gate: "tests", loop_id: loopId }, execT)
  const pass = await recordDef.execute({ loop_id: loopId, verdict: "PASS", sources: ["AGENTS.md"], evidence_ids: [evidence.evidenceId], basis_kind: "blind" }, execT)
  check("D07/PASS", pass.refused === undefined && pass.verdict === "PASS" && pass.writerId === "session-S",
    "a PASS citing the produced gate evidence is accepted and names the writer: " + JSON.stringify({ refused: pass.refused, writerId: pass.writerId, verdict: pass.verdict, gateEvidence: pass.gateEvidence }))
  rmSync(ws, { recursive: true, force: true })
}

// A frozen-entry control, so a project file cannot have replaced the table globally.
{
  const ws = tempWorkspace("c3-control")
  const frozen = resolveGate(ws, "typecheck")
  check("D08/control", frozen.ok === true && frozen.spec.runner === "bun" && frozen.spec.cmd === "bun run typecheck" && GATE_TABLE.length === 10,
    "no project file: frozen typecheck " + JSON.stringify(frozen.ok === true ? frozen.spec.cmd : frozen) + ", table size=" + String(GATE_TABLE.length))
  rmSync(ws, { recursive: true, force: true })
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
