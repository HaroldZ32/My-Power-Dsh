#!/usr/bin/env node
// docker/lib/live-verdict.ts — read a REAL model turn's verdict out of the harness's own session store.
//
// WHY THIS FILE EXISTS (AGENTS.md §7, "assert a REAL tool result, never just 'it ran'"): every
// Docker assertion before this one proved COMPOSITION or MOUNT — rows applied, tools registered,
// HTTP 200, a preset activated. None of them can observe what a model actually emitted, and the
// 2026-10-03 defect proved the gap: a turn died with
//     DeepSeek Messages stream: tool input is invalid JSON   (code MALFORMED_RESPONSE)
// while a credential-free Docker run reported 52/53 assertions passing and boot.llmTurn null.
// The failure leaves NO `tool/call` record — the harness aborts BEFORE the assistant message is
// committed (measured: 2962 recorded tool calls, 0 malformed, 1 dead turn) — so the ONLY durable
// witness is the `assistant/attempt` stream record plus the `turn/end` reason. This script reads both
// and turns them into the same NDJSON assertion rows the entrypoint's `record()` writes, so one
// reader serves the web plane, the TUI plane and the headless plane.
//
// USAGE
//   node live-verdict.ts --dsh-home <dir> --workspace <dir> --label <web|tui|headless>
//                        --state <assertions.ndjson> [--since <epochMs>] [--json]
//   node live-verdict.ts --self-test
//
// The container is a CONCATENATED-ZSTD-FRAME file: one `zstdDecompressSync` returns the header frame
// only, so frames are walked by zstd magic and decoded one at a time.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { zstdCompressSync, zstdDecompressSync } from "node:zlib"

/** zstd frame magic — the only reliable frame boundary in this container format. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** One assertion row, byte-identical in shape to what the entrypoint's `record()` appends. */
interface VerdictRow {
  /** Assertion name, e.g. `live.web.toolCallsParsed`. */
  readonly name: string
  /** true pass, false fail, null when the arm could not run (an unevaluated arm is never a pass). */
  readonly ok: boolean | null
  /** Human reason, so a failure needs no JSON digging. */
  readonly reason: string
  /** The observed value quoted beside the verdict. */
  readonly raw: string
}

/** Everything the reader measured about one session, before it is turned into assertion rows. */
interface LiveFacts {
  /** The session directory name the facts came from, or `<none>`. */
  readonly session: string
  /** `turn/start` count at or after `--since`. */
  readonly turnsStarted: number
  /** `turn/end` rows whose reason kind is `completed`. */
  readonly turnsCompleted: number
  /** Terminal turn failures: `turn/end` with reason kind `error`, as `code: message` strings. */
  readonly turnErrors: readonly string[]
  /** Tool-call blocks inside `assistant/attempt` streams whose assembled arguments do not parse. */
  readonly malformedToolBlocks: readonly string[]
  /** `tool/call` rows at or after `--since`. */
  readonly toolCalls: number
  /** How many of those `tool/call` rows carried arguments that parsed. */
  readonly toolCallsParsed: number
  /** Tools invoked, in call order, deduplicated — the names a human wants to see. */
  readonly toolNames: readonly string[]
  /** `assistant/message` rows carrying a non-empty text part. */
  readonly assistantTexts: number
}

/** One parsed session-store record; only the fields this reader reads are named. */
interface SessionRecord {
  /** Record type, e.g. `turn/end`. */
  readonly type?: string
  /** Event time in epoch milliseconds; absent on the header record. */
  readonly time?: number
  /** The record payload. */
  readonly data?: Record<string, unknown>
}

/** Read `--<flag> <value>` off the command line, or `fallback` when absent/valueless. */
function arg(flag: string, fallback: string = ""): string {
  /** Index of the flag token, or -1 when the caller never passed it. */
  const index = process.argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= process.argv.length ? fallback : process.argv[index + 1]
}

/** Decode a concatenated-zstd session container into its JSONL text; a torn tail frame is skipped. */
function decodeSessionContainer(file: string): string {
  /** The raw container bytes, walked frame by frame below. */
  const bytes = readFileSync(file)
  /** The decoded frame payloads, joined at the end. */
  const frames: string[] = []
  /** Where the next frame search starts. */
  let offset = 0
  while (offset < bytes.length) {
    /** The magic offset that opens this frame, or -1 when no frame follows. */
    const start = bytes.indexOf(ZSTD_MAGIC, offset)
    if (start < 0) break
    /** This frame's exclusive end, found by decoding candidate boundaries. */
    let end = bytes.length
    for (let probe = start + 4; probe + 4 <= bytes.length; probe++) {
      /** The next candidate magic; a boundary is real only when the frame decodes. */
      const next = bytes.indexOf(ZSTD_MAGIC, probe)
      if (next < 0) { end = bytes.length; break }
      try { zstdDecompressSync(bytes.subarray(start, next)); end = next; break } catch { probe = next - 1 }
    }
    if (end <= start) break
    try { frames.push(zstdDecompressSync(bytes.subarray(start, end)).toString("utf8")) } catch { /* torn frame while live */ }
    offset = end
  }
  return frames.join("")
}

/** The session header of one container, or undefined when the file carries none. */
function sessionHeader(file: string): { id?: string; cwd?: string; createdAt?: number; delegationDepth?: number } | undefined {
  for (const line of decodeSessionContainer(file).split("\n")) {
    if (!line.trim()) continue
    try {
      /** The parsed header candidate; only `type: "session"` rows are one. */
      const parsed = JSON.parse(line) as { type?: string; id?: string; cwd?: string; createdAt?: number; delegationDepth?: number }
      if (parsed.type === "session") return parsed
    } catch { /* a partially flushed line is not a header */ }
  }
  return undefined
}

/**
 * Whether a container carries ANY record at or after `since`.
 *
 * This is what makes one workspace safe to share between planes: the Web gateway, the TUI and a
 * headless run all create sessions in the same cwd, so "newest session" alone can pick a plane that
 * has been idle while the one under test is elsewhere. Preferring a session with post-`since`
 * activity pins the verdict to the plane that actually ran.
 *
 * @param file - The container path.
 * @param since - Epoch-millisecond floor.
 * @returns true when at least one record is at or after the floor.
 */
function hasRecordSince(file: string, since: number): boolean {
  for (const line of decodeSessionContainer(file).split("\n")) {
    if (!line.trim()) continue
    try {
      /** The parsed record; only its timestamp matters here. */
      const record = JSON.parse(line) as SessionRecord
      if ((record.time ?? 0) >= since) return true
    } catch { /* an unreadable line is not activity */ }
  }
  return false
}

/**
 * Pick the session container this verdict is about: the newest `createdAt` whose header cwd matches
 * the workspace, falling back to the newest overall when no workspace was named or none matched.
 *
 * @param dshHome - The DSH home whose `sessions/` tree is scanned.
 * @param workspace - The workspace cwd the session must have run in; empty accepts any.
 * @param since - Epoch-millisecond floor; when set, a session with post-floor activity is preferred.
 * @returns The chosen container path, or undefined when the store holds none.
 */
function pickSession(dshHome: string, workspace: string, since: number = 0): string | undefined {
  /** The `sessions/` root under the DSH home the caller named. */
  const root = join(dshHome, "sessions")
  if (!existsSync(root)) return undefined
  /** Every candidate, with the header facts the choice needs. */
  const candidates: Array<{ file: string; createdAt: number; cwd: string; depth: number }> = []
  for (const project of readdirSync(root)) {
    /** One project-key directory, e.g. `--home-user-proj--`. */
    const projectDir = join(root, project)
    if (!statSync(projectDir).isDirectory()) continue
    for (const session of readdirSync(projectDir)) {
      /** One session's container file. */
      const file = join(projectDir, session, "session.v4.jsonl.zstd")
      try { if (!statSync(file).isFile()) continue } catch { continue }
      /** The header, which carries the cwd and the creation time the pick orders on. */
      const header = sessionHeader(file)
      candidates.push({ file, createdAt: header?.createdAt ?? 0, cwd: header?.cwd ?? "", depth: header?.delegationDepth ?? 0 })
    }
  }
  /** Candidates in the named workspace, when one was named. */
  const matching = workspace === "" ? candidates : candidates.filter((candidate) => candidate.cwd === workspace)
  /** The pool the choice is made from: the matching set, else every candidate. */
  const pool = matching.length > 0 ? matching : candidates
  if (pool.length === 0) return undefined
  // TOP-LEVEL SESSIONS ONLY, when any exist. A live turn may SPAWN a teammate, and that teammate gets
  // its own session in the SAME workspace — newer than its parent, so a plain "newest session" pick
  // graded the teammate and reported the plane's state from the child (measured 2026-10-03: the
  // headless arms read `turns=1 completed=0 tools=0 texts=0` while the team record the same turn
  // produced carried a raised member). `delegationDepth` is the header's own top-level marker.
  const roots = pool.filter((candidate) => candidate.depth === 0)
  /** The pick's pool: the top-level set when it is non-empty, else everything. */
  const scoped = roots.length > 0 ? roots : pool
  /** Candidates that actually ran something after the floor — the plane under test, when known. */
  const active = since > 0 ? scoped.filter((candidate) => hasRecordSince(candidate.file, since)) : scoped
  /** The pool the pick is made from: the active set when it is non-empty, else every candidate. */
  const finalists = active.length > 0 ? active : scoped
  return finalists.reduce((best, candidate) => (candidate.createdAt >= best.createdAt ? candidate : best)).file
}

/**
 * Whether an `assistant/attempt` stream carries a tool-call block whose JSON does not parse.
 *
 * @param stream - The record's `stream` array as stored.
 * @returns One `tool(args)` label per malformed block; empty when every block parses.
 */
function malformedBlocks(stream: unknown): string[] {
  if (!Array.isArray(stream)) return []
  /** The malformed blocks found, each labelled with its tool name and byte count. */
  const found: string[] = []
  for (const element of stream) {
      /** The stream chunk being inspected (the record is untyped JSON). */
    const chunk = (element as { chunk?: { type?: string; block?: { type?: string; name?: string; arguments?: string } } }).chunk
      /** The tool-call block this stream element ends, when it is one. */
    const block = chunk?.block
    if (chunk?.type !== "block-end" || block?.type !== "tool-call") continue
    /** The assembled arguments string the harness tried to parse. */
    const args = block.arguments ?? ""
    try { JSON.parse(args) } catch (error) {
      found.push(`${block.name ?? "?"}(${Buffer.byteLength(args, "utf8")}B): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return found
}

/**
 * Fold one session container into the facts the assertions are derived from.
 *
 * @param file - The container path, or undefined when the store held no session.
 * @param since - Epoch milliseconds; records older than this are ignored (0 keeps everything).
 * @returns The measured facts.
 */
function collect(file: string | undefined, since: number): LiveFacts {
  /** The accumulator, defaulted so an empty store still answers every question. */
  const facts = {
    session: file === undefined ? "<none>" : (file.split("/").slice(-2)[0] ?? "<none>"),
    turnsStarted: 0,
    turnsCompleted: 0,
    turnErrors: [] as string[],
    malformedToolBlocks: [] as string[],
    toolCalls: 0,
    toolCallsParsed: 0,
    toolNames: [] as string[],
    assistantTexts: 0
  }
  if (file === undefined) return facts
  for (const line of decodeSessionContainer(file).split("\n")) {
    if (!line.trim()) continue
    /** The parsed record, still untyped until the fields below are read. */
    let record: SessionRecord
    try { record = JSON.parse(line) as SessionRecord } catch { continue }
    if (record.type === "session") continue
    if (since > 0 && (record.time ?? 0) < since) continue
    /** The record payload; an absent payload reads as an empty bag. */
    const data = record.data ?? {}
    if (record.type === "turn/start") { facts.turnsStarted++; continue }
    if (record.type === "turn/end") {
      /** The terminal reason the harness recorded. */
      const reason = data.reason as { kind?: string; error?: { code?: string; message?: string } } | undefined
      if (reason?.kind === "completed") facts.turnsCompleted++
      else if (reason?.kind === "error") facts.turnErrors.push(`${reason.error?.code ?? "<none>"}: ${reason.error?.message ?? "<none>"}`)
      continue
    }
    if (record.type === "assistant/attempt") { facts.malformedToolBlocks.push(...malformedBlocks(data.stream)); continue }
    if (record.type === "tool/call") {
      facts.toolCalls++
      /** The tool name the model invoked. */
      const name = String(data.name ?? "<unnamed>")
      if (!facts.toolNames.includes(name)) facts.toolNames.push(name)
      try { JSON.parse(String(data.arguments ?? "")); facts.toolCallsParsed++ } catch { /* counted by the parse arm */ }
      continue
    }
    if (record.type === "assistant/message") {
      /** The assistant message's content field, still untyped. */
      const content = (data.message as { content?: unknown } | undefined)?.content
      /** The message content parts, or an empty list for a message without any. */
      const parts = Array.isArray(content) ? content : []
      if (parts.some((part) => (part as { type?: string; text?: string }).type === "text" && ((part as { text?: string }).text ?? "").length > 0)) facts.assistantTexts++
    }
  }
  return facts
}

/**
 * Turn one session's facts into the assertion rows this plane must record.
 *
 * @param label - The plane under test (`web`, `tui`, `headless`), used as the assertion's middle segment.
 * @param facts - The measured facts.
 * @returns The rows, in a stable order, one per contract the live arm claims.
 */
function rowsFor(label: string, facts: LiveFacts): VerdictRow[] {
  /** The observed summary every row quotes, so a verdict can be re-read without the store. */
  const raw = `session=${facts.session} turns=${facts.turnsStarted} completed=${facts.turnsCompleted} errors=${facts.turnErrors.length} tools=${facts.toolCalls}/${facts.toolCallsParsed}parsed malformed=${facts.malformedToolBlocks.length} texts=${facts.assistantTexts} names=[${facts.toolNames.join(",")}]`
  return [
    { name: `live.${label}.turnStarted`, ok: facts.turnsStarted > 0, reason: facts.turnsStarted > 0 ? `the ${label} plane started a real turn` : `no turn/start was recorded for the ${label} plane after the prompt — the prompt never reached an agent`, raw },
    { name: `live.${label}.turnCompleted`, ok: facts.turnsCompleted > 0, reason: facts.turnsCompleted > 0 ? `the ${label} turn reached turn/end reason=completed` : `the ${label} turn never completed (completed=${facts.turnsCompleted})`, raw },
    { name: `live.${label}.noErrorTurns`, ok: facts.turnErrors.length === 0, reason: facts.turnErrors.length === 0 ? `no ${label} turn ended in an error` : `the ${label} plane had ${facts.turnErrors.length} failing turn(s)`, raw: `${raw} errors=[${facts.turnErrors.join(" | ")}]` },
    { name: `live.${label}.noMalformedToolJson`, ok: facts.malformedToolBlocks.length === 0 && !facts.turnErrors.some((error) => error.startsWith("MALFORMED_RESPONSE")), reason: facts.malformedToolBlocks.length === 0 ? `every ${label} tool-call payload the model emitted parsed as JSON` : `the model emitted ${facts.malformedToolBlocks.length} unparseable tool-call payload(s) on ${label}`, raw: `${raw} malformed=[${facts.malformedToolBlocks.join(" | ")}]` },
    { name: `live.${label}.toolCallsParsed`, ok: facts.toolCalls > 0 && facts.toolCallsParsed === facts.toolCalls, reason: facts.toolCalls === 0 ? `the ${label} turn called no tool, so the tool plane was never exercised` : `all ${facts.toolCalls} ${label} tool call(s) parsed (${facts.toolCallsParsed}/${facts.toolCalls})`, raw },
    { name: `live.${label}.mpdToolCalled`, ok: facts.toolNames.some((name) => name.startsWith("mpd_")), reason: facts.toolNames.some((name) => name.startsWith("mpd_")) ? `an MPD tool ran under a live ${label} turn` : `no mpd_* tool was called on ${label} — the bundle's own tool plane is unproven there`, raw },
    { name: `live.${label}.assistantReplied`, ok: facts.assistantTexts > 0, reason: facts.assistantTexts > 0 ? `the ${label} assistant produced visible text` : `the ${label} assistant produced no text`, raw }
  ]
}

/**
 * Every assertion name this reader can emit for a plane, in emission order.
 *
 * The names live HERE, once, so the null arm (no credential staged, plane skipped) can never drift
 * from the measured arm: a renamed assertion would otherwise silently stop being evaluated and be
 * reported as "not reached" instead of failing.
 *
 * @param label - The plane label used as the middle segment.
 * @returns The seven assertion names.
 */
function namesFor(label: string): string[] {
  return ["turnStarted", "turnCompleted", "noErrorTurns", "noMalformedToolJson", "toolCallsParsed", "mpdToolCalled", "assistantReplied"].map((suffix) => `live.${label}.${suffix}`)
}

/**
 * The rows recorded when the arm could not run at all (`ok: null`, never a silent pass).
 *
 * @param label - The plane label used as the middle segment.
 * @param reason - Why the arm did not run, quoted verbatim into every row.
 * @returns One null row per contract the arm would have claimed.
 */
function unavailableRows(label: string, reason: string): VerdictRow[] {
  return namesFor(label).map((name) => ({ name, ok: null, reason, raw: "not attempted" }))
}

/**
 * Whether the chosen session already carries a terminal turn at or after `since`.
 *
 * @param file - The container path, or undefined when the store held no session.
 * @param since - Epoch milliseconds the turn must be newer than.
 * @returns true when a `turn/end` row at or after `since` exists.
 */
function hasTurnEnd(file: string | undefined, since: number): boolean {
  if (file === undefined) return false
  for (const line of decodeSessionContainer(file).split("\n")) {
    if (!line.trim()) continue
    try {
      /** The parsed record, read only for its timestamp. */
      const record = JSON.parse(line) as SessionRecord
      if (record.type === "turn/end" && (record.time ?? 0) >= since) return true
    } catch { /* a partially flushed line is not a turn end */ }
  }
  return false
}

/**
 * Block until the chosen session carries a terminal turn, or the budget runs out.
 *
 * The poll is what keeps the shell caller simple: submit the prompt, then read the verdict, with the
 * waiting done where the store is already understood. A budget that expires is NOT an error — the
 * reader then reports whatever really happened (usually `turnStarted: false`), which is the honest
 * verdict for a prompt that never reached an agent.
 *
 * @param file - The container path to watch.
 * @param since - Epoch milliseconds the turn must be newer than.
 * @param budgetMs - How long to wait before giving up.
 * @returns true when a terminal turn was seen inside the budget.
 */
async function waitForTurnEnd(file: string | undefined, since: number, budgetMs: number): Promise<boolean> {
  /** The instant the wait gives up. */
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (hasTurnEnd(file, since)) return true
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return hasTurnEnd(file, since)
}

/** Append the rows in the entrypoint's own NDJSON shape and echo them the way `record()` does. */
function emit(rows: readonly VerdictRow[], stateFile: string): void {
  /** The escaped-JSON form of `text`, carrying no control characters into the state file. */
  const jsonEscape = (text: string): string => JSON.stringify(text).slice(1, -1)
  for (const row of rows) {
    if (stateFile !== "") appendFileSync(stateFile, `{"name":"${jsonEscape(row.name)}","ok":${row.ok === null ? "null" : row.ok},"reason":"${jsonEscape(row.reason)}","raw":"${jsonEscape(row.raw)}"}\n`)
    console.log(`[record] ${row.name}=${row.ok === null ? "null" : row.ok} — ${row.reason}`)
  }
}

// ── self-test: the arms that matter are the FAILING ones, so each is seeded deliberately ────────
/**
 * Write one synthetic session container holding `records`, and answer its path.
 *
 * @param root - The DSH home the fixture store is written under.
 * @param workspace - The cwd the synthetic session header carries.
 * @param records - The records to store, in order.
 * @param id - The session id (and directory name); defaults to one shared fixture id.
 * @param createdAt - The header creation time the picker orders on.
 * @param delegationDepth - The header's delegation depth (0 = top-level, >0 = a spawned teammate).
 * @returns The container path that was written.
 */
function fixtureSession(root: string, workspace: string, records: readonly unknown[], id: string = "session-fixture", createdAt: number = 1, delegationDepth: number = 0): string {
  /** The fixture session's own directory under the scratch store. */
  const dir = join(root, "sessions", "--fixture--", id)
  mkdirSync(dir, { recursive: true })
  /** The header row every container starts with. */
  const header = { type: "session", version: 4, id, createdAt, cwd: workspace, agentPreset: "mpd", delegationDepth }
  /** The container's JSONL text, header first. */
  const text = [header, ...records].map((row) => JSON.stringify(row)).join("\n") + "\n"
  writeFileSync(join(dir, "session.v4.jsonl.zstd"), zstdCompressSync(Buffer.from(text, "utf8")))
  return join(dir, "session.v4.jsonl.zstd")
}

/** Run the fixture-driven arms; a throw is a failed arm. */
function selfTest(): void {
  /** The scratch root the fixtures live under, removed on both ends of the run. */
  const root = mkdtempSync(join(tmpdir(), "mpd-live-verdict-"))
  /** A healthy turn: start, a parsing tool call, text, completed end. */
  const healthy = [
    { type: "turn/start", seq: 1, time: 10, data: { turn: 1 } },
    { type: "tool/call", seq: 2, time: 11, data: { name: "mpd_config_get", arguments: "{}" } },
    { type: "assistant/message", seq: 3, time: 12, data: { message: { role: "assistant", content: [{ type: "text", text: "DONE" }] } } },
    { type: "turn/end", seq: 4, time: 13, data: { turn: 1, reason: { kind: "completed" } } }
  ]
  /** The 2026-10-03 shape: a tool-call block whose arguments cannot parse, then a MALFORMED_RESPONSE end. */
  const malformed = [
    { type: "turn/start", seq: 1, time: 20, data: { turn: 1 } },
    { type: "assistant/attempt", seq: 2, time: 21, data: { stream: [{ type: "chunk", chunk: { type: "block-end", block: { type: "tool-call", name: "ask_user_question", arguments: "{\"a\": \"x\"y\"}" } } }] } },
    { type: "turn/end", seq: 3, time: 22, data: { turn: 1, reason: { kind: "error", error: { code: "MALFORMED_RESPONSE", message: "tool input is invalid JSON" } } } }
  ]
  /** A turn that ended in an error for an unrelated reason and called no tool. */
  const noTools = [
    { type: "turn/start", seq: 1, time: 30, data: { turn: 1 } },
    { type: "turn/end", seq: 2, time: 31, data: { turn: 1, reason: { kind: "error", error: { code: "MISSING_CREDENTIAL", message: "no key" } } } }
  ]
  /** Checks run, so a silent no-op arm cannot pass. */
  let checks = 0
  /** Assert one arm, printing the failing one loudly. */
  const check = (label: string, ok: boolean): void => { checks++; if (!ok) throw new Error(`self-test arm failed: ${label}`) }
  try {
    /** Healthy: every row must pass. */
    const healthyRows = rowsFor("web", collect(fixtureSession(join(root, "a"), "/ws/a", healthy), 0))
    check("healthy turn completes", healthyRows.every((row) => row.ok))
    check("healthy turn names the mpd tool", healthyRows.some((row) => row.name === "live.web.mpdToolCalled" && row.ok))
    /** Malformed: the JSON arms must redden while the turn still counts as started. */
    const malformedRows = rowsFor("tui", collect(fixtureSession(join(root, "b"), "/ws/b", malformed), 0))
    check("malformed payload reddens noMalformedToolJson", malformedRows.some((row) => row.name === "live.tui.noMalformedToolJson" && !row.ok))
    check("malformed payload reddens noErrorTurns", malformedRows.some((row) => row.name === "live.tui.noErrorTurns" && !row.ok))
    check("malformed payload reddens turnCompleted", malformedRows.some((row) => row.name === "live.tui.turnCompleted" && !row.ok))
    /** No tools: the tool-plane arm must redden. */
    const noToolRows = rowsFor("headless", collect(fixtureSession(join(root, "c"), "/ws/c", noTools), 0))
    check("a tool-less turn reddens toolCallsParsed", noToolRows.some((row) => row.name === "live.headless.toolCallsParsed" && !row.ok))
    check("a tool-less turn reddens mpdToolCalled", noToolRows.some((row) => row.name === "live.headless.mpdToolCalled" && !row.ok))
    /** The workspace selector must not pick another workspace's session. */
    const picked = pickSession(join(root, "c"), "/ws/c")
    check("the workspace selector picks the matching session", picked !== undefined && picked.includes("session-fixture"))
    check("an unknown workspace falls back to the newest session", pickSession(join(root, "c"), "/nope") !== undefined)
    /** `--since` must exclude older turns, so a stale healthy turn cannot mask a fresh failure. */
    const sinceRows = rowsFor("web", collect(fixtureSession(join(root, "d"), "/ws/d", healthy), 99))
    check("--since excludes older records", sinceRows.some((row) => row.name === "live.web.turnStarted" && !row.ok))
    // The MULTI-PLANE trap this reader exists to avoid: one workspace (the container's ws) is shared
    // by the Web gateway, the TUI and a headless run, so "newest session" can pick an IDLE plane while
    // the plane under test is elsewhere. `--since` must win over recency.
    /** A turn that ran AFTER the floor, in the OLDER-created session. */
    const activeRecords = [
      { type: "turn/start", seq: 1, time: 100, data: { turn: 1 } },
      { type: "turn/end", seq: 2, time: 101, data: { turn: 1, reason: { kind: "completed" } } }
    ]
    fixtureSession(join(root, "e"), "/ws/e", activeRecords, "session-old-active", 100)
    fixtureSession(join(root, "e"), "/ws/e", [{ type: "turn/start", seq: 1, time: 1, data: { turn: 1 } }], "session-new-idle", 500)
    /** The pick with a floor that only the older session satisfies. */
    const sincePick = pickSession(join(root, "e"), "/ws/e", 50)
    check("a since-active session outranks a newer idle one", sincePick !== undefined && sincePick.includes("session-old-active"))
    /** The same pick with no floor, which must fall back to recency. */
    const noSincePick = pickSession(join(root, "e"), "/ws/e", 0)
    check("without --since the newest session still wins", noSincePick !== undefined && noSincePick.includes("session-new-idle"))
    // The SPAWNED-TEAMMATE trap, measured 2026-10-03: the headless arm's turn approves a team plan,
    // which raises a member in its OWN session, newer than the parent and in the same workspace. A
    // plain "newest active" pick graded the teammate and reported the PLANE's state from the child
    // (`turns=1 completed=0 tools=0 texts=0`) while the parent had done all the work.
    fixtureSession(join(root, "f"), "/ws/f", activeRecords, "session-parent", 100, 0)
    fixtureSession(join(root, "f"), "/ws/f", [{ type: "turn/start", seq: 1, time: 200, data: { turn: 1 } }], "session-child", 600, 1)
    /** The pick when a newer child session shares the workspace. */
    const depthPick = pickSession(join(root, "f"), "/ws/f", 50)
    check("a spawned teammate's session never outranks its parent", depthPick !== undefined && depthPick.includes("session-parent"))
    console.log(`live-verdict self-test: ${checks} arms passed`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  /** The DSH home whose session store is read. */
  const dshHome = arg("dsh-home")
  /** The workspace cwd the session under test must have run in. */
  const workspace = arg("workspace")
  /** The plane label used in every assertion name. */
  const label = arg("label", "live")
  /** The NDJSON state file the rows are appended to; empty prints only. */
  const stateFile: string = arg("state")
  /** Epoch milliseconds before which records are ignored. */
  const since = Number(arg("since", "0"))
  /** The reason an arm could not run; when set, the null rows are emitted without touching the store. */
  const unavailable = arg("unavailable")
  /** How long to block for a terminal turn before measuring whatever is there (0 reads immediately). */
  const waitMs = Number(arg("wait", "0"))
  if (dshHome === "" && unavailable === "") {
    process.stderr.write("[live-verdict] usage: live-verdict.ts --dsh-home <dir> [--workspace <dir>] --label <name> [--state <file>] [--since <epochMs>] [--wait <ms>] [--json] | --unavailable <reason>\n")
    process.exit(2)
  }
  if (unavailable !== "") {
    emit(unavailableRows(label, unavailable), stateFile)
  } else {
    /** The epoch-millisecond floor every record is judged against. */
    const floor = Number.isFinite(since) ? since : 0
    /** The session this verdict is about, resolved once so the wait and the read agree. */
    const session = pickSession(dshHome, workspace, floor)
    if (Number.isFinite(waitMs) && waitMs > 0) {
      /** Whether the wait saw the turn land; the rows report the rest either way. */
      const landed = await waitForTurnEnd(session, floor, waitMs)
      console.log(`[live-verdict] wait=${waitMs}ms landed=${landed} session=${session ?? "<none>"}`)
    }
    /** The facts, measured once. */
    const facts = collect(session, floor)
    /** The rows derived from them. */
    const rows = rowsFor(label, facts)
    if (process.argv.includes("--json")) console.log(JSON.stringify({ label, facts, rows }, null, 2))
    else emit(rows, stateFile)
  }
}
