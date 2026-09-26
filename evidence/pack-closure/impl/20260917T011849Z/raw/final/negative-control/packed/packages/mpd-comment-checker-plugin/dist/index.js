// packages/mpd-comment-checker-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

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

// packages/mpd-comment-checker-plugin/src/index.ts
var name = "mpd-comment-checker";
var inject = ["tools"];
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  return {
    ...config,
    autoCheck: typeof v("commentChecker.autoCheck") === "boolean" ? v("commentChecker.autoCheck") : config.autoCheck,
    binary: typeof v("commentChecker.bin") === "string" ? v("commentChecker.bin") : config.binary,
    timeoutMs: typeof v("commentChecker.timeoutMs") === "number" ? v("commentChecker.timeoutMs") : config.timeoutMs,
    maxMessageChars: typeof v("commentChecker.maxMessageChars") === "number" ? v("commentChecker.maxMessageChars") : config.maxMessageChars
  };
}
function textBlock2(text) {
  return [{ type: "text", text }];
}
function repoRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function platformKey() {
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return process.platform + "-" + arch;
}
function dependencyBinary() {
  try {
    const req = createRequire(import.meta.url);
    const p = req.resolve("@code-yeongyu/comment-checker/package.json");
    return join(dirname(p), "vendor", platformKey(), "comment-checker");
  } catch {
    return null;
  }
}
function resolveBinary(config) {
  if (config.binary && existsSync(resolve2(config.binary)))
    return resolve2(config.binary);
  const env = process.env.MPD_DSH_COMMENT_CHECKER_BIN;
  if (env && existsSync(env))
    return env;
  const dep = dependencyBinary();
  if (dep && existsSync(dep))
    return dep;
  const candidates = [
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "vendor", platformKey(), "comment-checker"),
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker")
  ];
  for (const c of candidates)
    if (existsSync(c))
      return c;
  return null;
}
function hookInputFor(path, content, root) {
  return {
    session_id: "mpd",
    tool_name: "Write",
    transcript_path: "",
    cwd: root ?? workspaceRootOf(),
    hook_event_name: "PostToolUse",
    tool_input: { file_path: path, content },
    tool_response: { content: [{ type: "text", text: "file content" }], details: null, isError: false }
  };
}
function runCheck(binary, hookInput, timeoutMs) {
  const r = spawnSync(binary, ["check"], { input: JSON.stringify(hookInput), encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  if (r.error)
    throw new Error("mpd-comment-checker: spawn failed: " + String(r.error.message ?? r.error));
  const stderr = (r.stderr ?? "") + (r.stdout ?? "");
  if (r.status === 0)
    return { hasComments: false, message: "" };
  if (r.status === 2)
    return { hasComments: true, message: stderr };
  return { hasComments: false, message: "unexpected exit " + r.status + ": " + stderr.slice(0, 200) };
}
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const timeoutMs = cfg.timeoutMs ?? 30000;
  const maxMessageChars = cfg.maxMessageChars ?? 12000;
  dsh.registerTool({
    name: "mpd_comment_check",
    description: "Run the comment/docstring detector on one or more files (content in memory or read from disk). Returns per-file detection results; exit 2 means comments/docstrings found and the binary message spells the required action. The binary (@code-yeongyu/comment-checker, MIT) must be installed in .toolchain (installer flag --with-comment-checker) or set via MPD_DSH_COMMENT_CHECKER_BIN.",
    parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"], additionalProperties: false } } }, required: ["files"] },
    output: { schema: { type: "object", properties: { binary: { type: "string" }, results: { type: "array", items: { type: "object" } } }, required: ["binary", "results"] }, render: (_a, v) => textBlock2("comment-check binary=" + v.binary + `
` + v.results.map((x) => x.hasComments ? "DETECTED " + x.path + ": " + x.message.slice(0, maxMessageChars) : "clean " + x.path).join(`
`)) },
    execute: async (args, exec) => {
      const binary = resolveBinary(cfg);
      if (!binary)
        throw new Error("mpd-comment-checker: binary not found — run the installer with --with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN");
      const files = Array.isArray(args?.files) ? args.files : [];
      const results = [];
      for (const f of files) {
        const path = String(f.path);
        const content = typeof f.content === "string" ? f.content : existsSync(path) ? readFileSync(path, "utf8") : "";
        if (!content) {
          results.push({ path, hasComments: false, message: "no content to check" });
          continue;
        }
        try {
          const res = runCheck(binary, hookInputFor(path, content, dsh.workspaceRoot(exec)), timeoutMs);
          if (!res.hasComments && res.message)
            results.push({ path, hasComments: false, message: res.message });
          else
            results.push({ path, ...res });
        } catch (e) {
          results.push({ path, hasComments: false, message: "error: " + String(e?.message ?? e) });
        }
      }
      return { binary, results };
    }
  });
  if (cfg.autoCheck === true) {
    dsh.onPostToolExecute(async (exec, result, out) => {
      if (out.kind !== "accept")
        return out;
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write";
      if (!isEdit)
        return out;
      const fp = exec.arguments?.file_path ?? exec.arguments?.path;
      if (typeof fp !== "string")
        return out;
      const binary = resolveBinary(cfg);
      if (!binary)
        return out;
      let content = "";
      try {
        content = readFileSync(fp, "utf8");
      } catch {
        return out;
      }
      if (!content)
        return out;
      const res = runCheck(binary, hookInputFor(fp, content, dsh.workspaceRoot(exec)), timeoutMs);
      if (!res.hasComments)
        return out;
      const hint = "[mpd-comment-checker] comments/docstrings detected in " + fp + `:
` + res.message.slice(0, maxMessageChars);
      const c = out.content ?? result?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b && b.type === "text" ? b.text : "").join(`
`) : "";
      return { ...out, content: [{ type: "text", text: (text ? text + `

` : "") + hint }] };
    });
  }
}
export {
  runCheck,
  resolveBinary,
  name,
  inject,
  hookInputFor,
  apply
};
