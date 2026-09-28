// mpd-ext-plugin skills plane.
//
// This is the sharpest seam in the extension interface: skill candidates are
// consumed by `ctx.skills.snapshot()`, which validates them OUTSIDE the
// try/catch that only wraps `provider.list()`, and the catalog is read
// UNGUARDED from every agent's pre-step. One malformed candidate would
// therefore break the pre-step of EVERY session in the process — so every
// candidate this provider emits is pre-validated against the harness rules
// (stricter: `invocation` is required, because the catalog dereferences
// `invocation.modelInvocable` without a guard) and a violating item is
// SKIPPED + WARNED per item, never emitted.
//
// The frontmatter parser below is a deliberately small YAML subset (top-level
// scalars, one nested mapping, optional block scalars) matching the corpus
// format; it keeps the plugin dependency-free.
import { readFileSync } from "node:fs"
import { MPD_EXT_SKILL_NAME_PATTERN } from "./sdk"
import { errorMessage as message } from "../../mpd-dsh-adapter-plugin/src/index"

import {
  isAbsent,
  parseFrontmatter,
  parseInvocation,
  stringField,
  type Frontmatter,
} from "./skill-frontmatter"

/**
 * Harness skill-name grammar, compiled from the shared contract constant in `./sdk`. It
 * carries no `g`/`y` flag, so `test()` is stateless and safe to reuse across candidates.
 */
export const SKILL_NAME = new RegExp(MPD_EXT_SKILL_NAME_PATTERN)

/**
 * The invocation booleans a candidate/definition carries. The same shape as
 * `InvocationBooleans` in `./skill-frontmatter` (which declares it structurally to avoid
 * importing back here), so a parser result assigns without a cast.
 */
export interface SkillInvocation {
  /** Whether the model may see and invoke this skill; false only for `disable-model-invocation: true`. */
  modelInvocable: boolean
  /** Whether the user may invoke this skill directly; false only for `user-invocable: false`. */
  userInvocable: boolean
}

/**
 * One fully parsed skill document — the corpus/extension shape, before it is projected into
 * the harness's candidate or definition shape.
 */
export interface SkillDocument {
  /** The frontmatter `name`, which IS the identity (never the containing directory name). */
  name: string
  /** The frontmatter `description`; non-empty, or `readSkillDocument` refuses the file. */
  description: string
  /** Optional model-facing routing hint, present only when the frontmatter had a non-empty one. */
  whenToUse?: string
  /** Both booleans, always present: the harness catalog dereferences them without a guard. */
  invocation: SkillInvocation
  /** The markdown body with the frontmatter stripped and then trimmed. */
  content: string
  /** Asset the document lives in (`{ kind: "directory", path }` for a skill directory), set by the caller that enumerated it. */
  resourceBase?: { kind: string; path: string }
  /** Absolute path of the SKILL.md the document was read from, set by the caller that enumerated it. */
  path?: string
  /** The nested `metadata:` map, kept only when the parser produced a plain object. */
  metadata?: Record<string, unknown>
}

/** One candidate plus the locator the provider needs to load its definition later. */
export interface SkillDocumentEntry {
  /** The parsed document this entry hands to `candidateFor`/`get()`. */
  document: SkillDocument
  /** Opaque harness lookup payload: `{ kind: "skill", ... }` for a SKILL.md, `{ kind: "flow", ... }` for a rendered flow. */
  locator: Record<string, unknown>
  /** Provenance of the asset: the `mpd-ext.json` path for a directory-plane extension, or `register()` for a descriptor registered from code. */
  source: string
  /** Precedence in the catalog: a lower rank wins inside a layer (extension default 300). */
  rank: number
}

/**
 * The candidate shape `list()` returns and the harness validates. Its fields are the
 * document's plus the provider/provenance facts the harness needs to rank and load it.
 */
export interface SkillCandidate {
  /** The frontmatter `name`; the harness catalog key and the identity a consumer asks `get()` for. */
  name: string
  /** The frontmatter `description`; a candidate with an empty one is skipped, never emitted. */
  description: string
  /** Optional routing hint, forwarded only when the document carries one. */
  whenToUse?: string
  /** A COPY of the document's booleans, so a consumer cannot mutate the entry a later `list()` rebuilds. */
  invocation: SkillInvocation
  /** Provenance label copied from the entry, surfaced by `mpd_ext_list`/`mpd_ext_show`. */
  source: string
  /** The registered provider name that emitted this candidate; pre-validation insists it equals that provider's own name. */
  provider: string
  /** Precedence in the catalog: a lower rank wins inside a layer. */
  rank: number
  /** The entry's opaque locator, forwarded verbatim for the harness's later `get()`. */
  locator: Record<string, unknown>
  /** The SKILL.md path when the entry has one; an explicit `undefined` key is never emitted. */
  path?: string
  /** The asset base when the entry has one; an explicit `undefined` key is never emitted. */
  resourceBase?: { kind: string; path: string }
}


// ── the corpus reader ───────────────────────────────────────────────────────

/**
 * Read one SKILL.md into a document, or return a one-line reason why it was skipped.
 *
 * This is the EXTENSION PLANE's enforcement on top of the shared parser
 * (`./skill-frontmatter`): the frontmatter must carry a non-empty `name` and `description`,
 * the `name` must satisfy the harness grammar `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and the
 * invocation keys must not use a retired spelling. The DIRECTORY name is never consulted —
 * identity is the frontmatter `name`; the enumerator uses the directory only as a locator
 * and as its error label.
 * @param filePath Absolute path of the SKILL.md to read.
 * @returns `{ document }` on success, or `{ error }` with ONE line saying why: `cannot read …`
 *   (with the errno message for a failure that is not ENOENT/ENOTDIR), `invalid frontmatter
 *   in …: <message>` for a block that exists but is outside the subset, `missing YAML
 *   frontmatter in …` for no complete block, `frontmatter requires a non-empty name in …`,
 *   `frontmatter requires a non-empty description in …`, `frontmatter name "…" violates the
 *   skill-name grammar in …`, or the invocation refusal text. Never throws.
 */
export function readSkillDocument(filePath: string): { document?: SkillDocument; error?: string } {
  // Whole file text, read once; every later failure is a parse or validation verdict.
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch (error) {
    if (isAbsent(error)) return { error: "cannot read " + filePath }
    return { error: "cannot read " + filePath + ": " + message(error) }
  }
  // The parser result, or the reason a malformed block was refused; undefined means no block.
  let parsed: Frontmatter | undefined
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    return { error: "invalid frontmatter in " + filePath + ": " + message(error) }
  }
  if (parsed === undefined) return { error: "missing YAML frontmatter in " + filePath }
  // Frontmatter identity — the directory name is never consulted for it.
  const skillName = stringField(parsed.data, "name")
  // Non-empty description, required by this plane and shown by the harness catalog.
  const description = stringField(parsed.data, "description")
  if (skillName === undefined) return { error: "frontmatter requires a non-empty name in " + filePath }
  if (description === undefined) return { error: "frontmatter requires a non-empty description in " + filePath }
  if (!SKILL_NAME.test(skillName)) return { error: `frontmatter name "${skillName}" violates the skill-name grammar in ` + filePath }
  // Both booleans, from the invocation keys; the catalog dereferences them unguarded.
  let invocation: SkillInvocation
  try {
    invocation = parseInvocation(parsed.data)
  } catch (error) {
    return { error: message(error) + " in " + filePath }
  }
  // Optional nested map; kept only when it really is a plain object.
  const metadata = parsed.data.metadata
  return {
    document: {
      name: skillName,
      description,
      ...(stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") as string } : {}),
      invocation,
      content: parsed.body.trim(),
      ...(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? { metadata: metadata as Record<string, unknown> }
        : {}),
    },
  }
}

// ── candidate pre-validation (stricter than the harness on purpose) ──────────

/**
 * Return a one-line reason when a candidate must not be emitted, else undefined.
 *
 * The harness's own `validateCandidate` treats `invocation` as optional, but the
 * model-facing catalog dereferences `invocation.modelInvocable` with no guard,
 * so a candidate without it throws inside EVERY session's pre-step. Being
 * stricter here is the whole point of this function.
 * @param candidate The value about to be emitted; `unknown` because a caller-supplied or
 *   partially built object is exactly what must be checked, not trusted.
 * @param providerName The provider emitting it; a candidate bearing another provider's name
 *   would let one extension's skills masquerade as another's.
 * @returns The refusal text, or `undefined` when every rule the catalog relies on holds.
 */
export function candidateViolation(candidate: unknown, providerName: string): string | undefined {
  // The candidate as the shape this validator reads; a non-object falls out on the null test.
  const value = candidate as Partial<SkillCandidate> | undefined
  if (value === null || typeof value !== "object") return "candidate is not an object"
  if (typeof value.name !== "string") return "candidate name is not a string"
  if (!SKILL_NAME.test(value.name)) return `invalid skill name "${value.name}"`
  if (typeof value.description !== "string") return `skill "${value.name}" has a non-string description`
  if (value.description.length === 0) return `skill "${value.name}" has an empty description`
  // The booleans the catalog dereferences without a guard — hence the strict check below.
  const invocation = value.invocation
  if (invocation === undefined || invocation === null || typeof invocation !== "object") {
    return `skill "${value.name}" is missing its invocation booleans`
  }
  if (typeof invocation.modelInvocable !== "boolean" || typeof invocation.userInvocable !== "boolean") {
    return `skill "${value.name}" invocation must carry boolean modelInvocable and userInvocable`
  }
  if (value.whenToUse !== undefined && typeof value.whenToUse !== "string") return `skill "${value.name}" has a non-string whenToUse`
  if (typeof value.source !== "string") return `skill "${value.name}" has a non-string source`
  if (typeof value.rank !== "number" || !Number.isFinite(value.rank)) return `skill "${value.name}" has a non-finite rank`
  if (typeof value.provider !== "string") return `skill "${value.name}" has a non-string provider`
  if (value.provider !== providerName) return `skill "${value.name}" carries provider "${value.provider}" instead of "${providerName}"`
  if (value.path !== undefined && typeof value.path !== "string") return `skill "${value.name}" has a non-string path`
  return undefined
}

/**
 * Validate a definition before `get()` returns it (the harness validates it too).
 * @param definition The assembled definition, `unknown` for the same reason as a candidate:
 *   it is what must be proven before it leaves this provider.
 * @param providerName The provider returning it; a mismatched provider field is refused.
 * @param expectedName The name the candidate asked for; a definition answering a different
 *   name would silently serve the wrong skill.
 * @returns The refusal text, or `undefined` when the definition is safe to return.
 */
export function definitionViolation(definition: unknown, providerName: string, expectedName: string): string | undefined {
  // The definition plus the optional provider field the registry may have added.
  const value = definition as (Partial<SkillDocument> & { provider?: string }) | undefined
  if (value === null || typeof value !== "object") return "definition is not an object"
  if (typeof value.name !== "string" || value.name !== expectedName) return `definition name does not match candidate "${expectedName}"`
  if (typeof value.description !== "string" || value.description.length === 0) return `definition "${expectedName}" has an empty description`
  if (typeof value.content !== "string") return `definition "${expectedName}" has non-string content`
  // Present-but-partial is refused: both booleans must be boolean, as the harness expects.
  const invocation = value.invocation
  if (invocation === undefined || invocation === null) return `definition "${expectedName}" is missing its invocation`
  if (typeof invocation.modelInvocable !== "boolean" || typeof invocation.userInvocable !== "boolean") return `definition "${expectedName}" has a malformed invocation`
  if (value.provider !== undefined && value.provider !== providerName) return `definition "${expectedName}" carries provider "${value.provider}" instead of "${providerName}"`
  return undefined
}

/**
 * Project one entry's document into the candidate a provider's `list()` returns. The
 * invocation object is COPIED so a consumer cannot mutate the entry that the next `list()`
 * rebuilds from, and the optional fields are spread conditionally because an explicit
 * `undefined` key is not the same thing to a strict consumer as an absent one.
 * @param entry The enumerated document entry to project.
 * @param providerName The provider emitting it; it becomes `candidate.provider`.
 * @returns The candidate, with `source`, `rank` and `locator` taken from the entry.
 */
export function candidateFor(entry: SkillDocumentEntry, providerName: string): SkillCandidate {
  // The parsed document, read once so every field below comes from the same snapshot.
  const document = entry.document
  return {
    name: document.name,
    description: document.description,
    ...(document.whenToUse === undefined ? {} : { whenToUse: document.whenToUse }),
    invocation: { ...document.invocation },
    source: entry.source,
    provider: providerName,
    rank: entry.rank,
    locator: entry.locator,
    ...(document.path === undefined ? {} : { path: document.path }),
    ...(document.resourceBase === undefined ? {} : { resourceBase: document.resourceBase }),
  }
}

// ── the provider ────────────────────────────────────────────────────────────

/**
 * Everything `createSkillProvider` needs from its owner. The owner supplies `entries`
 * because discovery differs per plane (an extension skills root, the per-call project plane,
 * a code-registered descriptor) while validation and failure policy do not.
 */
export interface SkillProviderOptions {
  /** The provider name registered with the harness; unique process-wide by construction. */
  name: string
  /** Host warning sink; every skip and every failure is reported here, never thrown. */
  warn: (message: string) => void
  /** Called per skipped candidate so the owning extension can record the reason. */
  onSkip?: (reason: string, name?: string) => void
  /** Called per `list()`/`get()` with the caller's lookup options (never cached). */
  entries: (listOptions: unknown) => SkillDocumentEntry[] | Promise<SkillDocumentEntry[]>
}

/**
 * The harness's provider-observation shape (`normalizeProviderObservation`,
 * H/dsh-skill/lib/index.js:414-426). It matters which of the two an
 * implementation returns: an ARRAY is read as `{candidates, complete:true}` and
 * the result is then CACHED per `(cwd, scope, revision)`, while `complete:false`
 * is never cached and suppresses publication, so the consumer keeps the last good
 * catalog and retries at its next request boundary.
 */
export interface SkillObservation {
  /** The candidates this observation carries; empty on a failed enumeration, never stale ones. */
  candidates: SkillCandidate[]
  /** True only for a full enumeration; false suppresses publication and caching, so the next request retries. */
  complete: boolean
}

/**
 * The provider shape the harness observes: `list()` may answer with an ARRAY (read as
 * `{candidates, complete: true}`) or with an explicit observation, and `get()` resolves one
 * candidate by name. Both are promises because a plane may enumerate asynchronously.
 */
export interface SkillProvider {
  /** Provider identity; the harness keys its catalog cache on it, so a name is never reused. */
  name: string
  /** List candidates for a caller's lookup options; an incomplete observation is never cached. */
  list(options?: unknown): Promise<SkillCandidate[] | SkillObservation>
  /** Resolve one candidate to its full definition, or undefined when it is not this provider's. */
  get(candidate: unknown, options?: unknown): Promise<Record<string, unknown> | undefined>
}

/**
 * Build the provider for ONE extension (or for the per-call project plane).
 *
 * Nothing here throws: a discovery failure yields an EMPTY, explicitly
 * INCOMPLETE observation, a violating candidate is skipped and warned per item,
 * and a definition that fails its own re-validation is dropped. Provider NAMES are
 * allocated by the caller and are unique by construction; a duplicate name would
 * make the harness throw at registration, which is why registration is wrapped on
 * the caller's side.
 * @param options The owner-provided name, warning sink, skip record and enumeration callback.
 * @returns A provider whose `list()` and `get()` resolve instead of rejecting — the
 *   never-crash contract this plugin states in its README.
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProvider {
  // Enumerate once and pre-validate every candidate, so the harness never sees one that
  // would break a session's pre-step; skips are warned per item and never abort the list.
  const emit = (listOptions: unknown): SkillObservation => {
    // The owner's enumeration result; a throw is handled just below as an incomplete result.
    let entries: SkillDocumentEntry[]
    try {
      entries = options.entries(listOptions) as SkillDocumentEntry[]
    } catch (error) {
      // The one-line reason recorded on the extension and warned, never thrown.
      const failure = `skill enumeration failed: ${message(error)}`
      options.warn(failure)
      options.onSkip?.(failure)
      // `complete:false` is load-bearing, not decoration: an ARRAY here would be
      // read as a COMPLETE observation and CACHED for this `(cwd, scope)` until a
      // registration change or a restart, so ONE transient enumeration failure
      // would hide this provider's skills for the rest of the session even after
      // the filesystem recovered. An incomplete observation is never cached, so
      // the next request boundary retries.
      return { candidates: [], complete: false }
    }
    // The candidates that passed validation, in enumeration order and name-unique.
    const candidates: SkillCandidate[] = []
    // Names already emitted, so a duplicate inside one provider is skipped, not silently doubled.
    const seen = new Set<string>()
    for (const entry of Array.isArray(entries) ? entries : []) {
      // Built from the entry; a build failure drops this entry only and keeps the rest.
      let candidate: SkillCandidate
      try {
        candidate = candidateFor(entry, options.name)
      } catch (error) {
        options.warn(`skill candidate dropped: ${message(error)}`)
        continue
      }
      // undefined means the candidate satisfies every rule the catalog will rely on.
      const violation = candidateViolation(candidate, options.name)
      if (violation !== undefined) {
        options.warn(`skill candidate skipped: ${violation}`)
        options.onSkip?.(violation, candidate.name)
        continue
      }
      if (seen.has(candidate.name)) {
        // The refusal text for a name this provider already emitted.
        const duplicate = `duplicate name "${candidate.name}" inside provider "${options.name}"`
        options.warn(`skill candidate skipped: ${duplicate}`)
        options.onSkip?.(duplicate, candidate.name)
        continue
      }
      seen.add(candidate.name)
      candidates.push(candidate)
    }
    return { candidates, complete: true }
  }

  return {
    name: options.name,
    /**
     * List this provider's candidates; resolves to an explicit observation. An unexpected
     * failure degrades to the same EMPTY, INCOMPLETE observation the enumeration callback
     * produces, so one bad call cannot break a session's pre-step.
     */
    async list(listOptions?: unknown): Promise<SkillCandidate[] | SkillObservation> {
      try {
        return emit(listOptions)
      } catch (error) {
        // A `list()`-level failure is reported and degraded, never propagated to the harness.
        const failure = `skill provider "${options.name}" list() failed: ${message(error)}`
        options.warn(failure)
        options.onSkip?.(failure)
        return { candidates: [], complete: false }
      }
    },
    /**
     * Resolve one candidate by name, re-validating the definition before returning it.
     * Returns undefined for an unknown name, for a definition that fails that re-validation,
     * and for any unexpected failure — the harness treats all three the same way.
     */
    async get(candidate: unknown, listOptions?: unknown): Promise<Record<string, unknown> | undefined> {
      try {
        // The name asked for; anything but a string cannot identify a candidate.
        const wanted = (candidate as Partial<SkillCandidate> | undefined)?.name
        if (typeof wanted !== "string") return undefined
        // Re-enumerated per call, so an edited SKILL.md is picked up at the next request boundary.
        const entries = options.entries(listOptions) as SkillDocumentEntry[]
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.document?.name !== wanted) continue
          // The full definition in the harness shape; `content` is the document body, not the file.
          const definition: Record<string, unknown> = {
            name: entry.document.name,
            description: entry.document.description,
            ...(entry.document.whenToUse === undefined ? {} : { whenToUse: entry.document.whenToUse }),
            invocation: { ...entry.document.invocation },
            source: entry.source,
            provider: options.name,
            content: entry.document.content,
            ...(entry.document.path === undefined ? {} : { path: entry.document.path }),
            ...(entry.document.resourceBase === undefined ? {} : { resourceBase: entry.document.resourceBase }),
            ...(entry.document.metadata === undefined ? {} : { metadata: entry.document.metadata }),
          }
          // A definition that no longer validates is dropped, never returned half-checked.
          const violation = definitionViolation(definition, options.name, wanted)
          if (violation !== undefined) {
            options.warn(`skill definition skipped: ${violation}`)
            return undefined
          }
          return definition
        }
        return undefined
      } catch (error) {
        options.warn(`skill provider "${options.name}" get() failed: ${message(error)}`)
        return undefined
      }
    },
  }
}

/** Allocate a process-unique provider name, numeric suffix on collision. */
export function allocateProviderName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) {
    taken.add(base)
    return base
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    // The next free name in the numeric-suffix sequence.
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  // Last resort when every numeric suffix is taken: a base36 timestamp separates the name in
  // practice. It is NOT re-checked against `taken`, so two calls in the same millisecond with
  // the same base would return one name twice — registration is what still refuses that.
  const fallback = `${base}-${Date.now().toString(36)}`
  taken.add(fallback)
  return fallback
}
