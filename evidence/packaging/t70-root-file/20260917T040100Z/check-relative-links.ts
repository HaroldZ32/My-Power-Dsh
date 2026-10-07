#!/usr/bin/env node
// t70 checker: do the RELATIVE markdown links inside a tree resolve INSIDE that tree?
//
// The defect this measures: six shipped files carry ten relative links to the extension author's
// machine contract (README.md 2, README.zh-CN.md 2, docs/index.md 1, docs/index.zh-CN.md 1,
// docs/extension-authoring-guide.md 2, docs/extension-authoring-guide.zh-CN.md 2). Every one of
// them resolves in the checkout, and every one broke in the artifact — a relative link is a claim
// about the tree it travels in.
//
// usage: node check-relative-links.mjs --root <tree> [--target EXTENSIONS-FOR-AGENTS.md] [--json]
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const arg = (k, dflt) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : dflt }
const root = resolve(arg("--root", "."))
const target = arg("--target", "EXTENSIONS-FOR-AGENTS.md")
// Process records and build outputs are not part of the shipped link surface; skipping them keeps
// the scan on the tree a reader actually receives (and the artifact has none of them anyway).
const SKIP = new Set((arg("--skip", "node_modules,.git,evidence,.mpd,dist,tests,.codegraph") ).split(","))
const asJson = process.argv.includes("--json")

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith(".md")) out.push(full)
  }
  return out
}

const LINK_RE = /\]\(([^)\s]+)\)/g
const rows = []
for (const file of walk(root)) {
  const body = readFileSync(file, "utf8")
  for (const match of body.matchAll(LINK_RE)) {
    const href = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue
    const cleaned = href.split("#")[0]
    if (cleaned === "") continue
    const abs = resolve(dirname(file), cleaned)
    const inside = !relative(root, abs).startsWith("..")
    const exists = inside && statSync(abs, { throwIfNoEntry: false })?.isFile() === true
    rows.push({ file: relative(root, file), href, resolvesInside: inside, exists, target: cleaned.endsWith(target) || abs.endsWith("/" + target) })
  }
}

const toTarget = rows.filter((r) => r.target)
const broken = rows.filter((r) => !r.exists)
const brokenToTarget = toTarget.filter((r) => !r.exists)

if (asJson) {
  console.log(JSON.stringify({ root, target, markdownFiles: walk(root).length, relativeLinks: rows.length, targetInstances: toTarget.length, targetResolving: toTarget.length - brokenToTarget.length, brokenTotal: broken.length, brokenToTarget, toTarget }, null, 2))
} else {
  console.log("[check-relative-links] root=" + root)
  console.log("[check-relative-links] markdown files scanned: " + walk(root).length + "; relative links seen: " + rows.length)
  console.log("[check-relative-links] links to " + target + ": " + toTarget.length + " (resolving: " + (toTarget.length - brokenToTarget.length) + ", broken: " + brokenToTarget.length + ")")
  for (const r of toTarget) console.log("  " + (r.exists ? "OK     " : "BROKEN ") + r.file + " -> " + r.href)
  console.log("[check-relative-links] broken relative links of ANY target in this tree: " + broken.length)
  for (const r of broken.slice(0, 12)) console.log("  broken: " + r.file + " -> " + r.href)
}
process.exit(brokenToTarget.length === 0 ? 0 : 1)
