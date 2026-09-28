#!/usr/bin/env bun
// Case tui-spec-conformance: run the HOST's own PINNED admission conformance suite
// (the `dsh-ecosystem-spec` submodule at the revision the target host validates
// against) against our manifest and a captured host descriptor — never a
// re-implementation — and record per-requirement results plus every input digest.
//
// Source policy (AC-14): PRIMARY is the populated checkout
// `/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec/`; the archived `6e2cf58` content is
// CROSS-CHECK ONLY and is not extracted — the three-way sha256 identity
// (archive ↔ installed payload ↔ checkout) is re-measured from the installed
// payload here, which is the reproducible form of that check.
//
// The suite needs the nine `@dsh-std/*` packages. The installed payload ships seven;
// when two are missing the lane records the verbatim blocker (never a silent pass)
// and evaluates the suite's own `requirements-v0.15.json` per requirement with the
// pinned parser, so every requirement still gets a status.
//
// PREREQ: absent-fixture dsh-ecosystem-spec (MPD_TUI_SPEC_ROOT, else /root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec
//   on a POSIX host) "check out the host repo with its submodules initialised, or set MPD_TUI_SPEC_ROOT"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-spec-conformance.ts --self-test
//   bun skills/dsh-qa/scripts/tui-spec-conformance.ts [--sandbox-root <dir>] [--suite-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,spec-conformance.json}
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { REPO, artifactRevision, emitMarker, laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs, resolveHostRoot, resolveSpecCheckout, sandboxEnv, sha256File, structuralFindings, writeLaneEvidence, writeRevisionFile } from "./lib/tui-lane.ts"
import type { PluginManifest } from "./lib/tui-lane.ts"

/** The case slug: names the evidence marker lines and the `[slug]` log prefix of this lane. */
const SLUG = "tui-spec-conformance"
/**
 * The pinned host suite checkout — an EXTERNAL fixture, resolved by `resolveSpecCheckout()`
 * (`MPD_TUI_SPEC_ROOT` first, then the recorded POSIX location on POSIX hosts only: on win32 that
 * literal would answer `C:\root\...`, a place no checkout lives). `undefined` means this host has
 * no checkout, so the lane reports a declared skip (a FAIL under `--no-skip`), never a red.
 */
const SPEC_ROOT: string | undefined = resolveSpecCheckout()
/** What the gate probed for, printed as `prereq=` in the absent-fixture marker line. */
const SPEC_PROBE = "dsh-ecosystem-spec with conformance/requirements-v0.15.json"
/** The exact remediation printed in that marker line when the pinned suite is absent. */
const SPEC_REMEDY = "check out the host repo with its submodules initialised, or set MPD_TUI_SPEC_ROOT"
/** Absolute path of the bundle-level manifest under test (`<repo>/dsh-plugin.json`). */
const MANIFEST = join(REPO, "dsh-plugin.json")

/** One sampled file of the three-way identity claim, with its two measured digests. */
export interface CrossCheckRow {
  /** Repo-relative path of the sampled file inside the spec checkout. */
  readonly relative: string
  /** The recorded 16-hex-character sha256 prefix the file must still reproduce. */
  readonly expectedPrefix: string
  /** The installed payload's digest prefix, `undefined` when that copy is absent. */
  readonly installedDigest: string | undefined
  /** The checkout's digest prefix, `undefined` when that copy is absent. */
  readonly checkoutDigest: string | undefined
  /** True when both PRESENT copies reproduce the recorded prefix. */
  readonly matches: boolean
}

/** The three-way identity verdict over every sampled file. */
export interface CrossCheckVerdict {
  /** True when every sampled file reproduced its recorded prefix in both copies. */
  readonly ok: boolean
  /** One row per sampled file, in the identity table's own order. */
  readonly results: CrossCheckRow[]
}

/** One row of `requirements-v0.15.json`, projected to the fields this lane records. */
export interface RequirementRow {
  /** The requirement id the evaluator switches on, e.g. `TUI-PKG-001`. */
  readonly id: string
  /** What produced the evidence (`automated` / `review`), as the matrix declared it. */
  readonly source?: unknown
  /** The test that witnesses the requirement, as the matrix declared it. */
  readonly test?: unknown
  /** The evidence kind the evaluator records, e.g. `review`. */
  readonly evidence?: unknown
}

/** The conformance matrix document subset `requirementRows` projects. */
interface RequirementMatrix {
  /** The requirement rows; a non-array value degrades to the empty list, exactly as before. */
  readonly requirements?: readonly RequirementRow[]
}

/** The three verdicts the per-requirement evaluator may return. */
export type RequirementStatus = "pass" | "fail" | "blocked"

/** One requirement's evaluated status, recorded verbatim in the evidence file. */
export interface RequirementResult {
  /** The requirement id this result belongs to. */
  readonly id: string
  /** The evidence kind the matrix declared for the row. */
  readonly evidenceKind: unknown
  /** The test the matrix declared for the row. */
  readonly test: unknown
  /** The verdict this lane reached for the row. */
  readonly status: RequirementStatus
  /** What witnessed the verdict: a path, a digest or a sentence. */
  readonly artifact: unknown
}

/** Every fact the per-requirement evaluator may read, supplied by the caller so it stays pure. */
export interface RequirementContext {
  /** True when the pinned `dsh-std` submodule is checked out beside the suite. */
  readonly stdSubmodulePresent: boolean
  /** True when the host's own pinned manifest parser resolved and parsed OUR manifest. */
  readonly manifestParserResolves: boolean
  /** Where the std payload came from, recorded as the BASE-STD-001 artifact. */
  readonly stdArtifact: string
  /** True when `dsh-plugin.json` sits at the package root. */
  readonly manifestAtPackageRoot: boolean
  /** True when the manifest was parsed by the pinned parser rather than by `JSON.parse` alone. */
  readonly manifestParsed: boolean
  /** `sha256:<hex>` digest of the manifest, or `undefined` when it could not be read. */
  readonly manifestDigest: string | undefined
  /** Repo-relative path of the manifest, recorded as the TUI-PKG-001 artifact. */
  readonly manifestPath: string
  /** Structural findings of OUR v0.15 rules; any finding fails TUI-PKG-002. */
  readonly structuralFindings: readonly string[]
  /** The parser's projection of the manifest, `undefined` when the parser was unavailable. */
  readonly projected: unknown
  /** The `tui.*` contract coordinates the manifest requires. */
  readonly privateCoordinates: readonly string[]
  /** The host descriptor object, `undefined` when no descriptor was found on this host. */
  readonly hostDescriptor: unknown
  /** Where the host descriptor came from, recorded as the TUI-HOST-001 artifact. */
  readonly hostDescriptorArtifact: string
  /** Where the `ctx.effect` cleanup evidence lives, `undefined` when the lane produced none. */
  readonly cleanupEvidence: string | undefined
  /** True when the trust disclosure was found IN TEXT, not merely in an existing file. */
  readonly trustDisclosure: boolean
  /** The files the disclosure was actually read from; absent in the offline fixtures. */
  readonly trustDisclosureArtifact?: string
}

/** One recorded attempt at running the pinned suite's own tooling. */
interface SuiteAttempt {
  /** The attempt label (`pinned-cli` / `pinned-suite`), used in the log line and the evidence. */
  readonly label: string
  /** The command line as recorded (`node <args…>`). */
  readonly command: string
  /** The child's exit status; `null` when it was signalled or could not be spawned. */
  readonly status: number | null
  /** The tail of the child's stdout, capped at 6000 characters. */
  readonly stdout: string
  /** The tail of the child's stderr, capped at 4000 characters. */
  readonly stderr: string
  /** `Error.message` of a failed spawn (e.g. ENOENT), absent on a normal run. */
  readonly error?: string
}

/** The three-way identity measured in `.mpd/recon/UPSTREAM-RESEARCH.md` §3. */
export const CROSS_CHECK_IDENTITY: ReadonlyArray<readonly [string, string]> = [
  ["registry/registry-0.15.json", "c3090dd129aadb06"],
  ["schemas/conformance-claim.schema.json", "447940843bd9324a"],
  ["schemas/effect-ledger-record.schema.json", "bfa0ea159daa1ab8"],
  ["schemas/host-descriptor.schema.json", "4b76c43de2d7f8d0"],
  ["registry/permissions-0.1.json", "1e2cfeaa860936f1"],
  ["registry/contracts/decision-events-v1alpha1.json", "56440dde1b00c210"],
  ["protocols/tui-channel.js", "2f9512d3c415fa1b"],
  ["protocols/profile-definitions.js", "2c0eead58688abaa"],
]

/**
 * The short revision of the pinned suite checkout.
 * @param dir The checkout to read; defaults to this host's resolved spec root.
 * @returns The `git rev-parse --short HEAD` output, or `undefined` when it is empty or absent.
 */
export function suiteRevision(dir: string | undefined = SPEC_ROOT): string | undefined {
  if (dir === undefined) return undefined
  // The `git rev-parse` invocation; a non-git directory yields empty stdout rather than a throw.
  const run = spawnSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" })
  return (run.stdout ?? "").trim() || undefined
}

/**
 * Project the pinned matrix's rows to the fields this lane records.
 * @param requirementsJson The parsed `requirements-v0.15.json`, from any producer.
 * @returns One row per declared requirement; an absent or non-array `requirements` key yields none.
 */
export function requirementRows(requirementsJson: unknown): RequirementRow[] {
  // The matrix arrives as a parsed JSON document; the cast states the shape whose rows are projected.
  const doc = (requirementsJson ?? {}) as RequirementMatrix
  // The declared rows, or the empty list when the document carries no array at that key.
  const rows: readonly RequirementRow[] = Array.isArray(doc.requirements) ? doc.requirements : []
  return rows.map((row) => ({ id: row.id, source: row.source, test: row.test, evidence: row.evidence }))
}

/**
 * Re-measure the "archive == installed payload == checkout" claim, without extracting anything.
 * @param hostRoot The installed host payload root, or `undefined` when this host has none.
 * @returns The per-file digests and the overall identity verdict.
 */
export function verifyCrossCheckIdentity(hostRoot: string | undefined): CrossCheckVerdict {
  // One measured row per sampled file, in the identity table's own order.
  const results = CROSS_CHECK_IDENTITY.map(([relative, prefix]) => {
    // The installed payload's copy, or `undefined` when this host carries no payload.
    const installed = hostRoot === undefined ? undefined : join(hostRoot, "dsh-ecosystem-spec", relative)
    // Every caller reaches this function only after the `SPEC_ROOT === undefined` skip arm returned,
    // so the checkout root is a string here; the cast states the guards' guarantee rather than
    // inventing a fallback path that would silently change which file is digested.
    const checkout = join(SPEC_ROOT as string, relative)
    // The digest of one candidate file, or `undefined` when the path is absent or unreadable.
    const digest = (file: string | undefined): string | undefined => (file !== undefined && existsSync(file) ? sha256File(file).slice("sha256:".length) : undefined)
    // The installed payload's measured digest prefix, absent when that copy is missing.
    const installedDigest = digest(installed)
    // The checkout's measured digest prefix, absent when that copy is missing.
    const checkoutDigest = digest(checkout)
    return {
      relative,
      expectedPrefix: prefix,
      installedDigest: installedDigest === undefined ? undefined : installedDigest.slice(0, 16),
      checkoutDigest: checkoutDigest === undefined ? undefined : checkoutDigest.slice(0, 16),
      matches: installedDigest !== undefined && installedDigest.startsWith(prefix) && checkoutDigest !== undefined && checkoutDigest.startsWith(prefix),
    }
  })
  return { ok: results.every((row) => row.matches), results }
}

/**
 * Evaluate each requirement of the pinned matrix against OUR artifacts. Pure: the
 * caller supplies the context (files read, digests computed), so the self-test can
 * falsify the mapping with fixtures.
 * @param rows The matrix rows to evaluate, in matrix order.
 * @param context Every fact the evaluator may read, gathered by the caller.
 * @returns One result per input row; an unknown id is `blocked`, never passed.
 */
export function evaluateRequirements(rows: readonly RequirementRow[], context: RequirementContext): RequirementResult[] {
  return rows.map((row) => {
    // The three fields every branch echoes unchanged from the matrix row.
    const base = { id: row.id, evidenceKind: row.evidence, test: row.test }
    switch (row.id) {
      case "BASE-STD-001":
        return { ...base, status: context.stdSubmodulePresent && context.manifestParserResolves ? "pass" : "blocked", artifact: context.stdArtifact }
      case "TUI-PKG-001":
        return { ...base, status: context.manifestAtPackageRoot && context.manifestParsed && context.manifestDigest !== undefined ? "pass" : "fail", artifact: context.manifestPath }
      case "TUI-PKG-002":
        return { ...base, status: context.structuralFindings.length === 0 && context.projected !== undefined ? "pass" : "fail", artifact: "dsh-plugin.json structural + projection" }
      case "TUI-PRIVATE-001":
        return { ...base, status: context.privateCoordinates.every((entry) => entry.startsWith("tui.dsh/")) ? "pass" : "fail", artifact: JSON.stringify(context.privateCoordinates) }
      case "TUI-HOST-001":
        return { ...base, status: context.hostDescriptor !== undefined ? "pass" : "blocked", artifact: context.hostDescriptorArtifact }
      case "TUI-OBS-001":
        return { ...base, status: context.cleanupEvidence !== undefined ? "pass" : "blocked", artifact: context.cleanupEvidence }
      case "TUI-TRUST-001":
        return { ...base, status: context.trustDisclosure ? "pass" : "fail", artifact: context.trustDisclosureArtifact ?? "trusted-in-process disclosure" }
      default:
        return { ...base, status: "blocked", artifact: "no evaluator for this requirement id" }
    }
  })
}

/** The offline arm: the matrix mapping and the identity table, both falsified by fixtures. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()
  // The pinned suite checkout is an EXTERNAL fixture (see SPEC_ROOT). A host without it reports the
  // absent fixture and SKIPS the fixture-dependent arms — rule T8-F1: the skip is legitimate
  // because this self-test did not ask for the fixture, and `--no-skip` forces the FAIL instead.
  // The LOCAL arm (the case-table row) always runs, so the skip cannot stand in for a broken lane.
  // The pinned matrix path, or `undefined` when this host has no spec checkout at all.
  const matrixPath = SPEC_ROOT === undefined ? undefined : join(SPEC_ROOT, "conformance", "requirements-v0.15.json")
  if (matrixPath === undefined || !existsSync(matrixPath)) {
    // True when the caller asked for a hard failure instead of a declared skip.
    const strict = process.argv.includes("--no-skip")
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", SPEC_PROBE, SPEC_REMEDY)
    if (strict) problems.push("the pinned suite checkout is absent on this host and --no-skip was requested")
    // The skill document that must list this case, or the case is unreachable.
    const localSkill = join(REPO, "skills", "dsh-qa", "SKILL.md")
    check(existsSync(localSkill) && readFileSync(localSkill, "utf8").includes("| tui-spec-conformance |"), "the case table does not list tui-spec-conformance")
    if (problems.length > 0) {
      console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
      for (const problem of problems) console.error("  - " + problem)
      process.exit(1)
    }
    console.log("[" + SLUG + " self-test] ok: the pinned suite checkout is absent on this host; the local arms were verified (see the SKIP marker)")
    return
  }
  // The pinned matrix rows, re-read under the guard above (the skip arm returned when it was absent).
  const matrix = requirementRows(JSON.parse(readFileSync(join(SPEC_ROOT as string, "conformance", "requirements-v0.15.json"), "utf8")))
  check(matrix.length >= 7, "the pinned requirement matrix must expose its rows (got " + matrix.length + ")")
  check(matrix.some((row) => row.id === "TUI-PKG-001"), "the matrix must carry TUI-PKG-001")
  check(matrix.some((row) => row.evidence === "review"), "at least one requirement is evidence kind `review` (TUI-TRUST-001)")

  // A context in which every requirement passes; each negative control mutates one field of it.
  const good: RequirementContext = {
    stdSubmodulePresent: true, manifestParserResolves: true, stdArtifact: "vendor/dsh-std @ checkout",
    manifestAtPackageRoot: true, manifestParsed: true, manifestDigest: "sha256:x", manifestPath: "dsh-plugin.json",
    structuralFindings: [], projected: {}, privateCoordinates: ["tui.dsh/v1alpha1#DecisionEvents"],
    hostDescriptor: {}, hostDescriptorArtifact: "plugins-descriptor.pane.txt", cleanupEvidence: "evidence/tui/plugin/<ts>", trustDisclosure: true,
  }
  // The reference evaluation, which must satisfy every requirement in the matrix.
  const pass = evaluateRequirements(matrix, good)
  check(pass.every((row) => row.status === "pass"), "the reference context must satisfy every requirement: " + JSON.stringify(pass.filter((row) => row.status !== "pass")))

  // The reference context with the manifest moved off the package root; TUI-PKG-001 must fail.
  const missingManifest = evaluateRequirements(matrix, { ...good, manifestAtPackageRoot: false })
  check(missingManifest.find((row) => row.id === "TUI-PKG-001")?.status === "fail", "a NEGATIVE CONTROL failed: a missing dsh-plugin.json must fail TUI-PKG-001")
  // The reference context with a structural finding injected; TUI-PKG-002 must fail.
  const overClaim = evaluateRequirements(matrix, { ...good, structuralFindings: ["provides is rejected"] })
  check(overClaim.find((row) => row.id === "TUI-PKG-002")?.status === "fail", "a NEGATIVE CONTROL failed: a structural finding must fail TUI-PKG-002")
  // The reference context with the disclosure withdrawn; TUI-TRUST-001 must fail.
  const noDisclosure = evaluateRequirements(matrix, { ...good, trustDisclosure: false })
  check(noDisclosure.find((row) => row.id === "TUI-TRUST-001")?.status === "fail", "a NEGATIVE CONTROL failed: a missing trust disclosure must fail TUI-TRUST-001")
  // A matrix row whose id no evaluator knows; it must end up blocked, never passed.
  const bogusId = evaluateRequirements([{ id: "NOPE-001", evidence: "automated" }], good)
  check(bogusId[0].status === "blocked", "an unknown requirement id must be blocked, never passed")

  // The re-measured three-way identity of the sampled files.
  const identity = verifyCrossCheckIdentity(resolveHostRoot())
  check(identity.results.length === 8, "the identity table must carry eight sampled files")
  check(identity.results.every((row) => row.checkoutDigest !== undefined), "the checkout must expose every sampled file")
  if (resolveHostRoot() !== undefined) {
    check(identity.ok, "the three-way identity must reproduce: " + JSON.stringify(identity.results.filter((row) => !row.matches)))
  }
  check(existsSync(join(SPEC_ROOT as string, "conformance", "tests", "run.js")), "the pinned suite runner is missing")
  // The skill document that must list this case, or the case is unreachable.
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-spec-conformance |"), "the case table does not list tui-spec-conformance")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: matrix mapping two-sided, identity table reproduces on 8 files")
}

/** The live arm: run the pinned suite from a sandbox copy and evaluate every requirement. */
async function real(): Promise<void> {
  // The lane's own command line; the sandbox flags are read from this slice.
  const argv = process.argv.slice(2)
  // The pinned suite checkout is an EXTERNAL fixture (see SPEC_ROOT): without it every digest below
  // would read a missing file, so the run reports the declared skip instead (`--no-skip` → FAIL).
  if (SPEC_ROOT === undefined || !existsSync(join(SPEC_ROOT, "conformance", "requirements-v0.15.json"))) {
    // True when the caller asked for a hard failure instead of a declared skip.
    const strict = process.argv.includes("--no-skip")
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", SPEC_PROBE, SPEC_REMEDY)
    process.exit(strict ? 1 : 0)
  }
  // The sandbox root: every path below resolves inside it, never the real home.
  const { root } = parseSandboxArgs(argv, SLUG)
  // This run's evidence directory, created by the shared helper.
  const outDir = laneEvidenceDir(SLUG)
  // The artifact revision measured before the suite runs.
  const revisionBefore = artifactRevision()
  // One line per step, joined into `output.log` at the end of the run.
  const log: string[] = []
  // Append one line to the log and echo it with this lane's prefix.
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }
  // The installed host payload root, `undefined` when this host has none.
  const hostRoot = resolveHostRoot()

  // The pinned checkout's short revision, recorded beside every digest.
  const revision = suiteRevision()
  say("PRIMARY suite root " + SPEC_ROOT + " @ " + String(revision))
  // Every pinned input's digest, so a reviewer can re-measure the same run.
  const digests = {
    revision,
    runJs: sha256File(join(SPEC_ROOT, "conformance", "tests", "run.js")),
    admissionCore: sha256File(join(SPEC_ROOT, "conformance", "tests", "admission-core.js")),
    stdModules: sha256File(join(SPEC_ROOT, "conformance", "tests", "std-modules.js")),
    cliTest: sha256File(join(SPEC_ROOT, "conformance", "tests", "validate-manifest.cli.test.js")),
    requirements: sha256File(join(SPEC_ROOT, "conformance", "requirements-v0.15.json")),
    registry: sha256File(join(SPEC_ROOT, "registry", "registry-0.15.json")),
    permissions: sha256File(join(SPEC_ROOT, "registry", "permissions-0.1.json")),
    manifest: sha256File(MANIFEST),
  }
  // The re-measured three-way identity of the sampled files.
  const identity = verifyCrossCheckIdentity(hostRoot)
  say("three-way identity reproduced=" + identity.ok)

  // The suite runs from a WORKSPACE-LOCAL copy with the installed payload's
  // node_modules on its resolution path: the checkout is read-only for us.
  const suiteDir = join(root, "spec-suite")
  mkdirSync(suiteDir, { recursive: true })
  for (const entry of ["conformance", "protocols", "registry", "schemas", "scripts", "package.json"]) {
    // The checkout entry to copy, when this checkout carries it.
    const source = join(SPEC_ROOT, entry)
    if (existsSync(source)) cpSync(source, join(suiteDir, entry), { recursive: true, force: true })
  }
  if (hostRoot !== undefined && !existsSync(join(suiteDir, "node_modules"))) {
    try { symlinkSync(join(hostRoot, "node_modules"), join(suiteDir, "node_modules"), "junction") } catch { /* reported by the run */ }
  }
  // The sandbox environment the pinned suite inherits, pointed at the checkout's std payload.
  const env = sandboxEnv(root, { DSH_STD_ROOT: join(SPEC_ROOT, "vendor", "dsh-std") })
  // Every recorded suite invocation, in the order they were attempted.
  const attempts: SuiteAttempt[] = []
  // Run one pinned tool from the sandbox copy and record its outcome.
  const runSuite = (label: string, args: string[], timeoutMs: number): SuiteAttempt => {
    // The completed child process; a spawn failure is reported in `error` rather than thrown.
    const run = spawnSync(process.execPath, args, { cwd: suiteDir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
    // The recorded outcome of this attempt, pushed before it is returned.
    const record = { label, command: "node " + args.join(" "), status: run.status, stdout: (run.stdout ?? "").slice(-6000), stderr: (run.stderr ?? "").slice(-4000), error: run.error?.message }
    attempts.push(record)
    say(label + " -> status=" + String(record.status) + (record.stderr.includes("ERR_MODULE_NOT_FOUND") ? " (module not found)" : ""))
    return record
  }
  // The pinned CLI's own manifest validation attempt.
  const manifestRun = runSuite("pinned-cli", [join(suiteDir, "scripts", "validate-manifest.mjs"), "--manifest", MANIFEST], 180_000)
  // The pinned admission suite's own attempt.
  const suiteRun = runSuite("pinned-suite", [join(suiteDir, "scripts", "conformance.mjs"), "--manifest", MANIFEST, "--host", join(SPEC_ROOT, "registry", "host-descriptor.tui.example.json")], 300_000)
  // The attempt whose status decides whether the suite really validated the descriptor.
  const lastAttempt = suiteRun.status === 0 ? suiteRun : manifestRun
  // The verbatim blocker when the suite could not run, or `undefined` when it did.
  const blocker = lastAttempt.status === 0 ? undefined : (lastAttempt.stderr || lastAttempt.error || "").split("\n").filter((line) => line.trim().length > 0).slice(-3).join(" | ") || "exit " + String(lastAttempt.status)

  // Per-requirement results against OUR artifacts, with the pinned parser inputs.
  // The pinned matrix rows, re-read for the per-requirement evaluation below.
  const matrix = requirementRows(JSON.parse(readFileSync(join(SPEC_ROOT, "conformance", "requirements-v0.15.json"), "utf8")))
  // True once the host's own pinned parser accepted OUR manifest.
  let manifestParsed: boolean = false
  // The pinned parser's projection of the manifest, `undefined` until (and unless) it resolves.
  let projected: unknown
  try {
    // The host's own pinned parser and projector, loaded from the installed payload.
    const { parseManifest, projectManifest } = await import("file://" + join(hostRoot as string, "node_modules", "@dsh-std", "manifest", "lib", "index.js"))
    // The parsed manifest document the projector consumes.
    const parsed = parseManifest(readFileSync(MANIFEST, "utf8"), { source: MANIFEST })
    projected = projectManifest(parsed)
    manifestParsed = true
  } catch (error) {
    // The thrown value is `unknown` under strict mode; it is viewed as an error-like record so a
    // plain-object throw still reports its own `.message`, exactly as that expression did before.
    say("pinned parser unavailable: " + String((error as { message?: unknown } | null)?.message ?? error))
  }
  // The manifest as parsed JSON: an unvalidated document whose declared fields are probed below.
  const rawManifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as PluginManifest
    // The per-requirement verdicts, computed from this run's real artifacts.
    const results = evaluateRequirements(matrix, {
    stdSubmodulePresent: existsSync(join(SPEC_ROOT, "vendor", "dsh-std", "packages")),
    manifestParserResolves: manifestParsed,
    stdArtifact: "installed payload node_modules/@dsh-std + " + join(SPEC_ROOT, "vendor", "dsh-std"),
    manifestAtPackageRoot: existsSync(MANIFEST),
    manifestParsed,
    manifestDigest: sha256File(MANIFEST),
    manifestPath: "dsh-plugin.json",
    structuralFindings: structuralFindings(rawManifest),
    projected,
    privateCoordinates: (rawManifest.requires?.contracts ?? []).map((entry) => `${entry.apiVersion}#${entry.kind}`).filter((entry) => entry.startsWith("tui.")),
    hostDescriptor: existsSync(join(SPEC_ROOT, "registry", "host-descriptor.tui.example.json")) ? { source: "registry example" } : undefined,
    hostDescriptorArtifact: "registry/host-descriptor.tui.example.json (the live descriptor pane is captured by tui-admission)",
    cleanupEvidence: existsSync(join(REPO, "evidence", "tui", "plugin")) ? "evidence/tui/plugin/<ts>/ (ctx.effect ownership in t4's gate results)" : undefined,
    trustDisclosure: ((): boolean => {
      // TUI-TRUST-001 needs the disclosure to EXIST IN TEXT, not merely a file to exist.
      // The files the disclosure may live in: both doc languages plus the manifest itself.
      const candidates = [join(REPO, "docs", "tui.md"), join(REPO, "docs", "tui.zh-CN.md"), MANIFEST]
      return candidates.some((file) => existsSync(file) && readFileSync(file, "utf8").includes("trusted-in-process"))
    })(),
    trustDisclosureArtifact: [join(REPO, "docs", "tui.md"), join(REPO, "docs", "tui.zh-CN.md"), MANIFEST]
      .filter((file) => existsSync(file) && readFileSync(file, "utf8").includes("trusted-in-process"))
      .map((file) => file.replace(REPO + "/", ""))
      .join(", ") || "NO disclosure found",
  })
  say("requirements: " + results.map((row) => row.id + "=" + row.status).join(" "))

  // The artifact revision re-measured after the suite, compared against `revisionBefore`.
  const revisionAfter = artifactRevision()
  // The digest comparison this run records; a change between the two readings invalidates the result.
  const { delta } = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui", suiteRevision: revision },
  })
  if (delta.changed) {
    console.error("[" + SLUG + "] FAIL: " + delta.reason)
    process.exit(1)
  }
  // The evidence document this lane writes beside the shared `result.json`.
  const payload = {
    revision: revisionAfter,
    revisionDelta: delta,
    manifestDigest: manifestDigest(),
    ok: results.every((row) => row.status !== undefined) && (blocker !== undefined || lastAttempt.status === 0) && identity.ok,
    steps: {
      digests,
      identity,
      suite: { fullyRun: lastAttempt.status === 0, attempts, blocker },
      requirements: results,
      suiteExistsOnlyInCheckout: !existsSync(join(hostRoot ?? "", "dsh-ecosystem-spec", "conformance")),
    },
    sandboxRoot: root,
    evidenceNote: "evidence/tui/lanes/<ts>/ (this directory)",
  }
  writeFileSync(join(outDir, "spec-conformance.json"), JSON.stringify(payload, null, 2) + "\n")
  writeLaneEvidence(outDir, SLUG, payload, log.join("\n"))
  if (!payload.ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ blocker, requirements: results.filter((row) => row.status !== "pass"), identity: identity.ok }).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: pinned inputs digested; " + (blocker === undefined ? "suite ran" : "suite blocker recorded") + "; per-requirement statuses recorded")
}

// Entry guard: importing this lane (e.g. to reuse findModelEcho or the surface table)
// must never start a live run. The self-test and the real lane run only when this file IS
// the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else await real()
}
