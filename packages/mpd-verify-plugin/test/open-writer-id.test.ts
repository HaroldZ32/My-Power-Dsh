// C2 (D12) — `mpd_verify_open` may name the loop's REAL writer.
//
// THE DEFECT these arms pin: every activate-opened loop carried the literal `delegate:pending`, so the
// law's same-agent refusal could never fire and a PASS record could not name the agent that wrote the
// code. The two writer parameters are asserted from BOTH sides:
//   * HONOURED for a delegated loop — `writer_id` becomes the loop's `writer.id` (trimmed) and
//     `writer_reason` its `writer.reason`, so a record's writer seat is a REAL agent identity;
//   * REFUSED with `writer:"self"`, where either would contradict the loop's kind;
//   * and the ACCEPTANCE FLOW itself: a loop opened with `writer_id: <session S>` refuses a verdict
//     recorded BY session S (`same-agent`) and accepts the same verdict from a different session.
//
// Every arm runs in a temp workspace under the OS temp dir, never the repository root.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index"
import { readLoops, readRecords, sha256Text, writeEvidence } from "../src/ledger.ts"
import { createVerifyRuntime } from "../src/observe.ts"
import { DEFAULT_LOOP_TTL_MS, registerVerifyTools } from "../src/tools.ts"

/** The subset of any law tool's result these arms read; the record tool nests its refusal. */
interface ToolOutcome {
  /** The refusal, flat for most tools and `{reason, detail}` for the record tool. */
  refused?: string | { reason?: string; detail?: string }
  /** The minted loop id, for `mpd_verify_open`. */
  loopId?: string
  /** The writer seat as the caller sees it, for `mpd_verify_open`. */
  writer?: { kind: string; id: string; reason?: string }
  /** The verdict, for `mpd_verify_record`. */
  verdict?: string
}

/** A throwaway workspace plus the five registered law tools, keyed by name. */
function lawSandbox(): { workspace: string; tools: Map<string, DshToolDef> } {
  /** The sandbox root; nothing here can leak into the repository. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-open-"))
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
  return { workspace, tools: new Map(captured.map((definition) => [definition.name, definition])) }
}

/** One captured tool, refused loudly when registration itself broke. */
function toolNamed(tools: Map<string, DshToolDef>, name: string): DshToolDef {
  /** The definition, absent only when the registration is incomplete. */
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(name + " was not registered")
  return tool
}

/** Call one law tool as a named caller session. */
function callTool(tool: DshToolDef, args: Record<string, unknown>, sessionId: string): ToolOutcome {
  /** The call's execution object: `where()` reads the agent's session id from it. */
  const exec = { name: tool.name, arguments: args, agent: { session: { id: sessionId } } }
  return tool.execute(args, exec) as ToolOutcome
}

/** The refusal sentence of a tool result, whether flat or nested. */
function refusalOf(outcome: ToolOutcome): string {
  if (outcome.refused === undefined) return ""
  return typeof outcome.refused === "string" ? outcome.refused : String(outcome.refused.reason ?? "") + ": " + String(outcome.refused.detail ?? "")
}

/** Remove a sandbox and prove nothing of it survived. */
function cleanup(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true })
  expect(existsSync(workspace)).toBe(false)
}

/** The schema of one declared parameter, narrowed out of the definition's loose parameter record. */
function parameterSchema(tool: DshToolDef, name: string): Record<string, unknown> {
  /** The property map, empty when the definition carries no schema at all. */
  const properties = (tool.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
  return (properties[name] ?? {}) as Record<string, unknown>
}

describe("mpd_verify_open writer_id / writer_reason (C2 / D12)", () => {
  test("both parameters are DECLARED as optional strings, and the call stays strict", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The open definition. */
    const open = toolNamed(tools, "mpd_verify_open")
    expect(parameterSchema(open, "writer_id").type).toBe("string")
    expect(parameterSchema(open, "writer_reason").type).toBe("string")
    /** The schema's required list: neither new parameter may be forced. */
    const required = (open.parameters as { required?: unknown }).required
    expect(Array.isArray(required) ? required.includes("writer_id") || required.includes("writer_reason") : false).toBe(false)
    // `additionalProperties:false` is honest only while both keys are declared — that is the point above.
    expect((open.parameters as { additionalProperties?: unknown }).additionalProperties).toBe(false)
    cleanup(workspace)
  })

  test("a delegated loop stores the NAMED writer instead of the placeholder", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The call's result. */
    const result = callTool(toolNamed(tools, "mpd_verify_open"), { writer: "delegate", writer_id: "session-S", writer_reason: "member: Senior Engineer" }, "captain-session")
    expect(refusalOf(result)).toBe("")
    // THE RESULT AND THE LEDGER AGREE: a name the caller never sees in one of them is a name it cannot
    // rely on, and the record's same-agent refusal reads the LEDGER side.
    expect(result.writer?.kind).toBe("delegate")
    expect(result.writer?.id).toBe("session-S")
    /** The loops on disk. */
    const loops = readLoops(workspace)
    expect(loops).toHaveLength(1)
    expect(loops[0].writer.kind).toBe("delegate")
    expect(loops[0].writer.id).toBe("session-S")
    expect(loops[0].writer.reason).toBe("member: Senior Engineer")
    cleanup(workspace)
  })

  test("an ABSENT writer_id keeps today's `delegate:pending` placeholder", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The call's result: a delegated loop that names no writer. */
    const result = callTool(toolNamed(tools, "mpd_verify_open"), { writer: "delegate" }, "captain-session")
    expect(refusalOf(result)).toBe("")
    expect(result.writer?.id).toBe("delegate:pending")
    expect(readLoops(workspace)[0].writer.id).toBe("delegate:pending")
    cleanup(workspace)
  })

  test("writer:\"self\" REFUSES either writer parameter and writes no loop at all", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The open definition. */
    const open = toolNamed(tools, "mpd_verify_open")
    /** A self loop's mandatory fields, reused by both arms. */
    const selfBase = { writer: "self", self_write_reason: "the captain is the only writer", verifier: "reviewer-session" }
    /** A self loop that also names a writer id. */
    const namedId = callTool(open, { ...selfBase, writer_id: "session-S" }, "captain-session")
    /** A self loop that also names a writer reason. */
    const namedReason = callTool(open, { ...selfBase, writer_reason: "member: X" }, "captain-session")
    expect(refusalOf(namedId)).toContain("writer_id")
    expect(refusalOf(namedReason)).toContain("writer_reason")
    expect(readLoops(workspace)).toHaveLength(0)
    cleanup(workspace)
  })

  test("either parameter without writer:\"delegate\" is refused, because `self` is the default", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The open definition. */
    const open = toolNamed(tools, "mpd_verify_open")
    expect(refusalOf(callTool(open, { writer_id: "member-b" }, "captain-session"))).toContain("writer_id")
    expect(refusalOf(callTool(open, { writer_reason: "member: B" }, "captain-session"))).toContain("writer_reason")
    expect(readLoops(workspace)).toHaveLength(0)
    cleanup(workspace)
  })

  test("both values are TRIMMED, and an empty or over-long one is refused", () => {
    /** The sandbox and its open definition. */
    const { workspace, tools } = lawSandbox()
    /** The open definition. */
    const open = toolNamed(tools, "mpd_verify_open")
    /** The accepted call: stray whitespace is dropped, not stored as identity. */
    const padded = callTool(open, { writer: "delegate", writer_id: "  member-a  ", writer_reason: "  member: A  " }, "captain-session")
    expect(refusalOf(padded)).toBe("")
    expect(padded.writer?.id).toBe("member-a")
    expect(padded.writer?.reason).toBe("member: A")
    // THE SHAPE RULE: trimmed, non-empty, at most 200 characters — an id a report cannot spell is not an
    // identity a record can compare, and a reason a report cannot read is not one either.
    expect(refusalOf(callTool(open, { writer: "delegate", writer_id: "   " }, "captain-session"))).toContain("writer_id")
    expect(refusalOf(callTool(open, { writer: "delegate", writer_id: "" }, "captain-session"))).toContain("writer_id")
    expect(refusalOf(callTool(open, { writer: "delegate", writer_id: "x".repeat(201) }, "captain-session"))).toContain("writer_id")
    expect(refusalOf(callTool(open, { writer: "delegate", writer_reason: "  " }, "captain-session"))).toContain("writer_reason")
    expect(refusalOf(callTool(open, { writer: "delegate", writer_reason: "r".repeat(201) }, "captain-session"))).toContain("writer_reason")
    expect(refusalOf(callTool(open, { writer: "delegate", writer_id: "x".repeat(200), writer_reason: "r".repeat(200) }, "captain-session"))).toBe("")
    /** The loops on disk: exactly the two accepted calls, and no refused one. */
    const loops = readLoops(workspace)
    expect(loops).toHaveLength(2)
    // SORTED, because the ledger lists loop FILES by minted name (time + random suffix), so the
    // on-disk order is not the creation order and a positional assertion would be flaky.
    expect(loops.map((loop) => loop.writer.id).sort()).toEqual(["member-a", "x".repeat(200)].sort())
    cleanup(workspace)
  })

  test("ACCEPTANCE: a verdict from the LOOP'S OWN writer is refused `same-agent`, a different session's is accepted", () => {
    /** The sandbox and its tools. */
    const { workspace, tools } = lawSandbox()
    /** The document the verdict will cite. */
    writeFileSync(join(workspace, "wave.md"), "# wave contract\n", "utf8")
    /** The delegated loop, opened with the member's SESSION ID as its writer. */
    const opened = callTool(toolNamed(tools, "mpd_verify_open"), { writer: "delegate", writer_id: "session-S", writer_reason: "member: Senior Engineer", verifier: "verifier-X", contract: "wave.md" }, "captain-session")
    expect(refusalOf(opened)).toBe("")
    /** The loop id every later call names. */
    const loopId = String(opened.loopId)
    // THE EVIDENCE FIXTURE is the durable row a real gate run writes; running the gate itself is C3's
    // subject, so this arm seeds the row directly to keep the SAME-AGENT rule the only variable.
    expect(writeEvidence(workspace, {
      version: 1, evidenceId: "ev-fixture", loopId, kind: "gate", cmd: "bun test packages", exit: 0,
      at: new Date().toISOString(), logPath: ".mpd/verify/evidence/ev-fixture.log", logSha256: sha256Text("fixture log\n"),
    }, "fixture log\n")).toBe(true)
    /** The material both record calls share. */
    const verdictArgs = { loop_id: loopId, verdict: "PASS", sources: ["wave.md"], evidence_ids: ["ev-fixture"] }
    /** The verdict recorded BY the loop's writer: the law's independence rule must fire. */
    const sameAgent = callTool(toolNamed(tools, "mpd_verify_record"), verdictArgs, "session-S")
    expect(refusalOf(sameAgent)).toContain("same-agent")
    // THE OTHER DIRECTION, so the refusal above cannot pass by refusing everything: a genuinely
    // different session records the same verdict and it is stored.
    const independent = callTool(toolNamed(tools, "mpd_verify_record"), verdictArgs, "verifier-X")
    expect(refusalOf(independent)).toBe("")
    expect(independent.verdict).toBe("PASS")
    /** The stored record's two seats, which are the identities the law compares. */
    const records = readRecords(workspace)
    expect(records).toHaveLength(1)
    expect(records[0].verifierId).toBe("verifier-X")
    expect(records[0].writerId).toBe("session-S")
    /** The loop file's writer reason names the MEMBER, which is what a repair report reads. */
    expect(readLoops(workspace)[0].writer.reason).toBe("member: Senior Engineer")
    cleanup(workspace)
  })
})
