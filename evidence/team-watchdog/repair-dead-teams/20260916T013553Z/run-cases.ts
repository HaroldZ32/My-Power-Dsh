// t81 evidence — the whole w8 harness (now including the dead/live liveness pair).
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const FIXTURE = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs")
if (!existsSync(FIXTURE)) { console.error("FATAL: fixture missing"); process.exit(2) }
const { runAll, CASES, NOT_CLAIMED } = await import(FIXTURE)
const scratch = join(HERE, "raw", "ws-cases")
mkdirSync(scratch, { recursive: true })
const results = await runAll({ root: scratch, print: true })
for (const r of results) {
  writeFileSync(join(HERE, "raw", "case-" + r.case + ".json"), JSON.stringify(r, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", "case-" + r.case + ".log"), r.lines.map((l) => "[" + r.case + "] " + l).join("\n") + "\n")
}
const summary = { task: "t81", fixtureSha256: createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"), cases: CASES, results: results.map((r) => ({ case: r.case, ok: r.ok, observation: r.observation })), ok: results.every((r) => r.ok), notClaimed: NOT_CLAIMED }
writeFileSync(join(HERE, "harness.json"), JSON.stringify(summary, null, 2) + "\n")
const lines = ["================ t81: the w8 harness, every case ================"]
for (const r of results) { lines.push(""); lines.push("── " + r.case + " ── ok=" + r.ok + " ──"); for (const l of r.lines) lines.push("  " + l) }
lines.push(""); lines.push("── verdicts ──"); for (const r of results) lines.push("  " + (r.ok ? "PASS" : "FAIL") + "  " + r.case)
writeFileSync(join(HERE, "raw", "harness-run.log"), lines.join("\n") + "\n")
console.log(lines.join("\n"))
process.exit(summary.ok ? 0 : 1)
