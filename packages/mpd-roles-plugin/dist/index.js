// packages/mpd-roles-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// packages/mpd-roles-plugin/src/roles.data.ts
var ROLES = [
  {
    id: "oracle",
    name: "Architect",
    description: "Strategic technical advisor: architecture review, deep debugging, self-review.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
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
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/prometheus.md"
  },
  {
    id: "hephaestus",
    name: "Deep Worker",
    description: "Autonomous deep worker: receives goals, executes them end-to-end with tools, verifies every change.",
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
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
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
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/atlas.md"
  },
  {
    id: "explore",
    name: "Explorer",
    description: "Read-only codebase explorer: evidence-based answers, never edits.",
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
    description: "Deep reviewer: correctness/risk findings with evidence, no fixes.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/metis.md"
  },
  {
    id: "momus",
    name: "Plan Reviewer",
    description: "Work-plan QA reviewer: verifies plans are executable and references valid, rejects only true blockers; UI/UX critique is a local extension.",
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
  return null;
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
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  ctx.provide("mpdRoles", {
    list: () => ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: readPersona(config, r) })),
    get: (key) => {
      const id = normalizeRoleKey(key);
      if (!id)
        return null;
      const spec = ROLE_BY_ID[id];
      return { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: readPersona(config, spec) };
    }
  });
  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster (ids → normal display names): Architect(oracle), Researcher(librarian), Planner(prometheus), Deep Worker(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), Plan Reviewer(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). Use before mpd_role_spawn. Team mode uses the dsh-agent-teams profiles (agent_teams_create profile=mpd).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["roles", "count"] }, render: (_a, v) => textBlock2("roster (" + v.count + `):
` + v.roles.map((r) => "- " + r.id + " [" + r.model + (r.readonly ? " readonly" : "") + "] " + r.description).join(`
`)) },
    execute: async () => ({ roles: ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null })), count: ROLES.length })
  });
  dsh.registerTool({
    name: "mpd_role_spawn",
    description: "Spawn one specialist as a one-shot subagent with its roster persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Use ids from mpd_roles_list: Architect(oracle), Researcher(librarian), Planner(prometheus), Deep Worker(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), Plan Reviewer(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). For multi-member team work prefer the adopted dsh-agent-teams protocol (agent_teams_create + agent_teams_add_member), not repeated one-shot spawns.",
    parameters: { type: "object", properties: { role: { type: "string", description: "roster role id (mpd_roles_list)" }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" }, model: { type: "string", description: "optional model override (default: the role's primary route)" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a, v) => textBlock2("role " + v.role + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "") + (v.evidence?.length ? `
evidence:
- ` + v.evidence.join(`
- `) : "")) },
    execute: async (args, exec) => {
      const id = normalizeRoleKey(String(args?.role ?? ""));
      if (!id)
        throw new Error("mpd_role_spawn: unknown role '" + String(args?.role) + "' — call mpd_roles_list first");
      const spec = ROLE_BY_ID[id];
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_role_spawn: task required");
      const persona = readPersona(config, spec);
      const provider = spec.chain[0]?.provider ?? "deepseek-official";
      const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : spec.chain[0]?.model;
      const prompt = persona + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence).`;
      const result = await dsh.spawnAgent({
        label: "role-" + id + "-" + randomUUID().slice(0, 8),
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
      return { role: id, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
    }
  });
  dsh.registerTool({
    name: "mpd_role_persona",
    description: "Return the full persona text of one roster role. Use it when a spawn surface takes the persona as TEXT (e.g. agent_teams_add_member persona=...), so the member gets the real role instructions instead of a bare id.",
    parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a, v) => textBlock2("persona " + v.role + " (" + v.chars + ` chars):
` + v.persona) },
    execute: async (args) => {
      const id = normalizeRoleKey(String(args?.role ?? ""));
      if (!id)
        throw new Error("mpd_role_persona: unknown role '" + String(args?.role) + "'");
      const persona = readPersona(config, ROLE_BY_ID[id]);
      return { role: id, persona, chars: persona.length };
    }
  });
}
export {
  readPersona,
  pkgRoot,
  normalizeRoleKey,
  name,
  inject,
  apply,
  READONLY_DENY
};
