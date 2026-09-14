// STEP A causality driver — WHY the startup migration never executes.
//
// Same probe, same seeded document; variants differ only in (a) the artifact bytes
// and (b) whether the seeded config already carries the migration marker ("trigger").
//
//   v1 shipped + trigger          -> shipped bytes, migration due
//   v2 rename-only + trigger      -> the one-token EMPTY_MPD_CONFIG rename applied
//   v3 rename-only, no trigger    -> guard passes; only the dangling identifier can block
//   v4 full remedy, no trigger    -> rename + target-path protection carve-out
//
// Expected: v1 and v2 abort inside assertSafeSourcePaths ("Migration source is
// protected"), so the dangling identifier is never reached on those runs; v3 gets
// past the guard and then throws the ReferenceError (captured by the instrumented
// twin built here); v4 actually migrates, backing up and rewriting the config.
//
// Usage: node driver.mjs <rootWorkDir> <outJson>
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const [rootWorkDir, outJson] = process.argv.slice(2)
if (!rootWorkDir || !outJson) {
  console.error("usage: node driver.mjs <rootWorkDir> <outJson>")
  process.exit(2)
}

const artifact = join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js")
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const artifactSha = sha256(artifact)
const shipped = readFileSync(artifact, "utf8")
const dangling = shipped.split("EMPTY_OMO_CONFIG").length - 1

const RENAME_FROM = "let content = EMPTY_OMO_CONFIG;"
const RENAME_TO = "let content = EMPTY_MPD_CONFIG;"
const PROTECT_FROM = "  const protectedPaths = new Set([plan.targetPath, migrationJournalPath(env), migrationLockPath(env)]);"
const PROTECT_TO = "  const protectedPaths = new Set([migrationJournalPath(env), migrationLockPath(env)]);"

const renameOnly = shipped.replace(RENAME_FROM, RENAME_TO)
const fullRemedy = renameOnly.replace(PROTECT_FROM, PROTECT_TO)
// Twin of v3 carrying ONLY stderr instrumentation, so the swallowed ReferenceError
// is observable from outside; the functional bytes are otherwise identical.
const CATCH_FROM = `  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,`
const instrumented = renameOnly.replace(CATCH_FROM, `  } catch (error) {
    process.stderr.write("[probe-instrumentation] migration threw: " + (error instanceof Error ? error.stack : String(error)) + "\\n");
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,`)

// Remedy B adds a second correction on top of v4: the source move must not
// relocate the very document the writer just rewrote (additive mode).
const MOVE_FROM = `  for (const move of targetRecorded.backupMoves) {
    input.renewLock();
    if (fileSystem.existsSync(move.to))`
const MOVE_TO = `  for (const move of targetRecorded.backupMoves) {
    input.renewLock();
    if (move.from === plan.targetPath)
      continue;
    if (fileSystem.existsSync(move.to))`
const remedyB = fullRemedy.replace(MOVE_FROM, MOVE_TO)

const variants = [
  { name: "v1-shipped-with-trigger", source: shipped, noMarker: false, note: "shipped artifact, migration due" },
  { name: "v2-rename-only-with-trigger", source: renameOnly, noMarker: false, note: "rename applied, migration due" },
  { name: "v3-rename-only-no-trigger", source: renameOnly, noMarker: true, note: "rename applied, guard passes" },
  { name: "v3b-rename-only-instrumented", source: instrumented, noMarker: true, note: "same bytes + stderr instrumentation on the catch" },
  { name: "v4-protection-carveout-no-trigger", source: fullRemedy, noMarker: true, note: "rename + protection carve-out" },
  { name: "v5-remedy-b-no-trigger", source: remedyB, noMarker: true, note: "rename + protection carve-out + no self-move" }
]

const neutralProject = resolve(join(rootWorkDir, "neutral-project"))
mkdirSync(neutralProject, { recursive: true })

const results = []
for (const variant of variants) {
  const dir = join(rootWorkDir, "variants", variant.name, "dist")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "serve.js")
  writeFileSync(file, variant.source)
  const sandbox = resolve(join(rootWorkDir, "sandboxes", variant.name))
  rmSync(sandbox, { recursive: true, force: true })
  const probeOut = join(rootWorkDir, `${variant.name}.json`)
  const args = [join(here, "probe.mjs"), variant.name, sandbox, probeOut]
  if (variant.noMarker) args.push("no-marker")
  execFileSync(process.execPath, args, {
    stdio: "pipe",
    env: {
      ...process.env,
      PROBE_ARTIFACT: file,
      PWD: neutralProject,
      MPD_CODEGRAPH_BIN: "/nonexistent/mpd-codegraph-probe-unavailable"
    }
  })
  const probe = JSON.parse(readFileSync(probeOut, "utf8"))
  results.push({
    name: variant.name,
    note: variant.note,
    artifact_copy_sha256: sha256(file),
    seeded_without_marker: variant.noMarker,
    exit_code: probe.exit_code,
    thrown: probe.thrown,
    config_bytes_before: probe.config_bytes_before,
    config_bytes_after: probe.config_bytes_after,
    mpd_tree_created: probe.mpd_tree_created,
    config_after: probe.config_after,
    instrumentation: (probe.debug_lines ?? []).filter((l) => l.includes("probe-instrumentation")),
    skipped_hint: probe.skipped_hint
  })
  rmSync(join(rootWorkDir, "variants", variant.name), { recursive: true, force: true })
}

const renameApplied = renameOnly !== shipped
const protectApplied = fullRemedy !== renameOnly
const moveApplied = remedyB !== fullRemedy
writeFileSync(outJson, JSON.stringify({
  driver: "step-a-causality",
  artifact,
  artifact_sha256: artifactSha,
  dangling_identifier_occurrences_shipped: dangling,
  substitutions: {
    rename: { from: RENAME_FROM, to: RENAME_TO, applied_in_driver: renameApplied },
    protection: { from: PROTECT_FROM.trim(), to: PROTECT_TO.trim(), applied_in_driver: protectApplied },
    self_move_skip: { from: "if (fileSystem.existsSync(move.to))", to: "if (move.from === plan.targetPath) continue;", applied_in_driver: moveApplied }
  },
  variants: results
}, null, 2) + "\n")

for (const run of results) {
  console.log(`${run.name}: bytes=${run.config_bytes_before}->${run.config_bytes_after} created=${JSON.stringify(run.mpd_tree_created)} instr=${run.instrumentation.length}`)
}
console.log(`substitutions applied: rename=${renameApplied} protection=${protectApplied}`)
