#!/usr/bin/env node
// Verify the vendored-asset fingerprints this repository SHIPS: every non-`_` asset entry in
// VENDOR_LOCK.json is checked by required file count plus its sha256 (single-file asset) or its
// treeSha (directory asset). Every mismatch is a BLOCKER, and a run with no asset subject at all is
// refused rather than reported green.
//
// WHAT THIS GATE NO LONGER IS (de-vendored 2026-10-07, wave `de-vendor-and-verify-law`): it checks
// NO upstream identity. The `code-yeongyu/oh-my-openagent` baseline's commit, version and statistics
// used to be blockers here, read out of a pinned checkout resolved from `MPD_UPSTREAM_ROOT` or
// `.mpd-dsh/upstream`. The composition no longer reads that checkout at all, so the baseline is now a
// HISTORICAL REFERENCE kept for attribution, never a checked subject. There is deliberately no
// resolution path, no identity section and no fallback: this gate reads VENDOR_LOCK.json and the
// working tree and nothing else, and it PRINTS that named fact on every run instead of skipping
// silently. A caller asking for the retired behaviour (`--require-upstream` and any other
// upstream-shaped flag) is REFUSED by name, because accepting and ignoring it would report a pass for
// a check that no longer exists.
//
// The remaining subject is the asset half: the bytes THIS repository ships (the served skill corpus,
// the in-repo MCP source snapshot, the committed MCP dists).
//
// WHAT A FINGERPRINT COVERS (2026-10-09): an asset's fingerprint is computed over the files the
// REPOSITORY SHIPS, never over whatever a working tree happens to hold. The rule lives in ONE module,
// scripts/lib/asset-files.ts, imported by this gate AND by scripts/repin-vendor.ts - so a re-pin
// cannot produce a lock this gate rejects. Inside a git work tree the file list is `git ls-files`
// (the index, which a clean checkout equals HEAD), which is what stops the measured defect this
// repairs: `skills/frontend/.gitignore` ignores `references/design/*.md`, so a developer machine
// holding two such files counted 373 files and CI counted 371, and the re-pin recorded a treeSha a
// clean checkout cannot reproduce. Outside a work tree the shared module falls back to the
// filesystem walk - a packed copy still fingerprints, and a run says which basis it used. The rule
// narrows WHICH files are the asset and never weakens the byte check: a tracked file that was EDITED
// still fails its fingerprint, and a tracked file MISSING from the tree fails by name.
//
// `--self-test` is the SHIPPED FALSIFIER for that half: an intact fixture must PASS, a one-byte edit
// and an added file must each FAIL naming the asset, and an empty asset table must be REFUSED rather
// than silently pass. Every arm works on a COPY of this script against a COPY of the lock inside a
// temp root, so the shipped VENDOR_LOCK.json is never read or written.
//
// The tree FOLD below is MIRRORED by scripts/repin-vendor.ts, which re-reads this file on every run
// and refuses to work when one of its decisive tokens has moved; the FILE LIST is not mirrored any
// more — both sides call the one shared rule (scripts/lib/asset-files.ts). Edit the two together.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { listAssetFiles, readAssetBytes, type AssetEnumeration } from "./lib/asset-files.ts"
import { readJson, repoRootFrom } from "./lib/repo.ts"

/** One vendored asset's fingerprint declaration. */
interface VendorAssetMeta {
  /** Required file count inside the asset; a mismatch is a blocker. */
  fileCount: number
  /** Fingerprint of a single-FILE asset; mutually exclusive with `treeSha`. */
  sha256?: string
  /** Fingerprint of a directory asset: sorted relpath + per-file sha256 fold. */
  treeSha?: string
  /** Where the asset came from (provenance note, not verified). */
  source?: string
}

/** The parsed `VENDOR_LOCK.json`: the asset fingerprint table plus its `_`-prefixed commentary keys. */
interface VendorLock {
  /** Asset relpath → fingerprint, plus the `_`-prefixed string commentary keys. */
  assets: Record<string, VendorAssetMeta | string>
}

/** One self-test arm's outcome: its name, whether it held, and the one-line proof or failure. */
interface SelfTestArm {
  /** Stable arm name, echoed on the arm's own census line. */
  readonly name: string
  /** Whether every assertion of the arm held. */
  readonly ok: boolean
  /** The arm's one-line proof, or the failure message that made it red. */
  readonly note: string
}

/** One spawned fixture run: the child's exit status plus both captured streams. */
interface FixtureRun {
  /** The child's exit status, or `null` when a signal killed it. */
  readonly code: number | null
  /** Captured stdout, which carries the PASS line on a green arm. */
  readonly out: string
  /** Captured stderr, which carries the FAIL line an arm asserts against. */
  readonly err: string
}

/** The repository root, derived from this gate's own URL (`<root>/scripts/verify-vendor.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)
/** This gate's own absolute path: the fixture copies the self-test spawns are made from it. */
const SELF_PATH: string = fileURLToPath(import.meta.url)
/** The usage text, which also names the refusal this gate performs. */
const USAGE: string = [
  "usage: node scripts/verify-vendor.ts [--help] [--self-test]",
  "  (no flag)           fingerprint every asset VENDOR_LOCK.json declares; a mismatch is a blocker",
  "  --self-test         run every fixture arm in a temp root; never reads or writes the shipped lock",
  "  --help              print this text and exit 0",
  "  --require-upstream  REFUSED: this gate has no upstream subject any more (see the header)",
].join("\n")

/** Whether this run is the fixture self-test rather than the real fingerprint sweep. */
let selfTestRequested: boolean = false

// The argv contract is part of the acceptance, not a nicety: the retired flag must FAIL LOUDLY and
// explain itself, so nobody can read a green exit code as "the upstream baseline was verified".
for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE)
    process.exit(0)
  }
  if (arg === "--self-test") {
    selfTestRequested = true
    continue
  }
  if (/upstream/i.test(arg)) {
    console.error("[verify-vendor] REFUSED - " + arg + ": this gate has NO upstream subject any more.")
    console.error("[verify-vendor] the oh-my-openagent checkout is retired from the composition (de-vendored 2026-10-07):")
    console.error("[verify-vendor]   * no MPD_UPSTREAM_ROOT is read, no .mpd-dsh/upstream is looked for, no fallback exists;")
    console.error("[verify-vendor]   * the upstream commit/version/statistics checks were DELETED, not skipped - nothing is left to require;")
    console.error("[verify-vendor]   * upstream attribution lives in LICENSE-NOTICES.md, README.md and README.zh-CN.md, where no gate owns it.")
    console.error("[verify-vendor] re-run without the flag to fingerprint the assets this repository ships, or revert the de-vendoring commit.")
    process.exit(1)
  }
  console.error("[verify-vendor] FAIL - unknown argument: " + arg)
  console.error(USAGE)
  process.exit(1)
}

// A self-test run exits HERE, before the shipped lock is read: the arms work on their own fixture.
// `selfTest` and the fingerprint helpers it uses are function declarations, so hoisting makes this
// call site independent of where they are written.
if (selfTestRequested) process.exit(selfTest())

// The named fact, printed on EVERY run: a green exit code here never means "the upstream was checked".
console.log("[verify-vendor] upstream identity: NOT CHECKED - no upstream subject exists (the pinned oh-my-openagent checkout is retired; see VENDOR_LOCK.json `_note`)")

/** The parsed lock document every comparison below reads. */
const lock: VendorLock = readJson<VendorLock>(join(repoRoot, "VENDOR_LOCK.json"))

/** Whether any blocker has failed so far; the process exit code is derived from it at the end. */
let failed: boolean = false
/** Record a blocking failure and keep going, so one run reports every violation. */
function fail(msg: string): void { console.error("[verify-vendor] FAIL -", msg); failed = true }

// The vendored-asset half: the ONE subject this gate still has. Everything below is the fingerprint
// algorithm scripts/repin-vendor.ts mirrors.

// Read one asset file as bytes, normalizing text (no NUL) to LF, and enumerate one asset's files:
// BOTH now come from the ONE shared rule in scripts/lib/asset-files.ts (`readAssetBytes` and
// `listAssetFiles`), imported at the top of this file. The private copies that used to live here
// walked the WORKING TREE, which is the defect the shared rule repairs; scripts/repin-vendor.ts
// imports the same module, so one rule governs the gate and the re-pin instead of two copies of one.

/**
 * Fingerprint one directory exactly as the real run does, so a fixture lock can be written with the
 * value the fixture gate will recompute.
 *
 * The arms stay FALSIFIABLE even though they share this fold: each one mutates the fixture's BYTES or
 * its file COUNT and then asserts the gate's reaction — never the hash itself.
 *
 * @param dir - The fixture asset directory to fold.
 * @returns The file count and the treeSha fold over the fixture's sorted relpaths.
 */
function fixtureTree(dir: string): { fileCount: number; treeSha: string } {
  /** Every file the fixture directory ships, by the same enumeration the real run uses. */
  const enumerated = listAssetFiles(dir)
  /** The fixture's relpaths, POSIX-spelled and sorted — the same fold input the real run uses. */
  const rels: string[] = enumerated.files.map((f: string): string => f.slice(dir.length + 1).split(sep).join("/")).sort()
  /** The running fold hash over (relpath, per-file sha256) pairs. */
  const h = createHash("sha256")
  for (const f of rels) {
    /** That fixture file's own sha256, over the same LF-normalized bytes. */
    const fh: string = createHash("sha256").update(readAssetBytes(join(dir, f))).digest("hex")
    h.update(f + "\n" + fh + "\n")
  }
  return { fileCount: enumerated.fileCount, treeSha: h.digest("hex") }
}

/**
 * Run every self-test arm in a temp fixture root and return the process exit code.
 *
 * WHY THIS SHIPS: the acceptance falsifier — "a deliberately corrupted asset fingerprint still
 * FAILS" — has to be a repeatable command a reviewer can run, not a claim that lives only in an
 * evidence directory. Every arm spawns a COPY of this script against a COPY of the lock inside a temp
 * root, so the shipped `VENDOR_LOCK.json` is never read or written.
 *
 * @returns 0 when every arm held, 1 when any arm failed.
 */
function selfTest(): number {
  /** The arm outcomes, in run order. */
  const arms: SelfTestArm[] = []
  /** The fixture root, which mimics a repository: `scripts/` + `VENDOR_LOCK.json` + `assets/`. */
  const root: string = mkdtempSync(join(tmpdir(), "mpd-verify-vendor-selftest-"))
  /** Record one arm's outcome. */
  const arm = (name: string, ok: boolean, note: string): void => { arms.push({ name, ok, note }) }
  /**
   * Assert one spawned fixture run.
   *
   * @param name - The arm's stable name.
   * @param r - The spawned run to judge.
   * @param wantCode - The exit status the arm requires.
   * @param wantIn - A substring the run's combined output must carry (omitted means "any output").
   * @returns Nothing; the outcome is recorded on `arms`.
   */
  const expect = (name: string, r: FixtureRun, wantCode: number, wantIn?: string): void => {
    /** The combined transcript, which is what a human reads when an arm is red. */
    const all: string = r.out + r.err
    /** The two conditions the arm asserts, reported separately so a red arm names its own cause. */
    const codeOk: boolean = r.code === wantCode
    /** Whether the required substring is present; a vacuous requirement is treated as held. */
    const textOk: boolean = wantIn === undefined || all.includes(wantIn)
    /** The line the arm asserts against — quoted instead of the run's last line, so a reader sees the
     * exact message the arm required rather than whatever the run happened to print last. */
    const quoted: string = wantIn === undefined
      ? (all.split("\n").filter((l: string): boolean => l.includes("[verify-vendor]")).pop() ?? "(no verdict line)")
      : (all.split("\n").find((l: string): boolean => l.includes(wantIn)) ?? "(asserted line absent)")
    arm(name, codeOk && textOk, `exit ${r.code} (want ${wantCode}${codeOk ? "" : " MISMATCH"}); quoted: ${quoted.trim()}`)
  }
  try {
    mkdirSync(join(root, "scripts", "lib"), { recursive: true })
    mkdirSync(join(root, "assets", "corpus"), { recursive: true })
    copyFileSync(SELF_PATH, join(root, "scripts", "verify-vendor.ts"))
    copyFileSync(join(dirname(SELF_PATH), "lib", "repo.ts"), join(root, "scripts", "lib", "repo.ts"))
    // The shared enumeration rule the fixture gate imports: stage it at the SAME depth, or every arm
    // dies with ERR_MODULE_NOT_FOUND for a reason no arm is about.
    copyFileSync(join(dirname(SELF_PATH), "lib", "asset-files.ts"), join(root, "scripts", "lib", "asset-files.ts"))
    /** The fixture script the arms spawn — a COPY, so the shipped gate is never executed here. */
    const script: string = join(root, "scripts", "verify-vendor.ts")
    /** The fixture lock the arms rewrite between runs. */
    const lockPath: string = join(root, "VENDOR_LOCK.json")
    /** The fixture DIRECTORY asset, which exercises the treeSha fold. */
    const corpus: string = join(root, "assets", "corpus")
    /** The fixture SINGLE-FILE asset, which exercises the sha256 branch. */
    const blob: string = join(root, "assets", "blob.js")
    /** The two seed files, small enough to be mutated one byte at a time. */
    const seed: ReadonlyArray<readonly [string, string]> = [["a.txt", "alpha\n"], ["b.txt", "beta\n"]]
    /** Restore the fixture to its intact state, so each arm starts from the same bytes. */
    const reset = (): void => {
      for (const f of readdirSync(corpus)) rmSync(join(corpus, f), { recursive: true, force: true })
      for (const [name, text] of seed) writeFileSync(join(corpus, name), text)
      writeFileSync(blob, "export const x = 1\n")
    }
    reset()
    /** The asset table derived from the INTACT fixture; every mutation below is measured against it. */
    const good: Record<string, unknown> = ((): Record<string, unknown> => {
      /** The intact fixture directory's fingerprint. */
      const t = fixtureTree(corpus)
      return {
        _note: "self-test fixture",
        "assets/corpus": { fileCount: t.fileCount, treeSha: t.treeSha, source: "self-test fixture" },
        "assets/blob.js": { fileCount: 1, sha256: createHash("sha256").update(readFileSync(blob)).digest("hex"), source: "self-test fixture" },
      }
    })()
    /**
     * Write the fixture lock and spawn the fixture gate.
     *
     * @param assets - The fixture asset table to write.
     * @param args - Extra argv for the fixture gate.
     * @returns The child's exit status and its two captured streams.
     */
    const run = (assets: Record<string, unknown>, args: readonly string[] = []): FixtureRun => {
      writeFileSync(lockPath, JSON.stringify({ assets }, null, 2) + "\n")
      /** The spawned fixture gate; both streams are captured so an arm can quote the message. */
      const r = spawnSync("node", [script, ...args], { encoding: "utf8" })
      return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
    }

    // (i) THE CLEAN CONTROL: without this every later arm could be green for the wrong reason.
    expect("intact-fixture-PASS", run(good), 0, "[verify-vendor] PASS")

    // (ii) one BYTE appended to a fingerprinted file -> the tree fold must catch it, naming the asset.
    writeFileSync(join(corpus, "a.txt"), "alpha\n ")
    expect("one-byte-edit-FAILS", run(good), 1, "assets/corpus treeSha mismatch")

    // (iii) one FILE added -> the count guard must catch it BEFORE any hash work.
    reset()
    writeFileSync(join(corpus, "extra.txt"), "extra\n")
    expect("added-file-count-drift-FAILS", run(good), 1, "assets/corpus count drifted")

    // (iv) an EMPTY asset table -> the zero-subject guard must REFUSE, never report a vacuous PASS.
    reset()
    expect("zero-subject-REFUSED", run({ _note: "self-test fixture" }), 1, "zero-subject run")

    // (v) the SINGLE-FILE branch: a corrupted blob must fail on sha256, not on the fold.
    writeFileSync(blob, "export const x = 2\n")
    expect("corrupted-single-file-FAILS", run(good), 1, "assets/blob.js sha256 mismatch")

    // (vi)+(vii) the argv contract: the retired flag refuses, an unknown flag is a usage error.
    reset()
    expect("require-upstream-REFUSED", run(good, ["--require-upstream"]), 1, "REFUSED")
    expect("unknown-flag-FAILS", run(good, ["--frobnicate"]), 1, "unknown argument")

    // (viii) THE CLOSING CONTROL: the fixture is restored, so the SAME lock must pass again — this is
    // what proves arms (ii)-(v) failed because of their mutation and not because a run left it dirty.
    expect("restored-fixture-PASS", run(good), 0, "[verify-vendor] PASS")

    // (ix) THE NON-GIT FALLBACK: the fixture root is not a git work tree, so the fingerprint must
    // come from the filesystem walk AND the run must say so. This is the arm that keeps an unpacked
    // copy working - a fallback that silently reported an empty asset would fail the count instead.
    expect("non-git-fallback-walks", run(good), 0, "filesystem walk")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  /** The arms that did not hold; the returned exit code is derived from it. */
  let failedArms: number = 0
  for (const a of arms) {
    if (!a.ok) failedArms += 1
    console.log(`[verify-vendor] SELF-TEST ${a.ok ? "PASS" : "FAIL"} - ${a.name}`)
    console.log(`[verify-vendor]   ${a.note}`)
  }
  console.log(`[verify-vendor] SELF-TEST ${failedArms === 0 ? "PASS" : "FAIL"} - ${arms.length - failedArms}/${arms.length} arm(s) passed`)
  return failedArms === 0 ? 0 : 1
}

// Guard-2 (t8 / R7.15): the fingerprint loop is the gate's subject. With `assets` empty (or
// every entry underscored) the run used to print PASS while checking zero fingerprints, so the
// exit code proved nothing. Refuse the zero-subject run by name instead.
// The lock's `_note` commentary key is the only non-asset entry and the filter drops every
// `_`-prefixed key before any fingerprint work, so the surviving entries are asset metadata; the
// assertion restates that JSON-boundary fact (the compiler cannot know a file's shape) and the
// filter itself is unchanged.
/** The asset entries this run fingerprints, i.e. every non-`_`-prefixed key of `assets`. */
const assetEntries: Array<[string, VendorAssetMeta]> = Object.entries(lock.assets || {}).filter(([rel]: [string, VendorAssetMeta | string]): boolean => !String(rel).startsWith("_")) as Array<[string, VendorAssetMeta]>
if (assetEntries.length === 0) {
  fail("zero-subject run: VENDOR_LOCK.json declares no vendored assets to fingerprint - refusing to report PASS")
}
for (const [rel, meta] of assetEntries) {
  /** The asset's path inside the repository. */
  const dir: string = join(repoRoot, rel)
  if (!existsSync(dir)) { fail("asset missing: " + rel); continue }
  /** The asset's SHIPPED files, by the one shared rule: the git index, or the walk off a work tree. */
  const asset: AssetEnumeration = listAssetFiles(dir)
  // The basis is printed whenever it is NOT the index, so a packed copy and a checkout are
  // distinguishable in one log and a fallback never stays silent.
  if (asset.source === "walk") {
    console.log("[verify-vendor] note: " + rel + " enumerated by " + asset.detail + " (" + asset.fileCount + " file(s))")
  }
  // An asset that failed any of its gates must never also report OK.
  /** Whether this asset has passed every fingerprint check so far. */
  let assetOk: boolean = true
  if (asset.fileCount !== meta.fileCount) {
    fail("asset " + rel + " count drifted: " + asset.fileCount + " vs " + meta.fileCount)
    assetOk = false
  }
  // A tracked file the tree no longer has is a MISSING shipped byte, never a re-pin candidate: the
  // index still names it, so the gate fails by name instead of quietly fingerprinting the remainder.
  if (asset.missing.length > 0) {
    fail("asset " + rel + " tracked file(s) missing from the tree: " + asset.missing.map((p: string): string => p.slice(repoRoot.length + 1)).join(", "))
    assetOk = false
  }
  if (typeof meta.sha256 === "string") {
    /** The single file's sha256, computed on its RAW bytes (the lock's single-file rule). */
    const actual: string = createHash("sha256").update(readFileSync(dir)).digest("hex")
    if (actual !== meta.sha256) { fail("asset " + rel + " sha256 mismatch"); assetOk = false }
  }
  if (typeof meta.treeSha === "string") {
    // The fold input is the RELPATH, so it must be spelled the same on every platform: a native
    // separator would make one corpus hash two different values (Windows `a\\b` vs POSIX `a/b`)
    // and the lock could only ever satisfy one of them — measured: a clean Windows checkout
    // recomputed 4b4f37… for a corpus the lock pins as 220ddd2c…, i.e. this gate was permanently
    // RED here while the same bytes were GREEN on the POSIX machine that wrote the pin. Same
    // discipline as readAssetBytes()'s LF normalization above: the fingerprint is of the CONTENT.
    /** The asset's relpaths, POSIX-spelled and sorted — the fold's input order. */
    const files2: string[] = asset.files.map((f: string): string => f.slice(dir.length + 1).split(sep).join("/")).sort()
    /** The running fold hash over (relpath, per-file sha256) pairs. */
    const h = createHash("sha256")
    // Relpath of one file inside the asset, in sorted order.
    for (const f of files2) {
      /** That file's own sha256, over LF-normalized bytes. */
      const fh: string = createHash("sha256").update(readAssetBytes(join(dir, f))).digest("hex")
      h.update(f + "\n" + fh + "\n")
    }
    /** The asset's folded tree fingerprint. */
    const actual: string = h.digest("hex")
    if (actual !== meta.treeSha) { fail("asset " + rel + " treeSha mismatch"); assetOk = false }
  }
  if (assetOk) console.log("[verify-vendor] asset OK:", rel, asset.fileCount, "files")
}

if (failed) process.exit(1)
console.log("[verify-vendor] PASS - " + assetEntries.length + " shipped asset(s) fingerprinted, upstream identity not checked")
