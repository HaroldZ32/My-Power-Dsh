#!/usr/bin/env node
// verify-rtl-references: the retained post-extraction guard, two-sided.
//
//   A. mpd-side POSITIVE subject (always runs): the t8 stripped-surface invariant — an explicit
//      forbidden-path list that must NOT exist AND must NOT be tracked on the mpd side. This is
//      the gate's own subject, so the run can always fail for a real mpd-side reason.
//   B. silicon-side reference resolution: every path-like token in the six ported RTL documents
//      (read FROM the silicon checkout) is bucketed resolved / pending-by-design / unresolved.
//      A token may resolve in EITHER root: silicon owns the RTL bundle, mpd keeps the harness
//      material the workflow also uses. That is deliberate, not accidental — and it is why a
//      silicon-owned path that is MPD-ABSENT can still read as "resolved" (t3 F5). The stale mpd
//      copies that made that masking possible were removed by R2; the resolver itself is kept.
//
// Failure channel (R7.14 — strictly stronger than the pre-t8 script, never weaker):
//   * any forbidden path present or tracked             -> FAIL (exit 1)
//   * the silicon checkout absent                       -> FAIL (exit 1), never a SKIP that passes
//   * a stale/empty subject set (considered === 0)      -> FAIL (exit 1) as a DEGRADED run
//   * any unresolved token                              -> FAIL (exit 1), listing it
//
// Scope: the six ported RTL documents live in the silicon bundle (`docs/`); the two mpd-side RTL
// QA cases that used to be the second subject were retired by t8 (`skills/**` carries no RTL case).
//
// Lives under `scripts/` (NOT `skills/**`) on purpose: `skills/**` is VENDOR_LOCK fingerprinted,
// and this is a repo-level guard like verify-rows-parity.mjs.
//
// Usage: node scripts/verify-rtl-references.mjs [--self-test] [--json]
// Exit: 0 = no forbidden path, silicon side audited, no unresolved reference; 1 = failure; 2 = usage.
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const SILICON = process.env.MPD_SILICON_ROOT || join(dirname(repoRoot), "my-power-dsh-silicon")
const DOCS = ["rtl-verif-guide.md", "rtl-verif-guide.zh-CN.md", "rtl-ip-flow-guide.md", "rtl-ip-flow-guide.zh-CN.md", "rtl-gap-assessment.md", "rtl-gap-assessment.zh-CN.md"]
// The mpd-side RTL QA cases are RETIRED (t8 / R3): the corpus carries no RTL case by policy.
const CASES = []

/**
 * The stripped-surface invariant (t8): after the extraction mpd keeps NO RTL payload.
 * `kind: "path"` -> must not exist and must not be tracked; `kind: "hdl-tokens"` -> the file must
 * not mention the HDL language servers.
 */
const FORBIDDEN = [
  { path: "docs/rtl-verif-guide.md", kind: "path" },
  { path: "docs/rtl-verif-guide.zh-CN.md", kind: "path" },
  { path: "docs/rtl-ip-flow-guide.md", kind: "path" },
  { path: "docs/rtl-ip-flow-guide.zh-CN.md", kind: "path" },
  { path: "docs/rtl-gap-assessment.md", kind: "path" },
  { path: "docs/rtl-gap-assessment.zh-CN.md", kind: "path" },
  { path: "packages/mpd-verif-plugin", kind: "path" },
  { path: "tests/golden/fixtures/verilog", kind: "path" },
  { path: "packages/mpd-mcp-lsp/templates/rtl-lsp-client.json", kind: "path" },
  { path: "skills/dsh-qa/scripts/rtl-verif.mjs", kind: "path" },
  { path: "skills/dsh-qa/scripts/rtl-ip-profile.mjs", kind: "path" },
  { path: "packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts", kind: "hdl-tokens" },
  { path: "packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts", kind: "hdl-tokens" },
]
const HDL_TOKEN = /\bverible\b|\bslang-server\b/

/** Forward references with a named owner; each entry is [prefix, owner, why]. */
const PENDING = [
  ["packages/mpd-mcp-lsp", "t16 (landed)", "the HDL language-service assets are now in the silicon bundle; a reference that still resolves only in the mpd checkout is a leftover of the pre-t16 state"],
  ["docs/adder4.md", "t16 (landed)", "landed by t16 together with the Verilog fixtures"],
  ["docs/cnt8.md", "t16 (landed)", "landed by t16 together with the Verilog fixtures"],
  ["skills/dsh-qa/scripts/rtl-verif.mjs", "t8 (retired in mpd)", "the mpd-side RTL case was retired by t8/R3, so the silicon guides that still name this path are a silicon-side documentation follow-up — recorded as an owned bucket instead of being silently tolerated or deleted from the subject set"],
  ["skills/lsp-setup/references", "migrated (t17)", "the two orphan HDL READMEs were deleted by t17 and the HDL pages now live in the silicon bundle's packages/mpd-mcp-lsp/references/ — kept as a named bucket so the historical reference stays visible instead of pretending the path still exists"],
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

/** Tracked-ness of a repo-relative path (git is optional: a tarball has no history). */
function isTracked(relativePath) {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativePath], { cwd: repoRoot, encoding: "utf8" })
  return r.status === 0 && String(r.stdout).trim() !== ""
}

/**
 * The mpd-side invariant. Returns the violations (empty = the strip holds) and how many subjects
 * were actually checked, so a zero-subject run is reported as degraded instead of as a pass.
 */
function checkForbidden(entries = FORBIDDEN) {
  const violations = []
  for (const entry of entries) {
    const absolute = join(repoRoot, entry.path)
    if (entry.kind === "path") {
      const present = existsSync(absolute)
      const tracked = isTracked(entry.path)
      if (present || tracked) violations.push({ path: entry.path, kind: "path", present, tracked })
      continue
    }
    if (existsSync(absolute)) {
      const hits = readFileSync(absolute, "utf8").split("\n").filter((line) => HDL_TOKEN.test(line)).length
      if (hits > 0) violations.push({ path: entry.path, kind: "hdl-tokens", hits })
    }
  }
  return { violations, checked: entries.length }
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
  let audited = 0
  for (const file of files) {
    if (!existsSync(file.path)) continue
    audited += 1
    for (const token of tokens(readFileSync(file.path, "utf8"))) {
      considered += 1
      const verdict = resolve(token, file.roots)
      if (verdict.bucket === "resolved") buckets.resolved.push(token)
      else if (verdict.bucket === "pending") buckets.pending.push({ token, owner: verdict.owner, why: verdict.why })
      else buckets.unresolved.push({ token, file: file.label })
    }
  }
  return { considered, audited, buckets, forbidden: checkForbidden(), siliconPresent: existsSync(join(SILICON, "docs")) }
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

  // invariant controls: the detector must be able to FAIL, and must not fire on a clean subject
  const mustFlag = checkForbidden([{ path: "docs/index.md", kind: "path" }])
  if (mustFlag.violations.length !== 1) problems.push("invariant control: an existing committed path was NOT reported as a violation (the check cannot fail)")
  const cleanControl = checkForbidden([{ path: "docs/does-not-exist-zzz.md", kind: "path" }])
  if (cleanControl.violations.length !== 0) problems.push("invariant control: a non-existent path was reported as a violation")
  const tokenControl = checkForbidden([{ path: "packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts", kind: "hdl-tokens" }])
  if (tokenControl.violations.length !== 0) problems.push("invariant control: the stripped overlay file still trips the HDL-token check")

  const real = audit()
  if (real.considered === 0) problems.push("audit found no references at all — the extractor is broken")
  if (!real.siliconPresent) problems.push(`silicon checkout absent at ${SILICON} — the silicon-side subject cannot be audited (the gate must not pass)`)
  for (const entry of real.forbidden.violations) problems.push(`mpd-side strip violation: ${entry.path} (${JSON.stringify(entry)})`)
  for (const entry of real.buckets.unresolved) problems.push(`unresolved reference: ${entry.token} (${entry.file})`)

  if (problems.length > 0) {
    for (const problem of problems) console.error("[rtl-refs] FAIL  " + problem)
    process.exit(1)
  }
  console.log(`[rtl-refs self-test] ok: controls (resolved/pending/unresolved + invariant fail/clean) + live audit ${real.considered} reference(s), ${real.forbidden.checked} invariant subject(s), 0 violations`)
}

function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== "--self-test" && arg !== "--json")) {
    console.error("[rtl-refs] usage: node scripts/verify-rtl-references.mjs [--self-test] [--json]")
    process.exit(2)
  }
  if (args.includes("--self-test")) return selfTest()

  const { considered, audited, buckets, forbidden, siliconPresent } = audit()
  const degraded = []
  if (!siliconPresent) degraded.push(`silicon checkout absent (${SILICON}) — the silicon-side references cannot be audited; refusing to report PASS`)
  if (considered === 0) degraded.push("considered: 0 — no silicon-side reference subject was readable (degraded run)")
  if (forbidden.checked === 0) degraded.push("invariant: 0 forbidden-path subjects enumerated (degraded run)")

  const failed = buckets.unresolved.length > 0 || forbidden.violations.length > 0 || degraded.length > 0
  if (args.includes("--json")) {
    console.log(JSON.stringify({ siliconRoot: SILICON, considered, audited, mpdSideCases: CASES.length, forbiddenChecked: forbidden.checked, ...buckets, violations: forbidden.violations, degraded }, null, 2))
  } else {
    console.log(`[rtl-refs] mpd-side invariant: ${forbidden.checked} forbidden subject(s) checked (stripped-surface list, t8) — this subject ALWAYS runs`)
    console.log(`[rtl-refs] silicon: ${SILICON} ${siliconPresent ? "(present)" : "(ABSENT)"} | references: ${considered} across ${audited} document(s)`)
    console.log(`[rtl-refs] mpd-side cases: ${CASES.length} (retired by t8 — the corpus carries no RTL case)`)
    console.log("[rtl-refs] either-root resolution is deliberate: silicon owns the RTL bundle, mpd keeps the harness material the workflow also uses; a silicon-owned path that is MPD-ABSENT therefore still resolves (t3 F5), which R2 neutralized by removing the stale mpd copies")
    console.log(`  resolved: ${buckets.resolved.length}`)
    for (const entry of buckets.pending) console.log(`  pending (${entry.owner}): ${entry.token} — ${entry.why}`)
    for (const violation of forbidden.violations) console.error(`  STRIP VIOLATION: ${violation.path} — ${JSON.stringify(violation)}`)
    for (const entry of buckets.unresolved) console.error(`  UNRESOLVED: ${entry.token} (${entry.file})`)
    for (const reason of degraded) console.error(`  DEGRADED: ${reason}`)
  }
  console.log(failed
    ? `[rtl-refs] FAIL — ${forbidden.violations.length} strip violation(s), ${buckets.unresolved.length} unresolved reference(s), ${degraded.length} degraded condition(s)`
    : `[rtl-refs] PASS — ${forbidden.checked} invariant subject(s) clean, ${buckets.resolved.length} resolved, ${buckets.pending.length} pending-by-design, 0 unresolved`)
  process.exit(failed ? 1 : 0)
}

main()
