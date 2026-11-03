#!/usr/bin/env node
// verify-dshgo-views — the dsh-Go native-panel gate: the manifest the app parses and the static views
// it falls back to must be legal BEFORE the bundle is packed, because the app rejects a bad manifest
// by simply not showing the plugin (no error reaches us at runtime).
//
// WHAT IT CHECKS (wave contract §4 D1; every rule is one the app's own 1.0.9 parser applies):
//   manifest  `dshGo.v === 1`; every contribution id matches `^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$` and
//             is UNIQUE per plugin across ALL slots; per-slot counts (panels 4, composer.actions 2,
//             message.actions 2, composer.strip 1); the whole `dshGo` object fits 16 KiB; panel
//             placements come from the closed set; a strip's `panel` names a declared panel.
//   views     every declared static view file EXISTS inside the package, parses as JSON, is at most
//             32 KiB, sits inside the PANEL budget (bytes / 120 nodes / depth 8), is v1 (or omits
//             `v`), uses no v2-only component name, and carries no `data` binding — a static fallback
//             renders with no host half running, so a binding would show as an em dash.
//
// WHAT THIS GATE DOES NOT COVER (contract §7.3): the LIVE v2 panel trees are built at runtime by the
// plugin lanes, so they are linted by those lanes' unit tests (`lintDesign(view, { version: 2 })`).
// This gate lints the DECLARED static fallbacks in v1 mode. A green run here proves the FALLBACK is
// legal and designed; it must never be read as "the v2 panels were linted".
//
// WHY THE STATIC VIEW RULES ARE STRICTER THAN THE APP: the app tolerates a v2 component in an older
// tree with a grey placeholder, and a binding with a dash. The fallback's whole job is to explain the
// plugin when the bridge is ASENT, so a placeholder is a defect here even where it is not an error
// there.
//
// Usage:
//   node scripts/verify-dshgo-views.ts                audit this repository's root package.json
//   node scripts/verify-dshgo-views.ts --self-test    fixture arms, each with its clean control
//   node scripts/verify-dshgo-views.ts --root <dir>   audit another package root (QA fixtures)
//   node scripts/verify-dshgo-views.ts --help
//
// Exit codes: 0 = legal. 1 = violations (each printed with its rule, path and detail). 2 = cannot run
// (no readable package.json, unknown flag, self-test arm misbehaving).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { BUDGETS, V1_COMPONENTS, V2_ONLY_COMPONENTS, lintDesign, measureView } from "../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** Repository root, derived from this script's own location (`<root>/scripts/`). */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The four contribution slots the protocol declares, with their per-plugin maximums. */
const SLOT_LIMITS: ReadonlyMap<string, number> = new Map([
  ["panels", 4],
  ["composer.actions", 2],
  ["message.actions", 2],
  ["composer.strip", 1],
])

/** The id shape every contribution, panel and surface must satisfy. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/

/** Where a panel may be placed; anything else is an unknown placement the app ignores. */
const PLACEMENTS: readonly string[] = ["session.tab", "features", "chat.panel"]

/** The whole `dshGo` object's byte budget, shared with the manifest file itself. */
const MANIFEST_BYTES = 16384

/** One violation: which rule broke, at which path, and what a reader should do. */
interface Violation {
  /** The rule id, stable enough to grep a report for. */
  readonly rule: string
  /** Repository-relative (or fixture-relative) path the violation was read from. */
  readonly path: string
  /** One line naming the offending value and the accepted shape. */
  readonly detail: string
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

/** True when any value in the tree is a `{ "$": "data.…" }` binding. */
function hasBinding(value: unknown): boolean {
  if (isRecord(value)) {
    /** The candidate's own keys; a binding carries exactly one. */
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === "$" && typeof value.$ === "string") return true
    return Object.values(value).some(hasBinding)
  }
  if (Array.isArray(value)) return value.some(hasBinding)
  return false
}

/** Audit the static view a manifest entry declared. */
function auditView(root: string, spec: unknown, where: string): Violation[] {
  /** Everything this view broke. */
  const violations: Violation[] = []
  if (typeof spec !== "string" || spec === "") {
    violations.push({ rule: "view-path", path: where, detail: "view must be a non-empty string path" })
    return violations
  }
  /** The resolved file, and the package-relative path a report should name. */
  const file = resolve(root, spec)
  /** True when the declared path stays inside the package (the bridge rejects escapes too). */
  const inside = file === root || file.startsWith(root + sep)
  if (!inside) {
    violations.push({ rule: "view-path", path: where, detail: `view "${spec}" escapes the package root` })
    return violations
  }
  if (!existsSync(file)) {
    violations.push({ rule: "view-missing", path: where, detail: `view "${spec}" does not exist` })
    return violations
  }
  /** The view's byte size on disk, the unit the app's read path uses. */
  const bytes = statSync(file).size
  if (bytes > BUDGETS.panel.bytes) {
    violations.push({ rule: "view-bytes", path: spec, detail: `the file is ${bytes} bytes, over ${BUDGETS.panel.bytes}` })
  }
  /** The parsed view, or undefined when the JSON is malformed. */
  const view = readJson(file)
  if (view === undefined) {
    violations.push({ rule: "view-json", path: spec, detail: "the file is not valid JSON" })
    return violations
  }
  if (!isRecord(view) || typeof view.type !== "string") {
    violations.push({ rule: "view-root", path: spec, detail: "the root must be a component object with a string type" })
    return violations
  }
  if (view.v !== undefined && view.v !== 1) {
    violations.push({ rule: "view-version", path: spec, detail: `a static fallback is v1 only; got v=${String(view.v)}` })
  }
  /** The measured tree; a static view must fit the panel budget on its own. */
  const measured = measureView(view)
  if (measured.nodes > BUDGETS.panel.nodes) {
    violations.push({ rule: "view-nodes", path: spec, detail: `${measured.nodes} nodes, over ${BUDGETS.panel.nodes}` })
  }
  if (measured.depth > BUDGETS.panel.depth) {
    violations.push({ rule: "view-depth", path: spec, detail: `depth ${measured.depth}, over ${BUDGETS.panel.depth}` })
  }
  for (const node of componentNodes(view)) {
    /** The component name, typed for the catalog lookups below. */
    const type = String(node.type)
    if (!V1_COMPONENTS.includes(type)) {
      /** The v2-only explanation, which is the usual cause. */
      const v2 = V2_ONLY_COMPONENTS.includes(type)
      violations.push({
        rule: v2 ? "view-v2-component" : "view-component",
        path: spec,
        detail: v2 ? `"${type}" is a v2-only component; a static fallback must stay v1` : `"${type}" is not a v1 component`,
      })
    }
  }
  if (hasBinding(view)) {
    violations.push({ rule: "view-binding", path: spec, detail: "a static fallback has no data model, so it must carry no `$` binding" })
  }
  for (const finding of lintDesign(view, { version: 1 })) {
    violations.push({ rule: `design:${finding.rule}`, path: `${spec}${finding.path}`, detail: finding.message })
  }
  return violations
}

/** Audit one package root's `dshGo` manifest and every static view it declares. */
function audit(root: string): Violation[] {
  /** Everything the manifest broke. */
  const violations: Violation[] = []
  /** The package manifest, or undefined when it cannot be read. */
  const manifest = readJson(join(root, "package.json"))
  if (!isRecord(manifest)) {
    violations.push({ rule: "manifest-json", path: "package.json", detail: "the file is missing or not valid JSON" })
    return violations
  }
  /** The dsh-Go block the app reads. */
  const dshGo = manifest.dshGo
  if (!isRecord(dshGo)) {
    violations.push({ rule: "manifest-missing", path: "package.json", detail: 'no "dshGo" object; the app shows nothing' })
    return violations
  }
  if (dshGo.v !== 1) {
    violations.push({ rule: "manifest-version", path: "dshGo.v", detail: `the protocol version must be 1, got ${JSON.stringify(dshGo.v)}` })
  }
  /** The manifest's own size, measured as the app measures it. */
  const bytes = jsonBytes(dshGo)
  if (bytes > MANIFEST_BYTES) {
    violations.push({ rule: "manifest-bytes", path: "dshGo", detail: `${bytes} bytes, over ${MANIFEST_BYTES}` })
  }
  /** The `contributes` block; a manifest without one contributes nothing. */
  const contributes = dshGo.contributes
  if (!isRecord(contributes)) {
    violations.push({ rule: "manifest-contributes", path: "dshGo.contributes", detail: "must be an object" })
    return violations
  }
  /** Every id already declared, mapped to the slot that declared it. */
  const seen = new Map<string, string>()
  /** The panel ids, so a strip can be checked against them. */
  const panelIds = new Set<string>()
  for (const [slot, limit] of SLOT_LIMITS) {
    /** The slot's declared entries. */
    const entries = contributes[slot]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) {
      violations.push({ rule: "slot-shape", path: `dshGo.contributes.${slot}`, detail: "must be an array" })
      continue
    }
    if (entries.length > limit) {
      violations.push({ rule: "slot-count", path: `dshGo.contributes.${slot}`, detail: `${entries.length} entries, over the maximum ${limit}` })
    }
    for (const entry of entries) {
      if (!isRecord(entry)) {
        violations.push({ rule: "entry-shape", path: `dshGo.contributes.${slot}`, detail: "every entry must be an object" })
        continue
      }
      /** The entry's id, when it has one of the right shape. */
      const id = entry.id
      if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        violations.push({ rule: "id-shape", path: `dshGo.contributes.${slot}`, detail: `id ${JSON.stringify(id)} must match ${ID_PATTERN}` })
        continue
      }
      /** The slot that declared this id first, when it was already taken. */
      const takenBy = seen.get(id)
      if (takenBy !== undefined) {
        violations.push({ rule: "id-duplicate", path: `dshGo.contributes.${slot}`, detail: `"${id}" is already declared by ${takenBy}; ids are unique per plugin across ALL slots` })
      } else {
        seen.set(id, slot)
      }
      if (slot === "panels") panelIds.add(id)
    }
  }
  /** The declared panels, checked for placement and static views. */
  const panels = Array.isArray(contributes.panels) ? contributes.panels : []
  for (const panel of panels) {
    if (!isRecord(panel)) continue
    if (Array.isArray(panel.placement)) {
      for (const placement of panel.placement) {
        if (typeof placement !== "string" || !PLACEMENTS.includes(placement)) {
          violations.push({ rule: "panel-placement", path: `dshGo.contributes.panels[${String(panel.id)}]`, detail: `placement ${JSON.stringify(placement)} must be one of ${PLACEMENTS.join(" / ")}` })
        }
      }
    }
    if (panel.view !== undefined) {
      violations.push(...auditView(root, panel.view, `dshGo.contributes.panels[${String(panel.id)}]`))
    }
  }
  /** Every strip must name a panel the manifest actually declares. */
  const strips = Array.isArray(contributes["composer.strip"]) ? contributes["composer.strip"] : []
  for (const strip of strips) {
    if (!isRecord(strip) || strip.panel === undefined) continue
    if (typeof strip.panel !== "string" || !panelIds.has(strip.panel)) {
      violations.push({ rule: "strip-panel", path: "dshGo.contributes.composer.strip", detail: `panel ${JSON.stringify(strip.panel)} is not a declared panel` })
    }
  }
  return violations
}

/** Print one audit report: a header line, then one line per violation. */
function render(violations: readonly Violation[], root: string): void {
  if (violations.length === 0) {
    console.log(`[verify-dshgo-views] PASS — ${root}: manifest + static views are legal`)
    return
  }
  console.log(`[verify-dshgo-views] FAIL — ${root}: ${violations.length} violation(s)`)
  for (const violation of violations) {
    console.log(`  ${violation.rule} ${violation.path} — ${violation.detail}`)
  }
}

/** Write one fixture package (manifest plus its view files) under a fresh temp directory. */
function fixture(dir: string, manifest: unknown, views: Record<string, string> = {}): string {
  mkdirSync(join(dir, "views"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2))
  for (const [name, content] of Object.entries(views)) writeFileSync(join(dir, "views", name), content)
  return dir
}

/** A minimal legal manifest whose single panel points at a small v1 view. */
function legalManifest(): Record<string, unknown> {
  return {
    dshGo: {
      v: 1,
      title: { en: "Fixture", zh: "样例" },
      icon: "bolt",
      contributes: {
        panels: [{ id: "mpd", title: { en: "Panel", zh: "面板" }, icon: "bolt", placement: ["session.tab", "features"], view: "./views/mpd.json" }],
        "composer.strip": [{ id: "mpd-status", icon: "team", panel: "mpd", text: "—" }],
      },
    },
  }
}

/** A small v1 view a fixture can point at. */
const LEGAL_VIEW = JSON.stringify({ v: 1, type: "stack", children: [{ type: "text", text: "static" }] })

/**
 * One self-test arm: a fixture expected to hold exactly one named rule (or none for the control).
 */
interface Arm {
  /** The arm's name, printed with its verdict. */
  readonly name: string
  /** The rule the fixture must trip, or null for the clean control. */
  readonly rule: string | null
  /** Build the fixture from a fresh temp directory. */
  readonly build: (dir: string) => void
}

/** The self-test arms: one clean control plus one negative control per rule family. */
const ARMS: readonly Arm[] = [
  {
    name: "clean control: a legal manifest and a v1 view pass",
    rule: null,
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": LEGAL_VIEW }) },
  },
  {
    name: "missing dshGo manifest",
    rule: "manifest-missing",
    build: (dir) => { fixture(dir, { name: "x", version: "0.0.0" }) },
  },
  {
    name: "protocol version not 1",
    rule: "manifest-version",
    build: (dir) => {
      /** The control manifest, with its version moved. */
      const manifest = legalManifest()
      ;(manifest.dshGo as Record<string, unknown>).v = 2
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "an id that breaks the protocol pattern",
    rule: "id-shape",
    build: (dir) => {
      /** The control manifest, with an illegal id. */
      const manifest = legalManifest()
      ;((manifest.dshGo as Record<string, unknown>).contributes as Record<string, unknown[]>).panels[0] = { id: "bad id!", view: "./views/mpd.json" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "the same id declared by two slots",
    rule: "id-duplicate",
    build: (dir) => {
      /** The control manifest, with a strip reusing the panel id. */
      const manifest = legalManifest()
      ;((manifest.dshGo as Record<string, unknown>).contributes as Record<string, unknown[]>)["composer.strip"] = [{ id: "mpd", panel: "mpd", text: "—" }]
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "more panels than the protocol allows",
    rule: "slot-count",
    build: (dir) => {
      /** The control manifest with five panels. */
      const manifest = legalManifest()
      ;((manifest.dshGo as Record<string, unknown>).contributes as Record<string, unknown[]>).panels = ["a", "b", "c", "d", "e"].map((id) => ({ id, view: "./views/mpd.json" }))
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "a declared view file that does not exist",
    rule: "view-missing",
    build: (dir) => { fixture(dir, legalManifest()) },
  },
  {
    name: "a view that is not JSON",
    rule: "view-json",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": "{ not json" }) },
  },
  {
    name: "a v2 root in a static fallback",
    rule: "view-version",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 2, type: "text", text: "x" }) }) },
  },
  {
    name: "a v2-only component in a static fallback",
    rule: "view-v2-component",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "badge", text: "x" }] }) }) },
  },
  {
    name: "a data binding in a static fallback",
    rule: "view-binding",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "text", text: { $: "data.x" } }) }) },
  },
  {
    name: "a static view over the node budget",
    rule: "view-nodes",
    build: (dir) => {
      /** 130 text nodes, over the panel's 120. */
      const wide = { v: 1, type: "stack", children: Array.from({ length: 130 }, () => ({ type: "text", text: "x" })) }
      fixture(dir, legalManifest(), { "mpd.json": JSON.stringify(wide) })
    },
  },
  {
    name: "a static view carrying a style key",
    rule: "design:v1-decoration",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", style: { gap: "M" }, children: [{ type: "text", text: "x" }] }) }) },
  },
  {
    name: "a static view whose text is empty",
    rule: "design:v1-text",
    build: (dir) => { fixture(dir, legalManifest(), { "mpd.json": JSON.stringify({ v: 1, type: "stack", children: [{ type: "text", text: "" }] }) }) },
  },
  {
    name: "a strip naming an undeclared panel",
    rule: "strip-panel",
    build: (dir) => {
      /** The control manifest, with the strip pointed elsewhere. */
      const manifest = legalManifest()
      ;((manifest.dshGo as Record<string, unknown>).contributes as Record<string, unknown[]>)["composer.strip"] = [{ id: "mpd-status", panel: "ghost", text: "—" }]
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "an unknown placement",
    rule: "panel-placement",
    build: (dir) => {
      /** The control manifest, with a placement the app does not know. */
      const manifest = legalManifest()
      ;((manifest.dshGo as Record<string, unknown>).contributes as Record<string, unknown[]>).panels[0] = { id: "mpd", placement: ["floating"], view: "./views/mpd.json" }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
  {
    name: "a manifest over the 16 KiB budget",
    rule: "manifest-bytes",
    build: (dir) => {
      /** The control manifest, padded past the byte budget. */
      const manifest = legalManifest()
      ;(manifest.dshGo as Record<string, unknown>).title = { en: "x".repeat(20000), zh: "x".repeat(20000) }
      fixture(dir, manifest, { "mpd.json": LEGAL_VIEW })
    },
  },
]

/** Run every self-test arm; non-zero when any arm does not behave as declared. */
function selfTest(): number {
  /** The root every fixture lives under, removed at the end. */
  const base = mkdtempSync(join(tmpdir(), "dshgo-views-self-test-"))
  /** Arms that did not behave as declared. */
  const failures: string[] = []
  for (const [index, arm] of ARMS.entries()) {
    /** This arm's own fixture directory. */
    const dir = join(base, `arm-${index}`)
    try {
      arm.build(dir)
      /** What the audit found for this arm. */
      const violations = audit(dir)
      /** Whether the expected rule (or the clean control's total absence of violations) held. */
      const ok = arm.rule === null ? violations.length === 0 : violations.some((violation) => violation.rule === arm.rule)
      console.log(`${ok ? "PASS" : "FAIL"}  ${arm.name}${ok ? "" : ` — expected ${arm.rule ?? "no violations"}, got ${violations.map((violation) => violation.rule).join(", ") || "none"}`}`)
      if (!ok) failures.push(arm.name)
    } catch (error) {
      console.log(`FAIL  ${arm.name} — the arm itself threw: ${error instanceof Error ? error.message : String(error)}`)
      failures.push(arm.name)
    }
  }
  rmSync(base, { recursive: true, force: true })
  if (failures.length > 0) {
    console.log(`[verify-dshgo-views] SELF-TEST FAILED — ${failures.length} arm(s): ${failures.join("; ")}`)
    return 1
  }
  console.log(`[verify-dshgo-views] SELF-TEST PASS — ${ARMS.length} arms (1 clean control + ${ARMS.length - 1} negative controls)`)
  return 0
}

/** Print the two flags a caller may use. */
function usage(): void {
  console.log("usage: node scripts/verify-dshgo-views.ts [--self-test] [--root <package dir>]")
}

/** CLI entry point: parse flags, audit and return the process exit code. */
function main(argv: readonly string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage()
    return 0
  }
  if (argv.includes("--self-test")) return selfTest()
  /** The package root this run audits. */
  let root = REPO_ROOT
  for (let index = 0; index < argv.length; index += 1) {
    /** The flag being parsed at position `index`. */
    const flag = argv[index]
    if (flag === "--root") {
      /** The directory the flag expects next. */
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        console.error("[verify-dshgo-views] cannot-run: --root needs a directory")
        return 2
      }
      root = resolve(value)
      index += 1
      continue
    }
    console.error(`[verify-dshgo-views] cannot-run: unknown flag ${flag}`)
    return 2
  }
  if (!existsSync(join(root, "package.json"))) {
    console.error(`[verify-dshgo-views] cannot-run: no package.json under ${root}`)
    return 2
  }
  /** Everything this run found. */
  const violations = audit(root)
  render(violations, root)
  return violations.length === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
