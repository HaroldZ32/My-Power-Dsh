// packages/mpd-leaf-plugin/src/index.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
var name = "mpd-leaf";
var inject = ["tools", "subagents"];
var ADVISOR_BASES = new Set([
  "mpd-oracle",
  "mpd-librarian",
  "mpd-explore",
  "mpd-metis",
  "mpd-momus",
  "mpd-prometheus",
  "mpd-multimodal-looker"
]);
var ALL_LEAF_DENY = [
  "subagent",
  "subagent_fork",
  "workflow",
  "agent_teams_create",
  "agent_teams_add_member",
  "agent_teams_remove_member",
  "agent_teams_create_task",
  "agent_teams_reassign_task",
  "agent_teams_resume",
  "agent_teams_delete",
  "agent_teams_approve",
  "agent_teams_edit_plan",
  "agent_teams_send_message",
  "agent_teams_status",
  "mpd_leaf_iterate"
];
var ADVISOR_DENY_EXTRA = ["bash", "write", "edit", "str_replace_editor", "create_goal", "update_goal", "mpd_gate_run", "ralph"];
var GATE_DEFS = {
  "bun-test": { command: "bun test packages --test-timeout 60000", timeoutMs: 300000, allowErrors: 0 },
  tsgo: { command: "tsgo --noEmit", timeoutMs: 300000, allowErrors: 108, prependPath: ".toolchain/node_modules/.bin" },
  "qa-self": { command: "node skills/dsh-qa/scripts/mount-assert.mjs --self-test", timeoutMs: 300000, allowErrors: 0 },
  golden: { command: "node tests/golden/run.mjs", timeoutMs: 300000, allowErrors: 0 }
};
function gateDef(name2) {
  if (name2.startsWith("golden:")) {
    return { command: "node tests/golden/run.mjs --task " + name2.slice("golden:".length), timeoutMs: 300000, allowErrors: 0 };
  }
  const d = GATE_DEFS[name2];
  if (!d)
    throw new Error("unknown gate: " + name2);
  return d;
}
var ROUND_SCHEMA = {
  type: "object",
  properties: {
    round: { type: "integer" },
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    gates: { type: "object", properties: { ran: { type: "boolean" }, passed: { type: "boolean" } }, required: ["ran", "passed"] },
    uncertain: { type: "array", items: { type: "string" } }
  },
  required: ["round", "summary", "changes", "gates", "uncertain"],
  additionalProperties: false
};
function textBlock(text) {
  return [{ type: "text", text }];
}
function cwd() {
  return process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
}
function stateRoot(config) {
  return resolve(config.stateDir ?? join(cwd(), ".mpd", "leaf"));
}
function pkgRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}
function presetDirRoot() {
  const home = process.env.DSH_HOME || join(process.env.HOME ?? "/", ".dsh");
  return join(home, ".agent-presets");
}
function extractPersonaText(raw) {
  const m = raw.match(/text:\s*>-([\s\S]*?)\n- id:/);
  if (!m)
    return;
  return m[1].replace(/^ {6}/gm, "").trim();
}
function presetPersona(basePreset) {
  const candidates = [
    join(pkgRoot(), "presets", basePreset, "agent.cordis.yml"),
    join(presetDirRoot(), basePreset, "agent.cordis.yml")
  ];
  for (const p of candidates) {
    if (!existsSync(p))
      continue;
    const t = extractPersonaText(readFileSync(p, "utf8"));
    if (t)
      return t;
  }
  return;
}
function runGate(name2) {
  let def;
  try {
    def = gateDef(name2);
  } catch (e) {
    return { name: name2, ok: false, exit: null, errors: 0, tail: String(e) };
  }
  const env = { ...process.env };
  if (def.prependPath) {
    const p = join(cwd(), def.prependPath);
    env.PATH = p + (process.platform === "win32" ? ";" : ":") + (env.PATH ?? "");
  }
  const r = spawnSync(def.command, [], { shell: true, cwd: cwd(), env, encoding: "utf8", timeout: def.timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).toString();
  const errors = (out.match(/error TS\d+/g) ?? []).length;
  const ok = r.status === 0 || name2 === "tsgo" && errors <= def.allowErrors;
  return { name: name2, ok, exit: r.status, errors, tail: out.slice(-1800) };
}
function runGates(names) {
  const list = (names && names.length > 0 ? names : Object.keys(GATE_DEFS)).slice(0, 6);
  return list.map((n) => runGate(n));
}
function writeEvidence(root, id, data) {
  mkdirSync(root, { recursive: true });
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "run.json");
  writeFileSync(f, JSON.stringify(data, null, 2));
  return f;
}
function apply(ctx, config = {}) {
  const provider = config.provider ?? "deepseek-official";
  const model = config.model ?? "deepseek-v4-pro";
  const maxRounds = Math.min(Math.max(config.maxRounds ?? 3, 1), 12);
  ctx.tools.register({
    name: "mpd_gate_run",
    description: "Run the repository gate suite (bun test packages / tsgo with the 108-error debt baseline / dsh-qa self-test) in the current project and report structured results. Use as a leaf's completion criterion.",
    parameters: {
      type: "object",
      properties: { gates: { type: "array", items: { type: "string" } } },
      required: []
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, results: { type: "array", items: { type: "object" } } }, required: ["ok", "results"] },
      render: (_a, v) => textBlock("gates ok=" + String(v.ok) + `
` + (v.results ?? []).map((g) => "- " + String(g.name) + " ok=" + String(g.ok) + " exit=" + String(g.exit) + " errors=" + String(g.errors)).join(`
`))
    },
    execute: async (args) => {
      const results = runGates(args?.gates);
      const ok = results.every((g) => g.ok);
      if (ctx.logger?.info)
        ctx.logger.info("mpd_gate_run ok=" + ok + " results=" + JSON.stringify(results.map((g) => ({ name: g.name, ok: g.ok, exit: g.exit, errors: g.errors }))));
      return { ok, results: results.map((g) => ({ name: g.name, ok: g.ok, exit: g.exit, errors: g.errors, tail: g.tail })) };
    }
  });
  ctx.tools.register({
    name: "mpd_leaf_iterate",
    description: "Run a leaf task in fresh one-shot rounds (Ralph pattern) with an mpd-* OMO preset as the leaf base persona. Each round is a new child with compact prior-round context; the loop exits when the real project gates pass or maxRounds is hit. Leaves deny re-delegation (toolFilter).",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        basePreset: { type: "string" },
        maxRounds: { type: "integer" },
        context: { type: "string" },
        requireGate: { type: "boolean" },
        gates: { type: "array", items: { type: "string" } }
      },
      required: ["objective", "basePreset"]
    },
    output: {
      schema: { type: "object", properties: { leafId: { type: "string" }, rounds: { type: "integer" }, done: { type: "boolean" }, gatePassed: { type: "boolean" }, evidenceFile: { type: "string" }, roundSummaries: { type: "array", items: { type: "string" } } }, required: ["leafId", "rounds", "done", "gatePassed", "roundSummaries"] },
      render: (_a, v) => textBlock("leaf " + v.leafId + " rounds=" + v.rounds + " done=" + v.done + " gatePassed=" + v.gatePassed + `
` + (v.roundSummaries ?? []).map((s) => "- " + s).join(`
`) + `
evidence: ` + v.evidenceFile)
    },
    execute: async (args, exec) => {
      const objective = String(args.objective ?? "");
      const basePreset = String(args.basePreset ?? "");
      if (!objective || !basePreset.startsWith("mpd-"))
        throw new Error("mpd_leaf_iterate: objective and basePreset (mpd-*) are required");
      const persona = presetPersona(basePreset);
      if (!persona)
        throw new Error("mpd_leaf_iterate: persona text for basePreset '" + basePreset + "' not found in presets/ or $DSH_HOME/.agent-presets");
      const advisor = ADVISOR_BASES.has(basePreset);
      const rounds = Math.min(Math.max(args?.maxRounds ?? maxRounds, 1), 12);
      const requireGate = Boolean(args?.requireGate ?? !advisor);
      const runGatesNames = Array.isArray(args?.gates) ? args.gates.map(String) : config.gates ?? ["bun-test"];
      const deny = [...ALL_LEAF_DENY, ...advisor ? config.advisorDeny ?? ADVISOR_DENY_EXTRA : []];
      const id = "leaf-" + randomUUID().slice(0, 8);
      const root = stateRoot(config);
      const records = [];
      const summaries = [];
      let gatePassed = false;
      for (let round = 1;round <= rounds; round++) {
        const prior = records.slice(-2).map((rec) => {
          const s = rec.structured ?? {};
          return "r" + String(rec.round) + ": " + String(s.summary ?? (rec.tail ? String(rec.tail).slice(0, 200) : "no summary"));
        }).join(`
`);
        const prompt = [
          "ROUND " + round + " / " + rounds + " of a single-project leaf iteration.",
          "BASE PERSONA (mpd-* OMO preset): " + basePreset,
          "",
          persona,
          "",
          "OBJECTIVE (single project, this workspace):",
          objective,
          "",
          args?.context ? `CAPTAIN CONTEXT:
` + String(args.context) : "",
          prior ? `PRIOR ROUNDS (compact):
` + prior : "",
          "",
          "LEAF GATES: " + runGatesNames.join(", "),
          advisor ? "Advisory leaf: read-only work. Do not modify files. Answer with evidence and citations; end with the structured report." : "Executor leaf: do the work IN THIS PROJECT, then call mpd_gate_run with gates: [" + runGatesNames.join(", ") + "] before finishing; if any gate fails, fix and re-run (bounded by this round). Stop when gates pass.",
          "",
          "End with ONLY the structured report {round, summary, changes, gates:{ran,passed}, uncertain}."
        ].filter(Boolean).join(`
`);
        let run;
        try {
          run = await ctx.subagents.start("spawn", {
            label: id + "-r" + round,
            prompt: textBlock(prompt),
            parent: exec.agent,
            signal: exec.signal,
            agentOptions: { provider, model },
            persona,
            toolFilter: { deny },
            outputSchema: ROUND_SCHEMA
          });
          const result = await run.result;
          const structured = result.structured ?? {};
          const tail = (result.output ?? []).map((b) => b.text ?? "").join("").slice(-1500);
          const gates = requireGate ? runGates(runGatesNames) : [];
          const ok = !requireGate || gates.every((g) => g.ok);
          records.push({ round, structured, tail, gates: gates.map((g) => ({ name: g.name, ok: g.ok, errors: g.errors })), ok });
          summaries.push("r" + round + ": " + String(structured.summary ?? "no summary") + (ok ? " [gates PASS]" : " [gates FAIL]"));
          if (ok) {
            gatePassed = true;
            break;
          }
        } catch (e) {
          records.push({ round, error: String(e) });
          summaries.push("r" + round + ": ERROR " + String(e).slice(0, 160));
          if (round === rounds)
            break;
        } finally {
          if (run?.dispose) {
            try {
              await run.dispose();
            } catch {}
          }
        }
      }
      const evidenceFile = writeEvidence(root, id, { id, objective, basePreset, advisor, maxRounds: rounds, requireGate, gatePassed, records, updatedAt: new Date().toISOString() });
      return {
        leafId: id,
        rounds: records.length,
        done: gatePassed || records.length >= rounds,
        gatePassed,
        roundSummaries: summaries,
        evidenceFile
      };
    }
  });
}
export {
  apply,
  inject,
  name
};
