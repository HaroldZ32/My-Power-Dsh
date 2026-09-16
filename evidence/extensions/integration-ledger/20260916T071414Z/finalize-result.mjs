#!/usr/bin/env node
// t17 attempt 5: patch result.json to the AMENDED gate list (clean-cwd unit gate; the two
// non-runnable commands recorded as WAIVED with their evidence; attempt-5 lane outputs).
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const file = join(HERE, "result.json")
const r = JSON.parse(readFileSync(file, "utf8"))

r.attempt = 5
r.attempt_id = "e5452a1a-b12e-434a-81fb-8fb0c5cb0dfa"
r.status = "completed"
r.amendment = "Captain amendment (attempt 5): the gate list uses the CLEAN-CWD unit invocation; `bun test packages` (repo cwd) and `bun run test:qa:all` are WAIVED items with their evidence, not run."
r.verdict_summary = "All six deliverables D1-D6 complete, digested, owned and cleared by a terminal PASS review. The AMENDED 15-command gate list is GREEN on the frozen tree, including the clean-cwd unit invocation (755 pass / 0 fail). The packed tree is proven correct; exactly one VENDOR_LOCK re-pin. TWO commands are WAIVED with evidence (the repo-cwd unit run, made red by a pre-existing non-hermetic test plus this workspace's deliberate gitignored .mpd/mpd.jsonc; and bun run test:qa:all, which cannot authenticate on this host) - neither is claimed as passed."

r.gates = [
  { gate: "unit (clean cwd)", command: "bash -c 'cd \"$(mktemp -d)\" && bun test /root/dshProj/my-power-dsh/packages'", exit: 0, status: "passed", detail: "755 pass / 0 fail, 5343 expect calls", raw: "raw/attempt5-unit-clean-cwd.txt" },
  { gate: "verify-vendor", command: "node scripts/verify-vendor.mjs", exit: 0, status: "passed", raw: "raw/attempt5-verify-vendor.txt" },
  { gate: "verify-docs-parity", command: "node scripts/verify-docs-parity.mjs", exit: 0, status: "passed", detail: "pairs=36 failed=0 violations=0 exempt=16", raw: "raw/attempt5-verify-docs-parity.txt" },
  { gate: "verify-rows-parity", command: "node scripts/verify-rows-parity.mjs", exit: 0, status: "passed", detail: "25 row ids match", raw: "raw/attempt5-verify-rows-parity.txt" },
  { gate: "ext-cli-self-test", command: "bun scripts/mpd-ext.mjs --self-test", exit: 0, status: "passed", detail: "52 checks", raw: "raw/attempt5-mpd-ext-selftest.txt" },
  { gate: "validate-example", command: "bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example", exit: 0, status: "passed", raw: "raw/attempt5-validate-example.txt" },
  { gate: "validate-template", command: "bun scripts/mpd-ext.mjs validate templates/mpd-extension", exit: 0, status: "passed", raw: "raw/attempt5-validate-template.txt" },
  { gate: "pack-closure-self-test", command: "node scripts/verify-pack-closure.mjs --self-test", exit: 0, status: "passed", detail: "6/6 arms", raw: "raw/attempt5-pack-closure-selftest.txt" },
  { gate: "pack-closure", command: "node scripts/verify-pack-closure.mjs", exit: 0, status: "passed", detail: "17 dist rows + 1 adopted lib row + 4 mcp rows; allowlist carries no templates/ entry", raw: "raw/attempt5-pack-closure.txt" },
  { gate: "packer", command: "node scripts/pack-mpd.mjs", exit: 0, status: "passed", detail: "dist/mpd-package staged", raw: "raw/attempt5-pack-mpd.txt" },
  { gate: "lane-bundle-lifecycle", command: "bun skills/dsh-qa/scripts/bundle-lifecycle.mjs", exit: 0, status: "passed", detail: "ok:true - evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-27-41.147Z/", raw: "raw/attempt5-lane-bundle-lifecycle.txt" },
  { gate: "lane-extension-template", command: "bun skills/dsh-qa/scripts/extension-template.mjs", exit: 0, status: "passed", detail: "ok:true - evidence/extensions/extension-template/2026-09-16T07-27-58.479Z/", raw: "raw/attempt5-lane-extension-template.txt" },
  { gate: "lane-extension-lifecycle", command: "bun skills/dsh-qa/scripts/extension-lifecycle.mjs", exit: 0, status: "passed", detail: "ok:true - evidence/extensions/extension-lifecycle/2026-09-16T07-28-04.884Z/", raw: "raw/attempt5-lane-extension-lifecycle.txt" },
  { gate: "lane-extension-mcp-bridge", command: "bun skills/dsh-qa/scripts/extension-mcp-bridge.mjs", exit: 0, status: "passed", detail: "ok:true - evidence/extensions/extension-mcp-bridge/2026-09-16T07-28-37.428Z/", raw: "raw/attempt5-lane-extension-mcp-bridge.txt" },
  { gate: "evidence-d6-row", command: "node evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs --json-out <ledger dir>/raw/prober-positive.json", exit: 0, status: "passed", detail: "26 field probes, 0 findings", raw: "raw/attempt5-prober.txt" },
]

r.waived_gates = [
  {
    id: "waived-a",
    command: "bun test packages (from the REPO cwd)",
    reason: "PRE-EXISTING, non-hermetic test: packages/mpd-config-plugin/test/settings-wiring.test.ts:352 and :419 assert that <cwd>/.mpd/mpd.jsonc does not exist, while this workspace deliberately HAS that gitignored file (the captain's watchdog tuning). The plugin and its tests are outside this wave's change set and unchanged since a647d47.",
    readings: { repo_cwd: "753 pass / 2 fail", same_file_clean_cwd: "23 pass / 0 fail", whole_suite_clean_cwd: "755 pass / 0 fail (exit 0)" },
    evidence: ["raw/gate-bun-test-packages.txt", "raw/control-config-test-clean-cwd.txt", "raw/control-bun-test-packages-clean-cwd.txt", "raw/attempt5-unit-clean-cwd.txt"],
    replacement: "the clean-cwd invocation is row 1 of the amended gate list and exited 0",
  },
  {
    id: "waived-b",
    command: "bun run test:qa:all",
    reason: "NOT runnable on this host: aborts at lane 1 of 27 (agent-teams-adopt) with MISSING_CREDENTIAL: llm-deepseek: no API key for provider route \"deepseek-official\"; DEEPSEEK_API_KEY is unset and ~/.dsh/.credentials.yaml carries no entry for that route. The aborting lane is untouched by this wave and its boot log shows every wave row mounting correctly. THE SUITE IS NOT CLAIMED AS PASSED.",
    evidence: ["raw/gate-test-qa-all.txt"],
    replacement: "the four wave lanes were run individually (rows 11-14), all exit 0 / ok:true",
  },
]

r.scope_and_side_effects.created_by_the_mandated_gates = [
  "evidence/plan-c/c1-team/2026-09-16T07-16-22.160Z/ (attempt 2, test:qa:all lane 1)",
  "evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-19-44.444Z/ (attempt 2)",
  "evidence/dsh-qa/preset-conformance/2026-09-16T07-20-00.878Z/ (attempt 2)",
  "evidence/extensions/extension-template/2026-09-16T07-20-35.928Z/ (attempt 2)",
  "evidence/extensions/extension-lifecycle/2026-09-16T07-20-41.691Z/ (attempt 2)",
  "evidence/dsh-qa/bundle-lifecycle/2026-09-16T07-27-41.147Z/ (attempt 5, row 11)",
  "evidence/extensions/extension-template/2026-09-16T07-27-58.479Z/ (attempt 5, row 12)",
  "evidence/extensions/extension-lifecycle/2026-09-16T07-28-04.884Z/ (attempt 5, row 13)",
  "evidence/extensions/extension-mcp-bridge/2026-09-16T07-28-37.428Z/ (attempt 5, row 14)",
]
r.scope_and_side_effects.attempt5_reverification = "branch dev, HEAD 1f38e3c1b8149cecc68f54fae1979f56e1ff2b0f; the 42-entry baseline compared against a fresh manifest: 17/17 tracked modified files unchanged, all frozen evidence dirs stable; only the lane dirs above and this ledger dir moved (raw/attempt5-freeze-manifest.txt)"

writeFileSync(file, JSON.stringify(r, null, 2) + "\n")
process.stdout.write(`result.json patched: attempt 5, ${r.gates.length} gates (all exit 0), ${r.waived_gates.length} waived items\n`)
