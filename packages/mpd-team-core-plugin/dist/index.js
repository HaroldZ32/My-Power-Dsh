// packages/mpd-team-core-plugin/src/index.ts
import { existsSync as existsSync7, readdirSync as readdirSync6 } from "node:fs";
import { join as join12 } from "node:path";

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
      const questionService = service("userQuestions");
      const dshGoService = service("dshGo");
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
        dshGo: dshGoService !== undefined && dshGoService !== null
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
      const bridge = service("dshGo");
      return bridge !== undefined && bridge !== null;
    },
    dshGoPanel(id, spec) {
      const bridge = service("dshGo");
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
      const bridge = service("dshGo");
      if (bridge === undefined || bridge === null || typeof bridge.refresh !== "function")
        return;
      try {
        bridge.refresh(id);
      } catch {}
    },
    dshGoOn(id, handler) {
      const on = callableMember(service("dshGo"), "on");
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
      const strip = callableMember(service("dshGo"), "strip");
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
      const bridge = service("dshGo");
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

// packages/mpd-team-core-plugin/src/tool-cards.ts
var CELL_LIMIT = 60;
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(source, key) {
  const found = source[key];
  return isRecord3(found) ? found : {};
}
function arrayAt(source, key) {
  const found = source[key];
  return Array.isArray(found) ? found : [];
}
function firstRows(candidates) {
  for (const candidate of candidates)
    if (candidate.length > 0)
      return candidate;
  return [];
}
function words(value, limit = 200) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    return;
  const flat = String(value).replace(/\s+/g, " ").trim();
  if (flat === "")
    return;
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`;
}
function numberOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function cell(value, limit = CELL_LIMIT) {
  return words(value, limit) ?? "—";
}
function addFact(facts, name, value) {
  const shown = numberOf(value) ?? words(value, 120);
  if (shown !== undefined && facts.length < 24)
    facts.push([name, shown]);
}
function taskRow(row) {
  const task = isRecord3(row) ? row : {};
  return [cell(task.id, 12), cell(task.subject, 48), cell(task.status, 12), cell(task.owner, 24)];
}
function memberRow(row) {
  const member = isRecord3(row) ? row : {};
  return [cell(member.name, 24), cell(member.status, 12), cell(member.role, 24)];
}
function relatedRow(row) {
  const related = isRecord3(row) ? row : {};
  return [cell(isRecord3(row) ? related.id : row, 12), cell(related.subject, 48)];
}
function agentTeamsPlanCard(args, value) {
  const call = isRecord3(args) ? args : {};
  const answer = isRecord3(value) ? value : {};
  const action = words(call.action, 24) ?? "status";
  const plan = recordAt(answer, "plan");
  const team = recordAt(answer, "team");
  const created = recordAt(answer, "created");
  const members = firstRows([arrayAt(team, "members"), arrayAt(answer, "members"), arrayAt(plan, "members"), arrayAt(created, "members")]);
  const tasks = firstRows([arrayAt(team, "tasks"), arrayAt(answer, "tasks"), arrayAt(plan, "tasks"), arrayAt(created, "tasks")]);
  const summary = recordAt(answer, "summary");
  const facts = [];
  addFact(facts, "plan", plan.planId);
  addFact(facts, "approval", plan.approval);
  addFact(facts, "team", team.teamId);
  addFact(facts, "total", summary.total);
  addFact(facts, "completed", summary.completed);
  addFact(facts, "running", summary.running);
  addFact(facts, "ready", summary.ready);
  addFact(facts, "appended", answer.appended);
  addFact(facts, "archived to", answer.archivedTo);
  addFact(facts, "stopped at", answer.stoppedAt);
  const children = [
    metric({ label: "members", value: members.length }),
    metric({ label: "tasks", value: tasks.length })
  ];
  if (facts.length > 0)
    children.push(keyValue(facts));
  const description = words(plan.description, 200);
  if (description !== undefined)
    children.push(text(description));
  if (tasks.length > 0)
    children.push(table({ columns: ["id", "subject", "status", "owner"], rows: tasks.slice(0, 12).map(taskRow) }));
  if (members.length > 0)
    children.push(table({ columns: ["name", "status", "role"], rows: members.slice(0, 8).map(memberRow) }));
  return stack(children, { title: `plan · ${action}` });
}
function agentTeamsTaskCard(args, value) {
  const call = isRecord3(args) ? args : {};
  const answer = isRecord3(value) ? value : {};
  const action = words(call.action, 24) ?? "claim";
  const task = recordAt(answer, "task");
  const contract = recordAt(answer, "contract");
  const occupancy = answer.provenance !== undefined;
  const facts = [];
  addFact(facts, "task", answer.taskId ?? task.id ?? contract.taskId);
  addFact(facts, "status", answer.status ?? task.status);
  addFact(facts, "closed by", answer.closedBy);
  addFact(facts, "attempt", answer.attempt ?? contract.attempt);
  addFact(facts, "revision", answer.revision);
  addFact(facts, "released", answer.released);
  addFact(facts, "note", answer.note ?? task.note);
  addFact(facts, "file", answer.path);
  addFact(facts, "member", answer.member);
  addFact(facts, "mode", answer.mode);
  addFact(facts, "provenance", answer.provenance);
  addFact(facts, "fenced", answer.fenced);
  addFact(facts, "refused", answer.refused);
  const children = [];
  if (occupancy) {
    children.push(metric({ label: "used", value: numberOf(answer.usedTokens) ?? "?" }));
    children.push(metric({ label: "window", value: numberOf(answer.windowTokens) ?? "no window" }));
  }
  if (facts.length > 0)
    children.push(keyValue(facts));
  const related = firstRows([arrayAt(answer, "dependents"), arrayAt(answer, "added")]);
  if (related.length > 0)
    children.push(table({ columns: ["task", "subject"], rows: related.slice(0, 12).map(relatedRow) }));
  const unresolved = arrayAt(answer, "unresolved");
  if (unresolved.length > 0)
    children.push(table({ columns: ["reference"], rows: unresolved.slice(0, 8).map((item) => [cell(item)]) }));
  if (children.length === 0)
    return null;
  return stack(children, { title: `task · ${action}` });
}
function agentTeamsDispatchCard(args, value) {
  const call = isRecord3(args) ? args : {};
  const answer = isRecord3(value) ? value : {};
  const action = words(call.action, 24) ?? "run";
  const pairs = arrayAt(answer, "pairs");
  const skipped = arrayAt(answer, "skipped");
  const reassigned = arrayAt(answer, "reassigned");
  const facts = [];
  addFact(facts, "released", answer.released);
  addFact(facts, "task", answer.taskId);
  addFact(facts, "status", answer.status);
  addFact(facts, "revision", answer.revision);
  addFact(facts, "halted", answer.halted);
  addFact(facts, "hold read", answer.holdRead);
  addFact(facts, "refused", answer.refused);
  addFact(facts, "reaped", arrayAt(answer, "reaped").length);
  addFact(facts, "forgotten", arrayAt(answer, "forgotten").length);
  const children = [];
  if (pairs.length > 0 || skipped.length > 0 || reassigned.length > 0) {
    children.push(metric({ label: "paired", value: pairs.length }));
    children.push(metric({ label: "skipped", value: skipped.length }));
    children.push(metric({ label: "handed over", value: reassigned.length }));
  }
  if (facts.length > 0)
    children.push(keyValue(facts));
  if (pairs.length > 0)
    children.push(table({ columns: ["subject", "member", "note"], rows: pairs.slice(0, 12).map(pairRow) }));
  if (skipped.length > 0)
    children.push(table({ columns: ["subject", "reason"], rows: skipped.slice(0, 8).map(skippedRow) }));
  if (reassigned.length > 0)
    children.push(table({ columns: ["task", "owner", "delivered"], rows: reassigned.slice(0, 8).map(handoverRow) }));
  if (children.length === 0)
    return null;
  return stack(children, { title: `dispatch · ${action}` });
}
function pairRow(row) {
  const pair = isRecord3(row) ? row : {};
  return [cell(pair.subject, 48), cell(pair.memberName, 24), cell(pair.note, 48)];
}
function skippedRow(row) {
  const skip = isRecord3(row) ? row : {};
  return [cell(skip.subject, 48), cell(skip.reason, 60)];
}
function handoverRow(row) {
  const handover = isRecord3(row) ? row : {};
  return [cell(handover.taskId, 12), cell(handover.owner, 24), handover.delivered === true ? "yes" : "NOT delivered"];
}

// packages/mpd-team-core-plugin/src/mailbox-store.ts
import { appendFileSync, existsSync, mkdirSync as mkdirSync2, readFileSync } from "node:fs";
import { join as join2 } from "node:path";

// packages/mpd-mail-protocol/src/types.ts
function isMailKind(value) {
  return value === "message" || value === "question" || value === "answer";
}
var INDEX_FIELD_NAMES = [
  "index",
  "indexes",
  "indices",
  "optionIndex",
  "optionIndices",
  "selectedIndex",
  "selectedIndices",
  "optionNumber",
  "optionNumbers"
];
// packages/mpd-mail-protocol/src/validate.ts
function problem(code, message, labels) {
  return labels === undefined ? { code, message } : { code, message, labels: [...labels] };
}
function check(problems) {
  return problems.length === 0 ? { ok: true } : { ok: false, problems: [...problems] };
}
function appendProblems(target, nested) {
  if (!nested.ok)
    target.push(...nested.problems);
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function findIndexFields(value) {
  const found = [];
  const seen = new Set;
  const walk = (current, path, depth) => {
    if (depth > 16 || current === null || typeof current !== "object")
      return;
    if (seen.has(current))
      return;
    seen.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, path + "[" + String(index) + "]", depth + 1));
      return;
    }
    for (const [key, entry] of Object.entries(current)) {
      const childPath = path + "." + key;
      if (INDEX_FIELD_NAMES.includes(key))
        found.push(childPath);
      walk(entry, childPath, depth + 1);
    }
  };
  walk(value, "$", 0);
  return found;
}
function labelsOf(question) {
  const options = question.options;
  if (!Array.isArray(options))
    return [];
  return options.map((option) => String(option?.label ?? "")).filter((label) => label !== "");
}
function validateQuestion(question) {
  if (!isPlainObject(question))
    return check([problem("kind-payload", "a question payload must be an object")]);
  const problems = [];
  for (const path of findIndexFields(question)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "a question must carry a non-empty `questionId`; every answer copies it"));
  }
  const options = question.options;
  if (!Array.isArray(options) || options.length === 0) {
    problems.push(problem("question-empty", "a question must offer at least one option"));
  }
  const labels = [];
  if (Array.isArray(options)) {
    options.forEach((option, index) => {
      const label = option?.label;
      if (typeof label !== "string" || label.trim() === "") {
        problems.push(problem("option-label", "option " + String(index + 1) + " has an empty label"));
        return;
      }
      if (labels.includes(label)) {
        problems.push(problem("option-label", "duplicate option label: " + JSON.stringify(label) + " — labels must be unique within a question"));
        return;
      }
      labels.push(label);
    });
  }
  if (typeof question.question !== "string" || question.question.trim() === "") {
    problems.push(problem("question-empty", "the question text is empty"));
  }
  return check(problems);
}
function validateAnswer(answer, question) {
  if (!isPlainObject(answer))
    return check([problem("kind-payload", "an answer payload must be an object")]);
  const problems = [];
  for (const path of findIndexFields(answer)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (typeof answer.questionId !== "string" || answer.questionId.trim() === "") {
    problems.push(problem("answer-question-id", "an answer must carry the question's non-empty `questionId`"));
  }
  const selected = answer.selected;
  const selectedIsArray = Array.isArray(selected);
  if (!selectedIsArray) {
    problems.push(problem("answer-selection", "`selected` must be an array of offered label strings"));
  }
  const picked = [];
  if (selectedIsArray) {
    selected.forEach((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        problems.push(problem("answer-selection", "selected entry " + String(index + 1) + " is not a non-empty label string"));
        return;
      }
      picked.push(entry);
    });
  }
  const custom = answer.custom;
  if (custom !== undefined && (typeof custom !== "string" || custom.trim() === "")) {
    problems.push(problem("answer-selection", "`custom`, when present, must be non-empty text"));
  }
  if (typeof answer.answerTo !== "string" || answer.answerTo.trim() === "") {
    problems.push(problem("reference-unknown", "an answer must name the question message it answers (`answerTo`)"));
  }
  const hasCustom = typeof custom === "string" && custom.trim() !== "";
  if (question === undefined) {
    if (selectedIsArray && picked.length === 0 && !hasCustom) {
      problems.push(problem("answer-selection", "an answer must select at least one offered label or give `custom`"));
    }
    return check(problems);
  }
  const offered = labelsOf(question);
  for (const label of picked) {
    if (!offered.includes(label)) {
      problems.push(problem("answer-unknown-label", "selected label is not offered by the question: " + JSON.stringify(label), offered));
    }
  }
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "the referenced question has an empty `questionId`, so no answer can be correlated"));
  } else if (typeof answer.questionId === "string" && answer.questionId.trim() !== "" && answer.questionId !== question.questionId) {
    problems.push(problem("answer-question-id", "`questionId` " + JSON.stringify(answer.questionId) + " does not match the referenced question's `questionId` " + JSON.stringify(question.questionId)));
  }
  if (selectedIsArray) {
    if (question.multiSelect === true) {
      if (picked.length < 1) {
        problems.push(problem("answer-selection", "a multi-select answer must select at least one offered label"));
      }
    } else if (picked.length > 1) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label; got " + String(picked.length)));
    } else if (picked.length === 1) {
      if (hasCustom) {
        problems.push(problem("answer-selection", "a single-select answer must not combine a selected label with `custom`; give exactly one or the other"));
      }
    } else if (!hasCustom) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label or give `custom`"));
    }
  }
  return check(problems);
}
function validateEnvelope(envelope) {
  if (!isPlainObject(envelope))
    return check([problem("envelope", "a mail envelope must be an object")]);
  const problems = [];
  for (const path of findIndexFields(envelope)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path));
  }
  if (!isMailKind(envelope.kind)) {
    problems.push(problem("kind-payload", "`kind` must be `message`, `question` or `answer`; got " + JSON.stringify(envelope.kind)));
    return check(problems);
  }
  if (envelope.kind === "message") {
    if (envelope.question !== undefined)
      problems.push(problem("kind-payload", "a `message` row must not carry a question payload"));
    if (envelope.answer !== undefined)
      problems.push(problem("kind-payload", "a `message` row must not carry an answer payload"));
  } else if (envelope.kind === "question") {
    if (envelope.question === undefined)
      problems.push(problem("kind-payload", "a `question` row must carry its question payload"));
    else
      appendProblems(problems, validateQuestion(envelope.question));
    if (envelope.answer !== undefined)
      problems.push(problem("kind-payload", "a `question` row must not carry an answer payload"));
  } else {
    if (envelope.answer === undefined)
      problems.push(problem("kind-payload", "an `answer` row must carry its answer payload"));
    else
      appendProblems(problems, validateAnswer(envelope.answer));
    if (envelope.question !== undefined)
      problems.push(problem("kind-payload", "an `answer` row must not carry a question payload"));
  }
  return check(problems);
}
function validateReferences(envelope, messages) {
  const problems = [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  if (envelope.replyTo !== undefined) {
    if (typeof envelope.replyTo !== "string" || !byId.has(envelope.replyTo)) {
      problems.push(problem("reference-unknown", "`replyTo` names no message in this mailbox: " + JSON.stringify(envelope.replyTo)));
    }
  }
  if (envelope.kind === "answer" && envelope.answer !== undefined) {
    const target = byId.get(envelope.answer.answerTo);
    if (target === undefined) {
      problems.push(problem("reference-unknown", "`answerTo` names no message in this mailbox: " + JSON.stringify(envelope.answer.answerTo)));
    } else if (target.kind !== "question") {
      problems.push(problem("reference-not-question", "`answerTo` must name a `question` row; " + target.id + " is a `" + target.kind + "` row"));
    } else if (target.question !== undefined) {
      appendProblems(problems, validateAnswer(envelope.answer, target.question));
    } else {
      problems.push(problem("question-payload-missing", "the referenced `question` row " + target.id + " carries no question payload, so its offered labels cannot be checked"));
      appendProblems(problems, validateAnswer(envelope.answer));
    }
  }
  return check(problems);
}
function inheritedThreadId(envelope, byId) {
  if (typeof envelope.threadId === "string" && envelope.threadId !== "")
    return envelope.threadId;
  if (typeof envelope.replyTo === "string" && envelope.replyTo !== "")
    return byId.get(envelope.replyTo)?.threadId;
  return;
}
function fanOutTargets(senderId, targets) {
  const out = [];
  const seen = new Set;
  for (const target of targets) {
    if (target.id === "" || target.id === senderId || seen.has(target.id))
      continue;
    seen.add(target.id);
    out.push({ id: target.id, name: target.name });
  }
  return out;
}
// packages/mpd-mail-protocol/src/fold.ts
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function textOf(value) {
  if (typeof value === "string")
    return value;
  return value === undefined || value === null ? "" : String(value);
}
function objectOf(value) {
  return isPlainObject2(value) ? value : undefined;
}
function foldSend(state, record, line) {
  const id = record.id;
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `send` row has no id, skipped");
    return;
  }
  if (state.byId.has(id)) {
    state.problems.push("line " + String(line) + ": duplicate `send` id " + JSON.stringify(id) + "; the FIRST write wins and this row is ignored");
    return;
  }
  const kindValue = record.kind;
  const kind = isMailKind(kindValue) ? kindValue : "message";
  if (kindValue !== undefined && !isMailKind(kindValue)) {
    state.problems.push("line " + String(line) + ": unknown kind " + JSON.stringify(kindValue) + ", folded as `message`");
  }
  const replyTo = typeof record.replyTo === "string" && record.replyTo !== "" ? record.replyTo : undefined;
  const statedThread = typeof record.threadId === "string" && record.threadId !== "" ? record.threadId : undefined;
  let question = objectOf(record.question);
  let answer = objectOf(record.answer);
  if (kind === "question" && question === undefined) {
    state.problems.push("line " + String(line) + ": a `question` row has no question payload");
  }
  if (kind === "answer" && answer === undefined) {
    state.problems.push("line " + String(line) + ": an `answer` row has no answer payload");
  }
  if (kind !== "question" && question !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries a question payload, dropped");
    question = undefined;
  }
  if (kind !== "answer" && answer !== undefined) {
    state.problems.push("line " + String(line) + ": a `" + kind + "` row carries an answer payload, dropped");
    answer = undefined;
  }
  if (replyTo !== undefined && !state.byId.has(replyTo)) {
    state.problems.push("line " + String(line) + ": `replyTo` " + JSON.stringify(replyTo) + " names no folded message; the reply re-roots on its own id");
  }
  if (statedThread !== undefined && statedThread !== id && !state.byId.has(statedThread)) {
    state.problems.push("line " + String(line) + ": explicit `threadId` " + JSON.stringify(statedThread) + " names no folded message; kept as declared");
  }
  const inherited = inheritedThreadId({
    kind,
    ...replyTo === undefined ? {} : { replyTo },
    ...statedThread === undefined ? {} : { threadId: statedThread }
  }, state.byId);
  const message = {
    id,
    kind,
    fromId: textOf(record.fromId),
    fromName: textOf(record.fromName),
    toId: textOf(record.toId),
    toName: textOf(record.toName),
    subject: textOf(record.subject),
    body: textOf(record.body),
    sentAt: textOf(record.at),
    threadId: inherited ?? id,
    ...typeof record.teamId === "string" && record.teamId !== "" ? { teamId: record.teamId } : {},
    ...replyTo === undefined ? {} : { replyTo },
    ...question === undefined ? {} : { question },
    ...answer === undefined ? {} : { answer }
  };
  state.byId.set(id, message);
}
function foldStateRecord(state, record, line) {
  const id = record.id;
  if (typeof id !== "string" || id === "") {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row has no id, skipped");
    return;
  }
  const message = state.byId.get(id);
  if (message === undefined) {
    state.problems.push("line " + String(line) + ": a `" + String(record.t) + "` row references unfolded message " + JSON.stringify(id));
    return;
  }
  if (record.t === "delivered") {
    message.deliveredAt = textOf(record.at);
    return;
  }
  message.readAt = textOf(record.at);
  const by = record.by;
  if (typeof by === "string" && by !== "")
    message.readBy = by;
}
function foldMail(records) {
  const state = { byId: new Map, problems: [] };
  records.forEach((raw, index) => {
    if (!isPlainObject2(raw)) {
      state.problems.push("line " + String(index + 1) + ": not a JSON object, skipped");
      return;
    }
    if (raw.t === "send") {
      foldSend(state, raw, index + 1);
      return;
    }
    if (raw.t === "delivered" || raw.t === "read") {
      foldStateRecord(state, raw, index + 1);
      return;
    }
  });
  return { messages: [...state.byId.values()], problems: state.problems };
}
// packages/mpd-team-core-plugin/src/mailbox-store.ts
function pageOf(rows, limit, offset) {
  const size = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 100) : 20;
  const start = Number.isFinite(Number(offset)) ? Math.max(Math.trunc(Number(offset)), 0) : 0;
  const page = rows.slice(start, start + size);
  const more = Math.max(rows.length - (start + page.length), 0);
  return { page, more, nextOffset: more === 0 ? null : start + page.length, limit: size, offset: start };
}
var MAIL_BODY_MAX = 4000;
function truncateMailBody(text2) {
  if (text2.length <= MAIL_BODY_MAX)
    return { body: text2, truncated: false, originalLength: text2.length };
  return { body: text2.slice(0, MAIL_BODY_MAX), truncated: true, originalLength: text2.length };
}
function mailboxPath(workspace) {
  return join2(workspace, ".mpd", "team", "mailbox.jsonl");
}
function fold(records) {
  const folded = foldMail(records);
  const messages = folded.messages;
  const stamps = new Map;
  for (const raw of records) {
    if (raw === null || typeof raw !== "object")
      continue;
    const line = raw;
    if (line.t !== "send" || typeof line.id !== "string" || line.id === "")
      continue;
    if (stamps.has(line.id))
      continue;
    const cellId = typeof line.cellId === "string" && line.cellId !== "" ? line.cellId : undefined;
    const fromCell = typeof line.fromCell === "string" && line.fromCell !== "" ? line.fromCell : undefined;
    const fromMemberId = typeof line.fromMemberId === "string" && line.fromMemberId !== "" ? line.fromMemberId : undefined;
    const truncated = line.truncated === true ? true : undefined;
    const originalLength = typeof line.originalLength === "number" ? line.originalLength : undefined;
    if (cellId === undefined && fromCell === undefined && fromMemberId === undefined && truncated === undefined && originalLength === undefined)
      continue;
    stamps.set(line.id, {
      ...cellId === undefined ? {} : { cellId },
      ...fromCell === undefined ? {} : { fromCell },
      ...fromMemberId === undefined ? {} : { fromMemberId },
      ...truncated === undefined ? {} : { truncated },
      ...originalLength === undefined ? {} : { originalLength }
    });
  }
  return {
    messages: messages.map((message) => ({ ...message, ...stamps.get(message.id) ?? {} })),
    problems: [...folded.problems]
  };
}
function readRecords(workspace) {
  const path = mailboxPath(workspace);
  if (!existsSync(path))
    return [];
  let text2 = "";
  try {
    text2 = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text2.split(`
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
function recordWake(workspace, id, outcome, now) {
  const record = {
    t: "wake",
    id,
    sent: outcome.sent,
    ...outcome.reason === undefined || outcome.reason === "" ? {} : { reason: outcome.reason },
    at: now.toISOString()
  };
  appendRecord(workspace, record);
  return record;
}
function inboxOf(state, memberId) {
  return state.messages.filter((message) => message.toId === memberId);
}
function unreadOf(state, memberId) {
  return inboxOf(state, memberId).filter((message) => message.readAt === undefined);
}
function isOutstanding(message) {
  return message.deliveredAt === undefined && message.readAt === undefined;
}
function undeliveredOf(state, memberId) {
  return inboxOf(state, memberId).filter(isOutstanding);
}
function scopeToTeam(state, teamId) {
  if (teamId === undefined || teamId === "")
    return state;
  return {
    messages: state.messages.filter((message) => message.teamId === teamId),
    ...state.problems === undefined ? {} : { problems: state.problems }
  };
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
    if (isOutstanding(message))
      entry.undelivered += 1;
  }
  return order.map((id) => seen.get(id));
}
function resolveRecipients(directory, to) {
  const spelling = to.trim();
  const alias = spelling.toLowerCase();
  const all = directory.lead === undefined ? [...directory.members] : [...directory.members, directory.lead];
  const names = all.map((address) => address.name === "" ? address.id : address.name).join(", ");
  if (spelling === "*") {
    return { ok: true, targets: fanOutTargets(directory.selfId, all), broadcast: true };
  }
  if (alias === "captain" || alias === "lead") {
    if (directory.lead === undefined) {
      return { ok: false, reason: "unknown-recipient", detail: `this team records no lead, so "${spelling}" is not addressable (members: ${names || "none"})` };
    }
    return { ok: true, targets: [{ id: directory.lead.id, name: "captain" }], broadcast: false };
  }
  const member = directory.members.find((address) => address.id === spelling) ?? directory.members.find((address) => address.name === spelling);
  if (member === undefined) {
    return { ok: false, reason: "unknown-recipient", detail: `"${spelling}" is not a member of this team (members: ${names || "none"})` };
  }
  return { ok: true, targets: [{ id: member.id, name: member.name }], broadcast: false };
}
function problemsSentence(check2) {
  return check2.problems.map((problem2) => problem2.labels === undefined ? problem2.message : `${problem2.message} (valid labels: ${problem2.labels.join(", ")})`).join("; ");
}
function unauthorizedAnswer(messageId) {
  return "only a recipient of the question may answer it: " + messageId;
}
function sendMany(workspace, input, targets, now) {
  const replyTo = input.replyTo !== undefined && input.replyTo !== "" ? input.replyTo : input.kind === "answer" && input.answer !== undefined && input.answer.answerTo !== "" ? input.answer.answerTo : undefined;
  const envelope = {
    kind: input.kind ?? "message",
    ...replyTo === undefined ? {} : { replyTo },
    ...input.threadId === undefined || input.threadId === "" ? {} : { threadId: input.threadId },
    ...input.question === undefined ? {} : { question: input.question },
    ...input.answer === undefined ? {} : { answer: input.answer }
  };
  const addressable = new Set([...input.memberIds, ...input.leadIds ?? []]);
  const senderIds = new Set([input.fromId, ...input.fromMemberId === undefined || input.fromMemberId === "" ? [] : [input.fromMemberId]]);
  for (const target of targets) {
    if (senderIds.has(target.id))
      return { ok: false, reason: "self", detail: "a team member cannot message itself" };
    if (!addressable.has(target.id))
      return { ok: false, reason: "unknown-recipient", detail: `"${target.name || target.id}" is not a member of this team` };
  }
  const envelopeCheck = validateEnvelope(envelope);
  if (!envelopeCheck.ok) {
    return { ok: false, reason: "invalid-envelope", detail: problemsSentence(envelopeCheck) };
  }
  const state = readMailbox(workspace);
  const scoped = scopeToTeam(state, input.teamId);
  const workspaceById = new Map(state.messages.map((message) => [message.id, message]));
  if (envelope.kind === "answer" && envelope.answer !== undefined) {
    if (envelope.replyTo !== undefined && envelope.replyTo !== envelope.answer.answerTo) {
      return { ok: false, reason: "invalid-envelope", detail: "an answer's `replyTo` must be the question message it answers (`answerTo`)" };
    }
    const asked = workspaceById.get(envelope.answer.answerTo);
    if (asked === undefined || asked.kind !== "question") {
      return { ok: false, reason: "not-recipient", detail: unauthorizedAnswer(envelope.answer.answerTo) };
    }
    const senderIds2 = new Set([input.fromId, ...input.fromMemberId === undefined || input.fromMemberId === "" ? [] : [input.fromMemberId]]);
    const askerIds = new Set([asked.fromId, ...asked.fromMemberId === undefined ? [] : [asked.fromMemberId]].filter((id) => id !== ""));
    if (!senderIds2.has(asked.toId)) {
      return { ok: false, reason: "not-recipient", detail: unauthorizedAnswer(envelope.answer.answerTo) };
    }
    for (const target of targets) {
      if (!askerIds.has(target.id)) {
        return { ok: false, reason: "not-recipient", detail: `an answer goes back to the asker ("${asked.fromName}"), not to "${target.name || target.id}"` };
      }
    }
  }
  const referenceCheck = validateReferences(envelope, state.messages);
  if (!referenceCheck.ok) {
    return { ok: false, reason: "invalid-envelope", detail: problemsSentence(referenceCheck) };
  }
  const cap = input.maxUndelivered ?? 8;
  for (const target of targets) {
    const backlog = undeliveredOf(scoped, target.id).length;
    if (cap > 0 && backlog >= cap) {
      return { ok: false, reason: "backlog-full", detail: `"${target.name || target.id}" already has ${backlog} undelivered message(s) (bound ${cap}) — it is not keeping up` };
    }
  }
  const at = now.toISOString();
  const stem = `mail-${at.replace(/[-:.TZ]/g, "").slice(0, 14)}-`;
  const ids = targets.map((_target, index) => stem + (state.messages.length + 1 + index).toString().padStart(3, "0"));
  const threadById = envelope.kind === "answer" ? workspaceById : new Map(scoped.messages.map((message) => [message.id, message]));
  const threadId = inheritedThreadId(envelope, threadById) ?? ids[0];
  const storedBody = truncateMailBody(input.body);
  const messages = targets.map((target, index) => ({
    id: ids[index],
    kind: envelope.kind,
    ...envelope.replyTo === undefined ? {} : { replyTo: envelope.replyTo },
    threadId,
    ...envelope.question === undefined ? {} : { question: envelope.question },
    ...envelope.answer === undefined ? {} : { answer: envelope.answer },
    fromId: input.fromId,
    fromName: input.fromName,
    toId: target.id,
    toName: target.name,
    subject: input.subject,
    body: storedBody.body,
    ...storedBody.truncated ? { truncated: true, originalLength: storedBody.originalLength } : {},
    sentAt: at,
    ...input.teamId === undefined || input.teamId === "" ? {} : { teamId: input.teamId },
    ...input.cellId === undefined || input.cellId === "" ? {} : { cellId: input.cellId },
    ...input.fromCell === undefined || input.fromCell === "" ? {} : { fromCell: input.fromCell },
    ...input.fromMemberId === undefined || input.fromMemberId === "" ? {} : { fromMemberId: input.fromMemberId }
  }));
  for (const message of messages)
    appendRecord(workspace, { t: "send", ...message, at });
  return { ok: true, messages };
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
function acknowledge(workspace, ids, ack, now) {
  const state = readMailbox(workspace);
  const byId = new Map(state.messages.map((message) => [message.id, message]));
  const moved = [];
  const refused = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (message === undefined || message.readAt !== undefined)
      continue;
    if (message.toId !== ack.byId) {
      refused.push({ id, reason: `${id} was addressed to "${message.toName}", not to "${ack.byName}" — only its recipient may acknowledge it` });
      continue;
    }
    appendRecord(workspace, { t: "read", id, at: now.toISOString(), by: ack.byName });
    moved.push(id);
  }
  return { moved, refused };
}

// packages/mpd-team-core-plugin/src/mail-permit.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { appendFileSync as appendFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var PERMIT_SCOPES = ["answer", "message"];
function isPermitScope(value) {
  return value === "answer" || value === "message";
}
var PERMIT_DEFAULT_TTL_MS = 60000;
var PERMIT_MAX_TTL_MS = 600000;
var WAIT_MAX_TIMEOUT_MS = 60000;
var WAIT_DEFAULT_TIMEOUT_MS = 15000;
var WAIT_POLL_INTERVAL_MS = 50;
function permitsPath(workspace) {
  return join3(workspace, ".mpd", "team", "permits.jsonl");
}
function readPermitRecords(workspace) {
  const path = permitsPath(workspace);
  if (!existsSync2(path))
    return [];
  let text2 = "";
  try {
    text2 = readFileSync2(path, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text2.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}
function isPermitRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const line = value;
  if (line.t !== "permit")
    return false;
  for (const field of ["permitId", "issuerId", "issuerName", "holderId", "holderName", "at"]) {
    if (typeof line[field] !== "string" || line[field].trim() === "")
      return false;
  }
  if (!isPermitScope(line.scope))
    return false;
  if (typeof line.ttlMs !== "number" || !Number.isFinite(line.ttlMs) || line.ttlMs <= 0)
    return false;
  if (typeof line.expiresAt !== "string" || !Number.isFinite(Date.parse(line.expiresAt)))
    return false;
  return line.questionId === undefined || typeof line.questionId === "string";
}
function foldPermits(records) {
  const permits = [];
  const problems = [];
  const seen = new Set;
  for (const raw of records) {
    if (!isPermitRecord(raw)) {
      problems.push('skipped a line that does not carry the permit shape (t:"permit" with every field)');
      continue;
    }
    if (seen.has(raw.permitId)) {
      problems.push(`skipped a duplicate permit id "${raw.permitId}" (the FIRST write wins)`);
      continue;
    }
    seen.add(raw.permitId);
    permits.push(raw);
  }
  return { permits, problems };
}
function readPermits(workspace) {
  return foldPermits(readPermitRecords(workspace));
}
function appendPermit(workspace, permit) {
  mkdirSync3(join3(workspace, ".mpd", "team"), { recursive: true });
  appendFileSync2(permitsPath(workspace), JSON.stringify(permit) + `
`);
}
function buildPermit(input, now) {
  const ttlMs = Math.min(Math.max(Math.floor(input.ttlMs), 1), PERMIT_MAX_TTL_MS);
  const questionId = input.questionId === undefined ? "" : input.questionId.trim();
  return {
    t: "permit",
    permitId: input.permitId === undefined || input.permitId.trim() === "" ? `permit-${randomUUID2()}` : input.permitId.trim(),
    issuerId: input.issuerId.trim(),
    issuerName: input.issuerName.trim(),
    holderId: input.holderId.trim(),
    holderName: input.holderName.trim(),
    scope: input.scope,
    ttlMs,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ...questionId === "" ? {} : { questionId },
    at: now.toISOString()
  };
}
function issuePermit(workspace, input, now) {
  if (input.issuerId.trim() === "" || input.holderId.trim() === "") {
    return { ok: false, detail: "a permit needs a non-empty issuer and holder — an unattributable grant can never be validated" };
  }
  const scope = input.scope === undefined ? "answer" : input.scope;
  if (!isPermitScope(scope)) {
    return { ok: false, detail: `scope must be one of ${PERMIT_SCOPES.map((entry) => `"${entry}"`).join(" or ")} — got ${JSON.stringify(input.scope ?? null)}` };
  }
  const requestedTtl = input.ttlMs === undefined ? PERMIT_DEFAULT_TTL_MS : Number(input.ttlMs);
  if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) {
    return { ok: false, detail: `ttlMs must be a positive number of milliseconds (bound ${PERMIT_MAX_TTL_MS}) — got ${JSON.stringify(input.ttlMs ?? null)}` };
  }
  const questionId = input.questionId === undefined ? "" : String(input.questionId).trim();
  const permit = buildPermit({
    issuerId: input.issuerId,
    issuerName: input.issuerName,
    holderId: input.holderId,
    holderName: input.holderName,
    scope,
    ttlMs: requestedTtl,
    ...questionId === "" ? {} : { questionId },
    ...input.permitId === undefined ? {} : { permitId: input.permitId }
  }, now);
  appendPermit(workspace, permit);
  return { ok: true, permit };
}
function checkPermit(permit, caller, now) {
  if (permit === undefined)
    return { ok: false, reason: "unknown", detail: "no such permit is recorded" };
  const expiresAt = Date.parse(permit.expiresAt);
  if (!Number.isFinite(expiresAt))
    return { ok: false, reason: "invalid", detail: `permit ${permit.permitId} carries no parsable expiresAt ("${permit.expiresAt}")` };
  const at = now.getTime();
  if (at >= expiresAt) {
    return { ok: false, reason: "expired", detail: `permit ${permit.permitId} expired at ${permit.expiresAt} (it is now ${now.toISOString()}) — ask its issuer for a fresh one` };
  }
  const spellings = new Set([caller.holderId, ...caller.sessionId === undefined ? [] : [caller.sessionId]].filter((value) => value !== ""));
  if (!spellings.has(permit.holderId) && (caller.holderName === "" || caller.holderName !== permit.holderName)) {
    return { ok: false, reason: "foreign-holder", detail: `permit ${permit.permitId} was issued to "${permit.holderName}" ("${permit.holderId}"), not to this caller` };
  }
  const leadIds = (caller.leadIds ?? []).filter((id) => id !== "");
  if (leadIds.length === 0)
    return { ok: false, reason: "foreign-issuer", detail: `permit ${permit.permitId} cannot be validated: this caller's team records no captain` };
  if (!leadIds.includes(permit.issuerId)) {
    return { ok: false, reason: "foreign-issuer", detail: `permit ${permit.permitId} was issued by "${permit.issuerName}" ("${permit.issuerId}"), who is not this caller's captain` };
  }
  const remaining = expiresAt - at;
  const requested = caller.requestedTimeoutMs === undefined || !Number.isFinite(caller.requestedTimeoutMs) ? WAIT_DEFAULT_TIMEOUT_MS : Math.max(0, Math.floor(caller.requestedTimeoutMs));
  const timeoutMs = Math.max(0, Math.min(requested, WAIT_MAX_TIMEOUT_MS, remaining));
  return { ok: true, permit, timeoutMs };
}
function checkWaitTarget(permit, target, holder) {
  const spellings = new Set([holder.holderId, ...holder.sessionId === undefined ? [] : [holder.sessionId]].filter((id) => id !== ""));
  if (!spellings.has(target.fromId)) {
    return { ok: false, reason: "foreign-target", detail: `permit ${permit.permitId} was issued to "${permit.holderName}", so it waits only on rows it SENT — "${target.id}" was sent by "${target.fromName}"` };
  }
  if (permit.scope === "answer" && target.kind !== "question") {
    return { ok: false, reason: "not-a-question", detail: `permit ${permit.permitId} has scope "answer", so it waits on a question; "${target.id}" is a ${target.kind} row` };
  }
  const questionId = permit.questionId;
  if (questionId !== undefined && questionId !== "" && target.question?.questionId !== questionId) {
    return { ok: false, reason: "wrong-question", detail: `permit ${permit.permitId} is scoped to question "${questionId}", but "${target.id}" carries "${target.question?.questionId ?? ""}"` };
  }
  return { ok: true };
}
function repliesTo(state, permit, target) {
  const questionId = target.question?.questionId;
  return state.messages.filter((message) => {
    if (message.id === target.id)
      return false;
    if (message.answer !== undefined && message.answer.answerTo === target.id) {
      if (permit.scope === "message")
        return true;
      return message.kind === "answer" && (questionId === undefined || message.answer.questionId === questionId);
    }
    return permit.scope === "message" && message.replyTo === target.id;
  });
}
async function waitForReply(context) {
  const intervalMs = Number.isFinite(context.intervalMs) ? Math.max(1, Math.floor(context.intervalMs ?? WAIT_POLL_INTERVAL_MS)) : WAIT_POLL_INTERVAL_MS;
  const timeoutMs = Number.isFinite(context.timeoutMs) ? Math.max(0, Math.floor(context.timeoutMs)) : 0;
  const startedAt = context.now().getTime();
  const deadline = startedAt + timeoutMs;
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1);
  let polls = 0;
  for (;; ) {
    polls += 1;
    const found = repliesTo(context.read(), context.permit, context.target);
    if (found.length > 0)
      return { ok: true, messages: found, polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) };
    if (context.signal?.aborted === true)
      return { ok: false, reason: "aborted", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) };
    if (polls >= maxPolls)
      return { ok: false, reason: "timeout", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) };
    const remaining = deadline - context.now().getTime();
    if (remaining <= 0)
      return { ok: false, reason: "timeout", polls, waitedMs: Math.max(0, context.now().getTime() - startedAt) };
    await context.sleep(Math.min(intervalMs, remaining));
  }
}

// packages/mpd-team-core-plugin/src/dispatch.ts
function dispatchNameKey(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function readonlyMemberKeys(rows) {
  const keys = new Set;
  for (const row of rows) {
    if (row?.readonly !== true)
      continue;
    const key = dispatchNameKey(row.name);
    if (key !== "")
      keys.add(key);
  }
  return keys;
}
function isReadonlyMemberName(name, keys) {
  const key = dispatchNameKey(name);
  if (key === "")
    return false;
  if (keys.has(key))
    return true;
  const withoutSuffix = key.replace(/-\d+$/, "");
  return withoutSuffix !== key && withoutSuffix !== "" && keys.has(withoutSuffix);
}
function pairingRefusal(task, member) {
  if (task.teamId !== undefined && member.teamId !== undefined && task.teamId !== member.teamId) {
    return `refused a CROSS-TEAM pairing: task ${task.id} belongs to ${task.teamId} while member ${JSON.stringify(member.name)} belongs to ${member.teamId}`;
  }
  if (task.writeScopes !== undefined && task.writeScopes.length > 0 && member.readonly === true) {
    return `refused a WRITE-TASK-ON-READ-ONLY pairing: task ${task.id} has write scopes (${task.writeScopes.join(", ")}) while member ${JSON.stringify(member.name)} is a read-only specialist`;
  }
  return;
}
function memberFenceReason(member) {
  if (member.fenced === true) {
    return "the compaction barrier gave up and fenced it" + (typeof member.fencedReason === "string" && member.fencedReason !== "" ? " (" + member.fencedReason + ")" : "");
  }
  if (member.mode === "checkpoint")
    return "its mode is `checkpoint` — the seat is fenced to the handoff tools until the barrier compacts it";
  return;
}
function ownerOnlyDecision(task, members, available, busy, paired) {
  const ownerKey = dispatchNameKey(task.ownerName ?? "");
  if (ownerKey === "") {
    return { reason: 'the row declares no owner — owner-only dispatch never substitutes a member (declare `owner` on the row, or run the pass with mode:"roster")' };
  }
  const owner = members.find((candidate) => dispatchNameKey(candidate.name) === ownerKey);
  if (owner === undefined) {
    return { reason: "declared owner " + JSON.stringify(String(task.ownerName ?? "")) + " is not on this team's roster — the row stays pending" };
  }
  const fence = memberFenceReason(owner);
  if (fence !== undefined) {
    return { reason: "declared owner " + JSON.stringify(owner.name) + " is FENCED (" + fence + ") — a fenced member is never messaged; reassign the row: agent_teams_dispatch {reassign:[{task_id:" + JSON.stringify(task.id) + ', owner:"<another member>"}]}' };
  }
  if (owner.status === "failed")
    return { reason: "declared owner " + JSON.stringify(owner.name) + " FAILED to start" };
  if (owner.status === "provisioning")
    return { reason: "declared owner " + JSON.stringify(owner.name) + " is still being raised" };
  const refusal = pairingRefusal(task, owner);
  if (refusal !== undefined)
    return { reason: refusal };
  if (!available.includes(owner)) {
    if (paired.has(ownerKey))
      return { reason: "declared owner " + JSON.stringify(owner.name) + " was already paired in this pass (one task per member)" };
    if (busy.has(owner.id))
      return { reason: "declared owner " + JSON.stringify(owner.name) + " is BUSY on another task — reported, never substituted" };
    return { reason: "declared owner " + JSON.stringify(owner.name) + " is not idle (status " + JSON.stringify(owner.status) + ")" };
  }
  return { member: owner };
}
var DISPATCH_KEY_SEPARATOR = "::";
function ledgerKey(teamId, taskId) {
  return teamId + DISPATCH_KEY_SEPARATOR + taskId;
}
function ledgerOfTeam(ledger, teamId) {
  const view = {};
  for (const [key, entry] of Object.entries(ledger)) {
    if (entry?.teamId === teamId)
      view[key] = entry;
  }
  return view;
}
function dispatchMessage(task, description) {
  return [
    `You have been assigned shared task ${task.id}: ${task.subject}`,
    "",
    description,
    "",
    "Work it on your own; do not wait for another member to start it.",
    `When it is done, close the row with agent_teams_task {action:"complete", task_id:"${task.id}"} — ` + `or {action:"fail", task_id:"${task.id}", note:"…"} if you could not finish it — and report the result to the Lead.`
  ].join(`
`);
}
function planDispatch(input) {
  if (input.hold !== undefined && input.hold !== "") {
    return { pairs: [], skipped: [], halted: input.hold };
  }
  const mode = input.mode ?? "owner-only";
  const busy = new Set(Object.values(input.ledger).filter((entry) => entry.taskId !== "" && entry.memberId !== "").map((entry) => entry.memberId));
  const claimed = new Set(Object.values(input.ledger).map((entry) => entry.taskId));
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id) && memberFenceReason(member) === undefined);
  const plan = { pairs: [], skipped: [] };
  let available = [...candidates];
  const paired = new Set;
  const cap = input.limit === undefined || input.limit <= 0 ? Number.POSITIVE_INFINITY : input.limit;
  for (const task of input.tasks) {
    if (plan.pairs.length >= cap) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "the pass reached its limit" });
      continue;
    }
    if (task.status === "cancelled") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "cancelled" });
      continue;
    }
    if (task.status === "completed") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" });
      continue;
    }
    if (claimed.has(task.id)) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `already dispatched to ${Object.values(input.ledger).find((entry) => entry.taskId === task.id)?.memberName ?? "a member"}` });
      continue;
    }
    if (task.ready !== true) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready${Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " (blocked by " + task.blockedBy.join(", ") + ")" : ""}` });
      continue;
    }
    if (mode === "owner-only") {
      const decision = ownerOnlyDecision(task, input.members, available, busy, paired);
      if (decision.member === undefined) {
        plan.skipped.push({ taskId: task.id, subject: task.subject, reason: decision.reason ?? "no eligible declared owner" });
        continue;
      }
      const owner = decision.member;
      available = available.filter((candidate) => candidate !== owner);
      paired.add(dispatchNameKey(owner.name));
      plan.pairs.push({ taskId: task.id, subject: task.subject, memberId: owner.id, memberName: owner.name });
      continue;
    }
    if (available.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "no idle member is free" });
      continue;
    }
    const eligible = available.filter((candidate) => pairingRefusal(task, candidate) === undefined);
    if (eligible.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: refusalSummary(task, available) });
      continue;
    }
    const ownerKey = dispatchNameKey(task.ownerName ?? "");
    const ownerIndex = ownerKey === "" ? -1 : eligible.findIndex((candidate) => dispatchNameKey(candidate.name) === ownerKey);
    const memberIndex = ownerIndex >= 0 ? ownerIndex : 0;
    const member = eligible[memberIndex];
    available = available.filter((candidate) => candidate !== member);
    paired.add(dispatchNameKey(member.name));
    const declaredOwner = ownerKey === "" ? undefined : input.members.find((candidate) => dispatchNameKey(candidate.name) === ownerKey);
    const ownerRefusal = declaredOwner === undefined ? undefined : pairingRefusal(task, declaredOwner);
    plan.pairs.push({
      taskId: task.id,
      subject: task.subject,
      memberId: member.id,
      memberName: member.name,
      ...ownerIndex >= 0 || ownerKey === "" ? {} : {
        note: "declared owner " + JSON.stringify(String(task.ownerName ?? "")) + " " + (ownerRefusal !== undefined ? "was passed over by a dispatch guard (" + ownerRefusal + ")" : declaredOwner === undefined ? "is not on this team's roster" : busy.has(declaredOwner.id) ? "is already working another task" : "is not idle (status " + JSON.stringify(declaredOwner.status) + ")") + "; paired the next eligible member " + JSON.stringify(member.name) + " instead"
      }
    });
  }
  return plan;
}
function readReassign(value) {
  const pairs = [];
  const invalid = [];
  if (value === undefined)
    return { pairs, invalid };
  if (!Array.isArray(value))
    return { pairs, invalid: ["`reassign` must be an array of {task_id, owner} objects"] };
  const seen = new Set;
  for (const entry of value) {
    const row = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : undefined;
    const taskId = typeof row?.task_id === "string" ? row.task_id.trim() : typeof row?.taskId === "string" ? row.taskId.trim() : "";
    const owner = typeof row?.owner === "string" ? row.owner.trim() : "";
    if (taskId === "" || owner === "") {
      invalid.push("every `reassign` entry needs a non-empty `task_id` and `owner` (got " + JSON.stringify(entry) + ")");
      continue;
    }
    if (seen.has(taskId)) {
      invalid.push("task " + JSON.stringify(taskId) + " is named twice in `reassign` — one claim per row per call");
      continue;
    }
    seen.add(taskId);
    pairs.push({ taskId, owner });
  }
  return { pairs, invalid };
}
function refusalSummary(task, members) {
  const reasons = new Set;
  for (const member of members) {
    const refusal = pairingRefusal(task, member);
    if (refusal !== undefined)
      reasons.add(refusal);
  }
  return [...reasons].join("; ");
}
function assign(ledger, pair, now) {
  return {
    ...ledger,
    [ledgerKey(pair.teamId, pair.taskId)]: {
      teamId: pair.teamId,
      taskId: pair.taskId,
      memberId: pair.memberId,
      memberName: pair.memberName,
      assignedAt: now.toISOString()
    }
  };
}
function release(ledger, teamId, taskId) {
  const key = ledgerKey(teamId, taskId);
  if (ledger[key] === undefined)
    return { ledger, released: false };
  const next = { ...ledger };
  delete next[key];
  return { ledger: next, released: true };
}
function forgetTeam(ledger, teamId) {
  const next = {};
  const forgotten = [];
  for (const [key, entry] of Object.entries(ledger)) {
    if (entry?.teamId !== teamId) {
      next[key] = entry;
      continue;
    }
    forgotten.push(typeof entry.taskId === "string" && entry.taskId !== "" ? entry.taskId : key);
  }
  return { ledger: next, forgotten };
}
function reconcile(ledger, teamId, tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const next = {};
  const forgotten = [];
  for (const [key, entry] of Object.entries(ledger)) {
    if (typeof entry?.teamId !== "string" || entry.teamId === "") {
      forgotten.push(typeof entry?.taskId === "string" && entry.taskId !== "" ? entry.taskId : key);
      continue;
    }
    if (entry.teamId !== teamId) {
      next[key] = entry;
      continue;
    }
    const task = byId.get(entry.taskId);
    if (task === undefined || task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      forgotten.push(entry.taskId);
      continue;
    }
    next[key] = entry;
  }
  return { ledger: next, forgotten };
}

// packages/mpd-team-core-plugin/src/plan-store.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync5, readFileSync as readFileSync4, readdirSync as readdirSync2, renameSync as renameSync3, rmSync as rmSync3, statSync as statSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join5 } from "node:path";

// packages/mpd-team-core-plugin/src/team-store.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync4, readFileSync as readFileSync3, readdirSync, renameSync as renameSync2, rmSync as rmSync2, writeFileSync } from "node:fs";
import { join as join4 } from "node:path";
var TASK_KINDS = ["requirement", "work", "review", "repair", "integration"];
function teamRoot(workspace) {
  return join4(workspace, ".mpd", "team");
}
function teamsDir(workspace) {
  return join4(teamRoot(workspace), "teams");
}
function teamRecordPath(workspace, teamId) {
  return join4(teamsDir(workspace), sanitizeId(teamId) + ".json");
}
function teamsIndexPath(workspace) {
  return join4(teamRoot(workspace), "teams.json");
}
function sanitizeId(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "");
  return cleaned === "" ? "unnamed" : cleaned;
}
function readJson(path) {
  try {
    const parsed = JSON.parse(readFileSync3(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}
function writeJson(path, value) {
  mkdirSync4(join4(path, ".."), { recursive: true });
  const temp = path + ".tmp-" + process.pid;
  writeFileSync(temp, JSON.stringify(value, null, 2) + `
`);
  renameSync2(temp, path);
}
var teamStateObservers = new Set;
function onTeamStateWritten(observer) {
  teamStateObservers.add(observer);
  return () => {
    teamStateObservers.delete(observer);
  };
}
function teamStateChanged(workspace) {
  for (const observer of [...teamStateObservers]) {
    try {
      observer(workspace);
    } catch {}
  }
}
var PROCESS_ID_TAG = Math.random().toString(36).slice(2, 6);
var idCounter = 0;
function nextIdSuffix() {
  idCounter += 1;
  return PROCESS_ID_TAG + "-" + idCounter.toString(36).padStart(3, "0");
}
function newTeamId(now) {
  return "team-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + nextIdSuffix();
}
function sessionKey(sessionId) {
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : "workspace";
}
function readTeamsIndex(workspace) {
  const index = readJson(teamsIndexPath(workspace));
  if (index === undefined || index.version !== 1 || index.active === null || typeof index.active !== "object" || Array.isArray(index.active)) {
    return { version: 1, active: {} };
  }
  return index;
}
function writeTeamsIndex(workspace, index) {
  writeJson(teamsIndexPath(workspace), index);
  teamStateChanged(workspace);
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
  const record = readJson(teamRecordPath(workspace, teamId));
  if (record === undefined || record.version !== 1)
    return;
  if (!Array.isArray(record.members) || !Array.isArray(record.tasks))
    return;
  return record;
}
function writeTeam(workspace, record) {
  writeJson(teamRecordPath(workspace, record.teamId), record);
  teamStateChanged(workspace);
}
function listTeams(workspace) {
  let names = [];
  try {
    names = readdirSync(teamsDir(workspace));
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
  const teamId = input.teamId ?? newTeamId(now);
  if (existsSync3(teamRecordPath(workspace, teamId))) {
    throw new Error(`team id "${teamId}" already exists in this workspace — refusing to overwrite a team record`);
  }
  const record = {
    version: 1,
    teamId,
    name: input.name,
    description: input.description,
    leadSessionId: sessionKey(input.leadSessionId),
    ...input.planId === undefined || input.planId === "" ? {} : { planId: input.planId },
    ...input.parentTeamId === undefined || input.parentTeamId === "" ? {} : { parentTeamId: input.parentTeamId },
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
function resolveBlockers(record, references) {
  const blockedBy = [];
  const unresolved = [];
  for (const reference of references) {
    const resolved = resolveBlocker(record, reference);
    blockedBy.push(resolved);
    if (!record.tasks.some((task) => task.id === resolved) && !unresolved.includes(reference))
      unresolved.push(reference);
  }
  return { blockedBy, unresolved };
}
function addTeamTask(record, input, now) {
  const subject = input.subject.trim();
  if (subject === "")
    return record;
  const blockers = resolveBlockers(record, input.blockedBy ?? []);
  const task = {
    id: "T" + record.nextTaskNumber,
    subject,
    description: input.description,
    kind: input.kind ?? "work",
    status: "pending",
    blockedBy: blockers.blockedBy,
    writeScopes: [...input.writeScopes ?? []],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    ...blockers.unresolved.length === 0 ? {} : { unresolvedBlockers: blockers.unresolved },
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
    const blockers = patch.blockedBy === undefined ? undefined : resolveBlockers(record, patch.blockedBy);
    const next = {
      ...task,
      updatedAt: now.toISOString(),
      revision: task.revision + 1,
      ...patch.status === undefined ? {} : { status: patch.status },
      ...patch.attempt === undefined ? {} : { attempt: patch.attempt },
      ...patch.round === undefined ? {} : { round: patch.round },
      ...patch.verdict === undefined ? {} : { verdict: patch.verdict },
      ...patch.executorRef === undefined ? {} : { executorRef: patch.executorRef },
      ...blockers === undefined ? {} : { blockedBy: blockers.blockedBy }
    };
    if (blockers !== undefined) {
      if (blockers.unresolved.length === 0)
        delete next.unresolvedBlockers;
      else
        next.unresolvedBlockers = blockers.unresolved;
    }
    if (patch.owner !== undefined) {
      if (patch.owner === "")
        delete next.owner;
      else
        next.owner = patch.owner;
    }
    if (patch.note !== undefined) {
      if (patch.note === "")
        delete next.note;
      else
        next.note = patch.note;
    }
    if (patch.status !== undefined) {
      if (patch.status === "in_progress" && next.startedAt === undefined)
        next.startedAt = now.toISOString();
      if (patch.status === "completed" || patch.status === "failed")
        next.finishedAt = now.toISOString();
      if (patch.status === "pending" || patch.status === "claimed" || patch.status === "in_progress" || patch.status === "cancelled")
        delete next.finishedAt;
    }
    if (patch.resetStartedAt === true)
      delete next.startedAt;
    return next;
  });
  return touched ? { ...record, tasks } : record;
}
function casClaimTask(fresh, taskId, owner, expectedRevision, now) {
  const task = fresh.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined)
    return { applied: false, reason: `task ${taskId} is no longer on the board` };
  if (task.revision !== expectedRevision) {
    return { applied: false, reason: `task ${taskId} changed while the pass was in flight (revision ${expectedRevision} -> ${task.revision})` };
  }
  if (task.status !== "pending")
    return { applied: false, reason: `task ${taskId} is now "${task.status}"` };
  return { applied: true, record: updateTeamTask(fresh, taskId, { owner, status: "in_progress" }, now) };
}
function casReleaseTask(fresh, taskId, expectedRevision, now) {
  const task = fresh.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined)
    return { applied: false, reason: `task ${taskId} is no longer on the board` };
  if (expectedRevision !== undefined && task.revision !== expectedRevision) {
    return { applied: false, reason: `task ${taskId} changed under you (revision ${expectedRevision} -> ${task.revision}); re-read it and retry` };
  }
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return { applied: false, reason: `task ${taskId} is already terminal ("${task.status}") and cannot be released` };
  }
  if (task.status !== "claimed" && task.status !== "in_progress") {
    return { applied: false, reason: `task ${taskId} is "${task.status}" and holds no dispatch to release` };
  }
  return { applied: true, record: updateTeamTask(fresh, taskId, { status: "pending", owner: "", resetStartedAt: true }, now) };
}
function authorizeRelease(record, taskId, caller, lead) {
  const task = record.tasks.find((candidate) => candidate.id === taskId);
  const isLead = lead || recordNamesLead(record, caller);
  if (task === undefined)
    return isLead ? undefined : `task ${taskId} is no longer on the board`;
  const isOwner = task.owner !== undefined && task.owner !== "" && caller.some((candidate) => nameMatches(candidate, String(task.owner)));
  if (isOwner || isLead)
    return;
  return task.owner === undefined || task.owner === "" ? `task ${taskId} has no owner and this caller is not this team's lead` : `task ${taskId} is owned by "${String(task.owner)}" and this caller is neither that owner nor this team's lead`;
}
function casCloseTask(fresh, input) {
  const task = fresh.tasks.find((candidate) => candidate.id === input.taskId);
  if (task === undefined)
    return { applied: false, reason: `task ${input.taskId} is no longer on the board` };
  if (input.expectedRevision !== undefined && task.revision !== input.expectedRevision) {
    return { applied: false, reason: `task ${input.taskId} changed under you (revision ${input.expectedRevision} -> ${task.revision}); re-read it and retry` };
  }
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return { applied: false, reason: `task ${input.taskId} is already terminal ("${task.status}")` };
  }
  const isOwner = task.owner !== undefined && input.caller.some((candidate) => nameMatches(candidate, String(task.owner)));
  const isRecordLead = recordNamesLead(fresh, input.caller);
  const isLead = input.lead || isRecordLead;
  if (!isOwner && !isLead) {
    return {
      applied: false,
      reason: task.owner === undefined ? `task ${input.taskId} has no owner to close it — claim it first` : `task ${input.taskId} is owned by "${String(task.owner)}" and this caller is neither that owner nor this team's lead`
    };
  }
  const record = updateTeamTask(fresh, input.taskId, {
    status: input.status,
    ...input.note === undefined || input.note === "" ? {} : { note: input.note }
  }, input.now);
  const closed = record.tasks.find((candidate) => candidate.id === task.id) ?? task;
  const dependents = [];
  for (const candidate of record.tasks) {
    if (candidate.id === task.id)
      continue;
    if (!candidate.blockedBy.includes(task.id))
      continue;
    if (candidate.status !== "pending" && candidate.status !== "claimed" && candidate.status !== "in_progress")
      continue;
    if (blockingDependencies(record.tasks, candidate.blockedBy).blocking.length > 0)
      continue;
    dependents.push({
      id: candidate.id,
      subject: candidate.subject,
      became: input.status === "failed" ? "released-by-failure" : "ready"
    });
  }
  return {
    applied: true,
    record,
    task: closed,
    closedBy: isOwner ? "owner" : "lead",
    attempt: closed.attempt ?? 0,
    dependents,
    status: input.status
  };
}
function nameMatches(a, b) {
  if (a === b)
    return true;
  const key = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const left = key(a);
  return left !== "" && left === key(b);
}
function recordNamesLead(record, caller) {
  const recorded = [String(record.leadSessionId ?? ""), ...record.leadHistory ?? []].filter((value) => value !== "");
  return recorded.some((spelling) => caller.some((candidate) => candidate !== "" && nameMatches(candidate, spelling)));
}
function memberIsCheckpoint(record, key) {
  const member = record.members.find((row) => row.id === key || row.name === key);
  return member?.mode === "checkpoint";
}
function memberNamedBy(record, caller) {
  if (!Array.isArray(record.members))
    return;
  return record.members.find((member) => {
    const spellings = [member.name, member.executorRef ?? ""].filter((value) => value !== "");
    return spellings.some((spelling) => caller.some((candidate) => candidate !== "" && nameMatches(candidate, spelling)));
  });
}
function recordNamesMember(record, caller) {
  return memberNamedBy(record, caller) !== undefined;
}
var LEAD_HISTORY_LIMIT = 8;
function rememberLead(record, sessionIds) {
  const history = [...record.leadHistory ?? []];
  let changed = false;
  for (const id of sessionIds) {
    if (id === "" || id === record.leadSessionId || history.includes(id))
      continue;
    history.push(id);
    changed = true;
  }
  if (!changed)
    return record;
  return { ...record, leadHistory: history.slice(-LEAD_HISTORY_LIMIT) };
}
function updateTeamMember(record, key, patch) {
  let touched = false;
  const members = record.members.map((member) => {
    if (member.id !== key && member.name !== key)
      return member;
    touched = true;
    const next = { ...member };
    if (patch.status !== undefined)
      next.status = patch.status;
    if (patch.executorRef !== undefined)
      next.executorRef = patch.executorRef;
    if (patch.route !== undefined)
      next.route = patch.route;
    if (patch.mode !== undefined)
      next.mode = patch.mode;
    if (patch.fenced === true)
      next.fenced = true;
    if (patch.fenced === false) {
      delete next.fenced;
      delete next.fencedReason;
    }
    if (patch.fencedReason !== undefined && patch.fenced !== false)
      next.fencedReason = patch.fencedReason;
    if (patch.handoff !== undefined)
      next.handoff = patch.handoff;
    if (patch.contextCheckpoint !== undefined)
      next.contextCheckpoint = patch.contextCheckpoint;
    if (patch.workmate !== undefined)
      next.workmate = patch.workmate;
    if (patch.workmateMode !== undefined)
      next.workmateMode = patch.workmateMode;
    if (patch.workmateReason !== undefined)
      next.workmateReason = patch.workmateReason;
    else if (patch.workmateMode !== undefined && patch.workmateMode !== "none")
      delete next.workmateReason;
    return next;
  });
  return touched ? { ...record, members } : record;
}
function removeTeamMember(record, key) {
  const members = record.members.filter((member) => member.id !== key && member.name !== key);
  return members.length === record.members.length ? record : { ...record, members };
}
function settleMember(record, sessionId, now) {
  const member = record.members.find((candidate) => candidate.executorRef === sessionId);
  if (member === undefined)
    return record;
  if (member.status !== "running")
    return record;
  const ownsOpenTask = record.tasks.some((task) => (task.status === "in_progress" || task.status === "claimed") && (task.owner === member.name || member.executorRef !== undefined && task.owner === member.executorRef));
  if (ownsOpenTask)
    return record;
  return { ...record, members: record.members.map((candidate) => candidate.id === member.id ? { ...candidate, status: "inactive" } : candidate) };
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
  const stack2 = [];
  const inStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (inStack.has(id)) {
      for (const entry of stack2.slice(stack2.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    inStack.add(id);
    stack2.push(id);
    for (const blocker of task.blockedBy)
      if (byId.has(blocker))
        visit(blocker);
    stack2.pop();
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
  const handles = new Set(record.members.filter((member) => member.name === name && typeof member.executorRef === "string" && member.executorRef !== "").map((member) => member.executorRef));
  const owned = record.tasks.filter((task) => task.owner === name || task.owner !== undefined && handles.has(task.owner));
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
  return record.members.filter((member) => (member.status === "running" || member.status === "inactive") && member.fenced !== true && !busy.has(member.name) && (member.executorRef === undefined || member.executorRef === "" || !busy.has(member.executorRef)));
}

// packages/mpd-team-core-plugin/src/plan-store.ts
var STAGED_PLAN_VERSION = 2;
function teamRoot2(workspace) {
  return join5(workspace, ".mpd", "team");
}
function planFileId(value, what) {
  const raw = String(value);
  if (raw.includes("/") || raw.includes("\\")) {
    throw new Error(`${what} "${raw}" carries a path separator and is refused: ids name ONE file under .mpd/team`);
  }
  const id = sanitizeId(raw);
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${what} "${raw}" reduced to "${id}", which still carries a path separator and is refused`);
  }
  return id;
}
var stagingDir = (workspace) => join5(teamRoot2(workspace), "staging");
var stagingPath = (workspace, sessionId) => join5(stagingDir(workspace), planFileId(sessionId, "staging session id") + ".json");
var contractsDir = (workspace) => join5(teamRoot2(workspace), "contracts");
var contractPath = (workspace, taskId) => join5(contractsDir(workspace), planFileId(taskId, "contract task id") + ".json");
var holdPath = (workspace) => join5(teamRoot2(workspace), "hold.json");
var archiveDir = (workspace) => join5(teamRoot2(workspace), "archive");
function readJson2(path) {
  try {
    return JSON.parse(readFileSync4(path, "utf8"));
  } catch {
    return;
  }
}
function writeJson2(path, value) {
  mkdirSync5(join5(path, ".."), { recursive: true });
  writeFileSync2(path, JSON.stringify(value, null, 2) + `
`);
}
function newPlanId(now) {
  return "plan-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + nextIdSuffix();
}
function readPlan(workspace, sessionId) {
  const plan = readJson2(stagingPath(workspace, sessionId));
  if (plan === undefined)
    return;
  const version = typeof plan.version === "number" ? plan.version : undefined;
  if (version !== 1 && version !== STAGED_PLAN_VERSION)
    return;
  return { ...plan, version: STAGED_PLAN_VERSION };
}
function writePlan(workspace, plan) {
  writeJson2(stagingPath(workspace, plan.sessionId), plan);
}
function stagePlan(workspace, sessionId, input, now) {
  const existing = readPlan(workspace, sessionId);
  if (existing !== undefined && existing.approvedAt === undefined)
    archivePlan(workspace, existing);
  const plan = {
    version: STAGED_PLAN_VERSION,
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
function classifyBlocker(plan, reference) {
  if (/^T\d+$/u.test(reference))
    return "board-id";
  if (/^\d+$/u.test(reference))
    return "position";
  return plan.tasks.some((task) => task.subject === reference) ? "subject" : "unknown";
}
function archivePlan(workspace, plan) {
  const target = archivePathFor(workspace, plan.planId);
  if (existsSync4(join5(target, "plan.json"))) {
    throw new Error(`plan id "${plan.planId}" is already archived in this workspace — refusing to overwrite an archived plan`);
  }
  mkdirSync5(target, { recursive: true });
  writeJson2(join5(target, "plan.json"), plan);
  const staged = stagingPath(workspace, plan.sessionId);
  if (existsSync4(staged))
    rmSync3(staged, { force: true });
  return target;
}
function listArchivedPlans(workspace) {
  let entries = [];
  try {
    entries = readdirSync2(archiveDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const path = join5(archiveDir(workspace), entry, "plan.json");
    try {
      const plan = JSON.parse(readFileSync4(path, "utf8"));
      const planId = typeof plan.planId === "string" && plan.planId !== "" ? plan.planId : entry;
      const archivedAt = statSync2(path).mtime.toISOString();
      const approvedAt = typeof plan.approvedAt === "string" ? plan.approvedAt : undefined;
      out.push({
        planId,
        archivedAt,
        approved: approvedAt !== undefined,
        ...approvedAt === undefined ? {} : { approvedAt },
        path
      });
    } catch {}
  }
  return out.sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
}
function claimContract(workspace, task, claimant, now) {
  const previous = readJson2(contractPath(workspace, task.id));
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
  writeJson2(contractPath(workspace, task.id), contract);
  return contract;
}
function readContract(workspace, taskId) {
  const contract = readJson2(contractPath(workspace, taskId));
  return contract === undefined || contract.version !== 1 ? undefined : contract;
}
function listContracts(workspace) {
  let names = [];
  try {
    names = readdirSync2(contractsDir(workspace));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const contract = readJson2(join5(contractsDir(workspace), name));
    if (contract !== undefined && contract.version === 1)
      out.push(contract);
  }
  return out.sort((left, right) => right.claimedAt.localeCompare(left.claimedAt));
}
function readHold(workspace) {
  const hold = readJson2(holdPath(workspace));
  return hold === undefined || hold.version !== 1 ? undefined : hold;
}
function placeHold(workspace, reason, heldBy, now) {
  const hold = { version: 1, reason, heldAt: now.toISOString(), heldBy };
  writeJson2(holdPath(workspace), hold);
  return hold;
}
function clearHold(workspace) {
  const path = holdPath(workspace);
  if (!existsSync4(path))
    return false;
  rmSync3(path, { force: true });
  return true;
}
function archivePathFor(workspace, planId) {
  return join5(archiveDir(workspace), planFileId(planId, "archived plan id"));
}
function moveIntoArchive(workspace, from, planId) {
  const target = archivePathFor(workspace, planId);
  mkdirSync5(archiveDir(workspace), { recursive: true });
  renameSync3(from, target);
  return target;
}

// packages/mpd-team-core-plugin/src/dependency-guard.ts
function planTaskId(index) {
  return "T" + String(index + 1);
}
function normalizeScope(scope) {
  const normalized = scope.replace(/\/\*\*$/u, "").replace(/\/+$/u, "");
  return normalized === "" && scope !== "" ? "." : normalized;
}
function scopeCoversEverything(normalized) {
  return normalized === "**" || normalized === ".";
}
function scopesOverlap(first, second) {
  const a = normalizeScope(first);
  const b = normalizeScope(second);
  if (a === "" || b === "")
    return false;
  if (scopeCoversEverything(a) || scopeCoversEverything(b))
    return true;
  if (a === b)
    return true;
  return a.startsWith(b + "/") || b.startsWith(a + "/");
}
function planReferenceTarget(plan, reference) {
  const numbered = /^T(\d+)$/u.exec(reference) ?? /^(\d+)$/u.exec(reference);
  if (numbered !== null) {
    const position = Number(numbered[1]);
    return position >= 1 && position <= plan.tasks.length ? planTaskId(position - 1) : undefined;
  }
  const index = plan.tasks.findIndex((task) => task.subject === reference);
  return index < 0 ? undefined : planTaskId(index);
}
function planDependencyEdges(plan) {
  return new Map(plan.tasks.map((task, index) => [
    planTaskId(index),
    (task.blockedBy ?? []).map((reference) => planReferenceTarget(plan, reference)).filter((id) => id !== undefined)
  ]));
}
function boardDependencyEdges(tasks) {
  const ids = new Set(tasks.map((task) => task.id));
  return new Map(tasks.map((task) => [task.id, task.blockedBy.filter((reference) => ids.has(reference))]));
}
function dependencyCycle(edges) {
  const done = new Set;
  const path = [];
  const onPath = new Set;
  const visit = (id) => {
    if (onPath.has(id)) {
      const at = path.indexOf(id);
      return [...path.slice(at), id];
    }
    if (done.has(id))
      return;
    path.push(id);
    onPath.add(id);
    for (const blocker of edges.get(id) ?? []) {
      const cycle = visit(blocker);
      if (cycle !== undefined)
        return cycle;
    }
    path.pop();
    onPath.delete(id);
    done.add(id);
    return;
  };
  for (const id of edges.keys()) {
    const cycle = visit(id);
    if (cycle !== undefined)
      return cycle;
  }
  return;
}
function dependencyPath(edges, from, to) {
  const queue = [from];
  const seen = new Set;
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === to)
      return true;
    if (seen.has(id))
      continue;
    seen.add(id);
    for (const blocker of edges.get(id) ?? [])
      queue.push(blocker);
  }
  return false;
}
function planGraphDefect(plan) {
  const unanswered = plan.tasks.findIndex((task) => !Array.isArray(task.blockedBy));
  if (unanswered >= 0) {
    const task = plan.tasks[unanswered];
    return { kind: "unanswered", id: planTaskId(unanswered), subject: task.subject };
  }
  const edges = planDependencyEdges(plan);
  for (const [id, blockers] of edges) {
    if (blockers.includes(id))
      return { kind: "self-edge", id };
  }
  const cycle = dependencyCycle(edges);
  return cycle === undefined ? undefined : { kind: "cycle", path: cycle };
}
function scopeClashes(plan) {
  const edges = planDependencyEdges(plan);
  const clashes = [];
  for (let first = 0;first < plan.tasks.length; first += 1) {
    for (let second = first + 1;second < plan.tasks.length; second += 1) {
      const firstScopes = plan.tasks[first].writeScopes ?? [];
      const secondScopes = plan.tasks[second].writeScopes ?? [];
      if (firstScopes.length === 0 || secondScopes.length === 0)
        continue;
      const firstId = planTaskId(first);
      const secondId = planTaskId(second);
      if (dependencyPath(edges, firstId, secondId) || dependencyPath(edges, secondId, firstId))
        continue;
      for (const scope of firstScopes) {
        const collidesWith = secondScopes.find((candidate) => scopesOverlap(scope, candidate));
        if (collidesWith === undefined)
          continue;
        clashes.push({
          first: { id: firstId, subject: plan.tasks[first].subject, scope },
          second: { id: secondId, subject: plan.tasks[second].subject, scope: collidesWith }
        });
        break;
      }
    }
  }
  return clashes;
}

// packages/mpd-team-core-plugin/src/team-door-guard.ts
var TEAM_DOOR_TOOLS = ["spawn_teammate", "team_task_create", "team_task_list", "team_task_get", "team_task_update"];
function teamDoorRefusal(toolName) {
  return "team door: `" + toolName + "` is refused — this workspace's team plane is the mpd RECORD " + "(`<workspace>/.mpd/team/teams/<teamId>.json`, served as `mpdTeams`), so the official board is NOT " + "guarded here: it asks no required dependency answer for a task, refuses no write-scope overlap at " + "approve, and gates no claim readiness. Author on the RECORD with `agent_teams_plan " + '{action:"add_member"|"create_task"|"approve"}`, drive it with `agent_teams_task ' + '{action:"claim"|"complete"|"fail"}`, and read it with `agent_teams_plan {action:"status"}` — ' + "every session in this composition carries those tools, so no lane is left without a door.";
}
function installTeamDoorGuard(dsh, options) {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the team door is NOT installed " + "(the official team authoring tools stay available beside the mpd RECORD, so an authoring call " + "is advice-only; mounting a harness with `tools.guard` installs it with no config change)");
      return { installed: false, reason: "no-guard-seam" };
    }
    const door = new Set(TEAM_DOOR_TOOLS);
    const dispose = dsh.guardTool((exec) => {
      try {
        const name = String(exec?.name ?? "");
        if (!door.has(name))
          return;
        return teamDoorRefusal(name);
      } catch {
        return;
      }
    });
    return { installed: true, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("installing the team door failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, reason: "install-failed" };
  }
}

// packages/mpd-team-core-plugin/src/stage.ts
var UNRESOLVED_VERDICTS = ["fail", "failed", "changes", "change-requested"];
function isTerminal(task) {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}
function isInFlight(task) {
  return task.status === "claimed" || task.status === "in_progress";
}
function waitingForAnswer(members) {
  return members.find((member) => member.status !== "running" && member.status !== "provisioning" && member.handoff !== undefined);
}
function teamStage(record, taskId) {
  const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
  const members = Array.isArray(record?.members) ? record.members : [];
  const scope = taskId === undefined ? tasks : tasks.filter((task) => task.id === taskId);
  const failed = scope.find((task) => task.status === "failed");
  if (failed !== undefined)
    return { kind: "person", reason: "failed", taskId: failed.id };
  const review = scope.find((task) => task.kind === "review" && task.verdict !== undefined && !String(task.verdict).toLowerCase().startsWith("pass") && UNRESOLVED_VERDICTS.includes(String(task.verdict).toLowerCase()));
  if (review !== undefined)
    return { kind: "person", reason: "review", taskId: review.id };
  const blocked = scope.find((task) => !isTerminal(task) && !isInFlight(task) && taskVisual(task, tasks) === "blocked");
  if (blocked !== undefined)
    return { kind: "person", reason: "blocked", taskId: blocked.id };
  const boardFinished = tasks.length > 0 && tasks.every((task) => isTerminal(task) && task.status !== "failed");
  if (taskId === undefined && boardFinished && derivePhase(record) !== "ended")
    return { kind: "person", reason: "delivery" };
  if (taskId === undefined && !tasks.some(isInFlight)) {
    const waiting = waitingForAnswer(members);
    if (waiting !== undefined)
      return { kind: "person", reason: "answer" };
  }
  const inFlight = tasks.some(isInFlight);
  if (inFlight) {
    const queued = tasks.some((task) => task.status === "pending" && task.owner === undefined && !isTerminal(task) && taskVisual(task, tasks) !== "blocked");
    return { kind: "working", queued };
  }
  return derivePhase(record) === "ended" ? { kind: "ended" } : { kind: "idle" };
}
function stageLabel(stage) {
  if (stage.kind === "working")
    return stage.queued ? "working:queued" : "working";
  if (stage.kind === "person")
    return "person:" + stage.reason;
  return stage.kind;
}

// packages/mpd-team-core-plugin/src/team-web.ts
var TEAM_STATE_PATH = "/plugins/mpd-team/state";
var TEAM_PLAN_PATH = "/plugins/mpd-team/plan";
var TEAM_TASK_PATH = "/plugins/mpd-team/task";
var TEAM_MAIL_PATH = "/plugins/mpd-team/mail";
var TEAM_EVENTS_PATH = "/plugins/mpd-team/events";
var TEAM_ROUTES = [TEAM_STATE_PATH, TEAM_PLAN_PATH, TEAM_TASK_PATH, TEAM_MAIL_PATH, TEAM_EVENTS_PATH];
var TEAM_APPROVE_PATH = "/plugins/mpd-team/approve";
var TEAM_DISPATCH_PATH = "/plugins/mpd-team/dispatch";
var TEAM_ACTION_ROUTES = [TEAM_APPROVE_PATH, TEAM_DISPATCH_PATH];
var MAX_ACTION_BODY_BYTES = 64 * 1024;
var GENERIC_FAILURE = "mpd-team-core: the request could not be completed";
var actionEncoder = new TextEncoder;
var actionDecoder = new TextDecoder;
async function readActionBody(request) {
  const req = request;
  if (req === undefined || typeof req[Symbol.asyncIterator] !== "function")
    return { ok: false, status: 400 };
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    const part = typeof chunk === "string" ? actionEncoder.encode(chunk) : chunk instanceof Uint8Array ? chunk : actionEncoder.encode(String(chunk));
    size += part.byteLength;
    if (size > MAX_ACTION_BODY_BYTES)
      return { ok: false, status: 413 };
    parts.push(part);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  const raw = actionDecoder.decode(bytes);
  if (raw.trim() === "")
    return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400 };
  }
}
function parseDispatchInput(body) {
  if (body === undefined)
    return { ok: true, value: {} };
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "the request body must be a JSON object" };
  const record = body;
  const limit = record.limit;
  if (limit !== undefined && !(typeof limit === "number" && Number.isFinite(limit) && limit >= 0)) {
    return { ok: false, error: "limit must be a finite number >= 0 when present" };
  }
  const dryRun = record.dryRun;
  if (dryRun !== undefined && typeof dryRun !== "boolean")
    return { ok: false, error: "dryRun must be a boolean when present" };
  return {
    ok: true,
    value: {
      ...limit === undefined ? {} : { limit },
      ...dryRun === undefined ? {} : { dryRun }
    }
  };
}
function approvalPhraseFor(planId) {
  return `approve ${planId}`;
}
function buildWorkspaceTeams(teams, activeId) {
  return {
    records: teams.map((team) => ({
      id: team.teamId,
      name: team.name,
      description: team.description,
      phase: derivePhase(team),
      ...team.approvedAt === undefined ? {} : { approvedAt: team.approvedAt },
      ...team.endedAt === undefined ? {} : { endedAt: team.endedAt },
      tasks: {
        total: team.tasks.length,
        completed: team.tasks.filter((task) => task.status === "completed").length,
        failed: team.tasks.filter((task) => task.status === "failed").length
      },
      members: team.members.filter((member) => member.status !== "failed").length,
      stage: stageLabel(teamStage(team)),
      active: team.teamId === activeId
    })),
    ...activeId === undefined ? {} : { activeId }
  };
}
function taskProgress(status, visual) {
  if (visual === "completed")
    return 100;
  if (visual === "running")
    return status === "claimed" ? 10 : 50;
  return 0;
}
function buildTeamState(record, workspace, sessionId, executor, workspaceTeams, model) {
  const listing = workspaceTeams ?? { records: [] };
  const empty = {
    ok: true,
    workspace,
    sessionId,
    workspaceTeams: listing,
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
  const rankOf = new Map;
  if (model !== undefined)
    for (const node2 of model.nodes)
      rankOf.set(node2.id, node2.depth);
  const tasks = record.tasks.map((task) => {
    const visual = taskVisual(task, record.tasks);
    return {
      id: task.id,
      subject: task.subject,
      ...task.kind === undefined ? {} : { kind: task.kind },
      status: task.status,
      visual,
      ...task.owner === undefined ? {} : { owner: task.owner },
      ...task.attempt === undefined ? {} : { attempt: task.attempt },
      ...task.round === undefined ? {} : { round: task.round },
      ...task.verdict === undefined ? {} : { verdict: task.verdict },
      ...task.startedAt === undefined ? {} : { startedAt: task.startedAt },
      ...task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt },
      progress: taskProgress(task.status, visual),
      blockedBy: [...task.blockedBy],
      failedBy: blockingDependencies(record.tasks, task.blockedBy).failed,
      depth: summary.depths.get(task.id) ?? 0,
      ...model === undefined ? {} : { rank: rankOf.get(task.id) ?? 0 }
    };
  }).sort((left, right) => left.depth - right.depth);
  return {
    ok: true,
    workspace,
    sessionId,
    workspaceTeams: listing,
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
    members: record.members.filter((member) => member.status !== "failed").map((member) => {
      const progress = memberProgress(record, member.name);
      return {
        id: member.id,
        name: member.name,
        ...member.role === undefined ? {} : { role: member.role },
        status: member.fenced === true ? "fenced" : member.status === "running" && idle.has(member.name) ? "idle" : member.status,
        done: progress.done,
        total: progress.total,
        ...progress.current === undefined ? {} : { current: progress.current },
        ...member.route === undefined ? {} : { route: member.route },
        ...member.workmateMode === undefined ? {} : { workmateMode: member.workmateMode },
        ...member.workmateReason === undefined ? {} : { workmateReason: member.workmateReason },
        checkpoint: memberIsCheckpoint(record, member.name)
      };
    }),
    tasks,
    ...model === undefined ? {} : { model },
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
      kind: String(entry.kind ?? "message"),
      threadId: String(entry.threadId ?? ""),
      ...entry.replyTo === undefined ? {} : { replyTo: String(entry.replyTo) },
      ...entry.question === undefined ? {} : { question: entry.question },
      ...entry.answer === undefined ? {} : { answer: entry.answer },
      ...entry.deliveredAt === undefined ? {} : { deliveredAt: String(entry.deliveredAt) },
      ...entry.readAt === undefined ? {} : { readAt: String(entry.readAt) },
      ...entry.readBy === undefined ? {} : { readBy: String(entry.readBy) }
    };
  });
  return { ok: true, workspace, messages, records: readRecords(workspace).length, problems: (Array.isArray(state.problems) ? state.problems : []).map(String) };
}
function planForSession(workspace, sessionId) {
  return buildTeamPlan(readPlan(workspace, sessionId), workspace, sessionId);
}
var SSE_PING_MS = 15000;
function registerTeamRoutes(webServer, deps) {
  if (webServer === undefined || typeof webServer.register !== "function")
    return false;
  const json = (res, status, body, headers = {}) => {
    const out = res;
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
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
          const rejection = deps.authorize?.(req);
          if (rejection !== undefined) {
            json(res, rejection, { ok: false, error: `mpd-team-core: the request is not authenticated for ${path}` });
            return;
          }
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
  const mountStream = (path, handler) => {
    try {
      deps.effect(() => webServer.register({
        kind: "exact",
        path,
        handler: (req, res) => {
          try {
            handler(req, res);
          } catch (error) {
            deps.warn(`the ${path} stream failed: ${String(error?.message ?? error)}`);
          }
        }
      }), `mpd-team-core: web route ${path}`);
      return true;
    } catch (error) {
      deps.warn(`registering ${path} failed: ${String(error?.message ?? error)}`);
      return false;
    }
  };
  const mountAction = (path, parse, run, project) => {
    const actions2 = deps.actions;
    if (actions2 === undefined)
      return false;
    try {
      deps.effect(() => webServer.register({
        kind: "exact",
        path,
        handler: async (req, res) => {
          try {
            const rejection = deps.authorize?.(req);
            if (rejection !== undefined) {
              json(res, rejection, { ok: false, error: `mpd-team-core: the request is not authenticated for ${path}` });
              return;
            }
            if (req?.method !== "POST") {
              json(res, 405, { ok: false, error: `mpd-team-core: ${path} accepts POST only` }, { allow: "POST" });
              return;
            }
            const read = await readActionBody(req);
            if (!read.ok) {
              json(res, read.status, {
                ok: false,
                error: read.status === 413 ? `mpd-team-core: the request body exceeds ${MAX_ACTION_BODY_BYTES} bytes` : "mpd-team-core: the request body is not valid JSON"
              });
              return;
            }
            const body = parse(read.value);
            if (!body.ok) {
              json(res, 400, { ok: false, error: `mpd-team-core: ${body.error}` });
              return;
            }
            const sessionId = sessionOf(req);
            if (sessionId === "") {
              json(res, 400, { ok: false, error: "mpd-team-core: the request names no session" });
              return;
            }
            if (!actions2.isLive(sessionId)) {
              json(res, 409, { ok: false, error: `mpd-team-core: session ${sessionId} is not live` });
              return;
            }
            const result = await run(sessionId, body.value);
            if (!result.ok) {
              if (result.unexpected === true) {
                deps.warn(`route ${path} failed: ${result.error}`);
                json(res, 500, { ok: false, error: GENERIC_FAILURE });
                return;
              }
              json(res, 400, { ok: false, error: `mpd-team-core: ${result.error}` });
              return;
            }
            json(res, 200, { ok: true, ...project(result) });
          } catch (error) {
            deps.warn(`route ${path} failed: ${String(error?.message ?? error)}`);
            try {
              json(res, 500, { ok: false, error: GENERIC_FAILURE });
            } catch {}
          }
        }
      }), `mpd-team-core: web route ${path}`);
      return true;
    } catch (error) {
      deps.warn(`registering ${path} failed: ${String(error?.message ?? error)}`);
      return false;
    }
  };
  const events = (req, res) => {
    const subscribe = deps.subscribe;
    const revision = deps.revision;
    const rejection = deps.authorize?.(req);
    if (rejection !== undefined) {
      json(res, rejection, { ok: false, error: "mpd-team-core: the request is not authenticated for the events stream" });
      return;
    }
    if (subscribe === undefined || revision === undefined) {
      json(res, 503, { ok: false, error: "mpd-team-core: the team change feed is unavailable in this composition" });
      return;
    }
    const out = res;
    const sessionId = sessionOf(req);
    let workspace = "";
    try {
      workspace = deps.workspace(sessionId);
    } catch (error) {
      deps.warn(`resolving the events workspace failed: ${String(error?.message ?? error)}`);
      json(res, 500, { ok: false, error: "mpd-team-core: the events stream could not resolve its workspace" });
      return;
    }
    const revisionNow = () => {
      try {
        return revision(workspace);
      } catch {
        return 0;
      }
    };
    try {
      out.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      if (typeof out.flushHeaders === "function")
        out.flushHeaders();
      out.write(`retry: 1000

`);
      out.write(`event: hello
data: ${JSON.stringify({ rev: revisionNow() })}

`);
    } catch (error) {
      deps.warn(`opening the events stream failed: ${String(error?.message ?? error)}`);
      try {
        out.end();
      } catch {}
      return;
    }
    const ping = setInterval(() => {
      try {
        out.write(`: ping

`);
      } catch {}
    }, SSE_PING_MS);
    const unref = ping.unref;
    if (typeof unref === "function")
      unref.call(ping);
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribe(workspace, () => {
        try {
          out.write(`data: ${JSON.stringify({ rev: revisionNow() })}

`);
        } catch {}
      });
    } catch (error) {
      deps.warn(`subscribing the events stream failed: ${String(error?.message ?? error)}`);
    }
    let closed = false;
    const close = () => {
      if (closed)
        return;
      closed = true;
      clearInterval(ping);
      try {
        unsubscribe();
      } catch {}
    };
    if (typeof req.on === "function")
      req.on?.("close", close);
    if (typeof out.on === "function")
      out.on("close", close);
    deps.warn(`the events stream opened for ${workspace} (session=${sessionId === "" ? "none" : sessionId})`);
  };
  all = mount(TEAM_STATE_PATH, (req) => {
    const sessionId = sessionOf(req);
    const workspace = deps.workspace(sessionId);
    const record = deps.recordFor(sessionId);
    const model = record === undefined ? undefined : deps.graph?.(workspace, record.teamId);
    return buildTeamState(record, workspace, sessionId, deps.executor(), buildWorkspaceTeams(listTeams(workspace), activeTeamId(workspace, sessionId)), model);
  }) && all;
  all = mount(TEAM_PLAN_PATH, (req) => {
    const sessionId = sessionOf(req);
    return planForSession(deps.workspace(sessionId), sessionId);
  }) && all;
  all = mount(TEAM_TASK_PATH, (req) => buildTeamTasks(deps.workspace(sessionOf(req)))) && all;
  all = mount(TEAM_MAIL_PATH, (req) => buildTeamMail(deps.workspace(sessionOf(req)))) && all;
  all = mountStream(TEAM_EVENTS_PATH, events) && all;
  const actions = deps.actions;
  if (actions !== undefined) {
    all = mountAction(TEAM_APPROVE_PATH, () => ({ ok: true, value: undefined }), (sessionId) => actions.approve(sessionId), (payload) => ({
      team: {
        id: payload.team?.teamId ?? "",
        name: payload.team?.name ?? "",
        memberCount: payload.team?.members.length ?? 0,
        taskCount: payload.team?.tasks.length ?? 0
      },
      created: [...payload.created.members.map((member) => member.id), ...payload.created.tasks.map((task) => task.id)]
    })) && all;
    all = mountAction(TEAM_DISPATCH_PATH, parseDispatchInput, (sessionId, body) => actions.dispatch(sessionId, body), (payload) => ({
      pairs: payload.pairs.map((pair) => ({ taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName })),
      skipped: payload.skipped
    })) && all;
  }
  return all;
}

// packages/mpd-team-core-plugin/src/team-actions.ts
import { existsSync as existsSync6 } from "node:fs";

// packages/mpd-team-core-plugin/src/team-lifecycle.ts
import { readFileSync as readFileSync5, readdirSync as readdirSync3 } from "node:fs";
import { join as join6 } from "node:path";
var LIVE_TEAM_PHASES = ["staged", "active", "idle"];
function isLiveTeamPhase(phase) {
  return LIVE_TEAM_PHASES.includes(phase);
}
function readArchivedPlanIndex(workspace) {
  const approved = new Set;
  const unapproved = new Set;
  let entries = [];
  try {
    entries = readdirSync3(join6(teamRoot(workspace), "archive"));
  } catch {
    return { approved, unapproved };
  }
  for (const entry of entries) {
    try {
      const raw = readFileSync5(join6(teamRoot(workspace), "archive", entry, "plan.json"), "utf8");
      const plan = JSON.parse(raw);
      const key = String(plan.planId ?? "");
      if (key === "")
        continue;
      (plan.approvedAt === undefined ? unapproved : approved).add(key);
    } catch {}
  }
  return { approved, unapproved };
}
function isLiveTeam(record, index) {
  if (record.endedAt !== undefined)
    return false;
  if (!isLiveTeamPhase(record.phase))
    return false;
  const key = String(record.planId ?? "");
  if (key === "")
    return true;
  return !(index.unapproved.has(key) && !index.approved.has(key));
}
function resolveTeamRecord(input) {
  const spellings = [input.sessionId, ...input.alsoSessions ?? []].filter((value) => value !== "");
  if (input.bound !== undefined && isLiveTeam(input.bound, input.index))
    return { record: input.bound };
  const live = input.teams.filter((record) => isLiveTeam(record, input.index));
  const leading = live.find((record) => recordNamesLead(record, spellings));
  if (leading !== undefined)
    return { record: leading };
  const memberOf = live.filter((record) => recordNamesMember(record, spellings));
  if (memberOf.length === 1)
    return { record: memberOf[0] };
  if (memberOf.length > 1) {
    return { refusal: `this session is on the roster of ${memberOf.length} teams in this workspace (${memberOf.map((record) => record.teamId).join(", ")}) and the record does not say which one it works on — run this from the team's lead session, or remove the duplicate roster entry` };
  }
  return {};
}
function reapReapedTeams(workspace, now) {
  const index = readArchivedPlanIndex(workspace);
  const reaped = [];
  for (const record of listTeams(workspace)) {
    if (isLiveTeam(record, index))
      continue;
    if (record.endedAt !== undefined)
      continue;
    const reason = !isLiveTeamPhase(record.phase) ? `record phase ${JSON.stringify(record.phase)} is not a live team phase (${LIVE_TEAM_PHASES.join(" | ")})` : `the plan ${String(record.planId ?? "")} of team ${record.teamId} is archived without approval (discarded or replaced)`;
    writeTeam(workspace, { ...record, phase: "ended", endedAt: now.toISOString(), archivedReason: reason });
    reaped.push(record.teamId);
  }
  return reaped;
}

// packages/mpd-team-core-plugin/src/idle-guard.ts
var IDLE_DIRECTIVE_TEXT = "You have no board task. Do not read, run, write, message or claim. End your turn now.";
var IDLE_DENIAL_TEXT = "[mpd-team] no board task is assigned to you; end your turn and wait for a dispatch";
var IDLE_PREAMBLE_TEXT = "You are a team member. You have NO board task yet unless this spawn carries one. Do not read, run, write, message or claim. Reply with one line and end your turn; the board will dispatch your task.";
var OPEN_TASK_STATUSES = ["pending", "claimed", "in_progress"];
function wireReason(error) {
  return error instanceof Error ? error.message : String(error);
}
function sessionIdOfAgent(agent) {
  const candidate = agent;
  const sessionId = candidate?.session?.id;
  if (typeof sessionId === "string" && sessionId !== "")
    return sessionId;
  const id = candidate?.id;
  return typeof id === "string" ? id : "";
}
function memberForSession(record, sessionId) {
  if (sessionId === "")
    return;
  return record.members.find((member) => member.executorRef === sessionId);
}
function memberHasOpenTask(record, sessionId) {
  const member = memberForSession(record, sessionId);
  if (member === undefined)
    return false;
  return record.tasks.some((task) => OPEN_TASK_STATUSES.includes(task.status) && (task.owner === member.name || member.executorRef !== undefined && task.owner === member.executorRef));
}
function findMemberTeam(teams, sessionId) {
  if (sessionId === "")
    return;
  return teams.find((team) => isLiveTeamPhase(team.phase) && memberForSession(team, sessionId) !== undefined);
}
function withIdlePreamble(prompt) {
  return IDLE_PREAMBLE_TEXT + `

` + prompt;
}
function installIdleGuard(dsh) {
  const marked = new Set;
  const controlSeats = new Set;
  const dispatching = new Map;
  const injectedTurns = new Map;
  const disposers = [];
  const warn = (line) => {
    try {
      dsh.rowLog?.(line);
    } catch {}
  };
  const register = (agent) => {
    if (agent === undefined || agent === null)
      return;
    if (agentDisposers.has(agent))
      return;
    try {
      const dispose = dsh.registerAgentPreStep(agent, listener);
      agentDisposers.set(agent, typeof dispose === "function" ? dispose : () => {});
    } catch (error) {
      warn(`[mpd-team-core] the idle-member guard could not register a pre-step listener for agent "${sessionIdOfAgent(agent)}" (${wireReason(error)})`);
    }
  };
  const agentDisposers = new Map;
  const listener = (payload, decision) => {
    try {
      const agent = payload?.agent ?? payload;
      const sessionId = sessionIdOfAgent(agent);
      if (sessionId === "")
        return;
      if (dispatching.has(sessionId)) {
        clear(sessionId);
        return;
      }
      if (controlSeats.has(sessionId)) {
        clear(sessionId);
        return;
      }
      const workspace = dsh.workspaceRoot({ agent });
      const team = workspace === "" ? undefined : findMemberTeam(listTeams(workspace), sessionId);
      if (team === undefined) {
        clear(sessionId);
        return;
      }
      if (recordNamesLead(team, [sessionId])) {
        clear(sessionId);
        return;
      }
      if (memberHasOpenTask(team, sessionId)) {
        clear(sessionId);
        return;
      }
      const turn = typeof payload?.turn === "number" ? payload.turn : null;
      if (turn === null && marked.has(sessionId))
        return;
      if (turn !== null && injectedTurns.get(sessionId) === turn && marked.has(sessionId))
        return;
      marked.add(sessionId);
      if (turn !== null)
        injectedTurns.set(sessionId, turn);
      const carried = decision?.messages ?? payload?.messages ?? [];
      const kind = typeof decision?.kind === "string" ? decision.kind : "enter";
      if (kind !== "enter")
        return decision;
      return {
        ...decision,
        kind: "enter",
        messages: [...carried, userMessage({ text: IDLE_DIRECTIVE_TEXT, source: { kind: "mpd-team", reason: "idle-member-guard" } })]
      };
    } catch (error) {
      warn(`[mpd-team-core] the idle-member guard's pre-step listener failed: ${wireReason(error)}`);
      return;
    }
  };
  const clear = (sessionId) => {
    marked.delete(sessionId);
    injectedTurns.delete(sessionId);
  };
  const beginDispatch = (sessionId) => {
    if (sessionId === "")
      return () => {};
    dispatching.set(sessionId, (dispatching.get(sessionId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released)
        return;
      released = true;
      const remaining = (dispatching.get(sessionId) ?? 0) - 1;
      if (remaining > 0)
        dispatching.set(sessionId, remaining);
      else
        dispatching.delete(sessionId);
    };
  };
  try {
    const offGuard = dsh.guardTool((exec) => {
      const sessionId = sessionIdOfAgent(exec?.agent);
      return sessionId !== "" && !dispatching.has(sessionId) && marked.has(sessionId) ? IDLE_DENIAL_TEXT : undefined;
    });
    if (typeof offGuard === "function")
      disposers.push(offGuard);
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not install its tool guard (${wireReason(error)})`);
  }
  try {
    for (const agent of dsh.liveAgents() ?? [])
      register(agent);
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not read the live registry (${wireReason(error)})`);
  }
  try {
    const offCreated = dsh.onEvent("agent/created", (payload) => {
      register(payload?.agent ?? payload);
      return;
    });
    if (typeof offCreated === "function")
      disposers.push(offCreated);
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not subscribe to agent/created (${wireReason(error)})`);
  }
  try {
    const offDisposed = dsh.onEvent("agent/disposed", (payload) => {
      const agent = payload?.agent ?? payload;
      const dispose = agentDisposers.get(agent);
      if (dispose !== undefined) {
        agentDisposers.delete(agent);
        clear(sessionIdOfAgent(agent));
        try {
          dispose();
        } catch {}
      }
      return;
    });
    if (typeof offDisposed === "function")
      disposers.push(offDisposed);
  } catch (error) {
    warn(`[mpd-team-core] the idle-member guard could not subscribe to agent/disposed (${wireReason(error)})`);
  }
  disposers.push(() => {
    for (const dispose of agentDisposers.values()) {
      try {
        dispose();
      } catch {}
    }
    agentDisposers.clear();
  });
  return {
    marked,
    isMarked: (sessionId) => marked.has(sessionId),
    clear,
    registerControlSeat: (sessionId) => {
      if (sessionId !== "")
        controlSeats.add(sessionId);
      return () => {
        controlSeats.delete(sessionId);
      };
    },
    beginDispatch,
    disposers
  };
}

// packages/mpd-team-core-plugin/src/dispatch-ledger.ts
import { mkdirSync as mkdirSync6, readFileSync as readFileSync6, renameSync as renameSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join7 } from "node:path";
var dispatchPath = (workspace) => join7(workspace, ".mpd", "team", "dispatch.json");
function readLedger(workspace) {
  try {
    const raw = JSON.parse(readFileSync6(dispatchPath(workspace), "utf8"));
    return raw !== null && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeLedger(workspace, ledger) {
  mkdirSync6(join7(workspace, ".mpd", "team"), { recursive: true });
  const temp = dispatchPath(workspace) + ".tmp-" + process.pid;
  writeFileSync3(temp, JSON.stringify(ledger, null, 2) + `
`);
  renameSync4(temp, dispatchPath(workspace));
}

// packages/mpd-team-core-plugin/src/team-journal.ts
import { appendFileSync as appendFileSync3, existsSync as existsSync5, mkdirSync as mkdirSync7, readFileSync as readFileSync7 } from "node:fs";
import { join as join8 } from "node:path";
var journalPath = (workspace) => join8(teamRoot(workspace), "journal.jsonl");
function appendTeamJournal(workspace, entry) {
  const path = journalPath(workspace);
  mkdirSync7(teamRoot(workspace), { recursive: true });
  appendFileSync3(path, JSON.stringify(entry) + `
`);
  return path;
}

// packages/mpd-team-core-plugin/src/team-handoff.ts
import { mkdirSync as mkdirSync8, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join9 } from "node:path";
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
function teamHandoffPath(workspace, teamId, member, ordinal) {
  return join9(teamRoot(workspace), "handoff", sanitizeId(teamId), sanitizeId(member) + "-" + String(ordinal) + ".md");
}
function writeHandoffDocument(workspace, teamId, member, ordinal, text2) {
  const path = teamHandoffPath(workspace, teamId, member, ordinal);
  mkdirSync8(join9(path, ".."), { recursive: true });
  writeFileSync4(path, text2.endsWith(`
`) ? text2 : text2 + `
`);
  return path;
}
function handoffWrittenDirective(path) {
  return "[mpd-team] handoff written to " + path + ". END YOUR TURN NOW — do not call another tool; the plugin compacts and promotes you from that document.";
}

// packages/mpd-team-core-plugin/src/team-actions.ts
var TEAM_ACTIONS_SERVICE = "mpdTeamActions";
function refusalOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function unexpectedRefusalOf(error) {
  return { ok: false, error: refusalOf(error), unexpected: true };
}
var approvalsInFlight = new Set;
var dispatchesInFlight = new Set;
function actionSlotKey(caller) {
  return `${caller.workspace}\x00${caller.sessionId}`;
}
var WORKMATE_MATCH_THRESHOLD = 0.35;
var WORKMATE_NAME_FIRST_ORDINAL = 1;
function workmateBindingConfigOf(deps) {
  try {
    const config = deps.service("mpdConfig");
    if (config === undefined || config === null || typeof config.get !== "function") {
      return { mode: "auto", autoInit: true, max: 12 };
    }
    const leaf = (key) => {
      try {
        return config.get(key);
      } catch {
        return;
      }
    };
    const rawMode = leaf("workmates.mode");
    const rawMax = leaf("workmates.max");
    const rawAutoInit = leaf("workmates.autoInit");
    return {
      mode: rawMode === "none" ? "none" : "auto",
      autoInit: rawAutoInit === false ? false : true,
      max: typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 12
    };
  } catch {
    return { mode: "auto", autoInit: true, max: 12 };
  }
}
function workmateToolSeamOf(deps) {
  try {
    const adapter = deps.service("mpdDsh");
    if (adapter === undefined || adapter === null || typeof adapter.executeTool !== "function")
      return;
    return async (call, agent) => {
      const result = await adapter.executeTool({
        name: call.name,
        arguments: call.arguments ?? {},
        ...agent === undefined ? {} : { agent }
      });
      if (result === undefined || result === null)
        throw new Error(call.name + " answered nothing");
      if (result.isError === true || result.ok === false)
        throw new Error(call.name + " refused: " + String(result.error ?? "unknown"));
      return result.value;
    };
  } catch {
    return;
  }
}
function workmateKeyOf(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}
function explicitWorkmateOf(member) {
  const marker = /^[ \t]*\[?workmate[ \t]*:[ \t]*([A-Za-z0-9_-]+)\]?[ \t]*$/m;
  for (const text2 of [member.prompt, member.description]) {
    const hit = marker.exec(String(text2 ?? ""));
    if (hit !== null) {
      const key = workmateKeyOf(hit[1]);
      if (key !== "")
        return key;
    }
  }
  return;
}
async function listWorkmates(seam, agent) {
  try {
    const value = await seam({ name: "mpd_workmate_list" }, agent);
    const raw = Array.isArray(value?.workmates) ? value.workmates : [];
    return {
      rows: raw.map((row) => ({ name: workmateKeyOf(row?.name), baseName: String(row?.baseName ?? ""), workspaces: Array.isArray(row?.workspaces) ? row.workspaces.map(String).filter((workspace) => workspace !== "") : [] })).filter((row) => row.name !== ""),
      ok: true
    };
  } catch {
    return { rows: [], ok: false };
  }
}
function workmateHeadOf(deps, key) {
  try {
    const library = deps.service("mpdWorkmate");
    if (library === undefined || library === null || typeof library.read !== "function")
      return "";
    const record = library.read(key);
    if (record === null || record === undefined)
      return "";
    const persona = String(record.persona ?? "").trim();
    const note = String(record.note ?? "").trim();
    const memory = String(record.memory ?? "").trim();
    return [
      persona,
      note === "" ? "" : `Workmate note:
` + note,
      memory === "" ? "" : `Your independent memory (bounded, latest first):
` + memory
    ].filter((part) => part !== "").join(`

`);
  } catch {
    return "";
  }
}
async function bindStagedWorkmates(deps, plan, agent, workspace) {
  const plain = (reason) => ({
    members: plan.members.map((member) => ({ ...member })),
    tasks: plan.tasks,
    bindings: plan.members.map((member) => ({ member: member.name, mode: "none", reason }))
  });
  const config = workmateBindingConfigOf(deps);
  if (config.mode === "none")
    return plain("config");
  const seam = workmateToolSeamOf(deps);
  if (seam === undefined) {
    deps.log("workmate binding skipped: no mpdDsh tool seam in this composition — every seat stays plain");
    return plain("no-seam");
  }
  try {
    const members = plan.members.map((member) => ({ ...member }));
    const bindings = [];
    const taken = new Set(members.map((member) => member.name));
    let listing = await listWorkmates(seam, agent);
    const ownedHere = () => listing.rows.filter((row) => row.workspaces.includes(workspace)).length;
    if (!listing.ok)
      return plain("no-library");
    for (const [index, member] of members.entries()) {
      const original = member.name;
      const takenByOthers = new Set([...taken].filter((name2) => name2 !== original));
      const explicit = explicitWorkmateOf(member);
      if (explicit !== undefined) {
        if (!listing.rows.some((row) => row.name === explicit)) {
          return { error: `staged member "${original}" explicitly names workmate "${explicit}", which does not exist in the library — the approval is refused rather than downgrading the seat to a plain member; initialize it with mpd_workmate_init or remove the workmate: line`, members, tasks: plan.tasks, bindings };
        }
        if (takenByOthers.has(explicit)) {
          return { error: `staged member "${original}" explicitly names workmate "${explicit}", which another member of this team already takes — a member NAME is seat identity, so two seats may not share one workmate`, members, tasks: plan.tasks, bindings };
        }
        members[index] = { ...member, name: explicit, prompt: joinWorkmatePrompt(workmateHeadOf(deps, explicit), member.prompt) };
        taken.delete(original);
        taken.add(explicit);
        bindings.push({ member: explicit, mode: "reuse", workmate: explicit });
        continue;
      }
      const task = [member.description, member.role ?? ""].join(" ").trim();
      let matched;
      try {
        matched = await seam({ name: "mpd_workmate_match", arguments: { task } }, agent);
      } catch {
        matched = undefined;
      }
      const threshold = typeof matched?.threshold === "number" ? matched.threshold : WORKMATE_MATCH_THRESHOLD;
      const ranked = (Array.isArray(matched?.matches) ? matched.matches : []).map((row) => ({ name: workmateKeyOf(row?.name), score: Number(row?.score ?? 0) })).filter((row) => row.name !== "").sort((a, b) => b.score - a.score);
      const reusable = ranked.find((row) => row.score >= threshold && !takenByOthers.has(row.name));
      if (reusable !== undefined) {
        members[index] = { ...member, name: reusable.name, prompt: joinWorkmatePrompt(workmateHeadOf(deps, reusable.name), member.prompt) };
        taken.delete(original);
        taken.add(reusable.name);
        bindings.push({ member: reusable.name, mode: "reuse", workmate: reusable.name });
        continue;
      }
      const base = String(member.role ?? "").trim();
      if (!config.autoInit || base === "") {
        bindings.push({ member: original, mode: "none", reason: config.autoInit ? "no-role" : "auto-init-off" });
        continue;
      }
      if (ownedHere() >= config.max) {
        bindings.push({ member: original, mode: "none", reason: "cap" });
        continue;
      }
      const slug = workmateKeyOf(base) || "workmate";
      let ordinal = WORKMATE_NAME_FIRST_ORDINAL;
      while (listing.rows.some((row) => row.name === `${slug}-${ordinal}`) || takenByOthers.has(`${slug}-${ordinal}`))
        ordinal += 1;
      const name = `${slug}-${ordinal}`;
      try {
        await seam({ name: "mpd_workmate_init", arguments: { base, name } }, agent);
      } catch {
        bindings.push({ member: original, mode: "none", reason: "init-refused" });
        continue;
      }
      listing = { rows: [...listing.rows, { name, baseName: base, workspaces: [workspace] }], ok: true };
      members[index] = { ...member, name, prompt: joinWorkmatePrompt(workmateHeadOf(deps, name), member.prompt) };
      taken.delete(original);
      taken.add(name);
      bindings.push({ member: name, mode: "init", workmate: name });
    }
    const renames = new Map;
    plan.members.forEach((member, index) => {
      if (members[index].name !== member.name)
        renames.set(member.name, members[index].name);
    });
    const tasks = renames.size === 0 ? plan.tasks : plan.tasks.map((task) => task.owner !== undefined && renames.has(task.owner) ? { ...task, owner: renames.get(task.owner) } : task);
    return { members, tasks, bindings };
  } catch (error) {
    deps.log("workmate binding failed (" + String(error?.message ?? error) + ") — every seat stays plain");
    return plain("binding-failed");
  }
}
function joinWorkmatePrompt(head, prompt) {
  return head === "" ? prompt : head + `

` + prompt;
}
async function approveTeam(deps, caller, input = {}) {
  const slot = actionSlotKey(caller);
  if (approvalsInFlight.has(slot))
    return { ok: false, error: "an approval for this session is already running" };
  approvalsInFlight.add(slot);
  try {
    return await approveTeamBody(deps, caller, input);
  } finally {
    approvalsInFlight.delete(slot);
  }
}
async function approveTeamBody(deps, caller, input) {
  if (caller.agent === undefined)
    return { ok: false, error: "approve needs a live agent" };
  const { workspace, sessionId, lineage } = caller;
  try {
    const plan = readPlan(workspace, sessionId);
    if (plan === undefined)
      return { ok: false, error: 'no team is staged in this session — use action:"create" first' };
    if (plan.approvedAt !== undefined)
      return { ok: false, error: `plan ${plan.planId} is already approved` };
    const staged = plan.members.length + plan.tasks.length;
    if (staged === 0) {
      return { ok: false, error: `plan ${plan.planId} is EMPTY — it has 0 members and 0 tasks, and approving it would create a team with nothing in it; add a member with agent_teams_plan {action:"add_member", member:{name, prompt}} and/or a task with {action:"create_task", task:{subject, description}} first — a task added there must also declare its dependency answer with blocked_by: [...] (possibly []) or independent: true` };
    }
    try {
      deps.assertPlanGraph(plan);
      deps.assertScopesOrdered(plan);
    } catch (error) {
      return { ok: false, error: refusalOf(error) };
    }
    const parent = deps.deriveParentTeam(workspace, sessionId, lineage);
    if (input.dryRun === true) {
      return { ok: true, plan, created: { members: plan.members.map((m) => ({ name: m.name, id: "" })), tasks: plan.tasks.map((t) => ({ subject: t.subject, id: "" })) } };
    }
    const bound = await bindStagedWorkmates(deps, plan, caller.agent, workspace);
    if (bound.error !== undefined)
      return { ok: false, error: bound.error };
    const buildPlan = { ...plan, members: bound.members, tasks: bound.tasks };
    let record = createTeam(workspace, {
      name: plan.name,
      description: plan.description,
      leadSessionId: sessionId,
      planId: plan.planId,
      ...parent === undefined ? {} : { parentTeamId: parent.teamId }
    }, deps.now());
    for (const member of buildPlan.members) {
      record = addTeamMember(record, { name: member.name, description: member.description, ...member.role === undefined ? {} : { role: member.role } }, deps.now());
    }
    for (const binding of bound.bindings) {
      record = updateTeamMember(record, binding.member, {
        workmateMode: binding.mode,
        ...binding.workmate === undefined ? {} : { workmate: binding.workmate },
        ...binding.reason === undefined ? {} : { workmateReason: binding.reason }
      });
    }
    for (const task of buildPlan.tasks) {
      record = addTeamTask(record, {
        subject: task.subject,
        description: task.description,
        kind: task.kind ?? "work",
        ...task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy },
        ...task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes },
        ...task.owner === undefined ? {} : { owner: task.owner },
        ...task.coverageOf === undefined ? {} : { coverageOf: task.coverageOf },
        ...task.sourceTaskId === undefined ? {} : { sourceTaskId: task.sourceTaskId }
      }, deps.now());
    }
    const planAlias = new Map;
    buildPlan.tasks.forEach((task, index) => {
      const minted = record.tasks[index];
      if (minted === undefined)
        return;
      planAlias.set(String(index + 1), minted.id);
      if (!planAlias.has(task.subject))
        planAlias.set(task.subject, minted.id);
    });
    for (const [index, task] of buildPlan.tasks.entries()) {
      const minted = record.tasks[index];
      if (minted === undefined || (task.blockedBy ?? []).length === 0)
        continue;
      const mapped = (task.blockedBy ?? []).map((reference) => planAlias.get(reference) ?? reference);
      if (mapped.length === minted.blockedBy.length && mapped.every((id, at) => minted.blockedBy[at] === id))
        continue;
      record = updateTeamTask(record, minted.id, { blockedBy: mapped }, deps.now());
    }
    const created = { members: [], tasks: [] };
    const unresolvedBlockers = record.tasks.filter((task) => (task.unresolvedBlockers ?? []).length > 0).map((task) => ({ taskId: task.id, references: [...task.unresolvedBlockers ?? []] }));
    if (unresolvedBlockers.length > 0)
      created.unresolved = unresolvedBlockers;
    let stoppedAt;
    for (const member of record.members) {
      try {
        const spawned = await deps.executor().spawn(caller.agent, {
          teamId: record.teamId,
          memberId: member.id,
          name: member.name,
          description: member.description === "" ? member.name : member.description,
          prompt: withIdlePreamble(buildPlan.members.find((staged2) => staged2.name === member.name)?.prompt ?? member.description),
          ...member.role === undefined ? {} : { role: member.role },
          ...caller.signal === undefined ? {} : { signal: caller.signal }
        });
        created.members.push({ name: member.name, id: spawned.handle });
        record = updateTeamMember(record, member.id, { executorRef: spawned.handle, status: "running" });
      } catch (error) {
        record = removeTeamMember(record, member.id);
        stoppedAt = `member ${member.name}: ${String(error?.message ?? error)}`;
        break;
      }
    }
    if (stoppedAt === undefined)
      for (const task of record.tasks) {
        created.tasks.push({ subject: task.subject, id: task.id });
      }
    const approvedRecord = withDerivedPhase({ ...record, approvedAt: deps.now().toISOString() });
    writeTeam(workspace, approvedRecord);
    const approved = { ...plan, approvedAt: deps.now().toISOString(), created };
    writePlan(workspace, approved);
    if (stoppedAt === undefined)
      archivePlan(workspace, { ...approved });
    await deps.bundleApprovalEffects(plan, caller);
    return { ok: true, plan: approved, team: approvedRecord, created, bindings: bound.bindings, ...stoppedAt === undefined ? {} : { stoppedAt } };
  } catch (error) {
    return unexpectedRefusalOf(error);
  }
}
async function runDispatch(deps, caller, input = {}) {
  const slot = actionSlotKey(caller);
  if (dispatchesInFlight.has(slot))
    return { ok: false, error: "a dispatch pass for this session is already running" };
  dispatchesInFlight.add(slot);
  try {
    return await runDispatchBody(deps, caller, input);
  } finally {
    dispatchesInFlight.delete(slot);
  }
}
async function runDispatchBody(deps, caller, input) {
  if (caller.agent === undefined)
    return { ok: false, error: "dispatch needs a live agent" };
  const handover = readReassign(input.reassign);
  if (handover.invalid.length > 0)
    return { ok: false, error: `agent_teams_dispatch: ${handover.invalid.join("; ")}` };
  const requestedMode = input.mode;
  if (requestedMode !== undefined && requestedMode !== "owner-only" && requestedMode !== "roster") {
    return { ok: false, error: `agent_teams_dispatch: unknown mode "${String(requestedMode)}" (owner-only | roster)` };
  }
  const mode = requestedMode;
  const { workspace, sessionId, lineage } = caller;
  try {
    const hold = readHold(workspace);
    const reaped = reapReapedTeams(workspace, deps.now());
    let ledgerAfterReap = readLedger(workspace);
    const terminalForgotten = [];
    for (const endedTeamId of reaped) {
      const dropped = forgetTeam(ledgerAfterReap, endedTeamId);
      ledgerAfterReap = dropped.ledger;
      terminalForgotten.push(...dropped.forgotten);
    }
    if (terminalForgotten.length > 0)
      writeLedger(workspace, ledgerAfterReap);
    const teamId = deps.resolveTeam(workspace, sessionId, lineage).record?.teamId;
    const watchdog = teamId === undefined ? { state: "free" } : deps.readWatchdogHold(workspace, sessionId, lineage);
    const holdReason = hold?.reason ?? (watchdog.state === "held" ? watchdog.reason : undefined);
    const holdNote = watchdog.state === "not-readable" ? `not-readable: ${String(watchdog.reason ?? "the watchdog's hold could not be read")}` : undefined;
    const resolvedDispatch = deps.resolveTeam(workspace, sessionId, lineage);
    if (resolvedDispatch.record === undefined)
      return { ok: true, pairs: [], skipped: [], refused: resolvedDispatch.refusal ?? "no team record in this workspace — approve a plan first", ...reaped.length === 0 ? {} : { reaped } };
    let record = resolvedDispatch.record;
    const rosterRows = (() => {
      try {
        const roles = deps.service("mpdRoles");
        return typeof roles?.list === "function" ? roles.list() : [];
      } catch {
        return [];
      }
    })();
    if (rosterRows.length === 0)
      deps.log("[mpd-team-core] the mpdRoles service is absent or empty — the C7-2 read-only dispatch guard has no roster to classify against and fails OPEN");
    const readonlyKeys = readonlyMemberKeys(rosterRows);
    const reassigned = [];
    const reassignHalted = handover.pairs.length > 0 && holdReason !== undefined;
    if (handover.pairs.length > 0 && !reassignHalted) {
      const outcomes = await applyReassignments({
        workspace,
        team: record,
        pairs: handover.pairs,
        dryRun: input.dryRun === true,
        now: deps.now(),
        readonlyKeys,
        send: async (handle, content) => {
          await deps.executor().send(caller.agent, handle, content, caller.signal);
        }
      });
      reassigned.push(...outcomes);
      if (input.dryRun !== true)
        record = readTeam(workspace, record.teamId) ?? record;
    }
    const opened = record;
    const readyIds = new Set(readyTasks(opened).map((candidate) => candidate.id));
    const tasks = opened.tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      ready: readyIds.has(task.id),
      blockedBy: task.blockedBy,
      teamId: opened.teamId,
      writeScopes: task.writeScopes,
      ...task.owner === undefined ? {} : { ownerName: task.owner }
    }));
    const idle = new Set(idleMembers(opened).map((member) => member.name));
    const members = opened.members.map((member) => ({
      id: member.executorRef ?? member.id,
      name: member.name,
      status: idle.has(member.name) ? "inactive" : "running",
      teamId: opened.teamId,
      readonly: isReadonlyMemberName(member.name, readonlyKeys) || member.role !== undefined && isReadonlyMemberName(member.role, readonlyKeys),
      ...member.mode === undefined ? {} : { mode: member.mode },
      ...member.fenced === true ? { fenced: true } : {},
      ...member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason }
    }));
    const pruned = reconcile(readLedger(workspace), opened.teamId, tasks);
    const forgotten = [...new Set([...terminalForgotten, ...pruned.forgotten])];
    const plan = planDispatch({
      tasks,
      members,
      ledger: ledgerOfTeam(pruned.ledger, opened.teamId),
      ...holdReason === undefined ? {} : { hold: holdReason },
      ...typeof input.limit === "number" ? { limit: input.limit } : {},
      ...mode === undefined ? {} : { mode }
    });
    if (plan.halted !== undefined || input.dryRun === true || plan.pairs.length === 0) {
      if (pruned.forgotten.length > 0)
        writeLedger(workspace, pruned.ledger);
      return { ok: true, ...plan, forgotten, ...holdNote === undefined ? {} : { holdRead: holdNote }, ...reaped.length === 0 ? {} : { reaped }, ...reassigned.length === 0 ? {} : { reassigned } };
    }
    let ledger = pruned.ledger;
    const sent = [];
    const skipped = [...plan.skipped];
    for (const pair of plan.pairs) {
      const endDispatchWindow = deps.beginDispatch(pair.memberId);
      try {
        const task = opened.tasks.find((candidate) => candidate.id === pair.taskId);
        try {
          await deps.executor().send(caller.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String(task.description ?? "")), caller.signal);
          const onDisk = readTeam(workspace, opened.teamId);
          if (onDisk === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: "the team record disappeared while the pass was in flight" });
            continue;
          }
          const expected = record.tasks.find((candidate) => candidate.id === pair.taskId)?.revision;
          if (expected === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `task ${pair.taskId} is no longer on the pass's board` });
            continue;
          }
          const claimed = casClaimTask(onDisk, pair.taskId, pair.memberName, expected, deps.now());
          if (!claimed.applied) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the board refused the claim: ${claimed.reason}` });
            continue;
          }
          record = claimed.record;
          record = withDerivedPhase(updateTeamMember(record, pair.memberName, { status: "running" }));
          writeTeam(workspace, record);
          ledger = assign(ledger, { teamId: opened.teamId, taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName }, deps.now());
          sent.push(pair);
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String(error?.message ?? error)}` });
        }
      } finally {
        endDispatchWindow();
      }
    }
    const fresh = reconcile(readLedger(workspace), opened.teamId, tasks);
    const merged = { ...fresh.ledger };
    for (const pair of sent)
      merged[ledgerKey(opened.teamId, pair.taskId)] = ledger[ledgerKey(opened.teamId, pair.taskId)];
    writeLedger(workspace, merged);
    return { ok: true, pairs: sent, skipped, forgotten, ...holdNote === undefined ? {} : { holdRead: holdNote }, ...reaped.length === 0 ? {} : { reaped }, ...reassigned.length === 0 ? {} : { reassigned } };
  } catch (error) {
    return unexpectedRefusalOf(error);
  }
}
async function applyReassignments(deps) {
  const outcomes = [];
  for (const pair of deps.pairs) {
    const task = deps.team.tasks.find((row) => row.id === pair.taskId);
    if (task === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no board row is named ${JSON.stringify(pair.taskId)} — nothing was reassigned` });
      continue;
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is already ${task.status} — a terminal row is never reopened` });
      continue;
    }
    if (task.status !== "pending") {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is ${task.status}; release it first (agent_teams_task {action:"release", task_id:${JSON.stringify(pair.taskId)}}) and reassign the pending row` });
      continue;
    }
    const member = deps.team.members.find((row) => row.id === pair.owner || row.name === pair.owner);
    if (member === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no member ${JSON.stringify(pair.owner)} is on the roster of team ${deps.team.teamId}` });
      continue;
    }
    const target = {
      id: member.executorRef ?? member.id,
      name: member.name,
      status: member.status,
      ...member.mode === undefined ? {} : { mode: member.mode },
      ...member.fenced === true ? { fenced: true } : {},
      ...member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason },
      readonly: isReadonlyMemberName(member.name, deps.readonlyKeys) || member.role !== undefined && isReadonlyMemberName(member.role, deps.readonlyKeys)
    };
    const fence = memberFenceReason(target);
    if (fence !== undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is FENCED (${fence}) — a fenced member is never messaged` });
      continue;
    }
    if (member.status === "failed") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} FAILED to start, so it cannot take the row — pick a live member, and raise this seat again first` });
      continue;
    }
    if (member.status === "provisioning") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is still being raised, so it cannot take the row yet — wait for its handle, then reassign` });
      continue;
    }
    const pairing = pairingRefusal({
      id: task.id,
      subject: task.subject,
      status: task.status,
      ready: true,
      teamId: deps.team.teamId,
      writeScopes: task.writeScopes
    }, target);
    if (pairing !== undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: pairing });
      continue;
    }
    const handle = member.executorRef ?? "";
    if (handle === "") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} has no executor handle (never raised) — claiming the row for it would hide the row from the next pass` });
      continue;
    }
    const fresh = readTeam(deps.workspace, deps.team.teamId);
    const current = fresh?.tasks.find((row) => row.id === pair.taskId);
    if (fresh === undefined || current === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `row ${pair.taskId} disappeared while the reassignment was in flight` });
      continue;
    }
    const unmet = blockingDependencies(fresh.tasks, current.blockedBy).blocking;
    if (unmet.length > 0) {
      const named = unmet.map((id) => {
        const row = fresh.tasks.find((candidate) => candidate.id === id);
        return row === undefined ? id : id + " " + JSON.stringify(row.subject);
      });
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `task ${current.id} ${JSON.stringify(current.subject)} is BLOCKED by ${named.join(", ")}: the declared ${unmet.length === 1 ? "blocker is" : "blockers are"} not satisfied — close ${unmet[0]} first (agent_teams_task {action:"complete", task_id:"${unmet[0]}"}) or fail it, which releases its dependents, then reassign ${pair.taskId}` });
      continue;
    }
    if (deps.dryRun) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: "dry run — nothing was claimed, journaled or sent" });
      continue;
    }
    const previous = String(current.owner ?? "");
    const claimed = casClaimTask(fresh, pair.taskId, member.name, current.revision, deps.now);
    if (!claimed.applied) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the board refused the claim: ${claimed.reason}` });
      continue;
    }
    writeTeam(deps.workspace, claimed.record);
    appendTeamJournal(deps.workspace, { event: "task-reassigned", teamId: deps.team.teamId, at: deps.now.toISOString(), taskId: pair.taskId, member: member.name, ...previous === "" ? {} : { from: previous } });
    writeLedger(deps.workspace, assign(readLedger(deps.workspace), { teamId: deps.team.teamId, taskId: pair.taskId, memberId: handle, memberName: member.name }, deps.now));
    try {
      await deps.send(handle, dispatchMessage({ id: pair.taskId, subject: task.subject, status: "pending", ready: true }, String(task.description ?? "")));
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: true, delivered: true });
    } catch (error) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: true, delivered: false, reason: `the row IS claimed for ${JSON.stringify(member.name)} but the message failed: ${String(error?.message ?? error)}` });
    }
  }
  return outcomes;
}
async function setMemberFence(deps, caller, input, fenced) {
  try {
    const resolved = deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage);
    if (resolved.record === undefined)
      return { ok: false, error: resolved.refusal ?? "no team record in this workspace — approve a plan first" };
    if (!recordNamesLead(resolved.record, [caller.sessionId])) {
      return { ok: false, error: `only the Lead of team ${resolved.record.teamId} may ${fenced ? "fence" : "unfence"} a seat` };
    }
    const target = input.member.trim();
    const member = resolved.record.members.find((row) => row.id === target || row.name === target);
    if (member === undefined)
      return { ok: false, error: `no member ${JSON.stringify(input.member)} is on the roster of team ${resolved.record.teamId}` };
    const reason = fenced ? (input.reason ?? "").trim() : "";
    const next = updateTeamMember(resolved.record, member.name, fenced ? { fenced: true, ...reason === "" ? {} : { fencedReason: reason } } : { fenced: false, ...member.mode === "checkpoint" ? { mode: "member" } : {} });
    writeTeam(caller.workspace, next);
    appendTeamJournal(caller.workspace, { event: fenced ? "member-fenced" : "member-unfenced", teamId: resolved.record.teamId, at: deps.now().toISOString(), member: member.name, ...reason === "" ? {} : { reason } });
    return { ok: true, teamId: resolved.record.teamId, member: member.name, fenced, ...reason === "" ? {} : { reason } };
  } catch (error) {
    return unexpectedRefusalOf(error);
  }
}
async function fenceMember(deps, caller, input) {
  return setMemberFence(deps, caller, input, true);
}
async function unfenceMember(deps, caller, input) {
  return setMemberFence(deps, caller, input, false);
}
async function writeMemberHandoff(deps, caller, input) {
  try {
    const resolved = deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage);
    if (resolved.record === undefined)
      return { ok: false, error: resolved.refusal ?? "no team record in this workspace — approve a plan first" };
    const member = memberNamedBy(resolved.record, [caller.sessionId]);
    if (member === undefined)
      return { ok: false, error: `session ${caller.sessionId} is on no roster of team ${resolved.record.teamId} — only a member writes its own handoff` };
    const validation = validateHandoffText(input.content);
    if (!validation.ok)
      return { ok: false, error: `the handoff is missing these sections: ${validation.missing.join(", ")} — write them into the document and call again` };
    let ordinal = (member.handoff?.ordinal ?? 0) + 1;
    while (existsSync6(teamHandoffPath(caller.workspace, resolved.record.teamId, member.name, ordinal)))
      ordinal += 1;
    const path = writeHandoffDocument(caller.workspace, resolved.record.teamId, member.name, ordinal, input.content);
    writeTeam(caller.workspace, updateTeamMember(resolved.record, member.name, { handoff: { path, ordinal }, mode: "checkpoint" }));
    appendTeamJournal(caller.workspace, { event: "handoff-written", teamId: resolved.record.teamId, at: deps.now().toISOString(), member: member.name, path });
    return { ok: true, teamId: resolved.record.teamId, member: member.name, path, ordinal, mode: "checkpoint", directive: handoffWrittenDirective(path) };
  } catch (error) {
    return unexpectedRefusalOf(error);
  }
}
async function cancelTasks(deps, input) {
  try {
    const record = readTeam(input.workspace, input.teamId);
    if (record === undefined)
      return { ok: false, error: `no team record is named ${JSON.stringify(input.teamId)} in this workspace` };
    const cancelled = [];
    const skipped = [];
    let next = record;
    for (const taskId of input.taskIds) {
      const row = next.tasks.find((task) => task.id === taskId);
      if (row === undefined) {
        skipped.push({ taskId, reason: `no board row is named ${JSON.stringify(taskId)}` });
        continue;
      }
      if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
        skipped.push({ taskId, reason: `row ${taskId} is already ${row.status} — a terminal row is never re-cancelled` });
        continue;
      }
      next = updateTeamTask(next, taskId, { status: "cancelled", ...input.note === undefined ? {} : { note: input.note } }, deps.now());
      cancelled.push(taskId);
    }
    if (cancelled.length === 0)
      return { ok: true, teamId: record.teamId, cancelled, skipped };
    writeTeam(input.workspace, next);
    for (const taskId of cancelled) {
      appendTeamJournal(input.workspace, { event: "task-cancelled", teamId: record.teamId, at: deps.now().toISOString(), taskId, ...input.note === undefined ? {} : { reason: input.note } });
    }
    return { ok: true, teamId: record.teamId, cancelled, skipped };
  } catch (error) {
    return unexpectedRefusalOf(error);
  }
}

// packages/mpd-graph-core/src/rank.ts
function deriveRanks(tasks, byId) {
  const settled = new Map;
  const walking = new Set;
  for (const root of tasks) {
    if (settled.has(root.id))
      continue;
    const stack2 = [{ id: root.id, next: 0 }];
    walking.add(root.id);
    while (stack2.length > 0) {
      const frame = stack2[stack2.length - 1];
      const deps = (byId.get(frame.id)?.dependencies ?? []).filter((id) => byId.has(id));
      if (frame.next < deps.length) {
        const dependency = deps[frame.next];
        frame.next += 1;
        if (settled.has(dependency) || walking.has(dependency))
          continue;
        walking.add(dependency);
        stack2.push({ id: dependency, next: 0 });
        continue;
      }
      let deepest = 0;
      for (const dependency of deps)
        deepest = Math.max(deepest, (settled.get(dependency) ?? 0) + 1);
      settled.set(frame.id, deepest);
      walking.delete(frame.id);
      stack2.pop();
    }
  }
  return settled;
}
function servedRank(task) {
  return Number.isFinite(task.depth) && task.depth > 0 ? Math.floor(task.depth) : 0;
}
var ID_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function bucketRanks(tasks, rankOf) {
  const deepest = tasks.reduce((max, task) => Math.max(max, rankOf(task)), 0);
  const ranks = Array.from({ length: deepest + 1 }, () => []);
  for (const task of tasks)
    ranks[Math.min(Math.max(0, rankOf(task)), deepest)].push(task);
  for (const rank of ranks)
    rank.sort((left, right) => ID_ORDER.compare(left.id, right.id));
  return ranks;
}
function rankPlan(tasks, served) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const missing = new Set;
  let resolved = 0;
  for (const task of tasks) {
    for (const id of task.dependencies) {
      if (byId.has(id))
        resolved += 1;
      else
        missing.add(id);
    }
  }
  const unresolved = [...missing].sort();
  if (served !== undefined) {
    return { ranks: bucketRanks(tasks, (task) => served.get(task.id) ?? 0), rankOf: served, derived: false, unresolved };
  }
  if (tasks.length === 0)
    return { ranks: [], rankOf: new Map, derived: true, unresolved };
  const servedVaries = new Set(tasks.map((task) => servedRank(task))).size > 1;
  if (resolved === 0 && servedVaries) {
    const ranks = bucketRanks(tasks, servedRank);
    const rankOf = new Map;
    ranks.forEach((rank, index) => {
      for (const task of rank)
        rankOf.set(task.id, index);
    });
    return { ranks, rankOf, derived: false, unresolved };
  }
  const derived = deriveRanks(tasks, byId);
  return { ranks: bucketRanks(tasks, (task) => derived.get(task.id) ?? 0), rankOf: derived, derived: true, unresolved };
}
function cycleIds2(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set;
  const stack2 = [];
  const onStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (onStack.has(id)) {
      for (const entry of stack2.slice(stack2.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    onStack.add(id);
    stack2.push(id);
    for (const dependency of task.dependencies)
      if (byId.has(dependency))
        visit(dependency);
    stack2.pop();
    onStack.delete(id);
    done.add(id);
  };
  for (const task of tasks)
    visit(task.id);
  return [...cyclic].sort();
}
// packages/mpd-graph-core/src/plan.ts
var TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
var FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
var SECTION_BOUNDARY = /^#{1,2}(?:[ \t]+|$)/;
var FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
var TODO_TASK = /^(?:[-*][ \t]+(?:\[[ xX]\][ \t]+)?)?([1-9][0-9]*)\.\s+(\S.*)$/;
var FINAL_TASK = /^(?:[-*][ \t]+(?:\[[ xX]\][ \t]+)?)?([Ff][1-9][0-9]*)\.\s+(\S.*)$/;
var TASK_CANDIDATE = /^(?:[-*][ \t]+|[0-9]+\.|[Ff][0-9]+\.)/;
var LANE_MARKER = /^(?:Lane\s+)?([A-Za-z][A-Za-z0-9]{0,3})\s*(?:\.[ \t]*|—[ \t]*|–[ \t]*|·[ \t]*|:[ \t]*|\()/;
var PARENTHESISED_BLOCKS = /\(\s*blocked[\s_-]+by\s*:?\s*([^)]+)\)/gi;
var LABELLED_BLOCKS = /(?:blocked[\s_-]+by|depends[\s_-]+on)\s*:\s*([^.()\n]+)/gi;
function splitCells(row) {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|"))
    return [];
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|").map((cell2) => cell2.trim());
}
function isTableSeparator(row) {
  const cells = splitCells(row);
  return cells.length > 0 && cells.every((cell2) => /^:?-+:?$/.test(cell2.replace(/[ \t]/g, "")));
}
function stripEmphasis(text2) {
  let value = text2.trim();
  while (value.startsWith("**") || value.startsWith("*") || value.startsWith("`")) {
    value = (value.startsWith("**") ? value.slice(2) : value.slice(1)).trim();
  }
  while (value.endsWith("**") || value.endsWith("*") || value.endsWith("`")) {
    value = (value.endsWith("**") ? value.slice(0, -2) : value.slice(0, -1)).trim();
  }
  return value;
}
function laneKeyOf(text2) {
  const value = stripEmphasis(text2);
  const match = /^(?:Lane\s+)?([A-Za-z][A-Za-z0-9]{0,3})(?=[ \t]*[.:—–·(]|[ \t]*$)/.exec(value);
  return match === null ? undefined : match[1].toUpperCase();
}
function leadingLane(text2) {
  let value = text2.trim();
  let bold = false;
  if (value.startsWith("**")) {
    bold = true;
    value = value.slice(2);
  }
  const match = LANE_MARKER.exec(value);
  if (match === null)
    return;
  let rest = value.slice(match[0].length);
  if (match[0].endsWith("(")) {
    const close = rest.indexOf(")");
    if (close >= 0)
      rest = rest.slice(close + 1);
  }
  if (bold && rest.startsWith("**"))
    rest = rest.slice(2);
  rest = rest.replace(/^[ \t]*(?:—|–|-|·|:)[ \t]*/, "").trim();
  return { key: match[1].toUpperCase(), title: rest === "" ? value.trim() : rest };
}
function normalizeOwner(cell2) {
  const value = stripEmphasis(cell2);
  const cut = value.indexOf("(");
  return (cut >= 0 ? value.slice(0, cut) : value).trim();
}
function readableLines(text2) {
  const lines = [];
  let fence;
  let number = 0;
  for (const raw of text2.split(`
`)) {
    number += 1;
    const opener = FENCE.exec(raw);
    if (fence === undefined) {
      if (opener !== null) {
        fence = { marker: opener[1][0], length: opener[1].length };
        continue;
      }
      lines.push({ text: raw.replace(/\r$/, ""), line: number });
      continue;
    }
    if (opener !== null && opener[1][0] === fence.marker && opener[1].length >= fence.length && opener[2].trim() === "") {
      fence = undefined;
    }
  }
  return lines;
}
function collectLanes(lines, problems) {
  const lanes = new Map;
  let index = 0;
  while (index < lines.length) {
    const header = splitCells(lines[index].text);
    const named = header.some((cell2) => stripEmphasis(cell2).toLowerCase() === "lane") && header.some((cell2) => stripEmphasis(cell2).toLowerCase() === "owner");
    const separator = lines[index + 1];
    if (!named || separator === undefined || !isTableSeparator(separator.text)) {
      index += 1;
      continue;
    }
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].text.trimStart().startsWith("|")) {
      const cells = splitCells(lines[cursor].text);
      const key = laneKeyOf(cells[0] ?? "");
      const owner = cells.length > 1 ? normalizeOwner(cells[1]) : "";
      if (key === undefined || owner === "") {
        problems.push({
          line: lines[cursor].line,
          text: lines[cursor].text,
          reason: key === undefined ? "lane table row names no lane label" : "lane table row names no owner"
        });
      } else if (!lanes.has(key)) {
        lanes.set(key, owner);
      }
      cursor += 1;
    }
    index = cursor;
  }
  return lanes;
}
function collectTasks(lines, lanes, problems) {
  const tasks = [];
  let section;
  for (const line of lines) {
    if (TODO_HEADING.test(line.text)) {
      section = "todo";
      continue;
    }
    if (FINAL_WAVE_HEADING.test(line.text)) {
      section = "final-wave";
      continue;
    }
    if (SECTION_BOUNDARY.test(line.text)) {
      section = undefined;
      continue;
    }
    if (section === undefined)
      continue;
    if (line.text.trim() === "")
      continue;
    if (/^[ \t]/.test(line.text))
      continue;
    if (!TASK_CANDIDATE.test(line.text))
      continue;
    const grammar = section === "todo" ? TODO_TASK : FINAL_TASK;
    const match = grammar.exec(line.text);
    if (match === null) {
      problems.push({
        line: line.line,
        text: line.text,
        reason: section === "todo" ? "not a numbered TODO item" : "not an F<n> final-verification item"
      });
      continue;
    }
    const afterOrdinal = match[2].trim();
    const mark = leadingLane(afterOrdinal);
    const lane = mark !== undefined && lanes.has(mark.key) ? mark.key : undefined;
    if (mark !== undefined && lane === undefined) {
      problems.push({ line: line.line, text: line.text, reason: `leading lane marker ${mark.key} names no lane the plan declares` });
    }
    const title = mark !== undefined && lane !== undefined ? mark.title : afterOrdinal;
    tasks.push({
      id: section === "todo" ? `T${match[1]}` : match[1].toUpperCase(),
      title,
      source: line.text,
      section,
      line: line.line,
      lane,
      references: declaredReferences(afterOrdinal)
    });
  }
  return tasks;
}
function declaredReferences(text2) {
  const lists = [];
  for (const match of text2.matchAll(PARENTHESISED_BLOCKS))
    lists.push(match[1]);
  for (const match of text2.matchAll(LABELLED_BLOCKS))
    lists.push(match[1]);
  return lists.flatMap((list) => list.split(/[ \t]*(?:,|\+|&|\band\b)[ \t]*/i).map((token) => token.trim()).filter((token) => token !== ""));
}
function resolveTask(task, lanes, byLane, problems) {
  const ids = [];
  for (const token of task.references) {
    const idMatch = /^(T|F)?([1-9][0-9]*)$/i.exec(token);
    const laneMatch = /^(?:Lane[ \t]+)?([A-Za-z][A-Za-z0-9]{0,3})$/i.exec(token);
    if (idMatch !== null) {
      ids.push(`${(idMatch[1] ?? "T").toUpperCase()}${idMatch[2]}`);
      continue;
    }
    if (laneMatch !== null) {
      const key = laneMatch[1].toUpperCase();
      const declared = byLane.get(key) ?? [];
      if (declared.length > 0) {
        for (const other of declared)
          if (other.id !== task.id)
            ids.push(other.id);
        continue;
      }
    }
    problems.push({ line: task.line, text: task.source, reason: `"${token}" names no task id and no declared lane` });
  }
  const owner = task.lane === undefined ? undefined : lanes.get(task.lane);
  const blockedBy = [...new Set(ids)].sort((left, right) => ID_ORDER.compare(left, right));
  return { id: task.id, title: task.title, section: task.section, line: task.line, owner, blockedBy };
}
function parsePlanMarkdown(text2) {
  const lines = readableLines(text2);
  const problems = [];
  const lanes = collectLanes(lines, problems);
  const raw = collectTasks(lines, lanes, problems);
  const seen = new Set;
  const byLane = new Map;
  for (const task of raw) {
    if (task.lane === undefined)
      continue;
    const list = byLane.get(task.lane) ?? [];
    list.push(task);
    byLane.set(task.lane, list);
  }
  const tasks = [];
  for (const task of raw) {
    if (seen.has(task.id)) {
      problems.push({ line: task.line, text: task.source, reason: `duplicate task id ${task.id}` });
      continue;
    }
    seen.add(task.id);
    tasks.push(resolveTask(task, lanes, byLane, problems));
  }
  problems.sort((left, right) => left.line - right.line || left.text.localeCompare(right.text));
  const laneRows = [...lanes].map(([key, owner]) => ({ key, owner })).sort((left, right) => ID_ORDER.compare(left.key, right.key));
  return { tasks: tasks.sort((left, right) => ID_ORDER.compare(left.id, right.id)), lanes: laneRows, problems };
}
// packages/mpd-graph-core/src/model.ts
var BOARD_VISUALS = new Set(["completed", "running", "failed", "blocked", "open", "cancelled"]);
var GROUP_VISUAL = "group";
function visualOf(task) {
  if (task.visual !== undefined && BOARD_VISUALS.has(task.visual))
    return task.visual;
  return statusVisual(task.status);
}
function statusVisual(status) {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "claimed":
    case "in_progress":
      return "running";
    case "blocked":
      return "blocked";
    default:
      return "open";
  }
}
function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => ID_ORDER.compare(left, right));
}
function sortedIds(ids) {
  return [...new Set(ids)].sort((left, right) => ID_ORDER.compare(left, right));
}
function pairKey(from, to) {
  return `${from}\x00${to}`;
}
function byNodeId(left, right) {
  return ID_ORDER.compare(left.id, right.id);
}
function byFrameId(left, right) {
  return ID_ORDER.compare(left.id ?? "", right.id ?? "");
}
function byFrameDepthThenId(left, right) {
  return left.depth - right.depth || ID_ORDER.compare(left.id, right.id);
}
function isGroupFrame(frame) {
  return frame.id !== null && frame.label !== null;
}
function frameName(frame) {
  return frame.id === null ? "the root frame" : `group "${frame.id}"`;
}
function refuseDuplicate(id, first, second) {
  throw new Error(`mpd-graph-core: the grouping input carries id "${id}" in ${frameName(first)} and ${frameName(second)}; ids must be unique across the whole tree`);
}
function claimId(frameOf, id, frame) {
  const held = frameOf.get(id);
  if (held !== undefined)
    refuseDuplicate(id, held, frame);
  frameOf.set(id, frame);
}
function collectFrame(group, parent) {
  const frame = {
    id: group.id,
    label: group.label,
    parent,
    depth: parent.depth + 1,
    board: group.board ?? [],
    children: [],
    ...group.originTaskId === undefined ? {} : { originTaskId: group.originTaskId },
    ...group.plan === undefined ? {} : { plan: group.plan }
  };
  frame.children = (group.groups ?? []).map((child) => collectFrame(child, frame)).sort(byFrameId);
  return frame;
}
function flattenFrames(root) {
  const frames = [];
  const walk = (frame) => {
    frames.push(frame);
    for (const child of frame.children)
      walk(child);
  };
  walk(root);
  return frames;
}
function mergeFrame(frame) {
  const boardById = new Map;
  for (const task of frame.board)
    boardById.set(task.id, task);
  const planById = new Map;
  for (const task of frame.plan?.tasks ?? [])
    planById.set(task.id, task);
  const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort((left, right) => ID_ORDER.compare(left, right));
  const nodes = [];
  for (const id of ids) {
    const board = boardById.get(id);
    const planned = planById.get(id);
    const kind = board?.kind;
    const assignee = board?.owner ?? planned?.owner;
    const title = planned?.title;
    const status = board?.status;
    nodes.push({
      id,
      subject: board?.subject ?? planned?.title ?? id,
      visual: board === undefined ? "planned" : visualOf(board),
      dependencies: uniqueSorted([...board?.blockedBy ?? [], ...planned?.blockedBy ?? []]),
      depth: board?.depth ?? 0,
      planned: board === undefined,
      ...kind === undefined ? {} : { kind },
      ...assignee === undefined ? {} : { assignee },
      ...title === undefined ? {} : { title },
      ...status === undefined ? {} : { status },
      ...frame.id === null ? {} : { group: frame.id }
    });
  }
  const declared = new Map;
  for (const task of boardById.values()) {
    for (const from of task.blockedBy ?? []) {
      const entry = declared.get(pairKey(from, task.id)) ?? { from, to: task.id, board: false, plan: false, derived: false };
      entry.board = true;
      declared.set(pairKey(from, task.id), entry);
    }
  }
  for (const task of planById.values()) {
    for (const from of task.blockedBy) {
      const entry = declared.get(pairKey(from, task.id)) ?? { from, to: task.id, board: false, plan: false, derived: false };
      entry.plan = true;
      declared.set(pairKey(from, task.id), entry);
    }
  }
  return {
    frame,
    nodes,
    declared: [...declared.values()],
    boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
    planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id))
  };
}
function lowestCommonFrame(left, right) {
  const ancestors = new Set;
  for (let frame = right;frame !== null; frame = frame.parent)
    ancestors.add(frame);
  for (let frame = left;frame !== null; frame = frame.parent)
    if (ancestors.has(frame))
      return frame;
  return left;
}
function anchorAt(frame, home, id) {
  if (frame === home)
    return id;
  let current = frame;
  while (current.parent !== home) {
    if (current.parent === null)
      return id;
    current = current.parent;
  }
  return current.id ?? id;
}
function edgeSource(entry) {
  if (entry.board && entry.plan)
    return "both";
  if (entry.plan)
    return "plan";
  if (entry.board)
    return "board";
  return "derived";
}
function placeEdge(edgeMaps, frameOf, entry) {
  const fromFrame = frameOf.get(entry.from);
  const toFrame = frameOf.get(entry.to);
  if (fromFrame === undefined || toFrame === undefined)
    return;
  const home = lowestCommonFrame(fromFrame, toFrame);
  const from = anchorAt(fromFrame, home, entry.from);
  const to = anchorAt(toFrame, home, entry.to);
  if (entry.derived && from === to)
    return;
  const held = edgeMaps.get(home);
  if (held === undefined)
    return;
  const merged = held.get(pairKey(from, to)) ?? { from, to, board: false, plan: false, derived: false };
  merged.board = merged.board || entry.board;
  merged.plan = merged.plan || entry.plan;
  merged.derived = merged.derived || entry.derived;
  held.set(pairKey(from, to), merged);
}
function buildModel(input) {
  const root = {
    id: null,
    label: null,
    parent: null,
    depth: -1,
    board: input.board ?? [],
    children: [],
    ...input.plan === undefined ? {} : { plan: input.plan }
  };
  root.children = (input.groups ?? []).map((group) => collectFrame(group, root)).sort(byFrameId);
  const frames = flattenFrames(root);
  const merges = frames.map((frame) => mergeFrame(frame));
  const frameOf = new Map;
  for (const merge of merges)
    for (const node2 of merge.nodes)
      claimId(frameOf, node2.id, merge.frame);
  const level = new Map;
  for (const merge of merges)
    level.set(merge.frame, [...merge.nodes].sort(byNodeId));
  const pseudos = [];
  for (const frame of frames) {
    if (!isGroupFrame(frame) || frame.parent === null)
      continue;
    const parent = frame.parent;
    const pseudo = {
      id: frame.id,
      subject: frame.label,
      visual: GROUP_VISUAL,
      dependencies: [],
      depth: 0,
      planned: false,
      ...parent.id === null ? {} : { group: parent.id }
    };
    claimId(frameOf, frame.id, parent);
    pseudos.push(pseudo);
    level.get(parent)?.push(pseudo);
  }
  const edgeMaps = new Map;
  for (const frame of frames)
    edgeMaps.set(frame, new Map);
  for (const merge of merges)
    for (const entry of merge.declared)
      placeEdge(edgeMaps, frameOf, entry);
  for (const frame of frames) {
    if (!isGroupFrame(frame) || frame.originTaskId === undefined)
      continue;
    if (!frameOf.has(frame.originTaskId))
      continue;
    placeEdge(edgeMaps, frameOf, { from: frame.originTaskId, to: frame.id, board: false, plan: false, derived: true });
  }
  const drawnDeps = new Map;
  for (const frame of frames) {
    const blockers = new Map;
    const held = edgeMaps.get(frame);
    if (held !== undefined) {
      for (const entry of held.values()) {
        const list = blockers.get(entry.to);
        if (list === undefined)
          blockers.set(entry.to, [entry.from]);
        else
          list.push(entry.from);
      }
    }
    drawnDeps.set(frame, blockers);
  }
  for (const pseudo of pseudos) {
    const parent = frameOf.get(pseudo.id);
    if (parent === undefined)
      continue;
    pseudo.dependencies = uniqueSorted(drawnDeps.get(parent)?.get(pseudo.id) ?? []);
  }
  const layouts = new Map;
  let rootLayout;
  const drawingNodes = new Map;
  for (const frame of frames) {
    const nodes2 = level.get(frame) ?? [];
    const drawn = nodes2.map((node2) => ({ ...node2, dependencies: uniqueSorted(drawnDeps.get(frame)?.get(node2.id) ?? []) }));
    drawingNodes.set(frame, drawn);
    const layout = rankPlan(drawn);
    layouts.set(frame, layout);
    if (frame === root)
      rootLayout = layout;
    for (const node2 of nodes2)
      node2.depth = layout.rankOf.get(node2.id) ?? node2.depth;
  }
  const edges = [];
  for (const frame of frames) {
    const held = edgeMaps.get(frame);
    if (held === undefined)
      continue;
    for (const entry of held.values())
      edges.push({ from: entry.from, to: entry.to, source: edgeSource(entry) });
  }
  edges.sort((left, right) => ID_ORDER.compare(left.from, right.from) || ID_ORDER.compare(left.to, right.to));
  const nodes = [...merges.flatMap((merge) => merge.nodes), ...pseudos].sort(byNodeId);
  const ranks = (rootLayout?.ranks ?? []).map((rank) => rank.map((task) => task.id));
  const cyclic = new Set;
  for (const frame of frames)
    for (const id of cycleIds2(drawingNodes.get(frame) ?? []))
      cyclic.add(id);
  const refs = new Set;
  for (const merge of merges)
    for (const node2 of merge.nodes)
      for (const ref of node2.dependencies)
        refs.add(ref);
  for (const frame of frames)
    if (frame.originTaskId !== undefined)
      refs.add(frame.originTaskId);
  const unresolved = [...refs].filter((ref) => !frameOf.has(ref)).sort();
  const report = {
    boardOnly: sortedIds(merges.flatMap((merge) => merge.boardOnly)),
    planOnly: sortedIds(merges.flatMap((merge) => merge.planOnly)),
    edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
    edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
    planProblems: frames.flatMap((frame) => [...frame.plan?.problems ?? []]),
    unresolved,
    ranksDerived: rootLayout?.derived ?? true
  };
  const groups = groupRecords(frames, level);
  return { nodes, edges, ranks, cycles: [...cyclic].sort(), report, ...groups.length === 0 ? {} : { groups } };
}
function groupRecords(frames, level) {
  const groups = [];
  for (const frame of frames.filter(isGroupFrame).sort(byFrameDepthThenId)) {
    groups.push({
      id: frame.id,
      label: frame.label,
      parentId: frame.parent === null ? null : frame.parent.id,
      memberIds: sortedIds((level.get(frame) ?? []).map((node2) => node2.id)),
      depth: frame.depth,
      ...frame.originTaskId === undefined ? {} : { originTaskId: frame.originTaskId }
    });
  }
  return groups;
}
// packages/mpd-graph-core/src/resolve.ts
import { readFileSync as readFileSync8, readdirSync as readdirSync4, statSync as statSync3 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join10, resolve as resolve3 } from "node:path";
var LEDGER_PATH = join10(".mpd", "boulder.json");
var PLANS_DIR = join10(".mpd", "plans");
var EMPTY_PLAN = { tasks: [], lanes: [], problems: [] };
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function planPathFrom(root, value) {
  if (typeof value !== "string" || value.trim() === "")
    return;
  return isAbsolute2(value) ? resolve3(value) : resolve3(root, value);
}
function readBoulderState(root) {
  try {
    const parsed = JSON.parse(readFileSync8(join10(root, LEDGER_PATH), "utf8"));
    return isRecord4(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}
function beaconPlan(root) {
  const state = readBoulderState(root);
  if (state === undefined)
    return;
  const works = isRecord4(state.works) ? state.works : undefined;
  const activeId = typeof state.active_work_id === "string" ? state.active_work_id : undefined;
  const record = works !== undefined && activeId !== undefined && isRecord4(works[activeId]) ? works[activeId] : undefined;
  if (record === undefined || record.status !== "active")
    return;
  const path = planPathFrom(root, record.active_plan) ?? planPathFrom(root, state.active_plan);
  if (path === undefined)
    return;
  try {
    return statSync3(path).isFile() ? path : undefined;
  } catch {
    return;
  }
}
function newestPlan(root) {
  const candidates = [];
  try {
    const directory = plansDirectory(root);
    const entries = readdirSync4(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".zh-CN.md"))
        continue;
      const path = join10(directory, entry.name);
      const stats = statSync3(path, { throwIfNoEntry: false });
      if (stats === undefined)
        continue;
      candidates.push({ path, mtimeMs: stats.mtimeMs, name: entry.name });
    }
  } catch {
    return;
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  return candidates[0]?.path;
}
function plansDirectory(workspaceRoot) {
  return join10(workspaceRoot, PLANS_DIR);
}
function resolvePlanFile(workspaceRoot) {
  const beacon = beaconPlan(workspaceRoot);
  if (beacon !== undefined)
    return beacon;
  return newestPlan(workspaceRoot);
}
function readPlanFile(path) {
  if (path === undefined)
    return { tasks: [...EMPTY_PLAN.tasks], lanes: [...EMPTY_PLAN.lanes], problems: [...EMPTY_PLAN.problems] };
  try {
    return parsePlanMarkdown(readFileSync8(path, "utf8"));
  } catch {
    return { tasks: [], lanes: [], problems: [{ line: 0, text: path, reason: "plan file could not be read" }] };
  }
}
// packages/mpd-graph-core/src/watch.ts
import { readdirSync as readdirSync5, statSync as statSync4, watch } from "node:fs";
import { basename, dirname, join as join11 } from "node:path";
var REARM_DELAYS_MS = [25, 100, 400];
function defaultCreateWatch(path, listener) {
  return watch(path, { persistent: false }, (eventType, filename) => listener(String(eventType), filename ?? undefined));
}
function statOrUndefined(path) {
  try {
    return statSync4(path);
  } catch {
    return;
  }
}
function nearestExistingDirectory(path) {
  let current = path;
  for (;; ) {
    let exists = false;
    try {
      exists = statSync4(current).isDirectory();
    } catch {
      exists = false;
    }
    if (exists)
      return current;
    const parent = dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function fileSignature(path) {
  const stats = statOrUndefined(path);
  return stats === undefined ? "missing" : `${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}`;
}
function directorySignature(directory, accept) {
  let names;
  try {
    names = readdirSync5(directory);
  } catch {
    return "unavailable";
  }
  const parts = [];
  for (const name of names.sort()) {
    if (!accept(name))
      continue;
    const stats = statOrUndefined(join11(directory, name));
    if (stats === undefined)
      continue;
    parts.push(`${name}:${stats.ino}:${stats.mtimeMs}:${stats.size}`);
  }
  return parts.join(";");
}
function boardSignature(directory) {
  return directorySignature(directory, (name) => name.endsWith(".json"));
}
function plansSignature(directory) {
  return directorySignature(directory, (name) => name.endsWith(".md") && !name.endsWith(".zh-CN.md"));
}
function targetSignature(target) {
  if (target.kind === "board-dir")
    return boardSignature(target.path);
  if (target.kind === "plans-dir")
    return plansSignature(target.path);
  return fileSignature(target.path);
}
function watchGraph(targets, options = {}) {
  const debounceMs = options.debounceMs ?? 150;
  const watched = [];
  if (targets.boardDir !== undefined)
    watched.push({ path: targets.boardDir, kind: "board-dir" });
  if (targets.planFile !== undefined)
    watched.push({ path: targets.planFile, kind: "plan-file" });
  if (targets.plansDir !== undefined)
    watched.push({ path: targets.plansDir, kind: "plans-dir" });
  const signatures = new Map;
  for (const target of watched)
    signatures.set(target.path, targetSignature(target));
  const armed = new Map;
  const listeners = new Set;
  if (options.onChange !== undefined)
    listeners.add(options.onChange);
  let timer;
  const rearmTimers = new Set;
  let pending = 0;
  let sequence = 0;
  let coalesced = 0;
  let closed = false;
  function report(error) {
    options.onError?.(error);
  }
  function markDead(entry, directory) {
    if (closed)
      return;
    if (armed.get(directory) !== entry)
      return;
    if (entry.dead)
      return;
    entry.dead = true;
    scheduleRearm();
  }
  function scheduleRearm() {
    if (closed)
      return;
    for (const delay of REARM_DELAYS_MS) {
      const attempt = setTimeout(() => {
        rearmTimers.delete(attempt);
        arm();
        if (timer === undefined)
          deliver(false);
      }, delay);
      rearmTimers.add(attempt);
    }
  }
  function relevant(name) {
    if (name === undefined)
      return true;
    for (const [directory, entry] of armed) {
      if (!entry.exact)
        return true;
      if (name === basename(directory))
        return true;
      if (entry.board && name.endsWith(".json"))
        return true;
      if (entry.plans && name.endsWith(".md"))
        return true;
      if (entry.names.has(name))
        return true;
      if (entry.names.size > 0 && name.endsWith(".md"))
        return true;
    }
    return false;
  }
  function armDirectory(directory) {
    const stats = statOrUndefined(directory);
    if (stats === undefined) {
      report(new Error("watch target disappeared before it could be armed: " + directory));
      return;
    }
    try {
      const watcher = (options.createWatch ?? defaultCreateWatch)(directory, (_eventType, name) => notify(name));
      return { watcher, ino: stats.ino, birthtimeMs: stats.birthtimeMs };
    } catch (error) {
      report(error);
      return;
    }
  }
  function arm() {
    if (closed)
      return;
    const wanted = new Map;
    for (const target of watched) {
      const wantedDir = target.kind === "plan-file" ? dirname(target.path) : target.path;
      const existing = nearestExistingDirectory(wantedDir);
      if (existing === undefined)
        continue;
      const entry = wanted.get(existing) ?? { exact: existing === wantedDir, board: false, plans: false, names: new Set };
      entry.exact = entry.exact && existing === wantedDir;
      if (target.kind === "plan-file")
        entry.names.add(basename(target.path));
      else if (existing === wantedDir && target.kind === "board-dir")
        entry.board = true;
      else if (existing === wantedDir && target.kind === "plans-dir")
        entry.plans = true;
      wanted.set(existing, entry);
    }
    for (const [directory, entry] of armed) {
      const stats = statOrUndefined(directory);
      const sameDirectory = stats !== undefined && stats.ino === entry.ino && stats.birthtimeMs === entry.birthtimeMs;
      if (!entry.dead && wanted.has(directory) && sameDirectory)
        continue;
      entry.watcher.close();
      armed.delete(directory);
    }
    for (const [directory, desired] of wanted) {
      if (armed.has(directory))
        continue;
      const attached = armDirectory(directory);
      if (attached === undefined)
        continue;
      const entry = { watcher: attached.watcher, ino: attached.ino, birthtimeMs: attached.birthtimeMs, dead: false, exact: desired.exact, board: desired.board, plans: desired.plans, names: desired.names };
      attached.watcher.on("close", () => markDead(entry, directory));
      attached.watcher.on("error", (error) => {
        report(error);
        markDead(entry, directory);
      });
      armed.set(directory, entry);
    }
  }
  function deliver(manual) {
    if (closed)
      return false;
    const changed = [];
    for (const target of watched) {
      const current = targetSignature(target);
      if (current === signatures.get(target.path))
        continue;
      signatures.set(target.path, current);
      changed.push(target.path);
    }
    if (changed.length === 0) {
      pending = 0;
      arm();
      return false;
    }
    changed.sort();
    sequence += 1;
    const absorbed = pending;
    pending = 0;
    coalesced += absorbed;
    const event = { paths: changed, manual, sequence, coalesced: absorbed };
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        report(error);
      }
    }
    arm();
    return true;
  }
  function notify(name) {
    if (closed)
      return;
    if (!relevant(name))
      return;
    pending += 1;
    if (timer !== undefined)
      clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      deliver(false);
    }, debounceMs);
  }
  arm();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    poll() {
      if (closed)
        return false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      return deliver(true);
    },
    close() {
      if (closed)
        return;
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const pendingAttempt of rearmTimers)
        clearTimeout(pendingAttempt);
      rearmTimers.clear();
      for (const entry of armed.values())
        entry.watcher.close();
      armed.clear();
      listeners.clear();
    },
    get watching() {
      return armed.size > 0;
    },
    get closed() {
      return closed;
    },
    get sequence() {
      return sequence;
    },
    get coalesced() {
      return coalesced;
    }
  };
}
// packages/mpd-team-core-plugin/src/graph-model.ts
function boardOf(record) {
  const summary = summariseTeam(record);
  return record.tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    kind: task.kind,
    status: task.status,
    ...task.owner === undefined ? {} : { owner: task.owner },
    blockedBy: [...task.blockedBy],
    depth: summary.depths.get(task.id) ?? 0,
    visual: taskVisual(task, record.tasks),
    ...task.attempt === undefined ? {} : { attempt: task.attempt }
  }));
}
function messageOf(error) {
  return String(error?.message ?? error);
}
function framedBoardOf(record) {
  const own = new Set(record.tasks.map((task) => task.id));
  return boardOf(record).map((row) => ({
    ...row,
    id: `${record.teamId}::${row.id}`,
    blockedBy: (row.blockedBy ?? []).map((reference) => own.has(reference) ? `${record.teamId}::${reference}` : reference)
  }));
}
function groupInputsOf(children, parentTeamId, archive, warn, seen) {
  const own = children.get(parentTeamId) ?? [];
  const inputs = [];
  for (const child of own) {
    if (seen.has(child.teamId)) {
      warn?.(`[mpd-team-core] team ${child.teamId} is nested inside ${parentTeamId}, which is already on its own parent chain — the record was edited by hand; the projection skips the repeat`);
      continue;
    }
    if (!isLiveTeam(child, archive))
      continue;
    seen.add(child.teamId);
    const nested = groupInputsOf(children, child.teamId, archive, warn, seen);
    inputs.push({
      id: child.teamId,
      label: child.name,
      board: framedBoardOf(child),
      ...nested.length === 0 ? {} : { groups: nested }
    });
  }
  return inputs;
}
function groupsOf(workspace, record, warn, list) {
  const index = childrenByParent(list(workspace));
  const groups = groupInputsOf(index, record.teamId, readArchivedPlanIndex(workspace), warn, new Set([record.teamId]));
  return groups.length === 0 ? {} : { groups };
}
function childrenByParent(records) {
  const index = new Map;
  for (const record of records) {
    const parent = record.parentTeamId;
    if (parent === undefined || parent === "")
      continue;
    const held = index.get(parent);
    if (held === undefined)
      index.set(parent, [record]);
    else
      held.push(record);
  }
  for (const children of index.values())
    children.sort((left, right) => left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0);
  return index;
}

class GraphModels {
  deps;
  cache = new Map;
  watchers = new Map;
  disposed = false;
  constructor(deps) {
    this.deps = deps;
  }
  get(workspace, record) {
    if (this.disposed)
      return;
    try {
      const planPath = resolvePlanFile(workspace);
      this.ensurePlanWatch(workspace, planPath);
      const revision = this.deps.revision(workspace);
      const key = workspace + "\x00" + record.teamId;
      const cached = this.cache.get(key);
      if (cached !== undefined && cached.revision === revision && cached.planPath === planPath)
        return cached.model;
      const model = buildModel({
        board: boardOf(record),
        plan: readPlanFile(planPath),
        ...groupsOf(workspace, record, this.deps.warn, this.deps.listTeams ?? listTeams)
      });
      this.cache.set(key, { revision, planPath, model });
      return model;
    } catch (error) {
      this.deps.warn?.(`[mpd-team-core] building the graph model for ${record.teamId} failed: ${messageOf(error)}`);
      return;
    }
  }
  ensurePlanWatch(workspace, planPath) {
    const held = this.watchers.get(workspace);
    if (held !== undefined && held.planPath === planPath)
      return;
    if (held !== undefined) {
      try {
        held.watcher.close();
      } catch {}
      this.watchers.delete(workspace);
    }
    try {
      const make = this.deps.watch ?? watchGraph;
      const watcher = make({
        ...planPath === undefined ? {} : { planFile: planPath },
        plansDir: plansDirectory(workspace)
      }, {
        onChange: () => {
          this.invalidate(workspace);
          this.deps.notify(workspace);
        },
        onError: (error) => {
          this.deps.warn?.(`[mpd-team-core] the graph plan watch for ${workspace} failed: ${messageOf(error)}`);
        }
      });
      this.watchers.set(workspace, { watcher, planPath });
    } catch (error) {
      this.deps.warn?.(`[mpd-team-core] no graph plan watch for ${workspace} (${messageOf(error)}) — the planes keep their polling fallback`);
    }
  }
  invalidate(workspace) {
    const prefix = workspace + "\x00";
    for (const key of [...this.cache.keys()])
      if (key.startsWith(prefix))
        this.cache.delete(key);
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    for (const armed of this.watchers.values()) {
      try {
        armed.watcher.close();
      } catch {}
    }
    this.watchers.clear();
    this.cache.clear();
  }
}

// packages/mpd-team-core-plugin/src/change-feed.ts
import { mkdirSync as mkdirSync9, watch as watch2 } from "node:fs";
var watchDirectory = (dir, onEvent) => watch2(dir, { persistent: false }, onEvent);
function detachTimer(timer) {
  const unref = timer.unref;
  if (typeof unref === "function")
    unref.call(timer);
}

class ChangeFeed {
  debounceMs;
  watchFor;
  warn;
  workspaces = new Map;
  unhook;
  disposed = false;
  constructor(options = {}) {
    this.debounceMs = options.debounceMs ?? 50;
    this.watchFor = options.watch ?? watchDirectory;
    this.warn = options.warn ?? (() => {});
    this.unhook = onTeamStateWritten((workspace) => {
      this.notify(workspace);
    });
  }
  notify(workspace) {
    if (this.disposed)
      return;
    const state = this.stateFor(workspace);
    this.arm(workspace, state);
    if (state.timer !== undefined)
      return;
    state.revision += 1;
    state.timer = setTimeout(() => {
      this.flush(workspace);
    }, this.debounceMs);
    detachTimer(state.timer);
  }
  subscribe(workspace, listener) {
    if (this.disposed)
      return () => {};
    const state = this.stateFor(workspace);
    state.listeners.add(listener);
    this.arm(workspace, state);
    let released = false;
    return () => {
      if (released)
        return;
      released = true;
      this.release(workspace, listener);
    };
  }
  revision(workspace) {
    return this.workspaces.get(workspace)?.revision ?? 0;
  }
  stats(workspace) {
    const state = this.workspaces.get(workspace);
    if (state === undefined)
      return { revision: 0, listeners: 0, watchers: 0, pending: false };
    return { revision: state.revision, listeners: state.listeners.size, watchers: state.watchers.size, pending: state.timer !== undefined };
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.unhook();
    for (const state of this.workspaces.values()) {
      if (state.timer !== undefined)
        clearTimeout(state.timer);
      for (const handle of state.watchers.values()) {
        try {
          handle.close();
        } catch {}
      }
      state.watchers.clear();
      state.armed.clear();
      state.listeners.clear();
      state.timer = undefined;
    }
    this.workspaces.clear();
  }
  flush(workspace) {
    const state = this.workspaces.get(workspace);
    if (state === undefined)
      return;
    state.timer = undefined;
    for (const listener of [...state.listeners]) {
      try {
        listener();
      } catch (error) {
        if (state.listenerReported)
          continue;
        state.listenerReported = true;
        this.warn(`[mpd-team-core] team change feed: a listener threw and was contained (${String(error?.message ?? error)})`);
      }
    }
  }
  release(workspace, listener) {
    const state = this.workspaces.get(workspace);
    if (state === undefined)
      return;
    state.listeners.delete(listener);
    if (state.listeners.size > 0)
      return;
    if (state.timer !== undefined)
      clearTimeout(state.timer);
    state.timer = undefined;
    for (const handle of state.watchers.values()) {
      try {
        handle.close();
      } catch {}
    }
    state.watchers.clear();
    state.armed.clear();
  }
  arm(workspace, state) {
    if (this.disposed || state.arming)
      return;
    state.arming = true;
    try {
      const dirs = [teamRoot(workspace), teamsDir(workspace)];
      for (const dir of dirs) {
        if (state.armed.has(dir))
          continue;
        try {
          mkdirSync9(dir, { recursive: true });
        } catch {}
      }
      for (const dir of dirs) {
        if (state.armed.has(dir))
          continue;
        try {
          state.watchers.set(dir, this.watchFor(dir, () => {
            this.notify(workspace);
          }));
          state.armed.add(dir);
          if (state.reported) {
            state.reported = false;
            this.warn(`[mpd-team-core] team change feed: watch armed for ${dir}`);
          }
        } catch (error) {
          if (state.reported)
            continue;
          state.reported = true;
          this.warn(`[mpd-team-core] team change feed: no filesystem watch for ${dir} (${String(error?.message ?? error)}) — in-process notifications only, a write from ANOTHER process will not be seen`);
        }
      }
    } finally {
      state.arming = false;
    }
  }
  stateFor(workspace) {
    const existing = this.workspaces.get(workspace);
    if (existing !== undefined)
      return existing;
    const created = {
      revision: 0,
      listeners: new Set,
      armed: new Set,
      watchers: new Map,
      reported: false,
      listenerReported: false,
      arming: false
    };
    this.workspaces.set(workspace, created);
    return created;
  }
}

// packages/mpd-team-core-plugin/src/index.ts
var name = "mpd-team-core";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS);
var TEAMS_SERVICE = "mpdTeams";
var text2 = (value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
function describePlan(plan) {
  if (plan === undefined)
    return "no staged plan";
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged";
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`;
}
function fieldText(value) {
  if (typeof value === "string")
    return value === "" ? "-" : value;
  return typeof value === "number" ? String(value) : "-";
}
function describeTaskLine(task) {
  const row = task ?? {};
  const blockedBy = Array.isArray(row.blockedBy) ? row.blockedBy.map(String).filter((entry) => entry !== "") : [];
  const subject = typeof row.subject === "string" ? JSON.stringify(row.subject) : JSON.stringify("");
  return `task id=${fieldText(row.id)} owner=${fieldText(row.owner)} status=${fieldText(row.status)} kind=${fieldText(row.kind)} blockedBy=${blockedBy.length === 0 ? "-" : blockedBy.join(",")} subject=${subject}`;
}
function describeStatus(value) {
  const board = value ?? {};
  const members = Array.isArray(board.members) ? board.members : [];
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const plan = board.plan ?? {};
  const planId = typeof plan.planId === "string" && plan.planId !== "" ? plan.planId : "(none)";
  const summary = `plan ${planId} · members ${members.length} · tasks ${tasks.length} · hold ${board.hold === null || board.hold === undefined ? "none" : "held"}`;
  const lines = [summary];
  for (const member of members) {
    const row = member ?? {};
    lines.push(`member id=${fieldText(row.id)} name=${fieldText(row.name)} status=${fieldText(row.status)}`);
  }
  for (const task of tasks)
    lines.push(describeTaskLine(task));
  return lines.join(`
`);
}
function describeDepend(value) {
  const answer = value ?? {};
  const task = answer.task ?? {};
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy.map(String).filter((entry) => entry !== "") : [];
  const unresolved = Array.isArray(answer.unresolved) ? answer.unresolved.map(String) : [];
  const added = Array.isArray(answer.added) ? answer.added.length : 0;
  const edges = blockedBy.length === 0 ? "-" : blockedBy.join(",");
  const outcome = answer.idempotent === true ? "unchanged; the reference was already an edge" : `appended ${added} edge(s)`;
  return `${fieldText(answer.taskId)} blockedBy=[${edges}] (${outcome})` + (unresolved.length === 0 ? "" : ` — WARNING: ${unresolved.join(", ")} name(s) no task on this board; kept verbatim`);
}
function describeStagedPlan(plan) {
  if (plan === undefined)
    return "no staged plan";
  const lines = plan.tasks.map((task) => {
    const blockedBy = (task.blockedBy ?? []).filter((entry) => entry !== "");
    return `staged task id=- owner=${task.owner ?? "-"} blockedBy=${blockedBy.length === 0 ? "-" : blockedBy.join(",")} subject=${JSON.stringify(task.subject)}`;
  });
  return [describePlan(plan), ...lines].join(`
`);
}
function stringList(value) {
  return Array.isArray(value) ? value.map(String) : undefined;
}
function parseTaskKind(value) {
  if (value === undefined || value === null || value === "")
    return;
  const text3 = String(value);
  if (!TASK_KINDS.includes(text3))
    throw new Error(`unknown task kind "${text3}" (${TASK_KINDS.join(" | ")})`);
  return text3;
}
function blockerReading(plan, references) {
  return references.map((reference) => ({ reference, form: classifyBlocker(plan, reference) }));
}
function blockerSentence(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0)
    return "";
  const unknown = blockers.filter((entry) => entry?.form === "unknown").map((entry) => String(entry?.reference ?? ""));
  const forms = [...new Set(blockers.map((entry) => String(entry?.form ?? "?")))].join("/");
  if (unknown.length === 0)
    return ` — blocked_by reads as ${forms}`;
  return ` — WARNING: blocked_by ${unknown.map((reference) => `"${reference}"`).join(", ")} name(s) no task this plan can resolve (only a position like "2", a staged subject, or a board id like "T2" resolves); approval will report it and draw no edge`;
}
function describeWireValue(value) {
  if (value === null)
    return "null";
  if (Array.isArray(value))
    return `an array of ${value.length}`;
  if (typeof value === "object")
    return "an object";
  if (typeof value === "string")
    return value.length > 60 ? `a string ${JSON.stringify(value.slice(0, 60) + "…")}` : `a string ${JSON.stringify(value)}`;
  return `a ${typeof value} (${String(value)})`;
}
function namedTask(nextId, subject) {
  return `${nextId} (${JSON.stringify(subject)})`;
}
function readDependencyAnswer(raw, args, nextId, subject) {
  const task = namedTask(nextId, subject);
  const declarations = [];
  if (raw.blocked_by !== undefined)
    declarations.push({ spelling: "task.blocked_by", value: raw.blocked_by });
  if (raw.blockedBy !== undefined)
    declarations.push({ spelling: "task.blockedBy", value: raw.blockedBy });
  if (args?.blocked_by !== undefined)
    declarations.push({ spelling: "blocked_by", value: args.blocked_by });
  for (const declaration of declarations) {
    if (Array.isArray(declaration.value))
      continue;
    throw new Error(`create_task for ${task} was given a NON-ARRAY blocked_by at ${declaration.spelling} (${describeWireValue(declaration.value)}): a non-array is never silently dropped. Fix: send an array of references — blocked_by: [] for a genuine root, or blocked_by: ["<blocker id or subject>"] — or independent: true, which is the only other accepted spelling.`);
  }
  const lists = declarations.map((declaration) => ({ spelling: declaration.spelling, list: declaration.value.map(String) }));
  if (lists.length > 1) {
    const [first, ...rest] = lists;
    const disagreement = rest.find((candidate) => candidate.list.length !== first.list.length || candidate.list.some((entry, at) => entry !== first.list[at]));
    if (disagreement !== undefined) {
      throw new Error(`create_task for ${task} was given TWO disagreeing spellings of blocked_by: ${first.spelling} reads ${JSON.stringify(first.list)} while ${disagreement.spelling} reads ${JSON.stringify(disagreement.list)}. All three spellings (task.blocked_by, task.blockedBy and top-level blocked_by) are accepted, but they must state ONE answer: send the list in a single spelling (or make both agree), or independent: true for a genuine root.`);
    }
  }
  const independent = raw.independent === true || args?.independent === true;
  const blockedBy = lists.length === 0 ? undefined : lists[0].list;
  if (blockedBy === undefined && !independent) {
    throw new Error(`create_task for ${task} must state its DEPENDENCY ANSWER: send blocked_by: [...] — an array, possibly [] for a genuine root — or independent: true. Nothing was staged and no edge was guessed for you, because a captain that does not know its DAG is asked, never guessed for. Fix: send blocked_by: [] for a genuine root, or list what must close first — blocked_by: ["<blocker id or subject>"] — or independent: true.`);
  }
  if (independent && blockedBy !== undefined && blockedBy.length > 0) {
    throw new Error(`create_task for ${task} is CONTRADICTORY: blocked_by is non-empty (${JSON.stringify(blockedBy)}) while independent: true says the task has no blockers. Fix: either keep the blockers and drop independent: true, or drop the list and send blocked_by: [] if this task really is a root.`);
  }
  return blockedBy ?? [];
}
function assertNoDependencyCycle(edges, subjects, nextId, task, selfReferences) {
  const label = (id) => subjects.has(id) ? namedTask(id, subjects.get(id)) : id;
  if (selfReferences.length > 0) {
    throw new Error(`create_task for ${task} declares a SELF-REFERENCE: blocked_by names ${selfReferences.map((reference) => JSON.stringify(reference)).join(", ")}, which is this very task (${nextId}). A task that blocks itself can never become ready, so it could never be claimed or dispatched. Fix: remove its own subject and its own id (${nextId}) from blocked_by and name the task that must close first — or send blocked_by: [] / independent: true for a genuine root.`);
  }
  const cycle = dependencyCycle(edges);
  if (cycle === undefined)
    return;
  throw new Error(`create_task for ${task} would create a dependency CYCLE ${cycle.map(label).join(" -> ")} — every task on it would wait for itself, so no task on it could ever be claimed or dispatched, and no verb can remove an edge afterwards. Fix: leave this task out of the loop — send it with blocked_by: [] (or independent: true) and give the ordering to the other task, then re-send this call.`);
}
function assertScopesOrdered(plan) {
  const [clash] = scopeClashes(plan);
  if (clash === undefined)
    return;
  throw new Error(`plan ${plan.planId} was REFUSED: ${namedTask(clash.first.id, clash.first.subject)} and ${namedTask(clash.second.id, clash.second.subject)} declare OVERLAPPING write scopes (${JSON.stringify(clash.first.scope)} and ${JSON.stringify(clash.second.scope)}) and NEITHER depends on the other, so both could write the same files at the same time. Fix it either way: add a dependency edge so one runs after the other (create ${clash.second.id} with blocked_by: ["${clash.first.id}"], or agent_teams_task {action:"depend", task_id:"${clash.second.id}", blocked_by:["${clash.first.id}"]}), or make the two scopes disjoint so each task owns its own paths.`);
}
function assertPlanGraph(plan) {
  const defect = planGraphDefect(plan);
  if (defect === undefined)
    return;
  if (defect.kind === "unanswered") {
    throw new Error(`plan ${plan.planId} was REFUSED: staged task ${namedTask(defect.id, defect.subject)} states NO dependency answer, so the plan's graph is incomplete — every staged task MUST answer, a task a bulk edit replaced included. The accepted answers are blocked_by: [...] (an array, possibly [] for a genuine root) or independent: true; nothing was approved, because a captain that does not know its DAG is asked, never guessed for. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} giving ${defect.id} blocked_by: [] (or the tasks that must close first), then approve again.`);
  }
  const subjects = new Map(plan.tasks.map((task, index) => [planTaskId(index), task.subject]));
  const label = (id) => subjects.has(id) ? namedTask(id, subjects.get(id)) : id;
  if (defect.kind === "self-edge") {
    throw new Error(`plan ${plan.planId} was REFUSED: its staged graph carries a dependency SELF-EDGE ${label(defect.id)} -> ${label(defect.id)} — the task is its own blocker, so it could never become ready, and no verb can remove the edge afterwards. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} without that task's own id or subject in its blocked_by — blocked_by: [] for a genuine root, or name the task that must close first — then approve again.`);
  }
  throw new Error(`plan ${plan.planId} was REFUSED: its staged graph carries a dependency CYCLE ${defect.path.map(label).join(" -> ")} — every task on it waits for itself, so none could ever be claimed or dispatched, and no verb can remove an edge afterwards. Fix: re-send the plan with agent_teams_plan {action:"edit", tasks:[...]} and drop one edge of the loop — give one task on that path blocked_by: [] (or a blocker outside the loop) — then approve again.`);
}
function assertParentChainAcyclic(workspace, parent) {
  const at = new Map;
  const path = [];
  let cursor = parent;
  while (cursor !== undefined) {
    const seenAt = at.get(cursor.teamId);
    if (seenAt !== undefined) {
      throw new Error(`agent_teams_plan approve REFUSED: the parent chain of ${parent.teamId} comes back to ${cursor.teamId} — it carries a CYCLE ${[...path.slice(seenAt), cursor.teamId].join(" -> ")}, and a graph projection would never terminate on it. Nothing was created. This chain cannot be written by any tool (the link is stamped ONCE, at approval), so the record was edited by hand: fix the \`parentTeamId\` field of ${cursor.teamId} under .mpd/team/teams/ and approve again.`);
    }
    at.set(cursor.teamId, path.length);
    path.push(cursor.teamId);
    cursor = cursor.parentTeamId === undefined || cursor.parentTeamId === "" ? undefined : readTeam(workspace, cursor.parentTeamId);
  }
}
function deriveParentTeam(workspace, sessionId, lineage) {
  const caller = [sessionId, ...lineage].filter((value) => value !== "");
  const archive = readArchivedPlanIndex(workspace);
  const candidates = listTeams(workspace).filter((record) => recordNamesMember(record, caller) && !recordNamesLead(record, caller) && isLiveTeam(record, archive));
  const [parent, ...rest] = candidates;
  if (parent === undefined)
    return;
  if (rest.length > 0) {
    throw new Error(`agent_teams_plan approve REFUSED: this session is on the roster of ${candidates.length} live teams (${candidates.map((record) => record.teamId).join(", ")}), so a sub-team nested under one of them would be a guess — and a box in the wrong team is a picture the records do not state. Nothing was created. Fix: approve from a session that belongs to ONE team (each team's own roster is on agent_teams_plan {action:"status"}), or wait for all but the parent team to end.`);
  }
  assertParentChainAcyclic(workspace, parent);
  return parent;
}
function assertClaimReady(board, task) {
  const { blocking } = blockingDependencies(board, task.blockedBy);
  if (blocking.length === 0)
    return;
  const label = (id) => {
    const row = board.find((candidate) => candidate.id === id);
    return row === undefined ? id : namedTask(id, row.subject);
  };
  const dangling = blocking.filter((id) => !board.some((candidate) => candidate.id === id));
  const first = blocking[0];
  throw new Error(`task ${namedTask(task.id, task.subject)} is BLOCKED by ${blocking.map(label).join(", ")}: ${blocking.length === 1 ? "the declared blocker is" : "the declared blockers are"} not satisfied, and agent_teams_dispatch refuses the same pairing through the same readiness predicate (its reason reads "not ready (blocked by ${blocking.join(", ")})"). Fix: close ${first} first with agent_teams_task {action:"complete", task_id:"${first}"} — or use {action:"fail", task_id:"${first}"} if it will never be done, because a failed blocker releases its dependents (OPT-1) — then claim ${task.id} again.` + (dangling.length === 0 ? "" : ` NOTE: ${dangling.join(", ")} name(s) no task on this board (a dangling reference that can never be satisfied), so ${namedTask(task.id, task.subject)} can never be claimed. Fix: fail this row with agent_teams_task {action:"fail", task_id:"${task.id}"}, then have the team's Lead append a REPLACEMENT task with agent_teams_plan {action:"create_task", task:{subject, description, blocked_by:[...]}} that carries the corrected blocked_by. A failed row is never reopened, and re-creating the dangling reference will not make it satisfiable.`));
}
function adapterFor(ctx) {
  return createLazyDshAdapter(ctx, { label: "mpd-team-core" });
}
function sessionIdOf(exec) {
  const agent = exec?.agent;
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id;
  return typeof id === "string" && id !== "" ? id : "workspace";
}
function sessionLineageOf(exec) {
  const agent = exec?.agent;
  const session = agent?.session;
  const candidates = [session?.header?.parentSession, session?.parentSession];
  const ids = candidates.filter((value) => typeof value === "string" && value !== "");
  return [...new Set(ids)];
}
function sessionIsDelegatedChild(exec) {
  const header = exec?.agent?.session?.header;
  if (header?.origin === "subagent")
    return true;
  const depth = Number(header?.delegationDepth);
  return Number.isFinite(depth) && depth >= 1;
}
function sessionTitleOf(exec) {
  return String(exec?.agent?.session?.header?.title ?? "");
}
function callerIdentity(record, sessionId, title, lineage) {
  const ownMember = memberNamedBy(record, [sessionId]) ?? (Array.isArray(record.members) ? record.members : []).find((member) => member.name !== "" && title.includes(member.name));
  return ownMember === undefined ? { ancestry: lineage } : { ownMember, ancestry: [] };
}
var TODO_TOOL_NAME = "todo_write";
var SEED_TIMEOUT_MS = 1e4;
function seedSignal(upstream) {
  try {
    const platform = AbortSignal;
    if (typeof platform?.timeout !== "function")
      return upstream;
    const bounded = platform.timeout(SEED_TIMEOUT_MS);
    if (upstream === undefined)
      return bounded;
    return typeof platform.any === "function" ? platform.any([upstream, bounded]) : upstream;
  } catch {
    return upstream;
  }
}
function hasTodoTool(dsh, agent) {
  if (typeof dsh.hasTool !== "function")
    return false;
  try {
    return dsh.hasTool(TODO_TOOL_NAME, agent) === true;
  } catch {
    return false;
  }
}
async function bundleApprovalEffects(ctx, dsh, exec, plan) {
  const objective = plan.description !== "" ? plan.description : plan.name;
  try {
    const bridge = ctx.get?.("mpdGoal");
    if (bridge !== undefined && typeof bridge.anchor === "function") {
      const outcome = await bridge.anchor(exec, { objective, source: "team" });
      if (outcome?.ok === false)
        dsh.rowLog("mpd-team-core", "goal anchor refused after approval: " + String(outcome.error ?? "unknown"));
    }
  } catch (error) {
    dsh.rowLog("mpd-team-core", "goal anchor failed after approval: " + String(error?.message ?? error));
  }
  if (plan.tasks.length === 0)
    return;
  if (!hasTodoTool(dsh, exec.agent))
    return;
  try {
    const result = await dsh.executeTool({
      name: TODO_TOOL_NAME,
      arguments: { todos: plan.tasks.map((task) => ({ content: task.subject, status: "pending" })) },
      agent: exec.agent,
      signal: seedSignal(exec.signal)
    });
    if (result.isError === true)
      dsh.rowLog("mpd-team-core", "todo seed failed after approval: " + String(result.error ?? "the tool returned an error result"));
  } catch (error) {
    dsh.rowLog("mpd-team-core", "todo seed failed after approval: " + String(error?.message ?? error));
  }
}
var DEFAULT_DEPTH_MAX = 3;
function depthMaxOf(service) {
  try {
    const config = service("mpdConfig");
    const raw = typeof config?.get === "function" ? config.get("cellwork.depthMax") : undefined;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 8)
      return raw;
  } catch {}
  return DEFAULT_DEPTH_MAX;
}
function teamDepthOf(workspace, teamId) {
  const seen = new Set;
  let current = teamId;
  let depth = 0;
  while (current !== undefined) {
    if (seen.has(current))
      return { depth, reason: `the parent chain of ${JSON.stringify(teamId)} is cyclic (it revisits ${JSON.stringify(current)})` };
    seen.add(current);
    const record = readTeam(workspace, current);
    if (record === undefined) {
      return { depth, reason: depth === 0 ? `no team record is named ${JSON.stringify(teamId)}` : `the parent chain of ${JSON.stringify(teamId)} names ${JSON.stringify(current)}, which is not on disk` };
    }
    if (record.parentTeamId === undefined || record.parentTeamId === "")
      return { depth };
    current = record.parentTeamId;
    depth += 1;
  }
  return { depth };
}
function memberContextOf(workspace, teamId, memberName, pressureOf) {
  const record = readTeam(workspace, teamId);
  if (record === undefined) {
    return { member: memberName, usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable", reason: `no team record is named ${JSON.stringify(teamId)}` };
  }
  const member = record.members.find((row) => row.name === memberName || row.id === memberName);
  if (member === undefined) {
    return { teamId, member: memberName, usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable", reason: `no member ${JSON.stringify(memberName)} is on the roster of team ${teamId}` };
  }
  const pressure = member.executorRef === undefined ? { usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" } : pressureOf(member.executorRef);
  return {
    teamId,
    member: member.name,
    ...member.mode === undefined ? {} : { mode: member.mode },
    ...member.fenced === true ? { fenced: true } : {},
    ...member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason },
    usedTokens: pressure.usedTokens,
    windowTokens: pressure.windowTokens,
    ratio: pressure.ratio,
    provenance: pressure.provenance,
    ...member.contextCheckpoint === undefined ? {} : { contextCheckpoint: member.contextCheckpoint },
    ...member.executorRef === undefined ? { reason: "the seat has no executor handle yet (never raised), so no session occupancy was observed" } : {}
  };
}
function depthBudgetOf(workspace, teamId, depthMax) {
  const chain = teamDepthOf(workspace, teamId);
  return {
    teamId,
    depth: chain.depth,
    depthMax,
    remaining: Math.max(0, depthMax - chain.depth),
    ...chain.reason === undefined ? {} : { reason: chain.reason }
  };
}
function apply(ctx) {
  const dsh = adapterFor(ctx);
  const disposers = [];
  let toolRegistrations = 0;
  const now = () => new Date;
  const feed = new ChangeFeed({ warn: (line) => {
    rowLogLine("mpd-team-core", line);
  } });
  disposers.push(() => {
    feed.dispose();
  });
  const graphModels = new GraphModels({
    revision: (workspace) => feed.revision(workspace),
    notify: (workspace) => {
      feed.notify(workspace);
    },
    warn: (line) => {
      rowLogLine("mpd-team-core", line);
    }
  });
  disposers.push(() => {
    graphModels.dispose();
  });
  const executor = () => dsh.teamExecutor();
  const where = (exec) => ({
    workspace: dsh.workspaceRoot(exec),
    sessionId: sessionIdOf(exec),
    lineage: sessionIsDelegatedChild(exec) ? [] : sessionLineageOf(exec)
  });
  const stagedPlan = (workspace, sessionId) => {
    const plan = readPlan(workspace, sessionId);
    if (plan !== undefined && plan.approvedAt !== undefined)
      throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`);
    return plan;
  };
  const healLeadBinding = (workspace, sessionId, lineage, record, delegated) => {
    const ownLead = record.leadSessionId === sessionId || (record.leadHistory ?? []).includes(sessionId);
    if (ownLead || delegated)
      return record;
    if (recordNamesMember(record, [sessionId]))
      return record;
    const fromLead = lineage.some((id) => id === record.leadSessionId || (record.leadHistory ?? []).includes(id));
    if (!fromLead)
      return record;
    const healed = rememberLead(record, [sessionId]);
    writeTeam(workspace, healed);
    bindActiveTeam(workspace, sessionId, record.teamId);
    rowLogLine("mpd-team-core", `[mpd-team-core] rebound team ${record.teamId} to resumed/forked lead session ${sessionId}`);
    return healed;
  };
  const readWatchdogHold = (workspace, sessionId, lineage = []) => {
    try {
      const record = recordFor(workspace, sessionId, lineage);
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
  const resolveTeam = (workspace, sessionId, lineage = []) => {
    try {
      const archive = readArchivedPlanIndex(workspace);
      const keys = [sessionId, ...lineage];
      const bound = keys.map((key) => activeTeamId(workspace, key)).find((id) => id !== undefined);
      const boundRecord = bound === undefined ? undefined : readTeam(workspace, bound);
      return resolveTeamRecord({
        ...boundRecord === undefined ? {} : { bound: boundRecord },
        teams: listTeams(workspace),
        sessionId,
        ...lineage.length === 0 ? {} : { alsoSessions: lineage },
        index: archive
      });
    } catch {
      return {};
    }
  };
  const resolveForWrite = (workspace, sessionId, lineage, delegated) => {
    const resolved = resolveTeam(workspace, sessionId, lineage);
    if (resolved.record === undefined)
      return resolved;
    const healed = healLeadBinding(workspace, sessionId, lineage, resolved.record, delegated);
    return healed === resolved.record ? resolved : { ...resolved, record: healed };
  };
  const recordFor = (workspace, sessionId, lineage = []) => resolveTeam(workspace, sessionId, lineage).record;
  const workspaceForRequest = (sessionId) => {
    if (sessionId === "")
      return dsh.workspaceRoot();
    try {
      const own = dsh.workspaceRootForSession(sessionId);
      if (own !== undefined && own !== "")
        return own;
    } catch {}
    const roots = dsh.workspaceRootsAll();
    for (const root2 of roots) {
      try {
        if (recordFor(root2, sessionId) !== undefined)
          return root2;
        if (readPlan(root2, sessionId) !== undefined)
          return root2;
      } catch {}
    }
    throw new Error(`mpd-team-core: no workspace is bound to session "${sessionId}" — refusing to answer from another workspace`);
  };
  const releaseDispatchedTask = (workspace, record, taskId, expectedRevision, caller, lead) => {
    const fresh = readTeam(workspace, record.teamId) ?? record;
    const refusal = authorizeRelease(fresh, taskId, caller, lead);
    if (refusal !== undefined)
      return { released: false, taskId, refused: refusal };
    const freed = release(readLedger(workspace), record.teamId, taskId);
    if (freed.released)
      writeLedger(workspace, freed.ledger);
    const outcome = casReleaseTask(fresh, taskId, expectedRevision, now());
    if (!outcome.applied)
      return { released: freed.released, taskId, refused: outcome.reason };
    writeTeam(workspace, withDerivedPhase(outcome.record));
    const view = outcome.record.tasks.find((candidate) => candidate.id === taskId);
    return { released: freed.released, taskId, status: view?.status, revision: view?.revision };
  };
  const graphOf = (workspace, teamId) => {
    try {
      const record = teamId === undefined ? recordFor(workspace, "workspace") : readTeam(workspace, teamId);
      return record === undefined ? undefined : graphModels.get(workspace, record);
    } catch {
      return;
    }
  };
  const idleGuard = installIdleGuard({
    liveAgents: () => dsh.liveAgents(),
    registerAgentPreStep: (agent, listener) => dsh.registerAgentPreStep(agent, listener),
    onEvent: (event, handler) => dsh.onEvent(event, handler),
    guardTool: (guard) => dsh.guardTool(guard),
    workspaceRoot: (exec) => dsh.workspaceRoot(exec),
    rowLog: (line) => {
      rowLogLine("mpd-team-core", line);
    }
  });
  for (const dispose of idleGuard.disposers)
    disposers.push(dispose);
  const teamActionsDeps = {
    now,
    executor,
    bundleApprovalEffects: (plan, caller) => bundleApprovalEffects(ctx, dsh, {
      ...caller.agent === undefined ? {} : { agent: caller.agent },
      ...caller.signal === undefined ? {} : { signal: caller.signal }
    }, plan),
    deriveParentTeam,
    resolveTeam,
    readWatchdogHold,
    service: (id) => {
      try {
        return ctx.get?.(id, false);
      } catch {
        return;
      }
    },
    log: (line) => rowLogLine("mpd-team-core", line),
    beginDispatch: (memberId) => idleGuard.beginDispatch(memberId),
    assertPlanGraph,
    assertScopesOrdered
  };
  const liveAgentForSession = (sessionId) => {
    try {
      const direct = dsh.liveAgent(sessionId);
      if (direct !== undefined && direct !== null)
        return direct;
    } catch {}
    try {
      for (const candidate of dsh.liveAgents()) {
        const session = candidate?.session;
        if (session !== null && typeof session === "object" && session.id === sessionId)
          return candidate;
      }
    } catch {}
    return;
  };
  const callerForSession = (sessionId, signal) => {
    const agent = liveAgentForSession(sessionId);
    if (agent === undefined)
      return { ok: false, error: `session ${sessionId} is not live` };
    const lineage = sessionIsDelegatedChild({ agent }) ? [] : sessionLineageOf({ agent });
    try {
      return { ok: true, caller: { workspace: workspaceForRequest(sessionId), sessionId, lineage, agent, ...signal === undefined ? {} : { signal } } };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  const teamActions = {
    approve: async ({ sessionId }) => {
      const resolved = callerForSession(sessionId);
      if (!resolved.ok)
        return resolved;
      return approveTeam(teamActionsDeps, resolved.caller);
    },
    dispatch: async ({ sessionId, limit, dryRun, mode, reassign }) => {
      const resolved = callerForSession(sessionId);
      if (!resolved.ok)
        return resolved;
      return runDispatch(teamActionsDeps, resolved.caller, {
        ...limit === undefined ? {} : { limit },
        ...dryRun === undefined ? {} : { dryRun },
        ...mode === undefined ? {} : { mode },
        ...reassign === undefined ? {} : { reassign }
      });
    },
    fence: async ({ sessionId, member, reason }) => {
      const resolved = callerForSession(sessionId);
      if (!resolved.ok)
        return resolved;
      return fenceMember(teamActionsDeps, resolved.caller, { member, ...reason === undefined ? {} : { reason } });
    },
    unfence: async ({ sessionId, member }) => {
      const resolved = callerForSession(sessionId);
      if (!resolved.ok)
        return resolved;
      return unfenceMember(teamActionsDeps, resolved.caller, { member });
    },
    handoff: async ({ sessionId, content }) => {
      const resolved = callerForSession(sessionId);
      if (!resolved.ok)
        return resolved;
      return writeMemberHandoff(teamActionsDeps, resolved.caller, { content });
    },
    cancelTasks: async (input) => cancelTasks(teamActionsDeps, input)
  };
  if (typeof ctx?.provide === "function") {
    try {
      ctx.provide(TEAM_ACTIONS_SERVICE, teamActions);
    } catch (error) {
      rowLogLine("mpd-team-core", `[mpd-team-core] publishing the ${TEAM_ACTIONS_SERVICE} service failed: ${String(error?.message ?? error)}`);
    }
  }
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
        summary: (record) => ({ ...summariseTeam(record), stage: stageLabel(teamStage(record)) }),
        visual: (record, taskId) => {
          const task = record.tasks.find((candidate) => candidate.id === taskId);
          if (task === undefined)
            return "unknown";
          const own = taskVisual(task, record.tasks);
          if (own === "running") {
            const stage = teamStage(record);
            if (stage.kind === "person")
              return stage.reason;
          }
          return own;
        },
        progress: (record, name2) => memberProgress(record, name2),
        memberContext: (workspace, teamId, memberName) => {
          try {
            return memberContextOf(workspace, teamId, memberName, (target) => dsh.contextPressure(target));
          } catch (error) {
            return { member: memberName, usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable", reason: String(error?.message ?? error) };
          }
        },
        depthBudget: (workspace, teamId) => {
          try {
            return depthBudgetOf(workspace, teamId, depthMaxOf(teamActionsDeps.service));
          } catch (error) {
            return { teamId, depth: 0, depthMax: DEFAULT_DEPTH_MAX, remaining: DEFAULT_DEPTH_MAX, reason: String(error?.message ?? error) };
          }
        },
        archivedPlans: (workspace) => {
          try {
            const plans = listArchivedPlans(workspace);
            const records = listTeams(workspace);
            return plans.map((plan) => {
              const team = records.find((record) => record.planId === plan.planId);
              return team === undefined ? plan : { ...plan, teamId: team.teamId };
            });
          } catch {
            return [];
          }
        },
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
        graph: (workspace, teamId) => graphOf(workspace, teamId),
        planFor: (workspace, sessionId) => {
          try {
            return planForSession(workspace, sessionId);
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] reading the staged plan failed: ${String(error?.message ?? error)}`);
            return { ok: true, workspace, sessionId, plan: null };
          }
        },
        subscribe: (workspace, listener) => {
          try {
            return feed.subscribe(workspace, listener);
          } catch {
            return () => {};
          }
        },
        revision: (workspace) => {
          try {
            return feed.revision(workspace);
          } catch {
            return 0;
          }
        },
        registerControlSeat: (sessionId) => idleGuard.registerControlSeat(sessionId)
      });
    } catch (error) {
      rowLogLine("mpd-team-core", `[mpd-team-core] publishing the ${TEAMS_SERVICE} service failed: ${String(error?.message ?? error)}`);
    }
  }
  toolRegistrations += 1;
  disposers.push(dsh.registerTool({
    name: "agent_teams_plan",
    description: "The team PLAN. `create` stages (spawns nothing); `add_member`/`create_task` append to it or the live team; `edit` reads or replaces; `approve` EXECUTES through the TEAM EXECUTOR, REFUSING an EMPTY plan; `delete` archives; `status` shows plan, hold, roster and board.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
        name: { type: "string", description: "create: team name." },
        description: { type: "string", description: "create/edit: what the team is for." },
        approval: { type: "string", enum: ["required", "automatic"], description: "create: `required` (default) waits for approve." },
        replace: { type: "boolean", description: "create: replace an APPROVED plan." },
        member: { type: "object", description: "add_member: {name, prompt, description?, role?}." },
        task: { type: "object", description: "create_task: {subject, description, blocked_by, write_scopes?, owner?, kind?, coverageOf?, sourceTaskId?}; blocked_by or independent required." },
        owner: { type: "string", description: "create_task: alias of task.owner." },
        blocked_by: { type: "array", items: { type: "string" }, description: "create_task: [] = root." },
        kind: { type: "string", description: "create_task: alias of task.kind." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement members." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement tasks." },
        dry_run: { type: "boolean", description: "approve: preview only." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      presentationMeta: toolCard(agentTeamsPlanCard),
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
          appended: { type: "string" },
          task: { type: "object" },
          spawned: { type: "string" },
          stoppedAt: { type: "string" },
          archivedTo: { type: "string" },
          blockers: { type: "array", items: { type: "object" } },
          bindings: { type: "array", items: { type: "object" } }
        }
      },
      render: (_args, value) => text2(value?.archivedTo !== undefined ? `archived to ${value.archivedTo}` : value?.created !== undefined ? `approved ${value.plan?.planId ?? ""}: ${value.created.members?.length ?? 0} member(s), ${value.created.tasks?.length ?? 0} task(s)` + (value.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`) + (Array.isArray(value.bindings) && value.bindings.length > 0 ? `
` + value.bindings.map((binding) => "  " + String(binding.member ?? "?") + " — " + String(binding.mode ?? "?") + (binding.workmate === undefined ? "" : ": " + binding.workmate) + (binding.reason === undefined ? "" : " (" + binding.reason + ")")).join(`
`) : "") + (Array.isArray(value.created.unresolved) && value.created.unresolved.length > 0 ? ` — WARNING: ${value.created.unresolved.length} task(s) carry blockers that name no task (${value.created.unresolved.map((entry) => `${entry.taskId ?? "?"}:[${(entry.references ?? []).join(",")}]`).join(" ")}); they draw no edge` : "") : value?.members !== undefined ? describeStatus(value) : typeof value?.appended === "string" ? value.appended : Array.isArray(value?.blockers) && value.blockers.length > 0 ? `task "${value.plan?.tasks?.at?.(-1)?.subject ?? ""}" staged${blockerSentence(value.blockers)}` : describeStagedPlan(value?.plan))
    },
    execute: async (args, exec) => {
      const action = String(args?.action ?? "");
      const { workspace, sessionId, lineage } = where(exec);
      const delegated = sessionIsDelegatedChild(exec);
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
          members: record === undefined ? read(() => dsh.teamListMembers(exec.agent), []) : record.members.filter((member) => member.status !== "failed"),
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
        const raw = args?.member ?? {};
        const input = {
          name: String(raw.name ?? ""),
          description: String(raw.description ?? ""),
          prompt: String(raw.prompt ?? ""),
          ...raw.role === undefined ? {} : { role: String(raw.role) }
        };
        const plan = stagedPlan(workspace, sessionId);
        if (plan !== undefined) {
          const next = addMember(plan, input);
          writePlan(workspace, next);
          return { plan: next };
        }
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team is staged in this session — call agent_teams_create first");
        if (!recordNamesLead(resolved.record, [sessionId, ...callerIdentity(resolved.record, sessionId, sessionTitleOf(exec), lineage).ancestry])) {
          throw new Error(`only the Lead of team ${resolved.record.teamId} may append to its live roster or board`);
        }
        const name2 = input.name.trim();
        if (name2 === "")
          throw new Error("a teammate needs a non-empty name");
        if (resolved.record.members.some((member) => member.name === name2))
          throw new Error(`teammate "${name2}" is already on the roster of team ${resolved.record.teamId}`);
        const roster = addTeamMember(resolved.record, input, now());
        const added = roster.members[roster.members.length - 1];
        writeTeam(workspace, withDerivedPhase(roster));
        try {
          const spawned = await executor().spawn(exec.agent, {
            teamId: roster.teamId,
            memberId: added.id,
            name: added.name,
            description: added.description === "" ? added.name : added.description,
            prompt: withIdlePreamble(input.prompt === "" ? added.description : input.prompt),
            ...added.role === undefined ? {} : { role: added.role },
            ...exec.signal === undefined ? {} : { signal: exec.signal }
          });
          const running = updateTeamMember(readTeam(workspace, roster.teamId) ?? roster, added.id, { executorRef: spawned.handle, status: "running" });
          writeTeam(workspace, withDerivedPhase(running));
          return { team: running, member: { ...added, executorRef: spawned.handle, status: "running" }, spawned: spawned.handle, appended: `member ${added.name} (${added.id}) appended to the live team ${running.teamId}` };
        } catch (error) {
          const released = removeTeamMember(readTeam(workspace, roster.teamId) ?? roster, added.id);
          writeTeam(workspace, withDerivedPhase(released));
          return { team: released, member: { ...added, status: "failed" }, stoppedAt: `member ${added.name}: ${String(error?.message ?? error)}`, appended: `member ${added.name} (${added.id}) was NOT added to team ${released.teamId}: the raise FAILED, and its roster row was REMOVED so no failed slot is held` };
        }
      }
      if (action === "create_task") {
        const raw = args?.task ?? {};
        const writeScopes = stringList(raw.write_scopes ?? raw.writeScopes ?? args?.write_scopes);
        const owner = raw.owner ?? args?.owner;
        const kind = parseTaskKind(raw.kind ?? args?.kind);
        const coverageOf = raw.coverageOf;
        const sourceTaskId = raw.sourceTaskId;
        const plan = stagedPlan(workspace, sessionId);
        if (plan !== undefined) {
          const blockedBy2 = readDependencyAnswer(raw, args, planTaskId(plan.tasks.length), String(raw.subject ?? "").trim());
          const next2 = addTask(plan, {
            subject: String(raw.subject ?? ""),
            description: String(raw.description ?? ""),
            ...kind === undefined ? {} : { kind },
            blockedBy: blockedBy2,
            ...writeScopes === undefined ? {} : { writeScopes },
            ...owner === undefined ? {} : { owner: String(owner) },
            ...coverageOf === undefined ? {} : { coverageOf: String(coverageOf) },
            ...sourceTaskId === undefined ? {} : { sourceTaskId: String(sourceTaskId) }
          });
          const stagedTask = next2.tasks[next2.tasks.length - 1];
          const stagedId = planTaskId(next2.tasks.length - 1);
          assertNoDependencyCycle(planDependencyEdges(next2), new Map(next2.tasks.map((task, index) => [planTaskId(index), task.subject])), stagedId, namedTask(stagedId, stagedTask.subject), blockedBy2.filter((reference) => planReferenceTarget(next2, reference) === stagedId));
          writePlan(workspace, next2);
          return { plan: next2, ...blockedBy2.length === 0 ? {} : { blockers: blockerReading(next2, blockedBy2) } };
        }
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team is staged in this session — call agent_teams_create first");
        if (!recordNamesLead(resolved.record, [sessionId, ...callerIdentity(resolved.record, sessionId, sessionTitleOf(exec), lineage).ancestry])) {
          throw new Error(`only the Lead of team ${resolved.record.teamId} may append to its live roster or board`);
        }
        if (String(raw.subject ?? "").trim() === "")
          throw new Error("a task needs a non-empty subject");
        const blockedBy = readDependencyAnswer(raw, args, "T" + resolved.record.nextTaskNumber, String(raw.subject ?? "").trim());
        const next = addTeamTask(resolved.record, {
          subject: String(raw.subject ?? ""),
          description: String(raw.description ?? ""),
          ...kind === undefined ? {} : { kind },
          blockedBy,
          ...writeScopes === undefined ? {} : { writeScopes },
          ...owner === undefined ? {} : { owner: String(owner) },
          ...coverageOf === undefined ? {} : { coverageOf: String(coverageOf) },
          ...sourceTaskId === undefined ? {} : { sourceTaskId: String(sourceTaskId) }
        }, now());
        const appendedTask = next.tasks[next.tasks.length - 1];
        assertNoDependencyCycle(boardDependencyEdges(next.tasks), new Map(next.tasks.map((task) => [task.id, task.subject])), appendedTask.id, namedTask(appendedTask.id, appendedTask.subject), appendedTask.blockedBy.filter((reference) => reference === appendedTask.id || reference === appendedTask.subject));
        writeTeam(workspace, withDerivedPhase(next));
        return {
          team: next,
          task: appendedTask,
          appended: `task ${appendedTask.id} "${appendedTask.subject}" appended to the live team ${next.teamId}`,
          ...appendedTask.unresolvedBlockers === undefined ? {} : { blockers: appendedTask.unresolvedBlockers.map((reference) => ({ reference, form: "unknown" })) }
        };
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
        const editedReferences = next.tasks.flatMap((task) => task.blockedBy ?? []);
        return { plan: next, ...editedReferences.length === 0 ? {} : { blockers: blockerReading(next, editedReferences) } };
      }
      if (action === "delete") {
        const plan = readPlan(workspace, sessionId);
        if (plan === undefined)
          return {};
        return { archivedTo: archivePlan(workspace, plan) };
      }
      if (action === "approve") {
        const outcome = await approveTeam(teamActionsDeps, {
          workspace,
          sessionId,
          lineage,
          ...exec.agent === undefined ? {} : { agent: exec.agent },
          ...exec.signal === undefined ? {} : { signal: exec.signal }
        }, { dryRun: args?.dry_run === true });
        if (!outcome.ok)
          throw new Error(outcome.error);
        const { ok: _envelope, ...reply } = outcome;
        return reply;
      }
      throw new Error(`agent_teams_plan: unknown action "${action}" (create | add_member | create_task | edit | approve | delete | status)`);
    }
  }));
  toolRegistrations += 1;
  disposers.push(dsh.registerTool({
    name: "agent_teams_task",
    description: "Shared board tasks: `claim` (freezes the contract), `contract`, `release`, terminal `complete`/`fail` (owner-only; optional `note`/`expected_revision`; a FAIL unblocks dependents), `depend` (append `blocked_by`), `context` (your own occupancy and seat state), `handoff` (write the seven-section document, then end your turn).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "contract", "release", "complete", "fail", "depend", "context", "handoff"], description: "What to do." },
        content: { type: "string", description: "handoff: the document." },
        task_id: { type: "string", description: "the task id." },
        claimant: { type: "string", description: "claim: who claims (default: caller)." },
        note: { type: "string", description: "complete/fail: one line on the row." },
        expected_revision: { type: "number", description: "the revision you decided on." },
        blocked_by: { type: "array", items: { type: "string" }, description: "depend: blockers to append." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      presentationMeta: toolCard(agentTeamsTaskCard),
      schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } }, task: { type: "object" }, released: { type: "boolean" }, refused: { type: "string" }, taskId: { type: "string" }, status: { type: "string" }, closedBy: { type: "string" }, attempt: { type: "number" }, revision: { type: "number" }, dependents: { type: "array", items: { type: "object" } }, note: { oneOf: [{ type: "string" }, { type: "null" }] }, added: { type: "array", items: { type: "string" } }, idempotent: { type: "boolean" }, unresolved: { type: "array", items: { type: "string" } }, teamId: { type: "string" }, member: { type: "string" }, mode: { type: "string" }, fenced: { type: "boolean" }, fencedReason: { type: "string" }, usedTokens: { oneOf: [{ type: "number" }, { type: "null" }] }, windowTokens: { oneOf: [{ type: "number" }, { type: "null" }] }, ratio: { oneOf: [{ type: "number" }, { type: "null" }] }, provenance: { type: "string" }, contextCheckpoint: { type: "object" }, path: { type: "string" }, ordinal: { type: "number" }, directive: { type: "string" } } },
      render: (_args, value) => text2(value?.refused !== undefined ? `refused: ${value.refused}` : value?.directive !== undefined ? `handoff written: ${value.path} (#${value.ordinal}) — end your turn now` : value?.provenance !== undefined ? `${value.member ?? "this session"}${value.mode === undefined ? "" : ` [${value.mode}]`} used ${value.usedTokens ?? "?"} / ${value.windowTokens ?? "no window"} (${value.provenance})${typeof value.ratio === "number" ? ` = ${Math.round(value.ratio * 100)}%` : ""}${value.fenced === true ? " · FENCED" : ""}` : value?.idempotent !== undefined ? describeDepend(value) : value?.released !== undefined ? value.released ? `${value.taskId} -> ${value.status ?? "pending"} (pairing freed)` : value.status !== undefined ? `${value.taskId} -> ${value.status} (no pairing to free)` : "that task was not dispatched" : value?.status !== undefined ? `${value.taskId} -> ${value.status} (by ${value.closedBy}, attempt ${value.attempt})` : value?.contract !== undefined ? `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}` : value?.contracts !== undefined ? `${value.contracts.length} contract(s)` : "no contract")
    },
    execute: async (args, exec) => {
      const { workspace, sessionId, lineage } = where(exec);
      const delegated = sessionIsDelegatedChild(exec);
      const action = String(args?.action ?? "");
      if (action === "context") {
        const pressure = dsh.contextPressure(exec.agent);
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        const member = resolved.record === undefined ? undefined : memberNamedBy(resolved.record, [sessionId]);
        return {
          ...resolved.record === undefined || member === undefined ? {} : {
            teamId: resolved.record.teamId,
            member: member.name,
            ...member.mode === undefined ? {} : { mode: member.mode },
            ...member.fenced === true ? { fenced: true } : {},
            ...member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason },
            ...member.contextCheckpoint === undefined ? {} : { contextCheckpoint: member.contextCheckpoint }
          },
          usedTokens: pressure.usedTokens,
          windowTokens: pressure.windowTokens,
          ratio: pressure.ratio,
          provenance: pressure.provenance
        };
      }
      if (action === "handoff") {
        const caller = {
          workspace,
          sessionId,
          lineage,
          ...exec.agent === undefined ? {} : { agent: exec.agent },
          ...exec.signal === undefined ? {} : { signal: exec.signal }
        };
        const outcome = await writeMemberHandoff(teamActionsDeps, caller, { content: String(args?.content ?? "") });
        if (!outcome.ok)
          throw new Error(outcome.error);
        const { ok: _envelope, ...reply } = outcome;
        return reply;
      }
      if (action === "release") {
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const taskId = String(args?.task_id ?? "");
        if (taskId === "")
          throw new Error("agent_teams_task release: task_id is required");
        const membership = (() => {
          try {
            return dsh.teamMembership(exec.agent);
          } catch {
            return;
          }
        })();
        const title = sessionTitleOf(exec);
        const identity = callerIdentity(resolved.record, sessionId, title, lineage);
        const caller = [sessionId, title, String(membership?.name ?? ""), ...identity.ownMember === undefined ? [] : [identity.ownMember.name], ...identity.ancestry].filter((value) => value !== "");
        return releaseDispatchedTask(workspace, resolved.record, taskId, typeof args?.expected_revision === "number" ? args.expected_revision : undefined, caller, membership?.role === "lead");
      }
      if (action === "depend") {
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const taskId = String(args?.task_id ?? "");
        if (taskId === "")
          throw new Error("agent_teams_task depend: task_id is required");
        const references = stringList(args?.blocked_by ?? args?.blockedBy) ?? [];
        if (references.length === 0)
          throw new Error("agent_teams_task depend: blocked_by is required");
        const fresh = readTeam(workspace, resolved.record.teamId) ?? resolved.record;
        const task = fresh.tasks.find((candidate) => candidate.id === taskId);
        if (task === undefined)
          return { taskId, refused: `no task "${taskId}" in team ${fresh.teamId}` };
        const membership = (() => {
          try {
            return dsh.teamMembership(exec.agent);
          } catch {
            return;
          }
        })();
        const title = sessionTitleOf(exec);
        const identity = callerIdentity(fresh, sessionId, title, lineage);
        const caller = [sessionId, title, String(membership?.name ?? ""), ...identity.ownMember === undefined ? [] : [identity.ownMember.name], ...identity.ancestry].filter((value) => value !== "");
        const refusal = authorizeRelease(fresh, taskId, caller, membership?.role === "lead");
        if (refusal !== undefined)
          return { taskId, refused: refusal };
        if (task.status === "completed" || task.status === "failed")
          return { taskId, refused: `task ${taskId} is "${task.status}" and its edges are frozen` };
        const merged = [...task.blockedBy];
        const added = [];
        const chainReaches = (fromId, targetId) => {
          const seen = new Set;
          const queue = [fromId];
          while (queue.length > 0) {
            const id = queue.pop();
            if (id === targetId)
              return true;
            if (seen.has(id))
              continue;
            seen.add(id);
            const row = fresh.tasks.find((candidate) => candidate.id === id);
            if (row === undefined)
              continue;
            for (const parent of resolveBlockers(fresh, row.blockedBy).blockedBy)
              queue.push(parent);
          }
          return false;
        };
        for (const reference of references) {
          const wired = resolveBlockers(fresh, [reference]).blockedBy[0];
          if (wired === taskId)
            return { taskId, refused: `task ${taskId} cannot be its own blocker — a self-edge would leave it pending forever, and depend can never remove an edge` };
          if (chainReaches(wired, taskId))
            return { taskId, refused: `${wired} already depends on ${taskId}, so blocking ${taskId} on it would create a cycle — depend appends edges and can never remove one` };
          if (merged.includes(wired))
            continue;
          merged.push(wired);
          added.push(wired);
        }
        const outcome = resolveBlockers(fresh, merged);
        if (added.length === 0)
          return { taskId, task, idempotent: true, added, unresolved: outcome.unresolved };
        const next = updateTeamTask(fresh, taskId, { blockedBy: merged }, now());
        writeTeam(workspace, withDerivedPhase(next));
        const view = next.tasks.find((candidate) => candidate.id === taskId) ?? task;
        return { taskId, task: view, idempotent: false, added, unresolved: outcome.unresolved };
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
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const record = resolved.record;
        const task = record.tasks.find((candidate) => candidate.id === String(args?.task_id ?? ""));
        if (task === undefined)
          throw new Error(`no task "${String(args?.task_id ?? "")}" in team ${record.teamId}`);
        assertClaimReady(record.tasks, task);
        const claimant = String(args?.claimant ?? sessionId);
        const contract = claimContract(workspace, {
          id: task.id,
          subject: task.subject,
          description: task.description,
          blockedBy: task.blockedBy,
          writeScopes: task.writeScopes,
          revision: task.revision
        }, claimant, now());
        const claimed = updateTeamTask(record, task.id, { status: "in_progress", owner: claimant === "" ? undefined : claimant, attempt: contract.attempt }, now());
        const claimedMember = memberNamedBy(claimed, [claimant]);
        const next = withDerivedPhase(claimedMember?.status === "inactive" ? updateTeamMember(claimed, claimedMember.id, { status: "running" }) : claimed);
        writeTeam(workspace, next);
        const view = next.tasks.find((candidate) => candidate.id === task.id) ?? task;
        return { contract, task: view };
      }
      if (action === "complete" || action === "fail") {
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const record = resolved.record;
        const taskId = String(args?.task_id ?? "");
        if (taskId === "")
          throw new Error(`agent_teams_task ${action}: task_id is required`);
        const self = exec.agent;
        const membership = (() => {
          try {
            return dsh.teamMembership(exec.agent);
          } catch {
            return;
          }
        })();
        const title = String(self?.session?.header?.title ?? "");
        const identity = callerIdentity(record, sessionId, title, lineage);
        const caller = [sessionId, title, String(membership?.name ?? ""), ...identity.ownMember === undefined ? [] : [identity.ownMember.name], ...identity.ancestry].filter((value) => value !== "");
        const fresh = readTeam(workspace, record.teamId) ?? record;
        const outcome = casCloseTask(fresh, {
          taskId,
          status: action === "complete" ? "completed" : "failed",
          caller,
          lead: membership?.role === "lead",
          ...typeof args?.expected_revision === "number" ? { expectedRevision: args.expected_revision } : {},
          ...args?.note === undefined ? {} : { note: String(args.note) },
          now: now()
        });
        if (!outcome.applied)
          return { refused: outcome.reason, taskId };
        let next = outcome.record;
        const ownerSpelling = outcome.task.owner;
        if (ownerSpelling !== undefined && ownerSpelling !== "") {
          const owner = memberNamedBy(outcome.record, [ownerSpelling]);
          const ownerHandle = owner?.executorRef;
          if (ownerHandle !== undefined && ownerHandle !== "")
            next = settleMember(outcome.record, ownerHandle, now());
        }
        writeTeam(workspace, withDerivedPhase(next));
        let releasedFromDispatch = false;
        if (outcome.status === "failed") {
          const freed = release(readLedger(workspace), record.teamId, taskId);
          if (freed.released) {
            writeLedger(workspace, freed.ledger);
            releasedFromDispatch = true;
          }
        }
        rowLogLine("mpd-team-core", `[mpd-team-core] task ${taskId} ${outcome.status} by ${outcome.closedBy}`);
        return {
          taskId,
          status: outcome.status,
          closedBy: outcome.closedBy,
          attempt: outcome.attempt,
          revision: outcome.task.revision,
          note: outcome.task.note ?? null,
          dependents: outcome.dependents,
          releasedFromDispatch
        };
      }
      throw new Error(`agent_teams_task: unknown action "${action}" (claim | contract | release | complete | fail | depend | context | handoff)`);
    }
  }));
  toolRegistrations += 1;
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description: 'Pair READY tasks with their DECLARED OWNER (no substitute) and record it; a busy/absent/fenced owner is reported, row left pending. `mode:"roster"` restores the positional fallback. `reassign` hands rows to another member: claimed, journaled `task-reassigned`, then delivered. `release` frees a pairing and reopens the row. Lead-only: `reassign`, `mode:"roster".',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "release"], description: "What to do." },
        task_id: { type: "string", description: "release: the task to free." },
        dry_run: { type: "boolean", description: "run: report, send nothing." },
        limit: { type: "number", description: "run: cap pairs (0/omitted = no cap)." },
        mode: { type: "string", enum: ["owner-only", "roster"], description: "run: default owner-only." },
        reassign: { type: "array", items: { type: "object" }, description: "run: [{task_id, owner}] applied first." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      presentationMeta: toolCard(agentTeamsDispatchCard),
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, reassigned: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, refused: { type: "string" }, holdRead: { type: "string" }, forgotten: { type: "array", items: { type: "string" } }, reaped: { type: "array", items: { type: "string" } }, released: { type: "boolean" }, taskId: { type: "string" }, status: { type: "string" }, revision: { type: "number" } } },
      render: (_args, value) => text2(value?.refused !== undefined ? `refused: ${value.refused}` : value?.released !== undefined ? value.released ? "released" : "that task was not dispatched" : value?.halted !== undefined ? `halted: ${value.halted}` : [
        ...Array.isArray(value?.reassigned) ? value.reassigned.map((row) => `reassigned ${row.taskId} -> ${row.owner}${row.delivered === true ? "" : " (NOT delivered: " + String(row.reason ?? "unknown") + ")"}`) : [],
        ...(value?.pairs?.length ?? 0) === 0 ? ["nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row) => row.subject + ": " + row.reason).join("; ") + ")")] : value.pairs.map((pair) => `${pair.subject} -> ${pair.memberName}` + (typeof pair.note === "string" && pair.note !== "" ? ` [${pair.note}]` : ""))
      ].join(`
`))
    },
    execute: async (args, exec) => {
      const { workspace, sessionId, lineage } = where(exec);
      const action = String(args?.action ?? "");
      const delegated = sessionIsDelegatedChild(exec);
      if (action === "release") {
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const taskId = String(args?.task_id ?? "");
        if (taskId === "")
          throw new Error("agent_teams_dispatch release: task_id is required");
        const membership = (() => {
          try {
            return dsh.teamMembership(exec.agent);
          } catch {
            return;
          }
        })();
        const title = sessionTitleOf(exec);
        const identity = callerIdentity(resolved.record, sessionId, title, lineage);
        const caller = [sessionId, title, String(membership?.name ?? ""), ...identity.ownMember === undefined ? [] : [identity.ownMember.name], ...identity.ancestry].filter((value) => value !== "");
        return releaseDispatchedTask(workspace, resolved.record, taskId, undefined, caller, membership?.role === "lead");
      }
      const requestedMode = args?.mode;
      const requestedReassign = args?.reassign;
      const requestedPairs = Array.isArray(requestedReassign) ? requestedReassign.length : requestedReassign === undefined ? 0 : 1;
      const ownershipAsked = requestedPairs > 0 || requestedMode === "roster";
      if (ownershipAsked) {
        const resolved = resolveForWrite(workspace, sessionId, lineage, delegated);
        if (resolved.record === undefined)
          throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first");
        const membership = (() => {
          try {
            return dsh.teamMembership(exec.agent);
          } catch {
            return;
          }
        })();
        const title = sessionTitleOf(exec);
        const identity = callerIdentity(resolved.record, sessionId, title, lineage);
        const caller = [sessionId, title, String(membership?.name ?? ""), ...identity.ownMember === undefined ? [] : [identity.ownMember.name], ...identity.ancestry].filter((value) => value !== "");
        if (!recordNamesLead(resolved.record, caller) && membership?.role !== "lead") {
          throw new Error(`only the Lead of team ${resolved.record.teamId} may reassign a row or force mode:"roster" — a plain pass (agent_teams_dispatch {action:"run"}) is open to any member`);
        }
      }
      const outcome = await runDispatch(teamActionsDeps, {
        workspace,
        sessionId,
        lineage,
        ...exec.agent === undefined ? {} : { agent: exec.agent },
        ...exec.signal === undefined ? {} : { signal: exec.signal }
      }, {
        ...typeof args?.limit === "number" ? { limit: args.limit } : {},
        dryRun: args?.dry_run === true,
        ...requestedMode === undefined ? {} : { mode: requestedMode },
        ...requestedReassign === undefined ? {} : { reassign: requestedReassign }
      });
      if (!outcome.ok)
        throw new Error(outcome.error);
      const { ok: _envelope, ...reply } = outcome;
      return reply;
    }
  }));
  toolRegistrations += 1;
  disposers.push(dsh.registerTool({
    name: "agent_teams_mail",
    description: "The team mailbox. `send` records a message; a body over 4000 chars is cut at WRITE (`truncated`, `originalLength`, original not kept). `unread` lists unacknowledged mail PAGED (`limit` 20, `offset`, `more`, `nextOffset`); rows past the page stay UNREAD. `read` acks ids; `summary` counts totals. `question`/`answer` set the kind. `permit` (captain) grants a wait TTL; `wait` needs it.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "unread", "read", "summary", "permit", "wait"], description: "What to do." },
        to: { type: "string", description: "send: member id/name, captain/lead, or *." },
        subject: { type: "string", description: "send: subject." },
        body: { type: "string", description: "send: body." },
        question: { type: "object", description: "send: {questionId, question, options:[{label}]}." },
        answer: { type: "object", description: "send: {questionId, answerTo, selected:[labels]}." },
        replyTo: { type: "string", description: "send: the message id this row replies to." },
        member: { type: "string", description: "unread: whose inbox." },
        limit: { type: "integer", description: "Rows per page." },
        offset: { type: "integer", description: "Start row." },
        ids: { type: "array", items: { type: "string" }, description: "read: the message ids to acknowledge." },
        holder: { type: "string", description: "permit: member id/name the grant is for." },
        scope: { type: "string", enum: ["answer", "message"], description: "permit: what may be waited for (default `answer`)." },
        ttlMs: { type: "number", description: "permit: lifetime ms (default 60000, max 600000)." },
        questionId: { type: "string", description: "permit: narrow the grant to this question id." },
        permitId: { type: "string", description: "wait: the captain-issued permit id." },
        messageId: { type: "string", description: "wait: the message id being waited on." },
        timeoutMs: { type: "number", description: "wait: block ms (default 15000, cap 60000)." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, scope: { type: "string" }, legacyUnstamped: { type: "number" }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" }, broadcast: { type: "boolean" }, ok: { type: "boolean" }, reason: { type: "string" }, permit: { type: "object" }, permitScope: { type: "string" }, answers: { type: "array", items: { type: "object" } }, polls: { type: "number" }, waitedMs: { type: "number" } } },
      render: (_args, value) => text2(value?.refused !== undefined ? `refused: ${value.refused}` : value?.permit !== undefined ? `permit ${value.permit.permitId} → ${value.permit.holderName} · scope ${value.permit.scope} · expires ${value.permit.expiresAt}` : value?.ok === false ? `wait ${value.reason} after ${value.waitedMs} ms (${value.polls} poll(s))` : value?.ok === true ? `wait returned ${(value.answers ?? value.messages ?? []).length} row(s) after ${value.waitedMs} ms` : value?.message !== undefined ? `sent ${value.message.id} to ${value.message.toName}` + (value.message.truncated === true ? ` (body truncated at 4000 chars of ${value.message.originalLength} — the pre-cut text is not kept)` : "") : value?.broadcast === true ? `sent ${value.messages?.length ?? 0} message(s), one row per recipient` : value?.moved !== undefined ? `acknowledged ${value.moved.length} message(s)` : value?.summary !== undefined ? (value.summary.length === 0 ? `no mail (${value.scope ?? "workspace"} scope)` : value.summary.map((row) => `${row.memberName}: ${row.unread} unread / ${row.total} total`).join(`
`) + ` (${value.scope ?? "workspace"} scope)`) + (typeof value?.legacyUnstamped === "number" ? ` · ${value.legacyUnstamped} unstamped row(s) excluded (sent before team stamping)` : "") : (value?.messages?.length ?? 0) === 0 ? "nothing unread" : value.messages.map((mail) => `${mail.id} from ${mail.fromName}: ${mail.subject}`).join(`
`) + (typeof value?.more === "number" && value.more > 0 ? `
(showing ${value.messages.length} of ${value.unreadTotal}; more: ${value.more} — next page offset=${value.nextOffset})` : ""))
    },
    execute: async (args, exec) => {
      const { workspace, sessionId, lineage } = where(exec);
      const caller = sessionId;
      const self = exec.agent;
      const mailTeam = recordFor(workspace, caller, lineage);
      const roster = (mailTeam?.members ?? []).map((member) => ({ id: member.id, name: member.name, status: member.status, handle: member.executorRef ?? "" }));
      const resolve4 = (name2) => roster.find((member) => member.id === name2 || member.name === name2);
      const callerId = String(self?.session?.id ?? caller);
      const callerName = String(self?.session?.header?.title ?? caller);
      const ownMember = mailTeam === undefined ? undefined : callerIdentity(mailTeam, callerId, sessionTitleOf(exec), lineage).ownMember;
      const leadId = String(mailTeam?.leadSessionId ?? "");
      const callerIsLead = mailTeam !== undefined && leadId !== "" && (mailTeam.leadSessionId === callerId || (mailTeam.leadHistory ?? []).includes(callerId) || lineage.some((id) => id === mailTeam.leadSessionId || (mailTeam.leadHistory ?? []).includes(id)));
      const callerAddress = ownMember?.id ?? (callerIsLead ? leadId : callerId);
      const captainSpelling = () => {
        if (mailTeam === undefined)
          return "this caller resolves no team record, so no captain can have issued a permit";
        if (leadId === "")
          return "this team records no captain, so no permit can be valid";
        if (callerIsLead)
          return `this caller IS this team's captain ("${leadId}"), who grants permits to members`;
        return `this caller's captain is "${leadId}"`;
      };
      if (args?.action === "send") {
        const resolved = resolveRecipients({
          members: roster.map((member) => ({ id: member.id, name: member.name })),
          ...leadId === "" ? {} : { lead: { id: leadId, name: "captain" } },
          selfId: callerAddress
        }, String(args?.to ?? ""));
        if (!resolved.ok)
          return { refused: resolved.detail };
        if (resolved.targets.length === 0)
          return { refused: "there is nobody to address — this team has no other members and records no lead" };
        const result = sendMany(workspace, {
          fromId: callerId,
          fromName: callerName,
          toId: resolved.targets[0].id,
          toName: resolved.targets[0].name,
          subject: String(args?.subject ?? ""),
          body: String(args?.body ?? ""),
          memberIds: roster.map((member) => member.id),
          ...leadId === "" ? {} : { leadIds: [leadId] },
          kind: args?.answer !== undefined ? "answer" : args?.question !== undefined ? "question" : "message",
          ...args?.replyTo === undefined ? {} : { replyTo: String(args.replyTo) },
          ...args?.threadId === undefined ? {} : { threadId: String(args.threadId) },
          ...args?.question === undefined ? {} : { question: args.question },
          ...args?.answer === undefined ? {} : { answer: args.answer },
          ...callerAddress === callerId ? {} : { fromMemberId: callerAddress },
          ...mailTeam === undefined ? {} : { teamId: mailTeam.teamId }
        }, resolved.targets, now());
        if (!result.ok)
          return { refused: result.detail };
        const delivered = [];
        for (const message of result.messages) {
          const member = roster.find((entry) => entry.id === message.toId);
          if (member === undefined) {
            recordWake(workspace, message.id, { sent: false, reason: `${message.toName} is the team lead — recorded, not woken` }, now());
            rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${message.id}; the lead is recorded, not woken`);
            continue;
          }
          if (member.handle === "") {
            recordWake(workspace, message.id, { sent: false, reason: `${member.name} has no executor handle — it was never raised` }, now());
            rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${message.id}; ${member.name} has no executor handle`);
            continue;
          }
          try {
            await executor().send(exec.agent, member.handle, `[${message.subject}]

${message.body}`, exec.signal);
            recordWake(workspace, message.id, { sent: true }, now());
            delivered.push(message.id);
          } catch (error) {
            recordWake(workspace, message.id, { sent: false, reason: `the transport refused it: ${String(error?.message ?? error)}` }, now());
            rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${message.id} but the transport refused it: ${String(error?.message ?? error)}`);
          }
        }
        if (delivered.length > 0)
          markDelivered(workspace, delivered, now());
        return resolved.broadcast ? { messages: result.messages, broadcast: true } : { message: result.messages[0] };
      }
      if (args?.action === "permit") {
        if (!callerIsLead)
          return { refused: `permit: only this team's captain may issue a wait permit — ${captainSpelling()}` };
        const holder = resolve4(String(args?.holder ?? ""));
        if (holder === undefined) {
          return { refused: `permit: "${String(args?.holder ?? "")}" is not a member of this team (members: ${roster.map((member) => member.name).join(", ") || "none"})` };
        }
        const issued = issuePermit(workspace, {
          issuerId: callerAddress,
          issuerName: callerName,
          holderId: holder.id,
          holderName: holder.name,
          ...args?.scope === undefined ? {} : { scope: args.scope },
          ...args?.ttlMs === undefined ? {} : { ttlMs: args.ttlMs },
          ...args?.questionId === undefined ? {} : { questionId: args.questionId }
        }, now());
        if (!issued.ok)
          return { refused: `permit: ${issued.detail}` };
        return { ok: true, permit: issued.permit };
      }
      if (args?.action === "wait") {
        const permitId = String(args?.permitId ?? "");
        const messageId = String(args?.messageId ?? "");
        if (permitId === "")
          return { refused: `wait: permitId is required — a blocking wait needs a permit from your captain: ${captainSpelling()}` };
        if (messageId === "")
          return { refused: `wait: messageId is required (the row that will be answered) — the permit comes from your captain: ${captainSpelling()}` };
        if (args?.timeoutMs !== undefined && (!Number.isFinite(Number(args.timeoutMs)) || Number(args.timeoutMs) < 0)) {
          return { refused: `wait: timeoutMs must be a non-negative number of milliseconds — got ${JSON.stringify(args.timeoutMs ?? null)}` };
        }
        const permits = readPermits(workspace);
        const permit = permits.permits.find((entry) => entry.permitId === permitId);
        if (permit === undefined) {
          return { refused: `wait: no permit "${permitId}" is recorded — a blocking wait needs a permit from your captain: ${captainSpelling()}; without one every mail call stays non-blocking` };
        }
        const checked = checkPermit(permit, {
          holderId: callerAddress,
          holderName: ownMember?.name ?? callerName,
          sessionId: callerId,
          leadIds: [leadId, ...mailTeam?.leadHistory ?? []].filter((id) => id !== ""),
          ...args?.timeoutMs === undefined ? {} : { requestedTimeoutMs: Number(args.timeoutMs) }
        }, now());
        if (!checked.ok)
          return { refused: `wait: ${checked.detail}` };
        const state2 = scopeToTeam(readMailbox(workspace), mailTeam?.teamId);
        const target = state2.messages.find((message) => message.id === messageId);
        if (target === undefined)
          return { refused: `wait: no message "${messageId}" is recorded for this team — pass the id the send returned` };
        const waitHolder = { holderId: callerAddress, holderName: ownMember?.name ?? callerName, sessionId: callerId };
        const targetCheck = checkWaitTarget(checked.permit, target, waitHolder);
        if (!targetCheck.ok)
          return { refused: `wait: ${targetCheck.detail}` };
        const outcome = await waitForReply({
          permit: checked.permit,
          target,
          timeoutMs: checked.timeoutMs,
          read: () => scopeToTeam(readMailbox(workspace), mailTeam?.teamId),
          now,
          sleep: (ms) => new Promise((resolve5) => setTimeout(resolve5, ms)),
          ...exec.signal === undefined ? {} : { signal: exec.signal }
        });
        if (!outcome.ok)
          return { ok: false, reason: outcome.reason, permitId, permitScope: checked.permit.scope, polls: outcome.polls, waitedMs: outcome.waitedMs };
        const answers = outcome.messages.flatMap((message) => message.answer === undefined ? [] : [{
          id: message.id,
          fromName: message.fromName,
          questionId: message.answer.questionId,
          answerTo: message.answer.answerTo,
          selected: message.answer.selected,
          ...message.answer.custom === undefined ? {} : { custom: message.answer.custom }
        }]);
        if (checked.permit.scope === "message") {
          return { ok: true, permitId, permitScope: checked.permit.scope, messages: outcome.messages, polls: outcome.polls, waitedMs: outcome.waitedMs };
        }
        return { ok: true, permitId, permitScope: checked.permit.scope, answers, polls: outcome.polls, waitedMs: outcome.waitedMs };
      }
      if (args?.action === "read") {
        const outcome = acknowledge(workspace, Array.isArray(args?.ids) ? args.ids.map(String) : [], { byId: callerAddress, byName: ownMember?.name ?? callerName }, now());
        return { moved: outcome.moved, ...outcome.refused.length === 0 ? {} : { refused: outcome.refused.map((entry) => entry.reason).join("; ") } };
      }
      if (args?.action === "summary") {
        const state2 = readMailbox(workspace);
        const rows = summarise(state2);
        if (mailTeam === undefined)
          return { summary: rows, scope: "workspace" };
        const mine = scopeToTeam(state2, mailTeam.teamId).messages;
        const legacyUnstamped = state2.messages.length - state2.messages.filter((message) => message.teamId !== undefined).length;
        return { summary: summarise({ messages: mine }), scope: "team", ...legacyUnstamped === 0 ? {} : { legacyUnstamped } };
      }
      const state = readMailbox(workspace);
      const wanted = args?.member === undefined ? undefined : resolve4(String(args.member));
      if (args?.member !== undefined && wanted === undefined) {
        return { refused: `"${String(args.member)}" is not a member of this team (members: ${roster.map((member) => member.name).join(", ") || "none"})` };
      }
      const memberId = wanted?.id ?? callerAddress;
      const scoped = scopeToTeam(state, mailTeam?.teamId);
      const unreadRows = unreadOf(scoped, memberId);
      const paged = pageOf(unreadRows, Number(args?.limit ?? 20), Number(args?.offset ?? 0));
      const page = paged.page;
      return {
        messages: page.map((message) => ({
          id: message.id,
          fromName: message.fromName,
          subject: message.subject,
          body: message.body,
          sentAt: message.sentAt,
          delivered: message.deliveredAt !== undefined,
          kind: message.kind,
          threadId: message.threadId,
          ...message.replyTo === undefined ? {} : { replyTo: message.replyTo },
          ...message.question === undefined ? {} : { question: message.question },
          ...message.answer === undefined ? {} : { answer: message.answer }
        })),
        undelivered: undeliveredOf(scoped, memberId).length,
        total: inboxOf(scoped, memberId).length,
        memberName: wanted?.name ?? ownMember?.name ?? memberId,
        offset: paged.offset,
        more: paged.more,
        unreadTotal: unreadRows.length,
        nextOffset: paged.nextOffset
      };
    }
  }));
  toolRegistrations += 1;
  disposers.push(dsh.registerTool({
    name: "agent_teams_control",
    description: 'Halt, resume or fence. `halt` stops NEW DISPATCH and leaves the team and every teammate alive (end a team with agent_teams_plan action:"delete"); `resume` clears the hold; `fence`/`unfence` close or reopen ONE seat, which is then never messaged (Lead only).',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["halt", "resume", "fence", "unfence"], description: "What to do." },
        reason: { type: "string", description: "halt/fence: why." },
        member: { type: "string", description: "fence/unfence: the seat." }
      },
      required: ["action"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { hold: { type: "object" }, resumed: { type: "boolean" }, teamId: { type: "string" }, member: { type: "string" }, fenced: { type: "boolean" }, reason: { type: "string" }, refused: { type: "string" } } },
      render: (_args, value) => text2(value?.refused !== undefined ? `refused: ${value.refused}` : value?.fenced !== undefined ? `${value.member} ${value.fenced ? "fenced" : "unfenced"}${value.fenced && typeof value.reason === "string" && value.reason !== "" ? ` (${value.reason})` : ""}` : value?.resumed !== undefined ? value.resumed ? "resumed" : "was not halted" : value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`)
    },
    execute: async (args, exec) => {
      const { workspace, sessionId, lineage } = where(exec);
      const action = String(args?.action ?? "");
      if (action === "fence" || action === "unfence") {
        const member = String(args?.member ?? "").trim();
        if (member === "")
          throw new Error(`agent_teams_control ${action}: member is required`);
        const caller = {
          workspace,
          sessionId,
          lineage,
          ...exec.agent === undefined ? {} : { agent: exec.agent },
          ...exec.signal === undefined ? {} : { signal: exec.signal }
        };
        const outcome = action === "fence" ? await fenceMember(teamActionsDeps, caller, { member, ...args?.reason === undefined ? {} : { reason: String(args.reason) } }) : await unfenceMember(teamActionsDeps, caller, { member });
        if (!outcome.ok)
          throw new Error(outcome.error);
        const { ok: _envelope, ...reply } = outcome;
        return reply;
      }
      if (action === "resume")
        return { resumed: clearHold(workspace) };
      if (action !== "halt")
        throw new Error(`agent_teams_control: unknown action "${action}" (halt | resume | fence | unfence)`);
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
  const teamDoor = installTeamDoorGuard(dsh, { warn: (line) => {
    rowLogLine("mpd-team-core", line);
  } });
  if (teamDoor.dispose !== undefined)
    disposers.push(teamDoor.dispose);
  const root = (() => {
    try {
      return dsh.workspaceRoot();
    } catch {
      return "";
    }
  })();
  if (root !== "") {
    try {
      const staging = join12(root, ".mpd", "team", "staging");
      const pending = existsSync7(staging) ? readdirSync6(staging).filter((file) => file.endsWith(".json")).length : 0;
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
      rowLogLine("mpd-team-core", `[mpd-team-core] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${toolRegistrations} tools + the /agent-teams command${teamDoor.installed ? " + the team-door guard" : ""})`);
      reportExecutor();
      const mountTeamRoute = () => registerTeamRoutes(dsh.webServerOf(), {
        recordFor: (sessionId) => recordFor(workspaceForRequest(sessionId), sessionId),
        workspace: (sessionId) => workspaceForRequest(sessionId ?? ""),
        authorize: (request) => dsh.webRequestRejection(request),
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
        warn: (line) => rowLogLine("mpd-team-core", `[mpd-team-core] ${line}`),
        subscribe: (workspace, listener) => feed.subscribe(workspace, listener),
        revision: (workspace) => feed.revision(workspace),
        graph: (workspace, teamId) => graphOf(workspace, teamId),
        actions: {
          isLive: (sessionId) => liveAgentForSession(sessionId) !== undefined,
          approve: (sessionId) => teamActions.approve({ sessionId }),
          dispatch: (sessionId, input) => teamActions.dispatch({ sessionId, ...input })
        }
      });
      if (mountTeamRoute())
        rowLogLine("mpd-team-core", `[mpd-team-core] team web routes: ${TEAM_ROUTES.join(" ")} ${TEAM_ACTION_ROUTES.join(" ")}`);
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
  if (typeof dsh.onEvent === "function") {
    const offTurnStopping = dsh.onEvent("agent/turn-stopping", (payload) => {
      try {
        const agent = payload?.agent;
        const sessionId = String(agent?.session?.id ?? "");
        if (sessionId === "")
          return;
        const cwd = String(agent?.session?.header?.cwd ?? "");
        const workspace = cwd !== "" ? cwd : dsh.workspaceRoot();
        if (workspace === "")
          return;
        (async () => {
          try {
            for (const team of listTeams(workspace)) {
              if (!team.members.some((member) => member.executorRef === sessionId))
                continue;
              const fresh = readTeam(workspace, team.teamId);
              if (fresh === undefined)
                continue;
              const settled = settleMember(fresh, sessionId, now());
              if (settled === fresh)
                continue;
              writeTeam(workspace, withDerivedPhase(settled));
              rowLogLine("mpd-team-core", `[mpd-team-core] member ${sessionId} settled to inactive in ${team.teamId}`);
            }
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] turn-boundary settlement failed: ${String(error?.message ?? error)}`);
          }
        })();
      } catch (error) {
        rowLogLine("mpd-team-core", `[mpd-team-core] turn-boundary listener failed: ${String(error?.message ?? error)}`);
      }
      return;
    });
    if (typeof offTurnStopping === "function")
      disposers.push(offTurnStopping);
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
  STAGED_PLAN_VERSION,
  TEAMS_SERVICE,
  addMember,
  addTask,
  apply,
  archivePathFor,
  archivePlan,
  claimContract,
  classifyBlocker,
  clearHold,
  inject,
  listArchivedPlans,
  listContracts,
  moveIntoArchive,
  name,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  teamRoot2 as teamRoot,
  writePlan
};
