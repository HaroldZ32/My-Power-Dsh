// Applies the t14 edits to scripts/build-mcp.mjs (rename-list ids bm-01..bm-17, sc-lsp, sc-gb, sc-as).
// Every replacement asserts its own occurrence count, so a drift in the file fails LOUDLY
// instead of silently patching the wrong place. Run from the repo root:
//   node evidence/mpd-naming/wave2/raw/apply-t14-edits.mjs
import { readFileSync, writeFileSync } from "node:fs"

const FILE = "scripts/build-mcp.mjs"
const before = readFileSync(FILE, "utf8")

const edits = []
const add = (id, find, replace, count = 1) => edits.push({ id, find, replace, count })

// --- bm-01..bm-16: the narrative label sweep -------------------------------------------
add("bm-01", "// Offline build of ast-grep/git-bash MCP: copy source from the OMO upstream checkout (read-only) into a temp workspace,",
  "// Offline build of ast-grep/git-bash MCP: copy source from the upstream oh-my-openagent checkout (read-only) into a temp workspace,")
add("bm-02", "// MPD_UPSTREAM_ROOT when the checkout lives elsewhere; the actual OMO checkout layout used here is",
  "// MPD_UPSTREAM_ROOT when the checkout lives elsewhere; the actual upstream checkout layout used here is")
add("bm-03", "// --- MPD scrub (t3 Phase B, captain-approved): post-bundle OMO->MPD transform ---------",
  "// --- MPD scrub (t3 Phase B, captain-approved): post-bundle upstream-spelling -> MPD_ prefix rename ---------")
add("bm-04", "// The pristine upstream source still uses OMO_* identifiers; the committed dists were",
  "// The pristine upstream source still uses its own OMO_* spellings; the committed dists were")
add("bm-05", "// hand-scrubbed OMO->MPD by commit 7d8f910 (direct dist edits, no rebuild), and AGENTS.md",
  "// hand-scrubbed into the MPD_ prefix by commit 7d8f910 (direct dist edits, no rebuild), and AGENTS.md")
add("bm-06", "// such as \"from\" or the OMO_CODEX_* codex contract kept literal in git-bash).",
  "// such as \"from\" or the git-bash launcher-path env key).")
add("bm-07", "    // OMO_CODEX_* is the codex contract and stays literal; only the tmpdir prefix changes.\n    replace: [[\"omo-git-bash-run-\", \"mpd-git-bash-run-\"]],\n    residual: [\"omo-git-bash-run-\"],",
  "    // The upstream git-bash env contract is DELETED (DSH-only, owner ruling (c)): its OMO_CODEX_* reads,\n    // the install hint that named the key and the two allowlist entries go with it. What remains is the\n    // artifact's own name and the tmpdir prefix, both renamed into the mpd spelling.\n    replace: [\n      [\"omo-git-bash\", \"mpd-git-bash\"],\n      // gb-01: the env-key declaration\n      [\"var GIT_BASH_ENV_KEY = \\\"OMO_CODEX_GIT_BASH_PATH\\\";\\n\", \"\"],\n      // gb-02: the env-lookup tier of the resolver (the remaining tiers stay)\n      [\"  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY);\\n  if (envPath !== undefined) {\\n    checkedPaths.push(envPath);\\n    if (isBashExePath(envPath) && input.exists(envPath)) {\\n      return { found: true, path: envPath, source: \\\"env\\\", checkedPaths };\\n    }\\n    return missingGitBash(checkedPaths);\\n  }\\n\", \"\"],\n      // gb-03: the install hint named the deleted key (the trailing comma goes with the line)\n      [\"      \\\"Install it with: winget install --id Git.Git -e --source winget\\\",\\n      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\\\\\\\path\\\\\\\\to\\\\\\\\bash.exe`\\n\", \"      \\\"Install it with: winget install --id Git.Git -e --source winget\\\"\\n\"],\n      // gb-04: the two OMO_ timeout keys; the two unprefixed keys predate this wave and stay\n      [\"  \\\"OMO_CODEX_GIT_BASH_TIMEOUT_MS\\\",\\n  \\\"OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n  \\\"CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n\", \"  \\\"CODEX_EXEC_COMMAND_TIMEOUT_MS\\\",\\n\"],\n    ],\n    residual: [\"omo-git-bash\", \"OMO_CODEX_\"],")
add("bm-08", "// Apply the key-level OMO->MPD scrub to a built cli.js, then assert no residual remains",
  "// Apply the key-level upstream -> MPD_ prefix scrub to a built cli.js, then assert no residual remains")
add("bm-09", "      console.error(`[build-mcp] FAIL - ${serverName} dist still contains OMO residual \"${residual}\" after MPD scrub`)",
  "      console.error(`[build-mcp] FAIL - ${serverName} dist still contains upstream brand token \"${residual}\" after the MPD scrub`)")
add("bm-10", "// knows, so a rebuild could still silently ship an upstream OMO token the list has never",
  "// knows, so a rebuild could still silently ship an upstream brand token the list has never")
add("bm-11", "// DELIBERATELY OUT OF SCOPE: `platformFrmpdOptions`. Our older global omo->mpd rewrite corrupted",
  "// DELIBERATELY OUT OF SCOPE: `platformFrmpdOptions`. Our older global upstream-spelling -> mpd rewrite corrupted")
add("bm-12", "// \"romO\" is preceded by an alphanumeric. Case-insensitive so `_omo` and `OMO_*` both hit.",
  "// \"romO\" is preceded by an alphanumeric. Case-insensitive, so both the `OMO_` and the `omo-` shapes are hit.")
add("bm-13", "// would reject the legitimate committed bytes: lsp carries 5 x `_omo` + 2 x the upstream OpenCode\n// identifier, git-bash 3 x OMO_CODEX_*).",
  "// would reject the legitimate committed bytes: lsp carries the upstream OpenCode\n// identifier and no brand token, git-bash none).")
add("bm-14", "    // MPD scrub: apply the key-level OMO->MPD rename (if any) so the shipped dist",
  "    // MPD scrub: apply the key-level upstream -> MPD_ prefix rename (if any) so the shipped dist")
add("bm-15", "      // Provenance, not prose: the upstream OMO commit this dist was built from (VENDOR_LOCK.json",
  "      // Provenance, not prose: the upstream commit this dist was built from (VENDOR_LOCK.json")
add("bm-16", "      // pins the same 8c57e46 baseline). It used to hold an OMO->mpd scrub artefact, not a real value.",
  "      // pins the same 8c57e46 baseline). It used to hold a scrub artefact, not a real value.")

// --- bm-17: the allowlist becomes empty by design ---------------------------------------
add("bm-17", `export const BRAND_ALLOWLIST = [
  { token: "OMO_CODEX_GIT_BASH_PATH", artifact: "git-bash", reason: "X1 #1 (b): codex's env key (GIT_BASH_ENV_KEY); renaming it breaks the codex side's env reads" },
  { token: "OMO_CODEX_GIT_BASH_TIMEOUT_MS", artifact: "git-bash", reason: "X1 #2 (b): same codex env contract, timeout key" },
  { token: "OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS", artifact: "git-bash", reason: "X1 #3 (b): same codex env contract, exec-timeout key" },
  { token: "_omo", artifact: "lsp", reason: "X1 #4 (b): the LSP daemon's auth-envelope wire key (params._omo, stripped before dispatch); renaming one side only breaks auth" },
]`,
  `export const BRAND_ALLOWLIST = []
// Empty by design: every remaining brand-shaped literal in the scanned artifacts is either
// scrubbed away by the MPD_SCRUB tables above or an upstream-scope / build-time literal
// declared there. The empty list is ASSERTED, not assumed -- assertBrandClean below still
// fails loudly on any brand token that survives the scrub (the negative control seeds one).`)

// --- sc-lsp: make a rebuild reproduce the renamed envelope ------------------------------
add("sc-lsp", `      ["omo/ping", "mpd/ping"],
    ],
    residual: ["OMO_", ".omo", "omo-lsp", "omo/ping"],`,
  `      ["omo/ping", "mpd/ping"],
      // The LSP auth envelope is renamed on BOTH sides (writer + reader/stripper live in this
      // same artifact), so a rebuild must emit _mpd and a re-introduced _omo must fail loudly.
      ["_omo", "_mpd"],
    ],
    residual: ["OMO_", ".omo", "omo-lsp", "omo/ping", "_omo"],`)

// --- sc-as: the committed ast-grep dist already reads the MPD forms ---------------------
add("sc-as", `      ["omo-ast-grep", "mpd-ast-grep"],
    ],
    residual: ["OMO_", ".omo", "omoRuntime", "omo-runtime", "omo-ast-grep"],`,
  `      ["omo-ast-grep", "mpd-ast-grep"],
      // The committed dist already reads the MPD forms here, so a pristine rebuild must be
      // scrubbed into them or the byte-equality guard fails.
      ["an OMO session", "an MPD session"],
      ["OMO runtime", "MPD runtime"],
    ],
    residual: ["OMO_", ".omo", "omoRuntime", "omo-runtime", "omo-ast-grep", "OMO session", "OMO runtime"],`)

let out = before
for (const { id, find, replace, count } of edits) {
  const seen = out.split(find).length - 1
  if (seen !== count) {
    console.error(`[apply-t14] FAIL ${id}: expected ${count} occurrence(s), found ${seen}`)
    console.error(`[apply-t14]   looking for: ${JSON.stringify(find.slice(0, 140))}`)
    process.exit(1)
  }
  out = out.split(find).join(replace)
}
writeFileSync(FILE, out)
console.log(`[apply-t14] ${edits.length} edits applied to ${FILE}`)
