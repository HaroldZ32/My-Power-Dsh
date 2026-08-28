// The OMO-origin agent roster. Each entry is a SPECIALIST definition with a
// stable id (a modelchain chain key) and a normal, functional display name.
// ids are stable because they double as mpd-modelchain chain keys and are
// referenced across skills/docs; only the human-facing `name`/`description`
// were renamed to plain functional names. Hand-maintained since the one-time
// migration generator (scripts/gen-roles.mjs) lost its input preset tree.
// Consumer surfaces: mpd_roles_list / mpd_role_spawn (roster lookup),
// mpd_role_persona (text for spawn surfaces like agent_teams_add_member), and
// mpd_modelchain_resolve (chain lookup). Team mode uses the dsh-agent-teams
// `profiles` templates configured in the bundle patch (normal-named members).
export interface MpdRoleSpec {
  id: string
  name: string
  description: string
  /** Read-only roles spawn with a write-tool deny filter; workers spawn unrestricted. */
  readonly: boolean
  chain: Array<{ provider: string; model: string }>
  personaFile: string
}

export const ROLES: MpdRoleSpec[] = [
  {
    "id": "oracle",
    "name": "Architect",
    "description": "Strategic technical advisor: architecture review, deep debugging, self-review.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" },
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
      { "provider": "deepseek", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/librarian.md"
  },
  {
    "id": "prometheus",
    "name": "Planner",
    "description": "Planning advisor: produces .mpd/plans plans only, never implements.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/prometheus.md"
  },
  {
    "id": "hephaestus",
    "name": "Deep Worker",
    "description": "Autonomous deep worker: receives goals, executes them end-to-end with tools, verifies every change.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/hephaestus.md"
  },
  {
    "id": "sisyphus",
    "name": "Senior Engineer",
    "description": "Primary engineering agent: plan small, execute with tools, verify, report honestly.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/sisyphus.md"
  },
  {
    "id": "atlas",
    "name": "Lead",
    "description": "Orchestrator: macro planning, delegate roles, integrate results.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/atlas.md"
  },
  {
    "id": "explore",
    "name": "Explorer",
    "description": "Read-only codebase explorer: evidence-based answers, never edits.",
    "readonly": true,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" },
      { "provider": "deepseek", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/explore.md"
  },
  {
    "id": "metis",
    "name": "Reviewer",
    "description": "Deep reviewer: correctness/risk findings with evidence, no fixes.",
    "readonly": false,
    "chain": [
      { "provider": "deepseek-official", "model": "deepseek-v4-pro" },
      { "provider": "deepseek-official", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/metis.md"
  },
  {
    "id": "momus",
    "name": "Plan Reviewer",
    "description": "Work-plan QA reviewer: verifies plans are executable and references valid, rejects only true blockers; UI/UX critique is a local extension.",
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
      { "provider": "deepseek", "model": "deepseek-v4-flash" }
    ],
    "personaFile": "personas/sisyphus-junior.md"
  }
]

export const ROLE_BY_ID: Record<string, MpdRoleSpec> = Object.fromEntries(ROLES.map((r) => [r.id, r]))