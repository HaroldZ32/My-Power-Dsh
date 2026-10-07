#!/usr/bin/env node
// t22 review instrument: SEED the bilingual-parity failures the acceptance asks for, and keep the
// RED readings. Each seed is a minimal fixture ROOT (never the real tree) run through the lane's own
// gate with `--root`; the four roots isolate one rule each:
//
//   seedA  an EN `*.md` with NO twin under `agent-references/`   → must PASS  (the band is outside discovery, T-28)
//   seedB  the SAME file under `docs/`                           → must FAIL  (missing twin)
//   seedC  a `*.zh-CN.md` whose bytes are an English COPY        → must FAIL  (stale twin: no CJK / no switch link)
//   seedD  a `*.zh-CN.md` with no EN twin                        → must FAIL  (zh-only)
//
// Every root also carries a VALID root README pair, so the only variable is the seeded file.
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const GATE = join(REPO, "scripts", "verify-docs-parity.mjs")

const good = (title) => `# ${title}\n\n[中文](./README.zh-CN.md)\n\nBody text for the fixture.\n\n## One\n\ntext\n\n## Two\n\nend\n`
const zhGood = (title) => `# ${title}\n\n[English](./README.md)\n\n正文\n\n## 一\n\n文本\n\n## 二\n\n结束\n`

const roots = [
  {
    id: "seedA-agent-references-no-twin",
    expect: 0,
    files: { "agent-references/probe.md": "# Probe\n\nAn agent-facing EN file with no twin.\n" },
    why: "T-28: the agent-facing band is deliberately OUT of the gate's discovery — the same file under docs/ (seedB) reddens",
  },
  {
    id: "seedB-docs-missing-twin",
    expect: 1,
    files: { "docs/probe.md": "# Probe\n\nA human-facing EN doc whose zh-CN twin is MISSING.\n" },
    why: "T-29/T-30: a docs/ *.md with no *.zh-CN.md twin must FAIL the gate",
  },
  {
    id: "seedC-docs-stale-twin",
    expect: 1,
    files: {
      "docs/probe.md": "# Probe\n\n[中文](./probe.zh-CN.md)\n\nA human-facing EN doc.\n",
      "docs/probe.zh-CN.md": "# Probe\n\nA COPY of the English bytes: no CJK content and no switch link.\n",
    },
    why: "a STALE twin (English bytes, no CJK, no switch link) must FAIL the gate, not pass as a pair",
  },
  {
    id: "seedD-docs-zh-only",
    expect: 1,
    files: { "docs/probe.zh-CN.md": "# Probe\n\n[English](./probe.md)\n\n正文\n\n一份没有 EN 孪生的中文文档。\n" },
    why: "a zh-only document must FAIL (no EN twin)",
  },
  {
    id: "seedE-templates-unmarked-asset",
    expect: 0,
    files: { "templates/tpl/notes/asset.md": "# Asset\n\nan asset in a packed band, NOT marked as a doc — no twin demanded\n" },
    why: "T-29: classification is by the DECLARED marker, so an unmarked file in an asset band stays an ASSET",
  },
  {
    id: "seedF-templates-promoted-doc",
    expect: 1,
    files: { "templates/tpl/notes/misplaced.md": "<!-- docs-parity: doc -->\n# Misplaced\n\na doc that landed in an ASSET band, promoted by the marker — it reddens instead of escaping\n" },
    why: "T-29: the SAME band with the promotion marker must redden (a misplaced doc cannot escape by directory)",
  },
]

const results = []
for (const root of roots) {
  const abs = join(HERE, root.id)
  rmSync(abs, { recursive: true, force: true })
  mkdirSync(join(abs, "docs"), { recursive: true })
  writeFileSync(join(abs, "README.md"), good("Root fixture"))
  writeFileSync(join(abs, "README.zh-CN.md"), zhGood("根夹具"))
  for (const [rel, text] of Object.entries(root.files)) {
    mkdirSync(dirname(join(abs, rel)), { recursive: true })
    writeFileSync(join(abs, rel), text)
  }
  const child = spawnSync(process.execPath, [GATE, "--root", `./${join("evidence", "review", "wave2b-laneB3", HERE.split("/").at(-1), root.id)}`], { cwd: REPO, encoding: "utf8" })
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`
  const verdictLine = output.trim().split("\n").filter((line) => line.includes("verify-docs-parity]")).at(-1) ?? ""
  const failures = output.split("\n").filter((line) => /^FAIL /.test(line)).map((line) => line.trim().slice(0, 220))
  const passed = child.status === root.expect && (root.expect === 0 ? failures.length === 0 : failures.length > 0)
  writeFileSync(join(HERE, `${root.id}.stdout`), output)
  results.push({ id: root.id, expectedExit: root.expect, exit: child.status, pass: passed, why: root.why, verdictLine, failures })
  console.log(`${passed ? "ok  " : "FAIL"} ${root.id} — exit ${child.status} (expected ${root.expect}); ${failures[0] ?? "(no FAIL line)"}`)
}
writeFileSync(join(HERE, "seed-arms.json"), JSON.stringify({ gate: "scripts/verify-docs-parity.mjs", roots: results }, null, 2) + "\n")
const bad = results.filter((entry) => !entry.pass)
console.log("")
console.log(`[t22 seed arms] ${results.length - bad.length}/${results.length} arms behaved as required`)
process.exitCode = bad.length === 0 ? 0 : 1
