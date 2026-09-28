// mpd-ext-plugin SDK — the frozen extension-descriptor contract v1.
//
// ONE machine-readable contract shared by extension authors, the runtime
// validator, this package's own discovery/tools and the developer CLI
// (scripts/mpd-ext.ts): the validator reads MPD_EXT_CONTRACT instead of
// re-stating the rules, so a rule can never be
// "documented here, enforced differently there".
//
// Two accepted author forms, one shape:
//   code plane — register(defineExtension({...}), { root }) on the mpdExtensions service
//   data plane — a directory holding mpd-ext.json (the directory IS the root)
//
// Registry metadata (origin / plane / load results) is NEVER author input: an
// author-supplied `origin` or `plane` key is rejected as an unknown key.
//
// Types only plus frozen constants: this module has no imports and no side
// effects, so it is safe to ship as a standalone build artifact
// (@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/sdk.js).

/**
 * Declared descriptor API version understood by this build; the unit is the
 * integer `1`, the only legal value. A descriptor whose `apiVersion` differs is
 * rejected WHOLESALE by the runtime validator (`validateDescriptor`,
 * `src/registry.ts`) — nothing else about it is interpreted — and the developer
 * CLI reports the same line, because both read `MPD_EXT_CONTRACT.apiVersion`.
 */
export const MPD_EXT_API_VERSION = 1

/**
 * Data-plane manifest file name: the one file that makes a directory an
 * extension root, the holding directory being that root (`docs/extensions.md`
 * §2). Consumed by discovery (`discoverPlane` / `projectExtensionIds`,
 * `src/manifest.ts`) and by the CLI's `validate` / `scaffold` / `list`.
 */
export const MPD_EXT_MANIFEST_FILE = "mpd-ext.json"

/**
 * Default contribution rank for a skills root or a flows directory: `300`, the
 * `custom` tier of the shadowing ladder (100 project-dsh < 200 project-agents <
 * 250 runtime < 300 custom < 400 user-dsh < 500 user-agents < 600 bundled). It
 * is a PRECEDENCE weight, not a duration — lower wins inside a layer — and it is
 * meaningful for `skills` / `flows` items only. Applied by the runtime validator
 * (`normalizeSkills` / `normalizeFlows`, `src/registry.ts`) when an item omits it.
 */
export const MPD_EXT_DEFAULT_RANK = 300

/**
 * Descriptor id grammar: 1-64 characters of lower-case ASCII letters, digits and
 * dashes, anchored at both ends because the validator tests the WHOLE string. A
 * miss refuses the entire descriptor rather than one item, since the id is what
 * every surface keys on and what decides shadowing between planes.
 */
export const MPD_EXT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$"

/**
 * Skill-name grammar, identical to the harness constant
 * (@deepseek-ai/dsh-skill SKILL_NAME, exported there as the `isSkillName`
 * predicate). A flow id MUST satisfy this stricter
 * grammar: the descriptor id grammar is looser and is NOT enough.
 * Anchored and tested against a whole string; consumed by the frontmatter reader
 * (`SKILL_NAME`, `src/skills.ts`), the flow-document validator (`src/flows.ts`),
 * the CLI's scaffold name derivation (`scripts/mpd-ext.ts`) and
 * `MPD_EXT_CONTRACT.skillNamePattern`.
 */
export const MPD_EXT_SKILL_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$"

/**
 * MCP server-name grammar: 1-32 characters from ASCII letters, digits and the
 * `_` / `-` pair, anchored because the validator and the CLI test the whole
 * string. It mirrors the harness's `dsh-mcp-client` rule for `serverName`, so a
 * name legal here is legal as a patch-row server name, and the CLI reads the
 * `{1,<n>}` bound out of this very string to cap a scaffolded name. It is also
 * the middle segment of every published tool name `mcp__<serverName>__<tool>`.
 */
export const MPD_EXT_SERVER_NAME_PATTERN = "^[A-Za-z0-9_-]{1,32}$"

/**
 * Which plane a registry entry came from: `project` (a per-call
 * `<workspace>/.mpd/extensions` root), `user` (`~/.mpd/extensions`) or `bundle`
 * (`<bundle>/extensions`). Registry metadata, never author input — supplying
 * `plane` in a descriptor is an unknown key — and the plane is what decides the
 * legal kinds, a `project` entry being limited to `skills` and `flows`
 * (EXTENSIONS-FOR-AGENTS.md §4).
 */
export type MpdExtensionPlane = "project" | "user" | "bundle"

/**
 * Which authoring form produced a registry entry: `plugin` for the code plane (a
 * `register(descriptor, { root })` call on the `mpdExtensions` service) or
 * `directory` for the data plane (a discovered `mpd-ext.json`). Registry
 * metadata, never author input; it is the only field that distinguishes the two
 * forms, which otherwise produce the same entry.
 */
export type MpdExtensionOrigin = "plugin" | "directory"

/** One skills contribution: a directory holding immediate subdirs with SKILL.md. */
export interface MpdExtSkillsContribution {
  /**
   * Extension-root-relative directory whose IMMEDIATE subdirectories each hold a
   * `SKILL.md`; the frontmatter `name` is the skill's identity, not the directory
   * name. Absolute paths and `..` escapes are refused per item.
   */
  root: string
  /**
   * Precedence weight on the shadowing ladder, used as written; omit it to take
   * `MPD_EXT_DEFAULT_RANK` (300). A value that is present but not a finite number
   * refuses the ITEM — the rest of the descriptor still loads.
   */
  rank?: number
}

/** One flows contribution: a directory holding `*.json` flow documents. */
export interface MpdExtFlowsContribution {
  /**
   * Extension-root-relative directory holding one flow document per `*.json`
   * file. A malformed flow is refused per FILE (recorded, file skipped) and the
   * others still load; a flow id must satisfy `MPD_EXT_SKILL_NAME_PATTERN`,
   * because the flow is served as a skill candidate.
   */
  dir: string
  /**
   * Precedence weight on the same ladder as `skills.rank`, used as written; omit
   * it to take `MPD_EXT_DEFAULT_RANK` (300), and a present non-finite value
   * refuses the ITEM.
   */
  rank?: number
}

/**
 * One MCP server contribution (stdio transport only in v1): a child process the
 * plugin spawns at apply, so a manifest is a trust decision and the command
 * really runs (docs/extensions.md §10). One of the host-wide kinds — a
 * project-plane item is refused per item with `projectRejectionReason`.
 */
export interface MpdExtMcpContribution {
  /**
   * Public server name satisfying `MPD_EXT_SERVER_NAME_PATTERN` (1-32 chars of
   * `[A-Za-z0-9_-]`); it namespaces every tool the server exposes as
   * `mcp__<serverName>__<tool>` and reserves that name process-wide.
   */
  serverName: string
  /** Transport; `"stdio"` is the only legal value in v1, and `http` / `sse` are refused per item. */
  transport: "stdio"
  /** Executable to spawn as a child process; used as authored, with no shell interpretation. */
  command: string
  /** argv handed to `command` verbatim; defaults to `[]`. */
  args?: string[]
  /**
   * Extra child environment merged over the SDK's safe inherit list (the
   * credential-shaped names are stripped first); defaults to `{}`, and
   * `mpd_ext_show` redacts the values when it reports them.
   */
  env?: Record<string, string>
  /**
   * Child working directory, extension-root-relative; defaults to `"."`, i.e.
   * the extension's own directory and NOT the dsh process cwd.
   */
  cwd?: string
  /**
   * Per-tool-call budget in milliseconds; omit it to take
   * `MPD_EXT_CONTRACT.defaultToolCallTimeoutMs` (60000), and a present value that
   * is not a finite number above zero refuses the ITEM. A config
   * `extensions.mcp.toolCallTimeoutMs` applies only where the item declared none.
   */
  toolCallTimeoutMs?: number
  /**
   * Connect budget in milliseconds; omit it to take
   * `MPD_EXT_CONTRACT.defaultConnectTimeoutMs` (10000), and a present value that
   * is not a finite number above zero refuses the ITEM. Declared servers connect
   * in PARALLEL at apply, each time-boxed by this value, so a hanging server
   * costs its own budget and never blocks the boot forever. A config
   * `extensions.mcp.connectTimeoutMs` applies only where the item declared none.
   */
  connectTimeoutMs?: number
}

/** One role contribution: a roster-shaped specialist resolved per call. */
export interface MpdExtRolesContribution {
  /**
   * Roster-facing name, not a stable id: it must not collide with a base roster
   * name or with another extension's role, and `mpd_role_spawn` addresses the
   * role by it (any case/space/hyphen spelling). The internal id is namespaced
   * `ext-<extension-id>-<slug>`.
   */
  name: string
  /** One-line description shown by `mpd_roles_list`; defaults to `""`. */
  description?: string
  /**
   * When true, a spawn gets the same write-deny tool filter as the read-only base
   * roles; defaults to `false`.
   */
  readonly?: boolean
  /**
   * Extension-root-relative file that must exist and be non-empty. Its text is
   * what `mpd_role_persona` returns and what `mpd_workmate_init` uses as the BASE
   * template; a missing or empty file refuses the role while the extension loads.
   */
  persona: string
  /**
   * Model provider of the role's route; must be supplied TOGETHER with `model`,
   * because a partial route is refused per item.
   */
  provider?: string
  /** Model id of the role's route; must be supplied together with `provider`. */
  model?: string
}

/**
 * The four contribution arrays of a descriptor v1. Each item is validated on its
 * own, and an unknown key at this level or inside any item is a per-item
 * rejection: the extension keeps its other valid items and never half-loads
 * silently.
 */
export interface MpdExtContributes {
  /** Skills roots; legal in every plane, the project plane included. */
  skills?: MpdExtSkillsContribution[]
  /** Flows directories; legal in every plane, the project plane included. */
  flows?: MpdExtFlowsContribution[]
  /** stdio MCP servers; a host-wide kind, refused per item in a project-plane manifest. */
  mcp?: MpdExtMcpContribution[]
  /** Roster roles; a host-wide kind, refused per item in a project-plane manifest. */
  roles?: MpdExtRolesContribution[]
}

/**
 * The frozen descriptor v1. Unknown keys ANYWHERE (descriptor, contributes, or
 * any item) are a loud per-item rejection recorded on the extension — this
 * repository has measured the opposite failure mode often enough (schemastery
 * silently keeps unknown keys, so a renamed key is accepted and does nothing).
 * Both authoring forms produce this shape, and `defineExtension()` below is the
 * typed entry point to it.
 */
export interface MpdExtensionDescriptor {
  /**
   * Must equal `MPD_EXT_API_VERSION` (1); any other value rejects the whole
   * extension, and nothing else about that descriptor is interpreted.
   */
  apiVersion: number
  /**
   * Extension id satisfying `MPD_EXT_ID_PATTERN`; the first plane to declare it
   * wins, which makes the id the shadowing key rather than a display label.
   */
  id: string
  /** Human-readable one-liner shown by `mpd_ext_list` / `mpd_ext_show`; defaults to `""`. */
  description?: string
  /**
   * The descriptor's own default for the effective state. OMITTED MEANS LIVE
   * (`true`) — only the shipped template ships `false` — and a config `disable`
   * still wins over it.
   */
  enabled?: boolean
  /** The contributed kinds; defaults to `{}`, and an unknown kind is an unknown key and is refused. */
  contributes?: MpdExtContributes
}

/** Identity helper for extension authors (no runtime behaviour, no validation). */
export function defineExtension(descriptor: MpdExtensionDescriptor): MpdExtensionDescriptor {
  return descriptor
}

/**
 * The machine-readable contract, frozen at v1. Adding a key here is the ONE way
 * to widen the descriptor (the validator, the tools and the CLI all read this
 * object), and `projectKinds` is the lifecycle boundary: a project-plane
 * manifest declaring anything outside it is rejected per item with
 * `projectRejectionReason`. Read by the runtime validator (`src/registry.ts`,
 * `src/flows.ts`, `src/manifest.ts`), the developer CLI (`scripts/mpd-ext.ts`,
 * which shares this validator and parses the `{1,<n>}` bound back out of
 * `serverNamePattern`) and this package's own tools.
 */
export const MPD_EXT_CONTRACT = {
  apiVersion: MPD_EXT_API_VERSION,
  manifestFile: MPD_EXT_MANIFEST_FILE,
  idPattern: MPD_EXT_ID_PATTERN,
  skillNamePattern: MPD_EXT_SKILL_NAME_PATTERN,
  serverNamePattern: MPD_EXT_SERVER_NAME_PATTERN,
  defaultRank: MPD_EXT_DEFAULT_RANK,
  /** Default connect budget in milliseconds, used when neither the item nor the config declares one. */
  defaultConnectTimeoutMs: 10_000,
  /** Default per-tool-call budget in milliseconds, used when neither the item nor the config declares one. */
  defaultToolCallTimeoutMs: 60_000,
  descriptorKeys: ["apiVersion", "id", "description", "enabled", "contributes"],
  contributesKeys: ["skills", "flows", "mcp", "roles"],
  skillsItemKeys: ["root", "rank"],
  flowsItemKeys: ["dir", "rank"],
  mcpItemKeys: [
    "serverName",
    "transport",
    "command",
    "args",
    "env",
    "cwd",
    "toolCallTimeoutMs",
    "connectTimeoutMs",
  ],
  rolesItemKeys: ["name", "description", "readonly", "persona", "provider", "model"],
  /** Kinds a per-call (project) extension may contribute: skills and flows only. */
  projectKinds: ["skills", "flows"],
  /** Kinds a host-wide (user / bundle) extension may contribute. */
  hostKinds: ["skills", "flows", "mcp", "roles"],
  planes: ["project", "user", "bundle"],
  origins: ["plugin", "directory"],
  /** Told to every project manifest that declares a host-wide kind. */
  projectRejectionReason:
    "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session",
} as const

/** A per-item load problem: `item` is a descriptor path, `reason` one readable line. */
export interface MpdExtLoadError {
  /**
   * Descriptor path that failed, e.g. `contributes.mcp[0].serverName`; every
   * surface (`mpd_ext_list`, `mpd_ext_show`, the CLI) reports this label, so it
   * is the key a reader greps for.
   */
  item: string
  /** One readable line naming the violated rule, quoting the offending value where the validator has it. */
  reason: string
}
