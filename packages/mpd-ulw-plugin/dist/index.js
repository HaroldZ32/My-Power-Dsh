// packages/mpd-ulw-plugin/src/index.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { resolve } from "node:path";
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function sessionCwdOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  } catch {
    return;
  }
}
function workspaceRootOf(exec) {
  const session = sessionCwdOf(exec?.agent);
  if (session !== undefined)
    return resolve(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve(override);
  return process.cwd();
}
function workspaceRootsOf(agents) {
  if (agents === undefined || agents === null || typeof agents.list !== "function")
    return [];
  try {
    const list = agents.list();
    if (!Array.isArray(list))
      return [];
    const roots = new Set;
    for (const agent of list) {
      const cwd = sessionCwdOf(agent);
      if (cwd !== undefined)
        roots.add(resolve(cwd));
    }
    return [...roots];
  } catch {
    return [];
  }
}
function noop() {}
function createDshAdapter(ctx, config = {}) {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const service = (serviceName) => {
    if (typeof ctx?.get === "function") {
      try {
        const viaGet = ctx.get(serviceName);
        if (viaGet !== undefined && viaGet !== null)
          return viaGet;
      } catch {}
    }
    try {
      return ctx?.[serviceName];
    } catch {
      return;
    }
  };
  function requireService(serviceName, needed) {
    const found = service(serviceName);
    if (found === undefined || found === null) {
      throw new Error(`mpd-dsh-adapter: harness service "${serviceName}" is unavailable — ${needed}`);
    }
    return found;
  }
  const workspaceRoot = (exec) => workspaceRootOf(exec);
  const workspaceRootsAll = () => workspaceRootsOf(service("agents"));
  function timeoutSignal(timeoutMs) {
    try {
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
        return AbortSignal.timeout(timeoutMs);
    } catch {}
    return;
  }
  const adapter = {
    capabilities() {
      const tools = service("tools");
      const subagents = service("subagents");
      const skills = service("skills");
      const presets = service("agentPresets");
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function"
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    registerTool(definition) {
      const tools = requireService("tools", 'cannot register tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const output = definition.output ?? {};
      const render = typeof output.render === "function" ? output.render : (_args, value) => textBlock(value);
      const schema = output.schema ?? OBJECT_SCHEMA;
      return tools.register({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? OBJECT_SCHEMA,
        output: { ...output, schema, render },
        ...definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs },
        execute: async (args, exec) => definition.execute(args ?? {}, exec ?? {})
      });
    },
    registerTools(definitions) {
      const disposers = definitions.map((definition) => adapter.registerTool(definition));
      return () => {
        for (const dispose of disposers)
          dispose();
      };
    },
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
    },
    onPostToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("tools/post-execute", async (exec, result, next) => {
        const downstream = typeof next === "function" ? await next() ?? { kind: "accept" } : { kind: "accept" };
        const decided = await listener(exec ?? {}, result ?? {}, downstream);
        return decided ?? downstream;
      });
    },
    hasTool(toolName) {
      const tools = service("tools");
      if (typeof tools?.get !== "function")
        return false;
      try {
        return tools.get(toolName) !== undefined;
      } catch {
        return false;
      }
    },
    toolRuntime() {
      const tools = service("tools");
      return {
        get: (toolName) => typeof tools?.get === "function" ? tools.get(toolName) : undefined,
        execute: (input) => adapter.executeTool({ ...input, timeoutMs: defaultTimeoutMs }).then((result) => result.raw)
      };
    },
    async executeTool(input) {
      const tools = service("tools");
      if (tools === undefined || typeof tools.execute !== "function") {
        return { ok: false, isError: true, error: "the harness tool runtime has no execute()" };
      }
      const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
      const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
      try {
        const raw = await tools.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal }
        });
        const isError = raw?.isError === true;
        if (isError) {
          const error = raw?.error;
          return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
        }
        return { ok: true, isError: false, value: raw?.value, raw };
      } catch (error) {
        return { ok: false, isError: true, error: message(error) };
      }
    },
    async spawnAgent(spec) {
      const subagents = requireService("subagents", 'cannot spawn subagent "' + String(spec?.label) + '"');
      if (typeof subagents.start !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagent service exposes no start()");
      const route = {
        ...spec.provider === undefined ? {} : { provider: spec.provider },
        ...spec.model === undefined ? {} : { model: spec.model },
        ...spec.agentOptions ?? {}
      };
      const run = await subagents.start(spec.mode ?? "spawn", {
        label: spec.label,
        prompt: typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt,
        ...spec.parent === undefined ? {} : { parent: spec.parent },
        ...spec.signal === undefined ? {} : { signal: spec.signal },
        ...Object.keys(route).length === 0 ? {} : { agentOptions: route },
        ...spec.persona === undefined ? {} : { persona: spec.persona },
        ...spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema },
        ...spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter },
        ...spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }
      });
      const result = await (run?.result ?? {});
      return {
        output: typeof result.output === "string" ? result.output : "",
        structured: result.structured,
        stopReason: result.stopReason ?? null
      };
    },
    registerSkillProvider(provider) {
      const skills = requireService("skills", "cannot register a skill provider");
      if (typeof skills.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no registerProvider()");
      return skills.registerProvider(provider);
    },
    async listSkills(options = {}) {
      const skills = requireService("skills", "cannot list skills");
      if (typeof skills.list !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no list()");
      return await skills.list(options) ?? [];
    },
    async loadSkill(skillName, options = {}) {
      const skills = requireService("skills", 'cannot load skill "' + skillName + '"');
      if (typeof skills.get !== "function")
        throw new Error("mpd-dsh-adapter: the harness skills service exposes no get()");
      return skills.get(skillName, options);
    },
    async resolvePreset(presetId) {
      const presets = requireService("agentPresets", 'cannot resolve preset "' + presetId + '"');
      if (typeof presets.resolve !== "function")
        throw new Error("mpd-dsh-adapter: the harness agent-presets service exposes no resolve()");
      const preset = await presets.resolve(presetId);
      return {
        id: String(preset?.id ?? presetId),
        ...preset?.path === undefined ? {} : { path: String(preset.path) },
        ...preset?.trust === undefined ? {} : { trust: String(preset.trust) },
        ...preset?.broken === undefined ? {} : { broken: String(preset.broken) }
      };
    },
    text: textBlock
  };
  return adapter;
}

// packages/mpd-ulw-plugin/src/index.ts
var name = "mpd-ulw";
var inject = ["tools", "subagents"];
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  return {
    ...config,
    maxRounds: typeof v("ulw.maxRounds") === "number" ? v("ulw.maxRounds") : config.maxRounds,
    planDir: typeof v("ulw.planDir") === "string" ? v("ulw.planDir") : config.planDir,
    stateDir: typeof v("ulw.stateDir") === "string" ? v("ulw.stateDir") : config.stateDir,
    provider: typeof v("ulw.provider") === "string" ? v("ulw.provider") : config.provider,
    model: typeof v("ulw.model") === "string" ? v("ulw.model") : config.model,
    reviewerModel: typeof v("ulw.reviewerModel") === "string" ? v("ulw.reviewerModel") : config.reviewerModel,
    maxReReviews: typeof v("ulw.maxReReviews") === "number" ? v("ulw.maxReReviews") : config.maxReReviews
  };
}
var REPORT_SCHEMA = {
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
};
var CRITERIA_STATES = ["pin", "red", "green", "surface", "clean"];
var PERSONAS = {
  prometheus: "You are Prometheus, an exacting planner. Write a decision-complete, step-ordered plan with a checked checklist; never write code.",
  momus: "You are Momus, a hostile read-only reviewer. Find the weakest assumptions and concrete defects; judge whether evidence is REAL and reproduces; no code changes.",
  gate: "You are the Ultrawork Quality Gate reviewer. Judge three lanes independently (code quality, hands-on QA, goal verification) and stamp PASS/FAIL per lane with evidence.",
  adversarial: "You are a hostile category reviewer. Attack the objective's weakest assumptions and blind spots; give only defensible insights; no code changes."
};
var ADVERSARIAL_CATEGORIES = [
  { persona: "unspecified-low", angle: "attack assumptions that are not stated; find implicit scope creep." },
  { persona: "unspecified-high", angle: "attack unstated correctness and completeness claims; find missing edge cases." },
  { persona: "deep", angle: "attack the deepest correctness risks; find design mistakes before they cost a redo." },
  { persona: "ultrabrain", angle: "attack from first principles; propose the cheapest faithful path to proof." },
  { persona: "artistry", angle: "attack clarity, structure, and maintainability; find the ugly design that will age badly." }
];
var DIRECTIVE = [
  "ULTRAWORK DISCIPLINE (fixed policy)",
  "Role: expert coding agent. Ship verified work; no process narration.",
  "Tier: LIGHT (known pattern, 1-2 success criteria, one real-surface proof, notepad self-review) or HEAVY (new module/abstraction, auth/security, external integration, schema/migration, concurrency, cross-domain refactor, or the user said carefully: 3+ success criteria incl. happy+edge+regression+adversarial, reviewer loop until unconditional approval). When unsure take HEAVY; never downgrade mid-task.",
  "Per-criterion loop: PIN (name the criterion + success measure) -> RED (failing-first proof) -> GREEN (cheapest faithful change) -> SURFACE (exercise the real surface) -> CLEAN (self-review, record cleanup receipts). Repeat until ALL criteria are clean.",
  "Evidence discipline: never suppress failures; capture artifacts; tests alone never prove done.",
  "Subagent barrier: no done/final answer while children are non-terminal.",
  "End with ONLY the structured report (status=continue|complete|blocked; wave label; criteria states; evidence; nextSteps; blocker). continue requires nextSteps; complete requires all evidence and empty nextSteps; blocked requires a concrete blocker."
].join(String.fromCharCode(10));
function textBlock2(text) {
  return [{ type: "text", text }];
}
function planRoot(cfg, dsh, exec) {
  return cfg.planDir ?? join(dsh.workspaceRoot(exec), ".mpd", "plans");
}
function stateRoot(cfg, dsh, exec) {
  return cfg.stateDir ?? join(dsh.workspaceRoot(exec), ".mpd", "ulw");
}
function writeJson(p, v) {
  writeFileSync(p, JSON.stringify(v, null, 2));
}
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const maxRounds = cfg.maxRounds ?? 6;
  const provider = cfg.provider ?? "deepseek-official";
  const model = cfg.model ?? "deepseek-v4-flash";
  const reviewerModel = cfg.reviewerModel ?? "deepseek-v4-pro";
  const maxReReviews = cfg.maxReReviews ?? 2;
  async function spawnChild(opts) {
    const fullPrompt = [opts.persona, opts.prompt].filter(Boolean).join(String.fromCharCode(10, 10));
    return await dsh.spawnAgent({
      label: opts.label,
      prompt: fullPrompt,
      parent: opts.parent,
      signal: opts.signal,
      provider,
      model: opts.model ?? model,
      outputSchema: opts.schema,
      ...opts.maxDepth === undefined ? {} : { maxDepth: opts.maxDepth }
    });
  }
  function upsertCriteria(acc, crit) {
    for (const c of crit ?? []) {
      const key = String(c.key ?? "c" + (acc.size + 1));
      const prev = acc.get(key);
      const state = CRITERIA_STATES.includes(c.state) ? c.state : "pin";
      acc.set(key, prev ? { ...prev, state, label: prev.label || String(c.label ?? key) } : { key, label: String(c.label ?? key), state, evidence: Array.isArray(c.evidence) ? c.evidence : [] });
    }
  }
  function allClean(acc) {
    if (acc.size === 0)
      return false;
    for (const c of acc.values())
      if (c.state !== "clean")
        return false;
    return true;
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
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
      render: (_a, v) => textBlock2("ultrawork status=" + v.status + " rounds=" + v.rounds + " verdict=" + (v.verdict ?? "-") + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile)
    },
    execute: async (args, exec) => {
      const planDir = planRoot(cfg, dsh, exec);
      const stateDir = stateRoot(cfg, dsh, exec);
      const objective = String(args?.objective);
      if (!objective)
        throw new Error("mpd_ultrawork: objective required");
      const tier = args?.tier === "heavy" ? "heavy" : "light";
      const plan = args?.plan === true || tier === "heavy";
      const hyperplan = args?.hyperplan === true;
      const strictReview = args?.strictReview === true;
      const rounds = Math.min(Math.max(Number(args?.maxRounds ?? maxRounds) || 1, 1), 8);
      const id = "ulw-" + randomUUID().slice(0, 8);
      const dir = join(stateDir, id);
      mkdirSync(dir, { recursive: true });
      mkdirSync(planDir, { recursive: true });
      const stateFile = join(dir, "state.json");
      const ledgerFile = join(dir, "ledger.jsonl");
      function stamp(lane, verdict2, detail) {
        appendFileSync(ledgerFile, JSON.stringify({ lane, verdict: verdict2, detail, at: new Date().toISOString() }) + String.fromCharCode(10));
      }
      const state = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 };
      writeJson(stateFile, state);
      let insights = [];
      if (hyperplan) {
        const starts = ADVERSARIAL_CATEGORIES.map((c, i) => spawnChild({
          label: id + "-hp" + i,
          persona: PERSONAS.adversarial,
          schema: { type: "object", properties: { concerns: { type: "array", items: { type: "string" } }, weakestAssumptions: { type: "array", items: { type: "string" } }, insights: { type: "array", items: { type: "string" } } }, required: ["concerns", "weakestAssumptions", "insights"] },
          parent: exec.agent,
          signal: exec.signal,
          model: reviewerModel,
          prompt: "Adversarial category: " + c.persona + ". " + c.angle + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + "End with ONLY the structured report (concerns/weakestAssumptions/insights)."
        }).then((r) => r.structured ?? {}));
        const results = await Promise.all(starts);
        for (const r of results)
          insights.push(...Array.isArray(r.insights) ? r.insights : []);
        insights = insights.slice(0, 20);
        stamp("hyperplan", "done", insights.length + " insights distilled");
      }
      let planFile = null;
      let planChecklist = [];
      let planReviewOk = false;
      if (plan) {
        const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan";
        const planPath = join(planDir, slug + "-" + id.slice(-4) + ".md");
        const planner = await spawnChild({
          label: id + "-planner",
          persona: PERSONAS.prometheus,
          schema: { type: "object", properties: { plan: { type: "string" }, checklist: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" } }, required: ["key", "label"] } }, reviewRequired: { type: "boolean" } }, required: ["plan", "checklist", "reviewRequired"] },
          parent: exec.agent,
          signal: exec.signal,
          model: reviewerModel,
          prompt: "Objective: " + objective + String.fromCharCode(10) + (insights.length ? "Insight bundle: " + JSON.stringify(insights) : "") + String.fromCharCode(10) + "Write a decision-complete plan as markdown, list the checklist (criteria with key+label, one per success criterion incl. edge + regression + adversarial for HEAVY), set reviewRequired=true only when the tier is HEAVY or the change set is sensitive. End with ONLY the structured report."
        });
        const p = planner?.structured ?? {};
        writeFileSync(planPath, String(p.plan ?? "# " + slug + String.fromCharCode(10) + objective) + String.fromCharCode(10));
        planChecklist = Array.isArray(p.checklist) ? p.checklist : [];
        planFile = planPath;
        state.planFile = planPath;
        const reviewRequired = p.reviewRequired === true;
        if (reviewRequired || tier === "heavy") {
          let approved = false;
          let concerns = "";
          for (let i = 0;i <= maxReReviews; i++) {
            const reviewer = await spawnChild({
              label: id + "-planrev" + i,
              persona: PERSONAS.momus,
              schema: { type: "object", properties: { verdict: { type: "string", enum: ["approve", "reject"] }, concerns: { type: "array", items: { type: "string" } } }, required: ["verdict", "concerns"] },
              parent: exec.agent,
              signal: exec.signal,
              model: reviewerModel,
              prompt: "Review this plan read-only. Plan:" + String.fromCharCode(10) + String(p.plan ?? "") + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + "Concerns must be concrete and actionable. End with ONLY structured {verdict, concerns}."
            });
            if (reviewer?.structured?.verdict === "approve") {
              approved = true;
              break;
            }
            concerns = (reviewer?.structured?.concerns ?? []).join("; ");
          }
          planReviewOk = approved;
          stamp("plan-review", approved ? "approve" : "reject", concerns || "no concerns");
        } else {
          planReviewOk = true;
        }
      }
      const criteria = new Map;
      for (const c of planChecklist)
        criteria.set(c.key, { key: c.key, label: c.label, state: "pin", evidence: [] });
      const recap = [];
      let status = "continue";
      let used = 0;
      let finalReport = "";
      for (let round = 1;round <= rounds; round++) {
        used = round;
        const critNow = [...criteria.values()].map((c) => "- [" + c.key + "] " + c.label + " -> " + c.state);
        const recent = recap.slice(-3);
        const prompt = DIRECTIVE + String.fromCharCode(10, 10) + "ULW round " + round + "/" + rounds + String.fromCharCode(10) + "Objective: " + objective + String.fromCharCode(10) + (planFile ? "Plan file: " + planFile + String.fromCharCode(10) : "") + "Durable state: " + stateFile + " (ledger: " + ledgerFile + " - read them for full history)" + String.fromCharCode(10) + "Criteria:" + String.fromCharCode(10) + (critNow.join(String.fromCharCode(10)) || "(discover and pin criteria in this round)") + String.fromCharCode(10) + "Recent handoff:" + String.fromCharCode(10) + (recent.join(String.fromCharCode(10)) || "(none - first round)");
        const run = await spawnChild({ label: id + "-r" + round, schema: REPORT_SCHEMA, parent: exec.agent, signal: exec.signal, prompt });
        const r = run?.structured ?? {};
        const crit = Array.isArray(r.criteria) ? r.criteria : [];
        const before = criteria.size;
        upsertCriteria(criteria, crit);
        const gained = criteria.size - before;
        const fruitless = gained === 0 && !(Array.isArray(r.evidence) && r.evidence.length > 0);
        if (fruitless)
          state.fruitlessWaves++;
        state.wave = round;
        state.criteria = [...criteria.values()];
        writeJson(stateFile, state);
        recap.push("round " + round + ": " + String(r?.summary ?? "no summary"));
        finalReport = "round " + round + ": " + String(r?.summary ?? "no summary");
        if (r?.status === "complete" && allClean(criteria)) {
          status = "complete";
          break;
        }
        if (r?.status === "blocked") {
          status = "blocked";
          finalReport += String.fromCharCode(10) + "blocked: " + String(r?.blocker ?? "");
          break;
        }
        if (state.fruitlessWaves >= 2) {
          status = "max-rounds";
          finalReport += String.fromCharCode(10) + "stopped: 2 fruitless discovery waves";
          break;
        }
        if (round === rounds)
          status = "max-rounds";
      }
      if (status === "continue")
        status = "max-rounds";
      let verdict = "n/a";
      let gateLedger = [];
      if (planFile && (tier === "heavy" || strictReview || !planReviewOk)) {
        let approved = false;
        let concerns = "";
        for (let i = 0;i <= maxReReviews; i++) {
          const reviewer = await spawnChild({
            label: id + "-verify" + i,
            persona: PERSONAS.momus,
            schema: { type: "object", properties: { verdict: { type: "string", enum: ["approve", "reject"] }, concerns: { type: "array", items: { type: "string" } } }, required: ["verdict", "concerns"] },
            parent: exec.agent,
            signal: exec.signal,
            model: reviewerModel,
            prompt: "Verify this ultrawork run read-only. Objective: " + objective + String.fromCharCode(10) + "Plan: " + (planFile ?? "-") + String.fromCharCode(10) + recap.join(String.fromCharCode(10)) + String.fromCharCode(10) + "Verify each criterion's evidence is REAL and the work is complete; concerns must be concrete. End with ONLY {verdict, concerns}."
          });
          if (reviewer?.structured?.verdict === "approve") {
            approved = true;
            break;
          }
          concerns = (reviewer?.structured?.concerns ?? []).join("; ");
        }
        verdict = approved ? "approve" : "reject";
        stamp("verification", verdict, concerns);
      } else {
        stamp("verification", "skipped", "no plan file or light tier without strict review");
      }
      if (status === "complete" && (tier === "heavy" || strictReview || verdict === "approve")) {
        const gate = await spawnChild({
          label: id + "-gate",
          persona: PERSONAS.gate,
          schema: { type: "object", properties: { lanes: { type: "array", items: { type: "object", properties: { lane: { type: "string" }, verdict: { type: "string", enum: ["PASS", "FAIL"] }, evidence: { type: "string" } }, required: ["lane", "verdict", "evidence"] } } }, required: ["lanes"] },
          parent: exec.agent,
          signal: exec.signal,
          model: reviewerModel,
          prompt: "Final quality gate for " + JSON.stringify(objective) + "." + String.fromCharCode(10) + recap.join(String.fromCharCode(10)) + String.fromCharCode(10) + "Judge lanes: code quality, hands-on QA, goal verification. End with ONLY {lanes}."
        });
        gateLedger = Array.isArray(gate?.structured?.lanes) ? gate.structured.lanes : [];
        for (const l of gateLedger)
          stamp("quality-" + l.lane, l.verdict, l.evidence);
        if (gateLedger.some((l) => l.verdict === "FAIL"))
          status = "blocked";
      }
      state.status = status;
      state.verdict = verdict;
      writeJson(stateFile, state);
      return { status, rounds: used, planFile, verdict, ledger: gateLedger, finalReport, stateFile };
    }
  });
  dsh.registerTool({
    name: "mpd_ulw",
    description: "Lightweight ulw-loop alias: same engine as mpd_ultrawork with tier=light, plan=false, hyperplan=false. Returns the B3-shaped result.",
    parameters: { type: "object", properties: { objective: { type: "string" }, maxRounds: { type: "integer", description: "1..8" } }, required: ["objective"] },
    output: { schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] }, render: (_a, v) => textBlock2("mpd_ulw status=" + v.status + " rounds=" + v.rounds + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile) },
    execute: async (args, exec) => {
      const tool = dsh.hasTool("mpd_ultrawork") ? dsh.toolRuntime().get("mpd_ultrawork") : undefined;
      if (!tool?.execute)
        throw new Error("mpd_ulw: engine not available");
      const inner = { objective: String(args?.objective), tier: "light", plan: false, hyperplan: false, strictReview: false, maxRounds: Number(args?.maxRounds ?? cfg.maxRounds ?? 3) };
      const res = await tool.execute(inner, exec);
      return { status: res.status, rounds: res.rounds, finalReport: res.finalReport, stateFile: res.stateFile };
    }
  });
}
export {
  name,
  inject,
  apply
};
