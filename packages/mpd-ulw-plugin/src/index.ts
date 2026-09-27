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
import { type DshAdapter, type DshCommandInvocation, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-ulw"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; get?: (k: string) => any; [k: string]: any }
type Config = { maxRounds?: number; planDir?: string; stateDir?: string; provider?: string; model?: string; reviewerModel?: string; maxReReviews?: number }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  const v = (k: string) => svc.get(k)
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

const CRITERIA_STATES = ["pin", "red", "green", "surface", "clean"]

const PERSONAS = {
  prometheus: "You are Prometheus, an exacting planner. Write a decision-complete, step-ordered plan with a checked checklist; never write code.",
  momus: "You are Momus, a hostile read-only reviewer. Find the weakest assumptions and concrete defects; judge whether evidence is REAL and reproduces; no code changes.",
  gate: "You are the Ultrawork Quality Gate reviewer. Judge three lanes independently (code quality, hands-on QA, goal verification) and stamp PASS/FAIL per lane with evidence.",
  adversarial: "You are a hostile category reviewer. Attack the objective's weakest assumptions and blind spots; give only defensible insights; no code changes."
}

const ADVERSARIAL_CATEGORIES = [
  { persona: "unspecified-low", angle: "attack assumptions that are not stated; find implicit scope creep." },
  { persona: "unspecified-high", angle: "attack unstated correctness and completeness claims; find missing edge cases." },
  { persona: "deep", angle: "attack the deepest correctness risks; find design mistakes before they cost a redo." },
  { persona: "ultrabrain", angle: "attack from first principles; propose the cheapest faithful path to proof." },
  { persona: "artistry", angle: "attack clarity, structure, and maintainability; find the ugly design that will age badly." }
]

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

function stateRoot(cfg: Config, dsh: DshAdapter, exec?: any): string {
  return cfg.stateDir ?? join(dsh.workspaceRoot(exec), ".mpd", "ulw")
}

function writeJson(p: string, v: any): void { writeFileSync(p, JSON.stringify(v, null, 2)) }

/** The concatenated text of one message's text blocks (undefined when it carries none). */
function messageText(message: any): string | undefined {
  if (!Array.isArray(message?.content)) return undefined
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
    const text = messageText(message)
    if (text === undefined) continue
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
  const content = Array.isArray(message?.content) ? message.content : []
  const at = content.findIndex((block: any) => block?.type === "text")
  if (at < 0) return message
  return { ...message, content: content.map((block: any, index: number) => (index === at ? { ...block, text } : block)) }
}

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  const cfg = mergedConfig(ctx, config)
  const maxRounds = cfg.maxRounds ?? 6
  const provider = cfg.provider ?? "deepseek-official"
  const model = cfg.model ?? "deepseek-v4-flash"
  const reviewerModel = cfg.reviewerModel ?? "deepseek-v4-pro"
  const maxReReviews = cfg.maxReReviews ?? 2

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

  function upsertCriteria(acc: Map<string, any>, crit: any[]): void {
    for (const c of crit ?? []) {
      const key = String(c.key ?? "c" + (acc.size + 1))
      const prev = acc.get(key)
      const state = CRITERIA_STATES.includes(c.state) ? c.state : "pin"
      acc.set(key, prev ? { ...prev, state, label: prev.label || String(c.label ?? key) } : { key, label: String(c.label ?? key), state, evidence: Array.isArray(c.evidence) ? c.evidence : [] })
    }
  }

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
      const planDir = planRoot(cfg, dsh, exec)
      const stateDir = stateRoot(cfg, dsh, exec)
      const objective = String(args?.objective)
      if (!objective) throw new Error("mpd_ultrawork: objective required")
      const tier = args?.tier === "heavy" ? "heavy" : "light"
      const plan = args?.plan === true || tier === "heavy"
      const hyperplan = args?.hyperplan === true
      const strictReview = args?.strictReview === true
      const rounds = Math.min(Math.max(Number(args?.maxRounds ?? maxRounds) || 1, 1), 8)
      const id = "ulw-" + randomUUID().slice(0, 8)
      const dir = join(stateDir, id)
      mkdirSync(dir, { recursive: true })
      mkdirSync(planDir, { recursive: true })
      const stateFile = join(dir, "state.json")
      const ledgerFile = join(dir, "ledger.jsonl")
      function stamp(lane: string, verdict: string, detail: string) { appendFileSync(ledgerFile, JSON.stringify({ lane, verdict, detail, at: new Date().toISOString() }) + String.fromCharCode(10)) }

      const state: any = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 }
      writeJson(stateFile, state)

      let insights: string[] = []
      if (hyperplan) {
        const starts = ADVERSARIAL_CATEGORIES.map((c, i) => spawnChild({
          label: id + "-hp" + i,
          persona: PERSONAS.adversarial,
          schema: { type: "object", properties: { concerns: { type: "array", items: { type: "string" } }, weakestAssumptions: { type: "array", items: { type: "string" } }, insights: { type: "array", items: { type: "string" } } }, required: ["concerns", "weakestAssumptions", "insights"] },
          parent: exec.agent, signal: exec.signal, model: reviewerModel,
          prompt: "Adversarial category: " + c.persona + ". " + c.angle + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + "End with ONLY the structured report (concerns/weakestAssumptions/insights)."
        }).then((r: any) => r.structured ?? {}))
        const results = await Promise.all(starts)
        for (const r of results) insights.push(...(Array.isArray(r.insights) ? r.insights : []))
        insights = insights.slice(0, 20)
        stamp("hyperplan", "done", insights.length + " insights distilled")
      }

      let planFile: string | null = null
      let planChecklist: { key: string; label: string }[] = []
      let planReviewOk = false
      if (plan) {
        const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan"
        const planPath = join(planDir, slug + "-" + id.slice(-4) + ".md")
        const planner = await spawnChild({
          label: id + "-planner", persona: PERSONAS.prometheus, schema: { type: "object", properties: { plan: { type: "string" }, checklist: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } }, required: ["key", "label"] } }, reviewRequired: { type: "boolean" } }, required: ["plan", "checklist", "reviewRequired"] },
          parent: exec.agent, signal: exec.signal, model: reviewerModel,
          prompt: "Objective: " + objective + String.fromCharCode(10) + (insights.length ? "Insight bundle: " + JSON.stringify(insights) : "") + String.fromCharCode(10) + "Write a decision-complete plan as markdown, list the checklist (criteria with key+label, one per success criterion incl. edge + regression + adversarial for HEAVY), set reviewRequired=true only when the tier is HEAVY or the change set is sensitive. End with ONLY the structured report."
        })
        const p = planner?.structured ?? {}
        writeFileSync(planPath, String(p.plan ?? "# " + slug + String.fromCharCode(10) + objective) + String.fromCharCode(10))
        planChecklist = Array.isArray(p.checklist) ? p.checklist : []
        planFile = planPath
        state.planFile = planPath
        const reviewRequired = p.reviewRequired === true
        if (reviewRequired || tier === "heavy") {
          let approved = false
          let concerns = ""
          for (let i = 0; i <= maxReReviews; i++) {
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

      const criteria = new Map<string, any>()
      for (const c of planChecklist) criteria.set(c.key, { key: c.key, label: c.label, state: "pin", evidence: [] })
      const recap: string[] = []
      let status = "continue"
      let used = 0
      let finalReport = ""
      for (let round = 1; round <= rounds; round++) {
        used = round
        const critNow = [...criteria.values()].map((c) => "- [" + c.key + "] " + c.label + " -> " + c.state)
        // DeepSeek V4 prefix-cache discipline: DIRECTIVE stays the byte-stable
        // prompt head; mutable state is referenced by path (1M context makes
        // file reads cheap) and the handoff is the last-3 summaries, not the
        // whole recap, so each round's prompt only varies in its tail.
        const recent = recap.slice(-3)
        const prompt = DIRECTIVE + String.fromCharCode(10, 10) + "ULW round " + round + "/" + rounds + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + (planFile ? "Plan file: " + planFile + String.fromCharCode(10) : "") + "Durable state: " + stateFile + " (ledger: " + ledgerFile + " - read them for full history)" + String.fromCharCode(10) + "Criteria:" + String.fromCharCode(10) + (critNow.join(String.fromCharCode(10)) || "(discover and pin criteria in this round)") + String.fromCharCode(10) + "Recent handoff:" + String.fromCharCode(10) + (recent.join(String.fromCharCode(10)) || "(none - first round)")
        const run = await spawnChild({ label: id + "-r" + round, schema: REPORT_SCHEMA, parent: exec.agent, signal: exec.signal, prompt })
        const r = run?.structured ?? {}
        const crit = Array.isArray(r.criteria) ? r.criteria : []
        const before = criteria.size
        upsertCriteria(criteria, crit)
        const gained = criteria.size - before
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

      let verdict = "n/a"
      let gateLedger: any[] = []
      if (planFile && (tier === "heavy" || strictReview || !planReviewOk)) {
        let approved = false
        let concerns = ""
        for (let i = 0; i <= maxReReviews; i++) {
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
      const tool = dsh.hasTool("mpd_ultrawork") ? dsh.toolRuntime().get("mpd_ultrawork") : undefined
      if (!tool?.execute) throw new Error("mpd_ulw: engine not available")
      const inner = { objective: String(args?.objective), tier: "light", plan: false, hyperplan: false, strictReview: false, maxRounds: Number(args?.maxRounds ?? cfg.maxRounds ?? 3) }
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
  const ULW_COMMAND_DESCRIPTION = (alias: string) => "Run the ULW discipline for an objective, fully autonomously (identical alias: " + alias + ")"
  const runUlwCommand = (invocation: DshCommandInvocation) => {
    const objective = String(invocation?.rawInput ?? "").trim()
    if (objective === "") return { kind: "error", text: ULW_USAGE }
    const submitted = invocation.submit?.(dsh.userMessage({ text: activationDirective(objective), source: { kind: "mpd-ulw", reason: "activation-directive" } })) === true
    if (!submitted) return { kind: "error", text: "ULW could not start: no live agent turn surface to submit the activation directive for " + JSON.stringify(objective) }
    return { kind: "success", text: "ULW activated: " + objective }
  }
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
    const decision = typeof next === "function" ? await next() : undefined
    try {
      if (decision === undefined || decision === null || decision.kind === "reject") return decision
      const messages = Array.isArray(decision.messages) ? decision.messages : (Array.isArray(payload?.messages) ? payload.messages : undefined)
      if (messages === undefined) return decision
      const claimed = claimGesture(messages)
      if (claimed === undefined) return decision
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
