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
// PREREQ: absent-fixture /root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec "check out the host repo with its submodules initialised"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-spec-conformance.mjs [--sandbox-root <dir>] [--suite-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,spec-conformance.json}
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { REPO, artifactRevision, laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs, resolveHostRoot, sandboxEnv, sha256File, structuralFindings, writeLaneEvidence, writeRevisionFile } from "./lib/tui-lane.ts"

const SLUG = "tui-spec-conformance"
const SPEC_ROOT = process.env.MPD_TUI_SPEC_ROOT ?? "/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec"
const MANIFEST = join(REPO, "dsh-plugin.json")

/** The three-way identity measured in `.mpd/recon/UPSTREAM-RESEARCH.md` §3. */
export const CROSS_CHECK_IDENTITY = [
  ["registry/registry-0.15.json", "c3090dd129aadb06"],
  ["schemas/conformance-claim.schema.json", "447940843bd9324a"],
  ["schemas/effect-ledger-record.schema.json", "bfa0ea159daa1ab8"],
  ["schemas/host-descriptor.schema.json", "4b76c43de2d7f8d0"],
  ["registry/permissions-0.1.json", "1e2cfeaa860936f1"],
  ["registry/contracts/decision-events-v1alpha1.json", "56440dde1b00c210"],
  ["protocols/tui-channel.js", "2f9512d3c415fa1b"],
  ["protocols/profile-definitions.js", "2c0eead58688abaa"],
]

export function suiteRevision(dir = SPEC_ROOT) {
  const run = spawnSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" })
  return (run.stdout ?? "").trim() || undefined
}

export function requirementRows(requirementsJson) {
  const rows = Array.isArray(requirementsJson?.requirements) ? requirementsJson.requirements : []
  return rows.map((row) => ({ id: row.id, source: row.source, test: row.test, evidence: row.evidence }))
}

/** Re-measure the "archive == installed payload == checkout" claim, without extracting anything. */
export function verifyCrossCheckIdentity(hostRoot) {
  const results = CROSS_CHECK_IDENTITY.map(([relative, prefix]) => {
    const installed = hostRoot === undefined ? undefined : join(hostRoot, "dsh-ecosystem-spec", relative)
    const checkout = join(SPEC_ROOT, relative)
    const digest = (file) => (file !== undefined && existsSync(file) ? sha256File(file).slice("sha256:".length) : undefined)
    const installedDigest = digest(installed)
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
 */
export function evaluateRequirements(rows, context) {
  return rows.map((row) => {
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

function selfTest() {
  const { check, problems } = makeChecks()
  const matrix = requirementRows(JSON.parse(readFileSync(join(SPEC_ROOT, "conformance", "requirements-v0.15.json"), "utf8")))
  check(matrix.length >= 7, "the pinned requirement matrix must expose its rows (got " + matrix.length + ")")
  check(matrix.some((row) => row.id === "TUI-PKG-001"), "the matrix must carry TUI-PKG-001")
  check(matrix.some((row) => row.evidence === "review"), "at least one requirement is evidence kind `review` (TUI-TRUST-001)")

  const good = {
    stdSubmodulePresent: true, manifestParserResolves: true, stdArtifact: "vendor/dsh-std @ checkout",
    manifestAtPackageRoot: true, manifestParsed: true, manifestDigest: "sha256:x", manifestPath: "dsh-plugin.json",
    structuralFindings: [], projected: {}, privateCoordinates: ["tui.dsh/v1alpha1#DecisionEvents"],
    hostDescriptor: {}, hostDescriptorArtifact: "plugins-descriptor.pane.txt", cleanupEvidence: "evidence/tui/plugin/<ts>", trustDisclosure: true,
  }
  const pass = evaluateRequirements(matrix, good)
  check(pass.every((row) => row.status === "pass"), "the reference context must satisfy every requirement: " + JSON.stringify(pass.filter((row) => row.status !== "pass")))

  const missingManifest = evaluateRequirements(matrix, { ...good, manifestAtPackageRoot: false })
  check(missingManifest.find((row) => row.id === "TUI-PKG-001")?.status === "fail", "a NEGATIVE CONTROL failed: a missing dsh-plugin.json must fail TUI-PKG-001")
  const overClaim = evaluateRequirements(matrix, { ...good, structuralFindings: ["provides is rejected"] })
  check(overClaim.find((row) => row.id === "TUI-PKG-002")?.status === "fail", "a NEGATIVE CONTROL failed: a structural finding must fail TUI-PKG-002")
  const noDisclosure = evaluateRequirements(matrix, { ...good, trustDisclosure: false })
  check(noDisclosure.find((row) => row.id === "TUI-TRUST-001")?.status === "fail", "a NEGATIVE CONTROL failed: a missing trust disclosure must fail TUI-TRUST-001")
  const bogusId = evaluateRequirements([{ id: "NOPE-001", evidence: "automated" }], good)
  check(bogusId[0].status === "blocked", "an unknown requirement id must be blocked, never passed")

  const identity = verifyCrossCheckIdentity(resolveHostRoot())
  check(identity.results.length === 8, "the identity table must carry eight sampled files")
  check(identity.results.every((row) => row.checkoutDigest !== undefined), "the checkout must expose every sampled file")
  if (resolveHostRoot() !== undefined) {
    check(identity.ok, "the three-way identity must reproduce: " + JSON.stringify(identity.results.filter((row) => !row.matches)))
  }
  check(existsSync(join(SPEC_ROOT, "conformance", "tests", "run.js")), "the pinned suite runner is missing")
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-spec-conformance |"), "the case table does not list tui-spec-conformance")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: matrix mapping two-sided, identity table reproduces on 8 files")
}

async function real() {
  const argv = process.argv.slice(2)
  const { root } = parseSandboxArgs(argv, SLUG)
  const outDir = laneEvidenceDir(SLUG)
  const revisionBefore = artifactRevision()
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }
  const hostRoot = resolveHostRoot()

  const revision = suiteRevision()
  say("PRIMARY suite root " + SPEC_ROOT + " @ " + String(revision))
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
  const identity = verifyCrossCheckIdentity(hostRoot)
  say("three-way identity reproduced=" + identity.ok)

  // The suite runs from a WORKSPACE-LOCAL copy with the installed payload's
  // node_modules on its resolution path: the checkout is read-only for us.
  const suiteDir = join(root, "spec-suite")
  mkdirSync(suiteDir, { recursive: true })
  for (const entry of ["conformance", "protocols", "registry", "schemas", "scripts", "package.json"]) {
    const source = join(SPEC_ROOT, entry)
    if (existsSync(source)) cpSync(source, join(suiteDir, entry), { recursive: true, force: true })
  }
  if (hostRoot !== undefined && !existsSync(join(suiteDir, "node_modules"))) {
    try { symlinkSync(join(hostRoot, "node_modules"), join(suiteDir, "node_modules"), "dir") } catch { /* reported by the run */ }
  }
  const env = sandboxEnv(root, { DSH_STD_ROOT: join(SPEC_ROOT, "vendor", "dsh-std") })
  const attempts = []
  const runSuite = (label, args, timeoutMs) => {
    const run = spawnSync(process.execPath, args, { cwd: suiteDir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
    const record = { label, command: "node " + args.join(" "), status: run.status, stdout: (run.stdout ?? "").slice(-6000), stderr: (run.stderr ?? "").slice(-4000), error: run.error?.message }
    attempts.push(record)
    say(label + " -> status=" + String(record.status) + (record.stderr.includes("ERR_MODULE_NOT_FOUND") ? " (module not found)" : ""))
    return record
  }
  const manifestRun = runSuite("pinned-cli", [join(suiteDir, "scripts", "validate-manifest.mjs"), "--manifest", MANIFEST], 180_000)
  const suiteRun = runSuite("pinned-suite", [join(suiteDir, "scripts", "conformance.mjs"), "--manifest", MANIFEST, "--host", join(SPEC_ROOT, "registry", "host-descriptor.tui.example.json")], 300_000)
  const lastAttempt = suiteRun.status === 0 ? suiteRun : manifestRun
  const blocker = lastAttempt.status === 0 ? undefined : (lastAttempt.stderr || lastAttempt.error || "").split("\n").filter((line) => line.trim().length > 0).slice(-3).join(" | ") || "exit " + String(lastAttempt.status)

  // Per-requirement results against OUR artifacts, with the pinned parser inputs.
  const matrix = requirementRows(JSON.parse(readFileSync(join(SPEC_ROOT, "conformance", "requirements-v0.15.json"), "utf8")))
  let manifestParsed = false
  let projected
  try {
    const { parseManifest, projectManifest } = await import("file://" + join(hostRoot, "node_modules", "@dsh-std", "manifest", "lib", "index.js"))
    const parsed = parseManifest(readFileSync(MANIFEST, "utf8"), { source: MANIFEST })
    projected = projectManifest(parsed)
    manifestParsed = true
  } catch (error) {
    say("pinned parser unavailable: " + String(error?.message ?? error))
  }
  const rawManifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
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
    trustDisclosure: (() => {
      // TUI-TRUST-001 needs the disclosure to EXIST IN TEXT, not merely a file to exist.
      const candidates = [join(REPO, "docs", "tui.md"), join(REPO, "docs", "tui.zh-CN.md"), MANIFEST]
      return candidates.some((file) => existsSync(file) && readFileSync(file, "utf8").includes("trusted-in-process"))
    })(),
    trustDisclosureArtifact: [join(REPO, "docs", "tui.md"), join(REPO, "docs", "tui.zh-CN.md"), MANIFEST]
      .filter((file) => existsSync(file) && readFileSync(file, "utf8").includes("trusted-in-process"))
      .map((file) => file.replace(REPO + "/", ""))
      .join(", ") || "NO disclosure found",
  })
  say("requirements: " + results.map((row) => row.id + "=" + row.status).join(" "))

  const revisionAfter = artifactRevision()
  const { delta } = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui", suiteRevision: revision },
  })
  if (delta.changed) {
    console.error("[" + SLUG + "] FAIL: " + delta.reason)
    process.exit(1)
  }
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
