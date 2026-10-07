#!/usr/bin/env node
// F11 packer-closure guard: every plugin package the bundle patch MOUNTS must be
// listed by the packer, and every package the packer lists must still exist.
//
// The measured defect class this locks out (four occurrences, so it earned a gate
// instead of a plan note): `scripts/pack-mpd.ts` copies `packages/<pkg>/dist` for
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
// { recursive: true, filter: … })` in scripts/pack-mpd.ts — and the patch mounts
// it as `…/lib/index.ts`, never `…/dist/index.js`; it ships no `dist/` at all, so
// listing it would trip the packer's own missing-dist check. A glob rule would fail
// RED on a healthy tree and read as a regression. Hence the three reference classes
// below, keyed on the patch's real file path, not on a directory name.
//
// Offline and deterministic: it PARSES `scripts/pack-mpd.ts`'s source for the real
// lists (never a duplicated copy of them) and never invokes the packer.
// `scripts/pack-mpd.ts` is READ-ONLY for the whole wave; this file only reads it.
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
// Gate story: `node scripts/verify-pack-closure.ts` (exit 0 = closed) and
// `node scripts/verify-pack-closure.ts --self-test` (both arms: a positive control
// on the real tree and negative controls that replay the historical defect on a TEMP
// fixture, so the checker's falsifiability is proven without touching the real packer).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"

/** This script's own absolute path — the child process every arm of `--self-test` re-invokes. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, derived from this script's own URL under `<root>/scripts/`. */
const repoRoot: string = dirname(dirname(SELF))
/** The packer whose source tables this gate PARSES — it is read as text, never imported or run. */
const DEFAULT_PACKER: string = join(repoRoot, "scripts", "pack-mpd.ts")
/** The extension CLI whose scaffold-template constant and compiled-export list are parsed. */
const DEFAULT_CLI: string = join(repoRoot, "scripts", "mpd-ext.ts")
/** The directory holding one `packages/<pkg>` tree per plugin package. */
const DEFAULT_PACKAGES_DIR: string = join(repoRoot, "packages")
/** The bundle patch whose `packages/<pkg>/<rel>` rows the static half classifies. */
const DEFAULT_PATCH: string = join(repoRoot, "cordis.patch.yml")
/** The packed artifact the PACKED half checks when no `--packed <dir>` is given. */
const DEFAULT_PACKED: string = join(repoRoot, "dist", "mpd-package")
/** Prefix of every line this gate prints, so a caller can attribute the output. */
const PREFIX: string = "[verify-pack-closure]"

/** One declared exemption from the completeness rule. */
interface PackExempt {
  /** Packed-relative path prefix the exemption covers. */
  readonly prefix: string
  /** Why the exemption exists, printed in the verdict line so it can never be a silent skip. */
  readonly why: string
}

/** The span of one parsed `const <NAME> = [ … ]` literal, plus its double-quoted entries. */
interface ArraySpan {
  /** Double-quoted entries of the literal, in source order. */
  readonly entries: string[]
  /** Index of the literal's opening `[`. */
  readonly start: number
  /** Index of the literal's matching closing `]`. */
  readonly end: number
}

/** The scaffold template the packed CLI copies, DERIVED from the CLI and SDK sources. */
interface CliTemplate {
  /** The template's path segments below the repo root, e.g. `["templates", "mpd-extension"]`. */
  readonly segments: string[]
  /** The manifest file name inside the template directory. */
  readonly manifestFile: string
}

/** One `packages/<pkg>/<rel>` path a bundle-patch row mounts. */
interface PatchRef {
  /** Package directory name below `packages/`. */
  readonly pkg: string
  /** Path inside the package the row mounts, e.g. `dist/index.js`. */
  readonly rel: string
}

/** One source file's mtime reading, classified against the artifact's stamp. */
interface Observed {
  /** The mtime as an ISO-8601 string, printed in the provenance line. */
  readonly iso: string
  /** Whether the file was written strictly after the stamp plus the declared slack. */
  readonly after: boolean
}

/** The artifact stamp a CONTENT/COMPLETENESS reading was taken against. */
interface StampInfo {
  /** The stamp as an ISO-8601 string. */
  readonly iso: string
  /** Where the stamp came from: the command line, or the inference over the artifact's files. */
  readonly source: string
  /** Files the inference walked, or null when `--pack-stamp` pinned the time. */
  readonly files: number | null
}

/** The artifact's cut time in epoch milliseconds plus the anchor it was read from. */
interface ArtifactStamp {
  /** The cut time in epoch milliseconds; 0 means the artifact held no files at all. */
  readonly ms: number
  /** How `ms` was obtained — it travels into every drift verdict as its stated anchor. */
  readonly source: string
  /** Files the inference walked, or null when `--pack-stamp` pinned the time. */
  readonly files: number | null
}

/** One byte divergence between a source file and its artifact counterpart. */
interface ContentDriftEntry {
  /** Packed-relative path of the diverging file. */
  readonly path: string
  /** SHA-256 of the source bytes, carried for the report only. */
  readonly sourceSha256: string
  /** SHA-256 of the artifact bytes, carried for the report only. */
  readonly artifactSha256: string
  /** Source file size in bytes. */
  readonly sourceBytes: number
  /** Artifact file size in bytes. */
  readonly artifactBytes: number
  /** The source file's mtime as an ISO-8601 string. */
  readonly sourceMtime: string
}

/** A divergence classified EXPECTED because its source file was written after the pack. */
interface ContentExpectedEntry extends ContentDriftEntry {
  /** The provenance sentence naming the writer's mtime and the stamp's anchor. */
  readonly provenance: string
}

/** The CONTENT half's counters over the artifact. */
interface ContentStats {
  /** Files present on both sides that were byte-compared. */
  compared: number
  /** Files whose bytes were identical. */
  identical: number
  /** Hard divergences, each of which became a finding. */
  drift: ContentDriftEntry[]
  /** Divergences excused by a post-pack writer; printed, never counted as a violation. */
  expected: ContentExpectedEntry[]
}

/** A declared source file with no artifact counterpart. */
interface CompletenessAbsentEntry {
  /** Packed-relative path of the missing file. */
  readonly path: string
  /** The rule that declared it (a ROOT_ASSET_DIRS group, the per-package dist contract, …). */
  readonly scope: string
  /** The source file's mtime as an ISO-8601 string. */
  readonly sourceMtime: string
  /** Source file size in bytes. */
  readonly sourceBytes: number
}

/** A declared source file with no artifact counterpart, written after the pack. */
interface CompletenessExpectedEntry extends CompletenessAbsentEntry {
  /** The provenance sentence naming the writer's mtime and the stamp's anchor. */
  readonly provenance: string
}

/** One completeness exemption that was actually exercised by a declared file. */
interface ExemptEntry {
  /** Packed-relative path of the exempt file. */
  readonly path: string
  /** The rule that declared it. */
  readonly scope: string
  /** Why the exemption exists, copied verbatim from `PACK_EXEMPT_PATHS`. */
  readonly why: string
  /** The source file's mtime as an ISO-8601 string. */
  readonly sourceMtime: string
}

/** The COMPLETENESS half's counters over the artifact. */
interface CompletenessStats {
  /** Declared source files the rule looked at. */
  compared: number
  /** Declared source files that arrived. */
  present: number
  /** Declared source files with no counterpart, each of which became a finding. */
  absent: CompletenessAbsentEntry[]
  /** Declared exemptions exercised, counted in the verdict line. */
  exempt: ExemptEntry[]
  /** Declared files excused by a post-pack writer. */
  expected: CompletenessExpectedEntry[]
}

/** What `checkContentHalf` returns: the stamp it classified against and both counter blocks. */
interface ContentHalfStats {
  /** The stamp every reading in this half was classified against. */
  readonly stamp: StampInfo
  /** CONTENT counters. */
  readonly content: ContentStats
  /** COMPLETENESS counters. */
  readonly completeness: CompletenessStats
}

/** How many of the declared packages arrived in the artifact, against how many were declared. */
interface PackedPackageTally {
  /** Declared packages present in the artifact with at least one file. */
  readonly present: number
  /** Package names the packer declares across PLUGIN_PKGS, MCP_PKGS and the class-B rows. */
  readonly declared: number
}

/** The PACKED half's measured stats, printed by the verdict line. */
interface PackedStats {
  /** The packed directory under test. */
  packedDir: string
  /** One of `skipped`, `missing (required)`, `skipped: …` or `checked`, as printed. */
  packed: string
  /** Root asset directories the packed tree was asked to carry. */
  rootAssets: string[]
  /** The scaffold template resolved from the CLI, or null when its shape changed. */
  template: CliTemplate | null
  /** Total files found under the declared root asset directories. */
  files: number
  /** Named reference files present in the artifact. */
  referenceFiles: number
  /** Named root files present in the artifact. */
  rootFiles: number
  /** Declared packages present in the artifact, against the number declared. */
  packedPackages: PackedPackageTally
  /** CONTENT counters, or null when the packed half was skipped or took no reading. */
  content: ContentStats | null
  /** COMPLETENESS counters, or null when the packed half was skipped or took no reading. */
  completeness: CompletenessStats | null
  /** The stamp the CONTENT half used, or null when it took no reading. */
  stamp: StampInfo | null
}

/** One closure violation, printed as `<kind> [<packages>] - <detail>`. */
interface Finding {
  /** Finding family: OMISSION, INVERSE, PARSE, DEGRADED, MANIFEST, DOC-PAIR, CONTENT-DRIFT, … */
  readonly kind: string
  /** Packages the finding blames; empty when the finding is not package-scoped. */
  readonly packages: readonly string[]
  /** The one-line explanation, naming the file(s) involved. */
  readonly detail: string
}

/** Every command-line option this gate accepts, resolved to absolute paths. */
interface Options {
  /** Whether to run the fixture arms instead of the real check. */
  selfTest: boolean
  /** Path of the packer source whose tables are parsed (read, never imported). */
  packerPath: string
  /** Path of the extension CLI whose constants are parsed. */
  cliPath: string
  /** Directory holding one `packages/<pkg>` tree per plugin package. */
  packagesDir: string
  /** Path of the bundle patch whose rows are classified. */
  patchPath: string
  /** Path of the packed artifact the PACKED half checks. */
  packedDir: string
  /** Root of the tree the packer copies assets FROM. */
  sourceRoot: string
  /** Whether an absent packed tree is a failure instead of a printed skip. */
  requirePacked: boolean
  /** Pinned artifact cut time in epoch milliseconds, or null to infer it from the artifact. */
  packStampMs: number | null
}

/** What the static half hands the packed half about the tables it parsed. */
interface AskedAssets {
  /** Root asset directories the packer declares and the packed tree must carry. */
  readonly rootAssets: string[]
  /** The scaffold template resolved from the CLI, or null when its shape changed. */
  readonly template: CliTemplate | null
  /** The packer's PLUGIN_PKGS list, as parsed. */
  readonly pluginPkgs?: string[]
  /** The packer's MCP_PKGS list, as parsed. */
  readonly mcpPkgs?: string[]
  /** Package names the patch mounts as adopted main code (class B, no `dist/`). */
  readonly adoptedPkgs?: string[]
}

/** The static half's counters, plus the packed half's stats attached once they are measured. */
interface CheckStats {
  /** Parsed PLUGIN_PKGS entry count. */
  pluginCount: number
  /** Parsed MCP_PKGS entry count. */
  mcpCount: number
  /** Patch rows that reference a `packages/<pkg>/<rel>` path. */
  refCount: number
  /** Patch rows mounted as `dist/index.js` (built plugin packages). */
  classA: number
  /** Patch rows mounted as `lib/index.ts` (adopted main code, copied wholesale). */
  classB: number
  /** Patch rows mounted as anything else (MCP launchers and other CLI entries). */
  classC: number
  /** Root asset directories the packer declares. */
  rootAssets: string[]
  /** The packer's VALIDATOR_SHIM_EXPORTS list, empty when it could not be parsed. */
  shimExports: string[]
  /** The scaffold template resolved from the CLI, or null when its shape changed. */
  template: CliTemplate | null
  /** The packed half's measured stats; `runCheck` attaches them before the report prints. */
  packedStats: PackedStats | null
}

/** What `runCheck` returns: the findings plus the counters the report prints. */
interface CheckReport {
  /** Every closure violation found; an empty list is the PASS condition. */
  readonly findings: Finding[]
  /** The measured counters for both halves. */
  readonly stats: CheckStats
}

/** One child run's outcome: the exit code and the two decoded streams. */
interface ChildResult {
  /** The child's exit code, or null when it died on a signal. */
  readonly status: number | null
  /** The child's standard output. */
  readonly stdout: string
  /** The child's standard error. */
  readonly stderr: string
  /** `stdout` and `stderr` concatenated — what the arm predicates match against. */
  readonly all: string
}

/** One self-test arm's verdict line. */
interface Arm {
  /** The arm's name, printed between PASS/FAIL and the first output line. */
  readonly name: string
  /** Whether the arm's predicate held. */
  readonly ok: boolean
  /** The child's exit code, or null for a fixture-build arm that never ran a child. */
  readonly exitCode: number | null
  /** The first non-empty output line, so a failure is readable without re-running. */
  readonly firstLine: string
}

/** The packed `package.json` as far as this gate reads it: npm's `files` and `exports`. */
interface PackedManifest {
  /** npm's publish allowlist; the checker keeps only its string entries. */
  readonly files?: unknown
  /** npm's subpath export map; probed for one `./<asset>/*` key per root asset. */
  readonly exports?: unknown
}

// The asset classes a PACKED install needs to be author-facing, as decided 2026-09-17:
// `templates` (T-35), `docs` (T-36/T-45) and the ON-DEMAND agent `agent-references`
// (captain's t11 addition, after t16 moved the manual's bulk there). Named here as the groups
// that must never silently vanish again; `skills`/`presets`/`extensions` are asserted the same
// way but were never absent.
const REQUIRED_ROOT_ASSETS: readonly string[] = ["templates", "docs", "agent-references"]
// Finding kind per group. The templates/docs decision arm keeps the "TEMPLATES" kind its
// evidence block and self-test arm cite (the flipped arm — see the header), while the reference
// group reports "REFERENCES" so a missing author-critical file is never read as a template
// problem. An unknown group falls back to "ASSET-MISSING".
const ROOT_ASSET_KIND: Record<string, string> = { templates: "TEMPLATES", docs: "TEMPLATES", "agent-references": "REFERENCES" }
// The two files an external author needs when a boot misbehaves (AGENTS.md's on-demand Reference
// Index). Named because "the directory arrived" is not the claim — these files are. English-only:
// no *.zh-CN.md twin belongs in this group, and `bun run verify:docs` does not discover the tree
// (measured: pairs unchanged). The adopted-plugin delta registry that used to be the third entry
// is DELETED with the body it described (de-vendor wave), so a boot can no longer be debugged
// against it and naming it here would be a permanent red.
const REQUIRED_REFERENCE_FILES: readonly string[] = ["index.md", "troubleshooting.md"]
// Root FILES that must ship by NAME (not by directory). Same shape as the reference list above
// and for a sharper reason: the manifest arm below is DECLARATION-DRIVEN — a file present but
// unlisted is loud, a pattern listed but absent is loud, and a file declared NOWHERE is invisible
// by construction. A `files[]` entry alone would therefore make a future REMOVAL loud but never a
// future ADDITION-omission, which is exactly the shape that shipped an artifact whose own README,
// docs/index.md and extension authoring guide linked by relative path to a file it did not carry
// (T-70: ten such links across six shipped files). This list is the source-side expectation, and
// `scripts/pack-mpd.ts` carries the matching ROOT_FILES table the static half compares it to.
const REQUIRED_ROOT_FILES: readonly string[] = ["EXTENSIONS-FOR-AGENTS.md"]
/** Finding kind of a named ROOT FILE the artifact must carry (T-70). */
const ROOT_FILE_KIND: string = "ROOT-FILE"

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
/** Finding kind of a byte divergence between a source file and its artifact copy. */
const CONTENT_KIND: string = "CONTENT-DRIFT"
/** Finding kind of a declared source file with no artifact counterpart. */
const COMPLETENESS_KIND: string = "COMPLETENESS"
/** Finding kind of a divergence whose source file was written after the artifact's stamp. */
const EXPECTED_KIND: string = "CONTENT-DRIFT-EXPECTED"
// A divergence is expected only when the source is STRICTLY newer than the stamp: no slack, because a
// slack window is indistinguishable from a real stale artifact that was simply written moments later.
// BOUND, stated because the claim is weaker than "the artifact is authentic": the discriminator is the
// TIMESTAMP ORDER, not content provenance — the artifact carries no per-file digest manifest, so a
// mutation INSIDE an artifact whose source file also carries a post-pack mtime is classified expected
// (reported loudly, never silently). Pin the stamp with `--pack-stamp <iso>` when the inference cannot
// hold: an artifact somebody wrote into since the pack, or a copy whose mtimes were not preserved.
const EXPECTED_SLACK_MS: number = 0
/** The declared pardons from the completeness rule; every one MUST be exercised or named in the verdict. */
const PACK_EXEMPT_PATHS: ReadonlyArray<PackExempt> = [
  {
    prefix: "packages/mpd-qa-roles-probe/",
    why: "QA-only probe, mounted by a QA overlay and never by the shipped patch - the packer's own PLUGIN_PKGS comment says so verbatim (scripts/pack-mpd.ts, mpd-team-compact-plugin entry): \"mpd-qa-roles-probe is deliberately absent because it is QA-only and mounted by an overlay, never by the shipped patch\"",
  },
]

// Package path references of the bundle patch, in both spellings it uses:
// `@mpd-dsh/mpd/packages/<pkg>/<rel>` and the CLI form
// `node_modules/@mpd-dsh/mpd/packages/<pkg>/<rel>`.
const PATH_REF_RE: RegExp = /mpd\/packages\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)/g

// Mini-lexer over ONE `const <NAME> = [ … ]` literal: returns its double-quoted
// entries plus the span of the literal. Comments (`// …`) and single-quoted/backtick
// strings are skipped as units, so an apostrophe or an escaped slash inside a COMMENT
// can never unbalance the scan. Measured trap: a naive quote tracker treated the
// apostrophe in "the extension wave's QA lane" as a string opener, ran off the end of
// the file and reported 37 phantom entries (LICENSE, dist, utf8, …) — the check then
// failed on a healthy tree. Null = the literal is absent or unterminated. The anchor
// tolerates the OPTIONAL TypeScript type annotation the converted packer and CLI write
// between the name and `=` (`const PLUGIN_PKGS: readonly string[] = [`), because that
// annotation is a typing change and not a shape change the gate should refuse.
/**
 * Parse one `const <NAME> = [ … ]` literal out of a source text.
 *
 * @param src Source text of the packer or the CLI (never executed).
 * @param constName The constant whose literal is wanted, e.g. `PLUGIN_PKGS`.
 * @returns The literal's span and entries, or null when it is absent or unterminated.
 */
function scanArrayLiteral(src: string, constName: string): ArraySpan | null {
  /** The anchor that finds the literal's opening bracket. */
  const anchor = new RegExp("const\\s+" + constName + "\\s*(?::[^=]*)?=\\s*\\[")
  /** The anchor's match, or null when the literal is absent. */
  const m = anchor.exec(src)
  if (!m) return null
  /** Index of the literal's opening `[`. */
  const start = m.index + m[0].length - 1
  /** Double-quoted entries collected so far. */
  const entries: string[] = []
  /** Bracket depth, so only depth-1 strings become entries. */
  let depth = 0
  /** The single quote or backtick the scan is currently inside, else null. */
  let quote: string | null = null
  /** Whether the scan is inside a `//` comment. */
  let comment = false
  for (let i = start; i < src.length; i += 1) {
    /** The character at the current index. */
    const c = src[i]
    if (comment) { if (c === "\n") comment = false; continue }
    if (quote) {
      if (c === "\\") { i += 1; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "/" && src[i + 1] === "/") { comment = true; i += 1; continue }
    if (c === '"') {
      /** The string's decoded value, without its surrounding quotes. */
      let val = ""
      /** Index of the character after the opening quote. */
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
/**
 * The entries of one array literal, without its empty strings.
 *
 * @param src Source text of the packer or the CLI.
 * @param constName The constant whose entries are wanted.
 * @returns The literal's non-empty entries, or null when the literal was not parsed.
 */
function readPackageList(src: string, constName: string): string[] | null {
  /** The parsed literal span, or null when it is absent or unterminated. */
  const span = scanArrayLiteral(src, constName)
  if (span === null) return null
  return span.entries.filter((s: string): boolean => s.length > 0)
}

/** Every file below `root`, as sorted `/`-separated paths. Absent root = []. */
function treeFiles(root: string): string[] {
  /** Every file found, as a path relative to `root`. */
  const out: string[] = []
  /** Walk one directory, carrying the path prefix accumulated so far. */
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      /** The child's path relative to `root`. */
      const child = prefix === "" ? entry.name : prefix + "/" + entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), child)
      else if (entry.isFile()) out.push(child)
    }
  }
  if (existsSync(root)) walk(root, "")
  return out.sort()
}

/** `a/b.zh-CN.md` <-> `a/b.md`; undefined for a file that carries no language suffix rule. */
function twinName(file: string): string | undefined {
  if (file.endsWith(".zh-CN.md")) return file.slice(0, -".zh-CN.md".length) + ".md"
  if (file.endsWith(".md")) return file.slice(0, -".md".length) + ".zh-CN.md"
  return undefined
}

/**
 * The scaffold template the CLI copies, DERIVED from its source instead of hard-coded here:
 * `scripts/mpd-ext.ts` declares `const TEMPLATE_DIR: string = join(repoRoot, "<a>", "<b>")` and
 * `const MANIFEST_FILE = sdk.MPD_EXT_CONTRACT.manifestFile`, and the SDK names the file
 * through a constant. Null = the shape changed, which is a FINDING (never a guess). The two
 * patterns tolerate the optional TypeScript type annotation between a name and its `=`.
 */
function resolveCliTemplate(cliSrc: string, sdkSrc: string): CliTemplate | null {
  /** The template directory's two path segments, read from the CLI's own `join(repoRoot, …)`. */
  const dir = /const\s+TEMPLATE_DIR\s*(?::[^=]*)?=\s*join\(repoRoot,\s*"([^"]+)",\s*"([^"]+)"\)/.exec(cliSrc)
  /** The SDK property the CLI names its manifest file through. */
  const ref = /manifestFile:\s*([A-Za-z0-9_]+)/.exec(sdkSrc)
  if (dir === null || ref === null) return null
  /** The SDK's own declaration of that constant, which carries the file name. */
  const file = new RegExp("const\\s+" + ref[1] + "\\s*=\\s*\"([^\"]+)\"").exec(sdkSrc)
  if (file === null) return null
  return { segments: [dir[1], dir[2]], manifestFile: file[1] }
}

// Reference class of a patch row, keyed on the FILE the row mounts:
//   A  `dist/index.js` — a built plugin package: MUST be in PLUGIN_PKGS ∪ MCP_PKGS.
//   B  `lib/index.ts`  — adopted main code copied wholesale (no dist/): the package
//                        directory must exist and it must NOT be in the lists.
//   C  anything else   — e.g. `launch.ts` / `dist/cli.js` for an MCP server:
//                        MUST be in PLUGIN_PKGS ∪ MCP_PKGS.
/** The reference class of one mounted path: A built plugin, B adopted main code, C anything else. */
function classifyRef(rel: string): "A" | "B" | "C" {
  if (rel === "dist/index.js") return "A"
  if (rel === "lib/index.ts") return "B"
  return "C"
}

/**
 * Every distinct `packages/<pkg>/<rel>` path the bundle patch references, sorted by `pkg|rel`
 * so a report is stable across runs; a repeated row collapses to ONE entry.
 *
 * @param patchText The bundle patch's text.
 * @returns The distinct references in sorted order.
 */
function patchPackageRefs(patchText: string): PatchRef[] {
  /** Distinct references, keyed `pkg/rel` so a repeated row collapses. */
  const refs = new Map<string, PatchRef>()
  for (const m of patchText.matchAll(PATH_REF_RE)) {
    /** The `pkg/rel` key this match contributes. */
    const key = m[1] + "/" + m[2]
    if (!refs.has(key)) refs.set(key, { pkg: m[1], rel: m[2] })
  }
  return [...refs.values()].sort((a: PatchRef, b: PatchRef): number => (a.pkg + "|" + a.rel).localeCompare(b.pkg + "|" + b.rel))
}

/** Every immediate subdirectory name of `dir`, sorted; [] when it does not exist. */
function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isDirectory())
    .map((entry: Dirent): string => entry.name)
    .sort()
}

/**
 * The pack's own write time, INFERRED from the artifact - never asserted as a fact: `cpSync` gives
 * every copied file the moment of its copy, so the newest mtime among the artifact's files is the end
 * of the pack. `--pack-stamp <iso>` overrides it for a reviewer who knows the real cut time. The
 * reading's SOURCE travels with it into every report, so no drift verdict borrows an unstated anchor.
 */
function artifactStamp(packed: string, overrideMs: number | null): ArtifactStamp {
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return { ms: overrideMs, source: "command line (--pack-stamp)", files: null }
  }
  /** The newest mtime seen, in epoch milliseconds; 0 until a file has been read. */
  let ms = 0
  /** How many artifact files the inference walked. */
  let files = 0
  for (const rel of treeFiles(packed)) {
    files += 1
    /** The file's own mtime in epoch milliseconds. */
    const mtime = statSync(join(packed, rel)).mtimeMs
    if (mtime > ms) ms = mtime
  }
  return { ms, source: "inferred: the newest mtime among the artifact's own files (cpSync gives every copied file the pack's write time)", files }
}

/** The declared exemption covering one packed-relative path, or undefined when none does. */
function exemptFor(rel: string): PackExempt | undefined {
  return PACK_EXEMPT_PATHS.find((entry: PackExempt): boolean => rel.startsWith(entry.prefix))
}

/**
 * CONTENT (T-63, T-76) + COMPLETENESS (T-65) over the produced tree. Pure comparison over explicit
 * inputs, so `--self-test` drives the same code at a fixture. Every divergence is classified against
 * the artifact's stamp and the EXPECTED class is returned for the report - reported loudly, never
 * silently dropped, and never counted as a closure violation.
 */
function checkContentHalf(opts: Options, findings: Finding[], asked: AskedAssets, packed: string): ContentHalfStats {
  /** The stamp every reading in this half is classified against. */
  const stamp = artifactStamp(packed, opts.packStampMs ?? null)
  /** CONTENT counters, filled in by `compareBytes`. */
  const content: ContentStats = { compared: 0, identical: 0, drift: [], expected: [] }
  /** COMPLETENESS counters, filled in by `requireCounterpart` and the loops below. */
  const completeness: CompletenessStats = { compared: 0, present: 0, absent: [], exempt: [], expected: [] }
  /** The half's result: the stamp plus both counter blocks. */
  const stats: ContentHalfStats = { stamp: { iso: new Date(stamp.ms).toISOString(), source: stamp.source, files: stamp.files }, content, completeness }
  if (stamp.ms === 0) return stats

  /** Read one source file's mtime and classify it against the stamp. */
  const observe = (srcAbs: string): Observed => {
    /** The source file's mtime in epoch milliseconds, sub-millisecond digits included. */
    const mtimeMs = statSync(srcAbs).mtimeMs
    return { iso: new Date(mtimeMs).toISOString(), after: mtimeMs > stamp.ms + EXPECTED_SLACK_MS }
  }
  /** The provenance sentence for one EXPECTED reading: its path, the writer's mtime and the anchor. */
  const provenance = (rel: string, observed: Observed): string =>
    rel + ": source mtime " + observed.iso + " is AFTER the artifact stamp " + stats.stamp.iso + " (anchor: " + stats.stamp.source + ") - a writer landed after the pack, so this is an EXPECTED reading, not a closure violation"

  /** Byte-compare one source/artifact pair; push a hard drift or an EXPECTED reading. */
  const compareBytes = (rel: string, srcAbs: string, artAbs: string, kind: string = CONTENT_KIND): void => {
    content.compared += 1
    /** The source file's bytes. */
    const srcBuf = readFileSync(srcAbs)
    /** The artifact file's bytes. */
    const artBuf = readFileSync(artAbs)
    // The gate's EXISTING byte idiom (the ROOT_FILES rule) is a buffer comparison; the digests below
    // are for the REPORT only and never decide anything.
    if (srcBuf.equals(artBuf)) {
      content.identical += 1
      return
    }
    /** SHA-256 of the source bytes, printed in the finding. */
    const srcSha = createHash("sha256").update(srcBuf).digest("hex")
    /** SHA-256 of the artifact bytes, printed in the finding. */
    const artSha = createHash("sha256").update(artBuf).digest("hex")
    /** The source file's mtime reading, which decides the divergence's class. */
    const observed = observe(srcAbs)
    /** The divergence record, shared by the hard and the expected classes. */
    const entry: ContentDriftEntry = {
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

  /** Assert one declared source file has an artifact counterpart, or push a COMPLETENESS finding. */
  const requireCounterpart = (rel: string, srcAbs: string, scope: string): void => {
    completeness.compared += 1
    /** The source file's mtime reading, which decides absence from expectation. */
    const observed = observe(srcAbs)
    /** The declared exemption covering this path, when one does. */
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
    /** The artifact's file set under this asset directory. */
    const shipped = new Set(treeFiles(join(packed, dir)))
    for (const rel of treeFiles(join(opts.sourceRoot, dir))) {
      /** The source file's packed-relative path. */
      const relPath = dir + "/" + rel
      /** The source file's absolute path. */
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
    /** The source file's packed-relative path. */
    const relPath = "packages/" + rel
    /** The artifact file this source file must equal. */
    const artAbs = join(packed, relPath)
    if (!existsSync(artAbs)) continue
    compareBytes(relPath, join(opts.sourceRoot, "packages", rel), artAbs)
  }

  // (c) the packer's dist contract - the direction T-65 is about: every `packages/<pkg>/dist/**` file
  //     in the tree must have an artifact counterpart, with the ONE declared exemption COUNTED.
  for (const pkg of listDirs(opts.packagesDir)) {
    for (const rel of treeFiles(join(opts.packagesDir, pkg, "dist"))) {
      /** The built file's packed-relative path. */
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
    /** The required root file's absolute source path. */
    const srcAbs = join(opts.sourceRoot, file)
    /** The required root file's absolute artifact path. */
    const artAbs = join(packed, file)
    if (!existsSync(srcAbs) || !existsSync(artAbs)) continue
    compareBytes(file, srcAbs, artAbs, ROOT_FILE_KIND)
  }

  return stats
}

/**
 * The PACKED half: does the artifact actually carry what the static half says it must? Every
 * rule here is per-FILE, so a violation names the file — the omission class this wave closes
 * (`npm run pack` exits 0 while the tree silently lacks an asset) can never be a summary line
 * again. Pushes findings into the caller's array; returns the stats it measured.
 */
function checkPackedHalf(opts: Options, findings: Finding[], asked: AskedAssets): PackedStats {
  /** The packed directory under test. */
  const packed = opts.packedDir
  /** The half's result, filled in as the rules below run. */
  const stats: PackedStats = { packedDir: packed, packed: "skipped", rootAssets: [], template: asked.template, files: 0, referenceFiles: 0, rootFiles: 0, packedPackages: { present: 0, declared: 0 }, content: null, completeness: null, stamp: null }
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
    /** The asset directory inside the artifact. */
    const target = join(packed, dir)
    /** The files the artifact holds under it. */
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
    /** The template root as a packed-relative path. */
    const rel = asked.template.segments.join("/")
    /** The template manifest the packed CLI would copy. */
    const packedManifest = join(packed, ...asked.template.segments, asked.template.manifestFile)
    if (!existsSync(packedManifest)) {
      findings.push({ kind: "TEMPLATES", packages: [], detail: "scripts/mpd-ext.ts scaffold copies <root>/" + rel + " but the packed tree has no " + relative(packed, packedManifest) + " — the documented author workflow would have nothing to copy (T-35)" })
    }
  }

  // 3. docs/ + templates/ + agent-references/: the packed set must EQUAL the source set, file for
  //    file. A HALF pair (a doc whose zh-CN twin exists in the source and did not ship) is
  //    reported as such, because that is the failure mode a selective copy produces (T-36/T-45).
  for (const rel of ["docs", "templates", "agent-references"]) {
    /** The asset files the source tree holds. */
    const source = treeFiles(join(opts.sourceRoot, rel))
    /** The asset files the artifact holds. */
    const shipped = treeFiles(join(packed, rel))
    if (source.length === 0 && shipped.length === 0) continue
    /** Source files the artifact does not hold. */
    const missing = source.filter((file: string): boolean => !shipped.includes(file))
    /** Artifact files the source tree does not hold. */
    const extra = shipped.filter((file: string): boolean => !source.includes(file))
    /** Missing files whose language twin DID ship — the half-pair shape (T-36/T-45). */
    const half = missing.filter((file: string): boolean => {
      /** The file's language twin, or undefined when the name carries no suffix rule. */
      const twin = twinName(file)
      return twin !== undefined && shipped.includes(twin)
    })
    for (const file of half) {
      /** The twin that shipped without its counterpart. */
      const twin = twinName(file)
      findings.push({ kind: "DOC-PAIR", packages: [], detail: rel + "/" + twin + " shipped without its twin " + file + " — a packed doc pair must never be half (EN + *.zh-CN.md ship together)" })
    }
    /** Missing files that are not part of a half pair. */
    const dropped = missing.filter((file: string): boolean => !half.includes(file))
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
  /** The packed manifest's path. */
  const manifestPath = join(packed, "package.json")
  /** The parsed manifest, or null when it is absent or unparseable. */
  let manifest: PackedManifest | null = null
  if (!existsSync(manifestPath)) {
    findings.push({ kind: "MANIFEST", packages: [], detail: "the packed tree has no package.json — the artifact is not an installable package" })
  } else {
    try {
      manifest = readJson<PackedManifest>(manifestPath)
    } catch (error) {
      findings.push({ kind: "MANIFEST", packages: [], detail: "the packed package.json is not parseable: " + (error instanceof Error ? error.message : String(error)) })
    }
  }
  if (manifest !== null) {
    /** The manifest's `files` entries that really are strings. */
    const patterns: string[] = Array.isArray(manifest.files) ? manifest.files.filter((p: unknown): p is string => typeof p === "string") : []
    if (patterns.length === 0) findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest declares no `files` list — npm would publish whatever it defaults to, not what this checker verified" })
    /** A `files` pattern's top-level entry: the `<dir>/**` glob's directory or the first literal segment. */
    const topOf = (pattern: string): string => (pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern).split("/")[0]
    for (const entry of readdirSync(packed).sort()) {
      if (entry === "package.json") continue // npm always includes it, listed or not
      if (!patterns.some((pattern: string): boolean => topOf(pattern) === entry)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "<packed>/" + entry + " is in the artifact but no `files` pattern covers it — present but unlisted is a closure failure" })
      }
    }
    for (const pattern of patterns) {
      /** The pattern's top-level entry. */
      const top = topOf(pattern)
      if (top.length === 0 || top.includes("*")) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the `files` pattern " + pattern + " has no concrete top-level entry to check — refusing to treat an unverifiable pattern as closed" })
        continue
      }
      /** The top-level path the pattern claims to ship. */
      const target = join(packed, top)
      if (!existsSync(target)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest lists `" + pattern + "` but <packed>/" + top + " is absent — listed but absent is a closure failure" })
      } else if (pattern.endsWith("/**") && treeFiles(target).length === 0) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest lists `" + pattern + "` but <packed>/" + top + " is EMPTY" })
      }
    }
    /** The manifest's `exports` map, or an empty object when the field is not one. */
    const exported: object = manifest.exports !== null && typeof manifest.exports === "object" ? manifest.exports : {}
    for (const dir of asked.rootAssets) {
      if (!("./" + dir + "/*" in exported)) {
        findings.push({ kind: "MANIFEST", packages: [], detail: "the packed manifest exports no `./" + dir + "/*` — <packed>/" + dir + " ships but is not addressable like skills/ and presets/ (the asset + its declaration ship together, plan §1.9 rule)" })
      }
    }
  }

  // 5. the named agent references: the group being non-empty is not the claim, these files are.
  for (const file of REQUIRED_REFERENCE_FILES) {
    /** The reference file's packed-relative path. */
    const rel = "agent-references/" + file
    if (!existsSync(join(packed, rel))) {
      findings.push({ kind: "REFERENCES", packages: [], detail: "the packed tree does not carry " + rel + " - an external author loses the reference the artifact is supposed to be self-sufficient for" })
    }
  }
  stats.referenceFiles = REQUIRED_REFERENCE_FILES.filter((file: string): boolean => existsSync(join(packed, "agent-references", file))).length

  // 5b. the named ROOT FILES: EXISTENCE here; BYTE equality is owned by the content sweep (rule 7d),
  // because only that engine holds the artifact's stamp and can tell a POST-PACK WRITER from a genuine
  // mismatch. Before the t9-R1 repair the byte half lived here and hard-reddened with no writer named —
  // measured: `ROOT-FILE … EXTENSIONS-FOR-AGENTS.md` went red for t25's 07:43:40Z rewrite against the
  // 05:19:48Z artifact, i.e. a legitimate in-flight state with no provenance. The list lives in the GATE
  // rather than being derived from the packer, precisely because a file nobody declared has to be
  // expected from the source side before the artifact can be asked for it (T-70).
  for (const file of REQUIRED_ROOT_FILES) {
    /** The root file's path inside the artifact. */
    const packedFile = join(packed, file)
    if (!existsSync(packedFile)) {
      findings.push({ kind: ROOT_FILE_KIND, packages: [], detail: "the packed tree does not carry " + file + " - the artifact's own README/docs link to it by relative path, so those links break for an author who holds only the artifact (T-70)" })
    }
  }
  stats.rootFiles = REQUIRED_ROOT_FILES.filter((file: string): boolean => existsSync(join(packed, file))).length

  // 5c. EVERY DECLARED PACKAGE DIRECTORY must be present in the artifact with at least one file.
  // The static half asserts these entries against the SOURCE, and every other packed rule is
  // per-FILE — so a package that never arrives at all produces no row anywhere: the manifest arm
  // only checks that `<packed>/packages` exists (a `files` pattern's top-level entry), and the
  // per-file rules have nothing to walk. Measured with a seeded control (T-70 finding 2): a copy
  // of the artifact with one declared PLUGIN_PKG removed left this checker exiting 0 while its own
  // verdict line still asserted "18 PLUGIN_PKGS + 4 MCP_PKGS entries all exist". That sentence is
  // SOURCE-rooted; this block is the product-side half that makes the omission loud.
  /** Every package name the packer declares, from its two lists and the patch's class-B rows. */
  const declaredPkgs = [...new Set([...(asked.pluginPkgs ?? []), ...(asked.mcpPkgs ?? []), ...(asked.adoptedPkgs ?? [])])]
  /** How many of those packages arrived in the artifact with at least one file. */
  let packedPkgsPresent = 0
  for (const pkg of declaredPkgs) {
    /** The package's directory inside the artifact. */
    const dir = join(packed, "packages", pkg)
    /** The files the artifact holds under it, or [] when the directory is absent. */
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
  /** The compiled validator sidecar the packed CLI imports. */
  const validatorEntry = join(packed, "packages", "mpd-ext-plugin", "dist", "validator.js")
  if (!existsSync(validatorEntry)) {
    findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "the packed tree ships scripts/mpd-ext.ts but no " + relative(packed, validatorEntry) + " — validate/scaffold/--self-test would all die on the missing validator (T-51)" })
  }

  // 7. CONTENT (bytes) + COMPLETENESS — the two rules that read file CONTENTS rather than names
  //    (T-63 / T-65 / T-76). Both run against the tree that was actually produced, and the EXPECTED
  //    class is returned for the report instead of being folded into the verdict.
  /** The content half's result, whose counters and stamp the report prints. */
  const contentStats = checkContentHalf(opts, findings, asked, packed)
  stats.content = contentStats.content
  stats.completeness = contentStats.completeness
  stats.stamp = contentStats.stamp
  return stats
}

// Pure comparison over explicit inputs, so `--self-test` can drive it at a fixture.
/**
 * Run both halves and collect every finding.
 *
 * @param opts The resolved options (paths, flags).
 * @returns The findings plus the counters the report prints.
 */
function runCheck(opts: Options): CheckReport {
  /** Every closure violation found so far. */
  const findings: Finding[] = []
  /** The packer's source, read once: the tables below are parsed from it, never imported. */
  const packerSrc = readFileSync(opts.packerPath, "utf8")
  /** The packer's PLUGIN_PKGS list, or null when the literal could not be parsed. */
  const pluginPkgs = readPackageList(packerSrc, "PLUGIN_PKGS")
  /** The packer's MCP_PKGS list, or null when the literal could not be parsed. */
  const mcpPkgs = readPackageList(packerSrc, "MCP_PKGS")

  if (pluginPkgs === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const PLUGIN_PKGS = [` literal in " + opts.packerPath })
  }
  if (mcpPkgs === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const MCP_PKGS = [` literal in " + opts.packerPath })
  }
  /** The packer's plugin list, empty when its literal could not be parsed. */
  const plugin = pluginPkgs ?? []
  /** The packer's MCP list, empty when its literal could not be parsed. */
  const mcp = mcpPkgs ?? []
  /** Every package name the packer says it copies. */
  const listed = new Set([...plugin, ...mcp])

  // Zero-subject guard: a run with nothing to compare is a DEGRADED run, never a pass.
  if (plugin.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the packer declares no PLUGIN_PKGS entries - refusing to report PASS with nothing to compare" })
  }
  if (mcp.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the packer declares no MCP_PKGS entries - refusing to report PASS with nothing to compare" })
  }

  /** The bundle patch's text. */
  const patchText = readFileSync(opts.patchPath, "utf8")
  /** Every distinct package path the patch mounts. */
  const refs = patchPackageRefs(patchText)
  if (refs.length === 0) {
    findings.push({ kind: "DEGRADED", packages: [], detail: "the bundle patch references no `packages/<pkg>/…` path - refusing to report PASS with nothing to compare" })
  }

  // Direction 1 (the F11 omission): a mounted package the packer would not copy.
  for (const r of refs) {
    /** The row's reference class, keyed on the file it mounts. */
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
        detail: "packages/" + r.pkg + " is mounted as " + r.rel + " (adopted main code, copied wholesale by scripts/pack-mpd.ts and shipped without a dist/) yet it IS in PLUGIN_PKGS - the packer's own missing-dist check would then fail the pack"
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
  /** The packer's ROOT_ASSET_DIRS list, or null when the literal could not be parsed. */
  const rootAssets = readPackageList(packerSrc, "ROOT_ASSET_DIRS")
  if (rootAssets === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no `const ROOT_ASSET_DIRS = [` literal in " + opts.packerPath + " - the root-asset contract is gone, refusing to report PASS" })
  }
  /** The packer's declared root asset directories, empty when the literal could not be parsed. */
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
  /** The packer's ROOT_FILES list, or null when the literal could not be parsed. */
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
  /** The extension CLI's source, read for its template constant and export list. */
  const cliSrc = readFileSync(opts.cliPath, "utf8")
  /** The extension SDK's source, which names the template manifest file. */
  const sdkSrc = readFileSync(join(opts.sourceRoot, "packages", "mpd-ext-plugin", "src", "sdk.ts"), "utf8")
  /** The scaffold template the CLI copies, or null when its shape changed. */
  const template = resolveCliTemplate(cliSrc, sdkSrc)
  if (template === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "cannot resolve the scaffold template from " + opts.cliPath + " (TEMPLATE_DIR join) and the SDK (manifestFile) - refusing to check the packed scaffold asset against a guess" })
  }
  /** The CLI's REQUIRED_COMPILED_EXPORTS list, or null when the literal could not be parsed. */
  const requiredExports = readPackageList(cliSrc, "REQUIRED_COMPILED_EXPORTS")
  /** The packer's VALIDATOR_SHIM_EXPORTS list, or null when the literal could not be parsed. */
  const shimExports = readPackageList(packerSrc, "VALIDATOR_SHIM_EXPORTS")
  if (requiredExports === null || shimExports === null) {
    findings.push({ kind: "PARSE", packages: [], detail: "no REQUIRED_COMPILED_EXPORTS (" + opts.cliPath + ") or VALIDATOR_SHIM_EXPORTS (" + opts.packerPath + ") array literal - the compiled-validator contract is gone, refusing to report PASS" })
  } else {
    if (requiredExports.length < 8) {
      findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "the CLI requires only " + requiredExports.length + " compiled exports - a degenerate list would let a shim pass that cannot serve the commands" })
    }
    /** The CLI's required export names, sorted for comparison. */
    const want = [...requiredExports].sort()
    /** The packer's shim export names, sorted for comparison. */
    const got = [...shimExports].sort()
    if (want.join("\u0000") !== got.join("\u0000")) {
      /** Export names the CLI requires and the packer's shim omits. */
      const onlyCli = want.filter((n: string): boolean => !got.includes(n))
      /** Export names the packer's shim declares and the CLI does not require. */
      const onlyPacker = got.filter((n: string): boolean => !want.includes(n))
      findings.push({ kind: "CLI-VALIDATOR", packages: [], detail: "scripts/mpd-ext.ts REQUIRED_COMPILED_EXPORTS and scripts/pack-mpd.ts VALIDATOR_SHIM_EXPORTS disagree - only in the CLI: " + (onlyCli.join(", ") || "(none)") + "; only in the packer: " + (onlyPacker.join(", ") || "(none)") })
    }
  }

  /** The static half's counters plus the packed half's stats, attached just below. */
  const stats: CheckStats = {
    pluginCount: plugin.length,
    mcpCount: mcp.length,
    refCount: refs.length,
    classA: refs.filter((r: PatchRef): boolean => classifyRef(r.rel) === "A").length,
    classB: refs.filter((r: PatchRef): boolean => classifyRef(r.rel) === "B").length,
    classC: refs.filter((r: PatchRef): boolean => classifyRef(r.rel) === "C").length,
    rootAssets: assets,
    shimExports: shimExports ?? [],
    template,
    packedStats: null
  }
  // The adopted main-code packages the bundle patch mounts as class B (no dist/, copied
  // wholesale by the packer). Derived from the patch rows — the same source the static half
  // classifies from — so the packed-package assertion below covers PLUGIN_PKGS, MCP_PKGS and the
  // adopted package in one pass (T-70 finding 2).
  /** Package names the patch mounts as class B (adopted main code, no `dist/`). */
  const adopted = [...new Set(refs.filter((r: PatchRef): boolean => classifyRef(r.rel) === "B").map((r: PatchRef): string => r.pkg))]
  stats.packedStats = checkPackedHalf(opts, findings, { rootAssets: assets, template, pluginPkgs: plugin, mcpPkgs: mcp, adoptedPkgs: adopted })
  return { findings, stats }
}

/** The distinct package names the findings blame, sorted, for the report's summary line. */
function offendingPackages(findings: Finding[]): string[] {
  return [...new Set(findings.flatMap((f: Finding): readonly string[] => f.packages))].sort()
}

/** Print the verdict: one ok line, or every violation plus the offending packages. */
function printReport(report: CheckReport, opts: Options): void {
  /** The measured counters. */
  const s = report.stats
  /** The packed half's stats; `runCheck` attaches them to every report before this runs. */
  const packedStats = s.packedStats!
  /** The one-line packed-tree summary both branches print. */
  const packedLine = "packed tree: " + (packedStats.packed === "checked" ? packedStats.packedDir + " (" + packedStats.files + " asset files)" : packedStats.packed)
  /** CONTENT counters, or null when the packed half took no reading. */
  const content = packedStats.content
  /** COMPLETENESS counters, or null when the packed half took no reading. */
  const completeness = packedStats.completeness
  /** The stamp the CONTENT half classified against, or null when it took no reading. */
  const stamp = packedStats.stamp
  /** The `; content bytes: …` section, empty when no reading was taken. */
  const contentLine = content === null || content === undefined ? "" : "; content bytes: " + content.compared + " file(s) compared, " + content.identical + " identical, " + content.drift.length + " drift, " + content.expected.length + " expected-after-pack"
  /** The `; completeness: …` section, empty when no reading was taken. */
  const completenessLine = completeness === null || completeness === undefined ? "" : "; completeness: " + completeness.compared + " declared source file(s) compared, " + completeness.present + " present, " + completeness.exempt.length + " declared exemption(s), " + completeness.absent.length + " absent"
  /** The `; pack stamp …` section, empty when no reading was taken. */
  const stampLine = stamp === null || stamp === undefined ? "" : "; pack stamp " + stamp.iso + " (" + stamp.source + ")"
  /** The exercised-exemption section, empty when no exemption fired. */
  const exemptLine = completeness === null || completeness === undefined || completeness.exempt.length === 0 ? "" : "; exemption exercised: " + completeness.exempt.map((e: ExemptEntry): string => e.path).join(", ")
  /** Every EXPECTED reading from both halves, printed in both branches below. */
  const expected = [...(content?.expected ?? []), ...(completeness?.expected ?? [])]
  if (report.findings.length === 0) {
    console.log(PREFIX + " ok: " + s.classA + " dist/index.js row(s) + " + s.classB + " adopted lib/index.ts row(s) + " + s.classC + " mcp row(s) of the bundle patch all resolve; " + s.pluginCount + " PLUGIN_PKGS + " + s.mcpCount + " MCP_PKGS entries all exist; root assets " + s.rootAssets.join("/") + " declared and present; CLI validator surface " + s.shimExports.length + " exports in step; " + packedLine + (packedStats.packed === "checked" ? "; agent references " + packedStats.referenceFiles + "/" + REQUIRED_REFERENCE_FILES.length + "; root files " + packedStats.rootFiles + "/" + REQUIRED_ROOT_FILES.length + "; declared packages " + packedStats.packedPackages.present + "/" + packedStats.packedPackages.declared + " present in the artifact" + contentLine + completenessLine + stampLine + exemptLine : ""))
  } else {
    console.error(PREFIX + " FAIL - " + report.findings.length + " closure violation(s)")
    for (const f of report.findings) {
      /** The `[pkg, …]` clause, empty for a finding that blames no package. */
      const who = f.packages.length ? " [" + f.packages.join(", ") + "]" : ""
      console.error("  " + f.kind + who + " - " + f.detail)
    }
    /** The distinct packages the findings blame, sorted. */
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

/** Print the flag table; the only side-effect-free mode of this gate. */
function printUsage(): void {
  console.log("usage: node scripts/verify-pack-closure.ts [--self-test] [--packer <path>] [--cli <path>] [--packages-dir <dir>] [--patch <path>] [--packed <dir>] [--source-root <dir>] [--pack-stamp <iso>] [--require-packed]")
  console.log("  no flags        check the real tree AND the real dist/mpd-package/ artifact (exit 0 = closed)")
  console.log("  --self-test     run the positive control and the negative controls on TEMP fixtures")
  console.log("  --packed <dir>  check another packed tree (default " + DEFAULT_PACKED + ")")
  console.log("  --source-root <dir>  the tree the assets are copied FROM (default the repo root)")
  console.log("  --require-packed     treat an absent packed tree as a failure instead of a printed skip")
  console.log("  --pack-stamp <iso>  pin the artifact's cut time (default: INFERRED as the newest mtime among the artifact's files); a source file written after it is reported as an EXPECTED, provenance-named reading instead of a CONTENT-DRIFT")
}

/**
 * Parse the command line into resolved options; an unknown flag exits 2 after printing the usage.
 *
 * @param argv Arguments after the script path.
 * @returns Every option at its default or its parsed value.
 */
function parseArgs(argv: string[]): Options {
  /** The parsed options, starting from the defaults. */
  const opts: Options = { selfTest: false, packerPath: DEFAULT_PACKER, cliPath: DEFAULT_CLI, packagesDir: DEFAULT_PACKAGES_DIR, patchPath: DEFAULT_PATCH, packedDir: DEFAULT_PACKED, sourceRoot: repoRoot, requirePacked: false, packStampMs: null }
  for (let i = 0; i < argv.length; i += 1) {
    /** The argument at the current index. */
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
      /** The timestamp as the caller spelled it. */
      const raw = argv[++i] ?? ""
      /** The timestamp in epoch milliseconds. */
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
/**
 * Spawn one child run of this script and decode its output.
 *
 * @param args Arguments handed to the child after the script path.
 * @returns The child's exit code and both decoded streams.
 */
function runChecker(args: string[]): ChildResult {
  /** The child's outcome, with its streams decoded as UTF-8. */
  const r = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  /** The child's standard output. */
  const stdout = String(r.stdout ?? "")
  /** The child's standard error. */
  const stderr = String(r.stderr ?? "")
  return { status: r.status, stdout, stderr, all: stdout + stderr }
}

/** Run the positive control and every negative control, each on a TEMP fixture. */
function selfTest(): number {
  /** Every arm's verdict, printed at the end. */
  const arms: Arm[] = []
  /** Record one arm's outcome from the child run it drove through `runChecker`. */
  const arm = (name: string, child: ChildResult, predicate: (child: ChildResult) => boolean): void => {
    /** Whether the arm's predicate held. */
    const ok = predicate(child)
    /** The child's first non-empty output line, so a failure is readable without re-running. */
    const first = child.all.split(/\r?\n/).find((l: string): boolean => l.trim().length > 0) ?? "(no output)"
    arms.push({ name, ok, exitCode: child.status, firstLine: first })
  }

  // Arm 1 — positive control: the real tree is closed, and the checker runs ALONE.
  arm("positive-control (real tree, exit 0)", runChecker([]), (c: ChildResult): boolean => c.status === 0 && /\[verify-pack-closure\] ok/.test(c.all))

  /** The temp directory every fixture of this run is built under. */
  const scratch = mkdtempSync(join(tmpdir(), "mpd-pack-closure-"))
  try {
    /** The packer's source, from which every mutation fixture below is derived. */
    const original = readFileSync(DEFAULT_PACKER, "utf8")

    // Arm 2 — negative control: replay the historical F-T7-1 defect. Drop the
    // mpd-team-watchdog-plugin entry from a TEMP COPY of the packer source.
    /** The one package entry fixture 1 removes. */
    const removed = "mpd-team-watchdog-plugin"
    /** The packer source split into lines, so exactly one can be dropped. */
    const lines = original.split(/\r?\n/)
    /** The lines left after the entry's own line is dropped. */
    const kept = lines.filter((l: string): boolean => l.trim() !== '"' + removed + '",')
    if (kept.length !== lines.length - 1) {
      arms.push({ name: "negative-control fixture 1 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines.length - kept.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED by the child, never run). */
      const f1 = join(scratch, "packer-omitting-watchdog.mjs")
      writeFileSync(f1, kept.join("\n"))
      arm("negative-control (F-T7-1 omission, exit 1)", runChecker(["--packer", f1]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(removed) && c.all.includes("OMISSION"))
    }

    // Arm 3 — negative control: the inverse drift. Add a phantom allowlist entry.
    /** The packer source split into lines for the phantom-entry fixture. */
    const lines2 = original.split(/\r?\n/)
    /** The line index of the PLUGIN_PKGS literal's opening bracket, or -1. */
    const anchorIdx = lines2.findIndex((l: string): boolean => /const\s+PLUGIN_PKGS\s*(?::[^=]*)?=\s*\[/.test(l))
    if (anchorIdx < 0) {
      arms.push({ name: "negative-control fixture 2 (build)", ok: false, exitCode: null, firstLine: "no `const PLUGIN_PKGS = [` anchor found - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The package name no `packages/` directory backs. */
      const phantom = "mpd-phantom-plugin"
      lines2.splice(anchorIdx + 1, 0, '  "' + phantom + '",')
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f2 = join(scratch, "packer-with-phantom-entry.mjs")
      writeFileSync(f2, lines2.join("\n"))
      arm("negative-control (inverse drift, exit 1)", runChecker(["--packer", f2]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(phantom) && c.all.includes("INVERSE"))
    }

    // Arm 4 — negative control: SEVERAL offenders at once. The report must NAME each
    // offending package, not just print a count.
    /** The two package entries fixture 4 removes. */
    const twoGone = ["mpd-team-watchdog-plugin", "mpd-tui-plugin"]
    /** The packer source split into lines for the two-offender fixture. */
    const lines4 = original.split(/\r?\n/)
    /** The lines left after both entries' own lines are dropped. */
    const kept4 = lines4.filter((l: string): boolean => !twoGone.some((p: string): boolean => l.trim() === '"' + p + '",'))
    if (kept4.length !== lines4.length - 2) {
      arms.push({ name: "negative-control fixture 4 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines4.length - kept4.length) + " line(s), expected exactly 2 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f4 = join(scratch, "packer-omitting-two.mjs")
      writeFileSync(f4, kept4.join("\n"))
      arm("negative-control (two offenders, both named)", runChecker(["--packer", f4]), (c: ChildResult): boolean => c.status === 1 && twoGone.every((p: string): boolean => c.all.includes(p)) && /offending packages: .*mpd-team-watchdog-plugin.*mpd-tui-plugin/.test(c.all))
    }

    // Arm 5 — negative control: a degraded run (empty allowlist) must never pass.
    /** The parsed PLUGIN_PKGS literal, whose span this arm replaces with an empty list. */
    const span = scanArrayLiteral(original, "PLUGIN_PKGS")
    if (span === null) {
      arms.push({ name: "negative-control fixture 3 (build)", ok: false, exitCode: null, firstLine: "could not locate the PLUGIN_PKGS array literal - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f3 = join(scratch, "packer-with-empty-allowlist.mjs")
      writeFileSync(f3, original.slice(0, span.start) + "[]" + original.slice(span.end + 1))
      arm("negative-control (zero-subject degraded run, exit 1)", runChecker(["--packer", f3]), (c: ChildResult): boolean => c.status === 1 && c.all.includes("DEGRADED"))
    }
    // Arm 6 — negative control for the FLIPPED templates/docs arm: a packer whose
    // ROOT_ASSET_DIRS table drops `templates` must fail, naming the asset. (Before this wave
    // the same arm proved the OPPOSITE assertion — that a templates literal was forbidden.)
    /** The packer source split into lines for the templates fixture. */
    const lines6 = original.split(/\r?\n/)
    /** The lines left after the `templates` entry's own line is dropped. */
    const kept6 = lines6.filter((l: string): boolean => l.trim() !== '"templates",')
    if (kept6.length !== lines6.length - 1) {
      arms.push({ name: "negative-control fixture 6 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines6.length - kept6.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f6 = join(scratch, "packer-without-templates.mjs")
      writeFileSync(f6, kept6.join("\n"))
      arm("negative-control (ROOT_ASSET_DIRS drops templates, exit 1)", runChecker(["--packer", f6]), (c: ChildResult): boolean => c.status === 1 && c.all.includes("TEMPLATES") && /does not name `templates`/.test(c.all))
    }

    // Arm 7 — negative control: the compiled-validator contract. Drop one name from the
    // packer's shim list; the checker must name the drift instead of trusting two hand-kept
    // lists to stay equal.
    /** The packer source split into lines for the shim-drift fixture. */
    const lines7 = original.split(/\r?\n/)
    /** The lines left after the `bundleExtensionsDir` entry's own line is dropped. */
    const kept7 = lines7.filter((l: string): boolean => l.trim() !== '"bundleExtensionsDir",')
    if (kept7.length !== lines7.length - 1) {
      arms.push({ name: "negative-control fixture 7 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines7.length - kept7.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f7 = join(scratch, "packer-with-shim-drift.mjs")
      writeFileSync(f7, kept7.join("\n"))
      arm("negative-control (shim list drifts from the CLI, exit 1)", runChecker(["--packer", f7]), (c: ChildResult): boolean => c.status === 1 && c.all.includes("CLI-VALIDATOR") && /bundleExtensionsDir/.test(c.all))
    }

    // ── Arms 8+ — the PACKED half, driven at a fixture artifact ────────────────────────────
    // The rules under test read a packed tree, so the fixtures build a minimal source tree and
    // a minimal packed tree with the SAME shape (the asset dirs come from the real packer's own
    // ROOT_ASSET_DIRS table, so a future asset is covered by these arms automatically).
    /** The packer's declared root asset directories. */
    const assets = readPackageList(original, "ROOT_ASSET_DIRS") ?? []
    /** The packer's declared named root files. */
    const rootFiles = readPackageList(original, "ROOT_FILES") ?? []
    // The declared package set the packed-package arm asserts against — read from the same three
    // sources the production halves read: the packer's two lists and the patch's class-B rows.
    /** The packer's plugin package list. */
    const pluginPkgs = readPackageList(original, "PLUGIN_PKGS") ?? []
    /** The packer's MCP package list. */
    const mcpPkgs = readPackageList(original, "MCP_PKGS") ?? []
    /** The patch's class-B (adopted main code) package names. */
    const adoptedPkgs = [...new Set(patchPackageRefs(readFileSync(DEFAULT_PATCH, "utf8")).filter((r: PatchRef): boolean => classifyRef(r.rel) === "B").map((r: PatchRef): string => r.pkg))]
    /** Every package name the fixture trees must declare. */
    const fixturePkgs = [...new Set([...pluginPkgs, ...mcpPkgs, ...adoptedPkgs])]
    /** The fixture's source tree root. */
    const fxSource = join(scratch, "fixture-repo")
    /** The fixture's packed tree root. */
    const fxPacked = join(scratch, "fixture-packed")
    /** Write one file into a fixture tree, creating its parent directories. */
    const put = (root: string, rel: string, body: string): void => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), body)
    }
    /** The fixture manifest, built from the packer's own asset and root-file tables. */
    const manifestBody = (): string =>
      JSON.stringify(
        {
          name: "@mpd-dsh/mpd",
          version: "0.0.0",
          type: "module",
          exports: { "./packages/*": "./packages/*", ...Object.fromEntries(assets.map((dir: string): [string, string] => ["./" + dir + "/*", "./" + dir + "/*"])) },
          files: [...assets.map((dir: string): string => dir + "/**"), "packages/**", ...rootFiles],
        },
        null,
        2,
      )
    /** Build (or rebuild) the fixture's packed tree from the same tables. */
    const buildPacked = (): void => {
      put(fxPacked, "package.json", manifestBody())
      for (const dir of assets) put(fxPacked, dir + "/.keep", "")
      for (const f of rootFiles) put(fxPacked, f, "# fixture root file\n")
      for (const pkg of fixturePkgs) put(fxPacked, "packages/" + pkg + "/" + (adoptedPkgs.includes(pkg) ? "lib/index.ts" : "dist/index.js"), "export {}\n")
      put(fxPacked, "templates/mpd-extension/mpd-ext.json", "{}\n")
      put(fxPacked, "templates/mpd-extension/README.md", "# fixture template\n")
      put(fxPacked, "docs/guide.md", "# guide\n")
      put(fxPacked, "docs/guide.zh-CN.md", "# 指南\n")
      for (const file of REQUIRED_REFERENCE_FILES) put(fxPacked, "agent-references/" + file, "# fixture reference\n")
      put(fxPacked, "packages/mpd-ext-plugin/dist/validator.js", "export {}\n")
    }
    put(fxSource, "scripts/mpd-ext.ts", readFileSync(DEFAULT_CLI, "utf8"))
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
    for (const pkg of fixturePkgs) put(fxSource, "packages/" + pkg + "/" + (adoptedPkgs.includes(pkg) ? "lib/index.ts" : "dist/index.js"), "export {}\n")
    buildPacked()
    /** The three fixture paths every packed arm below drives the child with. */
    const fixtureArgs = ["--source-root", fxSource, "--packages-dir", join(fxSource, "packages"), "--packed", fxPacked]

    arm("positive-control (fixture packed tree, exit 0)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 0 && /packed tree: .*fixture-packed/.test(c.all))

    /** The zh-CN half of the fixture doc pair this arm removes. */
    const zhGuide = join(fxPacked, "docs", "guide.zh-CN.md")
    /** The removed file's content, restored after the arm. */
    const zhBody = readFileSync(zhGuide, "utf8")
    rmSync(zhGuide)
    arm("negative-control (half doc pair, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("DOC-PAIR") && c.all.includes("guide.zh-CN.md"))
    writeFileSync(zhGuide, zhBody)

    /** The fixture template manifest this arm removes. */
    const tplManifest = join(fxPacked, "templates", "mpd-extension", "mpd-ext.json")
    /** The removed file's content, restored after the arm. */
    const tplBody = readFileSync(tplManifest, "utf8")
    rmSync(tplManifest)
    arm("negative-control (packed scaffold template manifest gone, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("TEMPLATES") && c.all.includes("mpd-ext.json"))
    writeFileSync(tplManifest, tplBody)

    put(fxPacked, "package.json", manifestBody().replace('"packages/**"', '"packages/**",\n          "notes/**"'))
    arm("negative-control (files pattern listed but absent, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("MANIFEST") && /notes\/\*\*/.test(c.all))
    put(fxPacked, "package.json", manifestBody())

    put(fxPacked, "extra/thing.md", "# unlisted\n")
    arm("negative-control (file present but unlisted, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("MANIFEST") && /<packed>\/extra is in the artifact but no `files` pattern covers it/.test(c.all))
    rmSync(join(fxPacked, "extra"), { recursive: true, force: true })

    rmSync(join(fxPacked, "packages", "mpd-ext-plugin", "dist", "validator.js"))
    arm("negative-control (packed validator entry gone, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("CLI-VALIDATOR") && c.all.includes("validator.js"))
    buildPacked()

    // Arm 8 — negative control for the reference group: a packer whose ROOT_ASSET_DIRS table
    // drops `agent-references` must fail, naming the group (captain's t16 addition to this lane).
    /** The packer source split into lines for the agent-references fixture. */
    const lines8 = original.split(/\r?\n/)
    /** The lines left after the `agent-references` entry's own line is dropped. */
    const kept8 = lines8.filter((l: string): boolean => l.trim() !== '"agent-references",')
    if (kept8.length !== lines8.length - 1) {
      arms.push({ name: "negative-control fixture 8 (build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (lines8.length - kept8.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const f8 = join(scratch, "packer-without-agent-references.mjs")
      writeFileSync(f8, kept8.join("\n"))
      arm("negative-control (ROOT_ASSET_DIRS drops agent-references, exit 1)", runChecker(["--packer", f8]), (c: ChildResult): boolean => c.status === 1 && c.all.includes("REFERENCES") && /does not name `agent-references`/.test(c.all))
    }

    // Arm 9 — packed-tree negative control: one NAMED reference file missing from the artifact.
    /** The named reference file this arm removes from the artifact. */
    const refFile = join(fxPacked, "agent-references", "troubleshooting.md")
    /** The removed file's content, restored after the arm. */
    const refBody = readFileSync(refFile, "utf8")
    rmSync(refFile)
    arm("negative-control (packed reference file gone, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("REFERENCES") && c.all.includes("troubleshooting.md"))
    writeFileSync(refFile, refBody)

    // Arm 10 — source-side negative control: the named reference file absent from the tree the
    // packer copies FROM (the same discrimination, one stage earlier).
    /** The named reference file this arm removes from the source tree. */
    const srcRef = join(fxSource, "agent-references", "index.md")
    /** The removed file's content, restored after the arm. */
    const srcRefBody = readFileSync(srcRef, "utf8")
    rmSync(srcRef)
    arm("negative-control (reference file absent from the source tree, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("REFERENCES") && c.all.includes("index.md"))
    writeFileSync(srcRef, srcRefBody)

    arm("negative-control (--require-packed with no tree, exit 1)", runChecker(["--source-root", fxSource, "--packed", join(scratch, "no-such-pack"), "--require-packed"]), (c: ChildResult): boolean => c.status === 1 && c.all.includes("PACKED-MISSING"))

    // Arms 11-14 — the named ROOT FILES (T-70). Four shapes, because the manifest arm is
    // declaration-driven: it can see a file present but unlisted and a pattern listed but absent,
    // but a file declared NOWHERE is invisible to it, so only a source-side expectation (here) and
    // the packer-table comparison can make an ADDITION-omission go red rather than a later removal.
    /** The named root file inside the fixture artifact. */
    const rootFile = join(fxPacked, REQUIRED_ROOT_FILES[0])
    /** The removed file's content, restored after the arm. */
    const rootBody = readFileSync(rootFile, "utf8")
    rmSync(rootFile)
    arm("negative-control (packed root file gone, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(rootFile, rootBody)

    put(fxPacked, REQUIRED_ROOT_FILES[0], "# fixture root file\nDRIFTED\n")
    arm("negative-control (packed root file differs from its source, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes("differs byte-wise"))
    writeFileSync(rootFile, rootBody)

    /** The named root file inside the fixture source tree. */
    const srcRootFile = join(fxSource, REQUIRED_ROOT_FILES[0])
    /** The removed file's content, restored after the arm. */
    const srcRootBody = readFileSync(srcRootFile, "utf8")
    rmSync(srcRootFile)
    arm("negative-control (root file absent from the source tree, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(srcRootFile, srcRootBody)

    /** The packer source split into lines for the ROOT_FILES fixture. */
    const linesRoot = original.split(/\r?\n/)
    /** The lines left after the named root file's entry line is dropped. */
    const keptRoot = linesRoot.filter((l: string): boolean => l.trim() !== '"' + REQUIRED_ROOT_FILES[0] + '",')
    if (keptRoot.length !== linesRoot.length - 1) {
      arms.push({ name: "negative-control fixture (ROOT_FILES build)", ok: false, exitCode: null, firstLine: "fixture build removed " + (linesRoot.length - keptRoot.length) + " line(s), expected exactly 1 - refusing to trust a fixture that silently did not apply" })
    } else {
      /** The mutated packer copy this arm points `--packer` at (PARSED, never run). */
      const fRoot = join(scratch, "packer-without-root-file.mjs")
      writeFileSync(fRoot, keptRoot.join("\n"))
      arm("negative-control (packer ROOT_FILES drops the file, exit 1)", runChecker(["--packer", fRoot]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(ROOT_FILE_KIND) && /does not name/.test(c.all))
    }

    // Arm 15 — the DECLARED PACKAGE arm (T-70 finding 2), seeded exactly like the control that
    // exposed the hole: a declared PLUGIN_PKG whose directory arrives nowhere must go RED. Before
    // this arm the same shape exited 0 while the verdict line still asserted that every declared
    // package "all exists" — a SOURCE-rooted sentence printed over a pack missing one of them.
    /** The first declared plugin package, whose artifact directory this arm removes. */
    const pkgToDrop = pluginPkgs[0]
    /** That package's artifact directory, or null when the fixture has none. */
    const pkgDir = pkgToDrop === undefined ? null : join(fxPacked, "packages", pkgToDrop)
    if (pkgDir === null || !existsSync(pkgDir)) {
      arms.push({ name: "negative-control fixture (declared package build)", ok: false, exitCode: null, firstLine: "fixture has no packed directory for PLUGIN_PKGS[0] (" + String(pkgToDrop) + ") - refusing to trust a fixture that silently did not apply" })
    } else {
      rmSync(pkgDir, { recursive: true, force: true })
      arm("negative-control (declared package dir absent from the artifact, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes("PACKED-MISSING") && c.all.includes(pkgToDrop))
      buildPacked()
    }

    // Arm 15b (T-63, the captain's PACKER ROUTE ruling) — the arms build a REAL scratch pack through the
    // packer's own `--out`, instead of rewriting the packer's constants: a fresh pack must be GREEN (every
    // byte it ships equals the source it copied — the "byte-identical re-pack stays green" half of T-63),
    // a ONE-BYTE change inside that pack must redden at unchanged presence, and the canonical artifact must
    // not move across either run (the one-writer-at-a-time control).
    /** The scratch pack this arm stages through the packer's own `--out`. */
    const scratchPack = join(scratch, "scratch-pack")
    /** Read a tree's file count and newest mtime, to prove a run never touched it. */
    const canonicalStamp = (dir: string): { files: number; newest: number } => {
      /** The newest mtime seen, in epoch milliseconds; 0 until a file has been read. */
      let newest = 0
      /** The tree's files, as `/`-separated relative paths. */
      const files = treeFiles(dir)
      for (const rel of files) {
        /** The file's own mtime in epoch milliseconds. */
        const mtime = statSync(join(dir, rel)).mtimeMs
        if (mtime > newest) newest = mtime
      }
      return { files: files.length, newest }
    }
    /** The canonical artifact's shape BEFORE the scratch pack. */
    const canonicalBefore = canonicalStamp(DEFAULT_PACKED)
    /** The packer run that stages the scratch artifact. */
    const packRun = spawnSync(process.execPath, [DEFAULT_PACKER, "--out", scratchPack], { encoding: "utf8" })
    if (packRun.status !== 0) {
      arms.push({ name: "scratch pack via --out (fixture build)", ok: false, exitCode: packRun.status, firstLine: "the packer refused --out: " + String(packRun.stderr ?? "").trim().split("\n").slice(-2).join(" | ") })
    } else {
      arm("positive-control (real scratch pack staged with --out, exit 0)", runChecker(["--packed", scratchPack, "--require-packed"]), (c: ChildResult): boolean => c.status === 0 && /ok:/.test(c.all))
      /** The shipped reference file this arm mutates by one byte. */
      const scratchRef = join(scratchPack, "agent-references", "troubleshooting.md")
      /** The reference file's mtime, restored so the scratch pack's inferred stamp does not move. */
      const scratchMtime = statSync(scratchRef).mtime
      /** The reference file's bytes, with one byte flipped below. */
      const scratchMutated = Buffer.from(readFileSync(scratchRef))
      scratchMutated[0] = scratchMutated[0] === 0x23 ? 0x20 : 0x23
      writeFileSync(scratchRef, scratchMutated)
      utimesSync(scratchRef, scratchMtime, scratchMtime)
      arm("negative-control (one byte changed in a real scratch pack, exit 1)", runChecker(["--packed", scratchPack, "--require-packed"]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md"))
    }
    /** The canonical artifact's shape AFTER the scratch pack. */
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
    /** The shipped reference file this arm mutates at unchanged presence. */
    const driftFile = join(fxPacked, "agent-references", "troubleshooting.md")
    /** The file's original content, restored after the arm. */
    const driftBody = readFileSync(driftFile, "utf8")
    writeFileSync(driftFile, driftBody.replace("# fixture", "# seeded"))
    arm("negative-control (artifact byte drift at unchanged presence, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md") && !/REFERENCES/.test(c.all))
    writeFileSync(driftFile, driftBody)

    // Arm 17 (the captain's expected-drift ruling) — the same divergence caused by a writer that
    // landed AFTER the pack: the artifact is untouched and the SOURCE file is strictly newer. It must
    // be REPORTED as a provenance-named expected reading and must NOT redden the gate. The packed tree
    // is backdated first so "after the pack" is a fact of the fixture, not of millisecond timing.
    /** The source reference file a post-pack writer rewrites in this arm. */
    const postPackFile = join(fxSource, "agent-references", "index.md")
    /** The source file's original content, restored after the arm. */
    const postPackBody = readFileSync(postPackFile, "utf8")
    /** Every artifact file with the mtime it must be restored to after the backdate. */
    const packedMtimes = treeFiles(fxPacked).map((rel: string): [string, Date] => [join(fxPacked, rel), statSync(join(fxPacked, rel)).mtime])
    /** The stamp every artifact file is backdated to, one hour before the writer lands. */
    const backdate = new Date(Date.now() - 3_600_000)
    for (const [abs] of packedMtimes) utimesSync(abs, backdate, backdate)
    writeFileSync(postPackFile, postPackBody + "<!-- post-pack writer: self-test arm 17 -->\n")
    arm("negative-control (post-pack source writer -> reported, exit 0)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 0 && c.all.includes(EXPECTED_KIND) && c.all.includes("agent-references/index.md"))
    // Arm 17b — the SAME divergence with the stamp pinned AHEAD of the writer: the expected class must
    // flip to a hard CONTENT-DRIFT, which is what proves the classification reads the stamped time and
    // not merely "the source is newer than the copy" (a distinction `cpSync` would otherwise erase).
    /** A stamp one hour ahead of the writer, which must flip the class to a hard drift. */
    const future = new Date(Date.now() + 3_600_000).toISOString()
    arm("negative-control (same drift, stamp pinned ahead of the writer, exit 1)", runChecker([...fixtureArgs, "--pack-stamp", future]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/index.md"))
    writeFileSync(postPackFile, postPackBody)
    for (const [abs, mtime] of packedMtimes) utimesSync(abs, mtime, mtime)

    // Arm 17c (t9-R1 repair) — the ROOT-FILES byte rule must join the SAME classification: with the
    // fixture packed tree backdated and the fixture's SOURCE root file written afterwards, the drift is
    // the provenance-named EXPECTED class (exit 0, writer named), never a bare ROOT-FILE red. The hard
    // shape is untouched and still asserted above (a packed-side change with an older source).
    /** Every artifact file with the mtime it must be restored to after this backdate. */
    const packedMtimesRoot = treeFiles(fxPacked).map((rel: string): [string, Date] => [join(fxPacked, rel), statSync(join(fxPacked, rel)).mtime])
    for (const [abs] of packedMtimesRoot) utimesSync(abs, backdate, backdate)
    /** The fixture's source root file, rewritten by a post-pack writer. */
    const fxRootFile = join(fxSource, REQUIRED_ROOT_FILES[0])
    /** The source file's original content, restored after the arm. */
    const fxRootBody = readFileSync(fxRootFile, "utf8")
    writeFileSync(fxRootFile, fxRootBody + "<!-- post-pack writer: self-test arm 17c -->\n")
    arm("negative-control (post-pack writer of a ROOT FILE -> expected, exit 0)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 0 && c.all.includes(EXPECTED_KIND) && c.all.includes(REQUIRED_ROOT_FILES[0]))
    writeFileSync(fxRootFile, fxRootBody)
    for (const [abs, mtime] of packedMtimesRoot) utimesSync(abs, mtime, mtime)

    // Arm 18 (T-65, narrow) — a package whose `dist/` file sits in the SOURCE with no artifact
    // counterpart must be REPORTED by name: the exemption is ONE entry, never a class of pardons. Its
    // mtime is set BEFORE the pack because that is the realistic shape (the package predates the pack);
    // a file written after the pack is the expected class above, not an absence.
    put(fxSource, "packages/ghost-plugin/dist/index.js", "export {}\n")
    /** The source-only built file whose absence the arm asserts. */
    const ghost = join(fxSource, "packages", "ghost-plugin", "dist", "index.js")
    utimesSync(ghost, backdate, backdate)
    arm("negative-control (source dist with no artifact counterpart, exit 1)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 1 && c.all.includes(COMPLETENESS_KIND) && c.all.includes("packages/ghost-plugin/dist/index.js"))
    rmSync(join(fxSource, "packages", "ghost-plugin"), { recursive: true, force: true })

    // Arm 19 (T-65, the exemption) — the SAME shape for the one declared exempt package must stay
    // green AND the verdict line must name it, so an exemption can never become a silent skip.
    put(fxSource, "packages/mpd-qa-roles-probe/dist/index.js", "export {}\n")
    arm("negative-control (the one declared exemption is exercised, not a silent skip)", runChecker(fixtureArgs), (c: ChildResult): boolean => c.status === 0 && c.all.includes("exemption exercised: packages/mpd-qa-roles-probe/dist/index.js"))
    rmSync(join(fxSource, "packages", "mpd-qa-roles-probe"), { recursive: true, force: true })

    // Arm 20 (T-63 on the REAL artifact, the seeded mutation the evidence files) — a byte-copy of the
    // canonical artifact is green; flipping ONE byte of one shipped file reddens at unchanged presence.
    // The copy is only ever READ from: the canonical `dist/mpd-package` is never written here.
    /** The byte-copy of the canonical artifact this arm mutates. */
    const realCopy = join(scratch, "real-artifact-copy")
    // preserveTimestamps: the copy must carry the REAL artifact's stamp, otherwise `cpSync`'s fresh
    // mtimes would re-date the pack to "now" and every post-pack writer would read as a hard drift —
    // measured: the first version of this arm reddened on exactly that artefact of the copy.
    cpSync(DEFAULT_PACKED, realCopy, { recursive: true, preserveTimestamps: true })
    arm("positive-control (byte-copy of the real artifact, exit 0)", runChecker(["--packed", realCopy, "--require-packed"]), (c: ChildResult): boolean => c.status === 0)
    /** The shipped reference file this arm mutates inside the copy. */
    const realRef = join(realCopy, "agent-references", "troubleshooting.md")
    /** The reference file's mtime, restored so the copy keeps the artifact's inferred stamp. */
    const realRefMtime = statSync(realRef).mtime
    /** The reference file's bytes, with one byte flipped below. */
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
    // THE PREDICATE ACCEPTS EITHER LEGAL CLASS, because the class is a fact of the ENVIRONMENT, not of
    // the gate. MEASURED 2026-10-07 (de-vendor wave): with the canonical artifact freshly staged by
    // `node scripts/pack-mpd.ts` — which the wave's own acceptance list requires — every source file is
    // strictly OLDER than the pack, so the flipped byte CANNOT be attributed to a post-pack writer and
    // the byte rule correctly reports the hard `CONTENT-DRIFT` leg; the arm then reddened on a green
    // gate. `touch agent-references/troubleshooting.md` flipped it straight back to PASS with the
    // expected leg, which is the proof that the arm was measuring the artifact's age, not the rule.
    // What the arm actually claims is "reported, not silent", so it now asserts THAT: the file is NAMED
    // in the output AND the exit code matches whichever class the byte rule chose. A silent pass
    // (exit 0, neither kind) still fails the arm.
    arm("negative-control (real artifact copy, one byte changed -> reported, not silent)", runChecker(["--packed", realCopy, "--require-packed"]), (c: ChildResult): boolean => {
      /** Whether the byte rule named the mutated file, whichever class it landed in. */
      const named = c.all.includes("agent-references/troubleshooting.md")
      return named && ((c.all.includes(EXPECTED_KIND) && c.status === 0) || (c.all.includes(CONTENT_KIND) && c.status === 1))
    })
    // Arm 20c — the same mutated copy with the stamp PINNED at the source file's own mtime: now the
    // writer cannot be "after the pack", so the mutated byte is a hard CONTENT-DRIFT and the gate
    // reddens. This is the falsifiable pair for "a content mutation reddens": 20a green, 20c red.
    // PRECISION TRAP (measured 2026-09-17, wave 2b): `statSync().mtime` is a Date — millisecond
    // precision — while the gate compares `statSync().mtimeMs`, which carries sub-millisecond digits.
    // A source file whose mtime is `X.400086 ms` reads as NEWER than a pin built from `X.400`, so the
    // intended HARD verdict silently became the EXPECTED class and this arm flapped with the file's
    // mtime. The pin is therefore built from the FLOAT mtime, one millisecond above its floor, so the
    // file's own mtime is strictly older than the pin and the arm cannot flap.
    /** The real source reference file's float mtime, the pin is built above its floor. */
    const sourceRefMtimeMs = statSync(join(repoRoot, "agent-references", "troubleshooting.md")).mtimeMs
    /** The pinned stamp that puts the writer BEFORE the pack, forcing the hard CONTENT-DRIFT. */
    const pinnedStamp = new Date(Math.floor(sourceRefMtimeMs) + 1).toISOString()
    arm("negative-control (same mutation, stamp pinned -> hard CONTENT-DRIFT, exit 1)", runChecker(["--packed", realCopy, "--require-packed", "--pack-stamp", pinnedStamp]), (c: ChildResult): boolean => c.status === 1 && c.all.includes(CONTENT_KIND) && c.all.includes("agent-references/troubleshooting.md"))

  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " (exit " + a.exitCode + ") :: " + a.firstLine)
  /** The arms whose predicate did not hold. */
  const failed = arms.filter((a: Arm): boolean => !a.ok)
  console.log(PREFIX + " self-test " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed.length) + "/" + arms.length + " arms")
  return failed.length === 0 ? 0 : 1
}

/** The options this run was asked for. */
const opts = parseArgs(process.argv.slice(2))
if (opts.selfTest) process.exit(selfTest())
/** The check's result, whose findings decide the exit code. */
const report = runCheck(opts)
printReport(report, opts)
process.exit(report.findings.length === 0 ? 0 : 1)
