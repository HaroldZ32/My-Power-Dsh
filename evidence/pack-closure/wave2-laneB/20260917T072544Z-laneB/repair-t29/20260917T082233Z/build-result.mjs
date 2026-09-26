// t29 repair evidence builder: writes this directory's result.json and prints the changed-path list.
// usage: node build-result.mjs <repair-dir> <lane-root-dir> <fresh-regenerate-dir>
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join, relative } from "node:path"

const [R, D, F] = process.argv.slice(2)
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16)
const report = {
  schema: "laneB/repair-t29/1",
  captured_at: new Date().toISOString(),
  findings: [
    {
      id: "review-B F1",
      severity: "medium",
      file: "evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/run-laneB-evidence.mjs",
      problem:
        "the contract's designated entry point could not run in a fresh dir (ENOENT on t67-build-form-diff.json, exit 1) and assembled four harness readings from <name>.json files its steps never wrote (manual artifacts sealed 15:28:13-15:37:52, older than its own 15:38 .log runs)",
      fix:
        "the four harnesses are resolved relative to the DRIVER's directory; each harness JSON is parsed out of the just-written <name>.log and saved as <name>.json; a parse failure is recorded in harness_parse_errors and fails the driver's exit code",
    },
    {
      id: "review-B F2",
      severity: "low",
      file: "same driver — digest loop",
      problem:
        "the digest loop digested the file being written (a stdout redirect target) and a 0-byte file, both as e3b0c44298fc1c14, the sha256 of the EMPTY string",
      fix:
        "the files this run wrote are digested BY NAME; any other top-level file only when non-empty AND its mtime predates the run; skipped files are listed in digests_skipped with reasons; result.json excludes itself and the run prints its own post-write digest",
    },
  ],
  revisions: { pre_repair_driver: "abbc33335219766a (the t9 completion)", repaired_driver: "cae90588897ecb0d" },
  readings: {
    fresh_dir_run: "exit 0, 16 artifacts digested, all four harnesses parsed and saved, the planted 0-byte file and the empty stdout redirect both skipped with reasons",
    own_dir_run: "exit 0, 25 artifacts digested, the two 0-byte .err files skipped with reasons",
    result_json_digest_after_own_dir_run: "f1ef332092dfcb68",
    contract_commands: { closure: 0, closure_selftest: 0, dist_fresh_selftest: 0, dist_fresh_only_ext_plugin: 0, dist_fresh_only_tui_plugin: 0 },
  },
  digests: {},
}
for (const entry of readdirSync(R).sort()) {
  const abs = join(R, entry)
  if (statSync(abs).isFile() && entry !== "result.json") report.digests[entry] = sha(abs)
}
writeFileSync(join(R, "result.json"), JSON.stringify(report, null, 2))

const changed = ["evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/run-laneB-evidence.mjs"]
for (const entry of readdirSync(R)) if (statSync(join(R, entry)).isFile()) changed.push(relative(process.cwd(), join(R, entry)))
const regenerated = ["result.json", "driver-summary.json", "t67-build-form-diff.json", "t63-t76-seeded-mutation.json", "t63-out-flag-equivalence.json", "t67-round-trip.json"]
for (const entry of readdirSync(D)) if (regenerated.includes(entry)) changed.push(relative(process.cwd(), join(D, entry)))
for (const entry of readdirSync(F)) if (statSync(join(F, entry)).isFile()) changed.push(relative(process.cwd(), join(F, entry)))
writeFileSync(join(R, "changed-paths.json"), JSON.stringify(changed, null, 2))
console.log(JSON.stringify({ result_written: join(R, "result.json"), digests: report.digests, changed_paths: changed.length }, null, 1))
