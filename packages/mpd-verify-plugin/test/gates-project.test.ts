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
import { readEvidence, sha256Text } from "../src/ledger.ts"
import { createVerifyRuntime } from "../src/observe.ts"
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

/** The registered `mpd_verify_evidence` definition for a sandbox workspace. */
function evidenceTool(workspace: string): DshToolDef {
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
  /** The evidence definition, absent only when the registration is incomplete. */
  const tool = captured.find((definition) => definition.name === "mpd_verify_evidence")
  if (tool === undefined) throw new Error("mpd_verify_evidence was not registered")
  return tool
}

/** Run one gate id through the real tool, as one verifier session. */
function runGateTool(workspace: string, id: string): GateOutcome {
  /** The call's execution object; a gate run needs no caller state beyond the workspace. */
  const exec = { name: "mpd_verify_evidence", arguments: { kind: "gate", gate: id }, agent: { session: { id: "verifier-session" } } }
  return evidenceTool(workspace).execute({ kind: "gate", gate: id }, exec) as GateOutcome
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
    // THE HEADER NAMES THE EFFECTIVE CMD: a PASS can say which command ran, even when the frozen table
    // has never heard of it.
    expect(log.split("\n")[0]).toBe("# gate probe-cwd cmd: " + argv.join(" "))
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
