#!/usr/bin/env node
// REVIEW INSTRUMENTATION, not product code. It asserts the machine-checkable half of
// `.mpd/plans/dshgo-native-parity.md` §7.2 against a BUILT panel view (`-` reads stdin).
//
// WHY IT EXISTS. The app-side checker (`sdk/plugin-kit/bin/check.mjs`) proves LEGALITY,
// component limits and budgets, and its colour diagnostics are contrast corrections that
// never fail the exit code. It does NOT enforce §7.2: a named colour, a `card:"plain"` body,
// metrics outside a `grid` and several `style:"primary"` buttons all pass it with exit 0
// (measured 2026-11-02, evidence/dshgo/verify/2026-11-02T15-44-36Z/output.log). §7.3 asks the
// diagnostics to be READ; this probe turns the design rules into an exit code so the reading
// is not a human promise.
//
// This file writes nothing and is NOT part of the shipped gate: it is the reviewer's
// executable checklist. Folding equivalent assertions into `scripts/verify-dshgo-views.ts`
// is the writers' decision, described in the review report and not applied here.
import { readFileSync } from "node:fs"

/** Spacing values the app executes; a number is downgraded with a diagnostic (styles.md). */
const SPACING = new Set(["S", "M", "L"])
/** Container card variants; `tinted` is the one hero, `surface`/`outlined` the body. */
const CARDS = new Set(["plain", "surface", "tinted", "outlined"])
/** Components whose data makes a tab non-empty (rule 7 needs `emptyState` otherwise). */
const DATA_COMPONENTS = new Set([
  "list", "table", "keyValue", "metric", "chart", "progress", "steps", "timeline", "badge", "gallery", "image",
])
/** Data-ENTRY components: a tab holding a form is not an empty tab, even with no rows yet. */
const INPUT_COMPONENTS = new Set([
  "form", "textField", "number", "stepper", "toggle", "slider", "select", "segmented", "chips", "date", "time", "rating",
])
/** Components that only exist in view v2; `adaptView` must have removed every one in a v1 tree. */
const V2_ONLY = new Set([
  "tabs", "collapsible", "accordion", "carousel", "timeline", "grid", "badge", "tag", "avatar", "codeBlock",
  "divider", "spacer", "emptyState", "gallery", "form", "textField", "number", "stepper", "toggle", "slider",
  "select", "segmented", "chips", "date", "time", "rating",
])
/** Severities that make the probe exit non-zero. */
const BLOCKING = new Set(["Blocker", "High", "Medium"])

/**
 * Walks one view tree, collecting findings. `ancestors` is the node path above the current
 * node so a rule can ask what container a metric sits in; `tab` records which tab index the
 * node belongs to for the per-tab hero count.
 * @param {unknown} node the node under inspection
 * @param {string} path the diagnostic path (`view`, `view.items[0].children[2]`, …)
 * @param {string[]} ancestors `type` of every ancestor, outermost first
 * @param {number} tab the tab index this node belongs to, or -1 before the split
 * @param {object} state probes' accumulator (findings, heroCount, textNodes, metrics, primaries)
 * @param {boolean} v1 whether the tree is the `adaptView` fallback (v1 rules apply)
 */
function walk(node, path, ancestors, tab, state, v1) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, `${path}[${index}]`, ancestors, tab, state, v1))
    return
  }
  if (typeof node !== "object" || node === null) return
  const type = typeof node.type === "string" ? node.type : undefined
  const label = type ?? "?"
  const add = (rule, severity, message) => state.findings.push({ rule, severity, path, message })

  if (v1) {
    if (V2_ONLY.has(label)) add("V1_COMPONENT", "Blocker", `v2-only component \`${label}\` survived adaptView`)
    if ("accent" in node) add("V1_STYLE", "Blocker", "`accent` survived adaptView; a v1 view must carry no style keys")
    if ("style" in node) add("V1_STYLE", "Blocker", "`style` survived adaptView; a v1 view must carry no style keys")
    if (type === "text" && (typeof node.text !== "string" || node.text.trim() === "")) {
      add("V1_TEXT", "Blocker", "a v1 `text` node has no text; the fallback loses its meaning")
    }
  } else {
    if (type === "metric") {
      state.metrics.push(path)
      if (!ancestors.includes("grid")) {
        add("METRIC_GRID", "High", "`metric` is outside a `grid` (rule 4: metrics read as tiles)")
      }
    }
    if (type === "badge" || type === "tag") {
      if (typeof node.text !== "string" || node.text.trim() === "") {
        add("BADGE_TEXT", "High", "`badge`/`tag` has no text (rule 5: status is never colour-only)")
      }
    }
    if (typeof node.tone === "string" && !hasWord(node)) {
      add("TONE_WORD", "Medium", `\`tone:"${node.tone}"\` carries no word (rule 5)`)
    }
    if (type === "text" && typeof node.text === "string" && node.text.length > 80) {
      const lines = node.style && typeof node.style === "object" ? node.style.maxLines : undefined
      if (lines === undefined) {
        state.textNodes.push(path)
        add("MAXLINES", "Nit", "long free text has no `style.maxLines` (rule 9)")
      }
    }
    for (const key of ["accent", "color", "background"]) {
      if (key in node && !(node.style && key in node.style)) {
        if (key !== "accent") add("COLOUR_TOPLEVEL", "Nit", `\`${key}\` at node level is not a v2 style slot and is silently ignored; write it under \`style\``)
      }
    }
    if (path !== "view" && "accent" in node) add("ACCENT_NESTED", "Medium", "`accent` is root-only; a nested accent is ignored")
    const style = node.style
    if (typeof style === "object" && style !== null && !Array.isArray(style)) {
      if (typeof style.card === "string") {
        if (!CARDS.has(style.card)) add("CARD_VALUE", "Medium", `unknown card variant \`${style.card}\``)
        else if (style.card === "plain") add("CARD_PLAIN", "Medium", '`card:"plain"` is the v1 dump; rule 3 asks for `surface`/`outlined`')
        else if (style.card === "tinted") state.heroCount += 1
      }
      for (const key of ["padding", "gap"]) {
        if (style[key] !== undefined && !SPACING.has(style[key])) {
          add("SPACING", "Medium", `\`style.${key}: ${JSON.stringify(style[key])}\` is not S/M/L (rule 9)`)
        }
      }
      for (const key of ["color", "background"]) {
        if (style[key] !== undefined && style[key] !== "accent") {
          add("COLOUR", "Blocker", `\`style.${key}: ${JSON.stringify(style[key])}\` is not the theme token \`accent\` (rule 1)`)
        }
      }
    }
    if (type === "spacer" && !SPACING.has(node.size)) {
      add("SPACING", "Medium", `\`spacer.size: ${JSON.stringify(node.size)}\` is not S/M/L (rule 9)`)
    }
    if (type === "actions" && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (typeof item === "object" && item !== null && item.style === "primary") state.primaries.push(path)
      }
    }
    if (type === "emptyState") state.emptyState = true
    if (DATA_COMPONENTS.has(label) || INPUT_COMPONENTS.has(label)) state.data = true
    if (JSON.stringify(node).includes('"$":')) state.data = true
  }

  const children = node.children
  if (Array.isArray(children)) {
    for (let index = 0; index < children.length; index += 1) {
      walk(children[index], `${path}.children[${index}]`, [...ancestors, label], tab, state, v1)
    }
  }
  const list = node.items
  if (Array.isArray(list)) {
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index]
      const itemPath = `${path}.items[${index}]`
      if (type === "tabs") {
        const tabState = newState()
        walk(item, itemPath, [...ancestors, label], index, tabState, v1)
        state.tabs.push({ index: itemPath, findings: tabState.findings, heroCount: tabState.heroCount, data: tabState.data, emptyState: tabState.emptyState })
      } else {
        walk(item, itemPath, [...ancestors, label], tab, state, v1)
      }
    }
  }
}

/** A fresh accumulator; `hasWord` is defined as a method-free predicate to stay serialisable. */
function newState() {
  return { findings: [], heroCount: 0, primaries: [], metrics: [], textNodes: [], tabs: [], data: false, emptyState: false }
}

/**
 * The one predicate the walker needs that is about the node, not the tree: a node carrying a
 * `tone` must also carry the word that survives greyscale and the text fallback.
 * @param {Record<string, unknown>} node
 * @returns {boolean} true when the node also carries a word
 */
function hasWord(node) {
  for (const key of ["text", "label", "value", "title", "message", "caption"]) {
    if (typeof node[key] === "string" && node[key].trim() !== "") return true
  }
  return false
}

/**
 * Runs every §7.2 check over one view.
 * @param {unknown} view parsed JSON view
 * @param {{ v1?: boolean }} options `v1: true` applies the adaptView fallback rules
 * @returns {{ findings: Array<{rule: string, severity: string, path: string, message: string}>, metrics: string[], tabs: number, heroPerTab: number[] }}
 */
export function checkSection7(view, options = {}) {
  const v1 = options.v1 === true
  const state = newState()
  const root = view && typeof view === "object" && !Array.isArray(view) ? view : {}
  if (!v1) {
    if (root.v !== 2) state.findings.push({ rule: "V2_ROOT", severity: "Blocker", path: "view", message: "the live panel root is not `v: 2`" })
    if (root.accent !== "app") {
      state.findings.push({ rule: "ACCENT", severity: "Blocker", path: "view", message: `root accent is ${JSON.stringify(root.accent)}, not the theme token "app" (rule 1)` })
    }
  }
  walk(root, "view", [], -1, state, v1)
  const tabs = root.type === "tabs" && Array.isArray(root.items) ? root.items.length : 1
  if (!v1) {
    const perTab = state.tabs.length > 0
      ? state.tabs.map((tab) => tab.heroCount)
      : [state.heroCount]
    perTab.forEach((count, index) => {
      if (count !== 1) {
        state.findings.push({
          rule: "HERO",
          severity: "High",
          path: state.tabs.length > 0 ? state.tabs[index].index : "view",
          message: `tab ${index + 1} has ${count} \`card:"tinted"\` hero sections; rule 2 asks for exactly one`,
        })
      }
    })
    if (state.primaries.length > 1) {
      state.findings.push({
        rule: "PRIMARY",
        severity: "Medium",
        path: state.primaries[0],
        message: `${state.primaries.length} \`style:"primary"\` actions in one view; rule 8 allows one`,
      })
    }
    for (const tab of state.tabs) {
      if (!tab.data && !tab.emptyState) {
        state.findings.push({ rule: "EMPTY_TAB", severity: "Medium", path: tab.index, message: "tab has no data and no `emptyState` (rule 7)" })
      }
    }
    if (state.tabs.length === 0 && !state.data && !state.emptyState) {
      state.findings.push({ rule: "EMPTY_TAB", severity: "Medium", path: "view", message: "view has no data and no `emptyState` (rule 7)" })
    }
  }
  return { findings: state.findings, metrics: state.metrics, tabs, heroPerTab: state.tabs.map((tab) => tab.heroCount) }
}

/** §7.2's own sub-clauses the probe cannot decide from a tree alone. */
export const DECLINED = [
  "the rendered result (no Flutter app here; §7.3 declares it UNPROVEN)",
  "whether the copy is good prose (§7.2 rule 7 says 'designed copy'; a checker cannot judge it)",
  "whether a tab is empty at runtime when its data is a binding (§7.2 rule 7 is decided on the pushed model, not the tree)",
  "contrast corrections: the app auto-corrects; only an unexplained correction is a design signal",
]

/** The legal sample: tabs root, one tinted hero per tab, grid metrics, badge with a word, emptyState. */
const LEGAL = {
  v: 2,
  accent: "app",
  type: "tabs",
  items: [
    {
      label: "Board",
      children: [
        {
          type: "stack",
          style: { card: "tinted", padding: "M", gap: "S" },
          children: [
            { type: "text", text: "Board", style: { size: "title", weight: "bold" } },
            { type: "text", text: "3 ready · 1 active", style: { size: "caption" } },
            { type: "grid", columns: 2, children: [{ type: "metric", label: "Ready", value: "3" }] },
          ],
        },
        { type: "badge", text: "in progress", tone: "info" },
        { type: "divider" },
        { type: "actions", items: [{ label: "Refresh", action: "refresh", style: "primary" }] },
      ],
    },
    {
      label: "Questions",
      children: [
        {
          type: "stack",
          style: { card: "tinted", padding: "M", gap: "S" },
          children: [{ type: "text", text: "Questions", style: { size: "title", weight: "bold" } }],
        },
        { type: "emptyState", title: "No question parked", message: "A question shows up here when the team asks one." },
      ],
    },
  ],
}

/** The illegal sample: no accent, a named colour, metrics outside a grid, two primaries, a plain card. */
const ILLEGAL = {
  v: 2,
  type: "stack",
  style: { card: "plain", padding: 12 },
  children: [
    { type: "text", text: "x".repeat(120), style: { color: "amber" } },
    { type: "metric", label: "Ready", value: "3" },
    { type: "actions", items: [{ label: "A", action: "a", style: "primary" }, { label: "B", action: "b", style: "primary" }] },
    { type: "badge", tone: "warn" },
  ],
}

/** A legal v1 fallback: no style keys, no v2 components, every text carries its word. */
const V1_LEGAL = {
  type: "stack",
  title: "Board",
  children: [
    { type: "text", text: "Board" },
    { type: "list", items: [{ title: "T1 — ready" }] },
  ],
}

/** A tab that is NOT empty: a bound callout plus a form, exactly the Questions tab's shape. */
const BOUND_TAB = {
  v: 2,
  accent: "app",
  type: "tabs",
  items: [
    {
      label: "Questions",
      children: [
        {
          type: "stack",
          style: { card: "tinted", padding: "M", gap: "S" },
          children: [{ type: "text", text: "Questions", style: { size: "title", weight: "bold" } }],
        },
        { type: "callout", text: { $: "data.question.question" }, tone: "info" },
        { type: "form", children: [{ type: "textField", label: "Custom answer", bind: "data.customAnswer" }] },
      ],
    },
  ],
}

/** A truly blank tab: a hero and nothing else. Rule 7 wants `emptyState` here. */
const BLANK_TAB = {
  v: 2,
  accent: "app",
  type: "tabs",
  items: [
    {
      label: "Empty",
      children: [
        {
          type: "stack",
          style: { card: "tinted", padding: "M", gap: "S" },
          children: [{ type: "text", text: "Empty", style: { size: "title", weight: "bold" } }],
        },
      ],
    },
  ],
}

/** A v1 tree that kept a v2 component and a style key: adaptView did not finish its job. */
const V1_ILLEGAL = {
  type: "stack",
  accent: "app",
  children: [{ type: "grid", children: [{ type: "metric", label: "Ready", value: "3" }] }],
}

/**
 * Reproduces the probe's contract on fixtures so a PASS means the probe can fail.
 * @returns {number} process exit code
 */
function selfTest() {
  const arms = []
  const legal = checkSection7(LEGAL)
  const blockingLegal = legal.findings.filter((finding) => BLOCKING.has(finding.severity))
  arms.push(["legal v2 tree is accepted", blockingLegal.length === 0, blockingLegal])
  const illegal = checkSection7(ILLEGAL)
  const rules = new Set(illegal.findings.map((finding) => finding.rule))
  const expected = ["ACCENT", "COLOUR", "METRIC_GRID", "PRIMARY", "SPACING", "CARD_PLAIN", "MAXLINES", "BADGE_TEXT", "TONE_WORD", "HERO"]
  const missing = expected.filter((rule) => !rules.has(rule))
  arms.push(["illegal v2 tree reports every planted rule", missing.length === 0, { missing, rules: [...rules] }])
  const v1Legal = checkSection7(V1_LEGAL, { v1: true })
  const v1Blocking = v1Legal.findings.filter((finding) => BLOCKING.has(finding.severity))
  arms.push(["legal v1 fallback is accepted", v1Blocking.length === 0, v1Blocking])
  const bound = checkSection7(BOUND_TAB)
  const boundBlocking = bound.findings.filter((finding) => BLOCKING.has(finding.severity))
  arms.push(["a tab with a binding or a form is not 'empty'", boundBlocking.length === 0, boundBlocking])
  const blank = checkSection7(BLANK_TAB)
  arms.push(["a blank tab is refused", blank.findings.some((finding) => finding.rule === "EMPTY_TAB"), blank.findings])
  const v1Illegal = checkSection7(V1_ILLEGAL, { v1: true })
  const v1Rules = new Set(v1Illegal.findings.map((finding) => finding.rule))
  arms.push(["v1 leftovers are refused", v1Rules.has("V1_COMPONENT") && v1Rules.has("V1_STYLE"), [...v1Rules]])
  let ok = true
  for (const [name, pass, detail] of arms) {
    process.stdout.write(`  ${pass ? "ok  " : "FAIL"}  ${name}\n`)
    if (!pass) {
      ok = false
      process.stdout.write(`        ${JSON.stringify(detail)}\n`)
    }
  }
  process.stdout.write(ok ? "SELF-TEST PASS\n" : "SELF-TEST FAIL\n")
  return ok ? 0 : 1
}

/**
 * Reads one view (file path, or `-` for stdin), runs the checks and prints the report.
 * @param {string[]} argv `check` arguments (`-`, a path, `--v1`, `--json`)
 * @returns {number} process exit code
 */
function main(argv) {
  if (argv.includes("--self-test")) return selfTest()
  const v1 = argv.includes("--v1")
  const json = argv.includes("--json")
  const target = argv.find((arg) => !arg.startsWith("--")) ?? "-"
  let text
  try {
    text = readFileSync(target === "-" ? 0 : target, "utf8")
  } catch (error) {
    process.stderr.write(`probe-section7: cannot read ${target}: ${error.message}\n`)
    return 2
  }
  let view
  try {
    view = JSON.parse(text)
  } catch (error) {
    process.stderr.write(`probe-section7: ${target} is not JSON: ${error.message}\n`)
    return 2
  }
  const result = checkSection7(view, { v1 })
  const counts = result.findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
    return acc
  }, {})
  const blocking = result.findings.filter((finding) => BLOCKING.has(finding.severity))
  if (json) {
    process.stdout.write(`${JSON.stringify({ target, v1, counts, blocking: blocking.length, findings: result.findings, declined: DECLINED })}\n`)
  } else {
    process.stdout.write(`section7 ${target}${v1 ? " (v1 fallback)" : ""}: ${blocking.length === 0 ? "OK" : "FINDINGS"} — ${JSON.stringify(counts)}\n`)
    for (const finding of result.findings) {
      process.stdout.write(`  ${finding.severity.padEnd(8)} ${finding.rule} ${finding.path}: ${finding.message}\n`)
    }
  }
  return blocking.length === 0 ? 0 : 1
}

process.exitCode = main(process.argv.slice(2))
