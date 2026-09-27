// packages/mpd-ulw-plugin/src/index.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";

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
var ULW_ACTIVATION_DIRECTIVE = [
  "ULTRAWORK ACTIVATION (user-invoked; execute autonomously and ask the user nothing)",
  "1. TRIAGE FIRST: when the objective is unclear, or the task is investigate-first-then-execute, run one normal-MPD investigation round BEFORE the gate, a team or the loop; never open a team on a guess.",
  "2. GATE: then evaluate the SAME complexity predicate the session-start gate uses — an explicit `team:`/`!team` flag OR any matched signal A-D (A explicit flag; B deliverable verbs; C enumerated steps; D an existing .mpd/plans artifact). Never invent a second predicate.",
  "3. TEAM WHEN WARRANTED: when the gate fires, or the work is complex, stage the team YOURSELF with the OFFICIAL team tools — spawn_teammate({name, description, prompt}) for each roster member, then team_task_create({subject, description, blocked_by?, write_scopes?}) for the DAG — and run it: no user confirmation and no plan review. The retired `agent_teams_*` tools do not exist on this harness; the team's state is the Lead session's own.",
  "4. LOOP TO COMPLETION: never stop early to ask the user; keep rounds until every success criterion is clean.",
  "5. FIX ON SIGHT: a defect the run finds is fixed in the same turn — never report-and-wait and never ask the user for approval.",
  "6. CLOSE OUT ON PROOF: report done only after the verification gate and the quality-gate ledger both approve; otherwise keep working, or report the concrete blocker."
].join(String.fromCharCode(10));
function activationDirective(objective) {
  return ULW_ACTIVATION_DIRECTIVE + String.fromCharCode(10, 10) + "OBJECTIVE: " + String(objective ?? "").trim();
}
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
function messageText(message2) {
  if (!Array.isArray(message2?.content))
    return;
  const parts = message2.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text);
  return parts.length === 0 ? undefined : parts.join(String.fromCharCode(10));
}
var GESTURE_PATTERN = /^(?:\/ulw|\/ultrawork)(?:[\t\n\r ]+|$)/u;
function claimGesture(messages) {
  if (!Array.isArray(messages))
    return;
  for (const message2 of messages) {
    if (message2?.role !== "user")
      continue;
    const text = messageText(message2);
    if (text === undefined)
      continue;
    const match = GESTURE_PATTERN.exec(text.trim());
    if (match !== null)
      return { message: message2, text, match };
  }
  return;
}
function rewriteMessageText(message2, text) {
  const content = Array.isArray(message2?.content) ? message2.content : [];
  const at = content.findIndex((block) => block?.type === "text");
  if (at < 0)
    return message2;
  return { ...message2, content: content.map((block, index) => index === at ? { ...block, text } : block) };
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
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string", description: "Present only when a plan file was written (plan=true or tier=heavy); absent otherwise" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
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
      const id = "ulw-" + randomUUID2().slice(0, 8);
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
      return { status, rounds: used, ...planFile === null ? {} : { planFile }, verdict, ledger: gateLedger, finalReport, stateFile };
    }
  });
  dsh.registerTool({
    name: "mpd_ulw",
    description: "Lightweight ulw-loop alias: same engine as mpd_ultrawork with tier=light, plan=false, hyperplan=false. Returns the same result fields as mpd_ultrawork (status, rounds, finalReport, stateFile).",
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
  const ULW_USAGE = "usage: /ulw <objective> (alias: /ultrawork <objective>) — starts an autonomous ULW run for that objective";
  const ULW_COMMAND_DESCRIPTION = (alias) => "Run the ULW discipline for an objective, fully autonomously (identical alias: " + alias + ")";
  const runUlwCommand = (invocation) => {
    const objective = String(invocation?.rawInput ?? "").trim();
    if (objective === "")
      return { kind: "error", text: ULW_USAGE };
    const submitted = invocation.submit?.(dsh.userMessage({ text: activationDirective(objective), source: { kind: "mpd-ulw", reason: "activation-directive" } })) === true;
    if (!submitted)
      return { kind: "error", text: "ULW could not start: no live agent turn surface to submit the activation directive for " + JSON.stringify(objective) };
    return { kind: "success", text: "ULW activated: " + objective };
  };
  const commandDisposers = ["ulw", "ultrawork"].map((name2) => dsh.registerCommand({ name: name2, description: ULW_COMMAND_DESCRIPTION(name2 === "ulw" ? "/ultrawork" : "/ulw"), input: { hint: "objective" }, handler: runUlwCommand }));
  const gestureDispose = dsh.onEvent("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined;
    try {
      if (decision === undefined || decision === null || decision.kind === "reject")
        return decision;
      const messages = Array.isArray(decision.messages) ? decision.messages : Array.isArray(payload?.messages) ? payload.messages : undefined;
      if (messages === undefined)
        return decision;
      const claimed = claimGesture(messages);
      if (claimed === undefined)
        return decision;
      const objective = claimed.text.trim().slice(claimed.match[0].length).trim();
      if (objective === "")
        return decision;
      return { ...decision, messages: messages.map((message2) => message2 === claimed.message ? rewriteMessageText(message2, activationDirective(objective)) : message2) };
    } catch {
      return decision;
    }
  });
  const disposers = [...commandDisposers, ...gestureDispose === undefined ? [] : [gestureDispose]];
  if (typeof ctx.effect === "function")
    ctx.effect(() => () => {
      for (const dispose of disposers)
        dispose();
    }, "mpd-ulw.commands");
}
export {
  ULW_ACTIVATION_DIRECTIVE,
  activationDirective,
  apply,
  inject,
  name
};
