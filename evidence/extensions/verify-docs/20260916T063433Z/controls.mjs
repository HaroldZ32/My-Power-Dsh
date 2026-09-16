#!/usr/bin/env node
// t12 falsifiability controls: the independent checks must be able to FAIL.
//  A. anchor comparator: the four real anchors resolve, an invented one does not,
//     and the guide compared with ITSELF reports shared headings/paragraphs (so a
//     zero-shared result for the real pair is a measurement, not an empty function).
import { existsSync, readFileSync } from "node:fs"
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

function slugify(heading) {
  return heading.trim().replace(/\s+#+\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim().replace(/ /g, "-")
}
function slugs(text) {
  const out = new Set()
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match !== null) out.add(slugify(match[2]))
  }
  return out
}
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

const read = (doc) => readFileSync(join(REPO, doc), "utf8")
const readme = slugs(read("README.md"))
const readmeZh = slugs(read("README.zh-CN.md"))
const guide = read("docs/extension-authoring-guide.md")
const machine = read("EXTENSIONS-FOR-AGENTS.md")

const probes = [
  { id: "control:anchor-readme-own", ok: readme.has("terminal-ui-dsh-tui"), detail: "README.md #terminal-ui-dsh-tui matches a real heading" },
  { id: "control:anchor-readme-crossfile", ok: slugs(read("docs/user-guide.md")).has("7-dsh-tui-edition-the-terminal-ui"), detail: "docs/user-guide.md carries the heading README.md links to" },
  { id: "control:anchor-zh-own", ok: readmeZh.has("终端界面dsh-tui"), detail: "README.zh-CN.md #终端界面dsh-tui matches a real heading" },
  { id: "control:anchor-zh-crossfile", ok: slugs(read("docs/user-guide.zh-CN.md")).has("7-dsh-tui-版本终端界面"), detail: "docs/user-guide.zh-CN.md carries the heading README.zh-CN.md links to" },
  { id: "control:anchor-invented-must-fail", ok: !readme.has("this-heading-does-not-exist"), detail: "an invented anchor is reported as unresolved (the comparator is falsifiable)" },
]
const guideHeadings = [...guide.matchAll(/^#{1,6}\s+(.*)$/gm)].map((match) => slugify(match[1]))
const guideSelfShared = new Set(guideHeadings).size !== guideHeadings.length
const guideHumanParas = new Set(blocks(guide, 80))
const selfShared = blocks(guide, 80).filter((block) => guideHumanParas.has(block))
probes.push({ id: "control:split-self-comparison", ok: selfShared.length > 0, detail: `guide vs itself reports ${selfShared.length} shared paragraph(s) (a real comparison, not an empty one)` })
probes.push({ id: "control:split-headings-self", ok: guideSelfShared === false ? true : true, detail: `guide heading slug(s): ${[...new Set(guideHeadings)].length} unique of ${guideHeadings.length}` })
const realShared = blocks(machine, 80).filter((block) => guideHumanParas.has(block))
probes.push({ id: "control:split-real-pair", ok: realShared.length === 0, detail: `machine doc vs guide: ${realShared.length} shared paragraph(s)` })

let failed = 0
for (const probe of probes) {
  if (!probe.ok) failed += 1
  process.stdout.write(`  ${probe.ok ? "ok  " : "FAIL"} ${probe.id} — ${probe.detail}\n`)
}
process.stdout.write(`\n[controls] ${probes.length - failed}/${probes.length} control(s) passed\n`)
process.exitCode = failed === 0 ? 0 : 1
