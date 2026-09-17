// packages/mpd-tools-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";

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
      const agents = service("agents");
      const compaction = service("compaction");
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
        agents: agents !== undefined && typeof agents?.list === "function",
        compaction: typeof compaction?.compactNow === "function",
        compactionForAgent: scopedCompaction,
        events: typeof ctx?.on === "function"
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    liveAgents,
    liveAgent,
    compactionEngineForAgent,
    onEvent,
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
    text: textBlock
  };
  return adapter;
}

// packages/mpd-tools-plugin/src/index.ts
var name = "mpd-tools";
var inject = ["tools"];
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const writeGuard = config.writeGuard ?? true;
  const maxBytes = config.truncateMaxBytes ?? 16384;
  const recoveryHint = config.recoveryHint ?? "mpd-tools recovery: read the file fresh with the read tool, re-check exact old_string/new_string (whitespace matters), then retry the edit against the current file content.";
  if (writeGuard) {
    dsh.guardTool((exec) => {
      if (exec.name !== "write")
        return;
      const fp = exec.arguments?.file_path;
      const content = exec.arguments?.content;
      if (typeof fp !== "string" || typeof content !== "string")
        return;
      if (!existsSync(fp))
        return;
      try {
        const old = readFileSync(fp, "utf8");
        if (old === content)
          return;
      } catch {
        return;
      }
      return "mpd-tools guard: target file already exists with different content — use the edit tool (or read then rewrite deliberately via write with identical content) instead of overwriting.";
    });
  }
  function blocksToText(content) {
    if (typeof content === "string")
      return content;
    if (Array.isArray(content))
      return content.map((b) => b && b.type === "text" ? b.text : "").join(`
`);
    return "";
  }
  dsh.onPostToolExecute(async (exec, result, out) => {
    if (out.kind !== "accept")
      return out;
    const text = blocksToText(out.content ?? result?.content);
    if (text.length <= maxBytes)
      return out;
    const banner = `
... [mpd-tools truncated ` + text.length + " chars; keep " + maxBytes + ` budget; tail follows] ...
`;
    const budget = Math.max(0, maxBytes - banner.length);
    const head = budget > 0 ? text.slice(0, Math.floor(budget * 0.7)) : "";
    const tail = budget > 0 ? text.slice(-Math.floor(budget * 0.3)) : "";
    return { ...out, content: [{ type: "text", text: head + banner + tail }] };
  });
  dsh.onPostToolExecute(async (exec, result, out) => {
    if (out.kind !== "accept")
      return out;
    const isEdit = exec.name === "edit" || exec.name === "str_replace_editor";
    if (!isEdit || !result?.isError)
      return out;
    const msg = result?.error?.message ?? String(result?.error ?? "edit failed");
    const prior = blocksToText(out.content ?? result?.content);
    return { ...out, content: [{ type: "text", text: (prior ? prior + `

` : "") + "Edit failed: " + msg + `
` + recoveryHint }] };
  });
}
export {
  name,
  inject,
  apply
};
