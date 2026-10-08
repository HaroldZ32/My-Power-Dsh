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
// PREREQ: absent-runtime dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.14.0"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-admission.ts --self-test
//   bun skills/dsh-qa/scripts/tui-admission.ts [--sandbox-root <dir>] [--static-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,admission-static.json,plugins-check.pane.txt}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, manifestDigest, classifyAdmissionPane, emitMarker, gateTuiPrereqs, laneEvidenceDir, makeChecks, parseSandboxArgs,
  profileState, resolveHostRoot, resolveSpecDataRoot, runTuiSession, sha256File, specDataRootCandidates, structuralFindings, tuiPrereqs,
  writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { SpecDataRoot } from "./lib/tui-lane.ts"

/** The case slug: names the evidence dir, the tmux socket and every marker/output line. */
const SLUG = "tui-admission"
/** Absolute path of the bundle-level manifest the host's own admission algorithm is run against. */
const MANIFEST = join(REPO, "dsh-plugin.json")

/** One `requires.contracts[]` entry of the manifest as the falsifiability controls mutate it in place. */
interface RawContract {
  /** The contract kind; the required-decision control matches `DecisionEvents` inside it. */
  kind?: unknown
  /** True when the contract may be absent — the fallback controls key on this flag. */
  optional?: unknown
  /** The written degraded-mode fallback the optional-without-fallback control deletes. */
  fallback?: unknown
  /** Any further key the producer carries; the controls never read it. */
  [key: string]: unknown
}

/** The `requires` block as the controls mutate it (v0.15 removed `services`). */
interface RawRequires {
  /** The declared contracts; each control clones the document and edits these in place. */
  contracts: RawContract[]
  /** Present only on a violation — `requires.services` was removed in v0.15. */
  services?: unknown
  /** Any further key the producer carries; the controls never read it. */
  [key: string]: unknown
}

/** The facet declarations as the controls mutate them. */
interface RawFacets {
  /** The host facet, which every valid manifest must declare. */
  host?: unknown
  /** The client facet, rejected in v0.15 — the control adds it to prove the rejection. */
  client?: unknown
  /** The worker facet, rejected in v0.15. */
  worker?: unknown
  /** Any further facet key the producer carries. */
  [key: string]: unknown
}

/** One `permissions[]` row as the unknown-permission control rewrites it. */
interface RawPermission {
  /** The permission name the registry validates against. */
  name?: unknown
  /** The scope the permission is declared for. */
  scope?: unknown
  /** Any further key the producer carries. */
  [key: string]: unknown
}

/**
 * The parsed manifest as DATA, mutable enough for each control to clone and edit it, and
 * shaped so every field a control touches is present without a cast.
 */
interface RawManifest {
  /** The declared facets; the client-facet control adds `client` here. */
  facets: RawFacets
  /** The declared requirements; the provided/required controls edit these blocks. */
  requires: RawRequires
  /** The declared permissions; the unknown-permission control rewrites the first row. */
  permissions: RawPermission[]
  /** Present only on a violation — `provides` was removed from the v0.15 schema. */
  provides?: unknown
  /** Any further key the producer carries; the controls never read it. */
  [key: string]: unknown
}

/** One contract row of the host-parsed manifest, in the subset this lane projects. */
interface ParsedContract {
  /** The contract apiVersion, the first half of the recorded `apiVersion#kind` identity. */
  readonly apiVersion?: unknown
  /** The contract kind, the second half of the recorded identity. */
  readonly kind?: unknown
  /** True when the contract may be absent — such a contract needs a written fallback. */
  readonly optional?: unknown
  /** Any further key the host's parser carries; unread by this lane. */
  readonly [key: string]: unknown
}

/** The `requires` block of the host-parsed manifest. */
interface ParsedRequires {
  /** The declared contracts, each projected to `apiVersion#kind`. */
  readonly contracts: readonly ParsedContract[]
}

/** One permission row of the host-parsed manifest. */
interface ParsedPermission {
  /** The permission name, projected as the left half of `name@scope`. */
  readonly name: unknown
  /** The permission scope, projected as the right half of `name@scope`. */
  readonly scope: unknown
}

/** The host-parsed manifest, in the subset this lane reads for its recorded projection. */
interface ParsedManifest {
  /** The plugin id the registry keys on. */
  readonly id: unknown
  /** The manifest schema version. */
  readonly manifestVersion: unknown
  /** The facet declarations; the host entry point is resolved and digested from here. */
  readonly facets: {
    /** The host facet, whose entry point the host's own validator checks. */
    readonly host: {
      /** Repo-relative entry point of the host facet. */
      readonly entry: string
      /** The host facet's declared apiVersion. */
      readonly apiVersion: unknown
    }
  }
  /** The declared requirements. */
  readonly requires: ParsedRequires
  /** The declared permissions. */
  readonly permissions: readonly ParsedPermission[]
  /** The declared subscriptions, recorded verbatim. */
  readonly subscriptions: unknown
}

/** The options the host's own `parseManifest` accepts from this lane. */
interface ManifestParseOptions {
  /** The producer label the host records for the parse. */
  readonly source?: string
}

/** The community registry document the host validates against, in the subset this lane reads. */
interface SpecRegistry {
  /** Every facet API version the profile admits, spread into the host model. */
  readonly facetApiVersions: readonly unknown[]
  /** The declared profile version, recorded as the spec-data identity. */
  readonly profileVersion: unknown
}

/** The host's spec-data bundle: the community registry plus the permissions it validates against. */
interface SpecData {
  /** The community registry document. */
  readonly registry: SpecRegistry
  /** The permission table the registry validates against. */
  readonly permissions: unknown
  /** Absolute directory of the spec-data root the bundle was read from. */
  readonly dir: string
}

/** One entry of the host's own registry driver set. */
interface RegistryEntry {
  /** The entry name, matched against the lane's driver set. */
  readonly name: string
  /** The entry's coordinates, projected into the host model. */
  readonly coordinates: {
    /** The entry's contract apiVersion. */
    readonly apiVersion: unknown
    /** The entry's contract kind. */
    readonly kind: unknown
  }
  /** The permissions this entry declares. */
  readonly permissions: readonly unknown[]
}

/** The host model handed to the host's own `negotiate()` — the facet/contract surface being negotiated. */
interface HostModel {
  /** The host id the negotiation is run for. */
  readonly hostId: string
  /** Every facet API version the registry admits. */
  readonly facetApiVersions: unknown[]
  /** One projected contract per registry entry the driver set selects. */
  readonly contracts: {
    /** The selected entry's contract apiVersion. */
    readonly apiVersion: unknown
    /** The selected entry's contract kind. */
    readonly kind: unknown
    /** The selected entry's declared permissions. */
    readonly permissions: unknown[]
  }[]
}

/** The absent-host arm of the static check: a named reason and no measurement at all. */
interface HostAdmissionMissing {
  /** Always false: the installed payload or the spec-data root was not found. */
  readonly ok: false
  /** The one-line reason the static arm reports instead of running. */
  readonly reason: string
}

/** The loaded arm: the host root, the resolved spec root and the host's own pinned entry points. */
interface HostAdmissionLoaded {
  /** Always true: the host payload and its spec-data root both resolved. */
  readonly ok: true
  /** Absolute root of the installed `@deepseek-harness-tui/dsh-tui` payload. */
  readonly hostRoot: string
  /** The spec-data root the running host itself resolves. */
  readonly spec: SpecDataRoot
  /** The host's own pinned manifest parser. */
  readonly parseManifest: (source: string, options?: ManifestParseOptions) => ParsedManifest
  /** The host's own manifest projection. */
  readonly projectManifest: (manifest: ParsedManifest) => unknown
  /** The host's own spec-data loader; `undefined` when the registry does not resolve. */
  readonly loadSpecData: () => SpecData | undefined
  /** The host's own registry driver set, used to derive the host model. */
  readonly registryEntries: (registry: unknown) => RegistryEntry[]
  /** The host's own contract-index builder. */
  readonly createContractIndex: (registry: unknown, permissions: unknown) => unknown
  /** The host's own manifest validator, throwing on the first violation. */
  readonly validatePlugin: (index: unknown, manifest: ParsedManifest) => void
  /** The host's own five-state negotiation. */
  readonly negotiate: (index: unknown, manifest: ParsedManifest, model: HostModel, grants: readonly unknown[]) => unknown
}

/** The two arms `loadHostAdmission` can report. */
type HostAdmission = HostAdmissionMissing | HostAdmissionLoaded

/** The manifest fields this lane records for the reviewer, already projected to strings. */
interface RecordedManifest {
  /** The plugin id the registry keys on. */
  readonly id: unknown
  /** The manifest schema version. */
  readonly manifestVersion: unknown
  /** The host facet's entry point, later resolved against the repo root. */
  readonly entry: string
  /** The host facet's declared apiVersion. */
  readonly apiVersion: unknown
  /** Every REQUIRED contract, as `apiVersion#kind`. */
  readonly requiredContracts: string[]
  /** Every OPTIONAL contract, as `apiVersion#kind`. */
  readonly optionalContracts: string[]
  /** Every declared permission, as `name@scope`. */
  readonly permissions: string[]
  /** The declared subscriptions, recorded verbatim. */
  readonly subscriptions: unknown
}

/** The structural-rule record written beside the host's own verdict. */
interface RecordedStructural {
  /** Every community-v0.15 structural-rule violation this lane asserts; empty is the pass. */
  readonly findings: string[]
  /** True when the host entry point the manifest names exists in the repo. */
  readonly entryExists: boolean
  /** `sha256:<hex>` digest of that entry point, `undefined` when it does not exist. */
  readonly entrySha256: string | undefined
  /** The per-rule booleans (`provides`, `requires.services`) spread in from the rule table. */
  readonly [key: string]: unknown
}

/** The digests of every input the static verdict rests on, so the run can be re-checked. */
interface RecordedInputDigests {
  /** `sha256:<hex>` of the bundle-level `dsh-plugin.json`. */
  readonly manifest: string
  /** `sha256:<hex>` of the host's pinned `@dsh-std/manifest` parser. */
  readonly manifestLib: string
  /** `sha256:<hex>` of the host's pinned manifest JSON schema. */
  readonly manifestSchema: string
  /** `sha256:<hex>` of the community registry the host validates against. */
  readonly registry: string
  /** `sha256:<hex>` of that registry's permission table. */
  readonly permissions: string
  /** One digest per spec schema read, `sha256` absent when this host does not carry the schema. */
  readonly schemas: {
    /** The schema file name. */
    readonly name: string
    /** `sha256:<hex>` of that schema, `undefined` when the file is absent. */
    readonly sha256: string | undefined
  }[]
  /** The registry's declared profile version, recorded as the spec-data identity. */
  readonly specProfileVersion: unknown
}

/** The measured static-admission record written to `admission-static.json`. */
interface StaticAdmissionRecord {
  /** True only when the host parsed, projected, validated and negotiated the manifest. */
  ok: boolean
  /** Which producer offered the spec-data root (`installed-payload` | `user-checkout`). */
  specRoot: string
  /** Absolute directory of the spec-data root the host resolved. */
  specDir: string
  /** The registry's declared profile version. */
  profileVersion: unknown
  /** `"ok"` once the host's own parser accepted the manifest. */
  parse?: string
  /** The host's own projection of the manifest. */
  projected?: unknown
  /** The manifest fields recorded for the reviewer. */
  manifest?: RecordedManifest
  /** The community-v0.15 structural findings plus the entry digest. */
  structural?: RecordedStructural
  /** `"ok"` once the host's own validator accepted the manifest. */
  validatePlugin?: string
  /** The host's own five-state negotiation result. */
  negotiation?: unknown
  /** The failure thrown by the host's own implementation, on the red arm. */
  error?: {
    /** The thrown value's `name`, when it carries one. */
    readonly name: unknown
    /** The thrown value's message, always stringified. */
    readonly message: string
  }
  /** The three falsifiability controls run on the SAME pinned implementation. */
  controls?: Record<string, string>
  /** The digests of every input the verdict rests on. */
  inputDigests?: RecordedInputDigests
  /** Present on the absent-host arm: the one-line reason the check could not run. */
  reason?: string
}

/** The two arms `staticAdmission` can report: the absent host, or the measured record. */
type StaticAdmission = HostAdmissionMissing | StaticAdmissionRecord

/**
 * Load the host's own pinned admission implementation (never a re-implementation).
 * @returns The loaded entry points plus the resolved host/spec roots, or the named reason it could not load.
 */
async function loadHostAdmission(): Promise<HostAdmission> {
  /** The installed payload root, `undefined` when no `dsh-tui` host resolves on this machine. */
  const hostRoot = resolveHostRoot()
  if (hostRoot === undefined) return { ok: false, reason: "the installed @deepseek-harness-tui/dsh-tui payload was not found (set DSH_TUI_ROOT)" }
  /** The spec-data root the running host itself resolves, `undefined` when this host carries none. */
  const spec = resolveSpecDataRoot(hostRoot)
  if (spec === undefined) return { ok: false, reason: "no spec-data root with registry/registry-0.15.json (installed payload or the d248c267 checkout)" }
  /** Spell one host-relative module path as a file URL the dynamic import can resolve. */
  const url = (relative: string): string => "file://" + join(hostRoot, relative)
  /** Absolute path of the vendored `@dsh-std/manifest` parser the host itself loads. */
  const manifestLibPath = join(hostRoot, "node_modules", "@dsh-std", "manifest", "lib", "index.js")
  if (!existsSync(manifestLibPath)) return { ok: false, reason: "the vendored @dsh-std/manifest parser is missing at " + manifestLibPath }
  /** The host's own pinned manifest parser and projection. */
  const { parseManifest, projectManifest } = await import(url("node_modules/@dsh-std/manifest/lib/index.ts"))
  /** The host's own spec-data loader and registry driver set. */
  const { loadSpecData, registryEntries } = await import(url("lib/types/adapter/standard/registry.js"))
  /** The host's own contract index, validator and five-state negotiation. */
  const { createContractIndex, validatePlugin, negotiate } = await import(url("lib/types/adapter/standard/admission.js"))
  return { ok: true, hostRoot, spec, parseManifest, projectManifest, loadSpecData, registryEntries, createContractIndex, validatePlugin, negotiate }
}

/**
 * Host model derived from the vendored registry through the host's own driver set.
 * @param registryEntries The host's own registry driver set; only names in `driverSet` are selected.
 * @param data The host's loaded spec-data bundle the entries are read from.
 * @param driverSet The contract names this lane negotiates for; defaults to the four seams the TUI plugin declares.
 * @returns The host model `negotiate()` consumes, in the host's own shape.
 */
export function hostModel(registryEntries: (registry: unknown) => RegistryEntry[], data: SpecData, driverSet: readonly string[] = ["commands", "storage.local", "messages.observe", "tui.decision-events"]): HostModel {
  /** The driver names selected for this negotiation, as a set for the O(1) filter below. */
  const set = new Set(driverSet)
  return {
    hostId: "dsh-tui",
    facetApiVersions: [...data.registry.facetApiVersions],
    contracts: registryEntries(data.registry)
      .filter((entry) => set.has(entry.name))
      .map((entry) => ({ apiVersion: entry.coordinates.apiVersion, kind: entry.coordinates.kind, permissions: [...entry.permissions] })),
  }
}

/**
 * Run the host's own parser, projection, validator and negotiation against the shipped manifest,
 * then run three controls on the SAME implementation to prove the checks are falsifiable.
 * @param outDir Evidence directory the `admission-static.json` record is written into.
 * @param log Line sink the caller prints; one summary line is appended.
 * @returns The measured record, or the named reason the host implementation could not be loaded.
 */
async function staticAdmission(outDir: string, log: string[]): Promise<StaticAdmission> {
  /** The host's own pinned implementation, or the named reason it is absent on this machine. */
  const host = await loadHostAdmission()
  if (!host.ok) return { ok: false, reason: host.reason }
  /** The host's spec-data bundle; `undefined` when the registry does not resolve on this host. */
  const data = host.loadSpecData()
  if (data === undefined) return { ok: false, reason: "loadSpecData() returned undefined (the spec registry did not resolve)" }
  /** The contract index the host's own validator and negotiator run against. */
  const index = host.createContractIndex(data.registry, data.permissions)
  /** The shipped manifest's bytes, digested below and parsed by the host's own parser. */
  const source = readFileSync(MANIFEST, "utf8")
  /** The record under construction; every field is filled in place so a mid-way throw still records what ran. */
  const result: StaticAdmissionRecord = { ok: true, specRoot: host.spec.kind, specDir: host.spec.dir, profileVersion: data.registry.profileVersion }
  try {
    /** The host's own parse of the shipped manifest — never this lane's JSON.parse. */
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
      ...Object.fromEntries(["provides", "requires.services"].map((key): [string, boolean] => [key, false])),
      findings: structuralFindings(JSON.parse(source)),
      entryExists: existsSync(join(REPO, manifest.facets.host.entry)),
      entrySha256: existsSync(join(REPO, manifest.facets.host.entry)) ? sha256File(join(REPO, manifest.facets.host.entry)) : undefined,
    }
    host.validatePlugin(index, manifest)
    result.validatePlugin = "ok"
    result.negotiation = host.negotiate(index, manifest, hostModel(host.registryEntries, data), [])
  } catch (error) {
    result.ok = false
    // The thrown value is `unknown`: the cast states the Error-ish shape the original JS read off it,
    // so `name`/`message` stay reachable without changing what is stringified.
    result.error = { name: (error as { name?: unknown })?.name, message: String((error as { message?: unknown })?.message ?? error) }
  }

  // Controls: the checks above must be falsifiable on the SAME pinned implementation.
  /** The shipped manifest as raw data, the base every control clones before it mutates one rule. */
  const raw: RawManifest = JSON.parse(source)
  /** One entry per control, holding either the thrown failure's name/message or `UNEXPECTED PASS`. */
  const controls: Record<string, string> = {}
  try { host.parseManifest("{ not json", { source: "control-syntax" }); controls.brokenSyntax = "UNEXPECTED PASS" }
  // The thrown value is `unknown`: the cast states the shape whose `name` the control records.
  catch (error) { controls.brokenSyntax = String((error as { name?: unknown })?.name ?? "Error") }
  try {
    /** A clone with the optional contract's written fallback removed, which the host must reject. */
    const noFallback = structuredClone(raw)
    /** The first optional contract of the clone; the shipped manifest declares exactly one. */
    const optional = noFallback.requires.contracts.find((entry) => entry.optional === true)
    // The shipped manifest guarantees an optional contract; `!` states that invariant to the checker
    // without adding a runtime branch the original code did not have.
    delete optional!.fallback
    host.validatePlugin(index, host.parseManifest(JSON.stringify(noFallback)))
    controls.optionalWithoutFallback = "UNEXPECTED PASS"
  } catch (error) { controls.optionalWithoutFallback = String((error as { message?: unknown })?.message ?? error) }
  try {
    /** A clone whose first permission name is unregistered, which the host must reject. */
    const badPermission = structuredClone(raw)
    badPermission.permissions[0].name = "mpd-dsh.not-a-registered-permission"
    host.validatePlugin(index, host.parseManifest(JSON.stringify(badPermission)))
    controls.unknownPermission = "UNEXPECTED PASS"
  } catch (error) { controls.unknownPermission = String((error as { message?: unknown })?.message ?? error) }
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

/** The offline arm: the structural rules, the pane classifier and the spec-root resolution, each with its negative control. */
function selfTest(): void {
  /** The bound assertion collector and its failure list; empty at the end means the arm is green. */
  const { check, problems } = makeChecks()
  /** The shipped manifest as raw data, the base every negative control clones before it mutates one rule. */
  const manifest: RawManifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
  check(structuralFindings(manifest).length === 0, "the shipped manifest must satisfy the structural rules: " + JSON.stringify(structuralFindings(manifest)))

  /** A clone carrying the removed-in-v0.15 `provides` key, which must be rejected. */
  const withProvides = structuredClone(manifest)
  withProvides.provides = { services: [] }
  check(structuralFindings(withProvides).some((f) => f.includes("provides")), "a NEGATIVE CONTROL failed: `provides` must be rejected")
  /** A clone carrying the removed-in-v0.15 `requires.services` key, which must be rejected. */
  const withServices = structuredClone(manifest)
  withServices.requires.services = []
  check(structuralFindings(withServices).some((f) => f.includes("requires.services")), "a NEGATIVE CONTROL failed: `requires.services` must be rejected")
  /** A clone whose decision-event contract is made REQUIRED, which must be rejected. */
  const requiredDecision = structuredClone(manifest)
  for (const contract of requiredDecision.requires.contracts) if (String(contract.kind).includes("DecisionEvents")) delete contract.optional
  check(structuralFindings(requiredDecision).some((f) => f.includes("OPTIONAL")), "a NEGATIVE CONTROL failed: a required decision-event contract must be rejected")
  /** A clone whose optional contract lost its written fallback, which must be rejected. */
  const noFallback = structuredClone(manifest)
  for (const contract of noFallback.requires.contracts) if (contract.optional === true) delete contract.fallback
  check(structuralFindings(noFallback).some((f) => f.includes("fallback")), "a NEGATIVE CONTROL failed: an optional contract without a fallback must be rejected")
  /** A clone carrying a client facet, which the v0.15 schema rejects. */
  const clientFacet = structuredClone(manifest)
  clientFacet.facets.client = {}
  check(structuralFindings(clientFacet).some((f) => f.includes("client/worker")), "a NEGATIVE CONTROL failed: a client facet must be rejected")

  /** The accepted arm: a plain compatible negotiation. */
  const accepted = classifyAdmissionPane("Negotiation decision: compatible")
  /** The accepted arm: a degraded-compatible negotiation naming what is missing. */
  const degraded = classifyAdmissionPane("Negotiation decision: compatible_degraded (missingOptional: x)")
  /** The accepted arm: an explainable authorization wait, which is reported and never upgraded. */
  const waiting = classifyAdmissionPane("Negotiation decision: waiting_authorization (PERMISSION_NOT_GRANTED: session.input.intercept)")
  check(accepted.ok && degraded.ok && waiting.ok, "the three explainable states must be accepted")
  // Every forbidden failure family must redden the classifier, one marker at a time.
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
  /** The installed host payload root, `undefined` when no `dsh-tui` host resolves here. */
  const hostRoot = resolveHostRoot()
  /** Every spec-data root candidate this host offers, in resolution order. */
  const specCandidates = specDataRootCandidates(hostRoot)
  /** The spec-data root the host itself resolves, `undefined` when no candidate carries the registry. */
  const spec = resolveSpecDataRoot(hostRoot)
  if (spec === undefined && !specCandidates.some((candidate) => existsSync(candidate.dir))) {
    /** True when the caller asked for a FAIL instead of this legitimate SKIP. */
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
  /** Absolute path of the skill's case table, which must list this lane. */
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-admission |"), "the case table does not list tui-admission")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: structural rules, pane classification and spec-root resolution are two-sided")
}

/** The live arm: the static check, then the host's own `/plugins check` driven inside a real TUI. */
async function real(): Promise<void> {
  /** Every argument after the script path, so the parser and the flags see the same list. */
  const argv = process.argv.slice(2)
  /** The resolved sandbox root the whole run happens inside. */
  const { root } = parseSandboxArgs(argv, SLUG)
  /** The evidence directory this run writes into (created by `laneEvidenceDir`). */
  const outDir = laneEvidenceDir(SLUG)
  /** The dist revision before the run, re-measured at evidence-write time. */
  const revisionBefore = artifactRevision()
  /** Every progress line, joined and written as `output.log` at the end. */
  const log: string[] = []
  /** Append one line to the log and echo it with the lane prefix. */
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }

  /** The static-admission record the live arm is combined with. */
  const stat = await staticAdmission(outDir, log)
  say("static result ok=" + stat.ok + (stat.reason === undefined ? "" : " reason=" + stat.reason))

  if (argv.includes("--static-only")) {
    /** The verdict of a static-only run: the host's own algorithm accepted the shipped manifest. */
    const ok = stat.ok === true
    /** The dist revision at evidence-write time, compared with the start-of-run reading. */
    const revisionAfter = artifactRevision()
    /** The digest comparison the REVISION.json records; a change voids this run. */
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

  /** The sandbox `dsh-tui` profile facts the prerequisite gate is decided from. */
  const state = profileState(root)
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }))
  /** The one real TUI lifecycle: boot, drive both plugin commands, capture, kill. */
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
  /** The `/plugins check` pane text; empty when the step never produced a capture. */
  const checkPane = session.panes.find((pane) => pane.name === "plugins-check")?.text ?? ""
  /** The five-state verdict the host's own pane advertises, with every forbidden marker it carried. */
  const classification = classifyAdmissionPane(checkPane)
  say("live /plugins check -> state=" + String(classification.state) + " ok=" + classification.ok + " forbidden=" + JSON.stringify(classification.forbidden))

  /** The lane verdict: the static admission AND the live pane both passed. */
  const ok = stat.ok === true && classification.ok
  /** The dist revision at evidence-write time, compared with the start-of-run reading. */
  const revisionAfter = artifactRevision()
  /** The digest comparison the REVISION.json records; a change voids this run. */
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
/** True only when this module is the process entry point, never when it is imported. */
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else await real()
}
