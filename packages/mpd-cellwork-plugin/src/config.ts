// Cell-work CONFIG — the ONE resolved read of the row's knobs.
//
// WHERE A KNOB COMES FROM. The row config (the bundle patch's `config:` block) is the composition
// truth, and `<ws>/.mpd/mpd.jsonc` under the `cellwork` key is the deployment's override. The merge is
// PER KEY with the FILE winning, which is how every other row in this bundle reads a knob; an absent,
// unreadable or nonsensical value falls back to the documented default instead of failing a boot.
//
// WHAT IS NOT A KNOB. The model's own context WINDOW is read at split time from the adapter's catalog
// projection and at runtime from the observed token meter — never from here, and never from a literal
// in source. `windowOverride` exists for exactly one purpose: a route whose window the catalog cannot
// report is `uncertified`, and an explicit operator override is the ONLY way to certify it (the record
// then says `override`). It is null by default, so nothing is ever budgeted against a guess.

/** The resolved budget and depth knobs a cell run uses. Every number is positive and finite. */
export interface CellworkConfig {
  /** Maximum nesting depth for sub-cells (`cellwork_subteam` refuses `depth + 1 > depthMax`). */
  depthMax: number
  /** The observed context ratio at which a member is checkpointed; `0.5` means half the window. */
  checkpointRatio: number
  /** The fraction of the window a single task's measured estimate may occupy (the "1/4 rule"). */
  windowFraction: number
  /** The measured fixed prompt/tool overhead every task pays before its own content, in tokens. */
  fixedOverheadTokens: number
  /**
   * Per-route fixed overhead overrides, keyed `provider/model`.
   *
   * The shared default is seeded from one measured session (28,544 tokens, shipped as 32,000). A route
   * that measures differently declares its own number here; an absent key falls back to the shared one.
   */
  fixedOverheadByRoute: Readonly<Record<string, number>>
  /**
   * Extra tool-schema characters a task declares beyond the measured fixed overhead.
   *
   * The fixed overhead is measured from a session that already carries the tool pack, so the default is
   * 0; a split that adds schemas on top of that pack declares their character count here.
   */
  toolSchemaChars: number
  /**
   * The gate commands each code task's frozen contract lists for its verifier.
   *
   * Empty by default: the contract then tells the verifier to run the repository's OWN declared gates,
   * which is the only honest instruction for a mode that also runs in projects this bundle does not own.
   */
  contractGates: readonly string[]
  /** The output budget reserved per task, capped by the model's own max output when known. */
  outputReserveTokens: number
  /** The harness compaction headroom a task must leave free besides its estimate and the output. */
  compactionHeadroomTokens: number
  /** How many bounded idle retries the post-handoff barrier makes before it reseeds the agent. */
  compactionRetries: number
  /** The idle retry interval, in milliseconds, of that barrier. */
  idleBarrierDelayMs: number
  /** ASCII characters a token is priced at; lower is more conservative. */
  asciiCharsPerToken: number
  /** CJK characters a token is priced at — deliberately punitive, since CJK tokenizers differ. */
  cjkCharsPerToken: number
  /** An operator-declared window for a route the catalog cannot report, or null (the honest default). */
  windowOverride: number | null
}

/** The shipped defaults; every one is a documented ratio in the plan, not a measured model window. */
export const DEFAULT_CELLWORK_CONFIG: CellworkConfig = {
  depthMax: 3,
  checkpointRatio: 0.5,
  windowFraction: 0.25,
  fixedOverheadTokens: 32000,
  fixedOverheadByRoute: {},
  toolSchemaChars: 0,
  contractGates: [],
  outputReserveTokens: 8192,
  compactionHeadroomTokens: 65536,
  compactionRetries: 3,
  idleBarrierDelayMs: 200,
  asciiCharsPerToken: 3,
  cjkCharsPerToken: 1,
  windowOverride: null,
}

/** The dotted prefix every cellwork knob lives under in `mpd.jsonc`. */
export const CELLWORK_CONFIG_PREFIX = "cellwork."

/** One knob's acceptance rule, so a bad value is refused at the boundary instead of silently used. */
interface KnobRule {
  /** Whether the value must be a whole number (token counts, depth) rather than any finite number. */
  integer: boolean
  /** The smallest value the knob accepts, INCLUSIVE. */
  min: number
  /** The largest value the knob accepts, INCLUSIVE. */
  max: number
}

/** The rule each numeric knob is validated against; a value outside its rule falls back to the default. */
const KNOB_RULES: Readonly<Record<string, KnobRule>> = {
  depthMax: { integer: true, min: 1, max: 8 },
  checkpointRatio: { integer: false, min: 0.01, max: 1 },
  windowFraction: { integer: false, min: 0.01, max: 1 },
  fixedOverheadTokens: { integer: true, min: 0, max: 10000000 },
  toolSchemaChars: { integer: true, min: 0, max: 100000000 },
  outputReserveTokens: { integer: true, min: 0, max: 1000000 },
  compactionHeadroomTokens: { integer: true, min: 0, max: 10000000 },
  compactionRetries: { integer: true, min: 1, max: 10 },
  idleBarrierDelayMs: { integer: true, min: 0, max: 10000 },
  asciiCharsPerToken: { integer: false, min: 0.5, max: 16 },
  cjkCharsPerToken: { integer: false, min: 0.5, max: 16 },
}

/**
 * Read one numeric knob, from the file first and the row config second, and validate it.
 *
 * A refused value is REPORTED rather than silently replaced: the whole point of the estimator is that
 * a number nobody meant is visible to the operator, and a fallback that logged nothing would hide the
 * typo that produced it.
 *
 * @param key - the knob's own name (the key inside the `cellwork` block).
 * @param row - the row config object, read as an untrusted record.
 * @param readFile - reads one `mpd.jsonc` value by its FULL dotted path; returns undefined when absent.
 * @param warn - the row's own log sink, called once per refused value.
 * @returns the accepted value, or the shipped default.
 */
function numberKnob(
  key: keyof CellworkConfig,
  row: Record<string, unknown>,
  readFile: (dottedKey: string) => unknown,
  warn: (line: string) => void,
): number {
  /** The declared default for this knob. */
  const fallback = DEFAULT_CELLWORK_CONFIG[key]
  if (typeof fallback !== "number") {
    // Every key routed here has a numeric default; a non-numeric one is a programming error, and the
    // estimator must never receive a non-number.
    throw new Error("cellwork config: " + String(key) + " has no numeric default")
  }
  /** The rule this knob is validated against. */
  const rule = KNOB_RULES[String(key)]
  if (rule === undefined) throw new Error("cellwork config: no rule for " + String(key))
  /** The file's value when it declared one, else the row's value, else undefined. */
  const declared = readFile(CELLWORK_CONFIG_PREFIX + String(key)) ?? row[String(key)]
  if (declared === undefined || declared === null) return fallback
  if (typeof declared !== "number" || !Number.isFinite(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + JSON.stringify(declared) + " is not a finite number; using the default " + String(fallback))
    return fallback
  }
  if (rule.integer && !Number.isInteger(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + String(declared) + " must be a whole number; using the default " + String(fallback))
    return fallback
  }
  if (declared < rule.min || declared > rule.max) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + String(key) + " = " + String(declared) + " is outside [" + String(rule.min) + ", " + String(rule.max) + "]; using the default " + String(fallback))
    return fallback
  }
  return declared
}

/**
 * Read the per-route fixed-overhead map: `provider/model` → non-negative whole tokens.
 *
 * Entries that are not a non-empty key with a non-negative whole number are DROPPED with one warning
 * each, because a mistyped route key would otherwise silently price a task under the shared default.
 *
 * @param row - the row config object, read as an untrusted record.
 * @param readFile - reads one `mpd.jsonc` value by its FULL dotted path.
 * @param warn - the row's own log sink, called once per refused entry.
 * @returns the accepted map, `{}` when nothing usable was declared.
 */
function overheadMapKnob(
  row: Record<string, unknown>,
  readFile: (dottedKey: string) => unknown,
  warn: (line: string) => void,
): Readonly<Record<string, number>> {
  /** The declared value, the file layer first. */
  const declared = readFile(CELLWORK_CONFIG_PREFIX + "fixedOverheadByRoute") ?? row.fixedOverheadByRoute
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return {}
  /** The accepted entries. */
  const accepted: Record<string, number> = {}
  for (const [route, value] of Object.entries(declared as Record<string, unknown>)) {
    if (route.trim() !== "" && typeof value === "number" && Number.isInteger(value) && value >= 0) {
      accepted[route.trim()] = value
    } else {
      warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "fixedOverheadByRoute[" + JSON.stringify(route) + "] = " + JSON.stringify(value) + " is not a non-negative whole token count; it is ignored")
    }
  }
  return accepted
}

/**
 * Read the contract gate list: trimmed non-empty strings.
 *
 * @param row - the row config object, read as an untrusted record.
 * @param readFile - reads one `mpd.jsonc` value by its FULL dotted path.
 * @param warn - the row's own log sink, called once when a declared list is unusable.
 * @returns the accepted gate commands, `[]` when nothing usable was declared.
 */
function gateListKnob(
  row: Record<string, unknown>,
  readFile: (dottedKey: string) => unknown,
  warn: (line: string) => void,
): readonly string[] {
  /** The declared value, the file layer first. */
  const declared = readFile(CELLWORK_CONFIG_PREFIX + "contractGates") ?? row.contractGates
  if (declared === undefined || declared === null) return []
  if (!Array.isArray(declared)) {
    warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "contractGates = " + JSON.stringify(declared) + " is not an array of commands; the frozen contracts will name the repository's own gates instead")
    return []
  }
  return declared.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim())
}

/**
 * Resolve the row's cellwork knobs: file override, row config, documented default — per key.
 *
 * @param rowConfig - the row's `config:` block, read as an untrusted record (may be undefined).
 * @param readFile - reads one `mpd.jsonc` path; the caller binds the config service, so this module
 *   never imports a service and stays pure enough to unit-test.
 * @param warn - the row's log sink, for refused values.
 * @returns the resolved knobs.
 */
export function resolveCellworkConfig(
  rowConfig: unknown,
  readFile: (dottedKey: string) => unknown,
  warn: (line: string) => void,
): CellworkConfig {
  /** The row config as a record; anything else is treated as empty rather than trusted. */
  const row: Record<string, unknown> = typeof rowConfig === "object" && rowConfig !== null && !Array.isArray(rowConfig)
    ? rowConfig as Record<string, unknown>
    : {}
  // The override is the one nullable knob: a null default means "no override", and only a positive
  // whole number is ever accepted as one.
  /** The declared override, if any. */
  const declaredOverride = readFile(CELLWORK_CONFIG_PREFIX + "windowOverride") ?? row.windowOverride
  /** The accepted override, or null when none was declared or the value is unusable. */
  let windowOverride: number | null = null
  if (declaredOverride !== undefined && declaredOverride !== null) {
    if (typeof declaredOverride === "number" && Number.isInteger(declaredOverride) && declaredOverride > 0) {
      windowOverride = declaredOverride
    } else {
      warn("[mpd-cellwork] " + CELLWORK_CONFIG_PREFIX + "windowOverride = " + JSON.stringify(declaredOverride) + " is not a positive whole number; no route will be certified from an override")
    }
  }
  return {
    depthMax: numberKnob("depthMax", row, readFile, warn),
    checkpointRatio: numberKnob("checkpointRatio", row, readFile, warn),
    windowFraction: numberKnob("windowFraction", row, readFile, warn),
    fixedOverheadTokens: numberKnob("fixedOverheadTokens", row, readFile, warn),
    fixedOverheadByRoute: overheadMapKnob(row, readFile, warn),
    toolSchemaChars: numberKnob("toolSchemaChars", row, readFile, warn),
    contractGates: gateListKnob(row, readFile, warn),
    outputReserveTokens: numberKnob("outputReserveTokens", row, readFile, warn),
    compactionHeadroomTokens: numberKnob("compactionHeadroomTokens", row, readFile, warn),
    compactionRetries: numberKnob("compactionRetries", row, readFile, warn),
    idleBarrierDelayMs: numberKnob("idleBarrierDelayMs", row, readFile, warn),
    asciiCharsPerToken: numberKnob("asciiCharsPerToken", row, readFile, warn),
    cjkCharsPerToken: numberKnob("cjkCharsPerToken", row, readFile, warn),
    windowOverride,
  }
}
