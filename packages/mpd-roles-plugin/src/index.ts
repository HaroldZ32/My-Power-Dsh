// mpd-roles-plugin: the specialists live as a SPECIALIST ROSTER, not as
// presets. Each role = { stable id (chain key), normal display name, persona
// text, DeepSeek model chain, read-only discipline }. Consumers: mpd_role_spawn
// (one-shot specialist from anywhere), mpd_role_persona (text for spawn surfaces —
// the official Agent Teams `spawn_teammate` takes it as the teammate's prompt), and
// the mpdRoles service (mpd-modelchain chain lookup). Team mode is the OFFICIAL Agent
// Teams plugin (`spawn_teammate` + `team_task_create`), which THIS row feeds: it
// registers the read-only tool guard, the agent-scoped roster section and the advisory
// session-start gate.
// ADDRESSING CONTRACT: a role is addressed by its normal display NAME — the member
// name in team mode, the label of a one-shot mpd_role_spawn, and what every
// description/render lists. The stable `id` is an INTERNAL key (modelchain chain key,
// `personas/<id>.md`, workmate meta.baseId) that legacy callers may still pass; it is
// accepted for compatibility and never advertised: a role is described by what it does.
// Keep the two vocabularies one word apart, never two spellings of the same thing.
// Persona texts are assets under personas/<id>.md resolved relative to this
// plugin's package location.
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { ROLES, ROLE_BY_ID, type MpdRoleSpec } from "./roles.data.ts"
import { installReadonlyGuard } from "./team-guard.ts"
import { installRosterSection } from "./roster-section.ts"
import { installSessionGate } from "./session-gate.ts"
import { bundleRootOf, createLazyDshAdapter, dshAdapterIdentity, textBlock, type DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-roles"
/** The seams this row needs declared: the tool registry and the subagent spawner, both read through the adapter. */
export const inject = ["tools", "subagents"]

/** The slice of a cordis context this row uses: the two seams, the `mpdRoles` provision and a logger. */
type Ctx = { tools: any; subagents: any; provide: (n: string, v: any, check?: any) => void; get?: (k: string) => any; [k: string]: any }
/** The row config; only the persona directory is configurable. */
type Config = { personasDir?: string }

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
  "mcp__lsp__rename",
]

/** Output schema of a one-shot specialist's structured report, so the tool result is validated. */
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
      else console.log(message)
    } catch { /* logging must never take the roster down */ }
  }
  // The adapter-identity warning must be visible in a HEADLESS boot as well:
  // `ctx.logger.warn` has no sink there (the same measured reason mpd-ext writes
  // every line to stdout), so this one line always reaches stdout AND the logger.
  const adapterWarn = (line: string): void => {
    /** The line with this row's prefix, for the stdout-first reporter. */
    const message = "[mpd-roles] " + line
    try {
      console.log(message)
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

  /** The roster as THIS call sees it. Resolved per call (never an apply-time cache). */
  const roleSurface = (exec?: unknown): RoleSurface => {
    /** The base roster projected for THIS call, each persona already read. */
    const base: ResolvedRole[] = ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      readonly: r.readonly,
      chain: r.chain.map((c) => ({ ...c })),
      persona: readPersona(config, r),
      personaFile: personaPath(config, r),
      extension: null,
    }))
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
   *  extension role by its namespaced id or its declared name in any case/separator spelling. */
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
    description: "List the specialist roster — the SAME normal-named specialists team mode stages as teammates, each named for what it does: " + rosterFunctionList() + ". Address a role by that name (any case, space or hyphen spelling). Use this before mpd_role_spawn; for team work stage the roster with spawn_teammate + team_task_create (persona text from mpd_role_persona) instead of repeated one-shot spawns.",
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
    description: "Spawn one specialist as a one-shot subagent, carrying its persona, model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each named for what it does: " + rosterFunctionList() + ". The subagent is labelled with that name. For multi-member team work prefer the official Agent Teams tools (spawn_teammate + team_task_create) instead of repeated one-shot spawns: a teammate inherits the caller's model route, while THIS path applies the role's teamModels slot route.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list), e.g. \"Architect\" or \"Deep Worker\"" }, task: { type: "string" }, context: { type: "string", description: "optional context block to include" }, model: { type: "string", description: "optional model override (default: the role's primary route)" } }, required: ["role", "task"], additionalProperties: false },
    output: { schema: { type: "object", properties: { role: { type: "string" }, status: { type: "string", enum: ["complete"] }, summary: { type: "string" }, recommendation: { type: "string" }, details: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, stopReason: { type: "string" } }, required: ["role", "status", "summary"] }, render: (_a: unknown, v: any) => textBlock("role " + v.role + " (" + v.status + ")\nsummary: " + v.summary + (v.recommendation ? "\nrecommendation: " + v.recommendation : "") + (v.details ? "\ndetails: " + v.details : "") + (v.evidence?.length ? "\nevidence:\n- " + v.evidence.join("\n- ") : "")) },
    execute: async (args: any, exec: any) => {
      /** The roster as this call sees it: base specialists plus extension roles. */
      const surface = roleSurface(exec)
      /** The resolved role, or null — in which case the error lists every addressable name. */
      const spec = roleOf(surface, String(args?.role ?? ""))
      if (spec === null) throw new Error("mpd_role_spawn: unknown role '" + String(args?.role) + "' — use a roster name: " + roleNameListOf(surface))
      /** The task text; empty is a caller error and must not spawn an empty prompt. */
      const task = String(args?.task ?? "").trim()
      if (!task) throw new Error("mpd_role_spawn: task required")
      /** The role's persona text, sent both inside the prompt and as the subagent's persona. */
      const persona = spec.persona
      /** The primary route's provider, falling back to the deployment default. */
      const provider = spec.chain[0]?.provider ?? "deepseek-official"
      /** The model for this spawn: the caller's override when given, else the role's primary. */
      const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : spec.chain[0]?.model
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
        ...(spec.readonly ? { toolFilter: { deny: READONLY_DENY } } : {})
      })
      /** The structured report, or an empty object when the subagent answered none. */
      const st = result.structured ?? {}
      return { role: spec.name, status: "complete", summary: String(st.summary ?? ""), recommendation: String(st.recommendation ?? ""), details: String(st.details ?? ""), evidence: Array.isArray(st.evidence) ? st.evidence.map(String) : [], stopReason: result.stopReason ?? null }
    }
  })

  dsh.registerTool({
    name: "mpd_role_persona",
    description: "Return the full persona text of one roster role, addressed by its name (\"Architect\", \"Deep Worker\", \"Plan Reviewer\"). Use it when a spawn surface takes the persona as TEXT — e.g. the prompt of a spawn_teammate teammate whose name is that same name — so the member gets the real role instructions instead of a bare label.",
    parameters: { type: "object", properties: { role: { type: "string", description: "role name (see mpd_roles_list)" } }, required: ["role"] },
    output: { schema: { type: "object", properties: { role: { type: "string" }, persona: { type: "string" }, chars: { type: "integer" } }, required: ["role", "persona", "chars"] }, render: (_a: unknown, v: any) => textBlock("persona " + v.role + " (" + v.chars + " chars):\n" + v.persona) },
    execute: async (args: any, exec: any) => {
      /** The roster as this call sees it: base specialists plus extension roles. */
      const surface = roleSurface(exec)
      /** The resolved role, or null — in which case the error lists every addressable name. */
      const spec = roleOf(surface, String(args?.role ?? ""))
      if (spec === null) throw new Error("mpd_role_persona: unknown role '" + String(args?.role) + "' — use a roster name: " + roleNameListOf(surface))
      return { role: spec.name, persona: spec.persona, chars: spec.persona.length }
    }
  })

  // ── the roster's TEAM plane (AGENTS.md §13 + §1) ────────────────────────────
  // Retiring the vendored agent-teams body removed the ONLY implementation of two BINDING
  // contracts: the roster's mechanical read-only discipline (the shipped profile carried
  // each read-only member's toolDeny) and the session-start complexity gate. Both are
  // restored HERE, on the OFFICIAL plugin's seams, reached only through the adapter:
  //   1. a tool guard over the SAME seven names the one-shot path denies;
  //   2. an AGENT-SCOPED roster section, so an mpd Lead knows the members it can stage;
  //   3. the advisory session-start gate (it NEVER stages a team).
  // Each installer degrades with a warning instead of taking the row down.
  const teamMembers = (): Array<{ name: string; description: string; readonly: boolean }> => ROLES.map((role) => ({ name: role.name, description: role.description, readonly: role.readonly }))
  // The TEAM PLANE's boot signature: ONE line naming the three restored contracts and their
  // outcome, so an integration boot asserts the guard reached the tool registry (a
  // `[mpd-roles] team plane: readOnlyGuard=installed deny=7 …` line) instead of trusting the
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
  try {
    installRosterSection(dsh, {
      members: teamMembers(),
      presets: ["mpd"],
      warn: (line) => warnOnce("team-section:" + line, line),
      log: (line) => console.log("[mpd-roles] " + line),
    })
    guardOutcome.push("rosterSection=agent-scoped order=605")
  } catch (error) {
    guardOutcome.push("rosterSection=absent")
    warnOnce("team-section:threw", "the roster prompt section could not be registered (" + errText(error) + ")")
  }
  try {
    installSessionGate(dsh, {
      presets: ["mpd"],
      warn: (line) => warn(line),
      log: (line) => console.log("[mpd-roles] " + line),
    })
    guardOutcome.push("sessionGate=advisory")
  } catch (error) {
    guardOutcome.push("sessionGate=absent")
    warnOnce("team-gate:threw", "the session-start complexity gate could not be installed (" + errText(error) + ")")
  }
  try {
    console.log("[mpd-roles] team plane: " + guardOutcome.join(" "))
  } catch { /* logging must never take the roster down */ }

  // The apply-time identity line: on the healthy path this is the row's ONLY new
  // output, and it carries the same `adapterIdentity=` field the `mpdRoles` service
  // exposes, so a mount lane can assert WHICH adapter branch this row really took.
  try {
    console.log("[mpd-roles] mpdRoles provided (base roles: " + ROLES.length + ") | adapterIdentity=" + dshAdapterIdentity(ctx))
  } catch { /* logging must never take the roster down */ }
}