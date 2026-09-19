# Evidence index — wave `agent-teams-adapter-wiring`

Written by the integration lane (team task `t10`, contract lane `t8`) at **2026-09-19T16:24Z**.
Every artifact below is a file on disk; the wave report itself is
`.mpd/plans/agent-teams-adapter-wiring-report.md`. Roots:

- `evidence/agent-teams/adapter-wiring/` — the wave's own evidence (this index's home).
- `evidence/dsh-qa/{bundle-lifecycle,preset-conformance,agent-teams-dispatch}/<stamp>/` — the QA case
  outputs the verification lane produced (fresh stamps of 2026-09-19).
- `evidence/agent-teams/{bridge-tolerance,fixture-repair,qa-credentials-repair}/` — the repair lanes'
  records for the three findings raised mid-wave.

Attribution uses the plan's own numbering (see `requirements-contract.md` §8): contract lanes
`t1`…`t8` = team tasks `t1`, `t4`, `t5`, `t6`, `t7`, `t8`, `t9`, `t10`.

## 1. Freeze — what the wave was contracted to do

| Artifact | Produced by | Proves |
|---|---|---|
| `requirements-contract.md` | requirements seat (contract `t1`, team `t1`) | the frozen AC set (AC1–AC16), the seam inventory, the residual set R1–R5, the inScope map |
| `revision-3-delta.md` | same seat | the in-place revision-3 corrections (the shared-inScope removal) + the hash chain |
| `t3-architecture-note.md` | requirements seat | the architecture review that produced the F-series amendments |
| `review/verdict.md`, `review/result.json` | review round 1 (contract `t7`, team `t9`) | the round-1 verdict: `needs_revision` (14 ACs pass; AC13 failed on a then-stale `VENDOR_LOCK.json`, since re-pinned; AC14 unproven by construction) and its findings |

## 2. Implementation lanes

| Artifact | Produced by | Proves |
|---|---|---|
| `adapter/result.json`, `adapter/verify.log`, `adapter/dist-fresh-after-adapter-src.log`, `adapter/dist-invalidation-proof.txt`, `adapter/post-rebuild-hashes.txt`, `adapter/rebuild-consumer-dists.sh`, `adapter/rebuild-consumer-dists.log`, `adapter/measure-dist-invalidation.sh`, `adapter/harness-shape-verification.md` | adapter lane (contract `t2`, team `t4`) | the fourteen methods + flags in `src/index.ts`, `registerHostTool` verbatim, and the 17-consumer dist rebuild that `verify-dist-fresh` requires |
| `bridge/README.md`, `bridge/result.json` | bridge lane (contract `t3`, team `t5`) | the bridge module, the six bridged files, the registry regeneration — AC3/AC4/AC5/AC6/AC7/AC15 |
| `bridge/region-diff-proof.mjs` + `.log` | bridge lane | zero lines added outside regions (the ten edit-free files byte-identical to HEAD) |
| `bridge/heal-probe.mjs`, `bridge/heal-probe` logs, `bridge/suite-*.log`, `bridge/inventory-*.log`, `bridge/gate-sweep.log`, `bridge/adapter-flag-conformance.mjs` + `.log`, `bridge/guard-lane-crosscheck.mjs` + `.log`, `bridge/f1-context-measurement.mjs` + `.log`, `bridge/rev2-conformance.log`, `bridge/dist-fresh.log`, `bridge/watchdog-fixture-caller-probe.log` | bridge lane | the per-step measurements, including the intermediate REDs kept on purpose (what was diagnosed, not only what passed) |
| `bridge/projections/*.head`, `bridge/projections/*.work` | bridge lane | the region-stripped projections used by `region-diff-proof` |
| `bridge-review/t16-bridge-review.md` | reviewer (read-only) | the bridge's own review round |
| `bridge/round2-repair/{README.md,result.json,item1-gates.log,verification-sweep.log}` | repair lane (contract `t3` follow-up, team `t23`) | the round-2 repair batch (scanner hardening, the counted `childCtx` residual, the repaired fixture) |
| `bridge/round2-repair/{t26-result.json,t26-sweep.log,f4-f5-debug.log}` | repair lane (team `t26`) | the round-3 repair: bilingual closure qualifier, 14-flag lists, the new scanner rules, the `t23` follow-up ownership declaration |
| `registry-restore/20260919T150632Z/{result.json,output.log}` | guard lane (contract `t4`, team `t6`) | AC8: `--check` names a missing registered file, `--write` recreates the bridge byte-faithfully (RULE A) |
| `docs/{README.md,result.json,measure-counts.mjs,measure-counts.log,registry-count.log,verify-docs.log,verify-gates.log}` | docs lane (contract `t5`, team `t7`) | AC9: the closed exception across `AGENTS.md`, `docs/design.md` + `.zh-CN.md`, the deltas reference, the adapter README pair; the measured 151/13 pair |

## 3. Verification lane (the mounting boot + the gate sweep)

| Artifact | Produced by | Proves |
|---|---|---|
| `verification/20260919T152119Z/…` (first full pass) and `verification/20260919T160002Z/…` (the settled re-pass, attempt 7) | verification lane (contract `t6`, team `t8`) | AC10–AC13, AC16 — the per-AC logs, the instrumented boots, the settled-hash records |
| `…/ac10-bundle-lifecycle.log`, `…/ac10-enabled-boot.log`, `…/adapter-enabled-boot.mjs`, `…/adapter-enabled-result.json` | verification lane | AC10: the mounting boot with 21/21 tools, the mounted witness once, zero fallback witnesses |
| `…/ac11-adapter-disabled.log`, `…/adapter-disabled-boot.mjs`, `…/adapter-disabled-result.json` | verification lane | AC11: the negative control (adapter row disabled → exactly ONE absent witness) |
| `…/ac12-preset-conformance.log` | verification lane | AC12: the `mpd` preset mounts with every harness-owned row config valid |
| `…/ac13-*.log`, `…/ac13-tests-comparison.log`, `…/ac-three-arm-and-bridge-tests.log`, `…/ac-scope-and-bridge-tests.log` | verification lane | AC13: the static/suite gates and the package suites |
| `…/ac16-settled-hashes.log`, `…/start*.txt`, `…/end*.txt`, `…/recheck-24.txt` | verification lane | AC16: the settled revision, including the `AGENTS.md` drift it detected and re-anchored |
| `…/credentials-merge-repro.mjs`, `…/credentials-merge-repro.log` | verification lane + repair lane | the credential-merge finding and its repro |
| `…/install.log`, `…/verif-probe.mjs`, `…/v1-before-after.log` | verification lane | the QA sandbox mechanics (isolation asserted) |
| `evidence/dsh-qa/bundle-lifecycle/<stamp>/`, `evidence/dsh-qa/preset-conformance/<stamp>/`, `evidence/dsh-qa/agent-teams-dispatch/<stamp>/` | verification lane | the untouched QA cases' own outputs for the same stamps |

## 4. Review

| Artifact | Produced by | Proves |
|---|---|---|
| `review/round2/verdict.md`, `review/round2/result.json`, `review/round2/logs/**` | review (team `t9`/`t16` round 2 → task `t24`) | the round-2 verdict: `needs_revision` (15 ACs pass, AC14 unproven; findings F2–F5) and the standing evidence for the bytes that did not change afterwards |
| `review/round3/verdict.md`, `review/round3/result.json`, `review/round3/logs/**` (hash table, settle sandwich, closure census, scanner probe, gate logs) | review (team `t27`) | **VERDICT pass** on AC1–AC13/AC15/AC16 on the settled revision; AC14 carried by this lane; the two non-blocking observations |

## 5. Integration (this lane)

| Artifact | Proves |
|---|---|
| `integration/settle-sandwich.sh` + `settle-sandwich.log` | the revision is settled: START `16:22:53Z` == END `16:23:43Z`, 18 files identical |
| `integration/pack.log` | `node scripts/pack-mpd.mjs` exit 0; 1194 files staged into `dist/mpd-package` |
| `integration/pack-bytes-proof.mjs` + `pack-bytes-proof.log` | the bridge, the six bridged files, all 55 adopted `lib/**` files and all `packages/*/dist/**` entries are byte-identical between repo and pack; the two absences (QA-only probe dist, root `AGENTS.md`) are packer-declared |
| `integration/pack-closure.log` | `node scripts/verify-pack-closure.mjs` exit 0 with the freshness read from the list: `0 expected-after-pack`, `0 drift`, `1 declared exemption` |
| `integration/git-status-porcelain.txt` | the exact changed-path census (38 modified + 18 untracked at 16:24Z) |
| `integration/result.json` | this lane's machine-readable result (commands, hashes, acceptance) |
| `integration/README.md` | this lane's narrative record |
| `.mpd/plans/agent-teams-adapter-wiring-report.md` | the wave report (AC-by-AC status, residuals, what is NOT claimed, exact files) |

## 6. How to walk the chain in five reads

1. `requirements-contract.md` §2/§7/§9 — what was contracted, and what counts as proof.
2. `review/round3/verdict.md` — the AC-by-AC verdict on the settled bytes.
3. `integration/settle-sandwich.log` + `integration/pack-closure.log` — the revision and the artifact.
4. `integration/pack-bytes-proof.log` — that the shipped tree really carries the bridge.
5. `.mpd/plans/agent-teams-adapter-wiring-report.md` §5/§6 — the residuals and the explicit
   non-claims.
