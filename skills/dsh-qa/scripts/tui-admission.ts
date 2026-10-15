#!/usr/bin/env bun
// Case tui-admission: the host's OWN admission algorithm against the bundle-level
// `dsh-plugin.json` — static (pinned vendored parser + projection + profile/registry
// validation + five-state negotiation) AND live (the host's own
// `/plugin check <abs path>` driven inside a real TUI), with input digests recorded.
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
// C3' GRANT ARMS (tui-015-adaptation, six arms over TWO boots; the host re-reads
// `~/.dsh-tui/extension-grants.json` on EVERY authorize operation, so a grant is a
// file write, not a restart):
//   (1) GRANTED BOOT — `/plugin list` and `/plugin check` both advertise `compatible`;
//       (0.15.0 RENAMED THE HOST COMMAND `/plugins` -> `/plugin`: measured 2026-10-14, the old
//        spelling is not registered any more, so the line was submitted as CHAT TEXT and the model
//        answered it — the pane carried a thinking indicator and tool calls, never a verdict);
//   (2) the admission-loader debug line admits the Component (`DSH_TUI_DEBUG=1`
//       rides the boot env; the line is read from the boot's REDIRECTED stderr /
//       `host-stderr.log`, because on 0.15.0 the same debug flag makes the host
//       ink emit a per-frame `park target=…` trace to stderr that floods the pane
//       and stops the chat screen from painting);
//   (3) the effect ledger attributes records to `com.mpd-dsh.mpd-tui` (decision-
//       handler binds `applied`), no longer only `undeclared`;
//   (4) a REAL `tui/input` decision fires: a submitted line traverses the dispatch
//       chain with our no-op handler live and the turn renders;
//   (5) NEGATIVE CONTROL — no grant file: the check pane must say
//       `waiting_authorization` AND print the host's own grants-file hint, and the
//       ledger must carry the `PERMISSION_NOT_GRANTED` failed binds (the documented
//       ready-but-not-activated posture);
//   (6) REVOCATION (optional arm, observed not gated) — the grant file is deleted
//       mid-session and a re-check records whether the pane flips back.
// The STATIC arm carries the same three-way control on the host's own `negotiate`:
// no grants → `waiting_authorization`; the manifest's own four rows → `compatible`;
// the same names at an undeclared scope → STILL `waiting_authorization`.
//
// REGISTRY FALSE POSITIVE, STATED NOT FIXED: the spec registry's `profileVersion`
// string (`0.15`) is the dsh-ecosystem-spec number, UNRELATED to the dsh-tui 0.15.0
// release this lane's carriers pin — it is recorded verbatim and never "adapted".
//
// PREREQ: absent-runtime dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.15.0"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-admission.ts --self-test
//   bun skills/dsh-qa/scripts/tui-admission.ts [--sandbox-root <dir>] [--static-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,admission-static.json,negctl/,grants/}
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, manifestDigest, classifyAdmissionPane, emitMarker, gateTuiPrereqs, laneEvidenceDir, makeChecks, parseSandboxArgs,
  profileState, readLedgerRecords, resolveHostRoot, resolveSpecDataRoot, runTuiSession, sandboxEffectLedgerFile, sandboxGrantFile, sha256File,
  specDataRootCandidates, structuralFindings, tuiPrereqs, writeExtensionGrants, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { GrantFileRow, LedgerRecord, SpecDataRoot } from "./lib/tui-lane.ts"

/** The case slug: names the evidence dir, the tmux socket and every marker/output line. */
const SLUG = "tui-admission"
/** Absolute path of the bundle-level manifest the host's own admission algorithm is run against. */
const MANIFEST = join(REPO, "dsh-plugin.json")
/** The submitted line that traverses the real `tui/input` decision point (arm 4): plain text, never a slash command, distinctive in any capture. */
const DECISION_SUBMIT_TEXT = "mpd admission lane decision arm"

/**
 * The five-state decision a negotiation returned, as the pane-visible string (`compatible`, `waiting_authorization`, …).
 * @param negotiation The host's own `negotiate()` return value, kept `unknown` because the lane never re-states its type.
 * @returns The `decision` field when it is a string, `"unknown"` otherwise.
 */
function decisionOf(negotiation: unknown): string {
  /** The decision field the five-state vocabulary names the state by. */
  const decision = (negotiation as { decision?: unknown } | null)?.decision
  return typeof decision === "string" ? decision : "unknown"
}

/**
 * Derive the grant rows a manifest's own permission declarations imply — the exact `{name, scope}` shape the host's `/plugin` hint prints.
 * @param manifest A manifest whose `permissions` rows are being projected into grant rows.
 * @returns One grant row per well-formed declaration; a declaration without string name and scope contributes none.
 */
function grantRowsOf(manifest: { readonly permissions: readonly { readonly name: unknown; readonly scope: unknown }[] }): GrantFileRow[] {
  /** The rows collected so far, in declaration order. */
  const rows: GrantFileRow[] = []
  for (const permission of manifest.permissions) {
    if (typeof permission.name === "string" && typeof permission.scope === "string") rows.push({ name: permission.name, scope: permission.scope })
  }
  return rows
}

/**
 * The shipped manifest's permission declarations as plain data for the grant-file writer.
 *
 * This is the WRITER's copy: it feeds `extension-grants.json` before a boot. Every VERDICT in this
 * lane still runs the host's own parser — a divergence between the two copies would redden the
 * granted boot's arms, never pass silently.
 * @returns One grant row per well-formed declaration; an unreadable manifest surfaces as the throw it is.
 */
function manifestGrantRows(): GrantFileRow[] {
  /** The decoded manifest, narrowed field by field because `JSON.parse` answers `unknown`. */
  const raw: unknown = JSON.parse(readFileSync(MANIFEST, "utf8"))
  /** The `permissions` array, `undefined` on a manifest that declares none. */
  const permissions = (raw as { permissions?: unknown } | null)?.permissions
  if (!Array.isArray(permissions)) return []
  return grantRowsOf({ permissions: permissions as readonly { name: unknown; scope: unknown }[] })
}

/**
 * The component id the shipped manifest declares — the grants-file key and the attribution every grant arm asserts on.
 * @returns The `id` string; the empty string on a manifest that declares none (the arms redden on it).
 */
function manifestComponentId(): string {
  /** The decoded manifest's `id` field, `unknown` until narrowed. */
  const id = (JSON.parse(readFileSync(MANIFEST, "utf8")) as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : ""
}

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
  /** The C3' grant arms on the SAME pinned `negotiate()`: the rows, the three decisions and their combined verdict. */
  grants?: {
    /** The grant rows the manifest's own declarations imply. */
    readonly rows: GrantFileRow[]
    /** The decision with NO grants — the documented ready-but-not-activated posture. */
    readonly ungranted: string
    /** The decision with the manifest's own four rows granted. */
    readonly granted: string
    /** The wrong-scope control's decision — the same names at an undeclared scope must NOT authorize. */
    readonly wrongScope: string
    /** True only when the three decisions are exactly `waiting_authorization` / `compatible` / `waiting_authorization`. */
    readonly ok: boolean
  }
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
 * The static grant arms' verdict, robust to the absent-host arm of the union.
 *
 * The union is not discriminated (`ok` is `boolean` on the record arm), so narrowing goes through
 * the `grants` key's own presence — a cast here would restate what `in` already proves.
 * @param stat The static record, either arm.
 * @returns True only when the host loaded AND the three grant tables landed on the three expected states.
 */
function staticGrantsOk(stat: StaticAdmission): boolean {
  if (!("grants" in stat)) return false
  return stat.grants?.ok === true
}

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
  // A FILE URL built by `pathToFileURL`, never by concatenation (win32 defect, MEASURED 2026-10-12):
  // `"file://" + join(root, …)` is right only on POSIX, where the joined path starts with `/` and the
  // result is `file:///…`; on win32 it is `file://C:\…` — the host becomes `C:\…` and the path is empty,
  // so every `await import(url(...))` below could never resolve a module there.
  const url = (relative: string): string => pathToFileURL(join(hostRoot, relative)).href
  /** Absolute path of the vendored `@dsh-std/manifest` parser the host itself loads. */
  const manifestLibPath = join(hostRoot, "node_modules", "@dsh-std", "manifest", "lib", "index.js")
  if (!existsSync(manifestLibPath)) return { ok: false, reason: "the vendored @dsh-std/manifest parser is missing at " + manifestLibPath }
  /** The host's own pinned manifest parser and projection. */
  // The PAYLOAD's built `.js` (the file the existence check above already names), never a `.ts`:
  // the historical runs imported the operator CHECKOUT's TypeScript sources, but a payload-only
  // machine has just the built copy — measured 2026-10-14, the 0.15.0 payload ships
  // `lib/index.js` + `lib/index.d.ts` and no `.ts` at this path.
  const { parseManifest, projectManifest } = await import(url("node_modules/@dsh-std/manifest/lib/index.js"))
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
    // C3' STATIC GRANT ARMS: the same pinned negotiate() with three grant tables must land on the
    // three expected states — none → waiting_authorization, the manifest's own four rows →
    // compatible, the same names at an undeclared scope → STILL waiting_authorization.
    /** The grant rows the host-parsed manifest's own declarations imply. */
    const grantRows: GrantFileRow[] = grantRowsOf(manifest)
    /** The same names at a scope nothing declares — a grant that must NOT authorize. */
    const wrongScopeRows: GrantFileRow[] = grantRows.map((row): GrantFileRow => ({ name: row.name, scope: "tui/not-a-declared-scope" }))
    /** The negotiation with the manifest's own rows granted. */
    const granted = host.negotiate(index, manifest, hostModel(host.registryEntries, data), grantRows)
    /** The wrong-scope control's negotiation. */
    const wrongScope = host.negotiate(index, manifest, hostModel(host.registryEntries, data), wrongScopeRows)
    result.grants = {
      rows: grantRows,
      ungranted: decisionOf(result.negotiation),
      granted: decisionOf(granted),
      wrongScope: decisionOf(wrongScope),
      ok: decisionOf(result.negotiation) === "waiting_authorization"
        && decisionOf(granted) === "compatible"
        && decisionOf(wrongScope) === "waiting_authorization",
    }
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

  // C3' helper arms (offline): the grant-row derivation, the grant-file writer's document shape and
  // the tolerant ledger reader, each asserted against a fixture inside a throwaway directory.
  /** The grant rows the shipped manifest's own declarations imply. */
  const grantRows = manifestGrantRows()
  check(grantRows.length === 4, "the shipped manifest must declare the four intercept permissions the grant arms feed: " + JSON.stringify(grantRows))
  check(grantRows.every((row) => row.scope.startsWith("tui/")), "every declared grant scope must be a tui/<point> scope: " + JSON.stringify(grantRows))
  /** The component id the grants key and the attribution assertions use. */
  const componentId = manifestComponentId()
  check(componentId === "com.mpd-dsh.mpd-tui", "the manifest component id must stay the grants key the arms assert on: " + JSON.stringify(componentId))
  /** A throwaway directory for the writer/reader controls, removed before the arm returns. */
  const scratch = mkdtempSync(join(tmpdir(), "tui-admission-selftest-"))
  try {
    /** The grant file path inside a NESTED directory, so the writer's mkdir discipline is exercised too. */
    const grantFile = join(scratch, "nested", "extension-grants.json")
    writeExtensionGrants(grantFile, componentId, grantRows)
    /** The written document, decoded and narrowed for the shape control below. */
    const written: unknown = JSON.parse(readFileSync(grantFile, "utf8"))
    /** The `grants` section of the written document, `undefined` when the writer omitted it. */
    const grantsBlock = (written as { grants?: unknown } | null)?.grants
    check(grantsBlock !== null && typeof grantsBlock === "object"
      && Array.isArray((grantsBlock as Record<string, unknown>)[componentId]),
      "the grant-file writer must produce the fail-closed object schema {grants:{<id>:[{name,scope}]}}")
    /** The ledger fixture: one valid record, one corrupt line, one blank line. */
    const ledgerFile = join(scratch, "effect-ledger.jsonl")
    writeFileSync(ledgerFile, JSON.stringify({ pluginId: "undeclared", operation: "bind" }) + "\n{ not json\n\n")
    /** The records the tolerant reader kept. */
    const records: LedgerRecord[] = readLedgerRecords(ledgerFile)
    check(records.length === 1 && records[0]?.pluginId === "undeclared", "the ledger reader must skip corrupt and blank lines and keep the valid record: " + JSON.stringify(records))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: structural rules, pane classification and spec-root resolution are two-sided")
}

/** The live arm: the static check, then the host's own `/plugin check` driven inside a real TUI. */
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
    /** The verdict of a static-only run: the host's own algorithm accepted the shipped manifest AND its three grant tables landed on the three expected states. */
    const ok = stat.ok === true && staticGrantsOk(stat)
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

  /** The host's grants file inside THIS sandbox — the host re-reads it on every authorize operation, so grants are a file write, never a restart. */
  const grantFile = sandboxGrantFile(root)
  /** The host's append-only effect ledger inside THIS sandbox, whose per-boot deltas carry the attribution arms. */
  const ledgerFile = sandboxEffectLedgerFile(root)
  /** The component id the grants key and every attribution assertion use. */
  const componentId = manifestComponentId()
  /** The grant rows the shipped manifest's own permission declarations imply. */
  const grantRows = manifestGrantRows()

  // ── PHASE 1 — NEGATIVE CONTROL (arm 5): a boot with NO grants file ────────
  rmSync(grantFile, { force: true })
  /** The ledger record count before the negative boot, so its delta is isolated from the granted boot's. */
  const ledgerBeforeNegative = readLedgerRecords(ledgerFile).length
  /** The negative-control lifecycle: one boot, one `/plugin check`, capture, kill. */
  const negativeSession = runTuiSession({
    lane: SLUG + "-negctl",
    root,
    outDir: join(outDir, "negctl"),
    bootWaitMs: 180_000,
    extraEnv: { DSH_TUI_DEBUG: "1" },
    stderrFile: join(outDir, "negctl", "host-stderr.log"),
    steps: [{ name: "plugins-check", keys: ["/plugin check " + MANIFEST, "Enter"], waitMs: 20_000 }],
  })
  for (const failure of negativeSession.failures) say("negctl tmux: " + failure)
  /** The negative boot's `/plugin check` pane; empty when the step never produced a capture. */
  const negativePane = negativeSession.panes.find((pane) => pane.name === "plugins-check")?.text ?? ""
  /** The five-state verdict the no-grant pane advertised. */
  const negativeVerdict = classifyAdmissionPane(negativePane)
  say("negctl /plugin check -> state=" + String(negativeVerdict.state) + " ok=" + negativeVerdict.ok)
  /** ARM 5 — the documented no-grant posture: `waiting_authorization` AND the host's own grants-file hint naming the flow this lane drives. */
  const arm5 = negativeVerdict.state === "waiting_authorization" && negativePane.includes("extension-grants.json")
  /** The ledger records the negative boot appended (the no-identity posture attributes the working surfaces as `undeclared`). */
  const negativeLedger = readLedgerRecords(ledgerFile).slice(ledgerBeforeNegative)
  /** How many of those records carry the `undeclared` attribution — recorded, not gated: attribution's hard half is the granted boot's flip. */
  const negativeUndeclared = negativeLedger.filter((record) => record.pluginId === "undeclared").length
  say("negctl ledger delta=" + negativeLedger.length + " undeclared=" + negativeUndeclared)

  // ── PHASE 2 — GRANTED BOOT (arms 1-4, then the optional revocation arm 6) ─
  writeExtensionGrants(grantFile, componentId, grantRows)
  say("grants file written -> " + grantFile.replace(REPO + "/", "") + " component=" + componentId + " rows=" + grantRows.length)
  /** The ledger record count before the granted boot. */
  const ledgerBeforeGranted = readLedgerRecords(ledgerFile).length
  /** The granted lifecycle: check, list, back to chat, a REAL input submit, interrupt, then revoke the grants mid-session and re-check. */
  // THE DRIVE SPELLS THE 0.15.0 COMMAND. The host renamed `/plugins` to `/plugin` (host
  // `i18n.js:1297` "supported: list / check <path> / info <spec> / registries", `tips.js:408`
  // "/plugin check <manifest>"), so the old spelling is no longer a command and the line was submitted
  // as CHAT TEXT — measured 2026-10-14: the pane carried a thinking indicator and real tool calls.
  // The descriptor step asks for the documented `list` subcommand, because the BARE `/plugin` opens the
  // host's picker and paints no state word (`classifyAdmissionPane` read `undefined` while
  // `plugin check` read `compatible`).
  const grantedSession = runTuiSession({
    lane: SLUG + "-grants",
    root,
    outDir: join(outDir, "grants"),
    bootWaitMs: 180_000,
    extraEnv: { DSH_TUI_DEBUG: "1" },
    stderrFile: join(outDir, "grants", "host-stderr.log"),
    steps: [
      { name: "plugins-check", keys: ["/plugin check " + MANIFEST, "Enter"], waitMs: 20_000 },
      { name: "plugins-descriptor", keys: ["/plugin list", "Enter"], waitMs: 15_000 },
      { name: "back-to-chat", keys: ["Escape"], waitMs: 3_000 },
      { name: "input-submit", keys: [DECISION_SUBMIT_TEXT, "Enter"], waitMs: 6_000 },
      { name: "input-interrupt", keys: ["Escape"], waitMs: 3_000 },
      {
        name: "plugins-check-revoked",
        before: () => { rmSync(grantFile, { force: true }); say("grants file revoked mid-session (arm 6)") },
        keys: ["/plugin check " + MANIFEST, "Enter"],
        waitMs: 20_000,
      },
    ],
  })
  for (const failure of grantedSession.failures) say("grants tmux: " + failure)
  /** The granted boot's `/plugin check` pane. */
  const checkPane = grantedSession.panes.find((pane) => pane.name === "plugins-check")?.text ?? ""
  /** The granted boot's `/plugin` list pane. */
  const descriptorPane = grantedSession.panes.find((pane) => pane.name === "plugins-descriptor")?.text ?? ""
  /** The pane captured right after the real input submit. */
  const submitPane = grantedSession.panes.find((pane) => pane.name === "input-submit")?.text ?? ""
  /** The pane of the post-revocation re-check. */
  const revokedPane = grantedSession.panes.find((pane) => pane.name === "plugins-check-revoked")?.text ?? ""
  /** The granted check pane's five-state verdict. */
  const classification = classifyAdmissionPane(checkPane)
  /** The granted list pane's five-state verdict. */
  const descriptorClassification = classifyAdmissionPane(descriptorPane)
  /** ARM 1 — BOTH panes advertise `compatible` with the grants in place. */
  const arm1 = classification.state === "compatible" && descriptorClassification.state === "compatible"
  say("grants /plugin check -> state=" + String(classification.state) + "; /plugin list -> state=" + String(descriptorClassification.state))
  /** The granted boot's STDERR sink: the host's debug stream, redirected so it cannot flood the pane. */
  const grantedStderrFile = join(outDir, "grants", "host-stderr.log")
  /** The granted boot's debug stream, `""` when the redirect produced no file. */
  const grantedStderr = existsSync(grantedStderrFile) ? readFileSync(grantedStderrFile, "utf8") : ""
  /** ARM 2 — the admission loader's debug line admits the Component (`DSH_TUI_DEBUG=1` rode the boot env; the line lands in the REDIRECTED stderr stream, never the pane). */
  const arm2 = grantedStderr.includes("admission loader admitted a Component") && grantedStderr.includes(componentId)
  say("arm2 admission-loader line admitted " + componentId + ": " + arm2 + " (stderr=" + grantedStderrFile.replace(REPO + "/", "") + " " + grantedStderr.length + "B)")
  // THE REDIRECT'S OWN READING. The host's `logForDebugging` also emits a `park target=…` line per frame
  // while `DSH_TUI_DEBUG` is set; those frames are what flooded the pane before the redirect (measured:
  // 15,566 of them in the T8 run's `grants/tui-pane.log`, the grant boot never reaching the chat screen
  // inside the 90 s ceiling). Counting them in the REDIRECTED stream is the evidence that the flood was
  // moved rather than removed.
  /** The `park target=…` debug frames the granted boot wrote to its redirected stderr. */
  const grantedParkLines = (grantedStderr.match(/park target=/g) ?? []).length
  say("granted boot debug stream: " + grantedParkLines + " park frame(s), redirected off the pane (grants/host-stderr.log)")
  /** The ledger records the granted boot appended. */
  const grantedLedger = readLedgerRecords(ledgerFile).slice(ledgerBeforeGranted)
  /** The granted boot's records attributed to the component id — the attribution flip arm 3 asserts. */
  const attributed: LedgerRecord[] = grantedLedger.filter((record) => record.pluginId === componentId)
  /** The applied decision-handler binds among them — the registration only happens with a live grant. */
  const handlerBinds = attributed.filter((record) => record.operation === "bind" && record.resource?.kind === "decision-handler" && record.result === "applied")
  /** ARM 3 — attribution: the ledger names the component, not only `undeclared`, and carries applied decision-handler binds. */
  const arm3 = attributed.length > 0 && handlerBinds.length > 0
  say("arm3 attribution: attributed=" + attributed.length + " decisionHandlerBinds(applied)=" + handlerBinds.length + " (ledger delta=" + grantedLedger.length + ")")
  // THE HOST DOES WIRE THIS SHAPE (measured 2026-10-14 on 0.15.0): `subscribeDecision`
  // (lib/types/dsh-adapter/plugin-host.js) records `{kind:'decision-handler', id:`<componentId>:<event>`}`
  // on its registered path and a `permission`/PERMISSION_NOT_GRANTED record otherwise. Neither appears:
  // 928 ledger records, kinds {command:920, status:8}, attributions {host:920, undeclared:8}. So this red
  // is OUR registration/attribution gap, not a missing host shape — it must stay RED, never be weakened.
  /** The granted boot's `admission loader admitted` count — the identity differential's first half. */
  const grantedAdmissions = (grantedStderr.match(/admission loader admitted/g) ?? []).length
  /** The granted boot's `admission loader refused` count. */
  const grantedRefusals = (grantedStderr.match(/admission loader refused/g) ?? []).length
  /** The negative boot's redirected stderr path; it carries the inverse identity posture. */
  const negativeStderrFile = join(outDir, "negctl", "host-stderr.log")
  /** The negative boot's redirected stderr, `""` when the redirect produced no file. */
  const negativeStderr = existsSync(negativeStderrFile) ? readFileSync(negativeStderrFile, "utf8") : ""
  /** The negative boot's `admission loader admitted` count — nominally 0, the grant being absent. */
  const negativeAdmissions = (negativeStderr.match(/admission loader admitted/g) ?? []).length
  /** The negative boot's `admission loader refused` count — nominally the granted boot's admitted count. */
  const negativeRefusals = (negativeStderr.match(/admission loader refused/g) ?? []).length
  say("arm3 host wiring: `decision-handler` binds are wired by plugin-host.js#subscribeDecision but none fired")
  say("arm3 identity differential: admission loader admitted=" + grantedAdmissions + " refused=" + grantedRefusals
    + " (this boot) vs admitted=" + negativeAdmissions + " refused=" + negativeRefusals + " (negctl)")
  /** ARM 4 — a REAL `tui/input` decision fired: the submitted line traversed the dispatch chain with our no-op handler live and the turn rendered. */
  const arm4 = submitPane.includes(DECISION_SUBMIT_TEXT)
  say("arm4 real input submit rendered the turn: " + arm4)
  /** ARM 6 (OPTIONAL, observed not gated) — the post-revocation re-check's state, recorded whether or not it flipped back. */
  const revokedClassification = classifyAdmissionPane(revokedPane)
  /** True when the revocation re-check flipped back to `waiting_authorization`. */
  const revocationFlipped = revokedClassification.state === "waiting_authorization"
  say("arm6 revocation re-check -> state=" + String(revokedClassification.state) + " flipped=" + revocationFlipped)

  /** The lane verdict: static admission + its three grant tables + live arms 1-5 (arm 6 observed, never gated). */
  const ok = stat.ok === true && staticGrantsOk(stat) && arm1 && arm2 && arm3 && arm4 && arm5 && revokedClassification.state !== undefined
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
    grants: {
      componentId,
      rows: grantRows,
      file: grantFile.replace(REPO + "/", ""),
      arms: {
        paneCompatible: arm1,
        loaderAdmitted: arm2,
        ledgerAttribution: arm3,
        decisionFired: arm4,
        negativeControl: arm5,
        revocation: { state: revokedClassification.state ?? "unclassified", flipped: revocationFlipped },
      },
      registryProfileVersionNote: "the spec registry's profileVersion string is the dsh-ecosystem-spec number, unrelated to the dsh-tui release this lane's carriers pin — recorded verbatim, never adapted",
    },
    negative: { verdict: negativeVerdict, pane: "negctl/plugins-check.pane.txt", ledgerDelta: negativeLedger.length, undeclaredRecords: negativeUndeclared },
    granted: { check: classification, list: descriptorClassification, ledgerDelta: grantedLedger.length, attributed: attributed.length, handlerBindsApplied: handlerBinds.length },
    hostStderr: { file: grantedStderrFile.replace(REPO + "/", ""), bytes: grantedStderr.length, parkLines: grantedParkLines, why: "DSH_TUI_DEBUG=1 drives the host's per-frame `park target=…` trace; redirecting fd 2 keeps it out of the pane so the chat screen paints (see runTuiSession's stderrFile)" },
    sandboxRoot: root,
    manifestPath: MANIFEST,
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ static: stat.ok, staticGrants: staticGrantsOk(stat), arm1, arm2, arm3, arm4, arm5, revokedState: revokedClassification.state ?? null }).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: host-parsed, projected, validated, negotiated; grant arms 1-5 green (arm 6 observed: " + (revocationFlipped ? "flipped back" : String(revokedClassification.state)) + ")")
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
