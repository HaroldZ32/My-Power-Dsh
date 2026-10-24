// mpd-roles-plugin: the specialists live as a SPECIALIST ROSTER, not as
// presets. Each role = { stable id (chain key), normal display name, persona
// text, DeepSeek model chain, read-only discipline }. Consumers: mpd_role_spawn
// (single-call specialist consult from anywhere), mpd_role_persona (the text a team surface
// passes as a staged member's prompt), and the mpdRoles service (mpd-modelchain chain
// lookup). Team authoring is the mpd plan plane — `agent_teams_plan` add_member (that
// persona text) → create_task (its dependency answer) → approve, driven by
// `agent_teams_task` / `agent_teams_dispatch` and read by `agent_teams_plan {action:"status"}`
// — which THIS row feeds: it registers the read-only tool guard, the agent-scoped roster
// section, the `ask_user_question` boundary guard, the captain's reconnaissance ban, the
// delegation gate and the session-start gate (MECHANICAL by default since the 2026-10-20
// restore). The official authoring verbs are REFUSED at the tool boundary, so the mpd
// RECORD is the only board.
// ADDRESSING CONTRACT: a role is addressed by its normal display NAME — the member
// name in team mode, the label of a single-call mpd_role_spawn, and what every
// description/render lists. The stable `id` is an INTERNAL key (modelchain chain key,
// `personas/<id>.md`, workmate meta.baseId): the TOOL surface REFUSES it (`roleOfToolInput`
// accepts a NAME spelling only) while the internal `mpdRoles.get` path keeps resolving it
// for chain lookup and legacy callers — and it is never advertised, because a role is
// described by what it does. Keep the two vocabularies one word apart, never two
// spellings of the same thing.
// Persona texts are assets under personas/<id>.md resolved relative to this
// plugin's package location.
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { ROLES, ROLE_BY_ID, type MpdRoleSpec } from "./roles.data.ts"
import { installReadonlyGuard } from "./team-guard.ts"
import { INVESTIGATION_CONFIG_KEY, installCaptainInvestigationGuard } from "./captain-investigation.ts"
import { installAskUserQuestionGuard } from "./ask-user-guard.ts"
import { DELEGATION_CONFIG_KEY, installDelegationGate } from "./delegation-gate.ts"
import { installRosterSection } from "./roster-section.ts"
import { installSessionGate } from "./session-gate.ts"
import { BOULDER_DIR_CONFIG_KEY, GATE_CONFIG_KEY, SENSITIVITY_CONFIG_KEY } from "./complexity-gate.ts"
import { rowLogLine, DSH_SEAM_SUBAGENTS, DSH_SEAM_TOOLS, bundleRootOf, createLazyDshAdapter, dshAdapterIdentity, dshSeamInject, installChildPersonaSeam, restrictToolsTolerant, textBlock, resolveRunRoute, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-roles"
/** The seams this row needs declared: the tool registry and the subagent spawner, both named by their adapter constants. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS)

/** The slice of a cordis context this row uses: the two seams, the `mpdRoles` provision and a logger. */
type Ctx = { tools: any; subagents: any; provide: (n: string, v: any, check?: any) => void; get?: (k: string, strict?: boolean) => any; [k: string]: any }
/**
 * The row config: the persona directory plus the five keys this row reads itself.
 *
 * `team.gate` (mechanical | advisory | off), `team.sensitivity` (easy | normal | strict),
 * `boulder.dir`, `captain.investigation` (deny | allow) and `delegation.gate` (deny | captain |
 * allow) mirror their `.mpd/mpd.jsonc` spellings, so a composition without the config row mounted can
 * still pin them in the patch. Every knob is read PER CALL through the same config layer, so a
 * `mpd.jsonc` edit applies without a reinstall.
 */
type Config = { personasDir?: string; team?: { gate?: unknown; sensitivity?: unknown }; boulder?: { dir?: unknown }; captain?: { investigation?: unknown }; delegation?: { gate?: unknown } }

// Every entry must be a tool this profile actually registers: the harness
// validates the WHOLE deny list at spawn time and rejects the child when any
// name is unknown, so one dead entry breaks EVERY read-only spawn. That was the
// defect here: two legacy editor patch-row names were listed although their row
// is not composed into this profile. The remaining names are live-registered and
// deliberately kept — `bash` can write files, so it stays denied (that is the
// read-only guarantee, not an oversight). roles.test.ts pins all three
// properties: the coverage, the absence of the dead names, and parity with the
// workmate plugin's list.
export const READONLY_DENY = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
]

/**
 * Why a withdrawn guard reports `absent` on the team-plane boot line, naming the knob that used to
 * switch it.
 *
 * It is a REASON, never a mode: the verification law's write guard was installed HERE on 2026-10-11 and
 * is withdrawn by the user's 2026-10-17 ruling (`.mpd/plans/harness-021-rollback.md`, requirement R1).
 * The TWO guards beside it — the captain-investigation guard and the delegation gate — were withdrawn by
 * the same ruling and RESTORED by the 2026-10-20 ruling (`.mpd/plans/restore-guard-discipline.md`), so
 * they print their MODES again; only `verify.mode` still reports this reason. A removed install must
 * never print a token a reader could mistake for an enforced one, hence `absent` plus the sentence.
 *
 * @param knob - the config key that used to select the withdrawn guard's mode.
 * @returns the boot-line reason spelling.
 */
function withdrawnReason(knob: string): string {
  return "withdrawn:2026-10-17-user-ruling(" + knob + ")"
}

/** Output schema of a single-call specialist consult's structured report, so the tool result is validated. */
const REPORT_SCHEMA = {
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
}

// The bundle root, resolved by the shared helper (bundleRootOf): this file lives at
// <bundle>/packages/mpd-roles-plugin/{src,dist}/index.ts|js. Location-derived, never a
// hard-coded repo path, so the checkout and the packed install both resolve.
export function pkgRoot(): string { return bundleRootOf(import.meta.url) }

/** Collapsed form of a team-style roster name: case-, space-, hyphen- and
 *  underscore-insensitive ("Deep Worker" === "deep-worker" === "deepworker"). */
export function normalizeRoleNameKey(name: string): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/** Team-style name -> stable id. The adopted agent-teams `mpd` profile names its
 *  members EXACTLY these names, so ONE vocabulary addresses both surfaces: the
 *  same word a captain puts in an agent-teams roster is what a solo session
 *  passes to mpd_role_spawn (this is the name-unification contract). */
const ROLE_ID_BY_NAME_KEY: Readonly<Record<string, string>> = Object.fromEntries(ROLES.map((r) => [normalizeRoleNameKey(r.name), r.id]))

/** The BASE roster's names, comma-separated. A call-time unknown-role error lists the
 *  surface's names instead (`roleNameListOf`), which is this list plus every
 *  extension-contributed role — so the base case reads exactly as before. */
export function rosterNameList(): string {
  return ROLES.map((r) => r.name).join(", ")
}

/** The roster as "Name (what it does)" — the ONE wording every tool description
 *  reuses. A role is described by its FUNCTION, never by an upstream alias: the
 *  stable `id` is an internal chain key (chain lookup, persona asset names, legacy
 *  callers) and no surface advertises it. The leading role-noun of a description is
 *  dropped (the name already is that noun) and a trailing period trimmed, so the
 *  inline list reads as a capability index. */
export function rosterFunctionList(): string {
  return ROLES.map((r) => r.name + " (" + functionOf(r.description) + ")").join(", ")
}

/** "Strategic technical advisor: architecture review, deep debugging." -> "architecture review, deep debugging" */
function functionOf(description: string): string {
  /** The description minus its leading role-noun prefix, when it carries one. */
  const afterColon = description.includes(": ") ? description.slice(description.indexOf(": ") + 2) : description
  return afterColon
    .replace(/\s*\(([^()]*)\)/g, ", $1")
    .replace(/\.+\s*$/, "")
    .replace(/,\s*,/g, ",")
    .trim()
}

/**
 * Resolve a role key. Accepted, in order: the stable id (`oracle`), the legacy
 * `mpd-<id>` preset alias, the modelchain camelCase chain key (`sisyphusJunior`),
 * and the team-style normal name (`Architect`, `Deep Worker` — any case or
 * separator spelling).
 */
export function normalizeRoleKey(key: string): string | null {
  /** The key as given, trimmed; an empty one resolves to nothing. */
  const k = String(key ?? "").trim()
  if (!k) return null
  if (ROLE_BY_ID[k]) return k
  if (k.startsWith("mpd-") && ROLE_BY_ID[k.slice(4)]) return k.slice(4)
  if (k === "sisyphusJunior") return "sisyphus-junior"
  if (k === "multimodalLooker") return "multimodal-looker"
  return ROLE_ID_BY_NAME_KEY[normalizeRoleNameKey(k)] ?? null
}

/**
 * Resolve a role key as TOOL INPUT — the ACCEPTANCE side of the addressing contract.
 *
 * A tool accepts the roster's own NAME in any case, space, hyphen or underscore spelling and
 * nothing else. The stable id (`oracle`), the legacy `mpd-<id>` preset form and the camelCase
 * chain key (`sisyphusJunior`) are INTERNAL keys and are refused HERE — the internal
 * `mpdRoles.get` path keeps resolving them through `normalizeRoleKey`, which stays PERMISSIVE on
 * purpose because it also serves chain lookup and the workmate `baseId`; tightening the
 * normalizer instead of gating the input would silently break that internal path.
 *
 * The refusal is not this function's (it answers `null`, and the caller phrases one that names
 * only accepted names): repeating the rejected key would manufacture the very advertisement the
 * alias guards scan every model-facing surface for.
 *
 * An extension-contributed role keeps its own documented contract (`mpd-ext-plugin/README.md`):
 * its declared name in any spelling, or its namespaced `ext-<extension-id>-<slug>` id. That id is
 * namespaced so it can never collide with a base key, and the upstream rule is about base ids.
 *
 * @param surface - the roster as THIS call sees it: base specialists plus extension roles.
 * @param key - the raw tool argument, exactly as the caller spelled it.
 * @returns the role that key NAMES, or `null` when it is not a name this surface answers to.
 */
export function roleOfToolInput(surface: RoleSurface, key: string): ResolvedRole | null {
  /** The key in the roster's collapsed-name form; an empty key names nothing. */
  const nameKey = normalizeRoleNameKey(key)
  if (nameKey === "") return null
  /** The BASE role whose NAME matches — a base id or a legacy alias can never reach this branch. */
  const base = surface.roles.find((role) => role.extension === null && normalizeRoleNameKey(role.name) === nameKey)
  if (base) return base
  /** The key as written, trimmed: an extension role's namespaced id is matched exactly. */
  const raw = String(key ?? "").trim()
  /** The extension role: its namespaced id, or its declared name in the same collapsed form. */
  return surface.roles.find((role) => role.extension !== null && (role.id === raw || normalizeRoleNameKey(role.name) === nameKey)) ?? null
}

/** The persona asset path: the configured directory, or this package's own `personas/`. */
function personaPath(config: Config, spec: MpdRoleSpec): string {
  return config.personasDir
    ? join(resolve(config.personasDir), spec.id + ".md")
    : join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", spec.id + ".md")
}

/** The persona TEXT for a role: the asset when it is readable and non-empty, else the description. */
export function readPersona(config: Config, spec: MpdRoleSpec): string {
  /** The asset path this role would read. */
  const p = personaPath(config, spec)
  try {
    if (existsSync(p)) {
      /** The asset's trimmed body; empty means the description is the better text. */
      const t = readFileSync(p, "utf8").trim()
      if (t) return t
    }
  } catch { /* fall through */ }
  return spec.description
}

/** The cordis service `mpd-ext-plugin` provides. Resolved LAZILY at call time, never as a
 *  hard `inject`: a declared-but-unregistered service is a FATAL `pending` loader entry in
 *  this harness, so a hard inject would take the whole roster down whenever the mpd-ext row
 *  is absent — and it would also freeze the roster at apply, when an extension registered by
 *  a later row does not exist yet. */
const EXTENSIONS_SERVICE = "mpdExtensions"

/** The cordis service `mpd-config-plugin` provides, read PER CALL for `team.gate` and `boulder.dir`. */
const CONFIG_SERVICE = "mpdConfig"

/** The config service slice this row reads (structural: the config module is a SERVICE, never an import). */
interface ConfigServiceLike {
  /** The TOTAL typed slot resolution the slot-single-source wave exposes. */
  slotResolutionOf?: (member: string) => unknown
  /** The older total route read, kept for a composition running a stale config-row dist. */
  teamModelRouteOf?: (member: string) => unknown
}

/** One route as this row sends it to the provider. */
interface LiveRoute {
  /** Provider id the child run is started on. */
  provider: string
  /** Model id that provider runs. */
  model: string
  /** The slot's effort keyword, absent when the slot states none. */
  reasoningEffort?: string
}

/**
 * The TOTAL slot resolution ONE member has, as the config service reports it (contract amendment 1).
 *
 * Mirrored structurally rather than imported: a cross-package relative import would be a new entry in
 * the frozen coupling inventory. The `ok` discriminant is what the two callers branch on — a spawn
 * applier refuses `unconfigured`/`invalid`, a display surface renders them, and `unrouted` means
 * "slots do not decide this member's route" (an extension role).
 */
type LiveSlotResolution =
  | { readonly ok: true; readonly slot: string; readonly route: LiveRoute; readonly fallbacks?: readonly unknown[] }
  | { readonly ok: false; readonly status: "unconfigured" | "invalid"; readonly slot: string; readonly members: readonly string[]; readonly missing?: readonly string[]; readonly problem?: string; readonly code: string; readonly message: string }
  | { readonly ok: false; readonly status: "unrouted"; readonly slot: undefined }

/** The cordis service `mpd-team-core-plugin` provides; the gate's staged-plan probe reads it. */
const TEAMS_SERVICE = "mpdTeams"

/**
 * The session-start gate's staged-plan probe, resolved PER CALL from the `mpdTeams` service.
 *
 * THE CONTRACT IS THREE-VALUED, and the third value is the whole reason this is a named function
 * (2026-10-07, review F4): `null` means the service POSITIVELY answered "nothing is staged"; a plan
 * object means one IS staged; and an UNREADABLE probe THROWS. An absent service — or one whose
 * `planFor` is not a function, which a partially-published service looks like — is UNREADABLE, never
 * "nothing staged". Folding that case into `undefined` (the shape this replaced) let the gate
 * re-stage in SILENCE, and the tool's `create` moves an existing un-approved plan for the session
 * into `.mpd/team/archive/` — so a silent fold is exactly how a captain's in-progress plan
 * disappears without a word. The gate catches the throw and reports it in ONE warning.
 * @param ctx - the row's context; the service is read lazily because its row may compose later.
 * @returns the probe: an answer, or a throw naming why it could not answer.
 */
export function stagedPlanProbe(ctx: Ctx): (workspace: string, sessionId: string) => unknown {
  return (workspace: string, sessionId: string): unknown => {
    /** The team record service, absent until its row has applied (and undefined for a non-ACTIVE one). */
    const teams = ctx.get?.(TEAMS_SERVICE, false) as { planFor?: (w: string, s: string) => { plan?: unknown } } | undefined
    if (teams === undefined || teams === null || typeof teams.planFor !== "function") {
      throw new Error("the " + TEAMS_SERVICE + " service is not mounted, so the staged-plan probe cannot answer")
    }
    return teams.planFor(workspace, sessionId)?.plan ?? null
  }
}

/** The one plane whose contributions are restricted to skills + flows (`MPD_EXT_CONTRACT.projectKinds`). */
const PROJECT_ONLY_PLANE = "project"

/**
 * Why a project-plane extension's roles are refused. The extension side rejects the same item
 * with `MPD_EXT_CONTRACT.projectRejectionReason` (packages/mpd-ext-plugin/src/sdk.ts); this is
 * that sentence VERBATIM, so `mpd_roles_list`'s refusal and `mpd_ext_list`'s item error say the
 * same thing about the same fixture. It is reproduced rather than imported on purpose: this
 * package must stay usable with no extension row mounted at all.
 */
const PROJECT_ROLES_REASON =
  "project-level extensions may contribute skills and flows only: tool and provider registration is process-global and cannot be scoped to a session"

/** One role this roster exposes, whichever plane contributed it: a base specialist
 *  (`extension === null`) or an extension-contributed role. */
export interface ResolvedRole {
  /** The stable chain key. INTERNAL: no tool output, description, render, web route or GUI exposes it. */
  id: string
  /** The functional display name a caller addresses this role by. */
  name: string
  /** One-line role summary, as the roster declares it. */
  description: string
  /** True for the members the read-only discipline protects. */
  readonly: boolean
  /** The model-chain candidates, copied so a caller cannot mutate the roster. */
  chain: Array<{ provider: string; model: string }>
  /** The persona text, already resolved from the asset or the description. */
  persona: string
  /** Where the persona text came from, for diagnostics — never a key. */
  personaFile: string
  /** Owning extension id; `null` for a base roster role. */
  extension: string | null
}

/** An extension-contributed role the roster REFUSED to expose, with its one-line reason. */
export interface RefusedRole {
  /** The extension whose role was refused. */
  extension: string
  /** The role name exactly as the extension declared it. */
  name: string
  /** One line saying why it is not exposed, naming the colliding owner where there is one. */
  reason: string
}

/** The roster as ONE call sees it: the base specialists plus this call's extension roles. */
export interface RoleSurface {
  /** The roles this call may address: base specialists plus this call's extension roles. */
  roles: ResolvedRole[]
  /** Extension roles that were refused, each with its reason — a refusal is never silent. */
  refused: RefusedRole[]
}

/** A string field read defensively: a non-string reads as empty. */
function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** A thrown value's message, for a warning that must never itself throw. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Namespaced stable id of an extension-contributed role. Base ids are single lowercase
 *  words and none starts with `ext-`, so this namespace can never collide with one; the id
 *  doubles as a modelchain chain key and as the workmate `meta.baseId`. */
export function extensionRoleId(extensionId: string, name: string): string {
  /** The name reduced to a kebab slug, so the namespaced id stays readable and stable. */
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return "ext-" + extensionId + "-" + (slug || "role")
}

/** Read one extension-root-relative persona file. `null` = unreadable, which refuses that
 *  ONE role — never the roster. */
function readExtensionPersona(root: string, file: string): string | null {
  if (!root || !file) return null
  try {
    /** The artifact-relative persona path, resolved against the extension root. */
    const path = resolve(root, file)
    if (existsSync(path)) {
      /** The persona's trimmed body; empty counts as unreadable. */
      const body = readFileSync(path, "utf8").trim()
      if (body) return body
    }
  } catch { /* falls through to null: a refused role, reported with its reason */ }
  return null
}

/**
 * Merge this call's extension-contributed roles into the base roster — PER CALL.
 *
 * `ctx.get("mpdExtensions")` is resolved HERE, at call time, and never cached at apply: the
 * roster's module-level maps are built at import, so an apply-time array merge would silently
 * lose every role whose extension row applied after mpd-roles (rows apply concurrently and row
 * order is not a dependency mechanism). A missing service (the standalone case), a throwing
 * proxy ctx, an unreadable persona and a name collision each degrade exactly ONE role and are
 * recorded — the base roster keeps answering throughout.
 *
 * The mapping to the roster shape: a namespaced stable id, the declared `name`/`description`,
 * `readonly` (absent = false, the contract's explicit default), the persona TEXT read from the
 * extension root, and `chain` from the optional provider+model pair.
 */
export function extensionRoles(ctx: Ctx, exec: unknown, warn: (line: string) => void): { roles: ResolvedRole[]; refused: RefusedRole[] } {
  /** Roles accepted so far, the base roster excluded. */
  const roles: ResolvedRole[] = []
  /** Roles refused so far, each with its actionable reason. */
  const refused: RefusedRole[] = []
  // Name collision map. The base roster owns its names first: the base always wins.
  const owner = new Map<string, string>()
  for (const role of ROLES) owner.set(normalizeRoleNameKey(role.name), "the base roster")

  /** The mpdExtensions service, or undefined when that row is not mounted. */
  let service: any
  try {
    service = typeof ctx?.get === "function" ? ctx.get(EXTENSIONS_SERVICE) : undefined
  } catch (error) {
    // An agent-scoped cordis ctx is a proxy that THROWS on any key missing from `inject`.
    warn("ctx.get(\"" + EXTENSIONS_SERVICE + "\") failed (" + errText(error) + ") — the roster stays base-only for this call")
    return { roles, refused }
  }
  if (service === undefined || service === null || typeof service.list !== "function") return { roles, refused }

  /** The extension views this call sees, or an empty list when the snapshot is unusable. */
  let views: any[]
  try {
    /** The service's own snapshot; a shape it does not carry reads as no extensions. */
    const snapshot = service.list({ exec })
    views = Array.isArray(snapshot?.extensions) ? snapshot.extensions : []
  } catch (error) {
    warn("mpdExtensions.list() failed (" + errText(error) + ") — the roster stays base-only for this call")
    return { roles, refused }
  }

  for (const view of views) {
    /** The contributing extension's id, which namespaces the role ids below. */
    const extensionId = text(view?.id)
    if (extensionId === "") continue
    // A config-disabled extension contributes nothing anywhere else, so it contributes no
    // roles either.
    if (view?.enabled === false) continue
    /** The roles the extension declares, when it declares any at all. */
    const declared = view?.descriptor?.contributes?.roles
    if (!Array.isArray(declared)) continue
    // A PROJECT-plane extension may contribute skills and flows only: tool and provider
    // registration is process-global and cannot be scoped to a session, so the extension side
    // REJECTS its `roles` item and loads nothing. Mirror that here (t14 measured the leak:
    // mpd-roles checked enabled/roles/persona and never the plane, so it exposed a role the
    // extension side had rejected — the two surfaces disagreed about what is usable). Same shape
    // as the disabled guard above: skip the extension's roles entirely, and record WHY per role
    // so the refusal is visible in mpd_roles_list instead of being dropped silently.
    if (view?.plane === PROJECT_ONLY_PLANE) {
      for (const item of declared) {
        /** The declared role name; an empty one is not addressable and is skipped. */
        const name = text(item?.name).trim()
        if (name === "") continue
        refused.push({ extension: extensionId, name, reason: PROJECT_ROLES_REASON })
      }
      continue
    }
    /** The extension's root, against which its persona paths resolve. */
    const root = text(view?.root)
    declared.forEach((item: any, index: number) => {
      /** The declared role name; an empty one was already rejected by the registry. */
      const name = text(item?.name).trim()
      if (name === "") return // the registry already rejected it; there is nothing to expose
      /** Record this role's refusal with its one-line reason. */
      const refuse = (reason: string): void => { refused.push({ extension: extensionId, name, reason }) }
      /** The declared item's address inside the descriptor, quoted in every refusal. */
      const itemLabel = "contributes.roles[" + index + "]"
      /** The collision key, in the roster's own collapsed-name form. */
      const key = normalizeRoleNameKey(name)
      /** Who already owns that name, or undefined when it is still free. */
      const takenBy = owner.get(key)
      if (takenBy !== undefined) {
        refuse("role name \"" + name + "\" (" + itemLabel + " of extension \"" + extensionId + "\") is already taken by " + takenBy + " — this extension role is not exposed")
        return
      }
      /** The namespaced stable id this role would take. */
      const id = extensionRoleId(extensionId, name)
      if (ROLE_BY_ID[id] !== undefined) {
        refuse("role id \"" + id + "\" collides with the base roster — this extension role is not exposed")
        return
      }
      /** Where the persona was looked for, reported when it turns out to be unreadable. */
      const personaFile = root === "" ? text(item?.persona) : resolve(root, text(item?.persona))
      /** The persona text, or null when the file is unreadable — which refuses this ONE role. */
      const persona = readExtensionPersona(root, text(item?.persona))
      if (persona === null) {
        refuse("persona file is not readable: " + personaFile)
        return
      }
      /** The role's model chain: the declared provider+model pair, or empty when either is absent. */
      const chain = typeof item?.provider === "string" && typeof item?.model === "string"
        ? [{ provider: item.provider, model: item.model }]
        : []
      owner.set(key, "extension \"" + extensionId + "\"")
      roles.push({
        id,
        name,
        description: text(item?.description),
        readonly: item?.readonly === true,
        chain,
        persona,
        personaFile,
        extension: extensionId,
      })
    })
  }
  return { roles, refused }
}

/**
 * Adapter identity of THIS row's resolution — the assertable half of F1, mirrored
 * from mpd-ext so both rows report one vocabulary.
 * CROSS-REFERENCE (F5): the CANONICAL NOTE on how a row reaches the ONE shared adapter — what
 * eager `ctx.get("mpdDsh")` costs, why T-50 replaced it with a lazy per-use resolution, and how
 * the two miss modes are told apart — lives in `packages/mpd-ext-plugin/src/index.ts`
 * (next to the export of these constants). It is NOT restated here on purpose — read it there
 * before touching this line.
 */
export {
  ADAPTER_IDENTITY_FALLBACK,
  ADAPTER_IDENTITY_MOUNTED,
  ADAPTER_IDENTITY_PENDING,
} from "../../mpd-dsh-adapter-plugin/src/index"

/** Row entry point: provide `mpdRoles`, register the three tools, then install the team plane. */
export function apply(ctx: Ctx, config: Config = {}): void {
  /** Report one line through the ctx logger, falling back to stdout. */
  const warn = (line: string): void => {
    /** The line with this row's prefix, so a boot log attributes it. */
    const message = "[mpd-roles] " + line
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
      else rowLogLine("mpd-roles", message)
    } catch { /* logging must never take the roster down */ }
  }
  // The adapter-identity warning must be visible in a HEADLESS boot as well:
  // `ctx.logger.warn` has no sink there (the same measured reason mpd-ext writes
  // every line to stdout), so this one line always reaches stdout AND the logger.
  const adapterWarn = (line: string): void => {
    /** The line with this row's prefix, for the stdout-first reporter. */
    const message = "[mpd-roles] " + line
    try {
      rowLogLine("mpd-roles", message)
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    } catch { /* logging must never take the roster down */ }
  }

  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  // LAZY (T-50): nothing is resolved at apply. The facade probes `mpdDsh` on every use and caches
  // only a successful STRICT read, so a sibling provider that is still starting cannot leave this
  // row with a private adapter for the session; the one-line warning (when it fires) comes from the
  // shared resolver with the honest wording — "provider not yet active" vs a provably missing row.
  const dsh = createLazyDshAdapter(ctx, { label: "mpd-roles", warn: adapterWarn })
  // A refusal or a failed lookup is reported ONCE per process+reason: mpd_roles_list is
  // polled, and a repeating warning is noise. Never fatal.
  const warned = new Set<string>()
  /** Report a line at most once per key: the roster tools are polled, and repeats are noise. */
  const warnOnce = (key: string, line: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    warn(line)
  }

  /**
   * The read-only deny list ONE spawn really sends, validated by the harness itself.
   *
   * WHY (measured defect F2, 2026-10-10): `tools.restrict()` rejects the WHOLE list when a single name
   * is not registered in this profile, so the two `mcp__lsp__*` entries killed EVERY read-only spawn of
   * the roster on a host without `cclsp` — which is what pushed the captain onto the official `subagent`
   * tool this gate now refuses. The canonical `READONLY_DENY` is NOT changed and never pre-filtered with
   * a `hasTool` probe (AGENTS.md §13): the restriction is applied to THIS agent's own scope and released
   * in the same synchronous turn, so the harness's own verdict is the only pruner, and the pruned names
   * are reported ONCE through this row's logger.
   *
   * @param agent - the spawning session's own agent handle, whose scope is the harness's validation site.
   * @returns the list to hand the child as `toolFilter.deny`.
   */
  const validatedReadonlyDeny = (agent: unknown): string[] => {
    // THIS IS A PROBE, NOT AN APPLICATION. `restrictToolsTolerant` applies each attempt and
    // RELEASES it at once (its contract: "a probe must not linger"), so the list it returns is
    // what a caller can then apply for real. Routing a real deny through it left a read-only
    // child's first `request/header` fully write-capable — measured live on 0.2.1, 2026-10-17.
    /** The caller's own scope; without it the canonical list is returned unvalidated. */
    const scope = dsh.agentScope(agent)
    if (scope === undefined) {
      warnOnce("readonly-deny:no-scope", "read-only spawn: this agent exposes no scoped context, so the canonical deny list is returned unvalidated")
      return [...READONLY_DENY]
    }
    /** The harness's verdict on the canonical list, with the contract's one permitted pruning round. */
    const outcome = restrictToolsTolerant((names) => scope.tools.restrict({ deny: names }), READONLY_DENY)
    if (outcome.pruned.length > 0) {
      warnOnce("readonly-deny:pruned", "read-only spawn: pruned tool name(s) this profile does not register: " + outcome.pruned.join(", "))
    }
    return [...outcome.applied]
  }

  /**
   * The TOTAL slot resolution of one roster member, read PER CALL from the live config service.
   *
   * THE DEFECT THIS READS FOR (measured on a real machine, 2026-10-12). Both live profiles carried
   * a SAVED `teamModels` block in the `mpd-config` row config, and `mpd-config-plugin` served it —
   * but the ONLY reader was `mpd-roster-provider-plugin`, so every single-call consult path kept
   * the STATIC `roles.data.ts` chain and ignored the user's save. From the slot-single-source wave on
   * the slot is the ONLY route source for a roster member: this read is what makes a saved slot take
   * effect here, and an unusable slot is what makes the spawn REFUSE loudly.
   *
   * The membership map stays in `mpd-config-plugin` — the ONE declaration the settings card, the TUI
   * section and the roster provider already share — and is reached here as a SERVICE, never as an
   * import: a new cross-package relative import would be a new entry in the frozen coupling
   * inventory (`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`,
   * which may only shrink).
   *
   * TOTALITY (contract amendment 1): the service method never throws, and a display caller
   * (`roleSurface`) must be able to render the state it returns.
   *
   * @param member - the roster member's functional name.
   * @returns the typed resolution: a usable route plus its fallback chain, or why it is unusable,
   *   or `unrouted` (an extension role, or no config service mounted).
   */
  const slotResolution = (member: string): LiveSlotResolution => {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = ((): ConfigServiceLike | undefined => {
      try {
        return ctx.get?.(CONFIG_SERVICE, false) as ConfigServiceLike | undefined
      } catch {
        // A config service that refuses the lookup reads as ABSENT, never as a boot failure.
        return undefined
      }
    })()
    if (typeof live?.slotResolutionOf === "function") {
      /** The service's TOTAL answer, trusted when it has the union's shape. */
      const value = live.slotResolutionOf(member) as LiveSlotResolution | undefined
      if (value !== undefined && value !== null && typeof value === "object" && typeof value.ok === "boolean") return value
    }
    // VERSION SKEW (a stale config-row dist): the older total route read still answers, and a
    // throw from the pre-wave contract propagates exactly as it did before this wave.
    if (typeof live?.teamModelRouteOf === "function") {
      /** The older read's route, or undefined when it has none to report. */
      const route = live.teamModelRouteOf(member) as LiveRoute | undefined | null
      if (route !== undefined && route !== null && typeof route === "object") {
        return { ok: true, slot: "", route, fallbacks: [] }
      }
    }
    // A BASE roster member with no readable slot has NO route source left: the static
    // `roles.data.ts` chain is not a default layer (contract §2/§4), so the answer is the typed
    // refusal rather than a silent fallback to the shipped route. An EXTENSION role is genuinely
    // `unrouted`: its route is its extension's own declaration, not a slot.
    if (ROLES.some((r) => r.name === member)) {
      return {
        ok: false,
        status: "unconfigured",
        slot: "",
        members: [member],
        missing: ["provider", "model"],
        code: "SLOT_UNCONFIGURED",
        message: "SLOT_UNCONFIGURED: " + member + "'s team-model slot is not configured — the mpdConfig service answered no slot (is the mpd-config row mounted?); nothing was written and no child was started. Configure it with /mpd-model, or set teamModels.<slot> for this member in .mpd/mpd.jsonc.",
      }
    }
    return { ok: false, status: "unrouted", slot: undefined }
  }

  /**
   * Throw the ONE structured `SLOT_UNCONFIGURED` failure a spawn refuses on (contract §7).
   *
   * The canonical sentence (slot, members, missing/malformed leaves, both recovery paths, and the
   * "nothing was written and no child was started" guarantee) is BUILT by the config service and
   * carried in the union, so every consumer reports the same words. This helper only attaches the
   * machine-readable `code` so a caller can branch without parsing prose.
   * @param resolution - the unusable resolution the service returned.
   * @returns never; it always throws.
   */
  const throwSlotUnconfigured = (resolution: LiveSlotResolution): never => {
    if (resolution.ok) throw new Error("mpd_role_spawn: internal error — a usable slot was passed to the refusal helper")
    if (resolution.status === "unrouted") throw new Error("mpd_role_spawn: internal error — an unrouted member was passed to the refusal helper")
    /** The thrown error, carrying both the canonical message and the branchable code. */
    const error = new Error(resolution.message)
    ;(error as Error & { code?: string }).code = resolution.code
    throw error
  }

  /** The roster as THIS call sees it. Resolved per call (never an apply-time cache). */
  const roleSurface = (exec?: unknown): RoleSurface => {
    /** The base roster projected for THIS call, each persona already read. */
    const base: ResolvedRole[] = ROLES.map((r) => {
      /** The static chain for this role, copied so no caller can mutate the roster table. */
      const chain: Array<{ provider: string; model: string }> = r.chain.map((c) => ({ ...c }))
      /** The TOTAL slot resolution the config service reports for this member, read PER CALL. */
      const resolution = slotResolution(r.name)
      // THE SLOT IS AUTHORITATIVE for a member it routes (contract §2-§3): a usable slot makes the
      // chain that ONE route, so `mpd_roles_list`, a workmate initialized from this base AND
      // `mpd_modelchain_resolve` (which prefers `spec.chain`) all report what the user saved.
      if (resolution.ok) chain.splice(0, chain.length, { provider: resolution.route.provider, model: resolution.route.model })
      // AN UNUSABLE SLOT BLANKS THE CHAIN (amendment 1 §5): keeping the static route here would let a
      // display surface — and `mpd_modelchain_resolve` — report a route no spawn may ever use.
      else if (resolution.status !== "unrouted") chain.splice(0, chain.length)
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        readonly: r.readonly,
        chain,
        persona: readPersona(config, r),
        personaFile: personaPath(config, r),
        extension: null,
      }
    })
    /** The extension plane's contributions and refusals for this call. */
    const contributed = extensionRoles(ctx, exec, (line) => warnOnce("lookup:" + line, line))
    for (const refusal of contributed.refused) {
      // The refused role is NAMED here (its reason does not always carry the name — the project
      // -plane reason and the unreadable-persona reason do not), so a log line is actionable.
      warnOnce("refused:" + refusal.extension + ":" + refusal.name, "extension role refused: \"" + refusal.name + "\" (" + refusal.extension + ") — " + refusal.reason)
    }
    return { roles: [...base, ...contributed.roles], refused: contributed.refused }
  }

  /** Resolve one role key against a surface: the base ids/legacy aliases/names first, then an
   *  extension role by its namespaced id or its declared name in any case/separator spelling.
   *
   *  This is the INTERNAL (service) resolution and stays PERMISSIVE on purpose: `mpdRoles.get` is
   *  what chain lookup and legacy callers read. The TOOL surface must NOT call it — a tool resolves
   *  through `roleOfToolInput`, which accepts a NAME spelling only. */
  const roleOf = (surface: RoleSurface, key: string): ResolvedRole | null => {
    /** The key in its canonical internal form, when it resolved to one. */
    const id = normalizeRoleKey(key)
    if (id) {
      /** The BASE role that id names; an extension role never resolves through this path. */
      const found = surface.roles.find((role) => role.extension === null && role.id === id)
      if (found) return found
    }
    /** The trimmed key, tried next as an extension role's namespaced id or name. */
    const raw = String(key ?? "").trim()
    if (raw === "") return null
    /** An extension role addressed by its namespaced stable id. */
    const namespaced = surface.roles.find((role) => role.extension !== null && role.id === raw)
    if (namespaced) return namespaced
    /** The key in the roster's collapsed-name form, the last thing tried. */
    const nameKey = normalizeRoleNameKey(raw)
    return surface.roles.find((role) => role.extension !== null && normalizeRoleNameKey(role.name) === nameKey) ?? null
  }

  /** Every name this surface answers to — what an unknown-role error lists. */
  const roleNameListOf = (surface: RoleSurface): string => surface.roles.map((role) => role.name).join(", ")

  // ── the child's persona and read-only discipline (harness 0.2.1-rc.2) ──────────────────────
  //
  // 0.2.1-rc.2 REMOVED `persona` and `toolFilter` from the subagent start request, so
  // `spawnAgent` could deliver neither: a child raised by `mpd_role_spawn` lost its role framing
  // and a read-only member lost its write denial. `installChildPersonaSeam` restores both on the CHILD's
  // OWN scoped context from an `agent/created` listener — the window the harness itself guarantees,
  // because publication (and with it the dispatch) precedes the child's first prompt.
  /**
   * Apply the canonical read-only deny to one CHILD's own scope, for real and without pruning.
   *
   * The disposer is deliberately NOT called: the restriction must outlive this call and is released
   * by the host with the child's own scope. A failure is reported with the surface size, because the
   * one thing this must never do is fail silently — a read-only member that can write is the defect
   * this whole seam exists to prevent.
   * @param agent - the freshly created child whose own scope is restricted.
   */
  const applyChildReadonlyDeny = (agent: unknown): void => {
    // THE SINK IS `rowLogLine`, DELIBERATELY — not `warn`. `warn` prefers `ctx.logger.warn`, and that
    // sink is not captured in a headless boot and does not reach `mpd-roles.log`, so a security
    // decision would leave no trace an operator could find. The workmate twin already writes to disk;
    // observability of the same discipline must be SYMMETRIC or a verifier can only cite half of it.
    try {
      // RETAINED + TOLERANT: a scope that does not know `mcp__lsp__*` (a profile without `cclsp`)
      // rejects the WHOLE list, so an unpruned apply would deny NOTHING and leave this member
      // writable. The applier prunes exactly the names the host reports and retries once.
      /** The accepted names and whatever the host pruned as unknown here. */
      const outcome = dsh.restrictAgentToolsRetained(agent, [...READONLY_DENY])
      // ONE line per child, carrying BOTH numbers: a future pruning regression, or a profile that
      // quietly lost a toolchain, is then visible on disk instead of inferred from a header.
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: applied " + outcome.applied.length + " denials to its own tool scope"
        + (outcome.pruned.length === 0 ? "" : " (pruned as unknown in this composition: " + outcome.pruned.join(", ") + ")"))
    } catch (error) {
      rowLogLine("mpd-roles", "[mpd-roles] read-only child: the deny could NOT be applied (" + String((error as Error)?.message ?? error) + ") — this member may be able to write")
    }
  }

  installChildPersonaSeam(dsh, {
    // Resolved through the SAME surface `mpd_role_persona` uses, so a base member and an
    // extension-contributed role are handled by one path (personas are small files, and subagent
    // creation is not a hot loop).
    resolve: (label) => {
      /** The roster member this child label names, or null for any other child. */
      const spec = roleOf(roleSurface(undefined), label)
      return spec === null ? null : { persona: spec.persona, readonly: spec.readonly }
    },
    // The read-only deny is validated against the CHILD's scope — the surface it truly filters.
    // APPLY FOR REAL, AND NEVER PRUNE HERE. Two distinct defects are closed by this one line:
    //   (1) `validatedReadonlyDeny` is a PROBE — it applies each attempt and RELEASES it at once —
    //       so routing the live deny through it denied nothing;
    //   (2) that same probe PRUNES any name the agent's surface does not currently show. Inside
    //       `agent/created` the child's surface may still be empty, so pruning collapses the
    //       canonical eight names to `[]`, and `restrict({deny: []})` succeeds while restricting
    //       NOTHING — a security control silently degrading to a no-op.
    // The canonical list is therefore applied verbatim: these names ARE the read-only guarantee,
    // and a harness that rejects one must say so loudly rather than quietly narrow the guarantee.
    restrictReadonly: (agent) => { applyChildReadonlyDeny(agent) },
    warn: (line) => warnOnce("child-persona:" + line, line),
    // Guarded: the event bus is optional, and a row must never lose its boot over a listener it
    // cannot attach (a mounted-adapter double may expose none of the two seams).
    onEvent: typeof dsh.onEvent === "function" ? dsh.onEvent : undefined,
  })

  ctx.provide("mpdRoles", {
    /** Which adapter branch THIS read reaches — read at surface time, never cached at apply (T-50). */
    adapterIdentity: dshAdapterIdentity(ctx),
    list: () => roleSurface(undefined).roles.map((r) => ({ id: r.id, name: r.name, description: r.description, readonly: r.readonly, chain: r.chain.map((c) => ({ ...c })), personaFile: r.personaFile, persona: r.persona, extension: r.extension })),
    get: (key: string) => {
      /** The resolved role, or null when the key names nothing on this surface. */
      const spec = roleOf(roleSurface(undefined), key)
      return spec === null ? null : { id: spec.id, name: spec.name, description: spec.description, readonly: spec.readonly, chain: spec.chain.map((c) => ({ ...c })), persona: spec.persona, extension: spec.extension }
    }
  })

  dsh.registerTool({
    name: "mpd_roles_list",
    description: "List the specialist roster — the SAME normal-named specialists team mode stages as teammates, each named for what it does: " + rosterFunctionList() + ". Address a role by that name (any case, space or hyphen spelling). Use this before mpd_role_spawn; for team work stage the roster with `agent_teams_plan` (add_member with the persona text from mpd_role_persona → create_task with its dependency answer → approve) instead of repeated single-call consults.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { roles: { type: "array", items: { type: "object" } }, count: { type: "integer" }, refused: { type: "array", items: { type: "object", properties: { extension: { type: "string" }, name: { type: "string" }, reason: { type: "string" } }, required: ["extension", "name", "reason"] } } }, required: ["roles", "count"] }, render: (_a: unknown, v: any) => textBlock("roster (" + v.count + "):\n" + v.roles.map((r: any) => "- " + r.name + " [" + r.model + (r.readonly ? " readonly" : "") + (r.extension ? " extension:" + r.extension : "") + "] — " + r.description).join("\n") + (Array.isArray(v.refused) && v.refused.length > 0 ? "\nrefused (" + v.refused.length + "):\n" + v.refused.map((r: any) => "- " + r.name + " (" + r.extension + ") — " + r.reason).join("\n") : "")) },
    execute: async (_args: any, exec: any) => {
      /** The roster as this call sees it: base specialists plus extension roles. */
      const surface = roleSurface(exec)
      /** The listed rows: name, capability and route, never the internal id. */
      const roles = surface.roles.map((r) => ({ name: r.name, description: r.description, readonly: r.readonly, provider: r.chain[0]?.provider ?? null, model: r.chain[0]?.model ?? null, extension: r.extension }))
      return { roles, count: roles.length, refused: surface.refused.map((r) => ({ extension: r.extension, name: r.name, reason: r.reason })) }
    }
  })

  dsh.registerTool({
    name: "mpd_role_spawn",
    description: "Run ONE bounded delegation with a specialist and return one report — a ONE-SHOT single-call consult: the adapter disposes the activation once the report settles, so the consult is NOT reused — ask a new question with a NEW spawn (the harness catalog is append-only, so a settled child may still list as `inactive`, but the contract is one-shot). It carries the role's persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each named for what it does: " + rosterFunctionList() + ". The child is labelled with that name. `mpd_workmate_spawn` is the same spawn mechanics for a durable, evolving instance (its persona/memory/note — not the child session — carry continuity). For multi-member team work prefer the mpd team path (`agent_teams_plan`: add_member → create_task with its dependency answer → approve; drive with `agent_teams_task`/`agent_teams_dispatch`) instead of repeated single-call consults: THIS path applies the role's `teamModels` slot, and a teammate staged through `agent_teams_plan` is routed the same way by the team executor — its `role` first, then its `description` head; only an UNMATCHED member inherits the staging session's route.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list), e.g. \"Architect\" or \"Deep Worker\"" }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a: unknown, v: any) => textBlock("role " + v.role + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "") + (v.evidence?.length ? "\nevidence:\n- " + v.evidence.join("\n- ") : "")) },
    execute: async (args: any, exec: any) => {
      /** The roster as this call sees it: base specialists plus extension roles. */
      const surface = roleSurface(exec)
      /** The resolved role, or null — in which case the error lists every addressable name. */
      const spec = roleOfToolInput(surface, String(args?.role ?? ""))
      if (spec === null) throw new Error("mpd_role_spawn: unknown role — use a roster NAME (see mpd_roles_list): " + roleNameListOf(surface))
      /** The task text; empty is a caller error and must not spawn an empty prompt. */
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_role_spawn: task required")
      /** The role's persona text, sent both inside the prompt and as the subagent's persona. */
      const persona = spec.persona
      /** The TOTAL slot resolution for this member — the ONE route source a roster member has. */
      const resolution = slotResolution(spec.name)
      // AN UNUSABLE SLOT REFUSES THE SPAWN (contract §7): ONE structured SLOT_UNCONFIGURED failure
      // naming the slot, its members, the missing leaves and both recovery paths — and NOTHING is
      // written and no child is started, because the spawn below is never reached.
      if (!resolution.ok && resolution.status !== "unrouted") throwSlotUnconfigured(resolution)
      /** The primary route: the slot's when it is usable. An EXTENSION role is not slot-routed, so
       *  its own declared chain (its extension's route, not a roster default) is the primary. */
      const primary: LiveRoute | undefined = resolution.ok
        ? resolution.route
        : spec.chain[0] === undefined ? undefined : { provider: spec.chain[0].provider, model: spec.chain[0].model }
      if (primary === undefined) {
        throw new Error("mpd_role_spawn: " + spec.name + " has no configured route — an extension role must declare provider+model, and a roster member needs its teamModels slot configured (/mpd-model)")
      }
      // THE ONE PRE-SPAWN CONSUMPTION (contract §8): the slot's fallback chain, resolved ONCE against
      // the model catalog (first positively-listed candidate wins), then the effort adaptation. A
      // model whose catalog entry declares no reasoning efforts loses the keyword instead of failing
      // the call; an unsupported effort on a model that DOES declare efforts stays VISIBLE, because
      // clamping it would hide a configuration error.
      /** The route this spawn actually sends. */
      const run = await resolveRunRoute(dsh, primary, resolution.ok ? resolution.fallbacks ?? [] : [])
      /** The primary route's provider. */
      const provider = run.route.provider
      /** The model for this spawn: the slot's (or its winning fallback's) — there is NO caller override. */
      const model = run.route.model
      /** The assembled prompt: persona, task, optional context and the report instruction. */
      const prompt = persona + "\n\nTask: " + task + (args?.context ? "\n\nContext:\n" + String(args.context) : "") + "\n\nWork with the tools your role requires (read-only roles must never modify anything). End with ONLY the structured report (role/summary/recommendation/details/evidence)."
      /** The spawn result, whose structured report is echoed into this tool's output. */
      const result = await dsh.spawnAgent({
        label: spec.name,
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        provider,
        model,
        persona,
        outputSchema: REPORT_SCHEMA,
        // The slot's OWN effort keyword rides along when its resolved route states one — AFTER the
        // fallback consumption and the effort adaptation above. The contract still forbids clamping
        // or inventing an effort, so an absent keyword passes nothing and the harness keeps its own
        // resolution.
        ...(run.route.reasoningEffort === undefined ? {} : { agentOptions: { reasoningEffort: run.route.reasoningEffort } }),
        ...(spec.readonly ? { toolFilter: { deny: validatedReadonlyDeny(exec.agent) } } : {})
      })
      /** The structured report, or an empty object when the subagent answered none. */
      const st = result.structured ?? {}
      return { role: spec.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null }
    }
  })

  dsh.registerTool({
    name: "mpd_role_persona",
    description: "Return the full persona text of one roster role, addressed by its name (\"Architect\", \"Deep Worker\", \"Plan Reviewer\"). Use it when a spawn surface takes the persona as TEXT — e.g. the prompt of a teammate staged with `agent_teams_plan` add_member whose name is that same name — so the member gets the real role instructions instead of a bare label.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a: unknown, v: any) => textBlock("persona " + v.role + " (" + v.chars + " chars):\n" + v.persona) },
    execute: async (args: any, exec: any) => {
      /** The roster as this call sees it: base specialists plus extension roles. */
      const surface = roleSurface(exec)
      /** The resolved role, or null — in which case the error lists every addressable name. */
      const spec = roleOfToolInput(surface, String(args?.role ?? ""))
      if (spec === null) throw new Error("mpd_role_persona: unknown role — use a roster NAME (see mpd_roles_list): " + roleNameListOf(surface))
      return { role: spec.name, persona: spec.persona, chars: spec.persona.length }
    }
  })

  // ── the roster's TEAM plane (AGENTS.md §13 + §1) ────────────────────────────
  // Retiring the vendored agent-teams body removed the ONLY implementation of two BINDING
  // contracts: the roster's mechanical read-only discipline (the shipped profile carried
  // each read-only member's toolDeny) and the session-start complexity gate. Both are
  // restored HERE, on the OFFICIAL plugin's seams, reached only through the adapter:
  //   1. a tool guard over the SAME eight names the role-spawn path denies;
  //   2. an AGENT-SCOPED roster section, so an mpd Lead knows the members it can stage;
  //   3. the session-start complexity gate, MECHANICAL by default since the 2026-10-20 restore: an
  //      untouched `team.gate` stages an APPROVABLE PLAN SHELL (0 members, 0 tasks) through the
  //      `agent_teams_plan` tool — never a team, never a member — and `advisory` / `off` are the
  //      deliberate opt-outs.
  // A THIRD contract was installed here on 2026-10-10/11 — a reconnaissance ban, a spawn-tool ban and a
  // mandatory A-writes/B-verifies seat for the top-level agent. The user's 2026-10-17 ruling withdrew the
  // bundle (`.mpd/plans/harness-021-rollback.md` R1), and the 2026-10-20 split restored the TWO
  // reconnaissance/delegation guards while the write guard stays withdrawn: the boot line reports their
  // modes and `verifyGate=absent` with {@link withdrawnReason} for the one that no longer installs.
  // Each remaining installer degrades with a warning instead of taking the row down.
  const teamMembers = (): Array<{ name: string; description: string; readonly: boolean }> => ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }))
  /**
   * ONE team-plane config value for ONE key, resolved PER CALL and never cached.
   *
   * Precedence: the mounted `mpdConfig` layer first (a `.mpd/mpd.jsonc` edit is therefore picked up
   * LIVE, T-18), this row's own config second, `undefined` last so the plugin's own default applies.
   * @param key - the dot-path key, e.g. `team.gate`, `boulder.dir`, `captain.investigation` or `delegation.gate`.
   * @returns the raw value, or `undefined` when neither layer declares it.
   */
  const configValue = (key: string): unknown => {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = ((): { get?: (k: string) => unknown } | undefined => {
      try {
        return ctx.get?.(CONFIG_SERVICE, false) as { get?: (k: string) => unknown } | undefined
      } catch {
        // A config service that refuses the lookup reads as ABSENT, never as a boot failure.
        return undefined
      }
    })()
    /** The live layer's answer, which wins whenever the key is really declared there. */
    const value = ((): unknown => {
      try {
        return live?.get?.(key)
      } catch {
        return undefined
      }
    })()
    if (value !== undefined) return value
    if (key === GATE_CONFIG_KEY) return config.team?.gate
    if (key === SENSITIVITY_CONFIG_KEY) return config.team?.sensitivity
    if (key === BOULDER_DIR_CONFIG_KEY) return config.boulder?.dir
    if (key === INVESTIGATION_CONFIG_KEY) return config.captain?.investigation
    if (key === DELEGATION_CONFIG_KEY) return config.delegation?.gate
    return undefined
  }
  // The TEAM PLANE's boot signature: ONE line naming every installed contract and its outcome, so an
  // integration boot asserts the guard reached the tool registry (a
  // `[mpd-roles] team plane: readOnlyGuard=installed deny=8 …` line) instead of trusting the
  // absence of an error. The roster section logs its OWN line per agent scope when it lands.
  const guardOutcome: string[] = []
  try {
    /** The guard's install outcome, which the team-plane boot signature reports below. */
    const guard = installReadonlyGuard(dsh, {
      deny: READONLY_DENY,
      members: teamMembers(),
      warn: (line) => warnOnce("team-guard:" + line, line),
    })
    guardOutcome.push(guard.installed
      ? "readOnlyGuard=installed deny=" + READONLY_DENY.length
      : "readOnlyGuard=absent reason=" + String(guard.reason))
  } catch (error) {
    guardOutcome.push("readOnlyGuard=absent reason=threw")
    warnOnce("team-guard:threw", "the team-path read-only guard could not be installed (" + errText(error) + ")")
  }
  // ── THE RECONNAISSANCE AND DELEGATION GUARDS (restored 2026-10-20) ─────────
  // The user's 2026-10-17 ruling withdrew three mechanical guards together with the persona
  // restoration; the 2026-10-20 ruling split that bundle: the LONG PROMPT stays, but the top-level
  // `mpd` session must again DELEGATE its reconnaissance and must again delegate through THIS bundle's
  // own surfaces (`mpd_role_spawn`, the workmate library, Agent Teams). Measured reason: with the
  // guards gone the captain did every search itself, the roster/team tools went unused and the
  // session's context inflated by one file read after another. `verify.mode` (the write guard) stays
  // withdrawn — the captain still writes code directly; only the hook is gone, not the discipline.
  //
  // Both installs are CONTAINED: a seam-less composition reports the guard `absent` with its reason and
  // keeps the rest of the row, exactly as before.
  try {
    /** The guard's install outcome, whose MODE the team-plane boot signature reports below. */
    const investigation = installCaptainInvestigationGuard(dsh, {
      workspaceRootOf: (exec) => dsh.workspaceRoot(exec),
      configValue,
      warn: (line) => warnOnce("captain-investigation:" + line, line),
    })
    guardOutcome.push(investigation.installed
      ? "captainInvestigation=" + investigation.mode
      : "captainInvestigation=absent reason=" + String(investigation.reason))
  } catch (error) {
    guardOutcome.push("captainInvestigation=absent reason=threw")
    warnOnce("captain-investigation:threw", "the captain investigation guard could not be installed (" + errText(error) + ")")
  }
  try {
    /** The gate's install outcome, whose MODE the team-plane boot signature reports below. */
    const delegation = installDelegationGate(dsh, {
      configValue,
      warn: (line) => warnOnce("delegation-gate:" + line, line),
    })
    guardOutcome.push(delegation.installed
      ? "delegationGate=" + delegation.mode
      : "delegationGate=absent reason=" + String(delegation.reason))
  } catch (error) {
    guardOutcome.push("delegationGate=absent reason=threw")
    warnOnce("delegation-gate:threw", "the delegation gate could not be installed (" + errText(error) + ")")
  }
  // THE WRITE GUARD STAYS WITHDRAWN (user ruling 2026-10-17, kept by the 2026-10-20 split): the captain
  // writes code without an armed verification loop. The token stays on the boot line so a mount lane can
  // SEE the state, and it says `absent` plus the reason — never a mode for an install that does not run.
  guardOutcome.push("verifyGate=absent reason=" + withdrawnReason("verify.mode"))
  // THE ask_user_question BOUNDARY GUARD, installed at this same site: the HOST tool's schema marks
  // `options` OPTIONAL per question, so a SCHEMA-LEGAL but semantically broken call (a question item with
  // no `question`, a mis-keyed option list) reaches the TUI's question panel and renders as a card with
  // neither text nor options (measured 2026-10-10). The render path is host-owned end to end — no bundle
  // code participates and a same-name wrapper is impossible (the host registry refuses duplicate ids) — so
  // PRE-DISPATCH is the only point this bundle can act on. Deny-only and always on: a broken question card
  // is never a desired outcome, so there is no knob to turn it off.
  try {
    /** The guard's install outcome, reported on the team-plane boot signature below. */
    const askUserGuard = installAskUserQuestionGuard(dsh, {
      warn: (line) => warnOnce("ask-user-guard:" + line, line),
    })
    guardOutcome.push(askUserGuard.installed
      ? "askUserQuestion=installed"
      : "askUserQuestion=absent reason=" + String(askUserGuard.reason))
  } catch (error) {
    guardOutcome.push("askUserQuestion=absent reason=threw")
    warnOnce("ask-user-guard:threw", "the ask_user_question boundary guard could not be installed (" + errText(error) + ")")
  }
  try {
    installRosterSection(dsh, {
      members: teamMembers(),
      presets: ["mpd"],
      warn: (line) => warnOnce("team-section:" + line, line),
      log: (line) => rowLogLine("mpd-roles", "[mpd-roles] " + line),
    })
    guardOutcome.push("rosterSection=agent-scoped order=605")
  } catch (error) {
    guardOutcome.push("rosterSection=absent")
    warnOnce("team-section:threw", "the roster prompt section could not be registered (" + errText(error) + ")")
  }
  try {
    /** The gate's install outcome, whose MODE and SENSITIVITY the team-plane boot signature reports below. */
    const gate = installSessionGate(dsh, {
      presets: ["mpd"],
      warn: (line) => warn(line),
      log: (line) => rowLogLine("mpd-roles", "[mpd-roles] " + line),
      configValue,
      // The idempotence probe, read through the mpd record service PER CALL so the `mpd-team-core`
      // row may compose after this one. Its contract is THREE-VALUED and `stagedPlanProbe` keeps it
      // that way: `null` is the POSITIVE "nothing staged" answer, while an UNREADABLE probe THROWS —
      // the case the gate reports in ONE warning, because staging can ARCHIVE an existing
      // un-approved plan for this session.
      stagedPlan: stagedPlanProbe(ctx),
    })
    // The suffix is APPENDED so every existing `sessionGate=<mode>` substring assertion still holds.
    guardOutcome.push("sessionGate=" + gate.mode + " sensitivity=" + gate.sensitivity)
  } catch (error) {
    guardOutcome.push("sessionGate=absent")
    warnOnce("team-gate:threw", "the session-start complexity gate could not be installed (" + errText(error) + ")")
  }
  try {
    rowLogLine("mpd-roles", "[mpd-roles] team plane: " + guardOutcome.join(" "))
  } catch { /* logging must never take the roster down */ }

  // The apply-time identity line: on the healthy path this is the row's ONLY new
  // output, and it carries the same `adapterIdentity=` field the `mpdRoles` service
  // exposes, so a mount lane can assert WHICH adapter branch this row really took.
  try {
    rowLogLine("mpd-roles", "[mpd-roles] mpdRoles provided (base roles: " + ROLES.length + ") | adapterIdentity=" + dshAdapterIdentity(ctx))
  } catch { /* logging must never take the roster down */ }
}