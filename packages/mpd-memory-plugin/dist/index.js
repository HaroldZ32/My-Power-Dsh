// packages/mpd-memory-plugin/src/index.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
var OBJECT_SCHEMA = { type: "object", properties: {} };
var DEFAULT_TOOL_TIMEOUT_MS = 120000;
function textBlock(content) {
  return [{ type: "text", text: typeof content === "string" ? content : String(content ?? "") }];
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
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

// packages/mpd-memory-plugin/src/index.ts
var name = "mpd-memory";
var inject = ["tools"];
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  const vcs = v("memory.vcs");
  return {
    ...config,
    vcs: vcs === "git" || vcs === "svn" || vcs === "both" ? vcs : config.vcs,
    dir: typeof v("memory.dir") === "string" ? v("memory.dir") : config.dir,
    agentSlug: typeof v("memory.agentSlug") === "string" ? v("memory.agentSlug") : config.agentSlug,
    reflectionEvery: typeof v("memory.reflectionEvery") === "number" ? v("memory.reflectionEvery") : config.reflectionEvery
  };
}
function textBlock2(text) {
  return [{ type: "text", text }];
}
function cwd() {
  return process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
}
function slugOf(config) {
  if (config.agentSlug)
    return config.agentSlug;
  const base = basename(cwd());
  return "agent-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
}
function bumpRoot(config, slug) {
  return join(cwd(), config.dir ?? ".mpd", "memory", "agents", slug);
}
function ensureDirs(config) {
  const slug = slugOf(config);
  const root = bumpRoot(config, slug);
  const repo = join(root, "repo");
  const runtime = join(root, "runtime");
  const memoryDir = join(repo, "memory");
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  return { root, repo, runtime, memoryDir, slug };
}
function run(cmd, args, cwdDir) {
  const r = spawnSync(cmd, args, { cwd: cwdDir, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: process.env });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.error)
    return { ok: false, out: "spawn error: " + String(r.error.message ?? r.error) };
  return { ok: r.status === 0, out };
}
function gitEnsure(repo) {
  if (!existsSync(join(repo, ".git"))) {
    const r = run("git", ["init", "-q"], repo);
    if (!r.ok)
      throw new Error("mpd-memory: git init failed: " + r.out);
    run("git", ["config", "user.name", "mpd-memory"], repo);
    run("git", ["config", "user.email", "mpd-memory@local"], repo);
  }
  return "git";
}
function svnEnsure(root, repo) {
  const svnRepo = join(root, "svn-repo");
  const url = "file://" + svnRepo;
  if (!existsSync(join(svnRepo, "db"))) {
    const r = run("svnadmin", ["create", svnRepo], root);
    if (!r.ok)
      throw new Error("mpd-memory: svnadmin create failed: " + r.out);
  }
  if (!existsSync(join(repo, ".svn"))) {
    mkdirSync(dirname(repo), { recursive: true });
    const r = run("svn", ["checkout", url, repo], dirname(repo));
    if (!r.ok)
      throw new Error("mpd-memory: svn checkout failed: " + r.out);
  }
  return "svn";
}
function ensureVcs(config, d) {
  const vcs = config.vcs ?? "git";
  if (vcs === "git" || vcs === "both")
    gitEnsure(d.repo);
  if (vcs === "svn" || vcs === "both")
    svnEnsure(d.root, d.repo);
}
function gitCommit(repo, msg) {
  const a = run("git", ["add", "-A"], repo);
  if (!a.ok)
    return "git add failed: " + a.out;
  const c = run("git", ["commit", "-q", "-m", msg], repo);
  return c.ok ? "" : c.out.includes("nothing to commit") ? "" : "git commit failed: " + c.out;
}
function svnCommit(repo, msg) {
  const a = run("svn", ["add", "--force", "--quiet", "."], repo);
  const c = run("svn", ["commit", "-m", msg], repo);
  return c.ok ? "" : "svn commit failed: " + c.out;
}
function commitAll(config, d, msg) {
  const errs = [];
  const vcs = config.vcs ?? "git";
  if (vcs === "git" || vcs === "both") {
    const e = gitCommit(d.repo, msg);
    if (e)
      errs.push(e);
  }
  if (vcs === "svn" || vcs === "both") {
    const e = svnCommit(d.repo, msg);
    if (e)
      errs.push(e);
  }
  return errs;
}
function parseFrontmatter(file) {
  const raw = readFileSync(file, "utf8");
  if (!raw.startsWith(`---
`))
    return { meta: {}, body: raw };
  const end = raw.indexOf(`
---
`, 4);
  if (end < 0)
    return { meta: {}, body: raw };
  let meta = {};
  try {
    meta = JSON.parse(raw.slice(4, end));
  } catch {
    meta = {};
  }
  return { meta, body: raw.slice(end + 5) };
}
function normalizeLogEntry(meta, file, body) {
  return { ...meta, description: meta.description ?? "", content: body.trim(), file: basename(file) };
}
function safeMemoryPath(memoryDir, name2) {
  const target = resolve(memoryDir, name2);
  if (!target.startsWith(resolve(memoryDir) + "/"))
    throw new Error("mpd-memory: path escapes memory dir: " + name2);
  return target;
}
function apply(ctx, config = {}) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const reflectionEvery = cfg.reflectionEvery ?? 10;
  function statePath(d) {
    return join(d.runtime, "reflection.json");
  }
  function factsPath(d) {
    return join(d.runtime, "facts.jsonl");
  }
  function journalPath(d) {
    return join(d.runtime, "journal.jsonl");
  }
  function readReflection(d) {
    try {
      return JSON.parse(readFileSync(statePath(d), "utf8"));
    } catch {
      return { steps: 0, reflected_completed_steps: 0, steps_since_last_successful_reflection: 0, reservation: null, triggered: false };
    }
  }
  function writeReflection(d, s) {
    writeFileSync(statePath(d), JSON.stringify(s, null, 2));
  }
  function appendJournal(d, kind, detail) {
    appendFileSync(journalPath(d), JSON.stringify({ at: new Date().toISOString(), kind, ...detail }) + `
`);
  }
  dsh.registerTool({
    name: "mpd_memory_write",
    description: "Persist a memory entry (markdown file with frontmatter description/kind/aliases/read_only) into the VCS-backed memory store and commit. Increments the reflection step counter; when the reflection threshold is crossed the result announces a reflection is due. kind: note | fact | reflection.",
    parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, kind: { type: "string", enum: ["note", "fact", "reflection"] }, tags: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" } }, required: ["title", "content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { file: { type: "string" }, committedTo: { type: "array", items: { type: "string" } }, reflectionDue: { type: "boolean" }, vcs: { type: "string" }, errors: { type: "array", items: { type: "string" } } }, required: ["file", "vcs"] }, render: (_a, v) => textBlock2("memory written: " + v.file + " (vcs=" + v.vcs + " committed=" + v.committedTo.join(",") + " reflectionDue=" + v.reflectionDue + ")") },
    execute: async (args) => {
      const d = ensureDirs(cfg);
      ensureVcs(cfg, d);
      const name2 = String(args?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) + "-" + Date.now().toString(36);
      const file = safeMemoryPath(d.memoryDir, name2 + ".md");
      const meta = { description: String(args?.description ?? args?.title ?? name2), kind: String(args?.kind ?? "note"), tags: Array.isArray(args?.tags) ? args.tags : [] };
      if (args?.readOnly === true)
        meta.read_only = true;
      const front = `---
` + JSON.stringify(meta) + `
---
`;
      writeFileSync(file, front + String(args?.content) + (String(args?.content).endsWith(`
`) ? "" : `
`));
      const errs = commitAll(cfg, d, "memory: " + name2 + " (" + meta.kind + ")");
      const ref = readReflection(d);
      ref.steps = (ref.steps ?? 0) + 1;
      ref.steps_since_last_successful_reflection = (ref.steps_since_last_successful_reflection ?? 0) + 1;
      if ((ref.steps_since_last_successful_reflection ?? 0) >= reflectionEvery) {
        ref.triggered = true;
        ref.reservation = { status: "pending", at: new Date().toISOString() };
      }
      writeReflection(d, ref);
      appendJournal(d, "write", { file: basename(file), kind: meta.kind, vcs: cfg.vcs ?? "git" });
      return { file, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: ref.triggered === true, vcs: cfg.vcs ?? "git", errors: errs };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_read",
    description: "Read memory entries by optional kind filter and/or a substring query (matched against description/content/tags/aliases), limited to `limit` entries; returns normalized entries with frontmatter metadata and body content.",
    parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { entries: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["entries", "count"] }, render: (_a, v) => textBlock2("memory entries: " + v.count + `
` + v.entries.map((e) => "- [" + (e.kind ?? "note") + "] " + e.description + ": " + e.content.slice(0, 200)).join(`
`)) },
    execute: async (args) => {
      const d = ensureDirs(cfg);
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : [];
      let entries = [];
      const kind = args?.kind ? String(args.kind) : null;
      const query = args?.query ? String(args.query).toLowerCase() : null;
      for (const f of files) {
        const p = join(d.memoryDir, f);
        const { meta, body } = parseFrontmatter(p);
        const e = normalizeLogEntry(meta, f, body);
        if (kind && e.kind !== kind)
          continue;
        if (query) {
          const hay = (e.description + " " + e.content + " " + (e.tags ?? []).join(" ") + " " + (e.aliases ?? []).join(" ")).toLowerCase();
          if (!hay.includes(query))
            continue;
        }
        entries.push(e);
      }
      const limit = Math.min(Math.max(Number(args?.limit ?? 20) || 20, 1), 50);
      return { entries: entries.slice(0, limit), count: entries.length };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_reflect",
    description: "Inspect the reflection state machine: trigger status, reservation, step counters; returns the due hint when a reflection is pending. Crossing the step-count threshold marks a pending reflection; completeTransition equivalent is mpd_memory_reflect_complete.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { state: { type: "object" }, due: { type: "boolean" } }, required: ["state", "due"] }, render: (_a, v) => textBlock2("reflection state: " + JSON.stringify(v.state, null, 1) + (v.due ? `
REFLECTION DUE` : "")) },
    execute: async () => {
      const d = ensureDirs(cfg);
      const s = readReflection(d);
      return { state: s, due: s.triggered === true || s.reservation?.status === "pending" };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_reflect_complete",
    description: "Complete a pending reflection transition: writes the reflection content as a memory entry (kind=reflection), advances reflected_completed_steps / resets steps_since_last_successful_reflection, clears the reservation and commits.",
    parameters: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { completed: { type: "boolean" }, file: { type: "string" } }, required: ["completed", "file"] }, render: (_a, v) => textBlock2("reflection completed: " + (v.completed ? "yes" : "no") + " " + v.file) },
    execute: async (args) => {
      const d = ensureDirs(cfg);
      ensureVcs(cfg, d);
      const name2 = "reflection-" + Date.now().toString(36);
      const file = safeMemoryPath(d.memoryDir, name2 + ".md");
      const meta = { description: String(args?.title ?? "reflection"), kind: "reflection" };
      writeFileSync(file, `---
` + JSON.stringify(meta) + `
---
` + String(args?.content) + `
`);
      commitAll(cfg, d, "memory: reflection " + name2);
      const s = readReflection(d);
      s.reflected_completed_steps = (s.reflected_completed_steps ?? 0) + 1;
      s.steps_since_last_successful_reflection = 0;
      s.triggered = false;
      s.reservation = { status: "completed", at: new Date().toISOString() };
      writeReflection(d, s);
      appendJournal(d, "reflection", { file: basename(file) });
      return { completed: true, file };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_status",
    description: "Show memory engine status: vcs mode, repo paths, entry count, journal/facts line counts, reflection counters.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { vcs: { type: "string" }, root: { type: "string" }, entries: { type: "integer" }, journalLines: { type: "integer" }, reflection: { type: "object" } }, required: ["vcs", "root", "entries"] }, render: (_a, v) => textBlock2("memory status: vcs=" + v.vcs + " root=" + v.root + " entries=" + v.entries + " journal=" + v.journalLines + `
reflection: ` + JSON.stringify(v.reflection)) },
    execute: async () => {
      const d = ensureDirs(cfg);
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : [];
      const journalLines = existsSync(journalPath(d)) ? readFileSync(journalPath(d), "utf8").split(`
`).filter(Boolean).length : 0;
      return { vcs: cfg.vcs ?? "git", root: d.root, entries: files.length, journalLines, reflection: readReflection(d) };
    }
  });
}
export {
  name,
  inject,
  apply
};
