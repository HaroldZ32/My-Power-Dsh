// Validate themes/mpd-tui.json against the host's CURRENT semantic key set.
//
// Reads (never writes) the host checkout's src/theme.ts at the pinned revision:
//   * the `Theme` type block  -> the ALLOWED semantic keys
//   * DeprecatedThemeKey       -> legacy keys a NEW asset must not use
//   * RETIRED_THEME_KEYS       -> keys accepted only at input boundaries
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

const HOST = "/root/dshProj/tui/dsh-TUI/src/theme.ts"
const ASSET = "packages/mpd-tui-plugin/themes/mpd-tui.json"
const RESERVED_NAMES = ["auto", "light", "dark", "dark-ansi", "status"]
const BASES = ["light", "dark", "dark-ansi"]

const source = readFileSync(HOST, "utf8")
const themeBlock = source.slice(source.indexOf("export type Theme = {"), source.indexOf("\n}", source.indexOf("export type Theme = {")))
const allowed = [...themeBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1])
const deprecatedBlock = source.slice(source.indexOf("export type DeprecatedThemeKey ="), source.indexOf("const RETIRED_THEME_KEYS"))
const deprecated = [...deprecatedBlock.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
const retiredBlock = source.slice(source.indexOf("const RETIRED_THEME_KEYS = ["), source.indexOf("] as const", source.indexOf("const RETIRED_THEME_KEYS = [")))
const retired = [...retiredBlock.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1])

const asset = JSON.parse(readFileSync(ASSET, "utf8"))
const keys = Object.keys(asset.colors ?? {})
const legacyUsed = keys.filter((k) => deprecated.includes(k) || retired.includes(k))
const unknown = keys.filter((k) => !allowed.includes(k))
const checks = [
  { name: "base is one of light|dark|dark-ansi", ok: BASES.includes(asset.base), detail: asset.base },
  { name: "name is not a reserved theme name", ok: !RESERVED_NAMES.includes(asset.name), detail: asset.name },
  { name: "no legacy/retired key is used", ok: legacyUsed.length === 0, detail: legacyUsed.join(",") || "(none)" },
  { name: "every colour key is a current semantic key", ok: unknown.length === 0, detail: unknown.join(",") || "(none)" },
  { name: "accent + accentShimmer present (the legacy pair that was renamed)", ok: keys.includes("accent") && keys.includes("accentShimmer") },
  { name: "claude/claudeShimmer absent", ok: !keys.includes("claude") && !keys.includes("claudeShimmer") },
]
const result = {
  asset: ASSET,
  assetSha256: createHash("sha256").update(readFileSync(ASSET)).digest("hex"),
  hostSource: HOST,
  hostRevision: "b246411 (dsh-tui v0.10.1 checkout; read-only)",
  assetKeys: keys,
  allowedSemanticKeys: allowed.length,
  deprecatedKeys: deprecated,
  retiredKeyCount: retired.length,
  checks,
  ok: checks.every((c) => c.ok),
}
writeFileSync(process.argv[2] ?? "theme-check.json", JSON.stringify(result, null, 2) + "\n")
process.stdout.write(JSON.stringify({ ok: result.ok, checks: checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name} (${c.detail})`) }, null, 2) + "\n")
process.exit(result.ok ? 0 : 1)
