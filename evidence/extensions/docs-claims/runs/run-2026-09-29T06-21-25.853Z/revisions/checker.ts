#!/usr/bin/env node

// t72 docs-claims checker — the DURABLE home of the t9/t21 checker, moved out of the evidence
// tree by T-72. Every repo path, line anchor, directory and command the three adaptation
// documents cite must resolve on disk, and the two docs must be structurally split rather than
// cosmetically different. On top of that it ENFORCES the T-55 anchor discipline: a citation
// resolves by SYMBOL, a line number is an optional HINT, and a line-number-only anchor is ROT.
//
// Run it with node, from anywhere:
//
//   node scripts/check-citations.ts
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
//   node scripts/check-citations.ts --out ./evidence/gates/<slug>/<stamp>/run
//
// The same rule is written into EVERY run record (`rules.doc_rewrite`), so a reader of either
// surface finds it without prose. An omitted driver is not a silent state: the fixture pair in
// `--self-test` shows a mis-anchored citation exiting 1 with `does not carry the claim` while the
// correct fixture exits 0.
//
// Its addressing parameters, in the citation family's own six terms (F5): the literal string is
// `node scripts/check-citations.ts --out`; the pattern AS PASSED is unescaped and case-sensitive;
// the tool mode is one process with an explicit `--out`; the unit is one run directory; the scope
// is the five subject documents under <repo> (`--citations-only` for the citation arms alone);
// the moment is the run's own `run_at`, recorded in the record.
//
// ── MODES (wave 2b, lane B2) ────────────────────────────────────────────────────────
//   node scripts/check-citations.ts --self-test                       the citation arms
//   node scripts/check-citations.ts --driver-headers [--self-test]    T-80: a driver header's
//       `A<n>` claims vs the `add("A<n>…")` keys the driver's code produces. The live scan names
//       the directories it covers, their per-directory split and BOTH matcher-error directions.
//   node scripts/check-citations.ts --anchor-scan <dir> --pattern <literal>   T-90: report every
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
import type { SpawnSyncReturns } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"
// T-53: evidence is immutable by default — a plain run writes to a FRESH timestamped directory and
// an existing target is refused instead of overwritten (this script used to rewrite the canonical
// result.json/output.log next to itself on every run).
import { IMMUTABLE_EXIT_CODE, exitOnRefusal, refuseOverwrite, resolveOutputDir, timestamp, writeImmutable } from "../skills/dsh-qa/scripts/lib/immutable-output.ts"

/** This script's own directory (`<repo>/scripts`), the base every sibling path resolves from. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** Index of `--out` (bare or `--out=<dir>`) in argv, or -1 when the flag is absent. */
const OUT_FLAG: number = process.argv.findIndex((a: string): boolean => a === "--out" || a.startsWith("--out="))
/** The caller's explicit output directory (`--out=<dir>` or the value after `--out`); undefined when absent. */
const OUT_EXPLICIT: string | undefined = OUT_FLAG === -1 ? undefined : (process.argv[OUT_FLAG].startsWith("--out=") ? process.argv[OUT_FLAG].slice("--out=".length) : process.argv[OUT_FLAG + 1])
// T-72: the durable home is `<repo>/scripts`, but a plain run keeps landing in the evidence tree
// that holds every earlier revision's run (`evidence/extensions/docs-claims/runs/<slug>-<ts>`), so
// the durable checker's record stays comparable with the record it supersedes.
/** Evidence tree a plain run's fresh timestamped directory is created under. */
const OUT_BASE: string = join(HERE, "..", "evidence", "extensions", "docs-claims")
/** The output directory this run writes (`result.json`, `output.log`, and `revisions/`). */
const OUT_ROOT: string = resolveOutputDir(OUT_EXPLICIT, OUT_BASE, "run")
// t21: the repo root is overridable so the offline NEGATIVE CONTROL can run this SAME
// checker over a fixture repo — a deliberately mis-anchored citation must fail there.
/** The repository under audit; `DOCS_CLAIMS_REPO` points the same checker at a fixture repo. */
const REPO: string = process.env.DOCS_CLAIMS_REPO ? resolve(process.env.DOCS_CLAIMS_REPO) : resolve(HERE, "..")
/** File name the skeleton manifest must carry inside the materialized sandbox root. */
const MANIFEST_FILE: string = "mpd-ext.json"
/** Token replaced by `SKELETON_ID` in every template file name and body during materialization. */
const TEMPLATE_TOKEN: string = "mpd-extension-template"
/** Manifest id the agent contract's fenced JSON block must declare to be the skeleton. */
const SKELETON_ID: string = "for-agents-skeleton"
/** The template tree whose four assets are copied when the skeleton is materialized. */
const TEMPLATE_DIR: string = join(REPO, "templates", "mpd-extension")

/** Repo-relative path of the human-facing English extension authoring guide. */
const GUIDE_EN: string = "docs/extension-authoring-guide.md"
/** Repo-relative path of the human-facing zh-CN twin of that guide. */
const GUIDE_ZH: string = "docs/extension-authoring-guide.zh-CN.md"
/** Repo-relative path of the agent-facing extension contract `EXTENSIONS-FOR-AGENTS.md`. */
const AI_DOC: string = "EXTENSIONS-FOR-AGENTS.md"
/** Repo-relative path of the English adaptation report (only its status section is audited). */
const REPORT_EN: string = "docs/extension-adaptation-report.md"
/** Repo-relative path of the zh-CN twin of that report (only its status section is audited). */
const REPORT_ZH: string = "docs/extension-adaptation-report.zh-CN.md"
/** Matches the `## 12.` status heading a report subject is sliced at. */
const STATUS_HEADING: RegExp = /^## 12\./m

/** The three citation shapes this checker extracts from a subject document. */
type CitationKind = "path" | "dir" | "command"

/** One citation found in a subject document, with everything a verdict needs. */
interface Citation {
  /** Which family the citation belongs to. */
  readonly kind: CitationKind
  /** The cited literal (a repo-relative path, a trailing-slash directory, or a command). */
  readonly value: string
  /** 1-based first cited line, or undefined when the anchor is line-free (symbol-first form). */
  readonly line: number | undefined
  /** 1-based last cited line of a `:from-to` range, or undefined for a single line. */
  readonly endLine: number | undefined
  /** 1-based line of the DOCUMENT the citation was written on. */
  readonly docLine: number
  /** The governing `citation-check:` annotation kind (`pending` / `illustrative`), when one applies. */
  readonly flag: string | undefined
  /** The annotation's reason text; `""` when the annotation carried none. */
  readonly flagReason: string
  /** Directory of the document, the base a `./`- or `../`-spelled citation resolves from. */
  readonly base: string
}

/** One `` `claim`, `path` `` pair extracted over a subject's whole text. */
interface Claim {
  /** The claim token: a symbol name or a `"quoted phrase"` (quotes included). */
  readonly claim: string
  /** The path the claim is written beside. */
  readonly path: string
  /** 1-based cited line, or undefined when the anchor carries no line number. */
  readonly line: number | undefined
  /** 1-based end line of a range, or undefined. */
  readonly endLine: number | undefined
  /** 1-based line of the document the claim sits on (the site the anchor is paired with). */
  readonly docLine: number
  /** Directory of the document, used to resolve a `./`-spelled cited path. */
  readonly base: string
}

/** One audited subject: a document, and the section of it the citation arms read. */
interface Subject {
  /** Repo-relative path of the document. */
  readonly path: string
  /** Human label naming the document in output (never used as a key). */
  readonly label: string
  /** When set, only the text from the first match of this heading onwards is analyzed. */
  readonly from?: RegExp
  /** Declares that the sliced section must exist; carried as subject metadata. */
  readonly required?: boolean
}

/** The five subject documents, in the order their checks are recorded. */
const SUBJECTS: readonly Subject[] = [
  { path: GUIDE_EN, label: "human guide (EN)" },
  { path: GUIDE_ZH, label: "human guide (zh-CN)" },
  { path: AI_DOC, label: "agent contract" },
  { path: REPORT_EN, label: "report status section (EN)", from: STATUS_HEADING, required: true },
  { path: REPORT_ZH, label: "report status section (zh-CN)", from: STATUS_HEADING, required: true },
]

/** Directories whose trailing-slash mentions count as directory citations. */
const ROOT_DIRS: readonly string[] = ["docs/", "packages/", "skills/", "extensions/", "templates/", "scripts/", "evidence/", "presets/", "tests/", "src/"]
/** A repo-relative path literal with at least one `/`, plus its optional `:line` / `:line-line` anchor. */
const PATH_PATTERN: RegExp = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
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
const CLAIM_PATTERN: RegExp = /`([^`]+)`\s*[,，]?\s*\(?\s*`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?::(\d+)(?:[-–](\d+))?)?`/g
/** A claim token that is a bare symbol path (`name` or `a.b.c`) rather than a quoted phrase. */
const SYMBOL_CLAIM: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/
/** A claim token written as a `"quoted phrase"`; group 1 is the phrase without its quotes. */
const QUOTED_CLAIM: RegExp = /^"(.*)"$/
/** A backticked trailing-slash directory literal; only `ROOT_DIRS` prefixes are ever cited. */
const DIR_PATTERN: RegExp = /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\/)`/g
/** A `bun`/`node` command whose script path is repo-relative; matched only inside code fences. */
const COMMAND_PATTERN: RegExp = /(?:^|\s)(?:bun|node)\s+((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/g

/** One recorded check: its stable id, the verdict, and the detail quoted in the record. */
interface ResultEntry {
  /** Stable check id (`citations:<file>`, `negative-control:<arm>`, …). */
  readonly id: string
  /** `passed` / `failed`, derived from the boolean the arm returned. */
  readonly status: "passed" | "failed"
  /** The evidence line printed beside the check and carried into `result.json`. */
  readonly detail: string
}

/** Every check this run recorded, in execution order. */
const results: ResultEntry[] = []
/** The documented-pending citations, rendered one line each. */
const pending: string[] = []
/** Every line written to stdout, kept so `output.log` and the console never diverge. */
const logs: string[] = []

/** Echo one line to stdout and keep it in `logs` for the run record. */
function log(text: string): void {
  logs.push(text)
  process.stdout.write(text + "\n")
}

/** The lines a negative-control arm is judged on: the subject verdicts plus any mismatch text. */
function reportedEvidence(output: string): string {
  return output
    .split("\n")
    .filter((line: string): boolean => line.includes("citations:") || line.includes("does not contain the claim") || line.includes("does not carry the claim") || line.includes("line-number-only anchor"))
    .join(" | ")
    .slice(0, 320)
}

/** Record one check, print its verdict line, and pass the verdict back to the arm. */
function record(id: string, ok: boolean, detail: string): boolean {
  results.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`)
  return ok
}

/** Number of lines in a file (an empty file counts as one), used by the range arm. */
function lineCount(absolute: string): number {
  return readFileSync(absolute, "utf8").split("\n").length
}

/** sha256 of a file, or null when it is absent — recording a revision must never kill a run. */
function fileHash(absolute: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(absolute)).digest("hex")
  } catch {
    return null
  }
}

/** A subject's resolved analysis: citations, claims, and the two annotated buckets. */
interface SubjectAnalysis {
  /** The subject's repo-relative path. */
  readonly file: string
  /** Every citation found in the analyzed window. */
  readonly citations: Citation[]
  /** Every claim found over the analyzed text. */
  readonly claims: Claim[]
  /** The citations carrying a `pending` annotation. */
  readonly pending: Citation[]
  /** The citations carrying an `illustrative` annotation. */
  readonly illustrative: Citation[]
}

/** A subject this run could not analyze: the reason travels with the empty buckets. */
interface SubjectAnalysisError {
  /** The subject's repo-relative path. */
  readonly file: string
  /** Why the subject was skipped; recorded as a failed subject check. */
  readonly error: string
  /** Always empty: nothing was extracted. */
  readonly citations: Citation[]
  /** Always empty: nothing was extracted. */
  readonly claims: Claim[]
  /** Always empty: nothing was extracted. */
  readonly pending: Citation[]
}

/** A resolved analysis paired with the subject descriptor it was read from. */
interface AnalyzedSubject extends SubjectAnalysis {
  /** The descriptor (path, label, optional section matcher) the analysis belongs to. */
  readonly subject: Subject
}

// ── citation extraction ──────────────────────────────────────────────────────
/** Extract every citation, claim and annotated bucket of one subject, or the reason it was skipped. */
function analyze(file: string, subject: Subject): SubjectAnalysis | SubjectAnalysisError {
  /** Absolute path of the subject document inside the audited repository. */
  const absolute: string = join(REPO, file)
  if (!existsSync(absolute)) return { file, error: "missing subject file", citations: [], claims: [], pending: [] }
  /** The document's full text; `text` below is the window the arms actually read. */
  const full: string = readFileSync(absolute, "utf8")
  /** The analyzed window: the whole document, or the text from the subject's section heading on. */
  let text: string = full
  /** Lines of `full` that precede the window, so a line number stays document-relative. */
  let offset: number = 0
  if (subject.from !== undefined) {
    /** The section heading inside the document, or null when the document has none. */
    const match: RegExpExecArray | null = subject.from.exec(full)
    if (match === null) return { file, error: `no status section (${STATUS_HEADING}) found`, citations: [], claims: [], pending: [] }
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  /** The window's lines, each addressed by `offset` plus its index. */
  const lines: string[] = text.split("\n")
  /** Directory of the document: the base a `./`- or `../`-spelled citation resolves from. */
  const base: string = dirname(absolute)
  /** Citations found in this window, in document order. */
  const citations: Citation[] = []
  /** Claims found over the window's text. */
  const claims: Claim[] = []
  /** The `citation-check:` annotation that governs the NEXT non-fenced line, if any. */
  let nextFlag: string | undefined
  /** The reason text belonging to `nextFlag`; `""` when the annotation carried none. */
  let nextFlagReason: string = ""
  /** The annotation captured when the CURRENT fenced block opened; it governs the block's lines. */
  let fenceFlag: string | undefined
  /** The reason text belonging to `fenceFlag`. */
  let fenceFlagReason: string = ""
  /** Whether the current line sits inside a ``` fenced code block. */
  let inFence: boolean = false
  lines.forEach((line: string, index: number): void => {
    /** The 1-based line number this line has in the DOCUMENT (not in the sliced window). */
    const docLine: number = offset + index + 1
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
    /** The annotation governing this line: the fence's, or the one pending above it. */
    const flag: string | undefined = inFence ? fenceFlag : nextFlag
    /** The reason text attached to `flag`. */
    const flagReason: string = inFence ? fenceFlagReason : nextFlagReason
    if (!inFence) {
      nextFlag = undefined
      nextFlagReason = ""
      /** A `<!-- citation-check: pending|illustrative ... -->` annotation on this line, or null. */
      const annotation: RegExpExecArray | null = /citation-check:\s*(pending|illustrative)\s*:?\s*(.*?)\s*-->/.exec(line)
      if (annotation !== null) {
        nextFlag = annotation[1]
        nextFlagReason = annotation[2]
      }
    }
    /** Append one citation, stamped with this line's document position and the governing flag. */
    const add = (kind: CitationKind, value: string, startLine?: number, endLine?: number): void => {
      citations.push({ kind, value, line: startLine, endLine, docLine, flag, flagReason, base })
    }
    for (const match of line.matchAll(PATH_PATTERN)) {
      add("path", match[1], match[2] === undefined ? undefined : Number(match[2]), match[3] === undefined ? undefined : Number(match[3]))
    }
    for (const match of line.matchAll(DIR_PATTERN)) if (ROOT_DIRS.some((root: string): boolean => match[1].startsWith(root))) add("dir", match[1])
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
    pending: citations.filter((entry: Citation): boolean => entry.flag === "pending"),
    illustrative: citations.filter((entry: Citation): boolean => entry.flag === "illustrative"),
  }
}

/** The existence/range verdict for one citation: undefined when it resolves, else the reason. */
function checkCitation(citation: Citation): string | undefined {
  /** Absolute path the citation points at (`./`/`../` resolve from the document, else from the root). */
  const target: string = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  /** The path as the failure messages quote it; the literal is kept when it is root-relative already. */
  const shown: string = relative(REPO, target) === "" ? citation.value : relative(REPO, target)
  if (!existsSync(target)) return `${shown} does not exist`
  if (citation.kind === "dir" && !statSync(target).isDirectory()) return `${shown} is not a directory`
  if (citation.kind === "path" && statSync(target).isDirectory()) return `${shown} is a directory, not a file`
  if (citation.line !== undefined) {
    /** Total line count of the cited file, the bound both range ends are checked against. */
    const total: number = lineCount(target)
    if (citation.line > total || citation.line < 1) return `${shown}:${citation.line} is outside the file (${total} lines)`
    if (citation.endLine !== undefined && (citation.endLine > total || citation.endLine < citation.line)) {
      return `${shown}:${citation.line}-${citation.endLine} is outside the file (${total} lines)`
    }
  }
  return undefined
}

// ── CONTENT: does the cited line actually carry the cited symbol? ────────────

/** Is this claim token a symbol or a quoted phrase (never a path or a command)? */
function claimText(claim: string): string | undefined {
  /** The quoted phrase a `"..."` claim carries, or null when the claim is not quoted. */
  const quoted: RegExpExecArray | null = QUOTED_CLAIM.exec(claim)
  if (quoted !== null) return quoted[1]
  if (SYMBOL_CLAIM.test(claim)) return claim
  return undefined
}

/** The text of the cited line (or the whole cited range) on disk. */
function citedText(citation: Citation): string {
  /** Absolute path of the cited target, resolved exactly as the existence arm resolves it. */
  const target: string = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  if (!existsSync(target) || statSync(target).isDirectory()) return ""
  /** The cited file's lines, indexed by 1-based line number below. */
  const lines: string[] = readFileSync(target, "utf8").split("\n")
  // Every call site reaches this arm only after proving `citation.line !== undefined`, so the
  // assertion below cannot fail; the property itself stays optional for the line-free form.
  /** The first cited line (always present for this arm's callers). */
  const from: number = citation.line!
  /** The last cited line: the range end when one was cited, else the single cited line. */
  const to: number = citation.endLine ?? from
  return lines.slice(from - 1, to).join("\n")
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
const ROT_SITE_WINDOW: number = 1

/** The claim written AT THIS ANCHOR'S SITE, or undefined when the anchor carries only a line. */
function claimForSite(citation: Citation, claims: readonly Claim[]): Claim | undefined {
  /** The claims naming this anchor's exact path and line/range. */
  const matching: Claim[] = claims.filter((entry: Claim): boolean => entry.path === citation.value && entry.line === citation.line && entry.endLine === citation.endLine)
  /** The subset of those claims written within `ROT_SITE_WINDOW` lines of the anchor. */
  const atSite: Claim[] = matching.filter((entry: Claim): boolean => Math.abs(entry.docLine - citation.docLine) <= ROT_SITE_WINDOW)
  if (atSite.length === 0) return undefined
  return atSite.sort((a: Claim, b: Claim): number => Math.abs(a.docLine - citation.docLine) - Math.abs(b.docLine - citation.docLine))[0]
}

/**
 * T-72's ROT verdict: the anchor's only locator is a line number. Reported per anchor (the file,
 * the line and the fix) and able to fail the run — a flag that cannot redden is decoration.
 */
function lineNumberOnlyProblem(citation: Citation): string {
  /** The anchor as the verdict quotes it (`path:line`, or `path:line-endLine` for a range). */
  const span: string = `${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`
  return `line-number-only anchor \`${span}\`: a line number is not a citation (T-55) — it rots as soon as the cited file is edited. Cite the symbol instead: \`SYMBOL\`, \`${citation.value}\` (no :line) resolves against the whole file.`
}

/**
 * The t21 content assertion, now SITE-BOUND: the claim at the anchor must sit on the cited
 * line/range. A missing claim is no longer a separate message — it is the ROT verdict above.
 */
function claimContentProblem(citation: Citation, claim: Claim): string | undefined {
  /** The claim's text (symbol or phrase), or undefined when the token is neither. */
  const text: string | undefined = claimText(claim.claim)
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
function symbolOnlyClaimCheck(citation: Citation, claims: readonly Claim[], fileText: string): string | true | null {
  /** Every line-free claim naming this citation's path (the fallback set). */
  const forPath: Claim[] = claims.filter((entry: Claim): boolean => entry.path === citation.value && entry.line === undefined && entry.endLine === undefined)
  if (forPath.length === 0) return null
  // F3: the anchor's OWN claim wins; a far claim is only the fallback for an anchor that has none.
  /** The claim that judges this anchor: the one at its own site, else the first line-free one. */
  const claim: Claim = claimForSite(citation, claims) ?? forPath[0]
  /** The claim's text (symbol or phrase), or undefined when the token is neither. */
  const text: string | undefined = claimText(claim.claim)
  if (text === undefined || text.length < 2) {
    return `the claim \`${claim.claim}\` is neither a symbol nor a quoted phrase`
  }
  if (!fileText.includes(text)) {
    return `the cited file does not contain the claim \`${text}\` (${citation.value}) — cite a symbol the cited file declares (T-55), or drop the claim if this anchor is a plain path reference`
  }
  return true
}

/** Whole-file text of a citation's target ("" when missing/unreadable/not a file). */
function citedFileText(citation: Citation): string {
  /** Absolute path of the cited target, resolved exactly as the existence arm resolves it. */
  const target: string = citation.value.startsWith("./") || citation.value.startsWith("../") ? resolve(citation.base, citation.value) : join(REPO, citation.value)
  if (!existsSync(target) || statSync(target).isDirectory()) return ""
  try {
    return readFileSync(target, "utf8")
  } catch {
    return ""
  }
}

// ── structural split ─────────────────────────────────────────────────────────
/** One markdown heading: its nesting level and its text, used by the structural-split arms. */
interface Heading {
  /** Number of leading `#` characters, i.e. the nesting level. */
  readonly level: number
  /** The heading text with the hashes stripped and the remainder trimmed. */
  readonly text: string
}

/** Every heading outside a code fence, in document order (fence contents are not structure). */
function headings(text: string): Heading[] {
  /** The headings found so far, in document order. */
  const out: Heading[] = []
  /** Whether the current line sits inside a ``` fenced block. */
  let inFence: boolean = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    // The guard proves the line opens with `#`, so the level match below cannot be null.
    if (/^#{1,6}\s/.test(line)) out.push({ level: line.match(/^#+/)![0].length, text: line.replace(/^#+\s*/, "").trim() })
  }
  return out
}

/** Every prose line (>= 60 chars, outside fences, not a table row), used by the split arm. */
function proseLines(text: string): string[] {
  /** The prose lines found so far, in document order. */
  const out: string[] = []
  /** Whether the current line sits inside a ``` fenced block. */
  let inFence: boolean = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    /** The line without its surrounding whitespace. */
    const trimmed: string = line.trim()
    if (trimmed.length >= 60 && !trimmed.startsWith("|")) out.push(trimmed)
  }
  return out
}

// ── the skeleton: materialize the doc's manifest and validate it ─────────────
/** A parsed skeleton manifest: the checker reads only the `id` that identifies the block. */
interface SkeletonManifest {
  /** The manifest id the block declares; only `SKELETON_ID` is accepted. */
  readonly id?: string
}

/** The agent contract's skeleton block: its raw JSON text and its parsed document. */
interface Skeleton {
  /** The fenced block's raw JSON text, written to `<sandbox>/<SKELETON_ID>/mpd-ext.json`. */
  readonly raw: string
  /** The parsed block, or null when the fenced body is the JSON literal `null`. */
  readonly parsed: SkeletonManifest | null
}

/** The temp tree a materialized skeleton lives in, removed by the caller once validated. */
interface MaterializedSkeleton {
  /** The temp sandbox (the root's parent) the caller removes when the arm is done. */
  readonly sandbox: string
  /** The materialized extension root the validator is pointed at. */
  readonly root: string
}

/** Find the fenced ```json block whose `id` is `SKELETON_ID`, or undefined when there is none. */
function skeletonFromDoc(): Skeleton | undefined {
  /** The agent contract's text — the only document a skeleton block may live in. */
  const text: string = readFileSync(join(REPO, AI_DOC), "utf8")
  /** Every fenced ```json block of that text, in document order. */
  const blocks: RegExpMatchArray[] = [...text.matchAll(/```json\n([\s\S]*?)```/g)]
  for (const block of blocks) {
    try {
      // `JSON.parse` returns `any`; the cast below is the document boundary — the block's shape is
      // unknowable to the compiler and only `id` is read (a JSON body of `null` stays possible).
      /** The parsed block, or null when the block is the JSON literal `null`. */
      const parsed: SkeletonManifest | null = JSON.parse(block[1]) as SkeletonManifest | null
      if (parsed?.id === SKELETON_ID) return { raw: block[1], parsed }
    } catch {
      continue
    }
  }
  return undefined
}

/** Copy the template tree into a temp root under the skeleton id, then write the extracted manifest. */
function materializeSkeleton(raw: string): MaterializedSkeleton {
  /** The temp sandbox holding the materialized extension tree. */
  const sandbox: string = mkdtempSync(join(tmpdir(), "t9-docs-claims-"))
  /** The materialized extension root, named by the skeleton id inside that sandbox. */
  const root: string = join(sandbox, SKELETON_ID)
  mkdirSync(root, { recursive: true })
  /** Copy one template subtree, renaming the template token in every path segment and text asset. */
  const copy = (sourceRoot: string, relativeDir: string): void => {
    for (const entry of readdirSync(join(sourceRoot, relativeDir), { withFileTypes: true })) {
      /** The entry's path relative to the source root (the entry name at the top level). */
      const child: string = relativeDir === "" ? entry.name : join(relativeDir, entry.name)
      /** That relative path with every `TEMPLATE_TOKEN` path segment renamed to the skeleton id. */
      const renamed: string = child
        .split(sep)
        .map((segment: string): string => segment.split(TEMPLATE_TOKEN).join(SKELETON_ID))
        .join(sep)
      if (entry.isDirectory()) {
        mkdirSync(join(root, renamed), { recursive: true })
        copy(sourceRoot, child)
        continue
      }
      /** The template file's body, read before the token rewrite below. */
      const body: string = readFileSync(join(sourceRoot, child), "utf8")
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
/** One fixture arm's recorded outcome: the command, the exit code and the evidence it judged. */
interface FixtureArm {
  /** The command shape a reader re-runs to reproduce this arm. */
  readonly command: string
  /** The child's exit status, or null when it was killed by a signal. */
  readonly exitCode: number | null
  /** Whether this arm's own assertion held. */
  readonly passed: boolean
  /** The child output this arm judged (mismatch text, or a one-line summary). */
  readonly evidence: string
}

/** Fixture knobs of the negative-control maker, so one function serves every anchored arm. */
interface FixtureOptions {
  /** The cited file's lines; defaults to a two-constant probe file. */
  readonly source?: string[]
  /** The anchor the OTHER subjects carry, so only the subject under test decides the verdict. */
  readonly siblingAnchor?: string
  /** Extra guide text, used by the shadowed-claim and F3 arms. */
  readonly extra?: string
}

/** One fixture child run: its exit status and its combined output. */
interface FixtureRunResult {
  /** Exit status, or null when the child was killed by a signal. */
  readonly exitCode: number | null
  /** Combined stdout + stderr, the evidence every arm quotes. */
  readonly output: string
}

/** The first line at which two revisions differ, with both sides quoted (each truncated to 80). */
interface FirstDifferingLine {
  /** 1-based line number of the difference. */
  readonly line: number
  /** The left revision's line, truncated to 80 characters. */
  readonly left: string
  /** The right revision's line, truncated to 80 characters. */
  readonly right: string
}

/** Which of the four retained revision files a two-run copy arm produced. */
interface RetainedPresence {
  /** Whether run A retained its copy of the checker. */
  readonly runA_checker: boolean
  /** Whether run B retained its copy of the checker. */
  readonly runB_checker: boolean
  /** Whether run A retained the frozen fixture revision. */
  readonly runA_superseded: boolean
  /** Whether run B retained the frozen fixture revision. */
  readonly runB_superseded: boolean
}

/** The T-82 retention measurement: what the two copy runs retained and how the pairs diff. */
interface RetentionArmResult {
  /** Exit status of each copy run, in run order (A then B). */
  readonly exitCodes: readonly (number | null)[]
  /** Which of the four retained revision files exist. */
  readonly retained: RetainedPresence
  /** How the CHANGED pair differs; non-null is the arm's positive signal. */
  readonly changed_pair: FirstDifferingLine | null
  /** How the UNCHANGED pair differs; null (an empty diff) is the anti-fake control. */
  readonly unchanged_pair: FirstDifferingLine | null
  /** The arm's verdict: both pairs retained, the changed pair names CHANGE B, the control is empty. */
  readonly passed: boolean
}

/** T-78's measurement: the record a real `--out` run wrote and whether its BYTES carry the rule. */
interface RuleRecordArm {
  /** The first run's exit status. */
  readonly exitCode: number | null
  /** Whether the record BYTES carry both the driver rule and the command. */
  readonly passed: boolean
  /** Repo-relative path of the record the arm read back. */
  readonly record: string
  /** Size of that record in bytes. */
  readonly bytes: number
  /** The driver rule the record must carry. */
  readonly rule: string
  /** The command the record must carry. */
  readonly command: string
}

/** The immutability arm: a SECOND run at the same `--out` must be refused. */
interface ImmutabilityArm {
  /** The second run's exit status (expected `IMMUTABLE_EXIT_CODE`). */
  readonly exitCode: number | null
  /** Whether the refusal happened with the documented code and sentence. */
  readonly passed: boolean
  /** The first line of the second run's output. */
  readonly message: string
}

/** The wave-2b arms' raw measurements: real runs into temp dirs, then their bytes read back. */
interface Wave2bArms {
  /** T-78: the record bytes and the rule/command they must carry. */
  readonly t78: RuleRecordArm
  /** T-82: the two-copy-run retention measurement. */
  readonly t82: RetentionArmResult
  /** Immutability: the refused second run at the same `--out`. */
  readonly immutability: ImmutabilityArm
}

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
function retentionArm(sandbox: string): RetentionArmResult {
  /** The scratch repo root: the copy runs FROM here, so its `REPO` resolves to this tree. */
  const root: string = join(sandbox, "t82-root")
  for (const dir of ["docs", "src", "copydir", join("evidence", "extensions", "docs-claims")]) mkdirSync(join(root, dir), { recursive: true })
  // the copy runs from `<root>/copydir/`, so its `../skills/...` import needs `<root>/skills`
  symlinkSync(join(REPO, "skills"), join(root, "skills"), "junction")
  /** The fixture guide body, cited by both `docs/extension-authoring-guide*` twins. */
  const guide: string = "# fixture guide\n\nSee `alphaSymbol`, `src/probe.ts`.\n"
  /** The fixture report body, carrying the `## 12.` heading the report subjects slice at. */
  const report: string = "# fixture report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts`.\n"
  writeFileSync(join(root, "docs", "extension-authoring-guide.md"), guide)
  writeFileSync(join(root, "docs", "extension-authoring-guide.zh-CN.md"), guide)
  writeFileSync(join(root, "docs", "extension-adaptation-report.md"), report)
  writeFileSync(join(root, "docs", "extension-adaptation-report.zh-CN.md"), report)
  writeFileSync(join(root, "EXTENSIONS-FOR-AGENTS.md"), "# fixture contract\n\nSee `alphaSymbol`, `src/probe.ts`.\n")
  writeFileSync(join(root, "src", "probe.ts"), "// fixture\nexport const alphaSymbol = 1\n")
  writeFileSync(join(root, "evidence", "extensions", "docs-claims", "check-citations.ts"), "// FROZEN fixture revision — identical in both runs (the unchanged pair)\nexport const frozen = true\n")
  /** The checker copy both runs execute; it keeps the `.ts` name so node strips its types. */
  const copy: string = join(root, "copydir", "checker.ts")
  // The checker imports the scripts' shared primitives (`./lib/repo.ts`). The copy runs from
  // `<root>/copydir/`, so that sibling must exist there too — otherwise the child dies on the
  // import and the arm reads "NO DIFF" for a reason the retention rule is not about.
  mkdirSync(join(root, "copydir", "lib"), { recursive: true })
  copyFileSync(join(REPO, "scripts", "lib", "repo.ts"), join(root, "copydir", "lib", "repo.ts"))
  /** This checker's own source, read once — the two runs differ by one inserted marker line. */
  const original: string = readFileSync(fileURLToPath(import.meta.url), "utf8")
  /** Spawn one copy run at `out`; the copy's cwd is the scratch root, so its REPO is that tree. */
  const runCopy = (out: string): SpawnSyncReturns<string> => spawnSync(process.execPath, [copy, "--citations-only", "--out", out], { encoding: "utf8", cwd: root })
  writeFileSync(copy, original.replace("#!/usr/bin/env node", "#!/usr/bin/env node\n// T-82 ARM CHANGE A"))
  /** The first copy run: the changed pair's LEFT side. */
  const runA: SpawnSyncReturns<string> = runCopy(join(root, "runA"))
  writeFileSync(copy, original.replace("#!/usr/bin/env node", "#!/usr/bin/env node\n// T-82 ARM CHANGE B"))
  /** The second copy run: the changed pair's RIGHT side. */
  const runB: SpawnSyncReturns<string> = runCopy(join(root, "runB"))
  /** Read a retained revision file, or null when that run did not retain it. */
  const readOrNull = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null)
  /** The first line at which two revisions differ, quoting both sides; null when identical. */
  const firstDifferingLine = (left: string | null, right: string | null): FirstDifferingLine | null => {
    if (left === null || right === null) return null
    /** The left revision split into lines. */
    const leftLines: string[] = left.split("\n")
    /** The right revision split into lines. */
    const rightLines: string[] = right.split("\n")
    for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
      if (leftLines[index] !== rightLines[index]) return { line: index + 1, left: String(leftLines[index]).slice(0, 80), right: String(rightLines[index]).slice(0, 80) }
    }
    return null
  }
  /** Run A's retained checker copy (the changed pair's left side). */
  const checkerA: string | null = readOrNull(join(root, "runA", "revisions", "checker.ts"))
  /** Run B's retained checker copy (the changed pair's right side). */
  const checkerB: string | null = readOrNull(join(root, "runB", "revisions", "checker.ts"))
  /** Run A's retained frozen revision (the unchanged pair's left side). */
  const supersededA: string | null = readOrNull(join(root, "runA", "revisions", "superseded.ts"))
  /** Run B's retained frozen revision (the unchanged pair's right side). */
  const supersededB: string | null = readOrNull(join(root, "runB", "revisions", "superseded.ts"))
  /** How the CHANGED pair differs — non-null is what the arm asserts. */
  const changed: FirstDifferingLine | null = firstDifferingLine(checkerA, checkerB)
  /** How the UNCHANGED pair differs — null (an empty diff) is the anti-fake control. */
  const unchanged: FirstDifferingLine | null = firstDifferingLine(supersededA, supersededB)
  return {
    exitCodes: [runA.status, runB.status],
    retained: { runA_checker: checkerA !== null, runB_checker: checkerB !== null, runA_superseded: supersededA !== null, runB_superseded: supersededB !== null },
    changed_pair: changed,
    unchanged_pair: unchanged,
    passed: checkerA !== null && checkerB !== null && supersededA !== null && supersededB !== null && changed !== null && String(changed.right).includes("T-82 ARM CHANGE B") && unchanged === null,
  }
}

/** The wave-2b measurements, taken by real child runs and then read back as bytes. */
function wave2bArms(): Wave2bArms {
  /** The scratch dir both wave-2b arms write into. */
  const sandbox: string = mkdtempSync(join(tmpdir(), "t78-t82-arms-"))
  /** The argv a child run of THIS checker is spawned with (its `--out` is the arm's temp dir). */
  const argumentsFor = (out: string): string[] => [fileURLToPath(import.meta.url), "--citations-only", "--out", out]
  /** The T-78 arm's output directory. */
  const t78Out: string = join(sandbox, "t78-run")
  /** The T-78 first run: a real record must land at `t78Out`. */
  const first: SpawnSyncReturns<string> = spawnSync(process.execPath, argumentsFor(t78Out), { encoding: "utf8", cwd: REPO })
  /** The record the first run wrote — the bytes the T-78 assertion is made against. */
  const recordPath: string = join(t78Out, "result.json")
  /** Those record bytes, or "" when the run wrote no record. */
  const recordBytes: string = existsSync(recordPath) ? readFileSync(recordPath, "utf8") : ""
  /** The driver rule every run record must carry (T-78). */
  const RULE: string = "a doc-rewrite task's verify list MUST carry the citation driver"
  /** The exact command that rule prescribes — path-qualified, offline and deterministic. */
  const COMMAND: string = "node scripts/check-citations.ts --out ./evidence/gates/<slug>/<stamp>/run"
  /** The T-78 second run at the SAME `--out`: the immutability arm's subject. */
  const second: SpawnSyncReturns<string> = spawnSync(process.execPath, argumentsFor(t78Out), { encoding: "utf8", cwd: REPO })
  /** The second run's combined output, searched for the refusal sentence. */
  const secondOutput: string = (second.stdout ?? "") + (second.stderr ?? "")
  /** The T-82 copy-run retention measurement. */
  const t82: RetentionArmResult = retentionArm(sandbox)
  rmSync(sandbox, { recursive: true, force: true })
  return {
    t78: { exitCode: first.status, passed: recordBytes.includes(RULE) && recordBytes.includes(COMMAND), record: relative(REPO, recordPath), bytes: recordBytes.length, rule: RULE, command: COMMAND },
    t82,
    immutability: { exitCode: second.status, passed: second.status === IMMUTABLE_EXIT_CODE && /refusing to overwrite/.test(secondOutput), message: secondOutput.trim().split("\n")[0]?.slice(0, 160) ?? "" },
  }
}

/** The offline citation arms: the positive controls, the T-55 forms, the T-72 ROT class and wave-2b. */
function negativeControl(): Record<string, FixtureArm> {
  // `anchor` is the WHOLE inline anchor clause, so one maker serves the line-anchored arms and the
  // T-55 symbol-first arms (a claim with no line number).
  /** Build one fixture repo: the five subject documents, the cited source file, and the anchor. */
  const make = (anchor: string, options: FixtureOptions = {}): string => {
    /** The fixture repository root this arm is run against. */
    const root: string = mkdtempSync(join(tmpdir(), "t72-docs-claims-"))
    mkdirSync(join(root, "docs"), { recursive: true })
    mkdirSync(join(root, "src"), { recursive: true })
    /** The cited file's lines; the shifted variant inserts a line so a pinned anchor rots. */
    const source: string[] = options.source ?? ["// fixture", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]
    writeFileSync(join(root, "src", "probe.ts"), source.join("\n"))
    /** The anchor the SIBLING subjects carry, so only the subject under test decides the verdict. */
    const siblingAnchor: string = options.siblingAnchor ?? "`alphaSymbol`, `src/probe.ts:2`"
    /** The guide body: the anchor under test, plus any extra text the arm appends. */
    const guide: string = `# fixture guide\n\nSee ${anchor} for the constant.${options.extra === undefined ? "" : `\n\n${options.extra}`}\n`
    writeFileSync(join(root, GUIDE_EN), guide)
    writeFileSync(join(root, GUIDE_ZH), guide)
    writeFileSync(join(root, AI_DOC), `# fixture contract\n\nSee ${siblingAnchor}.\n`)
    writeFileSync(join(root, REPORT_EN), `# fixture report\n\n## 12. Status\n\nSee ${siblingAnchor}.\n`)
    writeFileSync(join(root, REPORT_ZH), `# fixture report\n\n## 12. Status\n\nSee ${siblingAnchor}.\n`)
    return root
  }
  /** Run the checker over one fixture root as a child; `DOCS_CLAIMS_REPO` keeps it record-free. */
  const run = (root: string): FixtureRunResult => {
    /** The child run over the fixture repo; `DOCS_CLAIMS_REPO` makes it a fixture run. */
    const child: SpawnSyncReturns<string> = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--citations-only"], {
      encoding: "utf8",
      env: { ...process.env, DOCS_CLAIMS_REPO: root },
    })
    /** The child's combined output, the evidence every arm quotes. */
    const output: string = (child.stdout ?? "") + (child.stderr ?? "")
    rmSync(root, { recursive: true, force: true })
    return { exitCode: child.status, output }
  }
  /** The positive control: a claim written ON the cited line must pass. */
  const green: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts:2`"))
  /** The content arm: the same claim one line off the anchor must FAIL and name the missing claim. */
  const red: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts:3`"))
  // T-55 arms: the symbol-FIRST form must be ACCEPTED when the file carries the symbol and must
  // FAIL when it does not. Measured before this pair existed: the absent-symbol fixture exited 0,
  // i.e. the form was accepted but silently unchecked.
  /** The symbol-first form's positive control: the line-free anchor names a declared symbol. */
  const symbolPresent: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts`"))
  /** The symbol-first form's negative control: `gammaSymbol` exists in no file, so it must FAIL. */
  const symbolAbsent: FixtureRunResult = run(make("`gammaSymbol`, `src/probe.ts`"))
  // T-72 arms — the ROT class in the three shapes it takes, plus the positive control that makes
  // the pair falsifiable. Each one must be FLAGGED:
  //   bare     : the anchor's only locator is the line number;
  //   shadowed : a SIBLING claim for the same path:line elsewhere in the document must NOT excuse
  //              it (measured on the frozen pre-T-72 revision — this fixture exits 0 there);
  //   drifted  : the line the anchor pins has MOVED because the cited file was edited — the rot
  //              T-72 names, and the reason a line number is not a citation.
  /** The cited file with one inserted line, so a pinned `:2` points at the wrong source line. */
  const shifted: string[] = ["// fixture", "// a later edit inserted this line", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]
  /** Rot in its BARE shape: the anchor's only locator is the line number. */
  const rotBare: FixtureRunResult = run(make("`src/probe.ts:2`"))
  /** Rot SHADOWED: a sibling claim for the same path:line must not excuse an anchor at another site. */
  const rotShadowed: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts:2`", { extra: "And `src/probe.ts:2` is cited here." }))
  /** Rot DRIFTED: the pinned line moved under the document when the cited file was edited. */
  const rotDrifted: FixtureRunResult = run(make("`src/probe.ts:2`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))
  /** The positive control for that shift: the line-free form must stay green when the file moves. */
  const symbolFirstShifted: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts`", { source: shifted, siblingAnchor: "`alphaSymbol`, `src/probe.ts`" }))
  // F3 (t27): a WRONG symbol-first claim must be rejected even when an EARLIER line-free claim for the
  // same path exists. This is the t17 reviewer's `symbol-first-right-then-wrong` fixture shape — their
  // arm set measured it ACCEPTED (exit 0) on the frozen revision AND on the pre-repair durable one;
  // this shipped arm is the closure's control.
  /** F3's control: a correct claim first, then a WRONG one for the same path, must still fail. */
  const symbolFirstRightThenWrong: FixtureRunResult = run(make("`alphaSymbol`, `src/probe.ts`", { extra: "And `gammaSymbol`, `src/probe.ts` is the other one." }))
  /** The ROT verdict shape: exit 1 AND the rot sentence printed. */
  const rotFlagged = (arm: FixtureRunResult): boolean => arm.exitCode === 1 && /line-number-only anchor/.test(arm.output)
  /** The symbol-first failure shape: exit 1 AND the missing-claim sentence printed. */
  const symbolFirstClaimFlagged = (arm: FixtureRunResult): boolean => arm.exitCode === 1 && /does not contain the claim/.test(arm.output)
  /** Every citation arm's outcome, keyed by the arm id the record publishes. */
  const arms: Record<string, FixtureArm> = {
    green: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<correct fixture>)", exitCode: green.exitCode, passed: green.exitCode === 0, evidence: green.output.trim().split("\n").filter((line: string): boolean => line.includes("citations:")).join(" | ").slice(0, 200) },
    red: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<mis-anchored fixture>)", exitCode: red.exitCode, passed: red.exitCode === 1 && /does not carry the claim/.test(red.output), evidence: red.output.trim().split("\n").filter((line: string): boolean => line.includes("does not carry the claim")).join(" | ").slice(0, 300) },
    symbolOnlyPresent: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol present>)", exitCode: symbolPresent.exitCode, passed: symbolPresent.exitCode === 0, evidence: reportedEvidence(symbolPresent.output) },
    symbolOnlyAbsent: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<symbol-first, symbol ABSENT>)", exitCode: symbolAbsent.exitCode, passed: symbolAbsent.exitCode === 1 && /does not contain the claim/.test(symbolAbsent.output), evidence: reportedEvidence(symbolAbsent.output) },
    rotLineOnly: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor>)", exitCode: rotBare.exitCode, passed: rotFlagged(rotBare), evidence: reportedEvidence(rotBare.output) },
    rotLineOnlyShadowed: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor shadowed by a sibling claim for the same path:line>)", exitCode: rotShadowed.exitCode, passed: rotFlagged(rotShadowed), evidence: reportedEvidence(rotShadowed.output) },
    rotLineOnlyDrifted: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<line-number-only anchor whose pinned line MOVED under it>)", exitCode: rotDrifted.exitCode, passed: rotFlagged(rotDrifted), evidence: reportedEvidence(rotDrifted.output) },
    symbolFirstSurvivesShift: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<symbol-first anchor, cited file shifted>)", exitCode: symbolFirstShifted.exitCode, passed: symbolFirstShifted.exitCode === 0, evidence: reportedEvidence(symbolFirstShifted.output) },
    symbolFirstRightThenWrong: { command: "check-citations.ts --citations-only (DOCS_CLAIMS_REPO=<symbol-first: correct claim first, WRONG claim later for the same path>)", exitCode: symbolFirstRightThenWrong.exitCode, passed: symbolFirstClaimFlagged(symbolFirstRightThenWrong), evidence: reportedEvidence(symbolFirstRightThenWrong.output) },
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
  /** The wave-2b measurements: the record bytes, the retention diff and the refused second run. */
  const wave2b: Wave2bArms = wave2bArms()
  arms.t78RecordCarriesTheRule = { command: "check-citations.ts --citations-only --out <tmp>; the record's BYTES are read back", exitCode: wave2b.t78.exitCode, passed: wave2b.t78.passed, evidence: `${wave2b.t78.record} (${wave2b.t78.bytes} B) carries the RULE and the COMMAND` }
  arms.t82RetentionDiffable = { command: "a COPY of the checker runs twice with a one-line change between the runs; the retained revisions are diffed", exitCode: wave2b.t82.exitCodes[1], passed: wave2b.t82.passed, evidence: `changed pair differs at line ${wave2b.t82.changed_pair?.line ?? "?"} (${wave2b.t82.changed_pair?.right ?? "NO DIFF"}); unchanged pair ${wave2b.t82.unchanged_pair === null ? "EMPTY (the control holds)" : "NOT EMPTY"}; retained ${JSON.stringify(wave2b.t82.retained)}` }
  arms.immutabilitySecondRunRefused = { command: "check-citations.ts --citations-only --out <the SAME dir> a second time", exitCode: wave2b.immutability.exitCode, passed: wave2b.immutability.passed, evidence: wave2b.immutability.message }
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
// instance that forced the rule is `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`, whose
// header writes "t35 acceptance A1-A4/A6" (a citation of t35's items) and whose falsifier list is
// headed "(design §9.3 F1/F2/F4/F5, ...)": a whole-header token scan reads both as claims and
// reports a violation that does not exist. References are COUNTED AND PRINTED, never dropped.
const CLAIM_MARKERS: RegExp = /\b(claims?|claimed|asserts?|asserted|checks?|checked|covers?|covered|arms?|keys?|proves?|proof|must|expects?|expected)\b/i
/** A header line pointing at another artifact's numbering: a REFERENCE, never a claim. */
const REFERENCE_MARKERS: RegExp = /(design|acceptance|\bplan\b|§|\bt\d+\b)/i
/** A single `A<n>` claim token in a driver header. */
const CLAIM_TOKEN: RegExp = /\bA(\d+)\b/g
/** An `A<n>–A<m>` claim range in a driver header (en dash or hyphen). */
const CLAIM_RANGE: RegExp = /\bA(\d+)\s*[–-]\s*A?(\d+)\b/g
/** An `add("A<n>…")` assertion-key call in a driver's code. */
const KEY_CALL: RegExp = /add\(\s*"A(\d+)[^"]*"/g
/** The directory the live driver-header scan walks when `--dir` is not given. */
const DRIVER_SCOPE: string = "./skills/dsh-qa/scripts/"
/** The file extensions the live driver scan accepts (fixture arms pass one explicit file).
 *
 * `.ts` IS THE WAVE'S SPELLING and `.mjs` stays accepted on purpose: the QA corpus is TypeScript
 * now, while a historical evidence copy or a reviewer's frozen snapshot may still carry the `.mjs`
 * form. An extension list of `.mjs` alone would have made this scan find ZERO drivers and pass
 * VACUOUSLY — the failure mode the `extensionAssumption` counter exists to expose. */
const DRIVER_EXTENSIONS: readonly string[] = [".ts", ".mjs"]
/** The spellings a WRONG extension assumption would look for, so the audit can measure that error. */
const DRIVER_ALTERNATE_EXTENSIONS: readonly string[] = [".js", ".cjs", ".mts"]

/** One T-80 file fixture: the driver it writes, its expected exit code and the message it must print. */
interface DriverFixture {
  /** Arm id, printed in the arm line. */
  readonly id: string
  /** Exit code the child run must produce. */
  readonly expect: number
  /** Output the child must match, or undefined when the exit code alone is the assertion. */
  readonly needle: RegExp | undefined
  /** Absolute path of the fixture driver written into the temp root. */
  readonly file: string
}

/** A driver header's extracted claims, its reference lines and the tokens those lines skipped. */
interface HeaderClaims {
  /** Claim id → the header phrase that claimed it (the first claim wins). */
  readonly claims: Map<number, string>
  /** The header lines classified as REFERENCE, verbatim. */
  readonly references: string[]
  /** `A<n>` ids named on those reference lines — the audit's third matcher-error direction. */
  readonly referenceTokens: Set<number>
  /** The header lines that carried a claim, verbatim. */
  readonly claimLines: string[]
}

/** One driver's audit row: its produced keys, its header claims and the two mismatch directions. */
interface DriverRow {
  /** Path of the driver, relative to the repo root. */
  readonly path: string
  /** Distinct `add("A<n>…")` key ids the code produces, ascending. */
  readonly keys: number[]
  /** Distinct `A<n>` ids the header claims, ascending. */
  readonly claims: number[]
  /** True when the header yields no claim of its own (REPORTED, never a violation). */
  readonly no_claim_set: boolean
  /** Claim ids the code produces no key for — VIOLATIONs, ascending. */
  readonly claimed_but_unasserted: number[]
  /** Key ids no header claim covers — VIOLATIONs; empty by rule when NO-CLAIM-SET. */
  readonly asserted_but_unclaimed: number[]
  /** The header's REFERENCE lines, verbatim. */
  readonly reference_lines: string[]
  /** `A<n>` ids named on those reference lines, ascending. */
  readonly reference_tokens: number[]
  /** The header lines that carried a claim, verbatim. */
  readonly claim_lines: string[]
  /** `A<n>` key → the claiming header phrase, for the CLAIMED-BUT-UNASSERTED findings. */
  readonly phrases: Record<string, string | undefined>
}

/** The running per-directory accumulator: counts plus the id sets the record dedupes. */
interface DirectoryBucket {
  /** Driver files scanned in this directory. */
  files: number
  /** Driver files producing at least one assertion key. */
  key_producers: number
  /** Key ids produced by this directory's files (unioned, never summed). */
  key_ids: Set<number>
  /** Key ids this directory's headers claim (unioned, never summed). */
  claim_ids: Set<number>
  /** Mismatched key ids in this directory (unioned, never summed). */
  mismatched_ids: Set<number>
  /** Rows of this directory whose header claims nothing of its own. */
  no_claim_set: number
}

/** One directory's deduped counts, as the record publishes them and the self-test reads them back. */
interface PerDirectorySplitEntry {
  /** Driver files scanned in that directory (unit: FILES). */
  readonly files: number
  /** Driver files producing at least one key (unit: FILES). */
  readonly key_producers: number
  /** DISTINCT key ids produced anywhere in that directory (unit: KEYS, deduped at directory scope). */
  readonly keys: number
  /** DISTINCT key ids that directory's headers claim (unit: KEYS, deduped at directory scope). */
  readonly claims: number
  /** DISTINCT mismatched key ids in that directory (unit: KEYS, deduped at directory scope). */
  readonly violations: number
  /** Rows whose header claims nothing of its own (unit: ROWS/driver files). */
  readonly no_claim_set: number
}

/** The audit block of a `--driver-headers` record, as far as the seeded self-test arm reads it. */
interface DriverHeadersAudit {
  /** Per-directory counts, keyed by the directory path relative to the repo root. */
  readonly per_directory_split: Record<string, PerDirectorySplitEntry>
}

/** The subset of a `--driver-headers --out` record the seeded directory-scope arm navigates. */
interface DriverHeadersRecord {
  /** The audit block the child run wrote. */
  readonly audit: DriverHeadersAudit
}

/** Recursive file walk with a filter, skipping the two directories that are never corpus. */
function walkFiles(root: string, filter: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(root)) return out
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    /** The entry's absolute path. */
    const child: string = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      walkFiles(child, filter, out)
    } else if (filter(child)) out.push(child)
  }
  return out
}

/** The leading comment block of a driver (shebang + `//` lines + blanks), up to the first code line. */
function driverHeaderLines(text: string): string[] {
  /** The header lines found so far, with their comment markers stripped. */
  const lines: string[] = []
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
function parseHeaderClaims(text: string, { naive = false }: { naive?: boolean } = {}): HeaderClaims {
  /** Claim id → the first header phrase that claimed it. */
  const claims: Map<number, string> = new Map()
  /** The header lines classified as REFERENCE, verbatim. */
  const references: string[] = []
  /** `A<n>` ids named on those reference lines (the under-report measurement). */
  const referenceTokens: Set<number> = new Set()
  /** The header lines that carried a claim, verbatim. */
  const claimLines: string[] = []
  /** Whether the current line sits inside an open claim scope (a blank header line closes it). */
  let scope: boolean = false
  for (const body of driverHeaderLines(text)) {
    /** The header line without its surrounding whitespace. */
    const trimmed: string = body.trim()
    if (trimmed === "") {
      scope = false
      continue
    }
    if (naive) {
      for (const match of trimmed.matchAll(new RegExp(CLAIM_RANGE.source, "g"))) {
        /** First id of the claimed range. */
        const from: number = Number(match[1])
        /** Last id of the claimed range. */
        const to: number = Number(match[2])
        if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) if (!claims.has(n)) claims.set(n, trimmed)
      }
      for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) {
        /** The single claimed id. */
        const n: number = Number(match[1])
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
        /** First id of the skipped range. */
        const from: number = Number(match[1])
        /** Last id of the skipped range. */
        const to: number = Number(match[2])
        if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) referenceTokens.add(n)
      }
      for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) referenceTokens.add(Number(match[1]))
      continue
    }
    claimLines.push(trimmed)
    for (const match of trimmed.matchAll(new RegExp(CLAIM_RANGE.source, "g"))) {
      /** First id of the claimed range. */
      const from: number = Number(match[1])
      /** Last id of the claimed range. */
      const to: number = Number(match[2])
      if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) if (!claims.has(n)) claims.set(n, trimmed)
    }
    for (const match of trimmed.matchAll(new RegExp(CLAIM_TOKEN.source, "g"))) {
      /** The single claimed id. */
      const n: number = Number(match[1])
      if (!claims.has(n)) claims.set(n, trimmed)
    }
  }
  return { claims, references, referenceTokens, claimLines }
}

/** The `add("A<n>…")` assertion keys a driver's code actually produces. */
function parseAssertedKeys(text: string): Map<number, string> {
  /** Key id → the first `add("A<n>…")` call text that produced it. */
  const keys: Map<number, string> = new Map()
  for (const match of text.matchAll(new RegExp(KEY_CALL.source, "g"))) {
    /** The asserted id. */
    const n: number = Number(match[1])
    if (!keys.has(n)) keys.set(n, match[0])
  }
  return keys
}

/** One driver's row: its keys, its claims, and the two mismatch directions. */
function driverRow(absolute: string, { naive = false }: { naive?: boolean } = {}): DriverRow {
  /** The driver's source text, parsed twice below (header claims, then code keys). */
  const text: string = readFileSync(absolute, "utf8")
  /** The header's extracted claims, references and reference tokens. */
  const { claims, references, referenceTokens, claimLines }: HeaderClaims = parseHeaderClaims(text, { naive })
  /** The key ids the code produces, with the call text that produced each. */
  const keys: Map<number, string> = parseAssertedKeys(text)
  /** Claimed ids the code never asserts, ascending. */
  const claimedButUnasserted: number[] = [...claims.keys()].filter((n: number): boolean => !keys.has(n)).sort((a: number, b: number): number => a - b)
  /** Asserted ids no header claim covers, ascending (empty by rule when the header claims nothing). */
  const assertedButUnclaimed: number[] = [...keys.keys()].filter((n: number): boolean => !claims.has(n)).sort((a: number, b: number): number => a - b)
  return {
    path: relative(REPO, absolute),
    keys: [...keys.keys()].sort((a: number, b: number): number => a - b),
    claims: [...claims.keys()].sort((a: number, b: number): number => a - b),
    no_claim_set: claims.size === 0,
    claimed_but_unasserted: claimedButUnasserted,
    asserted_but_unclaimed: claims.size === 0 ? [] : assertedButUnclaimed,
    reference_lines: references,
    reference_tokens: [...referenceTokens].sort((a: number, b: number): number => a - b),
    claim_lines: claimLines,
    phrases: Object.fromEntries(claimedButUnasserted.map((n: number): [string, string | undefined] => [`A${n}`, claims.get(n)])),
  }
}

/**
 * The T-80 fixture arms, each a spawned CHILD of this checker (`--driver-headers --dir <fixture>`)
 * with an asserted exit code AND an asserted message — never a prose claim:
 *   · matching                header CHECKS A1–A3, code produces A1–A3          → exit 0
 *   · claimed-but-unasserted   header CHECKS A1–A4, code produces A1–A3          → exit 1, names A4 + path
 *   · extra-key (near miss)    header CHECKS A1–A3, code produces A1–A4          → exit 1, names A4 + path
 */
function driverHeadersSelfTest(): number {
  /** The temp dir holding both the file fixtures and the seeded directory-scope fixture. */
  const root: string = mkdtempSync(join(tmpdir(), "t80-driver-headers-"))
  /** Write one fixture driver: a header of `//` lines, then one `add(...)` call per key. */
  const make = (name: string, header: string[], keys: string[]): string => {
    /** Absolute path of the fixture driver. */
    const file: string = join(root, name)
    writeFileSync(file, ["#!/usr/bin/env node", ...header.map((line: string): string => `// ${line}`), "", ...keys.map((key: string): string => `  add("${key}", true, "fixture arm")`), ""].join("\n"))
    return file
  }
  /** The three file fixtures: matching, claimed-but-unasserted and the extra-key near miss. */
  const fixtures: DriverFixture[] = [
    { id: "t80-matching", expect: 0, needle: undefined, file: make("matching.mjs", ["This driver CHECKS A1–A3; each arm produces its own assertion key."], ["A1", "A2", "A3"]) },
    { id: "t80-claimed-but-unasserted", expect: 1, needle: /driver:.*claimed-but-unasserted\.mjs[\s\S]*CLAIMED-BUT-UNASSERTED A4/, file: make("claimed-but-unasserted.mjs", ["This driver CHECKS A1–A4; the header claims an arm the code never asserts."], ["A1", "A2", "A3"]) },
    { id: "t80-extra-key-near-miss", expect: 1, needle: /driver:.*extra-key\.mjs[\s\S]*ASSERTED-BUT-UNCLAIMED A4/, file: make("extra-key.mjs", ["This driver CHECKS A1–A3."], ["A1", "A2", "A3", "A4"]) },
  ]
  log("driver-header claim check — self-test (T-80 fixture arms)")
  /** How many arms failed; the returned exit code is derived from it. */
  let failed: number = 0
  for (const fixture of fixtures) {
    /** The child run of THIS checker over the fixture, which must exit as the arm expects. */
    const child: SpawnSyncReturns<string> = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--driver-headers", "--dir", fixture.file], { encoding: "utf8", cwd: REPO })
    /** The child's combined output, matched against the arm's needle. */
    const output: string = (child.stdout ?? "") + (child.stderr ?? "")
    /** Whether the exit code AND (when given) the needle both hold. */
    const ok: boolean = child.status === fixture.expect && (fixture.needle === undefined || fixture.needle.test(output))
    if (!ok) failed += 1
    log(`  ${ok ? "ok  " : "FAIL"} ${fixture.id} — exit ${child.status} (expected ${fixture.expect})${fixture.needle === undefined ? "" : "; the key and the driver PATH must both be named"}`)
    if (!ok) log(output.trim().split("\n").slice(-4).join("\n"))
  }
  // t41/B2R3-F1 CLASS REQUIREMENT — a SEEDED counterexample for the DIRECTORY-SCOPE fields. The corpus has
  // one key-producing file per directory, so a sweep that reads labels against code called the directory
  // counts consistent; only a seeded shape falsifies them. This directory holds THREE files: each produces
  // A1–A2 and each claims A1–A3, so A3 is claimed-but-unasserted twice. The pre-fix SUMMING computation
  // printed keys=6 / claims=8 / violations=2; the DEDUPED reading must be keys=2 / claims=3 / violations=1
  // with key_producers=3 (the file count stays a file count).
  /** The seeded directory-scope fixture: three files, each producing A1–A2 and claiming A1–A3. */
  const dirScope: string = join(root, "dir-scope")
  mkdirSync(dirScope, { recursive: true })
  for (const name of ["a.mjs", "b.mjs", "c.mjs"]) {
    writeFileSync(join(dirScope, name), ["#!/usr/bin/env node", "// This driver CHECKS A1–A3.", "", 'add("A1", true)', 'add("A2", true)', ""].join("\n"))
  }
  /** The output dir the seeded arm's record is written to. */
  const dirOut: string = join(root, "dir-scope-out")
  /** The child run over that DIRECTORY: it must redden on the seeded mismatch. */
  const dirChild: SpawnSyncReturns<string> = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--driver-headers", "--dir", dirScope, "--out", dirOut], { encoding: "utf8", cwd: REPO })
  /** The seeded directory's deduped row read back from the child's record, or undefined. */
  let dirEntry: PerDirectorySplitEntry | undefined
  try {
    /** The child's record, read only for the per-directory split this arm asserts. */
    const dirRecord: DriverHeadersRecord = readJson<DriverHeadersRecord>(join(dirOut, "result.json"))
    dirEntry = Object.entries(dirRecord.audit.per_directory_split).find(([path]: [string, PerDirectorySplitEntry]): boolean => path.includes("dir-scope"))?.[1]
  } catch {
    dirEntry = undefined
  }
  // the seeded shape carries a REAL mismatch (A3 claimed, never asserted), so the child MUST redden —
  // exit 1 — while its directory counts are DEDUPED; both halves are asserted.
  /** Both halves of the arm: the child reddens AND its directory counts are deduped. */
  const dirOk: boolean = dirChild.status === 1 && dirEntry !== undefined && dirEntry.keys === 2 && dirEntry.claims === 3 && dirEntry.violations === 1 && dirEntry.key_producers === 3
  if (!dirOk) failed += 1
  log(`  ${dirOk ? "ok  " : "FAIL"} t80-directory-scope-dedup — keys=${dirEntry?.keys} claims=${dirEntry?.claims} violations=${dirEntry?.violations} key_producers=${dirEntry?.key_producers} (DEDUPED at directory scope: expected 2 / 3 / 1 / 3 — the summing computation printed 6 / 8 / 2; the child MUST exit 1 on the seeded mismatch)`)
  rmSync(root, { recursive: true, force: true })
  log("")
  log(`[driver-headers self-test] ${fixtures.length + 1 - failed}/${fixtures.length + 1} arms passed (3 fixture arms + the seeded directory-scope counterexample)`)
  return failed === 0 ? 0 : 1
}

/** The live `--driver-headers` audit: one row per key-producing driver, plus the audit block. */
function driverHeadersMain(): number {
  // t31/B2-F2: there is NO user-facing naive MODE. The alternative (naive) matcher is an INTERNAL
  // measurement the audit runs for its over-report direction; a flag that only relabelled the mode
  // while every row came from the precise matcher was removed rather than wired.
  if (process.argv.includes("--self-test")) return driverHeadersSelfTest()
  /** The audited scope: `--dir <path>` when given, else the live driver corpus directory. */
  const scopeArg: string = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : DRIVER_SCOPE
  /** This run's ISO-8601 UTC moment, recorded as `audit.moment` and in the parameters. */
  const runAt: string = new Date().toISOString()
  log("driver-header claim check (T-80)")
  log(`parameters: claims ${CLAIM_TOKEN.source} + ${CLAIM_RANGE.source} (markers ${CLAIM_MARKERS.source}; references ${REFERENCE_MARKERS.source}) · keys ${KEY_CALL.source} · mode one offline process · unit one driver file · scope ${scopeArg} · moment ${runAt}`)
  log("")
  /** The scope resolved against the repo root (a directory, or one fixture file). */
  const scopeRoot: string = resolve(REPO, scopeArg)
  // the scope is EITHER a directory (the live corpus) or ONE file (a fixture arm)
  /** Whether the scope is a directory (`--self-test` arms pass one file instead). */
  const scopeIsDirectory: boolean = statSync(scopeRoot).isDirectory()
  /** The driver files to audit: the directory walk, or the single fixture file. */
  const files: string[] = scopeIsDirectory ? walkFiles(scopeRoot, (file: string): boolean => DRIVER_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension))) : [scopeRoot]
  /** One row per key-producing driver, in scan order. */
  const rows: DriverRow[] = []
  /** Per-directory accumulators, keyed by the directory path relative to the repo root. */
  const split: Map<string, DirectoryBucket> = new Map()
  for (const file of files) {
    /** The directory this file sits in, relative to the repo root (trailing slash kept). */
    const directory: string = relative(REPO, dirname(file)) + "/"
    /** The accumulator for that directory, created on first sight. */
    const bucket: DirectoryBucket = split.get(directory) ?? { files: 0, key_producers: 0, key_ids: new Set(), claim_ids: new Set(), mismatched_ids: new Set(), no_claim_set: 0 }
    bucket.files += 1
    /** The driver's source text, parsed below for its assertion keys. */
    const text: string = readFileSync(file, "utf8")
    /** The key ids this driver's code produces. */
    const keys: Map<number, string> = parseAssertedKeys(text)
    if (keys.size > 0) {
      /** This driver's full audit row. */
      const row: DriverRow = driverRow(file)
      rows.push(row)
      bucket.key_producers += 1
      // t41/B2R3-F1: DEDUPED at DIRECTORY scope — the label says "distinct … in that directory", so the
      // ids are UNIONED across the directory's files. The previous `+= row.keys.length` SUMMED one file's
      // own distinct count per file (a seeded two-file directory printed 4 where only 2 ids exist).
      for (const id of row.keys) bucket.key_ids.add(id)
      for (const id of row.claims) bucket.claim_ids.add(id)
      for (const id of [...row.claimed_but_unasserted, ...row.asserted_but_unclaimed]) bucket.mismatched_ids.add(id)
      if (row.no_claim_set) bucket.no_claim_set += 1
      /** How many mismatch findings this row carries (both directions). */
      const violations: number = row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length
      record(
        `driver:${row.path}`,
        violations === 0,
        violations === 0
          ? `${row.keys.length} assertion key(s) [A${row.keys[0]}–A${row.keys[row.keys.length - 1]}]; ${row.no_claim_set ? "NO-CLAIM-SET declared in the header (reported, not a violation)" : `${row.claims.length} claimed`}`
          : `${row.claimed_but_unasserted.map((n: number): string => `CLAIMED-BUT-UNASSERTED A${n} (header phrase: "${String(row.phrases[`A${n}`]).slice(0, 120)}")`).join("; ")}${row.asserted_but_unclaimed.length > 0 ? `${row.claimed_but_unasserted.length > 0 ? "; " : ""}ASSERTED-BUT-UNCLAIMED ${row.asserted_but_unclaimed.map((n: number): string => `A${n}`).join(", ")}` : ""}`,
      )
    }
    split.set(directory, bucket)
  }
  // ER-2: the audit measures BOTH matcher-error directions on ITSELF, instead of inheriting another
  // audit's numbers (lane A's T-92 split — 25 self-fix-tests/** + 17 test/** = 42 `not.toContain(`
  // occurrences — measures a DIFFERENT audit and is NOT reused here).
  /** Rows the NAIVE whole-header matcher would flag — the audit's over-report direction. */
  const naiveFiles: DriverRow[] = rows.map((row: DriverRow): DriverRow => driverRow(join(REPO, row.path), { naive: true })).filter((row: DriverRow): boolean => row.claims.length > 0 && (row.claimed_but_unasserted.length > 0 || row.asserted_but_unclaimed.length > 0))
  /** Key producers a NON-recursive scope would find — the first under-report direction. */
  const nonRecursive: number = scopeIsDirectory ? readdirSync(scopeRoot, { withFileTypes: true }).filter((entry: Dirent): boolean => entry.isFile() && DRIVER_EXTENSIONS.some((extension: string): boolean => entry.name.endsWith(extension)) && parseAssertedKeys(readFileSync(join(scopeRoot, entry.name), "utf8")).size > 0).length : 0
  /** Key-producing drivers repo-wide, in every accepted spelling (the whole-repo literal scan's number). */
  const repoWide: number = walkFiles(REPO, (file: string): boolean => DRIVER_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension))).filter((file: string): boolean => parseAssertedKeys(readFileSync(file, "utf8")).size > 0).length
  /** Key producers a WRONG file-extension assumption would find — the second under-report direction. */
  const extensionAssumption: number = scopeIsDirectory ? walkFiles(scopeRoot, (file: string): boolean => DRIVER_ALTERNATE_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension))).filter((file: string): boolean => parseAssertedKeys(readFileSync(file, "utf8")).size > 0).length : 0
  // t36 (the t32 review's finding): the third direction's UNIT. The count is the number of reference
  // LINES carrying an `A<n>` token — the SUM, over the scanned rows, of their `reference_lines`
  // entries that carry one — NOT the number of driver files that contain such a line. The token set
  // is the union of those lines' tokens. Both are stated with their predicate so neither number can
  // be read in the other's unit.
  /** Whether one reference line carries an `A<n>` token (single or range form). */
  const lineCarriesAToken = (line: string): boolean => new RegExp(CLAIM_TOKEN.source).test(line) || new RegExp(CLAIM_RANGE.source).test(line)
  /** The number of reference LINES carrying an `A<n>` token, summed over the scanned rows. */
  const referenceLinesWithTokens: number = rows.reduce((total: number, row: DriverRow): number => total + row.reference_lines.filter(lineCarriesAToken).length, 0)
  /** The union of those lines' `A<n>` token ids. */
  const referenceTokenSet: Set<number> = new Set(rows.flatMap((row: DriverRow): number[] => row.reference_tokens))
  /** The audit block: per-directory counts, the unit registry and both matcher-error directions. */
  const audit = {
    // t36 CLASS SWEEP (captain's acceptance item 2): every count below is read against its OWN label —
    // predicate, unit and moment. This registry is that reading, and it is what a record reader uses to
    // tell which SUBJECT a number counts. `moment` is the record's run_at for all of them.
    moment: runAt,
    units: {
      files_scanned: "driver files under the scope (unit: FILES)",
      "per_directory_split[].files": "driver files scanned in that directory (unit: FILES)",
      "per_directory_split[].key_producers": "driver files producing at least one add(\"A<n>…\") key (unit: FILES)",
      "per_directory_split[].keys": "DISTINCT A<n> key ids produced anywhere in that directory — deduped at DIRECTORY scope (the UNION of the directory's files' key ids), never the sum of per-file counts (t41/B2R3-F1; seeded shape in the arm `t80-directory-scope-dedup`)",
      "per_directory_split[].claims": "DISTINCT A<n> key ids CLAIMED by that directory's headers — deduped at DIRECTORY scope, never summed per file (t41/B2R3-F1; same seeded arm)",
      "per_directory_split[].violations": "DISTINCT mismatched A<n> key ids in that directory — claimed-but-unasserted ∪ asserted-but-unclaimed, deduped at DIRECTORY scope; never a sum of per-file counts and never a file count (t41/B2R3-F1; same seeded arm)",
      "per_directory_split[].no_claim_set": "rows whose header claims nothing of its own (unit: ROWS/driver files)",
      claim_set_parsed: "driver rows whose header yields at least one claim (unit: ROWS/driver files)",
      no_claim_set: "driver rows whose header yields no claim of its own (unit: ROWS/driver files)",
      violations: "DISTINCT mismatched A<n> key ids across the scope — deduped at SCOPE (the union over the scanned rows), never a sum of per-row counts (unit: KEYS, never files)",
      "third_direction.measured": "reference LINES carrying an A<n> token, summed over rows, and the distinct token ids they carry (unit: LINES, then token ids)",
      "matcher_error_directions[].measured": "each direction states its alternative and its number WITH the unit inline (files / key producers / keys)",
    },
    // t41 CLASS REQUIREMENT (from the t37 review): every field below whose label makes a GENERAL claim —
    // distinct / summed / per-directory / deduped — carries its computing predicate inline (above), and the
    // fields that were FALSIFIED BY A SEEDED SHAPE are named separately from the fields only READ. A sweep
    // that reads labels against code can call a field consistent when a seeded shape would falsify it:
    // exactly how B2R3-F1 survived one sweep, and why the split is published here.
    units_sweep: {
      round: "t41 (B2R3-F1) — the class requirement",
      seeded_this_round: {
        "per_directory_split[].keys": "arm `t80-directory-scope-dedup`: three files in ONE directory, each producing A1–A2 → the SUMMING computation printed 6, the deduped count is 2",
        "per_directory_split[].claims": "same seeded shape: the three files claim A1–A3 → the summing computation printed 8, the deduped count is 3",
        "per_directory_split[].violations": "same seeded shape: two files claim A3 while asserting only A1–A2 → the summing computation printed 2, the deduped count is 1 (and the scope `violations` is the same union)",
      },
      read_and_named_consistent: ["directories[].files_scanned", "per_directory_split[].files", "per_directory_split[].key_producers", "per_directory_split[].no_claim_set", "claim_set_parsed", "no_claim_set", "third_direction.measured", "matcher_error_directions[].measured"],
      falsifiable_now: "the three seeded fields can be RE-FALSIFIED by re-running that arm; the read-only list is an ASSERTION, named as such — a reader can tell which verdicts are falsifiable (t41).",
    },
    directories: [{ path: scopeArg, recursive: true, files_scanned: files.length }],
    per_directory_split: Object.fromEntries([...split.entries()].sort().map(([path, bucket]: [string, DirectoryBucket]): [string, PerDirectorySplitEntry] => [path, {
      files: bucket.files,
      key_producers: bucket.key_producers,
      keys: bucket.key_ids.size,
      claims: bucket.claim_ids.size,
      violations: bucket.mismatched_ids.size,
      no_claim_set: bucket.no_claim_set,
    }])),
    claim_set_parsed: rows.filter((row: DriverRow): boolean => !row.no_claim_set).length,
    no_claim_set: rows.filter((row: DriverRow): boolean => row.no_claim_set).length,
    violations: new Set(rows.flatMap((row: DriverRow): number[] => [...row.claimed_but_unasserted, ...row.asserted_but_unclaimed])).size,
    third_direction: {
      name: "the line-wide REFERENCE exemption",
      unit: "reference LINES (not driver files): the sum, over the scanned rows, of their `reference_lines` entries that carry an `A<n>` token",
      measured: `${referenceLinesWithTokens} reference LINE(s) carry ${referenceTokenSet.size} A<n> token(s) (${[...referenceTokenSet].sort((a: number, b: number): number => a - b).map((n: number): string => `A${n}`).join(", ") || "none"}); the exemption skips the WHOLE line, so a claim sharing a line with an artifact reference is not claimed — declared and measured rather than silent (t31/B2-F4, unit corrected in t36)`,
    },
    matcher_error_directions: [
      { direction: "over-report", alternative: "whole-header token scan (no claim-marker scope, no reference filter)", measured: `${naiveFiles.length} file(s) flagged and ${naiveFiles.reduce((t: number, row: DriverRow): number => t + row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length, 0)} key(s) reported as mismatched, against ${rows.reduce((t: number, row: DriverRow): number => t + row.claimed_but_unasserted.length + row.asserted_but_unclaimed.length, 0)} with the precise rule` },
      { direction: "under-report", alternative: `non-recursive ${scopeArg}*.mjs (misses lib/)`, measured: `${nonRecursive} key producer(s) found against ${rows.length}` },
      { direction: "under-report", alternative: "a file-type assumption (.js) instead of .mjs", measured: `${extensionAssumption} key producer(s) found against ${rows.length}` },
      { direction: "over-report", alternative: "a whole-repo literal scan for `add(\"A`", measured: `${repoWide} key-producing .mjs file(s) repo-wide against ${rows.length} in scope` },
    ],
    not_inherited: "lane A's T-92 audit split (25 self-fix-tests/** + 17 test/** = 42 `not.toContain(` occurrences; subject-scoped 3 with 0 reddened) measures a DIFFERENT audit — different literal, different subject — and is not reused here.",
  }
  /** Every mismatch finding, one line each, named by path and key id. */
  const violations: string[] = rows.flatMap((row: DriverRow): string[] => [
    ...row.claimed_but_unasserted.map((n: number): string => `CLAIMED-BUT-UNASSERTED ${row.path} A${n} — header phrase: "${String(row.phrases[`A${n}`]).slice(0, 160)}"`),
    ...row.asserted_but_unclaimed.map((n: number): string => `ASSERTED-BUT-UNCLAIMED ${row.path} A${n}`),
  ])
  /** The run record: identity, parameters, policy, the audit block, the rows and the violations. */
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
/** One occurrence of the scanned literal: its repo-relative path, 1-based line and quoted phrase. */
interface ScanHit {
  /** Repo-relative path of the file the literal occurs in. */
  readonly path: string
  /** 1-based line number of the occurrence. */
  readonly line: number
  /** The trimmed line, capped at 200 characters, as the record quotes it. */
  readonly phrase: string
}

/** An occurrence inside the scanner's own output: the reason it is not an anchor travels with it. */
interface SelfReferenceHit extends ScanHit {
  /** Why this occurrence is the scanner's own record (or a capture quoting its command). */
  readonly self_reference: string
}

/** Report every file under `--anchor-scan <dir>` containing `--pattern <literal>` (exit 1 on a match). */
function anchorScanMain(): number {
  /** The scanned directory argument (the caller has already proven `--anchor-scan` present). */
  const dirArg: string | undefined = process.argv[process.argv.indexOf("--anchor-scan") + 1]
  /** The literal to look for, or undefined when `--pattern` was not given. */
  const patternArg: string | undefined = process.argv.includes("--pattern") ? process.argv[process.argv.indexOf("--pattern") + 1] : undefined
  if (dirArg === undefined || patternArg === undefined) {
    log("usage: node scripts/check-citations.ts --anchor-scan <dir> --pattern <literal> [--out <dir>]")
    return 2
  }
  /** This run's ISO-8601 UTC moment, recorded in the scan's record. */
  const runAt: string = new Date().toISOString()
  /** The scanned scope resolved against the repo root. */
  const root: string = resolve(REPO, dirArg)
  /** Every text-shaped file under the scope, before the self-output exclusion below. */
  const candidates: string[] = walkFiles(root, (): boolean => true).filter((file: string): boolean => /\.(md|json|mjs|js|ts|txt|log|out|yaml|yml)$/.test(file))
  // F5 (t31): the scan writes its record INSIDE the tree it scans by default, and that record carries
  // the literal — so the first run would poison every re-take. The scan's own output subtree is
  // therefore EXCLUDED from the walk and NAMED in the record, which is what makes the 0 re-takeable.
  /** The scan's own output root, excluded so a record cannot quote itself into a permanent match. */
  const selfOutput: string = resolve(OUT_ROOT)
  /** Whether a candidate path is (or sits under) the scan's own output root. */
  const isSelfOutput = (file: string): boolean => resolve(file) === selfOutput || resolve(file).startsWith(selfOutput + sep)
  /** The files actually scanned, with the self-output subtree removed. */
  const files: string[] = candidates.filter((file: string): boolean => !isSelfOutput(file))
  /** The excluded self-output files, named in the record. */
  const excludedSelf: string[] = candidates.filter(isSelfOutput).map((file: string): string => relative(REPO, file))
  // F5 (t31): a match inside the scanner's OWN record is not an anchor — it is the record QUOTING the
  // scan's command. Those are classified and NAMED (never counted as anchors), so the reading is
  // re-takeable and a reader can tell a real absence from the scanner's own output.
  /** Why a file is the scanner's own output, or undefined when it is a real anchor candidate. */
  const selfReferenceReason = (file: string): string | undefined => {
    /** The file's repo-relative path, classified by its `anchor-` directory segments first. */
    const rel: string = relative(REPO, file)
    if (rel.split(sep).some((part: string): boolean => part.startsWith("anchor-"))) return "the path is inside an anchor-scan output directory"
    /** The file's text, or "" when it cannot be read. */
    let text: string = ""
    try {
      text = readFileSync(file, "utf8")
    } catch {
      return undefined
    }
    if (text.includes('"task": "T-90 anchor scan"')) return "the file IS an anchor-scan record"
    if (text.includes("node scripts/check-citations.ts --anchor-scan")) return "the file QUOTES the scan's own command (provenance, not an anchor)"
    return undefined
  }
  /** The real anchor matches, one entry per occurrence. */
  const hits: ScanHit[] = []
  /** The matches classified as the scanner's own output. */
  const selfHits: SelfReferenceHit[] = []
  for (const file of files) {
    /** Why this file is self-referential, or undefined when it is a real anchor candidate. */
    const reason: string | undefined = selfReferenceReason(file)
    /** The file's lines, each tested for the literal. */
    const lines: string[] = readFileSync(file, "utf8").split("\n")
    lines.forEach((line: string, index: number): void => {
      if (!line.includes(patternArg)) return
      /** The occurrence as a real-anchor entry; a self-reference entry adds its reason below. */
      const entry: ScanHit = { path: relative(REPO, file), line: index + 1, phrase: line.trim().slice(0, 200) }
      if (reason === undefined) hits.push(entry)
      else selfHits.push({ ...entry, self_reference: reason })
    })
  }
  log("anchor scan (T-90 / ADDENDUM A: no mailbox-record-id-shaped anchors in this lane's records)")
  log(`parameters: literal string ${JSON.stringify(patternArg)} · pattern AS PASSED plain substring, case-sensitive, unescaped · mode one offline process, no children · unit one file under ${dirArg} · scope ${files.length} text file(s) · moment ${runAt}`)
  log(`self-reference: the scan's OWN output under ${relative(REPO, selfOutput)} is EXCLUDED from the walk (${excludedSelf.length} file(s)), so this reading is re-takeable with the same command (t31/B2-F5)`)
  for (const hit of hits) log(`  MATCH ${hit.path}:${hit.line} — ${hit.phrase}`)
  for (const hit of selfHits) log(`  SELF-REFERENCE ${hit.path}:${hit.line} — ${hit.self_reference}: ${hit.phrase}`)
  /** The scan record: the parameter block, the self-reference classification and the matches. */
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

/** The number of anchor matches a scan reported (a named step so the closing line reads it). */
function matches(hits: readonly ScanHit[]): number {
  return hits.length
}

if (process.argv.includes("--driver-headers")) process.exit(driverHeadersMain())
if (process.argv.includes("--anchor-scan")) process.exit(anchorScanMain())

/** Whether this process is a fixture child (`DOCS_CLAIMS_REPO` set): it reports on stdout only. */
const fixtureRun: boolean = process.env.DOCS_CLAIMS_REPO !== undefined
/** The negative-control arms, taken under `--self-test` only; undefined on every other run. */
const negativeControlArms: Record<string, FixtureArm> | undefined = process.argv.includes("--self-test") ? negativeControl() : undefined

// ── run ──────────────────────────────────────────────────────────────────────
log("docs-claims checker (t72: existence + range + SITE-PAIRED content claims + symbol-first enforcement + negative control)")
log(`repo ${REPO}`)
log("")

/** One resolved analysis per readable subject document, in subject order. */
const analyzed: AnalyzedSubject[] = []
for (const subject of SUBJECTS) {
  /** The analysis of one subject: a document this run cannot read is recorded, never thrown. */
  const result: SubjectAnalysis | SubjectAnalysisError = analyze(subject.path, subject)
  if ("error" in result) {
    record(`subject:${subject.path}`, false, result.error)
    continue
  }
  analyzed.push({ subject, ...result })
}

/** The illustrative citations, rendered one line each. */
const illustrative: string[] = []
/** Every citation extracted from every readable subject (annotated ones included). */
let totalCitations: number = 0
/** How many anchors were verified against a claim (symbol-first plus line-dependent). */
let contentVerified: number = 0
/** How many line-FREE anchors were verified against the whole cited file. */
let symbolOnlyVerified: number = 0
/** How many line-BEARING anchors were verified against the cited line/range (still a rot risk). */
let lineDependentVerified: number = 0
/** How many line-number-only anchors were flagged as rot. */
let rotAnchors: number = 0
/** The rot findings, one line each. */
const rot: string[] = []
for (const entry of analyzed) {
  /** The problems this subject's citation arms collected, in encounter order. */
  const failures: string[] = []
  for (const citation of entry.citations) {
    if (citation.flag !== undefined) continue
    /** The existence/range verdict for this citation, or undefined when it resolves. */
    const problem: string | undefined = checkCitation(citation)
    if (problem !== undefined) failures.push(`doc line ${citation.docLine}: ${problem}`)
    // T-72 arm: a LINE-BEARING anchor is verified against the claim at ITS OWN SITE. When no
    // such claim exists, the anchor's only locator is the line number — ROT: flagged, counted,
    // reported per anchor, and able to fail the run (T-72 clause (b)).
    if (citation.kind === "path" && citation.line !== undefined) {
      /** The claim written at this anchor's own site, or undefined when there is none. */
      const claim: Claim | undefined = claimForSite(citation, entry.claims)
      if (claim === undefined) {
        rotAnchors += 1
        rot.push(`${entry.file}:${citation.docLine} ${citation.value}:${citation.line}${citation.endLine === undefined ? "" : `-${citation.endLine}`}`)
        failures.push(`doc line ${citation.docLine}: ${lineNumberOnlyProblem(citation)}`)
      } else {
        /** The content verdict for that claim, or undefined when the cited line carries it. */
        const problem: string | undefined = claimContentProblem(citation, claim)
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
      /** The symbol-first verdict: true when verified, a problem string, or null when not that form. */
      const symbolResult: string | true | null = symbolOnlyClaimCheck(citation, entry.claims, citedFileText(citation))
      if (symbolResult === true) {
        contentVerified += 1
        symbolOnlyVerified += 1
      } else if (typeof symbolResult === "string") {
        failures.push(`doc line ${citation.docLine}: ${symbolResult}`)
      }
    }
  }
  /** This subject's citations by kind, counted for the check's detail line. */
  const counts: Record<CitationKind, number> = { path: 0, dir: 0, command: 0 }
  for (const citation of entry.citations) if (citation.flag === undefined) counts[citation.kind] += 1
  totalCitations += entry.citations.length
  record(
    `citations:${entry.file}`,
    failures.length === 0,
    `${entry.citations.length} citation(s) (checked ${counts.path + counts.dir + counts.command}: path ${counts.path}, dir ${counts.dir}, command ${counts.command}; pending ${entry.pending.length}, illustrative ${entry.illustrative.length}), ${failures.length} unresolved${failures.length > 0 ? `: ${failures.slice(0, 6).join(" | ")}` : ""}`,
  )
  for (const citation of entry.pending) {
    /** The existence/range verdict for this pending citation (it should still resolve). */
    const problem: string | undefined = checkCitation(citation)
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
/** Whether this run takes the citation arms alone (the negative control's fixture runs do). */
const citationsOnly: boolean = process.argv.includes("--citations-only")
/** The human guide's EN text, or "" under `--citations-only`. */
const guideEn: string = citationsOnly ? "" : readFileSync(join(REPO, GUIDE_EN), "utf8")
/** The human guide's zh-CN text, or "" under `--citations-only`. */
const guideZh: string = citationsOnly ? "" : readFileSync(join(REPO, GUIDE_ZH), "utf8")
/** The EN guide's heading tree, or empty under `--citations-only`. */
const enHeadings: Heading[] = citationsOnly ? [] : headings(guideEn)
/** The zh-CN guide's heading tree, or empty under `--citations-only`. */
const zhHeadings: Heading[] = citationsOnly ? [] : headings(guideZh)
/** Whether the two heading trees match in length and level-for-level. */
const sameTree: boolean = citationsOnly || (enHeadings.length === zhHeadings.length && enHeadings.every((entry: Heading, index: number): boolean => entry.level === zhHeadings[index].level))
if (!citationsOnly) record("guide-heading-tree", sameTree, `${enHeadings.length} EN heading(s) vs ${zhHeadings.length} zh-CN heading(s), levels ${sameTree ? "identical" : "DIFFERENT"}`)

// the split is structural: no shared heading text, no shared prose line
/** The agent contract's text, or "" under `--citations-only`. */
const aiDoc: string = citationsOnly ? "" : readFileSync(join(REPO, AI_DOC), "utf8")
if (!citationsOnly) {
  /** EN headings whose text also appears in the agent contract. */
  const sharedHeadings: string[] = enHeadings.map((entry: Heading): string => entry.text).filter((text: string): boolean => headings(aiDoc).some((other: Heading): boolean => other.text === text))
  record("split-headings", sharedHeadings.length === 0, sharedHeadings.length === 0 ? "no heading text is shared between the human guide and the agent contract" : `shared: ${sharedHeadings.join(" | ")}`)
  /** The EN guide's prose lines, as a membership set. */
  const guideProse: Set<string> = new Set(proseLines(guideEn))
  /** Agent-contract prose lines reused verbatim from the EN guide. */
  const sharedProse: string[] = proseLines(aiDoc).filter((line: string): boolean => guideProse.has(line))
  record("split-prose", sharedProse.length === 0, sharedProse.length === 0 ? "no prose line (>= 60 chars, outside code fences) is reused" : `reused: ${sharedProse.slice(0, 3).join(" | ")}`)
}

// the agent contract's manifest skeleton must validate with the real validator
/** The extracted skeleton block: undefined under `--citations-only` or when the doc carries none. */
const skeleton: Skeleton | undefined = citationsOnly ? undefined : skeletonFromDoc()
if (citationsOnly) {
  // fixture runs assert the CITATION arms only
} else if (skeleton === undefined) {
  record("skeleton-validates", false, `no \`\`\`json block whose id is "${SKELETON_ID}" was found in ${AI_DOC}`)
} else {
  /** The materialized skeleton's sandbox and root, the latter handed to the validator. */
  const { sandbox, root }: MaterializedSkeleton = materializeSkeleton(skeleton.raw)
  /** The validator child run over the materialized extension. */
  const run: SpawnSyncReturns<string> = spawnSync("bun", [join(REPO, "scripts", "mpd-ext.ts"), "validate", root], { cwd: REPO, encoding: "utf8" })
  /** The validator's combined output, quoted in the check's detail line. */
  const output: string = (run.stdout ?? "") + (run.stderr ?? "")
  /** Whether the validator accepted the materialized manifest. */
  const ok: boolean = run.status === 0 && output.includes("loadable")
  record("skeleton-validates", ok, `the extracted manifest + the template's four assets: validate exit ${run.status}; ${output.trim().split("\n").filter((line: string): boolean => line.includes("contributes:")).join(" ")}`)
  if (!ok) log(output)
  rmSync(sandbox, { recursive: true, force: true })
}

// ── the contract gates (opt-in: --gates), recorded with raw output ───────────
/** One opt-in contract gate: the argv to spawn and the raw-output file its bytes land in. */
interface GateSpec {
  /** Gate id, also the suffix of the `gate:<id>` check id. */
  readonly id: string
  /** The command a reader re-runs, spelled with the converted `.ts` path. */
  readonly command: string
  /** The executable to spawn. */
  readonly bin: string
  /** The argv handed to that executable. */
  readonly args: readonly string[]
  /** Repo-relative path under `<out>/` the gate's raw output is written to. */
  readonly raw: string
}

/** One gate's recorded outcome, quoted in the run record. */
interface GateEntry {
  /** Gate id, also the suffix of the `gate:<id>` check id. */
  readonly id: string
  /** The command a reader re-runs. */
  readonly command: string
  /** The child's exit status, or null when it was killed. */
  readonly exitCode: number | null
  /** `passed` / `failed`, derived from the exit status. */
  readonly status: "passed" | "failed"
  /** The last two non-empty output lines, joined — the evidence the record carries. */
  readonly evidence: string
  /** Repo-relative path of the raw output file written under `<out>/`. */
  readonly raw: string
}

/** The gates this run executed (empty unless `--gates` was given). */
const gates: GateEntry[] = []
if (!citationsOnly && process.argv.includes("--gates")) {
  mkdirSync(join(OUT_ROOT, "raw"), { recursive: true })
  /** The three contract gates, each with its own raw-output file. */
  const specs: readonly GateSpec[] = [
    { id: "docs-parity", command: "node scripts/verify-docs-parity.ts", bin: "node", args: ["scripts/verify-docs-parity.ts"], raw: "raw/gate-docs-parity.txt" },
    { id: "example-validates", command: "bun scripts/mpd-ext.ts validate extensions/mpd-ext-example", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.ts"), "validate", join(REPO, "extensions", "mpd-ext-example")], raw: "raw/gate-validate-example.txt" },
    { id: "cli-self-test", command: "bun scripts/mpd-ext.ts --self-test", bin: "bun", args: [join(REPO, "scripts", "mpd-ext.ts"), "--self-test"], raw: "raw/gate-selftest.txt" },
  ]
  for (const spec of specs) {
    /** The gate child run. */
    const run: SpawnSyncReturns<string> = spawnSync(spec.bin, spec.args, { cwd: REPO, encoding: "utf8" })
    /** The child's combined output, written raw and quoted in part. */
    const output: string = (run.stdout ?? "") + (run.stderr ?? "")
    writeImmutable(join(OUT_ROOT, spec.raw), output, { label: "gate raw output" })
    /** The last two non-empty lines, the evidence the record carries. */
    const evidence: string = output.trim().split("\n").filter((line: string): boolean => line.trim() !== "").slice(-2).join(" | ")
    gates.push({ id: spec.id, command: spec.command, exitCode: run.status, status: run.status === 0 ? "passed" : "failed", evidence, raw: spec.raw })
    record(`gate:${spec.id}`, run.status === 0, `${spec.command} — exit ${run.status}; ${evidence.slice(0, 150)}`)
  }
}

// ── T-82: each run RETAINS the revision bytes it measured ────────────────────
// `checker{path,sha256,supersedes}` is the HASH view, and a hash cannot be diffed. So a run also
// COPIES the bytes it measured — its own file and the frozen revision it supersedes — into
// `<out>/revisions/` under STABLE names, so two runs of different revisions are diffable
// file-to-file: `diff <runA>/revisions/checker.ts <runB>/revisions/checker.ts`.
/** One revision a run retained under `<out>/revisions/`, so two runs are diffable file-to-file. */
interface RetainedRevision {
  /** Path of the retained copy, relative to the repo root (the diffable artifact). */
  readonly target: string
  /** Path the bytes were copied from, relative to the repo root. */
  readonly source: string
  /** sha256 of the source file, or null when it could not be read. */
  readonly sha256: string | null
  /** What this revision is (`the running checker`, the frozen revision it supersedes). */
  readonly label: string
}

/** Every revision this run retained, as the record publishes them. */
const retainedRevisions: RetainedRevision[] = []
/** Copy one revision's bytes into `<out>/revisions/` under a stable name, recording its hash. */
function retainRevision(source: string, target: string, label: string): void {
  if (!existsSync(source)) return
  /** The retained copy's path inside this run's output directory. */
  const destination: string = join(OUT_ROOT, "revisions", target)
  writeImmutable(destination, readFileSync(source), { label: `retained revision (${label})` })
  retainedRevisions.push({ target: relative(REPO, destination), source: relative(REPO, source), sha256: fileHash(source), label })
}
if (!fixtureRun) {
  // A second run at the same `--out` is refused HERE, on the first retained file (exit 3), which is
  // this lane's ready-made immutability arm.
  try {
    // The retained labels carry the `.ts` extension this repository's sources now use: a label
    // spelled `.mjs` would write JavaScript back into `evidence/**` on every run (measured: three
    // such files reappeared the moment this lane's self-test ran during the conversion wave).
    retainRevision(fileURLToPath(import.meta.url), "checker.ts", "the running checker")
    retainRevision(join(REPO, "evidence", "extensions", "docs-claims", "check-citations.ts"), "superseded.ts", "the frozen revision this one supersedes")
  } catch (error) {
    exitOnRefusal(error, "[docs-claims]")
  }
}

/** The checks that failed, in record order. */
const failed: ResultEntry[] = results.filter((entry: ResultEntry): boolean => entry.status === "failed")
/** The run record — the artifact every later reader quotes. */
const report = {
  task: "t72 (durable home of the t21/t9 checker: SITE-PAIRED claims + SYMBOL-FIRST enforcement — a line-number-only anchor is ROT)",
  run_at: new Date().toISOString(),
  // T-78: the driver rule travels WITH the record, so a reader of the record finds it without
  // prose. Asserted against these very bytes by `negative-control:t78-record-carries-the-rule`.
  rules: {
    doc_rewrite: {
      rule: "a doc-rewrite task's verify list MUST carry the citation driver",
      command: "node scripts/check-citations.ts --out ./evidence/gates/<slug>/<stamp>/run",
      why: "an omitted driver is not a silent state: a mis-anchored citation exits 1 with `does not carry the claim` while the correct fixture exits 0",
      parameters: {
        literal_string: "node scripts/check-citations.ts --out",
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
    supersedes: { path: "evidence/extensions/docs-claims/check-citations.ts", sha256: fileHash(join(REPO, "evidence", "extensions", "docs-claims", "check-citations.ts")) },
  },
  revisions: retainedRevisions,
  // F1 (t27 repair): the hard-coded `attempt_id` (t21's, inherited from the evidence-side build) is
  // REMOVED — it stamped a FOREIGN task's attempt into every run record, including the reviewer's.
  // Revision provenance is `checker{path, sha256, supersedes}` above; a caller that wants its own
  // attempt recorded must parameterize it (no consumer reads the field: measured by grepping
  // `scripts/`, `skills/`, `packages/` for `attempt_id`).
  subjects: SUBJECTS.map((subject: Subject): string => subject.path),
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
  failed: failed.map((entry: ResultEntry): string => `${entry.id}: ${entry.detail}`),
  passed: results.length - failed.length,
  total: results.length,
  // The three fields the pre-conversion code ASSIGNED after this literal was built. A fixture child
  // never writes this document, so carrying them here is unobservable there, and for a writing run
  // the values (and their key order) are exactly what those assignments produced — `JSON.stringify`
  // still omits an `undefined` value, so the recorded bytes are unchanged.
  negative_control: negativeControlArms,
  output_root: relative(REPO, OUT_ROOT),
  output_target: OUT_EXPLICIT ? "explicit (--out)" : "fresh timestamped run directory (immutable-by-default, T-53)",
}
if (fixtureRun) {
  // a NEGATIVE-CONTROL child run reports on stdout only; it never writes this dir
} else {
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
