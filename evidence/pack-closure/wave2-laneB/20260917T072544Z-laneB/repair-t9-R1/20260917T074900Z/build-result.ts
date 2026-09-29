// t26 evidence: the repaired ROOT-FILES byte rule on the REAL tree, with the t25 writer named, plus the
// literal readings of the contract's verify list. The handoff to t18 (the single re-pack) is stated here
// because THAT is what clears this expected reading: it is a post-pack drift, not a gate defect.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = process.argv[2]
const codes = JSON.parse(process.argv[3])
const repo = process.cwd()
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex")
const read = (f) => readFileSync(join(dir, f), "utf8")
const closure = read("closure.log")
const expectedLine = closure.split("\n").find((l) => l.includes("CONTENT-DRIFT-EXPECTED") && l.includes("EXTENSIONS-FOR-AGENTS.md")) ?? null
const source = join(repo, "EXTENSIONS-FOR-AGENTS.md")
const artifact = join(repo, "dist/mpd-package/EXTENSIONS-FOR-AGENTS.md")
const report = {
  schema: "laneB/repair-t9-R1/1",
  captured_at: new Date().toISOString(),
  finding: "t9-R1 — the pre-existing REQUIRED_ROOT_FILES byte rule hard-reddened for a POST-PACK WRITER (t25, lane B2, T-72 carry-forward) instead of classifying it",
  repair: "rule 5b keeps its EXISTENCE half; its BYTE half moved into the content sweep as a third pass over REQUIRED_ROOT_FILES with compareBytes(..., ROOT_FILE_KIND), so the kind survives and the EXPECTED class applies",
  readings: {
    closure: { exitCode: codes.e1, verdict: (closure.match(/\[verify-pack-closure\] (ok|FAIL)/) ?? [])[1] ?? null, content: (closure.match(/content bytes: [^;]*/) ?? [])[0] ?? null, completeness: (closure.match(/completeness: [^;]*/) ?? [])[0] ?? null },
    closureSelftest: { exitCode: codes.e2, arms: (read("closure-selftest.log").match(/self-test (?:PASS|FAIL): \d+\/\d+ arms/) ?? [])[0] ?? null, by_design_fail_lines: (read("closure-selftest.log").match(/\[verify-pack-closure\] FAIL/g) ?? []).length },
    distFreshSelftest: { exitCode: codes.e3, arms: (read("dist-fresh-selftest.log").match(/(\d+\/\d+) arms passed/) ?? [])[1] ?? null },
    distFreshExtPlugin: { exitCode: codes.e4, line: (read("dist-fresh-ext-plugin.log").match(/\[verify-dist-fresh\] ok:[^\n]*/) ?? [])[0] ?? null },
    distFreshTuiPlugin: { exitCode: codes.e5, line: (read("dist-fresh-tui-plugin.log").match(/\[verify-dist-fresh\] ok:[^\n]*/) ?? [])[0] ?? null },
  },
  writer_named: {
    task: "t25",
    lane: "B2 (citation-checker-engineer, T-72 carry-forward) - path_owner read",
    path: "EXTENSIONS-FOR-AGENTS.md",
    source: { sha256: sha(source), sha256_16: sha(source).slice(0, 16), bytes: statSync(source).size, mtime: new Date(statSync(source).mtimeMs).toISOString() },
    artifact: { sha256: sha(artifact), sha256_16: sha(artifact).slice(0, 16), bytes: statSync(artifact).size, mtime: new Date(statSync(artifact).mtimeMs).toISOString() },
    reported_as: expectedLine,
  },
  handoff_to_t18: "this is a POST-PACK drift by design: the artifact carries the 05:19:48Z bytes and t25's rewrite landed at 07:43:40Z. The gate now names it as EXPECTED instead of reddening; the reading clears at the captain's ONE re-pack in t18, where the artifact catches up with every lane's writes (the wave's single re-pack, one writer at a time).",
  digests: {},
}
report.digests = Object.fromEntries(readdirSync(dir).sort().map((f) => [f, sha(join(dir, f)).slice(0, 16)]))
writeFileSync(join(dir, "result.json"), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ dir, readings: report.readings, writer: { source: report.writer_named.source.sha256_16 + " / " + report.writer_named.source.bytes + " B @ " + report.writer_named.source.mtime, artifact: report.writer_named.artifact.sha256_16 + " / " + report.writer_named.artifact.bytes + " B @ " + report.writer_named.artifact.mtime }, reported: String(expectedLine).slice(0, 180) }, null, 1))
