// t14 verification ledger: runs the contract's three verify commands, the wave's G4/G5 acceptance
// greps, the brand guard on all three committed artifacts (BRAND_ALLOWLIST is now empty by design)
// and the guard's NEGATIVE CONTROL (a seeded brand token must fail loudly).
// Run from the repo root: node evidence/mpd-naming/wave2/raw/verify-t14.mjs
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = process.cwd()
const mod = await import(join(repoRoot, "scripts", "build-mcp.mjs"))
const log = []
const say = (line) => {
  log.push(line)
  console.log(line)
}
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" })
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim()
  return { status: r.status, out }
}

const FILES = ["scripts/build-mcp.mjs", "packages/mpd-mcp-lsp/dist/cli.js", "packages/mpd-mcp-gitbash/dist/cli.js"]

say("### verify 1 — node --check on the three files ###")
for (const f of FILES) {
  const r = run("node", ["--check", f])
  say(`  node --check ${f} -> exit ${r.status}${r.out ? " | " + r.out.split("\n")[0] : " | no output"}`)
}

say("")
say('### verify 2 — git grep -n -E "OMO_CODEX|_omo" over the three files (expect NO output) ###')
const v2 = run("git", ["grep", "-n", "-E", "OMO_CODEX|_omo", "--", ...FILES])
say(`  exit ${v2.status} | output: ${v2.out === "" ? "(none)" : v2.out}`)

say("")
say('### verify 3 — git grep -n -E "OMO|oh-my-opencode" over scripts/build-mcp.mjs ###')
const v3 = run("git", ["grep", "-n", "-E", "OMO|oh-my-opencode", "--", "scripts/build-mcp.mjs"])
say(`  exit ${v3.status}`)
for (const line of v3.out.split("\n").filter(Boolean)) say("    " + line)

say("")
say("### wave acceptance greps ###")
const g4 = run("sh", ["-c", "grep -n '_omo' packages/mpd-mcp-lsp/dist/cli.js; true"])
say(`  G4 grep '_omo' packages/mpd-mcp-lsp/dist/cli.js -> ${g4.out === "" ? "(no output)" : g4.out}`)
const g5 = run("sh", ["-c", "git ls-files | grep -v '^evidence/' | xargs grep -n 'OMO_CODEX'; true"])
say(`  G5 grep 'OMO_CODEX' over every shipped file -> ${g5.out === "" ? "(no output)" : g5.out}`)

say("")
say("### brand guard on the three committed artifacts (BRAND_ALLOWLIST is empty by design) ###")
for (const [artifact, p] of [["ast-grep", "packages/mpd-mcp-astgrep/dist/cli.js"], ["git-bash", "packages/mpd-mcp-gitbash/dist/cli.js"], ["lsp", "packages/mpd-mcp-lsp/dist/cli.js"]]) {
  const text = readFileSync(join(repoRoot, p), "utf8")
  const tokens = mod.brandTokens(text)
  const scan = mod.scanBrandTokens(text)
  const res = mod.assertBrandClean(artifact, text)
  say(`  ${artifact}: brandTokens=${JSON.stringify(tokens)} identifiers=${scan.identifiers} -> assertBrandClean ok (${JSON.stringify(res)})`)
}

say("")
say("### negative control — a seeded brand token MUST fail loudly ###")
const seededText = "var ok = 1;\n" + 'var seeded = "OMO_DAEMON_PROTOCOL_VERSION";' + "\n"
const r = run("node", ["--input-type=module", "-e",
  `import { assertBrandClean } from ${JSON.stringify(join(repoRoot, "scripts", "build-mcp.mjs"))};` +
  `assertBrandClean("lsp", ${JSON.stringify(seededText)});` +
  `console.log("NEGATIVE CONTROL DID NOT FAIL");`])
say(`  seeded token in the lsp artifact -> exit ${r.status} (non-zero = the guard fired)`)
say(`  output: ${r.out.split("\n").slice(0, 3).join(" | ")}`)
const negativeOk = r.status !== 0 && /FAIL/.test(r.out)

say("")
say("### per-artifact sha256 (pre-re-pin values; t17 owns VENDOR_LOCK) ###")
for (const p of ["scripts/build-mcp.mjs", ...FILES.slice(1)]) {
  const sha = createHash("sha256").update(readFileSync(join(repoRoot, p))).digest("hex")
  say(`  ${p} sha256=${sha}`)
}

const ok = v2.out === "" && g4.out === "" && g5.out === "" && negativeOk
say("")
say("[verify-t14] overall: " + (ok ? "PASS" : "FAIL"))
process.exit(ok ? 0 : 1)
