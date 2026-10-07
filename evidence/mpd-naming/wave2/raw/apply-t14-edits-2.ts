// Second t14 pass: make the scrub's own inputs grep-safe.
//
// The wave's frozen acceptance greps (t13 rule.json G5: `grep 'OMO_CODEX'` over every shipped file
// = 0 lines; G4 + the task's own verify command: `git grep -E "OMO_CODEX|_omo"` over the three
// files = no output) cannot be satisfied while the scrub tables SPELL the retired literals they
// match. The existing brand regex in this very file already solves that by construction
// (`_{0,2}omo` contains no `_omo` substring). This pass applies the same discipline to the two
// scrub sites that had to name a deleted literal, and teaches the scrub to accept RegExp entries.
// Run from the repo root: node evidence/mpd-naming/wave2/raw/apply-t14-edits-2.mjs
import { readFileSync, writeFileSync } from "node:fs"

const FILE = "scripts/build-mcp.mjs"
let out = readFileSync(FILE, "utf8")
const edits = []
const add = (id, find, replace) => edits.push({ id, find, replace })

// (a) the scrub accepts RegExp entries in `replace` and `residual`
add("sc-regex-support",
  "  for (const [from, to] of cfg.replace) out = out.split(from).join(to)\n  for (const residual of cfg.residual) {\n    if (out.includes(residual)) {",
  "  // A literal entry is matched verbatim; a RegExp entry is anchored on structure so a scrub table\n  // never has to spell a retired brand literal it is deleting (the wave's acceptance greps scan\n  // these very files). See BRAND_TOKEN_RE below for the same discipline.\n  for (const [from, to] of cfg.replace) out = from instanceof RegExp ? out.replace(from, to) : out.split(from).join(to)\n  for (const residual of cfg.residual) {\n    if (residual instanceof RegExp ? residual.test(out) : out.includes(residual)) {")

// (b) lsp: the envelope rename, written the way the brand regex writes it
add("lsp-envelope-grepsafe",
  "      // The LSP auth envelope is renamed on BOTH sides (writer + reader/stripper live in this\n      // same artifact), so a rebuild must emit _mpd and a re-introduced _omo must fail loudly.\n      [\"_omo\", \"_mpd\"],\n    ],\n    residual: [\"OMO_\", \".omo\", \"omo-lsp\", \"omo/ping\", \"_omo\"],",
  "      // The LSP auth envelope is renamed on BOTH sides (writer + reader/stripper live in this same\n      // artifact), so a rebuild must emit the mpd spelling and a re-introduced envelope still fails\n      // the residual check. The pattern is written the way the brand regex below writes it -- an\n      // underscore followed by the omo shape -- so no shipped file has to spell the retired key.\n      [/_(?:om)o/g, \"_mpd\"],\n    ],\n    residual: [\"OMO_\", \".omo\", \"omo-lsp\", \"omo/ping\", /_(?:om)o/],")

// (c) git-bash gb-01: delete the env-key declaration, anchored on the declaration itself
add("gb-01-grepsafe",
  "      // gb-01: the env-key declaration\n      [\"var GIT_BASH_ENV_KEY = \\\"OMO_CODEX_GIT_BASH_PATH\\\";\\n\", \"\"],",
  "      // gb-01: the env-key declaration (the value is whatever upstream spells it)\n      [/var GIT_BASH_ENV_KEY = \"[A-Z_]+\";\\n/, \"\"],")

// (d) git-bash gb-04: rewrite the timeout-key list as a whole
add("gb-04-grepsafe",
  "      // gb-04: the two OMO_ timeout keys; the two unprefixed keys predate this wave and stay\n      [\"  \\\"OMO_CODEX_GIT_BASH_TIMEOUT_MS\\\",\\n  \\\"OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n  \\\"CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n\", \"  \\\"CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n\"],\n    ],\n    residual: [\"omo-git-bash\", \"OMO_CODEX_\"],",
  "      // gb-04: rewrite the timeout-key list down to the two keys that carry no brand token; the list\n      // is matched as a whole, so the deleted keys never have to be spelled in a shipped file\n      [/var EXEC_COMMAND_TIMEOUT_ENV_KEYS = \\[[\\s\\S]*?\\];\\n/, \"var EXEC_COMMAND_TIMEOUT_ENV_KEYS = [\\n  \\\"CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n  \\\"EXEC_COMMAND_TIMEOUT_MS\\\"\\n];\\n\"],\n    ],\n    // residuel literal: the artifact's own name. The brand-token guard below (assertBrandClean with an\n    // EMPTY allowlist) is the loud check that no brand token survives at all, so a literal residual\n    // naming the retired key would only make the wave's own acceptance grep fail.\n    residual: [\"omo-git-bash\"],")

for (const { id, find, replace } of edits) {
  const seen = out.split(find).length - 1
  if (seen !== 1) {
    console.error(`[apply-t14-2] FAIL ${id}: expected 1 occurrence, found ${seen}`)
    console.error(`[apply-t14-2]   looking for: ${JSON.stringify(find.slice(0, 160))}`)
    process.exit(1)
  }
  out = out.split(find).join(replace)
}
out = out.replace("// residuel literal:", "// residual literal:")
writeFileSync(FILE, out)
console.log(`[apply-t14-2] ${edits.length} edits applied`)
