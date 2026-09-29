// B4 (t4) schema-subset check: validates the LIVE hashline tool schemas against the INSTALLED harness
// validator that takes a plugin tree down, and proves the assertion is falsifiable with the exact
// pre-fix form as a negative control.
//   bun evidence/hashline/schema-union-fix/schema-subset-check.mjs
// The plugin is imported from SOURCE (bun transpiles TS); the validator comes from the installed dsh
// checkout resolved via `command -v dsh`, so this runs against the same validator a boot runs.
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { apply } from "../../../packages/mpd-hashline-plugin/src/index.ts"

const dshBin = execFileSync("bash", ["-c", "command -v dsh"], { encoding: "utf8" }).trim()
const dshRoot = dirname(dirname(realpathSync(dshBin)))
const validatorPath = join(dshRoot, "node_modules", "@deepseek-ai", "dsh-tools", "lib", "types", "json-schema.js")
if (!existsSync(validatorPath)) {
  console.error("[schema-subset] FAIL: installed harness validator not found at " + validatorPath)
  process.exit(1)
}
const { assertSupportedJsonSchema } = await import(validatorPath)

const tools = []
const ctx = {
  get: () => undefined,
  tools: { register: (d) => { tools.push(d); return () => {} } },
  on: () => {},
}
apply(ctx, {})

let failures = 0
console.log("[schema-subset] validator = " + validatorPath)
for (const t of tools) {
  for (const [surface, schema] of [["parameters", t.parameters], ["output", t.output?.schema]]) {
    try {
      assertSupportedJsonSchema(schema)
      console.log("[schema-subset] ACCEPTED " + t.name + "." + surface)
    } catch (e) {
      failures++
      console.log("[schema-subset] REJECTED " + t.name + "." + surface + ": " + String(e?.message ?? e))
    }
  }
}

// Negative control: the exact PRE-FIX form must be rejected by the same validator.
const preFix = { type: "object", properties: { edits: { type: "array", items: { type: "object", properties: { lines: { type: ["string", "array"], items: { type: "string" } } } } } } }
let controlRejected = false
let controlMessage = ""
try { assertSupportedJsonSchema(preFix) } catch (e) { controlRejected = true; controlMessage = String(e?.message ?? e) }
console.log("[schema-subset] NEGATIVE_CONTROL(pre-fix type array) = " + (controlRejected ? "rejected" : "ACCEPTED (assertion is not falsifiable!)"))
console.log("[schema-subset] NEGATIVE_CONTROL_MESSAGE = " + JSON.stringify(controlMessage))

const fixedNode = tools.find((t) => t.name === "mpd_hashline_edit")?.parameters?.properties?.edits?.items?.properties?.lines
console.log("[schema-subset] FIXED_LINES_NODE = " + JSON.stringify(fixedNode))
const ok = failures === 0 && controlRejected && fixedNode?.type === undefined && fixedNode?.oneOf?.length === 2
console.log("[schema-subset] RESULT = " + (ok ? "PASS" : "FAIL"))
process.exit(ok ? 0 : 1)
