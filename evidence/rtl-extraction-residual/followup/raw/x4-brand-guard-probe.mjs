#!/usr/bin/env node
// t20 / X4 brand-guard proof harness. Drives the EXPORTED guard through child processes so each
// lane's real exit code is observable. Nothing outside evidence/rtl-extraction-residual/followup/raw/
// is written; the committed dists are only READ.
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const TEXT_FILE = join(here, "x4-lane-text.js")
const repoRoot = "/root/dshProj/my-power-dsh"
const BUILD = join(repoRoot, "scripts", "build-mcp.mjs")
const ARTIFACTS = [
  { name: "ast-grep", path: join(repoRoot, "packages/mpd-mcp-astgrep/dist/cli.js") },
  { name: "git-bash", path: join(repoRoot, "packages/mpd-mcp-gitbash/dist/cli.js") },
  { name: "lsp", path: join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js") },
]

/** Run the guard in a child process over a file, returning its exit code + output. */
function runGuard(artifact, file) {
  const code = `import(${JSON.stringify(BUILD)}).then(async (m) => { const fs = await import("node:fs"); const r = m.assertBrandClean(${JSON.stringify(artifact)}, fs.readFileSync(${JSON.stringify(file)}, "utf8")); console.log("brand-scan " + JSON.stringify(r)); })`
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: repoRoot, encoding: "utf8", timeout: 120000 })
  return { exit: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() }
}

/** Run the REAL scrub + guard pair on a text (primary-subject lane). */
function runScrubThenGuard(artifact, text) {
  writeFileSync(TEXT_FILE, text)
  const code = `import(${JSON.stringify(BUILD)}).then(async (m) => { const fs = await import("node:fs"); const scrubbed = m.applyMpdScrub(${JSON.stringify(artifact)}, fs.readFileSync(${JSON.stringify(TEXT_FILE)}, "utf8")); const r = m.assertBrandClean(${JSON.stringify(artifact)}, scrubbed); console.log("brand-scan " + JSON.stringify(r)); })`
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: repoRoot, encoding: "utf8", timeout: 120000 })
  return { exit: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() }
}

/** Run the PRIMARY byte-comparison guard on an artifact text vs its committed dist. */
function runByteCompare(artifact, text, committedPath) {
  writeFileSync(TEXT_FILE, text)
  const code = `import(${JSON.stringify(BUILD)}).then(async (m) => { const fs = await import("node:fs"); const r = m.assertRebuildMatchesCommitted(${JSON.stringify(artifact)}, fs.readFileSync(${JSON.stringify(TEXT_FILE)}, "utf8"), ${JSON.stringify(committedPath)}); console.log("byte-compare " + JSON.stringify(r)); })`
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: repoRoot, encoding: "utf8", timeout: 120000 })
  return { exit: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() }
}

const lanes = {}

// Lane 1 — the committed dists must PASS the guard (the guard must not reject the current bytes).
lanes.committed = ARTIFACTS.map((a) => ({ artifact: a.name, ...runGuard(a.name, a.path) }))

// Lane 0a — PRIMARY GUARD, direction (1): an intact rebuild (the committed bytes themselves) must
// compare equal, with a non-zero byte count so an empty comparison cannot pass vacuously.
lanes.byteCompareEqual = ARTIFACTS.map((a) => ({ artifact: a.name, ...runByteCompare(a.name, readFileSync(a.path, "utf8"), a.path) }))

// Lane 0b — PRIMARY GUARD, direction (2): a SEEDED mutant (an un-scrubbed spelling restored) must
// fail non-zero, naming the artifact and the first differing character.
const mutant = readFileSync(ARTIFACTS[1].path, "utf8") + "\n// seeded mutant: an un-scrubbed spelling restored\nconst usage = \"Usage: omo-git-bash [mcp]\";\n"
lanes.byteCompareMutant = { artifact: "git-bash", seed: "Usage: omo-git-bash [mcp]", ...runByteCompare("git-bash", mutant, ARTIFACTS[1].path) }

// Lane 2 — negative control: a seeded foreign token must make the guard FAIL, naming token + artifact.
const seeded = join(here, "x4-seeded-git-bash.js")
writeFileSync(seeded, readFileSync(ARTIFACTS[1].path, "utf8") + "\n// seeded by the t20 negative control\nconst OMO_PROVISION_HINT = 1;\n")
lanes.seeded = { artifact: "git-bash", token: "OMO_PROVISION_HINT", ...runGuard("git-bash", seeded) }

// Lane 2b — PRIMARY SUBJECT: the real git-bash scrub passes a bare `omo-git-bash` through, and the
// guard must then fail (this is the mechanic the correction identifies).
lanes.primarySubject = { artifact: "git-bash", seed: "Usage: omo-git-bash [options]", ...runScrubThenGuard("git-bash", 'const usage = "Usage: omo-git-bash [options]";\n') }

// Lane 3 — false-positive control: identifiers that merely CONTAIN "omo" across a morpheme boundary
// must not trip the guard (this is why the scrub was never widened to a global replace).
const fp = join(here, "x4-false-positive.js")
writeFileSync(fp, "export const projectRootFromOpenCodeConfigPath = 1;\nexport const platformFromOptions = 2;\nexport const from = 3;\n")
lanes.falsePositive = { ...runGuard("lsp", fp) }

// Lane 4 — empty-subject control: an empty artifact is not a pass.
const empty = join(here, "x4-empty.js")
writeFileSync(empty, "")
lanes.emptySubject = { ...runGuard("lsp", empty) }

const checks = {
  "committed dists: guard exits 0 for all three and reports non-zero subjects": lanes.committed.every((l) => l.exit === 0 && /"identifiers":\d+/.test(l.stdout)) && lanes.committed.every((l) => !/"identifiers":0/.test(l.stdout)),
  "negative control: seeded OMO_PROVISION_HINT fails non-zero naming token + artifact": lanes.seeded.exit !== 0 && lanes.seeded.stderr.includes("OMO_PROVISION_HINT") && lanes.seeded.stderr.includes("git-bash"),
  "primary subject: scrub passes `omo-git-bash` through and the guard names it in full": lanes.primarySubject.exit !== 0 && lanes.primarySubject.stderr.includes("\"omo-git-bash\"") && lanes.primarySubject.stderr.includes("git-bash"),
  "primary byte comparison (1): intact artifacts compare equal with non-zero byte counts": lanes.byteCompareEqual.every((l) => l.exit === 0 && /"compared":1/.test(l.stdout) && !/"bytes":0/.test(l.stdout)),
  "primary byte comparison (2): seeded mutant fails non-zero naming artifact + diff": lanes.byteCompareMutant.exit !== 0 && lanes.byteCompareMutant.stderr.includes("git-bash") && lanes.byteCompareMutant.stderr.includes("differs from the committed dist"),
  "false-positive control: platformRootFromOpenCodeConfigPath / platformFromOptions exit 0": lanes.falsePositive.exit === 0,
  "empty-subject control: an empty scan fails non-zero": lanes.emptySubject.exit !== 0 && lanes.emptySubject.stderr.includes("0 identifiers inspected"),
}
const result = { generatedAt: new Date().toISOString(), buildScript: BUILD, lanes, checks, ok: Object.values(checks).every(Boolean) }
mkdirSync(here, { recursive: true })
writeFileSync(join(here, "x4-brand-guard-result.json"), JSON.stringify(result, null, 2) + "\n")
for (const [name, pass] of Object.entries(checks)) console.log((pass ? "PASS  " : "FAIL  ") + name)
console.log("brand guard proof ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
