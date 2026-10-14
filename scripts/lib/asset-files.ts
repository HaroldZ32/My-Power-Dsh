// The ONE rule that decides which files a fingerprinted asset contains, shared by the two sides of
// the corpus fingerprint: scripts/verify-vendor.ts (the gate) and scripts/repin-vendor.ts (the
// re-pin). Both import THIS module, and the re-pin's mirror guard re-reads both sources on every run
// and refuses when either side stops calling the rule below, so the two can no longer drift apart.
//
// WHY IT IS SHARED (2026-10-09). The two sides used to carry a private copy of the same recursive
// `readdirSync` walk, so the fingerprint was computed over the WORKING TREE. `skills/frontend/
// .gitignore` ignores `references/design/*.md`, and a developer machine holding two such files
// fingerprinted 373 files while CI - which checks out only tracked files - counted 371. The gate
// therefore passed locally and could never pass in CI, and the re-pin baked the local value into the
// lock. A fingerprint of a shipped corpus must be computed over what the REPOSITORY SHIPS:
//
//   * inside a git work tree the file list is `git ls-files` - the index, which a clean checkout
//     equals HEAD - so a gitignored file sitting beside the corpus cannot move the lock;
//   * outside one (a packed copy, a tarball, an export, or no git binary at all) the filesystem walk
//     below is the fallback, so a non-git context fingerprints rather than reporting an EMPTY asset;
//   * a TRACKED file that is missing from the tree, and a tracked file whose bytes were edited, are
//     both still reported as failures by the gate - the rule narrows WHICH files are the asset, it
//     never weakens the check on their bytes.
//
// The walk is deliberately NOT deleted: it is the fallback an unpacked copy needs, and the skip set
// it carries (node_modules / __pycache__ / *.pyc / *.pyo) is corpus policy that applies on both
// paths, so the index path filters its tracked list through the SAME predicate.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** Directory names that are BUILD state rather than corpus content, on either enumeration path. */
const SKIPPED_DIR_NAMES: readonly string[] = ["node_modules", "__pycache__"]

/** File suffixes that are bytecode caches rather than corpus content, on either enumeration path. */
const SKIPPED_FILE_SUFFIXES: readonly string[] = [".pyc", ".pyo"]

/** Byte budget for one `git ls-files` answer; a whole corpus of paths fits far inside it. */
const GIT_OUTPUT_LIMIT_BYTES: number = 64 * 1024 * 1024

/** One asset's shipped-file enumeration: the files, the gaps, and where the list came from. */
export interface AssetEnumeration {
  /** Absolute paths of the asset's shipped files that ARE in the tree, in enumeration order. */
  files: string[]
  /** Absolute tracked paths the tree no longer has; always empty off the index path. */
  missing: string[]
  /** How many files the asset SHIPS (`files` plus `missing`) - the count the lock pins. */
  fileCount: number
  /** Which path produced the list: the git index, the filesystem walk, or a single-file asset. */
  source: "index" | "walk" | "file"
  /** One clause naming HOW the list was produced, so a run can report its own basis. */
  detail: string
}

/**
 * Read one asset file as bytes, normalizing text (no NUL byte) to LF and leaving binary raw.
 *
 * The repository's `.gitattributes` declares `eol=lf` for text files, so a tree hash must be
 * computed on normalized bytes - otherwise a CRLF working copy drifts the lock while git still
 * reports a clean tree.
 *
 * @param p - Absolute path of the file to read.
 * @returns The file's bytes: LF-normalized when it is text, raw when it is binary.
 */
export function readAssetBytes(p: string): Buffer {
  /** The file's raw bytes, read once for both the NUL test and the hash. */
  const buf: Buffer = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

/**
 * Whether one asset-relative path is BUILD state rather than corpus content.
 *
 * The predicate takes a whole relative path so the git index and the filesystem walk cannot
 * disagree: any path SEGMENT named `node_modules`/`__pycache__` is skipped, as is any path whose
 * basename ends `.pyc`/`.pyo`. The measured reason it exists at all: `python3 -m py_compile`, a
 * documented verify command for the ast-grep helper, writes `skills/ast-grep/scripts/
 * __pycache__/*.pyc`, which used to drift the corpus count 297 -> 298 and redden the gate on a
 * legitimately unchanged corpus.
 *
 * @param rel - A path relative to the asset root, `/`-spelled (a bare entry name is one segment).
 * @returns True when the path must not take part in the fingerprint.
 */
function isSkippedRelativePath(rel: string): boolean {
  /** The path's segments; the last one is the basename the suffix test reads. */
  const segments: string[] = rel.split("/")
  /** The basename, i.e. the only segment a suffix can belong to. */
  const base: string = segments[segments.length - 1] ?? ""
  return segments.some((s: string): boolean => SKIPPED_DIR_NAMES.includes(s))
    || SKIPPED_FILE_SUFFIXES.some((suffix: string): boolean => base.endsWith(suffix))
}

/**
 * The TRACKED files under one directory, spelled relative to it, or `null` when git cannot answer.
 *
 * `null` is the only fallback signal, and it covers every non-git context: the directory is not
 * inside a work tree (a packed copy, a tarball, an export), git is absent, or git fails for any
 * other reason. `git ls-files` reads the INDEX, so the answer is exactly what a clean checkout
 * holds. `-z` is not optional: without it git QUOTES a path carrying a space or a non-ASCII byte,
 * and the quoted spelling would name a file that does not exist.
 *
 * @param dir - Absolute path of the asset directory to enumerate.
 * @returns The tracked paths relative to `dir`, or `null` when the walk fallback must be used.
 */
function listTrackedFiles(dir: string): string[] | null {
  /** Whether this directory is part of a work tree; a non-zero status means git cannot say. */
  const probe = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })
  if (probe.status !== 0 || (probe.stdout ?? "").trim() !== "true") return null
  /** The tracked paths under `dir`, relative to it and NUL-separated. */
  const listed = spawnSync("git", ["-C", dir, "ls-files", "-z", "--", "."], { encoding: "utf8", maxBuffer: GIT_OUTPUT_LIMIT_BYTES })
  if (listed.status !== 0) return null
  return (listed.stdout ?? "").split("\0").filter((p: string): boolean => p.length > 0)
}

/**
 * The filesystem walk: the fallback for an asset that is not inside a git work tree.
 *
 * It sees whatever bytes the tree holds, which is the only reading an unpacked copy can offer. A
 * directory named like a cache is skipped BEFORE it is stat'd, so the skip cannot follow a link.
 *
 * @param dir - Absolute path of the asset directory to walk.
 * @returns The absolute paths of every file under `dir` that is corpus content, in walk order.
 */
function walkAssetDir(dir: string): string[] {
  /** The collected absolute paths, in walk order. */
  const out: string[] = []
  /** Recursive walker over one directory of the asset. */
  const walk = (d: string): void => {
    // Entry name of the current directory's child.
    for (const entry of readdirSync(d)) {
      /** Absolute path of that child. */
      const p: string = join(d, entry)
      if (isSkippedRelativePath(entry)) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

/**
 * Enumerate one asset's SHIPPED files: the single rule both sides of the fingerprint obey.
 *
 * A single-file asset is its own list. A directory inside a git work tree is its tracked files; a
 * directory outside one is walked. An index that reports no tracked file under the path (an
 * untracked or fully ignored directory) also falls back to the walk, so the result can never be a
 * silently empty asset.
 *
 * @param assetPath - Absolute path of the asset: a directory, or a single-file asset.
 * @returns The shipped files present, the tracked ones missing, the shipped count, and the basis.
 *   The caller must establish that `assetPath` exists first: a missing asset is the caller's own
 *   loud failure, never an empty enumeration reported from here.
 */
export function listAssetFiles(assetPath: string): AssetEnumeration {
  if (statSync(assetPath).isFile()) {
    return { files: [assetPath], missing: [], fileCount: 1, source: "file", detail: "single file" }
  }
  /** What git reports as tracked here, or `null` when there is no work tree to ask. */
  const tracked: string[] | null = listTrackedFiles(assetPath)
  if (tracked !== null && tracked.length > 0) {
    /** The tracked paths that are corpus content rather than build state. */
    const shipped: string[] = tracked.filter((rel: string): boolean => !isSkippedRelativePath(rel))
    /** The shipped files this tree actually has, as absolute paths. */
    const present: string[] = []
    /** The shipped files the index knows and this tree lacks - a defect the caller must report. */
    const missing: string[] = []
    for (const rel of shipped) {
      /** Absolute path of that tracked file inside the asset. */
      const p: string = join(assetPath, rel)
      if (existsSync(p)) present.push(p)
      else missing.push(p)
    }
    return { files: present, missing, fileCount: shipped.length, source: "index", detail: "git index" }
  }
  /** The walked files: all a non-git context can offer. */
  const walked: string[] = walkAssetDir(assetPath)
  return {
    files: walked,
    missing: [],
    fileCount: walked.length,
    source: "walk",
    detail: tracked === null ? "filesystem walk - not inside a git work tree" : "filesystem walk - git tracks no file under this path",
  }
}
