# CR docs fix — F1/F4/F5/F6/F7/F8 + F2/F3 verification

- Timestamp: `2026-10-27T15-37-34Z` (UTC)
- Branch: `fix/user-surface-closure`
- Scope: `AGENTS.md`, `agent-references/verification-flow.md`, `docker/ui/shoot-team-dag.mts`,
  `docker/ui/shoot-team-dag.sh`, `docker/ui/tui-capture.sh`, `docker/ui/measure-shots.py` (F3 residual
  only), `docs/index.md`, `docs/index.zh-CN.md`.
- NOT touched: `skills/**`, `skills/dsh-qa/**`, `scripts/docker-e2e.ts`, product source. No git commit.
- `node scripts/repin-vendor.ts` was NOT run. `git diff --name-only` still lists three `skills/**`
  paths owned by another lane — **repin still needed by captain**.

## Gate results (observed)

| Gate | Command | Exit | Evidence |
|---|---|---|---|
| Measure self-test | `python3 docker/ui/measure-shots.py --self-test` | **0** | `F5-self-test.out` |
| Shell syntax | `bash -n docker/entrypoint.sh docker/ui/shoot-team-dag.sh docker/ui/tui-capture.sh` | **0** | `bash-n.out` |
| Doc pairs | `bun run verify:docs` | **0** (pairs=52 failed=0 links=467 dead=0) | `verify-docs.out` |
| Manual paths | `node scripts/verify-manual-paths.ts` | **0** (resolved=153) | `verify-manual-paths.out` |
| Plugin manifest | `bun run verify:manifest` | **0** (npm pack lists 1087 files) | `verify-manifest.out` |
| Declaration comments | `bun run verify:comments` | **0** (479 files, 43506 declarations) | `verify-comments.out` |
| Workflows | `node scripts/verify-workflows.ts` | **SKIPPED** — `.github/**` untouched (`git status --porcelain .github` empty) | `workflows-skip.out` |

## F1 — AGENTS.md instruction budget — **FIXED**

- File:line: `AGENTS.md:216` (Docker row); moved detail now at
  `agent-references/verification-flow.md:84-91` (subsection) and `:192` (table row).
- Fix: removed the step-14b witness taxonomy (own log sink / live registration / ACTIVE loader fibre /
  NAMED bound) and the seven-slash-command registry+palette assertions from the injected manual; they
  now live in `agent-references/verification-flow.md` under **"The user-surface arm (step 14b, REQUIRED
  in every mode)"**. The manual keeps one hard requirement: `userSurface.*` rows are required in EVERY
  mode, and a lane that never ran them exits 3. The `--mode`/`--spec` detail was replaced by a pointer to
  the same reference file.
- Criterion (observed): `wc -c AGENTS.md` → **63482**; `65536 - 63482 = 2054` bytes of margin, required
  `>= 2048` → **PASS**. Evidence: `F1.out`.

## F2 — `docker/entrypoint.sh` duplicate `append_step` — **VERIFIED, no defect**

- File:line: `docker/entrypoint.sh:2059-2072` (step 14b). `run_step` itself ends with
  `append_step "$id" …` (`docker/entrypoint.sh:248-263`); the 14b branch no longer appends again. The
  `else` branch keeps its manual append because it never calls `run_step`.
- Criterion (observed, previous agent's executable repro re-run by this lane):
  before = **2 rows**, after = **1 row**, else-arm = **1 row**; verdict PASS. Evidence: `F2.out`.
- Conclusion: **合格** — the fix is correct; no change made.

## F3 — `docker/ui/measure-shots.py` exit-code contract — **FIXED (landed) + 1 residual patched**

- File:line: `docker/ui/measure-shots.py:64` (`UNUSABLE_INPUT_ERRORS`), `:67-73` (`refuse`),
  `:537-550` (`main`).
- Landed contract verified (observed): no args → 2; missing facts file → 2; malformed JSON → 2; empty
  boxes → 2; missing `--pane` → 2; bad `--rows` → 2; measured FAIL (box cut) → **1**; measured PASS → **0**.
- Defect found in the landed work: a wrong-typed JSON input escaped as an uncaught traceback with exit 1 —
  `facts` root as a JSON array → `AttributeError`; `capturedWidth: null` → `TypeError`. Both are
  "unusable input" under the module's own docstring, so exit 2 was required.
- Residual patch: added `TypeError, AttributeError` to `UNUSABLE_INPUT_ERRORS` and documented why.
  Re-run: both cases now print one stderr line and exit **2**. Evidence: `F3.out`, `F3-residual.out`.
- Conclusion: contract **合格** after the residual patch; no other defect found.

## F4 — `docker/ui/shoot-team-dag.mts` argument contract — **FIXED**

- File:line: `docker/ui/shoot-team-dag.mts:24-41` (`USAGE`, `refuseArgs`, `positiveInt`), `:135`
  (Playwright now loaded dynamically after argument validation).
- Fix: missing arguments print the usage line and exit 2 (was `throw` → exit 1); `WIDTH`/`HEIGHT` are
  validated as positive integers, so `abc`, `0`, `1.5` and `-20` all exit 2 instead of reaching
  `browser.newContext` as `NaN`. The dynamic import keeps the refusal observable on a host without the
  browser package; a valid invocation still reports a missing Playwright as a precondition failure.
- Criterion (observed, real file):
  no args → **2**; `WIDTH=abc` → **2**; `HEIGHT=abc` → **2**; `WIDTH=0` → **2**; `WIDTH=1.5` → **2**;
  `WIDTH=-20` → **2**. Evidence: `F4.out`.

## F5 — real vertical scroll in the Web capture — **FIXED**

- File:line: `docker/ui/shoot-team-dag.mts:96` (`PanelFacts.scroll` + `scrollTop`), `:123-125`
  (`scrollTop: scroll.scrollTop`, 0 when `graph.parentElement` is null), `:202`
  (`scrollY: framed.scroll.scrollTop`); `docker/ui/measure-shots.py:488-489` (new red arm), `:498`
  (self-test summary).
- Fix: the facts file no longer hardcodes `scrollY: 0`; it records the graph container's actual
  `scrollTop`. Added a self-test arm that measures `scroll=(0,120)` and must go RED.
- Criterion (observed): `--self-test` exit **0**; `web pass` at `scroll=(0,0)` → PASS;
  `web scrolled-y red` at `scroll=(0,120)` → FAIL with `the view is not at scroll origin: (0, 120)`.
  `HEAD` had `scrollY: 0` at the old line 184; the working tree reads `scrollTop` at `:202`.
  Evidence: `F5.out`, `F5-self-test.out`.
- Bound: the live Chromium path was not executed on this host (Playwright/UI-VIEW container absent);
  the red/green arms are the measurement side and the source read is verified statically.

## F6 — delete `$OUT` on measurement failure + header truth — **FIXED**

- File:line: `docker/ui/shoot-team-dag.sh:62-69` (capture the measurement status, `rm -f "$OUT"`, exit
  with the measurement's code); `docker/ui/shoot-team-dag.mts:7-9` (header now says the wrapper measures
  and deletes, instead of claiming this script refuses to write a PNG).
- Fix: a failed measurement now deletes the PNG before exiting and propagates the non-zero code; the
  wrapper's capture-failure message no longer claims a PNG was refused when it may simply not exist.
- Criterion (observed): `f6-failure-demo.sh` drives the REAL wrapper with only `docker` stubbed.
  FAIL arm (box outside capture): wrapper exit **1**, `$OUT` exists: **no**. PASS arm (boxes fit):
  wrapper exit **0**, `$OUT` exists: **yes (741 bytes)**. Evidence: `F6.out`, `F6-header.out`.
- Bound: the docker verbs (`inspect`/`exec`/`cp`) are stubbed (no UI-VIEW container on this host); the
  measurement and the cleanup branch are the real code.

## F7 — top row from the saved pane — **FIXED**

- File:line: `docker/ui/tui-capture.sh:248-262` (`team_top_row` reads its `$1` file),
  `:360` (`pane_joined >"$EVIDENCE_DIR/tui-team-dag.pane.txt"`), `:363`
  (`team_top_row "$EVIDENCE_DIR/tui-team-dag.pane.txt"`), `:366` (the same file is passed to
  `measure_band`).
- Fix: the crop's top row is now derived from the SAVED pane text that the measurement reads, not from
  a third live `tmux capture-pane`; a redraw or scroll between capture and this call can no longer
  anchor the crop on a different screen. Missing file falls back to row 0.
- Criterion (observed): saved-file border on row 3 → **3**; the old live path on a screen whose border
  moved to row 0 → **0**; the function body contains no `pane_rows`/`capture-pane`; the call site passes
  the saved pane path; missing file → **0**. Evidence: `F7.out`, `F7-source.out`.
- Bound: the pane files are synthetic; tmux and the real TUI were not run on this host.

## F8 — bilingual asset index — **FIXED**

- File:line: `docs/index.md:114-121` (image table after removal); `docs/index.zh-CN.md:111-118`.
- Fix: removed the two legacy rows that README no longer references — `tui-team-dag.png` and
  `web-team-board-v2.png` (both were dropped from `README.md`/`README.zh-CN.md` in commit `2cfcc29a`);
  added the missing `tui-team-dag-groups.png` row to the Chinese index with the same meaning as the
  English row (the shared English render is stated).
- Criterion (observed): `f8-index-consistency.py` lists both sides' rows; every target exists; every
  raster row is README-referenced; EN/ZH basename sets are equal (`only in EN: []`, `only in ZH: []`);
  `tui-team-dag.png` and `web-team-board-v2.png` are absent from both indexes; **F8 PASS**.
  `bun run verify:docs` independently PASS (links=467 dead=0). Evidence: `F8.out`, `verify-docs.out`.
- Note: the legacy PNG files remain on disk unreferenced; the finding asked for the stale ROWS, not file
  deletion.

## Honest bounds (not proven here)

- The Docker real-machine lane was not run: this host has no UI-VIEW container. F6's wrapper demo uses a
  `docker` stub; F5/F7 use the measurement/parser paths and synthetic inputs.
- The Playwright happy path of `shoot-team-dag.mts` (a real browser capture) was not executed; only the
  argument-refusal path runs without the browser package.
- `node scripts/verify-workflows.ts` was skipped because `.github/**` is untouched.
- `node scripts/repin-vendor.ts` was NOT run (captain's step). `skills/**` remains dirty from another
  lane: `skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/lib/user-surface-eval.ts`,
  `skills/dsh-qa/scripts/user-surface-mount.ts` — **repin still needed by captain**.
- No git commit was made.
