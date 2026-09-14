# Wave-2 t11 — atomic commit plan (wave 1 + wave 2, ONE reconciled plan) — NOT executed

Base: `dev` @ `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7` (the only revision either wave started from).
Recommended branch: **`fix/wave1-wave2-closeout`** created from `dev`.
Nothing in this plan was executed: no commit, no push, no tag, no release branch.

Why one branch and not one-per-defect: **(1)** `VENDOR_LOCK.json` is ONE file whose final content covers
every `skills/**` change in both waves, and the vendor gate hashes the whole `skills/**` tree — so all
skills edits and the lock must land together; **(2)** `packages/mpd-verif-plugin/dist/index.js` bundles
B1's exec threading, B3's lossless JSON AND R1's gate ordering, and several other dists inline the
adapter rebuilt by B1 — splitting those needs hunk surgery on generated files. Wave 1's own plan reached
the same conclusion (`evidence/verification/t11-integration/commit-plan.md`), and this plan supersedes it
rather than emitting a second, partial one.

## Commits (order matters; every commit is green at its own HEAD)

| # | Commit message | Paths |
|---|---|---|
| 1 | `fix(adapter): resolve the workspace root from the calling session` | `packages/mpd-dsh-adapter-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-bootstrap-plugin/dist/index.js`, `packages/mpd-roles-plugin/dist/index.js`, `packages/mpd-tools-plugin/dist/index.js`, `packages/mpd-qa-roles-probe/dist/index.js` (the four are dependent dist rebuilds that inline the adapter) |
| 2 | `fix(bline): follow the session workspace in boulder, config, comment-checker, memory, modelchain, ulw and workmate` | `packages/mpd-{boulder,config,comment-checker,memory,modelchain,ulw,workmate}-plugin/{src/index.ts,dist/index.js}` |
| 3 | `fix(verif): session-scoped roots, lossless backend JSON and the cocotb gate order` (B1 + B3 + R1 + R1-F1) | `packages/mpd-verif-plugin/src/**`, `packages/mpd-verif-plugin/test/**` (incl. new `lossless.test.ts`), `packages/mpd-verif-plugin/dist/index.js`, `evidence/fix/verif-tool-lossless/**`, `evidence/wave2/r1-gate-order/**`, `evidence/wave2/r1-f1-exec-forward/**` |
| 4 | `fix(hashline): session-scoped paths and a oneOf lines schema` (B1 + B4) | `packages/mpd-hashline-plugin/{src/index.ts,dist/index.js,test/tool-schema.test.ts}`, `evidence/hashline/**` |
| 5 | `fix(qa): isolate the workspace in the QA harness and re-pin the skills fingerprint` (B2 + QA isolation + t11's `settings.yaml` copy) | **all of `skills/**`** (`skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/{lib/workspace-isolation.mjs,agent-teams-sidebar,codegraph-smoke,dual-track-smoke,mcp-call,preset-conformance,preset-register,web-client-adapt,workmate-library}.mjs`), **`VENDOR_LOCK.json`** (skills → 366 files / `5b13e920…`), `scripts/verify-vendor.mjs`, `evidence/wave2/qa-workspace-isolation/**`, `evidence/verification/t9-b2-b6/**` |
| 6 | `fix(mcp): resolve the ast-grep/codegraph binaries inside the MCP launchers` (B8) | `packages/mpd-mcp-astgrep/{launch.mjs,README.md,README.zh-CN.md}`, `packages/mpd-mcp-codegraph/{launch.mjs,README.md,README.zh-CN.md}`, `packages/mpd-mcp-shared/**` (resolver + its test), `packages/mpd-bundle/cordis.patch.yml`, `packages/mpd-codegraph-plugin/{src/index.ts,dist/index.js,README.md,README.zh-CN.md}`, `scripts/pack-mpd.mjs` (ships the launchers/resolver + mode normalization), `evidence/wave2/b8-binary-resolution/**` |
| 7 | `fix(installer): add the mpd-verif row and a row-parity guard` (B9) | `scripts/install-profile.mjs`, `scripts/verify-rows-parity.mjs` (new), `package.json` (the `verify:rows` script), `evidence/wave2/b9-installer-parity/**` |
| 8 | `fix(agent-teams): expand inScope globs, forbid contradictory contracts, expose a running task's contract` (adopted deltas + durability guard) | `packages/mpd-agent-teams-plugin/lib/{quality-gates.js,tools.js,mpd-deltas.js}`, `packages/mpd-agent-teams-plugin/self-fix-tests/**`, `packages/mpd-agent-teams-plugin/test/task-contract-tool.test.mjs`, `scripts/patch-agent-teams-fixes.mjs` (new), `scripts/vendor-agent-teams.mjs`, `evidence/wave2/adopted-tooling/**`, `evidence/wave2/adopted-tooling-repair/**`, `evidence/wave2/adopted-tooling-repair-f4/**`, `evidence/wave2/adopted-tooling-repair-f4-sibling/**` |
| 9 | `docs(agents): correct the vendor-refresh mechanism, transcribe the adaptation list, rewrite the B8 rows` | `AGENTS.md` (§6 exception + A1–A6/D1–D12 + the 9-region note; §12 ast-grep + codegraph rows; §7 already carries the workspace-isolation rule from commit 5) |
| 10 | `test(evidence): record the wave-1 and wave-2 verification, review and integration evidence` | `evidence/verification/**`, `evidence/session-workspace-root/**`, `evidence/agent-teams/**`, `evidence/wave2/t8-verification/**`, `evidence/wave2/t9-verification/**`, `evidence/wave2/t10-review/**`, `evidence/wave2/t11-integration/**`, `evidence/dsh-qa/**` (incl. the tracked `llm-dual-track/dual-track.tsv`), `evidence/plan-f/**` |

## VENDOR_LOCK pairing rule (release-checklist line — state it verbatim)

> **`VENDOR_LOCK.json` must land in the SAME commit as every `skills/**` change that invalidates its
> `treeSha`.** The vendor gate hashes the whole `skills/**` tree, so a commit that edits skills and
> leaves the lock stale is RED at that commit; conversely the lock may not be committed before the
> skills tree reaches its final state. In this plan the pairing is **commit 5**: it carries every
> `skills/**` change from both waves AND the re-pinned `VENDOR_LOCK.json` (skills: 366 files,
> `treeSha 5b13e92091e38ed8a001c08b11cd8fc73f650041260ad7fc519c782ab6a6ef45`, previously `54155e41…`
> from t7's first re-pin and `29a6877c…` at HEAD). `scripts/verify-vendor.mjs` lands there too because
> it is the gate that computes the re-pin. No other commit may touch `skills/**` or `VENDOR_LOCK.json`.

Note: the memory migration (t5) writes ONLY under `.mpd/memory/agents/agent-my-power-dsh/repo/memory/`
— the memory store's own git repo, already committed there as `8635a6e` (7 files / 117 insertions). It
contributes no path to this repository's commit plan.

## Untracked-path disposition (every `??` entry is either assigned above or justified)

- Assigned to commits 3–10: `evidence/{fix,hashline,session-workspace-root,verification,agent-teams,wave2,dsh-qa,plan-f}/**`,
  `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js`, `packages/mpd-agent-teams-plugin/self-fix-tests/scope-glob-and-contract.test.mjs`,
  `packages/mpd-agent-teams-plugin/test/task-contract-tool.test.mjs`, `packages/mpd-hashline-plugin/test/tool-schema.test.ts`,
  `packages/mpd-mcp-astgrep/launch.mjs`, `packages/mpd-mcp-codegraph/launch.mjs`, `packages/mpd-mcp-shared/**`,
  `packages/mpd-verif-plugin/test/lossless.test.ts`, `scripts/patch-agent-teams-fixes.mjs`,
  `scripts/verify-rows-parity.mjs`, `skills/dsh-qa/scripts/lib/**`.
- **Justified as NOT committable here:** `packages/mpd-agent-teams-plugin/package.json` (untouched this
  wave), `dist/mpd-package/**` (gitignored build output — install artifact, never committed; see the
  pack section of `result.json`), and the two real team records under `.mpd/team/` (gitignored user
  state; the user is asked to archive them in the AgentTeams tab — see the carry-forward list).

## Overlap with wave 1's plan

Wave 1's plan is fully absorbed: its commits 1, 2, 6 (→ this plan 1, 2), 3 (→ 3), 4 (→ 4), 5 (→ 5),
7 (→ 9) and 8 (→ 10). The only additions are wave 2's B8/B9/R1/agent-teams commits (6, 7, 8) and the
folding of wave-2's skills edit into commit 5. No commit from wave 1's plan is dropped or duplicated.
