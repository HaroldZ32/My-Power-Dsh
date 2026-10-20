// One-off reproduction for the 2026-10-19 report:
//   unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix"
// It reads the SHIPPED preset, extracts the persona prefix, and renders it through
// the INSTALLED harness's own `renderPrompt` with the variables the loop registers.
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const HARNESS = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh"
const { renderPrompt } = await import(HARNESS + "/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js")
const req = createRequire(HARNESS + "/package.json")
const yaml = req("js-yaml")
const jsTag = new yaml.Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  construct: (data) => ({ __jsExpr: data }),
})
const load = (text) => yaml.load(text, { schema: yaml.DEFAULT_SCHEMA.extend([jsTag]) })

const preset = load(readFileSync("presets/mpd.patch.yml", "utf8"))
const presetRow = preset[0].insert.find((row) => row.id === "preset-mpd")
const persona = presetRow.config.plugins.find((row) => row.id === "persona")
const prefix = persona.config.prefix

const assembly = (text) => ({
  sections: [{ name: "deployment:persona-prefix", order: 0, text }],
  contexts: [],
  tools: [],
  variables: { provider: "deepseek-official", model: "deepseek-flash" },
})

for (const [label, text] of [
  ["shipped prefix", prefix],
  ["without the cwd clause", prefix.replace(/\s*Your working directory is \{\{cwd\}\}\./, "")],
]) {
  try {
    const rendered = renderPrompt(assembly(text))
    console.log(label + ": RENDER OK (length " + rendered.length + ")")
  } catch (error) {
    console.log(label + ": THROWS -> " + error.message)
  }
}
