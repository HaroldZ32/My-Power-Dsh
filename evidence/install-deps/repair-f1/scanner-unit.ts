#!/usr/bin/env node
// t14 offline unit check: evaluate the SHIPPED guard expression against synthetic patch-layer
// texts and assert the row-aware predicate (comments stripped; a candidate row counts as a MOUNT
// unless it carries a LITERAL `disabled: true`; unknown/!!js values stay conservative).
//
// The guard is extracted from the bundle patch row exactly as the loader sees it (the `!!js`
// scalar), and evaluated with a minimal environment: a temp profile dir whose node_modules holds
// a placeholder `dsh-better-sidebar`, a bundle list that declares nothing, a fake ctx whose loader
// exposes one enabled webserver entry, and the layer text under test in the profile patch file.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const PATCH = join(REPO, "packages", "mpd-bundle", "cordis.patch.yml")

const rowLine = readFileSync(PATCH, "utf8").split("\n").find((line) => line.includes("disabled: !!js "))
const guardExpression = rowLine.slice(rowLine.indexOf("!!js ") + 5).trim()
const literal = JSON.parse(guardExpression)
const decisionOf = (layerText) => {
  const root = mkdtempSync(join(tmpdir(), "mpd-f1-unit-"))
  const profile = join(root, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "dsh-better-sidebar"), { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dsh: { profile: { bundles: [] } } }))
  if (layerText !== null) writeFileSync(join(profile, "cordis.patch.yml"), layerText)
  const baseUrl = "file://" + profile + "/"
  const ctx = { loader: { entries: () => [{ options: { name: "@deepseek-ai/dsh-host-webserver", id: "webserver" } }] } }
  const warnings = []
  const realWarn = console.warn
  console.warn = (line) => { warnings.push(String(line)) }
  try {
    // eslint-disable-next-line no-new-func
    const value = new Function("baseUrl", "ctx", "return (" + literal + ")") (baseUrl, ctx)
    return { disabled: value === true, warnings }
  } finally {
    console.warn = realWarn
    rmSync(root, { recursive: true, force: true })
  }
}

const CASES = [
  { name: "no layer file at all", layer: null, expectDisabled: false },
  { name: "layer is a COMMENT-ONLY mention (t5 F3 decoy)", layer: "# this layer MOUNTS NOTHING. It merely mentions 'dsh-better-sidebar' in a comment\n- insert:\n    - id: decoy-row\n      name: '@deepseek-ai/cordis-plugin-timer'\n      disabled: true\n", expectDisabled: false },
  { name: "layer inserts a row named dsh-better-sidebar with a LITERAL disabled: true (t5 F4 decoy)", layer: "- insert:\n    - id: decoy-row\n      name: 'dsh-better-sidebar'\n      disabled: true\n", expectDisabled: false },
  { name: "literal disabled: TRUE (case-insensitive)", layer: "- insert:\n    - id: decoy-row\n      name: dsh-better-sidebar\n      disabled: TRUE\n", expectDisabled: false },
  { name: "literal disabled: true with a trailing comment", layer: "- insert:\n    - id: decoy-row\n      name: dsh-better-sidebar\n      disabled: true # mounts nothing\n", expectDisabled: false },
  { name: "an ENABLED row naming the package (a real mount)", layer: "- insert:\n    - id: real-row\n      name: 'dsh-better-sidebar'\n", expectDisabled: true },
  { name: "disabled: false (mounts)", layer: "- insert:\n    - id: real-row\n      name: dsh-better-sidebar\n      disabled: false\n", expectDisabled: true },
  { name: "disabled: !!js (unknown value stays CONSERVATIVE = mount)", layer: "- insert:\n    - id: real-row\n      name: dsh-better-sidebar\n      disabled: !!js \"false\"\n", expectDisabled: true },
  { name: "an unattributable mention outside a row (doubt -> conservative)", layer: "- insert:\n    - id: cfg-row\n      name: other\n      config:\n        note: dsh-better-sidebar\n", expectDisabled: true },
  { name: "a disowned row plus an ENABLED row in the same layer", layer: "- insert:\n    - id: off-row\n      name: 'dsh-better-sidebar'\n      disabled: true\n    - id: on-row\n      name: dsh-better-sidebar\n", expectDisabled: true },
  { name: "a config-nested disabled must NOT qualify the row as disabled", layer: "- insert:\n    - id: real-row\n      name: dsh-better-sidebar\n      config:\n        disabled: true\n", expectDisabled: true },
]

let failures = 0
for (const item of CASES) {
  const { disabled, warnings } = decisionOf(item.layer)
  const ok = disabled === item.expectDisabled
  if (!ok) failures += 1
  console.log((ok ? "ok  " : "FAIL") + " " + item.name + " -> disabled=" + disabled + " (expected " + item.expectDisabled + ")" + (warnings.length > 0 ? " :: " + warnings[0] : ""))
}
const summary = {
  case: "install-deps/repair-f1/scanner-unit",
  measuredAtUtc: new Date().toISOString(),
  guardBytes: Buffer.byteLength(literal),
  guardSha256: createHash("sha256").update(literal).digest("hex"),
  cases: CASES.length,
  failures,
  ok: failures === 0,
}
writeFileSync(join(HERE, "scanner-unit.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log("[scanner-unit] ok=" + summary.ok + " cases=" + summary.cases + " guard=" + summary.guardSha256.slice(0, 12) + "…")
if (!summary.ok) process.exit(1)
