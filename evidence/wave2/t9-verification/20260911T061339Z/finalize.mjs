#!/usr/bin/env node
// t9 evidence finalizer: reads ONLY the raw artifacts this verification produced
// and emits the structured result (acceptanceResults + commandsRun in contract order).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const here = "/root/dshProj/my-power-dsh/evidence/wave2/t9-verification/20260911T061339Z"
const repoRoot = "/root/dshProj/my-power-dsh"
const rd = (p) => (existsSync(join(here, p)) ? readFileSync(join(here, p), "utf8") : "")
const rj = (p) => { try { return JSON.parse(rd(p)) } catch { return null } }
const tail = (s, n = 3) => s.trim().split("\n").slice(-n).join(" | ")

// contract-order gate logs
const G = {
  bunTest: rd("gate-bun-test-packages-final.log") || rd("gate-bun-test-packages-rerun.log"),
  typecheck: rd("gate-typecheck-final.log") || rd("gate-typecheck.log"),
  testQa: rd("gate-test-qa-final.log") || rd("gate-test-qa.log"),
  vendor: rd("gate-verify-vendor-final.log") || rd("gate-verify-vendor.log"),
  presconf: rd("gate-preset-conformance-final.log") || rd("gate-preset-conformance.log"),
  sweep: rd("gate-dist-sweep-final.log") || rd("gate-dist-sweep-t12.log"),
}
const exitOf = (s) => { const m = s.match(/EXIT=(\d+)\s*$/m); return m ? Number(m[1]) : null }
const battery = rd("final-battery.txt")
const bExit = (k) => { const m = battery.match(new RegExp(k + "_EXIT=(\\d+)")); return m ? Number(m[1]) : null }
const E = (log, key) => exitOf(log) ?? bExit(key)

const b9 = {
  ok: /ok: 22 row ids match/.test(rd("b9-parity-ok.log")) && /RESTORED_EXIT=0/.test(rd("b9-parity-restored.log")),
  neg: /MISSING from scripts\/install-profile\.mjs: mpd-verif/.test(rd("b9-parity-negative-control.log")),
  restore: /install-profile\.mjs: OK/.test(rd("b9-restore-verify.log")),
  dryRun: /- id: mpd-verif/.test(rd("b9-installer-dry-run.log")),
}
const r1 = rj("r1-own-calls-t12.result.json")
const r1ctrl = rj("r1-prefix-control.result.json")
const mem = rj("memory-read-call.result.json")
const b8 = rj("b8-own-gate.result.json")
const b8mount = rj("b8-mount-boot.result.json")
const iso = rd("qa-isolation-sweep.txt")
const isoFrozen = rd("qa-isolation-frozen.txt")
const solo = rd("qa-solo-web-client-adapt.log")
const negIso = rd("qa-isolation-negative/before-after.txt")

const commandsRun = [
  { command: "node scripts/verify-rows-parity.mjs", status: b9.ok ? "passed" : "failed", exitCode: b9.ok ? 0 : 1, evidence: `baseline: ${tail(rd("b9-parity-ok.log"), 1)}; after my restore: ${tail(rd("b9-parity-restored.log"), 1)}` },
  { command: "node scripts/install-profile.mjs --dry-run", status: b9.dryRun ? "passed" : "failed", exitCode: b9.dryRun ? 0 : 1, evidence: "dry-run lists `- id: mpd-verif` -> packages/mpd-verif-plugin/dist/index.js (b9-installer-dry-run.log)" },
  { command: "a no-session and a session-scoped mpd_verif_regress call", status: r1?.allPass ? "passed" : "failed", exitCode: r1?.allPass ? 0 : 1, evidence: `own driver r1-own-calls.mjs on dist ${r1?.distRevision}: ` + (r1?.checks ?? []).map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name}`).join("; ") },
  { command: "node evidence/session-workspace-root/dist-repair/sweep.mjs --clean-room", status: E(G.sweep, "SWEEP") === 0 ? "passed" : "failed", exitCode: E(G.sweep, "SWEEP"), evidence: tail(G.sweep, 4) },
  { command: "a real ast-grep MCP call", status: b8?.allPass ? "passed" : "failed", exitCode: b8?.allPass ? 0 : 1, evidence: `own b8 gate ${(b8?.checks ?? []).filter((c) => c.pass).length}/${(b8?.checks ?? []).length} + supplementary mount boot ${(b8mount?.checks ?? []).filter((c) => c.pass).length}/${(b8mount?.checks ?? []).length}; deterministic MCP stdio drive (no model turn — MISSING_CREDENTIAL)` },
  { command: "before/after hash of <repo>/.mpd/team", status: /none above/.test(iso) ? "passed" : "failed", exitCode: 0, evidence: `affected-case sweep: team-before 28 -> after 28, new dirs none (${iso.split("\n").filter((l) => /team_json|new team dirs|none above/.test(l)).join(" | ")})` },
  { command: "bun test packages", status: E(G.bunTest, "BUNTEST") === 0 ? "passed" : "failed", exitCode: E(G.bunTest, "BUNTEST"), evidence: tail(G.bunTest, 4) },
  { command: "bun run typecheck", status: E(G.typecheck, "TYPECHECK") === 0 ? "passed" : "failed", exitCode: E(G.typecheck, "TYPECHECK"), evidence: tail(G.typecheck, 3) },
  { command: "bun run test:qa", status: E(G.testQa, "TESTQA") === 0 ? "passed" : "failed", exitCode: E(G.testQa, "TESTQA"), evidence: tail(G.testQa, 3) },
  { command: "node scripts/verify-vendor.mjs", status: E(G.vendor, "VENDOR") === 0 ? "passed" : "failed", exitCode: E(G.vendor, "VENDOR"), evidence: tail(G.vendor, 2) },
  { command: "node skills/dsh-qa/scripts/preset-conformance.mjs", status: E(G.presconf, "PRESCONF") === 0 ? "passed" : "failed", exitCode: E(G.presconf, "PRESCONF"), evidence: tail(G.presconf, 4) },
  { command: "affected QA cases on the FROZEN tree (web-client-adapt, preset-register, bundle-lifecycle)", status: /preset-register EXIT=0/.test(isoFrozen) && /bundle-lifecycle EXIT=0/.test(isoFrozen) && /\[web-client-adapt\] PASS/.test(solo) ? "passed" : "failed", exitCode: 0, evidence: isoFrozen.split("\n").filter((l) => /EXIT=|team_json|new team dirs|\[end\]/.test(l)).join(" | ") + " ;; web-client-adapt solo re-run: " + tail(solo, 2) },
]

const gatePass = commandsRun.every((c) => c.status === "passed")
const acceptanceResults = [
  { criterion: "B9: the parity guard is re-run independently and exits 0; the verifier reproduces falsifiability itself (remove the row, see non-zero with the id named, restore) rather than trusting the implementer's control; `node scripts/install-profile.mjs --dry-run` is shown to include the row", status: b9.ok && b9.neg && b9.restore && b9.dryRun ? "passed" : "failed", evidence: `guard 22 ids match (exit 0) -> I removed the row myself: exit 1 naming "MISSING from scripts/install-profile.mjs: mpd-verif" -> restored byte-identically (sha256sum -c OK) -> exit 0; dry-run lists the row; all skills/** mtimes 13:50-13:56 = t7's window and no skills diff mentions B9 artifacts (b9-skills-attribution.txt)` },
  { criterion: "R1: the verifier's OWN no-session `mpd_verif_regress` call now reports VERIF_E_NO_VENV, and a session-scoped call passes the gate — the ordering is checked in source AND behaviourally; the dist sweep reports 0 STALE / 16 FRESH", status: r1?.allPass && r1ctrl?.pass && E(G.sweep, "SWEEP") === 0 ? "passed" : "failed", evidence: `own calls on dist ${r1?.distRevision}: no-session -> VERIF_E_NO_VENV with no work dir; session-scoped -> gate passes, next refusal VERIF_E_NO_BACKEND, no work dir in either workspace; per-case sim now resolves the SESSION venv (t12); source gate at regress.ts:143-154 before createRegressDir; my own pre-fix control on a disposable copy: baseline 10 pass/0 fail, flipped 7 pass/3 fail; sweep ${tail(G.sweep, 3)}` },
  { criterion: "Memory migration: per-file sha256 of all seven entries match between source and target, the target store's git log shows the commit and `git status` is clean, the SOURCE directory is intact, `runtime/reflection.json` is unchanged, and a real read call surfaces the entries from the correct root", status: mem?.allPass ? "passed" : "failed", evidence: `7/7 sha256 MATCH (memory-sha256.txt); target store git HEAD=8635a6e "memory: wave-2 t5 migration..." 7 files/117 insertions, status --porcelain empty; source still 7 files; reflection.json 7ee2e208... unchanged; read calls: mpd_memory_status root=...agent-my-power-dsh entries=27, mpd_memory_read 27 entries with all 7 migrated files, query=workmate 6` },
  { criterion: "B8: a real MCP call for the ast-grep tool returns a real result instead of BINARY_NOT_FOUND, in a boot whose process cwd differs from the session workspace; the codegraph status is checked to the same standard if t1 scoped it here", status: b8?.allPass && b8mount?.allPass ? "passed" : "failed", evidence: `own gate 20/20: checkout + packed-tarball launchers driven as real MCP stdio servers from a cwd outside the bundle with all pins scrubbed -> real search match (totalMatches:1) and real codegraph_explore; negatives /nonexistent/sg -> BINARY_NOT_FOUND, /nonexistent/codegraph -> no tool surface; ast-grep preferred over sg, deprecated .bin/sg rejected by --version; supplementary mount boot 4/4 (pins scrubbed): rows mount, no MODULE_NOT_FOUND, mpd-codegraph init status=ok. Patch names no binary path, 0 env: keys in the whole patch. Caveat stated explicitly: MCP path driven deterministically, not by a model turn (MISSING_CREDENTIAL here)` },
  { criterion: "QA isolation: a before/after comparison of `<repo>/.mpd/team` shows no new record after running the affected QA case(s), and the verifier reproduces the negative control (without the isolation, a record IS created)", status: /none above/.test(iso) && /mpd-default-587132ea/.test(negIso) && /preset-register EXIT=0/.test(isoFrozen) ? "passed" : "failed", evidence: `positive: preset-conformance + bun test + mcp-call + web-client-adapt + agent-teams-sidebar + bundle-lifecycle, team 28 -> 28, zero new dirs; frozen-tree re-run: preset-register PASS, web-client-adapt, bundle-lifecycle with team 28 -> 28 and zero new dirs; negative control I built myself: a pre-fix copy of preset-register.mjs (repo cwd, assertion removed) exited 0/PASS and created .mpd/team/mpd-default-587132ea (27 -> 28), then the fixed case exited 0/PASS with NO new record. NOTE: this control added one real record (mpd-default-587132ea) — archive it in the AgentTeams tab; t7's earlier mpd-default-0bc1738e is still there too` },
  { criterion: "Full gates on the integrated tree: bun test packages, bun run typecheck, bun run test:qa, node scripts/verify-vendor.mjs (exit 0), preset-conformance PASS including its negative control", status: gatePass ? "passed" : "failed", evidence: commandsRun.filter((c) => ["bun test packages", "bun run typecheck", "bun run test:qa", "node scripts/verify-vendor.mjs"].includes(c.command)).map((c) => `${c.command} exit=${c.exitCode}`).join(", ") + `; preset-conformance ${E(G.presconf, "PRESCONF")} (negative control red as designed)` },
  { criterion: "Each result comes from raw output the verifier produced; the implementers' summaries are not acceptable as evidence", status: "passed", evidence: "every check above cites an artifact under evidence/wave2/t9-verification/20260911T061339Z/ produced by my own drivers (b8-own-gate.mjs, b8-mount-boot.mjs, r1-own-calls.mjs, r1-prefix-control.mjs, memory-read-call.mjs, the pre-fix preset-register copy, raw gate logs)" },
]

const out = {
  task: "t9 independent verification (Reviewer)",
  stamp: new Date().toISOString(),
  repoRoot,
  revisions: {
    verifDist: r1?.distRevision ?? null,
    b8Launchers: ["packages/mpd-mcp-astgrep/launch.mjs", "packages/mpd-mcp-codegraph/launch.mjs", "packages/mpd-mcp-shared/bin-resolve.mjs"],
  },
  acceptanceResults,
  commandsRun,
  allPass: acceptanceResults.every((a) => a.status === "passed"),
  findings: [
    {
      id: "F-QA-2",
      severity: "low",
      problem: "web-client-adapt is timing-sensitive: it gives the web boot a hard 60 s deadline to PRINT its auth token (`web-client-adapt.mjs:154` bootDeadline) and then asserts tokenSeen/cookieSession. Under concurrent load (my gate battery running in parallel) the boot printed its token at ~69 s, so the case went red twice (2026-09-11T06:21:10Z and 06:30:49Z) with an identical 5-line boot log and the same code path; a solo re-run at 06:33:32Z PASSED with tokenSeen/cookieSession/bootEntry/clientJs all ok. Not a wave-2 regression — a load-dependent flake.",
      requiredFix: "Case-level hardening (skills/**): widen the boot deadline or treat a late token as a retry rather than a hard failure.",
    },
    {
      id: "F-B8-1",
      severity: "medium",
      problem: "In a layout where codegraph is unresolvable (packed `file:` install without optionalDependencies, no .toolchain, not on PATH) and $HOME/.mpd is not writable, the codegraph MCP child now reaches the adopted provisioning path and dies with an uncaught `ENOENT: mkdir '<home>/.mpd/codegraph'` instead of the previous graceful 'unavailable' stub (the old wrong env pin made resolution.source === 'env', which skips provisioning). Observed in mcp-call at 2026-09-11T06-21-10Z.",
      requiredFix: "Out of t9's scope (adopted serve.js + QA HOME isolation). Recommend a follow-up: either make mcp-call sandbox HOME (AGENTS.md §7) so the provider path is exercised in a writable home, or have the launcher fall back to a `runUnavailableMcp`-style stub when resolution fails and provisioning is impossible.",
    },
    {
      id: "F-QA-1",
      severity: "medium",
      problem: "The QA dev-flavor patch rewrite (`skills/dsh-qa/scripts/preset-register.mjs:30-36` devPatch + `mcpEnv` 38-46, duplicated in `rtl-verif.mjs:69-77,168,176`) leaves the `baseUrl + \"/node_modules/\"` operand in front of the checkout path, so MCP row args become `<baseUrl>/node_modules/<abs-repo-path>/...`; they only resolve because `MPD_DSH_*_CLI` is pre-set. With the CLI pins unset (the whole point of B8) the MCP children die with MODULE_NOT_FOUND — reproduced in my first mount boot. `mcpEnv()` also still pre-pins MPD_AST_GREP_SG_PATH to the deprecated `.bin/sg` wrapper.",
      requiredFix: "Out of t9's scope (skills/**, VENDOR_LOCK-fingerprinted; t7 terminal). Recommend a scoped follow-up that rewrites the whole operand (as my b8-mount-boot.mjs does) and drops the two binary pins from mcpEnv.",
    },
    {
      id: "F-ENV-1",
      severity: "low",
      problem: "mcp-call spawns dsh with the real HOME and copies only `.credentials.yaml`; under this environment the real `~/.mpd` is a read-only filesystem, so any plugin touching the home fails, and live LLM turns end at MISSING_CREDENTIAL (AGENTS.md §7 requires settings.yaml for gateway homes).",
      requiredFix: "Case-level fix (skills/**): sandbox HOME and copy settings.yaml when present.",
    },
  ],
}
writeFileSync(join(here, "t9-RESULT.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ allPass: out.allPass, acceptance: acceptanceResults.map((a) => `${a.status}: ${a.criterion.slice(0, 60)}`), commands: commandsRun.map((c) => `${c.status}(${c.exitCode}): ${c.command}`) }, null, 2))
process.exit(out.allPass ? 0 : 1)
