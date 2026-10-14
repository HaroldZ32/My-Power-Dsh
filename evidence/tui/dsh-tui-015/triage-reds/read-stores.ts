// Triage reader (read-only): decode every session store under the QA sandbox project key and report
// the record types, the recorded cwd, the session header and the mtime, so the "no session store" red
// of tui-deps-ctrla and the "stale session id" red of tui-team-surface can be judged from artifacts.
// Usage (repo root): bun evidence/tui/dsh-tui-015/triage-reds/read-stores.ts [sandbox-root]
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { readSessionHeaders } from "../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

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

/** The sandbox root to inspect; the frozen driver's root by default. */
const root = process.argv[2] ?? ".mpd/recon/qa/tui-lanes/tui-015"
console.log("session headers (readSessionHeaders):")
for (const header of readSessionHeaders(root)) console.log("  ", header.sessionId, "cwd=", header.cwd, "preset=", header.agentPreset, "mtime=", new Date(header.mtimeMs).toISOString())
/** `<root>/dshhome/sessions`, the store root keyed by project key. */
const sessionsRoot = join(root, "dshhome", "sessions")
for (const key of readdirSync(sessionsRoot)) {
  console.log("=== project key:", key)
  /** That project key's session directories, in readdir order. */
  const dir = join(sessionsRoot, key)
  for (const id of readdirSync(dir)) {
    /** The session directory of one boot. */
    const sessionDir = join(dir, id)
    /** Every file inside it, so the container name is discovered rather than assumed. */
    const files = readdirSync(sessionDir)
    /** The container file (the one holding the zstd frames). */
    const store = files.map((name) => join(sessionDir, name)).find((file) => { try { return decompressAllFrames(file) !== "" } catch { return false } })
    if (store === undefined) {
      console.log("---", id, "NO DECODABLE STORE; files:", files.join(","))
      continue
    }
    console.log("---", id, "mtime", statSync(store).mtime.toISOString(), "bytes", statSync(store).size, "file", store.split("/").pop())
    /** Record-type histogram for this store. */
    const types = new Map<string, number>()
    /** The first recorded cwd, when the store carries one. */
    let cwd: unknown
    /** The first record whose type looks like a session header. */
    let header: unknown
    /** Every `command/run` payload seen, verbatim. */
    const runs: string[] = []
    for (const line of decompressAllFrames(store).split("\n")) {
      if (line.trim() === "") continue
      try {
        /** One decoded JSONL record. */
        const record = JSON.parse(line) as { type?: unknown; data?: Record<string, unknown> }
        types.set(String(record.type), (types.get(String(record.type)) ?? 0) + 1)
        if (record.data !== undefined && cwd === undefined && typeof record.data["cwd"] === "string") cwd = record.data["cwd"]
        if (header === undefined && /header|start|init|preset/i.test(String(record.type))) header = record
        if (record.type === "command/run") runs.push(JSON.stringify(record.data))
      } catch {
        // A malformed line is surfaced by its absence from the histogram.
      }
    }
    console.log("    types:", [...types.entries()].map(([k, v]) => k + "=" + v).join(" "))
    console.log("    cwd:", JSON.stringify(cwd))
    if (header !== undefined) console.log("    header:", JSON.stringify(header).slice(0, 400))
    for (const run of runs) console.log("    run:", run)
  }
}
