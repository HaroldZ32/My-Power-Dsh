import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin"
const LIB = join(ROOT, "lib")
const TESTS = [join(ROOT, "test"), join(ROOT, "self-fix-tests")]

const SYMBOLS = [
  "messageDedupKey", "appendMailboxDeduped", "clearMailboxToWatermark", "readLiveMailbox",
  "enqueueInterjection", "readInterjections", "readPendingInterjections",
  "readRawInterjectionRecords", "expireInterjections", "decideInterjection",
  "isTaskReady", "deliverableUnread", "INTERJECTION_TTL_MS", "MAILBOX_DEDUP_WINDOW_MS",
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|mjs|ts)$/.test(full)) out.push(full)
  }
  return out
}

const libFiles = walk(LIB).filter((f) => !f.endsWith("mpd-deltas.js"))
const testFiles = TESTS.flatMap((dir) => { try { return walk(dir) } catch { return [] } })
const read = (files) => new Map(files.map((f) => [f, readFileSync(f, "utf8")]))
const libSources = read(libFiles)
const testSources = read(testFiles)

function analyse(symbol) {
  const importedBy = []
  const stringRefs = []
  for (const [file, text] of libSources) {
    for (const line of text.split("\n")) {
      if (!/^import\b/.test(line.trim())) continue
      if (!new RegExp(`\\b${symbol}\\b`).test(line)) continue
      importedBy.push(relative(ROOT, file))
    }
    if (text.includes(`"${symbol}"`) || text.includes(`'${symbol}'`)) stringRefs.push(relative(ROOT, file))
  }
  const testRefs = []
  for (const [file, text] of testSources) if (text.includes(symbol)) testRefs.push(relative(ROOT, file))
  return { importedBy: [...new Set(importedBy)], stringRefs: [...new Set(stringRefs)], testRefs: [...new Set(testRefs)] }
}

const rows = SYMBOLS.map((symbol) => {
  const info = analyse(symbol)
  const productionCaller = info.importedBy.length > 0 || info.stringRefs.length > 0
  return {
    symbol,
    importedBy: info.importedBy,
    stringRefs: info.stringRefs,
    tests: info.testRefs.length,
    verdict: productionCaller ? "REACHABLE from production code" : (info.testRefs.length > 0 ? "ONLY TESTS REACH IT" : "UNREACHABLE"),
  }
})

console.log(JSON.stringify({ rows, notReachable: rows.filter((r) => r.verdict !== "REACHABLE from production code").map((r) => r.symbol) }, null, 2))
