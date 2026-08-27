import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
var name = "mpd-team";
var inject = ["tools", "subagents"];
var ROLE_MODEL = {
  oracle: { provider: "deepseek-official", model: "deepseek-v4-pro" },
  prometheus: { provider: "deepseek-official", model: "deepseek-v4-pro" },
  librarian: { provider: "deepseek-official", model: "deepseek-v4-flash" },
  hephaestus: { provider: "deepseek-official", model: "deepseek-v4-flash" }
};
var ROLE_PERSONA = {
  oracle: "You are a strategic technical advisor. Give one clear recommendation with rationale and watch-outs.",
  prometheus: "You are Prometheus, a planning consultant. Produce a decision-complete plan only.",
  librarian: "You are THE LIBRARIAN. Answer with evidence and citations.",
  hephaestus: "You are Hephaestus, a configuration manager. Read-only analysis with minimal diffs."
};
var MEMBER_SCHEMA = {
  type: "object",
  properties: { role: { type: "string" }, summary: { type: "string" }, recommendation: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
  required: ["role", "summary", "recommendation", "evidence"],
  additionalProperties: false
};
function textBlock(text) {
  return [{ type: "text", text }];
}
function apply(ctx, config = {}) {
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
  const stateDir = config.stateDir ?? join(cwd, ".mpd", "team");
  ctx.tools.register({
    name: "mpd_team_spawn",
    description: "Spawn a small parallel team (2-4 roles among oracle/prometheus/librarian/hephaestus) for one task; each member runs with its role persona and model route; results land in the team mailbox state file and an aggregated report is returned.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string" },
        roles: { type: "array", items: { type: "object", properties: { role: { type: "string" }, prompt: { type: "string" } }, required: ["role", "prompt"] } }
      },
      required: ["task", "roles"]
    },
    output: {
      schema: { type: "object", properties: { teamId: { type: "string" }, members: { type: "integer" }, report: { type: "string" }, stateFile: { type: "string" } }, required: ["teamId", "members", "report"] },
      render: (_a, v) => textBlock("team " + v.teamId + " (" + v.members + ` members)
` + v.report + `
state: ` + v.stateFile)
    },
    execute: async (args, exec) => {
      const roles = (args?.roles ?? []).slice(0, 4);
      if (roles.length < 2)
        throw new Error("mpd_team_spawn: need 2..4 roles");
      const task = String(args.task);
      const id = "team-" + randomUUID().slice(0, 8);
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, id + ".json");
      const starts = roles.map((r) => {
        const role = String(r.role);
        const route = config?.provider ? { provider: config.provider, model: config.model ?? ROLE_MODEL[role]?.model } : ROLE_MODEL[role] ?? { provider: "deepseek-official", model: "deepseek-v4-flash" };
        const prompt = "TEAM ROLE: " + role + `
` + (ROLE_PERSONA[role] ?? "") + `

Shared task: ` + task + `

Your brief: ` + String(r.prompt) + `

Work independently with tools; end with ONLY the structured report (role/summary/recommendation/evidence).`;
        return ctx.subagents.start("spawn", {
          label: id + "-" + role,
          prompt: textBlock(prompt),
          parent: exec.agent,
          signal: exec.signal,
          agentOptions: route,
          persona: ROLE_PERSONA[role] ?? "You are a specialist working on a shared task.",
          outputSchema: MEMBER_SCHEMA
        }).then(async (run) => ({ role, result: await run.result }));
      });
      const settled = await Promise.all(starts);
      const mailbox = {};
      for (const s of settled)
        mailbox[s.role] = { role: s.role, structured: s.result.structured ?? {}, stopReason: s.result.stopReason };
      writeFileSync(stateFile, JSON.stringify({ id, task, mailbox, updatedAt: new Date().toISOString() }, null, 2));
      const report = settled.map((s) => {
        const r = s.result.structured ?? {};
        return "- [" + s.role + "] " + String(r.summary ?? s.result.stopReason ?? "no output") + `
  recommendation: ` + String(r.recommendation ?? "-");
      }).join(`
`);
      return { teamId: id, members: settled.length, report, stateFile };
    }
  });
  ctx.tools.register({
    name: "mpd_team_status",
    description: "Read the mailbox state file of a spawned team.",
    parameters: { type: "object", properties: { teamId: { type: "string" } }, required: ["teamId"] },
    output: { schema: { type: "object", properties: { found: { type: "boolean" }, report: { type: "string" } }, required: ["found", "report"] }, render: (_a, v) => textBlock(v.report) },
    execute: async (args) => {
      const id = String(args.teamId);
      try {
        const { readFileSync } = await import("node:fs");
        const state = JSON.parse(readFileSync(join(stateDir, id + ".json"), "utf8"));
        return { found: true, report: JSON.stringify(state.mailbox ?? {}) };
      } catch {
        return { found: false, report: "team state not found: " + id };
      }
    }
  });
}
export {
  apply,
  inject,
  name
};
