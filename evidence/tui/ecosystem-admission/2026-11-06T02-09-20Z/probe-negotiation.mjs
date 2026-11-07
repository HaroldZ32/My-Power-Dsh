// Throwaway measurement probe (committed only as evidence provenance, never as a shipped script):
// the INSTALLED dsh-tui 0.18.0 admission library against BOTH shipped manifests.
// Chain: loadSpecData -> createContractIndex -> validatePlugin -> negotiate(manifest, hostDescriptor, []).
// Nothing is re-implemented: every function below is the host's own code, imported by absolute file URL.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { join } from "node:path"

const HOST = "/home/haroldzhao/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"
const REPO = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
const url = (rel) => pathToFileURL(join(HOST, rel)).href
const sha256 = (p) => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex")
const pkg = JSON.parse(readFileSync(join(HOST, "package.json"), "utf8"))

const { loadSpecData, registryEntries } = await import(url("lib/types/adapter/standard/registry.js"))
const { createContractIndex, validatePlugin, validateHost } = await import(url("lib/types/adapter/standard/validate.js"))
const { negotiate } = await import(url("lib/types/adapter/standard/negotiate.js"))
const { buildLegacyHostDescriptor, HOST_SUPPORTED_CONTRACTS, HOST_FACET_API_VERSIONS } = await import(url("lib/types/adapter/standard/descriptor.js"))

const spec = loadSpecData()
if (spec === undefined) {
  console.error("BLOCKED: loadSpecData() returned undefined")
  process.exit(2)
}
const index = createContractIndex(spec.registry, spec.permissions)
const built = buildLegacyHostDescriptor({ generationId: "mpd-tui-admission-remeasure-20261106", supported: HOST_SUPPORTED_CONTRACTS })

let hostValidation = "ok"
try { validateHost(index, built.descriptor) } catch (error) { hostValidation = String(error?.message ?? error) }

const manifests = [
  join(REPO, "dsh-plugin.json"),
  join(REPO, "packages/mpd-tui-plugin/dsh-plugin.json"),
]

const results = []
for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  let validation = { ok: true, error: null }
  try { validatePlugin(index, manifest) } catch (error) {
    validation = { ok: false, error: String(error?.message ?? error), name: error?.name ?? "Error" }
  }
  let decision
  try { decision = negotiate(index, manifest, built.descriptor, []) } catch (error) {
    decision = { decision: "THREW", error: String(error?.message ?? error) }
  }
  results.push({
    manifest: path,
    sha256: sha256(path),
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    facetApiVersion: manifest.facets?.host?.apiVersion,
    entry: manifest.facets?.host?.entry,
    permissions: manifest.permissions,
    requiredContracts: (manifest.requires?.contracts ?? []).filter((c) => c.optional !== true).map((c) => `${c.apiVersion}#${c.kind}`),
    optionalContracts: (manifest.requires?.contracts ?? []).filter((c) => c.optional === true).map((c) => `${c.apiVersion}#${c.kind}`),
    validatePlugin: validation,
    decision,
  })
}

const out = {
  measuredAtUtc: new Date().toISOString(),
  command: "node evidence/tui/ecosystem-admission/2026-11-06T02-09-20Z/probe-negotiation.mjs",
  host: {
    root: HOST,
    version: pkg.version,
    facetApiVersions: [...HOST_FACET_API_VERSIONS],
    supportedContracts: built.descriptor.contracts.map((c) => `${c.apiVersion}#${c.kind}`),
    hostVersionField: built.descriptor.hostVersion,
    validateHost: hostValidation,
    warnings: built.warnings,
  },
  chain: "loadSpecData -> createContractIndex -> validatePlugin(index, manifest) -> negotiate(index, manifest, buildLegacyHostDescriptor(...).descriptor, [])",
  registry: {
    profileVersion: spec.profileVersion ?? null,
    facetApiVersions: [...spec.registry.facetApiVersions],
    protocols: registryEntries(spec.registry).length,
  },
  results,
}
console.log(JSON.stringify(out, null, 2))
