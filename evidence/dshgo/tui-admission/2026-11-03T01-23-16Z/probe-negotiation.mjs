// REAL negotiation against the installed dsh-tui admission library (the host's own code, not a model
// of it): loadSpecData -> createContractIndex -> legacy Host Descriptor -> negotiate(manifest, host, []).
// Usage: node probe-negotiation.mjs <manifest.json> [grants.json]
import { readFileSync } from "node:fs"
import { loadSpecData } from "/home/haroldzhao/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/adapter/standard/registry.js"
import { createContractIndex, negotiate, validatePlugin } from "/home/haroldzhao/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/adapter/standard/admission.js"
import { buildLegacyHostDescriptor, HOST_SUPPORTED_CONTRACTS } from "/home/haroldzhao/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/adapter/standard/descriptor.js"

const manifestPath = process.argv[2]
const grantsPath = process.argv[3]
const spec = loadSpecData()
if (spec === undefined) { console.error("no tui-profile found"); process.exit(2) }
const index = createContractIndex(spec.registry, spec.permissions)
const built = buildLegacyHostDescriptor({ generationId: "mpd-tui-admission-probe", supported: HOST_SUPPORTED_CONTRACTS })
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const grants = grantsPath === undefined ? [] : JSON.parse(readFileSync(grantsPath, "utf8")).grants ?? []
let validation = "ok"
try { validatePlugin(index, manifest) } catch (error) { validation = String(error?.message ?? error) }
const decision = negotiate(index, manifest, built.descriptor, grants)
console.log(JSON.stringify({ manifest: manifestPath, hostVersion: built.descriptor.hostVersion, hostContracts: built.descriptor.contracts.map((c) => `${c.apiVersion}#${c.kind}`), validation, decision, hostWarnings: built.warnings }, null, 2))
