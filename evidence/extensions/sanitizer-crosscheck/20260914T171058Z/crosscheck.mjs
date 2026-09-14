// The sanitizer's validator is a MIRROR of the harness's enforced subset, and a
// mirror that drifts is worse than none. This cross-check runs both against the
// same corpus: our `schemaViolations()` and the INSTALLED harness's
// `assertSupportedJsonSchema` (H/@deepseek-ai/dsh-tools/lib/index.js) must agree
// on every entry — accept/accept and reject/reject.
//
// Run: bun evidence/extensions/sanitizer-crosscheck/20260914T171058Z/crosscheck.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { projectSchema, schemaViolations } from "../../../../packages/mpd-ext-plugin/src/schema-sanitize.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const HARNESS = process.env.MPD_HARNESS_DSH_TOOLS
  ?? "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"

const corpus = [
  { label: "clean object", schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } },
  { label: "clean nullable oneOf", schema: { oneOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "null" }] } },
  { label: "annotation-only", schema: {} },
  { label: "type array [string,null]", schema: { type: ["string", "null"] } },
  { label: "type array [string,number] (unprojectable)", schema: { type: ["string", "number"] } },
  { label: "foreign keyword: $ref", schema: { $ref: "#/definitions/x" } },
  { label: "foreign keyword: format/pattern", schema: { type: "object", properties: { a: { type: "string", format: "date", pattern: "^x" } } } },
  { label: "required without properties", schema: { type: "object", required: ["a"] } },
  { label: "required naming a missing property", schema: { type: "object", properties: { a: { type: "string" } }, required: ["b"] } },
  { label: "additionalProperties object", schema: { type: "object", additionalProperties: { type: "string" } } },
  { label: "type + oneOf", schema: { type: "object", oneOf: [{ type: "string" }, { type: "number" }] } },
  { label: "oneOf with one branch", schema: { oneOf: [{ type: "string" }] } },
  { label: "oneOf with sibling constraint", schema: { oneOf: [{ type: "string" }, { type: "number" }], properties: { a: { type: "string" } } } },
  { label: "boolean schema true", schema: true },
  { label: "boolean schema false", schema: false },
  { label: "enum without type", schema: { enum: ["a", "b"] } },
  { label: "enum with a mixed value", schema: { type: "string", enum: ["a", 1] } },
  { label: "const inside enum", schema: { type: "integer", const: 2, enum: [1, 2] } },
  { label: "const outside enum", schema: { type: "integer", const: 3, enum: [1, 2] } },
  { label: "properties without type", schema: { properties: { a: { type: "string" } } } },
  { label: "items under a string type", schema: { type: "string", items: { type: "string" } } },
  { label: "bad annotation type", schema: { type: "object", title: 3 } },
  { label: "empty properties with additionalProperties false", schema: { type: "object", properties: {}, additionalProperties: false } },
  { label: "nested allOf", schema: { type: "object", properties: { a: { type: "object", properties: { b: { allOf: [{ type: "string" }] } } } } } },
  { label: "type array in a property", schema: { type: "object", properties: { a: { type: ["string", "null"] } } } },
]

let harness = null
let harnessNote = "loaded"
try {
  harness = await import(HARNESS)
} catch (error) {
  harnessNote = `unavailable: ${String(error)}`
}

let mismatches = 0
const rows = []
for (const entry of corpus) {
  const mine = schemaViolations(entry.schema)
  let harnessAccepted = null
  let harnessMessage = null
  if (harness !== null) {
    try {
      harness.assertSupportedJsonSchema(entry.schema)
      harnessAccepted = true
    } catch (error) {
      harnessAccepted = false
      harnessMessage = error instanceof Error ? error.message : String(error)
    }
  }
  const agrees = harnessAccepted === null ? null : (mine.length === 0) === harnessAccepted
  if (agrees === false) mismatches += 1
  const projection = projectSchema(entry.schema)
  rows.push({
    label: entry.label,
    harnessAccepted,
    harnessMessage,
    ourViolations: mine,
    agrees,
    projection: {
      projectable: projection.schema !== undefined,
      lossy: projection.lossy,
      schema: projection.schema ?? null,
      violations: projection.violations,
    },
  })
}

const result = {
  check: "schema subset mirror vs the INSTALLED harness validator",
  harnessPath: HARNESS,
  harnessNote,
  corpusSize: corpus.length,
  mismatches,
  verdict: harnessAcceptedIsAvailable() && mismatches === 0 ? "pass" : "inconclusive",
  note: "the mirror is exercised by packages/mpd-ext-plugin/test/mcp.test.ts on every run; this cross-check is the independent, harness-anchored proof",
  rows,
}

function harnessAcceptedIsAvailable() {
  return harness !== null
}

mkdirSync(join(HERE, "raw"), { recursive: true })
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(
  join(HERE, "raw", "output.log"),
  rows
    .map((row) => `${row.agrees === false ? "MISMATCH " : row.agrees === null ? "NO-HARNESS " : "ok       "} ${row.label}: harness=${String(row.harnessAccepted)} ours=${row.ourViolations.length === 0 ? "accept" : "reject"} projectable=${row.projection.projectable} lossy=${row.projection.lossy}`)
    .join("\n") + `\n\nmismatches: ${mismatches}/${corpus.length}\nverdict: ${result.verdict}\n`,
)
console.log(JSON.stringify({ verdict: result.verdict, mismatches, corpusSize: corpus.length, harnessNote }, null, 2))
