// The specialist roster. Each entry is a SPECIALIST definition with a
// stable id (a modelchain chain key) and a normal, functional display name.
// ids are stable because they double as mpd-modelchain chain keys and are
// referenced across skills/docs; only the human-facing `name`/`description`
// were renamed to plain functional names. Hand-maintained since the one-time
// migration generator (scripts/gen-roles.mjs) lost its input preset tree.
// Consumer surfaces: mpd_roles_list / mpd_role_spawn (roster lookup),
// mpd_role_persona (text for spawn surfaces — the official Agent Teams
// `spawn_teammate` takes it as the teammate's prompt), and mpd_modelchain_resolve
// (chain lookup). Team mode is the OFFICIAL Agent Teams plugin, whose Lead stages
// these members BY NAME (`spawn_teammate` + `team_task_create`).
export interface MpdRoleSpec {
  /** The STABLE chain key — also the `personas/<id>.md` file name and the workmate `meta.baseId`. INTERNAL: no tool output, description, render, web route or GUI ever exposes it. */
  id: string
  /** The functional display name a teammate is addressed by — the ONLY base key any tool accepts. */
  name: string
  /** One-line role summary, shown wherever the roster is listed. */
  description: string
  /** Read-only roles spawn with a write-tool deny filter; workers spawn unrestricted. */
  readonly: boolean
  /** The model-chain candidates for this member, tried in order by `mpd_modelchain_resolve`. */
  chain: Array<{ provider: string; model: string }>
  /** Path of the persona template, relative to this package, read by `mpd_role_persona`. */
  personaFile: string
}

/** The eleven specialists, in the order the roster lists them. */
export const ROLES: MpdRoleSpec[] = [
  {
    "id": "oracle",
    "name": "Architect",
    "description": "Strategic technical advisor: architecture review, deep debugging, self-review.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/oracle.md"
  },
  {
    "id": "librarian",
    "name": "Researcher",
    "description": "Evidence-based code/open-source search (AST/LSP/web evidence collection).",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/librarian.md"
  },
  {
    "id": "prometheus",
    "name": "Planner",
    "description": "Planning advisor: produces .mpd/plans plans only, never implements.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/prometheus.md"
  },
  {
    "id": "hephaestus",
    "name": "Deep Worker",
    "description": "Autonomous deep worker: executes goals end-to-end with tools, verifies every change.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/hephaestus.md"
  },
  {
    "id": "sisyphus",
    "name": "Senior Engineer",
    "description": "Primary engineering agent: plan small, execute with tools, verify, report honestly.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/sisyphus.md"
  },
  {
    "id": "atlas",
    "name": "Lead",
    "description": "Orchestrator: macro planning, delegate roles, integrate results.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/atlas.md"
  },
  {
    "id": "explore",
    "name": "Explorer",
    "description": "Read-only codebase explorer: finds files and code, returns evidence, never edits.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/explore.md"
  },
  {
    "id": "metis",
    "name": "Reviewer",
    "description": "Deep reviewer: correctness and risk findings with evidence, no fixes.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/metis.md"
  },
  {
    "id": "momus",
    "name": "Plan Reviewer",
    "description": "Work-plan QA reviewer: verifies the plan is executable and its references valid, rejects only true blockers.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" }
    ],
    "personaFile": "personas/momus.md"
  },
  {
    "id": "multimodal-looker",
    "name": "Vision Analyst",
    "description": "Image/diagram analyst: read screenshots/diagrams and describe precisely.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash-vision-exp" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/multimodal-looker.md"
  },
  {
    "id": "sisyphus-junior",
    "name": "Junior Engineer",
    "description": "Fast executor: small, well-scoped mechanical changes with quick verification.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/sisyphus-junior.md"
  }
]

/** The roster indexed by stable id, for the internal chain lookups that key on it. */
export const ROLE_BY_ID: Record<string, MpdRoleSpec> = Object.fromEntries(ROLES.map((r) => [r.id, r]))