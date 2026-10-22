// C7 mpd-config-plugin: minimal mpd.jsonc runtime config layer.
// Project layer: <workspace>/.mpd/mpd.jsonc; user layer: $DSH_HOME/mpd.jsonc
// (or ~/.dsh/mpd.jsonc). Deep-merged (project wins), JSONC (comments +
// trailing commas), prototype-pollution safe. Provides the "mpdConfig"
// service for other mpd plugins (inject: ["mpdConfig"]) and two tools.
// Boundary: bundle patch stays the composition truth; this layer only feeds
// plugin runtime config, it never mutates dsh patch rows.
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { rowLogLine, DSH_SEAM_TOOLS, dshSeamInject, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { SettingsSchema, SETTINGS_NS, TEAM_MODEL_SLOTS, TEAM_MODEL_SLOT_GROUPS, type ModelRoute, type TeamModelSlot, type TeamModelSlotId } from "./settings-schema"
import { markVolatile } from "./settings-schema"
import { surgicalEdit } from "./jsonc-edit"
import z from "../../mpd-schemastery"
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

/** The cordis plugin name; the loader addresses this row and its settings entry by it. */
export const name = "mpd-config"
/** The one service this row consumes; every other seam rides the adapter resolved at apply(). */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/**
 * The cordis context as this row uses it: the tool registrar plus the service/provider seams.
 * Declared structurally rather than imported, so the plugin stays runnable in unit tests
 * without a mounted cordis runtime; every member beyond `tools` is probed before use.
 */
type Ctx = { tools: any; provide: (name: string, value: any, check?: any) => void; get?: (serviceName: string) => any; logger?: any; [k: string]: any }
/** The row config: this plugin's wiring keys plus every `mpd.jsonc` knob the row schema declares. */
/** Param typing detail: the two file-path keys are the only routing knobs declared here. */
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
/**
 * The settings machinery's ENTRY ID for this row — the id the harness's settings editor addresses
 * the row's own volatile Config by (`settings.describe()` reports it under `ns = "mpd-config"`).
 *
 * This is NOT the `mpd` namespace (SETTINGS_NS): in the retired-namespace world BOTH front doors
 * (the Web card's `configForms.get("mpd-config")` and the TUI's `locateNamespace` default) read and
 * write the ENTRY document, so the entry document — not the namespace document — is the path a
 * settings save actually travels. R1's live refresh therefore hangs off THIS id.
 */
export const ENTRY_CONFIG_ID = "mpd-config"
/** The in-namespace idempotence marker (design §6.3): never a config knob, never a side file. */
const MARKER_PATH: readonly string[] = ["bridge", "migratedRevision"]


// --- minimal JSONC parser (comments + trailing commas; string-aware) ---
function stripJsonc(src: string): string {
  // Scanned output, built one character at a time so string contents survive untouched.
  let out = ""
  // True while the scan is inside a JSON string, where `//` and `/*` are literal characters.
  let inString = false
  // Read cursor over the whole source; advanced by 1, or by 2 when a unit is consumed.
  let i = 0
  while (i < src.length) {
    // The character at the cursor; the branch below decides what the scan does with it.
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

/**
 * Parse JSONC into the value it denotes: comments and trailing commas are removed first, then
 * the remaining text is handed to the platform parser.
 *
 * The value is deliberately UNTYPED (a JSON document may hold anything) — callers narrow it
 * through {@link isPlainObject} rather than trusting a shape.
 */
function parseJsonc(src: string): any {
  return JSON.parse(stripJsonc(src))
}

/**
 * Whether the value is a non-null, non-array object — the only shape the merge walks into.
 *
 * A TYPE PREDICATE (not a plain boolean): the slot resolver narrows `unknown` config values
 * through it, so the guard both checks and convinces the compiler.
 */
function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/** Keys the merge refuses to copy, so a hostile file cannot reach the prototype chain. */
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"])

// prototype-pollution safe deep merge (project wins)
function deepMerge(base: any, over: any): any {
  // The merge result, keyed in first-seen order; never an alias of `base` or `over`.
  const out: any = {}
  // Base keys, or none when `base` is not a plain object.
  const bkeys = isPlainObject(base) ? Object.keys(base) : []
  // Overlay keys, or none when `over` is not a plain object.
  const okeys = isPlainObject(over) ? Object.keys(over) : []
  for (const key of new Set([...bkeys, ...okeys])) {
    if (RESERVED_KEYS.has(key)) continue
    // The base value at this key; undefined when absent, so `over` alone can win.
    const bv = isPlainObject(base) ? base[key] : undefined
    // The overlay value at this key; undefined falls back to the base value.
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
  // A SHALLOW copy of the section, so the caller's object is never mutated by the delete below.
  const rest: any = { ...section }
  // A shallow copy of the marker subtree, from which the bookkeeping leaf is removed.
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
/**
 * Drop the schema's EMPTY slot residue from a `teamModels` block.
 *
 * MEASURED (2026-10-23): the vendored schemastery gives every `object(...)` an implicit `{}`
 * default, so a row config that declares `teamModels` resolves a workspace with NO declarations to
 * `{ slot1: {}, slot2: {}, slot3: {}, slot4: {} }`. Those empty objects are NOT user data — the
 * contract's read path "must contain only what the user wrote" (slot-single-source §2) — and
 * `mpd_config_get` must report an absent block as ABSENT (§9). This prunes the residue while keeping
 * every slot the user (or a save) actually filled.
 * @param block - the resolved `teamModels` value, of unknown shape.
 * @returns the block without its empty slot objects, or undefined when nothing is left.
 */
function withoutEmptySlots(block: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(block)) return undefined
  /** The block's slots that carry at least one leaf. */
  const kept: Record<string, unknown> = {}
  for (const [slot, value] of Object.entries(block)) {
    if (isPlainObject(value) && Object.keys(value).length === 0) continue
    if (value === undefined) continue
    kept[slot] = value
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The knobs carried by the row config, with this plugin's own routing keys stripped out. */
function rowKnobLayer(config: Config): Record<string, unknown> {
  // The row config read as a plain record: the schema-derived knobs are not in `Config`.
  const source = config as unknown as Record<string, unknown>
  // The knob layer, filled with every non-routing key whose value is actually defined.
  const layer: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (ROUTING_KEYS.includes(key)) continue
    if (value === undefined) continue
    // `teamModels` is the ONE block whose schema fills empty slots into the row config; a layer
    // must never carry that residue, or an absent block would read as declared.
    if (key === "teamModels") {
      /** The block as the user/save actually filled it, or undefined when nothing is left. */
      const kept = withoutEmptySlots(value)
      if (kept !== undefined) layer[key] = kept
      continue
    }
    layer[key] = value
  }
  return layer
}

/**
 * Resolve the config for ONE workspace root by deep-merging every layer for it, lowest
 * precedence first, and report which files actually contributed.
 *
 * The chain, in the order this function applies it: the schema defaults (implicit, they are
 * whatever the caller's schema fills in) < L1 the USER file < L2 the PROJECT file < L3 the
 * settings user section < L4 the row config. A later layer always wins, so the row config —
 * which is what the harness settings form actually edits — outranks a file the user may not
 * remember writing.
 *
 * `settingsSection` is taken RAW and with the in-namespace marker stripped, never as a
 * resolved value: re-applying a resolved section's base and defaults would treat them as
 * explicitly set. The returned `files` list names only the layers that EXIST, which is what
 * the status surface and the reload tool report.
 *
 * @param config - the row config as `apply` received it; its knob half is the L4 layer unless
 *   `rowKnobsOverride` replaces it (the entry-config live-refresh path does exactly that).
 * @param root - the workspace root whose project file is the L2 layer.
 * @param settingsSection - L3 verbatim, or undefined when the namespace is not served.
 * @param rowKnobsOverride - the FRESH knob layer read from the entry-config document, used
 *   instead of the apply-time row config after a settings save made that document newer.
 * @returns the merged config plus the file/error state consumers assert on.
 */
function loadConfig(config: Config, root: string, settingsSection?: unknown, rowKnobsOverride?: Record<string, unknown>): { config: any; files: string[]; errors: string[]; settingsApplied: boolean } {
  // DSH home for the user layer: the env override first, else the per-user default.
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh")
  // User layer file: an explicit row override wins, else `<DSH_HOME>/mpd.jsonc`.
  const userFile = config.userFile ? resolve(config.userFile) : join(dshHome, "mpd.jsonc")
  // Project layer file: an explicit row override wins, else `<root>/.mpd/mpd.jsonc`.
  const projectFile = config.projectFile ? resolve(config.projectFile) : join(root, ".mpd", "mpd.jsonc")
  // Layer order: user first, then project — `deepMerge` lets the LATER layer win.
  const files = [userFile, projectFile]
  // The merged result, accumulated layer by layer; starts empty (schema defaults apply later).
  let merged: any = {}
  // Per-file parse failures, named by path; reported through `states()` and the reload tool.
  const errors: string[] = []
  for (const f of files) {
    if (!existsSync(f)) continue
    try { merged = deepMerge(merged, parseJsonc(readFileSync(f, "utf8"))) }
    catch (e: any) { errors.push(f + ": " + String(e?.message ?? e)) }
  }
  // L3 verbatim, with the in-namespace marker stripped — never the RESOLVED section.
  const section = withoutMarker(settingsSection)
  // Whether L3 carried anything at all: an empty section applies nothing and is not a layer.
  const settingsApplied = isPlainObject(section) && Object.keys(section).length > 0
  if (settingsApplied) merged = deepMerge(merged, section)
  // L4: the ROW CONFIG, i.e. what the settings form edits. It sits ON TOP of the file layers for the
  // same reason the retired settings document did — an explicit edit in a front door outranks a file
  // the user may not remember writing. An override REPLACES the apply-time knob half wholesale (never
  // a spread merge, which would keep a leaf the entry document has since removed); undefined keeps
  // the apply-time behaviour every pre-existing caller relies on.
  const rowKnobs = rowKnobsOverride ?? rowKnobLayer(config)
  if (Object.keys(rowKnobs).length > 0) merged = deepMerge(merged, rowKnobs)
  return { config: merged, files: files.filter((f) => existsSync(f)), errors, settingsApplied }
}

export { stripJsonc, parseJsonc, deepMerge, loadConfig }

/**
 * The `teamModels` slot that routes one roster member, from the slots' OWN membership declaration.
 *
 * The membership is declared ONCE (`TEAM_MODEL_SLOT_GROUPS`) and shared by both settings front doors,
 * the roster provider and this read, so the member a slot drives cannot drift between the surface that
 * shows it and the surface that routes it. Matching is case- and separator-insensitive on the member's
 * functional NAME, which is the vocabulary the roster, the tool schemas and the settings card all use.
 *
 * @param member - the roster member's functional name, as a tool argument spells it.
 * @returns the slot id that routes it, or `undefined` when the roster does not slot-route that member.
 */
export function teamModelSlotOfMember(member: string): TeamModelSlotId | undefined {
  /** The member name collapsed to its letters and digits, the same key the settings front doors use. */
  const key = String(member ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (key === "") return undefined
  for (const slot of TEAM_MODEL_SLOTS) {
    if (TEAM_MODEL_SLOT_GROUPS[slot].members.some((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "") === key)) return slot
  }
  return undefined
}

/** One member's resolved `teamModels` route: the provider, the model and the optional effort keyword. */
export interface TeamModelRoute {
  /** Provider id the member must run on, e.g. `deepseek-official` or a gateway id. */
  readonly provider: string
  /** Model id that provider must offer for this member. */
  readonly model: string
  /** The effort keyword the slot declares; ABSENT means the slot states none and no effort may be invented. */
  readonly reasoningEffort?: string
}

/** The one code every refused spawn carries, so a caller can branch on the failure instead of its prose. */
export const SLOT_UNCONFIGURED_CODE = "SLOT_UNCONFIGURED"

/** The leaves a slot may carry; the subset the resolver reports as MISSING or malformed. */
export type SlotLeaf = "provider" | "model" | "reasoningEffort"

/** The resolution of a slot that IS configured and usable: its route plus its own fallback chain. */
export interface SlotResolved {
  /** The usable marker every consumer branches on. */
  readonly ok: true
  /** The slot id that routes the member. */
  readonly slot: (typeof TEAM_MODEL_SLOTS)[number]
  /** The configured primary route, trimmed exactly as the user wrote it. */
  readonly route: TeamModelRoute
  /** The slot's OWN sanitized fallback chain, in the user's order; `[]` when it declares none. */
  readonly fallbacks: readonly ModelRoute[]
  /** How many malformed fallback entries were DROPPED (contract §8: dropped, never fatal). */
  readonly fallbacksDropped: number
}

/** The resolution of a slot that is routed but NOT usable — the state a spawn refuses on. */
export interface SlotUnusable {
  /** The failure marker, so the union narrows without inspecting `status`. */
  readonly ok: false
  /** `unconfigured` (a required leaf is absent) or `invalid` (a leaf is present but malformed). */
  readonly status: "unconfigured" | "invalid"
  /** The slot id that routes the member. */
  readonly slot: (typeof TEAM_MODEL_SLOTS)[number]
  /** Every roster member this slot routes, in the group's own order. */
  readonly members: readonly string[]
  /** The leaves that are absent (`unconfigured`), in provider-before-model order. */
  readonly missing: readonly SlotLeaf[]
  /** The offending leaf path, for `invalid` only (e.g. `teamModels.slot1.model`). */
  readonly problem?: string
  /** The failure code every spawn applier attaches to its thrown error. */
  readonly code: typeof SLOT_UNCONFIGURED_CODE
  /** The ONE canonical sentence a spawn applier throws: slot, members, missing leaves, both recovery paths. */
  readonly message: string
}

/** The resolution of a member no slot routes at all (an extension role, or a name outside the roster). */
export interface SlotUnrouted {
  /** The failure marker; `unrouted` is NOT an error — it means "slots do not decide this member's route". */
  readonly ok: false
  /** The unrouted marker a consumer branches on before refusing a spawn. */
  readonly status: "unrouted"
  /** Always undefined: no slot routes this member. */
  readonly slot: undefined
}

/**
 * A TOTAL slot resolution (contract amendment 1): every consumer — a spawn applier, `/mpd-model`, the
 * settings card, `mpd_modelchain_resolve` — reads this union and never an exception.
 */
export type SlotResolution = SlotResolved | SlotUnusable | SlotUnrouted

/**
 * The required leaves a slot still needs, in the order a sentence names them: provider, then model.
 * @param declared - the slot's file value, already narrowed to a record.
 * @returns the absent-or-blank required leaves.
 */
function missingLeavesOf(declared: Record<string, unknown>): SlotLeaf[] {
  /** The required leaves whose value is absent, null or blank. */
  const missing: SlotLeaf[] = []
  for (const leaf of ["provider", "model"] as const) {
    /** The leaf's raw value: any string with content counts as SET. */
    const value = declared[leaf]
    if (typeof value !== "string" || value.trim() === "") missing.push(leaf)
  }
  return missing
}

/**
 * The canonical `SLOT_UNCONFIGURED` sentence ONE refused spawn reports (contract §7).
 *
 * It names the slot, its members, the missing or malformed leaf paths, BOTH recovery paths
 * (`/mpd-model`, and `teamModels.slotN` in `.mpd/mpd.jsonc`) and states that nothing was written and
 * no child was started — the facts a caller needs to fix the configuration without guessing.
 * @param slot - the slot id the member is routed by.
 * @param members - every member that slot routes.
 * @param detail - what is wrong: the missing leaf paths, or the malformed one.
 * @returns the ONE sentence the appliers throw.
 */
export function slotUnconfiguredMessage(slot: string, members: readonly string[], detail: string): string {
  return SLOT_UNCONFIGURED_CODE + ": " + slot + " (" + members.join(", ") + ") is not usable — " + detail
    + "; nothing was written and no child was started. Configure it with /mpd-model, or set teamModels." + slot
    + " in .mpd/mpd.jsonc."
}

/**
 * One malformed-fallback report: the entries to use and how many were dropped (contract §8).
 * @param raw - the slot's `fallbacks` value as the file declared it, of unknown shape.
 * @returns the sanitized chain plus the number of entries dropped as malformed.
 */
function sanitizeFallbacks(raw: unknown): { fallbacks: ModelRoute[]; dropped: number } {
  /** The sanitized chain, in the user's own order. */
  const fallbacks: ModelRoute[] = []
  /** How many declared entries were dropped for being malformed. */
  let dropped = 0
  // A non-array container is itself malformed: the whole chain is dropped, never the run.
  if (raw === undefined || raw === null) return { fallbacks, dropped }
  if (!Array.isArray(raw)) return { fallbacks, dropped: 1 }
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.provider !== "string" || typeof entry.model !== "string"
      || entry.provider.trim() === "" || entry.model.trim() === ""
      || (entry.reasoningEffort !== undefined && entry.reasoningEffort !== null && typeof entry.reasoningEffort !== "string")) {
      dropped += 1
      continue
    }
    /** The entry's optional effort keyword, trimmed; a blank one states none. */
    const effort = typeof entry.reasoningEffort === "string" ? entry.reasoningEffort.trim() : ""
    fallbacks.push({ provider: entry.provider.trim(), model: entry.model.trim(), ...(effort === "" ? {} : { reasoningEffort: effort }) })
  }
  return { fallbacks, dropped }
}

/**
 * The `teamModels` slot the config DECLARES for one slot id, read raw (never materialised).
 * @param slot - the slot id to read.
 * @param config - the resolved config; callers pass the live one so the value is never cached.
 * @returns the declared value, or undefined when the workspace declares no such slot.
 */
function slotValueOf(slot: string, config: unknown): unknown {
  /** The `teamModels` subtree, accepted only when it is an object. */
  const table = (config as { teamModels?: unknown } | undefined)?.teamModels
  if (!isPlainObject(table)) return undefined
  return table[slot]
}

/**
 * Resolve ONE roster member's slot route as a TOTAL union — the read every consumer shares
 * (contract §1-§2, amendment 1).
 *
 * NO DEFAULT LAYER: the answer comes only from what the workspace declares. A slot that is absent or
 * half-filled is `unconfigured` (with the missing leaves named); a slot whose leaf is present but not
 * a string is `invalid` (with the offending path); a member no slot routes is `unrouted`. This
 * function NEVER throws: a display surface renders the state, and only the three spawn appliers turn
 * `ok:false` into the throwing `SLOT_UNCONFIGURED` failure.
 *
 * @param member - the roster member's functional name.
 * @param config - the resolved config to read; the caller passes the live one so the value is never cached.
 * @returns the typed resolution: resolved route + fallbacks, or the reason it is unusable.
 */
export function resolveTeamModelSlot(member: string, config: unknown): SlotResolution {
  /** The slot that routes this member, or none. */
  const slot = teamModelSlotOfMember(member)
  if (slot === undefined) return { ok: false, status: "unrouted", slot: undefined }
  /** Every member this slot routes, so every refusal names them. */
  const members = TEAM_MODEL_SLOT_GROUPS[slot].members
  /** The slot's declared value, exactly as the file/layers hold it. */
  const declared = slotValueOf(slot, config)
  /** What an absent slot still needs: both required leaves. */
  const missingAll: readonly SlotLeaf[] = ["provider", "model"]
  if (declared === undefined || declared === null) {
    /** The absent-leaf sentence lists every leaf the slot must gain. */
    const missingPaths = missingAll.map((leaf) => "teamModels." + slot + "." + leaf)
    return { ok: false, status: "unconfigured", slot, members, missing: missingAll, code: SLOT_UNCONFIGURED_CODE, message: slotUnconfiguredMessage(slot, members, "missing " + missingPaths.join(", ")) }
  }
  if (!isPlainObject(declared)) {
    return { ok: false, status: "invalid", slot, members, missing: missingAll, problem: "teamModels." + slot, code: SLOT_UNCONFIGURED_CODE, message: slotUnconfiguredMessage(slot, members, "teamModels." + slot + " must be an object, but it is " + JSON.stringify(declared)) }
  }
  // Leaf validation: a present leaf must be a string; null is the JSON spelling of "unset".
  for (const leaf of ["provider", "model", "reasoningEffort"] as const) {
    /** The leaf's raw value, undefined when the file never wrote it. */
    const value = declared[leaf]
    if (value === undefined || value === null) continue
    if (typeof value !== "string") {
      /** The dotted path a reader has to fix. */
      const path = "teamModels." + slot + "." + leaf
      return { ok: false, status: "invalid", slot, members, missing: missingLeavesOf(declared), problem: path, code: SLOT_UNCONFIGURED_CODE, message: slotUnconfiguredMessage(slot, members, path + " must be a string, but it is " + JSON.stringify(value)) }
    }
  }
  /** The required leaves the slot does not state yet. */
  const missing = missingLeavesOf(declared)
  if (missing.length > 0) {
    /** The missing-leaf paths, in the order the sentence names them. */
    const missingPaths = missing.map((leaf) => "teamModels." + slot + "." + leaf)
    return { ok: false, status: "unconfigured", slot, members, missing, code: SLOT_UNCONFIGURED_CODE, message: slotUnconfiguredMessage(slot, members, "missing " + missingPaths.join(", ")) }
  }
  /** The slot's provider id, trimmed; the guard above proved it is a non-blank string. */
  const provider = String(declared.provider).trim()
  /** The slot's model id, trimmed; the guard above proved it is a non-blank string. */
  const model = String(declared.model).trim()
  /** The slot's optional effort keyword, trimmed; a blank one states none. */
  const effort = typeof declared.reasoningEffort === "string" ? declared.reasoningEffort.trim() : ""
  /** The slot's own fallback chain, sanitized; malformed entries are dropped with a count. */
  const { fallbacks, dropped } = sanitizeFallbacks(declared.fallbacks)
  return { ok: true, slot, route: { provider, model, ...(effort === "" ? {} : { reasoningEffort: effort }) }, fallbacks, fallbacksDropped: dropped }
}

/**
 * The route ONE roster member is CONFIGURED to run on, or `undefined` when it has none — the TOTAL
 * read of the service (contract amendment 1: a display path must never see an exception).
 *
 * WHY THIS IS A SERVICE METHOD. Its consumers (the one-shot `mpd_role_spawn`, `mpd_roles_list`, the
 * workmate library, the roster provider and `mpd_modelchain_resolve`) live in OTHER packages, and a
 * cross-package relative import would be a NEW entry in the frozen coupling inventory
 * (`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts`, which may only
 * shrink). They already resolve the `mpdConfig` service at runtime, so the ONE authoritative read of
 * the slots belongs here, beside the declaration and the resolution it uses.
 *
 * @param member - the roster member's functional name.
 * @param config - the resolved config to read; the caller passes the live one so the value is never cached.
 * @returns the configured route, or `undefined` for an unconfigured, invalid or unrouted member.
 */
export function teamModelRouteOfMember(member: string, config: unknown): TeamModelRoute | undefined {
  /** The total resolution: only a usable slot answers a route. */
  const resolution = resolveTeamModelSlot(member, config)
  return resolution.ok ? resolution.route : undefined
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

// ── the ONE-TIME file seed (contract §10) ────────────────────────────────────────────────────────
// "Initial config is FILE initialization, not a runtime default": a workspace whose `.mpd/mpd.jsonc`
// declares no `teamModels` gets all four slots written ONCE, from the user's OWN configured
// providers read through the live LLM catalog. It never runs as a fallback at read time, never
// rewrites an existing block, and never overwrites a user edit — if the catalog is unavailable it
// writes nothing, says so once, and the first spawn reports SLOT_UNCONFIGURED instead.
//
// ONE-TIME IS DURABLE: a successful seed records `<ws>/.mpd/model-config-seed.json` (created with
// `wx`, never overwritten), and that marker is consulted BEFORE any attempt — so a user who later
// DELETES the block on purpose is never "helped" back into a seeded one.

/** The seed's preferred model id: the `deepseek-flash` family's exact member. */
export const SEED_MODEL_ID = "deepseek-flash"

/** The route the seed writes into every slot: one provider that lists the chosen model. */
export interface SeedRoute {
  /** The configured provider that positively lists the chosen model. */
  readonly provider: string
  /** The chosen model id, from the `deepseek-flash` family. */
  readonly model: string
}

/** The slice of the adapter's catalog the seed reads (structural, so a test double needs no cast). */
export interface SeedCatalogLike {
  /** The providers the host currently has configured. */
  readonly providers?: ReadonlyArray<{ readonly id?: unknown; readonly models?: ReadonlyArray<{ readonly id?: unknown }> }>
}

/**
 * Choose the seed route from the LIVE catalog (contract §10).
 *
 * Model: the `deepseek-flash` family — an EXACT `deepseek-flash` id wins, else the first id that
 * contains `flash` (case-insensitive), in catalog order. Provider: the first configured provider
 * that positively lists the chosen model. Nothing is guessed: no flash-family model or no provider
 * listing it yields `undefined`, and the seed writes nothing.
 * @param catalog - the catalog the adapter projected, or undefined when the seam was absent.
 * @returns the route to seed, or undefined when the catalog offers no flash-family model.
 */
export function chooseSeedRoute(catalog: SeedCatalogLike | undefined): SeedRoute | undefined {
  /** Every (provider, model) pair the catalog positively lists, in catalog order. */
  const pairs: Array<{ provider: string; model: string }> = []
  for (const provider of catalog?.providers ?? []) {
    if (typeof provider?.id !== "string" || provider.id.trim() === "") continue
    for (const model of provider.models ?? []) {
      if (typeof model?.id !== "string" || model.id.trim() === "") continue
      pairs.push({ provider: provider.id.trim(), model: model.id.trim() })
    }
  }
  /** The exact `deepseek-flash` listing, preferred over every looser match. */
  const exact = pairs.find((pair) => pair.model === SEED_MODEL_ID)
  if (exact !== undefined) return exact
  /** The closest `*flash*` listing, used when no exact id is configured. */
  return pairs.find((pair) => pair.model.toLowerCase().includes("flash"))
}

/**
 * Build the four-slot block the seed writes: ONE route, with `slot1` at `max` and slots 2-4 at `high`
 * (contract §10). Slots 2-4 share the route because the catalog knows one flash-family model.
 * @param route - the chosen provider/model pair.
 * @returns the `teamModels` value to write into the project file.
 */
export function buildSeedBlock(route: SeedRoute): Record<string, TeamModelSlot> {
  return {
    slot1: { provider: route.provider, model: route.model, reasoningEffort: "max" },
    slot2: { provider: route.provider, model: route.model, reasoningEffort: "high" },
    slot3: { provider: route.provider, model: route.model, reasoningEffort: "high" },
    slot4: { provider: route.provider, model: route.model, reasoningEffort: "high" },
  }
}

/**
 * Write the seed block into ONE project file, idempotently and without touching anything else.
 *
 * A file whose root declares `teamModels` — even a partial or empty block — is LEFT BYTE-IDENTICAL:
 * "never rewrite an existing block, never overwrite a user edit". A missing file is created; an
 * unparsable one is refused untouched.
 * @param file - the project file to seed (`<workspace>/.mpd/mpd.jsonc` unless overridden).
 * @param route - the route the catalog chose.
 * @returns `seeded` when this call wrote, `declared` when the file already declared the block,
 *   `unreadable` when the file exists but cannot be parsed or edited.
 */
export function seedTeamModelsFile(file: string, route: SeedRoute): { outcome: "seeded" | "declared" | "unreadable"; detail?: string } {
  /** The file's current bytes, or undefined when it does not exist yet. */
  const raw = existsSync(file) ? readFileSync(file, "utf8") : undefined
  if (raw !== undefined) {
    /** The parse verdict for the existing file; an unparsable file is never edited. */
    const parsed = parseJsoncChecked(raw)
    if (parsed.ok !== true) return { outcome: "unreadable", detail: parsed.detail }
    /** The parsed root, narrowed so a `teamModels` lookup is safe. */
    const root = isPlainObject(parsed.value) ? parsed.value : {}
    // ANY declared block wins over the seed: even `{}` is a user edit this function must not rewrite.
    if (Object.prototype.hasOwnProperty.call(root, "teamModels")) return { outcome: "declared" }
  }
  /** The text the edit starts from: the file's own bytes, or an empty document for a new file. */
  const base = raw ?? "{}\n"
  /** The surgical insertion of the block at the root, preserving every other byte. */
  const edited = surgicalEdit(base, ["teamModels"], buildSeedBlock(route), { insert: true })
  if (edited.ok !== true) return { outcome: "unreadable", detail: edited.reason }
  if (!edited.changed) return { outcome: "declared" }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, edited.text, "utf8")
  return { outcome: "seeded" }
}

/** The durable one-time-seed marker's file name inside a workspace's `.mpd/` directory. */
export const SEED_MARKER_FILE = "model-config-seed.json"

/** The marker path for ONE workspace root: `<ws>/.mpd/model-config-seed.json`. */
export function seedMarkerFor(root: string): string {
  return join(root, ".mpd", SEED_MARKER_FILE)
}

/**
 * Whether a project file already DECLARES a `teamModels` block — the read-only first guard of the
 * seed, so a configured workspace never pays for a catalog read.
 * @param file - the project file (absent is `absent`, never an error).
 * @returns `declared` (any block, even `{}` — a user edit), `absent`, or `unreadable`.
 */
export function teamModelsDeclaredIn(file: string): "declared" | "absent" | "unreadable" {
  if (!existsSync(file)) return "absent"
  /** The parse verdict for the existing file; an unparsable one is never edited. */
  const parsed = parseJsoncChecked(readFileSync(file, "utf8"))
  if (parsed.ok !== true) return "unreadable"
  /** The parsed root, narrowed so a `teamModels` lookup is safe. */
  const root = isPlainObject(parsed.value) ? parsed.value : {}
  return Object.prototype.hasOwnProperty.call(root, "teamModels") ? "declared" : "absent"
}

/** What ONE seed attempt decided, and why — the union the coordinator logs from. */
export interface SeedRunOutcome {
  /** The decision: seeded / declared / marked (already seeded once) / no-catalog / unreadable. */
  readonly status: "seeded" | "declared" | "marked" | "no-catalog" | "unreadable"
  /** The route written, for a `seeded` run. */
  readonly route?: SeedRoute
  /** The named refusal for `no-catalog` / `unreadable`. */
  readonly detail?: string
}

/**
 * Run the ONE-TIME seed for one workspace: the durable-marker protocol around
 * {@link seedTeamModelsFile} (contract §10, captain's F3).
 *
 * Order matters, and each step is a separate guard:
 *   1. the MARKER is consulted BEFORE anything else — a workspace seeded once (durably marked in
 *      `<ws>/.mpd/model-config-seed.json`) is never seeded again, even if the user later deletes the
 *      block on purpose: "never seed twice" must beat "the file looks unconfigured";
 *   2. an existing `teamModels` block wins next (a user edit is never rewritten, and no catalog read
 *      is spent on a configured workspace);
 *   3. only then is the catalog consulted; no flash-family route means nothing written and NO marker,
 *      so a later attempt (process or boot) can still seed once when the catalog is available.
 *
 * The marker is created with `wx` AFTER a successful write, so two processes racing the first boot
 * cannot overwrite each other's record — the loser's `EEXIST` is a success, not a failure.
 * @param projectFile - the project file to seed (`<workspace>/.mpd/mpd.jsonc` unless overridden).
 * @param markerFile - the durable marker path ({@link seedMarkerFor}).
 * @param catalog - the catalog the adapter projected, or undefined when the seam was absent.
 * @returns the decision; the caller owns logging and the retry policy.
 */
export function seedTeamModelsOnce(projectFile: string, markerFile: string, catalog: SeedCatalogLike | undefined): SeedRunOutcome {
  // STEP 1: the durable marker. A deliberate deletion after a seed must NEVER be undone by the seed.
  if (existsSync(markerFile)) return { status: "marked" }
  // STEP 2: a declared block is the user's own configuration — never rewritten, never re-seeded.
  /** The file's declaration state, read before any catalog work. */
  const declared = teamModelsDeclaredIn(projectFile)
  if (declared === "declared") return { status: "declared" }
  if (declared === "unreadable") return { status: "unreadable", detail: "the project file does not parse" }
  // STEP 3: the catalog. Nothing is written (and no marker is left) when it cannot answer.
  /** The route the catalog offers, or undefined when no flash-family model is configured. */
  const route = chooseSeedRoute(catalog)
  if (route === undefined) return { status: "no-catalog", detail: "the catalog lists no deepseek-flash model" }
  /** The file-write outcome; the marker follows ONLY a real write. */
  const written = seedTeamModelsFile(projectFile, route)
  if (written.outcome === "unreadable") return { status: "unreadable", detail: written.detail }
  if (written.outcome === "declared") return { status: "declared" }
  // STEP 4: mark the workspace as seeded ONCE. `wx` is the exclusive create: an existing marker is
  // never overwritten (a concurrent first boot already recorded it), and any other failure is
  // reported rather than swallowed.
  try {
    mkdirSync(dirname(markerFile), { recursive: true })
    writeFileSync(markerFile, JSON.stringify({ seededAt: new Date().toISOString(), provider: route.provider, model: route.model }, null, 2) + "\n", { flag: "wx" })
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "EEXIST") return { status: "seeded", route, detail: "the seed wrote the file but could not record its marker: " + String((error as Error)?.message ?? error) }
  }
  return { status: "seeded", route }
}

/** The parse verdict of a `.mpd/mpd.jsonc` text, as the seed's guard consumes it. */
interface SeedParseVerdict {
  /** Whether the text parsed as JSONC. */
  readonly ok: boolean
  /** The parsed value when `ok`. */
  readonly value?: unknown
  /** The parser's diagnostic when the text did not parse. */
  readonly detail?: string
}

/**
 * Parse one project file the way the seed's guard needs it (JSONC comments and trailing commas
 * allowed, the same reader the config layer uses).
 * @param text - the file's exact bytes.
 * @returns the verdict plus the parsed value, or the parser's reason.
 */
function parseJsoncChecked(text: string): SeedParseVerdict {
  try {
    /** The parsed document, or the parser's throw. */
    const value: unknown = parseJsonc(text)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, detail: String((error as Error)?.message ?? error) }
  }
}

/**
 * Register the `mpdConfig` service, the two config tools and the settings bridge, in that
 * order: the service is what other mpd plugins inject, and the bridge only augments it.
 *
 * Every seam is probed first — a missing one degrades this row with a warning, because it
 * must never take the whole plugin tree down (see `degraded` on the bridge state).
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // FLAG THE SCHEMA AT APPLY TIME, not at module init. A schemastery node's `meta` is not yet the
  // object the loader will later read while the module is still evaluating (measured: the same
  // assignment persists when it is made after the module has loaded, and is gone when it is made
  // during evaluation), and the settings editor reads `runtime.Config` long after this point.
  markVolatile(Config)
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)

  // A bridge diagnostic MUST be visible in a HEADLESS/web boot: `ctx.logger.warn` has no
  // stdout sink there (MEASURED by the tui-settings-bridge lane's first real run, whose log
  // carried every other mpd row's line but none of the bridge's), so every line ALSO goes to
  // stdout — the same pattern `mpd-ext-plugin` uses for its apply failures. Without this, a
  // read-only/conflicting/ambiguous target produced NO diagnostic anywhere (design §9.3 F6).
  const warn = (message: string): void => {
    try {
      rowLogLine("mpd-config", message)
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

  /** Map a leaf path to one map key: the NUL join cannot collide with a real dot-path segment. */
  const pathKey = (path: readonly string[]): string => path.join("\u0000")
  /** Whether a leaf belongs to the marker subtree, which is bookkeeping rather than a knob. */
  const isMarker: (path: readonly string[]) => boolean = (path: readonly string[]): boolean => path[0] === MARKER_PATH[0]

  /** `settingsBridge.writeBack` (default ON) + the env lever of design §10.2. */
  const bridgeOptions = (): BridgeOptions => ({
    writeBack: config.writeBack !== false && config.settingsBridge?.writeBack !== false && process.env.MPD_DSH_TUI_SETTINGS_BRIDGE !== "off",
    retries: DEFAULT_BRIDGE_OPTIONS.retries,
  })

  /**
   * The row config's `projectFile` override, resolved, or undefined when the knob is unset.
   *
   * ONE expression for the whole row (S1): the read (`loadConfig`), the write-back, `reconcile` and
   * the watcher all resolve a target through it, so a configured `projectFile` can never be honoured
   * on the read path and ignored on the write path — which would write (and on a fresh workspace
   * CREATE) a file the config layer never reads.
   */
  const projectFileOverride = (): string | undefined => (config.projectFile ? resolve(config.projectFile) : undefined)

  /** The target file for a root: the row override wins, else that root's own project file. */
  const projectFileFor = (root: string): string => projectFileOverride() ?? join(root, ".mpd", "mpd.jsonc")

  /**
   * The root the READ-IN uses: the one live session root when exactly one root is
   * live (unambiguous), otherwise the adapter's exec-less root. This is a READ, so it
   * is not the write-target guess A3 forbids — the write target is decided by
   * `resolveTargets` alone.
   */
  const readRoot = (): string => {
    // Every live session root; exactly one is unambiguous, several are not ours to guess.
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
    // The namespace reader, or undefined while the namespace is not served.
    const reader = dsh.settingsReader(SETTINGS_NS)
    if (reader === undefined) {
      bridge.serviceReady = false
      bridge.served = false
      bridge.section = undefined
      return undefined
    }
    bridge.serviceReady = true
    // The reader's snapshot: revision plus the raw user section this layer treats as L3.
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

  // The resolved config for the LAST root read, refreshed by every reload and watcher tick.
  let state = loadConfig(config, dsh.workspaceRoot(), readSection())
  /**
   * The FRESH row-knob layer from the ENTRY-CONFIG document (L4), or undefined until a settings
   * save has made that document newer than the apply-time row config.
   *
   * `reloadAt` and the entry listener thread this through `loadConfig`'s override so a save
   * SURVIVES a later reload (a tool's `reload(exec)` must never revert the state to the stale
   * apply-time config) while every pre-existing caller keeps the apply-time behaviour.
   */
  let entryKnobs: Record<string, unknown> | undefined

  /**
   * The entry-config document's SAVED OVERRIDE section — the row config a save actually put in the
   * profile patch — read through the adapter's settings reader, or undefined while the entry is
   * unserved or the host reports no override half.
   *
   * MEASURED (harness 0.1.7-rc.2, `evidence/model-config-live-refresh/2026-10-13T15-15-39-019Z/`):
   * `describe().value` keeps projecting the APPLY-TIME fiber config after `settings/mutate`, so a
   * layer composed from it re-imposed every materialised schema default as an override — it buried
   * the save itself AND a lower-layer `<workspace>/.mpd/mpd.jsonc` edit under those defaults.
   * `describe().user` is the entry's OVERRIDE layer (the host computes it as
   * `projectForm(form, profilePatch.config ?? {})`), so it carries exactly the leaves a save set and
   * is `{}` while nothing is saved; `describe().base` is the inherited layer BELOW that override and
   * is likewise unchanged by a save. A materialised default therefore cannot enter this layer, and a
   * file edit can never be shadowed by one.
   *
   * The reader is resolved PER CALL: the settings provider mounts after this row (the same
   * measured race `whenSettingsAvailable` exists for), so a mount-time read would report "unserved"
   * and mean nothing by the time a save fires.
   */
  const readEntryConfig = (): unknown => {
    if (typeof dsh.settingsReader !== "function") return undefined
    /** The entry document's descriptor, or undefined when the machinery does not serve this id. */
    const described = dsh.settingsReader(ENTRY_CONFIG_ID)?.describe()
    if (described === undefined) return undefined
    // ONLY the override half may become the L4 layer: `value` (the frozen apply-time fiber config)
    // and `base` (the inherited defaults) both carry materialised schema defaults, which must never
    // sit above a file layer. A host that reports no override half yields undefined, and the last
    // good knobs stand (the same transient-unserved rule the listener below already applies).
    return isPlainObject(described.user) ? described.user : undefined
  }

  /** Re-read every layer for ONE workspace root (used by the tools and by the file watcher). */
  const reloadAt = (root: string): any => {
    state = loadConfig(config, root, readSection(), entryKnobs)
    reconcile(root)
    // The one-time seed retries here ONLY while it still owes an attempt (the llm registry mounts
    // after this row in a real boot); a workspace that already declares the block is left alone.
    seedAt(root)
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

  /** One diagnostic line per write-back, carrying the per-target result and the revision fence. */
  const reportLine = (report: BridgeReport & { source?: string; revision?: number }, note?: string): string =>
    `[mpd-config] settings bridge${note ? " " + note : ""}: ` + JSON.stringify({ writtenTo: report.writtenTo, skipped: report.skipped ?? null, candidates: report.candidates ?? [], results: report.results, applies: report.applies, source: report.source ?? null, revision: report.revision ?? null })

  /** Explain a skipped write-back, naming the reason and the candidate roots it saw. */
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
    // The project file of the root being reconciled; without one there is nothing to compare.
    const file = projectFileFor(root)
    if (!existsSync(file)) return
    // The file's leaves, or nothing when the file is absent or unparsable (nothing to clear).
    let leaves: BridgeLeaf[]
    try {
      leaves = sectionLeaves(parseJsonc(readFileSync(file, "utf8")))
    } catch {
      return
    }
    // What the file holds now, keyed by encoded path; the marker leaf is not a config value.
    const onDisk = new Map(leaves.filter((leaf) => !isMarker(leaf.path)).map((leaf) => [pathKey(leaf.path), leaf.value]))
    // L3 as last read: only a leaf present HERE can be an override left over from a file edit.
    const section = bridge.section
    // Encoded paths of the L3 leaves, so membership is one lookup per recorded leaf.
    const sectionKeys = new Set(sectionLeaves(section).map((leaf) => pathKey(leaf.path)))
    // Dot-path arrays to unset, in the order the recorded leaves were walked.
    const unsetPaths: string[][] = []
    for (const [key, recorded] of [...bridge.recorded]) {
      // The file value now: differs from the recorded one exactly when the file moved.
      const current = onDisk.get(key)
      if (JSON.stringify(current) === JSON.stringify(recorded)) continue
      bridge.recorded.set(key, current)
      if (current === undefined) continue
      if (!sectionKeys.has(key)) continue
      unsetPaths.push(key.split("\u0000"))
    }
    if (unsetPaths.length === 0) return
    // The retired model has no document to clear: the file's value already applies, and this call
    // could only fail. Skipping it is not a silent failure — the reason was logged once at mount.
    if (settingsModelRetired) return
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

  /** Record the file's current leaves as the baseline a later edit is compared against. */
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
    // Resolved write-back options for THIS call, so one decision governs the whole path.
    const options = bridgeOptions()
    if (!options.writeBack) {
      // The report for a disabled write-back: nothing written, and the edit still took effect.
      const disabled: BridgeReport & { source?: string; revision?: number; at?: string } = { writtenTo: [], results: [], skipped: "disabled", applies: "live", source, revision, at: new Date().toISOString() }
      bridge.report = disabled
      warnRefusal("disabled", [])
      warn(reportLine(disabled, "DISABLED"))
      return
    }
    // Who the file write targets — exactly one live root, or a refusal naming why not. The row's
    // `projectFile` override is passed IN (S1), so this write lands on the file `loadConfig` reads.
    const decision = resolveTargets(dsh.workspaceRootsAll(), projectFileOverride())
    if (decision.kind === "refuse") {
      // The report for a refusal: no target was written, and every candidate is named.
      const refused: BridgeReport & { source?: string; revision?: number; at?: string } = { writtenTo: [], results: [], skipped: decision.reason, candidates: decision.candidates, applies: "live", source, revision, at: new Date().toISOString() }
      bridge.report = refused
      warnRefusal(decision.reason, decision.candidates)
      warn(reportLine(refused, decision.reason))
      return
    }
    // The per-target write result; the loops below turn it into diagnostics and watchers.
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
      // REWORDED by wave fix/model-config-live-refresh: the blanket "needs a restart" claim was
      // true only before L1's entry-config subscription and mount-armed watcher. The settings
      // value itself is live — the config service re-resolves on every settings save, and the
      // model-config knobs (teamModels, modelchain) are read PER USE — so the ONLY
      // class still waiting for the next dsh boot is a knob some plugin captured at its own mount
      // instead of reading the live config service per use (see `BRIDGE_RESTART_LIMIT`, which
      // names that class per knob), and the warning says exactly that instead of a blanket restart.
      warn(`[mpd-config] settings bridge: ${result.outcome} for ${result.file}${result.reason ? " (" + result.reason + ")" : ""}${result.detail ? " — " + result.detail : ""} — the file is byte-untouched and the settings value still applies in the RUNNING process (no restart: the config service re-resolves on every save, and the model-config knobs are read per use); only a knob some plugin captured at its own mount keeps its captured value until the next dsh boot.`)
    }
    warn(reportLine(bridge.report, report.writtenTo.length > 0 ? "WROTE" : "OK"))
    watchRoot(decision.targets[0].root)
  }

  // A file watcher is the ONLY way a fresh `<workspace>/.mpd/mpd.jsonc` edit is observed
  // (the settings service knows nothing about the file), so the D-2 clearing rule needs one.
  const watchers = new Map<string, () => void>()
  /**
   * Watch one root's project file and reload on change, at most once per quiet period.
   *
   * One watcher per file: a second call for the same file returns immediately, so a write-back
   * that re-targets the same root never stacks listeners. A watch that cannot be established at
   * all degrades to reconciliation on the next reload instead of failing this row.
   */
  function watchRoot(root: string): void {
    // The project file this root watches; one watcher per file, so a re-run is a no-op.
    const file = projectFileFor(root)
    if (watchers.has(file)) return
    try {
      // The file's directory; watching it covers an atomic rename over the file itself.
      const dir = dirname(file)
      if (!existsSync(dir)) return
      // The file name: events for any other name are not this file's edit.
      const name = basename(file)
      // Debounce handle; a burst of writes collapses into one reload.
      let timer: ReturnType<typeof setTimeout> | undefined
      // The fs listener: filters by name, then reloads once the writer has gone quiet.
      const listener = (_event: string, changed: unknown): void => {
        if (changed !== null && changed !== undefined && String(changed) !== name) return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          reloadAt(root)
        }, 150)
        if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref()
      }
      // The underlying fs watcher, owned by the disposer stored in `watchers`.
      const watcher = watch(dir, listener)
      /** Releases this watch: the pending debounce first, then the fs watcher itself. */
      const dispose = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        try {
          watcher.close()
        } catch {
          // already closed
        }
      }
      watchers.set(file, dispose)
      // THE WATCH BELONGS TO THIS ROW'S OWN SCOPE (S5): a disposer parked in a local map is never
      // drained, so an unload would leave the fs watcher — and its debounce timer — alive for the
      // process lifetime, reloading into a disposed row.
      if (typeof ctx.effect === "function") ctx.effect(() => dispose, "mpd-config: project-file watcher " + file)
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
    // The namespace reader for the migration; absent while the namespace is not served.
    const reader = dsh.settingsReader(SETTINGS_NS)
    // The snapshot whose user section is migrated and whose revision is the marker fence.
    const described = reader?.describe()
    if (described === undefined) {
      bridge.migration = "not-served"
      return
    }
    // The settings leaves a file write would establish, marker leaf excluded.
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
    // Same refusal contract as the write-back: one live root, or the migration is deferred — and
    // the SAME target resolver, so a migrated value lands where the config layer reads it (S1).
    const decision = resolveTargets(dsh.workspaceRootsAll(), projectFileOverride())
    if (decision.kind === "refuse") {
      bridge.migration = decision.reason === "no-live-session" ? "deferred-no-workspace" : `deferred-${decision.reason}`
      if (decision.reason === "no-live-session") warn("[mpd-config] settings bridge: migration deferred — no live session workspace to migrate into (nothing was written to process.cwd()).")
      else warnRefusal(decision.reason, decision.candidates)
      return
    }
    // The migration write, through the SAME refuse-first writer the live write-back uses.
    const report = writeBackLeaves(decision.targets, leaves, bridgeOptions())
    if (report.skipped !== undefined) {
      bridge.migration = `deferred-${report.skipped}`
      return
    }
    // The first target that did not land, if any: a partial migration is reported, not hidden.
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
    // The revision the marker write is fenced on, read once so both uses agree.
    const revision = described.revision
    // The marker value: the provider bumps the revision by one per raw-section change.
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

  // ── the ENTRY-CONFIG live refresh (R1; wave fix/model-config-live-refresh) ──────────
  // The retired-namespace world saves through the ENTRY document (`mpd-config`), so the bridge
  // below — keyed to the legacy `mpd` namespace — never fires for a front-door save and the knobs
  // it edits stayed frozen at the apply-time row config. This subscription is the fix's other half:
  // an entry-config document update re-loads `state` from the FRESH document, with no reload call.
  // Deliberately NO file write-back on this path: the entry document is the host's own store, the
  // SAVED override (`readEntryConfig`) is ALREADY the top layer (L4), and writing the document's
  // materialised defaults into `.mpd/mpd.jsonc` would pollute the file — persistence of an entry
  // save is the host's.
  if (typeof dsh.onSettingsDocumentUpdated === "function") dsh.onSettingsDocumentUpdated(ENTRY_CONFIG_ID, () => {
    // The entry document's SAVED override as of now; a transient unserved read (or a host that
    // reports no override half) leaves the last good knobs standing.
    const doc = readEntryConfig()
    if (doc === undefined) return
    entryKnobs = rowKnobLayer(doc as Config)
    // L3 is NOT re-read here: this event is about the ENTRY document, and `readSection()` would
    // refresh `bridge.section` — the baseline the legacy listener diffs ITS saves against — making
    // a legacy save that lands in the same tick look unchanged and silently skip its file
    // write-back (measured by the coexistence case of the live-refresh lane). The last-read
    // section is exactly what L3 was when nothing about that document changed.
    state = loadConfig(config, readRoot(), bridge.section, entryKnobs)
    warn(`[mpd-config] entry-config update: state re-loaded from the "${ENTRY_CONFIG_ID}" document (${Object.keys(entryKnobs).length} knob(s) in force) — no restart needed`)
  })

  if (typeof dsh.onSettingsDocumentUpdated !== "function") {
    // Same version-skew guard: without the subscription there is no write-back trigger,
    // so the row keeps serving config (and says so in `states()`) instead of throwing.
    bridge.degraded = bridge.degraded ?? "adapter has no onSettingsDocumentUpdated seam"
  } else dsh.onSettingsDocumentUpdated(SETTINGS_NS, (revision: number | undefined, source: string | undefined) => {
    // L3 as of BEFORE this event: the diff below is what the event actually changed.
    const previous = bridge.section
    // L3 as of now; also the section the config is re-resolved against. The FRESH entry knobs
    // thread through here too: a legacy-namespace save must never revert an entry-config save.
    const next = readSection()
    state = loadConfig(config, readRoot(), next, entryKnobs)
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

  // ── the mount-time file watcher (R1; wave fix/model-config-live-refresh) ──────────
  // A HAND edit of `<workspace>/.mpd/mpd.jsonc` is the other live-refresh path, and before this
  // wave the watcher existed only as a write-back side effect (`watchRoot` inside `writeBack`),
  // so a workspace nobody had saved through settings had NO watcher at all. Armed HERE, at mount,
  // for the read root plus every live session root (one watcher per FILE — `watchRoot` dedups),
  // a hand edit reaches `state` through the same 150 ms debounce a write-back echo uses.
  watchRoot(readRoot())
  for (const root of dsh.workspaceRootsAll()) watchRoot(root)

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
    // The live session roots whose cardinality picks the base — zero, one, or ambiguous.
    const roots = dsh.workspaceRootsAll()
    if (roots.length === 1) return { base: loadConfig(config, roots[0]).config, reason: "one-live-root" }
    if (roots.length === 0) return { base: loadConfig(config, readRoot()).config, reason: "mount-time-root" }
    warn(`[mpd-config] settings bridge: ${roots.length} live workspaces (${roots.join(", ")}) — the namespace base is NOT derived from a file, because the file is per-workspace and the namespace is host-global; both front doors will show the schema defaults until exactly one workspace is live.`)
    return { base: undefined, reason: "ambiguous-multi-root", candidates: roots }
  }

  /** Set once the harness answers that the namespace model is gone; the legacy paths then stay quiet. */
  let settingsModelRetired = false

  /** Register the namespace on its FILE-DERIVED base; a refused registration is loud, not fatal. */
  const registerNamespace = (base: unknown): void => {
    if (typeof dsh.settingsRegister !== "function") {
      bridge.degraded = "adapter has no settingsRegister seam (rebuild packages/mpd-dsh-adapter-plugin/dist)"
      return
    }
    // The host's verdict: `ok:false` means the namespace model is retired in this harness.
    const result = dsh.settingsRegister(SETTINGS_NS, SettingsSchema, { base, applies: "restart" })
    if (result.ok !== true) {
      bridge.namespaceRegistration = result.error
      // THE MODEL IS RETIRED, and saying so ONCE is the whole of this path's job now.
      //
      // Harness 0.1.7-rc.2 replaced the namespace registry with the Cordis patch editor: the mpd
      // knobs are this ROW's own `Config` (see {@link Config} and `markVolatile`), and BOTH front
      // doors read and write them through `configForms.get("mpd-config")`. Nothing registers a
      // namespace any more, so a per-boot "could not register" reads like a fault when it is simply
      // the retired shape — and the parts of the legacy bridge that would have used it (the
      // file-edit override clearing, the migration marker) are DORMANT by construction.
      settingsModelRetired = true
      bridge.degraded = `the namespace-registry model is retired in this harness (${result.error}); the knobs are served as this row's config under the entry "mpd-config"`
      warn(`[mpd-config] settings bridge: the namespace-registry model is RETIRED in this harness — the mpd knobs are served as this row's config (entry "mpd-config") and edited through the harness's own form. The legacy file write-back and override clearing are dormant.`)
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
    // The base decision, recomputed here because the settings provider mounts after this row.
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
      // mirrors (and an existing wiring test pins it). A KEYED read walks the SAME raw layers: the
      // `teamModels` subtree answers with exactly what the workspace declares, so an absent block
      // reads as ABSENT (contract §2/§9) instead of being filled in by a default layer.
      if (key === undefined) return state.config
      return key.split(".").reduce((acc: any, part: string) => (acc == null ? undefined : acc[part]), state.config)
    },
    /**
     * The TOTAL resolution of one roster member's `teamModels` slot, read PER CALL from the live
     * state (contract amendment 1: this method never throws).
     *
     * This is the read a routing consumer (the roster's one-shot spawns, the workmate library, the
     * roster provider, the model-chain resolver) and every DISPLAY surface (`/mpd-model`, the Web
     * settings card) calls; a spawn applier converts a `status: "unconfigured" | "invalid"` answer
     * into the throwing `SLOT_UNCONFIGURED` failure, and nobody else does.
     * @param member - the roster member's functional name.
     * @returns the typed resolution: a usable route plus its fallbacks, or the reason it is unusable.
     */
    slotResolutionOf: (member: string): SlotResolution => resolveTeamModelSlot(member, state.config),
    /**
     * The configured route of one roster member, or `undefined` — TOTAL by the same rule.
     *
     * Kept beside {@link slotResolutionOf} because most callers only need the primary route and must
     * not care WHY a slot has none; `undefined` covers unconfigured, invalid and unrouted alike.
     * @param member - the roster member's functional name.
     * @returns the configured route, or `undefined` when this member has no usable slot route.
     */
    teamModelRouteOf: (member: string): TeamModelRoute | undefined => teamModelRouteOfMember(member, state.config),
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
      // The model-config knobs are live-refreshed (see `BridgeReport.applies`); a knob a plugin
      // captured at its own mount still waits for the next `dsh` boot, named per knob in §9.1.
      applies: "live",
    }),
  })

  dsh.registerTool({
    name: "mpd_config_get",
    description: "Read the resolved mpd.jsonc runtime config (project .mpd/mpd.jsonc merged over user $DSH_HOME/mpd.jsonc). Consumed keys: memory.vcs/memory.dir/memory.agentSlug/memory.reflectionEvery, team.gate/team.stateDir/team.sensitivity, captain.investigation, delegation.gate, hashline.guardEditTools/hashline.maxDiffChars/hashline.registryFile, commentChecker.autoCheck/commentChecker.bin/commentChecker.timeoutMs/commentChecker.maxMessageChars, modelchain.<chainKey>, boulder.dir, ulw.maxRounds/ulw.planDir/ulw.stateDir/ulw.provider/ulw.model/ulw.reviewerModel/ulw.maxReReviews, goal.enabled/goal.autoAnchor/goal.autoRounds, teamModels.slot1|slot2|slot3|slot4.provider/model/reasoningEffort/fallbacks.",
    parameters: { type: "object", properties: { key: { type: "string", description: "Optional dot-path to a single key, e.g. memory.vcs" } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { config: { type: "object" }, key: { type: "string" }, value: {} }, required: ["config"] }, render: (_a: unknown, v: any) => textBlock(v.key ? "mpd config " + v.key + ": " + JSON.stringify(v.value, null, 1) : "mpd config: " + JSON.stringify(v.config, null, 1)) },
    execute: async (args: any, exec: any) => {
      // Re-read with the CALLING SESSION's workspace so a project layer in the session
      // workspace is visible even when it differs from the dsh process cwd.
      reload(exec)
      // The diagnostic dump is the RAW resolved config (contract §9): an absent `teamModels` block
      // stays absent here — a display/tool read must show what the workspace declares, never a
      // materialised default layer. A caller that wants the typed slot state asks the service.
      const resolved = state.config
      // The dot-path argument, or undefined for a whole-config read.
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
      // The freshly resolved config, returned beside the file/error state consumers assert on.
      const cfg = reload(exec)
      return { files: state.files, errors: state.errors, config: cfg }
    }
  })

  // ── the ONE-TIME seed (contract §10): file initialization, never a runtime default ────────────
  /** Whether the seed still owes this process an attempt (it retries only while the catalog is down). */
  let seedPending = true
  /** Whether the catalog-unavailable line has been said once (the contract's "log once"). */
  let seedWarned = false

  /**
   * Seed all four slots into ONE workspace's project file from the catalog's flash-family model.
   *
   * Called at apply and retried by `reloadAt` while `seedPending` is set: the llm registry can mount
   * AFTER this row in a real boot, so a mount-time read may legitimately find no catalog — the
   * contract's degradation is "write nothing, log once, let the first spawn report
   * SLOT_UNCONFIGURED", and the retry is how a later catalog still gets the one seed in. The DURABLE
   * marker (`<ws>/.mpd/model-config-seed.json`) is consulted FIRST, so a workspace seeded once is
   * never seeded again — a deliberate deletion of the block stays deleted.
   * @param root - the workspace root whose project file is the seed target.
   */
  const seedAt = (root: string): void => {
    if (!seedPending) return
    /** The project file this root reads and the seed writes (the row's own override honoured). */
    const file = projectFileFor(root)
    /** The durable one-time marker for this workspace. */
    const marker = seedMarkerFor(root)
    // THE MARKER BEATS THE FILE STATE: a seeded-once workspace whose block was deleted on purpose
    // must not be re-seeded (contract §10 + the captain's F3).
    if (existsSync(marker)) {
      seedPending = false
      return
    }
    // A configured workspace costs NO catalog read at all: the block is the first guard after the
    // marker, exactly as `seedTeamModelsOnce` orders them.
    /** The project file's declaration state, read before any catalog work. */
    const declared = teamModelsDeclaredIn(file)
    if (declared === "declared") {
      seedPending = false
      return
    }
    if (declared === "unreadable") {
      seedPending = false
      if (!seedWarned) warn(`[mpd-config] could not seed ${file}: the project file does not parse — nothing was written`)
      seedWarned = true
      return
    }
    if (typeof dsh.llmCatalog !== "function") {
      seedPending = false
      if (!seedWarned) warn("[mpd-config] team-model slots are not configured and the adapter has no catalog seam — nothing was written; the first spawn reports SLOT_UNCONFIGURED")
      seedWarned = true
      return
    }
    // Fire-and-forget: the seed must never delay (or fail) the row's own activation.
    void Promise.resolve(dsh.llmCatalog()).then((catalog: SeedCatalogLike | undefined) => {
      /** The one attempt's decision, with the durable-marker protocol inside it. */
      const result = seedTeamModelsOnce(file, marker, catalog)
      // A missing catalog keeps the attempt PENDING so a later reload can still seed once; the
      // warning itself is said at most once per process (`seedWarned`).
      if (result.status === "no-catalog") {
        if (!seedWarned) warn("[mpd-config] team-model slots are not configured and the model catalog lists no deepseek-flash model — nothing was written; the first spawn reports SLOT_UNCONFIGURED")
        seedWarned = true
        return
      }
      seedPending = false
      // ONE line per process for a real write, naming the file and the durable marker beside it.
      if (result.status === "seeded") warn(`[mpd-config] seeded ${file} with all four team-model slots (provider=${result.route?.provider ?? "?"}, model=${result.route?.model ?? "?"}; slot1=max, slots 2-4=high) from the configured catalog — marked once in ${marker}`)
      else if (result.status === "unreadable") warn(`[mpd-config] could not seed ${file}: ${result.detail ?? "unreadable"} — nothing was written`)
    }).catch((error: unknown) => {
      seedPending = false
      if (!seedWarned) warn("[mpd-config] the model catalog read failed, so the one-time team-model seed wrote nothing: " + String((error as Error)?.message ?? error))
      seedWarned = true
    })
  }

  // One attempt for the mount-time root; `reloadAt` retries only while nothing was decided.
  seedAt(readRoot())
}
