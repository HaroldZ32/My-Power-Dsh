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
//      bundle patch configures (packages/mpd-bundle/cordis.patch.yml) — no
//      $DSH_HOME/.agent-presets copy.
//   3) Legacy migration: the version-stamped copies written by bundle <= 0.2.6
//      into $DSH_HOME/skills and $DSH_HOME/.agent-presets are removed on the
//      first boot of this version. Only entries this bundle stamped are touched;
//      user-authored skills/presets with other names are never removed.
//
// This row never writes to the harness home.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { bundleRootOf, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { isAbsent, parseFrontmatter, parseInvocation, stringField, type Frontmatter } from "../../mpd-ext-plugin/src/skill-frontmatter"

export const name = "mpd-bootstrap"
// The skills registry is a host-plane service shipped by dsh-base; declaring it
// is a true hard dependency (this row's whole purpose is to contribute to it).
export const inject = ["skills"]

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

function harnessHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh")
}

function presetsSource(root: string): string {
  // Both layouts ship presets at <pkg-root>/presets; keep the legacy checkout
  // fallback so an older working copy still resolves.
  const packed = join(root, "presets")
  return existsSync(packed) ? packed : join(root, "packages", "mpd-bootstrap-plugin", "presets")
}

function warn(ctx: Ctx, message: string): void {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    else console.log("[mpd-bootstrap] " + message)
  } catch { /* logging must never fail provisioning */ }
}

// ── frontmatter ─────────────────────────────────────────────────────────────
// The corpus frontmatter parser is SHARED with the extension skill plane
// (packages/mpd-ext-plugin/src/skill-frontmatter.ts): one implementation for
// the YAML subset, the name/description readers and the legacy-key refusal,
// so the bundle corpus and the extension corpus cannot drift apart. The subset
// stays pinned against every shipped SKILL.md by test/bootstrap.test.ts.


type ParsedSkill = {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  metadata?: Record<string, unknown>
  content: string
}

async function readSkillFile(filePath: string, ctx: Ctx): Promise<ParsedSkill | undefined> {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (isAbsent(error)) return undefined
    throw error
  }
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
  const skillName = stringField(parsed.data, "name")
  const description = stringField(parsed.data, "description")
  if (skillName === undefined || description === undefined) {
    warn(ctx, `skill file ${filePath} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!SKILL_NAME.test(skillName)) {
    warn(ctx, `skill file ${filePath} ignored: invalid skill name "${skillName}"`)
    return undefined
  }
  let invocation: { modelInvocable: boolean; userInvocable: boolean }
  try {
    invocation = parseInvocation(parsed.data)
  } catch (error) {
    warn(ctx, `skill file ${filePath} ignored: ${String((error as Error)?.message ?? error)}`)
    return undefined
  }
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
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: "utf8" })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
  const found: Array<{ entry: string; locator: string; directory: string }> = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".system") continue
    if (entry.isDirectory()) found.push({ entry: entry.name, locator: join(root, entry.name, "SKILL.md"), directory: join(root, entry.name) })
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push({ entry: entry.name, locator: join(root, entry.name), directory: root })
  }
  return found
}

/** The bundled-corpus provider: read-only, lazily loaded, ranked below user roots. */
function createProvider(root: string, ctx: Ctx, dsh: DshAdapter, invalidate: () => void) {
  const provider = {
    name: PROVIDER_NAME,
    async list() {
      const candidates = []
      for (const entry of await listCorpus(root)) {
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
    async get(candidate: any) {
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
        const toolName = actor?.name
        if (toolName !== "edit" && toolName !== "write") return
        const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined
        if (displayPath === undefined || !displayPath.startsWith(root)) return
        invalidate()
      } catch (error) {
        console.warn("[mpd-bootstrap] fs/observed invalidation failed (the observation is unaffected): " + String((error as Error)?.message ?? error))
      }
    })
  }
  return provider
}

// ── legacy (<= 0.2.6) home-copy migration ───────────────────────────────────

function removeIfPresent(target: string): boolean {
  if (!existsSync(target)) return false
  rmSync(target, { recursive: true, force: true })
  return true
}

/**
 * Remove the version-stamped copies bundle <= 0.2.6 wrote into the harness home.
 * The stamp file is the ownership proof: without it this function does nothing,
 * so a legacy install that never stamped (scripts/install-profile.mjs copies)
 * and user-authored content are both left untouched. Synchronous on purpose:
 * the migration must complete during apply, before any boot failure downstream
 * could abort the process mid-cleanup.
 */
function cleanLegacyCopies(ctx: Ctx, corpus: string, presets: string, config: Config): string[] {
  const removed: string[] = []
  const skillsStamp = join(harnessHome(), "skills", ".mpd-skills-version")
  if (existsSync(skillsStamp)) {
    for (const name of listCorpusSync(corpus)) {
      const target = join(harnessHome(), "skills", name)
      if (removeIfPresent(target)) removed.push(target)
    }
    removeIfPresent(skillsStamp)
  }
  if (config.skipPresets !== true) {
    const presetsStamp = join(harnessHome(), ".agent-presets", ".mpd-presets-version")
    if (existsSync(presetsStamp)) {
      // Preset IDs this bundle ships, in BOTH shipped shapes. Harness 0.1.7-rc.2 replaced the
      // directory model (`presets/<id>/preset.yml` + `agent.cordis.yml`) with ONE PATCH FILE per
      // preset (`presets/<id>.patch.yml`), so a raw `readdirSync` now yields `mpd.patch.yml` and
      // matched nothing — measured 2026-09-27: the legacy `$DSH_HOME/.agent-presets/mpd` copy
      // survived a boot that was supposed to remove it, and
      // `legacy home-copy migration > removes only stamped bundle copies and leaves user content
      // alone` went red. Both spellings are recognised here because the copies being migrated were
      // written under the OLD one and a later release could ship either.
      let ids: string[] = []
      try {
        ids = readdirSync(presets)
          .map((entry) => (entry.endsWith(".patch.yml") ? entry.slice(0, -".patch.yml".length) : entry))
          .filter((id) => id === "mpd" || id.startsWith("mpd-"))
      } catch { ids = [] }
      for (const id of ids) {
        const target = join(harnessHome(), ".agent-presets", id)
        if (removeIfPresent(target)) removed.push(target)
      }
      removeIfPresent(presetsStamp)
    }
  }
  for (const path of removed) warn(ctx, "legacy copy removed: " + path)
  return removed
}

/** Corpus entry names (directory bundles + flat markdown), synchronous twin of listCorpus. */
function listCorpusSync(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true, encoding: "utf8" })
      .filter((entry) => entry.name !== ".system" && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".md"))))
      .map((entry) => entry.name)
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
}

// ── plugin entry ────────────────────────────────────────────────────────────

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  const root = bundleRoot()
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills")
  const presets = presetsSource(root)
  let version = "unknown"
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown" } catch { /* keep */ }

  if (config.skipSkills === true) {
    console.log("[mpd-bootstrap] skill corpus provider skipped (config)")
  } else {
    dsh.registerSkillProvider((control: any) =>
      createProvider(corpus, ctx, dsh, () => control?.invalidate?.()),
    )
    console.log("[mpd-bootstrap] skill corpus served from " + corpus + " (provider " + PROVIDER_NAME + ", bundle " + version + ")")
  }

  if (config.skipLegacyCleanup === true) {
    console.log("[mpd-bootstrap] legacy home-copy cleanup skipped (config)")
    return
  }
  try {
    cleanLegacyCopies(ctx, corpus, presets, config)
  } catch (error) {
    warn(ctx, "legacy cleanup failed: " + String((error as Error)?.message ?? error))
  }
}
