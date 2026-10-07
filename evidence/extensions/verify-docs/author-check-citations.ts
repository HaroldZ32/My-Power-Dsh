#!/usr/bin/env node

// t9 docs-claims checker — every repo path, line anchor, directory and command the
// three adaptation documents cite must resolve on disk, and the two docs must be
// structurally split rather than cosmetically different.
//
// Run it with node, from anywhere:
//
//   node evidence/extensions/docs-claims/check-citations.mjs
//
// It is deterministic and offline: it spawns only the developer CLI (`validate`) and
// never a dsh boot. A citation that cannot be resolved is a FAILURE unless the line
// above it carries an explicit `<!-- citation-check: pending <task> -->` annotation,
// which is reported separately as a PENDING citation (a documented gap, never a
// silent one).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..")
const MANIFEST_FILE = "mpd-ext.json"
const TEMPLATE_TOKEN = "mpd-extension-template"
const SKELETON_ID = "for-agents-skeleton"
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")

const GUIDE_EN = "docs/extension-authoring-guide.md"
const GUIDE_ZH = "docs/extension-authoring-guide.zh-CN.md"
const AI_DOC = "EXTENSIONS-FOR-AGENTS.md"
const REPORT_EN = "docs/extension-adaptation-report.md"
const REPORT_ZH = "docs/extension-adaptation-report.zh-CN.md"
const STATUS_HEADING = /^## 12\./m

const SUBJECTS = [
  { path: GUIDE_EN, label: "human guide (EN)" },
  { path: GUIDE_ZH, label: "human guide (zh-CN)" },
  { path: AI_DOC, label: "agent contract" },
  { path: REPORT_EN, label: "report status section (EN)", from: STATUS_HEADING, required: true },
  { path: REPORT_ZH, label: "report status section (zh-CN)", from: STATUS_HEADING, required: true },
]

const ROOT_DIRS = ["docs/", "packages/", "skills/", "extensions/", "templates/", "scripts/", "evidence/", "presets/", "tests/", "src/"]
const PATH_PATTERN = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
const DIR_PATTERN = /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/)`/g
const COMMAND_PATTERN = /(?:^|\s)(?:bun|node)\s+((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/g

const results = []
const pending = []
const logs = []

function log(text) {
  logs.push(text)
  process.stdout.write(text + "\n")
}

function record(id, ok, detail) {
  results.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`)
  return ok
}

function lineCount(absolute) {
  return readFileSync(absolute, "utf8").split("\n").length
}

// ── citation extraction ──────────────────────────────────────────────────────
function analyze(file, subject) {
  const absolute = join(REPO, file)
  if (!existsSync(absolute)) return { file, error: "missing subject file", citations: [], pending: [] }
  const full = readFileSync(absolute, "utf8")
  let text = full
  let offset = 0
  if (subject.from !== undefined) {
    const match = subject.from.exec(full)
    if (match === null) return { file, error: `no status section (${STATUS_HEADING}) found`, citations: [], pending: [] }
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  const lines = text.split("\n")
  const base = dirname(absolute)
  const citations = []
  let nextFlag
  let nextFlagReason = ""
  let fenceFlag
  let fenceFlagReason = ""
  let inFence = false
  lines.forEach((line, index) => {
    const docLine = offset + index + 1
    if (line.startsWith("```")) {
      if (!inFence) {
        fenceFlag = nextFlag
        fenceFlagReason = nextFlagReason
        nextFlag = undefined
        nextFlagReason = ""
      } else {
        fenceFlag = undefined
        fenceFlagReason = ""
      }
      inFence = !inFence
      return
    }
    const flag = inFence ? fenceFlag : nextFlag
    const flagReason = inFence ? fenceFlagReason : nextFlagReason
    if (!inFence) {
      nextFlag = undefined
      nextFlagReason = ""
      const annotation = /citation-check:\s*(pending|illustrative)\s*:?\s*(.*?)\s*-->/.exec(line)
      if (annotation !== null) {
        nextFlag = annotation[1]
        nextFlagReason = annotation[2]
      }
    }
    const add = (kind, value, startLine, endLine) => {
      citations.push({ kind, value, line: startLine, endLine, docLine, flag, flagReason, base })
    }
    for (const match of line.matchAll(PATH_PATTERN)) {
      add("path", match[1], match[2] === undefined ? undefined : Number(match[2]), match[3] === undefined ? undefined : Number(match[3]))
    }
    for (const match of line.matchAll(DIR_PATTERN)) if (ROOT_DIRS.some((root) => match[1].startsWith(root))) add("dir", match[1])
    if (inFence) for (const match of line.matchAll(COMMAND_PATTERN)) add("command", match[1])
  })
  return {
    file,
    citations,
    pending: citations.filter((entry) => entry.flag === "pending"),
    illustrative: citations.filter((entry) => entry.flag === "illustrative"),
  }
}

function checkCitation(citation) {
  const target = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  const shown = relative(REPO, target) === "" ? citation.value : relative(REPO, target)
  if (!existsSync(target)) return `${shown} does not exist`
  if (citation.kind === "dir" && !statSync(target).isDirectory()) return `${shown} is not a directory`
  if (citation.kind === "path" && statSync(target).isDirectory()) return `${shown} is a directory, not a file`
  if (citation.line !== undefined) {
    const total = lineCount(target)
    if (citation.line > total || citation.line < 1) return `${shown}:${citation.line} is outside the file (${total} lines)`
    if (citation.endLine !== undefined && (citation.endLine > total || citation.endLine < citation.line)) {
      return `${shown}:${citation.line}-${citation.endLine} is outside the file (${total} lines)`
    }
  }
  return undefined
}

// ── structural split ─────────────────────────────────────────────────────────
function headings(text) {
  const out = []
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line)) out.push({ level: line.match(/^#+/)[0].length, text: line.replace(/^#+\s*/, "").trim() })
  }
  return out
}

function proseLines(text) {
  const out = []
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const trimmed = line.trim()
    if (trimmed.length >= 60 && !trimmed.startsWith("|")) out.push(trimmed)
  }
  return out
}

// ── the skeleton: materialize the doc's manifest and validate it ─────────────
function skeletonFromDoc() {
  const text = readFileSync(join(REPO, AI_DOC), "utf8")
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)]
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1])
      if (parsed?.id === SKELETON_ID) return { raw: block[1], parsed }
    } catch {
      continue
    }
  }
  return undefined
}

function materializeSkeleton(raw) {
  const sandbox = mkdtempSync(join(tmpdir(), "t9-docs-claims-"))
  const root = join(sandbox, SKELETON_ID)
  mkdirSync(root, { recursive: true })
  const copy = (sourceRoot, relativeDir) => {
    for (const entry of readdirSync(join(sourceRoot, relativeDir), { withFileTypes: true })) {
      const child = relativeDir === "" ? entry.name : join(relativeDir, entry.name)
      const renamed = child
        .split(sep)
        .map((segment) => segment.split(TEMPLATE_TOKEN).join(SKELETON_ID))
        .join(sep)
      if (entry.isDirectory()) {
        mkdirSync(join(root, renamed), { recursive: true })
        copy(sourceRoot, child)
        continue
      }
      const body = readFileSync(join(sourceRoot, child), "utf8")
      writeFileSync(join(root, renamed), [".json", ".md", ".mjs"].includes(extname(entry.name)) ? body.split(TEMPLATE_TOKEN).join(SKELETON_ID) : body)
    }
  }
  copy(TEMPLATE_DIR, "")
  writeFileSync(join(root, MANIFEST_FILE), raw.endsWith("\n") ? raw : raw + "\n")
  return { sandbox, root }
}

// ── run ──────────────────────────────────────────────────────────────────────
log("t9 docs-claims checker")
log(`repo ${REPO}`)
log("")

const analyzed = []
for (const subject of SUBJECTS) {
  const result = analyze(subject.path, subject)
  if (result.error !== undefined) {
    record(`subject:${subject.path}`, false, result.error)
    continue
  }
  analyzed.push({ subject, ...result })
}

const illustrative = []
let totalCitations = 0
for (const entry of analyzed) {
  const failures = []
  for (const citation of entry.citations) {
    if (citation.flag !== undefined) continue
    const problem = checkCitation(citation)
    if (problem !== undefined) failures.push(`doc line ${citation.docLine}: ${problem}`)
  }
  const counts = { path: 0, dir: 0, command: 0 }
  for (const citation of entry.citations) if (citation.flag === undefined) counts[citation.kind] += 1
  totalCitations += entry.citations.length
  record(
    `citations:${entry.file}`,
    failures.length === 0,
    `${entry.citations.length} citation(s) (checked ${counts.path + counts.dir + counts.command}: path ${counts.path}, dir ${counts.dir}, command ${counts.command}; pending ${entry.pending.length}, illustrative ${entry.illustrative.length}), ${failures.length} unresolved${failures.length > 0 ? `: ${failures.slice(0, 6).join(" | ")}` : ""}`,
  )
  for (const citation of entry.pending) {
    const problem = checkCitation(citation)
    pending.push(`${entry.file}:${citation.docLine} ${citation.kind} ${citation.value}${citation.flagReason === "" ? "" : ` — ${citation.flagReason}`}${problem === undefined ? " (IT RESOLVES NOW: remove the pending annotation)" : ` (${problem})`}`)
  }
  for (const citation of entry.illustrative) {
    illustrative.push(`${entry.file}:${citation.docLine} ${citation.kind} ${citation.value}${citation.flagReason === "" ? "" : ` — ${citation.flagReason}`}`)
  }
}

// the documented-pending and illustrative sets are reported, never hidden
record("annotations:pending", true, pending.length === 0 ? "none" : `${pending.length} documented pending citation(s): ${pending.join(" | ")}`)
record("annotations:illustrative", true, illustrative.length === 0 ? "none" : `${illustrative.length} illustrative citation(s) (extension-root-relative, not repo paths): ${illustrative.join(" | ")}`)

// heading trees: the guide pair must match, section by section
const guideEn = readFileSync(join(REPO, GUIDE_EN), "utf8")
const guideZh = readFileSync(join(REPO, GUIDE_ZH), "utf8")
const enHeadings = headings(guideEn)
const zhHeadings = headings(guideZh)
const sameTree = enHeadings.length === zhHeadings.length && enHeadings.every((entry, index) => entry.level === zhHeadings[index].level)
record("guide-heading-tree", sameTree, `${enHeadings.length} EN heading(s) vs ${zhHeadings.length} zh-CN heading(s), levels ${sameTree ? "identical" : "DIFFERENT"}`)

// the split is structural: no shared heading text, no shared prose line
const aiDoc = readFileSync(join(REPO, AI_DOC), "utf8")
const sharedHeadings = enHeadings.map((entry) => entry.text).filter((text) => headings(aiDoc).some((other) => other.text === text))
record("split-headings", sharedHeadings.length === 0, sharedHeadings.length === 0 ? "no heading text is shared between the human guide and the agent contract" : `shared: ${sharedHeadings.join(" | ")}`)
const guideProse = new Set(proseLines(guideEn))
const sharedProse = proseLines(aiDoc).filter((line) => guideProse.has(line))
record("split-prose", sharedProse.length === 0, sharedProse.length === 0 ? "no prose line (>= 60 chars, outside code fences) is reused" : `reused: ${sharedProse.slice(0, 3).join(" | ")}`)

// the agent contract's manifest skeleton must validate with the real validator
const skeleton = skeletonFromDoc()
if (skeleton === undefined) {
  record("skeleton-validates", false, `no \`\`\`json block whose id is "${SKELETON_ID}" was found in ${AI_DOC}`)
} else {
  const { sandbox, root } = materializeSkeleton(skeleton.raw)
  const run = spawnSync("bun", [join(REPO, "scripts", "mpd-ext.mjs"), "validate", root], { cwd: REPO, encoding: "utf8" })
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  const ok = run.status === 0 && output.includes("loadable")
  record("skeleton-validates", ok, `the extracted manifest + the template's four assets: validate exit ${run.status}; ${output.trim().split("\n").filter((line) => line.includes("contributes:")).join(" ")}`)
  if (!ok) log(output)
  rmSync(sandbox, { recursive: true, force: true })
}

// ── the contract gates (opt-in: --gates), recorded with raw output ───────────
const gates = []
if (process.argv.includes("--gates")) {
  mkdirSync(join(HERE, "raw"), { recursive: true })
  const specs = [
    { id: "docs-parity", command: "node scripts/verify-docs-parity.mjs", bin: "node", args: ["scripts/verify-docs-parity.mjs"], raw: "raw/gate-docs-parity.txt" },
    { id: "example-validates", command: "bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.mjs"), "validate", join(REPO, "extensions", "mpd-ext-example")], raw: "raw/gate-validate-example.txt" },
    { id: "cli-self-test", command: "bun scripts/mpd-ext.mjs --self-test", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.mjs"), "--self-test"], raw: "raw/gate-selftest.txt" },
  ]
  for (const spec of specs) {
    const run = spawnSync(spec.bin, spec.args, { cwd: REPO, encoding: "utf8" })
    const output = (run.stdout ?? "") + (run.stderr ?? "")
    writeFileSync(join(HERE, spec.raw), output)
    const evidence = output.trim().split("\n").filter((line) => line.trim() !== "").slice(-2).join(" | ")
    gates.push({ id: spec.id, command: spec.command, exitCode: run.status, status: run.status === 0 ? "passed" : "failed", evidence, raw: spec.raw })
    record(`gate:${spec.id}`, run.status === 0, `${spec.command} — exit ${run.status}; ${evidence.slice(0, 150)}`)
  }
}

const failed = results.filter((entry) => entry.status === "failed")
const report = {
  task: "t9",
  attempt_id: "bad96fe3-156f-4156-943b-18a86e2b9cf7",
  subjects: SUBJECTS.map((subject) => subject.path),
  citations_checked: totalCitations - pending.length - illustrative.length,
  citations_pending: pending.length,
  citations_illustrative: illustrative.length,
  pending,
  illustrative,
  gates,
  checks: results,
  failed: failed.map((entry) => `${entry.id}: ${entry.detail}`),
  passed: results.length - failed.length,
  total: results.length,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(HERE, "output.log"), logs.join("\n") + "\n")
log("")
log(`[t9 docs-claims] ${report.passed}/${report.total} checks passed, ${failed.length} failed, ${report.citations_checked} citation(s) resolved, ${pending.length} pending, ${illustrative.length} illustrative`)
process.exitCode = failed.length === 0 ? 0 : 1
