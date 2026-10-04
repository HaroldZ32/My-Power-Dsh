// C2 mpd-ulw-plugin v2: fixed-policy ultrawork engine on the DSH subagent seam.
// Carries the full upstream discipline (waves, gates, ledger) and keeps mpd_ulw as
// a lightweight compatibility alias. `/ulw` and `/ultrawork` make the engine
// directly user-invocable and inject the ULW ACTIVATION DIRECTIVE (the autonomy
// policy; see ULW_ACTIVATION_DIRECTIVE below).
// Policy (adapted from upstream ultrawork directive, base 8c57e46):
//   discovery waves (stop after 2 fruitless), per-criterion PIN -> RED -> GREEN ->
//   SURFACE -> CLEAN, plan gate, verification gate (max 2 re-reviews), final
//   quality gate with per-lane ledger, subagent barrier, evidence never suppressed.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { DSH_SEAM_SUBAGENTS, DSH_SEAM_TOOLS, dshSeamInject, type DshAdapter, type DshCommandInvocation, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin name; the bundle patch row id is `mpd-ulw`. */
export const name = "mpd-ulw"
/** Both seams are declared, named by their adapter constants: the row registers tools and spawns round children. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS)

/** The host context this row reads; the adapter owns the real seam surface. */
type Ctx = { tools: any; subagents: any; get?: (k: string) => any; [k: string]: any }
/** The row config keys, all optional because the resolver defaults every one. */
type Config = { maxRounds?: number; planDir?: string; stateDir?: string; provider?: string; model?: string; reviewerModel?: string; maxReReviews?: number }

/**
 * The slice of the `mpdGoal` service this row consumes, declared STRUCTURALLY on purpose.
 *
 * The authoritative declaration is `packages/mpd-goal-plugin/src/index.ts` (`MpdGoalService`).
 * A source import would add a cross-package coupling the independence inventory may only SHRINK
 * (`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`), and the two
 * rows talk through a SERVICE at runtime anyway. A composition without the goal row leaves
 * `ctx.get("mpdGoal")` undefined, and this row degrades to "no durable goal".
 */
type GoalBridge = {
  /** Whether long runs anchor a goal by themselves (`goal.autoAnchor` in mpd.jsonc). */
  autoAnchor(): boolean
  /** Put a durable goal in place, keeping any unfinished goal already current. */
  anchor(exec: unknown, input: { objective: string; source: string; maxRounds?: number }): Promise<{ ok: boolean; created: boolean; goal?: { id?: string } | null; error?: string; note?: string }>
  /** Finish a goal this plugin anchored; a goal it did not anchor is left to the model and the user. */
  finish(exec: unknown, input: { outcome: "complete" | "blocked"; source: string; reason?: string }): Promise<{ ok: boolean; outcome: string; error?: string }>
}

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  // The mpdConfig service, absent in a composition that does not mount it.
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  // Read one dotted config key from that service.
  const v = (k: string): ReturnType<NonNullable<typeof svc>["get"]> => svc.get(k)
  return {
    ...config,
    maxRounds: typeof v("ulw.maxRounds") === "number" ? v("ulw.maxRounds") : config.maxRounds,
    planDir: typeof v("ulw.planDir") === "string" ? v("ulw.planDir") : config.planDir,
    stateDir: typeof v("ulw.stateDir") === "string" ? v("ulw.stateDir") : config.stateDir,
    provider: typeof v("ulw.provider") === "string" ? v("ulw.provider") : config.provider,
    model: typeof v("ulw.model") === "string" ? v("ulw.model") : config.model,
    reviewerModel: typeof v("ulw.reviewerModel") === "string" ? v("ulw.reviewerModel") : config.reviewerModel,
    maxReReviews: typeof v("ulw.maxReReviews") === "number" ? v("ulw.maxReReviews") : config.maxReReviews,
  }
}

/** The structured report every round child must end with, as the subagent output schema. */
const REPORT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["continue", "complete", "blocked"] },
    wave: { type: "string" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    blocker: { type: "string" },
    criteria: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, state: { type: "string", enum: ["pin", "red", "green", "surface", "clean"] }, evidence: { type: "array", items: { type: "string" } } }, required: ["key", "label", "state"] } }
  },
  required: ["status", "summary", "evidence", "nextSteps", "blocker", "criteria"],
  additionalProperties: false
}

/** The per-criterion ladder states, in loop order. */
const CRITERIA_STATES = ["pin", "red", "green", "surface", "clean"]

/** The role prompts, folded into a child's prompt head rather than passed as a preset id. */
const PERSONAS = {
  prometheus: "You are Prometheus, an exacting planner. Write a decision-complete, step-ordered plan with a checked checklist; never write code.",
  momus: "You are Momus, a hostile read-only reviewer. Find the weakest assumptions and concrete defects; judge whether evidence is REAL and reproduces; no code changes.",
  gate: "You are the Ultrawork Quality Gate reviewer. Judge three lanes independently (code quality, hands-on QA, goal verification) and stamp PASS/FAIL per lane with evidence.",
  adversarial: "You are a hostile category reviewer. Attack the objective's weakest assumptions and blind spots; give only defensible insights; no code changes."
}

/** The five hyperplan angles: a persona name plus the attack that persona must run. */
const ADVERSARIAL_CATEGORIES = [
  { persona: "unspecified-low", angle: "attack assumptions that are not stated; find implicit scope creep." },
  { persona: "unspecified-high", angle: "attack unstated correctness and completeness claims; find missing edge cases." },
  { persona: "deep", angle: "attack the deepest correctness risks; find design mistakes before they cost a redo." },
  { persona: "ultrabrain", angle: "attack from first principles; propose the cheapest faithful path to proof." },
  { persona: "artistry", angle: "attack clarity, structure, and maintainability; find the ugly design that will age badly." }
]

/** The fixed child-round policy; its head stays byte-stable for the prompt cache. */
const DIRECTIVE = [
  "ULTRAWORK DISCIPLINE (fixed policy)",
  "Role: expert coding agent. Ship verified work; no process narration.",
  "Tier: LIGHT (known pattern, 1-2 success criteria, one real-surface proof, notepad self-review) or HEAVY (new module/abstraction, auth/security, external integration, schema/migration, concurrency, cross-domain refactor, or the user said carefully: 3+ success criteria incl. happy+edge+regression+adversarial, reviewer loop until unconditional approval). When unsure take HEAVY; never downgrade mid-task.",
  "Per-criterion loop: PIN (name the criterion + success measure) -> RED (failing-first proof) -> GREEN (cheapest faithful change) -> SURFACE (exercise the real surface) -> CLEAN (self-review, record cleanup receipts). Repeat until ALL criteria are clean.",
  "Evidence discipline: never suppress failures; capture artifacts; tests alone never prove done.",
  "Subagent barrier: no done/final answer while children are non-terminal.",
  "End with ONLY the structured report (status=continue|complete|blocked; wave label; criteria states; evidence; nextSteps; blocker). continue requires nextSteps; complete requires all evidence and empty nextSteps; blocked requires a concrete blocker."
].join(String.fromCharCode(10))

// The CHILD-round directive above heads each round child's prompt. The activation
// directive below is a DIFFERENT text: the user-role message a `/ulw` / `/ultrawork`
// invocation injects into the INVOKING session, and it carries the ULW autonomy
// policy. The autonomy clauses must NOT be folded into the child directive: the
// session-start gate never qualifies a child session, so a team-autonomy clause in a
// child prompt would instruct a subagent to do what the platform forbids.
//
// ONE constant for both injection paths (the command path and the plain-text
// gesture). The head is byte-stable across invocations and the objective — the only
// mutable part — is appended last, which is what the DeepSeek V4 prefix cache keys on.
export const ULW_ACTIVATION_DIRECTIVE = [
  "ULTRAWORK ACTIVATION (user-invoked; execute autonomously and ask the user nothing)",
  "1. TRIAGE FIRST: when the objective is unclear, or the task is investigate-first-then-execute, run one normal-MPD investigation round BEFORE the gate, a team or the loop; never open a team on a guess.",
  "2. GATE: then evaluate the SAME complexity predicate the session-start gate uses — an explicit `team:`/`!team` flag OR any matched signal A-D (A explicit flag; B deliverable verbs; C enumerated steps; D an existing .mpd/plans artifact). Never invent a second predicate.",
  "3. TEAM WHEN WARRANTED: when the gate fires, or the work is complex, stage the team YOURSELF with the OFFICIAL team tools — spawn_teammate({name, description, prompt}) for each roster member, then team_task_create({subject, description, blocked_by?, write_scopes?}) for the DAG — and run it: no user confirmation and no plan review. The retired `agent_teams_*` tools do not exist on this harness; the team's state is the Lead session's own.",
  "4. LOOP TO COMPLETION: never stop early to ask the user; keep rounds until every success criterion is clean.",
  "5. FIX ON SIGHT: a defect the run finds is fixed in the same turn — never report-and-wait and never ask the user for approval.",
  "6. CLOSE OUT ON PROOF: report done only after the verification gate and the quality-gate ledger both approve; otherwise keep working, or report the concrete blocker."
].join(String.fromCharCode(10))

/** The activation directive for one objective: stable policy head, mutable objective tail. */
export function activationDirective(objective: string): string {
  return ULW_ACTIVATION_DIRECTIVE + String.fromCharCode(10, 10) + "OBJECTIVE: " + String(objective ?? "").trim()
}


// Explicit config (ulw.planDir / ulw.stateDir) wins; otherwise both roots live under the
// CALLING SESSION's workspace (adapter workspaceRoot) — never the dsh process cwd. They are
// resolved PER CALL, never captured in an apply-time const, because one host serves many
// sessions with different workspaces.
function planRoot(cfg: Config, dsh: DshAdapter, exec?: any): string {
  return cfg.planDir ?? join(dsh.workspaceRoot(exec), ".mpd", "plans")
}

/** The run's state root: the explicit `ulw.stateDir`, else `<workspace>/.mpd/ulw`. */
function stateRoot(cfg: Config, dsh: DshAdapter, exec?: any): string {
  return cfg.stateDir ?? join(dsh.workspaceRoot(exec), ".mpd", "ulw")
}

/** Write one JSON document pretty-printed, i.e. the run's durable state. */
function writeJson(p: string, v: any): void { writeFileSync(p, JSON.stringify(v, null, 2)) }

/** The concatenated text of one message's text blocks (undefined when it carries none). */
function messageText(message: any): string | undefined {
  if (!Array.isArray(message?.content)) return undefined
  // The message's text blocks, concatenated below.
  const parts = message.content.filter((block: any) => block?.type === "text" && typeof block.text === "string").map((block: any) => block.text)
  return parts.length === 0 ? undefined : parts.join(String.fromCharCode(10))
}

/** The ULW gesture, anchored at the START of a message's text: `/ulw …` or `/ultrawork …`. */
const GESTURE_PATTERN = /^(?:\/ulw|\/ultrawork)(?:[\t\n\r ]+|$)/u

/**
 * Claim the ULW gesture from a pre-step batch. EVERY user-role message is scanned, never
 * just the last one: this bundle's composition appends user-role notices AFTER the user's
 * own prompt (the runtime-context notice and the `<system-reminder>` skill catalog), so
 * "the last user-role message" is a notice and an anchored gesture would never be seen —
 * the t15 defect, measured on a real boot whose session log held the raw `/ulw …` prompt
 * and zero rewrites. A notice can only claim the gesture by literally opening with it.
 * @returns the claiming message, its text, and the anchored match, or undefined.
 */
function claimGesture(messages: any): { message: any; text: string; match: RegExpExecArray } | undefined {
  if (!Array.isArray(messages)) return undefined
  for (const message of messages) {
    if (message?.role !== "user") continue
    // The message's text, absent when it carries no text block.
    const text = messageText(message)
    if (text === undefined) continue
    // The anchored gesture match, or null for a message that does not open with one.
    const match = GESTURE_PATTERN.exec(text.trim())
    if (match !== null) return { message, text, match }
  }
  return undefined
}

/**
 * A copy of `message` whose FIRST text block carries `text`. The message identity
 * (id, role, source) is preserved, mirroring the adopted plugin's marker-consumption
 * rewrite (`consumeFlagFromMessage`: only text blocks change), and the objective
 * survives inside `text`.
 */
function rewriteMessageText(message: any, text: string): any {
  // The message's content blocks; a non-array reads as empty.
  const content = Array.isArray(message?.content) ? message.content : []
  // Index of the first text block, -1 when the message carries none.
  const at = content.findIndex((block: any) => block?.type === "text")
  if (at < 0) return message
  return { ...message, content: content.map((block: any, index: number) => (index === at ? { ...block, text } : block)) }
}

/** Apply the row: register both tools, both command spellings and the gesture listener. */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // The row config with the runtime `mpd.jsonc` layer merged over it.
  const cfg = mergedConfig(ctx, config)
  // Round cap: the config layer, else the documented default of six.
  const maxRounds = cfg.maxRounds ?? 6
  // Provider for every child this run spawns.
  const provider = cfg.provider ?? "deepseek-official"
  // Model for the round and planner children.
  const model = cfg.model ?? "deepseek-v4-flash"
  // Model for the reviewer and adversarial children.
  const reviewerModel = cfg.reviewerModel ?? "deepseek-v4-pro"
  // How many times a rejected plan or verification may be re-reviewed.
  const maxReReviews = cfg.maxReReviews ?? 2

  /**
   * The durable-goal bridge provided by the `mpd-goal` row, resolved PER CALL.
   *
   * @returns the service, or undefined when that row is not mounted in this composition.
   */
  function goalBridge(): GoalBridge | undefined {
    // Lazy on purpose: the row may be mounted after this one, and a composition without it must
    // degrade to "no durable goal" rather than fail this plugin's apply.
    return ctx.get?.("mpdGoal") as GoalBridge | undefined
  }

  /**
   * Anchor a persisted goal for a long run, so the DURABLE GOAL — not this tool call — is the
   * basis of continuous execution once the turn ends.
   *
   * @param exec - the tool exec carrying the calling agent, forwarded verbatim.
   * @param objective - the run's objective, used as the goal objective.
   * @returns the goal id when a goal is in place, else null; a refusal is logged, never thrown.
   */
  async function anchorGoal(exec: any, objective: string): Promise<string | null> {
    try {
      // No row, or auto-anchoring switched off in mpd.jsonc: the run proceeds without a goal. The
      // bridge probe sits INSIDE the try because it is part of the same contract — a bridge that
      // throws (a half-shaped service) must never take the run down.
      const bridge = goalBridge()
      if (bridge === undefined || bridge.autoAnchor?.() !== true) return null
      /** The anchor outcome; an existing unfinished goal is KEPT by the service, never replaced. */
      const outcome = await bridge.anchor(exec, { objective, source: "ulw" })
      if (outcome?.goal != null && typeof outcome.goal.id === "string") return outcome.goal.id
      if (outcome?.ok === false) dsh.rowLog("mpd-ulw", "goal anchor refused: " + String(outcome.error ?? "unknown"))
      return null
    } catch (error: any) {
      // The goal is an ADDITION to the run: a bridge that throws must never take the run down.
      dsh.rowLog("mpd-ulw", "goal anchor failed: " + String(error?.message ?? error))
      return null
    }
  }

  /**
   * Close the durable goal this run anchored, matching the run's own outcome.
   *
   * `complete` completes it; `blocked` ATTEMPTS blocked and tolerates the harness's refusal before
   * its consecutive-round threshold; anything else (`max-rounds`) leaves the goal ACTIVE on
   * purpose — that is the case the goal exists for: the engine stopped inside this turn, the
   * driver carries the objective on across turns.
   *
   * @param exec - the tool exec carrying the calling agent.
   * @param status - the run's final status (`complete` | `blocked` | `max-rounds`).
   * @param reason - the blocker text, for a blocked attempt.
   */
  async function finishGoal(exec: any, status: string, reason: string): Promise<void> {
    if (status !== "complete" && status !== "blocked") return
    // Same lazy resolution as the anchor; an absent row is a silent no-op here.
    const bridge = goalBridge()
    if (bridge === undefined) return
    try {
      /** The finish outcome, reported in the row log when the harness refused the transition. */
      const outcome = await bridge.finish(exec, { outcome: status === "blocked" ? "blocked" : "complete", source: "ulw", ...(status === "blocked" ? { reason } : {}) })
      if (outcome?.ok === false) dsh.rowLog("mpd-ulw", "goal finish (" + status + ") refused: " + String(outcome.error ?? "unknown"))
    } catch (error: any) {
      dsh.rowLog("mpd-ulw", "goal finish failed: " + String(error?.message ?? error))
    }
  }

  /** Spawn one child round/role through the adapter and return its result. */
  async function spawnChild(opts: { label: string; prompt: string; schema: any; persona?: string; parent: any; signal?: any; model?: string; maxDepth?: number }): Promise<any> {
    // Role personas are prompt TEXT, not DSH preset ids: fold them into the
    // child prompt head (keeps every role's prompt prefix byte-stable, which
    // is exactly what DeepSeek V4 prefix caching keys on) and never pass them
    // to the spawn persona field.
    const fullPrompt = [opts.persona, opts.prompt].filter(Boolean).join(String.fromCharCode(10, 10))
    return await dsh.spawnAgent({
      label: opts.label,
      prompt: fullPrompt,
      parent: opts.parent,
      signal: opts.signal,
      provider,
      model: opts.model ?? model,
      outputSchema: opts.schema,
      ...(opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth })
    })
  }

  /** Merge one report's criteria into the accumulator, keeping a pinned criterion's first label. */
  function upsertCriteria(acc: Map<string, any>, crit: any[]): void {
    for (const c of crit ?? []) {
      // The criterion's stable key, synthesized when the report omits one.
      const key = String(c.key ?? "c" + (acc.size + 1))
      // The criterion as already accumulated, when this run has seen it before.
      const prev = acc.get(key)
      // The ladder state, defaulting to `pin` for an unrecognized value.
      const state = CRITERIA_STATES.includes(c.state) ? c.state : "pin"
      acc.set(key, prev ? { ...prev, state, label: prev.label || String(c.label ?? key) } : { key, label: String(c.label ?? key), state, evidence: Array.isArray(c.evidence) ? c.evidence : [] })
    }
  }

  /** Whether at least one criterion is accumulated and every one of them is `clean`. */
  function allClean(acc: Map<string, any>): boolean {
    if (acc.size === 0) return false
    for (const c of acc.values()) if (c.state !== "clean") return false
    return true
  }

  dsh.registerTool({
    name: "mpd_ultrawork",
    description: "Run the fixed ultrawork discipline: optional adversarial hyperplan wave, plan gate (planner + plan review), execution rounds (fresh child per round, per-criterion PIN->RED->GREEN->SURFACE->CLEAN, discovery waves stop after 2 fruitless), verification gate (momus reviewer, max 2 re-reviews) when a plan exists AND (tier=heavy OR strictReview), final quality gate with per-lane ledger, subagent barrier. State + ledger under .mpd/ulw/<id>.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        tier: { type: "string", enum: ["light", "heavy"] },
        plan: { type: "boolean", description: "Force a plan file even in light tier" },
        hyperplan: { type: "boolean", description: "Run the 5-category adversarial review wave before planning" },
        strictReview: { type: "boolean", description: "Force the verification gate even in light tier" },
        maxRounds: { type: "integer", description: "1..8, default 6" }
      },
      required: ["objective"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string", description: "Present only when a plan file was written (plan=true or tier=heavy); absent otherwise" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
      render: (_a: unknown, v: any) => textBlock("ultrawork status=" + v.status + " rounds=" + v.rounds + " verdict=" + (v.verdict ?? "-") + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile)
    },
    execute: async (args: any, exec: any) => {
      // The plan directory for this invocation, resolved per call.
      const planDir = planRoot(cfg, dsh, exec)
      // The state directory for this invocation, resolved per call.
      const stateDir = stateRoot(cfg, dsh, exec)
      // The objective as given; an empty one is refused below.
      const objective = String(args?.objective)
      if (!objective) throw new Error("mpd_ultrawork: objective required")
      // The requested tier, defaulting to `light`.
      const tier = args?.tier === "heavy" ? "heavy" : "light"
      // Whether a plan file must be written, forced or implied by the heavy tier.
      const plan = args?.plan === true || tier === "heavy"
      // Whether the five-angle adversarial wave runs before planning.
      const hyperplan = args?.hyperplan === true
      // Whether the verification gate runs even for a light tier.
      const strictReview = args?.strictReview === true
      // The effective round cap, clamped to the documented 1..8 range.
      const rounds = Math.min(Math.max(Number(args?.maxRounds ?? maxRounds) || 1, 1), 8)
      // The run id, which names the state directory and every child label.
      const id = "ulw-" + randomUUID().slice(0, 8)
      // The run's own state directory.
      const dir = join(stateDir, id)
      mkdirSync(dir, { recursive: true })
      mkdirSync(planDir, { recursive: true })
      // The durable state document for this run.
      const stateFile = join(dir, "state.json")
      // The append-only quality/verification ledger for this run.
      const ledgerFile = join(dir, "ledger.jsonl")
      /** Append one ledger line recording a lane verdict and its detail. */
      function stamp(lane: string, verdict: string, detail: string): void { appendFileSync(ledgerFile, JSON.stringify({ lane, verdict, detail, at: new Date().toISOString() }) + String.fromCharCode(10)) }

      // The durable run state, rewritten after every mutation.
      const state: any = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 }
      writeJson(stateFile, state)

      // A PLAN-BOUND RUN OUTLIVES ITS TURN, so it anchors a persisted goal (mpd-goal row): from
      // here the durable goal — not this tool call — is the basis of continuous execution, and the
      // harness's round driver keeps the objective going if this run stops short of it.
      const goalId = plan ? await anchorGoal(exec, objective) : null
      if (goalId !== null) {
        // Recorded in the run's own state document, so a later reader sees which goal carried it.
        state.goalId = goalId
        writeJson(stateFile, state)
      }

      // The distilled hyperplan insights, capped below.
      let insights: string[] = []
      if (hyperplan) {
        // One adversarial child per category, all started together.
        const starts = ADVERSARIAL_CATEGORIES.map((c, i) => spawnChild({
          label: id + "-hp" + i,
          persona: PERSONAS.adversarial,
          schema: { type: "object", properties: { concerns: { type: "array", items: { type: "string" } }, weakestAssumptions: { type: "array", items: { type: "string" } }, insights: { type: "array", items: { type: "string" } } }, required: ["concerns", "weakestAssumptions", "insights"] },
          parent: exec.agent, signal: exec.signal, model: reviewerModel,
          prompt: "Adversarial category: " + c.persona + ". " + c.angle + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + "End with ONLY the structured report (concerns/weakestAssumptions/insights)."
        }).then((r: any) => r.structured ?? {}))
        // Their structured reports, in category order.
        const results = await Promise.all(starts)
        for (const r of results) insights.push(...(Array.isArray(r.insights) ? r.insights : []))
        insights = insights.slice(0, 20)
        stamp("hyperplan", "done", insights.length + " insights distilled")
      }

      // The written plan path, or null when this run writes no plan.
      let planFile: string | null = null
      // The planner's checklist, which seeds the criteria accumulator.
      let planChecklist: { key: string; label: string }[] = []
      // Whether the plan review approved; true when no review was required.
      let planReviewOk = false
      if (plan) {
        // The objective folded into a file-name-safe slug.
        const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan"
        // The plan file this run writes.
        const planPath = join(planDir, slug + "-" + id.slice(-4) + ".md")
        // The planner child's structured result.
        const planner = await spawnChild({
          label: id + "-planner", persona: PERSONAS.prometheus, schema: { type: "object", properties: { plan: { type: "string" }, checklist: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } }, required: ["key", "label"] } }, reviewRequired: { type: "boolean" } }, required: ["plan", "checklist", "reviewRequired"] },
          parent: exec.agent, signal: exec.signal, model: reviewerModel,
          prompt: "Objective: " + objective + String.fromCharCode(10) + (insights.length ? "Insight bundle: " + JSON.stringify(insights) : "") + String.fromCharCode(10) + "Write a decision-complete plan as markdown, list the checklist (criteria with key+label, one per success criterion incl. edge + regression + adversarial for HEAVY), set reviewRequired=true only when the tier is HEAVY or the change set is sensitive. End with ONLY the structured report."
        })
        // The planner's structured report, or an empty one.
        const p = planner?.structured ?? {}
        writeFileSync(planPath, String(p.plan ?? "# " + slug + String.fromCharCode(10) + objective) + String.fromCharCode(10))
        planChecklist = Array.isArray(p.checklist) ? p.checklist : []
        planFile = planPath
        state.planFile = planPath
        // Whether the planner itself asked for a review.
        const reviewRequired = p.reviewRequired === true
        if (reviewRequired || tier === "heavy") {
          // Whether a reviewer approved the plan.
          let approved = false
          // The last reviewer's concerns, stamped to the ledger.
          let concerns = ""
          for (let i = 0; i <= maxReReviews; i++) {
            // This re-review's structured result.
            const reviewer = await spawnChild({
              label: id + "-planrev" + i, persona: PERSONAS.momus, schema: { type: "object", properties: { verdict: { type: "string", enum: ["approve", "reject"] }, concerns: { type: "array", items: { type: "string" } } }, required: ["verdict", "concerns"] },
              parent: exec.agent, signal: exec.signal, model: reviewerModel,
              prompt: "Review this plan read-only. Plan:" + String.fromCharCode(10) + String(p.plan ?? "") + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + "Concerns must be concrete and actionable. End with ONLY structured {verdict, concerns}."
            })
            if (reviewer?.structured?.verdict === "approve") { approved = true; break }
            concerns = (reviewer?.structured?.concerns ?? []).join("; ")
          }
          planReviewOk = approved
          stamp("plan-review", approved ? "approve" : "reject", concerns || "no concerns")
        } else {
          planReviewOk = true
        }
      }

      // The criteria accumulator: pinned keys with their ladder state and evidence.
      const criteria = new Map<string, any>()
      for (const c of planChecklist) criteria.set(c.key, { key: c.key, label: c.label, state: "pin", evidence: [] })
      // One handoff line per round, newest last.
      const recap: string[] = []
      // The run's outcome, finalized after the loop.
      let status = "continue"
      // How many rounds actually ran.
      let used = 0
      // The report text returned to the caller.
      let finalReport = ""
      for (let round = 1; round <= rounds; round++) {
        used = round
        // The criteria rendered into this round's prompt.
        const critNow = [...criteria.values()].map((c) => "- [" + c.key + "] " + c.label + " -> " + c.state)
        // DeepSeek V4 prefix-cache discipline: DIRECTIVE stays the byte-stable
        // prompt head; mutable state is referenced by path (1M context makes
        // file reads cheap) and the handoff is the last-3 summaries, not the
        // whole recap, so each round's prompt only varies in its tail.
        const recent = recap.slice(-3)
        // This round's child prompt: stable policy head, mutable state tail.
        const prompt = DIRECTIVE + String.fromCharCode(10, 10) + "ULW round " + round + "/" + rounds + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + (planFile ? "Plan file: " + planFile + String.fromCharCode(10) : "") + "Durable state: " + stateFile + " (ledger: " + ledgerFile + " - read them for full history)" + String.fromCharCode(10) + "Criteria:" + String.fromCharCode(10) + (critNow.join(String.fromCharCode(10)) || "(discover and pin criteria in this round)") + String.fromCharCode(10) + "Recent handoff:" + String.fromCharCode(10) + (recent.join(String.fromCharCode(10)) || "(none - first round)")
        // The round child's result.
        const run = await spawnChild({ label: id + "-r" + round, schema: REPORT_SCHEMA, parent: exec.agent, signal: exec.signal, prompt })
        // The round's structured report, or an empty one.
        const r = run?.structured ?? {}
        // The criteria the round reported.
        const crit = Array.isArray(r.criteria) ? r.criteria : []
        // How many criteria were known before this round.
        const before = criteria.size
        upsertCriteria(criteria, crit)
        // How many new criteria this round added.
        const gained = criteria.size - before
        // Whether the round added nothing and produced no evidence.
        const fruitless = gained === 0 && !(Array.isArray(r.evidence) && r.evidence.length > 0)
        if (fruitless) state.fruitlessWaves++
        state.wave = round
        state.criteria = [...criteria.values()]
        writeJson(stateFile, state)
        recap.push("round " + round + ": " + String(r?.summary ?? "no summary"))
        finalReport = "round " + round + ": " + String(r?.summary ?? "no summary")
        if (r?.status === "complete" && allClean(criteria)) { status = "complete"; break }
        if (r?.status === "blocked") { status = "blocked"; finalReport += String.fromCharCode(10) + "blocked: " + String(r?.blocker ?? ""); break }
        if (state.fruitlessWaves >= 2) { status = "max-rounds"; finalReport += String.fromCharCode(10) + "stopped: 2 fruitless discovery waves"; break }
        if (round === rounds) status = "max-rounds"
      }
      if (status === "continue") status = "max-rounds"

      // The verification verdict, or `n/a` when the gate was skipped.
      let verdict = "n/a"
      // The quality gate's per-lane ledger rows.
      let gateLedger: any[] = []
      if (planFile && (tier === "heavy" || strictReview || !planReviewOk)) {
        // Whether the verifier approved this run.
        let approved = false
        // The last verifier's concerns, stamped to the ledger.
        let concerns = ""
        for (let i = 0; i <= maxReReviews; i++) {
          // This verification re-review's structured result.
          const reviewer = await spawnChild({
            label: id + "-verify" + i, persona: PERSONAS.momus, schema: { type: "object", properties: { verdict: { type: "string", enum: ["approve", "reject"] }, concerns: { type: "array", items: { type: "string" } } }, required: ["verdict", "concerns"] },
            parent: exec.agent, signal: exec.signal, model: reviewerModel,
            prompt: "Verify this ultrawork run read-only. Objective: " + objective + String.fromCharCode(10) + "Plan: " + (planFile ?? "-") + String.fromCharCode(10) + recap.join(String.fromCharCode(10)) + String.fromCharCode(10) + "Verify each criterion's evidence is REAL and the work is complete; concerns must be concrete. End with ONLY {verdict, concerns}."
          })
          if (reviewer?.structured?.verdict === "approve") { approved = true; break }
          concerns = (reviewer?.structured?.concerns ?? []).join("; ")
        }
        verdict = approved ? "approve" : "reject"
        stamp("verification", verdict, concerns)
      } else {
        stamp("verification", "skipped", "no plan file or light tier without strict review")
      }

      if (status === "complete" && (tier === "heavy" || strictReview || verdict === "approve")) {
        // The quality gate child's structured result.
        const gate = await spawnChild({
          label: id + "-gate", persona: PERSONAS.gate, schema: { type: "object", properties: { lanes: { type: "array", items: { type: "object", properties: { lane: { type: "string" }, verdict: { type: "string", enum: ["PASS", "FAIL"] }, evidence: { type: "string" } }, required: ["lane", "verdict", "evidence"] } } }, required: ["lanes"] },
          parent: exec.agent, signal: exec.signal, model: reviewerModel,
          prompt: "Final quality gate for " + JSON.stringify(objective) + "." + String.fromCharCode(10) + recap.join(String.fromCharCode(10)) + String.fromCharCode(10) + "Judge lanes: code quality, hands-on QA, goal verification. End with ONLY {lanes}."
        })
        gateLedger = Array.isArray(gate?.structured?.lanes) ? gate.structured.lanes : []
        for (const l of gateLedger) stamp("quality-" + l.lane, l.verdict, l.evidence)
        if (gateLedger.some((l) => l.verdict === "FAIL")) status = "blocked"
      }

      state.status = status
      state.verdict = verdict
      writeJson(stateFile, state)
      // The run's own outcome decides the goal's fate; see finishGoal for why `max-rounds` KEEPS it armed.
      await finishGoal(exec, status, finalReport.trim().slice(-400))
      // `planFile` is emitted ONLY when a plan file exists. The harness's output validator
      // accepts ONE scalar `type` per property (it rejects `type: [..., "null"]` with
      // "type arrays are not supported"), and `planFile` is deliberately absent from the
      // schema's `required` list — so omitting the key is the legal way to say "no plan
      // file". Returning it as null made EVERY plan=false result invalid (the `/ulw`
      // default and the hardcoded alias path): `tool "mpd_ultrawork" returned invalid
      // output: "value.planFile" must be a string` (t16).
      return { status, rounds: used, ...(planFile === null ? {} : { planFile }), verdict, ledger: gateLedger, finalReport, stateFile }
    }
  })

  dsh.registerTool({
    name: "mpd_ulw",
    description: "Lightweight ulw-loop alias: same engine as mpd_ultrawork with tier=light, plan=false, hyperplan=false. Returns the same result fields as mpd_ultrawork (status, rounds, finalReport, stateFile).",
    parameters: { type: "object", properties: { objective: { type: "string" }, maxRounds: { type: "integer", description: "1..8" } }, required: ["objective"] },
    output: { schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] }, render: (_a: unknown, v: any) => textBlock("mpd_ulw status=" + v.status + " rounds=" + v.rounds + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile) },
    execute: async (args: any, exec: any) => {
      // The ultrawork tool, looked up through the adapter's internal seam.
      const tool = dsh.hasTool("mpd_ultrawork") ? dsh.toolRuntime().get("mpd_ultrawork") : undefined
      if (!tool?.execute) throw new Error("mpd_ulw: engine not available")
      // The alias's fixed light-tier argument set.
      const inner = { objective: String(args?.objective), tier: "light", plan: false, hyperplan: false, strictReview: false, maxRounds: Number(args?.maxRounds ?? cfg.maxRounds ?? 3) }
      // The engine's result, narrowed to the fields the alias re-exports.
      const res = await tool.execute(inner, exec)
      return { status: res.status, rounds: res.rounds, finalReport: res.finalReport, stateFile: res.stateFile }
    }
  })

  // ── clause 2: user-invocable commands, registered through the adapter ───────
  // The host parses `/ulw` down to the bare name "ulw" and THROWS on a duplicate
  // name, so the two spellings are two definitions of ONE handler. A handler runs
  // "without sending the command to the model", so returning {kind:'success'} alone
  // would start nothing: the handler SUBMITS the activation directive as the
  // invoking agent's own next user turn, through the adapter's turn seam. Both
  // seams come from the adapter (AGENTS.md §6) — this plugin never reaches for the
  // host's command service or its agent surface itself.
  const ULW_USAGE = "usage: /ulw <objective> (alias: /ultrawork <objective>) — starts an autonomous ULW run for that objective"
  // Per-NAME description: the registry renders each definition's own text, so one shared
  // string naming `/ultrawork` would read as a self-referential alias on the `ultrawork`
  // entry (t9 review finding). Each name advertises the OTHER spelling.
  const ULW_COMMAND_DESCRIPTION = (alias: string): string => "Run the ULW discipline for an objective, fully autonomously (identical alias: " + alias + ")"
  // The handler shared by both command spellings.
  const runUlwCommand = (invocation: DshCommandInvocation): { kind: "error" | "success"; text: string } => {
    // The objective from the invocation, trimmed; empty asks for the usage line.
    const objective = String(invocation?.rawInput ?? "").trim()
    if (objective === "") return { kind: "error", text: ULW_USAGE }
    // Whether the activation directive reached the invoking agent's own next turn.
    const submitted = invocation.submit?.(dsh.userMessage({ text: activationDirective(objective), source: { kind: "mpd-ulw", reason: "activation-directive" } })) === true
    if (!submitted) return { kind: "error", text: "ULW could not start: no live agent turn surface to submit the activation directive for " + JSON.stringify(objective) }
    return { kind: "success", text: "ULW activated: " + objective }
  }
  // One registration per spelling, because the host throws on a duplicate command name.
  const commandDisposers = ["ulw", "ultrawork"].map((name) => dsh.registerCommand({ name, description: ULW_COMMAND_DESCRIPTION(name === "ulw" ? "/ultrawork" : "/ulw"), input: { hint: "objective" }, handler: runUlwCommand }))

  // ── clause 2: the plain-text gesture (headless has no command surface) ──────
  // Recognised at the plugin's own `agent/pre-step` boundary through the adapter's
  // event seam. `agent/pre-step` is a cordis WATERFALL: a listener's return value
  // REPLACES the composed step decision, so this listener delegates to `next()`
  // FIRST and then returns the (possibly rewritten) decision — never a bare value
  // (the 2026-09-16 incident: a stamp with no `messages` became the step decision
  // and killed every turn of every session; see mpd-team-watchdog-plugin engine.ts).
  // The claim scans EVERY user-role message (t15): looking only at the last one was
  // green in the one-message unit test while red on a real boot, because the
  // composition appends its own user-role notices after the prompt.
  const gestureDispose = dsh.onEvent("agent/pre-step", async (payload: any, next: any) => {
    // The step decision composed by the rest of the chain.
    const decision = typeof next === "function" ? await next() : undefined
    try {
      if (decision === undefined || decision === null || decision.kind === "reject") return decision
      // The batch's messages, taken from the decision or the payload.
      const messages = Array.isArray(decision.messages) ? decision.messages : (Array.isArray(payload?.messages) ? payload.messages : undefined)
      if (messages === undefined) return decision
      // The message that claimed the gesture, when one does.
      const claimed = claimGesture(messages)
      if (claimed === undefined) return decision
      // The objective after the gesture token.
      const objective = claimed.text.trim().slice(claimed.match[0].length).trim()
      // A bare `/ulw` carries no objective to run. The command path answers usage;
      // a gesture has no reply surface, so the step is left untouched.
      if (objective === "") return decision
      return { ...decision, messages: messages.map((message: any) => (message === claimed.message ? rewriteMessageText(message, activationDirective(objective)) : message)) }
    } catch {
      // A gesture failure must never break the step: the decision composed by
      // `next()` is returned unchanged, never a veto by accident.
      return decision
    }
  })

  // Cordis owns teardown: hand the host disposers to the plugin's own fiber when the
  // context offers `effect`, so a teardown unregisters both command names and the
  // gesture listener (guarded like mpd-team-watchdog-plugin's install()).
  const disposers = [...commandDisposers, ...(gestureDispose === undefined ? [] : [gestureDispose])]
  if (typeof ctx.effect === "function") ctx.effect(() => () => { for (const dispose of disposers) dispose() }, "mpd-ulw.commands")
}
