// packages/mpd-workmate-plugin/src/index.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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

// packages/mpd-workmate-plugin/src/index.ts
var name = "mpd-workmate";
var inject = ["tools", "subagents"];
var PERSONA_CAP = 8 * 1024;
var MEMORY_CAP = 8 * 1024;
var NOTE_CAP = 1536;
var MATCH_THRESHOLD = 0.35;
var READONLY_DENY = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit"];
var REPORT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    recommendation: { type: "string" },
    details: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["name", "summary"],
  additionalProperties: false
};
function textBlock2(text) {
  return [{ type: "text", text }];
}
function now() {
  return new Date().toISOString();
}
function homeDir() {
  return process.env.HOME || homedir();
}
function workmateRoot() {
  return join(homeDir(), ".mpd", "workmate");
}
function wmDir(name2) {
  return join(workmateRoot(), sanitizeName(name2));
}
function sanitizeName(s) {
  const t = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return t;
}
function capText(text, max) {
  if (text.length <= max)
    return text;
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return text.slice(0, head) + `
…[truncated ${text.length - max} chars]…
` + text.slice(-tail);
}
function readMeta(dir) {
  try {
    if (!existsSync(join(dir, "meta.json")))
      return null;
    const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask) };
  } catch {
    return null;
  }
}
function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + `
`);
}
function indexPath() {
  return join(workmateRoot(), "index.json");
}
function readIndex() {
  try {
    if (!existsSync(indexPath()))
      return {};
    const v = JSON.parse(readFileSync(indexPath(), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeIndexEntry(meta) {
  const idx = readIndex();
  idx[meta.name] = { name: meta.name, baseId: meta.baseId, baseName: meta.baseName, uses: meta.uses, updatedAt: meta.updatedAt };
  writeJson(indexPath(), idx);
}
function readNote(name2) {
  try {
    return readFileSync(join(wmDir(name2), "note.md"), "utf8").trim();
  } catch {
    return "";
  }
}
function readMemory(name2, tailBytes = MEMORY_CAP) {
  try {
    const t = readFileSync(join(wmDir(name2), "memory.md"), "utf8").trim();
    if (t.length <= tailBytes)
      return t;
    return `…[earlier memory trimmed]…
` + t.slice(-tailBytes);
  } catch {
    return "";
  }
}
function readPersona(name2) {
  try {
    return readFileSync(join(wmDir(name2), "persona.md"), "utf8").trim();
  } catch {
    return "";
  }
}
function autoNote(meta, persona, memory, previous = "") {
  const prefix = `${meta.baseName}-based workmate "${meta.name}".`;
  const prev = previous.trim();
  const identity = prev === "" ? prefix : prev.startsWith(prefix) ? prev : `${prefix} ${prev}`;
  const last = memory.split(`
`).map((l) => l.trim()).filter((l) => l.startsWith("## ")).pop() || "";
  const task = meta.lastTask ? "Last task: " + meta.lastTask : "No task history yet";
  return capText(`${identity} ${task}.${last ? " " + last.replace(/^##\s*/, "") : ""}`, NOTE_CAP);
}
function appendMemory(name2, entry) {
  const path = join(wmDir(name2), "memory.md");
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim();
  const next = (existing ? existing + `

` : "") + entry.trim();
  if (next.length <= MEMORY_CAP) {
    writeFileSync(path, next + `
`);
    return next;
  }
  const blocks = next.split(/\n## /).map((b, i) => i === 0 ? b : "## " + b).filter((b) => b.trim().length > 0);
  let kept = [];
  let len = 0;
  for (let i = blocks.length - 1;i >= 0; i--) {
    const b = blocks[i];
    if (len + b.length > MEMORY_CAP)
      break;
    kept.unshift(b);
    len += b.length;
  }
  const out = kept.join(`

`);
  writeFileSync(path, out + `
`);
  return out;
}
function mergePersona(name2, revision) {
  const path = join(wmDir(name2), "persona.md");
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim();
  const merged = capText(existing + (revision ? `

## Persona revision (${now()})
${revision.trim()}` : ""), PERSONA_CAP);
  writeFileSync(path, merged + `
`);
  return merged;
}
function ensureInstance(name2) {
  const dir = wmDir(name2);
  const meta = readMeta(dir);
  if (!meta)
    throw new Error(`mpd_workmate: no workmate named "${sanitizeName(name2)}" — run mpd_workmate_init first`);
  return { meta, dir };
}
function listInstances() {
  const root = workmateRoot();
  if (!existsSync(root))
    return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(root, e.name, "meta.json"))).map((e) => {
    const meta = readMeta(join(root, e.name));
    return { name: meta.name, meta, note: readNote(meta.name) };
  }).sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt));
}
function tokenize(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}
function unique(xs) {
  return [...new Set(xs)];
}
function scoreMatch(task, wm) {
  const taskTokens = unique(tokenize(task));
  if (taskTokens.length === 0)
    return 0;
  const corpus = unique(tokenize(`${wm.note} ${wm.baseName} ${wm.description} ${wm.memoryTail}`));
  const hit = taskTokens.filter((t) => corpus.includes(t)).length;
  let score = hit / taskTokens.length;
  const baseWords = unique(tokenize(wm.baseName));
  if (baseWords.some((w) => taskTokens.includes(w)))
    score += 0.15;
  return Math.min(1, score);
}
function apply(ctx) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  function rolesService() {
    return ctx.get ? ctx.get("mpdRoles") : undefined;
  }
  function resolveBase(key) {
    const roles = rolesService();
    if (!roles)
      throw new Error("mpd_workmate: mpdRoles service unavailable (mpd-roles-plugin not mounted)");
    const k = String(key ?? "").trim();
    if (!k)
      throw new Error("mpd_workmate: base required (roster id or normal name)");
    const direct = roles.get(k);
    if (direct)
      return { id: direct.id, name: direct.name, description: direct.description, readonly: Boolean(direct.readonly), provider: direct.chain?.[0]?.provider ?? "deepseek-official", model: direct.chain?.[0]?.model ?? "", persona: String(direct.persona ?? "") };
    const byName = roles.list().find((r) => String(r.name).toLowerCase() === k.toLowerCase());
    if (byName)
      return { id: byName.id, name: byName.name, description: byName.description, readonly: Boolean(byName.readonly), provider: byName.chain?.[0]?.provider ?? "deepseek-official", model: byName.chain?.[0]?.model ?? "", persona: String(byName.persona ?? "") };
    throw new Error(`mpd_workmate: unknown base "${k}" — run mpd_roles_list (ids or normal names like "Deep Worker")`);
  }
  function initWorkmate(baseKey, nameArg, noteArg) {
    const base = resolveBase(baseKey);
    const given = sanitizeName(nameArg);
    let name2 = given;
    if (!name2) {
      const n = listInstances().filter((i) => i.meta.baseId === base.id).length + 1;
      name2 = `${base.id}-${n}`;
    }
    const dir = wmDir(name2);
    if (existsSync(dir))
      throw new Error(`mpd_workmate: "${name2}" already exists — pick another name or reuse it via mpd_workmate_spawn`);
    mkdirSync(dir, { recursive: true });
    const meta = { name: name2, baseId: base.id, baseName: base.name, description: base.description, provider: base.provider, model: base.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + `
`);
    writeFileSync(join(dir, "persona.md"), capText(base.persona, PERSONA_CAP) + `
`);
    writeFileSync(join(dir, "memory.md"), "");
    const note = capText(String(noteArg ?? "").trim() || autoNote(meta, base.persona, ""), NOTE_CAP);
    writeFileSync(join(dir, "note.md"), note + `
`);
    writeIndexEntry(meta);
    return { name: name2, baseId: base.id, baseName: base.name, readonly: base.readonly, provider: base.provider, model: base.model, path: dir, note };
  }
  const workmateLibrary = {
    list: () => listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, updatedAt: meta.updatedAt, note })),
    get: (name2) => {
      try {
        const { meta } = ensureInstance(name2);
        return { ...meta, note: readNote(meta.name) };
      } catch {
        return null;
      }
    },
    read: (name2) => {
      try {
        const { meta } = ensureInstance(name2);
        return { ...meta, persona: readPersona(meta.name), memory: readMemory(meta.name), note: readNote(meta.name) };
      } catch {
        return null;
      }
    }
  };
  ctx.provide("mpdWorkmate", workmateLibrary);
  dsh.registerTool({
    name: "mpd_workmate_list",
    description: "List the workmate library (~/.mpd/workmate): each durable evolving agent instance with its base specialist, use count, last-updated time and note summary. Use before delegating a task: if a workmate's note matches well you can reuse it; otherwise initialize a new one.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { workmates: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["workmates", "count"], additionalProperties: false }, render: (_a, v) => textBlock2("workmates (" + v.count + `):
` + v.workmates.map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " :: " + String(w.note).slice(0, 140)).join(`
`) || "(empty)") },
    execute: async () => {
      const list = listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, note }));
      return { workmates: list, count: list.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_init",
    description: "Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = roster id or normal name (mpd_roles_list). The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.",
    parameters: { type: "object", properties: { base: { type: "string", description: 'roster id or normal name (e.g. hephaestus or "Deep Worker")' }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseId: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a, v) => textBlock2("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + `)
note: ` + v.note) },
    execute: async (args) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""))
  });
  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a one-shot subagent carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). The subagent must call mpd_workmate_reflect with a self-summary before finishing. For team work, instead add a member whose name equals the workmate name (its persona/memory are injected automatically).",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a, v) => textBlock2("workmate " + v.name + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "")) },
    execute: async (args, exec) => {
      const { meta } = ensureInstance(String(args?.name ?? ""));
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_workmate_spawn: task required");
      const persona = readPersona(meta.name);
      const memory = readMemory(meta.name);
      const note = readNote(meta.name);
      const prompt = persona + `

Your independent memory (bounded, latest first):
` + (memory || "(empty — you are a fresh workmate)") + `

Workmate note:
` + (note || "(none)") + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only workmates must never modify anything).` + " BEFORE your final report, call mpd_workmate_reflect with a concise self-summary (task / outcome / what you learned / optional persona_delta / optional new note) so your workmate persona and memory evolve. Then end with ONLY the structured report (name/summary/recommendation/details/evidence).";
      const result = await dsh.spawnAgent({
        label: "workmate-" + meta.name + "-" + randomUUID().slice(0, 8),
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider: meta.provider,
        model: meta.model,
        persona,
        outputSchema: REPORT_SCHEMA,
        ...meta.readonly ? { toolFilter: { deny: READONLY_DENY } } : {}
      });
      const st = result.structured ?? {};
      return { name: meta.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_reflect",
    description: "Self-evolve a workmate after a completed work session: append a bounded memory entry (oldest evicted past the cap), merge an optional persona revision, regenerate its short note, and bump the use count. Call this at the end of every task a workmate did — the workmate itself is instructed to do so; the caller may also call it on its behalf.",
    parameters: { type: "object", properties: { name: { type: "string" }, task: { type: "string" }, outcome: { type: "string" }, persona_delta: { type: "string", description: "optional persona revision text (merged, capped)" }, note: { type: "string", description: "optional replacement note card; auto-generated if omitted" } }, required: ["name", "task", "outcome"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, uses: { type: "integer" }, personaChars: { type: "integer" }, memoryChars: { type: "integer" }, noteChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false }, render: (_a, v) => textBlock2("workmate " + v.name + " reflected (uses=" + v.uses + ", persona " + v.personaChars + "B / memory " + v.memoryChars + "B / note " + v.noteChars + "B)") },
    execute: async (args) => {
      const { meta } = ensureInstance(String(args?.name ?? ""));
      const task = String(args?.task ?? "").trim();
      const outcome = String(args?.outcome ?? "").trim();
      if (!task || !outcome)
        throw new Error("mpd_workmate_reflect: task and outcome required");
      appendMemory(meta.name, `## ${now()} — ${capText(task, 200)}
${capText(outcome, 1200)}`);
      const persona = mergePersona(meta.name, String(args?.persona_delta ?? "").trim());
      const memory = readMemory(meta.name);
      meta.uses += 1;
      meta.lastTask = task;
      meta.updatedAt = now();
      writeFileSync(join(wmDir(meta.name), "meta.json"), JSON.stringify(meta, null, 2) + `
`);
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(meta.name)), NOTE_CAP);
      writeFileSync(join(wmDir(meta.name), "note.md"), note + `
`);
      writeIndexEntry(meta);
      return { name: meta.name, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a, v) => textBlock2((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + `
` + v.matches.map((m) => "- " + m.name + " score=" + m.score.toFixed(2) + " [" + m.baseName + "] :: " + String(m.note).slice(0, 120)).join(`
`) + (v.suggestion ? `
` + v.suggestion : "")) },
    execute: async (args) => {
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_workmate_match: task required");
      const matches = listInstances().map(({ name: name2, meta, note }) => {
        const memoryTail = readMemory(name2, 600);
        const score = scoreMatch(task, { note, baseName: meta.baseName, description: meta.description, memoryTail });
        return { name: name2, score: Math.round(score * 100) / 100, baseName: meta.baseName, baseId: meta.baseId, readonly: meta.readonly, uses: meta.uses, note };
      }).sort((a, b) => b.score - a.score);
      const best = matches[0];
      const matched = !!best && best.score >= MATCH_THRESHOLD;
      return { matched, threshold: MATCH_THRESHOLD, matches, suggestion: matched ? `Delegate to "${best.name}" (score ${best.score}).` : "No note matches well enough — initialize a NEW workmate with mpd_workmate_init instead of forcing a weak match." };
    }
  });
  let webRegistered = false;
  const registerWebSurface = () => {
    if (webRegistered)
      return;
    const webServer = (ctx.get ? ctx.get("webServer") : undefined) ?? (ctx.get ? ctx.get("httpServer") : undefined);
    if (webServer === undefined || typeof ctx.effect !== "function")
      return;
    webRegistered = true;
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/list",
      handler: async (_req, res) => {
        const list = listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseId: meta.baseId, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, note }));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ workmates: list }));
      }
    }), "mpd-workmate: list route");
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/roster",
      handler: async (_req, res) => {
        const roles = ctx.get ? ctx.get("mpdRoles") : undefined;
        let bases = [];
        try {
          bases = (typeof roles?.list === "function" ? roles.list() : []).map((r) => ({ id: String(r.id), name: String(r.name), description: String(r.description ?? ""), readonly: Boolean(r.readonly) }));
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: String(e?.message ?? e) }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ bases }));
      }
    }), "mpd-workmate: roster route");
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/get",
      handler: async (req, res) => {
        const name2 = String(new URL(String(req.url ?? "/"), "http://dsh.invalid").searchParams.get("name") ?? "").trim();
        const detail = name2 === "" ? null : workmateLibrary.read(name2);
        if (detail == null) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "unknown workmate: " + name2 }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(detail));
      }
    }), "mpd-workmate: get route");
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/init",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
          res.end();
          return;
        }
        let raw = "";
        for await (const chunk of req)
          raw += String(chunk);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "invalid JSON" }));
          return;
        }
        try {
          const created = initWorkmate(String(body?.base ?? ""), String(body?.name ?? ""), String(body?.note ?? ""));
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify(created));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String(e?.message ?? e) }));
        }
      }
    }), "mpd-workmate: init route");
  };
  registerWebSurface();
  if (typeof ctx.on === "function") {
    ctx.on("internal/service", (n) => {
      if (n === "webServer" || n === "httpServer")
        registerWebSurface();
    });
  }
}
export {
  scoreMatch,
  sanitizeName,
  name,
  inject,
  capText,
  autoNote,
  apply,
  PERSONA_CAP,
  NOTE_CAP,
  MEMORY_CAP,
  MATCH_THRESHOLD
};
