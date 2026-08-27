// src/vendor/constants.ts
var BOULDER_DIR = ".mpd";
var BOULDER_FILE = "boulder.json";
var BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`;
var NOTEPAD_DIR = "notepads";
var NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`;
var PROMETHEUS_PLANS_DIR = ".mpd/plans";
// src/vendor/plan-checklist.ts
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
// src/vendor/storage/path.ts
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
// src/vendor/storage/plan-progress.ts
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
// src/vendor/storage/shared.ts
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
// src/vendor/storage/read-state.ts
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
// src/vendor/storage/write-state.ts
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
// src/vendor/storage/task.ts
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
// src/index.ts
var name = "mpd-boulder";
var inject = ["tools"];
function textBlock(text) {
  return [{ type: "text", text }];
}
function cwd() {
  return process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
}
function boulderRoot(config) {
  return config.boulderDir ? config.boulderDir : cwd();
}
function apply(ctx, config = {}) {
  const root = () => boulderRoot(config);
  ctx.tools.register({
    name: "mpd_boulder_status",
    description: "Show the boulder work ledger: active works, statuses, session ids, task timers, resume options and (optionally) the progress of one plan file. State lives in .mpd/boulder.json.",
    parameters: { type: "object", properties: { planPath: { type: "string" } } },
    output: { schema: { type: "object", properties: { stateFile: { type: "string" }, activeWorks: { type: "array", items: { type: "object" } }, resumeOptions: { type: "array", items: { type: "object" } }, planProgress: { type: "object" } }, required: ["stateFile", "activeWorks", "resumeOptions"] }, render: (_a, v) => textBlock("boulder status: " + v.stateFile + `
active works: ` + JSON.stringify(v.activeWorks, null, 1) + `
resume: ` + JSON.stringify(v.resumeOptions, null, 1) + (v.planProgress ? `
plan: ` + JSON.stringify(v.planProgress) : "")) },
    execute: async (args) => {
      const dir = root();
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
      return { stateFile: dir + "/.mpd/boulder.json", activeWorks, resumeOptions, planProgress, state: state ? { active_work_id: state.active_work_id, status: state.status } : null };
    }
  });
  ctx.tools.register({
    name: "mpd_boulder_start",
    description: "Start a boulder work bound to a plan markdown file (e.g. .mpd/plans/<slug>.md). Creates .mpd/boulder.json if absent; the work becomes active with status active and the calling session recorded.",
    parameters: { type: "object", properties: { planPath: { type: "string" }, agent: { type: "string" }, worktreePath: { type: "string" }, sessionId: { type: "string" } }, required: ["planPath"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, stateFile: { type: "string" } }, required: ["workId", "status"] }, render: (_a, v) => textBlock("boulder started: " + v.workId + " (" + v.status + ") " + v.stateFile) },
    execute: async (args) => {
      const dir = root();
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
      return { workId: next.active_work_id ?? "?", status: next.works?.[next.active_work_id ?? ""]?.status ?? "active", stateFile: dir + "/.mpd/boulder.json" };
    }
  });
  ctx.tools.register({
    name: "mpd_boulder_complete",
    description: "Complete the active boulder work (or one given by workId): sets status completed, records ended_at + elapsed_ms and persists .mpd/boulder.json.",
    parameters: { type: "object", properties: { workId: { type: "string" } } },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, status: { type: "string" }, elapsedMs: { type: "integer" } }, required: ["workId", "status"] }, render: (_a, v) => textBlock("boulder completed: " + v.workId + " status=" + v.status + " elapsedMs=" + v.elapsedMs) },
    execute: async (args) => {
      const dir = root();
      const state = completeBoulder(dir, args?.workId);
      if (!state)
        throw new Error("mpd-boulder: no work to complete (start one first with mpd_boulder_start)");
      const workId = args?.workId ?? state.active_work_id ?? "?";
      const work = getWorkById(dir, workId);
      return { workId, status: work?.status ?? "completed", elapsedMs: work?.elapsed_ms ?? 0 };
    }
  });
  ctx.tools.register({
    name: "mpd_boulder_task_timer",
    description: "Start or end a per-task session timer inside a boulder work (taskKey = TODO id in the plan, e.g. '1' or 'F1'). action=start marks running; action=end marks completed and records elapsed_ms.",
    parameters: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, action: { type: "string", enum: ["start", "end"] }, taskLabel: { type: "string" }, taskTitle: { type: "string" }, sessionId: { type: "string" } }, required: ["workId", "taskKey", "action"], additionalProperties: false },
    output: { schema: { type: "object", properties: { workId: { type: "string" }, taskKey: { type: "string" }, status: { type: "string" } }, required: ["workId", "taskKey", "status"] }, render: (_a, v) => textBlock("boulder timer: " + v.taskKey + " (" + v.status + ") in " + v.workId) },
    execute: async (args) => {
      const dir = root();
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
  ctx.tools.register({
    name: "mpd_boulder_plan_progress",
    description: "Parse a plan markdown file for its checklist progress: '## TODOs' items (N.) and '## Final Verification Wave' items (F<n>.), returning done/remaining with the plan path resolution.",
    parameters: { type: "object", properties: { planPath: { type: "string" } }, required: ["planPath"] },
    output: { schema: { type: "object", properties: { planPath: { type: "string" }, progress: { type: "object" } }, required: ["planPath", "progress"] }, render: (_a, v) => textBlock("plan progress " + v.planPath + ": " + JSON.stringify(v.progress, null, 1)) },
    execute: async (args) => {
      const dir = root();
      const planPath = String(args?.planPath);
      const progress = getPlanProgress(planPath);
      return { planPath, progress };
    }
  });
  ctx.tools.register({
    name: "mpd_boulder_plans",
    description: "List plan markdown files under .mpd/plans that can be started as boulder works.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { plans: { type: "array", items: { type: "string" } } }, required: ["plans"] }, render: (_a, v) => textBlock("plans: " + v.plans.join(`
`)) },
    execute: async () => ({ plans: findPrometheusPlans(root()) })
  });
}
export {
  apply,
  inject,
  name
};
