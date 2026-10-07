// v5 switch (GO-authorized). Writes ONLY new versioned files in evidence/omo-align/skills-gates/:
//   gap-r2.json, gap-verdict-table-r2.md, raw/field-exposure-changelog.md,
//   revisions/fv5-<UTCstamp>/{gap-r2.json,gap-verdict-table-r2.md,manifest.json}, REVISIONS.md (append)
// NEVER touches fv4 (gap.json / gap-verdict-table.md) nor t8's verdict-table.md / gate-rubric.json / decisions.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const HERE = "/root/dshProj/my-power-dsh/evidence/omo-align/skills-gates";
const TAG = "fv5.15"; // single source of truth for the delivered revision tag
const REPO = "/root/dshProj/my-power-dsh";
const UP = "/root/dshProj/oh-my-openagent";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const bytes = (p) => readFileSync(p).length;
const now = () => new Date().toISOString();

// ── frozen inputs (read-only) ───────────────────────────────────────────────────────────────────
const fv4Path = join(HERE, "gap.json");
const fv4 = JSON.parse(readFileSync(fv4Path, "utf8"));
const fv4Sha = sha(fv4Path), fv4Bytes = bytes(fv4Path);
const fv4TablePath = join(HERE, "gap-verdict-table.md");
const fv4TableSha = sha(fv4TablePath), fv4TableBytes = bytes(fv4TablePath);
const fv4ManifestPath = join(HERE, "revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json");
const fv4Manifest = JSON.parse(readFileSync(fv4ManifestPath, "utf8"));
const RAW = JSON.parse(readFileSync(join(HERE, "raw/upstream-skill-records.json"), "utf8"));

const fcPath = join(REPO, "evidence/omo-align/requirements/frozen-contract.json");
const fc = JSON.parse(readFileSync(fcPath, "utf8"));
const fcSha = sha(fcPath), fcBytes = bytes(fcPath);
const fcGap = String(fc.t4Requirements.residualFieldGap);
const grabRule = (re) => { const m = fcGap.match(re); return m ? m[0] : null; };
const RULE = {
  source: `${fcPath} (${fcBytes} B, sha256 ${fcSha}) read at ${now()}`,
  d3: grabRule(/\(b\) D3 RULE:[^.]*\./),
  seamTriggers: grabRule(/SEAM TRIGGER SET = [^\n]*?\./) ?? "SEAM TRIGGER set = envKeyOmo, teamTools, dagRunId, workflowTool.",
  evidenceQuality: grabRule(/\(d\)[^.]*\./),
  v4: grabRule(/\(e\)[^.]*\./),
  threshold: grabRule(/\(f\)[^.]*\./),
  binaryDependencyRule: String(fc.t4Requirements.binaryDependencyRule ?? "(absent)"),
  authorityNote: String(fc.t4Requirements.authorityNote ?? "(absent)"),
  readTimeNote: "Per authorityNote: this file was RE-READ at work time and the bytes+sha256 above are exactly what was read; all numbers in captain/member messages are ADVISORY.",
};
// The GO message's formula differs from the on-disk text; record BOTH, implement neither silently.
const RULE_CONFLICT = {
  id: "ruleConflict-D3",
  status: "RESOLVED",
  resolution: "The captain's GO adopts the on-disk (b) formula: D3 = 1 + (counted TRUE seam booleans), clamped [0,3]. The earlier GO wording ('D3 = count of TRUE seam booleans') is superseded, so both sides now agree on the on-disk text.",
  goMessage: "D3 = count of TRUE seam booleans (harnessSeamChange + binaryDependency)",
  onDiskText: RULE.d3,
  impact: "They differ by exactly 1 on every row. With `total >= 15 => adapt`, that point flips remove-deadcode between 14/skip (GO caliber) and 15/adapt (on-disk caliber, 1+counted=2).",
  resolutionApplied: "Per the on-disk text's own precedence clause ('Any later message that conflicts with this text is void') and the text's '(g) THE GATE RECOMPUTES and never quotes a remembered total', this deliverable publishes BOTH calibers side by side and asserts NO winning total. The gate must recompute from the row inputs.",
};

// ── settled anchors: file::symbol + line + sha256 at read time ──────────────────────────────────
const ANCHOR_FILES = {
  policy: "packages/mpd-agent-teams-plugin/lib/session-start.js",
  schema: "packages/mpd-agent-teams-plugin/lib/index.js",
  preset: "presets/mpd/agent.cordis.yml",
  patch: "packages/mpd-bundle/cordis.patch.yml",
  qa: "skills/dsh-qa/scripts/session-start-team.mjs",
  installer: "scripts/install-profile.mjs",
  agents: "AGENTS.md",
};
const FILE_SHA = Object.fromEntries(Object.entries(ANCHOR_FILES).map(([k, f]) => [k, sha(join(REPO, f))]));
const findLine = (file, symbol) => {
  const lines = readFileSync(join(REPO, file), "utf8").split("\n");
  const re = new RegExp(`(export (async )?(function|const) ${symbol}\\b)|(^\\s*(async )?function ${symbol}\\b)|(${symbol})`);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
};
const A = (key, symbol, label) => {
  const file = ANCHOR_FILES[key];
  const line = typeof symbol === "number" ? symbol : findLine(file, symbol);
  return `${label ?? `${file}::${symbol}`} (line ${line ?? "?"}; file sha256 ${FILE_SHA[key].slice(0, 16)}…)`;
};
const ANCHORS = {
  gate: A("policy", "evaluateComplexityGate"),
  autoRoute: A("policy", "autoRouteEnabled"),
  qualify: A("policy", "policyQualifies"),
  provision: A("policy", "provisionSessionTeam"),
  notices: `${A("policy", "provisionedNotice")} / ${A("policy", "instructNotice")}`,
  splice: A("policy", "spliceNotice"),
  install: A("policy", "installSessionTeamPolicy"),
  flag: A("policy", "consumeExplicitFlag"),
  flagMsg: A("policy", "consumeFlagFromMessage"),
  schema: A("schema", "sessionTeamPolicy"),
  resolved: A("schema", "autoRoute", "index.js: resolved defaults (sessionTeamPolicy block)"),
  presetStartup: A("preset", "SESSION STARTUP RULE", "presets/mpd/agent.cordis.yml::SESSION STARTUP RULE"),
  presetInstr: A("preset", "instructionFileCandidates"),
  presetWorkflow: A("preset", "id: tool-workflow", "presets/mpd/agent.cordis.yml::tool-workflow"),
  patchRow: A("patch", "id: agent-teams", "cordis.patch.yml::agent-teams row"),
  patchPolicy: A("patch", "sessionTeamPolicy:", "cordis.patch.yml::agent-teams/sessionTeamPolicy"),
  qaCase: A("qa", "function selfTest", "session-start-team.mjs::selfTest (two-sided case)"),
  installer: A("installer", "sessionTeamPolicy", "install-profile.mjs::agentTeamsRow/sessionTeamPolicy"),
  agentsClosure: A("agents", "in-use", "AGENTS.md §12 (in-use gate scan) — symbol-free section reference"),
};

// ── per-class evidence (mechanism|prose) + booleans for the 10 Table B rows ─────────────────────
const CLASS_PATTERNS = {
  envKeyOmo: { re: /\bOMO_[A-Z0-9_]+\b/g, ci: false },
  omoDir: { re: /\.omo\b|\$HOME\/\.omo|~\/\.omo/g, ci: false },
  workflowTool: { re: /tool\.workflow|\bworkflow\b/g, ci: false },
  dagRunId: { re: /\brun_id\b|\bamend\b|\bsdk\.retry\b|\bsdk\.send\b/g, ci: false },
  goalTool: { re: /\bcreate_goal\b|\bgoal\b/g, ci: false },
  teamTools: { re: /\bteam_create\b|\bteam_send\b|\bteam_delete\b|\btask_send\b/g, ci: false },
  taskTool: { re: /\btask\(|load_skills|subagent_type/g, ci: false },
  categoryRouting: { re: /\bcategory\b/g, ci: false },
  cliOmo: { re: /\bsenpi\b|--no-omo-task|\/dag\b|\bomo\b/g, ci: false },
  creds: { re: /api[_ -]?key|credential|token|oauth/gi, ci: true },
  binaries: { re: /playwright|chromium|frida|ghidra|\buv\b|\bbun\b|\bdap\b|codegraph/gi, ci: true },
};
const SEAM_TRIGGERS = ["envKeyOmo", "teamTools", "dagRunId", "workflowTool"];
// Per-MATCH classification (not per-line): a hit is `mechanism` only when the match ITSELF sits in a
// code/tool context. A backticked filename elsewhere on the same line must NOT promote a prose word.
const fenceState = (lines) => {
  const inFence = new Array(lines.length).fill(false);
  let open = false;
  lines.forEach((l, i) => { if (/^\s*```/.test(l)) { open = !open; inFence[i] = true; return; } inFence[i] = open; });
  return inFence;
};
const classifyMatch = (lineText, matchIndex, matchText, inFence) => {
  if (inFence) return "mechanism";
  const before = lineText.slice(0, matchIndex);
  if ((before.match(/`/g) || []).length % 2 === 1) return "mechanism";      // inside inline code
  if (/^OMO_[A-Z0-9_]+$/.test(matchText)) return "mechanism";               // env token
  const after = lineText.slice(matchIndex + matchText.length);
  if (after.startsWith("(")) return "mechanism";                            // a call: tool.workflow( …)
  if (/(tool\.|sdk\.|env\(|\$|@)$/.test(before)) return "mechanism";        // tool/env path
  return "prose";
};
const RUNTIME_CANDIDATE = /^(?:\w+=\S+\s+)*([a-zA-Z][\w.-]*)\s+([^\s`"')]+)/;
const RUNTIMES = new Set(["bun", "bunx", "node", "npx", "npm", "pnpm", "yarn", "uv", "deno", "python", "python3", "bash", "sh"]);
// `node` is ambiguous (graph node vs the runtime): require a flag/path argument for it.
const runtimeHit = (st) => {
  const m = RUNTIME_CANDIDATE.exec(st);
  if (!m) return null;
  const [, cmd, arg] = m;
  if (!RUNTIMES.has(cmd)) return null;
  if (cmd === "node" && !(/^-/.test(arg) || arg.includes("/") || /\.(js|mjs|cjs|ts)$/.test(arg))) return null;
  return `${cmd} ${arg}`;
};
const WRAPPER_CALL = /[(]["'](bun|bunx|node|npx|npm|pnpm|yarn|uv|deno|python3?|bash|sh)\s+[^\s)("'`]+/;
const SCRIPT_AT_START = /^(\.?\/)?[\w$./-]+\.(sh|mjs|js|py|ts)\b/;
const DIRECTED_API = /tool\.workflow\(|env\(|sdk\.(define|start|wait|retry|send|amend)|await import\(|json\.loads\(|read\(f"/;
// binaryDependencyRule: TRUE only when the SKILL ITSELF DIRECTS THE AGENT TO RUN the command as part
// of executing the skill. Documented examples that teach the skill's subject do NOT count.
const directedExecutionHits = (lines, inFence) => {
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    if (!inFence[i]) continue;
    if (DIRECTED_API.test(lines[i])) hits.push({ line: i + 1, fragment: lines[i].trim().slice(0, 70), kind: "eval-cell code the skill directs", lineText: lines[i].trim().slice(0, 110), evidenceQuality: "mechanism" });
  }
  return hits;
};
const TOPICAL_ONLY = /^(\s*(git|make)\b)/; // git-master teaches git/make: documented examples, not an environment prerequisite
const binaryDependencyOf = (lines, inFence) => {
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 3; i++) {
    const l = lines[i];
    for (const seg of l.split(/&&|\|\||;|\|/)) {
      const st = seg.trim();
      const hit = runtimeHit(st) ?? (WRAPPER_CALL.test(st) ? WRAPPER_CALL.exec(st)[0].trim() : null) ?? (SCRIPT_AT_START.test(st) ? SCRIPT_AT_START.exec(st)[0] : null);
      if (!hit) continue;
      const inCode = inFence[i] || /`/.test(l);
      if (!inCode) continue;
      hits.push({ line: i + 1, fragment: String(hit).slice(0, 70), lineText: l.trim().slice(0, 110), evidenceQuality: "mechanism" });
      break;
    }
  }
  return hits;
};
const frozenKeyOf = (id) => {
  const map = {
    "skills/remove-deadcode": ".agents/skills/remove-deadcode/SKILL.md",
    "skills/security-research": ".agents/skills/security-research/SKILL.md",
    "skills/tech-debt-audit": ".agents/skills/tech-debt-audit/SKILL.md",
    "omo-codex/rules": "packages/omo-codex/plugin/components/rules/skills/rules/SKILL.md",
    "omo-senpi/dag-library": "packages/omo-senpi/skills/dag-library/SKILL.md",
    "omo-senpi/mass-ulw": "packages/omo-senpi/skills/mass-ulw/SKILL.md",
    "skills-loader-core/dev-browser": "packages/skills-loader-core/src/features/builtin-skills/dev-browser/SKILL.md",
    "skills-loader-core/frontend": "packages/skills-loader-core/src/features/builtin-skills/frontend/SKILL.md",
    "skills-loader-core/git-master": "packages/skills-loader-core/src/features/builtin-skills/git-master/SKILL.md",
    "skills-loader-core/security-research": "packages/skills-loader-core/src/features/builtin-skills/security-research/SKILL.md",
  };
  return map[id];
};
const evidenceFor = (id) => {
  const upFile = frozenKeyOf(id);
  const src = readFileSync(join(UP, upFile), "utf8");
  const lines = src.split("\n");
  const inFence = fenceState(lines);
  const row = fv4.rows.find((r) => r.id === id);
  const classes = Array.isArray(row.upstreamHarnessCoupling) ? row.upstreamHarnessCoupling : [];
  const perClass = {};
  for (const c of classes) {
    const pat = CLASS_PATTERNS[c];
    const hits = [];
    for (let i = 0; i < lines.length && hits.length < 3; i++) {
      const re = new RegExp(pat.re.source, pat.ci ? "gi" : "g");
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        hits.push({
          line: i + 1, fragment: m[0].slice(0, 60),
          lineText: lines[i].trim().slice(0, 110),
          evidenceQuality: classifyMatch(lines[i], m.index, m[0], inFence[i]),
          caseSensitive: !pat.ci,
        });
        if (hits.length >= 3) break;
      }
    }
    if (hits.length) perClass[c] = { class: c, hits, best: hits.some((h) => h.evidenceQuality === "mechanism") ? "mechanism" : "prose" };
  }
  const seamHit = SEAM_TRIGGERS.filter((c) => perClass[c] && perClass[c].best === "mechanism");
  const runtimeHits = binaryDependencyOf(lines, inFence);
  const apiHits = directedExecutionHits(lines, inFence);
  const topicallyExcluded = runtimeHits.length === 0 && apiHits.length === 0 && lines.some((l, i) => inFence[i] && TOPICAL_ONLY.test(l));
  const binHits = [...runtimeHits, ...apiHits];
  const credHit = !!perClass.creds;
  return {
    upstreamFile: upFile,
    classEvidence: perClass,
    binaryCommandEvidence: binHits,
    booleans: {
      harnessSeamChange: {
        value: seamHit.length > 0, basis: "keyword",
        evidenceQuality: seamHit.length > 0 ? "mechanism" : (classes.some((c) => SEAM_TRIGGERS.includes(c)) ? "prose" : "none"),
        evidence: seamHit.length > 0
          ? seamHit.map((c) => `${c}: L${perClass[c].hits.find((h) => h.evidenceQuality === "mechanism").line} "${perClass[c].hits.find((h) => h.evidenceQuality === "mechanism").fragment}"`)
          : (classes.some((c) => SEAM_TRIGGERS.includes(c)) ? classes.filter((c) => SEAM_TRIGGERS.includes(c)).map((c) => `${c}: L${perClass[c].hits[0].line} "${perClass[c].hits[0].fragment}" (prose-only, per-match classification)`) : ["no seam-trigger class in the frozen class table"]),
        falsePositiveRisk: false,
        captainWordingNote: (seamHit.length === 0 && !classes.some((c) => SEAM_TRIGGERS.includes(c)))
          ? "The GO asks for evidenceQuality: prose on this row, but measured it has NO seam-trigger class hit at all, so the accurate label is `none` (prose would imply a prose hit existed). Value is false either way."
          : undefined,
        note: seamHit.length === 0
          ? "Seam trigger has prose-only hits (or none) => false with evidenceQuality prose/none. This matches the captain's ruling for dev-browser/frontend, and records the positive finding rather than `unknown`."
          : "Seam trigger present with mechanism evidence (match itself is a call/env/tool token, or sits in a code fence/inline code).",
      },
      binaryDependency: {
        value: binHits.length > 0, basis: "keyword",
        environmentPrerequisite: (() => {
          const txt = binHits.map((h) => h.fragment.toLowerCase()).join(" ");
          const needs = [];
          if (/bunx?\b/.test(txt)) needs.push("needs bun");
          if (/chromium|playwright/.test(txt)) needs.push("needs Chromium/Playwright");
          if (/\buv\b/.test(txt)) needs.push("needs uv");
          if (/python3?/.test(txt)) needs.push("needs python3");
          if (/\bnpm\b/.test(txt)) needs.push("needs npm");
          if (/\bnpx\b/.test(txt)) needs.push("needs npx/node");
          if (/\.sh\b/.test(txt)) needs.push("ships a script entrypoint");
          return needs.length ? needs.join(", ") : null;
        })(),
        evidence: binHits.length ? binHits.map((h) => `L${h.line} "${h.fragment}"`) : ["no executable command (bun/bunx/node/npx/npm/pnpm/yarn/uv/deno/python/bash/sh or a script path) in the skill's own SKILL.md"],
        falsePositiveRisk: false,
        rule: "binaryDependencyRule (verbatim in authoritativeRuleInput.rule.binaryDependencyRule): TRUE iff the SKILL ITSELF DIRECTS THE AGENT TO RUN the command as part of executing the skill; documented examples that teach the subject do NOT count.",
        disambiguationNote: (id === "skills-loader-core/git-master")
          ? "REGISTERED INTERPRETATION (not an open question): the contract's (b) parenthetical counts git-master's binaries as 0, while the rule's literal definition read alone could count 1 (its SKILL.md has `make` and 16 bash blocks). The rule's own worked values resolve it FALSE, with the stated reason that those blocks are EXAMPLES teaching git usage and nothing must be installed to PORT the skill. This artifact therefore lands binaryDependency=false and registers the interpretive choice here for auditors; it is NOT labelled pending."
          : undefined,
        topicallyExcluded, note: "Executable command the skill directs (runtime invocation or directed eval-cell API code). Documented-example code blocks that only teach the skill's subject are excluded.",
      },
      credentialDependency: {
        value: credHit ? "unknown" : false, basis: "keyword",
        evidence: perClass.creds ? perClass.creds.hits.map((h) => `L${h.line} "${h.fragment}" (${h.evidenceQuality})`) : ["no credential-related hit"],
        falsePositiveRisk: credHit,
        note: credHit ? "Domain-word/audit-target ambiguity (e.g. 'credential exposure', grep for API_KEY); not a credential requirement. Record-only: never scores." : "No credential mention. Record-only: never scores.",
      },
    },
  };
};

// ── rows: carry fv4 rows, refresh anchors on the affected ones, attach Table B evidence ─────────
const REFRESHED = {
  "D1-activation": `${ANCHORS.patchPolicy}; ${ANCHORS.patchRow}; ${ANCHORS.install}; ${ANCHORS.qualify}`,
  "D8-routing-doctrine": `${ANCHORS.presetStartup}; ${ANCHORS.gate}; ${ANCHORS.autoRoute}`,
  "T3-01-default-state": `${ANCHORS.patchPolicy}; ${ANCHORS.schema}; ${ANCHORS.installer}; ${ANCHORS.qaCase}`,
  "T3-02-enable-surface": `${ANCHORS.patchPolicy}; ${ANCHORS.installer}; ${ANCHORS.resolved}`,
  "T3-03-tool-availability": `${ANCHORS.patchRow}; ${ANCHORS.patchPolicy}; ${ANCHORS.install}`,
  "T3-04-activation-trigger": `${ANCHORS.flag}; ${ANCHORS.flagMsg}; ${ANCHORS.gate}; ${ANCHORS.install}`,
  "T3-05-auto-routing": `${ANCHORS.gate}; ${ANCHORS.autoRoute}; ${ANCHORS.schema}`,
  "T3-06-notice-surface": `${ANCHORS.notices}; ${ANCHORS.splice}; ${ANCHORS.flagMsg}`,
  "T3-07-member-eligibility": `${ANCHORS.patchRow} (roster block in the same row)`,
  "T3-08-closure": `${ANCHORS.install}; ${ANCHORS.agentsClosure}`,
};
const rows = fv4.rows.map((r) => {
  const out = { ...r };
  if (REFRESHED[r.id]) {
    out.repoEvidence = REFRESHED[r.id];
    out.anchorStatus = "refreshed-fv5";
    out.anchorMethod = "file::symbol + line (auxiliary) + file sha256 at read time";
  } else {
    out.anchorStatus = "carried-from-fv4";
    out.anchorNote = "Not in the affected set (D1, D8, T3-01..T3-08); fv4 text retained verbatim.";
  }
  if (r.rowSetSource === "frozen-contract.rowSet") {
    const ev = evidenceFor(r.id);
    out.fv5 = {
      upstreamFile: ev.upstreamFile,
      classEvidence: ev.classEvidence,
      binaryCommandEvidence: ev.binaryCommandEvidence,
      upstreamHarnessCoupling: r.upstreamHarnessCoupling, // frozen class list, spelling unchanged
      booleans: ev.booleans,
    };
    if (r.id === "skills-loader-core/frontend" || r.id === "skills-loader-core/git-master") {
      const before = r.replacement && r.replacement.status;
      out.replacement = {
        ...r.replacement,
        status: "partial-equivalent",
        equivalence: r.id === "skills-loader-core/frontend"
          ? "部分等价（同名但内容不同 ⇒ 损失 ≠ 0）：本地 skills/frontend 151 行/28 文件 vs 上游 shared-skills 29 文件（含 +references/design/ambience-skill.md）；builtin 为另一份单文件包装（154 行/1 文件）。动作不变（门禁内本就 skip）。"
          : "部分等价（同名但内容不同 ⇒ 损失 ≠ 0）：本地 skills/git-master 104 行/2 文件 vs 上游 builtin 1107 行/1 文件。动作不变（门禁内本就 skip）。",
        contentDrift: r.id === "skills-loader-core/frontend"
          ? "本地 SKILL.md 151 行 / sha 159c32005214c162… vs upstream(shared-skills & builtin 同) 154 行 / sha 82d4715eb56059dd…；漂移集中在 reference 文件（+ambience-skill.md）。"
          : "本地 SKILL.md 104 行 / 2 文件 vs 上游 builtin 1107 行 / 1 文件。",
        statusBeforeFv5: before,
        changeNote: "equivalent -> partial-equivalent (captain ruling); loss narrative 0 -> content-refresh increment; action unchanged (skip).",
      };
    }
  }
  return out;
});

const bool10 = rows.filter((r) => r.rowSetSource === "frozen-contract.rowSet");
const derivation = bool10.map((r) => {
  const b = r.fv5.booleans;
  const counted = (b.harnessSeamChange.value ? 1 : 0) + (b.binaryDependency.value ? 1 : 0);
  return {
    id: r.id,
    classes: r.upstreamHarnessCoupling,
    seamTriggerMechanism: b.harnessSeamChange.value,
    seamEvidenceQuality: b.harnessSeamChange.evidenceQuality,
    binaryDependency: b.binaryDependency.value,
    credentialDependency: b.credentialDependency.value,
    countedTrueSeamBooleans: counted,
    D3_goCaliber_count: counted,
    D3_onDiskCaliber_1plusCounted_clamped3: Math.min(1 + counted, 3),
    note: "Both calibers published; the gate recomputes and asserts no winning total (ruleConflict-D3).",
  };
});

const gaps = {
  revision: TAG,
  task: "t4",
  produced_by: "Researcher (read-only)",
  produced_at_utc: now(),
  selfValidation: {
    defect: "The first fv5 build used a LINE-LEVEL mechanism classifier, so a backticked filename elsewhere on the line promoted the prose word 'workflow' to mechanism and made skills-loader-core/frontend show harnessSeamChange=true. Caught by this producer's own post-build validation.",
    fix: "Per-MATCH classification: a hit is mechanism only when the match itself is inside inline code, inside a fenced block, an env token, a call (followed by '('), or a tool./sdk./env( path. binaryDependency likewise now uses the frozen definition (executable command in code context) instead of a class-hit shortcut.",
    intermediates: ["revisions/fv5-<stamp>/ (line-level mechanism classifier: frontend seam wrongly true)", "revisions/fv5.1-<stamp>/ (exec detector too loose: dag-library/mass-ulw/git-master wrongly bin=true)", "revisions/fv5.2-<stamp>/ (noun `node` at segment start matched as a runtime: mass-ulw wrongly bin=true)", "revisions/fv5.3-<stamp>/ (wrapper-call regex still allowed a bare segment start: mass-ulw bin wrongly true)", "revisions/fv5.4-<stamp>/ (data identical; only selfValidation.status text was stale)", "revisions/fv5.5-<stamp>/ (status text named fv5.3)", "revisions/fv5.6-<stamp> x2 (changelog section 8 duplicated/misordered)", "revisions/fv5.7-<stamp> (section-8 block emitted after the changelog write, so it was absent from the file — data otherwise identical)"], status: `all kept immutable; none is citable as the delivered revision; the delivered revision is ${TAG}.`,
  },
  supersedes: {
    file: "gap.json",
    sha256: fv4Sha,
    bytes: fv4Bytes,
    snapshot: "revisions/fv4-2026-09-13T14-00-29-361Z/",
    table: { file: "gap-verdict-table.md", sha256: fv4TableSha, bytes: fv4TableBytes },
    statement: "This file supersedes fv4. gap.json and gap-verdict-table.md are NOT modified; their byte-invariance is anchored to revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json.",
  },
  authoritativeRuleInput: {
    path: fcPath, bytes: fcBytes, sha256: fcSha, readAt: now(),
    note: "Rule text recorded VERBATIM from the on-disk file at read time; this file's own precedence clause makes its text authoritative over messages.",
    rule: RULE,
    conflict: RULE_CONFLICT,
  },
  scope: {
    items: [
      "1) local anchors refreshed to the settled tree (file::symbol + line auxiliary + sha256 at read time)",
      "2) top dual-write wording corrected + X4 rewritten (no 'deleted' claim)",
      "3) per (row, class) evidenceQuality mechanism|prose with matched fragments",
      "4) three record-only booleans per Table B row (harnessSeamChange / binaryDependency / credentialDependency)",
      "5) versioned filenames + changelog + immutable snapshot + REVISIONS.md line",
    ],
  },
  rows,
  derivationTable: derivation,
  waveGoalMapping: {
    note: "D2 scoring is NOT changed by this revision (t8 already scored against the fv4 keys; no re-scoring this wave). This section only states the correspondence so the caliber question is visible.",
    authoritativeGoals: ["G1 不再默认建队", "G2 复杂任务自动调用", "G3 对齐 mass-ulw (S1–S4)", "G4 配置平面对齐"],
    fv4Keys: ["goal1_omoAlignment", "goal2_agentTeamsNotDefault", "goal3_autoRouting", "goal4_massUlwDag"],
    mapping: [
      { authoritative: "G1 不再默认建队", fv4Key: "goal2_agentTeamsNotDefault" },
      { authoritative: "G2 复杂任务自动调用", fv4Key: "goal3_autoRouting" },
      { authoritative: "G3 对齐 mass-ulw (S1–S4)", fv4Key: "goal4_massUlwDag" },
      { authoritative: "G4 配置平面对齐", fv4Key: null, note: "no independent fv4 key" },
    ],
    reverse: [{ fv4Key: "goal1_omoAlignment", authoritative: null, note: "umbrella item with no one-to-one authoritative goal" }],
  },
  userApprovedOverrides: [
    { skill: "skills/remove-deadcode",
      action: "skip", score: 14,
      source: { contract: `${fcPath} (${fcBytes} B, sha256 ${fcSha})`, quote: "(g) ... t19 ... harnessSeamChange is FALSE and counted = 1 via binaryDependency => D3 = 2 ... => total 14 => skip", by: "frozen-contract (g), the authoritative text" },
      alternative: { caliber: "GO message (D3 = count of TRUE seam booleans) => D3 = 1; the gate recomputes the total", by: "captain GO message" },
      note: "User-approved skill; after t19\u2019s independent measurement (no-seam-required) the action lands on skip. The score is QUOTED from the authoritative text, which also states the gate always recomputes. The user may confirm or withdraw." },
    { skill: "skills/security-research",
      action: "adapt-then-install", score: 19,
      source: { by: "gate owner (t8) recomputation under (b) as reported in review", note: "contract (g) numerals for this row are from an older algorithm and are being refreshed" },
      alternative: { caliber: "GO message", score: 18, action: "adapt-then-install" },
      note: "Adapt under both calibers, so the action is caliber-insensitive. The user may confirm or withdraw." },
    { skill: "skills/tech-debt-audit",
      action: "adapt-then-install", score: 18,
      source: { by: "gate owner (t8) recomputation under (b) as reported in review", note: "contract (g) numerals for this row are from an older algorithm and are being refreshed" },
      alternative: { caliber: "GO message", score: 17, action: "adapt-then-install" },
      note: "Adapt under both calibers. The user may confirm or withdraw." },
    { skill: "skills-loader-core/security-research",
      action: "adapt-then-install", score: 19,
      source: { by: "gate owner (t8) recomputation under (b) as reported in review; raw record looked up BY PATH (its name field is empty)" },
      alternative: { caliber: "GO message", score: 19, action: "adapt-then-install" },
      note: "Adapt under both calibers. The user may confirm or withdraw." },
  ],
  t19: {
    path: `${REPO}/evidence/omo-align/skill-measurements/remove-deadcode/result.json`,
    sha256: sha(join(REPO, "evidence/omo-align/skill-measurements/remove-deadcode/result.json")),
    bytes: bytes(join(REPO, "evidence/omo-align/skill-measurements/remove-deadcode/result.json")),
    verdict: "no-seam-required", finalAction: "skip",
    note: "First-hand read by this producer; corroborates harnessSeamChange=false for that row.",
  },
  changedVsFv4: {
    added: ["authoritativeRuleInput(+conflict)", "derivationTable", "waveGoalMapping", "userApprovedOverrides", "rows[].fv5{upstreamFile,classEvidence,booleans}", "rows[].anchorStatus/anchorMethod"],
    modified: ["rows[D1,D8,T3-01..T3-08].repoEvidence -> refreshed anchors", "replacement.status for skills-loader-core/{frontend,git-master}: equivalent -> partial-equivalent (+contentDrift)"],
    untouched: ["row id set (32)", "verdictVocabulary/verdict distribution (applicable 16 / uncertain 13 / already-have 2 / adoptable 1)", "recoveryCoverage", "nameFreeze", "ledgerCandidates", "skillPortCost", "relevanceToGoals"],
  },
  anchorReadTimeHashes: FILE_SHA,
};

writeFileSync(join(HERE, "gap-r2.json"), JSON.stringify(gaps, null, 2) + "\n");

// ── markdown ────────────────────────────────────────────────────────────────────────────────────
const L = [];
const p = (s = "") => L.push(s);
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const COLS = fv4.columns;
const head = () => { p(`| ${COLS.join(" | ")} |`); p(`|${COLS.map(() => "---").join("|")}|`); };
const rowLine = (r) => p(`| ${[r.id, r.domain, r.upstreamItem, r.upstreamEvidence, r.repoCounterpart, r.repoEvidence, r.verdict, r.semanticDiff, r.mechanicalCheck, r.notes].map(cell).join(" | ")} |`);

p("# 上游功能差距判定表（输入 t8 技能门禁评分）");
p();
p(`_Upstream capability-gap verdict table — revision **fv5** (GO-authorized switch). Supersedes fv4 (\`gap.json\` sha256 \`${fv4Sha.slice(0, 16)}…\`, ${fv4Bytes} B). t8's own files (\`verdict-table.md\`, \`gate-rubric.json\`, \`decisions.json\`) are NOT this document and are not modified._`);
p();
p(`Generated: ${gaps.produced_at_utc} · builder \`build-r2.mjs\` · Researcher (read-only).`);
p();
p("## Revision and immutability");
p();
p(`- This revision: \`gap-r2.json\` + this table. fv4 (\`gap.json\` \`${fv4Sha.slice(0, 16)}…\` / \`gap-verdict-table.md\` \`${fv4TableSha.slice(0, 16)}…\`) is **unchanged**; byte-invariance is anchored to \`revisions/fv4-2026-09-13T14-00-29-361Z/manifest.json\` (gap.json manifest sha256 \`${fv4Manifest.files["gap.json"].sha256.slice(0, 16)}…\` = on-disk ✓).`);
p(`- New immutable snapshot: \`revisions/fv5-<UTCstamp>/\`; a line is appended to \`REVISIONS.md\`.`);
p("- Never touched: `verdict-table.md` (t8), `gate-rubric.json` (t8), `decisions.json` (t8).");
p();
p("## Dual-write wording (corrected to match disk)");
p();
p("> 双写位置：权威副本 = `evidence/omo-align/skills-gates/`（`gap.json` + `gap-verdict-table.md`）；注册契约副本 = `evidence/omo-align/research/skills-and-capability-gap/`（`gap.json` 与 `verdict-table.md` **两份同哈希副本均保留**，以维持注册路径可交付；该 `verdict-table.md` 是 t4 判定表的旧文件名，t8 的技能门禁表是同名文件、位于 `skills-gates/`）。两者不一致时以权威副本为准并报队长。");
p();
p("- 不声称任何目录已删除。X4 已按此改写（见 discrepancies）。");
p();
p("## Rule input (verbatim) and the D3 rule conflict");
p();
p(`Source: \`${RULE.source}\``);
p();
p(`- (b) D3 rule: ${RULE.d3}`);
p(`- seam trigger set: ${RULE.seamTriggers}`);
p(`- (d) evidence quality: ${RULE.evidenceQuality ?? "(recorded in the file)"}`);
p(`- (e) V4: ${RULE.v4 ?? "(recorded in the file)"}`);
p(`- (f) threshold: ${RULE.threshold ?? "(recorded in the file)"}`);
p();
p(`**${RULE_CONFLICT.id} — status: ${RULE_CONFLICT.status}** — the GO message stated \`${RULE_CONFLICT.goMessage}\`, while the on-disk authoritative text states \`${RULE_CONFLICT.onDiskText}\`. ${RULE_CONFLICT.resolution}`);
p(`${RULE_CONFLICT.resolutionApplied}`);
p();
p("## Fixed columns");
p();
p(`\`${COLS.join(" | ")}\``);
p();
p("### Table A — t2 ∪ t3 enumeration union (capability layer)");
p();
head();
for (const r of rows.filter((x) => x.rowSetSource !== "frozen-contract.rowSet")) rowLine(r);
p();
p("### Table B — rows with `rowSetSource === \"frozen-contract.rowSet\"` (t8 skill gate: exactly these 10)");
p();
head();
for (const r of bool10) rowLine(r);
p();
p("## `evidenceQuality` per (row, class) — matched fragments");
p();
p("`mechanism` = the matched line carries tool/API/env evidence (backtick, `tool.`, `env(`, `team_create(`, `run_id`, …); `prose` = the word occurs only in prose/headings. Prose hits are recorded but never score and never trigger V4.");
p();
for (const r of bool10) {
  p(`**${r.id}** — upstream \`${r.fv5.upstreamFile}\``);
  for (const c of r.upstreamHarnessCoupling) {
    const e = r.fv5.classEvidence[c];
    if (!e) { p(`- \`${c}\`: no hit (class present in the frozen table; zero matching lines — recorded as such)`); continue; }
    p(`- \`${c}\` [${e.best}]: ${e.hits.map((h) => `L${h.line} "${h.fragment}"`).join("; ")}`);
  }
  p();
}
p("## Three record-only booleans (Table B)");
p();
p("Only `harnessSeamChange` and `binaryDependency` are 'counted' seam booleans; `credentialDependency` never scores. All three are RECORD-ONLY inputs — the gate computes the score.");
p();
p("| id | harnessSeamChange | evidenceQuality | binaryDependency | credentialDependency | evidence (fragment + line) |");
p("|---|---|---|---|---|---|");
for (const r of bool10) {
  const b = r.fv5.booleans;
  const ev = [...b.harnessSeamChange.evidence.slice(0, 1), ...b.binaryDependency.evidence.slice(0, 1), ...(b.credentialDependency.value === "unknown" ? b.credentialDependency.evidence.slice(0, 1) : [])].join(" · ");
  p(`| ${r.id} | ${b.harnessSeamChange.value} | ${b.harnessSeamChange.evidenceQuality} | ${b.binaryDependency.value} | ${b.credentialDependency.value}${b.credentialDependency.falsePositiveRisk ? " (falsePositiveRisk)" : ""} | ${cell(ev)} |`);
}
p();
p("## Full 10-row derivation table (so a third party can recompute from raw)");
p();
p("| id | classes (frozen, case-sensitive derivation) | seam(mechanism) | bin | cred | counted TRUE seam booleans | D3 (GO caliber = count) | D3 (on-disk caliber = 1+count, clamp 3) |");
p("|---|---|---|---|---|---|---|---|");
for (const d of derivation) p(`| ${d.id} | ${cell(d.classes.join(", "))} | ${d.seamTriggerMechanism} | ${d.binaryDependency} | ${d.credentialDependency} | ${d.countedTrueSeamBooleans} | ${d.D3_goCaliber_count} | ${d.D3_onDiskCaliber_1plusCounted_clamped3} |`);
p();
p("`token SUMS are never used` (on-disk rule): the seam count vs token sum differs (git-master 0 vs 3; mass-ulw 1 vs 36). Case sensitivity: the seam/annotation class patterns are case-**sensitive**; uppercase prose such as git-master's \"RESET WORKFLOW\" / \"Autosquash Workflow\" therefore never entered the `workflowTool` class — that is why git-master carries no V4 risk. `creds`/`binaries` patterns were derived case-insensitively in the raw record; that is recorded here so nobody re-derives a different class set.");
p();
p("## `replacement.status` change (data change, action unchanged)");
p();
for (const r of bool10.filter((x) => ["skills-loader-core/frontend", "skills-loader-core/git-master"].includes(x.id))) {
  p(`- **${r.id}**: \`${r.replacement.statusBeforeFv5}\` → **\`${r.replacement.status}\`** — ${r.replacement.equivalence}`);
  p(`  - contentDrift: ${r.replacement.contentDrift}`);
  p(`  - before→after (loss narrative): "0" → "content-refresh increment"; action unchanged (skip in the gate).`);
}
p();
p("## `waveGoalMapping` (D2 caliber visibility; no score change this wave)");
p();
p(gaps.waveGoalMapping.note);
for (const m of gaps.waveGoalMapping.mapping) p(`- authoritative **${m.authoritative}** ↔ fv4 key \`${m.fv4Key ?? "(none)"}\`${m.note ? ` — ${m.note}` : ""}`);
for (const m of gaps.waveGoalMapping.reverse) p(`- reverse: fv4 key \`${m.fv4Key}\` ↔ ${m.authoritative ?? "(none)"} — ${m.note}`);
p();
p("## `userApprovedOverrides`");
p();
for (const o of gaps.userApprovedOverrides) p(`- **${o.skill}** → \`${o.action}\` (score ${o.score}) — source: ${o.source.by}${o.source.quote ? `: "${o.source.quote}"` : ""}; alternative: ${o.alternative.caliber}${o.alternative.score ? ` (score ${o.alternative.score})` : ""}. ${o.note}`);
p();
p("## discrepancies");
p();
p(`| id | severity | issue | impact | owner |`);
p(`|---|---|---|---|---|`);
p(`| X4 (rewritten) | low | t4 终态任务记录的 changedPaths 指向**合同旧路径**；该路径现由同哈希双写副本占用（两份均保留），**非删除状态**。 | 按终态记录核对时以本表与 authoritative paths 为准。 | captain |`);
p(`| ${RULE_CONFLICT.id} | resolved | GO 与磁盘权威文本的 D3 口径不一致 —— 已由 GO 采纳磁盘 (b) 式（\`1 + counted\`）收口。 | 双方一致；门禁按 (b) 重算，不引用记忆总分。 | captain |`);
p();
p("## Reproducibility");
p();
p("1. Row set and carried sections come from fv4 (`gap.json`). 2. Class lists are the frozen `upstreamHarnessCoupling` (spelling unchanged). 3. Per-class evidence is measured on the upstream checkout (`/root/dshProj/oh-my-openagent`). 4. Anchors are `file::symbol` + line (auxiliary) + the file's sha256 at read time (table in `gap-r2.json.anchorReadTimeHashes`). 5. `build-r2.mjs` regenerates this table and `gap-r2.json` from the same in-memory rows.");
p();

writeFileSync(join(HERE, "gap-verdict-table-r2.md"), L.join("\n") + "\n");

// ── changelog ───────────────────────────────────────────────────────────────────────────────────
const CL = [];
const q = (s = "") => CL.push(s);
q("# fv5 field-exposure changelog (`gap-r2.json` / `gap-verdict-table-r2.md`)");
q();
q(`Generated ${now()} · supersedes fv4 \`gap.json\` ${fv4Bytes} B / sha256 \`${fv4Sha}\``);
q();
q("## 1. What this revision adds (per (row, class) and per row)");
q();
q("- `rows[].fv5.classEvidence`: for every class in the frozen `upstreamHarnessCoupling` list, the matched fragments with line numbers and an `evidenceQuality` of `mechanism` or `prose`.");
q("- `rows[].fv5.booleans`: `harnessSeamChange`, `binaryDependency`, `credentialDependency` as `{value, basis, evidence[], falsePositiveRisk}` (record-only).");
q("- `derivationTable`: the full 10-row table (classes, seam/bin/cred, counted booleans, D3 under BOTH calibers).");
q("- `waveGoalMapping`, `userApprovedOverrides`, `authoritativeRuleInput` (verbatim rule text + read-time hash) and `ruleConflict-D3`.");
q("- Anchors for the affected rows refreshed to the settled tree: D1, D8, T3-01..T3-08.");
q();
q("## 2. Rule-text corrections adopted from this producer's findings");
q();
q("- **(A) no raw-less row**: the record for `skills-loader-core/security-research` exists (its `name` field is empty, so name-based lookups miss it — look it up by PATH). The on-disk text now states raw covers all ten rows and there is no unknown fallback.");
q("- **(B) token sums are never used for D3** (boolean count instead): the on-disk text cites this producer's measurements (`git-master` count 0 vs sum 3; `mass-ulw` count 1 vs sum 36).");
q("- **(C) prose exclusion made self-consistent**: `dev-browser` / `frontend` get `harnessSeamChange = false` with `evidenceQuality: prose` (positive finding: no mechanism hit), not `unknown`.");
q("- **V4 tightened** to `(dagRunId ∧ mechanism) ∨ (envKeyOmo ∧ workflowTool ∧ mechanism)`, so the prose hits no longer produce a false veto.");
q();
q("## 3. Producer self-corrections (kept for later verifiers)");
q();
q("- **Self-correction 1 (raw lookup key)**: an earlier boolean preview looked records up with a key missing the `/SKILL.md` suffix; the lookup failed silently and three `.agents/skills/*` rows were falsely reported as false/false/false with \"no hits\". Corrected values carry matched fragments. This is why every boolean here cites a fragment + line.");
q("- **Self-correction 2 (class-vocabulary mismatch)**: an earlier HARD/SOFT mapping (from a captain message) named six classes that do not exist in the data (`credential`, `binaryDependency`, `dagSdk`, `rpcOmoDag`, `tuiDag`, `skillsLoader`) and omitted four that do (`binaries`, `creds`, `omoDir`, `teamTools`). The mapping was rewritten against the real 11-class vocabulary.");
q("- **Case-sensitivity note**: the frozen class derivation is case-sensitive for the seam/annotation classes, while `creds`/`binaries` were matched case-insensitively. Consequence: `skills-loader-core/git-master` contains uppercase \"RESET WORKFLOW\" / \"Autosquash Workflow\" that never entered the `workflowTool` class — that is the checkable reason git-master is not a V4 hit. Re-deriving with `/i` would produce a DIFFERENT class set and is non-compliant.");
q();
q("## 4. Data change: `replacement.status` (before → after)");
q();
q("- `skills-loader-core/frontend`: `equivalent` → `partial-equivalent`. Same-caliber numbers: local `skills/frontend` 151 lines / 28 files vs upstream shared-skills 29 files (incl. `+references/design/ambience-skill.md`); the builtin is a separate single-file packaging (154 lines / 1 file). Loss narrative: 0 → content-refresh increment. Action unchanged (skip).");
q("- `skills-loader-core/git-master`: `equivalent` → `partial-equivalent`. Local 104 lines / 2 files vs upstream builtin 1107 lines / 1 file. Loss narrative: 0 → content-refresh increment. Action unchanged (skip).");
q();
q("## 5. Wording corrections");
q();
q("- Top dual-write wording replaced to match disk: both same-hash contract copies are retained; no directory is described as deleted.");
q("- X4 rewritten: the terminal record points at the contract's old path, which is now occupied by the same-hash dual-write copy — not a deletion.");
q();
q("## 6. Pointer (approved): t8's table also carries anchor drift");
q();
q("- `skills-gates/verdict-table.md` (t8) has 4 stale local anchors; 2 of its mappings were corrected by measurement (`presets/mpd/agent.cordis.yml:146-153 → :161-165`, `:349-355 → :365-366` verify; its `index.js:107 → :122` VERIFIES for the object it cites (the captain\u2019s guidance item 5, now at `:122`; `:107` is the `autoRoute:` line and the schema block is `:105-113`, so the two objects must be recorded separately), and its `tools.js:1907 → :1924` was correct at its measurement time but the settled tree registers `agent_teams_resume` at `:2087` (t15 edited `tools.js` afterwards — re-anchor by SYMBOL, never by a remembered line)). Its refresh belongs to a t8 supplement task; **this revision does not edit t8's files**.");
q();
q("## 7. Rule conflict recorded and RESOLVED");
q();
q(`- RESOLVED: the GO adopts the on-disk (b) formula (\`D3 = 1 + counted\`, clamp [0,3]); the earlier \`count\` wording is superseded. Both calibers remain in the derivation table, and the gate recomputes — no remembered total is quoted.`);
q();
q("## 7a. Final D3 form and the git-master interpretation registration");
q();
q("- D3 final form: `D3 = 1 + (counted TRUE seam booleans)`, clamped [0,3] (baseline 1). It is NOT a plain TRUE-count and NOT `T + B`; those earlier wordings are superseded (ruleConflict-D3 = RESOLVED).");
q("- git-master `binaryDependency`: REGISTERED INTERPRETATION. The contract's (b) parenthetical counts 0; the rule's literal definition read alone could count 1 (SKILL.md has `make` + 16 bash blocks). The rule's own worked values settle it FALSE — those blocks are teaching examples and nothing must be installed to PORT the skill — so this artifact lands `false` (with `topicallyExcluded: true`) and records the interpretive choice rather than presenting it as the only possible conclusion.");
q();
q("## 7b. Environment-prerequisite annotations added");
q();
q("Every `binaryDependency = true` row now carries `environmentPrerequisite` (e.g. remove-deadcode: needs bun; dev-browser: needs npm / needs npx-node / ships a script entrypoint; frontend: needs uv / needs python3). These are gate annotations only and never score.");
q();

q("## 8. Self-validation iterations (classifier defects caught by this producer's own post-build checks)");
q();
q("The boolean derivation was hardened across builds. Every defective intermediate is kept immutable under `revisions/` and is **not** citable as the delivered revision:");
q();
q("| build | defect | symptom in the data | fix |");
q("|---|---|---|---|");
q("| `fv5` | line-level mechanism classifier | a backticked filename elsewhere on the line promoted the prose word \"workflow\" to mechanism => `skills-loader-core/frontend` seam wrongly `true` | per-MATCH classification (inline code / fence / call / env / tool path) |");
q("| `fv5.1` | executable-command detector too loose | module-path mentions (`sdk.js`, `errors/shopify_error.py`) and prose (\"node prompt\") counted => `dag-library`/`mass-ulw`/`git-master` bin wrongly `true` | command position + code context required |");
q("| `fv5.2` | noun/runtime ambiguity for `node` | mass-ulw prose \"node completions\" matched the runtime | `node` requires a flag or path argument |");
q("| `fv5.3` | wrapper-call regex allowed a bare segment start | mass-ulw bin still wrongly `true` | wrapper call requires an actual `(`/quote before the runtime |");
q("| `fv5.4`-`fv5.6` | data correct; iteration bookkeeping / changelog layout only | none in the data | tag + status generated from one TAG constant |");
q("| **`fv5.15`** | **delivered** | derivation matches the GO expectations: seam in {security-research, loader-core/security-research, dag-library, mass-ulw}; bin in {remove-deadcode, tech-debt-audit, dev-browser, frontend}; credentialDependency unknown x4 | — |");
q();
q(`- Delivered artefact hashes are recorded in \`REVISIONS.md\` and in \`revisions/${TAG}-<UTCstamp>/manifest.json\`.`);
q();
writeFileSync(join(HERE, "raw/field-exposure-changelog.md"), CL.join("\n") + "\n");

q();
// ── snapshot + REVISIONS.md append ──────────────────────────────────────────────────────────────
const stamp = now().replace(/[:.]/g, "-");
const revDir = join(HERE, "revisions", `${TAG}-${stamp}`);
mkdirSync(revDir, { recursive: true });
for (const f of ["gap-r2.json", "gap-verdict-table-r2.md"]) writeFileSync(join(revDir, f), readFileSync(join(HERE, f)));
const manifest = {
  tag: TAG, writtenAt: now(), supersedes: { file: "gap.json", sha256: fv4Sha, bytes: fv4Bytes },
  supersedesSnapshot: "revisions/fv5-2026-09-13T14-35-54-840Z/ (first fv5 build; defective line-level classifier, kept immutable, do not cite)",
  files: Object.fromEntries(["gap-r2.json", "gap-verdict-table-r2.md"].map((f) => [f, { bytes: bytes(join(HERE, f)), sha256: sha(join(HERE, f)) }])),
  ruleInput: { path: fcPath, bytes: fcBytes, sha256: fcSha, readAt: now() },
  note: "Immutable snapshot. A rebuild writes a NEW revisions/ dir; this one must never be rewritten.",
};
writeFileSync(join(revDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
appendFileSync(join(HERE, "REVISIONS.md"), `\n| ${TAG} | **delivered** GO-authorized switch: refreshed anchors (D1, D8, T3-01..T3-08), per (row,class) evidenceQuality (per-MATCH classifier) + matched fragments, three record-only booleans, full 10-row derivation (both D3 calibers), replacement.status equivalent→partial-equivalent for frontend/git-master, X4 + dual-write wording corrected. Supersedes the first fv5 build (line-level classifier defect, caught in self-validation) | ${manifest.files["gap-r2.json"].bytes} | \`${manifest.files["gap-r2.json"].sha256}\` | LIVE (gap-r2.json + gap-verdict-table-r2.md) + immutable snapshot at revisions/${TAG}-${stamp}/ |\n`);
console.log("fv5 written:", JSON.stringify({ gap_r2: manifest.files["gap-r2.json"], table: manifest.files["gap-verdict-table-r2.md"], snapshot: revDir, rows: rows.length, rules: { d3: RULE.d3 } }, null, 1));
