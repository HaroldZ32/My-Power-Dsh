// mpd-ext-plugin registry: the descriptor validator, the per-extension load
// record, and discovery precedence.
//
// Two invariants drive this file:
//   1. RULE 0 — an unknown key ANYWHERE is rejected per item and recorded, never
//      silently dropped. This repository has measured schemastery accepting a
//      renamed key and quietly losing the capability it configured; our own
//      validator must not repeat that.
//   2. Nothing throws. A malformed extension, one bad item, or one unreadable
//      asset is recorded on that extension and reported by the tools; the rest
//      of the extension (and every other extension) keeps working.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { MPD_EXT_CONTRACT, type MpdExtLoadError, type MpdExtensionOrigin, type MpdExtensionPlane } from "./sdk"
import { readSkillDocument, type SkillDocumentEntry } from "./skills"
import { loadFlows, type MpdFlow } from "./flows"
// The BASE roster's names and stable ids, imported as DATA (a pure module: no
// cordis, no adapter, no service). Reporting an extension role honestly means
// predicting the roster's own decision, and the two rules that decide it are
// keyed on exactly this table — see `roleNameKey` / `extensionRoleId` below,
// whose behaviour is pinned against the roster's exported functions by
// test/core.test.ts (never by a comment).
import { ROLES, ROLE_BY_ID } from "../../mpd-roles-plugin/src/roles.data"

/** Runtime config consumed lazily from mpdConfig (`extensions.*`). */
export interface ExtensionConfig {
  enable: string[]
  disable: string[]
  mcp: { enabled: boolean; connectTimeoutMs: number; toolCallTimeoutMs: number }
}

export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  enable: [],
  disable: [],
  mcp: {
    enabled: true,
    connectTimeoutMs: MPD_EXT_CONTRACT.defaultConnectTimeoutMs,
    toolCallTimeoutMs: MPD_EXT_CONTRACT.defaultToolCallTimeoutMs,
  },
}

export interface NormalizedSkillsItem {
  root: string
  rank: number
}

export interface NormalizedFlowsItem {
  dir: string
  rank: number
}

export interface NormalizedMcpItem {
  serverName: string
  transport: "stdio"
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  connectTimeoutMs: number
}

export interface NormalizedRolesItem {
  name: string
  description: string
  readonly: boolean
  persona: string
  provider?: string
  model?: string
}

export interface NormalizedDescriptor {
  apiVersion: number
  id: string
  description: string
  enabled: boolean
  contributes: {
    skills: NormalizedSkillsItem[]
    flows: NormalizedFlowsItem[]
    mcp: NormalizedMcpItem[]
    roles: NormalizedRolesItem[]
  }
}

export interface McpServerRecord {
  serverName: string
  state: string
  tools: string[]
  stderrTail?: string
}

/** One declared role candidate: the local half of the roster's decision. */
export interface RoleCandidate {
  /** Index of the item inside `contributes.roles`. */
  index: number
  /** `contributes.roles[<index>]` — the item label every surface reports. */
  item: string
  name: string
  /** Absolute persona path (the extension root is applied here). */
  persona: string
  /**
   * Whether the rules this plane can decide ALONE admit the role: a base-roster
   * name/id collision or an unreadable persona. A cross-extension collision is
   * decided by {@link annotateRoleSurfaces}, which sees every extension at once.
   */
  usable: boolean
  /** The roster's own reason string when `usable` is false. */
  reason?: string
}

export interface ExtensionEntry {
  id: string
  origin: MpdExtensionOrigin
  plane: MpdExtensionPlane
  root: string
  source: string
  /** Process-unique skill-provider name this extension's candidates carry. */
  providerName: string
  descriptor: NormalizedDescriptor
  /** Descriptor-level default; config can override it (see effectiveEnabled). */
  enabled: boolean
  errors: MpdExtLoadError[]
  /**
   * Declared contributions that are NOT live right now, each with the one reason
   * it is not. `mcp` entries start as a build-time "declared, not connected yet"
   * placeholder and are replaced by the runtime bridge as servers connect;
   * `roles` never appear here — the roster resolves extension roles PER CALL, so
   * a resolver that is absent is not a state this plane can observe, and claiming
   * "pending" for a live contribution was a measured false report (t14/F3).
   */
  pending: MpdExtLoadError[]
  resolvedRoots: { root: string; skills: string[]; flows: string[]; roles: string[] }
  contributions: { skills: number; flows: number; mcp: number; roles: number }
  skills: string[]
  flows: string[]
  /** Names the ROSTER currently exposes (never a refused one). Re-derived by `view`. */
  roles: string[]
  /** Every declared role with this plane's local decision (input to `annotateRoleSurfaces`). */
  roleCandidates: RoleCandidate[]
  skillEntries: SkillDocumentEntry[]
  flowEntries: SkillDocumentEntry[]
  flowDocs: MpdFlow[]
  mcp: McpServerRecord[]
}

export interface RejectedExtension {
  id: string
  plane: MpdExtensionPlane
  origin: MpdExtensionOrigin
  root: string
  source: string
  errors: MpdExtLoadError[]
}

export interface ShadowRecord {
  id: string
  kept: { plane: MpdExtensionPlane; root: string }
  shadowed: { plane: MpdExtensionPlane; root: string }
}

export interface DiscoveryResult {
  plane: MpdExtensionPlane
  dir: string
  entries: ExtensionEntry[]
  rejected: RejectedExtension[]
  done: boolean
}

// ── path rules ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * An asset reference must stay inside the extension root: no absolute path, no
 * Windows drive, no `..` segment. `register()` may pass a root; a data-plane
 * root is the manifest's own directory.
 */
export function isRelativeAssetPath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false
  if (isAbsolute(value)) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return false
  return !value.split(/[\\/]+/).includes("..")
}

function unknownKeyErrors(value: Record<string, unknown>, allowed: readonly string[], item: string): MpdExtLoadError[] {
  const errors: MpdExtLoadError[] = []
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push({ item: `${item}.${key}`, reason: `unknown key "${key}"` })
  }
  return errors
}

// ── the roster's role rules, reproduced ─────────────────────────────────────
//
// Extension roles are exposed by mpd-roles-plugin PER CALL, and that resolver
// refuses a role on exactly three grounds: a name that is already taken (the base
// roster first, then the earlier extension — first wins), a namespaced id that
// collides with a base id, or a persona it cannot read. Reporting such a role as a
// usable contribution is the t14/F4 defect ("the two surfaces disagree about the
// same role"), so this plane reproduces the SAME three decisions and the SAME
// one-line reasons.
//
// `roleNameKey` / `extensionRoleId` mirror the roster's exported functions rather
// than importing them: importing that module would pull the cordis adapter into
// this pure registry, which the dev CLI (`scripts/mpd-ext.mjs validate`) imports
// with no host at all. Their behavioural parity is asserted against the roster's
// own exports in test/core.test.ts — never by this comment.

/** Prefix every refusal note carries, so a refusal is greppable and never a bare load error. */
export const ROLE_REFUSAL_PREFIX = "refused: "

/** Collapsed role-name key: case-, space-, hyphen- and underscore-insensitive. */
export function roleNameKey(name: string): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** Namespaced stable id of an extension-contributed role (`ext-<extension>-<slug>`). */
export function extensionRoleId(extensionId: string, name: string): string {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return "ext-" + extensionId + "-" + (slug || "role")
}

/** The name keys the base roster owns — the base always wins, so this is static. */
const BASE_ROLE_NAME_KEYS: ReadonlySet<string> = new Set(ROLES.map((role) => roleNameKey(role.name)))

/** The roster's name-collision wording, reproduced verbatim. */
export function roleNameCollisionReason(extensionId: string, name: string, item: string, takenBy: string): string {
  return `role name "${name}" (${item} of extension "${extensionId}") is already taken by ${takenBy} — this extension role is not exposed`
}

/** The roster's id-collision wording, reproduced verbatim. */
export function roleIdCollisionReason(id: string): string {
  return `role id "${id}" collides with the base roster — this extension role is not exposed`
}

/** The roster's unreadable-persona wording, reproduced verbatim. */
export function rolePersonaUnreadableReason(persona: string): string {
  return `persona file is not readable: ${persona}`
}

/**
 * Read a persona the way the roster does: absent, unreadable, or EMPTY is a
 * refusal. The `existsSync`-only test this replaces accepted a zero-byte persona
 * that the roster refuses, which is one of the ways the two surfaces disagreed.
 */
function readRolePersona(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, "utf8").trim() : ""
  } catch {
    return ""
  }
}

/**
 * Re-derive every entry's role surface against the WHOLE view, the way the roster
 * does: the base roster claims its names first (static, pre-seeded), then each
 * extension in view order claims the names it exposes; the first claimant wins and
 * a later collision becomes a refusal instead of a silently listed role.
 *
 * Idempotent by construction: every note this function owns is re-derived from
 * `roleCandidates` on each call and removed by its `refused:` prefix, so the
 * per-call `view()` cannot accumulate duplicates while errors written by anyone
 * else (validation, the MCP bridge) are preserved untouched.
 *
 * Known residual: the claim map cannot see `extensions.disable[]`, because the
 * EFFECTIVE enabled state is resolved by the caller (`toView` -> `effectiveEnabled`,
 * outside this module). A descriptor-disabled extension claims nothing here,
 * exactly like the roster; a CONFIG-disabled one is still treated as claiming, so a
 * later extension's same-named role is reported refused while the roster would
 * expose it. Both tools already report `enabled: false` for that extension, and
 * closing the gap needs the caller's config — see the t14 evidence.
 */
export function annotateRoleSurfaces(entries: ExtensionEntry[]): void {
  const owner = new Map<string, string>()
  for (const role of ROLES) owner.set(roleNameKey(role.name), "the base roster")
  for (const entry of entries) {
    const notes: MpdExtLoadError[] = []
    const usable: string[] = []
    if (entry.enabled !== false) {
      for (const candidate of entry.roleCandidates) {
        const key = roleNameKey(candidate.name)
        const takenBy = owner.get(key)
        if (takenBy !== undefined) {
          notes.push({
            item: candidate.item,
            reason: ROLE_REFUSAL_PREFIX + roleNameCollisionReason(entry.id, candidate.name, candidate.item, takenBy),
          })
          continue
        }
        if (!candidate.usable) {
          notes.push({ item: candidate.item, reason: ROLE_REFUSAL_PREFIX + (candidate.reason ?? "refused by the roster") })
          continue
        }
        owner.set(key, `extension "${entry.id}"`)
        usable.push(candidate.name)
      }
    }
    entry.roles = usable
    entry.contributions = { ...entry.contributions, roles: usable.length }
    entry.errors = [...entry.errors.filter((line) => !line.reason.startsWith(ROLE_REFUSAL_PREFIX)), ...notes]
    // A disabled extension exposes nothing (the roster skips disabled views), so its
    // declared roles are NOT live — say so once instead of listing them as usable.
    entry.pending = entry.pending.filter((line) => line.item !== "contributes.roles")
    if (entry.enabled === false && entry.roleCandidates.length > 0) {
      entry.pending.push({
        item: "contributes.roles",
        reason: `not exposed: this extension is disabled (enabled=false), so none of its ${entry.roleCandidates.length} declared role(s) is resolved`,
      })
    }
  }
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

// ── descriptor validation ───────────────────────────────────────────────────

export interface DescriptorValidation {
  descriptor?: NormalizedDescriptor
  errors: MpdExtLoadError[]
  /** True when the descriptor cannot be interpreted at all (no id / bad apiVersion). */
  rejected: boolean
}

function validateSkillsItem(raw: unknown, item: string): { value?: NormalizedSkillsItem; errors: MpdExtLoadError[] } {
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item, reason: "skills item must be an object { root, rank? }" }] }
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.skillsItemKeys, item))
  if (!isRelativeAssetPath(raw.root)) {
    errors.push({ item: `${item}.root`, reason: "root must be a non-empty extension-root-relative directory (absolute paths and `..` escapes are rejected)" })
  }
  if (raw.rank !== undefined && (typeof raw.rank !== "number" || !Number.isFinite(raw.rank))) {
    errors.push({ item: `${item}.rank`, reason: "rank must be a finite number when present" })
  }
  if (errors.length > 0) return { errors }
  return {
    value: { root: raw.root as string, rank: raw.rank === undefined ? MPD_EXT_CONTRACT.defaultRank : (raw.rank as number) },
    errors,
  }
}

function validateFlowsItem(raw: unknown, item: string): { value?: NormalizedFlowsItem; errors: MpdExtLoadError[] } {
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item, reason: "flows item must be an object { dir, rank? }" }] }
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.flowsItemKeys, item))
  if (!isRelativeAssetPath(raw.dir)) {
    errors.push({ item: `${item}.dir`, reason: "dir must be a non-empty extension-root-relative directory (absolute paths and `..` escapes are rejected)" })
  }
  if (raw.rank !== undefined && (typeof raw.rank !== "number" || !Number.isFinite(raw.rank))) {
    errors.push({ item: `${item}.rank`, reason: "rank must be a finite number when present" })
  }
  if (errors.length > 0) return { errors }
  return {
    value: { dir: raw.dir as string, rank: raw.rank === undefined ? MPD_EXT_CONTRACT.defaultRank : (raw.rank as number) },
    errors,
  }
}

function validateMcpItem(raw: unknown, item: string): { value?: NormalizedMcpItem; errors: MpdExtLoadError[] } {
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item, reason: "mcp item must be an object" }] }
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.mcpItemKeys, item))
  if (typeof raw.serverName !== "string" || !new RegExp(MPD_EXT_CONTRACT.serverNamePattern).test(raw.serverName)) {
    errors.push({ item: `${item}.serverName`, reason: `serverName is required and must match ${MPD_EXT_CONTRACT.serverNamePattern}` })
  }
  if (raw.transport !== "stdio") errors.push({ item: `${item}.transport`, reason: 'transport is required and must be "stdio" (http/sse are v1 non-goals)' })
  if (typeof raw.command !== "string" || raw.command.trim() === "") errors.push({ item: `${item}.command`, reason: "command is required and must be a non-empty string" })
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some((entry) => typeof entry !== "string"))) {
    errors.push({ item: `${item}.args`, reason: "args must be an array of strings when present" })
  }
  if (raw.env !== undefined && (!isRecord(raw.env) || Object.values(raw.env).some((entry) => typeof entry !== "string"))) {
    errors.push({ item: `${item}.env`, reason: "env must be an object of string values when present" })
  }
  if (raw.cwd !== undefined && !isRelativeAssetPath(raw.cwd)) {
    errors.push({ item: `${item}.cwd`, reason: "cwd must be extension-root-relative (absolute paths and `..` escapes are rejected)" })
  }
  for (const key of ["toolCallTimeoutMs", "connectTimeoutMs"] as const) {
    if (raw[key] !== undefined && !positiveFinite(raw[key])) errors.push({ item: `${item}.${key}`, reason: `${key} must be a positive finite number when present` })
  }
  if (errors.length > 0) return { errors }
  return {
    value: {
      serverName: raw.serverName as string,
      transport: "stdio",
      command: raw.command as string,
      args: Array.isArray(raw.args) ? (raw.args as string[]) : [],
      env: isRecord(raw.env) ? (raw.env as Record<string, string>) : {},
      cwd: raw.cwd === undefined ? "." : (raw.cwd as string),
      toolCallTimeoutMs: raw.toolCallTimeoutMs === undefined ? MPD_EXT_CONTRACT.defaultToolCallTimeoutMs : (raw.toolCallTimeoutMs as number),
      connectTimeoutMs: raw.connectTimeoutMs === undefined ? MPD_EXT_CONTRACT.defaultConnectTimeoutMs : (raw.connectTimeoutMs as number),
    },
    errors,
  }
}

function validateRolesItem(raw: unknown, item: string): { value?: NormalizedRolesItem; errors: MpdExtLoadError[] } {
  const errors: MpdExtLoadError[] = []
  if (!isRecord(raw)) return { errors: [{ item, reason: "roles item must be an object" }] }
  errors.push(...unknownKeyErrors(raw, MPD_EXT_CONTRACT.rolesItemKeys, item))
  if (typeof raw.name !== "string" || raw.name.trim() === "") errors.push({ item: `${item}.name`, reason: "name is required and must be a non-empty string" })
  if (raw.description !== undefined && typeof raw.description !== "string") errors.push({ item: `${item}.description`, reason: "description must be a string when present" })
  if (raw.readonly !== undefined && typeof raw.readonly !== "boolean") errors.push({ item: `${item}.readonly`, reason: "readonly must be a boolean when present" })
  if (!isRelativeAssetPath(raw.persona)) {
    errors.push({ item: `${item}.persona`, reason: "persona is required and must be an extension-root-relative file (absolute paths and `..` escapes are rejected)" })
  }
  if ((raw.provider === undefined) !== (raw.model === undefined)) {
    errors.push({ item, reason: "provider and model must be supplied together (a partial route is rejected)" })
  }
  if (raw.provider !== undefined && typeof raw.provider !== "string") errors.push({ item: `${item}.provider`, reason: "provider must be a string when present" })
  if (raw.model !== undefined && typeof raw.model !== "string") errors.push({ item: `${item}.model`, reason: "model must be a string when present" })
  if (errors.length > 0) return { errors }
  return {
    value: {
      name: raw.name as string,
      description: typeof raw.description === "string" ? raw.description : "",
      readonly: raw.readonly === true,
      persona: raw.persona as string,
      ...(typeof raw.provider === "string" ? { provider: raw.provider } : {}),
      ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    },
    errors,
  }
}

/**
 * Validate a descriptor and normalize it. Unknown keys are recorded per item;
 * a missing id or an unsupported apiVersion rejects the whole extension
 * (`rejected: true`) because nothing about it can be interpreted safely.
 */
export function validateDescriptor(input: unknown): DescriptorValidation {
  if (!isRecord(input)) return { errors: [{ item: "descriptor", reason: "descriptor must be a JSON object" }], rejected: true }
  const errors: MpdExtLoadError[] = []
  errors.push(...unknownKeyErrors(input, MPD_EXT_CONTRACT.descriptorKeys, "descriptor"))
  const fatal: MpdExtLoadError[] = []
  if (input.apiVersion !== MPD_EXT_CONTRACT.apiVersion) {
    fatal.push({ item: "apiVersion", reason: `apiVersion must equal ${MPD_EXT_CONTRACT.apiVersion} (got ${JSON.stringify(input.apiVersion ?? null)})` })
  }
  const id = typeof input.id === "string" ? input.id : ""
  if (!new RegExp(MPD_EXT_CONTRACT.idPattern).test(id)) {
    fatal.push({ item: "id", reason: `id is required and must match ${MPD_EXT_CONTRACT.idPattern}` })
  }
  for (const error of fatal) errors.push(error)
  if (fatal.length > 0) return { errors, rejected: true }

  if (input.description !== undefined && typeof input.description !== "string") {
    errors.push({ item: "description", reason: "description must be a string when present" })
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    errors.push({ item: "enabled", reason: "enabled must be a boolean when present" })
  }
  const contributes: NormalizedDescriptor["contributes"] = { skills: [], flows: [], mcp: [], roles: [] }
  if (input.contributes !== undefined) {
    if (!isRecord(input.contributes)) {
      errors.push({ item: "contributes", reason: "contributes must be an object when present" })
    } else {
      errors.push(...unknownKeyErrors(input.contributes, MPD_EXT_CONTRACT.contributesKeys, "contributes"))
      const kinds: Array<[keyof NormalizedDescriptor["contributes"], (raw: unknown, item: string) => { value?: unknown; errors: MpdExtLoadError[] }]> = [
        ["skills", validateSkillsItem],
        ["flows", validateFlowsItem],
        ["mcp", validateMcpItem],
        ["roles", validateRolesItem],
      ]
      for (const [kind, validateItem] of kinds) {
        const raw = input.contributes[kind]
        if (raw === undefined) continue
        if (!Array.isArray(raw)) {
          errors.push({ item: `contributes.${kind}`, reason: `contributes.${kind} must be an array when present` })
          continue
        }
        raw.forEach((item, index) => {
          const result = validateItem(item, `contributes.${kind}[${index}]`)
          errors.push(...result.errors)
          if (result.value !== undefined) (contributes[kind] as unknown[]).push(result.value)
        })
      }
    }
  }
  return {
    descriptor: {
      apiVersion: MPD_EXT_CONTRACT.apiVersion,
      id,
      description: typeof input.description === "string" ? input.description : "",
      enabled: input.enabled !== false,
      contributes,
    },
    errors,
    rejected: false,
  }
}

// ── per-extension loading ───────────────────────────────────────────────────

export interface BuildExtensionOptions {
  input: unknown
  plane: MpdExtensionPlane
  origin: MpdExtensionOrigin
  /** Absolute extension root; "" for a code-plane registration without assets. */
  root: string
  /** Where the descriptor came from (manifest path, or "register()"). */
  source: string
  /** Fallback id for a rejected record (the directory name). */
  fallbackId: string
  /** Provider name the emitted skill candidates will carry. */
  providerName: string
}

export interface BuildExtensionResult {
  entry?: ExtensionEntry
  rejected?: RejectedExtension
}

function enumerateSkillEntries(
  directory: string,
  options: { source: string; rank: number; itemLabel: string },
): { entries: SkillDocumentEntry[]; errors: MpdExtLoadError[] } {
  const entries: SkillDocumentEntry[] = []
  const errors: MpdExtLoadError[] = []
  let dirs: string[]
  try {
    dirs = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    errors.push({ item: options.itemLabel, reason: `cannot read skills root ${directory}: ${message(error)}` })
    return { entries, errors }
  }
  for (const name of dirs) {
    const skillPath = join(directory, name, "SKILL.md")
    if (!existsSync(skillPath)) continue
    const item = `${options.itemLabel}/${name}`
    const parsed = readSkillDocument(skillPath)
    if (parsed.document === undefined) {
      errors.push({ item, reason: parsed.error ?? "unreadable SKILL.md" })
      continue
    }
    entries.push({
      document: {
        ...parsed.document,
        resourceBase: { kind: "directory", path: join(directory, name) },
        path: skillPath,
      },
      locator: { kind: "skill", path: skillPath, directory: join(directory, name) },
      source: options.source,
      rank: options.rank,
    })
  }
  return { entries, errors }
}

/**
 * Build the registry entry for one descriptor: validate it, resolve every asset
 * under its root, and record what could not be loaded. Never throws.
 */
export function buildExtension(options: BuildExtensionOptions): BuildExtensionResult {
  const validation = validateDescriptor(options.input)
  if (validation.rejected || validation.descriptor === undefined) {
    return {
      rejected: {
        id: typeof (options.input as { id?: unknown })?.id === "string" ? String((options.input as { id?: unknown }).id) : options.fallbackId,
        plane: options.plane,
        origin: options.origin,
        root: options.root,
        source: options.source,
        errors: validation.errors,
      },
    }
  }
  const descriptor = validation.descriptor
  const errors = [...validation.errors]
  const pending: MpdExtLoadError[] = []
  const skillEntries: SkillDocumentEntry[] = []
  const flowEntries: SkillDocumentEntry[] = []
  const flowDocs: MpdFlow[] = []
  const resolvedRoots = { root: options.root, skills: [] as string[], flows: [] as string[] }
  const projectOnly = options.plane === "project"

  const refuseHostKind = (kind: "mcp" | "roles", index: number): boolean => {
    if (!projectOnly) return false
    errors.push({
      item: `contributes.${kind}[${index}]`,
      reason: MPD_EXT_CONTRACT.projectRejectionReason,
    })
    return true
  }

  if (descriptor.contributes.skills.length > 0 && options.root === "") {
    errors.push({ item: "contributes.skills", reason: "an extension root is required to resolve skills assets (pass { root } to register())" })
  } else {
    descriptor.contributes.skills.forEach((item, index) => {
      const label = `contributes.skills[${index}]`
      const directory = resolve(options.root, item.root)
      resolvedRoots.skills.push(directory)
      const loaded = enumerateSkillEntries(directory, { source: options.source, rank: item.rank, itemLabel: label })
      skillEntries.push(...loaded.entries)
      errors.push(...loaded.errors)
    })
  }

  if (descriptor.contributes.flows.length > 0 && options.root === "") {
    errors.push({ item: "contributes.flows", reason: "an extension root is required to resolve flows assets (pass { root } to register())" })
  } else {
    descriptor.contributes.flows.forEach((item, index) => {
      const label = `contributes.flows[${index}]`
      const directory = resolve(options.root, item.dir)
      resolvedRoots.flows.push(directory)
      const loaded = loadFlows(directory, {
        rank: item.rank,
        source: options.source,
        providerName: options.providerName,
        itemLabel: label,
      })
      flowEntries.push(...loaded.entries)
      flowDocs.push(...loaded.flows)
      errors.push(...loaded.errors)
    })
  }

  const roleCandidates: RoleCandidate[] = []
  descriptor.contributes.roles.forEach((item, index) => {
    const label = `contributes.roles[${index}]`
    // The path the ROSTER reports too: with no root it resolves the declared
    // relative reference and cannot read it.
    const persona = options.root === "" ? item.persona : resolve(options.root, item.persona)
    // A refusal is BOTH a per-role record (the whole-view annotation re-derives the
    // cross-extension case from it) and a load-result line, so the dev CLI's
    // `validate` path — which never builds a view — reports it too.
    const refuse = (reason: string): void => {
      roleCandidates.push({ index, item: label, name: item.name, persona, usable: false, reason })
      errors.push({ item: label, reason: ROLE_REFUSAL_PREFIX + reason })
    }
    if (refuseHostKind("roles", index)) {
      // A project-plane manifest may not contribute roles at all: the per-item
      // contract rejection above is the whole record, and the role is not exposed.
      return
    }
    if (options.root === "") {
      errors.push({ item: label, reason: "an extension root is required to resolve the persona file (pass { root } to register())" })
      refuse(rolePersonaUnreadableReason(item.persona))
      return
    }
    // Base-roster names and ids are static, so these two refusals are decidable
    // here — including in the dev CLI's `validate` path, which never builds a view.
    // A CROSS-extension collision needs the whole view and is decided by
    // annotateRoleSurfaces(); the roster checks the name claim first either way.
    if (BASE_ROLE_NAME_KEYS.has(roleNameKey(item.name))) {
      refuse(roleNameCollisionReason(descriptor.id, item.name, label, "the base roster"))
      return
    }
    const id = extensionRoleId(descriptor.id, item.name)
    if (ROLE_BY_ID[id] !== undefined) {
      refuse(roleIdCollisionReason(id))
      return
    }
    if (readRolePersona(persona) === "") {
      errors.push({
        item: `${label}.persona`,
        reason: existsSync(persona) ? `persona file is empty: ${persona}` : `persona file does not exist: ${persona}`,
      })
      refuse(rolePersonaUnreadableReason(persona))
      return
    }
    roleCandidates.push({ index, item: label, name: item.name, persona, usable: true })
  })

  descriptor.contributes.mcp.forEach((item, index) => {
    if (refuseHostKind("mcp", index)) return
    pending.push({
      item: `contributes.mcp[${index}]`,
      reason: `pending: server "${item.serverName}" is declared and not connected yet`
        + ` (connectTimeoutMs=${item.connectTimeoutMs}, toolCallTimeoutMs=${item.toolCallTimeoutMs})`
        + ` — the runtime bridge replaces this line with the server's live state`,
    })
  })

  // Roles are NEVER pending here (t14/F3): mpd-roles-plugin exposes extension roles
  // per call, so a resolver that happens to be absent is not a state this plane can
  // observe — and the old static "declared here, not yet exposed through mpd_roles_list"
  // line was measured false in every running session. A role the roster refuses is
  // reported as refused (see annotateRoleSurfaces), which is the honest signal.

  // A project-plane manifest may contribute skills and flows only: its mcp and
  // roles items are rejected above, so they expose nothing (the descriptor itself
  // stays visible in mpd_ext_show, with the per-item reasons).
  const mcpCount = projectOnly ? 0 : descriptor.contributes.mcp.length
  const usableRoles = roleCandidates.filter((candidate) => candidate.usable)
  const roles = usableRoles.map((candidate) => candidate.name)
  // `resolvedRoots` is about ASSETS (which references resolved), not about liveness:
  // it keeps every locally usable persona, while `roles` is re-derived per view by
  // annotateRoleSurfaces() and holds only what the roster currently exposes.
  const roleRoots = usableRoles.map((candidate) => candidate.persona)

  return {
    entry: {
      id: descriptor.id,
      origin: options.origin,
      plane: options.plane,
      root: options.root,
      source: options.source,
      providerName: options.providerName,
      descriptor,
      enabled: descriptor.enabled,
      errors,
      pending,
      resolvedRoots: { ...resolvedRoots, roles: roleRoots },
      contributions: {
        skills: skillEntries.length,
        flows: flowEntries.length,
        mcp: mcpCount,
        roles: roles.length,
      },
      skills: skillEntries.map((entry) => entry.document.name),
      flows: flowDocs.map((flow) => flow.id),
      roles,
      roleCandidates,
      skillEntries,
      flowEntries,
      flowDocs,
      mcp: [],
    },
  }
}

/** Effective enabled state: config `disable[]` > config `enable[]` > descriptor `enabled`. */
export function effectiveEnabled(entry: ExtensionEntry, config: ExtensionConfig): boolean {
  if (config.disable.includes(entry.id)) return false
  if (config.enable.includes(entry.id)) return true
  return entry.enabled
}

// ── registry ────────────────────────────────────────────────────────────────

export class MpdExtensionRegistry {
  private entries: ExtensionEntry[] = []
  private byId = new Map<string, ExtensionEntry>()
  private shadowRecords: ShadowRecord[] = []
  private rejectedRecords: RejectedExtension[] = []

  /** Register one built entry; first id wins and the shadowed duplicate is recorded. */
  add(entry: ExtensionEntry): { ok: boolean; shadowed?: ShadowRecord } {
    const kept = this.byId.get(entry.id)
    if (kept !== undefined) {
      const record: ShadowRecord = {
        id: entry.id,
        kept: { plane: kept.plane, root: kept.root },
        shadowed: { plane: entry.plane, root: entry.root },
      }
      this.shadowRecords.push(record)
      return { ok: false, shadowed: record }
    }
    this.byId.set(entry.id, entry)
    this.entries.push(entry)
    return { ok: true }
  }

  addRejected(record: RejectedExtension): void {
    this.rejectedRecords.push(record)
  }

  apply(result: BuildExtensionResult, fallback: { plane: MpdExtensionPlane; origin: MpdExtensionOrigin; root: string; source: string; fallbackId: string }): ExtensionEntry | undefined {
    if (result.entry !== undefined) {
      this.add(result.entry)
      return result.entry
    }
    if (result.rejected !== undefined) this.addRejected(result.rejected)
    else this.addRejected({ ...fallback, id: fallback.fallbackId, errors: [{ item: "descriptor", reason: "extension could not be loaded" }] })
    return undefined
  }

  get(id: string): ExtensionEntry | undefined {
    return this.byId.get(id)
  }

  all(): ExtensionEntry[] {
    return [...this.entries]
  }

  shadowed(): ShadowRecord[] {
    return [...this.shadowRecords]
  }

  rejected(): RejectedExtension[] {
    return [...this.rejectedRecords]
  }

  /**
   * Merge the per-call PROJECT plane in front of the apply-time planes: the
   * project plane has the highest precedence (first wins) and its shadowing of
   * an apply-time id is recorded, never fatal.
   */
  view(project: DiscoveryResult): {
    entries: ExtensionEntry[]
    shadowed: ShadowRecord[]
    rejected: RejectedExtension[]
  } {
    const seen = new Map<string, ExtensionEntry>()
    for (const entry of project.entries) seen.set(entry.id, entry)
    const shadowed = [...this.shadowRecords]
    for (const entry of this.entries) {
      const kept = seen.get(entry.id)
      if (kept !== undefined) {
        shadowed.push({ id: entry.id, kept: { plane: kept.plane, root: kept.root }, shadowed: { plane: entry.plane, root: entry.root } })
        continue
      }
      seen.set(entry.id, entry)
    }
    // The role surface is a WHOLE-VIEW decision (first claimant wins), so it is
    // re-derived on every view — the same order the roster iterates.
    const entries = [...seen.values()]
    annotateRoleSurfaces(entries)
    return { entries, shadowed, rejected: [...this.rejectedRecords, ...project.rejected] }
  }
}
