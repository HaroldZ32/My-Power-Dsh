// packages/mpd-roles-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { join as join4, resolve as resolve3 } from "node:path";

// packages/mpd-roles-plugin/src/roles.data.ts
var ROLES = [
  {
    id: "oracle",
    name: "Architect",
    description: "Strategic technical advisor: architecture review, deep debugging, self-review.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/oracle.md"
  },
  {
    id: "librarian",
    name: "Researcher",
    description: "Evidence-based code/open-source search (AST/LSP/web evidence collection).",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/librarian.md"
  },
  {
    id: "prometheus",
    name: "Planner",
    description: "Planning advisor: produces .mpd/plans plans only, never implements.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/prometheus.md"
  },
  {
    id: "hephaestus",
    name: "Deep Worker",
    description: "Autonomous deep worker: executes goals end-to-end with tools, verifies every change.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/hephaestus.md"
  },
  {
    id: "sisyphus",
    name: "Senior Engineer",
    description: "Primary engineering agent: plan small, execute with tools, verify, report honestly.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus.md"
  },
  {
    id: "atlas",
    name: "Lead",
    description: "Orchestrator: macro planning, delegate roles, integrate results.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/atlas.md"
  },
  {
    id: "explore",
    name: "Explorer",
    description: "Read-only codebase explorer: finds files and code, returns evidence, never edits.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/explore.md"
  },
  {
    id: "metis",
    name: "Reviewer",
    description: "Deep reviewer: correctness and risk findings with evidence, no fixes.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/metis.md"
  },
  {
    id: "momus",
    name: "Plan Reviewer",
    description: "Work-plan QA reviewer: verifies the plan is executable and its references valid, rejects only true blockers.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-pro" }
    ],
    personaFile: "personas/momus.md"
  },
  {
    id: "multimodal-looker",
    name: "Vision Analyst",
    description: "Image/diagram analyst: read screenshots/diagrams and describe precisely.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash-vision-exp" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/multimodal-looker.md"
  },
  {
    id: "sisyphus-junior",
    name: "Junior Engineer",
    description: "Fast executor: small, well-scoped mechanical changes with quick verification.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus-junior.md"
  }
];
var ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));

// packages/mpd-roles-plugin/src/team-guard.ts
function normalizeTeamMemberKey(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function readonlyMemberKeys(members) {
  const keys = new Map;
  for (const member of members) {
    if (member?.readonly !== true)
      continue;
    const key = normalizeTeamMemberKey(member.name);
    if (key !== "")
      keys.set(key, member.name);
  }
  return keys;
}
function readonlyMemberForTeamName(name, readonlyKeys) {
  const key = normalizeTeamMemberKey(name);
  if (key === "")
    return;
  const exact = readonlyKeys.get(key);
  if (exact !== undefined)
    return exact;
  const withoutSuffix = key.replace(/-\d+$/, "");
  if (withoutSuffix === key || withoutSuffix === "")
    return;
  return readonlyKeys.get(withoutSuffix);
}
function readonlyGuardDecision(exec, options) {
  try {
    const toolName = String(exec?.name ?? "");
    if (!options.deny.has(toolName))
      return;
    const membership = options.membershipOf(exec?.agent);
    if (membership === undefined || membership === null || membership.role !== "teammate")
      return;
    const member = readonlyMemberForTeamName(String(membership.name ?? ""), options.readonlyKeys);
    if (member === undefined)
      return;
    return 'roster read-only discipline: teammate "' + String(membership.name) + '" is the READ-ONLY roster member ' + member + ", so `" + toolName + "` is denied. Read-only members never modify the tree: return the finding, " + "or ask the Lead (or a worker member — Deep Worker, Senior Engineer, Junior Engineer, Reviewer) to make the change.";
  } catch {
    return;
  }
}
function installReadonlyGuard(dsh, options) {
  const readonlyKeys = readonlyMemberKeys(options.members);
  if (readonlyKeys.size === 0) {
    options.warn("no read-only roster member is declared — the team-path read-only guard is NOT installed");
    return { installed: false, reason: "no-readonly-members" };
  }
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the team-path read-only guard is NOT installed " + "(read-only teammates would keep write access; the `mpd_role_spawn` path is unaffected)");
      return { installed: false, reason: "no-guard-seam" };
    }
    const deny = new Set(options.deny);
    const dispose = dsh.guardTool((exec) => readonlyGuardDecision(exec, {
      deny,
      readonlyKeys,
      membershipOf: (agent) => dsh.teamMembership(agent)
    }));
    return { installed: true, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("installing the team-path read-only guard failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, reason: "install-failed" };
  }
}

// packages/mpd-verify-plugin/src/law.ts
var PATH_ARG_KEYS = ["file_path", "path", "filePath", "target"];
function readTargetPath(toolName, args) {
  if (toolName === "mcp__ast_grep__rewrite") {
    const paths = args?.paths;
    if (Array.isArray(paths) && typeof paths[0] === "string")
      return paths[0];
  }
  for (const key of PATH_ARG_KEYS) {
    const value = args?.[key];
    if (typeof value === "string" && value !== "")
      return value;
  }
  return;
}

// packages/mpd-roles-plugin/src/complexity-gate.ts
import { randomUUID } from "node:crypto";
import { mkdir as mkdirFs, readFile as readFileFs, readdir as readDirFs, rename as renameFs, unlink as unlinkFs, writeFile as writeFileFs } from "node:fs/promises";
import { join } from "node:path";

// packages/mpd-roles-plugin/src/admission.ts
var AUTOMATION_GESTURE_PATTERN = /\b(?:autoproject|auto-project|orchestrate|orchestration)\b|自动化|编排/iu;
function admissionOf(source, text, evidence = {}) {
  const body = typeof text === "string" ? text : "";
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
var STARTUP_NOTICE_MARKER = "[AgentTeams] Session-start team rule";
var HUMAN_SOURCE_KIND = "user";
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
var BOARD_TOOL_NAME = "agent_teams_task";
var DISPATCH_TOOL_NAME = "agent_teams_dispatch";
var STAGED_PLAN_PHRASE = "a team PLAN was STAGED";
var ALREADY_STAGED_PLAN_PHRASE = "a team PLAN is ALREADY STAGED";
var INERT_PLAN_PHRASE = "NOTHING has been spawned; the plan is INERT until approved";
var MISSING_PLAN_ID_PHRASE = "STAGING FAILED TO RETURN A PLAN ID";
var NO_TEAM_STAGED_PHRASE = "NO team was staged";
var SOLO_PERMISSION_SENTENCE = "- If the work does not warrant a team (a short or single-threaded task), continue solo";
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
var DEFAULT_GATE_PRESETS = ["mpd"];
function distinctMatches(text, pattern) {
  const seen = new Set;
  for (const match of text.matchAll(pattern))
    seen.add(match[0].toLowerCase());
  return seen.size;
}
function enumeratedLineCount(text) {
  let count = 0;
  for (const line of text.split(`
`))
    if (ENUMERATED_LINE_PATTERN.test(line))
      count += 1;
  return count;
}
function clauseStepCount(text, pattern) {
  let count = 0;
  for (const clause of text.split(CLAUSE_SEPARATOR_PATTERN))
    if (pattern.test(clause))
      count += 1;
  return count;
}
function cjkCharCount(text) {
  const matches = text.match(CJK_CHAR_PATTERN);
  return matches === null ? 0 : matches.length;
}
function consumeExplicitFlag(text) {
  const source = String(text ?? "");
  const trimmed = source.trimStart();
  const prefix = /^team:\s*/iu.exec(trimmed);
  if (prefix !== null)
    return { flagged: true, text: trimmed.slice(prefix[0].length) };
  const marker = /(^|\s)!team\b/iu.exec(source);
  if (marker !== null)
    return { flagged: true, text: source.replace(/(^|\s)!team\b\s*/iu, "$1") };
  return { flagged: false, text: source };
}
function evaluateComplexityGate(text, input = {}) {
  const source = String(text ?? "");
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
    const raw = await read(join(root, ".mpd", "boulder.json"));
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
var TEAM_RECORDS_DIR = join(".mpd", "team", "teams");
var CLEAN_TASK_STATUSES = ["completed", "cancelled"];
var FAILED_TASK_STATUS = "failed";
function readTeamBoard(tasks) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const hasTasks = rows.length > 0;
  let allTerminal = hasTasks;
  let failedTaskId;
  for (const row of rows) {
    const task = row;
    const status = String(task?.status ?? "");
    if (status === FAILED_TASK_STATUS) {
      if (failedTaskId === undefined)
        failedTaskId = String(task?.id ?? task?.taskId ?? "");
      allTerminal = false;
      continue;
    }
    if (!CLEAN_TASK_STATUSES.includes(status))
      allTerminal = false;
  }
  return {
    cleanTerminal: hasTasks && allTerminal && failedTaskId === undefined,
    ...failedTaskId === undefined ? {} : { failedTaskId }
  };
}
function isStamped(value) {
  return value !== undefined && value !== null && String(value) !== "";
}
async function readLeadingTeam(workspace, sessionId, opts = {}) {
  const nothing = { leading: false, members: 0 };
  if (typeof sessionId !== "string" || sessionId === "")
    return nothing;
  try {
    const read = opts.readFile ?? ((path) => readFileFs(path, "utf8"));
    const list = opts.readDir ?? ((path) => readDirFs(path, { encoding: "utf8", withFileTypes: false }));
    const entries = await list(join(String(workspace ?? ""), TEAM_RECORDS_DIR));
    let live;
    let liveFailure;
    let terminal;
    const terminalTeamIds = [];
    const terminalEndedAt = [];
    const autoEndTeamIds = [];
    for (const entry of entries) {
      if (!String(entry).endsWith(".json"))
        continue;
      try {
        const record = JSON.parse(await read(join(String(workspace ?? ""), TEAM_RECORDS_DIR, String(entry))));
        if (record === null || typeof record !== "object" || Array.isArray(record))
          continue;
        const fields = record;
        if (String(fields.leadSessionId ?? "") !== String(sessionId))
          continue;
        const members = Array.isArray(fields.members) ? fields.members.length : 0;
        if (members === 0)
          continue;
        const teamId = String(fields.teamId ?? "");
        const ended = isStamped(fields.endedAt);
        const board = readTeamBoard(fields.tasks);
        if (ended || board.cleanTerminal) {
          terminal = { teamId, members, ended };
          terminalTeamIds.push(teamId);
          const endedAtMs = typeof fields.endedAt === "string" ? Date.parse(fields.endedAt) : Number.NaN;
          terminalEndedAt.push(endedAtMs);
          if (!ended && board.cleanTerminal)
            autoEndTeamIds.push(teamId);
          continue;
        }
        if (live === undefined)
          live = { teamId, members };
        if (liveFailure === undefined && board.failedTaskId !== undefined)
          liveFailure = { teamId, taskId: board.failedTaskId };
      } catch {}
    }
    if (live !== undefined) {
      return {
        leading: true,
        teamId: live.teamId,
        members: live.members,
        ...liveFailure === undefined ? {} : { failedTaskId: liveFailure.taskId, failedTeamId: liveFailure.teamId }
      };
    }
    if (terminal === undefined)
      return nothing;
    return {
      leading: false,
      teamId: terminal.teamId,
      members: terminal.members,
      ...terminal.ended ? { ended: true } : { cleanTerminal: true },
      terminalTeamIds,
      terminalEndedAt,
      ...autoEndTeamIds.length === 0 ? {} : { autoEndTeamIds }
    };
  } catch {
    return nothing;
  }
}
var CONTROL_TOOL_NAME = "agent_teams_control";
var RETEAM_AUTO_END_REASON = "board clean-terminal — auto-ended by re-team gate";
var RETEAM_NOTICE_MARKER = "[AgentTeams] Re-team rule";
var RETEAM_ENABLED_CONFIG_KEY = "team.reteam.enabled";
var RETEAM_AFTER_CONSULTS_CONFIG_KEY = "team.reteam.afterConsults";
var RETEAM_DEFAULT_AFTER_CONSULTS = 4;
var RETEAM_PLAN_NAME = "re-team gate plan shell";
function resolveReTeamEnabled(value) {
  if (value === false || value === 0)
    return false;
  if (typeof value === "string") {
    const spelling = value.trim().toLowerCase();
    return spelling !== "false" && spelling !== "off" && spelling !== "no";
  }
  return true;
}
function resolveReTeamAfterConsults(value) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 1 ? Math.floor(numeric) : RETEAM_DEFAULT_AFTER_CONSULTS;
}
var SESSION_GATE_STATE_DIR = join(".mpd", "session-gate");
var CONSULT_TOOL_PREFIX = "mpd_role_spawn";
var WORKMATE_SPAWN_TOOL_NAME = "mpd_workmate_spawn";
function isConsultToolName(name) {
  if (typeof name !== "string" || name === "")
    return false;
  return name === WORKMATE_SPAWN_TOOL_NAME || name.startsWith(CONSULT_TOOL_PREFIX);
}
function emptyReTeamState() {
  return { consultCount: 0, lastFiredAt: 0, planId: "", teamIdAtFire: "" };
}
function sessionStateFileName(sessionId) {
  const safe = String(sessionId ?? "").replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 120);
  return (safe === "" ? "session" : safe) + ".json";
}
function sessionGateStatePath(workspace, sessionId) {
  return join(String(workspace ?? ""), SESSION_GATE_STATE_DIR, sessionStateFileName(sessionId));
}
function parseReTeamState(raw) {
  try {
    const value = JSON.parse(String(raw ?? ""));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return;
    const fields = value;
    const state = emptyReTeamState();
    if (typeof fields.consultCount === "number" && Number.isFinite(fields.consultCount) && fields.consultCount > 0) {
      state.consultCount = Math.floor(fields.consultCount);
    }
    if (typeof fields.lastFiredAt === "number" && Number.isFinite(fields.lastFiredAt) && fields.lastFiredAt > 0) {
      state.lastFiredAt = Math.floor(fields.lastFiredAt);
    }
    if (typeof fields.planId === "string")
      state.planId = fields.planId;
    if (typeof fields.teamIdAtFire === "string")
      state.teamIdAtFire = fields.teamIdAtFire;
    return state;
  } catch {
    return;
  }
}
async function readReTeamState(workspace, sessionId, opts = {}) {
  try {
    const read = opts.readFile ?? ((path) => readFileFs(path, "utf8"));
    return parseReTeamState(await read(sessionGateStatePath(workspace, sessionId)));
  } catch {
    return;
  }
}
async function writeReTeamState(workspace, sessionId, state, opts = {}) {
  try {
    const root = String(workspace ?? "");
    const write = opts.writeFile ?? (async (path, content) => {
      const dir = join(root, SESSION_GATE_STATE_DIR);
      await mkdirFs(dir, { recursive: true });
      const temp = path + "." + randomUUID() + ".tmp";
      try {
        await writeFileFs(temp, content, "utf8");
        await renameFs(temp, path);
      } catch (error) {
        await unlinkFs(temp).catch(() => {
          return;
        });
        throw error;
      }
    });
    await write(sessionGateStatePath(workspace, sessionId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
function reTeamNoticeText(input) {
  const trigger = String(input.count) + " COMPLETED consult calls (`" + CONSULT_TOOL_PREFIX + "*` / `" + WORKMATE_SPAWN_TOOL_NAME + "`)" + " since the last team fire (threshold `" + RETEAM_AFTER_CONSULTS_CONFIG_KEY + "` = " + String(input.threshold) + ")" + ", with NO live team in this session — the re-team trigger fired.";
  const plan = input.staged ? `
- ` + STAGED_PLAN_PHRASE + " as " + (input.planId === "" ? MISSING_PLAN_ID_PHRASE + " — the shell CANNOT be approved, so report this failure" : input.planId) + ". " + INERT_PLAN_PHRASE + "." : input.alreadyStaged ? `
- ` + ALREADY_STAGED_PLAN_PHRASE + " as " + (input.planId === "" ? MISSING_PLAN_ID_PHRASE : input.planId) + " — this fire did NOT stage a second shell (a second stage would ARCHIVE the in-progress plan). " + INERT_PLAN_PHRASE + "." : `
- ` + NO_TEAM_STAGED_PHRASE + (input.error === undefined || input.error === "" ? "" : " (" + input.error + ")") + ".";
  const next = input.staged || input.alreadyStaged ? "\n- Extend it with `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)" + " and `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[1] + '"} (each task carrying its dependency answer: `blocked_by` or `independent: true`),' + " then approve it with `" + STAGING_TOOL_NAME + ' {action:"approve"}` — approval is what spawns the members.' : "\n- Stage a team yourself when the work warrants one: `" + STAGING_TOOL_NAME + '` {action:"' + PLAN_EXTEND_ACTIONS[0] + '"}' + ' → {action:"' + PLAN_EXTEND_ACTIONS[1] + '"} → {action:"approve"}; or continue solo and say so in one line.';
  return RETEAM_NOTICE_MARKER + ": " + trigger + plan + next + "\n- Set `" + RETEAM_ENABLED_CONFIG_KEY + ": false` to turn THIS trigger off; the ended-aware leading check and the clean-terminal auto-end stay in force.";
}
function reTeamRepairNoticeText(teamId, taskId) {
  const named = teamId === "" ? "(team id not read)" : teamId;
  return RETEAM_NOTICE_MARKER + ": team " + named + " has an unrepaired failed task; create a kind=repair task" + (taskId === undefined || taskId === "" ? "" : " — the failed row is `" + taskId + "`") + ". A wave whose verification failed is NEVER auto-ended and no new shell is staged until it is repaired.";
}
function resolveGateMode(value) {
  if (value === GATE_MODE_ADVISORY)
    return GATE_MODE_ADVISORY;
  if (value === GATE_MODE_OFF || value === false)
    return GATE_MODE_OFF;
  return GATE_MODE_MECHANICAL;
}
function collapseWhitespace(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
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
function ADMISSION_CLAUSE_OF(strength) {
  return strength === undefined ? "" : " (admission " + strength + ")";
}
function advisoryNoticeText(signals, explicit, strength) {
  const matched = signals.length === 0 ? "complexity signals" : "complexity signals " + signals.join("/");
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ADMISSION_CLAUSE_OF(strength) + ", and " + NO_TEAM_STAGED_PHRASE + " — the gate is ADVISORY " + "and stages nothing while complexity is merely being judged." + (explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is a reason to stage, not a staged team." : "") + "\n- Stage a team yourself when the work warrants one: `" + STAGING_TOOL_NAME + '` {action:"' + PLAN_EXTEND_ACTIONS[0] + '"} → {action:"' + PLAN_EXTEND_ACTIONS[1] + '"} (each task carrying its dependency answer: `blocked_by` or `independent: true`)' + ' → {action:"approve"}; drive the team with `' + BOARD_TOOL_NAME + "` and `" + DISPATCH_TOOL_NAME + "`." + `
` + SOLO_PERMISSION_SENTENCE + " — and say so in one line." + `
- A team is NOT a precondition of this session, and you may not create a second team while leading one.`;
}
function mechanicalNoticeText(input) {
  const matched = input.signals.length === 0 ? "complexity signals" : "complexity signals " + input.signals.join("/");
  const missingId = input.planId === "";
  const id = !missingId ? input.planId : MISSING_PLAN_ID_PHRASE + (input.alreadyStaged ? " — the returned shell's id could not be read, so it CANNOT be approved; report this failure" : " — the shell was staged but CANNOT be approved, so report this failure");
  const nextStep = !missingId ? "\n- Extend it with `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)" + " and `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[1] + '"} (each task carrying its dependency answer: `blocked_by` or `independent: true`), then approve it with `' + STAGING_TOOL_NAME + ' {action:"approve"}` — approval is what spawns the members and posts the tasks.' : input.alreadyStaged ? `
- Do NOT attempt to extend or approve it, and do NOT stage again: the returned shell's id could not be read, so report this failure instead.` : `
- Do NOT attempt to extend or approve it: the staging call returned no id, so report this failure and re-stage before continuing.`;
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ADMISSION_CLAUSE_OF(input.strength) + ", and " + (input.alreadyStaged ? ALREADY_STAGED_PLAN_PHRASE : STAGED_PLAN_PHRASE) + " — " + id + " (0 members, 0 tasks: a SHELL, not a team)." + (input.alreadyStaged ? `
- The gate did NOT stage again: a second staging would ARCHIVE your in-progress plan.` : "") + (input.explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is why this is your session to lead." : "") + nextStep + `
- ` + INERT_PLAN_PHRASE + " — never tell the user a team was created." + `
` + SOLO_PERMISSION_SENTENCE + " — and say so in one line: an unapproved plan is inert." + `
- A team is NOT a precondition of this session, and you may not create a second team while leading one.`;
}
function messageText(message) {
  const content = message?.content;
  if (!Array.isArray(content))
    return;
  const parts = content.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text);
  return parts.length === 0 ? undefined : parts.join(`
`);
}
function latestUserMessage(candidates) {
  for (let index = candidates.length - 1;index >= 0; index -= 1) {
    const message = candidates[index];
    if (message?.role !== "user")
      continue;
    const text = messageText(message);
    if (text === undefined)
      continue;
    const source = message?.source;
    const kind = source === undefined || source === null ? undefined : source.kind;
    if (kind !== undefined && String(kind) !== HUMAN_SOURCE_KIND)
      continue;
    return { message, text };
  }
  return;
}
function consumeFlagFromMessage(message, source) {
  if (!consumeExplicitFlag(source).flagged)
    return message;
  let changed = false;
  const content = (message?.content ?? []).map((block) => {
    const text = block?.text;
    if (block?.type !== "text" || typeof text !== "string")
      return block;
    const next = consumeExplicitFlag(text);
    if (next.text === text)
      return block;
    changed = true;
    return { ...block, text: next.text };
  });
  return changed ? { ...message, content } : message;
}
function sessionQualifies(agent, presets = DEFAULT_GATE_PRESETS) {
  if (sessionRank(agent) !== "captain")
    return false;
  const header = agent?.session?.header;
  if (header === undefined || header === null)
    return false;
  const preset = header.agentPreset;
  if (preset === undefined || preset === null)
    return true;
  return presets.includes(String(preset));
}
function sessionRank(agent) {
  const header = agent?.session?.header;
  if (header === undefined || header === null)
    return "headerless";
  if (header.origin === "subagent")
    return "child";
  const depth = Number(header.delegationDepth);
  return depth >= 1 ? "child" : "captain";
}
function sessionIsTopLevel(agent) {
  return sessionRank(agent) === "captain";
}
var MPD_CAPTAIN_PRESET = "mpd";
function sessionIsMpdCaptain(agent) {
  if (!sessionIsTopLevel(agent))
    return false;
  const header = agent?.session?.header;
  return header?.agentPreset === MPD_CAPTAIN_PRESET;
}

// packages/mpd-roles-plugin/src/captain-investigation.ts
var INVESTIGATION_CONFIG_KEY = "captain.investigation";
var INVESTIGATION_TOOLS = ["read", "glob", "grep"];
var CAPTAIN_READABLE_PREFIXES = [".mpd/", "docs/", "evidence/", "agent-references/"];
var CAPTAIN_INSTRUCTION_BASENAMES = ["AGENT.md", "AGENTS.md", "CLAUDE.md"];
var CAPTAIN_READABLE_ROOT_FILES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md"
];
var ROOT_LICENSE_PATTERN = /^LICENSE.*\.md$/i;
function resolveInvestigationMode(raw) {
  return raw === "allow" ? "allow" : "deny";
}
function captainReadablePath(workspaceRoot, raw) {
  const posix = String(raw ?? "").replace(/\\/g, "/");
  if (posix === "")
    return false;
  if (isInstructionFile(posix))
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
  const inBand = CAPTAIN_READABLE_PREFIXES.some((prefix) => rel.startsWith(prefix) || rel === prefix.replace(/\/$/, ""));
  if (inBand)
    return true;
  if (CAPTAIN_READABLE_ROOT_FILES.includes(rel))
    return true;
  return rel.indexOf("/") === -1 && ROOT_LICENSE_PATTERN.test(rel);
}
function isInstructionFile(path) {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "")
    return false;
  return CAPTAIN_INSTRUCTION_BASENAMES.some((name) => name.toLowerCase() === base);
}
function captainInvestigationDecision(input) {
  if (input.mode !== "deny")
    return;
  if (!input.topLevel)
    return;
  const toolName = String(input.toolName ?? "");
  if (!INVESTIGATION_TOOLS.includes(toolName))
    return;
  const raw = readTargetPath(toolName, input.args);
  if (raw === undefined)
    return investigationRefusal(toolName, "(no path argument — a bare call searches the whole workspace)");
  if (captainReadablePath(input.workspaceRoot, raw))
    return;
  return investigationRefusal(toolName, JSON.stringify(raw));
}
function investigationRefusal(toolName, target) {
  return "captain investigation rule: `" + toolName + "` on " + target + " is refused — the `mpd`" + " preset's TOP-LEVEL session does not run reconnaissance, so its context stays small enough for very large" + " projects. Delegate it: `mpd_role_spawn` with the `Explorer` role (find files and code) or the" + " `Researcher` role (evidence-based search), or hand the search to a team member, and consume the" + " REPORT. The documentation band stays open to you, and this is the whole of it: `AGENT.md`," + " `AGENTS.md` and `CLAUDE.md` at ANY depth — inside this workspace or outside its root, so a sibling" + " project's instruction file is readable; the trees `.mpd/**`, `docs/**`, `evidence/**` and" + " `agent-references/**`; and, at the workspace root only, `README.md`, `README.zh-CN.md`," + " `CHANGELOG.md` and `LICENSE*.md` — those two README spellings exactly, since there is no" + ' `README*` glob. Every source path stays refused, and `captain.investigation: "allow"` in' + " mpd.jsonc restores full access.";
}
function installCaptainInvestigationGuard(dsh, options) {
  const mode = resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY));
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the captain investigation guard is NOT installed " + "(the top-level session keeps read/grep/glob on source paths; the rule lives in the instruction text only)");
      return { installed: false, mode, reason: "no-guard-seam" };
    }
    let reportedInternalError = false;
    const dispose = dsh.guardTool((exec) => {
      try {
        return captainInvestigationDecision({
          toolName: String(exec?.name ?? ""),
          args: exec?.arguments,
          workspaceRoot: (() => {
            try {
              return options.workspaceRootOf(exec);
            } catch {
              return "";
            }
          })(),
          topLevel: sessionIsMpdCaptain(exec?.agent),
          mode: resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY))
        });
      } catch (error) {
        if (!reportedInternalError) {
          reportedInternalError = true;
          options.warn("the captain investigation guard hit an internal error and passed the call through (" + (error instanceof Error ? error.message : String(error)) + ")");
        }
        return;
      }
    });
    return { installed: true, mode, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("installing the captain investigation guard failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, mode, reason: "install-failed" };
  }
}

// packages/mpd-roles-plugin/src/ask-user-guard.ts
var ASK_USER_QUESTION_TOOL = "ask_user_question";
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function describeShape(value) {
  if (value === null)
    return "null";
  if (value === undefined)
    return "undefined";
  if (Array.isArray(value))
    return "an array";
  return typeof value === "object" ? "an object" : "a " + typeof value;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function askUserQuestionRefusal(defect) {
  return "ask_user_question is refused: " + defect + ". Re-issue the call with every question item carrying a" + " non-empty string `id`, the question text under `question`, and a non-empty `options` array whose" + " entries each carry a non-empty string `label`, in exactly the JSON structure the tool schema defines." + " Every question item must offer at least one option — a question without options is refused exactly" + " like an empty list. A structurally broken call would render as an empty card, so it is denied before" + " dispatch and never reaches the user.";
}
function askUserQuestionDenial(args) {
  try {
    if (!isPlainObject(args)) {
      return askUserQuestionRefusal("`arguments` must be a JSON object (received " + describeShape(args) + ")");
    }
    const call = args;
    const questions = call.questions;
    if (!Array.isArray(questions)) {
      return askUserQuestionRefusal("`questions` must be a non-empty array (received " + describeShape(questions) + ")");
    }
    if (questions.length === 0) {
      return askUserQuestionRefusal("`questions` must not be empty — a call carrying no question renders nothing");
    }
    for (let index = 0;index < questions.length; index += 1) {
      const item = questions[index];
      const at = "question item " + String(index + 1);
      if (!isPlainObject(item)) {
        return askUserQuestionRefusal(at + " must be an object carrying `id` and `question` (received " + describeShape(item) + ")");
      }
      if (!nonEmptyString(item.id)) {
        return askUserQuestionRefusal(at + " lacks a non-empty string `id` (received " + describeShape(item.id) + ")");
      }
      if (!nonEmptyString(item.question)) {
        return askUserQuestionRefusal(at + " lacks a non-empty string `question` (received " + describeShape(item.question) + ")");
      }
      const options = item.options;
      if (options === undefined) {
        return askUserQuestionRefusal(at + " carries no `options` array — every question item must offer at least one option");
      }
      if (!Array.isArray(options)) {
        return askUserQuestionRefusal(at + " carries `options` that is not an array (received " + describeShape(options) + ")");
      }
      if (options.length === 0) {
        return askUserQuestionRefusal(at + " carries an empty `options` array — a choice needs at least one option");
      }
      for (let optionIndex = 0;optionIndex < options.length; optionIndex += 1) {
        const option = options[optionIndex];
        if (!isPlainObject(option) || !nonEmptyString(option.label)) {
          return askUserQuestionRefusal(at + " option " + String(optionIndex + 1) + " lacks a non-empty string `label`");
        }
      }
    }
    return;
  } catch {
    return;
  }
}
function askUserQuestionGuardDecision(exec) {
  try {
    if (String(exec?.name ?? "") !== ASK_USER_QUESTION_TOOL)
      return;
    return askUserQuestionDenial(exec?.arguments);
  } catch {
    return;
  }
}
function installAskUserQuestionGuard(dsh, options) {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the ask_user_question boundary guard is NOT installed " + "(a structurally broken question call would reach the user's panel unchanged; the construction rule in the " + "preset prompt is then the only protection)");
      return { installed: false, reason: "no-guard-seam" };
    }
    const dispose = dsh.guardTool((exec) => askUserQuestionGuardDecision(exec));
    return { installed: true, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("installing the ask_user_question boundary guard failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, reason: "install-failed" };
  }
}

// packages/mpd-roles-plugin/src/question-relay.ts
var DEFAULT_QUESTION_TTL_MS = 120000;
var DEFAULT_ATTACH_WINDOW_MS = 15000;
var DEFAULT_QUESTION_CAPACITY = 16;
var QUESTIONS_PATH = "/plugins/mpd-roles/questions";
var ANSWER_PATH = "/plugins/mpd-roles/questions/answer";
var QUESTION_ROUTES = [QUESTIONS_PATH, ANSWER_PATH];
var MAX_BODY_BYTES = 64 * 1024;
var encoder = new TextEncoder;
var decoder = new TextDecoder;
function messageOf(error) {
  if (error instanceof Error)
    return error.message;
  if (typeof error === "string")
    return error;
  if (error !== null && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string")
      return message;
  }
  return String(error);
}
function noProviderOf(error) {
  const code = error !== null && typeof error === "object" ? error.code : undefined;
  if (typeof code === "string")
    return code === "NO_PROVIDER";
  return /no user-questions answerer/i.test(messageOf(error));
}
function abortErrorOf(signal) {
  return signal.reason === undefined ? new Error("mpd-roles: the user-question request was aborted") : signal.reason;
}
function amountOf(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function copyQuestions(questions) {
  return questions.map((item) => {
    const copy = { id: item.id, question: item.question };
    if (item.header !== undefined)
      copy.header = item.header;
    if (item.multiSelect !== undefined)
      copy.multiSelect = item.multiSelect;
    if (item.options !== undefined) {
      copy.options = item.options.map((option) => option.description === undefined ? { label: option.label } : { label: option.label, description: option.description });
    }
    return copy;
  });
}
function copyAnswers(answers) {
  return answers.map((answer) => {
    const copy = { id: answer.id, selected: [...answer.selected] };
    if (typeof answer.custom === "string")
      copy.custom = answer.custom;
    return copy;
  });
}
function answerRefusalOf(view, answers) {
  if (!Array.isArray(answers) || answers.length === 0)
    return "shape";
  const parkedIds = new Set(view.questions.map((question) => question.id));
  const byId = new Map(view.questions.map((question) => [question.id, question]));
  const seen = new Set;
  const entries = [];
  for (const entry of answers) {
    if (entry === null || typeof entry !== "object")
      return "shape";
    const raw = entry;
    if (typeof raw.id !== "string" || raw.id === "")
      return "shape";
    if (seen.has(raw.id))
      return "duplicate";
    seen.add(raw.id);
    if (!parkedIds.has(raw.id))
      return "unknown-id";
    entries.push({ id: raw.id, selected: raw.selected, custom: raw.custom });
  }
  for (const question of view.questions) {
    if (!seen.has(question.id))
      return "missing";
  }
  for (const entry of entries) {
    const question = byId.get(entry.id);
    if (question === undefined)
      return "unknown-id";
    if (!Array.isArray(entry.selected))
      return "shape";
    const labels = new Set((question.options ?? []).map((option) => option.label));
    if (question.multiSelect !== true && entry.selected.length > 1)
      return "too-many-labels";
    for (const label of entry.selected) {
      if (typeof label !== "string")
        return "shape";
      if (!labels.has(label))
        return "label";
    }
    if (entry.custom !== undefined && typeof entry.custom !== "string")
      return "shape";
  }
  return;
}
function answersMatch(view, answers) {
  return answerRefusalOf(view, answers) === undefined;
}
function nextIdOf(sequence, at) {
  return "q" + sequence.toString(36) + "-" + at.toString(36);
}
function createQuestionRelay(options = {}) {
  const ttlMs = amountOf(options.ttlMs, DEFAULT_QUESTION_TTL_MS);
  const attachWindowMs = amountOf(options.attachWindowMs, DEFAULT_ATTACH_WINDOW_MS);
  const capacity = Math.max(1, Math.floor(amountOf(options.capacity, DEFAULT_QUESTION_CAPACITY)));
  const now = options.now ?? (() => Date.now());
  const parked = [];
  let lastListAt;
  let disposed = false;
  let sequence = 0;
  function warnLine(line) {
    try {
      options.warn?.(line);
    } catch {}
  }
  function releaseHandles(entry) {
    if (entry.timer !== undefined)
      clearTimeout(entry.timer);
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      try {
        entry.signal.removeEventListener("abort", entry.onAbort);
      } catch {}
    }
  }
  function settle(entry, finish) {
    const at = parked.indexOf(entry);
    if (at < 0)
      return;
    parked.splice(at, 1);
    releaseHandles(entry);
    finish();
  }
  function attached() {
    if (lastListAt === undefined)
      return false;
    const elapsed = now() - lastListAt;
    return elapsed <= attachWindowMs;
  }
  function park(request, original) {
    while (parked.length >= capacity) {
      const oldest = parked[0];
      if (oldest === undefined)
        break;
      warnLine("question relay: the parked question " + oldest.view.id + " was evicted (capacity " + capacity + ")");
      settle(oldest, () => oldest.reject(oldest.original));
    }
    const hooks = {};
    const promise = new Promise((resolve, reject) => {
      hooks.resolve = resolve;
      hooks.reject = reject;
    });
    sequence += 1;
    const at = now();
    const view = {
      id: nextIdOf(sequence, at),
      createdAt: at,
      ...request.sessionId === undefined ? {} : { sessionId: request.sessionId },
      questions: copyQuestions(request.questions)
    };
    const entry = {
      view,
      original,
      resolve: (answers) => {
        hooks.resolve?.(answers);
      },
      reject: (error) => {
        hooks.reject?.(error);
      }
    };
    parked.push(entry);
    entry.timer = setTimeout(() => {
      settle(entry, () => entry.reject(original));
    }, ttlMs);
    if (request.signal !== undefined) {
      const signal = request.signal;
      const onAbort = () => {
        settle(entry, () => entry.reject(abortErrorOf(signal)));
      };
      entry.signal = signal;
      entry.onAbort = onAbort;
      try {
        signal.addEventListener("abort", onAbort, { once: true });
      } catch {}
      if (signal.aborted)
        onAbort();
    }
    return promise;
  }
  async function handle(request, next) {
    try {
      return await next();
    } catch (error) {
      if (!noProviderOf(error))
        throw error;
      if (request.questions.length === 0)
        throw error;
      if (disposed)
        throw error;
      if (request.signal?.aborted === true)
        throw abortErrorOf(request.signal);
      if (!attached())
        throw error;
      return { answers: await park(request, error) };
    }
  }
  function list(sessionId) {
    if (disposed)
      return [];
    lastListAt = now();
    const rows = parked.filter((entry) => sessionId === undefined || entry.view.sessionId === sessionId);
    return rows.map((entry) => ({
      ...entry.view,
      questions: copyQuestions(entry.view.questions)
    }));
  }
  function answer(input) {
    if (disposed)
      return false;
    const id = typeof input?.id === "string" ? input.id : "";
    if (id === "")
      return false;
    const entry = parked.find((candidate) => candidate.view.id === id);
    if (entry === undefined)
      return false;
    const answers = input?.answers;
    if (!answersMatch(entry.view, answers))
      return false;
    const settledAnswers = copyAnswers(answers);
    settle(entry, () => entry.resolve(settledAnswers));
    return true;
  }
  function dispose() {
    if (disposed)
      return;
    disposed = true;
    lastListAt = undefined;
    for (const entry of parked.splice(0)) {
      releaseHandles(entry);
      entry.reject(entry.original);
    }
  }
  return { handle, list, answer, dispose };
}
function installQuestionRelay(dsh, options = {}) {
  try {
    if (typeof dsh.onUserQuestionRequest !== "function")
      return { installed: false, reason: "no-seam" };
    if (dsh.capabilities().events !== true)
      return { installed: false, reason: "no-event-bus" };
    const relay = createQuestionRelay(options);
    const off = dsh.onUserQuestionRequest((request, next) => relay.handle(request, next), "mpd-roles");
    return {
      installed: true,
      relay,
      dispose: () => {
        try {
          if (typeof off === "function")
            off();
        } catch {}
        relay.dispose();
      }
    };
  } catch {
    return { installed: false, reason: "threw" };
  }
}
function writeJson(res, status, body, headers = {}) {
  const out = res;
  out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  out.end(JSON.stringify(body));
}
function warnLine(deps, line) {
  try {
    deps.warn?.(line);
  } catch {}
}
async function readBody(request) {
  const req = request;
  if (req === undefined || typeof req[Symbol.asyncIterator] !== "function")
    return { ok: false, status: 400 };
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    const part = typeof chunk === "string" ? encoder.encode(chunk) : chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk));
    size += part.byteLength;
    if (size > MAX_BODY_BYTES)
      return { ok: false, status: 413 };
    parts.push(part);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  const raw = decoder.decode(bytes);
  if (raw.trim() === "")
    return { ok: false, status: 400 };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400 };
  }
}
function recordOf(body) {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? body : undefined;
}
function methodOf(request) {
  const method = request?.method;
  return typeof method === "string" ? method.toUpperCase() : "";
}
function sessionIdOf(request) {
  const raw = request?.url;
  if (typeof raw !== "string" || raw === "")
    return;
  try {
    const url = new URL(raw, "http://localhost");
    const value = url.searchParams.get("sessionId")?.trim() ?? "";
    return value === "" ? undefined : value;
  } catch {
    return;
  }
}
function parseAnswerBody(body) {
  const record = recordOf(body);
  if (record === undefined)
    return { ok: false, error: "the request body must be a JSON object" };
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (id === "")
    return { ok: false, error: "id must be a non-empty string" };
  if (!Array.isArray(record.answers) || record.answers.length === 0)
    return { ok: false, error: "answers must be a non-empty array" };
  const answers = [];
  for (const entry of record.answers) {
    const raw = entry !== null && typeof entry === "object" ? entry : undefined;
    if (raw === undefined)
      return { ok: false, error: "every answer must be a JSON object" };
    const questionId = typeof raw.id === "string" ? raw.id.trim() : "";
    if (questionId === "")
      return { ok: false, error: "every answer needs a non-empty id" };
    if (!Array.isArray(raw.selected))
      return { ok: false, error: "every answer needs selected as an array of strings" };
    const selected = [];
    for (const label of raw.selected) {
      if (typeof label !== "string")
        return { ok: false, error: "every answer needs selected as an array of strings" };
      selected.push(label);
    }
    if (raw.custom !== undefined && typeof raw.custom !== "string")
      return { ok: false, error: "custom must be a string when present" };
    const answer = { id: questionId, selected };
    if (typeof raw.custom === "string")
      answer.custom = raw.custom;
    answers.push(answer);
  }
  return { ok: true, value: { id, answers } };
}
function listHandlerOf(dsh, deps) {
  return async (req, res) => {
    try {
      const rejection = dsh.webRequestRejection(req);
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: `mpd-roles: the request is not authenticated for ${QUESTIONS_PATH}` });
        return;
      }
      if (methodOf(req) !== "GET") {
        writeJson(res, 405, { ok: false, error: "mpd-roles: this route accepts GET only" }, { allow: "GET" });
        return;
      }
      const pending = deps.relay.list(sessionIdOf(req));
      writeJson(res, 200, { ok: true, pending });
    } catch (error) {
      warnLine(deps, `route ${QUESTIONS_PATH} failed: ${messageOf(error)}`);
      try {
        writeJson(res, 500, { ok: false, error: "mpd-roles: the request could not be completed" });
      } catch {}
    }
  };
}
function refusalLineOf(refusal) {
  switch (refusal) {
    case "missing":
      return "the answers must cover every question the request asked (one answer per question item)";
    case "duplicate":
      return "the answers name the same question id twice";
    case "unknown-id":
      return "an answer names a question this request does not carry";
    case "too-many-labels":
      return "a question that is not multi-select accepts at most one label";
    case "shape":
      return "an answer entry is malformed";
    case "label":
      return "an answer selected a label this question does not offer";
    default:
      return "the answer batch was refused";
  }
}
function answerHandlerOf(dsh, deps) {
  return async (req, res) => {
    try {
      const rejection = dsh.webRequestRejection(req);
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: `mpd-roles: the request is not authenticated for ${ANSWER_PATH}` });
        return;
      }
      if (methodOf(req) !== "POST") {
        writeJson(res, 405, { ok: false, error: "mpd-roles: this route accepts POST only" }, { allow: "POST" });
        return;
      }
      const read = await readBody(req);
      if (!read.ok) {
        writeJson(res, read.status, read.status === 413 ? { ok: false, error: `mpd-roles: the request body exceeds ${MAX_BODY_BYTES} bytes` } : { ok: false, error: "mpd-roles: the request body is not valid JSON" });
        return;
      }
      const body = parseAnswerBody(read.value);
      if (!body.ok) {
        writeJson(res, 400, { ok: false, error: `mpd-roles: ${body.error}` });
        return;
      }
      const parkedRow = deps.relay.list().find((row) => row.id === body.value.id);
      if (deps.relay.answer(body.value)) {
        writeJson(res, 200, { ok: true, answered: true });
        return;
      }
      if (parkedRow === undefined) {
        writeJson(res, 404, { ok: false, error: "mpd-roles: no pending question has that id" });
        return;
      }
      writeJson(res, 400, { ok: false, error: "mpd-roles: " + refusalLineOf(answerRefusalOf(parkedRow, body.value.answers)) });
    } catch (error) {
      warnLine(deps, `route ${ANSWER_PATH} failed: ${messageOf(error)}`);
      try {
        writeJson(res, 500, { ok: false, error: "mpd-roles: the request could not be completed" });
      } catch {}
    }
  };
}
function registerQuestionWeb(dsh, effect, deps) {
  const mountedByServer = new WeakMap;
  const serverOf = () => {
    try {
      const server = dsh.webServerOf();
      return server !== undefined && server !== null && typeof server.register === "function" ? server : undefined;
    } catch {
      return;
    }
  };
  const routes = [
    { path: QUESTIONS_PATH, handler: listHandlerOf(dsh, deps) },
    { path: ANSWER_PATH, handler: answerHandlerOf(dsh, deps) }
  ];
  const attempt = () => {
    const server = serverOf();
    if (server === undefined)
      return false;
    if (typeof effect !== "function")
      return false;
    const mounted = mountedByServer.get(server) ?? new Set;
    mountedByServer.set(server, mounted);
    for (const route of routes) {
      if (mounted.has(route.path))
        continue;
      try {
        effect(() => server.register({ kind: "exact", path: route.path, handler: route.handler }));
        mounted.add(route.path);
      } catch (error) {
        warnLine(deps, `registering ${route.path} failed: ${messageOf(error)}`);
      }
    }
    return mounted.size === QUESTION_ROUTES.length;
  };
  const first = attempt();
  try {
    dsh.onServiceBound(["webServer", "httpServer"], () => {
      attempt();
    });
  } catch (error) {
    warnLine(deps, "the web-server binding subscription is unavailable: " + messageOf(error));
  }
  return first;
}

// packages/mpd-roles-plugin/src/delegation-gate.ts
var DELEGATION_CONFIG_KEY = "delegation.gate";
var DELEGATION_TOOLS = ["subagent", "subagent_fork", "workflow"];
function resolveDelegationGateMode(raw) {
  if (raw === "captain")
    return "captain";
  if (raw === "allow")
    return "allow";
  return "deny";
}
function delegationGateDecision(input) {
  const toolName = String(input.toolName ?? "");
  if (!DELEGATION_TOOLS.includes(toolName))
    return;
  if (input.mode === "deny" || input.mode === "captain" && input.rank === "captain")
    return delegationRefusal(toolName);
  return;
}
function delegationRefusal(toolName) {
  return "delegation gate: `" + toolName + "` is refused — the official spawn tools are not the delegation" + " path under the MPD discipline. Delegate instead: `mpd_role_spawn` (one-shot single-call roster consult)," + " `mpd_workmate_match` + `mpd_workmate_spawn` (durable instance), or Agent Teams for multi-member work" + " (`agent_teams_plan`, persona from `mpd_role_persona`); a consult is one-shot — `send_message`" + " continues only an existing TEAM child, never a finished consult. The gate covers the captain and" + " every member session. `delegation.gate` in" + ' mpd.jsonc: "captain" limits it to the top-level session, "allow" releases it entirely.';
}
function installDelegationGate(dsh, options) {
  const mode = resolveDelegationGateMode(options.configValue(DELEGATION_CONFIG_KEY));
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the delegation gate is NOT installed " + "(the official spawn tools stay available; the rule lives in the instruction text only; " + "`delegation.gate` in mpd.jsonc selects the mode once the seam exists)");
      return { installed: false, mode, reason: "no-guard-seam" };
    }
    const dispose = dsh.guardTool((exec) => {
      try {
        const rank = sessionRank(exec?.agent);
        if (rank === "captain" && !sessionIsMpdCaptain(exec?.agent))
          return;
        return delegationGateDecision({
          toolName: String(exec?.name ?? ""),
          mode: resolveDelegationGateMode(options.configValue(DELEGATION_CONFIG_KEY)),
          rank
        });
      } catch {
        return;
      }
    });
    return { installed: true, mode, ...typeof dispose === "function" ? { dispose } : {} };
  } catch (error) {
    options.warn("installing the delegation gate failed (" + (error instanceof Error ? error.message : String(error)) + ")");
    return { installed: false, mode, reason: "install-failed" };
  }
}

// packages/mpd-roles-plugin/src/roster-section.ts
var ROSTER_SECTION_NAME = "mpd:roster";
var ROSTER_SECTION_ORDER = 605;
function functionOf(description) {
  const text = String(description ?? "");
  const afterColon = text.includes(": ") ? text.slice(text.indexOf(": ") + 2) : text;
  return afterColon.replace(/\s*\(([^()]*)\)/g, ", $1").replace(/\.+\s*$/, "").replace(/,\s*,/g, ",").trim();
}
function rosterSectionText(members) {
  const lines = members.map((member) => "- " + member.name + (member.readonly ? " [read-only]" : " [writes]") + " — " + functionOf(member.description));
  return [
    "## MPD specialist roster",
    "The specialists this deployment stages as teammates, addressed by NAME:",
    ...lines,
    'Create one with `agent_teams_plan` {action:"add_member"} (prompt = `mpd_role_persona`\'s text) → {action:"create_task"} (each task carrying its dependency answer: `blocked_by` or `independent: true`) → {action:"approve"}; then `agent_teams_task`/`agent_teams_dispatch`. A teammate cannot take a model or tool filter: each agent\'s `agentRoutes` entry applies by identity — `role`, then the `description` head, then the whole `name`; `mpd_role_spawn` applies that entry directly and refuses when it is unusable. An UNMATCHED member inherits YOUR model route (the staging session\'s); prompt text cannot change a route. Read-only members\' write tools are denied by the guard.'
  ].join(`
`);
}
function installRosterSection(dsh, options) {
  const presets = options.presets ?? ["mpd"];
  const disposers = new Map;
  const text = rosterSectionText(options.members);
  const report = (line) => {
    try {
      options.log?.(line);
    } catch {}
  };
  const register = (agent) => {
    try {
      if (agent === undefined || agent === null || disposers.has(agent))
        return;
      if (!sessionQualifies(agent, presets))
        return;
      const section = { name: ROSTER_SECTION_NAME, order: ROSTER_SECTION_ORDER, text };
      const dispose = dsh.agentPromptSection(agent, section);
      disposers.set(agent, typeof dispose === "function" ? dispose : () => {});
      const preset = agent?.session?.header?.agentPreset;
      report('roster section registered for agent "' + String(agent?.id ?? "?") + '" agentPreset=' + (preset === undefined ? "none" : String(preset)) + " — " + ROSTER_SECTION_NAME + " order=" + ROSTER_SECTION_ORDER);
    } catch (error) {
      options.warn('roster section not registered for agent "' + String(agent?.id ?? "?") + '" (' + (error instanceof Error ? error.message : String(error)) + ")");
    }
  };
  const release = (agent) => {
    const dispose = disposers.get(agent);
    if (dispose === undefined)
      return;
    disposers.delete(agent);
    try {
      dispose();
    } catch {}
  };
  for (const agent of dsh.liveAgents())
    register(agent);
  const subscribe = (event, handler) => {
    try {
      if (options.onEvent !== undefined) {
        options.onEvent(event, handler);
        return;
      }
      dsh.onEvent(event, handler);
    } catch {}
  };
  subscribe("agent/created", (payload) => {
    register(payload?.agent ?? payload);
    return;
  });
  subscribe("agent/disposed", (payload) => {
    release(payload?.agent ?? payload);
    return;
  });
  return { installed: true, registered: disposers.size, disposers };
}

// packages/mpd-dsh-adapter-plugin/src/index.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { resolve as resolve2, sep as sep2 } from "node:path";

// packages/mpd-dsh-adapter-plugin/src/shared.ts
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function bundleRootOf(moduleUrl) {
  return dirname(dirname(dirname(dirname(fileURLToPath(moduleUrl)))));
}

// packages/mpd-mcp-shared/log-sink.ts
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join as join2, relative, resolve, sep } from "node:path";
var LOG_SUBDIR = join2(".mpd", "logs");
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
    const dir = join2(root, LOG_SUBDIR);
    mkdirSync(dir, { recursive: true });
    const file = join2(dir, `${name}.log`);
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
  const message = { id: randomUUID2(), role: "user", content, source };
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
        if (scopedDshGo !== undefined && scopedDshGo !== null)
          return;
        try {
          scopedDshGo = scoped?.dshGo;
        } catch {}
        if (scopedDshGo === undefined || scopedDshGo === null) {
          try {
            scopedDshGo = typeof scoped?.get === "function" ? scoped.get("dshGo", false) : undefined;
          } catch {}
        }
        if (scopedDshGo === undefined || scopedDshGo === null) {
          scopedDshGo = undefined;
          return;
        }
        notifyDshGoBound();
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
var ADAPTER_IDENTITY_MOUNTED = "mounted:mpdDsh";
var ADAPTER_IDENTITY_PENDING = "pending:provider-not-active";
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
function dshAdapterIdentity(ctx) {
  if (!probeMpdDsh(ctx, true).missing)
    return ADAPTER_IDENTITY_MOUNTED;
  if (!probeMpdDsh(ctx, false).missing)
    return ADAPTER_IDENTITY_PENDING;
  return ADAPTER_IDENTITY_FALLBACK;
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

// packages/mpd-roles-plugin/src/session-gate.ts
var STAGING_TIMEOUT_MS = 5000;
function gateTrace(line) {
  try {
    if (process.env.MPD_ROLES_GATE_TRACE === "1")
      rowLogLine("mpd-roles", "[mpd-roles] gate trace: " + line);
  } catch {}
}
function sessionIdOf2(agent) {
  const handle = agent;
  const id = handle?.session?.id ?? handle?.sessionId ?? handle?.id;
  return typeof id === "string" && id !== "" ? id : "workspace";
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
function installSessionGate(dsh, options) {
  const presets = options.presets ?? DEFAULT_GATE_PRESETS;
  const acted = new Set;
  const disposers = new Map;
  const report = (line) => {
    try {
      options.log?.(line);
    } catch {}
  };
  const warn = (line) => {
    try {
      options.warn(line);
    } catch {}
  };
  const reTeamStates = new Map;
  const firing = new Set;
  const repairNoticed = new Set;
  const autoEndAttempted = new Set;
  function reTeamKeyOf(workspace, sessionId) {
    return workspace + "\x00" + sessionId;
  }
  async function loadReTeamState(workspace, sessionId) {
    const key = reTeamKeyOf(workspace, sessionId);
    const cached = reTeamStates.get(key);
    if (cached !== undefined)
      return cached;
    const pending = readReTeamState(workspace, sessionId, {
      ...options.stateReadFile === undefined ? {} : { readFile: options.stateReadFile }
    }).then((loaded) => loaded ?? emptyReTeamState());
    reTeamStates.set(key, pending);
    return pending;
  }
  async function saveReTeamState(workspace, sessionId, state) {
    reTeamStates.set(reTeamKeyOf(workspace, sessionId), Promise.resolve(state));
    await writeReTeamState(workspace, sessionId, state, {
      ...options.stateWriteFile === undefined ? {} : { writeFile: options.stateWriteFile }
    });
  }
  function configValue(key) {
    try {
      return options.configValue?.(key);
    } catch {
      return;
    }
  }
  function hasStagingTool(agent) {
    if (typeof dsh.hasTool !== "function")
      return false;
    try {
      return dsh.hasTool(STAGING_TOOL_NAME, agent) === true;
    } catch {
      return false;
    }
  }
  function probeStagedPlan(workspace, sessionId) {
    if (typeof options.stagedPlan !== "function") {
      return { verdict: "unknown", reason: "no staged-plan probe is available in this composition (mpdTeams is not mounted)" };
    }
    try {
      const existing = options.stagedPlan(workspace, sessionId);
      return existing === undefined || existing === null ? { verdict: "none" } : { verdict: "staged", plan: existing };
    } catch (error) {
      return { verdict: "unknown", reason: errorText(error) };
    }
  }
  async function stagePlan(input) {
    const probe = probeStagedPlan(input.workspace, input.sessionId);
    if (probe.verdict === "staged")
      return { ok: true, planId: planIdOf(probe.plan), alreadyStaged: true };
    if (probe.verdict === "unknown") {
      warn('session-start gate: the staged-plan probe could not answer for session "' + input.sessionId + '" (' + String(probe.reason) + ") — staging anyway, so an existing UN-APPROVED plan for this session may have been ARCHIVED into .mpd/team/archive/ (an APPROVED plan is never replaced without replace:true)");
    }
    if (!hasStagingTool(input.agent))
      return { ok: false, planId: "", alreadyStaged: false, error: "tool " + STAGING_TOOL_NAME + " is not registered in this agent's view" };
    try {
      const shell = gatePlanShell({
        signals: input.signals,
        goal: input.goal,
        ...input.planPath === undefined ? {} : { planPath: input.planPath },
        ...input.reteam === undefined ? {} : { reteam: input.reteam }
      });
      const result = await dsh.executeTool({
        name: STAGING_TOOL_NAME,
        arguments: { action: "create", name: shell.name, description: shell.description, approval: shell.approval },
        agent: input.agent,
        timeoutMs: options.stageTimeoutMs ?? STAGING_TIMEOUT_MS
      });
      if (result?.ok !== true || result.isError === true) {
        return { ok: false, planId: "", alreadyStaged: false, error: result?.error === undefined ? "the staging call did not report ok" : String(result.error) };
      }
      return { ok: true, planId: planIdOf(result.value), alreadyStaged: false };
    } catch (error) {
      return { ok: false, planId: "", alreadyStaged: false, error: errorText(error) };
    }
  }
  async function countCompletedConsult(exec, result) {
    try {
      if (exec === undefined || exec === null || !isConsultToolName(exec.name))
        return;
      if (result?.isError === true)
        return;
      const agent = exec.agent;
      if (agent === undefined || agent === null)
        return;
      if (!sessionQualifies(agent, presets))
        return;
      const workspace = dsh.workspaceRoot({ agent });
      const sessionId = sessionIdOf2(agent);
      const state = await loadReTeamState(workspace, sessionId);
      state.consultCount += 1;
      await saveReTeamState(workspace, sessionId, state);
      gateTrace("consult counted session=" + sessionId + " count=" + String(state.consultCount) + " tool=" + String(exec.name));
    } catch {}
  }
  function subscribeConsultCounter() {
    if (typeof dsh.onPostToolExecute !== "function")
      return;
    try {
      dsh.onPostToolExecute(async (exec, result) => {
        await countCompletedConsult(exec, result);
        return;
      });
    } catch {}
  }
  async function autoEndCleanTerminal(agent, teamId) {
    try {
      const result = await dsh.executeTool({
        name: CONTROL_TOOL_NAME,
        arguments: { action: "end", team_id: teamId, reason: RETEAM_AUTO_END_REASON },
        agent,
        timeoutMs: options.stageTimeoutMs ?? STAGING_TIMEOUT_MS
      });
      if (result?.ok !== true || result.isError === true) {
        warn('re-team gate: the clean-terminal team "' + teamId + '" was NOT auto-ended (' + (result?.error === undefined ? "the control call did not report ok" : String(result.error)) + ") — the gate continues");
        return false;
      }
      report('re-team gate: auto-ended clean-terminal team "' + teamId + '" through ' + CONTROL_TOOL_NAME);
      return true;
    } catch (error) {
      warn('re-team gate: the clean-terminal team "' + teamId + '" was NOT auto-ended (' + errorText(error) + ") — the gate continues");
      return false;
    }
  }
  function spliceNotice(decision, decisionMessages, rawClaimed, notice, rewrite) {
    const messages = [...decisionMessages.length > 0 ? decisionMessages : rawClaimed].map((message) => rewrite === undefined ? message : rewrite(message));
    let lastClaimed = -1;
    for (let at2 = 0;at2 < messages.length; at2 += 1)
      if (rawClaimed.includes(messages[at2]))
        lastClaimed = at2;
    const at = lastClaimed < 0 ? messages.length : lastClaimed + 1;
    const amended = [...messages.slice(0, at), notice, ...messages.slice(at)];
    return { ...decision, kind: decision?.kind ?? "enter", messages: amended };
  }
  async function recordFire(workspace, sessionId, state, planId) {
    state.consultCount = 0;
    state.lastFiredAt = Date.now();
    state.planId = planId;
    state.teamIdAtFire = "";
    await saveReTeamState(workspace, sessionId, state);
  }
  async function fireReTeam(input) {
    const key = reTeamKeyOf(input.workspace, input.sessionId);
    if (firing.has(key)) {
      gateTrace("re-team fire in flight agent=" + input.agentId);
      return;
    }
    firing.add(key);
    try {
      const state = await loadReTeamState(input.workspace, input.sessionId);
      let outcome = { ok: false, planId: "", alreadyStaged: false };
      if (input.mode === GATE_MODE_MECHANICAL) {
        outcome = await stagePlan({
          agent: input.agent,
          workspace: input.workspace,
          sessionId: input.sessionId,
          goal: "",
          signals: [],
          reteam: { count: input.count, threshold: input.threshold }
        });
        if (!outcome.ok) {
          warn('re-team gate: staging degraded for agent "' + input.agentId + '" (' + String(outcome.error) + ")");
        }
      }
      const staged = input.mode === GATE_MODE_MECHANICAL && outcome.ok && !outcome.alreadyStaged;
      const alreadyStaged = input.mode === GATE_MODE_MECHANICAL && outcome.ok && outcome.alreadyStaged;
      await recordFire(input.workspace, input.sessionId, state, outcome.ok && input.mode === GATE_MODE_MECHANICAL ? outcome.planId : "");
      if (input.agentId !== "")
        acted.add(input.agentId);
      report('re-team gate fired for agent "' + input.agentId + '" consults=' + String(input.count) + "/" + String(input.threshold) + " mode=" + input.mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId));
      if (staged && outcome.planId === "") {
        warn("re-team gate: " + MISSING_PLAN_ID_PHRASE + ' for agent "' + input.agentId + '" — the shell is staged but cannot be approved');
      }
      gateTrace("RE-TEAM FIRING agent=" + input.agentId + " consults=" + String(input.count) + " staged=" + String(staged));
      return reTeamNoticeText({
        count: input.count,
        threshold: input.threshold,
        staged,
        alreadyStaged,
        planId: staged || alreadyStaged ? outcome.planId : "",
        ...outcome.ok || outcome.error === undefined ? {} : { error: String(outcome.error) }
      });
    } finally {
      firing.delete(key);
    }
  }
  const stepHandler = (bound) => async (payload, decision) => {
    try {
      gateTrace("step entered bound=" + String(bound?.id ?? "none") + " payloadAgent=" + String(payload?.agent?.id ?? "none") + " kind=" + String(decision?.kind) + " payloadMessages=" + String(Array.isArray(payload?.messages) ? payload.messages.length : -1) + " decisionMessages=" + String(Array.isArray(decision?.messages) ? decision.messages.length : -1));
      if (decision?.kind === "reject")
        return;
      const agent = bound ?? payload?.agent;
      if (agent === undefined || agent === null)
        return;
      if (!sessionQualifies(agent, presets)) {
        gateTrace("not qualified agent=" + String(agent.id ?? "?"));
        return;
      }
      const agentId = String(agent.id ?? "");
      const mode = resolveGateMode(configValue(GATE_CONFIG_KEY));
      if (mode === GATE_MODE_OFF) {
        gateTrace("mode off agent=" + agentId);
        return;
      }
      const decisionMessages = Array.isArray(decision?.messages) ? decision.messages : [];
      const rawClaimed = Array.isArray(payload?.messages) && payload.messages.length > 0 ? payload.messages : decisionMessages;
      const workspace = dsh.workspaceRoot({ agent });
      const sessionId = sessionIdOf2(agent);
      const stateKey = reTeamKeyOf(workspace, sessionId);
      if (firing.has(stateKey)) {
        gateTrace("fire in flight agent=" + agentId);
        return;
      }
      const leading = await readLeadingTeam(workspace, sessionId, {
        ...options.readFile === undefined ? {} : { readFile: options.readFile },
        ...options.readDir === undefined ? {} : { readDir: options.readDir }
      });
      const state = await loadReTeamState(workspace, sessionId);
      if (leading.leading) {
        if (state.lastFiredAt !== 0 || state.planId !== "" || state.teamIdAtFire !== (leading.teamId ?? "")) {
          state.lastFiredAt = 0;
          state.planId = "";
          state.teamIdAtFire = leading.teamId ?? "";
          await saveReTeamState(workspace, sessionId, state);
          if (agentId !== "")
            acted.delete(agentId);
        }
        if (leading.failedTaskId !== undefined && leading.failedTeamId !== undefined && !repairNoticed.has(leading.failedTeamId)) {
          repairNoticed.add(leading.failedTeamId);
          report('re-team gate: team "' + leading.failedTeamId + '" has an unrepaired failed task; no auto-end and no re-stage');
          return spliceNotice(decision, decisionMessages, rawClaimed, dsh.userMessage({
            text: reTeamRepairNoticeText(leading.failedTeamId, leading.failedTaskId),
            source: { kind: "mpd-roles", reason: "re-team-repair" }
          }));
        }
        gateTrace("already leading team=" + String(leading.teamId ?? "(id not read)") + " members=" + String(leading.members) + " agent=" + agentId);
        return;
      }
      if (leading.ended === true || leading.cleanTerminal === true) {
        for (const target of leading.autoEndTeamIds ?? []) {
          if (target === "" || autoEndAttempted.has(target))
            continue;
          autoEndAttempted.add(target);
          await autoEndCleanTerminal(agent, target);
        }
        const settled = state.lastFiredAt !== 0 || state.planId !== "" || state.teamIdAtFire !== "";
        const bound2 = state.teamIdAtFire !== "" && (leading.terminalTeamIds ?? []).includes(state.teamIdAtFire) || state.lastFiredAt !== 0 && (leading.terminalEndedAt ?? []).some((endedAt) => endedAt > state.lastFiredAt);
        if (settled && bound2) {
          state.lastFiredAt = 0;
          state.planId = "";
          state.teamIdAtFire = "";
          await saveReTeamState(workspace, sessionId, state);
          if (agentId !== "")
            acted.delete(agentId);
          report('re-team gate: re-armed after team "' + String(leading.teamId ?? "(id not read)") + '" ended');
        }
      }
      if (state.lastFiredAt !== 0 || state.planId !== "") {
        gateTrace("re-team settled agent=" + agentId + " plan=" + String(state.planId));
        return;
      }
      if (resolveReTeamEnabled(configValue(RETEAM_ENABLED_CONFIG_KEY))) {
        const afterConsults = resolveReTeamAfterConsults(configValue(RETEAM_AFTER_CONSULTS_CONFIG_KEY));
        if (state.consultCount >= afterConsults) {
          const noticeText = await fireReTeam({ agent, agentId, workspace, sessionId, mode, count: state.consultCount, threshold: afterConsults });
          if (noticeText === undefined)
            return;
          return spliceNotice(decision, decisionMessages, rawClaimed, dsh.userMessage({
            text: noticeText,
            source: { kind: "mpd-roles", reason: "re-team-trigger" }
          }));
        }
      }
      const user = latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages);
      if (user === undefined) {
        gateTrace("no user text yet agent=" + agentId);
        return;
      }
      const consumed = consumeExplicitFlag(user.text);
      const boulderDir = resolveBoulderDir(configValue(BOULDER_DIR_CONFIG_KEY));
      const boulder = await readBoulderGate(workspace, {
        ...options.readFile === undefined ? {} : { readFile: options.readFile },
        ...boulderDir === undefined ? {} : { boulderDir }
      });
      const sensitivity = resolveSensitivity(configValue(SENSITIVITY_CONFIG_KEY));
      const wantsWorkspaceScale = SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale;
      const workspaceScale = wantsWorkspaceScale ? await readWorkspaceScale(workspace, {
        ...options.readDir === undefined ? {} : { readDir: options.readDir }
      }) : false;
      const verdict = evaluateComplexityGate(consumed.text, {
        explicitFlag: consumed.flagged,
        activeBoulder: boulder.active,
        sensitivity,
        workspaceScale
      });
      if (verdict.trigger !== true) {
        gateTrace("predicate false agent=" + agentId + " text=" + JSON.stringify(user.text.slice(0, 60)));
        return;
      }
      if (firing.has(stateKey)) {
        gateTrace("fire in flight agent=" + agentId);
        return;
      }
      firing.add(stateKey);
      let outcome = { ok: false, planId: "", alreadyStaged: false };
      try {
        if (mode === GATE_MODE_MECHANICAL) {
          outcome = await stagePlan({
            agent,
            workspace,
            sessionId,
            goal: consumed.text,
            signals: verdict.signals,
            ...boulder.planPath === undefined ? {} : { planPath: boulder.planPath }
          });
          if (!outcome.ok) {
            warn('session-start gate: staging degraded to the advisory notice for agent "' + agentId + '" (' + String(outcome.error) + ")");
          }
        }
      } finally {
        firing.delete(stateKey);
      }
      const staged = mode === GATE_MODE_MECHANICAL && outcome.ok;
      report('session gate fired for agent "' + agentId + '" signals=' + verdict.signals.join("/") + " mode=" + mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId) + " sensitivity=" + sensitivity);
      if (staged && outcome.planId === "") {
        warn("session-start gate: " + MISSING_PLAN_ID_PHRASE + ' for agent "' + agentId + '" — the shell is staged but cannot be approved');
      }
      gateTrace("FIRING agent=" + agentId + " signals=" + verdict.signals.join("/") + " mode=" + mode + " staged=" + String(staged) + " sensitivity=" + sensitivity);
      await recordFire(workspace, sessionId, state, staged ? outcome.planId : "");
      if (agentId !== "")
        acted.add(agentId);
      const notice = dsh.userMessage({
        text: staged ? mechanicalNoticeText({ planId: outcome.planId, signals: verdict.signals, explicit: consumed.flagged, alreadyStaged: outcome.alreadyStaged, strength: verdict.strength }) : advisoryNoticeText(verdict.signals, consumed.flagged, verdict.strength),
        source: { kind: "mpd-roles", reason: "session-start-advisory" }
      });
      return spliceNotice(decision, decisionMessages, rawClaimed, notice, (message) => message === user.message ? consumeFlagFromMessage(message, user.text) : message);
    } catch (error) {
      warn("session-start gate failed (" + errorText(error) + ") — the step runs unchanged");
      return;
    }
  };
  const release = (agent) => {
    const dispose = disposers.get(agent);
    if (dispose === undefined)
      return;
    disposers.delete(agent);
    try {
      dispose();
    } catch {}
  };
  const register = (agent) => {
    if (agent === undefined || agent === null || disposers.has(agent))
      return;
    try {
      if (!sessionQualifies(agent, presets))
        return;
      const dispose = dsh.registerAgentPreStep(agent, stepHandler(agent));
      disposers.set(agent, typeof dispose === "function" ? dispose : () => {});
      const preset = agent?.session?.header?.agentPreset;
      report('session gate listener registered for agent "' + String(agent.id ?? "?") + '" agentPreset=' + (preset === undefined ? "none" : String(preset)));
      gateTrace("registered agent=" + String(agent.id ?? "?"));
    } catch (error) {
      warn('session-start gate not registered for agent "' + String(agent?.id ?? "?") + '" (' + errorText(error) + ")");
    }
  };
  subscribeConsultCounter();
  for (const agent of dsh.liveAgents())
    register(agent);
  const subscribe = (event, handler) => {
    try {
      dsh.onEvent(event, handler);
    } catch {}
  };
  subscribe("agent/created", (payload) => register(payload?.agent ?? payload));
  subscribe("agent/disposed", (payload) => release(payload?.agent ?? payload));
  return {
    installed: true,
    acted,
    disposers,
    mode: resolveGateMode(configValue(GATE_CONFIG_KEY)),
    sensitivity: resolveSensitivity(configValue(SENSITIVITY_CONFIG_KEY))
  };
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

// packages/mpd-roles-plugin/src/tool-cards.ts
var CELL_LIMIT = 60;
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function arrayAt(source, key) {
  const found = source[key];
  return Array.isArray(found) ? found : [];
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
function roleRow(row) {
  const role = isRecord3(row) ? row : {};
  const route = words(role.provider, 24) === undefined ? cell(role.model, 40) : `${cell(role.provider, 24)}/${cell(role.model, 40)}`;
  return [cell(role.name, 24), route, role.readonly === true ? "read-only" : "writes"];
}
function refusedRow(row) {
  const refusal = isRecord3(row) ? row : {};
  return [cell(refusal.name, 24), cell(refusal.extension, 20), cell(refusal.reason, 60)];
}
function rolesListCard(args, value) {
  const answer = isRecord3(value) ? value : {};
  const roles = arrayAt(answer, "roles");
  const refused = arrayAt(answer, "refused");
  const count = numberOf(answer.count) ?? roles.length;
  const children = [metric({ label: "roles", value: count })];
  if (roles.length > 0)
    children.push(table({ columns: ["name", "route", "access"], rows: roles.slice(0, 12).map(roleRow) }));
  if (refused.length > 0)
    children.push(table({ columns: ["name", "extension", "reason"], rows: refused.slice(0, 6).map(refusedRow) }));
  return stack(children, { title: "roster" });
}
function roleSpawnCard(args, value) {
  const answer = isRecord3(value) ? value : {};
  const role = words(answer.role, 40);
  if (role === undefined)
    return null;
  const status = words(answer.status, 20) ?? "complete";
  const evidence = arrayAt(answer, "evidence");
  const facts = [];
  if (words(answer.stopReason, 120) !== undefined)
    facts.push(["stop reason", words(answer.stopReason, 120) ?? ""]);
  if (evidence.length > 0)
    facts.push(["evidence", evidence.length]);
  const children = [
    metric({ label: "role", value: role }),
    metric({ label: "status", value: status, tone: status === "complete" ? "good" : "warn" })
  ];
  const summary = words(answer.summary, 700);
  if (summary !== undefined)
    children.push(text(summary));
  const recommendation = words(answer.recommendation, 300);
  if (recommendation !== undefined)
    children.push(text(recommendation));
  const details = words(answer.details, 900);
  if (details !== undefined)
    children.push(text(details));
  if (facts.length > 0)
    children.push(keyValue(facts));
  if (evidence.length > 0)
    children.push(table({ columns: ["evidence"], rows: evidence.slice(0, 8).map((item) => [cell(item, 80)]) }));
  return stack(children, { title: `role · ${role}` });
}

// packages/mpd-roles-plugin/src/spawn-async.ts
import { mkdirSync as mkdirSync2, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
var CONSULT_FORCE_AFTER_MS = 900000;
var CONSULT_TOOL_IN_FLIGHT_MAX_MS = 900000;
var CONSULT_MAX_DEFAULT = 8;
var CONSULT_WAIT_MAX_MS = 60000;
var CONSULT_WAIT_DEFAULT_MS = 30000;
var CONSULT_ACTIVITY_HISTORY = 5;
var CONSULT_MESSAGE_EXCERPT = 1200;
var CONSULT_LABEL_KEY_PREFIX = "label:";
function consultActivityKeyOf(agent, labelOf) {
  if (agent === null || typeof agent !== "object")
    return;
  const session = agent.session;
  if (typeof session?.id === "string" && session.id !== "")
    return session.id;
  const label = labelOf(agent);
  return typeof label === "string" && label !== "" ? CONSULT_LABEL_KEY_PREFIX + label : undefined;
}
function consultLabelKey(role) {
  return CONSULT_LABEL_KEY_PREFIX + role;
}
function consultMaxFromEnv() {
  const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_CONSULT_MAX : undefined;
  const parsed = typeof raw === "string" && raw.trim() !== "" ? Math.trunc(Number(raw)) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : CONSULT_MAX_DEFAULT;
}
function createConsultSupervisor(deps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => {
    clearTimeout(handle);
  });
  const forceAfterMs = deps.forceAfterMs ?? (() => CONSULT_FORCE_AFTER_MS);
  const toolInFlightMaxMs = deps.toolInFlightMaxMs ?? (() => CONSULT_TOOL_IN_FLIGHT_MAX_MS);
  const maxConcurrent = deps.maxConcurrent ?? (() => CONSULT_MAX_DEFAULT);
  const boundOf = () => {
    const configured = Math.trunc(Number(forceAfterMs()));
    return Number.isFinite(configured) ? configured : CONSULT_FORCE_AFTER_MS;
  };
  const inFlightBoundOf = () => {
    const configured = Math.trunc(Number(toolInFlightMaxMs()));
    return Number.isFinite(configured) ? Math.max(0, configured) : CONSULT_TOOL_IN_FLIGHT_MAX_MS;
  };
  const records = new Map;
  let active = 0;
  const queue = [];
  let sequence = 0;
  const acquire = () => {
    const cap = Math.max(1, Math.trunc(Number(maxConcurrent())) || CONSULT_MAX_DEFAULT);
    if (active < cap) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve3) => {
      queue.push(() => {
        active += 1;
        resolve3();
      });
    });
  };
  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next !== undefined)
      next();
  };
  const createRecord = (input) => {
    sequence += 1;
    const id = "consult-" + now().toString(36) + "-" + sequence.toString(36);
    let settle2 = () => {
      return;
    };
    let fail = () => {
      return;
    };
    const done = new Promise((resolve3, reject) => {
      settle2 = resolve3;
      fail = reject;
    });
    done.catch(() => {
      return;
    });
    return { id, role: input.role, task: input.task, exec: input.exec, state: "running", startedAt: now(), done, resolve: settle2, reject: fail, reported: false, released: false, held: false };
  };
  const reportFrom = (record, result) => {
    const structured = result.structured ?? {};
    return {
      role: record.role,
      status: "complete",
      summary: typeof structured.summary === "string" ? structured.summary : result.output,
      recommendation: typeof structured.recommendation === "string" ? structured.recommendation : "",
      details: typeof structured.details === "string" ? structured.details : "",
      evidence: Array.isArray(structured.evidence) ? structured.evidence.map((entry) => String(entry)) : [],
      stopReason: typeof result.stopReason === "string" ? result.stopReason : null,
      consultId: record.id,
      elapsedMs: now() - record.startedAt
    };
  };
  const finish = (record, report) => {
    if (record.reported)
      return;
    record.reported = true;
    record.report = report;
    record.state = report.status;
    if (record.handoff !== undefined)
      record.report = { ...report, handoff: record.handoff };
    if (record.timer !== undefined) {
      clearTimer(record.timer);
      record.timer = undefined;
    }
    if (record.held && !record.released) {
      record.released = true;
      release();
    }
    record.resolve(record.report);
  };
  const failRecord = (record, error) => {
    if (record.reported)
      return;
    record.reported = true;
    record.state = "failed";
    record.failure = error instanceof Error ? error.message : String(error);
    if (record.timer !== undefined) {
      clearTimer(record.timer);
      record.timer = undefined;
    }
    if (record.held && !record.released) {
      record.released = true;
      release();
    }
    record.reject(error);
  };
  const describeCall = (call) => {
    const args = call.arguments === undefined ? "" : JSON.stringify(call.arguments);
    return call.name + (args === "" ? "" : " " + (args.length > 400 ? args.slice(0, 400) + "…" : args));
  };
  const lastActivityOf = (activity) => {
    if (activity === undefined)
      return;
    const calls = [...activity.current === undefined ? [] : [activity.current], ...[...activity.history].reverse()];
    if (calls.length === 0)
      return;
    return calls.slice(0, CONSULT_ACTIVITY_HISTORY).map(describeCall).join(" | ");
  };
  const idleMsOf = (record, activity, at) => {
    const stamps = [record.startedAt];
    if (typeof activity?.lastActivityAt === "number" && Number.isFinite(activity.lastActivityAt))
      stamps.push(activity.lastActivityAt);
    if (typeof activity?.current?.startedAt === "number" && Number.isFinite(activity.current.startedAt))
      stamps.push(activity.current.startedAt);
    for (const call of activity?.history ?? []) {
      if (typeof call.startedAt === "number" && Number.isFinite(call.startedAt))
        stamps.push(call.startedAt);
    }
    return Math.max(0, at - Math.max(...stamps));
  };
  const writeHandoff = (record, activity, boundMs, idleMs) => {
    try {
      const dir = deps.handoffDir(record.exec);
      mkdirSync2(dir, { recursive: true });
      const instant = new Date(now()).toISOString().replace(/[:.]/g, "-");
      const path = join3(dir, "consult-" + record.id + "-" + instant + ".md");
      const calls = activity === undefined ? [] : activity.history;
      const open = activity?.current;
      const openAgeMs = open === undefined ? 0 : Math.max(0, now() - open.startedAt);
      const message = activity?.lastAssistantMessage;
      const messageLine = message === undefined || message === "" ? "- last assistant message: (none observed)" : "- last assistant message: " + (message.length > CONSULT_MESSAGE_EXCERPT ? message.slice(0, CONSULT_MESSAGE_EXCERPT) + "…" : message).replace(/\s+/g, " ");
      const lines = [
        "# Consult handoff — " + record.id,
        "",
        "- task: " + record.task,
        "- role: " + record.role,
        "- started: " + new Date(record.startedAt).toISOString(),
        "- elapsed: " + (now() - record.startedAt) + " ms (deadman bound " + boundMs + " ms)",
        "- idle: " + idleMs + " ms with no observable activity" + (open === undefined ? "" : "; the open " + open.name + " call had run " + openAgeMs + " ms"),
        messageLine,
        "- last tool calls:",
        ...open === undefined ? [] : ["  - (IN FLIGHT) " + describeCall(open)],
        ...calls.length === 0 && open === undefined ? ["  - (none observed)"] : [],
        ...calls.map((call) => "  - " + describeCall(call)),
        "",
        "Next step: resume the task above from the last completed tool call. The child was interrupted",
        "by the consult deadman after " + idleMs + " ms with no observable activity (bound " + boundMs + " ms" + (open === undefined ? "" : ", and its open " + open.name + " call had run " + openAgeMs + " ms and no longer counted as activity") + ").",
        ""
      ];
      writeFileSync(path, lines.join(`
`), "utf8");
      return path;
    } catch (error) {
      deps.log("consult handoff could not be written for " + record.id + ": " + (error instanceof Error ? error.message : String(error)));
      return;
    }
  };
  const onDeadman = (record) => {
    if (record.reported)
      return;
    const activity = deps.activityOf?.(record.handle?.id, record.role);
    const at = now();
    const elapsedMs = at - record.startedAt;
    const boundMs = boundOf();
    if (boundMs <= 0)
      return;
    const armBoundMs = record.armBoundMs ?? boundMs;
    const open = activity?.current;
    if (open?.name === "bash") {
      if (record.longBashLogged !== true) {
        record.longBashLogged = true;
        deps.log("consult-long-bash " + record.id + " role=" + record.role + " elapsedMs=" + elapsedMs + " — an OPEN bash call is exempt from the consult deadman; re-armed");
      }
      arm(record);
      return;
    }
    let hung = false;
    if (open !== undefined) {
      const inFlightMs = inFlightBoundOf();
      const openAgeMs = Math.max(0, at - open.startedAt);
      if (inFlightMs > 0 && openAgeMs < inFlightMs) {
        if (record.inFlightLoggedFor !== open.startedAt) {
          record.inFlightLoggedFor = open.startedAt;
          deps.log("consult-tool-in-flight " + record.id + " role=" + record.role + " tool=" + open.name + " ageMs=" + openAgeMs + " boundMs=" + inFlightMs + " — the open call is activity; re-armed");
        }
        arm(record);
        return;
      }
      hung = inFlightMs > 0;
    }
    const idleMs = idleMsOf(record, activity, at);
    if (!hung && idleMs < armBoundMs) {
      const remainingMs = armBoundMs - idleMs;
      arm(record, remainingMs);
      return;
    }
    const handoff = writeHandoff(record, activity, armBoundMs, idleMs);
    if (handoff !== undefined)
      record.handoff = handoff;
    record.state = "interrupted";
    try {
      record.handle?.interrupt();
    } catch {}
    const report = {
      role: record.role,
      status: "interrupted",
      summary: "consult interrupted by the consult deadman after " + idleMs + " ms with no observable activity (bound " + armBoundMs + " ms)" + (handoff === undefined ? "" : " — handoff: " + handoff),
      recommendation: "",
      details: "",
      evidence: handoff === undefined ? [] : [handoff],
      stopReason: "interrupted",
      consultId: record.id,
      elapsedMs,
      ...handoff === undefined ? {} : { handoff },
      ...lastActivityOf(activity) === undefined ? {} : { lastActivity: lastActivityOf(activity) }
    };
    finish(record, report);
  };
  const arm = (record, delayMs) => {
    if (record.reported)
      return;
    const bound = boundOf();
    if (bound <= 0)
      return;
    const waitMs = delayMs === undefined ? bound : Math.max(1, Math.min(bound, Math.trunc(delayMs)));
    record.armBoundMs = bound;
    record.timer = setTimer(() => {
      try {
        onDeadman(record);
      } catch (error) {
        deps.log("consult deadman threw for " + record.id + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }, waitMs);
  };
  const viewOf = (record) => ({
    consultId: record.id,
    role: record.role,
    state: record.state,
    startedAt: record.startedAt,
    elapsedMs: now() - record.startedAt,
    ...record.handoff === undefined ? {} : { handoff: record.handoff }
  });
  const requireRecord = (consultId) => {
    const record = records.get(consultId);
    if (record === undefined)
      throw new Error('mpd_role_consult: unknown consultId "' + consultId + '" — use action list');
    return record;
  };
  const start = (input) => {
    const record = createRecord(input);
    records.set(record.id, record);
    (async () => {
      await acquire();
      record.held = true;
      if (record.reported) {
        if (!record.released) {
          record.released = true;
          release();
        }
        return;
      }
      try {
        const handle = await input.raise();
        record.handle = handle;
        if (record.reported) {
          try {
            handle.interrupt();
          } catch {}
          return;
        }
        arm(record);
        handle.result.then((result) => {
          finish(record, reportFrom(record, result));
        }, (error) => {
          failRecord(record, error);
        });
      } catch (error) {
        failRecord(record, error);
      }
    })();
    return viewOf(record);
  };
  const settle = async (consultId) => {
    const record = requireRecord(consultId);
    return await record.done;
  };
  const wait = async (consultId, timeoutMs) => {
    const record = requireRecord(consultId);
    if (record.reported)
      return record.report ?? { ...viewOf(record), ...record.failure === undefined ? {} : { error: record.failure } };
    const bound = Math.min(CONSULT_WAIT_MAX_MS, Math.max(1, Math.trunc(Number(timeoutMs)) || CONSULT_WAIT_DEFAULT_MS));
    return await new Promise((resolve3) => {
      let timer;
      const timedOut = () => {
        if (timer !== undefined)
          clearTimer(timer);
        resolve3(viewOf(record));
      };
      timer = setTimer(timedOut, bound);
      record.done.then((report) => {
        if (timer !== undefined)
          clearTimer(timer);
        resolve3(report);
      }, () => {
        if (timer !== undefined)
          clearTimer(timer);
        resolve3({ ...viewOf(record), ...record.failure === undefined ? {} : { error: record.failure } });
      });
    });
  };
  const collect = (consultId) => {
    const record = requireRecord(consultId);
    if (!record.reported)
      return viewOf(record);
    const report = record.report;
    records.delete(consultId);
    return { ...viewOf(record), ...report === undefined ? {} : { report }, ...record.failure === undefined ? {} : { error: record.failure } };
  };
  const cancel = (consultId) => {
    const record = requireRecord(consultId);
    if (record.reported)
      return { ...viewOf(record), ...record.report === undefined ? {} : { report: record.report } };
    record.state = "interrupted";
    if (record.timer !== undefined) {
      clearTimer(record.timer);
      record.timer = undefined;
    }
    try {
      record.handle?.interrupt();
    } catch {}
    const report = {
      role: record.role,
      status: "interrupted",
      summary: "consult cancelled by the caller",
      recommendation: "",
      details: "",
      evidence: [],
      stopReason: "interrupted",
      consultId: record.id,
      elapsedMs: now() - record.startedAt
    };
    finish(record, report);
    return { ...viewOf(record), report };
  };
  const list = () => [...records.values()].map(viewOf);
  return { start, settle, wait, collect, cancel, list };
}

// packages/mpd-roles-plugin/src/index.ts
var name = "mpd-roles";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS);
var CONSULT_FORCE_KEY = "consult.forceAfterMs";
var WATCHDOG_FORCE_KEY = "watchdog.forceAfterMs";
var WATCHDOG_TOOL_IN_FLIGHT_KEY = "watchdog.toolInFlightMaxMs";
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
function withdrawnReason(knob) {
  return "withdrawn:2026-10-17-user-ruling(" + knob + ")";
}
var REPORT_SCHEMA = {
  type: "object",
  properties: {
    role: { type: "string" },
    summary: { type: "string" },
    recommendation: { type: "string" },
    details: { type: "string" },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["role", "summary"],
  additionalProperties: false
};
function pkgRoot() {
  return bundleRootOf(import.meta.url);
}
function normalizeRoleNameKey(name2) {
  return String(name2 ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
var ROLE_ID_BY_NAME_KEY = Object.fromEntries(ROLES.map((r) => [normalizeRoleNameKey(r.name), r.id]));
function rosterNameList() {
  return ROLES.map((r) => r.name).join(", ");
}
function rosterFunctionList() {
  return ROLES.map((r) => r.name + " (" + functionOf2(r.description) + ")").join(", ");
}
function functionOf2(description) {
  const afterColon = description.includes(": ") ? description.slice(description.indexOf(": ") + 2) : description;
  return afterColon.replace(/\s*\(([^()]*)\)/g, ", $1").replace(/\.+\s*$/, "").replace(/,\s*,/g, ",").trim();
}
function normalizeRoleKey(key) {
  const k = String(key ?? "").trim();
  if (!k)
    return null;
  if (ROLE_BY_ID[k])
    return k;
  if (k.startsWith("mpd-") && ROLE_BY_ID[k.slice(4)])
    return k.slice(4);
  if (k === "sisyphusJunior")
    return "sisyphus-junior";
  if (k === "multimodalLooker")
    return "multimodal-looker";
  return ROLE_ID_BY_NAME_KEY[normalizeRoleNameKey(k)] ?? null;
}
function roleOfToolInput(surface, key) {
  const nameKey = normalizeRoleNameKey(key);
  if (nameKey === "")
    return null;
  const base = surface.roles.find((role) => role.extension === null && normalizeRoleNameKey(role.name) === nameKey);
  if (base)
    return base;
  const raw = String(key ?? "").trim();
  return surface.roles.find((role) => role.extension !== null && (role.id === raw || normalizeRoleNameKey(role.name) === nameKey)) ?? null;
}
function personaPath(config, spec) {
  return config.personasDir ? join4(resolve3(config.personasDir), spec.id + ".md") : join4(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md");
}
function readPersona(config, spec) {
  const p = personaPath(config, spec);
  try {
    if (existsSync(p)) {
      const t = readFileSync(p, "utf8").trim();
      if (t)
        return t;
    }
  } catch {}
  return spec.description;
}
var EXTENSIONS_SERVICE = "mpdExtensions";
var CONFIG_SERVICE = "mpdConfig";
var TEAMS_SERVICE = "mpdTeams";
function stagedPlanProbe(ctx) {
  return (workspace, sessionId) => {
    const teams = ctx.get?.(TEAMS_SERVICE, false);
    if (teams === undefined || teams === null || typeof teams.planFor !== "function") {
      throw new Error("the " + TEAMS_SERVICE + " service is not mounted, so the staged-plan probe cannot answer");
    }
    return teams.planFor(workspace, sessionId)?.plan ?? null;
  };
}
var PROJECT_ONLY_PLANE = "project";
var PROJECT_ROLES_REASON = "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session";
function text2(value) {
  return typeof value === "string" ? value : "";
}
function errText(error) {
  return error instanceof Error ? error.message : String(error);
}
function sessionIdOf3(value) {
  if (value === null || typeof value !== "object")
    return;
  const direct = value.id;
  if (typeof direct === "string" && direct !== "")
    return direct;
  const nested = value.session;
  if (nested !== null && typeof nested === "object") {
    const id = nested.id;
    if (typeof id === "string" && id !== "")
      return id;
  }
  return;
}
function extensionRoleId(extensionId, name2) {
  const slug = String(name2).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "ext-" + extensionId + "-" + (slug || "role");
}
function readExtensionPersona(root, file) {
  if (!root || !file)
    return null;
  try {
    const path = resolve3(root, file);
    if (existsSync(path)) {
      const body = readFileSync(path, "utf8").trim();
      if (body)
        return body;
    }
  } catch {}
  return null;
}
function extensionRoles(ctx, exec, warn) {
  const roles = [];
  const refused = [];
  const owner = new Map;
  for (const role of ROLES)
    owner.set(normalizeRoleNameKey(role.name), "the base roster");
  let service;
  try {
    service = typeof ctx?.get === "function" ? ctx.get(EXTENSIONS_SERVICE) : undefined;
  } catch (error) {
    warn('ctx.get("' + EXTENSIONS_SERVICE + '") failed (' + errText(error) + ") — the roster stays base-only for this call");
    return { roles, refused };
  }
  if (service === undefined || service === null || typeof service.list !== "function")
    return { roles, refused };
  let views;
  try {
    const snapshot = service.list({ exec });
    views = Array.isArray(snapshot?.extensions) ? snapshot.extensions : [];
  } catch (error) {
    warn("mpdExtensions.list() failed (" + errText(error) + ") — the roster stays base-only for this call");
    return { roles, refused };
  }
  for (const view of views) {
    const extensionId = text2(view?.id);
    if (extensionId === "")
      continue;
    if (view?.enabled === false)
      continue;
    const declared = view?.descriptor?.contributes?.roles;
    if (!Array.isArray(declared))
      continue;
    if (view?.plane === PROJECT_ONLY_PLANE) {
      for (const item of declared) {
        const name2 = text2(item?.name).trim();
        if (name2 === "")
          continue;
        refused.push({ extension: extensionId, name: name2, reason: PROJECT_ROLES_REASON });
      }
      continue;
    }
    const root = text2(view?.root);
    declared.forEach((item, index) => {
      const name2 = text2(item?.name).trim();
      if (name2 === "")
        return;
      const refuse2 = (reason) => {
        refused.push({ extension: extensionId, name: name2, reason });
      };
      const itemLabel = "contributes.roles[" + index + "]";
      const key = normalizeRoleNameKey(name2);
      const takenBy = owner.get(key);
      if (takenBy !== undefined) {
        refuse2('role name "' + name2 + '" (' + itemLabel + ' of extension "' + extensionId + '") is already taken by ' + takenBy + " — this extension role is not exposed");
        return;
      }
      const id = extensionRoleId(extensionId, name2);
      if (ROLE_BY_ID[id] !== undefined) {
        refuse2('role id "' + id + '" collides with the base roster — this extension role is not exposed');
        return;
      }
      const personaFile = root === "" ? text2(item?.persona) : resolve3(root, text2(item?.persona));
      const persona = readExtensionPersona(root, text2(item?.persona));
      if (persona === null) {
        refuse2("persona file is not readable: " + personaFile);
        return;
      }
      const chain = typeof item?.provider === "string" && typeof item?.model === "string" ? [{ provider: item.provider, model: item.model }] : [];
      owner.set(key, 'extension "' + extensionId + '"');
      roles.push({
        id,
        name: name2,
        description: text2(item?.description),
        readonly: item?.readonly === true,
        chain,
        persona,
        personaFile,
        extension: extensionId
      });
    });
  }
  return { roles, refused };
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
function apply(ctx, config = {}) {
  const warn = (line) => {
    const message = "[mpd-roles] " + line;
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(message);
      else
        rowLogLine("mpd-roles", message);
    } catch {}
  };
  const adapterWarn = (line) => {
    const message = "[mpd-roles] " + line;
    try {
      rowLogLine("mpd-roles", message);
      if (ctx?.logger && typeof ctx.logger.warn === "function")
        ctx.logger.warn(message);
    } catch {}
  };
  const dsh = createLazyDshAdapter(ctx, { label: "mpd-roles", warn: adapterWarn });
  const warned = new Set;
  const warnOnce = (key, line) => {
    if (warned.has(key))
      return;
    warned.add(key);
    warn(line);
  };
  const validatedReadonlyDeny = (agent) => {
    const scope = dsh.agentScope(agent);
    if (scope === undefined) {
      warnOnce("readonly-deny:no-scope", "read-only spawn: this agent exposes no scoped context, so the canonical deny list is returned unvalidated");
      return [...READONLY_DENY];
    }
    const outcome = restrictToolsTolerant((names) => scope.tools.restrict({ deny: names }), READONLY_DENY);
    if (outcome.pruned.length > 0) {
      warnOnce("readonly-deny:pruned", "read-only spawn: pruned tool name(s) this profile does not register: " + outcome.pruned.join(", "));
    }
    return [...outcome.applied];
  };
  const agentRouteResolution = (member) => {
    const live = (() => {
      try {
        return ctx.get?.(CONFIG_SERVICE, false);
      } catch {
        return;
      }
    })();
    if (typeof live?.agentRouteResolutionOf === "function") {
      const value = live.agentRouteResolutionOf(member);
      if (value !== undefined && value !== null && typeof value === "object" && typeof value.ok === "boolean")
        return value;
    }
    if (ROLES.some((r) => r.name === member)) {
      return {
        ok: false,
        reason: "unconfigured",
        agent: member,
        missing: ["agentRoutes." + member + ".provider", "agentRoutes." + member + ".model"]
      };
    }
    return { ok: false, reason: "unrouted" };
  };
  const throwAgentUnconfigured = (resolution) => {
    const detail = resolution.reason === "invalid" ? resolution.problem + " must be a string" : "missing " + resolution.missing.join(", ");
    throw agentUnconfiguredRefusal(resolution.agent, detail);
  };
  const roleSurface = (exec) => {
    const base = ROLES.map((r) => {
      const chain = r.chain.map((c) => ({ ...c }));
      const resolution = agentRouteResolution(r.name);
      if (resolution.ok)
        chain.splice(0, chain.length, { provider: resolution.route.provider, model: resolution.route.model });
      else if (resolution.reason !== "unrouted")
        chain.splice(0, chain.length);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        readonly: r.readonly,
        chain,
        persona: readPersona(config, r),
        personaFile: personaPath(config, r),
        extension: null
      };
    });
    const contributed = extensionRoles(ctx, exec, (line) => warnOnce("lookup:" + line, line));
    for (const refusal of contributed.refused) {
      warnOnce("refused:" + refusal.extension + ":" + refusal.name, 'extension role refused: "' + refusal.name + '" (' + refusal.extension + ") — " + refusal.reason);
    }
    return { roles: [...base, ...contributed.roles], refused: contributed.refused };
  };
  const roleOf = (surface, key) => {
    const id = normalizeRoleKey(key);
    if (id) {
      const found = surface.roles.find((role) => role.extension === null && role.id === id);
      if (found)
        return found;
    }
    const raw = String(key ?? "").trim();
    if (raw === "")
      return null;
    const namespaced = surface.roles.find((role) => role.extension !== null && role.id === raw);
    if (namespaced)
      return namespaced;
    const nameKey = normalizeRoleNameKey(raw);
    return surface.roles.find((role) => role.extension !== null && normalizeRoleNameKey(role.name) === nameKey) ?? null;
  };
  const roleNameListOf = (surface) => surface.roles.map((role) => role.name).join(", ");
  const applyChildReadonlyDeny = (agent) => {
    try {
      const outcome = dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY, ...LEAF_SPAWN_DENY]);
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: applied " + outcome.applied.length + " denials (+ the leaf spawn boundary) to its own tool scope" + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"));
    } catch (error) {
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: the deny could NOT be applied (" + String(error?.message ?? error) + ") — this member may be able to write and to delegate");
    }
  };
  const applyChildLeafDeny = (agent) => {
    try {
      const outcome = dsh.restrictAgentToolsRetained(agent, [...LEAF_SPAWN_DENY]);
      rowLogLine("mpd-roles", "[mpd-roles] child leaf boundary: applied " + outcome.applied.length + " spawn denials to its own tool scope" + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"));
    } catch (error) {
      rowLogLine("mpd-roles", "[mpd-roles] child leaf boundary: the deny could NOT be applied (" + String(error?.message ?? error) + ") — this child may be able to delegate further");
    }
  };
  installChildPersonaSeam(dsh, {
    resolve: (label) => {
      const spec = roleOf(roleSurface(undefined), label);
      return spec === null ? null : { persona: spec.persona, readonly: spec.readonly };
    },
    restrictReadonly: (agent) => {
      applyChildReadonlyDeny(agent);
    },
    warn: (line) => warnOnce("child-persona:" + line, line),
    onEvent: typeof dsh.onEvent === "function" ? dsh.onEvent : undefined
  });
  if (typeof dsh.onEvent === "function") {
    dsh.onEvent("agent/created", (payload) => {
      try {
        const agent = payload?.agent ?? payload;
        const label = dsh.subagentLabelOf(agent);
        if (label === undefined)
          return;
        const spec = roleOf(roleSurface(undefined), label);
        if (spec === null || spec.readonly)
          return;
        applyChildLeafDeny(agent);
      } catch (error) {
        rowLogLine("mpd-roles", "[mpd-roles] child leaf boundary: a child could not be identified, so its spawn tools were left open (" + String(error?.message ?? error) + ")");
      }
    });
  }
  ctx.provide("mpdRoles", {
    adapterIdentity: dshAdapterIdentity(ctx),
    list: () => roleSurface(undefined).roles.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: r.persona, extension: r.extension })),
    get: (key) => {
      const spec = roleOf(roleSurface(undefined), key);
      return spec === null ? null : { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: spec.persona, extension: spec.extension };
    }
  });
  const toolActivity = new Map;
  const activityKey = (exec) => consultActivityKeyOf(exec?.agent, (agent) => dsh.subagentLabelOf(agent));
  const noteToolStart = (exec) => {
    const key = activityKey(exec);
    if (key === undefined)
      return;
    const name2 = typeof exec?.name === "string" ? String(exec.name) : "tool";
    const rawArgs = exec?.arguments;
    const bucket = toolActivity.get(key) ?? { history: [] };
    const at = Date.now();
    bucket.current = { name: name2, startedAt: at, ...rawArgs !== null && typeof rawArgs === "object" ? { arguments: rawArgs } : {} };
    bucket.lastActivityAt = at;
    toolActivity.set(key, bucket);
  };
  const noteToolEnd = (exec) => {
    const key = activityKey(exec);
    if (key === undefined)
      return;
    const bucket = toolActivity.get(key);
    if (bucket?.current === undefined)
      return;
    bucket.history.push(bucket.current);
    if (bucket.history.length > CONSULT_ACTIVITY_HISTORY)
      bucket.history.splice(0, bucket.history.length - CONSULT_ACTIVITY_HISTORY);
    bucket.current = undefined;
    bucket.lastActivityAt = Date.now();
  };
  if (typeof dsh.onPreToolExecute === "function") {
    dsh.onPreToolExecute((exec) => {
      try {
        noteToolStart(exec);
      } catch {}
    });
  }
  if (typeof dsh.onPostToolExecute === "function") {
    dsh.onPostToolExecute((exec) => {
      try {
        noteToolEnd(exec);
      } catch {}
    });
  }
  if (typeof dsh.onEvent === "function") {
    dsh.onEvent("session/event", (session, event) => {
      try {
        const record = event !== null && typeof event === "object" ? event : undefined;
        if (record?.type !== "assistant/message")
          return;
        const id = sessionIdOf3(session);
        if (id === undefined)
          return;
        const bucket = toolActivity.get(id);
        if (bucket === undefined)
          return;
        const data = record.data !== null && typeof record.data === "object" ? record.data : undefined;
        const message = typeof data?.text === "string" ? data.text : typeof record.text === "string" ? record.text : undefined;
        if (message !== undefined && message !== "")
          bucket.lastAssistantMessage = message;
        bucket.lastActivityAt = Date.now();
      } catch {}
    });
  }
  const consultSupervisor = createConsultSupervisor({
    handoffDir: (target) => join4(dsh.workspaceRoot(target), ".mpd", "handoff"),
    log: (line) => warn(line),
    activityOf: (childId, role) => childId === undefined || childId === "" ? toolActivity.get(consultLabelKey(role)) : toolActivity.get(childId),
    maxConcurrent: () => consultMaxFromEnv(),
    forceAfterMs: () => consultDeadmanBound(),
    toolInFlightMaxMs: () => consultInFlightBound()
  });
  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster — the SAME normal-named specialists team mode stages as teammates, each named for what it does: " + rosterFunctionList() + ". Address a role by that name (any case, space or hyphen spelling). Use this before mpd_role_spawn; for team work stage the roster with `agent_teams_plan` (add_member with the persona text from mpd_role_persona → create_task with its dependency answer → approve) instead of repeated single-call consults.",
    parameters: { type: "object", properties: {} },
    output: { presentationMeta: toolCard(rolesListCard), schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" }, refused: { type: "array", items: { type: "object", properties: { extension: { type: "string" }, name: { type: "string" }, reason: { type: "string" } }, required: ["extension", "name", "reason"] } } }, required: ["roles", "count"] }, render: (_a, v) => textBlock("roster (" + v.count + `):
` + v.roles.map((r) => "- " + r.name + " [" + r.model + (r.readonly ? " readonly" : "") + (r.extension ? " extension:" + r.extension : "") + "] — " + r.description).join(`
`) + (Array.isArray(v.refused) && v.refused.length > 0 ? `
refused (` + v.refused.length + `):
` + v.refused.map((r) => "- " + r.name + " (" + r.extension + ") — " + r.reason).join(`
`) : "")) },
    execute: async (_args, exec) => {
      const surface = roleSurface(exec);
      const roles = surface.roles.map((r) => ({ name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null, extension: r.extension }));
      return { roles, count: roles.length, refused: surface.refused.map((r) => ({ extension: r.extension, name: r.name, reason: r.reason })) };
    }
  });
  dsh.registerTool({
    name: "mpd_role_spawn",
    description: "Run ONE bounded delegation with a specialist and return one report — a ONE-SHOT single-call consult: the adapter disposes the activation once the report settles, so the consult is NOT reused — ask a new question with a NEW spawn (the harness catalog is append-only, so a settled child may still list as `inactive`, but the contract is one-shot). It carries the role's persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each named for what it does: " + rosterFunctionList() + ". The child is labelled with that name. `mpd_workmate_spawn` is the same spawn mechanics for a durable, evolving instance (its persona/memory/note — not the child session — carry continuity). For multi-member team work prefer the mpd team path (`agent_teams_plan`: add_member → create_task with its dependency answer → approve; drive with `agent_teams_task`/`agent_teams_dispatch`) instead of repeated single-call consults: THIS path applies the role's own `agentRoutes` entry, and a teammate staged through `agent_teams_plan` is routed the same way by the team executor — its `role` first, then its `description` head; only an UNMATCHED member inherits the staging session's route. A CONSULT IS A LEAF (CR repair E): the child this tool raises has BOTH bundle spawn tools denied in its own scope, so it cannot delegate again, and a caller already at delegation depth 2 or deeper is refused outright — a depth-1 caller (the cell planner) may still raise its one consult.",
    parameters: { type: "object", properties: { role: { type: "string", description: 'role name (see mpd_roles_list), e.g. "Architect" or "Deep Worker"' }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" } }, required: ["role", "task"], additionalProperties: false },
    output: { presentationMeta: toolCard(roleSpawnCard), schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete", "interrupted"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" }, consultId: { type: "string" }, handoff: { type: "string" }, lastActivity: { type: "string" }, elapsedMs: { type: "integer" } }, required: ["role", "status", "summary"] }, render: (_a, v) => textBlock("role " + v.role + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "") + (v.evidence?.length ? `
evidence:
- ` + v.evidence.join(`
- `) : "") + (v.handoff ? `
handoff: ` + v.handoff : "") + (v.lastActivity ? `
last activity: ` + v.lastActivity : "")) },
    execute: async (args, exec) => {
      const tooDeep = consultDepthRefusal(exec?.agent);
      if (tooDeep !== undefined)
        throw new Error(tooDeep);
      const surface = roleSurface(exec);
      const spec = roleOfToolInput(surface, String(args?.role ?? ""));
      if (spec === null)
        throw new Error("mpd_role_spawn: unknown role — use a roster NAME (see mpd_roles_list): " + roleNameListOf(surface));
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_role_spawn: task required");
      const persona = spec.persona;
      const resolution = agentRouteResolution(spec.name);
      if (!resolution.ok && resolution.reason !== "unrouted")
        throwAgentUnconfigured(resolution);
      const primary = resolution.ok ? resolution.route : spec.chain[0] === undefined ? undefined : { provider: spec.chain[0].provider, model: spec.chain[0].model };
      if (primary === undefined) {
        throw new Error("mpd_role_spawn: " + spec.name + " has no configured route — an extension role must declare provider+model, and a roster agent needs its agentRoutes entry configured (/mpd-model)");
      }
      const run = await resolveRunRoute(dsh, primary, resolution.ok ? resolution.route.fallbacks ?? [] : []);
      const provider = run.route.provider;
      const model = run.route.model;
      const prompt = persona + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence).`;
      const view = consultSupervisor.start({
        role: spec.name,
        task,
        exec,
        raise: () => dsh.spawnAgentAsync({
          label: spec.name,
          prompt,
          parent: exec.agent,
          signal: exec.signal,
          provider,
          model,
          persona,
          outputSchema: REPORT_SCHEMA,
          maxDepth: spawnMaxDepthOf(exec.agent),
          ...run.route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: run.route.reasoningEffort } },
          ...spec.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {}
        })
      });
      try {
        return await consultSupervisor.settle(view.consultId);
      } finally {
        try {
          consultSupervisor.collect(view.consultId);
        } catch {}
      }
    }
  });
  async function raiseConsultAsync(args, exec) {
    const surface = roleSurface(exec);
    const spec = roleOfToolInput(surface, String(args?.role ?? ""));
    if (spec === null)
      throw new Error("mpd_role_spawn_async: unknown role — use a roster NAME (see mpd_roles_list): " + roleNameListOf(surface));
    const task = String(args?.task ?? "").trim();
    if (!task)
      throw new Error("mpd_role_spawn_async: task required");
    const resolution = agentRouteResolution(spec.name);
    if (!resolution.ok && resolution.reason !== "unrouted")
      throwAgentUnconfigured(resolution);
    const primary = resolution.ok ? resolution.route : spec.chain[0] === undefined ? undefined : { provider: spec.chain[0].provider, model: spec.chain[0].model };
    if (primary === undefined) {
      throw new Error("mpd_role_spawn_async: " + spec.name + " has no configured route — an extension role must declare provider+model, and a roster agent needs its agentRoutes entry configured (/mpd-model)");
    }
    const run = await resolveRunRoute(dsh, primary, resolution.ok ? resolution.route.fallbacks ?? [] : []);
    const prompt = spec.persona + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence).`;
    return dsh.spawnAgentAsync({
      label: spec.name,
      prompt,
      parent: exec.agent,
      signal: exec.signal,
      provider: run.route.provider,
      model: run.route.model,
      persona: spec.persona,
      outputSchema: REPORT_SCHEMA,
      maxDepth: spawnMaxDepthOf(exec.agent),
      ...run.route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: run.route.reasoningEffort } },
      ...spec.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {}
    });
  }
  dsh.registerTool({
    name: "mpd_role_spawn_async",
    description: "Start ONE bounded delegation WITHOUT waiting for its report — the BACKGROUND form of mpd_role_spawn. It returns a stable consultId immediately (peak in-flight consults overlap, so several questions run at once), rides the SAME adapter activation seam and read-only discipline as the blocking tool, and carries the SAME SILENCE deadman: the bound resolves per arm from `consult.forceAfterMs` → `watchdog.forceAfterMs` → 900000 ms (a declared `0` disables it), and a child with no observable activity for that long is interrupted with a handoff document written under .mpd/handoff/. Any in-flight tool younger than `watchdog.toolInFlightMaxMs` counts as activity, and an OPEN `bash` call is exempt at any age. Read the result with mpd_role_consult (wait / collect); a consult is still a ONE-SHOT and a LEAF. Concurrency is capped by MPD_DSH_CONSULT_MAX (default 8): over the cap a consult QUEUES, it never throws.",
    parameters: { type: "object", properties: { role: { type: "string", description: 'role name (see mpd_roles_list), e.g. "Architect" or "Deep Worker"' }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { consultId: { type: "string" }, role: { type: "string" }, state: { type: "string", enum: ["running"] }, startedAt: { type: "integer" } }, required: ["consultId", "role", "state"] }, render: (_a, v) => textBlock("consult " + v.consultId + " (" + v.role + ") " + v.state + ' — read it with mpd_role_consult {action:"wait"|"collect", consultId:"' + v.consultId + '"}') },
    execute: async (args, exec) => {
      const tooDeep = consultDepthRefusal(exec?.agent);
      if (tooDeep !== undefined)
        throw new Error(tooDeep);
      const view = consultSupervisor.start({ role: String(args?.role ?? ""), task: String(args?.task ?? ""), ...args?.context === undefined ? {} : { context: String(args.context) }, exec, raise: () => raiseConsultAsync(args, exec) });
      return { consultId: view.consultId, role: view.role, state: "running", startedAt: view.startedAt };
    }
  });
  dsh.registerTool({
    name: "mpd_role_consult",
    description: 'Read, wait for, collect or CANCEL one background consult started by mpd_role_spawn_async. `list` returns every consult this process knows (id, role, state, startedAt, elapsedMs); `wait` blocks up to timeoutMs (<= 60000) and returns the report when settled or state:"running" with elapsed when not; `collect` returns the settled report and RELEASES the record; `cancel` interrupts that consult\'s child (and is therefore a mutation, which is why read-only members are denied this tool). `mpd_role_spawn` (blocking) consults are listed here WHILE they run; their own caller releases the settled record.',
    parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "wait", "collect", "cancel"] }, consultId: { type: "string", description: "the id mpd_role_spawn_async returned (required except for list)" }, timeoutMs: { type: "integer", minimum: 1, maximum: 60000, description: "wait bound in ms (default 30000, clamped to 60000)" } }, required: ["action"], additionalProperties: false },
    output: { schema: { type: "object", properties: { action: { type: "string" }, consults: { type: "array", items: { type: "object" } }, consultId: { type: "string" }, role: { type: "string" }, state: { type: "string" }, startedAt: { type: "integer" }, elapsedMs: { type: "integer" }, report: { type: "object" }, error: { type: "string" } }, required: ["action"] }, render: (_a, v) => textBlock("consult " + v.action + (Array.isArray(v.consults) ? " (" + v.consults.length + `):
` + v.consults.map((c) => "- " + c.consultId + " [" + c.role + "] " + c.state + " " + c.elapsedMs + "ms").join(`
`) : "") + (v.report ? `
report (` + v.report.status + "): " + v.report.summary + (v.report.handoff ? `
handoff: ` + v.report.handoff : "") : "") + (v.error ? `
error: ` + v.error : "") + (!Array.isArray(v.consults) && !v.report ? `
state: ` + v.state + " elapsed: " + v.elapsedMs + "ms" : "")) },
    execute: async (args, _exec) => {
      const action = String(args?.action ?? "").trim();
      if (action === "list")
        return { action, consults: consultSupervisor.list() };
      const consultId = String(args?.consultId ?? "").trim();
      if (consultId === "")
        throw new Error('mpd_role_consult: consultId required for action "' + action + '"');
      if (action === "wait") {
        const timeoutMs = Number(args?.timeoutMs ?? 30000);
        return { action, ...await consultSupervisor.wait(consultId, timeoutMs) };
      }
      if (action === "collect")
        return { action, ...consultSupervisor.collect(consultId) };
      if (action === "cancel")
        return { action, ...consultSupervisor.cancel(consultId) };
      throw new Error("mpd_role_consult: action must be list | wait | collect | cancel");
    }
  });
  dsh.registerTool({
    name: "mpd_role_persona",
    description: 'Return the full persona text of one roster role, addressed by its name ("Architect", "Deep Worker", "Plan Reviewer"). Use it when a spawn surface takes the persona as TEXT — e.g. the prompt of a teammate staged with `agent_teams_plan` add_member whose name is that same name — so the member gets the real role instructions instead of a bare label.',
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a, v) => textBlock("persona " + v.role + " (" + v.chars + ` chars):
` + v.persona) },
    execute: async (args, exec) => {
      const surface = roleSurface(exec);
      const spec = roleOfToolInput(surface, String(args?.role ?? ""));
      if (spec === null)
        throw new Error("mpd_role_persona: unknown role — use a roster NAME (see mpd_roles_list): " + roleNameListOf(surface));
      return { role: spec.name, persona: spec.persona, chars: spec.persona.length };
    }
  });
  const teamMembers = () => ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }));
  const configValue = (key) => {
    const live = (() => {
      try {
        return ctx.get?.(CONFIG_SERVICE, false);
      } catch {
        return;
      }
    })();
    const value = (() => {
      try {
        return live?.get?.(key);
      } catch {
        return;
      }
    })();
    if (value !== undefined)
      return value;
    if (key === GATE_CONFIG_KEY)
      return config.team?.gate;
    if (key === SENSITIVITY_CONFIG_KEY)
      return config.team?.sensitivity;
    if (key === RETEAM_ENABLED_CONFIG_KEY)
      return config.team?.reteam?.enabled;
    if (key === RETEAM_AFTER_CONSULTS_CONFIG_KEY)
      return config.team?.reteam?.afterConsults;
    if (key === BOULDER_DIR_CONFIG_KEY)
      return config.boulder?.dir;
    if (key === INVESTIGATION_CONFIG_KEY)
      return config.captain?.investigation;
    if (key === DELEGATION_CONFIG_KEY)
      return config.delegation?.gate;
    if (key === CONSULT_FORCE_KEY)
      return config.consult?.forceAfterMs;
    if (key === WATCHDOG_FORCE_KEY)
      return config.watchdog?.forceAfterMs;
    if (key === WATCHDOG_TOOL_IN_FLIGHT_KEY)
      return config.watchdog?.toolInFlightMaxMs;
    return;
  };
  const consultDeadmanBound = () => {
    for (const key of [CONSULT_FORCE_KEY, WATCHDOG_FORCE_KEY]) {
      const value = configValue(key);
      if (value === undefined || value === null || value === "")
        continue;
      const parsed = Math.trunc(Number(value));
      if (Number.isFinite(parsed))
        return parsed;
    }
    return CONSULT_FORCE_AFTER_MS;
  };
  const consultInFlightBound = () => {
    const value = configValue(WATCHDOG_TOOL_IN_FLIGHT_KEY);
    if (value === undefined || value === null || value === "")
      return CONSULT_TOOL_IN_FLIGHT_MAX_MS;
    const parsed = Math.trunc(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : CONSULT_TOOL_IN_FLIGHT_MAX_MS;
  };
  const guardOutcome = [];
  try {
    const guard = installReadonlyGuard(dsh, {
      deny: READONLY_DENY,
      members: teamMembers(),
      warn: (line) => warnOnce("team-guard:" + line, line)
    });
    guardOutcome.push(guard.installed ? "readOnlyGuard=installed deny=" + READONLY_DENY.length : "readOnlyGuard=absent reason=" + String(guard.reason));
  } catch (error) {
    guardOutcome.push("readOnlyGuard=absent reason=threw");
    warnOnce("team-guard:threw", "the team-path read-only guard could not be installed (" + errText(error) + ")");
  }
  try {
    const investigation = installCaptainInvestigationGuard(dsh, {
      workspaceRootOf: (exec) => dsh.workspaceRoot(exec),
      configValue,
      warn: (line) => warnOnce("captain-investigation:" + line, line)
    });
    guardOutcome.push(investigation.installed ? "captainInvestigation=" + investigation.mode : "captainInvestigation=absent reason=" + String(investigation.reason));
  } catch (error) {
    guardOutcome.push("captainInvestigation=absent reason=threw");
    warnOnce("captain-investigation:threw", "the captain investigation guard could not be installed (" + errText(error) + ")");
  }
  try {
    const delegation = installDelegationGate(dsh, {
      configValue,
      warn: (line) => warnOnce("delegation-gate:" + line, line)
    });
    guardOutcome.push(delegation.installed ? "delegationGate=" + delegation.mode : "delegationGate=absent reason=" + String(delegation.reason));
  } catch (error) {
    guardOutcome.push("delegationGate=absent reason=threw");
    warnOnce("delegation-gate:threw", "the delegation gate could not be installed (" + errText(error) + ")");
  }
  guardOutcome.push("verifyGate=absent reason=" + withdrawnReason("verify.mode"));
  try {
    const askUserGuard = installAskUserQuestionGuard(dsh, {
      warn: (line) => warnOnce("ask-user-guard:" + line, line)
    });
    guardOutcome.push(askUserGuard.installed ? "askUserQuestion=installed" : "askUserQuestion=absent reason=" + String(askUserGuard.reason));
  } catch (error) {
    guardOutcome.push("askUserQuestion=absent reason=threw");
    warnOnce("ask-user-guard:threw", "the ask_user_question boundary guard could not be installed (" + errText(error) + ")");
  }
  try {
    const questionRelay = installQuestionRelay(dsh, {
      warn: (line) => warnOnce("question-relay:" + line, line)
    });
    if (questionRelay.installed) {
      ctx.provide("mpdQuestions", {
        list: (input) => questionRelay.relay.list(input?.sessionId),
        answer: (input) => questionRelay.relay.answer(input)
      });
      const effect = typeof ctx.effect === "function" ? (register) => ctx.effect?.(register) : undefined;
      const lifetimeOwned = effect !== undefined;
      let routesMounted = false;
      try {
        routesMounted = registerQuestionWeb(dsh, effect, {
          relay: questionRelay.relay,
          warn: (line) => warnOnce("question-relay:" + line, line)
        });
      } catch (error) {
        warnOnce("question-relay:web", "question web route registration degraded (" + errText(error) + ")");
      }
      try {
        effect?.(() => () => {
          questionRelay.dispose();
        });
      } catch (error) {
        warnOnce("question-relay:dispose", "the question relay's release could not be registered (" + errText(error) + ")");
      }
      if (!lifetimeOwned) {
        warnOnce("question-relay:lifetime", "the question relay has no lifetime owner: ctx.effect is unavailable, so its waterfall answerer and routes are never disposed");
      }
      guardOutcome.push("questions=relay routes=" + (routesMounted ? QUESTION_ROUTES.length : 0) + (lifetimeOwned ? "" : " lifetime=unowned"));
    } else {
      guardOutcome.push("questions=absent reason=" + questionRelay.reason);
    }
  } catch (error) {
    guardOutcome.push("questions=absent reason=threw");
    warnOnce("question-relay:threw", "the question relay could not be installed (" + errText(error) + ")");
  }
  try {
    installRosterSection(dsh, {
      members: teamMembers(),
      presets: ["mpd"],
      warn: (line) => warnOnce("team-section:" + line, line),
      log: (line) => rowLogLine("mpd-roles", "[mpd-roles] " + line)
    });
    guardOutcome.push("rosterSection=agent-scoped order=605");
  } catch (error) {
    guardOutcome.push("rosterSection=absent");
    warnOnce("team-section:threw", "the roster prompt section could not be registered (" + errText(error) + ")");
  }
  try {
    const gate = installSessionGate(dsh, {
      presets: ["mpd"],
      warn: (line) => warn(line),
      log: (line) => rowLogLine("mpd-roles", "[mpd-roles] " + line),
      configValue,
      stagedPlan: stagedPlanProbe(ctx)
    });
    guardOutcome.push("sessionGate=" + gate.mode + " sensitivity=" + gate.sensitivity);
  } catch (error) {
    guardOutcome.push("sessionGate=absent");
    warnOnce("team-gate:threw", "the session-start complexity gate could not be installed (" + errText(error) + ")");
  }
  try {
    rowLogLine("mpd-roles", "[mpd-roles] team plane: " + guardOutcome.join(" "));
  } catch {}
  try {
    rowLogLine("mpd-roles", "[mpd-roles] mpdRoles provided (base roles: " + ROLES.length + ") | adapterIdentity=" + dshAdapterIdentity(ctx));
  } catch {}
}
export {
  ADAPTER_IDENTITY_FALLBACK,
  ADAPTER_IDENTITY_MOUNTED,
  ADAPTER_IDENTITY_PENDING,
  LEAF_SPAWN_DENY,
  READONLY_DENY,
  apply,
  consultDepthRefusal,
  extensionRoleId,
  extensionRoles,
  inject,
  name,
  normalizeRoleKey,
  normalizeRoleNameKey,
  pkgRoot,
  readPersona,
  roleOfToolInput,
  rosterFunctionList,
  rosterNameList,
  spawnMaxDepthOf,
  stagedPlanProbe
};
