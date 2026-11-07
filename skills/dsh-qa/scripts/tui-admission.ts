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
// C3' GRANT ARMS — RE-SPECIFIED TO THE PERMISSION-LESS CONTRACT (F1-live, 0.17.2). The shipped
// manifest requests NO permission by decision (commit 776ac355), so a grant-armed assertion can only be
// made HONESTLY on a CLONE that declares the one permission the seam used to request. The live arms
// therefore measure BOTH postures over THREE boots — one boot per grants-file state, because the host
// re-reads `~/.dsh-tui/extension-grants.json` on EVERY authorize decision, so a grant is a file write and
// not a restart:
//   (1) BOOT 1, SHIPPED POSTURE, NO GRANTS FILE — `/plugin check <shipped manifest>` AND `/plugin list`
//       both advertise `compatible`, and the pane carries NO grants-file hint: nothing is requested, so
//       nothing needs authorizing. A regression that re-requests a permission without a grant reddens HERE
//       (the pane flips to `waiting_authorization` and prints the hint);
//       (0.15.0 RENAMED THE HOST COMMAND `/plugins` -> `/plugin`: measured 2026-10-14, the old
//        spelling is not registered any more, so the line was submitted as CHAT TEXT and the model
//        answered it — the pane carried a thinking indicator and tool calls, never a verdict);
//   (1b) BOOT 3, SHIPPED POSTURE WITH ONE GRANT (A4-F1 / A5-F1) — this boot stages the grants file (the
//        clone's one row, a point the manifest never declares) BEFORE the boot and drives ONE
//        `/plugin check <shipped manifest>`: it must STAY `compatible`, so "a stray grant cannot flip a
//        permission-less manifest" is MEASURED rather than promised. The boot is its OWN so the arm cannot
//        be vacuous: the pane must carry EXACTLY ONE decision line, and a swallowed step leaves zero and
//        reddens (in a shared boot the expected `compatible` would equal the neighbour's verdict);
//   (2) BOOT 1, THE ADMISSION-LOADER LINE admits the Component (`DSH_TUI_DEBUG=1` rides the boot env; the line is
//       read from the boot's REDIRECTED stderr / `host-stderr.log`, because on 0.15.0 the same debug flag
//       makes the host ink emit a per-frame `park target=…` trace to stderr that floods the pane and stops
//       the chat screen from painting);
//   (3) BOOT 2, GRANT CLONE, THREE STATES — a clone of the shipped manifest carrying ONE
//       `session.input.intercept@tui/input` declaration (written into THIS run's evidence dir; the SHIPPED
//       file is never touched) goes through the host's own `/plugin check` three ways: no grant →
//       `waiting_authorization` AND the host's own grants-file hint; that row granted → `compatible`; the
//       same name at an undeclared scope → STILL `waiting_authorization`;
//   (4) BOOT 1, THE DRIVE REACHED A REAL CHAT TURN — a submitted line renders in the pane after Enter, so the
//       assertions above are read from a live session and not a splash screen. With no permission declared
//       our decision handler is NOT live, so this arm no longer claims a decision interception;
//   (5) BOOT 2, REVOCATION (observed, never gated) — the grant file is deleted mid-session and a re-check records
//       whether the clone's pane flips back to `waiting_authorization`;
//   (6) ARM 3 (ledger attribution of an `applied` decision-handler bind) is DECLARED INAPPLICABLE while the
//       shipped manifest declares no permission: no authorize operation exists, so an `applied` bind is not
//       a state this boot can produce. It is recorded as a loud BOUND, never a pass — the
//       registration/attribution gap measured on 2026-10-14 (no decision-handler records even WITH the
//       declaration) stays therefore UNMEASURED by this lane — and it re-arms automatically the moment a
//       permission returns, because the arm is conditional on the declaration set.
// The STATIC arm carries the same three-way control on the host's own `negotiate`, MEASURED ON A CLONE
// (F1): the shipped manifest is permission-less by decision, so the three states are negotiated on a
// `structuredClone` carrying ONE `session.input.intercept@tui/input` row — no grant →
// `waiting_authorization`, that row granted → `compatible`, the same name at an undeclared scope → STILL
// `waiting_authorization` — while the SHIPPED manifest itself must negotiate `compatible` with NO grant AND
// with that row granted (A4-F1).
//
// REGISTRY FALSE POSITIVE, STATED NOT FIXED: the spec registry's `profileVersion`
// string (`0.15`) is the dsh-ecosystem-spec number, UNRELATED to the dsh-tui 0.15.0
// release this lane's carriers pin — it is recorded verbatim and never "adapted".
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.19.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
// (Those three are the codes `tuiPrereqs` in `lib/tui-lane.ts` actually gates: `absent-dsh-binary` probes the
//  `dsh-tui` binary, `absent-runtime` probes `tmux`, `absent-fixture` probes the sandbox profile. A marker
//  always prints the probe it used and the remedy, so a SKIP names its own fix.)
//
// THE SANDBOX ROOT IS ITSELF A CONSTRAINT, MEASURED (A3-F7): the tmux server binds `<root>/<lane>.sock`, a
// unix socket whose whole path must stay under ~107 bytes, so a root under the lane's DEFAULT
// `.mpd/recon/qa/tui-lanes/<lane>` dies on a deep checkout with `File name too long` — the boot never happens
// and every pane arm reports `undefined`. Use a SHORT root (`--sandbox-root .mpd/sb/<lane>`). The profile must
// be WARM (a `~/.dsh/profiles/dsh-tui` that carries the host AND this bundle) because a lane that passed the
// gate never reinstalls it, and the sandbox needs the CREDENTIALS the boot hands the model
// (`<root>/dshhome/.credentials.yaml` copied from `~/.dsh`) or the chat-turn arm cannot render. tmux, a real
// TTY and the launchpad gate are already handled by `runTuiSession`.
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-admission.ts --self-test
//   bun skills/dsh-qa/scripts/tui-admission.ts [--sandbox-root <dir>] [--static-only]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,admission-static.json,REVISION.json,
//             shipped/,clone/,shipped-granted/,grant-clone/}
//
// THE HARD REQUIREMENT GATE IS A DIFFERENT FILE: `node scripts/verify-tui-admission.ts`, a member of
// `bun run verify:gates`. It owns what a build must never pass without — the mechanically checkable
// admission items as failures, both manifests through the host's OWN `parseManifest`, and a NON-ZERO
// exit when no host resolves (a skip is never a pass). THIS case stays the instrument: the static grant
// arms, the three live boots and the ledger attribution, which need a real TTY. A green run here is not
// the gate and a green gate is not this case's live evidence.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, manifestDigest, classifyAdmissionPane, emitMarker, gateTuiPrereqs, laneEvidenceDir, makeChecks, parseSandboxArgs,
  profileState, readLedgerRecords, resolveHostRoot, resolveSpecDataRoot, runTuiSession, sandboxEffectLedgerFile, sandboxGrantFile, sha256File,
  specDataRootCandidates, structuralFindings, tuiPrereqs, writeExtensionGrants, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { AdmissionPaneVerdict, GrantFileRow, LedgerRecord, SpecDataRoot } from "./lib/tui-lane.ts"

/** The case slug: names the evidence dir, the tmux socket and every marker/output line. */
const SLUG = "tui-admission"
/**
 * The permission the STATIC grant arms negotiate.
 *
 * WHY A FIXED ROW AND NOT THE MANIFEST'S OWN: the shipped manifest requests NO permission (the intercept
 * seam is inactive by design), so its own grant table is always EMPTY and a three-state grant assertion
 * against it is red by construction. The arms therefore negotiate a `structuredClone` carrying this ONE
 * declaration — the `session.input.intercept` point this bundle shipped before commit 776ac355 — while the
 * SHIPPED manifest's own decision is asserted separately and must stay `compatible`.
 */
const GRANT_ARM_PERMISSION = "session.input.intercept"
/** Its declared scope: the `tui/input` decision point that permission namespaced. */
const GRANT_ARM_SCOPE = "tui/input"
/** The written reason the clone's declaration carries (the v0.15 schema accepts one; a declaration needs none). */
const GRANT_ARM_REASON = "grant-arm clone: the intercept subscription a grant authorizes; the shipped manifest requests none, because the seam is inactive by design"
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
  return grantsOfManifest((raw ?? {}) as { permissions?: unknown })
}

/**
 * Project ONE decoded manifest's `permissions` block into grant rows.
 *
 * Extracted so the shipped manifest and a control CLONE go through the SAME projection: a control that
 * used a second parser could never prove that the first one still sees a declaration. The rows are
 * declared as `unknown` fields because a decoded `permissions[]` entry carries optional keys, and the
 * projection below is exactly the place that decides which entries are well formed.
 * @param candidate A decoded manifest whose `permissions` block is projected (absent block ⇒ no rows).
 * @returns One grant row per well-formed declaration, in declaration order.
 */
function grantsOfManifest(candidate: { permissions?: unknown }): GrantFileRow[] {
  /** The `permissions` array, `undefined` on a manifest that declares none. */
  const permissions = candidate.permissions
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

/**
 * Write the GRANT CLONE the live grant arms negotiate: the shipped manifest's own bytes plus ONE
 * `session.input.intercept@tui/input` declaration.
 *
 * WHY A CLONE AND NOT THE SHIPPED FILE: the shipped manifest declares `permissions: []` on purpose (the
 * intercept seam is inactive by design), so the host's own admission answers `compatible` for it with OR
 * without a grant — the three-state grant assertion can never hold on it. The clone declares the one point
 * the seam used to request, so the host's OWN `/plugin check` produces the real three-way discriminator,
 * while the shipped file stays byte-identical (`manifestDigest()` in the evidence proves it).
 *
 * THE HOST'S CHECK READS ONLY THE FILE IT IS GIVEN — `checkManifestLines` in
 * `lib/types/dsh-adapter/plugins-info.js` resolves the path, reads it, then runs `parseManifest`,
 * `projectManifest`, `validatePlugin` and `negotiate`; it never stats the facet entry — so a clone living
 * in this run's evidence directory is admitted exactly like the file at the package root.
 * @param dir The evidence subdirectory the clone is written into (created when absent).
 * @returns The absolute clone path `/plugin check` receives, and the ONE grant row it declares.
 */
function writeGrantClone(dir: string): { file: string; row: GrantFileRow } {
  /** The shipped manifest decoded into the shape the clone is edited in. */
  const clone: RawManifest = structuredClone(JSON.parse(readFileSync(MANIFEST, "utf8")) as RawManifest)
  clone.permissions.push({ name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE, reason: GRANT_ARM_REASON })
  mkdirSync(dir, { recursive: true })
  /** The clone's absolute path — passed to `/plugin check` as-is, never repo-relative. */
  const file = join(dir, "dsh-plugin.grant-clone.json")
  writeFileSync(file, JSON.stringify(clone, null, 2) + "\n")
  return { file, row: { name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE } }
}

/**
 * The verdict of the MOST RECENT `/plugin check` in a pane that carries SEVERAL of them.
 *
 * A `/plugin check` paints into the session transcript and never clears it, so a boot driven through four
 * checks shows the earlier decisions ABOVE the newest one — and `classifyAdmissionPane` matches the FIRST
 * decision line it finds, i.e. the OLDEST. The window starts at the LAST decision line
 * (`Negotiation decision:` / `协商结果：`) and therefore carries exactly one decision, its `(...)` detail
 * and the grant hint the host prints below it: the shape ONE isolated check paints.
 * @param paneText The captured pane, possibly carrying several checks.
 * @returns The measured window, the verdict for THAT window, and how many decision lines the pane carries.
 */
export function lastCheckWindow(paneText: string): { window: string; verdict: AdmissionPaneVerdict; decisions: number } {
  /** Every decision line in the pane, in transcript order — the last one belongs to the newest check. */
  const decisions = [...paneText.matchAll(/(?:Negotiation decision:|协商结果：)\s*[a-z_]+/g)]
  /** The newest decision line's match; absent when the pane carries no check output at all. */
  const last = decisions.at(-1)
  if (last === undefined) return { window: paneText, verdict: classifyAdmissionPane(paneText), decisions: 0 }
  /** The text from that decision line to the end of the captured pane. */
  const window = paneText.slice(last.index ?? 0)
  return { window, verdict: classifyAdmissionPane(window), decisions: decisions.length }
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
  /** The C3' grant arms on the SAME pinned `negotiate()`, measured on the CLONE (F1): the rows, the decisions and their combined verdict. */
  grants?: {
    /** The ONE grant row the arms negotiate, at the scope the clone declares. */
    readonly rows: GrantFileRow[]
    /** The SHIPPED manifest's own decision with no grant — `compatible`, because it requests no permission. */
    readonly manifestDecision: string
    /** The SHIPPED manifest's own decision WITH the clone's one row granted — still `compatible`: a stray grant cannot move a permission-less manifest (A4-F1). */
    readonly manifestGranted: string
    /** The CLONE's decision with NO grant — a declared, default-denied permission. */
    readonly ungranted: string
    /** The CLONE's decision with its one row granted. */
    readonly granted: string
    /** The wrong-scope control's decision — the same name at an undeclared scope must NOT authorize. */
    readonly wrongScope: string
    /** True only when the shipped manifest is `compatible` and the clone's states are exactly the documented three. */
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
 * Whether the ledger-attribution arm is a state the boot can produce AT ALL.
 *
 * The arm asserts that the host attributed an APPLIED `decision-handler` bind to the component, which only
 * happens when the host actually authorizes a declared permission. The shipped manifest declares none, so
 * the arm would be red by construction; this predicate makes that a DECLARED, tested inapplicability
 * instead of a permanently red assertion — and it re-arms the assertion the moment a declaration returns.
 * @param rows The grant rows the SHIPPED manifest's own declarations project to.
 * @returns True when at least one permission is declared, i.e. when an authorize decision can happen.
 */
function attributionArmsApplicable(rows: readonly GrantFileRow[]): boolean {
  return rows.length > 0
}

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
    // C3' STATIC GRANT ARMS, MEASURED ON A CLONE (F1 / reviewer H1). The shipped manifest requests NO
    // permission (the intercept seam is inactive by design), so its OWN grant table is always empty and a
    // three-state assertion against it was red by construction: a permission-less manifest negotiates
    // `compatible` with OR without a grant, never `waiting_authorization`. The grant MECHANISM is therefore
    // measured on a `structuredClone` carrying the ONE `session.input.intercept@tui/input` declaration that
    // used to ship — and the HOST's own parser, validator and negotiator judge the clone exactly as they
    // judge a real manifest — while the shipped manifest's OWN decision is asserted separately and must stay
    // `compatible` (so a regression that re-introduces a declaration on the real file still reddens here).
    /** The clone's base: the shipped manifest decoded, then the ONE permission re-declared on it. */
    const cloneSource: RawManifest = JSON.parse(source)
    cloneSource.permissions.push({ name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE, reason: GRANT_ARM_REASON })
    /** The host's OWN parse of the clone — never this lane's `JSON.parse` of it. */
    const cloneManifest = host.parseManifest(JSON.stringify(cloneSource), { source: "grant-arm-clone" })
    // The clone must be a manifest the host would ADMIT: a clone the validator rejects would make the
    // granted arm prove nothing about the real admission path.
    host.validatePlugin(index, cloneManifest)
    /** The ONE grant row a grant author would write, at the scope the clone declares. */
    const grantRow: GrantFileRow = { name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE }
    /** The clone's decision with NO grant — a declared, default-denied permission. */
    const cloneUngranted = host.negotiate(index, cloneManifest, hostModel(host.registryEntries, data), [])
    /** The clone's decision with that one row granted. */
    const cloneGranted = host.negotiate(index, cloneManifest, hostModel(host.registryEntries, data), [grantRow])
    /** The same name at a scope nothing declares — a grant that must NOT authorize. */
    const cloneWrongScope = host.negotiate(index, cloneManifest, hostModel(host.registryEntries, data), [{ name: grantRow.name, scope: "tui/not-a-declared-scope" }])
    // A4-F1: the SHIPPED manifest is ALSO negotiated WITH that row granted. The claim "a stray grant cannot
    // flip a permission-less manifest" is worth MEASURING rather than assuming: the permission-less posture
    // must survive a grants table that names a point it never declares, and the two decisions must agree.
    /** The shipped manifest's own decision with the clone's one row granted. */
    const shippedGranted = host.negotiate(index, manifest, hostModel(host.registryEntries, data), [grantRow])
    result.grants = {
      rows: [grantRow],
      manifestDecision: decisionOf(result.negotiation),
      manifestGranted: decisionOf(shippedGranted),
      ungranted: decisionOf(cloneUngranted),
      granted: decisionOf(cloneGranted),
      wrongScope: decisionOf(cloneWrongScope),
      ok: decisionOf(result.negotiation) === "compatible"
        && decisionOf(shippedGranted) === "compatible"
        && decisionOf(cloneUngranted) === "waiting_authorization"
        && decisionOf(cloneGranted) === "compatible"
        && decisionOf(cloneWrongScope) === "waiting_authorization",
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

  // C3' helper arms (offline): the manifest's OWN declaration set, the grant-row derivation, the
  // grant-file writer's document shape and the tolerant ledger reader, each asserted against a fixture
  // inside a throwaway directory.
  //
  // THE MANIFEST ARM IS TWO-SIDED AND ITS EXPECTATION IS THE CURRENT DECISION (commit 776ac355, PR #91):
  // the shipped manifest declares NO permission, because the intercept seam is INACTIVE BY DESIGN — an
  // unused default-deny permission returns admission to `waiting_authorization` and keeps this bundle
  // attributed as undeclared (the measurement is recorded in the manifest's own `x-mpd-tui.decisionEvents`
  // note). The arm previously expected the four `session.*.intercept` rows the seam used to declare, so it
  // reddened on every run after that decision landed. It now pins the EMPTY set, and its negative control
  // proves the projection still SEES a permission, so the emptiness can never be a parser that went deaf.
  /** The shipped manifest's own declarations, projected into the `{name, scope}` grant rows the host prints. */
  const grantRows = manifestGrantRows()
  check(grantRows.length === 0, "the shipped manifest must declare NO intercept permission (the seam is inactive by design): " + JSON.stringify(grantRows))
  // THE CLONE the static grant arms negotiate, carrying the declarations that used to ship: the input point
  // the arms use, plus the rewind point so the projection's ORDER and plurality are observable too.
  /** A clone of the shipped manifest with the historical intercept declarations re-declared. */
  const withIntercept = structuredClone(manifest)
  withIntercept.permissions.push({ name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE })
  withIntercept.permissions.push({ name: "session.rewind.intercept", scope: "tui/rewind-prompt" })
  /** The clone's declarations as the SAME projection the shipped manifest goes through reads them. */
  const cloneRows = grantsOfManifest(withIntercept)
  check(cloneRows.length === grantRows.length + 2, "a NEGATIVE CONTROL failed: a re-declared permission must reach the projection: " + JSON.stringify(cloneRows))
  // N1 — a REAL round-trip, never a predicate over a literal this arm just wrote: the rows come BACK OUT of
  // the projection with EXACTLY the declared name and scope, in declaration order. A projection that
  // dropped a row, swapped the fields or rewrote the scope reddens here instead of quietly granting a
  // different point than the one declared.
  check(cloneRows[0]?.name === GRANT_ARM_PERMISSION && cloneRows[0]?.scope === GRANT_ARM_SCOPE
    && cloneRows[1]?.name === "session.rewind.intercept" && cloneRows[1]?.scope === "tui/rewind-prompt",
    "the projection must round-trip every declaration's name and scope in order: " + JSON.stringify(cloneRows))
  /** The component id the grants key and the attribution assertions use. */
  const componentId = manifestComponentId()
  check(componentId === "com.mpd-dsh.mpd-tui", "the manifest component id must stay the grants key the arms assert on: " + JSON.stringify(componentId))
  // THE WRITER'S FIXTURE IS THE PROJECTION'S OWN OUTPUT, not a second literal list: what a grant author can
  // write is exactly what the declaration set projects to, so the writer is proven on the rows the lane
  // actually hands it (the shipped set is empty by decision, so the clone's rows stand in for it).
  /** The grant rows the writer's shape control writes: the clone's own projected rows. */
  const writerRows: GrantFileRow[] = cloneRows
  /** A throwaway directory for the writer/reader controls, removed before the arm returns. */
  const scratch = mkdtempSync(join(tmpdir(), "tui-admission-selftest-"))
  try {
    /** The grant file path inside a NESTED directory, so the writer's mkdir discipline is exercised too. */
    const grantFile = join(scratch, "nested", "extension-grants.json")
    writeExtensionGrants(grantFile, componentId, writerRows)
    /** The written document, decoded and narrowed for the shape control below. */
    const written: unknown = JSON.parse(readFileSync(grantFile, "utf8"))
    /** The `grants` section of the written document, `undefined` when the writer omitted it. */
    const grantsBlock = (written as { grants?: unknown } | null)?.grants
    check(grantsBlock !== null && typeof grantsBlock === "object"
      && Array.isArray((grantsBlock as Record<string, unknown>)[componentId]),
      "the grant-file writer must produce the fail-closed object schema {grants:{<id>:[{name,scope}]}}")
    // N2 — the ROW CONTENT, not just "it is an array": the document must carry the SAME name/scope pairs the
    // writer was handed, in the same order, with no extra key a reader would have to interpret. A writer that
    // emitted `[{name}]`, reordered the rows or padded them with metadata reddens here.
    /** The rows the written document carries under this component id. */
    const writtenRows = (grantsBlock as Record<string, Array<Record<string, unknown>>>)[componentId]
    check(writtenRows.length === writerRows.length
      && writtenRows.every((row, index) => row.name === writerRows[index]?.name
        && row.scope === writerRows[index]?.scope
        && Object.keys(row).length === 2),
      "the writer must round-trip every row's name and scope verbatim, in order, and nothing else: " + JSON.stringify(writtenRows))
    /** The ledger fixture: one valid record, one corrupt line, one blank line. */
    const ledgerFile = join(scratch, "effect-ledger.jsonl")
    writeFileSync(ledgerFile, JSON.stringify({ pluginId: "undeclared", operation: "bind" }) + "\n{ not json\n\n")
    /** The records the tolerant reader kept. */
    const records: LedgerRecord[] = readLedgerRecords(ledgerFile)
    check(records.length === 1 && records[0]?.pluginId === "undeclared", "the ledger reader must skip corrupt and blank lines and keep the valid record: " + JSON.stringify(records))
    // THE LIVE GRANT CLONE (F1-live) is judged HERE, offline, because what the live run has to prove is
    // only what the HOST says about the clone: this arm proves the clone's OWN document is the one the arms
    // intend — the shipped declarations plus EXACTLY the one input point — and that writing it leaves the
    // shipped file byte-identical (the clone is what must declare, never the product's manifest).
    /** The shipped manifest's digest BEFORE the clone is written. */
    const shippedDigestBefore = sha256File(MANIFEST)
    /** The clone the live arms write, produced by the very call they make. */
    const liveClone = writeGrantClone(join(scratch, "grant-clone"))
    check(sha256File(MANIFEST) === shippedDigestBefore, "a NEGATIVE CONTROL failed: writing the live grant clone must not touch the shipped manifest")
    /** The clone's declarations, read back through the SAME projection the shipped manifest goes through. */
    const liveCloneRows = grantsOfManifest(JSON.parse(readFileSync(liveClone.file, "utf8")))
    check(liveCloneRows.length === manifest.permissions.length + 1
      && liveCloneRows.filter((row) => row.name === GRANT_ARM_PERMISSION && row.scope === GRANT_ARM_SCOPE).length === 1,
      "the live grant clone must declare the shipped set plus EXACTLY ONE " + GRANT_ARM_PERMISSION + "@" + GRANT_ARM_SCOPE + ": " + JSON.stringify(liveCloneRows))
    check(liveClone.row.name === GRANT_ARM_PERMISSION && liveClone.row.scope === GRANT_ARM_SCOPE,
      "the clone's grant row must be the very declaration the host is asked to authorize: " + JSON.stringify(liveClone.row))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  // THE NEWEST-DECISION WINDOW, two-sided. A transcript keeps older checks ABOVE the newest one, so the
  // helper must read the LAST decision — otherwise the granted arm would re-read the ungranted one above it
  // (MEASURED 2026-11-03: the whole-pane classifier answered waiting_authorization for a pane whose newest
  // decision was compatible).
  /** A pane carrying two checks, the second one compatible — the shape one clone boot captures. */
  const twoChecks = "old: Negotiation decision: waiting_authorization (PERMISSION_NOT_GRANTED: x)\n…\nnew: Negotiation decision: compatible\n"
  /** The windowed reading of that pane. */
  const twoCheckWindow = lastCheckWindow(twoChecks)
  check(twoCheckWindow.verdict.state === "compatible", "the NEWEST decision must win when a pane carries several checks: " + JSON.stringify(twoCheckWindow.verdict.state))
  check(twoCheckWindow.window.startsWith("Negotiation decision: compatible") && !twoCheckWindow.window.includes("waiting_authorization"),
    "the window must start at the NEWEST decision line and carry no older state: " + JSON.stringify(twoCheckWindow.window))
  check(lastCheckWindow("旧：协商结果：waiting_authorization\n新：协商结果：compatible\n").verdict.state === "compatible",
    "a NEGATIVE CONTROL failed: the zh decision line must be windowed exactly like the en one")
  check(lastCheckWindow("a pane with no check output at all").verdict.state === undefined, "a NEGATIVE CONTROL failed: a pane without a decision line must not invent a state")
  // THE FRESHNESS COUNTER (A5-F1) is what stops an arm whose expected value equals its NEIGHBOUR's from
  // passing on a swallowed step: the count must be exact, so "the boot painted exactly one decision" is an
  // assertion a step that painted nothing cannot satisfy.
  check(twoCheckWindow.decisions === 2, "the window must report how MANY decisions the pane carries: " + String(twoCheckWindow.decisions))
  check(lastCheckWindow("a pane with no check output at all").decisions === 0,
    "a NEGATIVE CONTROL failed: a pane with no decision line must report ZERO decisions, not one")

  // THE ATTRIBUTION ARM'S APPLICABILITY, two-sided. The arm gated by this predicate is the one that stayed
  // red even WITH a declaration and is unreachable without one, so the predicate itself must be proven to
  // change answer: inapplicable for the permission-less shipped manifest, applicable for one declaration.
  check(!attributionArmsApplicable(manifestGrantRows()), "the attribution arm must be INAPPLICABLE for the permission-less shipped manifest")
  check(attributionArmsApplicable(grantsOfManifest({ permissions: [{ name: GRANT_ARM_PERMISSION, scope: GRANT_ARM_SCOPE }] })),
    "a NEGATIVE CONTROL failed: ONE declared permission must make the attribution arm applicable again")

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

  /** The host's grants file inside THIS sandbox — the host re-reads it on every authorize decision, so a grant is a file write, never a restart. */
  const grantFile = sandboxGrantFile(root)
  /** The host's append-only effect ledger inside THIS sandbox, whose per-boot deltas carry the attribution facts. */
  const ledgerFile = sandboxEffectLedgerFile(root)
  /** The component id the grants key and every attribution assertion use. */
  const componentId = manifestComponentId()
  /** The grant rows the SHIPPED manifest declares — EMPTY by decision, which is exactly why the three grant states are measured on a clone. */
  const grantRows = manifestGrantRows()
  /** True when the shipped manifest declares a permission at all: only then can the boot perform an authorize decision. */
  const grantArmsApplicable = attributionArmsApplicable(grantRows)

  // ── PHASE A — THE SHIPPED, PERMISSION-LESS POSTURE WITH NO GRANTS FILE (arms 1, 1b, 2 and 4) ──────
  // NOTHING is requested, so nothing needs authorizing: the host must answer `compatible` on its own file
  // with no grant, print NO grants hint, admit the Component at boot, and still carry a real chat turn.
  rmSync(grantFile, { force: true })
  /** The ledger record count before the shipped-posture boot, so its delta is isolated from the clone boot's. */
  const ledgerBeforeShipped = readLedgerRecords(ledgerFile).length
  // THE DRIVE SPELLS THE 0.15.0 COMMAND. The host renamed `/plugins` to `/plugin` (host
  // `i18n.js` "supported: list / check <path> / info <spec> / registries", `tips.js`
  // "/plugin check <manifest>"), so the old spelling is no longer a command and the line was submitted
  // as CHAT TEXT — measured 2026-10-14: the pane carried a thinking indicator and real tool calls.
  // The descriptor step asks for the documented `list` subcommand, because the BARE `/plugin` opens the
  // host's picker and paints no state word (`classifyAdmissionPane` read `undefined` while
  // `plugin check` read `compatible`).
  /** The shipped-posture lifecycle: check, list, back to chat, a REAL input submit, interrupt. */
  const shippedSession = runTuiSession({
    lane: SLUG + "-shipped",
    root,
    outDir: join(outDir, "shipped"),
    bootWaitMs: 180_000,
    extraEnv: { DSH_TUI_DEBUG: "1" },
    stderrFile: join(outDir, "shipped", "host-stderr.log"),
    steps: [
      { name: "plugins-check", keys: ["/plugin check " + MANIFEST, "Enter"], waitMs: 20_000 },
      { name: "plugins-descriptor", keys: ["/plugin list", "Enter"], waitMs: 15_000 },
      { name: "back-to-chat", keys: ["Escape"], waitMs: 3_000 },
      { name: "input-submit", keys: [DECISION_SUBMIT_TEXT, "Enter"], waitMs: 6_000 },
      { name: "input-interrupt", keys: ["Escape"], waitMs: 3_000 },
    ],
  })
  for (const failure of shippedSession.failures) say("shipped tmux: " + failure)
  /** The shipped boot's `/plugin check` pane of the SHIPPED manifest; empty when the step produced no capture. */
  const checkPane = shippedSession.panes.find((pane) => pane.name === "plugins-check")?.text ?? ""
  /** The shipped boot's `/plugin list` pane. */
  const descriptorPane = shippedSession.panes.find((pane) => pane.name === "plugins-descriptor")?.text ?? ""
  /** The pane captured right after the real input submit. */
  const submitPane = shippedSession.panes.find((pane) => pane.name === "input-submit")?.text ?? ""
  /** The shipped check's MOST RECENT decision window — the only one in this boot, read the same way as the clone's four. */
  const shippedWindow = lastCheckWindow(checkPane)
  /** The shipped check window's five-state verdict. */
  const classification = shippedWindow.verdict
  /** The shipped list pane's five-state verdict — windowed for the same reason (one check may follow another). */
  const descriptorClassification = lastCheckWindow(descriptorPane).verdict
  /** ARM 1 — BOTH panes advertise `compatible` for the SHIPPED manifest with NO grants file, i.e. the permission-less posture the product ships. */
  const arm1 = classification.state === "compatible" && descriptorClassification.state === "compatible"
  say("shipped /plugin check -> state=" + String(classification.state) + "; /plugin list -> state=" + String(descriptorClassification.state))
  /** ARM 1b — the shipped check pane carries NO grants-file hint, because nothing is requested and therefore nothing awaits authorization. */
  const arm1NoHint = !shippedWindow.window.includes("extension-grants.json")
  say("shipped /plugin check grants hint absent: " + arm1NoHint)
  /** The shipped boot's STDERR sink: the host's debug stream, redirected so it cannot flood the pane. */
  const shippedStderrFile = join(outDir, "shipped", "host-stderr.log")
  /** The shipped boot's debug stream, `""` when the redirect produced no file. */
  const shippedStderr = existsSync(shippedStderrFile) ? readFileSync(shippedStderrFile, "utf8") : ""
  /** ARM 2 — the admission loader's debug line admits the Component (`DSH_TUI_DEBUG=1` rode the boot env; the line lands in the REDIRECTED stderr stream, never the pane). */
  const arm2 = shippedStderr.includes("admission loader admitted a Component") && shippedStderr.includes(componentId)
  say("arm2 admission-loader line admitted " + componentId + ": " + arm2 + " (stderr=" + shippedStderrFile.replace(REPO + "/", "") + " " + shippedStderr.length + "B)")
  // THE REDIRECT'S OWN READING. The host's `logForDebugging` also emits a `park target=…` line per frame
  // while `DSH_TUI_DEBUG` is set; those frames are what flooded the pane before the redirect (measured:
  // 15,566 of them in the T8 run's `grants/tui-pane.log`, the grant boot never reaching the chat screen
  // inside the 90 s ceiling). Counting them in the REDIRECTED stream is the evidence that the flood was
  // moved rather than removed.
  /** The `park target=…` debug frames the shipped boot wrote to its redirected stderr. */
  const shippedParkLines = (shippedStderr.match(/park target=/g) ?? []).length
  say("shipped boot debug stream: " + shippedParkLines + " park frame(s), redirected off the pane (shipped/host-stderr.log)")
  /** The ledger records the shipped boot appended. */
  const shippedLedger = readLedgerRecords(ledgerFile).slice(ledgerBeforeShipped)
  /** The shipped boot's records attributed to the component id. */
  const attributed: LedgerRecord[] = shippedLedger.filter((record) => record.pluginId === componentId)
  /** The applied decision-handler binds among them — `[]` while no permission is declared, which is the declared bound below. */
  const handlerBinds = attributed.filter((record) => record.operation === "bind" && record.resource?.kind === "decision-handler" && record.result === "applied")
  // ARM 3 — CONDITIONAL, and the condition IS the honesty: with `permissions: []` the host performs no
  // authorize decision at all, so an `applied` decision-handler bind is not a state this boot can produce.
  // While the manifest declares nothing the arm is INAPPLICABLE and recorded as a BOUND (never as a pass);
  // the moment a declaration returns `grantArmsApplicable` turns true and the historical assertion — the
  // ledger must attribute an APPLIED decision-handler bind to the component — is gated again, so the
  // registration/attribution gap measured on 2026-10-14 (928 records, kinds {command:920, status:8}, no
  // decision-handler record even WITH the declaration) cannot be laundered as green.
  /** ARM 3 — attribution of an APPLIED decision-handler bind, gated only while a permission is declared. */
  const arm3 = !grantArmsApplicable || (attributed.length > 0 && handlerBinds.length > 0)
  say("arm3 (ledger attribution) applicable=" + grantArmsApplicable + " attributed=" + attributed.length + " decisionHandlerBinds(applied)=" + handlerBinds.length
    + (grantArmsApplicable ? "" : " — INAPPLICABLE while the shipped manifest declares NO permission (no authorize operation exists): recorded as a BOUND, never a pass"))
  /** ARM 4 — the drive reached a REAL chat turn: the submitted line renders after Enter, so the panes above were read from a live session and not a splash screen. */
  const arm4 = submitPane.includes(DECISION_SUBMIT_TEXT)
  say("arm4 real input submit rendered the turn: " + arm4)

  // ── PHASE B — THE GRANT CLONE: the three states the permission-less shipped file CANNOT produce ───
  /** The clone `/plugin check` reads: the shipped bytes plus ONE `session.input.intercept@tui/input` declaration. */
  const clone = writeGrantClone(join(outDir, "grant-clone"))
  say("grant clone written -> " + clone.file.replace(REPO + "/", "") + " declaring " + clone.row.name + "@" + clone.row.scope + " (the shipped file is never touched)")
  // The clone boot starts with NO grants file: the ungranted state is measured FIRST, then the SAME boot
  // is driven through the granted state, the wrong-scope control and the revocation — one boot, four
  // reads, because the host re-reads the grants file at every authorize decision.
  rmSync(grantFile, { force: true })
  /** The clone lifecycle: ungranted check, granted check, wrong-scope check, post-revocation check. */
  const cloneSession = runTuiSession({
    lane: SLUG + "-clone",
    root,
    outDir: join(outDir, "clone"),
    bootWaitMs: 180_000,
    extraEnv: { DSH_TUI_DEBUG: "1" },
    stderrFile: join(outDir, "clone", "host-stderr.log"),
    steps: [
      { name: "clone-ungranted", keys: ["/plugin check " + clone.file, "Enter"], waitMs: 20_000 },
      {
        name: "clone-granted",
        before: () => { writeExtensionGrants(grantFile, componentId, [clone.row]); say("grants file written -> " + grantFile.replace(REPO + "/", "") + " component=" + componentId + " rows=1") },
        keys: ["/plugin check " + clone.file, "Enter"],
        waitMs: 20_000,
      },
      {
        name: "clone-wrong-scope",
        before: () => { writeExtensionGrants(grantFile, componentId, [{ name: clone.row.name, scope: "tui/not-a-declared-scope" }]); say("grants file rewritten with the WRONG scope (tui/not-a-declared-scope)") },
        keys: ["/plugin check " + clone.file, "Enter"],
        waitMs: 20_000,
      },
      {
        name: "clone-revoked",
        before: () => { rmSync(grantFile, { force: true }); say("grants file revoked mid-session (arm 6, observed)") },
        keys: ["/plugin check " + clone.file, "Enter"],
        waitMs: 20_000,
      },
    ],
  })
  for (const failure of cloneSession.failures) say("clone tmux: " + failure)
  /** The captured text of one clone step, `""` when that step produced no capture. */
  const clonePane = (name: string): string => cloneSession.panes.find((pane) => pane.name === name)?.text ?? ""
  /** The clone's NO-GRANT pane. */
  const cloneUngrantedPane = clonePane("clone-ungranted")
  /** The clone's THAT-ROW-GRANTED pane. */
  const cloneGrantedPane = clonePane("clone-granted")
  /** The clone's WRONG-SCOPE pane. */
  const cloneWrongScopePane = clonePane("clone-wrong-scope")
  /** The clone's post-revocation pane. */
  const cloneRevokedPane = clonePane("clone-revoked")
  /** The clone's NO-GRANT window and verdict — a declared, default-denied permission awaiting authorization. */
  const cloneUngrantedWindow = lastCheckWindow(cloneUngrantedPane)
  /** The clone's NO-GRANT verdict. */
  const cloneUngrantedVerdict = cloneUngrantedWindow.verdict
  /** The clone's THAT-ROW-GRANTED window and verdict (the newest decision, never the ungranted one above it). */
  const cloneGrantedWindow = lastCheckWindow(cloneGrantedPane)
  /** The clone's THAT-ROW-GRANTED verdict. */
  const cloneGrantedVerdict = cloneGrantedWindow.verdict
  /** The clone's WRONG-SCOPE window and verdict. */
  const cloneWrongScopeWindow = lastCheckWindow(cloneWrongScopePane)
  /** The clone's WRONG-SCOPE verdict. */
  const cloneWrongScopeVerdict = cloneWrongScopeWindow.verdict
  /** ARM 5 (the NEGATIVE CONTROL, measured where it can hold) — a declared, default-denied permission with NO grant: `waiting_authorization` AND the host's own grants-file hint naming the flow this lane drives. */
  const arm5 = cloneUngrantedVerdict.state === "waiting_authorization" && cloneUngrantedWindow.window.includes("extension-grants.json")
  say("clone ungranted /plugin check -> state=" + String(cloneUngrantedVerdict.state) + " hint=" + cloneUngrantedWindow.window.includes("extension-grants.json"))
  /** ARM 5b — the SAME clone with its ONE row granted answers `compatible`: the GRANT flips it, not the declaration. */
  const arm5b = cloneGrantedVerdict.state === "compatible"
  say("clone granted /plugin check -> state=" + String(cloneGrantedVerdict.state))
  /** ARM 5c — the same NAME at an undeclared scope still answers `waiting_authorization`: a grant cannot authorize a point nothing declares. */
  const arm5c = cloneWrongScopeVerdict.state === "waiting_authorization"
  say("clone wrong-scope /plugin check -> state=" + String(cloneWrongScopeVerdict.state))
  /** ARM 6 (OPTIONAL, observed not gated) — the post-revocation re-check's state, recorded whether or not it flipped back. */
  const revokedClassification = lastCheckWindow(cloneRevokedPane).verdict
  /** True when the revocation re-check flipped back to `waiting_authorization`. */
  const revocationFlipped = revokedClassification.state === "waiting_authorization"
  say("arm6 revocation re-check -> state=" + String(revokedClassification.state) + " flipped=" + revocationFlipped)

  // ── PHASE C — THE SHIPPED MANIFEST *WITH* A GRANT, IN ITS OWN BOOT (A4-F1 measured, A5-F1 non-vacuous) ──
  // WHY A SEPARATE BOOT: the decision this arm expects (`compatible`) is the SAME one the clone's granted
  // check produces, so in a shared boot a SWALLOWED step leaves the PREVIOUS pane on screen and the arm would
  // read that older `compatible` — a vacuous pass (A5-F1, measured). A fresh boot has no decision to inherit:
  // THIS pane must carry exactly ONE decision line, so a step that painted nothing leaves zero and reddens.
  writeExtensionGrants(grantFile, componentId, [clone.row])
  say("shipped-with-grant boot: the clone's one row staged in the grants file -> " + grantFile.replace(REPO + "/", "") + " rows=1")
  /** The shipped-with-grant lifecycle: ONE `/plugin check` of the SHIPPED manifest, with that grant in place. */
  const shippedGrantedSession = runTuiSession({
    lane: SLUG + "-shipped-granted",
    root,
    outDir: join(outDir, "shipped-granted"),
    bootWaitMs: 180_000,
    extraEnv: { DSH_TUI_DEBUG: "1" },
    stderrFile: join(outDir, "shipped-granted", "host-stderr.log"),
    steps: [{ name: "shipped-granted-check", keys: ["/plugin check " + MANIFEST, "Enter"], waitMs: 20_000 }],
  })
  for (const failure of shippedGrantedSession.failures) say("shipped-granted tmux: " + failure)
  /** The fresh boot's ONLY check pane; `""` when the step produced no capture at all. */
  const shippedGrantedPane = shippedGrantedSession.panes.find((pane) => pane.name === "shipped-granted-check")?.text ?? ""
  /** Its window, verdict and decision count — the newest decision this boot painted, and how many it painted. */
  const shippedGrantedWindow = lastCheckWindow(shippedGrantedPane)
  /** ARM 5d (A4-F1 + A5-F1) — the SHIPPED, permission-less manifest stays `compatible` WITH a grant in place, and the FRESHNESS half makes that non-vacuous: the boot must have painted EXACTLY ONE decision, so a swallowed step reddens instead of re-reading a neighbour's verdict. */
  const arm5d = shippedGrantedWindow.verdict.state === "compatible" && shippedGrantedWindow.decisions === 1
  say("shipped-with-grant /plugin check -> state=" + String(shippedGrantedWindow.verdict.state) + " decisions=" + shippedGrantedWindow.decisions + " (fresh boot, exactly one expected)")
  // The sandbox is left as the next run expects it: no grant file.
  rmSync(grantFile, { force: true })

  /** The lane verdict: static admission + its three grant tables + the shipped-posture arms + the three clone states (arm 6 observed, never gated; arm 3 gated only while a permission is declared). */
  const ok = stat.ok === true && staticGrantsOk(stat) && arm1 && arm1NoHint && arm2 && arm3 && arm4 && arm5 && arm5b && arm5c && arm5d && revokedClassification.state !== undefined
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
    grantArms: {
      componentId,
      shippedRows: grantRows,
      applicable: grantArmsApplicable,
      inapplicable: grantArmsApplicable ? [] : ["arm3-ledger-attribution"],
      inapplicableReason: "the shipped manifest declares `permissions: []` by decision (commit 776ac355), so the host performs no authorize operation and an APPLIED decision-handler bind is not a state this boot can produce; the registration/attribution gap measured 2026-10-14 (no decision-handler record even WITH the declaration) stays UNMEASURED here, and the arm re-arms the moment a permission returns",
    },
    shipped: {
      manifestPath: MANIFEST,
      check: classification,
      list: descriptorClassification,
      grantsHintAbsent: arm1NoHint,
      withGrant: { check: shippedGrantedWindow.verdict.state, decisions: shippedGrantedWindow.decisions, arm: arm5d, boot: "its OWN boot, with the clone's one row staged BEFORE the boot, so a swallowed step leaves ZERO decisions and reddens (A5-F1)" },
      stderr: { file: shippedStderrFile.replace(REPO + "/", ""), bytes: shippedStderr.length, parkLines: shippedParkLines, why: "DSH_TUI_DEBUG=1 drives the host's per-frame `park target=…` trace; redirecting fd 2 keeps it out of the pane so the chat screen paints (see runTuiSession's stderrFile)" },
      ledgerDelta: shippedLedger.length,
      attributed: attributed.length,
      handlerBindsApplied: handlerBinds.length,
      // The attribution arm records the STRING "inapplicable" rather than a folded `true`, so the artifact a
      // verifier reads can never mistake an unmeasured arm for a pass.
      arms: { compatible: arm1, noGrantHint: arm1NoHint, loaderAdmitted: arm2, ledgerAttribution: grantArmsApplicable ? arm3 : "inapplicable", decisionTurn: arm4 },
    },
    clone: {
      file: clone.file.replace(REPO + "/", ""),
      digest: sha256File(clone.file),
      row: clone.row,
      ungranted: cloneUngrantedVerdict,
      granted: cloneGrantedVerdict,
      wrongScope: cloneWrongScopeVerdict,
      revoked: { state: revokedClassification.state ?? "unclassified", flipped: revocationFlipped },
      grantsFile: grantFile.replace(REPO + "/", ""),
      arms: { ungrantedWaiting: arm5, grantedCompatible: arm5b, wrongScopeWaiting: arm5c },
    },
    registryProfileVersionNote: "the spec registry's profileVersion string is the dsh-ecosystem-spec number, unrelated to the dsh-tui release this lane's carriers pin — recorded verbatim, never adapted",
    sandboxRoot: root,
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ static: stat.ok, staticGrants: staticGrantsOk(stat), arm1, arm1NoHint, arm2, arm3, grantArmsApplicable, arm4, arm5, arm5b, arm5c, arm5d, revokedState: revokedClassification.state ?? null }).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: host-parsed, projected, validated, negotiated; the SHIPPED posture is compatible with NO grant AND with one in place, and the clone arms are ungranted=waiting / granted=compatible / wrong-scope=waiting (arm 6 observed: " + (revocationFlipped ? "flipped back" : String(revokedClassification.state)) + ")")
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
