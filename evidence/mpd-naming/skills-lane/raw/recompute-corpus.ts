#!/usr/bin/env node
// Recompute the skills corpus fingerprint with verify-vendor's canonical algorithm, WITHOUT writing VENDOR_LOCK.json.
// Canonical algorithm (scripts/verify-vendor.mjs:106-114): relative paths sorted; per file sha256(readBytes(f))
// where readBytes LF-normalizes text (no NUL) and hashes binary raw; then h.update(relpath + "\n" + digest + "\n").
// Control: the same walk with the PRE-EDIT blob substituted for the one edited file must reproduce the lock's
// current value — that proves replication fidelity AND that this task's edit is the sole delta.
import { createHash } from "node:crypto"
import { readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const repoRoot = process.cwd()
const dir = join(repoRoot, "skills")
const EDITED = "ast-grep/scripts/ast_grep_helper.py"

function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}

function listFiles(d) {
  const out = []
  const walk = (x) => {
    for (const entry of readdirSync(x)) {
      const p = join(x, entry)
      if (entry === "node_modules") continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(d)
  return out
}

function fingerprint(override) {
  const files = listFiles(dir).map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  for (const f of files) {
    const bytes = override && override[f] !== undefined ? override[f] : readBytes(join(dir, f))
    const fh = createHash("sha256").update(bytes).digest("hex")
    h.update(f + "\n" + fh + "\n")
  }
  return { fileCount: files.length, treeSha: h.digest("hex") }
}

const preEditBlob = execFileSync("git", ["show", `HEAD:skills/${EDITED}`], { cwd: repoRoot })
const preEdit = fingerprint({ [EDITED]: preEditBlob })
const postEdit = fingerprint(undefined)

const lock = JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8")).assets.skills
const out = {
  algorithm: "verify-vendor canonical (sorted relpath; per-file sha256 of LF-normalized bytes; relpath\\ndigest\\n)",
  edited_file: `skills/${EDITED}`,
  lock_before_this_task: { fileCount: lock.fileCount, treeSha: lock.treeSha },
  reconstructed_pre_edit: { fileCount: preEdit.fileCount, treeSha: preEdit.treeSha },
  control_matches_lock: preEdit.treeSha === lock.treeSha && preEdit.fileCount === lock.fileCount,
  post_edit_target_for_t17: { fileCount: postEdit.fileCount, treeSha: postEdit.treeSha },
  note: "Computed only — VENDOR_LOCK.json was NOT written by this task (out of scope; t17 owns the single wave re-pin).",
}
console.log(JSON.stringify(out, null, 2))
