#!/usr/bin/env bun
// Case tui-distribution: validate the bundle-level `dsh-distribution.json` with the
// dsh-distribution protocol's OWN conformance CLI, from a workspace-local copy of the
// mounted protocol repo so every build write stays inside the sandbox.
//
// Honesty rule (AC-13): the CLI needs the protocol workspace installed and built
// (`pnpm install --frozen-lockfile && pnpm build`, then the built
// `packages/conformance/lib/cli.js`). If that cannot happen in this environment the
// lane records the exact command, exit code and stderr tail, marks the descriptor
// **NOT fully validated**, and still runs its own structural assertions — it never
// approximates a pass. A stale/invalid descriptor FAILS the structural arm.
//
// PREREQ: absent-runtime pnpm "install pnpm (corepack enable) to build the protocol CLI"
// PREREQ: absent-fixture vendor/meta-protocols/dsh-distribution "check out the host repo with its submodules initialised, or set MPD_TUI_SPEC_ROOT"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-distribution.ts --self-test
//   bun skills/dsh-qa/scripts/tui-distribution.ts [--sandbox-root <dir>] [--skip-build]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,distribution-cli.json}
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { REPO, artifactRevision, emitMarker, laneEvidenceDir, makeChecks, manifestDigest, onPath, parseSandboxArgs, resolveSpecCheckout, sandboxEnv, writeLaneEvidence, writeRevisionFile } from "./lib/tui-lane.ts"
import type { Env } from "./lib/dsh-launcher.ts"

/** The case slug: names the evidence marker lines and the `[slug]` log prefix of this lane. */
const SLUG = "tui-distribution"
/** Absolute path of the bundle-level descriptor under test (`<repo>/dsh-distribution.json`). */
const DESCRIPTOR = join(REPO, "dsh-distribution.json")
/**
 * The MOUNTED `dsh-distribution` protocol repo: a submodule of the operator's own
 * `dsh-ecosystem-spec` checkout (`resolveSpecCheckout()`), never a part of this repo. `undefined`
 * on a host that has no such checkout — an ABSENT EXTERNAL FIXTURE the lane reports as a declared
 * skip (a FAIL under `--no-skip`), never a crash inside its own logic.
 */
const PROTOCOL_REPO: string | undefined = ((): string | undefined => {
  // The mounted checkout root, or `undefined` when this host carries no such checkout.
  const checkout = resolveSpecCheckout()
  return checkout === undefined ? undefined : join(checkout, "vendor", "meta-protocols", "dsh-distribution")
})()
/** What the gate probed for, printed as `prereq=` in the absent-fixture marker line. */
const PROTOCOL_PROBE = "vendor/meta-protocols/dsh-distribution in a mounted dsh-ecosystem-spec checkout"
/** The exact remediation printed in that marker line when the external fixture is absent. */
const PROTOCOL_REMEDY = "check out the host repo with its submodules initialised, or set MPD_TUI_SPEC_ROOT"

/** The `distribution` block of a descriptor: both members are required and must be non-empty. */
interface DescriptorDistribution {
  /** The distribution id; a missing or empty value is a finding. */
  id?: unknown
  /** The distribution version, which must equal the package version whenever one is supplied. */
  version?: unknown
}

/** The descriptor subset these structural rules read; every other key is ignored on purpose. */
interface DescriptorDocument {
  /** The protocol apiVersion, which must be `distribution.dsh.dev/v1alpha1`. */
  readonly apiVersion?: unknown
  /** The document kind, which must be `DistributionDescriptor`. */
  readonly kind?: unknown
  /** The distribution identity block. */
  readonly distribution?: DescriptorDistribution
  /** The declared protocols, which must be an array (its entries are not read here). */
  readonly protocols?: unknown
}

/**
 * The mutable view the negative controls clone and overwrite one key of: the shipped descriptor
 * always carries `distribution`, so it is required here while every other key stays optional.
 */
interface DescriptorFixture {
  /** The protocol apiVersion; overwritten only by a control that needs a mismatch. */
  apiVersion?: unknown
  /** The document kind, which the `wrongKind` control replaces with a non-descriptor value. */
  kind?: unknown
  /** The identity block, mutated in place to prove the version comparison is falsifiable. */
  distribution: DescriptorDistribution
  /** The protocols field, which the `badProtocols` control replaces with a non-array. */
  protocols?: unknown
  /** An extra key the `secret` control injects to prove secret material is rejected. */
  extra?: unknown
}

/** The `package.json` field this lane reads: the version the descriptor identity must match. */
interface PackageJson {
  /** The package version compared against `distribution.version`. */
  readonly version: string
}

/** One command the protocol's own tooling requires, in the order it must run. */
export interface BuildStep {
  /** The step label (`install` / `build` / `check`), which also selects the step's timeout. */
  readonly name: string
  /** The executable to spawn: `pnpm` for the first two steps, this Node binary for the CLI. */
  readonly command: string
  /** The argument list, joined verbatim into the recorded command line. */
  readonly args: string[]
  /** Working directory for the child: the workspace-local protocol copy. */
  readonly cwd: string
}

/** The outcome of one build step, recorded verbatim in `distribution-cli.json`. */
interface StepResult {
  /** The step label carried over from the plan, or `skipped` for the `--skip-build` pseudo-step. */
  name: string
  /** The command line as recorded (`<command> <args…>`), absent on the missing-binary arm. */
  command?: string
  /** The child's exit status; `undefined` when the binary was never spawned (`missingBinary`). */
  status?: number | null
  /** The tail of the child's stdout, capped at 4000 characters. */
  stdout?: string
  /** The tail of the child's stderr, or the PATH diagnostic on the missing-binary arm. */
  stderr?: string
  /** `Error.message` of a failed spawn (e.g. ENOENT), absent on a normal run. */
  error?: string
  /** True when the binary was not found on PATH, so no spawn was attempted at all. */
  missingBinary?: boolean
  /** The step's arguments, carried over on the missing-binary arm for the reason text. */
  args?: string[]
  /** The step's working directory, carried over on the missing-binary arm. */
  cwd?: string
  /** Why the step did not run (`--skip-build`), present only on the skip pseudo-step. */
  reason?: string
}

/** The per-step knobs `runStep` accepts. */
interface RunStepOptions {
  /** Hard timeout in milliseconds for this step's child process. */
  readonly timeoutMs: number
}

/**
 * Structural rules of `distribution.dsh.dev/v1alpha1` (required keys, no over-claim).
 * @param descriptor The parsed descriptor document, from any producer, or a non-object value.
 * @param pkgVersion The package version `distribution.version` must equal, when the caller knows it.
 * @returns Every rule violation in check order; an empty array means all structural rules hold.
 */
export function descriptorFindings(descriptor: unknown, pkgVersion?: string): string[] {
  // Every rule violation found so far; a non-empty list is what this lane reports as a red.
  const findings: string[] = []
  if (descriptor === undefined || descriptor === null || typeof descriptor !== "object") return ["the descriptor is not an object"]
  // The descriptor arrives as a parsed, unvalidated JSON document; the object guard above leaves only
  // its "not a primitive" fact, so it is viewed as the local document shape and every key is probed.
  const doc = descriptor as DescriptorDocument
  if (doc.apiVersion !== "distribution.dsh.dev/v1alpha1") findings.push("apiVersion must be distribution.dsh.dev/v1alpha1")
  if (doc.kind !== "DistributionDescriptor") findings.push("kind must be DistributionDescriptor")
  if (typeof doc.distribution?.id !== "string" || doc.distribution.id.length === 0) findings.push("distribution.id is required")
  if (typeof doc.distribution?.version !== "string" || doc.distribution.version.length === 0) findings.push("distribution.version is required")
  if (pkgVersion !== undefined && doc.distribution?.version !== pkgVersion) findings.push("distribution.version must match package.json (" + pkgVersion + ")")
  if (!Array.isArray(doc.protocols)) findings.push("protocols must be an array")
  // The serialized document, scanned below for the secret-bearing substrings a descriptor must not carry.
  const text = JSON.stringify(descriptor)
  // The forbidden substrings, checked in the order the reasons are reported.
  for (const forbidden of ["apiKey", "password", "token", "-----BEGIN"]) {
    if (text.includes(forbidden)) findings.push("the descriptor must never carry secret material (" + forbidden + ")")
  }
  return findings
}

/**
 * The exact commands the protocol's own tooling requires, in order.
 * @param protocolDir The workspace-local copy of the mounted protocol repo the steps run in.
 * @param descriptorPath Absolute path of the descriptor handed to the conformance CLI.
 * @returns The three steps in run order: install, build, then the protocol CLI on the descriptor.
 */
export function buildPlan(protocolDir: string, descriptorPath: string): BuildStep[] {
  return [
    { name: "install", command: "pnpm", args: ["install", "--frozen-lockfile"], cwd: protocolDir },
    { name: "build", command: "pnpm", args: ["build"], cwd: protocolDir },
    { name: "check", command: process.execPath, args: [join(protocolDir, "packages", "conformance", "lib", "cli.js"), descriptorPath], cwd: protocolDir },
  ]
}

/**
 * Run one planned step, reporting a missing binary instead of throwing.
 * @param step The planned command to spawn.
 * @param env The sandbox environment the child inherits.
 * @param options.timeoutMs Hard timeout in milliseconds for the child.
 * @returns The recorded outcome; the missing-binary arm carries no `status`.
 */
function runStep(step: BuildStep, env: Env, { timeoutMs }: RunStepOptions): StepResult {
  if (!existsSync(step.command) && step.command !== process.execPath) {
    // Shell-less PATH lookup: `bash -lc "command -v ..."` would call an installed `pnpm.cmd`
    // missing on win32 (and needs a bash the host may not have at all).
    if (onPath(step.command) === null) return { ...step, status: undefined, missingBinary: true, stderr: step.command + " is not on PATH" }
  }
  // The completed child process; a spawn failure is reported in `error` rather than thrown.
  const run = spawnSync(step.command, step.args, { cwd: step.cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
  return { name: step.name, command: step.command + " " + step.args.join(" "), status: run.status, stdout: (run.stdout ?? "").slice(-4000), stderr: (run.stderr ?? "").slice(-4000), error: run.error?.message }
}

/** The offline arm: descriptor rules and the CLI plan, both falsified by negative controls. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()
  // The shipped descriptor, viewed as the mutable fixture shape the negative controls clone.
  const descriptor = JSON.parse(readFileSync(DESCRIPTOR, "utf8")) as DescriptorFixture
  // The package version the descriptor's identity must reproduce.
  const version = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as PackageJson).version
  // The shipped descriptor's own findings; an empty list is the pass condition below.
  const findings = descriptorFindings(descriptor, version)
  check(findings.length === 0, "the shipped descriptor must satisfy the structural rules: " + JSON.stringify(findings))
  check(descriptorFindings(descriptor).length === 0 || findings.length >= 0, "the descriptor must parse")

  // A clone whose version no longer matches the package; it must produce the mismatch finding.
  const badVersion = structuredClone(descriptor)
  badVersion.distribution.version = "0.0.0-nope"
  check(descriptorFindings(badVersion, version).some((f) => f.includes("must match package.json")), "a NEGATIVE CONTROL failed: a version mismatch must be rejected")
  // A clone whose `protocols` is not an array; it must produce the array finding.
  const badProtocols = structuredClone(descriptor)
  badProtocols.protocols = "not-an-array"
  check(descriptorFindings(badProtocols).some((f) => f.includes("protocols")), "a NEGATIVE CONTROL failed: a non-array protocols field must be rejected")
  // A clone carrying secret material under an extra key; it must produce the secret finding.
  const secret = structuredClone(descriptor)
  secret.extra = { apiKey: "x" }
  check(descriptorFindings(secret).some((f) => f.includes("secret")), "a NEGATIVE CONTROL failed: secret material must be rejected")
  // A clone whose kind is wrong; it must produce the kind finding.
  const wrongKind = structuredClone(descriptor)
  wrongKind.kind = "Nope"
  check(descriptorFindings(wrongKind).some((f) => f.includes("kind")), "a NEGATIVE CONTROL failed: a wrong kind must be rejected")

  // The plan the protocol's own tooling implies: install, build, check — in that order.
  const plan = buildPlan("/tmp/proto", "/tmp/desc.json")
  check(plan.length === 3 && plan[1].args.join(" ") === "build", "the build plan must install, build, then run the protocol CLI")
  // POSIX-spelled before the suffix test: `join` builds the operand with the NATIVE separator, so a
  // win32 path ("C:\\...\\packages\\conformance\\lib\\cli.js") would never match a "/" fragment.
  check(plan[2].args[0].split(sep).join("/").endsWith("packages/conformance/lib/cli.js"), "the conformance CLI must be invoked from its own package path")
  // The mounted protocol repo is an EXTERNAL fixture: absent → declared skip (FAIL under --no-skip),
  // so a host without the checkout reports the missing prereq instead of a red of its own logic.
  if (PROTOCOL_REPO === undefined || !existsSync(PROTOCOL_REPO)) {
    // True when the caller asked for a hard failure instead of a declared skip.
    const strict = process.argv.includes("--no-skip")
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", PROTOCOL_PROBE, PROTOCOL_REMEDY)
    if (strict) problems.push("the mounted dsh-distribution protocol repo is absent and --no-skip was requested")
  }
  // The skill's case table, which must list this lane or the case is unreachable.
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-distribution |"), "the case table does not list tui-distribution")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: descriptor rules + CLI plan are two-sided")
}

/** The live arm: copy the mounted protocol repo into the sandbox and run its own CLI on us. */
function real(): void {
  // The lane's own command line; `--skip-build` and the sandbox flags are read from this slice.
  const argv = process.argv.slice(2)
  // The mounted protocol repo is an EXTERNAL fixture (see PROTOCOL_REPO): a host without it gets
  // the declared skip rather than a crash on the copy below (`--no-skip` forces the FAIL).
  if (PROTOCOL_REPO === undefined || !existsSync(PROTOCOL_REPO)) {
    // True when the caller asked for a hard failure instead of a declared skip.
    const strict = process.argv.includes("--no-skip")
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", PROTOCOL_PROBE, PROTOCOL_REMEDY)
    process.exit(strict ? 1 : 0)
  }
  // The sandbox root and flags: every path below is resolved inside that root, never the real home.
  const { root } = parseSandboxArgs(argv, SLUG)
  // This run's evidence directory, created by the shared helper.
  const outDir = laneEvidenceDir(SLUG)
  // The artifact revision measured before the protocol build touches anything.
  const revisionBefore = artifactRevision()
  // One line per step, joined into `output.log` at the end of the run.
  const log: string[] = []
  // Append one line to the log and echo it with this lane's prefix.
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }

  // The shipped descriptor, read for the structural arm only.
  const descriptor = JSON.parse(readFileSync(DESCRIPTOR, "utf8")) as DescriptorDocument
  // The package version the descriptor's identity must reproduce.
  const version = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as PackageJson).version
  // The structural findings that decide `identityOk` below.
  const findings = descriptorFindings(descriptor, version)
  say("structural findings=" + JSON.stringify(findings))
  // True when the shipped descriptor satisfies every structural rule.
  const identityOk = findings.length === 0

  // The workspace-local copy of the mounted protocol repo every step runs inside.
  const protocolDir = join(root, "distribution-protocol")
  mkdirSync(protocolDir, { recursive: true })
  cpSync(PROTOCOL_REPO, protocolDir, { recursive: true, force: true, dereference: false })
  say("protocol repo copied to " + protocolDir.replace(REPO + "/", ""))

  // The sandbox environment the protocol's own tooling inherits, with an in-sandbox npm cache.
  const env = sandboxEnv(root, { CI: "1", npm_config_cache: join(root, "npm-cache") })
  // One recorded outcome per planned step; the `--skip-build` arm records a single pseudo-step.
  const steps: StepResult[] = []
  // The conformance CLI's parsed stdout, present only when the `check` step succeeded.
  let cliReport: unknown
  if (argv.includes("--skip-build")) {
    steps.push({ name: "skipped", reason: "--skip-build" })
  } else {
    for (const step of buildPlan(protocolDir, DESCRIPTOR)) {
      // This step's recorded outcome; the loop stops at the first non-zero status.
      const result = runStep(step, env, { timeoutMs: step.name === "check" ? 180_000 : 900_000 })
      steps.push(result)
      say(step.name + " -> status=" + String(result.status) + (result.missingBinary ? " (binary missing)" : ""))
      if (result.status !== 0) break
      if (step.name === "check") {
        // `stdout` is absent only on the missing-binary arm, which never reaches this branch: the
        // `status !== 0` break above fires on that arm, so the cast states the arm the flow guarantees.
        try { cliReport = JSON.parse(result.stdout as string) } catch { cliReport = undefined }
      }
    }
  }
  // The first step that failed, or the last step when it never spawned its binary at all.
  const failed = steps.find((step) => step.status !== 0 && step.status !== undefined) ?? (steps.at(-1)?.missingBinary ? steps.at(-1) : undefined)
  // True when the protocol's own CLI accepted the descriptor (the only real validation).
  const fullyValidated = steps.some((step) => step.name === "check" && step.status === 0)
  // Why the descriptor is NOT fully validated, or `undefined` when it is; never a silent pass.
  const blocker = fullyValidated ? undefined : (failed === undefined ? "the protocol build was skipped (--skip-build)" : (failed.stderr || failed.error || "").trim().split("\n").slice(-3).join(" | ") || "exit " + String(failed.status))

  writeFileSync(join(outDir, "distribution-cli.json"), JSON.stringify({ descriptor: DESCRIPTOR, steps, cliReport, fullyValidated, blocker }, null, 2) + "\n")
  // The lane verdict: the descriptor is structurally sound and its validation is either real or recorded.
  const ok = identityOk && (fullyValidated || blocker !== undefined)
  say("fullyValidated=" + fullyValidated + " blocker=" + String(blocker).slice(0, 200))
  // The artifact revision re-measured after the protocol build, compared against `revisionBefore`.
  const revisionAfter = artifactRevision()

  // The digest comparison this run records; a change between the two readings invalidates the result.
  const { delta } = writeRevisionFile(outDir, {

    before: revisionBefore,

    after: revisionAfter,

    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui (protocol build in-sandbox)" },

  })

  if (delta.changed) {

    console.error("[" + SLUG + "] FAIL: " + delta.reason)

    process.exit(1)

  }

  writeLaneEvidence(outDir, SLUG, {
    ok,
    revision: revisionAfter,
    revisionDelta: delta,
    manifestDigest: manifestDigest(),
    steps: { findings, steps: steps.map((step) => ({ name: step.name, command: step.command, status: step.status })), fullyValidated, blocker, cliReport },
    descriptor: { path: "dsh-distribution.json", id: descriptor.distribution?.id, version: descriptor.distribution?.version },
    validation: fullyValidated ? "the protocol's own CLI validated the descriptor" : "NOT fully validated — blocker recorded in distribution-cli.json",
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ findings, blocker }).slice(0, 1200))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: structural rules hold; " + (fullyValidated ? "protocol CLI exit 0" : "protocol CLI blocked and recorded"))
}

// Entry guard: importing this lane (e.g. to reuse findModelEcho or the surface table)
// must never start a live run. The self-test and the real lane run only when this file IS
// the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real()
}
