#!/usr/bin/env node

// t72 docs-claims checker — the DURABLE home of the t9/t21 checker, moved out of the evidence
// tree by T-72. Every repo path, line anchor, directory and command the three adaptation
// documents cite must resolve on disk, and the two docs must be structurally split rather than
// cosmetically different. On top of that it ENFORCES the T-55 anchor discipline: a citation
// resolves by SYMBOL, a line number is an optional HINT, and a line-number-only anchor is ROT.
//
// Run it with node, from anywhere:
//
//   node scripts/check-citations.mjs
//
// It is deterministic and offline: it spawns only the developer CLI (`validate`) and
// never a dsh boot. A citation that cannot be resolved is a FAILURE unless the line
// above it carries an explicit `<!-- citation-check: pending <task> -->` annotation,
// which is reported separately as a PENDING citation (a documented gap, never a
// silent one).
//
// ── RULE (T-78): A DOC-REWRITE TASK'S VERIFY LIST MUST CARRY THIS DRIVER ─────────────
// The exact command a doc-rewrite task must run — path-qualified, single invocation, offline and
// deterministic, with its output root stated so the evidence lands where the task owns it:
//
//   node scripts/check-citations.mjs --out ./evidence/gates/<slug>/<stamp>/run
//
// The same rule is written into EVERY run record (`rules.doc_rewrite`), so a reader of either
// surface finds it without prose. An omitted driver is not a silent state: the fixture pair in
// `--self-test` shows a mis-anchored citation exiting 1 with `does not carry the claim` while the
// correct fixture exits 0.
//
// Its addressing parameters, in the citation family's own six terms (F5): the literal string is
// `node scripts/check-citations.mjs --out`; the pattern AS PASSED is unescaped and case-sensitive;
// the tool mode is one process with an explicit `--out`; the unit is one run directory; the scope
// is the five subject documents under <repo> (`--citations-only` for the citation arms alone);
// the moment is the run's own `run_at`, recorded in the record.
//
// ── MODES (wave 2b, lane B2) ────────────────────────────────────────────────────────
//   node scripts/check-citations.mjs --self-test                       the citation arms
//   node scripts/check-citations.mjs --driver-headers [--self-test]    T-80: a driver header's
//       `A<n>` claims vs the `add("A<n>…")` keys the driver's code produces. The live scan names
//       the directories it covers, their per-directory split and BOTH matcher-error directions.
//   node scripts/check-citations.mjs --anchor-scan <dir> --pattern <literal>   T-90: report every
//       file under <dir> containing the literal, with path + line + phrase (exit 1 on any match).
//       RE-TAKEABLE 0: the scan excludes its OWN output root from the walk, and the reading is only
//       re-takeable when `--out` (and any stdout capture) is written OUTSIDE the scanned scope, or
//       when the scanned scope is a SEALED directory nobody writes into. A scan whose output lands
//       inside its own scope sees the PREVIOUS scans' records and cannot reproduce its 0.
// Every mode writes `<out>/result.json` + `<out>/output.log` (+ `<out>/revisions/` for a citation
// run) when `--out` is given, and a SECOND run at the same `--out` is REFUSED, never overwritten
// (immutable evidence: T-53, T-74). `--anchor-scan` EXCLUDES its own output subtree from the walk
// and names the exclusion in its record, so its reading is re-takeable (t31/B2-F5).
//
// ── THE CITATION FAMILY'S BOUNDARY (named, so a silent pass is not read as "checked") ──
// A citation this checker can JUDGE is a REPO-RELATIVE LITERAL path with at least one `/`
// (optionally `:line` / `:line-line`), with an optional claim written beside it. Two shapes are
// OUT OF FAMILY and pass SILENTLY, by DESIGN: (i) a POSITION citation — an arm cited by where it
// sits ("the third assertion in lane A's note") with no literal string — and (ii) a BASENAME-ONLY
// citation (`` `alphaSymbol`, `probe.ts` ``, no `/`). Neither can be resolved or rotted by this
// checker, so a green run says NOTHING about them; the six addressing parameters below are stated
// in exactly these terms, and this boundary is repeated in every run record's policy block.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
// T-53: evidence is immutable by default — a plain run writes to a FRESH timestamped directory and
// an existing target is refused instead of overwritten (this script used to rewrite the canonical
// result.json/output.log next to itself on every run).
import { IMMUTABLE_EXIT_CODE, exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp, writeImmutable } from "../skills/dsh-qa/scripts/lib/immutable-output.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_FLAG = process.argv.findIndex((a) => a === "--out" || a.startsWith("--out="))
const OUT_EXPLICIT = OUT_FLAG === -1 ? undefined : (process.argv[OUT_FLAG].startsWith("--out=") ? process.argv[OUT_FLAG].slice("--out=".length) : process.argv[OUT_FLAG + 1])
// T-72: the durable home is `<repo>/scripts`, but a plain run keeps landing in the evidence tree
// that holds every earlier revision's run (`evidence/extensions/docs-claims/runs/<slug>-<ts>`), so
// the durable checker's record stays comparable with the record it supersedes.
const OUT_BASE = join(HERE, "..", "evidence", "extensions", "docs-claims")
const OUT_ROOT = resolveOutputDir(OUT_EXPLICIT, OUT_BASE, "run")
// t21: the repo root is overridable so the offline NEGATIVE CONTROL can run this SAME
// checker over a fixture repo — a deliberately mis-anchored citation must fail there.
const REPO = process.env.DOCS_CLAIMS_REPO ? resolve(process.env.DOCS_CLAIMS_REPO) : resolve(HERE, "..")
const MANIFEST_FILE = "mpd-ext.json"
const TEMPLATE_TOKEN = "mpd-extension-template"
const SKELETON_ID = "for-agents-skeleton"
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")

const GUIDE_EN = "docs/extension-authoring-guide.md"
const GUIDE_ZH = "docs/extension-authoring-guide.zh-CN.md"
const AI_DOC = "EXTENSIONS-FOR-AGENTS.md"
const REPORT_EN = "docs/extension-adaptation-report.md"
const REPORT_ZH = "docs/extension-adaptation-report.zh-CN.md"
const STATUS_HEADING = /^## 12\./m

const SUBJECTS = [
  { path: GUIDE_EN, label: "human guide (EN)" },
  { path: GUIDE_ZH, label: "human guide (zh-CN)" },
  { path: AI_DOC, label: "agent contract" },
  { path: REPORT_EN, label: "report status section (EN)", from: STATUS_HEADING, required: true },
  { path: REPORT_ZH, label: "report status section (zh-CN)", from: STATUS_HEADING, required: true },
]

const ROOT_DIRS = ["docs/", "packages/", "skills/", "extensions/", "templates/", "scripts/", "evidence/", "presets/", "tests/", "src/"]
const PATH_PATTERN = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
/**
 * t21 CONTENT CLAIMS. A line anchor is only as good as the thing it points at, so an
 * anchored citation must carry a CLAIM written immediately before it:
 *
 *     `symbol`, `packages/x/y.ts:12`          <- the cited line must carry `symbol`
 *     `"a quoted phrase"`, `docs/z.md:7`      <- the cited line must carry the phrase
 *
 * The claim is mandatory for every anchored citation (a bare `:12` hint stays free,
 * which is why hints are written WITHOUT a path). This is the rule t12 measured the
 * old check missing: existence + line-RANGE checks stayed green at 14/14 while nine
 * anchor instances pointed at the wrong line.
 */
const CLAIM_PATTERN = /`([^`]+)`\s*[,，]?\s*\(?\s*`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?::(\d+)(?:[-–](\d+))?)?`/g
const SYMBOL_CLAIM = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/
const QUOTED_CLAIM = /^"(.*)"$/
const DIR_PATTERN = /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/)`/g
const COMMAND_PATTERN = /(?:^|\s)(?:bun|node)\s+((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/g

const results = []
const pending = []
const logs = []

function log(text) {
  logs.push(text)
  process.stdout.write(text + "\n")
}

/** The lines a negative-control arm is judged on: the subject verdicts plus any mismatch text. */
function reportedEvidence(output) {
  return output
    .split("\n")
    .filter((line) => line.includes("citations:") || line.includes("does not contain the claim") || line.includes("does not carry the claim") || line.includes("line-number-only anchor"))
    .join(" | ")
    .slice(0, 320)
}

function record(id, ok, detail) {
  results.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`)
  return ok
}

function lineCount(absolute) {
  return readFileSync(absolute, "utf8").split("\n").length
}

/** sha256 of a file, or null when it is absent — recording a revision must never kill a run. */
function fileHash(absolute) {
  try {
    return createHash("sha256").update(readFileSync(absolute)).digest("hex")
  } catch {
    return null
  }
}

// ── citation extraction ──────────────────────────────────────────────────────
function analyze(file, subject) {
  const absolute = join(REPO, file)
  if (!existsSync(absolute)) return { file, error: "missing subject file", citations: [], claims: [], pending: [] }
  const full = readFileSync(absolute, "utf8")
  let text = full
  let offset = 0
  if (subject.from !== undefined) {
    const match = subject.from.exec(full)
    if (match === null) return { file, error: `no status section (${STATUS_HEADING}) found`, citations: [], claims: [], pending: [] }
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  const lines = text.split("\n")
  const base = dirname(absolute)
  const citations = []
  const claims = []
  let nextFlag
  let nextFlagReason = ""
  let fenceFlag
  let fenceFlagReason = ""
  let inFence = false
  lines.forEach((line, index) => {
    const docLine = offset + index + 1
    if (line.startsWith("```")) {
      if (!inFence) {
        fenceFlag = nextFlag
        fenceFlagReason = nextFlagReason
        nextFlag = undefined
        nextFlagReason = ""
      } else {
        fenceFlag = undefined
        fenceFlagReason = ""
      }
      inFence = !inFence
      return
    }
    const flag = inFence ? fenceFlag : nextFlag
    const flagReason = inFence ? fenceFlagReason : nextFlagReason
    if (!inFence) {
      nextFlag = undefined
      nextFlagReason = ""
      const annotation = /citation-check:\s*(pending|illustrative)\s*:?\s*(.*?)\s*-->/.exec(line)
      if (annotation !== null) {
        nextFlag = annotation[1]
        nextFlagReason = annotation[2]
      }
    }
    const add = (kind, value, startLine, endLine) => {
      citations.push({ kind, value, line: startLine, endLine, docLine, flag, flagReason, base })
    }
    for (const match of line.matchAll(PATH_PATTERN)) {
      add("path", match[1], match[2] === undefined ? undefined : Number(match[2]), match[3] === undefined ? undefined : Number(match[3]))
    }
    for (const match of line.matchAll(DIR_PATTERN)) if (ROOT_DIRS.some((root) => match[1].startsWith(root))) add("dir", match[1])
    if (inFence) for (const match of line.matchAll(COMMAND_PATTERN)) add("command", match[1])
  })
  // Claims are extracted over the WHOLE subject text, not per line: the docs are
  // wrapped, and a claim whose anchor sits on the next line is still a claim.
  for (const match of text.matchAll(new RegExp(CLAIM_PATTERN.source, CLAIM_PATTERN.flags))) {
    claims.push({
      claim: match[1],
      path: match[2],
      line: match[3] === undefined ? undefined : Number(match[3]),
      endLine: match[4] === undefined ? undefined : Number(match[4]),
      docLine: offset + text.slice(0, match.index).split("\n").length,
      base,
    })
  }
  return {
    file,
    citations,
    claims,
    pending: citations.filter((entry) => entry.flag === "pending"),
    illustrative: citations.filter((entry) => entry.flag === "illustrative"),
  }
}

function checkCitation(citation) {
  const target = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  const shown = relative(REPO, target) === "" ? citation.value : relative(REPO, target)
  if (!existsSync(target)) return `${shown} does not exist`
  if (citation.kind === "dir" && !statSync(target).isDirectory()) return `${shown} is not a directory`
  if (citation.kind === "path" && statSync(target).isDirectory()) return `${shown} is a directory, not a file`
  if (citation.line !== undefined) {
    const total = lineCount(target)
    if (citation.line > total || citation.line < 1) return `${shown}:${citation.line} is outside the file (${total} lines)`
    if (citation.endLine !== undefined && (citation.endLine > total || citation.endLine < citation.line)) {
      return `${shown}:${citation.line}-${citation.endLine} is outside the file (${total} lines)`
    }
  }
  return undefined
}

// ── CONTENT: does the cited line actually carry the cited symbol? ────────────

/** Is this claim token a symbol or a quoted phrase (never a path or a command)? */
function claimText(claim) {
  const quoted = QUOTED_CLAIM.exec(claim)
  if (quoted !== null) return quoted[1]
  if (SYMBOL_CLAIM.test(claim)) return claim
  return undefined
}

/** The text of the cited line (or the whole cited range) on disk. */
function citedText(citation) {
  const target = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  if (!existsSync(target) || statSync(target).isDirectory()) return ""
  const lines = readFileSync(target, "utf8").split("\n")
  const to = citation.endLine === undefined ? citation.line : citation.endLine
  return lines.slice(citation.line - 1, to).join("\n")
}

/**
 * T-72 — THE ANCHOR RULE, named: a citation resolves by SYMBOL (T-55), and a line number is an
 * optional hint, never a locator of its own.
 *
 * The r-E acceptance measured the residual as ENFORCEMENT, not extraction: `PATH_PATTERN` and
 * `CLAIM_PATTERN` already accept a line-less anchor, but claim matching was per (path,line) over
 * the WHOLE document — so a bare `path:line` was ACCEPTED whenever ANY other anchor in the same
 * document carried a claim for that same path:line (measured on the frozen revision: exit 0), and
 * the remedy this checker taught was the line-bearing form.
 *
 * The site window: a claim belongs to a citation only when it names the same path/line/endLine
 * AND sits within `ROT_SITE_WINDOW` lines of it (the docs wrap, so the claim may be the line
 * above). Measured on the recorded subjects BEFORE choosing it: 32 line-bearing path citations,
 * 31 claims at distance 0 and 1 at distance 1, none farther (`probe-claim-proximity.mjs`).
 */
const ROT_SITE_WINDOW = 1

/** The claim written AT THIS ANCHOR'S SITE, or undefined when the anchor carries only a line. */
function claimForSite(citation, claims) {
  const matching = claims.filter((entry) => entry.path === citation.value && entry.line === citation.line && entry.endLine === citation.endLine)
  const atSite = matching.filter((entry) => Math.abs(entry.docLine - citation.docLine) <= ROT_SITE_WINDOW)
  if (atSite.length === 0) return undefined
  return atSite.sort((a, b) => Math.abs(a.docLine - citation.docLine) - Math.abs(b.docLine - citation.docLine))[0]
}

/**
 * T-72's ROT verdict: the anchor's only locator is a line number. Reported per anchor (the file,
 * the line and the fix) and able to fail the run — a flag that cannot redden is decoration.
 */
function lineNumberOnlyProblem(citation) {
  const span = `${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`
  return `line-number-only anchor \`${span}\`: a line number is not a citation (T-55) — it rots as soon as the cited file is edited. Cite the symbol instead: \`SYMBOL\`, \`${citation.value}\` (no :line) resolves against the whole file.`
}

/**
 * The t21 content assertion, now SITE-BOUND: the claim at the anchor must sit on the cited
 * line/range. A missing claim is no longer a separate message — it is the ROT verdict above.
 */
function claimContentProblem(citation, claim) {
  const text = claimText(claim.claim)
  if (text === undefined || text.length < 2) {
    return `the claim \`${claim.claim}\` is neither a symbol nor a quoted phrase`
  }
  if (!citedText(citation).includes(text)) {
    return `the cited line/range does not carry the claim \`${text}\` (${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`})`
  }
  return undefined
}

/**
 * T-55's SYMBOL-FIRST form: `` `SYMBOL`, `path/to/file.ts` `` with NO line number. The line is
 * optional in CLAIM_PATTERN, but the content arm above only fires for citations that CARRY a line —
 * so a line-less anchor used to pass SILENTLY, verified or not. Measured before this branch: a claim
 * naming `gammaSymbol`, which exists in no file, still exited 0 (`anchor-form-experiment.mjs`, arm B).
 *
 * This branch makes the form explicit AND falsifiable: when a line-less path citation carries a
 * claim, the cited FILE must contain it. A path citation with NO claim stays free (unchanged), so the
 * form is opt-in per anchor and the 249 existing citations do not suddenly require claims.
 *
 * F3 (t27 repair): the claim that belongs to a line-free citation is the one AT ITS OWN SITE. The
 * first build matched line-free claims DOCUMENT-WIDE (`.find` over every claim with the same path), so
 * a WRONG symbol-first claim passed whenever an EARLIER correct one for that path existed — measured
 * on BOTH revisions by the t17 reviewer's `symbol-first-right-then-wrong` arm (exit 0); it is now a
 * shipped self-test arm that exits 1. The document-wide lookup survives ONLY as the fallback for an
 * anchor that carries no claim of its own, because the form is opt-in per anchor: measured on the real
 * subjects, 2 anchors are verified by a claim 19/28 lines away and carry none at their own site
 * (`probe-line-free-claim-distance.stdout`).
 *
 * @returns true when the form is used and verified, a string problem when it is used and fails,
 *          and null when the citation is not the symbol-first form (caller leaves it alone).
 */
function symbolOnlyClaimCheck(citation, claims, fileText) {
  const forPath = claims.filter((entry) => entry.path === citation.value && entry.line === undefined && entry.endLine === undefined)
  if (forPath.length === 0) return null
  // F3: the anchor's OWN claim wins; a far claim is only the fallback for an anchor that has none.
  const claim = claimForSite(citation, claims) ?? forPath[0]
  const text = claimText(claim.claim)
  if (text === undefined || text.length < 2) {
    return `the claim \`${claim.claim}\` is neither a symbol nor a quoted phrase`
  }
  if (!fileText.includes(text)) {
    return `the cited file does not contain the claim \`${text}\` (${citation.value}) — cite a symbol the cited file declares (T-55), or drop the claim if this anchor is a plain path reference`
  }
  return true
}

/** Whole-file text of a citation's target ("" when missing/unreadable/not a file). */
function citedFileText(citation) {
  const target = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  if (!existsSync(target) || statSync(target).isDirectory()) return ""
  try {
    return readFileSync(target, "utf8")
  } catch {
    return ""
  }
}

// ── structural split ─────────────────────────────────────────────────────────
function headings(text) {
  const out = []
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^#{1,6}\s/.test(line)) out.push({ level: line.match(/^#+/)[0].length, text: line.replace(/^#+\s*/, "").trim() })
  }
  return out
}

function proseLines(text) {
  const out = []
  let inFence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const trimmed = line.trim()
    if (trimmed.length >= 60 && !trimmed.startsWith("|")) out.push(trimmed)
  }
  return out
}

// ── the skeleton: materialize the doc's manifest and validate it ─────────────
function skeletonFromDoc() {
  const text = readFileSync(join(REPO, AI_DOC), "utf8")
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)]
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1])
      if (parsed?.id === SKELETON_ID) return { raw: block[1], parsed }
    } catch {
      continue
    }
  }
  return undefined
}

function materializeSkeleton(raw) {
  const sandbox = mkdtempSync(join(tmpdir(), "t9-docs-claims-"))
  const root = join(sandbox, SKELETON_ID)
  mkdirSync(root, { recursive: true })
  const copy = (sourceRoot, relativeDir) => {
    for (const entry of readdirSync(join(sourceRoot, relativeDir), { withFileTypes: true })) {
      const child = relativeDir === "" ? entry.name : join(relativeDir, entry.name)
      const renamed = child
        .split(sep)
        .map((segment) => segment.split(TEMPLATE_TOKEN).join(SKELETON_ID))
        .join(sep)
      if (entry.isDirectory()) {
        mkdirSync(join(root, renamed), { recursive: true })
        copy(sourceRoot, child)
        continue
      }
      const body = readFileSync(join(sourceRoot, child), "utf8")
      writeFileSync(join(root, renamed), [".json", ".md", ".mjs"].includes(extname(entry.name)) ? body.split(TEMPLATE_TOKEN).join(SKELETON_ID) : body)
    }
  }
  copy(TEMPLATE_DIR, "")
  writeFileSync(join(root, MANIFEST_FILE), raw.endsWith("\n") ? raw : raw + "\n")
  return { sandbox, root }
}

// ── t21 NEGATIVE CONTROL: the content arm must be able to FAIL ───────────────
/**
 * A content assertion nobody can falsify is decoration. This builds two FIXTURE
 * repos — one whose anchored citation carries its claim ON the cited line, one whose
 * claim sits on a DIFFERENT line — and runs THIS SAME checker (through
 * DOCS_CLAIMS_REPO) over each: the correct fixture must exit 0, the mis-anchored one
 * must exit 1 and name the missing claim. Both arms are recorded in result.json.
 */
/**
 * WAVE-2B arms (T-78, T-82, immutability), spawned as CHILDREN of the REAL checker with an explicit
 * `--out` into a temp dir and NO `DOCS_CLAIMS_REPO` (so a record IS written):
 *   · T-78  the run's record is read as BYTES: the driver RULE and the COMMAND must be in them;
 *   · T-82  a COPY of the checker is run twice with a one-line change between the runs; the retained
 *           revisions must exist and the CHANGED pair must diff non-empty while an UNCHANGED pair
 *           diffs EMPTY — the anti-fake control, which a retention that copied the CURRENT file into
 *           both run dirs could not pass;
 *   · immutability  a SECOND run at the same `--out` must be REFUSED (exit 3), never overwritten.
 */
function retentionArm(sandbox) {
  const root = join(sandbox, "t82-root")
  for (const dir of ["docs", "src", "copydir", join("evidence", "extensions", "docs-claims")]) mkdirSync(join(root, dir), { recursive: true })
  // the copy runs from `<root>/copydir/`, so its `../skills/...` import needs `<root>/skills`
  symlinkSync(join(REPO, "skills"), join(root, "skills"))
  const guide = "# fixture guide\n\nSee `alphaSymbol`, `src/probe.ts`.\n"
  const report = "# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts`.\n"
  writeFileSync(join(root, "docs", "extension-authoring-guide.md"), guide)
  writeFileSync(join(root, "docs", "extension-authoring-guide.zh-CN.md"), guide)
  writeFileSync(join(root, "docs", "extension-adaptation-report.md"), report)
  writeFileSync(join(root, "docs", "extension-adaptation-report.zh-CN.md"), report)
  writeFileSync(join(root, "EXTENSIONS-FOR-AGENTS.md"), "# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts`.\n")
  writeFileSync(join(root, "src", "probe.ts"), "// fixture\nexport const alphaSymbol = 1\n")
  writeFileSync(join(root, "evidence", "extensions", "docs-claims", "check-citations.mjs"), "// FROZEN fixture revision — identical in both runs (the unchanged pair)\nexport const frozen = true\n")
  const copy = join(root, "copydir", "checker.mjs")
  const original = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const runCopy = (out) => spawnSync(process.execPath, [copy, "--citations-only", "--out", out], { encoding: "utf8", cwd: root })
  writeFileSync(copy, original.replace("#!/usr/bin/env node", "#!/usr/bin/env node\n// T-82 ARM CHANGE A"))
  const runA = runCopy(join(root, "runA"))
  writeFileSync(copy, original.replace("#!/usr/bin/env node", "#!/usr/bin/env node\n// T-82 ARM CHANGE B"))
  const runB = runCopy(join(root, "runB"))
  const readOrNull = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)
  const firstDifferingLine = (left, right) => {
    if (left === null || right === null) return null
    const leftLines = left.split("\n")
    const rightLines = right.split("\n")
    for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
      if (leftLines[index] !== rightLines[index]) return { line: index + 1, left: String(leftLines[index]).slice(0, 80), right: String(rightLines[index]).slice(0, 80) }
    }
    return null
  }
  const checkerA = readOrNull(join(root, "runA", "revisions", "checker.mjs"))
  const checkerB = readOrNull(join(root, "runB", "revisions", "checker.mjs"))
  const supersededA = readOrNull(join(root, "runA", "revisions", "superseded.mjs"))
  const supersededB = readOrNull(join(root, "runB", "revisions", "superseded.mjs"))
  const changed = firstDifferingLine(checkerA, checkerB)
  const unchanged = firstDifferingLine(supersededA, supersededB)
  return {
    exitCodes: [runA.status, runB.status],
    retained: { runA_checker: checkerA !== null, runB_checker: checkerB !== null, runA_superseded: supersededA !== null, runB_superseded: supersededB !== null },
    changed_pair: changed,
    unchanged_pair: unchanged,
    passed: checkerA !== null && checkerB !== null && supersededA !== null && supersededB !== null && changed !== null && String(changed.right).includes("T-82 ARM CHANGE B") && unchanged === null,
  }
}

function wave2bArms() {
  const sandbox = mkdtempSync(join(tmpdir(), "t78-t82-arms-"))
  const argumentsFor = (out) => [fileURLToPath(import.meta.url), "--citations-only", "--out", out]
  const t78Out = join(sandbox, "t78-run")
  const first = spawnSync(process.execPath, argumentsFor(t78Out), { encoding: "utf8", cwd: REPO })
  const recordPath = join(t78Out, "result.json")
  const recordBytes = existsSync(recordPath) ? readFileSync(recordPath, "utf8") : ""
  const RULE = "a doc-rewrite task's verify list MUST carry the citation driver"
  const COMMAND = "node scripts/check-citations.mjs --out ./evidence/gates/<slug>/<stamp>/run"
  const second = spawnSync(process.execPath, argumentsFor(t78Out), { encoding: "utf8", cwd: REPO })
  const secondOutput = (second.stdout ?? "") + (second.stderr ?? "")
  const t82 = retentionArm(sandbox)
  rmSync(sandbox, { recursive: true, force: true })
  return {
    t78: { exitCode: first.status, passed: recordBytes.includes(RULE) && recordBytes.includes(COMMAND), record: relative(REPO, recordPath), bytes: recordBytes.length, rule: RULE, command: COMMAND },
    t82,
    immutability: { exitCode: second.status, passed: second.status === IMMUTABLE_EXIT_CODE && /refusing to overwrite/.test(secondOutput), message: secondOutput.trim().split("\n")[0]?.slice(0, 160) ?? "" },
  }
}

function negativeControl() {
  // `anchor` is the WHOLE inline anchor clause, so one maker serves the line-anchored arms and the
  // T-55 symbol-first arms (a claim with no line number).
  const make = (anchor, options = {}) => {
    const root = mkdtempSync(join(tmpdir(), "t72-docs-claims-"))
    mkdirSync(join(root, "docs"), { recursive: true })
    mkdirSync(join(root, "src"), { recursive: true })
    const source = options.source ?? ["// fixture", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]
    writeFileSync(join(root, "src", "probe.ts"), source.join("\n"))
    const siblingAnchor = options.siblingAnchor ?? "`alphaSymbol`, `src/probe.ts:2`"
    const guide = `# fixture guide\n\nSee ${anchor} for the constant.${options.extra === undefined ? "" : `\n\n${options.extra}`}\n`
    writeFileSync(join(root, GUIDE_EN), guide)
    writeFileSync(join(root, GUIDE_ZH), guide)
    writeFileSync(join(root, AI_DOC), `# fixture contract\n\nSee ${siblingAnchor}.\n`)
    writeFileSync(join(root, REPORT_EN), `# fixture report\n\n## 12. Status\n\nSee ${siblingAnchor}.\n`)
    writeFileSync(join(root, REPORT_ZH), `# fixture report\n\n## 12. Status\n\nSee ${siblingAnchor}.\n`)
    return root
  }
  const run = (root) => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--citations-only"], {
      encoding: "utf8",
      env: { ...process.env, DOCS_CLAIMS_REPO: root },
    })
    const output = (child.stdout ?? "") + (child.stderr ?? "")
    rmSync(root, { recursive: true, force: true })
    return { exitCode: child.status, output }
  }
  const green = run(make("`alphaSymbol`, `src/probe.ts:2`"))
  const red = run(make("`alphaSymbol`, `src/probe.ts:3`"))
  // T-55 arms: the symbol-FIRST form must be ACCEPTED when the file carries the symbol and must
  // FAIL when it does not. Measured before this pair existed: the absent-symbol fixture exited 0,
  // i.e. the form was accepted but silently unchecked.
  const symbolPresent = run(make("`alphaSymbol`, `src/probe.ts`"))
  const symbolAbsent = run(make("`gammaSymbol`, `src/probe.ts`"))
  // T-72 arms — the ROT class in the three shapes it takes, plus the positive control that makes
  // the pair falsifiable. Each one must be FLAGGED:
  //   bare     : the anchor's only locator is the line number;
  //   shadowed : a SIBLING claim for the same path:line elsewhere in the document must NOT excuse
  //              it (measured on the frozen pre-T-72 revision — this fixture exits 0 there);
  //   drifted  : the line the anchor pins has MOVED because the cited file was edited — the rot
  //              T-72 names, and the reason a line number is not a citation.
  const shifted = ["// fixture", "// a later edit inserted this line", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]
  const rotBare = run(make("`src/probe.ts:2`"))
  const rotShadowed = run(make("`alphaSymbol`, `src/probe.ts:2`", { extra: "And `src/probe.ts:2` is cited here." }))
  const rotDrifted = run(make("`src/probe.ts:2`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))
  const symbolFirstShifted = run(make("`alphaSymbol`, `src/probe.ts`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))
  // F3 (t27): a WRONG symbol-first claim must be rejected even when an EARLIER line-free claim for the
  // same path exists. This is the t17 reviewer's `symbol-first-right-then-wrong` fixture shape — their
  // arm set measured it ACCEPTED (exit 0) on the frozen revision AND on the pre-repair durable one;
  // this shipped arm is the closure's control.
  const symbolFirstRightThenWrong = run(make("`alphaSymbol`, `src/probe.ts`", { extra: "And `gammaSymbol`, `src/probe.ts` is the other one." }))
  const rotFlagged = (arm) => arm.exitCode === 1 && /line-number-only anchor/.test(arm.output)
  const symbolFirstClaimFlagged = (arm) => arm.exitCode === 1 && /does not contain the claim/.test(arm.output)
  const arms = {
    green: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<correct fixture>)", exitCode: green.exitCode, passed: green.exitCode === 0, evidence: green.output.trim().split("\n").filter((line) => line.includes("citations:")).join(" | ").slice(0, 200) },
    red: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<mis-anchored fixture>)", exitCode: red.exitCode, passed: red.exitCode === 1 && /does not carry the claim/.test(red.output), evidence: red.output.trim().split("\n").filter((line) => line.includes("does not carry the claim")).join(" | ").slice(0, 300) },
    symbolOnlyPresent: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol present>)", exitCode: symbolPresent.exitCode, passed: symbolPresent.exitCode === 0, evidence: reportedEvidence(symbolPresent.output) },
    symbolOnlyAbsent: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol ABSENT>)", exitCode: symbolAbsent.exitCode, passed: symbolAbsent.exitCode === 1 && /does not contain the claim/.test(symbolAbsent.output), evidence: reportedEvidence(symbolAbsent.output) },
    rotLineOnly: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor>)", exitCode: rotBare.exitCode, passed: rotFlagged(rotBare), evidence: reportedEvidence(rotBare.output) },
    rotLineOnlyShadowed: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor shadowed by a sibling claim for the same path:line>)", exitCode: rotShadowed.exitCode, passed: rotFlagged(rotShadowed), evidence: reportedEvidence(rotShadowed.output) },
    rotLineOnlyDrifted: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor whose pinned line MOVED under it>)", exitCode: rotDrifted.exitCode, passed: rotFlagged(rotDrifted), evidence: reportedEvidence(rotDrifted.output) },
    symbolFirstSurvivesShift: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first anchor, cited file shifted>)", exitCode: symbolFirstShifted.exitCode, passed: symbolFirstShifted.exitCode === 0, evidence: reportedEvidence(symbolFirstShifted.output) },
    symbolFirstRightThenWrong: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first: correct claim first, WRONG claim later for the same path>)", exitCode: symbolFirstRightThenWrong.exitCode, passed: symbolFirstClaimFlagged(symbolFirstRightThenWrong), evidence: reportedEvidence(symbolFirstRightThenWrong.output) },
  }
  record("negative-control:correct-fixture", arms.green.passed, `${arms.green.command} - exit ${arms.green.exitCode} (a correct anchor must pass)`)
  record("negative-control:mis-anchored-fixture", arms.red.passed, `${arms.red.command} - exit ${arms.red.exitCode}; ${arms.red.evidence === "" ? "NO mismatch reported" : arms.red.evidence}`)
  record("negative-control:symbol-first-present", arms.symbolOnlyPresent.passed, `${arms.symbolOnlyPresent.command} - exit ${arms.symbolOnlyPresent.exitCode} (T-55: the line-less form must be ACCEPTED and verified)`)
  record("negative-control:symbol-first-absent", arms.symbolOnlyAbsent.passed, `${arms.symbolOnlyAbsent.command} - exit ${arms.symbolOnlyAbsent.exitCode} (T-55: an absent symbol must FAIL, not pass silently); ${arms.symbolOnlyAbsent.evidence === "" ? "NO mismatch reported" : arms.symbolOnlyAbsent.evidence}`)
  record("negative-control:rot-line-number-only", arms.rotLineOnly.passed, `${arms.rotLineOnly.command} - exit ${arms.rotLineOnly.exitCode} (T-72: a line-number-only anchor must be FLAGGED as rot, not accepted); ${arms.rotLineOnly.evidence === "" ? "NO rot reported" : arms.rotLineOnly.evidence}`)
  record("negative-control:rot-line-number-only-shadowed", arms.rotLineOnlyShadowed.passed, `${arms.rotLineOnlyShadowed.command} - exit ${arms.rotLineOnlyShadowed.exitCode} (T-72: a sibling claim for the same path:line must not excuse a line-number-only anchor at another site — the frozen pre-T-72 revision ACCEPTS this fixture, exit 0); ${arms.rotLineOnlyShadowed.evidence === "" ? "NO rot reported" : arms.rotLineOnlyShadowed.evidence}`)
  record("negative-control:rot-line-number-only-drifted", arms.rotLineOnlyDrifted.passed, `${arms.rotLineOnlyDrifted.command} - exit ${arms.rotLineOnlyDrifted.exitCode} (T-72: the pinned line moved under the document — the rot the row names); ${arms.rotLineOnlyDrifted.evidence === "" ? "NO rot reported" : arms.rotLineOnlyDrifted.evidence}`)
  record("negative-control:symbol-first-survives-a-source-shift", arms.symbolFirstSurvivesShift.passed, `${arms.symbolFirstSurvivesShift.command} - exit ${arms.symbolFirstSurvivesShift.exitCode} (T-55/T-72: the line-free form still resolves after the cited file moves under it — the same shift that reddens the line-only fixture)`)
  record("negative-control:symbol-first-right-then-wrong", arms.symbolFirstRightThenWrong.passed, `${arms.symbolFirstRightThenWrong.command} - exit ${arms.symbolFirstRightThenWrong.exitCode} (F3/t27: a WRONG symbol-first claim must FAIL even when an EARLIER line-free claim for the same path exists — the t17 reviewer's fixture shape, which the frozen AND the pre-repair durable revision ACCEPTED at exit 0); ${arms.symbolFirstRightThenWrong.evidence === "" ? "NO mismatch reported" : arms.symbolFirstRightThenWrong.evidence}`)
  // ── wave-2b arms (T-78 / T-82 / immutability): real runs into temp dirs, then read the BYTES ──
  const wave2b = wave2bArms()
  arms.t78RecordCarriesTheRule = { command: "check-citations.mjs --citations-only --out <tmp>; the record's BYTES are read back", exitCode: wave2b.t78.exitCode, passed: wave2b.t78.passed, evidence: `${wave2b.t78.record} (${wave2b.t78.bytes} B) carries the RULE and the COMMAND` }
  arms.t82RetentionDiffable = { command: "a COPY of the checker runs twice with a one-line change between the runs; the retained revisions are diffed", exitCode: wave2b.t82.exitCodes[1], passed: wave2b.t82.passed, evidence: `changed pair differs at line ${wave2b.t82.changed_pair?.line ?? "?"} (${wave2b.t82.changed_pair?.right ?? "NO DIFF"}); unchanged pair ${wave2b.t82.unchanged_pair === null ? "EMPTY (the control holds)" : "NOT EMPTY"}; retained ${JSON.stringify(wave2b.t82.retained)}` }
  arms.immutabilitySecondRunRefused = { command: "check-citations.mjs --citations-only --out <the SAME dir> a second time", exitCode: wave2b.immutability.exitCode, passed: wave2b.immutability.passed, evidence: wave2b.immutability.message }
  record("negative-control:t78-record-carries-the-rule", arms.t78RecordCarriesTheRule.passed, `T-78: the run at ${wave2b.t78.record} (${wave2b.t78.bytes} B) carries the driver RULE ("${wave2b.t78.rule}") and the COMMAND ("${wave2b.t78.command}") — asserted against the record's BYTES, not against a comment`)
  record("negative-control:t82-retention-diffable", arms.t82RetentionDiffable.passed, `T-82: ${arms.t82RetentionDiffable.evidence} — the changed pair NAMES the changed line, and the unchanged pair's empty diff is the anti-fake control`)
  record("negative-control:immutability-second-run-refused", arms.immutabilitySecondRunRefused.passed, `immutability: a second run at the same --out exited ${wave2b.immutability.exitCode} (expected ${IMMUTABLE_EXIT_CODE}) — ${wave2b.immutability.message}`)
  return arms
}

// ══ T-80: a driver header's `A<n>` claims vs the keys the driver's code produces ═══════════
//
// ADDRESSING PARAMETERS (F5, six terms): literal string `A<n>` for a claim and `add("A<n>…")` for a
// key; pattern AS PASSED `/\bA(\d+)\b/g` + `/\bA(\d+)\s*[–-]\s*A?(\d+)\b/g` and
// `/add\(\s*"(A\d+)[^"]*"/g`, all case-sensitive and unescaped; tool mode one offline process, no
// children; unit one driver file, and every finding names its PATH (never a position); scope the
// directories named in the record's `audit.directories`; moment the record's `run_at`.
//
// POLICY — stated in the checker, because silence is not acceptable (acceptance T-80 (a)):
//   CLAIMED-BUT-UNASSERTED  a header claim the code produces no key for   → VIOLATION (exit 1)
//   ASSERTED-BUT-UNCLAIMED  a produced key no header claim covers         → VIOLATION (exit 1)
//   NO-CLAIM-SET            a driver whose header makes no claim of its own (no claim marker line,
//                           or only REFERENCE lines — see below)         → REPORTED, not a
//                           violation: the equality rule has no subject there, and the file and
//                           its keys are still named in the record.
// A claim counts only inside a claim SCOPE: a header line carrying a claim marker opens the scope,
// which closes at the next blank header line. A line inside a scope that points at another
// artifact's numbering (acceptance/design/§/`t<nn>`) is a REFERENCE, never a claim — the measured
// instance that forced the rule is `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`, whose
// header writes "t35 acceptance A1-A4/A6" (a citation of t35's items) and whose falsifier list is
// headed "(design §9.3 F1/F2/F4/F5, ...)": a whole-header token scan reads both as claims and
// reports a violation that does not exist. References are COUNTED AND PRINTED, never dropped.
const CLAIM_MARKERS = /\b(claims?|claimed|asserts?|asserted|checks?|checked|covers?|covered|arms?|keys?|proves?|proof|must|expects?|expected)\b/i
const REFERENCE_MARKERS = /(design|acceptance|\bplan\b|§|\bt\d+\b)/i
const CLAIM_TOKEN = /\bA(\d+)\b/g
const CLAIM_RANGE = /\bA(\d+)\s*[–-]\s*A?(\d+)\b/g
const KEY_CALL = /add\(\s*"A(\d+)[^"]*"/g
const DRIVER_SCOPE = "./skills/dsh-qa/scripts/"
const DRIVER_EXTENSIONS = [".mjs"]

/** Recursive file walk with a filter, skipping the two directories that are never corpus. */
function walkFiles(root, filter, out = []) {
  if (!existsSync(root)) return out
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      walkFiles(child, filter, out)
    } else if (filter(child)) out.push(child)
  }
  return out
}

/** The leading comment block of a driver (shebang + `//` lines + blanks), up to the first code line. */
function driverHeaderLines(text) {
  const lines = []
  for (const line of text.split("\n")) {
    if (/^#!/.test(line) || /^\s*$/.test(line) || /^\s*\/\//.test(line)) lines.push(line.replace(/^\s*\/\/\s?/, ""))
    else break
  }
  return lines
}

/**
 * Claim extraction. `naive: true` is the ALTERNATIVE matcher this audit measures itself against: no
 * claim-marker scope and no reference filter — every `A<n>` token in the header counts as a claim.
 */
function parseHeaderClaims(text, { naive = false } = {}) {
  const claims = new Map()
  const references = []
  const referenceTokens = new Set()
  const claimLines = []
  let scope = false
  for (const body of driverHeaderLines(text)) {
    const trimmed = body.trim()
    if (trimmed === "") {
      scope = false
      continue
    }
    if (naive) {
      for (const match of trimmed.matchAll(new RegExp(CLAIM_RANGE.source, "g"))) {
        const from = Number(match[1])
        const to = Number(match[2])
        if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) if (!claims.has(n)) claims.set(n, trimmed)
      }
      for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) {
        const n = Number(match[1])
        if (!claims.has(n)) claims.set(n, trimmed)
      }
      continue
    }
    if (CLAIM_MARKERS.test(trimmed)) scope = true
    if (!scope) continue
    if (REFERENCE_MARKERS.test(trimmed)) {
      references.push(trimmed)
      // F4 (t31): the exemption is LINE-wide. The tokens on such a line are collected here and
      // reported as the audit's THIRD matcher-error direction (an under-report), so the exemption
      // is declared and MEASURED instead of silent.
      for (const match of trimmed.matchAll(new RegExp(CLAIM_RANGE.source, "g"))) {
        const from = Number(match[1])
        const to = Number(match[2])
        if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) referenceTokens.add(n)
      }
      for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) referenceTokens.add(Number(match[1]))
      continue
    }
    claimLines.push(trimmed)
    for (const match of trimmed.matchAll(new RegExp(CLAIM_RANGE.source, "g"))) {
      const from = Number(match[1])
      const to = Number(match[2])
      if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) if (!claims.has(n)) claims.set(n, trimmed)
    }
    for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) {
      const n = Number(match[1])
      if (!claims.has(n)) claims.set(n, trimmed)
    }
  }
  return { claims, references, referenceTokens, claimLines }
}

/** The `add("A<n>…")` assertion keys a driver's code actually produces. */
function parseAssertedKeys(text) {
  const keys = new Map()
  for (const match of text.matchAll(new RegExp(KEY_CALL.source, "g"))) {
    const n = Number(match[1])
    if (!keys.has(n)) keys.set(n, match[0])
  }
  return keys
}

/** One driver's row: its keys, its claims, and the two mismatch directions. */
function driverRow(absolute, { naive = false } = {}) {
  const text = readFileSync(absolute, "utf8")
  const { claims, references, referenceTokens, claimLines } = parseHeaderClaims(text, { naive })
  const keys = parseAssertedKeys(text)
  const claimedButUnasserted = [...claims.keys()].filter((n) => !keys.has(n)).sort((a, b) => a - b)
  const assertedButUnclaimed = [...keys.keys()].filter((n) => !claims.has(n)).sort((a, b) => a - b)
  return {
    path: relative(REPO, absolute),
    keys: [...keys.keys()].sort((a, b) => a - b),
    claims: [...claims.keys()].sort((a, b) => a - b),
    no_claim_set: claims.size === 0,
    claimed_but_unasserted: claimedButUnasserted,
    asserted_but_unclaimed: claims.size === 0 ? [] : assertedButUnclaimed,
    reference_lines: references,
    reference_tokens: [...referenceTokens].sort((a, b) => a - b),
    claim_lines: claimLines,
    phrases: Object.fromEntries(claimedButUnasserted.map((n) => [`A${n}`, claims.get(n)])),
  }
}

/**
 * The T-80 fixture arms, each a spawned CHILD of this checker (`--driver-headers --dir <fixture>`)
 * with an asserted exit code AND an asserted message — never a prose claim:
 *   · matching                header CHECKS A1–A3, code produces A1–A3          → exit 0
 *   · claimed-but-unasserted   header CHECKS A1–A4, code produces A1–A3          → exit 1, names A4 + path
 *   · extra-key (near miss)    header CHECKS A1–A3, code produces A1–A4          → exit 1, names A4 + path
 */
function driverHeadersSelfTest() {
  const root = mkdtempSync(join(tmpdir(), "t80-driver-headers-"))
  const make = (name, header, keys) => {
    const file = join(root, name)
    writeFileSync(file, ["#!/usr/bin/env node", ...header.map((line) => `// ${line}`), "", ...keys.map((key) => `  add("${key}", true, "fixture arm")`), ""].join("\n"))
    return file
  }
  const fixtures = [
    { id: "t80-matching", expect: 0, needle: undefined, file: make("matching.mjs", ["This driver CHECKS A1–A3; each arm produces its own assertion key."], ["A1", "A2", "A3"]) },
    { id: "t80-claimed-but-unasserted", expect: 1, needle: /driver:.*claimed-but-unasserted\.mjs[\s\S]*CLAIMED-BUT-UNASSERTED A4/, file: make("claimed-but-unasserted.mjs", ["This driver CHECKS A1–A4; the header claims an arm the code never asserts."], ["A1", "A2", "A3"]) },
    { id: "t80-extra-key-near-miss", expect: 1, needle: /driver:.*extra-key\.mjs[\s\S]*ASSERTED-BUT-UNCLAIMED A4/, file: make("extra-key.mjs", ["This driver CHECKS A1–A3."], ["A1", "A2", "A3", "A4"]) },
  ]
  log("driver-header claim check — self-test (T-80 fixture arms)")
  let failed = 0
  for (const fixture of fixtures) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--driver-headers", "--dir", fixture.file], { encoding: "utf8", cwd: REPO })
    const output = (child.stdout ?? "") + (child.stderr ?? "")
    const ok = child.status === fixture.expect && (fixture.needle === undefined || fixture.needle.test(output))
    if (!ok) failed += 1
    log(`  ${ok ? "ok  " : "FAIL"} ${fixture.id} — exit ${child.status} (expected ${fixture.expect})${fixture.needle === undefined ? "" : "; the key and the driver PATH must both be named"}`)
    if (!ok) log(output.trim().split("\n").slice(-4).join("\n"))
  }
  rmSync(root, { recursive: true, force: true })
  log("")
  log(`[driver-headers self-test] ${fixtures.length - failed}/${fixtures.length} arms passed`)
  return failed === 0 ? 0 : 1
}

function driverHeadersMain() {
  // t31/B2-F2: there is NO user-facing naive MODE. The alternative (naive) matcher is an INTERNAL
  // measurement the audit runs for its over-report direction; a flag that only relabelled the mode
  // while every row came from the precise matcher was removed rather than wired.
  if (process.argv.includes("--self-test")) return driverHeadersSelfTest()
  const scopeArg = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : DRIVER_SCOPE
  const runAt = new Date().toISOString()
  log("driver-header claim check (T-80)")
  log(`parameters: claims ${CLAIM_TOKEN.source} + ${CLAIM_RANGE.source} (markers ${CLAIM_MARKERS.source}; references ${REFERENCE_MARKERS.source}) · keys ${KEY_CALL.source} · mode one offline process · unit one driver file · scope ${scopeArg} · moment ${runAt}`)
  log("")
  const scopeRoot = resolve(REPO, scopeArg)
  // the scope is EITHER a directory (the live corpus) or ONE file (a fixture arm)
  const scopeIsDirectory = statSync(scopeRoot).isDirectory()
  const files = scopeIsDirectory ? walkFiles(scopeRoot, (file) => DRIVER_EXTENSIONS.some((extension) => file.endsWith(extension))) : [scopeRoot]
  const rows = []
  const split = new Map()
  for (const file of files) {
    const directory = relative(REPO, dirname(file)) + "/"
    const bucket = split.get(directory) ?? { files: 0, key_producers: 0, keys: 0, claims: 0, violations: 0, no_claim_set: 0 }
    bucket.files += 1
    const text = readFileSync(file, "utf8")
    const keys = parseAssertedKeys(text)
    if (keys.size > 0) {
      const row = driverRow(file)
      rows.push(row)
      bucket.key_producers += 1
      bucket.keys += row.keys.length
      bucket.claims += row.claims.length
      if (row.no_claim_set) bucket.no_claim_set += 1
      const violations = row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length
      bucket.violations += violations
      record(
        `driver:${row.path}`,
        violations === 0,
        violations === 0
          ? `${row.keys.length} assertion key(s) [A${row.keys[0]}–A${row.keys[row.keys.length - 1]}]; ${row.no_claim_set ? "NO-CLAIM-SET declared in the header (reported, not a violation)" : `${row.claims.length} claimed`}`
          : `${row.claimed_but_unasserted.map((n) => `CLAIMED-BUT-UNASSERTED A${n} (header phrase: "${String(row.phrases[`A${n}`]).slice(0, 120)}")`).join("; ")}${row.asserted_but_unclaimed.length > 0 ? `${row.claimed_but_unasserted.length > 0 ? "; " : ""}ASSERTED-BUT-UNCLAIMED ${row.asserted_but_unclaimed.map((n) => `A${n}`).join(", ")}` : ""}`,
      )
    }
    split.set(directory, bucket)
  }
  // ER-2: the audit measures BOTH matcher-error directions on ITSELF, instead of inheriting another
  // audit's numbers (lane A's T-92 split — 25 self-fix-tests/** + 17 test/** = 42 `not.toContain(`
  // occurrences — measures a DIFFERENT audit and is NOT reused here).
  const naiveFiles = rows.map((row) => driverRow(join(REPO, row.path), { naive: true })).filter((row) => row.claims.length > 0 && (row.claimed_but_unasserted.length > 0 || row.asserted_but_unclaimed.length > 0))
  const nonRecursive = scopeIsDirectory ? readdirSync(scopeRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".mjs") && parseAssertedKeys(readFileSync(join(scopeRoot, entry.name), "utf8")).size > 0).length : 0
  const repoWide = walkFiles(REPO, (file) => file.endsWith(".mjs")).filter((file) => parseAssertedKeys(readFileSync(file, "utf8")).size > 0).length
  const extensionAssumption = scopeIsDirectory ? DRIVER_EXTENSIONS.flatMap((extension) => walkFiles(scopeRoot, (file) => file.endsWith(extension.replace(".mjs", ".js")))).filter((file) => parseAssertedKeys(readFileSync(file, "utf8")).size > 0).length : 0
  const audit = {
    directories: [{ path: scopeArg, recursive: true, files_scanned: files.length }],
    per_directory_split: Object.fromEntries([...split.entries()].sort()),
    claim_set_parsed: rows.filter((row) => !row.no_claim_set).length,
    no_claim_set: rows.filter((row) => row.no_claim_set).length,
    violations: rows.reduce((total, row) => total + row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length, 0),
    third_direction: {
      name: "the line-wide REFERENCE exemption",
      measured: `${rows.filter((row) => row.reference_tokens.length > 0).length} reference line(s) carry ${new Set(rows.flatMap((row) => row.reference_tokens)).size} A<n> token(s) (${[...new Set(rows.flatMap((row) => row.reference_tokens))].sort((a, b) => a - b).map((n) => `A${n}`).join(", ") || "none"}); the exemption skips the WHOLE line, so a claim sharing a line with an artifact reference is not claimed — declared and measured rather than silent (t31/B2-F4)`,
    },
    matcher_error_directions: [
      { direction: "over-report", alternative: "whole-header token scan (no claim-marker scope, no reference filter)", measured: `${naiveFiles.length} file(s) flagged and ${naiveFiles.reduce((t, row) => t + row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length, 0)} key(s) reported as mismatched, against ${rows.reduce((t, row) => t + row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length, 0)} with the precise rule` },
      { direction: "under-report", alternative: `non-recursive ${scopeArg}*.mjs (misses lib/)`, measured: `${nonRecursive} key producer(s) found against ${rows.length}` },
      { direction: "under-report", alternative: "a file-type assumption (.js) instead of .mjs", measured: `${extensionAssumption} key producer(s) found against ${rows.length}` },
      { direction: "over-report", alternative: "a whole-repo literal scan for `add(\"A`", measured: `${repoWide} key-producing .mjs file(s) repo-wide against ${rows.length} in scope` },
    ],
    not_inherited: "lane A's T-92 audit split (25 self-fix-tests/** + 17 test/** = 42 `not.toContain(` occurrences; subject-scoped 3 with 0 reddened) measures a DIFFERENT audit — different literal, different subject — and is not reused here.",
  }
  const violations = rows.flatMap((row) => [
    ...row.claimed_but_unasserted.map((n) => `CLAIMED-BUT-UNASSERTED ${row.path} A${n} — header phrase: "${String(row.phrases[`A${n}`]).slice(0, 160)}"`),
    ...row.asserted_but_unclaimed.map((n) => `ASSERTED-BUT-UNCLAIMED ${row.path} A${n}`),
  ])
  const report = {
    task: "T-80 (t15, wave-2b lane B2): a driver header's `A<n>` claims vs its own assertion keys",
    run_at: runAt,
    mode: "driver-headers",
    parameters: {
      literal_string: '`A<n>` (claim) and `add("A<n>…")` (key)',
      pattern_as_passed: `${CLAIM_TOKEN.source} + ${CLAIM_RANGE.source} + ${KEY_CALL.source} (case-sensitive, unescaped)`,
      tool_mode: "one process, offline, no children",
      unit: "one driver file (every finding names its PATH)",
      scope: scopeArg,
      moment: runAt,
    },
    policy: {
      claimed_but_unasserted: "VIOLATION",
      asserted_but_unclaimed: "VIOLATION (a header that under-claims is reported, never silent)",
      no_claim_set: "REPORTED, not a violation — the equality rule has no subject; the file and its keys are named",
      reference_lines: "an `A<n>` token on a line pointing at another artifact's numbering (acceptance/design/§/t<nn>) is a REFERENCE, counted and printed, never a claim",
      out_of_family: "a citation cited by POSITION (no literal string) and a BASENAME-ONLY path (no `/`) are OUT OF FAMILY: the six addressing parameters require a repo-relative literal, so neither shape is judged and both pass silently — a green run says nothing about them (t31/B2-F3)",
    },
    audit,
    drivers: rows,
    violations,
  }
  if (OUT_EXPLICIT) {
    try {
      writeImmutable(join(OUT_ROOT, "result.json"), JSON.stringify(report, null, 2) + "\n", { label: "driver-header run result" })
      writeImmutable(join(OUT_ROOT, "output.log"), logs.join("\n") + "\n", { label: "driver-header run log" })
      log("[driver-headers] evidence -> " + relative(REPO, OUT_ROOT))
    } catch (error) {
      exitOnRefusal(error, "[driver-headers]")
    }
  }
  log("")
  log(`[driver-headers] ${files.length} file(s) scanned, ${rows.length} key-producing driver(s), ${audit.claim_set_parsed} claim set(s), ${audit.no_claim_set} NO-CLAIM-SET, ${violations.length} violation(s)`)
  return violations.length === 0 ? 0 : 1
}

// ══ T-90 / addendum A: an anchor scan with the pattern NAMED and the moment stated ═════════
function anchorScanMain() {
  const dirArg = process.argv[process.argv.indexOf("--anchor-scan") + 1]
  const patternArg = process.argv.includes("--pattern") ? process.argv[process.argv.indexOf("--pattern") + 1] : undefined
  if (dirArg === undefined || patternArg === undefined) {
    log("usage: node scripts/check-citations.mjs --anchor-scan <dir> --pattern <literal> [--out <dir>]")
    return 2
  }
  const runAt = new Date().toISOString()
  const root = resolve(REPO, dirArg)
  const candidates = walkFiles(root, () => true).filter((file) => /\.(md|json|mjs|js|ts|txt|log|out|yaml|yml)$/.test(file))
  // F5 (t31): the scan writes its record INSIDE the tree it scans by default, and that record carries
  // the literal — so the first run would poison every re-take. The scan's own output subtree is
  // therefore EXCLUDED from the walk and NAMED in the record, which is what makes the 0 re-takeable.
  const selfOutput = resolve(OUT_ROOT)
  const isSelfOutput = (file) => resolve(file) === selfOutput || resolve(file).startsWith(selfOutput + sep)
  const files = candidates.filter((file) => !isSelfOutput(file))
  const excludedSelf = candidates.filter(isSelfOutput).map((file) => relative(REPO, file))
  // F5 (t31): a match inside the scanner's OWN record is not an anchor — it is the record QUOTING the
  // scan's command. Those are classified and NAMED (never counted as anchors), so the reading is
  // re-takeable and a reader can tell a real absence from the scanner's own output.
  const selfReferenceReason = (file) => {
    const rel = relative(REPO, file)
    if (rel.split(sep).some((part) => part.startsWith("anchor-"))) return "the path is inside an anchor-scan output directory"
    let text = ""
    try {
      text = readFileSync(file, "utf8")
    } catch {
      return undefined
    }
    if (text.includes('"task": "T-90 anchor scan"')) return "the file IS an anchor-scan record"
    if (text.includes("node scripts/check-citations.mjs --anchor-scan")) return "the file QUOTES the scan's own command (provenance, not an anchor)"
    return undefined
  }
  const hits = []
  const selfHits = []
  for (const file of files) {
    const reason = selfReferenceReason(file)
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, index) => {
      if (!line.includes(patternArg)) return
      const entry = { path: relative(REPO, file), line: index + 1, phrase: line.trim().slice(0, 200) }
      if (reason === undefined) hits.push(entry)
      else selfHits.push({ ...entry, self_reference: reason })
    })
  }
  log("anchor scan (T-90 / ADDENDUM A: no mailbox-record-id-shaped anchors in this lane's records)")
  log(`parameters: literal string ${JSON.stringify(patternArg)} · pattern AS PASSED plain substring, case-sensitive, unescaped · mode one offline process, no children · unit one file under ${dirArg} · scope ${files.length} text file(s) · moment ${runAt}`)
  log(`self-reference: the scan's OWN output under ${relative(REPO, selfOutput)} is EXCLUDED from the walk (${excludedSelf.length} file(s)), so this reading is re-takeable with the same command (t31/B2-F5)`)
  for (const hit of hits) log(`  MATCH ${hit.path}:${hit.line} — ${hit.phrase}`)
  for (const hit of selfHits) log(`  SELF-REFERENCE ${hit.path}:${hit.line} — ${hit.self_reference}: ${hit.phrase}`)
  const report = {
    task: "T-90 anchor scan",
    run_at: runAt,
    pattern: patternArg,
    scope: dirArg,
    files_scanned: files.length,
    matches_self_reference: selfHits,
    self_reference: {
      excluded_output_root: relative(REPO, selfOutput),
      excluded_files: excludedSelf,
      rule: "a match is an ANCHOR only if it is not the scanner's own record: the scan excludes its OWN output root, and classifies any hit inside an anchor-scan record (or a capture quoting the scan's command) as SELF-REFERENCE — named, never counted. Re-takeable 0: `--out` (and any stdout capture) belongs OUTSIDE the scanned scope, or the scanned scope must be sealed (t31/B2-F5).",
      scanned_scope_files: files.length,
      classified: selfHits.length,
    },
    policy: {
      out_of_family: "a POSITION citation (no literal string) and a BASENAME-ONLY citation (no `/`) are OUT OF FAMILY and pass silently, by design: this scanner judges a repo-relative literal only, so a green scan says nothing about those shapes (t31/B2-F3).",
      scope_note: "a plain-substring scan reports every file under the scope that contains the literal; it is a DISCOVERY heuristic, not a class rule (T-90's calibration bound).",
    },
    matches: hits,
  }
  if (OUT_EXPLICIT) {
    try {
      writeImmutable(join(OUT_ROOT, "result.json"), JSON.stringify(report, null, 2) + "\n", { label: "anchor-scan run result" })
      writeImmutable(join(OUT_ROOT, "output.log"), logs.join("\n") + "\n", { label: "anchor-scan run log" })
    } catch (error) {
      exitOnRefusal(error, "[anchor-scan]")
    }
  }
  log("")
  log(`[anchor-scan] ${matches(hits)} anchor match(es) in ${files.length} file(s) under ${dirArg}; ${selfHits.length} self-reference match(es) classified and named (not anchors)`)
  return hits.length === 0 ? 0 : 1
}

function matches(hits) {
  return hits.length
}

if (process.argv.includes("--driver-headers")) process.exit(driverHeadersMain())
if (process.argv.includes("--anchor-scan")) process.exit(anchorScanMain())

const fixtureRun = process.env.DOCS_CLAIMS_REPO !== undefined
const negativeControlArms = process.argv.includes("--self-test") ? negativeControl() : undefined

// ── run ──────────────────────────────────────────────────────────────────────
log("docs-claims checker (t72: existence + range + SITE-PAIRED content claims + symbol-first enforcement + negative control)")
log(`repo ${REPO}`)
log("")

const analyzed = []
for (const subject of SUBJECTS) {
  const result = analyze(subject.path, subject)
  if (result.error !== undefined) {
    record(`subject:${subject.path}`, false, result.error)
    continue
  }
  analyzed.push({ subject, ...result })
}

const illustrative = []
let totalCitations = 0
let contentVerified = 0
let symbolOnlyVerified = 0
let lineDependentVerified = 0
let rotAnchors = 0
const rot = []
for (const entry of analyzed) {
  const failures = []
  for (const citation of entry.citations) {
    if (citation.flag !== undefined) continue
    const problem = checkCitation(citation)
    if (problem !== undefined) failures.push(`doc line ${citation.docLine}: ${problem}`)
    // T-72 arm: a LINE-BEARING anchor is verified against the claim at ITS OWN SITE. When no
    // such claim exists, the anchor's only locator is the line number — ROT: flagged, counted,
    // reported per anchor, and able to fail the run (T-72 clause (b)).
    if (citation.kind === "path" && citation.line !== undefined) {
      const claim = claimForSite(citation, entry.claims)
      if (claim === undefined) {
        rotAnchors += 1
        rot.push(`${entry.file}:${citation.docLine} ${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`)
        failures.push(`doc line ${citation.docLine}: ${lineNumberOnlyProblem(citation)}`)
      } else {
        const problem = claimContentProblem(citation, claim)
        if (problem === undefined) {
          contentVerified += 1
          lineDependentVerified += 1
        } else {
          failures.push(`doc line ${citation.docLine}: ${problem}`)
        }
      }
    }
    // T-55 SYMBOL-FIRST arm: a line-LESS path citation that carries a claim must find that claim in
    // the cited file. Before this branch the form was silently unchecked (measured: a claim naming a
    // symbol that exists nowhere still passed), which is the "gate that lies" class.
    if (citation.kind === "path" && citation.line === undefined) {
      const symbolResult = symbolOnlyClaimCheck(citation, entry.claims, citedFileText(citation))
      if (symbolResult === true) {
        contentVerified += 1
        symbolOnlyVerified += 1
      } else if (typeof symbolResult === "string") {
        failures.push(`doc line ${citation.docLine}: ${symbolResult}`)
      }
    }
  }
  const counts = { path: 0, dir: 0, command: 0 }
  for (const citation of entry.citations) if (citation.flag === undefined) counts[citation.kind] += 1
  totalCitations += entry.citations.length
  record(
    `citations:${entry.file}`,
    failures.length === 0,
    `${entry.citations.length} citation(s) (checked ${counts.path + counts.dir + counts.command}: path ${counts.path}, dir ${counts.dir}, command ${counts.command}; pending ${entry.pending.length}, illustrative ${entry.illustrative.length}), ${failures.length} unresolved${failures.length > 0 ? `: ${failures.slice(0, 6).join(" | ")}` : ""}`,
  )
  for (const citation of entry.pending) {
    const problem = checkCitation(citation)
    pending.push(`${entry.file}:${citation.docLine} ${citation.kind} ${citation.value}${citation.flagReason === "" ? "" : ` — ${citation.flagReason}`}${problem === undefined ? " (IT RESOLVES NOW: remove the pending annotation)" : ` (${problem})`}`)
  }
  for (const citation of entry.illustrative) {
    illustrative.push(`${entry.file}:${citation.docLine} ${citation.kind} ${citation.value}${citation.flagReason === "" ? "" : ` — ${citation.flagReason}`}`)
  }
}

// the documented-pending and illustrative sets are reported, never hidden
record("annotations:pending", true, pending.length === 0 ? "none" : `${pending.length} documented pending citation(s): ${pending.join(" | ")}`)
record("annotations:illustrative", true, illustrative.length === 0 ? "none" : `${illustrative.length} illustrative citation(s) (extension-root-relative, not repo paths): ${illustrative.join(" | ")}`)
record(
  "content:anchors",
  rotAnchors === 0,
  `${contentVerified} citation(s) verified against their claim: ${symbolOnlyVerified} symbol-first (line-free, whole file), ${lineDependentVerified} line-dependent (the line is a hint — rot risk); ${rotAnchors} line-number-only anchor(s) FLAGGED as rot`,
)
record("content:rot", rotAnchors === 0, rotAnchors === 0 ? "no line-number-only anchors" : `${rotAnchors} line-number-only anchor(s): ${rot.join(" | ")}`)

// ── the remaining arms (skipped by --citations-only, which the negative control uses) ──
const citationsOnly = process.argv.includes("--citations-only")
const guideEn = citationsOnly ? "" : readFileSync(join(REPO, GUIDE_EN), "utf8")
const guideZh = citationsOnly ? "" : readFileSync(join(REPO, GUIDE_ZH), "utf8")
const enHeadings = citationsOnly ? [] : headings(guideEn)
const zhHeadings = citationsOnly ? [] : headings(guideZh)
const sameTree = citationsOnly || (enHeadings.length === zhHeadings.length && enHeadings.every((entry, index) => entry.level === zhHeadings[index].level))
if (!citationsOnly) record("guide-heading-tree", sameTree, `${enHeadings.length} EN heading(s) vs ${zhHeadings.length} zh-CN heading(s), levels ${sameTree ? "identical" : "DIFFERENT"}`)

// the split is structural: no shared heading text, no shared prose line
const aiDoc = citationsOnly ? "" : readFileSync(join(REPO, AI_DOC), "utf8")
if (!citationsOnly) {
  const sharedHeadings = enHeadings.map((entry) => entry.text).filter((text) => headings(aiDoc).some((other) => other.text === text))
  record("split-headings", sharedHeadings.length === 0, sharedHeadings.length === 0 ? "no heading text is shared between the human guide and the agent contract" : `shared: ${sharedHeadings.join(" | ")}`)
  const guideProse = new Set(proseLines(guideEn))
  const sharedProse = proseLines(aiDoc).filter((line) => guideProse.has(line))
  record("split-prose", sharedProse.length === 0, sharedProse.length === 0 ? "no prose line (>= 60 chars, outside code fences) is reused" : `reused: ${sharedProse.slice(0, 3).join(" | ")}`)
}

// the agent contract's manifest skeleton must validate with the real validator
const skeleton = citationsOnly ? undefined : skeletonFromDoc()
if (citationsOnly) {
  // fixture runs assert the CITATION arms only
} else if (skeleton === undefined) {
  record("skeleton-validates", false, `no \`\`\`json block whose id is "${SKELETON_ID}" was found in ${AI_DOC}`)
} else {
  const { sandbox, root } = materializeSkeleton(skeleton.raw)
  const run = spawnSync("bun", [join(REPO, "scripts", "mpd-ext.mjs"), "validate", root], { cwd: REPO, encoding: "utf8" })
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  const ok = run.status === 0 && output.includes("loadable")
  record("skeleton-validates", ok, `the extracted manifest + the template's four assets: validate exit ${run.status}; ${output.trim().split("\n").filter((line) => line.includes("contributes:")).join(" ")}`)
  if (!ok) log(output)
  rmSync(sandbox, { recursive: true, force: true })
}

// ── the contract gates (opt-in: --gates), recorded with raw output ───────────
const gates = []
if (!citationsOnly && process.argv.includes("--gates")) {
  mkdirSync(join(OUT_ROOT, "raw"), { recursive: true })
  const specs = [
    { id: "docs-parity", command: "node scripts/verify-docs-parity.mjs", bin: "node", args: ["scripts/verify-docs-parity.mjs"], raw: "raw/gate-docs-parity.txt" },
    { id: "example-validates", command: "bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.mjs"), "validate", join(REPO, "extensions", "mpd-ext-example")], raw: "raw/gate-validate-example.txt" },
    { id: "cli-self-test", command: "bun scripts/mpd-ext.mjs --self-test", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.mjs"), "--self-test"], raw: "raw/gate-selftest.txt" },
  ]
  for (const spec of specs) {
    const run = spawnSync(spec.bin, spec.args, { cwd: REPO, encoding: "utf8" })
    const output = (run.stdout ?? "") + (run.stderr ?? "")
    writeImmutable(join(OUT_ROOT, spec.raw), output, { label: "gate raw output" })
    const evidence = output.trim().split("\n").filter((line) => line.trim() !== "").slice(-2).join(" | ")
    gates.push({ id: spec.id, command: spec.command, exitCode: run.status, status: run.status === 0 ? "passed" : "failed", evidence, raw: spec.raw })
    record(`gate:${spec.id}`, run.status === 0, `${spec.command} — exit ${run.status}; ${evidence.slice(0, 150)}`)
  }
}

// ── T-82: each run RETAINS the revision bytes it measured ────────────────────
// `checker{path,sha256,supersedes}` is the HASH view, and a hash cannot be diffed. So a run also
// COPIES the bytes it measured — its own file and the frozen revision it supersedes — into
// `<out>/revisions/` under STABLE names, so two runs of different revisions are diffable
// file-to-file: `diff <runA>/revisions/checker.mjs <runB>/revisions/checker.mjs`.
const retainedRevisions = []
function retainRevision(source, target, label) {
  if (!existsSync(source)) return
  const destination = join(OUT_ROOT, "revisions", target)
  writeImmutable(destination, readFileSync(source), { label: `retained revision (${label})` })
  retainedRevisions.push({ target: relative(REPO, destination), source: relative(REPO, source), sha256: fileHash(source), label })
}
if (!fixtureRun) {
  // A second run at the same `--out` is refused HERE, on the first retained file (exit 3), which is
  // this lane's ready-made immutability arm.
  try {
    retainRevision(fileURLToPath(import.meta.url), "checker.mjs", "the running checker")
    retainRevision(join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs"), "superseded.mjs", "the frozen revision this one supersedes")
  } catch (error) {
    exitOnRefusal(error, "[docs-claims]")
  }
}

const failed = results.filter((entry) => entry.status === "failed")
const report = {
  task: "t72 (durable home of the t21/t9 checker: SITE-PAIRED claims + SYMBOL-FIRST enforcement — a line-number-only anchor is ROT)",
  run_at: new Date().toISOString(),
  // T-78: the driver rule travels WITH the record, so a reader of the record finds it without
  // prose. Asserted against these very bytes by `negative-control:t78-record-carries-the-rule`.
  rules: {
    doc_rewrite: {
      rule: "a doc-rewrite task's verify list MUST carry the citation driver",
      command: "node scripts/check-citations.mjs --out ./evidence/gates/<slug>/<stamp>/run",
      why: "an omitted driver is not a silent state: a mis-anchored citation exits 1 with `does not carry the claim` while the correct fixture exits 0",
      parameters: {
        literal_string: "node scripts/check-citations.mjs --out",
        pattern_as_passed: "unescaped, case-sensitive, no glob",
        tool_mode: "one process, explicit --out, offline (no dsh boot)",
        unit: "one run directory (`<out>/result.json` + `output.log` + `revisions/`)",
        scope: "the five subject documents under <repo>; `--citations-only` for the citation arms alone",
        moment: "this record's `run_at` (ISO-8601 UTC)",
      },
    },
    family_boundary: {
      out_of_family: "a POSITION citation (no literal string) and a BASENAME-ONLY citation (no `/`) are OUT OF FAMILY and pass silently, by design: the family's six addressing parameters require a repo-relative literal, so this checker cannot resolve or rot them and a green run says nothing about them (t31/B2-F3).",
    },
  },
  // T-72: every run quotes WHICH revision it ran and which frozen revision it supersedes, so the
  // checker's intermediate revisions are diffable, not merely hash-comparable. T-82: the bytes
  // behind those hashes are now RETAINED under `<out>/revisions/`, so that sentence is true by
  // construction rather than by claim.
  checker: {
    path: relative(REPO, fileURLToPath(import.meta.url)),
    sha256: fileHash(fileURLToPath(import.meta.url)),
    supersedes: { path: "evidence/extensions/docs-claims/check-citations.mjs", sha256: fileHash(join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs")) },
  },
  revisions: retainedRevisions,
  // F1 (t27 repair): the hard-coded `attempt_id` (t21's, inherited from the evidence-side build) is
  // REMOVED — it stamped a FOREIGN task's attempt into every run record, including the reviewer's.
  // Revision provenance is `checker{path, sha256, supersedes}` above; a caller that wants its own
  // attempt recorded must parameterize it (no consumer reads the field: measured by grepping
  // `scripts/`, `skills/`, `packages/` for `attempt_id`).
  subjects: SUBJECTS.map((subject) => subject.path),
  citations_checked: totalCitations - pending.length - illustrative.length,
  anchored_citations_content_verified: contentVerified,
  // T-72: the two ACCEPTED forms are counted apart, because only one of them survives an edit.
  // SYMBOL-FIRST (`` `SYMBOL`, `path/file.ts` ``): verified against the WHOLE file, line-free.
  symbol_only_anchors_verified: symbolOnlyVerified,
  // LINE-DEPENDENT (`` `SYMBOL`, `path/file.ts:12` ``): still verified, and still a ROT RISK — the
  // line is a hint, so an edit that shifts the cited file can redden a correct document. Kept
  // green on purpose (acceptance (c)): the recorded citations must not be mass-re-anchored.
  line_dependent_anchors_verified: lineDependentVerified,
  // ROT: line-number-only anchors — the class this revision stops accepting (T-72 clause (b)).
  rot_line_number_only_anchors: rotAnchors,
  rot,
  citations_pending: pending.length,
  citations_illustrative: illustrative.length,
  pending,
  illustrative,
  gates,
  checks: results,
  failed: failed.map((entry) => `${entry.id}: ${entry.detail}`),
  passed: results.length - failed.length,
  total: results.length,
}
if (fixtureRun) {
  // a NEGATIVE-CONTROL child run reports on stdout only; it never writes this dir
} else {
  report.negative_control = negativeControlArms
  report.output_root = relative(REPO, OUT_ROOT)
  report.output_target = OUT_EXPLICIT ? "explicit (--out)" : "fresh timestamped run directory (immutable-by-default, T-53)"
  // T-53: this used to rewrite the canonical result.json/output.log next to the script on EVERY
  // run, so a re-run silently replaced the previous record. Now the canonical files are written
  // once, by hand, and a plain run lands in a fresh `runs/<slug>-<ts>/` directory; an explicit
  // `--out <dir>` whose files already exist is REFUSED instead of overwritten.
  try {
    writeImmutable(join(OUT_ROOT, "result.json"), JSON.stringify(report, null, 2) + "\n", { label: "run result" })
    writeImmutable(join(OUT_ROOT, "output.log"), logs.join("\n") + "\n", { label: "run log" })
  } catch (error) {
    exitOnRefusal(error, "[docs-claims]")
  }
  log("[docs-claims] evidence -> " + relative(REPO, OUT_ROOT))
}
log("")
log(`[docs-claims] ${report.passed}/${report.total} checks passed, ${failed.length} failed, ${report.citations_checked} citation(s) resolved, ${report.symbol_only_anchors_verified} symbol-first, ${report.line_dependent_anchors_verified} line-dependent, ${report.rot_line_number_only_anchors} rot-flagged, ${pending.length} pending, ${illustrative.length} illustrative`)
process.exitCode = failed.length === 0 ? 0 : 1
