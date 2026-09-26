#!/usr/bin/env bun
// Case tui-admission: the host's OWN admission algorithm against the bundle-level
// `dsh-plugin.json` — static (pinned vendored parser + projection + profile/registry
// validation + five-state negotiation) AND live (the host's own
// `/plugins check <abs path>` driven inside a real TUI), with input digests recorded.
//
// Nothing here is a re-implementation: `@dsh-std/manifest` and
// `lib/types/adapter/standard/{registry,admission}.js` are the INSTALLED host's own
// pinned code, and the spec-data root is asserted to be defined before any verdict
// is emitted (AC-8). `.mpd/recon/dsh-TUI/` is never used — that clone's
// `dsh-ecosystem-spec/` is empty (its submodules were never initialised).
//
// Accepted live pane states (AC-9): `compatible`, `compatible_degraded`, or the
// explainable `waiting_authorization` (a declared permission is deny-defaulted with
// no grant row — `negotiate()` → PERMISSION_NOT_GRANTED). The
// invalid-json / schema-failed / semantic-invalid / spec-unavailable family FAILS.
//
// PREREQ: absent-runtime dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-admission.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-admission.mjs [--sandbox-root <dir>] [--static-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,admission-static.json,plugins-check.pane.txt}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, manifestDigest, classifyAdmissionPane, emitMarker, gateTuiPrereqs, laneEvidenceDir, makeChecks, parseSandboxArgs,
  profileState, resolveHostRoot, resolveSpecDataRoot, runTuiSession, sha256File, specDataRootCandidates, structuralFindings, tuiPrereqs,
  writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.mjs"

const SLUG = "tui-admission"
const MANIFEST = join(REPO, "dsh-plugin.json")

/** Load the host's own pinned admission implementation (never a re-implementation). */
async function loadHostAdmission() {
  const hostRoot = resolveHostRoot()
  if (hostRoot === undefined) return { ok: false, reason: "the installed @deepseek-harness-tui/dsh-tui payload was not found (set DSH_TUI_ROOT)" }
  const spec = resolveSpecDataRoot(hostRoot)
  if (spec === undefined) return { ok: false, reason: "no spec-data root with registry/registry-0.15.json (installed payload or the d248c267 checkout)" }
  const url = (relative) => "file://" + join(hostRoot, relative)
  const manifestLibPath = join(hostRoot, "node_modules", "@dsh-std", "manifest", "lib", "index.js")
  if (!existsSync(manifestLibPath)) return { ok: false, reason: "the vendored @dsh-std/manifest parser is missing at " + manifestLibPath }
  const { parseManifest, projectManifest } = await import(url("node_modules/@dsh-std/manifest/lib/index.js"))
  const { loadSpecData, registryEntries } = await import(url("lib/types/adapter/standard/registry.js"))
  const { createContractIndex, validatePlugin, negotiate } = await import(url("lib/types/adapter/standard/admission.js"))
  return { ok: true, hostRoot, spec, parseManifest, projectManifest, loadSpecData, registryEntries, createContractIndex, validatePlugin, negotiate }
}

/** Host model derived from the vendored registry through the host's own driver set. */
export function hostModel(registryEntries, data, driverSet = ["commands", "storage.local", "messages.observe", "tui.decision-events"]) {
  const set = new Set(driverSet)
  return {
    hostId: "dsh-tui",
    facetApiVersions: [...data.registry.facetApiVersions],
    contracts: registryEntries(data.registry)
      .filter((entry) => set.has(entry.name))
      .map((entry) => ({ apiVersion: entry.coordinates.apiVersion, kind: entry.coordinates.kind, permissions: [...entry.permissions] })),
  }
}

async function staticAdmission(outDir, log) {
  const host = await loadHostAdmission()
  if (!host.ok) return { ok: false, reason: host.reason }
  const data = host.loadSpecData()
  if (data === undefined) return { ok: false, reason: "loadSpecData() returned undefined (the spec registry did not resolve)" }
  const index = host.createContractIndex(data.registry, data.permissions)
  const source = readFileSync(MANIFEST, "utf8")
  const result = { ok: true, specRoot: host.spec.kind, specDir: host.spec.dir, profileVersion: data.registry.profileVersion }
  try {
    const manifest = host.parseManifest(source, { source: MANIFEST })
    result.parse = "ok"
    result.projected = host.projectManifest(manifest)
    result.manifest = {
      id: manifest.id,
      manifestVersion: manifest.manifestVersion,
      entry: manifest.facets.host.entry,
      apiVersion: manifest.facets.host.apiVersion,
      requiredContracts: manifest.requires.contracts.filter((c) => c.optional !== true).map((c) => `${c.apiVersion}#${c.kind}`),
      optionalContracts: manifest.requires.contracts.filter((c) => c.optional === true).map((c) => `${c.apiVersion}#${c.kind}`),
      permissions: manifest.permissions.map((p) => `${p.name}@${p.scope}`),
      subscriptions: manifest.subscriptions,
    }
    result.structural = {
      ...Object.fromEntries(["provides", "requires.services"].map((key) => [key, false])),
      findings: structuralFindings(JSON.parse(source)),
      entryExists: existsSync(join(REPO, manifest.facets.host.entry)),
      entrySha256: existsSync(join(REPO, manifest.facets.host.entry)) ? sha256File(join(REPO, manifest.facets.host.entry)) : undefined,
    }
    host.validatePlugin(index, manifest)
    result.validatePlugin = "ok"
    result.negotiation = host.negotiate(index, manifest, hostModel(host.registryEntries, data), [])
  } catch (error) {
    result.ok = false
    result.error = { name: error?.name, message: String(error?.message ?? error) }
  }

  // Controls: the checks above must be falsifiable on the SAME pinned implementation.
  const raw = JSON.parse(source)
  const controls = {}
  try { host.parseManifest("{ not json", { source: "control-syntax" }); controls.brokenSyntax = "UNEXPECTED PASS" }
  catch (error) { controls.brokenSyntax = String(error?.name ?? "Error") }
  try {
    const noFallback = structuredClone(raw)
    const optional = noFallback.requires.contracts.find((entry) => entry.optional === true)
    delete optional.fallback
    host.validatePlugin(index, host.parseManifest(JSON.stringify(noFallback)))
    controls.optionalWithoutFallback = "UNEXPECTED PASS"
  } catch (error) { controls.optionalWithoutFallback = String(error?.message ?? error) }
  try {
    const badPermission = structuredClone(raw)
    badPermission.permissions[0].name = "mpd-dsh.not-a-registered-permission"
    host.validatePlugin(index, host.parseManifest(JSON.stringify(badPermission)))
    controls.unknownPermission = "UNEXPECTED PASS"
  } catch (error) { controls.unknownPermission = String(error?.message ?? error) }
  result.controls = controls
  result.inputDigests = {
    manifest: sha256File(MANIFEST),
    manifestLib: sha256File(join(host.hostRoot, "node_modules", "@dsh-std", "manifest", "lib", "index.js")),
    manifestSchema: sha256File(join(host.hostRoot, "node_modules", "@dsh-std", "manifest", "schema", "dsh-plugin-0.15.schema.json")),
    registry: sha256File(join(data.dir, "registry", "registry-0.15.json")),
    permissions: sha256File(join(data.dir, "registry", "permissions-0.1.json")),
    schemas: ["conformance-claim.schema.json", "effect-ledger-record.schema.json", "host-descriptor.schema.json"]
      .map((name) => ({ name, sha256: existsSync(join(data.dir, "schemas", name)) ? sha256File(join(data.dir, "schemas", name)) : undefined })),
    specProfileVersion: data.registry.profileVersion,
  }
  writeFileSync(join(outDir, "admission-static.json"), JSON.stringify(result, null, 2) + "\n")
  log.push("static admission: ok=" + result.ok + " parse=" + String(result.parse) + " validatePlugin=" + String(result.validatePlugin) + " controls=" + JSON.stringify(Object.keys(controls)))
  return result
}

function selfTest() {
  const { check, problems } = makeChecks()
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
  check(structuralFindings(manifest).length === 0, "the shipped manifest must satisfy the structural rules: " + JSON.stringify(structuralFindings(manifest)))

  const withProvides = structuredClone(manifest)
  withProvides.provides = { services: [] }
  check(structuralFindings(withProvides).some((f) => f.includes("provides")), "a NEGATIVE CONTROL failed: `provides` must be rejected")
  const withServices = structuredClone(manifest)
  withServices.requires.services = []
  check(structuralFindings(withServices).some((f) => f.includes("requires.services")), "a NEGATIVE CONTROL failed: `requires.services` must be rejected")
  const requiredDecision = structuredClone(manifest)
  for (const contract of requiredDecision.requires.contracts) if (String(contract.kind).includes("DecisionEvents")) delete contract.optional
  check(structuralFindings(requiredDecision).some((f) => f.includes("OPTIONAL")), "a NEGATIVE CONTROL failed: a required decision-event contract must be rejected")
  const noFallback = structuredClone(manifest)
  for (const contract of noFallback.requires.contracts) if (contract.optional === true) delete contract.fallback
  check(structuralFindings(noFallback).some((f) => f.includes("fallback")), "a NEGATIVE CONTROL failed: an optional contract without a fallback must be rejected")
  const clientFacet = structuredClone(manifest)
  clientFacet.facets.client = {}
  check(structuralFindings(clientFacet).some((f) => f.includes("client/worker")), "a NEGATIVE CONTROL failed: a client facet must be rejected")

  const accepted = classifyAdmissionPane("Negotiation decision: compatible")
  const degraded = classifyAdmissionPane("Negotiation decision: compatible_degraded (missingOptional: x)")
  const waiting = classifyAdmissionPane("Negotiation decision: waiting_authorization (PERMISSION_NOT_GRANTED: session.input.intercept)")
  check(accepted.ok && degraded.ok && waiting.ok, "the three explainable states must be accepted")
  for (const marker of ["Semantic validation failed: x", "Schema validation failed: x", "Not parseable JSON: x", "Vendored spec data unavailable (dsh-ecosystem-spec/); cannot validate."]) {
    check(!classifyAdmissionPane(marker).ok, "a NEGATIVE CONTROL failed: the failure family must be rejected: " + marker)
  }
  check(!classifyAdmissionPane("nothing useful here").ok, "a pane with no five-state outcome must fail")

  // The spec-data root is an EXTERNAL fixture: the installed TUI payload carries the copy the
  // running host resolves, and `resolveSpecCheckout()` names the operator's own checkout. A host
  // with NEITHER is reported as an absent fixture and SKIPPED, exactly like the lane's own prereq
  // gate (rule T8-F1: the skip is legitimate because this self-test did not ask for the fixture,
  // and `--no-skip` still forces the FAIL). When a candidate DOES exist, resolution must succeed,
  // so the assertion can never be vacuous on a host that has the data.
  const hostRoot = resolveHostRoot()
  const specCandidates = specDataRootCandidates(hostRoot)
  const spec = resolveSpecDataRoot(hostRoot)
  if (spec === undefined && !specCandidates.some((candidate) => existsSync(candidate.dir))) {
    const strict = process.argv.includes("--no-skip")
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", "dsh-ecosystem-spec with registry/registry-0.15.json", "check out the host repo with its submodules initialised, or set MPD_TUI_SPEC_ROOT")
    if (strict) problems.push("the spec-data root is absent on this host and --no-skip was requested")
  } else {
    check(spec !== undefined, "the spec-data root must resolve from the installed payload or the user checkout")
    if (spec !== undefined) {
      check(spec.registrySha256.startsWith("sha256:"), "the spec-data root must record the registry digest")
      // POSIX-spelled before the substring test: a native win32 path never contains "/".
      check(!spec.dir.split(sep).join("/").includes(".mpd/recon/dsh-TUI"), "the empty recon clone must never be the admission spec root")
    }
  }
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-admission |"), "the case table does not list tui-admission")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: structural rules, pane classification and spec-root resolution are two-sided")
}

async function real() {
  const argv = process.argv.slice(2)
  const { root } = parseSandboxArgs(argv, SLUG)
  const outDir = laneEvidenceDir(SLUG)
  const revisionBefore = artifactRevision()
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }

  const stat = await staticAdmission(outDir, log)
  say("static result ok=" + stat.ok + (stat.reason === undefined ? "" : " reason=" + stat.reason))

  if (argv.includes("--static-only")) {
    const ok = stat.ok === true
    const revisionAfter = artifactRevision()
    const { delta } = writeRevisionFile(outDir, {
      before: revisionBefore,
      after: revisionAfter,
      composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui" },
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
      steps: { static: stat },
      sandboxRoot: "not used (--static-only)",
    }, log.join("\n"))
    process.exit(ok ? 0 : 1)
  }

  const state = profileState(root)
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }))
  const session = runTuiSession({
    lane: SLUG,
    root,
    outDir,
    bootWaitMs: 90_000,
    steps: [
      { name: "plugins-check", keys: ["/plugins check " + MANIFEST, "Enter"], waitMs: 20_000 },
      { name: "plugins-descriptor", keys: ["/plugins", "Enter"], waitMs: 15_000 },
    ],
  })
  for (const failure of session.failures) say("tmux: " + failure)
  const checkPane = session.panes.find((pane) => pane.name === "plugins-check")?.text ?? ""
  const classification = classifyAdmissionPane(checkPane)
  say("live /plugins check -> state=" + String(classification.state) + " ok=" + classification.ok + " forbidden=" + JSON.stringify(classification.forbidden))

  const ok = stat.ok === true && classification.ok
  const revisionAfter = artifactRevision()
  const { delta } = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui" },
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
    steps: { static: stat, live: classification },
    sandboxRoot: root,
    manifestPath: MANIFEST,
    livePane: "plugins-check.pane.txt",
    descriptorPane: "plugins-descriptor.pane.txt",
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ static: stat.ok, live: classification }).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: host-parsed, projected, validated, negotiated and live-checked")
}

// Entry guard: importing this lane (e.g. to reuse findModelEcho or the surface table)
// must never start a live run. The self-test and the real lane run only when this file IS
// the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else await real()
}
