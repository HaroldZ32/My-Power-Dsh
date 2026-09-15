#!/usr/bin/env node
// t55 docs-parity checker.
//
// WHY THIS EXISTS: the task's VERIFY asks for "the repo's doc-pair/parity gate — locate it first".
// Located: there is NONE. `grep -rln 'zh-CN' scripts/ skills/dsh-qa/ packages/*/test/` returns only
// `scripts/pack-mpd.mjs` (which COPIES the README pair, asserting nothing) and
// `skills/dsh-qa/scripts/tui-spec-conformance.mjs` (which merely READS docs/tui.md or its twin for
// the trust-disclosure string). So the parity claims of this task are checked here, with explicit
// assertions, and the absence of a repo gate is recorded rather than papered over.
//
// Asserts, per bilingual pair:
//   1. both files exist;
//   2. the switch link sits directly under the title (EN links its zh twin, zh links its EN twin);
//   3. the heading TREE (levels + order, code fences excluded) is identical;
//   4. the TUI content this task added is present in BOTH languages;
//   5. no RTL/EDA/Verilog/VHDL vocabulary appears in any touched user-visible doc.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, "../../../..")
const pairs = [
  ["README.md", "README.zh-CN.md"],
  ["docs/user-guide.md", "docs/user-guide.zh-CN.md"],
  ["docs/architecture.md", "docs/architecture.zh-CN.md"],
  ["docs/development.md", "docs/development.zh-CN.md"],
  ["docs/index.md", "docs/index.zh-CN.md"],
]
const read = (rel) => readFileSync(join(REPO, rel), "utf8")
const lines = (rel) => read(rel).split("\n")
/** Heading tree = level + in-order sequence, ignoring fenced code blocks. */
const headingTree = (rel) => {
  const out = []
  let fenced = false
  for (const line of read(rel).split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const match = /^(#{1,6})\s+\S/.exec(line)
    if (match !== null) out.push(match[1].length)
  }
  return out
}
const checks = []
const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

for (const [en, zh] of pairs) {
  add(`exists:` + en, existsSync(join(REPO, en)), en)
  add(`exists:` + zh, existsSync(join(REPO, zh)), zh)
  if (!existsSync(join(REPO, en)) || !existsSync(join(REPO, zh))) continue
  const enHead = lines(en).slice(0, 6).join("\n")
  const zhHead = lines(zh).slice(0, 6).join("\n")
  // Docs link their twin by BASENAME (both files live in the same directory).
  const zhBase = zh.split("/").at(-1)
  const enBase = en.split("/").at(-1)
  add(`switch:${en}`, enHead.includes(`](${zhBase})`) || enHead.includes(`](./${zhBase})`) || enHead.includes(`](${zh})`) || enHead.includes(`](./${zh})`),
    "EN header links its zh twin: " + JSON.stringify(enHead.split("\n").slice(0, 3).join(" | ")))
  add(`switch:${zh}`, zhHead.includes(`](${enBase})`) || zhHead.includes(`](./${enBase})`) || zhHead.includes(`](${en})`) || zhHead.includes(`](./${en})`),
    "zh header links its EN twin: " + JSON.stringify(zhHead.split("\n").slice(0, 3).join(" | ")))
  const a = headingTree(en); const b = headingTree(zh)
  add(`heading-tree:${en}`,
    a.length === b.length && a.every((level, index) => level === b[index]),
    `EN ${a.length} headings [${a.join(",")}] vs zh ${b.length} [${b.join(",")}]`)
}

// The TUI content this task added, in BOTH languages.
const tuiMarkers = {
  "docs/user-guide.md": ["## 7. DSH-TUI edition", "### 7.1", "### 7.2", "### 7.3", "ambiguous-multi-root", "no-live-session", "after a restart"],
  "docs/user-guide.zh-CN.md": ["## 7. DSH-TUI 版本", "### 7.1", "### 7.2", "### 7.3", "ambiguous-multi-root", "no-live-session", "重启"],
  "docs/architecture.md": ["## 7b. TUI edition wiring", "mpd-tui", "@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js", "tuiSettingsSections", "tuiStatus", "zero-write"],
  "docs/architecture.zh-CN.md": ["## 7b. TUI 版本接线", "mpd-tui", "@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js", "tuiSettingsSections", "tuiStatus", "零写入"],
  "docs/development.md": ["tui-mount", "tui-panels", "tui-admission", "tui-distribution", "tui-spec-conformance", "tui-settings-bridge", "pack-mpd.mjs", "not-claimed"],
  "docs/development.zh-CN.md": ["tui-mount", "tui-panels", "tui-admission", "tui-distribution", "tui-spec-conformance", "tui-settings-bridge", "pack-mpd.mjs", "not-claimed"],
  "README.md": ["### DSH-TUI edition", "docs/tui.md", "after a restart"],
  "README.zh-CN.md": ["### DSH-TUI 版本", "docs/tui.md", "重启"],
  "docs/index.md": ["DSH-TUI edition chapter", "TUI edition wiring"],
  "docs/index.zh-CN.md": ["DSH-TUI 版本章节", "TUI 版本接线"],
}
for (const [rel, markers] of Object.entries(tuiMarkers)) {
  const text = existsSync(join(REPO, rel)) ? read(rel) : ""
  for (const marker of markers) add(`marker:${rel}:${marker}`, text.includes(marker), marker)
}

// Domain vocabulary the user ruled out, in every touched user-visible doc.
const banned = [/\bverilog\b/i, /\bvhdl\b/i, /\brtl\b/i, /\beda\b/i, /\bfpga\b/i, /\bsynthesis\b/i, /verilator/i, /iverilog/i, /yosys/i, /cocotb/i, /verible/i, /adder4/i, /cnt8/i]
for (const rel of Object.keys(tuiMarkers)) {
  const hit = banned.map((re) => re.exec(read(rel))?.[0]).filter(Boolean)
  add(`no-rtl-eda:${rel}`, hit.length === 0, hit.length === 0 ? "none" : "FOUND " + hit.join(", "))
}

const ok = checks.every((check) => check.ok)
writeFileSync(join(here, "docs-parity.json"), JSON.stringify({ ok, checks }, null, 2) + "\n")
console.log(checks.map((check) => (check.ok ? "ok   " : "FAIL ") + check.id + (check.ok ? "" : " — " + check.detail)).join("\n"))
console.log("\n" + String(checks.filter((check) => check.ok).length) + "/" + String(checks.length) + " checks passed; ok=" + String(ok))
process.exit(ok ? 0 : 1)
