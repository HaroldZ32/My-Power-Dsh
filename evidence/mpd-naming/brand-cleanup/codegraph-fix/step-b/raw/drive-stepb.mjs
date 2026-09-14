// STEP B proof — the falsifiable retarget pair plus compatibility checks, run
// against the LANDED artifact (no copies, no substitutions).
//
//   b1-mpd-block-disables      : [mpd].codegraph.enabled=false MUST suppress codegraph
//   b2-foreign-codex-block-inert: [codex].codegraph.enabled=false MUST be inert
//   b3-legacy-schema-still-validates: a config carrying the old $schema must still migrate
//   b4-plain-migration-due     : control — the migration runs on the plain document
//
// b1 vs b2 is the falsifiable pair: same probe, same document shape, only the block
// name differs. If b2 also suppressed, the block name would not be what matters.
//
// Usage: node drive-stepb.mjs <rootWorkDir> <outJson>
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const [rootWorkDir, outJson] = process.argv.slice(2)
if (!rootWorkDir || !outJson) {
  console.error("usage: node drive-stepb.mjs <rootWorkDir> <outJson>")
  process.exit(2)
}

const artifact = join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js")
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

const cases = [
  { name: "b1-mpd-block-disables", flag: "mpd-disabled", expect: "skipped: disabled by .mpd config" },
  { name: "b2-foreign-codex-block-inert", flag: "codex-disabled", expect: "NOT the disabled wording" },
  { name: "b3-legacy-schema-still-validates", flag: "legacy-schema", expect: "migration writes, $schema not re-emitted" },
  { name: "b4-plain-migration-due", flag: "no-marker", expect: "migration writes" }
]

const neutralProject = resolve(join(rootWorkDir, "neutral-project"))
mkdirSync(neutralProject, { recursive: true })

const results = []
for (const probeCase of cases) {
  const sandbox = resolve(join(rootWorkDir, "sandboxes", probeCase.name))
  rmSync(sandbox, { recursive: true, force: true })
  const probeOut = join(rootWorkDir, `${probeCase.name}.json`)
  execFileSync(
    process.execPath,
    [join(here, "probe.mjs"), probeCase.name, sandbox, probeOut, probeCase.flag],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        PROBE_ARTIFACT: artifact,
        PWD: neutralProject,
        MPD_CODEGRAPH_BIN: "/nonexistent/mpd-codegraph-probe-unavailable"
      }
    }
  )
  const probe = JSON.parse(readFileSync(probeOut, "utf8"))
  const disabledHint = probe.skipped_hint.some((line) => line.includes("disabled by .mpd config"))
  results.push({
    name: probeCase.name,
    mode: probeCase.flag,
    expectation: probeCase.expect,
    tested_artifact: artifact,
    tested_sha256: probe.serve_sha256_at_run,
    exit_code: probe.exit_code,
    thrown: probe.thrown,
    codegraph_disabled_by_config: disabledHint,
    skipped_hint: probe.skipped_hint.map((line) => line.trim()),
    config_exists_after: probe.config_exists_after,
    config_bytes_before: probe.config_bytes_before,
    config_bytes_after: probe.config_bytes_after,
    config_rewritten: probe.config_rewritten,
    config_after: probe.config_after,
    mpd_tree_created: probe.mpd_tree_created
  })
}

const b1 = results.find((r) => r.name === "b1-mpd-block-disables")
const b2 = results.find((r) => r.name === "b2-foreign-codex-block-inert")
writeFileSync(outJson, JSON.stringify({
  driver: "step-b-retarget",
  artifact,
  artifact_sha256: sha256(artifact),
  falsifiable_pair: {
    question: "does the block NAME decide whether codegraph is configurable?",
    b1_mpd_block_suppressed: b1.codegraph_disabled_by_config,
    b2_foreign_codex_block_suppressed: b2.codegraph_disabled_by_config,
    verdict: b1.codegraph_disabled_by_config && !b2.codegraph_disabled_by_config
      ? "PASS — [mpd] is the project-owned block and a foreign [codex] block is inert"
      : "FAIL — the block name does not decide the outcome"
  },
  runs: results
}, null, 2) + "\n")

for (const run of results) {
  console.log(`${run.name}: disabled=${run.codegraph_disabled_by_config} bytes=${run.config_bytes_before}->${run.config_bytes_after} rewritten=${run.config_rewritten} created=${JSON.stringify(run.mpd_tree_created)}`)
}
