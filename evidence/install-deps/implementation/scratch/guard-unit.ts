#!/usr/bin/env node
// Clause-level falsification for the sidebar mount guard: run the EXACT expression
// the patch ships through the loader's own evaluator shape
// (`new Function("ctx","expr","with (ctx) { return eval(expr) }")`) against
// synthetic profiles, so every clause has a case that MUST return true (disabled)
// and one that MUST return false (enabled). Synthetic, no boot: this complements
// the five booted compositions, it never replaces them.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pathToFileURL } from "node:url"
import { SIDEBAR_GUARD } from "./sidebar-guard.ts"

// /tmp is a fresh read-only tmpfs under this harness (T-23), so the fixtures live
// beside this script.
const HERE = dirname(fileURLToPath(import.meta.url))

const evaluate = new Function("ctx", "expr", "with (ctx) { return eval(expr) }")

function makeProfile({ sidebar = true, otherLayer = null, sidebarAsLayer = false, webEntry = true, webLayer = true }) {
  const root = mkdtempSync(join(HERE, "guard-case-"))
  const profile = join(root, "profile")
  mkdirSync(join(profile, "node_modules"), { recursive: true })
  if (sidebar) mkdirSync(join(profile, "node_modules", "dsh-better-sidebar"), { recursive: true })
  const bundles = ["@deepseek-ai/dsh-base"]
  if (webLayer) bundles.push("@deepseek-ai/dsh-web-app")
  bundles.push("@mpd-dsh/mpd")
  if (sidebarAsLayer) bundles.push("dsh-better-sidebar")
  if (otherLayer) {
    bundles.push(otherLayer.name)
    const dir = join(profile, "node_modules", otherLayer.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: otherLayer.name, dsh: { bundle: { patch: "./cordis.patch.yml" } } }))
    writeFileSync(join(dir, "cordis.patch.yml"), otherLayer.patch)
  }
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-web", private: true, dsh: { profile: { bundles } } }))
  return { root, ctx: { baseUrl: pathToFileURL(profile + "/").href, loader: { entries: () => (webEntry ? [{ options: { id: "webserver", name: "@deepseek-ai/dsh-host-webserver" } }] : []) } } }
}

const AGGREGATE_PATCH = "- insert:\n    - id: web-ui-better-sidebar\n      name: 'dsh-better-sidebar'\n"
const UNRELATED_PATCH = "- insert:\n    - id: other-row\n      name: 'some-other-plugin'\n"

const cases = [
  { name: "1. package missing -> DISABLED", want: true, profile: { sidebar: false } },
  { name: "1b. package present, nothing else -> ENABLED", want: false, profile: {} },
  { name: "2. sidebar is itself a bundle layer -> DISABLED", want: true, profile: { sidebarAsLayer: true } },
  { name: "3. another layer's patch names the package -> DISABLED", want: true, profile: { otherLayer: { name: "@linxin666/dsh-web-all", patch: AGGREGATE_PATCH } } },
  { name: "3b. another layer's patch does NOT name it -> ENABLED", want: false, profile: { otherLayer: { name: "@acme/other-aggregate", patch: UNRELATED_PATCH } } },
  { name: "3c. our OWN patch text (contains mpd-better-sidebar) is not treated as another layer -> ENABLED", want: false, profile: { otherLayer: { name: "@acme/clone", patch: AGGREGATE_PATCH + "    - id: mpd-better-sidebar\n" } } },
  { name: "4. no web plane (no webserver entry, no web layer) -> DISABLED", want: true, profile: { webEntry: false, webLayer: false } },
  { name: "4b. web layer present without a webserver entry -> ENABLED (order fallback)", want: false, profile: { webEntry: false, webLayer: true } },
  { name: "5. guard throws (baseUrl unusable) -> DISABLED", want: true, profile: {}, badCtx: true },
]

let failed = 0
const results = []
for (const c of cases) {
  const built = makeProfile(c.profile)
  const ctx = c.badCtx ? { baseUrl: "not a url", loader: { entries: () => [] } } : built.ctx
  let got
  try { got = evaluate(ctx, SIDEBAR_GUARD) } catch (error) { got = "THREW: " + String(error.message) }
  const ok = got === c.want
  if (!ok) failed += 1
  results.push({ case: c.name, want: c.want, got, ok })
  rmSync(built.root, { recursive: true, force: true })
}
for (const r of results) console.log((r.ok ? "PASS " : "FAIL ") + r.case + " (want " + r.want + ", got " + r.got + ")")
console.log((failed === 0 ? "PASS" : "FAIL") + ": " + (results.length - failed) + "/" + results.length + " guard cases")
process.exit(failed === 0 ? 0 : 1)
