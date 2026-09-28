import { HASHLINE_DICT } from "./constants"
import { createHashlineChunkFormatter } from "./hashline-chunk-formatter"
import { hashXxh32 } from "./xxhash32"

// A line counts as content-bearing when it holds a letter or a digit in any script; other lines hash by position instead.
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u

// Hash core shared by both variants; the caller has already removed the whitespace its variant ignores.
function computeNormalizedLineHash(lineNumber: number, normalizedContent: string): string {
  // Alias for the already-normalized text: this helper never rewrites the content again.
  const stripped = normalizedContent
  // Seed 0 for content-bearing lines so equal text hashes equal; a punctuation-only or blank line is kept distinct by its number.
  const seed = RE_SIGNIFICANT.test(stripped) ? 0 : lineNumber
  // 32-bit xxHash of the normalized text, of which only the low byte reaches the anchor.
  const hash = hashXxh32(stripped, seed)
  // Low byte of the hash indexes HASHLINE_DICT's 256 two-letter pairs, so the index is always in range.
  const index = hash % 256
  return HASHLINE_DICT[index]
}

// Anchor hash for text as stored on disk: CR is dropped and trailing whitespace ignored, so a line ending never moves the anchor.
export function computeLineHash(lineNumber: number, content: string): string {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").trimEnd())
}

// Older normalization kept for validation only: every whitespace character is removed first, so anchors written before the change still verify.
export function computeLegacyLineHash(lineNumber: number, content: string): string {
  return computeNormalizedLineHash(lineNumber, content.replace(/\r/g, "").replace(/\s+/g, ""))
}

// One anchor line in the `LINE#HASH|content` shape HASHLINE_OUTPUT_PATTERN parses back.
export function formatHashLine(lineNumber: number, content: string): string {
  // Anchor hash for this line under the current (non-legacy) normalization.
  const hash = computeLineHash(lineNumber, content)
  return `${lineNumber}#${hash}|${content}`
}

// Whole-document view: 1-based numbering, newline-joined; empty input yields an empty string, and a trailing newline adds a final empty line.
export function formatHashLines(content: string): string {
  if (!content) return ""
  // The document is already in memory, so splitting it here is safe.
  const lines = content.split("\n")
  return lines.map((line, index) => formatHashLine(index + 1, line)).join("\n")
}

/** Batching knobs for the streaming readers; each field falls back to a default inside the reader. */
export interface HashlineStreamOptions {
  /** Number carried by the first emitted line; defaults to 1 and shifts every later line. */
  startLine?: number
  /** Line count that forces the pending chunk to flush; defaults to 200. */
  maxChunkLines?: number
  /** UTF-8 byte count that forces the pending chunk to flush; defaults to 64 KiB. */
  maxChunkBytes?: number
}

// Tells a web ReadableStream apart from a plain async iterable; only the presence of `getReader` is probed.
function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  )
}

// Adapts a web stream to an async generator, releasing the reader lock even if the consumer stops early.
async function* bytesFromReadableStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  // One reader for the stream's lifetime; `releaseLock` in the finally block makes the source usable again.
  const reader = stream.getReader()
  try {
    while (true) {
      // Next byte block, or `done` once the stream is exhausted.
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

// Streams UTF-8 bytes out as `LINE#HASH|content` chunks without holding the whole file in memory.
export async function* streamHashLinesFromUtf8(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string> {
  // Number for the first emitted line; a caller resuming mid-file overrides the 1-based default.
  const startLine = options.startLine ?? 1
  // Flush threshold in lines for this call.
  const maxChunkLines = options.maxChunkLines ?? 200
  // Flush threshold in bytes for this call.
  const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024
  // `stream: true` carries a multi-byte character split across two byte blocks instead of mangling it.
  const decoder = new TextDecoder("utf-8")
  // Both arms are async-iterable, so the loop below needs no branch.
  const chunks = isReadableStream(source) ? bytesFromReadableStream(source) : source

  // Number the next emitted line will carry; advances once per completed line.
  let lineNumber = startLine
  // Bytes after the last newline seen: a line still waiting for its terminator or for end of stream.
  let pending = ""
  // Guards the empty source: it must emit nothing rather than one phantom blank line.
  let sawAnyText = false
  // Whether the last consumed character was a newline, which decides whether an empty final line is emitted.
  let endedWithNewline = false
  // Accumulates formatted anchors and returns only the chunks that reached a threshold.
  const chunkFormatter = createHashlineChunkFormatter({ maxChunkLines, maxChunkBytes })

  // Formats one line, advances the counter, and returns the chunks the formatter is ready to emit.
  const pushLine = (line: string): string[] => {
    // Anchor for the current line number; the counter must advance regardless of chunking.
    const formatted = formatHashLine(lineNumber, line)
    lineNumber += 1
    return chunkFormatter.push(formatted)
  }

  // Appends decoded text and drains every complete line from it, returning the chunks to yield.
  const consumeText = (text: string): string[] => {
    if (text.length === 0) return []
    sawAnyText = true
    pending += text
    // Chunks produced while draining the complete lines currently buffered.
    const chunksToYield: string[] = []

    // Scan position in `pending`, advanced past each newline so no line is emitted twice.
    let lastIdx = 0
    while (true) {
      // Next newline at or after `lastIdx`, or -1 when no complete line is buffered yet.
      const idx = pending.indexOf("\n", lastIdx)
      if (idx === -1) break
      // Complete line with its terminator removed.
      const line = pending.slice(lastIdx, idx)
      lastIdx = idx + 1
      endedWithNewline = true
      chunksToYield.push(...pushLine(line))
    }

    pending = pending.slice(lastIdx)
    if (pending.length > 0) endedWithNewline = false
    return chunksToYield
  }

  for await (const chunk of chunks) {
    for (const out of consumeText(decoder.decode(chunk, { stream: true }))) {
      yield out
    }
  }

  for (const out of consumeText(decoder.decode())) {
    yield out
  }

  if (sawAnyText && (pending.length > 0 || endedWithNewline)) {
    for (const out of pushLine(pending)) {
      yield out
    }
  }

  // The formatter still holds lines that never reached a threshold; flushing them closes the stream.
  const finalChunk = chunkFormatter.flush()
  if (finalChunk) yield finalChunk
}

// Same chunked output as the UTF-8 reader, fed here by an in-memory line iterable that may be synchronous or asynchronous.
export async function* streamHashLinesFromLines(
  lines: Iterable<string> | AsyncIterable<string>,
  options: HashlineStreamOptions = {}
): AsyncGenerator<string> {
  // Number for the first emitted line; a caller resuming mid-file overrides the 1-based default.
  const startLine = options.startLine ?? 1
  // Flush threshold in lines for this call.
  const maxChunkLines = options.maxChunkLines ?? 200
  // Flush threshold in bytes for this call.
  const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024

  // Number the next emitted line will carry; advances once per completed line.
  let lineNumber = startLine
  // Accumulates formatted anchors and returns only the chunks that reached a threshold.
  const chunkFormatter = createHashlineChunkFormatter({ maxChunkLines, maxChunkBytes })

  // Formats one line, advances the counter, and returns the chunks the formatter is ready to emit.
  const pushLine = (line: string): string[] => {
    // Anchor for the current line number; the counter must advance regardless of chunking.
    const formatted = formatHashLine(lineNumber, line)
    lineNumber += 1
    return chunkFormatter.push(formatted)
  }

  // Present on async iterables only; its absence routes the loop below to the synchronous arm.
  const asyncIterator = (lines as AsyncIterable<string>)[Symbol.asyncIterator]
  if (typeof asyncIterator === "function") {
    for await (const line of lines as AsyncIterable<string>) {
      for (const out of pushLine(line)) yield out
    }
  } else {
    for (const line of lines as Iterable<string>) {
      for (const out of pushLine(line)) yield out
    }
  }

  // The formatter still holds lines that never reached a threshold; flushing them closes the stream.
  const finalChunk = chunkFormatter.flush()
  if (finalChunk) yield finalChunk
}
