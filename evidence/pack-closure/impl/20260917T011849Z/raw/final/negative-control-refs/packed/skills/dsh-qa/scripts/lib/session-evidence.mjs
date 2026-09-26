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
//   import { readSessionEvents, findToolCall } from "./lib/session-evidence.mjs"
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
import { projectKey } from "./workspace-isolation.mjs"

const ZSTD_MAGIC = 4247762216

/**
 * Locate complete zstd frames in the harness's concatenated container without
 * decompressing them (ported from the installed harness's `scanZstdFrames`).
 * Returns `{ frames: [{start, end}], tornStart? }` — `tornStart` is an incomplete
 * final frame (a crash mid-write), which is reported rather than silently dropped.
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error("corrupt session log: invalid Zstandard frame magic at byte " + offset)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error("corrupt session log: reserved frame-header bit at byte " + (offset - 1))
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error("corrupt session log: reserved block type at byte " + (offset - 3))
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

/** Decode one session artifact: every zstd frame, or the plain JSONL bytes. */
export function decodeSessionLog(file) {
  const bytes = readFileSync(file)
  if (!file.endsWith(".zstd")) return { text: bytes.toString("utf8"), frames: 0, tornStart: undefined }
  if (typeof zstdDecompressSync !== "function") {
    throw new Error("session-evidence: this Node build has no zlib.zstdDecompressSync, cannot read " + file)
  }
  const { frames, tornStart } = scanZstdFrames(bytes)
  const parts = []
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

/** Every session-store directory key under `<dshHome>/sessions` (newest first). */
function sessionKeys(dshHome) {
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
 */
export function readSessionEvents(dshHome, { workspace } = {}) {
  const keys = sessionKeys(dshHome)
  const wanted = workspace === undefined ? null : projectKey(workspace)
  const candidates = (wanted === null ? keys : keys.filter((e) => e.key === wanted))
    .flatMap((e) => {
      let ids = []
      try { ids = readdirSync(e.dir) } catch { /* unreadable store */ }
      return ids.map((id) => join(e.dir, id))
    })
    .filter((dir) => {
      try { return statSync(dir).isDirectory() } catch { return false }
    })
  const logs = []
  for (const dir of candidates) {
    for (const name of readdirSync(dir)) {
      if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
      const file = join(dir, name)
      try { logs.push({ file, mtimeMs: statSync(file).mtimeMs }) } catch { /* raced */ }
    }
  }
  logs.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.file < b.file ? 1 : -1))
  const found = logs.length
  if (wanted !== null && found === 0) {
    throw new Error(
      "session-evidence: no session log for workspace " + workspace + " under " + join(dshHome, "sessions")
      + " (keys present: " + (keys.map((k) => k.key).join(", ") || "none") + ")"
      + " — either the boot wrote no store (assert the case's own isolation assertion) or the workspace path is wrong"
    )
  }
  const file = logs[0]?.file
  const records = []
  let frames = 0
  let tornStart
  let undecodableLines = 0
  if (file !== undefined) {
    const decoded = decodeSessionLog(file)
    frames = decoded.frames
    tornStart = decoded.tornStart
    for (const line of decoded.text.split("\n")) {
      const text = line.trim()
      if (text.length === 0) continue
      try { records.push(JSON.parse(text)) } catch { undecodableLines += 1 }
    }
  }
  return { file: file ?? null, records, sessions: logs.length, frames, tornStart, undecodableLines }
}

/** The `tool/result` text of one call id, flattened over its content blocks. */
function resultTextOf(record) {
  const blocks = record?.data?.message?.content
  if (!Array.isArray(blocks)) return ""
  const parts = []
  for (const block of blocks) {
    if (block?.type !== "tool-result") continue
    for (const inner of Array.isArray(block.content) ? block.content : []) {
      if (typeof inner?.text === "string") parts.push(inner.text)
    }
  }
  return parts.join("\n")
}

/**
 * Whether the harness recorded a `tool/call` for `name` and a non-error
 * `tool/result` for that same call id. Returns the call ids, the joined result
 * text and a human-readable `reason` when it did not happen — so a caller can
 * fail with the actual cause (never called / called and errored) rather than with
 * a bare boolean.
 */
export function findToolCall(events, name) {
  const list = Array.isArray(events) ? events : (events?.records ?? [])
  const calls = list.filter((r) => r?.type === "tool/call" && r?.data?.name === name)
  const errored = new Set()
  const texts = []
  for (const record of list) {
    if (record?.type !== "tool/result") continue
    const blocks = record?.data?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type !== "tool-result") continue
      if (block.isError === true) errored.add(block.toolCallId)
      texts.push(resultTextOf(record))
    }
  }
  const resultText = texts.join("\n")
  const okCalls = calls.filter((c) => !errored.has(c.data.callId))
  const called = calls.length > 0
  const succeeded = okCalls.length > 0
  const reason = succeeded
    ? ""
    : called
      ? "the harness recorded " + calls.length + " call(s) to " + name + " but every recorded result is an ERROR"
      : "the harness recorded no tool/call for " + name + " (answer-only narration is not tool evidence)"
  return {
    name,
    called,
    succeeded,
    callIds: calls.map((c) => c.data.callId),
    calls: calls.map((c) => ({ callId: c.data.callId, arguments: c.data.arguments ?? null })),
    resultText,
    reason,
  }
}

/**
 * The tool names the HARNESS showed the model, read from the `request/header`
 * records (`data.header.tools[]`). This is the ground truth for "the session had
 * tool X available": a model that lists tool names in its answer can be wrong in
 * both directions, the request header cannot.
 */
export function recordedToolNames(events) {
  const list = Array.isArray(events) ? events : (events?.records ?? [])
  const names = new Set()
  for (const record of list) {
    if (record?.type !== "request/header") continue
    const tools = record?.data?.header?.tools
    if (!Array.isArray(tools)) continue
    for (const tool of tools) if (typeof tool?.name === "string") names.add(tool.name)
  }
  return [...names]
}

// Standalone --self-test (offline): a synthetic session store proves the reader,
// the call/result pairing and the failure modes. The negative controls are the
// point — a store WITHOUT the call, and a call whose result is an error, must both
// report succeeded=false rather than pass silently.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--self-test")) {
  const { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const fail = (msg) => { console.error("[session-evidence self-test] FAIL: " + msg); process.exit(1) }
  const TOOL = "mcp__codegraph__codegraph_explore"
  const home = mkdtempSync(join(tmpdir(), "mpd-sess-ev-"))
  const ws = join(home, "ws")
  // Explicit mtimes keep `newest session wins` deterministic (two fixtures written
  // in the same millisecond would otherwise race).
  const writeStore = (id, batches, { zstd = true, mtimeSec } = {}) => {
    const dir = join(home, "sessions", projectKey(ws), id)
    mkdirSync(dir, { recursive: true })
    // One frame PER BATCH, concatenated — the harness's own container layout, which
    // is what makes a naive single decompress return only the header (the defect this
    // self-test guards: `batches` of length > 1 must be fully decoded).
    const rows = Array.isArray(batches[0]) ? batches : [batches]
    const bytes = Buffer.concat(rows.map((batch) => {
      const body = batch.map((l) => JSON.stringify(l)).join("\n") + "\n"
      return zstd ? zstdCompressSync(Buffer.from(body, "utf8")) : Buffer.from(body, "utf8")
    }))
    const file = join(dir, "session.v3.jsonl" + (zstd ? ".zstd" : ""))
    writeFileSync(file, bytes)
    if (mtimeSec !== undefined) utimesSync(file, mtimeSec, mtimeSec)
    return dir
  }
  const callRecord = { type: "tool/call", seq: 2, data: { turn: 1, step: 1, callId: "c1", name: TOOL, arguments: { query: "norm" } } }
  const resultRecord = (isError, text) => ({
    type: "tool/result", seq: 3,
    data: { message: { content: [{ type: "tool-result", toolCallId: "c1", isError, content: [{ type: "text", text }] }] } }
  })
  try {
    if (!existsSync(join(home, "sessions"))) mkdirSync(join(home, "sessions"), { recursive: true })
    const empty = readSessionEvents(home)
    if (empty.records.length !== 0 || empty.file !== null) fail("an empty store must read as no records")
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
    const store = readSessionEvents(home, { workspace: ws })
    if (store.frames < 3) fail("the multi-frame fixture must be read as " + 3 + " frames, saw " + store.frames)
    if (store.records.length !== 3) fail("every frame's records must be decoded, saw " + store.records.length)
    if (store.tornStart !== undefined) fail("a complete container must not report a torn frame")
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
    const tools = recordedToolNames(readSessionEvents(home, { workspace: ws }).records)
    if (tools.length !== 2 || !tools.includes(TOOL) || !tools.includes("read")) fail("recordedToolNames must read data.header.tools[], saw " + JSON.stringify(tools))

    writeStore("session-newer-no-call", [{ type: "session", version: 3 }], { mtimeSec: 2_000 })
    const noCall = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (noCall.called || noCall.succeeded) fail("the newest store without the call must report succeeded=false")
    if (!noCall.reason.includes("no tool/call")) fail("the no-call reason must name the missing record")

    const dir = writeStore("session-plain-errored", [callRecord, resultRecord(true, "boom")], { zstd: false, mtimeSec: 3_000 })
    const errored = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (errored.succeeded) fail("an errored result must report succeeded=false")
    if (!errored.called) fail("an errored result is still a recorded call")
    if (!errored.reason.includes("ERROR")) fail("the errored reason must say the recorded result is an error")
    if (!existsSync(join(dir, "session.v3.jsonl"))) fail("the plain (uncompressed) store fixture was not written")

    // A frame header cut mid-write (a crashed boot) is reported as torn, not thrown.
    const torn = writeStore("session-torn", [[{ type: "session", version: 3 }], [callRecord]], { mtimeSec: 3_500 })
    const tornFile = join(torn, "session.v3.jsonl.zstd")
    writeFileSync(tornFile, readFileSync(tornFile).subarray(0, readFileSync(tornFile).length - 6))
    // Re-stamp: writing the truncated bytes bumped mtime to NOW, which would make the
    // torn fixture the newest store for the final check below.
    utimesSync(tornFile, 3_500, 3_500)
    const tornRead = readSessionEvents(home, { workspace: ws })
    if (tornRead.tornStart === undefined) fail("a truncated container must report tornStart")
    if (tornRead.records.length === 0) fail("a torn container must still yield its complete frames")

    // The PASSING fixture must still be reachable when it is the newest store again.
    utimesSync(join(home, "sessions", projectKey(ws), "session-pass", "session.v3.jsonl.zstd"), 4_000, 4_000)
    const again = findToolCall(readSessionEvents(home, { workspace: ws }), TOOL)
    if (!again.succeeded) fail("re-selecting the passing store must report succeeded=true")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  console.log("[session-evidence self-test] ok: multi-frame + plain stores, torn-frame reporting, call/result pairing, and both negative controls verified")
}
