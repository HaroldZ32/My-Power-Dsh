#!/usr/bin/env node
// t6 (Reviewer) dev-flavour boot attribution: reads the two boot logs produced in
// this session (fixed patch vs pre-fix patch extracted from the same script
// revision family) and the two generated patches, and records the verdict.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 900) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}
const fixedPatch = readFileSync(join(here, "work", "dev-fixed.yml"), "utf8")
const prefixPatch = readFileSync(join(here, "work", "dev-prefix.yml"), "utf8")
const fixedLog = readFileSync(join(here, "work", "boot-manual", "boot.log"), "utf8")
const prefixLog = readFileSync(join(here, "work", "boot-manual-prefix", "boot.log"), "utf8")
const rtlPatch = readFileSync(join(here, "work", "dev-rtlverif.yml"), "utf8")
const rtlLog = readFileSync(join(here, "work", "boot-rtlverif", "boot.log"), "utf8")

check("FIXED dev patch carries no packed operand and no baseUrl concat",
  !fixedPatch.includes("typeof baseUrl") && !fixedPatch.includes("/node_modules/@mpd-dsh/mpd/") && !/\/node_modules\/\//.test(fixedPatch),
  `lines=${fixedPatch.split("\n").length}`)
check("FIXED dev patch names all four MCP operands as existing checkout-absolute launchers",
  ["mpd-mcp-astgrep/launch.mjs", "mpd-mcp-gitbash/dist/cli.js", "mpd-mcp-lsp/dist/cli.js", "mpd-mcp-codegraph/launch.mjs"]
    .every((m) => fixedPatch.includes('"' + join("/root/dshProj/my-power-dsh", "packages", m) + '"')), "")
check("FIXED boot (no MPD_DSH_*_CLI / MPD_AST_GREP_SG_PATH / MPD_CODEGRAPH_BIN pre-set) answers the MCP tool call",
  /\[t6-mcp-probe\] MCP_TOOL_CALL=ok attempt=1/.test(fixedLog) && /totalMatches\\?":\\?1|totalMatches/.test(fixedLog),
  (fixedLog.match(/\[t6-mcp-probe\] MCP_TOOL_CALL=[^\n]*/) ?? ["(no probe line)"])[0].slice(0, 200))
check("FIXED boot log contains no MODULE_NOT_FOUND / BINARY_NOT_FOUND",
  !/MODULE_NOT_FOUND/.test(fixedLog) && !/BINARY_NOT_FOUND/.test(fixedLog), "")
check("PRE-FIX dev patch reproduces the wave-2 failure shape (<baseUrl>/node_modules/<abs-repo>/...)",
  prefixPatch.includes("typeof baseUrl") && prefixPatch.includes('"/node_modules//root/dshProj/my-power-dsh/packages/mpd-mcp-astgrep/launch.mjs"'),
  (prefixPatch.match(/process\.env\.MPD_DSH_ASTGREP_CLI[^\n]*/) ?? ["(row not found)"])[0].slice(0, 200))
check("PRE-FIX boot dies with MODULE_NOT_FOUND on the spliced path and the MCP tool is unknown",
  /Cannot find module '.*\/profiles\/headless\/node_modules\/root\/dshProj\/my-power-dsh\/packages\/mpd-mcp-astgrep\/launch\.mjs'/.test(prefixLog)
  && /code: 'MODULE_NOT_FOUND'/.test(prefixLog)
  && /\[t6-mcp-probe\] MCP_TOOL_CALL=fail last=not-ok:"unknown tool \\"mcp__ast_grep__search\\""/.test(prefixLog),
  (prefixLog.match(/\[t6-mcp-probe\] MCP_TOOL_CALL=fail[^\n]*/) ?? ["(no probe fail line)"])[0].slice(0, 220))
check("RTL-VERIF's own devPatch copy produces the same fixed operand shape and boots the MCP tool",
  !rtlPatch.includes("typeof baseUrl") && !rtlPatch.includes("/node_modules/@mpd-dsh/mpd/")
  && /\[t6-mcp-probe\] MCP_TOOL_CALL=ok attempt=1/.test(rtlLog), "")

const result = {
  task: "t6 dev-flavour boot attribution (devPatch fixed vs pre-fix)",
  stamp: new Date().toISOString(),
  artifacts: {
    fixedPatch: "work/dev-fixed.yml (extracted from skills/dsh-qa/scripts/preset-register.mjs)",
    prefixPatch: "work/dev-prefix.yml (extracted from `git show HEAD:skills/dsh-qa/scripts/preset-register.mjs`)",
    fixedBootLog: "work/boot-manual/boot.log",
    prefixBootLog: "work/boot-manual-prefix/boot.log",
    rtlVerifPatch: "work/dev-rtlverif.yml",
    rtlVerifBootLog: "work/boot-rtlverif/boot.log",
  },
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "devboot.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — devboot.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
process.exit(result.allPass ? 0 : 1)
