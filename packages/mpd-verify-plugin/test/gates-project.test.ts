// C3 (D13) — a project may DECLARE or OVERRIDE its gates from `mpd-gates.json` at the workspace root.
//
// THE DEFECT these arms pin: the verify gate table was a frozen 10-id list with no extension point, so a
// Rust project could not certify a gate without shipping a fake `package.json`, and three ids died on
// ENOENT. The extension point is asserted from BOTH sides:
//   * a well-formed file ADDS an id and OVERRIDES an existing one, while the frozen table keeps its own
//     cmd strings (the `law.test.ts` pin is re-checked here, untouched);
//   * EVERY malformation is refused with ONE sentence naming the file and the problem — even for a
//     FROZEN id, so a broken project file can never silently run a command the project did not declare;
//   * and a real run proves the EFFECTIVE command: argv[0] is the program, `cwd` is the workspace,
//     `shell:false` (metacharacters do not execute), and the evidence log names the effective `cmd`.
//
// Every arm creates its `mpd-gates.json` under a fresh `mkdtemp` root and passes THAT root; the
// repository root never carries one.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index"
import { GATE_TABLE, PROJECT_GATE_FILE, gateById, loadProjectGates, resolveGate } from "../src/gates.ts"
import type { GateLookup, GateSpec, ProjectGateLoad } from "../src/gates.ts"
import { readEvidence, readLoops, sha256Text, writeLoop } from "../src/ledger.ts"
import { armDelegateLoop, createVerifyRuntime } from "../src/observe.ts"
import { DEFAULT_LOOP_TTL_MS, registerVerifyTools } from "../src/tools.ts"

/** The subset of `mpd_verify_evidence`'s gate result these arms read. */
interface GateOutcome {
  /** The refusal sentence, when the call was refused. */
  refused?: string
  /** The effective command line the run recorded. */
  cmd?: string
  /** The child's exit code. */
  exit?: number
  /** The evidence id the runner minted. */
  evidenceId?: string
  /** The log's workspace-relative path. */
  logPath?: string
  /** The sha256 of the log's bytes. */
  logSha256?: string
  /** The last 4096 characters of the child's output. */
  tail?: string
  /** The freeze guarantee the evidence carries: `frozen` when a loop pinned the project gate file. */
  gateFreeze?: string
}

/** A throwaway workspace under the OS temp dir — never the repository root. */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "mpd-verify-gates-"))
}

/** A sandbox whose project gate file carries exactly this text. */
function withText(text: string): string {
  /** The fresh root. */
  const workspace = sandbox()
  writeFileSync(join(workspace, PROJECT_GATE_FILE), text, "utf8")
  return workspace
}

/** A sandbox whose project gate file is the JSON serialisation of `shape`. */
function withShape(shape: unknown): string {
  return withText(JSON.stringify(shape))
}

/** Remove a sandbox and prove neither it nor its project gate file survived. */
function cleanup(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true })
  expect(existsSync(join(workspace, PROJECT_GATE_FILE))).toBe(false)
  expect(existsSync(workspace)).toBe(false)
}

/** The spec of a resolved lookup, failing the arm when the resolution refused. */
function resolvedSpec(lookup: GateLookup): GateSpec {
  if (!lookup.ok) throw new Error("expected a resolution, got: " + lookup.refused)
  return lookup.spec
}

/** The refusal of a lookup, failing the arm when it resolved. */
function lookupRefusal(lookup: GateLookup): string {
  if (lookup.ok) throw new Error("expected a refusal for " + lookup.spec.id)
  return lookup.refused
}

/** One frozen table entry, failing the arm when the id is not in the table at all. */
function frozenSpec(id: string): GateSpec {
  /** The table's entry for this id. */
  const spec = gateById(id)
  if (spec === undefined) throw new Error(id + " is not on the frozen table")
  return spec
}

/** The refusal of a project-file load, failing the arm when it loaded. */
function loadRefusal(load: ProjectGateLoad): string {
  if (load.ok) throw new Error("expected a refusal, got " + load.specs.length + " entry(ies)")
  return load.refused
}

/** The argv of a project gate that prints one marker through the runtime running this test. */
function printArgv(marker: string): string[] {
  return [process.execPath, "-e", "console.log(" + JSON.stringify(marker) + ")"]
}

/** The five registered law tools for a sandbox workspace, keyed by name. */
function lawTools(workspace: string): Map<string, DshToolDef> {
  /** The definitions the registration call hands the registry. */
  const captured: DshToolDef[] = []
  registerVerifyTools({
    /** Capture the definitions so an arm can call one directly, with no harness. */
    registerTools: (definitions: DshToolDef[]): (() => void) => { captured.push(...definitions); return () => {} },
  }, {
    /** The process-local runtime; these arms never observe an implementation read. */
    runtime: createVerifyRuntime({
      dsh: { workspaceRoot: () => workspace },
      warn: () => {},
      configValue: () => undefined,
      defaultEscapeUses: 1,
      loopTtlMs: DEFAULT_LOOP_TTL_MS,
    }),
    configValue: () => undefined,
    dsh: { workspaceRoot: () => workspace, teamMembership: () => undefined },
    log: () => {},
  })
  return new Map(captured.map((definition) => [definition.name, definition]))
}

/** One captured tool, refused loudly when the registration is incomplete. */
function toolFor(tools: Map<string, DshToolDef>, name: string): DshToolDef {
  /** The definition, absent only when registration broke. */
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(name + " was not registered")
  return tool
}

/** The subset of `mpd_verify_open`'s result these arms read. */
interface OpenOutcome {
  /** The refusal sentence, when the call was refused. */
  refused?: string
  /** The minted loop id. */
  loopId?: string
  /** The project gate file identity the loop froze, when the tool names it. */
  gateFile?: { state: string; sha256: string }
}

/** Call one law tool as a named caller session. */
function callTool(tool: DshToolDef, args: Record<string, unknown>, sessionId: string): OpenOutcome & GateOutcome {
  /** The call's execution object; these tools read the workspace from their deps. */
  const exec = { name: tool.name, arguments: args, agent: { session: { id: sessionId } } }
  return tool.execute(args, exec) as OpenOutcome & GateOutcome
}

/** Run one gate id through the real evidence tool, optionally bound to a loop. */
function runGateTool(workspace: string, id: string, loopId?: string): GateOutcome {
  /** The call's arguments: `loop_id` binds the evidence to a loop, which is what the freeze check reads. */
  const args: Record<string, unknown> = loopId === undefined ? { kind: "gate", gate: id } : { kind: "gate", gate: id, loop_id: loopId }
  return callTool(toolFor(lawTools(workspace), "mpd_verify_evidence"), args, "verifier-session")
}

/**
 * A loop file written DIRECTLY, with no tool and no gate snapshot — the shape a loop from BEFORE the
 * freeze has (T29 needs one to prove that an unfrozen loop now refuses gate evidence).
 *
 * @param workspace - the sandbox the loop is written into.
 * @param sessionId - the delegating session the loop belongs to.
 * @param openedVia - `tool` for a hand-written loop, `observer` for one the auto-arm would adopt.
 * @returns the fixture loop id.
 */
function legacyLoop(workspace: string, sessionId: string, openedVia: "tool" | "observer"): string {
  /** The fixture loop id, derived from its kind so one sandbox can hold both shapes. */
  const loopId = "loop-legacy-" + openedVia
  /** The instant the fixture is armed at. */
  const now = new Date()
  expect(writeLoop(workspace, {
    version: 1, loopId, taskId: null, workspace, sessionId,
    writer: { kind: "delegate", id: "session-S" },
    verifier: { id: "verifier-X" },
    scope: [], status: "armed", openedVia,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEFAULT_LOOP_TTL_MS).toISOString(),
  })).toBe(true)
  return loopId
}

describe("mpd-gates.json (C3 / D13)", () => {
  test("an ABSENT project file leaves the frozen table exactly as it was", () => {
    /** A sandbox that carries no project gate file. */
    const workspace = sandbox()
    /** What the loader reports for a workspace with no project file. */
    const load = loadProjectGates(workspace)
    expect(load.ok).toBe(true)
    expect(load.ok ? load.specs.length : -1).toBe(0)
    // THE FROZEN FALLBACK: identity, not just equality — the project layer never clones or edits it.
    expect(resolvedSpec(resolveGate(workspace, "gates"))).toBe(frozenSpec("gates"))
    expect(resolvedSpec(resolveGate(workspace, "tests")).cmd).toBe("bun test packages")
    /** The unknown-id refusal, unchanged for a workspace with no project file. */
    const unknown = lookupRefusal(resolveGate(workspace, "rm -rf"))
    expect(unknown).toContain("unknown-gate")
    expect(unknown).toContain(GATE_TABLE.map((entry) => entry.id).join(", "))
    cleanup(workspace)
  })

  test("a project entry ADDS a new id, and every frozen id still resolves to its own entry", () => {
    /** The argv the project declares for its new gate. */
    const argv = printArgv("added")
    /** A sandbox declaring one new id beside a frozen one. */
    const workspace = withShape({ version: 1, gates: { "check-added": { argv } } })
    /** The added entry. */
    const added = resolvedSpec(resolveGate(workspace, "check-added"))
    expect(added.id).toBe("check-added")
    // `cmd` defaults to the argv's own spelling, which is what the evidence header will name.
    expect(added.cmd).toBe(argv.join(" "))
    expect(added.runner).toBe("argv")
    expect([...added.argv]).toEqual(argv)
    // THE FROZEN HALF IS ADDITIVE, NOT REPLACED: an id the project does not declare is the table's entry.
    expect(resolvedSpec(resolveGate(workspace, "docs"))).toBe(frozenSpec("docs"))
    for (const entry of GATE_TABLE) expect(resolvedSpec(resolveGate(workspace, entry.id)).cmd).toBe(entry.cmd)
    cleanup(workspace)
  })

  test("a project entry OVERRIDES a frozen id, and the frozen table keeps its own strings", () => {
    /** The override's argv. */
    const argv = printArgv("override")
    /** A sandbox overriding a frozen id. */
    const workspace = withShape({ version: 1, gates: { tests: { argv } } })
    expect(resolvedSpec(resolveGate(workspace, "tests")).cmd).toBe(argv.join(" "))
    // THE `law.test.ts` PIN, RE-CHECKED FROM THIS LANE'S SIDE: overriding through the project file is a
    // RESOLUTION, never a mutation of the frozen table every other caller reads.
    for (const entry of GATE_TABLE) expect(gateById(entry.id)?.cmd).toBe(entry.cmd)
    expect(gateById("tests")?.cmd).toBe("bun test packages")
    cleanup(workspace)
  })

  test("an explicit `cmd` is the effective one, and it wins over the argv's spelling", () => {
    /** A sandbox that declares both spellings. */
    const workspace = withShape({ version: 1, gates: { styled: { cmd: "node custom.js --fast", argv: ["node", "custom.js", "--fast"] } } })
    expect(resolvedSpec(resolveGate(workspace, "styled")).cmd).toBe("node custom.js --fast")
    // The argv is still the thing that RUNS; `cmd` is the label the evidence header names.
    expect([...resolvedSpec(resolveGate(workspace, "styled")).argv]).toEqual(["node", "custom.js", "--fast"])
    cleanup(workspace)
  })

  test("EVERY malformation is refused in one sentence naming the file and the problem — no silent fallback", () => {
    /** One malformed shape per rule, with the phrase the refusal must carry. */
    const malformed: Array<{ name: string; text: string; problem: string }> = [
      { name: "invalid JSON", text: "{", problem: "not valid JSON" },
      { name: "a non-object top level", text: "[]", problem: "top level must be an object" },
      { name: "an unknown top-level key", text: JSON.stringify({ version: 1, gates: {}, mode: "fast" }), problem: "mode" },
      { name: "an unsupported version", text: JSON.stringify({ version: 2, gates: {} }), problem: "version must be 1" },
      { name: "a missing gates map", text: JSON.stringify({ version: 1 }), problem: "`gates` is missing" },
      { name: "a non-object gates map", text: JSON.stringify({ version: 1, gates: [] }), problem: "`gates` must be an object" },
      { name: "an unknown entry key", text: JSON.stringify({ version: 1, gates: { ok: { argv: ["true"], shell: true } } }), problem: "unknown key" },
      { name: "a non-object entry", text: JSON.stringify({ version: 1, gates: { ok: "true" } }), problem: "must be an object with `argv`" },
      { name: "a non-array argv", text: JSON.stringify({ version: 1, gates: { ok: { argv: "true" } } }), problem: "needs `argv` to be an array" },
      { name: "an empty argv", text: JSON.stringify({ version: 1, gates: { ok: { argv: [] } } }), problem: "declares 0 argument(s)" },
      { name: "an empty argument", text: JSON.stringify({ version: 1, gates: { ok: { argv: ["true", ""] } } }), problem: "argv[1] must be a non-empty string" },
      { name: "too many arguments", text: JSON.stringify({ version: 1, gates: { ok: { argv: new Array(33).fill("x") } } }), problem: "declares 33 argument(s)" },
      { name: "an over-long argument", text: JSON.stringify({ version: 1, gates: { ok: { argv: ["x".repeat(4097)] } } }), problem: "the limit is 4096" },
      { name: "a non-string cmd", text: JSON.stringify({ version: 1, gates: { ok: { cmd: 7, argv: ["true"] } } }), problem: "`cmd` must be a non-empty string" },
      { name: "a bad gate id", text: JSON.stringify({ version: 1, gates: { "Bad_Id": { argv: ["true"] } } }), problem: "must match" },
      { name: "more than 32 entries", text: JSON.stringify({ version: 1, gates: Object.fromEntries(Array.from({ length: 33 }, (_, index) => ["g" + index, { argv: ["true"] }])) }), problem: "33 gates are declared" },
    ]
    for (const arm of malformed) {
      /** The sandbox carrying this malformation. */
      const workspace = withText(arm.text)
      /** The loader's answer. */
      const sentence = loadRefusal(loadProjectGates(workspace))
      expect(sentence).toContain(PROJECT_GATE_FILE)
      expect(sentence).toContain(arm.problem)
      // THE NO-SILENT-FALLBACK RULE: even a FROZEN id is refused while the project file is malformed, and
      // the sentence is the loader's own — a fallback would answer with the frozen entry instead.
      expect(lookupRefusal(resolveGate(workspace, "gates"))).toBe(sentence)
      expect(lookupRefusal(resolveGate(workspace, "made-up"))).toBe(sentence)
      cleanup(workspace)
    }
  })

  test("a real run proves the EFFECTIVE command: header, cwd and the recorded cmd", () => {
    /** The argv whose script reports the child's cwd. */
    const argv = [process.execPath, "-e", "console.log('cwd=' + process.cwd())"]
    /** A sandbox declaring that gate. */
    const workspace = withShape({ version: 1, gates: { "probe-cwd": { argv } } })
    /** The run's result. */
    const result = runGateTool(workspace, "probe-cwd")
    expect(result.refused).toBeUndefined()
    expect(result.exit).toBe(0)
    expect(result.cmd).toBe(argv.join(" "))
    /** The log as it sits on disk. */
    const log = readFileSync(join(workspace, String(result.logPath)), "utf8")
    /** The header line: ONE line, naming the label, the program and the argv that really ran. */
    const header = log.split("\n")[0]
    // THE HEADER NAMES WHAT RAN (CR #14): the `cmd` label alone is a CLAIM; the program and argv are the
    // fact, so a PASS can never cite a command that did not execute.
    expect(header).toContain("cmd: " + JSON.stringify(argv.join(" ")))
    expect(header).toContain("program: " + JSON.stringify(process.execPath))
    expect(header).toContain("argv: " + JSON.stringify(argv.slice(1)))
    // ONE header line, then the child's own output: the header can never swallow the run.
    expect(log.split("\n")[1]).toBe("cwd=" + realpathSync(workspace))
    // The recorded hash is the hash of what was WRITTEN, header included.
    expect(result.logSha256).toBe(sha256Text(log))
    /** The evidence metadata the record path cites. */
    const meta = readEvidence(workspace).find((row) => row.evidenceId === result.evidenceId)
    expect(meta?.cmd).toBe(argv.join(" "))
    expect(meta?.exit).toBe(0)
    // `cwd` IS THE WORKSPACE, proved by the child itself (realpath, because a temp root may be a symlink).
    expect(result.tail).toContain("cwd=" + realpathSync(workspace))
    cleanup(workspace)
  })

  test("a real override replaces the frozen command the runner would have used", () => {
    /** A sandbox that overrides the frozen `tests` id with a fast, deterministic child. */
    const workspace = withShape({ version: 1, gates: { tests: { argv: printArgv("override-ran") } } })
    /** The run's result. */
    const result = runGateTool(workspace, "tests")
    expect(result.refused).toBeUndefined()
    // The frozen `tests` entry runs `bun test packages`; this arm finishes green, so the PROJECT entry is
    // what really ran.
    expect(result.exit).toBe(0)
    expect(result.tail).toContain("override-ran")
    expect(gateById("tests")?.cmd).toBe("bun test packages")
    cleanup(workspace)
  })

  test("a spawned project gate gets argv literally: shell:false means no metacharacter executes", () => {
    /** A scratch directory for the marker a shell would have created. */
    const scratch = mkdtempSync(join(tmpdir(), "mpd-verify-shell-"))
    /** The file a shell would have created if the argv were ever handed to one. */
    const marker = join(scratch, "pwned")
    /** A sandbox whose last argument is a shell command in disguise. */
    const workspace = withShape({ version: 1, gates: { literal: { argv: [process.execPath, "-e", "console.log('literal')", "; touch " + marker] } } })
    /** The run's result. */
    const result = runGateTool(workspace, "literal")
    expect(result.refused).toBeUndefined()
    expect(result.exit).toBe(0)
    expect(existsSync(marker)).toBe(false)
    cleanup(workspace)
    rmSync(scratch, { recursive: true, force: true })
    expect(existsSync(scratch)).toBe(false)
  })

  test("a malformed project file refuses a FROZEN id through the tool and writes NO evidence", () => {
    /** A sandbox whose project file cannot be parsed. */
    const workspace = withText("{")
    /** The refusal the evidence tool returns for a frozen id. */
    const result = runGateTool(workspace, "gates")
    expect(String(result.refused)).toContain(PROJECT_GATE_FILE)
    // NO FALLBACK, NO BOGUS EVIDENCE: a refused call must leave nothing a record could cite.
    expect(readEvidence(workspace)).toHaveLength(0)
    cleanup(workspace)
  })
})

describe("CR repairs #11-#14 on the gate plane", () => {
  test("#14 the log header names the REAL program and argv, not only the `cmd` label", () => {
    /** The argv that actually runs. */
    const argv = printArgv("real-argv-ran")
    /** A sandbox whose label deliberately differs from the argv. */
    const workspace = withShape({ version: 1, gates: { "audit-label": { cmd: "audit label", argv } } })
    /** The run's result. */
    const result = runGateTool(workspace, "audit-label")
    expect(result.refused).toBeUndefined()
    expect(result.exit).toBe(0)
    /** The log on disk. */
    const log = readFileSync(join(workspace, String(result.logPath)), "utf8")
    /** The header line. */
    const header = log.split("\n")[0]
    // THE ATTACK THIS CLOSES: `cmd:"bun test packages"` + `argv:["true"]` used to record only the label,
    // so a PASS could cite a command that never ran.
    expect(header).toContain("cmd: " + JSON.stringify("audit label"))
    expect(header).toContain("program: " + JSON.stringify(process.execPath))
    expect(header).toContain("argv: " + JSON.stringify(argv.slice(1)))
    expect(result.tail).toContain("real-argv-ran")
    // The label stays the record's `cmd` (the human name); the LOG is the authoritative account of what
    // executed, and `logSha256` pins it.
    expect(readEvidence(workspace).find((row) => row.evidenceId === result.evidenceId)?.cmd).toBe("audit label")
    cleanup(workspace)
  })

  test("#11 a newline or line separator in `cmd`/`argv` cannot forge a log line", () => {
    /** One marker a forger would want on a line of its own. */
    const forged = "FORGED-EVIDENCE-ROW"
    /** A cmd carrying a newline, a U+2028 line separator and a DEL control character. */
    const cmd = "first\n" + forged + "\u2028" + forged + "\u007f"
    /** An argv element that also carries a newline. */
    const argv = [process.execPath, "-e", "console.log('ran')", "\n" + forged]
    /** A sandbox declaring that gate. */
    const workspace = withShape({ version: 1, gates: { forged: { cmd, argv } } })
    /** The run's result. */
    const result = runGateTool(workspace, "forged")
    expect(result.refused).toBeUndefined()
    /** The log's lines. */
    const lines = readFileSync(join(workspace, String(result.logPath)), "utf8").split("\n")
    // THE HEADER IS ONE LINE: the project's own text is ESCAPED into it, so nothing it contains starts a
    // line of its own. `lines` is header + "ran" + the trailing empty string.
    expect(lines).toHaveLength(3)
    expect(lines.some((line) => line.trim() === forged)).toBe(false)
    expect(lines[0]).toContain('"first\\nFORGED-EVIDENCE-ROW')
    // JSON alone does not escape the line separator or DEL, so the header escapes them too.
    expect(lines[0]).toContain("\\u2028")
    expect(lines[0]).toContain("\\u007f")
    expect(lines[0]).toContain(JSON.stringify("\n" + forged))
    cleanup(workspace)
  })

  test("#13 a spawn failure is IN the log and the tail, not a bare header", () => {
    /** A program that cannot exist. */
    const missing = "mpd-cr-no-such-program-xyz"
    /** A sandbox declaring that gate. */
    const workspace = withShape({ version: 1, gates: { "missing-tool": { argv: [missing] } } })
    /** The run's result. */
    const result = runGateTool(workspace, "missing-tool")
    expect(result.refused).toBeUndefined()
    // THE FAILURE IS A FAILURE: the child never started, so the exit code is the runner's own -1.
    expect(result.exit).not.toBe(0)
    // ... AND IT SAYS WHY: the spawn error reaches the tail a model reads.
    expect(String(result.tail)).toContain("[spawn-error]")
    expect(String(result.tail)).toContain(missing)
    /** The log on disk. */
    const log = readFileSync(join(workspace, String(result.logPath)), "utf8")
    expect(log).toContain("[spawn-error]")
    expect(log).toContain(missing)
    // The evidence still lands, so the FAILURE itself is citable rather than invisible.
    expect(readEvidence(workspace).some((row) => row.evidenceId === result.evidenceId)).toBe(true)
    cleanup(workspace)
  })

  test("#12 a loop FREEZES `mpd-gates.json`: an edit afterwards refuses that loop's gate runs", () => {
    /** The gate as first declared. */
    const argv = printArgv("frozen-ran")
    /** A sandbox with one project gate. */
    const workspace = withShape({ version: 1, gates: { frozen: { argv } } })
    /** The tools for this workspace. */
    const tools = lawTools(workspace)
    /** The delegated loop: the freeze is captured when it is opened. */
    const opened = callTool(toolFor(tools, "mpd_verify_open"), { writer: "delegate", writer_id: "session-S", verifier: "verifier-X" }, "captain-session")
    expect(opened.refused).toBeUndefined()
    /** The loop id. */
    const loopId = String(opened.loopId)
    // THE FREEZE IS ON DISK AND IN THE RESULT: the file's identity at open time.
    const frozenSha = sha256Text(readFileSync(join(workspace, PROJECT_GATE_FILE), "utf8"))
    expect(readLoops(workspace).find((loop) => loop.loopId === loopId)?.gateFile).toEqual({ state: "present", sha256: frozenSha })
    expect(opened.gateFile).toEqual({ state: "present", sha256: frozenSha })
    /** A bound run under the unchanged file: green, and it SAYS the evidence is frozen. */
    const frozenRun = runGateTool(workspace, "frozen", loopId)
    expect(frozenRun.refused).toBeUndefined()
    expect(frozenRun.exit).toBe(0)
    expect(frozenRun.gateFreeze).toBe("frozen")
    expect(frozenRun.tail).toContain("frozen-ran")
    // THE ATTACK (CR #12): the loop's own writer edits the gate file to make it pass or mislabel it.
    writeFileSync(join(workspace, PROJECT_GATE_FILE), JSON.stringify({ version: 1, gates: { frozen: { argv: printArgv("edited") } } }), "utf8")
    /** The bound run after the edit. */
    const attack = runGateTool(workspace, "frozen", loopId)
    expect(String(attack.refused)).toContain("gate-freeze")
    expect(String(attack.refused)).toContain(PROJECT_GATE_FILE)
    // NOTHING RAN AND NOTHING WAS WRITTEN: the refused run leaves exactly the first evidence row.
    expect(readEvidence(workspace)).toHaveLength(1)
    // AN UNBOUND RUN IS STILL LIVE, and it DECLARES that it carries no freeze — the bound is stated, not
    // hidden: a gate run with no loop has no file to freeze.
    const live = runGateTool(workspace, "frozen")
    expect(live.refused).toBeUndefined()
    expect(live.gateFreeze).toBe("unfrozen")
    expect(live.tail).toContain("edited")
    cleanup(workspace)
  })

  test("#12 a loop opened with NO project file refuses the file that appears later", () => {
    /** A sandbox with no project gate file at all. */
    const workspace = sandbox()
    /** The tools for this workspace. */
    const tools = lawTools(workspace)
    /** The loop, opened while the workspace carried no project gate file. */
    const opened = callTool(toolFor(tools, "mpd_verify_open"), { writer: "delegate", writer_id: "session-S", verifier: "verifier-X" }, "captain-session")
    expect(opened.refused).toBeUndefined()
    /** The loop id. */
    const loopId = String(opened.loopId)
    expect(readLoops(workspace).find((loop) => loop.loopId === loopId)?.gateFile).toEqual({ state: "absent", sha256: "" })
    // ABSENT IS A FROZEN ANSWER TOO: a file that appears later would change what a FROZEN id runs.
    writeFileSync(join(workspace, PROJECT_GATE_FILE), JSON.stringify({ version: 1, gates: { gates: { argv: printArgv("late") } } }), "utf8")
    /** The bound run after the file appeared. */
    const attack = runGateTool(workspace, "gates", loopId)
    expect(String(attack.refused)).toContain("gate-freeze")
    expect(readEvidence(workspace)).toHaveLength(0)
    cleanup(workspace)
  })
})

describe("T29 - an UNFROZEN loop refuses gate evidence, and the observer freezes", () => {
  test("a loop with NO snapshot REFUSES a gate run and names the repair", () => {
    /** A sandbox with one project gate. */
    const workspace = withShape({ version: 1, gates: { frozen: { argv: printArgv("legacy-ran") } } })
    /** A loop written before the freeze existed: armed, but with no `gateFile` field at all. */
    const loopId = legacyLoop(workspace, "captain-session", "tool")
    /** The bound run: an unfrozen loop cannot say which gates it certified. */
    const bound = runGateTool(workspace, "frozen", loopId)
    expect(String(bound.refused)).toContain("gate-freeze")
    expect(String(bound.refused)).toContain("NO frozen")
    expect(String(bound.refused)).toContain("open a NEW loop")
    // NOTHING RAN: the refusal precedes the spawn, so there is no evidence to cite.
    expect(readEvidence(workspace)).toHaveLength(0)
    // THE UNBOUND RUN IS NOT THE SUBJECT: with no loop, the same gate still runs and says `unfrozen`.
    const live = runGateTool(workspace, "frozen")
    expect(live.refused).toBeUndefined()
    expect(live.gateFreeze).toBe("unfrozen")
    cleanup(workspace)
  })

  test("the OBSERVER freezes the loop it arms: its gate runs are green, and an edit is refused", () => {
    /** A sandbox with one project gate. */
    const workspace = withShape({ version: 1, gates: { frozen: { argv: printArgv("observer-ran") } } })
    /** The loop the observer arms for one delegation. */
    const armed = armDelegateLoop(workspace, "captain-session", "mpd_role_spawn", DEFAULT_LOOP_TTL_MS)
    expect(armed === undefined).toBe(false)
    /** The loop id the observer armed. */
    const loopId = String(armed)
    /** The file identity at arm time. */
    const frozenSha = sha256Text(readFileSync(join(workspace, PROJECT_GATE_FILE), "utf8"))
    expect(readLoops(workspace).find((loop) => loop.loopId === loopId)?.gateFile).toEqual({ state: "present", sha256: frozenSha })
    /** A bound run under the frozen file. */
    const frozenRun = runGateTool(workspace, "frozen", loopId)
    expect(frozenRun.refused).toBeUndefined()
    expect(frozenRun.exit).toBe(0)
    expect(frozenRun.gateFreeze).toBe("frozen")
    // THE SAME FREEZE THE TOOL WRITES: an edit after arming refuses the run.
    writeFileSync(join(workspace, PROJECT_GATE_FILE), JSON.stringify({ version: 1, gates: { frozen: { argv: printArgv("edited") } } }), "utf8")
    /** The bound run after the edit. */
    const attack = runGateTool(workspace, "frozen", loopId)
    expect(String(attack.refused)).toContain("gate-freeze")
    cleanup(workspace)
  })

  test("re-arming ADOPTS a freeze into an observer loop armed before the freeze existed", () => {
    /** A sandbox with one project gate. */
    const workspace = withShape({ version: 1, gates: { frozen: { argv: printArgv("adopted-ran") } } })
    /** A legacy OBSERVER loop for the same session: armed, unfrozen. */
    const legacyId = legacyLoop(workspace, "captain-session", "observer")
    // As it stands it refuses gate evidence (the arm above), so the observer must repair it.
    expect(String(runGateTool(workspace, "frozen", legacyId).refused)).toContain("gate-freeze")
    /** The re-arm: the SAME loop is reused, now carrying the freeze. */
    const rearmed = armDelegateLoop(workspace, "captain-session", "mpd_role_spawn", DEFAULT_LOOP_TTL_MS)
    expect(rearmed).toBe(legacyId)
    expect(readLoops(workspace).find((loop) => loop.loopId === legacyId)?.gateFile).toEqual({ state: "present", sha256: sha256Text(readFileSync(join(workspace, PROJECT_GATE_FILE), "utf8")) })
    /** And its gate evidence now runs under the adopted freeze. */
    const run = runGateTool(workspace, "frozen", legacyId)
    expect(run.refused).toBeUndefined()
    expect(run.gateFreeze).toBe("frozen")
    cleanup(workspace)
  })
})
