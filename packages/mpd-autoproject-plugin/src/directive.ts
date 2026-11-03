// THE PROMPT TEXTS of the autoproject discipline, held apart from the engine that consumes them.
//
// Two DIFFERENT texts live here and they must never be folded into one another:
//
//   * `DIRECTIVE` heads every EXECUTION child's prompt. It is a child policy — what one round of work
//     must do — and it points the child at MPD's own toolchain instead of prescribing a parallel engine.
//   * `AUTOPROJECT_ACTIVATION_DIRECTIVE` is the user-role message a `/autoproject` invocation injects
//     into the INVOKING session. It carries the run's activation policy, and since wave W1-B2 that
//     policy is BOUNDED: the run executes autonomously but stops for a human at exactly three named
//     decision points. A blanket "ask the user nothing" clause was DELETED here (it is the standing
//     defect this wave repairs) and replaced by ONE closing clause that names those three points.
//
// WHY THE HEAD IS A SEPARATE CONSTANT (prefix-cache discipline): the DeepSeek V4 prefix cache keys on
// the FIRST bytes of the prompt. The head below is byte-stable across objectives and across gate
// verdicts — the objective and the TEAM GATE block are appended AFTER it — so the cached prefix is
// never invalidated by a different objective or a different gate outcome. Its sha256 is recorded under
// `evidence/autoproject-refactor/w1b2/activation-head.sha256` and READ by the test suite, so a wording
// edit is a deliberate act rather than a silent drift.

/**
 * One adversarial hyperplan ANGLE: a stable id plus the attack the angle must run.
 *
 * The field is `angleId`, NOT `persona`: these are prompt angles handed to a roster `Architect`
 * consult as its `context`, and the roster — not this table — owns who plays them. Naming them
 * personas is what made the retired `PERSONAS` map look like a second roster.
 */
export interface AdversarialAngle {
  /** Stable id for the angle, used in the child's label and in ledger lines. */
  angleId: string
  /** The attack this angle must run, verbatim. */
  angle: string
}

/** The five hyperplan angles, in the order a run raises them. */
export const ADVERSARIAL_CATEGORIES: readonly AdversarialAngle[] = [
  { angleId: "unspecified-low", angle: "attack assumptions that are not stated; find implicit scope creep." },
  { angleId: "unspecified-high", angle: "attack unstated correctness and completeness claims; find missing edge cases." },
  { angleId: "deep", angle: "attack the deepest correctness risks; find design mistakes before they cost a redo." },
  { angleId: "ultrabrain", angle: "attack from first principles; propose the cheapest faithful path to proof." },
  { angleId: "artistry", angle: "attack clarity, structure, and maintainability; find the ugly design that will age badly." }
]

/**
 * The fixed child policy for ONE execution round, as a byte-stable prompt head.
 *
 * It states the protocol the ENGINE actually parses: the round child's `recommendation` must OPEN with
 * `STATUS: continue|complete|blocked`, and an evidence entry must be attributed to its criterion with a
 * `<key>:: ` prefix, because the roster's fixed report carries no criterion array. Everything else is
 * the discipline's shape (tier, PIN→RED→GREEN→SURFACE→CLEAN, evidence, subagent barrier).
 */
export const DIRECTIVE = [
  "AUTOPROJECT ROUND (fixed policy; one round of an automated MPD session)",
  "Role: expert coding agent. Ship verified work; no process narration.",
  "Tier: LIGHT (known pattern, 1-2 success criteria, one real-surface proof, notepad self-review) or HEAVY (new module/abstraction, auth/security, external integration, schema/migration, concurrency, cross-domain refactor, or the user said carefully: 3+ success criteria incl. happy+edge+regression+adversarial, reviewer loop until unconditional approval). When unsure take HEAVY; never downgrade mid-task.",
  "Toolchain: this run reuses MPD's own planes — use `mpd_role_spawn` for a bounded question you cannot answer yourself, record verification through the `mpd_verify_*` plane, and keep the durable ledger through `mpd_boulder_*`. Do not stand up a parallel engine of your own.",
  "Per-criterion loop: PIN (name the criterion + success measure) -> RED (failing-first proof) -> GREEN (cheapest faithful change) -> SURFACE (exercise the real surface) -> CLEAN (self-review, record cleanup receipts). Repeat until ALL criteria are clean.",
  "Evidence discipline: never suppress failures; capture artifacts; tests alone never prove done. Attribute a proof to its criterion by starting the evidence entry with `<key>:: ` so the engine can place it.",
  "Subagent barrier: no done/final answer while children are non-terminal.",
  "End with ONLY the structured report (role/summary/recommendation/details/evidence). The FIRST LINE of `recommendation` MUST be `STATUS: continue|complete|blocked`: continue means work remains, complete means every criterion is clean, blocked needs a concrete blocker in `summary`. Extra headings are noise.",
].join("\n")

/**
 * The activation policy injected as the invoking session's own next user turn.
 *
 * Clause 3 keeps the plan-approval route but BOUNDS it to a mechanical gate verdict and an in-scope
 * write scope; clause 7 is the ONE place the run's stops are named. The head is byte-stable and is the
 * prefix the cache keys on.
 */
export const AUTOPROJECT_ACTIVATION_DIRECTIVE = [
  "AUTOPROJECT ACTIVATION (user-invoked; execute autonomously, and stop for a human ONLY at the three decision points below)",
  "1. TRIAGE FIRST: when the objective is unclear, or the task is investigate-first-then-execute, run one normal-MPD investigation round BEFORE the gate, a team or the loop; never open a team on a guess.",
  "2. GATE: ALREADY EVALUATED MECHANICALLY — the SAME complexity predicate the session-start gate uses (an explicit `team:`/`!team` flag OR any matched signal A-F: A flag, B deliverable verbs, C three sub-signals, D an active boulder, E Han chars AND verbs, F workspace scale) was run by the plugin BEFORE this directive was injected, with the thresholds selected by `team.sensitivity` (easy | normal | strict), and its verdict is the TEAM GATE block below this objective. C scores enumerated lines (numbered / bulleted / table rows), distinct action verbs and clauses that OPEN with an action verb against the row's own thresholds and needs at least `cSubSignals` of the three (2-of-3 on easy/normal, 3-of-3 on strict; C1/C2/C3 >= 2/3/4 per row); E needs BOTH the row's Han-character threshold AND its distinct action-verb threshold (>= 24 Han with >= 2 verbs on easy, >= 60 / >= 2 on normal, >= 80 / >= 3 on strict — the verb count is C2's). Never invent a second predicate.",
  "3. TEAM WHEN WARRANTED: the TEAM GATE block below carries the verdict, and when the gate staged a plan that plan is YOURS — extend it with `agent_teams_plan {action:\"add_member\"}` and `agent_teams_plan {action:\"create_task\"}`, then approve it YOURSELF with `agent_teams_plan {action:\"approve\"}` ONLY when the write scope is inside the declared scope AND the gate verdict is mechanical; otherwise ask ONE `ask_user_question`. A staged plan is INERT until approval. EVERY `create_task` must state its dependency answer — `blocked_by: [...]` (`[]` for a genuine root) or `independent: true` — because the tool REFUSES a task that states neither. EXACTLY five `agent_teams_*` tools exist on this harness — `agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail`, `agent_teams_control` — and every OTHER `agent_teams_*` name is retired and GONE (e.g. `agent_teams_create`, `agent_teams_add_member`, `agent_teams_create_task`, `agent_teams_approve`, `agent_teams_status`): never call a retired one, and never read the shared `agent_teams_` prefix as a reason to skip `agent_teams_plan`.",
  "4. LOOP TO COMPLETION: keep rounds until every success criterion is clean. The ENGINE — not you — decides over-limit escalation at the round boundary, so the one case where the loop hands over instead of continuing is the case the escalation clause names.",
  "5. FIX ON SIGHT: a defect the run finds is fixed in the same turn — never report-and-wait — and a fix that would write OUTSIDE the declared scope is a decision point, not a fix.",
  "6. CLOSE OUT ON PROOF: report done only after the verification gate and the quality-gate ledger both approve, and only with a recorded verify PASS in the verify plane; otherwise keep working, or report the concrete blocker.",
  "7. WHEN YOU STOP: exactly three decision points — (a) the over-limit escalation fired and `autoproject.escalate.mode` is `ask`; (b) a credential, a secret or an external capability is absent; (c) the next write would leave the declared scope. Nothing else stops the run.",
].join("\n")
