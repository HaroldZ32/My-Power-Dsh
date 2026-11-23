import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test, type TestContext } from "node:test"
import { fileURLToPath } from "node:url"
import { projectKey } from "../../skills/dsh-qa/scripts/lib/workspace-isolation.ts"
import { object, type Row } from "./input.ts"

/** Clock floor shared by the board and the replay fixtures. */
const begin = Date.parse("2026-11-23T00:00:00.000Z")
/** IDs come from distinct namespaces even though each is serialized as a string. */
const ids = { board: "team-fixture", cell: "cell-fixture", executor: "worker-executor", captain: "captain-executor", task: "T1" } as const
/** Resolve the exact CLI entry independently of the runner's current directory. */
const cli = fileURLToPath(new URL("./collect.ts", import.meta.url))

/** Own a fresh scratch directory for each control. */
function workspace(context: TestContext): string {
  /** Canonicalize the path exactly as the collector and harness will. */
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mpd-baseline-test-")))
  context.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Persist a producer-shaped fixture under the scratch workspace. */
function put(root: string, path: string, value: string | object): string {
  /** Never writes outside the test-owned root. */
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value) + "\n")
  return file
}

/** Exercise the normal CLI subprocess and require one JSON object on stdout. */
function run(root: string): Row {
  /** A literal Node launch also checks the repository's direct TypeScript invocation. */
  const result = object(JSON.parse(execFileSync("node", [cli, root], { encoding: "utf8" })))
  assert.ok(result)
  return result
}

/** Build a minimal native board with an open claim and a terminal excluded control. */
function board(): object {
  /** This is the currently captured task revision's own start/update time. */
  const at = new Date(begin).toISOString()
  return { version: 1, teamId: ids.board, leadSessionId: ids.captain,
    members: [{ id: "M1", name: "Worker", executorRef: ids.executor }],
    tasks: [
      { id: ids.task, status: "in_progress", owner: ids.executor, attempt: 2, revision: 5, startedAt: at, updatedAt: at },
      { id: "T2", status: "completed", owner: ids.executor, attempt: 1, revision: 4 },
    ] }
}

/** Create a native harness call and its explicitly settled result. */
function tool(callId: string, name: string, offset: number, args: Row, result: string, isError: boolean = false): readonly Row[] {
  /** The start and result bracket the matching watchdog PRE stamp. */
  const at = begin + offset
  return [
    { type: "tool/call", time: at, data: { name, callId, arguments: JSON.stringify(args) } },
    { type: "tool/result", time: at + 2, data: { message: { role: "tool", source: { kind: "tool", callId }, toolCallId: callId, isError, content: [{ type: "text", text: result }] } } },
  ]
}

/** Render records exactly as line-delimited JSON with a final newline. */
function jsonl(rows: readonly Row[]): string {
  return rows.map((row) => JSON.stringify(row) + "\n").join("")
}

/** Anchor the actor in the real workspace-keyed session layout. */
function session(root: string, actor: string, records: readonly Row[]): void {
  put(root, `.dsh/sessions/${projectKey(root)}/${actor}/session.v4.jsonl`, jsonl([
    { type: "session", version: 4, id: actor, cwd: root }, ...records,
  ]))
}

/** Record the task revision as the watchdog's generation token. */
function stamp(root: string, callId: string, name: string, offset: number, revision: string = "5"): Row {
  return { kind: "tool-start", callId, tool: name, at: begin + offset + 1, member: "Worker", workspace: root,
    teamId: ids.board, taskId: ids.task, attemptId: revision }
}

/** Read the single open assignment through the CLI output boundary. */
function openAssignment(report: Row): Row {
  /** The fixture's second row is terminal and must not appear here. */
  const assignments = object(report.workerLoss)?.assignments
  assert.ok(Array.isArray(assignments))
  assert.equal(assignments.length, 1)
  /** Keep unknown fields typed as such before checking their shape. */
  const assignment = object(assignments[0])
  assert.ok(assignment)
  return assignment
}

test("empty directories emit complete empty inventories", (context) => {
  /** No fixture producer runs for this arm. */
  const root = workspace(context)
  /** The public report exposes measured zero and no assignments. */
  const result = run(root)
  assert.deepEqual(result.teamRecords, { observed: 0, complete: true })
  assert.deepEqual(result.teamsPerCell, [])
  assert.deepEqual(object(result.workerLoss)?.assignments, [])
})

test("counts actual board links and deduplicates barrier companion events", (context) => {
  /** All fixture bytes must be unchanged by the CLI. */
  const root = workspace(context)
  put(root, `.mpd/team/teams/${ids.board}.json`, board())
  put(root, ".mpd/team/teams/unmatched.json", { version: 1, teamId: "unmatched", members: [], tasks: [] })
  put(root, `.mpd/cellwork/${ids.cell}/state.json`, { version: 1, cellId: ids.cell, teamId: ids.board })
  /** Old journals can omit the unrecoverable companion or contain a truncated line. */
  const at = new Date(begin).toISOString()
  /** Every journal event except the malformed tail is a known producer shape. */
  const text = jsonl([
    { at, event: "checkpoint" }, { at, event: "dispatch-reassign", claimed: 4, delivered: 3, rejected: 1 },
    { at, event: "compaction", outcome: "reseeded", member: "Worker", newHandle: ids.executor },
    { at, event: "member-reseeded", member: "Worker", newSessionId: ids.executor },
    { at, event: "compaction", outcome: "refused", member: "Worker", reason: "busy; the reseed failed: start refuser" },
    { at, event: "compaction", outcome: "refused", member: "Other", reason: "busy; reseed-parent-unavailable (no parent)" },
    { at, event: "checkpoint-unrecoverable", member: "Other", reason: "busy; reseed-parent-unavailable (no parent)" },
  ]) + "{\n"
  /** Track the exact journal bytes for the read-only assertion. */
  const journal = put(root, `.mpd/cellwork/${ids.cell}/journal.jsonl`, text)
  /** Partial counts can retain valid rows without asserting completeness. */
  const result = run(root)
  assert.equal(object(result.checkpoints)?.observed, 1)
  assert.equal(object(result.checkpoints)?.complete, false)
  assert.equal(object(result.reseedAttempts)?.observed, 2)
  assert.equal(object(result.reseedFailures)?.observed, 1)
  assert.equal(object(result.reseedRefusedBeforeSpawn)?.observed, 1)
  assert.equal(object(result.barrierOutcomes)?.observed, 3)
  assert.equal(object(result.dispatchReassignCalls)?.observed, 1)
  assert.equal(object(result.nonTerminalHandleOwnedRows)?.observed, 1)
  assert.deepEqual(result.unmatchedTeams, [{ teamId: "unmatched", cellRelation: "unknown" }])
  assert.equal(readFileSync(journal, "utf8"), text)
})

test("links a worker action, later handoff and subsequent captain observation", (context) => {
  /** Use full identity evidence and verify that result payload text is redacted. */
  const root = workspace(context)
  put(root, `.mpd/team/teams/${ids.board}.json`, board())
  session(root, ids.executor, [
    ...tool("action", "read", 1_000, {}, "private worker text"),
    ...tool("handoff", "cellwork_handoff", 2_000, { content: "private handoff body" }, JSON.stringify({ ok: true, member: "Worker", path: "handoff/Worker-1.md" })),
  ])
  session(root, ids.captain, tool("captain", "agent_teams_plan", 3_000, { action: "status" }, JSON.stringify({ team: board() })))
  put(root, ".mpd/team/watchdog/heartbeat/worker.jsonl", jsonl([stamp(root, "action", "read", 1_000), stamp(root, "handoff", "cellwork_handoff", 2_000)]))
  /** The report retains only attribution coordinates. */
  const result = run(root)
  /** All three receipts are independently attributable. */
  const assignment = openAssignment(result)
  assert.equal(object(assignment.lastSuccessfulAction)?.callId, "action")
  assert.equal(object(assignment.subsequentHandoffOrTerminal)?.callId, "handoff")
  assert.equal(object(assignment.nextCaptainObservation)?.callId, "captain")
  assert.doesNotMatch(JSON.stringify(result), /private (?:worker text|handoff body)/)
})

test("finds a typed v3 tool result after a non-result block", (context) => {
  /** Exercise the canonical project key with Unicode and whitespace. */
  const root = join(workspace(context), "legacy workspace 工作")
  put(root, `.mpd/team/teams/${ids.board}.json`, board())
  /** The legacy event wraps the typed result and precedes it with unrelated content. */
  const offset = 1_000
  put(root, `.dsh/sessions/${projectKey(root)}/${ids.executor}/session.v3.jsonl`, jsonl([
    { type: "session", version: 3, id: ids.executor, cwd: root },
    { type: "tool/call", time: begin + offset, data: { name: "read", callId: "legacy" } },
    { type: "tool/result", time: begin + offset + 2, data: { message: { content: [
      { type: "text", text: "unrelated block" },
      { type: "tool-result", toolCallId: "legacy", isError: false, content: [{ type: "text", text: "synthetic result" }] },
    ] } } },
  ]))
  put(root, ".mpd/team/watchdog/heartbeat/worker.jsonl", jsonl([stamp(root, "legacy", "read", offset)]))
  /** The matching watchdog and session receipts prove the same action. */
  const receipt = object(openAssignment(run(root)).lastSuccessfulAction)
  assert.equal(receipt?.callId, "legacy")
})

test("refuses pre-assignment, wrong-revision, stale-executor and non-success receipts", (context) => {
  /** The missing dispatch file must not erase the board's own time floor. */
  const root = workspace(context)
  put(root, `.mpd/team/teams/${ids.board}.json`, board())
  session(root, ids.executor, [
    ...tool("early", "read", -1, {}, "starts before the assignment; finishes after it"),
    ...tool("wrong-attempt", "read", 1_000, {}, "wrong revision"),
    ...tool("failed", "read", 2_000, {}, "denied", true),
    ...tool("wake", "cellwork_send", 3_000, {}, JSON.stringify({ ok: true })),
  ])
  session(root, "stale-executor", tool("stale", "read", 4_000, {}, "retired worker"))
  put(root, ".mpd/team/watchdog/heartbeat/worker.jsonl", jsonl([
    stamp(root, "early", "read", -1), stamp(root, "wrong-attempt", "read", 1_000, "2"),
    stamp(root, "failed", "read", 2_000), stamp(root, "wake", "cellwork_send", 3_000), stamp(root, "stale", "read", 4_000),
  ]))
  /** The valid current assignment survives with unknown progress. */
  const assignment = openAssignment(run(root))
  assert.equal(assignment.lastSuccessfulAction, "unknown")
  assert.equal(assignment.subsequentHandoffOrTerminal, "unknown")
  assert.equal(assignment.nextCaptainObservation, "unknown")
})

test("reports a linked session store without reading its files", (context) => {
  /** Create distinct scan and link-target roots so the target is outside the selected workspace. */
  const parent = workspace(context)
  /** Only this child is passed to the collector. */
  const root = join(parent, "scan")
  put(root, `.mpd/team/teams/${ids.board}.json`, board())
  /** The target exists, but input traversal must stop at the link itself. */
  const privateStore = join(parent, "external")
  put(privateStore, `sessions/${projectKey(root)}/${ids.executor}/session.v4.jsonl`, "private control bytes\n")
  symlinkSync(privateStore, join(root, ".dsh"), "dir")
  /** A denied root remains visible as a coverage problem and does not yield a receipt. */
  const result = run(root)
  assert.match(JSON.stringify(result.coverage), /"state":"unreadable"/)
  assert.doesNotMatch(JSON.stringify(result), /private control bytes|session\.v4\.jsonl/)
  assert.equal(openAssignment(result).lastSuccessfulAction, "unknown")
})
