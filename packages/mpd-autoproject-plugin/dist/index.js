// packages/mpd-autoproject-plugin/src/boulder/vendor/constants.ts
var BOULDER_DIR = ".mpd";
var BOULDER_FILE = "boulder.json";
var BOULDER_STATE_PATH = `${BOULDER_DIR}/${BOULDER_FILE}`;
var NOTEPAD_DIR = "notepads";
var NOTEPAD_BASE_PATH = `${BOULDER_DIR}/${NOTEPAD_DIR}`;
var PROMETHEUS_PLANS_DIR = ".mpd/plans";
// packages/mpd-autoproject-plugin/src/boulder/vendor/plan-checklist.ts
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/path.ts
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/plan-progress.ts
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/shared.ts
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/read-state.ts
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/write-state.ts
import { existsSync as existsSync4, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
var STATE_DIR_GITIGNORE = ["*", "!/rules/", "!/rules/**", ""].join(`
`);
function writeBoulderState(directory, state) {
  const filePath = getBoulderFilePath(directory);
  try {
    const dir = dirname(filePath);
    if (!existsSync4(dir)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join3(dir, ".gitignore"), STATE_DIR_GITIGNORE, "utf-8");
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
  const planName = getPlanName(planPath);
  const workId = generateWorkId(planName);
  const work = {
    work_id: workId,
    active_plan: planPath,
    plan_name: planName,
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
    plan_name: planName,
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
  const planName = getPlanName(input.planPath);
  const workId = generateWorkId(planName);
  const startedAt = input.startedAt ?? nowIsoString();
  const normalizedSessionId = normalizeSessionId(input.sessionId);
  const nextWork = {
    work_id: workId,
    active_plan: input.planPath,
    plan_name: planName,
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
// packages/mpd-autoproject-plugin/src/boulder/vendor/storage/task.ts
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
// packages/mpd-autoproject-plugin/src/boulder/index.ts
import { join as join6, isAbsolute as isAbsolute3, resolve as resolve4 } from "node:path";
import { existsSync as existsSync5 } from "node:fs";

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID } from "node:crypto";
import { resolve as resolve3, sep as sep2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync as mkdirSync2, openSync, renameSync, rmSync, statSync as statSync2, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute as isAbsolute2, join as join4, relative as relative2, resolve as resolve2, sep } from "node:path";
var LOG_SUBDIR = join4(".mpd", "logs");
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
      absolute = resolve2(candidate);
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
    const dir = join4(root, LOG_SUBDIR);
    mkdirSync2(dir, { recursive: true });
    const file = join4(dir, `${name}.log`);
    return { fd: openSync(file, "a"), file };
  } catch {
    return null;
  }
}
function owningRoot(roots, file) {
  for (const root of roots) {
    if (file === root)
      return root;
    const rel = relative2(root, file);
    if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute2(rel))
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
      size = statSync2(open.file).size;
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
    return resolve3(session);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve3(override);
  return process.cwd();
}
function workspaceRootOf(exec) {
  if (exec?.agent !== undefined && exec?.agent !== null)
    return workspaceRootOfAgent(exec.agent);
  const override = process.env.DSH_WORKSPACE_ROOT;
  if (typeof override === "string" && override.length > 0)
    return resolve3(override);
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
        roots.add(resolve3(cwd));
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

// packages/mpd-autoproject-plugin/src/boulder/dshgo-cards.ts
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
function buildBoulderStatusCard(_args, value) {
  const v = recordOf(value);
  const activeWorks = recordsAt(v, "activeWorks");
  const resumeOptions = recordsAt(v, "resumeOptions");
  const state = recordOf(v.state);
  const planProgress = recordOf(v.planProgress);
  const children = [
    row([
      metric({ label: "Active works", value: activeWorks.length }),
      metric({ label: "Resumable", value: resumeOptions.length })
    ]),
    keyValue([
      ["Ledger", tail(stringOf(v.stateFile, "(unknown)"), 72)],
      ["Active work", clip(stringOf(state.active_work_id, "none"), 32)],
      ["Status", stringOf(state.status, "idle")]
    ])
  ];
  if (resumeOptions.length === 0) {
    children.push(text("No active boulder work in this workspace."));
  } else {
    children.push(table({
      columns: ["Plan", "Status", "Done"],
      rows: resumeOptions.slice(0, 10).map((option) => {
        const progress = recordOf(option.progress);
        return [clip(stringOf(option.plan_name, "?"), 40), stringOf(option.status, "active"), numberOf(progress.completed) + "/" + numberOf(progress.total)];
      })
    }));
  }
  if (Object.keys(planProgress).length > 0) {
    const error = typeof planProgress.error === "string" ? planProgress.error : "";
    if (error !== "")
      children.push(text(clip("plan unreadable: " + error, 300), { tone: "warn" }));
    else
      children.push(row([metric({ label: "Plan done", value: numberOf(planProgress.completed) + "/" + numberOf(planProgress.total), tone: planProgress.isComplete === true ? "good" : "muted" })]));
  }
  return stack(children, { title: "Boulder status" });
}
var BOULDER_STATUS_CARD = toolCard(buildBoulderStatusCard);

// packages/mpd-roles-plugin/src/complexity-gate.ts
import { mkdir as mkdirFs, readFile as readFileFs, readdir as readDirFs, rename as renameFs, unlink as unlinkFs, writeFile as writeFileFs } from "node:fs/promises";
import { join as join5 } from "node:path";

// packages/mpd-roles-plugin/src/admission.ts
var AUTOMATION_GESTURE_PATTERN = /\b(?:autoproject|auto-project|orchestrate|orchestration)\b|自动化|编排/iu;
function admissionOf(source, text2, evidence = {}) {
  const body = typeof text2 === "string" ? text2 : "";
  const explicit = evidence.explicitFlag ?? consumeExplicitFlag(body).flagged;
  if (explicit)
    return "explicit";
  if (source !== "human")
    return "ignore";
  if (AUTOMATION_GESTURE_PATTERN.test(body))
    return "explicit";
  const signals = evidence.matchedSignals ?? evaluateComplexityGate(body).signals.length;
  return signals >= 1 ? "inferred" : "ignore";
}

// packages/mpd-roles-plugin/src/complexity-gate.ts
var GATE_MODE_MECHANICAL = "mechanical";
var GATE_MODE_ADVISORY = "advisory";
var GATE_MODE_OFF = "off";
var GATE_CONFIG_KEY = "team.gate";
var BOULDER_DIR_CONFIG_KEY = "boulder.dir";
var GATE_SENSITIVITY_EASY = "easy";
var GATE_SENSITIVITY_NORMAL = "normal";
var GATE_SENSITIVITY_STRICT = "strict";
var SENSITIVITY_CONFIG_KEY = "team.sensitivity";
function resolveSensitivity(value) {
  if (value === GATE_SENSITIVITY_NORMAL)
    return GATE_SENSITIVITY_NORMAL;
  if (value === GATE_SENSITIVITY_STRICT)
    return GATE_SENSITIVITY_STRICT;
  return GATE_SENSITIVITY_EASY;
}
var SENSITIVITY_THRESHOLDS = {
  easy: {
    deliverableVerbs: 2,
    enumeratedLines: 2,
    actionVerbs: 2,
    clauseSteps: 2,
    cSubSignals: 2,
    cjkChars: 24,
    cjkVerbs: 2,
    workspaceScale: true,
    lexicon: "expanded"
  },
  normal: {
    deliverableVerbs: 4,
    enumeratedLines: 3,
    actionVerbs: 3,
    clauseSteps: 3,
    cSubSignals: 2,
    cjkChars: 60,
    cjkVerbs: 2,
    workspaceScale: false,
    lexicon: "pre-wave"
  },
  strict: {
    deliverableVerbs: 6,
    enumeratedLines: 4,
    actionVerbs: 4,
    clauseSteps: 4,
    cSubSignals: 3,
    cjkChars: 80,
    cjkVerbs: 3,
    workspaceScale: false,
    lexicon: "expanded"
  }
};
var WORKSPACE_ROOT_SPELLINGS = [".", "./", ".mpd", ".mpd/", "./.mpd", "./.mpd/"];
function resolveBoulderDir(value) {
  if (typeof value !== "string")
    return;
  const trimmed = value.trim();
  if (trimmed === "" || WORKSPACE_ROOT_SPELLINGS.includes(trimmed))
    return;
  return trimmed;
}
var STAGING_TOOL_NAME = "agent_teams_plan";
var PLAN_EXTEND_ACTIONS = ["add_member", "create_task"];
var STAGED_PLAN_PHRASE = "a team PLAN was STAGED";
var ALREADY_STAGED_PLAN_PHRASE = "a team PLAN is ALREADY STAGED";
var INERT_PLAN_PHRASE = "NOTHING has been spawned; the plan is INERT until approved";
var NO_TEAM_STAGED_PHRASE = "NO team was staged";
var PRE_WAVE_DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/giu;
var PRE_WAVE_ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充/giu;
var PRE_WAVE_CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/iu;
var DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|implement|add|build|change|check|verify|fix|create|update|remove|delete|move|rename|test|document|wire|integrate|deploy|release|review|investigate|diagnose|reproduce|benchmark|optimize|harden|validate|split|restructure|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取)/giu;
var ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取/giu;
var ENUMERATED_LINE_PATTERN = /^\s*(?:\d+[.)]|[-*|])\s/u;
var CLAUSE_SEPARATOR_PATTERN = /[\n\r;:,.、，。；：！？（）「」『』“”‘’【】]/u;
var CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取)/iu;
var PRE_WAVE_LEXICON = {
  deliverable: PRE_WAVE_DELIVERABLE_VERB_PATTERN,
  action: PRE_WAVE_ACTION_VERB_PATTERN,
  clause: PRE_WAVE_CLAUSE_ACTION_PATTERN
};
var EXPANDED_LEXICON = {
  deliverable: DELIVERABLE_VERB_PATTERN,
  action: ACTION_VERB_PATTERN,
  clause: CLAUSE_ACTION_PATTERN
};
var GATE_LEXICONS = {
  "pre-wave": PRE_WAVE_LEXICON,
  expanded: EXPANDED_LEXICON
};
var DELIVERABLE_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.deliverableVerbs;
var ENUMERATED_LINE_MIN = SENSITIVITY_THRESHOLDS.normal.enumeratedLines;
var ACTION_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.actionVerbs;
var C_SUBSIGNAL_MIN = SENSITIVITY_THRESHOLDS.normal.cSubSignals;
var CJK_CHAR_PATTERN = /\p{Script=Han}/gu;
var CJK_CHAR_MIN = SENSITIVITY_THRESHOLDS.normal.cjkChars;
var CJK_ACTION_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.cjkVerbs;
var GATE_PLAN_NAME_MAX = 60;
var GATE_PLAN_EXCERPT_MAX = 500;
var GATE_PLAN_NAME_FALLBACK = "session-start complexity gate team";
function distinctMatches(text2, pattern) {
  const seen = new Set;
  for (const match of text2.matchAll(pattern))
    seen.add(match[0].toLowerCase());
  return seen.size;
}
function enumeratedLineCount(text2) {
  let count = 0;
  for (const line of text2.split(`
`))
    if (ENUMERATED_LINE_PATTERN.test(line))
      count += 1;
  return count;
}
function clauseStepCount(text2, pattern) {
  let count = 0;
  for (const clause of text2.split(CLAUSE_SEPARATOR_PATTERN))
    if (pattern.test(clause))
      count += 1;
  return count;
}
function cjkCharCount(text2) {
  const matches = text2.match(CJK_CHAR_PATTERN);
  return matches === null ? 0 : matches.length;
}
function consumeExplicitFlag(text2) {
  const source = String(text2 ?? "");
  const trimmed = source.trimStart();
  const prefix = /^team:\s*/iu.exec(trimmed);
  if (prefix !== null)
    return { flagged: true, text: trimmed.slice(prefix[0].length) };
  const marker = /(^|\s)!team\b/iu.exec(source);
  if (marker !== null)
    return { flagged: true, text: source.replace(/(^|\s)!team\b\s*/iu, "$1") };
  return { flagged: false, text: source };
}
function evaluateComplexityGate(text2, input = {}) {
  const source = String(text2 ?? "");
  const thresholds = SENSITIVITY_THRESHOLDS[resolveSensitivity(input.sensitivity)];
  const lexicon = GATE_LEXICONS[thresholds.lexicon];
  const signals = [];
  if (input.explicitFlag === true)
    signals.push("A");
  if (distinctMatches(source, lexicon.deliverable) >= thresholds.deliverableVerbs)
    signals.push("B");
  const actionVerbs = distinctMatches(source, lexicon.action);
  const cSubSignals = [
    enumeratedLineCount(source) >= thresholds.enumeratedLines,
    actionVerbs >= thresholds.actionVerbs,
    clauseStepCount(source, lexicon.clause) >= thresholds.clauseSteps
  ].filter(Boolean).length;
  if (cSubSignals >= thresholds.cSubSignals)
    signals.push("C");
  if (input.activeBoulder === true)
    signals.push("D");
  if (cjkCharCount(source) >= thresholds.cjkChars && actionVerbs >= thresholds.cjkVerbs)
    signals.push("E");
  if (thresholds.workspaceScale && input.workspaceScale === true)
    signals.push("F");
  const strength = admissionOf(input.source ?? "human", source, { explicitFlag: input.explicitFlag === true, matchedSignals: signals.length });
  return {
    trigger: strength !== "ignore" && (input.explicitFlag === true || signals.length >= 1),
    signals,
    strength
  };
}
async function readBoulderGate(workspace, opts = {}) {
  try {
    const read = opts.readFile ?? ((path) => readFileFs(path, "utf8"));
    const root = resolveBoulderDir(opts.boulderDir) ?? String(workspace ?? "");
    const raw = await read(join5(root, ".mpd", "boulder.json"));
    const state = JSON.parse(raw);
    if (state === null || typeof state !== "object" || Array.isArray(state))
      return { active: false };
    const record = state;
    const works = record.works !== null && typeof record.works === "object" && !Array.isArray(record.works) ? record.works : {};
    const activeId = String(record.active_work_id ?? "");
    const pointed = activeId === "" ? undefined : works[activeId];
    const work = pointed !== null && typeof pointed === "object" && !Array.isArray(pointed) ? pointed : record;
    const status = typeof work.status === "string" ? work.status : undefined;
    const planPath = typeof work.active_plan === "string" && work.active_plan !== "" ? work.active_plan : undefined;
    return {
      active: status === "active",
      ...status === undefined ? {} : { status },
      ...planPath === undefined ? {} : { planPath }
    };
  } catch {
    return { active: false };
  }
}
var WORKSPACE_MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "CMakeLists.txt"
];
var WORKSPACE_PROJECT_DIRS = [
  "packages",
  "src",
  "apps",
  "lib",
  "services",
  "plugins",
  "crates",
  "cmd",
  "internal",
  "modules"
];
var WORKSPACE_VISIBLE_ENTRIES_MIN = 8;
async function readWorkspaceScale(workspace, opts = {}) {
  try {
    const list = opts.readDir ?? ((path) => readDirFs(path, { encoding: "utf8", withFileTypes: false }));
    const entries = (await list(String(workspace ?? ""))).map((entry) => String(entry));
    const visible = entries.filter((name) => !name.startsWith("."));
    const manifests = visible.filter((name) => WORKSPACE_MANIFESTS.includes(name)).length;
    const projectDirs = visible.filter((name) => WORKSPACE_PROJECT_DIRS.includes(name)).length;
    return manifests >= 1 && projectDirs >= 1 && visible.length >= WORKSPACE_VISIBLE_ENTRIES_MIN;
  } catch {
    return false;
  }
}
var TEAM_RECORDS_DIR = join5(".mpd", "team", "teams");
var RETEAM_PLAN_NAME = "re-team gate plan shell";
var SESSION_GATE_STATE_DIR = join5(".mpd", "session-gate");
function resolveGateMode(value) {
  if (value === GATE_MODE_ADVISORY)
    return GATE_MODE_ADVISORY;
  if (value === GATE_MODE_OFF || value === false)
    return GATE_MODE_OFF;
  return GATE_MODE_MECHANICAL;
}
function collapseWhitespace(text2) {
  return String(text2 ?? "").replace(/\s+/gu, " ").trim();
}
function gatePlanShell(input) {
  const goal = String(input.goal ?? "");
  const firstLine = collapseWhitespace(goal.split(/\r?\n/u)[0] ?? "");
  const excerpt = collapseWhitespace(goal).slice(0, GATE_PLAN_EXCERPT_MAX);
  const matched = input.signals.length === 0 ? "complexity signals" : "complexity signals " + input.signals.join("/");
  const lead = input.reteam === undefined ? "Staged mechanically by the mpd session-start complexity gate on " + matched + "." : "Staged mechanically by the mpd re-team gate: " + String(input.reteam.count) + " completed consult calls since the last team fire" + " (threshold " + String(input.reteam.threshold) + ") and no live team.";
  const name = input.reteam === undefined ? firstLine === "" ? GATE_PLAN_NAME_FALLBACK : firstLine.slice(0, GATE_PLAN_NAME_MAX) : RETEAM_PLAN_NAME.slice(0, GATE_PLAN_NAME_MAX);
  return {
    name,
    description: lead + `
This is a SHELL: 0 members and 0 tasks, because at the first pre-step there is no decomposition yet.` + (input.reteam === undefined ? `
Goal excerpt: ` + (excerpt === "" ? "(empty)" : excerpt) : `
No user turn was judged: the re-team trigger counts COMPLETED consults, not prompt text.`) + "\nExtend it with `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)" + " and `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[1] + '"}`,' + " then approve it with `" + STAGING_TOOL_NAME + ' {action:"approve"}` — approval is what spawns the members.' + `
` + INERT_PLAN_PHRASE + "." + (input.planPath === undefined ? "" : `
Active plan artifact (signal D): ` + input.planPath),
    approval: "required"
  };
}

// packages/mpd-autoproject-plugin/src/boulder/index.ts
var ROW_LOG = "mpd-autoproject";
function mergedConfig(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = resolveBoulderDir(svc.get("boulder.dir"));
  return v === undefined ? config : { ...config, boulderDir: v };
}
function boulderRoot(config, dsh, exec) {
  return resolveBoulderDir(config.boulderDir) ?? dsh.workspaceRoot(exec);
}
function planPathFor(dir, planPath) {
  return isAbsolute3(planPath) ? resolve4(planPath) : resolve4(dir, planPath);
}
function applyBoulder(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const merged = mergedConfig(ctx, config);
  const root = (exec) => boulderRoot(merged, dsh, exec);
  function goalBridge() {
    return ctx.get?.("mpdGoal");
  }
  async function anchorGoal(exec, planPath, workId) {
    try {
      const bridge = goalBridge();
      if (bridge === undefined || bridge.autoAnchor?.() !== true)
        return null;
      const outcome = await bridge.anchor(exec, { objective: "Execute the plan " + planPath + " to completion (boulder work " + workId + ") with evidence.", source: "boulder" });
      if (outcome?.goal != null && typeof outcome.goal.id === "string")
        return outcome.goal.id;
      if (outcome?.ok === false)
        dsh.rowLog(ROW_LOG, "goal anchor refused: " + String(outcome.error ?? "unknown"));
      return null;
    } catch (error) {
      dsh.rowLog(ROW_LOG, "goal anchor failed: " + String(error?.message ?? error));
      return null;
    }
  }
  async function finishGoal(exec) {
    const bridge = goalBridge();
    if (bridge === undefined)
      return;
    try {
      const outcome = await bridge.finish(exec, { outcome: "complete", source: "boulder" });
      if (outcome?.ok === false && String(outcome.error ?? "").includes("not the one mpd-goal anchored") === false) {
        dsh.rowLog(ROW_LOG, "goal finish refused: " + String(outcome.error ?? "unknown"));
      }
    } catch (error) {
      dsh.rowLog(ROW_LOG, "goal finish failed: " + String(error?.message ?? error));
    }
  }
  dsh.registerTool({
    name: "mpd_boulder_status",
    description: "Show the boulder work ledger: active works, statuses, session ids, task timers, resume options and (optionally) the progress of one plan file. State lives in .mpd/boulder.json.",
    parameters: { type: "object", properties: { planPath: { type: "string" } } },
    output: { schema: { type: "object", properties: { stateFile: { type: "string" }, activeWorks: { type: "array", items: { type: "object" } }, resumeOptions: { type: "array", items: { type: "object" } }, planProgress: { type: "object" }, state: { type: "object" } }, required: ["stateFile", "activeWorks", "resumeOptions"] }, render: (_a, v) => textBlock("boulder status: " + v.stateFile + `
active works: ` + JSON.stringify(v.activeWorks, null, 1) + `
resume: ` + JSON.stringify(v.resumeOptions, null, 1) + (v.planProgress ? `
plan: ` + JSON.stringify(v.planProgress) : "")), presentationMeta: BOULDER_STATUS_CARD },
    execute: async (args, exec) => {
      const dir = root(exec);
      const state = readBoulderState(dir);
      const activeWorks = getActiveWorks(dir);
      const resumeOptions = getWorkResumeOptions(dir);
      let planProgress = null;
      if (args?.planPath) {
        try {
          planProgress = getPlanProgress(planPathFor(dir, String(args.planPath)));
        } catch (e) {
          planProgress = { error: String(e?.message ?? e) };
        }
      }
      const result = { stateFile: join6(dir, ".mpd", "boulder.json"), activeWorks, resumeOptions };
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
      await anchorGoal(exec, planPath, String(wid ?? "?"));
      return { workId: wid ?? "?", status, stateFile: join6(dir, ".mpd", "boulder.json") };
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
      await finishGoal(exec);
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
      const resolved = planPathFor(dir, planPath);
      if (!existsSync5(resolved))
        throw new Error("mpd-boulder: plan not found: " + resolved + " (relative paths resolve against the state root " + dir + ")");
      const progress = getPlanProgress(resolved);
      return { planPath: resolved, progress };
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

// packages/mpd-autoproject-plugin/src/directive.ts
var ADVERSARIAL_CATEGORIES = [
  { angleId: "unspecified-low", angle: "attack assumptions that are not stated; find implicit scope creep." },
  { angleId: "unspecified-high", angle: "attack unstated correctness and completeness claims; find missing edge cases." },
  { angleId: "deep", angle: "attack the deepest correctness risks; find design mistakes before they cost a redo." },
  { angleId: "ultrabrain", angle: "attack from first principles; propose the cheapest faithful path to proof." },
  { angleId: "artistry", angle: "attack clarity, structure, and maintainability; find the ugly design that will age badly." }
];
var DIRECTIVE = [
  "AUTOPROJECT ROUND (fixed policy; one round of an automated MPD session)",
  "Role: expert coding agent. Ship verified work; no process narration.",
  "Tier: LIGHT (known pattern, 1-2 success criteria, one real-surface proof, notepad self-review) or HEAVY (new module/abstraction, auth/security, external integration, schema/migration, concurrency, cross-domain refactor, or the user said carefully: 3+ success criteria incl. happy+edge+regression+adversarial, reviewer loop until unconditional approval). When unsure take HEAVY; never downgrade mid-task.",
  "Toolchain: this run reuses MPD's own planes — use `mpd_role_spawn` for a bounded question you cannot answer yourself, record verification through the `mpd_verify_*` plane, and keep the durable ledger through `mpd_boulder_*`. Do not stand up a parallel engine of your own.",
  "Per-criterion loop: PIN (name the criterion + success measure) -> RED (failing-first proof) -> GREEN (cheapest faithful change) -> SURFACE (exercise the real surface) -> CLEAN (self-review, record cleanup receipts). Repeat until ALL criteria are clean.",
  "Evidence discipline: never suppress failures; capture artifacts; tests alone never prove done. Attribute a proof to its criterion by starting the evidence entry with `<key>:: ` so the engine can place it.",
  "Subagent barrier: no done/final answer while children are non-terminal.",
  "End with ONLY the structured report (role/summary/recommendation/details/evidence). The FIRST LINE of `recommendation` MUST be `STATUS: continue|complete|blocked`: continue means work remains, complete means every criterion is clean, blocked needs a concrete blocker in `summary`. Extra headings are noise."
].join(`
`);
var AUTOPROJECT_ACTIVATION_DIRECTIVE = [
  "AUTOPROJECT ACTIVATION (user-invoked; execute autonomously, and stop for a human ONLY at the three decision points below)",
  "1. TRIAGE FIRST: when the objective is unclear, or the task is investigate-first-then-execute, run one normal-MPD investigation round BEFORE the gate, a team or the loop; never open a team on a guess.",
  "2. GATE: ALREADY EVALUATED MECHANICALLY — the SAME complexity predicate the session-start gate uses (an explicit `team:`/`!team` flag OR any matched signal A-F: A flag, B deliverable verbs, C three sub-signals, D an active boulder, E Han chars AND verbs, F workspace scale) was run by the plugin BEFORE this directive was injected, with the thresholds selected by `team.sensitivity` (easy | normal | strict), and its verdict is the TEAM GATE block below this objective. C scores enumerated lines (numbered / bulleted / table rows), distinct action verbs and clauses that OPEN with an action verb against the row's own thresholds and needs at least `cSubSignals` of the three (2-of-3 on easy/normal, 3-of-3 on strict; C1/C2/C3 >= 2/3/4 per row); E needs BOTH the row's Han-character threshold AND its distinct action-verb threshold (>= 24 Han with >= 2 verbs on easy, >= 60 / >= 2 on normal, >= 80 / >= 3 on strict — the verb count is C2's). Never invent a second predicate.",
  '3. TEAM WHEN WARRANTED: the TEAM GATE block below carries the verdict, and when the gate staged a plan that plan is YOURS — extend it with `agent_teams_plan {action:"add_member"}` and `agent_teams_plan {action:"create_task"}`, then approve it YOURSELF with `agent_teams_plan {action:"approve"}` ONLY when the write scope is inside the declared scope AND the gate verdict is mechanical; otherwise ask ONE `ask_user_question`. A staged plan is INERT until approval. EVERY `create_task` must state its dependency answer — `blocked_by: [...]` (`[]` for a genuine root) or `independent: true` — because the tool REFUSES a task that states neither. EXACTLY five `agent_teams_*` tools exist on this harness — `agent_teams_plan`, `agent_teams_task`, `agent_teams_dispatch`, `agent_teams_mail`, `agent_teams_control` — and every OTHER `agent_teams_*` name is retired and GONE (e.g. `agent_teams_create`, `agent_teams_add_member`, `agent_teams_create_task`, `agent_teams_approve`, `agent_teams_status`): never call a retired one, and never read the shared `agent_teams_` prefix as a reason to skip `agent_teams_plan`.',
  "4. LOOP TO COMPLETION: keep rounds until every success criterion is clean. The ENGINE — not you — decides over-limit escalation at the round boundary, so the one case where the loop hands over instead of continuing is the case the escalation clause names.",
  "5. FIX ON SIGHT: a defect the run finds is fixed in the same turn — never report-and-wait — and a fix that would write OUTSIDE the declared scope is a decision point, not a fix.",
  "6. CLOSE OUT ON PROOF: report done only after the verification gate and the quality-gate ledger both approve, and only with a recorded verify PASS in the verify plane; otherwise keep working, or report the concrete blocker.",
  "7. WHEN YOU STOP: exactly three decision points — (a) the over-limit escalation fired and `autoproject.escalate.mode` is `ask`; (b) a credential, a secret or an external capability is absent; (c) the next write would leave the declared scope. Nothing else stops the run."
].join(`
`);

// packages/mpd-autoproject-plugin/src/engine.ts
import { appendFileSync, existsSync as existsSync6, mkdirSync as mkdirSync3, readdirSync as readdirSync2, readFileSync as readFileSync3, statSync as statSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join7, relative as relative3 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";

// packages/mpd-autoproject-plugin/src/escalation.ts
var ESCALATION_DEFAULTS = {
  mode: "ask",
  criteriaMax: 12,
  tasksMax: 8,
  scopePathsMax: 20,
  verifyFailsMax: 2,
  ledgerBytesMax: 262144
};
var ESCALATE_PREFIX = "autoproject.escalate";
function escalationReader(live, row2) {
  const block = row2 !== null && typeof row2 === "object" ? row2 : undefined;
  return (key) => {
    try {
      const value = live?.(key);
      if (value !== undefined && value !== null)
        return value;
    } catch {}
    if (block === undefined)
      return;
    const leaf = key.startsWith(ESCALATE_PREFIX + ".") ? key.slice(ESCALATE_PREFIX.length + 1) : key;
    return block[leaf];
  };
}
function resolveEscalationMode(value) {
  if (value === "off" || value === "auto" || value === "ask")
    return value;
  return ESCALATION_DEFAULTS.mode;
}
function positiveIntOf(value, fallback) {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
function resolveEscalationConfig(read) {
  return {
    mode: resolveEscalationMode(read(ESCALATE_PREFIX + ".mode")),
    criteriaMax: positiveIntOf(read(ESCALATE_PREFIX + ".criteriaMax"), ESCALATION_DEFAULTS.criteriaMax),
    tasksMax: positiveIntOf(read(ESCALATE_PREFIX + ".tasksMax"), ESCALATION_DEFAULTS.tasksMax),
    scopePathsMax: positiveIntOf(read(ESCALATE_PREFIX + ".scopePathsMax"), ESCALATION_DEFAULTS.scopePathsMax),
    verifyFailsMax: positiveIntOf(read(ESCALATE_PREFIX + ".verifyFailsMax"), ESCALATION_DEFAULTS.verifyFailsMax),
    ledgerBytesMax: positiveIntOf(read(ESCALATE_PREFIX + ".ledgerBytesMax"), ESCALATION_DEFAULTS.ledgerBytesMax)
  };
}
function evaluateEscalation(input) {
  const fired = [];
  if (input.criteria > input.config.criteriaMax)
    fired.push({ id: "S1", value: input.criteria, threshold: input.config.criteriaMax });
  if (input.status === "max-rounds")
    fired.push({ id: "S2", value: 1, threshold: 1 });
  if (input.fruitlessWaves >= 2)
    fired.push({ id: "S3", value: input.fruitlessWaves, threshold: 2 });
  if (input.ledgerBytes > input.config.ledgerBytesMax)
    fired.push({ id: "S4", value: input.ledgerBytes, threshold: input.config.ledgerBytesMax });
  if (input.scopeTrees > input.config.scopePathsMax)
    fired.push({ id: "S6", value: input.scopeTrees, threshold: input.config.scopePathsMax });
  if (input.sameCriterionVerifyFails >= input.config.verifyFailsMax)
    fired.push({ id: "S7", value: input.sameCriterionVerifyFails, threshold: input.config.verifyFailsMax });
  const counters = fired.filter((s) => s.id !== "S2" && s.id !== "S3").length;
  const selfSufficient = fired.some((s) => s.id === "S2" || s.id === "S3");
  return { escalate: selfSufficient || counters >= 2, signals: fired };
}
var STATUS_LINE = /^[*_\s`]*status[*_\s`]*[:=]\s*[*_\s`]*(continue|complete|blocked)\b/i;
var VERDICT_LINE = /^[*_\s`]*verdict[*_\s`]*[:=]\s*[*_\s`]*(pass|fail|approve|reject)\b/i;
var REVIEW_LINE = /^[*_\s`]*review[*_\s`]*[:=]\s*[*_\s`]*(required|optional)\b/i;
function recommendationStatus(recommendation) {
  const first = String(recommendation ?? "").split(`
`).map((line) => line.trim()).find((line) => line !== "") ?? "";
  const match = STATUS_LINE.exec(first);
  return match === null ? undefined : match[1].toLowerCase();
}
function recommendationVerdict(recommendation) {
  const first = String(recommendation ?? "").split(`
`).map((line) => line.trim()).find((line) => line !== "") ?? "";
  const match = VERDICT_LINE.exec(first);
  if (match === null)
    return;
  const token = match[1].toLowerCase();
  return token === "pass" || token === "approve" ? "PASS" : "FAIL";
}
function reviewRequired(recommendation) {
  const first = String(recommendation ?? "").split(`
`).map((line) => line.trim()).find((line) => line !== "") ?? "";
  const match = REVIEW_LINE.exec(first);
  return match !== null && match[1].toLowerCase() === "required";
}
function evidenceAttribution(entry) {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]{0,31})\s*::\s*([\s\S]*)$/.exec(String(entry ?? ""));
  return match === null ? undefined : { key: match[1], text: match[2].trim() };
}
function topLevelScope(entries) {
  const trees = [];
  for (const raw of entries) {
    const text2 = String(raw ?? "").trim().replace(/^\.\//, "");
    if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/|~)/.test(text2))
      continue;
    if (!text2.includes("/"))
      continue;
    const segment = text2.split("/")[0];
    if (segment === undefined || segment === "" || segment === "." || segment === "..")
      continue;
    if (!trees.includes(segment))
      trees.push(segment);
  }
  return trees;
}
function criterionLabel(raw) {
  return String(raw ?? "").replace(/^\s*(?:[1-9]\d*[.)]|[-*])\s+/, "").replace(/\s+/g, " ").trim().slice(0, 200);
}
var TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
var FINAL_WAVE_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
var SECTION_HEADING = /^#{1,2}(?:[ \t]+|$)/;
function stripChecklistSections(markdown) {
  const kept = [];
  let dropping = false;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (TODO_HEADING.test(line) || FINAL_WAVE_HEADING.test(line)) {
      dropping = true;
      continue;
    }
    if (dropping && SECTION_HEADING.test(line))
      dropping = false;
    if (!dropping)
      kept.push(line);
  }
  return kept.join(`
`);
}
function emitPlanMarkdown(plan, criteria) {
  const body = stripChecklistSections(plan).trimEnd();
  const items = criteria.map((criterion, index) => "- [ ] " + (index + 1) + ". " + criterion.label).join(`
`);
  return (body === "" ? "# Autoproject plan" : body) + `

## TODOs

` + items + `
`;
}

// packages/mpd-autoproject-plugin/src/engine.ts
var ROLE_SPAWN_TOOL = "mpd_role_spawn";
var ROLE_CONSULT_TOOL = "mpd_role_consult";
var VERIFY_OPEN_TOOL = "mpd_verify_open";
var CELLWORK_OPEN_TOOL = "cellwork_open";
var BOULDER_START_TOOL = "mpd_boulder_start";
var BOULDER_TIMER_TOOL = "mpd_boulder_task_timer";
var BOULDER_COMPLETE_TOOL = "mpd_boulder_complete";
var ROLE_DEEP_WORKER = "Deep Worker";
var ROLE_SENIOR_ENGINEER = "Senior Engineer";
var ROLE_JUNIOR_ENGINEER = "Junior Engineer";
var ROLE_PLANNER = "Planner";
var ROLE_PLAN_REVIEWER = "Plan Reviewer";
var ROLE_REVIEWER = "Reviewer";
var ROLE_ARCHITECT = "Architect";
var QUALITY_LANES = ["code quality", "hands-on QA", "goal verification"];
var ROW_LOG2 = "mpd-autoproject";
var SLOTS_CONFIG_KEY = "autoproject.slots";
var SLOT_BOUND_CONFIG_KEY = "autoproject.slotBoundMs";
var SLOTS_DEFAULT = 3;
var SLOT_BOUND_DEFAULT_MS = 900000;
function planRoot(config, dsh, exec) {
  return config.planDir ?? join7(dsh.workspaceRoot(exec), ".mpd", "plans");
}
function stateRoot(config, dsh, exec) {
  return config.stateDir ?? join7(dsh.workspaceRoot(exec), ".mpd", "autoproject");
}
function writeJson(path, value) {
  writeFileSync2(path, JSON.stringify(value, null, 2));
}
function errorTextOf2(error) {
  if (typeof error === "string")
    return error;
  const message = error?.message;
  if (message !== undefined)
    return String(message);
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
function declaredScopeOf(value) {
  if (!Array.isArray(value))
    return null;
  const declared = [];
  for (const entry of value) {
    const path = typeof entry === "string" ? entry.trim() : "";
    if (path === "" || declared.includes(path))
      continue;
    declared.push(path);
  }
  return declared.length === 0 ? null : declared;
}
function isRouteUnconfigured(text2) {
  return /AGENT_UNCONFIGURED|no configured route|UNCONFIGURED/.test(text2);
}
function goalBridgeOf(ctx) {
  return ctx.get?.("mpdGoal");
}
async function anchorGoal(deps, exec, objective) {
  try {
    const bridge = goalBridgeOf(deps.ctx);
    if (bridge === undefined || bridge.autoAnchor?.() !== true)
      return null;
    const outcome = await bridge.anchor(exec, { objective, source: "autoproject" });
    if (outcome?.goal != null && typeof outcome.goal.id === "string")
      return outcome.goal.id;
    if (outcome?.ok === false)
      deps.dsh.rowLog?.(ROW_LOG2, "goal anchor refused: " + String(outcome.error ?? "unknown"));
    return null;
  } catch (error) {
    deps.dsh.rowLog?.(ROW_LOG2, "goal anchor failed: " + errorTextOf2(error));
    return null;
  }
}
async function finishGoal(deps, exec, status, reason) {
  if (status !== "complete" && status !== "blocked")
    return;
  const bridge = goalBridgeOf(deps.ctx);
  if (bridge === undefined)
    return;
  try {
    const outcome = await bridge.finish(exec, { outcome: status === "blocked" ? "blocked" : "complete", source: "autoproject", ...status === "blocked" ? { reason } : {} });
    if (outcome?.ok === false)
      deps.dsh.rowLog?.(ROW_LOG2, "goal finish (" + status + ") refused: " + String(outcome.error ?? "unknown"));
  } catch (error) {
    deps.dsh.rowLog?.(ROW_LOG2, "goal finish failed: " + errorTextOf2(error));
  }
}
async function boulderStart(dsh, exec, planPath) {
  const result = await dsh.executeTool({ name: BOULDER_START_TOOL, arguments: { planPath }, agent: exec?.agent });
  if (result?.ok !== true || result.isError === true) {
    dsh.rowLog?.(ROW_LOG2, "boulder start degraded: " + errorTextOf2(result?.error ?? "the call did not report ok"));
    return null;
  }
  const workId = result.value?.workId;
  return typeof workId === "string" && workId !== "" ? workId : null;
}
async function boulderTimer(dsh, exec, workId, taskKey, action, label) {
  const result = await dsh.executeTool({
    name: BOULDER_TIMER_TOOL,
    arguments: { workId, taskKey, action, ...action === "start" ? { taskLabel: label, taskTitle: label } : {} },
    agent: exec?.agent
  });
  if (result?.ok !== true || result.isError === true)
    dsh.rowLog?.(ROW_LOG2, "boulder timer " + action + " degraded for " + taskKey + ": " + errorTextOf2(result?.error ?? "the call did not report ok"));
}
async function boulderComplete(dsh, exec, workId) {
  const result = await dsh.executeTool({ name: BOULDER_COMPLETE_TOOL, arguments: { workId }, agent: exec?.agent });
  if (result?.ok !== true || result.isError === true)
    dsh.rowLog?.(ROW_LOG2, "boulder complete degraded: " + errorTextOf2(result?.error ?? "the call did not report ok"));
}
function verifyPassRecorded(workspace, loopId) {
  const dir = join7(workspace, ".mpd", "verify", "records");
  try {
    if (!existsSync6(dir))
      return false;
    for (const name of readdirSync2(dir)) {
      if (!name.endsWith(".json"))
        continue;
      try {
        const record = JSON.parse(readFileSync3(join7(dir, name), "utf8"));
        if (record?.loopId === loopId && record?.verdict === "PASS")
          return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}
function relativeContract(workspace, planFile) {
  if (planFile === null)
    return;
  try {
    const rel = relative3(workspace, planFile);
    return rel === "" || rel.startsWith("..") ? undefined : rel;
  } catch {
    return;
  }
}
function verifyTask(loopId, objective) {
  return [
    "Verify this autoproject run READ-ONLY. You may not modify any file.",
    "1. Bind yourself as the loop's verifier: `mpd_verify_seat {loop_id: \"" + loopId + '", role: "verifier"}`.',
    '2. Produce REAL gate evidence: `mpd_verify_evidence {kind: "gate", gate: "<gate id>", loop_id: "' + loopId + "\"}` for each gate you actually ran (the project's own gate table).",
    '3. Record the verdict: `mpd_verify_record {loop_id: "' + loopId + '", verdict: "PASS" or "FAIL", sources: [<the plan file and the docs you worked from>], evidence_ids: [<the ids step 2 RETURNED>]}`. A record without real sources and real evidence ids is REFUSED, and this run then cannot complete — do NOT report PASS unless the record was accepted.',
    "Attribute each finding to its criterion by opening the evidence entry with `<criterionKey>:: `.",
    "The FIRST line of your `recommendation` MUST be `VERDICT: PASS` or `VERDICT: FAIL`.",
    "Objective: " + objective
  ].join(`
`);
}
async function runAutoproject(args, exec, deps) {
  const { dsh, ctx, config } = deps;
  const planDir = planRoot(config, dsh, exec);
  const stateDir = stateRoot(config, dsh, exec);
  const workspace = dsh.workspaceRoot(exec);
  const objective = String(args?.objective ?? "").trim();
  if (objective === "")
    throw new Error("mpd_autoproject: objective required");
  if (!dsh.hasTool(ROLE_SPAWN_TOOL, exec?.agent)) {
    throw new Error("mpd_autoproject: " + ROLE_SPAWN_TOOL + " is not registered in this composition — every child of an autoproject run is a roster consult, so mount the mpd-roles row");
  }
  const tier = args?.tier === "heavy" ? "heavy" : "light";
  const plan = args?.plan === true || tier === "heavy";
  const hyperplan = args?.hyperplan === true;
  const strictReview = args?.strictReview === true;
  const rounds = Math.min(Math.max(Number(args?.maxRounds ?? config.maxRounds ?? 6) || 1, 1), 8);
  const maxReReviews = Math.max(0, Math.trunc(Number(config.maxReReviews ?? 2) || 0));
  const escalation = resolveEscalationConfig(escalationReader((key) => liveConfigValue(ctx, key), config.escalate));
  const roundRole = tier === "heavy" ? ROLE_DEEP_WORKER : plan ? ROLE_SENIOR_ENGINEER : ROLE_JUNIOR_ENGINEER;
  const declaredScope = declaredScopeOf(args?.scope);
  const id = "autoproject-" + randomUUID2().slice(0, 8);
  const dir = join7(stateDir, id);
  mkdirSync3(dir, { recursive: true });
  mkdirSync3(planDir, { recursive: true });
  const stateFile = join7(dir, "state.json");
  const ledgerFile = join7(dir, "ledger.jsonl");
  const escalationFile = join7(dir, "escalation.json");
  function stamp(lane, verdict2, detail) {
    try {
      appendFileSync(ledgerFile, JSON.stringify({ lane, verdict: verdict2, detail, at: new Date().toISOString() }) + `
`);
    } catch {}
  }
  const state = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 };
  writeJson(stateFile, state);
  const criteria = new Map;
  const evidence = [];
  const verifyFails = new Map;
  const timersRunning = new Set;
  const slotCount = Math.max(1, Math.trunc(Number(liveConfigValue(ctx, SLOTS_CONFIG_KEY) ?? config.slots ?? SLOTS_DEFAULT) || SLOTS_DEFAULT));
  const slotBoundMs = Math.max(1, Math.trunc(Number(liveConfigValue(ctx, SLOT_BOUND_CONFIG_KEY) ?? config.slotBoundMs ?? SLOT_BOUND_DEFAULT_MS) || SLOT_BOUND_DEFAULT_MS));
  let slotsHeld = 0;
  let slotsPeak = 0;
  const slotWaiters = [];
  const killed = [];
  state.slots = slotCount;
  state.slotBoundMs = slotBoundMs;
  state.slotsPeak = 0;
  state.kills = killed;
  writeJson(stateFile, state);
  async function acquireSlot() {
    if (slotsHeld < slotCount) {
      slotsHeld += 1;
      if (slotsHeld > slotsPeak) {
        slotsPeak = slotsHeld;
        state.slotsPeak = slotsPeak;
      }
      return;
    }
    await new Promise((resolve5) => {
      slotWaiters.push(resolve5);
    });
    slotsHeld += 1;
    if (slotsHeld > slotsPeak) {
      slotsPeak = slotsHeld;
      state.slotsPeak = slotsPeak;
    }
  }
  function releaseSlot() {
    slotsHeld = Math.max(0, slotsHeld - 1);
    const next = slotWaiters.shift();
    if (next !== undefined)
      next();
  }
  function composedSignalOf(outer, own) {
    if (outer === undefined || outer === null)
      return own.signal;
    const outerSignal = outer;
    if (outerSignal.aborted === true) {
      own.abort();
      return own.signal;
    }
    try {
      outerSignal.addEventListener("abort", () => own.abort(), { once: true });
    } catch {}
    return own.signal;
  }
  async function rosterStillSupervising(role) {
    if (!dsh.hasTool(ROLE_CONSULT_TOOL, exec?.agent))
      return false;
    try {
      const result = await dsh.executeTool({ name: ROLE_CONSULT_TOOL, arguments: { action: "list" }, agent: exec?.agent });
      if (result?.ok !== true || result.isError === true)
        return false;
      const value = result.value ?? {};
      const consults = Array.isArray(value.consults) ? value.consults : [];
      return consults.some((entry) => {
        if (entry === null || typeof entry !== "object")
          return false;
        const view = entry;
        return view.state === "running" && view.role === role;
      });
    } catch {
      return false;
    }
  }
  async function consult(role, task, context) {
    await acquireSlot();
    const startedAt = Date.now();
    const controller = new AbortController;
    const signal = composedSignalOf(exec?.signal, controller);
    let timer;
    const child = consultOnce(role, task, context, signal);
    try {
      for (;; ) {
        const expired = new Promise((resolve5) => {
          timer = setTimeout(() => resolve5("timeout"), slotBoundMs);
        });
        const raced = await Promise.race([child, expired]);
        if (raced !== "timeout")
          return raced;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (await rosterStillSupervising(role)) {
          dsh.rowLog?.(ROW_LOG2, "consult " + role + " is still supervised by its roster deadman at the " + slotBoundMs + " ms slot bound — the engine re-armed instead of aborting the child");
          continue;
        }
        try {
          controller.abort();
        } catch {}
        const elapsedMs = Date.now() - startedAt;
        const kill = { role, at: new Date().toISOString(), elapsedMs, boundMs: slotBoundMs, round: state.wave };
        killed.push(kill);
        state.kills = killed;
        state.slots = slotCount;
        state.slotBoundMs = slotBoundMs;
        writeJson(stateFile, state);
        stamp("late/killed:" + role, "killed", "elapsed=" + elapsedMs + "ms bound=" + slotBoundMs + "ms round=" + state.wave);
        dsh.rowLog?.(ROW_LOG2, "killed " + role + " at the " + slotBoundMs + " ms slot bound (elapsed " + elapsedMs + " ms)");
        return null;
      }
    } finally {
      if (timer !== undefined)
        clearTimeout(timer);
      releaseSlot();
    }
  }
  async function consultOnce(role, task, context, signal) {
    const result = await dsh.executeTool({ name: ROLE_SPAWN_TOOL, arguments: { role, task, ...context === undefined || context === "" ? {} : { context } }, agent: exec?.agent, signal });
    if (result?.ok !== true || result.isError === true) {
      const text2 = errorTextOf2(result?.error ?? "the role-spawn call did not report ok");
      stamp(isRouteUnconfigured(text2) ? "route-unconfigured:" + role : "child-degraded:" + role, "skipped", text2);
      dsh.rowLog?.(ROW_LOG2, "consult " + role + " degraded: " + text2);
      return null;
    }
    const value = result.value ?? {};
    if (value.status === "interrupted") {
      const handoff = typeof value.handoff === "string" ? value.handoff : "";
      const elapsedMs = typeof value.elapsedMs === "number" ? value.elapsedMs : 0;
      const kill = { role, at: new Date().toISOString(), elapsedMs, boundMs: slotBoundMs, round: state.wave };
      killed.push(kill);
      state.kills = killed;
      state.slotBoundMs = slotBoundMs;
      writeJson(stateFile, state);
      stamp("late/interrupted:" + role, "killed", "elapsed=" + elapsedMs + "ms handoff=" + (handoff === "" ? "<none>" : handoff));
      dsh.rowLog?.(ROW_LOG2, "consult " + role + " was interrupted by its deadman (elapsed " + elapsedMs + " ms)" + (handoff === "" ? "" : " — handoff " + handoff));
      return null;
    }
    return {
      role: typeof value.role === "string" && value.role !== "" ? value.role : role,
      status: typeof value.status === "string" ? value.status : "",
      summary: typeof value.summary === "string" ? value.summary : "",
      recommendation: typeof value.recommendation === "string" ? value.recommendation : "",
      details: typeof value.details === "string" ? value.details : "",
      evidence: Array.isArray(value.evidence) ? value.evidence.map((entry) => String(entry)) : []
    };
  }
  function absorb(report) {
    if (report === null)
      return [];
    const advanced = [];
    for (const entry of report.evidence) {
      evidence.push(entry);
      const attribution = evidenceAttribution(entry);
      if (attribution === undefined)
        continue;
      const criterion = criteria.get(attribution.key);
      if (criterion === undefined)
        continue;
      criteria.set(attribution.key, { ...criterion, state: "clean", evidence: [...criterion.evidence, attribution.text] });
      if (!advanced.includes(attribution.key))
        advanced.push(attribution.key);
    }
    return advanced;
  }
  const ledgerBytes = () => existsSync6(ledgerFile) ? statSync3(ledgerFile).size : 0;
  const highestVerifyFails = () => {
    let max = 0;
    for (const count of verifyFails.values())
      if (count > max)
        max = count;
    return max;
  };
  let finalReport = "";
  let status = "continue";
  let used = 0;
  let planFile = null;
  let boulderWorkId = null;
  let verifyLoopId = null;
  let verdict = "n/a";
  let gateLedger = [];
  let escalated = false;
  let scopeStamped = false;
  async function considerEscalation(boundaryStatus) {
    if (escalated)
      return false;
    const scope = declaredScope ?? topLevelScope(evidence);
    const scopeSource = declaredScope === null ? "evidence" : "declared";
    if (!scopeStamped) {
      scopeStamped = true;
      stamp("scope", scopeSource, scope.join(",") || "(none declared and no path evidence)");
    }
    const decision = evaluateEscalation({
      criteria: criteria.size,
      status: boundaryStatus,
      fruitlessWaves: state.fruitlessWaves,
      ledgerBytes: ledgerBytes(),
      scopeTrees: declaredScope === null ? scope.length : topLevelScope(declaredScope).length,
      sameCriterionVerifyFails: highestVerifyFails(),
      config: escalation
    });
    if (!decision.escalate)
      return false;
    const fired = decision.signals;
    stamp("escalation", escalation.mode === "off" ? "suppressed" : "fired", fired.map((signal) => signal.id + "=" + signal.value + "/" + signal.threshold).join(",") + " mode=" + escalation.mode);
    if (escalation.mode === "off")
      return false;
    escalated = true;
    let handoff = "instruction";
    if (escalation.mode === "auto" && dsh.hasTool(CELLWORK_OPEN_TOOL, exec?.agent)) {
      const opened = await dsh.executeTool({ name: CELLWORK_OPEN_TOOL, arguments: { objective, mandate: { source: "autoproject", runId: id, planFile }, planFile, scope }, agent: exec?.agent });
      if (opened?.ok === true && opened.isError !== true)
        handoff = CELLWORK_OPEN_TOOL;
      else
        dsh.rowLog?.(ROW_LOG2, "cellwork hand-off degraded: " + errorTextOf2(opened?.error ?? "the call did not report ok"));
    }
    const artifact = {
      version: 1,
      at: new Date().toISOString(),
      mode: escalation.mode,
      signals: fired,
      objective,
      planFile,
      criteria: [...criteria.values()],
      evidence: [...evidence],
      scope,
      scopeSource,
      writer: { id: roundRole + " · " + id, role: roundRole, runId: id, bound: "label-not-agent-key" },
      roundsUsed: used,
      mandate: { source: "autoproject", runId: id, planFile },
      handoff: { path: handoff }
    };
    state.status = "escalated";
    writeJson(stateFile, state);
    writeJson(escalationFile, artifact);
    stamp("handoff", handoff, handoff === CELLWORK_OPEN_TOOL ? "cellwork opened" : "run `/cellwork " + objective + "`");
    finalReport += (finalReport === "" ? "" : `
`) + "escalated [" + fired.map((signal) => signal.id).join("/") + "] mode=" + escalation.mode + ": " + (handoff === CELLWORK_OPEN_TOOL ? "handed off to cellwork" : "run `/cellwork " + objective + "` to continue the project there");
    return true;
  }
  if (plan) {
    const goalId = await anchorGoal(deps, exec, objective);
    if (goalId !== null) {
      state.goalId = goalId;
      writeJson(stateFile, state);
    }
  }
  let insights = [];
  if (hyperplan) {
    const reports = await Promise.all(ADVERSARIAL_CATEGORIES.map((angle) => consult(ROLE_ARCHITECT, "Run ONE adversarial angle over the objective. Report only defensible insights, no code changes.", "Angle " + angle.angleId + ": " + angle.angle + `
Objective: ` + objective)));
    for (const report of reports) {
      if (report === null)
        continue;
      insights.push(report.summary, ...report.evidence);
    }
    insights = insights.map((line) => line.trim()).filter((line) => line !== "").slice(0, 20);
    stamp("hyperplan", "done", insights.length + " insights distilled");
  }
  let planReviewOk = false;
  if (plan) {
    const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan";
    const planner = await consult(ROLE_PLANNER, [
      "Write a decision-complete, step-ordered plan for the objective below.",
      "Put the plan MARKDOWN in `details`.",
      "Put the plan's success criteria in `evidence`, ONE criterion per entry, each a one-line success measure (include the edge, regression and adversarial criteria for a HEAVY change set). No numbering.",
      "The FIRST line of `recommendation` MUST be `REVIEW: required` or `REVIEW: optional`.",
      "Objective: " + objective,
      ...insights.length === 0 ? [] : ["Adversarial insights to fold in:", ...insights.map((line) => "- " + line)]
    ].join(`
`));
    const seeds = (planner?.evidence ?? []).map((entry) => criterionLabel(entry)).filter((label) => label !== "").map((label, index) => ({ key: String(index + 1), label }));
    if (seeds.length === 0) {
      seeds.push({ key: "1", label: criterionLabel(objective) });
      stamp("plan", "criteria-fallback", "the planner reported no criteria; the objective is the one criterion");
    }
    const planPath = join7(planDir, slug + "-" + id.slice(-4) + ".md");
    writeFileSync2(planPath, emitPlanMarkdown(planner?.details ?? planner?.summary ?? "", seeds));
    planFile = planPath;
    state.planFile = planPath;
    for (const seed of seeds)
      criteria.set(seed.key, { key: seed.key, label: seed.label, state: "pin", evidence: [] });
    stamp("plan", "written", planPath + " (" + seeds.length + " criteria)");
    boulderWorkId = await boulderStart(dsh, exec, planPath);
    if (boulderWorkId !== null) {
      state.boulderWorkId = boulderWorkId;
      writeJson(stateFile, state);
    }
    if (tier === "heavy" || reviewRequired(planner?.recommendation ?? "")) {
      for (let attempt = 0;attempt <= maxReReviews; attempt++) {
        const review = await consult(ROLE_PLAN_REVIEWER, [
          "Review this plan READ-ONLY; reject only true blockers. Concerns must be concrete and actionable.",
          "The FIRST line of `recommendation` MUST be `VERDICT: PASS` or `VERDICT: FAIL`.",
          "The plan is quoted below.",
          String(planner?.details ?? ""),
          "Objective: " + objective
        ].join(`
`));
        const declared = recommendationVerdict(review?.recommendation ?? "");
        if (declared === "PASS") {
          planReviewOk = true;
          break;
        }
        stamp("plan-review", "fail", review?.summary || review?.details || "no report");
      }
      stamp("plan-review", planReviewOk ? "approve" : "reject", planReviewOk ? "the plan gate approved" : "the plan gate rejected after " + (maxReReviews + 1) + " attempt(s)");
    } else {
      planReviewOk = true;
      stamp("plan-review", "skipped", "the planner asked for no review and the tier is not heavy");
    }
  } else {
    criteria.set("1", { key: "1", label: criterionLabel(objective), state: "pin", evidence: [] });
    planReviewOk = true;
  }
  const recap = [];
  for (let round = 1;round <= rounds; round++) {
    used = round;
    if (boulderWorkId !== null) {
      for (const criterion of criteria.values()) {
        if (criterion.state === "clean" || timersRunning.has(criterion.key))
          continue;
        await boulderTimer(dsh, exec, boulderWorkId, criterion.key, "start", criterion.label);
        timersRunning.add(criterion.key);
      }
    }
    const critNow = [...criteria.values()].map((criterion) => "- [" + criterion.key + "] " + criterion.label + " -> " + criterion.state);
    const recent = recap.slice(-3);
    const task = DIRECTIVE + `

` + "autoproject round " + round + "/" + rounds + `
` + "Objective: " + objective + `
` + (planFile === null ? "" : "Plan file: " + planFile + `
`) + "Durable state: " + stateFile + " (ledger: " + ledgerFile + ` — read them for the full history)
` + `Criteria:
` + (critNow.join(`
`) || `(discover and pin criteria in this round)
`) + `Recent handoff:
` + (recent.join(`
`) || "(none - first round)");
    const report = await consult(roundRole, task);
    const advanced = absorb(report);
    if (boulderWorkId !== null) {
      for (const key of advanced) {
        if (!timersRunning.delete(key))
          continue;
        await boulderTimer(dsh, exec, boulderWorkId, key, "end", criteria.get(key)?.label ?? key);
      }
    }
    if (advanced.length === 0 && (report === null || report.evidence.length === 0))
      state.fruitlessWaves++;
    state.wave = round;
    state.criteria = [...criteria.values()];
    writeJson(stateFile, state);
    recap.push("round " + round + ": " + (report?.summary ?? "no report"));
    finalReport = "round " + round + ": " + (report?.summary ?? "no report");
    const declared = recommendationStatus(report?.recommendation ?? "") ?? "continue";
    if (declared === "complete" && allClean(criteria) && planReviewOk) {
      status = "complete";
      break;
    }
    if (declared === "blocked") {
      status = "blocked";
      finalReport += `
blocked: ` + (report?.summary ?? "");
      break;
    }
    if (state.fruitlessWaves >= 2) {
      status = "max-rounds";
      finalReport += `
stopped: 2 fruitless discovery waves`;
      break;
    }
    if (round === rounds)
      status = "max-rounds";
    if (await considerEscalation(status)) {
      status = "escalated";
      break;
    }
  }
  if (status === "continue")
    status = "max-rounds";
  if (status !== "escalated" && await considerEscalation(status))
    status = "escalated";
  if (status === "complete") {
    const contract = relativeContract(workspace, planFile);
    const writerId = roundRole + " · " + id;
    stamp("verify-writer", roundRole, "writer_id=" + writerId + " runId=" + id + " bound=label-not-agent-key (mpd_role_spawn exposes no agent key, C6)");
    const opened = await dsh.executeTool({
      name: VERIFY_OPEN_TOOL,
      arguments: {
        writer: "delegate",
        writer_id: writerId,
        writer_reason: "member: " + roundRole,
        scope: declaredScope ?? topLevelScope(evidence),
        ...contract === undefined ? {} : { contract }
      },
      agent: exec?.agent,
      signal: exec?.signal
    });
    if (opened?.ok !== true || opened.isError === true) {
      const refusal = errorTextOf2(opened?.error ?? "the verify loop could not be opened");
      stamp("verify-loop", "refused", refusal);
      status = "blocked";
      finalReport += `
verify: ` + refusal + " — a run may not report complete without a recorded PASS";
    } else {
      const loopId = String(opened.value?.loopId ?? "");
      verifyLoopId = loopId === "" ? null : loopId;
      if (verifyLoopId === null) {
        stamp("verify-loop", "refused", "the loop opener reported no loop id");
        status = "blocked";
        finalReport += `
verify: the verify loop reported no id — a run may not report complete without a recorded PASS`;
      } else {
        state.verifyLoopId = verifyLoopId;
        writeJson(stateFile, state);
        let approved = false;
        let refusal = "the verifier recorded no PASS";
        for (let attempt = 0;attempt <= maxReReviews; attempt++) {
          const report = await consult(ROLE_REVIEWER, verifyTask(verifyLoopId, objective));
          if (report !== null && recommendationVerdict(report.recommendation) === "PASS" && verifyPassRecorded(workspace, verifyLoopId)) {
            approved = true;
            break;
          }
          refusal = report?.summary || report?.details || refusal;
          for (const entry of report?.evidence ?? []) {
            evidence.push(entry);
            const attribution = evidenceAttribution(entry);
            if (attribution === undefined || !criteria.has(attribution.key))
              continue;
            verifyFails.set(attribution.key, (verifyFails.get(attribution.key) ?? 0) + 1);
          }
          stamp("verification", "fail", refusal);
        }
        verdict = approved ? "approve" : "reject";
        if (approved) {
          stamp("verification", "approve", "a PASS record exists for " + verifyLoopId);
        } else {
          status = "blocked";
          finalReport += `
verify: ` + refusal + " — no PASS record exists for " + verifyLoopId + ", so this run is NOT done";
        }
      }
    }
    if (status !== "escalated" && await considerEscalation(status))
      status = "escalated";
  } else {
    stamp("verification", "skipped", "the round phase did not reach a complete state");
  }
  if (status === "complete") {
    const reviews = await Promise.all(QUALITY_LANES.map((lane) => consult(ROLE_REVIEWER, [
      "Judge ONE quality-gate lane of this autoproject run: " + lane + ".",
      "Work hands-on where the lane allows it; do not modify the implementation.",
      "Put the FIRST line of `recommendation` as `VERDICT: PASS` or `VERDICT: FAIL`, and the evidence in `summary`.",
      "Objective: " + objective,
      ...planFile === null ? [] : ["Plan file: " + planFile],
      "Rounds:",
      recap.join(`
`)
    ].join(`
`))));
    gateLedger = QUALITY_LANES.map((lane, index) => {
      const report = reviews[index] ?? null;
      return { lane, verdict: recommendationVerdict(report?.recommendation ?? "") === "PASS" ? "PASS" : "FAIL", evidence: report?.summary || report?.details || "no report" };
    });
    for (const row2 of gateLedger)
      stamp("quality-" + row2.lane, row2.verdict, row2.evidence);
    if (gateLedger.some((row2) => row2.verdict === "FAIL")) {
      status = "blocked";
      finalReport += `
quality gate: a lane FAILED`;
    }
  }
  if (boulderWorkId !== null && status === "complete")
    await boulderComplete(dsh, exec, boulderWorkId);
  if (killed.length > 0) {
    finalReport += `
slots: ` + String(killed.length) + " child(ren) killed at the " + String(slotBoundMs) + " ms bound (" + killed.map((kill) => kill.role + "@" + String(kill.elapsedMs) + "ms round " + String(kill.round)).join(", ") + ")";
    if (status !== "escalated")
      status = "blocked";
  }
  state.status = status;
  state.verdict = verdict;
  state.criteria = [...criteria.values()];
  writeJson(stateFile, state);
  if (finalReport === "")
    finalReport = status;
  await finishGoal(deps, exec, status, finalReport.trim().slice(-400));
  return { status, rounds: used, ...planFile === null ? {} : { planFile }, verdict, ledger: gateLedger, finalReport, stateFile };
}
function allClean(criteria) {
  if (criteria.size === 0)
    return false;
  for (const criterion of criteria.values())
    if (criterion.state !== "clean")
      return false;
  return true;
}
function liveConfigValue(ctx, key) {
  try {
    const service = ctx.get?.("mpdConfig", false);
    return service?.get?.(key);
  } catch {
    return;
  }
}

// packages/mpd-autoproject-plugin/src/index.ts
var name = "mpd-autoproject";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS);
function mergedConfig2(ctx, config) {
  const svc = ctx.get?.("mpdConfig");
  if (!svc?.get)
    return config;
  const v = (k) => svc.get(k);
  return {
    ...config,
    maxRounds: typeof v("autoproject.maxRounds") === "number" ? v("autoproject.maxRounds") : config.maxRounds,
    planDir: typeof v("autoproject.planDir") === "string" ? v("autoproject.planDir") : config.planDir,
    stateDir: typeof v("autoproject.stateDir") === "string" ? v("autoproject.stateDir") : config.stateDir,
    maxReReviews: typeof v("autoproject.maxReReviews") === "number" ? v("autoproject.maxReReviews") : config.maxReReviews
  };
}
function activationDirective(objective, gate) {
  const base = AUTOPROJECT_ACTIVATION_DIRECTIVE + String.fromCharCode(10, 10) + "OBJECTIVE: " + String(objective ?? "").trim();
  return gate === undefined ? base : base + String.fromCharCode(10, 10) + gateTrailerText(gate);
}
function messageText(message) {
  if (!Array.isArray(message?.content))
    return;
  const parts = message.content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text);
  return parts.length === 0 ? undefined : parts.join(String.fromCharCode(10));
}
var GESTURE_PATTERN = /^\/autoproject(?:[\t\n\r ]+|$)/u;
function claimGesture(messages) {
  if (!Array.isArray(messages))
    return;
  for (const message of messages) {
    if (message?.role !== "user")
      continue;
    const text2 = messageText(message);
    if (text2 === undefined)
      continue;
    const match = GESTURE_PATTERN.exec(text2.trim());
    if (match !== null)
      return { message, text: text2, match };
  }
  return;
}
function rewriteMessageText(message, text2) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const at = content.findIndex((block) => block?.type === "text");
  if (at < 0)
    return message;
  return { ...message, content: content.map((block, index) => index === at ? { ...block, text: text2 } : block) };
}
var CONFIG_SERVICE = "mpdConfig";
var TEAMS_SERVICE = "mpdTeams";
var AUTOPROJECT_STAGING_TIMEOUT_MS = 5000;
function gateConfigValue(ctx, config, key) {
  try {
    const live = ctx.get?.(CONFIG_SERVICE, false);
    const value = live?.get?.(key);
    if (value !== undefined)
      return value;
  } catch {}
  if (key === GATE_CONFIG_KEY)
    return config.team?.gate;
  if (key === SENSITIVITY_CONFIG_KEY)
    return config.team?.sensitivity;
  if (key === BOULDER_DIR_CONFIG_KEY)
    return config.boulder?.dir;
  return;
}
function sessionIdOf(agent) {
  const handle = agent;
  const candidates = [handle?.session?.id, handle?.sessionId, handle?.id];
  for (const candidate of candidates)
    if (typeof candidate === "string" && candidate !== "")
      return candidate;
  return "";
}
function planIdOf(value) {
  const direct = value?.planId;
  if (typeof direct === "string" && direct !== "")
    return direct;
  const plan = value?.plan;
  return typeof plan?.planId === "string" ? plan.planId : "";
}
function errorText(error) {
  const message = error?.message;
  return message === undefined ? String(error) : String(message);
}
function autoprojectWorkspace(dsh, agent) {
  try {
    return typeof dsh.workspaceRoot === "function" ? dsh.workspaceRoot({ agent }) : "";
  } catch {
    return "";
  }
}
function stagedPlanOf(ctx, workspace, sessionId) {
  try {
    const teams = ctx.get?.(TEAMS_SERVICE, false);
    return teams?.planFor?.(workspace, sessionId)?.plan;
  } catch {
    return;
  }
}
function hasStagingTool(dsh, agent) {
  if (typeof dsh.hasTool !== "function")
    return false;
  try {
    return agent === undefined || agent === null ? dsh.hasTool(STAGING_TOOL_NAME) === true : dsh.hasTool(STAGING_TOOL_NAME, agent) === true;
  } catch {
    return false;
  }
}
async function stageAutoprojectPlan(dsh, ctx, input) {
  const existing = stagedPlanOf(ctx, input.workspace, input.sessionId);
  if (existing !== undefined && existing !== null)
    return { staged: true, planId: planIdOf(existing), alreadyStaged: true };
  if (!hasStagingTool(dsh, input.agent))
    return { staged: false, planId: "", alreadyStaged: false, error: "tool " + STAGING_TOOL_NAME + " is not registered" };
  try {
    const shell = gatePlanShell({
      signals: input.signals,
      goal: input.objective,
      ...input.planPath === undefined ? {} : { planPath: input.planPath }
    });
    const result = await dsh.executeTool({
      name: STAGING_TOOL_NAME,
      arguments: { action: "create", name: shell.name, description: shell.description, approval: "automatic" },
      agent: input.agent,
      timeoutMs: AUTOPROJECT_STAGING_TIMEOUT_MS
    });
    if (result?.ok !== true || result.isError === true) {
      return { staged: false, planId: "", alreadyStaged: false, error: result?.error === undefined ? "the staging call did not report ok" : String(result.error) };
    }
    return { staged: true, planId: planIdOf(result.value), alreadyStaged: false };
  } catch (error) {
    return { staged: false, planId: "", alreadyStaged: false, error: errorText(error) };
  }
}
async function evaluateAutoprojectGate(dsh, ctx, config, input) {
  const consumed = consumeExplicitFlag(input.objective);
  const objective = consumed.text.trim();
  const mode = resolveGateMode(gateConfigValue(ctx, config, GATE_CONFIG_KEY));
  if (mode === GATE_MODE_OFF) {
    return { objective, report: { mode, trigger: false, signals: [], explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false } };
  }
  try {
    const workspace = autoprojectWorkspace(dsh, input.agent);
    const boulderDir = gateConfigValue(ctx, config, BOULDER_DIR_CONFIG_KEY);
    const sensitivity = resolveSensitivity(gateConfigValue(ctx, config, SENSITIVITY_CONFIG_KEY));
    const boulder = await readBoulderGate(workspace, typeof boulderDir === "string" && boulderDir !== "" ? { boulderDir } : {});
    const workspaceScale = SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale ? await readWorkspaceScale(workspace) : false;
    const verdict = evaluateComplexityGate(objective, { explicitFlag: consumed.flagged, activeBoulder: boulder.active, sensitivity, workspaceScale });
    const base = { mode, trigger: verdict.trigger === true, signals: verdict.signals, explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false };
    if (verdict.trigger !== true || mode !== GATE_MODE_MECHANICAL)
      return { objective, report: base };
    if (input.agent === undefined || input.agent === null) {
      dsh.rowLog?.("mpd-autoproject", "team gate: the predicate fired (" + verdict.signals.join("/") + ") but this step carries no live agent to stage for");
      return { objective, report: { ...base, error: "the step carries no live agent to stage the plan for" } };
    }
    const outcome = await stageAutoprojectPlan(dsh, ctx, {
      agent: input.agent,
      workspace,
      sessionId: sessionIdOf(input.agent),
      objective,
      signals: verdict.signals,
      ...boulder.planPath === undefined ? {} : { planPath: boulder.planPath }
    });
    if (!outcome.staged)
      dsh.rowLog?.("mpd-autoproject", 'team gate: staging degraded for "' + objective.slice(0, 60) + '" (' + String(outcome.error) + ") — the directive reports it");
    else
      dsh.rowLog?.("mpd-autoproject", "team gate: plan staged signals=" + verdict.signals.join("/") + " plan=" + (outcome.planId === "" ? "(id not reported)" : outcome.planId));
    return { objective, report: { ...base, staged: outcome.staged, planId: outcome.planId, alreadyStaged: outcome.alreadyStaged, ...outcome.error === undefined ? {} : { error: outcome.error } } };
  } catch (error) {
    dsh.rowLog?.("mpd-autoproject", "team gate failed (" + errorText(error) + ") — the directive reports an unevaluated gate");
    return { objective, report: { mode, trigger: false, signals: [], explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false, error: errorText(error) } };
  }
}
function gateTrailerText(report) {
  const matched = report.signals.length === 0 ? "complexity signals" : "complexity signals " + report.signals.join("/");
  const id = report.planId === "" ? "(plan id not reported by the call)" : report.planId;
  const extend = "`" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`) and `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[1] + '"}`';
  const approve = "approve it YOURSELF with `" + STAGING_TOOL_NAME + ' {action:"approve"}` ONLY when the write scope is inside the declared scope AND the gate verdict is mechanical; otherwise ask ONE `ask_user_question`';
  const create = "stage the plan with `" + STAGING_TOOL_NAME + ' {action:"create"}`, extend it with ' + extend + ", then " + approve;
  if (report.mode === GATE_MODE_OFF) {
    return "TEAM GATE: OFF (" + GATE_CONFIG_KEY + "=off) — the predicate was not evaluated and " + NO_TEAM_STAGED_PHRASE + ".";
  }
  if (report.staged && report.alreadyStaged) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", and " + ALREADY_STAGED_PLAN_PHRASE + ": " + id + " (0 members, 0 tasks: a SHELL, not a team)." + `
- The gate did NOT stage again: a second staging would ARCHIVE the in-progress plan.` + `
- Extend it with ` + extend + ", then " + approve + "; approval is what spawns the members and posts the tasks." + `
- ` + INERT_PLAN_PHRASE + " — never tell the user a team was created.";
  }
  if (report.staged) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", and " + STAGED_PLAN_PHRASE + ": " + id + " (0 members, 0 tasks: a SHELL, not a team)." + `
- Extend it with ` + extend + ", then " + approve + "; approval is what spawns the members and posts the tasks." + `
- ` + INERT_PLAN_PHRASE + " — never tell the user a team was created.";
  }
  if (report.trigger && report.mode === GATE_MODE_MECHANICAL) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", so the gate FIRED, but staging did NOT happen (" + String(report.error ?? "unknown reason") + "): " + NO_TEAM_STAGED_PHRASE + " and no plan exists for this run." + `
- Continue the run; if the work warrants a team, ` + create + ".";
  }
  if (report.trigger) {
    return "TEAM GATE: ADVISORY (" + GATE_CONFIG_KEY + "=advisory) — this objective shows " + matched + ", and " + NO_TEAM_STAGED_PHRASE + ": the gate is ADVISORY and stages nothing." + `
- Continue solo; if the work genuinely warrants a team, ` + create + ".";
  }
  if (report.error !== undefined) {
    return "TEAM GATE: UNEVALUATED — the gate could not run (" + report.error + "), so " + NO_TEAM_STAGED_PHRASE + "; do not assume one and do not invent a second predicate.";
  }
  if (report.mode === GATE_MODE_MECHANICAL) {
    return "TEAM GATE: MECHANICAL — no complexity signal fired for this objective, and " + NO_TEAM_STAGED_PHRASE + ". Do not invent a second predicate.";
  }
  return "TEAM GATE: ADVISORY (" + GATE_CONFIG_KEY + "=advisory) — no complexity signal fired for this objective, and " + NO_TEAM_STAGED_PHRASE + ".";
}
function apply(ctx, config = {}) {
  const dsh = resolveDshAdapter(ctx);
  const cfg = mergedConfig2(ctx, config);
  applyBoulder(ctx, {});
  dsh.registerTool({
    name: "mpd_autoproject",
    description: "Run the autoproject discipline — an automated MPD session, not a parallel engine: optional adversarial hyperplan wave (Architect angles), plan gate (Planner + Plan Reviewer), execution rounds (ONE roster consult per round: Deep Worker on a heavy tier, Senior Engineer on a planned light one, Junior Engineer otherwise; per-criterion PIN->RED->GREEN->SURFACE->CLEAN; discovery stops after 2 fruitless waves), verification through the mpd_verify_* plane (a RECORDED PASS is required to report complete), the final three-lane quality gate, and the boulder ledger for plan runs. Over-limit escalation is the ONE independent decision. State + ledger under .mpd/autoproject/<id>.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        tier: { type: "string", enum: ["light", "heavy"] },
        plan: { type: "boolean", description: "Force a plan file even in light tier" },
        hyperplan: { type: "boolean", description: "Run the 5-category adversarial review wave before planning" },
        strictReview: { type: "boolean", description: "Accepted for compatibility; verification is always required to report complete" },
        maxRounds: { type: "integer", description: "1..8, default 6" },
        scope: { type: "array", items: { type: "string" }, description: "The caller's DECLARED write scope (workspace-relative paths). When present it drives the escalation scope signal, the verify loop's authorising scope and the cellwork hand-off; when absent the engine falls back to the paths its children evidenced, and escalation.json records which (scopeSource: declared | evidence)" }
      },
      required: ["objective"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string", description: "Present only when a plan file was written (plan=true or tier=heavy); absent otherwise" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
      render: (_a, v) => textBlock("autoproject status=" + v.status + " rounds=" + v.rounds + " verdict=" + (v.verdict ?? "-") + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile)
    },
    execute: async (args, exec) => runAutoproject(args, exec, { dsh, ctx, config: cfg })
  });
  const AUTOPROJECT_USAGE = "usage: /autoproject <objective> — starts an autoproject run for that objective";
  const AUTOPROJECT_COMMAND_DESCRIPTION = "Run the autoproject discipline for an objective — autonomously, except at its three decision points";
  const runAutoprojectCommand = async (invocation) => {
    const objective = String(invocation?.rawInput ?? "").trim();
    if (objective === "")
      return { kind: "error", text: AUTOPROJECT_USAGE };
    const gate = await evaluateAutoprojectGate(dsh, ctx, config, { objective, agent: invocation?.agent });
    const submitted = invocation.submit?.(dsh.userMessage({ text: activationDirective(gate.objective, gate.report), source: { kind: "mpd-autoproject", reason: "activation-directive" } })) === true;
    if (!submitted)
      return { kind: "error", text: "autoproject could not start: no live agent turn surface to submit the activation directive for " + JSON.stringify(gate.objective) };
    return { kind: "success", text: "autoproject activated: " + gate.objective };
  };
  const commandDisposers = ["autoproject"].map((name2) => dsh.registerCommand({ name: name2, description: AUTOPROJECT_COMMAND_DESCRIPTION, input: { hint: "objective" }, handler: runAutoprojectCommand }));
  const gestureDispose = dsh.onEvent("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined;
    try {
      if (decision === undefined || decision === null || decision.kind === "reject")
        return decision;
      const messages = Array.isArray(decision.messages) ? decision.messages : Array.isArray(payload?.messages) ? payload.messages : undefined;
      if (messages === undefined)
        return decision;
      const claimed = claimGesture(messages);
      if (claimed === undefined)
        return decision;
      const objective = claimed.text.trim().slice(claimed.match[0].length).trim();
      if (objective === "")
        return decision;
      const gate = await evaluateAutoprojectGate(dsh, ctx, config, { objective, agent: payload?.agent ?? decision?.agent });
      return { ...decision, messages: messages.map((message) => message === claimed.message ? rewriteMessageText(message, activationDirective(gate.objective, gate.report)) : message) };
    } catch {
      return decision;
    }
  });
  const disposers = [...commandDisposers, ...gestureDispose === undefined ? [] : [gestureDispose]];
  if (typeof ctx.effect === "function")
    ctx.effect(() => () => {
      for (const dispose of disposers)
        dispose();
    }, "mpd-autoproject.commands");
}
export {
  AUTOPROJECT_ACTIVATION_DIRECTIVE,
  activationDirective,
  apply,
  gateTrailerText,
  inject,
  name
};
