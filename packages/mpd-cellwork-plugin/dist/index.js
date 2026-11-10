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
    splitTaskId: "",
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
    ...raw.fenced === true ? { fenced: true } : {},
    ...typeof raw.fencedReason === "string" ? { fencedReason: raw.fencedReason } : {},
    ...textField(raw.checkpointSince) === undefined ? {} : { checkpointSince: raw.checkpointSince },
    ...typeof raw.barrierFailures === "number" && Number.isFinite(raw.barrierFailures) && raw.barrierFailures > 0 ? { barrierFailures: Math.floor(raw.barrierFailures) } : {},
    joinedAt: typeof raw.joinedAt === "string" ? raw.joinedAt : "",
    ...raw.adopted === true ? { adopted: true } : {}
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
    splitTaskId: typeof raw.splitTaskId === "string" ? raw.splitTaskId : "",
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
    if (held !== undefined) {
      const state = held.adopt === undefined || deps.adopt === false ? { state: candidate.state } : adoptSeat(workspace, candidate.state, held.adopt);
      return { workspace, sessionId, member: held.member, seat: held.seat, cell: state.state, refusal: null, ...state.failure === undefined ? {} : { adoptionFailure: state.failure } };
    }
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
  const rawRecord = cell.teamId === "" ? undefined : deps.teams?.()?.get?.(workspace, cell.teamId);
  const record = typeof rawRecord === "object" && rawRecord !== null ? rawRecord : undefined;
  const rows = record !== undefined && Array.isArray(record.members) ? record.members.filter((row) => typeof row === "object" && row !== null) : [];
  const planeFence = (name) => {
    const row = rows.find((candidate) => candidate.name === name || typeof candidate.id === "string" && candidate.id === name);
    if (row === undefined)
      return;
    return row.mode === "checkpoint" || row.fenced === true ? "checkpoint" : undefined;
  };
  for (const member of Object.values(cell.members)) {
    if (member.sessionId === sessionId)
      return { member: member.name, seat: { cellId: cell.cellId, name: member.name, mode: memberMode(planeFence(member.name) ?? member.mode) } };
  }
  if (record === undefined)
    return;
  for (const row of rows) {
    if (row.executorRef !== sessionId)
      continue;
    const name = typeof row.name === "string" && row.name !== "" ? row.name : "member";
    const known = cell.members[name];
    return {
      member: name,
      seat: { cellId: cell.cellId, name, mode: memberMode(planeFence(name) ?? known?.mode) },
      ...known === undefined ? { adopt: adoptedSeat(name, row, sessionId) } : {}
    };
  }
  return;
}
function adoptedSeat(name, row, sessionId) {
  return {
    name,
    role: typeof row.role === "string" ? row.role : "",
    sessionId,
    executorRef: sessionId,
    mode: "member",
    handoffReady: false,
    handoffs: 0,
    joinedAt: new Date().toISOString(),
    adopted: true
  };
}
function adoptSeat(workspace, cell, row) {
  const fresh = readCell(workspace, cell.cellId);
  if (!fresh.ok)
    return { state: withMember(cell, row), failure: { kind: "read", detail: "the cell record at " + fresh.path + " could not be read (" + fresh.detail + ")" } };
  if (fresh.state.members[row.name] !== undefined)
    return { state: fresh.state };
  const next = withMember(fresh.state, row);
  try {
    const written = writeCell(workspace, next);
    const lines = appendJournal(workspace, cell.cellId, { event: "member-adopted", member: row.name, role: row.role, sessionId: row.sessionId }, new Date);
    return { state: lines > 0 ? { ...written, journalCursor: lines } : written };
  } catch (error) {
    return { state: next, failure: { kind: "write", detail: "writing " + statePath(workspace, cell.cellId) + " failed (" + (error instanceof Error ? error.message : String(error)) + ")" } };
  }
}
function withMember(cell, row) {
  return { ...cell, members: { ...cell.members, [row.name]: row } };
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
  checkpointPendingMaxMs: 900000,
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
  checkpointPendingMaxMs: { integer: true, min: 0, max: 86400000 },
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
    checkpointPendingMaxMs: numberKnob("checkpointPendingMaxMs", row, readFile, warn),
    asciiCharsPerToken: numberKnob("asciiCharsPerToken", row, readFile, warn),
    cjkCharsPerToken: numberKnob("cjkCharsPerToken", row, readFile, warn),
    windowOverride
  };
}

// packages/mpd-cellwork-plugin/src/guard.ts
var CAPTAIN_TOOL_PREFIXES = ["cellwork_", "agent_teams_", "mpd_memory_"];
var CAPTAIN_TOOL_NAMES = ["ask_user_question", "todo_write", "mpd_verify_open"];
var CAPTAIN_FORBIDDEN_NAMES = ["cellwork_handoff", "cellwork_delegate", "cellwork_consult"];
var VERIFIER_DENY_TOOLS = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
  "mpd_role_spawn_async",
  "mpd_role_consult",
  "cellwork_delegate",
  "cellwork_consult"
];
var CHECKPOINT_ALLOW_TOOLS = ["cellwork_handoff", "cellwork_context", "cellwork_status"];
var PLANNER_READABLE_PREFIXES = [".mpd/", "docs/", "evidence/", "agent-references/"];
var PLANNER_READABLE_ROOT_FILES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md"
];
var PLANNER_INSTRUCTION_BASENAMES = ["AGENT.md", "AGENTS.md", "CLAUDE.md"];
var PLANNER_LICENSE_PATTERN = /^LICENSE.*\.md$/i;
var PLANNER_RECON_TOOLS = ["read", "grep", "glob"];
var VERIFIER_NO_DELEGATION = ["mpd_role_spawn", "mpd_role_spawn_async", "mpd_role_consult", "mpd_workmate_spawn", "cellwork_delegate", "cellwork_consult"];
var PLANNER_SEAT_NAME = "cell-planner";
var SUBCAPTAIN_FORBIDDEN_NAMES = ["cellwork_start", "cellwork_stop"];
var SUBCAPTAIN_TOOL_NAMES = ["cellwork_subteam", "cellwork_activate", "cellwork_dispatch", "cellwork_supervise", "cellwork_delegate", "cellwork_consult"];
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
  return "cellwork: `" + toolName + "` is refused — while a cell is running the CAPTAIN DISPATCHES ONLY " + "(user clause 1): it edits no file, runs no shell, does no reconnaissance and verifies nothing. " + "Allowed here: `cellwork_*` except `cellwork_handoff`, `cellwork_delegate` and `cellwork_consult` " + "(`cellwork_status`, `cellwork_start`, " + "`cellwork_dispatch`, `cellwork_supervise`, `cellwork_activate`, `cellwork_send`, `cellwork_inbox`), " + "`agent_teams_*` (`agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail`), " + "`mpd_verify_open` (opening a loop only — binding, evidence and verdict stay refused), " + "`ask_user_question`, `todo_write` and `mpd_memory_*`. Put the work on the team: stage or extend it " + "with `agent_teams_plan`, then DISPATCH WITH `cellwork_dispatch` — owner-only, and a busy or absent " + "owner is REPORTED and the task left pending, never substituted. (`agent_teams_dispatch` stays allowed " + "but it is NOT the verb for this board: it falls back to roster order, which can hand review work to " + "its own writer.) Background side-work is a MEMBER's or a SUBCAPTAIN's call: they run " + "`cellwork_delegate` and collect with `cellwork_consult`. " + "Relay the planner's questions with `ask_user_question`. To leave the mode and get " + "every tool back, call `cellwork_stop`.";
}
function verifierRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session is a VERIFIER of the cell, so it never " + "fixes what it judges. Read the frozen contract and the documentation (not the implementation), run " + "the gates, then record the verdict with `mpd_verify_record` (a PASS needs the documents it cites " + "and its gate evidence ids); reading, `bash`, `grep`, `glob` and `mpd_verify_*` stay available. A " + "FAIL bounces the work back to its writer as a repair task, and only a RECORDED FAIL makes " + "implementation reading legitimate, for diagnosis.";
}
function verifierDelegationRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session is a VERIFIER of the cell, and A VERIFIER " + "NEVER DELEGATES: the verdict is the seat's OWN work, so handing the question to another agent would " + "put its report inside a judgement you sign. Reading, `bash`, `grep`, `glob`, the gates and the five " + "`mpd_verify_*` calls stay available — read the frozen contract and the documentation (never the " + "implementation), run the gates, and record the verdict with `mpd_verify_record` (a PASS needs the " + "documents it cites and its gate evidence ids). If the evidence to judge is not there, a FAIL bounces " + "the work back to its writer as a repair task: that is the channel, not a consult.";
}
function checkpointRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session reached its CONTEXT CHECKPOINT, so the " + "work stops at this boundary. Call `cellwork_handoff` now with the task, the current state, the " + "decisions (and why), the artifacts, the verified facts, the open questions and the single next " + "step, then END YOUR TURN. The plugin compacts this agent's context and promotes it (or reseeds it " + "from that handoff), so anything you did not write down is lost. `cellwork_send` and " + "`cellwork_inbox` are refused here too, so a structured `question` cannot be asked or answered at a " + "checkpoint — the handoff's OPEN QUESTIONS are the channel. `cellwork_status` and " + "`cellwork_context` stay readable meanwhile.";
}
function subcaptainRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — this session is a SUBCAPTAIN of the cell: it builds and " + "dispatches the next-level team under the SAME rules as the captain, so it dispatches rather than works, " + "and it never edits a file, runs a shell, does reconnaissance or verifies. Allowed here: `cellwork_*` " + "except `cellwork_handoff`, `cellwork_start` and `cellwork_stop` (stage the sub-cell with " + "`cellwork_subteam`, materialise an accepted split with `cellwork_activate`, dispatch with " + "`cellwork_dispatch` and sweep with `cellwork_supervise`), `agent_teams_*`, `ask_user_question`, " + "`todo_write` and `mpd_memory_*`. Only the CAPTAIN opens or closes a cell: if this cell needs that, " + "send the request with `cellwork_send` and end your turn.";
}
function plannerRefusal(toolName, target) {
  return "cellwork: `" + toolName + "` on " + target + " is refused — this session is the CELL PLANNER, so" + " its reconnaissance is DELEGATED, never run itself: its context has to carry the interview and the" + " requirements document, and a source tree spent here is context the interview then lacks. Two" + ' read-only routes, both one-shot: `cellwork_recon` {role:"Explorer"|"Researcher", task} — its' + " report comes straight back, and the roster places the child one level below you as a leaf, so it is" + " never refused by the host's nesting default — or `mpd_role_spawn` with a read-only roster role" + " (Explorer, Researcher, Architect) when the cellwork tool is not mounted. The band stays open to" + " you: `.mpd/**`, `docs/**`," + " `evidence/**`, `agent-references/**`; any `AGENT.md`, `AGENTS.md` or `CLAUDE.md` at any depth, inside" + " this workspace or outside its root; and at the workspace root only `README.md`, `README.zh-CN.md`," + " `CHANGELOG.md` and `LICENSE*.md`.";
}
function plannerReadablePath(workspaceRoot, raw) {
  const posix = String(raw ?? "").replace(/\\/g, "/");
  if (posix === "")
    return false;
  if (isPlannerInstructionFile(posix))
    return true;
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = posix.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(posix);
  let rel;
  if (!absolute)
    rel = posix.startsWith("./") ? posix.slice(2) : posix;
  else if (root !== "" && posix.startsWith(root + "/"))
    rel = posix.slice(root.length + 1);
  if (rel === undefined || rel === "")
    return false;
  if (rel.split("/").includes(".."))
    return false;
  const inBand = PLANNER_READABLE_PREFIXES.some((prefix) => rel.startsWith(prefix) || rel === prefix.replace(/\/$/, ""));
  if (inBand)
    return true;
  if (PLANNER_READABLE_ROOT_FILES.includes(rel))
    return true;
  return rel.indexOf("/") === -1 && PLANNER_LICENSE_PATTERN.test(rel);
}
function isPlannerInstructionFile(path) {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "")
    return false;
  return PLANNER_INSTRUCTION_BASENAMES.some((name) => name.toLowerCase() === base);
}
var PLANNER_PATH_ARG_KEYS = ["file_path", "path", "filePath", "target"];
function plannerTargetPath(args) {
  for (const key of PLANNER_PATH_ARG_KEYS) {
    const value = args?.[key];
    if (typeof value === "string" && value !== "")
      return value;
  }
  return;
}
function isPlannerSeat(seat) {
  return seat.name.trim().toLowerCase() === PLANNER_SEAT_NAME;
}
function cellworkGuardDecision(seat, toolName, call) {
  if (seat === undefined)
    return;
  if (toolName === "")
    return;
  if (seat.mode === "captain")
    return isCaptainAllowed(toolName) ? undefined : captainRefusal(toolName);
  if (seat.mode === "verifier") {
    if (VERIFIER_DENY_TOOLS.includes(toolName) && !VERIFIER_NO_DELEGATION.includes(toolName))
      return verifierRefusal(toolName);
    if (VERIFIER_NO_DELEGATION.includes(toolName))
      return verifierDelegationRefusal(toolName);
    return;
  }
  if (seat.mode === "checkpoint")
    return CHECKPOINT_ALLOW_TOOLS.includes(toolName) ? undefined : checkpointRefusal(toolName);
  if (seat.mode === "subcaptain")
    return isSubcaptainAllowed(toolName) ? undefined : subcaptainRefusal(toolName);
  if (seat.mode === "member" && isPlannerSeat(seat)) {
    if (!PLANNER_RECON_TOOLS.includes(toolName))
      return;
    const raw = plannerTargetPath(call?.args);
    if (raw === undefined)
      return plannerRefusal(toolName, "(no path argument — a bare call searches the whole workspace)");
    if (plannerReadablePath(call?.workspaceRoot ?? "", raw))
      return;
    return plannerRefusal(toolName, JSON.stringify(raw));
  }
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
        const seat = options.seatOf(exec);
        return cellworkGuardDecision(seat, toolName, {
          args: exec?.arguments,
          workspaceRoot: pathBandRootOf(dsh, seat, toolName, exec)
        });
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
function pathBandRootOf(dsh, seat, toolName, exec) {
  if (seat === undefined || seat.mode !== "member" || !isPlannerSeat(seat) || !PLANNER_RECON_TOOLS.includes(toolName))
    return "";
  try {
    return dsh.workspaceRoot(exec);
  } catch {
    return "";
  }
}

// packages/mpd-cellwork-plugin/src/prompts.ts
var CELLWORK_USAGE = "usage: /cellwork <objective> — starts cell-work for that objective: a dedicated " + "planner runs a Socratic requirements interview through you, the requirements are split into tasks whose " + "context cost the plugin MEASURES against the executing model's own window, and the team works, hands off, " + "compacts and promotes itself. `/cellwork` is the only way to start the mode.";
var PLANNER_RECON_LINES = [
  "",
  "RECONNAISSANCE IS DELEGATED, NEVER RUN BY YOU: do not `read`, `grep` or `glob` the project's source",
  "yourself — the cellwork guard refuses exactly that (its refusal names the two routes below), and with",
  "reason. Your context is spent on the interview and the requirements document: a source tree read here is",
  "context the interview then lacks, while the REPORT you actually need is a hundred lines, not ten thousand.",
  "",
  "THE ROUTES, all one-shot and READ-ONLY unless stated, and you consume the report rather than deriving it:",
  '1. `cellwork_recon` {role:"Explorer"|"Researcher", task} — the in-cell route. Its report comes straight',
  "   back to you and is journaled, and the roster places the child one level below you as a leaf, so the",
  "   host's nesting default never refuses it. `Explorer` finds the file and the code; `Researcher` collects",
  "   evidence.",
  "   BATCH: pass `questions:[q1, q2, …]` (1..8) instead of `task` and they run CONCURRENTLY — the call",
  "   returns when all are settled, one report per question, so an interview's fact-finding costs one call.",
  "2. `cellwork_delegate` {tasks:[{role, task, context?}, …]} — BACKGROUND, 1..16 at once, ANY roster role",
  "   (writers included). It returns the `consultId`s immediately and the children keep working while you",
  '   do; settle them with `cellwork_consult {action:"list"|"wait"|"collect"|"cancel"}`. Use it when',
  "   the work is side-work you do not have to read before the next question.",
  '3. `mpd_role_spawn` {role:"Explorer"|"Researcher"|"Architect", task} — the roster route, for a',
  "   composition where the cellwork tools are not mounted. Same discipline: ONE bounded question, one report.",
  "",
  "THE BAND YOU MAY READ YOURSELF: `.mpd/**` (the cell record, the requirements file, the contracts),",
  "`docs/**`, `evidence/**`, `agent-references/**`; any `AGENT.md`, `AGENTS.md` or `CLAUDE.md` at any depth,",
  "inside this workspace or outside its root; and at the workspace root `README.md`, `README.zh-CN.md`,",
  "`CHANGELOG.md` and `LICENSE*.md`.",
  ""
];
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
    "YOUR TOOLS IN THIS MODE: `cellwork_*` except `cellwork_handoff`, `cellwork_delegate` and",
    "`cellwork_consult` (background delegation is a MEMBER's or a SUBCAPTAIN's call, not yours),",
    "`agent_teams_*`, `ask_user_question`,",
    "`todo_write`, `mpd_memory_*`. Everything else is refused, and `cellwork_stop` is how you leave.",
    "",
    "STATE ON DISK (this is the record, not a suggestion): " + dir,
    "  " + CELL_STATE_FILE + " · " + CELL_JOURNAL_FILE + " · " + CELL_REQUIREMENTS_FILE,
    "",
    "FIRST STEP: call `cellwork_start` now, then wait for the planner's first question."
  ].join(`
`);
}

// packages/mpd-cellwork-plugin/src/open.ts
import { existsSync as existsSync2 } from "node:fs";
import { join as join3 } from "node:path";
function mandateArtifact(workspace, mandate) {
  const runId = mandate.trim();
  if (runId === "")
    return { refusal: "cellwork_open: `mandate` names no run id — omit it, or pass the autoproject run whose escalation.json should authorise this cell" };
  if (runId.includes("/") || runId.includes("\\") || runId === "." || runId === "..") {
    return { refusal: "cellwork_open: `mandate` " + JSON.stringify(mandate) + " is not a run id — it must be ONE path segment under .mpd/autoproject" };
  }
  const path = join3(workspace, ".mpd", "autoproject", runId, "escalation.json");
  return existsSync2(path) ? { path } : { refusal: "cellwork_open: no escalation artifact at " + path + " — a mandated cell is opened ONLY from a real autoproject escalation, so nothing was written" };
}
function openCell(input) {
  const objective = input.objective.trim();
  if (objective === "")
    return { ok: false, error: "cellwork_open: `objective` is required — it is the user's own words for what the cell must build" };
  if (input.captainSessionId === "")
    return { ok: false, error: "cellwork_open refused: the caller carries no session id, so no captain can be recorded — nothing was written" };
  if (input.mandate !== undefined) {
    const mandate = mandateArtifact(input.workspace, input.mandate);
    if ("refusal" in mandate)
      return { ok: false, error: mandate.refusal };
  }
  const active = readActiveCell(input.workspace);
  if (!active.ok)
    return { ok: false, error: "cellwork_open refused: " + readFailureText(active), path: active.path };
  if (active.cell !== null) {
    return {
      ok: false,
      error: "cellwork_open refused: cell " + active.cell.state.cellId + " is still active in this workspace (phase " + active.cell.state.phase + ") — one cell at a time, and a second one would fight the first for the same team board. Read it with `cellwork_status`, finish it, or end it with `cellwork_stop` first."
    };
  }
  const created = newCellState({ cellId: freeCellId(input.workspace, input.now), objective, captainSessionId: input.captainSessionId, now: input.now });
  writeCell(input.workspace, created);
  recordTransition(input.workspace, created, { event: "start", phase: created.phase, objective, captainSessionId: created.captainSessionId }, input.now);
  const directive = activationDirective({ state: created, workspace: input.workspace });
  if (input.submit === undefined) {
    return { ok: true, cellId: created.cellId, phase: created.phase, statePath: join3(input.workspace, ".mpd", "cellwork", created.cellId, "state.json"), directive };
  }
  if (input.submit(directive) !== true) {
    recordTransition(input.workspace, { ...created, phase: "stopped", archived: true, stopReason: "no-live-turn-surface" }, { event: "stop", reason: "no-live-turn-surface", forced: false }, input.now);
    return { ok: false, error: "cellwork could not start: no live agent turn surface to submit the activation directive, so cell " + created.cellId + " was archived immediately and no mode is active" };
  }
  return { ok: true, cellId: created.cellId, phase: created.phase, statePath: join3(input.workspace, ".mpd", "cellwork", created.cellId, "state.json"), directive };
}
function readFailureText(failure) {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first";
}

// packages/mpd-cellwork-plugin/src/requirements.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
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
  const lines = text.split(`
`);
  const headings = [];
  for (let index = 0;index < lines.length; index += 1) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[index]);
    if (match !== null)
      headings.push({ line: index, level: match[1].length, key: normalizeHeading(match[2]) });
  }
  for (let position = 0;position < headings.length; position += 1) {
    const heading = headings[position];
    const closing = headings.slice(position + 1).find((candidate) => candidate.level <= heading.level);
    const body = lines.slice(heading.line + 1, closing === undefined ? lines.length : closing.line).join(`
`).trim();
    if (!sections.has(heading.key))
      sections.set(heading.key, body);
  }
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
  if (!existsSync3(path))
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
import { existsSync as existsSync4, readdirSync as readdirSync2, readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// packages/mpd-cellwork-plugin/src/budget.ts
import { closeSync as closeSync2, openSync as openSync2, readSync, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve as resolve3 } from "node:path";
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
  const absolute = isAbsolute2(trimmed) ? resolve3(trimmed) : resolve3(join4(workspace, trimmed));
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
  return role.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
var MEMBER_NAME_MAX_CHARS = 64;
function memberProblem(member) {
  const name = member.trim();
  if (name === "")
    return "member is empty — name the board member this task is raised for, or omit `member` to use the owner role";
  if (name.length > MEMBER_NAME_MAX_CHARS)
    return "member " + JSON.stringify(name) + " is longer than " + String(MEMBER_NAME_MAX_CHARS) + " characters";
  if (/[\u0000-\u001f\u007f/\\]/.test(name))
    return "member " + JSON.stringify(name) + " contains a control character or a path separator";
  if (roleKey(name) === "")
    return "member " + JSON.stringify(name) + " has no identity: the activation key (letters and digits, in any script) is empty, so it would collapse into ONE seat with every other such name — include at least one letter or digit";
  return null;
}
function resolvedMember(task) {
  return (task.member ?? task.ownerRole).trim();
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
var SCOPE_REQUIRED_KINDS = ["work", "repair", "integration"];
function writeScopeWarnings(tasks) {
  const warnings = [];
  for (const task of tasks) {
    if (!SCOPE_REQUIRED_KINDS.includes(task.kind ?? "work"))
      continue;
    if (task.writeScopes.some((scope) => scope.trim() !== ""))
      continue;
    warnings.push({
      taskKey: task.key,
      code: "write-scopes-empty",
      detail: "task " + JSON.stringify(task.key) + " (" + (task.kind ?? "work") + ") declares NO write scope, so its frozen contract allows no path and its writer must stop at the first edit — declare `writeScopes` now, or ask the captain for a scope extension BEFORE the first write"
    });
  }
  return warnings;
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
    if (task.member !== undefined) {
      const memberReason = memberProblem(task.member);
      if (memberReason !== null)
        findings.push({ taskKey: task.key, code: "member-invalid", detail: memberReason });
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
  const memberRoles = new Map;
  for (const task of tasks) {
    if (task.member !== undefined && memberProblem(task.member) !== null)
      continue;
    const name = resolvedMember(task);
    const identity = roleKey(name);
    const entry = memberRoles.get(identity);
    if (entry === undefined) {
      memberRoles.set(identity, { roles: new Map([[roleKey(task.ownerRole), task.ownerRole]]), keys: [task.key], display: name });
    } else {
      entry.roles.set(roleKey(task.ownerRole), task.ownerRole);
      entry.keys.push(task.key);
    }
  }
  for (const entry of memberRoles.values()) {
    if (entry.roles.size <= 1)
      continue;
    findings.push({ taskKey: entry.keys[0], code: "member-role-conflict", detail: "tasks " + entry.keys.map((key) => JSON.stringify(key)).join(", ") + " all resolve to ONE board member (" + JSON.stringify(entry.display) + ") but declare DIFFERENT owner roles (" + [...entry.roles.values()].map((role) => JSON.stringify(role)).join(", ") + ") — one member has one role; declare a separate member per role, or align the owner roles" });
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
    if (task.member !== undefined || reviews[0].member !== undefined) {
      const workIdentity = roleKey(resolvedMember(task));
      const reviewIdentity = roleKey(resolvedMember(reviews[0]));
      if (workIdentity === reviewIdentity) {
        findings.push({ taskKey: task.key, code: "self-review", detail: "the review task " + JSON.stringify(reviews[0].key) + " resolves to the SAME board member as the work it reviews (" + JSON.stringify(resolvedMember(task)) + ", identity " + JSON.stringify(workIdentity) + ") — the verifier must be a different member" });
      }
    } else if (roleKey(reviews[0].ownerRole) === roleKey(task.ownerRole)) {
      findings.push({ taskKey: task.key, code: "self-review", detail: "the review task " + JSON.stringify(reviews[0].key) + " is owned by the SAME role as the work it reviews (" + JSON.stringify(task.ownerRole) + ") — the verifier must be a different declared role" });
    }
  }
  return findings;
}
async function submitSplit(deps, submission) {
  const findings = validateGraph(submission.tasks, deps.roster);
  const warnings = writeScopeWarnings(submission.tasks);
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
      member: resolvedMember(task),
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
    warnings,
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
  const file = accepted ? canonical : refusedSplitPath(deps.workspace, deps.cellId, submission.revision);
  const persisted = { ...verdict, file };
  atomicWriteText(file, JSON.stringify(persisted, null, 2) + `
`);
  return persisted;
}
function readVerdictFile(path) {
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
  if (!Array.isArray(verdict.warnings))
    verdict.warnings = [];
  return { ok: true, verdict };
}
function readSplit(workspace, cellId, revision) {
  return readVerdictFile(splitPath(workspace, cellId, revision));
}
function latestSplit(workspace, cellId) {
  const dir = dirname2(splitPath(workspace, cellId, 0));
  let entries = [];
  try {
    entries = readdirSync2(dir);
  } catch {
    return null;
  }
  let latest = 0;
  for (const entry of entries) {
    const match = /^(\d+)(?:\.refused)?\.json$/.exec(entry);
    if (match === null)
      continue;
    const revision = Number(match[1]);
    if (Number.isInteger(revision) && revision > latest)
      latest = revision;
  }
  if (latest === 0)
    return null;
  const canonical = splitPath(workspace, cellId, latest);
  return { revision: latest, read: readVerdictFile(existsSync4(canonical) ? canonical : refusedSplitPath(workspace, cellId, latest)) };
}
function errorText3(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-cellwork-plugin/src/consults.ts
var DELEGATE_MAX_TASKS = 16;
var CONSULT_WAIT_DEFAULT_MS = 30000;
var CONSULT_WAIT_MAX_MS = 60000;
var JOURNAL_TASK_CHARS = 400;
var CONSULT_TASK_CHARS = 200;
var CONSULT_ACTIONS = ["list", "wait", "collect", "cancel"];
function createConsultBook() {
  return new Map;
}
function consultSeatRefusal(toolName, seat) {
  if (seat === undefined) {
    return "cellwork: `" + toolName + "` is refused — this session is not a recorded member of the running" + " cell. The two consult verbs belong to the cell PLANNER (seat `cell-planner`), a promoted" + " SUBCAPTAIN, and an ordinary recorded MEMBER of the cell; the captain dispatches instead, and a" + " session the cell record never learned has no channel here. Read `cellwork_status` to see whether" + " this session holds a seat.";
  }
  if (seat.mode === "captain")
    return captainRefusal(toolName);
  if (seat.mode === "verifier")
    return verifierDelegationRefusal(toolName);
  if (seat.mode === "checkpoint")
    return checkpointRefusal(toolName);
  return;
}
function consultRowOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const record = value;
  const consultId = typeof record.consultId === "string" ? record.consultId : "";
  if (consultId === "")
    return;
  const state = typeof record.state === "string" ? record.state : typeof record.status === "string" ? record.status : "running";
  const report = reportRowOf(record.report);
  return {
    consultId,
    role: typeof record.role === "string" ? record.role : "",
    state,
    startedAt: wholeNumber(record.startedAt),
    elapsedMs: wholeNumber(record.elapsedMs),
    ...typeof record.handoff === "string" && record.handoff !== "" ? { handoff: record.handoff } : {},
    ...report === undefined ? {} : { report },
    ...typeof record.error === "string" && record.error !== "" ? { error: record.error } : {}
  };
}
function reportRowOf(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const record = value;
  return {
    role: typeof record.role === "string" ? record.role : "",
    status: typeof record.status === "string" ? record.status : "complete",
    summary: typeof record.summary === "string" ? record.summary : "",
    recommendation: typeof record.recommendation === "string" ? record.recommendation : "",
    details: typeof record.details === "string" ? record.details : "",
    evidence: Array.isArray(record.evidence) ? record.evidence.map((entry) => String(entry)) : [],
    stopReason: typeof record.stopReason === "string" ? record.stopReason : null,
    consultId: typeof record.consultId === "string" ? record.consultId : "",
    elapsedMs: wholeNumber(record.elapsedMs),
    ...typeof record.handoff === "string" && record.handoff !== "" ? { handoff: record.handoff } : {},
    ...typeof record.lastActivity === "string" && record.lastActivity !== "" ? { lastActivity: record.lastActivity } : {}
  };
}
function wholeNumber(value) {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
function missingConsultsServiceRefusal(toolName) {
  return "cellwork: `" + toolName + "` is refused — the `mpdConsults` service is ABSENT from this" + " composition, so no supervised consult can be started or settled. It is provided by the" + " `mpd-roles` row over that row's ONE consult supervisor (the shared `MPD_DSH_CONSULT_MAX` cap and" + " the silence deadman live there); mount that row — there is no unsupervised fallback. The BLOCKING" + " `cellwork_recon` route needs it too, and `mpd_role_spawn` stays available for a one-shot consult.";
}
function missingRosterRefusal() {
  return "cellwork: the roster service (`mpdRoles`) is absent or empty in this composition, so a role" + " spelling cannot be canonicalised — mount the `mpd-roles` row and resubmit.";
}
function readDelegateTasks(raw) {
  if (!Array.isArray(raw))
    return { ok: false, error: "cellwork_delegate: `tasks` must be an array of 1.." + String(DELEGATE_MAX_TASKS) + " `{role, task}` objects — nothing was started" };
  if (raw.length === 0)
    return { ok: false, error: "cellwork_delegate: `tasks` is empty — name at least one `{role, task}` to start; nothing was started" };
  if (raw.length > DELEGATE_MAX_TASKS)
    return { ok: false, error: "cellwork_delegate: `tasks` carries " + String(raw.length) + " entries, more than the " + String(DELEGATE_MAX_TASKS) + " this call starts — split it into batches; nothing was started" };
  const tasks = [];
  for (let index = 0;index < raw.length; index += 1) {
    const entry = raw[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "] is not an object — every entry is `{role, task, context?}`; nothing was started" };
    const record = entry;
    const role = typeof record.role === "string" ? record.role.trim() : "";
    if (role === "")
      return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].role is empty — name a roster role (see `mpd_roles_list`); nothing was started" };
    const task = typeof record.task === "string" ? record.task.trim() : "";
    if (task === "")
      return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].task is empty — one consult answers one concrete assignment; nothing was started" };
    if (record.context !== undefined && typeof record.context !== "string")
      return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].context must be a string when present; nothing was started" };
    tasks.push({ role, task, ...typeof record.context === "string" && record.context !== "" ? { context: record.context } : {} });
  }
  return { tasks };
}
function consultStateOf(value) {
  return value === "complete" || value === "interrupted" || value === "failed" || value === "cancelled" || value === "running" ? value : "running";
}
function consultFinishedAtOf(row) {
  if (Number.isFinite(row.elapsedMs) && row.elapsedMs > 0 && Number.isFinite(row.startedAt) && row.startedAt > 0)
    return row.startedAt + row.elapsedMs;
  return Date.now();
}
async function recordConsultRow(deps, row, task) {
  if (deps.teamId === "") {
    appendJournal(deps.workspace, deps.cellId, { event: "consult-unattached", consultId: row.consultId, role: row.role }, deps.now);
    return;
  }
  const plane = deps.teamActions();
  if (plane?.upsertConsult === undefined) {
    appendJournal(deps.workspace, deps.cellId, { event: "consult-unrecorded", consultId: row.consultId, reason: "this composition exposes no mpdTeamActions.upsertConsult seam" }, deps.now);
    return;
  }
  try {
    const answer = await Promise.resolve(plane.upsertConsult({
      workspace: deps.workspace,
      teamId: deps.teamId,
      record: {
        consultId: row.consultId,
        role: row.role,
        task: task.slice(0, CONSULT_TASK_CHARS),
        cellId: deps.cellId,
        startedAt: row.startedAt,
        state: consultStateOf(row.state),
        ...row.state === "running" ? {} : { finishedAt: consultFinishedAtOf(row), elapsedMs: row.elapsedMs },
        ...row.handoff === undefined ? {} : { handoff: row.handoff }
      }
    }));
    const refusal = typeof answer === "object" && answer !== null && answer.ok === false ? String(answer.error ?? "unknown refusal") : "";
    if (refusal !== "")
      appendJournal(deps.workspace, deps.cellId, { event: "consult-unrecorded", consultId: row.consultId, reason: refusal }, deps.now);
  } catch (error) {
    appendJournal(deps.workspace, deps.cellId, { event: "consult-unrecorded", consultId: row.consultId, reason: error instanceof Error ? error.message : String(error) }, deps.now);
  }
}
function settlementObserverOf(deps) {
  return (outcome) => {
    const row = consultRowOf(outcome);
    if (row === undefined)
      return;
    if (!deps.book.has(deps.cellId)) {
      appendJournal(deps.workspace, deps.cellId, { event: "consult-late-settlement", consultId: row.consultId }, deps.now);
      return;
    }
    const task = ownedConsult(deps.book, deps.cellId, row.consultId)?.question ?? "";
    recordConsultRow(deps, row, task);
  };
}
async function startDelegation(deps, rawTasks) {
  const parsed = readDelegateTasks(rawTasks);
  if ("ok" in parsed)
    return parsed;
  const service = deps.service();
  if (service?.start === undefined || typeof service.canonicalRole !== "function")
    return { ok: false, error: missingConsultsServiceRefusal("cellwork_delegate") };
  if (deps.rosterNames().length === 0)
    return { ok: false, error: missingRosterRefusal() };
  const roles = [];
  for (let index = 0;index < parsed.tasks.length; index += 1) {
    const answer = (() => {
      try {
        return service.canonicalRole?.(parsed.tasks[index].role, deps.exec);
      } catch {
        return;
      }
    })();
    const canonical = typeof answer === "string" && answer !== "" ? answer : undefined;
    if (canonical === undefined)
      return { ok: false, error: "cellwork_delegate: tasks[" + String(index) + "].role " + JSON.stringify(parsed.tasks[index].role) + " names no roster role — use a roster NAME as `mpd_roles_list` spells it (any case, space, hyphen or underscore spelling); nothing was started" };
    roles.push(canonical);
  }
  const consults = [];
  for (let index = 0;index < parsed.tasks.length; index += 1) {
    const task = parsed.tasks[index];
    try {
      const answer = await service.start({
        role: roles[index],
        task: task.task,
        ...task.context === undefined ? {} : { context: task.context },
        exec: deps.exec,
        onSettled: settlementObserverOf(deps)
      });
      const row = consultRowOf(answer);
      if (row === undefined)
        return { ok: false, error: "cellwork_delegate: the `mpdConsults` service answered tasks[" + String(index) + "] without a consultId — " + String(consults.length) + " of " + String(parsed.tasks.length) + " consults were already started (" + consults.map((entry) => entry.consultId).join(", ") + "); collect them with `cellwork_consult`" };
      consults.push({ consultId: row.consultId, role: row.role === "" ? roles[index] : row.role, startedAt: row.startedAt });
      rememberConsult(deps.book, deps.cellId, { consultId: row.consultId, role: row.role === "" ? roles[index] : row.role, startedAt: row.startedAt, question: task.task });
      appendJournal(deps.workspace, deps.cellId, {
        event: "delegate-start",
        role: row.role === "" ? roles[index] : row.role,
        consultId: row.consultId,
        question: task.task.slice(0, JOURNAL_TASK_CHARS)
      }, deps.now);
      await recordConsultRow(deps, { ...row, role: row.role === "" ? roles[index] : row.role }, task.task);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: "cellwork_delegate: starting tasks[" + String(index) + "] (" + roles[index] + ") failed: " + message + " — " + String(consults.length) + " of " + String(parsed.tasks.length) + " consults were already started" + (consults.length === 0 ? "" : " (" + consults.map((entry) => entry.consultId).join(", ") + "); collect them with `cellwork_consult`") };
    }
  }
  return { ok: true, started: consults.length, consults };
}
function rememberConsult(book, cellId, owned) {
  const own = book.get(cellId) ?? new Map;
  own.set(owned.consultId, owned);
  book.set(cellId, own);
}
function forgetConsult(book, cellId, consultId) {
  return book.get(cellId)?.delete(consultId) === true;
}
function ownedConsult(book, cellId, consultId) {
  return book.get(cellId)?.get(consultId);
}
function taskOfConsult(deps, consultId) {
  return ownedConsult(deps.book, deps.cellId, consultId)?.question ?? "";
}
async function clearCellConsults(deps) {
  const owned = [...deps.book.get(deps.cellId)?.keys() ?? []];
  deps.book.delete(deps.cellId);
  const service = deps.consults();
  for (const consultId of owned) {
    try {
      if (typeof service?.cancel !== "function") {
        appendJournal(deps.workspace, deps.cellId, { event: "consult-cancel-skipped", consultId, reason: "this composition exposes no mpdConsults.cancel seam" }, deps.now);
        continue;
      }
      await Promise.resolve(service.cancel(consultId));
      appendJournal(deps.workspace, deps.cellId, { event: "consult-cancelled", consultId, by: "stop" }, deps.now);
    } catch (error) {
      appendJournal(deps.workspace, deps.cellId, { event: "consult-cancel-skipped", consultId, reason: error instanceof Error ? error.message : String(error) }, deps.now);
    }
  }
  if (deps.teamId === "")
    return [];
  const plane = deps.teamActions();
  if (plane?.clearConsults === undefined) {
    if (owned.length > 0)
      appendJournal(deps.workspace, deps.cellId, { event: "consult-clear-skipped", reason: "this composition exposes no mpdTeamActions.clearConsults seam", count: owned.length }, deps.now);
    return [];
  }
  try {
    const answer = await Promise.resolve(plane.clearConsults({ workspace: deps.workspace, teamId: deps.teamId }));
    const cleared = Array.isArray(answer?.cleared) ? answer.cleared.map((id) => String(id)) : [];
    appendJournal(deps.workspace, deps.cellId, { event: "consult-cleared", count: cleared.length }, deps.now);
    return cleared;
  } catch (error) {
    appendJournal(deps.workspace, deps.cellId, { event: "consult-clear-skipped", reason: error instanceof Error ? error.message : String(error) }, deps.now);
    return [];
  }
}
function foreignConsultRefusal(toolName, consultId, cellId) {
  return "cellwork: `" + toolName + "` refused " + JSON.stringify(consultId) + " — this cell did not start" + " that consult, so it is not this cell's to settle. `cellwork_consult` answers only ids that" + " `cellwork_delegate` returned IN CELL " + cellId + " and that the consult supervisor still knows:" + " an id from `mpd_role_spawn_async` belongs to `mpd_role_consult`, a consult another cell started" + " belongs to that cell, and a process restart drops every in-memory handle — re-delegate the task" + " with `cellwork_delegate` when you need it again.";
}
function successOf(action, row) {
  const { error, ...rest } = row;
  return { ok: true, action, ...rest, ...error === undefined ? {} : { errorDetail: error } };
}
async function runConsultAction(deps, args) {
  const action = args.action.trim();
  if (!CONSULT_ACTIONS.includes(action))
    return { ok: false, error: "cellwork_consult: action must be `list`, `wait`, `collect` or `cancel` (got " + JSON.stringify(args.action) + ")" };
  const service = deps.service();
  if (service === undefined)
    return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") };
  if (action === "list") {
    if (typeof service.list !== "function")
      return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") };
    const answer = await Promise.resolve(service.list());
    const live = (Array.isArray(answer) ? answer : []).map((entry) => consultRowOf(entry)).filter((entry) => entry !== undefined);
    const own = deps.book.get(deps.cellId) ?? new Map;
    const consults = [];
    for (const owned of [...own.values()]) {
      const row = live.find((entry) => entry.consultId === owned.consultId);
      if (row === undefined) {
        forgetConsult(deps.book, deps.cellId, owned.consultId);
        continue;
      }
      consults.push({ consultId: row.consultId, role: row.role === "" ? owned.role : row.role, state: row.state, startedAt: row.startedAt, elapsedMs: row.elapsedMs, question: owned.question });
    }
    return { ok: true, action, consults };
  }
  const consultId = args.consultId.trim();
  if (consultId === "")
    return { ok: false, error: 'cellwork_consult: `consultId` is required for action "' + action + '" — use the id `cellwork_delegate` returned, or action "list" to see this cell\'s ids' };
  if (ownedConsult(deps.book, deps.cellId, consultId) === undefined)
    return { ok: false, error: foreignConsultRefusal("cellwork_consult", consultId, deps.cellId) };
  try {
    if (action === "wait") {
      if (typeof service.wait !== "function")
        return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") };
      const bound = args.timeoutMs === undefined ? CONSULT_WAIT_DEFAULT_MS : Math.min(CONSULT_WAIT_MAX_MS, Math.max(1, Math.trunc(Number(args.timeoutMs)) || 1));
      const row2 = consultRowOf(await service.wait(consultId, bound));
      if (row2 === undefined)
        return { ok: false, error: "cellwork_consult: the `mpdConsults` service answered `wait` without a consult view for " + JSON.stringify(consultId) };
      await recordConsultRow(deps, row2, ownedConsult(deps.book, deps.cellId, consultId)?.question ?? "");
      return successOf(action, row2);
    }
    if (action === "collect") {
      if (typeof service.collect !== "function")
        return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") };
      const row2 = consultRowOf(await Promise.resolve(service.collect(consultId)));
      if (row2 === undefined) {
        forgetConsult(deps.book, deps.cellId, consultId);
        return { ok: false, error: foreignConsultRefusal("cellwork_consult", consultId, deps.cellId) };
      }
      const remembered = taskOfConsult(deps, consultId);
      if (row2.state !== "running")
        forgetConsult(deps.book, deps.cellId, consultId);
      await recordConsultRow(deps, row2, remembered);
      return successOf(action, row2);
    }
    if (typeof service.cancel !== "function")
      return { ok: false, error: missingConsultsServiceRefusal("cellwork_consult") };
    const row = consultRowOf(await Promise.resolve(service.cancel(consultId)));
    if (row === undefined)
      return { ok: false, error: "cellwork_consult: the `mpdConsults` service answered `cancel` without a consult view for " + JSON.stringify(consultId) };
    appendJournal(deps.workspace, deps.cellId, { event: "consult-cancelled", role: row.role, consultId }, deps.now);
    await recordConsultRow(deps, row, taskOfConsult(deps, consultId));
    return successOf(action, row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: "cellwork_consult: `" + action + "` on " + JSON.stringify(consultId) + " failed: " + message };
  }
}

// packages/mpd-cellwork-plugin/src/recon.ts
var RECON_ROLES = ["Explorer", "Researcher"];
var JOURNAL_REPORT_CHARS = 2000;
var RECON_MAX_QUESTIONS = 8;
function canonicalReconRole(role) {
  const wanted = role.trim().toLowerCase();
  return RECON_ROLES.find((candidate) => candidate.toLowerCase() === wanted);
}
function reconContext(deps) {
  return [
    "Cell " + deps.cell.cellId + " is in its planning phase. Answer the ONE question below from the repository",
    "itself: read files, search, and cite what you found by path. You cannot write, edit or run a shell;",
    "that is the point of this consult.",
    "",
    "RETURN: the evidence you found (paths and the few relevant excerpts), then a direct answer. If the",
    "question is unanswerable from the tree, say exactly what is missing rather than guessing."
  ].join(`
`);
}
function questionsOf(input) {
  const hasTask = typeof input.task === "string";
  const hasQuestions = Array.isArray(input.questions);
  if (hasTask === hasQuestions)
    return { error: "cellwork_recon: supply EXACTLY ONE of `task` (one question) or `questions` (1.." + String(RECON_MAX_QUESTIONS) + " questions)" };
  if (hasTask) {
    const task = String(input.task ?? "").trim();
    if (task === "")
      return { error: "cellwork_recon: the task/question is empty — one consult answers one concrete question" };
    return { questions: [task] };
  }
  const declared = Array.isArray(input.questions) ? input.questions : [];
  if (declared.length === 0)
    return { error: "cellwork_recon: `questions` is empty — ask at least one question" };
  if (declared.length > RECON_MAX_QUESTIONS)
    return { error: "cellwork_recon: `questions` carries " + String(declared.length) + " entries, more than the " + String(RECON_MAX_QUESTIONS) + " one call settles — split it into batches" };
  const questions = [];
  for (let index = 0;index < declared.length; index += 1) {
    const entry = declared[index];
    const text = typeof entry === "string" ? entry.trim() : "";
    if (text === "")
      return { error: "cellwork_recon: questions[" + String(index) + "] is empty — every question must be a non-empty string" };
    questions.push(text);
  }
  return { questions };
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
  const asked = questionsOf(input);
  if ("error" in asked)
    return { ok: false, error: asked.error };
  const service = deps.consults;
  if (service?.start === undefined || service.settle === undefined || service.collect === undefined) {
    return { ok: false, error: missingConsultsServiceRefusal("cellwork_recon") };
  }
  const persona = deps.personaFor(label);
  const context = reconContext(deps);
  const starts = [];
  for (const question of asked.questions) {
    try {
      const answer = await service.start({ role: label, task: question, context, exec: deps.exec });
      const view = consultRowOf(answer);
      if (view === undefined)
        starts.push({ question, failure: "the `mpdConsults` service answered without a consultId" });
      else
        starts.push({ question, consultId: view.consultId });
    } catch (error) {
      starts.push({ question, failure: error instanceof Error ? error.message : String(error) });
    }
  }
  const reports = await Promise.all(starts.map(async (start) => {
    if (start.consultId === undefined)
      return { question: start.question, report: "cellwork_recon: starting the " + label + " consult failed: " + String(start.failure ?? "unknown error"), stopReason: "failed" };
    try {
      await service.settle?.(start.consultId);
      const outcome = consultRowOf(await Promise.resolve(service.collect?.(start.consultId)));
      const report = reportRowOf(outcome?.report);
      if (report === undefined) {
        return { question: start.question, report: "cellwork_recon: the " + label + " consult for this question failed: " + String(outcome?.error ?? "the supervisor released no report"), stopReason: "failed" };
      }
      return {
        question: start.question,
        report: report.summary,
        stopReason: report.stopReason,
        ...report.status === "interrupted" ? { interrupted: true } : {},
        ...report.handoff === undefined ? {} : { handoff: report.handoff }
      };
    } catch (error) {
      return { question: start.question, report: "cellwork_recon: settling the " + label + " consult failed: " + (error instanceof Error ? error.message : String(error)), stopReason: "failed" };
    }
  }));
  for (const row of reports) {
    appendJournal(deps.workspace, deps.cell.cellId, {
      event: row.stopReason === "failed" ? "recon-failed" : "recon",
      role: label,
      question: row.question.slice(0, 400),
      reportChars: row.report.length,
      excerpt: row.report.slice(0, JOURNAL_REPORT_CHARS),
      stopReason: row.stopReason,
      personaInjected: persona !== null
    }, deps.now);
  }
  const single = reports.length === 1 ? reports[0] : undefined;
  const legacyOnly = input.task !== undefined && asked.questions.length === 1;
  return {
    ok: true,
    role: label.toLowerCase(),
    label,
    personaInjected: persona !== null,
    ...single === undefined ? { reports } : legacyOnly ? { report: single.report, stopReason: single.stopReason } : { reports, report: single.report, stopReason: single.stopReason }
  };
}

// packages/mpd-cellwork-plugin/src/activate.ts
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "node:fs";

// packages/mpd-cellwork-plugin/src/dispatch.ts
function nameKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function resolveMemberName(members, name) {
  const entries = Object.entries(members);
  const byKey = entries.find(([key2]) => key2 === name);
  if (byKey !== undefined)
    return { key: byKey[0], member: byKey[1] };
  const byName = entries.find(([, member]) => member.name === name);
  if (byName !== undefined)
    return { key: byName[0], member: byName[1] };
  const key = nameKey(name);
  if (key === "")
    return;
  const normalized = entries.filter(([entryKey, member]) => nameKey(entryKey) === key || nameKey(member.name) === key);
  return normalized.length === 1 ? { key: normalized[0][0], member: normalized[0][1] } : undefined;
}
function fenceReasonOf(member) {
  if (member === undefined)
    return;
  if (member.fenced === true) {
    return "the compaction barrier gave up and fenced it" + (typeof member.fencedReason === "string" && member.fencedReason !== "" ? " (" + member.fencedReason + ")" : "");
  }
  if (member.mode === "checkpoint")
    return "its mode is `checkpoint` — the seat is fenced to the handoff tools until the barrier compacts it";
  if (member.handoffReady === true)
    return "a handoff is already written and waiting for the compaction barrier";
  if (member.mode === "subcaptain")
    return "the compaction barrier reopened it onto a fresh child (`subcaptain`), so it counts as working only while that child is a live agent";
  return;
}
function contractRelativePath(cellId, boardId) {
  return [".mpd", "cellwork", cellId, "contracts", boardId + ".md"].join("/");
}
function sendThroughExecutor(executor, captainAgent) {
  if (executor === undefined || typeof executor.send !== "function")
    return;
  return async (handle, content) => {
    await executor.send(captainAgent, handle, content);
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
    '- Ask the captain with ONE STRUCTURED question: `cellwork_send {to:"captain", subject, body, kind:"question",',
    '  options:[{label:"A. …"},{label:"B. …"}]}`. The offered labels are what the captain relays to the user,',
    "  so give every label its own ordinal (`A. …`, `B. …`) and state in `body` what you need decided.",
    "- Read the captain's reply with `cellwork_inbox`: it renders the `answer` block with the selected label(s)",
    '  VERBATIM. Answer the captain the same way: `kind:"answer", replyTo:<the question\'s message id>, selected:[…]`.',
    "- Then WAIT for the captain's answer. Do not invent an answer, do not proceed on an assumption.",
    "- If reconnaissance is needed before you can ask a good question, call `cellwork_recon`",
    '  {role:"Explorer"|"Researcher", task} — a one-shot READ-ONLY consult; you get its report back. Pass',
    "  `questions:[…]` (1..8) instead of `task` to settle several at once.",
    "  For side-work you do not have to read immediately, `cellwork_delegate` starts 1..16 BACKGROUND consults",
    "  in one call and returns their ids; collect them with `cellwork_consult`.",
    ...PLANNER_RECON_LINES,
    "THE DOCUMENT: write `<cell>/requirements.md` under the cell directory with these headings exactly:",
    "  ## Goal · ## Non-goals · ## Users / consumers · ## Constraints · ## Acceptance criteria · ## Open questions",
    "Every section must carry real content; an empty section will be refused.",
    'Then call `cellwork_requirements {action:"finalize"}` (pass `content` instead of writing the file if that',
    "is easier). A finalized revision unblocks the splitter.",
    "",
    "YOUR TOOLS: `cellwork_recon`, `cellwork_delegate`, `cellwork_consult`, `cellwork_requirements`,",
    "`cellwork_status`, `cellwork_send`/`agent_teams_mail`.",
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
    const ticket2 = await resolveSplitTicket(deps, existingTeamId, "", false);
    if (ticket2.boardReadable && ticket2.splitTaskId === "")
      return { ok: false, error: "the planning team " + existingTeamId + " is on this cell's record but " + ticket2.repairError, teamId: existingTeamId, planName: "cell " + deps.cell.cellId, partial: true };
    return {
      ok: true,
      alreadyStaged: true,
      teamId: existingTeamId,
      tasks: { splitId: ticket2.splitTaskId },
      ...ticket2.ownerRepaired ? { ownerRepaired: true } : {},
      ...ticket2.repairError === "" ? {} : { ownerRepairError: ticket2.repairError },
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
    const recoveredTicket = await resolveSplitTicket(deps, recoveredId, "", false);
    if (recoveredTicket.boardReadable && recoveredTicket.splitTaskId === "")
      return { ok: false, error: "the planning team " + recoveredId + " is approved but " + recoveredTicket.repairError, teamId: recoveredId, members: recovered, planName, partial: true };
    return { ok: true, alreadyStaged: true, teamId: recoveredId, members: recovered, tasks: { splitId: recoveredTicket.splitTaskId }, planName, ...recoveredTicket.ownerRepaired ? { ownerRepaired: true } : {}, ...recoveredTicket.repairError === "" ? {} : { ownerRepairError: recoveredTicket.repairError } };
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
  const postedId = (subject) => posted.find((row) => row.subject === subject)?.id ?? "";
  const answeredSplitId = postedId(SPLIT_TASK_SUBJECT) === "" ? posted[1]?.id ?? "" : postedId(SPLIT_TASK_SUBJECT);
  const ticket = await resolveSplitTicket(deps, teamId, answeredSplitId, true);
  const splitId = ticket.splitTaskId === "" ? answeredSplitId : ticket.splitTaskId;
  if (ticket.boardReadable && splitId === "")
    return { ok: false, error: "the planning team " + teamId + " was approved but " + ticket.repairError, teamId, members, planName, partial: true };
  if (ticket.repairError !== "") {
    return { ok: false, error: ticket.repairError, teamId, members, planName, tasks: { splitId }, ownerRepairError: ticket.repairError, partial: true };
  }
  return {
    ok: true,
    teamId,
    members,
    tasks: { requirementsId: postedId(REQUIREMENTS_TASK_SUBJECT), splitId },
    ...ticket.ownerRepaired ? { ownerRepaired: true } : {}
  };
}
function livePlanningMemberRow(name, role, handle, cell, now) {
  const base = planningMemberRow(name, role, cell, now);
  return handle === "" ? base : { ...base, sessionId: handle, executorRef: handle };
}
function planningMemberRow(name, role, cell, now) {
  const known = cell.members[name];
  return { name, role, sessionId: known?.sessionId ?? "", executorRef: known?.executorRef ?? "", mode: "member", handoffReady: known?.handoffReady ?? false, handoffs: known?.handoffs ?? 0, joinedAt: known?.joinedAt ?? now.toISOString(), ...known?.adopted === true ? { adopted: true } : {} };
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
var TERMINAL_TICKET_STATUSES = ["completed", "failed", "cancelled"];
var SPLIT_TICKET_REPAIR = 'agent_teams_task {action:"claim", claimant:"cell-splitter"}';
function findSplitTicket(rows, splitTaskId, liveOnly) {
  const live = (row) => !TERMINAL_TICKET_STATUSES.includes(String(row.status ?? ""));
  const recorded = splitTaskId === "" ? undefined : rows.find((row) => String(row.id ?? "") === splitTaskId);
  if (recorded !== undefined && (!liveOnly || live(recorded)))
    return recorded;
  const owned = rows.filter((row) => roleKey(String(row.owner ?? "")) === roleKey(SPLITTER_MEMBER));
  return owned.find(live) ?? (liveOnly ? undefined : owned[0]);
}
async function resolveSplitTicket(deps, teamId, preferredId, liveOnly) {
  const record = deps.teams()?.get?.(deps.workspace, teamId);
  if (typeof record !== "object" || record === null) {
    return { splitTaskId: "", ownerRepaired: false, repairError: "", boardReadable: false };
  }
  const rows = Array.isArray(record.tasks) ? record.tasks.filter((row2) => typeof row2 === "object" && row2 !== null) : [];
  const recorded = (deps.cell.splitTaskId ?? "").trim();
  const preferred = preferredId.trim();
  const row = (recorded === "" ? undefined : findSplitTicket(rows, recorded, liveOnly)) ?? (preferred === "" ? undefined : findSplitTicket(rows, preferred, liveOnly)) ?? findSplitTicket(rows, "", liveOnly);
  if (row === undefined)
    return { splitTaskId: "", ownerRepaired: false, repairError: "no split ticket is on the board — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true };
  const splitTaskId = String(row.id ?? "");
  const owner = String(row.owner ?? "").trim();
  if (owner !== "" || splitTaskId === "")
    return { splitTaskId, ownerRepaired: false, repairError: "", boardReadable: true };
  try {
    const claimed = await deps.dsh.executeTool({ name: "agent_teams_task", arguments: { action: "claim", task_id: splitTaskId, claimant: SPLITTER_MEMBER }, agent: deps.captainAgent });
    if (!claimed.ok)
      return { splitTaskId, ownerRepaired: false, repairError: "the ownerless split ticket " + splitTaskId + " could not be claimed (" + String(claimed.error) + ") — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true };
    return { splitTaskId, ownerRepaired: true, repairError: "", boardReadable: true };
  } catch (error) {
    return { splitTaskId, ownerRepaired: false, repairError: "the ownerless split ticket " + splitTaskId + " could not be claimed (" + (error instanceof Error ? error.message : String(error)) + ") — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true };
  }
}

// packages/mpd-cellwork-plugin/src/activate.ts
var CONTRACT_LOOP_PLACEHOLDER = "The verification loop is opened at activation; its id is appended below before dispatch.";
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
function resolvedMemberName(task) {
  const declared = (task.member ?? "").trim();
  return declared === "" ? task.ownerRole.trim() : declared;
}
function memberPrompt(deps, memberName, ownerRole, owned) {
  const persona = deps.personaFor(ownerRole);
  const taskLines = owned.map((task) => "  · " + task.key + " — " + task.subject);
  return [
    ...persona === null ? [] : [persona, ""],
    "[mpd-cellwork] You are " + memberName + " (" + ownerRole + ") on cell " + deps.cell.cellId + ".",
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
function resplitNotice(keptCount, dispatched, rebuiltKept) {
  const exception = rebuiltKept.length === 0 ? "Stage-4 exception: a kept task whose loop was never recorded is the ONLY case where a kept contract is rebuilt, gaining its verify loop id." : "Stage-4 exception: " + String(rebuiltKept.length) + " kept task(s) had no recorded loop, so their frozen contracts WERE rebuilt with the loop id (" + rebuiltKept.join(", ") + ").";
  return "RE-SPLIT on the same team: " + String(keptCount) + " kept task(s) reuse their live board rows, and their frozen contracts are NOT rewritten — the bytes a verifier may already be reading stay as first frozen. Consequence: a scope expansion needs a manual re-freeze plus a new verify loop, so land it as a NEW split revision; editing the kept contract in place is not what this activation does. " + String(dispatched) + " owner-only pair(s) were dispatched by this activation. " + exception;
}
function buildContractDoc(deps, task, reviewer, boardId) {
  const gates = deps.config.contractGates.length === 0 ? ["the repository's own declared gates (read the project instruction file: AGENTS.md §4, or its equivalent)"] : [...deps.config.contractGates];
  const verifier = reviewer === undefined ? "NO REVIEW TASK — this task's verification is not armed" : reviewer.ownerRole;
  const memberName = resolvedMemberName(task);
  return [
    "# Acceptance contract — " + task.key + ": " + task.subject,
    "",
    "Cell: `" + deps.cell.cellId + "` · split revision " + String(deps.split.revision) + " · frozen " + deps.split.submittedAt,
    "producer: " + producerIdentity(deps.cell.cellId),
    "Owner: **" + task.ownerRole + "** (member `" + memberName + "`) · Verifier: **" + verifier + "** · Board task: `" + boardId + "`",
    "",
    "## Deliverable",
    task.description,
    "",
    "## Allowed write scopes",
    ...task.writeScopes.length === 0 ? ["(none declared — this task produces no code)", "", "If it DOES need to write, ask the captain for a scope extension BEFORE the first write: this contract allows no path, so any edit is outside it."] : task.writeScopes.map((scope) => "- `" + scope + "`"),
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
    CONTRACT_LOOP_PLACEHOLDER
  ].join(`
`);
}
function withLoopId(doc, loopId) {
  return doc.replace(CONTRACT_LOOP_PLACEHOLDER, "The verification loop is opened at activation; `" + loopId + '` (`mpd_verify_seat {loop_id:"' + loopId + '"}`).');
}
function contractAlreadyNamesLoop(deps, taskKey) {
  const path = contractPath(deps.workspace, deps.cell.cellId, taskKey);
  try {
    if (!existsSync5(path))
      return false;
    return !readFileSync4(path, "utf8").includes(CONTRACT_LOOP_PLACEHOLDER);
  } catch {
    return false;
  }
}
async function materializeSplit(deps) {
  const teamId = deps.cell.teamId;
  if (teamId === "")
    return { ok: false, error: "cellwork_activate: no team is recorded on " + deps.cell.cellId + " — run `cellwork_start` first (the planning team is the record activation appends to)" };
  const partial = { members: {}, boardIds: {}, loopIds: {}, contracts: {} };
  let mutated = false;
  let artifacts = 0;
  let total = 0;
  const progress = (stage, key) => {
    mutated = true;
    artifacts += 1;
    deps.progress({ stage, key, ordinal: artifacts, total });
  };
  const snapshot = () => ({ members: { ...partial.members }, boardIds: { ...partial.boardIds }, loopIds: { ...partial.loopIds }, contracts: { ...partial.contracts } });
  const fail = (error) => ({ ok: false, error, ...mutated ? { partial: snapshot() } : {} });
  const errorText4 = (error) => error instanceof Error ? error.message : String(error);
  const call = async (arguments_) => {
    try {
      const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent });
      if (!result.ok)
        return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" };
      return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value : {} };
    } catch (error) {
      return { ok: false, error: errorText4(error) };
    }
  };
  const reviewerOf = (key) => deps.split.tasks.find((candidate) => candidate.kind === "review" && candidate.blockedBy.includes(key));
  const mode = deps.cell.activatedRevision === null ? "initial" : "resplit";
  const previous = new Map(Object.entries(deps.cell.activatedTasks));
  const keptKeys = new Set(deps.split.tasks.filter((task) => previous.has(task.key)).map((task) => task.key));
  const droppedKeys = [...previous.keys()].filter((key) => !keptKeys.has(key) && deps.cell.cancelledTasks[key] === undefined);
  const fresh = deps.split.tasks.filter((task) => !keptKeys.has(task.key));
  const freshCode = fresh.filter((task) => task.writeScopes.length > 0);
  const memberOrder = [];
  for (const task of fresh) {
    const name = resolvedMemberName(task);
    if (!memberOrder.some((seen) => roleKey(seen) === roleKey(name)))
      memberOrder.push(name);
  }
  const loopIds = new Map(Object.entries(deps.cell.activatedLoops ?? {}));
  const codeTasks = deps.split.tasks.filter((task) => task.writeScopes.length > 0);
  const armedByContract = new Set;
  const loopTargets = [];
  for (const task of codeTasks) {
    if (loopIds.has(task.key))
      continue;
    if (keptKeys.has(task.key) && contractAlreadyNamesLoop(deps, task.key)) {
      armedByContract.add(task.key);
      continue;
    }
    loopTargets.push(task);
  }
  total = freshCode.length + memberOrder.length + fresh.length + loopTargets.length;
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
    const owned = deps.split.tasks.filter((task) => roleKey(resolvedMemberName(task)) === key);
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
      return fail("cellwork_activate could not write the contract for " + JSON.stringify(task.key) + ": " + errorText4(error));
    }
    partial.contracts[task.key] = path;
    progress("contract", task.key);
  }
  const handledMembers = new Set;
  const newMembers = {};
  const reused = [];
  for (const memberName of memberOrder) {
    const key = roleKey(memberName);
    if (handledMembers.has(key))
      continue;
    handledMembers.add(key);
    const owned = deps.split.tasks.filter((candidate) => roleKey(resolvedMemberName(candidate)) === key);
    const ownerRole = (owned[0]?.ownerRole ?? memberName).trim();
    const existing = existingMembers.get(key);
    if (existing !== undefined) {
      reused.push(existing.name);
      if (deps.cell.members[existing.name] === undefined) {
        newMembers[existing.name] = existing;
        partial.members = { ...partial.members, ...newMembers };
        progress("member", existing.name);
      }
      continue;
    }
    const pureVerifier = owned.every((candidate) => candidate.kind === "review");
    const added = await call({
      action: "add_member",
      member: { name: memberName, role: ownerRole, description: memberName + (pureVerifier ? " (verifier)" : ""), prompt: memberPrompt(deps, memberName, ownerRole, owned) }
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
          newMembers[liveName] = { name: liveName, role: ownerRole, sessionId: executorRef, executorRef, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() };
          reused.push(liveName);
          partial.members = { ...partial.members, ...newMembers };
          progress("member", liveName);
          continue;
        }
      }
      return fail("cellwork_activate could not raise " + JSON.stringify(memberName) + ": " + added.error);
    }
    const handle = typeof added.value.spawned === "string" ? added.value.spawned : "";
    if (handle === "")
      return fail("cellwork_activate raised " + JSON.stringify(memberName) + " but the answer carried no executor handle");
    newMembers[memberName] = { name: memberName, role: ownerRole, sessionId: handle, executorRef: handle, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() };
    partial.members = { ...partial.members, ...newMembers };
    progress("member", memberName);
  }
  const boardIds = new Map;
  for (const key of keptKeys) {
    const id = previous.get(key);
    if (id !== undefined && id !== "")
      boardIds.set(key, id);
  }
  const activated = [];
  for (const task of topologicalOrder(fresh)) {
    const memberName = resolvedMemberName(task);
    const mappedBlockers = task.blockedBy.map((reference) => boardIds.get(reference) ?? previous.get(reference) ?? reference);
    const contractPointer = "FROZEN CONTRACT: " + contractRelativePath(deps.cell.cellId, task.key);
    const description = (task.kind === "review" ? reviewTaskDescription(task, deps.split.tasks.find((candidate) => candidate.key === task.blockedBy[0]) ?? task, deps.cell.cellId) : task.description) + `

` + contractPointer;
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
    progress("task", task.key);
  }
  const loops = [];
  for (const task of loopTargets) {
    const boardId = boardIds.get(task.key) ?? "";
    if (boardId === "")
      return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to open a verify loop for a row that is not on the board");
    const contract = contractRelativePath(deps.cell.cellId, task.key);
    const memberName = resolvedMemberName(task);
    const owner = newMembers[memberName] ?? existingMembers.get(roleKey(memberName));
    const writerId = (owner?.sessionId ?? "").trim() === "" ? (owner?.executorRef ?? "").trim() : (owner?.sessionId ?? "").trim();
    let opened;
    try {
      opened = await deps.dsh.executeTool({
        name: "mpd_verify_open",
        arguments: {
          writer: "delegate",
          contract,
          scope: [...task.writeScopes],
          task_id: boardId,
          ...writerId === "" ? {} : { writer_id: writerId, writer_reason: "member: " + memberName }
        },
        agent: deps.captainAgent
      });
    } catch (error) {
      return fail("cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + errorText4(error));
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
      return fail("cellwork_activate could not rewrite the contract for " + JSON.stringify(task.key) + ": " + errorText4(error));
    }
    progress("loop", task.key);
  }
  for (const task of deps.split.tasks) {
    if ((boardIds.get(task.key) ?? "") === "")
      return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to dispatch");
    if (task.writeScopes.length > 0 && (loopIds.get(task.key) ?? "") === "" && !armedByContract.has(task.key))
      return fail("cellwork_activate has no verify loop for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work");
  }
  const cancelled = [];
  for (const key of droppedKeys) {
    const boardId = previous.get(key) ?? "";
    cancelled.push({ key, boardId });
    appendJournal(deps.workspace, deps.cell.cellId, { event: "task-cancelled", key, boardId, revision: deps.split.revision, reason: "the accepted split no longer carries this task; the board row is kept and dispatch skips it" }, deps.now);
  }
  if (cancelled.length > 0) {
    const cancelledIds = cancelled.map((entry) => entry.boardId).filter((id) => id !== "");
    const plane = deps.teamActions();
    if (cancelledIds.length > 0 && plane?.cancelTasks === undefined) {
      return fail("cellwork_activate dropped " + String(cancelledIds.length) + " row(s) but this composition exposes no mpdTeamActions.cancelTasks, so they would stay dispatchable — the activation is left un-dispatched and can be resumed");
    }
    if (cancelledIds.length > 0 && plane?.cancelTasks !== undefined) {
      const closed = await plane.cancelTasks({ workspace: deps.workspace, teamId: deps.cell.teamId, taskIds: cancelledIds, note: "the accepted split no longer carries this task" });
      if (closed?.ok === false)
        return fail("cellwork_activate could not close the dropped row(s): " + String(closed.error ?? "the team plane refused the cancellation"));
    }
  }
  let dispatch;
  let record;
  try {
    record = deps.recordFor(teamId);
    const plane = deps.teamActions();
    if (plane?.dispatch === undefined) {
      dispatch = { pairs: [], skipped: [], refused: "the mpdTeamActions service is absent, so no member can be woken — the board is materialised and ready for a manual `cellwork_dispatch`" };
    } else {
      const reply = await plane.dispatch({ sessionId: deps.cell.captainSessionId, mode: "owner-only" });
      dispatch = reply?.ok === false ? { pairs: [], skipped: [], refused: String(reply.error ?? "the team plane refused the activation pass") } : {
        pairs: Array.isArray(reply.pairs) ? reply.pairs : [],
        skipped: Array.isArray(reply.skipped) ? reply.skipped : []
      };
    }
  } catch (error) {
    return fail("cellwork_activate could not dispatch: " + errorText4(error));
  }
  const splitterRow = findSplitTicket(record?.tasks ?? [], deps.cell.splitTaskId ?? "", true);
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
    progress: artifacts,
    dispatched: dispatch.pairs.length,
    skipped: dispatch.skipped.length,
    ...splitTaskId === "" ? {} : { splitTaskId }
  }, deps.now);
  const rebuiltKept = loopTargets.filter((task) => keptKeys.has(task.key)).map((task) => task.key);
  const notice = keptKeys.size === 0 ? undefined : resplitNotice(keptKeys.size, dispatch.pairs.length, rebuiltKept);
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
      ...splitTaskId === "" ? {} : { splitTaskId },
      ...notice === undefined ? {} : { notice }
    }
  };
}

// packages/mpd-cellwork-plugin/src/flow.ts
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
  const teamActions = () => {
    const service = deps.ctx.get?.("mpdTeamActions", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const roster = () => {
    const service = deps.ctx.get?.("mpdRoles", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const consults = () => {
    const service = deps.ctx.get?.("mpdConsults", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const consultBook = createConsultBook();
  deps.onConsultStop?.(async (cell) => {
    await clearCellConsults({ book: consultBook, cellId: cell.cellId, workspace: cell.workspace, teamId: cell.teamId, teamActions, consults, now: new Date });
  });
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
  const noLiveCellRefusal = (context, toolName) => {
    if (context.workspace !== "" && context.cell !== null)
      return;
    if (context.workspace === "")
      return toolName + ": the workspace root could not be resolved, so no cell can be read";
    const ids = listCellIds(context.workspace);
    for (const id of ids) {
      const read = readCell(context.workspace, id);
      if (read.ok && read.state.phase === "stopped")
        return toolName + ": cell " + id + " is stopped and archived — consult work is refused after the mode ends";
    }
    return toolName + ": no active cell in this workspace — the consult verbs are only callable inside a running cell";
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
          recordedSplitTaskId: { type: "string", description: "The split ticket id the cell record carries after this update — the row the NEXT update reuses." },
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
      const splitTask = findSplitTicket(boardTasksOf(record), state.splitTaskId ?? "", true) ?? findSplitTicket(boardTasksOf(record), state.splitTaskId ?? "", false);
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
      const recordedSplitTaskId = replacementSplitTaskId !== "" ? replacementSplitTaskId : splitTaskId !== "" ? splitTaskId : state.splitTaskId ?? "";
      const next = { ...state, requirementsRevision: revision, splitTaskId: recordedSplitTaskId, splitStale: state.splitRevision !== null ? true : state.splitStale };
      transition(caller.workspace, next, { event: "requirements-update", revision, previousRevision: state.requirementsRevision, splitStale: next.splitStale, splitTaskId, splitTaskStatus, redispatchable, recordedSplitTaskId, ...replacementSplitTaskId === "" ? {} : { replacementSplitTaskId } }, now);
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
        recordedSplitTaskId,
        ...splitTaskId === "" ? { message: "no split task is on the board yet — the splitter will receive the whole graph when it is dispatched" } : redispatchable ? { message: "the SAME split task " + splitTaskId + " is re-dispatched with revision " + String(revision) + (next.splitStale ? " and the split marked STALE" : "") + " — dispatch it with `cellwork_dispatch`" } : { message: "split task " + splitTaskId + " is " + splitTaskStatus + " and this board has no reopen verb, so a replacement row " + (replacementSplitTaskId === "" ? "could NOT be appended (no live team to append to)" : replacementSplitTaskId) + " carries the re-split with revision " + String(revision) + " — dispatch it with `cellwork_dispatch`" }
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_recon",
    description: "PLANNER/SUBCAPTAIN only: raise READ-ONLY consults (label exactly `Explorer` or `Researcher`) through the `mpdConsults` service, so the roles row applies the read-only deny list to the child and places it one level below the caller as a LEAF (caller agent depth + 1 — `cellwork.depthMax` counts nested CELLS and never caps the child). ONE question (`{role, task}`, the legacy blocking form) returns its report; 1..8 questions (`{role, questions}`) run CONCURRENTLY and the call returns only when ALL of them are settled, one row per question. Every report is journaled in the cell; an absent `mpdConsults` service is refused by name, never replaced by an unsupervised spawn.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["Explorer", "Researcher"], description: "The read-only roster role; the label is applied verbatim so the roles row applies the read-only deny list." },
        task: { type: "string", description: "The ONE question the consult must answer (legacy blocking form; exactly one of `task`/`questions`)." },
        questions: { type: "array", items: { type: "string" }, description: "1..8 questions settled CONCURRENTLY; the call returns when every one is settled (exactly one of `task`/`questions`)." }
      },
      required: ["role"],
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
          personaInjected: { type: "boolean" },
          reports: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                report: { type: "string" },
                stopReason: { oneOf: [{ type: "string" }, { type: "null" }] },
                interrupted: { type: "boolean" },
                handoff: { type: "string" }
              },
              required: ["question", "report", "stopReason"]
            }
          }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_recon refused: " + String(result.error ?? "unknown refusal"));
        const rows = Array.isArray(result.reports) ? result.reports : [];
        if (rows.length > 0) {
          return text(String(result.label ?? "consult") + " — " + String(rows.length) + " report(s)" + (result.personaInjected === true ? ", persona injected" : ", NO persona readable") + `:

` + rows.map((row, index) => "[" + String(index + 1) + "] " + String(row.question ?? "") + `
` + String(row.report ?? "") + (row.stopReason === null || row.stopReason === undefined ? "" : `
(stopReason: ` + String(row.stopReason) + ")" + (row.handoff === undefined ? "" : `
(handoff: ` + String(row.handoff) + ")"))).join(`

`));
        }
        return text(String(result.label ?? "consult") + " report (" + String(result.report ?? "").length + " chars" + (result.personaInjected === true ? ", persona injected" : ", NO persona readable") + `):

` + String(result.report ?? ""));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      const noCell = noLiveCellRefusal(caller, "cellwork_recon");
      if (noCell !== undefined)
        return { ok: false, error: noCell };
      const cell = caller.cell;
      if (cell === null)
        return { ok: false, error: "cellwork_recon: no active cell in this workspace" };
      const result = await runRecon({
        consults: consults(),
        exec,
        workspace: caller.workspace,
        cell,
        caller: { member: caller.member, mode: caller.seat?.mode ?? "member" },
        personaFor,
        now: new Date
      }, {
        role: argString(argv, "role"),
        ...typeof argv.task === "string" ? { task: argv.task } : {},
        ...Array.isArray(argv.questions) ? { questions: argv.questions } : {}
      });
      return result.ok ? { ...result } : { ok: false, error: result.error };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_delegate",
    description: "PLANNER / SUBCAPTAIN / recorded MEMBER only (the cell captain is refused): start 1..16 BACKGROUND consults in ONE call and return their `consultId`s immediately, before any child settles. Roles are ANY roster role — writers included — and are canonicalised by the roles row (`deep worker` = `Deep-Worker` = `Deep Worker`), so the answer echoes the canonical name. ALL-OR-NOTHING: an unknown role, an empty field or more than 16 tasks refuses the whole call and starts nothing. Over-cap work QUEUES on the shared `MPD_DSH_CONSULT_MAX` cap and is never refused. Collect with `cellwork_consult`; for read-only reconnaissance prefer `cellwork_recon`.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "1..16 tasks started in ONE pass; every one must validate or the call starts nothing.",
          items: {
            type: "object",
            properties: {
              role: { type: "string", description: "A roster role NAME (any case, space, hyphen or underscore spelling; see `mpd_roles_list`)." },
              task: { type: "string", description: "The assignment / question this consult answers." },
              context: { type: "string", description: "Optional extra prompt block (why the consult exists)." }
            },
            required: ["role", "task"],
            additionalProperties: false
          }
        }
      },
      required: ["tasks"],
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          started: { type: "integer" },
          consults: {
            type: "array",
            items: {
              type: "object",
              properties: {
                consultId: { type: "string" },
                role: { type: "string" },
                startedAt: { type: "number" }
              },
              required: ["consultId", "role", "startedAt"]
            }
          }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_delegate refused: " + String(result.error ?? "unknown refusal"));
        const rows = Array.isArray(result.consults) ? result.consults : [];
        return text("started " + String(result.started ?? rows.length) + " background consult(s) — collect them with `cellwork_consult`:\n" + rows.map((row) => "- " + String(row.role ?? "") + " · " + String(row.consultId ?? "")).join(`
`));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      const noCell = noLiveCellRefusal(caller, "cellwork_delegate");
      if (noCell !== undefined)
        return { ok: false, error: noCell };
      const seatRefusal = consultSeatRefusal("cellwork_delegate", caller.seat);
      if (seatRefusal !== undefined)
        return { ok: false, error: seatRefusal };
      const cell = caller.cell;
      if (cell === null)
        return { ok: false, error: "cellwork_delegate: no active cell in this workspace" };
      const result = await startDelegation({
        service: consults,
        rosterNames,
        cellId: cell.cellId,
        workspace: caller.workspace,
        exec,
        now: new Date,
        book: consultBook,
        teamId: cell.teamId,
        teamActions
      }, argv.tasks);
      return result.ok ? { ...result } : { ok: false, error: result.error };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_consult",
    description: 'PLANNER / SUBCAPTAIN / recorded MEMBER only (the cell captain is refused): list, wait for, collect or cancel the consults THIS cell started through `cellwork_delegate`. `list` answers only this cell\'s ids that the consult supervisor still knows (a direct `mpd_role_consult {action:"collect"}` releases one, and a restart drops every handle); `wait` clamps `timeoutMs` to 1..60000 (default 30000) and a timed-out wait answers `state:"running"` rather than throwing; `collect` returns the settled report and RELEASES the record; `cancel` interrupts that child and journals it. An id this cell did not start is refused, not guessed.',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...CONSULT_ACTIONS], description: "list | wait | collect | cancel." },
        consultId: { type: "string", description: "The id `cellwork_delegate` returned; required for every action except `list`." },
        timeoutMs: { type: "number", description: "The `wait` bound in ms, clamped to 1.." + String(CONSULT_WAIT_MAX_MS) + "; default " + String(CONSULT_WAIT_DEFAULT_MS) + "." }
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
          action: { type: "string" },
          consults: {
            type: "array",
            items: {
              type: "object",
              properties: {
                consultId: { type: "string" },
                role: { type: "string" },
                state: { type: "string" },
                startedAt: { type: "number" },
                elapsedMs: { type: "number" },
                question: { type: "string" }
              }
            }
          },
          consultId: { type: "string" },
          role: { type: "string" },
          state: { type: "string" },
          startedAt: { type: "number" },
          elapsedMs: { type: "number" },
          handoff: { type: "string" },
          errorDetail: { type: "string", description: "The consult's OWN failure text (a raised child that never reported), distinct from a refusal." },
          report: {
            type: "object",
            properties: {
              role: { type: "string" },
              status: { type: "string" },
              summary: { type: "string" },
              recommendation: { type: "string" },
              details: { type: "string" },
              evidence: { type: "array", items: { type: "string" } },
              stopReason: { oneOf: [{ type: "string" }, { type: "null" }] },
              consultId: { type: "string" },
              elapsedMs: { type: "number" },
              handoff: { type: "string" },
              lastActivity: { type: "string" }
            }
          }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return text("cellwork_consult refused: " + String(result.error ?? "unknown refusal"));
        const rows = Array.isArray(result.consults) ? result.consults : [];
        if (result.action === "list") {
          return text(rows.length === 0 ? "this cell has no consult the supervisor still knows — start work with `cellwork_delegate`" : "this cell's consults (" + String(rows.length) + `):
` + rows.map((row) => "- " + String(row.role ?? "") + " · " + String(row.consultId ?? "") + " · " + String(row.state ?? "") + " · " + String(row.elapsedMs ?? 0) + " ms · " + String(row.question ?? "")).join(`
`));
        }
        const report = typeof result.report === "object" && result.report !== null ? result.report : undefined;
        if (report === undefined)
          return text(String(result.action ?? "consult") + " · " + String(result.role ?? "") + " · " + String(result.state ?? "running") + " · " + String(result.elapsedMs ?? 0) + " ms" + (typeof result.errorDetail === "string" ? `
` + result.errorDetail : ""));
        return text(String(result.action ?? "collect") + " · " + String(report.role ?? "") + " · " + String(report.status ?? "") + " · " + String(report.elapsedMs ?? 0) + " ms" + (report.summary === undefined || report.summary === "" ? "" : `

` + String(report.summary)) + (Array.isArray(report.evidence) && report.evidence.length > 0 ? `

evidence:
` + report.evidence.map((entry) => "- " + String(entry)).join(`
`) : ""));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path };
      const noCell = noLiveCellRefusal(caller, "cellwork_consult");
      if (noCell !== undefined)
        return { ok: false, error: noCell };
      const seatRefusal = consultSeatRefusal("cellwork_consult", caller.seat);
      if (seatRefusal !== undefined)
        return { ok: false, error: seatRefusal };
      const cell = caller.cell;
      if (cell === null)
        return { ok: false, error: "cellwork_consult: no active cell in this workspace" };
      const result = await runConsultAction({
        service: consults,
        rosterNames,
        cellId: cell.cellId,
        workspace: caller.workspace,
        exec,
        now: new Date,
        book: consultBook,
        teamId: cell.teamId,
        teamActions
      }, { action: argString(argv, "action"), consultId: argString(argv, "consultId"), timeoutMs: argv.timeoutMs });
      return result;
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_split",
    description: "The SPLITTER's tool (cell-splitter only) for `submit`; any cell seat may `show` the last verdict. `submit` MEASURES every task (declared input bytes → tokens, the model-read context window) and validates the graph (dependency answer, acyclicity, write-scope ordering, verifier ≠ writer, role existence), accepting or refusing with a per-task breakdown; a refused split may be resubmitted. NON-FATAL `warnings` are reported BESIDE the verdict and never change `accepted`: a `work`/`repair`/`integration` task that declares NO `writeScopes` freezes a contract allowing no path, so its writer would stop at the first edit — declare the scopes, or amend the contract with the captain BEFORE the first write.",
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
              member: { type: "string", description: "The board member this task is raised for; omitted means the member IS the owner role. Several tasks may share one member; several members may share one role." },
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
          warnings: { type: "array", items: { type: "object" }, description: "NON-FATAL advisories (e.g. a code task with no write scope). They never change `accepted`." },
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
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        const warnLine = warnings.length === 0 ? "" : `
SCOPE WARNING(S) — non-fatal, the split stays accepted: ` + warnings.map((warning) => String(warning.taskKey ?? "?") + ": " + String(warning.detail ?? warning.code ?? "")).join(" | ") + "\nRemedy: declare `writeScopes` in the next revision, or ask the captain for a scope extension BEFORE the first write.";
        if (typeof result.message === "string")
          return text(result.message + warnLine);
        return text("split revision " + String(result.revision ?? "?") + ": " + (result.accepted === true ? "ACCEPTED" : "REFUSED") + (result.accepted === true ? "" : " — the per-task breakdown is at " + String(result.splitPath ?? "?")) + warnLine + `
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
        return { ok: true, action, accepted: verdict2.accepted, revision: verdict2.revision, findings: verdict2.findings, warnings: verdict2.warnings, roles: verdict2.roles, tasks: verdict2.tasks, totals: verdict2.totals, splitPath: splitPathFor(caller.workspace, verdict2) };
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
            ...argString(row, "member") === "" ? {} : { member: argString(row, "member") },
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
        return { ok: true, action, accepted: true, revision: verdict.revision, findings: verdict.findings, warnings: verdict.warnings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath: splitPath2, supersededRevision, message: "split revision " + String(verdict.revision) + " ACCEPTED" + (supersededRevision === null ? "" : " (revision " + String(supersededRevision) + " is superseded)") + " — the captain may call `cellwork_activate`" };
      }
      appendJournal(caller.workspace, state.cellId, { event: "split-refused", revision: verdict.revision, findings: verdict.findings.map((finding) => ({ code: finding.code, taskKey: finding.taskKey, detail: finding.detail })), warnings: verdict.warnings.map((warning) => ({ code: warning.code, taskKey: warning.taskKey })), refused: verdict.totals.refusedCount }, new Date);
      return { ok: true, action, accepted: false, revision: verdict.revision, findings: verdict.findings, warnings: verdict.warnings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath: splitPath2 };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_activate",
    description: "CAPTAIN only: materialise an ACCEPTED split on the LIVE team record. Requires an accepted split of the CURRENT requirements revision (a stale split is refused unless its revision is passed explicitly). Writes one frozen contract per NEW code task, raises ONE member per distinct `member` (its owner role routes it, persona TEXT in the prompt), appends each NEW task owned by that member with reviews blocked by their work task, opens a verify loop for EVERY code task that has none yet BEFORE dispatch (a kept task whose frozen contract already names a loop is left untouched), then dispatches owner-only. A failed pass is checkpointed and the SAME accepted revision resumes it; a newer accepted revision supersedes an older in-flight one (revisions never move backwards). A NEWER revision APPENDS to the same team: kept work reuses its board row, added work is appended, dropped work is marked `cancelled` and never deleted. On a re-split the result carries a `notice` stating how many tasks were kept, that their FROZEN contracts are NOT rewritten (a scope expansion needs a manual re-freeze plus a new verify loop), that this activation dispatched owner-only, and the one stage-4 exception where a kept contract IS rebuilt with its loop id. It never re-creates the team.",
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
          reused: { type: "array", items: { type: "string" }, description: "Board names reused from the cell record or the live roster instead of raised." },
          tasks: { type: "array", items: { type: "object" } },
          kept: { type: "array", items: { type: "string" }, description: "Split keys whose live board row was reused (never duplicated)." },
          cancelled: { type: "array", items: { type: "object" }, description: "Work this revision dropped: `{key, boardId}`, marked cancelled on the cell record and never deleted." },
          loops: { type: "array", items: { type: "object" } },
          dispatch: { type: "object" },
          notice: { type: "string", description: "Present on a re-split: how many tasks were kept, that their frozen contracts are NOT rewritten, what a scope expansion therefore needs, that this activation dispatched owner-only, and the stage-4 rebuild exception." }
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
        return text("cell activated on split revision " + String(result.revision ?? "?") + (result.mode === "resplit" ? " (re-split: " + String(Array.isArray(result.kept) ? result.kept.length : 0) + " kept, " + String(Array.isArray(result.cancelled) ? result.cancelled.length : 0) + " cancelled)" : "") + ": " + String(Array.isArray(result.tasks) ? result.tasks.length : 0) + " task(s), " + String(Array.isArray(result.loops) ? result.loops.length : 0) + " verify loop(s), " + pairs.length + " dispatched" + (skipped.length === 0 ? "" : ", " + skipped.length + " reported: " + skipped.map((row) => String(row.subject ?? row.taskId) + ": " + String(row.reason)).join("; ")) + (typeof result.notice === "string" ? `
NOTICE: ` + result.notice : ""));
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
      if (state.activationInFlight !== null && state.activationInFlight !== undefined && acceptedRevision < state.activationInFlight) {
        return { ok: false, error: "cellwork_activate: split revision " + String(acceptedRevision) + " is OLDER than the in-flight revision " + String(state.activationInFlight) + " — revisions only move forward; accept a newer split instead" };
      }
      if (state.activationInFlight !== null && state.activationInFlight !== undefined && state.activationInFlight !== acceptedRevision) {
        appendJournal(caller.workspace, state.cellId, { event: "activation-in-flight-superseded", previous: state.activationInFlight, by: acceptedRevision, reason: "the accepted split moved on; the older partial is abandoned and its recorded rows are reconciled by this materialisation" }, new Date);
      }
      const stored = readSplit(caller.workspace, state.cellId, acceptedRevision);
      if (!stored.ok)
        return { ok: false, error: "cellwork_activate: " + stored.detail, path: stored.path };
      if (!stored.verdict.accepted)
        return { ok: false, error: "cellwork_activate: revision " + String(acceptedRevision) + " was REFUSED by the measured verdict — the splitter must fix the findings and resubmit" };
      const activatedAt = new Date;
      const persistPartial = (partial, error) => {
        const next2 = {
          ...state,
          activationInFlight: acceptedRevision,
          members: { ...state.members, ...partial.members },
          activatedTasks: { ...state.activatedTasks, ...partial.boardIds },
          activatedLoops: { ...state.activatedLoops ?? {}, ...partial.loopIds }
        };
        transition(caller.workspace, next2, { event: "cell-activation-partial", revision: acceptedRevision, members: Object.keys(partial.members), tasks: partial.boardIds, loops: partial.loopIds, contracts: Object.values(partial.contracts), ...error === undefined ? {} : { error } }, activatedAt);
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
        teamActions,
        progress: (step) => {
          appendJournal(caller.workspace, state.cellId, { event: "cell-activation-progress", revision: acceptedRevision, ...step }, activatedAt);
        },
        now: activatedAt
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
        splitTaskId: (activated.outcome.splitTaskId ?? "") === "" ? state.splitTaskId ?? "" : String(activated.outcome.splitTaskId),
        members: { ...state.members, ...activated.outcome.members }
      };
      transition(caller.workspace, next, { event: "cell-activation", mode: activated.outcome.mode, revision: acceptedRevision, tasks: activated.outcome.tasks.length, kept: activated.outcome.kept.length, cancelled: activated.outcome.cancelled.length, loops: activated.outcome.loops.length, reused: activated.outcome.reused, ...activated.outcome.splitTaskId === undefined ? {} : { splitTaskId: activated.outcome.splitTaskId } }, activatedAt);
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
        dispatch: activated.outcome.dispatch,
        ...activated.outcome.notice === undefined ? {} : { notice: activated.outcome.notice }
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
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync4, readFileSync as readFileSync6 } from "node:fs";
import { join as join6 } from "node:path";

// packages/mpd-team-core-plugin/src/mailbox-store.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";

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
var MAIL_BODY_MAX = 4000;
function truncateMailBody(text2) {
  if (text2.length <= MAIL_BODY_MAX)
    return { body: text2, truncated: false, originalLength: text2.length };
  return { body: text2.slice(0, MAIL_BODY_MAX), truncated: true, originalLength: text2.length };
}
function mailboxPath(workspace) {
  return join5(workspace, ".mpd", "team", "mailbox.jsonl");
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
  if (!existsSync6(path))
    return [];
  let text2 = "";
  try {
    text2 = readFileSync5(path, "utf8");
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
  mkdirSync3(join5(workspace, ".mpd", "team"), { recursive: true });
  appendFileSync2(mailboxPath(workspace), JSON.stringify(record) + `
`);
}
function inboxOf(state, memberId) {
  return state.messages.filter((message) => message.toId === memberId);
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
function problemsSentence(check2) {
  return check2.problems.map((problem2) => problem2.labels === undefined ? problem2.message : `${problem2.message} (valid labels: ${problem2.labels.join(", ")})`).join("; ");
}
function unauthorizedAnswer(messageId) {
  return "only a recipient of the question may answer it: " + messageId;
}
var MAIL_MAX_UNDELIVERED_KEY = "mail.maxUndelivered";
var DEFAULT_MAIL_MAX_UNDELIVERED = 8;
var MAIL_MAX_UNDELIVERED_CEILING = 1000;
function mailMaxUndeliveredOf(readConfig) {
  let declared;
  try {
    declared = readConfig(MAIL_MAX_UNDELIVERED_KEY);
  } catch {
    return DEFAULT_MAIL_MAX_UNDELIVERED;
  }
  if (typeof declared !== "number" || !Number.isInteger(declared) || declared < 0 || declared > MAIL_MAX_UNDELIVERED_CEILING) {
    return DEFAULT_MAIL_MAX_UNDELIVERED;
  }
  return declared;
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
  const cap = input.maxUndelivered ?? DEFAULT_MAIL_MAX_UNDELIVERED;
  for (const target of targets) {
    const backlog = undeliveredOf(scoped, target.id).length;
    if (cap > 0 && backlog >= cap) {
      return { ok: false, reason: "backlog-full", detail: `"${target.name || target.id}" already has ${backlog} undelivered message(s) and the bound (${MAIL_MAX_UNDELIVERED_KEY}) is ${cap} — it is not keeping up. Two recovery paths: acknowledge its inbox (cellwork_inbox for a cell seat, or agent_teams_mail {action:"read"} for a team member), or reassign the rows behind it (cellwork_dispatch {reassign:[{task_id, owner}]}). Nothing was written.` };
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

// packages/mpd-cellwork-plugin/src/mail.ts
var CELL_MAIL_FILE = "mail.jsonl";
function cellMailPath(workspace, cellId) {
  return join6(cellDir(workspace, cellId), CELL_MAIL_FILE);
}
function nextCellMailId(workspace, now) {
  const stem = "mail-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-";
  const count = readMailbox(workspace).messages.length;
  return stem + String(count + 1).padStart(3, "0");
}
function textOf2(value) {
  if (typeof value === "string")
    return value;
  return value === undefined || value === null ? "" : String(value);
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function appendLegacyCellMail(workspace, cellId, record) {
  try {
    mkdirSync4(cellDir(workspace, cellId), { recursive: true });
    appendFileSync3(cellMailPath(workspace, cellId), JSON.stringify(record) + `
`, "utf8");
    return true;
  } catch {
    return false;
  }
}
function appendCellMail(workspace, cellId, record) {
  try {
    appendRecord(workspace, { ...record, cellId });
    return true;
  } catch {
    return false;
  }
}
function normalizeRawRecord(value, cellId) {
  if (!isObject(value))
    return;
  const id = textOf2(value.id);
  if (id === "")
    return;
  if (value.t === "read") {
    return { t: "read", id, by: textOf2(value.by), at: textOf2(value.at) };
  }
  if (value.t === "wake") {
    return {
      t: "wake",
      id,
      sent: value.sent === true,
      ...typeof value.reason === "string" && value.reason !== "" ? { reason: value.reason } : {},
      at: textOf2(value.at)
    };
  }
  if (value.t !== "send")
    return;
  const question = isObject(value.question) ? value.question : undefined;
  const answer = isObject(value.answer) ? value.answer : undefined;
  const kind = value.kind === "message" || value.kind === "question" || value.kind === "answer" ? value.kind : undefined;
  const from = textOf2(value.from) === "" ? textOf2(value.fromName) : textOf2(value.from);
  const to = textOf2(value.to) === "" ? textOf2(value.toName) : textOf2(value.to);
  return {
    t: "send",
    id,
    cellId: textOf2(value.cellId) === "" ? cellId : textOf2(value.cellId),
    from,
    to,
    subject: textOf2(value.subject),
    body: textOf2(value.body),
    at: textOf2(value.at) === "" ? textOf2(value.sentAt) : textOf2(value.at),
    wakeSent: value.wakeSent === true,
    ...typeof value.wakeReason === "string" && value.wakeReason !== "" ? { wakeReason: value.wakeReason } : {},
    ...kind === undefined ? {} : { kind },
    ...typeof value.replyTo === "string" && value.replyTo !== "" ? { replyTo: value.replyTo } : {},
    ...typeof value.threadId === "string" && value.threadId !== "" ? { threadId: value.threadId } : {},
    ...question === undefined ? {} : { question },
    ...answer === undefined ? {} : { answer },
    ...typeof value.teamId === "string" && value.teamId !== "" ? { teamId: value.teamId } : {},
    ...typeof value.fromId === "string" && value.fromId !== "" ? { fromId: value.fromId } : {},
    ...typeof value.toId === "string" && value.toId !== "" ? { toId: value.toId } : {},
    ...typeof value.fromCell === "string" && value.fromCell !== "" ? { fromCell: value.fromCell } : {},
    ...typeof value.fromMemberId === "string" && value.fromMemberId !== "" ? { fromMemberId: value.fromMemberId } : {}
  };
}
function readLegacyCellMail(workspace, cellId) {
  let text2;
  try {
    text2 = readFileSync6(cellMailPath(workspace, cellId), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text2.split(`
`)) {
    if (line.trim() === "")
      continue;
    try {
      const normalized = normalizeRawRecord(JSON.parse(line), cellId);
      if (normalized !== undefined)
        out.push(normalized);
    } catch {}
  }
  return out;
}
function readUnifiedCellMail(workspace, cellId) {
  const out = [];
  for (const raw of readRecords(workspace)) {
    if (!isObject(raw))
      continue;
    if (raw.t === "send" && raw.cellId !== cellId)
      continue;
    const normalized = normalizeRawRecord(raw, cellId);
    if (normalized !== undefined)
      out.push(normalized);
  }
  return out;
}
function findWorkspaceMailById(workspace, id) {
  if (id === "")
    return;
  for (const raw of readRecords(workspace)) {
    if (!isObject(raw) || raw.t !== "send" || raw.id !== id)
      continue;
    const normalized = normalizeRawRecord(raw, "");
    if (normalized !== undefined && normalized.t === "send")
      return normalized;
  }
  return;
}
function readCellMail(workspace, cellId) {
  const merged = [...readLegacyCellMail(workspace, cellId), ...readUnifiedCellMail(workspace, cellId)];
  const indexed = merged.map((record, index) => ({ record, index }));
  indexed.sort((left, right) => left.record.at.localeCompare(right.record.at) || left.index - right.index);
  return indexed.map((entry) => entry.record);
}
function toSendLine(record) {
  return {
    t: "send",
    id: record.id,
    fromId: record.fromId ?? record.from,
    fromName: record.from,
    toId: record.toId ?? record.to,
    toName: record.to,
    subject: record.subject,
    body: record.body,
    at: record.at,
    cellId: record.cellId,
    fromMemberId: record.fromMemberId ?? record.from,
    ...record.fromCell === undefined ? {} : { fromCell: record.fromCell },
    ...record.teamId === undefined ? {} : { teamId: record.teamId },
    ...record.kind === undefined ? {} : { kind: record.kind },
    ...record.replyTo === undefined ? {} : { replyTo: record.replyTo },
    ...record.threadId === undefined ? {} : { threadId: record.threadId },
    ...record.question === undefined ? {} : { question: record.question },
    ...record.answer === undefined ? {} : { answer: record.answer }
  };
}
function foldCellMail(records) {
  const sends = [];
  const reads = [];
  const wakes = new Map;
  const claims = new Map;
  for (const record of records) {
    if (record.t === "send") {
      sends.push(toSendLine(record));
      if (record.wakeSent || record.wakeReason !== undefined) {
        claims.set(record.id, { wakeSent: record.wakeSent, ...record.wakeReason === undefined ? {} : { wakeReason: record.wakeReason } });
      }
      continue;
    }
    if (record.t === "read") {
      reads.push({ t: "read", id: record.id, at: record.at, ...record.by === "" ? {} : { by: record.by } });
      continue;
    }
    wakes.set(record.id, { sent: record.sent, ...record.reason === undefined ? {} : { reason: record.reason } });
  }
  const folded = fold([...sends, ...reads]).messages;
  return folded.map((message) => {
    const wake = wakes.get(message.id);
    const claim = claims.get(message.id);
    const wakeSent = wake === undefined ? claim?.wakeSent === true : wake.sent === true;
    const wakeReason = wake === undefined ? claim?.wakeReason : wake.sent ? undefined : wake.reason;
    return {
      t: "send",
      id: message.id,
      cellId: message.cellId ?? "",
      from: message.fromName,
      to: message.toName,
      subject: message.subject,
      body: message.body,
      at: message.sentAt,
      kind: message.kind,
      threadId: message.threadId,
      read: message.readAt !== undefined,
      wakeSent,
      ...message.fromCell === undefined ? {} : { fromCell: message.fromCell },
      ...message.replyTo === undefined ? {} : { replyTo: message.replyTo },
      ...message.question === undefined ? {} : { question: message.question },
      ...message.answer === undefined ? {} : { answer: message.answer },
      ...message.readBy === undefined ? {} : { readBy: message.readBy },
      ...wakeReason === undefined ? {} : { wakeReason },
      ...message.teamId === undefined ? {} : { teamId: message.teamId },
      ...message.fromId === undefined ? {} : { fromId: message.fromId },
      ...message.toId === undefined ? {} : { toId: message.toId },
      ...message.fromMemberId === undefined ? {} : { fromMemberId: message.fromMemberId }
    };
  });
}
function acknowledgeCellMail(workspace, cellId, ids, ack, now) {
  const unifiedIds = new Set(readUnifiedCellMail(workspace, cellId).filter((record) => record.t === "send").map((record) => record.id));
  const viaStore = ids.filter((id) => unifiedIds.has(id));
  const outcome = acknowledge(workspace, viaStore, ack, now);
  const refused = outcome.refused.map((entry) => ({ id: entry.id, reason: entry.reason }));
  const viaLegacy = ids.filter((id) => !unifiedIds.has(id));
  const movedLegacy = [];
  for (const id of viaLegacy) {
    if (appendLegacyCellMail(workspace, cellId, { t: "read", id, by: ack.byName, at: now.toISOString() })) {
      movedLegacy.push(id);
    } else {
      refused.push({ id, reason: "the legacy `mail.jsonl` read record could not be written — the row stays unread" });
    }
  }
  return { moved: [...outcome.moved, ...movedLegacy], legacy: movedLegacy, refused };
}
function unreadFor(messages, names) {
  const keys = new Set(names.filter((name) => name !== "").map(nameKey));
  return messages.filter((message) => !message.read && keys.has(nameKey(message.to)));
}
function wakeFailures(messages) {
  return messages.filter((message) => !message.read && !message.wakeSent);
}
async function deliverCellMail(deps) {
  if (!deps.appendSend()) {
    return { landed: false, wakeSent: false, wakeReason: "the durable row could not be written, so no wake-up was attempted (mail is durable first)" };
  }
  let outcome;
  try {
    outcome = await deps.attemptWake();
  } catch (error) {
    outcome = { sent: false, reason: "the wake-up failed: " + (error instanceof Error ? error.message : String(error)) };
  }
  const recorded = deps.appendWake(outcome);
  if (!recorded) {
    return {
      landed: true,
      wakeSent: false,
      wakeReason: outcome.sent === true ? "the wake-up was attempted and the transport accepted it, but its `wake` record could not be written — the durable log reports this row as undelivered" : "the wake-up did not go out (" + (outcome.reason ?? "no reason given") + ") and its `wake` record could not be written either — the durable log reports this row as undelivered"
    };
  }
  return { landed: true, wakeSent: outcome.sent === true, ...outcome.reason === undefined ? {} : { wakeReason: outcome.reason } };
}
var CELL_MAIL_PAGE = 20;
var CELL_MAIL_BODY_MAX = 4000;
function pageCellMail(rows, limit, offset) {
  const size = Number.isFinite(Number(limit)) ? Math.min(Math.max(Math.trunc(Number(limit)), 1), 100) : CELL_MAIL_PAGE;
  const start = Number.isFinite(Number(offset)) ? Math.max(Math.trunc(Number(offset)), 0) : 0;
  const page = rows.slice(start, start + size);
  const more = Math.max(rows.length - (start + page.length), 0);
  return { page, more, nextOffset: more === 0 ? null : start + page.length, limit: size, offset: start };
}
function truncateCellMailBody(text2) {
  if (text2.length <= CELL_MAIL_BODY_MAX)
    return { body: text2, truncated: false, originalLength: text2.length };
  return { body: text2.slice(0, CELL_MAIL_BODY_MAX), truncated: true, originalLength: text2.length };
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
  return {
    ...state,
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
    "read-only children with `cellwork_recon` (1..8 questions in one blocking call), start BACKGROUND",
    "consults with `cellwork_delegate` and settle them with `cellwork_consult`, and you keep",
    "`cellwork_dispatch`/`cellwork_status`."
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
    "`cellwork_subteam`, plus the two background-delegation verbs `cellwork_delegate` and",
    "`cellwork_consult` — start up to 16 supervised consults in one call and settle them later. Starting",
    "and ending a cell belong to the PARENT captain, and the guard refuses those verbs for you. To leave",
    "this sub-cell, `cellwork_send` a stop request to the parent cell — the parent archives it and your",
    "record is kept."
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
function liveSessionOf(deps, sessionId) {
  const seam = deps.dsh.liveAgentExact;
  if (typeof seam !== "function" || sessionId === "")
    return;
  try {
    return seam.call(deps.dsh, sessionId) ?? undefined;
  } catch {
    return;
  }
}
function parentHeldExactly(deps, parent) {
  const seam = deps.dsh.liveAgentExact;
  if (typeof seam !== "function")
    return false;
  if (parent === undefined || parent === null || typeof parent !== "object")
    return false;
  try {
    return seam.call(deps.dsh, parent.id) === parent;
  } catch {
    return false;
  }
}
function engineForBarrier(deps) {
  const liveHandle = deps.dsh.compactionEngineForLiveAgent;
  if (typeof liveHandle === "function") {
    const fromHandle = liveHandle.call(deps.dsh, deps.agent);
    if (fromHandle !== undefined && fromHandle !== null)
      return fromHandle;
  }
  const fromRegistry = deps.dsh.compactionEngineForAgent(deps.sessionId);
  return fromRegistry === undefined || fromRegistry === null ? undefined : fromRegistry;
}
function reseedParentOf(deps) {
  const originalParent = deps.parentSessionId ?? "";
  const parent = liveSessionOf(deps, originalParent);
  if (parent !== undefined)
    return { parent, source: "parent", sessionId: originalParent };
  const captainSession = deps.cell.captainSessionId ?? "";
  const captain = liveSessionOf(deps, captainSession);
  if (captain !== undefined)
    return { parent: captain, source: "captain", sessionId: captainSession };
  return;
}
function reseedMaxDepthOf(parent) {
  const session = parent.session;
  if (typeof session !== "object" || session === null)
    return 1;
  const header = session.header;
  if (typeof header !== "object" || header === null)
    return 1;
  const record = header;
  const raw = Number(record.delegationDepth);
  if (Number.isFinite(raw) && raw >= 1)
    return Math.floor(raw) + 1;
  return record.origin === "subagent" ? 2 : 1;
}
function compactionJournalEntry(memberName, result) {
  return {
    event: "compaction",
    member: memberName,
    outcome: result.outcome,
    attempts: result.attempts,
    reason: result.reason,
    ...result.newHandle === undefined ? {} : { newHandle: result.newHandle },
    ...result.parentSource === undefined ? {} : { parentSource: result.parentSource, parentSessionId: result.parentSessionId }
  };
}
function checkpointUnrecoverableEntry(memberName, result) {
  return {
    event: "checkpoint-unrecoverable",
    member: memberName,
    attempts: result.attempts,
    reason: result.reason,
    ...result.retirement === undefined ? {} : { retirement: result.retirement },
    ...result.retirementReason === undefined ? {} : { retirementReason: result.retirementReason },
    repair: "reassign the rows this member owns: cellwork_dispatch {reassign:[{task_id, owner}]}"
  };
}
function memberAfterBarrier(previous, result, retryBound) {
  const failures = (previous.barrierFailures ?? 0) + 1;
  const reopened = result.outcome === "promoted";
  const givenUp = !reopened && (result.outcome === "refused" || failures >= retryBound);
  const fenceReason = result.reason + "; " + String(failures) + " of " + String(retryBound) + " consecutive barrier runs did not reopen the seat";
  return {
    name: previous.name,
    role: previous.role,
    sessionId: result.newHandle ?? previous.sessionId,
    executorRef: result.newHandle ?? previous.executorRef,
    mode: givenUp ? "checkpoint" : "subcaptain",
    handoffReady: givenUp,
    handoffs: previous.handoffs,
    joinedAt: previous.joinedAt,
    ...previous.adopted === true ? { adopted: true } : {},
    ...reopened ? {} : previous.checkpointSince === undefined ? {} : { checkpointSince: previous.checkpointSince },
    ...reopened ? {} : { barrierFailures: failures },
    ...givenUp ? { fenced: true, fencedReason: fenceReason } : {}
  };
}
function retireOriginal(deps, authority) {
  const interrupt = deps.dsh.interruptAgent;
  const identity = deps.dsh.liveAgentExact;
  if (typeof interrupt !== "function" || typeof identity !== "function") {
    return { retirement: "unavailable", reason: "this composition exposes no " + (typeof interrupt !== "function" ? "interruptAgent" : "liveAgentExact") + " seam, so no retirement could be performed or verified" };
  }
  if (liveSessionOf(deps, deps.sessionId) === undefined) {
    return { retirement: "nothing-to-retire", reason: "the identity registry holds no live agent for session " + JSON.stringify(deps.sessionId) + ", so there was nothing to retire" };
  }
  try {
    interrupt.call(deps.dsh, deps.sessionId, { kind: "ancestor", agent: authority });
    return { retirement: "accepted" };
  } catch (error) {
    return { retirement: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}
async function promoteAfterHandoff(deps) {
  let lastReason = "not attempted";
  const classifications = [];
  for (let attempt = 1;attempt <= deps.config.compactionRetries; attempt += 1) {
    if (attempt > 1)
      await deps.sleep(deps.config.idleBarrierDelayMs);
    const engine = engineForBarrier(deps);
    if (engine === undefined || typeof engine.compactNow !== "function") {
      lastReason = "no-engine";
      classifications.push(lastReason);
      continue;
    }
    const { signal } = compactionSignal(deps.signal);
    try {
      const result = await engine.compactNow(deps.agent, signal);
      const outcome = classifyCompactionResult(result);
      lastReason = outcome;
      classifications.push(outcome);
      if (outcome === "compacted") {
        deps.injectDirective(promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep));
        return { outcome: "promoted", attempts: attempt, reason: outcome };
      }
    } catch (error) {
      lastReason = classifyCompactionError(error, signal);
      classifications.push(lastReason);
      if (lastReason === "aborted" && deps.signal?.aborted === true)
        return { outcome: "refused", attempts: attempt, reason: "the caller cancelled the barrier" };
    }
  }
  const busyThroughout = classifications.length > 0 && classifications.every((entry) => entry === "busy");
  const busyNote = busyThroughout ? "; the engine reported `busy` on every attempt: the host's compactNow needs an IDLE agent (runMaintenance refuses an open turn) while `agent/turn-stopping` fires inside the turn, so in-place compaction cannot run at this event — the reseed is the only path" : "";
  const parent = reseedParentOf(deps);
  if (parent === undefined) {
    return {
      outcome: "refused",
      attempts: deps.config.compactionRetries,
      reason: lastReason + busyNote + "; reseed-parent-unavailable (parent session " + JSON.stringify(deps.parentSessionId ?? "") + " and captain session " + JSON.stringify(deps.cell.captainSessionId) + " are neither one a live agent the registry holds)"
    };
  }
  if (!parentHeldExactly(deps, parent.parent)) {
    return {
      outcome: "refused",
      attempts: deps.config.compactionRetries,
      reason: lastReason + "; reseed-parent-unavailable (the live registry no longer holds session " + JSON.stringify(parent.sessionId) + " as the exact instance the reseed would forward)"
    };
  }
  const retirement = retireOriginal(deps, parent.parent);
  try {
    const activation = await deps.dsh.startContinuableAgent({
      provider: "spawn",
      label: deps.memberName + " · " + deps.cell.teamId,
      request: {
        prompt: [{ type: "text", text: deps.handoffText + `

` + promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep) }],
        parent: parent.parent,
        maxDepth: reseedMaxDepthOf(parent.parent)
      },
      signal: compactionSignal().signal
    });
    const handle = typeof activation?.childId === "string" ? activation.childId : typeof activation?.id === "string" ? activation.id : "";
    if (handle === "")
      return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + busyNote + "; the reseed reported no child id", retirement: retirement.retirement, ...retirement.reason === undefined ? {} : { retirementReason: retirement.reason } };
    return { outcome: "reseeded", attempts: deps.config.compactionRetries, reason: lastReason + busyNote, newHandle: handle, parentSessionId: parent.sessionId, parentSource: parent.source, retired: retirement.retirement === "accepted", retirement: retirement.retirement, ...retirement.reason === undefined ? {} : { retirementReason: retirement.reason } };
  } catch (error) {
    return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + busyNote + "; the reseed failed: " + (error instanceof Error ? error.message : String(error)), retirement: retirement.retirement, ...retirement.reason === undefined ? {} : { retirementReason: retirement.reason } };
  }
}
function nextStepOf(text2) {
  const match = /(?:^|\n)(?:#{1,4}\s*|-?\s*)next step\s*:?\s*([^\n]*)/i.exec(text2);
  return match === null ? "" : match[1].trim();
}

// packages/mpd-cellwork-plugin/src/protocol.ts
import { readFileSync as readFileSync7 } from "node:fs";
function workspaceConfigReader(ctx) {
  return (dottedKey) => {
    const service = ctx.get?.("mpdConfig", false);
    if (service === undefined || service === null || typeof service.get !== "function")
      return;
    try {
      return service.get(dottedKey);
    } catch {
      return;
    }
  };
}
function readArgs2(args) {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return {};
  return args;
}
function argString2(args, key) {
  return typeof args[key] === "string" ? args[key] : "";
}
function seatKey(cell, name) {
  return "seat:" + cell.cellId + "/" + nameKey(name);
}
function seatAddress(cell, name) {
  return { id: seatKey(cell, name), name };
}
function parseMailOptions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'cellwork_send: `kind:"question"` requires a non-empty `options` array of {label, description?}' };
  }
  const options = [];
  for (const entry of value) {
    const option = typeof entry === "object" && entry !== null ? entry : null;
    const label = option !== null && typeof option.label === "string" ? option.label : "";
    if (label.trim() === "")
      return { ok: false, error: "cellwork_send: every option needs a non-empty `label`" };
    options.push({ label, ...typeof option?.description === "string" && option.description !== "" ? { description: option.description } : {} });
  }
  return options;
}
function parseMailSelected(value) {
  if (value === undefined)
    return [];
  if (!Array.isArray(value))
    return { ok: false, error: "cellwork_send: `selected` must be an array of offered label strings" };
  const selected = [];
  for (const entry of value) {
    if (typeof entry !== "string")
      return { ok: false, error: "cellwork_send: every `selected` entry must be an offered label string" };
    selected.push(entry);
  }
  return selected;
}
function planePressureOf(teams, workspace, teamId, memberName) {
  if (teamId === "" || memberName === "")
    return;
  const reading = teams?.memberContext?.(workspace, teamId, memberName);
  if (typeof reading !== "object" || reading === null)
    return;
  const row = reading;
  if (row.provenance !== "observed")
    return;
  if (typeof row.usedTokens !== "number" || typeof row.windowTokens !== "number")
    return;
  const ratio = typeof row.ratio === "number" ? row.ratio : row.windowTokens === 0 ? null : row.usedTokens / row.windowTokens;
  return { usedTokens: row.usedTokens, windowTokens: row.windowTokens, ratio, provenance: "observed" };
}
function planeDepthOf(teams, workspace, teamId) {
  if (teamId === "")
    return;
  const budget = teams?.depthBudget?.(workspace, teamId);
  if (typeof budget !== "object" || budget === null)
    return;
  const row = budget;
  if (typeof row.reason === "string" && row.reason !== "")
    return;
  if (typeof row.depth !== "number" || typeof row.depthMax !== "number")
    return;
  return { depth: row.depth, depthMax: row.depthMax };
}
function render(value) {
  return [{ type: "text", text: value }];
}
function mailBlock(message) {
  const lines = ["[" + String(message.from ?? "") + "] " + String(message.subject ?? "")];
  const kind = typeof message.kind === "string" ? message.kind : "message";
  const question = typeof message.question === "object" && message.question !== null ? message.question : undefined;
  const answer = typeof message.answer === "object" && message.answer !== null ? message.answer : undefined;
  if (kind === "question" && question !== undefined) {
    const options = Array.isArray(question.options) ? question.options : [];
    lines.push("QUESTION " + String(question.questionId ?? "") + (question.multiSelect === true ? " (multi-select)" : ""));
    lines.push(String(question.question ?? ""));
    for (const option of options)
      lines.push("  - " + String(option.label ?? ""));
  }
  if (kind === "answer" && answer !== undefined) {
    const selected = Array.isArray(answer.selected) ? answer.selected.map((entry) => String(entry)) : [];
    lines.push("ANSWER to " + String(answer.answerTo ?? ""));
    lines.push("  selected: " + (selected.length === 0 ? "(custom only)" : selected.join(" | ")));
    if (typeof answer.custom === "string" && answer.custom !== "")
      lines.push("  custom: " + answer.custom);
  }
  lines.push(String(message.body ?? ""));
  return lines.join(`
`);
}
function refusalText2(failure) {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed";
}
function errorText4(error) {
  return error instanceof Error ? error.message : String(error);
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
  const inFlight = new Set;
  const teams = () => {
    const service = deps.ctx.get?.("mpdTeams", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const actions = () => {
    const service = deps.ctx.get?.("mpdTeamActions", false);
    return typeof service === "object" && service !== null ? service : undefined;
  };
  const callerFor = (exec) => callerContext(dsh, exec, { teams });
  const recordOf2 = (workspace, teamId) => {
    if (teamId === "" || workspace === "")
      return;
    const record = teams()?.get?.(workspace, teamId);
    return typeof record === "object" && record !== null ? record : undefined;
  };
  const recordSeat = (cell, workspace, name) => {
    const record = recordOf2(workspace, cell.teamId);
    if (record === undefined)
      return {};
    const rows = Array.isArray(record.members) ? record.members.filter((row2) => typeof row2 === "object" && row2 !== null) : [];
    const row = rows.find((candidate) => candidate.name === name || candidate.id === name);
    if (row === undefined)
      return {};
    const mode = typeof row.mode === "string" && row.mode !== "" ? row.mode : undefined;
    const fenced = row.fenced === true;
    const closed = row.mode === "checkpoint" || fenced;
    if (!closed)
      return mode === undefined ? {} : { mode };
    const reason = fenced ? "the plane fenced this seat" + (typeof row.fencedReason === "string" && row.fencedReason !== "" ? " (" + row.fencedReason + ")" : "") : "the plane recorded a checkpoint for this seat (mode `checkpoint`), so it is fenced until the barrier reopens it";
    return { mode: "checkpoint", checkpoint: true, fenced, fenceReason: reason };
  };
  const transition = (workspace, next, entry, now) => {
    const lines = appendJournal(workspace, next.cellId, entry, now);
    const stamped = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor };
    writeCell(workspace, stamped);
    return { ...stamped, updatedAt: now.toISOString() };
  };
  const captainOnly = (caller, tool) => caller.sessionId === "" || caller.cell === null || caller.sessionId !== caller.cell.captainSessionId ? { ok: false, error: tool + " is CAPTAIN-ONLY: the captain of this cell is session " + String(caller.cell?.captainSessionId ?? "none") + ", which is not this caller" } : undefined;
  const livenessOf = (sessionId, anchorSessionId) => {
    if (sessionId === "")
      return "unknown";
    if (typeof dsh.liveAgentExact !== "function")
      return "unknown";
    try {
      if (dsh.liveAgentExact(sessionId) !== undefined)
        return "live";
      const capabilities = typeof dsh.capabilities === "function" ? dsh.capabilities() : undefined;
      if (capabilities?.agents !== true)
        return "unknown";
      if (anchorSessionId === "" || dsh.liveAgentExact(anchorSessionId) === undefined)
        return "unknown";
      return "dead";
    } catch {
      return "unknown";
    }
  };
  const checkpointSinceOf = (cell, member) => {
    if (member.checkpointSince !== undefined)
      return member.checkpointSince;
    for (let index = cell.checkpoints.length - 1;index >= 0; index -= 1) {
      const entry = cell.checkpoints[index];
      if (entry.sessionId !== "" && entry.sessionId === member.sessionId)
        return entry.at;
    }
    return;
  };
  const pendingMsOf = (since, now) => {
    if (since === undefined || since === "")
      return;
    const opened = Date.parse(since);
    return Number.isFinite(opened) ? Math.max(0, now.getTime() - opened) : undefined;
  };
  const forceBoundOf = (member, pendingMs) => {
    if ((member.barrierFailures ?? 0) >= config.compactionRetries)
      return "retry-budget";
    if (pendingMs !== undefined && pendingMs >= config.checkpointPendingMaxMs)
      return "stale";
    return;
  };
  const forceReadingOf = (cell, workspace, member, now) => {
    const seat = recordSeat(cell, workspace, member?.name ?? "");
    const barrierOwned = member?.mode === "checkpoint" || member?.handoffReady === true || seat.checkpoint === true;
    const since = member === undefined ? undefined : checkpointSinceOf(cell, member);
    const pendingMs = pendingMsOf(since, now);
    const liveness = member === undefined ? "unknown" : livenessOf(member.sessionId, cell.captainSessionId);
    const suspect = since !== undefined && liveness === "dead";
    const deadReseed = !barrierOwned && liveness === "dead" && member !== undefined && member.mode === "subcaptain" && member.handoffReady !== true;
    const closed = barrierOwned || deadReseed;
    const measured = { barrierOwned, suspect, deadReseed, closed, liveness, ...pendingMs === undefined ? {} : { pendingMs } };
    if (!closed)
      return { ...measured, forceEligible: false };
    if (liveness === "live")
      return { ...measured, forceEligible: false, refusal: "live-session" };
    const bound = deadReseed ? since === undefined ? member === undefined ? undefined : forceBoundOf(member, pendingMs) : "dead-session" : member === undefined ? undefined : forceBoundOf(member, pendingMs);
    if (bound === undefined)
      return { ...measured, forceEligible: false, refusal: "force-not-eligible" };
    return { ...measured, bound, forceEligible: true };
  };
  const planeRetryOf = (name) => 'agent_teams_control {action:"unfence", member:' + JSON.stringify(name) + "}";
  const reopenPlaneSeat = async (sessionId, name) => {
    const plane = actions();
    if (typeof plane?.unfence !== "function")
      return { plane: "absent", planeReason: "this composition exposes no mpdTeamActions.unfence seam, so the TEAM seat was NOT reopened" };
    try {
      const reply = await plane.unfence({ sessionId, member: name });
      if (reply?.ok === false)
        return { plane: "refused", planeReason: String(reply.error ?? "the team plane refused the unfence") };
      return { plane: "unfenced" };
    } catch (error) {
      return { plane: "refused", planeReason: error instanceof Error ? error.message : String(error) };
    }
  };
  const unfenceSeats = async (caller, cell, targets, now) => {
    const clearedRows = new Map;
    const outcomes = [];
    const cleared = [];
    for (const target of targets) {
      const row = cell.members[target.key];
      const cellFenced = row !== undefined && row.fenced === true;
      const seat = recordSeat(cell, caller.workspace, target.name);
      const teamFenced = seat.fenced === true;
      if (cellFenced) {
        const half = await reopenPlaneSeat(caller.sessionId, target.name);
        const reopened = { ...row, mode: "member", handoffReady: false };
        delete reopened.fenced;
        delete reopened.fencedReason;
        clearedRows.set(target.key, reopened);
        outcomes.push({ member: target.name, unfenced: true, plane: half.plane, ...half.planeReason === undefined ? {} : { planeReason: half.planeReason }, ...half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {} });
        cleared.push({ name: target.name, plane: half.plane });
        continue;
      }
      if (teamFenced) {
        const half = await reopenPlaneSeat(caller.sessionId, target.name);
        outcomes.push({ member: target.name, unfenced: half.plane === "unfenced", cellRow: "untouched", plane: half.plane, ...half.planeReason === undefined ? {} : { planeReason: half.planeReason }, ...half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {} });
        continue;
      }
      const reading = forceReadingOf(cell, caller.workspace, row, now);
      if (reading.closed && !target.force) {
        outcomes.push({ member: target.name, unfenced: false, reason: "checkpoint-pending", barrierOwned: reading.barrierOwned, ...reading.deadReseed ? { suspect: true } : {}, detail: reading.deadReseed ? "the record shows a DEAD-RESEED seat for this member (" + String(seat.fenceReason ?? "a reseeded row whose recorded session is not a live agent") + '): no barrier will run for it again, nothing was cleared, and the FORCED lever `unfence:[{member, force:true}]` reopens it under `bound:"dead-session"`' : "the record shows a held seat for this member (" + String(seat.fenceReason ?? "no `fenced` marker: a checkpoint window") + "), so the compaction barrier owns that state and nothing was cleared; the FORCED lever `unfence:[{member, force:true}]` exists for a seat the barrier can no longer run for" });
        continue;
      }
      if (reading.closed && target.force) {
        if (reading.refusal === "live-session") {
          outcomes.push({ member: target.name, unfenced: false, reason: "live-session", alive: true, sessionId: row?.sessionId ?? "", detail: "the recorded session is a LIVE agent, so this seat is not dead and the forced lever refuses to reopen it" });
          continue;
        }
        if (row === undefined || reading.bound === undefined) {
          outcomes.push({ member: target.name, unfenced: false, reason: "force-not-eligible", alive: false, sessionId: row?.sessionId ?? "", ...reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }, detail: "a forced clear needs a written licence: `barrierFailures` at the retry budget (" + String(config.compactionRetries) + "), a `checkpointSince` older than " + String(config.checkpointPendingMaxMs) + " ms, or a reseeded seat whose recorded session the registry PROVES dead. Nothing was written" });
          continue;
        }
        const bound = reading.bound;
        const reopened = { ...row, mode: "member", handoffReady: false };
        delete reopened.fenced;
        delete reopened.fencedReason;
        delete reopened.barrierFailures;
        delete reopened.checkpointSince;
        clearedRows.set(target.key, reopened);
        const half = await reopenPlaneSeat(caller.sessionId, target.name);
        outcomes.push({ member: target.name, unfenced: true, forced: true, alive: false, liveness: reading.liveness, sessionId: row.sessionId, bound, ...reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }, plane: half.plane, ...half.planeReason === undefined ? {} : { planeReason: half.planeReason }, ...half.plane === "refused" ? { retry: planeRetryOf(target.name) } : {} });
        cleared.push({ name: target.name, plane: half.plane, forced: { reason: bound, pendingMs: reading.pendingMs, barrierFailures: row.barrierFailures ?? 0, sessionId: row.sessionId, liveness: reading.liveness } });
        continue;
      }
      outcomes.push({ member: target.name, unfenced: false, reason: "not-fenced" });
    }
    if (cleared.length === 0)
      return { cell, outcomes };
    const fresh = readCell(caller.workspace, cell.cellId);
    const base = fresh.ok ? fresh.state : cell;
    const members = { ...base.members };
    for (const [key, reopened] of clearedRows)
      members[key] = reopened;
    let cursor = base.journalCursor;
    for (const row of cleared) {
      const retry = row.plane === "refused" ? { retry: planeRetryOf(row.name) } : {};
      cursor = appendJournal(caller.workspace, cell.cellId, row.forced === undefined ? { event: "member-unfenced", member: row.name, plane: row.plane, ...retry } : {
        event: "member-unfenced-forced",
        member: row.name,
        by: "captain",
        reason: row.forced.reason,
        ...row.forced.pendingMs === undefined ? {} : { pendingMs: row.forced.pendingMs },
        barrierFailures: row.forced.barrierFailures,
        sessionId: row.forced.sessionId,
        liveness: row.forced.liveness,
        plane: row.plane,
        ...retry
      }, now);
    }
    const next = { ...base, members, journalCursor: cursor > 0 ? cursor : base.journalCursor };
    return { cell: writeCell(caller.workspace, next), outcomes };
  };
  disposers.push(dsh.registerTool({
    name: "cellwork_dispatch",
    description: "CAPTAIN only: one owner-only dispatch pass over the live board. A ready task is paired ONLY with its declared owner; a busy, absent, FENCED or failed owner is REPORTED and the task left pending — never substituted (a fenced member is never messaged). `reassign` hands named rows to another member FIRST: each row is claimed for that member through the board, journaled as `task-reassigned`, then delivered — the repair for a fenced owner. `unfence` clears named members' compaction GIVE-UP fences BEFORE the pass — the repair for the other deadlock: a fenced row keeps `handoffReady:true`, so `cellwork_handoff` refuses it as STILL WAITING while only another SUCCESSFUL barrier could clear it, which a fenced member cannot start. THE CELL ROW'S OWN `fenced:true` IS THE GIVE-UP FACT (the compaction barrier writes the fence on the CELL row and nowhere else): that row loses `fenced`/`fencedReason`, returns to `mode: member` with `handoffReady:false` (its `handoffs` count is unchanged), AND the TEAM seat is reopened through the plane's `unfence` seam when this composition exposes one — the plane's `mode:\"checkpoint\"` counts as a closed seat and that seam clears it too. The answer reports the plane's half honestly as `unfenced`, `absent` or `refused` and never claims the member was reopened when no seam exists. A TEAM row at `mode:\"checkpoint\"` with NO `fenced` flag is a PENDING compaction, not a give-up — UNLESS the CELL row carries the marker above, in which case the CELL marker decides; on its own that pending checkpoint answers `{member, unfenced:false, reason:\"checkpoint-pending\"}` and NEITHER record is written, because the barrier owns it. A barrier-owned checkpoint is NOT a dead end: the forced lever `unfence:[{member, force:true}]` reopens it only at a written bound (`barrierFailures` at `compactionRetries`, a `checkpointSince` older than `checkpointPendingMaxMs`, or the DEAD-RESEED shape — a reseeded `subcaptain` row whose recorded session the registry PROVES dead, `bound:\"dead-session\"`), and a plane half that ends `refused` carries `retry`, the exact `agent_teams_control {action:\"unfence\", member}` verb that re-drives it; the `unfence` parameter below spells out every bound. An explicit `fenced:true` recorded ONLY on the TEAM record is cleared through that seam while the CELL row is left untouched, and the outcome says which half was cleared. A member that is not fenced in either record answers `{member, unfenced:false, reason: not-fenced}` (never a silent success), and an unknown name refuses the whole call with the recorded members named. `unfence` and `reassign` may travel in ONE call and neither interferes with the other. Delivery goes through the team executor and is journaled.",
    parameters: {
      type: "object",
      properties: {
        reassign: {
          type: "array",
          description: "Rows to hand to another member BEFORE the pass: each is claimed for that member on the board, journaled, then delivered to it. Use it to repair the rows a fenced owner still holds.",
          items: {
            type: "object",
            properties: {
              task_id: { type: "string", description: "The board row to hand over (`T17`)." },
              owner: { type: "string", description: "The member that should own and receive the row." }
            },
            required: ["task_id", "owner"],
            additionalProperties: false
          }
        },
        unfence: {
          type: "array",
          description: 'Member names whose compaction GIVE-UP fence this call CLEARS before the pass (captain-only, like the verb). The CELL row\'s own `fenced:true` is the give-up fact: that row loses `fenced`/`fencedReason`, returns to `mode: member` with `handoffReady:false`, and keeps its `handoffs` count, while the TEAM seat is reopened through the plane\'s `unfence` seam when this composition exposes one (the plane\'s `mode:"checkpoint"` is a closed spelling and that seam clears it too). A give-up fence recorded ONLY on the TEAM record (an explicit `fenced:true`) is cleared there while the CELL row is left untouched. A TEAM row at `mode:"checkpoint"` with no `fenced` marker is barrier-owned and, on its own, answers `reason:"checkpoint-pending"` and writes nothing — the CELL marker above outranks it. A member that is not fenced in either record is reported as not-fenced, never as a silent success; a name that matches no single member (unknown, or ambiguous once normalized) refuses the whole call. `{member, force:true}` is the LAST RESORT for a seat the barrier can no longer run for: it reopens a BARRIER-OWNED checkpoint (the CELL row\'s own `mode`/`handoffReady` or the TEAM row\'s `mode:"checkpoint"`) ONLY when the recorded session is not a live agent AND a written bound is reached — `barrierFailures` at `compactionRetries`, or a `checkpointSince` older than `checkpointPendingMaxMs` (15 minutes). A bare `force` is never a licence: a live seat, a fresh window, zero failures and a missing timestamp all write NOTHING. THE DEAD-RESEED SEAT IS COVERED BY THE SAME PREDICATE (R5.2): a reseeded row (`mode:"subcaptain"`, `handoffReady:false`, a `checkpointSince`) whose recorded session the registry PROVES dead is answer `checkpoint-pending` unforced and force-clearable with `bound:"dead-session"` — the clock bound is never reached by a seat no live agent can drive. A plane half that answers `refused` names the exact retry verb (`agent_teams_control {action:"unfence", member}`) in the answer AND in the journal row, so a refusal is never a dead end. The journal row is `member-unfenced-forced` (`by:"captain"`, the bound as `reason`, `pendingMs`, `barrierFailures`, `sessionId`, `liveness`, `plane`), the answer adds `alive`/`sessionId`, and the seat is reopened for REASSIGNMENT, NOT for work — its context was never compacted. May travel with `reassign`.',
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  member: { type: "string", description: "The member whose barrier-owned checkpoint this call reopens." },
                  force: { type: "boolean", description: "Ask for the BOUNDED FORCED lever: a barrier-owned `checkpoint` reopen is allowed ONLY when the recorded session is not live AND a written bound is reached (the barrier's retry budget, or a window older than `checkpointPendingMaxMs`). A bare force on a live seat, a fresh window or a seat with no recorded bound writes NOTHING." }
                },
                required: ["member"],
                additionalProperties: false
              }
            ]
          }
        }
      },
      additionalProperties: false
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          pairs: { type: "array", items: { type: "object" } },
          skipped: { type: "array", items: { type: "object" } },
          reassigned: { type: "array", items: { type: "object" }, description: "One entry per readable `reassign` pair: whether the board claim landed and whether the message was delivered." },
          reassignInvalid: { type: "array", items: { type: "string" }, description: "One sentence per `reassign` entry this call refused to read." },
          unfenced: { type: "array", items: { type: "object" }, description: 'One entry per distinct `unfence` member (duplicates collapse to one): `{member, unfenced:true, plane, planeReason?}` for a cleared CELL give-up fence (the CELL row\'s `fenced:true`, whatever the TEAM row says), `{member, unfenced:false, reason:"not-fenced"}` when neither record reports a marker, `{member, unfenced:false, reason:"checkpoint-pending", detail}` only when the CELL row carries no `fenced:true` AND the TEAM row is at `mode:"checkpoint"` with no `fenced` flag (the compaction barrier owns it, nothing was written), and `{member, unfenced, cellRow:"untouched", plane, planeReason?}` when an explicit TEAM-only fence was cleared while the CELL row was left untouched. `plane` is `unfenced` (the TEAM seat was reopened through the seam), `absent` (this composition exposes no `unfence` seam, so no reopen is claimed) or `refused` (with the plane\'s own sentence in `planeReason`). A FORCED clear answers `{member, unfenced:true, forced:true, alive:false, liveness:"dead"|"unknown", sessionId, bound:"retry-budget"|"stale", pendingMs?, plane, planeReason?}`, and a forced request that is refused writes nothing and answers `reason:"live-session"` or `reason:"force-not-eligible"` with a `detail` sentence. The dead-reseed seat (a reseeded `subcaptain` row whose recorded session the registry PROVES dead) is held by the SAME predicate and its forced clear names `bound:"dead-session"`. Any outcome whose plane half ended `refused` ALSO carries `retry`: the exact Lead-only verb (`agent_teams_control {action:"unfence", member}`) that re-drives the seam, echoed in the render and in the journal row.' },
          refused: { type: "string" }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        const unfenced = Array.isArray(result.unfenced) ? result.unfenced : [];
        const retryOf = (row) => typeof row.retry === "string" && row.retry !== "" ? " · the plane half still needs: " + row.retry : "";
        const lines = unfenced.map((row) => row.forced === true ? "unfence " + String(row.member) + " (FORCED, " + String(row.reason ?? row.bound ?? "bound reached") + "): reopened for reassignment, not for work — the barrier never reopened this seat (" + (row.plane === "unfenced" ? "the TEAM row was reopened through the plane" : row.plane === "absent" ? "this composition exposes no mpdTeamActions.unfence seam, so the TEAM row may still be closed" : "the TEAM row was NOT cleared: " + String(row.planeReason ?? "the team plane refused the unfence")) + ")" : row.reason === "live-session" || row.reason === "force-not-eligible" ? "unfence " + String(row.member) + ": NOT cleared (" + String(row.reason) + ") — " + String(row.detail ?? "") : row.cellRow === "untouched" ? "unfence " + String(row.member) + ": the CELL row carried no fence marker, so it was left untouched — " + (row.plane === "unfenced" ? "the TEAM row was unfenced through the plane" : row.plane === "absent" ? "the TEAM record reports the seat fenced, but this composition exposes no mpdTeamActions.unfence seam, so the TEAM row is STILL fenced" : "the TEAM row was NOT cleared: " + String(row.planeReason ?? "the team plane refused the unfence")) : "unfence " + String(row.member) + ": " + (row.unfenced !== true ? row.reason === "checkpoint-pending" ? row.suspect === true ? "DEAD-RESEED — no barrier will run for this seat again and no live agent is left, so nothing was cleared; the FORCED lever cellwork_dispatch {unfence:[{member:" + JSON.stringify(String(row.member)) + ", force:true}]} reopens it for reassignment" : "checkpoint pending — the compaction barrier owns this seat, so nothing was cleared in either record" : "not fenced — nothing was written" : row.plane === "absent" ? "cell row cleared — this composition exposes no mpdTeamActions.unfence seam, so the TEAM seat was NOT reopened (it stays closed until the barrier or the plane reopens it)" : row.plane === "refused" ? "cell row cleared, but the TEAM seat was NOT reopened: " + String(row.planeReason ?? "the team plane refused the unfence") : "cell row cleared and the TEAM seat reopened through the plane"));
        const clears = lines.map((line, index) => line + retryOf(unfenced[index]));
        if (result.ok === false)
          return render(["cellwork_dispatch refused: " + String(result.error ?? "unknown refusal"), ...clears].join(`
`));
        const pairs = Array.isArray(result.pairs) ? result.pairs : [];
        const skipped = Array.isArray(result.skipped) ? result.skipped : [];
        const reassigned = Array.isArray(result.reassigned) ? result.reassigned : [];
        const invalid = Array.isArray(result.reassignInvalid) ? result.reassignInvalid.map((entry) => String(entry)) : [];
        const handovers = reassigned.map((row) => "reassign " + String(row.taskId) + " -> " + String(row.owner) + ": " + (row.delivered === true ? "claimed on the board and delivered" : row.claimed === true ? "CLAIMED, delivery failed: " + String(row.reason ?? "unknown") : "not claimed: " + String(row.reason ?? "unknown")));
        if (typeof result.refused === "string")
          return render([...clears, ...handovers, ...invalid, "cellwork_dispatch refused: " + result.refused].join(`
`));
        return render([...clears, ...handovers, ...invalid, ...pairs.length === 0 ? ["nothing else dispatched" + (skipped.length === 0 ? "" : " (" + skipped.map((row) => String(row.subject) + ": " + String(row.reason)).join("; ") + ")")] : [...pairs.map((row) => String(row.subject) + " -> " + String(row.memberName)), ...skipped.length === 0 ? [] : ["reported: " + skipped.length]]].join(`
`));
      }
    },
    execute: async (args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      const refused = captainOnly(caller, "cellwork_dispatch");
      if (refused !== undefined)
        return refused;
      const cell = caller.cell;
      if (cell.phase === "stopped")
        return { ok: false, error: "cellwork_dispatch: cell " + cell.cellId + " is stopped and archived" };
      const rawUnfence = readArgs2(args)["unfence"];
      if (rawUnfence !== undefined && !Array.isArray(rawUnfence))
        return { ok: false, error: "cellwork_dispatch: `unfence` must be an array of member names, or of `{member, force}` objects for the bounded forced lever" };
      const unfenceRequests = [];
      for (const entry of rawUnfence ?? []) {
        if (typeof entry === "string") {
          unfenceRequests.push({ name: entry.trim(), force: false });
          continue;
        }
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          return { ok: false, error: "cellwork_dispatch: every `unfence` entry must be a member name, or an object `{member, force}`" };
        }
        const shaped = entry;
        if (typeof shaped.member !== "string" || shaped.member.trim() === "") {
          return { ok: false, error: "cellwork_dispatch: a `{member, force}` entry must name a non-empty `member`" };
        }
        if (shaped.force !== undefined && typeof shaped.force !== "boolean") {
          return { ok: false, error: "cellwork_dispatch: `force` must be a boolean when it is present" };
        }
        unfenceRequests.push({ name: shaped.member.trim(), force: shaped.force === true });
      }
      if (unfenceRequests.some((request) => request.name === ""))
        return { ok: false, error: "cellwork_dispatch: every `unfence` entry must be a non-empty member name" };
      const unfenceTargets = [];
      const seenTargets = new Set;
      for (const request of unfenceRequests) {
        const name = request.name;
        const resolved = resolveMemberName(cell.members, name);
        if (resolved === undefined) {
          const recorded = Object.keys(cell.members);
          return { ok: false, error: "cellwork_dispatch: " + JSON.stringify(name) + " is not a member of cell " + cell.cellId + " (members: " + (recorded.length === 0 ? "none recorded" : recorded.join(", ")) + ")" };
        }
        if (seenTargets.has(resolved.key))
          continue;
        seenTargets.add(resolved.key);
        unfenceTargets.push({ key: resolved.key, name: resolved.member.name, force: request.force });
      }
      const plane = actions();
      if (plane?.dispatch === undefined)
        return { ok: false, error: "cellwork_dispatch: this composition exposes no mpdTeamActions service, so the team plane cannot be asked to pair rows" };
      const now = new Date;
      const applied = unfenceTargets.length === 0 ? { cell, outcomes: [] } : await unfenceSeats(caller, cell, unfenceTargets, now);
      const unfenced = applied.outcomes;
      const current = applied.cell;
      const rawReassign = readArgs2(args)["reassign"];
      const reply = await plane.dispatch({
        sessionId: caller.sessionId,
        mode: "owner-only",
        ...rawReassign === undefined ? {} : { reassign: rawReassign }
      });
      if (reply?.ok === false)
        return { ok: false, error: String(reply.error ?? "the team plane refused the pass"), ...unfenced.length === 0 ? {} : { unfenced } };
      const pairs = Array.isArray(reply.pairs) ? reply.pairs : [];
      const reassigned = Array.isArray(reply.reassigned) ? reply.reassigned : [];
      const skipped = Array.isArray(reply.skipped) ? reply.skipped.map((row) => row.reason === "cancelled" ? { ...row, reason: "CANCELLED — the row is terminal on the board, so no pass may pair it" } : row).filter((row) => row.reason !== "already completed" && !String(row.reason).startsWith("not ready (status ")) : [];
      const abandoned = new Set(Object.values(current.cancelledTasks ?? {}).filter((id) => id !== ""));
      for (const taskId of abandoned) {
        if (skipped.some((row) => String(row.taskId) === taskId))
          continue;
        skipped.push({ taskId, subject: "", reason: "CANCELLED — this cell's record abandoned the row, so no pass may pair it" });
      }
      if (reassigned.length > 0) {
        appendJournal(caller.workspace, cell.cellId, { event: "dispatch-reassign", claimed: reassigned.filter((row) => row.claimed === true).length, delivered: reassigned.filter((row) => row.delivered === true).length, rejected: reassigned.filter((row) => row.claimed !== true).length }, now);
      }
      appendJournal(caller.workspace, cell.cellId, { event: "dispatch-pass", pairs: pairs.length, skipped: skipped.length }, now);
      return { ok: true, pairs, skipped, ...unfenced.length === 0 ? {} : { unfenced }, ...reassigned.length === 0 ? {} : { reassigned } };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_supervise",
    description: "CAPTAIN only: one READ-ONLY sweep of the cell — every member's mode / handoff state / live context ratio, the pending board tasks, the stale-split flags, the CLOSED seats together with the open rows they own, and the unread mail (including rows whose wake-up never went out). CLOSED SEATS COME IN THREE KINDS and the sweep names which, because only TWO of them are the captain's to repair: a GIVE-UP fence (an explicit `fenced:true` on EITHER record) gets the two levers — `reassign` its open rows with `cellwork_dispatch {reassign:[...]}`, and clear the fence with `cellwork_dispatch {unfence:[...]}`; a BARRIER-OWNED seat (the TEAM/CELL row at `mode:\"checkpoint\"` with NO `fenced` marker, the window every handoff opens) is reported with `barrierOwned`, `forceEligible` and `pendingMs` — the compaction barrier OWES that seat its reopen, but nothing supervises the barrier, so a seat it can no longer run for needs the BOUNDED forced lever (`cellwork_dispatch {unfence:[{member, force:true}]}`, allowed only when the recorded session is not live and the window's written bound is reached). A DEAD-RESEED seat (a reseeded `subcaptain` row whose recorded session the registry PROVES dead and which no barrier will run for) is reported as a closed seat with `barrierOwned:false`, `suspect:true` and the same `forceEligible` answer the verb uses — ONE predicate, so the lever the sweep advertises is the lever `unfence:[{member, force:true}]` accepts. A closed seat whose TEAM half is a `checkpoint` no barrier is pending for carries `retry`, the exact Lead-only verb that reopens it. A member is reported `suspect:true` only when a window stamp exists, the registry is PRESENT, its CAPTAIN anchor resolves, and the recorded session does not — a present registry that cannot resolve that anchor answers `unknown`, which licenses nothing. Call it on every wake-up; it mutates nothing.",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." }
    }, additionalProperties: false },
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
          fenced: { type: "array", items: { type: "object" }, description: 'Every CLOSED member with the reason and the OPEN board rows it still owns. Each row carries `giveUp:true` for a real GIVE-UP fence (an explicit `fenced:true` on either record) — the rows a `reassign` pass repairs and `cellwork_dispatch {unfence:[name]}` clears — or `giveUp:false` for a HELD seat with no fence marker — the compaction barrier\'s `mode:"checkpoint"` window, or the DEAD-RESEED shape flagged `deadReseed:true`. Every closed-seat row ALSO carries `barrierOwned` (a checkpoint spelling, not a fence marker, is what holds it), `forceEligible` (the FORCED `unfence:[{member, force:true}]` lever would be allowed RIGHT NOW — computed by the SAME predicate the verb decides with, so the two cannot disagree), `pendingMs` (how long the window has been open, when a timestamp exists), `suspect:true` for the DEAD-RESEED shape (a reseeded seat whose recorded session the registry proves dead), and `retry` when the TEAM half is a `checkpoint` no barrier is pending for — the exact Lead-only verb that reopens it (R5.4). A barrier-owned seat is not automatically safe: nothing supervises the barrier, so the render names the force lever and its bound instead of promising that no action is needed.' },
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
        const fenced = Array.isArray(result.fenced) ? result.fenced : [];
        return render([
          "cell " + String(result.cellId ?? "") + " · phase " + String(result.phase ?? "") + " · split " + String(result.splitRevision ?? "none") + (result.staleSplit === true ? " (STALE)" : "") + " · requirements rev " + String(result.requirementsRevision ?? 0),
          "members: " + members.map((row) => String(row.name) + "[" + String(row.mode) + (row.handoffReady === true ? ",handoff-ready" : "") + (row.suspect === true ? ",SUSPECT" : "") + (typeof row.ratio === "number" ? "," + Math.round(row.ratio * 100) + "%" : "") + (row.suspect === true ? ": the recorded session is not a live agent, so the reseed did not produce a working child" : "") + "]").join(" "),
          "tasks: " + (tasks.length === 0 ? "none" : tasks.map((row) => String(row.id) + " " + String(row.status) + (row.owner === undefined ? "" : "(" + String(row.owner) + ")")).join(" ")),
          "fenced: " + (fenced.length === 0 ? "none" : fenced.map((row) => {
            const name = String(row.name);
            const reason = String(row.reason);
            const owned = Array.isArray(row.tasks) ? row.tasks.map((id) => String(id)) : [];
            if (row.giveUp !== true) {
              const deadReseed = row.deadReseed === true;
              const blocked = row.liveness === "live" ? "the recorded session is still a LIVE agent" : row.pendingMs === undefined ? "no checkpoint timestamp is recorded, and a missing timestamp is never a licence" : "the written bound is not reached yet (`barrierFailures` below the retry budget and the window younger than the pending bound)";
              const retry = typeof row.retry === "string" ? " · the TEAM seat is still `checkpoint` while no barrier is pending for it, so the plane half needs " + row.retry : "";
              return name + " (" + reason + ", " + (deadReseed ? "DEAD-RESEED" : "BARRIER-OWNED") + ") " + (owned.length > 0 ? "owns " + owned.join(", ") + " — " : "") + (row.forceEligible === true ? deadReseed ? "the reseed's child is not a live agent, so nothing will reopen this seat by itself; the bounded lever is allowed now: cellwork_dispatch {unfence:[{member:" + JSON.stringify(name) + ", force:true}]} — it reopens the seat for REASSIGNMENT, not for work (its context was never compacted)" : "the barrier has NOT reopened this seat and no supervisor can; the bounded lever is allowed now: cellwork_dispatch {unfence:[{member:" + JSON.stringify(name) + ", force:true}]} — it reopens the seat for REASSIGNMENT, not for work (its context was never compacted)" : "the barrier reopens this seat when it completes; nothing supervises it, so if it never does, the bounded lever becomes available once the retry budget or the pending bound is reached — " + blocked) + retry;
            }
            return name + " (" + reason + ") owns " + (owned.length > 0 ? owned.join(", ") + " — reassign those with cellwork_dispatch {reassign:[{task_id, owner}]}, and" : "no open row —") + " clear the fence with cellwork_dispatch {unfence:[" + JSON.stringify(name) + "]}";
          }).join("; ")),
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
      const now = new Date;
      const record = recordOf2(caller.workspace, cell.teamId);
      const tasks = record !== undefined && Array.isArray(record.tasks) ? record.tasks : [];
      const members = Object.values(cell.members).map((member) => {
        const plane = planePressureOf(teams(), caller.workspace, cell.teamId, member.name);
        const seat = recordSeat(cell, caller.workspace, member.name);
        const pressure = plane ?? dsh.contextPressure(member.sessionId === "" ? member.name : member.sessionId);
        const reading = forceReadingOf(cell, caller.workspace, member, now);
        return {
          name: member.name,
          mode: seat.mode ?? member.mode,
          role: member.role,
          handoffReady: seat.checkpoint ?? member.handoffReady,
          handoffs: member.handoffs,
          ratio: pressure.ratio,
          usedTokens: pressure.usedTokens,
          windowTokens: pressure.windowTokens,
          provenance: pressure.provenance,
          liveness: reading.liveness,
          ...reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs },
          ...reading.suspect ? { suspect: true } : {},
          ...reading.pendingMs === undefined && !reading.closed ? {} : { forceEligible: reading.forceEligible }
        };
      });
      const messages = foldCellMail(readCellMail(caller.workspace, cell.cellId));
      const fenced = Object.values(cell.members).flatMap((member) => {
        const seat = recordSeat(cell, caller.workspace, member.name);
        const giveUp = member.fenced === true || seat.fenced === true;
        const reason = member.fenced === true ? fenceReasonOf(member) : seat.fenceReason ?? fenceReasonOf(member);
        const reading = forceReadingOf(cell, caller.workspace, member, now);
        if (!reading.closed && !giveUp || reason === undefined)
          return [];
        const planeOnly = seat.checkpoint === true && seat.fenced !== true && member.mode !== "checkpoint" && member.handoffReady !== true;
        const owned = tasks.filter((task) => {
          const status = String(task.status ?? "");
          return status !== "completed" && status !== "failed" && nameKey(String(task.owner ?? "")) === nameKey(member.name);
        }).map((task) => String(task.id ?? ""));
        return [{ name: member.name, mode: seat.mode ?? member.mode, reason, tasks: owned, giveUp, barrierOwned: reading.barrierOwned, forceEligible: reading.forceEligible, liveness: reading.liveness, ...reading.suspect ? { suspect: true } : {}, ...reading.deadReseed ? { deadReseed: true } : {}, ...reading.pendingMs === undefined ? {} : { pendingMs: reading.pendingMs }, ...planeOnly ? { retry: planeRetryOf(member.name) } : {} }];
      });
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
        fenced,
        unreadMail: messages.filter((message) => !message.read).length,
        wakeFailures: wakeFailures(messages).map((message) => ({ id: message.id, to: message.to, subject: message.subject, reason: message.wakeReason ?? "no wake-up was attempted" }))
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_context",
    description: "Any cell seat: the caller's OWN live context occupancy — used tokens, the observed window and its provenance, the ratio, the checkpoint threshold in force, and whether a checkpoint would fire at this step. Never transitions the cell: its ONE write is ADOPTING a live team seat the record never learned, so a member added mid-run becomes a seat. Never guesses a window (provenance `no-window`/`unavailable` answers null).",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." }
    }, additionalProperties: false },
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
      const plane = planePressureOf(teams(), caller.workspace, caller.cell.teamId, caller.member);
      const pressure = plane ?? dsh.contextPressure(exec.agent);
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
    description: "A MEMBER's checkpoint duty: validate a handoff document (task, state, decisions, artifacts, verified facts, open questions, next step), write `handoff/<member>-<n>.md`, mark the member handoff-ready and journal it. A member known only to the LIVE team record is ADOPTED first — mirrored into the cell record by this call — and then gets the same channel. The result tells the agent to END ITS TURN; the plugin then compacts and promotes (or reseeds) it.",
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
      if (caller.adoptionFailure !== undefined) {
        const failure = caller.adoptionFailure;
        return { ok: false, error: "cellwork_handoff: this seat (" + JSON.stringify(caller.member) + ") was NOT adopted — " + (failure.kind === "read" ? "the cell record could not be read" : "the cell record could not be written") + ": " + failure.detail + ". The TEAM checkpoint was NOT recorded; retry once the cell record is " + (failure.kind === "read" ? "readable" : "writable") };
      }
      if (caller.sessionId === caller.cell.captainSessionId)
        return { ok: false, error: "cellwork_handoff: the captain is never checkpointed (declared bound) — it dispatches, it does not hand off" };
      if (member.handoffReady) {
        return { ok: false, error: "cellwork_handoff: the handoff " + JSON.stringify(caller.member) + " already wrote (handoff/" + String(member.handoffs) + ") is STILL WAITING for the compaction barrier — END YOUR TURN now instead of writing a second document; the barrier compacts and promotes you from the FIRST one" };
      }
      const content = argString2(readArgs2(args), "content");
      if (content.trim() === "")
        return { ok: false, error: "cellwork_handoff: `content` is required — the handoff document IS the continuity, so there is nothing to validate without it" };
      const validation = validateHandoffText(content);
      if (!validation.ok)
        return { ok: false, error: "cellwork_handoff: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", "), ...{ missing: validation.missing, sections: validation.sections } };
      const ordinal = member.handoffs + 1;
      const plane = actions();
      if (plane?.handoff === undefined)
        return { ok: false, error: "cellwork_handoff: this composition exposes no mpdTeamActions service, so the checkpoint cannot be recorded and the seat would stay open" };
      const recorded = await plane.handoff({ sessionId: caller.sessionId, content });
      if (recorded?.ok === false)
        return { ok: false, error: String(recorded.error ?? "the team plane refused the handoff, so nothing was written") };
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
      const planeDepth = planeDepthOf(teams(), caller.workspace, parent.teamId);
      const parentDepth = planeDepth?.depth ?? parent.depth;
      const childDepth = parentDepth + 1;
      const depthMax = planeDepth?.depthMax ?? config.depthMax;
      if (childDepth > depthMax) {
        return { ok: false, error: "cellwork_subteam: REFUSED — a sub-cell at depth " + String(childDepth) + " exceeds cellwork.depth.max = " + String(depthMax) + " (this cell is depth " + String(parentDepth) + "). Do the work inside this cell instead." };
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
    description: "Any cell seat: send one durable cell message to `captain`, a member of this cell by name, or `<cellId>/<captain|member>` for a cell in this cell's tree (a sub-cell it registered, or its parent). Optional STRUCTURED mail: `kind` (`message`|`question`|`answer`); a question carries `options` (+`multiSelect`) and its `questionId` defaults to its own message id; an answer carries `replyTo` (the question's message id), `selected` (the offered labels copied VERBATIM) and/or `custom` — an unknown label is refused WITH the valid label list, and the answer's `questionId` defaults to the answered question's. `broadcast:true` mints ONE ROW PER SEAT of the target cell (the sender excluded). MAILBOX FULL: a recipient with `mail.maxUndelivered` undelivered messages is refused (the key is read per call from the workspace config; its DEFAULT is 8, and `agent_teams_mail` shares the SAME bound, so the official tool is not a fallback). Two recoveries: acknowledge that inbox (`cellwork_inbox` for a cell seat, or `agent_teams_mail {action:\"read\"}` for a team member), or reassign the rows behind it (`cellwork_dispatch {reassign:[{task_id, owner}]}`). The row(s) are written to the workspace mailbox FIRST (atomic fan-out through the shared store), then a wake-up is attempted per row when the sender is this cell's captain and the recipient holds a handle; the attempt's outcome is appended as a `wake` record, so a failed wake-up leaves the row in place and is surfaced on `cellwork_supervise`. The journal carries the `cell:<cellId>` stamp.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "`captain`, a cell member's board name, or `<cellId>/<captain|member>` for a cross-cell recipient in this cell's tree. With `broadcast:true`, its cell part selects the target cell (`*` means this cell)." },
        subject: { type: "string", description: "One-line subject (also a question's header)." },
        body: { type: "string", description: "The message text, delivered verbatim (also a question's text)." },
        kind: { type: "string", description: "`message`, `question` or `answer`; omitted means it is INFERRED from `options` (question) or `selected`/`custom` (answer), else `message`." },
        options: { type: "array", description: "A question's offered options, labels unique within the question.", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"], additionalProperties: false } },
        multiSelect: { type: "boolean", description: "A question may take several labels instead of exactly one." },
        replyTo: { type: "string", description: "The message id this row replies to; an answer's question message id (its `answerTo`)." },
        broadcast: { type: "boolean", description: "Fan out one row per seat of the target cell, sender excluded." },
        selected: { type: "array", description: "An answer's offered labels, copied VERBATIM from the question.", items: { type: "string" } },
        custom: { type: "string", description: "An answer's free text; alone it replaces the one label of a single-select answer." },
        questionId: { type: "string", description: "A question's stable key (defaults to its message id) or the answered question's key (defaults to the referenced question's)." }
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
          ids: { type: "array", items: { type: "string" }, description: "One id per row; a broadcast has several." },
          to: { type: "string" },
          broadcast: { type: "boolean" },
          rows: { type: "array", items: { type: "object" }, description: "One `{id, to, wakeSent, wakeReason?}` per fan-out row." },
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
        if (result.broadcast === true) {
          const rows = Array.isArray(result.rows) ? result.rows : [];
          return render("mail fan-out: " + String(rows.length) + " row(s) -> " + rows.map((row) => String(row.to ?? "")).join(", ") + " (" + String(result.ids instanceof Array ? result.ids.join(", ") : "") + ")");
        }
        return render("mail " + String(result.id ?? "") + " -> " + String(result.to ?? "") + (result.wakeSent === true ? " (wake-up sent)" : " (durable; " + String(result.wakeReason ?? "no wake-up was attempted") + ")"));
      }
    },
    execute: async (args, exec) => {
      const argv = readArgs2(args);
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      const cell = caller.cell;
      if (cell === null || caller.member === "")
        return { ok: false, error: "cellwork_send: this session belongs to no active cell" };
      const requested = argString2(argv, "to").trim();
      if (requested === "")
        return { ok: false, error: "cellwork_send: `to` is required (`captain`, a member name, or `<cellId>/<captain|member>` for a cell in this cell's tree)" };
      const subject = argString2(argv, "subject").trim();
      const body = argString2(argv, "body");
      if (subject === "" || body.trim() === "")
        return { ok: false, error: "cellwork_send: `subject` and `body` are both required" };
      const storedBody = truncateCellMailBody(body);
      const broadcast = argv.broadcast === true;
      const kindArg = argString2(argv, "kind").trim();
      const replyTo = argString2(argv, "replyTo").trim();
      const questionIdArg = argString2(argv, "questionId").trim();
      const multiSelect = argv.multiSelect === true;
      const rawOptions = argv.options;
      const rawSelected = argv.selected;
      const custom = argString2(argv, "custom");
      const slash = requested.lastIndexOf("/");
      const targetCellId = slash < 0 ? cell.cellId : requested.slice(0, slash).trim();
      const requestedName = slash < 0 ? requested : requested.slice(slash + 1).trim();
      if (!broadcast && requestedName === "")
        return { ok: false, error: "cellwork_send: " + JSON.stringify(requested) + " names no recipient — use `<cellId>/<captain|member>`" };
      const crossCell = targetCellId !== cell.cellId;
      let target = cell;
      if (crossCell) {
        if (targetCellId !== cell.parentCellId && !cell.subcellIds.includes(targetCellId)) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(targetCellId) + " is not in this cell's tree — a cross-cell recipient must be a SUB-CELL of " + cell.cellId + " (" + (cell.subcellIds.join(", ") || "none") + ") or its parent cell (" + (cell.parentCellId ?? "none") + ")" };
        }
        const read = readCell(caller.workspace, targetCellId);
        if (!read.ok)
          return { ok: false, error: "cellwork_send: the cross-cell recipient's record at " + read.path + " cannot be read (" + read.reason + ": " + read.detail + ") — nothing was sent", path: read.path };
        target = read.state;
      }
      const now = new Date;
      const hasOptions = rawOptions !== undefined;
      const hasAnswerPayload = rawSelected !== undefined || custom.trim() !== "";
      let kind;
      if (kindArg === "")
        kind = hasOptions ? "question" : hasAnswerPayload ? "answer" : "message";
      else if (kindArg === "message" || kindArg === "question" || kindArg === "answer")
        kind = kindArg;
      else
        return { ok: false, error: "cellwork_send: `kind` must be `message`, `question` or `answer`" };
      if (kind !== "question" && (hasOptions || multiSelect)) {
        return { ok: false, error: "cellwork_send: `options`/`multiSelect` belong to a `question` row; this payload is a `" + kind + "`" };
      }
      if (kind !== "answer" && (hasAnswerPayload || kind === "message" && questionIdArg !== "")) {
        return { ok: false, error: "cellwork_send: `selected`/`custom`/`questionId` belong to an `answer` row; this payload is a `" + kind + "`" };
      }
      let question;
      let answer;
      let questionId = questionIdArg;
      if (kind === "question") {
        const parsedOptions = parseMailOptions(rawOptions);
        if (!Array.isArray(parsedOptions))
          return parsedOptions;
        questionId = questionIdArg !== "" ? questionIdArg : nextCellMailId(caller.workspace, now);
        question = { questionId, header: subject, question: body, options: parsedOptions, ...multiSelect ? { multiSelect: true } : {} };
      }
      if (kind === "answer") {
        if (replyTo === "")
          return { ok: false, error: 'cellwork_send: `kind:"answer"` requires `replyTo` = the message id of the QUESTION row being answered' };
        const asked = findWorkspaceMailById(caller.workspace, replyTo) ?? foldCellMail(readCellMail(caller.workspace, targetCellId)).find((message) => message.id === replyTo);
        if (asked === undefined) {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names no message in this workspace's mailbox — pass the QUESTION row's message id (every `cellwork_inbox` row shows its id)" };
        }
        if (asked.kind === "answer") {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names an ANSWER row, not a question — an answer answers a question, not another answer" };
        }
        if (asked.question === undefined) {
          return { ok: false, error: "cellwork_send: `replyTo` " + JSON.stringify(replyTo) + " names a " + JSON.stringify(String(asked.kind ?? "message")) + " row with no question payload (no questionId, no options) — only a question can be answered" };
        }
        questionId = questionIdArg !== "" ? questionIdArg : asked.question.questionId;
        const parsedSelected = parseMailSelected(rawSelected);
        if (!Array.isArray(parsedSelected))
          return parsedSelected;
        answer = { questionId, answerTo: replyTo, selected: parsedSelected, ...custom.trim() === "" ? {} : { custom } };
      }
      let outbound;
      if (broadcast) {
        const seats = [
          seatAddress(target, "captain"),
          ...Object.values(target.members).map((member) => seatAddress(target, member.name))
        ];
        const candidates = seats.filter((seat) => crossCell || nameKey(seat.name) !== nameKey(caller.member));
        outbound = fanOutTargets(seatKey(cell, caller.member), candidates);
        if (outbound.length === 0)
          return { ok: false, error: "cellwork_send: a broadcast has no other seat to address in cell " + targetCellId };
      } else {
        const toCaptain = nameKey(requestedName) === "captain";
        const recipient = toCaptain ? undefined : resolveMemberName(target.members, requestedName);
        if (!toCaptain && recipient === undefined) {
          return { ok: false, error: "cellwork_send: " + JSON.stringify(requestedName) + " is neither `captain` nor an unambiguous member of cell " + targetCellId + " (members: " + Object.keys(target.members).join(", ") + ")" };
        }
        const to = toCaptain ? "captain" : String(recipient?.member.name ?? requestedName);
        const self = toCaptain ? caller.member === "captain" : recipient !== undefined && (recipient.key === caller.member || recipient.member.name === caller.member);
        if (!crossCell && self)
          return { ok: false, error: "cellwork_send: a seat cannot message itself" };
        outbound = [toCaptain ? seatAddress(target, "captain") : seatAddress(target, String(recipient?.member.name ?? to))];
      }
      const memberIds = Object.values(target.members).map((member) => seatKey(target, member.name));
      const leadIds = [seatKey(target, "captain")];
      const undeliveredBound = mailMaxUndeliveredOf(workspaceConfigReader(deps.ctx));
      const input = {
        fromId: seatKey(cell, caller.member),
        fromName: caller.member,
        toId: outbound[0].id,
        toName: outbound[0].name,
        subject,
        body: storedBody.body,
        memberIds,
        leadIds,
        teamId: target.teamId,
        cellId: targetCellId,
        fromMemberId: caller.member,
        maxUndelivered: undeliveredBound,
        ...crossCell ? { fromCell: cell.cellId } : {},
        ...kind === "message" ? {} : { kind },
        ...replyTo === "" ? {} : { replyTo },
        ...question === undefined ? {} : { question },
        ...answer === undefined ? {} : { answer }
      };
      let sent;
      try {
        sent = sendMany(caller.workspace, input, outbound, now);
      } catch (error) {
        return { ok: false, error: "cellwork_send: the message row(s) could not be written — no message was sent and no wake-up was attempted (mail is durable first): " + errorText4(error) };
      }
      if (!sent.ok)
        return { ok: false, error: "cellwork_send refused: " + sent.detail };
      const delivered = [];
      for (let index = 0;index < sent.messages.length; index += 1) {
        const message = sent.messages[index];
        const address = outbound[index];
        const recipientMember = Object.values(target.members).find((member) => seatKey(target, member.name) === address.id);
        const attemptWake = async () => {
          if (crossCell)
            return { sent: false, reason: "cross-cell mail is DURABLE ONLY — this cell holds no Lead authority over " + targetCellId + ", so its captain wakes the row (it shows on that cell's `cellwork_supervise`)" };
          if (nameKey(address.name) === "captain")
            return { sent: false, reason: "the Lead has no executor handle in this composition; the captain reads it on `cellwork_inbox`" };
          if (caller.sessionId !== cell.captainSessionId)
            return { sent: false, reason: "only the captain holds the Lead authority the executor needs; a member-to-member message is durable and read on `cellwork_inbox`" };
          if (String(recipientMember?.executorRef ?? "") === "")
            return { sent: false, reason: "the recipient has no executor handle (never raised)" };
          const wake = sendThroughExecutor(dsh.teamExecutor(), exec.agent);
          if (wake === undefined)
            return { sent: false, reason: "this composition exposes no team executor" };
          await wake(String(recipientMember?.executorRef ?? ""), "[mpd-cellwork] mail from " + caller.member + ": " + subject + `

` + storedBody.body + `

(full row: cell ` + cell.cellId + ")");
          return { sent: true };
        };
        const delivery = await deliverCellMail({
          appendSend: () => true,
          attemptWake,
          appendWake: (outcome) => appendCellMail(caller.workspace, targetCellId, { t: "wake", id: message.id, sent: outcome.sent, ...outcome.reason === undefined ? {} : { reason: outcome.reason }, at: now.toISOString() })
        });
        delivered.push({ id: message.id, to: message.toName, wakeSent: delivery.wakeSent, ...delivery.wakeReason === undefined ? {} : { wakeReason: delivery.wakeReason } });
        appendJournal(caller.workspace, cell.cellId, { event: "mail", cell: "cell:" + cell.cellId, id: message.id, from: caller.member, to: message.toName, ...crossCell ? { toCell: targetCellId } : {}, subject, wakeSent: delivery.wakeSent }, now);
      }
      if (!broadcast) {
        const only = delivered[0];
        return { ok: true, id: only.id, to: only.to, wakeSent: only.wakeSent, ...crossCell ? { crossCell: targetCellId, fromCell: cell.cellId } : {}, ...only.wakeReason === undefined ? {} : { wakeReason: only.wakeReason }, ...storedBody.truncated ? { truncated: true, originalLength: storedBody.originalLength } : {} };
      }
      return {
        ok: true,
        broadcast: true,
        to: "*",
        id: delivered[0].id,
        ids: delivered.map((row) => row.id),
        rows: delivered,
        ...crossCell ? { crossCell: targetCellId, fromCell: cell.cellId } : {}
      };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_inbox",
    description: "Any cell seat: read and ACKNOWLEDGE the unread cell mail addressed to this seat (its member name, or `captain`), PAGED (`limit` default 20, `offset` default 0) with `more`/`nextOffset`; only the rows ON THE PAGE are acknowledged, so rows past the cap stay unread until fetched. A `question` row renders its offered labels explicitly and an `answer` row renders its selected labels, so nothing has to be counted; reply with `cellwork_send {kind:\"answer\", replyTo:<question id>, selected:[...]}`. The rows are durable; reading them acknowledges each row ONCE (the shared store's `read` record, or the legacy log's for a pre-unification row).",
    parameters: { type: "object", properties: {
      limit: { type: "integer", description: "Rows to render (default 20, clamped 1..100)." },
      offset: { type: "integer", description: "First row of the page (default 0)." }
    }, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          seat: { type: "string" },
          messages: { type: "array", items: { type: "object" } },
          acknowledged: { type: "number" },
          refused: { type: "array", items: { type: "object" } },
          offset: { type: "integer" },
          more: { type: "integer" },
          unreadTotal: { type: "integer" },
          nextOffset: { oneOf: [{ type: "integer" }, { type: "null" }] }
        },
        required: ["ok"]
      },
      render: (_args, value) => {
        const result = typeof value === "object" && value !== null ? value : {};
        if (result.ok === false)
          return render("cellwork_inbox refused: " + String(result.error ?? "unknown refusal"));
        const messages = Array.isArray(result.messages) ? result.messages : [];
        const refused = Array.isArray(result.refused) ? result.refused : [];
        const refusalNote = refused.length === 0 ? "" : `

acknowledgement refused for ` + String(refused.length) + " row(s), which stay unread: " + refused.map((entry) => String(entry.id ?? "?") + " (" + String(entry.reason ?? "no reason given") + ")").join("; ");
        if (messages.length === 0)
          return render("no unread cell mail for " + String(result.seat ?? "?") + " — if a question is blocked here, ask the captain to check `cellwork_supervise`" + refusalNote);
        return render(messages.map((message) => mailBlock(message)).join(`

---

`) + (typeof result.more === "number" && result.more > 0 ? `

(showing ` + String(messages.length) + " of " + String(result.unreadTotal ?? "?") + "; more: " + String(result.more) + " — next page offset=" + String(result.nextOffset) + ", which also leaves them UNREAD until fetched)" : "") + refusalNote);
      }
    },
    execute: async (args, exec) => {
      const caller = callerFor(exec);
      if (caller.refusal !== null)
        return { ok: false, error: refusalText2(caller.refusal), path: caller.refusal.path };
      if (caller.cell === null || caller.member === "")
        return { ok: false, error: "cellwork_inbox: this session belongs to no active cell" };
      const seat = caller.member === "captain" ? "captain" : caller.member;
      const messages = foldCellMail(readCellMail(caller.workspace, caller.cell.cellId));
      const unread = unreadFor(messages, [seat]);
      const paged = pageCellMail(unread, Number(argString2(readArgs2(args), "limit") || "20"), Number(argString2(readArgs2(args), "offset") || "0"));
      const page = paged.page;
      const now = new Date;
      const ack = acknowledgeCellMail(caller.workspace, caller.cell.cellId, page.map((message) => message.id), { byId: seatKey(caller.cell, seat), byName: seat }, now);
      if (ack.moved.length > 0)
        appendJournal(caller.workspace, caller.cell.cellId, { event: "mail-read", cell: "cell:" + caller.cell.cellId, seat, ids: ack.moved }, now);
      return {
        ok: true,
        seat,
        messages: page.map((message) => ({
          id: message.id,
          from: message.from,
          subject: message.subject,
          body: message.body,
          at: message.at,
          kind: message.kind,
          threadId: message.threadId,
          ...message.replyTo === undefined ? {} : { replyTo: message.replyTo },
          ...message.question === undefined ? {} : { question: message.question },
          ...message.answer === undefined ? {} : { answer: message.answer },
          ...message.truncated === true ? { truncated: true, originalLength: message.originalLength } : {}
        })),
        acknowledged: ack.moved.length,
        refused: ack.refused,
        offset: paged.offset,
        more: paged.more,
        unreadTotal: unread.length,
        nextOffset: paged.nextOffset
      };
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
      const logged = applyCheckpoint(caller.cell, plan, String(caller.cell.members[caller.member]?.sessionId ?? caller.sessionId), now);
      const injected = logged.members[caller.member];
      const next = injected === undefined ? logged : {
        ...logged,
        members: {
          ...logged.members,
          [caller.member]: {
            ...injected,
            mode: "checkpoint",
            ...injected.checkpointSince === undefined ? { checkpointSince: now.toISOString() } : {}
          }
        }
      };
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
  const parentSessionOf = (agent) => {
    const handle = typeof agent === "object" && agent !== null ? agent : undefined;
    const session = typeof handle?.session === "object" && handle.session !== null ? handle.session : undefined;
    const header = typeof session?.header === "object" && session.header !== null ? session.header : undefined;
    return typeof header?.parentSession === "string" ? header.parentSession : "";
  };
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
        handoffText = readFileSync7(handoffPath(caller.workspace, caller.cell.cellId, caller.member, member.handoffs), "utf8");
      } catch {
        handoffText = "(the handoff document could not be read back; the journal names its path)";
      }
      const parentSessionId = parentSessionOf(agent);
      const result = await promoteAfterHandoff({
        dsh,
        agent,
        memberName: caller.member,
        sessionId: member.sessionId,
        parentSessionId,
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
      const barrierRow = memberAfterBarrier(fresh.state.members[caller.member] ?? member, result, config.compactionRetries);
      const cellReopened = barrierRow.fenced !== true;
      const plane = cellReopened ? await reopenPlaneSeat(caller.cell.captainSessionId, caller.member) : { plane: "skipped-fenced", planeReason: "this barrier FENCED the CELL seat on the same run (the retry bound gave up), so the TEAM seat stays closed with it" };
      const settled = readCell(caller.workspace, caller.cell.cellId);
      if (!settled.ok)
        deps.warn("[mpd-cellwork] the compaction barrier could not re-read " + settled.path + " after the plane call: " + settled.detail + " — merging into the pre-await snapshot");
      const base = settled.ok ? settled.state : fresh.state;
      const updated = memberAfterBarrier(base.members[caller.member] ?? member, result, config.compactionRetries);
      const next = { ...base, members: { ...base.members, [caller.member]: updated } };
      if (cellReopened) {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "member-unfenced",
          member: caller.member,
          by: "barrier",
          plane: plane.plane,
          ...plane.planeReason === undefined ? {} : { planeReason: plane.planeReason },
          ...plane.plane === "refused" ? { retry: planeRetryOf(caller.member) } : {}
        }, now);
      } else if (result.outcome !== "refused") {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "plane-reopen-skipped",
          member: caller.member,
          by: "barrier",
          plane: plane.plane,
          ...plane.planeReason === undefined ? {} : { planeReason: plane.planeReason }
        }, now);
      }
      if (result.outcome === "refused")
        appendJournal(caller.workspace, caller.cell.cellId, checkpointUnrecoverableEntry(caller.member, result), now);
      if (result.outcome === "reseeded") {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "member-reseeded",
          member: caller.member,
          previousSessionId: member.sessionId,
          newSessionId: result.newHandle ?? "",
          retired: result.retired === true,
          ...result.retirement === undefined ? {} : { retirement: result.retirement },
          ...result.retirementReason === undefined ? {} : { retirementReason: result.retirementReason },
          plane: plane.plane
        }, now);
      }
      if (result.outcome === "reseeded" && result.parentSource !== undefined) {
        appendJournal(caller.workspace, caller.cell.cellId, {
          event: "reseed-parent",
          member: caller.member,
          parentSource: result.parentSource,
          parentSessionId: result.parentSessionId ?? "",
          originalParentSessionId: parentSessionId,
          newHandle: result.newHandle ?? ""
        }, now);
      }
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
      return runBarrier(agent).catch((error) => {
        deps.warn("[mpd-cellwork] the compaction barrier failed: " + (error instanceof Error ? error.message : String(error)));
      });
    } catch (error) {
      deps.warn("[mpd-cellwork] the turn-stopping listener failed: " + (error instanceof Error ? error.message : String(error)));
      return;
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
function memberDivergence(record, state) {
  if (record === undefined)
    return { missingFromCell: [], missingFromTeam: [], inSync: true };
  const liveRows = [];
  for (const row of Array.isArray(record.members) ? record.members : []) {
    if (typeof row === "object" && row !== null && typeof row.name === "string" && row.name !== "")
      liveRows.push(row.name);
  }
  const liveKeys = new Set(liveRows.map((name2) => roleKey(name2)));
  const cellRows = Object.values(state.members).map((member) => member.name).filter((name2) => name2 !== "");
  const cellKeys = new Set(cellRows.map((name2) => roleKey(name2)));
  const missingFromCell = liveRows.filter((name2) => !cellKeys.has(roleKey(name2)));
  const missingFromTeam = cellRows.filter((name2) => !liveKeys.has(roleKey(name2)));
  return { missingFromCell, missingFromTeam, inSync: missingFromCell.length === 0 && missingFromTeam.length === 0 };
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
    seatOf: (exec) => callerContext(dsh, exec, { teams: () => teamsService(ctx), adopt: false }).seat,
    warn
  });
  if (guard.dispose !== undefined)
    disposers.push(guard.dispose);
  disposers.push(dsh.registerTool({
    name: "cellwork_status",
    description: "Report one cell: phase, objective, captain, requirements/split revisions, members and their modes, injected checkpoints, the live team's member/task counts and the on-disk paths. Defaults to the workspace's ACTIVE cell; pass `cellId` to read another. Never transitions the cell: its ONE write is ADOPTING a live team seat the record never learned, so a member added mid-run is reportable.",
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
          splitTaskId: { type: "string" },
          memberDivergence: {
            type: "object",
            properties: {
              missingFromCell: { type: "array", items: { type: "string" } },
              missingFromTeam: { type: "array", items: { type: "string" } },
              inSync: { type: "boolean" }
            },
            required: ["missingFromCell", "missingFromTeam", "inSync"]
          },
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
      const teamRecord = teamRecordOf(ctx, caller.workspace, state.teamId);
      const counts = teamCounts(teamRecord);
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
        splitTaskId: state.splitTaskId ?? "",
        memberDivergence: memberDivergence(teamRecord, state),
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
          const partialState = { ...next, teamId: staged.teamId ?? next.teamId, members: { ...next.members, ...staged.members ?? {} }, splitTaskId: staged.tasks?.splitId ?? next.splitTaskId ?? "" };
          recordTransition(caller.workspace, partialState, { event: "planning-team-partial", teamId: partialState.teamId, planName: staged.planName ?? "", members: Object.keys(staged.members ?? {}), splitTaskId: partialState.splitTaskId ?? "", error: staged.error ?? "", ...staged.ownerRepairError === undefined ? {} : { ownerRepairError: staged.ownerRepairError } }, now);
          return { ok: false, error: (staged.error ?? "cellwork_start: staging the planning team failed") + " — the partial plan slot is recorded on this cell; call `cellwork_start` again and it RESUMES that slot" };
        }
        stagedState = { ...next, teamId: staged.teamId ?? next.teamId, members: { ...next.members, ...staged.members ?? {} }, splitTaskId: staged.tasks?.splitId ?? next.splitTaskId ?? "" };
        recordTransition(caller.workspace, stagedState, { event: "planning-team-staged", teamId: stagedState.teamId, members: Object.keys(staged.members ?? {}), tasks: staged.tasks ?? {}, splitTaskId: stagedState.splitTaskId ?? "", ...staged.ownerRepaired === true ? { splitTicketOwnerRepaired: staged.tasks?.splitId ?? "" } : {}, ...staged.ownerRepairError === undefined ? {} : { ownerRepairError: staged.ownerRepairError } }, now);
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
    execute: async (args, exec) => {
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
      await stopConsultCleanup?.({ cellId: state.cellId, teamId: state.teamId, workspace });
      const stopped = { ...state, phase: "stopped", archived: true, stopReason: reason };
      recordTransition(workspace, stopped, { event: "stop", reason, forced, inProgress }, now);
      return { ok: true, cellId: state.cellId, archived: true, forced, reason, inProgress, statePath: statePath(workspace, state.cellId) };
    }
  }));
  disposers.push(dsh.registerTool({
    name: "cellwork_open",
    description: "The PROGRAMMATIC cell entry: create one cell for an objective and return its activation directive. CAPTAIN-ONLY (a member or a delegated child may not open a second front); refuses when a cell is already active in this workspace; a `mandate` is accepted only when `.mpd/autoproject/<runId>/escalation.json` exists. `/cellwork` is the same path with a live turn to submit into.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The objective, in the user's terms." },
        mandate: { type: "string", description: "The autoproject run id whose escalation.json authorises this cell." }
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
          path: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          statePath: { type: "string" },
          directive: { type: "string" },
          injected: { type: "boolean" }
        },
        required: ["ok"]
      },
      render: (_args, value) => render2(value)
    },
    execute: async (args, exec) => {
      const workspace = dsh.workspaceRoot(exec);
      const sessionId = sessionIdOf(exec.agent);
      const refusal = nonCaptainCallerReason(exec.agent);
      if (refusal !== undefined)
        return { ok: false, error: "cellwork_open is CAPTAIN-ONLY: " + refusal };
      const outcome = openCell({
        workspace,
        objective: String(readArgs3(args)["objective"] ?? ""),
        captainSessionId: sessionId,
        ...typeof readArgs3(args)["mandate"] === "string" ? { mandate: String(readArgs3(args)["mandate"]) } : {},
        now: new Date
      });
      if (!outcome.ok)
        return { ok: false, error: outcome.error, ...outcome.path === undefined ? {} : { path: outcome.path } };
      let injected = false;
      try {
        dsh.injectAgentMessage(exec.agent, dsh.userMessage({ text: outcome.directive, source: { kind: "mpd-cellwork", reason: "activation-directive" } }));
        injected = true;
      } catch {
        injected = false;
      }
      return { ok: true, cellId: outcome.cellId, phase: outcome.phase, statePath: outcome.statePath, directive: outcome.directive, injected };
    }
  }));
  const runCellworkCommand = (invocation) => {
    const objective = String(invocation?.rawInput ?? "").trim();
    if (objective === "")
      return { kind: "error", text: CELLWORK_USAGE };
    const workspace = dsh.workspaceRoot({ agent: invocation?.agent });
    const outcome = openCell({
      workspace,
      objective,
      captainSessionId: sessionIdOf(invocation?.agent),
      now: new Date,
      submit: (text2) => invocation?.submit?.(dsh.userMessage({ text: text2, source: { kind: "mpd-cellwork", reason: "activation-directive" } })) === true
    });
    return outcome.ok ? { kind: "success", text: "cellwork active: " + outcome.cellId + " — the activation directive was submitted as this agent's next turn" } : { kind: "error", text: outcome.error };
  };
  let stopConsultCleanup;
  disposers.push(...installCellworkFlow({ dsh, ctx, config: cfg, warn, onConsultStop: (hook) => {
    stopConsultCleanup = hook;
  } }));
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
function nonCaptainCallerReason(agent) {
  const handle = typeof agent === "object" && agent !== null ? agent : undefined;
  const session = typeof handle?.session === "object" && handle.session !== null ? handle.session : undefined;
  const header = typeof session?.header === "object" && session.header !== null ? session.header : undefined;
  const id = typeof session?.id === "string" && session.id !== "" ? session.id : "(unknown session)";
  if (header === undefined)
    return;
  if (header.origin === "subagent")
    return "session " + id + " was recorded as a delegated subagent, so it cannot open a cell of its own";
  if (typeof header.parentSession === "string" && header.parentSession !== "")
    return "session " + id + " is a child of session " + header.parentSession + ", so it cannot open a cell of its own";
  if (typeof header.delegationDepth === "number" && header.delegationDepth > 0)
    return "session " + id + " sits at delegation depth " + String(header.delegationDepth) + ", so it cannot open a cell of its own";
  return;
}
function readArgs3(args) {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
}
export {
  apply,
  inject,
  name
};
