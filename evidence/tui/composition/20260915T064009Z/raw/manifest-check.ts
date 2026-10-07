#!/usr/bin/env node
// t24 acceptance check (t24-specific): the manifest's identity pair must describe
// the package whose root carries the file, the `id` must not move, and every
// DECLARATION must be byte-identical to the reviewed revision. Also re-asserts the
// t22 disclosure content, since t24 must not regress it.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../../../../..")
const TUI_ROOT = process.env.MPD_DSH_TUI_ROOT ??
  "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui"
const { parseManifest, projectManifest } = await import(
  pathToFileURL(join(TUI_ROOT, "node_modules/@dsh-std/manifest/lib/index.js")).href
)
const sha = (f) => "sha256:" + createHash("sha256").update(readFileSync(f)).digest("hex")
const before = JSON.parse(readFileSync(join(here, "dsh-plugin.json.before"), "utf8"))
const after = JSON.parse(readFileSync(join(here, "dsh-plugin.json.after"), "utf8"))
const carrier = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const impl = JSON.parse(readFileSync(join(repoRoot, "packages/mpd-tui-plugin/package.json"), "utf8"))
const note = after["x-mpd-tui-surfaces"].note
const decision = after["x-mpd-tui-surfaces"].decisionEvents
const required = ["manifestVersion", "id", "name", "version", "facets", "requires", "permissions", "contributes", "subscriptions"]
const changedKeys = Object.keys({ ...before, ...after })
  .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))

const result = {
  check: "t24 — manifest identity pair describes the package that carries the file",
  digests: { before: sha(join(here, "dsh-plugin.json.before")), after: sha(join(here, "dsh-plugin.json.after")) },
  identityPair: {
    name: after.name, version: after.version, id: after.id,
    carrierPackage: `${carrier.name}@${carrier.version}`,
    facetImplementingPackage: `${impl.name}@${impl.version}`,
    nameVersionEqualCarrier: after.name === carrier.name && after.version === carrier.version,
    noPairReconstructsAMissingVersion: !(after.name === impl.name && after.version !== impl.version),
    nameVersionEqualImplementingPackage: after.name === impl.name && after.version === impl.version,
    noteNamesImplementingPackage: note.includes(impl.name) && note.includes(impl.version),
    noteExplainsWhyTheCarrierIsNamed: /resolves a row\'s specifier/.test(note),
    idUnchanged: after.id === before.id,
  },
  declarations: {
    changedTopLevelKeys: changedKeys,
    permissionsUnchanged: JSON.stringify(before.permissions) === JSON.stringify(after.permissions),
    contractsUnchanged: JSON.stringify(before.requires) === JSON.stringify(after.requires),
    contributionsUnchanged: JSON.stringify(before.contributes) === JSON.stringify(after.contributes),
    subscriptionsUnchanged: JSON.stringify(before.subscriptions) === JSON.stringify(after.subscriptions),
    optionalFallbackUnchanged: before.requires.contracts[0].fallback === after.requires.contracts[0].fallback,
    onlyIdentityAndDisclosureMoved: changedKeys.every((k) => ["name", "x-mpd-tui-surfaces"].includes(k)),
  },
  structure: {
    missingRequiredKeys: required.filter((k) => !(k in after)),
    idMatchesNamespacedId: /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/.test(after.id),
    hostFacetEntry: after.facets?.host?.entry ?? null,
    provides: "provides" in after,
    requiresServices: "services" in (after.requires ?? {}),
  },
  t22DisclosureStillHolds: {
    measuredChain: ["default: deny", "waiting_authorization", "NO component identity is bound", "undeclared", "UNTIL a grant row exists"].every((s) => decision.includes(s)),
    unblock: ["extension-grants.json", "com.mpd-dsh.mpd-tui", "tui/input", "tui/rewind-prompt", "tui/session-switch", "tui/compact"].every((s) => decision.includes(s)),
  },
  parser: {},
}
try {
  const m = parseManifest(readFileSync(join(repoRoot, "dsh-plugin.json"), "utf8"), { source: "dsh-plugin.json" })
  const projected = projectManifest(m)
  result.parser = { pinnedParserAccepted: true, parserSeesName: m.name, projectedFacetEntry: projected.spec.facets[0].activation.spec.module }
} catch (error) {
  result.parser = { pinnedParserAccepted: false, error: `${error.name}: ${error.message}` }
}
const flat = (o) => Object.values(o).every((v) => (Array.isArray(v) ? v.every(Boolean) : v === true))
// `nameVersionEqualImplementingPackage` is a DIAGNOSTIC of the fixed state (it must
// be FALSE: the manifest names the carrier package, not the facet's implementer), so
// the requirement set is enumerated rather than blanket-truthy.
const identityRequirements = [
  result.identityPair.nameVersionEqualCarrier,
  result.identityPair.noPairReconstructsAMissingVersion,
  result.identityPair.noteNamesImplementingPackage,
  result.identityPair.noteExplainsWhyTheCarrierIsNamed,
  result.identityPair.idUnchanged,
]
result.ok =
  identityRequirements.every(Boolean) && flat(result.declarations) && flat(result.t22DisclosureStillHolds) &&
  result.structure.missingRequiredKeys.length === 0 && result.structure.idMatchesNamespacedId &&
  result.structure.provides === false && result.structure.requiresServices === false &&
  result.structure.hostFacetEntry === "packages/mpd-tui-plugin/dist/index.js" &&
  result.parser.pinnedParserAccepted === true
writeFileSync(join(here, "manifest-check.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
