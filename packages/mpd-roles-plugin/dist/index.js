// packages/mpd-roles-plugin/src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { join as join3, resolve as resolve3 } from "node:path";

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
import { readFile as readFileFs, readdir as readDirFs } from "node:fs/promises";
import { join } from "node:path";
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
  return { trigger: input.explicitFlag === true || signals.length >= 1, signals };
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
async function readLeadingTeam(workspace, sessionId, opts = {}) {
  const nothing = { leading: false, members: 0 };
  if (typeof sessionId !== "string" || sessionId === "")
    return nothing;
  try {
    const read = opts.readFile ?? ((path) => readFileFs(path, "utf8"));
    const list = opts.readDir ?? ((path) => readDirFs(path, { encoding: "utf8", withFileTypes: false }));
    const entries = await list(join(String(workspace ?? ""), TEAM_RECORDS_DIR));
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
        return { leading: true, teamId: String(fields.teamId ?? ""), members };
      } catch {}
    }
  } catch {
    return nothing;
  }
  return nothing;
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
  return {
    name: firstLine === "" ? GATE_PLAN_NAME_FALLBACK : firstLine.slice(0, GATE_PLAN_NAME_MAX),
    description: "Staged mechanically by the mpd session-start complexity gate on " + matched + "." + `
This is a SHELL: 0 members and 0 tasks, because at the first pre-step there is no decomposition yet.` + `
Goal excerpt: ` + (excerpt === "" ? "(empty)" : excerpt) + "\nExtend it with `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)" + " and `" + STAGING_TOOL_NAME + ' {action:"' + PLAN_EXTEND_ACTIONS[1] + '"}`,' + " then approve it with `" + STAGING_TOOL_NAME + ' {action:"approve"}` — approval is what spawns the members.' + `
` + INERT_PLAN_PHRASE + "." + (input.planPath === undefined ? "" : `
Active plan artifact (signal D): ` + input.planPath),
    approval: "required"
  };
}
function advisoryNoticeText(signals, explicit) {
  const matched = signals.length === 0 ? "complexity signals" : "complexity signals " + signals.join("/");
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and " + NO_TEAM_STAGED_PHRASE + " — the gate is ADVISORY " + "and stages nothing while complexity is merely being judged." + (explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is a reason to stage, not a staged team." : "") + "\n- Stage a team yourself when the work warrants one: `" + STAGING_TOOL_NAME + '` {action:"' + PLAN_EXTEND_ACTIONS[0] + '"} → {action:"' + PLAN_EXTEND_ACTIONS[1] + '"} (each task carrying its dependency answer: `blocked_by` or `independent: true`)' + ' → {action:"approve"}; drive the team with `' + BOARD_TOOL_NAME + "` and `" + DISPATCH_TOOL_NAME + "`." + `
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
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and " + (input.alreadyStaged ? ALREADY_STAGED_PLAN_PHRASE : STAGED_PLAN_PHRASE) + " — " + id + " (0 members, 0 tasks: a SHELL, not a team)." + (input.alreadyStaged ? `
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
  return "captain investigation rule: `" + toolName + "` on " + target + " is refused — the `mpd`" + " preset's TOP-LEVEL session does not run reconnaissance, so its context stays small enough for very large" + " projects. Delegate it: `mpd_role_spawn` with the `Explorer` role (find files and code) or the" + " `Researcher` role (evidence-based search), or hand the search to a team member, and consume the" + " REPORT. The documentation band stays open to you: `.mpd/**`, `docs/**`, `evidence/**`," + " `agent-references/**`, the root AGENTS.md / README*.md / CHANGELOG.md / LICENSE*.md — and" + ' `captain.investigation: "allow"` in mpd.jsonc restores full access.';
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
import { randomUUID } from "node:crypto";
import { resolve as resolve2 } from "node:path";

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
async function disposeSettledConsult(activation) {
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
            ...agentOptions === undefined ? {} : { agentOptions }
          },
          signal: request.signal ?? neverAborted()
        };
        const started = await startContinuableChild(subagents, spec, `cannot raise team member "${request.name}"`);
        const handle = String(started?.childId ?? started?.id ?? "");
        if (handle === "")
          throw new Error(`mpd-dsh-adapter: the native backend raised "${request.name}" but reported no child id`);
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
        await disposeSettledConsult(activation);
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
function sessionIdOf(agent) {
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
        ...input.planPath === undefined ? {} : { planPath: input.planPath }
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
      if (agentId !== "" && acted.has(agentId))
        return;
      const mode = resolveGateMode(configValue(GATE_CONFIG_KEY));
      if (mode === GATE_MODE_OFF) {
        gateTrace("mode off agent=" + agentId);
        return;
      }
      const decisionMessages = Array.isArray(decision?.messages) ? decision.messages : [];
      const rawClaimed = Array.isArray(payload?.messages) && payload.messages.length > 0 ? payload.messages : decisionMessages;
      const user = latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages);
      if (user === undefined) {
        gateTrace("no user text yet agent=" + agentId);
        return;
      }
      const workspace = dsh.workspaceRoot({ agent });
      const leading = await readLeadingTeam(workspace, sessionIdOf(agent), {
        ...options.readFile === undefined ? {} : { readFile: options.readFile },
        ...options.readDir === undefined ? {} : { readDir: options.readDir }
      });
      if (leading.leading) {
        gateTrace("already leading team=" + String(leading.teamId ?? "(id not read)") + " members=" + String(leading.members) + " agent=" + agentId);
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
      if (agentId !== "")
        acted.add(agentId);
      let outcome = { ok: false, planId: "", alreadyStaged: false };
      if (mode === GATE_MODE_MECHANICAL) {
        outcome = await stagePlan({
          agent,
          workspace,
          sessionId: sessionIdOf(agent),
          goal: consumed.text,
          signals: verdict.signals,
          ...boulder.planPath === undefined ? {} : { planPath: boulder.planPath }
        });
        if (!outcome.ok) {
          warn('session-start gate: staging degraded to the advisory notice for agent "' + agentId + '" (' + String(outcome.error) + ")");
        }
      }
      const staged = mode === GATE_MODE_MECHANICAL && outcome.ok;
      report('session gate fired for agent "' + agentId + '" signals=' + verdict.signals.join("/") + " mode=" + mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId) + " sensitivity=" + sensitivity);
      if (staged && outcome.planId === "") {
        warn("session-start gate: " + MISSING_PLAN_ID_PHRASE + ' for agent "' + agentId + '" — the shell is staged but cannot be approved');
      }
      gateTrace("FIRING agent=" + agentId + " signals=" + verdict.signals.join("/") + " mode=" + mode + " staged=" + String(staged) + " sensitivity=" + sensitivity);
      const notice = dsh.userMessage({
        text: staged ? mechanicalNoticeText({ planId: outcome.planId, signals: verdict.signals, explicit: consumed.flagged, alreadyStaged: outcome.alreadyStaged }) : advisoryNoticeText(verdict.signals, consumed.flagged),
        source: { kind: "mpd-roles", reason: "session-start-advisory" }
      });
      const messages = [...decisionMessages.length > 0 ? decisionMessages : rawClaimed].map((message) => message === user.message ? consumeFlagFromMessage(message, user.text) : message);
      let lastClaimed = -1;
      for (let at2 = 0;at2 < messages.length; at2 += 1)
        if (rawClaimed.includes(messages[at2]))
          lastClaimed = at2;
      const at = lastClaimed < 0 ? messages.length : lastClaimed + 1;
      const amended = [...messages.slice(0, at), notice, ...messages.slice(at)];
      return { ...decision, kind: decision?.kind ?? "enter", messages: amended };
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

// packages/mpd-roles-plugin/src/index.ts
var name = "mpd-roles";
var inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS);
var READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict"
];
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
  return config.personasDir ? join3(resolve3(config.personasDir), spec.id + ".md") : join3(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md");
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
function text(value) {
  return typeof value === "string" ? value : "";
}
function errText(error) {
  return error instanceof Error ? error.message : String(error);
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
    const extensionId = text(view?.id);
    if (extensionId === "")
      continue;
    if (view?.enabled === false)
      continue;
    const declared = view?.descriptor?.contributes?.roles;
    if (!Array.isArray(declared))
      continue;
    if (view?.plane === PROJECT_ONLY_PLANE) {
      for (const item of declared) {
        const name2 = text(item?.name).trim();
        if (name2 === "")
          continue;
        refused.push({ extension: extensionId, name: name2, reason: PROJECT_ROLES_REASON });
      }
      continue;
    }
    const root = text(view?.root);
    declared.forEach((item, index) => {
      const name2 = text(item?.name).trim();
      if (name2 === "")
        return;
      const refuse = (reason) => {
        refused.push({ extension: extensionId, name: name2, reason });
      };
      const itemLabel = "contributes.roles[" + index + "]";
      const key = normalizeRoleNameKey(name2);
      const takenBy = owner.get(key);
      if (takenBy !== undefined) {
        refuse('role name "' + name2 + '" (' + itemLabel + ' of extension "' + extensionId + '") is already taken by ' + takenBy + " — this extension role is not exposed");
        return;
      }
      const id = extensionRoleId(extensionId, name2);
      if (ROLE_BY_ID[id] !== undefined) {
        refuse('role id "' + id + '" collides with the base roster — this extension role is not exposed');
        return;
      }
      const personaFile = root === "" ? text(item?.persona) : resolve3(root, text(item?.persona));
      const persona = readExtensionPersona(root, text(item?.persona));
      if (persona === null) {
        refuse("persona file is not readable: " + personaFile);
        return;
      }
      const chain = typeof item?.provider === "string" && typeof item?.model === "string" ? [{ provider: item.provider, model: item.model }] : [];
      owner.set(key, 'extension "' + extensionId + '"');
      roles.push({
        id,
        name: name2,
        description: text(item?.description),
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
      const outcome = dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY]);
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: applied " + outcome.applied.length + " denials to its own tool scope" + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"));
    } catch (error) {
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: the deny could NOT be applied (" + String(error?.message ?? error) + ") — this member may be able to write");
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
  ctx.provide("mpdRoles", {
    adapterIdentity: dshAdapterIdentity(ctx),
    list: () => roleSurface(undefined).roles.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: r.persona, extension: r.extension })),
    get: (key) => {
      const spec = roleOf(roleSurface(undefined), key);
      return spec === null ? null : { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: spec.persona, extension: spec.extension };
    }
  });
  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster — the SAME normal-named specialists team mode stages as teammates, each named for what it does: " + rosterFunctionList() + ". Address a role by that name (any case, space or hyphen spelling). Use this before mpd_role_spawn; for team work stage the roster with `agent_teams_plan` (add_member with the persona text from mpd_role_persona → create_task with its dependency answer → approve) instead of repeated single-call consults.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" }, refused: { type: "array", items: { type: "object", properties: { extension: { type: "string" }, name: { type: "string" }, reason: { type: "string" } }, required: ["extension", "name", "reason"] } } }, required: ["roles", "count"] }, render: (_a, v) => textBlock("roster (" + v.count + `):
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
    description: "Run ONE bounded delegation with a specialist and return one report — a ONE-SHOT single-call consult: the adapter disposes the activation once the report settles, so the consult is NOT reused — ask a new question with a NEW spawn (the harness catalog is append-only, so a settled child may still list as `inactive`, but the contract is one-shot). It carries the role's persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each named for what it does: " + rosterFunctionList() + ". The child is labelled with that name. `mpd_workmate_spawn` is the same spawn mechanics for a durable, evolving instance (its persona/memory/note — not the child session — carry continuity). For multi-member team work prefer the mpd team path (`agent_teams_plan`: add_member → create_task with its dependency answer → approve; drive with `agent_teams_task`/`agent_teams_dispatch`) instead of repeated single-call consults: THIS path applies the role's own `agentRoutes` entry, and a teammate staged through `agent_teams_plan` is routed the same way by the team executor — its `role` first, then its `description` head; only an UNMATCHED member inherits the staging session's route.",
    parameters: { type: "object", properties: { role: { type: "string", description: 'role name (see mpd_roles_list), e.g. "Architect" or "Deep Worker"' }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a, v) => textBlock("role " + v.role + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "") + (v.evidence?.length ? `
evidence:
- ` + v.evidence.join(`
- `) : "")) },
    execute: async (args, exec) => {
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
      const result = await dsh.spawnAgent({
        label: spec.name,
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider,
        model,
        persona,
        outputSchema: REPORT_SCHEMA,
        ...run.route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: run.route.reasoningEffort } },
        ...spec.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {}
      });
      const st = result.structured ?? {};
      return { role: spec.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
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
    if (key === BOULDER_DIR_CONFIG_KEY)
      return config.boulder?.dir;
    if (key === INVESTIGATION_CONFIG_KEY)
      return config.captain?.investigation;
    if (key === DELEGATION_CONFIG_KEY)
      return config.delegation?.gate;
    return;
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
  READONLY_DENY,
  apply,
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
  stagedPlanProbe
};
