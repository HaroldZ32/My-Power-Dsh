// Where the `mpd` agent preset's composition lives, under the 0.1.7-rc.2 ROW model.
//
// MEASURED MODEL CHANGE (harness 0.1.7-rc.2): `@deepseek-ai/dsh-agent-presets` is
// GONE. A preset is no longer a directory (`presets/mpd/{preset.yml,agent.cordis.yml}`)
// served from a root; it is an ordinary plugin ROW —
// `@deepseek-ai/dsh-agent-preset` with `config: { id, plugins: [<inline entry list>] }` —
// declared by one file of the root manifest's `dsh.bundle.patch` ARRAY.
//
// Cases that read "the mpd preset's composition" (to prove which rows the agent
// plane composes) must therefore follow that declaration, not a hardcoded path: a
// path that moves is a case that quietly asserts nothing. There is exactly ONE
// source of truth (the manifest the loader itself reads), and this helper is it.
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * The value of one own property of a parsed JSON document, as `unknown`.
 * @param value Any parsed JSON value.
 * @param key Property name to read.
 * @returns The property value, or `undefined` when `value` is not a non-null object.
 */
function fieldAt(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  // Narrowing above proves a non-null object; indexing by a dynamic key needs the record view.
  return (value as Record<string, unknown>)[key]
}

/**
 * The declared bundle patch files, in manifest order (string OR array declaration).
 * @param repoRoot Absolute path of the repository root that owns `package.json`.
 * @returns Absolute paths of the declared patch files; empty when none is declared or the manifest is unreadable.
 */
export function declaredBundlePatches(repoRoot: string): string[] {
  // The manifest's `dsh.bundle.patch` value, still untrusted and normalised just below.
  let raw: unknown
  try {
    // The manifest is the loader's own source of truth; it is read, never assumed present.
    const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    raw = fieldAt(fieldAt(fieldAt(manifest, "dsh"), "bundle"), "patch")
  } catch { return [] }
  // Both declaration shapes the manifest schema allows: one string, or an array of strings.
  const list: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, String(value)))
}

/**
 * The declared patch file(s) that really declare the `mpd` preset row.
 * @param repoRoot Absolute path of the repository root that owns `package.json`.
 * @returns Absolute paths of the declaring patch files; empty when no declared patch declares the preset.
 */
export function mpdPresetSourcePaths(repoRoot: string): string[] {
  return declaredBundlePatches(repoRoot).filter((file) => {
    // A declared-but-absent patch file declares nothing, so it is not a composition source.
    if (!existsSync(file)) return false
    return /^\s*-?\s*id:\s*preset-mpd\s*$/m.test(readFileSync(file, "utf8"))
  })
}

/**
 * The `mpd` preset's composition source bytes (the whole declaring patch file,
 * comments included — callers grep it for row ids and specifiers).
 * Empty string when NO declared patch declares the preset: a caller's assertions
 * then fail loudly instead of silently passing over an empty subject.
 * @param repoRoot Absolute path of the repository root that owns `package.json`.
 * @returns The concatenated bytes of every declaring patch file, newline-joined.
 */
export function readMpdPresetSource(repoRoot: string): string {
  return mpdPresetSourcePaths(repoRoot).map((file) => readFileSync(file, "utf8")).join("\n")
}
