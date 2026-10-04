// packages/mpd-team-core-plugin/src/index.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync5, readFileSync as readFileSync4, readdirSync as readdirSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";

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
var DSH_SEAM_COMMANDS = "commands";
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
  function toolReachable(name) {
    try {
      const hostView = service("tools");
      if (typeof hostView?.get === "function" && hostView.get(name) !== undefined)
        return true;
    } catch {}
    return liveAgents().some((candidate) => {
      const scoped = scopedToolRegistry(candidate);
      if (scoped === undefined)
        return false;
      try {
        return scoped.get(name) !== undefined;
      } catch {
        return false;
      }
    });
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

// packages/mpd-team-core-plugin/src/mailbox-store.ts
import { appendFileSync, existsSync, mkdirSync as mkdirSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";
function mailboxPath(workspace) {
  return join2(workspace, ".mpd", "team", "mailbox.jsonl");
}
function fold(records) {
  const byId = new Map;
  for (const raw of records) {
    const record = raw;
    if (record === null || typeof record !== "object")
      continue;
    if (record.t === "send") {
      const send = record;
      if (typeof send.id !== "string" || send.id === "")
        continue;
      byId.set(send.id, {
        id: send.id,
        fromId: String(send.fromId ?? ""),
        fromName: String(send.fromName ?? ""),
        toId: String(send.toId ?? ""),
        toName: String(send.toName ?? ""),
        subject: String(send.subject ?? ""),
        body: String(send.body ?? ""),
        sentAt: String(send.at ?? "")
      });
      continue;
    }
    if (record.t === "delivered" || record.t === "read") {
      const id = String(record.id ?? "");
      const message = byId.get(id);
      if (message === undefined)
        continue;
      const at = String(record.at ?? "");
      if (record.t === "delivered")
        message.deliveredAt = at;
      else
        message.readAt = at;
    }
  }
  return { messages: [...byId.values()] };
}
function readRecords(workspace) {
  const path = mailboxPath(workspace);
  if (!existsSync(path))
    return [];
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}
function readMailbox(workspace) {
  return fold(readRecords(workspace));
}
function appendRecord(workspace, record) {
  mkdirSync2(join2(workspace, ".mpd", "team"), { recursive: true });
  appendFileSync(mailboxPath(workspace), JSON.stringify(record) + `
`);
}
function inboxOf(state, memberId) {
  return state.messages.filter((message) => message.toId === memberId);
}
function unreadOf(state, memberId) {
  return inboxOf(state, memberId).filter((message) => message.readAt === undefined);
}
function undeliveredOf(state, memberId) {
  return inboxOf(state, memberId).filter((message) => message.deliveredAt === undefined);
}
function summarise(state) {
  const order = [];
  const seen = new Map;
  for (const message of state.messages) {
    let entry = seen.get(message.toId);
    if (entry === undefined) {
      entry = { memberId: message.toId, memberName: message.toName, total: 0, unread: 0, undelivered: 0 };
      seen.set(message.toId, entry);
      order.push(message.toId);
    }
    entry.total += 1;
    if (message.readAt === undefined) {
      entry.unread += 1;
      if (entry.oldestUnread === undefined)
        entry.oldestUnread = message.subject;
    }
    if (message.deliveredAt === undefined)
      entry.undelivered += 1;
  }
  return order.map((id) => seen.get(id));
}
function send(workspace, input, now) {
  if (input.toId === input.fromId) {
    return { ok: false, reason: "self", detail: "a team member cannot message itself" };
  }
  if (!input.memberIds.includes(input.toId)) {
    return { ok: false, reason: "unknown-recipient", detail: `"${input.toName || input.toId}" is not a member of this team` };
  }
  const state = readMailbox(workspace);
  const backlog = undeliveredOf(state, input.toId).length;
  const cap = input.maxUndelivered ?? 8;
  if (cap > 0 && backlog >= cap) {
    return { ok: false, reason: "backlog-full", detail: `"${input.toName || input.toId}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` };
  }
  const at = now.toISOString();
  const message = {
    id: `mail-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-${(state.messages.length + 1).toString().padStart(3, "0")}`,
    fromId: input.fromId,
    fromName: input.fromName,
    toId: input.toId,
    toName: input.toName,
    subject: input.subject,
    body: input.body,
    sentAt: at
  };
  appendRecord(workspace, { t: "send", ...message, at });
  return { ok: true, message };
}
function markDelivered(workspace, ids, now) {
  const state = readMailbox(workspace);
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  const moved = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (message === undefined || message.deliveredAt !== undefined)
      continue;
    appendRecord(workspace, { t: "delivered", id, at: now.toISOString() });
    moved.push(id);
  }
  return moved;
}
function markRead(workspace, ids, now) {
  const state = readMailbox(workspace);
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  const moved = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (message === undefined || message.readAt !== undefined)
      continue;
    appendRecord(workspace, { t: "read", id, at: now.toISOString() });
    moved.push(id);
  }
  return moved;
}

// packages/mpd-team-core-plugin/src/dispatch.ts
function dispatchMessage(task, description) {
  return [
    `You have been assigned shared task ${task.id}: ${task.subject}`,
    "",
    description,
    "",
    "Work it on your own; do not wait for another member to start it.",
    `When it is done, report the result to the Lead and mark task ${task.id} completed with team_task_update.`
  ].join(`
`);
}
function planDispatch(input) {
  if (input.hold !== undefined && input.hold !== "") {
    return { pairs: [], skipped: [], halted: input.hold };
  }
  const busy = new Set(Object.values(input.ledger).filter((entry) => entry.taskId !== "" && entry.memberId !== "").map((entry) => entry.memberId));
  const claimed = new Set(Object.keys(input.ledger));
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id));
  const plan = { pairs: [], skipped: [] };
  let available = [...candidates];
  const cap = input.limit === undefined || input.limit <= 0 ? Number.POSITIVE_INFINITY : input.limit;
  for (const task of input.tasks) {
    if (plan.pairs.length >= cap) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "the pass reached its limit" });
      continue;
    }
    if (task.status === "completed") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" });
      continue;
    }
    if (claimed.has(task.id)) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `already dispatched to ${input.ledger[task.id]?.memberName ?? "a member"}` });
      continue;
    }
    if (task.ready !== true) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready${Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " (blocked by " + task.blockedBy.join(", ") + ")" : ""}` });
      continue;
    }
    if (available.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "no idle member is free" });
      continue;
    }
    const member = available[0];
    available = available.slice(1);
    plan.pairs.push({ taskId: task.id, subject: task.subject, memberId: member.id, memberName: member.name });
  }
  return plan;
}
function assign(ledger, pair, now) {
  return {
    ...ledger,
    [pair.taskId]: { taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName, assignedAt: now.toISOString() }
  };
}
function release(ledger, taskId) {
  if (ledger[taskId] === undefined)
    return { ledger, released: false };
  const next = { ...ledger };
  delete next[taskId];
  return { ledger: next, released: true };
}
function reconcile(ledger, tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const next = {};
  const forgotten = [];
  for (const [taskId, entry] of Object.entries(ledger)) {
    const task = byId.get(taskId);
    if (task === undefined || task.status === "completed") {
      forgotten.push(taskId);
      continue;
    }
    next[taskId] = entry;
  }
  return { ledger: next, forgotten };
}

// packages/mpd-team-core-plugin/src/plan-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync2, readdirSync, renameSync as renameSync2, rmSync as rmSync2, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
function teamRoot(workspace) {
  return join3(workspace, ".mpd", "team");
}
var stagingDir = (workspace) => join3(teamRoot(workspace), "staging");
var stagingPath = (workspace, sessionId) => join3(stagingDir(workspace), sessionId + ".json");
var contractsDir = (workspace) => join3(teamRoot(workspace), "contracts");
var contractPath = (workspace, taskId) => join3(contractsDir(workspace), taskId + ".json");
var holdPath = (workspace) => join3(teamRoot(workspace), "hold.json");
var archiveDir = (workspace) => join3(teamRoot(workspace), "archive");
function readJson(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return;
  }
}
function writeJson(path, value) {
  mkdirSync3(join3(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + `
`);
}
function newPlanId(now) {
  return "plan-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}
function readPlan(workspace, sessionId) {
  const plan = readJson(stagingPath(workspace, sessionId));
  return plan === undefined || plan.version !== 1 ? undefined : plan;
}
function writePlan(workspace, plan) {
  writeJson(stagingPath(workspace, plan.sessionId), plan);
}
function stagePlan(workspace, sessionId, input, now) {
  const existing = readPlan(workspace, sessionId);
  if (existing !== undefined && existing.approvedAt === undefined)
    archivePlan(workspace, existing);
  const plan = {
    version: 1,
    planId: newPlanId(now),
    sessionId,
    name: input.name,
    description: input.description,
    approval: input.approval,
    members: [],
    tasks: [],
    stagedAt: now.toISOString()
  };
  writePlan(workspace, plan);
  return plan;
}
function addMember(plan, member) {
  const name = member.name.trim();
  if (name === "")
    throw new Error("a teammate needs a non-empty name");
  if (plan.members.some((existing) => existing.name === name))
    throw new Error(`teammate "${name}" is already staged`);
  return { ...plan, members: [...plan.members, { ...member, name }] };
}
function addTask(plan, task) {
  const subject = task.subject.trim();
  if (subject === "")
    throw new Error("a task needs a non-empty subject");
  return { ...plan, tasks: [...plan.tasks, { ...task, subject }] };
}
function archivePlan(workspace, plan) {
  const target = join3(archiveDir(workspace), plan.planId);
  mkdirSync3(target, { recursive: true });
  writeJson(join3(target, "plan.json"), plan);
  const staged = stagingPath(workspace, plan.sessionId);
  if (existsSync2(staged))
    rmSync2(staged, { force: true });
  return target;
}
function claimContract(workspace, task, claimant, now) {
  const previous = readJson(contractPath(workspace, task.id));
  const contract = {
    version: 1,
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    blockedBy: [...task.blockedBy ?? []],
    writeScopes: [...task.writeScopes ?? []],
    attempt: (previous?.attempt ?? 0) + 1,
    claimedBy: claimant,
    claimedAt: now.toISOString(),
    revision: task.revision
  };
  writeJson(contractPath(workspace, task.id), contract);
  return contract;
}
function readContract(workspace, taskId) {
  const contract = readJson(contractPath(workspace, taskId));
  return contract === undefined || contract.version !== 1 ? undefined : contract;
}
function listContracts(workspace) {
  let names = [];
  try {
    names = readdirSync(contractsDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const contract = readJson(join3(contractsDir(workspace), name));
    if (contract !== undefined && contract.version === 1)
      out.push(contract);
  }
  return out.sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));
}
function readHold(workspace) {
  const hold = readJson(holdPath(workspace));
  return hold === undefined || hold.version !== 1 ? undefined : hold;
}
function placeHold(workspace, reason, heldBy, now) {
  const hold = { version: 1, reason, heldAt: now.toISOString(), heldBy };
  writeJson(holdPath(workspace), hold);
  return hold;
}
function clearHold(workspace) {
  const path = holdPath(workspace);
  if (!existsSync2(path))
    return false;
  rmSync2(path, { force: true });
  return true;
}
function archivePathFor(workspace, planId) {
  return join3(archiveDir(workspace), planId);
}
function moveIntoArchive(workspace, from, planId) {
  const target = archivePathFor(workspace, planId);
  mkdirSync3(archiveDir(workspace), { recursive: true });
  renameSync2(from, target);
  return target;
}

// packages/mpd-team-core-plugin/src/team-store.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync4, readFileSync as readFileSync3, readdirSync as readdirSync2, rmSync as rmSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join4 } from "node:path";
function teamRoot2(workspace) {
  return join4(workspace, ".mpd", "team");
}
function teamsDir(workspace) {
  return join4(teamRoot2(workspace), "teams");
}
function teamRecordPath(workspace, teamId) {
  return join4(teamsDir(workspace), sanitizeId(teamId) + ".json");
}
function teamsIndexPath(workspace) {
  return join4(teamRoot2(workspace), "teams.json");
}
function sanitizeId(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "");
  return cleaned === "" ? "unnamed" : cleaned;
}
function readJson2(path) {
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}
function writeJson2(path, value) {
  mkdirSync4(join4(path, ".."), { recursive: true });
  writeFileSync2(path, JSON.stringify(value, null, 2) + `
`);
}
function newTeamId(now) {
  return "team-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}
function sessionKey(sessionId) {
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : "workspace";
}
function readTeamsIndex(workspace) {
  const index = readJson2(teamsIndexPath(workspace));
  if (index === undefined || index.version !== 1 || index.active === null || typeof index.active !== "object" || Array.isArray(index.active)) {
    return { version: 1, active: {} };
  }
  return index;
}
function writeTeamsIndex(workspace, index) {
  writeJson2(teamsIndexPath(workspace), index);
}
function activeTeamId(workspace, sessionId) {
  const id = readTeamsIndex(workspace).active[sessionKey(sessionId)];
  return typeof id === "string" && id !== "" ? id : undefined;
}
function bindActiveTeam(workspace, sessionId, teamId) {
  const index = readTeamsIndex(workspace);
  index.active[sessionKey(sessionId)] = teamId;
  writeTeamsIndex(workspace, index);
}
function readTeam(workspace, teamId) {
  const record = readJson2(teamRecordPath(workspace, teamId));
  if (record === undefined || record.version !== 1)
    return;
  if (!Array.isArray(record.members) || !Array.isArray(record.tasks))
    return;
  return record;
}
function writeTeam(workspace, record) {
  writeJson2(teamRecordPath(workspace, record.teamId), record);
}
function listTeams(workspace) {
  let names = [];
  try {
    names = readdirSync2(teamsDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const record = readTeam(workspace, name.slice(0, -".json".length));
    if (record !== undefined)
      out.push(record);
  }
  return out.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
function createTeam(workspace, input, now) {
  const record = {
    version: 1,
    teamId: newTeamId(now),
    name: input.name,
    description: input.description,
    leadSessionId: sessionKey(input.leadSessionId),
    phase: "staged",
    createdAt: now.toISOString(),
    members: [],
    tasks: [],
    nextMemberNumber: 1,
    nextTaskNumber: 1
  };
  writeTeam(workspace, record);
  bindActiveTeam(workspace, input.leadSessionId, record.teamId);
  return record;
}
function addTeamMember(record, input, now) {
  const name = input.name.trim();
  if (name === "")
    return record;
  if (record.members.some((member2) => member2.name === name))
    return record;
  const member = {
    id: "M" + record.nextMemberNumber,
    name,
    description: input.description,
    status: "provisioning",
    spawnedAt: now.toISOString(),
    ...input.role === undefined ? {} : { role: input.role },
    ...input.route === undefined ? {} : { route: input.route }
  };
  return { ...record, members: [...record.members, member], nextMemberNumber: record.nextMemberNumber + 1 };
}
function resolveBlocker(record, reference) {
  if (record.tasks.some((task) => task.id === reference))
    return reference;
  const bySubject = record.tasks.find((task) => task.subject === reference);
  return bySubject === undefined ? reference : bySubject.id;
}
function addTeamTask(record, input, now) {
  const subject = input.subject.trim();
  if (subject === "")
    return record;
  const blockedBy = (input.blockedBy ?? []).map((reference) => resolveBlocker(record, reference));
  const task = {
    id: "T" + record.nextTaskNumber,
    subject,
    description: input.description,
    kind: input.kind ?? "work",
    status: "pending",
    blockedBy,
    writeScopes: [...input.writeScopes ?? []],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    ...input.owner === undefined ? {} : { owner: input.owner },
    ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
    ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId }
  };
  return { ...record, tasks: [...record.tasks, task], nextTaskNumber: record.nextTaskNumber + 1 };
}
function updateTeamTask(record, taskId, patch, now) {
  let touched = false;
  const tasks = record.tasks.map((task) => {
    if (task.id !== taskId)
      return task;
    touched = true;
    const next = {
      ...task,
      updatedAt: now.toISOString(),
      revision: task.revision + 1,
      ...patch.status === undefined ? {} : { status: patch.status },
      ...patch.attempt === undefined ? {} : { attempt: patch.attempt },
      ...patch.round === undefined ? {} : { round: patch.round },
      ...patch.verdict === undefined ? {} : { verdict: patch.verdict },
      ...patch.executorRef === undefined ? {} : { executorRef: patch.executorRef },
      ...patch.blockedBy === undefined ? {} : { blockedBy: patch.blockedBy.map((reference) => resolveBlocker(record, reference)) }
    };
    if (patch.owner !== undefined) {
      if (patch.owner === "")
        delete next.owner;
      else
        next.owner = patch.owner;
    }
    return next;
  });
  return touched ? { ...record, tasks } : record;
}
function updateTeamMember(record, key, patch) {
  let touched = false;
  const members = record.members.map((member) => {
    if (member.id !== key && member.name !== key)
      return member;
    touched = true;
    return {
      ...member,
      ...patch.status === undefined ? {} : { status: patch.status },
      ...patch.executorRef === undefined ? {} : { executorRef: patch.executorRef },
      ...patch.route === undefined ? {} : { route: patch.route }
    };
  });
  return touched ? { ...record, members } : record;
}
function derivePhase(record) {
  if (record.endedAt !== undefined)
    return "ended";
  if (record.approvedAt === undefined)
    return "staged";
  const busyMember = record.members.some((member) => member.status === "running" || member.status === "provisioning");
  const busyTask = record.tasks.some((task) => task.status === "in_progress" || task.status === "claimed");
  return busyMember || busyTask ? "active" : "idle";
}
function withDerivedPhase(record) {
  const phase = derivePhase(record);
  return phase === record.phase ? record : { ...record, phase };
}
function blockingDependencies(board, blockedBy) {
  const byId = new Map(board.map((task) => [task.id, task]));
  const blocking = [];
  const failed = [];
  for (const id of blockedBy) {
    const status = byId.get(id)?.status;
    if (status === "completed" || status === "cancelled")
      continue;
    if (status === "failed")
      failed.push(id);
    else
      blocking.push(id);
  }
  return { blocking, failed };
}
function taskVisual(task, board) {
  if (task.status === "completed")
    return "completed";
  if (task.status === "failed")
    return "failed";
  if (task.status === "cancelled")
    return "cancelled";
  if (task.status === "in_progress" || task.status === "claimed")
    return "running";
  return blockingDependencies(board, task.blockedBy).blocking.length > 0 ? "blocked" : "open";
}
function taskDepths(board) {
  const byId = new Map(board.map((task) => [task.id, task]));
  const depths = new Map;
  const visiting = new Set;
  const depthOf = (id) => {
    const cached = depths.get(id);
    if (cached !== undefined)
      return cached;
    if (visiting.has(id))
      return 0;
    const task = byId.get(id);
    if (task === undefined)
      return 0;
    visiting.add(id);
    const blockers = [...task.blockedBy].filter((candidate) => byId.has(candidate)).sort();
    const depth = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map(depthOf));
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  for (const task of board)
    depthOf(task.id);
  return depths;
}
function cycleIds(board) {
  const byId = new Map(board.map((task) => [task.id, task]));
  const done = new Set;
  const stack = [];
  const inStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (inStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    inStack.add(id);
    stack.push(id);
    for (const blocker of task.blockedBy)
      if (byId.has(blocker))
        visit(blocker);
    stack.pop();
    inStack.delete(id);
    done.add(id);
  };
  for (const task of board)
    visit(task.id);
  return [...cyclic].sort();
}
function summariseTeam(record) {
  const board = record.tasks;
  const summary = { total: board.length, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0, other: 0, links: 0, cycles: cycleIds(board), depths: taskDepths(board) };
  for (const task of board) {
    const visual = taskVisual(task, board);
    const { blocking, failed } = blockingDependencies(board, task.blockedBy);
    if (visual === "completed")
      summary.completed += 1;
    else if (visual === "running")
      summary.running += 1;
    else if (visual === "blocked")
      summary.blocked += 1;
    else if (visual === "failed")
      summary.failed += 1;
    else if (visual === "open") {
      if (failed.length > 0 && blocking.length === 0)
        summary.releasedByFailure += 1;
      else
        summary.ready += 1;
    } else
      summary.other += 1;
    summary.links += task.blockedBy.filter((id) => board.some((candidate) => candidate.id === id)).length;
  }
  return summary;
}
function losslessSummary(summary) {
  return { ...summary, depths: Object.fromEntries(summary.depths) };
}
function memberProgress(record, name) {
  const owned = record.tasks.filter((task) => task.owner === name);
  const current = owned.find((task) => task.status !== "completed" && task.status !== "cancelled");
  return {
    done: owned.filter((task) => task.status === "completed").length,
    total: owned.length,
    ...current === undefined ? {} : { current: current.id }
  };
}
function readyTasks(record) {
  return record.tasks.filter((task) => task.status === "pending" && blockingDependencies(record.tasks, task.blockedBy).blocking.length === 0);
}
function idleMembers(record) {
  const busy = new Set(record.tasks.filter((task) => task.status === "in_progress" || task.status === "claimed").map((task) => task.owner).filter((owner) => owner !== undefined));
  return record.members.filter((member) => member.status === "running" && !busy.has(member.name));
}

// packages/mpd-team-core-plugin/src/team-web.ts
var TEAM_STATE_PATH = "/plugins/mpd-team/state";
var TEAM_PLAN_PATH = "/plugins/mpd-team/plan";
var TEAM_TASK_PATH = "/plugins/mpd-team/task";
var TEAM_MAIL_PATH = "/plugins/mpd-team/mail";
var TEAM_ROUTES = [TEAM_STATE_PATH, TEAM_PLAN_PATH, TEAM_TASK_PATH, TEAM_MAIL_PATH];
function approvalPhraseFor(planId) {
  return `approve ${planId}`;
}
function buildTeamState(record, workspace, sessionId, executor) {
  const empty = {
    ok: true,
    workspace,
    sessionId,
    team: null,
    counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
    members: [],
    tasks: [],
    cycles: [],
    executor,
    problems: []
  };
  if (record === undefined)
    return empty;
  const summary = summariseTeam(record);
  const ready = new Set(readyTasks(record).map((task) => task.id));
  const idle = new Set(idleMembers(record).map((member) => member.name));
  const tasks = record.tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    ...task.kind === undefined ? {} : { kind: task.kind },
    status: task.status,
    visual: taskVisual(task, record.tasks),
    ...task.owner === undefined ? {} : { owner: task.owner },
    ...task.attempt === undefined ? {} : { attempt: task.attempt },
    ...task.round === undefined ? {} : { round: task.round },
    ...task.verdict === undefined ? {} : { verdict: task.verdict },
    blockedBy: [...task.blockedBy],
    failedBy: blockingDependencies(record.tasks, task.blockedBy).failed,
    depth: summary.depths.get(task.id) ?? 0
  })).sort((left, right) => left.depth - right.depth);
  return {
    ok: true,
    workspace,
    sessionId,
    team: {
      id: record.teamId,
      name: record.name,
      description: record.description,
      phase: derivePhase(record),
      ...record.approvedAt === undefined ? {} : { approvedAt: record.approvedAt },
      links: summary.links
    },
    counts: {
      total: summary.total,
      completed: summary.completed,
      running: summary.running,
      ready: ready.size,
      blocked: summary.blocked,
      failed: summary.failed,
      releasedByFailure: summary.releasedByFailure
    },
    members: record.members.map((member) => {
      const progress = memberProgress(record, member.name);
      return {
        id: member.id,
        name: member.name,
        ...member.role === undefined ? {} : { role: member.role },
        status: member.status === "running" && idle.has(member.name) ? "idle" : member.status,
        done: progress.done,
        total: progress.total,
        ...progress.current === undefined ? {} : { current: progress.current },
        ...member.route === undefined ? {} : { route: member.route }
      };
    }),
    tasks,
    cycles: cycleIds(record.tasks),
    executor,
    problems: summary.cycles.length === 0 ? [] : [`cycle ${summary.cycles.join(",")}`]
  };
}
function buildTeamPlan(plan, workspace, sessionId) {
  if (plan === undefined)
    return { ok: true, workspace, sessionId, plan: null };
  const memberIds = new Map((plan.created?.members ?? []).map((entry) => [entry.name, entry.id]));
  const taskIds = new Map((plan.created?.tasks ?? []).map((entry) => [entry.subject, entry.id]));
  return {
    ok: true,
    workspace,
    sessionId,
    plan: {
      planId: plan.planId,
      name: plan.name,
      description: plan.description,
      approval: plan.approval,
      stagedAt: plan.stagedAt,
      phrase: approvalPhraseFor(plan.planId),
      approved: plan.approvedAt !== undefined,
      discarded: plan.discardedAt !== undefined,
      members: plan.members.map((member) => ({
        name: member.name,
        description: member.description,
        ...member.role === undefined ? {} : { role: member.role },
        ...memberIds.has(member.name) ? { id: memberIds.get(member.name) } : {}
      })),
      tasks: plan.tasks.map((task) => ({
        subject: task.subject,
        description: task.description,
        ...task.owner === undefined ? {} : { owner: task.owner },
        blockedBy: [...task.blockedBy ?? []],
        ...taskIds.has(task.subject) ? { id: taskIds.get(task.subject) } : {}
      }))
    }
  };
}
function buildTeamTasks(workspace) {
  const hold = readHold(workspace);
  return {
    ok: true,
    workspace,
    contracts: listContracts(workspace).map((contract) => ({
      taskId: contract.taskId,
      subject: contract.subject,
      description: contract.description,
      claimedBy: contract.claimedBy,
      claimedAt: contract.claimedAt,
      attempt: contract.attempt,
      blockedBy: [...contract.blockedBy]
    })),
    hold: hold === undefined ? null : { reason: hold.reason, heldBy: hold.heldBy, heldAt: hold.heldAt }
  };
}
function buildTeamMail(workspace) {
  const state = readMailbox(workspace);
  const messages = (Array.isArray(state.messages) ? state.messages : []).map((raw) => {
    const entry = raw ?? {};
    return {
      id: String(entry.id ?? ""),
      fromName: String(entry.fromName ?? ""),
      toName: String(entry.toName ?? ""),
      subject: String(entry.subject ?? ""),
      body: String(entry.body ?? ""),
      sentAt: String(entry.sentAt ?? ""),
      ...entry.deliveredAt === undefined ? {} : { deliveredAt: String(entry.deliveredAt) },
      ...entry.readAt === undefined ? {} : { readAt: String(entry.readAt) }
    };
  });
  return { ok: true, workspace, messages, records: readRecords(workspace).length };
}
function planForSession(workspace, sessionId) {
  return buildTeamPlan(readPlan(workspace, sessionId), workspace, sessionId);
}
function registerTeamRoutes(webServer, deps) {
  if (webServer === undefined || typeof webServer.register !== "function")
    return false;
  const json = (res, status, body) => {
    const out = res;
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    out.end(JSON.stringify(body));
  };
  const sessionOf = (req) => {
    const url = String(req.url ?? "");
    const at = url.indexOf("?");
    if (at < 0)
      return "";
    const value = new URLSearchParams(url.slice(at + 1)).get("sessionId");
    return value === null ? "" : value.trim();
  };
  const mount = (path, build) => {
    try {
      deps.effect(() => webServer.register({
        kind: "exact",
        path,
        handler: (req, res) => {
          try {
            json(res, 200, build(req));
          } catch (error) {
            json(res, 500, { ok: false, error: `mpd-team-core: ${String(error?.message ?? error)}` });
          }
        }
      }), `mpd-team-core: web route ${path}`);
      return true;
    } catch (error) {
      deps.warn(`registering ${path} failed: ${String(error?.message ?? error)}`);
      return false;
    }
  };
  let all = true;
  all = mount(TEAM_STATE_PATH, (req) => {
    const sessionId = sessionOf(req);
    return buildTeamState(deps.recordFor(sessionId), deps.workspace(), sessionId, deps.executor());
  }) && all;
  all = mount(TEAM_PLAN_PATH, (req) => {
    const sessionId = sessionOf(req);
    return planForSession(deps.workspace(), sessionId);
  }) && all;
  all = mount(TEAM_TASK_PATH, () => buildTeamTasks(deps.workspace())) && all;
  all = mount(TEAM_MAIL_PATH, () => buildTeamMail(deps.workspace())) && all;
  return all;
}

// packages/mpd-team-core-plugin/src/index.ts
var name = "mpd-team-core";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS);
var TEAMS_SERVICE = "mpdTeams";
var text = (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
var dispatchPath = (workspace) => join5(workspace, ".mpd", "team", "dispatch.json");
function readLedger(workspace) {
  try {
    const raw = JSON.parse(readFileSync4(dispatchPath(workspace), "utf8"));
    return raw !== null && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeLedger(workspace, ledger) {
  mkdirSync5(join5(workspace, ".mpd", "team"), { recursive: true });
  writeFileSync3(dispatchPath(workspace), JSON.stringify(ledger, null, 2) + `
`);
}
function describePlan(plan) {
  if (plan === undefined)
    return "no staged plan";
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged";
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`;
}
function stringList(value) {
  return Array.isArray(value) ? value.map(String) : undefined;
}
function adapterFor(ctx) {
  const mounted = typeof ctx?.get === "function" ? ctx.get("mpdDsh") : undefined;
  return mounted ?? createDshAdapter(ctx);
}
function sessionIdOf(exec) {
  const agent = exec?.agent;
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id;
  return typeof id === "string" && id !== "" ? id : "workspace";
}
function apply(ctx) {
  const dsh = adapterFor(ctx);
  const disposers = [];
  const now = () => new Date;
  const executor = () => dsh.teamExecutor();
  const where = (exec) => ({ workspace: dsh.workspaceRoot(exec), sessionId: sessionIdOf(exec) });
  const requirePlan = (exec) => {
    const { workspace, sessionId } = where(exec);
    const plan = readPlan(workspace, sessionId);
    if (plan === undefined)
      throw new Error("no team is staged in this session — call agent_teams_create first");
    if (plan.approvedAt !== undefined)
      throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`);
    return { workspace, sessionId, plan };
  };
  const readWatchdogHold = (workspace, sessionId) => {
    try {
      const record = recordFor(workspace, sessionId);
      if (record === undefined)
        return { state: "free" };
      const watchdog = typeof ctx?.get === "function" ? ctx.get("mpdWatchdog") : undefined;
      if (watchdog === undefined || watchdog === null)
        return { state: "free" };
      if (typeof watchdog.isHeld !== "function")
        return { state: "not-readable", reason: "the mpdWatchdog service exposes no isHeld()" };
      const view = watchdog.isHeld(record.teamId, workspace);
      if (view === null || typeof view !== "object" || typeof view.held !== "boolean") {
        return { state: "not-readable", reason: "mpdWatchdog.isHeld() answered without a boolean `held`" };
      }
      if (view.held !== true)
        return { state: "free" };
      return { state: "held", reason: `the team watchdog holds ${record.teamId}` };
    } catch (error) {
      return { state: "not-readable", reason: String(error?.message ?? error) };
    }
  };
  const recordFor = (workspace, sessionId) => {
    try {
      const bound = activeTeamId(workspace, sessionId);
      if (bound !== undefined) {
        const record = readTeam(workspace, bound);
        if (record !== undefined)
          return record;
      }
      return listTeams(workspace).find((record) => record.leadSessionId === sessionId);
    } catch {
      return;
    }
  };
  if (typeof ctx?.provide === "function") {
    try {
      ctx.provide(TEAMS_SERVICE, {
        list: (workspace) => {
          try {
            return listTeams(workspace);
          } catch {
            return [];
          }
        },
        get: (workspace, teamId) => {
          try {
            return readTeam(workspace, teamId);
          } catch {
            return;
          }
        },
        active: (workspace, sessionId) => recordFor(workspace, sessionId ?? "workspace"),
        summary: (record) => summariseTeam(record),
        visual: (record, taskId) => {
          const task = record.tasks.find((candidate) => candidate.id === taskId);
          return task === undefined ? "unknown" : taskVisual(task, record.tasks);
        },
        progress: (record, name2) => memberProgress(record, name2),
        teamIds: (workspace) => {
          try {
            return listTeams(workspace).map((record) => record.teamId);
          } catch {
            return [];
          }
        },
        memberNames: (workspace) => {
          try {
            const names = new Set;
            for (const record of listTeams(workspace))
              for (const member of record.members)
                names.add(member.name);
            return [...names];
          } catch {
            return [];
          }
        },
        planFor: (workspace, sessionId) => {
          try {
            return planForSession(workspace, sessionId);
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] reading the staged plan failed: ${String(error?.message ?? error)}`);
            return { ok: true, workspace, sessionId, plan: null };
          }
        }
      });
    } catch (error) {
      rowLogLine("mpd-team-core", `[mpd-team-core] publishing the ${TEAMS_SERVICE} service failed: ${String(error?.message ?? error)}`);
    }
  }
  disposers.push(dsh.registerTool({
    name: "agent_teams_plan",
    description: "The team PLAN. `create` stages a plan (nothing is spawned); `add_member`/`create_task` append to it; `edit` reads or replaces it; `approve` EXECUTES it (spawns members through spawn_teammate, posts tasks to the official board, resolves blocked_by and owner); `delete` archives it; `status` shows the plan, the halt, and the official roster and board side by side.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
        name: { type: "string", description: "create: the team's name." },
        description: { type: "string", description: "create/edit: what the team is for." },
        approval: { type: "string", enum: ["required", "automatic"], description: "create: `required` (default) waits for `approve`." },
        replace: { type: "boolean", description: "create: required to replace an ALREADY APPROVED plan." },
        member: { type: "object", description: "add_member: {name, prompt, description?, role?}. `prompt` is what spawn_teammate receives." },
        task: { type: "object", description: "create_task: {subject, description, blocked_by?, write_scopes?, owner?}; `owner`/`blocked_by` may also sit beside `task`." },
        owner: { type: "string", description: "create_task: alias of `task.owner`." },
        blocked_by: { type: "array", items: { type: "string" }, description: "create_task: alias of `task.blocked_by`." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement member list." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement task list." },
        dry_run: { type: "boolean", description: "approve: report what would be created, and create nothing." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          plan: { oneOf: [{ type: "object" }, { type: "null" }] },
          hold: { oneOf: [{ type: "object" }, { type: "null" }] },
          team: { oneOf: [{ type: "object" }, { type: "null" }] },
          summary: { oneOf: [{ type: "object" }, { type: "null" }] },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          contracts: { type: "array", items: { type: "object" } },
          created: { type: "object" },
          stoppedAt: { type: "string" },
          archivedTo: { type: "string" }
        }
      },
      render: (_args, value) => text(value?.archivedTo !== undefined ? `archived to ${value.archivedTo}` : value?.created !== undefined ? `approved ${value.plan?.planId ?? ""}: ${value.created.members?.length ?? 0} member(s), ${value.created.tasks?.length ?? 0} task(s)` + (value.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`) : value?.members !== undefined ? `plan ${value.plan?.planId ?? "(none)"} · members ${value.members.length} · tasks ${value.tasks?.length ?? 0} · hold ${value.hold === null || value.hold === undefined ? "none" : "held"}` : describePlan(value?.plan))
    },
    execute: async (args, exec) => {
      const action = String(args?.action ?? "");
      const { workspace, sessionId } = where(exec);
      if (action === "status") {
        const read = (fn, fallback) => {
          try {
            return fn();
          } catch {
            return fallback;
          }
        };
        const record = recordFor(workspace, sessionId);
        return {
          plan: readPlan(workspace, sessionId) ?? null,
          hold: readHold(workspace) ?? null,
          team: record ?? null,
          members: record === undefined ? read(() => dsh.teamListMembers(exec.agent), []) : record.members,
          tasks: record === undefined ? read(() => dsh.teamListTasks(exec.agent), []) : record.tasks,
          summary: record === undefined ? null : losslessSummary(summariseTeam(record)),
          contracts: read(() => listContracts(workspace), [])
        };
      }
      if (action === "create") {
        const existing = readPlan(workspace, sessionId);
        if (existing?.approvedAt !== undefined && args?.replace !== true) {
          throw new Error(`plan ${existing.planId} is already approved; pass replace:true to stage a different team`);
        }
        return { plan: stagePlan(workspace, sessionId, {
          name: String(args?.name ?? "team"),
          description: String(args?.description ?? ""),
          approval: args?.approval === "automatic" ? "automatic" : "required"
        }, now()) };
      }
      if (action === "add_member") {
        const { plan } = requirePlan(exec);
        const raw = args?.member ?? {};
        const next = addMember(plan, {
          name: String(raw.name ?? ""),
          description: String(raw.description ?? ""),
          prompt: String(raw.prompt ?? ""),
          ...raw.role === undefined ? {} : { role: String(raw.role) }
        });
        writePlan(workspace, next);
        return { plan: next };
      }
      if (action === "create_task") {
        const { plan } = requirePlan(exec);
        const raw = args?.task ?? {};
        const blockedBy = stringList(raw.blocked_by ?? raw.blockedBy ?? args?.blocked_by);
        const writeScopes = stringList(raw.write_scopes ?? raw.writeScopes ?? args?.write_scopes);
        const owner = raw.owner ?? args?.owner;
        const next = addTask(plan, {
          subject: String(raw.subject ?? ""),
          description: String(raw.description ?? ""),
          ...blockedBy === undefined ? {} : { blockedBy },
          ...writeScopes === undefined ? {} : { writeScopes },
          ...owner === undefined ? {} : { owner: String(owner) }
        });
        writePlan(workspace, next);
        return { plan: next };
      }
      if (action === "edit") {
        const plan = readPlan(workspace, sessionId);
        if (plan === undefined)
          throw new Error('no team is staged in this session — use action:"create" first');
        if (args?.members === undefined && args?.tasks === undefined && args?.description === undefined)
          return { plan };
        if (plan.approvedAt !== undefined)
          throw new Error(`plan ${plan.planId} is already approved and cannot be edited`);
        const next = {
          ...plan,
          ...args?.description === undefined ? {} : { description: String(args.description) },
          ...Array.isArray(args?.members) ? { members: args.members.map((raw) => {
            if (typeof raw?.name !== "string" || raw.name.trim() === "")
              throw new Error("every staged member needs a name");
            if (typeof raw?.prompt !== "string" || raw.prompt.trim() === "")
              throw new Error(`staged member "${raw.name}" needs a prompt`);
            return { name: raw.name, description: String(raw?.description ?? ""), prompt: raw.prompt, ...raw?.role === undefined ? {} : { role: String(raw.role) } };
          }) } : {},
          ...Array.isArray(args?.tasks) ? { tasks: args.tasks.map((raw) => {
            if (typeof raw?.subject !== "string" || raw.subject.trim() === "")
              throw new Error("every staged task needs a subject");
            return {
              subject: raw.subject,
              description: String(raw?.description ?? ""),
              ...Array.isArray(raw?.blockedBy) || Array.isArray(raw?.blocked_by) ? { blockedBy: (raw.blockedBy ?? raw.blocked_by).map(String) } : {},
              ...Array.isArray(raw?.writeScopes) || Array.isArray(raw?.write_scopes) ? { writeScopes: (raw.writeScopes ?? raw.write_scopes).map(String) } : {},
              ...raw?.owner === undefined ? {} : { owner: String(raw.owner) }
            };
          }) } : {}
        };
        writePlan(workspace, next);
        return { plan: next };
      }
      if (action === "delete") {
        const plan = readPlan(workspace, sessionId);
        if (plan === undefined)
          return {};
        return { archivedTo: archivePlan(workspace, plan) };
      }
      if (action === "approve") {
        const plan = readPlan(workspace, sessionId);
        if (plan === undefined)
          throw new Error('no team is staged in this session — use action:"create" first');
        if (plan.approvedAt !== undefined)
          throw new Error(`plan ${plan.planId} is already approved`);
        if (args?.dry_run === true) {
          return { plan, created: { members: plan.members.map((m) => ({ name: m.name, id: "" })), tasks: plan.tasks.map((t) => ({ subject: t.subject, id: "" })) } };
        }
        let record = createTeam(workspace, { name: plan.name, description: plan.description, leadSessionId: sessionId }, now());
        for (const member of plan.members) {
          record = addTeamMember(record, { name: member.name, description: member.description, ...member.role === undefined ? {} : { role: member.role } }, now());
        }
        for (const task of plan.tasks) {
          record = addTeamTask(record, {
            subject: task.subject,
            description: task.description,
            kind: "work",
            ...task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy },
            ...task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes },
            ...task.owner === undefined ? {} : { owner: task.owner }
          }, now());
        }
        const created = { members: [], tasks: [] };
        const executorTaskId = new Map;
        let stoppedAt;
        for (const member of record.members) {
          try {
            const spawned = await executor().spawn(exec.agent, {
              teamId: record.teamId,
              memberId: member.id,
              name: member.name,
              description: member.description === "" ? member.name : member.description,
              prompt: plan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description,
              ...member.route === undefined ? {} : { provider: member.route },
              ...exec.signal === undefined ? {} : { signal: exec.signal }
            });
            created.members.push({ name: member.name, id: spawned.handle });
            record = updateTeamMember(record, member.id, { executorRef: spawned.handle, status: "running" });
          } catch (error) {
            record = updateTeamMember(record, member.id, { status: "failed" });
            stoppedAt = `member ${member.name}: ${String(error?.message ?? error)}`;
            break;
          }
        }
        if (stoppedAt === undefined)
          for (const task of record.tasks) {
            created.tasks.push({ subject: task.subject, id: task.id });
          }
        const approvedRecord = withDerivedPhase({ ...record, approvedAt: now().toISOString() });
        writeTeam(workspace, approvedRecord);
        const approved = { ...plan, approvedAt: now().toISOString(), created };
        writePlan(workspace, approved);
        if (stoppedAt === undefined)
          archivePlan(workspace, { ...approved });
        return { plan: approved, team: approvedRecord, created, ...stoppedAt === undefined ? {} : { stoppedAt } };
      }
      throw new Error(`agent_teams_plan: unknown action "${action}" (create | add_member | create_task | edit | approve | delete | status)`);
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_task",
    description: "Shared board tasks. `claim` claims one for a member AND freezes its contract — the acceptance text, blockers and write scopes as they stand now, with a monotonic attempt counter; `contract` reads a frozen contract back (or every one in this workspace); `release` frees one dispatched task so it can be dispatched again.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "contract", "release"], description: "What to do." },
        task_id: { type: "string", description: "claim/contract: the official task id. release: the task to free." },
        claimant: { type: "string", description: "claim: who claims it. Defaults to the calling agent." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } }, task: { type: "object" }, released: { type: "boolean" } } },
      render: (_args, value) => text(value?.released !== undefined ? value.released ? "released" : "that task was not dispatched" : value?.contract !== undefined ? `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}` : value?.contracts !== undefined ? `${value.contracts.length} contract(s)` : "no contract")
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const action = String(args?.action ?? "");
      if (action === "release") {
        const { ledger, released } = release(readLedger(workspace), String(args?.task_id ?? ""));
        if (released)
          writeLedger(workspace, ledger);
        return { released };
      }
      if (action === "contract") {
        if (args?.task_id === undefined)
          return { contracts: listContracts(workspace) };
        const contract = readContract(workspace, String(args.task_id));
        if (contract === undefined)
          throw new Error(`no contract for task "${String(args.task_id)}" — it has never been claimed through this tool`);
        return { contract };
      }
      if (action === "claim") {
        const record = recordFor(workspace, sessionIdOf(exec));
        if (record === undefined)
          throw new Error("no team record in this workspace — approve a plan first");
        const task = record.tasks.find((candidate) => candidate.id === String(args?.task_id ?? ""));
        if (task === undefined)
          throw new Error(`no task "${String(args?.task_id ?? "")}" in team ${record.teamId}`);
        const claimant = String(args?.claimant ?? sessionIdOf(exec));
        const contract = claimContract(workspace, {
          id: task.id,
          subject: task.subject,
          description: task.description,
          blockedBy: task.blockedBy,
          writeScopes: task.writeScopes,
          revision: task.revision
        }, claimant, now());
        const claimed = updateTeamTask(record, task.id, { status: "in_progress", owner: claimant === "" ? undefined : claimant, attempt: contract.attempt }, now());
        writeTeam(workspace, claimed);
        const view = claimed.tasks.find((candidate) => candidate.id === task.id) ?? task;
        return { contract, task: view };
      }
      throw new Error(`agent_teams_task: unknown action "${action}" (claim | contract | release)`);
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description: "Pair READY shared tasks with IDLE members. `run` pairs each ready task with one idle member, tells that member to work it, and RECORDS the pairing — so a second pass can never hand the same task to two members. Tasks it does not pair are reported with the reason (blocked, completed, already dispatched, no free member). `release` frees a pairing.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "release"], description: "What to do." },
        task_id: { type: "string", description: "release: the task to free." },
        dry_run: { type: "boolean", description: "run: report the pairing and send nothing." },
        limit: { type: "number", description: "run: cap the pairs in this pass (0 or omitted = no cap)." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, refused: { type: "string" }, holdRead: { type: "string" }, forgotten: { type: "array", items: { type: "string" } }, released: { type: "boolean" } } },
      render: (_args, value) => text(value?.released !== undefined ? value.released ? "released" : "that task was not dispatched" : value?.halted !== undefined ? `halted: ${value.halted}` : value?.refused !== undefined ? `refused: ${value.refused}` : (value?.pairs?.length ?? 0) === 0 ? "nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row) => row.subject + ": " + row.reason).join("; ") + ")") : value.pairs.map((pair) => `${pair.subject} -> ${pair.memberName}`).join(`
`))
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const action = String(args?.action ?? "");
      if (action === "release") {
        const { ledger: ledger2, released } = release(readLedger(workspace), String(args?.task_id ?? ""));
        if (released)
          writeLedger(workspace, ledger2);
        return { released };
      }
      const hold = readHold(workspace);
      const teamId = recordFor(workspace, sessionIdOf(exec))?.teamId;
      const watchdog = teamId === undefined ? { state: "free" } : readWatchdogHold(workspace, sessionIdOf(exec));
      const holdReason = hold?.reason ?? (watchdog.state === "held" ? watchdog.reason : undefined);
      const holdNote = watchdog.state === "not-readable" ? `not-readable: ${String(watchdog.reason ?? "the watchdog's hold could not be read")}` : undefined;
      let record = recordFor(workspace, sessionIdOf(exec));
      if (record === undefined)
        return { pairs: [], skipped: [], refused: "no team record in this workspace — approve a plan first" };
      const opened = record;
      const readyIds = new Set(readyTasks(opened).map((candidate) => candidate.id));
      const tasks = opened.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        ready: readyIds.has(task.id),
        blockedBy: task.blockedBy,
        ...task.owner === undefined ? {} : { ownerName: task.owner }
      }));
      const idle = new Set(idleMembers(opened).map((member) => member.name));
      const members = opened.members.map((member) => ({ id: member.executorRef ?? member.id, name: member.name, status: idle.has(member.name) ? "inactive" : "running" }));
      const pruned = reconcile(readLedger(workspace), tasks);
      const plan = planDispatch({
        tasks,
        members,
        ledger: pruned.ledger,
        ...holdReason === undefined ? {} : { hold: holdReason },
        ...typeof args?.limit === "number" ? { limit: args.limit } : {}
      });
      if (plan.halted !== undefined || args?.dry_run === true || plan.pairs.length === 0) {
        if (pruned.forgotten.length > 0)
          writeLedger(workspace, pruned.ledger);
        return { ...plan, forgotten: pruned.forgotten, ...holdNote === undefined ? {} : { holdRead: holdNote } };
      }
      let ledger = pruned.ledger;
      const sent = [];
      const skipped = [...plan.skipped];
      for (const pair of plan.pairs) {
        const task = tasks.find((candidate) => candidate.id === pair.taskId);
        try {
          await executor().send(exec.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String(task.description ?? "")), exec.signal);
          record = updateTeamTask(record, pair.taskId, { owner: pair.memberName, status: "in_progress" }, now());
          writeTeam(workspace, record);
          ledger = assign(ledger, pair, now());
          sent.push(pair);
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String(error?.message ?? error)}` });
        }
      }
      writeLedger(workspace, ledger);
      return { pairs: sent, skipped, forgotten: pruned.forgotten, ...holdNote === undefined ? {} : { holdRead: holdNote } };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_mail",
    description: "The team mailbox. `send` messages one member (through the official transport) and records it; `unread` lists what a member has NOT acknowledged; `read` acknowledges ids; `summary` counts total/unread/undelivered per member. Delivery and reading are separate facts: a message the transport accepted is still unread until the recipient acknowledges it.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "unread", "read", "summary"], description: "What to do." },
        to: { type: "string", description: "send: the member name or id to message." },
        subject: { type: "string", description: "send: one line the recipient sees first." },
        body: { type: "string", description: "send: the message." },
        member: { type: "string", description: "unread: whose inbox (defaults to the caller)." },
        ids: { type: "array", items: { type: "string" }, description: "read: the message ids to acknowledge." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" } } },
      render: (_args, value) => text(value?.refused !== undefined ? `refused: ${value.refused}` : value?.message !== undefined ? `sent ${value.message.id} to ${value.message.toName}` : value?.moved !== undefined ? `acknowledged ${value.moved.length} message(s)` : value?.summary !== undefined ? value.summary.length === 0 ? "no mail" : value.summary.map((row) => `${row.memberName}: ${row.unread} unread / ${row.total} total`).join(`
`) : (value?.messages?.length ?? 0) === 0 ? "nothing unread" : value.messages.map((mail) => `${mail.id} from ${mail.fromName}: ${mail.subject}`).join(`
`))
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      const caller = sessionIdOf(exec);
      const self = exec.agent;
      const mailTeam = recordFor(workspace, caller);
      const roster = (mailTeam?.members ?? []).map((member) => ({ id: member.id, name: member.name, status: member.status, handle: member.executorRef ?? "" }));
      const resolve3 = (name2) => roster.find((member) => member.id === name2 || member.name === name2);
      if (args?.action === "send") {
        const target = resolve3(String(args?.to ?? ""));
        if (target === undefined) {
          return { refused: `"${String(args?.to ?? "")}" is not a member of this team (members: ${roster.map((m) => m.name).join(", ") || "none"})` };
        }
        const result = send(workspace, {
          fromId: self?.session?.id ?? caller,
          fromName: self?.session?.header?.title ?? caller,
          toId: target.id,
          toName: target.name,
          subject: String(args?.subject ?? ""),
          body: String(args?.body ?? ""),
          memberIds: roster.map((member) => member.id)
        }, now());
        if (!result.ok)
          return { refused: result.detail };
        try {
          if (target.handle === "")
            throw new Error(`${target.name} has no executor handle — it was never raised`);
          await executor().send(exec.agent, target.handle, `[${result.message.subject}]

${result.message.body}`, exec.signal);
          markDelivered(workspace, [result.message.id], now());
        } catch (error) {
          rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${result.message.id} but the transport refused it: ${String(error?.message ?? error)}`);
        }
        return { message: result.message };
      }
      if (args?.action === "read") {
        return { moved: markRead(workspace, Array.isArray(args?.ids) ? args.ids.map(String) : [], now()) };
      }
      if (args?.action === "summary") {
        return { summary: summarise(readMailbox(workspace)) };
      }
      const state = readMailbox(workspace);
      const wanted = args?.member === undefined ? undefined : resolve3(String(args.member));
      const memberId = wanted?.id ?? self?.session?.id ?? caller;
      return {
        messages: unreadOf(state, memberId).map((message) => ({
          id: message.id,
          fromName: message.fromName,
          subject: message.subject,
          body: message.body,
          sentAt: message.sentAt,
          delivered: message.deliveredAt !== undefined
        })),
        undelivered: undeliveredOf(state, memberId).length,
        total: inboxOf(state, memberId).length,
        memberName: wanted?.name ?? memberId
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "agent_teams_control",
    description: 'Halt or resume the team. `halt` records a hold that stops NEW DISPATCH while leaving the team and every teammate alive — it is not an ending (use agent_teams_plan action:"delete" to end and archive a team). `resume` clears the hold.',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["halt", "resume"], description: "What to do." },
        reason: { type: "string", description: "halt: why the team is halted; shown to anyone who asks for status." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { hold: { type: "object" }, resumed: { type: "boolean" } } },
      render: (_args, value) => text(value?.resumed !== undefined ? value.resumed ? "resumed" : "was not halted" : value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`)
    },
    execute: async (args, exec) => {
      const { workspace } = where(exec);
      if (String(args?.action ?? "") === "resume")
        return { resumed: clearHold(workspace) };
      if (String(args?.action ?? "") !== "halt")
        throw new Error(`agent_teams_control: unknown action "${String(args?.action ?? "")}" (halt | resume)`);
      return { hold: placeHold(workspace, String(args?.reason ?? ""), sessionIdOf(exec), now()) };
    }
  }));
  disposers.push(dsh.registerCommand({
    name: "agent-teams",
    description: "Stage a team for the current goal: /agent-teams <what the team is for>",
    input: { hint: "what the team is for" },
    handler: async (invocation) => {
      const workspace = dsh.workspaceRoot();
      const sessionId = sessionIdOf({ agent: invocation?.agent });
      const goal = String(invocation?.rawInput ?? "").trim();
      if (goal === "") {
        return { kind: "message", text: 'Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_plan {action: "approve"}.' };
      }
      const plan = stagePlan(workspace, sessionId, { name: goal.slice(0, 60), description: goal, approval: "required" }, now());
      return {
        kind: "message",
        text: `Staged ${describePlan(plan)}.
Add members and tasks with agent_teams_plan {action: "add_member" | "create_task"}, then approve with agent_teams_plan {action: "approve"}. Nobody is spawned before that.`
      };
    }
  }));
  const root = (() => {
    try {
      return dsh.workspaceRoot();
    } catch {
      return "";
    }
  })();
  if (root !== "") {
    try {
      const staging = join5(root, ".mpd", "team", "staging");
      const pending = existsSync4(staging) ? readdirSync3(staging).filter((file) => file.endsWith(".json")).length : 0;
      const reportExecutor = () => {
        const view = (() => {
          try {
            return executor();
          } catch (error) {
            return { kind: "unavailable", reason: String(error?.message ?? error) };
          }
        })();
        rowLogLine("mpd-team-core", `[mpd-team-core] team executor: ${view.kind} (${view.reason})`);
      };
      rowLogLine("mpd-team-core", `[mpd-team-core] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${disposers.length - 1} tools + the /agent-teams command)`);
      reportExecutor();
      const mountTeamRoute = () => registerTeamRoutes(dsh.webServerOf(), {
        recordFor: (sessionId) => recordFor(dsh.workspaceRoot(), sessionId),
        workspace: () => dsh.workspaceRoot(),
        executor: () => {
          const view = executor();
          return { kind: view.kind, reason: view.reason };
        },
        effect: (fn, label) => {
          try {
            return ctx?.effect?.(fn, label);
          } catch {
            return;
          }
        },
        warn: (line) => rowLogLine("mpd-team-core", `[mpd-team-core] ${line}`)
      });
      if (mountTeamRoute())
        rowLogLine("mpd-team-core", `[mpd-team-core] team web routes: ${TEAM_ROUTES.join(" ")}`);
      try {
        dsh.onServiceBound(["webServer", "httpServer"], () => {
          mountTeamRoute();
        });
      } catch {}
      try {
        dsh.onServiceBound(["subagents"], () => reportExecutor());
      } catch {}
    } catch {}
  }
  if (typeof ctx?.on === "function")
    ctx.on("dispose", () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {}
      }
    });
}
export {
  TEAMS_SERVICE,
  addMember,
  addTask,
  apply,
  archivePathFor,
  archivePlan,
  claimContract,
  clearHold,
  inject,
  listContracts,
  moveIntoArchive,
  name,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  teamRoot,
  writePlan
};
