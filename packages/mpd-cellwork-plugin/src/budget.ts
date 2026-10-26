// CELLWORK BUDGET — the measured context estimate behind the 1/4 rule (contract B6, plan §4.5).
//
// WHY A CONSERVATIVE ESTIMATOR. The deployment ships no tokenizer, and the harness's own
// four-characters-per-token heuristic is documented as underpricing CJK and JSON. This module therefore
// prices a task from numbers it can MEASURE or READ:
//   * the declared INPUT FILES are `stat`-ed and their first 16 KiB sampled, so a task that declares a
//     2 MB file is refused with real bytes rather than a hand-wave;
//   * the model's context window comes from the adapter's catalog projection
//     (`resolveModelInfo().context.contextWindow`) or from an explicit operator override — NEVER from a
//     literal in this file. A route whose window cannot be read is `uncertified`, not guessed;
//   * every ratio is a config knob (plan §4.5), so the arithmetic is auditable and tunable.
//
// THE ESTIMATE, verbatim from the plan:
//   estimate = fixedOverhead[route]
//            + ceil(asciiChars / asciiCharsPerToken) + ceil(cjkChars / cjkCharsPerToken)
//            + 4 * contentBlocks + 4
//            + measuredInputs
//            + ceil(toolSchemaChars / asciiCharsPerToken) + 4
//            + outputReserveTokens            (capped by the model's maxTokens when known)
// and the verdict:
//   budget  = floor(window * windowFraction)
//   ACCEPT iff estimate <= budget AND estimate + modelMaxTokens + compactionHeadroom <= window
//
// This file is PURE apart from `node:fs`: it takes a workspace root and a config object, so the whole
// arithmetic is unit-testable with an INJECTED window and no harness.
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CellworkConfig } from "./config"

/** UTF-8 bytes one CJK code point occupies — a property of the encoding, not a configurable ratio. */
const CJK_BYTES_PER_CHAR = 3

/** Bytes sampled from the head of each declared input file; the CJK ratio is taken from this sample. */
const SAMPLE_BYTES = 16384

/** One content block: the task's own prompt text, which is always present. */
const CONTENT_BLOCKS = 1

/** Harness structural overhead around the prompt (plan §4.5's `4 * contentBlocks + 4`). */
const STRUCTURAL_FRAMING_TOKENS = 4

/** Framing charged once per content block. */
const PER_BLOCK_FRAMING_TOKENS = 4

/** Framing charged once per declared input file. */
const PER_INPUT_FRAMING_TOKENS = 4

/** The character counts one text contributes to the estimate. */
export interface CharCounts {
  /** Characters priced by `asciiCharsPerToken`. */
  ascii: number
  /** Characters priced by `cjkCharsPerToken` — deliberately the punitive half. */
  cjk: number
}

/**
 * Whether one Unicode code point is charged at the CJK rate.
 *
 * @param codePoint - the code point from `codePointAt(0)`.
 * @returns true when the point belongs to a CJK block charged at the punitive rate.
 */
export function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x2eff) // CJK radicals supplement
    || (codePoint >= 0x3000 && codePoint <= 0x303f) // CJK symbols and punctuation
    || (codePoint >= 0x3040 && codePoint <= 0x30ff) // hiragana + katakana
    || (codePoint >= 0x3100 && codePoint <= 0x312f) // bopomofo
    || (codePoint >= 0x3400 && codePoint <= 0x4dbf) // CJK extension A
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff) // CJK unified ideographs
    || (codePoint >= 0xac00 && codePoint <= 0xd7af) // hangul syllables
    || (codePoint >= 0xf900 && codePoint <= 0xfaff) // CJK compatibility ideographs
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f) // CJK compatibility forms
    || (codePoint >= 0xff00 && codePoint <= 0xffef) // fullwidth forms
    || (codePoint >= 0x20000 && codePoint <= 0x2fa1f) // CJK extensions B..F
  )
}

/**
 * Count one string's characters in the two cost buckets.
 *
 * Iterates CODE POINTS (not UTF-16 units) so a supplementary ideograph is one character, matching how a
 * tokenizer sees it.
 *
 * @param text - the text to count.
 * @returns the ASCII-ish and CJK character counts.
 */
export function countChars(text: string): CharCounts {
  /** The running counts. */
  const counts: CharCounts = { ascii: 0, cjk: 0 }
  for (const character of text) {
    if (isCjkCodePoint(character.codePointAt(0) ?? 0)) counts.cjk += 1
    else counts.ascii += 1
  }
  return counts
}

/** One declared input file, measured rather than trusted. */
export interface InputMeasurement {
  /** The path exactly as the task declared it. */
  path: string
  /** The absolute path the read resolved to. */
  resolved: string
  /** File size in bytes, or 0 when the file could not be read. */
  bytes: number
  /** Bytes actually sampled from the head (at most {@link SAMPLE_BYTES}). */
  sampledBytes: number
  /** Share of the SAMPLED bytes belonging to CJK code points, in `[0, 1]`. */
  cjkRatio: number
  /** What this file is priced at, including its per-file framing. */
  tokens: number
  /** Why the file could not be measured, when it could not; absent on success. */
  error?: string
}

/**
 * Resolve one declared input path against the workspace, refusing anything outside it.
 *
 * Absolute declarations are accepted only when they stay inside the workspace: a split is agent-authored
 * input, and letting it read an arbitrary filesystem path would turn a budget check into a probe.
 *
 * @param workspace - the workspace root the caller resolved through the adapter.
 * @param declared - the path as written (relative paths resolve against the workspace).
 * @returns the absolute path, or the refusal reason.
 */
export function resolveInputPath(workspace: string, declared: string): { path: string; error?: string } {
  /** The trimmed declaration, so a stray newline cannot create a phantom path. */
  const trimmed = declared.trim()
  if (trimmed === "") return { path: "", error: "an input path is empty" }
  /** The absolute candidate. */
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(join(workspace, trimmed))
  /** The workspace-relative form, which is how containment is decided. */
  const rel = relative(workspace, absolute)
  if (rel.startsWith("..") || isAbsolute(rel)) return { path: absolute, error: "the input path is outside the workspace" }
  return { path: absolute }
}

/**
 * Measure one declared input file: size, CJK ratio of its head, and its priced tokens.
 *
 * The ratio is taken from at most {@link SAMPLE_BYTES} and applied to the WHOLE file: a file whose tail
 * is more CJK-heavy than its head will be underpriced, which is the declared ±25% bound the plan states.
 *
 * @param workspace - the workspace root declared paths resolve against.
 * @param declared - the path as the split declared it.
 * @param config - the resolved knobs, whose char-per-token ratios price the measured bytes.
 * @returns the measurement, carrying `error` instead of numbers when unreadable.
 */
export function measureInput(workspace: string, declared: string, config: CellworkConfig): InputMeasurement {
  /** The resolved path, or its containment refusal. */
  const resolvedPath = resolveInputPath(workspace, declared)
  if (resolvedPath.error !== undefined || resolvedPath.path === "") {
    return { path: declared, resolved: resolvedPath.path, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: resolvedPath.error ?? "the path could not be resolved" }
  }
  /** The absolute path being read. */
  const absolute = resolvedPath.path
  /** The file's size, read from the directory entry. */
  let bytes = 0
  try {
    /** The directory entry for the declared path. */
    const info = statSync(absolute)
    if (!info.isFile()) return { path: declared, resolved: absolute, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input is not a regular file" }
    bytes = info.size
  } catch (error) {
    return { path: declared, resolved: absolute, bytes: 0, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input cannot be read (" + errorText(error) + ")" }
  }
  /** How many bytes to sample from the head. */
  const wanted = Math.min(bytes, SAMPLE_BYTES)
  /** The sample buffer; empty when the file is empty. */
  const buffer = Buffer.alloc(wanted)
  /** How many bytes the read actually filled. */
  let filled = 0
  if (wanted > 0) {
    try {
      /** The file descriptor the sample is read through. */
      const fd = openSync(absolute, "r")
      try {
        filled = readSync(fd, buffer, 0, wanted, 0)
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      return { path: declared, resolved: absolute, bytes, sampledBytes: 0, cjkRatio: 0, tokens: 0, error: "the declared input cannot be sampled (" + errorText(error) + ")" }
    }
  }
  /** The CJK ratio of the sample, by BYTES, so it can scale the whole file's byte count. */
  const cjkRatio = cjkByteRatio(buffer.subarray(0, filled))
  /** The sample's ASCII bytes, scaled to the whole file. */
  const asciiBytes = bytes * (1 - cjkRatio)
  /** The sample's CJK bytes, scaled to the whole file. */
  const cjkBytes = bytes * cjkRatio
  /** The file's priced tokens: ASCII bytes are characters, CJK bytes become code points. */
  const tokens = Math.ceil(asciiBytes / config.asciiCharsPerToken) + Math.ceil((cjkBytes / CJK_BYTES_PER_CHAR) / config.cjkCharsPerToken) + PER_INPUT_FRAMING_TOKENS
  return { path: declared, resolved: absolute, bytes, sampledBytes: filled, cjkRatio, tokens }
}

/**
 * Measure the CJK share of one UTF-8 byte sample, by the byte length of each decoded code point.
 *
 * A trailing partial code point decodes to U+FFFD and is counted with the non-CJK bytes; that
 * misclassification affects at most one character of the sample and is reported through the ratio it
 * influences, not hidden.
 *
 * @param sample - the sampled bytes.
 * @returns the CJK byte share in `[0, 1]`, or 0 for an empty sample.
 */
export function cjkByteRatio(sample: Buffer): number {
  if (sample.length === 0) return 0
  /** The sample decoded as UTF-8 text. */
  const text = sample.toString("utf8")
  /** CJK bytes found in the sample. */
  let cjkBytes = 0
  /** Total bytes the decoded code points account for. */
  let totalBytes = 0
  for (const character of text) {
    /** The UTF-8 byte length of this code point. */
    const size = Buffer.byteLength(character, "utf8")
    totalBytes += size
    if (isCjkCodePoint(character.codePointAt(0) ?? 0)) cjkBytes += size
  }
  if (totalBytes === 0) return 0
  // Clamp: a decoding replacement can make the accounted bytes disagree with the buffer by a byte or
  // two, and a ratio outside [0,1] would misprice the file.
  return Math.min(1, Math.max(0, cjkBytes / totalBytes))
}

/** One task's measured estimate, with every term kept so a reader can audit the sum. */
export interface TaskEstimate {
  /** The route key the fixed overhead was priced under (`provider/model`, or "" when unrouted). */
  routeKey: string
  /** Characters of the task's own text. */
  textChars: CharCounts
  /** Tokens the text contributes. */
  textTokens: number
  /** Content blocks counted (the task's own prompt block). */
  contentBlocks: number
  /** Structural + per-block framing tokens. */
  framingTokens: number
  /** The fixed prompt/tool overhead this route pays. */
  fixedOverheadTokens: number
  /** The measured inputs, one entry per declared path. */
  inputs: InputMeasurement[]
  /** Sum of the inputs' priced tokens. */
  measuredInputsTokens: number
  /** Tokens charged for declared extra tool-schema characters. */
  toolSchemaTokens: number
  /** The output reserve actually charged (already capped by the model's max output when known). */
  outputReserveTokens: number
  /** The complete estimate. */
  estimate: number
}

/** What {@link estimateTask} needs: the task's text, its measured inputs, the route and its model. */
export interface EstimateInput {
  /** The task subject, which the model reads. */
  subject: string
  /** The task's acceptance text, which the model reads. */
  description: string
  /** The already-measured inputs, in declaration order. */
  inputs: readonly InputMeasurement[]
  /** The resolved knobs. */
  config: CellworkConfig
  /** The route key the fixed overhead is keyed by (`provider/model`). */
  routeKey: string
  /** The model's maximum output tokens when the catalog reported it, else null. */
  modelMaxTokens: number | null
}

/**
 * Price one task from its own text and its measured inputs.
 *
 * @param input - the task text, inputs and knobs.
 * @returns the estimate with every term retained.
 */
export function estimateTask(input: EstimateInput): TaskEstimate {
  /** The text the model reads for this task. */
  const text = input.subject + "\n" + input.description
  /** That text's character counts. */
  const textChars = countChars(text)
  /** The text's priced tokens. */
  const textTokens = Math.ceil(textChars.ascii / input.config.asciiCharsPerToken) + Math.ceil(textChars.cjk / input.config.cjkCharsPerToken)
  /** The fixed overhead for this route: a per-route override when configured, else the shared default. */
  const fixedOverheadTokens = input.config.fixedOverheadByRoute[input.routeKey] ?? input.config.fixedOverheadTokens
  /** The measured inputs' total; an entry carrying an error contributes nothing (the refuse happens above). */
  const measuredInputsTokens = input.inputs.reduce((sum, entry) => sum + (entry.error === undefined ? entry.tokens : 0), 0)
  /** The tool-schema term: declared extra schema characters, plus its structural framing. */
  const toolSchemaTokens = Math.ceil(input.config.toolSchemaChars / input.config.asciiCharsPerToken) + STRUCTURAL_FRAMING_TOKENS
  /** The output reserve, capped by the model's own maximum output when that is known and smaller. */
  const outputReserveTokens = input.modelMaxTokens !== null && input.modelMaxTokens > 0
    ? Math.min(input.config.outputReserveTokens, input.modelMaxTokens)
    : input.config.outputReserveTokens
  /** The framing the harness charges for the prompt envelope. */
  const framingTokens = PER_BLOCK_FRAMING_TOKENS * CONTENT_BLOCKS + STRUCTURAL_FRAMING_TOKENS
  return {
    routeKey: input.routeKey,
    textChars,
    textTokens,
    contentBlocks: CONTENT_BLOCKS,
    framingTokens,
    fixedOverheadTokens,
    inputs: [...input.inputs],
    measuredInputsTokens,
    toolSchemaTokens,
    outputReserveTokens,
    estimate: fixedOverheadTokens + textTokens + framingTokens + measuredInputsTokens + toolSchemaTokens + outputReserveTokens,
  }
}

/** How one task's window was certified, or why it could not be. */
export type WindowProvenance = "catalog" | "observed" | "override"

/** One route's window reading; `window` is null exactly when nothing could certify it. */
export interface WindowReading {
  /** The route's provider id, or "" when no route resolved. */
  provider: string
  /** The route's model id, or "". */
  model: string
  /** The readable context window, or null (NEVER a guessed number). */
  window: number | null
  /** How the window was obtained; `uncertified` means it was not. */
  provenance: WindowProvenance | "uncertified"
  /** The model's maximum output tokens when the catalog reported them, else null. */
  maxOutputTokens: number | null
  /** Why the window is uncertified; absent when it is certified. */
  reason?: string
}

/** The shape one route resolution must answer (mirrors `mpdConfig.agentRouteResolutionOf`). */
export interface RouteResolutionView {
  /** Whether the route is usable. */
  ok: boolean
  /** The resolved route, present when `ok`. */
  route?: { provider?: string; model?: string }
  /** Why it is unusable, when it is (the service's own sentence). */
  reason?: string
  /** The dotted leaves still missing, when the service named them. */
  missing?: readonly string[]
}

/** What {@link resolveTaskWindow} needs: the route service, the catalog reader and the knobs. */
export interface WindowDeps {
  /** Resolve one role's configured route; undefined when the route service is absent. */
  routeOf: (role: string) => RouteResolutionView | undefined
  /** The adapter's catalog projection; a rejecting read degrades to "no catalog". */
  catalog: () => Promise<Pick<DshLlmCatalog, "providers">>
  /** The resolved knobs (the override is the only certification path for an unreadable window). */
  config: CellworkConfig
}

/**
 * The route key the fixed overhead and the verdict are keyed by.
 *
 * @param reading - the route's window reading.
 * @returns `provider/model`, or "" when either half is missing.
 */
export function routeKeyOf(reading: WindowReading): string {
  return reading.provider === "" || reading.model === "" ? "" : reading.provider + "/" + reading.model
}

/**
 * Read the context window for one owner role's route.
 *
 * PRECEDENCE: the catalog's own `contextWindow` (provenance `catalog`), then the operator's
 * `windowOverride` (provenance `override`), then `uncertified`. There is deliberately NO third source: a
 * guessed window is worse than no verdict, because it looks like a measurement.
 *
 * @param deps - the route service, the catalog reader and the knobs.
 * @param role - the owner role whose `agentRoutes` entry decides the route.
 * @returns the reading; `window` is null when nothing certified it.
 */
export async function resolveTaskWindow(deps: WindowDeps, role: string): Promise<WindowReading> {
  /** The role's configured route, when the service answers. */
  const resolution = deps.routeOf(role)
  if (resolution === undefined) {
    return { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "the route service is absent in this composition, so no window is readable for role " + JSON.stringify(role) }
  }
  if (resolution.ok !== true) {
    /** The leaves the service said are missing, named so the caller knows what to configure. */
    const missing = resolution.missing === undefined ? "" : " (missing " + resolution.missing.join(", ") + ")"
    return { provider: "", model: "", window: null, provenance: "uncertified", maxOutputTokens: null, reason: "role " + JSON.stringify(role) + " has no usable route" + missing + (resolution.reason === undefined ? "" : "; " + resolution.reason) }
  }
  /** The resolved provider id. */
  const provider = typeof resolution.route?.provider === "string" ? resolution.route.provider : ""
  /** The resolved model id. */
  const model = typeof resolution.route?.model === "string" ? resolution.route.model : ""
  if (provider === "" || model === "") {
    return { provider, model, window: null, provenance: "uncertified", maxOutputTokens: null, reason: "role " + JSON.stringify(role) + " resolved to an incomplete route (provider " + JSON.stringify(provider) + ", model " + JSON.stringify(model) + ")" }
  }
  /** The catalog, or undefined when its read rejected. */
  let catalog: Pick<DshLlmCatalog, "providers"> | undefined
  try {
    catalog = await deps.catalog()
  } catch {
    catalog = undefined
  }
  if (catalog === undefined) {
    return overrideOrUncertified(provider, model, null, deps.config, "the model catalog could not be read")
  }
  /** The provider row for this route. */
  const providerRow = catalog.providers.find((row) => row.id === provider)
  /** The model row for this route. */
  const modelRow = providerRow?.models.find((row) => row.id === model)
  if (modelRow === undefined) {
    return overrideOrUncertified(provider, model, null, deps.config, "the model catalog lists no model " + JSON.stringify(model) + " for provider " + JSON.stringify(provider))
  }
  /** The max output the catalog reported, or null when it reported none. */
  const maxOutputTokens = typeof modelRow.maxOutputTokens === "number" && modelRow.maxOutputTokens > 0 ? modelRow.maxOutputTokens : null
  /** The context window the HARNESS resolved, or null. */
  const window = typeof modelRow.contextWindow === "number" && modelRow.contextWindow > 0 ? modelRow.contextWindow : null
  if (window !== null) return { provider, model, window, provenance: "catalog", maxOutputTokens }
  return overrideOrUncertified(provider, model, maxOutputTokens, deps.config, "the catalog reports no context window for " + provider + "/" + model)
}

/**
 * Decide the uncertified arm: the operator override certifies it, otherwise the reading stays null.
 *
 * @param provider - the route's provider id.
 * @param model - the route's model id.
 * @param maxOutputTokens - the catalog's max output, when it reported one.
 * @param config - the resolved knobs, read for `windowOverride`.
 * @param reason - why the catalog could not certify the window.
 * @returns the reading.
 */
function overrideOrUncertified(provider: string, model: string, maxOutputTokens: number | null, config: CellworkConfig, reason: string): WindowReading {
  if (config.windowOverride !== null) {
    return { provider, model, window: config.windowOverride, provenance: "override", maxOutputTokens }
  }
  return { provider, model, window: null, provenance: "uncertified", maxOutputTokens, reason: reason + "; set cellwork.windowOverride to certify this route" }
}

/** One task's budget verdict: the reading, the arithmetic and the decision. */
export interface BudgetVerdict {
  /** The readable window, or null when uncertified. */
  window: number | null
  /** How the window was obtained. */
  provenance: WindowProvenance | "uncertified"
  /** `floor(window * windowFraction)`, or null when uncertified. */
  budget: number | null
  /** The max-output used in the second condition (the catalog's, else the estimate's own reserve). */
  modelMaxTokens: number
  /** The compaction headroom the second condition requires. */
  compactionHeadroom: number
  /** Whether the estimate satisfies both conditions. */
  accepted: boolean
  /** How far the estimate exceeds the budget (or the whole-window condition); null when accepted. */
  excess: number | null
  /** Why the task was refused; absent when accepted. */
  reason?: string
}

/**
 * Apply the two acceptance conditions to one estimate.
 *
 * @param estimate - the task's measured estimate.
 * @param reading - the route's window reading.
 * @param config - the resolved knobs.
 * @returns the verdict.
 */
export function applyBudget(estimate: TaskEstimate, reading: WindowReading, config: CellworkConfig): BudgetVerdict {
  if (reading.window === null) {
    return {
      window: null,
      provenance: "uncertified",
      budget: null,
      modelMaxTokens: estimate.outputReserveTokens,
      compactionHeadroom: config.compactionHeadroomTokens,
      accepted: false,
      excess: null,
      reason: "uncertified: " + (reading.reason ?? "no readable context window"),
    }
  }
  /** The per-task budget the 1/4 rule allows. */
  const budget = Math.floor(reading.window * config.windowFraction)
  /** The max output the whole-window condition charges. */
  const modelMaxTokens = reading.maxOutputTokens !== null ? reading.maxOutputTokens : estimate.outputReserveTokens
  /** The room the estimate leaves after itself and the output reserve. */
  const reserveRoom = estimate.estimate + modelMaxTokens + config.compactionHeadroomTokens
  if (estimate.estimate > budget) {
    return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: false, excess: estimate.estimate - budget, reason: "the estimate exceeds the per-task budget" }
  }
  if (reserveRoom > reading.window) {
    return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: false, excess: reserveRoom - reading.window, reason: "the estimate plus the model's max output and the compaction headroom exceeds the whole window" }
  }
  return { window: reading.window, provenance: reading.provenance, budget, modelMaxTokens, compactionHeadroom: config.compactionHeadroomTokens, accepted: true, excess: null }
}

/**
 * A message from an unknown thrown value, without assuming it is an Error.
 *
 * @param error - the thrown value.
 * @returns its message text.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
