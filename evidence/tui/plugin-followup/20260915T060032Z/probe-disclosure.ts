// Proof that the SHIPPED artifact carries the on-screen disclosure (t21).
//
// Loads packages/mpd-tui-plugin/dist/index.js (never src/) and applies it to a
// fake context whose `tuiSettingsSections` captures what the plugin registers.
// Exit 0 only when every hint naming an mpd.jsonc key also states that a save is
// not bridged to the file.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
// <repo>/evidence/tui/plugin-followup/<ts>/ -> four levels up is the repo root.
const repoRoot = dirname(dirname(dirname(dirname(here))))
const entry = join(repoRoot, "packages", "mpd-tui-plugin", "dist", "index.js")
const marker = "does not rewrite .mpd/mpd.jsonc"

const captured = []
const noop = () => () => {}
const ctx = {
  get: (id) => (id === "tuiSettingsSections" ? { register: (section) => (captured.push(section), noop) } : undefined),
  effect: (callback) => (callback(), {}),
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
}

const mod = await import(pathToFileURL(entry).href)
mod.apply(ctx, { statusIntervalMs: 0 })

const section = captured[0]
const fields = (section?.fields ?? []).map((field) => ({ path: field.path.join("."), hint: field.hint }))
const failures = fields.filter((field) => !(typeof field.hint === "string" && field.hint.includes("mpd.jsonc") && field.hint.includes(marker)))
const bytes = readFileSync(entry)

const result = {
  entry: "packages/mpd-tui-plugin/dist/index.js",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  sectionNs: section?.ns ?? null,
  fieldCount: fields.length,
  fields,
  marker,
  failures,
  ok: fields.length > 0 && failures.length === 0,
}
process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(result.ok ? 0 : 1)
