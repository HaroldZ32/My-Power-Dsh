// t36 Reviewer: drive the SHIPPED write path directly for the degradation cases the
// lane does not cover (read-only, malformed) plus the two structural refusals.
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const mod = await import("/root/dshProj/my-power-dsh/packages/mpd-config-plugin/src/settings-bridge.ts")
const bridge = mod.writeBackLeaves ?? mod.default?.writeBackLeaves
if (typeof bridge !== "function") {
  console.log(JSON.stringify({ error: "writeBackLeaves not exported from dist", keys: Object.keys(mod).slice(0, 25) }, null, 1))
  process.exit(2)
}
const base = "/root/dshProj/my-power-dsh/evidence/mpd-bridge/review/raw/degradation"
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })
const out = { api: "packages/mpd-config-plugin/src/settings-bridge.ts (source drive)", cases: {} }
const leaf = [{ path: ["hashline", "maxDiffChars"], value: 31415 }]

// 1) READ-ONLY target: mode has no write bit. The bridge must REPORT denied and NOT write,
//    even though this process runs as root (where chmod 0444 would still be writable).
const ro = join(base, "mpd.jsonc")
const roText = '{\n  // human comment\n  "hashline": {\n    "maxDiffChars": 20000,\n  },\n  "ulw": { "maxRounds": 6 },\n}\n'
writeFileSync(ro, roText)
chmodSync(ro, 0o444)
const before = readFileSync(ro, "utf8")
const roReport = bridge([{ root: base, file: ro }], leaf)
out.cases.readOnly = {
  outcome: roReport.results?.[0]?.outcome,
  reason: roReport.results?.[0]?.reason,
  writtenTo: roReport.writtenTo,
  bytesUnchanged: readFileSync(ro, "utf8") === before,
  mode: (statSync(ro).mode & 0o777).toString(8),
}
chmodSync(ro, 0o644)

// 2) MALFORMED JSONC: refuse-first, never repaired.
const bad = join(base, "mpd-bad.jsonc")
const badText = '{ "hashline": { "maxDiffChars": 20000,, }\n'
writeFileSync(bad, badText)
const badReport = bridge([{ root: base, file: bad }], leaf)
out.cases.malformed = {
  outcome: badReport.results?.[0]?.outcome,
  reason: badReport.results?.[0]?.reason,
  bytesUnchanged: readFileSync(bad, "utf8") === badText,
}

// 3) ZERO live roots: no target, nothing written, explicit skip.
out.cases.noLiveSession = bridge([], leaf)

// 4) Switch off (the A6 control's shape): nothing written, explicit skip.
out.cases.disabled = bridge([{ root: base, file: ro }], leaf, { writeBack: false, retries: 3 })

console.log(JSON.stringify(out, null, 1))
