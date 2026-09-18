// packages/mpd-team-compact-plugin/src/index.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
      const commands = service("commands");
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
        commands: commands !== undefined,
        commandsRegister: typeof commands?.register === "function",
        turnSubmit: liveAgents().some((candidate) => typeof candidate?.followup === "function"),
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
    text: textBlock,
    userMessage,
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

// packages/mpd-team-compact-plugin/src/index.ts
var name = "mpd-team-compact";
var inject = ["tools"];
var TEAM_STATE_DIR = join(".mpd", "team");
var COMPACT_STATE_DIR = join(".mpd", "team-compact");
var CAPTAIN_KEY = "captain";
async function terminalTaskStatuses() {
  const here = dirname(fileURLToPath(import.meta.url));
  const specifier = join(here, "..", "..", "mpd-agent-teams-plugin", "lib", "types.js");
  const mod = await import(specifier);
  const statuses = mod.TERMINAL_TASK_STATUSES;
  if (!Array.isArray(statuses) || statuses.length === 0 || !statuses.every((s) => typeof s === "string")) {
    throw new Error("mpd-team-compact: the agent-teams types module no longer exports a TERMINAL_TASK_STATUSES string array");
  }
  return statuses;
}
var COMPACTION_FAILURE_CODES = ["busy", "cancelled", "changed", "summary", "commit", "persistence"];
function sameAuditOutcome(previous, next) {
  if (previous === undefined)
    return false;
  if (previous.outcome !== next.outcome)
    return false;
  if ((previous.refusedReason ?? "") !== (next.refusedReason ?? ""))
    return false;
  if (previous.members.length !== next.members.length)
    return false;
  return previous.members.every((member, index) => {
    const other = next.members[index];
    if (other === undefined)
      return false;
    return member.member === other.member && member.outcome === other.outcome && (member.reason ?? "") === (other.reason ?? "") && (member.failureCode ?? "") === (other.failureCode ?? "");
  });
}
function readTeamRecord(workspace, teamId) {
  const file = join(workspace, TEAM_STATE_DIR, teamId, "team.json");
  if (!existsSync(file))
    return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object")
      return;
    if (typeof parsed.id !== "string" || !Array.isArray(parsed.members) || !Array.isArray(parsed.tasks))
      return;
    return parsed;
  } catch {
    return;
  }
}
function listTeamIds(workspace) {
  const root = join(workspace, TEAM_STATE_DIR);
  if (!existsSync(root))
    return [];
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "archive").map((entry) => entry.name);
  } catch {
    return [];
  }
}
function teamIsFinished(team, terminal) {
  if (!Array.isArray(team.tasks) || team.tasks.length === 0)
    return false;
  return team.tasks.every((task) => terminal.includes(task.status));
}
function compactableMembers(team) {
  return team.members.filter((member) => member.name !== CAPTAIN_KEY && member.status !== "removed");
}
function isStagedMember(member) {
  return member.id === "";
}
function auditDir(workspace, teamId) {
  return join(workspace, COMPACT_STATE_DIR, teamId);
}
function writeAudit(workspace, audit) {
  const dir = auditDir(workspace, audit.teamId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date(audit.at).toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(audit, null, 2) + `
`);
  return file;
}
function readAudits(workspace, teamId) {
  const dir = auditDir(workspace, teamId);
  if (!existsSync(dir))
    return [];
  try {
    return readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort().map((entry) => {
      try {
        return JSON.parse(readFileSync(join(dir, entry), "utf8"));
      } catch {
        return;
      }
    }).filter((audit) => audit !== undefined);
  } catch {
    return [];
  }
}
function classifyCompactionError(error) {
  const text = error instanceof Error ? error.message : String(error);
  const code = error?.code;
  const named = typeof code === "string" && COMPACTION_FAILURE_CODES.includes(code) ? code : COMPACTION_FAILURE_CODES.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(text));
  if (named !== undefined && named !== "busy")
    return { outcome: "failed", failureCode: named, error: text };
  if (/inactive context|inactive\b/i.test(text) || /cannot get required service/i.test(text)) {
    return { outcome: "lifecycle-error", error: text };
  }
  if (named === "busy")
    return { outcome: "failed", failureCode: "busy", error: text };
  return { outcome: "failed", error: text };
}
var DEFAULT_IDLE_WAIT_MS = 20000;
var DEFAULT_IDLE_POLL_MS = 250;
function agentIsIdle(agent) {
  if (agent === undefined)
    return false;
  const status = agent.status;
  return status === undefined || status === "idle";
}
async function compactTeamPass(dsh, team, options) {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve2) => setTimeout(resolve2, ms)));
  const at = now();
  const members = compactableMembers(team);
  const base = {
    schema: "mpd/team-compact@1",
    teamId: team.id,
    teamName: team.name,
    at,
    engineResolution: "agent-scoped"
  };
  if (!teamIsFinished(team, options.terminal)) {
    const nonTerminal = team.tasks.filter((task) => !options.terminal.includes(task.status));
    return {
      ...base,
      outcome: "refused",
      refusedReason: `team still has ${nonTerminal.length} non-terminal task(s): ${nonTerminal.map((task) => `${task.id}=${task.status}`).join(", ")}`,
      members: []
    };
  }
  const resolved = members.map((member) => ({
    member,
    staged: isStagedMember(member),
    agent: isStagedMember(member) ? undefined : dsh.liveAgent(member.id)
  }));
  const live = resolved.filter((entry) => !entry.staged && entry.agent !== undefined);
  if (live.length === 0) {
    return {
      ...base,
      outcome: "not-live",
      refusedReason: "no live member Agents in this process (team is dormant or not yet spawned)",
      members: resolved.map((entry) => ({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: entry.staged ? "skipped-staged" : "skipped-not-live",
        ...entry.staged ? { reason: "member has no session id yet (not spawned)" } : { reason: "no live Agent for this session id" }
      }))
    };
  }
  const idleWaitMs = options.idleWaitMs ?? DEFAULT_IDLE_WAIT_MS;
  const idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
  const deadline = now() + idleWaitMs;
  let allIdle = live.every((entry) => agentIsIdle(dsh.liveAgent(entry.member.id)));
  while (!allIdle && now() < deadline) {
    await sleep(idlePollMs);
    allIdle = live.every((entry) => agentIsIdle(dsh.liveAgent(entry.member.id)));
  }
  if (!allIdle) {
    const busy = live.filter((entry) => !agentIsIdle(dsh.liveAgent(entry.member.id))).map((entry) => entry.member.name);
    return {
      ...base,
      outcome: "timeout",
      refusedReason: `waited ${idleWaitMs} ms for every member to be idle; still busy: ${busy.join(", ")}`,
      members: resolved.map((entry) => ({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: entry.staged ? "skipped-staged" : entry.agent === undefined ? "skipped-not-live" : busy.includes(entry.member.name) ? "skipped-not-live" : "no-safe-range",
        reason: entry.staged ? "member has no session id yet (not spawned)" : entry.agent === undefined ? "no live Agent for this session id" : busy.includes(entry.member.name) ? "still busy when the barrier expired" : "idle, but the barrier never cleared so no drive was issued"
      }))
    };
  }
  const records = [];
  for (const entry of resolved) {
    if (entry.staged) {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-staged", reason: "member has no session id yet (not spawned)" });
      continue;
    }
    if (entry.agent === undefined) {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-not-live", reason: "no live Agent for this session id" });
      continue;
    }
    const engine = dsh.compactionEngineForAgent(entry.member.id);
    if (engine === undefined || typeof engine.compactNow !== "function") {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-not-live", reason: "the member's scoped context exposes no compaction engine" });
      continue;
    }
    try {
      const result = await engine.compactNow(entry.agent, undefined);
      if (result === null || result === undefined) {
        records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "no-safe-range" });
      } else {
        records.push({
          member: entry.member.name,
          sessionId: entry.member.id,
          outcome: "compacted",
          ...result.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: result.shadowedTokenCount },
          ...result.summarySeq === undefined ? {} : { summarySeq: result.summarySeq }
        });
      }
    } catch (error) {
      const classified = classifyCompactionError(error);
      records.push({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: classified.outcome,
        ...classified.failureCode === undefined ? {} : { failureCode: classified.failureCode },
        error: classified.error
      });
    }
  }
  return { ...base, outcome: "compacted", members: records };
}
function apply(ctx) {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx);
  const log = ctx.logger ?? { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  let terminal = [];
  async function terminalStatuses() {
    if (terminal.length > 0)
      return terminal;
    terminal = await terminalTaskStatuses();
    return terminal;
  }
  const suppressedSinceWrite = new Map;
  function writeOrSkip(workspace, teamId, audit, caller, force) {
    if (audit.outcome === "not-live") {
      try {
        audit.liveAgentIds = dsh.liveAgents().map((agent) => String(agent?.id ?? "")).filter((id) => id !== "").slice(0, 20);
      } catch {}
    }
    if (caller !== undefined)
      audit.caller = caller;
    const previous = readAudits(workspace, teamId).pop();
    if (!force && sameAuditOutcome(previous, audit)) {
      const collapsed = (suppressedSinceWrite.get(teamId) ?? 0) + 1;
      suppressedSinceWrite.set(teamId, collapsed);
      audit.suppressed = collapsed;
      return audit;
    }
    const carried = suppressedSinceWrite.get(teamId) ?? 0;
    if (carried > 0)
      audit.suppressed = carried;
    suppressedSinceWrite.set(teamId, 0);
    writeAudit(workspace, audit);
    return audit;
  }
  async function runPass(workspace, teamId, caller, force = false) {
    const team = readTeamRecord(workspace, teamId);
    if (team === undefined) {
      return writeOrSkip(workspace, teamId, {
        schema: "mpd/team-compact@1",
        teamId,
        teamName: "",
        at: Date.now(),
        outcome: "refused",
        refusedReason: "no readable team record",
        members: [],
        engineResolution: "agent-scoped"
      }, caller, force);
    }
    const audit = await compactTeamPass(dsh, team, { terminal: await terminalStatuses() });
    return writeOrSkip(workspace, teamId, audit, caller, force);
  }
  dsh.onEvent?.("agent/status", async () => {
    try {
      const workspace = dsh.workspaceRoot();
      if (workspace === undefined || workspace === "")
        return;
      for (const teamId of listTeamIds(workspace)) {
        const team = readTeamRecord(workspace, teamId);
        if (team === undefined)
          continue;
        if (!teamIsFinished(team, await terminalStatuses()))
          continue;
        await runPass(workspace, teamId, { via: "status" });
      }
    } catch (error) {
      log.warn?.(`mpd-team-compact: trigger pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  dsh.onEvent?.("agent/turn-stopping", (payload) => {
    try {
      const agent = payload?.agent;
      const sessionId = String(agent?.session?.id ?? "");
      if (sessionId === "")
        return;
      const cwd = String(agent?.session?.header?.cwd ?? "");
      const workspace = cwd !== "" ? cwd : dsh.workspaceRoot();
      if (workspace === undefined || workspace === "")
        return;
      (async () => {
        try {
          for (const teamId of listTeamIds(workspace)) {
            const team = readTeamRecord(workspace, teamId);
            if (team === undefined)
              continue;
            if (!compactableMembers(team).some((member) => member.id === sessionId))
              continue;
            if (!teamIsFinished(team, await terminalStatuses()))
              continue;
            await runPass(workspace, teamId, { via: "turn-end", sessionId, cwd });
          }
        } catch (error) {
          log.warn?.(`mpd-team-compact: turn-boundary pass failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    } catch (error) {
      log.warn?.(`mpd-team-compact: turn-boundary listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  });
  dsh.registerTool({
    name: "mpd_team_compact_run",
    description: "Compact the members of a FINISHED team (every task terminal and every member idle). The captain is never compacted. Writes an audit record under .mpd/team-compact/ and notifies nobody.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to compact. Defaults to every finished team in this workspace." },
        force: { type: "boolean", description: `Write an audit record even when the outcome is identical to the previous one (repeats are otherwise collapsed by the write-on-change rule and counted in the next record's "suppressed").` }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { passes: { type: "array", items: { type: "object" } } } },
      render: (_args, value) => [{
        type: "text",
        text: value.passes.length === 0 ? "No finished team to compact." : value.passes.map((audit) => `${audit.teamId}: ${audit.outcome}${audit.refusedReason === undefined ? "" : ` (${audit.refusedReason})`} — ${audit.members.map((m) => `${m.member}=${m.outcome}`).join(", ") || "no members"}`).join(`
`)
      }]
    },
    async execute(args, exec) {
      const workspace = dsh.workspaceRoot(exec);
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(workspace) : [args.team_id];
      const sessionId = String(exec?.agent?.session?.id ?? "");
      const caller = {
        via: "tool",
        ...sessionId === "" ? {} : { sessionId },
        ...exec?.agent?.session?.header?.cwd === undefined ? {} : { cwd: String(exec.agent.session.header.cwd) }
      };
      const passes = [];
      for (const teamId of ids)
        passes.push(await runPass(workspace, teamId, caller, args?.force === true));
      return { passes };
    }
  });
  dsh.registerTool({
    name: "mpd_team_compact_status",
    description: "Read-only: show the compaction audit for this workspace (one record per pass, newest last), including skipped members and the reason each was skipped.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "Limit to one team. Defaults to every team with an audit." }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { teams: { type: "array", items: { type: "object" } } } },
      render: (_args, value) => {
        if (value.teams.length === 0)
          return [{ type: "text", text: "No compaction audit recorded in this workspace." }];
        return [{ type: "text", text: value.teams.map((entry) => {
          const last = entry.passes[entry.passes.length - 1];
          return `${entry.teamId}: ${entry.passes.length} pass(es); latest ${last?.outcome ?? "?"} at ${last === undefined ? "?" : new Date(last.at).toISOString()}${last?.refusedReason === undefined ? "" : ` (${last.refusedReason})`}`;
        }).join(`
`) }];
      }
    },
    async execute(args, exec) {
      const workspace = dsh.workspaceRoot(exec);
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(workspace) : [args.team_id];
      return { teams: ids.map((teamId) => ({ teamId, passes: readAudits(workspace, teamId) })) };
    }
  });
}
export {
  writeAudit,
  terminalTaskStatuses,
  teamIsFinished,
  sameAuditOutcome,
  readTeamRecord,
  readAudits,
  name,
  listTeamIds,
  isStagedMember,
  inject,
  compactableMembers,
  compactTeamPass,
  classifyCompactionError,
  auditDir,
  apply,
  COMPACTION_FAILURE_CODES
};
