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

/** The declared bundle patch files, in manifest order (string OR array declaration). */
export function declaredBundlePatches(repoRoot) {
  let raw
  try { raw = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))?.dsh?.bundle?.patch } catch { return [] }
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  return list.filter((value) => typeof value === "string" && value.trim() !== "").map((value) => resolve(repoRoot, value))
}

/** The declared patch file(s) that really declare the `mpd` preset row. */
export function mpdPresetSourcePaths(repoRoot) {
  return declaredBundlePatches(repoRoot).filter((file) => {
    if (!existsSync(file)) return false
    return /^\s*-?\s*id:\s*preset-mpd\s*$/m.test(readFileSync(file, "utf8"))
  })
}

/**
 * The `mpd` preset's composition source bytes (the whole declaring patch file,
 * comments included — callers grep it for row ids and specifiers).
 * Empty string when NO declared patch declares the preset: a caller's assertions
 * then fail loudly instead of silently passing over an empty subject.
 */
export function readMpdPresetSource(repoRoot) {
  return mpdPresetSourcePaths(repoRoot).map((file) => readFileSync(file, "utf8")).join("\n")
}
