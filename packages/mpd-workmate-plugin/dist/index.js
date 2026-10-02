// packages/mpd-workmate-plugin/src/index.ts
import { existsSync, lstatSync, mkdirSync as mkdirSync2, readFileSync, readdirSync, renameSync as renameSync2, rmSync as rmSync2, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join as join2, resolve as resolve3, sep } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
var LOG_SUBDIR = join(".mpd", "logs");
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_MAX_LINE_BYTES = 8192;
var DEFAULT_RING_LINES = 64;
function truncationMarker(droppedBytes) {
  return ` … [mpd log sink: ${droppedBytes} more byte(s) truncated]`;
}
function resolveLogRoots(env = process.env, cwd) {
  let working = cwd;
  if (working === undefined) {
    try {
      working = process.cwd();
    } catch {
      working = undefined;
    }
  }
  const raw = [env.MPD_MCP_LOG_DIR, env.DSH_WORKSPACE_ROOT, working, tmpdir()];
  const roots = [];
  const seen = new Set;
  for (const candidate of raw) {
    if (typeof candidate !== "string" || candidate.trim().length === 0)
      continue;
    let absolute;
    try {
      absolute = resolve(candidate);
    } catch {
      continue;
    }
    if (seen.has(absolute))
      continue;
    seen.add(absolute);
    roots.push(absolute);
  }
  return roots;
}
function tryOpenRoot(root, name) {
  try {
    const dir = join(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${name}.log`);
    return { fd: openSync(file, "a"), file };
  } catch {
    return null;
  }
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`))
      return root;
  }
  return null;
}
var captured = null;
function openLogSink(name, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const ringLines = options.ringLines ?? DEFAULT_RING_LINES;
  const timestamps = options.timestamps ?? true;
  const roots = options.roots ?? resolveLogRoots(options.env ?? process.env);
  let open = null;
  for (const root of roots) {
    const attempt = tryOpenRoot(root, name);
    if (attempt !== null) {
      open = attempt;
      break;
    }
  }
  let size = 0;
  if (open !== null) {
    try {
      size = statSync(open.file).size;
    } catch {
      size = 0;
    }
  }
  let accepted = 0;
  let droppedCount = 0;
  let rotations = 0;
  const ring = [];
  let undoCapture = null;
  let rebindOutcome = "skipped";
  let rebind = null;
  const remember = (record) => {
    if (ring.length >= ringLines) {
      ring.shift();
      droppedCount += 1;
    }
    ring.push(record);
  };
  const rotate = () => {
    if (open === null)
      return;
    try {
      closeSync(open.fd);
      rmSync(`${open.file}.1`, { force: true });
      renameSync(open.file, `${open.file}.1`);
      open = { fd: openSync(open.file, "a"), file: open.file };
      size = 0;
      rotations += 1;
      sink.rebindNow();
    } catch {
      try {
        open = { fd: openSync(open.file, "a"), file: open.file };
      } catch {
        open = null;
      }
    }
  };
  const append = (record) => {
    if (open === null) {
      remember(record);
      return;
    }
    const bytes = Buffer.byteLength(record, "utf8");
    if (size > 0 && size + bytes > maxBytes)
      rotate();
    if (open === null) {
      remember(record);
      return;
    }
    try {
      writeSync(open.fd, record);
      size += bytes;
    } catch {
      remember(record);
    }
  };
  const acceptedRoot = open === null ? null : owningRoot(roots, open.file);
  const sink = {
    name,
    file: open?.file ?? null,
    root: acceptedRoot,
    write(line) {
      try {
        const body = line.endsWith(`
`) ? line.slice(0, -1) : line;
        const capped = Buffer.byteLength(body, "utf8") > maxLineBytes ? capLine(body, maxLineBytes) : body;
        const record = `${timestamps ? `[${new Date().toISOString()}] ` : ""}${capped}
`;
        accepted += 1;
        append(record);
      } catch {}
    },
    fd() {
      return open?.fd ?? null;
    },
    written() {
      return accepted;
    },
    dropped() {
      return droppedCount;
    },
    rotations() {
      return rotations;
    },
    ring() {
      return [...ring];
    },
    stderrRebind() {
      return rebindOutcome;
    },
    restore() {
      if (undoCapture === null)
        return;
      undoCapture();
      undoCapture = null;
      if (captured === sink)
        captured = null;
    }
  };
  sink.attachCapture = (undo, onRebind) => {
    undoCapture = undo;
    rebind = onRebind;
  };
  sink.rebindNow = () => {
    if (rebind === null)
      return;
    rebindOutcome = rebind();
  };
  sink.setRebindOutcome = (outcome) => {
    rebindOutcome = outcome;
  };
  return sink;
}
function capLine(body, maxLineBytes) {
  const kept = Buffer.from(body, "utf8").subarray(0, maxLineBytes).toString("utf8");
  return kept + truncationMarker(Buffer.byteLength(body, "utf8") - Buffer.byteLength(kept, "utf8"));
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
var DSH_SEAM_TOOLS = "tools";
var DSH_SEAM_SUBAGENTS = "subagents";
function dshSeamInject(...names) {
  return [...names];
}
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
    return resolve2(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
var rowLogSinks = new Map;
function rowLogLine(name, line) {
  try {
    const root = workspaceRootOf(undefined);
    let entry = rowLogSinks.get(name);
    if (entry === undefined || entry.root !== root) {
      entry = { root, sink: openLogSink(name, { roots: [root] }) };
      rowLogSinks.set(name, entry);
    }
    entry.sink.write(line);
  } catch {}
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
        roots.add(resolve2(cwd));
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
  const rowLog = (name, line) => rowLogLine(name, line);
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
      rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: llmCatalog degraded — " + detail);
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
      warnLlmCatalogOnce("listProviders() failed: " + errorMessage(error));
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
  const nativeMembers = new Map;
  const officialMembers = new Map;
  const neverAborted = () => new AbortController().signal;
  const sessionIdOfAgent = (agent) => {
    const session = agent?.session;
    return typeof session?.id === "string" ? session.id : "";
  };
  function nativeTeamExecutor(reason, ready) {
    const subagentsOf = () => service("subagents");
    return {
      kind: "native",
      reason,
      providers: () => {
        try {
          const list = subagentsOf()?.providers;
          if (typeof list !== "function")
            return [];
          const names = list.call(subagentsOf());
          return Array.isArray(names) ? names.filter((entry) => typeof entry === "string") : [];
        } catch {
          return [];
        }
      },
      async spawn(caller, request) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot raise team member "${request.name}"`);
        if (typeof subagents.startContinuable !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no startContinuable() — cannot raise a team member");
        }
        const spec = {
          provider: typeof request.provider === "string" && request.provider !== "" ? request.provider : "spawn",
          label: `${request.name} · ${request.teamId}`,
          request: {
            prompt: textBlock(request.prompt),
            parent: caller,
            ...request.agentOptions === undefined ? {} : { agentOptions: request.agentOptions }
          },
          signal: request.signal ?? neverAborted()
        };
        const started = await subagents.startContinuable.call(subagents, spec);
        const handle = String(started?.childId ?? started?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id`);
        nativeMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name, description: request.description });
        return { handle, executor: "native" };
      },
      async send(caller, handle, content, signal) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot deliver a message to team member "${handle}"`);
        if (typeof subagents.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no sendMessage() — cannot deliver to a team member");
        }
        await subagents.sendMessage.call(subagents, caller, handle, textBlock(content), { signal: signal ?? neverAborted() });
      },
      async interrupt(caller, handle) {
        if (!ready)
          throw new Error(`mpd-dsh-adapter: no team executor is available — ${reason}`);
        const subagents = requireService("subagents", `cannot interrupt team member "${handle}"`);
        if (typeof subagents.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the harness subagents service exposes no interrupt() — cannot interrupt a team member");
        }
        subagents.interrupt.call(subagents, handle, { kind: "ancestor", agent: caller });
      },
      membership(agent) {
        const id = sessionIdOfAgent(agent);
        if (id === "")
          return;
        const entry = nativeMembers.get(id);
        return entry === undefined ? undefined : { teamId: entry.teamId, role: "teammate", name: entry.name };
      },
      members: () => [...nativeMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
  }
  function officialTeamExecutor() {
    return {
      kind: "official",
      reason: "official: the native seams are unavailable, so the mounted Agent Teams service executes the team",
      providers: () => [],
      async spawn(caller, request) {
        const teams = requireService("agentTeams", `cannot raise team member "${request.name}"`);
        if (typeof teams.spawnTeammate !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no spawnTeammate() — cannot raise a team member");
        }
        const spawned = await teams.spawnTeammate.call(teams, caller, {
          name: request.name,
          description: request.description === "" ? request.name : request.description,
          prompt: request.prompt,
          ...request.signal === undefined ? {} : { signal: request.signal }
        });
        const handle = String(spawned?.id ?? spawned?.sessionId ?? spawned?.member?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the official backend raised "${request.name}" but reported no id`);
        officialMembers.set(handle, { teamId: request.teamId, memberId: request.memberId, name: request.name });
        return { handle, executor: "official" };
      },
      async send(caller, handle, content, signal) {
        const teams = requireService("agentTeams", `cannot deliver a message to team member "${handle}"`);
        if (typeof teams.sendMessage !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no sendMessage() — cannot deliver to a team member");
        }
        await teams.sendMessage.call(teams, caller, { target: handle, content: textBlock(content), ...signal === undefined ? {} : { signal } });
      },
      async interrupt(caller, handle) {
        const teams = requireService("agentTeams", `cannot interrupt team member "${handle}"`);
        if (typeof teams.interrupt !== "function") {
          throw new Error("mpd-dsh-adapter: the Agent Teams service exposes no interrupt() — cannot interrupt a team member");
        }
        const target = officialMembers.get(handle)?.name ?? handle;
        teams.interrupt.call(teams, caller, target);
      },
      membership: (agent) => {
        const teams = service("agentTeams");
        const tryMembership = teams?.tryMembership;
        if (typeof tryMembership !== "function")
          return;
        try {
          const membership = tryMembership.call(teams, agent);
          if (membership === undefined || membership === null)
            return;
          const role = membership.role;
          if (role !== "lead" && role !== "teammate")
            return;
          return { teamId: String(membership.id ?? ""), role, name: String(membership.name ?? "") };
        } catch {
          return;
        }
      },
      members: () => [...officialMembers.entries()].map(([handle, entry]) => ({ handle, teamId: entry.teamId, memberId: entry.memberId, name: entry.name }))
    };
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
        teamExecutorNative: typeof subagents?.startContinuable === "function",
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
    rowLog,
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
            submit: (message) => adapter.submitUserTurn(host.agent, message)
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
        return { ok: false, isError: true, error: errorMessage(error) };
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
    teamExecutor() {
      const override = (() => {
        try {
          const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_TEAM_EXECUTOR : undefined;
          return typeof raw === "string" && raw.trim() !== "" ? raw.trim().toLowerCase() : undefined;
        } catch {
          return;
        }
      })();
      const nativeReady = typeof service("subagents")?.startContinuable === "function";
      const officialReady = service("agentTeams") !== undefined;
      const chosen = override === "official" && officialReady ? "official" : override === "native" && nativeReady ? "native" : nativeReady ? "native" : officialReady ? "official" : "native";
      if (chosen === "official")
        return officialTeamExecutor();
      return nativeTeamExecutor(nativeReady ? override === undefined ? "native: the default backend — it needs nothing from the official plugin" : "native: chosen by MPD_DSH_TEAM_EXECUTOR=native" : "native UNAVAILABLE: the harness subagents service exposes no startContinuable(), and no team service is mounted either — every team call will refuse", nativeReady);
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
        rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
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
              rowLogLine("mpd-dsh-adapter", "[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
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
    startAgentTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no followup() — cannot start its next turn");
      followup.call(agent, message);
    },
    cancelAgentTurn(agent, cause, options) {
      const cancel = agent?.cancel;
      if (typeof cancel !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no cancel() — cannot cancel its turn");
      cancel.call(agent, cause, options);
    },
    steerAgentTurn(agent, message) {
      const steer = agent?.steer;
      if (typeof steer !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no steer() — cannot steer its turn");
      steer.call(agent, message);
    },
    injectAgentMessage(agent, message) {
      const inject = agent?.inject;
      if (typeof inject !== "function")
        throw new Error("mpd-dsh-adapter: the agent exposes no inject() — cannot queue a message for it");
      inject.call(agent, message);
    },
    submitUserTurn(agent, message) {
      const followup = agent?.followup;
      if (typeof followup !== "function")
        return false;
      try {
        followup.call(agent, message);
        return true;
      } catch {
        return false;
      }
    }
  };
  return adapter;
}
var SERVICE_NAME = "mpdDsh";
function resolveDshAdapter(ctx) {
  const get = typeof ctx?.get === "function" ? ctx.get : undefined;
  const mounted = get === undefined ? undefined : get.call(ctx, SERVICE_NAME);
  return mounted ?? createDshAdapter(ctx);
}

// packages/mpd-workmate-plugin/src/index.ts
var name = "mpd-workmate";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS);
var PERSONA_CAP = 8 * 1024;
var MEMORY_CAP = 8 * 1024;
var NOTE_CAP = 1536;
var MATCH_THRESHOLD = 0.35;
var READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename"
];

class WorkmateError extends Error {
  code;
  status;
  blocking;
  constructor(code, message, status, blocking = []) {
    super(message);
    this.name = "WorkmateError";
    this.code = code;
    this.status = status;
    this.blocking = blocking;
  }
}
function nameKey(raw, label) {
  const s = String(raw ?? "");
  const key = sanitizeName(s);
  if (s === "" || s !== key || key.length > 255) {
    throw new WorkmateError("invalid-name", `mpd_workmate: invalid ${label} "${s}" — names are ASCII, lowercase, [a-z0-9_-] only and must already be sanitized`, 400);
  }
  return key;
}
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
function now() {
  return new Date().toISOString();
}
function homeDir() {
  return process.env.HOME || homedir();
}
function workmateRoot() {
  return join2(homeDir(), ".mpd", "workmate");
}
var WORKMATE_ALLOW_REAL_HOME_ENV = "MPD_DSH_WORKMATE_ALLOW_REAL_HOME";
function realUserHome() {
  if (process.platform === "win32") {
    const profile = process.env.USERPROFILE;
    if (typeof profile === "string" && profile !== "")
      return profile;
  }
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (uid !== undefined) {
      const line = readFileSync("/etc/passwd", "utf8").split(`
`).find((l) => l.split(":")[2] === String(uid));
      const home = line === undefined ? undefined : line.split(":")[5];
      if (home !== undefined && home !== "")
        return home;
    }
  } catch {}
  try {
    const api = userInfo().homedir;
    if (api !== "" && resolve3(api) !== resolve3(process.env.HOME ?? api))
      return api;
  } catch {}
  return;
}
function assertMutationSandboxed(operation) {
  const dshHome = process.env.DSH_HOME;
  if (dshHome === undefined || dshHome === "")
    return;
  if (process.env[WORKMATE_ALLOW_REAL_HOME_ENV] === "1")
    return;
  const root = workmateRoot();
  const home = process.env.HOME;
  const realHome = realUserHome();
  const inside = (h) => root === h || root.startsWith(h.endsWith(sep) ? h : h + sep);
  if (home !== undefined && home !== "" && realHome !== undefined && resolve3(home) !== resolve3(realHome) && inside(resolve3(home)))
    return;
  throw new WorkmateError("real-home-refused", "mpd_workmate: refusing to " + operation + " inside the REAL library " + root + " while DSH_HOME=" + dshHome + " marks an isolated/QA boot — set HOME=<sandbox> (T-43), or set " + WORKMATE_ALLOW_REAL_HOME_ENV + "=1 to override deliberately" + (realHome === undefined ? " (the real home could not be determined on this host)" : ""), 403);
}
function wmDir(name2) {
  const key = sanitizeName(name2);
  if (key === "")
    throw new WorkmateError("invalid-name", "mpd_workmate: empty workmate name — the library root is not an instance", 400);
  return join2(workmateRoot(), key);
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
    if (!existsSync(join2(dir, "meta.json")))
      return null;
    const m = JSON.parse(readFileSync(join2(dir, "meta.json"), "utf8"));
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask), renamedFrom: Array.isArray(m.renamedFrom) ? m.renamedFrom.map(String) : [] };
  } catch {
    return null;
  }
}
function publicMeta(meta) {
  const out = { ...meta };
  delete out.baseId;
  return out;
}
function writeJson(path, value) {
  mkdirSync2(join2(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + `
`);
}
function indexPath() {
  return join2(workmateRoot(), "index.json");
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
function writeIndex(idx) {
  writeJson(indexPath(), idx);
}
function indexEntryOf(key, meta) {
  return { name: key, baseId: meta.baseId, baseName: meta.baseName, uses: meta.uses, updatedAt: meta.updatedAt };
}
function writeIndexEntry(key, meta) {
  const idx = readIndex();
  idx[key] = indexEntryOf(key, meta);
  writeIndex(idx);
}
function renameIndexKey(oldKey, newKey, meta) {
  const idx = readIndex();
  delete idx[oldKey];
  idx[newKey] = indexEntryOf(newKey, meta);
  writeIndex(idx);
}
function dropIndexKey(key) {
  const idx = readIndex();
  if (!(key in idx))
    return;
  const prev = idx[key];
  delete idx[key];
  writeIndex(idx);
  return prev;
}
function restoreIndexEntry(key, entry) {
  const idx = readIndex();
  idx[key] = entry;
  writeIndex(idx);
}
function readNote(key) {
  try {
    return readFileSync(join2(wmDir(key), "note.md"), "utf8").trim();
  } catch {
    return "";
  }
}
function readMemory(key, tailBytes = MEMORY_CAP) {
  try {
    const t = readFileSync(join2(wmDir(key), "memory.md"), "utf8").trim();
    if (t.length <= tailBytes)
      return t;
    return `…[earlier memory trimmed]…
` + t.slice(-tailBytes);
  } catch {
    return "";
  }
}
function readPersona(key) {
  try {
    return readFileSync(join2(wmDir(key), "persona.md"), "utf8").trim();
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
function appendMemory(key, entry) {
  const path = join2(wmDir(key), "memory.md");
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
function mergePersona(key, revision) {
  const path = join2(wmDir(key), "persona.md");
  const existing = (existsSync(path) ? readFileSync(path, "utf8") : "").trim();
  const merged = capText(existing + (revision ? `

## Persona revision (${now()})
${revision.trim()}` : ""), PERSONA_CAP);
  writeFileSync(path, merged + `
`);
  return merged;
}
function ensureInstance(name2) {
  const key = sanitizeName(name2);
  const dir = wmDir(key);
  const meta = readMeta(dir);
  if (!meta)
    throw new Error(`mpd_workmate: no workmate named "${key}" — run mpd_workmate_init first`);
  return { meta, dir, key };
}
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
function resolveTarget(key) {
  const dir = wmDir(key);
  const st = lstatOrNull(dir);
  if (st == null)
    throw new WorkmateError("unknown", `mpd_workmate: no workmate named "${key}"`, 404);
  if (st.isSymbolicLink())
    throw new WorkmateError("unknown", `mpd_workmate: "${key}" is a symlink — the library refuses to mutate through a link (replace it by hand)`, 404);
  if (!st.isDirectory())
    throw new WorkmateError("unknown", `mpd_workmate: "${key}" is not a directory`, 404);
  const meta = readMeta(dir);
  if (!meta)
    throw new WorkmateError("unknown", `mpd_workmate: "${key}" has no meta.json (orphan directory — remove it by hand)`, 404);
  return { meta, dir };
}
function listInstances() {
  const root = workmateRoot();
  if (!existsSync(root))
    return [];
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join2(root, e.name, "meta.json"))).map((e) => {
    const key = e.name;
    const meta = readMeta(join2(root, key));
    return { name: key, meta, note: readNote(key) };
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
var inUse = new Map;
function inUseCount(key) {
  return inUse.get(key) ?? 0;
}
function noteSpawnStart(key) {
  inUse.set(key, inUseCount(key) + 1);
}
function noteSpawnEnd(key) {
  const left = inUseCount(key) - 1;
  if (left <= 0)
    inUse.delete(key);
  else
    inUse.set(key, left);
}
function busyTeams(key, roots) {
  const hits = [];
  const note = (teamId, memberName) => {
    if (memberName === "" || sanitizeName(memberName) !== key)
      return;
    if (hits.some((hit) => hit.teamId === teamId && hit.member === memberName))
      return;
    hits.push({ teamId, member: memberName });
  };
  const scanRoots = roots && roots.length > 0 ? roots : [workspaceRootOf()];
  for (const root of scanRoots) {
    try {
      const teamRoot = join2(root, ".mpd", "team");
      if (!existsSync(teamRoot))
        continue;
      for (const entry of readdirSync(teamRoot, { withFileTypes: true })) {
        if (!entry.isDirectory())
          continue;
        const file = join2(teamRoot, entry.name, "team.json");
        if (!existsSync(file))
          continue;
        try {
          const team = JSON.parse(readFileSync(file, "utf8"));
          const members = Array.isArray(team?.members) ? team.members : [];
          for (const m of members)
            note(String(team?.id ?? entry.name), typeof m?.name === "string" ? m.name : "");
        } catch {}
      }
    } catch {}
    try {
      const records = join2(root, ".mpd", "team", "teams");
      if (!existsSync(records))
        continue;
      for (const name2 of readdirSync(records)) {
        if (!name2.endsWith(".json"))
          continue;
        try {
          const team = JSON.parse(readFileSync(join2(records, name2), "utf8"));
          if (team?.endedAt !== undefined)
            continue;
          const members = Array.isArray(team?.members) ? team.members : [];
          for (const m of members) {
            if (m?.status === "inactive" || m?.status === "failed")
              continue;
            note(String(team?.teamId ?? name2.replace(/\.json$/, "")), typeof m?.name === "string" ? m.name : "");
          }
        } catch {}
      }
    } catch {}
  }
  return hits;
}
function assertNotBusy(keys, roots) {
  const hits = [];
  const running = [];
  for (const key of keys) {
    for (const h of busyTeams(key, roots)) {
      if (!hits.some((x) => x.teamId === h.teamId && x.member === h.member))
        hits.push(h);
    }
    const n = inUseCount(key);
    if (n > 0)
      running.push(`${key} (${n} in-flight mpd_workmate_spawn)`);
  }
  if (hits.length === 0 && running.length === 0)
    return;
  const parts = [];
  if (hits.length > 0)
    parts.push(`team member(s) ${hits.map((h) => `${h.teamId}/${h.member}`).join(", ")}`);
  if (running.length > 0)
    parts.push(running.join(", "));
  throw new WorkmateError("in-use", `mpd_workmate: ${keys.map((k) => `"${k}"`).join(" / ")} is in use by ${parts.join(" and ")} — archive or retire those teams and let running spawns finish first`, 409, hits);
}
function agentlessRoots(dsh) {
  const all = dsh.workspaceRootsAll();
  return all.length > 0 ? all : [dsh.workspaceRoot()];
}
function compactUtcStamp() {
  return new Date().toISOString().replace(/:/g, "").replace(/\.\d+Z$/, "Z");
}
function archivePathFor(key) {
  const archiveRoot = join2(workmateRoot(), ".archive");
  mkdirSync2(archiveRoot, { recursive: true });
  const stamp = compactUtcStamp();
  let candidate = join2(archiveRoot, `${key}-${stamp}`);
  for (let i = 2;lstatOrNull(candidate) != null && i < 1000; i++)
    candidate = join2(archiveRoot, `${key}-${stamp}-${i}`);
  return candidate;
}
function rewriteNoteIdentity(dir, baseName, oldKey, newKey) {
  const path = join2(dir, "note.md");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const prefix = `${baseName}-based workmate "${oldKey}".`;
  if (!raw.startsWith(prefix))
    return;
  writeFileSync(path, `${baseName}-based workmate "${newKey}".` + raw.slice(prefix.length));
}
function renameWorkmate(nameArg, newNameArg, teamRoots) {
  assertMutationSandboxed("rename a workmate");
  const oldKey = nameKey(nameArg, "name");
  const newKey = nameKey(newNameArg, "new_name");
  if (newKey === oldKey)
    throw new WorkmateError("invalid-name", `mpd_workmate: new_name "${newKey}" equals the current key — nothing to rename`, 400);
  const { meta, dir } = resolveTarget(oldKey);
  const dst = wmDir(newKey);
  if (lstatOrNull(dst) != null)
    throw new WorkmateError("collision", `mpd_workmate: rename target "${newKey}" already exists`, 409);
  assertNotBusy([oldKey, newKey], teamRoots);
  const renamedFrom = unique([...meta.renamedFrom, oldKey]).slice(-10);
  const nextMeta = { ...meta, name: newKey, renamedFrom, updatedAt: now() };
  renameSync2(dir, dst);
  try {
    writeFileSync(join2(dst, "meta.json"), JSON.stringify(nextMeta, null, 2) + `
`);
    renameIndexKey(oldKey, newKey, nextMeta);
  } catch (e) {
    try {
      renameSync2(dst, dir);
    } catch {}
    throw new WorkmateError("internal", `mpd_workmate: rename of "${oldKey}" failed (${String(e?.code ?? "error")}) and was rolled back`, 500);
  }
  try {
    rewriteNoteIdentity(dst, meta.baseName, oldKey, newKey);
  } catch {}
  return { ok: true, name: newKey, from: oldKey, renamedFrom };
}
function deleteWorkmate(nameArg, purgeArg, confirmArg, teamRoots) {
  assertMutationSandboxed("delete a workmate");
  const key = nameKey(nameArg, "name");
  const purge = purgeArg === true;
  if (purge && String(confirmArg ?? "") !== key) {
    throw new WorkmateError("confirm-required", `mpd_workmate: purging "${key}" requires confirm to equal the name exactly`, 400);
  }
  const { dir } = resolveTarget(key);
  assertNotBusy([key], teamRoots);
  let previous;
  let removed = false;
  try {
    previous = dropIndexKey(key);
    if (purge) {
      const stash = join2(workmateRoot(), ".archive", `.purging-${key}-${compactUtcStamp()}`);
      mkdirSync2(join2(workmateRoot(), ".archive"), { recursive: true });
      renameSync2(dir, stash);
      removed = true;
      rmSync2(stash, { recursive: true, force: true });
      return { ok: true, name: key, archived: null, purged: true };
    }
    const archived = archivePathFor(key);
    renameSync2(dir, archived);
    removed = true;
    return { ok: true, name: key, archived, purged: false };
  } catch (e) {
    if (!removed && previous !== undefined) {
      try {
        restoreIndexEntry(key, previous);
      } catch {}
    }
    const fate = removed ? "the workmate left the library but leftover bytes may remain under the archive directory" : "the workmate is unchanged";
    throw new WorkmateError("internal", `mpd_workmate: delete of "${key}" failed (${String(e?.code ?? "error")}) — ${fate}`, 500);
  }
}
function apply(ctx) {
  const dsh = resolveDshAdapter(ctx);
  function rolesService() {
    return ctx.get ? ctx.get("mpdRoles") : undefined;
  }
  function normalizeBaseKey(s) {
    return String(s ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  }
  function resolveBase(key) {
    const roles = rolesService();
    if (!roles)
      throw new Error("mpd_workmate: mpdRoles service unavailable (mpd-roles-plugin not mounted)");
    const k = String(key ?? "").trim();
    if (!k)
      throw new Error(`mpd_workmate: base required (the specialist's functional name, e.g. "Deep Worker")`);
    const all = typeof roles.list === "function" ? roles.list() : [];
    const wanted = normalizeBaseKey(k);
    const base = all.find((r) => normalizeBaseKey(String(r?.name ?? "")) === wanted);
    if (!base) {
      const names = all.map((r) => String(r?.name ?? "")).filter((n) => n !== "");
      throw new Error(`mpd_workmate: unknown base — use a functional NAME from mpd_roles_list (${names.join(", ")})`);
    }
    return { id: String(base.id), name: String(base.name), description: String(base.description ?? ""), readonly: Boolean(base.readonly), provider: base.chain?.[0]?.provider ?? "deepseek-official", model: base.chain?.[0]?.model ?? "", persona: String(base.persona ?? "") };
  }
  function initWorkmate(baseKey, nameArg, noteArg) {
    assertMutationSandboxed("initialize a workmate");
    const base = resolveBase(baseKey);
    const given = sanitizeName(nameArg);
    let name2 = given;
    if (!name2) {
      const slug = sanitizeName(base.name) || "workmate";
      const existing = listInstances();
      let n = existing.filter((i) => i.meta.baseId === base.id).length + 1;
      while (existing.some((i) => i.name === `${slug}-${n}`))
        n += 1;
      name2 = `${slug}-${n}`;
    }
    const dir = wmDir(name2);
    if (existsSync(dir))
      throw new Error(`mpd_workmate: "${name2}" already exists — pick another name or reuse it via mpd_workmate_spawn`);
    mkdirSync2(dir, { recursive: true });
    const meta = { name: name2, baseId: base.id, baseName: base.name, description: base.description, provider: base.provider, model: base.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null, renamedFrom: [] };
    writeFileSync(join2(dir, "meta.json"), JSON.stringify(meta, null, 2) + `
`);
    writeFileSync(join2(dir, "persona.md"), capText(base.persona, PERSONA_CAP) + `
`);
    writeFileSync(join2(dir, "memory.md"), "");
    const note = capText(String(noteArg ?? "").trim() || autoNote(meta, base.persona, ""), NOTE_CAP);
    writeFileSync(join2(dir, "note.md"), note + `
`);
    writeIndexEntry(name2, meta);
    return { name: name2, baseName: base.name, readonly: base.readonly, provider: base.provider, model: base.model, path: dir, note };
  }
  const workmateLibrary = {
    list: () => listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, updatedAt: meta.updatedAt, renamedFrom: meta.renamedFrom, note })),
    get: (name2) => {
      try {
        const { meta, key } = ensureInstance(name2);
        return { ...publicMeta(meta), name: key, note: readNote(key) };
      } catch {
        return null;
      }
    },
    read: (name2) => {
      try {
        const { meta, key } = ensureInstance(name2);
        return { ...publicMeta(meta), name: key, persona: readPersona(key), memory: readMemory(key), note: readNote(key) };
      } catch {
        return null;
      }
    },
    rename: (name2, newName, roots) => renameWorkmate(name2, newName, roots ?? agentlessRoots(dsh)),
    delete: (name2, purge = false, confirm = "", roots) => deleteWorkmate(name2, purge, confirm, roots ?? agentlessRoots(dsh))
  };
  ctx.provide("mpdWorkmate", workmateLibrary);
  dsh.registerTool({
    name: "mpd_workmate_list",
    description: "List the workmate library (~/.mpd/workmate): each durable evolving agent instance with its base specialist, use count, last-updated time and note summary. Use before delegating a task: if a workmate's note matches well you can reuse it; otherwise initialize a new one.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { workmates: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["workmates", "count"], additionalProperties: false }, render: (_a, v) => textBlock("workmates (" + v.count + `):
` + v.workmates.map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " :: " + String(w.note).slice(0, 140)).join(`
`) || "(empty)") },
    execute: async () => {
      const list = listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, renamedFrom: meta.renamedFrom, note }));
      return { workmates: list, count: list.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_init",
    description: `Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = the specialist's functional NAME (mpd_roles_list), e.g. "Deep Worker". The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.`,
    parameters: { type: "object", properties: { base: { type: "string", description: `the specialist's functional name (e.g. "Deep Worker")` }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated from the functional name if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a, v) => textBlock("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + `)
note: ` + v.note) },
    execute: async (args) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""))
  });
  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a one-shot subagent carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). The subagent must call mpd_workmate_reflect with a self-summary before finishing. For team work, instead add a member whose name equals the workmate name (its persona/memory are injected automatically).",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a, v) => textBlock("workmate " + v.name + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "")) },
    execute: async (args, exec) => {
      const { meta, key } = ensureInstance(String(args?.name ?? ""));
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_workmate_spawn: task required");
      const persona = readPersona(key);
      const memory = readMemory(key);
      const note = readNote(key);
      const prompt = persona + `

Your independent memory (bounded, latest first):
` + (memory || "(empty — you are a fresh workmate)") + `

Workmate note:
` + (note || "(none)") + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only workmates must never modify anything).` + " BEFORE your final report, call mpd_workmate_reflect with a concise self-summary (task / outcome / what you learned / optional persona_delta / optional new note) so your workmate persona and memory evolve. Then end with ONLY the structured report (name/summary/recommendation/details/evidence).";
      noteSpawnStart(key);
      try {
        const result = await dsh.spawnAgent({
          label: key,
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
        return { name: key, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
      } finally {
        noteSpawnEnd(key);
      }
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_reflect",
    description: "Self-evolve a workmate after a completed work session: append a bounded memory entry (oldest evicted past the cap), merge an optional persona revision, regenerate its short note, and bump the use count. Call this at the end of every task a workmate did — the workmate itself is instructed to do so; the caller may also call it on its behalf.",
    parameters: { type: "object", properties: { name: { type: "string" }, task: { type: "string" }, outcome: { type: "string" }, persona_delta: { type: "string", description: "optional persona revision text (merged, capped)" }, note: { type: "string", description: "optional replacement note card; auto-generated if omitted" } }, required: ["name", "task", "outcome"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, uses: { type: "integer" }, personaChars: { type: "integer" }, memoryChars: { type: "integer" }, noteChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false }, render: (_a, v) => textBlock("workmate " + v.name + " reflected (uses=" + v.uses + ", persona " + v.personaChars + "B / memory " + v.memoryChars + "B / note " + v.noteChars + "B)") },
    execute: async (args) => {
      assertMutationSandboxed("reflect a workmate");
      const { meta, key } = ensureInstance(String(args?.name ?? ""));
      const task = String(args?.task ?? "").trim();
      const outcome = String(args?.outcome ?? "").trim();
      if (!task || !outcome)
        throw new Error("mpd_workmate_reflect: task and outcome required");
      appendMemory(key, `## ${now()} — ${capText(task, 200)}
${capText(outcome, 1200)}`);
      const persona = mergePersona(key, String(args?.persona_delta ?? "").trim());
      const memory = readMemory(key);
      meta.uses += 1;
      meta.lastTask = task;
      meta.updatedAt = now();
      meta.name = key;
      writeFileSync(join2(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + `
`);
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(key)), NOTE_CAP);
      writeFileSync(join2(wmDir(key), "note.md"), note + `
`);
      writeIndexEntry(key, meta);
      return { name: key, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a, v) => textBlock((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + `
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
        return { name: name2, score: Math.round(score * 100) / 100, baseName: meta.baseName, readonly: meta.readonly, uses: meta.uses, note };
      }).sort((a, b) => b.score - a.score);
      const best = matches[0];
      const matched = !!best && best.score >= MATCH_THRESHOLD;
      return { matched, threshold: MATCH_THRESHOLD, matches, suggestion: matched ? `Delegate to "${best.name}" (score ${best.score}).` : "No note matches well enough — initialize a NEW workmate with mpd_workmate_init instead of forcing a weak match." };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_rename",
    description: "Rename a workmate instance: MOVES its evolved identity (directory key, metadata, index key, note self-reference, previous-name history) instead of re-instantiating it — persona, memory, caps, use count and history are preserved byte-for-byte. Refused while the workmate is in use by a team member or an in-flight spawn, and refused if the target name already exists. Names are ASCII [a-z0-9_-] only: uppercase, CJK, spaces and punctuation are rejected before anything is touched.",
    parameters: { type: "object", properties: { name: { type: "string", description: "current workmate name (its directory key)" }, new_name: { type: "string", description: "new name — ASCII, lowercase, [a-z0-9_-]" } }, required: ["name", "new_name"], additionalProperties: false },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" }, from: { type: "string" }, renamedFrom: { type: "array", items: { type: "string" } } }, required: ["ok", "name", "from"], additionalProperties: false }, render: (_a, v) => textBlock('workmate "' + v.from + '" renamed to "' + v.name + '"' + (Array.isArray(v.renamedFrom) && v.renamedFrom.length ? `
previous names: ` + v.renamedFrom.join(", ") : "")) },
    execute: async (args, exec) => renameWorkmate(args?.name, args?.new_name, [dsh.workspaceRoot(exec)])
  });
  dsh.registerTool({
    name: "mpd_workmate_delete",
    description: "Delete a workmate instance. ARCHIVE-FIRST by default: the instance leaves the library (no longer listed or matchable, and restorable) into ~/.mpd/workmate/.archive/. Real removal requires purge: true together with confirm set to the exact name — without both, nothing is destroyed. Refused while the workmate is in use by a team member or an in-flight spawn.",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate name to delete" }, purge: { type: "boolean", description: "true = permanently remove instead of archiving (requires confirm)" }, confirm: { type: "string", description: "must equal name exactly when purge is true" } }, required: ["name"], additionalProperties: false },
    output: { schema: { type: "object", properties: { ok: { type: "boolean" }, name: { type: "string" }, archived: { oneOf: [{ type: "string" }, { type: "null" }] }, purged: { type: "boolean" } }, required: ["ok", "name", "archived", "purged"], additionalProperties: false }, render: (_a, v) => textBlock('workmate "' + v.name + '" ' + (v.purged ? "PURGED (permanently removed)" : "archived (gone from the library, still restorable)")) },
    execute: async (args, exec) => deleteWorkmate(args?.name, args?.purge, args?.confirm, [dsh.workspaceRoot(exec)])
  });
  let webRegistered = false;
  const registerWebSurface = () => {
    if (webRegistered)
      return;
    const webServer = typeof dsh.webServerOf === "function" ? dsh.webServerOf() : undefined;
    if (webServer === undefined || typeof ctx.effect !== "function")
      return;
    webRegistered = true;
    const json = (res, status, body, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
      res.end(JSON.stringify(body));
    };
    const failure = (res, e) => {
      if (e instanceof WorkmateError) {
        json(res, e.status, { error: e.message, reason: e.code, ...e.blocking.length > 0 ? { blocking: e.blocking } : {} });
        return;
      }
      json(res, 500, { error: `mpd_workmate: internal error (${String(e?.code ?? "error")})`, reason: "internal" });
    };
    const readBody = async (req) => {
      let raw = "";
      for await (const chunk of req)
        raw += String(chunk);
      try {
        return { ok: true, body: raw ? JSON.parse(raw) : {} };
      } catch {
        return { ok: false };
      }
    };
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/list",
      handler: async (_req, res) => {
        const list = listInstances().map(({ name: name2, meta, note }) => ({ name: name2, baseName: meta.baseName, readonly: meta.readonly, provider: meta.provider, model: meta.model, uses: meta.uses, updatedAt: meta.updatedAt, lastTask: meta.lastTask, renamedFrom: meta.renamedFrom, note }));
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
          bases = (typeof roles?.list === "function" ? roles.list() : []).map((r) => ({ name: String(r.name), description: String(r.description ?? ""), readonly: Boolean(r.readonly) }));
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
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/rename",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end();
          return;
        }
        const parsed = await readBody(req);
        if (!parsed.ok)
          return json(res, 400, { error: "invalid JSON" });
        try {
          json(res, 200, renameWorkmate(parsed.body?.name, parsed.body?.new_name, agentlessRoots(dsh)));
        } catch (e) {
          failure(res, e);
        }
      }
    }), "mpd-workmate: rename route");
    ctx.effect(() => webServer.register({
      kind: "exact",
      path: "/plugins/mpd-workmate/delete",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end();
          return;
        }
        const parsed = await readBody(req);
        if (!parsed.ok)
          return json(res, 400, { error: "invalid JSON" });
        try {
          json(res, 200, deleteWorkmate(parsed.body?.name, parsed.body?.purge, parsed.body?.confirm, agentlessRoots(dsh)));
        } catch (e) {
          failure(res, e);
        }
      }
    }), "mpd-workmate: delete route");
  };
  registerWebSurface();
  if (typeof ctx.on === "function") {
    dsh.onServiceBound(["webServer", "httpServer"], () => {
      registerWebSurface();
    });
  }
}
export {
  MATCH_THRESHOLD,
  MEMORY_CAP,
  NOTE_CAP,
  PERSONA_CAP,
  READONLY_DENY,
  WORKMATE_ALLOW_REAL_HOME_ENV,
  WorkmateError,
  apply,
  assertMutationSandboxed,
  autoNote,
  busyTeams,
  capText,
  deleteWorkmate,
  inject,
  name,
  nameKey,
  renameWorkmate,
  sanitizeName,
  scoreMatch
};
