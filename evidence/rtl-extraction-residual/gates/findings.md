# t4 findings — gate coherence after the RTL extraction

Task: "Re-run the standing gates and prove the extraction left the repo's own guards coherent."
Tree: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`). Full command inventory, verbatim output and
the live-subject table: `gates.md`. Raw logs: `raw/`.

## Summary

| Id | Severity | Class | Status |
|---|---|---|---|
| F1 | **blocker** | repo guard broken by the extraction | confirmed, reproducible, fix is a one-line re-baseline |
| F2 | **medium (blocker for a green `bun test`)** | pre-existing latent test defect, exposed by `d510a16`, **not** caused by the extraction | confirmed with a pre-extraction baseline run |
| F3 | low | QA-harness env defect: sandboxed `HOME` has no pnpm store, so the two RTL cases cannot reach their real pass | confirmed; the underlying subjects are live (manual substitute run green) |
| F4 | info | untracked RTL-named environment leftovers | reported for `t1`/repair, no tracked impact |

## F1 (blocker) — the mounting boot gate is red because the probe's corpus threshold outgrew the extraction

- **Measured**: `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` → exit 1, `boot.ok=false`
  (`raw/bundle-lifecycle.log`). The probe's own lines: `SKILLS=19 BUNDLED=19` then `FAIL`. Its single
  unsatisfied conjunct is `bundled.length >= 20`
  (`packages/mpd-qa-roles-probe/src/index.ts:58`, mirrored in `dist/index.js:282`); `PRESET_MPD=ok`,
  `ADAPTER_TOOL_CALL=ok`, the 11-role roster and the `svn-master` fixture all pass.
- **Why it is a product-guard problem, not an environment artifact**: the corpus is really 19
  (`ls -d skills/*/ | wc -l`), because the extraction removed `skills/rtl-codestyle`, `skills/rtl-ip-flow`
  and `skills/rtl-verif` (`git ls-tree --name-only 3d99718 skills/` → 22).
- **Before/after proof**: the same case on a detached worktree of the pre-extraction commit `3d99718`
  → exit 0, `SKILLS=22 BUNDLED=22`, `PASS`, `ok=true`
  (`raw/bundle-lifecycle-baseline-3d99718.log`).
- **Consequence**: the standing "MOUNT/boot check" gate from `AGENTS.md` §4 fail-closes on the
  extraction's own removal. Anyone re-running the required boot gate after the extraction gets a red
  result that is *not* about the boot — it is an un-re-baselined expectation, and it masks real
  apply-crash signatures in the same log.
- **Required fix (repair stage, `packages/**` — outside t4's inScope)**: re-baseline the probe's corpus
  expectation to the shipped corpus. `>= 19` is the minimal honest fix; better is to derive the expected
  count from the served bundle listing (or to assert the presence of named fixtures instead of a count),
  so a future corpus change cannot silently turn the boot gate red again. Rebuild
  `packages/mpd-qa-roles-probe/dist/index.js` (the boot loads `dist/`) and re-run the case.
- **Evidence**: `raw/bundle-lifecycle.log`, `raw/bundle-lifecycle-baseline-3d99718.log` (the worktree
  that produced the baseline was removed again after the run, so its own evidence dir is gone; the
  summary lines are preserved in the raw log),
  `evidence/dsh-qa/bundle-lifecycle/2026-09-13T07-37-13.539Z/{result.json,boot.log}`.

## F2 (medium, blocks a green `bun test`) — 3 self-fix tests are red before AND after the extraction

- **Measured**: `bun test packages` → exit 1; `295 pass / 3 fail`. The three failures are in
  `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`
  (`t9: a re-materialized tools.js is REFUSED…`, `t9: the targeted re-materialize shape … is REFUSED too`)
  and `…/scope-glob-and-contract.test.mjs` (`F3: healing a RE-MATERIALIZED upstream file refuses …`).
  (`raw/bun-test-packages.log`.)
- **Diagnosis (measured, not inferred)**: the fixture builds its "pristine upstream" file with
  `git show HEAD:…/lib/tools.js` (resp. `lib/quality-gates.js`) and asserts that file carries **no**
  `mpd-delta` markers. `d510a16` committed the delta bodies into that very file, so the premise is now
  false: `git show HEAD:…/lib/tools.js | grep -c mpd-delta` → `10`, and the test receives the marker it
  expected to be absent (`Received: ""` / `Received length: 10` / `Received: 1`).
- **Not caused by the extraction**: the plugin tree and the test files are byte-identical between the
  pre-extraction commit and HEAD (`git diff --stat 3d99718 HEAD -- packages/mpd-agent-teams-plugin/`
  and `…/self-fix-tests/` both empty), and the same tests fail on a detached worktree of `3d99718`
  (`raw/bun-test-baseline-3d99718.log`: 68 pass / 6 fail — the 3 assertions run twice, once in each
  test file's suite).
- **Consequence**: the repo's standing "Tests" gate (`bun test`, `AGENTS.md` §4) is red on `dev`
  independently of the RTL work. It is latent, not extraction-caused, but it is still a live guard whose
  subject drifted out from under it, and leaving it red means the extraction cannot be signed off with
  the required green sweep.
- **Required fix (repair stage, `packages/**` — outside t4's inScope)**: stop deriving the pristine
  fixture from `git show HEAD`. Pin it to a revision that genuinely predates the delta commit, or embed
  the pristine copies as fixtures, or make the test synthesize "upstream" by stripping the markers from a
  committed copy it controls. Then re-run the suite.
- **Evidence**: `raw/bun-test-packages.log`, `raw/bun-test-baseline-3d99718.log`,
  `raw/subject-hashes.txt` (`lib/tools.js` sha256 406e086e…).

## F3 (low) — the two RTL QA cases cannot reach their real pass in a sandboxed `HOME` (pnpm store)

- **Measured**: `bun skills/dsh-qa/scripts/rtl-verif.mjs` → exit 1 and
  `bun skills/dsh-qa/scripts/rtl-ip-profile.mjs` → exit 1, both at their very first real step with
  `dsh plugin add failed: … dsh: pnpm failed in profile directory …` (`raw/rtl-verif-real.log`,
  `raw/rtl-ip-profile-real.log`). Reproduced by hand without the case driver:
  `DSH_HOME=<sandbox> HOME=<sandbox> dsh plugin --profile rtl-ip-qa add <silicon>` →
  `[ERR_SQLITE_ERROR] unable to open database file` (`raw/rtl-ip-profile-manual-add.log`): with `HOME`
  redirected to a fresh sandbox, pnpm resolves its store under that `HOME` and cannot open/create the
  store DB.
- **Not a subject defect**: the same install succeeds as soon as an explicit sandbox store is used
  (`--store-dir <sandbox>/pnpm-store`, the pattern `bundle-lifecycle.mjs:88` already uses) —
  `raw/rtl-ip-profile-manual-add2.log` exit 0 — and the composed boot then really contains the silicon
  rows (`silicon-dsh-adapter`, `silicon-bootstrap`, `silicon-verif`, `silicon-mcp-lsp`;
  `raw/rtl-ip-profile-manual-dump2.log`). The silicon subjects themselves exist (verif `dist/index.js`,
  the three `skills/rtl-*` trees, `presets/rtl-ip.profile.json`), and both cases' offline `--self-test`
  passes (`raw/rtl-*-self-test.log`).
- **Consequence**: the two RTL-named cases are *live in principle* but *un-runnable as written* on this
  box; their real passes cannot be cited as evidence either way. This is why the liveness verdicts in
  `gates.md` rest on the offline self-tests plus the manual substitute boot, not on a green real pass.
- **Required fix (optional, `skills/dsh-qa/**` — outside t4's inScope)**: give both cases the
  `--store-dir <sandbox>/pnpm-store` treatment that `bundle-lifecycle.mjs` already uses, so an isolated
  `HOME` cannot starve pnpm.
- **Evidence**: `raw/rtl-verif-real.log`, `raw/rtl-ip-profile-real.log`,
  `raw/rtl-ip-profile-manual-add{,2}.log`, `raw/rtl-ip-profile-manual-dump{,2}.log`.

## F4 (info) — untracked RTL-named environment leftovers

- `<repo>/.venv-rtl/` (44 MB, cocotb venv) and `<repo>/.toolchain/bin/verible-verilog-ls` (6 MB,
  Aug 31) still exist on this box. Both are untracked (`git status` does not see them; `.venv-rtl/` is
  explicitly ignored at `.gitignore:25`), so they do not affect any gate. Reported for the `t1` sweep /
  repair owner to decide, not acted on here (`inScope` is `evidence/**`).

## What this task did NOT establish (honesty)

- It did not establish that the extraction is otherwise clean — `t1`'s full sweep owns that.
- It did not run `bun test` for `packages/mpd-agent-teams-plugin/self-fix-tests` in isolation as a
  separate gate: they are inside `bun test packages`, already covered by command 5.
- The two RTL QA cases' real passes were not executed to green (F3); the verdicts for them are
  "live subject, offline self-test green, real pass blocked by the harness" — stated as such in
  `gates.md` rather than upgraded to PASS.
- `--dump-config` appears in this report only as a COMPOSITION check (the manual substitute boot); no
  `--dump-config` result is cited as plugin-load evidence. Load evidence is the mounting
  `bundle-lifecycle` / `preset-conformance` boot logs.
