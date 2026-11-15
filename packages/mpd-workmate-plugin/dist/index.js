// packages/mpd-workmate-plugin/src/index.ts
import { existsSync, lstatSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, renameSync as renameSync2, rmSync as rmSync2, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
import { createHash } from "node:crypto";

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
var DSH_SEAM_SUBAGENTS = "subagents";
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
function agentUnconfiguredRefusal(agent, detail) {
  const error = new Error(agentUnconfiguredMessage(agent, detail));
  error.code = AGENT_UNCONFIGURED_CODE;
  return error;
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
function restrictToolsTolerant(restrict, names) {
  let candidate = [...names];
  const pruned = [];
  for (let attempt = 0;; attempt += 1) {
    try {
      const release = restrict(candidate);
      if (typeof release === "function")
        release();
      return { applied: candidate, pruned };
    } catch (error) {
      if (attempt >= 1)
        throw error;
      const unknown = unknownRestrictedNames(error);
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
function installChildPersonaSeam(dsh, options) {
  const handle = (payload) => {
    const agent = payload?.agent ?? payload;
    let member = null;
    try {
      const label = dsh.subagentLabelOf(agent);
      if (label === undefined)
        return;
      member = options.resolve(label);
    } catch (error) {
      options.warn("a spawned child could not be identified, so neither its persona nor its read-only discipline was applied: " + String(error?.message ?? error));
      return;
    }
    if (member === null)
      return;
    if (member.readonly) {
      try {
        options.restrictReadonly(agent);
      } catch (error) {
        options.warn("a read-only child could NOT be restricted (" + String(error?.message ?? error) + ") — this member may be able to write");
      }
    }
    if (typeof member.persona === "string" && member.persona.trim() !== "") {
      try {
        dsh.applyPersonaSection(agent, member.persona);
      } catch (error) {
        options.warn("a spawned child did not receive its persona section: " + String(error?.message ?? error));
      }
    }
  };
  const dispose = options.onEvent?.("agent/created", (payload) => handle(payload));
  return { installed: dispose !== undefined, handle };
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
function projectMembership(membership) {
  if (membership === undefined || membership === null)
    return;
  const role = membership.role;
  if (role !== "lead" && role !== "teammate")
    return;
  return { teamId: String(membership.id ?? membership.teamId ?? ""), role, name: String(membership.name ?? "") };
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
  try {
    const rows = teams[method].call(teams, agent);
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
function hasSubagentSendMessage(subagents) {
  return typeof subagents?.sendMessage === "function";
}
function continuableStartMember(subagents) {
  for (const member of CONTINUABLE_START_MEMBERS)
    if (typeof subagents?.[member] === "function")
      return member;
  return;
}
function teamServiceSurfaceOf(service) {
  const bag = service ?? undefined;
  const has = (method) => {
    try {
      return bag !== undefined && bag !== null && typeof bag[method] === "function";
    } catch {
      return false;
    }
  };
  const send = has("sendMessage");
  const wait = has("waitForChange");
  const present = bag !== undefined && bag !== null;
  return {
    present,
    identity: has("tryMembership"),
    roster: has("listMembers"),
    taskBoard: TEAM_TASK_METHODS.every((method) => has(method)),
    createTask: has("createTask"),
    getTask: has("getTask"),
    listTasks: has("listTasks"),
    updateTask: has("updateTask"),
    send,
    wait,
    spawn: has("spawnTeammate"),
    interrupt: has("interrupt"),
    enableSwitch: has("isEnabled") && has("setEnabled"),
    messaging: send && wait
  };
}
function missingOfficialExecutorMethods(surface) {
  const missing = [];
  if (!surface.spawn)
    missing.push("spawnTeammate");
  if (!surface.send)
    missing.push("sendMessage");
  if (!surface.interrupt)
    missing.push("interrupt");
  if (!surface.wait)
    missing.push("waitForChange");
  return missing;
}
function officialTeamExecutable(surface) {
  return missingOfficialExecutorMethods(surface).length === 0;
}
function teamGenerationOf(surface) {
  if (!surface.present)
    return "absent";
  if (surface.taskBoard && !surface.identity && !surface.roster && !surface.send && !surface.wait && !surface.spawn && !surface.interrupt)
    return "task-board-only";
  return "partial";
}
var TEAM_UNSUPPORTED_GUIDANCE = {
  identity: "teamMembership() answers from the NATIVE executor's handle map, or undefined when that backend does not know the agent; gate on capabilities().teamRoster",
  roster: "roster reads answer [] with an `unsupported` marker; gate on capabilities().teamRoster, or use the NATIVE team executor (mpd's default) for member identity",
  "task-board": "board reads answer an empty result with an `unsupported` marker; gate on capabilities().teamTasks",
  send: "teamSendMessage() answers status `unsupported` and nothing is queued; gate on capabilities().teamMessaging",
  wait: "teamWaitForChange() answers `timedOut: true` immediately; gate on capabilities().teamWait",
  spawn: "teamSpawnTeammate() answers an empty member row; gate on capabilities().teamSpawn or use teamExecutor()",
  interrupt: "teamInterrupt() answers `inactive`; gate on capabilities().teamInterrupt or use teamExecutor()",
  "enable-switch": "teamEnabled() answers undefined (UNKNOWN) and setTeamEnabled() is a no-op returning undefined; gate on capabilities().teamEnableSwitch"
};
var reportedTeamCapabilities = new Set;
function unsupportedTeamAnswer(capability, surface) {
  const generation = teamGenerationOf(surface);
  const where = generation === "task-board-only" ? "0.2.2-rc.2 removed the roster/mailbox/spawn API (the service is task-board only)" : generation === "absent" ? "no agentTeams service is mounted in this composition" : "this host exposes only part of the official team surface";
  const reason = "the " + capability + " part of the official team surface is unavailable: " + where + " — " + TEAM_UNSUPPORTED_GUIDANCE[capability];
  if (!reportedTeamCapabilities.has(capability)) {
    reportedTeamCapabilities.add(capability);
    rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: " + reason);
  }
  return { unsupported: true, capability, generation, reason };
}
function markedTeamRows(capability, surface) {
  const rows = [];
  Object.defineProperty(rows, "unsupported", { value: unsupportedTeamAnswer(capability, surface), enumerable: false, configurable: false, writable: false });
  return rows;
}
var officialExecutorFallbackReported = false;
function reportOfficialExecutorFallback(missing) {
  if (officialExecutorFallbackReported)
    return;
  officialExecutorFallbackReported = true;
  rowLogLine("mpd-dsh-adapter", "mpd-dsh-adapter: the mounted agentTeams service cannot execute the team roster (missing " + missing.join(", ") + ") — teamExecutor() falls through to the NATIVE backend. 0.2.2-rc.2's service is TASK-BOARD ONLY: the roster/mailbox API was removed, so presence is not servability");
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
        const subagents = subagentsOf();
        const list = subagents?.list;
        if (typeof list !== "function")
          return [];
        try {
          const names = list.call(subagents);
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
            ...request.cwd === undefined ? {} : { cwd: request.cwd },
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
        if (!hasSubagentSendMessage(subagents)) {
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
        if (request.cwd !== undefined) {
          rowLogLine("mpd-dsh-adapter", `mpd-dsh-adapter: the official executor cannot set cwd — team member "${request.name}" runs in the shared checkout instead of ${request.cwd}`);
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
      const teamSurface = teamServiceSurfaceOf(agentTeams);
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
        teamExecutorOfficial: officialTeamExecutable(teamSurface),
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
        team: teamSurface.identity && teamSurface.roster,
        teamServiceMounted: teamSurface.present,
        teamRoster: teamSurface.identity && teamSurface.roster,
        teamTasks: teamSurface.taskBoard,
        teamMessages: teamSurface.messaging,
        teamMessaging: teamSurface.send,
        teamSpawn: teamSurface.spawn,
        teamWait: teamSurface.wait,
        teamInterrupt: teamSurface.interrupt,
        teamEnableSwitch: teamSurface.enableSwitch,
        subagentsProviderRegister: typeof subagents?.registerProvider === "function",
        subagentsSendMessage: hasSubagentSendMessage(subagents),
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
            ...spec.cwd === undefined ? {} : { cwd: spec.cwd },
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
        ...spec.cwd === undefined ? {} : { cwd: spec.cwd },
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
      const officialService = service("agentTeams");
      const officialSurface = teamServiceSurfaceOf(officialService);
      const officialMissing = missingOfficialExecutorMethods(officialSurface);
      const officialReady = officialMissing.length === 0;
      if (officialService !== undefined && !officialReady)
        reportOfficialExecutorFallback(officialMissing);
      const chosen = override === "official" && officialReady ? "official" : override === "native" && nativeReady ? "native" : nativeReady ? "native" : officialReady ? "official" : "native";
      if (chosen === "official")
        return officialTeamExecutor();
      return nativeTeamExecutor(nativeReady ? override === undefined ? `native: the default backend — bound ${String(nativeMember)}() on the harness subagent seam, and it needs nothing from the official plugin` : `native: chosen by MPD_DSH_TEAM_EXECUTOR=native, bound ${String(nativeMember)}() on the harness subagent seam` : "native UNAVAILABLE: the harness subagents service exposes neither startActivation() nor startContinuable(), and no EXECUTABLE team service is mounted either (a task-board-only service does not count) — every team call will refuse", nativeReady);
    },
    teamService() {
      const teams = service("agentTeams");
      return teams === undefined || teams === null ? undefined : teams;
    },
    teamMembership(agent) {
      const teams = service("agentTeams");
      const surface = teamServiceSurfaceOf(teams);
      if (surface.identity) {
        let membership;
        try {
          membership = teams.tryMembership.call(teams, agent);
        } catch {
          return;
        }
        return projectMembership(membership);
      }
      if (surface.present)
        unsupportedTeamAnswer("identity", surface);
      try {
        const viaExecutor = adapter.teamExecutor().membership(agent);
        if (viaExecutor !== undefined)
          return viaExecutor;
      } catch {}
      return;
    },
    teamListMembers(agent) {
      const teams = requireService("agentTeams", "cannot list the team roster of an agent");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.roster)
        return markedTeamRows("roster", surface);
      const rows = teams.listMembers.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamMemberView) : [];
    },
    teamListTasks(agent) {
      const teams = requireService("agentTeams", "cannot list the shared task board of an agent");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.listTasks)
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no listTasks()");
      const rows = teams.listTasks.call(teams, agent);
      return Array.isArray(rows) ? rows.map(teamTaskView) : [];
    },
    async teamCreateTask(caller, request, signal = undefined) {
      const teams = requireService("agentTeams", 'cannot create team task "' + String(request?.subject) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.createTask)
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no createTask()");
      const created = signal === undefined ? await teams.createTask.call(teams, caller, request) : await teams.createTask.call(teams, caller, request, signal);
      return teamTaskView(created);
    },
    teamGetTask(caller, id) {
      const teams = requireService("agentTeams", 'cannot read team task "' + String(id) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.getTask)
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no getTask()");
      return teamTaskView(teams.getTask.call(teams, caller, id));
    },
    async teamUpdateTask(caller, request, signal = undefined) {
      const teams = requireService("agentTeams", 'cannot update team task "' + String(request?.taskId) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.updateTask)
        throw new Error("mpd-dsh-adapter: the harness agentTeams service exposes no updateTask()");
      const updated = signal === undefined ? await teams.updateTask.call(teams, caller, request) : await teams.updateTask.call(teams, caller, request, signal);
      return teamTaskView(updated);
    },
    async teamSendMessage(caller, request) {
      const teams = requireService("agentTeams", 'cannot send a team message to "' + String(request?.target) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.send)
        return { messageId: "", status: "unsupported", unsupported: unsupportedTeamAnswer("send", surface) };
      const result = await teams.sendMessage.call(teams, caller, request);
      return {
        messageId: String(result?.messageId ?? ""),
        status: result?.status === "queued" ? "queued" : "accepted"
      };
    },
    async teamSpawnTeammate(caller, request) {
      const teams = requireService("agentTeams", 'cannot spawn team member "' + String(request?.name) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.spawn) {
        return {
          member: { id: "", name: String(request?.name ?? ""), role: "teammate", status: "inactive", diagnostics: [] },
          unsupported: unsupportedTeamAnswer("spawn", surface)
        };
      }
      const result = await teams.spawnTeammate.call(teams, caller, request);
      return { member: teamMemberView(result?.member) };
    },
    teamInterrupt(caller, targetName) {
      const teams = requireService("agentTeams", 'cannot interrupt team member "' + String(targetName) + '"');
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.interrupt)
        return { previousStatus: "inactive", unsupported: unsupportedTeamAnswer("interrupt", surface) };
      const result = teams.interrupt.call(teams, caller, targetName);
      return { previousStatus: result?.previousStatus === "running" ? "running" : "inactive" };
    },
    async teamWaitForChange(caller, timeoutMs, signal) {
      const teams = requireService("agentTeams", "cannot wait for team activity");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.wait)
        return { timedOut: true, unsupported: unsupportedTeamAnswer("wait", surface) };
      const result = await teams.waitForChange.call(teams, caller, timeoutMs, signal);
      return { timedOut: result?.timedOut === true };
    },
    teamEnabled(agent) {
      const teams = service("agentTeams");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.enableSwitch) {
        unsupportedTeamAnswer("enable-switch", surface);
        return;
      }
      return teams.isEnabled.call(teams, agent) === true;
    },
    async setTeamEnabled(agent, enabled, signal = undefined) {
      const teams = service("agentTeams");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.enableSwitch) {
        unsupportedTeamAnswer("enable-switch", surface);
        return;
      }
      const setEnabled = teams.setEnabled;
      await (signal === undefined ? setEnabled.call(teams, agent, enabled) : setEnabled.call(teams, agent, enabled, signal));
      return teams.isEnabled.call(teams, agent) === true;
    },
    teamLiveTeams() {
      const teams = service("agentTeams");
      const surface = teamServiceSurfaceOf(teams);
      if (!surface.present)
        return [];
      if (!surface.identity || !surface.roster) {
        unsupportedTeamAnswer("roster", surface);
        return [];
      }
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
          tasks: surface.listTasks ? teamRows(teams, "listTasks", agent, teamTaskView) : markedTeamRows("task-board", surface)
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

// packages/mpd-workmate-plugin/src/dshgo-cards.ts
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
function buildWorkmateListCard(_args, value) {
  const v = recordOf(value);
  const workmates = recordsAt(v, "workmates");
  const readonlyCount = workmates.filter((w) => w.readonly === true).length;
  const totalUses = workmates.reduce((sum, w) => sum + numberOf(w.uses), 0);
  const children = [
    row([
      metric({ label: "Workmates", value: workmates.length }),
      metric({ label: "Readonly", value: readonlyCount }),
      metric({ label: "Total uses", value: totalUses })
    ])
  ];
  if (workmates.length === 0) {
    children.push(text("No workmates in the library."));
  } else {
    children.push(table({
      columns: ["Name", "Base", "Uses"],
      rows: workmates.slice(0, 20).map((w) => [clip(stringOf(w.name, "?"), 40), clip(stringOf(w.baseName, "?"), 24), numberOf(w.uses)])
    }));
  }
  return stack(children, { title: "Workmates" });
}
function buildWorkmateMatchCard(_args, value) {
  const v = recordOf(value);
  const matches = recordsAt(v, "matches");
  const matched = v.matched === true;
  const threshold = numberOf(v.threshold);
  const suggestion = stringOf(v.suggestion, "");
  const children = [
    row([
      metric({ label: "Matched", value: matched ? "yes" : "no", tone: matched ? "good" : "muted", caption: "threshold " + threshold }),
      metric({ label: "Candidates", value: matches.length })
    ])
  ];
  if (matches.length === 0) {
    children.push(text("No workmate note was scored."));
  } else {
    children.push(table({
      columns: ["Name", "Score", "Base", "Uses"],
      rows: matches.slice(0, 10).map((m) => [clip(stringOf(m.name, "?"), 32), numberOf(m.score), clip(stringOf(m.baseName, "?"), 20), numberOf(m.uses)])
    }));
  }
  if (suggestion !== "")
    children.push(text(clip(suggestion, 300)));
  return stack(children, { title: "Workmate match" });
}
var WORKMATE_LIST_CARD = toolCard(buildWorkmateListCard);
var WORKMATE_MATCH_CARD = toolCard(buildWorkmateMatchCard);

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
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
  "mpd_role_spawn_async",
  "mpd_role_consult"
];
var LEAF_SPAWN_DENY = ["mpd_role_spawn", "mpd_role_spawn_async", "mpd_role_consult", "mpd_workmate_spawn"];

class WorkmateError extends HomeGuardRefusal {
  blocking;
  constructor(code, message, status, blocking = []) {
    super(code, message, status);
    this.name = "WorkmateError";
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
function assertMutationSandboxed(operation) {
  assertHomeMutationSandboxed({
    root: workmateRoot(),
    operation,
    label: "mpd_workmate",
    allowEnv: WORKMATE_ALLOW_REAL_HOME_ENV
  });
}
var WORKSPACE_ATTRIBUTION_CAP = 8;
function attuneWorkspaces(existing, workspace) {
  const key = String(workspace ?? "").trim();
  if (key === "")
    return [...existing];
  if (existing[0] === key && existing.length <= WORKSPACE_ATTRIBUTION_CAP)
    return [...existing];
  return [key, ...existing.filter((entry) => entry !== key)].slice(0, WORKSPACE_ATTRIBUTION_CAP);
}
function wmDir(name2) {
  const key = sanitizeName(name2);
  if (key === "")
    throw new WorkmateError("invalid-name", "mpd_workmate: empty workmate name — the library root is not an instance", 400);
  return join2(workmateRoot(), key);
}
function workmateKeyFromLabel(label) {
  const text2 = typeof label === "string" ? label : "";
  if (text2 === "")
    return null;
  return sanitizeName(text2) === text2 ? text2 : null;
}
function sanitizeName(s) {
  const t = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return t;
}
function capText(text2, max) {
  if (text2.length <= max)
    return text2;
  const marker = `
…[truncated ${text2.length - max} chars]…
`;
  if (marker.length >= max)
    return text2.slice(0, Math.max(0, max));
  const budget = max - marker.length;
  const head = Math.floor(budget * 0.75);
  const tail = budget - head;
  return text2.slice(0, head) + marker + text2.slice(-tail);
}
function readMeta(dir) {
  try {
    if (!existsSync(join2(dir, "meta.json")))
      return null;
    const m = JSON.parse(readFileSync2(join2(dir, "meta.json"), "utf8"));
    return { name: String(m.name ?? ""), baseId: String(m.baseId ?? ""), baseName: String(m.baseName ?? ""), description: String(m.description ?? ""), provider: String(m.provider ?? ""), model: String(m.model ?? ""), readonly: Boolean(m.readonly), createdAt: String(m.createdAt ?? ""), updatedAt: String(m.updatedAt ?? ""), uses: Number(m.uses ?? 0), lastTask: m.lastTask == null ? null : String(m.lastTask), renamedFrom: Array.isArray(m.renamedFrom) ? m.renamedFrom.map(String) : [], personaRevision: Number.isInteger(m.personaRevision) && Number(m.personaRevision) > 0 ? Number(m.personaRevision) : 0, personaHash: typeof m.personaHash === "string" ? m.personaHash : "", baseRevision: typeof m.baseRevision === "string" ? m.baseRevision : "", workspaces: Array.isArray(m.workspaces) ? m.workspaces.map(String).filter((workspace) => workspace !== "").slice(0, WORKSPACE_ATTRIBUTION_CAP) : [] };
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
    const v = JSON.parse(readFileSync2(indexPath(), "utf8"));
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
    return readFileSync2(join2(wmDir(key), "note.md"), "utf8").trim();
  } catch {
    return "";
  }
}
function readMemory(key, tailBytes = MEMORY_CAP) {
  try {
    const t = readFileSync2(join2(wmDir(key), "memory.md"), "utf8").trim();
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
    return readFileSync2(join2(wmDir(key), "persona.md"), "utf8").trim();
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
  const existing = (existsSync(path) ? readFileSync2(path, "utf8") : "").trim();
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
var UNKNOWN_HASH = "unknown";
function versionsDir(dir) {
  return join2(dir, "persona.versions");
}
function baseSnapshotPath(dir) {
  return join2(dir, "persona.base.md");
}
function readPersonaIn(dir) {
  try {
    return readFileSync2(join2(dir, "persona.md"), "utf8").trim();
  } catch {
    return "";
  }
}
function readBaseSnapshot(dir) {
  try {
    const path = baseSnapshotPath(dir);
    return existsSync(path) ? readFileSync2(path, "utf8").trim() : null;
  } catch {
    return null;
  }
}
function writeBaseSnapshot(dir, baseText) {
  const path = baseSnapshotPath(dir);
  if (existsSync(path))
    return;
  writeFileSync(path, baseText.trim() + `
`);
}
var MAX_DIFF_LINES = 800;
function lcsLines(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let prev = new Array(long.length + 1).fill(0);
  for (let i = 1;i <= short.length; i++) {
    const cur = new Array(long.length + 1).fill(0);
    for (let j = 1;j <= long.length; j++)
      cur[j] = short[i - 1] === long[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[long.length];
}
function lineDiffCount(a, b) {
  const left = String(a ?? "").split(`
`);
  const right = String(b ?? "").split(`
`);
  if (String(a ?? "").trim() === "" && String(b ?? "").trim() === "")
    return 0;
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    const pool = new Map;
    for (const line of right)
      pool.set(line, (pool.get(line) ?? 0) + 1);
    let changed = 0;
    for (const line of left) {
      const count = pool.get(line) ?? 0;
      if (count > 0)
        pool.set(line, count - 1);
      else
        changed += 1;
    }
    for (const count of pool.values())
      changed += count;
    return changed;
  }
  return left.length + right.length - 2 * lcsLines(left, right);
}
function nextFreeRevision(dir, from) {
  const versions = versionsDir(dir);
  let revision = Math.max(1, Math.trunc(from));
  for (let step = 0;step < 1e5; step++) {
    if (!existsSync(join2(versions, revision + ".md")))
      return revision;
    revision += 1;
  }
  throw new Error("mpd_workmate: this workmate's persona version history is corrupt (no free revision number below 100000)");
}
function writePersonaVersion(dir, revision, text2) {
  mkdirSync2(versionsDir(dir), { recursive: true });
  const path = join2(versionsDir(dir), revision + ".md");
  if (existsSync(path))
    throw new Error("mpd_workmate: persona revision " + revision + " already exists and is never overwritten");
  writeFileSync(path, text2 + `
`);
}
function personaRecordOf(dir, meta, currentBase) {
  const persona = readPersonaIn(dir);
  const hasFile = existsSync(join2(dir, "persona.md"));
  const revision = meta.personaRevision > 0 ? meta.personaRevision : Math.max(1, highestVersionOf(dir));
  const baseRevision = meta.baseRevision !== "" ? meta.baseRevision : currentBase !== null ? sha256Of(String(currentBase).trim()) : UNKNOWN_HASH;
  return { revision, hash: hasFile ? sha256Of(persona) : UNKNOWN_HASH, baseRevision, backfilled: meta.personaRevision <= 0 || meta.personaHash === "" || meta.baseRevision === "" };
}
function highestVersionOf(dir) {
  const versions = versionsDir(dir);
  try {
    if (!existsSync(versions))
      return 0;
    let highest = 0;
    for (const file of readdirSync(versions)) {
      const n = /^([1-9]\d*)\.md$/.exec(file)?.[1];
      if (n === undefined)
        continue;
      if (Number(n) > highest)
        highest = Number(n);
    }
    return highest;
  } catch {
    return 0;
  }
}
function applyPersonaWrite(input) {
  const record = personaRecordOf(input.dir, input.meta, input.currentBase);
  if (!existsSync(join2(versionsDir(input.dir), record.revision + ".md")))
    writePersonaVersion(input.dir, record.revision, readPersonaIn(input.dir));
  if (input.currentBase !== null)
    writeBaseSnapshot(input.dir, input.currentBase);
  const persona = input.bump ? capText(String(input.text ?? ""), PERSONA_CAP).trim() : readPersonaIn(input.dir);
  const revision = input.bump ? nextFreeRevision(input.dir, record.revision + 1) : record.revision;
  if (input.bump) {
    writeFileSync(join2(input.dir, "persona.md"), persona + `
`);
    writePersonaVersion(input.dir, revision, persona);
  }
  const hash = sha256Of(persona);
  input.meta.personaRevision = revision;
  input.meta.personaHash = hash;
  input.meta.baseRevision = record.baseRevision;
  return { persona, revision, hash };
}
function personaDrift(meta, dir, currentBase) {
  if (currentBase === null || meta.baseRevision === "" || meta.baseRevision === UNKNOWN_HASH)
    return { defaultUpdated: false, baseDriftLines: 0, baseDriftUnknown: true };
  const current = String(currentBase).trim();
  if (sha256Of(current) === meta.baseRevision)
    return { defaultUpdated: false, baseDriftLines: 0, baseDriftUnknown: false };
  return { defaultUpdated: true, baseDriftLines: lineDiffCount(readBaseSnapshot(dir) ?? "", current), baseDriftUnknown: false };
}
function noteWithDrift(note, drift) {
  const bare = note.replace(/\n?\[defaultUpdated=[^\]]*\]/g, "").trim();
  if (!drift.defaultUpdated)
    return bare;
  return capText(bare + `
[defaultUpdated=true baseDriftLines=` + drift.baseDriftLines + " — the base persona moved ahead of this workmate]", NOTE_CAP);
}
function mergedPersonaText(existing, revision) {
  const merged = capText(existing + (revision ? `

## Persona revision (${now()})
${revision.trim()}` : ""), PERSONA_CAP);
  return merged.trim();
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
          const team = JSON.parse(readFileSync2(file, "utf8"));
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
          const team = JSON.parse(readFileSync2(join2(records, name2), "utf8"));
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
    raw = readFileSync2(path, "utf8");
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
var MERGE_THRESHOLD = 0.6;
var MERGE_TAG_THRESHOLD = 0.5;
var MERGE_RECORD_VERSION = 1;
function sha256Of(text2) {
  return createHash("sha256").update(text2, "utf8").digest("hex");
}
function memoryBlocksOf(text2) {
  return String(text2 ?? "").split(/\n## /).map((block, index) => index === 0 ? block : "## " + block).map((block) => block.trim()).filter((block) => block !== "");
}
function tagsOf(note, baseName) {
  return new Set(unique(tokenize(note + " " + baseName)));
}
function jaccardOf(a, b) {
  if (a.size === 0 || b.size === 0)
    return 0;
  let shared = 0;
  for (const tag of a)
    if (b.has(tag))
      shared += 1;
  return shared / (a.size + b.size - shared);
}
function archivedCopiesOf(key) {
  try {
    const root = join2(workmateRoot(), ".archive");
    if (!existsSync(root))
      return [];
    const shapes = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:-\\d{8}T\\d{6}Z(?:-\\d+)?|-merged-.+)$");
    return readdirSync(root).filter((entry) => entry === key || shapes.test(entry));
  } catch {
    return [];
  }
}
function planWorkmateMerges(options = {}) {
  const instances = listInstances();
  const byName = new Map(instances.map((instance) => [instance.name, instance]));
  const threshold = typeof options.mergeThreshold === "number" && options.mergeThreshold >= 0 && options.mergeThreshold <= 1 ? options.mergeThreshold : MERGE_THRESHOLD;
  const proposals = [];
  if (options.pairs !== undefined && options.pairs.length > 0) {
    for (const pair of options.pairs)
      proposals.push({ from: sanitizeName(pair?.from ?? ""), into: sanitizeName(pair?.into ?? "") });
  } else {
    const groups = new Map;
    for (const instance of instances) {
      const group = groups.get(instance.meta.baseName) ?? [];
      group.push(instance);
      groups.set(instance.meta.baseName, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2)
        continue;
      const ordered = [...group].sort((a, b) => b.meta.uses - a.meta.uses || a.name.localeCompare(b.name));
      for (const source of ordered.slice(1))
        proposals.push({ from: source.name, into: ordered[0].name });
    }
  }
  const rows = [];
  const claimedSources = new Set;
  for (const proposal of proposals) {
    const repeatedSource = claimedSources.has(proposal.from);
    claimedSources.add(proposal.from);
    const source = byName.get(proposal.from);
    const target = byName.get(proposal.into);
    const score = source === undefined || target === undefined ? 0 : scoreMatch(source.note, { note: target.note, baseName: target.meta.baseName, description: target.meta.description, memoryTail: readMemory(target.name, 600) });
    const jaccard = source === undefined || target === undefined ? 0 : jaccardOf(tagsOf(source.note, source.meta.baseName), tagsOf(target.note, target.meta.baseName));
    const roundedScore = Math.round(score * 100) / 100;
    const roundedJaccard = Math.round(jaccard * 100) / 100;
    const reason = repeatedSource ? "duplicate-source" : source === undefined || target === undefined ? "missing" : proposal.from === proposal.into ? "same" : source.meta.baseName !== target.meta.baseName ? "base-mismatch" : source.meta.readonly !== target.meta.readonly ? "readonly-mismatch" : archivedCopiesOf(proposal.from).length > 0 || archivedCopiesOf(proposal.into).length > 0 ? "archived" : busyTeams(proposal.from, options.teamRoots).length > 0 || busyTeams(proposal.into, options.teamRoots).length > 0 || inUseCount(proposal.from) > 0 || inUseCount(proposal.into) > 0 ? "in-use" : !(roundedScore >= threshold || roundedJaccard >= MERGE_TAG_THRESHOLD) ? "not-similar" : undefined;
    rows.push({ from: proposal.from, into: proposal.into, score: roundedScore, jaccard: roundedJaccard, mergeable: reason === undefined, ...reason === undefined ? {} : { reason } });
  }
  return rows;
}
function mergeArchivePathFor(fromKey, intoKey) {
  const root = join2(workmateRoot(), ".archive");
  mkdirSync2(root, { recursive: true });
  const stamp = compactUtcStamp();
  let candidate = join2(root, `${fromKey}-merged-${intoKey}-${stamp}`);
  for (let i = 2;lstatOrNull(candidate) != null && i < 1000; i++)
    candidate = join2(root, `${fromKey}-merged-${intoKey}-${stamp}-${i}`);
  return candidate;
}
function mergeOneWorkmate(fromKey, intoKey) {
  const source = resolveTarget(fromKey);
  const target = resolveTarget(intoKey);
  const sourcePersona = readPersona(fromKey);
  const targetPersona = readPersona(intoKey);
  const longerPersona = sourcePersona.length > targetPersona.length ? sourcePersona : targetPersona;
  const persona = capText(longerPersona === "" ? "" : longerPersona + `

merged-from: ` + fromKey, PERSONA_CAP);
  const seen = new Set;
  const blocks = [];
  for (const block of [...memoryBlocksOf(readMemory(intoKey, Number.MAX_SAFE_INTEGER)), ...memoryBlocksOf(readMemory(fromKey, Number.MAX_SAFE_INTEGER))]) {
    const sha = sha256Of(block);
    if (seen.has(sha))
      continue;
    seen.add(sha);
    blocks.push(block);
  }
  let memory = "";
  for (let index = blocks.length - 1;index >= 0; index--) {
    const candidate = blocks[index] + (memory === "" ? "" : `

` + memory);
    if (candidate.length > MEMORY_CAP)
      break;
    memory = candidate;
  }
  const sourceMemoryShas = memoryBlocksOf(readMemory(fromKey, Number.MAX_SAFE_INTEGER)).map(sha256Of);
  const meta = {
    ...target.meta,
    uses: target.meta.uses + source.meta.uses,
    renamedFrom: unique([...target.meta.renamedFrom, fromKey, ...source.meta.renamedFrom]).slice(-10),
    updatedAt: now()
  };
  const note = autoNote(meta, persona, memory, readNote(intoKey));
  applyPersonaWrite({ dir: target.dir, meta, text: persona, currentBase: null, bump: true });
  writeFileSync(join2(target.dir, "memory.md"), memory === "" ? "" : memory + `
`);
  writeFileSync(join2(target.dir, "note.md"), note + `
`);
  writeFileSync(join2(target.dir, "meta.json"), JSON.stringify(meta, null, 2) + `
`);
  writeIndexEntry(intoKey, meta);
  const archive = mergeArchivePathFor(fromKey, intoKey);
  renameSync2(source.dir, archive);
  dropIndexKey(fromKey);
  writeJson(join2(archive, "merge.json"), {
    version: MERGE_RECORD_VERSION,
    from: fromKey,
    into: intoKey,
    at: now(),
    memoryShas: sourceMemoryShas,
    personaSha: sha256Of(persona)
  });
  return archive;
}
function optimizeWorkmates(options = {}) {
  const plan = planWorkmateMerges({ ...options.mergeThreshold === undefined ? {} : { mergeThreshold: options.mergeThreshold }, ...options.pairs === undefined ? {} : { pairs: options.pairs }, ...options.teamRoots === undefined ? {} : { teamRoots: options.teamRoots } });
  const skipped = plan.filter((row2) => !row2.mergeable).map((row2) => ({ from: row2.from, into: row2.into, reason: row2.reason ?? "refused" }));
  const apply = options.confirm === true && options.dryRun !== true;
  if (!apply)
    return { plan, applied: [], skipped };
  assertMutationSandboxed("merge workmates");
  const applied = [];
  for (const row2 of plan) {
    if (!row2.mergeable)
      continue;
    try {
      assertNotBusy([row2.from, row2.into], options.teamRoots);
      applied.push({ from: row2.from, into: row2.into, archive: mergeOneWorkmate(row2.from, row2.into) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({ from: row2.from, into: row2.into, reason: "failed: " + message });
    }
  }
  return { plan, applied, skipped };
}
function renderOptimizeTable(result) {
  const head = result.applied.length > 0 ? "workmate merge — APPLIED " + result.applied.length + " pair(s)" : "workmate merge — DRY RUN (nothing written)";
  const rows = result.plan.length === 0 ? ["  (nothing to merge: no base group carries two instances and no pair was named)"] : result.plan.map((row2) => "  " + row2.from + " -> " + row2.into + "  score=" + row2.score.toFixed(2) + " jaccard=" + row2.jaccard.toFixed(2) + "  " + (row2.mergeable ? result.applied.some((entry) => entry.from === row2.from) ? "MERGED" : "MERGE" : "skip:" + String(row2.reason)));
  const tail = result.applied.length > 0 ? ["archived: " + result.applied.map((entry) => entry.archive).join(", ")] : ["re-run with confirm:true to apply (mpd_workmate_optimize {confirm:true} or /workmate-optimize confirm)"];
  return [head, ...rows, ...tail].join(`
`);
}
function spawnMaxDepthOf(agent) {
  const header = agent?.session?.header;
  const raw = Number(header?.delegationDepth);
  if (Number.isFinite(raw) && raw >= 1)
    return Math.floor(raw) + 1;
  return header?.origin === "subagent" ? 2 : 1;
}
function consultDepthRefusal(agent) {
  const header = agent?.session?.header;
  const raw = Number(header?.delegationDepth);
  const depth = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : header?.origin === "subagent" ? 1 : 0;
  if (depth < 2)
    return;
  return "mpd spawn rule: refused — this session is at delegation depth " + depth + ", two or more levels below" + " the session that started the work, so it may not raise another consult. `mpd_role_spawn` and" + " `mpd_workmate_spawn` forward a depth cap that makes their child a LEAF, and a session at depth 2 or" + " deeper IS that leaf: the consults it would raise are exactly the runaway nesting the cap exists to" + " prevent (CR repair E). Do the work here, or hand the question UP — report what you need to the session" + " that raised you and end your turn.";
}
function apply(ctx) {
  const dsh = resolveDshAdapter(ctx);
  function rolesService() {
    return ctx.get ? ctx.get("mpdRoles") : undefined;
  }
  function configService() {
    try {
      return ctx.get ? ctx.get("mpdConfig") : undefined;
    } catch {
      return;
    }
  }
  function spawnRouteOf(meta) {
    const live = configService();
    if (typeof live?.agentRouteResolutionOf === "function") {
      const resolution = live.agentRouteResolutionOf(meta.baseName);
      if (resolution !== null && typeof resolution === "object" && typeof resolution.ok === "boolean") {
        if (resolution.ok)
          return { route: resolution.route, fallbacks: resolution.route.fallbacks ?? [] };
        if (resolution.reason === "unrouted")
          return { route: declaredRouteOfBase(meta), fallbacks: [] };
        const detail = resolution.reason === "invalid" ? resolution.problem + " must be a string" : "missing " + resolution.missing.join(", ");
        throw agentUnconfiguredRefusal(resolution.agent, detail);
      }
    }
    return { route: declaredRouteOfBase(meta), fallbacks: [] };
  }
  function declaredRouteOfBase(meta) {
    try {
      const base = resolveBase(meta.baseName);
      if (base.provider !== "" && base.model !== "")
        return { provider: base.provider, model: base.model };
    } catch {}
    throw new Error("mpd_workmate: no route configured for " + meta.baseName + " — its extension declares no provider+model, and a workmate never runs on the frozen meta values (they are provenance). Configure a route for the base, or re-initialize the workmate from a base that declares one.");
  }
  function validatedReadonlyDeny(agent) {
    const scope = dsh.agentScope(agent);
    if (scope === undefined) {
      reportPrunedNames("read-only workmate spawn: this agent exposes no scoped context, so the canonical deny list is returned unvalidated");
      return [...READONLY_DENY];
    }
    const outcome = restrictToolsTolerant((names) => scope.tools.restrict({ deny: names }), READONLY_DENY);
    if (outcome.pruned.length > 0) {
      reportPrunedNames("read-only workmate spawn: pruned tool name(s) this profile does not register: " + outcome.pruned.join(", "));
    }
    return [...outcome.applied];
  }
  const reportedValidationLines = new Set;
  function reportPrunedNames(line) {
    if (reportedValidationLines.has(line))
      return;
    reportedValidationLines.add(line);
    try {
      rowLogLine("mpd-workmate", "[mpd-workmate] " + line);
    } catch {}
  }
  function applyChildReadonlyDeny(agent) {
    try {
      const outcome = dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY, ...LEAF_SPAWN_DENY]);
      reportPrunedNames("read-only workmate child: applied " + outcome.applied.length + " denials (+ the leaf spawn boundary) to its own tool scope" + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"));
    } catch (error) {
      reportPrunedNames("read-only workmate child: the deny could NOT be applied (" + String(error?.message ?? error) + ") — this workmate may be able to write and to delegate");
    }
  }
  function applyChildLeafDeny(agent) {
    try {
      const outcome = dsh.restrictAgentToolsRetained(agent, [...LEAF_SPAWN_DENY]);
      reportPrunedNames("workmate child leaf boundary: applied " + outcome.applied.length + " spawn denials to its own tool scope" + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"));
    } catch (error) {
      reportPrunedNames("workmate child leaf boundary: the deny could NOT be applied (" + String(error?.message ?? error) + ") — this child may be able to delegate further");
    }
  }
  installChildPersonaSeam(dsh, {
    resolve: (label) => {
      const key = workmateKeyFromLabel(label);
      if (key === null)
        return null;
      const meta = readMeta(wmDir(key));
      if (meta === null)
        return null;
      const persona = readPersona(key);
      return { persona, readonly: meta.readonly };
    },
    restrictReadonly: (agent) => {
      applyChildReadonlyDeny(agent);
    },
    warn: (line) => reportPrunedNames(line),
    onEvent: typeof dsh.onEvent === "function" ? dsh.onEvent : undefined
  });
  if (typeof dsh.onEvent === "function") {
    dsh.onEvent("agent/created", (payload) => {
      try {
        const agent = payload?.agent ?? payload;
        const label = dsh.subagentLabelOf(agent);
        if (label === undefined)
          return;
        const key = workmateKeyFromLabel(label);
        if (key === null)
          return;
        const meta = readMeta(wmDir(key));
        if (meta === null || meta.readonly)
          return;
        applyChildLeafDeny(agent);
      } catch (error) {
        reportPrunedNames("workmate child leaf boundary: a child could not be identified, so its spawn tools were left open (" + String(error?.message ?? error) + ")");
      }
    });
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
    return { id: String(base.id), name: String(base.name), description: String(base.description ?? ""), readonly: Boolean(base.readonly), provider: String(base.chain?.[0]?.provider ?? ""), model: String(base.chain?.[0]?.model ?? ""), persona: String(base.persona ?? "") };
  }
  function workspaceOf(adapter, exec) {
    try {
      return String(adapter.workspaceRoot(exec) ?? "").trim();
    } catch {
      return "";
    }
  }
  function currentBaseTextOf(meta) {
    try {
      return String(resolveBase(meta.baseName).persona ?? "").trim();
    } catch {
      return null;
    }
  }
  function initWorkmate(baseKey, nameArg, noteArg, workspace) {
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
    const born = (() => {
      const live = configService();
      if (typeof live?.agentRouteResolutionOf === "function") {
        const resolution = live.agentRouteResolutionOf(base.name);
        if (resolution !== undefined && resolution !== null && resolution.ok === true)
          return { provider: resolution.route.provider, model: resolution.route.model };
      }
      return { provider: base.provider, model: base.model };
    })();
    const bornPersona = capText(base.persona, PERSONA_CAP).trim();
    const bornBase = String(base.persona ?? "").trim();
    const meta = { name: name2, baseId: base.id, baseName: base.name, description: base.description, provider: born.provider, model: born.model, readonly: base.readonly, createdAt: now(), updatedAt: now(), uses: 0, lastTask: null, renamedFrom: [], personaRevision: 1, personaHash: sha256Of(bornPersona), baseRevision: bornBase === "" ? UNKNOWN_HASH : sha256Of(bornBase), workspaces: attuneWorkspaces([], workspace) };
    writeFileSync(join2(dir, "meta.json"), JSON.stringify(meta, null, 2) + `
`);
    writeFileSync(join2(dir, "persona.md"), bornPersona + `
`);
    writePersonaVersion(dir, 1, bornPersona);
    if (bornBase !== "")
      writeBaseSnapshot(dir, bornBase);
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
` + v.workmates.map((w) => "- " + w.name + " [" + w.baseName + (w.readonly ? " readonly" : "") + "] uses=" + w.uses + " rev=" + w.personaRevision + (w.defaultUpdated ? " default-updated:" + w.baseDriftLines + "L" : w.baseDriftUnknown ? " default-unverified" : "") + " :: " + String(w.note).slice(0, 140)).join(`
`) || "(empty)"), presentationMeta: WORKMATE_LIST_CARD },
    execute: async () => {
      const list = listInstances().map(({ name: name2, meta, note }) => {
        const base = currentBaseTextOf(meta);
        const record = personaRecordOf(wmDir(name2), meta, base);
        const drift = personaDrift(meta, wmDir(name2), base);
        return {
          name: name2,
          baseName: meta.baseName,
          readonly: meta.readonly,
          provider: meta.provider,
          model: meta.model,
          uses: meta.uses,
          updatedAt: meta.updatedAt,
          lastTask: meta.lastTask,
          renamedFrom: meta.renamedFrom,
          workspaces: meta.workspaces,
          note: noteWithDrift(note, drift),
          personaRevision: record.revision,
          personaHash: record.hash,
          baseRevision: meta.baseRevision === "" ? UNKNOWN_HASH : meta.baseRevision,
          defaultUpdated: drift.defaultUpdated,
          baseDriftLines: drift.baseDriftLines,
          baseDriftUnknown: drift.baseDriftUnknown
        };
      });
      return { workmates: list, count: list.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_init",
    description: `Instantiate a roster BASE specialist into a durable, evolving workmate copy under ~/.mpd/workmate/<name>/ (independent name). base = the specialist's functional NAME (mpd_roles_list), e.g. "Deep Worker". The base template stays pristine; the workmate gets its own persona.md, memory.md and a short note.md. Use when creating a team or pulling up a specialist you will reuse across sessions.`,
    parameters: { type: "object", properties: { base: { type: "string", description: `the specialist's functional name (e.g. "Deep Worker")` }, name: { type: "string", description: "independent workmate name (lowercase kebab; auto-generated from the functional name if omitted)" }, note: { type: "string", description: "optional initial note card" } }, required: ["base"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, baseName: { type: "string" }, readonly: { type: "boolean" }, provider: { type: "string" }, model: { type: "string" }, path: { type: "string" }, note: { type: "string" } }, required: ["name", "baseName"], additionalProperties: false }, render: (_a, v) => textBlock("workmate " + v.name + " initialized (base " + v.baseName + (v.readonly ? ", readonly" : "") + ", " + v.provider + "/" + v.model + `)
note: ` + v.note) },
    execute: async (args, exec) => initWorkmate(String(args?.base ?? ""), String(args?.name ?? ""), String(args?.note ?? ""), workspaceOf(dsh, exec))
  });
  dsh.registerTool({
    name: "mpd_workmate_spawn",
    description: "Reuse a workmate instance: spawn it as a ONE-SHOT single-call consult — one bounded delegation, one report — carrying its evolved persona + independent memory + note, on its own model route (readonly bases are mechanically denied write tools). On a host exposing `startActivation` the adapter disposes that activation once the report settles (the retired `start` fallback is inherently one-shot), so the consult is NOT reused: ask a new question with a NEW spawn, and rely on the workmate RECORD (persona/memory/note) for durable continuity, not on the child session (the harness catalog is append-only, so a settled child may still list as `inactive`). The subagent must call mpd_workmate_reflect with a self-summary before finishing. This uses the SAME spawn mechanics as `mpd_role_spawn` (plus the library's persona/memory); for team work, instead add a member whose name equals the workmate name and give it the persona in the staged prompt yourself — the TEAM path injects no persona or memory. A CONSULT IS A LEAF (CR repair E): the child this tool raises has BOTH bundle spawn tools denied in its own scope, so it cannot delegate again, and a caller already at delegation depth 2 or deeper is refused outright.",
    parameters: { type: "object", properties: { name: { type: "string", description: "workmate instance name" }, task: { type: "string" }, context: { type: "string", description: "optional context block" } }, required: ["name", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { name: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["name", "status", "summary"], additionalProperties: false }, render: (_a, v) => textBlock("workmate " + v.name + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "")) },
    execute: async (args, exec) => {
      const tooDeep = consultDepthRefusal(exec?.agent);
      if (tooDeep !== undefined)
        throw new Error(tooDeep);
      const { meta, key } = ensureInstance(String(args?.name ?? ""));
      const attributed = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec));
      if (attributed.join("\x00") !== meta.workspaces.join("\x00")) {
        meta.workspaces = attributed;
        writeFileSync(join2(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + `
`);
        writeIndexEntry(key, meta);
      }
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
        const decided = spawnRouteOf(meta);
        const run = await resolveRunRoute(dsh, decided.route, decided.fallbacks);
        const route = run.route;
        const result = await dsh.spawnAgent({
          label: key,
          prompt,
          parent: exec.agent,
          signal: exec.signal,
          provider: route.provider,
          model: route.model,
          persona,
          outputSchema: REPORT_SCHEMA,
          maxDepth: spawnMaxDepthOf(exec.agent),
          ...route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: route.reasoningEffort } },
          ...meta.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {}
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
    execute: async (args, exec) => {
      assertMutationSandboxed("reflect a workmate");
      const { meta, key } = ensureInstance(String(args?.name ?? ""));
      const task = String(args?.task ?? "").trim();
      const outcome = String(args?.outcome ?? "").trim();
      if (!task || !outcome)
        throw new Error("mpd_workmate_reflect: task and outcome required");
      appendMemory(key, `## ${now()} — ${capText(task, 200)}
${capText(outcome, 1200)}`);
      const delta = String(args?.persona_delta ?? "").trim();
      const written = applyPersonaWrite({ dir: wmDir(key), meta, text: mergedPersonaText(readPersonaIn(wmDir(key)), delta), currentBase: currentBaseTextOf(meta), bump: delta !== "" });
      const persona = written.persona;
      const memory = readMemory(key);
      meta.uses += 1;
      meta.lastTask = task;
      meta.updatedAt = now();
      meta.workspaces = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec));
      meta.name = key;
      writeFileSync(join2(wmDir(key), "meta.json"), JSON.stringify(meta, null, 2) + `
`);
      const note = capText(String(args?.note ?? "").trim() || autoNote(meta, persona, memory, readNote(key)), NOTE_CAP);
      writeFileSync(join2(wmDir(key), "note.md"), noteWithDrift(note, personaDrift(meta, wmDir(key), currentBaseTextOf(meta))) + `
`);
      writeIndexEntry(key, meta);
      return { name: key, updated: true, uses: meta.uses, personaChars: persona.length, memoryChars: memory.length, noteChars: note.length };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_persona_set",
    description: "REPLACE a workmate's persona text under a COMPARE-AND-SET guard. The caller names the revision its draft was based on (`baseRevision` = the INTEGER `personaRevision` reported by mpd_workmate_list, which is a DIFFERENT thing from the meta.json baseline of the same name); a stale token is REFUSED and NOTHING is written — the result carries the current revision and the current persona length so the caller can rebase and retry. A matching write replaces persona.md, bumps personaRevision, rewrites personaHash and stores the whole text as persona.versions/<revision>.md, where a version file is NEVER overwritten, so any two revisions can be diffed. Use it to prune or rewrite a persona that has evolved; mpd_workmate_reflect remains the append-a-delta path.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "workmate instance name" },
        persona: { type: "string", description: "the COMPLETE new persona text — this REPLACES the current one" },
        baseRevision: { type: "integer", description: "the personaRevision this draft is based on (from mpd_workmate_list); a stale value is refused" }
      },
      required: ["name", "persona", "baseRevision"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { name: { type: "string" }, updated: { type: "boolean" }, revision: { type: "integer" }, personaChars: { type: "integer" }, personaHash: { type: "string" }, refused: { type: "string" }, currentRevision: { type: "integer" }, currentPersonaChars: { type: "integer" } }, required: ["name", "updated"], additionalProperties: false },
      render: (_a, v) => textBlock(v.updated === true ? "workmate " + v.name + " persona set at revision " + v.revision + " (" + v.personaChars + "B, sha256 " + String(v.personaHash).slice(0, 12) + ")" : "workmate " + v.name + " persona REFUSED — " + String(v.refused) + " (current revision " + v.currentRevision + ", " + v.currentPersonaChars + "B)")
    },
    execute: async (args, exec) => {
      assertMutationSandboxed("set a workmate persona");
      const { meta, dir } = resolveTarget(sanitizeName(String(args?.name ?? "")));
      const next = String(args?.persona ?? "");
      if (next.trim() === "")
        throw new Error("mpd_workmate_persona_set: persona required (an empty persona would erase this workmate's identity)");
      const base = currentBaseTextOf(meta);
      const record = personaRecordOf(dir, meta, base);
      const expected = Number(args?.baseRevision);
      if (!Number.isInteger(expected) || expected !== record.revision) {
        rowLogLine("mpd-workmate", "persona_set refused (stale baseRevision) for " + meta.name);
        return { name: meta.name, updated: false, refused: "stale baseRevision: the draft was based on revision " + String(args?.baseRevision) + " but this workmate is at revision " + record.revision + "; re-read the persona and rebase", currentRevision: record.revision, currentPersonaChars: readPersonaIn(dir).length };
      }
      const written = applyPersonaWrite({ dir, meta, text: next, currentBase: base, bump: true });
      meta.updatedAt = now();
      meta.workspaces = attuneWorkspaces(meta.workspaces, workspaceOf(dsh, exec));
      meta.name = sanitizeName(String(args?.name ?? ""));
      writeFileSync(join2(dir, "meta.json"), JSON.stringify(meta, null, 2) + `
`);
      writeIndexEntry(meta.name, meta);
      rowLogLine("mpd-workmate", "persona_set " + meta.name + " revision " + record.revision + " -> " + written.revision + " (sha256 " + written.hash.slice(0, 12) + ")");
      return { name: meta.name, updated: true, revision: written.revision, personaChars: written.persona.length, personaHash: written.hash };
    }
  });
  dsh.registerTool({
    name: "mpd_workmate_match",
    description: "Score every workmate note against a task and return the ranked matches. If the best score is below the threshold, matched=false and you should initialize a NEW workmate (mpd_workmate_init) instead of forcing a weak match. If matched=true, delegate to the best workmate (mpd_workmate_spawn, or a team member named after it).",
    parameters: { type: "object", properties: { task: { type: "string" } }, required: ["task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { matched: { type: "boolean" }, threshold: { type: "number" }, matches: { type: "array", items: { type: "object" } }, suggestion: { type: "string" } }, required: ["matched", "threshold", "matches"], additionalProperties: false }, render: (_a, v) => textBlock((v.matched ? "MATCHED" : "NO MATCH (threshold " + v.threshold + ")") + `
` + v.matches.map((m) => "- " + m.name + " score=" + m.score.toFixed(2) + " [" + m.baseName + "] :: " + String(m.note).slice(0, 120)).join(`
`) + (v.suggestion ? `
` + v.suggestion : "")), presentationMeta: WORKMATE_MATCH_CARD },
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
  dsh.registerTool({
    name: "mpd_workmate_optimize",
    description: "Merge similar workmates and shrink the library. Two instances are MERGEABLE when they share the same roster base and readonly posture, neither is archived, neither is busy in a live team, AND (their note score clears the merge threshold OR their tag overlap is at least 0.5). A merge PRESERVES the evolved record — memory blocks concatenated and deduplicated by sha256 under the cap, the LONGER persona plus one merged-from line, use counts summed, name history accumulated, the note regenerated — and ARCHIVES the source to ~/.mpd/workmate/.archive/<name>-merged-<target>-<ts>/ with a merge.json record. It never deletes and cannot purge. DRY RUN BY DEFAULT: it returns the plan table and writes nothing unless confirm is literally true. A pair refused for live-team use skips ONLY that pair, and a pair that cannot run at all is REPORTED in `skipped` instead of aborting the rest. The in-use gate scans EVERY live workspace of this process (the library is cross-project); DECLARED BOUND: a live team in ANOTHER dsh process is not visible to this gate.",
    parameters: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "true = print the plan only (the default when confirm is absent)" },
        confirm: { type: "boolean", description: "true = APPLY the plan; without it nothing is written" },
        pairs: { type: "array", description: "explicit merge pairs; omitted = every fork in one base group", items: { type: "object", properties: { from: { type: "string" }, into: { type: "string" } }, required: ["from", "into"], additionalProperties: false } },
        mergeThreshold: { type: "number", description: "note-score floor, 0..1; defaults to 0.6" }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { plan: { type: "array", items: { type: "object" } }, applied: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } } }, required: ["plan", "applied", "skipped"], additionalProperties: false },
      render: (_a, v) => textBlock(renderOptimizeTable(v))
    },
    execute: async (args, exec) => optimizeWorkmates({
      dryRun: args?.dryRun === true,
      confirm: args?.confirm === true,
      ...Array.isArray(args?.pairs) ? { pairs: args.pairs.map((pair) => ({ from: String(pair?.from ?? ""), into: String(pair?.into ?? "") })) } : {},
      ...typeof args?.mergeThreshold === "number" ? { mergeThreshold: args.mergeThreshold } : {},
      teamRoots: agentlessRoots(dsh)
    })
  });
  dsh.registerCommand({
    name: "workmate-optimize",
    description: "Merge/optimise the workmate library: prints the merge plan (dry run) — add the word `confirm` to apply it",
    input: { hint: "confirm" },
    handler: (invocation) => {
      const confirm = String(invocation?.rawInput ?? "").trim().toLowerCase() === "confirm";
      const result = optimizeWorkmates({ confirm, teamRoots: agentlessRoots(dsh) });
      return { kind: "success", text: renderOptimizeTable(result) };
    }
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
      if (e instanceof HomeGuardRefusal) {
        json(res, e.status, { error: e.message, reason: e.code, ...e instanceof WorkmateError && e.blocking.length > 0 ? { blocking: e.blocking } : {} });
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
          const created = initWorkmate(String(body?.base ?? ""), String(body?.name ?? ""), String(body?.note ?? ""), "");
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
  LEAF_SPAWN_DENY,
  MATCH_THRESHOLD,
  MEMORY_CAP,
  MERGE_RECORD_VERSION,
  MERGE_TAG_THRESHOLD,
  MERGE_THRESHOLD,
  NOTE_CAP,
  PERSONA_CAP,
  READONLY_DENY,
  UNKNOWN_HASH,
  WORKMATE_ALLOW_REAL_HOME_ENV,
  WORKSPACE_ATTRIBUTION_CAP,
  WorkmateError,
  apply,
  assertMutationSandboxed,
  attuneWorkspaces,
  autoNote,
  busyTeams,
  capText,
  consultDepthRefusal,
  deleteWorkmate,
  inject,
  lineDiffCount,
  name,
  nameKey,
  noteWithDrift,
  optimizeWorkmates,
  personaDrift,
  planWorkmateMerges,
  renameWorkmate,
  renderOptimizeTable,
  sanitizeName,
  scoreMatch,
  spawnMaxDepthOf,
  workmateKeyFromLabel
};
