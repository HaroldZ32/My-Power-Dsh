// packages/mpd-bootstrap-plugin/src/index.ts
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

// packages/mpd-bootstrap-plugin/src/index.ts
var name = "mpd-bootstrap";
var inject = ["skills"];
var PROVIDER_NAME = "mpd-bundle";
var BUNDLED_SKILL_RANK = 600;
var SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function bundleRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function harnessHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}
function presetsSource(root) {
  const packed = join(root, "presets");
  return existsSync(packed) ? packed : join(root, "packages", "mpd-bootstrap-plugin", "presets");
}
function warn(ctx, message2) {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function")
      ctx.logger.warn(message2);
    else
      console.log("[mpd-bootstrap] " + message2);
  } catch {}
}
function isAbsent(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
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
    switch (value.toLowerCase()) {
      case "true":
      case "yes":
      case "on":
        return true;
      case "false":
      case "no":
      case "off":
        return false;
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`);
}
function parseInvocation(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy))
      throw new Error(`frontmatter field "${legacy}" is unsupported; use "${legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"}"`);
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false
  };
}
async function readSkillFile(filePath, ctx) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isAbsent(error))
      return;
    throw error;
  }
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: invalid frontmatter: ${String(error?.message ?? error)}`);
    return;
  }
  if (parsed === undefined) {
    warn(ctx, `skill file ${filePath} ignored: missing YAML frontmatter`);
    return;
  }
  const skillName = stringField(parsed.data, "name");
  const description = stringField(parsed.data, "description");
  if (skillName === undefined || description === undefined) {
    warn(ctx, `skill file ${filePath} ignored: frontmatter requires name and description`);
    return;
  }
  if (!SKILL_NAME.test(skillName)) {
    warn(ctx, `skill file ${filePath} ignored: invalid skill name "${skillName}"`);
    return;
  }
  let invocation;
  try {
    invocation = parseInvocation(parsed.data);
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: ${String(error?.message ?? error)}`);
    return;
  }
  const metadata = parsed.data.metadata;
  return {
    name: skillName,
    description,
    ...stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") } : {},
    invocation,
    ...typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? { metadata } : {},
    content: parsed.body.trim()
  };
}
async function listCorpus(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isAbsent(error))
      return [];
    throw error;
  }
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".system")
      continue;
    if (entry.isDirectory())
      found.push({ entry: entry.name, locator: join(root, entry.name, "SKILL.md"), directory: join(root, entry.name) });
    else if (entry.isFile() && entry.name.endsWith(".md"))
      found.push({ entry: entry.name, locator: join(root, entry.name), directory: root });
  }
  return found;
}
function createProvider(root, ctx, invalidate) {
  const provider = {
    name: PROVIDER_NAME,
    async list() {
      const candidates = [];
      for (const entry of await listCorpus(root)) {
        const parsed = await readSkillFile(entry.locator, ctx);
        if (parsed === undefined)
          continue;
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
          invocation: parsed.invocation,
          provider: PROVIDER_NAME,
          source: "bundled",
          rank: BUNDLED_SKILL_RANK,
          locator: { path: entry.locator, directory: entry.directory },
          resourceBase: { kind: "directory", path: entry.directory },
          path: entry.locator,
          ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}
        });
      }
      return candidates;
    },
    async get(candidate) {
      const parsed = await readSkillFile(candidate?.locator?.path ?? "", ctx);
      if (parsed === undefined)
        return;
      return {
        name: parsed.name,
        description: parsed.description,
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: candidate.resourceBase ?? { kind: "directory", path: dirname(candidate?.locator?.path ?? "") },
        path: candidate?.locator?.path,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        content: parsed.content
      };
    }
  };
  if (typeof ctx.on === "function") {
    ctx.on("fs/observed", (target, _observation, actor) => {
      const toolName = actor?.name;
      if (toolName !== "edit" && toolName !== "write")
        return;
      const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined;
      if (displayPath === undefined || !displayPath.startsWith(root))
        return;
      invalidate();
    });
  }
  return provider;
}
function removeIfPresent(target) {
  if (!existsSync(target))
    return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
function cleanLegacyCopies(ctx, corpus, presets, config) {
  const removed = [];
  const skillsStamp = join(harnessHome(), "skills", ".mpd-skills-version");
  if (existsSync(skillsStamp)) {
    for (const name2 of listCorpusSync(corpus)) {
      const target = join(harnessHome(), "skills", name2);
      if (removeIfPresent(target))
        removed.push(target);
    }
    removeIfPresent(skillsStamp);
  }
  if (config.skipPresets !== true) {
    const presetsStamp = join(harnessHome(), ".agent-presets", ".mpd-presets-version");
    if (existsSync(presetsStamp)) {
      let ids = [];
      try {
        ids = readdirSync(presets).filter((id) => id === "mpd" || id.startsWith("mpd-"));
      } catch {
        ids = [];
      }
      for (const id of ids) {
        const target = join(harnessHome(), ".agent-presets", id);
        if (removeIfPresent(target))
          removed.push(target);
      }
      removeIfPresent(presetsStamp);
    }
  }
  for (const path of removed)
    warn(ctx, "legacy copy removed: " + path);
  return removed;
}
function listCorpusSync(root) {
  try {
    return readdirSync(root, { withFileTypes: true, encoding: "utf8" }).filter((entry) => entry.name !== ".system" && (entry.isDirectory() || entry.isFile() && entry.name.endsWith(".md"))).map((entry) => entry.name);
  } catch (error) {
    if (isAbsent(error))
      return [];
    throw error;
  }
}
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const root = bundleRoot();
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills");
  const presets = presetsSource(root);
  let version = "unknown";
  try {
    version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown";
  } catch {}
  if (config.skipSkills === true) {
    console.log("[mpd-bootstrap] skill corpus provider skipped (config)");
  } else {
    dsh.registerSkillProvider((control) => createProvider(corpus, ctx, () => control?.invalidate?.()));
    console.log("[mpd-bootstrap] skill corpus served from " + corpus + " (provider " + PROVIDER_NAME + ", bundle " + version + ")");
  }
  if (config.skipLegacyCleanup === true) {
    console.log("[mpd-bootstrap] legacy home-copy cleanup skipped (config)");
    return;
  }
  try {
    cleanLegacyCopies(ctx, corpus, presets, config);
  } catch (error) {
    warn(ctx, "legacy cleanup failed: " + String(error?.message ?? error));
  }
}
export {
  name,
  inject,
  apply
};
