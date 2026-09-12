#!/usr/bin/env node
// verify-rtl-references: resolve every path reference that survives in the RTL
// material after the extraction, three-bucket:
//
//   resolved            the path exists in the silicon bundle or in this repo
//   pending-by-design   a forward reference with a named owner (t15/t16) — listed
//                       with its owner, never silently tolerated
//   unresolved          anything else: the gate FAILS (exit 1) and prints them
//
// Scope: the six ported RTL documents (silicon `docs/`) and the two repointed RTL
// QA cases (`skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs`), which are the
// material whose references the split could have broken.
//
// Lives under `scripts/` (NOT `skills/**`) on purpose: `skills/**` is VENDOR_LOCK
// fingerprinted, and this is a repo-level guard like verify-rows-parity.mjs.
//
// Usage: node scripts/verify-rtl-references.mjs [--self-test] [--json]
// Exit: 0 = no unresolved reference; 1 = unresolved found; 2 = usage error.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const SILICON = process.env.MPD_SILICON_ROOT || join(dirname(repoRoot), "my-power-dsh-silicon")
const DOCS = ["rtl-verif-guide.md", "rtl-verif-guide.zh-CN.md", "rtl-ip-flow-guide.md", "rtl-ip-flow-guide.zh-CN.md", "rtl-gap-assessment.md", "rtl-gap-assessment.zh-CN.md"]
const CASES = ["rtl-verif.mjs", "rtl-ip-profile.mjs"]

/** Forward references with a named owner; each entry is [prefix, owner, why]. */
const PENDING = [
  ["packages/mpd-mcp-lsp", "t16", "HDL language-service assets land with t16; the row ships disabled:true until then"],
  ["docs/adder4.md", "t16", "landed by t16 together with the Verilog fixtures"],
  ["docs/cnt8.md", "t16", "landed by t16 together with the Verilog fixtures"],
  ["skills/lsp-setup/references", "t17", "the two orphan HDL READMEs are deleted by t17 and the knowledge moves to silicon's packages/mpd-mcp-lsp/references/"],
  ["skills/rtl-dev", "historical", "proposed in the preserved gap assessment and never created: the capability shipped as rtl-codestyle/rtl-verif/rtl-ip-flow, and the document's technical content is kept verbatim"],
]
/** Output/runtime locations created by running the gates — not repo assets. */
const IGNORE = [".mpd/", "evidence/"]

const TOKEN = /(?:^|[\s`"'(=|])((?:skills|packages|presets|docs|scripts|evidence|\.mpd)\/[A-Za-z0-9._\-/{},]+)/g

function expandBraces(token) {
  const m = token.match(/\{([^{}]+)\}/)
  if (!m) return [token]
  return m[1].split(",").flatMap((part) => expandBraces(token.replace(m[0], part)))
}

/** Every path-like token in a text, brace-expanded and de-duplicated. */
function tokens(text) {
  const out = new Set()
  // A brace group wrapped across lines is still one reference: collapse the
  // whitespace inside braces before tokenizing, or the group truncates.
  const folded = text.replace(/\{([^{}]*)\}/g, (_match, inner) => "{" + inner.replace(/\s+/g, "") + "}")
  for (const match of folded.matchAll(TOKEN)) {
    for (const expanded of expandBraces(match[1])) {
      const clean = expanded.replace(/[.,;:]+$/, "")
      if (clean.includes("<") || clean.includes("…")) continue
      if (clean.split("/").length < 2) continue
      if (IGNORE.some((prefix) => clean === prefix.replace(/\/$/, "") || clean.startsWith(prefix))) continue
      out.add(clean)
    }
  }
  return [...out].sort()
}

function resolve(token, roots) {
  if (roots.some((root) => existsSync(join(root, token)))) return { bucket: "resolved" }
  for (const [prefix, owner, why] of PENDING) {
    if (token === prefix || token.startsWith(prefix + "/")) return { bucket: "pending", owner, why }
  }
  return { bucket: "unresolved" }
}

function audit() {
  // These documents describe the whole RTL workflow, so a reference may legitimately
  // point at either repository: silicon owns the RTL bundle, mpd keeps the harness
  // skills and scripts the workflow also uses. A path that exists in neither root
  // is the only thing that can be broken — plus the named forward references below.
  const files = [
    ...DOCS.map((name) => ({ label: "silicon docs/" + name, path: join(SILICON, "docs", name), roots: [SILICON, repoRoot] })),
    ...CASES.map((name) => ({ label: "mpd skills/dsh-qa/scripts/" + name, path: join(repoRoot, "skills", "dsh-qa", "scripts", name), roots: [repoRoot, SILICON] })),
  ]
  const buckets = { resolved: [], pending: [], unresolved: [] }
  let considered = 0
  for (const file of files) {
    if (!existsSync(file.path)) continue
    for (const token of tokens(readFileSync(file.path, "utf8"))) {
      considered += 1
      const verdict = resolve(token, file.roots)
      if (verdict.bucket === "resolved") buckets.resolved.push(token)
      else if (verdict.bucket === "pending") buckets.pending.push({ token, owner: verdict.owner, why: verdict.why })
      else buckets.unresolved.push({ token, file: file.label })
    }
  }
  return { considered, buckets }
}

function selfTest() {
  // negative control: an unlisted, non-existent path must land in `unresolved`
  const synthetic = "see `packages/mpd-mcp-lsp/templates/not-built-yet.json` and `packages/mpd-verif-plugin/dist/index.js` and `docs/does-not-exist-zzz.md`"
  const bucketed = tokens(synthetic).map((token) => ({ token, ...resolve(token, [SILICON, repoRoot]) }))
  const unresolved = bucketed.filter((entry) => entry.bucket === "unresolved").map((entry) => entry.token)
  const pending = bucketed.filter((entry) => entry.bucket === "pending").map((entry) => entry.token)
  const resolved = bucketed.filter((entry) => entry.bucket === "resolved").map((entry) => entry.token)
  const problems = []
  if (!unresolved.includes("docs/does-not-exist-zzz.md")) problems.push("negative control: a bogus path was NOT flagged unresolved")
  if (!pending.includes("packages/mpd-mcp-lsp/templates/not-built-yet.json")) problems.push("owner control: a t16 path was NOT classified pending")
  if (!resolved.includes("packages/mpd-verif-plugin/dist/index.js")) problems.push("positive control: an existing path was NOT resolved")

  const real = audit()
  if (real.considered === 0) problems.push("audit found no references at all — the extractor is broken")
  for (const entry of real.buckets.unresolved) problems.push(`unresolved reference: ${entry.token} (${entry.file})`)

  if (problems.length > 0) {
    for (const problem of problems) console.error("[rtl-refs] FAIL  " + problem)
    process.exit(1)
  }
  console.log(`[rtl-refs self-test] ok: controls (resolved/pending/unresolved) + live audit ${real.considered} reference(s), 0 unresolved`)
}

function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== "--self-test" && arg !== "--json")) {
    console.error("[rtl-refs] usage: node scripts/verify-rtl-references.mjs [--self-test] [--json]")
    process.exit(2)
  }
  if (args.includes("--self-test")) return selfTest()

  const { considered, buckets } = audit()
  if (args.includes("--json")) {
    console.log(JSON.stringify({ siliconRoot: SILICON, considered, ...buckets }, null, 2))
  } else {
    console.log(`[rtl-refs] silicon: ${SILICON} | references: ${considered}`)
    console.log(`  resolved: ${buckets.resolved.length}`)
    for (const entry of buckets.pending) console.log(`  pending (${entry.owner}): ${entry.token} — ${entry.why}`)
    for (const entry of buckets.unresolved) console.error(`  UNRESOLVED: ${entry.token} (${entry.file})`)
  }
  const failed = buckets.unresolved.length > 0
  console.log(failed ? `[rtl-refs] FAIL — ${buckets.unresolved.length} unresolved reference(s)` : `[rtl-refs] PASS — ${buckets.resolved.length} resolved, ${buckets.pending.length} pending-by-design, 0 unresolved`)
  process.exit(failed ? 1 : 0)
}

main()
