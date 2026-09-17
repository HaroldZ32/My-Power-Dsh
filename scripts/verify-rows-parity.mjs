#!/usr/bin/env node
// B9 row-parity guard: the legacy installer (scripts/install-profile.mjs) must
// declare the SAME row-id set as the bundle patch's `- insert:` lists
// (packages/mpd-bundle/cordis.patch.yml). The measured defect this locks out:
// the installer and the patch once declared DIFFERENT row-id sets, so an
// install-profile install silently mounted none of the rows only the patch
// carried while `--dump-config` still looked healthy.
//
// Gate story: run it exactly like the other repo-level guard,
// `node ./scripts/verify-rows-parity.mjs` (cf. `node ./scripts/verify-vendor.mjs`).
// Exit 0 = parity.
//
// The installer's set is MEASURED by running it in --dry-run against a throwaway
// --dsh-home (every row then renders as an insert and nothing is written), never
// by scraping its source: the printed patch is exactly what a legacy install
// would write. The patch's set comes from its `- insert:` blocks only — the
// file's one column-0 id-target (`agent-presets`) is not an installer row, and
// commented-out rows (`# - id: …`) are skipped by construction.
//
// Lives under scripts/ (NOT skills/**) on purpose: skills/** is VENDOR_LOCK
// fingerprinted, and editing it would force a treeSha re-pin in the same commit.
//
// T-68 (wave 2b, lane B) adds `--self-test`. Before it this guard shipped NO
// self-test arm, so a parity guard that cannot be shown to redden was an
// assertion about its own source rather than an instrument. The arms are
// HERMETIC by construction: every one drives the SAME comparison over a TEMP
// fixture patch and a TEMP fixture installer, and the run asserts that the LIVE
// patch's bytes and mtime are untouched (the NEG CONTROL the acceptance names) —
// so another lane's patch edit can never redden the self-test, and the
// self-test can never touch the live tree.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const repoRoot = dirname(dirname(SELF))
const PATCH_PATH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const INSTALLER_PATH = join(repoRoot, "scripts", "install-profile.mjs")
const PREFIX = "[verify-rows-parity]"

// Row ids declared by the bundle patch's `- insert:` blocks: entries are
// 4-space indented (`    - id: X`) under a column-0 `- insert:`. Commented-out
// rows (4 spaces + `#`) and deeper nested config keys never match.
function bundleInsertIds(patchText) {
  const ids = []
  let inInsert = false
  for (const raw of patchText.split(/\r?\n/)) {
    if (/^- insert:\s*$/.test(raw)) { inInsert = true; continue }
    if (!inInsert) continue
    if (raw.trim() === "") continue
    if (!raw.startsWith(" ")) { inInsert = false; continue }
    const m = raw.match(/^ {4}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/)
    if (m) ids.push(m[1])
  }
  return ids
}

// Row ids the installer declares, read from its own dry-run render (rows land at
// indent 0 as id-targets or indent 2 as inserts; deeper lines are config).
// Parameterized so `--self-test` drives a FIXTURE installer through the same
// code path the live run uses.
function installerRowIds(installerPath) {
  const scratch = mkdtempSync(join(tmpdir(), "mpd-rows-parity-home-"))
  try {
    const r = spawnSync(process.execPath, [installerPath, "--dry-run", "--dsh-home", scratch], { encoding: "utf8" })
    if (r.error || r.status !== 0) {
      return { ok: false, ids: [], error: installerPath + " --dry-run exited " + r.status + (r.error ? " (" + r.error.message + ")" : ""), stderr: String(r.stderr ?? "") }
    }
    const ids = []
    for (const m of String(r.stdout ?? "").matchAll(/^ {0,2}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/gm)) ids.push(m[1])
    return { ok: true, ids, error: null, stderr: "" }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function duplicates(ids) {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
}

/** The pure comparison over explicit inputs, so the live run and every fixture drive ONE rule. */
function compareRowSets({ patchText, installerIds }) {
  const patchIds = bundleInsertIds(patchText)
  const patchSet = new Set(patchIds)
  const installerSet = new Set(installerIds)
  // Directional sets: `missing` is declared by the patch but absent from the
  // installer (the B9 shape); `extra` is the reverse.
  const missing = [...patchSet].filter((id) => !installerSet.has(id))
  const extra = [...installerSet].filter((id) => !patchSet.has(id))
  return { patchSet, installerSet, missing, extra, patchDup: duplicates(patchIds), installerDup: duplicates(installerIds) }
}

/** The live read: unchanged behaviour, now driven by the shared comparison. */
function liveRun(opts) {
  const installerRun = installerRowIds(opts.installerPath)
  if (!installerRun.ok) {
    console.error(PREFIX + " FAIL - " + installerRun.error)
    if (installerRun.stderr) console.error(String(installerRun.stderr).trim())
    process.exit(1)
  }
  const cmp = compareRowSets({ patchText: readFileSync(opts.patchPath, "utf8"), installerIds: installerRun.ids })

  // Guard-1 (t8 / R7.15): a run with ZERO subjects is a degraded run, not a pass. Without this,
  // a patch that declares no `- insert:` block (or an installer that prints nothing) made the
  // comparison below trivially true and the gate exited 0 while checking nothing.
  if (cmp.patchSet.size === 0 || cmp.installerSet.size === 0) {
    const empty = [cmp.patchSet.size === 0 ? "the bundle patch declares no '- insert:' row ids" : "", cmp.installerSet.size === 0 ? "the installer declares no row ids" : ""].filter(Boolean)
    console.error(PREFIX + " FAIL - zero-subject run: " + empty.join(" and ") + " - refusing to report PASS with nothing to compare")
    process.exit(1)
  }
  if (cmp.missing.length || cmp.extra.length || cmp.patchDup.length || cmp.installerDup.length) {
    console.error(PREFIX + " FAIL - installer vs bundle patch row ids differ")
    console.error("  bundle patch inserts (" + cmp.patchSet.size + "): " + [...cmp.patchSet].join(", "))
    console.error("  installer rows       (" + cmp.installerSet.size + "): " + [...cmp.installerSet].join(", "))
    if (cmp.missing.length) console.error("  MISSING from scripts/install-profile.mjs: " + cmp.missing.join(", "))
    if (cmp.extra.length) console.error("  EXTRA in scripts/install-profile.mjs (not in the patch): " + cmp.extra.join(", "))
    if (cmp.patchDup.length) console.error("  DUPLICATE ids in the bundle patch: " + cmp.patchDup.join(", "))
    if (cmp.installerDup.length) console.error("  DUPLICATE ids in the installer: " + cmp.installerDup.join(", "))
    process.exit(1)
  }
  if (!opts.quiet) console.log(PREFIX + " ok: " + cmp.installerSet.size + " row ids match the bundle patch insert list (" + [...cmp.installerSet].sort().join(", ") + ")")
}

// ---------------------------------------------------------------------------
// self-test (T-68) — every arm on TEMP fixtures; the live inputs are read-only
// ---------------------------------------------------------------------------

const FIXTURE_INSTALLER_TEMPLATE = `#!/usr/bin/env node
// Fixture installer written by verify-rows-parity.mjs --self-test: renders the row ids of ONE
// fixture in the same shape the real installer prints (indent 0 id-targets / indent 2 inserts).
const ROWS = __ROWS__
for (const id of ROWS) console.log("- id: " + id)
process.exit(0)
`

const fixturePatch = (ids) => ["- insert:", ...ids.map((id) => "    - id: " + id), ""].join("\n")

function childRun(args) {
  const r = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  return { status: r.status, out: String(r.stdout ?? ""), err: String(r.stderr ?? ""), all: String(r.stdout ?? "") + String(r.stderr ?? "") }
}

function selfTest() {
  const arms = []
  const arm = (name, ok, detail) => arms.push({ name, ok: Boolean(ok), detail })
  const startedAt = Date.now()
  const livePatchText = readFileSync(PATCH_PATH, "utf8")
  const livePatchMtime = statSync(PATCH_PATH).mtimeMs
  const liveInstallerMtime = statSync(INSTALLER_PATH).mtimeMs
  const scratch = mkdtempSync(join(tmpdir(), "mpd-rows-parity-selftest-"))
  try {
    const installerFor = (name, ids) => {
      const p = join(scratch, name)
      writeFileSync(p, FIXTURE_INSTALLER_TEMPLATE.replace("__ROWS__", JSON.stringify(ids)))
      return p
    }
    const goodPatch = join(scratch, "good.patch.yml")
    writeFileSync(goodPatch, fixturePatch(["row-a", "row-b", "row-c"]))
    const driftPatch = join(scratch, "drift.patch.yml")
    writeFileSync(driftPatch, fixturePatch(["row-a", "row-b", "row-c", "row-d"]))
    const emptyPatch = join(scratch, "empty.patch.yml")
    writeFileSync(emptyPatch, "# no insert block at all\n")

    // (a) fixture parity -> exit 0, the ids are named
    const a = childRun(["--patch", goodPatch, "--installer", installerFor("fx-parity.mjs", ["row-a", "row-b", "row-c"])])
    arm("(a) fixture parity -> exit 0", a.status === 0 && a.out.includes("3 row ids match"), "exit " + a.status + "; " + a.out.trim())

    // (b) SEEDED violation: the patch declares one row the installer does not -> non-zero, fault NAMED
    const b = childRun(["--patch", driftPatch, "--installer", installerFor("fx-missing.mjs", ["row-a", "row-b", "row-c"])])
    arm("(b) seeded missing row -> exit 1 + the fault named", b.status === 1 && b.err.includes("MISSING from") && b.err.includes("row-d"), "exit " + b.status + "; " + (b.err.split("\n").find((l) => l.includes("MISSING")) ?? "(no MISSING line)"))

    // (c) the reverse direction is named too (an installer-only row)
    const c = childRun(["--patch", goodPatch, "--installer", installerFor("fx-extra.mjs", ["row-a", "row-b", "row-c", "row-z"])])
    arm("(c) installer-only row -> exit 1 + EXTRA named", c.status === 1 && c.err.includes("EXTRA in") && c.err.includes("row-z"), "exit " + c.status + "; " + (c.err.split("\n").find((l) => l.includes("EXTRA")) ?? "(no EXTRA line)"))

    // (d) duplicate ids are a fault, not a set-equality pass
    const d = childRun(["--patch", goodPatch, "--installer", installerFor("fx-dup.mjs", ["row-a", "row-a", "row-b", "row-c"])])
    arm("(d) duplicate installer id -> exit 1 + DUPLICATE named", d.status === 1 && d.err.includes("DUPLICATE"), "exit " + d.status + "; " + (d.err.split("\n").find((l) => l.includes("DUPLICATE")) ?? "(no DUPLICATE line)"))

    // (e) zero-subject guard: a patch with no insert block must never pass
    const e = childRun(["--patch", emptyPatch, "--installer", installerFor("fx-empty.mjs", ["row-a"])])
    arm("(e) zero-subject patch -> exit 1 (degraded, never a pass)", e.status === 1 && e.err.includes("zero-subject"), "exit " + e.status)

    // (f) hermeticity: fixtures live in a temp dir, and the LIVE inputs are untouched by the run
    const livePatchMtimeAfter = statSync(PATCH_PATH).mtimeMs
    arm(
      "(f) hermetic: temp fixtures only; the live patch's bytes + mtime are unchanged",
      scratch.startsWith(tmpdir()) && readFileSync(PATCH_PATH, "utf8") === livePatchText && livePatchMtimeAfter === livePatchMtime && statSync(INSTALLER_PATH).mtimeMs === liveInstallerMtime,
      "fixture root " + scratch + " (temp); live patch bytes unchanged, mtime " + livePatchMtime + " -> " + livePatchMtimeAfter + "; elapsed " + (Date.now() - startedAt) + "ms",
    )
  } catch (error) {
    arm("self-test harness", false, String(error?.stack ?? error))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + String(a.detail).slice(0, 220))
  const failed = arms.filter((a) => !a.ok).length
  console.log(PREFIX + " self-test " + (failed === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed) + "/" + arms.length + " arms")
  return failed === 0 ? 0 : 1
}

function parseArgs(argv) {
  const opts = { patchPath: PATCH_PATH, installerPath: INSTALLER_PATH, selfTest: false, quiet: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--self-test") opts.selfTest = true
    else if (a === "--quiet") opts.quiet = true
    else if (a === "--patch") opts.patchPath = resolve(argv[++i] ?? "")
    else if (a === "--installer") opts.installerPath = resolve(argv[++i] ?? "")
    else {
      console.error(PREFIX + " FAIL - unknown argument: " + a)
      console.error("usage: node ./scripts/verify-rows-parity.mjs [--patch <path>] [--installer <path>] [--quiet] [--self-test]")
      process.exit(2)
    }
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.selfTest) process.exit(selfTest())
liveRun(opts)
