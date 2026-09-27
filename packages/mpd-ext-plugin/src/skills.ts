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

/** Harness skill-name grammar, compiled from the shared contract constant. */
export const SKILL_NAME = new RegExp(MPD_EXT_SKILL_NAME_PATTERN)

export interface SkillInvocation {
  modelInvocable: boolean
  userInvocable: boolean
}

export interface SkillDocument {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocation
  content: string
  resourceBase?: { kind: string; path: string }
  path?: string
  metadata?: Record<string, unknown>
}

/** One candidate plus the locator the provider needs to load its definition later. */
export interface SkillDocumentEntry {
  document: SkillDocument
  locator: Record<string, unknown>
  source: string
  rank: number
}

export interface SkillCandidate {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocation
  source: string
  provider: string
  rank: number
  locator: Record<string, unknown>
  path?: string
  resourceBase?: { kind: string; path: string }
}


// ── the corpus reader ───────────────────────────────────────────────────────

/** Read one SKILL.md into a document, or return a one-line reason why it was skipped. */
export function readSkillDocument(filePath: string): { document?: SkillDocument; error?: string } {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch (error) {
    if (isAbsent(error)) return { error: "cannot read " + filePath }
    return { error: "cannot read " + filePath + ": " + message(error) }
  }
  let parsed: Frontmatter | undefined
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    return { error: "invalid frontmatter in " + filePath + ": " + message(error) }
  }
  if (parsed === undefined) return { error: "missing YAML frontmatter in " + filePath }
  const skillName = stringField(parsed.data, "name")
  const description = stringField(parsed.data, "description")
  if (skillName === undefined) return { error: "frontmatter requires a non-empty name in " + filePath }
  if (description === undefined) return { error: "frontmatter requires a non-empty description in " + filePath }
  if (!SKILL_NAME.test(skillName)) return { error: `frontmatter name "${skillName}" violates the skill-name grammar in ` + filePath }
  let invocation: SkillInvocation
  try {
    invocation = parseInvocation(parsed.data)
  } catch (error) {
    return { error: message(error) + " in " + filePath }
  }
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
 */
export function candidateViolation(candidate: unknown, providerName: string): string | undefined {
  const value = candidate as Partial<SkillCandidate> | undefined
  if (value === null || typeof value !== "object") return "candidate is not an object"
  if (typeof value.name !== "string") return "candidate name is not a string"
  if (!SKILL_NAME.test(value.name)) return `invalid skill name "${value.name}"`
  if (typeof value.description !== "string") return `skill "${value.name}" has a non-string description`
  if (value.description.length === 0) return `skill "${value.name}" has an empty description`
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

/** Validate a definition before `get()` returns it (the harness validates it too). */
export function definitionViolation(definition: unknown, providerName: string, expectedName: string): string | undefined {
  const value = definition as (Partial<SkillDocument> & { provider?: string }) | undefined
  if (value === null || typeof value !== "object") return "definition is not an object"
  if (typeof value.name !== "string" || value.name !== expectedName) return `definition name does not match candidate "${expectedName}"`
  if (typeof value.description !== "string" || value.description.length === 0) return `definition "${expectedName}" has an empty description`
  if (typeof value.content !== "string") return `definition "${expectedName}" has non-string content`
  const invocation = value.invocation
  if (invocation === undefined || invocation === null) return `definition "${expectedName}" is missing its invocation`
  if (typeof invocation.modelInvocable !== "boolean" || typeof invocation.userInvocable !== "boolean") return `definition "${expectedName}" has a malformed invocation`
  if (value.provider !== undefined && value.provider !== providerName) return `definition "${expectedName}" carries provider "${value.provider}" instead of "${providerName}"`
  return undefined
}

export function candidateFor(entry: SkillDocumentEntry, providerName: string): SkillCandidate {
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

export interface SkillProviderOptions {
  name: string
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
  candidates: SkillCandidate[]
  complete: boolean
}

export interface SkillProvider {
  name: string
  list(options?: unknown): Promise<SkillCandidate[] | SkillObservation>
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
 */
export function createSkillProvider(options: SkillProviderOptions): SkillProvider {
  const emit = (listOptions: unknown): SkillObservation => {
    let entries: SkillDocumentEntry[]
    try {
      entries = options.entries(listOptions) as SkillDocumentEntry[]
    } catch (error) {
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
    const candidates: SkillCandidate[] = []
    const seen = new Set<string>()
    for (const entry of Array.isArray(entries) ? entries : []) {
      let candidate: SkillCandidate
      try {
        candidate = candidateFor(entry, options.name)
      } catch (error) {
        options.warn(`skill candidate dropped: ${message(error)}`)
        continue
      }
      const violation = candidateViolation(candidate, options.name)
      if (violation !== undefined) {
        options.warn(`skill candidate skipped: ${violation}`)
        options.onSkip?.(violation, candidate.name)
        continue
      }
      if (seen.has(candidate.name)) {
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
    async list(listOptions?: unknown) {
      try {
        return emit(listOptions)
      } catch (error) {
        const failure = `skill provider "${options.name}" list() failed: ${message(error)}`
        options.warn(failure)
        options.onSkip?.(failure)
        return { candidates: [], complete: false }
      }
    },
    async get(candidate: unknown, listOptions?: unknown) {
      try {
        const wanted = (candidate as Partial<SkillCandidate> | undefined)?.name
        if (typeof wanted !== "string") return undefined
        const entries = options.entries(listOptions) as SkillDocumentEntry[]
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.document?.name !== wanted) continue
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
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
  const fallback = `${base}-${Date.now().toString(36)}`
  taken.add(fallback)
  return fallback
}
