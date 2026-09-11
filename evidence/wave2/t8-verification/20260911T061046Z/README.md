# Wave-2 t8 — independent verification of the adopted agent-teams tooling fixes

**Verdict: FAILED** (verification task; no implementation was performed here).
Two acceptance criteria of t4 fail on raw output this verifier produced, and the DEFECT-2 outcome the
task body names is only narrowed, not prevented.

> **A `dsh` restart is required for t4's fixes to act on a live session.** This harness has no hot
> reload of plugin modules: the running process still enforces the pre-fix matcher and the pre-fix
> contract surfaces. Everything below is therefore proven by direct module import — pre-fix from the
> git `HEAD` revision (`98680b1f…`, extracted with `git archive`) and post-fix from the working tree —
> plus a mounting boot, never by the live completion gate.

## What was measured (raw artifacts in this directory)

| # | Check | Method | Result |
|---|---|---|---|
| C1 | inScope `**` expansion | pre/post module import, driven fixtures, real wave-1 t7 replay | **PASS** — pre-fix `packages/foo/test/**` covers nothing beneath it (`undeclared`, completion `ok=false`); post-fix `in_scope`/`ok=true`; negative controls identical; real t7 flips from 2 uncovered paths to `ok=true` |
| C2 | Contract contradiction | exact replay of the REAL wave-1 inputs (archived team `mpd-default-7332aba4`: t7 + t10) + 60-combination sweep | **FAIL** — the duplicate-listing contradiction *is* impossible after the fix (0/60 vs 24/60 pre-fix; create gate refuses; carve-outs still legal, and the pre-fix replay reproduces the recorded t13 contract byte-for-byte) **but** the finding F3 whose requiredFix the repair's acceptance carries (file `AGENTS.md`) is still classified `out_of_scope` → the required edit is still rejected |
| C3 | Running-task contract readability | REAL tool set registered against a byte-identical copy of the live team record | **PASS** — t4, t6 and t8: 13/13 fields identical to the durable record; t8 also equals its assignment prompt verbatim; member read works; live record byte-identical after reads |
| C4 | Guard failure mode | sandbox copies; region stripped / anchor removed / body edited, then restored | **PASS** — every failure exits 1 with a named cause; `--write` restores byte-identically; live tree untouched (sha256 equal) |
| C4b | LOCAL ADAPTATION marking | diff-to-region coverage over the adopted files | **FAIL** — 17 added lines in `lib/quality-gates.js` sit outside every region (`inScopeOverlap` rewrite 252-255, `normalizeScopePattern` 263-267, create-time gate 405-412) |
| C4c | Vendor-run durability | hand re-materialize simulation + the guard's own healing mode (`vendor-agent-teams.mjs:122` runs `write:true`) | **FAIL** — `--write` and the following `--check` exit 0 while the healed file has two `export function pathMatchesScope` declarations and **fails to import**; the unmarked changes are silently absent |
| C5 | Regression | `bun test packages/mpd-agent-teams-plugin` + a MOUNTING boot in isolated `DSH_HOME`/`HOME`/workspace | **PASS** — 83/0; boot with registration instrumentation 14/14 agent-teams tools (incl. `agent_teams_task_contract`), 0 apply-crash signatures, no workspace/session leakage. No `--dump-config` is cited as load evidence |

## Findings (for the repair round)

1. **F1 high — the generated repair scope still forbids the edit its own acceptance requires.**
   `repairScopeFromFindings` drops a finding file from `inScope` when the source `outOfScope` covers
   it, but keeps the prohibition, so `classifyChangedPath(finding.file, scope)` stays
   `out_of_scope`. The function's doc comment claims the opposite ("carved OUT of the source
   contract's outOfScope"), and `self-fix-tests/scope-glob-and-contract.test.mjs:133-135` says "the
   required edit is no longer out_of_scope" above an assertion that expects `out_of_scope`.
2. **F2 medium — 17 behaviour-changing adopted-code lines carry no `mpd LOCAL ADAPTATION` marker**
   (`lib/quality-gates.js` 252-255, 263-267, 405-412), so the re-apply guard cannot restore them.
3. **F3 high — the healing path breaks the very re-vendor it guards against.**
   `applyAgentTeamsFixes({write:true})` inserts a region before its anchor without noticing that the
   file still carries the declaration the region replaces: exit 0 twice, broken module.

## Reproduction

```bash
# pre-fix modules (workspace-local, gitignored)")
mkdir -p .mpd/t8-verify-work/prefix && git archive HEAD packages/mpd-agent-teams-plugin/lib | tar -x -C .mpd/t8-verify-work/prefix

node evidence/wave2/t8-verification/<stamp>/drivers/check1-glob.mjs <lib-dir>
node evidence/wave2/t8-verification/<stamp>/drivers/check2-contract.mjs <lib-dir>
node evidence/wave2/t8-verification/<stamp>/drivers/check3-live-contract.mjs .mpd/team/mpd-wave-2/team.json mpd-wave-2 t4 captain
bash evidence/wave2/t8-verification/<stamp>/drivers/check4-guard-failure.sh
bash evidence/wave2/t8-verification/<stamp>/drivers/check4d-revendor-heal.sh
bash evidence/wave2/t8-verification/<stamp>/drivers/check5-mount.sh
```

`<lib-dir>` is either `.mpd/t8-verify-work/prefix/packages/mpd-agent-teams-plugin/lib` (pre-fix) or
`packages/mpd-agent-teams-plugin/lib` (post-fix). Nothing in the live adopted tree is modified by any
driver: the guard is exercised on sha256-identical sandbox copies so concurrent members are never
exposed to a stripped file.
