import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
var name = "mpd-team";
var inject = ["tools", "subagents"];
var DEFAULT_SPECIALIST_PERSONA = "You are a specialist working on a shared task.";
var WRITE_DENY = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit"];
var MEMBER_SCHEMA = {
  type: "object",
  properties: { role: { type: "string" }, summary: { type: "string" }, recommendation: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
  required: ["role", "summary", "recommendation", "evidence"],
  additionalProperties: false
};
function textBlock(text) {
  return [{ type: "text", text }];
}
function rosterKey(role) {
  const k = String(role ?? "").trim();
  if (!k)
    return null;
  if (k.startsWith("mpd-"))
    return k.slice(4);
  if (k === "sisyphusJunior")
    return "sisyphus-junior";
  if (k === "multimodalLooker")
    return "multimodal-looker";
  return k;
}
function apply(ctx, config = {}) {
  const cwd = process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
  function confStateDir() {
    const mpdConfig = ctx.get?.("mpdConfig");
    const v = mpdConfig?.get?.("team.stateDir");
    return typeof v === "string" && v ? v : config.stateDir ?? join(cwd, ".mpd", "team");
  }
  ctx.tools.register({
    name: "mpd_team_spawn",
    description: "Spawn a small parallel team (2-4 members) for one task. Each member is either a roster role (oracle/prometheus/librarian/hephaestus/explore/metis/momus/atlas/sisyphus/sisyphus-junior/multimodal-looker - roster persona + model route + read-only discipline applied automatically; legacy mpd-<id> keys accepted) or a custom role with an explicit prompt. Results land in the team mailbox state file and an aggregated report is returned.",
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
      const stateDir = confStateDir();
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, id + ".json");
      const rolesService = ctx.get?.("mpdRoles");
      const starts = roles.map((r) => {
        const role = String(r.role);
        const key = rosterKey(role);
        const spec = key ? rolesService?.get?.(key) : null;
        const route = config?.provider ? { provider: config.provider, model: config.model ?? spec?.chain?.[0]?.model ?? "deepseek-v4-flash" } : spec?.chain?.[0] ?? { provider: "deepseek-official", model: "deepseek-v4-flash" };
        const persona = typeof spec?.persona === "string" && spec.persona ? spec.persona : DEFAULT_SPECIALIST_PERSONA;
        const prompt = "TEAM ROLE: " + role + `

Shared task: ` + task + `

Your brief: ` + String(r.prompt) + `

Work independently with tools` + (spec?.readonly ? " (read-only: never modify anything)" : "") + "; end with ONLY the structured report (role/summary/recommendation/evidence).";
        return ctx.subagents.start("spawn", {
          label: id + "-" + role,
          prompt: textBlock(prompt),
          parent: exec.agent,
          signal: exec.signal,
          agentOptions: { provider: route.provider, model: route.model },
          persona,
          outputSchema: MEMBER_SCHEMA,
          ...spec?.readonly ? { toolFilter: { deny: WRITE_DENY } } : {}
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
        const state = JSON.parse(readFileSync(join(confStateDir(), id + ".json"), "utf8"));
        return { found: true, report: JSON.stringify(state.mailbox ?? {}) };
      } catch {
        return { found: false, report: "team state not found: " + id };
      }
    }
  });
}
export {
  name,
  inject,
  apply
};
