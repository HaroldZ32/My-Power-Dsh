// packages/mpd-team-tools-plugin/src/index.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync3, readdirSync as readdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
var TEAM_TASK_METHODS = ["createTask", "getTask", "listTasks", "updateTask"];
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
function teamContextOf(raw) {
  return raw === "fresh" || raw === "fork" ? raw : undefined;
}
function teamStatusOf(raw) {
  return raw === "running" || raw === "provisioning" || raw === "failed" ? raw : "inactive";
}
function teamTaskStatusOf(raw) {
  return raw === "in_progress" || raw === "completed" || raw === "deleted" ? raw : "pending";
}
function teamStrings(raw) {
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === "string") : [];
}
function teamMemberView(raw) {
  const row = raw ?? {};
  const context = teamContextOf(row.context);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    role: row.role === "lead" ? "lead" : "teammate",
    status: teamStatusOf(row.status),
    ...typeof row.description === "string" ? { description: row.description } : {},
    ...typeof row.provider === "string" ? { provider: row.provider } : {},
    ...context === undefined ? {} : { context },
    ...typeof row.model === "string" ? { model: row.model } : {},
    diagnostics: teamStrings(row.diagnostics)
  };
}
function teamTaskView(raw) {
  const row = raw ?? {};
  return {
    id: String(row.id ?? ""),
    revision: typeof row.revision === "number" ? row.revision : 0,
    subject: String(row.subject ?? ""),
    description: String(row.description ?? ""),
    status: teamTaskStatusOf(row.status),
    blockedBy: teamStrings(row.blockedBy),
    writeScopes: teamStrings(row.writeScopes),
    ...typeof row.ownerName === "string" ? { ownerName: row.ownerName } : {},
    ready: row.ready === true,
    writeScopeWarnings: teamStrings(row.writeScopeWarnings)
  };
}
function teamRows(teams, method, agent, project) {
  const reader = teams?.[method];
  if (typeof reader !== "function")
    return [];
  try {
    const rows = reader.call(teams, agent);
    return Array.isArray(rows) ? rows.map(project) : [];
  } catch {
    return [];
  }
}
function scopeContextOf(agent) {
  try {
    return agent?.ctx;
  } catch {
    return;
  }
}
function preStepWrapper(listener) {
  return async (payload, next) => {
    const fallback = { kind: "enter", messages: payload?.messages ?? [] };
    const downstream = typeof next === "function" ? await next() ?? fallback : fallback;
    try {
      const decided = await listener(payload ?? {}, downstream);
      return decided ?? downstream;
    } catch {
      return downstream;
    }
  };
}
function agentSystemPromptOf(agent) {
  const context = scopeContextOf(agent);
  if (context === undefined || context === null)
    return;
  try {
    const systemPrompt = context.systemPrompt;
    return typeof systemPrompt?.section === "function" ? systemPrompt : undefined;
  } catch {
    return;
  }
}
function createDshAdapter(ctx, config = {}) {
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let scopedSettings;
  const settingsService = () => scopedSettings ?? service("settings");
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
      const agentTeams = service("agentTeams");
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
        agentTurnInject: liveAgents().some((candidate) => typeof candidate?.inject === "function"),
        agentPromptSection: liveAgents().some((candidate) => agentSystemPromptOf(candidate) !== undefined),
        agentPreStep: typeof ctx?.on === "function",
        agentPreStepScope: liveAgents().some((candidate) => typeof scopeContextOf(candidate)?.on === "function"),
        team: typeof agentTeams?.tryMembership === "function" && typeof agentTeams?.listMembers === "function",
        teamTasks: TEAM_TASK_METHODS.every((method) => typeof agentTeams?.[method] === "function"),
        teamMessages: typeof agentTeams?.sendMessage === "function" && typeof agentTeams?.waitForChange === "function",
        subagentsProviderRegister: typeof subagents?.registerProvider === "function"
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
    onAgentPreStep(listener) {
      if (typeof ctx?.on !== "function")
        return noop;
      return ctx.on("agent/pre-step", preStepWrapper(listener));
    },
    registerAgentPreStep(agent, listener) {
      const context = scopeContextOf(agent);
      if (typeof context?.on !== "function") {
        throw new Error("mpd-dsh-adapter: the agent's own scope exposes no on() — cannot register its agent/pre-step listener");
      }
      return context.on("agent/pre-step", preStepWrapper(listener));
    },
    webServerOf() {
      try {
        if (typeof ctx?.get !== "function")
          return;
        return ctx.get("webServer", false) ?? ctx.get("httpServer", false);
      } catch {
        return;
      }
    },
    onServiceBound(names, callback) {
      if (typeof ctx?.on !== "function")
        return () => {};
      const off = ctx.on("internal/service", (name) => {
        try {
          if (typeof name === "string" && names.includes(name))
            callback(name);
        } catch {}
      });
      return typeof off === "function" ? off : () => {};
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
    registerSubagentProvider(provider) {
      const subagents = requireService("subagents", "cannot register a subagent provider");
      if (typeof subagents.registerProvider !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no registerProvider()");
      const registered = subagents.registerProvider(provider);
      return typeof registered === "function" ? registered : noop;
    },
    interruptAgent(targetSessionId, authority) {
      const subagents = requireService("subagents", 'cannot interrupt subagent session "' + String(targetSessionId) + '"');
      if (typeof subagents.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt()");
      subagents.interrupt.call(subagents, targetSessionId, authority);
    },
    teamService() {
      const teams = service("agentTeams");
      return teams === undefined || teams === null ? undefined : teams;
    },
    teamMembership(agent) {
      const teams = service("agentTeams");
      const tryMembership = teams?.tryMembership;
      if (typeof tryMembership !== "function")
        return;
      let membership;
      try {
        membership = tryMembership.call(teams, agent);
      } catch {
        return;
      }
      if (membership === undefined || membership === null)
        return;
      const role = membership.role;
      if (role !== "lead" && role !== "teammate")
        return;
      return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
    },
    teamListMembers(agent) {
      const teams = requireService("agentTeams", "cannot list the team roster of an agent");
      if (typeof teams.listMembers !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listMembers()");
      const rows = teams.listMembers.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamMemberView) : [];
    },
    teamListTasks(agent) {
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent");
      if (typeof teams.listTasks !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()");
      const rows = teams.listTasks.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamTaskView) : [];
    },
    async teamCreateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot create team task "' + String(request?.subject) + '"');
      if (typeof teams.createTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()");
      return teamTaskView(await teams.createTask.call(teams, caller, request));
    },
    teamGetTask(caller, id) {
      const teams = requireService("agentTeams", 'cannot read team task "' + String(id) + '"');
      if (typeof teams.getTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()");
      return teamTaskView(teams.getTask.call(teams, caller, id));
    },
    async teamUpdateTask(caller, request) {
      const teams = requireService("agentTeams", 'cannot update team task "' + String(request?.taskId) + '"');
      if (typeof teams.updateTask !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()");
      return teamTaskView(await teams.updateTask.call(teams, caller, request));
    },
    async teamSendMessage(caller, request) {
      const teams = requireService("agentTeams", 'cannot send a team message to "' + String(request?.target) + '"');
      if (typeof teams.sendMessage !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no sendMessage()");
      const result = await teams.sendMessage.call(teams, caller, request);
      return {
        messageId: String(result?.messageId ?? ""),
        status: result?.status === "queued" ? "queued" : "accepted"
      };
    },
    async teamSpawnTeammate(caller, request) {
      const teams = requireService("agentTeams", 'cannot spawn team member "' + String(request?.name) + '"');
      if (typeof teams.spawnTeammate !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no spawnTeammate()");
      const result = await teams.spawnTeammate.call(teams, caller, request);
      return { member: teamMemberView(result?.member) };
    },
    teamInterrupt(caller, targetName) {
      const teams = requireService("agentTeams", 'cannot interrupt team member "' + String(targetName) + '"');
      if (typeof teams.interrupt !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no interrupt()");
      const result = teams.interrupt.call(teams, caller, targetName);
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" };
    },
    async teamWaitForChange(caller, timeoutMs, signal) {
      const teams = requireService("agentTeams", "cannot wait for team activity");
      if (typeof teams.waitForChange !== "function")
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no waitForChange()");
      const result = await teams.waitForChange.call(teams, caller, timeoutMs, signal);
      return { timedOut: result?.timedOut === true };
    },
    teamLiveTeams() {
      const teams = service("agentTeams");
      if (teams === undefined || teams === null || typeof teams.tryMembership !== "function")
        return [];
      if (typeof service("agents")?.list !== "function")
        return [];
      const views = [];
      for (const agent of liveAgents()) {
        let membership;
        try {
          membership = teams.tryMembership.call(teams, agent);
        } catch {
          continue;
        }
        if (membership?.role !== "lead")
          continue;
        views.push({
          teamId: String(membership.id ?? ""),
          leadName: String(membership.name ?? ""),
          leadSessionId: String(agent?.id ?? ""),
          members: teamRows(teams, "listMembers", agent, teamMemberView),
          tasks: teamRows(teams, "listTasks", agent, teamTaskView)
        });
      }
      return views;
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
        throw new Error("mpd-dsh-adapter: the harness agentPresets service exposes no resolve()");
      const preset = await presets.resolve(presetId);
      return {
        id: String(preset?.id ?? presetId),
        ...preset?.path === undefined ? {} : { path: String(preset.path) },
        ...preset?.trust === undefined ? {} : { trust: String(preset.trust) },
        ...preset?.broken === undefined ? {} : { broken: String(preset.broken) }
      };
    },
    settingsReader(namespace) {
      const settings = settingsService();
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
        console.warn("[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
        try {
          callback();
        } catch {}
        return;
      }
      try {
        ctx.inject(["settings"], (scoped) => {
          try {
            try {
              if (scopedSettings === undefined || scopedSettings === null)
                scopedSettings = scoped?.settings;
            } catch {}
            if (scopedSettings === undefined || scopedSettings === null) {
              try {
                scopedSettings = typeof scoped?.get === "function" ? scoped.get("settings") : undefined;
              } catch {}
            }
            if (scopedSettings === undefined || scopedSettings === null) {
              console.warn("[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
            }
            callback();
          } catch {}
        });
      } catch {}
    },
    settingsRegister(namespace, schema, options) {
      const settings = settingsService();
      if (settings === undefined || settings === null) {
        return { ok: false, error: "settings service is unavailable" };
      }
      if (typeof settings.register !== "function") {
        return {
          ok: false,
          error: "the settings service is present but exposes no register() — harness 0.1.7-rc.2 replaced the namespace-registry model with the Cordis patch editor, where a plugin declares its editable fields in its own row Config with .volatile() (keys: " + Object.keys(settings).slice(0, 8).join(",") + ")"
        };
      }
      try {
        settings.register(namespace, schema, { ...options?.base === undefined ? {} : { base: options.base }, ...options?.applies === undefined ? {} : { applies: options.applies } });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    async settingsMutate(namespace, ops, expectedRevision) {
      const settings = settingsService();
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
    agentPromptSection(agent, section) {
      const systemPrompt = agentSystemPromptOf(agent);
      if (systemPrompt === undefined) {
        throw new Error(`mpd-dsh-adapter: the agent's own scope exposes no systemPrompt.section() — cannot register prompt section "` + String(section?.name) + '" for it');
      }
      const registered = systemPrompt.section(section);
      return typeof registered === "function" ? registered : noop;
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

// packages/mpd-team-tools-plugin/src/mailbox-store.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function mailboxPath(workspace) {
  return join(workspace, ".mpd", "team", "mailbox.jsonl");
}
function fold(records) {
  const byId = new Map;
  for (const raw of records) {
    const record = raw;
    if (record === null || typeof record !== "object")
      continue;
    if (record.t === "send") {
      const send = record;
      if (typeof send.id !== "string" || send.id === "")
        continue;
      byId.set(send.id, {
        id: send.id,
        fromId: String(send.fromId ?? ""),
        fromName: String(send.fromName ?? ""),
        toId: String(send.toId ?? ""),
        toName: String(send.toName ?? ""),
        subject: String(send.subject ?? ""),
        body: String(send.body ?? ""),
        sentAt: String(send.at ?? "")
      });
      continue;
    }
    if (record.t === "delivered" || record.t === "read") {
      const id = String(record.id ?? "");
      const message2 = byId.get(id);
      if (message2 === undefined)
        continue;
      const at = String(record.at ?? "");
      if (record.t === "delivered")
        message2.deliveredAt = at;
      else
        message2.readAt = at;
    }
  }
  return { messages: [...byId.values()] };
}
function readRecords(workspace) {
  const path = mailboxPath(workspace);
  if (!existsSync(path))
    return [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}
function readMailbox(workspace) {
  return fold(readRecords(workspace));
}
function appendRecord(workspace, record) {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true });
  appendFileSync(mailboxPath(workspace), JSON.stringify(record) + `
`);
}
function inboxOf(state, memberId) {
  return state.messages.filter((message2) => message2.toId === memberId);
}
function unreadOf(state, memberId) {
  return inboxOf(state, memberId).filter((message2) => message2.readAt === undefined);
}
function undeliveredOf(state, memberId) {
  return inboxOf(state, memberId).filter((message2) => message2.deliveredAt === undefined);
}
function summarise(state) {
  const order = [];
  const seen = new Map;
  for (const message2 of state.messages) {
    let entry = seen.get(message2.toId);
    if (entry === undefined) {
      entry = { memberId: message2.toId, memberName: message2.toName, total: 0, unread: 0, undelivered: 0 };
      seen.set(message2.toId, entry);
      order.push(message2.toId);
    }
    entry.total += 1;
    if (message2.readAt === undefined) {
      entry.unread += 1;
      if (entry.oldestUnread === undefined)
        entry.oldestUnread = message2.subject;
    }
    if (message2.deliveredAt === undefined)
      entry.undelivered += 1;
  }
  return order.map((id) => seen.get(id));
}
function send(workspace, input, now) {
  if (input.toId === input.fromId) {
    return { ok: false, reason: "self", detail: "a team member cannot message itself" };
  }
  if (!input.memberIds.includes(input.toId)) {
    return { ok: false, reason: "unknown-recipient", detail: `"${input.toName || input.toId}" is not a member of this team` };
  }
  const state = readMailbox(workspace);
  const backlog = undeliveredOf(state, input.toId).length;
  const cap = input.maxUndelivered ?? 8;
  if (cap > 0 && backlog >= cap) {
    return { ok: false, reason: "backlog-full", detail: `"${input.toName || input.toId}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` };
  }
  const at = now.toISOString();
  const message2 = {
    id: `mail-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-${(state.messages.length + 1).toString().padStart(3, "0")}`,
    fromId: input.fromId,
    fromName: input.fromName,
    toId: input.toId,
    toName: input.toName,
    subject: input.subject,
    body: input.body,
    sentAt: at
  };
  appendRecord(workspace, { t: "send", ...message2, at });
  return { ok: true, message: message2 };
}
function markDelivered(workspace, ids, now) {
  const state = readMailbox(workspace);
  const byId = new Map(state.messages.map((message2) => [message2.id, message2]));
  const moved = [];
  for (const id of ids) {
    const message2 = byId.get(id);
    if (message2 === undefined || message2.deliveredAt !== undefined)
      continue;
    appendRecord(workspace, { t: "delivered", id, at: now.toISOString() });
    moved.push(id);
  }
  return moved;
}
function markRead(workspace, ids, now) {
  const state = readMailbox(workspace);
  const byId = new Map(state.messages.map((message2) => [message2.id, message2]));
  const moved = [];
  for (const id of ids) {
    const message2 = byId.get(id);
    if (message2 === undefined || message2.readAt !== undefined)
      continue;
    appendRecord(workspace, { t: "read", id, at: now.toISOString() });
    moved.push(id);
  }
  return moved;
}

// packages/mpd-team-tools-plugin/src/dispatch.ts
function dispatchMessage(task, description) {
  return [
    `You have been assigned shared task ${task.id}: ${task.subject}`,
    "",
    description,
    "",
    "Work it on your own; do not wait for another member to start it.",
    `When it is done, report the result to the Lead and mark task ${task.id} completed with team_task_update.`
  ].join(`
`);
}
function planDispatch(input) {
  if (input.hold !== undefined && input.hold !== "") {
    return { pairs: [], skipped: [], halted: input.hold };
  }
  const busy = new Set(Object.values(input.ledger).filter((entry) => entry.taskId !== "" && entry.memberId !== "").map((entry) => entry.memberId));
  const claimed = new Set(Object.keys(input.ledger));
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id));
  const plan = { pairs: [], skipped: [] };
  let available = [...candidates];
  const cap = input.limit === undefined || input.limit <= 0 ? Number.POSITIVE_INFINITY : input.limit;
  for (const task of input.tasks) {
    if (plan.pairs.length >= cap) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "the pass reached its limit" });
      continue;
    }
    if (task.status === "completed") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" });
      continue;
    }
    if (claimed.has(task.id)) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `already dispatched to ${input.ledger[task.id]?.memberName ?? "a member"}` });
      continue;
    }
    if (task.ready !== true) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready${Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " (blocked by " + task.blockedBy.join(", ") + ")" : ""}` });
      continue;
    }
    if (available.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "no idle member is free" });
      continue;
    }
    const member = available[0];
    available = available.slice(1);
    plan.pairs.push({ taskId: task.id, subject: task.subject, memberId: member.id, memberName: member.name });
  }
  return plan;
}
function assign(ledger, pair, now) {
  return {
    ...ledger,
    [pair.taskId]: { taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName, assignedAt: now.toISOString() }
  };
}
function release(ledger, taskId) {
  if (ledger[taskId] === undefined)
    return { ledger, released: false };
  const next = { ...ledger };
  delete next[taskId];
  return { ledger: next, released: true };
}
function reconcile(ledger, tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const next = {};
  const forgotten = [];
  for (const [taskId, entry] of Object.entries(ledger)) {
    const task = byId.get(taskId);
    if (task === undefined || task.status === "completed") {
      forgotten.push(taskId);
      continue;
    }
    next[taskId] = entry;
  }
  return { ledger: next, forgotten };
}

// packages/mpd-team-tools-plugin/src/plan-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
function teamRoot(workspace) {
  return join2(workspace, ".mpd", "team");
}
var stagingDir = (workspace) => join2(teamRoot(workspace), "staging");
var stagingPath = (workspace, sessionId) => join2(stagingDir(workspace), sessionId + ".json");
var contractsDir = (workspace) => join2(teamRoot(workspace), "contracts");
var contractPath = (workspace, taskId) => join2(contractsDir(workspace), taskId + ".json");
var holdPath = (workspace) => join2(teamRoot(workspace), "hold.json");
var archiveDir = (workspace) => join2(teamRoot(workspace), "archive");
function readJson(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return;
  }
}
function writeJson(path, value) {
  mkdirSync2(join2(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + `
`);
}
function newPlanId(now) {
  return "plan-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}
function readPlan(workspace, sessionId) {
  const plan = readJson(stagingPath(workspace, sessionId));
  return plan === undefined || plan.version !== 1 ? undefined : plan;
}
function writePlan(workspace, plan) {
  writeJson(stagingPath(workspace, plan.sessionId), plan);
}
function stagePlan(workspace, sessionId, input, now) {
  const existing = readPlan(workspace, sessionId);
  if (existing !== undefined && existing.approvedAt === undefined)
    archivePlan(workspace, existing);
  const plan = {
    version: 1,
    planId: newPlanId(now),
    sessionId,
    name: input.name,
    description: input.description,
    approval: input.approval,
    members: [],
    tasks: [],
    stagedAt: now.toISOString()
  };
  writePlan(workspace, plan);
  return plan;
}
function addMember(plan, member) {
  const name = member.name.trim();
  if (name === "")
    throw new Error("a teammate needs a non-empty name");
  if (plan.members.some((existing) => existing.name === name))
    throw new Error(`teammate "${name}" is already staged`);
  return { ...plan, members: [...plan.members, { ...member, name }] };
}
function addTask(plan, task) {
  const subject = task.subject.trim();
  if (subject === "")
    throw new Error("a task needs a non-empty subject");
  return { ...plan, tasks: [...plan.tasks, { ...task, subject }] };
}
function archivePlan(workspace, plan) {
  const target = join2(archiveDir(workspace), plan.planId);
  mkdirSync2(target, { recursive: true });
  writeJson(join2(target, "plan.json"), plan);
  const staged = stagingPath(workspace, plan.sessionId);
  if (existsSync2(staged))
    rmSync(staged, { force: true });
  return target;
}
function claimContract(workspace, task, claimant, now) {
  const previous = readJson(contractPath(workspace, task.id));
  const contract = {
    version: 1,
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    blockedBy: [...task.blockedBy ?? []],
    writeScopes: [...task.writeScopes ?? []],
    attempt: (previous?.attempt ?? 0) + 1,
    claimedBy: claimant,
    claimedAt: now.toISOString(),
    revision: task.revision
  };
  writeJson(contractPath(workspace, task.id), contract);
  return contract;
}
function readContract(workspace, taskId) {
  const contract = readJson(contractPath(workspace, taskId));
  return contract === undefined || contract.version !== 1 ? undefined : contract;
}
function listContracts(workspace) {
  let names = [];
  try {
    names = readdirSync(contractsDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const contract = readJson(join2(contractsDir(workspace), name));
    if (contract !== undefined && contract.version === 1)
      out.push(contract);
  }
  return out.sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));
}
function readHold(workspace) {
  const hold = readJson(holdPath(workspace));
  return hold === undefined || hold.version !== 1 ? undefined : hold;
}
function placeHold(workspace, reason, heldBy, now) {
  const hold = { version: 1, reason, heldAt: now.toISOString(), heldBy };
  writeJson(holdPath(workspace), hold);
  return hold;
}
function clearHold(workspace) {
  const path = holdPath(workspace);
  if (!existsSync2(path))
    return false;
  rmSync(path, { force: true });
  return true;
}
function archivePathFor(workspace, planId) {
  return join2(archiveDir(workspace), planId);
}
function moveIntoArchive(workspace, from, planId) {
  const target = archivePathFor(workspace, planId);
  mkdirSync2(archiveDir(workspace), { recursive: true });
  renameSync(from, target);
  return target;
}

// packages/mpd-team-tools-plugin/src/index.ts
var name = "mpd-team-tools";
var inject = ["tools", "commands"];
var text = (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
var dispatchPath = (workspace) => join3(workspace, ".mpd", "team", "dispatch.json");
function readLedger(workspace) {
  try {
    const raw = JSON.parse(readFileSync3(dispatchPath(workspace), "utf8"));
    return raw !== null && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeLedger(workspace, ledger) {
  mkdirSync3(join3(workspace, ".mpd", "team"), { recursive: true });
  writeFileSync2(dispatchPath(workspace), JSON.stringify(ledger, null, 2) + `
`);
}
function describePlan(plan) {
  if (plan === undefined)
    return "no staged plan";
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged";
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`;
}
function adapterFor(ctx) {
  const mounted = typeof ctx?.get === "function" ? ctx.get("mpdDsh") : undefined;
  return mounted ?? createDshAdapter(ctx);
}
function sessionIdOf(exec) {
  const agent = exec?.agent;
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id;
  return typeof id === "string" && id !== "" ? id : "workspace";
}
function apply(ctx) {
  const dsh = adapterFor(ctx);
  const disposers = [];
  const now = () => new Date;
  const where = (exec) => ({ workspace: dsh.workspaceRoot(exec), sessionId: sessionIdOf(exec) });
  const requirePlan = (exec) => {
    const { workspace, sessionId } = where(exec);
    const plan = readPlan(workspace, sessionId);
    if (plan === undefined)
      throw new Error("no team is staged in this session — call agent_teams_create first");
    if (plan.approvedAt !== undefined)
      throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`);
    return { workspace, sessionId, plan };
  };
  disposers.push(dsh.registerTool({
    name: "agent_teams_create",
    description: "Stage a team as a PLAN: name it, then add members and shared tasks, then approve it. Nothing is created and nobody is spawned until agent_teams_approve. Staging replaces any unapproved plan in this session (the previous one is archived).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The team's name, for the plan header." },
        description: { type: "string", description: "What this team is for. One or two sentences." },
        approval: { type: "string", enum: ["required", "automatic"], description: "`required` (default) waits for agent_teams_approve; `automatic` records that the captain may approve without asking." },
        replace: { type: "boolean", description: "Required to be true when a plan is already staged and approved — replacing an approved plan is a deliberate act." }
      },
      required: ["name"],
      additionalProperties: false
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args, value) => text(describePlan(value?.plan)) },
    execute: async (args, exec) => {
      const { workspace, sessionId } = where(exec);
      const existing = readPlan(workspace, sessionId);
      if (existing?.approvedAt !== undefined && args?.replace !== true) {
        throw new Error(`plan ${existing.planId} is already approved; pass replace:true to stage a different team`);
      }
      const plan = stagePlan(workspace, sessionId, {
        name: String(args?.name ?? "team"),
        description: String(args?.description ?? ""),
        approval: args?.approval === "automatic" ? "automatic" : "required"
      }, now());
      return { plan };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_add_member",
    description: "Add one teammate to the STAGED plan. `prompt` is what spawn_teammate will receive on approval; take a roster member's persona text from mpd_role_persona first when the member maps to one.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The teammate's name (unique within the plan)." },
        description: { type: "string", description: "One line on what this member is for." },
        prompt: { type: "string", description: "The full prompt the member receives. Required — a member with no prompt is a member with no job." },
        role: { type: "string", description: "Free-form role label for the plan header (e.g. the roster member's functional name)." }
      },
      required: ["name", "prompt"],
      additionalProperties: false
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args, value) => text(describePlan(value?.plan)) },
    execute: async (args, exec) => {
      const { workspace, plan } = requirePlan(exec);
      const member = {
        name: String(args?.name ?? ""),
        description: String(args?.description ?? ""),
        prompt: String(args?.prompt ?? ""),
        ...args?.role === undefined ? {} : { role: String(args.role) }
      };
      const next = addMember(plan, member);
      writePlan(workspace, next);
      return { plan: next };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_create_task",
    description: "Add one shared task to the STAGED plan. It is posted to the official board on approval, with its blockedBy/writeScopes intact.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The task title." },
        description: { type: "string", description: "The acceptance contract: what 'done' means." },
        blocked_by: { type: "array", items: { type: "string" }, description: "Subjects or ids of planned tasks this one waits for." },
        write_scopes: { type: "array", items: { type: "string" }, description: "Workspace-relative paths this task may write (advisory)." },
        owner: { type: "string", description: "The staged member name that should own it." }
      },
      required: ["subject", "description"],
      additionalProperties: false
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args, value) => text(describePlan(value?.plan)) },
    execute: async (args, exec) => {
      const { workspace, plan } = requirePlan(exec);
      const task = {
        subject: String(args?.subject ?? ""),
        description: String(args?.description ?? ""),
        ...Array.isArray(args?.blocked_by) ? { blockedBy: args.blocked_by.map(String) } : {},
        ...Array.isArray(args?.write_scopes) ? { writeScopes: args.write_scopes.map(String) } : {},
        ...args?.owner === undefined ? {} : { owner: String(args.owner) }
      };
      const next = addTask(plan, task);
      writePlan(workspace, next);
      return { plan: next };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_edit_plan",
    description: "Read or replace the STAGED plan's member and task lists atomically. Call with no `members`/`tasks` to read it back.",
    parameters: {
      type: "object",
      properties: {
        members: { type: "array", items: { type: "object" }, description: "Replacement member list (same shape as agent_teams_add_member)." },
        tasks: { type: "array", items: { type: "object" }, description: "Replacement task list (same shape as agent_teams_create_task)." },
        description: { type: "string", description: "Replacement plan description." }
      },
      additionalProperties: false
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args, value) => text(describePlan(value?.plan)) },
    execute: async (args, exec) => {
      const { workspace, sessionId } = where(exec);
      const plan = readPlan(workspace, sessionId);
      if (plan === undefined)
        throw new Error("no team is staged in this session — call agent_teams_create first");
      if (args?.members === undefined && args?.tasks === undefined && args?.description === undefined)
        return { plan };
      if (plan.approvedAt !== undefined)
        throw new Error(`plan ${plan.planId} is already approved and cannot be edited`);
      const next = {
        ...plan,
        ...args?.description === undefined ? {} : { description: String(args.description) },
        ...Array.isArray(args?.members) ? { members: args.members.map((raw) => {
          if (typeof raw?.name !== "string" || raw.name.trim() === "")
            throw new Error("every staged member needs a name");
          if (typeof raw?.prompt !== "string" || raw.prompt.trim() === "")
            throw new Error(`staged member "${raw.name}" needs a prompt`);
          return { name: raw.name, description: String(raw?.description ?? ""), prompt: raw.prompt, ...raw?.role === undefined ? {} : { role: String(raw.role) } };
        }) } : {},
        ...Array.isArray(args?.tasks) ? { tasks: args.tasks.map((raw) => {
          if (typeof raw?.subject !== "string" || raw.subject.trim() === "")
            throw new Error("every staged task needs a subject");
          return {
            subject: raw.subject,
            description: String(raw?.description ?? ""),
            ...Array.isArray(raw?.blockedBy) || Array.isArray(raw?.blocked_by) ? { blockedBy: (raw.blockedBy ?? raw.blocked_by).map(String) } : {},
            ...Array.isArray(raw?.writeScopes) || Array.isArray(raw?.write_scopes) ? { writeScopes: (raw.writeScopes ?? raw.write_scopes).map(String) } : {},
            ...raw?.owner === undefined ? {} : { owner: String(raw.owner) }
          };
        }) } : {}
      };
      writePlan(workspace, next);
      return { plan: next };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_approve",
    description: "Approve the staged plan and EXECUTE it: spawn every staged member through the official spawn_teammate and post every staged task to the official board (resolving `owner` to the spawned member and `blocked_by` to posted task ids). Reports what it created; a failure names the member or task it stopped at.",
    parameters: { type: "object", properties: { dry_run: { type: "boolean", description: "Report exactly what approval would create, and create nothing." } }, additionalProperties: false },
    output: {
      schema: { type: "object", properties: { plan: { type: "object" }, created: { type: "object" }, stoppedAt: { type: "string" } } },
      render: (_args, value) => text(value?.plan === undefined ? "nothing to approve" : `approved ${value.plan.planId}: ${value.created?.members?.length ?? 0} member(s), ${value.created?.tasks?.length ?? 0} task(s)` + (value?.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`))
    },
    execute: async (args, exec) => {
      const { workspace, sessionId } = where(exec);
      const plan = readPlan(workspace, sessionId);
      if (plan === undefined)
        throw new Error("no team is staged in this session — call agent_teams_create first");
      if (plan.approvedAt !== undefined)
        throw new Error(`plan ${plan.planId} is already approved`);
      const preview = { members: plan.members.map((member) => ({ name: member.name, id: "" })), tasks: plan.tasks.map((task) => ({ subject: task.subject, id: "" })) };
      if (args?.dry_run === true) {
        return { plan, created: preview, wouldSpawn: plan.members.length, wouldPost: plan.tasks.length };
      }
      const created = { members: [], tasks: [] };
      const bySubject = new Map;
      const idByName = new Map;
      let stoppedAt;
      for (const member of plan.members) {
        try {
          const spawned = await dsh.teamSpawnTeammate(exec.agent, {
            name: member.name,
            description: member.description === "" ? member.name : member.description,
            prompt: member.prompt,
            ...exec.signal === undefined ? {} : { signal: exec.signal }
          });
          const id = String(spawned?.id ?? spawned?.sessionId ?? spawned?.member?.id ?? "");
          created.members.push({ name: member.name, id });
          if (id !== "")
            idByName.set(member.name, id);
        } catch (error) {
          stoppedAt = `member ${member.name}: ${String(error?.message ?? error)}`;
          break;
        }
      }
      if (stoppedAt === undefined) {
        for (const task of plan.tasks) {
          try {
            const resolved = (task.blockedBy ?? []).map((reference) => bySubject.get(reference) ?? reference);
            const view = await dsh.teamCreateTask(exec.agent, {
              subject: task.subject,
              description: task.description,
              ...resolved.length === 0 ? {} : { blockedBy: resolved },
              ...task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes }
            });
            bySubject.set(task.subject, view.id);
            created.tasks.push({ subject: task.subject, id: view.id });
            const ownerId = task.owner === undefined ? undefined : idByName.get(task.owner);
            if (ownerId !== undefined) {
              await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "reassign", owner: ownerId });
            }
          } catch (error) {
            stoppedAt = `task ${task.subject}: ${String(error?.message ?? error)}`;
            break;
          }
        }
      }
      const approved = { ...plan, approvedAt: now().toISOString(), created };
      writePlan(workspace, approved);
      return { plan: approved, created, ...stoppedAt === undefined ? {} : { stoppedAt } };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_delete",
    description: "Archive the staged plan under .mpd/team/archive/<planId>/ and clear the staging slot. Archive-first: nothing is hard-deleted, so a reviewer can still read what was staged.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { archivedTo: { type: "string" } } }, render: (_args, value) => text(value?.archivedTo === undefined ? "nothing to archive" : `archived to ${value.archivedTo}`) },
    execute: async (_args, exec) => {
      const { workspace, sessionId } = where(exec);
      const plan = readPlan(workspace, sessionId);
      if (plan === undefined)
        return { archivedTo: undefined };
      const archivedTo = archivePlan(workspace, plan);
      return { archivedTo };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_claim_task",
    description: "Claim an OFFICIAL shared task for a teammate and freeze its contract: the task's subject, acceptance text, blockers and write scopes as they stand now, with a monotonic attempt counter (the Nth claim of this task). Returns the contract.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The official task id." },
        claimant: { type: "string", description: "Who claims it — a teammate name or session id. Defaults to the calling agent." }
      },
      required: ["task_id"],
      additionalProperties: false
    },
    output: { schema: { type: "object", properties: { contract: { type: "object" }, task: { type: "object" } } }, render: (_args, value) => text(value?.contract === undefined ? "no contract" : `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}`) },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const view = dsh.teamGetTask(exec.agent, String(args?.task_id ?? ""));
      const claimant = String(args?.claimant ?? sessionIdOf(exec));
      const contract = claimContract(workspace, {
        id: view.id,
        subject: view.subject,
        description: view.description,
        blockedBy: view.blockedBy,
        writeScopes: view.writeScopes,
        revision: view.revision
      }, claimant, now());
      const task = await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "claim" }).catch(() => view);
      return { contract, task };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_task_contract",
    description: "Read a frozen task contract (or every contract in this workspace when task_id is omitted), including its attempt counter.",
    parameters: { type: "object", properties: { task_id: { type: "string", description: "The official task id; omit for every contract, newest claim first." } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } } } }, render: (_args, value) => text(value?.contract ?? value?.contracts ?? "no contract") },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      if (args?.task_id === undefined)
        return { contracts: listContracts(workspace) };
      const contract = readContract(workspace, String(args.task_id));
      if (contract === undefined)
        throw new Error(`no contract for task "${String(args.task_id)}" — it has never been claimed through agent_teams_claim_task`);
      return { contract };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_halt",
    description: "HALT the team: record a hold that stops NEW dispatch while leaving the team and every teammate alive. Distinct from ending a team — nothing is archived and no member is interrupted.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Why the team is halted. Shown to anyone who asks for status." } }, required: ["reason"], additionalProperties: false },
    output: { schema: { type: "object", properties: { hold: { type: "object" } } }, render: (_args, value) => text(value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`) },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      return { hold: placeHold(workspace, String(args?.reason ?? ""), sessionIdOf(exec), now()) };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_resume",
    description: "Clear a halt recorded by agent_teams_halt. Reports whether one was there.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { resumed: { type: "boolean" } } }, render: (_args, value) => text(value?.resumed === true ? "resumed" : "was not halted") },
    execute: async (_args, exec) => ({ resumed: clearHold(where(exec).workspace) })
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_mail",
    description: 'The team mailbox. action:"send" sends a durable message to one member (through the official transport) and records it; action:"unread" lists what a member has NOT acknowledged; action:"read" acknowledges message ids; action:"summary" counts total/unread/undelivered per member. Delivery and reading are separate facts: a message the transport accepted is still UNREAD until the recipient acknowledges it.',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "unread", "read", "summary"], description: "What to do." },
        to: { type: "string", description: "send: the member name or id to message." },
        subject: { type: "string", description: "send: one line the recipient sees first." },
        body: { type: "string", description: "send: the message." },
        member: { type: "string", description: "unread: whose inbox (defaults to the caller)." },
        ids: { type: "array", items: { type: "string" }, description: "read: the message ids to acknowledge." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" } } },
      render: (_args, value) => text(value?.refused !== undefined ? `refused: ${value.refused}` : value?.message !== undefined ? `sent ${value.message.id} to ${value.message.toName}` : value?.moved !== undefined ? `acknowledged ${value.moved.length} message(s)` : value?.summary !== undefined ? value.summary.length === 0 ? "no mail" : value.summary.map((row) => `${row.memberName}: ${row.unread} unread / ${row.total} total`).join(`
`) : (value?.messages?.length ?? 0) === 0 ? "nothing unread" : value.messages.map((mail) => `${mail.id} from ${mail.fromName}: ${mail.subject}`).join(`
`))
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const caller = sessionIdOf(exec);
      const self = exec.agent;
      const roster = (() => {
        try {
          return dsh.teamListMembers(exec.agent);
        } catch {
          return [];
        }
      })();
      const resolve2 = (name2) => roster.find((member) => member.id === name2 || member.name === name2);
      const nameOf = (id) => roster.find((member) => member.id === id)?.name ?? id;
      if (args?.action === "send") {
        const target = resolve2(String(args?.to ?? ""));
        if (target === undefined) {
          return { refused: `"${String(args?.to ?? "")}" is not a member of this team (members: ${roster.map((m) => m.name).join(", ") || "none"})` };
        }
        const result = send(workspace, {
          fromId: self?.session?.id ?? caller,
          fromName: self?.session?.header?.title ?? caller,
          toId: target.id,
          toName: target.name,
          subject: String(args?.subject ?? ""),
          body: String(args?.body ?? ""),
          memberIds: roster.map((member) => member.id)
        }, now());
        if (!result.ok)
          return { refused: result.detail };
        try {
          await dsh.teamSendMessage(exec.agent, {
            target: target.id,
            content: dsh.text(`[${result.message.subject}]

${result.message.body}`),
            ...exec.signal === undefined ? {} : { signal: exec.signal }
          });
          markDelivered(workspace, [result.message.id], now());
        } catch (error) {
          console.warn(`[mpd-team-tools] the mailbox recorded ${result.message.id} but the transport refused it: ${String(error?.message ?? error)}`);
        }
        return { message: result.message };
      }
      if (args?.action === "read") {
        const ids = Array.isArray(args?.ids) ? args.ids.map(String) : [];
        return { moved: markRead(workspace, ids, now()) };
      }
      if (args?.action === "summary") {
        return { summary: summarise(readMailbox(workspace)) };
      }
      const state = readMailbox(workspace);
      const wanted = args?.member === undefined ? undefined : resolve2(String(args.member));
      const memberId = wanted?.id ?? self?.session?.id ?? caller;
      const pending = unreadOf(state, memberId);
      return {
        messages: pending.map((message2) => ({
          id: message2.id,
          fromName: message2.fromName,
          subject: message2.subject,
          body: message2.body,
          sentAt: message2.sentAt,
          delivered: message2.deliveredAt !== undefined
        })),
        undelivered: undeliveredOf(state, memberId).length,
        total: inboxOf(state, memberId).length,
        memberName: wanted?.name ?? nameOf(memberId)
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description: "Pair READY shared tasks with IDLE members and tell each member to work its task. One pass pairs each task with one member and RECORDS the pairing, so a second pass can never hand the same task to a second teammate. Respects agent_teams_halt (a held team dispatches nothing) and skips a task that is blocked, completed, already dispatched, or has no free member — reporting which, per task. dry_run reports the pairing without sending anything.",
    parameters: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Report the pairing and send nothing." },
        limit: { type: "number", description: "Cap the pairs in this pass (0 or omitted = no cap)." }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, forgotten: { type: "array", items: { type: "string" } } } },
      render: (_args, value) => text(value?.halted !== undefined ? `halted: ${value.halted}` : (value?.pairs?.length ?? 0) === 0 ? "nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row) => row.subject + ": " + row.reason).join("; ") + ")") : value.pairs.map((pair) => `${pair.subject} -> ${pair.memberName}`).join(`
`))
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const hold = readHold(workspace);
      const tasks = dsh.teamListTasks(exec.agent).map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        ready: task.ready,
        blockedBy: task.blockedBy,
        ...task.ownerName === undefined ? {} : { ownerName: task.ownerName }
      }));
      const members = dsh.teamListMembers(exec.agent).map((member) => ({ id: member.id, name: member.name, status: member.status }));
      const pruned = reconcile(readLedger(workspace), tasks);
      const plan = planDispatch({
        tasks,
        members,
        ledger: pruned.ledger,
        ...hold === undefined ? {} : { hold: hold.reason },
        ...typeof args?.limit === "number" ? { limit: args.limit } : {}
      });
      if (plan.halted !== undefined || args?.dry_run === true || plan.pairs.length === 0) {
        if (pruned.forgotten.length > 0)
          writeLedger(workspace, pruned.ledger);
        return { ...plan, forgotten: pruned.forgotten };
      }
      let ledger = pruned.ledger;
      const sent = [];
      const skipped = [...plan.skipped];
      for (const pair of plan.pairs) {
        const task = tasks.find((candidate) => candidate.id === pair.taskId);
        try {
          await dsh.teamSendMessage(exec.agent, {
            target: pair.memberId,
            content: dsh.text(dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String(task.description ?? ""))),
            ...exec.signal === undefined ? {} : { signal: exec.signal }
          });
          ledger = assign(ledger, pair, now());
          sent.push(pair);
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String(error?.message ?? error)}` });
        }
      }
      writeLedger(workspace, ledger);
      return { pairs: sent, skipped, forgotten: pruned.forgotten };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch_release",
    description: "Free one dispatched task so it can be dispatched again (a member finished, went away, or the work was reassigned). Reports whether a pairing was there.",
    parameters: { type: "object", properties: { task_id: { type: "string", description: "The task to free." } }, required: ["task_id"], additionalProperties: false },
    output: { schema: { type: "object", properties: { released: { type: "boolean" } } }, render: (_args, value) => text(value?.released === true ? "released" : "that task was not dispatched") },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const { ledger, released } = release(readLedger(workspace), String(args?.task_id ?? ""));
      if (released)
        writeLedger(workspace, ledger);
      return { released };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_status",
    description: "The team in one read: the STAGED plan and the halt from this bundle's sidecar, beside the OFFICIAL roster and shared board. Read-only.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { plan: { type: "object" }, hold: { type: "object" }, members: { type: "array", items: { type: "object" } }, tasks: { type: "array", items: { type: "object" } }, contracts: { type: "array", items: { type: "object" } } } }, render: (_args, value) => text(value) },
    execute: async (_args, exec) => {
      const { workspace, sessionId } = where(exec);
      const read = (fn, fallback) => {
        try {
          return fn();
        } catch {
          return fallback;
        }
      };
      return {
        plan: readPlan(workspace, sessionId) ?? null,
        hold: readHold(workspace) ?? null,
        members: read(() => dsh.teamListMembers(exec.agent), []),
        tasks: read(() => dsh.teamListTasks(exec.agent), []),
        contracts: read(() => listContracts(workspace), [])
      };
    }
  }));
  disposers.push(dsh.registerCommand({
    name: "agent-teams",
    description: "Stage a team for the current goal: /agent-teams <what the team is for>",
    input: { hint: "what the team is for" },
    handler: async (invocation) => {
      const workspace = dsh.workspaceRoot();
      const sessionId = sessionIdOf({ agent: invocation?.agent });
      const goal = String(invocation?.rawInput ?? "").trim();
      if (goal === "") {
        return { kind: "message", text: "Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_approve." };
      }
      const plan = stagePlan(workspace, sessionId, { name: goal.slice(0, 60), description: goal, approval: "required" }, now());
      return {
        kind: "message",
        text: `Staged ${describePlan(plan)}.
Add members with agent_teams_add_member and tasks with agent_teams_create_task, then approve with agent_teams_approve. Nobody is spawned before that.`
      };
    }
  }));
  const root = (() => {
    try {
      return dsh.workspaceRoot();
    } catch {
      return "";
    }
  })();
  if (root !== "") {
    try {
      const staging = join3(root, ".mpd", "team", "staging");
      const pending = existsSync3(staging) ? readdirSync2(staging).filter((file) => file.endsWith(".json")).length : 0;
      console.log(`[mpd-team-tools] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${disposers.length - 1} tools + the /agent-teams command)`);
    } catch {}
  }
  if (typeof ctx?.on === "function")
    ctx.on("dispose", () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {}
      }
    });
}
export {
  addMember,
  addTask,
  apply,
  archivePathFor,
  archivePlan,
  claimContract,
  clearHold,
  inject,
  listContracts,
  moveIntoArchive,
  name,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  teamRoot,
  writePlan
};
