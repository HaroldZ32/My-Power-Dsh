# Evidence index — the team-surface wave's integration (task t5)

Walk from every claim on `docs/tui-parity.md` (and the doc edits that carry it) to the raw artifact
that backs it. Paths are workspace-relative. Where a claim has a **negative control** or a **second
measurement**, both are listed: a claim whose lane cannot fail is not evidence, and a claim measured
once on a tree that moved is not evidence either.

Task: `t5` (integration) · Owner: Lead · Revision: see `REVISION.json` (digests of every artifact)
and `second-pass/REVISION-START.json` / `REVISION-END.json` (the settle proof).

## 0. What this directory contains

| Artifact | What it is |
|---|---|
| `REVISION.json` | digest of the delivered TUI entry, every source this wave touched, the QA lanes, `VENDOR_LOCK.json` — captured when the first pass started |
| `run-gates.mjs` + `gates.result.json` + `raw/` | **gate pass 1**. It STRADDLED a repair: t8 rebuilt `packages/mpd-tui-plugin/dist/index.js` at 14:22:21 while this pass ran, so its early gates and its lanes measured different revisions. Kept as history; its `bun test packages` counts (795/2, 797/0) are one revision behind the delivered one |
| `run-gates-second-pass.mjs` + `second-pass/` | **gate pass 2 — the pass the claims rest on.** The whole set re-run on the settled revision, with the watched files digested at the start AND at the end (`revisionStable: true`, `movedDuringSweep: []`) |
| `fingerprint.mjs` + `raw/fingerprint.log` | the corpus fingerprint, recomputed with `verify-vendor`'s own algorithm and ASSERTED against the expected values |
| `second-pass/raw/fingerprint-asserted.log` | the same assertion re-run in pass 2 (fileCount + treeSha, both PASS) |

## 1. The corpus re-pin (acceptance #4)

| Claim | Artifact |
|---|---|
| `skills/**` = **319 files / `303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d`**, recomputed (never quoted) with the algorithm of `scripts/verify-vendor.mjs:63-122` | `raw/fingerprint.log` (PASS against 319 / `303e1631…`), `second-pass/raw/fingerprint-asserted.log` |
| The value **disagreed with t3's attempt-1 report** (`319 / 4f02b398…`): the lane was edited at 14:16:22, after t3's own last update at 14:14:56, so its report described stale bytes | `docs/tui-parity.md` §4 D3; `REVISION.json` (`skills/dsh-qa/scripts/tui-team-surface.mjs` = `91a05314…`) vs t3's `evidence/tui/team-surface-verify/2026-09-16T14-12-48.394Z/result.json` (`laneScript.sha256 = 21a9eb5c…`) |
| The captain pinned THIS value in the same commit as the `skills/**` change, and `verify-vendor` accepted it | `second-pass/gates.result.json` (`corpus.pinnedByVendorLock` = 319 / `303e1631…`), `second-pass/raw/verify-vendor.log` (PASS, `otherAssetFailures: []`) |

**Validity, stated as required:** the reported value is valid only if no further `skills/**` edit
lands before the captain's commit; a later edit supersedes it, and the captain re-measures at commit
time regardless.

## 2. The gate sweep (acceptance #3)

Pass 2 on the settled revision (`second-pass/gates.result.json`; per-gate raw logs in
`second-pass/raw/`):

| Gate | Exit | Reading |
|---|---|---|
| `bun run typecheck` | 0 | PASS |
| `bun run verify:docs` | 0 | PASS — 37 pairs, 0 failed, 16 exemptions |
| `bun test packages` (repo cwd) | 1 | **799 pass / 2 fail** — both failures are `packages/mpd-config-plugin/test/settings-wiring.test.ts:352` and `:419`, the environment-conditioned pair the captain's waiver names |
| `bun test packages` (clean cwd — the waiver's replacement) | 0 | **801 pass / 0 fail**, same test count |
| `node scripts/patch-agent-teams-fixes.mjs --check` | 0 | PASS — 53 regions, 9 adopted files |
| `node scripts/verify-vendor.mjs` | 0 | PASS (after the captain's same-commit re-pin) |
| `node evidence/…/fingerprint.mjs 319 303e1631…` | 0 | PASS — both assertions |
| `bun run test:qa` | 0 | all self-tests passed |
| `tui-mount` / `tui-panels` | 0 | exit 0 — prerequisite-absent SKIP, the lanes' own convention |
| `tui-admission` | 0 | PASS (static ok, real-lane SKIP recorded) |
| `tui-distribution` | 0 | PASS — structural rules hold, protocol CLI blocked and recorded |
| `tui-spec-conformance` | 0 | PASS — pinned inputs digested, per-requirement statuses recorded |
| `tui-settings-bridge` | 0 | PASS |
| `tui-team-surface` | 0 | **PASS** — `arm1 gate+adapter green, negative control red as required, arm2=approved-by-the-adopted-runtime/verdict-visible` |
| `web-settings-bridge` | 1 | **RED — PRE-EXISTING, not this wave** (see §3) |

The two `bun test packages` readings are always reported TOGETHER, never the green one alone
(waiver: `evidence/extensions/integration-ledger/20260916T071414Z/delivery-ledger.md` §10). The
delivered revision's counts are 799/2 and 801/0 (801 tests, after t8 added its cases); pass 1 (797
tests) read 795/2 and 797/0.

**One prose edit followed pass 2, and it is accounted for.** After the sweep, t5 corrected the test
counts in the two parity docs (795/2 + 797/0 → 799/2 + 801/0, the settled revision's readings). That
is a documentation-only change: re-digesting every watched file against
`second-pass/REVISION-END.json` names exactly two moves, `docs/tui-parity.md` and
`docs/tui-parity.zh-CN.md`, and **zero** moves among sources, package artifacts, tests, lanes or
`VENDOR_LOCK.json` (`second-pass/REVISION-AFTER-DOCS.json`). `bun run verify:docs` was then re-run
on the final bytes: PASS (`second-pass/raw/verify-docs-final.log`).

### 2.1 Pass 1's `tui-distribution` red — diagnosed and re-measured

Pass 1 recorded `tui-distribution` as `FAIL: the measured artifact changed DURING the run
(409a5c21c6ea -> 39af7ab10884)` with `install -> status=127`. That was the captain's concurrent
re-pin of `VENDOR_LOCK.json` moving a file under the lane, not a defect of the lane's subject:
re-run immediately afterwards on a quiescent tree it exited 0 (`raw/tui-distribution-rerun.log`),
and pass 2 on the settled tree exited 0 in 2.1 s.

### 2.2 The one red that is NOT this wave's — `web-settings-bridge`

`[card] W2a=FAIL W2b=FAIL`: the lane's assertions still require the pre-move card registration shape
(`ctx.slots.register({ name: SLOT, key: NS, … })` with `const SLOT = "settings.plugin.item"` —
`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs:603-604`), while the built client registers the
section under `settings.section` (`grep -c settings.section packages/mpd-bundle-plugin/client.js` =
9; `settings.plugin.item` = 0). It is a stale-lane defect introduced by the settings-section move
earlier on 2026-09-16:

| Run | W2a / W2b |
|---|---|
| `20260915T095438Z` (last green) | true / true |
| `20260916T075719Z` | false / false |
| `20260916T080320Z` | false / false |
| `20260916T142859Z` (this wave, pass 2) | false / false |

This wave changes no `packages/mpd-bundle-plugin/**` file, so it neither caused nor can fix it. It is
raised to the captain as an open repo defect rather than absorbed or hidden.

## 3. The documentation claims (acceptances #1 and #2)

| Claim | Artifact |
|---|---|
| `docs/tui-parity.md` + `docs/tui-parity.zh-CN.md` exist, carry the switch link under the title (EN → zh, zh → EN), and have an identical heading tree | `bun run verify:docs` = PASS (37 pairs, 0 failed), `second-pass/raw/verify-docs.log` |
| The ledger carries ONE table with the frozen §8 columns and all 20 mandatory rows plus the five extra Web surfaces named by the task book (halt, watchdog/incidents, workmate listing, workmate mutations, settings) | `docs/tui-parity.md` §2 — reviewed row by row against `.mpd/plans/tui-team-surface.md` §8 |
| `docs/tui.md`(+zh), `packages/mpd-tui-plugin/README.md`(+zh) and `README.md`(+zh) state how to OPEN the new surfaces | `docs/tui.md` §3.2 and its zh twin; `packages/mpd-tui-plugin/README.md` "What it provides"; `README.md` "DSH-TUI edition" |
| Factual correction recorded: the settings section exposes **twelve** knobs, not six/eleven | `packages/mpd-config-plugin/src/settings-schema.ts:66-80` ("The twelve knobs") and `packages/mpd-tui-plugin/test/plugin.test.ts:299` (`toHaveLength(12)`) |

## 4. Deviations and limits — where each one now stands

| Id | State | Where it is recorded |
|---|---|---|
| D1 — the §4.5 verdict line was invisible after a REAL commit | measured OPEN, then **CLOSED by t8**; the re-measurement reports `verdict-visible`, one earlier confirmed by t6/t7 | `docs/tui-parity.md` §4 D1 (both states) |
| D2 — the frozen row label `merge-autonomous-plan` has no locatable anchor in the adopted client bytes | **OPEN** (a contract naming issue, not implementable here) | `docs/tui-parity.md` §4 D2 |
| D3 — a verdict run described stale lane bytes | measured, then **RESOLVED** by the captain's re-pin of the independently measured value + t3's retry | `docs/tui-parity.md` §4 D3 |
| t4's unbounded-`dependencies` residual | **OPEN — CONTAINED, NOT FIXED, deliberately out of this wave** (a cap would touch the frozen §5.5 cap list) | `docs/tui-parity.md` §5 (NOT-CLAIMED), by captain ruling |
| §9.4 sanitization | IMPLEMENTED on t6's stated basis only: `safeLine` = `clampCells(stripControl(raw), 4000)` is the single render boundary over every `ui.Text` string | t6/t7 evidence + `docs/tui-parity.md` §2 row 8 |

## 5. Disclosure — evidence written outside this task's directory

Running the TUI lanes is required by acceptance #3, and several lanes hard-code their own output
roots, so this task's sweep also produced run directories outside
`evidence/tui/team-surface-integrate/`: `evidence/tui/team-surface-verify/2026-09-16T14-24-22.312Z/`
and `…T14-29-54.081Z/` (the `tui-team-surface` lane), `evidence/tui/lanes/…` (distribution,
spec-conformance) and `evidence/mpd-bridge/{tui-settings-bridge,web-settings-bridge}/…`. No source
file, no test and no bundle artifact was modified by t5: its own writes are `docs/`, the four
READMEs, and this directory.

**No commits were made by this task** (the single-git-writer rule, AGENTS.md §5). `VENDOR_LOCK.json`
was modified by the CAPTAIN, not by t5.
