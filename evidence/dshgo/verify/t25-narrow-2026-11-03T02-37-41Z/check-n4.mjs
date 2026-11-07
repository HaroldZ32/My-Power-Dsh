// T25 #4: the zh D1-D3 paragraphs vs the English twin — bracket balance, full hashes, run ids.
import { readFileSync } from "node:fs"
const en = readFileSync("docs/tui-parity.md", "utf8")
const zh = readFileSync("docs/tui-parity.zh-CN.md", "utf8")
const section = (text, start, end) => {
  const i = text.indexOf(start)
  const j = text.indexOf(end, i + 1)
  return i < 0 ? "" : text.slice(i, j < 0 ? text.length : j)
}
const enD = section(en, "**D1:", "\n## ")
const zhD = section(zh, "**D1：", "\n## ")
const balance = (s) => ({ open: (s.match(/（/g) ?? []).length, close: (s.match(/）/g) ?? []).length })
const hashes = (s) => [...s.matchAll(/\b[0-9a-f]{64}\b/g)].map((m) => m[0])
const runs = (s) => [...new Set([...s.matchAll(/14-\d\d-\d\d\.\d+Z/g)].map((m) => m[0]))]
const report = {
  enBrackets: balance(enD), zhBrackets: balance(zhD),
  enHashes: hashes(enD), zhHashes: hashes(zhD),
  enRuns: runs(enD), zhRuns: runs(zhD),
  zhBalanced: balance(zhD).open === balance(zhD).close,
  zhFullHashCount: hashes(zhD).length,
  zhRestatesStale: hashes(zhD).length > hashes(enD).length,
  runsMatch: JSON.stringify(runs(enD)) === JSON.stringify(runs(zhD)),
}
console.log(JSON.stringify(report, null, 1))
