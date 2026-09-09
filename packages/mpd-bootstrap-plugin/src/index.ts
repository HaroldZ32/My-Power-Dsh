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
import { fileURLToPath } from "node:url"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

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

function bundleRoot(): string {
  // Location-derived, no package-name resolution: this file lives at
  // <pkg-root>/packages/mpd-bootstrap-plugin/dist/index.js, so the package root
  // is four directories up. The skill corpus is <pkg-root>/skills and the
  // presets are <pkg-root>/presets (packed) or
  // <pkg-root>/packages/mpd-bootstrap-plugin/presets (checkout).
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

function harnessHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh")
}

function presetsSource(root: string): string {
  const packed = join(root, "presets")
  return existsSync(packed) ? packed : join(root, "packages", "mpd-bootstrap-plugin", "presets")
}

function warn(ctx: Ctx, message: string): void {
  try {
    if (ctx.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(message)
    else console.log("[mpd-bootstrap] " + message)
  } catch { /* logging must never fail provisioning */ }
}

// ── frontmatter parsing ─────────────────────────────────────────────────────
// The corpus is ours and its frontmatter is a deliberately small YAML subset
// (top-level scalars, one nested `metadata` mapping, optional block scalars).
// Parsing it here keeps the plugin dependency-free; packages/mpd-bootstrap-plugin/
// test/frontmatter.test.ts pins the subset against every shipped skill file.

type Frontmatter = { data: Record<string, unknown>; body: string }

function isAbsent(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

function parseFrontmatter(raw: string): Frontmatter | undefined {
  const firstLineEnd = raw.indexOf("\n")
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return undefined
  let lineStart = firstLineEnd + 1
  let closingStart = -1
  let bodyStart = -1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf("\n", lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      closingStart = lineStart
      bodyStart = nextNewline < 0 ? raw.length : nextNewline + 1
      break
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  if (closingStart < 0) return undefined
  return { data: parseYamlBlock(raw.slice(firstLineEnd + 1, closingStart)), body: raw.slice(bodyStart) }
}

function parseScalar(value: string): unknown {
  const text = value.trim()
  if (text === "") return ""
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try { return JSON.parse(text) as unknown } catch { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  const lower = text.toLowerCase()
  if (lower === "true" || lower === "yes" || lower === "on") return true
  if (lower === "false" || lower === "no" || lower === "off") return false
  if (lower === "null" || text === "~") return null
  if (/^-?\d+$/.test(text)) return Number(text)
  if (/^-?\d*\.\d+$/.test(text)) return Number(text)
  return text
}

function foldLines(lines: string[]): string {
  let out = ""
  for (const line of lines) {
    if (line === "") out += "\n"
    else out += (out === "" || out.endsWith("\n") ? "" : " ") + line
  }
  return out
}

function parseYamlBlock(text: string): Record<string, unknown> {
  const lines = text.split("\n")
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; map: Record<string, unknown> }> = [{ indent: -1, map: root }]
  let index = 0
  while (index < lines.length) {
    const raw = lines[index]
    index += 1
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.slice(indent)
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:[ \t]+(.*))?$/.exec(line)
    if (match === null) throw new Error("unsupported frontmatter line: " + line)
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].map
    const key = match[1]
    const rest = match[2] ?? ""
    if (rest.trim() === "") {
      let next: { indent: number; text: string } | undefined
      for (let probe = index; probe < lines.length; probe += 1) {
        const candidate = lines[probe]
        if (candidate.trim() === "" || candidate.trimStart().startsWith("#")) continue
        next = { indent: candidate.length - candidate.trimStart().length, text: candidate.trimStart() }
        break
      }
      if (next !== undefined && next.indent > indent && /^[A-Za-z0-9_][A-Za-z0-9_.-]*\s*:/.test(next.text)) {
        const child: Record<string, unknown> = {}
        parent[key] = child
        stack.push({ indent, map: child })
      } else parent[key] = null
      continue
    }
    const block = /^([|>])([+-]?)(\d*)$/.exec(rest.trim())
    if (block !== null) {
      const collected: string[] = []
      let blockIndent = -1
      while (index < lines.length) {
        const candidate = lines[index]
        if (candidate.trim() === "") { collected.push(""); index += 1; continue }
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent < 0) blockIndent = candidateIndent
        collected.push(candidate.slice(Math.min(blockIndent, candidateIndent)))
        index += 1
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop()
      const joined = block[1] === "|" ? collected.join("\n") : foldLines(collected)
      parent[key] = block[2] === "-" ? joined.replace(/\n+$/, "") : joined
      continue
    }
    parent[key] = parseScalar(rest)
  }
  return root
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === "boolean") return value
  if (value === 1 || value === "1") return true
  if (value === 0 || value === "0") return false
  if (typeof value === "string") {
    switch (value.toLowerCase()) {
      case "true": case "yes": case "on": return true
      case "false": case "no": case "off": return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function parseInvocation(data: Record<string, unknown>): { modelInvocable: boolean; userInvocable: boolean } {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) throw new Error(`frontmatter field "${legacy}" is unsupported; use "${legacy === "userInvocable" ? "user-invocable" : "disable-model-invocation"}"`)
  }
  return {
    modelInvocable: frontmatterBoolean(data, "disable-model-invocation") !== true,
    userInvocable: frontmatterBoolean(data, "user-invocable") !== false,
  }
}

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
function createProvider(root: string, ctx: Ctx, invalidate: () => void) {
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
  if (typeof ctx.on === "function") {
    ctx.on("fs/observed", (target: any, _observation: any, actor: any) => {
      const toolName = actor?.name
      if (toolName !== "edit" && toolName !== "write") return
      const displayPath = typeof target?.displayPath === "string" ? target.displayPath : undefined
      if (displayPath === undefined || !displayPath.startsWith(root)) return
      invalidate()
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
      let ids: string[] = []
      try {
        ids = readdirSync(presets).filter((id) => id === "mpd" || id.startsWith("mpd-"))
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
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  const root = bundleRoot()
  const corpus = config.skillsDir ? config.skillsDir : join(root, "skills")
  const presets = presetsSource(root)
  let version = "unknown"
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown" } catch { /* keep */ }

  if (config.skipSkills === true) {
    console.log("[mpd-bootstrap] skill corpus provider skipped (config)")
  } else {
    dsh.registerSkillProvider((control: any) =>
      createProvider(corpus, ctx, () => control?.invalidate?.()),
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
