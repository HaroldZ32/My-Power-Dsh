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
        return { ok: false, error: "the settings service is present but exposes no register() (keys: " + Object.keys(settings).slice(0, 8).join(",") + ")" };
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

// packages/mpd-ext-plugin/src/sdk.ts
var MPD_EXT_API_VERSION = 1;
var MPD_EXT_MANIFEST_FILE = "mpd-ext.json";
var MPD_EXT_DEFAULT_RANK = 300;
var MPD_EXT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
var MPD_EXT_SKILL_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
var MPD_EXT_SERVER_NAME_PATTERN = "^[A-Za-z0-9_-]{1,32}$";
var MPD_EXT_CONTRACT = {
  apiVersion: MPD_EXT_API_VERSION,
  manifestFile: MPD_EXT_MANIFEST_FILE,
  idPattern: MPD_EXT_ID_PATTERN,
  skillNamePattern: MPD_EXT_SKILL_NAME_PATTERN,
  serverNamePattern: MPD_EXT_SERVER_NAME_PATTERN,
  defaultRank: MPD_EXT_DEFAULT_RANK,
  defaultConnectTimeoutMs: 1e4,
  defaultToolCallTimeoutMs: 60000,
  descriptorKeys: ["apiVersion", "id", "description", "enabled", "contributes"],
  contributesKeys: ["skills", "flows", "mcp", "roles"],
  skillsItemKeys: ["root", "rank"],
  flowsItemKeys: ["dir", "rank"],
  mcpItemKeys: [
    "serverName",
    "transport",
    "command",
    "args",
    "env",
    "cwd",
    "toolCallTimeoutMs",
    "connectTimeoutMs"
  ],
  rolesItemKeys: ["name", "description", "readonly", "persona", "provider", "model"],
  projectKinds: ["skills", "flows"],
  hostKinds: ["skills", "flows", "mcp", "roles"],
  planes: ["project", "user", "bundle"],
  origins: ["plugin", "directory"],
  projectRejectionReason: "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session"
};

// packages/mpd-ext-plugin/src/registry.ts
import { existsSync, readFileSync as readFileSync3, readdirSync as readdirSync2 } from "node:fs";
import { isAbsolute, join as join2, resolve as resolve2 } from "node:path";

// packages/mpd-ext-plugin/src/skills.ts
import { readFileSync } from "node:fs";
var SKILL_NAME = new RegExp(MPD_EXT_SKILL_NAME_PATTERN);
function isAbsent(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
function parseScalar(value) {
  const text = value.trim();
  if (text === "")
    return "";
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
    return text.slice(1, -1).replace(/''/g, "'");
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "yes" || lower === "on")
    return true;
  if (lower === "false" || lower === "no" || lower === "off")
    return false;
  if (lower === "null" || text === "~")
    return null;
  if (/^-?\d+$/.test(text))
    return Number(text);
  if (/^-?\d*\.\d+$/.test(text))
    return Number(text);
  return text;
}
function foldLines(lines) {
  let out = "";
  for (const line of lines) {
    if (line === "")
      out += `
`;
    else
      out += (out === "" || out.endsWith(`
`) ? "" : " ") + line;
  }
  return out;
}
function parseYamlBlock(text) {
  const lines = text.split(`
`);
  const root = {};
  const stack = [{ indent: -1, map: root }];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    index += 1;
    if (raw.trim() === "" || raw.trimStart().startsWith("#"))
      continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.slice(indent);
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line);
    if (match === null)
      throw new Error("unsupported frontmatter line: " + line);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent)
      stack.pop();
    const parent = stack[stack.length - 1].map;
    const key = match[1];
    const rest = match[2] ?? "";
    if (rest.trim() === "") {
      let next;
      for (let probe = index;probe < lines.length; probe += 1) {
        const candidate = lines[probe];
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#"))
          continue;
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() };
        break;
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        const child = {};
        parent[key] = child;
        stack.push({ indent, map: child });
      } else
        parent[key] = null;
      continue;
    }
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim());
    if (block !== null) {
      const collected = [];
      let blockIndent = -1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (candidate.trim() === "") {
          collected.push("");
          index += 1;
          continue;
        }
        const candidateIndent = candidate.length - candidate.trimStart().length;
        if (candidateIndent <= indent)
          break;
        if (blockIndent < 0)
          blockIndent = candidateIndent;
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)));
        index += 1;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "")
        collected.pop();
      const joined = block[1] === "|" ? collected.join(`
`) : foldLines(collected);
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined;
      continue;
    }
    parent[key] = parseScalar(rest);
  }
  return root;
}
function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf(`
`);
  if (firstLineEnd < 0)
    return;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---")
    return;
  let lineStart = firstLineEnd + 1;
  let closingStart = -1;
  let bodyStart = -1;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf(`
`, lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      closingStart = lineStart;
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1;
      break;
    }
    if (nextNewline < 0)
      return;
    lineStart = nextNewline + 1;
  }
  if (closingStart < 0)
    return;
  return { data: parseYamlBlock(raw.slice(firstLineEnd + 1, closingStart)), body: raw.slice(bodyStart) };
}
function stringField(data, key) {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key))
    return;
  const value = data[key];
  if (typeof value === "boolean")
    return value;
  if (value === 1 || value === "1")
    return true;
  if (value === 0 || value === "0")
    return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "on")
      return true;
    if (lower === "false" || lower === "no" || lower === "off")
      return false;
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}
function parseInvocation(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) {
      const replacement = legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation";
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${replacement}"`);
    }
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false
  };
}
function readSkillDocument(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isAbsent(error))
      return { error: "cannot read " + filePath };
    return { error: "cannot read " + filePath + ": " + message2(error) };
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    return { error: "invalid frontmatter in " + filePath + ": " + message2(error) };
  }
  if (parsed === undefined)
    return { error: "missing YAML frontmatter in " + filePath };
  const skillName = stringField(parsed.data, "name");
  const description = stringField(parsed.data, "description");
  if (skillName === undefined)
    return { error: "frontmatter requires a non-empty name in " + filePath };
  if (description === undefined)
    return { error: "frontmatter requires a non-empty description in " + filePath };
  if (!SKILL_NAME.test(skillName))
    return { error: `frontmatter name "${skillName}" violates the skill-name grammar in ` + filePath };
  let invocation;
  try {
    invocation = parseInvocation(parsed.data);
  } catch (error) {
    return { error: message2(error) + " in " + filePath };
  }
  const metadata = parsed.data.metadata;
  return {
    document: {
      name: skillName,
      description,
      ...stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") } : {},
      invocation,
      content: parsed.body.trim(),
      ...typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? { metadata } : {}
    }
  };
}
function candidateViolation(candidate, providerName) {
  const value = candidate;
  if (value === null || typeof value !== "object")
    return "candidate is not an object";
  if (typeof value.name !== "string")
    return "candidate name is not a string";
  if (!SKILL_NAME.test(value.name))
    return `invalid skill name "${value.name}"`;
  if (typeof value.description !== "string")
    return `skill "${value.name}" has a non-string description`;
  if (value.description.length === 0)
    return `skill "${value.name}" has an empty description`;
  const invocation = value.invocation;
  if (invocation === undefined || invocation === null || typeof invocation !== "object") {
    return `skill "${value.name}" is missing its invocation booleans`;
  }
  if (typeof invocation.modelInvocable !== "boolean" || typeof invocation.userInvocable !== "boolean") {
    return `skill "${value.name}" invocation must carry boolean modelInvocable and userInvocable`;
  }
  if (value.whenToUse !== undefined && typeof value.whenToUse !== "string")
    return `skill "${value.name}" has a non-string whenToUse`;
  if (typeof value.source !== "string")
    return `skill "${value.name}" has a non-string source`;
  if (typeof value.rank !== "number" || !Number.isFinite(value.rank))
    return `skill "${value.name}" has a non-finite rank`;
  if (typeof value.provider !== "string")
    return `skill "${value.name}" has a non-string provider`;
  if (value.provider !== providerName)
    return `skill "${value.name}" carries provider "${value.provider}" instead of "${providerName}"`;
  if (value.path !== undefined && typeof value.path !== "string")
    return `skill "${value.name}" has a non-string path`;
  return;
}
function definitionViolation(definition, providerName, expectedName) {
  const value = definition;
  if (value === null || typeof value !== "object")
    return "definition is not an object";
  if (typeof value.name !== "string" || value.name !== expectedName)
    return `definition name does not match candidate "${expectedName}"`;
  if (typeof value.description !== "string" || value.description.length === 0)
    return `definition "${expectedName}" has an empty description`;
  if (typeof value.content !== "string")
    return `definition "${expectedName}" has non-string content`;
  const invocation = value.invocation;
  if (invocation === undefined || invocation === null)
    return `definition "${expectedName}" is missing its invocation`;
  if (typeof invocation.modelInvocable !== "boolean" || typeof invocation.userInvocable !== "boolean")
    return `definition "${expectedName}" has a malformed invocation`;
  if (value.provider !== undefined && value.provider !== providerName)
    return `definition "${expectedName}" carries provider "${value.provider}" instead of "${providerName}"`;
  return;
}
function candidateFor(entry, providerName) {
  const document = entry.document;
  return {
    name: document.name,
    description: document.description,
    ...document.whenToUse === undefined ? {} : { whenToUse: document.whenToUse },
    invocation: { ...document.invocation },
    source: entry.source,
    provider: providerName,
    rank: entry.rank,
    locator: entry.locator,
    ...document.path === undefined ? {} : { path: document.path },
    ...document.resourceBase === undefined ? {} : { resourceBase: document.resourceBase }
  };
}
function createSkillProvider(options) {
  const emit = (listOptions) => {
    let entries;
    try {
      entries = options.entries(listOptions);
    } catch (error) {
      const failure = `skill enumeration failed: ${message2(error)}`;
      options.warn(failure);
      options.onSkip?.(failure);
      return { candidates: [], complete: false };
    }
    const candidates = [];
    const seen = new Set;
    for (const entry of Array.isArray(entries) ? entries : []) {
      let candidate;
      try {
        candidate = candidateFor(entry, options.name);
      } catch (error) {
        options.warn(`skill candidate dropped: ${message2(error)}`);
        continue;
      }
      const violation = candidateViolation(candidate, options.name);
      if (violation !== undefined) {
        options.warn(`skill candidate skipped: ${violation}`);
        options.onSkip?.(violation, candidate.name);
        continue;
      }
      if (seen.has(candidate.name)) {
        const duplicate = `duplicate name "${candidate.name}" inside provider "${options.name}"`;
        options.warn(`skill candidate skipped: ${duplicate}`);
        options.onSkip?.(duplicate, candidate.name);
        continue;
      }
      seen.add(candidate.name);
      candidates.push(candidate);
    }
    return { candidates, complete: true };
  };
  return {
    name: options.name,
    async list(listOptions) {
      try {
        return emit(listOptions);
      } catch (error) {
        const failure = `skill provider "${options.name}" list() failed: ${message2(error)}`;
        options.warn(failure);
        options.onSkip?.(failure);
        return { candidates: [], complete: false };
      }
    },
    async get(candidate, listOptions) {
      try {
        const wanted = candidate?.name;
        if (typeof wanted !== "string")
          return;
        const entries = options.entries(listOptions);
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.document?.name !== wanted)
            continue;
          const definition = {
            name: entry.document.name,
            description: entry.document.description,
            ...entry.document.whenToUse === undefined ? {} : { whenToUse: entry.document.whenToUse },
            invocation: { ...entry.document.invocation },
            source: entry.source,
            provider: options.name,
            content: entry.document.content,
            ...entry.document.path === undefined ? {} : { path: entry.document.path },
            ...entry.document.resourceBase === undefined ? {} : { resourceBase: entry.document.resourceBase },
            ...entry.document.metadata === undefined ? {} : { metadata: entry.document.metadata }
          };
          const violation = definitionViolation(definition, options.name, wanted);
          if (violation !== undefined) {
            options.warn(`skill definition skipped: ${violation}`);
            return;
          }
          return definition;
        }
        return;
      } catch (error) {
        options.warn(`skill provider "${options.name}" get() failed: ${message2(error)}`);
        return;
      }
    }
  };
}
function allocateProviderName(taken, base) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2;suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}-${Date.now().toString(36)}`;
  taken.add(fallback);
  return fallback;
}
function message2(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-ext-plugin/src/flows.ts
import { readFileSync as readFileSync2, readdirSync } from "node:fs";
import { basename, join } from "node:path";
var FLOW_KEYS = ["id", "title", "description", "whenToUse", "steps"];
var FLOW_STEP_KEYS = ["title", "detail", "tool", "output"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function message3(error) {
  return error instanceof Error ? error.message : String(error);
}
function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function parseFlowDocument(raw, label) {
  const errors = [];
  if (!isRecord(raw))
    return { errors: [{ item: label, reason: "flow document must be a JSON object" }] };
  for (const key of unknownKeys(raw, FLOW_KEYS)) {
    errors.push({ item: label, reason: `unknown flow key "${key}"` });
  }
  const id = nonEmptyString(raw.id);
  if (id === undefined)
    errors.push({ item: label, reason: "flow id is required and must be a non-empty string" });
  else if (!new RegExp(MPD_EXT_SKILL_NAME_PATTERN).test(id)) {
    errors.push({ item: label, reason: `flow id "${id}" must satisfy the skill-name grammar ${MPD_EXT_SKILL_NAME_PATTERN}` });
  }
  const title = nonEmptyString(raw.title);
  if (title === undefined)
    errors.push({ item: label, reason: "flow title is required and must be a non-empty string" });
  const description = nonEmptyString(raw.description);
  if (description === undefined)
    errors.push({ item: label, reason: "flow description is required and must be a non-empty string" });
  if (raw.whenToUse !== undefined && typeof raw.whenToUse !== "string") {
    errors.push({ item: label, reason: "flow whenToUse must be a string when present" });
  }
  const steps = [];
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push({ item: label, reason: "flow steps is required and must be a non-empty array" });
  } else {
    raw.steps.forEach((step, index) => {
      const at = `${label}.steps[${index}]`;
      if (!isRecord(step)) {
        errors.push({ item: at, reason: "step must be a JSON object" });
        return;
      }
      for (const key of unknownKeys(step, FLOW_STEP_KEYS))
        errors.push({ item: at, reason: `unknown step key "${key}"` });
      const stepTitle = nonEmptyString(step.title);
      if (stepTitle === undefined)
        errors.push({ item: at, reason: "step title is required and must be a non-empty string" });
      for (const key of ["detail", "tool", "output"]) {
        if (step[key] !== undefined && typeof step[key] !== "string")
          errors.push({ item: `${at}.${key}`, reason: `step ${key} must be a string when present` });
      }
      if (stepTitle !== undefined) {
        steps.push({
          title: stepTitle,
          ...nonEmptyString(step.detail) === undefined ? {} : { detail: step.detail },
          ...nonEmptyString(step.tool) === undefined ? {} : { tool: step.tool },
          ...nonEmptyString(step.output) === undefined ? {} : { output: step.output }
        });
      }
    });
  }
  if (errors.length > 0)
    return { errors };
  return {
    flow: {
      id,
      title,
      description,
      ...typeof raw.whenToUse === "string" && raw.whenToUse.length > 0 ? { whenToUse: raw.whenToUse } : {},
      steps
    },
    errors: []
  };
}
function renderFlowSkill(flow) {
  const lines = [`# ${flow.title}`, "", flow.description, "", "## When to use", ""];
  lines.push(flow.whenToUse === undefined || flow.whenToUse.length === 0 ? "Use when the task matches the procedure below." : flow.whenToUse);
  lines.push("", "## Steps", "");
  flow.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}**`);
    if (step.detail !== undefined)
      lines.push(`   ${step.detail}`);
    if (step.tool !== undefined)
      lines.push(`   - tool: \`${step.tool}\``);
    if (step.output !== undefined)
      lines.push(`   - expected output: ${step.output}`);
    lines.push("");
  });
  lines.push("This flow is declarative: it describes the procedure, it does not execute it.", "Follow the steps with your own tools and report what each step produced.", "");
  return lines.join(`
`);
}
function flowEntry(flow, options) {
  return {
    document: {
      name: flow.id,
      description: flow.description,
      ...flow.whenToUse === undefined ? {} : { whenToUse: flow.whenToUse },
      invocation: { modelInvocable: true, userInvocable: true },
      content: renderFlowSkill(flow),
      resourceBase: { kind: "directory", path: options.directory },
      path: options.path
    },
    locator: { kind: "flow", extId: options.source, flowId: flow.id, path: options.path },
    source: options.source,
    rank: options.rank
  };
}
function loadFlows(directory, options) {
  const errors = [];
  const flows = [];
  const entries = [];
  let files;
  try {
    files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
  } catch (error) {
    errors.push({ item: options.itemLabel, reason: `cannot read flows directory ${directory}: ${message3(error)}` });
    return { flows, entries, errors };
  }
  for (const file of files) {
    const path = join(directory, file);
    const label = `${options.itemLabel} (${basename(file)})`;
    let raw;
    try {
      raw = JSON.parse(readFileSync2(path, "utf8"));
    } catch (error) {
      errors.push({ item: label, reason: `invalid JSON: ${message3(error)}` });
      continue;
    }
    const parsed = parseFlowDocument(raw, label);
    if (parsed.flow === undefined) {
      errors.push(...parsed.errors);
      continue;
    }
    const entry = flowEntry(parsed.flow, { path, directory, source: options.source, rank: options.rank });
    const candidateViolationReason = candidateViolation({
      name: entry.document.name,
      description: entry.document.description,
      ...entry.document.whenToUse === undefined ? {} : { whenToUse: entry.document.whenToUse },
      invocation: entry.document.invocation,
      source: entry.source,
      provider: options.providerName,
      rank: entry.rank,
      locator: entry.locator
    }, options.providerName);
    if (candidateViolationReason !== undefined) {
      errors.push({ item: label, reason: `rendered flow skill is not servable: ${candidateViolationReason}` });
      continue;
    }
    const definitionViolationReason = definitionViolation({
      name: entry.document.name,
      description: entry.document.description,
      invocation: entry.document.invocation,
      content: entry.document.content,
      provider: options.providerName
    }, options.providerName, entry.document.name);
    if (definitionViolationReason !== undefined) {
      errors.push({ item: label, reason: `rendered flow document is not servable: ${definitionViolationReason}` });
      continue;
    }
    flows.push(parsed.flow);
    entries.push(entry);
  }
  return { flows, entries, errors };
}

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

// packages/mpd-ext-plugin/src/registry.ts
var DEFAULT_EXTENSION_CONFIG = {
  enable: [],
  disable: [],
  mcp: {
    enabled: true,
    connectTimeoutMs: MPD_EXT_CONTRACT.defaultConnectTimeoutMs,
    toolCallTimeoutMs: MPD_EXT_CONTRACT.defaultToolCallTimeoutMs
  }
};
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function message4(error) {
  return error instanceof Error ? error.message : String(error);
}
function isRelativeAssetPath(value) {
  if (typeof value !== "string" || value.trim() === "")
    return false;
  if (isAbsolute(value))
    return false;
  if (/^[A-Za-z]:[\\/]/.test(value))
    return false;
  return !value.split(/[\\/]+/).includes("..");
}
function unknownKeyErrors(value, allowed, item) {
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      errors.push({ item: `${item}.${key}`, reason: `unknown key "${key}"` });
  }
  return errors;
}
var ROLE_REFUSAL_PREFIX = "refused: ";
var ROLE_NOT_EXPOSED_PREFIX = "not exposed: ";
function roleNameKey(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function extensionRoleId(extensionId, name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "ext-" + extensionId + "-" + (slug || "role");
}
var BASE_ROLE_NAME_KEYS = new Set(ROLES.map((role) => roleNameKey(role.name)));
function roleNameCollisionReason(extensionId, name, item, takenBy) {
  return `role name "${name}" (${item} of extension "${extensionId}") is already taken by ${takenBy} — this extension role is not exposed`;
}
function roleIdCollisionReason(id) {
  return `role id "${id}" collides with the base roster — this extension role is not exposed`;
}
function rolePersonaUnreadableReason(persona) {
  return `persona file is not readable: ${persona}`;
}
function readRolePersona(path) {
  try {
    return existsSync(path) ? readFileSync3(path, "utf8").trim() : "";
  } catch {
    return "";
  }
}
function annotateRoleSurfaces(entries, isEnabled) {
  const owner = new Map;
  for (const role of ROLES)
    owner.set(roleNameKey(role.name), "the base roster");
  for (const entry of entries) {
    const notes = [];
    const usable = [];
    const live = isEnabled === undefined ? entry.enabled !== false : isEnabled(entry);
    if (live) {
      for (const candidate of entry.roleCandidates) {
        const key = roleNameKey(candidate.name);
        const takenBy = owner.get(key);
        if (takenBy !== undefined) {
          notes.push({
            item: candidate.item,
            reason: ROLE_REFUSAL_PREFIX + roleNameCollisionReason(entry.id, candidate.name, candidate.item, takenBy)
          });
          continue;
        }
        if (!candidate.usable) {
          notes.push({ item: candidate.item, reason: ROLE_REFUSAL_PREFIX + (candidate.reason ?? "refused by the roster") });
          continue;
        }
        owner.set(key, `extension "${entry.id}"`);
        usable.push(candidate.name);
      }
    }
    entry.roles = usable;
    entry.contributions = { ...entry.contributions, roles: usable.length };
    entry.errors = [...entry.errors.filter((line) => !line.reason.startsWith(ROLE_REFUSAL_PREFIX)), ...notes];
    entry.pending = entry.pending.filter((line) => !line.reason.startsWith(ROLE_NOT_EXPOSED_PREFIX));
    if (!live && entry.roleCandidates.length > 0) {
      entry.pending.push({
        item: "contributes.roles",
        reason: ROLE_NOT_EXPOSED_PREFIX + `not exposed: this extension is ${entry.enabled === false ? "disabled (enabled=false)" : "disabled by config (extensions.disable)"}` + `, so none of its ${entry.roleCandidates.length} declared role(s) is resolved`
      });
    }
  }
}
function positiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
var SKILL_SURFACE_PREFIX = "skill surface: ";
function skillClaims(entry) {
  return [...entry.skillEntries, ...entry.flowEntries];
}
function claimItem(entry) {
  return entry.locator?.kind === "flow" ? "contributes.flows" : "contributes.skills";
}
function annotateSkillSurfaces(entries, isEnabled) {
  const live = (entry) => isEnabled === undefined ? entry.enabled !== false : isEnabled(entry);
  const winner = new Map;
  for (const entry of entries) {
    if (!live(entry))
      continue;
    for (const claim of skillClaims(entry)) {
      const current = winner.get(claim.document.name);
      if (current === undefined || claim.rank < current.rank)
        winner.set(claim.document.name, { rank: claim.rank, entry });
    }
  }
  for (const entry of entries) {
    const notes = [];
    if (live(entry)) {
      for (const claim of skillClaims(entry)) {
        const holder = winner.get(claim.document.name);
        if (holder === undefined || holder.entry.id === entry.id)
          continue;
        notes.push({
          item: claimItem(claim),
          reason: SKILL_SURFACE_PREFIX + `"${claim.document.name}" (rank ${claim.rank}) is also claimed by extension "${holder.entry.id}" (rank ${holder.rank}),` + ` which the harness serves instead — the lowest rank wins and the other candidate is dropped with a warning`
        });
      }
    }
    entry.errors = [...entry.errors.filter((line) => !line.reason.startsWith(SKILL_SURFACE_PREFIX)), ...notes];
    const declared = skillClaims(entry).length;
    entry.pending = entry.pending.filter((line) => !line.reason.startsWith(SKILL_SURFACE_PREFIX));
    if (!live(entry) && declared > 0) {
      entry.pending.push({
        item: "contributes.skills",
        reason: SKILL_SURFACE_PREFIX + `not served: this extension is ${entry.enabled === false ? "disabled (enabled=false)" : "disabled by config (extensions.disable)"}` + `, so none of its ${declared} declared skill candidate(s) reaches the catalog`
      });
    }
  }
}
function validateSkillsItem(raw, item) {
  const errors = [];
  if (!isRecord2(raw))
    return { errors: [{ item, reason: "skills item must be an object { root, rank? }" }] };
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.skillsItemKeys, item));
  if (!isRelativeAssetPath(raw.root)) {
    errors.push({ item: `${item}.root`, reason: "root must be a non-empty extension-root-relative directory (absolute paths and `..` escapes are rejected)" });
  }
  if (raw.rank !== undefined && (typeof raw.rank !== "number" || !Number.isFinite(raw.rank))) {
    errors.push({ item: `${item}.rank`, reason: "rank must be a finite number when present" });
  }
  if (errors.length > 0)
    return { errors };
  return {
    value: { root: raw.root, rank: raw.rank === undefined ? MPD_EXT_CONTRACT.defaultRank : raw.rank },
    errors
  };
}
function validateFlowsItem(raw, item) {
  const errors = [];
  if (!isRecord2(raw))
    return { errors: [{ item, reason: "flows item must be an object { dir, rank? }" }] };
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.flowsItemKeys, item));
  if (!isRelativeAssetPath(raw.dir)) {
    errors.push({ item: `${item}.dir`, reason: "dir must be a non-empty extension-root-relative directory (absolute paths and `..` escapes are rejected)" });
  }
  if (raw.rank !== undefined && (typeof raw.rank !== "number" || !Number.isFinite(raw.rank))) {
    errors.push({ item: `${item}.rank`, reason: "rank must be a finite number when present" });
  }
  if (errors.length > 0)
    return { errors };
  return {
    value: { dir: raw.dir, rank: raw.rank === undefined ? MPD_EXT_CONTRACT.defaultRank : raw.rank },
    errors
  };
}
function validateMcpItem(raw, item) {
  const errors = [];
  if (!isRecord2(raw))
    return { errors: [{ item, reason: "mcp item must be an object" }] };
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.mcpItemKeys, item));
  if (typeof raw.serverName !== "string" || !new RegExp(MPD_EXT_CONTRACT.serverNamePattern).test(raw.serverName)) {
    errors.push({ item: `${item}.serverName`, reason: `serverName is required and must match ${MPD_EXT_CONTRACT.serverNamePattern}` });
  }
  if (raw.transport !== "stdio")
    errors.push({ item: `${item}.transport`, reason: 'transport is required and must be "stdio" (http/sse are v1 non-goals)' });
  if (typeof raw.command !== "string" || raw.command.trim() === "")
    errors.push({ item: `${item}.command`, reason: "command is required and must be a non-empty string" });
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some((entry) => typeof entry !== "string"))) {
    errors.push({ item: `${item}.args`, reason: "args must be an array of strings when present" });
  }
  if (raw.env !== undefined && (!isRecord2(raw.env) || Object.values(raw.env).some((entry) => typeof entry !== "string"))) {
    errors.push({ item: `${item}.env`, reason: "env must be an object of string values when present" });
  }
  if (raw.cwd !== undefined && !isRelativeAssetPath(raw.cwd)) {
    errors.push({ item: `${item}.cwd`, reason: "cwd must be extension-root-relative (absolute paths and `..` escapes are rejected)" });
  }
  for (const key of ["toolCallTimeoutMs", "connectTimeoutMs"]) {
    if (raw[key] !== undefined && !positiveFinite(raw[key]))
      errors.push({ item: `${item}.${key}`, reason: `${key} must be a positive finite number when present` });
  }
  if (errors.length > 0)
    return { errors };
  return {
    value: {
      serverName: raw.serverName,
      transport: "stdio",
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args : [],
      env: isRecord2(raw.env) ? raw.env : {},
      cwd: raw.cwd === undefined ? "." : raw.cwd,
      toolCallTimeoutMs: raw.toolCallTimeoutMs === undefined ? MPD_EXT_CONTRACT.defaultToolCallTimeoutMs : raw.toolCallTimeoutMs,
      connectTimeoutMs: raw.connectTimeoutMs === undefined ? MPD_EXT_CONTRACT.defaultConnectTimeoutMs : raw.connectTimeoutMs
    },
    errors
  };
}
function validateRolesItem(raw, item) {
  const errors = [];
  if (!isRecord2(raw))
    return { errors: [{ item, reason: "roles item must be an object" }] };
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.rolesItemKeys, item));
  if (typeof raw.name !== "string" || raw.name.trim() === "")
    errors.push({ item: `${item}.name`, reason: "name is required and must be a non-empty string" });
  if (raw.description !== undefined && typeof raw.description !== "string")
    errors.push({ item: `${item}.description`, reason: "description must be a string when present" });
  if (raw.readonly !== undefined && typeof raw.readonly !== "boolean")
    errors.push({ item: `${item}.readonly`, reason: "readonly must be a boolean when present" });
  if (!isRelativeAssetPath(raw.persona)) {
    errors.push({ item: `${item}.persona`, reason: "persona is required and must be an extension-root-relative file (absolute paths and `..` escapes are rejected)" });
  }
  if (raw.provider === undefined !== (raw.model === undefined)) {
    errors.push({ item, reason: "provider and model must be supplied together (a partial route is rejected)" });
  }
  if (raw.provider !== undefined && typeof raw.provider !== "string")
    errors.push({ item: `${item}.provider`, reason: "provider must be a string when present" });
  if (raw.model !== undefined && typeof raw.model !== "string")
    errors.push({ item: `${item}.model`, reason: "model must be a string when present" });
  if (errors.length > 0)
    return { errors };
  return {
    value: {
      name: raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      readonly: raw.readonly === true,
      persona: raw.persona,
      ...typeof raw.provider === "string" ? { provider: raw.provider } : {},
      ...typeof raw.model === "string" ? { model: raw.model } : {}
    },
    errors
  };
}
function validateDescriptor(input) {
  if (!isRecord2(input))
    return { errors: [{ item: "descriptor", reason: "descriptor must be a JSON object" }], rejected: true };
  const errors = [];
  errors.push(...unknownKeyErrors(input, MPD_EXT_CONTRACT.descriptorKeys, "descriptor"));
  const fatal = [];
  if (input.apiVersion !== MPD_EXT_CONTRACT.apiVersion) {
    fatal.push({ item: "apiVersion", reason: `apiVersion must equal ${MPD_EXT_CONTRACT.apiVersion} (got ${JSON.stringify(input.apiVersion ?? null)})` });
  }
  const id = typeof input.id === "string" ? input.id : "";
  if (!new RegExp(MPD_EXT_CONTRACT.idPattern).test(id)) {
    fatal.push({ item: "id", reason: `id is required and must match ${MPD_EXT_CONTRACT.idPattern}` });
  }
  for (const error of fatal)
    errors.push(error);
  if (fatal.length > 0)
    return { errors, rejected: true };
  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push({ item: "description", reason: "description must be a string when present" });
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    errors.push({ item: "enabled", reason: "enabled must be a boolean when present" });
  }
  const contributes = { skills: [], flows: [], mcp: [], roles: [] };
  if (input.contributes !== undefined) {
    if (!isRecord2(input.contributes)) {
      errors.push({ item: "contributes", reason: "contributes must be an object when present" });
    } else {
      errors.push(...unknownKeyErrors(input.contributes, MPD_EXT_CONTRACT.contributesKeys, "contributes"));
      const kinds = [
        ["skills", validateSkillsItem],
        ["flows", validateFlowsItem],
        ["mcp", validateMcpItem],
        ["roles", validateRolesItem]
      ];
      for (const [kind, validateItem] of kinds) {
        const raw = input.contributes[kind];
        if (raw === undefined)
          continue;
        if (!Array.isArray(raw)) {
          errors.push({ item: `contributes.${kind}`, reason: `contributes.${kind} must be an array when present` });
          continue;
        }
        raw.forEach((item, index) => {
          const result = validateItem(item, `contributes.${kind}[${index}]`);
          errors.push(...result.errors);
          if (result.value !== undefined)
            contributes[kind].push(result.value);
        });
      }
    }
  }
  return {
    descriptor: {
      apiVersion: MPD_EXT_CONTRACT.apiVersion,
      id,
      description: typeof input.description === "string" ? input.description : "",
      enabled: input.enabled !== false,
      contributes
    },
    errors,
    rejected: false
  };
}
function enumerateSkillEntries(directory, options) {
  const entries = [];
  const errors = [];
  let dirs;
  try {
    dirs = readdirSync2(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    errors.push({ item: options.itemLabel, reason: `cannot read skills root ${directory}: ${message4(error)}` });
    return { entries, errors };
  }
  for (const name of dirs) {
    const skillPath = join2(directory, name, "SKILL.md");
    if (!existsSync(skillPath))
      continue;
    const item = `${options.itemLabel}/${name}`;
    const parsed = readSkillDocument(skillPath);
    if (parsed.document === undefined) {
      errors.push({ item, reason: parsed.error ?? "unreadable SKILL.md" });
      continue;
    }
    entries.push({
      document: {
        ...parsed.document,
        resourceBase: { kind: "directory", path: join2(directory, name) },
        path: skillPath
      },
      locator: { kind: "skill", path: skillPath, directory: join2(directory, name) },
      source: options.source,
      rank: options.rank
    });
  }
  return { entries, errors };
}
function buildExtension(options) {
  const validation = validateDescriptor(options.input);
  if (validation.rejected || validation.descriptor === undefined) {
    return {
      rejected: {
        id: typeof options.input?.id === "string" ? String(options.input.id) : options.fallbackId,
        plane: options.plane,
        origin: options.origin,
        root: options.root,
        source: options.source,
        errors: validation.errors
      }
    };
  }
  const descriptor = validation.descriptor;
  const errors = [...validation.errors];
  const pending = [];
  const skillEntries = [];
  const flowEntries = [];
  const flowDocs = [];
  const resolvedRoots = { root: options.root, skills: [], flows: [] };
  const projectOnly = options.plane === "project";
  const refuseHostKind = (kind, index) => {
    if (!projectOnly)
      return false;
    errors.push({
      item: `contributes.${kind}[${index}]`,
      reason: MPD_EXT_CONTRACT.projectRejectionReason
    });
    return true;
  };
  if (descriptor.contributes.skills.length > 0 && options.root === "") {
    errors.push({ item: "contributes.skills", reason: "an extension root is required to resolve skills assets (pass { root } to register())" });
  } else {
    descriptor.contributes.skills.forEach((item, index) => {
      const label = `contributes.skills[${index}]`;
      const directory = resolve2(options.root, item.root);
      resolvedRoots.skills.push(directory);
      const loaded = enumerateSkillEntries(directory, { source: options.source, rank: item.rank, itemLabel: label });
      skillEntries.push(...loaded.entries);
      errors.push(...loaded.errors);
    });
  }
  if (descriptor.contributes.flows.length > 0 && options.root === "") {
    errors.push({ item: "contributes.flows", reason: "an extension root is required to resolve flows assets (pass { root } to register())" });
  } else {
    descriptor.contributes.flows.forEach((item, index) => {
      const label = `contributes.flows[${index}]`;
      const directory = resolve2(options.root, item.dir);
      resolvedRoots.flows.push(directory);
      const loaded = loadFlows(directory, {
        rank: item.rank,
        source: options.source,
        providerName: options.providerName,
        itemLabel: label
      });
      flowEntries.push(...loaded.entries);
      flowDocs.push(...loaded.flows);
      errors.push(...loaded.errors);
    });
  }
  const roleCandidates = [];
  descriptor.contributes.roles.forEach((item, index) => {
    const label = `contributes.roles[${index}]`;
    const persona = options.root === "" ? item.persona : resolve2(options.root, item.persona);
    const refuse = (reason) => {
      roleCandidates.push({ index, item: label, name: item.name, persona, usable: false, reason });
      errors.push({ item: label, reason: ROLE_REFUSAL_PREFIX + reason });
    };
    if (refuseHostKind("roles", index)) {
      return;
    }
    if (options.root === "") {
      errors.push({ item: label, reason: "an extension root is required to resolve the persona file (pass { root } to register())" });
      refuse(rolePersonaUnreadableReason(item.persona));
      return;
    }
    if (BASE_ROLE_NAME_KEYS.has(roleNameKey(item.name))) {
      refuse(roleNameCollisionReason(descriptor.id, item.name, label, "the base roster"));
      return;
    }
    const id = extensionRoleId(descriptor.id, item.name);
    if (ROLE_BY_ID[id] !== undefined) {
      refuse(roleIdCollisionReason(id));
      return;
    }
    if (readRolePersona(persona) === "") {
      errors.push({
        item: `${label}.persona`,
        reason: existsSync(persona) ? `persona file is empty: ${persona}` : `persona file does not exist: ${persona}`
      });
      refuse(rolePersonaUnreadableReason(persona));
      return;
    }
    roleCandidates.push({ index, item: label, name: item.name, persona, usable: true });
  });
  descriptor.contributes.mcp.forEach((item, index) => {
    if (refuseHostKind("mcp", index))
      return;
    pending.push({
      item: `contributes.mcp[${index}]`,
      reason: `pending: server "${item.serverName}" is declared and not connected yet` + ` (connectTimeoutMs=${item.connectTimeoutMs}, toolCallTimeoutMs=${item.toolCallTimeoutMs})` + ` — the runtime bridge replaces this line with the server's live state`
    });
  });
  const mcpCount = projectOnly ? 0 : descriptor.contributes.mcp.length;
  const usableRoles = roleCandidates.filter((candidate) => candidate.usable);
  const roles = usableRoles.map((candidate) => candidate.name);
  const roleRoots = usableRoles.map((candidate) => candidate.persona);
  return {
    entry: {
      id: descriptor.id,
      origin: options.origin,
      plane: options.plane,
      root: options.root,
      source: options.source,
      providerName: options.providerName,
      descriptor,
      enabled: descriptor.enabled,
      errors,
      pending,
      resolvedRoots: { ...resolvedRoots, roles: roleRoots },
      contributions: {
        skills: skillEntries.length,
        flows: flowEntries.length,
        mcp: mcpCount,
        roles: roles.length
      },
      skills: skillEntries.map((entry) => entry.document.name),
      flows: flowDocs.map((flow) => flow.id),
      roles,
      roleCandidates,
      skillEntries,
      flowEntries,
      flowDocs,
      mcp: []
    }
  };
}
function effectiveEnabled(entry, config) {
  if (config.disable.includes(entry.id))
    return false;
  if (config.enable.includes(entry.id))
    return true;
  return entry.enabled;
}

class MpdExtensionRegistry {
  entries = [];
  byId = new Map;
  shadowRecords = [];
  rejectedRecords = [];
  add(entry) {
    const kept = this.byId.get(entry.id);
    if (kept !== undefined) {
      const record = {
        id: entry.id,
        kept: { plane: kept.plane, root: kept.root },
        shadowed: { plane: entry.plane, root: entry.root }
      };
      this.shadowRecords.push(record);
      return { ok: false, shadowed: record };
    }
    this.byId.set(entry.id, entry);
    this.entries.push(entry);
    return { ok: true };
  }
  addRejected(record) {
    this.rejectedRecords.push(record);
  }
  apply(result, fallback) {
    if (result.entry !== undefined) {
      this.add(result.entry);
      return result.entry;
    }
    if (result.rejected !== undefined)
      this.addRejected(result.rejected);
    else
      this.addRejected({ ...fallback, id: fallback.fallbackId, errors: [{ item: "descriptor", reason: "extension could not be loaded" }] });
    return;
  }
  get(id) {
    return this.byId.get(id);
  }
  all() {
    return [...this.entries];
  }
  shadowed() {
    return [...this.shadowRecords];
  }
  rejected() {
    return [...this.rejectedRecords];
  }
  view(project, options = {}) {
    const seen = new Map;
    for (const entry of project.entries)
      seen.set(entry.id, entry);
    const shadowed = [...this.shadowRecords];
    for (const entry of this.entries) {
      const kept = seen.get(entry.id);
      if (kept !== undefined) {
        shadowed.push({ id: entry.id, kept: { plane: kept.plane, root: kept.root }, shadowed: { plane: entry.plane, root: entry.root } });
        continue;
      }
      seen.set(entry.id, entry);
    }
    const entries = [...seen.values()];
    annotateRoleSurfaces(entries, options.isEnabled);
    annotateSkillSurfaces(entries, options.isEnabled);
    return { entries, shadowed, rejected: [...this.rejectedRecords, ...project.rejected] };
  }
}

// packages/mpd-ext-plugin/src/manifest.ts
import { existsSync as existsSync2, readFileSync as readFileSync4, readdirSync as readdirSync3 } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";
function bundleRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function projectExtensionsDir(workspaceRoot) {
  return join3(workspaceRoot, ".mpd", "extensions");
}
function userExtensionsDir() {
  const home = typeof process.env.HOME === "string" && process.env.HOME.length > 0 ? process.env.HOME : homedir();
  return join3(home, ".mpd", "extensions");
}
function bundleExtensionsDir() {
  return join3(bundleRoot(), "extensions");
}
function message5(error) {
  return error instanceof Error ? error.message : String(error);
}
function discoverPlane(options) {
  const result = { plane: options.plane, dir: options.dir, entries: [], rejected: [], done: false };
  const reject = (record) => {
    result.rejected.push(record);
    options.warn(`${record.id} (${record.source}) rejected: ${record.errors.map((error) => error.reason).join("; ")}`);
  };
  if (options.dir === "" || !existsSync2(options.dir)) {
    result.done = true;
    return result;
  }
  let names;
  try {
    names = readdirSync3(options.dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    options.warn(`extension plane ${options.dir} unreadable: ${message5(error)}`);
    result.done = true;
    return result;
  }
  for (const name of names) {
    const directory = join3(options.dir, name);
    const manifestPath = join3(directory, MPD_EXT_CONTRACT.manifestFile);
    if (!existsSync2(manifestPath))
      continue;
    let raw;
    try {
      raw = readFileSync4(manifestPath, "utf8");
    } catch (error) {
      reject({
        id: name,
        plane: options.plane,
        origin: "directory",
        root: directory,
        source: manifestPath,
        errors: [{ item: MPD_EXT_CONTRACT.manifestFile, reason: `cannot read: ${message5(error)}` }]
      });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      reject({
        id: name,
        plane: options.plane,
        origin: "directory",
        root: directory,
        source: manifestPath,
        errors: [{ item: MPD_EXT_CONTRACT.manifestFile, reason: `invalid JSON: ${message5(error)}` }]
      });
      continue;
    }
    const declaredId = parsed?.id;
    const id = typeof declaredId === "string" && declaredId.length > 0 ? declaredId : name;
    const built = buildExtension({
      input: parsed,
      plane: options.plane,
      origin: "directory",
      root: directory,
      source: manifestPath,
      fallbackId: name,
      providerName: options.providerNameFor(id, directory)
    });
    if (built.entry !== undefined)
      result.entries.push(built.entry);
    else if (built.rejected !== undefined)
      reject(built.rejected);
  }
  result.done = true;
  return result;
}
function projectExtensionIds(workspaceRoot) {
  const ids = new Set;
  const dir = projectExtensionsDir(workspaceRoot);
  let names;
  try {
    names = readdirSync3(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return ids;
  }
  for (const name of names) {
    const manifestPath = join3(dir, name, MPD_EXT_CONTRACT.manifestFile);
    try {
      const parsed = JSON.parse(readFileSync4(manifestPath, "utf8"));
      ids.add(typeof parsed?.id === "string" && parsed.id.length > 0 ? parsed.id : name);
    } catch {
      ids.add(name);
    }
  }
  return ids;
}
function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function extensionConfig(ctx) {
  let service;
  try {
    service = typeof ctx?.get === "function" ? ctx.get("mpdConfig") : undefined;
  } catch {
    service = undefined;
  }
  if (service === undefined || service === null || typeof service.get !== "function")
    return DEFAULT_EXTENSION_CONFIG;
  const read = (key) => {
    try {
      return service.get(key);
    } catch {
      return;
    }
  };
  const enable = read("extensions.enable");
  const disable = read("extensions.disable");
  const mcp = read("extensions.mcp");
  const mcpRecord = typeof mcp === "object" && mcp !== null && !Array.isArray(mcp) ? mcp : undefined;
  return {
    enable: Array.isArray(enable) ? enable.filter((entry) => typeof entry === "string") : [],
    disable: Array.isArray(disable) ? disable.filter((entry) => typeof entry === "string") : [],
    mcp: {
      enabled: typeof mcpRecord?.enabled === "boolean" ? mcpRecord.enabled : true,
      connectTimeoutMs: positiveNumber(mcpRecord?.connectTimeoutMs) ?? MPD_EXT_CONTRACT.defaultConnectTimeoutMs,
      toolCallTimeoutMs: positiveNumber(mcpRecord?.toolCallTimeoutMs) ?? MPD_EXT_CONTRACT.defaultToolCallTimeoutMs
    }
  };
}

// packages/mpd-ext-plugin/src/mcp.ts
import { resolve as resolve3 } from "node:path";

// packages/mpd-ext-plugin/src/mcp-client.ts
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
var MAX_PUBLIC_NAME_LENGTH = 64;
var INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
var HASH_LENGTH = 12;
var MCP_PROTOCOL_VERSION = "2025-11-25";
var MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07"
];
var STDERR_TAIL_CHARS = 2000;
var INHERITED_ENV_VARS = process.platform === "win32" ? [
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERNAME",
  "USERPROFILE",
  "PROGRAMFILES"
] : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];
var CREDENTIAL_SHAPED = /(^|_)(TOKEN|TOKENS|KEY|KEYS|APIKEY|SECRET|SECRETS|CREDENTIAL|CREDENTIALS|PASSWORD|PASSWORDS|PASSWD)(_|$)/i;
function isCredentialShapedEnvName(name) {
  return CREDENTIAL_SHAPED.test(name) || /PASSWORD/i.test(name);
}
function childEnv(declared = {}, parent = process.env) {
  const env = {};
  for (const key of INHERITED_ENV_VARS) {
    const value = parent[key];
    if (typeof value !== "string")
      continue;
    if (isCredentialShapedEnvName(key))
      continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === "string")
      env[key] = value;
  }
  return env;
}
function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(INVALID_NAME_CHARS, "_");
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH)
    return normalized;
  const hash = createHash("sha256").update(`${serverName}\x00${rawName}`).digest("hex").slice(0, HASH_LENGTH);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}

class McpProtocolError extends Error {
  constructor(message6) {
    super(message6);
    this.name = "McpProtocolError";
  }
}
var EXIT_FLUSH_MS = 25;
async function raceWithTimer(work, ms) {
  let timer;
  const timeout = new Promise((resolve3) => {
    timer = setTimeout(() => resolve3({ timedOut: true }), ms);
  });
  const done = await Promise.race([work.then(() => ({ timedOut: false })), timeout]);
  if (timer !== undefined)
    clearTimeout(timer);
  return done;
}

class McpStdioClient {
  serverName;
  spec;
  options;
  child;
  buffer = "";
  protocolErrors = [];
  stderrBuffer = "";
  pending = new Map;
  nextId = 1;
  exited = false;
  exitWaiter;
  resolveExit;
  constructor(spec, options = {}) {
    this.serverName = spec.serverName;
    this.spec = spec;
    this.options = options;
  }
  get pid() {
    return this.child?.pid;
  }
  get alive() {
    return this.child !== undefined && !this.exited;
  }
  stderrTail() {
    return this.stderrBuffer.trim();
  }
  protocolErrorList() {
    return [...this.protocolErrors];
  }
  async start(timeoutMs) {
    if (this.child !== undefined)
      throw new Error(`mcp-client(${this.serverName}): already started`);
    const exitWaiter = Promise.withResolvers();
    this.exitWaiter = exitWaiter.promise;
    this.resolveExit = () => exitWaiter.resolve();
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: childEnv(this.spec.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: process.platform === "win32"
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.consume(chunk));
    child.stderr?.on("data", (chunk) => {
      this.stderrBuffer = (this.stderrBuffer + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.stdin?.on("error", () => {});
    child.on("error", (error) => {
      this.failAll(new Error(`mcp-client(${this.serverName}): cannot start "${this.spec.command}": ${error.message}`));
      this.markExited(null, null);
    });
    child.on("exit", (code, signal) => {
      setTimeout(() => this.markExited(code, signal), EXIT_FLUSH_MS);
    });
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mpd-ext-plugin", version: "0.9.0" }
    }, timeoutMs);
    const protocolVersion = result?.protocolVersion;
    if (typeof protocolVersion !== "string") {
      throw new McpProtocolError(`mcp-client(${this.serverName}): initialize result carries no protocolVersion`);
    }
    if (!MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      throw new McpProtocolError(`mcp-client(${this.serverName}): server protocol version "${protocolVersion}" is not supported (${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`);
    }
    this.notify("notifications/initialized", undefined);
  }
  async listTools(timeoutMs) {
    const tools = [];
    const seenCursors = new Set;
    let cursor;
    do {
      const result = await this.request("tools/list", cursor === undefined ? {} : { cursor }, timeoutMs);
      const page = result?.tools;
      if (!Array.isArray(page)) {
        throw new McpProtocolError(`mcp-client(${this.serverName}): tools/list returned no tools array`);
      }
      for (const entry of page) {
        if (typeof entry !== "object" || entry === null)
          continue;
        const tool = entry;
        if (typeof tool.name !== "string" || tool.name.length === 0)
          continue;
        tools.push({
          name: tool.name,
          ...typeof tool.description === "string" ? { description: tool.description } : {},
          ...tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema },
          ...tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }
        });
      }
      const next = result?.nextCursor;
      cursor = typeof next === "string" && next.length > 0 ? next : undefined;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new McpProtocolError(`mcp-client(${this.serverName}): server repeated a tools/list continuation cursor`);
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);
    return tools;
  }
  async callTool(rawName, args, options) {
    const result = await this.request("tools/call", { name: rawName, arguments: args }, options.timeoutMs, options.signal);
    if (result === undefined || result === null)
      return {};
    if (typeof result !== "object")
      throw new McpProtocolError(`mcp-client(${this.serverName}): tools/call returned a non-object result`);
    return result;
  }
  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, ...params === undefined ? {} : { params } });
  }
  async close(graceMs = 2000) {
    const child = this.child;
    if (child === undefined)
      return;
    const waiter = this.exitWaiter ?? Promise.resolve();
    this.failAll(new Error(`mcp-client(${this.serverName}): closed`));
    try {
      child.stdin?.end();
    } catch {}
    if (!this.exited) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
    const first = await raceWithTimer(waiter, graceMs);
    if (first.timedOut && !this.exited) {
      try {
        child.kill("SIGKILL");
      } catch {}
      await raceWithTimer(waiter, 500);
    }
    this.exited = true;
    this.child = undefined;
  }
  markExited(code, signal) {
    if (this.exited)
      return;
    this.exited = true;
    this.failAll(new Error(`mcp-client(${this.serverName}): the server process exited (code=${String(code)}, signal=${String(signal)})`));
    this.resolveExit?.();
    try {
      this.options.onExit?.({ code, signal });
    } catch {}
  }
  failAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
  write(message6) {
    const stdin = this.child?.stdin;
    if (stdin === undefined || stdin === null || stdin.destroyed) {
      throw new Error(`mcp-client(${this.serverName}): the server process is not writable`);
    }
    stdin.write(JSON.stringify(message6) + `
`);
  }
  request(method, params, timeoutMs, signal) {
    if (!this.alive) {
      return Promise.reject(new Error(`mcp-client(${this.serverName}): the server process is not running`));
    }
    const id = this.nextId++;
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp-client(${this.serverName}): ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const onAbort = () => {
        if (!this.pending.delete(id))
          return;
        clearTimeout(timer);
        reject(new Error(`mcp-client(${this.serverName}): ${method} aborted`));
      };
      if (signal !== undefined) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new Error(`mcp-client(${this.serverName}): ${method} aborted`));
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, {
        method,
        timer,
        resolve: (value) => {
          if (signal !== undefined)
            signal.removeEventListener("abort", onAbort);
          resolve3(value);
        },
        reject: (error) => {
          if (signal !== undefined)
            signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
      try {
        this.write({ jsonrpc: "2.0", id, method, params: params ?? {} });
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending !== undefined) {
          this.pending.delete(id);
          clearTimeout(pending.timer);
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  consume(chunk) {
    this.buffer += chunk;
    while (true) {
      const index = this.buffer.indexOf(`
`);
      if (index === -1)
        break;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim().length === 0)
        continue;
      this.handleLine(line);
    }
  }
  handleLine(line) {
    let message6;
    try {
      message6 = JSON.parse(line);
    } catch {
      this.protocolErrors.push(`non-JSON line on stdout: ${line.slice(0, 200)}`);
      return;
    }
    if (typeof message6 !== "object" || message6 === null) {
      this.protocolErrors.push(`non-object JSON-RPC message: ${line.slice(0, 200)}`);
      return;
    }
    const record = message6;
    const id = record.id;
    if (typeof id === "number" || typeof id === "string") {
      const pending = this.pending.get(id);
      if (pending === undefined)
        return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (record.error !== undefined) {
        const detail = record.error;
        pending.reject(new Error(`mcp-client(${this.serverName}): ${pending.method} failed: ${typeof detail?.message === "string" ? detail.message : JSON.stringify(record.error)}`));
        return;
      }
      pending.resolve(record.result);
      return;
    }
    if (typeof record.method === "string") {
      try {
        this.options.onNotification?.({ method: record.method, params: record.params });
      } catch {}
    }
  }
}

// packages/mpd-ext-plugin/src/schema-sanitize.ts
var SCHEMA_CONSTRAINT_KEYWORDS = [
  "type",
  "oneOf",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const"
];
var SCHEMA_ANNOTATION_KEYWORDS = ["description", "title", "default", "examples"];
var SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"];
var SCALAR_TYPES = ["string", "number", "integer", "boolean", "null"];
var ONE_OF_SIBLING_KEYWORDS = [
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const"
];
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isJsonNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
function isLosslessJson(value, seen) {
  if (value === null)
    return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean")
    return true;
  if (kind === "number")
    return isJsonNumber(value);
  if (kind !== "object")
    return false;
  const record = value;
  if (seen.has(record))
    return false;
  seen.add(record);
  let ok = true;
  if (Array.isArray(value)) {
    ok = value.every((entry) => isLosslessJson(entry, seen));
  } else if (isPlainRecord(value)) {
    ok = Object.values(value).every((entry) => isLosslessJson(entry, seen));
  } else {
    ok = false;
  }
  seen.delete(record);
  return ok;
}
function scalarMatches(type, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return isJsonNumber(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}
function schemaViolations(root, rootPath = "schema") {
  const violations = [];
  const seen = new Set;
  const visitObjectTail = (node, path) => {
    if (Object.hasOwn(node, "required")) {
      const required = node.required;
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
        violations.push(`${path}.required must be an array of strings`);
      } else {
        const declared = isPlainRecord(node.properties) ? node.properties : {};
        for (const key of required) {
          if (!Object.hasOwn(declared, key))
            violations.push(`${path}.required names "${key}" which is not in properties`);
        }
      }
    }
    if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
      violations.push(`${path}.additionalProperties must be a boolean`);
    }
  };
  const visit = (node, path) => {
    if (!isPlainRecord(node)) {
      violations.push(`${path} must be a schema object`);
      return;
    }
    if (seen.has(node)) {
      violations.push(`${path} is circular`);
      return;
    }
    seen.add(node);
    for (const key of Object.keys(node)) {
      if (SCHEMA_CONSTRAINT_KEYWORDS.includes(key))
        continue;
      if (SCHEMA_ANNOTATION_KEYWORDS.includes(key)) {
        if (!isLosslessJson(node[key], new Set))
          violations.push(`${path}.${key} annotation must be lossless JSON data`);
        continue;
      }
      violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
    }
    if (Object.hasOwn(node, "description") && typeof node.description !== "string") {
      violations.push(`${path}.description must be a string`);
    }
    if (Object.hasOwn(node, "title") && typeof node.title !== "string") {
      violations.push(`${path}.title must be a string`);
    }
    const hasType = Object.hasOwn(node, "type");
    const hasOneOf = Object.hasOwn(node, "oneOf");
    if (hasType && hasOneOf) {
      violations.push(`${path} cannot declare both type and oneOf`);
      seen.delete(node);
      return;
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key))
          violations.push(`${path}.${key} requires type or oneOf`);
      }
      seen.delete(node);
      return;
    }
    if (hasOneOf) {
      const oneOf = node.oneOf;
      if (!Array.isArray(oneOf) || oneOf.length < 2) {
        violations.push(`${path}.oneOf must be an array of at least two schemas`);
      } else {
        oneOf.forEach((branch, index) => visit(branch, `${path}.oneOf[${index}]`));
      }
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key))
          violations.push(`${path}.${key} is not supported beside oneOf`);
      }
      seen.delete(node);
      return;
    }
    const type = node.type;
    if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
      violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
      seen.delete(node);
      return;
    }
    const allowedFor = {
      properties: ["object"],
      required: ["object"],
      additionalProperties: ["object"],
      items: ["array"],
      enum: SCALAR_TYPES,
      const: SCALAR_TYPES
    };
    for (const [key, types] of Object.entries(allowedFor)) {
      if (Object.hasOwn(node, key) && !types.includes(type)) {
        violations.push(`${path}.${key} is not supported on type "${type}"`);
      }
    }
    if (type === "object") {
      if (Object.hasOwn(node, "properties")) {
        const properties = node.properties;
        if (!isPlainRecord(properties))
          violations.push(`${path}.properties must be an object of schemas`);
        else
          for (const [key, child] of Object.entries(properties))
            visit(child, `${path}.properties.${key}`);
      }
      visitObjectTail(node, path);
    } else if (type === "array") {
      if (Object.hasOwn(node, "items"))
        visit(node.items, `${path}.items`);
    } else {
      const hasEnum = Object.hasOwn(node, "enum");
      const allowed = hasEnum ? node.enum : undefined;
      const enumValid = Array.isArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(type, entry));
      if (hasEnum && !enumValid)
        violations.push(`${path}.enum must be a non-empty array of ${type} values`);
      if (Object.hasOwn(node, "const")) {
        if (!scalarMatches(type, node.const))
          violations.push(`${path}.const must be a ${type} value`);
        else if (enumValid && !allowed.includes(node.const)) {
          violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
        }
      }
    }
    seen.delete(node);
  };
  visit(root, rootPath);
  return violations;
}
function schemaEqual(left, right) {
  if (left === right)
    return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
      return false;
    return left.every((entry, index) => schemaEqual(entry, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right))
    return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length)
    return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && schemaEqual(left[key], right[key]));
}
var MAX_PROJECTION_DEPTH = 32;
function note(projector, path, message6) {
  projector.notes.push(`${path}: ${message6}`);
}
function fail(projector, path, message6) {
  projector.unprojectable.push(`${path}: ${message6}`);
  return;
}
function projectNode(projector, node, path) {
  if (projector.depth > MAX_PROJECTION_DEPTH)
    return fail(projector, path, "nesting is too deep to project");
  if (node === true) {
    note(projector, path, "boolean schema `true` projected to the unconstrained schema `{}`");
    return {};
  }
  if (node === false)
    return fail(projector, path, "boolean schema `false` has no projection (nothing validates against it)");
  if (!isPlainRecord(node))
    return fail(projector, path, "a schema must be an object");
  const projected = {};
  const push = (key, value) => {
    projected[key] = value;
  };
  if (Object.hasOwn(node, "description")) {
    if (typeof node.description === "string")
      push("description", node.description);
    else
      note(projector, path, "dropped `description`: it is not a string");
  }
  if (Object.hasOwn(node, "title")) {
    if (typeof node.title === "string")
      push("title", node.title);
    else
      note(projector, path, "dropped `title`: it is not a string");
  }
  for (const key of ["default", "examples"]) {
    if (!Object.hasOwn(node, key))
      continue;
    if (isLosslessJson(node[key], new Set))
      push(key, node[key]);
    else
      note(projector, path, `dropped \`${key}\`: it is not lossless JSON data`);
  }
  for (const key of Object.keys(node)) {
    if (SCHEMA_CONSTRAINT_KEYWORDS.includes(key) || SCHEMA_ANNOTATION_KEYWORDS.includes(key))
      continue;
    note(projector, path, `dropped unsupported keyword \`${key}\``);
  }
  const hasOneOf = Object.hasOwn(node, "oneOf");
  let declaredType;
  if (Object.hasOwn(node, "type")) {
    const type = node.type;
    if (Array.isArray(type)) {
      const entries = type.filter((entry) => typeof entry === "string" && SCHEMA_TYPES.includes(entry));
      if (entries.length !== type.length)
        return fail(projector, path, "a type array contains an entry outside the subset");
      if (entries.length === 1) {
        declaredType = entries[0];
        note(projector, path, `type array [${entries.join(", ")}] projected to the single type "${declaredType}"`);
      } else if (entries.length === 2 && entries.includes("null")) {
        const [nonNull] = entries.filter((entry) => entry !== "null");
        if (nonNull === undefined)
          return fail(projector, path, "a type array of only `null` has no projection");
        const rest = { ...node, type: nonNull };
        delete rest.oneOf;
        const branch = projectNode(projector, rest, `${path}<${nonNull}>`);
        if (branch === undefined)
          return;
        note(projector, path, `type array [${entries.join(", ")}] projected to oneOf with a null branch`);
        return { ...projected, oneOf: [branch, { type: "null" }] };
      } else {
        return fail(projector, path, `type array [${entries.join(", ")}] cannot be projected onto a single type`);
      }
    } else if (typeof type === "string" && SCHEMA_TYPES.includes(type)) {
      declaredType = type;
    } else {
      note(projector, path, `dropped \`type\`: ${JSON.stringify(type)} is outside the subset`);
    }
  }
  if (hasOneOf) {
    const oneOf = node.oneOf;
    if (!Array.isArray(oneOf) || oneOf.length === 0)
      return fail(projector, path, "`oneOf` must be a non-empty array");
    projector.depth += 1;
    const branches = oneOf.map((branch, index) => projectNode(projector, branch, `${path}.oneOf[${index}]`));
    projector.depth -= 1;
    if (branches.some((branch) => branch === undefined))
      return;
    const siblings = {};
    for (const key of ONE_OF_SIBLING_KEYWORDS)
      if (Object.hasOwn(node, key))
        siblings[key] = node[key];
    let finalBranches = branches;
    if (Object.keys(siblings).length > 0) {
      const nested = finalBranches.map((branch, index) => {
        if (Object.hasOwn(branch, "oneOf")) {
          fail(projector, path, `oneOf branch ${index} itself declares oneOf and has a sibling constraint to merge`);
          return;
        }
        const merged = { ...branch, ...siblings };
        const violations = schemaViolations(merged);
        if (violations.length > 0) {
          fail(projector, path, `oneOf sibling constraints cannot be nested into branch ${index} (${violations[0]})`);
          return;
        }
        return merged;
      });
      if (nested.some((branch) => branch === undefined))
        return;
      finalBranches = nested;
      note(projector, path, `sibling constraint keyword(s) ${Object.keys(siblings).join("/")} nested into every oneOf branch`);
    }
    if (finalBranches.length === 1) {
      note(projector, path, "single-branch `oneOf` collapsed into that branch");
      return { ...projected, ...finalBranches[0] };
    }
    if (declaredType !== undefined) {
      finalBranches = finalBranches.map((branch) => Object.hasOwn(branch, "type") ? branch : { ...branch, type: declaredType });
      note(projector, path, `type "${declaredType}" moved onto every oneOf branch (type and oneOf cannot be siblings)`);
    }
    return { ...projected, oneOf: finalBranches };
  }
  if (declaredType === undefined) {
    if (Object.hasOwn(node, "properties") || Object.hasOwn(node, "additionalProperties"))
      declaredType = "object";
    else if (Object.hasOwn(node, "items"))
      declaredType = "array";
    else if (Object.hasOwn(node, "enum") && Array.isArray(node.enum) && node.enum.length > 0) {
      const candidate = SCALAR_TYPES.find((scalar) => node.enum.every((entry) => scalarMatches(scalar, entry)));
      if (candidate !== undefined)
        declaredType = candidate;
    } else if (Object.hasOwn(node, "const")) {
      declaredType = SCALAR_TYPES.find((scalar) => scalarMatches(scalar, node.const));
    } else if (Object.hasOwn(node, "required")) {
      return fail(projector, path, "`required` without `properties` cannot be projected");
    }
    if (declaredType !== undefined)
      note(projector, path, `inferred type "${declaredType}" from the declared children`);
  }
  if (declaredType === undefined) {
    const foreign = Object.keys(node).filter((key) => !SCHEMA_CONSTRAINT_KEYWORDS.includes(key) && !SCHEMA_ANNOTATION_KEYWORDS.includes(key));
    if (foreign.length > 0 || Object.keys(projected).length === 0)
      return {};
    return projected;
  }
  push("type", declaredType);
  if (declaredType === "object") {
    if (Object.hasOwn(node, "properties")) {
      const properties = node.properties;
      if (!isPlainRecord(properties))
        return fail(projector, path, "`properties` must be an object of schemas");
      projector.depth += 1;
      const kept = {};
      for (const [key, child] of Object.entries(properties)) {
        const branch = projectNode(projector, child, `${path}.properties.${key}`);
        if (branch === undefined) {
          projector.notes.push(`${path}.properties.${key}: property dropped (no projection)`);
          continue;
        }
        kept[key] = branch;
      }
      projector.depth -= 1;
      push("properties", kept);
    }
    if (Object.hasOwn(node, "required")) {
      const required = node.required;
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
        note(projector, path, "dropped `required`: it is not an array of strings");
      } else {
        const declared = isPlainRecord(projected.properties) ? projected.properties : {};
        const kept = required.filter((name) => Object.hasOwn(declared, name));
        if (kept.length !== required.length) {
          note(projector, path, `dropped required entr(ies) not present in the projected properties: ${required.filter((name) => !kept.includes(name)).join(", ")}`);
        }
        if (kept.length > 0)
          push("required", kept);
      }
    }
    if (Object.hasOwn(node, "additionalProperties")) {
      const value = node.additionalProperties;
      if (typeof value === "boolean")
        push("additionalProperties", value);
      else {
        push("additionalProperties", true);
        note(projector, path, "additionalProperties schema projected to `true` (only a boolean is supported)");
      }
    }
  } else if (declaredType === "array") {
    if (Object.hasOwn(node, "items")) {
      projector.depth += 1;
      const items = projectNode(projector, node.items, `${path}.items`);
      projector.depth -= 1;
      if (items === undefined)
        return fail(projector, path, "`items` cannot be projected");
      push("items", items);
    }
  } else {
    if (Object.hasOwn(node, "enum")) {
      const allowed = node.enum;
      if (Array.isArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(declaredType, entry))) {
        push("enum", allowed);
      } else {
        note(projector, path, `dropped \`enum\`: it is not a non-empty array of ${declaredType} values`);
      }
    }
    if (Object.hasOwn(node, "const")) {
      if (scalarMatches(declaredType, node.const) && (!Array.isArray(projected.enum) || projected.enum.includes(node.const))) {
        push("const", node.const);
      } else {
        note(projector, path, `dropped \`const\`: it is not a ${declaredType} value inside \`enum\``);
      }
    }
  }
  for (const key of ["items", "properties", "required", "additionalProperties", "enum", "const"]) {
    if (Object.hasOwn(node, key) && !Object.hasOwn(projected, key) && !projector.notes.some((line) => line.startsWith(`${path}: dropped \`${key}\``))) {
      const legal = key === "items" && declaredType === "array" || (key === "properties" || key === "required" || key === "additionalProperties") && declaredType === "object" || (key === "enum" || key === "const") && SCALAR_TYPES.includes(declaredType);
      if (!legal)
        note(projector, path, `dropped \`${key}\`: it is not supported on type "${declaredType}"`);
    }
  }
  return projected;
}
function objectRootedSchema(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, wrapped: false, rootType: typeof value, schema: {}, reason: "the schema is not an object" };
  }
  const schema = value;
  const declared = schema.type;
  const rootType = typeof declared === "string" ? declared : "unspecified";
  if (declared === "object" || declared === undefined && (Object.hasOwn(schema, "properties") || Object.hasOwn(schema, "required") || Object.hasOwn(schema, "additionalProperties") || schema.oneOf === undefined)) {
    return { ok: true, wrapped: false, rootType, schema };
  }
  return {
    ok: true,
    wrapped: true,
    rootType,
    schema: {
      type: "object",
      properties: { value: schema },
      required: ["value"],
      additionalProperties: false
    }
  };
}
function projectSchema(value) {
  const projector = { notes: [], unprojectable: [], depth: 0 };
  const schema = projectNode(projector, value, "schema");
  if (schema === undefined) {
    return { violations: projector.unprojectable, lossy: true, notes: projector.notes };
  }
  const violations = schemaViolations(schema);
  if (violations.length > 0) {
    return { violations, lossy: true, notes: projector.notes };
  }
  return { schema, violations: [], lossy: !schemaEqual(value, schema), notes: projector.notes };
}

// packages/mpd-ext-plugin/src/mcp.ts
function message6(error) {
  return error instanceof Error ? error.message : String(error);
}

class ToolGenerationConflict extends Error {
  constructor(text) {
    super(text);
    this.name = "ToolGenerationConflict";
  }
}
function pendingItem(index) {
  return `contributes.mcp[${index}]`;
}
function setPending(entry, index, reason) {
  const item = pendingItem(index);
  entry.pending = entry.pending.filter((line) => line.item !== item);
  if (reason !== undefined)
    entry.pending.push({ item, reason });
}
function addError(entry, item, reason) {
  if (entry.errors.some((line) => line.item === item && line.reason === reason))
    return;
  entry.errors.push({ item, reason });
}
function resolveTimeouts(item, config) {
  const connect = item.connectTimeoutMs === MPD_EXT_CONTRACT.defaultConnectTimeoutMs ? config.mcp.connectTimeoutMs : item.connectTimeoutMs;
  const call = item.toolCallTimeoutMs === MPD_EXT_CONTRACT.defaultToolCallTimeoutMs ? config.mcp.toolCallTimeoutMs : item.toolCallTimeoutMs;
  return { connect, call };
}
function renderResult(value) {
  const record = typeof value === "object" && value !== null ? value : {};
  const content = Array.isArray(record.content) ? record.content : [];
  const texts = content.filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text);
  if (texts.length > 0)
    return texts.join(`
`);
  const structured = record.structuredContent;
  if (structured !== undefined)
    return JSON.stringify(structured, null, 2);
  return content.length > 0 ? JSON.stringify(content) : "(no output)";
}

class ServerRuntime {
  extension;
  serverName;
  entry;
  index;
  item;
  dsh;
  warn;
  timeouts;
  cwd;
  client;
  disposers = new Map;
  state = "connecting";
  reason;
  chain = Promise.resolve();
  constructor(options) {
    this.entry = options.entry;
    this.extension = options.entry.id;
    this.serverName = options.item.serverName;
    this.index = options.index;
    this.item = options.item;
    this.dsh = options.dsh;
    this.warn = options.warn;
    this.timeouts = resolveTimeouts(options.item, options.config);
    this.cwd = options.entry.root === "" ? process.cwd() : resolve3(options.entry.root, options.item.cwd === "" ? "." : options.item.cwd);
    if (options.disabled === true)
      this.state = "disabled";
    this.record();
  }
  view() {
    const tools = [...this.disposers.keys()];
    const stderrTail = this.client?.stderrTail();
    return {
      extension: this.extension,
      serverName: this.serverName,
      state: this.state,
      tools,
      ...stderrTail !== undefined && stderrTail.length > 0 ? { stderrTail } : {},
      ...this.reason === undefined ? {} : { reason: this.reason }
    };
  }
  record() {
    const view = this.view();
    const record = {
      serverName: this.serverName,
      state: this.state,
      tools: view.tools,
      ...view.stderrTail === undefined ? {} : { stderrTail: view.stderrTail }
    };
    this.entry.mcp[this.index] = record;
    const label = `server "${this.serverName}"`;
    if (this.state === "connected")
      setPending(this.entry, this.index, undefined);
    else if (this.state === "connecting") {
      setPending(this.entry, this.index, `pending: ${label} is connecting (connectTimeoutMs=${this.timeouts.connect}, toolCallTimeoutMs=${this.timeouts.call})`);
    } else if (this.state === "disabled") {
      setPending(this.entry, this.index, `disabled: extensions.mcp.enabled=false — ${label} is not connected`);
    } else {
      setPending(this.entry, this.index, `pending: ${label} is not connected (${this.state}) — connectTimeoutMs=${this.timeouts.connect}, toolCallTimeoutMs=${this.timeouts.call}`);
    }
  }
  fail(state, error) {
    this.state = state;
    this.reason = message6(error);
    const tail = this.client?.stderrTail() ?? "";
    addError(this.entry, pendingItem(this.index), `server "${this.serverName}" ${state}: ${this.reason}${tail.length > 0 ? `; child stderr tail: ${tail}` : ""}`);
    this.warn(`extension "${this.extension}" mcp server "${this.serverName}" ${state}: ${this.reason}`);
    this.record();
  }
  async activate() {
    if (this.state === "disabled")
      return;
    const client = new McpStdioClient({
      serverName: this.serverName,
      command: this.item.command,
      args: [...this.item.args],
      env: { ...this.item.env },
      cwd: this.cwd
    }, {
      onNotification: (notification) => {
        if (notification.method !== "notifications/tools/list_changed")
          return;
        this.resync();
      },
      onExit: (info) => {
        if (this.state !== "connected")
          return;
        this.fail("failed", new Error(`the server process exited (code=${String(info.code)}, signal=${String(info.signal)})`));
      }
    });
    this.client = client;
    try {
      await client.start(this.timeouts.connect);
      await this.syncTools(this.timeouts.connect);
      this.state = "connected";
      this.reason = undefined;
      this.record();
    } catch (error) {
      await client.close().catch(() => {});
      this.fail(error instanceof ToolGenerationConflict ? "failed" : "unavailable", error);
    }
  }
  async syncTools(timeoutMs) {
    const client = this.client;
    if (client === undefined)
      throw new Error("the server is not started");
    const advertised = await client.listTools(timeoutMs);
    const next = new Map;
    const skipped = [];
    const notes = [];
    for (const tool of advertised) {
      const built = this.buildDefinition(client, tool, skipped, notes);
      if (built === undefined)
        continue;
      if (next.has(built.name)) {
        throw new Error(`server "${this.serverName}" listed tool "${tool.name}" more than once — invalid tool list`);
      }
      const ownedByThisGeneration = this.disposers.has(built.name);
      if (!ownedByThisGeneration && this.dsh.hasTool(built.name)) {
        skipped.push(`tool "${tool.name}" skipped: the public name "${built.name}" is already registered by another tool`);
        continue;
      }
      next.set(built.name, built);
    }
    for (const dispose of this.disposers.values())
      dispose();
    this.disposers = new Map;
    try {
      for (const [publicName, definition] of next) {
        this.disposers.set(publicName, this.dsh.registerTool(definition));
      }
    } catch (error) {
      for (const dispose of this.disposers.values())
        dispose();
      this.disposers = new Map;
      throw new ToolGenerationConflict(`tool registration failed, no tools registered from "${this.serverName}": ${message6(error)}`);
    }
    for (const line of skipped)
      addError(this.entry, pendingItem(this.index), line);
    for (const line of notes)
      addError(this.entry, pendingItem(this.index), line);
    this.warn(`extension "${this.extension}" mcp server "${this.serverName}": ${this.disposers.size} tool(s) published` + (skipped.length > 0 ? `, ${skipped.length} skipped` : "") + (notes.length > 0 ? `, ${notes.length} downgraded` : ""));
    this.record();
  }
  buildDefinition(client, tool, skipped, notes) {
    const publicName = publicToolName(this.serverName, tool.name);
    let parameters = {};
    if (tool.inputSchema !== undefined) {
      const projection = projectSchema(tool.inputSchema);
      if (projection.schema === undefined) {
        skipped.push(`tool "${tool.name}" skipped: its inputSchema cannot be projected onto the harness subset (${projection.violations.join("; ")})`);
        return;
      }
      const rooted = objectRootedSchema(projection.schema);
      if (!rooted.ok) {
        skipped.push(`tool "${tool.name}" skipped: its inputSchema has no object root and cannot be normalized (${rooted.reason})`);
        return;
      }
      const rootedViolations = schemaViolations(rooted.schema);
      if (rootedViolations.length > 0) {
        skipped.push(`tool "${tool.name}" skipped: normalizing its inputSchema root produced a schema outside the harness subset (${rootedViolations.join("; ")})`);
        return;
      }
      if (rooted.wrapped) {
        notes.push(`tool "${tool.name}": the server advertises a non-object inputSchema root ("${rooted.rootType}"); every harness tool call carries an ARGUMENTS OBJECT,` + ` so the payload is projected under the single property "value" — the server should declare an object root`);
      }
      parameters = rooted.schema;
    }
    let structuredSchema;
    if (tool.outputSchema !== undefined) {
      const projection = projectSchema(tool.outputSchema);
      if (projection.schema === undefined) {
        notes.push(`tool "${tool.name}": its outputSchema is outside the harness subset (${projection.violations.join("; ")})` + ` — the tool is registered WITHOUT structuredContent (the schema is dropped, never rewritten)`);
      } else if (projection.lossy) {
        notes.push(`tool "${tool.name}": its outputSchema would have to be rewritten for the harness subset (${projection.notes.join("; ")})` + ` — the tool is registered WITHOUT structuredContent (the schema is dropped, never rewritten)`);
      } else {
        structuredSchema = projection.schema;
      }
    }
    const outputSchema = {
      type: "object",
      properties: {
        content: { type: "array", items: {} },
        ...structuredSchema === undefined ? {} : { structuredContent: structuredSchema }
      },
      required: structuredSchema === undefined ? ["content"] : ["content", "structuredContent"],
      additionalProperties: false
    };
    const violations = schemaViolations(outputSchema);
    if (violations.length > 0) {
      skipped.push(`tool "${tool.name}" skipped: the bridge's own output schema is invalid (${violations.join("; ")})`);
      return;
    }
    return {
      name: publicName,
      description: typeof tool.description === "string" && tool.description.length > 0 ? tool.description : `MCP tool "${tool.name}" from server "${this.serverName}" (extension "${this.extension}")`,
      parameters,
      output: {
        schema: outputSchema,
        render: (_args, value) => [{ type: "text", text: renderResult(value) }]
      },
      timeoutMs: this.timeouts.call,
      execute: async (args, exec) => {
        const callArgs = typeof args === "object" && args !== null ? args : {};
        return await this.call(client, tool.name, callArgs, exec ?? {}, structuredSchema !== undefined);
      }
    };
  }
  async call(client, rawName, args, exec, hasStructured) {
    if (!client.alive) {
      throw new Error(`mcp server "${this.serverName}" is not running (state=${this.state}${this.reason === undefined ? "" : `: ${this.reason}`})`);
    }
    let result;
    try {
      result = await client.callTool(rawName, args, { timeoutMs: this.timeouts.call, signal: exec.signal });
    } catch (error) {
      if (!client.alive && this.state === "connected")
        this.fail("failed", error);
      throw error;
    }
    if (result.isError === true) {
      throw new Error(renderResult({ content: result.content, structuredContent: result.structuredContent }));
    }
    const content = Array.isArray(result.content) ? result.content : undefined;
    const blocks = content ?? [{ type: "text", text: renderResult(result) }];
    return {
      content: blocks,
      ...hasStructured && result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}
    };
  }
  resync() {
    this.chain = this.chain.then(async () => {
      if (this.client === undefined || !this.client.alive)
        return;
      try {
        await this.syncTools(this.timeouts.connect);
        this.state = "connected";
        this.reason = undefined;
        this.record();
      } catch (error) {
        if (error instanceof ToolGenerationConflict) {
          this.fail("failed", error);
          return;
        }
        addError(this.entry, pendingItem(this.index), `server "${this.serverName}" tool re-sync failed: ${message6(error)}`);
        this.warn(`extension "${this.extension}" mcp server "${this.serverName}" tool re-sync failed: ${message6(error)}`);
      }
    });
    return this.chain;
  }
  async dispose() {
    for (const dispose of this.disposers.values())
      dispose();
    this.disposers = new Map;
    this.record();
    const client = this.client;
    this.client = undefined;
    if (client !== undefined)
      await client.close().catch(() => {});
  }
}
function runtimesForEntry(entry, options, config) {
  const runtimes = [];
  const items = entry.descriptor.contributes.mcp;
  if (items.length === 0 || items.length !== entry.contributions.mcp)
    return runtimes;
  for (const [index, item] of items.entries()) {
    if (entry.root === "") {
      entry.mcp[index] = { serverName: item.serverName, state: "unavailable", tools: [] };
      setPending(entry, index, `pending: an extension root is required to start server "${item.serverName}" (pass { root } to register())`);
      addError(entry, pendingItem(index), `server "${item.serverName}" was not started: the extension has no root`);
      continue;
    }
    if (!effectiveEnabled(entry, config) || !config.mcp.enabled) {
      runtimes.push(new ServerRuntime({ entry, index, item, dsh: options.dsh, config, warn: options.warn, disabled: true }));
      continue;
    }
    runtimes.push(new ServerRuntime({ entry, index, item, dsh: options.dsh, config, warn: options.warn }));
  }
  return runtimes;
}
async function connectExtensionMcpServers(options) {
  const config = options.config();
  const runtimes = options.entries.flatMap((entry) => runtimesForEntry(entry, options, config));
  await Promise.all(runtimes.map((runtime) => runtime.activate()));
  let disposed = false;
  return {
    view: () => runtimes.map((runtime) => runtime.view()),
    resync: async (serverName) => {
      const runtime = runtimes.find((candidate) => candidate.serverName === serverName);
      if (runtime === undefined)
        throw new Error(`unknown mcp server "${serverName}"`);
      await runtime.resync();
    },
    adopt: async (entry) => {
      if (disposed)
        return;
      const adopted = runtimesForEntry(entry, options, options.config());
      runtimes.push(...adopted);
      await Promise.all(adopted.map((runtime) => runtime.activate()));
    },
    dispose: async () => {
      if (disposed)
        return;
      disposed = true;
      await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    }
  };
}

// packages/mpd-ext-plugin/src/index.ts
var name = "mpd-ext";
var REQUIRED_SEAMS = ["tools", "skills"];
var inject = [...REQUIRED_SEAMS];
var ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { item: { type: "string" }, reason: { type: "string" } },
  required: ["item", "reason"]
};
var SHADOW_PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { plane: { type: "string" }, root: { type: "string" } },
  required: ["plane", "root"]
};
var SHADOW_RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { id: { type: "string" }, kept: SHADOW_PAIR_SCHEMA, shadowed: SHADOW_PAIR_SCHEMA },
  required: ["id", "kept", "shadowed"]
};
var STRING_ARRAY_SCHEMA = { type: "array", items: { type: "string" } };
function message7(error) {
  return error instanceof Error ? error.message : String(error);
}
function text(content) {
  return [{ type: "text", text: content }];
}
function cwdOf(options) {
  const cwd = options?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
}
function toView(entry, config) {
  const pending = entry.pending.map((error) => ({ ...error }));
  if (!config.mcp.enabled && entry.descriptor.contributes.mcp.length > 0) {
    pending.push({
      item: "contributes.mcp",
      reason: `mcp contributions are disabled by config (extensions.mcp.enabled=false) — every declared server of "${entry.id}" stays disconnected`
    });
  }
  return {
    id: entry.id,
    origin: entry.origin,
    plane: entry.plane,
    root: entry.root,
    source: entry.source,
    enabled: effectiveEnabled(entry, config),
    descriptor: entry.descriptor,
    providerName: entry.providerName,
    contributions: { ...entry.contributions },
    errors: entry.errors.map((error) => ({ ...error })),
    pending,
    resolvedRoots: {
      root: entry.resolvedRoots.root,
      skills: [...entry.resolvedRoots.skills],
      flows: [...entry.resolvedRoots.flows],
      roles: [...entry.resolvedRoots.roles]
    },
    skills: [...entry.skills],
    flows: [...entry.flows],
    roles: [...entry.roles],
    mcp: entry.mcp.map((record) => ({ ...record, tools: [...record.tools] })),
    flowDocs: entry.flowDocs,
    flowEntries: entry.flowEntries
  };
}
async function apply(ctx, config = {}) {
  try {
    await mount(ctx, config);
  } catch (error) {
    const line = "[mpd-ext] apply failed: " + message7(error);
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(line);
      else
        console.log(line);
    } catch {}
  }
}
async function mount(ctx, config = {}) {
  const warn = (line) => {
    const text2 = "[mpd-ext] " + line;
    try {
      console.log(text2);
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(text2);
    } catch {}
  };
  let dsh;
  try {
    dsh = createLazyDshAdapter(ctx, { label: "mpd-ext", warn });
  } catch (error) {
    warn("adapter unavailable, extension interface not mounted: " + message7(error));
    return;
  }
  const seams = (() => {
    try {
      return dsh.capabilities();
    } catch {
      return;
    }
  })();
  if (seams !== undefined && (seams.toolsRegister !== true || seams.skillsProvider !== true)) {
    warn("FATAL: the harness seams this row registers through are unavailable" + " (toolsRegister=" + String(seams.toolsRegister) + ", skillsProvider=" + String(seams.skillsProvider) + ")" + " — the four tools and the skills provider will NOT be registered in this session." + " This row must declare inject: " + JSON.stringify([...REQUIRED_SEAMS]) + ".");
  }
  const registry = new MpdExtensionRegistry;
  const takenProviderNames = new Set;
  const projectProviderName = allocateProviderName(takenProviderNames, "mpd-ext:project-plane");
  const registeredProviderNames = [];
  const registerEntryProvider = (entry) => {
    if (entry.skillEntries.length === 0 && entry.flowEntries.length === 0)
      return true;
    try {
      const provider = createSkillProvider({
        name: entry.providerName,
        warn,
        onSkip: (reason) => {
          if (entry.errors.some((error) => error.item === "contributes.skills" && error.reason === reason))
            return;
          entry.errors.push({ item: "contributes.skills", reason });
        },
        entries: (listOptions) => {
          if (!effectiveEnabled(entry, extensionConfig(ctx)))
            return [];
          const root = cwdOf(listOptions);
          if (root !== undefined && projectExtensionIds(root).has(entry.id))
            return [];
          return [...entry.skillEntries, ...entry.flowEntries];
        }
      });
      dsh.registerSkillProvider(() => provider);
      registeredProviderNames.push(entry.providerName);
      return true;
    } catch (error) {
      entry.errors.push({ item: "contributes.skills", reason: "skill provider registration failed: " + message7(error) });
      warn(`skill provider for "${entry.id}" not registered: ` + message7(error));
      return false;
    }
  };
  const planes = [
    ["user", userExtensionsDir()],
    ["bundle", bundleExtensionsDir()]
  ];
  const keptEntries = [];
  for (const [plane, dir] of planes) {
    try {
      const discovery = discoverPlane({ plane, dir, providerNameFor: (id) => allocateProviderName(takenProviderNames, "mpd-ext:" + id), warn });
      for (const entry of discovery.entries) {
        const added = registry.add(entry);
        if (added.ok) {
          registerEntryProvider(entry);
          keptEntries.push(entry);
        }
      }
      for (const rejected of discovery.rejected)
        registry.addRejected(rejected);
    } catch (error) {
      warn(`plane "${plane}" discovery failed: ` + message7(error));
    }
  }
  let projectClaimDir;
  const projectSkillSkips = new Map;
  const PROJECT_SKIP_MAX = 128;
  const recordProjectSkip = (dir, name2, reason) => {
    if (projectSkillSkips.size >= PROJECT_SKIP_MAX)
      projectSkillSkips.clear();
    projectSkillSkips.set(`${dir}\x00${name2 ?? "*"}`, reason);
  };
  try {
    const projectProvider = createSkillProvider({
      name: projectProviderName,
      warn,
      onSkip: (reason, name2) => {
        const dir = projectClaimDir;
        if (dir !== undefined)
          recordProjectSkip(dir, name2, reason);
      },
      entries: (listOptions) => {
        const root = cwdOf(listOptions);
        projectClaimDir = root === undefined ? undefined : projectExtensionsDir(root);
        if (root === undefined)
          return [];
        const discovery = discoverPlane({
          plane: "project",
          dir: projectExtensionsDir(root),
          providerNameFor: () => projectProviderName,
          warn
        });
        const current = extensionConfig(ctx);
        const documents = [];
        for (const entry of discovery.entries) {
          if (!effectiveEnabled(entry, current))
            continue;
          documents.push(...entry.skillEntries, ...entry.flowEntries);
        }
        return documents;
      }
    });
    dsh.registerSkillProvider(() => projectProvider);
    registeredProviderNames.push(projectProviderName);
  } catch (error) {
    warn("project-plane skill provider not registered: " + message7(error));
  }
  const snapshot = (exec) => {
    const root = dsh.workspaceRoot(exec);
    const dir = projectExtensionsDir(root);
    let discovery = { plane: "project", dir, entries: [], rejected: [], done: true };
    try {
      discovery = discoverPlane({
        plane: "project",
        dir,
        providerNameFor: () => projectProviderName,
        warn
      });
    } catch (error) {
      warn("project-plane discovery failed: " + message7(error));
    }
    const current = extensionConfig(ctx);
    for (const entry of discovery.entries) {
      for (const document of [...entry.skillEntries, ...entry.flowEntries]) {
        const reason = projectSkillSkips.get(`${dir}\x00${document.document.name}`) ?? projectSkillSkips.get(`${dir}\x00*`);
        if (reason === undefined)
          continue;
        if (entry.errors.some((error) => error.reason === reason))
          continue;
        entry.errors.push({ item: "contributes.skills", reason });
      }
    }
    const merged = registry.view(discovery, { isEnabled: (entry) => effectiveEnabled(entry, current) });
    const extensions = merged.entries.map((entry) => toView(entry, current));
    const warnings = [];
    for (const record of merged.shadowed) {
      warnings.push(`extension "${record.id}" in the ${record.shadowed.plane} plane is shadowed by the ${record.kept.plane} plane (first wins)`);
    }
    for (const rejected of merged.rejected) {
      warnings.push(`extension "${rejected.id}" in the ${rejected.plane} plane was rejected: ${rejected.errors.map((error) => error.reason).join("; ")}`);
    }
    for (const view of extensions) {
      for (const pending of view.pending)
        warnings.push(`${view.id}: ${pending.reason}`);
    }
    return { extensions, shadowed: merged.shadowed, rejected: merged.rejected, warnings, config: current };
  };
  let bridge;
  const register = (descriptor, options = {}) => {
    const root = typeof options?.root === "string" && options.root.length > 0 ? options.root : "";
    const plane = options?.plane === "project" || options?.plane === "user" || options?.plane === "bundle" ? options.plane : "bundle";
    const declared = descriptor?.id;
    const id = typeof declared === "string" && declared.length > 0 ? declared : "unnamed";
    try {
      const built = buildExtension({
        input: descriptor,
        plane,
        origin: "plugin",
        root,
        source: "register()",
        fallbackId: id,
        providerName: allocateProviderName(takenProviderNames, "mpd-ext:" + id)
      });
      if (built.rejected !== undefined) {
        registry.addRejected(built.rejected);
        return { ok: false, id: built.rejected.id, errors: built.rejected.errors };
      }
      const entry = built.entry;
      const added = registry.add(entry);
      if (added.ok) {
        registerEntryProvider(entry);
        bridge?.adopt(entry);
      }
      return { ok: added.ok, id: entry.id, errors: entry.errors, ...added.shadowed === undefined ? {} : { shadowed: added.shadowed } };
    } catch (error) {
      const errors = [{ item: "descriptor", reason: "registration failed: " + message7(error) }];
      registry.addRejected({ id, plane, origin: "plugin", root, source: "register()", errors });
      return { ok: false, id, errors };
    }
  };
  const service = {
    apiVersion: MPD_EXT_API_VERSION,
    adapterIdentity: dshAdapterIdentity(ctx),
    register,
    list: (options = {}) => snapshot(options?.exec),
    describe: (id, options = {}) => snapshot(options?.exec).extensions.find((entry) => entry.id === String(id ?? "")),
    flows: (options = {}) => snapshot(options?.exec).extensions.flatMap((entry) => entry.flowDocs.map((flow) => ({ extension: entry.id, enabled: entry.enabled, flow }))),
    flow: (id, options = {}) => {
      const wanted = String(id ?? "");
      for (const entry of snapshot(options?.exec).extensions) {
        const flow = entry.flowDocs.find((candidate) => candidate.id === wanted);
        if (flow !== undefined)
          return { extension: entry.id, enabled: entry.enabled, flow };
      }
      return;
    }
  };
  try {
    ctx.provide("mpdExtensions", service);
  } catch (error) {
    warn("ctx.provide(mpdExtensions) failed: " + message7(error));
  }
  const registeredToolNames = [];
  const safeRegisterTool = (definition, onError) => {
    try {
      dsh.registerTool(definition);
      registeredToolNames.push(definition.name);
      return true;
    } catch (error) {
      onError(`tool "${definition?.name}" not registered: ` + message7(error));
      return false;
    }
  };
  const EXPECTED_TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"];
  const shadowsFor = (view, entry) => view.shadowed.filter((record) => record.kept.plane === entry.plane && record.kept.root === entry.root);
  const skillCatalog = async (exec) => {
    try {
      const root = dsh.workspaceRoot(exec);
      const summaries = await dsh.listSkills({ cwd: root });
      const holders = new Map;
      for (const summary of summaries) {
        const name2 = summary?.name;
        if (typeof name2 !== "string" || holders.has(name2))
          continue;
        holders.set(name2, {
          provider: typeof summary.provider === "string" ? summary.provider : "",
          source: typeof summary.source === "string" ? summary.source : ""
        });
      }
      return { checked: true, reason: "", holders };
    } catch (error) {
      return { checked: false, reason: message7(error), holders: new Map };
    }
  };
  const skillServingFor = (entry, catalog) => {
    const claimed = [...entry.skills, ...entry.flows];
    const served = [];
    const notServed = [];
    const detail = [];
    for (const name2 of claimed) {
      const holder = catalog.holders.get(name2);
      if (!catalog.checked) {
        detail.push({ name: name2, served: false, provider: "", source: "", note: `not verified: the harness catalog could not be read (${catalog.reason})` });
        continue;
      }
      const mine = holder !== undefined && holder.provider === entry.providerName && holder.source === entry.source;
      if (mine) {
        served.push(name2);
        detail.push({ name: name2, served: true, provider: holder.provider, source: holder.source, note: "" });
        continue;
      }
      notServed.push(name2);
      detail.push({
        name: name2,
        served: false,
        provider: holder?.provider ?? "",
        source: holder?.source ?? "",
        note: holder === undefined ? "not in the current catalog (the name may lose to another provider, or the extension may be disabled)" : holder.provider === entry.providerName ? `served by another extension under the same provider "${entry.providerName}" (source ${holder.source})` : `served by provider "${holder.provider}" instead of "${entry.providerName}"`
      });
    }
    return { checked: catalog.checked, reason: catalog.reason, served, notServed, detail };
  };
  const SKILL_SERVING_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      checked: { type: "boolean", description: "true when the harness skill catalog was readable; false means the claims below are NOT verified" },
      reason: { type: "string" },
      served: STRING_ARRAY_SCHEMA,
      notServed: STRING_ARRAY_SCHEMA,
      detail: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, served: { type: "boolean" }, provider: { type: "string" }, source: { type: "string" }, note: { type: "string" } },
          required: ["name", "served", "provider", "source", "note"]
        }
      }
    },
    required: ["checked", "reason", "served", "notServed", "detail"]
  };
  const redactedDescriptor = (entry) => {
    const descriptor = entry.descriptor;
    const servers = descriptor?.contributes?.mcp;
    if (!Array.isArray(servers) || servers.length === 0)
      return entry.descriptor;
    return {
      ...entry.descriptor,
      contributes: {
        ...descriptor?.contributes,
        mcp: servers.map((server) => {
          const record = server;
          const env = record.env;
          if (env === undefined || env === null || typeof env !== "object")
            return record;
          const keys = Object.keys(env);
          return { ...record, env: Object.fromEntries(keys.map((key) => [key, "<redacted>"])) };
        })
      }
    };
  };
  const listValue = (view, catalog) => ({
    extensions: view.extensions.map((entry) => ({
      id: entry.id,
      origin: entry.origin,
      plane: entry.plane,
      root: entry.root,
      enabled: entry.enabled,
      contributions: { ...entry.contributions },
      skills: [...entry.skills],
      flows: [...entry.flows],
      roles: [...entry.roles],
      skillServing: skillServingFor(entry, catalog),
      errors: entry.errors.map((error) => ({ item: error.item, reason: error.reason })),
      pending: entry.pending.map((error) => ({ item: error.item, reason: error.reason })),
      shadows: shadowsFor(view, entry).map((record) => ({ plane: record.shadowed.plane, root: record.shadowed.root }))
    })),
    shadowed: view.shadowed.map((record) => ({
      id: record.id,
      kept: { plane: record.kept.plane, root: record.kept.root },
      shadowed: { plane: record.shadowed.plane, root: record.shadowed.root }
    })),
    rejected: view.rejected.map((record) => ({
      id: record.id,
      plane: record.plane,
      root: record.root,
      source: record.source,
      errors: record.errors.map((error) => ({ item: error.item, reason: error.reason }))
    })),
    warnings: [...view.warnings]
  });
  safeRegisterTool({
    name: "mpd_ext_list",
    description: "List every MPD extension known to this host: its id, origin (plugin code or discovered directory), plane (project user bundle), root, effective enabled state, contribution counts, per-item load errors and pending kinds. Also reports shadowed duplicate ids (first wins, never fatal) and extensions rejected outright. There is no reload tool in v1: restart dsh to re-read plugin code.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          extensions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                origin: { type: "string" },
                plane: { type: "string" },
                root: { type: "string" },
                enabled: { type: "boolean" },
                contributions: {
                  type: "object",
                  additionalProperties: false,
                  properties: { skills: { type: "number" }, flows: { type: "number" }, mcp: { type: "number" }, roles: { type: "number" } },
                  required: ["skills", "flows", "mcp", "roles"]
                },
                skills: STRING_ARRAY_SCHEMA,
                flows: STRING_ARRAY_SCHEMA,
                roles: STRING_ARRAY_SCHEMA,
                skillServing: SKILL_SERVING_SCHEMA,
                errors: { type: "array", items: ERROR_SCHEMA },
                pending: { type: "array", items: ERROR_SCHEMA },
                shadows: { type: "array", items: SHADOW_PAIR_SCHEMA }
              },
              required: ["id", "origin", "plane", "root", "enabled", "contributions", "skills", "flows", "roles", "skillServing", "errors", "pending", "shadows"]
            }
          },
          shadowed: { type: "array", items: SHADOW_RECORD_SCHEMA },
          rejected: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                plane: { type: "string" },
                root: { type: "string" },
                source: { type: "string" },
                errors: { type: "array", items: ERROR_SCHEMA }
              },
              required: ["id", "plane", "root", "source", "errors"]
            }
          },
          warnings: { type: "array", items: { type: "string" } }
        },
        required: ["extensions", "shadowed", "rejected", "warnings"]
      },
      render: (_args, value) => {
        const lines = [
          `mpd extensions: ${value.extensions.length} (${value.shadowed.length} shadowed, ${value.rejected.length} rejected)`
        ];
        for (const entry of value.extensions) {
          lines.push(`- ${entry.id} [${entry.plane}/${entry.origin}] ${entry.enabled ? "enabled" : "disabled"}` + ` skills=${entry.contributions.skills} flows=${entry.contributions.flows} mcp=${entry.contributions.mcp} roles=${entry.contributions.roles}` + (entry.roles.length > 0 ? ` (roles: ${entry.roles.join(", ")})` : ""));
          if (entry.skillServing.checked !== true) {
            lines.push(`    skill serving UNVERIFIED: ${entry.skillServing.reason}`);
          } else if (entry.skillServing.notServed.length > 0) {
            lines.push(`    not served: ${entry.skillServing.notServed.join(", ")}`);
          }
          for (const error of entry.errors)
            lines.push(`    error ${error.item}: ${error.reason}`);
          for (const pending of entry.pending)
            lines.push(`    pending ${pending.item}: ${pending.reason}`);
          if (entry.shadows.length > 0)
            lines.push(`    shadows ${entry.shadows.map((shadow) => shadow.plane).join(", ")}`);
        }
        for (const rejected of value.rejected)
          lines.push(`! rejected ${rejected.id} (${rejected.plane}): ${rejected.errors.map((error) => error.reason).join("; ")}`);
        return text(lines.join(`
`));
      }
    },
    execute: async (_args, exec) => {
      const catalog = await skillCatalog(exec);
      return listValue(snapshot(exec), catalog);
    }
  }, warn);
  safeRegisterTool({
    name: "mpd_ext_show",
    description: "Show one MPD extension in full: descriptor, resolved asset roots, contributed skill/flow/role names, MCP server state and per-item errors. An unknown id reports the known ids.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "extension id (see mpd_ext_list)" } },
      required: ["id"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          origin: { type: "string" },
          plane: { type: "string" },
          root: { type: "string" },
          source: { type: "string" },
          enabled: { type: "boolean" },
          descriptor: { type: "object" },
          resolvedRoots: {
            type: "object",
            additionalProperties: false,
            properties: {
              root: { type: "string" },
              skills: STRING_ARRAY_SCHEMA,
              flows: STRING_ARRAY_SCHEMA,
              roles: STRING_ARRAY_SCHEMA
            },
            required: ["root", "skills", "flows", "roles"]
          },
          skills: STRING_ARRAY_SCHEMA,
          flows: STRING_ARRAY_SCHEMA,
          roles: STRING_ARRAY_SCHEMA,
          skillServing: SKILL_SERVING_SCHEMA,
          mcp: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                serverName: { type: "string" },
                state: { type: "string" },
                tools: STRING_ARRAY_SCHEMA,
                stderrTail: { type: "string" }
              },
              required: ["serverName", "state", "tools"]
            }
          },
          errors: { type: "array", items: ERROR_SCHEMA },
          pending: { type: "array", items: ERROR_SCHEMA },
          shadows: { type: "array", items: SHADOW_PAIR_SCHEMA }
        },
        required: ["id", "origin", "plane", "root", "source", "enabled", "descriptor", "resolvedRoots", "skills", "flows", "roles", "skillServing", "mcp", "errors", "pending", "shadows"]
      },
      render: (_args, value) => {
        const lines = [
          `extension ${value.id} [${value.plane}/${value.origin}] ${value.enabled ? "enabled" : "disabled"}`,
          `root: ${value.root || "(none)"}`,
          `source: ${value.source}`,
          `skills: ${value.skills.length > 0 ? value.skills.join(", ") : "(none)"}`,
          `flows: ${value.flows.length > 0 ? value.flows.join(", ") : "(none)"}`,
          `roles: ${value.roles.length > 0 ? value.roles.join(", ") : "(none)"}`,
          `mcp: ${value.mcp.length > 0 ? value.mcp.map((server) => `${server.serverName}=${server.state}`).join(", ") : "(none)"}`
        ];
        if (value.skillServing.checked !== true) {
          lines.push(`skill serving UNVERIFIED: ${value.skillServing.reason}`);
        } else {
          lines.push(`served skills: ${value.skillServing.served.length > 0 ? value.skillServing.served.join(", ") : "(none)"}`);
          for (const detail of value.skillServing.detail) {
            if (detail.served === true)
              continue;
            lines.push(`not served: ${detail.name} — ${detail.note}`);
          }
        }
        for (const error of value.errors)
          lines.push(`error ${error.item}: ${error.reason}`);
        for (const pending of value.pending)
          lines.push(`pending ${pending.item}: ${pending.reason}`);
        return text(lines.join(`
`));
      }
    },
    execute: async (args, exec) => {
      const view = snapshot(exec);
      const id = String(args?.id ?? "");
      const entry = view.extensions.find((candidate) => candidate.id === id);
      if (entry === undefined) {
        const known = view.extensions.map((candidate) => candidate.id).sort().join(", ") || "(none)";
        throw new Error(`mpd_ext_show: unknown extension "${id}"; known ids: ${known}`);
      }
      return {
        id: entry.id,
        origin: entry.origin,
        plane: entry.plane,
        root: entry.root,
        source: entry.source,
        enabled: entry.enabled,
        descriptor: redactedDescriptor(entry),
        resolvedRoots: {
          root: entry.resolvedRoots.root,
          skills: [...entry.resolvedRoots.skills],
          flows: [...entry.resolvedRoots.flows],
          roles: [...entry.resolvedRoots.roles]
        },
        skills: [...entry.skills],
        flows: [...entry.flows],
        roles: [...entry.roles],
        skillServing: skillServingFor(entry, await skillCatalog(exec)),
        mcp: entry.mcp.map((server) => ({
          serverName: server.serverName,
          state: server.state,
          tools: [...server.tools],
          ...server.stderrTail === undefined || server.stderrTail.length === 0 ? {} : { stderrTail: server.stderrTail }
        })),
        errors: entry.errors.map((error) => ({ item: error.item, reason: error.reason })),
        pending: entry.pending.map((error) => ({ item: error.item, reason: error.reason })),
        shadows: shadowsFor(view, entry).map((record) => ({ plane: record.shadowed.plane, root: record.shadowed.root }))
      };
    }
  }, warn);
  safeRegisterTool({
    name: "mpd_flow_list",
    description: "List every flow contributed by an enabled MPD extension (its id, title, whenToUse, step count and owning extension). A flow is a declarative procedure served as a skill candidate; v1 has no execution state machine.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          flows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                whenToUse: { type: "string" },
                stepCount: { type: "number" },
                extension: { type: "string" },
                loadable: { type: "boolean" }
              },
              required: ["id", "title", "whenToUse", "stepCount", "extension", "loadable"]
            }
          }
        },
        required: ["flows"]
      },
      render: (_args, value) => text(value.flows.length === 0 ? "no extension flows" : value.flows.map((flow) => `- ${flow.id} (${flow.extension}) ${flow.stepCount} steps${flow.loadable ? "" : " [not loadable]"}: ${flow.title}`).join(`
`))
    },
    execute: async (_args, exec) => {
      const view = snapshot(exec);
      const flows = [];
      for (const entry of view.extensions) {
        if (!entry.enabled)
          continue;
        for (const flow of entry.flowDocs) {
          flows.push({
            id: flow.id,
            title: flow.title,
            whenToUse: flow.whenToUse ?? "",
            stepCount: flow.steps.length,
            extension: entry.id,
            loadable: entry.flowEntries.some((candidate) => candidate.document.name === flow.id)
          });
        }
      }
      return { flows };
    }
  }, warn);
  safeRegisterTool({
    name: "mpd_flow_show",
    description: "Show one contributed flow in full: its description, whenToUse hint and every step with its optional tool hint and expected output. An unknown id reports the known ids.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "flow id (see mpd_flow_list)" } },
      required: ["id"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          whenToUse: { type: "string" },
          extension: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                tool: { type: "string" },
                output: { type: "string" }
              },
              required: ["title", "detail", "tool", "output"]
            }
          }
        },
        required: ["id", "title", "description", "whenToUse", "extension", "steps"]
      },
      render: (_args, value) => text([
        `${value.title} (${value.id}, extension ${value.extension})`,
        value.description,
        ...value.whenToUse ? [`when to use: ${value.whenToUse}`] : [],
        ...value.steps.map((step, index) => `${index + 1}. ${step.title}${step.tool ? ` [tool: ${step.tool}]` : ""}${step.detail ? `
   ${step.detail}` : ""}${step.output ? `
   expected output: ${step.output}` : ""}`)
      ].join(`
`))
    },
    execute: async (args, exec) => {
      const view = snapshot(exec);
      const wanted = String(args?.id ?? "");
      for (const entry of view.extensions) {
        const flow = entry.flowDocs.find((candidate) => candidate.id === wanted);
        if (flow === undefined)
          continue;
        return {
          id: flow.id,
          title: flow.title,
          description: flow.description,
          whenToUse: flow.whenToUse ?? "",
          extension: entry.id,
          steps: flow.steps.map((step) => ({
            title: step.title,
            detail: step.detail ?? "",
            tool: step.tool ?? "",
            output: step.output ?? ""
          }))
        };
      }
      const known = view.extensions.flatMap((entry) => entry.flowDocs.map((flow) => flow.id)).sort().join(", ") || "(none)";
      throw new Error(`mpd_flow_show: unknown flow "${wanted}"; known ids: ${known}`);
    }
  }, warn);
  try {
    bridge = await connectExtensionMcpServers({
      dsh,
      entries: keptEntries,
      config: () => extensionConfig(ctx),
      warn
    });
    const connected = bridge;
    if (typeof ctx?.effect === "function") {
      ctx.effect(() => () => {
        connected.dispose();
      }, "mpd-ext.mcp-bridge");
    }
  } catch (error) {
    warn("MCP bridge activation failed: " + message7(error));
  }
  const missingTools = EXPECTED_TOOLS.filter((name2) => !registeredToolNames.includes(name2));
  if (missingTools.length > 0) {
    warn("FATAL: only " + registeredToolNames.length + "/" + EXPECTED_TOOLS.length + " tools registered (missing: " + missingTools.join(", ") + ") — the extension interface is NOT usable in this session;" + " the row declares inject: " + JSON.stringify([...REQUIRED_SEAMS]) + ", so check the harness seams above");
  } else if (config.quiet !== true) {
    console.log("[mpd-ext] mpdExtensions provided (apiVersion " + MPD_EXT_API_VERSION + ")" + " | adapterIdentity=" + dshAdapterIdentity(ctx) + " | tools: " + registeredToolNames.join(", ") + " | skill providers: " + (registeredProviderNames.length === 0 ? "(none: no extension contributes skills or flows)" : registeredProviderNames.join(", ")) + " | project plane: <session workspace>/.mpd/extensions (per call)");
  }
}
export {
  ADAPTER_IDENTITY_FALLBACK,
  ADAPTER_IDENTITY_MOUNTED,
  ADAPTER_IDENTITY_PENDING,
  REQUIRED_SEAMS,
  apply,
  inject,
  name
};
