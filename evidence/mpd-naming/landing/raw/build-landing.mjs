#!/usr/bin/env node
// t20 landing-package builder (read-only w.r.t. product files; writes only under evidence/mpd-naming/landing/).
// Derives: lane assignment for the wave's changed paths, the landing path list, the evidence index with
// sha256 per artifact, and the already-landed path set. No git write command is used anywhere.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const repo = "/root/dshProj/my-power-dsh"
const landing = join(repo, "evidence/mpd-naming/landing")
const raw = join(landing, "raw")
mkdirSync(raw, { recursive: true })

const PRE_WAVE = "3c1a850"

function lane(p) {
  if (p === "VENDOR_LOCK.json") return "t17 re-pin: the wave's SINGLE VENDOR_LOCK change"
  if (p === "scripts/build-mcp.mjs" || /^packages\/mpd-mcp-.*\/dist\//.test(p)) return "t14 dists lane"
  if (p === "skills/ast-grep/scripts/ast_grep_helper.py" || p === "skills/ast-grep/tests/smoke.sh") return "t16 skills lane"
  if (p === "skills/ast-grep/AGENTS.md") return "t16 skills lane + captain sk-07 (same file, two writers)"
  if (p === "skills/ulw-plan/scripts/scaffold-plan.mjs") return "captain out-of-lane sk-08"
  if (/^docs\/(index|upstream-parity-ledger)/.test(p)) return "t15 docs lane"
  if (/^docs\//.test(p)) return "t2 text lane (bilingual docs prose)"
  if (/^evidence\//.test(p)) return "wave evidence (all lanes + t18/t19)"
  if (/^packages\/.*README/.test(p)) return "t2 text lane (package READMEs)"
  if (/^packages\/mpd-(roles|workmate|qa-roles-probe)\//.test(p)) return "t2 text lane (roster/workmate/QA-probe prose + roles data)"
  if (["AGENTS.md", "README.md", "README.zh-CN.md", "LICENSE-NOTICES.md", "package.json", "presets/mpd/agent.cordis.yml"].includes(p))
    return "t2 text lane (manual/overview/manifest/preset)"
  return "UNCLASSIFIED"
}

// --- 1. changed-path set -----------------------------------------------------
const uall = readFileSync(join(raw, "20-status-uall-final.txt"), "utf8").split("\n").filter(Boolean)
const modified = uall.filter((l) => l.startsWith(" M ")).map((l) => l.slice(3))
const untracked = uall.filter((l) => l.startsWith("?? ")).map((l) => l.slice(3))
const diffLines = execFileSync("git", ["-c", "diff.renames=true", "diff", "--name-status", PRE_WAVE], { cwd: repo, encoding: "utf8" })
  .split("\n").filter(Boolean)
const diffPaths = []
const alreadyLanded = []
for (const line of diffLines) {
  const f = line.split("\t")
  const st = f[0]
  const paths = st.startsWith("R") || st.startsWith("C") ? [f[1], f[2]] : [f[1]]
  for (const p of paths) diffPaths.push({ p, st })
}
const modifiedSet = new Set(modified)
const untrackedSet = new Set(untracked)
for (const { p, st } of diffPaths) {
  if (!modifiedSet.has(p) && !untrackedSet.has(p)) alreadyLanded.push({ path: p, status: st })
}
const byLane = {}
for (const p of modified) {
  const l = lane(p)
  ;(byLane[l] ??= []).push(p)
}
const unclassified = modified.filter((p) => lane(p) === "UNCLASSIFIED")
const landingPaths = [...modified, ...untracked].sort()
writeFileSync(join(raw, "22-lane-assignment.json"), JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  preWaveRevision: PRE_WAVE,
  modifiedTracked: modified.length,
  untrackedFiles: untracked.length,
  byLane,
  unclassified,
  alreadyLandedInWaveCommits: alreadyLanded,
  untrackedByDir: Object.entries(untracked.reduce((a, p) => { const d = p.split("/").slice(0, 3).join("/"); a[d] = (a[d] || 0) + 1; return a }, {})),
}, null, 1) + "\n")
writeFileSync(join(raw, "23-landing-path-list.txt"), landingPaths.join("\n") + "\n")

// --- 2. evidence index ------------------------------------------------------
const SUPPORTS = {
  "evidence/mpd-naming/requirements": "t1 requirements freeze — the DSH-only rule, the hard floors and the acceptance criteria",
  "evidence/mpd-naming/brand-cleanup/requirements": "t1 requirements freeze — the DSH-only rule, the hard floors and the acceptance criteria",
  "evidence/mpd-naming/brand-cleanup/labels": "t2 text lane — G1/G2 label greps, foreign-harness prose deletion, corpus deletion, bilingual sync",
  "evidence/mpd-naming/brand-cleanup/dists": "t13/t14 dists lane inputs — the frozen allowlist and the dist plan",
  "evidence/mpd-naming/brand-cleanup/codegraph-fix": "codegraph lane lineage — the scrub-casualty measurement",
  "evidence/mpd-naming/captain-rulings": "captain rulings (incl. R14) — the ruling that voids the stale 't16 was the only skills writer' premise",
  "evidence/mpd-naming/corpus-gate-bytecode": "F1 root fix — two-sided RED/GREEN proof for the bytecode-cache gate hardening (commit 0cbf505)",
  "evidence/mpd-naming/docs-lane": "t15 docs lane — the ledger-pair rename and the hub-row sync",
  "evidence/mpd-naming/final-allowlist": "t13 round-2 freeze — the 43-entry rename list, the keep allowlist and the lock rule",
  "evidence/mpd-naming/re-pin": "t17 re-pin — the wave's single VENDOR_LOCK refresh with its settle proof",
  "evidence/mpd-naming/skills-lane": "t16 skills lane — the ast-grep omo_* -> mpd_* identifier rename",
  "evidence/mpd-naming/verification": "t18 verification — revision freeze, settle proof, acceptance greps, lock recompute, gate sweep",
  "evidence/mpd-naming/verifier-contract": "wave-4 overlap-relation fix — the verifier-contract two-sided measurement",
  "evidence/mpd-naming/review": "t19 review — verdict PASS with its findings and medium actions",
  "evidence/mpd-naming/wave2": "t14 dists lane — build-mcp narrative sweep, OMO_CODEX_* deletion, LSP envelope rename, build reproducibility",
}
const index = []
const walk = (d, out) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const st = lstatSync(p)
    if (st.isSymbolicLink()) { out.push({ path: p, link: true }); continue }
    if (st.isDirectory()) { if (e === "node_modules") continue; walk(p, out) }
    else out.push({ path: p, link: false })
  }
  return out
}
const root = join(repo, "evidence/mpd-naming")
for (const item of walk(root, [])) {
  const rel = item.path.slice(repo.length + 1)
  if (rel.startsWith("evidence/mpd-naming/landing/")) continue // t20's own home: hashed in result.json instead
  const key = Object.keys(SUPPORTS).sort((a, b) => b.length - a.length).find((k) => rel.startsWith(k + "/")) ?? "evidence/mpd-naming"
  if (item.link) {
    index.push({
      path: rel,
      type: "symlink",
      target: readlinkSync(item.path),
      bytes: 0,
      sha256: createHash("sha256").update(readlinkSync(item.path)).digest("hex"),
      supports: (SUPPORTS[key] ?? "(outer evidence root)") + " [symlink recorded, NOT followed]",
    })
    continue
  }
  const buf = readFileSync(item.path)
  index.push({
    path: rel,
    type: "file",
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    supports: SUPPORTS[key] ?? "(outer evidence root)",
  })
}
index.sort((a, b) => a.path.localeCompare(b.path))
writeFileSync(join(raw, "24-evidence-index.json"), JSON.stringify({
  note: "Every artifact the lanes and the verifier filed under evidence/mpd-naming/**, each with its sha256, its byte size and the acceptance check it supports. evidence/mpd-naming/landing/** (t20's own home) is deliberately excluded so the index does not have to hash itself; the landing artifacts' own sha256 values are recorded in landing/result.json.",
  count: index.length,
  totalBytes: index.reduce((a, x) => a + x.bytes, 0),
  byDir: index.reduce((a, x) => { const d = x.path.split("/").slice(0, 3).join("/"); a[d] = (a[d] || 0) + 1; return a }, {}),
  artifacts: index,
}, null, 1) + "\n")
writeFileSync(join(raw, "25-evidence-index-summary.txt"),
  `evidence index: ${index.length} artifacts, ${index.reduce((a, x) => a + x.bytes, 0)} bytes total\n` +
  Object.entries(index.reduce((a, x) => { const d = x.path.split("/").slice(0, 3).join("/"); a[d] = (a[d] || 0) + 1; return a }, {}))
    .map(([d, n]) => `${String(n).padStart(4)}  ${d}`).join("\n") + "\n")

console.log("modifiedTracked=" + modified.length + " untracked=" + untracked.length + " alreadyLanded=" + alreadyLanded.length)
console.log("unclassified=" + (unclassified.join(",") || "none"))
console.log("index=" + index.length + " artifacts / " + index.reduce((a, x) => a + x.bytes, 0) + " bytes")
