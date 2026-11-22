// mpd-bootstrap: bundle asset provisioning for the @mpd-dsh/mpd bundle.
//
// Model (bundle >= 0.3.0): the bundle owns its assets by REFERENCE, never by
// copy, so ONE `dsh plugin add` installs the whole capability set and ONE
// `dsh plugin remove` uninstalls it with no residue in the harness home.
//   1) Skill corpus: this row registers a `ctx.skills` provider over
//      <bundle>/skills (rank BUNDLED_SKILL_RANK, source "bundled"), so the
//      corpus is visible exactly while the bundle is installed and disappears
//      when the row unloads — no $DSH_HOME/skills copy, no stale version stamp.
//   2) mpd preset: served from <bundle>/presets by the agent-presets root the
//      bundle patch configures (cordis.patch.yml) — no
//      $DSH_HOME/.agent-presets copy.
//   3) Legacy migration: version stamps identify old install directories. Matching
//      copies are moved out of the active roots into recoverable backups because the
//      stamps cannot prove the contents still match the old bundle.
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, unlinkSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { rowLogLine, DSH_SEAM_SKILLS, bundleRootOf, dshSeamInject, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { isAbsent, parseFrontmatter, parseInvocation, stringField, type Frontmatter } from "../../mpd-ext-plugin/src/skill-frontmatter"

/** Cordis plugin id; the bundle patch mounts this row as `mpd-bootstrap`, and the id is what an id-targeted override or unload addresses. */
export const name = "mpd-bootstrap"
// The skills registry is a host-plane service shipped by dsh-base; declaring it
// is a true hard dependency (this row's whole purpose is to contribute to it).
export const inject = dshSeamInject(DSH_SEAM_SKILLS)

/**
 * Row config, every key optional: the bundle patch mounts this row with NO config, so the
 * default is "serve the corpus and run the legacy migration". Each key only narrows that —
 * a different corpus directory, or one of the two cleanup halves.
 */
type Config = {
  /** Corpus directory override; defaults to <bundle>/skills. */
  skillsDir?: string
  /** Do not register the corpus skill provider. */
  skipSkills?: boolean
  /** Do not remove legacy preset copies from the harness home. */
  skipPresets?: boolean
  /** Do not remove legacy (<=0.2.6) home copies at all. */
  skipLegacyCleanup?: boolean
}

/** Structural ctx the row needs to stand alone in a unit test; every real harness SEAM is reached through the adapter, never through this type. */
type Ctx = { skills: any; logger?: any; on?: (event: string, fn: (...args: any[]) => any) => void; [k: string]: any }

/** Provider name registered on the skill registry; must be unique process-wide. */
const PROVIDER_NAME = "mpd-bundle"
/** Standard precedence rank for packaged skill providers (mirrors @deepseek-ai/dsh-skill). */
const BUNDLED_SKILL_RANK = 600
/** Public skill-name grammar (mirrors @deepseek-ai/dsh-skill). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// The bundle root is resolved by the shared helper (bundleRootOf): this file lives
// at <pkg-root>/packages/mpd-bootstrap-plugin/{src,dist}/index.ts|js, so the skill
// corpus is <pkg-root>/skills and the presets are <pkg-root>/presets in BOTH layouts.
const bundleRoot = (): string => bundleRootOf(import.meta.url)

/** Harness home containing the legacy installer markers and any recovery directories. */
function harnessHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh")
}

/** Directory READ to learn which preset ids this bundle ships — `<pkg-root>/presets`, with the pre-0.3.0 checkout spelling as a fallback; the migration never writes here. */
function presetsSource(root: string): string {
  // Both layouts ship presets at <pkg-root>/presets; keep the legacy checkout
  // fallback so an older working copy still resolves.
  const packed = join(root, "presets")
  return existsSync(packed) ? packed : join(root, "packages", "mpd-bootstrap-plugin", "presets")
}

/** Report one recoverable problem through the row logger, falling back to stdout; logging must never fail provisioning. */
function warn(ctx: Ctx, message: string): void {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    else rowLogLine("mpd-bootstrap", "[mpd-bootstrap] " + message)
  } catch { /* logging must never fail provisioning */ }
}

// ── frontmatter ─────────────────────────────────────────────────────────────
// The corpus frontmatter parser is SHARED with the extension skill plane
// (packages/mpd-ext-plugin/src/skill-frontmatter.ts): one implementation for
// the YAML subset, the name/description readers and the legacy-key refusal,
// so the bundle corpus and the extension corpus cannot drift apart. The subset
// stays pinned against every shipped SKILL.md by test/bootstrap.test.ts.


/** One corpus skill after frontmatter parsing: the provider-facing fields plus the trimmed body, with `metadata` kept only when it is a plain object. */
type ParsedSkill = {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  metadata?: Record<string, unknown>
  content: string
}

/** Read and parse one corpus `SKILL.md`; returns undefined (after a warning) for an unreadable file or invalid frontmatter, so one bad entry can never take the whole catalog down. */
async function readSkillFile(filePath: string, ctx: Ctx): Promise<ParsedSkill | undefined> {
  // Raw file text, declared separately so this call site can tell an absent file from a read failure.
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (isAbsent(error)) return undefined
    throw error
  }
  // Parsed frontmatter, or undefined when the file carries no `---` block at all.
  let parsed: Frontmatter | undefined
  try {
    parsed = parseFrontmatter(raw)
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: invalid frontmatter: ${String((error as Error)?.message ?? error)}`)
    return undefined
  }
  if (parsed === undefined) {
    warn(ctx, `skill file ${filePath} ignored: missing YAML frontmatter`)
    return undefined
  }
  // Frontmatter `name`; undefined is rejected below because the catalog addresses a skill by this key.
  const skillName = stringField(parsed.data, "name")
  // Frontmatter `description`; the corpus contract requires BOTH name and description.
  const description = stringField(parsed.data, "description")
  if (skillName === undefined || description === undefined) {
    warn(ctx, `skill file ${filePath} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!SKILL_NAME.test(skillName)) {
    warn(ctx, `skill file ${filePath} ignored: invalid skill name "${skillName}"`)
    return undefined
  }
  // Invocation policy as the SHARED parser resolves it: defaults applied, and a legacy key refused loudly.
  let invocation: { modelInvocable: boolean; userInvocable: boolean }
  try {
    invocation = parseInvocation(parsed.data)
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: ${String((error as Error)?.message ?? error)}`)
    return undefined
  }
  // Free-form metadata block; anything that is not a plain object is dropped rather than surfaced to the catalog.
  const metadata = parsed.data.metadata
  return {
    name: skillName,
    description,
    ...(stringField(parsed.data, "whenToUse") !== undefined ? { whenToUse: stringField(parsed.data, "whenToUse") as string } : {}),
    invocation,
    ...(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? { metadata: metadata as Record<string, unknown> } : {}),
    content: parsed.body.trim(),
  }
}

/** Corpus entries in the filesystem provider's shape: directory bundles + flat markdown files. */
async function listCorpus(root: string): Promise<Array<{ entry: string; locator: string; directory: string }>> {
  // Directory listing of the corpus root; an absent root means "not installed yet" and reads as an EMPTY corpus, not an error.
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: "utf8" })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
  // Entries in name order, so the published catalog does not depend on readdir order.
  const found: Array<{ entry: string; locator: string; directory: string }> = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".system") continue
    if (entry.isDirectory()) found.push({ entry: entry.name, locator: join(root, entry.name, "SKILL.md"), directory: join(root, entry.name) })
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push({ entry: entry.name, locator: join(root, entry.name), directory: root })
  }
  return found
}

/**
 * The bundled-corpus provider: read-only, lazily loaded, ranked below user roots.
 *
 * The return type is written out because the shape is the harness's provider contract
 * (`name`/`list`/`get`, declared as `SkillProvider` in packages/mpd-ext-plugin/src/skills.ts)
 * with ONE difference that matters: `list()` answers a BARE ARRAY here, which the harness reads
 * as complete and therefore CACHES, so an edited skill only comes back through the
 * `fs/observed` invalidation wired up below. Both member shapes are built from this package's
 * own `ParsedSkill` alias and repeated on the two methods, so each declaration states its
 * signature in full.
 */
function createProvider(root: string, ctx: Ctx, dsh: DshAdapter, invalidate: () => void): {
  /** Provider name the registry keys this corpus under; a duplicate name makes registration throw. */
  name: string
  /** One candidate per READABLE corpus entry and call, in name order; each is the parsed skill plus the locator `get()` needs. */
  list: () => Promise<Array<Omit<ParsedSkill, "content"> & {
    provider: string
    source: string
    rank: number
    locator: { path: string; directory: string }
    resourceBase: { kind: string; path: string }
    path: string
  }>>
  /** Full definition — the parsed skill plus `content` — for a candidate `list()` handed out; undefined when its locator no longer parses. */
  get: (candidate: any) => Promise<(Omit<ParsedSkill, "content"> & {
    provider: string
    source: string
    resourceBase: { kind: string; path: string }
    path?: string
    content: string
  }) | undefined>
} {
  // The provider object registered on the skills registry; `name` is fixed at module scope so a second registration is loud.
  const provider = {
    name: PROVIDER_NAME,
    /** Every readable corpus entry as a candidate, each ranked BUNDLED_SKILL_RANK so user and project roots still win. */
    async list(): Promise<Array<Omit<ParsedSkill, "content"> & {
      provider: string
      source: string
      rank: number
      locator: { path: string; directory: string }
      resourceBase: { kind: string; path: string }
      path: string
    }>> {
      // Candidates accumulated for this read; a file that fails to parse is SKIPPED by readSkillFile, never thrown.
      const candidates = []
      for (const entry of await listCorpus(root)) {
        // Parsed entry for this corpus file; undefined means it was skipped and warned about.
        const parsed = await readSkillFile(entry.locator, ctx)
        if (parsed === undefined) continue
        candidates.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
          invocation: parsed.invocation,
          provider: PROVIDER_NAME,
          source: "bundled",
          rank: BUNDLED_SKILL_RANK,
          locator: { path: entry.locator, directory: entry.directory },
          resourceBase: { kind: "directory", path: entry.directory },
          path: entry.locator,
          ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        })
      }
      return candidates
    },
    /** Load ONE definition from the locator the caller listed before; the candidate's own resource base is kept, and a fallback is derived from the locator when it is absent. */
    async get(candidate: any): Promise<(Omit<ParsedSkill, "content"> & {
      provider: string
      source: string
      resourceBase: { kind: string; path: string }
      path?: string
      content: string
    }) | undefined> {
      // Re-read of the located file: a skill that vanished or broke between list() and get() yields undefined, not a throw.
      const parsed = await readSkillFile(candidate?.locator?.path ?? "", ctx)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: "bundled",
        resourceBase: candidate.resourceBase ?? { kind: "directory", path: dirname(candidate?.locator?.path ?? "") },
        path: candidate?.locator?.path,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        content: parsed.content,
      }
    },
  }
  // Invalidate on a model-facing write inside the corpus so an edited skill is
  // re-read without a restart (same trigger the filesystem provider uses).
  //
  // The EVENT NAME is part of the harness's surface, so it is spelled inside
  // `mpd-dsh-adapter` (AGENTS.md §6) and reached through `dsh.onEvent`: a release that
  // renames `fs/observed` is then absorbed in ONE file instead of here. The handler keeps
  // its own containment — the adapter's `onEvent` is a passthrough, so a throw would
  // reach the bus.
  if (typeof dsh.onEvent === "function") {
    dsh.onEvent("fs/observed", (target: any, _observation: any, actor: any) => {
      try {
        // Actor name of the observation; only a model-facing edit/write may invalidate the cached catalog.
        const toolName = actor?.name
        if (toolName !== "edit" && toolName !== "write") return
        // Path the observation carries; the corpus check is a prefix test on it, so a path outside the corpus is ignored.
        const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined
        if (displayPath === undefined || !displayPath.startsWith(root)) return
        invalidate()
      } catch (error) {
        rowLogLine("mpd-bootstrap", "[mpd-bootstrap] fs/observed invalidation failed (the observation is unaffected): " + String((error as Error)?.message ?? error))
      }
    })
  }
  return provider
}

// ── legacy (<= 0.2.6) home-copy migration ───────────────────────────────────

/**
 * Move one stamped group out of its active scan root and consume its stamp only after every move.
 * Each same-filesystem rename preserves the whole tree or leaves its source in place, and a retry
 * skips already-absent sources. A fresh private directory avoids overwriting any past backup.
 */
function archiveLegacyGroup(ctx: Ctx, home: string, group: string, stampName: string, names: () => string[]): void {
  /** Active provider directory, which must be a directory in this home and not a symlink. */
  const active = join(home, group)
  if (!lstatSync(active, { throwIfNoEntry: false })?.isDirectory()) return
  /** Legacy marker beside the old copies, consumed independently for each group. */
  const stamp = join(active, stampName)
  if (!lstatSync(stamp, { throwIfNoEntry: false })?.isFile()) return
  /** A backup outside both scan roots, created only when there is something to move. */
  let backup: string | undefined
  for (const entry of names()) {
    /** Existing active entry; lstat also sees dangling symlinks, which rename preserves as links. */
    const source = join(active, entry)
    if (!lstatSync(source, { throwIfNoEntry: false })) continue
    backup ??= mkdtempSync(join(home, `.mpd-legacy-backup-${group.replace(/^\./, "")}-`))
    /** Recoverable location for this entry, with its original basename. */
    const destination = join(backup, entry)
    renameSync(source, destination)
    warn(ctx, `legacy copy archived: ${source} -> ${destination}`)
  }
  unlinkSync(stamp)
}

/** Archive stamped copies matching shipped skills and either shipped preset spelling. */
function cleanLegacyCopies(ctx: Ctx, root: string, config: Config): void {
  /** The home selected once for both halves of the migration. */
  const home = harnessHome()
  archiveLegacyGroup(ctx, home, "skills", ".mpd-skills-version", () => listCorpusSync(join(root, "skills")))
  if (config.skipPresets === true) return
  archiveLegacyGroup(ctx, home, ".agent-presets", ".mpd-presets-version", () => {
    /** Shipped preset location, using the older checkout layout when needed. */
    const presets = presetsSource(root)
    // The current patch-file layout and the older directory layout both name the same preset IDs.
    return [...new Set(readdirSync(presets)
      .map((entry) => (entry.endsWith(".patch.yml") ? entry.slice(0, -".patch.yml".length) : entry))
      .filter((id) => id === "mpd" || id.startsWith("mpd-")))]
  })
}

/** List shipped corpus entry names, never using a configured user corpus as migration evidence. */
function listCorpusSync(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.name !== ".system" && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".md"))))
    .map((entry) => entry.name)
}

// ── plugin entry ────────────────────────────────────────────────────────────

/**
 * Cordis entry point: serve the corpus BY REFERENCE first, then migrate the legacy home copies.
 *
 * Migration moves stamped names into private backups outside the search roots. Registration runs
 * first so a migration failure cannot cost a session its bundled corpus.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // Bundle root from this module's own location, so a checkout and a packed install resolve identically.
  const root = bundleRoot()
  // Corpus actually SERVED: the config override when given, else the bundle's own `skills/`.
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills")
  // Bundle version for the boot log line only; an unreadable package.json must not fail the apply.
  let version = "unknown"
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown" } catch { /* keep */ }

  if (config.skipSkills === true) {
    rowLogLine("mpd-bootstrap", "[mpd-bootstrap] skill corpus provider skipped (config)")
  } else {
    dsh.registerSkillProvider((control: any) =>
      createProvider(corpus, ctx, dsh, () => control?.invalidate?.()),
    )
    rowLogLine("mpd-bootstrap", "[mpd-bootstrap] skill corpus served from " + corpus + " (provider " + PROVIDER_NAME + ", bundle " + version + ")")
  }

  if (config.skipLegacyCleanup === true) {
    rowLogLine("mpd-bootstrap", "[mpd-bootstrap] legacy home-copy cleanup skipped (config)")
    return
  }
  try {
    cleanLegacyCopies(ctx, root, config)
  } catch (error) {
    warn(ctx, "legacy cleanup failed: " + String((error as Error)?.message ?? error))
  }
}
