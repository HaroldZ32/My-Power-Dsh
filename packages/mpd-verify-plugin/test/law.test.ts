// THE VERIFICATION LAW'S OFFLINE PROOF — both directions, every refusal.
//
// This file is the DETERMINISTIC half of the QA evidence: the live boot case proves the row MOUNTS and
// that the harness really refuses a call, while these arms prove the DECISION the guard makes, for every
// branch, without a harness. A gate that only ever shows one direction is worth nothing, so every
// "denied" arm here has a sibling that shows the same shape being ALLOWED.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  captainWriteDecision,
  DEFAULT_CONTRACT_PATH,
  gitWriteSubcommand,
  gitWriterDecision,
  classifyWriteTarget,
  loopContractPath,
  normalizeContractPath,
  pathInScope,
  resolvePositiveInt,
  resolveVerifyMode,
  sessionKeyOf,
  verifierEnvelopeDecision,
} from "../src/law.ts"
import type { ArmedLoopView, EnvelopeDecision, VerifierSeatView } from "../src/law.ts"
import { buildRecord, REFUSAL, validateVerificationRecord } from "../src/record.ts"
import type { ValidationContext, VerificationRecord } from "../src/record.ts"
import { appendEscape, readEscapes, readLoops, writeLoop, writeSeats, readSeats, mintId, sha256File, verifyRoot } from "../src/ledger.ts"
import { GATE_TABLE, gateById, probeArtifacts } from "../src/gates.ts"
import { DEFAULT_LOOP_TTL_MS, readBootMarker, writeBootMarker } from "../src/tools.ts"

/** A fresh sandbox workspace under the OS temp dir — never the repository. */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "mpd-verify-law-"))
}

/** One armed SELF loop, written to a sandbox workspace, returned as the guard's view of it. */
function armedSelfLoop(workspace: string, sessionId: string, scope: string[] = []): ArmedLoopView {
  /** The loop id. */
  const loopId = mintId("loop")
  /** The instant the loop is opened. */
  const now = new Date()
  writeLoop(workspace, {
    version: 1, loopId, taskId: null, workspace, sessionId,
    writer: { kind: "self", id: sessionId, reason: "the captain is the only writer for this file" },
    verifier: { id: "reviewer-session" },
    scope, status: "armed", openedVia: "tool",
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEFAULT_LOOP_TTL_MS).toISOString(),
  })
  return { loopId, sessionId, status: "armed", writerKind: "self", writerId: sessionId, verifierId: "reviewer-session", scope, expiresAt: new Date(now.getTime() + DEFAULT_LOOP_TTL_MS).toISOString() }
}

/** A verifier seat for the envelope arms. */
function seat(unlocked: boolean): VerifierSeatView {
  return { loopId: "loop-1", verifierId: "verifier-session", unlocked, docPaths: [".mpd/plans/de-vendor-and-verify-law.md"] }
}

describe("path classification (asserted BOTH ways)", () => {
  /** The sandbox workspace every classification arm resolves against. */
  const ws = "/ws"
  test("code is gated: a declared extension, an UNKNOWN extension, and no extension at all", () => {
    expect(classifyWriteTarget(ws, "packages/a/src/index.ts").kind).toBe("code")
    expect(classifyWriteTarget(ws, "scripts/x.ts").kind).toBe("code")
    // FAIL-CLOSED: an extension nobody declared is code, because "an extension I did not think of" must
    // never be a way around the law.
    expect(classifyWriteTarget(ws, "packages/a/blob.wat").kind).toBe("code")
    expect(classifyWriteTarget(ws, "scripts/tool").kind).toBe("code")
    expect(classifyWriteTarget(ws, "Dockerfile").kind).toBe("code")
    expect(classifyWriteTarget(ws, "Makefile").kind).toBe("code")
  })
  test("the documentation band stays WRITABLE: the manual, the PR body, docs, evidence and .mpd", () => {
    expect(classifyWriteTarget(ws, "AGENTS.md").kind).toBe("always")
    expect(classifyWriteTarget(ws, "packages/mpd-verify-plugin/README.md").kind).toBe("always")
    expect(classifyWriteTarget(ws, "LICENSE-NOTICES.md").kind).toBe("always")
    expect(classifyWriteTarget(ws, "docs/index.md").kind).toBe("always")
    expect(classifyWriteTarget(ws, "evidence/verify-law/x/result.json").kind).toBe("always")
    expect(classifyWriteTarget(ws, "agent-references/index.md").kind).toBe("always")
    // THE RECORDS THEMSELVES: a guard that blocked `.mpd/verify/**` would stop the law from recording.
    expect(classifyWriteTarget(ws, ".mpd/verify/loops/x.json").kind).toBe("always")
    expect(classifyWriteTarget(ws, ".mpd/plans/de-vendor-and-verify-law.md").kind).toBe("always")
    expect(classifyWriteTarget(ws, "packages/a/docs/diagram.svg").kind).toBe("always")
  })
  test("a path outside the workspace root is CODE whatever it looks like", () => {
    expect(classifyWriteTarget(ws, "/etc/motd").kind).toBe("code")
    expect(classifyWriteTarget(ws, "/etc/motd").outside).toBe(true)
    expect(classifyWriteTarget(ws, "/ws/docs/note.txt").kind).toBe("always")
  })
  test("a non-string or absent path PASSES — the law never guesses", () => {
    expect(classifyWriteTarget(ws, undefined).kind).toBe("pass")
    expect(classifyWriteTarget(ws, "").kind).toBe("pass")
  })
  test("scope matching: empty scope is the whole workspace, a prefix covers its subtree only", () => {
    expect(pathInScope("packages/a/src/x.ts", [])).toBe(true)
    expect(pathInScope("packages/a/src/x.ts", ["packages/a"])).toBe(true)
    expect(pathInScope("packages/a/src/x.ts", ["packages/a/**"])).toBe(true)
    expect(pathInScope("packages/ab/src/x.ts", ["packages/a"])).toBe(false)
    expect(pathInScope("scripts/x.ts", ["packages/a"])).toBe(false)
  })
})

describe("the captain's write rule", () => {
  /** The captain's session key on every arm below. */
  const sessionId = "captain-session"

  test("a code write with NO loop, NO escape and NO delegation is DENIED", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The decision. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [], escapeUses: 0, now: new Date(),
    })
    expect(decision.allow).toBeUndefined()
    expect(decision.deny).toContain("verification law")
    // The denial NAMES THE THREE ROUTES: a gate whose way out is undocumented produces a stuck agent.
    expect(decision.deny).toContain("DELEGATE")
    expect(decision.deny).toContain("mpd_verify_open")
    expect(decision.deny).toContain("mpd_verify_escape")
    rmSync(ws, { recursive: true, force: true })
  })

  test("the SAME write is ALLOWED once an armed self-loop covers it (the other direction)", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The armed loop covering the write's path. */
    const loop = armedSelfLoop(ws, sessionId, ["packages/a"])
    /** The decision. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [loop], escapeUses: 0, now: new Date(),
    })
    expect(decision.deny).toBeUndefined()
    expect(decision.allow).toBe("loop")
    expect(decision.loopId).toBe(loop.loopId)
    rmSync(ws, { recursive: true, force: true })
  })

  test("a loop whose scope does NOT cover the path does not authorise it", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The armed loop this arm feeds the guard. */
    const loop = armedSelfLoop(ws, sessionId, ["packages/b"])
    /** The guard's decision for this call. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [loop], escapeUses: 0, now: new Date(),
    })
    expect(decision.deny).toBeDefined()
    rmSync(ws, { recursive: true, force: true })
  })

  test("a DELEGATE loop never authorises the captain — delegation is not a loophole", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The armed loop this arm feeds the guard. */
    const loop = { ...armedSelfLoop(ws, sessionId, []), writerKind: "delegate" as const }
    /** The guard's decision for this call. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [loop], escapeUses: 0, now: new Date(),
    })
    expect(decision.deny).toBeDefined()
    rmSync(ws, { recursive: true, force: true })
  })

  test("an EXPIRED loop authorises nothing", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The armed loop this arm feeds the guard. */
    const loop = { ...armedSelfLoop(ws, sessionId, []), expiresAt: new Date(Date.now() - 1000).toISOString() }
    /** The guard's decision for this call. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [loop], escapeUses: 0, now: new Date(),
    })
    expect(decision.deny).toBeDefined()
    rmSync(ws, { recursive: true, force: true })
  })

  test("a CHILD session is never the captain — that is where the writes are supposed to go", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The guard's decision for this call. */
    const decision = captainWriteDecision({
      toolName: "write", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId: "member-session", topLevel: false, loops: [], escapeUses: 0, now: new Date(),
    })
    expect(decision.deny).toBeUndefined()
    expect(decision.allow).toBe("always")
    rmSync(ws, { recursive: true, force: true })
  })

  test("a documentation path is NEVER gated, whatever the caller is", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    for (const path of ["AGENTS.md", "docs/index.md", "evidence/x/result.json", ".mpd/verify/boot.json"]) {
      expect(captainWriteDecision({
        toolName: "write", args: { file_path: path }, workspaceRoot: ws,
        sessionId, topLevel: true, loops: [], escapeUses: 0, now: new Date(),
      }).deny).toBeUndefined()
    }
    rmSync(ws, { recursive: true, force: true })
  })

  test("ONE escape authorises exactly ONE write, and the second is denied again", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    /** The allowance, spent by the arm below exactly the way the guard spends it. */
    let uses = 1
    /** The first decision. */
    const first = captainWriteDecision({
      toolName: "edit", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [], escapeUses: uses, now: new Date(),
    })
    expect(first.allow).toBe("escape")
    expect(first.consumesEscape).toBe(true)
    if (first.consumesEscape === true) uses -= 1
    /** The second decision, after the allowance was spent. */
    const second = captainWriteDecision({
      toolName: "edit", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [], escapeUses: uses, now: new Date(),
    })
    expect(second.deny).toBeDefined()
    rmSync(ws, { recursive: true, force: true })
  })

  test("the gated tool set is exactly the write family, and a read is never gated", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    for (const toolName of ["write", "edit", "mpd_hashline_edit", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan"]) {
      expect(captainWriteDecision({
        toolName, args: { file_path: "packages/a/src/index.ts", paths: ["packages/a/src/index.ts"] }, workspaceRoot: ws,
        sessionId, topLevel: true, loops: [], escapeUses: 0, now: new Date(),
      }).deny).toBeDefined()
    }
    expect(captainWriteDecision({
      toolName: "read", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws,
      sessionId, topLevel: true, loops: [], escapeUses: 0, now: new Date(),
    }).deny).toBeUndefined()
    rmSync(ws, { recursive: true, force: true })
  })
})

describe("the verifier's envelope", () => {
  /** The sandbox workspace. */
  const ws = "/ws"
  test("a non-seat caller is untouched: the envelope binds VERIFIERS, not everybody", () => {
    expect(verifierEnvelopeDecision({ toolName: "bash", args: {}, workspaceRoot: ws, seat: undefined }).deny).toBeUndefined()
  })
  test("bash and the source-returning tools are DENIED outright", () => {
    for (const toolName of ["bash", "powershell", "pwsh", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename", "mcp__codegraph__codegraph_explore"]) {
      expect(verifierEnvelopeDecision({ toolName, args: {}, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    }
  })
  test("board and team mutations are DENIED, but the law's OWN tools are not", () => {
    for (const toolName of ["agent_teams_plan", "agent_teams_dispatch", "mpd_role_spawn", "mpd_workmate_init"]) {
      expect(verifierEnvelopeDecision({ toolName, args: {}, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    }
    expect(verifierEnvelopeDecision({ toolName: "mpd_verify_evidence", args: { kind: "probe", paths: ["AGENTS.md"] }, workspaceRoot: ws, seat: seat(false) }).deny).toBeUndefined()
  })
  test("while BLIND: an implementation read is denied and a documented one is allowed", () => {
    expect(verifierEnvelopeDecision({ toolName: "read", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    expect(verifierEnvelopeDecision({ toolName: "read", args: { file_path: "docs/index.md" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeUndefined()
    expect(verifierEnvelopeDecision({ toolName: "read", args: { file_path: ".mpd/plans/de-vendor-and-verify-law.md" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeUndefined()
    expect(verifierEnvelopeDecision({ toolName: "grep", args: { path: "agent-references" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeUndefined()
  })
  test("a BARE read is denied while blind: it would search the workspace, implementation included", () => {
    expect(verifierEnvelopeDecision({ toolName: "glob", args: { pattern: "**/*.ts" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    expect(verifierEnvelopeDecision({ toolName: "grep", args: { pattern: "guard" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
  })
  test("after a FAIL the ratchet UNLOCKS implementation reading, COUNTED", () => {
    /** The unlocked seat's decision on an implementation read. */
    const decision = verifierEnvelopeDecision({ toolName: "read", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws, seat: seat(true) })
    expect(decision.deny).toBeUndefined()
    expect(decision.countedRead).toBe(true)
  })
  // AC-D3 — THE OPENED BAND, both directions on the SAME blind seat: the captain's ruling of 2026-10-07
  // admits a package's README pair and everything under `evidence/**`, and keeps every implementation
  // path refused. A widened band that also let `src/**` through would be a defect, not a ruling, so the
  // refusals are asserted beside the allowances.
  test("AC-D3: a BLIND seat may read a package README and evidence/**, and NOT src/**, test/** or a non-README package doc", () => {
    /**
     * The envelope's decision for one path, read by a BLIND seat in the sandbox workspace.
     *
     * @param path - the workspace-relative path the read names.
     * @returns the decision; `deny` is present exactly when the band refuses the path.
     */
    const blind = (path: string): EnvelopeDecision => verifierEnvelopeDecision({ toolName: "read", args: { file_path: path }, workspaceRoot: ws, seat: seat(false) })
    // ALLOWED: both README spellings, the evidence band's directory and a file inside it.
    expect(blind("packages/mpd-verify-plugin/README.md").deny).toBeUndefined()
    expect(blind("packages/mpd-verify-plugin/README.zh-CN.md").deny).toBeUndefined()
    expect(blind("evidence/gates/verify-law/20261007T000000Z/output.log").deny).toBeUndefined()
    expect(blind("evidence").deny).toBeUndefined()
    // REFUSED: the implementation, its tests, and a package document that is not the README pair.
    expect(blind("packages/mpd-verify-plugin/src/law.ts").deny).toBeDefined()
    expect(blind("packages/mpd-verify-plugin/test/law.test.ts").deny).toBeDefined()
    expect(blind("packages/mpd-verify-plugin/CHANGELOG.md").deny).toBeDefined()
    expect(blind("scripts/verify-law.ts").deny).toBeDefined()
    // AND THE README ALLOWANCE IS NOT A DOOR INTO A PACKAGE DIRECTORY: `grep` over `packages/a` would
    // search `src/**` on the way, so the package DIRECTORY stays outside the band.
    expect(verifierEnvelopeDecision({ toolName: "grep", args: { pattern: "guard", path: "packages/mpd-verify-plugin" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    // THE WIDENED BAND IS NOT A WAY OUT OF ITSELF: a spelling that starts inside an allowed band and walks
    // back out with a `..` is refused, on both a band this test opened and a band that predates it.
    expect(blind("evidence/../packages/mpd-verify-plugin/src/law.ts").deny).toBeDefined()
    expect(blind("docs/../packages/mpd-verify-plugin/src/law.ts").deny).toBeDefined()
    // The unlocked seat reads the same documents — the band widens what is a DOCUMENT, it is not a
    // blind-only gate, and it never turns a README into an implementation read.
    expect(verifierEnvelopeDecision({ toolName: "read", args: { file_path: "packages/mpd-verify-plugin/README.md" }, workspaceRoot: ws, seat: seat(true) }).deny).toBeUndefined()
  })
  test("writes are confined to .mpd/verify/**: a verifier never fixes what it found", () => {
    expect(verifierEnvelopeDecision({ toolName: "write", args: { file_path: ".mpd/verify/notes.txt" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeUndefined()
    expect(verifierEnvelopeDecision({ toolName: "edit", args: { file_path: "packages/a/src/index.ts" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
    expect(verifierEnvelopeDecision({ toolName: "write", args: { file_path: "docs/index.md" }, workspaceRoot: ws, seat: seat(false) }).deny).toBeDefined()
  })
})

// AC-D2 (the pure half) — THE CONTRACT IS THE LOOP'S, and the fallback is DECLARED rather than inherited
// from whichever wave ran last. The row-level arms in `row.test.ts` prove the seat and the record READ
// this resolution; these arms prove the resolution itself, including that the declared default is not a
// plan file at all.
describe("the loop's frozen contract (AC-D2)", () => {
  test("a loop's own contract wins, normalised to the workspace-relative POSIX spelling", () => {
    expect(loopContractPath({ contract: ".mpd/plans/verify-law-defects.md" })).toBe(".mpd/plans/verify-law-defects.md")
    expect(loopContractPath({ contract: "./.mpd/plans/tui-dag-highlight.md" })).toBe(".mpd/plans/tui-dag-highlight.md")
    expect(loopContractPath({ contract: "  .mpd/plans/x.md/  " })).toBe(".mpd/plans/x.md")
  })
  test("a contract-less loop falls back to the DECLARED default, which is never a wave's plan file", () => {
    // The loop file an older revision wrote, `undefined`, and a contract that normalises to nothing.
    expect(loopContractPath({})).toBe(DEFAULT_CONTRACT_PATH)
    expect(loopContractPath(undefined)).toBe(DEFAULT_CONTRACT_PATH)
    expect(loopContractPath({ contract: "" })).toBe(DEFAULT_CONTRACT_PATH)
    expect(loopContractPath({ contract: " . " })).toBe(DEFAULT_CONTRACT_PATH)
    // THE DEFECT THIS REPLACES: the compiled-in pair handed every wave the de-vendor wave's plan. The
    // declared default must not be a plan file at all, and must not name either member of that pair.
    expect(DEFAULT_CONTRACT_PATH.startsWith(".mpd/plans/")).toBe(false)
    expect(DEFAULT_CONTRACT_PATH).not.toContain("de-vendor-and-verify-law")
    expect(DEFAULT_CONTRACT_PATH).not.toContain("verify-law-spec")
  })
  test("normalizeContractPath refuses everything that is not a usable path", () => {
    expect(normalizeContractPath(undefined)).toBeUndefined()
    expect(normalizeContractPath("")).toBeUndefined()
    expect(normalizeContractPath(".")).toBeUndefined()
    expect(normalizeContractPath(42)).toBeUndefined()
    expect(normalizeContractPath("docs/")).toBe("docs")
  })
})

describe("the record validator: every refusal, and the admissible record beside it", () => {
  /** The sandbox workspace. */
  const ws = "/ws"
  /** A record that satisfies every rule, used as the base for each negative arm. */
  function goodRecord(): VerificationRecord {
    return buildRecord({
      loopId: "loop-1", taskId: null, workspace: ws, writerId: "writer-session", verifierId: "verifier-session",
      basis: { kind: "blind", frozenContract: { path: ".mpd/plans/de-vendor-and-verify-law.md", sha256: "abc" }, docs: [], probe: [] },
      sources: [{ path: "docs/feature-audit.md", sha256: "def" }],
      gateEvidence: [{ evidenceId: "ev-1", cmd: "bun test packages", exit: 0, logPath: ".mpd/verify/evidence/ev-1.log", logSha256: "aaa" }],
      verdict: "PASS", findings: [], unlockedReads: [],
    }, { recordId: "rec-1", createdAt: "2026-10-07T00:00:00.000Z" })
  }
  /** The context every arm starts from: the loop exists, the evidence was produced, the seat is fresh. */
  function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
    return { producedEvidenceIds: ["ev-1"], seatUnlocked: false, loopKnown: true, frozenContractSha: "abc", ...overrides }
  }
  test("the good record is ADMITTED (the arm every refusal is measured against)", () => {
    expect(validateVerificationRecord(goodRecord(), context()).ok).toBe(true)
  })
  test("same-agent: the verifier and the writer cannot be the same", () => {
    /** The record with its verifier pointed at its own writer. */
    const record = { ...goodRecord(), verifierId: "writer-session" }
    /** The decision under test, or its refusal. */
    const outcome = validateVerificationRecord(record, context())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe(REFUSAL.sameAgent)
  })
  test("no-doc-sources / no-gate-evidence: an empty PASS is refused", () => {
    /** The PASS with no documents. */
    const noDocs = validateVerificationRecord({ ...goodRecord(), sources: [] }, context())
    expect(noDocs.ok).toBe(false)
    if (!noDocs.ok) expect(noDocs.reason).toBe(REFUSAL.noDocSources)
    /** The PASS with no gates. */
    const noGates = validateVerificationRecord({ ...goodRecord(), gateEvidence: [] }, context())
    expect(noGates.ok).toBe(false)
    if (!noGates.ok) expect(noGates.reason).toBe(REFUSAL.noGateEvidence)
  })
  test("forged-evidence: an evidence id the runner never produced is refused", () => {
    /** The PASS citing an id outside the produced set. */
    const record = { ...goodRecord(), gateEvidence: [{ evidenceId: "ev-made-up", cmd: "bun test packages", exit: 0, logPath: "", logSha256: "" }] }
    /** The decision under test, or its refusal. */
    const outcome = validateVerificationRecord(record, context())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe(REFUSAL.forgedEvidence)
  })
  test("bind-unproven: a PASS from a seat the observation log cannot show to be blind is refused", () => {
    /** The PASS whose basis admits the observation disagreed. */
    const record = { ...goodRecord(), basis: { ...goodRecord().basis, kind: "unproven" as const } }
    /** The decision under test, or its refusal. */
    const outcome = validateVerificationRecord(record, context())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe(REFUSAL.bindUnproven)
  })
  test("fail-without-findings / finding-without-basis: a FAIL must be actionable AND grounded", () => {
    /** The FAIL with no findings. */
    const empty = validateVerificationRecord({ ...goodRecord(), verdict: "FAIL" as const, findings: [] }, context())
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe(REFUSAL.failWithoutFindings)
    /** The FAIL whose finding cites no document. */
    const unsupported = validateVerificationRecord({
      ...goodRecord(), verdict: "FAIL" as const,
      findings: [{ id: "F1", severity: "major", symptom: "the gate is red", expected: "green", docSource: "" }],
    }, context())
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.reason).toBe(REFUSAL.findingWithoutBasis)
    // AND THE OTHER DIRECTION: a FAIL with a grounded finding IS admitted, with no gates required.
    expect(validateVerificationRecord({
      ...goodRecord(), verdict: "FAIL" as const, sources: [], gateEvidence: [],
      findings: [{ id: "F1", severity: "blocker", symptom: "the gate is red", expected: "green", docSource: "docs/feature-audit.md" }],
    }, context()).ok).toBe(true)
  })
  // AC-D4 — THE RATCHET IS JUDGED FROM THE OBSERVATION LOG, in all three directions: an unlocked seat
  // with a CLEAN log may record the PASS; an unlocked seat whose log NAMES an implementation read may
  // not, and the refusal names it; and a FAIL is never barred by the rule (its own message says so).
  test("AC-D4 blind-spent: judged from the LOG — clean log admits the PASS, a logged read refuses it BY NAME", () => {
    // THE POSITIVE ARM: one FAIL already unlocked this seat, and its window was never used, so the log
    // shows no implementation read and the PASS is admissible.
    expect(validateVerificationRecord(goodRecord(), context({ seatUnlocked: true, loggedImplementationReads: [] })).ok).toBe(true)
    // The legacy shape of the context (the field simply absent) behaves the same way: a caller that does
    // not know about the log has shown no read, which is exactly "no logged read".
    expect(validateVerificationRecord(goodRecord(), context({ seatUnlocked: true })).ok).toBe(true)
    // THE NEGATIVE CONTROL: the plugin's own log names what it saw, and a PASS cannot rest on a spent
    // basis. The refusal must NAME the logged read — "it was refused" is the claim AC-D4 replaces.
    const spent = validateVerificationRecord(goodRecord(), context({
      seatUnlocked: true,
      loggedImplementationReads: ["packages/mpd-verify-plugin/src/record.ts"],
    }))
    expect(spent.ok).toBe(false)
    if (!spent.ok) {
      expect(spent.reason).toBe(REFUSAL.blindSpent)
      expect(spent.detail).toContain("packages/mpd-verify-plugin/src/record.ts")
      expect(spent.detail).toContain("observation log")
    }
    // A SEAT THAT NEVER UNLOCKED IS REFUSED TOO when its log shows a read: the rule is the READ, not the
    // flag, so removing the flag from the trigger cannot open a hole on the other side.
    const readBeforeVerdict = validateVerificationRecord(goodRecord(), context({ seatUnlocked: false, loggedImplementationReads: ["packages/a/src/index.ts"] }))
    expect(readBeforeVerdict.ok).toBe(false)
    if (!readBeforeVerdict.ok) expect(readBeforeVerdict.reason).toBe(REFUSAL.blindSpent)
    // THE OTHER DIRECTION ON THE VERDICT AXIS: the SAME spent seat may still record a FAIL, which is what
    // "it can only record further FAILs" always claimed and the flag-based rule never allowed.
    expect(validateVerificationRecord({
      ...goodRecord(), verdict: "FAIL" as const, sources: [], gateEvidence: [],
      findings: [{ id: "F1", severity: "blocker", symptom: "still red", expected: "green", docSource: "docs/feature-audit.md" }],
    }, context({ seatUnlocked: true, loggedImplementationReads: ["packages/a/src/index.ts"] })).ok).toBe(true)
  })
  test("unknown-loop: a record naming a loop this workspace does not know is refused", () => {
    /** The decision under test, or its refusal. */
    const outcome = validateVerificationRecord(goodRecord(), context({ loopKnown: false }))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe(REFUSAL.unknownLoop)
  })
  test("the pre-plugin exemption: admissible only attested, unlocked-free and pre-marker", () => {
    /** A `pre-plugin` PASS as the wave authors it. */
    const prePlugin = (): VerificationRecord => ({
      ...goodRecord(),
      basis: { kind: "pre-plugin" as const, attestation: "no-guard-in-process", frozenContract: { path: ".mpd/plans/de-vendor-and-verify-law.md", sha256: "abc" }, docs: [], probe: [] },
      // An id-less gate entry is the pre-plugin shape: provenance on disk, no runner to mint an id.
      gateEvidence: [{ cmd: "node scripts/verify-vendor.ts", exit: 0, logPath: "evidence/x/output.log", logSha256: "aaa" }],
    })
    // ADMITTED while no boot marker exists and the contract still matches.
    expect(validateVerificationRecord(prePlugin(), context({ loopKnown: false })).ok).toBe(true)
    // pre-plugin-unlocked: a diagnosis window is something the LIVE law opens.
    expect(validateVerificationRecord({ ...prePlugin(), unlockedReads: [{ path: "packages/a/src/x.ts", count: 1, afterRecordId: "rec-0" }] }, context({ loopKnown: false }))).toMatchObject({ ok: false, reason: REFUSAL.prePluginUnlocked })
    // pre-plugin-unattested: a missing attestation, and a contract that no longer matches disk.
    expect(validateVerificationRecord({ ...prePlugin(), basis: { ...prePlugin().basis, attestation: undefined } }, context({ loopKnown: false }))).toMatchObject({ ok: false, reason: REFUSAL.prePluginUnattested })
    expect(validateVerificationRecord(prePlugin(), context({ loopKnown: false, frozenContractSha: "MOVED" }))).toMatchObject({ ok: false, reason: REFUSAL.prePluginUnattested })
    // post-install-claim: the exemption closes the moment the law is live in the workspace.
    expect(validateVerificationRecord(prePlugin(), context({ loopKnown: false, bootInstalledAt: "2026-10-06T00:00:00.000Z" }))).toMatchObject({ ok: false, reason: REFUSAL.postInstallClaim })
  })
})

describe("the ledger and the gates", () => {
  test("an escape is counted from the LOG, so a restart cannot renumber it", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    expect(appendEscape(ws, "s1", "first")?.count).toBe(1)
    expect(appendEscape(ws, "s1", "second")?.count).toBe(2)
    expect(appendEscape(ws, "s2", "another session")?.count).toBe(1)
    expect(readEscapes(ws)).toHaveLength(3)
    rmSync(ws, { recursive: true, force: true })
  })
  test("loops and seats round-trip through the workspace ledger", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    armedSelfLoop(ws, "captain")
    expect(readLoops(ws)).toHaveLength(1)
    writeSeats(ws, { version: 1, seats: { "verifier-session": { loopId: readLoops(ws)[0].loopId, verifierId: "verifier-session", unlocked: false, docPaths: [] } } })
    expect(readSeats(ws).seats["verifier-session"].unlocked).toBe(false)
    rmSync(ws, { recursive: true, force: true })
  })
  test("the boot marker is written once and read back; an absent marker reads as undefined", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    expect(readBootMarker(ws)).toBeUndefined()
    expect(writeBootMarker(ws, "2026-10-07T12:00:00.000Z")).toBe(true)
    expect(readBootMarker(ws)).toBe("2026-10-07T12:00:00.000Z")
    expect(existsSync(verifyRoot(ws))).toBe(true)
    rmSync(ws, { recursive: true, force: true })
  })
  test("the gate table is a whitelist: every id resolves, an invented one does not, and `vendor` exists", () => {
    for (const entry of GATE_TABLE) expect(gateById(entry.id)?.cmd).toBe(entry.cmd)
    expect(gateById("rm -rf")).toBeUndefined()
    expect(gateById("vendor")?.cmd).toBe("node scripts/verify-vendor.ts")
  })
  test("the artifact probe returns size and hash and NEVER content, and refuses an outside path", () => {
    /** The sandbox workspace. */
    const ws = sandbox()
    mkdirSync(join(ws, "packages"), { recursive: true })
    writeFileSync(join(ws, "packages/a.ts"), "export const secret = 'do-not-return-me'\n", "utf8")
    /** The readings. */
    const readings = probeArtifacts(ws, ["packages/a.ts", "../../etc/hostname"])
    expect(readings[0].exists).toBe(true)
    expect(readings[0].sha256).toBe(sha256File(join(ws, "packages/a.ts")))
    expect(readings[0].bytes).toBe(41)
    expect(JSON.stringify(readings)).not.toContain("do-not-return-me")
    expect(readings[1].exists).toBe(false)
    rmSync(ws, { recursive: true, force: true })
  })
})

describe("config and identity", () => {
  test("verify.mode resolves to its three values, defaulting to hard", () => {
    expect(resolveVerifyMode(undefined)).toBe("hard")
    expect(resolveVerifyMode("HARD")).toBe("hard")
    expect(resolveVerifyMode("advisory")).toBe("advisory")
    expect(resolveVerifyMode("off")).toBe("off")
    expect(resolveVerifyMode("nonsense")).toBe("hard")
  })
  test("a positive-int knob falls back rather than accepting nonsense", () => {
    expect(resolvePositiveInt(5, 1)).toBe(5)
    expect(resolvePositiveInt("7", 1)).toBe(7)
    expect(resolvePositiveInt(0, 1)).toBe(1)
    expect(resolvePositiveInt(-3, 1)).toBe(1)
    expect(resolvePositiveInt("abc", 1)).toBe(1)
  })
  test("the session-key chain is the frozen `??` order with the `workspace` fallback", () => {
    expect(sessionKeyOf({ session: { id: "a" }, sessionId: "b", id: "c" })).toBe("a")
    expect(sessionKeyOf({ sessionId: "b", id: "c" })).toBe("b")
    expect(sessionKeyOf({ id: "c" })).toBe("c")
    expect(sessionKeyOf(undefined)).toBe("workspace")
    expect(sessionKeyOf({})).toBe("workspace")
  })
})

describe("the one-git-writer rule (§5, made mechanical)", () => {
  test("a MEMBER's git write is denied; the CAPTAIN's is allowed", () => {
    for (const command of ["git commit -m x", "git add -A", "git rm -q --cached packages/x.ts", "git checkout -b feature/x", "git stash", "git reset HEAD~1"]) {
      expect(gitWriterDecision({ command, topLevelCaptain: false })).toContain("one-git-writer rule")
      // THE OTHER DIRECTION on the SAME command: §5 binds everybody EXCEPT the captain.
      expect(gitWriterDecision({ command, topLevelCaptain: true })).toBeUndefined()
    }
  })
  test("read-only git stays open to everyone", () => {
    for (const command of ["git status", "git log --oneline -3", "git diff HEAD", "git show HEAD:x", "git grep guard", "git rev-parse HEAD", "git blame AGENTS.md"]) {
      expect(gitWriterDecision({ command, topLevelCaptain: false })).toBeUndefined()
    }
  })
  test("a command that merely MENTIONS git is NOT denied — a guard that reddens on prose is a defect", () => {
    for (const command of [
      'echo "git commit -m x"',
      'grep -rn "git commit" AGENTS.md',
      "cat <<'EOF'\ngit add -A\ngit commit\nEOF",
      "git log --grep=commit",
    ]) {
      expect(gitWriterDecision({ command, topLevelCaptain: false })).toBeUndefined()
    }
  })
  test("a chained invocation IS denied, and the wrapper forms are seen", () => {
    expect(gitWriteSubcommand("true && git commit -m x")).toBe("commit")
    expect(gitWriteSubcommand("cd /ws; git add -A")).toBe("add")
    expect(gitWriteSubcommand("sudo git commit -m x")).toBe("commit")
    expect(gitWriteSubcommand("git -C /ws commit -m x")).toBe("commit")
    expect(gitWriteSubcommand("ls && echo done")).toBeUndefined()
    // THE HONEST BOUND, asserted so it cannot be mistaken for a guarantee: an OBFUSCATED invocation
    // evades a string matcher, and the arm records that instead of pretending otherwise.
    expect(gitWriteSubcommand('g"it" commit -m x')).toBeUndefined()
  })
})
