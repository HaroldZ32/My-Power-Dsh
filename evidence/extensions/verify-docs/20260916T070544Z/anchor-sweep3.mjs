#!/usr/bin/env node
// t12 attempt 2: line-anchor sweep with CROSS-LINE continuation support.
// A continuation anchor may wrap to the next line (e.g. "... `:715`, `:807`,\n`:930`, `:984`)");
// those leading `:NNN` tokens are attached to the nearest preceding path ONLY when the previous
// line is adjacent (<= 1 line) — the distance guard stops a quoted historical anchor such as
// "the old 'exits 0 (`:385`)' sentence" from being attributed to an unrelated path.
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
const SUBJECTS = [
  { doc: "docs/extension-authoring-guide.md", scope: "full" },
  { doc: "docs/extension-authoring-guide.zh-CN.md", scope: "full" },
  { doc: "EXTENSIONS-FOR-AGENTS.md", scope: "full" },
  { doc: "docs/extension-adaptation-report.md", scope: "status-section" },
  { doc: "docs/extension-adaptation-report.zh-CN.md", scope: "status-section" },
]
const PATH = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
const CONTINUATION = /:(\d+)(?:[-–](\d+))?/g
const resolveCitation = (base, value) => (value.startsWith("./") || value.startsWith("../") ? resolve(base, value) : join(REPO, value))

const rows = []
for (const subject of SUBJECTS) {
  const absolute = join(REPO, subject.doc)
  const full = readFileSync(absolute, "utf8")
  let text = full
  let offset = 0
  if (subject.scope === "status-section") {
    const match = /^## 12\./m.exec(full)
    if (match === null) {
      rows.push({ doc: subject.doc, docLine: 0, token: "(no §12 status section)", status: "NO_STATUS_SECTION" })
      continue
    }
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  const base = dirname(absolute)
  let lastPath
  let lastPathLine = -10
  text.split("\n").forEach((line, index) => {
    const docLine = offset + index + 1
    const matches = [...line.matchAll(PATH)]
    const push = (path, start, end) => {
      const token = `${path}:${start}${end === start ? "" : `-${end}`}`
      const target = resolveCitation(base, path)
      const entry = { doc: subject.doc, docLine, token }
      if (!existsSync(target)) return rows.push({ ...entry, status: "MISSING_FILE" })
      if (statSync(target).isDirectory()) return rows.push({ ...entry, status: "IS_DIRECTORY" })
      const lines = readFileSync(target, "utf8").split("\n")
      if (start < 1 || end < start || end > lines.length) return rows.push({ ...entry, status: "OUT_OF_RANGE", total: lines.length })
      const slice = lines.slice(start - 1, end)
      const blank = slice.every((entryLine) => entryLine.trim() === "")
      rows.push({ ...entry, status: blank ? "BLANK_ANCHOR" : "resolves", first: slice[0].trim().slice(0, 120) })
    }
    const leadingEnd = matches.length > 0 ? matches[0].index : line.length
    for (const continuation of line.slice(0, leadingEnd).matchAll(CONTINUATION)) {
      if (lastPath !== undefined && docLine - lastPathLine <= 1) {
        push(lastPath, Number(continuation[1]), continuation[2] === undefined ? Number(continuation[1]) : Number(continuation[2]))
      } else {
        rows.push({ doc: subject.doc, docLine, token: `(orphan) :${continuation[1]}`, status: "ORPHAN_CONTINUATION" })
      }
    }
    matches.forEach((match, position) => {
      const tailStart = match.index + match[0].length
      const tailEnd = position + 1 < matches.length ? matches[position + 1].index : line.length
      if (match[2] !== undefined) push(match[1], Number(match[2]), match[3] === undefined ? Number(match[2]) : Number(match[3]))
      for (const continuation of line.slice(tailStart, tailEnd).matchAll(CONTINUATION)) {
        push(match[1], Number(continuation[1]), continuation[2] === undefined ? Number(continuation[1]) : Number(continuation[2]))
      }
      lastPath = match[1]
      lastPathLine = docLine
    })
  })
}

const flagged = rows.filter((row) => row.status !== "resolves")
writeFileSync(join(HERE, "anchor-sweep3.json"), JSON.stringify({ total: rows.length, flagged: flagged.length, rows }, null, 2) + "\n")
process.stdout.write(`anchor sweep (cross-line): ${rows.length} line-anchor citation(s) in scope, ${flagged.length} flagged\n\n`)
for (const row of flagged) process.stdout.write(`${row.status}\t${row.doc}:${row.docLine}\t${row.token}\t${row.first ?? ""}\n`)
process.stdout.write("\n--- anchors that resolve ---\n")
for (const row of rows.filter((entry) => entry.status === "resolves")) process.stdout.write(`ok\t${row.doc}:${row.docLine}\t${row.token}\t${row.first}\n`)
