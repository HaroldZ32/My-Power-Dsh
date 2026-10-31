// CELLWORK SPLIT — the refused verdict ON DISK (C9/D8) and the `member` field (C1/D10, validation half).
//
// Every arm drives the REAL `submitSplit` against a fresh temp workspace, so "the refusal left an
// artifact" is read back from the bytes the production writer stored, not from the returned object.
// The member arms are pure graph validation: they prove the two new finding codes, the resolved board
// name the verdict carries, and that `self-review` compares MEMBERS when both sides declare one.
import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { latestSplit, submitSplit, validateGraph, type SplitSubmission, type SplitTaskInput, type SplitVerdict } from "../src/split.ts"
import { refusedSplitPath, splitPath } from "../src/state.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { WindowReading } from "../src/budget.ts"

/** The cell id every arm uses; only the workspace differs per arm. */
const CELL_ID = "cell-split-refused"

/** The roster the graphs are validated against. */
const ROSTER: readonly string[] = ["Senior Engineer", "Deep Worker", "Reviewer"]

/** A CERTIFIED window large enough that a small task passes the 1/4 rule (never a guessed number). */
const CERTIFIED_WINDOW: WindowReading = { provider: "test", model: "test-model", window: 1000000, provenance: "catalog", maxOutputTokens: 8192 }

/** A fresh temp workspace root for one arm. */
function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "mpd-cellwork-split-"))
}

/**
 * Submit one graph through the production writer.
 *
 * @param workspace - the temp workspace the verdict is written under.
 * @param tasks - the graph to measure and validate.
 * @param revision - the requirements revision the submission targets.
 * @returns the persisted verdict.
 */
async function submit(workspace: string, tasks: readonly SplitTaskInput[], revision: number): Promise<SplitVerdict> {
  /** The submission a splitter would have sent. */
  const submission: SplitSubmission = { revision, tasks }
  return submitSplit({
    workspace,
    cellId: CELL_ID,
    config: DEFAULT_CELLWORK_CONFIG,
    roster: ROSTER,
    // The window reader answers the SAME certified reading for every role: this arm measures graph rules.
    window: async (): Promise<WindowReading> => CERTIFIED_WINDOW,
    now: new Date("2026-10-31T00:00:00.000Z"),
  }, submission)
}

/** One work task plus its review, owned by a DIFFERENT role: the minimal ACCEPTED graph. */
function acceptedGraph(): SplitTaskInput[] {
  return [
    { key: "work-a", subject: "Do the work", description: "Change one small thing.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/a.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "review-a", subject: "Review the work", description: "Blind review against the frozen contract.", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/a.md"], blockedBy: ["work-a"], independent: false, inputs: [], verify: false },
  ]
}

/** One task with an empty subject and NO dependency answer: TWO findings, so "full list" is provable. */
function refusedGraph(): SplitTaskInput[] {
  return [
    { key: "work-a", subject: "   ", description: "Change one small thing.", kind: "work", ownerRole: "Senior Engineer", writeScopes: [], blockedBy: undefined, independent: false, inputs: [], verify: false },
  ]
}

/** One otherwise-valid work task, kept inline so a member arm changes exactly one field. */
function taskWith(key: string, member: string, ownerRole: string, writeScope: string, blockedBy: readonly string[] = []): SplitTaskInput {
  return { key, subject: "Task " + key, description: "Do " + key + ".", kind: "work", ownerRole, member, writeScopes: [writeScope], blockedBy, independent: false, inputs: [], verify: false }
}

// ── C9 / D8: a refusal is an artifact, and an acceptance is immutable ─────────

test("C9: a REFUSED submission always writes split/<revision>.refused.json with the FULL finding list", async () => {
  /** A fresh workspace for this arm. */
  const workspace = tempWorkspace()
  /** The refused verdict. */
  const verdict = await submit(workspace, refusedGraph(), 1)
  /** The beside-path a refusal must take. */
  const refusedPath = refusedSplitPath(workspace, CELL_ID, 1)
  /** The canonical path only an ACCEPTANCE may use. */
  const canonical = splitPath(workspace, CELL_ID, 1)
  expect(verdict.accepted).toBe(false)
  expect(verdict.findings.length).toBe(2)
  expect(verdict.file).toBe(refusedPath)
  expect(existsSync(refusedPath)).toBe(true)
  // A refusal is NOT the accepted record of this revision: the canonical file stays absent.
  expect(existsSync(canonical)).toBe(false)
  /** The refusal document read back from the bytes on disk. */
  const persisted = JSON.parse(readFileSync(refusedPath, "utf8")) as SplitVerdict
  expect(persisted.accepted).toBe(false)
  expect(persisted.revision).toBe(1)
  expect(persisted.file).toBe(refusedPath)
  // THE FULL LIST, not a count: every code and sentence survives to disk.
  expect(persisted.findings).toEqual(verdict.findings)
  expect(persisted.findings.map((finding) => finding.code)).toContain("empty-subject")
  expect(persisted.findings.map((finding) => finding.code)).toContain("no-dependency-answer")
  expect(persisted.tasks.length).toBe(1)
})

test("C9: a refused resubmission leaves the ACCEPTED verdict byte-identical", async () => {
  /** A fresh workspace for this arm. */
  const workspace = tempWorkspace()
  /** The accepted first submission. */
  const accepted = await submit(workspace, acceptedGraph(), 1)
  /** The canonical accepted file. */
  const canonical = splitPath(workspace, CELL_ID, 1)
  /** The canonical bytes before the refusal, kept for byte identity. */
  const bytesBefore = readFileSync(canonical)
  expect(accepted.accepted).toBe(true)
  expect(accepted.file).toBe(canonical)
  /** The refused resubmission of the SAME revision. */
  const refused = await submit(workspace, refusedGraph(), 1)
  /** The beside-path that refusal took. */
  const refusedPath = refusedSplitPath(workspace, CELL_ID, 1)
  expect(refused.accepted).toBe(false)
  expect(refused.file).toBe(refusedPath)
  expect(existsSync(refusedPath)).toBe(true)
  // BYTE IDENTITY: a refusal never rewrites the accepted document.
  expect(readFileSync(canonical).equals(bytesBefore)).toBe(true)
  /** The refusal as persisted. */
  const persisted = JSON.parse(readFileSync(refusedPath, "utf8")) as SplitVerdict
  expect(persisted.accepted).toBe(false)
  expect(persisted.findings.length).toBe(2)
})

test("C9: an ACCEPTED submission writes the canonical file and leaves no refusal beside it", async () => {
  /** A fresh workspace for this arm. */
  const workspace = tempWorkspace()
  /** The accepted verdict. */
  const verdict = await submit(workspace, acceptedGraph(), 1)
  /** The canonical per-revision path. */
  const canonical = splitPath(workspace, CELL_ID, 1)
  expect(verdict.accepted).toBe(true)
  expect(verdict.findings).toEqual([])
  expect(verdict.file).toBe(canonical)
  expect(existsSync(canonical)).toBe(true)
  expect(existsSync(refusedSplitPath(workspace, CELL_ID, 1))).toBe(false)
})

test("C9: the LATEST verdict still names a refusal, and prefers the acceptance beside it", async () => {
  /** A fresh workspace for this arm. */
  const workspace = tempWorkspace()
  /** A refused-only submission: before the fix this was the canonical file, now it is the beside file. */
  const refusedOnly = await submit(workspace, refusedGraph(), 1)
  /** The latest read in the refused-only state. */
  const latestRefusal = latestSplit(workspace, CELL_ID)
  expect(latestRefusal?.revision).toBe(1)
  if (latestRefusal === null || !latestRefusal.read.ok) throw new Error("the refusal is not readable as the latest verdict")
  expect(latestRefusal.read.verdict.accepted).toBe(false)
  expect(latestRefusal.read.verdict.file).toBe(refusedOnly.file)
  // An acceptance at the same revision OUTRANKS a later refusal: the acceptance is the durable record.
  /** The accepted resubmission. */
  const accepted = await submit(workspace, acceptedGraph(), 1)
  await submit(workspace, refusedGraph(), 1)
  /** The latest read in the mixed state. */
  const latestMixed = latestSplit(workspace, CELL_ID)
  if (latestMixed === null || !latestMixed.read.ok) throw new Error("the accepted verdict is not readable as the latest verdict")
  expect(latestMixed.read.verdict.accepted).toBe(true)
  expect(latestMixed.read.verdict.file).toBe(accepted.file)
})

// ── C1 / D10: the member field (VALIDATION half) ─────────────────────────────

test("C1: a declared member is the resolved BOARD name, and several members may share one role", async () => {
  /** Two work tasks of ONE role raised for two DIFFERENT members: the parallelism D10 asked for. */
  const tasks: SplitTaskInput[] = [
    { key: "work-a", subject: "A", description: "Do A.", kind: "work", ownerRole: "Senior Engineer", member: "Seat A", writeScopes: ["src/a.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "work-b", subject: "B", description: "Do B.", kind: "work", ownerRole: "Senior Engineer", member: "Seat B", writeScopes: ["src/b.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "review-a", subject: "Review A", description: "Blind review of A.", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/a.md"], blockedBy: ["work-a"], independent: false, inputs: [], verify: false },
    { key: "review-b", subject: "Review B", description: "Blind review of B.", kind: "review", ownerRole: "Reviewer", writeScopes: ["docs/b.md"], blockedBy: ["work-b"], independent: false, inputs: [], verify: false },
  ]
  /** The accepted verdict. */
  const verdict = await submit(tempWorkspace(), tasks, 1)
  expect(verdict.findings).toEqual([])
  expect(verdict.accepted).toBe(true)
  // The verdict carries the RESOLVED member: the declared name, else the owner role. (The two reviews
  // declare no member, so both resolve to their role — one role, several seats is legal.)
  expect(verdict.tasks.map((task) => task.member)).toEqual(["Seat A", "Seat B", "Reviewer", "Reviewer"])
})

test("C1: member-invalid refuses an empty, overlong, control-character or path-separator name", () => {
  /** One task per invalid spelling plus a 64-character control; each scope is distinct to isolate member rules. */
  const tasks: SplitTaskInput[] = [
    taskWith("empty", "   ", "Senior Engineer", "src/empty.ts"),
    taskWith("long", "y".repeat(65), "Senior Engineer", "src/long.ts"),
    taskWith("control", "seat\u0001name", "Senior Engineer", "src/control.ts"),
    taskWith("slash", "seat/name", "Senior Engineer", "src/slash.ts"),
    taskWith("backslash", "seat\\name", "Senior Engineer", "src/backslash.ts"),
    taskWith("exact", "z".repeat(64), "Senior Engineer", "src/exact.ts"),
  ]
  /** The graph findings. */
  const findings = validateGraph(tasks, ROSTER)
  /** The task keys charged as member-invalid. */
  const invalid = findings.filter((finding) => finding.code === "member-invalid").map((finding) => finding.taskKey)
  expect(invalid).toEqual(["empty", "long", "control", "slash", "backslash"])
  // The boundary is INCLUSIVE: exactly 64 characters is a usable board name.
  expect(findings.some((finding) => finding.code === "member-invalid" && finding.taskKey === "exact")).toBe(false)
})

test("C1: member-role-conflict refuses ONE member declared under two different owner roles", () => {
  /** Two tasks naming the same member while declaring different roles: one seat, two jobs. */
  const conflicting: SplitTaskInput[] = [
    taskWith("a", "seat-1", "Senior Engineer", "src/a.ts"),
    taskWith("b", "seat-1", "Deep Worker", "src/b.ts", ["a"]),
  ]
  /** The graph findings. */
  const findings = validateGraph(conflicting, ROSTER)
  /** The conflict findings. */
  const conflicts = findings.filter((finding) => finding.code === "member-role-conflict")
  expect(conflicts.length).toBe(1)
  expect(conflicts[0].taskKey).toBe("a")
  expect(conflicts[0].detail).toContain("seat-1")
  expect(conflicts[0].detail).toContain("b")
  // A shared ROLE is legal: the same member under the same role twice is one seat, not a conflict.
  /** The same graph with both owner roles aligned. */
  const aligned: SplitTaskInput[] = [
    taskWith("a", "seat-1", "Senior Engineer", "src/a.ts"),
    taskWith("b", "seat-1", "Senior Engineer", "src/b.ts", ["a"]),
  ]
  expect(validateGraph(aligned, ROSTER).some((finding) => finding.code === "member-role-conflict")).toBe(false)
})

test("C1: same ROLE with DIFFERENT members is not self-review (two real seats)", () => {
  /** A work task and a review of it under the SAME role but two different declared members. */
  const tasks: SplitTaskInput[] = [
    { key: "work", subject: "A", description: "Do A.", kind: "work", ownerRole: "Senior Engineer", member: "Seat A", writeScopes: ["src/a.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "review", subject: "Review A", description: "Blind review of A.", kind: "review", ownerRole: "Senior Engineer", member: "Seat B", writeScopes: ["docs/a.md"], blockedBy: ["work"], independent: false, inputs: [], verify: false },
  ]
  /** The graph findings. */
  const findings = validateGraph(tasks, ROSTER)
  // The ROLE comparison alone would fire; comparing the declared MEMBERS is what keeps this legal.
  expect(findings.some((finding) => finding.code === "self-review")).toBe(false)
  expect(findings).toEqual([])
})

test("C1: self-review fires on the MEMBER when both sides declare one", () => {
  /** A review raised for the WORK's own member under a different role: only the member can make it self-review. */
  const tasks: SplitTaskInput[] = [
    { key: "work", subject: "A", description: "Do A.", kind: "work", ownerRole: "Senior Engineer", member: "Seat A", writeScopes: ["src/a.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "review", subject: "Review A", description: "Blind review of A.", kind: "review", ownerRole: "Reviewer", member: "Seat A", writeScopes: ["docs/a.md"], blockedBy: ["work"], independent: false, inputs: [], verify: false },
  ]
  /** The graph findings. */
  const findings = validateGraph(tasks, ROSTER)
  // The ROLES differ, so `self-review` can only come from the member comparison.
  expect(findings.some((finding) => finding.code === "self-review")).toBe(true)
  expect(findings.some((finding) => finding.code === "member-role-conflict")).toBe(true)
})

test("C1: with no member declared, self-review still compares the OWNER ROLE", () => {
  /** The pre-member shape: no `member` on either side, the review owned by the writer's own role. */
  const tasks: SplitTaskInput[] = [
    { key: "work", subject: "A", description: "Do A.", kind: "work", ownerRole: "Senior Engineer", writeScopes: ["src/a.ts"], blockedBy: [], independent: false, inputs: [], verify: true },
    { key: "review", subject: "Review A", description: "Blind review of A.", kind: "review", ownerRole: "Senior Engineer", writeScopes: ["docs/a.md"], blockedBy: ["work"], independent: false, inputs: [], verify: false },
  ]
  expect(validateGraph(tasks, ROSTER).some((finding) => finding.code === "self-review")).toBe(true)
})
