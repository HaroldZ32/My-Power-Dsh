#!/usr/bin/env node
// Scenario table for t17's single wave re-pin. Canonical verify-vendor algorithm; nothing is written.
import { createHash } from "node:crypto"
import { readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const dir = "skills"
const readBytes = (p) => { const b = readFileSync(p); return b.includes(0) ? b : Buffer.from(b.toString("utf8").replace(/\r\n?/g, "\n")) }
const listFiles = (d) => { const out = []; const walk = (x) => { for (const e of readdirSync(x)) { const p = join(x, e); if (e === "node_modules") continue; statSync(p).isDirectory() ? walk(p) : out.push(p) } }; walk(d); return out }
const fp = (override) => {
  const files = listFiles(dir).map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  for (const f of files) {
    const bytes = override && override[f] !== undefined ? override[f] : readBytes(join(dir, f))
    h.update(f + "\n" + createHash("sha256").update(bytes).digest("hex") + "\n")
  }
  return { fileCount: files.length, treeSha: h.digest("hex") }
}
const modified = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "skills/"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
const head = Object.fromEntries(modified.map((rel) => [rel.slice(dir.length + 1), execFileSync("git", ["show", "HEAD:" + rel])]))
const lock = JSON.parse(readFileSync("VENDOR_LOCK.json", "utf8")).assets.skills
const mine = ["ast-grep/scripts/ast_grep_helper.py", "ast-grep/tests/smoke.sh"]
const rows = [
  ["A current tree (this task's edits + all sibling skills edits)", fp(undefined)],
  ["B this task's two files reverted to HEAD (sibling edits only)", fp(Object.fromEntries(mine.map((k) => [k, head[k]])))],
  ["C control: every modified skills file reverted to HEAD", fp(head)],
]
console.log("modified skills files:", JSON.stringify(modified))
for (const [label, v] of rows) console.log(`${label}: ${v.fileCount} / ${v.treeSha}`)
console.log(`lock now: ${lock.fileCount} / ${lock.treeSha}`)
console.log("CONTROL C == lock:", rows[2][1].treeSha === lock.treeSha && rows[2][1].fileCount === lock.fileCount)
