#!/usr/bin/env node
// Case review-panel: the `review-work` skill's PANEL is checked as DATA, not by eye.
//
// WHAT THIS CASE IS FOR. `skills/review-work/SKILL.md` declares a four-lane review panel whose three
// reviewer lanes are ROSTER ROLES. Nothing in the type system holds that declaration together: a lane
// could name a role that does not exist, the prose count and the merge table could drift apart, a
// retired spelling could creep back in, or the stale multi-agent verdict block could return. This case
// turns each of those into an assertion over the FILES ON DISK, so the skill's own claim — that a case
// asserts the counts agree and that every roster role named there is a member of the roster — is true
// rather than decorative.
//
// THE ASSERTIONS (each also has a negative-control arm in `--self-test`, so a green run cannot be
// vacuous):
//   1.  prose-lane-count ................. the opening "through exactly <N> lanes" parses to a number
//   2.  panel-lane-table ................. exactly ONE table carries both a `Roster role` and a
//                                          `Lane discipline` column
//   3.  panel-table-count-equals-prose ... that table has one row per prose lane
//   4.  lane-roles-in-ROLES .............. every roster role named by a lane is a member of `ROLES` in
//                                          `packages/mpd-roles-plugin/src/roles.data.ts` (IMPORTED and
//                                          compared by identity of the data, never grepped for)
//   5.  read-only-lanes .................. exactly three lanes carry the `read-only findings` discipline
//   6.  roster-readonly-per-lane ......... each of those roles is roster-read-only OR findings-only by
//                                          its roster description (the honest form; the observed flag is
//                                          reported per lane, because ONE roster role is findings-only by
//                                          description rather than by the mechanical write guard)
//   7.  merge-table-single ............... exactly ONE table carries both a `Lane` and a `Verdict` column
//   8.  merge-table-lanes-match .......... the merge table's lanes EQUAL the panel table's lanes, in order
//   9.  merge-table-count-equals-prose ... the merge table has one row per prose lane
//   10. verdict-tokens ................... `PASS`, `FAIL` and `INCONCLUSIVE` are all declared
//   11. degrade-matrix ................... the three declared fallbacks are WRITTEN DOWN (the one-shot
//                                          spawn tool, an unresolvable slot -> INCONCLUSIVE, the advisory
//                                          label)
//   12. no-stale-all-N-verdict ........... no "ALL <N> lanes/agents" block survives in the document
//   13. no-retired-spelling .............. no retired spelling survives in the document
//   plus two tree-wide repetitions of 12/13 over EVERY file under `skills/review-work/`.
//
// WHY THE FORBIDDEN TOKENS ARE ASSEMBLED FROM FRAGMENTS: this case polices a retired tool-name prefix
// and a retired state path under `skills/review-work/**`, so spelling them literally here would make this
// file the one place a future reader could grep a forbidden spelling out of. The two literals below are
// built from pieces for exactly that reason, never to hide what is being scanned for: the check ids and
// the failure messages name the rule, and the scan's findings quote the offending path.
//
// `--self-test` is fully offline: one positive control over a synthetic skill document, then one mutant
// per assertion — each mutant must redden for its OWN check id, which is what makes the observation
// discriminating rather than vacuously false — plus a temp-directory arm for the tree scanner. The real
// run reads the tree, writes `evidence/restore/s1/<utc-stamp>/{result.json,output.log}`, and exits 0 only
// when every check holds.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { ROLES } from "../../../packages/mpd-roles-plugin/src/roles.data.ts"
import type { MpdRoleSpec } from "../../../packages/mpd-roles-plugin/src/roles.data.ts"

/** The case slug: the failure banner, the self-test prefix and the evidence field all carry it. */
const SLUG: string = "review-panel"
/** The repository root, derived from this case's own URL (`<root>/skills/dsh-qa/scripts/`). */
const REPO_ROOT: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The directory this case polices: the review-work skill and everything beside it. */
const SKILL_DIR: string = join(REPO_ROOT, "skills", "review-work")
/** The skill document whose panel declaration is audited. */
const SKILL_FILE: string = join(SKILL_DIR, "SKILL.md")
/** Where a real run files its evidence (the captain's S1 copy). */
const EVIDENCE_ROOT: string = join(REPO_ROOT, "evidence", "restore", "s1")
/** The retired tool-name prefix, assembled from fragments (see the header note). */
const RETIRED_PREFIX: string = "team" + "_"
/** The retired team state path, assembled from fragments (see the header note). */
const RETIRED_STATE: string = "." + "mpd/teams"
/** The stale hard-coded lane/agent count block: the shape that must not come back. */
const STALE_VERDICT: RegExp = /ALL \d+ (?:lanes|agents)/
/** The panel table's role column header; combined with the discipline header it identifies the table. */
const ROLE_HEADER: string = "Roster role"
/** The panel table's discipline column header; the merge table does not carry it. */
const DISCIPLINE_HEADER: string = "Lane discipline"
/** The discipline every reviewer lane must declare (the lane contract, not the roster flag). */
const READ_ONLY: string = "read-only findings"
/** How many reviewer lanes the panel declares; the orchestrator's own lane is not one of them. */
const REVIEWER_LANES: number = 3
/** A role counts as findings-only by its roster description when that description says this much. */
const FINDINGS_ONLY: RegExp = /no fixes/i
/** The merge table is the table carrying BOTH of these headers (so the QA matrix table cannot match). */
const MERGE_HEADERS: readonly string[] = ["Lane", "Verdict"]
/** The three terminal verdict tokens the skill must declare, each backticked in the document. */
const VERDICT_TOKENS: readonly string[] = ["PASS", "FAIL", "INCONCLUSIVE"]
/** The degrade-matrix anchors: the one-shot fallback tool, the advisory label and the slot-failure token. */
const DEGRADE_ANCHORS: readonly string[] = ["mpd_role_spawn", "panel=advisory", "INCONCLUSIVE"]
/** The spelled-out lane counts the prose may use; a digit is accepted too. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}
/** The prose phrase the lane count is read from; absent or ambiguous input reddens `prose-lane-count`. */
const PROSE_COUNT: RegExp = /through exactly ([A-Za-z0-9]+) lanes/gi

/** One markdown table: its header cells and its body rows, in document order. */
interface MdTable {
  /** The header row's cells, trimmed, in column order. */
  readonly header: readonly string[]
  /** The body rows, each trimmed cell text; `rows.length` is the table's row count. */
  readonly rows: readonly (readonly string[])[]
  /** The 1-based line number of the header row, so a failure message can point at the table. */
  readonly line: number
}

/** One panel lane as the lane table declares it. */
interface LaneRow {
  /** The lane's display name (the `Lane` cell). */
  readonly lane: string
  /** The `Roster role` cell verbatim; an em-dash prefix marks the orchestrator's own lane. */
  readonly roleCell: string
  /** The `Lane discipline` cell verbatim. */
  readonly discipline: string
}

/** One assertion's outcome, reported verbatim in the evidence packet. */
interface Check {
  /** The stable check id (the table in this file's header names every one of them). */
  readonly id: string
  /** Whether the assertion held. */
  readonly ok: boolean
  /** One line of observed detail: counts, lane names, the offending value. */
  readonly detail: string
}

/** One forbidden token found in one file, quoted back with its path and line. */
interface Finding {
  /** The offending file, relative to the repository root. */
  readonly file: string
  /** The 1-based line number the token sits on. */
  readonly line: number
  /** The offending token. */
  readonly token: string
}

/** The whole tree-wide scan: the files read, plus the two classes of forbidden content. */
interface TreeScan {
  /** How many files were read. */
  readonly files: number
  /** Every retired spelling found, in file order. */
  readonly retired: readonly Finding[]
  /** Every stale hard-coded lane/agent count found, in file order. */
  readonly stale: readonly Finding[]
}

/** Report a failed case assertion on stderr and end the run with exit 1; never returns. */
function fail(message: string): never {
  console.error("[" + SLUG + "] FAIL: " + message)
  process.exit(1)
}

/** Whether a line is a markdown table row: it carries a pipe and some non-separator content. */
function isRow(line: string): boolean {
  /** The trimmed line, which is what the two tests below read. */
  const trimmed: string = line.trim()
  return trimmed.startsWith("|") && trimmed.length > 1
}

/** Whether a line is a markdown table separator row (`|---|:--:|`), which only a header can precede. */
function isSeparator(line: string): boolean {
  /** The trimmed line being classified. */
  const trimmed: string = line.trim()
  return isRow(trimmed) && /^\|[\s:|-]+\|$/.test(trimmed) && trimmed.includes("-")
}

/** Split one table row into its trimmed cells, dropping the empty cells the outer pipes produce. */
function cells(line: string): string[] {
  /** The trimmed row, so the leading and trailing pipes are in a known position. */
  const trimmed: string = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell: string): string => cell.trim())
}

/** Parse every markdown table in a document, in document order, ignoring fenced code blocks never. */
function parseTables(markdown: string): MdTable[] {
  /** The document's lines, split once and reused by every scan below. */
  const lines: string[] = markdown.split("\n").map((line: string): string => line.replace(/\r$/, ""))
  /** The tables collected so far. */
  const tables: MdTable[] = []
  /** The index of the line currently being examined. */
  let index: number = 0
  while (index < lines.length) {
    /** The current line. */
    const line: string = lines[index] ?? ""
    if (!(isRow(line) && isSeparator(lines[index + 1] ?? ""))) {
      index += 1
      continue
    }
    /** The header cells of the table that starts here. */
    const header: string[] = cells(line)
    /** Its body rows, collected until a non-row line ends it. */
    const rows: string[][] = []
    /** The 1-based line number of the header row. */
    const headerLine: number = index + 1
    index += 2
    while (index < lines.length && isRow(lines[index] ?? "")) {
      rows.push(cells(lines[index] ?? ""))
      index += 1
    }
    tables.push({ header, rows, line: headerLine })
  }
  return tables
}

/** The index of a header cell, or -1 when the table does not carry that column. */
function columnIndex(header: readonly string[], name: string): number {
  return header.findIndex((cell: string): boolean => cell === name)
}

/** Every table carrying ALL of the required header cells, in document order. */
function tablesWith(tables: readonly MdTable[], required: readonly string[]): MdTable[] {
  return tables.filter((table: MdTable): boolean => required.every((name: string): boolean => columnIndex(table.header, name) >= 0))
}

/** Read one table's lane rows: the lane name, the role cell and the discipline cell, all verbatim. */
function laneRowsOf(table: MdTable): LaneRow[] {
  /** Where the table keeps each of the three columns this case reads. */
  const laneAt: number = columnIndex(table.header, "Lane")
  /** The role column's index. */
  const roleAt: number = columnIndex(table.header, ROLE_HEADER)
  /** The discipline column's index. */
  const disciplineAt: number = columnIndex(table.header, DISCIPLINE_HEADER)
  return table.rows.map((row: readonly string[]): LaneRow => {
    return { lane: row[laneAt] ?? "", roleCell: row[roleAt] ?? "", discipline: row[disciplineAt] ?? "" }
  })
}

/** The lane count the opening sentence declares, mapped from a spelled number or a digit. */
function proseLaneCount(markdown: string): number | undefined {
  /** Every match of the anchored prose phrase; more than one would make the count ambiguous. */
  const matches: RegExpMatchArray[] = [...markdown.matchAll(PROSE_COUNT)]
  if (matches.length !== 1) return undefined
  /** The captured count token, lower-cased for the word lookup. */
  const token: string = (matches[0]?.[1] ?? "").toLowerCase()
  if (/^\d+$/.test(token)) return Number(token)
  return NUMBER_WORDS[token]
}

/** Every retired spelling in one document's text, in line order. */
function retiredSpellings(text: string): Array<{ line: number; token: string }> {
  /** The pattern of a retired tool prefix followed by a name, or the retired state path. */
  const pattern: RegExp = new RegExp("\\b" + RETIRED_PREFIX + "[A-Za-z_]+|" + RETIRED_STATE.replace(".", "\\.") + "[A-Za-z/]*", "g")
  /** The findings collected so far. */
  const found: Array<{ line: number; token: string }> = []
  /** The document's lines, numbered from 1 for the message. */
  const lines: string[] = text.split("\n")
  for (let index: number = 0; index < lines.length; index += 1) {
    /** The current line. */
    const line: string = lines[index] ?? ""
    for (const match of line.match(pattern) ?? []) found.push({ line: index + 1, token: match })
  }
  return found
}

/** Every stale hard-coded lane/agent count in one document's text, in line order. */
function staleVerdicts(text: string): Array<{ line: number; token: string }> {
  /** The findings collected so far. */
  const found: Array<{ line: number; token: string }> = []
  /** The document's lines, numbered from 1 for the message. */
  const lines: string[] = text.split("\n")
  for (let index: number = 0; index < lines.length; index += 1) {
    /** The current line. */
    const line: string = lines[index] ?? ""
    /** The stale block on this line, when it carries one. */
    const match: RegExpMatchArray | null = line.match(STALE_VERDICT)
    if (match !== null) found.push({ line: index + 1, token: match[0] })
  }
  return found
}

/** Every regular file under a directory, recursively, in sorted order. */
function walk(dir: string): string[] {
  /** The paths collected so far. */
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right): number => left.name.localeCompare(right.name))) {
    /** The absolute path of this entry. */
    const path: string = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

/** Scan the whole skill directory for the two forbidden classes, quoting every offender. */
function scanTree(dir: string): TreeScan {
  /** The files read by this scan. */
  const files: string[] = walk(dir)
  /** Every retired spelling found. */
  const retired: Finding[] = []
  /** Every stale verdict block found. */
  const stale: Finding[] = []
  for (const file of files) {
    /** The file's text, read once and scanned twice. */
    const text: string = readFileSync(file, "utf8")
    /** The repository-relative path quoted in the findings. */
    const shown: string = relative(REPO_ROOT, file)
    for (const hit of retiredSpellings(text)) retired.push({ file: shown, line: hit.line, token: hit.token })
    for (const hit of staleVerdicts(text)) stale.push({ file: shown, line: hit.line, token: hit.token })
  }
  return { files: files.length, retired, stale }
}

/** Audit one skill document against every check the panel declaration must satisfy. */
function audit(markdown: string, roles: readonly MpdRoleSpec[]): Check[] {
  /** The document's tables, parsed once for every assertion below. */
  const tables: MdTable[] = parseTables(markdown)
  /** Every check, in the order this file's header lists them. */
  const checks: Check[] = []
  /** The count the opening sentence declares. */
  const declared: number | undefined = proseLaneCount(markdown)
  checks.push({
    id: "prose-lane-count",
    ok: declared !== undefined,
    detail: declared === undefined ? "no unique 'through exactly <N> lanes' phrase" : "prose declares " + String(declared) + " lane(s)",
  })
  /** The panel lane tables: exactly one document is allowed to carry one. */
  const panelTables: MdTable[] = tablesWith(tables, [ROLE_HEADER, DISCIPLINE_HEADER])
  checks.push({
    id: "panel-lane-table",
    ok: panelTables.length === 1,
    detail: String(panelTables.length) + " table(s) carry both '" + ROLE_HEADER + "' and '" + DISCIPLINE_HEADER + "'",
  })
  if (panelTables.length !== 1 || declared === undefined) {
    checks.push({ id: "panel-table-count-equals-prose", ok: false, detail: "not evaluable without one panel table and a prose count" })
    checks.push({ id: "lane-roles-in-ROLES", ok: false, detail: "not evaluable without one panel table" })
    checks.push({ id: "read-only-lanes", ok: false, detail: "not evaluable without one panel table" })
    checks.push({ id: "roster-readonly-per-lane", ok: false, detail: "not evaluable without one panel table" })
    checks.push({ id: "merge-table-single", ok: false, detail: "merge-table checks skipped: the panel table is not usable" })
    checks.push({ id: "merge-table-lanes-match", ok: false, detail: "merge-table checks skipped: the panel table is not usable" })
    checks.push({ id: "merge-table-count-equals-prose", ok: false, detail: "merge-table checks skipped: the panel table is not usable" })
    checks.push(...tailChecks(markdown))
    return checks
  }
  /** The single panel table, safe to index: exactly one match was required just above. */
  const panel: MdTable = panelTables[0] as MdTable
  /** Its lane rows. */
  const lanes: LaneRow[] = laneRowsOf(panel)
  checks.push({
    id: "panel-table-count-equals-prose",
    ok: lanes.length === declared,
    detail: "panel table rows=" + String(lanes.length) + " prose=" + String(declared),
  })
  /** The roster role names the panel names, in row order. */
  const named: string[] = lanes.filter((lane: LaneRow): boolean => lane.roleCell !== "" && !lane.roleCell.startsWith("—")).map((lane: LaneRow): string => lane.roleCell)
  /** The named roles that are NOT members of the roster. */
  const unknown: string[] = named.filter((name: string): boolean => !roles.some((spec: MpdRoleSpec): boolean => spec.name === name))
  checks.push({
    id: "lane-roles-in-ROLES",
    ok: unknown.length === 0 && named.length === REVIEWER_LANES,
    detail: named.length === 0 ? "no lane names a roster role" : named.map((name: string): string => name + (unknown.includes(name) ? "=NOT-IN-ROLES" : "=in-ROLES")).join(" "),
  })
  /** The lanes that declare themselves read-only. */
  const readOnly: LaneRow[] = lanes.filter((lane: LaneRow): boolean => lane.discipline === READ_ONLY)
  checks.push({
    id: "read-only-lanes",
    ok: readOnly.length === REVIEWER_LANES,
    detail: String(readOnly.length) + " lane(s) carry '" + READ_ONLY + "'",
  })
  /** One line per read-only lane, naming the roster property that backs its read-only claim. */
  const qualifications: string[] = readOnly.map((lane: LaneRow): string => {
    /** The roster record this lane names, when it names one. */
    const spec: MpdRoleSpec | undefined = roles.find((candidate: MpdRoleSpec): boolean => candidate.name === lane.roleCell)
    if (spec === undefined) return lane.roleCell + "=NOT-IN-ROLES"
    if (spec.readonly) return lane.roleCell + "=roster-readonly"
    return FINDINGS_ONLY.test(spec.description) ? lane.roleCell + "=findings-only-by-description" : lane.roleCell + "=NOT-READ-ONLY"
  })
  checks.push({
    id: "roster-readonly-per-lane",
    ok: qualifications.length === REVIEWER_LANES && !qualifications.some((line: string): boolean => line.endsWith("NOT-READ-ONLY") || line.endsWith("NOT-IN-ROLES")),
    detail: qualifications.join(" ") || "no read-only lane to qualify",
  })
  /** The merge tables: exactly one document is allowed to carry one. */
  const mergeTables: MdTable[] = tablesWith(tables, MERGE_HEADERS)
  checks.push({
    id: "merge-table-single",
    ok: mergeTables.length === 1,
    detail: String(mergeTables.length) + " table(s) carry both " + MERGE_HEADERS.map((name: string): string => "'" + name + "'").join(" and "),
  })
  if (mergeTables.length !== 1) {
    checks.push({ id: "merge-table-lanes-match", ok: false, detail: "not evaluable without one merge table" })
    checks.push({ id: "merge-table-count-equals-prose", ok: false, detail: "not evaluable without one merge table" })
    checks.push(...tailChecks(markdown))
    return checks
  }
  /** The single merge table, safe to index: exactly one match was required just above. */
  const merge: MdTable = mergeTables[0] as MdTable
  /** Where the merge table keeps its lane column. */
  const laneAt: number = columnIndex(merge.header, "Lane")
  /** Its lanes, in row order. */
  const mergeLanes: string[] = merge.rows.map((row: readonly string[]): string => row[laneAt] ?? "")
  /** The panel's lanes, in row order. */
  const panelLanes: string[] = lanes.map((lane: LaneRow): string => lane.lane)
  checks.push({
    id: "merge-table-lanes-match",
    ok: mergeLanes.length === panelLanes.length && mergeLanes.every((lane: string, index: number): boolean => lane === panelLanes[index]),
    detail: "merge=[" + mergeLanes.join(", ") + "] panel=[" + panelLanes.join(", ") + "]",
  })
  checks.push({
    id: "merge-table-count-equals-prose",
    ok: mergeLanes.length === declared,
    detail: "merge rows=" + String(mergeLanes.length) + " prose=" + String(declared),
  })
  checks.push(...tailChecks(markdown))
  return checks
}

/** The checks that read the whole document rather than its tables. */
function tailChecks(markdown: string): Check[] {
  /** The verdict tokens missing from the document. */
  const missingTokens: string[] = VERDICT_TOKENS.filter((token: string): boolean => !markdown.includes("`" + token + "`"))
  /** The degrade anchors missing from the document. */
  const missingAnchors: string[] = DEGRADE_ANCHORS.filter((anchor: string): boolean => !markdown.includes(anchor))
  /** The stale verdict blocks in the document's own text. */
  const stale: Array<{ line: number; token: string }> = staleVerdicts(markdown)
  /** The retired spellings in the document's own text. */
  const retired: Array<{ line: number; token: string }> = retiredSpellings(markdown)
  return [
    { id: "verdict-tokens", ok: missingTokens.length === 0, detail: missingTokens.length === 0 ? VERDICT_TOKENS.join(" ") + " all declared" : "missing " + missingTokens.join(" ") },
    { id: "degrade-matrix", ok: missingAnchors.length === 0, detail: missingAnchors.length === 0 ? DEGRADE_ANCHORS.join(" ") + " all written down" : "missing " + missingAnchors.join(" ") },
    { id: "no-stale-all-N-verdict", ok: stale.length === 0, detail: stale.length === 0 ? "no hard-coded lane/agent count" : stale.map((hit): string => hit.token + " at line " + String(hit.line)).join(", ") },
    { id: "no-retired-spelling", ok: retired.length === 0, detail: retired.length === 0 ? "no retired spelling" : retired.map((hit): string => hit.token + " at line " + String(hit.line)).join(", ") },
  ]
}

/** Render the check list as the human-readable report, one line per check, then the verdict line. */
function render(checks: readonly Check[]): string {
  /** Every failing check, which is what the verdict line counts. */
  const failed: Check[] = checks.filter((check: Check): boolean => !check.ok)
  /** The report's lines: the header, one line per check, then the verdict. */
  const lines: string[] = [
    "[" + SLUG + "] panel declaration audit",
    "checks: " + String(checks.length) + "  failed: " + String(failed.length),
  ]
  for (const check of checks) lines.push((check.ok ? "  ok   " : "  FAIL ") + check.id + " — " + check.detail)
  lines.push(failed.length === 0 ? "[" + SLUG + "] PASS" : "[" + SLUG + "] FAIL: " + failed.map((check: Check): string => check.id).join(", "))
  return lines.join("\n") + "\n"
}

/** A synthetic skill document that satisfies every check, used as the positive control. */
const FIXTURE: string = [
  "# Panel Gate Review Orchestrator",
  "",
  "Review completed implementation work through exactly four lanes: your own hands-on manual QA on the real surface, plus three read-only reviewer lanes spawned as roster-named teammates.",
  "",
  "## The panel lanes",
  "",
  "| # | Lane | Roster role | Lane discipline | Question it answers |",
  "|---|------|-------------|-----------------|---------------------|",
  "| 1 | Manual QA | — (the orchestrator, in person) | hands-on, never edits | Does it actually work? |",
  "| 2 | Quality & architecture | Architect | read-only findings | Is it built well? |",
  "| 3 | Correctness & risk | Reviewer | read-only findings | Is it correct and safe? |",
  "| 4 | Missed context | Explorer | read-only findings | What did the change miss? |",
  "",
  "## Degrade matrix",
  "",
  "Spawn each lane one-shot with `mpd_role_spawn`; a lane whose model slot cannot resolve is INCONCLUSIVE and names the member and the slot; when the roles plugin is unmounted the lanes are labelled panel=advisory.",
  "",
  "## The merge table",
  "",
  "The verdict tokens are exactly `PASS`, `FAIL` and `INCONCLUSIVE`.",
  "",
  "| Lane | Roster role | Verdict | Evidence |",
  "|------|-------------|---------|----------|",
  "| Manual QA | — (the orchestrator) | PASS | a |",
  "| Quality & architecture | Architect | PASS | b |",
  "| Correctness & risk | Reviewer | PASS | c |",
  "| Missed context | Explorer | PASS | d |",
  "",
].join("\n")

/** One negative-control arm: a mutant document plus the check id it must redden. */
interface Arm {
  /** What the arm proves, printed on success. */
  readonly what: string
  /** The mutant document. */
  readonly text: string
  /** The check id that must be false for the mutant. */
  readonly reddens: string
}

/** Build the negative-control arms: one mutant per assertion, each with the check it must redden. */
function arms(): Arm[] {
  return [
    { what: "a lane renamed to a non-roster role reddens lane-roles-in-ROLES", text: FIXTURE.replace("| Architect | read-only findings |", "| Gatekeeper | read-only findings |"), reddens: "lane-roles-in-ROLES" },
    { what: "a prose count that disagrees with the tables reddens merge-table-count-equals-prose", text: FIXTURE.replace("through exactly four lanes", "through exactly five lanes"), reddens: "merge-table-count-equals-prose" },
    { what: "a merge table missing a lane reddens merge-table-lanes-match", text: FIXTURE.replace("| Missed context | Explorer | PASS | d |\n", ""), reddens: "merge-table-lanes-match" },
    { what: "a lane that stops declaring read-only findings reddens read-only-lanes", text: FIXTURE.replace("| Reviewer | read-only findings |", "| Reviewer | read-write |"), reddens: "read-only-lanes" },
    { what: "a second merge table reddens merge-table-single", text: FIXTURE + FIXTURE.split("## The merge table")[1], reddens: "merge-table-single" },
    { what: "a missing degrade anchor reddens degrade-matrix", text: FIXTURE.replace("panel=advisory", "labelled otherwise"), reddens: "degrade-matrix" },
    { what: "a missing verdict token reddens verdict-tokens", text: FIXTURE.replace("`FAIL`", "FAIL"), reddens: "verdict-tokens" },
    { what: "a stale hard-coded lane count reddens no-stale-all-N-verdict", text: FIXTURE + "\nALL 5 lanes returned PASS\n", reddens: "no-stale-all-N-verdict" },
    { what: "a retired spelling reddens no-retired-spelling", text: FIXTURE + "\nrun " + RETIRED_PREFIX + "task_create first\n", reddens: "no-retired-spelling" },
  ]
}

/** The offline self-test: a positive control, one mutant per assertion, and a tree-scan arm. */
function selfTest(): number {
  /** The failures collected by this run, so every arm reports rather than only the first. */
  const failures: string[] = []
  /** The positive control: the fixture must satisfy every check. */
  const baseline: Check[] = audit(FIXTURE, ROLES)
  /** The baseline checks that are false. */
  const baselineRed: Check[] = baseline.filter((check: Check): boolean => !check.ok)
  if (baselineRed.length > 0) failures.push("positive control reddened: " + baselineRed.map((check: Check): string => check.id + " (" + check.detail + ")").join(", "))
  else console.log("[" + SLUG + " self-test] ok: positive control passes all " + String(baseline.length) + " checks")
  for (const arm of arms()) {
    /** The mutant's checks. */
    const mutant: Check[] = audit(arm.text, ROLES)
    /** The check the mutant was required to redden. */
    const target: Check | undefined = mutant.find((check: Check): boolean => check.id === arm.reddens)
    if (target === undefined) failures.push(arm.what + " -> check id " + arm.reddens + " missing")
    else if (target.ok) failures.push(arm.what + " -> did NOT redden (" + target.detail + ")")
    else console.log("[" + SLUG + " self-test] ok: " + arm.what)
  }
  /** A throwaway directory holding a poisoned file, to exercise the tree scanner. */
  const poisonDir: string = join(tmpdir(), SLUG + "-selftest-tree")
  rmSync(poisonDir, { recursive: true, force: true })
  mkdirSync(poisonDir, { recursive: true })
  writeFileSync(join(poisonDir, "poisoned.md"), "| Lane | Verdict |\n|---|---|\n| x | PASS |\n" + RETIRED_PREFIX + "task_create and " + RETIRED_STATE + "/x\nALL 5 lanes\n", "utf8")
  writeFileSync(join(poisonDir, "clean.md"), FIXTURE, "utf8")
  /** The scan of the poisoned directory. */
  const scan: TreeScan = scanTree(poisonDir)
  if (scan.files !== 2) failures.push("tree scan read " + String(scan.files) + " file(s), expected 2")
  else if (scan.retired.length !== 2 || scan.stale.length !== 1) failures.push("tree scan found retired=" + String(scan.retired.length) + " stale=" + String(scan.stale.length) + ", expected 2 and 1")
  else console.log("[" + SLUG + " self-test] ok: tree scan finds both retired spellings and the stale count, and only in the poisoned file (" + scan.retired.map((hit: Finding): string => hit.file + ":" + String(hit.line)).join(", ") + ")")
  /** The clean tree arm: the fixture file alone must scan clean. */
  const cleanDir: string = join(tmpdir(), SLUG + "-selftest-clean")
  rmSync(cleanDir, { recursive: true, force: true })
  mkdirSync(cleanDir, { recursive: true })
  writeFileSync(join(cleanDir, "clean.md"), FIXTURE, "utf8")
  /** The scan of the clean directory. */
  const cleanScan: TreeScan = scanTree(cleanDir)
  if (cleanScan.retired.length !== 0 || cleanScan.stale.length !== 0) failures.push("clean tree scan reported retired=" + String(cleanScan.retired.length) + " stale=" + String(cleanScan.stale.length))
  else console.log("[" + SLUG + " self-test] ok: a clean tree scans clean (negative control holds in both directions)")
  rmSync(poisonDir, { recursive: true, force: true })
  rmSync(cleanDir, { recursive: true, force: true })
  if (failures.length > 0) {
    for (const failure of failures) console.error("[" + SLUG + " self-test] FAIL: " + failure)
    return 1
  }
  console.log("[" + SLUG + " self-test] all arms passed")
  return 0
}

/** The real run: audit the shipped skill, scan the tree, file the evidence, print the verdict. */
function main(): number {
  /** The skill document under audit. */
  const markdown: string = readFileSync(SKILL_FILE, "utf8")
  /** Every check over the document plus the two tree-wide repetitions. */
  const checks: Check[] = audit(markdown, ROLES)
  /** The tree-wide scan of the whole skill directory. */
  const scan: TreeScan = scanTree(SKILL_DIR)
  checks.push({
    id: "tree-no-retired-spelling",
    ok: scan.retired.length === 0,
    detail: String(scan.files) + " file(s) scanned; " + (scan.retired.length === 0 ? "no retired spelling" : scan.retired.map((hit: Finding): string => hit.file + ":" + String(hit.line) + " " + hit.token).join(", ")),
  })
  checks.push({
    id: "tree-no-stale-all-N-verdict",
    ok: scan.stale.length === 0,
    detail: String(scan.files) + " file(s) scanned; " + (scan.stale.length === 0 ? "no hard-coded lane/agent count" : scan.stale.map((hit: Finding): string => hit.file + ":" + String(hit.line) + " " + hit.token).join(", ")),
  })
  /** The rendered report, which is both stdout and the evidence log. */
  const report: string = render(checks)
  /** The UTC stamp naming this run's evidence directory (colons and dots made filename-safe). */
  const stamp: string = new Date().toISOString().replace(/[:.]/g, "-")
  /** This run's evidence directory. */
  const outDir: string = join(EVIDENCE_ROOT, stamp)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "output.log"), report, "utf8")
  writeFileSync(
    join(outDir, "result.json"),
    JSON.stringify(
      {
        case: SLUG,
        stamp,
        ok: checks.every((check: Check): boolean => check.ok),
        skill: relative(REPO_ROOT, SKILL_FILE),
        rolesSource: "packages/mpd-roles-plugin/src/roles.data.ts",
        checks,
        treeScan: { files: scan.files, retired: scan.retired, stale: scan.stale },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
  process.stdout.write(report)
  console.log("[" + SLUG + "] evidence -> " + relative(REPO_ROOT, outDir))
  return checks.every((check: Check): boolean => check.ok) ? 0 : 1
}

// `--self-test` runs the offline fixture arms; the bare run audits the tree. `--list` is not offered:
// this case has no skippable prerequisite, so it either passes or fails.
if (process.argv.includes("--self-test")) process.exit(selfTest())
if (!existsSync(SKILL_FILE)) fail("missing " + relative(REPO_ROOT, SKILL_FILE))
process.exit(main())
