#!/usr/bin/env node
// t6 (Reviewer) VENDOR_LOCK skills re-pin audit.
// (a) recompute the skills treeSha with verify-vendor.mjs's OWN algorithm, read
//     verbatim from scripts/verify-vendor.mjs (LF-normalized bytes, sorted
//     relpath, sha256(relpath + "\n" + fileSha + "\n") aggregated);
// (b) compare with the committed value and with the wave-2 baseline recorded in
//     evidence/wave2/t11-integration/**/result.json.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

// --- algorithm copied verbatim from scripts/verify-vendor.mjs (lines 63-83, 100-109)
function readBytes(p) {
  const buf = readFileSync(p)
  if (!buf.includes(0)) return Buffer.from(buf.toString("utf8").replace(/\r\n?/g, "\n"))
  return buf
}
function listFiles(dir) {
  if (statSync(dir).isFile()) return [dir]
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (entry === "node_modules") continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

const lock = JSON.parse(readFileSync(join(repoRoot, "VENDOR_LOCK.json"), "utf8"))
const meta = lock.assets.skills
const dir = join(repoRoot, "skills")
const files = listFiles(dir)
const rel = files.map((f) => f.slice(dir.length + 1)).sort()
const h = createHash("sha256")
for (const f of rel) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n")
const recomputed = h.digest("hex")

check("skills fileCount in VENDOR_LOCK equals the script's own enumeration",
  files.length === meta.fileCount, `enumerated=${files.length} locked=${meta.fileCount}`)
check("skills treeSha recomputed with verify-vendor's own algorithm matches the committed value",
  recomputed === meta.treeSha, `recomputed=${recomputed} committed=${meta.treeSha}`)

// wave-2 baseline, as recorded by the wave-2 integration task
const w2 = JSON.parse(readFileSync(join(repoRoot, "evidence/wave2/t11-integration/20260911T072333Z/result.json"), "utf8"))
const w2Text = JSON.stringify(w2)
// wave-2's own re-pin pair (54155e41 -> 5b13e920) — 5b13e920 is the state wave 3 started from
const wave2Pair = /skills 366 files, treeSha ([0-9a-f]+) -> ([0-9a-f]+)/.exec(w2Text)
const wave2Final = wave2Pair ? wave2Pair[2] : null
// wave-3's recorded pair (t3 result.json)
const t3 = JSON.parse(readFileSync(join(repoRoot, "evidence/wave3/qa-harness-fidelity/result.json"), "utf8"))
const t3Pair = t3?.fixes?.A6_vendor_lock_repin?.treeSha
check("wave-2 baseline recorded the same skill COUNT (366) — this wave changed contents, not file count",
  /366 files/.test(w2Text) && meta.fileCount === 366, `wave2Pair=${Boolean(wave2Pair)} lockedCount=${meta.fileCount}`)
check("exactly ONE skills re-pin separates the wave-2 final state from the committed lock",
  wave2Final !== null && String(t3Pair?.before ?? '').startsWith(wave2Final) && t3Pair?.after === meta.treeSha && wave2Final !== meta.treeSha,
  `wave2Final=${wave2Final} before=${t3Pair?.before} after=${t3Pair?.after} committed=${meta.treeSha}`)
check("the committed treeSha equals the recomputation (the re-pin is the algorithm's output, not hand-written)",
  recomputed === meta.treeSha && meta.treeSha === t3Pair?.after, `recomputed=${recomputed} committed=${meta.treeSha}`)

// git-level: only ONE asset entry changed vs HEAD (the wave-2+3 uncommitted delta), and it is skills
const gitDiff = (await import("node:child_process")).spawnSync("git", ["diff", "--unified=0", "--", "VENDOR_LOCK.json"], { cwd: repoRoot, encoding: "utf8" }).stdout
const changedKeys = [...gitDiff.matchAll(/^[-+]\s+"?([A-Za-z_./-]+)"?\s*:/gm)].map((m) => m[1])
check("VENDOR_LOCK diff touches only the `skills` entry inside assets",
  changedKeys.every((k) => ["assets", "skills", "fileCount", "source", "treeSha"].includes(k)), JSON.stringify(changedKeys))

const result = {
  task: "t6 vendor re-pin audit",
  stamp: new Date().toISOString(),
  enumeratedFiles: files.length,
  lockedFileCount: meta.fileCount,
  recomputedTreeSha: recomputed,
  committedTreeSha: meta.treeSha,
  wave2Final: wave2Final,
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "vendor-repin.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — vendor-repin.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
process.exit(result.allPass ? 0 : 1)
