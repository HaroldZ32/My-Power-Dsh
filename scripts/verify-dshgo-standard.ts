#!/usr/bin/env node
// verify-dshgo-standard — the DSH-Go native-plugin conformance HARD gate (user requirement R7/R8/R9).
//
// WHY THIS FILE EXISTS: `scripts/verify-dshgo-views.ts` checked a handful of view rules but was
// ORPHANED — no npm script called it, it was no member of `scripts/verify-gates.ts`, and no GitHub
// workflow ran it, so this bundle's `dshGo` manifest could drift away from the published DSH-Go
// standard with every gate green. This gate is the enforcement point: it encodes the protocol the
// app and the bridge actually apply, it is a `verify:gates` MEMBER, and `publish.yml` runs it before
// anything is packed or staged, so a non-conforming manifest cannot reach a release.
//
// THE STANDARD IT ENCODES: `ccch1mneyyy/dsh-Go` at commit `f36bf91b0736e81ef40c2a7040b2ec337ca1ab40`
// (2026-11-09). The numeric table is `runtime/bridge/dsh-go-bridge/lib/native/limits.js`; the
// structural rules are the five upstream JSON Schemas plus the bridge's own `manifest.js`; the view
// budgets are the app's `view-check.js`. Those bytes are captured as SPEC DATA under
// `specs/dsh-go/` (`SPECS` below) — never as vendored executable code, because `@dsh-go/plugin-kit`
// is `private: true` on npm and this repository's de-vendor policy forbids vendoring upstream code.
//
// THE PIN IS ASSERTED, NOT ASSUMED (contract §3 C5, added 2026-11-09 after the verifier's PIN-2).
// The same upstream commit is RESTATED at seven declaration points — `specs/dsh-go/SOURCE.json`'s
// `commit`, the `specs/dsh-go/limits.ts` header, THIS file's header AND its `standard:` render line,
// `docs/dsh-go-standard.md`, `docs/dsh-go-standard.zh-CN.md`, and the two workflow refs
// (`publish.yml`, `gates.yml`) — so eight readings in all. Nothing compared them, and one wave moved
// the pin while leaving both docs and both CI refs on the previous sha with every lane green. The PIN
// check below reads all eight and fails on a site that states no 40-hex commit and on any disagreement.
// A site whose FILE is absent is an error only in a CHECKOUT (`.git` present — every CI run and this
// repository); a packaged tree ships `scripts/**`, `specs/**` and `docs/**` but NOT `.github/**`, so its
// two workflow sites print `pin-site-skipped` NOTES and never change the exit code. A file that IS
// present but states no 40-hex commit is an error in both modes: an absent file and an absent pin are
// different facts. It prints its own `PIN:` line (it is NOT a sixth lane). The literal must be the
// PEELED release commit — `git rev-parse v1.0.14^{commit}` — never the annotated tag object that `git
// rev-parse v1.0.14` prints, which is not a commit at all.
//
// THE FIVE LANES, and what each one may and may not prove:
//
//   MANIFEST (static) — the `dshGo` block and the package fields around it: `v === 1`; a `contributes`
//   object; the serialized block inside 16 KiB; every contribution id unique ACROSS slots and matching
//   `^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$`; every slot inside its per-plugin cap (the seven surfaces);
//   display text measured PER LOCALE (zh and en are separate measurements); `wants` values and their
//   pairing with the surfaces that can carry content; static `effect` kinds restricted to the six the
//   invoke schema allows, at most four per item; panel `placement` / `presentation` enums; a strip's
//   `panel` naming a declared panel; `package.json.engines.dsh` (it lives OUTSIDE `dshGo`); and the
//   `dsh.bundle.patch` files the install path resolves.
//
//   VIEW (static) — every static view a panel declares: the file exists inside the package, parses,
//   sits inside the PANEL budget (32768 B / 120 nodes / depth 8), is view v1, uses only v1 components,
//   carries no `$` binding and no image outside `asset:` / a small `data:` URL, and passes the design
//   lint. The tool-card rules (8192 B / 40 nodes / depth 6, NO binding, NO buttons) are asserted on
//   the KIT that builds them, with a paired positive control — see the bound below.
//
//   COMPAT (BACKWARD COMPATIBILITY — user-set hard requirement, R9) — a static view a manifest
//   declares must stay a legacy v1 tree: no v2-only component, no `$` binding, and `v === 1`. The kit
//   must still ship the degradation path (`adaptView` + `V1_COMPONENTS`), and downgrading EVERY
//   v2-only component name must leave no v2-only node behind, so an older app is still served. The
//   adapter's v1/v2 catalogs must partition the component names the vendored view schema declares.
//
//   HOST (static) — the host half binds the bridge the sanctioned way and registers exactly what the
//   manifest advertises: no `'dshGo?'` optional-inject spelling, no `dshGo` entry in a top-level
//   `inject` array, the adapter's service probe (or `ctx.inject(['dshGo'], …)`) present, one
//   `dshGoPanel(id)` per declared panel, a handler for every manifest id without a static `effect`,
//   and no registration for an id the manifest does not declare. MEASUREMENT METHOD: a source-text
//   walk over the host-half modules, resolving `DSHGO_*` string constants and computed object keys.
//   BOUND: it is static analysis, not a boot; an id supplied through a lowercase variable and never
//   spelled as a resolvable key is invisible to it (the current tree spells all of them).
//
//   CROSS-CHECK (host-bound) — when `MPD_DSHGO_KIT` names a DSH-Go checkout, its own
//   `sdk/plugin-kit/bin/check.mjs --json` runs against this package and the two verdicts are compared.
//   WITHOUT a checkout the lane reports NOT-PASSED (exit 3): a cross-check that did not run is never a
//   green. `--require-dshgo-kit` states that absence as an explicit requirement in the transcript; the
//   exit code is 3 either way, by design.
//
//   ONE OFFICIAL FALSE NEGATIVE IS ISOLATED, EXPLICITLY: the official checker requires
//   `dsh.bundle.patch` to be a STRING, while a DSH bundle may declare an ARRAY of patch layers (this
//   repository does). When that package item is the ONLY blocking item in the official report and this
//   gate's own MANIFEST lane resolved every declared patch path, the comparison excludes it and prints
//   `crosscheck-normalized` as a note — the raw official exit stays quoted in the report. Every other
//   official error, a non-`ok` manifest state and a fatal view still stop the plugin.
//
// WIRING (a hard gate, not a suggestion): `scripts/verify-gates.ts` carries it as the `dshgo` member
// (that table is the ONE declaration point) and treats exit 2 and exit 3 as a FAILED member; the CI
// `gates.yml` job checks the pinned upstream commit out with a sparse `sdk/plugin-kit` checkout and
// exports `MPD_DSHGO_KIT` before the aggregate; and `publish.yml` runs this gate BEFORE `npm pack` /
// `npm stage publish`, so a non-conforming manifest cannot be staged for a release.
//
// SEVERITY MIRRORS THE OFFICIAL CHECKER (the task's own constraint): the bridge turns an over-length
// label into a `warn` and truncates it (so it is a NOTE here — printed, never a failure), while a
// duplicate id is an `error` (so it fails). Structural violations fail; length violations are notes.
//
// WHAT THIS GATE DOES NOT PROVE (declared bounds, never papered over): it does not render anything on
// a device (no Flutter app exists here); it does not run the upstream checker unless a checkout is
// supplied; the tool-card and degradation arms assert the KIT's behaviour on synthetic trees rather
// than on a real tool result; and the HOST lane is static analysis rather than a mounted boot.
//
// Usage:
//   node scripts/verify-dshgo-standard.ts                      audit this repository's package root
//   node scripts/verify-dshgo-standard.ts --root <dir>         audit another package root (QA fixtures)
//   node scripts/verify-dshgo-standard.ts --self-test          fixture arms, each with a negative control
//   node scripts/verify-dshgo-standard.ts --require-dshgo-kit  a missing official checkout is stated as required
//   node scripts/verify-dshgo-standard.ts --json <path>        also write the full report as JSON
//   node scripts/verify-dshgo-standard.ts --help
//
// Exit codes (the contract the aggregator honours):
//   0  every lane legal
//   1  one or more VIOLATIONS (each printed with its rule, path and detail)
//   2  cannot run: unreadable package.json, unknown flag, a self-test arm misbehaving
//   3  NOT-PASSED: the official cross-check could not run (no `MPD_DSHGO_KIT` checkout); never a pass
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { Dirent } from "node:fs"
import {
  BUDGETS,
  V1_COMPONENTS,
  V2_ONLY_COMPONENTS,
  adaptView,
  lintDesign,
  measureView,
  toolCard,
} from "../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import type { DshGoView } from "../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import {
  ICON,
  ID,
  LIMITS,
  PLACEMENTS,
  PRESENTATIONS,
  PROTOCOL,
  STATIC_EFFECT_KINDS,
  SURFACES,
  VIEW_BUDGETS,
  WANTS,
} from "../specs/dsh-go/limits.ts"

/** The line prefix every byte this gate writes carries, so a transcript stays greppable. */
const TAG: string = "[dshgo-standard]"
/** This script's own path, spawned by the self-test only as documentation of the entry point. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, resolved from this file's own location under `<root>/scripts/`. */
const REPO_ROOT: string = dirname(dirname(SELF))
/** The runner's exit-code contract: 0 legal, 1 violations, 2 cannot-run, 3 NOT-PASSED. */
const EXIT = { LEGAL: 0, VIOLATIONS: 1, CANNOT_RUN: 2, NOT_PASSED: 3 } as const
/** The env var naming an upstream DSH-Go checkout the official checker can be run from. */
const KIT_ENV: string = "MPD_DSHGO_KIT"
/** The two spellings a supplied checkout's checker may have, relative to the checkout root. */
const KIT_CHECK_PATHS: readonly string[] = [join("sdk", "plugin-kit", "bin", "check.mjs"), join("bin", "check.mjs")]
/** How long the official checker may run before the lane reports it as not passed. */
const CROSS_CHECK_TIMEOUT_MS: number = 120000
/** Capture budget for the official checker's JSON report; a bigger transcript is refused, not truncated. */
const CROSS_CHECK_MAX_BUFFER: number = 16 * 1024 * 1024
/** The host-half source roots the HOST lane walks, relative to the audited package root. */
const HOST_SOURCE_DIRS: readonly string[] = [join("packages", "mpd-bundle-plugin", "src")]
/** The adapter source file whose service probe is the sanctioned binding site. */
const ADAPTER_SOURCE: string = join("packages", "mpd-dsh-adapter-plugin", "src", "index.ts")
/** The seven contribution surfaces with their per-plugin caps, resolved once from the spec table. */
const SLOT_LIMITS: ReadonlyMap<string, number> = new Map<string, number>(
  SURFACES.map((surface: string): [string, number] => [surface, LIMITS.perPlugin[surface] ?? 0]),
)
/** The display-text ceiling of each label-bearing surface, from the spec table. */
const LABEL_LIMITS: ReadonlyMap<string, number> = new Map<string, number>([
  ["composer.actions", LIMITS.textChars.composerAction],
  ["message.actions", LIMITS.textChars.messageAction],
  ["session.actions", LIMITS.textChars.sessionAction],
  ["composer.tools", LIMITS.textChars.composerTool],
])

/** One finding: which rule broke, where, how, and whether it fails the run or is a note. */
interface Finding {
  /** The rule id, stable enough to grep a report for. */
  readonly rule: string
  /** The manifest / view / source path the finding was read from. */
  readonly path: string
  /** One line naming the offending value and the accepted shape. */
  readonly detail: string
  /** `error` fails the gate; `note` mirrors the official checker's warn/note severity. */
  readonly severity: "error" | "note"
}

/** One lane's findings, kept separate so a report says WHICH lane spoke. */
interface LaneResult {
  /** The lane's name, printed as the report's section header. */
  readonly lane: string
  /** Everything the lane found. */
  readonly findings: readonly Finding[]
}

/** The parsed package under audit: the raw `package.json` and its optional `dshGo` block. */
interface PackageView {
  /** The absolute package root this run audits. */
  readonly root: string
  /** The parsed `package.json`, or undefined when it could not be read. */
  readonly pkg: Record<string, unknown> | undefined
  /** The `dshGo` block, or undefined when the package declares none. */
  readonly dshGo: Record<string, unknown> | undefined
}

/** One display-text value resolved to the locale it declares. */
interface LocaleText {
  /** The locale key as declared; `*` marks a plain string with no locale map. */
  readonly locale: string
  /** The resolved text for that locale. */
  readonly text: string
}

/** The cross-check lane's outcome: passed, failed (disagreement), or not passed (no checkout). */
interface CrossCheckResult {
  /** The lane's verdict. */
  readonly status: "passed" | "failed" | "not-passed"
  /** One line a report prints: the kit, the official exit code and the comparison. */
  readonly detail: string
  /** Findings the lane contributes (a disagreement is an `error`). */
  readonly findings: readonly Finding[]
  /** The checkout path the run used, or null. */
  readonly kit: string | null
  /** The official checker's own exit status, or null when it never ran. */
  readonly officialExit: number | null
}

/** The full audit a run produces: the static lanes, the pin check and the cross-check lane. */
interface AuditReport {
  /** The audited package root. */
  readonly root: string
  /** The five static lanes, in report order. */
  readonly lanes: readonly LaneResult[]
  /** The pin-coherence check over the repository's declaration sites. */
  readonly pin: PinAudit
  /** The cross-check lane. */
  readonly crossCheck: CrossCheckResult
}

/** True for a plain JSON object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Read and parse one JSON file, returning undefined when it is missing or malformed. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

/** UTF-8 byte size of a value's JSON text; 0 when it has no JSON form. */
function jsonBytes(value: unknown): number {
  /** The value's JSON text, or undefined when it has no JSON form. */
  const text = JSON.stringify(value)
  return text === undefined ? 0 : new TextEncoder().encode(text).length
}

/** Character count the way the protocol measures it: CODE POINTS, not UTF-16 units. */
function codePoints(text: string): number {
  return [...text].length
}

/** Resolve a protocol text value into its locale entries; null when the shape is not a protocol text. */
function localeTexts(value: unknown): readonly LocaleText[] | null {
  if (typeof value === "string") return value === "" ? null : [{ locale: "*", text: value }]
  if (!isRecord(value)) return null
  /** The resolved entries, one per declared locale. */
  const out: LocaleText[] = []
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== "string" || text === "") return null
    out.push({ locale, text })
  }
  return out.length === 0 ? null : out
}

/** Push one finding, keeping the severity explicit at every call site. */
function add(into: Finding[], rule: string, path: string, detail: string, severity: "error" | "note" = "error"): void {
  into.push({ rule, path, detail, severity })
}

/** Check one display-text field against a per-locale character ceiling. */
function checkText(into: Finding[], value: unknown, limit: number, path: string, label: string): void {
  /** The field's per-locale values, or null when the shape is wrong. */
  const texts = localeTexts(value)
  if (texts === null) {
    add(into, "text-shape", path, `${label} must be a non-empty string or a locale -> string map`)
    return
  }
  for (const entry of texts) {
    /** The measured length of this locale's text. */
    const count = codePoints(entry.text)
    if (count > limit) {
      add(into, "text-too-long", path, `${label} is ${count} characters for locale ${entry.locale}, over ${limit}; the app truncates it (NOTE, mirroring the official warn)`, "note")
    }
  }
}

/** The static effect kinds one entry declares; null when the `effect` shape is not a protocol effect. */
function effectTypes(effect: unknown): readonly unknown[] | null {
  if (isRecord(effect)) return [effect.type]
  if (!Array.isArray(effect)) return null
  return effect.map((item: unknown): unknown => (isRecord(item) ? item.type : undefined))
}

/** True for a `{ "$": "data.…" }` binding, the one-key shape the protocol defines. */
function isBinding(value: unknown): boolean {
  if (!isRecord(value)) return false
  /** The candidate's own keys; a binding carries exactly one. */
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === "$" && typeof value.$ === "string"
}

/** True when any value in the tree is a `{ "$": "data.…" }` binding. */
function hasBinding(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBinding)
  if (!isRecord(value)) return false
  if (isBinding(value)) return true
  return Object.values(value).some(hasBinding)
}

/** Every component node of a view, depth first (children and section children). */
function* componentNodes(view: unknown): Generator<Record<string, unknown>> {
  if (!isRecord(view) || typeof view.type !== "string") return
  yield view
  /** The child values this node nests, sections included. */
  const nested: unknown[] = []
  if (Array.isArray(view.children)) nested.push(...view.children)
  if (Array.isArray(view.items)) {
    for (const item of view.items) if (isRecord(item) && Array.isArray(item.children)) nested.push(...item.children)
  }
  for (const child of nested) yield* componentNodes(child)
}

/** Whether one component name is v2-only (the list the app treats as a newer-app name). */
function isV2Component(type: string): boolean {
  return V2_ONLY_COMPONENTS.includes(type)
}

/** Load the package under audit; a readable `package.json` is the only precondition. */
function loadPackage(root: string): PackageView {
  /** The parsed manifest, or undefined when it is missing or malformed. */
  const pkg = readJson(join(root, "package.json"))
  if (!isRecord(pkg)) return { root, pkg: undefined, dshGo: undefined }
  return { root, pkg, dshGo: isRecord(pkg.dshGo) ? pkg.dshGo : undefined }
}

/** The package-level half of the MANIFEST lane: fields that live OUTSIDE `dshGo`. */
function auditPackage(view: PackageView): Finding[] {
  /** Everything this lane found. */
  const findings: Finding[] = []
  /** The parsed `package.json`. */
  const pkg = view.pkg
  if (pkg === undefined) {
    add(findings, "package-json", "package.json", "the file is missing or not valid JSON")
    return findings
  }
  /** The package's `engines` block, when it declares one. */
  const engines = isRecord(pkg.engines) ? pkg.engines : undefined
  if (engines === undefined || typeof engines.dsh !== "string" || engines.dsh === "") {
    add(findings, "engines-dsh", "package.json#engines.dsh", 'not declared: the app cannot refuse an incompatible DSH install (NOTE, mirroring the official warn)', "note")
  }
  /** The bundle's patch declaration, which is what makes the package installable at all. */
  const bundle = isRecord(pkg.dsh) && isRecord(pkg.dsh.bundle) ? pkg.dsh.bundle : undefined
  /** The patch value: one path or an array of paths, both legal. */
  const patch = bundle?.patch
  if (patch === undefined) {
    add(findings, "bundle-patch", "package.json#dsh.bundle.patch", "not declared: a DSH profile cannot mount this package")
    return findings
  }
  /** The declared patch paths, whatever spelling the manifest used. */
  const paths = typeof patch === "string" ? [patch] : Array.isArray(patch) ? patch : undefined
  if (paths === undefined || paths.some((entry: unknown): boolean => typeof entry !== "string" || entry === "")) {
    add(findings, "bundle-patch", "package.json#dsh.bundle.patch", "must be a non-empty string or an array of non-empty strings")
    return findings
  }
  for (const declared of paths) {
    /** The patch file resolved from the package root. */
    const file = resolve(view.root, String(declared))
    if (!existsSync(file)) add(findings, "bundle-patch-missing", String(declared), "the declared patch file does not exist")
  }
  return findings
}

/** The MANIFEST lane: the `dshGo` block itself, slot by slot. */
function auditManifest(view: PackageView): Finding[] {
  /** Everything this lane found. */
  const findings: Finding[] = []
  /** The `dshGo` block the app parses. */
  const dshGo = view.dshGo
  if (dshGo === undefined) {
    add(findings, "manifest-missing", "package.json", 'no "dshGo" object; the app shows no native surface at all')
    return findings
  }
  if (dshGo.v !== PROTOCOL) {
    add(findings, "manifest-version", "dshGo.v", `the protocol version must be ${PROTOCOL}, got ${JSON.stringify(dshGo.v)}`)
  }
  if (dshGo.title !== undefined) checkText(findings, dshGo.title, LIMITS.textChars.pluginTitle, "dshGo.title", "the plugin title")
  if (dshGo.icon !== undefined && (typeof dshGo.icon !== "string" || !ICON.test(dshGo.icon))) {
    add(findings, "icon-shape", "dshGo.icon", `icon ${JSON.stringify(dshGo.icon)} must match ${ICON}`)
  }
  /** The manifest's own serialized size, the unit the app measures. */
  const bytes = jsonBytes(dshGo)
  if (bytes > LIMITS.manifestBytes) add(findings, "manifest-bytes", "dshGo", `${bytes} bytes, over ${LIMITS.manifestBytes}`)
  /** The `contributes` block; a manifest without one contributes nothing. */
  const contributes = dshGo.contributes
  if (!isRecord(contributes)) {
    add(findings, "manifest-contributes", "dshGo.contributes", "must be an object")
    return findings
  }
  /** Every id already declared, mapped to the slot that declared it. */
  const seen = new Map<string, string>()
  /** The declared panels' ids, so a strip can be checked against them. */
  const panelIds = new Set<string>()
  /** The surface -> declared count, for the `wants` pairing check below. */
  const present = new Map<string, number>()
  for (const [slot, limit] of SLOT_LIMITS) {
    /** The slot's declared entries. */
    const entries = contributes[slot]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) {
      add(findings, "slot-shape", `dshGo.contributes.${slot}`, "must be an array")
      continue
    }
    present.set(slot, entries.length)
    if (entries.length > limit) add(findings, "slot-count", `dshGo.contributes.${slot}`, `${entries.length} entries, over the maximum ${limit}`)
    for (const entry of entries) {
      if (!isRecord(entry)) {
        add(findings, "entry-shape", `dshGo.contributes.${slot}`, "every entry must be an object")
        continue
      }
      /** The entry's id, when it has one of the right shape. */
      const id = entry.id
      if (typeof id !== "string" || !ID.test(id)) {
        add(findings, "id-shape", `dshGo.contributes.${slot}`, `id ${JSON.stringify(id)} must match ${ID}`)
        continue
      }
      /** The slot that declared this id first, when it was already taken. */
      const takenBy = seen.get(id)
      if (takenBy !== undefined) add(findings, "id-duplicate", `dshGo.contributes.${slot}`, `"${id}" is already declared by ${takenBy}; ids are unique per plugin across ALL slots`)
      else seen.set(id, slot)
      if (slot === "panels") panelIds.add(id)
      /** The label ceiling this slot declares, when it is a label-bearing slot. */
      const labelLimit = LABEL_LIMITS.get(slot)
      if (labelLimit !== undefined && entry.label !== undefined) checkText(findings, entry.label, labelLimit, `dshGo.contributes.${slot}[${id}].label`, "the label")
      if (slot === "panels") auditPanelEntry(findings, view.root, entry, id)
      if (slot === "composer.strip" && entry.text !== undefined) checkText(findings, entry.text, LIMITS.textChars.stripText, `dshGo.contributes.composer.strip[${id}].text`, "the strip text")
      if (entry.effect !== undefined) auditEffect(findings, entry.effect, `dshGo.contributes.${slot}[${id}].effect`)
      if (slot === "composer.tools" && entry.panel !== undefined && entry.effect !== undefined) {
        add(findings, "tool-panel-effect", `dshGo.contributes.composer.tools[${id}]`, "a tool declares `panel` OR `effect`, never both")
      }
    }
  }
  /** Every strip must name a panel the manifest actually declares. */
  for (const strip of Array.isArray(contributes["composer.strip"]) ? contributes["composer.strip"] : []) {
    if (!isRecord(strip) || strip.panel === undefined) continue
    if (typeof strip.panel !== "string" || !panelIds.has(strip.panel)) {
      add(findings, "strip-panel", "dshGo.contributes.composer.strip", `panel ${JSON.stringify(strip.panel)} is not a declared panel`)
    }
  }
  auditWants(findings, dshGo.wants, present)
  return findings
}

/** Check one panel entry: title, placement, presentation and the view path it declares. */
function auditPanelEntry(into: Finding[], root: string, panel: Record<string, unknown>, id: string): void {
  /** The entry's own path, used by every detail below. */
  const at = `dshGo.contributes.panels[${id}]`
  if (panel.title !== undefined) checkText(into, panel.title, LIMITS.textChars.panelTitle, `${at}.title`, "the panel title")
  if (panel.placement !== undefined) {
    if (!Array.isArray(panel.placement) || panel.placement.length === 0) {
      add(into, "panel-placement", at, `placement must be a non-empty array of ${PLACEMENTS.join(" / ")}`)
    } else {
      for (const placement of panel.placement) {
        if (typeof placement !== "string" || !PLACEMENTS.includes(placement)) add(into, "panel-placement", at, `placement ${JSON.stringify(placement)} must be one of ${PLACEMENTS.join(" / ")}`)
      }
    }
  }
  if (panel.presentation !== undefined && (typeof panel.presentation !== "string" || !PRESENTATIONS.includes(panel.presentation))) {
    add(into, "panel-presentation", at, `presentation ${JSON.stringify(panel.presentation)} must be one of ${PRESENTATIONS.join(" / ")}`)
  }
  if (typeof panel.view === "string" && panel.view !== "") auditDeclaredViewPath(into, root, panel.view, at)
}

/** Check one declared static view path: it must stay inside the package and exist. */
function auditDeclaredViewPath(into: Finding[], root: string, declared: string, at: string): void {
  /** The absolute path the manifest's relative spelling resolves to. */
  const file = resolve(root, declared)
  /** True when the resolved path stays inside the package (the bridge rejects escapes too). */
  const inside = file === root || file.startsWith(root + sep)
  if (!inside) {
    add(into, "view-path", at, `view "${declared}" escapes the package root`)
    return
  }
  if (!existsSync(file)) add(into, "view-path", at, `view "${declared}" does not exist`)
}

/** Check one static `effect` declaration against the six allowed kinds and the per-item ceiling. */
function auditEffect(into: Finding[], effect: unknown, at: string): void {
  /** The effect kinds the declaration names, or null when the shape is wrong. */
  const kinds = effectTypes(effect)
  if (kinds === null) {
    add(into, "effect-shape", at, "an effect must be an object or an array of objects")
    return
  }
  if (kinds.length > LIMITS.effectsPerInvoke) add(into, "effect-count", at, `${kinds.length} effects, over the maximum ${LIMITS.effectsPerInvoke}`)
  for (const kind of kinds) {
    if (typeof kind !== "string" || !STATIC_EFFECT_KINDS.includes(kind)) {
      add(into, "effect-kind", at, `effect type ${JSON.stringify(kind)} is not a static kind (${STATIC_EFFECT_KINDS.join(", ")})`)
    }
  }
}

/** Check `wants` values and that each one has a surface that can carry it. */
function auditWants(into: Finding[], wants: unknown, present: ReadonlyMap<string, number>): void {
  if (wants === undefined) return
  if (!Array.isArray(wants)) {
    add(into, "wants-value", "dshGo.wants", "must be an array")
    return
  }
  for (const want of wants) {
    if (typeof want !== "string" || !WANTS.includes(want)) {
      add(into, "wants-value", "dshGo.wants", `unknown want ${JSON.stringify(want)}; allowed: ${WANTS.join(", ")}`)
    }
  }
  /** The surfaces that can carry `draft` / `clipboard` content. */
  const composerCarries = (present.get("composer.actions") ?? 0) + (present.get("composer.tools") ?? 0) > 0
  /** The surface that can carry `message` content. */
  const messageCarries = (present.get("message.actions") ?? 0) > 0
  if (wants.includes("draft") && !composerCarries) add(into, "wants-pairing", "dshGo.wants", "`draft` needs a composer.actions or composer.tools entry to attach to")
  if (wants.includes("clipboard") && !composerCarries) add(into, "wants-pairing", "dshGo.wants", "`clipboard` needs a composer.actions or composer.tools entry to attach to")
  if (wants.includes("message") && !messageCarries) add(into, "wants-pairing", "dshGo.wants", "`message` needs a message.actions entry to attach to")
}

/** The static views the manifest declares, as (declared spelling, absolute path) pairs. */
function declaredStaticViews(view: PackageView): { declared: string; file: string; panel: string }[] {
  /** The resolved declarations. */
  const out: { declared: string; file: string; panel: string }[] = []
  /** The declared panels, when the manifest has a contributes object. */
  const panels = isRecord(view.dshGo) && isRecord(view.dshGo.contributes) && Array.isArray(view.dshGo.contributes.panels) ? view.dshGo.contributes.panels : []
  for (const panel of panels) {
    if (!isRecord(panel) || typeof panel.view !== "string" || panel.view === "") continue
    /** The absolute file the declaration names. */
    const file = resolve(view.root, panel.view)
    out.push({ declared: panel.view, file, panel: typeof panel.id === "string" ? panel.id : "?" })
  }
  return out
}

/** The VIEW lane: every static view inside the panel budget, v1, binding-free and designed. */
function auditViews(view: PackageView): Finding[] {
  /** Everything this lane found. */
  const findings: Finding[] = []
  for (const declared of declaredStaticViews(view)) {
    auditViewFile(findings, view.root, declared.declared, "view")
  }
  auditToolCardKit(findings)
  auditToolCardSources(findings, view.root)
  findings.push(...budgetDrift(BUDGETS))
  return findings
}

/** Audit one view file against the v1 / budget / design rules under the given rule prefix. */
function auditViewFile(into: Finding[], root: string, declared: string, prefix: string): void {
  /** The absolute file the declaration resolves to. */
  const file = resolve(root, declared)
  /** True when the resolved path stays inside the package. */
  const inside = file === root || file.startsWith(root + sep)
  if (!inside || !existsSync(file)) return
  /** The view's byte size on disk, the unit the app's read path uses. */
  const bytes = statSync(file).size
  if (bytes > LIMITS.viewBytes) add(into, `${prefix}-bytes`, declared, `${bytes} bytes, over ${LIMITS.viewBytes}`)
  /** The parsed view, or undefined when the JSON is malformed. */
  const parsed = readJson(file)
  if (parsed === undefined) {
    add(into, `${prefix}-json`, declared, "the file is not valid JSON")
    return
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    add(into, `${prefix}-root`, declared, "the root must be a component object with a string type")
    return
  }
  if (parsed.v !== undefined && parsed.v !== 1) {
    add(into, `${prefix}-version`, declared, `a static fallback must be view v1, got v=${String(parsed.v)}`)
  }
  /** The static fallback a v1-only app must be able to draw; the cast is the JSON boundary README. */
  const measured = measureView(parsed as DshGoView)
  if (measured.nodes > LIMITS.viewNodes) add(into, `${prefix}-nodes`, declared, `${measured.nodes} nodes, over ${LIMITS.viewNodes}`)
  if (measured.depth > LIMITS.viewDepth) add(into, `${prefix}-depth`, declared, `depth ${measured.depth}, over ${LIMITS.viewDepth}`)
  for (const node of componentNodes(parsed)) {
    /** The component name, typed for the catalog lookups below. */
    const type = String(node.type)
    if (!V1_COMPONENTS.includes(type)) {
      add(into, isV2Component(type) ? `${prefix}-v2-component` : `${prefix}-component`, declared, isV2Component(type) ? `"${type}" is v2-only; a static fallback must stay v1` : `"${type}" is not a v1 component`)
    }
    if (type === "image") auditImage(into, node, declared, prefix)
  }
  if (hasBinding(parsed)) add(into, `${prefix}-binding`, declared, "a static fallback has no data model, so it must carry no `$` binding")
  for (const finding of lintDesign(parsed as DshGoView, { version: 1 })) {
    add(into, `${prefix}-design:${finding.rule}`, `${declared}${finding.path}`, finding.message)
  }
}

/** Check one image node's `src`: an `asset:` reference or a small `data:` URL, nothing else. */
function auditImage(into: Finding[], node: Record<string, unknown>, declared: string, prefix: string): void {
  /** The image's src, when it declares one. */
  const src = node.src
  if (typeof src !== "string") {
    if (!isBinding(src)) add(into, `${prefix}-image`, declared, "an image's src must be a string")
    return
  }
  if (src.startsWith("asset:")) {
    if (src.length > 512 || !/^asset:[A-Za-z0-9_~-][A-Za-z0-9._~-]*(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*\.([Pp][Nn][Gg]|[Jj][Pp][Ee]?[Gg]|[Ww][Ee][Bb][Pp]|[Gg][Ii][Ff])$/.test(src)) {
      add(into, `${prefix}-image`, declared, `asset reference ${JSON.stringify(src.slice(0, 60))} is not a legal asset path (<= 512 chars, image suffix)`)
    }
    return
  }
  if (src.startsWith("data:")) {
    if (src.length > 65536 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(src)) {
      add(into, `${prefix}-image`, declared, "a data: image must be a base64 png/jpeg/webp/gif of at most 64 KiB")
    }
    return
  }
  add(into, `${prefix}-image`, declared, `image src ${JSON.stringify(src.slice(0, 60))} must be an asset: reference or a small data: URL`)
}

/** The three numbers one budget pins, the shape both tables share. */
interface BudgetShape {
  /** Serialized byte ceiling. */
  readonly bytes: number
  /** Component-node ceiling. */
  readonly nodes: number
  /** Nesting-depth ceiling. */
  readonly depth: number
}

/**
 * Compare the view kit's budget table against the vendored spec table.
 *
 * The gate lints static views against `LIMITS` (the spec), while the live kit decides at RUNTIME from
 * its own `BUDGETS`. Two tables that drifted apart would mean the gate and the engine disagree about
 * what fits — so the drift itself is a failure, checked as a pure comparison so the self-test can feed
 * a mutated table (the real pair always differs only if someone edits one side).
 */
function budgetDrift(actual: { readonly toolCard: BudgetShape; readonly panel: BudgetShape; readonly strip: BudgetShape }): Finding[] {
  /** Everything the comparison found. */
  const findings: Finding[] = []
  /** The kit value and the spec name it should match. */
  const pairs: readonly (readonly [string, BudgetShape])[] = [["toolCard", actual.toolCard], ["panel", actual.panel], ["strip", actual.strip]]
  for (const [name, seen] of pairs) {
    /** The spec's own numbers for this budget. */
    const spec = VIEW_BUDGETS[name]
    if (spec === undefined) {
      add(findings, "view-budget-drift", "specs/dsh-go/limits.ts", `the spec table has no "${name}" budget to compare against`)
      continue
    }
    if (seen.bytes !== spec.bytes || seen.nodes !== spec.nodes || seen.depth !== spec.depth) {
      add(findings, "view-budget-drift", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", `${name} budget ${seen.bytes}B/${seen.nodes} nodes/depth ${seen.depth} differs from the spec ${spec.bytes}B/${spec.nodes} nodes/depth ${spec.depth}`)
    }
  }
  return findings
}

/** Assert the tool-card budget rules on the kit that builds cards, with a paired positive control. */
function auditToolCardKit(into: Finding[]): void {
  /** A builder whose card carries a data binding, which a tool card must never ship. */
  const withBinding = toolCard<unknown, unknown>((): DshGoView => ({ v: 1, type: "text", text: { $: "data.x" } }))
  /** A legal card, the paired control that proves the refusal above is not vacuous. */
  const legal = toolCard<unknown, unknown>((): DshGoView => ({ v: 1, type: "text", text: "ok" }))
  if (Object.keys(withBinding(undefined, undefined)).length !== 0) add(into, "view-toolcard-binding", "dshGo tool cards", "a card carrying a `$` binding was not degraded to {}")
  if (legal(undefined, undefined)["dsh-go/view"] === undefined) add(into, "view-toolcard-control", "dshGo tool cards", "the paired positive control produced no card, so the binding refusal above proves nothing")
}

/** Every TypeScript source under `packages/<pkg>/src` (the tool-card builders live there). */
function cardSourceFiles(root: string): string[] {
  /** The files found, in a deterministic order. */
  const out: string[] = []
  /** The packages root, when the audited tree has one. */
  const packages = join(root, "packages")
  if (!existsSync(packages)) return out
  for (const entry of readdirSync(packages, { withFileTypes: true }).sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    /** That package's src tree, when it has one. */
    const src = join(packages, entry.name, "src")
    if (existsSync(src)) walkSources(src, out)
  }
  return out
}

/** Collect every `.ts` file under one directory tree, skipping any `node_modules`. */
function walkSources(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walkSources(join(dir, entry.name), out)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(join(dir, entry.name))
  }
}

/** A card builder that constructs a tappable node is a NOTE, mirroring the official cardTaps note. */
function auditToolCardSources(into: Finding[], root: string): void {
  for (const file of cardSourceFiles(root)) {
    /** The file's source with comments removed, so prose cannot trip the rule. */
    const code = stripComments(readFileSync(file, "utf8"))
    if (!/\btoolCard\s*\(/.test(code)) continue
    if (!/\b(?:actions|confirm)\s*\(/.test(code)) continue
    add(into, "view-toolcard-actions", relative(root, file), "this file builds a tool card and also constructs a tappable node; the app hides buttons and confirmations on a version-0 card (NOTE, mirroring the official cardTaps note)", "note")
  }
}

/** The COMPAT lane: the legacy v1 fallback and the kit's degradation path (user-set hard requirement). */
function auditCompat(view: PackageView): Finding[] {
  /** Everything this lane found. */
  const findings: Finding[] = []
  /** The static views the manifest declares. */
  const declared = declaredStaticViews(view)
  if (declared.length === 0) add(findings, "compat-view-declared", "dshGo.contributes.panels", "no panel declares a static fallback, so a bridgeless host has nothing to draw", "note")
  for (const entry of declared) {
    /** The absolute file the declaration names. */
    const file = entry.file
    /** True when the resolved path stays inside the package. */
    const inside = file === view.root || file.startsWith(view.root + sep)
    if (!inside || !existsSync(file)) {
      add(findings, "compat-view-missing", entry.declared, "a DECLARED static view must resolve inside the package and exist")
      continue
    }
    /** The parsed fallback tree. */
    const parsed = readJson(file)
    if (!isRecord(parsed)) {
      add(findings, "compat-view-json", entry.declared, "a DECLARED static view must parse as JSON")
      continue
    }
    if (parsed.v !== 1) add(findings, "compat-view-version", entry.declared, `a static fallback must be view v1, got v=${String(parsed.v)}`)
    for (const node of componentNodes(parsed)) {
      /** The component name this node draws. */
      const type = String(node.type)
      if (isV2Component(type)) add(findings, "compat-view-v2", entry.declared, `"${type}" is v2-only; an older app cannot draw it, so a DECLARED static view must not carry it`)
    }
    if (hasBinding(parsed)) add(findings, "compat-view-binding", entry.declared, "a DECLARED static view is rendered without a host half, so a `$` binding would show as an em dash")
  }
  if (typeof adaptView !== "function") add(findings, "compat-kit-export", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", "the kit no longer exports `adaptView`, so an older app has no degradation path")
  if (!Array.isArray(V1_COMPONENTS) || V1_COMPONENTS.length === 0) add(findings, "compat-kit-export", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", "the kit no longer exports a non-empty `V1_COMPONENTS`")
  auditDegradation(findings)
  auditCatalogPartition(findings)
  return findings
}

/** Assert `adaptView` downgrades EVERY v2-only component name to a v1 tree. */
function auditDegradation(into: Finding[]): void {
  for (const type of V2_ONLY_COMPONENTS) {
    /** A v2 tree rooted at this component. */
    const tree: DshGoView = { v: 2, type, text: "x", children: [{ type: "text", text: "y" }] }
    /** The same tree as an older app would receive it. */
    const adapted = adaptView(tree, null)
    /** The v2-only names still present after the downgrade. */
    const left = [...componentNodes(adapted)].map((node: Record<string, unknown>): string => String(node.type)).filter(isV2Component)
    if (left.length > 0) add(into, "compat-degrade", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", `adaptView left v2-only component(s) ${left.join(", ")} in a v1 tree (source ${type})`)
  }
}

/** Assert the adapter's v1/v2 catalogs partition the component names the vendored schema declares. */
function auditCatalogPartition(into: Finding[]): void {
  /** The view schema's declared component names, in schema order. */
  const schema = readJson(join(REPO_ROOT, "specs", "dsh-go", "schemas", "view.schema.json"))
  /** The `node` definition whose `allOf` branches each pin one component name. */
  const nodeDef = isRecord(schema) && isRecord(schema.$defs) && isRecord(schema.$defs.node) ? schema.$defs.node : undefined
  /** The `allOf` branches, one per component. */
  const branches = nodeDef !== undefined && Array.isArray(nodeDef.allOf) ? nodeDef.allOf : undefined
  if (branches === undefined) {
    add(into, "compat-catalog-schema", "specs/dsh-go/schemas/view.schema.json", "the vendored view schema has no $defs.node.allOf table; the catalog cross-check cannot run")
    return
  }
  /** The component names the schema declares. */
  const schemaNames: string[] = []
  for (const branch of branches) {
    if (!isRecord(branch) || !isRecord(branch.if) || !isRecord(branch.if.properties) || !isRecord(branch.if.properties.type)) continue
    /** The branch's pinned type const. */
    const name = branch.if.properties.type.const
    if (typeof name === "string") schemaNames.push(name)
  }
  if (schemaNames.length === 0) {
    add(into, "compat-catalog-schema", "specs/dsh-go/schemas/view.schema.json", "the schema names no component types")
    return
  }
  /** Every catalog name the adapter knows. */
  const known = new Set<string>([...V1_COMPONENTS, ...V2_ONLY_COMPONENTS])
  for (const name of schemaNames) {
    if (!known.has(name)) add(into, "compat-catalog", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", `component "${name}" is declared by the vendored view schema but missing from the adapter's v1/v2 catalogs`)
  }
  for (const name of known) {
    if (!schemaNames.includes(name)) add(into, "compat-catalog", "specs/dsh-go/schemas/view.schema.json", `the adapter catalog names "${name}", which the vendored view schema does not declare`)
  }
  for (const name of V1_COMPONENTS) {
    if (V2_ONLY_COMPONENTS.includes(name)) add(into, "compat-catalog", "packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts", `"${name}" is listed as BOTH v1 and v2-only`)
  }
}

/** Strip `//` and `/* … *\/` comments so a rule quoted in prose cannot be read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

/** The host-half source files the HOST lane walks, when the caller did not supply its own. */
function hostSourcesOf(root: string): string[] {
  /** The candidate files. */
  const out: string[] = []
  for (const dir of HOST_SOURCE_DIRS) {
    /** The absolute directory this root declares. */
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    /** The directory's entries, sorted for a deterministic report. */
    const entries: Dirent[] = readdirSync(abs, { withFileTypes: true })
    for (const entry of entries.sort((a: Dirent, b: Dirent): number => a.name.localeCompare(b.name))) {
      if (entry.isFile() && /^dshgo-.*\.ts$/.test(entry.name)) out.push(join(abs, entry.name))
    }
  }
  /** The adapter file that owns the one sanctioned service probe. */
  const adapter = join(root, ADAPTER_SOURCE)
  if (existsSync(adapter)) out.push(adapter)
  return out
}

/** The `DSHGO_*` string constants one source file declares, so a registration argument resolves. */
function constantsOf(source: string): Map<string, string> {
  /** The declared constants, name -> value. */
  const out = new Map<string, string>()
  /** The declaration shape this repository uses: `const NAME = "value"`. */
  const pattern = /\b(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[^=\n]+)?=\s*"([^"]*)"/g
  for (const match of source.matchAll(pattern)) out.set(match[1], match[2])
  return out
}

/** Resolve one registration argument to a literal id, or undefined when it is a dynamic variable. */
function resolveArgument(argument: string, constants: ReadonlyMap<string, string>): string | undefined {
  /** The argument with surrounding quotes, when it is a string literal. */
  const literal = /^["']([^"']+)["']$/.exec(argument)
  if (literal !== null) return literal[1]
  if (/^[A-Z][A-Z0-9_]*$/.test(argument)) return constants.get(argument)
  return undefined
}

/** What a static walk of the host half found: registrations, binding forms and the sources read. */
interface HostScan {
  /** The panel ids a `dshGoPanel(id, …)` call registers. */
  readonly panels: readonly string[]
  /** The strip ids a `dshGoStrip(id, …)` call registers. */
  readonly strips: readonly string[]
  /** The action ids a `dshGoOn(id, …)` call or a computed handler-map key registers. */
  readonly handlers: readonly string[]
  /** True when the standard `ctx.inject(['dshGo'], …)` form appears in code. */
  readonly directInject: boolean
  /** True when the adapter's service probe (`service("dshGo")` / `onServiceBound(["dshGo"])`) appears. */
  readonly serviceProbe: boolean
  /** True when an optional-inject spelling (`'dshGo?'`) appears in code. */
  readonly optionalInject: boolean
  /** True when a top-level `inject` array carries `dshGo`. */
  readonly topLevelInject: boolean
  /** The sources the walk read, for the report's measurement statement. */
  readonly sources: readonly string[]
}

/** Walk the host-half sources and extract the registrations and binding forms. */
function scanHost(root: string, supplied: readonly string[] | undefined): HostScan {
  /** The files this walk reads. */
  const files = supplied ?? hostSourcesOf(root)
  /** Every declared `DSHGO_*` constant, merged across the files. */
  const constants = new Map<string, string>()
  /** The concatenated, comment-stripped code of every file. */
  let code = ""
  for (const file of files) {
    /** One file's stripped source. */
    const stripped = stripComments(readFileSync(file, "utf8"))
    code += stripped
    for (const [name, value] of constantsOf(stripped)) constants.set(name, value)
  }
  /** The ids one call-shape regex collects from the concatenated code. */
  const collect = (pattern: RegExp): string[] => {
    /** The resolved ids, deduplicated. */
    const found = new Set<string>()
    for (const match of code.matchAll(pattern)) {
      /** The resolved id, when the argument is a literal or a known constant. */
      const id = resolveArgument(match[1], constants)
      if (id !== undefined) found.add(id)
    }
    return [...found].sort()
  }
  return {
    panels: collect(/dshGoPanel(?:<[^>]*>)?\s*\(\s*([A-Za-z0-9_."']+)/g),
    strips: collect(/dshGoStrip\??\.?\s*\(\s*([A-Za-z0-9_."']+)/g),
    handlers: collect(/dshGoOn\??\.?\s*\(\s*([A-Za-z0-9_."']+)/g).concat(collect(/\[([A-Z][A-Z0-9_]*)\]\s*:/g)),
    directInject: /inject\s*\(\s*\[\s*["']dshGo["']\s*\]/.test(code),
    serviceProbe: /service\s*\(\s*["']dshGo["']\s*\)/.test(code) || /onServiceBound\s*\(\s*\[\s*["']dshGo["']\s*\]/.test(code),
    optionalInject: /["']dshGo\?["']/.test(code),
    topLevelInject: /\binject\s*(?::|=)\s*\[[^\]]*["']dshGo["'][^\]]*\]/.test(code),
    sources: files,
  }
}

/** The HOST lane: the binding form, and one registration per declared surface. */
function auditHost(view: PackageView, supplied: readonly string[] | undefined): Finding[] {
  /** Everything this lane found. */
  const findings: Finding[] = []
  /** The walk over the host-half sources. */
  const scan = scanHost(view.root, supplied)
  if (scan.sources.length === 0) {
    add(findings, "host-sources", "packages/mpd-bundle-plugin/src", "no host-half source found; the HOST lane cannot run")
    return findings
  }
  if (scan.optionalInject) add(findings, "host-binding-optional", "host half", 'a \'dshGo?\' optional-inject spelling appears in code; cordis has no optional-dependency syntax, so that callback never runs')
  if (scan.topLevelInject) add(findings, "host-binding-top-level", "host half", 'a top-level `inject` array carries `dshGo`; a bridgeless host would fail to start the whole plugin')
  if (!scan.directInject && !scan.serviceProbe) add(findings, "host-binding", "host half", 'no binding form found: neither `ctx.inject([\'dshGo\'], …)` nor the adapter\'s `service("dshGo")` probe appears')
  /** The `dshGo` block the registrations are compared against. */
  const dshGo = view.dshGo
  /** The contributes block, when the manifest has one. */
  const contributes = dshGo !== undefined && isRecord(dshGo.contributes) ? dshGo.contributes : undefined
  if (contributes === undefined) return findings
  /** Every id the manifest declares, with the slot that declared it. */
  const declared = new Map<string, string>()
  for (const slot of SURFACES) {
    /** The slot's entries. */
    const entries = contributes[slot]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) if (isRecord(entry) && typeof entry.id === "string") declared.set(entry.id, slot)
  }
  /** Every id the host half registers. */
  const registered = new Set<string>([...scan.panels, ...scan.strips, ...scan.handlers])
  for (const [id, slot] of declared) {
    if (slot === "panels" && !scan.panels.includes(id)) add(findings, "host-panel-missing", `dshGo.contributes.panels[${id}]`, `the manifest declares a panel but no dshGoPanel("${id}", …) registration was found`)
    if (slot === "composer.strip" && !scan.strips.includes(id)) add(findings, "host-strip-missing", `dshGo.contributes.composer.strip[${id}]`, `the manifest declares a strip but no dshGoStrip("${id}", …) registration was found`)
  }
  for (const [id, slot] of declared) {
    /** The manifest entry behind this id. */
    const entry = (Array.isArray(contributes[slot]) ? contributes[slot] : []).find((candidate: unknown): boolean => isRecord(candidate) && candidate.id === id)
    if (slot === "panels" || slot === "composer.strip" || slot === "turn.note") continue
    if (isRecord(entry) && entry.effect !== undefined) continue
    if (isRecord(entry) && typeof entry.panel === "string") continue
    /** The static text that makes a strip ready without a handler. */
    if (isRecord(entry) && typeof entry.text === "string") continue
    if (!scan.handlers.includes(id)) add(findings, "host-handler-missing", `dshGo.contributes.${slot}[${id}]`, `the manifest declares a tappable id with no static effect, but no dshGoOn("${id}", …) handler was found`)
  }
  for (const id of registered) {
    if (!declared.has(id)) add(findings, "host-undeclared-id", `"${id}"`, "the host half registers this id but the manifest does not declare it")
  }
  return findings
}

/** Resolve the official checker inside a supplied checkout, or undefined when the path is not one. */
function resolveKitCheck(kit: string): string | undefined {
  for (const candidate of KIT_CHECK_PATHS) {
    /** The absolute candidate path. */
    const file = join(kit, candidate)
    if (existsSync(file)) return file
  }
  return undefined
}

/** What the official checker's report says once its one known false negative is accounted for. */
interface OfficialVerdict {
  /** Whether anything in the report actually stops the plugin. */
  readonly stops: boolean
  /** True when the only blocking item was the array-patch false negative described below. */
  readonly excludingPatch: boolean
  /** The error-severity items that were counted, for the detail line. */
  readonly reasons: readonly string[]
}

/**
 * Derive the official verdict from its JSON report, isolating the ONE known false negative.
 *
 * `sdk/plugin-kit/lib/check.js` requires `dsh.bundle.patch` to be a STRING. A DSH bundle package may
 * declare an ARRAY of patch layers (this repository does: `cordis.patch.yml` plus the `mpd` preset),
 * and the official checker then reports "Not a DSH bundle" for a package that is one. This gate's own
 * MANIFEST lane resolves every declared patch path, so when THAT lane is clean and the only official
 * error is that package item, the false negative is excluded EXPLICITLY — printed as a note, never
 * silently. Every other error, any non-`ok` manifest state and any fatal view still stop the plugin.
 */
function officialVerdict(report: unknown, bundlePatchVerified: boolean): OfficialVerdict {
  if (!isRecord(report)) return { stops: true, excludingPatch: false, reasons: ["no parsable report"] }
  if (typeof report.unreadable === "string") return { stops: true, excludingPatch: false, reasons: [report.unreadable] }
  /** The error-severity items of the package layer. */
  const packageErrors: Record<string, unknown>[] = []
  if (Array.isArray(report.package)) {
    for (const item of report.package) if (isRecord(item) && item.severity === "error") packageErrors.push(item)
  }
  /** The error-severity manifest issues. */
  const manifestIssues: Record<string, unknown>[] = []
  if (isRecord(report.manifest) && Array.isArray(report.manifest.issues)) {
    for (const item of report.manifest.issues) if (isRecord(item) && (item.severity === "error" || item.kind === "error" || item.kind === "fatal")) manifestIssues.push(item)
  }
  /** The fatal or error-bearing views. */
  const viewIssues: Record<string, unknown>[] = []
  if (Array.isArray(report.views)) {
    for (const view of report.views) {
      if (!isRecord(view)) continue
      if (view.fatal === true || typeof view.unreadable === "string") viewIssues.push({ path: view.where, message: view.unreadable ?? "fatal view" })
      if (Array.isArray(view.issues)) {
        for (const item of view.issues) if (isRecord(item) && (item.severity === "error" || item.kind === "error" || item.kind === "fatal")) viewIssues.push(item)
      }
    }
  }
  /** Every error item, as one flat list. */
  const all: Record<string, unknown>[] = [...packageErrors, ...manifestIssues, ...viewIssues]
  /** The manifest state the report names. */
  const state = isRecord(report.manifest) && typeof report.manifest.state === "string" ? report.manifest.state : "n/a"
  /** True when the ONLY blocking item is the string-vs-array patch assumption. */
  const onlyPatch = all.length === 1 && all[0].code === "package" && all[0].path === "/dsh/bundle/patch" && bundlePatchVerified
  if (all.length === 0 && state === "ok") return { stops: false, excludingPatch: false, reasons: [] }
  if (onlyPatch) return { stops: false, excludingPatch: true, reasons: ["array-patch false negative"] }
  return {
    stops: true,
    excludingPatch: false,
    reasons: all.map((item: Record<string, unknown>): string => `${String(item.path ?? "?")} ${String(item.message ?? item.code ?? "")}`.trim()).concat(state === "ok" ? [] : [`manifest state ${state}`]),
  }
}

/** The CROSS-CHECK lane: the official checker's verdict against this gate's own. */
function runCrossCheck(root: string, lanes: readonly LaneResult[]): CrossCheckResult {
  /** The checkout the caller named, when it named one. */
  const kit = process.env[KIT_ENV]
  if (kit === undefined || kit === "") {
    return {
      status: "not-passed",
      detail: `NOT-PASSED: ${KIT_ENV} is not set, so the official checker did not run (a cross-check that did not run is never a green). Provide a dsh-Go checkout: ${KIT_ENV}=<checkout> node scripts/verify-dshgo-standard.ts`,
      findings: [],
      kit: null,
      officialExit: null,
    }
  }
  /** The official checker inside that checkout. */
  const script = resolveKitCheck(kit)
  if (script === undefined) {
    return {
      status: "not-passed",
      detail: `NOT-PASSED: ${KIT_ENV}=${kit} is not a DSH-Go checkout (no ${KIT_CHECK_PATHS.join(" or ")}); the official checker did not run`,
      findings: [],
      kit,
      officialExit: null,
    }
  }
  /** The official checker's own run against this package. */
  const run = spawnSync(process.execPath, [script, root, "--json"], { encoding: "utf8", timeout: CROSS_CHECK_TIMEOUT_MS, maxBuffer: CROSS_CHECK_MAX_BUFFER })
  if (run.error !== undefined || run.status === null) {
    return {
      status: "not-passed",
      detail: `NOT-PASSED: the official checker could not be run (${run.error === undefined ? "no exit status" : run.error.message})`,
      findings: [{ rule: "crosscheck-run", path: script, detail: "the official checker could not be run; the cross-check did not happen", severity: "note" }],
      kit,
      officialExit: run.status,
    }
  }
  /** The official checker's parsed JSON report, when it printed one. */
  let report: unknown
  try {
    report = JSON.parse(run.stdout)
  } catch {
    return {
      status: "not-passed",
      detail: `NOT-PASSED: the official checker exited ${run.status} but printed no parsable --json report`,
      findings: [{ rule: "crosscheck-run", path: script, detail: `exit ${run.status} with an unparsable report: ${run.stdout.slice(0, 200) || run.stderr.slice(0, 200)}`, severity: "note" }],
      kit,
      officialExit: run.status,
    }
  }
  /** Whether THIS gate's own package lane found the patch declaration sound. */
  const bundlePatchVerified = !lanes.some((lane: LaneResult): boolean => lane.findings.some((finding: Finding): boolean => (finding.rule === "bundle-patch" || finding.rule === "bundle-patch-missing") && finding.severity === "error"))
  /** The official verdict, with the one known false negative isolated. */
  const official = officialVerdict(report, bundlePatchVerified)
  /** Whether this gate has failing findings. */
  const ownStops = countErrors(lanes) > 0
  /** A one-line comparison a reader can check without re-running anything. */
  const detail = `official check.mjs exit=${run.status} stops=${String(official.stops)}${official.excludingPatch ? " (array-patch false negative excluded: the official checker requires a string patch, DSH allows an array and this gate verified every path)" : ""}; this gate stops=${String(ownStops)}`
  if (official.stops === ownStops) {
    return {
      status: "passed",
      detail: `PASSED: verdicts agree — ${detail}`,
      findings: official.excludingPatch ? [{ rule: "crosscheck-normalized", path: root, detail: "the official checker's only blocking item was its string-only `dsh.bundle.patch` assumption; every declared patch path is resolved by the MANIFEST lane", severity: "note" }] : [],
      kit,
      officialExit: run.status,
    }
  }
  return {
    status: "failed",
    detail: `FAILED: verdicts DISAGREE — ${detail}${official.reasons.length === 0 ? "" : `; official items: ${official.reasons.join(" | ")}`}`,
    findings: [{ rule: "crosscheck-verdict", path: root, detail: `the official checker and this gate disagree: ${detail}`, severity: "error" }],
    kit,
    officialExit: run.status,
  }
}

/** Run the five static lanes over one package root. */
function auditStatic(root: string, hostSources: readonly string[] | undefined): readonly LaneResult[] {
  /** The parsed package every lane reads. */
  const view = loadPackage(root)
  return [
    { lane: "MANIFEST", findings: [...auditPackage(view), ...auditManifest(view)] },
    { lane: "VIEW", findings: auditViews(view) },
    { lane: "COMPAT", findings: auditCompat(view) },
    { lane: "HOST", findings: auditHost(view, hostSources) },
  ]
}

/** One declaration point that restates the pinned dsh-Go commit, and how its text yields it. */
interface PinSite {
  /** Stable label the findings and the report's PIN line print. */
  readonly id: string
  /** Repository-relative path the literal lives in. */
  readonly file: string
  /** Extract the commit this site states from its file's text; null when it states none. */
  readonly select: (text: string) => string | null
  /** Build one synthetic file text at `commit`, so a self-test arm can perturb a site IN MEMORY. */
  readonly fixture: (commit: string) => string
}

/** One site's reading: where it lives, which commit it stated, and whether its file was there at all. */
interface PinReading {
  /** Stable label, copied from the site. */
  readonly id: string
  /** Repository-relative path, copied from the site. */
  readonly file: string
  /** The commit the site stated, or null when its file was unreadable or stated none. */
  readonly commit: string | null
  /** True when the file itself is not there — an absence of the FILE, which is not the same fact as a missing pin. */
  readonly absent: boolean
}

/** The pin check's verdict: the agreed commit (null when there is none), the readings and the findings. */
interface PinAudit {
  /** The single 40-hex commit the PRESENT sites agree on, or null when none is stated or a site dissents. */
  readonly commit: string | null
  /** Every site's reading, in declaration order — the evidence a `--json` consumer keeps. */
  readonly readings: readonly PinReading[]
  /** How many sites a packaged tree does not ship — printed as skipped and never counted as an error. */
  readonly skipped: number
  /** One `pin-site-missing` per site without a 40-hex commit, one `pin-site-skipped` note per unshipped file, and one `pin-disagreement` per dissenter. */
  readonly findings: readonly Finding[]
}

/** The exact shape a commit literal must have at every site: 40 lowercase hex characters. */
const PIN_COMMIT: RegExp = /^[0-9a-f]{40}$/

/** True when `value` is exactly a 40-hex commit literal. */
function isCommit(value: string): boolean {
  return PIN_COMMIT.test(value)
}

/** Build a selector returning the first capture group of `marker`'s first match — the commit it names. */
function capturedCommit(marker: RegExp): (text: string) => string | null {
  return (text: string): string | null => {
    /** The marker's first match in the site's text. */
    const found = marker.exec(text)
    return found === null ? null : found[1] ?? null
  }
}

/** Read the structured site's `commit` field; the one declaration point that is JSON, not prose. */
function jsonCommit(text: string): string | null {
  try {
    /** The parsed document, when it is a JSON object. */
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return null
    /** The value of its `commit` field. */
    const commit = parsed.commit
    return typeof commit === "string" ? commit : null
  } catch {
    return null
  }
}

/**
 * The contract's seven declaration points as EIGHT readings: the workflow point is one requirement but
 * two files, and each reading is the exact sentence / field / line the pin is hand-maintained in.
 */
const PIN_SITES: readonly PinSite[] = [
  {
    id: "SOURCE.json",
    file: join("specs", "dsh-go", "SOURCE.json"),
    select: jsonCommit,
    fixture: (commit: string): string => JSON.stringify({ repo: "https://github.com/ccch1mneyyy/dsh-Go", commit }, null, 2),
  },
  {
    id: "limits.ts header",
    file: join("specs", "dsh-go", "limits.ts"),
    select: capturedCommit(/^\/\/ SOURCE OF TRUTH:.*?`([0-9a-f]{40})`/m),
    fixture: (commit: string): string => `// DSH-Go protocol v1 — the FROZEN SPEC DATA this repository conforms to.\n//\n// SOURCE OF TRUTH: \`ccch1mneyyy/dsh-Go\` at commit \`${commit}\`\n// (2026-11-09), file \`runtime/bridge/dsh-go-bridge/lib/native/limits.js\`.\n`,
  },
  {
    id: "verify-dshgo-standard.ts header",
    file: join("scripts", "verify-dshgo-standard.ts"),
    select: capturedCommit(/^\/\/ THE STANDARD IT ENCODES:.*?at commit `([0-9a-f]{40})`/m),
    fixture: (commit: string): string => `// THE STANDARD IT ENCODES: \`ccch1mneyyy/dsh-Go\` at commit \`${commit}\`\n// (2026-11-09). The numeric table is the app's limits.js.\n`,
  },
  {
    id: "verify-dshgo-standard.ts render line",
    file: join("scripts", "verify-dshgo-standard.ts"),
    select: capturedCommit(/standard: ccch1mneyyy\/dsh-Go@([0-9a-f]{40})/),
    fixture: (commit: string): string => `  console.log(\`\${TAG} standard: ccch1mneyyy/dsh-Go@${commit} (spec data under specs/dsh-go/)\`)\n`,
  },
  {
    id: "docs/dsh-go-standard.md",
    file: join("docs", "dsh-go-standard.md"),
    select: capturedCommit(/at commit\s+`([0-9a-f]{40})`/),
    fixture: (commit: string): string => `This page states the standard. The standard is pinned to \`ccch1mneyyy/dsh-Go\` at commit\n\`${commit}\` (2026-11-09). The enforcement point is\n\`node scripts/verify-dshgo-standard.ts\`.\n`,
  },
  {
    id: "docs/dsh-go-standard.zh-CN.md",
    file: join("docs", "dsh-go-standard.zh-CN.md"),
    select: capturedCommit(/的提交\s*`([0-9a-f]{40})`/),
    fixture: (commit: string): string => `本页说明本 bundle 所实现的标准。标准钉在\n\`ccch1mneyyy/dsh-Go\` 的提交 \`${commit}\`（2026-11-09）。执行点是\n\`node scripts/verify-dshgo-standard.ts\`。\n`,
  },
  {
    id: "publish.yml",
    file: join(".github", "workflows", "publish.yml"),
    select: capturedCommit(/repository: ccch1mneyyy\/dsh-Go\s*\n\s*ref: ([0-9a-f]{40})/),
    fixture: (commit: string): string => `        with:\n          repository: ccch1mneyyy/dsh-Go\n          ref: ${commit}\n          path: .dsh-go-kit\n`,
  },
  {
    id: "gates.yml",
    file: join(".github", "workflows", "gates.yml"),
    select: capturedCommit(/repository: ccch1mneyyy\/dsh-Go\s*\n\s*ref: ([0-9a-f]{40})/),
    fixture: (commit: string): string => `        with:\n          repository: ccch1mneyyy/dsh-Go\n          ref: ${commit}\n          path: .dsh-go-kit\n`,
  },
]

/**
 * Extract each site's commit from its text — the PURE half, so a self-test arm never touches the disk.
 * A site ABSENT from `texts` has no file at all; a site mapped to `null` has a file that could not be
 * read, so it is still expected to state a commit.
 */
function extractPins(texts: ReadonlyMap<string, string | null>): readonly PinReading[] {
  return PIN_SITES.map((site: PinSite): PinReading => {
    /** The site's text, undefined when the caller supplied none because the file is not there. */
    const text = texts.get(site.id)
    return { id: site.id, file: site.file, commit: text === undefined || text === null ? null : site.select(text), absent: text === undefined }
  })
}

/**
 * Read every pin site under `root` from disk and extract its commit. A file that does not exist leaves
 * NO entry for its site, which is what `extractPins` reports as `absent`; a file that exists but cannot
 * be read still has to state a commit.
 */
function readPins(root: string): readonly PinReading[] {
  /** The site texts, keyed by site id; a site with no entry has no file under `root`. */
  const texts = new Map<string, string | null>()
  for (const site of PIN_SITES) {
    /** The site's path under the audited root. */
    const path = join(root, site.file)
    if (!existsSync(path)) continue
    try {
      texts.set(site.id, readFileSync(path, "utf8"))
    } catch {
      texts.set(site.id, null)
    }
  }
  return extractPins(texts)
}

/**
 * True when `root` is a CHECKOUT rather than a packaged tree: a `.git` entry exists, as a directory in
 * a clone or as a file in a worktree. Every CI run and this repository are checkouts, so a deleted or
 * renamed pin site still fails loudly; a packed install has no `.git` and ships no `.github/**`.
 */
function isCheckout(root: string): boolean {
  return existsSync(join(root, ".git"))
}

/**
 * Judge the readings. A site whose file IS PRESENT but states no 40-hex commit is an error in BOTH
 * modes. A site whose file is ABSENT is an error only in a CHECKOUT; a packaged tree does not ship
 * `.github/**`, so its workflow sites are NOTES there and never change the exit code.
 */
function auditPin(readings: readonly PinReading[], checkout: boolean): PinAudit {
  /** The findings this check contributes. */
  const findings: Finding[] = []
  for (const reading of readings) {
    if (reading.absent) {
      findings.push(checkout
        ? {
            rule: "pin-site-missing",
            path: reading.file,
            detail: `${reading.id}: the file is absent from this checkout — a deleted or renamed pin site must fail, not silently shrink the audit`,
            severity: "error",
          }
        : {
            rule: "pin-site-skipped",
            path: reading.file,
            detail: `${reading.id}: the file is not shipped in a packaged tree (no \`.git\`), so its pin cannot be read here`,
            severity: "note",
          })
      continue
    }
    if (reading.commit !== null && isCommit(reading.commit)) continue
    findings.push({
      rule: "pin-site-missing",
      path: reading.file,
      detail: `${reading.id} states ${reading.commit === null ? "no dsh-Go commit literal" : `\`${reading.commit}\`, which is not a 40-hex commit`}; every present pin site must state the same peeled release commit`,
      severity: "error",
    })
  }
  /** Every 40-hex commit the sites state, in reading order; a site with none contributes nothing here. */
  const stated = readings.map((reading: PinReading): string => reading.commit ?? "").filter((commit: string): boolean => isCommit(commit))
  /** The value the most sites state — the reference a dissenter is reported against (first-seen on a tie). */
  let agreed: string | null = null
  /** How many sites state `agreed`. */
  let agreedCount = 0
  for (const value of new Set(stated)) {
    /** How many readings state this value. */
    const count = stated.filter((commit: string): boolean => commit === value).length
    if (count > agreedCount) {
      agreed = value
      agreedCount = count
    }
  }
  if (agreed !== null) {
    for (const reading of readings) {
      if (reading.commit === null || reading.commit === agreed) continue
      findings.push({
        rule: "pin-disagreement",
        path: reading.file,
        detail: `${reading.id} states \`${reading.commit}\` while ${agreedCount} of ${readings.length} sites state \`${agreed}\`: ${readings.map((candidate: PinReading): string => `${candidate.id}=${candidate.commit ?? "none"}`).join(", ")}`,
        severity: "error",
      })
    }
  }
  return {
    commit: agreed !== null && findings.every((finding: Finding): boolean => finding.severity !== "error") ? agreed : null,
    readings,
    skipped: findings.filter((finding: Finding): boolean => finding.rule === "pin-site-skipped").length,
    findings,
  }
}

/** Count the failing findings across every lane. */
function countErrors(lanes: readonly LaneResult[]): number {
  return lanes.reduce((total: number, lane: LaneResult): number => total + lane.findings.filter((finding: Finding): boolean => finding.severity === "error").length, 0)
}

/** Print one lane's verdict and its findings. */
function renderLane(lane: LaneResult): void {
  /** This lane's failing findings. */
  const errors = lane.findings.filter((finding: Finding): boolean => finding.severity === "error")
  /** This lane's notes. */
  const notes = lane.findings.filter((finding: Finding): boolean => finding.severity === "note")
  console.log(`${TAG} ${lane.lane}: ${errors.length === 0 ? "PASS" : "FAIL"} (${errors.length} error(s), ${notes.length} note(s))`)
  for (const finding of lane.findings) console.log(`  [${finding.severity}] ${finding.rule} ${finding.path} — ${finding.detail}`)
}

/** Print the whole report and return the exit code the contract assigns. */
function render(report: AuditReport): number {
  console.log(`${TAG} root: ${report.root}`)
  console.log(`${TAG} standard: ccch1mneyyy/dsh-Go@f36bf91b0736e81ef40c2a7040b2ec337ca1ab40 (spec data under specs/dsh-go/)`)
  /** The pin-coherence check's failing findings, counted separately from the lanes. */
  const pinErrors = report.pin.findings.filter((finding: Finding): boolean => finding.severity === "error")
  /** The PIN line's verdict: the agreed commit, or FAIL plus the error count — its OWN line, not a lane. */
  const pinVerdict = report.pin.commit === null
    ? `FAIL — ${pinErrors.length} error(s) across ${report.pin.readings.length} site readings`
    : `PASS — ${report.pin.readings.length - report.pin.skipped} of ${report.pin.readings.length} site readings agree on ${report.pin.commit}${report.pin.skipped === 0 ? "" : ` (${report.pin.skipped} skipped: not shipped)`}`
  console.log(`${TAG} PIN: ${pinVerdict}`)
  for (const finding of report.pin.findings) console.log(`  [${finding.severity}] ${finding.rule} ${finding.path} — ${finding.detail}`)
  for (const lane of report.lanes) renderLane(lane)
  console.log(`${TAG} CROSS-CHECK: ${report.crossCheck.status.toUpperCase()} — ${report.crossCheck.detail}`)
  for (const finding of report.crossCheck.findings) console.log(`  [${finding.severity}] ${finding.rule} ${finding.path} — ${finding.detail}`)
  /** Failing findings across the static lanes, the pin check and the cross-check lane. */
  const errors = countErrors(report.lanes) + pinErrors.length + report.crossCheck.findings.filter((finding: Finding): boolean => finding.severity === "error").length
  if (errors > 0) {
    console.log(`${TAG} RESULT: VIOLATIONS — ${errors} error(s)`)
    return EXIT.VIOLATIONS
  }
  if (report.crossCheck.status !== "passed") {
    console.log(`${TAG} RESULT: NOT-PASSED — the official cross-check did not run`)
    return EXIT.NOT_PASSED
  }
  console.log(`${TAG} RESULT: LEGAL — manifest, views, compatibility, host half and the official cross-check all agree`)
  return EXIT.LEGAL
}

/** Build one fixture package (manifest, static views, patch file and host source) under a temp dir. */
function fixture(dir: string, manifest: Record<string, unknown>, views: Record<string, string>, host: string): void {
  mkdirSync(join(dir, "views"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, "cordis.patch.yml"), "# fixture patch\n")
  for (const [name, content] of Object.entries(views)) writeFileSync(join(dir, "views", name), content)
  writeFileSync(join(dir, "host.ts"), host)
}

/** A minimal legal package: one panel, one strip, two composer actions, two message actions. */
function legalManifest(): Record<string, unknown> {
  return {
    engines: { node: ">=24.9.0", dsh: ">=0.2.1-rc.5 <0.3.0" },
    dsh: { bundle: { patch: ["./cordis.patch.yml"] } },
    dshGo: {
      v: 1,
      title: { en: "Fixture", zh: "样例" },
      icon: "bolt",
      wants: ["message"],
      contributes: {
        panels: [{ id: "mpd", title: { en: "Panel", zh: "面板" }, icon: "bolt", placement: ["session.tab", "features"], presentation: "page", view: "./views/mpd.json" }],
        "composer.strip": [{ id: "mpd-status", icon: "team", panel: "mpd", text: "—" }],
        "composer.actions": [
          { id: "mpd-dispatch", label: { en: "Dispatch", zh: "派活" }, icon: "send" },
          { id: "mpd-board", label: { en: "Board", zh: "看板" }, icon: "panel", effect: { type: "open", page: "panel:mpd-team" } },
        ],
        "message.actions": [
          { id: "mpd-save", label: { en: "Save", zh: "保存" }, icon: "save" },
          { id: "mpd-copy", label: { en: "Copy", zh: "复制" }, icon: "copy" },
        ],
      },
    },
  }
}

/** A legal host half: the sanctioned binding form plus one registration per declared surface. */
const LEGAL_HOST: string = [
  'const DSHGO_PANEL_ID = "mpd"',
  'const DSHGO_STRIP_ID = "mpd-status"',
  'const DSHGO_DISPATCH = "mpd-dispatch"',
  'const DSHGO_SAVE = "mpd-save"',
  'const DSHGO_COPY = "mpd-copy"',
  "export function register(api: any): void {",
  "  api.dshGoPanel(DSHGO_PANEL_ID, {})",
  "  api.dshGoStrip?.(DSHGO_STRIP_ID, () => {})",
  "  api.dshGoOn?.(DSHGO_DISPATCH, () => {})",
  "}",
  "const surfaceActions = { [DSHGO_SAVE]: 1, [DSHGO_COPY]: 1 }",
  "ctx.inject(['dshGo'], (go: any) => { go.panel() })",
  "",
].join("\n")

/** A small legal v1 view a fixture can point at. */
const LEGAL_VIEW: string = JSON.stringify({ v: 1, type: "stack", children: [{ type: "text", text: "static" }] })

/** One self-test arm: a fixture expected to trip one named rule at one severity. */
interface Arm {
  /** The arm's name, printed with its verdict. */
  readonly name: string
  /** The rule the fixture must trip, or null for the clean control. */
  readonly rule: string | null
  /** The severity the expected rule must carry; ignored for the clean control. */
  readonly severity: "error" | "note"
  /** Build the fixture from a fresh temp directory; omitted only when `probe` supplies findings. */
  readonly build?: (dir: string) => void
  /** Findings this arm produces directly, for an assertion that is a pure comparison not a fixture. */
  readonly probe?: () => readonly Finding[]
}

/** The manifest fixture a mutating arm starts from, as a mutable copy. */
function mutableManifest(): { manifest: Record<string, unknown>; dshGo: Record<string, unknown>; contributes: Record<string, unknown[]> } {
  /** The legal fixture. */
  const manifest = legalManifest()
  /** Its `dshGo` block. */
  const dshGo = manifest.dshGo as Record<string, unknown>
  return { manifest, dshGo, contributes: dshGo.contributes as Record<string, unknown[]> }
}

/** A synthetic 40-hex commit the pin arms use as the AGREEING value — never a real upstream sha. */
const PIN_FIXTURE_A: string = "0123456789abcdef0123456789abcdef01234567"
/** A second synthetic 40-hex commit: the value ONE perturbed site is rewritten to. */
const PIN_FIXTURE_B: string = "89abcdef0123456789abcdef0123456789abcdef"
/** The one pin site the C5 disagreement arm perturbs, by its stable id. */
const PIN_PERTURBED_SITE: string = "docs/dsh-go-standard.md"
/** The two pin sites a PACKAGED tree does not ship — the `.github/**` workflow refs, and the only sites whose absence is a note. */
const PIN_WORKFLOW_SITES: readonly string[] = ["publish.yml", "gates.yml"]

/** Every site's text at one commit, built from each site's own shape — the pin arms' in-memory input. */
function pinTexts(commit: string): Map<string, string | null> {
  return new Map<string, string | null>(PIN_SITES.map((site: PinSite): [string, string | null] => [site.id, site.fixture(commit)]))
}

/** Rewrite ONE site's in-memory text to a different commit, leaving every other site untouched. */
function perturbPin(texts: Map<string, string | null>, id: string, commit: string): Map<string, string | null> {
  /** The site being perturbed. */
  const site = PIN_SITES.find((candidate: PinSite): boolean => candidate.id === id)
  if (site === undefined) throw new Error(`perturbPin: no pin site named ${id}`)
  texts.set(id, site.fixture(commit))
  return texts
}

/**
 * Assert the packaged/checkout split C5 branches on, from a reading set with the two workflow sites
 * ABSENT: packaged reports zero errors and exactly two skip notes (`skipped === 2`), a checkout reports
 * exactly two `pin-site-missing` errors (`skipped === 0`), a PRESENT-but-pinless site is an error in
 * BOTH (an absent file and an absent pin are different facts), and `isCheckout` reads a `.git` FILE as
 * a checkout. Each failure names the half it guards, so a mutated mode branch reddens at its own
 * assertion; the `.git` probe uses a fresh temp dir and never the real tree.
 */
function assertPinModeSplit(): void {
  /** The agreeing fixture with the two workflow sites REMOVED — what a packaged tree actually ships. */
  const withoutWorkflows = pinTexts(PIN_FIXTURE_A)
  for (const id of PIN_WORKFLOW_SITES) withoutWorkflows.delete(id)
  /** Those texts as readings: seven present sites plus two whose FILE is absent. */
  const readings = extractPins(withoutWorkflows)
  /** The two workflow paths, sorted — the only sites the absence branch may excuse. */
  const workflowPaths = PIN_SITES
    .filter((site: PinSite): boolean => PIN_WORKFLOW_SITES.includes(site.id))
    .map((site: PinSite): string => site.file)
    .sort()

  /** The PACKAGED verdict: absence of a workflow file must never be an error. */
  const packaged = auditPin(readings, false)
  /** The packaged verdict's failing findings. */
  const packagedErrors = packaged.findings.filter((finding: Finding): boolean => finding.severity === "error")
  if (packagedErrors.length !== 0) {
    throw new Error(`C5 packaged mode: a packaged tree must report ZERO errors for the absent workflow sites, got ${packagedErrors.map((finding: Finding): string => `${finding.rule}@${finding.path}`).join(", ")}`)
  }
  /** The packaged verdict's skip notes. */
  const skipNotes = packaged.findings.filter((finding: Finding): boolean => finding.rule === "pin-site-skipped")
  if (skipNotes.length !== 2 || packaged.skipped !== 2) {
    throw new Error(`C5 packaged mode: the absent workflow sites must produce exactly TWO pin-site-skipped notes and skipped === 2, got ${skipNotes.length} note(s) and skipped ${packaged.skipped}`)
  }
  /** The paths those notes name, sorted. */
  const notePaths = skipNotes.map((finding: Finding): string => finding.path).sort()
  if (notePaths.join("|") !== workflowPaths.join("|")) {
    throw new Error(`C5 packaged mode: the two skip notes must be the two workflow sites ${workflowPaths.join(", ")}, got ${notePaths.join(", ") || "none"}`)
  }

  /** The CHECKOUT verdict over the SAME readings: each absent workflow site is now an error. */
  const checkedOut = auditPin(readings, true)
  /** The checkout verdict's failing findings. */
  const checkoutErrors = checkedOut.findings.filter((finding: Finding): boolean => finding.severity === "error")
  if (checkoutErrors.length !== 2 || checkedOut.skipped !== 0) {
    throw new Error(`C5 checkout mode: an absent pin site must produce exactly TWO pin-site-missing errors and skipped === 0, got ${checkoutErrors.length} error(s) and skipped ${checkedOut.skipped}`)
  }
  if (checkoutErrors.some((finding: Finding): boolean => finding.rule !== "pin-site-missing")) {
    throw new Error(`C5 checkout mode: both checkout errors must be pin-site-missing, got ${checkoutErrors.map((finding: Finding): string => finding.rule).join(", ")}`)
  }
  /** The checkout errors' paths, sorted. */
  const missingPaths = checkoutErrors.map((finding: Finding): string => finding.path).sort()
  if (missingPaths.join("|") !== workflowPaths.join("|")) {
    throw new Error(`C5 checkout mode: the two errors must be the two workflow sites ${workflowPaths.join(", ")}, got ${missingPaths.join(", ") || "none"}`)
  }

  /** The agreeing fixture with ONE PRESENT site degraded to prose that states no commit at all. */
  const pinless = pinTexts(PIN_FIXTURE_A)
  pinless.set(PIN_PERTURBED_SITE, "This page states no pinned commit.\n")
  /** The PACKAGED verdict over that present-but-pinless site: absence of a PIN still fails. */
  const pinlessPackaged = auditPin(extractPins(pinless), false)
  /** That verdict's failing findings. */
  const pinlessErrors = pinlessPackaged.findings.filter((finding: Finding): boolean => finding.severity === "error")
  /** The pinless site's own path, resolved from its stable id. */
  const pinlessPath = PIN_SITES.find((site: PinSite): boolean => site.id === PIN_PERTURBED_SITE)?.file ?? PIN_PERTURBED_SITE
  /** The single error that present-but-pinless site must produce. */
  const [pinlessError] = pinlessErrors
  if (pinlessErrors.length !== 1 || pinlessError === undefined || pinlessError.rule !== "pin-site-missing" || pinlessError.path !== pinlessPath || pinlessPackaged.skipped !== 0) {
    throw new Error(`C5 packaged present-pinless: a PRESENT site stating no commit must be exactly one pin-site-missing error in a packaged tree, got ${pinlessErrors.map((finding: Finding): string => `${finding.rule}@${finding.path}`).join(", ") || "none"} with skipped ${pinlessPackaged.skipped}`)
  }

  /** A throwaway tree for the `.git` probe — never the real repository. */
  const base = mkdtempSync(join(tmpdir(), "dshgo-standard-ischeckout-"))
  try {
    /** A directory carrying `.git` as a FILE — the git-worktree shape. */
    const worktree = join(base, "worktree")
    /** A directory carrying no `.git` at all — the packaged shape. */
    const shipped = join(base, "shipped")
    mkdirSync(worktree)
    mkdirSync(shipped)
    writeFileSync(join(worktree, ".git"), "gitdir: /nonexistent\n")
    if (!isCheckout(worktree)) throw new Error("C5 isCheckout: a `.git` FILE (a worktree) must read as a checkout")
    if (isCheckout(shipped)) throw new Error("C5 isCheckout: a directory with no `.git` must read as a packaged tree")
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

/** The self-test arms: one clean control plus a negative control for every rule family. */
const ARMS: readonly Arm[] = [
  {
    name: "clean control: a legal manifest, v1 view and host half produce no finding",
    rule: null,
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST) },
  },
  {
    name: "missing dshGo manifest",
    rule: "manifest-missing",
    severity: "error",
    build: (dir) => { fixture(dir, { engines: { dsh: ">=0.2.1-rc.5" }, dsh: { bundle: { patch: ["./cordis.patch.yml"] } } }, {}, LEGAL_HOST) },
  },
  {
    name: "protocol version not 1",
    rule: "manifest-version",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, dshGo } = mutableManifest()
      dshGo.v = 2
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "contributes is not an object",
    rule: "manifest-contributes",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, dshGo } = mutableManifest()
      dshGo.contributes = "none"
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a manifest over the 16 KiB budget",
    rule: "manifest-bytes",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, dshGo } = mutableManifest()
      dshGo.title = { en: "x".repeat(20000), zh: "x".repeat(20000) }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a slot that is not an array",
    rule: "slot-shape",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes.panels = { id: "mpd" } as unknown as unknown[]
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "more panels than the protocol allows",
    rule: "slot-count",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes.panels = ["a", "b", "c", "d", "e"].map((id: string) => ({ id, view: "./views/mpd.json" }))
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an id that breaks the protocol pattern",
    rule: "id-shape",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["composer.actions"][0] = { id: "bad id!", label: "x" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "the same id declared by two slots",
    rule: "id-duplicate",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["composer.actions"][0] = { id: "mpd", label: "x" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an over-length label is a NOTE, not a failure",
    rule: "text-too-long",
    severity: "note",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, dshGo } = mutableManifest()
      dshGo.title = { en: "x".repeat(30), zh: "样例" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an unknown want value",
    rule: "wants-value",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, dshGo } = mutableManifest()
      dshGo.wants = ["draftx"]
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "`message` wanted with no message.actions",
    rule: "wants-pairing",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["message.actions"] = []
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an effect kind outside the six static kinds",
    rule: "effect-kind",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["composer.actions"][1] = { id: "mpd-board", label: "Board", effect: { type: "patch" } }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "more than four effects on one action",
    rule: "effect-count",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["composer.actions"][1] = { id: "mpd-board", label: "Board", effect: [{ type: "toast" }, { type: "toast" }, { type: "toast" }, { type: "toast" }, { type: "toast" }] }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an unknown panel placement",
    rule: "panel-placement",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes.panels[0] = { id: "mpd", placement: ["floating"], view: "./views/mpd.json" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "an unknown presentation",
    rule: "panel-presentation",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes.panels[0] = { id: "mpd", presentation: "modal", view: "./views/mpd.json" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a strip naming an undeclared panel",
    rule: "strip-panel",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest, contributes } = mutableManifest()
      contributes["composer.strip"] = [{ id: "mpd-status", panel: "ghost", text: "—" }]
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a declared view file that does not exist",
    rule: "view-path",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), {}, LEGAL_HOST) },
  },
  {
    name: "no engines.dsh is a NOTE",
    rule: "engines-dsh",
    severity: "note",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest } = mutableManifest()
      manifest.engines = { node: ">=24.9.0" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "no dsh.bundle.patch",
    rule: "bundle-patch",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest } = mutableManifest()
      manifest.dsh = {}
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a declared patch file that does not exist",
    rule: "bundle-patch-missing",
    severity: "error",
    build: (dir) => {
      /** The mutable fixture. */
      const { manifest } = mutableManifest()
      manifest.dsh = { bundle: { patch: ["./missing.patch.yml"] } }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
    },
  },
  {
    name: "a static view that is not JSON",
    rule: "view-json",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": "{ not json" }, LEGAL_HOST) },
  },
  {
    name: "a static view whose root is not a component",
    rule: "view-root",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1 }) }, LEGAL_HOST) },
  },
  {
    name: "a v2-only component in a static view",
    rule: "view-v2-component",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "badge", text: "x" }] }) }, LEGAL_HOST) },
  },
  {
    name: "an unknown component name in a static view",
    rule: "view-component",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "wobble", text: "x" }] }) }, LEGAL_HOST) },
  },
  {
    name: "a data binding in a static view",
    rule: "view-binding",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "text", text: { $: "data.x" } }) }, LEGAL_HOST) },
  },
  {
    name: "a static view over the node budget",
    rule: "view-nodes",
    severity: "error",
    build: (dir) => {
      /** 130 text nodes, over the panel's 120. */
      const wide = { v: 1, type: "stack", children: Array.from({ length: 130 }, () => ({ type: "text", text: "x" })) }
      fixture(dir, legalManifest(), { "mpd.json": JSON.stringify(wide) }, LEGAL_HOST)
    },
  },
  {
    name: "a static view over the depth budget",
    rule: "view-depth",
    severity: "error",
    build: (dir) => {
      /** A 9-deep stack chain, over the panel's 8. */
      let deep: Record<string, unknown> = { type: "text", text: "x" }
      for (let level = 0; level < 9; level += 1) deep = { type: "stack", children: [deep] }
      fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, ...deep }) }, LEGAL_HOST)
    },
  },
  {
    name: "a static view carrying a style key",
    rule: "view-design:v1-decoration",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", style: { gap: "M" }, children: [{ type: "text", text: "x" }] }) }, LEGAL_HOST) },
  },
  {
    name: "a static view whose text is empty",
    rule: "view-design:v1-text",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "text", text: "" }] }) }, LEGAL_HOST) },
  },
  {
    name: "an image with a web address in a static view",
    rule: "view-image",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "image", src: "https://example.com/x.png" }) }, LEGAL_HOST) },
  },
  {
    name: "a static view declaring v2",
    rule: "view-version",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 2, type: "stack", children: [{ type: "text", text: "x" }] }) }, LEGAL_HOST) },
  },
  {
    name: "a static view over the byte budget",
    rule: "view-bytes",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "text", text: "x".repeat(40000) }) }, LEGAL_HOST) },
  },
  {
    name: "a tool card builder that constructs a tappable node is a NOTE",
    rule: "view-toolcard-actions",
    severity: "note",
    build: (dir) => {
      fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST)
      mkdirSync(join(dir, "packages", "fixture-plugin", "src"), { recursive: true })
      writeFileSync(join(dir, "packages", "fixture-plugin", "src", "dshgo-cards.ts"), 'export const CARD = toolCard(() => stack([actions([{ id: "x", label: "x" }])]))\n')
    },
  },
  {
    name: "COMPAT: a v2-only component in a DECLARED static view is refused",
    rule: "compat-view-v2",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "tabs", items: [] }] }) }, LEGAL_HOST) },
  },
  {
    name: "COMPAT: a data binding in a DECLARED static view is refused",
    rule: "compat-view-binding",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "text", text: { $: "data.x" } }) }, LEGAL_HOST) },
  },
  {
    name: "COMPAT: a declared static view that does not resolve",
    rule: "compat-view-missing",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), {}, LEGAL_HOST) },
  },
  {
    name: "HOST: a declared panel with no panel registration",
    rule: "host-panel-missing",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST.replace("  api.dshGoPanel(DSHGO_PANEL_ID, {})", "")) },
  },
  {
    name: "HOST: a tappable id with no handler",
    rule: "host-handler-missing",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST.replace("  api.dshGoOn?.(DSHGO_DISPATCH, () => {})", "")) },
  },
  {
    name: "HOST: a registration for an id the manifest does not declare",
    rule: "host-undeclared-id",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST + 'const GOPHER = "ghost"\napi.dshGoOn(GOPHER, () => {})\n') },
  },
  {
    name: "HOST: the optional-inject spelling",
    rule: "host-binding-optional",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST.replace("ctx.inject(['dshGo'], (go: any) => { go.panel() })", "ctx.inject(['dshGo?'], (go: any) => { go.panel() })")) },
  },
  {
    name: "HOST: a top-level inject array carrying dshGo",
    rule: "host-binding-top-level",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST + "export const inject = ['dshGo']\n") },
  },
  {
    name: "the kit's budget table drifting from the spec is refused",
    rule: "view-budget-drift",
    severity: "error",
    probe: () => budgetDrift({ toolCard: { bytes: 1, nodes: 40, depth: 6 }, panel: BUDGETS.panel, strip: BUDGETS.strip }),
  },
  {
    name: "HOST: no binding form at all",
    rule: "host-binding",
    severity: "error",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }, LEGAL_HOST.replace("ctx.inject(['dshGo'], (go: any) => { go.panel() })", "")) },
  },
  {
    name: "C5 PIN: one perturbed site disagreeing with the seven others",
    rule: "pin-disagreement",
    severity: "error",
    probe: () => {
      /** The UNPERTURBED fixture set: a drifted fixture or selector must fail HERE, never pass by accident. */
      const baseline = auditPin(extractPins(pinTexts(PIN_FIXTURE_A)), true)
      if (baseline.findings.length !== 0) {
        throw new Error(`the unperturbed fixture set must be clean, got ${baseline.findings.map((finding: Finding): string => `${finding.rule}:${finding.severity}`).join(", ")}`)
      }
      /** The same set with exactly one site moved to a different commit. */
      const perturbed = auditPin(extractPins(perturbPin(pinTexts(PIN_FIXTURE_A), PIN_PERTURBED_SITE, PIN_FIXTURE_B)), true)
      /** The disagreements that perturbation produced. */
      const disagreements = perturbed.findings.filter((finding: Finding): boolean => finding.rule === "pin-disagreement")
      if (disagreements.length !== 1) throw new Error(`the perturbation must produce exactly one pin-disagreement, got ${disagreements.length}`)
      /** The one disagreement, asserted to name the perturbed site rather than a bystander. */
      const [only] = disagreements
      if (only === undefined || !only.detail.startsWith(`${PIN_PERTURBED_SITE} states`)) {
        throw new Error(`the disagreement must name ${PIN_PERTURBED_SITE}, got ${only?.detail ?? "none"}`)
      }
      /** The packaged/checkout split this same C5 block branches on — folded here so the arm COUNT stays fixed. */
      assertPinModeSplit()
      return perturbed.findings
    },
  },
  {
    name: "C5 PIN: a site that states no 40-hex commit",
    rule: "pin-site-missing",
    severity: "error",
    probe: () => {
      /** The agreeing fixture, with ONE site degraded to a short token that is not a commit. */
      const texts = pinTexts(PIN_FIXTURE_A)
      texts.set("docs/dsh-go-standard.zh-CN.md", "标准钉在\n`ccch1mneyyy/dsh-Go` 的提交 `deadbeef`（2026-11-09）。执行点是\n")
      return auditPin(extractPins(texts), true).findings
    },
  },
]

/** Run every self-test arm; non-zero when any arm does not behave as declared. */
function selfTest(): number {
  /** The root every fixture lives under, removed at the end. */
  const base = mkdtempSync(join(tmpdir(), "dshgo-standard-self-test-"))
  /** Arms that did not behave as declared. */
  const failures: string[] = []
  for (const [index, arm] of ARMS.entries()) {
    /** This arm's own fixture directory. */
    const dir = join(base, `arm-${index}`)
    try {
      /** Every finding this arm produced. */
      const findings: readonly Finding[] = arm.probe !== undefined
        ? arm.probe()
        : (arm.build?.(dir), auditStatic(dir, [join(dir, "host.ts")]).flatMap((lane: LaneResult): readonly Finding[] => lane.findings))
      /** Whether the expected rule (or the clean control's total absence of findings) held. */
      const ok = arm.rule === null ? findings.length === 0 : findings.some((finding: Finding): boolean => finding.rule === arm.rule && finding.severity === arm.severity)
      console.log(`${ok ? "PASS" : "FAIL"}  ${arm.name}${ok ? "" : ` — expected ${arm.rule ?? "no findings"} (${arm.severity}), got ${findings.map((finding: Finding): string => `${finding.rule}:${finding.severity}`).join(", ") || "none"}`}`)
      if (!ok) failures.push(arm.name)
    } catch (error) {
      console.log(`FAIL  ${arm.name} — the arm itself threw: ${error instanceof Error ? error.message : String(error)}`)
      failures.push(arm.name)
    }
  }
  rmSync(base, { recursive: true, force: true })
  if (failures.length > 0) {
    console.log(`${TAG} SELF-TEST FAILED — ${failures.length} arm(s): ${failures.join("; ")}`)
    return EXIT.VIOLATIONS
  }
  console.log(`${TAG} SELF-TEST PASS — ${ARMS.length} arms (1 clean control + ${ARMS.length - 1} negative controls)`)
  return EXIT.LEGAL
}

/** Print the flags a caller may use. */
function usage(): void {
  console.log("usage: node scripts/verify-dshgo-standard.ts [--root <package dir>] [--self-test] [--require-dshgo-kit] [--json <path>]")
  console.log("       exit codes: 0 legal, 1 violations, 2 cannot-run, 3 NOT-PASSED (no official cross-check)")
  console.log(`       cross-check: ${KIT_ENV}=<dsh-Go checkout> node scripts/verify-dshgo-standard.ts`)
}

/** CLI entry point: parse flags, audit and return the process exit code. */
function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage()
    return EXIT.LEGAL
  }
  if (argv.includes("--self-test")) return selfTest()
  /** The package root this run audits. */
  let root = REPO_ROOT
  /** Where the JSON report is written, when the caller asked for one. */
  let jsonPath: string | undefined
  /** Whether a missing official checkout is stated as an explicit requirement. */
  let requireKit = false
  for (let index = 0; index < argv.length; index += 1) {
    /** The flag being parsed at position `index`. */
    const flag = argv[index]
    if (flag === "--root") {
      /** The directory the flag expects next. */
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        console.error(`${TAG} cannot-run: --root needs a directory`)
        return EXIT.CANNOT_RUN
      }
      root = resolve(value)
      index += 1
      continue
    }
    if (flag === "--json") {
      /** The file the flag expects next. */
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        console.error(`${TAG} cannot-run: --json needs a file path`)
        return EXIT.CANNOT_RUN
      }
      jsonPath = resolve(value)
      index += 1
      continue
    }
    if (flag === "--require-dshgo-kit") {
      requireKit = true
      continue
    }
    console.error(`${TAG} cannot-run: unknown flag ${flag}`)
    return EXIT.CANNOT_RUN
  }
  if (!existsSync(join(root, "package.json"))) {
    console.error(`${TAG} cannot-run: no package.json under ${root}`)
    return EXIT.CANNOT_RUN
  }
  /** The static lanes for this run. */
  const lanes = auditStatic(root, undefined)
  /** The cross-check lane, told how many static errors it must agree with. */
  const crossCheck = runCrossCheck(root, lanes)
  /** The pin-coherence check over the REPOSITORY's declaration sites — a repository fact, not a lane. */
  const pin = auditPin(readPins(REPO_ROOT), isCheckout(REPO_ROOT))
  /** The whole report. */
  const report: AuditReport = { root, lanes, pin, crossCheck }
  /** The exit code the contract assigns. */
  const code = render(report)
  if (requireKit && crossCheck.kit === null) console.log(`${TAG} ${KIT_ENV} is REQUIRED by --require-dshgo-kit and was not supplied`)
  if (jsonPath !== undefined) {
    mkdirSync(dirname(jsonPath), { recursive: true })
    writeFileSync(jsonPath, JSON.stringify({ ...report, exitCode: code, relativeSelf: relative(REPO_ROOT, SELF) }, null, 2))
  }
  return code
}

process.exitCode = main(process.argv.slice(2))
