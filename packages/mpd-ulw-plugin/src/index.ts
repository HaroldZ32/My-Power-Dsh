// C2 mpd-ulw-plugin v2: fixed-policy ultrawork engine on the DSH subagent seam.
// Replaces the B3 loop with the full upstream discipline (waves, gates, ledger)
// while keeping mpd_ulw as a lightweight compatibility alias.
// Policy (adapted from upstream ultrawork directive, base 8c57e46):
//   discovery waves (stop after 2 fruitless), per-criterion PIN -> RED -> GREEN ->
//   SURFACE -> CLEAN, plan gate, verification gate (max 2 re-reviews), final
//   quality gate with per-lane ledger, subagent barrier, evidence never suppressed.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export const name = "mpd-ulw"
export const inject = ["tools", "subagents"]

type Ctx = { tools: any; subagents: any; [k: string]: any }
type Config = { maxRounds?: number; planDir?: string; stateDir?: string; provider?: string; model?: string; reviewerModel?: string; maxReReviews?: number }

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

function textBlock(text: string): any { return [{ type: "text", text }] }

function cwd(): string { return process.env.DSH_WORKSPACE_ROOT ?? process.cwd() }

function writeJson(p: string, v: any): void { writeFileSync(p, JSON.stringify(v, null, 2)) }


export function apply(ctx: Ctx, config: Config = {}): void {
  const maxRounds = config.maxRounds ?? 6
  const planDir = config.planDir ?? join(cwd(), ".mpd", "plans")
  const stateDir = config.stateDir ?? join(cwd(), ".mpd", "ulw")
  const provider = config.provider ?? "deepseek-official"
  const model = config.model ?? "deepseek-v4-flash"
  const reviewerModel = config.reviewerModel ?? "deepseek-v4-pro"
  const maxReReviews = config.maxReReviews ?? 2

  async function spawnChild(opts: { label: string; prompt: string; schema: any; persona?: string; parent: any; signal?: any; model?: string; maxDepth?: number }): Promise<any> {
    const run = await ctx.subagents.start("spawn", {
      label: opts.label,
      prompt: textBlock(opts.prompt),
      parent: opts.parent,
      signal: opts.signal,
      agentOptions: { provider, model: opts.model ?? model },
      outputSchema: opts.schema,
      persona: opts.persona,
      ...(opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth })
    })
    return run.result
  }

  function reportText(r: any, recap: string[]): string {
    const crit = Array.isArray(r?.criteria) ? r.criteria : []
    return "summary: " + String(r?.summary ?? "-") + String.fromCharCode(10) + "wave: " + String(r?.wave ?? "-") + String.fromCharCode(10) + "criteria: " + JSON.stringify(crit.map((c: any) => ({ key: c.key, state: c.state }))) + String.fromCharCode(10) + "evidence:" + String.fromCharCode(10) + (Array.isArray(r?.evidence) ? r.evidence.map((e: string) => "  - " + e).join(String.fromCharCode(10)) : "") + String.fromCharCode(10) + "nextSteps:" + String.fromCharCode(10) + (Array.isArray(r?.nextSteps) ? r.nextSteps.map((s: string) => "  - " + s).join(String.fromCharCode(10)) : "") + String.fromCharCode(10) + recap.join(String.fromCharCode(10))
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

  ctx.tools.register({
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
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
      render: (_a: unknown, v: any) => textBlock("ultrawork status=" + v.status + " rounds=" + v.rounds + " verdict=" + (v.verdict ?? "-") + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile)
    },
    execute: async (args: any, exec: any) => {
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

      const state = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 }
      writeJson(stateFile, state)

      let insights: string[] = []
      if (hyperplan) {
        const starts = ADVERSARIAL_CATEGORIES.map((c, i) => spawnChild({
          label: id + "-hp" + i,
          persona: PERSONAS.adversarial,
          schema: { type: "object", properties: { concerns: { type: "array", items: { type: "string" } }, weakestAssumptions: { type: "array", items: { type: "string" } }, insights: { type: "array", items: { type: "string" } } }, required: ["concerns", "weakestAssumptions", "insights"] },
          parent: exec.agent, signal: exec.signal,
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
          parent: exec.agent, signal: exec.signal,
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
        const prompt = DIRECTIVE + String.fromCharCode(10, 10) + "ULW round " + round + "/" + rounds + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + (planFile ? "Plan file: " + planFile + String.fromCharCode(10) : "") + "Criteria:" + String.fromCharCode(10) + (critNow.join(String.fromCharCode(10)) || "(discover and pin criteria in this round)") + String.fromCharCode(10) + "Previous handoff:" + String.fromCharCode(10) + (recap.join(String.fromCharCode(10)) || "(none - first round)")
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
        recap.push("round " + round + ": " + reportText(r, []))
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
      return { status, rounds: used, planFile, verdict, ledger: gateLedger, finalReport, stateFile }
    }
  })

  ctx.tools.register({
    name: "mpd_ulw",
    description: "Lightweight ulw-loop alias: same engine as mpd_ultrawork with tier=light, plan=false, hyperplan=false. Returns the B3-shaped result.",
    parameters: { type: "object", properties: { objective: { type: "string" }, maxRounds: { type: "integer", description: "1..8" } }, required: ["objective"] },
    output: { schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] }, render: (_a: unknown, v: any) => textBlock("mpd_ulw status=" + v.status + " rounds=" + v.rounds + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile) },
    execute: async (args: any, exec: any) => {
      const tool = (ctx.tools as any).get?.("mpd_ultrawork")
      if (!tool?.execute) throw new Error("mpd_ulw: engine not available")
      const inner = { objective: String(args?.objective), tier: "light", plan: false, hyperplan: false, strictReview: false, maxRounds: Number(args?.maxRounds ?? config.maxRounds ?? 3) }
      const res = await tool.execute(inner, exec)
      return { status: res.status, rounds: res.rounds, finalReport: res.finalReport, stateFile: res.stateFile }
    }
  })
}
