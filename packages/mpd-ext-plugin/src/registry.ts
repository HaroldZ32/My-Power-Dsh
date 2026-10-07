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
import { errorMessage as message, isRecord } from "../../mpd-dsh-adapter-plugin/src/index"

/** Runtime config consumed lazily from mpdConfig (`extensions.*`). */
export interface ExtensionConfig {
  /** Ids force-enabled by `extensions.enable[]`; a `disable[]` match still wins over it (see {@link effectiveEnabled}). */
  enable: string[]
  /** Ids force-disabled by `extensions.disable[]`, the highest-precedence switch in {@link effectiveEnabled}. */
  disable: string[]
  /**
   * MCP bridge policy: whether declared servers may connect at all, plus the two budgets (ms)
   * used where an item left `connectTimeoutMs`/`toolCallTimeoutMs` at the contract default — an
   * explicit per-item value wins, so a declared `10000` is indistinguishable from silence
   * (`resolveTimeouts`, `mcp.ts`).
   */
  mcp: { enabled: boolean; connectTimeoutMs: number; toolCallTimeoutMs: number }
}

/**
 * The defaults a missing or failing `mpdConfig` degrades to (README, "Configuration"):
 * nothing force-enabled or force-disabled, the MCP bridge on, and the contract's own
 * 10 s connect / 60 s tool-call budgets read from `MPD_EXT_CONTRACT` rather than restated.
 * `extensions.*` is PROCESS-level in v1 and is read lazily per use, never per session.
 */
export const DEFAULT_EXTENSION_CONFIG: ExtensionConfig = {
  enable: [],
  disable: [],
  mcp: {
    enabled: true,
    connectTimeoutMs: MPD_EXT_CONTRACT.defaultConnectTimeoutMs,
    toolCallTimeoutMs: MPD_EXT_CONTRACT.defaultToolCallTimeoutMs,
  },
}

/** A validated `contributes.skills` item (`{ root, rank? }`, EXTENSIONS-FOR-AGENTS §2) with its defaults applied. */
export interface NormalizedSkillsItem {
  /** Extension-root-relative directory holding one `<name>/SKILL.md` per skill; the frontmatter `name` is the identity, not the directory. */
  root: string
  /** Serving rank, lower wins inside a layer (100 project-dsh … 600 bundled); default 300, the `custom` tier. */
  rank: number
}

/** A validated `contributes.flows` item (`{ dir, rank? }`, EXTENSIONS-FOR-AGENTS §2) with its defaults applied. */
export interface NormalizedFlowsItem {
  /** Extension-root-relative directory whose every `*.json` file is one flow document. */
  dir: string
  /** Serving rank under the same ladder as a skill; lower wins, default 300 (the `custom` tier). */
  rank: number
}

/** A validated `contributes.mcp` item (`{ serverName, transport, command, args?, env?, cwd?, timeouts? }`) with every optional field defaulted. */
export interface NormalizedMcpItem {
  /** Public server name matching `^[A-Za-z0-9_-]{1,32}$`; it prefixes every published tool name (`mcp__<serverName>__<tool>`). */
  serverName: string
  /** The only transport v1 accepts; `http`/`sse` are refused per item. */
  transport: "stdio"
  /** Executable spawned at apply — never lazily, so a hanging server is bounded by `connectTimeoutMs`. */
  command: string
  /** Spawn arguments; `[]` when the item omits `args`. */
  args: string[]
  /** Extra child environment entries on top of the SDK's safe inherit list; `{}` when the item omits `env`. */
  env: Record<string, string>
  /** Extension-root-relative working directory of the child process; defaults to `"."`. */
  cwd: string
  /** Per-tool-call budget in ms; defaults to the contract's 60 s, which the runtime bridge may re-bound per call. */
  toolCallTimeoutMs: number
  /** Connect budget in ms for the apply-time spawn; defaults to the contract's 10 s. */
  connectTimeoutMs: number
}

/** A validated `contributes.roles` item (`{ name, description?, readonly?, persona, provider?, model? }`); a partial route never reaches this type. */
export interface NormalizedRolesItem {
  /** Display name the roster exposes; a collision with the base roster or another extension refuses the role, not the extension. */
  name: string
  /** Role description the roster shows; defaults to `""` when the item omits it. */
  description: string
  /** Read-only flag; `true` makes `mpd_role_spawn` pass the seven-name write deny list as `toolFilter.deny`. Defaults to `false`. */
  readonly: boolean
  /** Extension-root-relative persona file, resolved against the extension root and read as the role's persona text. */
  persona: string
  /** Model provider of the optional route; present only together with `model`. */
  provider?: string
  /** Model id of the optional route; present only together with `provider`. */
  model?: string
}

/**
 * A descriptor after {@link validateDescriptor}: only the contract's keys survive, so
 * `origin`/`plane` — registry metadata, never author input — cannot appear here.
 */
export interface NormalizedDescriptor {
  /** Contract version, always `MPD_EXT_CONTRACT.apiVersion` (1); any other value rejects the whole descriptor. */
  apiVersion: number
  /** Extension id matching `^[a-z0-9][a-z0-9-]{0,63}$`; every plane is keyed on it and the first claimant wins. */
  id: string
  /** Author description; `""` when the manifest omits it. */
  description: string
  /** Descriptor-level liveness default; config `disable[]`/`enable[]` override it (see {@link effectiveEnabled}). */
  enabled: boolean
  /** The validated contributions, one array per kind; a kind the manifest omits stays empty. */
  contributes: {
    skills: NormalizedSkillsItem[]
    flows: NormalizedFlowsItem[]
    mcp: NormalizedMcpItem[]
    roles: NormalizedRolesItem[]
  }
}

/** One declared MCP server as `mpd_ext_show` reports it: live state, published tools, and a stderr tail after a failure. */
export interface McpServerRecord {
  /** Name the manifest declared, which is also the `mcp__<serverName>__<tool>` prefix of every published tool. */
  serverName: string
  /** Live bridge state; produced as `McpServerState` in `mcp.ts` (`connecting`/`connected`/`unavailable`/`failed`/`disabled`). */
  state: string
  /** Public tool names this server currently publishes; empty until it connects. */
  tools: string[]
  /** Bounded tail of the child's stderr, present only after the server failed. */
  stderrTail?: string
}

/** One declared role candidate: the local half of the roster's decision. */
export interface RoleCandidate {
  /** Index of the item inside `contributes.roles`. */
  index: number
  /** `contributes.roles[<index>]` — the item label every surface reports. */
  item: string
  /** The declared role name, compared by the roster through the same collapse as {@link roleNameKey}. */
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

/**
 * One loaded extension: the registry metadata around it, the validated descriptor,
 * and every surface the tools report — errors, pending kinds, resolved roots, live names.
 */
export interface ExtensionEntry {
  /** Id this entry is keyed on; two planes declaring it shadow, and the first claimant wins. */
  id: string
  /** How the descriptor arrived: `plugin` (a code-plane `register()`) or `directory` (an `mpd-ext.json`). */
  origin: MpdExtensionOrigin
  /** Lifecycle plane: `project` is re-read per call, `user`/`bundle` are discovered once at apply. */
  plane: MpdExtensionPlane
  /** Absolute extension root every asset reference resolved against; `""` for a registration without assets. */
  root: string
  /** Where the descriptor came from — the manifest path, or `"register()"`. */
  source: string
  /** Process-unique skill-provider name this extension's candidates carry. */
  providerName: string
  /** The validated descriptor this entry was built from. */
  descriptor: NormalizedDescriptor
  /** Descriptor-level default; config can override it (see effectiveEnabled). */
  enabled: boolean
  /** Per-item problems, one line each — including `unknown key` and every refusal this plane re-derives on `view`. */
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
  /**
   * The asset paths this entry actually resolved, per kind. `roles` holds every locally
   * usable persona: this field is about ASSETS, not liveness, so it is not re-derived per view.
   */
  resolvedRoots: { root: string; skills: string[]; flows: string[]; roles: string[] }
  /** How many items of each kind are LIVE — an mcp or roles item a plane refused is not counted. */
  contributions: { skills: number; flows: number; mcp: number; roles: number }
  /** Names of the loaded `SKILL.md` documents, in load order — flow ids live in `flows`, and the collision pass reads the two `*Entries` arrays instead. */
  skills: string[]
  /** Ids of the flow documents this entry loaded; a flow is served as a skill candidate too. */
  flows: string[]
  /** Names the ROSTER currently exposes (never a refused one). Re-derived by `view`. */
  roles: string[]
  /** Every declared role with this plane's local decision (input to `annotateRoleSurfaces`). */
  roleCandidates: RoleCandidate[]
  /** Loaded skill documents — the `contributes.skills` half of the skill-name collision input. */
  skillEntries: SkillDocumentEntry[]
  /** Loaded flow documents as skill candidates — the `contributes.flows` half of it. */
  flowEntries: SkillDocumentEntry[]
  /** The parsed flows themselves, read by `mpd_flow_list` / `mpd_flow_show`. */
  flowDocs: MpdFlow[]
  /** Live server records, filled by the runtime bridge as each declared server connects. */
  mcp: McpServerRecord[]
}

/**
 * An extension refused WHOLESALE (EXTENSIONS-FOR-AGENTS §8): nothing about the
 * descriptor was interpreted, so it has no `ExtensionEntry` and contributes nothing.
 */
export interface RejectedExtension {
  /** Declared id when it is a string, otherwise the discovery fallback (the directory name). */
  id: string
  /** Plane the manifest was found in, kept so the report can name where it came from. */
  plane: MpdExtensionPlane
  /** `directory` for a manifest, `plugin` for a code-plane registration. */
  origin: MpdExtensionOrigin
  /** Absolute extension root, recorded even though no asset was read from it. */
  root: string
  /** Manifest path (or `"register()"`) the refusal is attributed to. */
  source: string
  /** The fatal lines that caused the refusal: bad `apiVersion`, bad `id`, unreadable or invalid JSON. */
  errors: MpdExtLoadError[]
}

/**
 * Two extensions declared the SAME id: the first claimant is kept and the loser is
 * recorded here, never dropped silently (EXTENSIONS-FOR-AGENTS §4, "Equal ids
 * resolve project → user → bundle (first wins)").
 */
export interface ShadowRecord {
  /** The contested id; both halves below describe a claimant of it. */
  id: string
  /** The claimant that won — plane and root, so a report can say what is actually live. */
  kept: { plane: MpdExtensionPlane; root: string }
  /** The claimant that lost the id and is therefore not registered at all. */
  shadowed: { plane: MpdExtensionPlane; root: string }
}

/** The outcome of scanning ONE plane's directory: what loaded, what was refused, and whether the scan finished. */
export interface DiscoveryResult {
  /** The plane this directory belongs to (project / user / bundle). */
  plane: MpdExtensionPlane
  /** The directory scanned; `""` when the plane has no configured root. */
  dir: string
  /** Extensions that loaded, in directory order. */
  entries: ExtensionEntry[]
  /** Manifests refused wholesale while scanning this plane. */
  rejected: RejectedExtension[]
  /** Scan-complete flag: false only while discovery is still in flight, so an empty list is never read as an unread plane. */
  done: boolean
}

// ── path rules ──────────────────────────────────────────────────────────────



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

/**
 * RULE 0's implementation: every key outside the frozen `allowed` list is refused per
 * item — `unknown key "<k>"` reported on `<item>.<k>` — instead of being silently kept.
 * This repository has measured schemastery accepting a renamed key and quietly losing
 * the capability it configured; this validator must not repeat that (README, "The contract").
 */
function unknownKeyErrors(value: Record<string, unknown>, allowed: readonly string[], item: string): MpdExtLoadError[] {
  /** One line per unrecognized key, labelled with the item path that key sits on. */
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
// this pure registry, which the dev CLI (`scripts/mpd-ext.ts validate`) imports
// with no host at all. Their behavioural parity is asserted against the roster's
// own exports in test/core.test.ts — never by this comment.

/** Prefix every refusal note carries, so a refusal is greppable and never a bare load error. */
export const ROLE_REFUSAL_PREFIX = "refused: "

/** Prefix on the "this extension is disabled, so nothing of it is exposed" note. */
export const ROLE_NOT_EXPOSED_PREFIX = "not exposed: "

/** Collapsed role-name key: case-, space-, hyphen- and underscore-insensitive. */
export function roleNameKey(name: string): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** Namespaced stable id of an extension-contributed role (`ext-<extension>-<slug>`). */
export function extensionRoleId(extensionId: string, name: string): string {
  /** The name collapsed to a dash-joined slug with no leading or trailing dash; empty for a punctuation-only name. */
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
 * Known residual: a CONFIG-disabled entry (`extensions.disable[]`) is invisible to
 * this module unless the caller passes its effective predicate — the EFFECTIVE
 * enabled state is resolved by the caller (`toView` -> `effectiveEnabled`). The
 * caller therefore passes `isEnabled`, and `view()` does exactly that: without it a
 * config-disabled extension still claimed its names, so a later extension's
 * same-named role was reported refused while the roster would have exposed it.
 *
 * @param entries - the whole view, in exposure order.
 * @param isEnabled - the caller's EFFECTIVE enabled predicate; absent means
 *   "descriptor `enabled` only" (the pre-fix behaviour, kept for direct callers).
 */
export function annotateRoleSurfaces(entries: ExtensionEntry[], isEnabled?: (entry: ExtensionEntry) => boolean): void {
  /** Collapsed name key -> the claimant that owns it; pre-seeded with the base roster, which always wins. */
  const owner = new Map<string, string>()
  for (const role of ROLES) owner.set(roleNameKey(role.name), "the base roster")
  for (const entry of entries) {
    /** The `refused:` notes this call derives for this entry; they replace its previous ones. */
    const notes: MpdExtLoadError[] = []
    /** Names this entry owns once the pass is done, in declaration order — the live role surface. */
    const usable: string[] = []
    /** Whether the entry exposes anything: the caller's effective predicate, or descriptor `enabled` when absent. */
    const live = isEnabled === undefined ? entry.enabled !== false : isEnabled(entry)
    if (live) {
      for (const candidate of entry.roleCandidates) {
        /** The collapsed name key the roster would compare this candidate under. */
        const key = roleNameKey(candidate.name)
        /** Who already claimed that key, or undefined while it is still free. */
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
    entry.pending = entry.pending.filter((line) => !line.reason.startsWith(ROLE_NOT_EXPOSED_PREFIX))
    if (!live && entry.roleCandidates.length > 0) {
      entry.pending.push({
        item: "contributes.roles",
        reason: ROLE_NOT_EXPOSED_PREFIX
          + `not exposed: this extension is ${entry.enabled === false ? "disabled (enabled=false)" : "disabled by config (extensions.disable)"}`
          + `, so none of its ${entry.roleCandidates.length} declared role(s) is resolved`,
      })
    }
  }
}

/**
 * The timeout predicate: a present `toolCallTimeoutMs` / `connectTimeoutMs` must be a
 * finite number strictly greater than zero, so `0`, `NaN` and the string `"10000"` are
 * refused per item instead of reaching the bridge as a nonsensical budget.
 */
function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

/**
 * Prefix on every SKILL-surface note this module owns: one prefix for both the
 * collision note (on the loser, in `errors`) and the not-served note (on a disabled
 * extension, in `pending`), so a per-call re-derivation can strip exactly its own
 * lines and never accumulate duplicates (the `ROLE_REFUSAL_PREFIX` discipline).
 */
export const SKILL_SURFACE_PREFIX = "skill surface: "

/** The skill candidates one entry would emit: its skills roots plus its flow docs. */
function skillClaims(entry: ExtensionEntry): SkillDocumentEntry[] {
  return [...entry.skillEntries, ...entry.flowEntries]
}

/** The descriptor item a claim came from (`contributes.skills` or `contributes.flows`). */
function claimItem(entry: SkillDocumentEntry): string {
  return (entry.locator as { kind?: unknown } | undefined)?.kind === "flow" ? "contributes.flows" : "contributes.skills"
}

/**
 * Record the skill-NAME collisions the harness resolves silently.
 *
 * The harness keeps exactly one candidate per name within a layer: it sorts by
 * `rank`, then registration order, then local order, and WARN+DROPS every later
 * same-name candidate (H/dsh-skill/lib/index.ts:314-325 with
 * `compareIndexedCandidates` :518-520). Our providers live in the same layer as the
 * bundled corpus, so a name two contributors claim is a REAL, silent loss for one
 * of them — and `mpd_ext_list` used to list both as contributed. This annotation
 * re-derives the whole-view decision per call and notes the loser with the exact
 * winner and ranks.
 *
 * Only collisions between TWO EXTENSIONS are visible here (the registry knows its
 * own providers); a name lost to a non-extension provider — the skill corpus, a
 * user skills root — cannot be decided from this side, which is why the two list
 * tools verify their claims against the harness's own catalog
 * (`dsh.listSkills`) before reporting them as served.
 *
 * Idempotent by construction: every note this function owns carries
 * `SKILL_SURFACE_PREFIX` and is removed before the current notes are appended.
 *
 * @param entries - the whole view, in serving order.
 * @param isEnabled - the caller's EFFECTIVE enabled predicate (config-aware); a
 *   `false` return means the entry claims nothing, so a config-disabled extension
 *   no longer steals a name from one that really serves it.
 */
export function annotateSkillSurfaces(entries: ExtensionEntry[], isEnabled?: (entry: ExtensionEntry) => boolean): void {
  /** Whether an entry is live: the caller's effective predicate when given, else descriptor `enabled` alone. */
  const live = (entry: ExtensionEntry): boolean => (isEnabled === undefined ? entry.enabled !== false : isEnabled(entry))
  /**
   * Skill name -> the lowest-ranked live claimant of it; that is the candidate the harness serves.
   * On a rank TIE the first claimant in view order is kept, which is as close as this plane can get
   * to the harness's own "registration order, then local order" tie-break (it cannot see either).
   */
  const winner = new Map<string, { rank: number; entry: ExtensionEntry }>()
  for (const entry of entries) {
    if (!live(entry)) continue
    for (const claim of skillClaims(entry)) {
      /** The claimant recorded for this name so far, if any. */
      const current = winner.get(claim.document.name)
      if (current === undefined || claim.rank < current.rank) winner.set(claim.document.name, { rank: claim.rank, entry })
    }
  }
  for (const entry of entries) {
    /** The `skill surface:` notes this call derives for this entry, replacing its previous ones. */
    const notes: MpdExtLoadError[] = []
    if (live(entry)) {
      for (const claim of skillClaims(entry)) {
        /** The winner recorded for this name — the extension whose candidate the harness keeps. */
        const holder = winner.get(claim.document.name)
        if (holder === undefined || holder.entry.id === entry.id) continue
        notes.push({
          item: claimItem(claim),
          reason: SKILL_SURFACE_PREFIX
            + `"${claim.document.name}" (rank ${claim.rank}) is also claimed by extension "${holder.entry.id}" (rank ${holder.rank}),`
            + ` which the harness serves instead — the lowest rank wins and the other candidate is dropped with a warning`,
        })
      }
    }
    entry.errors = [...entry.errors.filter((line) => !line.reason.startsWith(SKILL_SURFACE_PREFIX)), ...notes]
    // A disabled extension's skills are not in the catalog at all; say it once,
    // next to the same statement the roles surface makes.
    const declared = skillClaims(entry).length
    entry.pending = entry.pending.filter((line) => !line.reason.startsWith(SKILL_SURFACE_PREFIX))
    if (!live(entry) && declared > 0) {
      entry.pending.push({
        item: "contributes.skills",
        reason: SKILL_SURFACE_PREFIX
          + `not served: this extension is ${entry.enabled === false ? "disabled (enabled=false)" : "disabled by config (extensions.disable)"}`
          + `, so none of its ${declared} declared skill candidate(s) reaches the catalog`,
      })
    }
  }
}

// ── descriptor validation ───────────────────────────────────────────────────

/** What {@link validateDescriptor} made of one input: the descriptor, its per-item errors, and whether it is fatal. */
export interface DescriptorValidation {
  /** Present only when no fatal error was found — i.e. absent exactly when `rejected` is true. */
  descriptor?: NormalizedDescriptor
  /** Per-item problems, including the fatal ones when the descriptor was rejected wholesale. */
  errors: MpdExtLoadError[]
  /** True when the descriptor cannot be interpreted at all (no id / bad apiVersion). */
  rejected: boolean
}

/**
 * Validate one `contributes.skills` item (`{ root, rank? }`, EXTENSIONS-FOR-AGENTS §2):
 * an unknown key, a root that is not a non-empty extension-root-relative directory, or a
 * non-finite `rank` refuses the ITEM while the rest of the descriptor still loads.
 * `rank` defaults to `MPD_EXT_CONTRACT.defaultRank` (300, the `custom` tier) and the
 * success path returns the normalized item; any error at all returns no value.
 */
function validateSkillsItem(raw: unknown, item: string): { value?: NormalizedSkillsItem; errors: MpdExtLoadError[] } {
  /** One line per refused aspect, each labelled with its own `<item>.<key>` path. */
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

/**
 * Validate one `contributes.flows` item (`{ dir, rank? }`, EXTENSIONS-FOR-AGENTS §2): the
 * same shape rules as a skills item, with `dir` naming the extension-root-relative
 * directory read for `*.json` flow documents. Refuses the ITEM only — never the extension.
 */
function validateFlowsItem(raw: unknown, item: string): { value?: NormalizedFlowsItem; errors: MpdExtLoadError[] } {
  /** One line per refused aspect, each labelled with its own `<item>.<key>` path. */
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

/**
 * Validate one `contributes.mcp` item (`{ serverName, transport, command, args?, env?,
 * cwd?, connectTimeoutMs?, toolCallTimeoutMs? }`, EXTENSIONS-FOR-AGENTS §2). Refused per
 * item: an unknown key; a `serverName` outside `^[A-Za-z0-9_-]{1,32}$`; a `transport`
 * that is not exactly `"stdio"` (http/sse are v1 non-goals); an empty `command`; `args`
 * or `env` of the wrong shape; an absolute or `..`-escaping `cwd`; a timeout that is not
 * positive and finite. The success path applies every default (`args: []`, `env: {}`,
 * `cwd: "."`, the contract's 10 s connect / 60 s tool-call budgets).
 */
function validateMcpItem(raw: unknown, item: string): { value?: NormalizedMcpItem; errors: MpdExtLoadError[] } {
  /** One line per refused aspect, each labelled with its own `<item>.<key>` path. */
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

/**
 * Validate one `contributes.roles` item (`{ name, description?, readonly?, persona,
 * provider?, model? }`, EXTENSIONS-FOR-AGENTS §2). Refused per item: an unknown key; an
 * empty `name`; a non-string `description`; a non-boolean `readonly`; a `persona` that is
 * not an extension-root-relative file; a PARTIAL `provider`/`model` route. The success
 * path defaults `description` to `""` and `readonly` to `false`, and carries the route
 * only when both halves are strings. Name/persona collisions are NOT decided here — see
 * `buildExtension` and {@link annotateRoleSurfaces}, which have the roster's rules.
 */
function validateRolesItem(raw: unknown, item: string): { value?: NormalizedRolesItem; errors: MpdExtLoadError[] } {
  /** One line per refused aspect, each labelled with its own `<item>.<key>` path. */
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
  /** Everything refused so far; a per-item line does NOT stop the remaining items from being validated. */
  const errors: MpdExtLoadError[] = []
  errors.push(...unknownKeyErrors(input, MPD_EXT_CONTRACT.descriptorKeys, "descriptor"))
  /** The wholesale refusals (`apiVersion`, `id`); a non-empty list means `rejected: true`. */
  const fatal: MpdExtLoadError[] = []
  if (input.apiVersion !== MPD_EXT_CONTRACT.apiVersion) {
    fatal.push({ item: "apiVersion", reason: `apiVersion must equal ${MPD_EXT_CONTRACT.apiVersion} (got ${JSON.stringify(input.apiVersion ?? null)})` })
  }
  /** The id as declared, or `""` so the grammar test refuses a missing one with the documented line. */
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
  /** Contributions collected per kind: only items that validated are appended, in declaration order. */
  const contributes: NormalizedDescriptor["contributes"] = { skills: [], flows: [], mcp: [], roles: [] }
  if (input.contributes !== undefined) {
    if (!isRecord(input.contributes)) {
      errors.push({ item: "contributes", reason: "contributes must be an object when present" })
    } else {
      errors.push(...unknownKeyErrors(input.contributes, MPD_EXT_CONTRACT.contributesKeys, "contributes"))
      /** The four kind validators in contract order; each one reports its own item path. */
      const kinds: Array<[keyof NormalizedDescriptor["contributes"], (raw: unknown, item: string) => { value?: unknown; errors: MpdExtLoadError[] }]> = [
        ["skills", validateSkillsItem],
        ["flows", validateFlowsItem],
        ["mcp", validateMcpItem],
        ["roles", validateRolesItem],
      ]
      for (const [kind, validateItem] of kinds) {
        /** The declared array for this kind; `undefined` means the manifest omits the kind entirely. */
        const raw = input.contributes[kind]
        if (raw === undefined) continue
        if (!Array.isArray(raw)) {
          errors.push({ item: `contributes.${kind}`, reason: `contributes.${kind} must be an array when present` })
          continue
        }
        raw.forEach((item, index) => {
          /** This item's verdict: a normalized value and/or the lines that refused it. */
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

/** Everything {@link buildExtension} needs: the raw descriptor plus the registry metadata wrapped around it. */
export interface BuildExtensionOptions {
  /** The parsed manifest (or the object passed to `register()`); validated, never trusted. */
  input: unknown
  /** Plane the caller found this extension in; `project` is what triggers the host-kind refusals. */
  plane: MpdExtensionPlane
  /** `plugin` for a code-plane registration, `directory` for a manifest on disk. */
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

/** The verdict on one descriptor: a loaded `entry`, or the `rejected` record that replaced it — never both. */
export interface BuildExtensionResult {
  /** The loaded extension, present when descriptor validation and asset resolution both succeeded. */
  entry?: ExtensionEntry
  /** The wholesale refusal, present instead of `entry` when the descriptor was fatal or unreadable. */
  rejected?: RejectedExtension
}

/**
 * Read ONE skills root: every immediate subdirectory holding a `SKILL.md` becomes a
 * candidate (a subdirectory without one is skipped silently, EXTENSIONS-FOR-AGENTS §5),
 * with `document.resourceBase` and `locator` pointing back at that directory so the
 * harness can resolve a skill's relative resources. An unreadable root or an unreadable
 * `SKILL.md` is a per-item error, never a throw — one bad skill does not lose the root.
 */
function enumerateSkillEntries(
  directory: string,
  options: { source: string; rank: number; itemLabel: string },
): { entries: SkillDocumentEntry[]; errors: MpdExtLoadError[] } {
  /** Candidates resolved so far, in sorted directory order. */
  const entries: SkillDocumentEntry[] = []
  /** One line per unreadable root or refused document, never fatal to the extension. */
  const errors: MpdExtLoadError[] = []
  /** Immediate subdirectory names, sorted so two hosts read the same root in the same order. */
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
    /** `<skills root>/<dir>/SKILL.md` — the only file that makes a directory a skill. */
    const skillPath = join(directory, name, "SKILL.md")
    if (!existsSync(skillPath)) continue
    /** Item path this document is reported under (`contributes.skills[0]/<dir>`). */
    const item = `${options.itemLabel}/${name}`
    /** The frontmatter verdict for that file: a `document`, or the line that refused it. */
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
  /** The validator's verdict on the raw descriptor; a fatal one short-circuits to a rejected record. */
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
  /** The accepted descriptor; every asset below is resolved from it. */
  const descriptor = validation.descriptor
  /** Per-item lines, seeded with the validator's own non-fatal ones and appended to as assets fail. */
  const errors = [...validation.errors]
  /** Declared-but-not-live lines; the MCP placeholders the runtime bridge later replaces. */
  const pending: MpdExtLoadError[] = []
  /** Skill candidates resolved from the `contributes.skills` roots. */
  const skillEntries: SkillDocumentEntry[] = []
  /** Flow documents as skill candidates, resolved from the `contributes.flows` directories. */
  const flowEntries: SkillDocumentEntry[] = []
  /** The parsed flows themselves, served by `mpd_flow_list` / `mpd_flow_show`. */
  const flowDocs: MpdFlow[] = []
  /** Every asset path that resolved, per kind; the `roles` half is appended to at the end. */
  const resolvedRoots = { root: options.root, skills: [] as string[], flows: [] as string[] }
  /** A per-call (project) manifest may contribute skills and flows only (EXTENSIONS-FOR-AGENTS §4). */
  const projectOnly = options.plane === "project"

  /**
   * Refuse one host-wide kind on a PROJECT-plane manifest: record
   * `contributes.<kind>[<index>]` with the contract's exact reason — "project-level
   * extensions may contribute skills and flows only: tool and provider registration is
   * process-global and cannot be scoped to a session" — and return true so the caller
   * skips the item. Always false for a user/bundle-plane entry. The reason lives in
   * `MPD_EXT_CONTRACT.projectRejectionReason` and is refused per item, never wholesale.
   */
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
      /** Descriptor path every line about this item is labelled with. */
      const label = `contributes.skills[${index}]`
      /** `<extension root>/<item.root>`, recorded before the read so an unreadable root still counts as resolved. */
      const directory = resolve(options.root, item.root)
      resolvedRoots.skills.push(directory)
      /** This root's candidates and its own error lines. */
      const loaded = enumerateSkillEntries(directory, { source: options.source, rank: item.rank, itemLabel: label })
      skillEntries.push(...loaded.entries)
      errors.push(...loaded.errors)
    })
  }

  if (descriptor.contributes.flows.length > 0 && options.root === "") {
    errors.push({ item: "contributes.flows", reason: "an extension root is required to resolve flows assets (pass { root } to register())" })
  } else {
    descriptor.contributes.flows.forEach((item, index) => {
      /** Descriptor path every line about this item is labelled with. */
      const label = `contributes.flows[${index}]`
      /** `<extension root>/<item.dir>`, recorded before the read so an unreadable directory still counts as resolved. */
      const directory = resolve(options.root, item.dir)
      resolvedRoots.flows.push(directory)
      /** This directory's flows, candidates and its own error lines. */
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

  /** Every declared role with this plane's LOCAL decision; the whole-view pass re-reads it on each `view`. */
  const roleCandidates: RoleCandidate[] = []
  descriptor.contributes.roles.forEach((item, index) => {
    /** Descriptor path of this role item (`contributes.roles[<index>]`). */
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
    /** Namespaced stable id the roster would expose this role under (`ext-<extension-id>-<slug>`). */
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
  /** Roles this plane can admit ALONE: base-roster name/id collisions and unreadable personas already removed. */
  const usableRoles = roleCandidates.filter((candidate) => candidate.usable)
  /** Live role names, in declaration order; `view()` replaces this with the roster's own whole-view answer. */
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

/**
 * The process-wide registry: the apply-time entries keyed by id (first wins), the shadow
 * records and wholesale refusals they produced, and {@link MpdExtensionRegistry.view},
 * which merges the per-call project plane in FRONT of them and re-derives both
 * cross-extension surfaces (role names, skill names) on every call.
 */
export class MpdExtensionRegistry {
  /** Registered entries in registration order — the order `view` iterates them. */
  private entries: ExtensionEntry[] = []
  /** Id -> entry; the ONE place the first-wins rule is decided. */
  private byId = new Map<string, ExtensionEntry>()
  /** Every id collision seen so far, reported by `mpd_ext_list` and never fatal. */
  private shadowRecords: ShadowRecord[] = []
  /** Extensions refused wholesale, reported alongside the loaded ones. */
  private rejectedRecords: RejectedExtension[] = []

  /** Register one built entry; first id wins and the shadowed duplicate is recorded. */
  add(entry: ExtensionEntry): { ok: boolean; shadowed?: ShadowRecord } {
    /** The entry already holding this id, if any — its presence makes this call a shadowing. */
    const kept = this.byId.get(entry.id)
    if (kept !== undefined) {
      /** The collision, phrased so a report can name both claimants and their planes. */
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

  /** Record an extension refused wholesale, keeping it out of the id map entirely. */
  addRejected(record: RejectedExtension): void {
    this.rejectedRecords.push(record)
  }

  /**
   * Register the outcome of one {@link buildExtension} call: a loaded entry is added
   * (first id wins) and returned; a rejection is recorded and `undefined` returned. A
   * result carrying NEITHER is recorded as a fallback rejection under `fallback.fallbackId`,
   * so no attempt can disappear silently.
   */
  apply(result: BuildExtensionResult, fallback: { plane: MpdExtensionPlane; origin: MpdExtensionOrigin; root: string; source: string; fallbackId: string }): ExtensionEntry | undefined {
    if (result.entry !== undefined) {
      this.add(result.entry)
      return result.entry
    }
    if (result.rejected !== undefined) this.addRejected(result.rejected)
    else this.addRejected({ ...fallback, id: fallback.fallbackId, errors: [{ item: "descriptor", reason: "extension could not be loaded" }] })
    return undefined
  }

  /** The apply-time entry for an id (the project plane is merged only by `view`), or undefined when nothing claims it. */
  get(id: string): ExtensionEntry | undefined {
    return this.byId.get(id)
  }

  /** A COPY of every apply-time entry, in registration order. */
  all(): ExtensionEntry[] {
    return [...this.entries]
  }

  /** A COPY of every id collision where the later claimant was not registered. */
  shadowed(): ShadowRecord[] {
    return [...this.shadowRecords]
  }

  /** A COPY of every wholesale refusal, for the tools' report. */
  rejected(): RejectedExtension[] {
    return [...this.rejectedRecords]
  }

  /**
   * Merge the per-call PROJECT plane in front of the apply-time planes: the
   * project plane has the highest precedence (first wins) and its shadowing of
   * an apply-time id is recorded, never fatal.
   *
   * Both cross-extension surfaces (roles, skill names) are re-derived here, in
   * serving order, and both need the caller's EFFECTIVE enabled predicate: a
   * config-disabled extension (`extensions.disable[]`) must claim nothing, or it
   * would be reported as the winner of a name it does not serve.
   */
  view(project: DiscoveryResult, options: { isEnabled?: (entry: ExtensionEntry) => boolean } = {}): {
    entries: ExtensionEntry[]
    shadowed: ShadowRecord[]
    rejected: RejectedExtension[]
  } {
    /** The merged set: project entries first (they win), then apply-time entries not already seen. */
    const seen = new Map<string, ExtensionEntry>()
    for (const entry of project.entries) seen.set(entry.id, entry)
    /** The apply-time collisions plus the ones this project plane causes. */
    const shadowed = [...this.shadowRecords]
    for (const entry of this.entries) {
      /** The project-plane entry holding this id, when the project plane shadows this one. */
      const kept = seen.get(entry.id)
      if (kept !== undefined) {
        shadowed.push({ id: entry.id, kept: { plane: kept.plane, root: kept.root }, shadowed: { plane: entry.plane, root: entry.root } })
        continue
      }
      seen.set(entry.id, entry)
    }
    // Both surfaces are WHOLE-VIEW decisions (first claimant wins), so they are
    // re-derived on every view — the same order the roster iterates.
    const entries = [...seen.values()]
    annotateRoleSurfaces(entries, options.isEnabled)
    annotateSkillSurfaces(entries, options.isEnabled)
    return { entries, shadowed, rejected: [...this.rejectedRecords, ...project.rejected] }
  }
}
