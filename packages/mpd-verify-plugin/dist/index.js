// packages/mpd-verify-plugin/src/index.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join6 } from "node:path";

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
var GOAL_TOOL_NAMES = ["get_goal", "create_goal", "update_goal"];
function goalSnapshotOf(view) {
  if (view === null || view === undefined || typeof view !== "object")
    return;
  const raw = view;
  if (typeof raw.id !== "string" || raw.id === "")
    return;
  const snapshot = {
    id: raw.id,
    revision: typeof raw.revision === "number" ? raw.revision : 0,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    phase: raw.phase === "paused" || raw.phase === "blocked" || raw.phase === "complete" ? raw.phase : "active",
    maxGoalRounds: typeof raw.maxGoalRounds === "number" ? raw.maxGoalRounds : 0
  };
  if (typeof raw.roundsStarted === "number")
    snapshot.roundsStarted = raw.roundsStarted;
  if (raw.activation === "armed" || raw.activation === "disarmed")
    snapshot.activation = raw.activation;
  const reason = raw.blockedReason;
  if (reason !== null && typeof reason === "object") {
    const code = reason.code;
    const message = reason.message;
    if (typeof code === "string" && code !== "" && typeof message === "string" && message !== "") {
      snapshot.blockedReason = { code, message };
    }
  }
  return snapshot;
}
function goalValueOf(value) {
  if (value === null || value === undefined || typeof value !== "object")
    return { goal: null };
  const raw = value;
  const activation = raw.activation === "armed" || raw.activation === "disarmed" ? raw.activation : undefined;
  const goal = goalSnapshotOf(raw.goal);
  if (goal === undefined)
    return activation === undefined ? { goal: null } : { goal: null, activation };
  if (activation !== undefined)
    goal.activation = activation;
  return activation === undefined ? { goal } : { goal, activation };
}
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
  const engineCache = new WeakMap;
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agent = liveAgent(id);
    if (agent === undefined || agent === null)
      return;
    const cached = engineCache.get(agent);
    if (cached !== undefined)
      return cached;
    const scoped = agent.ctx;
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
    engineCache.set(agent, engine);
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
  function scopedToolRegistry(agent) {
    const scope = scopeOfAgentContext(agent);
    if (scope === undefined)
      return;
    try {
      const tools = scope.context?.tools;
      return typeof tools?.execute === "function" ? tools : undefined;
    } catch {
      return;
    }
  }
  function hostToolDefinition(name) {
    try {
      const hostView = service("tools");
      return typeof hostView?.get === "function" ? hostView.get(name) : undefined;
    } catch {
      return;
    }
  }
  function toolDefinitionFor(name, agent) {
    if (agent === undefined)
      return hostToolDefinition(name);
    const scoped = scopedToolRegistry(agent);
    if (scoped === undefined)
      return hostToolDefinition(name);
    try {
      return scoped.get(name, agent);
    } catch {
      return;
    }
  }
  function toolReachable(name) {
    if (hostToolDefinition(name) !== undefined)
      return true;
    return liveAgents().some((candidate) => toolDefinitionFor(name, candidate) !== undefined);
  }
  function projectToolResult(raw) {
    const record = raw;
    if (record?.isError === true) {
      const error = record.error;
      return { ok: false, isError: true, error: error?.message ?? error ?? "tool error", raw };
    }
    return { ok: true, isError: false, value: record?.value, raw };
  }
  async function executeToolForAgent(input) {
    const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
    const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
    const scoped = input.agent === undefined ? undefined : scopedToolRegistry(input.agent);
    if (scoped !== undefined) {
      try {
        const raw = await scoped.execute({
          name: input.name,
          arguments: input.arguments ?? {},
          callId,
          ...signal === undefined ? {} : { signal },
          ...input.agent === undefined ? {} : { agent: input.agent }
        });
        return { result: projectToolResult(raw), via: "agent-scope" };
      } catch (error) {
        return { result: { ok: false, isError: true, error: errorMessage(error) }, via: "agent-scope" };
      }
    }
    const result = await adapter.executeTool({
      name: input.name,
      arguments: input.arguments ?? {},
      callId,
      ...signal === undefined ? {} : { signal },
      ...input.agent === undefined ? {} : { agent: input.agent },
      ...input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }
    });
    return { result, via: "host-plane" };
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
      const goalService = service("goals");
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
        subagentsProviderRegister: typeof subagents?.registerProvider === "function",
        goals: typeof goalService?.get === "function",
        goalTools: GOAL_TOOL_NAMES.every((goalToolName) => toolReachable(goalToolName))
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
    goalState(agent) {
      const goals = service("goals");
      if (goals === undefined || typeof goals.get !== "function")
        return;
      try {
        const view = goals.get(agent);
        return goalSnapshotOf(view) ?? null;
      } catch {
        return;
      }
    },
    async goalControl(input) {
      if (input === null || typeof input !== "object" || typeof input.action !== "string") {
        return { ok: false, isError: true, error: "goalControl requires an action" };
      }
      if (input.agent === undefined)
        return { ok: false, isError: true, error: "goal tools require a calling agent" };
      let goalId = input.goalId;
      let revision = input.revision;
      const needsRef = input.action !== "create" && input.action !== "read";
      if (needsRef && (goalId === undefined || revision === undefined)) {
        const current = await executeToolForAgent({ name: "get_goal", agent: input.agent, callId: input.callId, signal: input.signal, timeoutMs: input.timeoutMs });
        if (!current.result.ok)
          return { ok: false, isError: true, error: current.result.error, via: current.via, raw: current.result.raw };
        const read = goalValueOf(current.result.value);
        if (read.goal === null)
          return { ok: false, isError: true, error: "no current goal", via: current.via, raw: current.result.raw };
        goalId = goalId ?? read.goal.id;
        revision = revision ?? read.goal.revision;
      }
      const toolName = input.action === "read" ? "get_goal" : input.action === "create" ? "create_goal" : "update_goal";
      const toolArguments = input.action === "read" ? {} : input.action === "create" ? { objective: input.objective, ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds } } : {
        goal_id: goalId,
        revision,
        action: input.action,
        ...input.objective === undefined ? {} : { objective: input.objective },
        ...input.maxGoalRounds === undefined ? {} : { max_goal_rounds: input.maxGoalRounds },
        ...input.blockedReason === undefined ? {} : { blocked_reason: input.blockedReason }
      };
      if (input.action === "create" && (typeof input.objective !== "string" || input.objective.trim() === "")) {
        return { ok: false, isError: true, error: "goalControl create requires a non-empty objective" };
      }
      if (needsRef && (goalId === undefined || revision === undefined)) {
        return { ok: false, isError: true, error: "goalControl " + input.action + " requires an exact goal id and revision" };
      }
      const call = await executeToolForAgent({
        name: toolName,
        arguments: toolArguments,
        agent: input.agent,
        callId: input.callId,
        signal: input.signal,
        timeoutMs: input.timeoutMs
      });
      if (!call.result.ok)
        return { ok: false, isError: call.result.isError, error: call.result.error, via: call.via, raw: call.result.raw };
      const value = goalValueOf(call.result.value);
      return {
        ok: true,
        isError: false,
        goal: value.goal,
        ...value.activation === undefined ? {} : { activation: value.activation },
        via: call.via,
        raw: call.result.raw
      };
    },
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
    hasTool(toolName, agent) {
      return toolDefinitionFor(toolName, agent) !== undefined;
    },
    toolRuntime() {
      return {
        get: (toolName, agent) => toolDefinitionFor(toolName, agent),
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
        return projectToolResult(raw);
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
var ADAPTER_IDENTITY_FALLBACK = "fallback:createDshAdapter";
function adapterPendingWarning() {
  return "ADAPTER NOT YET ACTIVE: " + SERVICE_NAME + " is registered in this composition but its provider fiber" + " is not ACTIVE yet (the loader applies sibling rows concurrently; cordis answers undefined for a non-ACTIVE" + " provider). This call is served by a TEMPORARY adapter and every later call re-probes, so the mounted" + " adapter is picked up as soon as it activates — this transient miss needs NO row-order change (T-50).";
}
function adapterFallbackWarning() {
  return "ADAPTER FALLBACK (adapterIdentity=" + ADAPTER_IDENTITY_FALLBACK + "): " + SERVICE_NAME + " is not provided" + " in this composition, so this row built its OWN adapter beside the tree's: it bypasses the mounted adapter" + " (the one-contact-surface rule, AGENTS.md §6), it does NOT inherit the adapter row's config (defaultTimeoutMs)" + " and it keeps its own per-instance caches (the per-agent compaction-engine memo). This boot keeps working," + " which is exactly why the branch is loud — fix the ROW ORDER (this row must sit BELOW mpd-dsh-adapter); the" + " canonical note lives in packages/mpd-ext-plugin/src/index.ts (resolveAdapter).";
}
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
function createLazyDshAdapter(ctx, options) {
  const warning = (line) => {
    try {
      (options.warn ?? ((text) => rowLogLine("mpd-dsh-adapter", "[" + options.label + "] " + text)))(line);
    } catch {}
  };
  let mounted;
  let temporary;
  let warnedPending = false;
  let warnedMissing = false;
  const resolve3 = () => {
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
        warning(adapterPendingWarning());
      }
      return temporary;
    }
    if (!warnedMissing) {
      warnedMissing = true;
      warning(adapterFallbackWarning());
    }
    return temporary;
  };
  return new Proxy({}, {
    get(_target, property) {
      const impl = resolve3();
      const value = impl[property];
      return typeof value === "function" ? value.bind(impl) : value;
    },
    has(_target, property) {
      return property in resolve3();
    }
  });
}

// packages/mpd-verify-plugin/src/service.ts
var VERIFY_SERVICE = "mpdVerify";

// packages/mpd-verify-plugin/src/law.ts
var GATED_WRITE_TOOLS = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan"
];
var DEFAULT_CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".cmd",
  ".bat",
  ".py",
  ".rs",
  ".go",
  ".css",
  ".html",
  ".vue",
  ".sql"
];
var CODE_BASENAMES = ["Dockerfile", "Makefile"];
var ALWAYS_WRITABLE_PREFIXES = [".mpd/", "docs/", "evidence/", "agent-references/"];
var PATH_ARG_KEYS = ["file_path", "path", "filePath", "target"];
function readTargetPath(toolName, args) {
  if (toolName === "mcp__ast_grep__rewrite") {
    const paths = args?.paths;
    if (Array.isArray(paths) && typeof paths[0] === "string")
      return paths[0];
  }
  for (const key of PATH_ARG_KEYS) {
    const value = args?.[key];
    if (typeof value === "string" && value !== "")
      return value;
  }
  return;
}
function classifyWriteTarget(workspaceRoot, raw, extensions = DEFAULT_CODE_EXTENSIONS) {
  if (typeof raw !== "string" || raw === "")
    return { kind: "pass", raw: String(raw ?? "") };
  const root = toPosix(workspaceRoot).replace(/\/+$/, "");
  const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw);
  const posixRaw = toPosix(raw);
  let rel;
  if (!absolute)
    rel = stripLeadingDot(posixRaw);
  else if (root !== "" && posixRaw.startsWith(root + "/"))
    rel = posixRaw.slice(root.length + 1);
  if (rel === undefined)
    return { kind: "code", raw, outside: true };
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  if (ALWAYS_WRITABLE_PREFIXES.some((prefix) => rel.startsWith(prefix)))
    return { kind: "always", raw, rel };
  if (ALWAYS_WRITABLE_PREFIXES.some((prefix) => rel === prefix.replace(/\/$/, "")))
    return { kind: "always", raw, rel };
  if (/\.mdx?$/i.test(base) || /^LICENSE/i.test(base))
    return { kind: "always", raw, rel };
  if (anyAlwaysWritableSegment(rel))
    return { kind: "always", raw, rel };
  if (CODE_BASENAMES.includes(base))
    return { kind: "code", raw, rel };
  const dot = base.lastIndexOf(".");
  const ext = dot <= 0 ? "" : base.slice(dot).toLowerCase();
  return { kind: "code", raw, rel, ...ext !== "" && extensions.includes(ext) ? { declared: true } : {} };
}
function anyAlwaysWritableSegment(rel) {
  const segments = rel.split("/");
  return segments.some((segment) => ["docs", "evidence", "agent-references", ".mpd"].includes(segment));
}
function toPosix(value) {
  return String(value ?? "").replace(/\\/g, "/");
}
function stripLeadingDot(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}
function sessionKeyOf(agent) {
  const view = agent;
  const candidates = [view?.session?.id, view?.sessionId, view?.id];
  for (const candidate of candidates)
    if (typeof candidate === "string" && candidate !== "")
      return candidate;
  return "workspace";
}
function resolveVerifyMode(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "off")
    return "off";
  if (value === "advisory")
    return "advisory";
  return "hard";
}
function resolvePositiveInt(raw, fallback) {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// packages/mpd-verify-plugin/src/observe.ts
import { join as join3 } from "node:path";

// packages/mpd-verify-plugin/src/ledger.ts
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync as mkdirSync2, readFileSync, readdirSync, renameSync as renameSync2, statSync as statSync2, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
function verifyRoot(workspace) {
  return join2(workspace, ".mpd", "verify");
}
function loopsDir(workspace) {
  return join2(verifyRoot(workspace), "loops");
}
function recordsDir(workspace) {
  return join2(verifyRoot(workspace), "records");
}
function evidenceDir(workspace) {
  return join2(verifyRoot(workspace), "evidence");
}
function repairsDir(workspace) {
  return join2(verifyRoot(workspace), "repairs");
}
function seatsPath(workspace) {
  return join2(verifyRoot(workspace), "seats.json");
}
function escapePath(workspace) {
  return join2(verifyRoot(workspace), "escape.jsonl");
}
function ensureDir(dir) {
  try {
    mkdirSync2(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
function readJson(path) {
  try {
    if (!existsSync(path))
      return;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}
function writeJsonAtomic(path, value) {
  try {
    ensureDir(join2(path, ".."));
    const tmp = path + ".tmp-" + randomBytes(4).toString("hex");
    writeFileSync(tmp, JSON.stringify(value, null, 2) + `
`, "utf8");
    renameSync2(tmp, path);
    return true;
  } catch {
    return false;
  }
}
function listJson(dir) {
  const values = [];
  try {
    if (!existsSync(dir))
      return values;
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
      const value = readJson(join2(dir, name));
      if (value !== undefined)
        values.push(value);
    }
  } catch {}
  return values;
}
function mintId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("Z", "");
  return prefix + "-" + stamp + "-" + randomBytes(3).toString("hex");
}
function sha256File(path) {
  try {
    if (!existsSync(path) || !statSync2(path).isFile())
      return "";
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "";
  }
}
function sha256Text(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}
function hashDoc(workspace, path) {
  const digest = sha256File(path);
  if (digest === "")
    return;
  const rel = path.startsWith(workspace + "/") ? path.slice(workspace.length + 1) : path;
  return { path: rel, sha256: digest };
}
function readLoops(workspace) {
  return listJson(loopsDir(workspace));
}
function writeLoop(workspace, loop) {
  return writeJsonAtomic(join2(loopsDir(workspace), loop.loopId + ".json"), loop);
}
function readRecords(workspace) {
  return listJson(recordsDir(workspace));
}
function writeRecord(workspace, record) {
  return writeJsonAtomic(join2(recordsDir(workspace), record.recordId + ".json"), record);
}
function writeEvidence(workspace, meta, log) {
  const wroteLog = log === undefined ? true : (() => {
    try {
      ensureDir(evidenceDir(workspace));
      writeFileSync(join2(evidenceDir(workspace), meta.evidenceId + ".log"), log, "utf8");
      return true;
    } catch {
      return false;
    }
  })();
  return writeJsonAtomic(join2(evidenceDir(workspace), meta.evidenceId + ".json"), meta) && wroteLog;
}
function readEvidence(workspace) {
  return listJson(evidenceDir(workspace));
}
function writeRepair(workspace, repair) {
  return writeJsonAtomic(join2(repairsDir(workspace), repair.repairId + ".json"), repair);
}
function readSeats(workspace) {
  return readJson(seatsPath(workspace)) ?? { version: 1, seats: {} };
}
function writeSeats(workspace, seats) {
  return writeJsonAtomic(seatsPath(workspace), seats);
}
function appendEscape(workspace, sessionId, reason, path) {
  const prior = readEscapes(workspace).filter((row2) => row2.sessionId === sessionId).length;
  const row = {
    version: 1,
    at: new Date().toISOString(),
    sessionId,
    reason,
    count: prior + 1,
    ...path === undefined ? {} : { path }
  };
  try {
    ensureDir(verifyRoot(workspace));
    writeFileSync(escapePath(workspace), JSON.stringify(row) + `
`, { encoding: "utf8", flag: "a" });
    return row;
  } catch {
    return;
  }
}
function readEscapes(workspace) {
  const rows = [];
  try {
    if (!existsSync(escapePath(workspace)))
      return rows;
    for (const line of readFileSync(escapePath(workspace), "utf8").split(`
`)) {
      if (line.trim() === "")
        continue;
      try {
        rows.push(JSON.parse(line));
      } catch {}
    }
  } catch {}
  return rows;
}

// packages/mpd-verify-plugin/src/observe.ts
var DELEGATION_TOOLS = [
  "spawn_teammate",
  "team_task_create",
  "team_task_update",
  "mpd_role_spawn",
  "mpd_workmate_spawn",
  "mpd_ultrawork",
  "mpd_ulw",
  "subagent",
  "subagent_fork",
  "workflow",
  "ralph",
  "agent_teams_plan",
  "agent_teams_dispatch"
];
function createVerifyRuntime(options) {
  const calls = [];
  const firstCodeRead = new Map;
  const escapes = new Map;
  const counted = new Map;
  const delegations = [];
  const countedOf = (sessionId) => {
    const existing = counted.get(sessionId);
    if (existing !== undefined)
      return existing;
    const created = new Map;
    counted.set(sessionId, created);
    return created;
  };
  return {
    keyOf(agent) {
      return sessionKeyOf(agent);
    },
    noteCall(exec) {
      try {
        const toolName = String(exec?.name ?? "");
        if (toolName === "")
          return;
        const sessionId = sessionKeyOf(exec?.agent);
        const args = exec?.arguments;
        const raw = readTargetPath(toolName, args);
        const target = raw === undefined ? undefined : classifyWriteTarget(options.dsh.workspaceRoot(exec), raw);
        const code = target?.kind === "code";
        calls.push({ sessionId, toolName, ...target?.rel === undefined ? {} : { path: target.rel }, code, at: new Date().toISOString() });
        if (code && !firstCodeRead.has(sessionId))
          firstCodeRead.set(sessionId, new Date().toISOString());
        if (code && !GATED_WRITE_TOOLS.includes(toolName) && counted.has(sessionId)) {
          const reads = countedOf(sessionId);
          reads.set(target?.rel ?? String(raw ?? ""), (reads.get(target?.rel ?? String(raw ?? "")) ?? 0) + 1);
        }
      } catch {}
    },
    observedCodeRead(sessionId) {
      return firstCodeRead.has(sessionId);
    },
    escapeUses(sessionId) {
      return escapes.get(sessionId) ?? 0;
    },
    grantEscape(sessionId, uses) {
      escapes.set(sessionId, (escapes.get(sessionId) ?? 0) + uses);
    },
    consumeEscape(sessionId) {
      const held = escapes.get(sessionId) ?? 0;
      if (held <= 0)
        return false;
      escapes.set(sessionId, held - 1);
      return true;
    },
    countRead(sessionId, path) {
      try {
        const reads = countedOf(sessionId);
        reads.set(path, (reads.get(path) ?? 0) + 1);
      } catch {}
    },
    drainReads(sessionId) {
      const reads = countedOf(sessionId);
      const drained = [...reads.entries()].map(([path, count]) => ({ path, count }));
      reads.clear();
      return drained;
    },
    armedLoops(workspace) {
      try {
        return readLoops(workspace).map((loop) => ({
          loopId: loop.loopId,
          sessionId: loop.sessionId,
          status: loop.status,
          writerKind: loop.writer?.kind === "delegate" ? "delegate" : "self",
          writerId: String(loop.writer?.id ?? ""),
          verifierId: String(loop.verifier?.id ?? "unbound"),
          scope: Array.isArray(loop.scope) ? loop.scope.map(String) : [],
          expiresAt: String(loop.expiresAt ?? "")
        }));
      } catch {
        return [];
      }
    },
    seatFor(workspace, sessionId) {
      try {
        const seat = readSeats(workspace).seats?.[sessionId];
        if (seat === undefined)
          return;
        return {
          loopId: String(seat.loopId ?? ""),
          verifierId: String(seat.verifierId ?? sessionId),
          unlocked: seat.unlocked === true,
          docPaths: Array.isArray(seat.docPaths) ? seat.docPaths.map(String) : []
        };
      } catch {
        return;
      }
    },
    observedDelegations() {
      return [...delegations];
    },
    observedCount() {
      return calls.length;
    }
  };
}
function armDelegateLoop(workspace, sessionId, toolName, ttlMs) {
  const existing = readLoops(workspace).find((loop2) => loop2.sessionId === sessionId && loop2.status === "armed" && loop2.openedVia === "observer");
  if (existing !== undefined)
    return existing.loopId;
  const now = new Date;
  const loopId = mintId("loop");
  const loop = {
    version: 1,
    loopId,
    taskId: null,
    workspace,
    sessionId,
    writer: { kind: "delegate", id: "delegate:" + toolName },
    verifier: { id: "unbound" },
    scope: [],
    status: "armed",
    openedVia: "observer",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };
  return writeJsonAtomic(join3(loopsDir(workspace), loopId + ".json"), loop) ? loopId : undefined;
}
function installDelegationObserver(dsh, options) {
  try {
    return dsh.onPostToolExecute((exec) => {
      try {
        const toolName = String(exec?.name ?? "");
        if (!DELEGATION_TOOLS.includes(toolName))
          return;
        const sessionId = sessionKeyOf(exec?.agent);
        const workspace = dsh.workspaceRoot(exec);
        const loopId = armDelegateLoop(workspace, sessionId, toolName, options.loopTtlMs);
        if (loopId === undefined)
          options.warn("could not record the delegated loop for " + toolName + " — the loop will not appear in the ledger");
      } catch {}
      return;
    });
  } catch {
    options.warn("the delegation observer could not be installed — delegated loops will not be auto-armed");
    return () => {};
  }
}

// packages/mpd-verify-plugin/src/gates.ts
import { spawnSync } from "node:child_process";
import { existsSync as existsSync2, statSync as statSync3 } from "node:fs";
import { basename, isAbsolute, join as join4, relative } from "node:path";
var GATE_TABLE = [
  { id: "gates", cmd: "bun run verify:gates", runner: "bun", argv: ["run", "verify:gates"] },
  { id: "tests", cmd: "bun test packages", runner: "bun", argv: ["test", "packages"] },
  { id: "typecheck", cmd: "bun run typecheck", runner: "bun", argv: ["run", "typecheck"] },
  { id: "docs", cmd: "bun run verify:docs", runner: "bun", argv: ["run", "verify:docs"] },
  { id: "manifest", cmd: "bun run verify:manifest", runner: "bun", argv: ["run", "verify:manifest"] },
  { id: "comments", cmd: "bun run verify:comments", runner: "bun", argv: ["run", "verify:comments"] },
  { id: "rows", cmd: "bun run verify:rows", runner: "bun", argv: ["run", "verify:rows"] },
  { id: "vendor", cmd: "node scripts/verify-vendor.ts", runner: "node", argv: ["scripts/verify-vendor.ts"] },
  { id: "dist", cmd: "node scripts/verify-dist-fresh.ts", runner: "node", argv: ["scripts/verify-dist-fresh.ts"] },
  { id: "pack", cmd: "node scripts/pack-mpd.ts", runner: "node", argv: ["scripts/pack-mpd.ts"] }
];
var PROBE_PATH_LIMIT = 64;
var TAIL_CHARS = 4096;
function gateById(id) {
  return GATE_TABLE.find((entry) => entry.id === id);
}
function runnerPath(runner) {
  if (runner === "node")
    return process.execPath;
  if (basename(process.execPath).startsWith("bun"))
    return process.execPath;
  for (const dir of String(process.env.PATH ?? "").split(":")) {
    const candidate = join4(dir, "bun");
    if (dir !== "" && existsSync2(candidate))
      return candidate;
  }
  return "bun";
}
function runGate(workspace, spec, timeoutMs) {
  const child = spawnSync(runnerPath(spec.runner), [...spec.argv], {
    cwd: workspace,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    shell: false
  });
  const output = String(child.stdout ?? "") + String(child.stderr ?? "");
  const exit = typeof child.status === "number" ? child.status : child.signal !== null && child.signal !== undefined ? 124 : -1;
  return {
    spec,
    exit,
    output,
    tail: output.length > TAIL_CHARS ? output.slice(output.length - TAIL_CHARS) : output,
    outputSha256: sha256Text(output)
  };
}
function probeArtifacts(workspace, paths) {
  const readings = [];
  for (const raw of paths.slice(0, PROBE_PATH_LIMIT)) {
    const absolute = isAbsolute(raw) ? raw : join4(workspace, raw);
    const rel = relative(workspace, absolute);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      readings.push({ path: raw, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" });
      continue;
    }
    try {
      if (!existsSync2(absolute)) {
        readings.push({ path: rel, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" });
        continue;
      }
      const stat = statSync3(absolute);
      if (stat.isDirectory()) {
        readings.push({ path: rel, exists: true, kind: "dir", bytes: 0, sha256: "", mtime: stat.mtime.toISOString() });
        continue;
      }
      readings.push({
        path: rel,
        exists: true,
        kind: "file",
        bytes: stat.size,
        sha256: sha256File(absolute),
        mtime: stat.mtime.toISOString()
      });
    } catch {
      readings.push({ path: raw, exists: false, kind: "absent", bytes: 0, sha256: "", mtime: "" });
    }
  }
  return readings;
}

// packages/mpd-verify-plugin/src/record.ts
var REFUSAL = {
  sameAgent: "same-agent",
  noDocSources: "no-doc-sources",
  noGateEvidence: "no-gate-evidence",
  forgedEvidence: "forged-evidence",
  bindUnproven: "bind-unproven",
  failWithoutFindings: "fail-without-findings",
  findingWithoutBasis: "finding-without-basis",
  blindSpent: "blind-spent",
  unknownLoop: "unknown-loop",
  missingSeats: "missing-seats",
  prePluginUnlocked: "pre-plugin-unlocked",
  prePluginUnattested: "pre-plugin-unattested",
  postInstallClaim: "post-install-claim"
};
function validateVerificationRecord(record, context) {
  const refuse = (reason, detail) => ({ ok: false, reason, detail });
  if (record.basis.kind !== "pre-plugin" && !context.loopKnown) {
    return refuse(REFUSAL.unknownLoop, "loop " + JSON.stringify(record.loopId) + " is not in this workspace's ledger — open it with mpd_verify_open first");
  }
  if (record.writerId === "" || record.verifierId === "") {
    return refuse(REFUSAL.missingSeats, "the record must name both seats: a writer (the agent that wrote the code) and a verifier (the agent that checked it)");
  }
  if (record.verifierId === record.writerId) {
    return refuse(REFUSAL.sameAgent, "the verifier and the writer are the same agent (" + JSON.stringify(record.writerId) + "): the law requires code written by A to be verified by a DIFFERENT agent B");
  }
  if (record.basis.kind === "pre-plugin") {
    if (record.unlockedReads.length > 0) {
      return refuse(REFUSAL.prePluginUnlocked, "a pre-plugin record may not carry unlockedReads: the exemption exists for records authored" + " before the observing plugin was live, and a diagnosis window is something the live law opens");
    }
    if (String(record.basis.attestation ?? "") !== "no-guard-in-process" || record.basis.frozenContract.sha256 !== context.frozenContractSha) {
      return refuse(REFUSAL.prePluginUnattested, 'a pre-plugin record must carry basis.attestation "no-guard-in-process" and a' + " basis.frozenContract.sha256 that still matches the file on disk (expected " + JSON.stringify(String(context.frozenContractSha ?? "")) + ", got " + JSON.stringify(String(record.basis.frozenContract.sha256 ?? "")) + ") — an unattestable contract is not an attested one");
    }
    if (context.bootInstalledAt !== undefined && Date.parse(record.createdAt) >= Date.parse(context.bootInstalledAt)) {
      return refuse(REFUSAL.postInstallClaim, "this record claims the pre-plugin basis but was created at " + JSON.stringify(record.createdAt) + ", which does not precede the law's first boot marker (" + JSON.stringify(context.bootInstalledAt) + "): the exemption closes the moment the guard is live");
    }
  }
  if (context.seatUnlocked) {
    return refuse(REFUSAL.blindSpent, "this verifier seat has already unlocked an implementation-reading window (a previous FAIL)," + " so it can only record further FAILs; a PASS must come from a fresh verifier that has not read the implementation");
  }
  if (record.verdict === "FAIL") {
    if (record.findings.length === 0) {
      return refuse(REFUSAL.failWithoutFindings, "a FAIL must carry at least one finding (with severity, symptom, expected behaviour and the docSource that proves it)");
    }
    const unsupported = record.findings.find((finding) => String(finding.docSource ?? "") === "");
    if (unsupported !== undefined) {
      return refuse(REFUSAL.findingWithoutBasis, "finding " + JSON.stringify(String(unsupported.id ?? "")) + " cites no docSource: every finding must rest on a document, because the verifier works from the docs and never from the implementation");
    }
    return { ok: true };
  }
  if (record.basis.kind === "unproven") {
    return refuse(REFUSAL.bindUnproven, `the basis is "unproven": the plugin's own observation log shows this verifier read` + " implementation paths before recording a verdict, so a PASS cannot be justified. Record a FAIL, or re-verify from a fresh agent");
  }
  if (record.sources.length === 0) {
    return refuse(REFUSAL.noDocSources, "a PASS must cite at least one document it worked from (sources[] is empty); the verifier's basis is the frozen contract and the docs");
  }
  if (record.gateEvidence.length === 0) {
    return refuse(REFUSAL.noGateEvidence, 'a PASS must carry at least one piece of gate evidence (run it with mpd_verify_evidence {kind:"gate"}); gateEvidence[] is empty');
  }
  const forged = record.gateEvidence.find((evidence) => {
    const id = String(evidence.evidenceId ?? "");
    if (id === "")
      return record.basis.kind !== "pre-plugin";
    return !context.producedEvidenceIds.includes(id);
  });
  if (forged !== undefined) {
    return refuse(REFUSAL.forgedEvidence, "gateEvidence cites " + JSON.stringify(String(forged.evidenceId ?? "(no evidenceId)")) + ", which mpd_verify_evidence did not produce for loop " + JSON.stringify(record.loopId) + " — evidence cannot be asserted, only run" + (forged.evidenceId === undefined ? " (an id-less entry is admissible only on a pre-plugin basis)" : ""));
  }
  return { ok: true };
}
function buildRecord(input, identity) {
  return {
    version: 1,
    recordId: identity.recordId,
    loopId: input.loopId,
    taskId: input.taskId ?? null,
    workspace: input.workspace,
    writerId: input.writerId,
    verifierId: input.verifierId,
    basis: input.basis,
    sources: input.sources,
    gateEvidence: input.gateEvidence,
    verdict: input.verdict,
    findings: input.findings,
    unlockedReads: input.unlockedReads,
    createdAt: identity.createdAt
  };
}

// packages/mpd-verify-plugin/src/tools.ts
import { join as join5 } from "node:path";
var DEFAULT_LOOP_TTL_MS = 24 * 60 * 60 * 1000;
var DEFAULT_GATE_TIMEOUT_MS = 15 * 60 * 1000;
var BOOT_MARKER_FILE = "boot.json";
function where(deps, exec) {
  return { workspace: deps.dsh.workspaceRoot(exec), sessionId: sessionKeyOf(exec?.agent) };
}
function readBootMarker(workspace) {
  const marker = readJson(join5(verifyRoot(workspace), BOOT_MARKER_FILE));
  return typeof marker?.installedAt === "string" && marker.installedAt !== "" ? marker.installedAt : undefined;
}
function writeBootMarker(workspace, installedAt) {
  ensureDir(verifyRoot(workspace));
  return writeJsonAtomic(join5(verifyRoot(workspace), BOOT_MARKER_FILE), { version: 1, installedAt });
}
function sourceDoc(workspace, path) {
  return hashDoc(workspace, path.startsWith("/") ? path : join5(workspace, path));
}
function registerVerifyTools(dsh, deps) {
  const definitions = [
    openTool(deps),
    escapeTool(deps),
    seatTool(deps),
    evidenceTool(deps),
    recordTool(deps)
  ];
  return dsh.registerTools(definitions);
}
function openTool(deps) {
  return {
    name: "mpd_verify_open",
    description: 'Open a delegation+verification LOOP. `writer:"self"` lets THIS agent write code inside `scope` — it is the counted, visible path and REQUIRES `self_write_reason` plus a `verifier` that is a different agent. `writer:"delegate"` records a loop whose writer is a member. A loop authorises nothing after `expiresAt`.',
    parameters: {
      type: "object",
      properties: {
        verifier: { type: "string", description: 'The agent that will verify (a member name or session id). Required for writer:"self", and must not be the caller.' },
        self_write_reason: { type: "string", description: 'writer:"self" only: why this agent writes its own code. Required, echoed in the report.' },
        writer: { type: "string", enum: ["self", "delegate"], description: "Who writes. Defaults to `self`." },
        scope: { type: "array", items: { type: "string" }, description: "The paths this loop covers, relative to the workspace. EMPTY means the whole workspace." },
        task_id: { type: "string", description: "The board task this loop verifies, when it verifies one." },
        ttl_ms: { type: "number", description: "Loop lifetime in ms; defaults to 24h (verify.loopTtlMs)." }
      },
      required: [],
      additionalProperties: false
    },
    output: {
      render: (_args, value) => textBlock(value?.refused !== undefined ? "refused: " + value.refused : "loop " + value.loopId + " (" + value.writer?.kind + " writer, verifier " + value.verifier?.id + ", scope " + ((value.scope?.length ?? 0) === 0 ? "the whole workspace" : value.scope.join(", ")) + ") expires " + value.expiresAt)
    },
    execute: (args, exec) => {
      const { workspace, sessionId } = where(deps, exec);
      const writerKind = String(args?.writer ?? "self") === "delegate" ? "delegate" : "self";
      const reason = String(args?.self_write_reason ?? "");
      const verifier = String(args?.verifier ?? "");
      if (writerKind === "self" && reason.trim() === "") {
        return { refused: 'a writer:"self" loop requires `self_write_reason` — the captain writing its own code is the COUNTED path, and an uncounted one is indistinguishable from the defect this law removes. Pass a reason, or delegate the write (writer:"delegate") and let a member do it.' };
      }
      if (writerKind === "self" && verifier.trim() === "") {
        return { refused: 'a writer:"self" loop requires `verifier` — an agent that is NOT the caller. The law is that code written by A is verified by a DIFFERENT agent B; a self-writer loop with no verifier would authorise writes nobody checks.' };
      }
      const ttlMs = resolvePositiveInt(args?.ttl_ms, resolvePositiveInt(deps.configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS));
      const now = new Date;
      const loopId = mintId("loop");
      const loop = {
        version: 1,
        loopId,
        taskId: args?.task_id === undefined ? null : String(args.task_id),
        workspace,
        sessionId,
        writer: { kind: writerKind, id: writerKind === "self" ? sessionId : "delegate:pending", reason: writerKind === "self" ? reason : undefined },
        verifier: { id: verifier === "" ? "unbound" : verifier },
        scope: Array.isArray(args?.scope) ? args.scope.map(String) : [],
        status: "armed",
        openedVia: "tool",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString()
      };
      if (!writeLoop(workspace, loop))
        return { refused: "the loop could not be written to " + join5(loopsDir(workspace), loopId + ".json") };
      deps.log("opened loop " + loopId + " writer=" + loop.writer.kind + " verifier=" + loop.verifier.id);
      return { loopId, writer: loop.writer, verifier: loop.verifier, scope: loop.scope, status: loop.status, expiresAt: loop.expiresAt };
    }
  };
}
function escapeTool(deps) {
  return {
    name: "mpd_verify_escape",
    description: "Take the COUNTED escape: log one row and allow ONE write on a code path for this agent. Use it when delegating and looping are genuinely impossible — every use is a JSONL row, a boot-log line and a number you will be asked about.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the write could not be delegated or looped. Required: an unexplained escape is indistinguishable from a bug." },
        path: { type: "string", description: "The code path you need to write, when you already know it." }
      },
      required: ["reason"],
      additionalProperties: false
    },
    output: {
      render: (_args, value) => textBlock(value?.refused !== undefined ? "refused: " + value.refused : "escape " + value.count + " logged (" + value.uses + " write(s) allowed) — " + value.reason)
    },
    execute: (args, exec) => {
      const { workspace, sessionId } = where(deps, exec);
      const reason = String(args?.reason ?? "");
      if (reason.trim() === "") {
        return { refused: "`reason` is required: an escape that does not say why is a silent bypass. State what made delegating and looping impossible." };
      }
      const row = appendEscape(workspace, sessionId, reason, args?.path === undefined ? undefined : String(args.path));
      if (row === undefined)
        return { refused: "the escape could not be logged (the workspace's .mpd/verify/escape.jsonl is not writable), so no allowance was granted — an escape that is not recorded is not the counted path." };
      const uses = resolvePositiveInt(deps.configValue("verify.escapeUses"), 1);
      deps.runtime.grantEscape(sessionId, uses);
      deps.log("escape " + row.count + " reason=" + JSON.stringify(reason) + (row.path === undefined ? "" : " path=" + row.path));
      return { count: row.count, at: row.at, reason, uses, sessionId, ...row.path === undefined ? {} : { path: row.path } };
    }
  };
}
function seatTool(deps) {
  return {
    name: "mpd_verify_seat",
    description: "Bind THIS session as a loop's VERIFIER seat. Idempotent and authoritative. From that moment the envelope applies: no shell, no board mutations, no implementation reads until a verdict is recorded, and a FAIL is what unlocks diagnosis.",
    parameters: {
      type: "object",
      properties: {
        loop_id: { type: "string", description: "The loop to verify." },
        role: { type: "string", enum: ["verifier"], description: "Only `verifier` exists; the parameter is a guard against typos." }
      },
      required: ["loop_id"],
      additionalProperties: false
    },
    output: {
      render: (_args, value) => textBlock(value?.refused !== undefined ? "refused: " + value.refused : "seat bound: " + value.verifierId + " verifies loop " + value.loopId + " (" + value.docs.length + " frozen doc(s))")
    },
    execute: (args, exec) => {
      const { workspace, sessionId } = where(deps, exec);
      const loop = readLoops(workspace).find((candidate) => candidate.loopId === String(args?.loop_id ?? ""));
      if (loop === undefined)
        return { refused: "no loop " + JSON.stringify(String(args?.loop_id ?? "")) + " in this workspace — open it with mpd_verify_open first" };
      if (String(loop.writer?.id ?? "") === sessionId) {
        return { refused: "this session (" + sessionId + ") is loop " + loop.loopId + "'s WRITER — a writer cannot verify its own work. Ask a different agent to take the seat." };
      }
      const seats = readSeats(workspace);
      const docPaths = [...new Set([".mpd/plans/de-vendor-and-verify-law.md", ".mpd/plans/verify-law-spec.md"])];
      const seat = { loopId: loop.loopId, verifierId: sessionId, unlocked: seats.seats?.[sessionId]?.unlocked === true, docPaths };
      seats.version = 1;
      seats.seats = { ...seats.seats ?? {}, [sessionId]: seat };
      if (!writeSeats(workspace, seats))
        return { refused: "the seat could not be written to " + seatsPath(workspace) };
      if (String(loop.verifier?.id ?? "unbound") === "unbound") {
        writeLoop(workspace, { ...loop, verifier: { id: sessionId, boundAt: new Date().toISOString() } });
      }
      deps.log("seat bound loop=" + loop.loopId + " verifier=" + sessionId);
      const membership = deps.dsh.teamMembership(exec?.agent);
      return { loopId: loop.loopId, verifierId: sessionId, role: "verifier", blind: !seat.unlocked, docs: docPaths, verifiedWriter: String(loop.writer?.id ?? ""), ...membership === undefined ? {} : { teamName: membership.name } };
    }
  };
}
function evidenceTool(deps) {
  return {
    name: "mpd_verify_evidence",
    description: 'Produce black-box evidence. `kind:"gate"` runs ONE id from the fixed table (`gates`, `tests`, `typecheck`, `docs`, `manifest`, `comments`, `rows`, `vendor`, `dist`, `pack`) and writes its log; `kind:"probe"` returns what exists, its size, its sha256 and its mtime for each path — never content. No free-form command is accepted.',
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["gate", "probe"], description: "What to produce." },
        gate: { type: "string", description: 'kind:"gate": the table id, exactly as listed.' },
        paths: { type: "array", items: { type: "string" }, description: 'kind:"probe": up to 64 paths inside the workspace.' },
        loop_id: { type: "string", description: "The loop this evidence belongs to. Defaults to the seat's loop." }
      },
      required: ["kind"],
      additionalProperties: false
    },
    output: {
      render: (_args, value) => textBlock(value?.refused !== undefined ? "refused: " + value.refused : value?.probe !== undefined ? value.probe.length + " artifact(s) probed" : "gate " + value.gate + " exit " + value.exit + " -> " + value.logPath)
    },
    execute: (args, exec) => {
      const { workspace, sessionId } = where(deps, exec);
      const seat = readSeats(workspace).seats?.[sessionId];
      const loopId = seat?.loopId ?? (args?.loop_id === undefined ? null : String(args.loop_id));
      const evidenceId = mintId("ev");
      if (String(args?.kind ?? "") === "gate") {
        const spec = gateById(String(args?.gate ?? ""));
        if (spec === undefined)
          return { refused: "unknown-gate: " + JSON.stringify(String(args?.gate ?? "")) + " is not on the fixed table. The ids are: " + GATE_TABLE.map((entry) => entry.id).join(", ") };
        const timeoutMs = resolvePositiveInt(deps.configValue("verify.gateTimeoutMs"), DEFAULT_GATE_TIMEOUT_MS);
        const result = runGate(workspace, spec, timeoutMs);
        const wrote2 = writeEvidence(workspace, {
          version: 1,
          evidenceId,
          loopId,
          kind: "gate",
          cmd: spec.cmd,
          exit: result.exit,
          at: new Date().toISOString(),
          logPath: ".mpd/verify/evidence/" + evidenceId + ".log",
          logSha256: result.outputSha256
        }, result.output);
        if (!wrote2)
          return { refused: "the gate ran (exit " + result.exit + ") but its evidence could not be written under " + evidenceDir(workspace) + " — evidence that is not on disk cannot be cited, so it is not reported as produced" };
        deps.log("gate " + spec.id + " exit=" + result.exit + " evidence=" + evidenceId);
        return { evidenceId, gate: spec.id, cmd: spec.cmd, exit: result.exit, logPath: ".mpd/verify/evidence/" + evidenceId + ".log", logSha256: result.outputSha256, tail: result.tail };
      }
      const paths = Array.isArray(args?.paths) ? args.paths.map(String) : [];
      if (paths.length === 0)
        return { refused: 'kind:"probe" needs `paths`: a probe reports on the paths it is given, and a bare probe would be a directory walk.' };
      const readings = probeArtifacts(workspace, paths);
      const probe = readings.map((reading) => ({ path: reading.path, bytes: reading.bytes, sha256: reading.sha256, mtime: reading.mtime }));
      const wrote = writeEvidence(workspace, { version: 1, evidenceId, loopId, kind: "probe", at: new Date().toISOString(), probe }, undefined);
      if (!wrote)
        return { refused: "the probe readings could not be written under " + evidenceDir(workspace) };
      deps.log("probe " + readings.length + " path(s) evidence=" + evidenceId);
      return { evidenceId, probe, readings };
    }
  };
}
function recordTool(deps) {
  return {
    name: "mpd_verify_record",
    description: "Record a VERDICT through the validator. A PASS needs the docs it cites (`sources`), at least one gate (`evidence_ids`) and a provably blind basis; a FAIL needs findings, each with the `doc_source` that proves it, and it opens a repair task and unlocks diagnosis reading. Refusals name the rule: same-agent, no-doc-sources, no-gate-evidence, forged-evidence, bind-unproven, fail-without-findings, finding-without-basis, blind-spent, unknown-loop, pre-plugin-*.",
    parameters: {
      type: "object",
      properties: {
        loop_id: { type: "string", description: "The loop verified. A `pre-plugin` record uses `waveloop-<lane-slug>` instead." },
        verdict: { type: "string", enum: ["PASS", "FAIL"], description: "The verdict. Record it BEFORE reading any implementation." },
        writer: { type: "string", description: "The agent that wrote the code. Defaults to the loop's writer." },
        sources: { type: "array", items: { type: "string" }, description: "The documents the verdict rests on (paths). A PASS with none is refused." },
        evidence_ids: { type: "array", items: { type: "string" }, description: "The `mpd_verify_evidence` gate ids this verdict rests on." },
        findings: { type: "array", items: { type: "object" }, description: "FAIL only: {id, severity, symptom, expected, doc_source}." },
        probe_paths: { type: "array", items: { type: "string" }, description: "Paths to probe (content-free) as the record's basis." },
        notes: { type: "array", items: { type: "string" }, description: "Optional free-form notes, e.g. a declared bound." },
        basis_kind: { type: "string", enum: ["blind", "unproven", "pre-plugin"], description: "Override the derived basis. `pre-plugin` is for records authored before the law was installed." },
        task_id: { type: "string", description: "The board task this verification answers." }
      },
      required: ["loop_id", "verdict"],
      additionalProperties: false
    },
    output: {
      render: (_args, value) => textBlock(value?.refused !== undefined ? "refused [" + value.refused.reason + "]: " + value.refused.detail : "record " + value.recordId + " " + value.verdict + (value.repair === undefined ? "" : " -> repair " + value.repair.repairId))
    },
    execute: (args, exec) => {
      const { workspace, sessionId } = where(deps, exec);
      const verdict = String(args?.verdict ?? "") === "FAIL" ? "FAIL" : String(args?.verdict ?? "") === "PASS" ? "PASS" : undefined;
      if (verdict === undefined)
        return { refused: { reason: "bad-verdict", detail: '`verdict` must be "PASS" or "FAIL".' } };
      const loopId = String(args?.loop_id ?? "");
      const loop = readLoops(workspace).find((candidate) => candidate.loopId === loopId);
      const explicitBasis = typeof args?.basis_kind === "string" ? String(args.basis_kind) : "";
      const basisKind = explicitBasis === "pre-plugin" ? "pre-plugin" : explicitBasis === "unproven" ? "unproven" : explicitBasis === "blind" ? "blind" : deps.runtime.observedCodeRead(sessionId) ? "unproven" : "blind";
      const contractPath = ".mpd/plans/de-vendor-and-verify-law.md";
      const contractSha = sha256File(join5(workspace, contractPath));
      const sources = (Array.isArray(args?.sources) ? args.sources.map(String) : []).map((path) => sourceDoc(workspace, path)).filter((doc) => doc !== undefined);
      const produced = readEvidence(workspace).filter((row) => row.kind === "gate" && row.loopId === loopId);
      const cited = Array.isArray(args?.evidence_ids) ? args.evidence_ids.map(String) : [];
      const gateEvidence = cited.map((id) => {
        const row = produced.find((candidate) => candidate.evidenceId === id);
        return row === undefined ? { evidenceId: id, cmd: "(asserted)", exit: -1, logPath: "", logSha256: "" } : { evidenceId: id, cmd: String(row.cmd ?? ""), exit: Number(row.exit ?? -1), logPath: String(row.logPath ?? ""), logSha256: String(row.logSha256 ?? "") };
      });
      const findings = (Array.isArray(args?.findings) ? args.findings : []).map((raw, index) => ({
        id: String(raw?.id ?? "F" + (index + 1)),
        severity: raw?.severity === "blocker" || raw?.severity === "major" ? raw.severity : "minor",
        symptom: String(raw?.symptom ?? ""),
        expected: String(raw?.expected ?? ""),
        docSource: String(raw?.doc_source ?? raw?.docSource ?? "")
      }));
      const probe = (Array.isArray(args?.probe_paths) ? args.probe_paths.map(String) : []).flatMap((path) => probeArtifacts(workspace, [path])).map((reading) => ({
        path: reading.path,
        bytes: reading.bytes,
        sha256: reading.sha256,
        mtime: reading.mtime
      }));
      const seats = readSeats(workspace);
      const seat = seats.seats?.[sessionId];
      const drained = deps.runtime.drainReads(sessionId);
      const openedBy = readRecords(workspace).filter((row) => row.verifierId === sessionId && row.verdict === "FAIL").at(-1)?.recordId ?? "";
      const record = buildRecord({
        loopId,
        taskId: args?.task_id === undefined ? loop?.taskId ?? null : String(args.task_id),
        workspace,
        writerId: args?.writer === undefined ? String(loop?.writer?.id ?? "") : String(args.writer),
        verifierId: sessionId,
        basis: {
          kind: basisKind,
          ...basisKind === "pre-plugin" ? { attestation: "no-guard-in-process" } : {},
          frozenContract: { path: contractPath, sha256: contractSha },
          docs: [...new Set([contractPath, ...seat?.docPaths ?? []])].map((path) => sourceDoc(workspace, path)).filter((doc) => doc !== undefined),
          probe
        },
        sources,
        gateEvidence,
        verdict,
        findings,
        unlockedReads: basisKind === "pre-plugin" ? [] : drained.map((read) => ({ path: read.path, count: read.count, afterRecordId: openedBy }))
      }, { recordId: mintId("rec"), createdAt: new Date().toISOString() });
      if (Array.isArray(args?.notes))
        record.notes = args.notes.map(String);
      const outcome = validateVerificationRecord(record, {
        producedEvidenceIds: produced.map((row) => String(row.evidenceId)),
        seatUnlocked: seat?.unlocked === true,
        loopKnown: loop !== undefined,
        ...readBootMarker(workspace) === undefined ? {} : { bootInstalledAt: readBootMarker(workspace) },
        ...contractSha === "" ? {} : { frozenContractSha: contractSha }
      });
      if (!outcome.ok) {
        deps.log("record refused reason=" + outcome.reason);
        return { refused: { reason: outcome.reason, detail: outcome.detail } };
      }
      if (!writeRecord(workspace, record))
        return { refused: { reason: "write-failed", detail: "the record could not be written under " + recordsDir(workspace) } };
      let repair;
      if (verdict === "FAIL") {
        const repairId = mintId("rep");
        const summary = "repair " + loopId + " after " + record.recordId + ": " + (findings[0]?.symptom ?? "a FAIL was recorded");
        repair = { repairId, sourceTaskId: record.taskId, sourceFindingIds: findings.map((finding) => finding.id), summary };
        writeRepair(workspace, {
          version: 1,
          repairId,
          sourceRecordId: record.recordId,
          sourceTaskId: record.taskId,
          sourceFindingIds: findings.map((finding) => finding.id),
          summary,
          writerId: record.writerId,
          status: "open",
          createdAt: new Date().toISOString()
        });
        if (seat !== undefined) {
          seats.seats = { ...seats.seats ?? {}, [sessionId]: { ...seat, unlocked: true, unlockedAt: new Date().toISOString(), unlockedBy: record.recordId } };
          writeSeats(workspace, seats);
        }
        deps.log("record " + record.recordId + " FAIL -> repair " + repairId);
      } else {
        deps.log("record " + record.recordId + " PASS");
      }
      return {
        recordId: record.recordId,
        verdict,
        basis: basisKind,
        writerId: record.writerId,
        verifierId: record.verifierId,
        sources: record.sources.length,
        gateEvidence: record.gateEvidence.length,
        unlockedReads: record.unlockedReads,
        ...repair === undefined ? {} : { repair },
        recordPath: ".mpd/verify/records/" + record.recordId + ".json",
        bound: "gate output (tail) may print source frames; blindness is proven by the observation log, not by the envelope"
      };
    }
  };
}

// packages/mpd-verify-plugin/src/index.ts
var name = "mpd-verify";
var inject = dshSeamInject(DSH_SEAM_TOOLS);
function apply(ctx, config = {}) {
  const log = (line) => {
    try {
      rowLogLine("mpd-verify", "[mpd-verify] " + line);
    } catch {}
  };
  const dsh = createLazyDshAdapter(ctx, { label: "mpd-verify" });
  const configValue = (key) => {
    const live = (() => {
      try {
        return ctx.get?.("mpdConfig", false);
      } catch {
        return;
      }
    })();
    const fromLayer = (() => {
      try {
        return live?.get?.(key);
      } catch {
        return;
      }
    })();
    if (fromLayer !== undefined)
      return fromLayer;
    return config[key.slice("verify.".length)];
  };
  const runtime = createVerifyRuntime({
    dsh,
    warn: (line) => log("warning: " + line),
    configValue,
    defaultEscapeUses: 1,
    loopTtlMs: resolvePositiveInt(configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS)
  });
  try {
    ctx.provide(VERIFY_SERVICE, runtime);
  } catch (error) {
    log("could not publish the " + VERIFY_SERVICE + " service (" + (error instanceof Error ? error.message : String(error)) + ") — the guard will read an empty law");
  }
  const outcome = [];
  try {
    installDelegationObserver(dsh, {
      runtime,
      loopTtlMs: resolvePositiveInt(configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS),
      warn: (line) => log("warning: " + line)
    });
    outcome.push("delegationObserver=installed");
  } catch {
    outcome.push("delegationObserver=absent");
  }
  try {
    registerVerifyTools(dsh, {
      runtime,
      configValue,
      dsh,
      log: (line) => log(line)
    });
    outcome.push("tools=5");
  } catch (error) {
    outcome.push("tools=absent");
    log("the verification tools could not be registered (" + (error instanceof Error ? error.message : String(error)) + ")");
  }
  const mode = resolveVerifyMode(configValue("verify.mode"));
  outcome.push("mode=" + mode);
  outcome.push("guard=" + (dsh.capabilities().toolsGuard === true ? "seam-present" : "no-guard-seam"));
  const installedAt = new Date().toISOString();
  if (dsh.capabilities().toolsGuard === true) {
    try {
      const root = dsh.workspaceRoot();
      if (root !== "" && writeBootMarker(root, installedAt))
        outcome.push("bootMarker=written");
      else
        outcome.push("bootMarker=unwritten");
    } catch {
      outcome.push("bootMarker=unwritten");
    }
  } else {
    outcome.push("bootMarker=skipped");
  }
  let loopCount = 0;
  try {
    loopCount = readLoops(dsh.workspaceRoot()).length;
  } catch {
    loopCount = 0;
  }
  log("verifyGate=" + (dsh.capabilities().toolsGuard === true ? "installed" : "absent") + " loops=" + loopCount + " installedAt=" + installedAt + " " + outcome.join(" "));
}
function hasBootMarker(workspace) {
  return existsSync3(join6(verifyRoot(workspace), "boot.json"));
}
export {
  apply,
  hasBootMarker,
  inject,
  name
};
