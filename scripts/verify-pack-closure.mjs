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
// Gate story: `node scripts/verify-pack-closure.mjs` (exit 0 = closed) and
// `node scripts/verify-pack-closure.mjs --self-test` (both arms: a positive control
// on the real tree and negative controls that replay the historical defect on a TEMP
// fixture, so the checker's falsifiability is proven without touching the real packer).
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SELF = fileURLToPath(import.meta.url)
const repoRoot = dirname(dirname(SELF))
const DEFAULT_PACKER = join(repoRoot, "scripts", "pack-mpd.mjs")
const DEFAULT_PACKAGES_DIR = join(repoRoot, "packages")
const DEFAULT_PATCH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const PREFIX = "[verify-pack-closure]"

// Package path references of the bundle patch, in both spellings it uses:
// `@mpd-dsh/mpd/packages/<pkg>/<rel>` and the CLI form
// `node_modules/@mpd-dsh/mpd/packages/<pkg>/<rel>`.
const PATH_REF_RE = /mpd\/packages\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)/g

// A quoted path literal that would put a `templates` directory into the packed tree:
// matches "templates", "templates/<x>", "<x>/templates" and "<x>/templates/<y>".
// Measured trap: an earlier `templates/` (with a mandatory slash) form missed the
// realistic spelling `join(repoRoot, "templates", "mpd-extension")`, where the quoted
// segment is just "templates" — the falsifier for this assertion is arm 6.
const TEMPLATE_PATH_RE = /["'`]([^"'`]*\/)?templates(\/[^"'`]*)?["'`]/

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

  // Static assertion: the generic template must stay OUT of the packed tree.
  for (const pkg of [...listed].sort()) {
    if (/(^|\/)templates(\/|$)/.test(pkg)) {
      findings.push({ kind: "TEMPLATES", packages: [pkg], detail: "the packer's allowlist names `" + pkg + "` - the generic template must never be packed" })
    }
  }
  packerSrc.split(/\r?\n/).forEach((line, i) => {
    if (TEMPLATE_PATH_RE.test(line)) {
      findings.push({ kind: "TEMPLATES", packages: [], detail: opts.packerPath + ":" + (i + 1) + " carries a `templates` path literal - the generic template must never be packed" })
    }
  })

  const stats = {
    pluginCount: plugin.length,
    mcpCount: mcp.length,
    refCount: refs.length,
    classA: refs.filter((r) => classifyRef(r.rel) === "A").length,
    classB: refs.filter((r) => classifyRef(r.rel) === "B").length,
    classC: refs.filter((r) => classifyRef(r.rel) === "C").length
  }
  return { findings, stats }
}

function offendingPackages(findings) {
  return [...new Set(findings.flatMap((f) => f.packages))].sort()
}

function printReport(report, opts) {
  if (report.findings.length === 0) {
    const s = report.stats
    console.log(PREFIX + " ok: " + s.classA + " dist/index.js row(s) + " + s.classB + " adopted lib/index.js row(s) + " + s.classC + " mcp row(s) of the bundle patch all resolve; " + s.pluginCount + " PLUGIN_PKGS + " + s.mcpCount + " MCP_PKGS entries all exist; allowlist carries no templates/ entry")
    return
  }
  console.error(PREFIX + " FAIL - " + report.findings.length + " closure violation(s)")
  for (const f of report.findings) {
    const who = f.packages.length ? " [" + f.packages.join(", ") + "]" : ""
    console.error("  " + f.kind + who + " - " + f.detail)
  }
  const bad = offendingPackages(report.findings)
  if (bad.length) console.error("  offending packages: " + bad.join(", "))
  console.error("  packer: " + opts.packerPath)
  console.error("  packages dir: " + opts.packagesDir)
  console.error("  patch: " + opts.patchPath)
}

function printUsage() {
  console.log("usage: node scripts/verify-pack-closure.mjs [--self-test] [--packer <path>] [--packages-dir <dir>] [--patch <path>]")
  console.log("  no flags        check the real tree (exit 0 = the packer's allowlist is closed)")
  console.log("  --self-test     run the positive control and the negative controls on TEMP fixtures")
}

function parseArgs(argv) {
  const opts = { selfTest: false, packerPath: DEFAULT_PACKER, packagesDir: DEFAULT_PACKAGES_DIR, patchPath: DEFAULT_PATCH }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--self-test") opts.selfTest = true
    else if (a === "--packer") opts.packerPath = resolve(argv[++i] ?? "")
    else if (a === "--packages-dir") opts.packagesDir = resolve(argv[++i] ?? "")
    else if (a === "--patch") opts.patchPath = resolve(argv[++i] ?? "")
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
    // Arm 6 — negative control: the templates/ static assertion must discriminate. Add
    // a path literal that would pack the generic template, and require the TEMPLATES arm.
    const f6 = join(scratch, "packer-referencing-templates.mjs")
    writeFileSync(f6, original.replace("const MCP_PKGS =", 'const PACKED_TEMPLATE_ROOT = join(repoRoot, "templates", "mpd-extension")\nconst MCP_PKGS ='))
    arm("negative-control (templates path literal, exit 1)", runChecker(["--packer", f6]), (c) => c.status === 1 && c.all.includes("TEMPLATES") && /templates/.test(c.all))

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
