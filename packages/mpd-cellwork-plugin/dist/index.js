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
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
    if (file === root)
      return root;
    const rel = relative(root, file);
    if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
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
function modelDeclaresNoEffort(catalog, provider, model) {
  const entry = catalog.providers.find((p) => p.id === provider)?.models.find((m) => m.id === model);
  return entry !== undefined && Array.isArray(entry.efforts) && entry.efforts.length === 0;
}
function routePositivelyListed(catalog, provider, model) {
  return catalog.providers.some((p) => p.id === provider && p.models.some((m) => m.id === model));
}
function adaptEffortWithCatalog(catalog, route) {
  const effort = typeof route.reasoningEffort === "string" ? route.reasoningEffort : "";
  if (effort === "")
    return route;
  if (!modelDeclaresNoEffort(catalog, route.provider, route.model))
    return route;
  const adapted = { ...route };
  delete adapted.reasoningEffort;
  rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: ${route.provider}/${route.model} declares no reasoning efforts — the "${effort}" effort is omitted (a keyword this model cannot take fails the call)`);
  return adapted;
}
async function resolveRunRoute(dsh, primary, fallbacks = []) {
  const wellFormed = [];
  let dropped = 0;
  for (const entry of Array.isArray(fallbacks) ? fallbacks : []) {
    if (entry === null || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const candidate = entry;
    if (typeof candidate.provider !== "string" || candidate.provider.trim() === "" || typeof candidate.model !== "string" || candidate.model.trim() === "" || candidate.reasoningEffort !== undefined && candidate.reasoningEffort !== null && typeof candidate.reasoningEffort !== "string") {
      dropped += 1;
      continue;
    }
    const effort = typeof candidate.reasoningEffort === "string" ? candidate.reasoningEffort.trim() : "";
    wellFormed.push({ provider: candidate.provider.trim(), model: candidate.model.trim(), ...effort === "" ? {} : { reasoningEffort: effort } });
  }
  let catalog;
  if (typeof dsh?.llmCatalog === "function") {
    try {
      catalog = await dsh.llmCatalog();
    } catch {
      catalog = undefined;
    }
  }
  let index = 0;
  if (catalog !== undefined && !routePositivelyListed(catalog, primary.provider, primary.model)) {
    const found = wellFormed.findIndex((candidate) => routePositivelyListed(catalog, candidate.provider, candidate.model));
    if (found >= 0)
      index = found + 1;
  }
  const winner = index === 0 ? primary : wellFormed[index - 1];
  if (index > 0) {
    rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: ${primary.provider}/${primary.model} is not listed by the model catalog — agent-route fallback #${index} (${winner.provider}/${winner.model}) wins for this run`);
  }
  if (dropped > 0) {
    rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: ${dropped} malformed fallback entr${dropped === 1 ? "y was" : "ies were"} dropped from the agent route's chain (never fatal — the run proceeds)`);
  }
  const route = catalog === undefined ? winner : adaptEffortWithCatalog(catalog, winner);
  return { route, index, fallback: index > 0, dropped };
}
var AGENT_UNCONFIGURED_CODE = "AGENT_UNCONFIGURED";
function agentUnconfiguredMessage(agent, detail) {
  return AGENT_UNCONFIGURED_CODE + ": " + agent + " is not usable — " + detail + "; nothing was written and no child was started. Configure it with /mpd-model, or set agentRoutes." + agent + " in .mpd/mpd.jsonc.";
}
function rosterNameHead(label) {
  if (typeof label !== "string")
    return "";
  return label.split(/[—–:|]|\s-\s/)[0]?.trim() ?? "";
}
function memberIdentityCandidates(identity) {
  const candidates = [];
  if (typeof identity?.role === "string" && identity.role.trim() !== "")
    candidates.push(identity.role.trim());
  const head = rosterNameHead(identity?.description);
  if (head !== "")
    candidates.push(head);
  if (typeof identity?.name === "string" && identity.name.trim() !== "")
    candidates.push(identity.name.trim());
  const seen = new Set;
  const unique = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}
function resolveTeamMemberRoute(identity, agentRouteResolutionOf) {
  if (typeof agentRouteResolutionOf !== "function")
    return { status: "no-config-service" };
  for (const candidate of memberIdentityCandidates(identity)) {
    let answer;
    try {
      answer = agentRouteResolutionOf(candidate);
    } catch {
      continue;
    }
    if (answer === null || typeof answer !== "object")
      continue;
    const routeAnswer = answer;
    const agentName = typeof routeAnswer.agent === "string" && routeAnswer.agent !== "" ? routeAnswer.agent : candidate;
    if (routeAnswer.ok === true) {
      const provider = typeof routeAnswer.route?.provider === "string" ? routeAnswer.route.provider.trim() : "";
      const model = typeof routeAnswer.route?.model === "string" ? routeAnswer.route.model.trim() : "";
      if (provider === "" || model === "") {
        return {
          status: "unusable",
          member: candidate,
          reason: "invalid",
          detail: agentUnconfiguredMessage(agentName, "the mpdConfig service reported a usable agent route but returned no provider/model")
        };
      }
      const effort = typeof routeAnswer.route?.reasoningEffort === "string" ? routeAnswer.route.reasoningEffort.trim() : "";
      return {
        status: "routed",
        member: candidate,
        route: { provider, model, ...effort === "" ? {} : { reasoningEffort: effort } },
        fallbacks: Array.isArray(routeAnswer.route?.fallbacks) ? routeAnswer.route.fallbacks : []
      };
    }
    if (routeAnswer.ok === false) {
      if (routeAnswer.reason === "unrouted")
        continue;
      if (routeAnswer.reason === "unconfigured" || routeAnswer.reason === "invalid") {
        const detail = routeAnswer.reason === "invalid" ? String(routeAnswer.problem ?? "agentRoutes." + agentName) + " must be a string" : "missing " + (Array.isArray(routeAnswer.missing) && routeAnswer.missing.length > 0 ? routeAnswer.missing.map(String).join(", ") : "agentRoutes." + agentName + ".provider, agentRoutes." + agentName + ".model");
        return {
          status: "unusable",
          member: candidate,
          reason: routeAnswer.reason,
          detail: agentUnconfiguredMessage(agentName, detail)
        };
      }
    }
  }
  return { status: "unmatched" };
}
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
function workspaceRootOfAgent(agent) {
  const session = sessionCwdOf(agent);
  if (session !== undefined)
    return resolve2(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve2(override);
  return process.cwd();
}
function workspaceRootOf(exec) {
  if (exec?.agent !== undefined && exec?.agent !== null)
    return workspaceRootOfAgent(exec.agent);
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
function unknownRestrictedNames(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!/names unknown global tool/.test(message))
    return;
  const head = message.split("; known global tools:")[0] ?? "";
  const names = [...head.matchAll(/"([^"]+)"/g)].map((match) => String(match[1] ?? "")).filter((name) => name !== "");
  return names.length > 0 ? names : undefined;
}
function applyScopedRestriction(agent, filter) {
  const context = scopeContextOf(agent);
  const tools = context?.tools;
  if (typeof tools?.restrict !== "function") {
    throw new Error("mpd-dsh-adapter: the agent's own scope exposes no tools.restrict() — cannot apply a tool restriction to it");
  }
  const applied = tools.restrict(filter);
  return typeof applied === "function" ? applied : noop;
}
function restrictAgentToolsRetained(agent, names) {
  let candidate = [...names];
  const pruned = [];
  for (let attempt = 0;; attempt += 1) {
    if (candidate.length === 0) {
      throw new Error("every name in the read-only deny was rejected as unknown, so nothing would be denied");
    }
    try {
      applyScopedRestriction(agent, { deny: candidate });
      return { applied: [...candidate], pruned };
    } catch (error) {
      const unknown = attempt === 0 ? unknownRestrictedNames(error) : undefined;
      if (unknown === undefined)
        throw error;
      const next = candidate.filter((name) => !unknown.includes(name));
      if (next.length === candidate.length)
        throw error;
      pruned.push(...candidate.filter((name) => unknown.includes(name)));
      candidate = next;
    }
  }
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
function workspaceRootForSessionOf(agents, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "")
    return;
  if (agents === undefined || agents === null || typeof agents.list !== "function")
    return;
  try {
    const list = agents.list();
    if (!Array.isArray(list))
      return;
    for (const agent of list) {
      const id = agent?.session?.id;
      if (typeof id === "string" && id === sessionId) {
        return workspaceRootOfAgent(agent);
      }
    }
  } catch {
    return;
  }
  return;
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
function registerAgentSection(agent, section) {
  const systemPrompt = agentSystemPromptOf(agent);
  if (systemPrompt === undefined) {
    throw new Error(`mpd-dsh-adapter: the agent's own scope exposes no systemPrompt.section() — cannot register prompt section "` + String(section?.name) + '" for it');
  }
  const registered = systemPrompt.section(section);
  return typeof registered === "function" ? registered : noop;
}
var CONTINUABLE_START_MEMBERS = ["startActivation", "startContinuable"];
function hasOneShotSpawn(subagents) {
  return typeof subagents?.startActivation === "function" || typeof subagents?.start === "function";
}
function continuableStartMember(subagents) {
  for (const member of CONTINUABLE_START_MEMBERS)
    if (typeof subagents?.[member] === "function")
      return member;
  return;
}
async function startContinuableChild(subagents, spec, action) {
  const member = continuableStartMember(subagents);
  if (member === undefined) {
    throw new Error(`mpd-dsh-adapter: the harness subagents service exposes neither startActivation() nor startContinuable() — ${action}`);
  }
  const argument = member === "startActivation" ? { ...spec, delivery: "parent" } : spec;
  return subagents[member].call(subagents, argument);
}
async function releaseActivation(activation) {
  const dispose = activation?.dispose;
  if (typeof dispose !== "function")
    return;
  try {
    await dispose.call(activation);
  } catch {}
}
var REPORTED_RETIRED_SPAWN_FIELDS = new Set;
function warnRetiredSpawnFields(spec) {
  for (const field of ["persona", "toolFilter"]) {
    if (spec[field] === undefined || REPORTED_RETIRED_SPAWN_FIELDS.has(field))
      continue;
    REPORTED_RETIRED_SPAWN_FIELDS.add(field);
    try {
      rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: spawnAgent was given "${field}", which harness 0.2.1-rc.2 removed from the start request — it is NOT forwarded, so the child runs without it (the selected preset owns persona and tool composition now)`);
    } catch {}
  }
}
function textOfOutput(output) {
  if (typeof output === "string")
    return output;
  if (!Array.isArray(output))
    return "";
  const parts = [];
  for (const block of output) {
    const candidate = block;
    if (candidate?.type === "text" && typeof candidate.text === "string")
      parts.push(candidate.text);
  }
  return parts.join("");
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
  const configAgentRouteResolver = () => {
    const config2 = service("mpdConfig");
    if (config2 === undefined || config2 === null)
      return;
    if (typeof config2.agentRouteResolutionOf !== "function")
      return;
    return (member) => {
      try {
        const answer = config2.agentRouteResolutionOf.call(config2, member);
        return answer !== null && typeof answer === "object" && typeof answer.ok === "boolean" ? answer : undefined;
      } catch {
        return;
      }
    };
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
  const workspaceRootForSession = (sessionId) => {
    try {
      return workspaceRootForSessionOf(service("agents"), sessionId);
    } catch {
      return;
    }
  };
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
  function contextPressureSession(target) {
    if (typeof target === "string") {
      const id = target.trim();
      if (id === "")
        return;
      const sessions = service("sessions");
      if (sessions !== undefined && sessions !== null && typeof sessions.get === "function") {
        try {
          const found = sessions.get(id);
          if (found !== undefined && found !== null)
            return found;
        } catch {}
      }
      return liveAgent(id)?.session;
    }
    if (target === undefined || target === null || typeof target !== "object")
      return;
    const session = target.session;
    if (session !== undefined && session !== null)
      return session;
    return target;
  }
  function finiteNumberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function contextPressure(target) {
    const session = contextPressureSession(target);
    if (session === undefined)
      return { usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" };
    const projections = service("sessionProjections");
    if (projections === undefined || projections === null || typeof projections.stateOf !== "function") {
      return { usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" };
    }
    let state;
    try {
      state = projections.stateOf(session, "contextPressure");
    } catch {
      return { usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" };
    }
    if (state === undefined || state === null || typeof state !== "object") {
      return { usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" };
    }
    const stateFields = state;
    let snapshot;
    try {
      snapshot = typeof projections.snapshot === "function" ? projections.snapshot(session, ["contextPressure"]) : undefined;
    } catch {
      snapshot = undefined;
    }
    const snapshotValues = snapshot !== undefined && snapshot !== null && typeof snapshot === "object" ? snapshot.values : undefined;
    const view = snapshotValues !== undefined && snapshotValues !== null && typeof snapshotValues === "object" ? snapshotValues.contextPressure : undefined;
    const viewFields = view !== undefined && view !== null && typeof view === "object" ? view : undefined;
    const projectedTokens = finiteNumberOrNull(viewFields?.projectedTokens);
    const pressureTokens = finiteNumberOrNull(viewFields?.pressureTokens) ?? finiteNumberOrNull(stateFields.pressureTokens);
    const usedTokens = projectedTokens ?? pressureTokens;
    const windowTokens = finiteNumberOrNull(stateFields.contextWindow);
    if (windowTokens === null)
      return { usedTokens, windowTokens: null, ratio: null, provenance: "no-window" };
    const ratio = usedTokens !== null && usedTokens > 0 && windowTokens > 0 ? usedTokens / windowTokens : null;
    return { usedTokens, windowTokens, ratio, provenance: "observed" };
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
          const contextWindow = finiteNumberOrNull(resolved?.context?.contextWindow);
          const maxOutputTokens = finiteNumberOrNull(resolved?.defaultMaxTokens);
          entries.push({
            id: modelId,
            name: catalogLabel(rawModel?.name, modelId),
            ...typeof rawModel?.description === "string" ? { description: rawModel.description } : {},
            efforts,
            ...defaultEffort === undefined ? {} : { defaultEffort },
            contextWindow,
            maxOutputTokens
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
        let agentOptions = request.agentOptions;
        if (agentOptions === undefined) {
          const outcome = resolveTeamMemberRoute({ role: request.role, description: request.description, name: request.name }, configAgentRouteResolver());
          if (outcome.status === "routed") {
            const resolved = await resolveRunRoute({ llmCatalog }, outcome.route, outcome.fallbacks);
            agentOptions = resolved.route;
          } else {
            const line = outcome.status === "unusable" ? `mpd-dsh-adapter: team member "${request.name}" inherits the staging session's route — its agent route is unusable: ${outcome.detail}` : outcome.status === "no-config-service" ? `mpd-dsh-adapter: team member "${request.name}" inherits the staging session's route — no mpdConfig service is mounted (is the mpd-config row present?)` : `mpd-dsh-adapter: team member "${request.name}" inherits the staging session's route — its role, description head and name name no roster member`;
            rowLogLine("mpd-dsh-adapter", line);
          }
        }
        const spec = {
          provider: typeof request.provider === "string" && request.provider !== "" ? request.provider : "spawn",
          label: `${request.name} · ${request.teamId}`,
          request: {
            prompt: textBlock(request.prompt),
            parent: caller,
            ...agentOptions === undefined ? {} : { agentOptions },
            ...request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }
          },
          signal: request.signal ?? neverAborted()
        };
        const started = await startContinuableChild(subagents, spec, `cannot raise team member "${request.name}"`);
        const handle = String(started?.childId ?? started?.id ?? "");
        if (handle === "") {
          await releaseActivation(started);
          throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id — the activation was RELEASED, so no slot is held`);
        }
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
        subagentsSpawn: hasOneShotSpawn(subagents),
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
        subagentsContinuable: continuableStartMember(subagents) !== undefined,
        teamExecutorNative: continuableStartMember(subagents) !== undefined,
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
    workspaceRootForSession,
    rowLog,
    liveAgents,
    liveAgent,
    contextPressure,
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
    webRequestRejection(request) {
      try {
        if (typeof ctx?.get !== "function")
          return 401;
        const connection = ctx.get("connection", false);
        if (connection === undefined || typeof connection.requestRejection !== "function")
          return 401;
        const headers = request?.headers;
        return connection.requestRejection({ headers: typeof headers === "object" && headers !== null ? headers : {} }) ?? undefined;
      } catch {
        return 401;
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
      const route = {
        ...spec.provider === undefined ? {} : { provider: spec.provider },
        ...spec.model === undefined ? {} : { model: spec.model },
        ...spec.agentOptions ?? {}
      };
      const provider = spec.mode ?? "spawn";
      const prompt = typeof spec.prompt === "string" ? textBlock(spec.prompt) : spec.prompt;
      const signal = spec.signal ?? neverAborted();
      if (typeof subagents.startActivation === "function") {
        warnRetiredSpawnFields(spec);
        const activation = await subagents.startActivation.call(subagents, {
          provider,
          label: spec.label,
          request: {
            prompt,
            parent: spec.parent,
            ...Object.keys(route).length === 0 ? {} : { agentOptions: route },
            ...spec.agentPreset === undefined ? {} : { agentPreset: spec.agentPreset },
            ...spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema },
            ...spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }
          },
          signal,
          delivery: "parent"
        });
        const settled = await (activation?.result ?? {});
        await releaseActivation(activation);
        return {
          output: textOfOutput(settled.output),
          structured: settled.structured,
          stopReason: typeof settled.stopReason === "string" ? settled.stopReason : null
        };
      }
      if (typeof subagents.start !== "function")
        throw new Error("mpd-dsh-adapter: the harness subagent service exposes neither startActivation() nor start()");
      const run = await subagents.start(provider, {
        label: spec.label,
        prompt,
        ...spec.parent === undefined ? {} : { parent: spec.parent },
        signal,
        ...Object.keys(route).length === 0 ? {} : { agentOptions: route },
        ...spec.persona === undefined ? {} : { persona: spec.persona },
        ...spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema },
        ...spec.toolFilter === undefined ? {} : { toolFilter: spec.toolFilter },
        ...spec.maxDepth === undefined ? {} : { maxDepth: spec.maxDepth }
      });
      const result = await (run?.result ?? {});
      return {
        output: textOfOutput(result.output),
        structured: result.structured,
        stopReason: typeof result.stopReason === "string" ? result.stopReason : null
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
      if (continuableStartMember(subagents) === undefined) {
        throw new Error("mpd-dsh-adapter: the harness subagents service exposes neither startActivation() nor startContinuable()");
      }
      return startContinuableChild(subagents, spec, "cannot start a continuable agent");
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
      const nativeMember = continuableStartMember(service("subagents"));
      const nativeReady = nativeMember !== undefined;
      const officialReady = service("agentTeams") !== undefined;
      const chosen = override === "official" && officialReady ? "official" : override === "native" && nativeReady ? "native" : nativeReady ? "native" : officialReady ? "official" : "native";
      if (chosen === "official")
        return officialTeamExecutor();
      return nativeTeamExecutor(nativeReady ? override === undefined ? `native: the default backend — bound ${String(nativeMember)}() on the harness subagent seam, and it needs nothing from the official plugin` : `native: chosen by MPD_DSH_TEAM_EXECUTOR=native, bound ${String(nativeMember)}() on the harness subagent seam` : "native UNAVAILABLE: the harness subagents service exposes neither startActivation() nor startContinuable(), and no team service is mounted either — every team call will refuse", nativeReady);
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
      return registerAgentSection(agent, section);
    },
    subagentLabelOf(agent) {
      const session = agent?.session;
      if (session === undefined || session === null)
        return;
      try {
        const events = typeof session.ownEvents === "function" ? session.ownEvents() : undefined;
        if (Array.isArray(events)) {
          for (const event of events) {
            const candidate = event;
            if (candidate?.type !== "subagent/descriptor")
              continue;
            const label = candidate.data?.label;
            return typeof label === "string" && label !== "" ? label : undefined;
          }
        }
      } catch {}
      const projections = service("sessionProjections");
      if (typeof projections?.stateOf !== "function")
        return;
      try {
        const state = projections.stateOf(session, "subagent");
        const label = state?.label;
        return typeof label === "string" && label !== "" ? label : undefined;
      } catch {
        return;
      }
    },
    restrictAgentTools(agent, filter) {
      return applyScopedRestriction(agent, filter);
    },
    restrictAgentToolsRetained(agent, names) {
      return restrictAgentToolsRetained(agent, names);
    },
    applyPersonaSection(agent, text) {
      return registerAgentSection(agent, { name: "deployment:persona-prefix", order: 0, text, interpolate: false });
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
function resolveDshAdapter(ctx, options = {}) {
  const mounted = probeMpdDsh(ctx, true);
  if (mounted.value !== undefined)
    return mounted.value;
  const warn = options.warn ?? ((line) => rowLogLine("mpd-dsh-adapter", line));
  warn(probeMpdDsh(ctx, false).missing ? adapterFallbackWarning() : adapterPendingWarning());
  return createDshAdapter(ctx);
}
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

// packages/mpd-cellwork-plugin/src/state.ts
import { appendFileSync, existsSync, mkdirSync as mkdirSync2, readFileSync, readdirSync, renameSync as renameSync2, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
var CELLWORK_STATE_VERSION = 1;
var CELLWORK_ROOT_SEGMENTS = [".mpd", "cellwork"];
var CELL_STATE_FILE = "state.json";
var CELL_JOURNAL_FILE = "journal.jsonl";
var CELL_REQUIREMENTS_FILE = "requirements.md";
var CELL_SPLIT_DIR = "split";
var CELL_CONTRACTS_DIR = "contracts";
var CELL_HANDOFF_DIR = "handoff";
var CELL_PHASES = ["requirements", "split", "executing", "stopped"];
var CELL_MEMBER_MODES = ["member", "verifier", "checkpoint", "subcaptain"];
function cellworkRoot(workspace) {
  return join2(workspace, ...CELLWORK_ROOT_SEGMENTS);
}
function cellDir(workspace, cellId) {
  return join2(cellworkRoot(workspace), cellId);
}
function statePath(workspace, cellId) {
  return join2(cellDir(workspace, cellId), CELL_STATE_FILE);
}
function journalPath(workspace, cellId) {
  return join2(cellDir(workspace, cellId), CELL_JOURNAL_FILE);
}
function requirementsPath(workspace, cellId) {
  return join2(cellDir(workspace, cellId), CELL_REQUIREMENTS_FILE);
}
function splitPath(workspace, cellId, revision) {
  return join2(cellDir(workspace, cellId), CELL_SPLIT_DIR, String(revision) + ".json");
}
function refusedSplitPath(workspace, cellId, revision) {
  return join2(cellDir(workspace, cellId), CELL_SPLIT_DIR, String(revision) + ".refused.json");
}
function contractPath(workspace, cellId, taskKey) {
  return join2(cellDir(workspace, cellId), CELL_CONTRACTS_DIR, taskKey + ".md");
}
function handoffPath(workspace, cellId, member, ordinal) {
  return join2(cellDir(workspace, cellId), CELL_HANDOFF_DIR, member + "-" + String(ordinal) + ".md");
}
function cellIdAt(now) {
  return "cell-" + now.toISOString().replace(/[-:.]/g, "");
}
function freeCellId(workspace, now) {
  let instant = now.getTime();
  for (let attempt = 0;attempt < 1000; attempt++) {
    const candidate = cellIdAt(new Date(instant));
    if (!existsSync(cellDir(workspace, candidate)))
      return candidate;
    instant += 1;
  }
  return cellIdAt(new Date(now.getTime())) + "-" + Math.random().toString(36).slice(2, 8);
}
function newCellState(input) {
  const stamp = input.now.toISOString();
  return {
    version: CELLWORK_STATE_VERSION,
    cellId: input.cellId,
    phase: "requirements",
    archived: false,
    objective: input.objective,
    createdAt: stamp,
    updatedAt: stamp,
    captainSessionId: input.captainSessionId,
    depth: input.depth ?? 0,
    parentCellId: input.parentCellId ?? null,
    teamId: "",
    parentTeamId: "",
    subcellIds: [],
    requirementsRevision: 0,
    splitRevision: null,
    activatedRevision: null,
    activatedTasks: {},
    activatedLoops: {},
    activationInFlight: null,
    cancelledTasks: {},
    splitStale: false,
    startedAt: "",
    stopReason: "",
    members: {},
    checkpoints: [],
    journalCursor: 0
  };
}
function listCellIds(workspace) {
  const root = cellworkRoot(workspace);
  if (!existsSync(root))
    return [];
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("cell-")).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}
function readCell(workspace, cellId) {
  const path = statePath(workspace, cellId);
  if (!existsSync(path))
    return { ok: false, reason: "missing", path, detail: "no state file at this path" };
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, reason: "unreadable", path, detail: errorText(error) };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: "corrupt", path, detail: "not valid JSON: " + errorText(error) };
  }
  const declaredVersion = isRecord2(parsed) ? parsed.version : undefined;
  if (typeof declaredVersion === "number" && declaredVersion !== CELLWORK_STATE_VERSION) {
    return {
      ok: false,
      reason: "version",
      path,
      detail: "state version " + String(declaredVersion) + " is not the version this build reads (" + String(CELLWORK_STATE_VERSION) + ")"
    };
  }
  const state = normalizeCellState(parsed);
  if (state === null)
    return { ok: false, reason: "corrupt", path, detail: "the record does not have the shape of a cell state" };
  return { ok: true, state, path };
}
function writeCell(workspace, state) {
  const dir = cellDir(workspace, state.cellId);
  for (const sub of ["", CELL_SPLIT_DIR, CELL_CONTRACTS_DIR, CELL_HANDOFF_DIR]) {
    mkdirSync2(sub === "" ? dir : join2(dir, sub), { recursive: true });
  }
  const stamped = { ...state, version: CELLWORK_STATE_VERSION, updatedAt: new Date().toISOString() };
  atomicWriteText(statePath(workspace, state.cellId), JSON.stringify(stamped, null, 2) + `
`);
  return stamped;
}
function appendJournal(workspace, cellId, entry, now) {
  const path = journalPath(workspace, cellId);
  try {
    mkdirSync2(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ at: now.toISOString(), ...entry }) + `
`, "utf8");
    return readFileSync(path, "utf8").split(`
`).filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
}
function readActiveCell(workspace) {
  for (const cellId of listCellIds(workspace)) {
    const read = readCell(workspace, cellId);
    if (!read.ok) {
      return read;
    }
    if (read.state.phase !== "stopped")
      return { ok: true, cell: { state: read.state, dir: cellDir(workspace, cellId) } };
  }
  return { ok: true, cell: null };
}
function recordTransition(workspace, next, entry, now) {
  const lines = appendJournal(workspace, next.cellId, entry, now);
  const stamped = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor };
  return writeCell(workspace, stamped);
}
function atomicWriteText(file, text) {
  const tmp = join2(dirname(file), "." + file.split("/").pop() + ".tmp-" + String(process.pid) + "-" + String(tempCounter++));
  mkdirSync2(dirname(file), { recursive: true });
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync2(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}
var tempCounter = 0;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function textField(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}
function normalizeMember(name, raw) {
  if (!isRecord2(raw))
    return null;
  const mode = CELL_MEMBER_MODES.find((candidate) => candidate === raw.mode) ?? "member";
  return {
    name: textField(raw.name) ?? name,
    role: typeof raw.role === "string" ? raw.role : "",
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "",
    executorRef: typeof raw.executorRef === "string" ? raw.executorRef : "",
    mode,
    handoffReady: raw.handoffReady === true,
    handoffs: typeof raw.handoffs === "number" ? raw.handoffs : 0,
    joinedAt: typeof raw.joinedAt === "string" ? raw.joinedAt : ""
  };
}
function stringMap(value) {
  const kept = {};
  if (!isRecord2(value))
    return kept;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string")
      kept[key] = entry;
  }
  return kept;
}
function normalizeCellState(raw) {
  if (!isRecord2(raw))
    return null;
  const cellId = textField(raw.cellId);
  const phase = CELL_PHASES.find((candidate) => candidate === raw.phase);
  const captainSessionId = textField(raw.captainSessionId);
  if (cellId === undefined || phase === undefined || captainSessionId === undefined)
    return null;
  if (typeof raw.version !== "number")
    return null;
  const members = {};
  if (isRecord2(raw.members)) {
    for (const [name, value] of Object.entries(raw.members)) {
      const member = normalizeMember(name, value);
      if (member !== null)
        members[name] = member;
    }
  }
  const checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints.filter(isRecord2).map((entry) => ({
    sessionId: typeof entry.sessionId === "string" ? entry.sessionId : "",
    at: typeof entry.at === "string" ? entry.at : "",
    usedTokens: typeof entry.usedTokens === "number" ? entry.usedTokens : null,
    contextWindow: typeof entry.contextWindow === "number" ? entry.contextWindow : null,
    turn: typeof entry.turn === "number" ? entry.turn : 0
  })) : [];
  return {
    version: CELLWORK_STATE_VERSION,
    cellId,
    phase,
    archived: raw.archived === true,
    objective: typeof raw.objective === "string" ? raw.objective : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    captainSessionId,
    depth: typeof raw.depth === "number" ? raw.depth : 0,
    parentCellId: typeof raw.parentCellId === "string" ? raw.parentCellId : null,
    teamId: typeof raw.teamId === "string" ? raw.teamId : "",
    parentTeamId: typeof raw.parentTeamId === "string" ? raw.parentTeamId : "",
    subcellIds: Array.isArray(raw.subcellIds) ? raw.subcellIds.map(String) : [],
    requirementsRevision: typeof raw.requirementsRevision === "number" ? raw.requirementsRevision : 0,
    splitRevision: typeof raw.splitRevision === "number" ? raw.splitRevision : null,
    activatedRevision: typeof raw.activatedRevision === "number" ? raw.activatedRevision : null,
    activatedTasks: stringMap(raw.activatedTasks),
    activatedLoops: stringMap(raw.activatedLoops),
    activationInFlight: typeof raw.activationInFlight === "number" ? raw.activationInFlight : null,
    cancelledTasks: stringMap(raw.cancelledTasks),
    splitStale: raw.splitStale === true,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : "",
    stopReason: typeof raw.stopReason === "string" ? raw.stopReason : "",
    members,
    checkpoints,
    journalCursor: typeof raw.journalCursor === "number" ? raw.journalCursor : 0
  };
}

// packages/mpd-cellwork-plugin/src/caller.ts
function sessionIdOf(agent) {
  const handle = typeof agent === "object" && agent !== null ? agent : undefined;
  if (handle === undefined)
    return "";
  const session = typeof handle.session === "object" && handle.session !== null ? handle.session : undefined;
  for (const candidate of [session?.id, handle.sessionId, handle.id]) {
    if (typeof candidate === "string" && candidate !== "")
      return candidate;
  }
  return "";
}
function callerContext(dsh, exec, deps = {}) {
  let workspace = "";
  try {
    workspace = dsh.workspaceRoot(exec);
  } catch {
    workspace = "";
  }
  const sessionId = sessionIdOf(exec?.agent);
  if (workspace === "")
    return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: null };
  const scan = liveTree(workspace);
  if (scan.refusal !== null)
    return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: scan.refusal };
  if (scan.cells.length === 0)
    return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: null };
  const ordered = [...scan.cells].sort((left, right) => right.depth - left.depth || compareIds(right.state.cellId, left.state.cellId));
  for (const candidate of ordered) {
    const held = seatIn(candidate.state, workspace, sessionId, deps);
    if (held !== undefined)
      return { workspace, sessionId, member: held.member, seat: held.seat, cell: candidate.state, refusal: null };
  }
  const oldest = [...scan.cells].sort((left, right) => compareIds(left.state.cellId, right.state.cellId))[0];
  return { workspace, sessionId, member: "", seat: undefined, cell: oldest.state, refusal: null };
}
function liveTree(workspace) {
  const live = [];
  for (const cellId of listCellIds(workspace)) {
    const read = readCell(workspace, cellId);
    if (!read.ok)
      return { cells: [], refusal: read };
    if (read.state.phase !== "stopped")
      live.push(read.state);
  }
  const byId = new Map(live.map((cell) => [cell.cellId, cell]));
  return { cells: live.map((cell) => ({ state: cell, depth: depthOf(cell, byId) })), refusal: null };
}
function depthOf(cell, live) {
  let depth = 0;
  let cursor = cell.parentCellId;
  const seen = new Set([cell.cellId]);
  while (cursor !== null && cursor !== "" && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = live.get(cursor);
    if (parent === undefined)
      break;
    depth += 1;
    cursor = parent.parentCellId;
  }
  return depth;
}
function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function seatIn(cell, workspace, sessionId, deps) {
  if (sessionId === "")
    return;
  if (sessionId === cell.captainSessionId)
    return { member: "captain", seat: { cellId: cell.cellId, name: "captain", mode: "captain" } };
  for (const member of Object.values(cell.members)) {
    if (member.sessionId === sessionId)
      return { member: member.name, seat: { cellId: cell.cellId, name: member.name, mode: memberMode(member.mode) } };
  }
  const rawRecord = cell.teamId === "" ? undefined : deps.teams?.()?.get?.(workspace, cell.teamId);
  const record = typeof rawRecord === "object" && rawRecord !== null ? rawRecord : undefined;
  if (record === undefined)
    return;
  const rows = Array.isArray(record.members) ? record.members.filter((row) => typeof row === "object" && row !== null) : [];
  for (const row of rows) {
    if (row.executorRef !== sessionId)
      continue;
    const name = typeof row.name === "string" && row.name !== "" ? row.name : "member";
    return { member: name, seat: { cellId: cell.cellId, name, mode: memberMode(cell.members[name]?.mode) } };
  }
  return;
}
function memberMode(mode) {
  return mode ?? "member";
}

// packages/mpd-cellwork-plugin/src/config.ts
var DEFAULT_CELLWORK_CONFIG = {
  depthMax: 3,
  checkpointRatio: 0.5,
  windowFraction: 0.25,
  fixedOverheadTokens: 32000,
  fixedOverheadByRoute: {},
  toolSchemaChars: 0,
  contractGates: [],
  outputReserveTokens: 8192,
  compactionHeadroomTokens: 65536,
  compactionRetries: 3,
  idleBarrierDelayMs: 200,
  asciiCharsPerToken: 3,
  cjkCharsPerToken: 1,
  windowOverride: null
};
var CELLWORK_CONFIG_PREFIX = "cellwork.";
var KNOB_RULES = {
  depthMax: { integer: true, min: 1, max: 8 },
  checkpointRatio: { integer: false, min: 0.01, max: 1 },
  windowFraction: { integer: false, min: 0.01, max: 1 },
  fixedOverheadTokens: { integer: true, min: 0, max: 1e7 },
  toolSchemaChars: { integer: true, min: 0, max: 1e8 },
  outputReserveTokens: { integer: true, min: 0, max: 1e6 },
  compactionHeadroomTokens: { integer: true, min: 0, max: 1e7 },
  compactionRetries: { integer: true, min: 1, max: 10 },
  idleBarrierDelayMs: { integer: true, min: 0, max: 1e4 },
  asciiCharsPerToken: { integer: false, min: 0.5, max: 16 },
  cjkCharsPerToken: { integer: false, min: 0.5, max: 16 }
};
function numberKnob(key, row, readFile, warn) {
  const fallback = DEFAULT_CELLWORK_CONFIG[key];
  if (typeof fallback !== "number") {
    throw new Error("cellwork config: " + String(key) + " has no numeric default");
  }
  const rule = KNOB_RULES[String(key)];
  if (rule === undefined)
    throw new Error("cellwork config: no rule for " + String(key));
  const declared = readFile(CELLWORK_CONFIG_PREFIX + String(key)) ?? row[String(key)];
  if (declared === undefined || declared === null)
    return fallback;
  if (typeof declared !== "number" || !Number.isFinite(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + JSON.stringify(declared) + " is not a finite number; using the default " + String(fallback));
    return fallback;
  }
  if (rule.integer && !Number.isInteger(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + String(declared) + " must be a whole number; using the default " + String(fallback));
    return fallback;
  }
  if (declared < rule.min || declared > rule.max) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + String(declared) + " is outside [" + String(rule.min) + ", " + String(rule.max) + "]; using the default " + String(fallback));
    return fallback;
  }
  return declared;
}
function overheadMapKnob(row, readFile, warn) {
  const declared = readFile(CELLWORK_CONFIG_PREFIX + "fixedOverheadByRoute") ?? row.fixedOverheadByRoute;
  if (typeof declared !== "object" || declared === null || Array.isArray(declared))
    return {};
  const accepted = {};
  for (const [route, value] of Object.entries(declared)) {
    if (route.trim() !== "" && typeof value === "number" && Number.isInteger(value) && value >= 0) {
      accepted[route.trim()] = value;
    } else {
      warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "fixedOverheadByRoute[" + JSON.stringify(route) + "] = " + JSON.stringify(value) + " is not a non-negative whole token count; it is ignored");
    }
  }
  return accepted;
}
function gateListKnob(row, readFile, warn) {
  const declared = readFile(CELLWORK_CONFIG_PREFIX + "contractGates") ?? row.contractGates;
  if (declared === undefined || declared === null)
    return [];
  if (!Array.isArray(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "contractGates = " + JSON.stringify(declared) + " is not an array of commands; the frozen contracts will name the repository's own gates instead");
    return [];
  }
  return declared.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
}
function resolveCellworkConfig(rowConfig, readFile, warn) {
  const row = typeof rowConfig === "object" && rowConfig !== null && !Array.isArray(rowConfig) ? rowConfig : {};
  const declaredOverride = readFile(CELLWORK_CONFIG_PREFIX + "windowOverride") ?? row.windowOverride;
  let windowOverride = null;
  if (declaredOverride !== undefined && declaredOverride !== null) {
    if (typeof declaredOverride === "number" && Number.isInteger(declaredOverride) && declaredOverride > 0) {
      windowOverride = declaredOverride;
    } else {
      warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "windowOverride = " + JSON.stringify(declaredOverride) + " is not a positive whole number; no route will be certified from an override");
    }
  }
  return {
    depthMax: numberKnob("depthMax", row, readFile, warn),
    checkpointRatio: numberKnob("checkpointRatio", row, readFile, warn),
    windowFraction: numberKnob("windowFraction", row, readFile, warn),
    fixedOverheadTokens: numberKnob("fixedOverheadTokens", row, readFile, warn),
    fixedOverheadByRoute: overheadMapKnob(row, readFile, warn),
    toolSchemaChars: numberKnob("toolSchemaChars", row, readFile, warn),
    contractGates: gateListKnob(row, readFile, warn),
    outputReserveTokens: numberKnob("outputReserveTokens", row, readFile, warn),
    compactionHeadroomTokens: numberKnob("compactionHeadroomTokens", row, readFile, warn),
    compactionRetries: numberKnob("compactionRetries", row, readFile, warn),
    idleBarrierDelayMs: numberKnob("idleBarrierDelayMs", row, readFile, warn),
    asciiCharsPerToken: numberKnob("asciiCharsPerToken", row, readFile, warn),
    cjkCharsPerToken: numberKnob("cjkCharsPerToken", row, readFile, warn),
    windowOverride
  };
}

// packages/mpd-cellwork-plugin/src/guard.ts
var CAPTAIN_TOOL_PREFIXES = ["cellwork_", "agent_teams_", "mpd_memory_"];
var CAPTAIN_TOOL_NAMES = ["ask_user_question", "todo_write", "mpd_verify_open"];
var CAPTAIN_FORBIDDEN_NAMES = ["cellwork_handoff"];
var VERIFIER_DENY_TOOLS = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict"
];
var CHECKPOINT_ALLOW_TOOLS = ["cellwork_handoff", "cellwork_context", "cellwork_status"];
var SUBCAPTAIN_FORBIDDEN_NAMES = ["cellwork_start", "cellwork_stop"];
var SUBCAPTAIN_TOOL_NAMES = ["cellwork_subteam", "cellwork_activate", "cellwork_dispatch", "cellwork_supervise"];
function isCaptainAllowed(toolName) {
  if (CAPTAIN_FORBIDDEN_NAMES.includes(toolName))
    return false;
  if (CAPTAIN_TOOL_NAMES.includes(toolName))
    return true;
  return CAPTAIN_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}
function isSubcaptainAllowed(toolName) {
  if (SUBCAPTAIN_FORBIDDEN_NAMES.includes(toolName))
    return false;
  if (SUBCAPTAIN_TOOL_NAMES.includes(toolName))
    return true;
  return isCaptainAllowed(toolName);
}
function captainRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — while a cell is running the CAPTAIN DISPATCHES ONLY " + "(user clause 1): it edits no file, runs no shell, does no reconnaissance and verifies nothing. " + "Allowed here: `cellwork_*` except `cellwork_handoff` (`cellwork_status`, `cellwork_start`, " + "`cellwork_dispatch`, `cellwork_supervise`, `cellwork_activate`, `cellwork_send`, `cellwork_inbox`), " + "`agent_teams_*` (`agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail`), " + "`mpd_verify_open` (opening a loop only — binding, evidence and verdict stay refused), " + "`ask_user_question`, `todo_write` and `mpd_memory_*`. Put the work on the team: stage or extend it " + "with `agent_teams_plan`, then DISPATCH WITH `cellwork_dispatch` — owner-only, and a busy or absent " + "owner is REPORTED and the task left pending, never substituted. (`agent_teams_dispatch` stays allowed " + "but it is NOT the verb for this board: it falls back to roster order, which can hand review work to " + "its own writer.) Relay the planner's questions with `ask_user_question`. To leave the mode and get " + "every tool back, call `cellwork_stop`.";
}
function verifierRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session is a VERIFIER of the cell, so it never " + "fixes what it judges. Read the frozen contract and the documentation (not the implementation), run " + "the gates, then record the verdict with `mpd_verify_record` (a PASS needs the documents it cites " + "and its gate evidence ids); reading, `bash`, `grep`, `glob` and `mpd_verify_*` stay available. A " + "FAIL bounces the work back to its writer as a repair task, and only a RECORDED FAIL makes " + "implementation reading legitimate, for diagnosis.";
}
function checkpointRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session reached its CONTEXT CHECKPOINT, so the " + "work stops at this boundary. Call `cellwork_handoff` now with the task, the current state, the " + "decisions (and why), the artifacts, the verified facts, the open questions and the single next " + "step, then END YOUR TURN. The plugin compacts this agent's context and promotes it (or reseeds it " + "from that handoff), so anything you did not write down is lost. `cellwork_status` and " + "`cellwork_context` stay readable meanwhile.";
}
function subcaptainRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session is a SUBCAPTAIN of the cell: it builds and " + "dispatches the next-level team under the SAME rules as the captain, so it dispatches rather than works, " + "and it never edits a file, runs a shell, does reconnaissance or verifies. Allowed here: `cellwork_*` " + "except `cellwork_handoff`, `cellwork_start` and `cellwork_stop` (stage the sub-cell with " + "`cellwork_subteam`, materialise an accepted split with `cellwork_activate`, dispatch with " + "`cellwork_dispatch` and sweep with `cellwork_supervise`), `agent_teams_*`, `ask_user_question`, " + "`todo_write` and `mpd_memory_*`. Only the CAPTAIN opens or closes a cell: if this cell needs that, " + "send the request with `cellwork_send` and end your turn.";
}
function cellworkGuardDecision(seat, toolName) {
  if (seat === undefined)
    return;
  if (toolName === "")
    return;
  if (seat.mode === "captain")
    return isCaptainAllowed(toolName) ? undefined : captainRefusal(toolName);
  if (seat.mode === "verifier")
    return VERIFIER_DENY_TOOLS.includes(toolName) ? verifierRefusal(toolName) : undefined;
  if (seat.mode === "checkpoint")
    return CHECKPOINT_ALLOW_TOOLS.includes(toolName) ? undefined : checkpointRefusal(toolName);
  if (seat.mode === "subcaptain")
    return isSubcaptainAllowed(toolName) ? undefined : subcaptainRefusal(toolName);
  return;
}
function installCellworkGuard(dsh, options) {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("[mpd-cellwork] the harness exposes no tools.guard seam — the captain/verifier/checkpoint guard is NOT installed; the mode still records and its tools still refuse, but the dispatch fence is absent");
      return { installed: false, reason: "no-guard-seam" };
    }
    const dispose = dsh.guardTool((exec) => {
      try {
        const toolName = String(exec?.name ?? "");
        return cellworkGuardDecision(options.seatOf(exec), toolName);
      } catch {
        return;
      }
    });
    return { installed: true, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("[mpd-cellwork] installing the guard failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, reason: "install-failed" };
  }
}

// packages/mpd-cellwork-plugin/src/prompts.ts
var CELLWORK_USAGE = "usage: /cellwork <objective> — starts cell-work for that objective: a dedicated " + "planner runs a Socratic requirements interview through you, the requirements are split into tasks whose " + "context cost the plugin MEASURES against the executing model's own window, and the team works, hands off, " + "compacts and promotes itself. `/cellwork` is the only way to start the mode.";
function activationDirective(input) {
  const state = input.state;
  const dir = cellDir(input.workspace, state.cellId);
  return [
    "[mpd-cellwork] CELLWORK MODE IS ACTIVE — cell " + state.cellId,
    "",
    "The user started cell-work for this objective:",
    "  " + state.objective,
    "",
    "You are the CAPTAIN of this cell. From now on you DISPATCH ONLY: you do not edit files, run a shell,",
    "do reconnaissance or verify work. That is not advice — the cellwork guard refuses every other tool at",
    "the dispatch boundary with a message that names what you may call instead. Stage the work on the team,",
    "relay questions, and record what you learn with `mpd_memory_*`.",
    "",
    "PHASES (v1):",
    "1. requirements — `cellwork_start` stages the planner and splitter teammates and their two tasks. The",
    "   planner runs the Socratic interview: it mails you ONE question at a time, you put it to the user with",
    "   `ask_user_question`, and you mail the answer straight back. You author nothing and you answer nothing",
    "   yourself.",
    "2. split — when the requirements document is finalized, the splitter submits the task graph. The plugin",
    "   MEASURES every task (declared input bytes, the model's own window) and REFUSES an over-budget split",
    "   with a per-task breakdown that says what to cut. Nothing is guessed from a literal window.",
    "3. executing — `cellwork_activate` materialises the accepted split on the LIVE team record, writes one",
    "   frozen contract per code task and opens one verification loop per code task BEFORE dispatch. Dispatch",
    "   with `cellwork_dispatch`; ONLY the declared owner is paired, and a busy owner is reported, never",
    "   substituted.",
    "4. supervise — on every wake-up call `cellwork_status` / `cellwork_supervise`. A requirements change goes",
    "   to the planner, which bumps the revision and marks the current split STALE; the splitter re-submits.",
    "5. stop — `cellwork_stop` archives the cell and gives every tool back. Nothing is deleted.",
    "",
    "YOUR TOOLS IN THIS MODE: `cellwork_*` except `cellwork_handoff`, `agent_teams_*`, `ask_user_question`,",
    "`todo_write`, `mpd_memory_*`. Everything else is refused, and `cellwork_stop` is how you leave.",
    "",
    "STATE ON DISK (this is the record, not a suggestion): " + dir,
    "  " + CELL_STATE_FILE + " · " + CELL_JOURNAL_FILE + " · " + CELL_REQUIREMENTS_FILE,
    "",
    "FIRST STEP: call `cellwork_start` now, then wait for the planner's first question."
  ].join(`
`);
}

// packages/mpd-cellwork-plugin/src/requirements.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
var REQUIREMENT_SECTIONS = [
  { key: "goal", title: "Goal", aliases: ["goal", "objective", "aim"] },
  { key: "nonGoals", title: "Non-goals", aliases: ["non-goals", "non goals", "non-goal", "non goal"] },
  { key: "users", title: "Users / consumers", aliases: ["users", "users / consumers", "users and consumers", "consumers", "audience"] },
  { key: "constraints", title: "Constraints", aliases: ["constraints", "constraints and assumptions"] },
  { key: "acceptance", title: "Acceptance criteria", aliases: ["acceptance criteria", "acceptance", "definition of done", "done criteria"] },
  { key: "openQuestions", title: "Open questions", aliases: ["open questions", "open question", "questions", "unresolved questions"] }
];
function normalizeHeading(heading) {
  return heading.replace(/[*_`]/g, "").replace(/[:：]\s*$/, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function parseSections(text) {
  const sections = new Map;
  let current;
  let body = [];
  const flush = () => {
    if (current !== undefined && !sections.has(current))
      sections.set(current, body.join(`
`).trim());
    body = [];
  };
  for (const line of text.split(`
`)) {
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      flush();
      current = normalizeHeading(heading[2]);
      continue;
    }
    if (current !== undefined)
      body.push(line);
  }
  flush();
  return sections;
}
function headingSatisfies(heading, section) {
  for (const alias of section.aliases) {
    if (heading === alias)
      return true;
    if (heading.startsWith(alias) && /[ /(.-]/.test(heading.charAt(alias.length)))
      return true;
  }
  return false;
}
function validateRequirementsText(text) {
  const sections = parseSections(text);
  const readings = [];
  const missing = [];
  for (const section of REQUIREMENT_SECTIONS) {
    let matched;
    for (const heading of sections.keys()) {
      if (headingSatisfies(heading, section)) {
        matched = heading;
        break;
      }
    }
    const body = matched === undefined ? "" : sections.get(matched) ?? "";
    const chars = body.replace(/\s+/g, "").length;
    readings.push({ key: section.key, title: section.title, present: matched !== undefined, chars });
    if (matched === undefined || chars === 0)
      missing.push(section.title);
  }
  return { ok: missing.length === 0, missing, sections: readings };
}
function readRequirements(workspace, cellId) {
  const path = requirementsPath(workspace, cellId);
  if (!existsSync2(path))
    return null;
  return readFileSync2(path, "utf8");
}
function storedRequirementsText(text) {
  return text.endsWith(`
`) ? text : text + `
`;
}
function writeRequirements(workspace, cellId, text) {
  atomicWriteText(requirementsPath(workspace, cellId), storedRequirementsText(text));
}

// packages/mpd-cellwork-plugin/src/split.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// packages/mpd-cellwork-plugin/src/budget.ts
import { closeSync as closeSync2, openSync as openSync2, readSync, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join3, relative as relative2, resolve as resolve3 } from "node:path";
var CJK_BYTES_PER_CHAR = 3;
var SAMPLE_BYTES = 16384;
var CONTENT_BLOCKS = 1;
var STRUCTURAL_FRAMING_TOKENS = 4;
var PER_BLOCK_FRAMING_TOKENS = 4;
var PER_INPUT_FRAMING_TOKENS = 4;
function isCjkCodePoint(codePoint) {
  return codePoint >= 11904 && codePoint <= 12031 || codePoint >= 12288 && codePoint <= 12351 || codePoint >= 12352 && codePoint <= 12543 || codePoint >= 12544 && codePoint <= 12591 || codePoint >= 13312 && codePoint <= 19903 || codePoint >= 19968 && codePoint <= 40959 || codePoint >= 44032 && codePoint <= 55215 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65072 && codePoint <= 65103 || codePoint >= 65280 && codePoint <= 65519 || codePoint >= 131072 && codePoint <= 195103;
}
function countChars(text) {
  const counts = { ascii: 0, cjk: 0 };
  for (const character of text) {
    if (isCjkCodePoint(character.codePointAt(0) ?? 0))
      counts.cjk += 1;
    else
      counts.ascii += 1;
  }
  return counts;
}
function resolveInputPath(workspace, declared) {
  const trimmed = declared.trim();
  if (trimmed === "")
    return { path: "", error: "an input path is empty" };
  const absolute = isAbsolute2(trimmed) ? resolve3(trimmed) : resolve3(join3(workspace, trimmed));
  const rel = relative2(workspace, absolute);
  if (rel.startsWith("..") || isAbsolute2(rel))
    return { path: absolute, error: "the input path is outside the workspace" };
  return { path: absolute };
}
function measureInput(workspace, declared, config) {
  const resolvedPath = resolveInputPath(workspace, declared);
  if (resolvedPath.error !== undefined || resolvedPath.path === "") {
    return { path: declared, resolved: resolvedPath.path, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: resolvedPath.error ?? "the path could not be resolved" };
  }
  const absolute = resolvedPath.path;
  let bytes = 0;
  try {
    const info = statSync2(absolute);
    if (!info.isFile())
      return { path: declared, resolved: absolute, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input is not a regular file" };
    bytes = info.size;
  } catch (error) {
    return { path: declared, resolved: absolute, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input cannot be read (" + errorText2(error) + ")" };
  }
  const wanted = Math.min(bytes, SAMPLE_BYTES);
  const buffer = Buffer.alloc(wanted);
  let filled = 0;
  if (wanted > 0) {
    try {
      const fd = openSync2(absolute, "r");
      try {
        filled = readSync(fd, buffer, 0, wanted, 0);
      } finally {
        closeSync2(fd);
      }
    } catch (error) {
      return { path: declared, resolved: absolute, bytes, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input cannot be sampled (" + errorText2(error) + ")" };
    }
  }
  const cjkRatio = cjkByteRatio(buffer.subarray(0, filled));
  const asciiBytes = bytes * (1 - cjkRatio);
  const cjkBytes = bytes * cjkRatio;
  const tokens = Math.ceil(asciiBytes / config.asciiCharsPerToken) + Math.ceil(cjkBytes / CJK_BYTES_PER_CHAR / config.cjkCharsPerToken) + PER_INPUT_FRAMING_TOKENS;
  return { path: declared, resolved: absolute, bytes, sampledBytes: filled, cjkRatio, tokens };
}
function cjkByteRatio(sample) {
  if (sample.length === 0)
    return 0;
  const text = sample.toString("utf8");
  let cjkBytes = 0;
  let totalBytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    totalBytes += size;
    if (isCjkCodePoint(character.codePointAt(0) ?? 0))
      cjkBytes += size;
  }
  if (totalBytes === 0)
    return 0;
  return Math.min(1, Math.max(0, cjkBytes / totalBytes));
}
function estimateTask(input) {
  const text = input.subject + `
` + input.description;
  const textChars = countChars(text);
  const textTokens = Math.ceil(textChars.ascii / input.config.asciiCharsPerToken) + Math.ceil(textChars.cjk / input.config.cjkCharsPerToken);
  const fixedOverheadTokens = input.config.fixedOverheadByRoute[input.routeKey] ?? input.config.fixedOverheadTokens;
  const measuredInputsTokens = input.inputs.reduce((sum, entry) => sum + (entry.error === undefined ? entry.tokens : 0), 0);
  const toolSchemaTokens = Math.ceil(input.config.toolSchemaChars / input.config.asciiCharsPerToken) + STRUCTURAL_FRAMING_TOKENS;
  const outputReserveTokens = input.modelMaxTokens !== null && input.modelMaxTokens > 0 ? Math.min(input.config.outputReserveTokens, input.modelMaxTokens) : input.config.outputReserveTokens;
  const framingTokens = PER_BLOCK_FRAMING_TOKENS * CONTENT_BLOCKS + STRUCTURAL_FRAMING_TOKENS;
  return {
    routeKey: input.routeKey,
    textChars,
    textTokens,
    contentBlocks: CONTENT_BLOCKS,
    framingTokens,
    fixedOverheadTokens,
    inputs: [...input.inputs],
    measuredInputsTokens,
    toolSchemaTokens,
    outputReserveTokens,
    estimate: fixedOverheadTokens + textTokens + framingTokens + measuredInputsTokens + toolSchemaTokens + outputReserveTokens
  };
}
async function resolveTaskWindow(deps, role) {
  const resolution = deps.routeOf(role);
  if (resolution === undefined) {
    return { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "the route service is absent in this composition, so no window is readable for role " + JSON.stringify(role) };
  }
  if (resolution.ok !== true) {
    const missing = resolution.missing === undefined ? "" : " (missing " + resolution.missing.join(", ") + ")";
    return { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "role " + JSON.stringify(role) + " has no usable route" + missing + (resolution.reason === undefined ? "" : "; " + resolution.reason) };
  }
  const provider = typeof resolution.route?.provider === "string" ? resolution.route.provider : "";
  const model = typeof resolution.route?.model === "string" ? resolution.route.model : "";
  if (provider === "" || model === "") {
    return { provider, model, window: null, provenance: "uncertified", maxOutputTokens: null, reason: "role " + JSON.stringify(role) + " resolved to an incomplete route (provider " + JSON.stringify(provider) + ", model " + JSON.stringify(model) + ")" };
  }
  let catalog;
  try {
    catalog = await deps.catalog();
  } catch {
    catalog = undefined;
  }
  if (catalog === undefined) {
    return overrideOrUncertified(provider, model, null, deps.config, "the model catalog could not be read");
  }
  const providerRow = catalog.providers.find((row) => row.id === provider);
  const modelRow = providerRow?.models.find((row) => row.id === model);
  if (modelRow === undefined) {
    return overrideOrUncertified(provider, model, null, deps.config, "the model catalog lists no model " + JSON.stringify(model) + " for provider " + JSON.stringify(provider));
  }
  const maxOutputTokens = typeof modelRow.maxOutputTokens === "number" && modelRow.maxOutputTokens > 0 ? modelRow.maxOutputTokens : null;
  const window = typeof modelRow.contextWindow === "number" && modelRow.contextWindow > 0 ? modelRow.contextWindow : null;
  if (window !== null)
    return { provider, model, window, provenance: "catalog", maxOutputTokens };
  return overrideOrUncertified(provider, model, maxOutputTokens, deps.config, "the catalog reports no context window for " + provider + "/" + model);
}
function overrideOrUncertified(provider, model, maxOutputTokens, config, reason) {
  if (config.windowOverride !== null) {
    return { provider, model, window: config.windowOverride, provenance: "override", maxOutputTokens };
  }
  return { provider, model, window: null, provenance: "uncertified", maxOutputTokens, reason: reason + "; set cellwork.windowOverride to certify this route" };
}
function applyBudget(estimate, reading, config) {
  if (reading.window === null) {
    return {
      window: null,
      provenance: "uncertified",
      budget: null,
      modelMaxTokens: estimate.outputReserveTokens,
      compactionHeadroom: config.compactionHeadroomTokens,
      accepted: false,
      excess: null,
      reason: "uncertified: " + (reading.reason ?? "no readable context window")
    };
  }
  const budget = Math.floor(reading.window * config.windowFraction);
  const modelMaxTokens = reading.maxOutputTokens !== null ? reading.maxOutputTokens : estimate.outputReserveTokens;
  const reserveRoom = estimate.estimate + modelMaxTokens + config.compactionHeadroomTokens;
  if (estimate.estimate > budget) {
    return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: false, excess: estimate.estimate - budget, reason: "the estimate exceeds the per-task budget" };
  }
  if (reserveRoom > reading.window) {
    return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: false, excess: reserveRoom - reading.window, reason: "the estimate plus the model's max output and the compaction headroom exceeds the whole window" };
  }
  return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: true, excess: null };
}
function errorText2(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-cellwork-plugin/src/split.ts
var SPLIT_KINDS = ["requirement", "work", "review", "repair", "integration"];
var CELL_ROLES = ["cell-planner", "cell-splitter"];
function roleKey(role) {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function isSafeTaskKey(key) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) && key !== "." && key !== "..";
}
function scopesOverlap(left, right) {
  const normalize = (scope) => scope.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const a = normalize(left);
  const b = normalize(right);
  if (a === "" || b === "")
    return a === b;
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}
function validateGraph(tasks, roster) {
  const findings = [];
  const seen = new Set;
  const roles = new Set([...roster, ...CELL_ROLES].map(roleKey));
  if (tasks.length === 0) {
    findings.push({ taskKey: "", code: "empty-split", detail: "the split is empty: submit at least one task" });
    return findings;
  }
  const keys = new Set;
  for (const task of tasks)
    if (isSafeTaskKey(task.key))
      keys.add(task.key);
  for (const task of tasks) {
    if (!isSafeTaskKey(task.key)) {
      findings.push({ taskKey: task.key, code: "bad-key", detail: "task key " + JSON.stringify(task.key) + " is not usable as a graph reference and a contract file name (allowed: letters, digits, dot, dash, underscore; no path separators)" });
    } else if (seen.has(task.key)) {
      findings.push({ taskKey: task.key, code: "duplicate-key", detail: "task key " + JSON.stringify(task.key) + " is declared more than once" });
    }
    seen.add(task.key);
    if (task.subject.trim() === "")
      findings.push({ taskKey: task.key, code: "empty-subject", detail: "the task needs a non-empty subject" });
    if (task.description.trim() === "")
      findings.push({ taskKey: task.key, code: "empty-description", detail: "the task needs a non-empty description (it is the owner's acceptance text)" });
    if (!SPLIT_KINDS.includes(task.kind ?? "work"))
      findings.push({ taskKey: task.key, code: "unknown-kind", detail: "kind " + JSON.stringify(task.kind) + " is not one of " + SPLIT_KINDS.join(", ") });
    if (task.ownerRole.trim() === "") {
      findings.push({ taskKey: task.key, code: "missing-owner", detail: "the task needs an ownerRole" });
    } else if (!roles.has(roleKey(task.ownerRole))) {
      findings.push({ taskKey: task.key, code: "unknown-owner-role", detail: "ownerRole " + JSON.stringify(task.ownerRole) + " is neither a roster role nor a cell role (" + CELL_ROLES.join(", ") + ")" });
    }
    if (task.blockedBy === undefined && task.independent !== true) {
      findings.push({ taskKey: task.key, code: "no-dependency-answer", detail: "the task declares no dependency answer: pass blockedBy (an array; [] is an explicit root) or independent: true" });
    }
    if (task.kind === "review" && (task.blockedBy ?? []).length === 0) {
      findings.push({ taskKey: task.key, code: "review-without-target", detail: "a review task must be blocked by the task it reviews" });
    }
    if (task.kind === "review" && task.verify === true) {
      findings.push({ taskKey: task.key, code: "review-of-review", detail: "a review task cannot itself carry verify: true — the review IS the verification" });
    }
    for (const reference of task.blockedBy ?? []) {
      if (!keys.has(reference))
        findings.push({ taskKey: task.key, code: "unknown-blocker", detail: "blockedBy names " + JSON.stringify(reference) + ", which is not a task key in this split" });
    }
  }
  const visiting = new Set;
  const done = new Set;
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const walk = (key) => {
    if (visiting.has(key))
      return key;
    if (done.has(key))
      return;
    visiting.add(key);
    for (const reference of byKey.get(key)?.blockedBy ?? []) {
      const cyclic = walk(reference);
      if (cyclic !== undefined)
        return cyclic;
    }
    visiting.delete(key);
    done.add(key);
    return;
  };
  for (const task of tasks) {
    const cyclic = walk(task.key);
    if (cyclic !== undefined) {
      findings.push({ taskKey: cyclic, code: "cycle", detail: "blockedBy edges form a cycle through " + JSON.stringify(cyclic) + " — a cycle makes every task in it permanently unready" });
      break;
    }
  }
  const reaches = (from, target) => {
    const queue = [from];
    const walked = new Set;
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === target)
        return true;
      if (walked.has(key))
        continue;
      walked.add(key);
      for (const reference of byKey.get(key)?.blockedBy ?? [])
        queue.push(reference);
    }
    return false;
  };
  for (let i = 0;i < tasks.length; i += 1) {
    for (let j = i + 1;j < tasks.length; j += 1) {
      const left = tasks[i];
      const right = tasks[j];
      const overlap = left.writeScopes.some((a) => right.writeScopes.some((b) => scopesOverlap(a, b)));
      if (!overlap)
        continue;
      if (reaches(left.key, right.key) || reaches(right.key, left.key))
        continue;
      findings.push({ taskKey: left.key, code: "write-scope-overlap", detail: "tasks " + JSON.stringify(left.key) + " and " + JSON.stringify(right.key) + " declare overlapping write scopes with NO dependency path between them — add an edge or make the scopes disjoint" });
    }
  }
  for (const task of tasks) {
    if (task.verify !== true || task.kind === "review")
      continue;
    const reviews = tasks.filter((candidate) => candidate.kind === "review" && (candidate.blockedBy ?? []).includes(task.key));
    if (reviews.length !== 1) {
      findings.push({ taskKey: task.key, code: "review-count", detail: "verify: true requires EXACTLY one review task blocked by " + JSON.stringify(task.key) + "; this split declares " + String(reviews.length) });
      continue;
    }
    if (roleKey(reviews[0].ownerRole) === roleKey(task.ownerRole)) {
      findings.push({ taskKey: task.key, code: "self-review", detail: "the review task " + JSON.stringify(reviews[0].key) + " is owned by the SAME role as the work it reviews (" + JSON.stringify(task.ownerRole) + ") — the verifier must be a different declared role" });
    }
  }
  return findings;
}
async function submitSplit(deps, submission) {
  const findings = validateGraph(submission.tasks, deps.roster);
  const readings = new Map;
  for (const task of submission.tasks) {
    const key = roleKey(task.ownerRole);
    if (key === "" || readings.has(key))
      continue;
    readings.set(key, await deps.window(task.ownerRole));
  }
  const tasks = [];
  for (const task of submission.tasks) {
    const inputs = task.inputs.map((declared) => measureInput(deps.workspace, declared, deps.config));
    const reading = readings.get(roleKey(task.ownerRole)) ?? { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "the owner role resolved no window" };
    const routeKey = reading.provider === "" || reading.model === "" ? "" : reading.provider + "/" + reading.model;
    const estimate = estimateTask({ subject: task.subject, description: task.description, inputs, config: deps.config, routeKey, modelMaxTokens: reading.maxOutputTokens });
    const budget = applyBudget(estimate, reading, deps.config);
    const unreadable = inputs.filter((entry) => entry.error !== undefined);
    for (const entry of unreadable) {
      findings.push({ taskKey: task.key, code: "input-unreadable", detail: "declared input " + JSON.stringify(entry.path) + " could not be measured: " + String(entry.error) });
    }
    tasks.push({
      key: task.key,
      subject: task.subject,
      description: task.description,
      kind: task.kind ?? "work",
      ownerRole: task.ownerRole,
      writeScopes: [...task.writeScopes],
      blockedBy: [...task.blockedBy ?? []],
      inputs,
      verify: task.verify === true,
      estimate,
      budget,
      accepted: budget.accepted && unreadable.length === 0
    });
  }
  const roles = [];
  const recorded = new Set;
  for (const task of submission.tasks) {
    const key = roleKey(task.ownerRole);
    if (recorded.has(key))
      continue;
    recorded.add(key);
    const reading = readings.get(key);
    if (reading === undefined)
      continue;
    roles.push({ role: task.ownerRole, provider: reading.provider, model: reading.model, window: reading.window, provenance: reading.provenance, ...reading.reason === undefined ? {} : { reason: reading.reason } });
  }
  const accepted = findings.length === 0 && tasks.every((task) => task.accepted);
  const totalEstimate = tasks.reduce((sum, task) => sum + task.estimate.estimate, 0);
  const verdict = {
    version: 1,
    cellId: deps.cellId,
    revision: submission.revision,
    submittedAt: deps.now.toISOString(),
    accepted,
    findings,
    roles,
    tasks,
    totals: {
      estimate: totalEstimate,
      taskCount: tasks.length,
      acceptedCount: tasks.filter((task) => task.accepted).length,
      refusedCount: tasks.filter((task) => !task.accepted).length
    }
  };
  const canonical = splitPath(deps.workspace, deps.cellId, submission.revision);
  const stored = readSplit(deps.workspace, deps.cellId, submission.revision);
  const wouldDestroyAccepted = !accepted && stored.ok && stored.verdict.accepted;
  const file = wouldDestroyAccepted ? refusedSplitPath(deps.workspace, deps.cellId, submission.revision) : canonical;
  const persisted = { ...verdict, file };
  atomicWriteText(file, JSON.stringify(persisted, null, 2) + `
`);
  return persisted;
}
function readSplit(workspace, cellId, revision) {
  const path = splitPath(workspace, cellId, revision);
  let text;
  try {
    text = readFileSync3(path, "utf8");
  } catch (error) {
    return { ok: false, path, detail: "the split verdict cannot be read (" + errorText3(error) + ")" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, path, detail: "the split verdict is not valid JSON (" + errorText3(error) + ")" };
  }
  if (typeof parsed !== "object" || parsed === null || parsed.version !== 1) {
    return { ok: false, path, detail: "the split verdict is not a version-1 record" };
  }
  const verdict = parsed;
  if (!Array.isArray(verdict.tasks) || typeof verdict.accepted !== "boolean" || typeof verdict.revision !== "number") {
    return { ok: false, path, detail: "the split verdict does not have the shape of a verdict" };
  }
  return { ok: true, verdict };
}
function latestSplit(workspace, cellId) {
  const dir = dirname2(splitPath(workspace, cellId, 0));
  let entries = [];
  try {
    entries = readdirSync2(dir);
  } catch {
    return null;
  }
  const revisions = entries.filter((entry) => /^\d+\.json$/.test(entry)).map((entry) => Number(entry.slice(0, -".json".length))).filter((value) => Number.isInteger(value) && value > 0).sort((a, b) => b - a);
  if (revisions.length === 0)
    return null;
  return { revision: revisions[0], read: readSplit(workspace, cellId, revisions[0]) };
}
function errorText3(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-cellwork-plugin/src/recon.ts
var RECON_ROLES = ["Explorer", "Researcher"];
var JOURNAL_REPORT_CHARS = 2000;
function canonicalReconRole(role) {
  const wanted = role.trim().toLowerCase();
  return RECON_ROLES.find((candidate) => candidate.toLowerCase() === wanted);
}
function reconPrompt(deps, label, task) {
  const persona = deps.personaFor(label);
  return [
    ...persona === null ? [] : [persona, ""],
    "[mpd-cellwork] ONE-SHOT READ-ONLY CONSULT — " + label,
    "",
    "Cell " + deps.cell.cellId + " is in its planning phase. Answer the question below from the repository",
    "itself: read files, search, and cite what you found by path. You cannot write, edit or run a shell;",
    "that is the point of this consult.",
    "",
    "QUESTION:",
    task,
    "",
    "RETURN: the evidence you found (paths and the few relevant excerpts), then a direct answer. If the",
    "question is unanswerable from the tree, say exactly what is missing rather than guessing."
  ].join(`
`);
}
async function runRecon(deps, input) {
  if (deps.cell.phase === "stopped")
    return { ok: false, error: "cellwork_recon: cell " + deps.cell.cellId + " is stopped and archived — reconnaissance is refused after the mode ends" };
  const allowed = deps.caller.member === "cell-planner" || deps.caller.mode === "subcaptain";
  if (!allowed) {
    return { ok: false, error: "cellwork_recon is PLANNER/SUBCAPTAIN ONLY: this session is " + JSON.stringify(deps.caller.member === "" ? "not a cell member" : deps.caller.member) + " in mode " + JSON.stringify(deps.caller.mode) + ". Ask the planner to run the consult, or ask the captain to relay the question." };
  }
  const label = canonicalReconRole(input.role);
  if (label === undefined)
    return { ok: false, error: "cellwork_recon: role " + JSON.stringify(input.role) + " is not a read-only consult role — use exactly " + RECON_ROLES.join(" or ") };
  const task = input.task.trim();
  if (task === "")
    return { ok: false, error: "cellwork_recon: the task/question is empty — one consult answers one concrete question" };
  const persona = deps.personaFor(label);
  try {
    const result = await deps.spawn({
      label,
      prompt: reconPrompt(deps, label, task),
      maxDepth: deps.config.depthMax,
      parent: deps.parent
    });
    appendJournal(deps.workspace, deps.cell.cellId, {
      event: "recon",
      role: label,
      question: task.slice(0, 400),
      reportChars: result.output.length,
      excerpt: result.output.slice(0, JOURNAL_REPORT_CHARS),
      stopReason: result.stopReason,
      personaInjected: persona !== null
    }, deps.now);
    return { ok: true, role: label.toLowerCase(), label, report: result.output, stopReason: result.stopReason, personaInjected: persona !== null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendJournal(deps.workspace, deps.cell.cellId, { event: "recon-failed", role: label, question: task.slice(0, 400), error: message }, deps.now);
    return { ok: false, error: "cellwork_recon: raising the " + label + " consult failed: " + message };
  }
}

// packages/mpd-cellwork-plugin/src/dispatch.ts
function nameKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function blockersSatisfied(task, byId) {
  for (const reference of task.blockedBy ?? []) {
    const blocker = byId.get(reference);
    if (blocker === undefined)
      return false;
    if (blocker.status !== "completed" && blocker.status !== "failed")
      return false;
  }
  return true;
}
function memberIsBusy(tasks, memberName) {
  const key = nameKey(memberName);
  return tasks.some((task) => (task.status === "claimed" || task.status === "in_progress") && nameKey(String(task.owner ?? "")) === key);
}
function resolveOwner(members, owner) {
  const trimmed = owner.trim();
  if (trimmed === "")
    return;
  const exact = members.find((member) => String(member.name ?? "") === trimmed);
  if (exact !== undefined)
    return exact;
  const key = nameKey(trimmed);
  return members.find((member) => nameKey(String(member.name ?? "")) === key);
}
function splitKeyOfBoardId(cell, boardId) {
  const mapping = cell.activatedTasks ?? {};
  for (const [key, id] of Object.entries(mapping)) {
    if (id === boardId)
      return key;
  }
  return;
}
function dispatchMessageFor(deps, task, boardId) {
  const splitKey = splitKeyOfBoardId(deps.cell, boardId);
  const contract = splitKey === undefined ? null : contractRelativePath(deps.cell.cellId, splitKey);
  const scopes = (task.writeScopes ?? []).length === 0 ? "(this task declares no write scope — it produces no code)" : (task.writeScopes ?? []).join(", ");
  return [
    "[mpd-cellwork] cell " + deps.cell.cellId + " — your task " + boardId + ": " + String(task.subject ?? ""),
    "",
    String(task.description ?? ""),
    "",
    'CLAIM IT FIRST: agent_teams_task {action:"claim", task_id:"' + boardId + '"}.',
    "WRITE ONLY INSIDE: " + scopes,
    ...(task.writeScopes ?? []).length === 0 ? [] : contract === null ? ["FROZEN CONTRACT: this cell record carries no split-key mapping for task " + boardId + ", so the contract path cannot be named here — call `cellwork_status` and use the contract your verification loop froze."] : ["FROZEN CONTRACT (your verifier reads this; yours is the same deliverable): " + contract],
    'WHEN DONE: agent_teams_task {action:"complete", task_id:"' + boardId + '", note:"<one line>"}.',
    "IF BLOCKED OR THE USER MUST DECIDE: mail the captain — the captain relays every user question.",
    "IF THE PLUGIN TELLS YOU TO CHECKPOINT: call cellwork_handoff, then end your turn."
  ].join(`
`);
}
function contractRelativePath(cellId, boardId) {
  return [".mpd", "cellwork", cellId, "contracts", boardId + ".md"].join("/");
}
async function dispatchOwnerOnly(deps) {
  const report = { pairs: [], skipped: [] };
  if (deps.record === undefined) {
    report.refused = "the live team record could not be read, so no task can be paired";
    return report;
  }
  const tasks = Array.isArray(deps.record.tasks) ? deps.record.tasks : [];
  const members = Array.isArray(deps.record.members) ? deps.record.members : [];
  const byId = new Map(tasks.map((task) => [String(task.id ?? ""), task]));
  const paired = new Set;
  const excluded = new Set((deps.excludedTaskIds ?? []).filter((id) => id !== ""));
  for (const task of tasks) {
    const taskId = String(task.id ?? "");
    if (taskId === "")
      continue;
    const subject = String(task.subject ?? "");
    if (excluded.has(taskId)) {
      report.skipped.push({ taskId, subject, reason: "CANCELLED by a later split revision — the row is kept on the board and never dispatched" });
      continue;
    }
    if (task.status !== "pending") {
      report.skipped.push({ taskId, subject, reason: "not pending (status " + String(task.status ?? "unknown") + ")" });
      continue;
    }
    if (!blockersSatisfied(task, byId)) {
      report.skipped.push({ taskId, subject, reason: "not ready (blocked by " + ((task.blockedBy ?? []).join(", ") || "a reference that names no task") + ")" });
      continue;
    }
    const owner = String(task.owner ?? "").trim();
    if (owner === "") {
      report.skipped.push({ taskId, subject, reason: "no declared owner — cellwork pairs ONLY the declared owner" });
      continue;
    }
    const member = resolveOwner(members, owner);
    if (member === undefined) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(owner) + " is not on the roster — no substitution is made" });
      continue;
    }
    const memberName = String(member.name ?? owner);
    if (member.status === "failed") {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " FAILED to start" });
      continue;
    }
    if (member.status === "provisioning") {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " is still being raised" });
      continue;
    }
    if (paired.has(nameKey(memberName))) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " was already paired in this pass (one task per member)" });
      continue;
    }
    if (memberIsBusy(tasks, memberName)) {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " is BUSY on another task — reported, never substituted" });
      continue;
    }
    const handle = String(deps.handleFor?.(memberName) ?? member.executorRef ?? "");
    if (handle === "") {
      report.skipped.push({ taskId, subject, reason: "declared owner " + JSON.stringify(memberName) + " has no executor handle (never raised)" });
      continue;
    }
    try {
      await deps.send(handle, dispatchMessageFor(deps, task, taskId));
    } catch (error) {
      report.skipped.push({ taskId, subject, reason: "the message to " + JSON.stringify(memberName) + " failed: " + errorText4(error) });
      continue;
    }
    paired.add(nameKey(memberName));
    report.pairs.push({ taskId, subject, memberName, handle });
    appendJournal(deps.workspace, deps.cell.cellId, { event: "dispatch", taskId, member: memberName, teamId: String(deps.record.teamId ?? "") }, deps.now);
  }
  return report;
}
function sendThroughExecutor(executor, captainAgent) {
  if (executor === undefined || typeof executor.send !== "function")
    return;
  return async (handle, content) => {
    await executor.send(captainAgent, handle, content);
  };
}
function errorText4(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-cellwork-plugin/src/activate.ts
function producerIdentity(cellId) {
  return "cellwork:" + cellId;
}
function topologicalOrder(tasks) {
  const ordered = [];
  const emitted = new Set;
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const emit = (key) => {
    if (emitted.has(key))
      return;
    const row = byKey.get(key);
    if (row === undefined) {
      emitted.add(key);
      return;
    }
    for (const blocker of row.blockedBy)
      emit(blocker);
    emitted.add(key);
    ordered.push(row);
  };
  for (const task of tasks)
    emit(task.key);
  return ordered;
}
function memberPrompt(deps, ownerRole, owned) {
  const persona = deps.personaFor(ownerRole);
  const taskLines = owned.map((task) => "  · " + task.key + " — " + task.subject);
  return [
    ...persona === null ? [] : [persona, ""],
    "[mpd-cellwork] You are " + ownerRole + " on cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR TASKS on this cell's board (one dispatch message per task will follow):",
    ...taskLines,
    "",
    "PROTOCOL:",
    '1. WAIT for the dispatch message naming your task, then CLAIM it: agent_teams_task {action:"claim", task_id}.',
    "2. The dispatch message names the paths you may write. Do not write outside them.",
    "3. Read the frozen contract named in the message before you start; it is what your verifier judges.",
    '4. On completion: agent_teams_task {action:"complete", task_id, note:"<one line>"}.',
    "5. If you need a user decision, mail the captain; the captain relays the question. Do not guess.",
    "6. If the plugin tells you to CHECKPOINT, call cellwork_handoff and end your turn."
  ].join(`
`);
}
function reviewTaskDescription(task, workTask, cellId) {
  const contract = contractRelativePath(cellId, workTask.key);
  return [
    "VERIFY the work task " + JSON.stringify(workTask.key) + " (" + workTask.subject + ") as a BLIND reviewer.",
    "Frozen contract: " + contract + " — read it (and the repository documentation) BEFORE the implementation.",
    "It names the verification loop to bind with `mpd_verify_seat`; the loop was opened at activation.",
    "Then run the gates it lists, and record the verdict with `mpd_verify_record`",
    "(a PASS cites the documents it rests on and the gate evidence ids; a FAIL names each finding and its",
    "document source). You never fix the work: a FAIL bounces it back to its writer as a repair task."
  ].join(`
`);
}
function buildContractDoc(deps, task, reviewer, boardId) {
  const gates = deps.config.contractGates.length === 0 ? ["the repository's own declared gates (read the project instruction file: AGENTS.md §4, or its equivalent)"] : [...deps.config.contractGates];
  const verifier = reviewer === undefined ? "NO REVIEW TASK — this task's verification is not armed" : reviewer.ownerRole;
  return [
    "# Acceptance contract — " + task.key + ": " + task.subject,
    "",
    "Cell: `" + deps.cell.cellId + "` · split revision " + String(deps.split.revision) + " · frozen " + deps.split.submittedAt,
    "producer: " + producerIdentity(deps.cell.cellId),
    "Owner: **" + task.ownerRole + "** · Verifier: **" + verifier + "** · Board task: `" + boardId + "`",
    "",
    "## Deliverable",
    task.description,
    "",
    "## Allowed write scopes",
    ...task.writeScopes.length === 0 ? ["(none declared — this task produces no code)"] : task.writeScopes.map((scope) => "- `" + scope + "`"),
    "",
    "## Acceptance criteria",
    "1. The deliverable above exists, and every changed path is inside the allowed write scopes.",
    "2. The gate commands below pass, with their observed exit codes quoted.",
    "3. The BUILD's claims are re-checked from THIS contract and the documentation, never from the builder's reasoning.",
    "4. A DIFFERENT agent records the verdict (see the verification protocol), citing documents and gate evidence ids.",
    "",
    "## Gate commands",
    ...gates.map((gate) => "- `" + gate + "`"),
    "",
    "## Verification protocol",
    "1. Bind the seat: `mpd_verify_seat {loop_id:<id from this contract's Loop section>}`.",
    "2. Read the documentation band and this contract first; only a RECORDED FAIL makes reading the implementation legitimate.",
    '3. Produce gate evidence and record the verdict: `mpd_verify_record {loop_id, verdict:"PASS"|"FAIL", sources:[…], evidence_ids:[…]}`.',
    "4. On FAIL, name each finding with the document source that proves it and leave the repair to the writer.",
    "",
    "## Loop",
    "The verification loop is opened at activation; its id is appended below before dispatch."
  ].join(`
`);
}
function withLoopId(doc, loopId) {
  return doc.replace("its id is appended below before dispatch.", "`" + loopId + '` (`mpd_verify_seat {loop_id:"' + loopId + '"}`).');
}
async function materializeSplit(deps) {
  const teamId = deps.cell.teamId;
  if (teamId === "")
    return { ok: false, error: "cellwork_activate: no team is recorded on " + deps.cell.cellId + " — run `cellwork_start` first (the planning team is the record activation appends to)" };
  const partial = { members: {}, boardIds: {}, loopIds: {}, contracts: {} };
  let mutated = false;
  const snapshot = () => ({ members: { ...partial.members }, boardIds: { ...partial.boardIds }, loopIds: { ...partial.loopIds }, contracts: { ...partial.contracts } });
  const checkpoint = () => {
    mutated = true;
    deps.checkpoint(snapshot());
  };
  const fail = (error) => ({ ok: false, error, ...mutated ? { partial: snapshot() } : {} });
  const errorText5 = (error) => error instanceof Error ? error.message : String(error);
  const call = async (arguments_) => {
    try {
      const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent });
      if (!result.ok)
        return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" };
      return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value : {} };
    } catch (error) {
      return { ok: false, error: errorText5(error) };
    }
  };
  const reviewerOf = (key) => deps.split.tasks.find((candidate) => candidate.kind === "review" && candidate.blockedBy.includes(key));
  const mode = deps.cell.activatedRevision === null ? "initial" : "resplit";
  const previous = new Map(Object.entries(deps.cell.activatedTasks));
  const keptKeys = new Set(deps.split.tasks.filter((task) => previous.has(task.key)).map((task) => task.key));
  const droppedKeys = [...previous.keys()].filter((key) => !keptKeys.has(key) && deps.cell.cancelledTasks[key] === undefined);
  const fresh = deps.split.tasks.filter((task) => !keptKeys.has(task.key));
  const freshCode = fresh.filter((task) => task.writeScopes.length > 0);
  let live;
  try {
    live = deps.recordFor(teamId);
  } catch {
    live = undefined;
  }
  const liveRoster = new Map;
  for (const row of live?.members ?? [])
    if (typeof row.name === "string" && row.name !== "")
      liveRoster.set(roleKey(row.name), row);
  const existingMembers = new Map(Object.values(deps.cell.members).map((member) => [roleKey(member.name), member]));
  for (const [key, row] of liveRoster) {
    const remembered = existingMembers.get(key);
    const executorRef = typeof row.executorRef === "string" ? row.executorRef : "";
    const name = typeof row.name === "string" ? row.name : key;
    const owned = deps.split.tasks.filter((task) => roleKey(task.ownerRole) === key);
    existingMembers.set(key, remembered === undefined ? { name, role: typeof row.role === "string" ? row.role : "", sessionId: executorRef, executorRef, mode: owned.length > 0 && owned.every((task) => task.kind === "review") ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() } : { ...remembered, sessionId: executorRef === "" ? remembered.sessionId : executorRef, executorRef: executorRef === "" ? remembered.executorRef : executorRef });
  }
  for (const task of freshCode) {
    const reviewer = reviewerOf(task.key);
    const doc = buildContractDoc(deps, task, reviewer, "");
    const path = contractPath(deps.workspace, deps.cell.cellId, task.key);
    try {
      atomicWriteText(path, doc + `
`);
    } catch (error) {
      return fail("cellwork_activate could not write the contract for " + JSON.stringify(task.key) + ": " + errorText5(error));
    }
    partial.contracts[task.key] = path;
    checkpoint();
  }
  const handledRoles = new Set;
  const newMembers = {};
  const reused = [];
  for (const task of fresh) {
    const key = roleKey(task.ownerRole);
    if (handledRoles.has(key))
      continue;
    handledRoles.add(key);
    const owned = deps.split.tasks.filter((candidate) => roleKey(candidate.ownerRole) === key);
    const existing = existingMembers.get(key);
    if (existing !== undefined) {
      reused.push(existing.name);
      if (deps.cell.members[existing.name] === undefined) {
        newMembers[existing.name] = existing;
        partial.members = { ...partial.members, ...newMembers };
        checkpoint();
      }
      continue;
    }
    const pureVerifier = owned.every((candidate) => candidate.kind === "review");
    const name = task.ownerRole.trim();
    const added = await call({
      action: "add_member",
      member: { name, role: name, description: name + (pureVerifier ? " (verifier)" : ""), prompt: memberPrompt(deps, name, owned) }
    });
    if (!added.ok) {
      if (added.error.includes("is already on the roster")) {
        let refreshed;
        try {
          refreshed = deps.recordFor(teamId);
        } catch {
          refreshed = undefined;
        }
        const row = (refreshed?.members ?? []).find((candidate) => roleKey(String(candidate.name ?? "")) === key);
        if (row !== undefined) {
          const executorRef = typeof row.executorRef === "string" ? row.executorRef : "";
          const liveName = String(row.name);
          newMembers[liveName] = { name: liveName, role: name, sessionId: executorRef, executorRef, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() };
          reused.push(liveName);
          partial.members = { ...partial.members, ...newMembers };
          checkpoint();
          continue;
        }
      }
      return fail("cellwork_activate could not raise " + JSON.stringify(name) + ": " + added.error);
    }
    const handle = typeof added.value.spawned === "string" ? added.value.spawned : "";
    if (handle === "")
      return fail("cellwork_activate raised " + JSON.stringify(name) + " but the answer carried no executor handle");
    newMembers[name] = { name, role: name, sessionId: handle, executorRef: handle, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() };
    partial.members = { ...partial.members, ...newMembers };
    checkpoint();
  }
  const boardIds = new Map;
  for (const key of keptKeys) {
    const id = previous.get(key);
    if (id !== undefined && id !== "")
      boardIds.set(key, id);
  }
  const activated = [];
  for (const task of topologicalOrder(fresh)) {
    const memberName = task.ownerRole.trim();
    const mappedBlockers = task.blockedBy.map((reference) => boardIds.get(reference) ?? previous.get(reference) ?? reference);
    const description = task.kind === "review" ? reviewTaskDescription(task, deps.split.tasks.find((candidate) => candidate.key === task.blockedBy[0]) ?? task, deps.cell.cellId) : task.description;
    const appended = await call({
      action: "create_task",
      task: {
        subject: task.subject,
        description,
        kind: task.kind,
        owner: memberName,
        ...task.writeScopes.length === 0 ? {} : { write_scopes: [...task.writeScopes] },
        blocked_by: mappedBlockers
      }
    });
    if (!appended.ok)
      return fail("cellwork_activate could not append task " + JSON.stringify(task.key) + ": " + appended.error);
    const row = typeof appended.value.task === "object" && appended.value.task !== null ? appended.value.task : undefined;
    const boardId = typeof row?.id === "string" ? row.id : "";
    if (boardId === "")
      return fail("cellwork_activate appended task " + JSON.stringify(task.key) + " but the answer carried no board id");
    boardIds.set(task.key, boardId);
    activated.push({ key: task.key, boardId, kind: task.kind, ownerRole: task.ownerRole, memberName });
    partial.boardIds[task.key] = boardId;
    checkpoint();
  }
  const loopIds = new Map(Object.entries(deps.cell.activatedLoops ?? {}));
  const loops = [];
  const codeTasks = deps.split.tasks.filter((task) => task.writeScopes.length > 0);
  for (const task of codeTasks) {
    if (loopIds.has(task.key))
      continue;
    const boardId = boardIds.get(task.key) ?? "";
    if (boardId === "")
      return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to open a verify loop for a row that is not on the board");
    const contract = contractRelativePath(deps.cell.cellId, task.key);
    let opened;
    try {
      opened = await deps.dsh.executeTool({
        name: "mpd_verify_open",
        arguments: { writer: "delegate", contract, scope: [...task.writeScopes], task_id: boardId },
        agent: deps.captainAgent
      });
    } catch (error) {
      return fail("cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + errorText5(error));
    }
    if (!opened.ok)
      return fail("cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + String(opened.error));
    const value = typeof opened.value === "object" && opened.value !== null ? opened.value : {};
    if (typeof value.refused === "string")
      return fail("cellwork_activate was REFUSED a verify loop for " + JSON.stringify(task.key) + ": " + value.refused);
    const loopId = typeof value.loopId === "string" ? value.loopId : "";
    if (loopId === "")
      return fail("cellwork_activate opened no loop id for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work");
    loopIds.set(task.key, loopId);
    loops.push({ taskKey: task.key, boardId, loopId });
    partial.loopIds[task.key] = loopId;
    const path = partial.contracts[task.key] ?? contractPath(deps.workspace, deps.cell.cellId, task.key);
    const stored = buildContractDoc(deps, task, reviewerOf(task.key), boardId);
    try {
      atomicWriteText(path, withLoopId(stored, loopId) + `
`);
    } catch (error) {
      return fail("cellwork_activate could not rewrite the contract for " + JSON.stringify(task.key) + ": " + errorText5(error));
    }
    checkpoint();
  }
  for (const task of deps.split.tasks) {
    if ((boardIds.get(task.key) ?? "") === "")
      return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to dispatch");
    if (task.writeScopes.length > 0 && (loopIds.get(task.key) ?? "") === "")
      return fail("cellwork_activate has no verify loop for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work");
  }
  const cancelled = [];
  for (const key of droppedKeys) {
    const boardId = previous.get(key) ?? "";
    cancelled.push({ key, boardId });
    appendJournal(deps.workspace, deps.cell.cellId, { event: "task-cancelled", key, boardId, revision: deps.split.revision, reason: "the accepted split no longer carries this task; the board row is kept and dispatch skips it" }, deps.now);
  }
  let dispatch;
  let record;
  try {
    record = deps.recordFor(teamId);
    const send = sendThroughExecutor(deps.dsh.teamExecutor(), deps.captainAgent);
    const excludedTaskIds = [...Object.values(deps.cell.cancelledTasks), ...cancelled.map((entry) => entry.boardId)].filter((id) => id !== "");
    const cellForDispatch = { ...deps.cell, activatedTasks: Object.fromEntries(boardIds) };
    dispatch = send === undefined ? { pairs: [], skipped: [], refused: "the team executor seam is absent, so no member can be woken — the board is materialised and ready for a manual `cellwork_dispatch`" } : await dispatchOwnerOnly({ workspace: deps.workspace, cell: cellForDispatch, record, send, excludedTaskIds, now: deps.now });
  } catch (error) {
    return fail("cellwork_activate could not dispatch: " + errorText5(error));
  }
  const splitterRow = (record?.tasks ?? []).find((task) => roleKey(String(task.owner ?? "")) === roleKey("cell-splitter") && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled");
  const splitTaskId = String(splitterRow?.id ?? "");
  if (splitTaskId !== "") {
    try {
      await deps.dsh.executeTool({ name: "agent_teams_task", arguments: { action: "complete", task_id: splitTaskId, note: "split revision " + String(deps.split.revision) + " materialised by activation" }, agent: deps.captainAgent });
    } catch {}
  }
  appendJournal(deps.workspace, deps.cell.cellId, {
    event: "activate",
    teamId,
    mode,
    splitRevision: deps.split.revision,
    producer: producerIdentity(deps.cell.cellId),
    tasks: activated.map((task) => ({ key: task.key, boardId: task.boardId, owner: task.memberName, kind: task.kind })),
    kept: [...keptKeys],
    cancelled,
    contracts: Object.values(partial.contracts),
    loops: loops.map((loop) => ({ taskKey: loop.taskKey, loopId: loop.loopId })),
    reused,
    dispatched: dispatch.pairs.length,
    skipped: dispatch.skipped.length,
    ...splitTaskId === "" ? {} : { splitTaskId }
  }, deps.now);
  return {
    ok: true,
    outcome: {
      mode,
      contracts: Object.values(partial.contracts),
      members: { ...newMembers },
      reused: [...reused],
      tasks: activated,
      boardIds: Object.fromEntries(boardIds),
      kept: [...keptKeys],
      cancelled,
      loops,
      dispatch,
      ...splitTaskId === "" ? {} : { splitTaskId }
    }
  };
}

// packages/mpd-cellwork-plugin/src/staging.ts
var PLANNER_MEMBER = "cell-planner";
var SPLITTER_MEMBER = "cell-splitter";
var PLANNER_ROLE = "Planner";
var SPLITTER_ROLE = "Lead";
var REQUIREMENTS_TASK_SUBJECT = "Requirements interview and agreed requirements document";
var SPLIT_TASK_SUBJECT = "Measured task split from the agreed requirements";
var REQUIRED_SECTION_NAMES = ["Goal", "Non-goals", "Users / consumers", "Constraints", "Acceptance criteria", "Open questions"];
function textField2(record, key) {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}
function createdMembers(value) {
  const created = typeof value.created === "object" && value.created !== null ? value.created : {};
  const rows = Array.isArray(created.members) ? created.members : [];
  return rows.filter((row) => typeof row === "object" && row !== null).map((row) => ({ name: textField2(row, "name"), id: textField2(row, "id") })).filter((row) => row.name !== "");
}
function createdTasks(value) {
  const created = typeof value.created === "object" && value.created !== null ? value.created : {};
  const rows = Array.isArray(created.tasks) ? created.tasks : [];
  return rows.filter((row) => typeof row === "object" && row !== null).map((row) => ({ subject: textField2(row, "subject"), id: textField2(row, "id") }));
}
function plannerPrompt(deps) {
  const persona = deps.personaFor(PLANNER_ROLE);
  return [
    ...persona === null ? [] : [persona, ""],
    "[mpd-cellwork] You are cell-planner, the requirements interviewer of cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR JOB: run a SOCRATIC interview with the user and produce ONE agreed requirements document. You",
    "never implement, never split the work, and never answer a question that belongs to the user.",
    "",
    "THE PROTOCOL:",
    "1. Ask ONE question at a time. Never bundle questions.",
    "2. When the answer arrives, REFLECT IT BACK in one sentence and ask for confirmation when it changes scope.",
    "3. Surface EDGE CASES explicitly: failure modes, empty states, who is NOT served, what is out of scope.",
    "4. Agree a DEFINITION OF DONE (acceptance criteria a verifier could check), not adjectives.",
    "5. Close only when all six sections are filled: " + REQUIRED_SECTION_NAMES.join(" · ") + ".",
    "",
    "THE RELAY (you cannot talk to the user directly):",
    '- Mail the captain ONE structured question: `cellwork_send {to:"captain", subject, body}` — or',
    "  `agent_teams_mail` when the cell-aware sender is not mounted. Put the question, why it matters, and",
    "  the options you see in the body, so the captain can put it to the user with `ask_user_question`.",
    "- Then WAIT for the captain's answer. Do not invent an answer, do not proceed on an assumption.",
    "- If reconnaissance is needed before you can ask a good question, call `cellwork_recon`",
    '  {role:"Explorer"|"Researcher", task} — a one-shot READ-ONLY consult; you get its report back.',
    "",
    "THE DOCUMENT: write `<cell>/requirements.md` under the cell directory with these headings exactly:",
    "  ## Goal · ## Non-goals · ## Users / consumers · ## Constraints · ## Acceptance criteria · ## Open questions",
    "Every section must carry real content; an empty section will be refused.",
    'Then call `cellwork_requirements {action:"finalize"}` (pass `content` instead of writing the file if that',
    "is easier). A finalized revision unblocks the splitter.",
    "",
    "YOUR TOOLS: `cellwork_recon`, `cellwork_requirements`, `cellwork_status`, `cellwork_send`/`agent_teams_mail`.",
    "Do NOT call `ask_user_question` (that is the captain's surface) and do NOT submit a split."
  ].join(`
`);
}
function splitterPrompt(deps) {
  const persona = deps.personaFor(SPLITTER_ROLE);
  const gates = deps.config.contractGates.length === 0 ? "(the repository's own declared gates)" : deps.config.contractGates.join(" · ");
  return [
    ...persona === null ? [] : [persona, ""],
    "[mpd-cellwork] You are cell-splitter, the task-graph designer of cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR JOB: turn the FINALIZED requirements document into a task graph, submit it with `cellwork_split`,",
    "and fix whatever the plugin's measured refusal names. You never implement and never own a work task.",
    "",
    "READ FIRST: `<cell>/requirements.md` (the agreed scope) and `cellwork_status` (the current",
    "requirementsRevision — pass it as `revision`). If the document is still revision 0, the interview is not",
    "closed yet: wait for the captain's dispatch instead of inventing scope.",
    "",
    "THE GRAPH — one object per task, exactly these fields:",
    "  {key, subject, description, kind, ownerRole, writeScopes, blockedBy, inputs, verify}",
    "  · key: stable (`T1`, `auth-core`, …); it becomes the contract file name.",
    "  · kind: requirement | work | review | repair | integration (omitted means work).",
    "  · ownerRole: a ROSTER role name (Senior Engineer, Deep Worker, Junior Engineer, Reviewer, …) or a cell",
    "    role (cell-planner, cell-splitter). It is the role the executor routes the member by.",
    "  · writeScopes: the paths the task will touch; code tasks MUST declare them.",
    "  · blockedBy: an array of task KEYS ([] is an explicit root) — or `independent: true`. A task that",
    "    answers neither is refused.",
    "  · inputs: workspace-relative file paths the owner must read. THE PLUGIN MEASURES THEM (`stat` + a",
    "    16 KiB sample), so a huge file is refused with real bytes instead of a guess.",
    "  · verify: true for every code-producing task. EACH verify:true TASK NEEDS EXACTLY ONE review task",
    '    whose `kind` is "review", whose `blockedBy` contains that task\'s key, and whose ownerRole is a',
    "    DIFFERENT role — the verifier must not be the writer.",
    "",
    "TWO HARD GRAPH RULES: the dependency graph must be ACYCLIC, and two tasks may share a write scope only",
    "when a dependency edge orders them (otherwise one task must cut its scope or depend on the other).",
    "",
    "THE BUDGET (the plugin enforces it, you cannot argue with it): each task's measured estimate must fit",
    "`floor(window * " + String(deps.config.windowFraction) + ")` AND leave room for the model's max output plus " + String(deps.config.compactionHeadroomTokens) + " tokens of",
    "compaction headroom inside the model's own context window. The window is READ from the model catalog,",
    "never assumed. Tasks owned by the same role share that role's route.",
    "A REFUSAL RETURNS A PER-TASK BREAKDOWN (input bytes → tokens, budget, excess). Do not resubmit the same",
    "graph: SPLIT the task, cut the declared inputs, or move work to a larger-window owner role.",
    "",
    "FROZEN CONTRACTS: each code task's verification contract will list its write scopes and these gate",
    "commands for the verifier: " + gates + ".",
    "",
    'SUBMIT: `cellwork_split {action:"submit", revision:<requirementsRevision>, tasks:[…]}`; then read the',
    'verdict with `cellwork_split {action:"show"}`. On acceptance the captain materialises the graph.',
    "Ambiguity in the requirements goes back to the planner THROUGH THE CAPTAIN — mail the captain; do not",
    "invent scope."
  ].join(`
`);
}
async function stagePlanningTeam(deps) {
  const existingTeamId = deps.cell.teamId;
  if (existingTeamId !== "") {
    const record = deps.teams()?.get?.(deps.workspace, existingTeamId);
    return {
      ok: true,
      alreadyStaged: true,
      teamId: existingTeamId,
      ...record === undefined ? {} : {
        members: {
          [PLANNER_MEMBER]: planningMemberRow(PLANNER_MEMBER, PLANNER_ROLE, deps.cell, deps.now),
          [SPLITTER_MEMBER]: planningMemberRow(SPLITTER_MEMBER, SPLITTER_ROLE, deps.cell, deps.now)
        }
      }
    };
  }
  const call = async (arguments_) => {
    const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent });
    if (!result.ok)
      return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" };
    return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value : {} };
  };
  const planName = "cell " + deps.cell.cellId;
  const status = await call({ action: "status" });
  if (!status.ok)
    return { ok: false, error: "cellwork could not read the session's team state: " + status.error };
  const staged = status.value.plan;
  const plan = typeof staged === "object" && staged !== null ? staged : undefined;
  const resumable = plan !== undefined && textField2(plan, "name") === planName;
  const approvedAlready = resumable && textField2(plan, "approvedAt") !== "";
  if (plan !== undefined && !resumable) {
    if (textField2(plan, "approvedAt") !== "") {
      return { ok: false, error: "a team plan is already APPROVED in this session; cellwork needs the staging slot free — finish or archive that team first" };
    }
    const stagedRows = (Array.isArray(plan.members) ? plan.members.length : 0) + (Array.isArray(plan.tasks) ? plan.tasks.length : 0);
    if (stagedRows > 0) {
      return { ok: false, error: "a different team plan is already staged in this session (" + String(stagedRows) + " row(s)); approve or delete it before starting cellwork" };
    }
  }
  if (approvedAlready) {
    const liveTeam = typeof status.value.team === "object" && status.value.team !== null ? status.value.team : undefined;
    const recoveredId = textField2(liveTeam, "teamId");
    if (recoveredId === "") {
      return { ok: false, error: "the planning plan " + planName + ' is APPROVED but the session reports no team id — inspect `agent_teams_plan {action:"status"}` before retrying', planName, partial: true };
    }
    const roster = Array.isArray(liveTeam?.members) ? liveTeam.members.filter((row) => typeof row === "object" && row !== null) : [];
    const recovered = {};
    for (const [name, role] of [[PLANNER_MEMBER, PLANNER_ROLE], [SPLITTER_MEMBER, SPLITTER_ROLE]]) {
      const row = roster.find((candidate) => textField2(candidate, "name") === name);
      if (row !== undefined) {
        recovered[name] = livePlanningMemberRow(name, role, textField2(row, "executorRef") === "" ? textField2(row, "id") : textField2(row, "executorRef"), deps.cell, deps.now);
        continue;
      }
      const appended = await call({ action: "add_member", member: { name, role, description: name + " (" + role + ")", prompt: name === PLANNER_MEMBER ? plannerPrompt(deps) : splitterPrompt(deps) } });
      if (!appended.ok) {
        return { ok: false, error: "the planning team " + recoveredId + " is approved but " + name + " could not be raised: " + appended.error, planName, teamId: recoveredId, partial: true };
      }
      recovered[name] = livePlanningMemberRow(name, role, textField2(appended.value, "spawned"), deps.cell, deps.now);
    }
    return { ok: true, alreadyStaged: true, teamId: recoveredId, members: recovered, planName };
  }
  if (plan === undefined) {
    if (typeof status.value.team === "object" && status.value.team !== null) {
      return { ok: false, error: "this session already drives team " + textField2(status.value.team, "teamId") + "; cellwork requires its own fresh team" };
    }
    const created = await call({ action: "create", name: planName, description: deps.cell.objective });
    if (!created.ok)
      return { ok: false, error: "cellwork could not stage the planning team: " + created.error, planName };
  }
  const presentMembers = new Set((Array.isArray(plan?.members) ? plan.members : []).map((row) => typeof row === "object" && row !== null ? textField2(row, "name") : ""));
  for (const [name, role, prompt] of [
    [PLANNER_MEMBER, PLANNER_ROLE, plannerPrompt(deps)],
    [SPLITTER_MEMBER, SPLITTER_ROLE, splitterPrompt(deps)]
  ]) {
    if (presentMembers.has(name))
      continue;
    const appended = await call({ action: "add_member", member: { name, role, description: name + " (" + role + ")", prompt } });
    if (!appended.ok)
      return { ok: false, error: "cellwork could not stage " + name + ": " + appended.error, planName, partial: true };
  }
  const presentSubjects = new Set((Array.isArray(plan?.tasks) ? plan.tasks : []).map((row) => typeof row === "object" && row !== null ? textField2(row, "subject") : ""));
  if (!presentSubjects.has(REQUIREMENTS_TASK_SUBJECT)) {
    const requirements = await call({
      action: "create_task",
      task: { subject: REQUIREMENTS_TASK_SUBJECT, description: plannerTaskDescription(deps.cell), kind: "requirement", owner: PLANNER_MEMBER, blocked_by: [] }
    });
    if (!requirements.ok)
      return { ok: false, error: "cellwork could not stage the requirements task: " + requirements.error, planName, partial: true };
  }
  if (!presentSubjects.has(SPLIT_TASK_SUBJECT)) {
    const split = await call({
      action: "create_task",
      task: { subject: SPLIT_TASK_SUBJECT, description: splitterTaskDescription(deps.cell), kind: "work", owner: SPLITTER_MEMBER, blocked_by: [REQUIREMENTS_TASK_SUBJECT] }
    });
    if (!split.ok)
      return { ok: false, error: "cellwork could not stage the split task: " + split.error, planName, partial: true };
  }
  const approved = await call({ action: "approve" });
  if (!approved.ok)
    return { ok: false, error: "cellwork could not approve the planning team: " + approved.error, planName, partial: true };
  const team = typeof approved.value.team === "object" && approved.value.team !== null ? approved.value.team : undefined;
  const teamId = textField2(team, "teamId");
  const raised = createdMembers(approved.value);
  const posted = createdTasks(approved.value);
  const stoppedAt = textField2(approved.value, "stoppedAt");
  const members = {};
  for (const row of raised) {
    if (row.name !== PLANNER_MEMBER && row.name !== SPLITTER_MEMBER)
      continue;
    members[row.name] = {
      name: row.name,
      role: row.name === PLANNER_MEMBER ? PLANNER_ROLE : SPLITTER_ROLE,
      sessionId: row.id,
      executorRef: row.id,
      mode: "member",
      handoffReady: false,
      handoffs: 0,
      joinedAt: deps.now.toISOString()
    };
  }
  if (teamId === "")
    return { ok: false, error: 'the planning team was approved but the answer carried no team id — inspect `agent_teams_plan {action:"status"}` before retrying', planName, partial: true };
  if (stoppedAt !== "") {
    return { ok: false, error: "the planning team " + teamId + " was approved but a member could not be raised (" + stoppedAt + '); the record exists — inspect `agent_teams_plan {action:"status"}` and repair it', teamId, members, planName, partial: true };
  }
  return {
    ok: true,
    teamId,
    members,
    tasks: { requirementsId: posted[0]?.id, splitId: posted[1]?.id }
  };
}
function livePlanningMemberRow(name, role, handle, cell, now) {
  const base = planningMemberRow(name, role, cell, now);
  return handle === "" ? base : { ...base, sessionId: handle, executorRef: handle };
}
function planningMemberRow(name, role, cell, now) {
  return { name, role, sessionId: cell.members[name]?.sessionId ?? "", executorRef: cell.members[name]?.executorRef ?? "", mode: "member", handoffReady: cell.members[name]?.handoffReady ?? false, handoffs: cell.members[name]?.handoffs ?? 0, joinedAt: cell.members[name]?.joinedAt ?? now.toISOString() };
}
function plannerTaskDescription(cell) {
  return [
    "Run the Socratic requirements interview for cell " + cell.cellId + " and produce ONE agreed document.",
    "Ask the user through the captain, one question at a time; never answer for them.",
    "Required sections: " + REQUIRED_SECTION_NAMES.join(", ") + ".",
    'Write `<cell>/requirements.md`, then call `cellwork_requirements {action:"finalize"}`.',
    'CLOSE THE TASK with `agent_teams_task {action:"complete", task_id:<this task>}` when the revision is accepted.'
  ].join(`
`);
}
function splitterTaskDescription(cell) {
  return [
    "Turn the FINALIZED requirements document of cell " + cell.cellId + " into a measured task graph.",
    'Submit `cellwork_split {action:"submit", revision:<requirementsRevision>, tasks:[…]}` (shape in your prompt).',
    "Every verify:true task needs exactly one review task, blocked by it, owned by a DIFFERENT role.",
    "Fix every refusal the measured breakdown names; then close the task with",
    '`agent_teams_task {action:"complete", task_id:<this task>}` once a split revision is ACCEPTED.'
  ].join(`
`);
}

// packages/mpd-cellwork-plugin/src/flow.ts
function roleKeyOfOwner(row) {
  return String(row.owner ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function splitPathFor(workspace, verdict) {
  const file = verdict.file;
  if (file === undefined || file === "")
    return [".mpd", "cellwork", verdict.cellId, "split", String(verdict.revision) + ".json"].join("/");
  const prefix = workspace.endsWith("/") ? workspace : workspace + "/";
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
function readArgs(args) {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
}
function argString(args, key) {
  return typeof args[key] === "string" ? args[key] : "";
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()) : [];
}
function refusalText(failure) {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first";
}
function recordOf(teams, workspace, teamId) {
  if (teams === undefined || teamId === "" || workspace === "")
    return;
  const record = teams.get?.(workspace, teamId);
  return typeof record === "object" && record !== null ? record : undefined;
}
function boardTasksOf(record) {
  return record !== undefined && Array.isArray(record.tasks) ? record.tasks.filter((row) => typeof row === "object" && row !== null) : [];
}
function installCellworkFlow(deps) {
  const dsh = deps.dsh;
  const config = deps.config;
  const disposers = [];
  const teams = () => {
    const service = deps.ctx.get?.("mpdTeams", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const roster = () => {
    const service = deps.ctx.get?.("mpdRoles", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const configService = () => {
    const service = deps.ctx.get?.("mpdConfig", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const rosterNames = () => {
    try {
      const rows = roster()?.list?.();
      return Array.isArray(rows) ? rows.map((row) => String(row.name ?? "")).filter((name) => name !== "") : [];
    } catch {
      return [];
    }
  };
  const personaFor = (label) => {
    try {
      const role = roster()?.get?.(label);
      return role !== null && role !== undefined && typeof role.persona === "string" && role.persona.trim() !== "" ? role.persona : null;
    } catch {
      return null;
    }
  };
  const routeOf = (role) => {
    try {
      const service = configService();
      const resolve4 = service?.agentRouteResolutionOf;
      if (typeof resolve4 !== "function")
        return;
      const answer = resolve4.call(service, role);
      return typeof answer === "object" && answer !== null ? answer : undefined;
    } catch {
      return;
    }
  };
  const windowFor = async (role) => resolveTaskWindow({ routeOf, catalog: () => dsh.llmCatalog(), config }, role);
  const callerFor = (exec) => callerContext(dsh, exec, { teams });
  const transition = (workspace, next, entry, now) => {
    const lines = appendJournal(workspace, next.cellId, entry, now);
    const stamped = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor };
    writeCell(workspace, stamped);
    return { ...stamped, updatedAt: now.toISOString() };
  };
  const completeCellTask = async (exec, teamId, predicate, note) => {
    const record = recordOf(teams(), dsh.workspaceRoot(exec), teamId);
    const row = boardTasksOf(record).find((candidate) => predicate(candidate) && candidate.status !== "completed" && candidate.status !== "failed" && candidate.status !== "cancelled");
    if (row === undefined)
      return;
    const taskId = String(row.id ?? "");
    if (taskId === "")
      return;
    const result = await dsh.executeTool({ name: "agent_teams_task", arguments: { action: "complete", task_id: taskId, note }, agent: exec.agent });
    return result.ok ? taskId : undefined;
  };
  disposers.push(dsh.registerTool({
    name: "cellwork_requirements",
    description: "The PLANNER's tool (cell-planner only): `finalize` the agreed requirements document or `update` it. Validates the six required sections (goal, non-goals, users/consumers, constraints, acceptance criteria, open questions). `finalize` refuses an incomplete document and completes the requirements task; `update` bumps the revision and marks the current split STALE.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["finalize", "update"], description: "finalize the agreed document, or update it (bumps the revision, marks the split stale)." },
        content: { type: "string", description: "The full markdown document. Omit to validate the file already at <cell>/requirements.md." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          action: { type: "string" },
          revision: { type: "number" },
          splitStale: { type: "boolean" },
          alreadyFinalized: { type: "boolean" },
          missing: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "object" } },
          requirementsPath: { type: "string" },
          splitTaskId: { type: "string" },
          splitTaskStatus: { type: "string" },
          redispatchable: { type: "boolean" },
          replacementSplitTaskId: { type: "string" },
          closedTaskId: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_requirements refused: " + String(result.error ?? "unknown refusal") + (Array.isArray(result.missing) && result.missing.length > 0 ? `
missing sections: ` + result.missing.join(", ") : ""));
        return text("requirements " + String(result.action ?? "") + ": revision " + String(result.revision ?? "?") + (result.alreadyFinalized === true ? " (already finalized)" : "") + (result.splitStale === true ? " — the accepted split is STALE and must be re-submitted" : "") + (typeof result.closedTaskId === "string" ? " · requirements task " + result.closedTaskId + " completed" : ""));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const action = argString(argv, "action");
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      if (caller.workspace === "" || caller.cell === null)
        return { ok: false, error: "cellwork_requirements: no active cell in this workspace — the tool is only callable inside a running cell" };
      const state = caller.cell;
      if (state.phase === "stopped")
        return { ok: false, error: "cellwork_requirements: cell " + state.cellId + " is stopped and archived" };
      if (caller.member !== PLANNER_MEMBER) {
        return { ok: false, error: "cellwork_requirements is PLANNER-ONLY: this session is " + JSON.stringify(caller.member === "" ? "not a cell member" : caller.member) + ". The captain authors nothing (clause 1); the planner writes and finalizes the document, and the captain relays the user's answers." };
      }
      if (action !== "finalize" && action !== "update")
        return { ok: false, error: "cellwork_requirements: action must be `finalize` or `update` (got " + JSON.stringify(action) + ")" };
      let text_ = null;
      const content = argString(argv, "content");
      if (content.trim() !== "")
        text_ = content;
      else {
        try {
          text_ = readRequirements(caller.workspace, state.cellId);
        } catch (error) {
          return { ok: false, error: "cellwork_requirements: the requirements document could not be read (" + (error instanceof Error ? error.message : String(error)) + ")" };
        }
      }
      if (text_ === null || text_.trim() === "") {
        return { ok: false, error: "cellwork_requirements: no document to validate — write `requirements.md` under " + requirementsPath(caller.workspace, state.cellId) + " or pass `content`" };
      }
      const validation = validateRequirementsText(text_);
      const path = requirementsPath(caller.workspace, state.cellId);
      const now = new Date;
      if (!validation.ok) {
        appendJournal(caller.workspace, state.cellId, { event: "requirements-refused", action, missing: validation.missing }, now);
        return { ok: false, error: "cellwork_requirements: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", ") + ". Ask the user, fill them, and call again.", missing: [...validation.missing], sections: validation.sections, requirementsPath: path };
      }
      if (action === "finalize") {
        if (state.requirementsRevision > 0) {
          const accepted = (() => {
            try {
              return readRequirements(caller.workspace, state.cellId) ?? "";
            } catch {
              return "";
            }
          })();
          if (accepted === storedRequirementsText(text_)) {
            return { ok: true, action, revision: state.requirementsRevision, splitStale: state.splitStale, alreadyFinalized: true, sections: validation.sections, requirementsPath: path };
          }
          return { ok: false, error: "cellwork_requirements: revision " + String(state.requirementsRevision) + ' is already accepted and the document CHANGED — use {action:"update"} to revise it (an accepted revision is never rewritten in place)' };
        }
        writeRequirements(caller.workspace, state.cellId, text_);
        const closed = await completeCellTask(exec, state.teamId, (row) => String(row.kind ?? "") === "requirement" && String(row.owner ?? "") === PLANNER_MEMBER, "requirements revision 1 finalized");
        const next2 = { ...state, requirementsRevision: 1, phase: state.phase === "requirements" ? "split" : state.phase };
        transition(caller.workspace, next2, { event: "requirements-finalize", revision: 1, sections: validation.sections.map((section) => section.key), closedTaskId: closed ?? null }, now);
        return { ok: true, action, revision: 1, splitStale: next2.splitStale, alreadyFinalized: false, sections: validation.sections, requirementsPath: path, ...closed === undefined ? {} : { closedTaskId: closed } };
      }
      writeRequirements(caller.workspace, state.cellId, text_);
      const revision = Math.max(1, state.requirementsRevision) + 1;
      const record = recordOf(teams(), caller.workspace, state.teamId);
      const splitTask = boardTasksOf(record).find((row) => roleKeyOfOwner(row) === SPLITTER_MEMBER && String(row.status ?? "") !== "cancelled") ?? boardTasksOf(record).find((row) => roleKeyOfOwner(row) === SPLITTER_MEMBER);
      const splitTaskId = splitTask === undefined ? "" : String(splitTask.id ?? "");
      const splitTaskStatus = splitTask === undefined ? "" : String(splitTask.status ?? "");
      const redispatchable = splitTaskStatus === "pending" || splitTaskStatus === "claimed" || splitTaskStatus === "in_progress";
      let replacementSplitTaskId = "";
      if (!redispatchable && state.teamId !== "") {
        const appended = await dsh.executeTool({
          name: "agent_teams_plan",
          arguments: {
            action: "create_task",
            task: {
              subject: "Re-split for requirements revision " + String(revision),
              description: "The requirements document moved to revision " + String(revision) + ". Re-read `<cell>/requirements.md` and `cellwork_status`, then submit ONE measured graph against revision " + String(revision) + ' with `cellwork_split {action:"submit"}`. Only NEW or CHANGED work needs a task: the activation reuses the board row of every key it keeps, and marks what you drop cancelled.',
              kind: "work",
              owner: SPLITTER_MEMBER,
              blocked_by: []
            }
          },
          agent: exec.agent
        });
        if (appended.ok) {
          const row = typeof appended.value === "object" && appended.value !== null ? appended.value : {};
          const task = typeof row.task === "object" && row.task !== null ? row.task : undefined;
          replacementSplitTaskId = typeof task?.id === "string" ? task.id : "";
        }
      }
      const next = { ...state, requirementsRevision: revision, splitStale: state.splitRevision !== null ? true : state.splitStale };
      transition(caller.workspace, next, { event: "requirements-update", revision, previousRevision: state.requirementsRevision, splitStale: next.splitStale, splitTaskId, splitTaskStatus, redispatchable, ...replacementSplitTaskId === "" ? {} : { replacementSplitTaskId } }, now);
      if (replacementSplitTaskId !== "") {
        appendJournal(caller.workspace, caller.cell.cellId, { event: "split-task-replaced", previousTaskId: splitTaskId, replacementTaskId: replacementSplitTaskId, revision }, now);
      }
      return {
        ok: true,
        action,
        revision,
        splitStale: next.splitStale,
        alreadyFinalized: false,
        sections: validation.sections,
        requirementsPath: path,
        splitTaskId,
        splitTaskStatus,
        redispatchable,
        replacementSplitTaskId,
        ...splitTaskId === "" ? { message: "no split task is on the board yet — the splitter will receive the whole graph when it is dispatched" } : redispatchable ? { message: "the SAME split task " + splitTaskId + " is re-dispatched with revision " + String(revision) + (next.splitStale ? " and the split marked STALE" : "") + " — dispatch it with `cellwork_dispatch`" } : { message: "split task " + splitTaskId + " is " + splitTaskStatus + " and this board has no reopen verb, so a replacement row " + (replacementSplitTaskId === "" ? "could NOT be appended (no live team to append to)" : replacementSplitTaskId) + " carries the re-split with revision " + String(revision) + " — dispatch it with `cellwork_dispatch`" }
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_recon",
    description: "PLANNER/SUBCAPTAIN only: raise ONE read-only consult (label exactly `Explorer` or `Researcher`) through the adapter's direct one-shot start path, with an explicit absolute maxDepth so the consult is a leaf. The report is returned and journaled in the cell. A composition without the child-persona seam degrades to prose read-only and says so (`personaInjected:false`).",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["Explorer", "Researcher"], description: "The read-only roster role; the label is applied verbatim so the child-persona seam applies the deny list." },
        task: { type: "string", description: "The one question the consult must answer." }
      },
      required: ["role", "task"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          role: { type: "string" },
          label: { type: "string" },
          report: { type: "string" },
          stopReason: { oneOf: [{ type: "string" }, { type: "null" }] },
          personaInjected: { type: "boolean" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_recon refused: " + String(result.error ?? "unknown refusal"));
        return text(String(result.label ?? "consult") + " report (" + String(result.report ?? "").length + " chars" + (result.personaInjected === true ? ", persona injected" : ", NO persona seam") + `):

` + String(result.report ?? ""));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      if (caller.workspace === "" || caller.cell === null) {
        const ids = listCellIds(caller.workspace);
        for (const id of ids) {
          const read = readCell(caller.workspace, id);
          if (read.ok && read.state.phase === "stopped")
            return { ok: false, error: "cellwork_recon: cell " + id + " is stopped and archived — reconnaissance is refused after the mode ends" };
        }
        return { ok: false, error: "cellwork_recon: no active cell in this workspace" };
      }
      const result = await runRecon({
        spawn: (spec) => dsh.spawnAgent(spec).then((answer) => ({ output: answer.output, stopReason: answer.stopReason })),
        workspace: caller.workspace,
        cell: caller.cell,
        parent: exec.agent,
        caller: { member: caller.member, mode: caller.seat?.mode ?? "member" },
        config,
        personaFor,
        now: new Date
      }, { role: argString(argv, "role"), task: argString(argv, "task") });
      return result.ok ? { ...result } : { ok: false, error: result.error };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_split",
    description: "The SPLITTER's tool (cell-splitter only) for `submit`; any cell seat may `show` the last verdict. `submit` MEASURES every task (declared input bytes → tokens, the model-read context window) and validates the graph (dependency answer, acyclicity, write-scope ordering, verifier ≠ writer, role existence), accepting or refusing with a per-task breakdown; a refused split may be resubmitted.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["submit", "show"], description: "submit a graph, or show the last measured verdict." },
        revision: { type: "number", description: "submit: the requirements revision the graph targets; defaults to the accepted one." },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Stable task key; also the contract file name." },
              subject: { type: "string", description: "One-line title." },
              description: { type: "string", description: "The owner's acceptance text." },
              kind: { type: "string", enum: ["requirement", "work", "review", "repair", "integration"], description: "Chain kind; omitted means work." },
              ownerRole: { type: "string", description: "A roster role name or a cell role." },
              writeScopes: { type: "array", items: { type: "string" }, description: "Paths the task may write." },
              blockedBy: { type: "array", items: { type: "string" }, description: "Task keys that must close first; [] is an explicit root." },
              independent: { type: "boolean", description: "Explicit root, alternative to blockedBy: []." },
              inputs: { type: "array", items: { type: "string" }, description: "Workspace-relative paths the plugin MEASURES." },
              verify: { type: "boolean", description: "true when this task's work needs exactly one review task." }
            },
            required: ["key", "subject", "description", "ownerRole"],
            additionalProperties: false
          }
        }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          action: { type: "string" },
          accepted: { type: "boolean" },
          revision: { type: "number" },
          findings: { type: "array", items: { type: "object" } },
          roles: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          totals: { type: "object" },
          splitPath: { type: "string" },
          supersededRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          message: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_split refused: " + String(result.error ?? "unknown refusal"));
        if (typeof result.message === "string")
          return text(result.message);
        return text("split revision " + String(result.revision ?? "?") + ": " + (result.accepted === true ? "ACCEPTED" : "REFUSED") + (result.accepted === true ? "" : " — the per-task breakdown is at " + String(result.splitPath ?? "?")) + `
` + JSON.stringify(result.totals ?? {}, null, 2));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const action = argString(argv, "action");
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      if (caller.workspace === "" || caller.cell === null)
        return { ok: false, error: "cellwork_split: no active cell in this workspace" };
      const state = caller.cell;
      if (state.phase === "stopped")
        return { ok: false, error: "cellwork_split: cell " + state.cellId + " is stopped and archived" };
      if (action === "show") {
        const latest = latestSplit(caller.workspace, state.cellId);
        if (latest === null)
          return { ok: false, error: "cellwork_split show: no split has been submitted for " + state.cellId + " yet" };
        const read = latest.read;
        if (!read.ok)
          return { ok: false, error: "cellwork_split show: " + read.detail, path: read.path };
        const verdict2 = read.verdict;
        return { ok: true, action, accepted: verdict2.accepted, revision: verdict2.revision, findings: verdict2.findings, roles: verdict2.roles, tasks: verdict2.tasks, totals: verdict2.totals, splitPath: splitPathFor(caller.workspace, verdict2) };
      }
      if (action !== "submit")
        return { ok: false, error: "cellwork_split: action must be `submit` or `show` (got " + JSON.stringify(action) + ")" };
      if (caller.member !== SPLITTER_MEMBER) {
        return { ok: false, error: "cellwork_split submit is SPLITTER-ONLY: this session is " + JSON.stringify(caller.member === "" ? "not a cell member" : caller.member) + ". The split is requirement reasoning (clause 1) and belongs to cell-splitter, not the captain." };
      }
      if (state.requirementsRevision === 0)
        return { ok: false, error: "cellwork_split: the requirements document has not been FINALIZED yet (revision 0) — wait for the planner to close the interview and the captain to dispatch you" };
      const asked = typeof argv.revision === "number" ? argv.revision : state.requirementsRevision;
      if (asked !== state.requirementsRevision) {
        return { ok: false, error: "cellwork_split: revision " + String(asked) + " does not match the accepted requirements revision " + String(state.requirementsRevision) + " — a split is judged against the document it targets; re-read `cellwork_status` and resubmit against revision " + String(state.requirementsRevision) };
      }
      const rawTasks = Array.isArray(argv.tasks) ? argv.tasks : [];
      if (rawTasks.length === 0)
        return { ok: false, error: "cellwork_split: `tasks` is empty — submit the graph the planner's requirements justify" };
      const roster2 = rosterNames();
      if (roster2.length === 0)
        return { ok: false, error: "cellwork_split: the roster service (`mpdRoles`) is absent or empty in this composition, so owner roles cannot be validated — mount the roles row and resubmit" };
      const submission = {
        revision: asked,
        tasks: rawTasks.map((entry) => {
          const row = readArgs(entry);
          return {
            key: argString(row, "key"),
            subject: argString(row, "subject"),
            description: argString(row, "description"),
            ...argString(row, "kind") === "" ? {} : { kind: argString(row, "kind") },
            ownerRole: argString(row, "ownerRole"),
            writeScopes: stringList(row.writeScopes),
            blockedBy: Array.isArray(row.blockedBy) ? stringList(row.blockedBy) : row.independent === true ? [] : undefined,
            independent: row.independent === true,
            inputs: stringList(row.inputs),
            verify: row.verify === true
          };
        })
      };
      const verdict = await submitSplit({ workspace: caller.workspace, cellId: state.cellId, config, roster: roster2, window: windowFor, now: new Date }, submission);
      const splitPath2 = splitPathFor(caller.workspace, verdict);
      if (verdict.accepted) {
        const supersededRevision = state.splitRevision !== null && state.splitRevision !== verdict.revision ? state.splitRevision : null;
        transition(caller.workspace, { ...state, splitRevision: verdict.revision, splitStale: false }, { event: "split-accepted", revision: verdict.revision, totals: verdict.totals, ...supersededRevision === null ? {} : { supersededRevision } }, new Date);
        if (supersededRevision !== null) {
          appendJournal(caller.workspace, state.cellId, { event: "split-superseded", revision: supersededRevision, by: verdict.revision, activated: state.activatedRevision }, new Date);
        }
        return { ok: true, action, accepted: true, revision: verdict.revision, findings: verdict.findings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath: splitPath2, supersededRevision, message: "split revision " + String(verdict.revision) + " ACCEPTED" + (supersededRevision === null ? "" : " (revision " + String(supersededRevision) + " is superseded)") + " — the captain may call `cellwork_activate`" };
      }
      appendJournal(caller.workspace, state.cellId, { event: "split-refused", revision: verdict.revision, findings: verdict.findings.length, refused: verdict.totals.refusedCount }, new Date);
      return { ok: true, action, accepted: false, revision: verdict.revision, findings: verdict.findings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath: splitPath2 };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_activate",
    description: "CAPTAIN only: materialise an ACCEPTED split on the LIVE team record. Requires an accepted split of the CURRENT requirements revision (a stale split is refused unless its revision is passed explicitly). Writes one frozen contract per NEW code task, raises each owner role as a member (persona TEXT in the prompt), appends each NEW task with reviews blocked by their work task, opens one verify loop per NEW code task BEFORE dispatch, then dispatches owner-only. A NEWER revision APPENDS to the same team: kept work reuses its board row, added work is appended, dropped work is marked `cancelled` and never deleted. It never re-creates the team.",
    parameters: {
      type: "object",
      properties: {
        revision: { type: "number", description: "The accepted split revision to activate when the requirements moved on (explicitly acknowledges staleness)." }
      },
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          mode: { type: "string", description: "`initial` for the first materialisation, `resplit` when a newer revision appended to the same team." },
          revision: { type: "number" },
          contracts: { type: "array", items: { type: "string" } },
          membersRaised: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "object" } },
          kept: { type: "array", items: { type: "string" }, description: "Split keys whose live board row was reused (never duplicated)." },
          cancelled: { type: "array", items: { type: "object" }, description: "Work this revision dropped: `{key, boardId}`, marked cancelled on the cell record and never deleted." },
          loops: { type: "array", items: { type: "object" } },
          dispatch: { type: "object" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_activate refused: " + String(result.error ?? "unknown refusal"));
        const dispatch = typeof result.dispatch === "object" && result.dispatch !== null ? result.dispatch : {};
        const pairs = Array.isArray(dispatch.pairs) ? dispatch.pairs : [];
        const skipped = Array.isArray(dispatch.skipped) ? dispatch.skipped : [];
        return text("cell activated on split revision " + String(result.revision ?? "?") + (result.mode === "resplit" ? " (re-split: " + String(Array.isArray(result.kept) ? result.kept.length : 0) + " kept, " + String(Array.isArray(result.cancelled) ? result.cancelled.length : 0) + " cancelled)" : "") + ": " + String(Array.isArray(result.tasks) ? result.tasks.length : 0) + " task(s), " + String(Array.isArray(result.loops) ? result.loops.length : 0) + " verify loop(s), " + pairs.length + " dispatched" + (skipped.length === 0 ? "" : ", " + skipped.length + " reported: " + skipped.map((row) => String(row.subject ?? row.taskId) + ": " + String(row.reason)).join("; ")));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      if (caller.workspace === "" || caller.cell === null)
        return { ok: false, error: "cellwork_activate: no active cell in this workspace" };
      const state = caller.cell;
      if (sessionIdOf(exec.agent) === "") {
        return { ok: false, error: "cellwork_activate: this dispatch carries no LIVE caller agent (no session id), so the verify loops cannot be opened under a real session — nothing was materialised. Call this tool from a live agent session; a detached or synthetic handle is not accepted." };
      }
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId)
        return { ok: false, error: "cellwork_activate is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" };
      if (state.phase === "stopped")
        return { ok: false, error: "cellwork_activate: cell " + state.cellId + " is stopped and archived" };
      if (state.teamId === "")
        return { ok: false, error: "cellwork_activate: no planning team is recorded on " + state.cellId + " — run `cellwork_start` first" };
      const acceptedRevision = state.splitRevision;
      if (acceptedRevision === null)
        return { ok: false, error: "cellwork_activate: no split has been ACCEPTED for this cell — the splitter must submit one first" };
      const explicit = typeof argv.revision === "number" ? argv.revision : undefined;
      const movedOn = state.splitStale || acceptedRevision !== state.requirementsRevision;
      if (movedOn && explicit !== acceptedRevision) {
        return { ok: false, error: "cellwork_activate: split revision " + String(acceptedRevision) + " is STALE (requirements revision " + String(state.requirementsRevision) + (state.splitStale ? ", marked stale by an update" : "") + ") — the splitter must re-submit against the current revision; to activate the stale revision deliberately, pass {revision:" + String(acceptedRevision) + "}" };
      }
      if (state.activatedRevision !== null) {
        if (acceptedRevision === state.activatedRevision) {
          return { ok: false, error: "cellwork_activate: split revision " + String(state.activatedRevision) + " is already materialised on team " + state.teamId + " — nothing would be added. A re-split is a requirements `update` (which bumps the revision and marks the split stale), a NEW accepted split revision, then this call again" };
        }
        if (acceptedRevision < state.activatedRevision) {
          return { ok: false, error: "cellwork_activate: split revision " + String(acceptedRevision) + " is OLDER than the materialised revision " + String(state.activatedRevision) + " — revisions only move forward; accept a newer split instead" };
        }
      }
      if (state.activationInFlight !== null && state.activationInFlight !== undefined && state.activationInFlight !== acceptedRevision) {
        return { ok: false, error: "cellwork_activate: split revision " + String(state.activationInFlight) + " is IN FLIGHT (a previous activation of it failed part-way), so revision " + String(acceptedRevision) + " cannot be materialised now — resume revision " + String(state.activationInFlight) + " while it is still the accepted split, or stop the cell. Activating a different revision would duplicate its board rows." };
      }
      const stored = readSplit(caller.workspace, state.cellId, acceptedRevision);
      if (!stored.ok)
        return { ok: false, error: "cellwork_activate: " + stored.detail, path: stored.path };
      if (!stored.verdict.accepted)
        return { ok: false, error: "cellwork_activate: revision " + String(acceptedRevision) + " was REFUSED by the measured verdict — the splitter must fix the findings and resubmit" };
      const persistPartial = (partial, error) => {
        const next2 = {
          ...state,
          activationInFlight: acceptedRevision,
          members: { ...state.members, ...partial.members },
          activatedTasks: { ...state.activatedTasks, ...partial.boardIds },
          activatedLoops: { ...state.activatedLoops ?? {}, ...partial.loopIds }
        };
        transition(caller.workspace, next2, { event: "cell-activation-partial", revision: acceptedRevision, members: Object.keys(partial.members), tasks: partial.boardIds, loops: partial.loopIds, contracts: Object.values(partial.contracts), ...error === undefined ? {} : { error } }, new Date);
      };
      const activated = await materializeSplit({
        dsh,
        workspace: caller.workspace,
        cell: state,
        config,
        captainAgent: exec.agent,
        split: stored.verdict,
        personaFor,
        recordFor: (teamId) => recordOf(teams(), caller.workspace, teamId),
        checkpoint: (partial) => {
          persistPartial(partial);
        },
        now: new Date
      });
      if (!activated.ok) {
        if (activated.partial !== undefined)
          persistPartial(activated.partial, activated.error);
        return { ok: false, error: activated.error };
      }
      const cancelledNow = {};
      for (const entry of activated.outcome.cancelled)
        cancelledNow[entry.key] = entry.boardId;
      const loopTable = { ...state.activatedLoops ?? {} };
      for (const loop of activated.outcome.loops)
        loopTable[loop.taskKey] = loop.loopId;
      const next = {
        ...state,
        phase: "executing",
        activatedRevision: acceptedRevision,
        activationInFlight: null,
        activatedTasks: { ...activated.outcome.boardIds },
        activatedLoops: loopTable,
        cancelledTasks: { ...state.cancelledTasks, ...cancelledNow },
        splitStale: false,
        members: { ...state.members, ...activated.outcome.members }
      };
      transition(caller.workspace, next, { event: "cell-activation", mode: activated.outcome.mode, revision: acceptedRevision, tasks: activated.outcome.tasks.length, kept: activated.outcome.kept.length, cancelled: activated.outcome.cancelled.length, loops: activated.outcome.loops.length, reused: activated.outcome.reused }, new Date);
      return {
        ok: true,
        cellId: state.cellId,
        mode: activated.outcome.mode,
        revision: acceptedRevision,
        contracts: activated.outcome.contracts,
        membersRaised: Object.keys(activated.outcome.members),
        reused: activated.outcome.reused,
        tasks: activated.outcome.tasks,
        kept: activated.outcome.kept,
        cancelled: activated.outcome.cancelled,
        loops: activated.outcome.loops,
        dispatch: activated.outcome.dispatch
      };
    }
  }));
  return disposers;
}
function text(value) {
  return [{ type: "text", text: value }];
}

// packages/mpd-cellwork-plugin/src/handoff.ts
var HANDOFF_SECTIONS = [
  { key: "task", title: "Task", aliases: ["task", "current task"] },
  { key: "state", title: "State", aliases: ["state", "current state"] },
  { key: "decisions", title: "Decisions", aliases: ["decisions", "decision", "decisions and why"] },
  { key: "artifacts", title: "Artifacts", aliases: ["artifacts", "artefacts", "files"] },
  { key: "verified", title: "Verified facts", aliases: ["verified facts", "verified", "facts"] },
  { key: "open", title: "Open questions", aliases: ["open questions", "open", "questions"] },
  { key: "next", title: "Next step", aliases: ["next step", "next"] }
];
function normalizeHandoffLabel(label) {
  return label.replace(/[*_`]/g, "").replace(/[:：]\s*$/, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function parseHandoff(text2) {
  const sections = new Map;
  let current;
  let body = [];
  const flush = () => {
    if (current !== undefined && !sections.has(current))
      sections.set(current, body.join(`
`).trim());
    body = [];
  };
  for (const line of text2.split(`
`)) {
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      flush();
      current = normalizeHandoffLabel(heading[2]);
      continue;
    }
    if (current !== undefined)
      body.push(line);
  }
  flush();
  if (sections.size > 0)
    return sections;
  for (const line of text2.split(`
`)) {
    const keyed = /^\s*(?:[-*+]\s+)?([A-Za-z][A-Za-z /_-]{0,40}):\s*(.*)$/.exec(line);
    if (keyed === null)
      continue;
    const label = normalizeHandoffLabel(keyed[1]);
    if (!sections.has(label))
      sections.set(label, keyed[2].trim());
  }
  return sections;
}
function validateHandoffText(text2) {
  const parsed = parseHandoff(text2);
  const readings = [];
  const missing = [];
  for (const section of HANDOFF_SECTIONS) {
    let matched;
    for (const label of parsed.keys()) {
      if (section.aliases.includes(label) || section.aliases.some((alias) => label.startsWith(alias + " "))) {
        matched = label;
        break;
      }
    }
    const content = matched === undefined ? "" : parsed.get(matched) ?? "";
    const chars = content.replace(/\s+/g, "").length;
    readings.push({ key: section.key, title: section.title, present: matched !== undefined, chars });
    if (matched === undefined || chars === 0)
      missing.push(section.title);
  }
  return { ok: missing.length === 0, missing, sections: readings };
}
function writeHandoff(workspace, cellId, member, ordinal, text2) {
  const path = handoffPath(workspace, cellId, member, ordinal);
  atomicWriteText(path, text2.endsWith(`
`) ? text2 : text2 + `
`);
  return path;
}

// packages/mpd-cellwork-plugin/src/mail.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join4 } from "node:path";
var CELL_MAIL_FILE = "mail.jsonl";
function cellMailPath(workspace, cellId) {
  return join4(cellDir(workspace, cellId), CELL_MAIL_FILE);
}
function mailId(now, sequence) {
  return "cellmail-" + now.toISOString().replace(/[-:.TZ]/g, "") + "-" + String(sequence);
}
function appendCellMail(workspace, cellId, record) {
  try {
    const path = cellMailPath(workspace, cellId);
    mkdirSync3(cellDir(workspace, cellId), { recursive: true });
    appendFileSync2(path, JSON.stringify(record) + `
`, "utf8");
    return true;
  } catch {
    return false;
  }
}
function readCellMail(workspace, cellId) {
  let text2;
  try {
    text2 = readFileSync4(cellMailPath(workspace, cellId), "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of text2.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && (parsed.t === "send" || parsed.t === "read"))
        records.push(parsed);
    } catch {}
  }
  return records;
}
function foldCellMail(records) {
  const byId = new Map;
  for (const record of records) {
    if (record.t === "send") {
      byId.set(record.id, { ...record, read: false });
    } else {
      const message = byId.get(record.id);
      if (message !== undefined)
        message.read = true;
    }
  }
  return [...byId.values()];
}
function unreadFor(messages, names) {
  const keys = new Set(names.filter((name) => name !== "").map(nameKey));
  return messages.filter((message) => !message.read && keys.has(nameKey(message.to)));
}
function wakeFailures(messages) {
  return messages.filter((message) => !message.read && !message.wakeSent);
}

// packages/mpd-cellwork-plugin/src/protocol-core.ts
function planCheckpoint(cell, memberName, pressure, config, turn) {
  const member = cell.members[memberName];
  const base = { inject: false, memberName, usedTokens: pressure?.usedTokens ?? null, windowTokens: pressure?.windowTokens ?? null, ratio: pressure?.ratio ?? null, turn, reason: "" };
  if (member === undefined)
    return { ...base, reason: "the session is not a recorded cell member" };
  if (member.mode === "subcaptain")
    return { ...base, reason: "a promoted subcaptain dispatches and is never checkpointed (declared bound)" };
  if (member.handoffReady)
    return { ...base, reason: "a handoff is already written and waiting for compaction" };
  if (member.mode === "checkpoint")
    return { ...base, reason: "a checkpoint is already pending for this member" };
  if (pressure?.provenance !== "observed" || pressure.windowTokens === null || pressure.ratio === null) {
    return { ...base, reason: "no observed context window yet — never guess a checkpoint" };
  }
  if (pressure.ratio < config.checkpointRatio)
    return { ...base, reason: "below the checkpoint ratio" };
  if (turn !== null && cell.checkpoints.some((entry) => entry.sessionId === member.sessionId && entry.turn === turn)) {
    return { ...base, reason: "this turn already received its checkpoint message" };
  }
  return { ...base, inject: true, reason: "the observed ratio reached the checkpoint threshold" };
}
function applyCheckpoint(state, plan, sessionId, now) {
  const member = state.members[plan.memberName];
  const members = member === undefined ? state.members : { ...state.members, [plan.memberName]: { ...member, mode: "checkpoint" } };
  return {
    ...state,
    members,
    checkpoints: [...state.checkpoints, { sessionId, at: now.toISOString(), usedTokens: plan.usedTokens, contextWindow: plan.windowTokens, turn: plan.turn ?? 0 }]
  };
}
function checkpointDirective(memberName, plan) {
  return [
    "[mpd-cellwork] CONTEXT CHECKPOINT — " + memberName + " reached " + String(plan.ratio === null ? "?" : Math.round(plan.ratio * 100)) + "% of its observed context window" + (plan.usedTokens === null || plan.windowTokens === null ? "" : " (" + String(plan.usedTokens) + " of " + String(plan.windowTokens) + " tokens)") + ".",
    "",
    "STOP WORK NOW. Your tool scope is fenced to `cellwork_handoff`, `cellwork_context` and `cellwork_status`.",
    "Call `cellwork_handoff` with a document carrying these sections (headings or `Key:` lines):",
    "  Task · State · Decisions (and why) · Artifacts · Verified facts · Open questions · Next step",
    "Then END YOUR TURN and do nothing else. The plugin compacts your context and promotes you (or reseeds",
    "you from that handoff); anything you did not write down is lost."
  ].join(`
`);
}
function promotionDirective(cellId, memberName, depth, nextStep) {
  return [
    "[mpd-cellwork] PROMOTED — " + memberName + " of cell " + cellId + " is now a SUBCAPTAIN at depth " + String(depth) + ".",
    "",
    "Your context was compacted and your handoff is the continuity. The next step from that handoff:",
    "  " + (nextStep === "" ? "(the handoff named none — read the document)" : nextStep),
    "",
    "A subcaptain DISPATCHES: stage your sub-team with `agent_teams_plan` and register the sub-cell with",
    "`cellwork_subteam {objective}` (the plugin refuses a depth beyond the cell cap). You may consult",
    "read-only children with `cellwork_recon`, and you keep `cellwork_dispatch`/`cellwork_status`."
  ].join(`
`);
}
function handoffWrittenDirective(path) {
  return "[mpd-cellwork] handoff written to " + path + ". END YOUR TURN NOW — do not call another tool; the plugin compacts and promotes you from that document.";
}
function subteamDirective(subcellId, depth, parentCellId, parentTeamId) {
  return [
    "[mpd-cellwork] SUB-CELL " + subcellId + " registered (depth " + String(depth) + ", parent " + parentCellId + ").",
    "",
    parentTeamId === "" ? "This cell has no team of its own yet, so your sub-team will be a ROOT team in the DAG." : "Your sub-team NESTS AS A BOX inside team " + parentTeamId + ": the team plane derives the parent from that team's own roster, which records you as a member — you never pass a parent id.",
    "You are its captain now: stage the sub-team with `agent_teams_plan` (members + tasks, approve), then",
    "`cellwork_activate` with the accepted split. The same guard applies to you as to any captain: dispatch",
    "only. Your surface here is `cellwork_dispatch`, `cellwork_supervise`, `cellwork_activate` and",
    "`cellwork_subteam`; starting and ending a cell belong to the PARENT captain, and the guard refuses",
    "those verbs for you. To leave this sub-cell, `cellwork_send` a stop request to the parent cell — the",
    "parent archives it and your record is kept."
  ].join(`
`);
}
function classifyCompactionResult(result) {
  return result === null || result === undefined ? "no-safe-range" : "compacted";
}
function classifyCompactionError(error, signal) {
  if (signal.aborted)
    return "aborted";
  const shaped = typeof error === "object" && error !== null ? error : {};
  if (shaped.name === "AbortError" || shaped.code === "ABORT_ERR")
    return "aborted";
  if (shaped.code === "busy")
    return "busy";
  const text2 = typeof shaped.message === "string" ? shaped.message : String(error);
  return /\bbusy\b/i.test(text2) ? "busy" : "failed";
}
function compactionSignal(parent) {
  const controller = new AbortController;
  return { controller, signal: parent === undefined ? controller.signal : AbortSignal.any([parent, controller.signal]) };
}
function compactionJournalEntry(memberName, result) {
  return {
    event: "compaction",
    member: memberName,
    outcome: result.outcome,
    attempts: result.attempts,
    reason: result.reason,
    ...result.newHandle === undefined ? {} : { newHandle: result.newHandle }
  };
}
async function promoteAfterHandoff(deps) {
  let lastReason = "not attempted";
  for (let attempt = 1;attempt <= deps.config.compactionRetries; attempt += 1) {
    await deps.sleep(deps.config.idleBarrierDelayMs);
    const engine = deps.dsh.compactionEngineForAgent(deps.sessionId);
    if (engine === undefined || typeof engine.compactNow !== "function") {
      lastReason = "no-engine";
      continue;
    }
    const { signal } = compactionSignal(deps.signal);
    try {
      const result = await engine.compactNow(deps.agent, signal);
      const outcome = classifyCompactionResult(result);
      lastReason = outcome;
      if (outcome === "compacted") {
        deps.injectDirective(promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep));
        return { outcome: "promoted", attempts: attempt, reason: outcome };
      }
    } catch (error) {
      lastReason = classifyCompactionError(error, signal);
      if (lastReason === "aborted" && deps.signal?.aborted === true)
        return { outcome: "refused", attempts: attempt, reason: "the caller cancelled the barrier" };
    }
  }
  try {
    deps.dsh.interruptAgent(deps.sessionId, { kind: "ancestor", agent: deps.agent });
  } catch {}
  try {
    const activation = await deps.dsh.startContinuableAgent({
      provider: "spawn",
      label: deps.memberName + " · " + deps.cell.teamId,
      request: {
        prompt: deps.handoffText + `

` + promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep),
        parent: deps.agent,
        maxDepth: deps.config.depthMax
      },
      signal: compactionSignal().signal
    });
    const handle = typeof activation?.childId === "string" ? activation.childId : typeof activation?.id === "string" ? activation.id : "";
    if (handle === "")
      return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + "; the reseed reported no child id" };
    return { outcome: "reseeded", attempts: deps.config.compactionRetries, reason: lastReason, newHandle: handle };
  } catch (error) {
    return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + "; the reseed failed: " + (error instanceof Error ? error.message : String(error)) };
  }
}
function nextStepOf(text2) {
  const match = /(?:^|\n)(?:#{1,4}\s*|-?\s*)next step\s*:?\s*([^\n]*)/i.exec(text2);
  return match === null ? "" : match[1].trim();
}

// packages/mpd-cellwork-plugin/src/protocol.ts
import { readFileSync as readFileSync5 } from "node:fs";
function readArgs2(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return {};
  return args;
}
function argString2(args, key) {
  return typeof args[key] === "string" ? args[key] : "";
}
function render(value) {
  return [{ type: "text", text: value }];
}
function refusalText2(failure) {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed";
}
function superviseTaskRow(task) {
  return {
    ...typeof task.id === "string" ? { id: task.id } : {},
    ...typeof task.subject === "string" ? { subject: task.subject } : {},
    ...typeof task.status === "string" ? { status: task.status } : {},
    ...typeof task.owner === "string" ? { owner: task.owner } : {},
    ...typeof task.kind === "string" ? { kind: task.kind } : {}
  };
}
function installCellworkProtocol(deps) {
  const dsh = deps.dsh;
  const config = deps.config;
  const disposers = [];
  let mailSequence = 0;
  const inFlight = new Set;
  const teams = () => {
    const service = deps.ctx.get?.("mpdTeams", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const callerFor = (exec) => callerContext(dsh, exec, { teams });
  const recordOf2 = (workspace, teamId) => {
    if (teamId === "" || workspace === "")
      return;
    const record = teams()?.get?.(workspace, teamId);
    return typeof record === "object" && record !== null ? record : undefined;
  };
  const transition = (workspace, next, entry, now) => {
    const lines = appendJournal(workspace, next.cellId, entry, now);
    const stamped = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor };
    writeCell(workspace, stamped);
    return { ...stamped, updatedAt: now.toISOString() };
  };
  const captainOnly = (caller, tool) => caller.sessionId === "" || caller.cell === null || caller.sessionId !== caller.cell.captainSessionId ? { ok: false, error: tool + " is CAPTAIN-ONLY: the captain of this cell is session " + String(caller.cell?.captainSessionId ?? "none") + ", which is not this caller" } : undefined;
  disposers.push(dsh.registerTool({
    name: "cellwork_dispatch",
    description: "CAPTAIN only: one owner-only dispatch pass over the live board. A ready task is paired ONLY with its declared owner; a busy, absent or failed owner is REPORTED and the task left pending — never substituted. Delivery goes through the team executor and is journaled.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          pairs: { type: "array", items: { type: "object" } },
          skipped: { type: "array", items: { type: "object" } },
          refused: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_dispatch refused: " + String(result.error ?? "unknown refusal"));
        const pairs = Array.isArray(result.pairs) ? result.pairs : [];
        const skipped = Array.isArray(result.skipped) ? result.skipped : [];
        if (typeof result.refused === "string")
          return render("cellwork_dispatch refused: " + result.refused);
        return render(pairs.length === 0 ? "nothing dispatched" + (skipped.length === 0 ? "" : " (" + skipped.map((row) => String(row.subject) + ": " + String(row.reason)).join("; ") + ")") : pairs.map((row) => String(row.subject) + " -> " + String(row.memberName)).join(`
`) + (skipped.length === 0 ? "" : `
reported: ` + skipped.length));
      }
    },
    execute: async (_args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      const refused = captainOnly(caller, "cellwork_dispatch");
      if (refused !== undefined)
        return refused;
      const cell = caller.cell;
      if (cell.phase === "stopped")
        return { ok: false, error: "cellwork_dispatch: cell " + cell.cellId + " is stopped and archived" };
      const send = sendThroughExecutor(dsh.teamExecutor(), exec.agent);
      if (send === undefined)
        return { ok: false, error: "cellwork_dispatch: this composition exposes no team executor, so no member can be woken" };
      const record = recordOf2(caller.workspace, cell.teamId);
      const report = await dispatchOwnerOnly({
        workspace: caller.workspace,
        cell,
        record,
        send,
        now: new Date,
        handleFor: (name) => cell.members[name]?.executorRef,
        excludedTaskIds: Object.values(cell.cancelledTasks)
      });
      appendJournal(caller.workspace, cell.cellId, { event: "dispatch-pass", pairs: report.pairs.length, skipped: report.skipped.length }, new Date);
      return { ok: true, pairs: report.pairs, skipped: report.skipped, ...report.refused === undefined ? {} : { refused: report.refused } };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_supervise",
    description: "CAPTAIN only: one READ-ONLY sweep of the cell — every member's mode / handoff state / live context ratio, the pending board tasks, the stale-split flags and the unread mail (including rows whose wake-up never went out). Call it on every wake-up; it mutates nothing.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          staleSplit: { type: "boolean" },
          splitRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          requirementsRevision: { type: "number" },
          handoffReady: { type: "array", items: { type: "string" } },
          unreadMail: { type: "number" },
          wakeFailures: { type: "array", items: { type: "object" } }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_supervise refused: " + String(result.error ?? "unknown refusal"));
        const members = Array.isArray(result.members) ? result.members : [];
        const tasks = Array.isArray(result.tasks) ? result.tasks : [];
        return render([
          "cell " + String(result.cellId ?? "") + " · phase " + String(result.phase ?? "") + " · split " + String(result.splitRevision ?? "none") + (result.staleSplit === true ? " (STALE)" : "") + " · requirements rev " + String(result.requirementsRevision ?? 0),
          "members: " + members.map((row) => String(row.name) + "[" + String(row.mode) + (row.handoffReady === true ? ",handoff-ready" : "") + (typeof row.ratio === "number" ? "," + Math.round(row.ratio * 100) + "%" : "") + "]").join(" "),
          "tasks: " + (tasks.length === 0 ? "none" : tasks.map((row) => String(row.id) + " " + String(row.status) + (row.owner === undefined ? "" : "(" + String(row.owner) + ")")).join(" ")),
          "unread mail: " + String(result.unreadMail ?? 0) + (Array.isArray(result.wakeFailures) && result.wakeFailures.length > 0 ? " · " + String(result.wakeFailures.length) + " without a wake-up" : "")
        ].join(`
`));
      }
    },
    execute: async (_args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      const refused = captainOnly(caller, "cellwork_supervise");
      if (refused !== undefined)
        return refused;
      const cell = caller.cell;
      const record = recordOf2(caller.workspace, cell.teamId);
      const tasks = record !== undefined && Array.isArray(record.tasks) ? record.tasks : [];
      const members = Object.values(cell.members).map((member) => {
        const pressure = dsh.contextPressure(member.sessionId === "" ? member.name : member.sessionId);
        return { name: member.name, mode: member.mode, role: member.role, handoffReady: member.handoffReady, handoffs: member.handoffs, ratio: pressure.ratio, usedTokens: pressure.usedTokens, windowTokens: pressure.windowTokens, provenance: pressure.provenance };
      });
      const messages = foldCellMail(readCellMail(caller.workspace, cell.cellId));
      return {
        ok: true,
        cellId: cell.cellId,
        phase: cell.phase,
        members,
        tasks: tasks.map((task) => superviseTaskRow(task)),
        staleSplit: cell.splitStale,
        splitRevision: cell.splitRevision,
        requirementsRevision: cell.requirementsRevision,
        handoffReady: Object.values(cell.members).filter((member) => member.handoffReady).map((member) => member.name),
        unreadMail: messages.filter((message) => !message.read).length,
        wakeFailures: wakeFailures(messages).map((message) => ({ id: message.id, to: message.to, subject: message.subject, reason: message.wakeReason ?? "no wake-up was attempted" }))
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_context",
    description: "Any cell seat: the caller's OWN live context occupancy — used tokens, the observed window and its provenance, the ratio, the checkpoint threshold in force, and whether a checkpoint would fire at this step. Read-only; never guesses a window (provenance `no-window`/`unavailable` answers null).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          member: { type: "string" },
          mode: { type: "string" },
          usedTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          windowTokens: { oneOf: [{ type: "number" }, { type: "null" }] },
          ratio: { oneOf: [{ type: "number" }, { type: "null" }] },
          provenance: { type: "string" },
          checkpointRatio: { type: "number" },
          willCheckpoint: { type: "boolean" },
          reason: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_context refused: " + String(result.error ?? "unknown refusal"));
        return render(String(result.member ?? "?") + " [" + String(result.mode ?? "?") + "] used " + String(result.usedTokens ?? "?") + " / " + String(result.windowTokens ?? "no window") + " (" + String(result.provenance) + ")" + (typeof result.ratio === "number" ? " = " + Math.round(result.ratio * 100) + "%" : "") + " · checkpoint at " + String(Math.round(Number(result.checkpointRatio ?? 0) * 100)) + "% · would fire: " + String(result.willCheckpoint === true) + (String(result.reason ?? "") === "" ? "" : " (" + String(result.reason) + ")"));
      }
    },
    execute: async (_args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_context: this session belongs to no active cell" };
      const pressure = dsh.contextPressure(exec.agent);
      const plan = planCheckpoint(caller.cell, caller.member, pressure, config, null);
      return {
        ok: true,
        member: caller.member,
        mode: caller.seat?.mode ?? "member",
        usedTokens: pressure.usedTokens,
        windowTokens: pressure.windowTokens,
        ratio: pressure.ratio,
        provenance: pressure.provenance,
        checkpointRatio: config.checkpointRatio,
        willCheckpoint: plan.inject,
        reason: plan.reason
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_handoff",
    description: "A MEMBER's checkpoint duty: validate a handoff document (task, state, decisions, artifacts, verified facts, open questions, next step), write `handoff/<member>-<n>.md`, mark the member handoff-ready and journal it. The result tells the agent to END ITS TURN; the plugin then compacts and promotes (or reseeds) it.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The complete handoff document (markdown headings or `Key:` lines)." }
      },
      required: ["content"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          member: { type: "string" },
          ordinal: { type: "number" },
          missing: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "object" } },
          directive: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_handoff refused: " + String(result.error ?? "unknown refusal") + (Array.isArray(result.missing) && result.missing.length > 0 ? `
missing sections: ` + result.missing.join(", ") : ""));
        return render(String(result.directive ?? ""));
      }
    },
    execute: async (args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_handoff: this session belongs to no active cell" };
      const member = caller.cell.members[caller.member];
      if (member === undefined)
        return { ok: false, error: "cellwork_handoff: " + JSON.stringify(caller.member) + " is not a recorded cell member" };
      if (caller.sessionId === caller.cell.captainSessionId)
        return { ok: false, error: "cellwork_handoff: the captain is never checkpointed (declared bound) — it dispatches, it does not hand off" };
      const content = argString2(readArgs2(args), "content");
      if (content.trim() === "")
        return { ok: false, error: "cellwork_handoff: `content` is required — the handoff document IS the continuity, so there is nothing to validate without it" };
      const validation = validateHandoffText(content);
      if (!validation.ok)
        return { ok: false, error: "cellwork_handoff: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", "), ...{ missing: validation.missing, sections: validation.sections } };
      const ordinal = member.handoffs + 1;
      const path = writeHandoff(caller.workspace, caller.cell.cellId, caller.member, ordinal, content);
      const now = new Date;
      const next = { ...caller.cell, members: { ...caller.cell.members, [caller.member]: { ...member, handoffReady: true, handoffs: ordinal } } };
      transition(caller.workspace, next, { event: "handoff", member: caller.member, ordinal, path, nextStep: nextStepOf(content) }, now);
      return { ok: true, path, member: caller.member, ordinal, sections: validation.sections, directive: handoffWrittenDirective(path) };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_subteam",
    description: "A promoted SUBCAPTAIN's tool: register a sub-cell (parentCellId, depth+1) and receive the sub-captain directive. REFUSES `depth + 1 > cellwork.depth.max` with the exact bound. The sub-team itself is staged by the promoted agent with `agent_teams_plan`.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The sub-cell's objective, in the user's terms." }
      },
      required: ["objective"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          cellId: { type: "string" },
          parentCellId: { type: "string" },
          parentTeamId: { type: "string" },
          depth: { type: "number" },
          directive: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_subteam refused: " + String(result.error ?? "unknown refusal"));
        return render(String(result.directive ?? ""));
      }
    },
    execute: async (args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_subteam: this session belongs to no active cell" };
      const mayNest = caller.seat?.mode === "subcaptain" || caller.seat?.mode === "captain" && caller.cell.parentCellId !== null;
      if (!mayNest)
        return { ok: false, error: "cellwork_subteam is SUBCAPTAIN ONLY: this session is " + JSON.stringify(caller.member) + " in mode " + JSON.stringify(caller.seat?.mode ?? "none") + " — a sub-cell is registered by a member the plugin promoted after its handoff+compaction (or by the captain of a sub-cell, to nest deeper)" };
      const parent = caller.cell;
      if (parent.phase === "stopped")
        return { ok: false, error: "cellwork_subteam: cell " + parent.cellId + " is stopped and archived" };
      const childDepth = parent.depth + 1;
      if (childDepth > config.depthMax) {
        return { ok: false, error: "cellwork_subteam: REFUSED — a sub-cell at depth " + String(childDepth) + " exceeds cellwork.depth.max = " + String(config.depthMax) + " (this cell is depth " + String(parent.depth) + "). Do the work inside this cell instead." };
      }
      const objective = argString2(readArgs2(args), "objective").trim();
      if (objective === "")
        return { ok: false, error: "cellwork_subteam: `objective` is required — a sub-cell needs its own objective" };
      const now = new Date;
      const subcellId = freeCellId(caller.workspace, now);
      const parentTeamId = parent.teamId;
      const subcell = { ...newCellState({ cellId: subcellId, objective, captainSessionId: caller.sessionId, now, depth: childDepth, parentCellId: parent.cellId }), parentTeamId };
      writeCell(caller.workspace, subcell);
      const next = { ...parent, subcellIds: [...parent.subcellIds, subcellId] };
      transition(caller.workspace, next, { event: "subcell", subcellId, depth: childDepth, parentCellId: parent.cellId, parentTeamId, objective }, now);
      appendJournal(caller.workspace, subcellId, { event: "subcell-created", parentCellId: parent.cellId, depth: childDepth, captainSessionId: caller.sessionId, parentTeamId }, now);
      return { ok: true, cellId: subcellId, parentCellId: parent.cellId, parentTeamId, depth: childDepth, directive: subteamDirective(subcellId, childDepth, parent.cellId, parentTeamId) };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_send",
    description: "Any cell seat: send one durable cell message to `captain`, a member of this cell by name, or `<cellId>/<captain|member>` for a cell in this cell's tree (a sub-cell it registered, or its parent). The row is appended to the RECIPIENT cell's own mail log FIRST (durable), then a wake-up is attempted through the team executor when the sender is this cell's captain and the recipient holds a handle; a failed wake-up is journaled and surfaced on `cellwork_supervise`. The journal carries the `cell:<cellId>` stamp.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "`captain`, a cell member's board name, or `<cellId>/<captain|member>` for a cross-cell recipient in this cell's tree." },
        subject: { type: "string", description: "One-line subject." },
        body: { type: "string", description: "The message text, delivered verbatim." }
      },
      required: ["to", "subject", "body"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          id: { type: "string" },
          to: { type: "string" },
          crossCell: { type: "string", description: "The cell id the row was written into, when the send crossed cells." },
          fromCell: { type: "string", description: "The sender's own cell id, mirrored onto a cross-cell row." },
          wakeSent: { type: "boolean" },
          wakeReason: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_send refused: " + String(result.error ?? "unknown refusal"));
        return render("mail " + String(result.id ?? "") + " -> " + String(result.to ?? "") + (result.wakeSent === true ? " (wake-up sent)" : " (durable; no wake-up: " + String(result.wakeReason ?? "best-effort") + ")"));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs2(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_send: this session belongs to no active cell" };
      const requested = argString2(argv, "to").trim();
      if (requested === "")
        return { ok: false, error: "cellwork_send: `to` is required (`captain`, a member name, or `<cellId>/<captain|member>` for a cell in this cell's tree)" };
      const subject = argString2(argv, "subject").trim();
      const body = argString2(argv, "body");
      if (subject === "" || body.trim() === "")
        return { ok: false, error: "cellwork_send: `subject` and `body` are both required" };
      const slash = requested.lastIndexOf("/");
      const targetCellId = slash < 0 ? caller.cell.cellId : requested.slice(0, slash).trim();
      const requestedName = slash < 0 ? requested : requested.slice(slash + 1).trim();
      if (requestedName === "")
        return { ok: false, error: "cellwork_send: " + JSON.stringify(requested) + " names no recipient — use `<cellId>/<captain|member>`" };
      const crossCell = targetCellId !== caller.cell.cellId;
      let target = caller.cell;
      if (crossCell) {
        if (targetCellId !== caller.cell.parentCellId && !caller.cell.subcellIds.includes(targetCellId)) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(targetCellId) + " is not in this cell's tree — a cross-cell recipient must be a SUB-CELL of " + caller.cell.cellId + " (" + (caller.cell.subcellIds.join(", ") || "none") + ") or its parent cell (" + (caller.cell.parentCellId ?? "none") + ")" };
        }
        const read = readCell(caller.workspace, targetCellId);
        if (!read.ok)
          return { ok: false, error: "cellwork_send: the cross-cell recipient's record at " + read.path + " cannot be read (" + read.reason + ": " + read.detail + ") — nothing was sent", path: read.path };
        target = read.state;
      }
      const toCaptain = nameKey(requestedName) === "captain";
      const recipientMember = toCaptain ? undefined : Object.values(target.members).find((member) => nameKey(member.name) === nameKey(requestedName));
      if (!toCaptain && recipientMember === undefined) {
        return { ok: false, error: "cellwork_send: " + JSON.stringify(requestedName) + " is neither `captain` nor a member of cell " + targetCellId + " (members: " + Object.keys(target.members).join(", ") + ")" };
      }
      const to = toCaptain ? "captain" : String(recipientMember?.name ?? requestedName);
      if (!crossCell && nameKey(to) === nameKey(caller.member))
        return { ok: false, error: "cellwork_send: a seat cannot message itself" };
      const now = new Date;
      let wakeSent = false;
      let wakeReason;
      if (crossCell) {
        wakeReason = "cross-cell mail is DURABLE ONLY — this cell holds no Lead authority over " + targetCellId + ", so its captain wakes the row (it shows on that cell's `cellwork_supervise`)";
      } else if (toCaptain) {
        wakeReason = "the Lead has no executor handle in this composition; the captain reads it on `cellwork_inbox`";
      } else if (caller.sessionId !== caller.cell.captainSessionId) {
        wakeReason = "only the captain holds the Lead authority the executor needs; a member-to-member message is durable and read on `cellwork_inbox`";
      } else if (String(recipientMember?.executorRef ?? "") === "") {
        wakeReason = "the recipient has no executor handle (never raised)";
      } else {
        const send = sendThroughExecutor(dsh.teamExecutor(), exec.agent);
        if (send === undefined)
          wakeReason = "this composition exposes no team executor";
        else {
          try {
            await send(String(recipientMember?.executorRef ?? ""), "[mpd-cellwork] mail from " + caller.member + ": " + subject + `

` + body + `

(full row: cell ` + caller.cell.cellId + ")");
            wakeSent = true;
          } catch (error) {
            wakeReason = "the wake-up failed: " + (error instanceof Error ? error.message : String(error));
          }
        }
      }
      const taken = new Set(readCellMail(caller.workspace, targetCellId).map((record) => record.id));
      let id = mailId(now, mailSequence += 1);
      while (taken.has(id))
        id = mailId(now, mailSequence += 1);
      const appended = appendCellMail(caller.workspace, targetCellId, { t: "send", id, cellId: targetCellId, from: caller.member, to, subject, body, at: now.toISOString(), wakeSent, ...crossCell ? { fromCell: caller.cell.cellId } : {}, ...wakeReason === undefined ? {} : { wakeReason } });
      if (!appended)
        return { ok: false, error: "cellwork_send: the message row could not be written — no message was sent (mail is durable first)" };
      appendJournal(caller.workspace, caller.cell.cellId, { event: "mail", cell: "cell:" + caller.cell.cellId, id, from: caller.member, to, ...crossCell ? { toCell: targetCellId } : {}, subject, wakeSent }, now);
      return { ok: true, id, to, wakeSent, ...crossCell ? { crossCell: targetCellId, fromCell: caller.cell.cellId } : {}, ...wakeReason === undefined ? {} : { wakeReason } };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_inbox",
    description: "Any cell seat: read and ACKNOWLEDGE the unread cell mail addressed to this seat (its member name, or `captain`). The rows are durable; reading them appends `read` records, so a second call does not return them again.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          seat: { type: "string" },
          messages: { type: "array", items: { type: "object" } },
          acknowledged: { type: "number" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_inbox refused: " + String(result.error ?? "unknown refusal"));
        const messages = Array.isArray(result.messages) ? result.messages : [];
        if (messages.length === 0)
          return render("no unread cell mail for " + String(result.seat ?? "?") + " — if a question is blocked here, ask the captain to check `cellwork_supervise`");
        return render(messages.map((message) => "[" + String(message.from) + "] " + String(message.subject) + `
` + String(message.body)).join(`

---

`));
      }
    },
    execute: async (_args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_inbox: this session belongs to no active cell" };
      const seat = caller.member === "captain" ? "captain" : caller.member;
      const messages = foldCellMail(readCellMail(caller.workspace, caller.cell.cellId));
      const unread = unreadFor(messages, [seat]);
      const now = new Date;
      let acknowledged = 0;
      for (const message of unread) {
        if (appendCellMail(caller.workspace, caller.cell.cellId, { t: "read", id: message.id, by: seat, at: now.toISOString() }))
          acknowledged += 1;
      }
      if (acknowledged > 0)
        appendJournal(caller.workspace, caller.cell.cellId, { event: "mail-read", cell: "cell:" + caller.cell.cellId, seat, ids: unread.slice(0, acknowledged).map((message) => message.id) }, now);
      return { ok: true, seat, messages: unread.map((message) => ({ id: message.id, from: message.from, subject: message.subject, body: message.body, at: message.at })), acknowledged };
    }
  }));
  const onPreStep = (payload, decision) => {
    try {
      const agent = payload?.agent;
      if (agent === undefined || agent === null)
        return;
      const caller = callerContext(dsh, { agent }, { teams });
      if (caller.cell === null || caller.member === "" || caller.member === "captain")
        return;
      const pressure = dsh.contextPressure(agent);
      const plan = planCheckpoint(caller.cell, caller.member, pressure, config, typeof payload.turn === "number" ? payload.turn : null);
      if (!plan.inject)
        return;
      const now = new Date;
      const next = applyCheckpoint(caller.cell, plan, String(caller.cell.members[caller.member]?.sessionId ?? caller.sessionId), now);
      transition(caller.workspace, next, { event: "checkpoint", member: caller.member, usedTokens: plan.usedTokens, windowTokens: plan.windowTokens, turn: plan.turn, reason: plan.reason }, now);
      const message = dsh.userMessage({ text: checkpointDirective(caller.member, plan), source: { kind: "mpd-cellwork", reason: "checkpoint" } });
      return { kind: "enter", messages: [...decision?.messages ?? payload?.messages ?? [], message] };
    } catch (error) {
      deps.warn("[mpd-cellwork] the checkpoint listener failed: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
  };
  const preStepDispose = dsh.onAgentPreStep(onPreStep);
  if (typeof preStepDispose === "function")
    disposers.push(preStepDispose);
  const runBarrier = async (agent) => {
    const caller = callerContext(dsh, { agent }, { teams });
    if (caller.cell === null || caller.member === "")
      return;
    const member = caller.cell.members[caller.member];
    if (member === undefined || !member.handoffReady)
      return;
    const key = caller.cell.cellId + "/" + caller.member;
    if (inFlight.has(key))
      return;
    inFlight.add(key);
    try {
      let handoffText = "";
      try {
        handoffText = readFileSync5(handoffPath(caller.workspace, caller.cell.cellId, caller.member, member.handoffs), "utf8");
      } catch {
        handoffText = "(the handoff document could not be read back; the journal names its path)";
      }
      const result = await promoteAfterHandoff({
        dsh,
        agent,
        memberName: caller.member,
        sessionId: member.sessionId,
        cell: caller.cell,
        config,
        handoffText,
        nextStep: nextStepOf(handoffText),
        injectDirective: (text2) => {
          try {
            dsh.injectAgentMessage(agent, dsh.userMessage({ text: text2, source: { kind: "mpd-cellwork", reason: "promotion" } }));
          } catch (error) {
            deps.warn("[mpd-cellwork] the promotion directive could not be injected: " + (error instanceof Error ? error.message : String(error)));
          }
        },
        sleep: (ms) => new Promise((resolve4) => setTimeout(resolve4, ms))
      });
      const now = new Date;
      const fresh = readCell(caller.workspace, caller.cell.cellId);
      if (!fresh.ok) {
        deps.warn("[mpd-cellwork] the compaction barrier could not re-read " + fresh.path + ": " + fresh.detail);
        return;
      }
      const updated = {
        ...fresh.state.members[caller.member] ?? member,
        mode: result.outcome === "refused" ? "checkpoint" : "subcaptain",
        handoffReady: result.outcome === "refused",
        ...result.newHandle === undefined ? {} : { sessionId: result.newHandle, executorRef: result.newHandle }
      };
      const next = { ...fresh.state, members: { ...fresh.state.members, [caller.member]: updated } };
      transition(caller.workspace, next, compactionJournalEntry(caller.member, result), now);
    } finally {
      inFlight.delete(key);
    }
  };
  const stopDispose = dsh.onEvent("agent/turn-stopping", (payload) => {
    try {
      const agent = typeof payload === "object" && payload !== null ? payload.agent : undefined;
      if (agent === undefined || agent === null)
        return;
      runBarrier(agent).catch((error) => deps.warn("[mpd-cellwork] the compaction barrier failed: " + (error instanceof Error ? error.message : String(error))));
    } catch (error) {
      deps.warn("[mpd-cellwork] the turn-stopping listener failed: " + (error instanceof Error ? error.message : String(error)));
    }
  });
  if (typeof stopDispose === "function")
    disposers.push(stopDispose);
  return disposers;
}

// packages/mpd-cellwork-plugin/src/index.ts
var name = "mpd-cellwork";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS);
function configValue(ctx, dottedKey) {
  const service = ctx.get?.("mpdConfig", false);
  if (service === undefined || typeof service.get !== "function")
    return;
  try {
    return service.get(dottedKey);
  } catch {
    return;
  }
}
function teamsService(ctx) {
  const service = ctx.get?.("mpdTeams", false);
  if (typeof service !== "object" || service === null)
    return;
  return service;
}
function personaOf(ctx, label) {
  const service = ctx.get?.("mpdRoles", false);
  if (service === undefined || typeof service.get !== "function")
    return null;
  try {
    const role = service.get(label);
    return role !== null && role !== undefined && typeof role.persona === "string" && role.persona.trim() !== "" ? role.persona : null;
  } catch {
    return null;
  }
}
function teamRecordOf(ctx, workspace, teamId) {
  if (teamId === "" || workspace === "")
    return;
  const record = teamsService(ctx)?.get?.(workspace, teamId);
  return typeof record === "object" && record !== null ? record : undefined;
}
function teamCounts(record) {
  if (record === undefined)
    return { members: 0, tasks: 0 };
  return {
    members: Array.isArray(record.members) ? record.members.length : 0,
    tasks: Array.isArray(record.tasks) ? record.tasks.length : 0
  };
}
function liveTasks(record) {
  if (record === undefined || !Array.isArray(record.tasks))
    return [];
  const live = record.tasks.filter((task) => typeof task === "object" && task !== null);
  return live.filter((task) => task.status === "claimed" || task.status === "in_progress").map((task) => String(task.id ?? "?") + " (" + String(task.subject ?? "") + ")");
}
function liveSubcellIds(workspace, ids) {
  const live = [];
  for (const id of ids) {
    const child = readCell(workspace, id);
    if (child.ok && child.state.phase !== "stopped")
      live.push(id);
  }
  return live;
}
function refusalText3(failure) {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first";
}
function render2(value) {
  const result = typeof value === "object" && value !== null ? value : {};
  if (result.ok === false)
    return textBlock("cellwork refused: " + String(result.error ?? "unknown refusal") + (typeof result.path === "string" ? `
state: ` + result.path : ""));
  if ("alreadyStarted" in result) {
    return textBlock("cellwork start " + String(result.cellId) + ": phase " + String(result.phase) + (result.staged === true ? " — team " + String(result.teamId) + ": " + String(result.teamMembers) + " member(s), " + String(result.teamTasks) + " task(s)" : " — no approved team yet") + (result.alreadyStarted === true ? " (already started)" : ""));
  }
  if ("inProgress" in result || "forced" in result) {
    return textBlock("cellwork stopped " + String(result.cellId) + " — archived" + (result.forced === true ? " (forced)" : "") + ", reason: " + String(result.reason ?? ""));
  }
  if ("members" in result) {
    const members = Array.isArray(result.members) ? result.members : [];
    return textBlock("cellwork " + String(result.cellId) + " — phase " + String(result.phase) + (result.archived === true ? " (archived)" : "") + `
  objective: ` + String(result.objective) + `
  captain: ` + String(result.captainSessionId) + (result.seat === null ? "" : " · you: " + String(result.seat.name) + " (" + String(result.seat.mode) + ")") + `
  requirements rev ` + String(result.requirementsRevision) + " · split rev " + String(result.splitRevision ?? "-") + (result.splitStale === true ? " (STALE)" : "") + `
  team: ` + (String(result.teamId) === "" ? "none approved" : String(result.teamId) + " — " + String(result.teamMembers) + " member(s), " + String(result.teamTasks) + " task(s)") + `
  members (` + members.length + "): " + (members.length === 0 ? "-" : members.map((member) => String(member.name) + "[" + String(member.mode) + "]").join(", ")) + `
  checkpoints injected: ` + String(result.checkpoints) + `
  state: ` + String(result.statePath));
  }
  return textBlock(JSON.stringify(value, null, 2));
}
function argString3(args, key) {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}
function apply(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const warn = (line) => {
    dsh.rowLog("mpd-cellwork", line);
  };
  const cfg = resolveCellworkConfig(config, (dottedKey) => configValue(ctx, dottedKey), warn);
  const disposers = [];
  const guard = installCellworkGuard(dsh, {
    seatOf: (exec) => callerContext(dsh, exec, { teams: () => teamsService(ctx) }).seat,
    warn
  });
  if (guard.dispose !== undefined)
    disposers.push(guard.dispose);
  disposers.push(dsh.registerTool({
    name: "cellwork_status",
    description: "Report one cell: phase, objective, captain, requirements/split revisions, members and their modes, injected checkpoints, the live team's member/task counts and the on-disk paths. Defaults to the workspace's ACTIVE cell; pass `cellId` to read another. Never mutates anything.",
    parameters: {
      type: "object",
      properties: { cellId: { type: "string", description: "The cell to report; omitted reads the workspace's active cell." } },
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          archived: { type: "boolean" },
          objective: { type: "string" },
          captainSessionId: { type: "string" },
          depth: { type: "number" },
          parentCellId: { oneOf: [{ type: "string" }, { type: "null" }] },
          teamId: { type: "string" },
          requirementsRevision: { type: "number" },
          splitRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          splitStale: { type: "boolean" },
          startedAt: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          checkpoints: { type: "number" },
          seat: { oneOf: [{ type: "object" }, { type: "null" }] },
          teamMembers: { type: "number" },
          teamTasks: { type: "number" },
          cellDir: { type: "string" },
          statePath: { type: "string" },
          journalPath: { type: "string" },
          requirementsPath: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => render2(value)
    },
    execute: (args, exec) => {
      const caller = callerContext(dsh, exec, { teams: () => teamsService(ctx) });
      if (caller.workspace === "")
        return { ok: false, error: "cellwork_status: the workspace root could not be resolved for this call" };
      const requested = argString3(readArgs3(args), "cellId");
      let state;
      if (requested === "") {
        if (caller.refusal !== null)
          return { ok: false, error: refusalText3(caller.refusal), path: caller.refusal.path };
        if (caller.cell === null)
          return { ok: false, error: "cellwork_status: no cell is active in this workspace — start one with `/cellwork <objective>`" };
        state = caller.cell;
      } else {
        const single = readCell(caller.workspace, requested);
        if (!single.ok)
          return { ok: false, error: refusalText3(single), path: single.path };
        state = single.state;
      }
      const counts = teamCounts(teamRecordOf(ctx, caller.workspace, state.teamId));
      return {
        ok: true,
        cellId: state.cellId,
        phase: state.phase,
        archived: state.archived,
        objective: state.objective,
        captainSessionId: state.captainSessionId,
        depth: state.depth,
        parentCellId: state.parentCellId,
        teamId: state.teamId,
        requirementsRevision: state.requirementsRevision,
        splitRevision: state.splitRevision,
        splitStale: state.splitStale,
        startedAt: state.startedAt,
        members: Object.values(state.members).map((member) => ({ name: member.name, role: member.role, mode: member.mode, sessionId: member.sessionId })),
        checkpoints: state.checkpoints.length,
        seat: caller.seat === undefined ? null : { name: caller.seat.name, mode: caller.seat.mode },
        teamMembers: counts.members,
        teamTasks: counts.tasks,
        cellDir: cellDir(caller.workspace, state.cellId),
        statePath: statePath(caller.workspace, state.cellId),
        journalPath: journalPath(caller.workspace, state.cellId),
        requirementsPath: requirementsPath(caller.workspace, state.cellId)
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_start",
    description: "Open the REQUIREMENTS phase of the ACTIVE cell (captain only): validates the cell and the caller, stamps `startedAt`, writes the journal entry and reports the live team. A cell is created by `/cellwork` ALONE — this tool never starts the mode and never creates a cell. Idempotent: a second call reports the first one's result.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          startedAt: { type: "string" },
          teamId: { type: "string" },
          staged: { type: "boolean" },
          teamMembers: { type: "number" },
          teamTasks: { type: "number" },
          alreadyStarted: { type: "boolean" },
          statePath: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => render2(value)
    },
    execute: async (_args, exec) => {
      const caller = callerContext(dsh, exec, { teams: () => teamsService(ctx) });
      if (caller.refusal !== null)
        return { ok: false, error: refusalText3(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.cell === undefined)
        return { ok: false, error: "cellwork_start: no cell is active in this workspace — a cell is created by `/cellwork <objective>` and by nothing else" };
      const state = caller.cell;
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId) {
        return { ok: false, error: "cellwork_start is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" };
      }
      if (state.phase === "stopped")
        return { ok: false, error: "cellwork_start: " + state.cellId + " is stopped and archived — start a new cell with `/cellwork <objective>`" };
      const now = new Date;
      const alreadyStarted = state.startedAt !== "";
      const next = alreadyStarted ? state : { ...state, startedAt: now.toISOString(), phase: state.phase === "requirements" ? "requirements" : state.phase };
      if (!alreadyStarted) {
        recordTransition(caller.workspace, next, { event: "start", phase: next.phase, captainSessionId: state.captainSessionId }, now);
      }
      let stagedState = next;
      if (next.teamId === "") {
        const staged = await stagePlanningTeam({
          dsh,
          workspace: caller.workspace,
          cell: next,
          captainAgent: exec.agent,
          personaFor: (label) => personaOf(ctx, label),
          teams: () => teamsService(ctx),
          config: cfg,
          now
        });
        if (!staged.ok) {
          const partialState = { ...next, teamId: staged.teamId ?? next.teamId, members: { ...next.members, ...staged.members ?? {} } };
          recordTransition(caller.workspace, partialState, { event: "planning-team-partial", teamId: partialState.teamId, planName: staged.planName ?? "", members: Object.keys(staged.members ?? {}), error: staged.error ?? "" }, now);
          return { ok: false, error: (staged.error ?? "cellwork_start: staging the planning team failed") + " — the partial plan slot is recorded on this cell; call `cellwork_start` again and it RESUMES that slot" };
        }
        stagedState = { ...next, teamId: staged.teamId ?? next.teamId, members: { ...next.members, ...staged.members ?? {} } };
        recordTransition(caller.workspace, stagedState, { event: "planning-team-staged", teamId: stagedState.teamId, members: Object.keys(staged.members ?? {}), tasks: staged.tasks ?? {} }, now);
      }
      const counts = teamCounts(teamRecordOf(ctx, caller.workspace, stagedState.teamId));
      return {
        ok: true,
        cellId: stagedState.cellId,
        phase: stagedState.phase,
        startedAt: stagedState.startedAt,
        teamId: stagedState.teamId,
        staged: stagedState.teamId !== "",
        teamMembers: counts.members,
        teamTasks: counts.tasks,
        alreadyStarted,
        statePath: statePath(caller.workspace, stagedState.cellId)
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_stop",
    description: "End the mode (captain only): ARCHIVES the cell (no deletion), clears the guard and gives every tool back. REFUSES while a cell task is claimed or in_progress unless `force:true`, and a forced stop is journaled as such.",
    parameters: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "Stop even with live tasks; the exception is recorded in the journal." },
        reason: { type: "string", description: "One line answering why the cell ends." },
        cellId: { type: "string", description: "The cell to stop; omitted uses the workspace's active cell." }
      },
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          archived: { type: "boolean" },
          forced: { type: "boolean" },
          reason: { type: "string" },
          inProgress: { type: "array", items: { type: "string" } },
          statePath: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => render2(value)
    },
    execute: (args, exec) => {
      const input = readArgs3(args);
      const caller = callerContext(dsh, exec, { teams: () => teamsService(ctx) });
      const workspace = caller.workspace;
      if (workspace === "")
        return { ok: false, error: "cellwork_stop: the workspace root could not be resolved for this call" };
      const requested = argString3(input, "cellId");
      let state;
      if (requested === "") {
        if (caller.refusal !== null)
          return { ok: false, error: refusalText3(caller.refusal), path: caller.refusal.path };
        if (caller.cell === null)
          return { ok: false, error: "cellwork_stop: no cell is active in this workspace" };
        state = caller.cell;
      } else {
        const single = readCell(workspace, requested);
        if (!single.ok)
          return { ok: false, error: refusalText3(single), path: single.path };
        state = single.state;
      }
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId) {
        return { ok: false, error: "cellwork_stop is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" };
      }
      if (state.phase === "stopped") {
        return { ok: true, cellId: state.cellId, archived: true, forced: false, reason: state.stopReason === "" ? "already stopped" : state.stopReason, inProgress: [], statePath: statePath(workspace, state.cellId) };
      }
      const liveChildren = liveSubcellIds(workspace, state.subcellIds);
      if (liveChildren.length > 0 && input.force !== true) {
        return { ok: false, error: "cellwork_stop refused: " + String(liveChildren.length) + " sub-cell(s) of " + state.cellId + " are still active (" + liveChildren.join(", ") + '). Stop each one first, by id and as ITS captain (`cellwork_stop {cellId: "..."}`), or pass force:true with a reason — a forced stop is journaled' };
      }
      const inProgress = liveTasks(teamRecordOf(ctx, workspace, state.teamId));
      const forced = input.force === true;
      if (inProgress.length > 0 && !forced) {
        return { ok: false, error: "cellwork_stop refused: " + String(inProgress.length) + " task(s) are still being worked (" + inProgress.join("; ") + "). Let them finish, fail them on the board, or pass force:true with a reason — a forced stop is journaled" };
      }
      const now = new Date;
      const reason = argString3(input, "reason") === "" ? forced ? "forced stop" : "stopped by the captain" : argString3(input, "reason");
      const stopped = { ...state, phase: "stopped", archived: true, stopReason: reason };
      recordTransition(workspace, stopped, { event: "stop", reason, forced, inProgress }, now);
      return { ok: true, cellId: state.cellId, archived: true, forced, reason, inProgress, statePath: statePath(workspace, state.cellId) };
    }
  }));
  const runCellworkCommand = (invocation) => {
    const objective = String(invocation?.rawInput ?? "").trim();
    if (objective === "")
      return { kind: "error", text: CELLWORK_USAGE };
    const captainSessionId = sessionIdOf(invocation?.agent);
    if (captainSessionId === "")
      return { kind: "error", text: "cellwork refused: the invoking agent carries no session id, so no captain can be recorded — nothing was written" };
    const workspace = dsh.workspaceRoot({ agent: invocation?.agent });
    const active = readActiveCell(workspace);
    if (!active.ok)
      return { kind: "error", text: "cellwork refused: " + refusalText3(active) };
    if (active.cell !== null) {
      return {
        kind: "error",
        text: "cellwork refused: cell " + active.cell.state.cellId + " is still active in this workspace (phase " + active.cell.state.phase + ") — one cell at a time, and a second one would fight the first for the same team board. Read it with `cellwork_status`, finish it, or end it with `cellwork_stop` first."
      };
    }
    const now = new Date;
    const created = newCellState({ cellId: freeCellId(workspace, now), objective, captainSessionId, now });
    writeCell(workspace, created);
    recordTransition(workspace, created, { event: "start", phase: created.phase, objective, captainSessionId: created.captainSessionId }, now);
    const directive = dsh.userMessage({ text: activationDirective({ state: created, workspace }), source: { kind: "mpd-cellwork", reason: "activation-directive" } });
    if (invocation?.submit?.(directive) !== true) {
      recordTransition(workspace, { ...created, phase: "stopped", archived: true, stopReason: "no-live-turn-surface" }, { event: "stop", reason: "no-live-turn-surface", forced: false }, now);
      return { kind: "error", text: "cellwork could not start: no live agent turn surface to submit the activation directive, so cell " + created.cellId + " was archived immediately and no mode is active" };
    }
    return { kind: "success", text: "cellwork active: " + created.cellId + " — the activation directive was submitted as this agent's next turn" };
  };
  disposers.push(...installCellworkFlow({ dsh, ctx, config: cfg, warn }));
  disposers.push(...installCellworkProtocol({ dsh, ctx, config: cfg, warn }));
  const command = { name: "cellwork", description: "Start cell-work for an objective: a dedicated planner interview, a measured task split, and a team that dispatches, hands off, compacts and promotes (captain dispatches only).", input: { hint: "objective" }, handler: runCellworkCommand };
  disposers.push(dsh.registerCommand(command));
  if (typeof ctx.effect === "function")
    ctx.effect(() => () => {
      for (const dispose of disposers)
        dispose();
    }, "mpd-cellwork.registrations");
  warn("[mpd-cellwork] mounted: guard=" + (guard.installed ? "on" : "OFF(" + String(guard.reason ?? "?") + ")") + " depthMax=" + String(cfg.depthMax) + " checkpointRatio=" + String(cfg.checkpointRatio) + " windowFraction=" + String(cfg.windowFraction) + " windowOverride=" + String(cfg.windowOverride ?? "none"));
}
function readArgs3(args) {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
}
export {
  apply,
  inject,
  name
};
