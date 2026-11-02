// THE ONE INDEPENDENT DECISION the autoproject engine still takes: a deterministic, composite
// over-limit predicate, plus the pure readers that turn a roster report into engine state.
//
// PURE BY CONSTRUCTION — no adapter import, no `ctx`, no filesystem. Every helper here is a function of
// its arguments, so the predicate can be unit-tested without a boot and there is exactly ONE place in
// the package where escalation, scope derivation or the roster's fixed report vocabulary can drift.
//
// THE PREDICATE (frozen, wave W1-B2; S5 RETIRED by the R-W1B2 ruling, 2026-11-02):
//   S1 criteria > criteriaMax(12)      S2 status == max-rounds        S3 fruitless waves >= 2
//   S4 ledger bytes > ledgerBytesMax   S6 distinct scope trees > scopePathsMax(20)
//   S7 same-criterion verify FAILs >= verifyFailsMax(2)
//   escalate = S2 || S3 || count(S1, S4, S6, S7) >= 2
//
// WHY S5 IS GONE, and why its ID is not reused: S5 read `checklist > tasksMax`, but CUT 3 makes the plan
// checklist be EMITTED from the run's criteria, so the engine fed the predicate one number twice
// (`checklist` was always `criteria.size`). A 13-criteria run therefore supplied TWO counters for ONE
// fact and escalated by itself, defeating the composite rule this predicate exists for. S5 is removed
// rather than renumbered: the ids are the wire vocabulary of every ledger line and `escalation.json` ever
// written, so a reader must tolerate an id going ABSENT, never see S6/S7 move.
//
// The MODE (`off` | `ask` | `auto`) decides only what happens NEXT once the predicate fired; it never
// decides whether a signal fired.

/** What happens NEXT after the over-limit predicate fires. */
export type EscalationMode = "off" | "ask" | "auto"

/** The resolved escalation knobs for ONE call, read per call and never captured at mount. */
export interface EscalationConfig {
  /** What to do once the predicate fires; `off` suppresses the consequence, never the evaluation. */
  mode: EscalationMode
  /** S1's ceiling on the run's success criteria. */
  criteriaMax: number
  /**
   * The retired S5's ceiling. RETAINED ON PURPOSE: `autoproject.escalate.tasksMax` is named by the plan's
   * knob list and a `.mpd/mpd.jsonc` that sets it must parse, but NO signal reads it since S5 was dropped
   * (the checklist and the criteria are one number by construction). Reading it would be the defect.
   */
  tasksMax: number
  /** S6's ceiling on the distinct top-level scope trees the run declared. */
  scopePathsMax: number
  /** S7's ceiling on the FAIL count of any ONE criterion's verification. */
  verifyFailsMax: number
  /** S4's ceiling on the run's ledger size in bytes. */
  ledgerBytesMax: number
}

/** The documented defaults, used for every knob the caller did not declare. */
export const ESCALATION_DEFAULTS: EscalationConfig = {
  mode: "ask",
  criteriaMax: 12,
  tasksMax: 8,
  scopePathsMax: 20,
  verifyFailsMax: 2,
  ledgerBytesMax: 262144
}

/** The config PREFIX every escalation knob hangs off (`.mpd/mpd.jsonc` spells the leaves below it). */
export const ESCALATE_PREFIX = "autoproject.escalate"

/**
 * Read ONE escalation knob from the two config layers, live layer first.
 *
 * The engine builds this reader per call, so a `.mpd/mpd.jsonc` edit takes effect on the NEXT run
 * (T-18) instead of waiting for a boot: the knobs are deliberately OUTSIDE the settings namespace, so
 * they are never captured by a mount-time snapshot.
 *
 * @param live - the mounted `mpdConfig` service's `get`, or undefined when the composition has none.
 * @param row - the row config's `escalate` block, the second layer.
 * @returns a reader answering the live value, then the row value, then `undefined`.
 */
export function escalationReader(live: ((key: string) => unknown) | undefined, row: unknown): (key: string) => unknown {
  /** The row's `escalate` block, narrowed to a plainly-readable record. */
  const block = row !== null && typeof row === "object" ? (row as Record<string, unknown>) : undefined
  return (key: string): unknown => {
    try {
      /** The live layer's answer for this key. */
      const value = live?.(key)
      if (value !== undefined && value !== null) return value
    } catch {
      // A live layer that throws reads as ABSENT, which keeps the row layer (and then the default) in force.
    }
    if (block === undefined) return undefined
    /** The leaf name, which is the part of the dotted key the row block declares. */
    const leaf = key.startsWith(ESCALATE_PREFIX + ".") ? key.slice(ESCALATE_PREFIX.length + 1) : key
    return block[leaf]
  }
}

/**
 * The escalation mode a configured value selects.
 *
 * @param value - the raw `autoproject.escalate.mode` value, of any type.
 * @returns `off` | `ask` | `auto`, defaulting to `ask` for an absent or unknown value — the mode that
 *   stops for a human is the safe default, and it never silently escalates on its own.
 */
export function resolveEscalationMode(value: unknown): EscalationMode {
  if (value === "off" || value === "auto" || value === "ask") return value
  return ESCALATION_DEFAULTS.mode
}

/**
 * A positive integer out of a configured value, else the documented default.
 *
 * @param value - the raw knob value.
 * @param fallback - the default this knob uses.
 * @returns the declared positive integer, or `fallback` for anything else.
 */
function positiveIntOf(value: unknown, fallback: number): number {
  /** The numeric reading of the raw value; `NaN` for anything non-numeric. */
  const n = typeof value === "number" ? value : Number.NaN
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/**
 * Resolve every escalation knob for ONE call.
 *
 * @param read - the layered reader {@link escalationReader} builds.
 * @returns the resolved knobs, each falling back to {@link ESCALATION_DEFAULTS}.
 */
export function resolveEscalationConfig(read: (key: string) => unknown): EscalationConfig {
  return {
    mode: resolveEscalationMode(read(ESCALATE_PREFIX + ".mode")),
    criteriaMax: positiveIntOf(read(ESCALATE_PREFIX + ".criteriaMax"), ESCALATION_DEFAULTS.criteriaMax),
    tasksMax: positiveIntOf(read(ESCALATE_PREFIX + ".tasksMax"), ESCALATION_DEFAULTS.tasksMax),
    scopePathsMax: positiveIntOf(read(ESCALATE_PREFIX + ".scopePathsMax"), ESCALATION_DEFAULTS.scopePathsMax),
    verifyFailsMax: positiveIntOf(read(ESCALATE_PREFIX + ".verifyFailsMax"), ESCALATION_DEFAULTS.verifyFailsMax),
    ledgerBytesMax: positiveIntOf(read(ESCALATE_PREFIX + ".ledgerBytesMax"), ESCALATION_DEFAULTS.ledgerBytesMax)
  }
}

/** One criterion of the run, in the ladder vocabulary the state document records. */
export interface RunCriterion {
  /** The stable key the plan checklist and the roster reports attribute evidence to. */
  key: string
  /** The criterion's one-line success measure. */
  label: string
  /** The ladder state; only `clean` counts as satisfied. */
  state: "pin" | "red" | "green" | "surface" | "clean"
  /** The proof entries attributed to this criterion, in arrival order. */
  evidence: string[]
}

/** One signal the predicate evaluated: what it read, the threshold it read it against, and whether it fired. */
export interface EscalationSignal {
  /** The frozen signal id (`S1`..`S7`). */
  id: string
  /** The value observed at the boundary. */
  value: number
  /** The threshold that value was compared with. */
  threshold: number
}

/** The predicate's answer for ONE boundary. */
export interface EscalationDecision {
  /** Whether the composite predicate fired. */
  escalate: boolean
  /** The signals that FIRED, in `S1`..`S7` order — never the ones that merely evaluated. */
  signals: EscalationSignal[]
}

/** Everything the predicate reads at one round boundary. */
export interface EscalationInput {
  /** How many success criteria the run accumulated (S1). */
  criteria: number
  /** The run's status at this boundary, e.g. `max-rounds` (S2). */
  status: string
  /** How many consecutive rounds produced neither evidence nor progress (S3). */
  fruitlessWaves: number
  /** The run ledger's size in bytes (S4). */
  ledgerBytes: number
  /** How many DISTINCT top-level trees the run's declared scope covers (S6). */
  scopeTrees: number
  /** The highest per-criterion verify-FAIL count (S7). */
  sameCriterionVerifyFails: number
  /** The resolved knobs. */
  config: EscalationConfig
}

/**
 * Evaluate the frozen over-limit predicate for ONE round boundary.
 *
 * Deliberately total and allocation-light: no IO, no throws, and the same input always answers the
 * same decision, which is what makes "the engine escalated here" reproducible evidence.
 *
 * @param input - the boundary's observed values and the resolved knobs.
 * @returns whether to escalate, plus the signals that fired.
 */
export function evaluateEscalation(input: EscalationInput): EscalationDecision {
  /** The signals that fired, built in id order by the checks below. */
  const fired: EscalationSignal[] = []
  // S1/S4/S6/S7 are COUNTER signals: any two of them together already mean "severely over-limit".
  if (input.criteria > input.config.criteriaMax) fired.push({ id: "S1", value: input.criteria, threshold: input.config.criteriaMax })
  // S2 is the round cap itself: the engine ran out of its own budget.
  if (input.status === "max-rounds") fired.push({ id: "S2", value: 1, threshold: 1 })
  // S3 is the discovery stall the discipline already stops on.
  if (input.fruitlessWaves >= 2) fired.push({ id: "S3", value: input.fruitlessWaves, threshold: 2 })
  if (input.ledgerBytes > input.config.ledgerBytesMax) fired.push({ id: "S4", value: input.ledgerBytes, threshold: input.config.ledgerBytesMax })
  if (input.scopeTrees > input.config.scopePathsMax) fired.push({ id: "S6", value: input.scopeTrees, threshold: input.config.scopePathsMax })
  if (input.sameCriterionVerifyFails >= input.config.verifyFailsMax) fired.push({ id: "S7", value: input.sameCriterionVerifyFails, threshold: input.config.verifyFailsMax })
  /** How many of the counter signals fired. */
  const counters = fired.filter((s) => s.id !== "S2" && s.id !== "S3").length
  /** Whether the two self-sufficient signals fired. */
  const selfSufficient = fired.some((s) => s.id === "S2" || s.id === "S3")
  return { escalate: selfSufficient || counters >= 2, signals: fired }
}

/** The status a round child declares, when it declared a readable one. */
export type DeclaredStatus = "continue" | "complete" | "blocked"

/** The status token the round child puts on the FIRST line of its `recommendation`. */
const STATUS_LINE = /^[*_\s`]*status[*_\s`]*[:=]\s*[*_\s`]*(continue|complete|blocked)\b/i

/** The verdict token a review child puts on the FIRST line of its `recommendation`. */
const VERDICT_LINE = /^[*_\s`]*verdict[*_\s`]*[:=]\s*[*_\s`]*(pass|fail|approve|reject)\b/i

/** The plan-review requirement token the planner puts on the FIRST line of its `recommendation`. */
const REVIEW_LINE = /^[*_\s`]*review[*_\s`]*[:=]\s*[*_\s`]*(required|optional)\b/i

/**
 * The status a round child declared, read from the FIRST line of its `recommendation`.
 *
 * The roster's fixed report schema has no status field, so the engine parses the one field it can pin:
 * `recommendation`'s first line. Anything unreadable answers `undefined`, and the caller treats that as
 * "keep working" — the conservative direction, since a run must never claim completion on a parse miss.
 *
 * @param recommendation - the child's `recommendation` text.
 * @returns the declared status, or `undefined` when the first line carries none.
 */
export function recommendationStatus(recommendation: string): DeclaredStatus | undefined {
  /** The text's first non-empty line, which is where the protocol puts the token. */
  const first = String(recommendation ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "") ?? ""
  /** The token match on that line. */
  const match = STATUS_LINE.exec(first)
  return match === null ? undefined : (match[1].toLowerCase() as DeclaredStatus)
}

/**
 * The verdict a review child declared, read from the FIRST line of its `recommendation`.
 *
 * `approve`/`pass` both answer `PASS` and `reject`/`fail` both answer `FAIL`, so a lane cannot pass the
 * gate by choosing a synonym the parser did not expect.
 *
 * @param recommendation - the child's `recommendation` text.
 * @returns `PASS`, `FAIL`, or `undefined` when the first line carries no verdict.
 */
export function recommendationVerdict(recommendation: string): "PASS" | "FAIL" | undefined {
  /** The text's first non-empty line. */
  const first = String(recommendation ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "") ?? ""
  /** The token match on that line. */
  const match = VERDICT_LINE.exec(first)
  if (match === null) return undefined
  /** The token, lower-cased for the two accepted spellings. */
  const token = match[1].toLowerCase()
  return token === "pass" || token === "approve" ? "PASS" : "FAIL"
}

/**
 * Whether the planner asked for a read-only plan review.
 *
 * @param recommendation - the planner's `recommendation` text.
 * @returns true only for an explicit `REVIEW: required`; an absent line answers false, and the caller
 *   still forces the review for the HEAVY tier.
 */
export function reviewRequired(recommendation: string): boolean {
  /** The text's first non-empty line. */
  const first = String(recommendation ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "") ?? ""
  /** The token match on that line. */
  const match = REVIEW_LINE.exec(first)
  return match !== null && match[1].toLowerCase() === "required"
}

/**
 * Split one evidence entry into the criterion it proves and the proof text.
 *
 * THE ONE ATTRIBUTION RULE: an entry opening `<key>:: ` belongs to that criterion. Everything else is
 * run-level evidence the engine keeps but attributes to no single criterion. It is a strict prefix
 * match on purpose — a prose sentence that merely mentions a key must not mark it clean.
 *
 * @param entry - one evidence string from a roster report.
 * @returns the key and its proof text, or `undefined` when the entry attributes nothing.
 */
export function evidenceAttribution(entry: string): { key: string; text: string } | undefined {
  /** The prefix match: a short token, `::`, then the proof. */
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,31})\s*::\s*([\s\S]*)$/.exec(String(entry ?? ""))
  return match === null ? undefined : { key: match[1], text: match[2].trim() }
}

/**
 * The DISTINCT top-level trees a set of evidence entries declares as the run's write scope.
 *
 * The run has no scope argument, so its declared scope is the one thing it actually recorded: the
 * workspace-relative paths its children evidenced. Only path-shaped entries count (a relative path with
 * at least one `/`), absolute paths, `~` paths and URLs are ignored, and the result is the set of first
 * segments — which is exactly what S6 counts and what the verify loop's `scope` receives.
 *
 * @param entries - the evidence strings collected across the run.
 * @returns the distinct first segments, in first-appearance order.
 */
export function topLevelScope(entries: readonly string[]): string[] {
  /** The distinct trees, in first-appearance order. */
  const trees: string[] = []
  for (const raw of entries) {
    /** The entry with a leading `./` removed. */
    const text = String(raw ?? "").trim().replace(/^\.\//, "")
    // A non-relative spelling names no tree this run owns: a URL, an absolute path, or a home path.
    if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/|~)/.test(text)) continue
    if (!text.includes("/")) continue
    /** The first segment, which is the tree. */
    const segment = text.split("/")[0]
    if (segment === undefined || segment === "" || segment === "." || segment === "..") continue
    if (!trees.includes(segment)) trees.push(segment)
  }
  return trees
}

/**
 * One criterion label, normalized for the plan checklist and the state document.
 *
 * @param raw - the planner's raw criterion text.
 * @returns the label with a leading enumerator and bullet removed, whitespace collapsed and the length
 *   capped, so the emitted `## TODOs` line stays a single parseable line.
 */
export function criterionLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\s*(?:[1-9]\d*[.)]|[-*])\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

/** The heading that opens boulder's TODO section; any earlier occurrence is stripped before emitting. */
const TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i

/** The second heading boulder counts; also stripped so a child's prose cannot inflate the checklist. */
const FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i

/** A section boundary: any level-1 or level-2 heading ends the section being dropped. */
const SECTION_HEADING = /^#{1,2}(?:[ \t]+|$)/

/**
 * Strip every `## TODOs` and `## Final Verification Wave` section from a plan's prose.
 *
 * The engine EMITS the checklist itself from the planner's criteria, because boulder's progress reader
 * counts those two sections structurally. A planner that also wrote one would otherwise be counted
 * twice, and hand-written prose would decide a machine-read count.
 *
 * @param markdown - the planner's plan text.
 * @returns the text with both counted sections removed.
 */
export function stripChecklistSections(markdown: string): string {
  /** Lines kept, in original order. */
  const kept: string[] = []
  /** Whether the scan is inside a stripped section. */
  let dropping = false
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (TODO_HEADING.test(line) || FINAL_WAVE_HEADING.test(line)) { dropping = true; continue }
    if (dropping && SECTION_HEADING.test(line)) dropping = false
    if (!dropping) kept.push(line)
  }
  return kept.join("\n")
}

/** One seeded criterion: the key and label the plan checklist and the accumulator share. */
export interface PlanCriterionSeed {
  /** The stable criteria key (`1`..`n`). */
  key: string
  /** The criterion's one-line label. */
  label: string
}

/**
 * Emit a plan document with a DETERMINISTIC boulder checklist.
 *
 * The `## TODOs` section is generated from the criteria and nothing else, in the numbered
 * `- [ ] N. label` form boulder's structured grammar counts, so `mpd_boulder_plan_progress` always
 * reports exactly as many items as the run has criteria.
 *
 * @param plan - the planner's plan markdown, whose own counted sections are stripped first.
 * @param criteria - the run's seeded criteria, in order.
 * @returns the complete plan document.
 */
export function emitPlanMarkdown(plan: string, criteria: readonly PlanCriterionSeed[]): string {
  /** The prose half, with the machine-counted sections removed. */
  const body = stripChecklistSections(plan).trimEnd()
  /** The generated checklist, one numbered item per criterion. */
  const items = criteria.map((criterion, index) => "- [ ] " + (index + 1) + ". " + criterion.label).join("\n")
  return (body === "" ? "# Autoproject plan" : body) + "\n\n## TODOs\n\n" + items + "\n"
}
