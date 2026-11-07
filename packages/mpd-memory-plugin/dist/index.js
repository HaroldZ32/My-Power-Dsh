// packages/mpd-memory-plugin/src/index.ts
import { existsSync as existsSync3, readFileSync as readFileSync4, readdirSync as readdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, join as join4 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
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
var DSH_SEAM_TOOLS = "tools";
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

class HomeGuardRefusal extends Error {
  code;
  status;
  constructor(code, message, status) {
    super(message);
    this.name = "HomeGuardRefusal";
    this.code = code;
    this.status = status;
  }
}
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
    if (api !== "" && resolve2(api) !== resolve2(process.env.HOME ?? api))
      return api;
  } catch {}
  return;
}
function assertHomeMutationSandboxed(guard) {
  const dshHome = process.env.DSH_HOME;
  if (dshHome === undefined || dshHome === "")
    return;
  if (process.env[guard.allowEnv] === "1")
    return;
  const home = process.env.HOME;
  const realHome = realUserHome();
  const inside = (h) => guard.root === h || guard.root.startsWith(h.endsWith(sep2) ? h : h + sep2);
  if (home !== undefined && home !== "" && realHome !== undefined && resolve2(home) !== resolve2(realHome) && inside(resolve2(home)))
    return;
  throw new HomeGuardRefusal("real-home-refused", guard.label + ": refusing to " + guard.operation + " inside the REAL library " + guard.root + " while DSH_HOME=" + dshHome + " marks an isolated/QA boot — set HOME=<sandbox> (T-43), or set " + guard.allowEnv + "=1 to override deliberately" + (realHome === undefined ? " (the real home could not be determined on this host)" : ""), 403);
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
var VIEW_KEY = "dsh-go/view";
var BUDGETS = Object.freeze({
  toolCard: Object.freeze({ bytes: 8192, nodes: 40, depth: 6 }),
  panel: Object.freeze({ bytes: 32768, nodes: 120, depth: 8 }),
  strip: Object.freeze({ bytes: 2048, nodes: 8, depth: 3 })
});
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
function row(children, props = {}) {
  assertList("row", "children", children, MAX_CHILDREN);
  return node("row", { children, title: props.title, style: styleOf(props.style) });
}
function text(value, props = {}) {
  return node("text", { text: value, tone: props.tone, style: styleOf(props.style) });
}
function metric(props) {
  return node("metric", { label: props.label, value: props.value, tone: props.tone, caption: props.caption, style: styleOf(props.style) });
}
function table(props) {
  assertList("table", "columns", props.columns, 8);
  const rows = assertList("table", "rows", props.rows, 50);
  for (const cells of rows)
    assertList("table", "row cells", cells, props.columns.length);
  return node("table", { columns: props.columns, rows });
}
function keyValue(items, props = {}) {
  assertList("keyValue", "items", items, 24);
  return node("keyValue", { items, title: props.title, style: styleOf(props.style) });
}
function callout(value, props = {}) {
  return node("callout", { text: value, tone: props.tone, style: styleOf(props.style) });
}
function countViewNodes(view) {
  let nodes = 0;
  for (const _found of componentNodes(view))
    nodes += 1;
  return nodes;
}
function viewDepth(view) {
  let depth = 0;
  for (const found of componentNodes(view))
    depth = Math.max(depth, found.depth);
  return depth;
}
function measureView(view) {
  const encoded = JSON.stringify(view);
  const bytes = encoded === undefined ? 0 : new TextEncoder().encode(encoded).length;
  return { bytes, nodes: countViewNodes(view), depth: viewDepth(view) };
}
function fitsBudget(view, budget) {
  const target = typeof budget === "string" ? BUDGETS[budget] : budget;
  const measured = measureView(view);
  return measured.bytes <= target.bytes && measured.nodes <= target.nodes && measured.depth <= target.depth;
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
function losslessJson(value) {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  } catch {
    return;
  }
}
function hasBinding(value) {
  if (isBinding(value))
    return true;
  if (Array.isArray(value))
    return value.some(hasBinding);
  if (isRecord2(value))
    return Object.values(value).some(hasBinding);
  return false;
}
function hasV2Component(value) {
  for (const found of componentNodes(value)) {
    if (V2_ONLY_COMPONENTS.includes(found.node.type))
      return true;
  }
  return false;
}
function toolCard(build) {
  return (args, value) => {
    try {
      const built = losslessJson(build(args, value));
      if (!isNode(built))
        return {};
      const view = built;
      if (view.accent !== undefined)
        return {};
      if (view.v === 2 || hasV2Component(view))
        return {};
      if (hasBinding(view))
        return {};
      if (!fitsBudget(view, "toolCard"))
        return {};
      return { [VIEW_KEY]: view };
    } catch {
      return {};
    }
  };
}

// packages/mpd-memory-plugin/src/dshgo-cards.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordOf(value) {
  return isRecord3(value) ? value : {};
}
function recordsAt(source, key) {
  const raw = source[key];
  return Array.isArray(raw) ? raw.filter(isRecord3) : [];
}
function stringOf(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback;
}
function numberOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function clip(value, max) {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}
function tail(value, max) {
  return value.length <= max ? value : "…" + value.slice(value.length - (max - 1));
}
function buildMemoryWriteCard(_args, value) {
  const v = recordOf(value);
  const committedTo = Array.isArray(v.committedTo) ? v.committedTo.map(String) : [];
  const errors = Array.isArray(v.errors) ? v.errors.map(String).filter((line) => line !== "") : [];
  const reflectionDue = v.reflectionDue === true;
  const children = [
    row([
      metric({ label: "Scope", value: stringOf(v.scope, "workspace") }),
      metric({ label: "Reflection", value: reflectionDue ? "due" : "not due", tone: reflectionDue ? "warn" : "muted" })
    ]),
    keyValue([
      ["File", tail(stringOf(v.file, "(unknown)"), 80)],
      ["VCS", stringOf(v.vcs, "git")],
      ["Committed to", committedTo.length === 0 ? "none" : committedTo.join(", ")]
    ])
  ];
  if (errors.length > 0)
    children.push(callout(clip("commit failed: " + errors.join("; "), 400), { tone: "warn" }));
  return stack(children, { title: "Memory written" });
}
function buildMemoryReadCard(_args, value) {
  const v = recordOf(value);
  const entries = recordsAt(v, "entries");
  const nextOffset = v.next_offset === null || v.next_offset === undefined ? "end" : String(v.next_offset);
  const children = [
    row([
      metric({ label: "Matched", value: numberOf(v.count) }),
      metric({ label: "Returned", value: numberOf(v.returned) }),
      metric({ label: "Next offset", value: nextOffset })
    ])
  ];
  if (entries.length === 0) {
    children.push(text("No memory entries matched."));
  } else {
    children.push(table({
      columns: ["Kind", "Description"],
      rows: entries.slice(0, 20).map((entry) => [clip(stringOf(entry.kind, "note"), 12), clip(stringOf(entry.description, "(untitled)"), 80)])
    }));
  }
  return stack(children, { title: "Memory entries" });
}
function buildMemoryStatusCard(_args, value) {
  const v = recordOf(value);
  const reflection = recordOf(v.reflection);
  const reflectionsCompleted = numberOf(reflection.reflectionsCompleted);
  const stepsSince = numberOf(reflection.stepsSinceReflection);
  const children = [
    row([
      metric({ label: "Entries", value: numberOf(v.entries) }),
      metric({ label: "Journal lines", value: numberOf(v.journalLines) }),
      metric({ label: "Reflections", value: reflectionsCompleted })
    ]),
    keyValue([
      ["VCS", stringOf(v.vcs, "git")],
      ["Scope", stringOf(v.scope, "workspace")],
      ["Root", tail(stringOf(v.root, "(unknown)"), 80)],
      ["Steps since reflection", stepsSince]
    ])
  ];
  return stack(children, { title: "Memory status" });
}
var MEMORY_WRITE_CARD = toolCard(buildMemoryWriteCard);
var MEMORY_READ_CARD = toolCard(buildMemoryReadCard);
var MEMORY_STATUS_CARD = toolCard(buildMemoryStatusCard);

// packages/mpd-memory-plugin/src/store.ts
import { existsSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join as join2, resolve as resolve3, sep as sep3 } from "node:path";
import { spawnSync } from "node:child_process";
function homeDir() {
  return process.env.HOME || homedir();
}
function globalRoot(config) {
  return config.globalDir ?? join2(homeDir(), ".mpd", "memory");
}
function globalDirs(config) {
  const root = globalRoot(config);
  const repo = join2(root, "repo");
  const runtime = join2(root, "runtime");
  const memoryDir = join2(repo, "memory");
  return { root, repo, runtime, memoryDir };
}
function ensureGlobalDirs(config) {
  const d = globalDirs(config);
  mkdirSync2(d.memoryDir, { recursive: true });
  mkdirSync2(d.runtime, { recursive: true });
  return d;
}
var MEMORY_ALLOW_REAL_HOME_ENV = "MPD_DSH_MEMORY_ALLOW_REAL_HOME";
function assertMemoryMutationSandboxed(root, operation) {
  assertHomeMutationSandboxed({ root, operation, label: "mpd_memory", allowEnv: MEMORY_ALLOW_REAL_HOME_ENV });
}
function slugOf(config, workspace) {
  if (config.agentSlug)
    return config.agentSlug;
  const base = basename(workspace);
  return "agent-" + base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
}
function agentPaths(config, workspace) {
  const slug = slugOf(config, workspace);
  const root = join2(workspace, config.dir ?? ".mpd", "memory", "agents", slug);
  const repo = join2(root, "repo");
  const runtime = join2(root, "runtime");
  const memoryDir = join2(repo, "memory");
  return { root, repo, runtime, memoryDir, slug };
}
function ensureDirs(config, workspace) {
  const d = agentPaths(config, workspace);
  mkdirSync2(d.memoryDir, { recursive: true });
  mkdirSync2(d.runtime, { recursive: true });
  return d;
}
function scopeOf(args) {
  const a = args !== null && typeof args === "object" ? args : undefined;
  return a?.scope === "global" ? "global" : "workspace";
}
function journalPath(d) {
  return join2(d.runtime, "journal.jsonl");
}
function appendJournalLine(d, kind, detail) {
  appendFileSync(journalPath(d), JSON.stringify({ at: new Date().toISOString(), kind, ...detail }) + `
`);
}
function run(cmd, args, cwdDir) {
  const r = spawnSync(cmd, args, { cwd: cwdDir, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: process.env });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.error)
    return { ok: false, out: "spawn error: " + String(r.error.message ?? r.error) };
  return { ok: r.status === 0, out };
}
function gitEnsure(repo) {
  if (!existsSync(join2(repo, ".git"))) {
    const r = run("git", ["init", "-q"], repo);
    if (!r.ok)
      throw new Error("mpd-memory: git init failed: " + r.out);
    run("git", ["config", "user.name", "mpd-memory"], repo);
    run("git", ["config", "user.email", "mpd-memory@local"], repo);
  }
  return "git";
}
function svnEnsure(root, repo) {
  const svnRepo = join2(root, "svn-repo");
  const url = "file://" + svnRepo;
  if (!existsSync(join2(svnRepo, "db"))) {
    const r = run("svnadmin", ["create", svnRepo], root);
    if (!r.ok)
      throw new Error("mpd-memory: svnadmin create failed: " + r.out);
  }
  if (!existsSync(join2(repo, ".svn"))) {
    mkdirSync2(dirname(repo), { recursive: true });
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
  const raw = readFileSync2(file, "utf8");
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
function safeMemoryPath(memoryDir, name) {
  const base = resolve3(memoryDir);
  const target = resolve3(base, name);
  if (!target.startsWith(base + sep3))
    throw new Error("mpd-memory: path escapes memory dir: " + name);
  return target;
}

// packages/mpd-memory-plugin/src/archive.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync3, readdirSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join3, resolve as resolve4 } from "node:path";
var TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
var FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
var SECTION_BOUNDARY = /^#{1,2}(?:[ \t]+|$)/;
var CHECKBOX_ITEM = /^ {0,3}[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
var FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
function installArchiveHook(dsh, contextOf) {
  try {
    const dispose = dsh.onPostToolExecute((exec, result) => {
      try {
        const call = exec ?? {};
        const settled = result ?? {};
        const args = call.arguments !== null && typeof call.arguments === "object" ? call.arguments : undefined;
        handleArchiveCall(contextOf(exec), String(call.name ?? ""), args, settled);
      } catch (error) {
        rowLogLine("mpd-memory", "[mpd-memory] archive hook listener failed: " + String(error?.message ?? error));
      }
      return;
    });
    return typeof dispose === "function" ? dispose : () => {};
  } catch (error) {
    rowLogLine("mpd-memory", "[mpd-memory] archive hook could not be installed: " + String(error?.message ?? error));
    return () => {};
  }
}
function handleArchiveCall(context, toolName, args, result, log = (line) => {
  rowLogLine("mpd-memory", "[mpd-memory] " + line);
}) {
  try {
    const event = matchArchiveEvent(context, toolName, args, result, log);
    if (event === null)
      return null;
    const outcome = writeArchiveEntry(context, event);
    if (outcome.errors.length > 0)
      log("project memory " + outcome.key + " was written but its commit reported: " + outcome.errors.join("; "));
    return outcome;
  } catch (error) {
    log("project-archive memory was not written for " + toolName + ": " + String(error?.message ?? error));
    return null;
  }
}
function matchArchiveEvent(context, toolName, args, result, log) {
  if (result.isError === true)
    return null;
  const value = result.value !== null && typeof result.value === "object" ? result.value : undefined;
  if (toolName === "mpd_boulder_complete") {
    const workId = textOf(value?.workId) || textOf(args?.workId);
    return workId === "" ? null : { kind: "boulder_complete", projectKey: workId };
  }
  if (toolName === "cellwork_stop") {
    if (value?.ok === false)
      return null;
    const cellId = textOf(value?.cellId);
    return cellId === "" ? null : { kind: "cellwork_stop", projectKey: cellId };
  }
  if (toolName === "agent_teams_plan") {
    if (textOf(args?.action) !== "delete")
      return null;
    const archivedTo = textOf(value?.archivedTo);
    if (archivedTo === "")
      return null;
    if (context.teams === undefined) {
      log("agent_teams_plan archived a plan but the mpdTeams service is absent — no project memory was written");
      return null;
    }
    const plan = findArchivedPlan(context, archivedTo, log);
    if (plan === undefined)
      return null;
    if (textOf(plan.approvedAt) === "")
      return null;
    return { kind: "team_plan_archive", projectKey: textOf(plan.teamId) || plan.planId, plan };
  }
  return null;
}
function writeArchiveEntry(context, event) {
  assertMemoryMutationSandboxed(globalRoot(context.config), "record a global project-archive memory");
  const d = ensureGlobalDirs(context.config);
  ensureVcs(context.config, d);
  const at = new Date().toISOString();
  const key = resolve4(context.workspace) + ":" + event.projectKey;
  const index = readIndex(d);
  const previous = Object.prototype.hasOwnProperty.call(index.entries, key) ? index.entries[key] : undefined;
  const fileName = "project-" + slugForFile(event.projectKey) + "-" + shortHash(resolve4(context.workspace)) + ".md";
  const file = safeMemoryPath(d.memoryDir, fileName);
  const digest = digestFor(context, event);
  writeFileSync(file, frontmatterFor(event) + renderDigest(event, context.workspace, at, digest));
  appendJournalLine(d, "archive", { eventKind: event.kind, projectKey: event.projectKey, key, file: fileName });
  if (previous !== undefined)
    appendJournalLine(d, "superseded", { by: event.kind, key, file: fileName, previous: previous.eventKind });
  index.entries[key] = { key, workspace: resolve4(context.workspace), projectKey: event.projectKey, eventKind: event.kind, file: fileName, at, superseded: (previous?.superseded ?? 0) + (previous === undefined ? 0 : 1) };
  writeIndex(d, index);
  const errors = commitAll(context.config, d, "memory: project archive " + event.projectKey + " (" + event.kind + ")");
  return { key, file, superseded: previous !== undefined, errors };
}
function digestFor(context, event) {
  const digest = event.kind === "boulder_complete" ? boulderDigest(context.workspace, event.projectKey) : event.kind === "cellwork_stop" ? cellDigest(context, event.projectKey) : planDigest(context, event);
  const proof = proofLines(context.workspace);
  digest.proof = proof.lines;
  digest.unreadable.push(...proof.unreadable);
  return digest;
}
function boulderDigest(workspace, workId) {
  const digest = { objective: "boulder work " + workId, tasks: [], scopes: [], open: [], proof: [], unreadable: [] };
  const ledger = readJsonFile(join3(workspace, ".mpd", "boulder.json"));
  if (ledger.problem !== undefined) {
    digest.unreadable.push(".mpd/boulder.json (" + ledger.problem + ")");
    return digest;
  }
  const works = ledger.value?.works;
  const work = works !== null && typeof works === "object" && Object.prototype.hasOwnProperty.call(works, workId) ? works[workId] : undefined;
  if (work === null || typeof work !== "object") {
    digest.unreadable.push('.mpd/boulder.json holds no work "' + workId + '"');
    return digest;
  }
  const planPath = textOf(work.active_plan);
  const planName = textOf(work.plan_name);
  const elapsed = typeof work.elapsed_ms === "number" ? work.elapsed_ms : undefined;
  digest.objective = "boulder work " + workId + (planName === "" ? "" : ' ("' + planName + '")') + " completed" + (elapsed === undefined ? "" : " after " + String(elapsed) + "ms");
  const items = planPath === "" ? undefined : planItems(join3(workspace, planPath));
  if (items === undefined) {
    digest.unreadable.push(planPath === "" ? "the boulder work names no plan file" : planPath + " (unreadable)");
  } else {
    digest.tasks = capList(items.titles, 12);
    if (items.remaining > 0)
      digest.open.push(String(items.remaining) + " plan item(s) still unticked in " + planPath);
  }
  const timers = work.task_sessions !== null && typeof work.task_sessions === "object" ? work.task_sessions : undefined;
  if (timers !== undefined) {
    for (const [key, timer] of Object.entries(timers)) {
      const title = textOf(timer?.task_title) || String(key);
      if (digest.tasks.length === 0)
        digest.tasks.push(title);
      const status = textOf(timer?.status);
      if (status !== "" && status !== "completed")
        digest.open.push("task timer " + String(key) + " (" + title + ") is " + status);
    }
  }
  return digest;
}
function cellDigest(context, cellId) {
  const digest = { objective: "cell " + cellId, tasks: [], scopes: [], open: [], proof: [], unreadable: [] };
  const cell = readJsonFile(join3(context.workspace, ".mpd", "cellwork", cellId, "state.json"));
  if (cell.problem !== undefined) {
    digest.unreadable.push(".mpd/cellwork/" + cellId + "/state.json (" + cell.problem + ")");
    return digest;
  }
  const objective = textOf(cell.value?.objective);
  const stopReason = textOf(cell.value?.stopReason);
  digest.objective = "cell " + cellId + (objective === "" ? "" : ' ("' + objective + '")') + " stopped" + (stopReason === "" ? "" : ": " + stopReason);
  if (stopReason !== "")
    digest.open.push("stopReason: " + stopReason);
  const teamId = textOf(cell.value?.teamId);
  const splitRevision = typeof cell.value?.splitRevision === "number" ? cell.value.splitRevision : undefined;
  if (teamId !== "") {
    const record = context.teams?.get?.(context.workspace, teamId);
    if (record === undefined)
      digest.unreadable.push("the team record " + teamId + " (mpdTeams.get absent or unknown)");
    else
      mergeTeamRecord(digest, record);
  } else if (splitRevision !== undefined) {
    const split = readJsonFile(join3(context.workspace, ".mpd", "cellwork", cellId, "split", String(splitRevision) + ".json"));
    if (split.problem !== undefined)
      digest.unreadable.push(".mpd/cellwork/" + cellId + "/split/" + String(splitRevision) + ".json (" + split.problem + ")");
    else
      mergeSplit(digest, split.value);
  } else {
    digest.unreadable.push("cell " + cellId + " approved no team and accepted no split — no task titles exist");
  }
  return digest;
}
function planDigest(context, event) {
  const digest = { objective: "team plan " + (event.plan?.planId ?? event.projectKey), tasks: [], scopes: [], open: [], proof: [], unreadable: [] };
  const plan = event.plan === undefined ? { problem: "the mpdTeams service named no plan document" } : readJsonFile(event.plan.path);
  if (plan.problem !== undefined) {
    digest.unreadable.push((event.plan?.path ?? "the archived plan") + " (" + plan.problem + ")");
  } else {
    const planName = textOf(plan.value?.name);
    const description = textOf(plan.value?.description);
    digest.objective = "team plan " + textOf(plan.value?.planId) + (planName === "" ? "" : ' ("' + planName + '")') + " approved at " + textOf(plan.value?.approvedAt) + " and archived";
    if (description !== "")
      digest.objective += ": " + description;
    const staged = Array.isArray(plan.value?.tasks) ? plan.value.tasks : [];
    digest.tasks = capList(staged.map((task) => textOf(task?.subject)).filter((title) => title !== ""), 12);
    digest.scopes = capList(uniqueStrings(staged.flatMap((task) => Array.isArray(task?.writeScopes) ? task.writeScopes.map(textOf) : [])), 20);
    const unresolved = Array.isArray(plan.value?.created?.unresolved) ? plan.value.created.unresolved : [];
    for (const row2 of unresolved) {
      const taskId = textOf(row2?.taskId);
      const references = Array.isArray(row2?.references) ? row2.references.map(textOf).filter((r) => r !== "") : [];
      if (taskId !== "" && references.length > 0)
        digest.open.push("unresolved blocker reference(s) on " + taskId + ": " + references.join(", "));
    }
  }
  if (context.teams === undefined)
    digest.unreadable.push("the team record (mpdTeams absent)");
  else {
    const teamId = textOf(event.plan?.teamId);
    const record = teamId === "" ? undefined : context.teams.get?.(context.workspace, teamId);
    if (record === undefined)
      digest.unreadable.push("the live team record " + (teamId === "" ? "(the plan names no team)" : teamId));
    else
      mergeTeamRecord(digest, record);
  }
  return digest;
}
function mergeTeamRecord(digest, record) {
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  const titles = digest.tasks.concat(tasks.map((task) => textOf(task.subject)).filter((title) => title !== ""));
  digest.tasks = capList(uniqueStrings(titles), 12);
  const scopes = digest.scopes.concat(tasks.flatMap((task) => Array.isArray(task.writeScopes) ? task.writeScopes.map(textOf) : []));
  digest.scopes = capList(uniqueStrings(scopes), 20);
  for (const task of tasks) {
    const status = textOf(task.status);
    if (status === "completed")
      continue;
    const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy.map(textOf).filter((id) => id !== "") : [];
    digest.open.push(textOf(task.id) + (textOf(task.subject) === "" ? "" : " (" + textOf(task.subject) + ")") + " status=" + (status === "" ? "unknown" : status) + (blockedBy.length === 0 ? "" : ", blocked by " + blockedBy.join(", ")));
  }
}
function mergeSplit(digest, split) {
  const tasks = Array.isArray(split?.tasks) ? split.tasks : [];
  digest.tasks = capList(tasks.map((task) => textOf(task?.subject)).filter((title) => title !== ""), 12);
  digest.scopes = capList(uniqueStrings(tasks.flatMap((task) => Array.isArray(task?.writeScopes) ? task.writeScopes.map(textOf) : [])), 20);
  for (const task of tasks) {
    if (task?.accepted === true)
      continue;
    digest.open.push("split task " + textOf(task?.key) + " (" + textOf(task?.subject) + ") was not accepted");
  }
  const findings = Array.isArray(split?.findings) ? split.findings : [];
  for (const finding of findings.slice(0, 5))
    digest.open.push("split finding: " + textOf(finding?.message ?? finding?.kind));
}
function proofLines(workspace) {
  const lines = [];
  const unreadable = [];
  const verify = join3(workspace, ".mpd", "verify");
  const loops = newestJsonFiles(join3(verify, "loops")).slice(0, 5);
  if (loops.length === 0)
    lines.push("no verify loops recorded under .mpd/verify/loops");
  for (const name of loops) {
    const loop = readJsonFile(join3(verify, "loops", name));
    if (loop.problem !== undefined) {
      unreadable.push(".mpd/verify/loops/" + name + " (" + loop.problem + ")");
      continue;
    }
    lines.push("verify loop " + textOf(loop.value?.loopId) + " status=" + (textOf(loop.value?.status) || "unknown") + (textOf(loop.value?.verifier?.id) === "" ? "" : " verifier=" + textOf(loop.value?.verifier?.id)));
  }
  const records = newestJsonFiles(join3(verify, "records")).slice(0, 5);
  if (records.length === 0)
    lines.push("no verdict records under .mpd/verify/records");
  for (const name of records) {
    const record = readJsonFile(join3(verify, "records", name));
    if (record.problem !== undefined) {
      unreadable.push(".mpd/verify/records/" + name + " (" + record.problem + ")");
      continue;
    }
    lines.push("verdict " + textOf(record.value?.recordId) + " " + (textOf(record.value?.verdict) || "unknown") + (textOf(record.value?.loopId) === "" ? "" : " on " + textOf(record.value?.loopId)));
  }
  const evidence = newestJsonFiles(join3(verify, "evidence")).slice(0, 5);
  if (evidence.length === 0)
    lines.push("no evidence rows under .mpd/verify/evidence");
  for (const name of evidence)
    lines.push("evidence .mpd/verify/evidence/" + name);
  const gatesPath = join3(workspace, "mpd-gates.json");
  if (!existsSync2(gatesPath))
    lines.push("gate table mpd-gates.json absent (the built-in gate table applies)");
  else {
    try {
      const bytes = readFileSync3(gatesPath);
      lines.push("gate table mpd-gates.json sha256=" + createHash("sha256").update(bytes).digest("hex") + " bytes=" + String(bytes.length));
    } catch (error) {
      unreadable.push("mpd-gates.json (" + String(error?.message ?? error) + ")");
    }
  }
  return { lines, unreadable };
}
function planItems(planPath) {
  let text2;
  try {
    text2 = readFileSync3(planPath, "utf8");
  } catch {
    return;
  }
  const titles = [];
  let remaining = 0;
  let section = "other";
  let structured = false;
  let fence = "";
  for (const line of text2.split(`
`)) {
    const opener = FENCE_OPEN.exec(line);
    if (opener !== null) {
      if (fence === "")
        fence = opener[1];
      else if (line.trimStart().startsWith(fence))
        fence = "";
      continue;
    }
    if (fence !== "")
      continue;
    if (TODO_HEADING.test(line)) {
      section = "todo";
      structured = true;
      continue;
    }
    if (FINAL_WAVE_HEADING.test(line)) {
      section = "final-wave";
      structured = true;
      continue;
    }
    if (SECTION_BOUNDARY.test(line)) {
      section = "other";
      continue;
    }
    const box = CHECKBOX_ITEM.exec(line);
    if (box === null)
      continue;
    if (structured && section === "other")
      continue;
    const label = box[2].trim();
    if (label === "")
      continue;
    titles.push(label);
    if (box[1] === "")
      remaining += 1;
  }
  return { titles, remaining };
}
function findArchivedPlan(context, archivedTo, log) {
  const dir = resolve4(archivedTo);
  let plans = [];
  try {
    plans = context.teams?.archivedPlans(context.workspace) ?? [];
  } catch {
    plans = [];
  }
  const match = plans.find((plan) => dirname2(resolve4(plan.path)) === dir);
  if (match === undefined)
    log("agent_teams_plan reported archive " + dir + " but the mpdTeams listing does not contain it — no project memory was written");
  return match;
}
function renderDigest(event, workspace, at, digest) {
  const lines = [];
  lines.push("# " + event.projectKey);
  lines.push("");
  lines.push("event: " + event.kind);
  lines.push("workspace: " + resolve4(workspace));
  lines.push("archived: " + at);
  lines.push("");
  lines.push("## What was built");
  lines.push(digest.objective);
  if (digest.tasks.length === 0)
    lines.push("- no task titles in the readable sources above");
  for (const task of digest.tasks)
    lines.push("- " + task);
  lines.push("");
  lines.push("## Proof");
  for (const line of digest.proof)
    lines.push("- " + line);
  lines.push("");
  lines.push("## Where");
  if (digest.scopes.length === 0)
    lines.push("- the event's sources declare no write scopes");
  for (const scope of digest.scopes)
    lines.push("- " + scope);
  lines.push("");
  lines.push("## Open");
  if (digest.open.length === 0)
    lines.push("- nothing unresolved in the sources this digest could read");
  for (const item of digest.open)
    lines.push("- " + item);
  if (digest.unreadable.length > 0) {
    lines.push("");
    lines.push("## Unreadable");
    for (const item of digest.unreadable)
      lines.push("- " + item);
  }
  return lines.join(`
`) + `
`;
}
function frontmatterFor(event) {
  const meta = { description: "project archive: " + event.projectKey + " (" + event.kind + ")", kind: "fact", scope: "global", tags: ["project", "archive", event.kind] };
  return `---
` + JSON.stringify(meta) + `
---
`;
}
function readIndex(d) {
  const reading = readJsonFile(join3(d.runtime, "index.json"));
  if (reading.problem !== undefined || reading.value?.version !== 1 || reading.value?.entries === null || typeof reading.value?.entries !== "object") {
    return { version: 1, entries: {} };
  }
  return { version: 1, entries: reading.value.entries };
}
function writeIndex(d, index) {
  writeFileSync(join3(d.runtime, "index.json"), JSON.stringify(index, null, 2));
}
function readJsonFile(path) {
  try {
    return { value: JSON.parse(readFileSync3(path, "utf8")) };
  } catch (error) {
    const message = String(error?.message ?? error);
    return { problem: message.includes("ENOENT") ? "absent" : message };
  }
}
function newestJsonFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().reverse();
  } catch {
    return [];
  }
}
function textOf(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}
function uniqueStrings(items) {
  return Array.from(new Set(items.filter((item) => item !== ""))).sort();
}
function capList(items, max) {
  return items.length <= max ? items : [...items.slice(0, max), "… and " + String(items.length - max) + " more"];
}
function slugForFile(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
}
function shortHash(text2) {
  return createHash("sha1").update(text2).digest("hex").slice(0, 8);
}

// packages/mpd-memory-plugin/src/index.ts
var name = "mpd-memory";
var inject = dshSeamInject(DSH_SEAM_TOOLS);
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
    reflectionEvery: typeof v("memory.reflectionEvery") === "number" ? v("memory.reflectionEvery") : config.reflectionEvery,
    globalDir: typeof v("memory.globalDir") === "string" ? v("memory.globalDir") : config.globalDir
  };
}
function initialState() {
  return { steps: 0, reflectionsCompleted: 0, stepsSinceReflection: 0, pendingReflection: null, triggered: false };
}
function adoptLegacyState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const legacyClaim = s.reservation;
  return {
    steps: s.steps ?? 0,
    reflectionsCompleted: s.reflectionsCompleted ?? s.reflected_completed_steps ?? 0,
    stepsSinceReflection: s.stepsSinceReflection ?? s.steps_since_last_successful_reflection ?? 0,
    pendingReflection: s.pendingReflection !== undefined ? s.pendingReflection ?? null : legacyClaim == null || typeof legacyClaim !== "object" ? null : { due: legacyClaim.status === "pending", at: String(legacyClaim.at ?? "") },
    triggered: s.triggered ?? false
  };
}
function apply(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const cfg = mergedConfig(ctx, config);
  const reflectionEvery = cfg.reflectionEvery ?? 10;
  const disposers = [];
  function statePath(d) {
    return join4(d.runtime, "reflection.json");
  }
  function readReflection(d) {
    try {
      return adoptLegacyState(JSON.parse(readFileSync4(statePath(d), "utf8")));
    } catch {
      return initialState();
    }
  }
  function writeReflection(d, s) {
    writeFileSync2(statePath(d), JSON.stringify(s, null, 2));
  }
  function teamsService() {
    const svc = ctx.get?.("mpdTeams");
    return svc !== undefined && svc !== null && typeof svc.archivedPlans === "function" ? svc : undefined;
  }
  function archiveContext(exec) {
    return {
      workspace: dsh.workspaceRoot(exec),
      config: cfg,
      teams: teamsService()
    };
  }
  dsh.registerTool({
    name: "mpd_memory_write",
    description: `Persist a memory entry (markdown file with frontmatter description/kind/aliases/read_only) into the VCS-backed memory store and commit. scope:"workspace" (default, this agent's store) or "global" (the shared ~/.mpd/memory store, guarded: a global write is refused when its root is not inside the sandbox $HOME of an isolated boot, and it never advances the per-agent reflection counter). A workspace write increments the reflection step counter; when the reflection threshold is crossed the result announces a reflection is due. kind: note | fact | reflection.`,
    parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, kind: { type: "string", enum: ["note", "fact", "reflection"] }, tags: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" }, scope: { type: "string", enum: ["workspace", "global"], description: "Which store this entry belongs to; workspace is the default." } }, required: ["title", "content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { file: { type: "string" }, committedTo: { type: "array", items: { type: "string" } }, reflectionDue: { type: "boolean" }, vcs: { type: "string" }, errors: { type: "array", items: { type: "string" } }, scope: { type: "string" } }, required: ["file", "vcs"] }, render: (_a, v) => textBlock("memory written: " + v.file + " (vcs=" + v.vcs + " committed=" + v.committedTo.join(",") + " reflectionDue=" + v.reflectionDue + ")"), presentationMeta: MEMORY_WRITE_CARD },
    execute: async (args, exec) => {
      const scope = scopeOf(args);
      const name2 = String(args?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) + "-" + Date.now().toString(36);
      const meta = { description: String(args?.description ?? args?.title ?? name2), kind: String(args?.kind ?? "note"), tags: Array.isArray(args?.tags) ? args.tags : [] };
      if (args?.readOnly === true)
        meta.read_only = true;
      if (scope === "global") {
        assertMemoryMutationSandboxed(globalDirs(cfg).root, "write a global memory entry");
        const g = ensureGlobalDirs(cfg);
        ensureVcs(cfg, g);
        const globalMeta = { ...meta, scope: "global" };
        const globalFile = safeMemoryPath(g.memoryDir, name2 + ".md");
        const globalFront = `---
` + JSON.stringify(globalMeta) + `
---
`;
        writeFileSync2(globalFile, globalFront + String(args?.content) + (String(args?.content).endsWith(`
`) ? "" : `
`));
        const globalErrs = commitAll(cfg, g, "memory: " + name2 + " (" + globalMeta.kind + ")");
        appendJournalLine(g, "write", { file: basename2(globalFile), kind: globalMeta.kind, vcs: cfg.vcs ?? "git", scope: "global" });
        const wsDirs = agentPaths(cfg, dsh.workspaceRoot(exec));
        const wsState = readReflection(wsDirs);
        return { file: globalFile, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: wsState.triggered === true || wsState.pendingReflection?.due === true, vcs: cfg.vcs ?? "git", errors: globalErrs, scope };
      }
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec));
      ensureVcs(cfg, d);
      const file = safeMemoryPath(d.memoryDir, name2 + ".md");
      const front = `---
` + JSON.stringify(meta) + `
---
`;
      writeFileSync2(file, front + String(args?.content) + (String(args?.content).endsWith(`
`) ? "" : `
`));
      const errs = commitAll(cfg, d, "memory: " + name2 + " (" + meta.kind + ")");
      const ref = readReflection(d);
      ref.steps = (ref.steps ?? 0) + 1;
      ref.stepsSinceReflection = (ref.stepsSinceReflection ?? 0) + 1;
      if ((ref.stepsSinceReflection ?? 0) >= reflectionEvery) {
        ref.triggered = true;
        ref.pendingReflection = { due: true, at: new Date().toISOString() };
      }
      writeReflection(d, ref);
      appendJournalLine(d, "write", { file: basename2(file), kind: meta.kind, vcs: cfg.vcs ?? "git" });
      return { file, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: ref.triggered === true, vcs: cfg.vcs ?? "git", errors: errs, scope };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_read",
    description: 'Read memory entries by optional kind filter and/or a substring query (matched against description/content/tags/aliases), PAGINATED: pass `offset` (default 0) and `limit` (default 20, max 50); the answer carries `count` (the TOTAL matched, not the page), `offset`, `returned` and `next_offset` (the next page\'s offset, or null at the end). Entries come back in a STABLE order: the entry FILE NAME ascending, so successive calls walk every match exactly once. scope:"workspace" (default) reads this agent\'s store, "global" the shared ~/.mpd/memory store; a global read never creates the store.',
    parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, description: "Page size; clamped to 1..50, default 20." }, offset: { type: "integer", minimum: 0, description: "Page start in the matched set; default 0. Pass the previous answer's next_offset to continue." }, scope: { type: "string", enum: ["workspace", "global"], description: "Which store to read; workspace is the default." } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { entries: { type: "array", items: { type: "object" } }, count: { type: "integer" }, offset: { type: "integer" }, returned: { type: "integer" }, next_offset: { oneOf: [{ type: "integer" }, { type: "null" }] }, scope: { type: "string" } }, required: ["entries", "count"] }, render: (_a, v) => textBlock("memory entries: " + v.count + " total, offset=" + v.offset + " returned=" + v.returned + " next=" + (v.next_offset === null ? "end" : v.next_offset) + `
` + v.entries.map((e) => "- [" + (e.kind ?? "note") + "] " + e.description + ": " + e.content.slice(0, 200)).join(`
`)), presentationMeta: MEMORY_READ_CARD },
    execute: async (args, exec) => {
      const scope = scopeOf(args);
      const memoryDir = scope === "global" ? globalDirs(cfg).memoryDir : ensureDirs(cfg, dsh.workspaceRoot(exec)).memoryDir;
      const files = (existsSync3(memoryDir) ? readdirSync2(memoryDir).filter((f) => f.endsWith(".md")) : []).sort();
      let entries = [];
      const kind = args?.kind ? String(args.kind) : null;
      const query = args?.query ? String(args.query).toLowerCase() : null;
      for (const f of files) {
        const p = join4(memoryDir, f);
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
      const offset = Math.max(Math.floor(Number(args?.offset ?? 0)) || 0, 0);
      const page = entries.slice(offset, offset + limit);
      const nextOffset = offset + page.length < entries.length ? offset + page.length : null;
      return { entries: page, count: entries.length, offset, returned: page.length, next_offset: nextOffset, scope };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_reflect",
    description: "Inspect the reflection state machine: trigger status, the pending claim and the step counters; returns the due hint when a reflection is owed. Crossing the step-count threshold raises the claim; `mpd_memory_reflect_complete` settles it.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { state: { type: "object" }, due: { type: "boolean" } }, required: ["state", "due"] }, render: (_a, v) => textBlock("reflection state: " + JSON.stringify(v.state, null, 1) + (v.due ? `
REFLECTION DUE` : "")) },
    execute: async (_args, exec) => {
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec));
      const s = readReflection(d);
      return { state: s, due: s.triggered === true || s.pendingReflection?.due === true };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_reflect_complete",
    description: "Complete the reflection this agent owes: writes the reflection content as a memory entry (kind=reflection), advances reflectionsCompleted, resets stepsSinceReflection, settles the pending claim and commits.",
    parameters: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { completed: { type: "boolean" }, file: { type: "string" } }, required: ["completed", "file"] }, render: (_a, v) => textBlock("reflection completed: " + (v.completed ? "yes" : "no") + " " + v.file) },
    execute: async (args, exec) => {
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec));
      const s = readReflection(d);
      if (s.triggered !== true && s.pendingReflection?.due !== true) {
        throw new Error("mpd-memory: no reflection is due — refusing to complete (triggered=" + String(s.triggered) + ", pendingReflection=" + (s.pendingReflection?.due === false ? "settled" : "none") + ", stepsSinceReflection=" + String(s.stepsSinceReflection ?? 0) + "); call mpd_memory_reflect to inspect the state machine.");
      }
      ensureVcs(cfg, d);
      const name2 = "reflection-" + Date.now().toString(36);
      const file = safeMemoryPath(d.memoryDir, name2 + ".md");
      const meta = { description: String(args?.title ?? "reflection"), kind: "reflection" };
      writeFileSync2(file, `---
` + JSON.stringify(meta) + `
---
` + String(args?.content) + `
`);
      commitAll(cfg, d, "memory: reflection " + name2);
      s.reflectionsCompleted = (s.reflectionsCompleted ?? 0) + 1;
      s.stepsSinceReflection = 0;
      s.triggered = false;
      s.pendingReflection = { due: false, at: new Date().toISOString() };
      writeReflection(d, s);
      appendJournalLine(d, "reflection", { file: basename2(file) });
      return { completed: true, file };
    }
  });
  dsh.registerTool({
    name: "mpd_memory_status",
    description: `Show memory engine status: vcs mode, store root, entry count, journal line count, reflection counters. scope:"workspace" (default) reports this agent's store, "global" the shared ~/.mpd/memory store (whose reflection counters are still the agent's own, because reflection is workspace-scoped).`,
    parameters: { type: "object", properties: { scope: { type: "string", enum: ["workspace", "global"], description: "Which store to report; workspace is the default." } } },
    output: { schema: { type: "object", properties: { vcs: { type: "string" }, root: { type: "string" }, entries: { type: "integer" }, journalLines: { type: "integer" }, reflection: { type: "object" }, scope: { type: "string" } }, required: ["vcs", "root", "entries"] }, render: (_a, v) => textBlock("memory status: vcs=" + v.vcs + " root=" + v.root + " entries=" + v.entries + " journal=" + v.journalLines + `
reflection: ` + JSON.stringify(v.reflection)), presentationMeta: MEMORY_STATUS_CARD },
    execute: async (args, exec) => {
      const scope = scopeOf(args);
      if (scope === "global") {
        const g = globalDirs(cfg);
        const globalFiles = existsSync3(g.memoryDir) ? readdirSync2(g.memoryDir).filter((f) => f.endsWith(".md")) : [];
        const globalJournalLines = existsSync3(journalPath(g)) ? readFileSync4(journalPath(g), "utf8").split(`
`).filter(Boolean).length : 0;
        const reflection = readReflection(agentPaths(cfg, dsh.workspaceRoot(exec)));
        return { vcs: cfg.vcs ?? "git", root: g.root, entries: globalFiles.length, journalLines: globalJournalLines, reflection, scope };
      }
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec));
      const files = existsSync3(d.memoryDir) ? readdirSync2(d.memoryDir).filter((f) => f.endsWith(".md")) : [];
      const journalLines = existsSync3(journalPath(d)) ? readFileSync4(journalPath(d), "utf8").split(`
`).filter(Boolean).length : 0;
      return { vcs: cfg.vcs ?? "git", root: d.root, entries: files.length, journalLines, reflection: readReflection(d), scope };
    }
  });
  disposers.push(installArchiveHook(dsh, archiveContext));
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
  apply,
  inject,
  name
};
