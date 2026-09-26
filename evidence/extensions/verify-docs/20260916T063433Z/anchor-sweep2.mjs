#!/usr/bin/env node
// Dump every path:line citation from the t9 documents together with the line it resolves to.
// Resolution follows the documents' own convention: a bare repo path is repo-relative, a `./`
// or `../` path is document-relative. Shorthand continuation anchors (`:793`, `:916`) inherit
// the preceding path on the same line. Flags: MISSING_FILE, OUT_OF_RANGE, BLANK_ANCHOR.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
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
  throw new Error("repo not found")
}
const REPO = findRepo(HERE)
// scope: the guides and the agent contract in full; the two reports only in their §12 status section
const SUBJECTS = [
  { doc: "docs/extension-authoring-guide.md", scope: "full" },
  { doc: "docs/extension-authoring-guide.zh-CN.md", scope: "full" },
  { doc: "EXTENSIONS-FOR-AGENTS.md", scope: "full" },
  { doc: "docs/extension-adaptation-report.md", scope: "status-section" },
  { doc: "docs/extension-adaptation-report.zh-CN.md", scope: "status-section" },
]
const PATH = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
const CONTINUATION = /:(\d+)(?:[-–](\d+))?/g

function resolveCitation(base, value) {
  return value.startsWith("./") || value.startsWith("../") ? resolve(base, value) : join(REPO, value)
}

const rows = []
for (const subject of SUBJECTS) {
  const absolute = join(REPO, subject.doc)
  const full = readFileSync(absolute, "utf8")
  let text = full
  let offset = 0
  if (subject.scope === "status-section") {
    const match = /^## 12\./m.exec(full)
    if (match === null) {
      rows.push({ doc: subject.doc, docLine: 0, token: "(no §12 status section found)", status: "NO_STATUS_SECTION" })
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
      const anchors = []
      if (match[2] !== undefined) anchors.push({ start: Number(match[2]), end: match[3] === undefined ? Number(match[2]) : Number(match[3]) })
      for (const continuation of line.slice(tailStart, tailEnd).matchAll(CONTINUATION)) {
        anchors.push({ start: Number(continuation[1]), end: continuation[2] === undefined ? Number(continuation[1]) : Number(continuation[2]) })
      }
      const target = resolveCitation(base, match[1])
      for (const anchor of anchors) {
        const entry = {
          doc: subject.doc,
          docLine,
          token: `${match[1]}:${anchor.start}${anchor.end === anchor.start ? "" : `-${anchor.end}`}`,
        }
        if (!existsSync(target)) {
          entry.status = "MISSING_FILE"
          rows.push(entry)
          continue
        }
        if (statSync(target).isDirectory()) {
          entry.status = "IS_DIRECTORY"
          rows.push(entry)
          continue
        }
        const lines = readFileSync(target, "utf8").split("\n")
        if (anchor.start < 1 || anchor.end < anchor.start || anchor.end > lines.length) {
          entry.status = "OUT_OF_RANGE"
          entry.total = lines.length
          rows.push(entry)
          continue
        }
        const slice = lines.slice(anchor.start - 1, anchor.end)
        entry.status = slice.every((entryLine) => entryLine.trim() === "") ? "BLANK_ANCHOR" : "resolves"
        entry.first = slice[0].slice(0, 120)
        rows.push(entry)
      }
    })
  })
}

const flagged = rows.filter((row) => row.status !== "resolves")
writeFileSync(join(HERE, "anchor-sweep.json"), JSON.stringify({ total: rows.length, flagged: flagged.length, rows }, null, 2) + "\n")
process.stdout.write(`anchor sweep: ${rows.length} line-anchor citation(s) in scope, ${flagged.length} flagged\n\n`)
for (const row of flagged) process.stdout.write(`${row.status}\t${row.doc}:${row.docLine}\t${row.token}\t${row.first ?? ""}\n`)
process.stdout.write("\n--- in-scope anchors that resolve ---\n")
for (const row of rows.filter((entry) => entry.status === "resolves")) process.stdout.write(`ok\t${row.doc}:${row.docLine}\t${row.token}\t${row.first}\n`)
