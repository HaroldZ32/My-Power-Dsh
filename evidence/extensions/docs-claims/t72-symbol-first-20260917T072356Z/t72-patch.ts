#!/usr/bin/env node
// T-72: build the DURABLE checker `scripts/check-citations.mjs` from the FROZEN evidence-side
// revision by LINE-RANGE SPLICE. The 500 lines this change does not name are copied byte-for-byte
// (no retyping, no silent drift); every replacement asserts the first and last line of its range
// before it is applied, and the input's sha256 must equal the frozen revision.
//
// The frozen file (`evidence/extensions/docs-claims/check-citations.mjs`,
// sha256 dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c) is NEVER written to:
// this script reads it and writes only `scripts/check-citations.mjs`.
//
// Usage: node t72-patch.mjs [--check]   (--check prints the diff region list and writes nothing)
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const FROZEN = join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs")
const DURABLE = join(REPO, "scripts", "check-citations.mjs")
const FROZEN_SHA = "dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c"

const EDITS = [
  {
    id: "E1-header",
    from: 3,
    to: 9,
    first: "// t9 docs-claims checker — every repo path, line anchor, directory and command the",
    last: "//   node evidence/extensions/docs-claims/check-citations.mjs",
    lines: [
      "// t72 docs-claims checker — the DURABLE home of the t9/t21 checker, moved out of the evidence",
      "// tree by T-72. Every repo path, line anchor, directory and command the three adaptation",
      "// documents cite must resolve on disk, and the two docs must be structurally split rather than",
      "// cosmetically different. On top of that it ENFORCES the T-55 anchor discipline: a citation",
      "// resolves by SYMBOL, a line number is an optional HINT, and a line-number-only anchor is ROT.",
      "//",
      "// Run it with node, from anywhere:",
      "//",
      "//   node scripts/check-citations.mjs",
    ],
  },
  {
    id: "E2-crypto-import",
    from: 16,
    to: 16,
    first: 'import { spawnSync } from "node:child_process"',
    last: 'import { spawnSync } from "node:child_process"',
    lines: [
      'import { spawnSync } from "node:child_process"',
      'import { createHash } from "node:crypto"',
    ],
  },
  {
    id: "E3-import-path",
    from: 24,
    to: 24,
    first: 'import { exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp, writeImmutable } from "../../../skills/dsh-qa/scripts/lib/immutable-output.mjs"',
    last: 'import { exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp, writeImmutable } from "../../../skills/dsh-qa/scripts/lib/immutable-output.mjs"',
    lines: ['import { exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp, writeImmutable } from "../skills/dsh-qa/scripts/lib/immutable-output.mjs"'],
  },
  {
    id: "E4-output-base",
    from: 29,
    to: 29,
    first: 'const OUT_ROOT = resolveOutputDir(OUT_EXPLICIT, HERE, "run")',
    last: 'const OUT_ROOT = resolveOutputDir(OUT_EXPLICIT, HERE, "run")',
    lines: [
      "// T-72: the durable home is `<repo>/scripts`, but a plain run keeps landing in the evidence tree",
      "// that holds every earlier revision's run (`evidence/extensions/docs-claims/runs/<slug>-<ts>`), so",
      "// the durable checker's record stays comparable with the record it supersedes.",
      'const OUT_BASE = join(HERE, "..", "evidence", "extensions", "docs-claims")',
      'const OUT_ROOT = resolveOutputDir(OUT_EXPLICIT, OUT_BASE, "run")',
    ],
  },
  {
    id: "E5-repo-root",
    from: 32,
    to: 32,
    first: 'const REPO = process.env.DOCS_CLAIMS_REPO ? resolve(process.env.DOCS_CLAIMS_REPO) : resolve(HERE, "..", "..", "..")',
    last: 'const REPO = process.env.DOCS_CLAIMS_REPO ? resolve(process.env.DOCS_CLAIMS_REPO) : resolve(HERE, "..", "..", "..")',
    lines: ['const REPO = process.env.DOCS_CLAIMS_REPO ? resolve(process.env.DOCS_CLAIMS_REPO) : resolve(HERE, "..")'],
  },
  {
    id: "E6-evidence-filter",
    from: 86,
    to: 86,
    first: '    .filter((line) => line.includes("citations:") || line.includes("does not contain the claim") || line.includes("does not carry the claim"))',
    last: '    .filter((line) => line.includes("citations:") || line.includes("does not contain the claim") || line.includes("does not carry the claim"))',
    lines: [
      '    .filter((line) => line.includes("citations:") || line.includes("does not contain the claim") || line.includes("does not carry the claim") || line.includes("line-number-only anchor"))',
    ],
  },
  {
    id: "E15-file-hash",
    from: 99,
    to: 99,
    first: "}",
    last: "}",
    lines: [
      "}",
      "",
      "/** sha256 of a file, or null when it is absent — recording a revision must never kill a run. */",
      "function fileHash(absolute) {",
      "  try {",
      '    return createHash("sha256").update(readFileSync(absolute)).digest("hex")',
      "  } catch {",
      "    return null",
      "  }",
      "}",
    ],
  },
  {
    id: "E7-site-paired-claim",
    from: 214,
    to: 232,
    first: "/**",
    last: "}",
    lines: [
      "/**",
      " * T-72 — THE ANCHOR RULE, named: a citation resolves by SYMBOL (T-55), and a line number is an",
      " * optional hint, never a locator of its own.",
      " *",
      " * The r-E acceptance measured the residual as ENFORCEMENT, not extraction: `PATH_PATTERN` and",
      " * `CLAIM_PATTERN` already accept a line-less anchor, but claim matching was per (path,line) over",
      " * the WHOLE document — so a bare `path:line` was ACCEPTED whenever ANY other anchor in the same",
      " * document carried a claim for that same path:line (measured on the frozen revision: exit 0), and",
      " * the remedy this checker taught was the line-bearing form.",
      " *",
      " * The site window: a claim belongs to a citation only when it names the same path/line/endLine",
      " * AND sits within `ROT_SITE_WINDOW` lines of it (the docs wrap, so the claim may be the line",
      " * above). Measured on the recorded subjects BEFORE choosing it: 32 line-bearing path citations,",
      " * 31 claims at distance 0 and 1 at distance 1, none farther (`probe-claim-proximity.mjs`).",
      " */",
      "const ROT_SITE_WINDOW = 1",
      "",
      "/** The claim written AT THIS ANCHOR'S SITE, or undefined when the anchor carries only a line. */",
      "function claimForSite(citation, claims) {",
      "  const matching = claims.filter((entry) => entry.path === citation.value && entry.line === citation.line && entry.endLine === citation.endLine)",
      "  const atSite = matching.filter((entry) => Math.abs(entry.docLine - citation.docLine) <= ROT_SITE_WINDOW)",
      "  if (atSite.length === 0) return undefined",
      "  return atSite.sort((a, b) => Math.abs(a.docLine - citation.docLine) - Math.abs(b.docLine - citation.docLine))[0]",
      "}",
      "",
      "/**",
      " * T-72's ROT verdict: the anchor's only locator is a line number. Reported per anchor (the file,",
      " * the line and the fix) and able to fail the run — a flag that cannot redden is decoration.",
      " */",
      "function lineNumberOnlyProblem(citation) {",
      '  const span = `${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`',
      "  return `line-number-only anchor \\`${span}\\`: a line number is not a citation (T-55) — it rots as soon as the cited file is edited. Cite the symbol instead: \\`SYMBOL\\`, \\`${citation.value}\\` (no :line) resolves against the whole file.`",
      "}",
      "",
      "/**",
      " * The t21 content assertion, now SITE-BOUND: the claim at the anchor must sit on the cited",
      " * line/range. A missing claim is no longer a separate message — it is the ROT verdict above.",
      " */",
      "function claimContentProblem(citation, claim) {",
      "  const text = claimText(claim.claim)",
      "  if (text === undefined || text.length < 2) {",
      "    return `the claim \\`${claim.claim}\\` is neither a symbol nor a quoted phrase`",
      "  }",
      "  if (!citedText(citation).includes(text)) {",
      '    return `the cited line/range does not carry the claim \\`${text}\\` (${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`})`',
      "  }",
      "  return undefined",
      "}",
    ],
  },
  {
    id: "E17-run-banner",
    from: 398,
    to: 398,
    first: 'log("docs-claims checker (t21: existence + range + CONTENT claims + negative control)")',
    last: 'log("docs-claims checker (t21: existence + range + CONTENT claims + negative control)")',
    lines: ['log("docs-claims checker (t72: existence + range + SITE-PAIRED content claims + symbol-first enforcement + negative control)")'],
  },
  {
    id: "E9-counters",
    from: 416,
    to: 416,
    first: "let unclaimedAnchors = 0",
    last: "let unclaimedAnchors = 0",
    lines: [
      "let lineDependentVerified = 0",
      "let rotAnchors = 0",
      "const rot = []",
    ],
  },
  {
    id: "E8-rot-arm",
    from: 423,
    to: 431,
    first: "    // t21 CONTENT arm: every ANCHORED citation must carry a claim its target really has.",
    last: "    }",
    lines: [
      "    // T-72 arm: a LINE-BEARING anchor is verified against the claim at ITS OWN SITE. When no",
      "    // such claim exists, the anchor's only locator is the line number — ROT: flagged, counted,",
      "    // reported per anchor, and able to fail the run (T-72 clause (b)).",
      '    if (citation.kind === "path" && citation.line !== undefined) {',
      "      const claim = claimForSite(citation, entry.claims)",
      "      if (claim === undefined) {",
      "        rotAnchors += 1",
      '        rot.push(`${entry.file}:${citation.docLine} ${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`)',
      "        failures.push(`doc line ${citation.docLine}: ${lineNumberOnlyProblem(citation)}`)",
      "      } else {",
      "        const problem = claimContentProblem(citation, claim)",
      "        if (problem === undefined) {",
      "          contentVerified += 1",
      "          lineDependentVerified += 1",
      "        } else {",
      "          failures.push(`doc line ${citation.docLine}: ${problem}`)",
      "        }",
      "      }",
      "    }",
    ],
  },
  {
    id: "E11-record",
    from: 465,
    to: 465,
    first: 'record("content:anchors", unclaimedAnchors === 0, `${contentVerified} anchored citation(s) verified against their claimed symbol/phrase on the cited line; ${unclaimedAnchors} anchor(s) without a content claim`)',
    last: 'record("content:anchors", unclaimedAnchors === 0, `${contentVerified} anchored citation(s) verified against their claimed symbol/phrase on the cited line; ${unclaimedAnchors} anchor(s) without a content claim`)',
    lines: [
      "record(",
      '  "content:anchors",',
      "  rotAnchors === 0,",
      "  `${contentVerified} citation(s) verified against their claim: ${symbolOnlyVerified} symbol-first (line-free, whole file), ${lineDependentVerified} line-dependent (the line is a hint — rot risk); ${rotAnchors} line-number-only anchor(s) FLAGGED as rot`,",
      ")",
      'record("content:rot", rotAnchors === 0, rotAnchors === 0 ? "no line-number-only anchors" : `${rotAnchors} line-number-only anchor(s): ${rot.join(" | ")}`)',
    ],
  },
  {
    id: "E13-report-identity",
    from: 523,
    to: 523,
    first: '  task: "t21 (upgraded from the t9 checker: CONTENT claims + negative control)",',
    last: '  task: "t21 (upgraded from the t9 checker: CONTENT claims + negative control)",',
    lines: [
      "  task: \"t72 (durable home of the t21/t9 checker: SITE-PAIRED claims + SYMBOL-FIRST enforcement — a line-number-only anchor is ROT)\",",
      "  // T-72: every run quotes WHICH revision it ran and which frozen revision it supersedes, so the",
      "  // checker's intermediate revisions are diffable, not merely hash-comparable.",
      "  checker: {",
      '    path: relative(REPO, fileURLToPath(import.meta.url)),',
      "    sha256: fileHash(fileURLToPath(import.meta.url)),",
      '    supersedes: { path: "evidence/extensions/docs-claims/check-citations.mjs", sha256: fileHash(join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs")) },',
      "  },",
    ],
  },
  {
    id: "E16-final-log",
    from: 561,
    to: 561,
    first: 'log(`[docs-claims] ${report.passed}/${report.total} checks passed, ${failed.length} failed, ${report.citations_checked} citation(s) resolved, ${pending.length} pending, ${illustrative.length} illustrative`)',
    last: 'log(`[docs-claims] ${report.passed}/${report.total} checks passed, ${failed.length} failed, ${report.citations_checked} citation(s) resolved, ${pending.length} pending, ${illustrative.length} illustrative`)',
    lines: [
      'log(`[docs-claims] ${report.passed}/${report.total} checks passed, ${failed.length} failed, ${report.citations_checked} citation(s) resolved, ${report.symbol_only_anchors_verified} symbol-first, ${report.line_dependent_anchors_verified} line-dependent, ${report.rot_line_number_only_anchors} rot-flagged, ${pending.length} pending, ${illustrative.length} illustrative`)',
    ],
  },
  {
    id: "E10-report-counters",
    from: 528,
    to: 531,
    first: "  // T-55: how many of those used the line-LESS symbol-first form (`` `SYMBOL`, `path/file.ts` ``),",
    last: "  anchored_citations_without_a_claim: unclaimedAnchors,",
    lines: [
      "  // T-72: the two ACCEPTED forms are counted apart, because only one of them survives an edit.",
      "  // SYMBOL-FIRST (`` `SYMBOL`, `path/file.ts` ``): verified against the WHOLE file, line-free.",
      "  symbol_only_anchors_verified: symbolOnlyVerified,",
      "  // LINE-DEPENDENT (`` `SYMBOL`, `path/file.ts:12` ``): still verified, and still a ROT RISK — the",
      "  // line is a hint, so an edit that shifts the cited file can redden a correct document. Kept",
      "  // green on purpose (acceptance (c)): the recorded citations must not be mass-re-anchored.",
      "  line_dependent_anchors_verified: lineDependentVerified,",
      "  // ROT: line-number-only anchors — the class this revision stops accepting (T-72 clause (b)).",
      "  rot_line_number_only_anchors: rotAnchors,",
      "  rot,",
    ],
  },
  {
    id: "E12a-negative-control-make",
    from: 352,
    to: 364,
    first: "  const make = (anchor) => {",
    last: "  }",
    lines: [
      "  const make = (anchor, options = {}) => {",
      '    const root = mkdtempSync(join(tmpdir(), "t72-docs-claims-"))',
      '    mkdirSync(join(root, "docs"), { recursive: true })',
      '    mkdirSync(join(root, "src"), { recursive: true })',
      '    const source = options.source ?? ["// fixture", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]',
      '    writeFileSync(join(root, "src", "probe.ts"), source.join("\\n"))',
      '    const siblingAnchor = options.siblingAnchor ?? "`alphaSymbol`, `src/probe.ts:2`"',
      "    const guide = `# fixture guide\\n\\nSee ${anchor} for the constant.${options.extra === undefined ? \"\" : `\\n\\n${options.extra}`}\\n`",
      "    writeFileSync(join(root, GUIDE_EN), guide)",
      "    writeFileSync(join(root, GUIDE_ZH), guide)",
      "    writeFileSync(join(root, AI_DOC), `# fixture contract\\n\\nSee ${siblingAnchor}.\\n`)",
      "    writeFileSync(join(root, REPORT_EN), `# fixture report\\n\\n## 12. Status\\n\\nSee ${siblingAnchor}.\\n`)",
      "    writeFileSync(join(root, REPORT_ZH), `# fixture report\\n\\n## 12. Status\\n\\nSee ${siblingAnchor}.\\n`)",
      "    return root",
      "  }",
    ],
  },
  {
    id: "E12b-rot-arms",
    from: 380,
    to: 380,
    first: '  const symbolAbsent = run(make("`gammaSymbol`, `src/probe.ts`"))',
    last: '  const symbolAbsent = run(make("`gammaSymbol`, `src/probe.ts`"))',
    lines: [
      '  const symbolAbsent = run(make("`gammaSymbol`, `src/probe.ts`"))',
      "  // T-72 arms — the ROT class in the three shapes it takes, plus the positive control that makes",
      "  // the pair falsifiable. Each one must be FLAGGED:",
      "  //   bare     : the anchor's only locator is the line number;",
      "  //   shadowed : a SIBLING claim for the same path:line elsewhere in the document must NOT excuse",
      "  //              it (measured on the frozen pre-T-72 revision — this fixture exits 0 there);",
      "  //   drifted  : the line the anchor pins has MOVED because the cited file was edited — the rot",
      "  //              T-72 names, and the reason a line number is not a citation.",
      "  const shifted = [\"// fixture\", \"// a later edit inserted this line\", \"export const alphaSymbol = 1\", \"export const betaSymbol = 2\", \"\"]",
      '  const rotBare = run(make("`src/probe.ts:2`"))',
      '  const rotShadowed = run(make("`alphaSymbol`, `src/probe.ts:2`", { extra: "And `src/probe.ts:2` is cited here." }))',
      '  const rotDrifted = run(make("`src/probe.ts:2`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))',
      '  const symbolFirstShifted = run(make("`alphaSymbol`, `src/probe.ts`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))',
      "  const rotFlagged = (arm) => arm.exitCode === 1 && /line-number-only anchor/.test(arm.output)",
    ],
  },
  {
    id: "E12c-rot-arm-entries",
    from: 385,
    to: 385,
    first: '    symbolOnlyAbsent: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol ABSENT>)", exitCode: symbolAbsent.exitCode, passed: symbolAbsent.exitCode === 1 && /does not contain the claim/.test(symbolAbsent.output), evidence: reportedEvidence(symbolAbsent.output) },',
    last: '    symbolOnlyAbsent: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol ABSENT>)", exitCode: symbolAbsent.exitCode, passed: symbolAbsent.exitCode === 1 && /does not contain the claim/.test(symbolAbsent.output), evidence: reportedEvidence(symbolAbsent.output) },',
    lines: [
      '    symbolOnlyAbsent: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol ABSENT>)", exitCode: symbolAbsent.exitCode, passed: symbolAbsent.exitCode === 1 && /does not contain the claim/.test(symbolAbsent.output), evidence: reportedEvidence(symbolAbsent.output) },',
      '    rotLineOnly: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor>)", exitCode: rotBare.exitCode, passed: rotFlagged(rotBare), evidence: reportedEvidence(rotBare.output) },',
      '    rotLineOnlyShadowed: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor shadowed by a sibling claim for the same path:line>)", exitCode: rotShadowed.exitCode, passed: rotFlagged(rotShadowed), evidence: reportedEvidence(rotShadowed.output) },',
      '    rotLineOnlyDrifted: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor whose pinned line MOVED under it>)", exitCode: rotDrifted.exitCode, passed: rotFlagged(rotDrifted), evidence: reportedEvidence(rotDrifted.output) },',
      '    symbolFirstSurvivesShift: { command: "check-citations.mjs --citations-only (DOCS_CLAIMS_REPO=<symbol-first anchor, cited file shifted>)", exitCode: symbolFirstShifted.exitCode, passed: symbolFirstShifted.exitCode === 0, evidence: reportedEvidence(symbolFirstShifted.output) },',
    ],
  },
  {
    id: "E12d-rot-records",
    from: 390,
    to: 390,
    first: '  record("negative-control:symbol-first-absent", arms.symbolOnlyAbsent.passed, `${arms.symbolOnlyAbsent.command} - exit ${arms.symbolOnlyAbsent.exitCode} (T-55: an absent symbol must FAIL, not pass silently); ${arms.symbolOnlyAbsent.evidence === "" ? "NO mismatch reported" : arms.symbolOnlyAbsent.evidence}`)',
    last: '  record("negative-control:symbol-first-absent", arms.symbolOnlyAbsent.passed, `${arms.symbolOnlyAbsent.command} - exit ${arms.symbolOnlyAbsent.exitCode} (T-55: an absent symbol must FAIL, not pass silently); ${arms.symbolOnlyAbsent.evidence === "" ? "NO mismatch reported" : arms.symbolOnlyAbsent.evidence}`)',
    lines: [
      '  record("negative-control:symbol-first-absent", arms.symbolOnlyAbsent.passed, `${arms.symbolOnlyAbsent.command} - exit ${arms.symbolOnlyAbsent.exitCode} (T-55: an absent symbol must FAIL, not pass silently); ${arms.symbolOnlyAbsent.evidence === "" ? "NO mismatch reported" : arms.symbolOnlyAbsent.evidence}`)',
      '  record("negative-control:rot-line-number-only", arms.rotLineOnly.passed, `${arms.rotLineOnly.command} - exit ${arms.rotLineOnly.exitCode} (T-72: a line-number-only anchor must be FLAGGED as rot, not accepted); ${arms.rotLineOnly.evidence === "" ? "NO rot reported" : arms.rotLineOnly.evidence}`)',
      '  record("negative-control:rot-line-number-only-shadowed", arms.rotLineOnlyShadowed.passed, `${arms.rotLineOnlyShadowed.command} - exit ${arms.rotLineOnlyShadowed.exitCode} (T-72: a sibling claim for the same path:line must not excuse a line-number-only anchor at another site — the frozen pre-T-72 revision ACCEPTS this fixture, exit 0); ${arms.rotLineOnlyShadowed.evidence === "" ? "NO rot reported" : arms.rotLineOnlyShadowed.evidence}`)',
      '  record("negative-control:rot-line-number-only-drifted", arms.rotLineOnlyDrifted.passed, `${arms.rotLineOnlyDrifted.command} - exit ${arms.rotLineOnlyDrifted.exitCode} (T-72: the pinned line moved under the document — the rot the row names); ${arms.rotLineOnlyDrifted.evidence === "" ? "NO rot reported" : arms.rotLineOnlyDrifted.evidence}`)',
      '  record("negative-control:symbol-first-survives-a-source-shift", arms.symbolFirstSurvivesShift.passed, `${arms.symbolFirstSurvivesShift.command} - exit ${arms.symbolFirstSurvivesShift.exitCode} (T-55/T-72: the line-free form still resolves after the cited file moves under it — the same shift that reddens the line-only fixture)`)',
    ],
  },
]

function assertRange(lines, edit) {
  const first = lines[edit.from - 1]
  const last = lines[edit.to - 1]
  if (first !== edit.first) throw new Error(`${edit.id}: line ${edit.from} is ${JSON.stringify(first)}, expected ${JSON.stringify(edit.first)}`)
  if (last !== edit.last) throw new Error(`${edit.id}: line ${edit.to} is ${JSON.stringify(last)}, expected ${JSON.stringify(edit.last)}`)
}

const source = readFileSync(FROZEN)
const sha = createHash("sha256").update(source).digest("hex")
if (sha !== FROZEN_SHA) throw new Error(`the frozen checker is not the recorded revision: ${sha} (expected ${FROZEN_SHA})`)

const lines = source.toString("utf8").split("\n")
for (const edit of EDITS) assertRange(lines, edit)
if (process.argv.includes("--check")) {
  console.log(`t72-patch --check: the frozen revision matches ${FROZEN_SHA.slice(0, 12)}…, all ${EDITS.length} ranges assert, nothing written`)
  for (const edit of EDITS) console.log(`  ${edit.id}: lines ${edit.from}-${edit.to} → ${edit.lines.length} line(s)`)
  process.exit(0)
}
if (existsSync(DURABLE)) throw new Error(`refusing to overwrite the existing durable checker: ${DURABLE} (T-53 immutability; delete it deliberately first)`)

for (const edit of [...EDITS].sort((a, b) => b.from - a.from)) lines.splice(edit.from - 1, edit.to - edit.from + 1, ...edit.lines)
writeFileSync(DURABLE, lines.join("\n"))
console.log(`t72-patch: wrote ${DURABLE} (${lines.length} lines) from the frozen revision ${FROZEN_SHA.slice(0, 12)}…`)
