// packages/mpd-bundle-plugin/src/model-config-web.ts
var MODEL_CONFIG_PATH = "/plugins/mpd/model-config";
var ROSTER_MEMBERS = [
  "Architect",
  "Planner",
  "Reviewer",
  "Lead",
  "Senior Engineer",
  "Researcher",
  "Explorer",
  "Plan Reviewer",
  "Deep Worker",
  "Junior Engineer",
  "Vision Analyst"
];
function buildModelConfigBody(config) {
  if (config === undefined || config === null) {
    return { ok: false, reason: "the mpdConfig service is not composed in this profile" };
  }
  if (typeof config.agentRouteResolutionOf !== "function") {
    return { ok: false, reason: "the mpdConfig service exposes no per-agent route resolver (agentRouteResolutionOf)" };
  }
  try {
    const agents = {};
    for (const member of ROSTER_MEMBERS)
      agents[member] = config.agentRouteResolutionOf(member);
    return {
      ok: true,
      agents,
      modelchain: typeof config.get === "function" ? config.get("modelchain") ?? {} : {}
    };
  } catch (error) {
    return { ok: false, reason: `the config read threw (${String(error?.message ?? error)})` };
  }
}
function registerModelConfigRoute(webServer, deps) {
  let registered = false;
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: MODEL_CONFIG_PATH,
      handler: (_req, res) => {
        const out = res;
        const body = buildModelConfigBody(deps.config());
        out.writeHead(body.ok ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        out.end(JSON.stringify(body));
      }
    }), "mpd-bundle: model-config web route");
    registered = true;
  } catch {}
  return registered;
}

// packages/mpd-bundle-plugin/src/watchdog-web.ts
import { existsSync, mkdirSync as mkdirSync2, readFileSync, readdirSync, renameSync as renameSync2, writeFileSync } from "node:fs";
import { basename, dirname, join as join2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2, sep as sep2 } from "node:path";

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
function normalizeSpawnResult(settled) {
  const value = settled ?? {};
  return {
    output: textOfOutput(value.output),
    structured: value.structured,
    stopReason: typeof value.stopReason === "string" ? value.stopReason : null
  };
}
function activationHandleOf(raw, subagents, parent) {
  const id = typeof raw?.childId === "string" ? raw.childId : typeof raw?.id === "string" ? raw.id : "";
  let disposed = false;
  let interrupted = false;
  const disposeOnce = async () => {
    if (disposed)
      return;
    disposed = true;
    await releaseActivation(raw);
  };
  const result = Promise.resolve(raw?.result).then(async (settled) => {
    await disposeOnce();
    return normalizeSpawnResult(settled);
  }, async (error) => {
    await disposeOnce();
    throw error;
  });
  return {
    id,
    result,
    interrupt() {
      if (interrupted)
        return;
      interrupted = true;
      const abortRaw = () => {
        try {
          if (typeof raw?.abort === "function")
            raw.abort();
        } catch {}
      };
      try {
        if (id !== "" && typeof subagents?.interrupt === "function") {
          const outcome = subagents.interrupt.call(subagents, id, { kind: "ancestor", agent: parent });
          if (outcome !== null && typeof outcome === "object" && typeof outcome.then === "function") {
            Promise.resolve(outcome).catch(abortRaw);
          }
        } else {
          abortRaw();
        }
      } catch {
        abortRaw();
      }
    }
  };
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
function questionItemOf(raw) {
  if (raw === null || typeof raw !== "object")
    return;
  const fields = raw;
  if (typeof fields.id !== "string" || typeof fields.question !== "string")
    return;
  const options = questionOptionsOf(fields.options);
  return {
    id: fields.id,
    question: fields.question,
    ...typeof fields.header === "string" ? { header: fields.header } : {},
    ...options === undefined ? {} : { options },
    ...typeof fields.multiSelect === "boolean" ? { multiSelect: fields.multiSelect } : {}
  };
}
function questionOptionsOf(raw) {
  if (!Array.isArray(raw))
    return;
  const options = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object")
      continue;
    const fields = entry;
    if (typeof fields.label !== "string")
      continue;
    options.push({
      label: fields.label,
      ...typeof fields.description === "string" ? { description: fields.description } : {}
    });
  }
  return options;
}
function questionItemsOf(raw) {
  if (!Array.isArray(raw))
    return [];
  const items = [];
  for (const entry of raw) {
    const item = questionItemOf(entry);
    if (item !== undefined)
      items.push(item);
  }
  return items;
}
function questionAnswersOf(raw) {
  if (raw === null || typeof raw !== "object")
    return [];
  const items = raw.answers;
  if (!Array.isArray(items))
    return [];
  const answers = [];
  for (const entry of items) {
    if (entry === null || typeof entry !== "object")
      continue;
    const fields = entry;
    if (typeof fields.id !== "string")
      continue;
    const selected = Array.isArray(fields.selected) ? fields.selected.filter((label) => typeof label === "string") : [];
    answers.push({
      id: fields.id,
      selected,
      ...typeof fields.custom === "string" ? { custom: fields.custom } : {}
    });
  }
  return answers;
}
function errorCodeOf(error) {
  if (error === null || typeof error !== "object")
    return;
  const code = error.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}
function errorTextOf(error) {
  if (error !== null && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message.length > 0)
      return message;
  }
  return String(error);
}
function abortSignalOf(raw) {
  return raw !== null && typeof raw === "object" && typeof raw.aborted === "boolean" ? raw : undefined;
}
function requestSessionIdOf(raw) {
  if (raw === null || typeof raw !== "object")
    return;
  const id = raw.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
function userQuestionRequestOf(raw) {
  const fields = raw !== null && typeof raw === "object" ? raw : undefined;
  const sessionId = requestSessionIdOf(fields?.agent);
  const signal = abortSignalOf(fields?.signal);
  return {
    questions: questionItemsOf(fields?.questions),
    ...sessionId === undefined ? {} : { sessionId },
    ...signal === undefined ? {} : { signal }
  };
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
  let scopedDshGo;
  const dshGoService = () => scopedDshGo ?? service("dshGo");
  const dshGoBoundCallbacks = new Set;
  const notifyDshGoBound = () => {
    for (const callback of [...dshGoBoundCallbacks]) {
      try {
        callback("dshGo");
      } catch {}
    }
  };
  const bindDshGoBridge = () => {
    if (typeof ctx?.inject !== "function")
      return;
    try {
      ctx.inject(["dshGo"], (scoped) => {
        let bound;
        try {
          bound = scoped?.dshGo;
        } catch {}
        if (bound === undefined || bound === null) {
          try {
            bound = typeof scoped?.get === "function" ? scoped.get("dshGo", false) : undefined;
          } catch {}
        }
        if (bound === undefined || bound === null)
          return;
        scopedDshGo = bound;
        notifyDshGoBound();
        return () => {
          if (scopedDshGo === bound)
            scopedDshGo = undefined;
        };
      });
    } catch {}
  };
  bindDshGoBridge();
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
  function liveAgentExact(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agents = service("agents");
    if (agents === undefined || agents === null || typeof agents.get !== "function")
      return;
    try {
      const found = agents.get(id);
      return found === undefined || found === null ? undefined : found;
    } catch {
      return;
    }
  }
  const engineCache = new WeakMap;
  function presetEngineOf(handle) {
    const presets = service("agentPresets");
    if (presets === undefined || presets === null || typeof presets.serviceFor !== "function")
      return;
    try {
      const engine = presets.serviceFor(handle, "compaction");
      return engine === undefined || engine === null ? undefined : engine;
    } catch {
      return;
    }
  }
  function engineOfLiveHandle(agent) {
    if (agent === undefined || agent === null || typeof agent !== "object")
      return;
    const handle = agent;
    const cached = engineCache.get(handle);
    if (cached !== undefined)
      return cached;
    const isolated = presetEngineOf(handle);
    if (isolated !== undefined) {
      engineCache.set(handle, isolated);
      return isolated;
    }
    const scoped = handle.ctx;
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
    engineCache.set(handle, engine);
    return engine;
  }
  function compactionEngineForAgent(agentId) {
    const id = String(agentId ?? "");
    if (id === "")
      return;
    const agent = liveAgent(id);
    if (agent === undefined || agent === null)
      return;
    return engineOfLiveHandle(agent);
  }
  function compactionEngineForLiveAgent(agent) {
    return engineOfLiveHandle(agent);
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
  function warnDshGo(detail) {
    try {
      rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: dshGo degraded — " + detail);
    } catch {}
  }
  function callableMember(target, member) {
    if (typeof target !== "object" || target === null)
      return;
    const value = target[member];
    return typeof value === "function" ? value.bind(target) : undefined;
  }
  function capsPropertyOf(bridge) {
    if (typeof bridge !== "object" || bridge === null)
      return;
    const fields = bridge;
    return fields.caps !== undefined ? fields.caps : fields.capabilities;
  }
  function dshGoCapsOf(raw) {
    if (typeof raw !== "object" || raw === null)
      return null;
    const source = raw;
    const caps = {};
    if (typeof source.app === "string")
      caps.app = source.app;
    if (typeof source.locale === "string")
      caps.locale = source.locale;
    if (Array.isArray(source.components)) {
      const components = source.components.filter((name) => typeof name === "string");
      if (components.length > 0)
        caps.components = components;
    }
    if (Array.isArray(source.surfaces)) {
      const surfaces = source.surfaces.filter((name) => typeof name === "string");
      if (surfaces.length > 0)
        caps.surfaces = surfaces;
    }
    return caps;
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
  function toolRegistrySpeaksBatch(registry) {
    const candidate = registry;
    return typeof candidate?.executable === "function" || typeof candidate?.resolve === "function";
  }
  async function executeToolCall(registry, input) {
    const rawArguments = input.arguments === undefined ? "{}" : typeof input.arguments === "string" ? input.arguments : JSON.stringify(input.arguments);
    const common = {
      ...input.agent === undefined ? {} : { agent: input.agent }
    };
    if (!toolRegistrySpeaksBatch(registry)) {
      return await registry.execute({
        name: input.name,
        arguments: input.arguments ?? {},
        callId: input.callId,
        ...input.signal === undefined ? {} : { signal: input.signal },
        ...common
      });
    }
    const batch = await registry.execute({
      calls: [{ type: "tool-call", id: input.callId, name: input.name, arguments: rawArguments }],
      signal: input.signal ?? new AbortController().signal,
      ...common
    });
    return batch?.results?.[0]?.result;
  }
  async function executeToolForAgent(input) {
    const callId = input.callId ?? "mpd-" + Math.random().toString(36).slice(2, 10);
    const signal = input.signal ?? timeoutSignal(input.timeoutMs ?? defaultTimeoutMs);
    const scoped = input.agent === undefined ? undefined : scopedToolRegistry(input.agent);
    if (scoped !== undefined) {
      try {
        const raw = await executeToolCall(scoped, {
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
      const questionService = service("userQuestions");
      const dshGoBridge = dshGoService();
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
        goalTools: GOAL_TOOL_NAMES.every((goalToolName) => toolReachable(goalToolName)),
        askUser: questionService !== undefined && questionService !== null,
        dshGo: dshGoBridge !== undefined && dshGoBridge !== null
      };
    },
    workspaceRoot,
    workspaceRootsAll,
    workspaceRootForSession,
    rowLog,
    liveAgents,
    liveAgent,
    liveAgentExact,
    contextPressure,
    compactionEngineForAgent,
    compactionEngineForLiveAgent,
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
      const tracksDshGo = names.includes("dshGo");
      if (tracksDshGo)
        dshGoBoundCallbacks.add(callback);
      const release = () => {
        if (tracksDshGo)
          dshGoBoundCallbacks.delete(callback);
      };
      if (typeof ctx?.on !== "function")
        return release;
      const off = ctx.on("internal/service", (name) => {
        try {
          if (typeof name === "string" && names.includes(name))
            callback(name);
        } catch {}
      });
      const offBus = typeof off === "function" ? off : () => {};
      return () => {
        release();
        offBus();
      };
    },
    async askUserQuestion(request) {
      const questionService = service("userQuestions");
      if (questionService === undefined || questionService === null || typeof questionService.ask !== "function") {
        throw new Error("ask_user_question failed: no user-questions service");
      }
      let raw;
      try {
        raw = await questionService.ask({
          questions: request.questions,
          ...request.signal === undefined ? {} : { signal: request.signal }
        });
      } catch (error) {
        const code = errorCodeOf(error);
        const failure = Object.assign(new Error("ask_user_question failed: " + errorTextOf(error)), code === undefined ? {} : { code });
        throw failure;
      }
      return questionAnswersOf(raw);
    },
    onUserQuestionRequest(handler, label) {
      const off = onEvent("user-questions/request", (...args) => {
        const request = userQuestionRequestOf(args[0]);
        const next = args[args.length - 1];
        const nextEnvelope = async () => {
          if (typeof next !== "function") {
            throw new Error("ask_user_question failed: the user-questions waterfall supplied no next()");
          }
          return await next();
        };
        return handler(request, nextEnvelope);
      });
      if (off === undefined) {
        try {
          rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: onUserQuestionRequest(${label ?? "anonymous"}) degraded — the harness event bus is unavailable (ctx.on), so no question will be routed to this answerer`);
        } catch {}
        return noop;
      }
      return off;
    },
    dshGoPresent() {
      const bridge = dshGoService();
      return bridge !== undefined && bridge !== null;
    },
    dshGoPanel(id, spec) {
      const bridge = dshGoService();
      if (bridge === undefined || bridge === null || typeof bridge.panel !== "function") {
        warnDshGo(`panel "${id}" not published — the bridge service is absent or exposes no panel()`);
        return false;
      }
      try {
        bridge.panel(id, spec);
        return true;
      } catch (error) {
        warnDshGo(`panel "${id}" not published — the bridge threw: ${errorTextOf(error)}`);
        return false;
      }
    },
    dshGoRefresh(id) {
      const bridge = dshGoService();
      if (bridge === undefined || bridge === null || typeof bridge.refresh !== "function")
        return;
      try {
        bridge.refresh(id);
      } catch {}
    },
    dshGoOn(id, handler) {
      const on = callableMember(dshGoService(), "on");
      if (on === undefined) {
        warnDshGo(`action "${id}" not registered — the bridge service is absent or exposes no on()`);
        return false;
      }
      try {
        on(id, handler);
        return true;
      } catch (error) {
        warnDshGo(`action "${id}" not registered — the bridge threw: ${errorTextOf(error)}`);
        return false;
      }
    },
    dshGoStrip(id, dataFn) {
      const strip = callableMember(dshGoService(), "strip");
      if (strip === undefined) {
        warnDshGo(`strip "${id}" not published — the bridge service is absent or exposes no strip()`);
        return false;
      }
      try {
        strip(id, dataFn);
        return true;
      } catch (error) {
        warnDshGo(`strip "${id}" not published — the bridge threw: ${errorTextOf(error)}`);
        return false;
      }
    },
    dshGoCaps() {
      const bridge = dshGoService();
      if (bridge === undefined || bridge === null) {
        warnDshGo("capabilities are unavailable — the bridge service is absent");
        return null;
      }
      let raw;
      try {
        const read = callableMember(bridge, "caps");
        raw = read !== undefined ? read() : capsPropertyOf(bridge);
      } catch (error) {
        warnDshGo(`capabilities are unavailable — the bridge threw: ${errorTextOf(error)}`);
        return null;
      }
      const caps = dshGoCapsOf(raw);
      if (caps === null) {
        warnDshGo("capabilities are unavailable — the bridge exposes neither caps() nor a caps object");
        return null;
      }
      return caps;
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
        const raw = await executeToolCall(tools, {
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
    async spawnAgentAsync(spec) {
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
        return activationHandleOf(activation, subagents, spec.parent);
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
      return activationHandleOf(run, subagents, spec.parent);
    },
    async spawnAgent(spec) {
      return (await adapter.spawnAgentAsync(spec)).result;
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

// packages/mpd-bundle-plugin/src/watchdog-web.ts
var WATCHDOG_STATE_PATH = "/plugins/mpd-team-watchdog/state";
var WATCHDOG_ACK_PATH = "/plugins/mpd-team-watchdog/ack";
var WATCHDOG_WEB_READER = "web-panel";
var DEFAULT_TEAM_STATE_DIR = join2(".mpd", "team");
var MAX_ACTIVITY_RECORDS = 20;
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return;
  }
}
function watchdogDir(workspace, stateDir) {
  return join2(workspace, stateDir, "watchdog");
}
function readHolds(workspace, stateDir) {
  const dir = join2(watchdogDir(workspace, stateDir), "hold");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const holds = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json"))
      continue;
    const parsed = readJson(join2(dir, name));
    if (parsed !== undefined && typeof parsed.id === "string" && typeof parsed.teamId === "string")
      holds.push(parsed);
  }
  return holds;
}
function readIncidents(workspace, stateDir) {
  let text;
  try {
    text = readFileSync(join2(watchdogDir(workspace, stateDir), "incidents.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const raw of text.split(`
`)) {
    const line = raw.trim();
    if (line === "")
      continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.at === "number")
        out.push(parsed);
    } catch {}
  }
  return out;
}
function readWatermarks(workspace, stateDir) {
  const parsed = readJson(join2(watchdogDir(workspace, stateDir), "read-watermark.json"));
  const out = {};
  if (parsed === undefined)
    return out;
  for (const [reader, value] of Object.entries(parsed))
    if (typeof value === "number")
      out[reader] = value;
  return out;
}
function readScenePointer(workspace, stateDir, teamId) {
  const path = join2(watchdogDir(workspace, stateDir), "scene", teamId, "latest.json");
  return existsSync(path) ? path : null;
}
function describeCause(incident) {
  const kind = incident.cause !== null && typeof incident.cause === "object" ? String(incident.cause.kind) : "unknown";
  const ms = incident.cause !== null && typeof incident.cause === "object" ? incident.cause.ms : undefined;
  return typeof ms === "number" ? `${kind} for ${ms} ms` : kind;
}
function buildWatchdogState(options) {
  const { roots, stateDir, reader } = options;
  const errors = [];
  let held = [];
  let incidents = [];
  let watermarks = {};
  let home = null;
  for (const root of roots) {
    try {
      const rootHolds = readHolds(root, stateDir);
      const rootIncidents = readIncidents(root, stateDir);
      const rootWatermarks = readWatermarks(root, stateDir);
      if (rootHolds.length > 0 || rootIncidents.length > 0) {
        held = held.concat(rootHolds);
        incidents = incidents.concat(rootIncidents);
        watermarks = { ...rootWatermarks, ...watermarks };
        if (home === null)
          home = root;
      }
    } catch (error) {
      errors.push(`${root}: ${errorMessage(error)}`);
    }
  }
  const watermark = typeof watermarks[reader] === "number" ? watermarks[reader] : 0;
  const unreadIncidents = incidents.filter((incident) => incident.at > watermark).sort((a, b) => b.at - a.at);
  const activity = unreadIncidents.slice(0, MAX_ACTIVITY_RECORDS).map((incident) => ({
    id: incident.id,
    teamId: incident.teamId,
    kind: incident.kind,
    at: incident.at,
    label: incident.kind === "escalate" ? "escalated" : "warned",
    cause: describeCause(incident),
    ms: incident.cause !== null && typeof incident.cause === "object" && typeof incident.cause.ms === "number" ? incident.cause.ms : null,
    taskId: incident.taskId,
    attemptId: incident.attemptId,
    scene: incident.scene,
    hold: incident.hold,
    acknowledgedBy: Array.isArray(incident.acknowledgedBy) ? incident.acknowledgedBy : [],
    ackRequired: true,
    workspace: home ?? roots[0] ?? ""
  }));
  const newestHold = [...held].sort((a, b) => b.since - a.since)[0];
  const newestIncident = unreadIncidents[0];
  let banner = null;
  if (newestIncident !== undefined) {
    banner = {
      kind: newestIncident.kind === "escalate" ? "held" : "warned",
      teamId: newestIncident.teamId,
      holdId: newestHold !== undefined && newestHold.teamId === newestIncident.teamId ? newestHold.id : null,
      incidentId: newestIncident.id,
      cause: describeCause(newestIncident),
      since: newestIncident.at,
      taskId: newestIncident.taskId,
      attemptId: newestIncident.attemptId,
      scene: newestIncident.scene,
      workspace: home ?? roots[0] ?? ""
    };
  } else if (newestHold !== undefined) {
    banner = {
      kind: "held",
      teamId: newestHold.teamId,
      holdId: newestHold.id,
      incidentId: null,
      cause: newestHold.cause,
      since: newestHold.since,
      taskId: newestHold.taskId,
      attemptId: newestHold.attemptId,
      scene: readScenePointer(home ?? roots[0] ?? "", stateDir, newestHold.teamId),
      workspace: home ?? roots[0] ?? ""
    };
  }
  return {
    ok: true,
    reader,
    generatedAt: new Date(options.now === undefined ? Date.now() : options.now()).toISOString(),
    stateDir,
    workspaces: [...roots],
    workspace: home ?? roots[0] ?? null,
    stuck: held.length > 0 || unreadIncidents.length > 0,
    held,
    banner,
    activity,
    unread: unreadIncidents.map((incident) => incident.id),
    watermarks,
    replay: unreadIncidents.length > 0,
    errors
  };
}
function acknowledge(options) {
  const { workspace, stateDir, reader } = options;
  const path = join2(watchdogDir(workspace, stateDir), "read-watermark.json");
  const current = readWatermarks(workspace, stateDir);
  const before = typeof current[reader] === "number" ? current[reader] : 0;
  const after = Math.max(before, Math.floor(options.upTo));
  try {
    mkdirSync2(dirname(path), { recursive: true });
    const temp = join2(dirname(path), "." + basename(path) + ".tmp-" + String(process.pid));
    writeFileSync(temp, JSON.stringify({ ...current, [reader]: after }, null, 2) + `
`, "utf8");
    renameSync2(temp, path);
    return { ok: true, reader, before, after, path };
  } catch (error) {
    return { ok: false, reader, before, after: before, path, error: errorMessage(error) };
  }
}
function registerWatchdogRoutes(webServer, deps) {
  const json = (res, status, body) => {
    const out = res;
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    out.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    let raw = "";
    const source = req;
    try {
      for await (const chunk of source)
        raw += String(chunk);
    } catch {
      return {};
    }
    if (raw === "")
      return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const readerOf = (req, fallback) => {
    const url = String(req.url ?? "");
    const at = url.indexOf("?");
    if (at < 0)
      return fallback;
    const query = new URLSearchParams(url.slice(at + 1));
    const value = query.get("reader");
    return value !== null && value.trim() !== "" ? value.trim() : fallback;
  };
  let state = false;
  let ack = false;
  try {
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_STATE_PATH,
      handler: (req, res) => {
        try {
          const payload = buildWatchdogState({
            roots: deps.roots(),
            stateDir: deps.stateDir(),
            reader: readerOf(req, WATCHDOG_WEB_READER)
          });
          json(res, 200, payload);
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${errorMessage(error)})` });
        }
      }
    }), "mpd-team-watchdog: web state route");
    state = true;
    deps.effect(() => webServer.register({
      kind: "exact",
      path: WATCHDOG_ACK_PATH,
      handler: async (req, res) => {
        try {
          const body = await readBody(req);
          const reader = typeof body.reader === "string" && body.reader.trim() !== "" ? body.reader.trim() : readerOf(req, WATCHDOG_WEB_READER);
          const roots = deps.roots();
          const stateDir = deps.stateDir();
          const requested = typeof body.incidentTs === "number" ? body.incidentTs : undefined;
          const upTo = requested ?? Math.max(0, ...roots.flatMap((root) => readIncidents(root, stateDir).map((incident) => incident.at)));
          const target = typeof body.workspace === "string" && body.workspace !== "" ? String(body.workspace) : roots[0] ?? "";
          const result = acknowledge({ workspace: target, stateDir, reader, upTo });
          json(res, result.ok ? 200 : 500, result);
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-watchdog: internal error (${errorMessage(error)})` });
        }
      }
    }), "mpd-team-watchdog: web acknowledge route");
    ack = true;
  } catch {}
  return { state, ack };
}

// packages/mpd-bundle-plugin/src/dshgo-panel.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync as readdirSync2, statSync as statSync2 } from "node:fs";
import { basename as basename2, join as join3 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts
var V1_COMPONENTS = Object.freeze([
  "stack",
  "row",
  "text",
  "metric",
  "chart",
  "compare",
  "steps",
  "callout",
  "options",
  "confirm",
  "list",
  "keyValue",
  "progress",
  "table",
  "actions",
  "image"
]);
var V2_ONLY_COMPONENTS = Object.freeze([
  "textField",
  "number",
  "stepper",
  "toggle",
  "slider",
  "select",
  "segmented",
  "chips",
  "date",
  "time",
  "rating",
  "form",
  "tabs",
  "collapsible",
  "accordion",
  "carousel",
  "timeline",
  "grid",
  "badge",
  "tag",
  "avatar",
  "codeBlock",
  "divider",
  "spacer",
  "emptyState",
  "gallery"
]);
var BUDGETS = Object.freeze({
  toolCard: Object.freeze({ bytes: 8192, nodes: 40, depth: 6 }),
  panel: Object.freeze({ bytes: 32768, nodes: 120, depth: 8 }),
  strip: Object.freeze({ bytes: 2048, nodes: 8, depth: 3 })
});
var FALLBACK_COMPONENTS = V2_ONLY_COMPONENTS;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBinding(value) {
  if (!isRecord2(value))
    return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "$" && typeof value.$ === "string";
}
function isNode(value) {
  return isRecord2(value) && typeof value.type === "string";
}
function refuse(builder, detail) {
  throw new RangeError(`dsh-go view: ${builder} ${detail}`);
}
function rejectExtra(builder, props, allowed) {
  for (const key of Object.keys(props)) {
    if (!allowed.includes(key))
      refuse(builder, `does not take "${key}" (accepted: ${allowed.join(" / ")})`);
  }
}
function choice(builder, field, value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    refuse(builder, `needs ${field} to be one of ${allowed.join(" / ")}, got ${JSON.stringify(value)}`);
  }
  return value;
}
function assertList(builder, field, value, max) {
  if (!Array.isArray(value))
    refuse(builder, `needs ${field} to be an array`);
  if (value.length > max)
    refuse(builder, `accepts at most ${max} ${field}, got ${value.length}`);
  return value;
}
var MAX_CHILDREN = 32;
function node(type, props) {
  const out = { type };
  for (const [key, value] of Object.entries(props))
    if (value !== undefined)
      out[key] = value;
  return out;
}
function bind(path) {
  const spelled = String(path);
  return { $: spelled === "data" || spelled.startsWith("data.") || spelled.startsWith("data[") ? spelled : `data.${spelled}` };
}
function style(input) {
  const known = ["card", "padding", "gap", "align", "columns", "dividers", "size", "weight", "color", "maxLines"];
  for (const key of Object.keys(input)) {
    if (!known.includes(key))
      refuse("style", `does not know the key "${key}" (decoration is the app's)`);
  }
  const out = {};
  if (input.card !== undefined)
    out.card = choice("style", "card", input.card, ["plain", "surface", "tinted", "outlined"]);
  if (input.padding !== undefined)
    out.padding = choice("style", "padding", input.padding, ["S", "M", "L"]);
  if (input.gap !== undefined)
    out.gap = choice("style", "gap", input.gap, ["S", "M", "L"]);
  if (input.align !== undefined)
    out.align = choice("style", "align", input.align, ["start", "center", "end"]);
  if (input.dividers !== undefined) {
    if (typeof input.dividers !== "boolean")
      refuse("style", "needs dividers to be a boolean");
    out.dividers = input.dividers;
  }
  if (input.size !== undefined)
    out.size = choice("style", "size", input.size, ["display", "title", "subtitle", "body", "caption", "mono"]);
  if (input.weight !== undefined)
    out.weight = choice("style", "weight", input.weight, ["regular", "medium", "semibold", "bold"]);
  if (input.maxLines !== undefined) {
    if (!Number.isInteger(input.maxLines) || input.maxLines < 1 || input.maxLines > 20) {
      refuse("style", "needs maxLines to be an integer 1–20");
    }
    out.maxLines = input.maxLines;
  }
  if (input.color !== undefined)
    out.color = choice("style", "color", input.color, ["accent"]);
  if (input.columns !== undefined) {
    if (input.columns === "equal")
      out.columns = "equal";
    else if (Array.isArray(input.columns) && input.columns.length > 0 && input.columns.length <= 8 && input.columns.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 12)) {
      out.columns = [...input.columns];
    } else
      refuse("style", 'needs columns to be "equal" or 1–8 integer weights of 1–12');
  }
  return out;
}
function styleOf(input) {
  return input === undefined ? undefined : style(input);
}
function panelView(input) {
  assertList("panelView", "children", input.children, MAX_CHILDREN);
  if (input.children.length === 0)
    refuse("panelView", "needs at least one child");
  const root = styleOf(input.style) ?? { gap: "M" };
  const view = node("stack", { v: 2, accent: "app", style: root, children: input.children });
  if (countPrimaryActions(view) > 1) {
    refuse("panelView", 'allows at most ONE action with style "primary" per view (contract §7.2 rule 8)');
  }
  return view;
}
function countPrimaryActions(view) {
  let primaries = 0;
  for (const found of componentNodes(view)) {
    const items = found.node.items;
    if (found.node.type !== "actions" || !Array.isArray(items))
      continue;
    for (const item of items) {
      if (isRecord2(item) && item.style === "primary")
        primaries += 1;
    }
  }
  return primaries;
}
function* componentNodes(view, depth = 1) {
  if (!isNode(view))
    return;
  yield { node: view, depth };
  for (const child of childrenOf(view))
    yield* componentNodes(child, depth + 1);
}
function childrenOf(node2) {
  const out = [];
  if (Array.isArray(node2.children))
    out.push(...node2.children);
  if (Array.isArray(node2.items)) {
    for (const item of node2.items)
      if (isRecord2(item) && Array.isArray(item.children))
        out.push(...item.children);
  }
  return out;
}
function stack(children, props = {}) {
  assertList("stack", "children", children, MAX_CHILDREN);
  return node("stack", { children, title: props.title, style: styleOf(props.style) });
}
function text(value, props = {}) {
  return node("text", { text: value, tone: props.tone, style: styleOf(props.style) });
}
function metric(props) {
  return node("metric", { label: props.label, value: props.value, tone: props.tone, caption: props.caption, style: styleOf(props.style) });
}
function chart(props) {
  const series = assertList("chart", "series", props.series, 6);
  for (const one of series) {
    if (isBinding(one))
      continue;
    assertList("chart", "series values", one.values, 60);
  }
  return node("chart", { kind: props.kind, categories: props.categories, series, unit: props.unit, caption: props.caption });
}
function keyValue(items, props = {}) {
  assertList("keyValue", "items", items, 24);
  return node("keyValue", { items, title: props.title, style: styleOf(props.style) });
}
function list(items, props = {}) {
  assertList("list", "items", items, 50);
  return node("list", { items, title: props.title, style: styleOf(props.style) });
}
function progress(value, props = {}) {
  return node("progress", { value, max: props.max, label: props.label, caption: props.caption, tone: props.tone, style: styleOf(props.style) });
}
function callout(value, props = {}) {
  return node("callout", { text: value, tone: props.tone, style: styleOf(props.style) });
}
function steps(items, props = {}) {
  assertList("steps", "items", items, 12);
  return node("steps", { items, title: props.title, style: styleOf(props.style) });
}
function actions(items, props = {}) {
  assertList("actions", "items", items, 4);
  const rendered = items.map((item) => ({
    label: item.label,
    action: item.action,
    icon: item.icon,
    ...item.primary === true ? { style: "primary" } : {}
  }));
  return node("actions", { items: rendered, title: props.title, style: styleOf(props.style) });
}
function sections(builder, items) {
  assertList(builder, "items", items, 24);
  if (items.length === 0)
    refuse(builder, "needs at least one section");
  for (const section of items) {
    if (section.label === undefined || section.label === "")
      refuse(builder, "needs every section to carry a label");
    assertList(builder, "section children", section.children, MAX_CHILDREN);
    if (section.children.length === 0)
      refuse(builder, "refuses an empty section — use emptyState as its only child");
  }
}
function tabs(items) {
  sections("tabs", items);
  return node("tabs", { items });
}
function grid(children, props = {}) {
  assertList("grid", "children", children, MAX_CHILDREN);
  rejectExtra("grid", props, ["columns", "label"]);
  if (props.columns !== undefined) {
    if (![1, 2, 3, 4].includes(props.columns))
      refuse("grid", "needs columns to be 1–4");
  }
  return node("grid", { children, columns: props.columns, label: props.label });
}
function form(props) {
  assertList("form", "children", props.children, 32);
  return node("form", { children: props.children, submit: props.submit, submitLabel: props.submitLabel });
}
function textField(props) {
  return node("textField", { label: props.label, value: props.value, bind: props.bind, placeholder: props.placeholder });
}
function emptyState(props) {
  const fields = props;
  if (fields.text !== undefined)
    refuse("emptyState", 'takes "message", never "text" (the app ignores text silently)');
  rejectExtra("emptyState", fields, ["title", "message", "icon", "action"]);
  return node("emptyState", { title: props.title, message: props.message, icon: props.icon, action: props.action });
}
function divider() {
  return node("divider", {});
}
function spacer(props = {}) {
  return node("spacer", { size: props.size });
}
var NAMED_COLOURS = Object.freeze([
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
  "gray"
]);
var COLOUR_KEYS = Object.freeze(["accent", "color", "background"]);
var BANNED_STYLE_KEYS = Object.freeze([
  "radius",
  "borderRadius",
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "width",
  "height",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "opacity",
  "gradient",
  "transform",
  "zIndex",
  "elevation",
  "shadow"
]);
var SPACING_STEPS = Object.freeze(["S", "M", "L"]);
var DATA_COMPONENTS = Object.freeze([
  "metric",
  "table",
  "keyValue",
  "list",
  "chart",
  "progress",
  "steps",
  "compare",
  "timeline",
  "options",
  "codeBlock",
  "gallery",
  "image"
]);
function appAtLeast(app, minimum) {
  if (typeof app !== "string")
    return false;
  const pattern = /^(\d+)\.(\d+)\.(\d+)/;
  const have = pattern.exec(app);
  const want = pattern.exec(minimum);
  if (have === null || want === null)
    return false;
  for (let part = 1;part <= 3; part += 1) {
    const mine = Number(have[part]);
    const target = Number(want[part]);
    if (mine !== target)
      return mine > target;
  }
  return true;
}
function stripDecoration(value) {
  if (Array.isArray(value))
    return value.map(stripDecoration);
  if (!isRecord2(value))
    return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "style" || key === "accent")
      continue;
    out[key] = stripDecoration(child);
  }
  return out;
}
function wordsOf(value) {
  if (typeof value === "string" || typeof value === "number")
    return value;
  if (!isRecord2(value))
    return "";
  for (const key of ["text", "label", "title", "alt", "caption", "value", "src", "type"]) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number")
      return candidate;
  }
  return "";
}
function valueText(value) {
  if (isBinding(value))
    return value;
  return wordsOf({ text: value });
}
function fallbackFor(node2, visit) {
  const type = node2.type;
  if (type === "tabs" || type === "accordion" || type === "carousel") {
    const entries = Array.isArray(node2.items) ? node2.items : [];
    const children = [];
    for (const entry of entries) {
      if (!isRecord2(entry))
        continue;
      const kids = [];
      if (Array.isArray(entry.children)) {
        for (const child of entry.children) {
          const adapted = visit(child);
          if (adapted !== null)
            kids.push(adapted);
        }
      }
      const first = kids[0];
      if (typeof entry.label === "string" && isRecord2(first)) {
        if (first.type === "text" && first.text === entry.label)
          kids.shift();
        else if (first.title === entry.label) {
          const withoutTitle = { ...first };
          delete withoutTitle.title;
          kids[0] = withoutTitle;
        }
      }
      if (entry.label !== undefined)
        children.push({ type: "text", text: entry.label });
      children.push(...kids);
    }
    return { type: "stack", children };
  }
  if (type === "form" || type === "collapsible") {
    const children = [];
    for (const child of Array.isArray(node2.children) ? node2.children : []) {
      const adapted = visit(child);
      if (adapted !== null)
        children.push(adapted);
    }
    return { type: "stack", children };
  }
  if (type === "grid") {
    const items = [];
    for (const child of Array.isArray(node2.children) ? node2.children : []) {
      const adapted = visit(child);
      if (adapted === null)
        continue;
      if (adapted.type === "metric") {
        const row = { title: adapted.label, trailing: valueText(adapted.value) };
        if (adapted.caption !== undefined)
          row.subtitle = adapted.caption;
        items.push(row);
        continue;
      }
      const title = wordsOf(adapted);
      const subtitle = isRecord2(adapted) && adapted.subtitle !== undefined ? adapted.subtitle : undefined;
      items.push(subtitle === undefined ? { title } : { title, subtitle });
    }
    return { type: "list", items };
  }
  if (type === "timeline") {
    const items = [];
    for (const entry of Array.isArray(node2.items) ? node2.items : []) {
      if (!isRecord2(entry))
        continue;
      const words = [];
      for (const child of Array.isArray(entry.children) ? entry.children : []) {
        const adapted = visit(child);
        if (adapted === null)
          continue;
        const text2 = String(wordsOf(adapted));
        if (text2 !== "")
          words.push(text2);
      }
      items.push(words.length === 0 ? { label: String(wordsOf(entry)) } : { label: String(wordsOf(entry)), detail: words.join(" · ") });
    }
    return { type: "steps", items };
  }
  if (type === "badge" || type === "tag")
    return { type: "text", text: node2.text };
  if (type === "avatar")
    return { type: "text", text: node2.alt ?? node2.caption ?? node2.src };
  if (type === "emptyState") {
    const parts = [node2.title, node2.message].filter((part) => part !== undefined && part !== "").map((part) => String(part));
    return { type: "text", text: parts.join(`
`) };
  }
  if (type === "codeBlock")
    return { type: "text", text: node2.code };
  if (type === "textField" || type === "number" || type === "stepper" || type === "toggle" || type === "slider" || type === "select" || type === "segmented" || type === "chips" || type === "date" || type === "time" || type === "rating") {
    const label = wordsOf({ text: node2.label });
    const value = node2.value === undefined ? "" : String(wordsOf({ text: node2.value }));
    return { type: "text", text: value === "" ? String(label) : `${String(label)}: ${value}` };
  }
  if (type === "gallery") {
    const children = [];
    for (const entry of Array.isArray(node2.items) ? node2.items : []) {
      if (!isRecord2(entry) || entry.src === undefined)
        continue;
      children.push({ type: "image", src: entry.src, alt: entry.alt, caption: entry.caption });
    }
    return { type: "stack", children };
  }
  return null;
}
function adaptView(view, caps) {
  const v2 = appAtLeast(caps?.app, "1.0.9");
  const components = Array.isArray(caps?.components) ? caps.components : undefined;
  const draws = (type) => {
    if (typeof type !== "string" || !FALLBACK_COMPONENTS.includes(type))
      return true;
    if (!v2)
      return false;
    return components === undefined || components.includes(type);
  };
  const visit = (value) => {
    if (!isNode(value))
      return null;
    let current = value;
    if (!draws(current.type)) {
      const replaced = fallbackFor(current, visit);
      if (replaced === null)
        return null;
      if (current.title !== undefined && replaced.title === undefined)
        replaced.title = current.title;
      current = replaced;
    }
    const next = { ...current };
    if (Array.isArray(current.children)) {
      next.children = current.children.map(visit).filter((child) => child !== null);
    }
    if (Array.isArray(current.items)) {
      next.items = current.items.map((item) => {
        if (!isRecord2(item) || !Array.isArray(item.children))
          return item;
        return { ...item, children: item.children.map(visit).filter((child) => child !== null) };
      });
    }
    return next;
  };
  const adapted = visit(view);
  if (adapted === null)
    return v2 ? view : { type: "text", text: "" };
  if (v2)
    return adapted;
  const stripped = stripDecoration(adapted);
  return { ...stripped, v: 1 };
}

// packages/mpd-bundle-plugin/src/dshgo-copy.ts
var EN = {
  workbench: "MPD Workbench",
  board: "Team Board",
  tabsWorkbench: ["Overview", "Ask", "Library"],
  tabsBoard: ["Board", "Detail", "Watch"],
  metricReady: "Ready",
  metricActive: "Active",
  metricDone: "Done",
  metricMembers: "Members",
  metricTasks: "Tasks",
  metricBlocked: "Blocked",
  completion: "Completion",
  readyHeading: "Ready to dispatch",
  refresh: "Refresh",
  approve: "Approve plan",
  dispatch: "Dispatch",
  emptyReady: ["Nothing is ready", "Rows become ready when their blockers close; this list fills itself."],
  questionsCaption: "Answer what a teammate parked",
  customAnswer: "Custom answer",
  submit: "Send",
  emptyQuestion: ["No question is waiting", "When a member needs your answer, the question and its options appear here."],
  libraryCaption: "Workmates and memory, read-only",
  agentsHeading: "Workmates",
  memoryHeading: "Memory",
  workmatesCaption: "Durable instances from the workmate library",
  emptyWorkmates: ["The library is empty", "A workmate appears here once one is initialized from a roster base."],
  uses: "uses",
  memoryCaption: "This agent's entries in this workspace, newest by write time",
  emptyMemory: ["No memory entry yet", "Notes, facts and reflections written by this agent show up here."],
  reflection: "Reflection",
  boardCaption: "The active team's board",
  graphHeading: "Dependency graph",
  memberChartHeading: "Work per member",
  memberChartSeries: "Tasks",
  memberChartCaption: "Board rows owned, by member",
  membersCaption: "Who is on this team",
  emptyMembers: ["No member raised", "Approving a staged plan raises its members; they are listed here."],
  detailCaption: "The selected row",
  emptyDetail: ["No task selected", "Tap a row on the Board tab to read its contract here."],
  owner: "Owner",
  dependencies: "Dependencies",
  verdict: "Verdict",
  status: "Status",
  kind: "Kind",
  blockedBy: "Blocked by",
  settleHint: "Settling a row is the owning member's call; run it from that agent.",
  complete: "Complete",
  fail: "Fail",
  back: "Back",
  watchdogCaption: "The preserving hold and the recorded incidents",
  predicate: "Predicate",
  incidents: "Incidents",
  held: "Held",
  notHeld: "Running",
  watchdogReadOnly: "Pause and resume run from the captain's console, not from a tap.",
  hold: "Hold",
  resume: "Resume",
  emptyIncidents: ["No incident recorded", "A silence, a fence or a hold is recorded here when it happens."],
  emptyTeam: ["No team in this conversation", "Ask for a team, approve its plan, and its board appears here."],
  emptyBoard: ["The board is empty", "Tasks appear here as soon as a plan is approved."],
  moreOptions: "Only the first four options are shown; answer the rest from another client."
};
var ZH = {
  workbench: "MPD 工作台",
  board: "团队看板",
  tabsWorkbench: ["总览", "问题", "资料库"],
  tabsBoard: ["看板", "详情", "看门狗"],
  metricReady: "就绪",
  metricActive: "进行",
  metricDone: "完成",
  metricMembers: "成员",
  metricTasks: "任务",
  metricBlocked: "阻塞",
  completion: "完成度",
  readyHeading: "可以派出的任务",
  refresh: "刷新",
  approve: "审批计划",
  dispatch: "派活",
  emptyReady: ["暂无就绪任务", "前置任务关闭后，这一行会自动出现。"],
  questionsCaption: "回答成员留给你的问题",
  customAnswer: "自定义回答",
  submit: "提交",
  emptyQuestion: ["还没有停下来的问题", "当有成员需要你回答时，问题和它的选项会出现在这里。"],
  libraryCaption: "工作伙伴与记忆，只读",
  agentsHeading: "工作伙伴",
  memoryHeading: "记忆",
  workmatesCaption: "工作伙伴库里的持久实例",
  emptyWorkmates: ["工作伙伴库是空的", "从一个基础角色初始化后，实例会出现在这里。"],
  uses: "次使用",
  memoryCaption: "本工作区中这个 agent 的条目，按写入时间排序",
  emptyMemory: ["还没有记忆条目", "这个 agent 写下的笔记、事实和反思会出现在这里。"],
  reflection: "反思",
  boardCaption: "当前团队的看板",
  graphHeading: "依赖关系图",
  memberChartHeading: "各成员工作量",
  memberChartSeries: "任务",
  memberChartCaption: "按成员统计的负责任务数",
  membersCaption: "团队里的成员",
  emptyMembers: ["还没有成员", "审批一份计划会拉起它的成员，名单出现在这里。"],
  detailCaption: "选中的任务",
  emptyDetail: ["还没有选中任务", "在「看板」里点一行，它的合同会出现在这里。"],
  owner: "负责人",
  dependencies: "依赖",
  verdict: "结论",
  status: "状态",
  kind: "类型",
  blockedBy: "被阻塞于",
  settleHint: "结算是持有该行的成员的决定；请从那个 agent 执行。",
  complete: "完成",
  fail: "失败",
  back: "返回",
  watchdogCaption: "保活暂停与已记录的事件",
  predicate: "判据",
  incidents: "事件",
  held: "已暂停",
  notHeld: "运行中",
  watchdogReadOnly: "暂停与继续要从队长的控制台执行，不能靠点击。",
  hold: "暂停",
  resume: "继续",
  emptyIncidents: ["暂无事件", "静默、围栏或暂停发生时，会记录在这里。"],
  emptyTeam: ["这个会话还没有团队", "申请一个团队并审批计划后，看板会出现在这里。"],
  emptyBoard: ["看板是空的", "计划审批通过后，任务会出现在这里。"],
  moreOptions: "只显示前四个选项；其余的请在另一个客户端回答。"
};
function copyFor(caps) {
  const tag = typeof caps?.locale === "string" ? caps.locale.toLowerCase() : "";
  return tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_") ? ZH : EN;
}

// packages/mpd-bundle-plugin/src/dshgo-graph.ts
var GRAPH_SUBJECT_CHARS = 18;
var GRAPH_MAX_LINES = 20;
var GRAPH_MAX_STEPS = 12;
var GRAPH_FOLD_MIN_TASKS = 6;
var GRAPH_FOLD_MIN_LAYERS = 3;
function graphNeedsFold(layers) {
  const tasks = layers.reduce((total, layer) => total + layer.tasks.length, 0);
  return tasks > GRAPH_FOLD_MIN_TASKS || layers.length > GRAPH_FOLD_MIN_LAYERS;
}
function blockersOf(task, known) {
  const declared = task.dependencies === "" ? [] : task.dependencies.split(",").map((id) => id.trim());
  return declared.filter((id) => id !== "" && known.has(id));
}
function layerGraphOf(tasks) {
  const known = new Set(tasks.map((task) => task.id));
  const level = new Map(tasks.map((task) => [task.id, 0]));
  for (let pass = 0;pass < tasks.length; pass += 1) {
    let raised = false;
    for (const task of tasks) {
      const blocked = blockersOf(task, known);
      if (blocked.length === 0)
        continue;
      const wanted = Math.max(...blocked.map((id) => level.get(id) ?? 0)) + 1;
      if ((level.get(task.id) ?? 0) < wanted) {
        level.set(task.id, wanted);
        raised = true;
      }
    }
    if (!raised)
      break;
  }
  const deepest = tasks.reduce((max, task) => Math.max(max, level.get(task.id) ?? 0), 0);
  const layers = [];
  for (let depth = 0;depth <= deepest; depth += 1) {
    const at = tasks.filter((task) => (level.get(task.id) ?? 0) === depth);
    if (at.length > 0)
      layers.push({ level: depth, tasks: at });
  }
  return layers;
}
function graphLinesOf(layers) {
  const entries = layers.flatMap((layer) => layer.tasks.map((task) => ({ level: layer.level, task })));
  if (entries.length === 0)
    return ["(no tasks)"];
  const lines = [];
  for (const { level, task } of entries.slice(0, GRAPH_MAX_LINES)) {
    const subject = task.subject.length <= GRAPH_SUBJECT_CHARS ? task.subject : task.subject.slice(0, GRAPH_SUBJECT_CHARS - 1) + "…";
    const from = task.dependencies === "" ? "" : " <-" + task.dependencies.split(",").map((id) => id.trim()).filter((id) => id !== "").join(",");
    lines.push("L" + String(level) + " " + task.id + " " + subject + from);
  }
  if (entries.length > GRAPH_MAX_LINES)
    lines.push("+" + String(entries.length - GRAPH_MAX_LINES) + " more");
  return lines;
}
function graphStepsOf(layers) {
  return layers.slice(0, GRAPH_MAX_STEPS).map((layer) => ({
    label: "L" + String(layer.level),
    detail: layer.tasks.map((task) => task.id).join(" "),
    status: layer.level === 0 ? "done" : "todo"
  }));
}

// packages/mpd-bundle-plugin/src/dshgo-views.ts
function fold(label, children) {
  return { type: "collapsible", label, children };
}
function codeBlock(code) {
  return { type: "codeBlock", code };
}
function speaksV2(caps) {
  if (typeof caps?.app !== "string")
    return false;
  const [major = 0, minor = 0, patch = 0] = caps.app.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return major > 1 || major === 1 && (minor > 0 || patch >= 9);
}
function hero(title, caption, extras = []) {
  return stack([
    text(title, { style: { size: "title", weight: "bold", maxLines: 1 } }),
    text(caption, { tone: "muted", style: { size: "caption", maxLines: 1 } }),
    ...extras
  ], { style: { card: "tinted", padding: "M", gap: "S" } });
}
function section(title, children) {
  return stack([text(title, { style: { size: "subtitle", weight: "semibold", maxLines: 1 } }), divider(), ...children], { style: { card: "surface", padding: "M", gap: "S" } });
}
function tiles(entries, columns) {
  return grid(entries.map((entry) => metric({ label: entry.label, value: entry.value, ...entry.tone === undefined ? {} : { tone: entry.tone } })), { columns });
}
function empty(copy) {
  return emptyState({ title: copy[0], message: copy[1] });
}
function taskRow(task) {
  return {
    title: task.id + " " + task.subject,
    subtitle: [task.owner === "" ? "—" : task.owner, task.blockedBy === 0 ? "" : "blocked " + String(task.blockedBy)].filter((part) => part !== "").join(" · "),
    trailing: statusWordOf(task.status),
    action: { id: "select", args: { task: task.id } }
  };
}
function memberChartOf(snapshot, copy) {
  if (snapshot.members.length === 0)
    return null;
  const values = snapshot.members.map((member) => snapshot.tasks.filter((task) => task.owner === member.name).length);
  return chart({
    kind: "bar",
    categories: snapshot.members.map((member) => member.name),
    series: [{ name: copy.memberChartSeries, values }],
    caption: copy.memberChartCaption
  });
}
function statusWordOf(status) {
  const word = status.toLowerCase();
  if (word === "in_progress" || word === "running" || word === "active")
    return "active";
  if (word === "completed" || word === "done")
    return "done";
  if (word === "pending")
    return "todo";
  if (word === "cancelled")
    return "cancelled";
  return word.length <= 8 ? word : word.slice(0, 8);
}
function initialsOf(name) {
  const words = name.split(/[^A-Za-z0-9\u4e00-\u9fff]+/).filter((word) => word !== "");
  if (words.length === 0)
    return "?";
  const letters = words.slice(0, 2).map((word) => word.slice(0, 1).toUpperCase()).join("");
  return letters === "" ? "?" : letters;
}
function toneOf(status) {
  const word = status.toLowerCase();
  if (word === "done" || word === "completed" || word === "passed" || word === "idle")
    return "good";
  if (word === "failed" || word === "fence" || word === "fenced" || word === "blocked")
    return "bad";
  if (word === "in_progress" || word === "running" || word === "active" || word === "handoff")
    return "info";
  if (word === "pending" || word === "staged")
    return "warn";
  return "muted";
}
function buildMpdView(snapshot, caps) {
  const copy = copyFor(caps);
  const view = panelView({
    children: [
      tabs([
        { label: copy.tabsWorkbench[0], children: overviewTab(snapshot, copy) },
        { label: copy.tabsWorkbench[1], children: questionsTab(snapshot, copy) },
        { label: copy.tabsWorkbench[2], children: libraryTab(snapshot, copy) }
      ])
    ]
  });
  return adaptView(view, caps);
}
function overviewTab(snapshot, copy) {
  const caption = [String(snapshot.counts.ready) + " " + copy.metricReady, String(snapshot.counts.active) + " " + copy.metricActive, String(snapshot.team?.members ?? 0) + " " + copy.metricMembers].join(" · ");
  const buttons = [];
  if (snapshot.plan?.ready === true)
    buttons.push({ label: copy.approve, action: "approve", icon: "check", primary: true });
  if (snapshot.counts.ready > 0)
    buttons.push({ label: copy.dispatch, action: "dispatch", icon: "send" });
  buttons.push({ label: copy.refresh, action: "refresh", icon: "refresh" });
  const children = [
    hero(copy.workbench, caption, [progress(bind("counts.completion"), { label: copy.completion, tone: "good" })]),
    tiles([
      { label: copy.metricReady, value: bind("counts.ready"), tone: "good" },
      { label: copy.metricActive, value: bind("counts.active"), tone: "info" }
    ], 2)
  ];
  if (snapshot.alert !== null)
    children.push(callout(snapshot.alert, { tone: "warn" }));
  children.push(section(copy.readyHeading, snapshot.readyTasks.length === 0 ? [empty(copy.emptyReady)] : [list(snapshot.readyTasks.map((task) => ({ title: task.title, subtitle: task.subtitle })))]));
  children.push(spacer({ size: "S" }), actions(buttons));
  return children;
}
function questionsTab(snapshot, copy) {
  const head = hero(copy.tabsWorkbench[1], copy.questionsCaption);
  const question = snapshot.question;
  if (question === null)
    return [head, empty(copy.emptyQuestion)];
  const options = question.options.slice(0, 4).map((option, index) => ({ label: option.label, action: "answer:" + String(index) }));
  const content = [callout(bind("question.question"), { tone: "info" })];
  if (options.length > 0)
    content.push(actions(options));
  content.push(form({
    children: [textField({ label: copy.customAnswer, bind: "data.customAnswer", placeholder: copy.customAnswer })],
    submit: "answer-custom",
    submitLabel: copy.submit
  }));
  if (question.options.length > 4)
    content.push(text(copy.moreOptions, { tone: "muted", style: { size: "caption", maxLines: 2 } }));
  return [head, section(copy.tabsWorkbench[1], content)];
}
function libraryTab(snapshot, copy) {
  const mates = snapshot.workmates.map((mate) => ({ title: mate.name, subtitle: mate.base + " · " + String(mate.uses) + " " + copy.uses, trailing: mate.note }));
  const memory = snapshot.memory;
  const entries = memory === null ? [] : memory.entries.map((entry) => ({ title: entry.description, subtitle: entry.kind + " · " + entry.age }));
  const reflection = memory === null ? [] : [keyValue([[copy.reflection, String(memory.reflections)], [copy.memoryHeading, String(memory.entries.length)]])];
  return [
    hero(copy.tabsWorkbench[2], copy.libraryCaption),
    section(copy.agentsHeading, mates.length === 0 ? [empty(copy.emptyWorkmates)] : [list(mates)]),
    section(copy.memoryHeading, entries.length === 0 ? [empty(copy.emptyMemory), ...reflection] : [list(entries), divider(), ...reflection]),
    spacer({ size: "S" }),
    actions([{ label: copy.refresh, action: "refresh", icon: "refresh" }])
  ];
}
function buildTeamView(snapshot, caps) {
  const copy = copyFor(caps);
  const view = panelView({
    children: [
      tabs([
        { label: copy.tabsBoard[0], children: boardTab(snapshot, copy, speaksV2(caps)) },
        { label: copy.tabsBoard[1], children: detailTab(snapshot, copy) },
        { label: copy.tabsBoard[2], children: watchdogTab(snapshot, copy) }
      ])
    ]
  });
  return adaptView(view, caps);
}
function boardTab(snapshot, copy, v2) {
  const caption = snapshot.team === null ? copy.emptyTeam[0] : snapshot.team.name + " · " + String(snapshot.counts.total) + " " + copy.metricTasks + " · " + String(snapshot.counts.blocked) + " " + copy.metricBlocked;
  const children = [
    hero(copy.board, caption, [progress(bind("counts.completion"), { label: copy.completion, tone: "good" })]),
    tiles([
      { label: copy.metricActive, value: bind("counts.active"), tone: "info" },
      { label: copy.metricDone, value: bind("counts.done"), tone: "good" }
    ], 2)
  ];
  if (snapshot.team === null) {
    children.push(empty(copy.emptyTeam));
    return children;
  }
  children.push(section(copy.boardCaption, snapshot.tasks.length === 0 ? [empty(copy.emptyBoard)] : [list(snapshot.tasks.map(taskRow))]));
  const chartNode = memberChartOf(snapshot, copy);
  if (chartNode !== null)
    children.push(section(copy.memberChartHeading, [chartNode]));
  const layers = layerGraphOf(snapshot.tasks);
  const block = codeBlock(graphLinesOf(layers).join(`
`));
  children.push(section(copy.graphHeading, v2 ? graphNeedsFold(layers) ? [fold(copy.graphHeading, [block])] : [block] : [steps(graphStepsOf(layers))]));
  children.push(section(copy.membersCaption, snapshot.members.length === 0 ? [empty(copy.emptyMembers)] : [list(snapshot.members.map(memberLine))]));
  return children;
}
function memberLine(member) {
  const word = member.handoff === "" ? member.mode : member.handoff;
  return { title: initialsOf(member.name) + " · " + member.name, trailing: word, tone: toneOf(word) };
}
function detailTab(snapshot, copy) {
  const task = snapshot.selected;
  const head = hero(copy.tabsBoard[2], task === null ? copy.emptyDetail[0] : task.id + " " + task.subject);
  if (task === null)
    return [head, empty(copy.emptyDetail)];
  const fields = keyValue([
    [copy.owner, task.owner === "" ? "—" : task.owner],
    [copy.status, task.status],
    [copy.kind, task.kind],
    [copy.dependencies, task.dependencies === "" ? "—" : task.dependencies],
    [copy.verdict, task.verdict === "" ? "—" : task.verdict]
  ]);
  return [
    head,
    section(copy.detailCaption, [
      text(task.description === "" ? "—" : task.description, { tone: "muted", style: { maxLines: 4 } }),
      divider(),
      fields,
      callout(copy.settleHint),
      actions([{ label: copy.back, action: "back", icon: "expand" }])
    ])
  ];
}
function watchdogTab(snapshot, copy) {
  const watchdog = snapshot.watchdog;
  const holdLine = watchdog.held ? copy.held + (watchdog.reason === "" ? "" : " · " + watchdog.reason) : copy.notHeld;
  const rows = watchdog.incidents.map((incident) => ({ title: incident.kind, subtitle: incident.at, trailing: incident.detail }));
  return [
    hero(copy.tabsBoard[2], copy.watchdogCaption),
    tiles([
      { label: copy.predicate, value: watchdog.predicate },
      { label: copy.tabsBoard[2], value: holdLine, tone: watchdog.held ? "warn" : "good" }
    ], 2),
    section(copy.incidents, rows.length === 0 ? [empty(copy.emptyIncidents)] : [list(rows)]),
    callout(copy.watchdogReadOnly)
  ];
}

// packages/mpd-bundle-plugin/src/dshgo-panel.ts
var DSHGO_PANEL_ID = "mpd";
var DSHGO_POLL_MS = 2000;
var DSHGO_MAX_SNAPSHOT_BYTES = 32768;
var DSHGO_MAX_READY_ROWS = 10;
var DSHGO_MAX_OPTIONS = 4;
var DSHGO_MAX_MEMORY_ROWS = 10;
var DSHGO_MAX_WORKMATES = 12;
var MEMORY_DIR = ".mpd";
var ALERT_PLAN_WAITING = "A plan is staged and waits for approval";
var DSHGO_ACTION_WAIT_MS = 2000;
var DSHGO_DEFERRED_TIMEOUT_MS = 60000;
var TOAST_NO_SESSION = "Open a conversation first";
var TOAST_UNAVAILABLE = "Unavailable here";
var TOAST_REFUSED = "The action was refused";
var PENDING_APPROVE = "Approving…";
var PENDING_DISPATCH = "Dispatching…";
var PENDING_ANSWER = "Answering…";
var TOAST_APPROVED = "Approved";
var TOAST_DISPATCHED = "Dispatched";
var TOAST_ANSWERED = "Answered";
var TOAST_QUESTION_GONE = "That question is gone";
var TOAST_NO_QUESTION = "No question on screen";
var MAX_ANSWER_CHARS = 400;
var MAX_TITLE_CHARS = 120;
var MAX_CAPTION_CHARS = 80;
var MAX_QUESTION_CHARS = 400;
var MAX_LABEL_CHARS = 80;
var MAX_TOAST_CHARS = 40;
function emptySnapshot() {
  return {
    team: null,
    plan: null,
    question: null,
    readyTasks: [],
    counts: { ready: 0, active: 0, done: 0, total: 0, completion: 0, members: 0 },
    alert: null,
    workmates: [],
    memory: null
  };
}
function recordOf(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function stringOf(value) {
  return typeof value === "string" ? value : "";
}
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
function clip(value, max) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max);
}
function clipToast(value) {
  const text2 = clip(value, MAX_TOAST_CHARS);
  return text2 === "" ? TOAST_UNAVAILABLE : text2;
}
function probe(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}
function faceOf(services, name) {
  return probe(() => {
    const service = typeof services.get === "function" ? services.get(name, false) : undefined;
    return recordOf(service) === undefined ? undefined : service;
  }, undefined);
}
function sessionIdOfScope(scope) {
  const record = recordOf(scope);
  return record === undefined ? "" : stringOf(record.sessionId);
}
function scopeKeyOf(scope) {
  return sessionIdOfScope(scope);
}
function teamStatusOf2(record) {
  if (stringOf(record.endedAt) !== "")
    return "ended";
  return stringOf(record.approvedAt) !== "" ? "approved" : "staged";
}
var RELEASING_STATUSES = new Set(["completed", "cancelled", "failed"]);
function readyRowsOf(tasks) {
  const statusById = new Map;
  for (const task of tasks)
    statusById.set(stringOf(task.id), stringOf(task.status));
  const rows = [];
  for (const task of tasks) {
    if (stringOf(task.status) !== "pending")
      continue;
    const blocked = arrayOf(task.blockedBy).some((entry) => {
      const status = statusById.get(stringOf(entry));
      return status !== undefined && !RELEASING_STATUSES.has(status);
    });
    if (blocked)
      continue;
    const caption = [stringOf(task.kind), stringOf(task.owner)].filter((part) => part !== "").join(" · ");
    rows.push({
      id: stringOf(task.id),
      title: clip(stringOf(task.subject), MAX_TITLE_CHARS),
      subtitle: clip(caption === "" ? "ready" : caption, MAX_CAPTION_CHARS)
    });
    if (rows.length >= DSHGO_MAX_READY_ROWS)
      break;
  }
  return rows;
}
function countsOf(tasks) {
  const statusById = new Map;
  for (const task of tasks)
    statusById.set(stringOf(task.id), stringOf(task.status));
  let active = 0;
  let done = 0;
  let ready = 0;
  for (const task of tasks) {
    const status = stringOf(task.status);
    if (RELEASING_STATUSES.has(status)) {
      done += 1;
      continue;
    }
    if (status === "in_progress")
      active += 1;
    if (status === "pending" && !arrayOf(task.blockedBy).some((entry) => {
      const blockedStatus = statusById.get(stringOf(entry));
      return blockedStatus !== undefined && !RELEASING_STATUSES.has(blockedStatus);
    }))
      ready += 1;
  }
  return {
    ready,
    active,
    done,
    total: tasks.length,
    completion: tasks.length === 0 ? 0 : Math.round(done / tasks.length * 100),
    members: 0
  };
}
function teamSnapshotOf(value) {
  const record = recordOf(value);
  if (record === undefined)
    return null;
  const members = arrayOf(record.members).map((member) => recordOf(member)).filter((member) => member !== undefined);
  return {
    id: stringOf(record.teamId),
    name: clip(stringOf(record.name), MAX_TITLE_CHARS),
    status: teamStatusOf2(record),
    phase: stringOf(record.phase) === "" ? "staged" : stringOf(record.phase),
    members: members.filter((member) => stringOf(member.status) !== "failed").length,
    tasks: arrayOf(record.tasks).length
  };
}
function planSnapshotOf(value) {
  const payload = recordOf(value);
  const plan = payload === undefined ? undefined : recordOf(payload.plan);
  if (plan === undefined)
    return null;
  return {
    ready: plan.approved !== true && plan.discarded !== true,
    members: arrayOf(plan.members).length,
    tasks: arrayOf(plan.tasks).length
  };
}
function questionReadOf(value) {
  const parked = arrayOf(value).map((entry2) => recordOf(entry2)).filter((entry2) => entry2 !== undefined);
  const entry = parked[0];
  if (entry === undefined)
    return null;
  const items = arrayOf(entry.questions).map((question) => recordOf(question)).filter((question) => question !== undefined);
  const item = items[0];
  if (item === undefined)
    return null;
  const options = arrayOf(item.options).map((option) => recordOf(option)).filter((option) => option !== undefined).map((option) => ({ raw: stringOf(option.label), display: clip(stringOf(option.label), MAX_LABEL_CHARS) })).filter((option) => option.raw !== "" && option.display !== "");
  return {
    snapshot: {
      id: stringOf(entry.id),
      question: clip(stringOf(item.question), MAX_QUESTION_CHARS),
      options: options.map((option) => ({ label: option.display }))
    },
    binding: {
      parkedId: stringOf(entry.id),
      itemIds: items.map((question) => stringOf(question.id)).filter((id) => id !== ""),
      labels: options.map((option) => option.raw)
    }
  };
}
function workmatesOf(services) {
  const face = faceOf(services, "mpdWorkmate");
  if (face?.list === undefined)
    return [];
  return arrayOf(probe(() => face.list?.(), undefined)).map((entry) => recordOf(entry)).filter((entry) => entry !== undefined).slice(0, DSHGO_MAX_WORKMATES).map((entry) => ({
    name: clip(stringOf(entry.name), MAX_TITLE_CHARS),
    base: clip(stringOf(entry.baseName), MAX_CAPTION_CHARS),
    uses: typeof entry.uses === "number" && Number.isFinite(entry.uses) ? entry.uses : 0,
    note: clip(stringOf(entry.note), MAX_CAPTION_CHARS)
  }));
}
function frontmatterOf(text2) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text2);
  if (match === null)
    return;
  try {
    const parsed = JSON.parse(match[1] ?? "");
    return recordOf(parsed);
  } catch {
    return;
  }
}
function ageOf(at, now) {
  if (at <= 0)
    return "never";
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 60)
    return String(minutes) + "m";
  if (minutes < 60 * 24)
    return String(Math.floor(minutes / 60)) + "h";
  return String(Math.floor(minutes / (60 * 24))) + "d";
}
function memorySlugOf(workspace, scope) {
  if (scope?.agentSlug !== undefined && scope.agentSlug !== "")
    return scope.agentSlug;
  const base = basename2(workspace).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return "agent-" + base;
}
function readMemoryStore(workspace, now, scope) {
  const stateDir = scope?.dir === undefined || scope.dir === "" ? MEMORY_DIR : scope.dir;
  const agentRoot = join3(workspace, stateDir, "memory", "agents", memorySlugOf(workspace, scope));
  const memoryDir = join3(agentRoot, "repo", "memory");
  if (!existsSync2(memoryDir))
    return null;
  const newest = probe(() => readdirSync2(memoryDir), []).filter((file) => file.endsWith(".md")).map((file) => ({ file, at: probe(() => statSync2(join3(memoryDir, file)).mtimeMs, 0) })).sort((left, right) => right.at - left.at).slice(0, DSHGO_MAX_MEMORY_ROWS);
  const found = [];
  for (const { file, at } of newest) {
    const path = join3(memoryDir, file);
    const text2 = probe(() => readFileSync2(path, "utf8"), undefined);
    if (text2 === undefined)
      continue;
    const meta = frontmatterOf(text2);
    if (meta === undefined)
      continue;
    found.push({ kind: clip(stringOf(meta.kind), MAX_CAPTION_CHARS), description: clip(stringOf(meta.description), MAX_CAPTION_CHARS), age: ageOf(at, now) });
  }
  const state = probe(() => JSON.parse(readFileSync2(join3(agentRoot, "runtime", "reflection.json"), "utf8")), undefined);
  const record = recordOf(state) ?? {};
  return {
    entries: found,
    reflections: typeof record.reflectionsCompleted === "number" ? record.reflectionsCompleted : typeof record.reflected_completed_steps === "number" ? record.reflected_completed_steps : 0,
    steps: typeof record.stepsSinceReflection === "number" ? record.stepsSinceReflection : typeof record.steps_since_last_successful_reflection === "number" ? record.steps_since_last_successful_reflection : 0
  };
}
function refreshKeyOf(snapshot) {
  const question = snapshot.question === null ? "" : snapshot.question.id + "|" + snapshot.question.options.map((option) => option.label).join("|");
  const ready = snapshot.readyTasks.map((task) => task.id).join(",");
  const plan = snapshot.plan?.ready === true ? "plan" : "";
  const alert = snapshot.alert ?? "";
  const workmates = snapshot.workmates.map((mate) => mate.name).join(",");
  const memory = snapshot.memory === null ? "" : snapshot.memory.entries.map((entry) => entry.kind + ":" + entry.description).join("|") + "@" + String(snapshot.memory.reflections) + "/" + String(snapshot.memory.steps);
  return [question, ready, plan, alert, workmates, memory].join("#");
}
function readPanelState(read, options = {}) {
  const sessionId = read.sessionId;
  const workspace = read.workspace;
  if (sessionId === "" || workspace === undefined || workspace === "")
    return { snapshot: emptySnapshot(), binding: { question: null } };
  const teams = faceOf(read.services, "mpdTeams");
  const questions = faceOf(read.services, "mpdQuestions");
  const record = teams?.active === undefined ? undefined : probe(() => teams.active?.(workspace, sessionId), undefined);
  const question = questions?.list === undefined ? null : questionReadOf(probe(() => questions.list?.({ sessionId }), undefined));
  const tasks = arrayOf(recordOf(record)?.tasks).map((task) => recordOf(task)).filter((task) => task !== undefined);
  const plan = teams?.planFor === undefined ? null : planSnapshotOf(probe(() => teams.planFor?.(workspace, sessionId), undefined));
  return {
    snapshot: {
      team: teamSnapshotOf(record),
      plan,
      question: question?.snapshot ?? null,
      readyTasks: readyRowsOf(tasks),
      counts: { ...countsOf(tasks), members: teamSnapshotOf(record)?.members ?? 0 },
      alert: plan?.ready === true ? ALERT_PLAN_WAITING : null,
      workmates: options.light === true ? [] : workmatesOf(read.services),
      memory: options.light === true ? null : probe(() => readMemoryStore(workspace, Date.now(), read.memory), null)
    },
    binding: { question: question?.binding ?? null }
  };
}
function readPanelSnapshot(read, options = {}) {
  return readPanelState(read, options).snapshot;
}
function buildPanelView(snapshot, caps) {
  return buildMpdView(snapshot, caps);
}
function isRefusal(value) {
  const record = recordOf(value);
  return record !== undefined && record.ok === false;
}
function messageOf(value) {
  if (value instanceof Error)
    return value.message;
  const record = recordOf(value);
  if (record !== undefined) {
    const text2 = stringOf(record.error);
    if (text2 !== "")
      return text2;
  }
  return typeof value === "string" ? value : "";
}
var TIMED_OUT = Symbol("mpd-panel-timeout");
function attemptOf(run) {
  return Promise.resolve().then(run).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
}
async function orDeferred(running, label) {
  let timer;
  const deadline = new Promise((resolve3) => {
    timer = setTimeout(() => resolve3(TIMED_OUT), DSHGO_ACTION_WAIT_MS);
  });
  try {
    const raced = await Promise.race([running, deadline]);
    if (raced !== TIMED_OUT)
      return raced;
    return {
      pending: { label, timeoutMs: DSHGO_DEFERRED_TIMEOUT_MS },
      result: () => running
    };
  } finally {
    if (timer !== undefined)
      clearTimeout(timer);
  }
}
function actionIdOf(event) {
  const record = recordOf(event);
  if (record === undefined)
    return "";
  const action = stringOf(record.action);
  if (action !== "")
    return action;
  const value = recordOf(record.value);
  return value === undefined ? "" : stringOf(value.action);
}
function customAnswerOf(event) {
  const value = recordOf(recordOf(event)?.value);
  if (value === undefined)
    return "";
  const named = stringOf(value.customAnswer);
  if (named !== "")
    return named;
  const generic = stringOf(value.text);
  if (generic !== "")
    return generic;
  for (const entry of Object.values(value))
    if (typeof entry === "string" && entry !== "")
      return entry;
  return "";
}
function optionIndexOf(action) {
  const match = /^answer:(\d+)$/.exec(action);
  if (match === null)
    return;
  const index = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(index) && index >= 0 && index < DSHGO_MAX_OPTIONS ? index : undefined;
}
function holdsParkedId(parked, parkedId) {
  if (parkedId === "")
    return false;
  return arrayOf(parked).map((entry) => recordOf(entry)).some((entry) => entry !== undefined && stringOf(entry.id) === parkedId);
}
function createPanelActions(options, bindingOf = () => {
  return;
}) {
  const teamActions = () => faceOf(options.ctx, "mpdTeamActions");
  const questions = () => faceOf(options.ctx, "mpdQuestions");
  const effectOf = (outcome, success, accepted = () => true) => {
    if (outcome.ok === false)
      return { toast: clipToast(messageOf(outcome.error)) };
    if (isRefusal(outcome.value))
      return { toast: clipToast(messageOf(outcome.value) || TOAST_REFUSED) };
    return accepted(outcome.value) ? success : { toast: TOAST_UNAVAILABLE };
  };
  const approve = async (scope) => {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId === "")
      return { toast: TOAST_NO_SESSION };
    const face = teamActions();
    if (face?.approve === undefined)
      return { toast: TOAST_UNAVAILABLE };
    const running = attemptOf(() => face.approve?.({ sessionId })).then((outcome) => effectOf(outcome, { toast: TOAST_APPROVED }));
    return orDeferred(running, PENDING_APPROVE);
  };
  const dispatch = async (scope) => {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId === "")
      return { toast: TOAST_NO_SESSION };
    const face = teamActions();
    if (face?.dispatch === undefined)
      return { toast: TOAST_UNAVAILABLE };
    const running = attemptOf(() => face.dispatch?.({ sessionId })).then((outcome) => effectOf(outcome, { toast: TOAST_DISPATCHED }));
    return orDeferred(running, PENDING_DISPATCH);
  };
  const answerFor = async (scope, index, custom) => {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId === "")
      return { toast: TOAST_NO_SESSION };
    const face = questions();
    if (face?.list === undefined || face.answer === undefined)
      return { toast: TOAST_UNAVAILABLE };
    const captured2 = bindingOf(scope)?.question;
    if (captured2 === undefined || captured2 === null)
      return { toast: TOAST_NO_QUESTION };
    const label = custom === "" ? captured2.labels[index ?? -1] : clip(custom, MAX_ANSWER_CHARS);
    const itemId = captured2.itemIds[0];
    if (label === undefined || itemId === undefined || label === "")
      return { toast: TOAST_UNAVAILABLE };
    const stillParked = holdsParkedId(probe(() => face.list?.({ sessionId }), undefined), captured2.parkedId);
    if (!stillParked) {
      probe(() => options.dsh.dshGoRefresh(DSHGO_PANEL_ID), undefined);
      return { toast: TOAST_QUESTION_GONE };
    }
    const answer = custom === "" ? { id: itemId, selected: [label] } : { id: itemId, selected: [], custom: label };
    const running = attemptOf(() => face.answer?.({ id: captured2.parkedId, answers: [answer] })).then((outcome) => effectOf(outcome, { toast: TOAST_ANSWERED }, (value) => value === true));
    return orDeferred(running, PENDING_ANSWER);
  };
  const answerWith = async (scope, event) => answerFor(scope, optionIndexOf(actionIdOf(event)), "");
  const answerCustom = async (scope, event) => answerFor(scope, undefined, customAnswerOf(event));
  const refresh = async () => ({ refresh: true });
  const actions2 = { approve, dispatch, refresh, "answer-custom": answerCustom };
  for (let index = 0;index < DSHGO_MAX_OPTIONS; index += 1)
    actions2["answer:" + index] = answerWith;
  return actions2;
}
function registerDshGoPanel(options) {
  const log = options.log ?? ((line) => {
    rowLogLine("mpd-bundle", line);
  });
  const pollMs = options.pollMs ?? DSHGO_POLL_MS;
  let registered = false;
  let announced = "";
  let offBound;
  const viewBindings = new Map;
  const emitted = new Map;
  const refreshKeys = new Map;
  const timers = new Set;
  const announce = (state) => {
    if (announced === state)
      return;
    announced = state;
    log("[mpd] dshGo=" + state);
  };
  const workspaceOf = (sessionId) => {
    const fromBridge = probe(() => typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined, undefined);
    if (typeof fromBridge === "string" && fromBridge !== "")
      return fromBridge;
    return probe(() => options.workspace?.(sessionId), undefined);
  };
  const stateOf = (scope) => readPanelState({ services: options.ctx, workspace: workspaceOf(sessionIdOfScope(scope)), sessionId: sessionIdOfScope(scope), memory: options.memory });
  const snapshotOf = (scope) => stateOf(scope).snapshot;
  const published = new Set;
  let overBudget = false;
  const viewFor = (scope, caps) => {
    const state = stateOf(scope);
    viewBindings.set(scopeKeyOf(scope), state.binding);
    return buildPanelView(state.snapshot, caps);
  };
  const announceRefreshState = (key, snapshot, seed) => {
    const signature = refreshKeyOf(snapshot);
    if (refreshKeys.get(key) === signature)
      return;
    const changed = !seed && refreshKeys.has(key);
    refreshKeys.set(key, signature);
    if (changed)
      probe(() => options.dsh.dshGoRefresh(DSHGO_PANEL_ID), undefined);
  };
  const publishInto = (key, snapshot, send, seed) => {
    const serialized = JSON.stringify(snapshot);
    if (seed || !published.has(key) || emitted.get(key) !== serialized) {
      emitted.set(key, serialized);
      published.add(key);
      if (new TextEncoder().encode(serialized).length > DSHGO_MAX_SNAPSHOT_BYTES && !overBudget) {
        overBudget = true;
        log("[mpd] dshGo=snapshot-over-budget");
      }
      probe(() => send?.(snapshot), undefined);
    }
    announceRefreshState(key, snapshot, seed);
  };
  const data = (scope, emit) => {
    const send = typeof emit === "function" ? emit : undefined;
    const key = scopeKeyOf(scope);
    publishInto(key, snapshotOf(scope), send, true);
    const timer = setInterval(() => {
      publishInto(key, snapshotOf(scope), send, false);
    }, pollMs);
    timers.add(timer);
    return () => {
      clearInterval(timer);
      timers.delete(timer);
      emitted.delete(key);
      refreshKeys.delete(key);
      published.delete(key);
    };
  };
  const spec = {
    view: viewFor,
    data,
    actions: createPanelActions(options, (scope) => viewBindings.get(scopeKeyOf(scope)))
  };
  const attempt = () => {
    if (registered)
      return;
    const present = probe(() => options.dsh.dshGoPresent() === true, false);
    if (!present) {
      if (offBound === undefined) {
        offBound = probe(() => {
          const off = options.dsh.onServiceBound(["dshGo"], () => {
            attempt();
          });
          return typeof off === "function" ? off : () => {};
        }, () => {});
      }
      announce("absent");
      return;
    }
    const accepted = probe(() => options.dsh.dshGoPanel(DSHGO_PANEL_ID, spec) === true, false);
    if (!accepted) {
      announce("absent");
      return;
    }
    registered = true;
    announce("panel");
  };
  attempt();
  return {
    registered,
    dispose: () => {
      for (const timer of timers)
        clearInterval(timer);
      timers.clear();
      published.clear();
      viewBindings.clear();
      emitted.clear();
      refreshKeys.clear();
      probe(() => offBound?.(), undefined);
      offBound = undefined;
    }
  };
}

// packages/mpd-bundle-plugin/src/dshgo-team-panel.ts
var DSHGO_TEAM_PANEL_ID = "mpd-team";
var TEAM_MAX_ROWS = 50;
var MAX_DESCRIPTION_CHARS = 600;
var STATUS_TOOL = "session-watchdog-status";
function scopeKeyOf2(scope) {
  const record = typeof scope === "object" && scope !== null ? scope : undefined;
  const sessionId = record === undefined ? undefined : record.sessionId;
  return typeof sessionId === "string" ? sessionId : "";
}
function stringOf2(value) {
  return typeof value === "string" ? value : "";
}
function arrayOf2(value) {
  return Array.isArray(value) ? value : [];
}
function recordOf2(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function clip2(value, max) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max);
}
function probe2(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}
function taskOf(value) {
  const task = recordOf2(value) ?? {};
  return {
    id: stringOf2(task.id),
    subject: clip2(stringOf2(task.subject), 120),
    owner: clip2(stringOf2(task.owner), 60),
    status: clip2(stringOf2(task.status), 40),
    kind: clip2(stringOf2(task.kind), 40),
    blockedBy: arrayOf2(task.blockedBy).length,
    description: clip2(stringOf2(task.description) || stringOf2(task.acceptance), MAX_DESCRIPTION_CHARS),
    dependencies: arrayOf2(task.blockedBy).map((id) => stringOf2(id)).filter((id) => id !== "").join(", "),
    verdict: clip2(stringOf2(recordOf2(task.verdict)?.verdict) || stringOf2(task.verdict), 40)
  };
}
function memberOf(value) {
  const member = recordOf2(value) ?? {};
  return {
    name: clip2(stringOf2(member.name), 60),
    mode: clip2(stringOf2(member.mode) || stringOf2(member.status) || "idle", 40),
    handoff: clip2(stringOf2(member.handoff) || stringOf2(member.handoffState), 40)
  };
}
function countsOf2(tasks) {
  const done = tasks.filter((task) => task.status === "completed" || task.status === "cancelled" || task.status === "failed").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;
  const blocked = tasks.filter((task) => task.blockedBy > 0).length;
  return { total: tasks.length, done, active, blocked, completion: tasks.length === 0 ? 0 : Math.round(done / tasks.length * 100) };
}
function readTeamSnapshot(services, workspace, sessionId) {
  const empty2 = { team: null, tasks: [], counts: { total: 0, done: 0, active: 0, blocked: 0, completion: 0 }, members: [], selected: null, watchdog: { predicate: "unknown", held: false, reason: "", taskId: "", incidents: [] } };
  if (workspace === undefined || workspace === "" || sessionId === "")
    return empty2;
  const face = probe2(() => services.get?.("mpdTeams", false), undefined);
  if (face?.active === undefined)
    return empty2;
  const record = recordOf2(probe2(() => face.active?.(workspace, sessionId), undefined));
  if (record === undefined)
    return empty2;
  const tasks = arrayOf2(record.tasks).map(taskOf).slice(0, TEAM_MAX_ROWS);
  return {
    team: { id: stringOf2(record.id) || stringOf2(record.teamId), name: clip2(stringOf2(record.name) || "team", 60), status: clip2(stringOf2(record.status), 40), phase: clip2(stringOf2(record.phase), 40) },
    tasks,
    counts: countsOf2(tasks),
    members: arrayOf2(record.members).map(memberOf).slice(0, 6),
    selected: null,
    watchdog: empty2.watchdog
  };
}
async function readWatchdog(services, tools, teamId, workspace) {
  const registry = probe2(() => services.get?.("mpdWatchdog", false), undefined);
  const hold = recordOf2(probe2(() => registry?.isHeld?.(teamId, workspace), undefined));
  const call = tools?.executeTool === undefined ? undefined : recordOf2(await Promise.resolve().then(() => tools?.executeTool?.({ name: STATUS_TOOL, arguments: {} })).then((value) => value, () => {
    return;
  }));
  const status = call?.ok === false ? undefined : call?.value;
  const record = recordOf2(status);
  const row2 = record === undefined ? undefined : arrayOf2(record.teams).map((entry) => recordOf2(entry)).find((entry) => entry !== undefined && (stringOf2(entry.teamId) === teamId || entry.teamId === undefined));
  const predicate = clip2(stringOf2(recordOf2(record?.predicate)?.source) || "channel", 20);
  const incidents = arrayOf2(record?.incidents).map((entry) => recordOf2(entry)).filter((entry) => entry !== undefined).slice(0, 5).map((entry) => ({ at: clip2(stringOf2(entry.ts) || stringOf2(entry.at), 24), kind: clip2(stringOf2(entry.kind) || "incident", 30), detail: clip2(stringOf2(entry.detail) || stringOf2(entry.reason), 80) }));
  return {
    predicate,
    held: hold?.held === true || row2?.held === true,
    reason: clip2(stringOf2(hold?.reason) || stringOf2(hold?.cause), 60),
    taskId: clip2(stringOf2(hold?.taskId), 20),
    incidents
  };
}
async function buildTeamPanelFor(services, tools, workspaceOf, selection, scope, caps) {
  const sessionId = scopeKeyOf2(scope);
  const workspace = workspaceOf(sessionId);
  const snapshot = readTeamSnapshot(services, workspace, sessionId);
  const selectedId = selection.get(scope);
  const selected = snapshot.tasks.find((task) => task.id === selectedId) ?? snapshot.tasks.find((task) => task.status === "in_progress") ?? snapshot.tasks[0] ?? null;
  const watchdog = snapshot.team === null ? snapshot.watchdog : await readWatchdog(services, tools, snapshot.team.id, workspace ?? "");
  return buildTeamView({ ...snapshot, selected, watchdog }, caps);
}
function createTeamPanelActions(options, selection) {
  const argsOf = (event) => recordOf2(recordOf2(event)?.value) ?? {};
  const select = async (scope, event) => {
    const taskId = stringOf2(argsOf(event).task);
    if (taskId === "")
      return { toast: "That row is gone" };
    selection.set(scope, taskId);
    return { refresh: true };
  };
  const back = async (scope) => {
    selection.set(scope, "");
    return { refresh: true };
  };
  const refresh = async () => ({ refresh: true });
  return { select, back, refresh };
}
function registerDshGoTeamPanel(options) {
  const log = options.log ?? ((line) => {
    rowLogLine("mpd-bundle", line);
  });
  const pollMs = options.pollMs ?? DSHGO_POLL_MS;
  let registered = false;
  let announced = "";
  let offBound;
  const selections = new Map;
  const selection = {
    get: (scope) => selections.get(scopeKeyOf2(scope)) ?? "",
    set: (scope, taskId) => {
      if (taskId === "")
        selections.delete(scopeKeyOf2(scope));
      else
        selections.set(scopeKeyOf2(scope), taskId);
    }
  };
  const timers = new Set;
  const emitted = new Map;
  const signatures = new Map;
  const workspaceOf = (sessionId) => {
    const fromBridge = probe2(() => typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined, undefined);
    if (typeof fromBridge === "string" && fromBridge !== "")
      return fromBridge;
    return probe2(() => options.workspace?.(sessionId), undefined);
  };
  const snapshotOf = (scope) => {
    const sessionId = scopeKeyOf2(scope);
    const team = readTeamSnapshot(options.ctx, sessionId === "" ? undefined : workspaceOf(sessionId), sessionId);
    return { team: team.team, counts: team.counts, members: team.members, tasks: team.tasks };
  };
  const signatureOf = (snapshot) => snapshot.team === null ? "" : [snapshot.team.id, snapshot.team.status, snapshot.team.phase, snapshot.tasks.map((task) => task.id + ":" + task.status).join(","), snapshot.members.map((member) => member.name + "/" + member.mode).join(",")].join("|");
  const publishInto = (key, snapshot, send, seed) => {
    const serialized = JSON.stringify(snapshot);
    if (seed || emitted.get(key) !== serialized) {
      emitted.set(key, serialized);
      probe2(() => send?.(snapshot), undefined);
    }
    const signature = signatureOf(snapshot);
    const changed = !seed && signatures.has(key) && signatures.get(key) !== signature;
    signatures.set(key, signature);
    if (changed)
      probe2(() => options.dsh.dshGoRefresh(DSHGO_TEAM_PANEL_ID), undefined);
  };
  const data = (scope, emit) => {
    const send = typeof emit === "function" ? emit : undefined;
    const key = scopeKeyOf2(scope);
    publishInto(key, snapshotOf(scope), send, true);
    const timer = setInterval(() => {
      publishInto(key, snapshotOf(scope), send, false);
    }, pollMs);
    timers.add(timer);
    return () => {
      clearInterval(timer);
      timers.delete(timer);
      emitted.delete(key);
      signatures.delete(key);
    };
  };
  const view = async (scope, caps) => buildTeamPanelFor(options.ctx, options.dsh, workspaceOf, selection, scope, caps);
  const spec = { view, data, actions: createTeamPanelActions(options, selection) };
  const attempt = () => {
    if (registered)
      return;
    const present = probe2(() => options.dsh.dshGoPresent() === true, false);
    if (!present) {
      if (offBound === undefined) {
        offBound = probe2(() => {
          const off = options.dsh.onServiceBound(["dshGo"], () => {
            attempt();
          });
          return typeof off === "function" ? off : () => {};
        }, () => {});
      }
      if (announced !== "absent")
        log("[mpd] dshGo=team-absent");
      announced = "absent";
      return;
    }
    if (probe2(() => options.dsh.dshGoPanel(DSHGO_TEAM_PANEL_ID, spec) === true, false)) {
      registered = true;
      if (announced !== "panel")
        log("[mpd] dshGo=team-panel");
      announced = "panel";
      return;
    }
    if (announced !== "absent")
      log("[mpd] dshGo=team-absent");
    announced = "absent";
  };
  attempt();
  return {
    registered,
    dispose: () => {
      for (const timer of timers)
        clearInterval(timer);
      timers.clear();
      emitted.clear();
      signatures.clear();
      selections.clear();
      probe2(() => offBound?.(), undefined);
      offBound = undefined;
    }
  };
}

// packages/mpd-bundle-plugin/src/dshgo-surfaces.ts
var DSHGO_DISPATCH_ACTION = "mpd-dispatch";
var DSHGO_SAVE_MEMORY_ACTION = "mpd-save-memory";
var DSHGO_COPY_REPLY_ACTION = "mpd-copy-reply";
var DSHGO_STRIP_ID = "mpd-status";
var STRIP_MAX_CHARS = 24;
var MAX_TOAST_CHARS2 = 40;
var MAX_COPY_CHARS = 8000;
var MAX_MEMORY_DESCRIPTION_CHARS = 120;
var MAX_MEMORY_CONTENT_CHARS = 4000;
var MEMORY_WRITE_TOOL = "mpd_memory_write";
function stringOf3(value) {
  return typeof value === "string" ? value : "";
}
function recordOf3(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}
function probe3(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}
function clip3(value, max) {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max);
}
function speaksChinese(caps) {
  const tag = typeof caps?.locale === "string" ? caps.locale.toLowerCase() : "";
  return tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_");
}
function stripLine(ready, active, parked, warns, chinese) {
  const counters = chinese ? String(ready) + " 就绪 · " + String(active) + " 进行" : String(ready) + " ready · " + String(active) + " active";
  const text2 = (parked ? "❓" : "") + counters;
  return { text: clip3(text2, STRIP_MAX_CHARS), icon: "team", tone: warns ? "warn" : "info" };
}
function stripValueOf(options, scope, caps) {
  const sessionId = sessionIdOfScope(scope);
  const workspace = probe3(() => typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined, undefined) ?? probe3(() => options.workspace?.(sessionId), undefined);
  const snapshot = readPanelSnapshot({ services: options.ctx, workspace, sessionId }, { light: true });
  return stripLine(snapshot.counts.ready, snapshot.counts.active, snapshot.question !== null, snapshot.plan?.ready === true, speaksChinese(caps));
}
function replyTextOf(event) {
  const record = recordOf3(event);
  if (record === undefined)
    return "";
  const value = recordOf3(record.value);
  return stringOf3(record.text) || stringOf3(value?.text) || stringOf3(value?.reply) || stringOf3(recordOf3(record.message)?.text) || stringOf3(record.reply);
}
function createSurfaceActions(options) {
  const tools = () => options.dsh;
  const callTool = async (name, args, success) => {
    const runtime = tools();
    if (runtime?.executeTool === undefined)
      return { toast: "Unavailable here" };
    const outcome = await Promise.resolve().then(() => runtime.executeTool?.({ name, arguments: args })).then((value) => ({ ok: true, value }), (error) => ({ ok: false, value: error }));
    if (outcome.ok === false)
      return { toast: clip3(outcome.value instanceof Error ? outcome.value.message : "The action was refused", MAX_TOAST_CHARS2) };
    const record = recordOf3(outcome.value);
    if (record !== undefined && (record.ok === false || stringOf3(record.error) !== ""))
      return { toast: clip3(stringOf3(record.error) || "The action was refused", MAX_TOAST_CHARS2) };
    return { toast: clip3(success, MAX_TOAST_CHARS2) };
  };
  const dispatch = async (scope) => {
    const sessionId = sessionIdOfScope(scope);
    if (sessionId === "")
      return { toast: "Open a conversation first" };
    const face = probe3(() => options.ctx.get?.("mpdTeamActions", false), undefined);
    if (face?.dispatch === undefined)
      return { toast: "Unavailable here" };
    const running = Promise.resolve().then(() => face.dispatch?.({ sessionId })).then((value) => recordOf3(value)?.ok === false ? { toast: clip3(stringOf3(recordOf3(value)?.error) || "The action was refused", MAX_TOAST_CHARS2) } : { toast: "Dispatched" }, (error) => ({ toast: clip3(error instanceof Error ? error.message : "The action was refused", MAX_TOAST_CHARS2) }));
    return orDeferred(running, "Dispatching…");
  };
  const saveMemory = async (_scope, event) => {
    const reply = replyTextOf(event);
    if (reply.trim() === "")
      return { toast: "Nothing to save" };
    const description = clip3(reply.split(`
`).map((line) => line.trim()).find((line) => line !== "") ?? reply, MAX_MEMORY_DESCRIPTION_CHARS);
    return callTool(MEMORY_WRITE_TOOL, { title: description, description, content: reply.slice(0, MAX_MEMORY_CONTENT_CHARS), kind: "note" }, "Saved to memory");
  };
  const copyReply = async (_scope, event) => {
    const reply = replyTextOf(event);
    if (reply === "")
      return { toast: "Nothing to copy" };
    return { copy: reply.slice(0, MAX_COPY_CHARS) };
  };
  return { [DSHGO_DISPATCH_ACTION]: dispatch, [DSHGO_SAVE_MEMORY_ACTION]: saveMemory, [DSHGO_COPY_REPLY_ACTION]: copyReply };
}
function registerDshGoSurfaces(options) {
  const log = options.log ?? ((line) => {
    rowLogLine("mpd-bundle", line);
  });
  const pollMs = options.pollMs ?? DSHGO_POLL_MS;
  let registered = false;
  let announced = false;
  let offBound;
  const timers = new Set;
  const data = (scope, emit, caps) => {
    const send = typeof emit === "function" ? emit : undefined;
    let last = "";
    const tick = () => {
      const value = probe3(() => stripValueOf(options, scope, caps), null);
      if (value === null)
        return;
      const serialized = JSON.stringify(value);
      if (serialized === last)
        return;
      last = serialized;
      probe3(() => send?.(value), undefined);
    };
    tick();
    const timer = setInterval(tick, pollMs);
    timers.add(timer);
    return () => {
      clearInterval(timer);
      timers.delete(timer);
    };
  };
  const attempt = () => {
    if (registered)
      return;
    const present = probe3(() => options.dsh.dshGoPresent() === true, false);
    if (!present) {
      if (offBound === undefined) {
        offBound = probe3(() => {
          const off = options.dsh.onServiceBound(["dshGo"], () => {
            attempt();
          });
          return typeof off === "function" ? off : () => {};
        }, () => {});
      }
      return;
    }
    const strip = probe3(() => options.dsh.dshGoStrip?.(DSHGO_STRIP_ID, data) === true, false);
    const surfaceActions = createSurfaceActions(options);
    let accepted = 0;
    for (const [id, handler] of Object.entries(surfaceActions)) {
      if (probe3(() => options.dsh.dshGoOn?.(id, handler) === true, false))
        accepted += 1;
    }
    registered = strip || accepted > 0;
    if (!announced) {
      announced = true;
      log("[mpd] dshGo=surfaces strip=" + (strip ? "on" : "off") + " actions=" + String(accepted));
    }
  };
  attempt();
  return {
    registered,
    dispose: () => {
      for (const timer of timers)
        clearInterval(timer);
      timers.clear();
      probe3(() => offBound?.(), undefined);
      offBound = undefined;
    }
  };
}

// packages/mpd-bundle-plugin/src/index.ts
var name = "@mpd-dsh/mpd";
var inject = [];
function workspaceResolver(ctx) {
  const rootsAll = () => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined;
      const roots = typeof adapter?.workspaceRootsAll === "function" ? adapter.workspaceRootsAll() : undefined;
      if (Array.isArray(roots) && roots.length > 0) {
        return roots.filter((root2) => typeof root2 === "string" && root2 !== "");
      }
    } catch {}
    const fromEnv = typeof process.env.DSH_WORKSPACE_ROOT === "string" ? process.env.DSH_WORKSPACE_ROOT : "";
    return [fromEnv !== "" ? fromEnv : process.cwd()];
  };
  const root = () => {
    try {
      const adapter = typeof ctx?.get === "function" ? ctx.get("mpdDsh", false) : undefined;
      const one = typeof adapter?.workspaceRoot === "function" ? adapter.workspaceRoot() : undefined;
      if (typeof one === "string" && one !== "")
        return one;
    } catch {}
    return rootsAll()[0] ?? process.cwd();
  };
  return { workspaceRootsAll: rootsAll, workspaceRoot: root };
}
function stateDirResolver(ctx) {
  return () => {
    try {
      const config = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined;
      const value = typeof config?.get === "function" ? config.get("team.stateDir") : undefined;
      if (typeof value === "string" && value.trim() !== "")
        return value.trim();
    } catch {}
    return DEFAULT_TEAM_STATE_DIR;
  };
}
function webServerOf(dsh, ctx) {
  if (dsh !== undefined && typeof dsh.webServerOf === "function") {
    try {
      return dsh.webServerOf();
    } catch {
      return;
    }
  }
  return;
}
function apply(ctx) {
  const dsh = resolveDshAdapter(ctx);
  let registered = false;
  const registerRoutes = () => {
    if (registered)
      return true;
    if (typeof ctx?.effect !== "function")
      return false;
    const webServer = webServerOf(dsh, ctx);
    if (webServer === undefined || typeof webServer.register !== "function")
      return false;
    const workspace = workspaceResolver(ctx);
    const result = registerWatchdogRoutes(webServer, {
      roots: () => workspace.workspaceRootsAll(),
      stateDir: stateDirResolver(ctx),
      effect: (fn, label) => ctx.effect(fn, label)
    });
    if (!result.state) {
      rowLogLine("mpd-bundle", "[mpd] the web server refused the watchdog routes — the stuck-team banner has no data source");
      return false;
    }
    const modelConfig = registerModelConfigRoute(webServer, {
      config: () => {
        try {
          const service = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined;
          return service !== null && typeof service === "object" ? service : undefined;
        } catch {
          return;
        }
      },
      effect: (fn, label) => ctx.effect(fn, label)
    });
    if (!modelConfig)
      rowLogLine("mpd-bundle", "[mpd] the web server refused the model-config route — the settings card shows the document values only");
    registered = true;
    return true;
  };
  registerRoutes();
  if (dsh !== undefined && typeof dsh.onServiceBound === "function") {
    dsh.onServiceBound(["webServer", "httpServer"], () => {
      registerRoutes();
    });
  }
  const memoryScopeOf = () => {
    const config = typeof ctx?.get === "function" ? ctx.get("mpdConfig", false) : undefined;
    if (config === null || typeof config !== "object")
      return;
    const read = config.get;
    if (typeof read !== "function")
      return;
    const dir = read.call(config, "memory.dir");
    const agentSlug = read.call(config, "memory.agentSlug");
    return { dir: typeof dir === "string" ? dir : undefined, agentSlug: typeof agentSlug === "string" ? agentSlug : undefined };
  };
  try {
    const panel = registerDshGoPanel({
      dsh,
      ctx,
      memory: memoryScopeOf(),
      log: (line) => {
        rowLogLine("mpd-bundle", line);
      }
    });
    const teamPanel = registerDshGoTeamPanel({
      dsh,
      ctx,
      log: (line) => {
        rowLogLine("mpd-bundle", line);
      }
    });
    const surfaces = registerDshGoSurfaces({
      dsh,
      ctx,
      log: (line) => {
        rowLogLine("mpd-bundle", line);
      }
    });
    if (typeof ctx?.effect === "function") {
      try {
        ctx.effect(() => () => {
          panel.dispose();
          teamPanel.dispose();
          surfaces.dispose();
        }, "mpd-dshgo-panel");
      } catch {}
    }
  } catch {}
}
export {
  WATCHDOG_WEB_READER,
  apply,
  inject,
  name
};
