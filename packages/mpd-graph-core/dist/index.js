// packages/mpd-graph-core/src/rank.ts
function deriveRanks(tasks, byId) {
  const settled = new Map;
  const walking = new Set;
  for (const root of tasks) {
    if (settled.has(root.id))
      continue;
    const stack = [{ id: root.id, next: 0 }];
    walking.add(root.id);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const deps = (byId.get(frame.id)?.dependencies ?? []).filter((id) => byId.has(id));
      if (frame.next < deps.length) {
        const dependency = deps[frame.next];
        frame.next += 1;
        if (settled.has(dependency) || walking.has(dependency))
          continue;
        walking.add(dependency);
        stack.push({ id: dependency, next: 0 });
        continue;
      }
      let deepest = 0;
      for (const dependency of deps)
        deepest = Math.max(deepest, (settled.get(dependency) ?? 0) + 1);
      settled.set(frame.id, deepest);
      walking.delete(frame.id);
      stack.pop();
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
function cycleIds(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set;
  const stack = [];
  const onStack = new Set;
  const cyclic = new Set;
  const visit = (id) => {
    if (done.has(id))
      return;
    if (onStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id)))
        cyclic.add(entry);
      return;
    }
    const task = byId.get(id);
    if (task === undefined)
      return;
    onStack.add(id);
    stack.push(id);
    for (const dependency of task.dependencies)
      if (byId.has(dependency))
        visit(dependency);
    stack.pop();
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
  return body.split("|").map((cell) => cell.trim());
}
function isTableSeparator(row) {
  const cells = splitCells(row);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/[ \t]/g, "")));
}
function stripEmphasis(text) {
  let value = text.trim();
  while (value.startsWith("**") || value.startsWith("*") || value.startsWith("`")) {
    value = (value.startsWith("**") ? value.slice(2) : value.slice(1)).trim();
  }
  while (value.endsWith("**") || value.endsWith("*") || value.endsWith("`")) {
    value = (value.endsWith("**") ? value.slice(0, -2) : value.slice(0, -1)).trim();
  }
  return value;
}
function laneKeyOf(text) {
  const value = stripEmphasis(text);
  const match = /^(?:Lane\s+)?([A-Za-z][A-Za-z0-9]{0,3})(?=[ \t]*[.:—–·(]|[ \t]*$)/.exec(value);
  return match === null ? undefined : match[1].toUpperCase();
}
function leadingLane(text) {
  let value = text.trim();
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
function normalizeOwner(cell) {
  const value = stripEmphasis(cell);
  const cut = value.indexOf("(");
  return (cut >= 0 ? value.slice(0, cut) : value).trim();
}
function readableLines(text) {
  const lines = [];
  let fence;
  let number = 0;
  for (const raw of text.split(`
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
    const named = header.some((cell) => stripEmphasis(cell).toLowerCase() === "lane") && header.some((cell) => stripEmphasis(cell).toLowerCase() === "owner");
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
function collectTasks(lines, problems) {
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
    const lane = leadingLane(afterOrdinal);
    tasks.push({
      id: section === "todo" ? `T${match[1]}` : match[1].toUpperCase(),
      title: lane?.title ?? afterOrdinal,
      section,
      line: line.line,
      lane: lane?.key,
      references: declaredReferences(afterOrdinal)
    });
  }
  return tasks;
}
function declaredReferences(text) {
  const lists = [];
  for (const match of text.matchAll(PARENTHESISED_BLOCKS))
    lists.push(match[1]);
  for (const match of text.matchAll(LABELLED_BLOCKS))
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
    problems.push({ line: task.line, text: token, reason: `"${token}" names no task id and no declared lane` });
  }
  const owner = task.lane === undefined ? undefined : lanes.get(task.lane);
  const blockedBy = [...new Set(ids)].sort((left, right) => ID_ORDER.compare(left, right));
  return { id: task.id, title: task.title, section: task.section, line: task.line, owner, blockedBy };
}
function parsePlanMarkdown(text) {
  const lines = readableLines(text);
  const problems = [];
  const lanes = collectLanes(lines, problems);
  const raw = collectTasks(lines, problems);
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
      problems.push({ line: task.line, text: task.title, reason: `duplicate task id ${task.id}` });
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
function buildModel(input) {
  const boardById = new Map;
  for (const task of input.board ?? [])
    boardById.set(task.id, task);
  const planById = new Map;
  for (const task of input.plan?.tasks ?? [])
    planById.set(task.id, task);
  const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort((left, right) => ID_ORDER.compare(left, right));
  const drafts = [];
  for (const id of ids) {
    const board = boardById.get(id);
    const planned = planById.get(id);
    const kind = board?.kind;
    const assignee = board?.owner ?? planned?.owner;
    const title = planned?.title;
    const status = board?.status;
    drafts.push({
      id,
      subject: board?.subject ?? planned?.title ?? id,
      visual: board === undefined ? "planned" : visualOf(board),
      dependencies: uniqueSorted([...board?.blockedBy ?? [], ...planned?.blockedBy ?? []]),
      depth: board?.depth ?? 0,
      planned: board === undefined,
      ...kind === undefined ? {} : { kind },
      ...assignee === undefined ? {} : { assignee },
      ...title === undefined ? {} : { title },
      ...status === undefined ? {} : { status }
    });
  }
  const declared = new Map;
  const keyOf = (from, to) => `${from}\x00${to}`;
  for (const task of boardById.values()) {
    for (const from of task.blockedBy ?? []) {
      const entry = declared.get(keyOf(from, task.id)) ?? { from, to: task.id, board: false, plan: false };
      entry.board = true;
      declared.set(keyOf(from, task.id), entry);
    }
  }
  for (const task of planById.values()) {
    for (const from of task.blockedBy) {
      const entry = declared.get(keyOf(from, task.id)) ?? { from, to: task.id, board: false, plan: false };
      entry.plan = true;
      declared.set(keyOf(from, task.id), entry);
    }
  }
  const nodeIds = new Set(ids);
  const edges = [];
  for (const entry of declared.values()) {
    if (!nodeIds.has(entry.from) || !nodeIds.has(entry.to))
      continue;
    edges.push({ from: entry.from, to: entry.to, source: entry.board && entry.plan ? "both" : entry.plan ? "plan" : "board" });
  }
  edges.sort((left, right) => ID_ORDER.compare(left.from, right.from) || ID_ORDER.compare(left.to, right.to));
  const layout = rankPlan(drafts);
  const nodes = drafts.map((node) => ({ ...node, depth: layout.rankOf.get(node.id) ?? node.depth }));
  const ranks = layout.ranks.map((rank) => rank.map((task) => task.id));
  const report = {
    boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
    planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id)),
    edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
    edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
    planProblems: [...input.plan?.problems ?? []],
    unresolved: [...layout.unresolved],
    ranksDerived: layout.derived
  };
  return { nodes, edges, ranks, cycles: cycleIds(nodes), report };
}
// packages/mpd-graph-core/src/resolve.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
var LEDGER_PATH = join(".mpd", "boulder.json");
var PLANS_DIR = join(".mpd", "plans");
var EMPTY_PLAN = { tasks: [], lanes: [], problems: [] };
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function planPathFrom(root, value) {
  if (typeof value !== "string" || value.trim() === "")
    return;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}
function readBoulderState(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, LEDGER_PATH), "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}
function beaconPlan(root) {
  const state = readBoulderState(root);
  if (state === undefined)
    return;
  const works = isRecord(state.works) ? state.works : undefined;
  const activeId = typeof state.active_work_id === "string" ? state.active_work_id : undefined;
  const record = works !== undefined && activeId !== undefined && isRecord(works[activeId]) ? works[activeId] : undefined;
  if (record === undefined || record.status !== "active")
    return;
  const path = planPathFrom(root, record.active_plan) ?? planPathFrom(root, state.active_plan);
  if (path === undefined)
    return;
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return;
  }
}
function newestPlan(root) {
  const candidates = [];
  try {
    const entries = readdirSync(join(root, PLANS_DIR), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".zh-CN.md"))
        continue;
      const path = join(root, PLANS_DIR, entry.name);
      const stats = statSync(path, { throwIfNoEntry: false });
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
    return parsePlanMarkdown(readFileSync(path, "utf8"));
  } catch {
    return { tasks: [], lanes: [], problems: [{ line: 0, text: path, reason: "plan file could not be read" }] };
  }
}
// packages/mpd-graph-core/src/watch.ts
import { readdirSync as readdirSync2, statSync as statSync2, watch } from "node:fs";
import { basename, dirname, join as join2 } from "node:path";
function statOrUndefined(path) {
  try {
    return statSync2(path);
  } catch {
    return;
  }
}
function nearestExistingDirectory(path) {
  let current = path;
  for (;; ) {
    let exists = false;
    try {
      exists = statSync2(current).isDirectory();
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
function boardSignature(directory) {
  let names;
  try {
    names = readdirSync2(directory);
  } catch {
    return "unavailable";
  }
  const parts = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json"))
      continue;
    const stats = statOrUndefined(join2(directory, name));
    if (stats === undefined)
      continue;
    parts.push(`${name}:${stats.ino}:${stats.mtimeMs}:${stats.size}`);
  }
  return parts.join(";");
}
function targetSignature(target) {
  return target.kind === "board-dir" ? boardSignature(target.path) : fileSignature(target.path);
}
function watchGraph(targets, options = {}) {
  const debounceMs = options.debounceMs ?? 150;
  const watched = [];
  if (targets.boardDir !== undefined)
    watched.push({ path: targets.boardDir, kind: "board-dir" });
  if (targets.planFile !== undefined)
    watched.push({ path: targets.planFile, kind: "plan-file" });
  const signatures = new Map;
  for (const target of watched)
    signatures.set(target.path, targetSignature(target));
  const armed = new Map;
  const listeners = new Set;
  if (options.onChange !== undefined)
    listeners.add(options.onChange);
  let timer;
  let pending = 0;
  let sequence = 0;
  let coalesced = 0;
  let closed = false;
  function report(error) {
    options.onError?.(error);
  }
  function relevant(name) {
    if (name === undefined)
      return true;
    for (const entry of armed.values()) {
      if (!entry.exact)
        return true;
      if (entry.board && name.endsWith(".json"))
        return true;
      if (entry.names.has(name))
        return true;
      if (!entry.board && entry.names.size > 0 && name.endsWith(".md"))
        return true;
    }
    return false;
  }
  function armDirectory(directory) {
    try {
      const watcher = watch(directory, { persistent: false }, (_event, name) => notify(typeof name === "string" ? name : undefined));
      watcher.on("error", report);
      return watcher;
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
      const wantedDir = target.kind === "board-dir" ? target.path : dirname(target.path);
      const existing = nearestExistingDirectory(wantedDir);
      if (existing === undefined)
        continue;
      const entry = wanted.get(existing) ?? { exact: existing === wantedDir, board: false, names: new Set };
      entry.exact = entry.exact && existing === wantedDir;
      if (target.kind === "board-dir" && existing === target.path)
        entry.board = true;
      else
        entry.names.add(basename(target.path));
      wanted.set(existing, entry);
    }
    for (const [directory, entry] of armed) {
      if (wanted.has(directory))
        continue;
      entry.watcher.close();
      armed.delete(directory);
    }
    for (const [directory, desired] of wanted) {
      if (armed.has(directory))
        continue;
      const watcher = armDirectory(directory);
      if (watcher === undefined)
        continue;
      armed.set(directory, { watcher, exact: desired.exact, board: desired.board, names: desired.names });
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
export {
  ID_ORDER,
  bucketRanks,
  buildModel,
  cycleIds,
  deriveRanks,
  parsePlanMarkdown,
  rankPlan,
  readPlanFile,
  resolvePlanFile,
  servedRank,
  watchGraph
};
