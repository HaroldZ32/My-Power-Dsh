#!/usr/bin/env node
// t5 static admission lane: drive the HOST's OWN pinned admission implementation
// (the vendored @dsh-std/manifest parser + projection, and dsh-TUI's own
// contract index / validatePlugin / negotiate) against the bundle-level
// dsh-plugin.json. Pinned upstream code, never a re-implementation.
//
// Usage: node evidence/tui/composition/<ts>/raw/admission-static.mjs [manifestPath]
// Output: JSON on stdout (also written next to this script by the caller).
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DSH_TUI_ROOT =
  process.env.MPD_DSH_TUI_ROOT ??
  "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")
const manifestPath = resolve(process.argv[2] ?? join(repoRoot, "dsh-plugin.json"))

const lib = (relative) => pathToFileURL(join(DSH_TUI_ROOT, "lib/types", relative)).href
const sha256 = (file) => "sha256:" + createHash("sha256").update(readFileSync(file)).digest("hex")

const { parseManifest, projectManifest } = await import(
  pathToFileURL(join(DSH_TUI_ROOT, "node_modules/@dsh-std/manifest/lib/index.js")).href
)
const { loadSpecData, registryEntries } = await import(lib("adapter/standard/registry.js"))
const { createContractIndex, validatePlugin, negotiate } = await import(lib("adapter/standard/admission.js"))

const source = readFileSync(manifestPath, "utf8")
const data = loadSpecData()
if (data === undefined) {
  console.log(JSON.stringify({ ok: false, reason: "loadSpecData() returned undefined (spec registry unavailable)" }, null, 2))
  process.exit(2)
}
const index = createContractIndex(data.registry, data.permissions)

// The LIVE descriptor's contract set + permissions, derived from the vendored
// registry through the host's own driver selection (commands / storage.local /
// messages.observe / tui.decision-events).
const DRIVER_SET = new Set(["commands", "storage.local", "messages.observe", "tui.decision-events"])
const host = {
  hostId: "dsh-tui",
  facetApiVersions: [...data.registry.facetApiVersions],
  contracts: registryEntries(data.registry)
    .filter((entry) => DRIVER_SET.has(entry.name))
    .map((entry) => ({
      apiVersion: entry.coordinates.apiVersion,
      kind: entry.coordinates.kind,
      permissions: [...entry.permissions],
    })),
}

const result = { ok: true, manifestPath, hostModel: host }
try {
  const manifest = parseManifest(source, { source: manifestPath })
  result.parse = "ok"
  result.projected = projectManifest(manifest)
  result.manifest = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    entry: manifest.facets.host.entry,
    apiVersion: manifest.facets.host.apiVersion,
    requiredContracts: manifest.requires.contracts.filter((c) => c.optional !== true).map((c) => `${c.apiVersion}#${c.kind}`),
    optionalContracts: manifest.requires.contracts.filter((c) => c.optional === true).map((c) => `${c.apiVersion}#${c.kind}`),
    permissions: manifest.permissions.map((p) => `${p.name}@${p.scope}`),
    commands: manifest.contributes.commands.map((c) => c.id),
    subscriptions: manifest.subscriptions,
    license: manifest.license,
  }
  result.structural = {
    hasProvides: Object.hasOwn(manifest, "provides"),
    hasRequiresServices: Object.hasOwn(manifest.requires, "services"),
    facets: Object.keys(manifest.facets),
    entryExists: existsSync(join(repoRoot, manifest.facets.host.entry)),
    entrySha256: existsSync(join(repoRoot, manifest.facets.host.entry)) ? sha256(join(repoRoot, manifest.facets.host.entry)) : null,
    manifestVersionMatchesPackageJson:
      manifest.version === JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version,
  }
  validatePlugin(index, manifest)
  result.validatePlugin = "ok"
  result.negotiation = negotiate(index, manifest, host, [])
} catch (error) {
  result.ok = false
  result.error = { name: error?.name, message: String(error?.message ?? error) }
}

// ---- negative/positive CONTROLS: prove the checks above are falsifiable ----
const controls = {}
const withoutPermissions = (value) => {
  const clone = structuredClone(value)
  clone.permissions = []
  return clone
}
const rawManifest = JSON.parse(source)
try {
  parseManifest("{ this is not json", { source: "control-syntax" })
  controls.brokenSyntax = "UNEXPECTED PASS"
} catch (error) {
  controls.brokenSyntax = `${error.name}: ${error.message}`
}
try {
  const noFallback = structuredClone(rawManifest)
  delete noFallback.requires.contracts[0].fallback
  validatePlugin(index, parseManifest(JSON.stringify(noFallback)))
  controls.optionalWithoutFallback = "UNEXPECTED PASS"
} catch (error) {
  controls.optionalWithoutFallback = String(error.message)
}
try {
  const badPermission = structuredClone(rawManifest)
  badPermission.permissions[0].name = "mpd-dsh.not-a-registered-permission"
  validatePlugin(index, parseManifest(JSON.stringify(badPermission)))
  controls.unknownPermission = "UNEXPECTED PASS"
} catch (error) {
  controls.unknownPermission = String(error.message)
}
try {
  const noOverclaim = withoutPermissions(rawManifest)
  const m = parseManifest(JSON.stringify(noOverclaim))
  validatePlugin(index, m)
  controls.declaredPermissionsRemoved = negotiate(index, m, host, [])
} catch (error) {
  controls.declaredPermissionsRemoved = "UNEXPECTED THROW: " + String(error.message)
}
result.controls = controls
result.inputDigests = {
  manifest: sha256(manifestPath),
  manifestLib: sha256(join(DSH_TUI_ROOT, "node_modules/@dsh-std/manifest/lib/index.js")),
  manifestSchema: sha256(join(DSH_TUI_ROOT, "node_modules/@dsh-std/manifest/schema/dsh-plugin-0.15.schema.json")),
  registry: sha256(join(data.dir, "registry/registry-0.15.json")),
  permissions: sha256(join(data.dir, "registry/permissions-0.1.json")),
  hostAdmission: sha256(join(DSH_TUI_ROOT, "lib/types/adapter/standard/validate.js")),
  hostPluginsInfo: sha256(join(DSH_TUI_ROOT, "lib/types/dsh-adapter/plugins-info.js")),
  specProfileVersion: data.registry.profileVersion,
}
const out = join(dirname(fileURLToPath(import.meta.url)), "admission-static.json")
writeFileSync(out, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
