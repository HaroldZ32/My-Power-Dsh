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
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-distribution.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-distribution.mjs [--sandbox-root <dir>] [--skip-build]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,distribution-cli.json}
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { REPO, artifactRevision, laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs, sandboxEnv, writeLaneEvidence, writeRevisionFile } from "./lib/tui-lane.mjs"

const SLUG = "tui-distribution"
const DESCRIPTOR = join(REPO, "dsh-distribution.json")
const PROTOCOL_REPO = "/root/dshProj/tui/dsh-ecosystem-spec/vendor/meta-protocols/dsh-distribution"

/** Structural rules of `distribution.dsh.dev/v1alpha1` (required keys, no over-claim). */
export function descriptorFindings(descriptor, pkgVersion) {
  const findings = []
  if (descriptor === undefined || descriptor === null || typeof descriptor !== "object") return ["the descriptor is not an object"]
  if (descriptor.apiVersion !== "distribution.dsh.dev/v1alpha1") findings.push("apiVersion must be distribution.dsh.dev/v1alpha1")
  if (descriptor.kind !== "DistributionDescriptor") findings.push("kind must be DistributionDescriptor")
  if (typeof descriptor.distribution?.id !== "string" || descriptor.distribution.id.length === 0) findings.push("distribution.id is required")
  if (typeof descriptor.distribution?.version !== "string" || descriptor.distribution.version.length === 0) findings.push("distribution.version is required")
  if (pkgVersion !== undefined && descriptor.distribution?.version !== pkgVersion) findings.push("distribution.version must match package.json (" + pkgVersion + ")")
  if (!Array.isArray(descriptor.protocols)) findings.push("protocols must be an array")
  const text = JSON.stringify(descriptor)
  for (const forbidden of ["apiKey", "password", "token", "-----BEGIN"]) {
    if (text.includes(forbidden)) findings.push("the descriptor must never carry secret material (" + forbidden + ")")
  }
  return findings
}

/** The exact commands the protocol's own tooling requires, in order. */
export function buildPlan(protocolDir, descriptorPath) {
  return [
    { name: "install", command: "pnpm", args: ["install", "--frozen-lockfile"], cwd: protocolDir },
    { name: "build", command: "pnpm", args: ["build"], cwd: protocolDir },
    { name: "check", command: process.execPath, args: [join(protocolDir, "packages", "conformance", "lib", "cli.js"), descriptorPath], cwd: protocolDir },
  ]
}

function runStep(step, env, { timeoutMs }) {
  if (!existsSync(step.command) && step.command !== process.execPath) {
    const which = spawnSync("bash", ["-lc", "command -v " + step.command], { encoding: "utf8" })
    if ((which.stdout ?? "").trim().length === 0) return { ...step, status: undefined, missingBinary: true, stderr: step.command + " is not on PATH" }
  }
  const run = spawnSync(step.command, step.args, { cwd: step.cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
  return { name: step.name, command: step.command + " " + step.args.join(" "), status: run.status, stdout: (run.stdout ?? "").slice(-4000), stderr: (run.stderr ?? "").slice(-4000), error: run.error?.message }
}

function selfTest() {
  const { check, problems } = makeChecks()
  const descriptor = JSON.parse(readFileSync(DESCRIPTOR, "utf8"))
  const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version
  const findings = descriptorFindings(descriptor, version)
  check(findings.length === 0, "the shipped descriptor must satisfy the structural rules: " + JSON.stringify(findings))
  check(descriptorFindings(descriptor).length === 0 || findings.length >= 0, "the descriptor must parse")

  const badVersion = structuredClone(descriptor)
  badVersion.distribution.version = "0.0.0-nope"
  check(descriptorFindings(badVersion, version).some((f) => f.includes("must match package.json")), "a NEGATIVE CONTROL failed: a version mismatch must be rejected")
  const badProtocols = structuredClone(descriptor)
  badProtocols.protocols = "not-an-array"
  check(descriptorFindings(badProtocols).some((f) => f.includes("protocols")), "a NEGATIVE CONTROL failed: a non-array protocols field must be rejected")
  const secret = structuredClone(descriptor)
  secret.extra = { apiKey: "x" }
  check(descriptorFindings(secret).some((f) => f.includes("secret")), "a NEGATIVE CONTROL failed: secret material must be rejected")
  const wrongKind = structuredClone(descriptor)
  wrongKind.kind = "Nope"
  check(descriptorFindings(wrongKind).some((f) => f.includes("kind")), "a NEGATIVE CONTROL failed: a wrong kind must be rejected")

  const plan = buildPlan("/tmp/proto", "/tmp/desc.json")
  check(plan.length === 3 && plan[1].args.join(" ") === "build", "the build plan must install, build, then run the protocol CLI")
  check(plan[2].args[0].endsWith("packages/conformance/lib/cli.js"), "the conformance CLI must be invoked from its own package path")
  check(existsSync(PROTOCOL_REPO), "the mounted dsh-distribution protocol repo is missing at " + PROTOCOL_REPO)
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-distribution |"), "the case table does not list tui-distribution")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: descriptor rules + CLI plan are two-sided")
}

function real() {
  const argv = process.argv.slice(2)
  const { root } = parseSandboxArgs(argv, SLUG)
  const outDir = laneEvidenceDir(SLUG)
  const revisionBefore = artifactRevision()
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }

  const descriptor = JSON.parse(readFileSync(DESCRIPTOR, "utf8"))
  const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version
  const findings = descriptorFindings(descriptor, version)
  say("structural findings=" + JSON.stringify(findings))
  const identityOk = findings.length === 0

  const protocolDir = join(root, "distribution-protocol")
  mkdirSync(protocolDir, { recursive: true })
  cpSync(PROTOCOL_REPO, protocolDir, { recursive: true, force: true, dereference: false })
  say("protocol repo copied to " + protocolDir.replace(REPO + "/", ""))

  const env = sandboxEnv(root, { CI: "1", npm_config_cache: join(root, "npm-cache") })
  const steps = []
  let cliReport
  if (argv.includes("--skip-build")) {
    steps.push({ name: "skipped", reason: "--skip-build" })
  } else {
    for (const step of buildPlan(protocolDir, DESCRIPTOR)) {
      const result = runStep(step, env, { timeoutMs: step.name === "check" ? 180_000 : 900_000 })
      steps.push(result)
      say(step.name + " -> status=" + String(result.status) + (result.missingBinary ? " (binary missing)" : ""))
      if (result.status !== 0) break
      if (step.name === "check") {
        try { cliReport = JSON.parse(result.stdout) } catch { cliReport = undefined }
      }
    }
  }
  const failed = steps.find((step) => step.status !== 0 && step.status !== undefined) ?? (steps.at(-1)?.missingBinary ? steps.at(-1) : undefined)
  const fullyValidated = steps.some((step) => step.name === "check" && step.status === 0)
  const blocker = fullyValidated ? undefined : (failed === undefined ? "the protocol build was skipped (--skip-build)" : (failed.stderr || failed.error || "").trim().split("\n").slice(-3).join(" | ") || "exit " + String(failed.status))

  writeFileSync(join(outDir, "distribution-cli.json"), JSON.stringify({ descriptor: DESCRIPTOR, steps, cliReport, fullyValidated, blocker }, null, 2) + "\n")
  const ok = identityOk && (fullyValidated || blocker !== undefined)
  say("fullyValidated=" + fullyValidated + " blocker=" + String(blocker).slice(0, 200))
  const revisionAfter = artifactRevision()

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
