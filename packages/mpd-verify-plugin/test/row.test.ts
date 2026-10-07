// THE ROW'S OWN INTEGRATION ARM — mount it into a stub composition and drive the REAL wiring.
//
// The offline arms in `law.test.ts` prove the DECISIONS. This file proves the PLUMBING between them: that
// `apply()` publishes the `mpdVerify` service, registers all five tools through the adapter, installs the
// delegation observer, writes the boot marker and prints a boot line a mount lane can assert — and that
// the ROLES-side guard, reading that very service, refuses the captain's code write and allows it again
// once `mpd_verify_open` armed a loop. Without this arm a typo in `apply()` would be invisible until a
// live boot, which is the slowest possible place to find it.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply } from "../src/index.ts"
import { VERIFY_SERVICE } from "../src/service.ts"
import { DEFAULT_CONTRACT_PATH } from "../src/law.ts"
import { readLoops, readSeats } from "../src/ledger.ts"
import { installVerifyGuard } from "../../mpd-roles-plugin/src/verify-guard.ts"

/** One registered tool, as the stub registry keeps it. */
interface RegisteredTool {
  /** The tool name the model calls. */
  name: string
  /** The body the harness would invoke. */
  execute: (args: unknown, exec: unknown) => unknown
}

/** A stub composition that records everything the row does. */
function harness(workspace: string): {
  ctx: Record<string, unknown>
  tools: RegisteredTool[]
  guards: Array<(exec: unknown) => string | undefined>
  lines: string[]
  observers: { count: number }
  services: Map<string, unknown>
  stub: Record<string, unknown>
} {
  /** Every tool the row registered. */
  const tools: RegisteredTool[] = []
  /** Every guard the row installed. */
  const guards: Array<(exec: unknown) => string | undefined> = []
  /** Every boot line the row printed. */
  const lines: string[] = []
  /** How many post-execute observers were installed. */
  const observers = { count: 0 }
  /** The services published through `provide`. */
  const services = new Map<string, unknown>()
  /** The adapter slice `createLazyDshAdapter` will resolve and forward to. */
  const stub: Record<string, unknown> = {
    capabilities: () => ({ toolsGuard: true, toolsRegister: true }),
    workspaceRoot: () => workspace,
    registerTool: (definition: RegisteredTool) => { tools.push(definition); return () => { /* unregistered */ } },
    registerTools: (definitions: RegisteredTool[]) => { for (const definition of definitions) tools.push(definition); return () => { /* unregistered */ } },
    guardTool: (guard: (exec: unknown) => string | undefined) => { guards.push(guard); return () => { /* unregistered */ } },
    onPostToolExecute: () => { observers.count += 1; return () => { /* unregistered */ } },
    teamMembership: () => undefined,
  }
  /** The ctx: `get` answers the adapter for `mpdDsh`, nothing for the config layer, and the law's service. */
  const ctx: Record<string, unknown> = {
    tools: {},
    provide: (id: string, value: unknown) => { services.set(id, value) },
    get: (id: string, strict?: boolean) => {
      if (id === "mpdDsh") return stub
      if (id === VERIFY_SERVICE) return services.get(VERIFY_SERVICE)
      if (id === "mpdConfig") return undefined
      if (strict === true) return undefined
      return undefined
    },
    on: () => () => { /* unregistered */ },
  }
  // The boot-log sink: `rowLogLine` writes to stdout, so the line is captured by patching the writer the
  // adapter exports would be overkill — instead the row's own log calls are read back from the console
  // spy below. The array is filled by the spy in `installLineSpy`.
  return { ctx, tools, guards, lines, observers, services, stub }
}

/**
 * Read the row's own boot lines back from its LOG SINK.
 *
 * `rowLogLine` deliberately never prints to the terminal (R5): it appends to
 * `<workspace>/.mpd/logs/<row>.log`. Reading that file is therefore the honest way to assert a boot line
 * a mount lane would check — and it also pins the R5 discipline for this row.
 *
 * @param workspace - the workspace the row booted against.
 * @returns the log's lines, or an empty list when nothing was written.
 */
function bootLines(workspace: string): string[] {
  try {
    return readFileSync(join(workspace, ".mpd", "logs", "mpd-verify.log"), "utf8").split("\n").filter((line) => line !== "")
  } catch { return [] }
}

/**
 * Walk a tool result the way the HARNESS does before it accepts one, and return the first violation.
 *
 * This mirrors `@deepseek-ai/dsh-util-values`' `walkJsonValue`, which is what the harness runs over every
 * tool result: a value is lossless JSON only when every reachable value is `null`, a boolean, a string, a
 * FINITE number, a dense array or a plain object whose EVERY own key holds a lossless value. An own key
 * whose value is `undefined` is therefore fatal to the whole result — `JSON.stringify` silently drops it,
 * which is exactly why D1 was invisible to every log and green suite until a caller read the error.
 *
 * @param value - the candidate value.
 * @param path - the diagnostic path, built as the walk descends.
 * @param seen - the ancestors on the current path, so a cycle is reported rather than hung on.
 * @returns the first violation, or `undefined` when the value is lossless JSON.
 */
function losslessViolation(value: unknown, path: string = "$", seen: Set<unknown> = new Set<unknown>()): string | undefined {
  if (value === null) return undefined
  if (typeof value === "boolean" || typeof value === "string") return undefined
  if (typeof value === "number") return Number.isFinite(value) ? undefined : path + " is not a finite JSON number"
  if (typeof value !== "object") return path + " is " + typeof value + ", which JSON cannot represent losslessly"
  if (seen.has(value)) return path + " is part of a cycle"
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) return path + "[" + index + "] is a hole"
      /** The violation inside this element, when there is one. */
      const bad = losslessViolation(value[index], path + "[" + index + "]", seen)
      if (bad !== undefined) return bad
    }
    return undefined
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    /** The violation inside this property, when there is one. */
    const bad = losslessViolation((value as Record<string, unknown>)[key], path + "." + key, seen)
    if (bad !== undefined) return bad
  }
  return undefined
}

/**
 * Find one registered tool in a stub composition by the name the model would call.
 *
 * @param tools - the tools the row registered through the adapter.
 * @param name - the tool name.
 * @returns the registered tool, or `undefined` when the row registered no such tool.
 */
function toolOf(tools: RegisteredTool[], name: string): RegisteredTool | undefined {
  return tools.find((tool) => tool.name === name)
}

/** The `mpd_verify_open` result, as the CALLER reads it — the loop id comes from here, never from disk. */
interface OpenResult {
  /** The minted loop id. */
  loopId?: string
  /** The contract in force for this loop: its own, or the declared default. */
  contract?: string
  /** The writer seat as projected. */
  writer?: { kind?: string; id?: string; reason?: string }
  /** The refusal, when the open was refused. */
  refused?: string
}

/** The `mpd_verify_seat` result: the frozen docs the seat was handed. */
interface SeatResult {
  /** The documents this seat may always read. */
  docs?: string[]
  /** The verifier's agent key. */
  verifierId?: string
  /** The refusal, when the bind was refused. */
  refused?: string
}

/** A `mpd_verify_record` result: the verdict that landed, or the validator's NAMED refusal. */
interface RecordResult {
  /** The minted record id, when the record landed. */
  recordId?: string
  /** The verdict, when the record landed. */
  verdict?: string
  /** The validator's refusal, carrying its stable rule name. */
  refused?: { reason?: string; detail?: string }
}

/** The `mpd_verify_evidence` result: the minted evidence id and the gate's exit code. */
interface EvidenceResult {
  /** The minted evidence id. */
  evidenceId?: string
  /** The gate's exit code, whatever it was. */
  exit?: number
}

/** The parts of a stored record file this file asserts on, read back from the ledger's own directory. */
interface StoredRecord {
  /** The record id. */
  recordId?: string
  /** How the verifier established its basis, including the frozen contract and its docs. */
  basis?: {
    /** The frozen contract the verification was checked against. */
    frozenContract?: { path?: string }
    /** The documents that formed the basis. */
    docs?: Array<{ path?: string }>
  }
}

describe("the mpd-verify row", () => {
  test("apply publishes the service, registers five tools, installs the observer and marks the boot", () => {
    /** The sandbox workspace the row boots against — NEVER the repository root (F.1). */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-row-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    // THE LOG ROOT IS AN ENV FACT, not a row parameter: `rowLogLine` resolves
    // `MPD_MCP_LOG_DIR` -> `DSH_WORKSPACE_ROOT` -> cwd, so a unit test that did not pin it would append
    // to the REPOSITORY's own `.mpd/logs/` — the §7 isolation trap, one layer down from the workspace.
    /** The previous log roots, restored before the next arm. */
    const previousLogRoot = process.env.MPD_MCP_LOG_DIR
    /** The previous DSH_WORKSPACE_ROOT, restored after the arm. */
    const previousWorkspace = process.env.DSH_WORKSPACE_ROOT
    // `rowLogLine` hands `openLogSink` an EXPLICIT root — `workspaceRootOf(undefined)`, which resolves
    // `DSH_WORKSPACE_ROOT` before cwd — so BOTH spellings are pinned here. Without this the boot line
    // appends to the REPOSITORY's own `.mpd/logs/`, which is the §7 isolation trap one layer down.
    process.env.MPD_MCP_LOG_DIR = workspace
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      apply(h.ctx as never, { mode: "hard", escapeUses: 1 })
    } finally {
      if (previousLogRoot === undefined) delete process.env.MPD_MCP_LOG_DIR
      else process.env.MPD_MCP_LOG_DIR = previousLogRoot
      if (previousWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousWorkspace
    }
    // THE SERVICE, which the roles-side guard resolves per call.
    expect(h.services.has(VERIFY_SERVICE)).toBe(true)
    // THE FIVE TOOLS, by name.
    expect(h.tools.map((tool) => tool.name).sort()).toEqual([
      "mpd_verify_escape", "mpd_verify_evidence", "mpd_verify_open", "mpd_verify_record", "mpd_verify_seat",
    ])
    // THE OBSERVER and the BOOT MARKER.
    expect(h.observers.count).toBe(1)
    /** The lines the row wrote to its own log sink. */
    const lines = bootLines(workspace)
    expect(lines.some((line) => line.includes("verifyGate=installed"))).toBe(true)
    expect(lines.some((line) => line.includes("bootMarker=written"))).toBe(true)
    expect(lines.some((line) => line.includes("tools=5"))).toBe(true)
    rmSync(workspace, { recursive: true, force: true })
  })

  test("the ROLES-side guard, reading that service, refuses a captain write and allows it after an arm", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-guard-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, { mode: "hard", escapeUses: 1 })
    /** The law's runtime, as the guard resolves it. */
    const law = h.services.get(VERIFY_SERVICE)
    /** The guard's install, against the same stub registry. */
    const installed = installVerifyGuard(h.stub as never, {
      presets: ["mpd"],
      law: () => law as never,
      workspaceRootOf: () => workspace,
      configValue: () => undefined,
      warn: () => { /* the arms assert decisions, not warnings */ },
    })
    expect(installed.installed).toBe(true)
    /** The installed guard. */
    const guard = h.guards.at(-1)
    expect(guard).toBeDefined()
    /** A TOP-LEVEL mpd agent, in this workspace. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** THE DENIAL: a code write with no loop and no escape. */
    expect(String(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent }) ?? "")).toContain("verification law")
    // THE OTHER DIRECTION, on the SAME guard: a documentation write is never gated.
    expect(guard?.({ name: "write", arguments: { file_path: "docs/index.md" }, agent })).toBeUndefined()
    // A CHILD session is never the captain.
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent: { session: { id: "member", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } } })).toBeUndefined()
    // ARM A LOOP through the tool the row registered, then the SAME write is allowed.
    /** The `mpd_verify_open` tool. */
    const open = h.tools.find((tool) => tool.name === "mpd_verify_open")
    /** The arm's result. */
    const armed = await open?.execute({ writer: "self", verifier: "a-different-agent", self_write_reason: "only writer", scope: ["packages/a"] }, { agent }) as { refused?: string; loopId?: string }
    expect(armed.refused).toBeUndefined()
    expect(armed.loopId).toBeDefined()
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent })).toBeUndefined()
    rmSync(workspace, { recursive: true, force: true })
  })

  test("§5's one-git-writer rule through the INSTALLED guard: member denied, captain allowed", () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-git-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, { mode: "hard" })
    installVerifyGuard(h.stub as never, {
      presets: ["mpd"], law: () => h.services.get(VERIFY_SERVICE) as never, workspaceRootOf: () => workspace,
      configValue: () => undefined, warn: () => { /* the arms assert decisions, not warnings */ },
    })
    /** The installed guard. */
    const guard = h.guards.at(-1)
    // A MEMBER is a child session (`parentSession` set), so it is not the captain.
    const member = { session: { id: "member-session", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } }
    expect(String(guard?.({ name: "bash", arguments: { command: "git commit -m x" }, agent: member }) ?? "")).toContain("one-git-writer rule")
    // READ-ONLY GIT STAYS OPEN — the other direction on the same tool.
    expect(guard?.({ name: "bash", arguments: { command: "git status --short" }, agent: member })).toBeUndefined()
    // THE CAPTAIN MAY COMMIT: §5 makes the captain the ONE git writer, so the rule must not touch it.
    const captain = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    expect(guard?.({ name: "bash", arguments: { command: "git commit -m x" }, agent: captain })).toBeUndefined()
    rmSync(workspace, { recursive: true, force: true })
  })

  test("a self-writer loop without a reason or without a different verifier is REFUSED", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-open-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The `mpd_verify_open` tool. */
    const open = h.tools.find((tool) => tool.name === "mpd_verify_open")
    /** A top-level agent. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    expect(String((await open?.execute({ writer: "self", verifier: "other" }, { agent }) as { refused?: string })?.refused ?? "")).toContain("self_write_reason")
    expect(String((await open?.execute({ writer: "self", self_write_reason: "because" }, { agent }) as { refused?: string })?.refused ?? "")).toContain("requires `verifier`")
    rmSync(workspace, { recursive: true, force: true })
  })

  test("an escape is counted, logged and buys exactly one write", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-escape-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The law's runtime. */
    const law = h.services.get(VERIFY_SERVICE)
    installVerifyGuard(h.stub as never, {
      presets: ["mpd"], law: () => law as never, workspaceRootOf: () => workspace,
      configValue: () => undefined, warn: () => { /* not asserted here */ },
    })
    /** The installed guard. */
    const guard = h.guards.at(-1)
    /** The caller. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** The escape tool. */
    const escape = h.tools.find((tool) => tool.name === "mpd_verify_escape")
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeDefined()
    /** The escape's result. */
    const escaped = await escape?.execute({ reason: "the only writer is this session" }, { agent }) as { count?: number }
    expect(escaped.count).toBe(1)
    // ALLOWED ONCE, then DENIED AGAIN — the allowance is spent by the write it authorised.
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeUndefined()
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeDefined()
    /** The escape log, read back from the workspace the row wrote it into. */
    const log = await import("node:fs").then((fs) => fs.readFileSync(join(workspace, ".mpd", "verify", "escape.jsonl"), "utf8"))
    expect(log).toContain("the only writer is this session")
    rmSync(workspace, { recursive: true, force: true })
  })

  // AC-D1 — THE RESULT IS PLAIN LOSSLESS JSON, AND THE CALLER READS THE LOOP ID FROM IT.
  // Measured before the fix (D1): the `writer:"delegate"` branch projected `{ kind, id, reason: undefined }`,
  // and the harness's lossless walk refuses the WHOLE result over one own key whose value is `undefined`
  // (`tool "mpd_verify_open" returned invalid output: value is not lossless JSON`) — so the caller never
  // received the loop id and every later step had to read it off disk. EVERY model-visible result this
  // row produces is walked here, refusals and successes alike, because the harness walks them all.
  test("AC-D1: every mpd_verify_* result survives the harness's lossless-JSON walk, and the loop id comes back from the call", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-lossless-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    // The seat's `teamName` projection is one of the D1 suspects: make the membership REAL here rather
    // than absent, so the conditional projection is exercised on its present branch.
    h.stub.teamMembership = () => ({ teamId: "team-1", role: "teammate", name: "wave-3" })
    /** The top-level caller. */
    const captain = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** A DIFFERENT agent, the only one that may take a seat on the captain's loop. */
    const verifier = { session: { id: "verifier-session", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } }
    /** Every result this arm produced, in call order, so each is walked before it is asserted on. */
    const results: Array<{ label: string; value: unknown }> = []
    /** Call one tool and record its result for the walk. */
    const call = async (name: string, args: unknown, agent: unknown): Promise<unknown> => {
      /** The result the harness would have to accept. */
      const value = await toolOf(h.tools, name)?.execute(args, { agent })
      results.push({ label: name, value })
      return value
    }

    // THE REJECTED BRANCH: `writer:"delegate"` carries no `self_write_reason`, so the old projection put an
    // `undefined` under `writer.reason`. The key must be ABSENT — setting it to `undefined` is the defect.
    const delegated = await call("mpd_verify_open", { writer: "delegate" }, captain) as OpenResult
    expect(losslessViolation(delegated)).toBeUndefined()
    expect(delegated.refused).toBeUndefined()
    expect(Object.hasOwn(delegated.writer ?? {}, "reason")).toBe(false)
    // THE OTHER DIRECTION ON THE SAME BRANCH: a `self` writer keeps its reason, and its loop id.
    const selfOpened = await call("mpd_verify_open", { writer: "self", self_write_reason: "the only writer", verifier: "verifier-session" }, captain) as OpenResult
    expect(losslessViolation(selfOpened)).toBeUndefined()
    expect(selfOpened.writer?.reason).toBe("the only writer")
    // THE CALLER READS THE LOOP ID FROM THE RESULT, and it names a loop file that really exists on disk —
    // which is the whole point of the fix: nobody has to go and find it.
    expect(selfOpened.loopId).toBeDefined()
    expect(readLoops(workspace).map((loop) => loop.loopId)).toContain(String(selfOpened.loopId))
    // THE SEAT, whose `teamName` coalesce the D1 review flagged as a suspect, on its PRESENT branch.
    const bound = await call("mpd_verify_seat", { loop_id: selfOpened.loopId, role: "verifier" }, verifier) as SeatResult & { teamName?: string }
    expect(losslessViolation(bound)).toBeUndefined()
    expect(bound.teamName).toBe("wave-3")
    // THE ESCAPE, and the two tools whose SUCCESS shape needs a real run: both are walked as refusals here
    // (an unknown gate id, an empty probe, a bad verdict, an unknown loop), which is the same result path
    // the harness validates — a refusal that cannot be delivered is a refusal the caller never sees.
    await call("mpd_verify_escape", { reason: "the only writer is this session" }, captain)
    await call("mpd_verify_evidence", { kind: "gate", gate: "no-such-gate" }, verifier)
    await call("mpd_verify_evidence", { kind: "probe", paths: [] }, verifier)
    await call("mpd_verify_record", { loop_id: selfOpened.loopId, verdict: "MAYBE" }, verifier)
    await call("mpd_verify_record", { loop_id: "loop-does-not-exist", verdict: "PASS" }, verifier)
    for (const { label, value } of results) expect(label + ": " + String(losslessViolation(value))).toBe(label + ": undefined")
    rmSync(workspace, { recursive: true, force: true })
  })

  // AC-D2 — THE CONTRACT IS THE LOOP'S OWN, at all three sites the defect touched: the loop record, the
  // seat's `docPaths`, and the record's `basis.frozenContract` (plus the `pre-plugin` attestation sha,
  // which is compared against THAT path's bytes). A contract-less loop must take the DECLARED default.
  test("AC-D2: the seat's frozen docs are the LOOP's contract, and a contract-less loop gets the declared default", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-contract-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The top-level caller. */
    const captain = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** The agent that takes the seat. */
    const verifier = { session: { id: "verifier-session", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } }
    /** THIS wave's contract — not either member of the pair the seat used to be handed. */
    const contract = ".mpd/plans/verify-law-defects.md"
    // The contract must exist on disk: the record hashes it, and a hardcoded path that does not exist is
    // exactly how the wrong contract stayed invisible.
    mkdirSync(join(workspace, ".mpd", "plans"), { recursive: true })
    writeFileSync(join(workspace, contract), "# wave contract\n")

    /** The loop under verification, taken from the open result the caller now really receives. */
    const opened = await toolOf(h.tools, "mpd_verify_open")?.execute({ writer: "delegate", contract }, { agent: captain }) as OpenResult
    expect(opened.refused).toBeUndefined()
    expect(opened.contract).toBe(contract)
    // SITE 1 — the loop RECORDS it, so a seat binds against the loop rather than against module memory.
    expect(readLoops(workspace).find((loop) => loop.loopId === opened.loopId)?.contract).toBe(contract)
    // SITE 2 — the seat's docPaths ARE that contract, and nothing else.
    const bound = await toolOf(h.tools, "mpd_verify_seat")?.execute({ loop_id: opened.loopId }, { agent: verifier }) as SeatResult
    expect(bound.docs).toEqual([contract])
    expect(bound.docs?.join(" ")).not.toContain("de-vendor-and-verify-law")
    expect(bound.docs?.join(" ")).not.toContain("verify-law-spec")
    // ... and the seat FILE agrees with what the caller was told, because the guard reads THAT.
    expect(readSeats(workspace).seats?.["verifier-session"]?.docPaths).toEqual([contract])
    // The FAIL is the cheapest record that lands: a grounded finding needs no gate evidence, and it is
    // what turns the ratchet for AC-D4's arm later in this file.
    const failed = await toolOf(h.tools, "mpd_verify_record")?.execute({
      loop_id: opened.loopId, verdict: "FAIL",
      findings: [{ id: "F1", severity: "major", symptom: "the gate is red", expected: "green", doc_source: contract }],
    }, { agent: verifier }) as RecordResult
    expect(failed.verdict).toBe("FAIL")
    // SITE 3 — the record's OWN contract, read back AS THE BYTES ON DISK: the ledger's read-back view
    // deliberately omits `basis`, and the file is what a later reviewer opens.
    /** The record file the FAIL wrote, parsed from the workspace ledger. */
    const written = JSON.parse(readFileSync(join(workspace, ".mpd", "verify", "records", String(failed.recordId) + ".json"), "utf8")) as StoredRecord
    expect(written.basis?.frozenContract?.path).toBe(contract)
    expect((written.basis?.docs ?? []).map((doc) => doc.path)).toContain(contract)

    // THE CONTRACT-LESS LOOP: `contract: ""` normalises to nothing, so the loop file carries no field at
    // all — the shape an older revision wrote — and the DECLARED default applies instead.
    const second = await toolOf(h.tools, "mpd_verify_open")?.execute({ writer: "delegate", contract: "" }, { agent: captain }) as OpenResult
    expect(Object.hasOwn(readLoops(workspace).find((loop) => loop.loopId === second.loopId) ?? {}, "contract")).toBe(false)
    expect(second.contract).toBe(DEFAULT_CONTRACT_PATH)
    /** The seat re-bound against the CONTRACT-LESS loop. */
    const rebound = await toolOf(h.tools, "mpd_verify_seat")?.execute({ loop_id: second.loopId }, { agent: verifier }) as SeatResult
    expect(rebound.docs).toEqual([DEFAULT_CONTRACT_PATH])
    expect(DEFAULT_CONTRACT_PATH).not.toContain("verify-law")
    rmSync(workspace, { recursive: true, force: true })
  })

  // AC-D4 — THE RATCHET IS JUDGED FROM THE OBSERVATION LOG, driven end to end through the row's own tools
  // and the REAL guard, so the log's facts are produced by the shipped code rather than asserted into it.
  //
  // FOUR FIXTURES, each proving one property of the ruling:
  //   R1  an unlocked seat whose log is CLEAN is ADMITTED for a PASS (not merely "not refused");
  //   R3a `unlocked: false` + a logged read is still REFUSED — the LOG decides, not the flag;
  //   R2  a logged, ADMITTED read REFUSES the PASS with `blind-spent` and NAMES the path;
  //   R4  a REFUSED attempt does NOT spend the basis — otherwise proving the band's own refusal would
  //       spend the basis the PASS needs, and the law would defeat itself.
  test("AC-D4: a FAIL unlocks the seat, and the PASS is judged by the LOG — clean admits, an admitted read refuses by name, a refused attempt does not spend", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-ratchet-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The law's runtime, as the guard resolves it. */
    const law = h.services.get(VERIFY_SERVICE) as { observedImplementationReads: (sessionId: string) => readonly string[] }
    // THE REAL GUARD, installed exactly as the roles row installs it: the refused attempt below must be a
    // refusal the SHIPPED envelope produced, not one this arm wrote down.
    installVerifyGuard(h.stub as never, {
      presets: ["mpd"], law: () => h.services.get(VERIFY_SERVICE) as never, workspaceRootOf: () => workspace,
      configValue: () => undefined, warn: () => { /* the arms assert decisions, not warnings */ },
    })
    /** The installed guard. */
    const guard = h.guards.at(-1)
    /** The top-level caller (the loop's reader on a delegated loop). */
    const captain = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** The verifier seat, a DIFFERENT agent. */
    const verifier = { session: { id: "verifier-session", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } }
    /** The contract this loop freezes. */
    const contract = ".mpd/plans/verify-law-defects.md"
    /** An implementation path, refused while the seat is blind and admitted after the FAIL unlocks it. */
    const implementationPath = "packages/mpd-verify-plugin/src/law.ts"
    mkdirSync(join(workspace, ".mpd", "plans"), { recursive: true })
    writeFileSync(join(workspace, contract), "# wave contract\n")
    /** The loop under verification. */
    const opened = await toolOf(h.tools, "mpd_verify_open")?.execute({ writer: "delegate", contract }, { agent: captain }) as OpenResult
    await toolOf(h.tools, "mpd_verify_seat")?.execute({ loop_id: opened.loopId }, { agent: verifier })

    // R4 — A REFUSED ATTEMPT IS NOT A READ, and this fixture must come FIRST: it is only while the seat is
    // BLIND that the envelope refuses it the implementation. The guard really refuses this call, and the
    // log must not turn that refusal into a spent basis — otherwise an acceptance arm that demonstrates
    // the refusal (AC-D3's own `src/law.ts` case) would spend the basis the PASS needs, and the law would
    // defeat itself.
    expect(String(guard?.({ name: "read", arguments: { file_path: implementationPath }, agent: verifier }) ?? "")).toContain("verification law")
    expect(law.observedImplementationReads("verifier-session")).toEqual([])

    // THE FAIL, which turns the ratchet and unlocks this seat — the state the old rule treated as terminal.
    const failed = await toolOf(h.tools, "mpd_verify_record")?.execute({
      loop_id: opened.loopId, verdict: "FAIL",
      findings: [{ id: "F1", severity: "blocker", symptom: "the gate is red", expected: "green", doc_source: contract }],
    }, { agent: verifier }) as RecordResult
    expect(failed.verdict).toBe("FAIL")
    expect(readSeats(workspace).seats?.["verifier-session"]?.unlocked).toBe(true)
    // THE REFUSED ATTEMPT STILL SPENT NOTHING: the unlock happened, the log is still clean.
    expect(law.observedImplementationReads("verifier-session")).toEqual([])

    // R1 — THE LOG IS CLEAN, SO THE PASS IS NOT BARRED BY THE FLAG: the refusal that comes back is about
    // the missing GATE, not about the seat, which is the difference the flag-based rule could not express.
    const ungated = await toolOf(h.tools, "mpd_verify_record")?.execute({ loop_id: opened.loopId, verdict: "PASS", sources: [contract] }, { agent: verifier }) as RecordResult
    expect(ungated.refused?.reason).toBe("no-gate-evidence")
    // ... and with the gate the PASS needs, the SAME seat is ADMITTED — R1 is an admission, not an absence.
    const evidence = await toolOf(h.tools, "mpd_verify_evidence")?.execute({ kind: "gate", gate: "comments" }, { agent: verifier }) as EvidenceResult
    expect(evidence.evidenceId).toBeDefined()
    /** The PASS the clean-log seat was ADMITTED — R1 is an admission, never merely a missing refusal. */
    const admitted = await toolOf(h.tools, "mpd_verify_record")?.execute({
      loop_id: opened.loopId, verdict: "PASS", sources: [contract], evidence_ids: [evidence.evidenceId],
    }, { agent: verifier }) as RecordResult
    expect(admitted.refused).toBeUndefined()
    expect(admitted.verdict).toBe("PASS")

    // R2 + R3b — AN ADMITTED READ SPENDS THE BASIS. The seat is unlocked, so the SAME call is now admitted
    // and the log carries the path; the same PASS shape is refused with `blind-spent` NAMING the read.
    expect(guard?.({ name: "read", arguments: { file_path: implementationPath }, agent: verifier })).toBeUndefined()
    expect(law.observedImplementationReads("verifier-session")).toEqual([implementationPath])
    /** The SAME PASS shape, now refused because the log names an admitted implementation read. */
    const spent = await toolOf(h.tools, "mpd_verify_record")?.execute({
      loop_id: opened.loopId, verdict: "PASS", sources: [contract], evidence_ids: [evidence.evidenceId],
    }, { agent: verifier }) as RecordResult
    expect(spent.refused?.reason).toBe("blind-spent")
    expect(String(spent.refused?.detail)).toContain(implementationPath)
    expect(String(spent.refused?.detail)).toContain("observation log")
    // R3a cannot be driven from here — a seat that never unlocked cannot be ADMITTED a read by this very
    // envelope, which is R4's point — so the `unlocked:false` + logged-read direction is asserted at the
    // validator, where both inputs can be supplied honestly: `law.test.ts`'s AC-D4 arm refuses it.
    rmSync(workspace, { recursive: true, force: true })
  })
})
