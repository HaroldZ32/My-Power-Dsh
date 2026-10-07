#!/usr/bin/env node
// t12 independent verifier for the t9 documentation deliverables (does NOT reuse the author's
// checker logic). Covers:
//   1. markdown LINK resolution with GitHub-style heading anchors (the author's checker never
//      looked at links or anchors);
//   2. an independent citation scan — correct repo-relative vs doc-relative resolution, shorthand
//      continuation anchors (`:793`), and BLANK_ANCHOR detection (an anchor that lands on an empty
//      line cannot be resolving to the thing it cites);
//   3. hand-picked semantic samples (samples.json): the cited lines must carry the cited symbol;
//   4. a PARAGRAPH-level structural split (blank-line blocks, >= 80 normalised chars);
//   5. skeleton extraction + `mpd-ext validate`, plus a NEGATIVE control (one declared asset
//      removed must make the validator exit non-zero), so "validates" is falsifiable;
//   6. the sha256 of every subject and cited source file, so the verdict is anchored to a revision.
//
// Usage: node <this file>  → independent-result.json next to itself.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
function findRepo(start) {
  let dir = start
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) {
      try {
        if (JSON.parse(readFileSync(candidate, "utf8")).name === "@mpd-dsh/mpd") return dir
      } catch {}
    }
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  throw new Error("repo root (@mpd-dsh/mpd) not found above " + start)
}
const REPO = findRepo(HERE)

const DOCS = [
  "README.md",
  "README.zh-CN.md",
  "docs/index.md",
  "docs/index.zh-CN.md",
  "docs/extension-authoring-guide.md",
  "docs/extension-authoring-guide.zh-CN.md",
  "EXTENSIONS-FOR-AGENTS.md",
]
const CITATION_SUBJECTS = [
  { doc: "docs/extension-authoring-guide.md", scope: "full" },
  { doc: "docs/extension-authoring-guide.zh-CN.md", scope: "full" },
  { doc: "EXTENSIONS-FOR-AGENTS.md", scope: "full" },
  { doc: "docs/extension-adaptation-report.md", scope: "status-section" },
  { doc: "docs/extension-adaptation-report.zh-CN.md", scope: "status-section" },
]
const STATUS_HEADING = /^## 12\./m
const SPLIT_PAIR = ["docs/extension-authoring-guide.md", "EXTENSIONS-FOR-AGENTS.md"]
const AI_DOC = "EXTENSIONS-FOR-AGENTS.md"
const SKELETON_ID = "for-agents-skeleton"
const TEMPLATE_TOKEN = "mpd-extension-template"
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")

const results = []
function record(id, ok, detail) {
  results.push({ id, status: ok ? "passed" : "failed", detail })
  process.stdout.write(`  ${ok ? "ok  " : "FAIL"} ${id} — ${detail}\n`)
  return ok
}
const sha256 = (absolute) => createHash("sha256").update(readFileSync(absolute)).digest("hex")

// ── 1. links + heading anchors ────────────────────────────────────────────────
function slugify(heading) {
  return heading.trim().replace(/\s+#+\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim().replace(/ /g, "-")
}
function headingSlugs(text) {
  const slugs = new Set()
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match !== null) slugs.add(slugify(match[2]))
  }
  return slugs
}
function checkLinks() {
  const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const problems = []
  let checked = 0
  let anchored = 0
  for (const doc of DOCS) {
    const absolute = join(REPO, doc)
    const text = readFileSync(absolute, "utf8")
    const slugCache = new Map()
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(LINK)) {
        const raw = match[1]
        if (/^(https?:|mailto:)/.test(raw)) continue
        const [pathPart, anchor] = raw.split("#")
        const target = pathPart === "" ? absolute : resolve(dirname(absolute), decodeURIComponent(pathPart))
        checked += 1
        if (!existsSync(target)) {
          problems.push(`${doc}:${index + 1} target missing: ${raw}`)
          continue
        }
        if (anchor !== undefined && anchor !== "") {
          anchored += 1
          if (statSync(target).isDirectory()) {
            problems.push(`${doc}:${index + 1} anchor on a directory: ${raw}`)
            continue
          }
          if (!slugCache.has(target)) slugCache.set(target, headingSlugs(readFileSync(target, "utf8")))
          const slugs = slugCache.get(target)
          if (!slugs.has(decodeURIComponent(anchor))) {
            problems.push(`${doc}:${index + 1} anchor "${anchor}" matches no heading in ${relative(REPO, target)}`)
          }
        }
      }
    })
  }
  record("links:targets+anchors", problems.length === 0, `${checked} relative link(s), ${anchored} with an anchor, ${problems.length} unresolved${problems.length > 0 ? `: ${problems.slice(0, 8).join(" | ")}` : ""}`)
  return { checked, anchored, problems }
}

// ── 2. independent citation scan ──────────────────────────────────────────────
const PATH = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
const CONTINUATION = /:(\d+)(?:[-–](\d+))?/g
const resolveCitation = (base, value) => (value.startsWith("./") || value.startsWith("../") ? resolve(base, value) : join(REPO, value))

function scanCitations() {
  const problems = []
  const anchors = []
  for (const subject of CITATION_SUBJECTS) {
    const absolute = join(REPO, subject.doc)
    const full = readFileSync(absolute, "utf8")
    let text = full
    let offset = 0
    if (subject.scope === "status-section") {
      const match = STATUS_HEADING.exec(full)
      if (match === null) {
        problems.push(`${subject.doc} has no §12 status section`)
        continue
      }
      offset = full.slice(0, match.index).split("\n").length - 1
      text = full.slice(match.index)
    }
    const base = dirname(absolute)
    text.split("\n").forEach((line, index) => {
      const docLine = offset + index + 1
      const matches = [...line.matchAll(PATH)]
      matches.forEach((match, position) => {
        const tailStart = match.index + match[0].length
        const tailEnd = position + 1 < matches.length ? matches[position + 1].index : line.length
        const list = []
        if (match[2] !== undefined) list.push([Number(match[2]), match[3] === undefined ? Number(match[2]) : Number(match[3])])
        for (const continuation of line.slice(tailStart, tailEnd).matchAll(CONTINUATION)) list.push([Number(continuation[1]), continuation[2] === undefined ? Number(continuation[1]) : Number(continuation[2])])
        const target = resolveCitation(base, match[1])
        for (const [start, end] of list) {
          const token = `${match[1]}:${start}${end === start ? "" : `-${end}`}`
          const where = `${subject.doc}:${docLine}`
          if (!existsSync(target)) {
            problems.push(`${where} ${token} — file missing`)
            continue
          }
          if (statSync(target).isDirectory()) {
            problems.push(`${where} ${token} — is a directory`)
            continue
          }
          const lines = readFileSync(target, "utf8").split("\n")
          if (start < 1 || end < start || end > lines.length) {
            problems.push(`${where} ${token} — outside the file (${lines.length} lines)`)
            continue
          }
          const slice = lines.slice(start - 1, end)
          const blank = slice.every((entryLine) => entryLine.trim() === "")
          anchors.push({ where, token, status: blank ? "BLANK_ANCHOR" : "resolves", first: slice[0].trim().slice(0, 110) })
          if (blank) problems.push(`${where} ${token} — BLANK_ANCHOR (the cited line is empty)`)
        }
      })
    })
  }
  record("citations:independent-scan", problems.length === 0, `${anchors.length} line-anchor citation(s) in scope, ${problems.length} flagged${problems.length > 0 ? `: ${problems.slice(0, 10).join(" | ")}` : ""}`)
  return { anchors: anchors.length, problems, rows: anchors }
}

// ── 3. hand-picked semantic samples ───────────────────────────────────────────
function semanticSamples() {
  const file = join(HERE, "samples.json")
  if (!existsSync(file)) return record("citations:semantic-samples", false, "samples.json missing")
  const samples = JSON.parse(readFileSync(file, "utf8"))
  const problems = []
  for (const sample of samples) {
    const target = join(REPO, sample.file)
    const label = `${sample.doc} cites ${sample.file}:${sample.start}${sample.end === undefined ? "" : `-${sample.end}`} for ${sample.claim}`
    if (!existsSync(target)) {
      problems.push(`${label} — file missing`)
      continue
    }
    const lines = readFileSync(target, "utf8").split("\n")
    const slice = lines.slice(sample.start - 1, sample.end === undefined ? sample.start : sample.end).join("\n")
    const missing = sample.mustMatch.filter((needle) => !slice.includes(needle))
    if (missing.length > 0) problems.push(`${label} — the cited line(s) do not carry ${missing.join(" / ")}`)
  }
  record("citations:semantic-samples", problems.length === 0, `${samples.length} hand-picked anchor(s) checked against their cited line content, ${problems.length} mismatch(es)${problems.length > 0 ? `: ${problems.slice(0, 6).join(" | ")}` : ""}`)
  return { samples: samples.length, problems }
}

// ── 4. paragraph-level structural split ───────────────────────────────────────
function blocks(text, minChars) {
  const out = []
  let inFence = false
  let buffer = []
  const flush = () => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim()
    if (joined.length >= minChars && !joined.startsWith("|")) out.push(joined)
    buffer = []
  }
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      flush()
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line) || line.trim() === "") {
      flush()
      continue
    }
    buffer.push(line)
  }
  flush()
  return out
}
function structuralSplit() {
  const [human, machine] = SPLIT_PAIR.map((doc) => readFileSync(join(REPO, doc), "utf8"))
  const humanHeadings = new Set([...human.matchAll(/^#{1,6}\s+(.*)$/gm)].map((match) => match[1].trim()))
  const machineHeadings = [...machine.matchAll(/^#{1,6}\s+(.*)$/gm)].map((match) => match[1].trim())
  const sharedHeadings = machineHeadings.filter((heading) => humanHeadings.has(heading))
  record("split:headings", sharedHeadings.length === 0, `${machineHeadings.length} machine heading(s) vs ${humanHeadings.size} human heading(s), ${sharedHeadings.length} shared${sharedHeadings.length > 0 ? `: ${sharedHeadings.join(" | ")}` : ""}`)
  const humanBlocks = new Set(blocks(human, 80))
  const machineBlocks = blocks(machine, 80)
  const sharedBlocks = machineBlocks.filter((block) => humanBlocks.has(block))
  record("split:paragraphs", sharedBlocks.length === 0, `${machineBlocks.length} machine paragraph(s) (>= 80 chars) vs ${humanBlocks.size} human paragraph(s), ${sharedBlocks.length} duplicated${sharedBlocks.length > 0 ? `: ${sharedBlocks.slice(0, 2).map((block) => block.slice(0, 80)).join(" || ")}` : ""}`)
  return { sharedHeadings, sharedBlocks }
}

// ── 5. skeleton extract + validate + negative control ─────────────────────────
function extractSkeleton() {
  const text = readFileSync(join(REPO, AI_DOC), "utf8")
  for (const match of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed?.id === SKELETON_ID) return match[1]
    } catch {}
  }
  return undefined
}
function materialize(raw, mutate) {
  const sandbox = mkdtempSync(join(tmpdir(), "t12-verify-"))
  const root = join(sandbox, SKELETON_ID)
  mkdirSync(root, { recursive: true })
  const copy = (relativeDir) => {
    for (const entry of readdirSync(join(TEMPLATE_DIR, relativeDir), { withFileTypes: true })) {
      const child = relativeDir === "" ? entry.name : join(relativeDir, entry.name)
      const renamed = child.split(sep).map((segment) => segment.split(TEMPLATE_TOKEN).join(SKELETON_ID)).join(sep)
      if (entry.isDirectory()) {
        mkdirSync(join(root, renamed), { recursive: true })
        copy(child)
        continue
      }
      const body = readFileSync(join(TEMPLATE_DIR, child), "utf8")
      writeFileSync(join(root, renamed), [".json", ".md", ".mjs"].includes(extname(entry.name)) ? body.split(TEMPLATE_TOKEN).join(SKELETON_ID) : body)
    }
  }
  copy("")
  writeFileSync(join(root, "mpd-ext.json"), raw.endsWith("\n") ? raw : raw + "\n")
  if (mutate !== undefined) mutate(root)
  return { sandbox, root }
}
function validateSkeleton() {
  const raw = extractSkeleton()
  if (raw === undefined) return record("skeleton:extracted", false, `no json block with id "${SKELETON_ID}" in ${AI_DOC}`)
  try {
    JSON.parse(raw)
  } catch (error) {
    return record("skeleton:extracted", false, `the skeleton block is not valid JSON: ${error.message}`)
  }
  record("skeleton:extracted", true, `json block with id "${SKELETON_ID}" parsed (${raw.split("\n").length} lines)`)
  const healthy = materialize(raw, undefined)
  const run = spawnSync("bun", [join(REPO, "scripts", "mpd-ext.mjs"), "validate", healthy.root], { cwd: REPO, encoding: "utf8" })
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  const summary = output.split("\n").filter((line) => line.includes("contributes:") || line.includes("[mpd-ext]")).join(" | ")
  record("skeleton:validates", run.status === 0, `mpd-ext validate over the extracted skeleton → exit ${run.status}; ${summary}`)
  rmSync(healthy.sandbox, { recursive: true, force: true })

  const broken = materialize(raw, (root) => rmSync(join(root, "personas", `${SKELETON_ID}-reviewer.md`), { force: true }))
  const negRun = spawnSync("bun", [join(REPO, "scripts", "mpd-ext.mjs"), "validate", broken.root], { cwd: REPO, encoding: "utf8" })
  const negOutput = (negRun.stdout ?? "") + (negRun.stderr ?? "")
  const negSummary = negOutput.split("\n").filter((line) => line.trim() !== "").slice(-2).join(" | ")
  record("skeleton:negative-control", negRun.status !== 0, `same skeleton with its declared persona file deleted → exit ${negRun.status} (must be non-zero); ${negSummary}`)
  rmSync(broken.sandbox, { recursive: true, force: true })
  return { extracted: true }
}

// ── run ───────────────────────────────────────────────────────────────────────
process.stdout.write(`t12 independent docs verifier\nrepo ${REPO}\n\n`)
const HASHED = [...DOCS, "docs/extension-adaptation-report.md", "docs/extension-adaptation-report.zh-CN.md", "packages/mpd-ext-plugin/src/index.ts", "packages/mpd-roles-plugin/src/index.ts", "packages/mpd-ext-plugin/src/mcp-client.ts", "packages/mpd-ext-plugin/src/registry.ts", "packages/mpd-ext-plugin/src/sdk.ts", "packages/mpd-ext-plugin/src/mcp.ts", "docs/extensions.md", "scripts/mpd-ext.mjs", "templates/mpd-extension/mpd-ext.json"]
const report = {
  task: "t12",
  role: "independent verifier (logic re-implemented, not the author's checker)",
  repo: REPO,
  hashes: Object.fromEntries([...new Set(HASHED)].map((doc) => [doc, sha256(join(REPO, doc))])),
  links: checkLinks(),
  citations: scanCitations(),
  semantic: semanticSamples(),
  split: structuralSplit(),
  skeleton: validateSkeleton(),
  checks: results,
}
const failed = results.filter((entry) => entry.status === "failed")
report.failed = failed.map((entry) => `${entry.id}: ${entry.detail}`)
report.passed = results.length - failed.length
report.total = results.length
writeFileSync(join(HERE, "independent-result.json"), JSON.stringify(report, null, 2) + "\n")
process.stdout.write(`\n[t12 independent] ${report.passed}/${report.total} checks passed\n`)
process.exitCode = failed.length === 0 ? 0 : 1
