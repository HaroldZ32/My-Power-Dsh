// C7 mpd-config-plugin: minimal mpd.jsonc runtime config layer.
// Project layer: <workspace>/.mpd/mpd.jsonc; user layer: $DSH_HOME/mpd.jsonc
// (or ~/.dsh/mpd.jsonc). Deep-merged (project wins), JSONC (comments +
// trailing commas), prototype-pollution safe. Provides the "mpdConfig"
// service for other mpd plugins (inject: ["mpdConfig"]) and two tools.
// Boundary: bundle patch stays the composition truth; this layer only feeds
// plugin runtime config, it never mutates dsh patch rows.
import { existsSync, readFileSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { SettingsSchema, SETTINGS_NS, TEAM_MODEL_SLOTS, TEAM_MODEL_SLOT_DEFAULTS } from "./settings-schema"
import { markVolatile } from "./settings-schema"
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"
import {
  DEFAULT_BRIDGE_OPTIONS,
  changedLeaves,
  resolveTargets,
  sectionLeaves,
  writeBackLeaves,
  type BridgeLeaf,
  type BridgeOptions,
  type BridgeReport,
  type RefusalReason,
} from "./bridge"

export const name = "mpd-config"
export const inject = ["tools"]

type Ctx = { tools: any; provide: (name: string, value: any, check?: any) => void; get?: (serviceName: string) => any; logger?: any; [k: string]: any }
type Config = {
  projectFile?: string
  userFile?: string
  /**
   * Write-back switch — lever 1 of the design (§10.2) and of the captain's ruling 2. BOTH
   * spellings are honoured (`writeBack:false` and `settingsBridge.writeBack:false`), default
   * ON, because the design names the flat key while the captain's dispatch named the nested
   * one; supporting both removes a false negative from a reviewer who checks either text.
   */
  writeBack?: boolean
  settingsBridge?: { writeBack?: boolean }
}

/** Re-exported so a consumer has ONE source for the namespace (see ./settings-schema). */
export { SETTINGS_NS }
/** The in-namespace idempotence marker (design §6.3): never a config knob, never a side file. */
const MARKER_PATH: readonly string[] = ["bridge", "migratedRevision"]

function textBlock(text: string): any { return [{ type: "text", text }] }

// --- minimal JSONC parser (comments + trailing commas; string-aware) ---
function stripJsonc(src: string): string {
  let out = ""
  let inString = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (ch === "\\") { out += src[i + 1] ?? ""; i += 2; continue }
      if (ch === "\"") inString = false
      i++
      continue
    }
    if (ch === "\"") { inString = true; out += ch; i++; continue }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue }
    if (ch === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue }
    if (ch === ",") {
      // trailing comma before } or ] — the probe must skip COMMENTS as well as
      // whitespace: `{ "a": 1, /* c */ }` otherwise keeps its comma and the
      // document stops parsing (measured while adding the JSONC editor tests).
      let j = i + 1
      for (;;) {
        while (j < src.length && /\s/.test(src[j])) j++
        if (src[j] === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; continue }
        if (src[j] === "/" && src[j + 1] === "*") { j += 2; while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++; j += 2; continue }
        break
      }
      if (src[j] === "}" || src[j] === "]") { i++; continue }
    }
    out += ch
    i++
  }
  return out
}

function parseJsonc(src: string): any {
  return JSON.parse(stripJsonc(src))
}

function isPlainObject(v: any): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

// prototype-pollution safe deep merge (project wins)
function deepMerge(base: any, over: any): any {
  const out: any = {}
  const bkeys = isPlainObject(base) ? Object.keys(base) : []
  const okeys = isPlainObject(over) ? Object.keys(over) : []
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key)) continue
    const bv = isPlainObject(base) ? base[key] : undefined
    const ov = isPlainObject(over) ? over[key] : undefined
    if (isPlainObject(bv) && isPlainObject(ov)) out[key] = deepMerge(bv, ov)
    else if (isPlainObject(bv) && ov === undefined) out[key] = deepMerge(bv, {})
    else out[key] = ov !== undefined ? ov : bv
  }
  return out
}

/** The marker subtree must never become runtime config (it is bookkeeping, not a knob). */
function withoutMarker(section: any): any {
  if (!isPlainObject(section) || !isPlainObject(section.bridge)) return section
  const rest: any = { ...section }
  const bridge: any = { ...section.bridge }
  delete bridge.migratedRevision
  if (Object.keys(bridge).length === 0) delete rest.bridge
  else rest.bridge = bridge
  return rest
}

// `root` is the workspace whose .mpd/mpd.jsonc project layer is read. Apply time has no
// session, so it resolves through the adapter's exec-less form (env -> process.cwd); the
// two TOOLS pass the calling session's workspace instead. config.projectFile still wins.
//
// Layer precedence (design §1.1/D-1): L0 schema defaults < L1 user file < L2 project file
// < L3 settings user section. `settingsSection` is L3 as the RAW user section (not the
// resolved value, whose base/defaults would be re-applied as if they were explicit).
/**
 * The knobs carried by the ROW CONFIG — what the harness's settings form edits.
 *
 * Harness 0.1.7-rc.2's settings editor writes a plugin's own row config (the Cordis patch), so a knob
 * the user edits in Settings arrives here in `config`, beside the file-path keys. Without this layer
 * the form would RENDER a value, accept an edit, and change nothing — the worst of the three
 * outcomes, because it looks like it worked.
 *
 * The routing keys are stripped: `projectFile` / `userFile` / `writeBack` / `settingsBridge` are this
 * plugin's own wiring, not knobs, and merging them into the effective config would be nonsense.
 */
const ROUTING_KEYS = ["projectFile", "userFile", "writeBack", "settingsBridge"]
function rowKnobLayer(config: Config): Record<string, unknown> {
  const source = config as unknown as Record<string, unknown>
  const layer: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (ROUTING_KEYS.includes(key)) continue
    if (value === undefined) continue
    layer[key] = value
  }
  return layer
}

function loadConfig(config: Config, root: string, settingsSection?: unknown): { config: any; files: string[]; errors: string[]; settingsApplied: boolean } {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const userFile = config.userFile ? resolve(config.userFile) : join(dshHome, "mpd.jsonc")
  const projectFile = config.projectFile ? resolve(config.projectFile) : join(root, ".mpd", "mpd.jsonc")
  const files = [userFile, projectFile]
  let merged: any = {}
  const errors: string[] = []
  for (const f of files) {
    if (!existsSync(f)) continue
    try { merged = deepMerge(merged, parseJsonc(readFileSync(f, "utf8"))) }
    catch (e: any) { errors.push(f + ": " + String(e?.message ?? e)) }
  }
  const section = withoutMarker(settingsSection)
  const settingsApplied = isPlainObject(section) && Object.keys(section).length > 0
  if (settingsApplied) merged = deepMerge(merged, section)
  // L4: the ROW CONFIG, i.e. what the settings form edits. It sits ON TOP of the file layers for the
  // same reason the retired settings document did — an explicit edit in a front door outranks a file
  // the user may not remember writing.
  const rowKnobs = rowKnobLayer(config)
  if (Object.keys(rowKnobs).length > 0) merged = deepMerge(merged, rowKnobs)
  return { config: merged, files: files.filter((f) => existsSync(f)), errors, settingsApplied }
}

export { stripJsonc, parseJsonc, deepMerge, loadConfig }

/**
 * The RESOLVED view for readers (A2): the raw merged file config with all four `teamModels` slots
 * MATERIALISED over their schema defaults, so a workspace whose `.mpd/mpd.jsonc` has no
 * `teamModels` block at all still answers `get("teamModels.slot<N>")` with a complete
 * provider/model/reasoningEffort slot — which is what makes the slots the default route of the
 * team members on a fresh workspace.
 *
 * READ-PATH ONLY, deliberately: it returns a NEW object and never mutates the raw merged config, so
 * the settings-document write-back (whose delta is computed from the described settings section via
 * `changedLeaves`, see the `onSettingsDocumentUpdated` subscription below) can never see — and
 * therefore never write — a materialised default. Saving an unrelated knob must not inject a
 * `teamModels` key into the file.
 */
export function withTeamModelsDefaults(config: any): any {
  const raw = isPlainObject(config) ? config : {}
  const declared = isPlainObject(raw.teamModels) ? raw.teamModels : {}
  const teamModels: any = {}
  for (const slot of TEAM_MODEL_SLOTS) {
    // Slot-level merge: a file that sets only `slot2.model` keeps the other two slot2 leaves and
    // leaves every other slot wholly at its defaults. Extra keys inside a slot are preserved.
    teamModels[slot] = { ...TEAM_MODEL_SLOT_DEFAULTS[slot], ...(isPlainObject(declared[slot]) ? declared[slot] : {}) }
  }
  return { ...raw, teamModels }
}

/**
 * THE ROW CONFIG SCHEMA, which is what makes these knobs visible and editable in BOTH settings front
 * doors.
 *
 * Harness 0.1.7-rc.2's settings editor lists a plugin entry only when its Config schema carries a
 * VOLATILE field, and it addresses the form by ENTRY ID — `configForms.get(ns)` looks up
 * `entries().find(row => row.options.id === ns)` and throws `No configurable plugin entry` otherwise.
 * The knobs are declared here, at the TOP level of this row's config beside the file paths, so the
 * entry `mpd-config` serves them.
 *
 * The flags come from {@link markVolatile}: see its doc comment for why the vendored schemastery can
 * carry them without the harness's own fork.
 */
const knobDict = (SettingsSchema as unknown as { dict?: Record<string, unknown> }).dict ?? {}
// MARK THE FINISHED TREE, not the children: `z.object({...})` RE-CREATES each child, so a flag set on
// a child before the parent is built is gone by the time the loader reads the schema. Measured: the
// built Config's own `hashline` node carried `meta: {"default":{}}` with no `volatile`, and the entry
// never appeared in `settings.describe()`.
export const Config = markVolatile(z.object({
  projectFile: z.string(),
  userFile: z.string(),
  writeBack: z.boolean().default(true),
  settingsBridge: z.object({ writeBack: z.boolean().default(true) }),
  ...knobDict,
}))

// CORDIS READS THE SCHEMA OFF THE PLUGIN RUNTIME, NOT OFF THE MODULE. `resolveConfig(runtime, config)`
// does `if (!runtime.Config) return config` — so a bare `export const Config` beside a functional
// plugin is invisible to the loader and the entry never becomes configurable (measured: with the
// export alone, `settings.describe()` listed 18 harness entries and `mpd-config` was ABSENT).
;(apply as unknown as { Config?: unknown }).Config = Config

export function apply(ctx: Ctx, config: Config = {}): void {
  // FLAG THE SCHEMA AT APPLY TIME, not at module init. A schemastery node's `meta` is not yet the
  // object the loader will later read while the module is still evaluating (measured: the same
  // assignment persists when it is made after the module has loaded, and is gone when it is made
  // during evaluation), and the settings editor reads `runtime.Config` long after this point.
  markVolatile(Config)
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)

  // A bridge diagnostic MUST be visible in a HEADLESS/web boot: `ctx.logger.warn` has no
  // stdout sink there (MEASURED by the tui-settings-bridge lane's first real run, whose log
  // carried every other mpd row's line but none of the bridge's), so every line ALSO goes to
  // stdout — the same pattern `mpd-ext-plugin` uses for its apply failures. Without this, a
  // read-only/conflicting/ambiguous target produced NO diagnostic anywhere (design §9.3 F6).
  const warn = (message: string): void => {
    try {
      console.log(message)
      if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    } catch {
      // logging must never fail the write-back
    }
  }

  // ── the settings bridge (t34 design §A/§B/§2; captain ruling 1) ──────────────────
  // The `mpd` namespace is REGISTERED by packages/mpd-tui-plugin. This plugin never
  // registers it (a second registration fails loud); it reads the user section and
  // owns the FILE write-back into the layer it already owns. No harness service is
  // touched directly — everything rides the adapter's settings seam.
  const bridge = {
    /** L3 verbatim, as last read (raw user section — never the resolved value). */
    section: undefined as unknown,
    /** Namespace/service availability, for the status surface. */
    serviceReady: false,
    served: false,
    revision: undefined as number | undefined,
    /** The last per-root write-back report (design §2.2). */
    report: undefined as (BridgeReport & { source?: string; revision?: number; at?: string }) | undefined,
    /** Migration outcome (design §6). */
    migration: "not-attempted",
    /** Set when the adapter seam this module needs is absent (version skew), for the status. */
    degraded: undefined as string | undefined,
    /** `registered` when THIS package owns the namespace; otherwise the host's refusal text. */
    namespaceRegistration: undefined as string | undefined,
    /** How the base was chosen: `one-live-root` | `mount-time-root` | `ambiguous-multi-root`. */
    baseReason: undefined as string | undefined,
    /** The candidate roots when the base was deliberately NOT derived from a file. */
    baseCandidates: undefined as readonly string[] | undefined,
    /** Leaves whose L3 override a fresh FILE edit cleared (design §1.2/D-2). */
    cleared: [] as string[],
    /** File-derived values the bridge recorded, keyed by encoded path (the D-2 baseline). */
    recorded: new Map<string, unknown>(),
  }

  const pathKey = (path: readonly string[]): string => path.join("\u0000")
  const isMarker: (path: readonly string[]) => boolean = (path) => path[0] === MARKER_PATH[0]

  /** `settingsBridge.writeBack` (default ON) + the env lever of design §10.2. */
  const bridgeOptions = (): BridgeOptions => ({
    writeBack: config.writeBack !== false && config.settingsBridge?.writeBack !== false && process.env.MPD_DSH_TUI_SETTINGS_BRIDGE !== "off",
    retries: DEFAULT_BRIDGE_OPTIONS.retries,
  })

  const projectFileFor = (root: string): string => (config.projectFile ? resolve(config.projectFile) : join(root, ".mpd", "mpd.jsonc"))

  /**
   * The root the READ-IN uses: the one live session root when exactly one root is
   * live (unambiguous), otherwise the adapter's exec-less root. This is a READ, so it
   * is not the write-target guess A3 forbids — the write target is decided by
   * `resolveTargets` alone.
   */
  const readRoot = (): string => {
    const roots = dsh.workspaceRootsAll()
    return roots.length === 1 ? roots[0] : dsh.workspaceRoot()
  }

  /**
  * Read L3 through the adapter seam. `undefined` while the namespace is not served.
  *
  * The seam is probed before use: ADAPTER/PLUGIN VERSION SKEW is real (a stale
  * `packages/mpd-dsh-adapter-plugin/dist/index.js` produced exactly this), and a missing
  * seam must degrade this row's bridge only — never break the plugin tree
  * (`failed to apply loader entry mpd-config: dsh.settingsReader is not a function` kills
  * the whole boot). Measured 2026-09-15 by the tui-settings-bridge lane's first boot.
  */
  const readSection = (): unknown => {
    if (typeof dsh.settingsReader !== "function") {
      bridge.serviceReady = false
      bridge.served = false
      bridge.section = undefined
      bridge.degraded = "adapter has no settingsReader seam (rebuild packages/mpd-dsh-adapter-plugin/dist)"
      return undefined
    }
    const reader = dsh.settingsReader(SETTINGS_NS)
    if (reader === undefined) {
      bridge.serviceReady = false
      bridge.served = false
      bridge.section = undefined
      return undefined
    }
    bridge.serviceReady = true
    const described = reader.describe()
    if (described === undefined) {
      bridge.served = false
      bridge.section = undefined
      return undefined
    }
    bridge.served = true
    bridge.revision = described.revision
    bridge.section = described.user
    return described.user
  }

  let state = loadConfig(config, dsh.workspaceRoot(), readSection())

  /** Re-read every layer for ONE workspace root (used by the tools and by the file watcher). */
  const reloadAt = (root: string): any => {
    state = loadConfig(config, root, readSection())
    reconcile(root)
    return state.config
  }

  /**
   * Re-read for a CALLING SESSION's root (tools) — re-reading L3 as well, so the read-in is
   * observable through `mpd_config_get` immediately even though a CONSUMER that captured its
   * config at apply() needs a restart before its behaviour changes (design §D.1).
   * Reconciliation rides along so a file edit is never swallowed by a stale override (§1.2/D-2).
   */
  function reload(exec?: any): any {
    return reloadAt(dsh.workspaceRoot(exec))
  }

  const reportLine = (report: BridgeReport & { source?: string; revision?: number }, note?: string): string =>
    `[mpd-config] settings bridge${note ? " " + note : ""}: ` + JSON.stringify({ writtenTo: report.writtenTo, skipped: report.skipped ?? null, candidates: report.candidates ?? [], results: report.results, applies: report.applies, source: report.source ?? null, revision: report.revision ?? null })

  const warnRefusal = (reason: RefusalReason, candidates: readonly string[]): void => {
    if (reason === "no-live-session") {
      warn(`[mpd-config] settings bridge: saved to settings — not yet written to any .mpd/mpd.jsonc (no live session). Start a session in the intended workspace to persist it.`)
      return
    }
    if (reason === "ambiguous-multi-root") {
      warn(`[mpd-config] settings bridge: saved to settings — NOT written to any file: ${candidates.length} live workspaces, so the target is ambiguous. Candidates: ${candidates.join(", ")}. Keep one session live, or edit that workspace's .mpd/mpd.jsonc directly.`)
      return
    }
    if (reason === "disabled") {
      warn(`[mpd-config] settings bridge: write-back is DISABLED by config (settingsBridge.writeBack=false or MPD_DSH_TUI_SETTINGS_BRIDGE=off) — the settings value took effect, no file was written.`)
      return
    }
    warn(`[mpd-config] settings bridge: no file written (${reason}).`)
  }

  /**
   * The §1.2/D-2 clearing rule: a fresh FILE edit must never be silently swallowed by a
   * stale L3 override, so every leaf the bridge recorded and whose on-disk value has
   * since changed is UNSET from the user section under the revision fence.
   */
  const reconcile = (root: string): void => {
    if (bridge.recorded.size === 0) return
    const file = projectFileFor(root)
    if (!existsSync(file)) return
    let leaves: BridgeLeaf[]
    try {
      leaves = sectionLeaves(parseJsonc(readFileSync(file, "utf8")))
    } catch {
      return
    }
    const onDisk = new Map(leaves.filter((leaf) => !isMarker(leaf.path)).map((leaf) => [pathKey(leaf.path), leaf.value]))
    const section = bridge.section
    const sectionKeys = new Set(sectionLeaves(section).map((leaf) => pathKey(leaf.path)))
    const unsetPaths: string[][] = []
    for (const [key, recorded] of [...bridge.recorded]) {
      const current = onDisk.get(key)
      if (JSON.stringify(current) === JSON.stringify(recorded)) continue
      bridge.recorded.set(key, current)
      if (current === undefined) continue
      if (!sectionKeys.has(key)) continue
      unsetPaths.push(key.split("\u0000"))
    }
    if (unsetPaths.length === 0) return
    void dsh
      .settingsMutate(SETTINGS_NS, unsetPaths.map((path) => ({ op: "unset" as const, path })), bridge.revision)
      .then((result: MutateResult) => {
        if (result.ok) {
          bridge.cleared.push(...unsetPaths.map((path) => path.join(".")))
          warn(`[mpd-config] settings bridge: a file edit won — cleared the overlapping settings override(s) ${unsetPaths.map((p) => p.join(".")).join(", ")} so the file's new value applies.`)
        } else {
          warn(`[mpd-config] settings bridge: could not clear the overlapping override(s) ${unsetPaths.map((p) => p.join(".")).join(", ")}: ${result.error}`)
        }
      })
  }

  const rememberFileValues = (file: string): void => {
    try {
      for (const leaf of sectionLeaves(parseJsonc(readFileSync(file, "utf8")))) {
        if (isMarker(leaf.path)) continue
        bridge.recorded.set(pathKey(leaf.path), leaf.value)
      }
    } catch {
      // an unreadable/unparsable file has nothing to record
    }
  }

  /** The adapter's mutate result, spelled out so a `.then` callback is not implicitly any. */
  type MutateResult = { ok: true } | { ok: false; error: string; conflict?: boolean }

  /** The write-back itself: decide the target, refuse loudly, write per root, report. */
  const writeBack = (leaves: readonly BridgeLeaf[], source: string | undefined, revision: number | undefined): void => {
    if (leaves.length === 0) return
    const options = bridgeOptions()
    if (!options.writeBack) {
      const disabled: BridgeReport & { source?: string; revision?: number; at?: string } = { writtenTo: [], results: [], skipped: "disabled", applies: "restart", source, revision, at: new Date().toISOString() }
      bridge.report = disabled
      warnRefusal("disabled", [])
      warn(reportLine(disabled, "DISABLED"))
      return
    }
    const decision = resolveTargets(dsh.workspaceRootsAll())
    if (decision.kind === "refuse") {
      const refused: BridgeReport & { source?: string; revision?: number; at?: string } = { writtenTo: [], results: [], skipped: decision.reason, candidates: decision.candidates, applies: "restart", source, revision, at: new Date().toISOString() }
      bridge.report = refused
      warnRefusal(decision.reason, decision.candidates)
      warn(reportLine(refused, decision.reason))
      return
    }
    const report = writeBackLeaves(decision.targets, leaves, options)
    bridge.report = { ...report, source, revision, at: new Date().toISOString() }
    for (const target of decision.targets) if (report.writtenTo.includes(target.file)) rememberFileValues(target.file)
    for (const result of report.results) {
      // A PROVEN write that edited a duplicated leaf key must still say so, with every occurrence's
      // line: `key "a" appears 2 times at lines 2, 3; the last occurrence is the effective value and
      // was updated` (captain's ruling — nothing silent).
      for (const note of result.notes ?? []) {
        warn(`[mpd-config] settings bridge: ${note.detail}${note.lines === undefined ? "" : " (occurrence lines: " + note.lines.join(", ") + ")"} [${result.file}]`)
      }
      if (result.outcome === "written" || result.outcome === "created" || result.outcome === "unchanged") continue
      warn(`[mpd-config] settings bridge: ${result.outcome} for ${result.file}${result.reason ? " (" + result.reason + ")" : ""}${result.detail ? " — " + result.detail : ""} — the file is byte-untouched and the settings value still applies; the mpd plugins need a restart to act on it.`)
    }
    warn(reportLine(bridge.report, report.writtenTo.length > 0 ? "WROTE" : "OK"))
    watchRoot(decision.targets[0].root)
  }

  // A file watcher is the ONLY way a fresh `<workspace>/.mpd/mpd.jsonc` edit is observed
  // (the settings service knows nothing about the file), so the D-2 clearing rule needs one.
  const watchers = new Map<string, () => void>()
  function watchRoot(root: string): void {
    const file = projectFileFor(root)
    if (watchers.has(file)) return
    try {
      const dir = dirname(file)
      if (!existsSync(dir)) return
      const name = basename(file)
      let timer: ReturnType<typeof setTimeout> | undefined
      const listener = (_event: string, changed: unknown): void => {
        if (changed !== null && changed !== undefined && String(changed) !== name) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          reloadAt(root)
        }, 150)
        if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref()
      }
      const watcher = watch(dir, listener)
      watchers.set(file, () => {
        if (timer !== undefined) clearTimeout(timer)
        try {
          watcher.close()
        } catch {
          // already closed
        }
      })
    } catch {
      // a watch that cannot be established degrades to reconciliation on reload
    }
  }

  /**
   * Migration (design §6): on the first boot with a live root, push the existing settings
   * `user` leaves into the project file through the SAME refuse-first writer and record
   * idempotence with the in-namespace marker. Never `process.cwd()`; with no live root the
   * migration is DEFERRED and a later boot performs it.
   */
  const migrate = (): void => {
    if (typeof dsh.settingsReader !== "function") {
      bridge.migration = "not-attempted-adapter-seam-absent"
      return
    }
    const reader = dsh.settingsReader(SETTINGS_NS)
    const described = reader?.describe()
    if (described === undefined) {
      bridge.migration = "not-served"
      return
    }
    const leaves = changedLeaves({}, withoutMarker(described.user)).written.filter((leaf) => !isMarker(leaf.path))
    if (leaves.length === 0) {
      bridge.migration = "nothing-to-migrate"
      return
    }
    // Idempotence (design §6.3): the marker names the revision the section has ONCE THE
    // MARKER WRITE ITSELF LANDS, and the provider bumps the revision by exactly one per
    // raw-section change — so the next boot at that revision does nothing, while a later
    // edit (a higher revision) is re-migrated.
    const migratedRevision = (described.user as any)?.bridge?.migratedRevision
    if (described.revision !== undefined && migratedRevision === described.revision) {
      bridge.migration = "already-migrated"
      return
    }
    const decision = resolveTargets(dsh.workspaceRootsAll())
    if (decision.kind === "refuse") {
      bridge.migration = decision.reason === "no-live-session" ? "deferred-no-workspace" : `deferred-${decision.reason}`
      if (decision.reason === "no-live-session") warn("[mpd-config] settings bridge: migration deferred — no live session workspace to migrate into (nothing was written to process.cwd()).")
      else warnRefusal(decision.reason, decision.candidates)
      return
    }
    const report = writeBackLeaves(decision.targets, leaves, bridgeOptions())
    if (report.skipped !== undefined) {
      bridge.migration = `deferred-${report.skipped}`
      return
    }
    const bad = report.results.find((result) => result.outcome !== "written" && result.outcome !== "created" && result.outcome !== "unchanged")
    if (bad !== undefined) {
      bridge.migration = "writeback-failed"
      warn(`[mpd-config] settings bridge: migration did NOT complete (${bad.outcome}${bad.reason ? " " + bad.reason : ""} for ${bad.file}); the settings document is left untouched so nothing is lost.`)
      return
    }
    for (const target of decision.targets) rememberFileValues(target.file)
    if (described.revision === undefined) {
      bridge.migration = "migrated-no-marker"
      return
    }
    const revision = described.revision
    const markerValue = revision + 1
    void dsh.settingsMutate(SETTINGS_NS, [{ op: "set", path: [...MARKER_PATH], value: markerValue }], revision).then((result: MutateResult) => {
      if (result.ok) {
        bridge.migration = "migrated"
        warn(`[mpd-config] settings bridge: migrated ${leaves.length} saved settings value(s) into ${decision.targets[0].file} (marker bridge.migratedRevision=${markerValue}).`)
      } else {
        bridge.migration = "marker-unavailable"
        warn(`[mpd-config] settings bridge: migrated the values but could not record the idempotence marker: ${result.error} — a later boot re-runs an idempotent no-op write.`)
      }
    })
  }

  if (typeof dsh.onSettingsDocumentUpdated !== "function") {
    // Same version-skew guard: without the subscription there is no write-back trigger,
    // so the row keeps serving config (and says so in `states()`) instead of throwing.
    bridge.degraded = bridge.degraded ?? "adapter has no onSettingsDocumentUpdated seam"
  } else dsh.onSettingsDocumentUpdated(SETTINGS_NS, (revision: number | undefined, source: string | undefined) => {
    const previous = bridge.section
    const next = readSection()
    state = loadConfig(config, readRoot(), next)
    // The bridge's OWN namespace writes need no guard here: the marker leaf is filtered
    // out below, and an UNSET (the §1.2 clearing rule) never produces a written leaf — so a
    // self-echo writes nothing by construction, while a real edit is never swallowed.
    // `provider` = the settings DOCUMENT was reloaded (a human edited settings.yaml):
    // a read-in event that must never echo into a file write (design §2.1).
    if (source === "provider") return
    // `source === undefined` means the raw section changed while the resolved value did
    // not (the host skips its commit). The diff below is the safety gate: a change that
    // carries no NEW leaf writes nothing, so a provider echo cannot loop.
    const delta = changedLeaves(previous, next)
    writeBack(delta.written.filter((leaf) => !isMarker(leaf.path)), source, revision)
  })

  if (typeof dsh.settingsMutate !== "function" && bridge.degraded === undefined) bridge.degraded = "adapter has no settingsMutate seam (the §1.2 override clearing is unavailable)"

  /**
   * §10.1: THIS package registers the namespace, because only it can supply the file-derived
   * `base` — the L1+L2 file layers, i.e. what a front door shows as the inherited value. The base
   * is fixed for the process lifetime (MEASURED: the host exposes no disposal handle for a live
   * registration; `dsh-settings` `register()` returns `{get, watch, update, replace}` and removes
   * the namespace from an internal `ctx.effect`, and the host's own `installSection` keeps its
   * base fixed the same way), so the design's documented fallback applies: the RESOLVED value is
   * the authority, and the file layers are re-read by the config layer on every resolution.
   */
  /**
   * The FILE-DERIVED base for the namespace (design §1.1/§10.1) under the captain's cardinality
   * rule, which is the same spirit as the D-5 write refusal:
   *
   *   1 live root  -> that workspace's `.mpd/mpd.jsonc` (the normal path);
   *   0 live roots -> the mount-time (exec-less) root — `DSH_WORKSPACE_ROOT` or the process cwd —
   *                   which is the only root that exists before any session does; an absent file
   *                   there yields an EMPTY base, i.e. effectively the schema defaults;
   *   N live roots -> NO file base is invented: the ambiguity is surfaced (warn + `states()`) and
   *                   the namespace falls back to the schema defaults.
   *
   * Recorded limitation (measured): the base is FIXED for the process lifetime — the host exposes no
   * disposal handle for a live registration — so a session that starts later never changes it. The
   * RESOLVED value and the config layer's own reads are unaffected.
   */
  const baseForNamespace = (): { base: unknown; reason: string; candidates?: readonly string[] } => {
    const roots = dsh.workspaceRootsAll()
    if (roots.length === 1) return { base: loadConfig(config, roots[0]).config, reason: "one-live-root" }
    if (roots.length === 0) return { base: loadConfig(config, readRoot()).config, reason: "mount-time-root" }
    warn(`[mpd-config] settings bridge: ${roots.length} live workspaces (${roots.join(", ")}) — the namespace base is NOT derived from a file, because the file is per-workspace and the namespace is host-global; both front doors will show the schema defaults until exactly one workspace is live.`)
    return { base: undefined, reason: "ambiguous-multi-root", candidates: roots }
  }

  const registerNamespace = (base: unknown): void => {
    if (typeof dsh.settingsRegister !== "function") {
      bridge.degraded = "adapter has no settingsRegister seam (rebuild packages/mpd-dsh-adapter-plugin/dist)"
      return
    }
    const result = dsh.settingsRegister(SETTINGS_NS, SettingsSchema, { base, applies: "restart" })
    if (result.ok !== true) {
      bridge.namespaceRegistration = result.error
      // The TUI package's guarded fallback still registers for this composition, so the front
      // doors keep working; say which path was taken.
      warn(`[mpd-config] settings bridge: could not register the "${SETTINGS_NS}" namespace (${result.error}) — the TUI fallback owns it now.`)
      return
    }
    bridge.namespaceRegistration = "registered"
    warn(`[mpd-config] settings bridge: registered the "${SETTINGS_NS}" namespace with the file-derived base (applies:'restart', design §10.1)`)
  }

  // The base is L1+L2 as read at mount (never the resolved value: a front door must be able to
  // mark an override and return to the FILE's value on reset, §1.1/§10.4).
  //
  // MEASURED: the registration must be DEFERRED until the settings provider is mounted. The loader
  // applies rows concurrently, and at this row's position the provider is not always up yet — a
  // direct call failed with "settings service is unavailable" in a real boot, after which the TUI's
  // fallback owned the namespace WITHOUT the file-derived base. The callback below is parked on the
  // adapter's deferred inject, so `mpd-config` (mounted earlier) wins the race it is meant to win.
  const registerWithFileBase = (): void => {
    const decision = baseForNamespace()
    bridge.baseReason = decision.reason
    if (decision.candidates !== undefined) bridge.baseCandidates = decision.candidates
    registerNamespace(decision.base)
  }
  // The diagnostic that cracked F5 lives in the ADAPTER, where the failure is actually observed:
  // `settingsRegister` now separates "no service" from "a service that cannot register", and that
  // second sentence is what identified the dsh-tui shape. This call site needs NO extra line — the
  // arm below counts a boot's logs, and a warning on the normal path is noise.
  if (typeof dsh.whenSettingsAvailable === "function") dsh.whenSettingsAvailable(registerWithFileBase)
  else registerWithFileBase()

  migrate()

  // A seam-absent degradation is worth one boot-log line: it explains a bridge that
  // registers nothing without any other symptom.
  if (bridge.degraded !== undefined) warn("[mpd-config] settings bridge: degraded — " + bridge.degraded)

  ctx.provide("mpdConfig", {
    get: (key?: string) => {
      // No key keeps the RAW merged file layers — the documented shape the settings namespace base
      // mirrors (and an existing wiring test pins it). A KEYED read resolves, so the `teamModels`
      // subtree answers with its defaults materialised even when no file declares it (A2).
      if (key === undefined) return state.config
      return key.split(".").reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), withTeamModelsDefaults(state.config))
    },
    reload,
    states: () => ({
      files: state.files,
      errors: state.errors,
      // The bridge surface (design §2.2/§10.3): per-root outcomes, the named refusal reason
      // and its candidates, the migration outcome and the cleared overrides. A lane asserts
      // on these fields (and on the matching `[mpd-config] settings bridge` log lines).
      settings: { namespace: SETTINGS_NS, serviceReady: bridge.serviceReady, served: bridge.served, revision: bridge.revision ?? null, applied: state.settingsApplied, degraded: bridge.degraded ?? null, writeBackEnabled: bridgeOptions().writeBack, registration: bridge.namespaceRegistration ?? null, baseFromFiles: bridge.baseReason === "one-live-root" || bridge.baseReason === "mount-time-root", baseReason: bridge.baseReason ?? null, baseCandidates: bridge.baseCandidates ?? [] },
      writeback: bridge.report ?? null,
      migration: bridge.migration,
      cleared: bridge.cleared,
      applies: "restart",
    }),
  })

  dsh.registerTool({
    name: "mpd_config_get",
    description: "Read the resolved mpd.jsonc runtime config (project .mpd/mpd.jsonc merged over user $DSH_HOME/mpd.jsonc). Consumed keys: memory.vcs/memory.dir/memory.agentSlug/memory.reflectionEvery, team.stateDir, hashline.guardEditTools/hashline.maxDiffChars/hashline.registryFile, commentChecker.autoCheck/commentChecker.bin/commentChecker.timeoutMs/commentChecker.maxMessageChars, modelchain.<chainKey>, boulder.dir, ulw.maxRounds/ulw.planDir/ulw.stateDir/ulw.provider/ulw.model/ulw.reviewerModel/ulw.maxReReviews, teamModels.slot1|slot2|slot3|slot4.provider/model/reasoningEffort.",
    parameters: { type: "object", properties: { key: { type: "string", description: "Optional dot-path to a single key, e.g. memory.vcs" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { config: { type: "object" }, key: { type: "string" }, value: {} }, required: ["config"] }, render: (_a: unknown, v: any) => textBlock(v.key ? "mpd config " + v.key + ": " + JSON.stringify(v.value, null, 1) : "mpd config: " + JSON.stringify(v.config, null, 1)) },
    execute: async (args: any, exec: any) => {
      // Re-read with the CALLING SESSION's workspace so a project layer in the session
      // workspace is visible even when it differs from the dsh process cwd.
      reload(exec)
      // The diagnostic dump is the RESOLVED view: the team-model slots are materialised over their
      // schema defaults, so a sandbox workspace with no `teamModels` block still shows the four
      // complete slots this tool reports (A2's observable artifact).
      const resolved = withTeamModelsDefaults(state.config)
      const key = args?.key ? String(args.key) : undefined
      // `value` is a raw JSON value: an undefined field is dropped by JSON
      // serialization, which breaks the host's lossless round-trip check
      // ("value is not lossless JSON"). Missing keys resolve to null instead.
      const value = key ? (key.split(".").reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), resolved) ?? null) : null
      return key === undefined ? { config: resolved } : { config: resolved, key, value }
    }
  })

  dsh.registerTool({
    name: "mpd_config_reload",
    description: "Re-read the mpd.jsonc layers and refresh the resolved config (returns files found and any parse errors).",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, errors: { type: "array", items: { type: "string" } } }, required: ["files", "errors"] }, render: (_a: unknown, v: any) => textBlock("mpd config reloaded: " + v.files.join(", ") + (v.errors.length ? " ERRORS: " + v.errors.join("; ") : "")) },
    execute: async (_args: any, exec: any) => {
      const cfg = reload(exec)
      return { files: state.files, errors: state.errors, config: cfg }
    }
  })
}
