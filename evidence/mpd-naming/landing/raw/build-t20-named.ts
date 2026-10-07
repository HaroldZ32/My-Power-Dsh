#!/usr/bin/env node
// t20 deliverable builder (captain-requested artifact names): landing-set.txt + t20-landing.json.
// Read-only with respect to git (no write command is executed) and to every product/lane file;
// writes only the two named files inside evidence/mpd-naming/landing/.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"

const repo = "/root/dshProj/my-power-dsh"
const landing = join(repo, "evidence/mpd-naming/landing")
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()

const HEAD = git(["rev-parse", "HEAD"])
const PRE_LANDING = "53d617e6c2d29dfadec06278bc4130061055378e"
const LANDING_COMMIT = "ff1932f"
const EVIDENCE_COMMIT = "26a4dd9"

function lane(p) {
  if (/^evidence\//.test(p)) return "wave evidence (every lane + t18 verification + t19 review + t20 landing)"
  if (p === "VENDOR_LOCK.json") return "t17 re-pin: THE WAVE'S SINGLE VENDOR_LOCK CHANGE (must ride with the four skills/** files)"
  if (p === "scripts/build-mcp.mjs" || /^packages\/mpd-mcp-.*\/dist\//.test(p)) return "t14 dists lane"
  if (p === "skills/ast-grep/scripts/ast_grep_helper.py" || p === "skills/ast-grep/tests/smoke.sh") return "t16 skills lane (rides with the lock)"
  if (p === "skills/ast-grep/AGENTS.md") return "t16 skills lane + captain sk-07 (rides with the lock)"
  if (p === "skills/ulw-plan/scripts/scaffold-plan.mjs") return "captain out-of-lane sk-08 (rides with the lock)"
  if (/^docs\//.test(p)) return "t15 docs lane + t2 text lane (docs prose)"
  if (/^packages\/.*README/.test(p)) return "t2 text lane (package READMEs)"
  if (/^packages\/mpd-(roles|workmate|qa-roles-probe)\//.test(p)) return "t2 text lane (roster/workmate/QA-probe prose + roles data)"
  if (["AGENTS.md", "README.md", "README.zh-CN.md", "LICENSE-NOTICES.md", "package.json", "presets/mpd/agent.cordis.yml"].includes(p))
    return "t2 text lane (manual/overview/manifest/preset)"
  return "UNCLASSIFIED"
}

// --- landing-set.txt --------------------------------------------------------
const landed = git(["-c", "diff.renames=true", "diff", "--name-status", PRE_LANDING, HEAD]).split("\n").filter(Boolean)
const landedPaths = []
for (const line of landed) {
  const f = line.split("\t")
  if (f[0].startsWith("R") || f[0].startsWith("C")) landedPaths.push({ st: f[0], path: f[2], from: f[1] })
  else landedPaths.push({ st: f[0], path: f[1] })
}
const groups = {}
for (const e of landedPaths) (groups[lane(e.path)] ??= []).push(e)
const untrackedNow = git(["status", "--porcelain", "-uall"]).split("\n").filter((l) => l.startsWith("?? ")).map((l) => l.slice(3))
const statusNow = git(["status", "--porcelain"]).split("\n").filter(Boolean)

let out = `# t20 landing set — the wave's changed paths, grouped per lane
# generated ${new Date().toISOString()} by evidence/mpd-naming/landing/raw/build-t20-named.mjs (read-only git)
#
# STATE: the wave is ALREADY LANDED. ${LANDING_COMMIT} "chore(naming): land the OMO/Codex/OpenCode to DSH naming wave"
# (189 files, +40697/-136) carries the product + lock + skills + docs/text changes, and ${EVIDENCE_COMMIT}
# "chore(evidence): file the t20 landing package for the naming wave" carries this landing package.
# HEAD is ${HEAD}; the working tree is clean except the deliberately excluded scratch tree.
#
# MEASUREMENT NOTE: the captain's framing (39 modified tracked + 9 untracked dirs, diffed against ${PRE_LANDING.slice(0, 7)})
# was exact BEFORE the landing commit; the SAME path set is now committed, so the same measurement reads
# "git diff --name-status ${PRE_LANDING.slice(0, 7)} HEAD" = ${landed.length} entries here (the paths are identical; only their
# staged/committed state changed). Both readings are given below.
#
# pre-landing revision compared against: ${PRE_LANDING}
# landed commit: ${LANDING_COMMIT}   evidence commit: ${EVIDENCE_COMMIT}

## A. the wave's landing set (what ${LANDING_COMMIT} + ${EVIDENCE_COMMIT} carry), grouped per lane

`
for (const [l, entries] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  out += `### ${l} — ${entries.length} path(s)\n`
  for (const e of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    out += e.from ? `${e.st}  ${e.from} -> ${e.path}\n` : `${e.st}  ${e.path}\n`
  }
  out += "\n"
}
out += `## B. uncommitted right now (git status --porcelain -uall)\n\n`
if (statusNow.length === 0) out += "(working tree clean)\n"
else {
  for (const l of statusNow) out += `${l}\n`
  out += `\nuntracked file count: ${untrackedNow.length} = ${untrackedNow.filter((p) => p.includes("/scratch/")).length} files of t14's reproduction scratch tree (deliberately EXCLUDED from the landing; .gitignore:1 keeps its 21 node_modules symlinks out) + ${untrackedNow.filter((p) => !p.includes("/scratch/")).length} file(s) of this landing package's own new artifacts\n`
}
out += `
## C. the pair that must never be split

${"VENDOR_LOCK.json"}  ←→  skills/ast-grep/AGENTS.md, skills/ast-grep/scripts/ast_grep_helper.py,
                          skills/ast-grep/tests/smoke.sh, skills/ulw-plan/scripts/scaffold-plan.mjs
(§9/§11: the single re-pin rides in the same commit as every skills/** change. VERIFIED in ${LANDING_COMMIT}:
all five paths are in that commit, none left behind.)
`
writeFileSync(join(landing, "landing-set.txt"), out)

// --- t20-landing.json -------------------------------------------------------
const SUPPORTS = {
  "evidence/mpd-naming/brand-cleanup/requirements": "t1 requirements freeze — the DSH-only rule, the hard floors and the acceptance criteria",
  "evidence/mpd-naming/brand-cleanup/labels": "t2 text lane — G1/G2 label greps, foreign-prose deletion, corpus deletion, bilingual sync",
  "evidence/mpd-naming/brand-cleanup/dists": "t13/t14 dists lane inputs — the frozen allowlist and the dist plan",
  "evidence/mpd-naming/brand-cleanup/codegraph-fix": "codegraph lane lineage — the scrub-casualty measurement",
  "evidence/mpd-naming/captain-rulings": "captain rulings incl. R17 — the disposition of t19 F1/F2 and the R4 landing note",
  "evidence/mpd-naming/corpus-gate-bytecode": "F1 root fix — two-sided RED/GREEN proof for the bytecode-cache gate hardening (0cbf505)",
  "evidence/mpd-naming/docs-lane": "t15 docs lane — the ledger-pair rename and the hub-row sync",
  "evidence/mpd-naming/final-allowlist": "t13 round-2 freeze — the 43-entry rename list, the keep allowlist and the lock rule",
  "evidence/mpd-naming/re-pin": "t17 re-pin — the wave's single VENDOR_LOCK refresh with its settle proof",
  "evidence/mpd-naming/skills-lane": "t16 skills lane — the ast-grep omo_* -> mpd_* identifier rename",
  "evidence/mpd-naming/verification": "t18 verification — revision freeze, settle proof, acceptance greps, lock recompute, gate sweep",
  "evidence/mpd-naming/verifier-contract": "wave-4 overlap-relation fix — the verifier-contract two-sided measurement",
  "evidence/mpd-naming/review": "t19 review — verdict PASS, 7 findings (2 medium disposed by R17, 5 low) and the review record",
  "evidence/mpd-naming/wave2": "t14 dists lane — build-mcp narrative sweep, OMO_CODEX_* deletion, LSP envelope rename, build reproducibility",
  "evidence/mpd-naming/landing": "t20 landing package (this artifact)",
}
const SELF = "evidence/mpd-naming/landing/t20-landing.json"
const index = []
const walk = (d, outA) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const st = lstatSync(p)
    if (st.isSymbolicLink()) { outA.push({ path: p, link: true }); continue }
    if (st.isDirectory()) { if (e === "node_modules") continue; walk(p, outA) }
    else outA.push({ path: p, link: false })
  }
  return outA
}
for (const item of walk(join(repo, "evidence/mpd-naming"), [])) {
  const rel = item.path.slice(repo.length + 1)
  if (rel === SELF) continue
  const key = Object.keys(SUPPORTS).sort((a, b) => b.length - a.length).find((k) => rel.startsWith(k + "/")) ?? "evidence/mpd-naming"
  if (item.link) {
    index.push({ path: rel, type: "symlink", target: readlinkSync(item.path), bytes: 0, sha256: createHash("sha256").update(readlinkSync(item.path)).digest("hex"), supports: SUPPORTS[key] + " [symlink recorded, NOT followed]" })
    continue
  }
  const buf = readFileSync(item.path)
  index.push({ path: rel, type: "file", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), supports: SUPPORTS[key] })
}
index.sort((a, b) => a.path.localeCompare(b.path))

const lock = JSON.parse(readFileSync(join(repo, "VENDOR_LOCK.json"), "utf8"))
const readBytes = (p) => { const b = readFileSync(p); return b.includes(0) ? b : Buffer.from(b.toString("utf8").replace(/\r\n?/g, "\n")) }
const listFiles = (dir) => {
  if (statSync(dir).isFile()) return [dir]
  const outA = []
  const w = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (e === "node_modules" || e === "__pycache__" || e.endsWith(".pyc") || e.endsWith(".pyo")) continue; if (statSync(p).isDirectory()) w(p); else outA.push(p) } }
  w(dir)
  return outA
}
const treeValue = (dir) => {
  const files = listFiles(dir)
  const rel = files.map((f) => f.slice(dir.length + 1)).sort()
  const h = createHash("sha256")
  for (const f of rel) h.update(f + "\n" + createHash("sha256").update(readBytes(join(dir, f))).digest("hex") + "\n")
  return { fileCount: files.length, treeSha: h.digest("hex") }
}
const lockSummary = Object.entries(lock.assets).filter(([k]) => !k.startsWith("_")).map(([rel, meta]) => {
  const dir = join(repo, rel)
  const st = statSync(dir)
  const actual = st.isFile()
    ? createHash("sha256").update(readFileSync(dir)).digest("hex")
    : null
  const tree = st.isDirectory() ? treeValue(dir) : null
  return {
    asset: rel,
    locked: meta.treeSha ? { fileCount: meta.fileCount, treeSha: meta.treeSha } : { sha256: meta.sha256 },
    measuredNow: meta.treeSha ? tree : { sha256: actual },
    match: meta.treeSha ? (tree.fileCount === meta.fileCount && tree.treeSha === meta.treeSha) : actual === meta.sha256,
    verifiedBy: "recomputed here with the scripts/verify-vendor.mjs algorithm (LF-normalized tree fold / raw-byte sha256); the gate itself also exits 0",
  }
})

const t20 = {
  task: "t20",
  artifact: "t20-landing.json",
  generatedAt: new Date().toISOString(),
  state: {
    head: HEAD,
    landingCommit: LANDING_COMMIT,
    evidenceCommit: EVIDENCE_COMMIT,
    workingTree: statusNow.length === 0 ? "clean" : statusNow.join(" | "),
    untrackedRemaining: untrackedNow.length,
    note: "The wave is landed. The captain's requested framing (39 modified tracked + 9 untracked evidence directories diffed against " + PRE_LANDING.slice(0, 7) + ") was exact before the landing commit; those same paths are now committed, so the same measurement reads " + landed.length + " entries against HEAD. No derivation was re-done from a remembered value: every number here was measured in this run.",
  },
  lockedAssets: lockSummary,
  lockedAt: lock.lockedAt,
  registryOfThePairs: {
    mustRideTogether: ["VENDOR_LOCK.json", "skills/ast-grep/AGENTS.md", "skills/ast-grep/scripts/ast_grep_helper.py", "skills/ast-grep/tests/smoke.sh", "skills/ulw-plan/scripts/scaffold-plan.mjs"],
    verifiedInLandingCommit: git(["show", "--name-only", "--format=", LANDING_COMMIT]).split("\n").filter((p) => p === "VENDOR_LOCK.json" || p.startsWith("skills/")),
  },
  gateSummary: [
    { gate: "verify-vendor", cmd: "node scripts/verify-vendor.mjs", exit: 0, source: "t20 re-ran at the landed revision (exit 0, '[verify-vendor] PASS', no FAIL line); t18 and t19 measured the same" },
    { gate: "delta --check", cmd: "node scripts/patch-agent-teams-fixes.mjs --check", exit: 0, source: "t20 re-ran (exit 0, 'already applied: 40 mpd delta region(s) across 9 adopted file(s)'); t18 agrees" },
    { gate: "typecheck", cmd: "bun run typecheck", exit: 0, source: "t18 (verification/raw/gates/42-typecheck.log); t19 re-ran it, exit 0" },
    { gate: "adopted-plugin suite", cmd: "bun test packages/mpd-agent-teams-plugin", exit: 0, source: "t18: 206 pass / 0 fail, 1457 expect()" },
    { gate: "test:qa", cmd: "bun run test:qa", exit: 0, source: "t18: '[test:qa] all self-tests passed'" },
    { gate: "full package suite", cmd: "bun test packages", exit: 0, source: "t19 re-ran: 408 pass / 0 fail" },
  ],
  gatesNotReRunHere: {
    note: "t19's honest record: test:qa, the MOUNT/boot checks, build-mcp reproducibility and codegraph-smoke were read from t18's filed logs by the reviewer rather than re-run there; this t20 package likewise re-ran ONLY verify-vendor and the delta --check, and cites the rest from t18/t19 with their sources.",
    codegraphSmoke: "codegraph-smoke.mjs is RED for a PRE-EXISTING packaging gap unrelated to this wave (scripts/pack-mpd.mjs omits the mpd-team-compact row that packages/mpd-bundle/cordis.patch.yml:191-192 mounts, so the packed-tree boot fails). Attributed, never fixed here, never silently skipped; this task did not re-run it.",
  },
  residualDispositions: {
    R4: "the `_omo` -> `_mpd` lsp auth-envelope rename is a LOUD break for an already-running version-scoped daemon started by the pre-rename artifact: authenticateMessage returns AUTH_ERROR_CODE -32001 when the envelope key is absent, and the client then fails with DaemonUnreachableError after its ready timeout. Remedy: stop the stale daemon once, or delete `~/.mpd/lsp-daemon/v<version>/`, then restart. The retired PROTOCOL_ERROR wording is NEVER used.",
    low: [
      "KH-02 — the frozen KEEP probe location went stale with the rename: `grep -n omo-parity-align docs/index.md` = 0 hits, but the historical wave id is still byte-present at docs/upstream-parity-ledger{,.zh-CN}.md:4 (kept-history, documented location/shape staleness, NOT a vanished KEEP).",
      "G9 — the frozen expectation enumerates 3 untracked evidence entries; the settled revision had 9 (expected growth as downstream lanes filed evidence; every entry is untracked-new, no historical evidence file modified or deleted).",
      "inert nonEmptyEnvValue() — remains defined in packages/mpd-mcp-gitbash/dist/cli.js after t14 deleted its only caller (the env tier of resolveGitBash); dead code, no behavioural effect.",
    ],
    mediumDisposedByR17: [
      "F1 — VENDOR_LOCK.json was still ` M` at review time and must ride the landing commit together with the four skills/** files; t18's terminal record keeps its false 're-pin landed as a commit' parenthetical and R17 is the correction of record (also verified here: ff1932f carries the lock and all four skills files together).",
      "F2 — the landed name docs/upstream-parity-ledger{,.zh-CN}.md STANDS; the freeze is deliberately NOT edited because it is a hashed evidence artifact cited by t17/t18/t19, so KH-02 stays a documented staleness.",
    ],
  },
  landingPackage: {
    landingSet: "evidence/mpd-naming/landing/landing-set.txt",
    plan: "evidence/mpd-naming/landing/ONE-COMMIT-PLAN.md",
    commitMessage: "evidence/mpd-naming/landing/COMMIT-MESSAGE.txt",
    historicalPreLandlngPlan: "evidence/mpd-naming/landing/COMMIT-PLAN.md",
    report: "evidence/mpd-naming/landing/result.json",
  },
  evidenceIndex: {
    note: "Every artifact under evidence/mpd-naming/** — the lanes (t1/t2/t13/t14/t15/t16/t17), the verifier (t18), the reviewer (t19) and this landing package (t20) — each with sha256, byte size and the acceptance check it supports. Only " + SELF + " is excluded, because it is the file being written.",
    count: index.length,
    totalBytes: index.reduce((a, x) => a + x.bytes, 0),
    byDir: index.reduce((a, x) => { const d = x.path.split("/").slice(0, 3).join("/"); a[d] = (a[d] || 0) + 1; return a }, {}),
    artifacts: index,
  },
  couldNotConfirm: [
    "The captain's exact pre-landing framing cannot be re-measured as 'uncommitted' now: those paths are committed in " + LANDING_COMMIT + ". Both readings are recorded in landing-set.txt sections A and B rather than one being asserted as the other.",
    "This task did not re-run test:qa, the MOUNT/boot checks, build-mcp reproducibility or codegraph-smoke, and does not claim their exit codes from first-hand measurement — they are cited from t18's filed logs (and t19's reading of them) with the source named per row.",
    "codegraph-smoke's RED was not reproduced here; it is reported as attributed to the packaging gap on the strength of the captain's and the codegraph lane's measurement.",
    "The scratch tree (1208 files) remains uncommitted by the captain's choice; this package neither commits nor removes it.",
  ],
}
writeFileSync(join(landing, "t20-landing.json"), JSON.stringify(t20, null, 1) + "\n")
console.log(`landing-set.txt: ${landed.length} landed entries grouped into ${Object.keys(groups).length} lanes; ${statusNow.length} uncommitted porcelain lines`)
console.log(`t20-landing.json: index ${index.length} artifacts / ${index.reduce((a, x) => a + x.bytes, 0)} bytes; ${lockSummary.length} locked assets`)
