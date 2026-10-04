#!/usr/bin/env node
// extract-malformed-tool-input.ts — the reproducer for the MALFORMED_RESPONSE
// "tool input is invalid JSON" defect (session-2ad7e148, turn 1 step 52).
//
// WHY THIS EXISTS: the harness aborts the turn BEFORE it commits the assistant
// message, so a malformed tool call leaves NO `tool/call` record. An audit that
// reads `tool/call` records finds nothing (measured on this workspace: 2962
// recorded tool calls, 0 malformed, while exactly 1 turn died of this error).
// The only durable witness is the `assistant/attempt` stream record, which keeps
// the tool-call block as the harness assembled it — this script reads that.
//
// USAGE
//   node extract-malformed-tool-input.ts <session.v4.jsonl.zstd> [--json]
//   node extract-malformed-tool-input.ts --store <DSH_HOME> [--json]
//
// The session container is a CONCATENATED-ZSTD-FRAME file: one
// `zstdDecompressSync` call returns the header frame only, so the frames are
// walked by zstd magic (`28 b5 2f fd`) and decoded one at a time.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { zstdDecompressSync } from "node:zlib"

/** zstd frame magic, the only reliable frame boundary in this container format. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** One tool-call block whose accumulated `input_json_delta` text does not parse. */
interface MalformedToolCall {
  /** Session directory name, e.g. `session-2ad7e148-…`. */
  readonly session: string
  /** Event sequence number of the `assistant/attempt` record. */
  readonly seq: number
  /** Turn the attempt belonged to, absent when the record omits it. */
  readonly turn: number | null
  /** Step the attempt belonged to, absent when the record omits it. */
  readonly step: number | null
  /** Tool name the model was calling, e.g. `ask_user_question`. */
  readonly tool: string
  /** Provider tool-call id, so the call is addressable in the raw record. */
  readonly callId: string
  /** Byte length of the assembled arguments string. */
  readonly bytes: number
  /** UTF-16 offset `JSON.parse` rejected at, or null when the error carried none. */
  readonly offset: number | null
  /** The engine's own parse error message. */
  readonly parseError: string
  /** A window around the offending offset, so the bad byte is readable. */
  readonly window: string
}

/** One terminal turn failure the store recorded. */
interface TurnFailure {
  /** Session directory name. */
  readonly session: string
  /** Event sequence number of the `turn/end` record. */
  readonly seq: number
  /** Canonical error code, e.g. `MALFORMED_RESPONSE`. */
  readonly code: string
  /** Provider-level error message. */
  readonly message: string
}

/** Decode a concatenated-zstd session container into its JSONL text. */
function decodeSessionContainer(file: string): string {
  const bytes = readFileSync(file)
  const frames: string[] = []
  let offset = 0
  while (offset < bytes.length) {
    const start = bytes.indexOf(ZSTD_MAGIC, offset)
    if (start < 0) break
    let end = bytes.length
    for (let probe = start + 4; probe + 4 <= bytes.length; probe++) {
      const next = bytes.indexOf(ZSTD_MAGIC, probe)
      if (next < 0) {
        end = bytes.length
        break
      }
      try {
        zstdDecompressSync(bytes.subarray(start, next))
        end = next
        break
      } catch {
        probe = next - 1
      }
    }
    if (end <= start) break
    try {
      frames.push(zstdDecompressSync(bytes.subarray(start, end)).toString("utf8"))
    } catch {
      // A torn trailing frame is normal while a session is live; skip it.
    }
    offset = end
  }
  return frames.join("")
}

/** Every `session.v4.jsonl.zstd` under a DSH session store. */
function sessionFiles(storeRoot: string): string[] {
  const found: string[] = []
  for (const project of readdirSync(storeRoot)) {
    const projectDir = join(storeRoot, project)
    if (!statSync(projectDir).isDirectory()) continue
    for (const session of readdirSync(projectDir)) {
      const file = join(projectDir, session, "session.v4.jsonl.zstd")
      try {
        if (statSync(file).isFile()) found.push(file)
      } catch {
        // A session directory without the container is skipped, never fatal.
      }
    }
  }
  return found
}

/** Offset `JSON.parse` reported, or null when the message carries none. */
function offsetOf(message: string): number | null {
  const match = /position (\d+)/.exec(message)
  return match === null ? null : Number(match[1])
}

/** Scan one session file for malformed tool input and terminal turn failures. */
function scan(file: string): { malformed: MalformedToolCall[]; failures: TurnFailure[] } {
  const session = file.split("/").slice(-2)[0] ?? file
  const malformed: MalformedToolCall[] = []
  const failures: TurnFailure[] = []
  for (const line of decodeSessionContainer(file).split("\n")) {
    if (line.trim().length === 0) continue
    let record: {
      seq?: number
      type?: string
      data?: Record<string, unknown>
    }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    const data = record.data ?? {}
    if (record.type === "turn/end") {
      const reason = data.reason as { kind?: string; error?: { code?: string; message?: string } } | undefined
      if (reason?.kind === "error") {
        failures.push({
          session,
          seq: record.seq ?? -1,
          code: reason.error?.code ?? "<none>",
          message: reason.error?.message ?? "<none>"
        })
      }
      continue
    }
    if (record.type !== "assistant/attempt") continue
    const stream = (data.stream ?? []) as Array<{ type?: string; chunk?: { type?: string; block?: { type?: string; name?: string; id?: string; arguments?: string } } }>
    for (const element of stream) {
      const block = element.chunk?.block
      if (element.chunk?.type !== "block-end" || block?.type !== "tool-call") continue
      const args = block.arguments ?? ""
      try {
        JSON.parse(args)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const offset = offsetOf(message)
        malformed.push({
          session,
          seq: record.seq ?? -1,
          turn: typeof data.turn === "number" ? data.turn : null,
          step: typeof data.step === "number" ? data.step : null,
          tool: block.name ?? "<unnamed>",
          callId: block.id ?? "<none>",
          bytes: Buffer.byteLength(args, "utf8"),
          offset,
          parseError: message,
          window: offset === null ? args.slice(0, 160) : args.slice(Math.max(0, offset - 60), offset + 60)
        })
      }
    }
  }
  return { malformed, failures }
}

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const storeIndex = argv.indexOf("--store")
const files = storeIndex >= 0 ? sessionFiles(argv[storeIndex + 1] ?? "") : argv.filter((arg) => !arg.startsWith("--"))

const malformed: MalformedToolCall[] = []
const failures: TurnFailure[] = []
for (const file of files) {
  const result = scan(file)
  malformed.push(...result.malformed)
  failures.push(...result.failures)
}

if (asJson) {
  console.log(JSON.stringify({ files: files.length, malformed, turnFailures: failures }, null, 2))
} else {
  console.log(`scanned ${files.length} session container(s)`)
  console.log(`malformed tool input: ${malformed.length}`)
  for (const hit of malformed) {
    console.log(`  [${hit.session}] seq=${hit.seq} turn=${hit.turn} step=${hit.step} tool=${hit.tool}`)
    console.log(`    bytes=${hit.bytes} offset=${hit.offset} :: ${hit.parseError}`)
    console.log(`    window: ${JSON.stringify(hit.window)}`)
  }
  console.log(`terminal turn failures: ${failures.length}`)
  for (const hit of failures) console.log(`  [${hit.session}] seq=${hit.seq} ${hit.code} :: ${hit.message}`)
}
