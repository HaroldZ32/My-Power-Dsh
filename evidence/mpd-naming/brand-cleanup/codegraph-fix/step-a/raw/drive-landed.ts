// STEP A completion proof — runs the probe against the LANDED artifact (no copies,
// no substitutions) and against an untouched-shipped control, so the screen shows
// the behaviour difference on the real bytes.
//
//   landed-artifact-migration-due   : the real packages/mpd-mcp-codegraph/dist/serve.js
//   landed-artifact-already-migrated: same bytes, config already carries the marker
//   control-pre-completion-copy     : the artifact minus the two corrections
//
// Usage: node drive-landed.mjs <rootWorkDir> <outJson>
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const [rootWorkDir, outJson] = process.argv.slice(2)
if (!rootWorkDir || !outJson) {
  console.error("usage: node drive-landed.mjs <rootWorkDir> <outJson>")
  process.exit(2)
}

const artifact = join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js")
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const landed = readFileSync(artifact, "utf8")

// Control: the same file with the two completion corrections reverted, proving the
// screen measures those corrections and not something incidental.
const MOVE_BLOCK = `    // The additive migration rewrites its own target in place; relocating that very
    // document afterwards would delete the config the writer just produced.
    if (move.from === plan.targetPath)
      continue;
`
const PROTECT_LANDED = "  const protectedPaths = new Set([migrationJournalPath(env), migrationLockPath(env)]);"
const PROTECT_REVERTED = "  const protectedPaths = new Set([plan.targetPath, migrationJournalPath(env), migrationLockPath(env)]);"
const control = landed.replace(MOVE_BLOCK, "").replace(PROTECT_LANDED, PROTECT_REVERTED)

const variants = [
  { name: "landed-artifact-migration-due", source: null, noMarker: true, note: "the landed artifact, migration due" },
  { name: "landed-artifact-already-migrated", source: null, noMarker: false, note: "the landed artifact, migration already recorded" },
  { name: "control-pre-completion-copy", source: control, noMarker: true, note: "landed minus the two corrections" }
]

const neutralProject = resolve(join(rootWorkDir, "neutral-project"))
mkdirSync(neutralProject, { recursive: true })

// Hash the control copy while it exists on disk (it is cleaned up per variant below).
mkdirSync(join(rootWorkDir, "variants", "control-pre-completion-copy", "dist"), { recursive: true })
const controlPath = join(rootWorkDir, "variants", "control-pre-completion-copy", "dist", "serve.js")
writeFileSync(controlPath, control)
const controlSha = sha256(controlPath)

const results = []
for (const variant of variants) {
  let artifactPath = artifact
  if (variant.source !== null) {
    const dir = join(rootWorkDir, "variants", variant.name, "dist")
    mkdirSync(dir, { recursive: true })
    artifactPath = join(dir, "serve.js")
    writeFileSync(artifactPath, variant.source)
  }
  const sandbox = resolve(join(rootWorkDir, "sandboxes", variant.name))
  rmSync(sandbox, { recursive: true, force: true })
  const probeOut = join(rootWorkDir, `${variant.name}.json`)
  const args = [join(here, "probe.mjs"), variant.name, sandbox, probeOut]
  if (variant.noMarker) args.push("no-marker")
  execFileSync(process.execPath, args, {
    stdio: "pipe",
    env: {
      ...process.env,
      PROBE_ARTIFACT: artifactPath,
      PWD: neutralProject,
      MPD_CODEGRAPH_BIN: "/nonexistent/mpd-codegraph-probe-unavailable"
    }
  })
  const probe = JSON.parse(readFileSync(probeOut, "utf8"))
  results.push({
    name: variant.name,
    note: variant.note,
    tested_artifact: artifactPath,
    tested_sha256: probe.serve_sha256_at_run,
    migration_triggered: variant.noMarker,
    exit_code: probe.exit_code,
    thrown: probe.thrown,
    config_exists_after: probe.config_exists_after,
    config_bytes_before: probe.config_bytes_before,
    config_bytes_after: probe.config_bytes_after,
    config_rewritten: probe.config_rewritten,
    config_after: probe.config_after,
    mpd_tree_created: probe.mpd_tree_created
  })
  if (variant.source !== null) rmSync(join(rootWorkDir, "variants", variant.name), { recursive: true, force: true })
}

writeFileSync(outJson, JSON.stringify({
  driver: "step-a-completion-landed",
  artifact,
  artifact_sha256: sha256(artifact),
  corrections: {
    backup_move_skip: "executePlan backup-move loop: skip when move.from === plan.targetPath",
    protected_paths: "executePlan protectedPaths: plan.targetPath removed"
  },
  control_reverted_copy_sha256: controlSha,
  runs: results
}, null, 2) + "\n")

for (const run of results) {
  console.log(`${run.name}: sha=${run.tested_sha256.slice(0, 12)} exists_after=${run.config_exists_after} bytes=${run.config_bytes_before}->${run.config_bytes_after} created=${JSON.stringify(run.mpd_tree_created)}`)
}
