// packages/mpd-roles-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// packages/mpd-roles-plugin/src/roles.data.ts
var ROLES = [
  {
    id: "oracle",
    name: "Architect",
    description: "Strategic technical advisor: architecture review, deep debugging, self-review.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/oracle.md"
  },
  {
    id: "librarian",
    name: "Researcher",
    description: "Evidence-based code/open-source search (AST/LSP/web evidence collection).",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/librarian.md"
  },
  {
    id: "prometheus",
    name: "Planner",
    description: "Planning advisor: produces .mpd/plans plans only, never implements.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/prometheus.md"
  },
  {
    id: "hephaestus",
    name: "Deep Worker",
    description: "Autonomous deep worker: executes goals end-to-end with tools, verifies every change.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/hephaestus.md"
  },
  {
    id: "sisyphus",
    name: "Senior Engineer",
    description: "Primary engineering agent: plan small, execute with tools, verify, report honestly.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus.md"
  },
  {
    id: "atlas",
    name: "Lead",
    description: "Orchestrator: macro planning, delegate roles, integrate results.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/atlas.md"
  },
  {
    id: "explore",
    name: "Explorer",
    description: "Read-only codebase explorer: finds files and code, returns evidence, never edits.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/explore.md"
  },
  {
    id: "metis",
    name: "Reviewer",
    description: "Deep reviewer: correctness and risk findings with evidence, no fixes.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/metis.md"
  },
  {
    id: "momus",
    name: "Plan Reviewer",
    description: "Work-plan QA reviewer: verifies the plan is executable and its references valid, rejects only true blockers.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-pro" }
    ],
    personaFile: "personas/momus.md"
  },
  {
    id: "multimodal-looker",
    name: "Vision Analyst",
    description: "Image/diagram analyst: read screenshots/diagrams and describe precisely.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/multimodal-looker.md"
  },
  {
    id: "sisyphus-junior",
    name: "Junior Engineer",
    description: "Fast executor: small, well-scoped mechanical changes with quick verification.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus-junior.md"
  }
];
var ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
}
function userMessage(input) {
  const content = textBlock(input?.text);
  for (const block of content)
    Object.freeze(block);
  Object.freeze(content);
  const source = { kind: "user", ...input?.source ?? {} };
  Object.freeze(source);
  const message = { id: randomUUID(), role: "user", content, source };
  return Object.freeze(message);
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
function scopeOfAgentContext(agent) {
  let context;
  try {
    context = agent?.ctx;
  } catch {
    return;
  }
  if (context === undefined || context === null)
    return;
  const kind = typeof context;
  if (kind !== "object" && kind !== "function")
    return;
  let on;
  let effect;
  let restrict;
  try {
    const scoped = context;
    on = scoped.on;
    effect = scoped.effect;
    restrict = scoped.tools?.restrict;
  } catch {
    return;
  }
  if (typeof on !== "function" || typeof effect !== "function" || typeof restrict !== "function")
    return;
  const tools = context.tools;
  return {
    context,
    tools: { restrict: (filter) => restrict.call(tools, filter) },
    on: (event, handler) => on.call(context, event, handler),
    effect: (fn, label) => effect.call(context, fn, label)
  };
}
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
  function liveAgents() {
    const agents = service("agents");
    if (agents === undefined || typeof agents.list !== "function")
      return [];
    try {
      const list = agents.list();
      return Array.isArray(list) ? list.filter((entry) => entry !== undefined && entry !== null) : [];
    } catch {
      return [];
    }
  }
  function liveAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agents = service("agents");
    if (agents !== undefined && typeof agents.get === "function") {
      try {
        const found = agents.get(id);
        if (found !== undefined && found !== null)
          return found;
      } catch {}
    }
    return liveAgents().find((candidate) => candidate.id === id);
  }
  const engineCache = new Map;
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const cached = engineCache.get(id);
    if (cached !== undefined)
      return cached;
    const agent = liveAgent(id);
    const scoped = agent?.ctx;
    if (scoped === undefined || scoped === null)
      return;
    let engine;
    try {
      engine = typeof scoped.get === "function" ? scoped.get("compaction") : undefined;
    } catch {
      return;
    }
    if (engine === undefined || engine === null)
      return;
    engineCache.set(id, engine);
    return engine;
  }
  function onEvent(event, handler) {
    if (typeof ctx?.on !== "function")
      return;
    try {
      const disposer = ctx.on(event, handler);
      return typeof disposer === "function" ? disposer : () => {};
    } catch {
      return;
    }
  }
  const LLM_CATALOG_METHODS = ["listProviders", "listModels", "resolveModelInfo"];
  let llmCatalogWarned = false;
  function warnLlmCatalogOnce(detail) {
    if (llmCatalogWarned)
      return;
    llmCatalogWarned = true;
    try {
      console.warn("mpd-dsh-adapter: llmCatalog degraded — " + detail);
    } catch {}
  }
  function catalogLabel(value, id) {
    return typeof value === "string" && value.length > 0 ? value : id;
  }
  async function llmCatalog() {
    const llm = service("llm");
    if (llm === undefined || llm === null) {
      warnLlmCatalogOnce("the harness llm service is unavailable");
      return { providers: [], degraded: true };
    }
    const missing = LLM_CATALOG_METHODS.filter((method) => typeof llm?.[method] !== "function");
    if (missing.length > 0) {
      warnLlmCatalogOnce("the harness llm service lacks " + missing.join(", "));
      return { providers: [], degraded: true };
    }
    let providers;
    try {
      providers = await llm.listProviders();
    } catch (error) {
      warnLlmCatalogOnce("listProviders() failed: " + message(error));
      return { providers: [], degraded: true };
    }
    if (!Array.isArray(providers)) {
      warnLlmCatalogOnce("listProviders() did not return an array");
      return { providers: [], degraded: true };
    }
    let degraded = false;
    const catalog = [];
    for (const rawProvider of providers) {
      const providerId = typeof rawProvider?.id === "string" ? rawProvider.id : undefined;
      if (providerId === undefined) {
        degraded = true;
        continue;
      }
      try {
        const models = await llm.listModels(providerId);
        if (!Array.isArray(models))
          throw new Error("listModels(" + providerId + ") did not return an array");
        const entries = [];
        for (const rawModel of models) {
          const modelId = typeof rawModel?.id === "string" ? rawModel.id : undefined;
          if (modelId === undefined) {
            degraded = true;
            continue;
          }
          let resolved;
          try {
            resolved = await llm.resolveModelInfo(providerId, modelId);
          } catch {
            degraded = true;
            continue;
          }
          const reasoning = resolved?.reasoning;
          const efforts = [];
          const rawEfforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
          for (const rawEffort of rawEfforts) {
            const effortId = typeof rawEffort?.id === "string" ? rawEffort.id : undefined;
            if (effortId === undefined)
              continue;
            efforts.push({
              id: effortId,
              name: catalogLabel(rawEffort?.name, effortId),
              ...typeof rawEffort?.description === "string" ? { description: rawEffort.description } : {}
            });
          }
          const defaultEffort = typeof reasoning?.defaultEffort === "string" ? reasoning.defaultEffort : undefined;
          entries.push({
            id: modelId,
            name: catalogLabel(rawModel?.name, modelId),
            ...typeof rawModel?.description === "string" ? { description: rawModel.description } : {},
            efforts,
            ...defaultEffort === undefined ? {} : { defaultEffort }
          });
        }
        catalog.push({ id: providerId, name: catalogLabel(rawProvider?.name, providerId), models: entries });
      } catch {
        degraded = true;
        continue;
      }
    }
    return { providers: catalog, degraded };
  }
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
      const commands = service("commands");
      const agents = service("agents");
      const compaction = service("compaction");
      const llmService = service("llm");
      const systemPrompt = service("systemPrompt");
      const sample = liveAgents()[0];
      const sampleScoped = sample?.ctx;
      let scopedCompaction = false;
      try {
        scopedCompaction = sampleScoped !== undefined && typeof sampleScoped.get === "function" && sampleScoped.get("compaction") !== undefined;
      } catch {
        scopedCompaction = false;
      }
      return {
        tools: tools !== undefined,
        toolsRegister: typeof tools?.register === "function",
        toolsGuard: typeof tools?.guard === "function",
        toolsGet: typeof tools?.get === "function",
        toolsExecute: typeof tools?.execute === "function",
        toolsPreExecute: typeof ctx?.on === "function",
        toolsPostExecute: typeof ctx?.on === "function",
        subagents: subagents !== undefined,
        subagentsSpawn: typeof subagents?.start === "function",
        skills: skills !== undefined,
        skillsProvider: typeof skills?.registerProvider === "function",
        agentPresets: typeof presets?.resolve === "function",
        commands: commands !== undefined,
        commandsRegister: typeof commands?.register === "function",
        turnSubmit: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function",
        llmCatalog: LLM_CATALOG_METHODS.every((method) => typeof service("llm")?.[method] === "function"),
        toolsRegisterHost: typeof tools?.register === "function",
        subagentsProvider: typeof subagents?.getProvider === "function" && typeof subagents?.list === "function",
        subagentsContinuable: typeof subagents?.startContinuable === "function",
        subagentsInterrupt: typeof subagents?.interrupt === "function",
        llmListModels: typeof llmService?.listModels === "function",
        llmResolveCallConfig: typeof llmService?.resolveCallConfig === "function",
        systemPromptSection: typeof systemPrompt?.section === "function",
        agentScope: liveAgents().some((candidate) => scopeOfAgentContext(candidate) !== undefined),
        agentTurnStart: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
        agentTurnCancel: liveAgents().some((candidate) => typeof candidate?.cancel === "function"),
        agentTurnSteer: liveAgents().some((candidate) => typeof candidate?.steer === "function"),
        agentTurnInject: liveAgents().some((candidate) => typeof candidate?.inject === "function")
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
    llmCatalog,
    llmListModels(provider) {
      const llm = requireService("llm", 'cannot list the models of provider "' + provider + '"');
      if (typeof llm.listModels !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no listModels()");
      return llm.listModels.call(llm, provider);
    },
    llmResolveCallConfig(config2, signal) {
      const llm = requireService("llm", "cannot resolve a call config");
      if (typeof llm.resolveCallConfig !== "function")
        throw new Error("mpd-dsh-adapter: the harness llm service exposes no resolveCallConfig()");
      return llm.resolveCallConfig.call(llm, config2, signal);
    },
    registerHostTool(definition) {
      const tools = requireService("tools", 'cannot register host tool "' + String(definition?.name) + '"');
      if (typeof tools.register !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no register()");
      const registered = tools.register(definition);
      return typeof registered === "function" ? registered : noop;
    },
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
    registerCommand(definition) {
      const commands = service("commands");
      if (commands === undefined || commands === null || typeof commands.register !== "function")
        return noop;
      const registered = commands.register({
        name: definition?.name,
        description: definition?.description,
        ...definition?.input === undefined ? {} : { input: definition.input },
        handler: (invocation) => {
          const host = invocation ?? { rawInput: "" };
          return definition.handler({
            ...host,
            submit: (message2) => adapter.submitUserTurn(host.agent, message2)
          });
        }
      });
      return typeof registered === "function" ? registered : noop;
    },
    registerPromptSection(section) {
      const systemPrompt = requireService("systemPrompt", 'cannot register prompt section "' + String(section?.name) + '"');
      if (typeof systemPrompt.section !== "function")
        throw new Error("mpd-dsh-adapter: the harness systemPrompt service exposes no section()");
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop;
    },
    guardTool(guard) {
      const tools = requireService("tools", "cannot install a tool guard");
      if (typeof tools.guard !== "function")
        throw new Error("mpd-dsh-adapter: the harness tools service exposes no guard()");
      return tools.guard((exec) => guard(exec ?? {}));
    },
    onPreToolExecute(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("tools/pre-execute", async (exec, next) => {
        const downstream = typeof next === "function" ? await next() : undefined;
        try {
          listener(Object.freeze({ ...exec ?? {} }), downstream);
        } catch {}
        return downstream;
      });
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
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
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
    subagentRuntime() {
      return service("subagents");
    },
    subagentProvider(name) {
      const subagents = service("subagents");
      const getProvider = subagents?.getProvider;
      if (typeof getProvider !== "function")
        return;
      return getProvider.call(subagents, name);
    },
    subagentProviders() {
      const subagents = service("subagents");
      const list = subagents?.list;
      if (typeof list !== "function")
        return [];
      const names = list.call(subagents);
      return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
    },
    startContinuableAgent(spec) {
      const subagents = requireService("subagents", "cannot start a continuable agent");
      if (typeof subagents.startContinuable !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable()");
      return subagents.startContinuable.call(subagents, spec);
    },
    interruptAgent(targetSessionId, authority) {
      const subagents = requireService("subagents", 'cannot interrupt subagent session "' + String(targetSessionId) + '"');
      if (typeof subagents.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt()");
      subagents.interrupt.call(subagents, targetSessionId, authority);
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
    settingsReader(namespace) {
      const settings = service("settings");
      if (settings === undefined || settings === null)
        return;
      return {
        get() {
          try {
            return typeof settings.get === "function" ? settings.get(namespace) : undefined;
          } catch {
            return;
          }
        },
        describe() {
          try {
            if (typeof settings.describe !== "function")
              return;
            const list = settings.describe();
            if (!Array.isArray(list))
              return;
            const found = list.find((entry) => entry?.ns === namespace);
            if (found === undefined)
              return;
            return {
              value: found.value,
              revision: typeof found.revision === "number" ? found.revision : undefined,
              user: found.user,
              base: found.base,
              applies: typeof found.applies === "string" ? found.applies : undefined
            };
          } catch {
            return;
          }
        }
      };
    },
    onSettingsDocumentUpdated(namespace, listener) {
      let pendingRevision;
      let pendingSource;
      let hasPending = false;
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (!hasPending)
          return;
        const revision = pendingRevision;
        const source = pendingSource;
        pendingRevision = undefined;
        pendingSource = undefined;
        hasPending = false;
        try {
          listener(revision, source);
        } catch {}
      };
      const offUpdated = adapter.onEvent("settings/updated", (ns, _next, _prev, from) => {
        if (String(ns) !== namespace)
          return;
        pendingSource = from === undefined ? undefined : String(from);
        return;
      });
      const offDocument = adapter.onEvent("settings/document-updated", (ns, revision) => {
        if (String(ns) !== namespace)
          return;
        pendingRevision = typeof revision === "number" ? revision : undefined;
        hasPending = true;
        if (!scheduled) {
          scheduled = true;
          Promise.resolve().then(flush);
        }
        return;
      });
      return () => {
        try {
          offUpdated?.();
        } catch {}
        try {
          offDocument?.();
        } catch {}
      };
    },
    whenSettingsAvailable(callback) {
      if (typeof ctx?.inject !== "function") {
        try {
          callback();
        } catch {}
        return;
      }
      try {
        ctx.inject(["settings"], () => {
          try {
            callback();
          } catch {}
        });
      } catch {}
    },
    settingsRegister(namespace, schema, options) {
      const settings = service("settings");
      if (settings === undefined || settings === null || typeof settings.register !== "function") {
        return { ok: false, error: "settings service is unavailable" };
      }
      try {
        settings.register(namespace, schema, { ...options?.base === undefined ? {} : { base: options.base }, ...options?.applies === undefined ? {} : { applies: options.applies } });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    async settingsMutate(namespace, ops, expectedRevision) {
      const settings = service("settings");
      if (settings === undefined || settings === null || typeof settings.mutate !== "function") {
        return { ok: false, error: "settings service is unavailable" };
      }
      try {
        await settings.mutate(namespace, ops.map((op) => op.op === "unset" ? { op: "unset", path: [...op.path] } : { op: "set", path: [...op.path], value: op.value }), expectedRevision);
        return { ok: true };
      } catch (error) {
        const name = String(error?.name ?? "");
        const conflict = name === "SettingsConflictError" || /conflict/i.test(String(error?.message ?? ""));
        return { ok: false, error: String(error?.message ?? error), ...conflict ? { conflict: true } : {} };
      }
    },
    text: textBlock,
    userMessage,
    agentScope(agent) {
      return scopeOfAgentContext(agent);
    },
    startAgentTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message2);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message2) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message2);
    },
    injectAgentMessage(agent, message2) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message2);
    },
    submitUserTurn(agent, message2) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message2);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}
var SERVICE_NAME = "mpdDsh";
var ADAPTER_IDENTITY_MOUNTED = "mounted:mpdDsh";
var ADAPTER_IDENTITY_PENDING = "pending:provider-not-active";
var ADAPTER_IDENTITY_FALLBACK = "fallback:createDshAdapter";
function probeMpdDsh(ctx, strict) {
  const get = ctx?.get;
  if (typeof get !== "function")
    return { missing: true };
  try {
    const value = get.call(ctx, SERVICE_NAME, strict);
    return value === undefined || value === null ? { missing: true } : { value, missing: false };
  } catch {
    return { missing: true };
  }
}
function dshAdapterIdentity(ctx) {
  if (!probeMpdDsh(ctx, true).missing)
    return ADAPTER_IDENTITY_MOUNTED;
  if (!probeMpdDsh(ctx, false).missing)
    return ADAPTER_IDENTITY_PENDING;
  return ADAPTER_IDENTITY_FALLBACK;
}
function createLazyDshAdapter(ctx, options) {
  const warning = (line) => {
    try {
      (options.warn ?? ((text) => console.log("[" + options.label + "] " + text)))(line);
    } catch {}
  };
  let mounted;
  let temporary;
  let warnedPending = false;
  let warnedMissing = false;
  const resolve2 = () => {
    if (mounted !== undefined)
      return mounted;
    const active = probeMpdDsh(ctx, true);
    if (active.value !== undefined) {
      mounted = active.value;
      return mounted;
    }
    temporary ??= createDshAdapter(ctx);
    if (!probeMpdDsh(ctx, false).missing) {
      if (!warnedPending) {
        warnedPending = true;
        warning("ADAPTER NOT YET ACTIVE: " + SERVICE_NAME + " is registered in this composition but its provider fiber" + " is not ACTIVE yet (the loader applies sibling rows concurrently; cordis answers undefined for a non-ACTIVE" + " provider). This call is served by a TEMPORARY adapter and every later call re-probes, so the mounted" + " adapter is picked up as soon as it activates — this transient miss needs NO row-order change (T-50).");
      }
      return temporary;
    }
    if (!warnedMissing) {
      warnedMissing = true;
      warning("ADAPTER FALLBACK (adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK + "): " + SERVICE_NAME + " is not provided" + " in this composition, so this row built its OWN adapter beside the tree's: it bypasses the mounted adapter" + " (the one-contact-surface rule, AGENTS.md §6), it does NOT inherit the adapter row's config (defaultTimeoutMs)" + " and it keeps its own per-instance caches (the per-agent compaction-engine memo). This boot keeps working," + " which is exactly why the branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-dsh-adapter); the" + " canonical note lives in packages/mpd-ext-plugin/src/index.ts (resolveAdapter).");
    }
    return temporary;
  };
  return new Proxy({}, {
    get(_target, property) {
      const impl = resolve2();
      const value = impl[property];
      return typeof value === "function" ? value.bind(impl) : value;
    },
    has(_target, property) {
      return property in resolve2();
    }
  });
}

// packages/mpd-roles-plugin/src/index.ts
var name = "mpd-roles";
var inject = ["tools", "subagents"];
var READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename"
];
var REPORT_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string" },
    summary: { type: "string" },
    recommendation: { type: "string" },
    details: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["role", "summary"],
  additionalProperties: false
};
function textBlock2(text) {
  return [{ type: "text", text }];
}
function pkgRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function normalizeRoleNameKey(name2) {
  return String(name2 ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
var ROLE_ID_BY_NAME_KEY = Object.fromEntries(ROLES.map((r) => [normalizeRoleNameKey(r.name), r.id]));
function rosterNameList() {
  return ROLES.map((r) => r.name).join(", ");
}
function rosterFunctionList() {
  return ROLES.map((r) => r.name + " (" + functionOf(r.description) + ")").join(", ");
}
function functionOf(description) {
  const afterColon = description.includes(": ") ? description.slice(description.indexOf(": ") + 2) : description;
  return afterColon.replace(/\s*\(([^()]*)\)/g, ", $1").replace(/\.+\s*$/, "").replace(/,\s*,/g, ",").trim();
}
function normalizeRoleKey(key) {
  const k = String(key ?? "").trim();
  if (!k)
    return null;
  if (ROLE_BY_ID[k])
    return k;
  if (k.startsWith("mpd-") && ROLE_BY_ID[k.slice(4)])
    return k.slice(4);
  if (k === "sisyphusJunior")
    return "sisyphus-junior";
  if (k === "multimodalLooker")
    return "multimodal-looker";
  return ROLE_ID_BY_NAME_KEY[normalizeRoleNameKey(k)] ?? null;
}
function personaPath(config, spec) {
  return config.personasDir ? join(resolve2(config.personasDir), spec.id + ".md") : join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md");
}
function readPersona(config, spec) {
  const p = personaPath(config, spec);
  try {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t)
        return t;
    }
  } catch {}
  return spec.description;
}
var EXTENSIONS_SERVICE = "mpdExtensions";
var PROJECT_ONLY_PLANE = "project";
var PROJECT_ROLES_REASON = "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session";
function text(value) {
  return typeof value === "string" ? value : "";
}
function errText(error) {
  return error instanceof Error ? error.message : String(error);
}
function extensionRoleId(extensionId, name2) {
  const slug = String(name2).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "ext-" + extensionId + "-" + (slug || "role");
}
function readExtensionPersona(root, file) {
  if (!root || !file)
    return null;
  try {
    const path = resolve2(root, file);
    if (existsSync(path)) {
      const body = readFileSync(path, "utf8").trim();
      if (body)
        return body;
    }
  } catch {}
  return null;
}
function extensionRoles(ctx, exec, warn) {
  const roles = [];
  const refused = [];
  const owner = new Map;
  for (const role of ROLES)
    owner.set(normalizeRoleNameKey(role.name), "the base roster");
  let service;
  try {
    service = typeof ctx?.get === "function" ? ctx.get(EXTENSIONS_SERVICE) : undefined;
  } catch (error) {
    warn('ctx.get("' + EXTENSIONS_SERVICE + '") failed (' + errText(error) + ") — the roster stays base-only for this call");
    return { roles, refused };
  }
  if (service === undefined || service === null || typeof service.list !== "function")
    return { roles, refused };
  let views;
  try {
    const snapshot = service.list({ exec });
    views = Array.isArray(snapshot?.extensions) ? snapshot.extensions : [];
  } catch (error) {
    warn("mpdExtensions.list() failed (" + errText(error) + ") — the roster stays base-only for this call");
    return { roles, refused };
  }
  for (const view of views) {
    const extensionId = text(view?.id);
    if (extensionId === "")
      continue;
    if (view?.enabled === false)
      continue;
    const declared = view?.descriptor?.contributes?.roles;
    if (!Array.isArray(declared))
      continue;
    if (view?.plane === PROJECT_ONLY_PLANE) {
      for (const item of declared) {
        const name2 = text(item?.name).trim();
        if (name2 === "")
          continue;
        refused.push({ extension: extensionId, name: name2, reason: PROJECT_ROLES_REASON });
      }
      continue;
    }
    const root = text(view?.root);
    declared.forEach((item, index) => {
      const name2 = text(item?.name).trim();
      if (name2 === "")
        return;
      const refuse = (reason) => {
        refused.push({ extension: extensionId, name: name2, reason });
      };
      const itemLabel = "contributes.roles[" + index + "]";
      const key = normalizeRoleNameKey(name2);
      const takenBy = owner.get(key);
      if (takenBy !== undefined) {
        refuse('role name "' + name2 + '" (' + itemLabel + ' of extension "' + extensionId + '") is already taken by ' + takenBy + " — this extension role is not exposed");
        return;
      }
      const id = extensionRoleId(extensionId, name2);
      if (ROLE_BY_ID[id] !== undefined) {
        refuse('role id "' + id + '" collides with the base roster — this extension role is not exposed');
        return;
      }
      const personaFile = root === "" ? text(item?.persona) : resolve2(root, text(item?.persona));
      const persona = readExtensionPersona(root, text(item?.persona));
      if (persona === null) {
        refuse("persona file is not readable: " + personaFile);
        return;
      }
      const chain = typeof item?.provider === "string" && typeof item?.model === "string" ? [{ provider: item.provider, model: item.model }] : [];
      owner.set(key, 'extension "' + extensionId + '"');
      roles.push({
        id,
        name: name2,
        description: text(item?.description),
        readonly: item?.readonly === true,
        chain,
        persona,
        personaFile,
        extension: extensionId
      });
    });
  }
  return { roles, refused };
}
function apply(ctx, config = {}) {
  const warn = (line) => {
    const message2 = "[mpd-roles] " + line;
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(message2);
      else
        console.log(message2);
    } catch {}
  };
  const adapterWarn = (line) => {
    const message2 = "[mpd-roles] " + line;
    try {
      console.log(message2);
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(message2);
    } catch {}
  };
  const dsh = createLazyDshAdapter(ctx, { label: "mpd-roles", warn: adapterWarn });
  const warned = new Set;
  const warnOnce = (key, line) => {
    if (warned.has(key))
      return;
    warned.add(key);
    warn(line);
  };
  const roleSurface = (exec) => {
    const base = ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      readonly: r.readonly,
      chain: r.chain.map((c) => ({ ...c })),
      persona: readPersona(config, r),
      personaFile: personaPath(config, r),
      extension: null
    }));
    const contributed = extensionRoles(ctx, exec, (line) => warnOnce("lookup:" + line, line));
    for (const refusal of contributed.refused) {
      warnOnce("refused:" + refusal.extension + ":" + refusal.name, 'extension role refused: "' + refusal.name + '" (' + refusal.extension + ") — " + refusal.reason);
    }
    return { roles: [...base, ...contributed.roles], refused: contributed.refused };
  };
  const roleOf = (surface, key) => {
    const id = normalizeRoleKey(key);
    if (id) {
      const found = surface.roles.find((role) => role.extension === null && role.id === id);
      if (found)
        return found;
    }
    const raw = String(key ?? "").trim();
    if (raw === "")
      return null;
    const namespaced = surface.roles.find((role) => role.extension !== null && role.id === raw);
    if (namespaced)
      return namespaced;
    const nameKey = normalizeRoleNameKey(raw);
    return surface.roles.find((role) => role.extension !== null && normalizeRoleNameKey(role.name) === nameKey) ?? null;
  };
  const roleNameListOf = (surface) => surface.roles.map((role) => role.name).join(", ");
  ctx.provide("mpdRoles", {
    adapterIdentity: dshAdapterIdentity(ctx),
    list: () => roleSurface(undefined).roles.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: r.persona, extension: r.extension })),
    get: (key) => {
      const spec = roleOf(roleSurface(undefined), key);
      return spec === null ? null : { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: spec.persona, extension: spec.extension };
    }
  });
  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster — the SAME normal-named specialists team mode stages as teammates, each named for what it does: " + rosterFunctionList() + ". Address a role by that name (any case, space or hyphen spelling). Use this before mpd_role_spawn; for team work call agent_teams_create profile=mpd instead of repeated one-shot spawns.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" }, refused: { type: "array", items: { type: "object", properties: { extension: { type: "string" }, name: { type: "string" }, reason: { type: "string" } }, required: ["extension", "name", "reason"] } } }, required: ["roles", "count"] }, render: (_a, v) => textBlock2("roster (" + v.count + `):
` + v.roles.map((r) => "- " + r.name + " [" + r.model + (r.readonly ? " readonly" : "") + (r.extension ? " extension:" + r.extension : "") + "] — " + r.description).join(`
`) + (Array.isArray(v.refused) && v.refused.length > 0 ? `
refused (` + v.refused.length + `):
` + v.refused.map((r) => "- " + r.name + " (" + r.extension + ") — " + r.reason).join(`
`) : "")) },
    execute: async (_args, exec) => {
      const surface = roleSurface(exec);
      const roles = surface.roles.map((r) => ({ name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null, extension: r.extension }));
      return { roles, count: roles.length, refused: surface.refused.map((r) => ({ extension: r.extension, name: r.name, reason: r.reason })) };
    }
  });
  dsh.registerTool({
    name: "mpd_role_spawn",
    description: "Spawn one specialist as a one-shot subagent, carrying its persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each named for what it does: " + rosterFunctionList() + ". The subagent is labelled with that name. For multi-member team work prefer the adopted dsh-agent-teams protocol (agent_teams_create + agent_teams_add_member), not repeated one-shot spawns.",
    parameters: { type: "object", properties: { role: { type: "string", description: 'role name (see mpd_roles_list), e.g. "Architect" or "Deep Worker"' }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" }, model: { type: "string", description: "optional model override (default: the role's primary route)" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a, v) => textBlock2("role " + v.role + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "") + (v.evidence?.length ? `
evidence:
- ` + v.evidence.join(`
- `) : "")) },
    execute: async (args, exec) => {
      const surface = roleSurface(exec);
      const spec = roleOf(surface, String(args?.role ?? ""));
      if (spec === null)
        throw new Error("mpd_role_spawn: unknown role '" + String(args?.role) + "' — use a roster name: " + roleNameListOf(surface));
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_role_spawn: task required");
      const persona = spec.persona;
      const provider = spec.chain[0]?.provider ?? "deepseek-official";
      const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : spec.chain[0]?.model;
      const prompt = persona + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence).`;
      const result = await dsh.spawnAgent({
        label: spec.name,
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider,
        model,
        persona,
        outputSchema: REPORT_SCHEMA,
        ...spec.readonly ? { toolFilter: { deny: READONLY_DENY } } : {}
      });
      const st = result.structured ?? {};
      return { role: spec.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
    }
  });
  dsh.registerTool({
    name: "mpd_role_persona",
    description: 'Return the full persona text of one roster role, addressed by its name ("Architect", "Deep Worker", "Plan Reviewer"). Use it when a spawn surface takes the persona as TEXT — e.g. an agent_teams_add_member member whose name is that same name — so the member gets the real role instructions instead of a bare label.',
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a, v) => textBlock2("persona " + v.role + " (" + v.chars + ` chars):
` + v.persona) },
    execute: async (args, exec) => {
      const surface = roleSurface(exec);
      const spec = roleOf(surface, String(args?.role ?? ""));
      if (spec === null)
        throw new Error("mpd_role_persona: unknown role '" + String(args?.role) + "' — use a roster name: " + roleNameListOf(surface));
      return { role: spec.name, persona: spec.persona, chars: spec.persona.length };
    }
  });
  try {
    console.log("[mpd-roles] mpdRoles provided (base roles: " + ROLES.length + ") | adapterIdentity=" + dshAdapterIdentity(ctx));
  } catch {}
}
export {
  rosterNameList,
  rosterFunctionList,
  readPersona,
  pkgRoot,
  normalizeRoleNameKey,
  normalizeRoleKey,
  name,
  inject,
  extensionRoles,
  extensionRoleId,
  apply,
  READONLY_DENY,
  ADAPTER_IDENTITY_PENDING,
  ADAPTER_IDENTITY_MOUNTED,
  ADAPTER_IDENTITY_FALLBACK
};
