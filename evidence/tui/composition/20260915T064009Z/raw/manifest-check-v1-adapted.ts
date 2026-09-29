#!/usr/bin/env node
// t22 acceptance check: (1) the manifest's declarations are UNCHANGED outside the
// x- disclosure key, (2) the disclosure key is permitted by the pinned 0.15
// parser and the structural contract still holds, (3) the new disclosure text
// states the measured admission chain and the concrete unblock.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const DSH_TUI_ROOT = process.env.MPD_DSH_TUI_ROOT ??
  "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-harness-tui/dsh-tui"
const repoRoot = join(here, "../../../../..")
const { parseManifest, projectManifest } = await import(
  pathToFileURL(join(DSH_TUI_ROOT, "node_modules/@dsh-std/manifest/lib/index.js")).href
)
const sha = (f) => "sha256:" + createHash("sha256").update(readFileSync(f)).digest("hex")
const before = JSON.parse(readFileSync(join(here, "dsh-plugin.json.before"), "utf8"))
const after = JSON.parse(readFileSync(join(here, "dsh-plugin.json.after"), "utf8"))
const stripX = (m) => { const c = structuredClone(m); delete c["x-mpd-tui-surfaces"]; return c }
const text = after["x-mpd-tui-surfaces"].decisionEvents
const required = ["manifestVersion", "id", "name", "version", "facets", "requires", "permissions", "contributes", "subscriptions"]
const result = {
  check: "t22 — disclosure-only repair of dsh-plugin.json",
  digests: { before: sha(join(here, "dsh-plugin.json.before")), after: sha(join(here, "dsh-plugin.json.after")) },
  declarationIdentity: {
    identicalOutsideDisclosure: JSON.stringify(stripX(before)) === JSON.stringify(stripX(after)),
    permissionsUnchanged: JSON.stringify(before.permissions) === JSON.stringify(after.permissions),
    contractsUnchanged: JSON.stringify(before.requires) === JSON.stringify(after.requires),
    contributionsUnchanged: JSON.stringify(before.contributes) === JSON.stringify(after.contributes),
    subscriptionsUnchanged: JSON.stringify(before.subscriptions) === JSON.stringify(after.subscriptions),
    optionalFallbackUnchanged: before.requires.contracts[0].fallback === after.requires.contracts[0].fallback,
    // The ONLY top-level key allowed to differ is the x- disclosure key.
    changedTopLevelKeys: Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])),
  },
  structure: {
    missingRequiredKeys: required.filter((k) => !(k in after)),
    idMatchesNamespacedId: /^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/.test(after.id),
    hostFacetEntry: after.facets?.host?.entry ?? null,
    forbidden: { provides: "provides" in after, requiresServices: "services" in (after.requires ?? {}) },
  },
  parser: {},
  identityPair: (() => {
    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    const impl = JSON.parse(readFileSync(join(repoRoot, "packages/mpd-tui-plugin/package.json"), "utf8"))
    const note = after["x-mpd-tui-surfaces"].note
    return {
      manifestNameEqualsCarrierPackage: after.name === root.name,
      manifestVersionEqualsCarrierVersion: after.version === root.version,
      noPairReconstructsAMissingVersion: !(after.name === impl.name && after.version !== impl.version),
      carrierPackage: `${root.name}@${root.version}`,
      facetImplementingPackage: `${impl.name}@${impl.version}`,
      noteNamesImplementingPackage: note.includes(impl.name) && note.includes(impl.version),
      idUnchanged: after.id === before.id,
    }
  })(),
  disclosureContent: {
    statesDenyDefault: /default: deny/.test(text),
    statesWaitingAuthorization: /waiting_authorization/.test(text),
    statesNoIdentityBound: /NO component identity is bound/.test(text),
    statesLedgerUndeclared: /undeclared/.test(text),
    namesGrantFileAndId: /extension-grants\.json/.test(text) && /com\.mpd-dsh\.mpd-tui/.test(text),
    namesAllFourScopes: ["tui/input", "tui/rewind-prompt", "tui/session-switch", "tui/compact"].every((s) => text.includes(s)),
    statesCompatibleAlternative: /negotiates `compatible`/.test(text),
    forbiddenWordingAbsent: !/官方认证|official certification|security plug-in|vulnerability-free|compatible with all DSH hosts|官方标准规定/.test(text),
  },
}
try {
  const source = readFileSync(join(repoRoot, "dsh-plugin.json"), "utf8")
  const m = parseManifest(source, { source: "dsh-plugin.json" })
  projectManifest(m)
  result.parser = { pinnedParserAccepted: true, projectedFacetEntry: projectManifest(m).spec.facets[0].activation.spec.module }
} catch (error) {
  result.parser = { pinnedParserAccepted: false, error: `${error.name}: ${error.message}` }
}
result.ok = Object.values(result.declarationIdentity).every((v) => v === true || Array.isArray(v)) &&
  result.structure.missingRequiredKeys.length === 0 && result.structure.idMatchesNamespacedId &&
  result.structure.forbidden.provides === false && result.structure.forbidden.requiresServices === false &&
  result.parser.pinnedParserAccepted === true &&
  Object.entries(result.identityPair).filter(([k]) => k !== "carrierPackage" && k !== "facetImplementingPackage").every(([, v]) => v === true) &&
  Object.values(result.disclosureContent).every(Boolean) &&
  // t24 rule: the ONLY top-level keys allowed to move are the identity pair's
  // display name and the x- disclosure block; every declaration must be identical.
  result.declarationIdentity.changedTopLevelKeys.every((k) => ["name", "x-mpd-tui-surfaces"].includes(k))
writeFileSync(join(here, "t22-structure-check.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
