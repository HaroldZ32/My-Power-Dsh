// QA session-evidence helper: read what the HARNESS recorded, not what the model
// said about it.
//
// DEFECT this closes (measured 2026-09-14, `codegraph-smoke`): the case asserted
// the tool-name literal `/mcp__codegraph__codegraph_explore/` against the model's
// FINAL ANSWER TEXT. A run that really called the tool but reported its result
// without naming the tool then failed, while a run whose answer merely mentioned
// the tool name passed — the assertion measured narration, not the tool call. The
// harness's own session log carries the ground truth:
//
//   {"type":"tool/call",   "data":{"callId":"…","name":"mcp__codegraph__codegraph_explore","arguments":{…}}}
//   {"type":"tool/result", "data":{"message":{"content":[{"type":"tool-result","toolCallId":"…","isError":false,"content":[…]}]}}}
//
// TWO RESULT SHAPES must both be read, because the harness moved from v3 to v4 and a caller must not
// care which one wrote the store:
//   v3 `data.message.content[0] = {"type":"tool-result","toolCallId":…,"isError":…,"content":[{"type":"text",…}]}`
//   v4 `data.message           = {"role":"tool","toolCallId":…,"isError":…,"content":[{"type":"text","text":…}]}`
// v4 moved the call id, the error flag and the payload off the content BLOCK and onto the MESSAGE.
// Measured on a live v4 store (2026-10-09, this workspace, 42 `tool/result` records): `isError` present
// on 42/42 and `toolCallId` on every one, while `content[0].type` is `"text"`. Reading only v3 is a
// SILENT-WRONG-ANSWER defect, not a missing feature: the payload reads `""` (so `codegraph-smoke` and
// `mcp-call` recorded `resultChars: 0` against real, successful tool calls) and a call whose record
// says `isError: true` is reported `succeeded: true` — a FAILED call counted as evidence.
//
// (`lib/tool-call.js#appendToolCall` / `appendToolResult` in the installed
// harness; records land in `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/`).
//
// The store is a CONCATENATED-ZSTD-FRAME container (`session.v3.jsonl.zstd`): the
// harness appends one independently decodable frame per flush, so a single
// `zstdDecompressSync` call returns only the FIRST frame — the session header, no
// events. Measured on evidence/dsh-qa/codegraph/2026-09-14T14-45-59.644Z (10 frames,
// 1 record decoded naively vs 25 records decoded frame-by-frame). Frames are located
// with the same structure-only scan the harness itself uses
// (`dsh-session-persistence-jsonl` `scanZstdFrames`), and each frame is decompressed
// separately; plain JSONL (older builds) is read directly.
//
// Usage in a live case:
//   import { readSessionEvents, findToolCall } from "./lib/session-evidence.ts"
//   const store = readSessionEvents(sandbox, { workspace: sandboxWorkspace(sandbox) })
//   const ev = findToolCall(store.records, "mcp__codegraph__codegraph_explore")
//   if (!ev.succeeded) fail("…: " + ev.reason)
//
// A GC'd/absent store is an ERROR, never a silent skip: a case that cannot find
// its evidence must fail loudly, otherwise the assertion silently disengages.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { zstdCompressSync, zstdDecompressSync } from "node:zlib"
import { projectKey } from "./workspace-isolation.ts"

/** The little-endian `0xFD2FB528` Zstandard frame magic every frame must start with. */
const ZSTD_MAGIC: number = 4247762216

/** One decoded session-log line: a harness record whose fields are narrowed per read. */
export type SessionRecord = Record<string, unknown>

/** The half-open byte range of one complete frame inside the concatenated container. */
export interface ZstdFrameSpan {
  /** First byte of the frame, inclusive. */
  readonly start: number
  /** One past the frame's last byte. */
  readonly end: number
}

/** The structure-only frame scan's result, with a torn tail reported rather than dropped. */
export interface ZstdScanResult {
  /** Every complete frame, in file order. */
  readonly frames: ZstdFrameSpan[]
  /** Byte offset of an incomplete final frame (a crash mid-write), or absent when none. */
  readonly tornStart?: number
}

/** One decompressed session artifact. */
export interface DecodedSessionLog {
  /** The concatenated decoded text of every complete frame (or the plain JSONL bytes). */
  readonly text: string
  /** How many frames were decoded; `0` for a plain uncompressed artifact. */
  readonly frames: number
  /** Byte offset of an incomplete final frame, or `undefined` when none. */
  readonly tornStart: number | undefined
}

/** One session-store directory key and the directory it names. */
export interface SessionStoreKey {
  /** The project key (the directory name under `<DSH_HOME>/sessions`). */
  readonly key: string
  /** Absolute path of that key's directory. */
  readonly dir: string
}

/** One candidate session log file and its modification time. */
export interface SessionLogCandidate {
  /** Absolute path of the log file. */
  readonly file: string
  /** Its modification time in milliseconds, used to pick the newest store. */
  readonly mtimeMs: number
}

/** What `readSessionEvents` found, so a caller can fail with the actual cause. */
export interface SessionStore {
  /** Absolute path of the selected log, or `null` when the store held none. */
  readonly file: string | null
  /** Every record decoded from that log, in file order. */
  readonly records: SessionRecord[]
  /** How many session logs the store held in total. */
  readonly sessions: number
  /** How many zstd frames the selected log decoded (0 for plain JSONL). */
  readonly frames: number
  /** Byte offset of a torn final frame, or `undefined` when the container is complete. */
  readonly tornStart: number | undefined
  /** How many non-empty lines failed to parse as JSON, reported instead of hidden. */
  readonly undecodableLines: number
}

/** Optional selector for `readSessionEvents`. */
export interface ReadSessionEventsOptions {
  /** Restrict the search to this workspace's project-keyed store. */
  readonly workspace?: string
}

/** One `tool/call` record a harness session log carries. */
export interface RecordedToolCall {
  /** The harness call id, which pairs the call with its `tool/result`. */
  readonly callId: string | undefined
  /** The raw arguments object the harness recorded, unvalidated. */
  readonly arguments: unknown
}

/** The verdict `findToolCall` returns: the pairing plus a human-readable reason on failure. */
export interface ToolCallEvidence {
  /** The tool name that was searched for. */
  readonly name: string
  /** Whether any `tool/call` for that name was recorded. */
  readonly called: boolean
  /** Whether at least one of those calls has a non-error `tool/result`. */
  readonly succeeded: boolean
  /** Every recorded call id for that name, in record order. */
  readonly callIds: Array<string | undefined>
  /** Every recorded call for that name, with its raw arguments. */
  readonly calls: RecordedToolCall[]
  /** The joined text of every `tool/result` content block in the log. */
  readonly resultText: string
  /** Why the pairing failed (`""` when it succeeded). */
  readonly reason: string
}

/**
 * The value of one own property of a decoded JSON record, as `unknown`.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value, or `undefined` when `value` is not a non-null object.
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  // Narrowing above proves a non-null object; indexing by a dynamic key needs the record view.
  return (value as Record<string, unknown>)[key]
}

/**
 * The string at `key` of a decoded record.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is a string, else `undefined`.
 */
function stringFieldOf(value: unknown, key: string): string | undefined {
  // The raw property value, before the string test.
  const raw = fieldOf(value, key)
  return typeof raw === "string" ? raw : undefined
}

/**
 * The array at `key` of a decoded record.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is an array, else `undefined`.
 */
function arrayFieldOf(value: unknown, key: string): readonly unknown[] | undefined {
  // The raw property value, before the array test.
  const raw = fieldOf(value, key)
  return Array.isArray(raw) ? raw : undefined
}

/**
 * Whether one decoded record carries the given `type` discriminator.
 * @param record Any decoded record.
 * @param type The exact `type` string to match.
 * @returns `true` only for a record whose `type` equals the argument.
 */
function recordIs(record: unknown, type: string): boolean {
  return stringFieldOf(record, "type") === type
}

/**
 * Locate complete zstd frames in the harness's concatenated container without
 * decompressing them (ported from the installed harness's `scanZstdFrames`).
 * Returns `{ frames: [{start, end}], tornStart? }` — `tornStart` is an incomplete
 * final frame (a crash mid-write), which is reported rather than silently dropped.
 * @param buffer The raw container bytes.
 * @returns The complete frames plus the offset of a torn tail when one exists.
 * @throws When the bytes are not a valid Zstandard frame sequence.
 */
export function scanZstdFrames(buffer: Buffer): ZstdScanResult {
  // The complete frames found so far.
  const frames: ZstdFrameSpan[] = []
  // The cursor into the container, advanced block by block.
  let offset = 0
  while (offset < buffer.length) {
    // First byte of the frame currently being parsed, needed for a torn-tail report.
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error("corrupt session log: invalid Zstandard frame magic at byte " + offset)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    // The frame header descriptor byte: reserved bits, content-size flag, single-segment and
    // checksum flags, and the dictionary-id width all live here.
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error("corrupt session log: reserved frame-header bit at byte " + (offset - 1))
    // How many bytes encode the decompressed content size (0 = absent).
    const contentSizeFlag = descriptor >>> 6
    // Whether the frame is single-segment, which implies a one-byte content size.
    const singleSegment = (descriptor & 32) !== 0
    // Whether a 4-byte xxhash checksum trails the frame's blocks.
    const checksum = (descriptor & 4) !== 0
    // The dictionary-id width selector, where 3 means 4 bytes.
    const dictionaryFlag = descriptor & 3
    // The dictionary-id width in bytes.
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    // The content-size width in bytes, where flag 0 means one byte only for single-segment frames.
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    // Everything after the descriptor byte that still belongs to the frame header.
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      // The 3-byte little-endian block header: last-block bit, 2-bit type, 21-bit size.
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      // Whether this is the frame's final block.
      const lastBlock = (blockHeader & 1) !== 0
      // The block type: 0 raw, 1 RLE, 2 compressed, 3 reserved.
      const blockType = (blockHeader >>> 1) & 3
      // The block's declared size, which for an RLE block is the regenerated size.
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error("corrupt session log: reserved block type at byte " + (offset - 3))
      // The bytes this block actually occupies in the container.
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decode one session artifact: every zstd frame, or the plain JSONL bytes.
 * @param file Absolute path of the session log.
 * @returns The concatenated text, the frame count and any torn-tail offset.
 * @throws When a frame fails to decompress or this Node build has no zstd support.
 */
export function decodeSessionLog(file: string): DecodedSessionLog {
  // The artifact's raw bytes.
  const bytes = readFileSync(file)
  if (!file.endsWith(".zstd")) return { text: bytes.toString("utf8"), frames: 0, tornStart: undefined }
  if (typeof zstdDecompressSync !== "function") {
    throw new Error("session-evidence: this Node build has no zlib.zstdDecompressSync, cannot read " + file)
  }
  // The structure-only scan, which also reports a torn tail.
  const { frames, tornStart } = scanZstdFrames(bytes)
  // One decoded chunk per complete frame, joined at the end.
  const parts: string[] = []
  for (const frame of frames) {
    try {
      parts.push(zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString("utf8"))
    } catch (error) {
      throw new Error("session-evidence: frame at byte " + frame.start + " of " + file + " failed to decompress ("
        + (error instanceof Error ? error.message : String(error)) + ")")
    }
  }
  return { text: parts.join(""), frames: frames.length, tornStart }
}

/**
 * Every session-store directory key under `<dshHome>/sessions` (newest first).
 * @param dshHome The harness home whose session store is listed.
 * @returns One entry per directory-shaped key; empty when the store does not exist.
 */
function sessionKeys(dshHome: string): SessionStoreKey[] {
  // The `<DSH_HOME>/sessions` root, absent until a boot writes its first store.
  const root = join(dshHome, "sessions")
  if (!existsSync(root)) return []
  return readdirSync(root)
    .map((key) => ({ key, dir: join(root, key) }))
    .filter((e) => {
      try { return statSync(e.dir).isDirectory() } catch { return false }
    })
}

/**
 * Parse the newest session log under `dshHome`. With `workspace` given, only the
 * project-keyed store of THAT workspace is read (the workspace-isolation rule: a
 * QA boot must write its store under the sandbox workspace, so a miss is a real
 * isolation failure and is reported as one).
 * @param dshHome The harness home whose session store is read.
 * @param options Optional workspace selector.
 * @returns The selected log, its decoded records and the reader's own diagnostics.
 * @throws When a workspace was named and no store exists for it.
 */
export function readSessionEvents(dshHome: string, { workspace }: ReadSessionEventsOptions = {}): SessionStore {
  // Every project key present, before any workspace filter.
  const keys = sessionKeys(dshHome)
  // The project key to restrict to, or `null` for the newest store of any workspace.
  const wanted: string | null = workspace === undefined ? null : projectKey(workspace)
  // Every session directory that the selector admits.
  const candidates = (wanted === null ? keys : keys.filter((e) => e.key === wanted))
    .flatMap((e) => {
      // The session ids under this key; an unreadable store contributes none.
      let ids: string[] = []
      try { ids = readdirSync(e.dir) } catch { /* unreadable store */ }
      return ids.map((id) => join(e.dir, id))
    })
    .filter((dir) => {
      try { return statSync(dir).isDirectory() } catch { return false }
    })
  // Every candidate log file with its mtime, so the newest can be selected.
  const logs: SessionLogCandidate[] = []
  for (const dir of candidates) {
    for (const name of readdirSync(dir)) {
      if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
      // The absolute path of this candidate log file.
      const file = join(dir, name)
      try { logs.push({ file, mtimeMs: statSync(file).mtimeMs }) } catch { /* raced */ }
    }
  }
  logs.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.file < b.file ? 1 : -1))
  // How many logs the store held, which the caller records as evidence.
  const found = logs.length
  if (wanted !== null && found === 0) {
    throw new Error(
      "session-evidence: no session log for workspace " + workspace + " under " + join(dshHome, "sessions")
      + " (keys present: " + (keys.map((k) => k.key).join(", ") || "none") + ")"
      + " — either the boot wrote no store (assert the case's own isolation assertion) or the workspace path is wrong"
    )
  }
  // The selected log path, or `undefined` when the store held none.
  const file = logs[0]?.file
  // Every record decoded from the selected log.
  const records: SessionRecord[] = []
  // How many frames the selected log decoded.
  let frames = 0
  // Byte offset of a torn final frame, or `undefined` when the container is complete.
  let tornStart: number | undefined
  // How many non-empty lines failed to parse, reported rather than hidden.
  let undecodableLines = 0
  if (file !== undefined) {
    // The decoded artifact of the selected log.
    const decoded = decodeSessionLog(file)
    frames = decoded.frames
    tornStart = decoded.tornStart
    for (const line of decoded.text.split("\n")) {
      // One trimmed line, skipped when blank.
      const text = line.trim()
      if (text.length === 0) continue
      // The parsed record; `JSON.parse` is untyped, so the reader's own alias is asserted here.
      const parsed: unknown = JSON.parse(text)
      try { records.push(parsed as SessionRecord) } catch { undecodableLines += 1 }
    }
  }
  return { file: file ?? null, records, sessions: logs.length, frames, tornStart, undecodableLines }
}

/** What one `tool/result` record says about the call it answers, in whichever shape wrote it. */
interface RecordedToolResult {
  /** The id of the call this result answers: block-level in v3, message-level in v4. */
  readonly toolCallId: string | undefined
  /** Whether the harness flagged this result as an error: block-level in v3, message-level in v4. */
  readonly isError: boolean
  /** The joined text of the result's own content payload, `""` when it carries none. */
  readonly text: string
}

/**
 * Read one `tool/result` record in whichever session shape the harness wrote (see the header's two
 * shapes). The discriminator is the MESSAGE: v4 carries the tool facts (`toolCallId` / `isError`) there,
 * v3 carries them on a `tool-result` content block.
 * @param record Any decoded record; one that is not `tool/result`-shaped reads as an empty result.
 * @returns The call id, the error flag and the payload text, with absent fields reading `false`/`""`.
 */
function recordedResultOf(record: unknown): RecordedToolResult {
  // The record's message, which is where both shapes keep everything this reader needs.
  const message = fieldOf(fieldOf(record, "data"), "message")
  // The message's content blocks, empty when the record carries none.
  const blocks = arrayFieldOf(message, "content")
  // The joined payload text, filled from whichever shape this record uses.
  const parts: string[] = []
  // Whether the MESSAGE itself carries the tool facts, which is what makes this record v4.
  const messageCarriesResult = fieldOf(message, "toolCallId") !== undefined || fieldOf(message, "isError") !== undefined
  if (messageCarriesResult) {
    for (const block of blocks ?? []) {
      // A text block's own text, accepted only when it really is a string.
      const text = stringFieldOf(block, "text")
      if (text !== undefined) parts.push(text)
    }
    return {
      toolCallId: stringFieldOf(message, "toolCallId"),
      isError: fieldOf(message, "isError") === true,
      text: parts.join("\n"),
    }
  }
  // The v3 shape: the id, the flag and the payload all live on the `tool-result` content block.
  let toolCallId: string | undefined
  // The block-level error flag, false until a `tool-result` block sets it.
  let isError = false
  for (const block of blocks ?? []) {
    if (!recordIs(block, "tool-result")) continue
    if (fieldOf(block, "isError") === true) isError = true
    toolCallId = stringFieldOf(block, "toolCallId")
    for (const inner of arrayFieldOf(block, "content") ?? []) {
      // The inner block's text, accepted only when it really is a string.
      const text = stringFieldOf(inner, "text")
      if (text !== undefined) parts.push(text)
    }
  }
  return { toolCallId, isError, text: parts.join("\n") }
}

/**
 * Whether the harness recorded a `tool/call` for `name` and a non-error
 * `tool/result` for that same call id. Returns the call ids, the joined result
 * text and a human-readable `reason` when it did not happen — so a caller can
 * fail with the actual cause (never called / called and errored) rather than with
 * a bare boolean.
 * @param events Either the record array itself or a `SessionStore` carrying `records`.
 * @param name The exact tool name to look for.
 * @returns The pairing verdict, its call ids and the joined result text.
 */
export function findToolCall(events: SessionStore | readonly SessionRecord[], name: string): ToolCallEvidence {
  // The record list, whichever of the two accepted shapes the caller passed. The cast is needed
  // because `Array.isArray` cannot narrow a `readonly T[]` union member away, so the store arm is
  // asserted rather than narrowed; both call shapes are documented on this function's signature.
  const list: readonly SessionRecord[] = Array.isArray(events) ? events : (events as SessionStore).records
  // Every recorded `tool/call` for the requested name.
  const calls = list.filter((r) => recordIs(r, "tool/call") && stringFieldOf(fieldOf(r, "data"), "name") === name)
  // Call ids whose recorded result is an ERROR, which cannot count as evidence.
  const errored = new Set<string | undefined>()
  // The `tool/result` texts seen in the log, joined below.
  const texts: string[] = []
  for (const record of list) {
    if (!recordIs(record, "tool/result")) continue
    // This record's own result, read in whichever shape the harness wrote it (v3 block, or v4 message).
    const result = recordedResultOf(record)
    // Errors are keyed by CALL ID, so a failure pairs with its own call and can never taint another.
    if (result.isError) errored.add(result.toolCallId)
    // Only real payloads are joined in: an empty result contributes no separator to `resultText`.
    if (result.text.length > 0) texts.push(result.text)
  }
  // Every result text the log carried, newline-joined for a caller's substring assertions.
  const resultText = texts.join("\n")
  // The recorded calls that were never marked as errored, i.e. the real tool evidence.
  const okCalls = calls.filter((c) => !errored.has(stringFieldOf(fieldOf(c, "data"), "callId")))
  // Whether the tool was called at all.
  const called = calls.length > 0
  // Whether at least one call completed without an error result.
  const succeeded = okCalls.length > 0
  // The human-readable cause, empty on success.
  const reason = succeeded
    ? ""
    : called
      ? "the harness recorded " + calls.length + " call(s) to " + name + " but every recorded result is an ERROR"
      : "the harness recorded no tool/call for " + name + " (answer-only narration is not tool evidence)"
  return {
    name,
    called,
    succeeded,
    callIds: calls.map((c) => stringFieldOf(fieldOf(c, "data"), "callId")),
    calls: calls.map((c) => ({ callId: stringFieldOf(fieldOf(c, "data"), "callId"), arguments: fieldOf(fieldOf(c, "data"), "arguments") ?? null })),
    resultText,
    reason,
  }
}

/**
 * The tool names the HARNESS showed the model, read from the `request/header`
 * records (`data.header.tools[]`). This is the ground truth for "the session had
 * tool X available": a model that lists tool names in its answer can be wrong in
 * both directions, the request header cannot.
 * @param events Either the record array itself or a `SessionStore` carrying `records`.
 * @returns The distinct tool names the request headers offered, in encounter order.
 */
export function recordedToolNames(events: SessionStore | readonly SessionRecord[]): string[] {
  // The record list, whichever of the two accepted shapes the caller passed. The cast is needed
  // because `Array.isArray` cannot narrow a `readonly T[]` union member away, so the store arm is
  // asserted rather than narrowed; both call shapes are documented on this function's signature.
  const list: readonly SessionRecord[] = Array.isArray(events) ? events : (events as SessionStore).records
  // The distinct tool names seen, in first-encounter order.
  const names = new Set<string>()
  for (const record of list) {
    if (!recordIs(record, "request/header")) continue
    // The `data.header.tools` array of this header record, if it has one.
    const tools = arrayFieldOf(fieldOf(fieldOf(record, "data"), "header"), "tools")
    if (tools === undefined) continue
    for (const tool of tools) {
      // The tool's name, accepted only when it really is a string.
      const toolName = stringFieldOf(tool, "name")
      if (toolName !== undefined) names.add(toolName)
    }
  }
  return [...names]
}

// Standalone --self-test (offline): a synthetic session store proves the reader,
// the call/result pairing and the failure modes. The negative controls are the
// point — a store WITHOUT the call, and a call whose result is an error, must both
// report succeeded=false rather than pass silently.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  // The fixture-writing filesystem APIs, imported here so the helper's own import graph stays small.
  const { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } = await import("node:fs")
  // `tmpdir()` locates the fixture root portably.
  const { tmpdir } = await import("node:os")
  /** Report one failed self-test assertion and end the run with exit 1. */
  const fail = (msg: string): void => { console.error("[session-evidence self-test] FAIL: " + msg); process.exit(1) }
  /** The tool name every fixture call record uses. */
  const TOOL = "mcp__codegraph__codegraph_explore"
  // The fixture root every synthetic store lives under.
  const home = mkdtempSync(join(tmpdir(), "mpd-sess-ev-"))
  // The workspace whose project key the fixtures are stored under.
  const ws = join(home, "ws")
  // Explicit mtimes keep `newest session wins` deterministic (two fixtures written
  // in the same millisecond would otherwise race).
  /**
   * Write one synthetic session store.
   * @param id Session id, which becomes the store directory name.
   * @param batches One frame's records, or a list of frames.
   * @param options Compression, mtime and container-NAME knobs (the name carries the session version).
   * @returns The store directory that was written.
   */
  const writeStore = (id: string, batches: ReadonlyArray<ReadonlyArray<Record<string, unknown>>> | ReadonlyArray<Record<string, unknown>>, options: { zstd?: boolean; mtimeSec?: number; name?: string } = {}): string => {
    // The store directory this fixture occupies.
    const dir = join(home, "sessions", projectKey(ws), id)
    mkdirSync(dir, { recursive: true })
    // One frame PER BATCH, concatenated — the harness's own container layout, which
    // is what makes a naive single decompress return only the header (the defect this
    // self-test guards: `batches` of length > 1 must be fully decoded).
    const zstd = options.zstd ?? true
    // The frame list, normalised from the two accepted fixture shapes.
    const rows: ReadonlyArray<ReadonlyArray<Record<string, unknown>>> = Array.isArray(batches[0])
      // The caller passed a list of frames, which is already the shape the writer wants.
      ? batches as ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
      // The caller passed ONE frame of records; it is wrapped so every path writes frames.
      : [batches as ReadonlyArray<Record<string, unknown>>]
    // The concatenated container bytes, one compressed frame per batch.
    const bytes = Buffer.concat(rows.map((batch) => {
      // The newline-terminated JSONL body of this frame.
      const body = batch.map((l) => JSON.stringify(l)).join("\n") + "\n"
      return zstd ? zstdCompressSync(Buffer.from(body, "utf8")) : Buffer.from(body, "utf8")
    }))
    // The artifact path, named the way the harness names it for this fixture's session version.
    const file = join(dir, options.name ?? ("session.v3.jsonl" + (zstd ? ".zstd" : "")))
    writeFileSync(file, bytes)
    if (options.mtimeSec !== undefined) utimesSync(file, options.mtimeSec, options.mtimeSec)
    return dir
  }
  // The one recorded call every passing fixture pairs with a result.
  const callRecord: Record<string, unknown> = { type: "tool/call", seq: 2, data: { turn: 1, step: 1, callId: "c1", name: TOOL, arguments: { query: "norm" } } }
  /**
   * Build a `tool/result` record for the fixture call.
   * @param isError Whether the recorded result is an error.
   * @param text The inner text the result carries.
   * @returns The record to append to a fixture frame.
   */
  const resultRecord = (isError: boolean, text: string): Record<string, unknown> => ({
    type: "tool/result", seq: 3,
    data: { message: { content: [{ type: "tool-result", toolCallId: "c1", isError, content: [{ type: "text", text }] }] } }
  })
  /**
   * Build a v4 `tool/result` record for the fixture call: the id, the flag and the payload on the
   * MESSAGE, which is the shape the installed harness writes (field-for-field a live record).
   * @param isError Whether the recorded result is an error.
   * @param text The text the result's content block carries.
   * @returns The record to append to a fixture frame.
   */
  const v4ResultRecord = (isError: boolean, text: string): Record<string, unknown> => ({
    type: "tool/result", seq: 3,
    data: { message: { role: "tool", source: { kind: "tool", callId: "c1" }, toolCallId: "c1", isError, id: "m1", content: [{ type: "text", text }] } }
  })
  try {
    if (!existsSync(join(home, "sessions"))) mkdirSync(join(home, "sessions"), { recursive: true })
    // Positive control 0: a store with no logs at all.
    const empty = readSessionEvents(home)
    if (empty.records.length !== 0 || empty.file !== null) fail("an empty store must read as no records")
    // Negative control: naming a workspace with no store must throw, not return empty evidence.
    let threw = false
    try { readSessionEvents(home, { workspace: ws }) } catch { threw = true }
    if (!threw) fail("a missing workspace-keyed store must fail loudly, not return empty evidence")

    // MULTI-FRAME: the header in frame 1 and the call/result in later frames is the
    // real on-disk shape; a reader that stops at the first frame sees no tool call.
    writeStore("session-pass", [
      [{ type: "session", version: 3 }],
      [callRecord],
      [resultRecord(false, "1\texport function norm(x:number){return x<0?0:x}")],
    ], { mtimeSec: 1_000 })
    // The multi-frame store read back, which must decode every frame.
    const store = readSessionEvents(home, { workspace: ws })
    if (store.frames < 3) fail("the multi-frame fixture must be read as " + 3 + " frames, saw " + store.frames)
    if (store.records.length !== 3) fail("every frame's records must be decoded, saw " + store.records.length)
    if (store.tornStart !== undefined) fail("a complete container must not report a torn frame")
    // The pairing verdict of the passing fixture.
    const pass = findToolCall(store.records, TOOL)
    if (!pass.called || !pass.succeeded) fail("a recorded successful call must report succeeded=true")
    if (!pass.resultText.includes("norm")) fail("the result text must carry the returned content")
    if (JSON.stringify(recordedToolNames(store.records)) !== "[]") fail("a store without request/header must yield no tool names")

    // The recorded tool list is the ground truth for "tool X was available".
    writeStore("session-tools", [[
      { type: "session", version: 3 },
      { type: "request/header", seq: 1, data: { header: { tools: [{ name: "read" }, { name: TOOL }] } } },
      callRecord,
      resultRecord(false, "norm"),
    ]], { mtimeSec: 1_500 })
    // The tool names the newer `request/header` fixture offered.
    const tools = recordedToolNames(readSessionEvents(home, { workspace: ws }).records)
    if (tools.length !== 2 || !tools.includes(TOOL) || !tools.includes("read")) fail("recordedToolNames must read data.header.tools[], saw " + JSON.stringify(tools))

    writeStore("session-newer-no-call", [{ type: "session", version: 3 }], { mtimeSec: 2_000 })
    // Negative control: the NEWEST store has no call, so the verdict must be false with a reason.
    const noCall = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (noCall.called || noCall.succeeded) fail("the newest store without the call must report succeeded=false")
    if (!noCall.reason.includes("no tool/call")) fail("the no-call reason must name the missing record")

    // The plain (uncompressed) fixture store, whose call result is an ERROR.
    const dir = writeStore("session-plain-errored", [callRecord, resultRecord(true, "boom")], { zstd: false, mtimeSec: 3_000 })
    // Negative control: a called-and-errored tool must not count as evidence.
    const errored = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (errored.succeeded) fail("an errored result must report succeeded=false")
    if (!errored.called) fail("an errored result is still a recorded call")
    if (!errored.reason.includes("ERROR")) fail("the errored reason must say the recorded result is an error")
    if (!existsSync(join(dir, "session.v3.jsonl"))) fail("the plain (uncompressed) store fixture was not written")

    // V4 POSITIVE ARM: the shape the installed harness really writes. Reading only v3 left every v4
    // payload as "" and is exactly why a real, successful `mcp__ast_grep__search` call was recorded
    // `ok:false, resultChars:0` in evidence/dsh-qa/mcp-call/2026-09-27T23-25-27.334Z.
    const v4dir = writeStore("session-v4", [
      [{ type: "session", version: 4 }],
      [callRecord],
      [v4ResultRecord(false, "return 0;")],
    ], { mtimeSec: 3_100, name: "session.v4.jsonl.zstd" })
    // The v4 fixture's pairing verdict, which must find the call AND its payload text.
    const v4 = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (!v4.called || !v4.succeeded) fail("a v4 store's successful call must report succeeded=true")
    if (v4.resultText !== "return 0;") fail("a v4 store's tool-result TEXT must be returned non-empty, saw " + JSON.stringify(v4.resultText))
    if (!existsSync(join(v4dir, "session.v4.jsonl.zstd"))) fail("the v4 fixture was not written under the v4 store name")

    // V4 NEGATIVE CONTROL: the SAME payload text with the message-level `isError: true` must never read
    // as success. This arm fails when a reader takes the payload but ignores the flag — the defect that
    // let a failed call be reported as "made and recorded". The text stays non-empty on purpose, so the
    // flag is the only variable between this store and the positive arm above.
    writeStore("session-v4-errored", [
      [{ type: "session", version: 4 }],
      [callRecord],
      [v4ResultRecord(true, "return 0;")],
    ], { mtimeSec: 3_200, name: "session.v4.jsonl.zstd" })
    // The errored v4 fixture's verdict.
    const v4errored = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (v4errored.succeeded) fail("a v4 result flagged isError:true must report succeeded=false")
    if (!v4errored.called) fail("a v4 errored result is still a recorded call")
    if (v4errored.resultText !== "return 0;") fail("the errored v4 payload must still be returned, saw " + JSON.stringify(v4errored.resultText))
    if (!v4errored.reason.includes("ERROR")) fail("the v4 errored reason must say the recorded result is an error")

    // A frame header cut mid-write (a crashed boot) is reported as torn, not thrown.
    const torn = writeStore("session-torn", [[{ type: "session", version: 3 }], [callRecord]], { mtimeSec: 3_500 })
    // The container file whose final frame is about to be truncated.
    const tornFile = join(torn, "session.v3.jsonl.zstd")
    writeFileSync(tornFile, readFileSync(tornFile).subarray(0, readFileSync(tornFile).length - 6))
    // Re-stamp: writing the truncated bytes bumped mtime to NOW, which would make the
    // torn fixture the newest store for the final check below.
    utimesSync(tornFile, 3_500, 3_500)
    // The torn container read back, which must still yield its complete frames.
    const tornRead = readSessionEvents(home, { workspace: ws })
    if (tornRead.tornStart === undefined) fail("a truncated container must report tornStart")
    if (tornRead.records.length === 0) fail("a torn container must still yield its complete frames")

    // The PASSING fixture must still be reachable when it is the newest store again.
    utimesSync(join(home, "sessions", projectKey(ws), "session-pass", "session.v3.jsonl.zstd"), 4_000, 4_000)
    // The verdict re-read after re-selecting the passing store.
    const again = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (!again.succeeded) fail("re-selecting the passing store must report succeeded=true")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  console.log("[session-evidence self-test] ok: v3 + v4 result shapes (v4 payload text non-empty, v4 isError:true refused), multi-frame + plain stores, torn-frame reporting, call/result pairing, and every negative control verified")
}
