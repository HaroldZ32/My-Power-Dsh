// Triage reader (read-only): dump ONE sandbox session store verbatim, record by record, so the order
// and the trigger that materialized it can be read off the harness's own log.
// Usage (repo root): bun evidence/tui/dsh-tui-015/triage-reds/dump-store.ts <session-id> [sandbox-root]
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"

/** The CJS `require` the `node:zlib` calls below go through; ESM has no ambient `require`. */
const requireCjs = createRequire(import.meta.url)

/**
 * Decode a CONCATENATED-ZSTD-FRAME store: one `zstdDecompressSync` call returns only the first frame,
 * so the frames are located with a structure-only magic scan (the same technique the QA lib uses).
 * @param file - absolute path of the session store to decode.
 * @returns the concatenated UTF-8 text of every decodable frame.
 */
function decompressAllFrames(file: string): string {
  /** The store's raw bytes, scanned for frame magics below. */
  const buffer = readFileSync(file)
  /** Byte offsets at which a Zstandard frame magic starts, in ascending order. */
  const frames: number[] = []
  for (let offset = 0; offset + 4 <= buffer.length; offset += 1) {
    if (buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5 && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd) frames.push(offset)
  }
  /** Decoded frame texts, in stream order. */
  const pieces: string[] = []
  for (let i = 0; i < frames.length; i++) {
    try {
      pieces.push((requireCjs("node:zlib") as typeof import("node:zlib")).zstdDecompressSync(buffer.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : buffer.length)).toString("utf8"))
    } catch {
      // A truncated tail frame is normal for a live store; earlier frames stand.
    }
  }
  return pieces.join("")
}

/** The session id whose store is dumped. */
const wanted = process.argv[2]
/** The sandbox root to read; the frozen driver's root by default. */
const root = process.argv[3] ?? ".mpd/recon/qa/tui-lanes/tui-015"
/** `<root>/dshhome/sessions`, the store root keyed by project key. */
const sessionsRoot = join(root, "dshhome", "sessions")
for (const key of readdirSync(sessionsRoot)) {
  /** The session directory asked about, if this project key holds one. */
  const dir = join(sessionsRoot, key, wanted)
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    continue
  }
  console.log("project key:", key, "files:", files.join(","))
  for (const name of files) console.log(decompressAllFrames(join(dir, name)))
}
