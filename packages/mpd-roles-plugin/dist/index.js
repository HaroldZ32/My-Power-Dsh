// src/index.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// src/roles.data.ts
var ROLES = [
  {
    id: "oracle",
    name: "Architect",
    description: "Strategic technical advisor: architecture review, deep debugging, self-review.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
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
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/librarian.md"
  },
  {
    id: "prometheus",
    name: "Planner",
    description: "Planning advisor: produces .mpd/plans plans only, never implements.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/prometheus.md"
  },
  {
    id: "hephaestus",
    name: "Config Engineer",
    description: "Configuration management: explain profile/bundle/preset config and produce read-only diffs.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/hephaestus.md"
  },
  {
    id: "sisyphus",
    name: "Senior Engineer",
    description: "Primary engineering agent: plan small, execute with tools, verify, report honestly.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus.md"
  },
  {
    id: "atlas",
    name: "Lead",
    description: "Orchestrator: macro planning, delegate roles, integrate results.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/atlas.md"
  },
  {
    id: "explore",
    name: "Explorer",
    description: "Read-only codebase explorer: evidence-based answers, never edits.",
    readonly: true,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-flash" },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/explore.md"
  },
  {
    id: "metis",
    name: "Reviewer",
    description: "Deep reviewer: correctness/risk findings with evidence, no fixes.",
    readonly: false,
    chain: [
      { provider: "deepseek-official", model: "deepseek-v4-pro" },
      { provider: "deepseek-official", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/metis.md"
  },
  {
    id: "momus",
    name: "UX Critic",
    description: "UI/UX and interaction critic: concrete, testable critiques.",
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
      { provider: "deepseek", model: "deepseek-v4-flash" }
    ],
    personaFile: "personas/sisyphus-junior.md"
  }
];
var ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));

// src/index.ts
var name = "mpd-roles";
var inject = ["tools", "subagents"];
var READONLY_DENY = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit"];
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
function textBlock(text) {
  return [{ type: "text", text }];
}
function pkgRoot() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
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
  return null;
}
function personaPath(config, spec) {
  return config.personasDir ? join(resolve(config.personasDir), spec.id + ".md") : join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md");
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
function apply(ctx, config = {}) {
  ctx.provide("mpdRoles", {
    list: () => ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: readPersona(config, r) })),
    get: (key) => {
      const id = normalizeRoleKey(key);
      if (!id)
        return null;
      const spec = ROLE_BY_ID[id];
      return { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: readPersona(config, spec) };
    }
  });
  ctx.tools.register({
    name: "mpd_roles_list",
    description: "List the specialist roster (ids → normal display names): Architect(oracle), Researcher(librarian), Planner(prometheus), Config Engineer(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), UX Critic(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). Use before mpd_role_spawn. Team mode uses the dsh-agent-teams profiles (agent_teams_create profile=mpd).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" } }, required: ["roles", "count"] }, render: (_a, v) => textBlock("roster (" + v.count + `):
` + v.roles.map((r) => "- " + r.id + " [" + r.model + (r.readonly ? " readonly" : "") + "] " + r.description).join(`
`)) },
    execute: async () => ({ roles: ROLES.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null })), count: ROLES.length })
  });
  ctx.tools.register({
    name: "mpd_role_spawn",
    description: "Spawn one specialist as a one-shot subagent with its roster persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Use ids from mpd_roles_list: Architect(oracle), Researcher(librarian), Planner(prometheus), Config Engineer(hephaestus), Senior Engineer(sisyphus), Lead(atlas), Explorer(explore), Reviewer(metis), UX Critic(momus), Vision Analyst(multimodal-looker), Junior Engineer(sisyphus-junior). For multi-member team work prefer the adopted dsh-agent-teams protocol (agent_teams_create + agent_teams_add_member), not repeated one-shot spawns.",
    parameters: { type: "object", properties: { role: { type: "string", description: "roster role id (mpd_roles_list)" }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" }, model: { type: "string", description: "optional model override (default: the role's primary route)" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete", "error"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a, v) => textBlock("role " + v.role + " (" + v.status + `)
summary: ` + v.summary + (v.recommendation ? `
recommendation: ` + v.recommendation : "") + (v.details ? `
details: ` + v.details : "") + (v.evidence?.length ? `
evidence:
- ` + v.evidence.join(`
- `) : "")) },
    execute: async (args, exec) => {
      const id = normalizeRoleKey(String(args?.role ?? ""));
      if (!id)
        throw new Error("mpd_role_spawn: unknown role '" + String(args?.role) + "' — call mpd_roles_list first");
      const spec = ROLE_BY_ID[id];
      const task = String(args?.task ?? "").trim();
      if (!task)
        throw new Error("mpd_role_spawn: task required");
      const persona = readPersona(config, spec);
      const provider = spec.chain[0]?.provider ?? "deepseek-official";
      const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : spec.chain[0]?.model;
      const prompt = persona + `

Task: ` + task + (args?.context ? `

Context:
` + String(args.context) : "") + `

Work with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence).`;
      const run = await ctx.subagents.start("spawn", {
        label: "role-" + id + "-" + randomUUID().slice(0, 8),
        prompt: textBlock(prompt),
        parent: exec.agent,
        signal: exec.signal,
        agentOptions: { provider, model },
        persona,
        outputSchema: REPORT_SCHEMA,
        ...spec.readonly ? { toolFilter: { deny: READONLY_DENY } } : {}
      });
      const result = run.result;
      const st = result.structured ?? {};
      return { role: id, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null };
    }
  });
  ctx.tools.register({
    name: "mpd_role_persona",
    description: "Return the full persona text of one roster role. Use it when a spawn surface takes the persona as TEXT (e.g. agent_teams_add_member persona=...), so the member gets the real role instructions instead of a bare id.",
    parameters: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a, v) => textBlock("persona " + v.role + " (" + v.chars + ` chars):
` + v.persona) },
    execute: async (args) => {
      const id = normalizeRoleKey(String(args?.role ?? ""));
      if (!id)
        throw new Error("mpd_role_persona: unknown role '" + String(args?.role) + "'");
      const persona = readPersona(config, ROLE_BY_ID[id]);
      return { role: id, persona, chars: persona.length };
    }
  });
}
export {
  readPersona,
  pkgRoot,
  normalizeRoleKey,
  name,
  inject,
  apply
};
