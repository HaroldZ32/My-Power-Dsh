#!/usr/bin/env node
// B9 row-parity guard: the legacy installer (scripts/install-profile.mjs) must
// declare the SAME row-id set as the bundle patch's `- insert:` lists
// (packages/mpd-bundle/cordis.patch.yml). The measured defect this locks out:
// the installer and the patch once declared DIFFERENT row-id sets, so an
// install-profile install silently mounted none of the rows only the patch
// carried while `--dump-config` still looked healthy.
//
// Gate story: run it exactly like the other repo-level guard,
// `node scripts/verify-rows-parity.mjs` (cf. `node scripts/verify-vendor.mjs` /
// `bun run verify:vendor`). Exit 0 = parity. It is deliberately NOT added to
// package.json here — package.json is outside this change's scope — so the
// integration step may add
//   "verify:rows": "node scripts/verify-rows-parity.mjs"
// to the scripts block.
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
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const PATCH_PATH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const INSTALLER_PATH = join(repoRoot, "scripts", "install-profile.mjs")

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
function installerRowIds() {
  const scratch = mkdtempSync(join(tmpdir(), "mpd-rows-parity-"))
  try {
    const r = spawnSync(process.execPath, [INSTALLER_PATH, "--dry-run", "--dsh-home", scratch], { encoding: "utf8" })
    if (r.error || r.status !== 0) {
      console.error("[verify-rows-parity] FAIL - scripts/install-profile.mjs --dry-run exited " + r.status + (r.error ? " (" + r.error.message + ")" : ""))
      if (r.stderr) console.error(String(r.stderr).trim())
      process.exit(1)
    }
    const ids = []
    for (const m of String(r.stdout ?? "").matchAll(/^ {0,2}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/gm)) ids.push(m[1])
    return ids
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function duplicates(ids) {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
}

const patchIds = bundleInsertIds(readFileSync(PATCH_PATH, "utf8"))
const installerIds = installerRowIds()
const patchSet = new Set(patchIds)
const installerSet = new Set(installerIds)
// Directional sets: `missing` is declared by the patch but absent from the
// installer (the B9 shape); `extra` is the reverse.
const missing = [...patchSet].filter((id) => !installerSet.has(id))
const extra = [...installerSet].filter((id) => !patchSet.has(id))
const patchDup = duplicates(patchIds)
const installerDup = duplicates(installerIds)

if (missing.length || extra.length || patchDup.length || installerDup.length) {
  console.error("[verify-rows-parity] FAIL - installer vs bundle patch row ids differ")
  console.error("  bundle patch inserts (" + patchSet.size + "): " + [...patchSet].join(", "))
  console.error("  installer rows       (" + installerSet.size + "): " + [...installerSet].join(", "))
  if (missing.length) console.error("  MISSING from scripts/install-profile.mjs: " + missing.join(", "))
  if (extra.length) console.error("  EXTRA in scripts/install-profile.mjs (not in the patch): " + extra.join(", "))
  if (patchDup.length) console.error("  DUPLICATE ids in the bundle patch: " + patchDup.join(", "))
  if (installerDup.length) console.error("  DUPLICATE ids in the installer: " + installerDup.join(", "))
  process.exit(1)
}
console.log("[verify-rows-parity] ok: " + installerSet.size + " row ids match the bundle patch insert list (" + [...installerSet].sort().join(", ") + ")")
