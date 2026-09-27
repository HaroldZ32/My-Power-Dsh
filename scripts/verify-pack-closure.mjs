#!/usr/bin/env node
// F11 packer-closure guard: every plugin package the bundle patch MOUNTS must be
// listed by the packer, and every package the packer lists must still exist.
//
// The measured defect class this locks out (four occurrences, so it earned a gate
// instead of a plan note): `scripts/pack-mpd.mjs` copies `packages/<pkg>/dist` for
// the packages in its own hard-coded lists. A package mounted by the bundle patch
// but absent from those lists is simply NOT copied — and because the packer only
// reports packages whose `dist` is missing, `npm run pack` still exits 0 while the
// packed tree omits the package and the packed boot dies ERR_MODULE_NOT_FOUND on
// that row. Occurrences: mpd-team-compact-plugin, mpd-ext-plugin, mpd-tui-plugin
// and (caught by the packer's own positive check, never shipped)
// mpd-team-watchdog-plugin — `evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/output.log:97`.
//
// THE RULE IS THE PATCH-ROW RULE (captain ruling, plan `.mpd/plans/ext-template-and-guides.md`
// §9 "Captain addendum", ratifying the correction recorded here):
//   every `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` row of the bundle patch must
//   be in PLUGIN_PKGS ∪ MCP_PKGS, and every list entry must have a real
//   `packages/<pkg>` directory.
// It is deliberately NOT "every `packages/*-plugin` directory must be listed".
// That glob rule is BORN BROKEN: `packages/mpd-agent-teams-plugin` is deliberately
// absent from PLUGIN_PKGS because it is adopted first-class main code (MIT) copied
// WHOLESALE — `cpSync(join(repoRoot, "packages", "mpd-agent-teams-plugin"), …,
// { recursive: true, filter: … })` at scripts/pack-mpd.mjs:111 — and the patch mounts
// it as `…/lib/index.js`, never `…/dist/index.js`; it ships no `dist/` at all, so
// listing it would trip the packer's own missing-dist check. A glob rule would fail
// RED on a healthy tree and read as a regression. Hence the three reference classes
// below, keyed on the patch's real file path, not on a directory name.
//
// Offline and deterministic: it PARSES `scripts/pack-mpd.mjs`'s source for the real
// lists (never a duplicated copy of them) and never invokes the packer.
// `scripts/pack-mpd.mjs` is READ-ONLY for the whole wave; this file only reads it.
//
// TWO HALVES (2026-09-17, lane E of the friction wave):
//   * STATIC — the checker above, over the packer source, the bundle patch and the repo tree.
//     It now also asserts the packer's ROOT_ASSET_DIRS table (the flipped T-35 arm: `templates`
//     and `docs` MUST be declared and MUST exist, see below — the third group the user's
//     decision names, `agent-references`, MUST be declared too and its three named files MUST be
//     in the source tree) and that the packer's VALIDATOR_SHIM_EXPORTS list is exactly the CLI's
//     REQUIRED_COMPILED_EXPORTS list.
//   * PACKED — when `dist/mpd-package/` exists (or `--packed <dir>` is given) it ALSO checks the
//     artifact itself: every declared root asset arrived non-empty, the scaffold template root
//     the CLI hard-codes arrived with its manifest, `docs/`+`templates/`+`agent-references/`
//     match the source set file for file (a dropped doc, a HALF pair, or an invented file is a
//     failure), the three named reference files are present, the packed manifest's
//     `files`/`exports` agree with what is on disk, and the CLI's compiled validator entry is
//     there. `--require-packed` turns an absent artifact into a failure instead of a printed skip.
//
// FLIPPED ARM (captain-visible history): until this wave the checker asserted the OPPOSITE —
// that no `templates` path literal appeared in the packer ("the generic template must never be
// packed", with a negative control that seeded one to prove the assertion discriminated). The
// user decision of 2026-09-17 (ship templates + docs) inverts the invariant, so the arm now
// REQUIRES the declaration instead of forbidding it, and `scripts/pack-mpd.mjs` +
// `scripts/verify-pack-closure.mjs` were flipped in ONE change by the same writer — a half-flip
// would leave the tree red between commits (raised as t6 finding F1).
//
// Gate story: `node scripts/verify-pack-closure.mjs` (exit 0 = closed) and
// `node scripts/verify-pack-closure.mjs --self-test` (both arms: a positive control
// on the real tree and negative controls that replay the historical defect on a TEMP
// fixture, so the checker's falsifiability is proven without touching the real packer).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.mjs"

const SELF = fileURLToPath(import.meta.url)
const repoRoot = dirname(dirname(SELF))
const DEFAULT_PACKER = join(repoRoot, "scripts", "pack-mpd.mjs")
const DEFAULT_CLI = join(repoRoot, "scripts", "mpd-ext.mjs")
const DEFAULT_PACKAGES_DIR = join(repoRoot, "packages")
const DEFAULT_PATCH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const DEFAULT_PACKED = join(repoRoot, "dist", "mpd-package")
const PREFIX = "[verify-pack-closure]"

// The asset classes a PACKED install needs to be author-facing, as decided 2026-09-17:
// `templates` (T-35), `docs` (T-36/T-45) and the ON-DEMAND agent `agent-references`
// (captain's t11 addition, after t16 moved the manual's bulk there). Named here as the groups
// that must never silently vanish again; `skills`/`presets`/`extensions` are asserted the same
// way but were never absent.
const REQUIRED_ROOT_ASSETS = ["templates", "docs", "agent-references"]
// Finding kind per group. The templates/docs decision arm keeps the "TEMPLATES" kind its
// evidence block and self-test arm cite (the flipped arm — see the header), while the reference
// group reports "REFERENCES" so a missing author-critical file is never read as a template
// problem. An unknown group falls back to "ASSET-MISSING".
const ROOT_ASSET_KIND = { templates: "TEMPLATES", docs: "TEMPLATES", "agent-references": "REFERENCES" }
// The three files an external author needs when a boot misbehaves or when they touch the adopted
// plugin (AGENTS.md's on-demand Reference Index). Named because "the directory arrived" is not
// the claim — these files are. English-only: no *.zh-CN.md twin belongs in this group, and
// `bun run verify:docs` does not discover the tree (measured: pairs unchanged).
const REQUIRED_REFERENCE_FILES = ["index.md", "troubleshooting.md", "agent-teams-deltas.md"]
// Root FILES that must ship by NAME (not by directory). Same shape as the reference list above
// and for a sharper reason: the manifest arm below is DECLARATION-DRIVEN — a file present but
// unlisted is loud, a pattern listed but absent is loud, and a file declared NOWHERE is invisible
// by construction. A `files[]` entry alone would therefore make a future REMOVAL loud but never a
// future ADDITION-omission, which is exactly the shape that shipped an artifact whose own README,
// docs/index.md and extension authoring guide linked by relative path to a file it did not carry
// (T-70: ten such links across six shipped files). This list is the source-side expectation, and
// `scripts/pack-mpd.mjs` carries the matching ROOT_FILES table the static half compares it to.
const REQUIRED_ROOT_FILES = ["EXTENSIONS-FOR-AGENTS.md"]
const ROOT_FILE_KIND = "ROOT-FILE"

// T-63 (CONTENT staleness) + T-65 (COMPLETENESS) + T-76 (agent-references by BYTES) - wave 2, lane B.
// Every rule above compares SETS: a file that arrives under the right NAME passes whether or not its
// BYTES are the ones the source tree holds, and - outside docs/templates/agent-references - a declared
// source file that never arrived has no row anywhere. Two rules close that, and they are the ONLY two
// that read file contents:
//   * CONTENT      - every file present on BOTH sides of a verbatim copy must be byte-identical
//                    (`packages/**` and each ROOT_ASSET_DIRS tree). The packer REWRITES three files
//                    and they sit outside the sweep by construction, not by an exemption: the packed
//                    `package.json` (generated), `<packed>/cordis.patch.yml` (dev-flavor rewrite) and
//                    `packages/mpd-ext-plugin/dist/validator.js` (generated shim). Measured 2026-09-17
//                    against the real artifact: 1182 files compared / 1181 identical, the one
//                    difference being the generated `package.json`; under `packages/**` alone 801/801.
//   * COMPLETENESS - every file the packer's own tables say it ships (the ROOT_ASSET_DIRS trees and
//                    every `packages/<pkg>/dist/**` file in the tree) must HAVE an artifact
//                    counterpart. This is the direction no set rule can see: a file with no row.
//                    `packages/mpd-qa-roles-probe` is the ONE declared exemption and it is COUNTED in
//                    the verdict line, so an exemption can never become a silent skip. Measured:
//                    1180 declared source files, 1179 present, 1 exempt, 0 absent.
//
// EXPECTED drift (captain ruling 2026-09-17, frozen in t2): the byte rules run against the REAL
// artifact while the wave's other lanes legitimately write the source tree. A divergence whose source
// file was written AFTER the artifact's stamp is printed as a provenance-NAMED expected reading (the
// path, both digests, the writer's mtime, the stamp and the anchor the stamp came from) and does NOT
// redden the gate - a silent pass would hide exactly the drift this rule exists to expose. Every other
// divergence is a hard CONTENT-DRIFT. The stamp is INFERRED, never asserted (see artifactStamp).
const CONTENT_KIND = "CONTENT-DRIFT"
const COMPLETENESS_KIND = "COMPLETENESS"
const EXPECTED_KIND = "CONTENT-DRIFT-EXPECTED"
// A divergence is expected only when the source is STRICTLY newer than the stamp: no slack, because a
// slack window is indistinguishable from a real stale artifact that was simply written moments later.
// BOUND, stated because the claim is weaker than "the artifact is authentic": the discriminator is the
// TIMESTAMP ORDER, not content provenance — the artifact carries no per-file digest manifest, so a
// mutation INSIDE an artifact whose source file also carries a post-pack mtime is classified expected
// (reported loudly, never silently). Pin the stamp with `--pack-stamp <iso>` when the inference cannot
// hold: an artifact somebody wrote into since the pack, or a copy whose mtimes were not preserved.
const EXPECTED_SLACK_MS = 0
const PACK_EXEMPT_PATHS = [
  {
    prefix: "packages/mpd-qa-roles-probe/",
    why: "QA-only probe, mounted by a QA overlay and never by the shipped patch - the packer's own PLUGIN_PKGS comment says so verbatim (scripts/pack-mpd.mjs, mpd-team-compact-plugin entry): \"mpd-qa-roles-probe is deliberately absent because it is QA-only and mounted by an overlay, never by the shipped patch\"",
  },
]

// Package path references of the bundle patch, in both spellings it uses:
// `@mpd-dsh/mpd/packages/<pkg>/<rel>` and the CLI form
// `node_modules/@mpd-dsh/mpd/packages/<pkg>/<rel>`.
const PATH_REF_RE = /mpd\/packages\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)/g

// Mini-lexer over ONE `const <NAME> = [ … ]` literal: returns its double-quoted
// entries plus the span of the literal. Comments (`// …`) and single-quoted/backtick
// strings are skipped as units, so an apostrophe or an escaped slash inside a COMMENT
// can never unbalance the scan. Measured trap: a naive quote tracker treated the
// apostrophe in "the extension wave's QA lane" as a string opener, ran off the end of
// the file and reported 37 phantom entries (LICENSE, dist, utf8, …) — the check then
// failed on a healthy tree. Null = the literal is absent or unterminated.
function scanArrayLiteral(src, constName) {
  const anchor = new RegExp("const\\s+" + constName + "\\s*=\\s*\\[")
  const m = anchor.exec(src)
  if (!m) return null
  const start = m.index + m[0].length - 1
  const entries = []
  let depth = 0
  let quote = null
  let comment = false
  for (let i = start; i < src.length; i += 1) {
    const c = src[i]
    if (comment) { if (c === "\n") comment = false; continue }
    if (quote) {
      if (c === "\\") { i += 1; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "/" && src[i + 1] === "/") { comment = true; i += 1; continue }
    if (c === '"') {
      let val = ""
      let j = i + 1
      for (; j < src.length; j += 1) {
        if (src[j] === "\\") { val += src[j + 1] ?? ""; j += 1; continue }
        if (src[j] === '"') break
        val += src[j]
      }
      if (depth >= 1) entries.push(val)
      i = j
      continue
    }
    if (c === "'" || c === "`") { quote = c; continue }
    if (c === "[") { depth += 1; continue }
    if (c === "]") {
      depth -= 1
      if (depth === 0) return { entries, start, end: i }
    }
  }
  return null
}

// The packer's real package list, parsed from its source. Null = literal not found,
// which is a FINDING (never a silent empty comparison).
function readPackageList(src, constName) {
  const span = scanArrayLiteral(src, constName)
  if (span === null) return null
  return span.entries.filter((s) => s.length > 0)
}

/** Every file below `root`, as sorted `/`-separated paths. Absent root = []. */
function treeFiles(root) {
  const out = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = prefix === "" ? entry.name : prefix + "/" + entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), child)
      else if (entry.isFile()) out.push(child)
    }
  }
  if (existsSync(root)) walk(root, "")
  return out.sort()
}

/** `a/b.zh-CN.md` <-> `a/b.md`; undefined for a file that carries no language suffix rule. */
function twinName(file) {
  if (file.endsWith(".zh-CN.md")) return file.slice(0, -".zh-CN.md".length) + ".md"
  if (file.endsWith(".md")) return file.slice(0, -".md".length) + ".zh-CN.md"
  return undefined
}

/**
 * The scaffold template the CLI copies, DERIVED from its source instead of hard-coded here:
 * `scripts/mpd-ext.mjs` declares `const TEMPLATE_DIR = join(repoRoot, "<a>", "<b>")` and
 * `const MANIFEST_FILE = sdk.MPD_EXT_CONTRACT.manifestFile`, and the SDK names the file
 * through a constant. Null = the shape changed, which is a FINDING (never a guess).
 */
function resolveCliTemplate(cliSrc, sdkSrc) {
  const dir = /const\s+TEMPLATE_DIR\s*=\s*join\(repoRoot,\s*"([^"]+)",\s*"([^"]+)"\)/.exec(cliSrc)
  const ref = /manifestFile:\s*([A-Za-z0-9_]+)/.exec(sdkSrc)
  if (dir === null || ref === null) return null
  const file = new RegExp("const\\s+" + ref[1] + "\\s*=\\s*\"([^\"]+)\"").exec(sdkSrc)
  if (file === null) return null
  return { segments: [dir[1], dir[2]], manifestFile: file[1] }
}

// Reference class of a patch row, keyed on the FILE the row mounts:
//   A  `dist/index.js` — a built plugin package: MUST be in PLUGIN_PKGS ∪ MCP_PKGS.
//   B  `lib/index.js`  — adopted main code copied wholesale (no dist/): the package
//                        directory must exist and it must NOT be in the lists.
//   C  anything else   — e.g. `launch.mjs` / `dist/cli.js` for an MCP server:
//                        MUST be in PLUGIN_PKGS ∪ MCP_PKGS.
function classifyRef(rel) {
  if (rel === "dist/index.js") return "A"
  if (rel === "lib/index.js") return "B"
  return "C"
}

function patchPackageRefs(patchText) {
  const refs = new Map()
  for (const m of patchText.matchAll(PATH_REF_RE)) {
    const key = m[1] + "/" + m[2]
    if (!refs.has(key)) refs.set(key, { pkg: m[1], rel: m[2] })
  }
  return [...refs.values()].sort((a, b) => (a.pkg + "|" + a.rel).localeCompare(b.pkg + "|" + b.rel))
}

/**
 * The PACKED half: does the artifact actually carry what the static half says it must? Every
 * rule here is per-FILE, so a violation names the file — the omission class this wave closes
 * (`npm run pack` exits 0 while the tree silently lacks an asset) can never be a summary line
 * again. Pushes findings into the caller's array; returns the stats it measured.
 */
/** Every immediate subdirectory name of `dir`, sorted; [] when it does not exist. */
function listDirs(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * The pack's own write time, INFERRED from the artifact - never asserted as a fact: `cpSync` gives
 * every copied file the moment of its copy, so the newest mtime among the artifact's files is the end
 * of the pack. `--pack-stamp <iso>` overrides it for a reviewer who knows the real cut time. The
 * reading's SOURCE travels with it into every report, so no drift verdict borrows an unstated anchor.
 */
function artifactStamp(packed, overrideMs) {
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return { ms: overrideMs, source: "command line (--pack-stamp)", files: null }
  }
  let ms = 0
  let files = 0
  for (const rel of treeFiles(packed)) {
    files += 1
    const mtime = statSync(join(packed, rel)).mtimeMs
    if (mtime > ms) ms = mtime
  }
  return { ms, source: "inferred: the newest mtime among the artifact's own files (cpSync gives every copied file the pack's write time)", files }
}

function exemptFor(rel) {
  return PACK_EXEMPT_PATHS.find((entry) => rel.startsWith(entry.prefix))
}

/**
 * CONTENT (T-63, T-76) + COMPLETENESS (T-65) over the produced tree. Pure comparison over explicit
 * inputs, so `--self-test` drives the same code at a fixture. Every divergence is classified against
 * the artifact's stamp and the EXPECTED class is returned for the report - reported loudly, never
 * silently dropped, and never counted as a closure violation.
 */
function checkContentHalf(opts, findings, asked, packed) {
  const stamp = artifactStamp(packed, opts.packStampMs ?? null)
  const content = { compared: 0, identical: 0, drift: [], expected: [] }
  const completeness = { compared: 0, present: 0, absent: [], exempt: [], expected: [] }
  const stats = { stamp: { iso: new Date(stamp.ms).toISOString(), source: stamp.source, files: stamp.files }, content, completeness }
  if (stamp.ms === 0) return stats

  const observe = (srcAbs) => {
    const mtimeMs = statSync(srcAbs).mtimeMs
    return { iso: new Date(mtimeMs).toISOString(), after: mtimeMs > stamp.ms + EXPECTED_SLACK_MS }
  }
  const provenance = (rel, observed) =>
    rel + ": source mtime " + observed.iso + " is AFTER the artifact stamp " + stats.stamp.iso + " (anchor: " + stats.stamp.source + ") - a writer landed after the pack, so this is an EXPECTED reading, not a closure violation"

  const compareBytes = (rel, srcAbs, artAbs, kind = CONTENT_KIND) => {
    content.compared += 1
    const srcBuf = readFileSync(srcAbs)
    const artBuf = readFileSync(artAbs)
    // The gate's EXISTING byte idiom (the ROOT_FILES rule) is a buffer comparison; the digests below
    // are for the REPORT only and never decide anything.
    if (srcBuf.equals(artBuf)) {
      content.identical += 1
      return
    }
    const srcSha = createHash("sha256").update(srcBuf).digest("hex")
    const artSha = createHash("sha256").update(artBuf).digest("hex")
    const observed = observe(srcAbs)
    const entry = {
      path: rel,
      sourceSha256: srcSha,
      artifactSha256: artSha,
      sourceBytes: srcBuf.length,
      artifactBytes: artBuf.length,
      sourceMtime: observed.iso,
    }
    if (observed.after) {
      content.expected.push({ ...entry, provenance: provenance(rel, observed) })
      return
    }
    content.drift.push(entry)
    findings.push({
      kind,
      packages: [],
      detail:
        rel + " differs byte-wise from " + join(opts.sourceRoot, rel) + " (source " + srcSha.slice(0, 12) + "… / " + entry.sourceBytes + " B, artifact " + artSha.slice(0, 12) + "… / " + entry.artifactBytes + " B) and the source was NOT written after the artifact stamp " + stats.stamp.iso + " (source mtime " + observed.iso + ") - the artifact ships bytes no reading was taken on " + (kind === ROOT_FILE_KIND ? "(T-70)" : "(T-63)"),
    })
  }

  const requireCounterpart = (rel, srcAbs, scope) => {
    completeness.compared += 1
    const observed = observe(srcAbs)
    const exempt = exemptFor(rel)
    if (exempt !== undefined) {
      completeness.exempt.push({ path: rel, scope, why: exempt.why, sourceMtime: observed.iso })
      return
    }
    if (observed.after) {
      completeness.expected.push({ path: rel, scope, sourceMtime: observed.iso, sourceBytes: statSync(srcAbs).size, provenance: provenance(rel, observed) })
      return
    }
    completeness.absent.push({ path: rel, scope, sourceMtime: observed.iso, sourceBytes: statSync(srcAbs).size })
    findings.push({
      kind: COMPLETENESS_KIND,
      packages: [],
      detail:
        rel + " is declared by the packer (" + scope + ") and exists in the tree it copies from (" + statSync(srcAbs).size + " B, mtime " + observed.iso + ") but the packed tree has NO counterpart - a shipped file with no artifact counterpart (T-65). Comparison so far: " + completeness.compared + " declared source file(s), " + completeness.present + " present, " + completeness.exempt.length + " declared exemption(s)",
    })
  }

  // (a) the ROOT_ASSET_DIRS trees: name AND bytes, one pair at a time. agent-references lives inside
  //     this loop, so T-76's byte rule is the same rule that covers docs/templates/skills/presets.
  for (const dir of asked.rootAssets) {
    const shipped = new Set(treeFiles(join(packed, dir)))
    for (const rel of treeFiles(join(opts.sourceRoot, dir))) {
      const relPath = dir + "/" + rel
      const srcAbs = join(opts.sourceRoot, dir, rel)
      if (!shipped.has(rel)) {
        requireCounterpart(relPath, srcAbs, "ROOT_ASSET_DIRS:" + dir)
        continue
      }
      completeness.compared += 1
      completeness.present += 1
      compareBytes(relPath, srcAbs, join(packed, dir, rel))
    }
  }

  // (b) `packages/**`: BYTES only, and only where BOTH sides hold the file. Source-side absences in
  //     this tree are by design (src/, tests, the adopted plugin's filtered dirs), so completeness for
  //     packages is the `dist/**` contract below - never a bare tree comparison.
  for (const rel of treeFiles(join(opts.sourceRoot, "packages"))) {
    const relPath = "packages/" + rel
    const artAbs = join(packed, relPath)
    if (!existsSync(artAbs)) continue
    compareBytes(relPath, join(opts.sourceRoot, "packages", rel), artAbs)
  }

  // (c) the packer's dist contract - the direction T-65 is about: every `packages/<pkg>/dist/**` file
  //     in the tree must have an artifact counterpart, with the ONE declared exemption COUNTED.
  for (const pkg of listDirs(opts.packagesDir)) {
    for (const rel of treeFiles(join(opts.packagesDir, pkg, "dist"))) {
      const relPath = "packages/" + pkg + "/dist/" + rel
      if (!existsSync(join(packed, relPath))) {
        requireCounterpart(relPath, join(opts.packagesDir, pkg, "dist", rel), "packages/*/dist")
        continue
      }
      completeness.compared += 1
      completeness.present += 1
    }
  }

  // (d) the named ROOT FILES (t9-R1 repair): the byte claim is CLASSIFIED here, next to the trees and
  //     `packages/**`, so a drift caused by a POST-PACK WRITER is the provenance-named EXPECTED reading
  //     instead of a bare red with no writer named. The EXISTENCE half stays in the packed half
  //     (rule 5b) — a root file missing from the artifact is still a hard finding there.
  for (const file of REQUIRED_ROOT_FILES) {
    const srcAbs = join(opts.sourceRoot, file)
    const artAbs = join(packed, file)
    if (!existsSync(srcAbs) || !existsSync(artAbs)) continue
    compareBytes(file, srcAbs, artAbs, ROOT_FILE_KIND)
  }

  return stats
}

function checkPackedHalf(opts, findings, asked) {
  const packed = opts.packedDir
  const stats = { packedDir: packed, packed: "skipped", rootAssets: [], template: asked.template, files: 0, referenceFiles: 0, rootFiles: 0, packedPackages: { present: 0, declared: 0 }, content: null, completeness: null, stamp: null }
  if (!existsSync(packed)) {
    if (opts.requirePacked) {
      findings.push({ kind: "PACKED-MISSING", packages: [], detail: "no packed tree at " + packed + " and --require-packed was given: run `npm run pack` first" })
      stats.packed = "missing (required)"
    } else {
      stats.packed = "skipped: " + packed + " does not exist (run `npm run pack`)"
    }
    return stats
  }
  stats.packed = "checked"
  stats.rootAssets = asked.rootAssets

  // 1. every declared root asset really arrived — and arrived non-empty.
  for (const dir of asked.rootAssets) {
    const target = join(packed, dir)
    const files = treeFiles(target)
    if (!existsSync(target)) {
      findings.push({ kind: "ASSET-MISSING", packages: [], detail: "ROOT_ASSET_DIRS declares <root>/" + dir + " but the packed tree has no " + target })
    } else if (files.length === 0) {
      findings.push({ kind: "ASSET-MISSING", packages: [], detail: "ROOT_ASSET_DIRS declares <root>/" + dir + " but the packed copy is EMPTY" })
    }
    stats.files += files.length
  }

  // 2. the scaffold template root (derived from the CLI) arrived WITH its manifest: without it
  //    `scaffold` has nothing to copy, which is exactly T-35.
  if (asked.template !== null) {
    const rel = asked.template.segments.join("/")
    const packedManifest = join(packed, ...asked.template.segments, asked.template.manifestFile)
    if (!existsSync(packedManifest)) {
      findings.push({ kind: "TEMPLATES", packages: [], detail: "scripts/mpd-ext.mjs scaffold copies <root>/" + rel + " but the packed tree has no " + relative(packed, packedManifest) + " — the documented author workflow would have nothing to copy (T-35)" })
    }
  }

  // 3. docs/ + templates/ + agent-references/: the packed set must EQUAL the source set, file for
  //    file. A HALF pair (a doc whose zh-CN twin exists in the source and did not ship) is
  //    reported as such, because that is the failure mode a selective copy produces (T-36/T-45).
  for (const rel of ["docs", "templates", "agent-references"]) {
    const source = treeFiles(join(opts.sourceRoot, rel))
    const shipped = treeFiles(join(packed, rel))
    if (source.length === 0 && shipped.length === 0) continue
    const missing = source.filter((file) => !shipped.includes(file))
    const extra = shipped.filter((file) => !source.includes(file))
    const half = missing.filter((file) => {
      const twin = twinName(file)
      return twin !== undefined && shipped.includes(twin)
    })
    for (const file of half) {
      const twin = twinName(file)
      findings.push({ kind: "DOC-PAIR", packages: [], detail: rel + "/" + twin + " shipped without its twin " + file + " — a packed doc pair must never be half (EN + *.zh-CN.md ship together)" })
    }
    const dropped = missing.filter((file) => !half.includes(file))
    if (dropped.length > 0 || extra.length > 0) {
      findings.push({
        kind: "TREE-DRIFT",
        packages: [],
        detail: rel + "/ differs from the source tree - dropped by the pack: " + (dropped.slice(0, 6).join(", ") || "(none)") + "; not in the source: " + (extra.slice(0, 6).join(", ") || "(none)") + (dropped.length + extra.length > 12 ? " (+" + (dropped.length + extra.length - 12) + " more)" : ""),
      })
    }
  }

  // 4. the packed manifest's `files` list against the real tree: a file present but unlisted is
  //    not published, a pattern listed but absent is a lie about the artifact.
  const manifestPath = join(packed, "package.json")
  let manifest = null
  if (!existsSync(manifestPath)) {
    findings.push({ kind: "MANIFEST", packages: [], detail: "the packed tree has no package.json — the artifact is not an installable package" })
  } else {
    try {
      manifest = readJson(manifestPath)
    } catch (error) {
      findings.push({ kind: "MANIFEST", packages: [], detail: "the packed package.json is not parseable: " + String(error?.message ?? error) })
    }
  }
  if (manifest !== null) {
    const patterns = Array.isArray(manifest.files) ? manifest.files.filter((p) => typeof p === "string") : []
    if (patterns.length === 0) findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest declares no `files` list — npm would publish whatever it defaults to, not what this checker verified" })
    const topOf = (pattern) => (pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern).split("/")[0]
    for (const entry of readdirSync(packed).sort()) {
      if (entry === "package.json") continue // npm always includes it, listed or not
      if (!patterns.some((pattern) => topOf(pattern) === entry)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "<packed>/" + entry + " is in the artifact but no `files` pattern covers it — present but unlisted is a closure failure" })
      }
    }
    for (const pattern of patterns) {
      const top = topOf(pattern)
      if (top.length === 0 || top.includes("*")) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the `files` pattern " + pattern + " has no concrete top-level entry to check — refusing to treat an unverifiable pattern as closed" })
        continue
      }
      const target = join(packed, top)
      if (!existsSync(target)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest lists `" + pattern + "` but <packed>/" + top + " is absent — listed but absent is a closure failure" })
      } else if (pattern.endsWith("/**") && treeFiles(target).length === 0) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest lists `" + pattern + "` but <packed>/" + top + " is EMPTY" })
      }
    }
    const exported = manifest.exports !== null && typeof manifest.exports === "object" ? manifest.exports : {}
    for (const dir of asked.rootAssets) {
      if (!("./" + dir + "/*" in exported)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest exports no `./" + dir + "/*` — <packed>/" + dir + " ships but is not addressable like skills/ and presets/ (the asset + its declaration ship together, plan §1.9 rule)" })
      }
    }
  }

  // 5. the named agent references: the group being non-empty is not the claim, these files are.
  for (const file of REQUIRED_REFERENCE_FILES) {
    const rel = "agent-references/" + file
    if (!existsSync(join(packed, rel))) {
      findings.push({ kind: "REFERENCES", packages: [], detail: "the packed tree does not carry " + rel + " - an external author loses the reference the artifact is supposed to be self-sufficient for" })
    }
  }
  stats.referenceFiles = REQUIRED_REFERENCE_FILES.filter((file) => existsSync(join(packed, "agent-references", file))).length

  // 5b. the named ROOT FILES: EXISTENCE here; BYTE equality is owned by the content sweep (rule 7d),
  // because only that engine holds the artifact's stamp and can tell a POST-PACK WRITER from a genuine
  // mismatch. Before the t9-R1 repair the byte half lived here and hard-reddened with no writer named —
  // measured: `ROOT-FILE … EXTENSIONS-FOR-AGENTS.md` went red for t25's 07:43:40Z rewrite against the
  // 05:19:48Z artifact, i.e. a legitimate in-flight state with no provenance. The list lives in the GATE
  // rather than being derived from the packer, precisely because a file nobody declared has to be
  // expected from the source side before the artifact can be asked for it (T-70).
  for (const file of REQUIRED_ROOT_FILES) {
    const packedFile = join(packed, file)
    if (!existsSync(packedFile)) {
      findings.push({ kind: ROOT_FILE_KIND, packages: [], detail: "the packed tree does not carry " + file + " - the artifact's own README/docs link to it by relative path, so those links break for an author who holds only the artifact (T-70)" })
    }
  }
  stats.rootFiles = REQUIRED_ROOT_FILES.filter((file) => existsSync(join(packed, file))).length

  // 5c. EVERY DECLARED PACKAGE DIRECTORY must be present in the artifact with at least one file.
  // The static half asserts these entries against the SOURCE, and every other packed rule is
  // per-FILE — so a package that never arrives at all produces no row anywhere: the manifest arm
  // only checks that `<packed>/packages` exists (a `files` pattern's top-level entry), and the
  // per-file rules have nothing to walk. Measured with a seeded control (T-70 finding 2): a copy
  // of the artifact with one declared PLUGIN_PKG removed left this checker exiting 0 while its own
  // verdict line still asserted "18 PLUGIN_PKGS + 4 MCP_PKGS entries all exist". That sentence is
  // SOURCE-rooted; this block is the product-side half that makes the omission loud.
  const declaredPkgs = [...new Set([...(asked.pluginPkgs ?? []), ...(asked.mcpPkgs ?? []), ...(asked.adoptedPkgs ?? [])])]
  let packedPkgsPresent = 0
  for (const pkg of declaredPkgs) {
    const dir = join(packed, "packages", pkg)
    const files = existsSync(dir) ? treeFiles(dir) : []
    if (files.length === 0) {
      findings.push({ kind: "PACKED-MISSING", packages: [pkg], detail: "packages/" + pkg + " is declared by the packer (PLUGIN_PKGS/MCP_PKGS or the adopted main-code row) but <packed>/packages/" + pkg + " is " + (existsSync(dir) ? "EMPTY" : "absent") + " - a wholly absent package is the omission shape no per-file rule can see" })
    } else {
      packedPkgsPresent += 1
    }
  }
  stats.packedPackages = { present: packedPkgsPresent, declared: declaredPkgs.length }

  // 6. the CLI's compiled validator entry: without it every packed CLI command dies with
  //    `Cannot find module …/src/registry.ts` (T-51) while `npm run pack` still exits 0.
  const validatorEntry = join(packed, "packages", "mpd-ext-plugin", "dist", "validator.js")
  if (!existsSync(validatorEntry)) {
    findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "the packed tree ships scripts/mpd-ext.mjs but no " + relative(packed, validatorEntry) + " — validate/scaffold/--self-test would all die on the missing validator (T-51)" })
  }

  // 7. CONTENT (bytes) + COMPLETENESS — the two rules that read file CONTENTS rather than names
  //    (T-63 / T-65 / T-76). Both run against the tree that was actually produced, and the EXPECTED
  //    class is returned for the report instead of being folded into the verdict.
  const contentStats = checkContentHalf(opts, findings, asked, packed)
  stats.content = contentStats.content
  stats.completeness = contentStats.completeness
  stats.stamp = contentStats.stamp
  return stats
}

// Pure comparison over explicit inputs, so `--self-test` can drive it at a fixture.
function runCheck(opts) {
  const findings = []
  const packerSrc = readFileSync(opts.packerPath, "utf8")
  const pluginPkgs = readPackageList(packerSrc, "PLUGIN_PKGS")
  const mcpPkgs = readPackageList(packerSrc, "MCP_PKGS")

  if (pluginPkgs === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const PLUGIN_PKGS = [` literal in " + opts.packerPath })
  }
  if (mcpPkgs === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const MCP_PKGS = [` literal in " + opts.packerPath })
  }
  const plugin = pluginPkgs ?? []
  const mcp = mcpPkgs ?? []
  const listed = new Set([...plugin, ...mcp])

  // Zero-subject guard: a run with nothing to compare is a DEGRADED run, never a pass.
  if (plugin.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the packer declares no PLUGIN_PKGS entries - refusing to report PASS with nothing to compare" })
  }
  if (mcp.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the packer declares no MCP_PKGS entries - refusing to report PASS with nothing to compare" })
  }

  const patchText = readFileSync(opts.patchPath, "utf8")
  const refs = patchPackageRefs(patchText)
  if (refs.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the bundle patch references no `packages/<pkg>/…` path - refusing to report PASS with nothing to compare" })
  }

  // Direction 1 (the F11 omission): a mounted package the packer would not copy.
  for (const r of refs) {
    const cls = classifyRef(r.rel)
    if (cls !== "A" && cls !== "C") continue
    if (!listed.has(r.pkg)) {
      findings.push({
        kind: "OMISSION",
        packages: [r.pkg],
        detail: "the bundle patch mounts packages/" + r.pkg + "/" + r.rel + " but the packer's PLUGIN_PKGS/MCP_PKGS does not list " + r.pkg
      })
    }
  }

  // Class B: adopted main code — present on disk, and NOT a dist-listed package.
  for (const r of refs) {
    if (classifyRef(r.rel) !== "B") continue
    if (!existsSync(join(opts.packagesDir, r.pkg))) {
      findings.push({ kind: "ADOPTED-MISSING-DIR", packages: [r.pkg], detail: "the bundle patch mounts packages/" + r.pkg + "/" + r.rel + " but packages/" + r.pkg + " does not exist" })
    }
    if (listed.has(r.pkg)) {
      findings.push({
        kind: "ADOPTED-LISTED",
        packages: [r.pkg],
        detail: "packages/" + r.pkg + " is mounted as " + r.rel + " (adopted main code, copied wholesale at scripts/pack-mpd.mjs:111 and shipped without a dist/) yet it IS in PLUGIN_PKGS - the packer's own missing-dist check would then fail the pack"
      })
    }
  }

  // Direction 2 (the inverse drift): a listed entry whose package is gone.
  for (const pkg of [...new Set([...plugin, ...mcp])].sort()) {
    if (!existsSync(join(opts.packagesDir, pkg))) {
      findings.push({ kind: "INVERSE", packages: [pkg], detail: "the packer lists " + pkg + " but packages/" + pkg + " does not exist" })
    }
  }

  // Root-asset contract (the FLIPPED T-35 arm): the packer must DECLARE the root assets a
  // packed install needs and they must exist in the source tree it copies from. The old
  // invariant here was the opposite ("no `templates` path literal"); the user decision of
  // 2026-09-17 ships templates + docs, so the assertion follows the decision and the packer
  // was flipped in the same change.
  const rootAssets = readPackageList(packerSrc, "ROOT_ASSET_DIRS")
  if (rootAssets === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const ROOT_ASSET_DIRS = [` literal in " + opts.packerPath + " - the root-asset contract is gone, refusing to report PASS" })
  }
  const assets = rootAssets ?? []
  for (const required of REQUIRED_ROOT_ASSETS) {
    if (!assets.includes(required)) {
      findings.push({ kind: ROOT_ASSET_KIND[required] ?? "ASSET-MISSING", packages: [], detail: "the packer's ROOT_ASSET_DIRS does not name `" + required + "` - a packed install would silently lose it (user decision 2026-09-17: templates/ AND docs/ ship; captain's addition: agent-references/ ships)" })
    }
  }
  for (const dir of assets) {
    if (!existsSync(join(opts.sourceRoot, dir))) {
      findings.push({ kind: "ASSET-MISSING", packages: [], detail: "ROOT_ASSET_DIRS names `" + dir + "` but " + join(opts.sourceRoot, dir) + " does not exist" })
    }
  }
  // The reference FILES, not just the directory: an author whose boot misbehaves needs
  // troubleshooting.md specifically (and the adopted-plugin delta registry specifically).
  for (const file of REQUIRED_REFERENCE_FILES) {
    if (!existsSync(join(opts.sourceRoot, "agent-references", file))) {
      findings.push({ kind: "REFERENCES", packages: [], detail: "the packed artifact must ship agent-references/" + file + " (an external author needs it) but the source tree has no such file" })
    }
  }
  // The named ROOT FILES, source side. Two assertions, because the artifact-side one cannot run
  // without a packed tree: (a) the packer's ROOT_FILES table must NAME each file — this is the ONLY
  // check that fires when the file is declared nowhere, since the manifest arm and the packed arm
  // both reason over what the packer already decided to ship; (b) the file must exist in the tree
  // the packer copies from (T-70).
  const rootFiles = readPackageList(packerSrc, "ROOT_FILES")
  if (rootFiles === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const ROOT_FILES = [` literal in " + opts.packerPath + " - the named-root-file contract is gone, refusing to report PASS" })
  }
  for (const file of REQUIRED_ROOT_FILES) {
    if (rootFiles !== null && !rootFiles.includes(file)) {
      findings.push({ kind: ROOT_FILE_KIND, packages: [], detail: "the packer's ROOT_FILES does not name `" + file + "` - the artifact would omit it while its own shipped README/docs link to it by relative path (T-70)" })
    }
    if (!existsSync(join(opts.sourceRoot, file))) {
      findings.push({ kind: ROOT_FILE_KIND, packages: [], detail: "the artifact must ship " + file + " but the tree it copies from has no such file" })
    }
  }

  // The packed CLI's validator surface: the packer's shim list IS the CLI's requirement list.
  // Two hand-kept lists cannot be allowed to drift — the CLI would load a shim that misses a
  // binding and only the packed artifact would notice (T-51).
  const cliSrc = readFileSync(opts.cliPath, "utf8")
  const sdkSrc = readFileSync(join(opts.sourceRoot, "packages", "mpd-ext-plugin", "src", "sdk.ts"), "utf8")
  const template = resolveCliTemplate(cliSrc, sdkSrc)
  if (template === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "cannot resolve the scaffold template from " + opts.cliPath + " (TEMPLATE_DIR join) and the SDK (manifestFile) - refusing to check the packed scaffold asset against a guess" })
  }
  const requiredExports = readPackageList(cliSrc, "REQUIRED_COMPILED_EXPORTS")
  const shimExports = readPackageList(packerSrc, "VALIDATOR_SHIM_EXPORTS")
  if (requiredExports === null || shimExports === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no REQUIRED_COMPILED_EXPORTS (" + opts.cliPath + ") or VALIDATOR_SHIM_EXPORTS (" + opts.packerPath + ") array literal - the compiled-validator contract is gone, refusing to report PASS" })
  } else {
    if (requiredExports.length < 8) {
      findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "the CLI requires only " + requiredExports.length + " compiled exports - a degenerate list would let a shim pass that cannot serve the commands" })
    }
    const want = [...requiredExports].sort()
    const got = [...shimExports].sort()
    if (want.join("\u0000") !== got.join("\u0000")) {
      const onlyCli = want.filter((n) => !got.includes(n))
      const onlyPacker = got.filter((n) => !want.includes(n))
      findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "scripts/mpd-ext.mjs REQUIRED_COMPILED_EXPORTS and scripts/pack-mpd.mjs VALIDATOR_SHIM_EXPORTS disagree - only in the CLI: " + (onlyCli.join(", ") || "(none)") + "; only in the packer: " + (onlyPacker.join(", ") || "(none)") })
    }
  }

  const stats = {
    pluginCount: plugin.length,
    mcpCount: mcp.length,
    refCount: refs.length,
    classA: refs.filter((r) => classifyRef(r.rel) === "A").length,
    classB: refs.filter((r) => classifyRef(r.rel) === "B").length,
    classC: refs.filter((r) => classifyRef(r.rel) === "C").length,
    rootAssets: assets,
    shimExports: shimExports ?? [],
    template
  }
  // The adopted main-code packages the bundle patch mounts as class B (no dist/, copied
  // wholesale by the packer). Derived from the patch rows — the same source the static half
  // classifies from — so the packed-package assertion below covers PLUGIN_PKGS, MCP_PKGS and the
  // adopted package in one pass (T-70 finding 2).
  const adopted = [...new Set(refs.filter((r) => classifyRef(r.rel) === "B").map((r) => r.pkg))]
  stats.packedStats = checkPackedHalf(opts, findings, { rootAssets: assets, template, pluginPkgs: plugin, mcpPkgs: mcp, adoptedPkgs: adopted })
  return { findings, stats }
}

function offendingPackages(findings) {
  return [...new Set(findings.flatMap((f) => f.packages))].sort()
}

function printReport(report, opts) {
  const s = report.stats
  const packedStats = s.packedStats
  const packedLine = "packed tree: " + (packedStats.packed === "checked" ? packedStats.packedDir + " (" + packedStats.files + " asset files)" : packedStats.packed)
  const content = packedStats.content
  const completeness = packedStats.completeness
  const stamp = packedStats.stamp
  const contentLine = content === null || content === undefined ? "" : "; content bytes: " + content.compared + " file(s) compared, " + content.identical + " identical, " + content.drift.length + " drift, " + content.expected.length + " expected-after-pack"
  const completenessLine = completeness === null || completeness === undefined ? "" : "; completeness: " + completeness.compared + " declared source file(s) compared, " + completeness.present + " present, " + completeness.exempt.length + " declared exemption(s), " + completeness.absent.length + " absent"
  const stampLine = stamp === null || stamp === undefined ? "" : "; pack stamp " + stamp.iso + " (" + stamp.source + ")"
  const exemptLine = completeness === null || completeness === undefined || completeness.exempt.length === 0 ? "" : "; exemption exercised: " + completeness.exempt.map((e) => e.path).join(", ")
  const expected = [...(content?.expected ?? []), ...(completeness?.expected ?? [])]
  if (report.findings.length === 0) {
    console.log(PREFIX + " ok: " + s.classA + " dist/index.js row(s) + " + s.classB + " adopted lib/index.js row(s) + " + s.classC + " mcp row(s) of the bundle patch all resolve; " + s.pluginCount + " PLUGIN_PKGS + " + s.mcpCount + " MCP_PKGS entries all exist; root assets " + s.rootAssets.join("/") + " declared and present; CLI validator surface " + s.shimExports.length + " exports in step; " + packedLine + (packedStats.packed === "checked" ? "; agent references " + packedStats.referenceFiles + "/" + REQUIRED_REFERENCE_FILES.length + "; root files " + packedStats.rootFiles + "/" + REQUIRED_ROOT_FILES.length + "; declared packages " + packedStats.packedPackages.present + "/" + packedStats.packedPackages.declared + " present in the artifact" + contentLine + completenessLine + stampLine + exemptLine : ""))
  } else {
    console.error(PREFIX + " FAIL - " + report.findings.length + " closure violation(s)")
    for (const f of report.findings) {
      const who = f.packages.length ? " [" + f.packages.join(", ") + "]" : ""
      console.error("  " + f.kind + who + " - " + f.detail)
    }
    const bad = offendingPackages(report.findings)
    if (bad.length) console.error("  offending packages: " + bad.join(", "))
    console.error("  packer: " + opts.packerPath)
    console.error("  cli: " + opts.cliPath)
    console.error("  packages dir: " + opts.packagesDir)
    console.error("  patch: " + opts.patchPath)
    console.error("  " + packedLine + contentLine + completenessLine + stampLine)
  }
  // The EXPECTED class is printed in BOTH branches. A red run must not hide the drift a later writer
  // caused, and a green run must never present an expected divergence as if nothing had moved.
  for (const e of expected) console.log(PREFIX + " " + EXPECTED_KIND + " (expected, provenance-named, NOT a closure violation) - " + e.provenance)
}

function printUsage() {
  console.log("usage: node scripts/verify-pack-closure.mjs [--self-test] [--packer <path>] [--cli <path>] [--packages-dir <dir>] [--patch <path>] [--packed <dir>] [--source-root <dir>] [--pack-stamp <iso>] [--require-packed]")
  console.log("  no flags        check the real tree AND the real dist/mpd-package/ artifact (exit 0 = closed)")
  console.log("  --self-test     run the positive control and the negative controls on TEMP fixtures")
  console.log("  --packed <dir>  check another packed tree (default " + DEFAULT_PACKED + ")")
  console.log("  --source-root <dir>  the tree the assets are copied FROM (default the repo root)")
  console.log("  --require-packed     treat an absent packed tree as a failure instead of a printed skip")
  console.log("  --pack-stamp <iso>  pin the artifact's cut time (default: INFERRED as the newest mtime among the artifact's files); a source file written after it is reported as an EXPECTED, provenance-named reading instead of a CONTENT-DRIFT")
}

function parseArgs(argv) {
  const opts = { selfTest: false, packerPath: DEFAULT_PACKER, cliPath: DEFAULT_CLI, packagesDir: DEFAULT_PACKAGES_DIR, patchPath: DEFAULT_PATCH, packedDir: DEFAULT_PACKED, sourceRoot: repoRoot, requirePacked: false, packStampMs: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--self-test") opts.selfTest = true
    else if (a === "--packer") opts.packerPath = resolve(argv[++i] ?? "")
    else if (a === "--cli") opts.cliPath = resolve(argv[++i] ?? "")
    else if (a === "--packages-dir") opts.packagesDir = resolve(argv[++i] ?? "")
    else if (a === "--patch") opts.patchPath = resolve(argv[++i] ?? "")
    else if (a === "--packed") opts.packedDir = resolve(argv[++i] ?? "")
    else if (a === "--source-root") opts.sourceRoot = resolve(argv[++i] ?? "")
    else if (a === "--require-packed") opts.requirePacked = true
    else if (a === "--pack-stamp") {
      const raw = argv[++i] ?? ""
      const ms = Date.parse(raw)
      if (Number.isNaN(ms)) {
        console.error(PREFIX + " FAIL - --pack-stamp needs an ISO-8601 timestamp, got: " + JSON.stringify(raw))
        process.exit(2)
      }
      opts.packStampMs = ms
    }
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0) }
    else { console.error(PREFIX + " FAIL - unknown argument: " + a); printUsage(); process.exit(2) }
  }
  return opts
}

// One child run of this very script, so the self-test drives the real CLI and exit code.
function runChecker(args) {
  const r = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  const stdout = String(r.stdout ?? "")
  const stderr = String(r.stderr ?? "")
  return { status: r.status, stdout, stderr, all: stdout + stderr }
}

function selfTest() {
  const arms = []
  const arm = (name, child, predicate) => {
    const ok = predicate(child)
    const first = child.all.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "(no output)"
    arms.push({ name, ok, exitCode: child.status, firstLine: first })
  }

  // Arm 1 — positive control: the real tree is closed, and the checker runs ALONE.
  arm("positive-control (real tree, exit 0)", runChecker([]), (c) => c.status === 0 && /\[verify-pack-closure\] ok/.test(c.all))

  const scratch = mkdtempSync(join(tmpdir(), "mpd-pack-closure-"))
  try {
    const original = readFileSync(DEFAULT_PACKER, "utf8")

    // Arm 2 — negative control: replay the historical F-T7-1 defect. Drop the
    // mpd-team-watchdog-plugin entry from a TEMP COPY of the packer source.
    const removed = "mpd-team-watchdog-plugin"
    const lines = original.split(/\r?\n/)
    const kept = lines.filter((l) => l.trim() !== '"' + removed + '",')
    if (kept.length !== lines.length - 1) {
      arms.push({ name: "negative-control fixture 1 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines.length - kept.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      const f1 = join(scratch, "packer-omitting-watchdog.mjs")
      writeFileSync(f1, kept.join("\n"))
      arm("negative-control (F-T7-1 omission, exit 1)", runChecker(["--packer", f1]), (c) => c.status === 1 && c.all.includes(removed) && c.all.includes("OMISSION"))
    }

    // Arm 3 — negative control: the inverse drift. Add a phantom allowlist entry.
    const lines2 = original.split(/\r?\n/)
    const anchorIdx = lines2.findIndex((l) => /const\s+PLUGIN_PKGS\s*=\s*\[/.test(l))
    if (anchorIdx < 0) {
      arms.push({ name: "negative-control fixture 2 (build)", ok: false, exitCode: null, firstLine: "no `const PLUGIN_PKGS = [` anchor found - refusing to trust a fixture that silently did not apply" })
    } else {
      const phantom = "mpd-phantom-plugin"
      lines2.splice(anchorIdx + 1, 0, '  "' + phantom + '",')
      const f2 = join(scratch, "packer-with-phantom-entry.mjs")
      writeFileSync(f2, lines2.join("\n"))
      arm("negative-control (inverse drift, exit 1)", runChecker(["--packer", f2]), (c) => c.status === 1 && c.all.includes(phantom) && c.all.includes("INVERSE"))
    }

    // Arm 4 — negative control: SEVERAL offenders at once. The report must NAME each
    // offending package, not just print a count.
    const twoGone = ["mpd-team-watchdog-plugin", "mpd-tui-plugin"]
    const lines4 = original.split(/\r?\n/)
    const kept4 = lines4.filter((l) => !twoGone.some((p) => l.trim() === '"' + p + '",'))
    if (kept4.length !== lines4.length - 2) {
      arms.push({ name: "negative-control fixture 4 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines4.length - kept4.length) + " line(s), expected exactly 2 - refusing to trust a fixture that silently did not apply" })
    } else {
      const f4 = join(scratch, "packer-omitting-two.mjs")
      writeFileSync(f4, kept4.join("\n"))
      arm("negative-control (two offenders, both named)", runChecker(["--packer", f4]), (c) => c.status === 1 && twoGone.every((p) => c.all.includes(p)) && /offending packages: .*mpd-team-watchdog-plugin.*mpd-tui-plugin/.test(c.all))
    }

    // Arm 5 — negative control: a degraded run (empty allowlist) must never pass.
    const span = scanArrayLiteral(original, "PLUGIN_PKGS")
    if (span === null) {
      arms.push({ name: "negative-control fixture 3 (build)", ok: false, exitCode: null, firstLine: "could not locate the PLUGIN_PKGS array literal - refusing to trust a fixture that silently did not apply" })
    } else {
      const f3 = join(scratch, "packer-with-empty-allowlist.mjs")
      writeFileSync(f3, original.slice(0, span.start) + "[]" + original.slice(span.end + 1))
      arm("negative-control (zero-subject degraded run, exit 1)", runChecker(["--packer", f3]), (c) => c.status === 1 && c.all.includes("DEGRADED"))
    }
    // Arm 6 — negative control for the FLIPPED templates/docs arm: a packer whose
    // ROOT_ASSET_DIRS table drops `templates` must fail, naming the asset. (Before this wave
    // the same arm proved the OPPOSITE assertion — that a templates literal was forbidden.)
    const lines6 = original.split(/\r?\n/)
    const kept6 = lines6.filter((l) => l.trim() !== '"templates",')
    if (kept6.length !== lines6.length - 1) {
      arms.push({ name: "negative-control fixture 6 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines6.length - kept6.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      const f6 = join(scratch, "packer-without-templates.mjs")
      writeFileSync(f6, kept6.join("\n"))
      arm("negative-control (ROOT_ASSET_DIRS drops templates, exit 1)", runChecker(["--packer", f6]), (c) => c.status === 1 && c.all.includes("TEMPLATES") && /does not name `templates`/.test(c.all))
    }

    // Arm 7 — negative control: the compiled-validator contract. Drop one name from the
    // packer's shim list; the checker must name the drift instead of trusting two hand-kept
    // lists to stay equal.
    const lines7 = original.split(/\r?\n/)
    const kept7 = lines7.filter((l) => l.trim() !== '"bundleExtensionsDir",')
    if (kept7.length !== lines7.length - 1) {
      arms.push({ name: "negative-control fixture 7 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines7.length - kept7.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      const f7 = join(scratch, "packer-with-shim-drift.mjs")
      writeFileSync(f7, kept7.join("\n"))
      arm("negative-control (shim list drifts from the CLI, exit 1)", runChecker(["--packer", f7]), (c) => c.status === 1 && c.all.includes("CLI-VALIDATOR") && /bundleExtensionsDir/.test(c.all))
    }

    // ── Arms 8+ — the PACKED half, driven at a fixture artifact ────────────────────────────
    // The rules under test read a packed tree, so the fixtures build a minimal source tree and
    // a minimal packed tree with the SAME shape (the asset dirs come from the real packer's own
    // ROOT_ASSET_DIRS table, so a future asset is covered by these arms automatically).
    const assets = readPackageList(original, "ROOT_ASSET_DIRS") ?? []
    const rootFiles = readPackageList(original, "ROOT_FILES") ?? []
    // The declared package set the packed-package arm asserts against — read from the same three
    // sources the production halves read: the packer's two lists and the patch's class-B rows.
    const pluginPkgs = readPackageList(original, "PLUGIN_PKGS") ?? []
    const mcpPkgs = readPackageList(original, "MCP_PKGS") ?? []
    const adoptedPkgs = [...new Set(patchPackageRefs(readFileSync(DEFAULT_PATCH, "utf8")).filter((r) => classifyRef(r.rel) === "B").map((r) => r.pkg))]
    const fixturePkgs = [...new Set([...pluginPkgs, ...mcpPkgs, ...adoptedPkgs])]
    const fxSource = join(scratch, "fixture-repo")
    const fxPacked = join(scratch, "fixture-packed")
    const put = (root, rel, body) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), body)
    }
    const manifestBody = () =>
      JSON.stringify(
        {
          name: "@mpd-dsh/mpd",
          version: "0.0.0",
          type: "module",
          exports: { "./packages/*": "./packages/*", ...Object.fromEntries(assets.map((dir) => ["./" + dir + "/*", "./" + dir + "/*"])) },
          files: [...assets.map((dir) => dir + "/**"), "packages/**", ...rootFiles],
        },
        null,
        2,
      )
    const buildPacked = () => {
      put(fxPacked, "package.json", manifestBody())
      for (const dir of assets) put(fxPacked, dir + "/.keep", "")
      for (const f of rootFiles) put(fxPacked, f, "# fixture root file\n")
      for (const pkg of fixturePkgs) put(fxPacked, "packages/" + pkg + "/" + (adoptedPkgs.includes(pkg) ? "lib/index.js" : "dist/index.js"), "export {}\n")
      put(fxPacked, "templates/mpd-extension/mpd-ext.json", "{}\n")
      put(fxPacked, "templates/mpd-extension/README.md", "# fixture template\n")
      put(fxPacked, "docs/guide.md", "# guide\n")
      put(fxPacked, "docs/guide.zh-CN.md", "# 指南\n")
      for (const file of REQUIRED_REFERENCE_FILES) put(fxPacked, "agent-references/" + file, "# fixture reference\n")
      put(fxPacked, "packages/mpd-ext-plugin/dist/validator.js", "export {}\n")
    }
    put(fxSource, "scripts/mpd-ext.mjs", readFileSync(DEFAULT_CLI, "utf8"))
    put(fxSource, "packages/mpd-ext-plugin/src/sdk.ts", readFileSync(join(repoRoot, "packages", "mpd-ext-plugin", "src", "sdk.ts"), "utf8"))
    for (const dir of assets) put(fxSource, dir + "/.keep", "")
    for (const f of rootFiles) put(fxSource, f, "# fixture root file\n")
    put(fxSource, "templates/mpd-extension/mpd-ext.json", "{}\n")
    put(fxSource, "templates/mpd-extension/README.md", "# fixture template\n")
    put(fxSource, "docs/guide.md", "# guide\n")
    put(fxSource, "docs/guide.zh-CN.md", "# 指南\n")
    for (const file of REQUIRED_REFERENCE_FILES) put(fxSource, "agent-references/" + file, "# fixture reference\n")
    // The CONTENT/COMPLETENESS rules compare the tree the packer copies FROM, so this fixture needs
    // its OWN `packages/` dir: borrowing the real one would judge the fixture artifact against a tree
    // it was never packed from (measured: all 27 real dist files would be "absent"). Mirror the packed
    // side byte for byte, then point `--packages-dir` at it.
    for (const pkg of fixturePkgs) put(fxSource, "packages/" + pkg + "/" + (adoptedPkgs.includes(pkg) ? "lib/index.js" : "dist/index.js"), "export {}\n")
    buildPacked()
    const fixtureArgs = ["--source-root", fxSource, "--packages-dir", join(fxSource, "packages"), "--packed", fxPacked]

    arm("positive-control (fixture packed tree, exit 0)", runChecker(fixtureArgs), (c) => c.status === 0 && /packed tree: .*fixture-packed/.test(c.all))

    const zhGuide = join(fxPacked, "docs", "guide.zh-CN.md")
    const zhBody = readFileSync(zhGuide, "utf8")
    rmSync(zhGuide)
    arm("negative-control (half doc pair, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("DOC-PAIR") && c.all.includes("guide.zh-CN.md"))
    writeFileSync(zhGuide, zhBody)

    const tplManifest = join(fxPacked, "templates", "mpd-extension", "mpd-ext.json")
    const tplBody = readFileSync(tplManifest, "utf8")
    rmSync(tplManifest)
    arm("negative-control (packed scaffold template manifest gone, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("TEMPLATES") && c.all.includes("mpd-ext.json"))
    writeFileSync(tplManifest, tplBody)

    put(fxPacked, "package.json", manifestBody().replace('"packages/**"', '"packages/**",\n          "notes/**"'))
    arm("negative-control (files pattern listed but absent, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("MANIFEST") && /notes\/\*\*/.test(c.all))
    put(fxPacked, "package.json", manifestBody())

    put(fxPacked, "extra/thing.md", "# unlisted\n")
    arm("negative-control (file present but unlisted, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("MANIFEST") && /<packed>\/extra is in the artifact but no `files` pattern covers it/.test(c.all))
    rmSync(join(fxPacked, "extra"), { recursive: true, force: true })

    rmSync(join(fxPacked, "packages", "mpd-ext-plugin", "dist", "validator.js"))
    arm("negative-control (packed validator entry gone, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("CLI-VALIDATOR") && c.all.includes("validator.js"))
    buildPacked()

    // Arm 8 — negative control for the reference group: a packer whose ROOT_ASSET_DIRS table
    // drops `agent-references` must fail, naming the group (captain's t16 addition to this lane).
    const lines8 = original.split(/\r?\n/)
    const kept8 = lines8.filter((l) => l.trim() !== '"agent-references",')
    if (kept8.length !== lines8.length - 1) {
      arms.push({ name: "negative-control fixture 8 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines8.length - kept8.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      const f8 = join(scratch, "packer-without-agent-references.mjs")
      writeFileSync(f8, kept8.join("\n"))
      arm("negative-control (ROOT_ASSET_DIRS drops agent-references, exit 1)", runChecker(["--packer", f8]), (c) => c.status === 1 && c.all.includes("REFERENCES") && /does not name `agent-references`/.test(c.all))
    }

    // Arm 9 — packed-tree negative control: one NAMED reference file missing from the artifact.
    const refFile = join(fxPacked, "agent-references", "troubleshooting.md")
    const refBody = readFileSync(refFile, "utf8")
    rmSync(refFile)
    arm("negative-control (packed reference file gone, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("REFERENCES") && c.all.includes("troubleshooting.md"))
    writeFileSync(refFile, refBody)

    // Arm 10 — source-side negative control: the named reference file absent from the tree the
    // packer copies FROM (the same discrimination, one stage earlier).
    const srcRef = join(fxSource, "agent-references", "index.md")
    const srcRefBody = readFileSync(srcRef, "utf8")
    rmSync(srcRef)
    arm("negative-control (reference file absent from the source tree, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("REFERENCES") && c.all.includes("index.md"))
    writeFileSync(srcRef, srcRefBody)

    arm("negative-control (--require-packed with no tree, exit 1)", runChecker(["--source-root", fxSource, "--packed", join(scratch, "no-such-pack"), "--require-packed"]), (c) => c.status === 1 && c.all.includes("PACKED-MISSING"))

    // Arms 11-14 — the named ROOT FILES (T-70). Four shapes, because the manifest arm is
    // declaration-driven: it can see a file present but unlisted and a pattern listed but absent,
    // but a file declared NOWHERE is invisible to it, so only a source-side expectation (here) and
    // the packer-table comparison can make an ADDITION-omission go red rather than a later removal.
    const rootFile = join(fxPacked, REQUIRED_ROOT_FILES[0])
    const rootBody = readFileSync(rootFile, "utf8")
    rmSync(rootFile)
    arm("negative-control (packed root file gone, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(rootFile, rootBody)

    put(fxPacked, REQUIRED_ROOT_FILES[0], "# fixture root file\nDRIFTED\n")
    arm("negative-control (packed root file differs from its source, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes("differs byte-wise"))
    writeFileSync(rootFile, rootBody)

    const srcRootFile = join(fxSource, REQUIRED_ROOT_FILES[0])
    const srcRootBody = readFileSync(srcRootFile, "utf8")
    rmSync(srcRootFile)
    arm("negative-control (root file absent from the source tree, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(srcRootFile, srcRootBody)

    const linesRoot = original.split(/\r?\n/)
    const keptRoot = linesRoot.filter((l) => l.trim() !== '"' + REQUIRED_ROOT_FILES[0] + '",')
    if (keptRoot.length !== linesRoot.length - 1) {
      arms.push({ name: "negative-control fixture (ROOT_FILES build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (linesRoot.length - keptRoot.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      const fRoot = join(scratch, "packer-without-root-file.mjs")
      writeFileSync(fRoot, keptRoot.join("\n"))
      arm("negative-control (packer ROOT_FILES drops the file, exit 1)", runChecker(["--packer", fRoot]), (c) => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && /does not name/.test(c.all))
    }

    // Arm 15 — the DECLARED PACKAGE arm (T-70 finding 2), seeded exactly like the control that
    // exposed the hole: a declared PLUGIN_PKG whose directory arrives nowhere must go RED. Before
    // this arm the same shape exited 0 while the verdict line still asserted that every declared
    // package "all exists" — a SOURCE-rooted sentence printed over a pack missing one of them.
    const pkgToDrop = pluginPkgs[0]
    const pkgDir = pkgToDrop === undefined ? null : join(fxPacked, "packages", pkgToDrop)
    if (pkgDir === null || !existsSync(pkgDir)) {
      arms.push({ name: "negative-control fixture (declared package build)", ok: false, exitCode: null, firstLine: "fixture has no packed directory for PLUGIN_PKGS[0] (" + String(pkgToDrop) + ") - refusing to trust a fixture that silently did not apply" })
    } else {
      rmSync(pkgDir, { recursive: true, force: true })
      arm("negative-control (declared package dir absent from the artifact, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes("PACKED-MISSING") && c.all.includes(pkgToDrop))
      buildPacked()
    }

    // Arm 15b (T-63, the captain's PACKER ROUTE ruling) — the arms build a REAL scratch pack through the
    // packer's own `--out`, instead of rewriting the packer's constants: a fresh pack must be GREEN (every
    // byte it ships equals the source it copied — the "byte-identical re-pack stays green" half of T-63),
    // a ONE-BYTE change inside that pack must redden at unchanged presence, and the canonical artifact must
    // not move across either run (the one-writer-at-a-time control).
    const scratchPack = join(scratch, "scratch-pack")
    const canonicalStamp = (dir) => {
      let newest = 0
      const files = treeFiles(dir)
      for (const rel of files) {
        const mtime = statSync(join(dir, rel)).mtimeMs
        if (mtime > newest) newest = mtime
      }
      return { files: files.length, newest }
    }
    const canonicalBefore = canonicalStamp(DEFAULT_PACKED)
    const packRun = spawnSync(process.execPath, [DEFAULT_PACKER, "--out", scratchPack], { encoding: "utf8" })
    if (packRun.status !== 0) {
      arms.push({ name: "scratch pack via --out (fixture build)", ok: false, exitCode: packRun.status, firstLine: "the packer refused --out: " + String(packRun.stderr ?? "").trim().split("\n").slice(-2).join(" | ") })
    } else {
      arm("positive-control (real scratch pack staged with --out, exit 0)", runChecker(["--packed", scratchPack, "--require-packed"]), (c) => c.status === 0 && /ok:/.test(c.all))
      const scratchRef = join(scratchPack, "agent-references", "troubleshooting.md")
      const scratchMtime = statSync(scratchRef).mtime
      const scratchMutated = Buffer.from(readFileSync(scratchRef))
      scratchMutated[0] = scratchMutated[0] === 0x23 ? 0x20 : 0x23
      writeFileSync(scratchRef, scratchMutated)
      utimesSync(scratchRef, scratchMtime, scratchMtime)
      arm("negative-control (one byte changed in a real scratch pack, exit 1)", runChecker(["--packed", scratchPack, "--require-packed"]), (c) => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md"))
    }
    const canonicalAfter = canonicalStamp(DEFAULT_PACKED)
    arms.push({
      name: "control (the canonical artifact did not move across the pack)",
      ok: canonicalBefore.files === canonicalAfter.files && canonicalBefore.newest === canonicalAfter.newest,
      exitCode: null,
      firstLine: "files " + canonicalBefore.files + " -> " + canonicalAfter.files + ", newest mtime " + new Date(canonicalBefore.newest).toISOString() + " -> " + new Date(canonicalAfter.newest).toISOString(),
    })

    // Arm 16 (T-63 + T-76) — CONTENT drift at UNCHANGED presence: bytes inside a shipped
    // agent-references file change while the file is still there. Every presence rule must stay green
    // (`REFERENCES` must NOT appear anywhere) and the BYTE rule must name the file. This is the
    // discrimination T-76 is about: the old rule could only see that the file arrived.
    const driftFile = join(fxPacked, "agent-references", "troubleshooting.md")
    const driftBody = readFileSync(driftFile, "utf8")
    writeFileSync(driftFile, driftBody.replace("# fixture", "# seeded"))
    arm("negative-control (artifact byte drift at unchanged presence, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md") && !/REFERENCES/.test(c.all))
    writeFileSync(driftFile, driftBody)

    // Arm 17 (the captain's expected-drift ruling) — the same divergence caused by a writer that
    // landed AFTER the pack: the artifact is untouched and the SOURCE file is strictly newer. It must
    // be REPORTED as a provenance-named expected reading and must NOT redden the gate. The packed tree
    // is backdated first so "after the pack" is a fact of the fixture, not of millisecond timing.
    const postPackFile = join(fxSource, "agent-references", "index.md")
    const postPackBody = readFileSync(postPackFile, "utf8")
    const packedMtimes = treeFiles(fxPacked).map((rel) => [join(fxPacked, rel), statSync(join(fxPacked, rel)).mtime])
    const backdate = new Date(Date.now() - 3_600_000)
    for (const [abs] of packedMtimes) utimesSync(abs, backdate, backdate)
    writeFileSync(postPackFile, postPackBody + "<!-- post-pack writer: self-test arm 17 -->\n")
    arm("negative-control (post-pack source writer -> reported, exit 0)", runChecker(fixtureArgs), (c) => c.status === 0 && c.all.includes(EXPECTED_KIND) && c.all.includes("agent-references/index.md"))
    // Arm 17b — the SAME divergence with the stamp pinned AHEAD of the writer: the expected class must
    // flip to a hard CONTENT-DRIFT, which is what proves the classification reads the stamped time and
    // not merely "the source is newer than the copy" (a distinction `cpSync` would otherwise erase).
    const future = new Date(Date.now() + 3_600_000).toISOString()
    arm("negative-control (same drift, stamp pinned ahead of the writer, exit 1)", runChecker([...fixtureArgs, "--pack-stamp", future]), (c) => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/index.md"))
    writeFileSync(postPackFile, postPackBody)
    for (const [abs, mtime] of packedMtimes) utimesSync(abs, mtime, mtime)

    // Arm 17c (t9-R1 repair) — the ROOT-FILES byte rule must join the SAME classification: with the
    // fixture packed tree backdated and the fixture's SOURCE root file written afterwards, the drift is
    // the provenance-named EXPECTED class (exit 0, writer named), never a bare ROOT-FILE red. The hard
    // shape is untouched and still asserted above (a packed-side change with an older source).
    const packedMtimesRoot = treeFiles(fxPacked).map((rel) => [join(fxPacked, rel), statSync(join(fxPacked, rel)).mtime])
    for (const [abs] of packedMtimesRoot) utimesSync(abs, backdate, backdate)
    const fxRootFile = join(fxSource, REQUIRED_ROOT_FILES[0])
    const fxRootBody = readFileSync(fxRootFile, "utf8")
    writeFileSync(fxRootFile, fxRootBody + "<!-- post-pack writer: self-test arm 17c -->\n")
    arm("negative-control (post-pack writer of a ROOT FILE -> expected, exit 0)", runChecker(fixtureArgs), (c) => c.status === 0 && c.all.includes(EXPECTED_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(fxRootFile, fxRootBody)
    for (const [abs, mtime] of packedMtimesRoot) utimesSync(abs, mtime, mtime)

    // Arm 18 (T-65, narrow) — a package whose `dist/` file sits in the SOURCE with no artifact
    // counterpart must be REPORTED by name: the exemption is ONE entry, never a class of pardons. Its
    // mtime is set BEFORE the pack because that is the realistic shape (the package predates the pack);
    // a file written after the pack is the expected class above, not an absence.
    put(fxSource, "packages/ghost-plugin/dist/index.js", "export {}\n")
    const ghost = join(fxSource, "packages", "ghost-plugin", "dist", "index.js")
    utimesSync(ghost, backdate, backdate)
    arm("negative-control (source dist with no artifact counterpart, exit 1)", runChecker(fixtureArgs), (c) => c.status === 1 && c.all.includes(COMPLETENESS_KIND) && c.all.includes("packages/ghost-plugin/dist/index.js"))
    rmSync(join(fxSource, "packages", "ghost-plugin"), { recursive: true, force: true })

    // Arm 19 (T-65, the exemption) — the SAME shape for the one declared exempt package must stay
    // green AND the verdict line must name it, so an exemption can never become a silent skip.
    put(fxSource, "packages/mpd-qa-roles-probe/dist/index.js", "export {}\n")
    arm("negative-control (the one declared exemption is exercised, not a silent skip)", runChecker(fixtureArgs), (c) => c.status === 0 && c.all.includes("exemption exercised: packages/mpd-qa-roles-probe/dist/index.js"))
    rmSync(join(fxSource, "packages", "mpd-qa-roles-probe"), { recursive: true, force: true })

    // Arm 20 (T-63 on the REAL artifact, the seeded mutation the evidence files) — a byte-copy of the
    // canonical artifact is green; flipping ONE byte of one shipped file reddens at unchanged presence.
    // The copy is only ever READ from: the canonical `dist/mpd-package` is never written here.
    const realCopy = join(scratch, "real-artifact-copy")
    // preserveTimestamps: the copy must carry the REAL artifact's stamp, otherwise `cpSync`'s fresh
    // mtimes would re-date the pack to "now" and every post-pack writer would read as a hard drift —
    // measured: the first version of this arm reddened on exactly that artefact of the copy.
    cpSync(DEFAULT_PACKED, realCopy, { recursive: true, preserveTimestamps: true })
    arm("positive-control (byte-copy of the real artifact, exit 0)", runChecker(["--packed", realCopy, "--require-packed"]), (c) => c.status === 0)
    const realRef = join(realCopy, "agent-references", "troubleshooting.md")
    const realRefMtime = statSync(realRef).mtime
    const mutated = Buffer.from(readFileSync(realRef))
    mutated[0] = mutated[0] === 0x23 ? 0x20 : 0x23
    writeFileSync(realRef, mutated)
    // The write above would become the copy's newest mtime and therefore its INFERRED stamp — a
    // mutation of the artifact re-dates the pack it is measured against. Restoring the mtime keeps the
    // stamp at the real pack time. (A reviewer who edits an artifact copy and does NOT restore mtimes
    // must pass `--pack-stamp`: the inference is only valid for an artifact nobody wrote into since the
    // pack.) The bound this exposes is stated where the claim lives: the discriminator is the
    // TIMESTAMP ORDER, not content provenance, so a mutation inside an artifact whose source file also
    // carries a post-pack mtime is reported as the expected class — loudly, never silently.
    utimesSync(realRef, realRefMtime, realRefMtime)
    arm("negative-control (real artifact copy, one byte changed -> reported, not silent)", runChecker(["--packed", realCopy, "--require-packed"]), (c) => c.all.includes(EXPECTED_KIND) && c.all.includes("agent-references/troubleshooting.md"))
    // Arm 20c — the same mutated copy with the stamp PINNED at the source file's own mtime: now the
    // writer cannot be "after the pack", so the mutated byte is a hard CONTENT-DRIFT and the gate
    // reddens. This is the falsifiable pair for "a content mutation reddens": 20a green, 20c red.
    // PRECISION TRAP (measured 2026-09-17, wave 2b): `statSync().mtime` is a Date — millisecond
    // precision — while the gate compares `statSync().mtimeMs`, which carries sub-millisecond digits.
    // A source file whose mtime is `X.400086 ms` reads as NEWER than a pin built from `X.400`, so the
    // intended HARD verdict silently became the EXPECTED class and this arm flapped with the file's
    // mtime. The pin is therefore built from the FLOAT mtime, one millisecond above its floor, so the
    // file's own mtime is strictly older than the pin and the arm cannot flap.
    const sourceRefMtimeMs = statSync(join(repoRoot, "agent-references", "troubleshooting.md")).mtimeMs
    const pinnedStamp = new Date(Math.floor(sourceRefMtimeMs) + 1).toISOString()
    arm("negative-control (same mutation, stamp pinned -> hard CONTENT-DRIFT, exit 1)", runChecker(["--packed", realCopy, "--require-packed", "--pack-stamp", pinnedStamp]), (c) => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md"))

  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " (exit " + a.exitCode + ") :: " + a.firstLine)
  const failed = arms.filter((a) => !a.ok)
  console.log(PREFIX + " self-test " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed.length) + "/" + arms.length + " arms")
  return failed.length === 0 ? 0 : 1
}

const opts = parseArgs(process.argv.slice(2))
if (opts.selfTest) process.exit(selfTest())
const report = runCheck(opts)
printReport(report, opts)
process.exit(report.findings.length === 0 ? 0 : 1)
