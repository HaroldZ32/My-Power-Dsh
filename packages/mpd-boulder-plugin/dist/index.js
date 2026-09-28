// packages/mpd-boulder-plugin/src/vendor/constants.ts
var BOULDER_DIR = ".mpd";
var BOULDER_FILE = "boulder.json";
var BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`;
var NOTEPAD_DIR = "notepads";
var NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`;
var PROMETHEUS_PLANS_DIR = ".mpd/plans";
// packages/mpd-boulder-plugin/src/vendor/plan-checklist.ts
var SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
var TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
var FINAL_VERIFICATION_HEADING_PATTERN = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
var SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/;
var FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
var TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/;
var FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i;
function parsePlanChecklist(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (!hasStructuredSection(lines)) {
    return parseSimpleChecklist(lines);
  }
  return parseStructuredPlan(lines).checklist;
}
function parseStructuredPlan(lines) {
  let remaining = 0;
  let total = 0;
  let nextTaskLabel = null;
  let nextTask = null;
  let section = "other";
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    if (SECTION_BOUNDARY_HEADING_PATTERN.test(line)) {
      section = parseStructuredSectionHeading(line);
      continue;
    }
    if (section === "other") {
      continue;
    }
    const checkbox = parseStructuredTopLevelCheckbox(line, section);
    if (checkbox === null) {
      continue;
    }
    total += 1;
    if (checkbox.checked) {
      continue;
    }
    remaining += 1;
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label;
      nextTask = checkbox.task;
    }
  }
  return {
    checklist: {
      completed: total - remaining,
      remaining,
      total,
      nextTaskLabel
    },
    nextTask
  };
}
function parseSimpleChecklist(lines) {
  let remaining = 0;
  let total = 0;
  let nextTaskLabel = null;
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    const checkbox = parseSimpleTopLevelCheckbox(line);
    if (checkbox === null) {
      continue;
    }
    total += 1;
    if (checkbox.checked) {
      continue;
    }
    remaining += 1;
    if (nextTaskLabel === null) {
      nextTaskLabel = checkbox.label;
    }
  }
  return { completed: total - remaining, remaining, total, nextTaskLabel };
}
function parseSimpleTopLevelCheckbox(line) {
  const match = line.match(SIMPLE_CHECKBOX_PATTERN);
  const marker = match?.[1];
  const label = match?.[2];
  if (marker === undefined || label === undefined) {
    return null;
  }
  return { checked: marker.toLowerCase() === "x", label };
}
function hasStructuredSection(lines) {
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    if (parseStructuredSectionHeading(line) !== "other") {
      return true;
    }
  }
  return false;
}
function parseStructuredSectionHeading(line) {
  if (TODO_HEADING_PATTERN.test(line)) {
    return "todo";
  }
  if (FINAL_VERIFICATION_HEADING_PATTERN.test(line)) {
    return "final-wave";
  }
  return "other";
}
function parseStructuredTopLevelCheckbox(line, section) {
  const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN;
  const match = line.match(pattern);
  const marker = match?.[1];
  const label = match?.[2];
  if (marker === undefined || label === undefined) {
    return null;
  }
  const task = buildTaskRef(section, label);
  if (task === null) {
    return null;
  }
  return { checked: marker.toLowerCase() === "x", label, task };
}
function buildTaskRef(section, label) {
  const pattern = section === "todo" ? /^([1-9]\d*)\. (.+)$/ : /^(F[1-9]\d*)\. (.+)$/i;
  const match = label.match(pattern);
  const rawLabel = match?.[1];
  const title = match?.[2];
  if (rawLabel === undefined || title === undefined) {
    return null;
  }
  return {
    key: `${section}:${rawLabel.toLowerCase()}`,
    section,
    label: rawLabel,
    title
  };
}
function parseOpeningFence(line) {
  const match = line.match(FENCE_PATTERN);
  const run = match?.[1];
  const info = match?.[2];
  const marker = run?.charAt(0);
  if (run === undefined || info === undefined || marker !== "`" && marker !== "~" || marker === "`" && info.includes("`")) {
    return null;
  }
  return { marker, length: run.length };
}
function isClosingFence(line, fence) {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
  return run?.charAt(0) === fence.marker && run.length >= fence.length;
}
// packages/mpd-boulder-plugin/src/vendor/storage/path.ts
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
function getBoulderFilePath(directory) {
  return join(directory, BOULDER_DIR, BOULDER_FILE);
}
function resolveTrackedPath(baseDirectory, trackedPath) {
  return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath);
}
function resolveBoulderPlanPath(directory, state) {
  const absolutePlanPath = resolveTrackedPath(directory, state.active_plan);
  const worktreePath = state.worktree_path?.trim();
  if (!worktreePath) {
    return absolutePlanPath;
  }
  const absoluteDirectory = resolve(directory);
  const relativePlanPath = relative(absoluteDirectory, absolutePlanPath);
  if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
    return absolutePlanPath;
  }
  const absoluteWorktreePath = resolveTrackedPath(directory, worktreePath);
  const worktreePlanPath = resolve(absoluteWorktreePath, relativePlanPath);
  return existsSync(worktreePlanPath) ? worktreePlanPath : absolutePlanPath;
}
function resolveBoulderPlanPathForWork(directory, work) {
  return resolveBoulderPlanPath(directory, work);
}
// packages/mpd-boulder-plugin/src/vendor/storage/plan-progress.ts
import { existsSync as existsSync2, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join as join2 } from "node:path";
var LEGACY_PROMETHEUS_PLANS_DIR = ".sisyphus/plans";
var PROMETHEUS_PLAN_DIRS = [PROMETHEUS_PLANS_DIR, LEGACY_PROMETHEUS_PLANS_DIR];
function findPrometheusPlans(directory) {
  try {
    return PROMETHEUS_PLAN_DIRS.flatMap((planDir) => {
      const plansDir = join2(directory, planDir);
      if (!existsSync2(plansDir)) {
        return [];
      }
      return readdirSync(plansDir).filter((file) => file.endsWith(".md")).map((file) => join2(plansDir, file));
    }).sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  } catch {
    return [];
  }
}
function getPlanName(planPath) {
  return basename(planPath, ".md");
}
function getPlanProgress(planPath) {
  if (!existsSync2(planPath)) {
    return { total: 0, completed: 0, isComplete: false };
  }
  try {
    const content = readFileSync(planPath, "utf-8");
    const checklist = parsePlanChecklist(content);
    return {
      total: checklist.total,
      completed: checklist.completed,
      isComplete: checklist.total > 0 && checklist.remaining === 0
    };
  } catch {
    return { total: 0, completed: 0, isComplete: false };
  }
}
// packages/mpd-boulder-plugin/src/vendor/storage/shared.ts
var RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
var SESSION_ID_PREFIX_PATTERN = /^(codex|opencode|senpi|dsh):/;
function normalizeSessionId(sessionId, platform = "dsh") {
  if (SESSION_ID_PREFIX_PATTERN.test(sessionId)) {
    return sessionId;
  }
  return `${platform}:${sessionId}`;
}
function nowIsoString() {
  return new Date().toISOString();
}
function parseIsoToMs(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
function getElapsedMs(startedAt, endedAt) {
  const startedMs = parseIsoToMs(startedAt);
  const endedMs = parseIsoToMs(endedAt);
  if (startedMs === null || endedMs === null) {
    return;
  }
  return endedMs - startedMs;
}
function isValidWorkStatus(status) {
  return status === "active" || status === "completed" || status === "paused" || status === "abandoned";
}
function buildWorkFromMirror(state) {
  const planName = state.plan_name ?? state.active_plan;
  const workId = `${planName}-legacy`;
  return {
    work_id: workId,
    active_plan: state.active_plan,
    plan_name: planName,
    status: state.status,
    started_at: state.started_at,
    ended_at: state.ended_at,
    elapsed_ms: state.elapsed_ms,
    updated_at: state.updated_at,
    session_ids: Array.isArray(state.session_ids) ? [...state.session_ids] : [],
    session_origins: state.session_origins,
    agent: state.agent,
    worktree_path: state.worktree_path,
    task_sessions: state.task_sessions
  };
}
function projectWorkToMirror(state, work) {
  state.active_plan = work.active_plan;
  state.plan_name = work.plan_name;
  state.status = work.status;
  state.started_at = work.started_at;
  state.ended_at = work.ended_at;
  state.elapsed_ms = work.elapsed_ms;
  state.updated_at = work.updated_at;
  state.session_ids = [...work.session_ids];
  state.session_origins = work.session_origins ? { ...work.session_origins } : {};
  state.agent = work.agent;
  state.worktree_path = work.worktree_path;
  state.task_sessions = work.task_sessions ? { ...work.task_sessions } : {};
}
function selectMirrorWork(state) {
  const works = state.works ? Object.values(state.works) : [];
  if (works.length === 0) {
    return null;
  }
  if (state.active_work_id) {
    const matched = works.find((work) => work.work_id === state.active_work_id);
    if (matched) {
      return matched;
    }
  }
  const sorted = [...works].sort((left, right) => {
    const leftMs = parseIsoToMs(left.updated_at ?? left.started_at) ?? 0;
    const rightMs = parseIsoToMs(right.updated_at ?? right.started_at) ?? 0;
    return rightMs - leftMs;
  });
  return sorted[0] ?? null;
}
// packages/mpd-boulder-plugin/src/vendor/storage/read-state.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
function readBoulderState(directory) {
  const filePath = getBoulderFilePath(directory);
  if (!existsSync3(filePath)) {
    return null;
  }
  try {
    const content = readFileSync2(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      return null;
    }
    normalizeState(parsed);
    const state = parsed;
    const mirrorWork = selectMirrorWork(state);
    if (mirrorWork) {
      state.active_work_id = mirrorWork.work_id;
      projectWorkToMirror(state, mirrorWork);
    }
    return state;
  } catch {
    return null;
  }
}
function normalizeState(state) {
  normalizeSessionFields(state);
  const sessionIds = Array.isArray(state.session_ids) ? state.session_ids : [];
  const sessionOrigins = state.session_origins && typeof state.session_origins === "object" && !Array.isArray(state.session_origins) ? state.session_origins : {};
  state.session_origins = sessionOrigins;
  if (sessionIds.length === 1) {
    const soleSessionId = sessionIds[0];
    if (typeof soleSessionId === "string" && sessionOrigins[soleSessionId] !== "appended" && sessionOrigins[soleSessionId] !== "direct") {
      sessionOrigins[soleSessionId] = "direct";
    }
  }
  if (!state.task_sessions || typeof state.task_sessions !== "object" || Array.isArray(state.task_sessions)) {
    state.task_sessions = {};
  }
  normalizeWorkSessionFields(state.works);
}
function normalizeSessionFields(target) {
  const sessionIds = Array.isArray(target.session_ids) ? target.session_ids.filter((sessionId) => typeof sessionId === "string").map((sessionId) => normalizeSessionId(sessionId)) : [];
  target.session_ids = sessionIds;
  const sessionOrigins = target.session_origins && typeof target.session_origins === "object" && !Array.isArray(target.session_origins) ? normalizeSessionOrigins(target.session_origins) : {};
  target.session_origins = sessionOrigins;
}
function normalizeSessionOrigins(sessionOrigins) {
  return Object.fromEntries(Object.entries(sessionOrigins).map(([sessionId, origin]) => [normalizeSessionId(sessionId), origin]));
}
function normalizeWorkSessionFields(works) {
  if (!works || typeof works !== "object" || Array.isArray(works)) {
    return;
  }
  for (const work of Object.values(works)) {
    if (work && typeof work === "object" && !Array.isArray(work)) {
      normalizeSessionFields(work);
    }
  }
}
function getBoulderWorks(state) {
  if (state.works && typeof state.works === "object") {
    return Object.values(state.works).filter((work) => work != null);
  }
  if (!state.active_plan || !state.plan_name || !state.started_at) {
    return [];
  }
  return [buildWorkFromMirror(state)];
}
function getActiveWorks(directory) {
  const state = readBoulderState(directory);
  if (!state) {
    return [];
  }
  return getBoulderWorks(state).filter((work) => work.status !== "completed" && work.status !== "abandoned");
}
function getWorkById(directory, workId) {
  const state = readBoulderState(directory);
  if (!state) {
    return null;
  }
  return getBoulderWorks(state).find((work) => work.work_id === workId) ?? null;
}
function getWorkResumeOptions(directory) {
  const state = readBoulderState(directory);
  if (!state) {
    return [];
  }
  return getBoulderWorks(state).filter((work) => work.status !== "completed" && work.status !== "abandoned").map((work) => {
    const progress = getPlanProgress(resolveBoulderPlanPathForWork(directory, work));
    return {
      work_id: work.work_id,
      plan_name: work.plan_name,
      active_plan: work.active_plan,
      worktree_path: work.worktree_path,
      status: work.status && isValidWorkStatus(work.status) ? work.status : "active",
      started_at: work.started_at,
      updated_at: work.updated_at ?? work.started_at,
      ended_at: work.ended_at,
      elapsed_ms: work.elapsed_ms,
      session_count: work.session_ids.length,
      progress,
      is_current_mirror: state.active_work_id === work.work_id
    };
  });
}
// packages/mpd-boulder-plugin/src/vendor/storage/write-state.ts
import { existsSync as existsSync4, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
function writeBoulderState(directory, state) {
  const filePath = getBoulderFilePath(directory);
  try {
    const dir = dirname(filePath);
    if (!existsSync4(dir)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join3(dir, ".gitignore"), ["*", "!/rules/", "!/rules/**", ""].join(`
`), "utf-8");
    }
    const stateToWrite = { ...state };
    if (stateToWrite.works && stateToWrite.active_work_id) {
      const activeWork = stateToWrite.works[stateToWrite.active_work_id];
      if (activeWork) {
        stateToWrite.works = {
          ...stateToWrite.works,
          [stateToWrite.active_work_id]: {
            ...activeWork,
            active_plan: stateToWrite.active_plan,
            plan_name: stateToWrite.plan_name,
            status: stateToWrite.status,
            started_at: stateToWrite.started_at,
            ended_at: stateToWrite.ended_at,
            elapsed_ms: stateToWrite.elapsed_ms,
            updated_at: stateToWrite.updated_at,
            session_ids: [...stateToWrite.session_ids],
            session_origins: stateToWrite.session_origins ? { ...stateToWrite.session_origins } : {},
            agent: stateToWrite.agent,
            worktree_path: stateToWrite.worktree_path,
            task_sessions: stateToWrite.task_sessions ? { ...stateToWrite.task_sessions } : {}
          }
        };
      }
    }
    writeFileSync(filePath, JSON.stringify(stateToWrite, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}
function generateWorkId(planName) {
  const slug = planName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const randomHex = Math.floor(Math.random() * 4294967295).toString(16).padStart(8, "0");
  return `${slug.length > 0 ? slug : "work"}-${randomHex}`;
}
function createBoulderState(planPath, sessionId, agent, worktreePath) {
  const startedAt = nowIsoString();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const workId = generateWorkId(getPlanName(planPath));
  const work = {
    work_id: workId,
    active_plan: planPath,
    plan_name: getPlanName(planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...agent !== undefined ? { agent } : {},
    ...worktreePath !== undefined ? { worktree_path: worktreePath } : {},
    task_sessions: {}
  };
  return {
    schema_version: 2,
    active_work_id: workId,
    works: { [workId]: work },
    active_plan: planPath,
    started_at: startedAt,
    status: "active",
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    plan_name: getPlanName(planPath),
    task_sessions: {},
    ...agent !== undefined ? { agent } : {},
    ...worktreePath !== undefined ? { worktree_path: worktreePath } : {}
  };
}
function addBoulderWork(directory, input) {
  const state = readBoulderState(directory);
  if (!state) {
    return null;
  }
  const workId = generateWorkId(getPlanName(input.planPath));
  const startedAt = input.startedAt ?? nowIsoString();
  const normalizedSessionId = normalizeSessionId(input.sessionId);
  const nextWork = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: getPlanName(input.planPath),
    status: "active",
    started_at: startedAt,
    updated_at: startedAt,
    session_ids: [normalizedSessionId],
    session_origins: { [normalizedSessionId]: "direct" },
    ...input.agent !== undefined ? { agent: input.agent } : {},
    ...input.worktreePath !== undefined ? { worktree_path: input.worktreePath } : {},
    task_sessions: {}
  };
  const nextState = {
    ...state,
    schema_version: 2,
    works: { ...Object.fromEntries(getBoulderWorks(state).map((work) => [work.work_id, work])), [workId]: nextWork },
    active_work_id: workId
  };
  projectWorkToMirror(nextState, nextWork);
  return writeBoulderState(directory, nextState) ? nextState : null;
}
function completeBoulder(directory, workId, endedAt) {
  const state = readBoulderState(directory);
  if (!state) {
    return null;
  }
  const targetWorkId = workId ?? state.active_work_id;
  if (!targetWorkId) {
    return null;
  }
  const work = state.works?.[targetWorkId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === targetWorkId);
  if (!work) {
    return null;
  }
  if (work.status === "completed" && work.ended_at !== undefined && work.elapsed_ms !== undefined) {
    return state;
  }
  const endAt = endedAt ?? nowIsoString();
  work.ended_at = endAt;
  work.elapsed_ms = getElapsedMs(work.started_at, endAt);
  work.status = "completed";
  work.updated_at = nowIsoString();
  if (state.active_work_id === targetWorkId) {
    projectWorkToMirror(state, work);
  }
  return writeBoulderState(directory, state) ? state : null;
}
// packages/mpd-boulder-plugin/src/vendor/storage/task.ts
function upsertTaskSessionStateForWork(directory, workId, input) {
  if (RESERVED_KEYS.has(input.taskKey)) {
    return null;
  }
  const state = readBoulderState(directory);
  if (!state) {
    return null;
  }
  const works = getBoulderWorks(state);
  const targetWork = works.find((work) => work.work_id === workId);
  if (!targetWork) {
    return null;
  }
  const normalizedSessionId = normalizeSessionId(input.sessionId);
  const previousTaskSession = targetWork.task_sessions?.[input.taskKey];
  const nextTaskSession = {
    task_key: input.taskKey,
    task_label: input.taskLabel,
    task_title: input.taskTitle,
    session_id: normalizedSessionId,
    ...input.agent !== undefined ? { agent: input.agent } : {},
    ...input.category !== undefined ? { category: input.category } : {},
    ...previousTaskSession?.started_at !== undefined ? { started_at: previousTaskSession.started_at } : {},
    ...previousTaskSession?.ended_at !== undefined ? { ended_at: previousTaskSession.ended_at } : {},
    ...previousTaskSession?.elapsed_ms !== undefined ? { elapsed_ms: previousTaskSession.elapsed_ms } : {},
    ...previousTaskSession?.status !== undefined ? { status: previousTaskSession.status } : {},
    updated_at: nowIsoString()
  };
  const nextWork = {
    ...targetWork,
    task_sessions: { ...targetWork.task_sessions ?? {}, [input.taskKey]: nextTaskSession },
    updated_at: nowIsoString()
  };
  const nextState = {
    ...state,
    schema_version: 2,
    works: {
      ...Object.fromEntries(works.map((work) => [work.work_id, work])),
      [workId]: nextWork
    }
  };
  if (state.active_work_id === workId) {
    projectWorkToMirror(nextState, nextWork);
  }
  return writeBoulderState(directory, nextState) ? nextState : null;
}
function startTaskTimer(directory, workId, input) {
  const nextState = upsertTaskSessionStateForWork(directory, workId, {
    ...input,
    sessionId: normalizeSessionId(input.sessionId)
  });
  if (!nextState) {
    return null;
  }
  const work = nextState.works?.[workId];
  const taskSession = work?.task_sessions?.[input.taskKey];
  if (!work || !taskSession) {
    return null;
  }
  const startedAt = taskSession.started_at ?? input.startedAt ?? nowIsoString();
  taskSession.started_at = startedAt;
  taskSession.status = "running";
  taskSession.updated_at = nowIsoString();
  work.updated_at = nowIsoString();
  return writeBoulderState(directory, nextState) ? nextState : null;
}
function endTaskTimer(directory, workId, taskKey, endedAt) {
  const state = readBoulderState(directory);
  if (!state) {
    return null;
  }
  const work = state.works?.[workId] ?? getBoulderWorks(state).find((candidate) => candidate.work_id === workId);
  if (!work?.task_sessions?.[taskKey]) {
    return null;
  }
  const taskSession = work.task_sessions[taskKey];
  const endAt = endedAt ?? nowIsoString();
  taskSession.ended_at = endAt;
  taskSession.elapsed_ms = getElapsedMs(taskSession.started_at, endAt);
  taskSession.status = "completed";
  taskSession.updated_at = nowIsoString();
  work.updated_at = nowIsoString();
  if (state.active_work_id === workId) {
    projectWorkToMirror(state, work);
  }
  return writeBoulderState(directory, state) ? state : null;
}
// packages/mpd-boulder-plugin/src/index.ts
import { join as join4 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
// packages/mpd-dsh-adapter-plugin/src/index.ts
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
      console.warn("mpd-dsh-adapter: llmCatalog degraded — " + detail);
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
        console.warn("[mpd-dsh-adapter] no ctx.inject seam: the settings registration runs immediately (the settings provider may not be mounted yet)");
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
              console.warn("[mpd-dsh-adapter] the settings inject fired but the SCOPED ctx yielded no settings service (property and get both empty) — the registration will fail as unavailable; this is the TUI-profile shape measured 2026-09-27");
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

// packages/mpd-boulder-plugin/src/index.ts
var name = "mpd-boulder";
var inject = ["tools"];
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = svc.get("boulder.dir");
  return typeof v === "string" ? { ...config, boulderDir: v } : config;
}
function boulderRoot(config, dsh, exec) {
  return config.boulderDir ? config.boulderDir : dsh.workspaceRoot(exec);
}
function apply(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const merged = mergedConfig(ctx, config);
  const root = (exec) => boulderRoot(merged, dsh, exec);
  dsh.registerTool({
    name: "mpd_boulder_status",
    description: "Show the boulder work ledger: active works, statuses, session ids, task timers, resume options and (optionally) the progress of one plan file. State lives in .mpd/boulder.json.",
    parameters: { type: "object", properties: { planPath: { type: "string" } } },
    output: { schema: { type: "object", properties: { stateFile: { type: "string" }, activeWorks: { type: "array", items: { type: "object" } }, resumeOptions: { type: "array", items: { type: "object" } }, planProgress: { type: "object" }, state: { type: "object" } }, required: ["stateFile", "activeWorks", "resumeOptions"] }, render: (_a, v) => textBlock("boulder status: " + v.stateFile + `
active works: ` + JSON.stringify(v.activeWorks, null, 1) + `
resume: ` + JSON.stringify(v.resumeOptions, null, 1) + (v.planProgress ? `
plan: ` + JSON.stringify(v.planProgress) : "")) },
    execute: async (args, exec) => {
      const dir = root(exec);
      const state = readBoulderState(dir);
      const activeWorks = getActiveWorks(dir);
      const resumeOptions = getWorkResumeOptions(dir);
      let planProgress = null;
      if (args?.planPath) {
        try {
          planProgress = getPlanProgress(String(args.planPath));
        } catch (e) {
          planProgress = { error: String(e?.message ?? e) };
        }
      }
      const result = { stateFile: join4(dir, ".mpd", "boulder.json"), activeWorks, resumeOptions };
      if (state)
        result.state = { active_work_id: state.active_work_id, status: state.status };
      if (planProgress)
        result.planProgress = planProgress;
      return result;
    }
  });
  dsh.registerTool({
    name: "mpd_boulder_start",
    description: "Start a boulder work bound to a plan markdown file (e.g. .mpd/plans/<slug>.md). Creates .mpd/boulder.json if absent; the work becomes active with status active and the calling session recorded.",
    parameters: { type: "object", properties: { planPath: { type: "string" }, agent: { type: "string" }, worktreePath: { type: "string" }, sessionId: { type: "string" } }, required: ["planPath"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, stateFile: { type: "string" } }, required: ["workId", "status"] }, render: (_a, v) => textBlock("boulder started: " + v.workId + " (" + v.status + ") " + v.stateFile) },
    execute: async (args, exec) => {
      const dir = root(exec);
      const planPath = String(args?.planPath);
      const sessionId = String(args?.sessionId ?? "current");
      const existing = readBoulderState(dir);
      let next;
      if (existing) {
        next = addBoulderWork(dir, { planPath, sessionId, agent: args?.agent, worktreePath: args?.worktreePath });
      } else {
        const created = createBoulderState(planPath, sessionId, args?.agent, args?.worktreePath);
        next = writeBoulderState(dir, created) ? created : null;
      }
      if (!next)
        throw new Error("mpd-boulder: failed to start work on " + planPath);
      const wid = next.active_work_id;
      const status = wid ? next.works?.[wid]?.status ?? "active" : "active";
      return { workId: wid ?? "?", status, stateFile: join4(dir, ".mpd", "boulder.json") };
    }
  });
  dsh.registerTool({
    name: "mpd_boulder_complete",
    description: "Complete the active boulder work (or one given by workId): sets status completed, records ended_at + elapsed_ms and persists .mpd/boulder.json.",
    parameters: { type: "object", properties: { workId: { type: "string" } } },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, elapsedMs: { type: "integer" } }, required: ["workId", "status"] }, render: (_a, v) => textBlock("boulder completed: " + v.workId + " status=" + v.status + " elapsedMs=" + v.elapsedMs) },
    execute: async (args, exec) => {
      const dir = root(exec);
      const state = completeBoulder(dir, args?.workId);
      if (!state)
        throw new Error("mpd-boulder: no work to complete (start one first with mpd_boulder_start)");
      const workId = args?.workId ?? state.active_work_id ?? "?";
      const work = getWorkById(dir, workId);
      return { workId, status: work?.status ?? "completed", elapsedMs: work?.elapsed_ms ?? 0 };
    }
  });
  dsh.registerTool({
    name: "mpd_boulder_task_timer",
    description: "Start or end a per-task session timer inside a boulder work (taskKey = TODO id in the plan, e.g. '1' or 'F1'). action=start marks running; action=end marks completed and records elapsed_ms.",
    parameters: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, action: { type: "string", enum: ["start", "end"] }, taskLabel: { type: "string" }, taskTitle: { type: "string" }, sessionId: { type: "string" } }, required: ["workId", "taskKey", "action"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, status: { type: "string" } }, required: ["workId", "taskKey", "status"] }, render: (_a, v) => textBlock("boulder timer: " + v.taskKey + " (" + v.status + ") in " + v.workId) },
    execute: async (args, exec) => {
      const dir = root(exec);
      const workId = String(args?.workId);
      const taskKey = String(args?.taskKey);
      let next;
      if (args?.action === "start") {
        next = startTaskTimer(dir, workId, { taskKey, taskLabel: String(args?.taskLabel ?? taskKey), taskTitle: String(args?.taskTitle ?? taskKey), sessionId: String(args?.sessionId ?? "current") });
        if (!next)
          throw new Error("mpd-boulder: timer start failed (workId/taskKey invalid)");
      } else {
        next = endTaskTimer(dir, workId, taskKey);
        if (!next)
          throw new Error("mpd-boulder: timer end failed (no running task)");
      }
      const work = next.works?.[workId];
      return { workId, taskKey, status: work?.task_sessions?.[taskKey]?.status ?? (args?.action === "start" ? "running" : "completed") };
    }
  });
  dsh.registerTool({
    name: "mpd_boulder_plan_progress",
    description: "Parse a plan markdown file for its checklist progress: '## TODOs' items (N.) and '## Final Verification Wave' items (F<n>.), returning done/remaining with the plan path resolution.",
    parameters: { type: "object", properties: { planPath: { type: "string" } }, required: ["planPath"] },
    output: { schema: { type: "object", properties: { planPath: { type: "string" }, progress: { type: "object" } }, required: ["planPath", "progress"] }, render: (_a, v) => textBlock("plan progress " + v.planPath + ": " + JSON.stringify(v.progress, null, 1)) },
    execute: async (args, exec) => {
      const dir = root(exec);
      const planPath = String(args?.planPath);
      const progress = getPlanProgress(planPath);
      return { planPath, progress };
    }
  });
  dsh.registerTool({
    name: "mpd_boulder_plans",
    description: "List plan markdown files under .mpd/plans that can be started as boulder works.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { plans: { type: "array", items: { type: "string" } } }, required: ["plans"] }, render: (_a, v) => textBlock("plans: " + v.plans.join(`
`)) },
    execute: async (_args, exec) => ({ plans: findPrometheusPlans(root(exec)) })
  });
}
export {
  apply,
  inject,
  name
};
