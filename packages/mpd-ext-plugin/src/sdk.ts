// mpd-ext-plugin SDK — the frozen extension-descriptor contract v1.
//
// ONE machine-readable contract shared by extension authors, the runtime
// validator and the developer CLI (scripts/mpd-ext.mjs): the validator reads
// MPD_EXT_CONTRACT instead of re-stating the rules, so a rule can never be
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

/** Declared descriptor API version understood by this build. */
export const MPD_EXT_API_VERSION = 1

/** Data-plane manifest file name. */
export const MPD_EXT_MANIFEST_FILE = "mpd-ext.json"

/** Default contribution rank for a skills root or a flows directory. */
export const MPD_EXT_DEFAULT_RANK = 300

/** Descriptor id grammar: 1-64 chars, lower-case ASCII, digits and dashes. */
export const MPD_EXT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$"

/**
 * Skill-name grammar, identical to the harness constant
 * (@deepseek-ai/dsh-skill SKILL_NAME). A flow id MUST satisfy this stricter
 * grammar: the descriptor id grammar is looser and is NOT enough.
 */
export const MPD_EXT_SKILL_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$"

/** MCP server-name grammar (identical to the harness constant in dsh-mcp-client). */
export const MPD_EXT_SERVER_NAME_PATTERN = "^[A-Za-z0-9_-]{1,32}$"

/** Which plane a registry entry came from. Registry metadata, never author input. */
export type MpdExtensionPlane = "project" | "user" | "bundle"

/** Which authoring form produced a registry entry. Registry metadata. */
export type MpdExtensionOrigin = "plugin" | "directory"

/** One skills contribution: a directory holding immediate subdirs with SKILL.md. */
export interface MpdExtSkillsContribution {
  root: string
  rank?: number
}

/** One flows contribution: a directory holding `*.json` flow documents. */
export interface MpdExtFlowsContribution {
  dir: string
  rank?: number
}

/** One MCP server contribution (stdio transport only in v1). */
export interface MpdExtMcpContribution {
  serverName: string
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  toolCallTimeoutMs?: number
  connectTimeoutMs?: number
}

/** One role contribution: a roster-shaped specialist resolved per call. */
export interface MpdExtRolesContribution {
  name: string
  description?: string
  readonly?: boolean
  persona: string
  provider?: string
  model?: string
}

export interface MpdExtContributes {
  skills?: MpdExtSkillsContribution[]
  flows?: MpdExtFlowsContribution[]
  mcp?: MpdExtMcpContribution[]
  roles?: MpdExtRolesContribution[]
}

/**
 * The frozen descriptor v1. Unknown keys ANYWHERE (descriptor, contributes, or
 * any item) are a loud per-item rejection recorded on the extension — this
 * repository has measured the opposite failure mode often enough (schemastery
 * silently keeps unknown keys, so a renamed key is accepted and does nothing).
 */
export interface MpdExtensionDescriptor {
  apiVersion: number
  id: string
  description?: string
  enabled?: boolean
  contributes?: MpdExtContributes
}

/** Identity helper for extension authors (no runtime behaviour, no validation). */
export function defineExtension(descriptor: MpdExtensionDescriptor): MpdExtensionDescriptor {
  return descriptor
}

/**
 * The machine-readable contract. Adding a key here is the ONE way to widen the
 * descriptor (the validator, the tools and the CLI all read this object), and
 * `projectKinds` is the lifecycle boundary: a project-plane manifest declaring
 * anything outside it is rejected per item with `projectRejectionReason`.
 */
export const MPD_EXT_CONTRACT = {
  apiVersion: MPD_EXT_API_VERSION,
  manifestFile: MPD_EXT_MANIFEST_FILE,
  idPattern: MPD_EXT_ID_PATTERN,
  skillNamePattern: MPD_EXT_SKILL_NAME_PATTERN,
  serverNamePattern: MPD_EXT_SERVER_NAME_PATTERN,
  defaultRank: MPD_EXT_DEFAULT_RANK,
  defaultConnectTimeoutMs: 10_000,
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
  item: string
  reason: string
}
