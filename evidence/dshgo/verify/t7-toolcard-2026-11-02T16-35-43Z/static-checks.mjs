// T7 STATIC CHECKS: the tool-card census, the panel budgets on BOTH paths, and the seam rule.
// Read-only: it reads sources and the lane's built trees, and writes only its own report file.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { BUDGETS, V2_ONLY_COMPONENTS, measureView } from "../../../../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** This report's directory. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The repository root. */
const REPO = dirname(dirname(dirname(dirname(HERE))))
/** The lane's four built trees, the subject of the budget arm. */
const TREES = join(REPO, "evidence", "dshgo", "native-surfaces", "2026-11-02T16-22-21Z")

/** The 14 tools contract D6 names, package by package, as the contract's table is authoritative. */
const EXPECTED = {
  "mpd-team-core-plugin": ["agent_teams_plan", "agent_teams_task", "agent_teams_dispatch"],
  "mpd-roles-plugin": ["mpd_roles_list", "mpd_role_spawn"],
  "mpd-workmate-plugin": ["mpd_workmate_list", "mpd_workmate_match"],
  "mpd-memory-plugin": ["mpd_memory_read", "mpd_memory_write", "mpd_memory_status"],
  "mpd-verify-plugin": ["mpd_verify_record", "mpd_verify_evidence"],
  "mpd-autoproject-plugin": ["mpd_boulder_status"],
  "mpd-team-watchdog-plugin": ["session-watchdog-status"],
}
/** Every expected tool name, flattened. */
const expectedNames = Object.values(EXPECTED).flat()
/** The tool-name prefixes this bundle registers; used to tell a tool definition from any other `name:` key. */
const PREFIX = /^(mpd_|agent_teams_|session-watchdog-)/

/**
 * Every `.ts` file under a package's src, recursively.
 * @param dir the directory to walk
 * @param out the accumulator
 * @returns the file list
 */
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) sourceFiles(path, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path)
  }
  return out
}

/** The card census: each `presentationMeta` attributed to the nearest preceding tool `name:` in its file. */
const census = {}
/** Tools that carry a card but are NOT in the expected 14. */
const extra = []
/** Expected tools with no `presentationMeta` in their own package source. */
const missing = []
for (const pkg of Object.keys(EXPECTED)) {
  const dir = join(REPO, "packages", pkg, "src")
  const files = sourceFiles(dir)
  const named = new Map()
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    /** The `const X = "<tool>"` table of this file, so `name: X` resolves to its literal. */
    const constants = new Map([...text.matchAll(/const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*"([a-z0-9_-]+)"/g)].map((match) => [match[1], match[2]]))
    /** Every `name: "<tool>"` AND every `name: CONSTANT` resolved through the table, with offsets. */
    const names = [
      ...[...text.matchAll(/name:\s*"([a-z0-9_-]+)"/g)].map((match) => ({ name: match[1], at: match.index ?? 0 })),
      ...[...text.matchAll(/name:\s*([A-Z][A-Z0-9_]*)\b/g)].filter((match) => constants.has(match[1])).map((match) => ({ name: constants.get(match[1]), at: match.index ?? 0 })),
    ]
    /** Every `presentationMeta:` with its offset. */
    const metas = [...text.matchAll(/presentationMeta:/g)].map((match) => match.index ?? 0)
    for (const at of metas) {
      /** The nearest tool name BEFORE the card, in the same file. */
      const owner = names.filter((entry) => entry.at < at && PREFIX.test(entry.name)).pop()
      if (owner === undefined) {
        extra.push({ package: pkg, file: relative(REPO, file), at, note: "presentationMeta with no preceding tool name in this file" })
        continue
      }
      named.set(owner.name, relative(REPO, file))
    }
  }
  census[pkg] = Object.fromEntries(named)
  for (const tool of EXPECTED[pkg]) if (!named.has(tool)) missing.push(`${pkg}:${tool}`)
  for (const tool of named.keys()) if (!EXPECTED[pkg].includes(tool)) extra.push({ package: pkg, tool })
}
/** The total number of distinct tools that carry a card. */
const censusNames = new Set(Object.values(census).flatMap((entry) => Object.keys(entry)))

/** The panel-budget arm: every tree measured against the panel budget and the v1 rules. */
const budgets = {}
for (const name of ["mpd-v2", "mpd-v1-fallback", "mpd-team-v2", "mpd-team-v1-fallback"]) {
  const view = JSON.parse(readFileSync(join(TREES, `${name}.json`), "utf8"))
  const measured = measureView(view)
  /** Every v2-only component name that survived into a v1 fallback. */
  const v2InV1 = []
  /** Every `style`/`accent` key that survived into a v1 fallback. */
  const decorationInV1 = []
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}[${index}]`))
    if (typeof node !== "object" || node === null) return
    const type = typeof node.type === "string" ? node.type : ""
    if (name.includes("v1") && V2_ONLY_COMPONENTS.includes(type)) v2InV1.push(`${path}:${type}`)
    if (name.includes("v1") && ("style" in node || "accent" in node)) decorationInV1.push(path)
    for (const key of ["children", "items"]) if (Array.isArray(node[key])) node[key].forEach((item, index) => walk(item, `${path}.${key}[${index}]`))
  }
  walk(view, "view")
  budgets[name] = {
    bytes: measured.bytes,
    nodes: measured.nodes,
    depth: measured.depth,
    budget: BUDGETS.panel,
    withinBudget: measured.bytes <= BUDGETS.panel.bytes && measured.nodes <= BUDGETS.panel.nodes && measured.depth <= BUDGETS.panel.depth,
    headroom: { bytes: BUDGETS.panel.bytes - measured.bytes, nodes: BUDGETS.panel.nodes - measured.nodes, depth: BUDGETS.panel.depth - measured.depth },
    v2OnlyComponentsInV1: v2InV1,
    decorationKeysInV1: decorationInV1,
    rootV: view.v ?? null,
    rootAccent: view.accent ?? null,
  }
}

/** The seam rule: no plugin row may name `ctx.dshGo` (only the adapter may). */
const seam = []
for (const pkg of readdirSync(join(REPO, "packages"))) {
  const dir = join(REPO, "packages", pkg, "src")
  let files
  try {
    files = sourceFiles(dir)
  } catch {
    continue
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    /** A DIRECT harness-service access: the seam rule's actual subject. */
    const direct = /ctx\s*\.\s*dshGo|ctx\s*\[\s*["']dshGo["']\s*\]|ctx\s*\.\s*get\s*\??\.\s*\(\s*["']dshGo["']/.test(text)
    /** An adapter-mediated reference: a service id handed to the adapter's own watcher. */
    const mediated = /onServiceBound\s*\(\s*\[[^\]]*["']dshGo["']/.test(text)
    if (!direct && !mediated) continue
    seam.push({ package: pkg, file: relative(REPO, file), adapter: pkg === "mpd-dsh-adapter-plugin", direct, mediated })
  }
}

/** The report. */
const report = {
  at: new Date().toISOString(),
  cardCensus: {
    expected: expectedNames.length,
    distinctToolsWithCard: censusNames.size,
    perPackage: census,
    missing,
    extra,
    names: [...censusNames].sort(),
  },
  panelBudgets: budgets,
  seam: {
    directViolations: seam.filter((entry) => entry.direct && !entry.adapter).map((entry) => entry.file),
    adapterMediated: seam.filter((entry) => entry.mediated && !entry.adapter).map((entry) => entry.file),
    adapterFiles: seam.filter((entry) => entry.adapter).map((entry) => entry.file),
    rule: "a plugin row may not touch ctx.dshGo; handing the id to the adapter's onServiceBound watcher is the sanctioned seam and is reported separately",
  },
}
writeFileSync(join(HERE, "static-checks.json"), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({
  cards: { expected: expectedNames.length, found: censusNames.size, missing, extra: extra.length },
  budgets: Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, `${value.bytes}B/${value.nodes}n/${value.depth}d inBudget=${value.withinBudget} v2InV1=${value.v2OnlyComponentsInV1.length} decorInV1=${value.decorationKeysInV1.length}`])),
  seamDirectViolations: report.seam.directViolations.length,
  seamAdapterMediated: report.seam.adapterMediated.length,
  seamAdapterFiles: report.seam.adapterFiles.length,
}, null, 1)}\n`)
