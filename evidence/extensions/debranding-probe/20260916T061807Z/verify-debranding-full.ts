#!/usr/bin/env node
// F7 — the CORRECTED de-branding / snippet-parity prober.
//
// WHY THIS FILE EXISTS (F7, measured):
// the earlier prober, `evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs`
// (lines 40-49), printed
//     "quoted snippets match the shipped example verbatim"
// while it actually probed ONLY the skill description, the skill frontmatter name and four
// flow fields. It never looked at the role/persona fields and never looked at the mcp entry,
// so a drifted role or mcp snippet stayed GREEN — a claim broader than its probe. That file is
// IMMUTABLE and is NOT edited; this correction lives BESIDE it in a new directory.
//
// WHAT THIS PROBER DOES
// It builds a per-kind SNIPPET FIELD INVENTORY from the artifacts themselves (never a
// hand-copied list) for all FOUR kinds — skills, flows, roles/personas and the mcp entry —
// and then checks, field by field, whether the documents that present that artifact quote the
// value VERBATIM. Two targets: the shipped example (`extensions/mpd-ext-example`, presented by
// `docs/extensions.md` + its zh-CN twin) and the generic template (`templates/mpd-extension`,
// presented by its own README pair).
//
// THE CLAIM IS BOUNDED BY THE PROBE: the printed summary reports the exact number of fields and
// field-probes it examined, and every unquoted field is REPORTED as `not-quoted` (a coverage
// fact) rather than silently counted as verified. Nothing is asserted about a field that was
// not probed.
//
// ARMS
//   positive : the shipped example — every inventory field must be quoted verbatim in EVERY
//              document that presents it; the template — a field quoted in one language must be
//              quoted verbatim in the other (one-sided drift is exactly the F7 shape).
//   mutation : a mutated-snippet negative control. One byte of one probed field is changed in a
//              TEMP copy of the target and the SAME probe must report the mismatch — including
//              for the role and mcp fields the old prober never checked. `--self-test` runs it.
//
// Usage:
//   node verify-debranding-full.mjs [--self-test] [--example-root <dir>] [--template-root <dir>]
//                                   [--json-out <path>] [--no-json]
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
// T-53: evidence is immutable by default — see skills/dsh-qa/scripts/lib/immutable-output.mjs.
import { exitOnRefusal, refuseOverwrite, timestamp } from "../../../../skills/dsh-qa/scripts/lib/immutable-output.ts"

const SELF = fileURLToPath(import.meta.url)
const scriptDir = dirname(SELF)
// This prober lives at evidence/extensions/debranding-probe/<UTC>/verify-debranding-full.mjs,
// so the repo root is four levels above its own directory.
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const PREFIX = "[verify-debranding-full]"

const DEFAULT_EXAMPLE_ROOT = join(repoRoot, "extensions", "mpd-ext-example")
const DEFAULT_TEMPLATE_ROOT = join(repoRoot, "templates", "mpd-extension")
const EXAMPLE_DOCS = ["docs/extensions.md", "docs/extensions.zh-CN.md"]
const TEMPLATE_DOCS = ["templates/mpd-extension/README.md", "templates/mpd-extension/README.zh-CN.md"]

// The four contribution kinds and, per kind, the snippet fields a document may quote.
// This inventory is the contract of this prober: a kind missing from it is a probe gap.
const FIELD_INVENTORY = {
  skills: ["name", "description"],
  flows: ["id", "title", "description", "whenToUse"],
  roles: ["name", "description", "persona"],
  mcp: ["serverName", "transport", "command", "args"]
}
const KINDS = Object.keys(FIELD_INVENTORY)

// Old product names that must not survive anywhere in the shipped artifacts (carried over
// from the earlier prober's rename check).
const OLD_NAMES = ["rtl-triage", "rtl-verilog", "verilog-reviewer", "rtl-lint", "rtl-demo", "Verilog Reviewer"]

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"))
const read = (f) => readFileSync(f, "utf8")

// Frontmatter value of `key: "value"` or `key: value`, with the surrounding quotes dropped.
function frontmatter(text, key) {
  const raw = text.match(new RegExp("^" + key + ":\\s*(.*)$", "m"))?.[1] ?? ""
  return raw.replace(/^"/, "").replace(/"$/, "").trim()
}

function listDirs(path) {
  if (!existsSync(path)) return []
  return readdirSync(path).filter((n) => {
    try { return statSync(join(path, n)).isDirectory() } catch { return false }
  }).sort()
}

function listJson(path) {
  if (!existsSync(path)) return []
  return readdirSync(path).filter((n) => n.endsWith(".json")).sort()
}

// Per-kind snippet inventory, DERIVED from the artifacts on disk for one target root.
function gatherInventory(root) {
  const manifest = readJson(join(root, "mpd-ext.json"))
  const contributes = manifest.contributes ?? {}
  const inventory = { skills: [], flows: [], roles: [], mcp: [] }

  for (const s of contributes.skills ?? []) {
    for (const dir of listDirs(join(root, s.root ?? "skills"))) {
      const file = join(root, s.root ?? "skills", dir, "SKILL.md")
      if (!existsSync(file)) continue
      const md = read(file)
      inventory.skills.push({
        artifact: relative(repoRoot, file),
        fields: { name: frontmatter(md, "name"), description: frontmatter(md, "description") }
      })
    }
  }
  for (const f of contributes.flows ?? []) {
    for (const name of listJson(join(root, f.dir ?? "flows"))) {
      const file = join(root, f.dir ?? "flows", name)
      const j = readJson(file)
      inventory.flows.push({
        artifact: relative(repoRoot, file),
        fields: { id: j.id, title: j.title, description: j.description, whenToUse: j.whenToUse }
      })
    }
  }
  for (const r of contributes.roles ?? []) {
    inventory.roles.push({
      artifact: relative(repoRoot, join(root, "mpd-ext.json")),
      fields: { name: r.name, description: r.description, persona: r.persona }
    })
  }
  for (const m of contributes.mcp ?? []) {
    inventory.mcp.push({
      artifact: relative(repoRoot, join(root, "mpd-ext.json")),
      fields: { serverName: m.serverName, transport: m.transport, command: m.command, args: JSON.stringify(m.args) }
    })
  }
  return { manifest, inventory }
}

// Every (kind, artifact, field, doc) probe, with the verbatim hit recorded.
function probeDocs(inventory, docPaths) {
  const probes = []
  for (const kind of KINDS) {
    for (const entry of inventory[kind]) {
      for (const field of FIELD_INVENTORY[kind]) {
        const value = entry.fields[field]
        const present = {}
        for (const doc of docPaths) {
          present[doc] = typeof value === "string" && value.length > 0 && existsSync(join(repoRoot, doc))
            ? read(join(repoRoot, doc)).includes(value)
            : false
        }
        probes.push({ kind, artifact: entry.artifact, field, value: value ?? null, present })
      }
    }
  }
  return probes
}

// Structural arm: independent of the docs — the artifacts must be internally consistent.
function probeStructure(root, manifest) {
  const findings = []
  const contributes = manifest.contributes ?? {}
  for (const kind of KINDS) {
    if ((contributes[kind] ?? []).length === 0) findings.push({ id: "structure.kind-missing", detail: kind + ": the manifest contributes no " + kind })
  }
  const m = manifest
  for (const s of contributes.skills ?? []) {
    if (!existsSync(join(root, s.root ?? "skills"))) findings.push({ id: "structure.skill-root", detail: "declared skills root does not exist: " + (s.root ?? "skills") })
  }
  for (const f of contributes.flows ?? []) {
    if (!existsSync(join(root, f.dir ?? "flows"))) findings.push({ id: "structure.flow-dir", detail: "declared flows dir does not exist: " + (f.dir ?? "flows") })
  }
  for (const r of contributes.roles ?? []) {
    if (r.persona && !existsSync(join(root, r.persona))) findings.push({ id: "structure.role-persona", detail: "role persona does not resolve: " + r.persona })
    if (r.readonly !== true) findings.push({ id: "structure.role-readonly", detail: "role is not declared readonly: " + r.name })
  }
  for (const e of contributes.mcp ?? []) {
    const arg0 = (e.args ?? [])[0]
    if (arg0 && !existsSync(join(root, e.cwd ?? ".", arg0))) findings.push({ id: "structure.mcp-entry", detail: "mcp entry file does not resolve: " + join(e.cwd ?? ".", arg0) })
  }
  if (!m.id) findings.push({ id: "structure.manifest-id", detail: "manifest has no id" })
  return findings
}

// De-branding arm: no old product name survives in the target tree's text files.
function probeOldNames(root) {
  const findings = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(md|json|mjs|js|txt|yml|yaml)$/.test(n)) continue
      const text = read(p)
      for (const old of OLD_NAMES) {
        if (text.includes(old)) findings.push({ id: "debrand.old-name", detail: relative(repoRoot, p) + " still contains " + old })
      }
    }
  }
  walk(root)
  return findings
}

// F7's core: how wide was the SUPERSEDED prober's probe, derived mechanically from its source
// (read-only) rather than asserted from memory. Its flow keys come from its own `for (const key
// of [...])` list; its skill checks are the two `includes` calls on the description and the
// frontmatter name. Anything it never reads is a field its printed claim nevertheless covered.
const SUPERSEDED_PROBER = join(repoRoot, "evidence", "mpd-ext-debranding", "20260915T074904Z", "verify-debranding.mjs")
function supersededCoverage() {
  if (!existsSync(SUPERSEDED_PROBER)) return { available: false, oldFields: [], gap: [] }
  const src = read(SUPERSEDED_PROBER)
  const oldFields = []
  const flowKeys = src.match(/for \(const key of \[([^\]]+)\]/)
  if (flowKeys) for (const m of flowKeys[1].matchAll(/"([^"]+)"/g)) oldFields.push("flows." + m[1])
  if (/text\.includes\(skillDescription\)/.test(src)) oldFields.push("skills.description")
  if (/text\.includes\(`name: \$\{skillName\}`\)/.test(src)) oldFields.push("skills.name")
  const allFields = KINDS.flatMap((k) => FIELD_INVENTORY[k].map((f) => k + "." + f))
  return { available: true, path: relative(repoRoot, SUPERSEDED_PROBER), printedClaim: "quoted snippets match the shipped example verbatim", oldFields: oldFields.sort(), gap: allFields.filter((f) => !oldFields.includes(f)).sort() }
}

// One full assessment of one target. `requireAllQuoted` is the example's stronger contract.
function assessTarget(target) {
  const { manifest, inventory } = gatherInventory(target.root)
  const probes = probeDocs(inventory, target.docs)
  const findings = []
  const notQuoted = []

  for (const p of probes) {
    const hits = target.docs.filter((d) => p.present[d])
    if (hits.length === 0) { notQuoted.push(p); continue }
    const misses = target.docs.filter((d) => !p.present[d])
    if (misses.length > 0) {
      findings.push({ id: "quotes.one-sided", detail: p.kind + "." + p.field + " is quoted in " + hits.join(", ") + " but MISSING from " + misses.join(", ") + " (value: " + JSON.stringify(p.value) + ")" })
    }
  }
  if (target.requireAllQuoted) {
    for (const p of notQuoted) {
      findings.push({ id: "quotes.not-quoted", detail: p.kind + "." + p.field + " is not quoted verbatim in any of " + target.docs.join(", ") + " (value: " + JSON.stringify(p.value) + ")" })
    }
  }

  findings.push(...probeStructure(target.root, manifest))
  findings.push(...probeOldNames(target.root))

  const counts = {}
  for (const kind of KINDS) counts[kind] = inventory[kind].length
  return {
    id: target.id,
    root: relative(repoRoot, target.root) || target.root,
    docs: target.docs,
    requireAllQuoted: Boolean(target.requireAllQuoted),
    artifactCounts: counts,
    probeCount: probes.length,
    quotedCount: probes.length - notQuoted.length,
    notQuoted: notQuoted.map((p) => p.kind + "." + p.field + " [" + p.artifact + "]"),
    probes,
    findings
  }
}

function exampleTarget(exampleRoot) {
  return { id: "mpd-ext-example", root: exampleRoot, docs: EXAMPLE_DOCS, requireAllQuoted: true }
}
function templateTarget(templateRoot) {
  return { id: "mpd-extension-template", root: templateRoot, docs: TEMPLATE_DOCS, requireAllQuoted: false }
}

function buildReport(opts) {
  const targets = [assessTarget(exampleTarget(opts.exampleRoot)), assessTarget(templateTarget(opts.templateRoot))]
  const findings = targets.flatMap((t) => t.findings.map((f) => ({ target: t.id, ...f })))
  const coverage = supersededCoverage()
  return {
    prober: "verify-debranding-full.mjs",
    supersedes: "evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs (F7: probe narrower than its printed claim; NOT edited)",
    supersededProberCoverage: coverage,
    fieldInventory: FIELD_INVENTORY,
    kinds: KINDS,
    targets: targets.map((t) => ({ id: t.id, root: t.root, docs: t.docs, requireAllQuoted: t.requireAllQuoted, artifactCounts: t.artifactCounts, probeCount: t.probeCount, quotedCount: t.quotedCount, notQuoted: t.notQuoted })),
    probeList: targets.flatMap((t) => t.probes.map((p) => ({ target: t.id, kind: p.kind, artifact: p.artifact, field: p.field, value: p.value, quotedIn: t.docs.filter((d) => p.present[d]) }))),
    totals: {
      targets: targets.length,
      fieldsPerKind: FIELD_INVENTORY,
      probes: targets.reduce((n, t) => n + t.probeCount, 0),
      quoted: targets.reduce((n, t) => n + t.quotedCount, 0),
      notQuoted: targets.reduce((n, t) => n + t.notQuoted.length, 0),
      findings: findings.length
    },
    findings,
    claim: ""
  }
}

function printReport(report) {
  console.log(PREFIX + " field inventory: " + KINDS.map((k) => k + "(" + FIELD_INVENTORY[k].join("/") + ")").join("  "))
  for (const t of report.targets) {
    console.log(PREFIX + " target " + t.id + " [" + t.root + "] artifacts: " + KINDS.map((k) => k + "=" + t.artifactCounts[k]).join(" "))
    console.log(PREFIX + "   field-probes: " + t.probeCount + "  quoted-verbatim: " + t.quotedCount + "  not-quoted: " + t.notQuoted.length + (t.requireAllQuoted ? "  (all fields must be quoted)" : "  (unquoted fields are reported, not claimed)"))
    if (t.notQuoted.length) console.log(PREFIX + "   not-quoted: " + t.notQuoted.join(", "))
  }
  if (report.findings.length) {
    console.error(PREFIX + " FAIL - " + report.findings.length + " finding(s)")
    for (const f of report.findings) console.error("  [" + f.target + "] " + f.id + " - " + f.detail)
  }
}

function parseArgs(argv) {
  const opts = {
    selfTest: false, exampleRoot: DEFAULT_EXAMPLE_ROOT, templateRoot: DEFAULT_TEMPLATE_ROOT,
    // T-53: evidence is immutable by default. The default target used to be the CANONICAL
    // `probe-report.json` inside this script's own directory, so every plain run rewrote the
    // artifact of record. It is now a fresh timestamped path, and an existing target — explicit or
    // not — is REFUSED instead of overwritten.
    jsonOut: join(scriptDir, "probe-report-" + timestamp() + ".json"), jsonOutExplicit: false, writeJson: true
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--self-test") opts.selfTest = true
    else if (a === "--example-root") opts.exampleRoot = resolve(argv[++i] ?? "")
    else if (a === "--template-root") opts.templateRoot = resolve(argv[++i] ?? "")
    else if (a === "--json-out") { opts.jsonOut = resolve(argv[++i] ?? ""); opts.jsonOutExplicit = true; opts.writeJson = true }
    else if (a === "--no-json") opts.writeJson = false
    else if (a === "--help" || a === "-h") { console.log("usage: node verify-debranding-full.mjs [--self-test] [--example-root <dir>] [--template-root <dir>] [--json-out <path>] [--no-json]\n  evidence is immutable by default (T-53): the default report path is timestamped, and an\n  existing target is refused — pass a NEW --json-out <path> instead of overwriting one."); process.exit(0) }
    else { console.error(PREFIX + " FAIL - unknown argument: " + a); process.exit(2) }
  }
  return opts
}

// A mutated-snippet negative control: change ONE byte of ONE probed field in a TEMP copy and
// require the SAME probe to report that field. The field set is otherwise untouched, so a pass
// here would mean the probe is not reading the field at all.
function mutateCopy({ field, kind, mutate }) {
  const scratch = mkdtempSync(join(tmpdir(), "mpd-debranding-probe-"))
  const copy = join(scratch, "mpd-ext-example")
  cpSync(DEFAULT_EXAMPLE_ROOT, copy, { recursive: true })
  const rels = []
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { walk(p); continue }
      rels.push(relative(copy, p))
    }
  }
  walk(copy)
  const before = new Map(rels.map((r) => [r, readFileSync(join(copy, r), "utf8")]))
  mutate(copy, readFileSync, writeFileSync)
  let changed = 0
  for (const r of rels) if (before.get(r) !== readFileSync(join(copy, r), "utf8")) changed += 1
  return { scratch, copy, changed, kind, field }
}

function selfTest() {
  const arms = []
  const add = (name, ok, detail) => arms.push({ name, ok, detail })

  // Arm 1 — positive control on the real tree: the probe passes and reports its field count.
  const baseline = buildReport({ exampleRoot: DEFAULT_EXAMPLE_ROOT, templateRoot: DEFAULT_TEMPLATE_ROOT })
  add("positive-control (real example + template)", baseline.findings.length === 0, baseline.findings.length === 0 ? baseline.totals.probes + " field-probes, 0 findings" : JSON.stringify(baseline.findings.slice(0, 3)))
  const exampleQuoted = (rep) => rep.probeList.filter((p) => p.target === "mpd-ext-example" && p.quotedIn.length > 0).length
  const baseExampleQuoted = exampleQuoted(baseline)

  // Arm 2 — the F7 gap itself, derived from the superseded prober's source: its probe covered
  // skill + flow fields only, so the roles and mcp snippets it never read were green-lit.
  const cov = baseline.supersededProberCoverage
  add(
    "F7 coverage arm (superseded prober's probe scope)",
    cov.available === true && cov.oldFields.length === 6 && cov.gap.some((f) => f.startsWith("roles.")) && cov.gap.some((f) => f.startsWith("mcp.")),
    "old probe = [" + cov.oldFields.join(", ") + "] ; uncovered by the old probe = [" + cov.gap.join(", ") + "]"
  )

  // Arms 2-4 — mutation controls, one per kind the OLD prober under-probed or never probed.
  const mutations = [
    {
      name: "mutation (flow.whenToUse)",
      kind: "flows", field: "whenToUse",
      mutate: (copy, r, w) => {
        const f = join(copy, "flows", "change-triage-flow.json")
        const j = JSON.parse(r(f, "utf8"))
        j.whenToUse = j.whenToUse.slice(0, -1) + "X"
        w(f, JSON.stringify(j, null, 2) + "\n")
      }
    },
    {
      name: "mutation (role.description — NEVER probed by the old prober)",
      kind: "roles", field: "description",
      mutate: (copy, r, w) => {
        const f = join(copy, "mpd-ext.json")
        const j = JSON.parse(r(f, "utf8"))
        j.contributes.roles[0].description = j.contributes.roles[0].description.slice(0, -1) + "X"
        w(f, JSON.stringify(j, null, 2) + "\n")
      }
    },
    {
      name: "mutation (mcp.serverName — NEVER probed by the old prober)",
      kind: "mcp", field: "serverName",
      mutate: (copy, r, w) => {
        const f = join(copy, "mpd-ext.json")
        const j = JSON.parse(r(f, "utf8"))
        j.contributes.mcp[0].serverName = j.contributes.mcp[0].serverName.slice(0, -1) + "X"
        w(f, JSON.stringify(j, null, 2) + "\n")
      }
    }
  ]

  for (const m of mutations) {
    let fixture
    try {
      fixture = mutateCopy(m)
    } catch (error) {
      add(m.name + " [fixture build]", false, "fixture build threw: " + error.message)
      continue
    }
    try {
      if (fixture.changed !== 1) {
        add(m.name + " [fixture build]", false, "mutated " + fixture.changed + " file(s), expected exactly 1 - refusing to trust a fixture that silently did not apply")
        continue
      }
      const mutated = buildReport({ exampleRoot: fixture.copy, templateRoot: DEFAULT_TEMPLATE_ROOT })
      const hit = mutated.findings.some((f) => f.id.startsWith("quotes.") && f.detail.includes("." + m.field + " "))
      // The field set is otherwise untouched: exactly ONE example field must have stopped
      // matching, which proves the probe reads that specific field rather than the whole blob.
      const after = exampleQuoted(mutated)
      add(m.name, mutated.findings.length > 0 && hit && after === baseExampleQuoted - 1, "findings=" + mutated.findings.length + " names-the-field=" + hit + " example-quoted " + baseExampleQuoted + " -> " + after + " (expected -1)")
    } finally {
      rmSync(fixture.scratch, { recursive: true, force: true })
    }
  }

  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + a.detail)
  const failed = arms.filter((a) => !a.ok)
  console.log(PREFIX + " self-test " + (failed.length === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed.length) + "/" + arms.length + " arms")
  return failed.length === 0 ? 0 : 1
}

const opts = parseArgs(process.argv.slice(2))
if (opts.selfTest) process.exit(selfTest())

const report = buildReport(opts)
report.claim =
  "probed " + report.totals.probes + " field-probes (" + KINDS.join(", ") + ") on " + report.totals.targets + " targets; " +
  report.totals.quoted + " quoted verbatim, " + report.totals.notQuoted + " reported not-quoted; " +
  report.totals.findings + " finding(s). No claim is made about a field this prober did not probe."
printReport(report)
console.log(PREFIX + " " + report.claim)

if (opts.writeJson) {
  // T-53: refuse an existing target instead of silently replacing another task's evidence; the
  // remedy is an explicit NEW path (`--json-out <path>`).
  try {
    refuseOverwrite(opts.jsonOut, { label: "probe report", remedy: opts.jsonOutExplicit ? "pass a NEW --json-out <path>" : "pass --json-out <new-path>" })
  } catch (error) {
    exitOnRefusal(error, PREFIX)
  }
  mkdirSync(dirname(opts.jsonOut), { recursive: true })
  writeFileSync(opts.jsonOut, JSON.stringify(report, null, 2) + "\n")
  console.log(PREFIX + " probe list written to " + relative(repoRoot, opts.jsonOut) + (opts.jsonOutExplicit ? " (explicit target)" : " (timestamped default)"))
}
process.exit(report.totals.findings === 0 ? 0 : 1)
