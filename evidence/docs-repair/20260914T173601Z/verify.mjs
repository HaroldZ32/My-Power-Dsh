// t15 repair evidence: the two t10 findings, the command that proves each claim, and the
// documentation gates re-run over ALL TWELVE docs (t9's ten + t8's extension guide pair).
//
// Run: bun evidence/docs-repair/20260914T173601Z/verify.mjs
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../../../", import.meta.url))
mkdirSync(join(HERE, "raw"), { recursive: true })

const DOCS = [
  "README.md", "README.zh-CN.md",
  "docs/index.md", "docs/index.zh-CN.md",
  "docs/user-guide.md", "docs/user-guide.zh-CN.md",
  "docs/architecture.md", "docs/architecture.zh-CN.md",
  "docs/development.md", "docs/development.zh-CN.md",
  "docs/extensions.md", "docs/extensions.zh-CN.md",
]

const log = []
function sh(argv, options = {}) {
  const run = spawnSync(argv[0], argv.slice(1), { cwd: REPO, encoding: "utf8", ...options })
  return { status: run.status, stdout: (run.stdout ?? "").trim(), stderr: (run.stderr ?? "").trim() }
}
function record(label, result, extra = {}) {
  log.push(`$ ${label}\nexit=${String(result.status)}\n${result.stdout}${result.stderr === "" ? "" : "\n[stderr] " + result.stderr}\n`)
  return { command: label, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, ...extra }
}

// ── F1 proof: no plugin reads a `codegraph.*` mpdConfig key ──────────────────
// The literal-name grep is inconclusive on its own (plugins read keys through
// variables), so the authoritative list ships IN the tool description and the
// plugin's own row config carries the options.
const codegraphGrep = sh(["bash", "-c", "grep -rn 'get(\"codegraph' packages/*/src/*.ts || true"])
const consumedList = sh(["bash", "-c", "grep -n 'Consumed keys:' packages/mpd-config-plugin/src/index.ts"])
const rowConfig = sh(["bash", "-c", "sed -n '/- id: mpd-codegraph/,+6p' packages/mpd-bundle/cordis.patch.yml"])
const pluginConfig = sh(["bash", "-c", "grep -n '^type Config' packages/mpd-codegraph-plugin/src/index.ts"])
// Table-ROW anchored: the honest note below the table legitimately MENTIONS the
// literal `codegraph.*`, so a substring grep would be a false negative.
const codegraphRowInGuide = sh(["bash", "-c", "grep -nE '^\\| *`codegraph\\.\\*`' docs/user-guide.md docs/user-guide.zh-CN.md || true"])
const noteEn = sh(["bash", "-c", "grep -c 'deliberately absent from this table' docs/user-guide.md"])
const noteZh = sh(["bash", "-c", "grep -c '刻意不在上表' docs/user-guide.zh-CN.md"])

record("F1 grep: get(\"codegraph...\") in packages/*/src/*.ts", codegraphGrep)
record("F1 mpd_config_get's authoritative consumed-key list", consumedList)
record("F1 the real source: the mpd-codegraph ROW config", rowConfig)
record("F1 the plugin's own row-config type", pluginConfig)
record("F1 result: the false `codegraph.*` ROW is gone from both user guides", codegraphRowInGuide)
record("F1 result: the exception is stated (EN)", noteEn)
record("F1 result: the exception is stated (ZH)", noteZh)

// ── F2 proof: which packages ship a bilingual README pair ────────────────────
const coverage = sh(["bash", "-c",
  "for d in packages/*/; do n=$(basename $d); [ \"$n\" = node_modules ] && continue; en=$([ -f \"$d/README.md\" ] && echo yes || echo NO); zh=$([ -f \"$d/README.zh-CN.md\" ] && echo yes || echo NO); [ \"$en$zh\" != \"yesyes\" ] && echo \"$n readme=$en zh=$zh\"; done"])
const sharedListed = sh(["bash", "-c", "grep -l 'mpd-mcp-shared' docs/index.md docs/index.zh-CN.md || true"])
const teamCompactPair = sh(["bash", "-c", "ls -la packages/mpd-team-compact-plugin/README.md packages/mpd-team-compact-plugin/README.zh-CN.md"])
record("F2 proof: packages WITHOUT a bilingual README pair", coverage)
record("F2 mpd-mcp-shared appears in both hubs", sharedListed)
record("F2 the new mpd-team-compact-plugin README pair", teamCompactPair)

// ── the documentation gates, over all TWELVE docs ────────────────────────────
const pair = sh(["bash", "-c",
  "for f in README.md docs/index.md docs/user-guide.md docs/architecture.md docs/development.md docs/extensions.md; do zh=\"${f%.md}.zh-CN.md\"; test -f \"$zh\" || { echo \"MISSING $zh\"; exit 1; }; grep -q \"zh-CN.md\" \"$f\" || { echo \"NO-SWITCH $f\"; exit 1; }; done; echo doc-pair-ok"])
const links = sh(["node", "-e",
  "const fs=require('fs'),p=require('path');let bad=0;for(const f of process.argv.slice(1)){const t=fs.readFileSync(f,'utf8');for(const part of t.split('](').slice(1)){const rel=part.split(')')[0].split('#')[0];if(rel.startsWith('./')||rel.startsWith('../')){if(!fs.existsSync(p.resolve(p.dirname(f),rel))){console.log('DEAD',f,rel);bad++}}}}console.log(bad?'dead-links='+bad:'links-ok');if(bad)process.exit(1)", ...DOCS])
record("gate 1: doc pairs + switch links", pair)
record(`gate 2: dead relative links over ${DOCS.length} docs`, links)

// The reverse switch link (every zh doc links its EN pair) — the gate only checks one direction.
const reverseMissing = DOCS.filter((f) => f.endsWith(".zh-CN.md")).filter((f) => {
  const text = readFileSync(join(REPO, f), "utf8")
  const head = text.split("\n").slice(0, 4).join("\n")
  return !head.includes("](") || !head.toLowerCase().includes("english")
})
log.push(`reverse switch links missing: ${JSON.stringify(reverseMissing)}`)

// The user-guide index tables must still have the same number of rows per language.
const rowCount = (file, marker) => readFileSync(join(REPO, file), "utf8").split("\n").filter((line) => line.startsWith("| `")).length
const enKeys = rowCount("docs/user-guide.md")
const zhKeys = rowCount("docs/user-guide.zh-CN.md")

const checks = {
  codegraphKeyNotRead: codegraphGrep.stdout === "" && !consumedList.stdout.toLowerCase().includes("codegraph"),
  codegraphRowRemoved: codegraphRowInGuide.stdout === "",
  codegraphExceptionStatedBothLanguages: noteEn.stdout === "1" && noteZh.stdout === "1",
  onlyTwoReadmeExceptions: coverage.stdout.split("\n").filter(Boolean).length === 2,
  sharedHelperListedBothLanguages: sharedListed.stdout.split("\n").filter(Boolean).length === 2,
  teamCompactPairExists: existsSync(join(REPO, "packages/mpd-team-compact-plugin/README.zh-CN.md")),
  docPairOk: pair.status === 0 && pair.stdout === "doc-pair-ok",
  linksOk: links.status === 0 && links.stdout === "links-ok",
  reverseSwitchLinksPresent: reverseMissing.length === 0,
  keyTableRowParity: enKeys === zhKeys,
}

const result = {
  task: "t15 — repair the two t10 documentation findings (both languages)",
  recordedAt: new Date().toISOString(),
  findingsRepaired: {
    F1: "docs/user-guide.md(+zh): the false `codegraph.*` mpd.jsonc row is REMOVED and the reality is stated instead — mpd-codegraph takes autoInit/initTimeoutMs/cooldownMs/binary from its bundle-patch ROW options, and no plugin reads `codegraph.*` through mpdConfig.",
    F2: "docs/index.md(+zh): the false 'One README per package' universal is replaced by an accurate statement listing BOTH real exceptions, AND the missing pair was ADDED for packages/mpd-team-compact-plugin (bilingual, switch links), AND packages/mpd-mcp-shared now appears in the enumeration.",
  },
  knownFollowUp: "packages/mpd-mcp-shared still ships no README (source + tests only). It is OUT of t15's inScope (`packages/` other than the optional mpd-team-compact pair), so it is stated as an explicit exception in both hubs and recorded here as a follow-up — not silently dropped.",
  evidence: { gateRowCounts: { enKeyRows: enKeys, zhKeyRows: zhKeys } },
  checks,
  verdict: Object.values(checks).every(Boolean) ? "pass" : "fail",
  commands: [
    { label: "F1: nothing reads codegraph.* — grep get(\"codegraph in packages/*/src/*.ts", stdout: codegraphGrep.stdout, note: "empty output is the proof; the literal grep is corroborated by the authoritative consumed-key list below" },
    { label: "F1: mpd_config_get consumed-key list (authoritative, ships in the tool description)", stdout: consumedList.stdout },
    { label: "F1: the real source of those settings — the mpd-codegraph bundle-patch ROW config", stdout: rowConfig.stdout },
    { label: "F1: the plugin's row-config type", stdout: pluginConfig.stdout },
    { label: "F2: packages without a bilingual README pair (after the repair: exactly the two stated exceptions)", stdout: coverage.stdout },
    { label: "F2: mpd-mcp-shared in both hubs", stdout: sharedListed.stdout },
    { label: "gate 1", stdout: pair.stdout, exitCode: pair.status },
    { label: "gate 2", stdout: links.stdout, exitCode: links.status },
  ],
}

writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(join(HERE, "raw", "output.log"), log.join("\n") + `\nchecks: ${JSON.stringify(checks, null, 2)}\nverdict: ${result.verdict}\n`)
console.log(JSON.stringify({ verdict: result.verdict, checks, keyRows: { en: enKeys, zh: zhKeys } }, null, 2))
