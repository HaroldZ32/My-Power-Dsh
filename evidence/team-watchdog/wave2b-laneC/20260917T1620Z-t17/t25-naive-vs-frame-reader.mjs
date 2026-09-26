// T-25's INSTRUMENT LEG — wave-2b lane C (t17). The FAILURE is the evidence: a naive ONE-FRAME read of a
// session store reports no events at all, while the shipped frame-by-frame reader sees them — same store,
// same moment. Reader: skills/dsh-qa/scripts/lib/session-evidence.mjs (lane D's file, READ-ONLY import).
//
// The stores read here are the harness-produced stores INSIDE this workspace (`.qa-reloc/home/sessions/**`,
// left by a QA relocation run) — no read of the real `~/.dsh` (AGENTS.md §7 isolation).
//
// EVENTS vs RECORDS, stated so the reading is not ambiguous: the first frame of a store carries ONE record
// of type `session` (the session descriptor). A naive read therefore returns 1 RECORD and 0 EVENTS. This
// driver reports both counts and both type censuses; `events` = records whose type is not `session`.
//
// Usage: node t25-naive-vs-frame-reader.mjs --out <dir>
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { zstdDecompressSync } from "node:zlib"
import { decodeSessionLog, readSessionEvents, scanZstdFrames } from "/root/dshProj/my-power-dsh/skills/dsh-qa/scripts/lib/session-evidence.mjs"

const HERE = dirname(new URL(import.meta.url).pathname)
const REPO = resolve(HERE, "../../../..")
const READER = join(REPO, "skills", "dsh-qa", "scripts", "lib", "session-evidence.mjs")
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const OUT = resolve(argOf("--out", HERE))
mkdirSync(OUT, { recursive: true })
// Immutable evidence (T-83's class): a re-run at the SAME target is REFUSED rather than silently
// overwriting a reading that is already archived.
const GUARDED = join(OUT, "t25-naive-vs-frame-reader-result.json")
if (existsSync(GUARDED) && !args.includes("--force")) {
  console.error("REFUSED: " + GUARDED + " already exists (immutable evidence). Pass a fresh --out <dir>, or --force to overwrite deliberately.")
  process.exit(3)
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const META_TYPES = new Set(["session"])
const parseRecords = (text) => text.split("\n").filter((line) => line.trim() !== "").map((line) => {
  try { return JSON.parse(line) } catch { return { type: "<undecodable>" } }
})
const censusOf = (records) => {
  const census = {}
  for (const record of records) census[record.type] = (census[record.type] ?? 0) + 1
  return census
}
const eventCount = (records) => records.filter((record) => !META_TYPES.has(record.type)).length

function findStores(root) {
  const found = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === "session.v3.jsonl.zstd") found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

/** The NAIVE read: one `zstdDecompressSync` over the whole container (what a careless reader does). */
function naiveRead(store) {
  const bytes = readFileSync(store)
  try {
    const records = parseRecords(zstdDecompressSync(bytes).toString("utf8"))
    return { ok: true, records: records.length, events: eventCount(records), types: records.map((record) => record.type) }
  } catch (error) {
    return { ok: false, records: 0, events: 0, types: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/** The NEGATIVE CONTROL: the frame-by-frame reader REGRESSED to its first frame only. */
function regressedRead(store) {
  const bytes = readFileSync(store)
  const { frames } = scanZstdFrames(bytes)
  if (frames.length === 0) return { ok: false, records: 0, events: 0, error: "no frames" }
  try {
    const records = parseRecords(zstdDecompressSync(bytes.subarray(frames[0].start, frames[0].end)).toString("utf8"))
    return { ok: true, records: records.length, events: eventCount(records), framesUsed: 1 }
  } catch (error) {
    return { ok: false, records: 0, events: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

const dshHome = join(REPO, ".qa-reloc", "home")
const workspace = join(REPO, ".qa-reloc", "ws")
const allStores = findStores(join(dshHome, "sessions"))
// The high-level reader picks the NEWEST store of the workspace key. That pick IS the primary store, so
// all readings below come from the SAME file rather than from two similar ones.
const highLevelProbe = readSessionEvents(dshHome, { workspace })
const primaryStore = highLevelProbe.file
if (primaryStore === null || primaryStore === undefined) {
  console.error("FAIL: the reader found no store for " + workspace + " under " + dshHome + " — the leg would be vacuous")
  process.exit(1)
}
const census = allStores.map((store) => {
  const bytes = readFileSync(store)
  const scanned = scanZstdFrames(bytes)
  return { store, size: bytes.length, frames: scanned.frames.length, tornStart: scanned.tornStart ?? null, naive: naiveRead(store) }
})

const before = { sha256: sha(primaryStore), size: statSync(primaryStore).size, mtimeMs: statSync(primaryStore).mtimeMs }
// ─── BOTH READINGS, SAME STORE, SAME MOMENT ────────────────────────────────────────────────────────────
const naive = naiveRead(primaryStore)
const regressed = regressedRead(primaryStore)
const shipped = decodeSessionLog(primaryStore)
const shippedRecords = parseRecords(shipped.text)
const after = { sha256: sha(primaryStore), size: statSync(primaryStore).size, mtimeMs: statSync(primaryStore).mtimeMs }

const assertions = {
  sameFileForEveryReader: highLevelProbe.file === primaryStore,
  multiFrameStore: shipped.frames > 1,
  naiveReadsOnlyTheFirstFrame: naive.records === 1,
  naiveReportsZeroEvents: naive.events === 0,
  shippedReaderSeesEvents: eventCount(shippedRecords) > 0,
  shippedReaderSeesAToolCall: shippedRecords.some((record) => record.type === "tool/call"),
  regressionToSingleFrameWouldRedden: regressed.records === naive.records && regressed.events === naive.events,
  sameMoment: before.sha256 === after.sha256 && before.mtimeMs === after.mtimeMs,
}

const result = {
  schema: "t25/naive-vs-frame-reader/1",
  leg: "wave-2b lane C (t17)",
  rowWording: "0 events from a naive reader is NOT proof of an empty log",
  reader: { path: READER, sha256: sha(READER), provenance: "skills/dsh-qa/scripts/lib/session-evidence.mjs — lane D's file, imported READ-ONLY" },
  storeCorpus: {
    root: join(dshHome, "sessions"),
    found: allStores.length,
    multiFrame: census.filter((entry) => entry.frames > 1).length,
    naiveZeroEventStores: census.filter((entry) => entry.naive.events === 0).length,
    naiveOneRecordStores: census.filter((entry) => entry.naive.records === 1).length,
    note: "the corpus census is a reading of THIS workspace-local QA corpus (580 stores), not of the harness in general",
  },
  primary: {
    store: primaryStore,
    selectedBy: "readSessionEvents(dshHome, { workspace }) — the newest store of the workspace key, so every reader below reads the SAME file",
    frames: shipped.frames,
    tornStart: shipped.tornStart ?? null,
    bytes: before.size,
    sha256Before: before.sha256,
    sha256After: after.sha256,
    byteStableAcrossReadings: before.sha256 === after.sha256 && before.size === after.size,
    mtimeUnchangedAcrossReadings: before.mtimeMs === after.mtimeMs,
  },
  readings: {
    naiveOneFrameRead: { records: naive.records, events: naive.events, types: naive.types, ok: naive.ok, error: naive.error ?? null },
    regressedReaderFirstFrameOnly: { records: regressed.records, events: regressed.events, framesUsed: regressed.framesUsed ?? 0, ok: regressed.ok },
    shippedReaderFrameByFrame: { records: shippedRecords.length, events: eventCount(shippedRecords), frames: shipped.frames, typeCensus: censusOf(shippedRecords) },
    shippedReaderHighLevel: { records: highLevelProbe.records.length, frames: highLevelProbe.frames, sessionsFound: highLevelProbe.sessions, undecodableLines: highLevelProbe.undecodableLines, file: highLevelProbe.file },
    sameStoreCheck: { naiveStore: primaryStore, frameByFrameStore: primaryStore, highLevelFile: highLevelProbe.file, identical: highLevelProbe.file === primaryStore },
  },
  assertions,
  bound: "the shipped reader's count is a reading of THE READER on THIS store at THIS moment; it is not a claim about any other store, and the stores read are the workspace-local QA corpus, never the real ~/.dsh",
  finishedAt: new Date().toISOString(),
}
writeFileSync(join(OUT, "t25-naive-vs-frame-reader-result.json"), JSON.stringify(result, null, 2) + "\n")
const failed = Object.entries(assertions).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(JSON.stringify({
  primary_store: primaryStore,
  frames: shipped.frames,
  naive_records: naive.records,
  naive_events: naive.events,
  naive_types: naive.types,
  regressed_records: regressed.records,
  frame_by_frame_records: shippedRecords.length,
  frame_by_frame_events: eventCount(shippedRecords),
  corpus: { found: allStores.length, multiFrame: result.storeCorpus.multiFrame, naiveZeroEventStores: result.storeCorpus.naiveZeroEventStores },
  failed_assertions: failed,
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
