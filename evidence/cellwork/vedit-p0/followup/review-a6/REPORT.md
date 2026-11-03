# Review A6 — the T20 fix of A5-F1 (a non-vacuous `arm5d`)

**Row:** T21 (board), re-review of `T20`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T073101-95530c` (T20). **Contract:** `.mpd/plans/vedit-p0-followup.md` (§F1/§F2) +
the A5 finding (`evidence/cellwork/vedit-p0/followup/review-a5/REPORT.md` §2, A5-F1). **Gate authority:**
`AGENTS.md` §4, §7.

**Tree judged** — pinned **07:38:32Z**, re-hashed **07:43:52Z**, IDENTICAL (`gates/00-scope-start.sha256`,
`gates/40-scope-end.sha256`): `tui-admission.ts` `0f93c004…`, `SKILL.md` `37b68665…`, `surface-pin.ts`
`0d883365…` (UNCHANGED), the team-core enum `f5461b9d…` (UNCHANGED), contract `3e12b6f3…` (UNCHANGED), HEAD
`2230607d`. The T20 deltas were measured against a REBUILT A5 byte image (rebuilt hash `98ff00ec…` = the A5
hash): `tui-admission.ts` 8 hunks / 71 changed lines, `SKILL.md` one sentence, `surface-pin.ts` NOTHING.

**Verdict: PASS.** **Risk level: LOW.** No Blocker/High/Medium. **Zero functional findings**; two process /
hygiene notes. Nothing is repaired by this seat.

## 1. Assessment

The vacuity A5 demonstrated is closed by construction, and I re-derived it three ways instead of accepting
the report. First, structurally: the measurement moved into its OWN boot (phase C) — the clone's one row is
staged in the grants file BEFORE the boot, the boot drives exactly ONE `/plugin check <shipped manifest>`,
and `arm5d` is now `state === "compatible"` **AND** `decisions === 1`. Second, on my own live run (exit 0)
the phase-C captures show the property that makes the arm non-vacuous: the pre-step `boot.pane.txt` carries
**0 decisions** and the check pane carries **exactly 1** — so the count is produced BY the driven check, not
by the boot. Third, with the lane's OWN exported predicate (imported from the shipped script, not a copy):
the pane a swallowed step would leave — my A5 `clone-granted` capture, 2 decisions, newest `compatible` —
now yields `arm5d = false`, while my real phase-C pane (1 decision) yields `true`; the OLD shared-boot
capture (3 decisions) also yields `false`, so the previous construction would fail the new rule. The writer's
live mutant is independently confirmed the same way: its captured phase-C pane carries **0 decisions**, and
the shipped predicate over it gives `arm5d = false` with `state: undefined`, exactly the `ok=false` /
only-`arm5d:false` shape in the log. Nothing else moved: the live `ok` predicate is byte-identical, the arm
definitions differ by exactly the one added `&& decisions === 1`, the static plane has NO hunk in the delta,
and the self-test's freshness counter is two-sided.

## 2. (a) `arm5d` can no longer pass vacuously

| # | criterion | verdict | evidence |
|---|---|---|---|
| a1 | the measurement is a FRESH boot, grant staged BEFORE the boot, exactly one `/plugin check` step | **PASS** | phase C: `writeExtensionGrants(grantFile, componentId, [clone.row])` → `runTuiSession({lane: SLUG+"-shipped-granted", steps: [{name:"shipped-granted-check", keys:["/plugin check "+MANIFEST,"Enter"]}]})`; the old `shipped-granted` step is DELETED from the clone boot (diff hunk `-1117,14`); `rmSync(grantFile)` afterwards |
| a2 | `arm5d = state === "compatible" && decisions === 1` | **PASS** | the only arm-definition delta: `- const arm5d = …state === "compatible"` → `+ const arm5d = …state === "compatible" && shippedGrantedWindow.decisions === 1` |
| a3 | the counter is TWO-SIDED in the self-test | **PASS** | `check(twoCheckWindow.decisions === 2, …)` and `check(lastCheckWindow("a pane with no check output at all").decisions === 0, …)`; `--self-test` exit **0** |
| a4 | the count comes from the STEP, not the boot | **PASS** | MY phase-C artifacts: `boot.pane.txt` **0 decisions** / `state=undefined`, `shipped-granted-check.pane.txt` **1 decision** / `compatible`; the writer's run shows the same 0 → 1 |
| a5 | the artifact records the count the verdict rests on | **PASS** | MY `result.json`: `"withGrant": {"check":"compatible","decisions":1,"arm":true,"boot":"its OWN boot, …"}` |

## 3. (b) the red-first proofs are non-vacuous

| # | criterion | verdict | evidence |
|---|---|---|---|
| b1 | **my own re-derivation**: a 2-decision pane (`clone-granted`) → `arm5d=false`; the real phase-C pane (1) → `true` | **PASS** | `gates/21-non-vacuity-probe.log` and `gates/22-phase-c-probe.log`, produced by importing the SHIPPED `lastCheckWindow` (now `export`ed) and running it over the recorded panes: `clone-granted → decisions=2 state=compatible arm5d=false`; `old shared-boot capture → decisions=3 … false`; `phase-C check pane → decisions=1 … true`; `boot.pane.txt → decisions=0 arm5d=false` |
| b2 | the writer's live-mutant claim is consistent with the code and the recorded log | **PASS** | I inspected the mutant's OWN captured pane (`.mpd/recon/qa/mut-live/…/shipped-granted/shipped-granted-check.pane.txt`): **0 decisions**; the shipped predicate over it gives `state=undefined, arm5d=false` — matching `FAIL {… "arm5d":false …}` with every other arm `true`. I did not re-run the mutant (a fourth boot); this is a re-derivation, as declared |
| b3 | the real lane is `ok=true` and exits 0 | **PASS** | MY run (`gates/30-live.log`): `shipped-with-grant /plugin check -> state=compatible decisions=1 (fresh boot, exactly one expected)`, `ok=true`, `PASS …`, **EXIT=0**, three boots, lane dir `evidence/tui/lanes/2026-11-03T07-38-35.018Z` |

## 4. (c) nothing else weakened

| # | criterion | verdict | evidence |
|---|---|---|---|
| c1 | no other arm or `ok` term changed | **PASS** | the arm-definition diff is ONLY the `arm5d` line; the live `ok` predicate is byte-identical (A5 line 1187 == now line 1208) |
| c2 | the STATIC plane untouched | **PASS** | no delta hunk inside `staticAdmission`/`grants`; the only occurrences of `grants`/`cloneUngranted`/`cloneWrongScope` in the diff are CONTEXT lines |
| c3 | the clone's four arms and arm6 unchanged | **PASS** | the diff removes the old shared-boot wiring only; the clone steps/expectations are untouched |
| c4 | gates | **PASS** | `--self-test` **0**, `--static-only` **0**, LIVE **0**, `test:qa` **0**, `typecheck` **0**, `comments` **0** |
| c5 | scope | **PASS** | the wave's 16 tracked modifications, none added by this row; `VENDOR_LOCK.json` untouched; no commit; `surface-pin.ts` not touched by T20 (hash `0d883365…` unchanged) |
| c6 | the expected red | **PASS** | `verify-vendor` exit 1 with ONE reason (`asset skills treeSha mismatch`); `verify-dist-fresh` exit 1 with ONE stale target (`mpd-team-core-plugin`, the captain's integration item — not a T20 change) |

**Gate evidence (this seat):** `tests` `ev-20261103T074250-2b8031` (3485 tests, 231 files, 0 fail, 6 skip),
`typecheck` `ev-20261103T074325-e0e0c3` (0), `comments` `ev-20261103T074118-34494b` (0).

## 5. Notes (no finding raised)

- **A6-N1 (process, second occurrence) — the loop's frozen scope again omits a file the row changed.**
  `loop-20261103T073101-95530c` froze `["skills/dsh-qa/scripts/tui-admission.ts", "evidence/…/review-fix3/**"]`,
  but T20 also edited `skills/dsh-qa/SKILL.md` (one sentence, confirmed by the A5→now delta) and the writer's
  own report lists it in scope. The substance IS reviewed here; a later reader of the LOOP record would not see
  it covered. Same note as A5; direction: widen the loop scope (or record the amendment once, wave-level).
- **A6-N2 (hygiene) — the live-mutant copy is still on disk.** `.mpd/recon/qa/mut-live/` holds a full copy of
  the tree (gitignored runtime state) from the writer's red-first run; harmless today (the gates pass and do
  not scan it), but it is a stale duplicate of a changing tree — worth deleting when the wave ends.
- Declined: the freshness counter is pane-render based — a host that painted a SECOND, unprompted decision
  would produce a false RED rather than a false PASS (the writer discloses this, and it is the safe
  direction). Not scored. The third boot (~a minute of runtime) is a disclosed cost and does not affect any
  assertion. The `export` added to `lastCheckWindow` is what lets a verifier re-derive the predicate from the
  shipped script; it is inert for a normal run thanks to the existing entry guard.

## 6. Bounds

- I did NOT re-run the live mutant (a fourth boot, ~12 min). I re-derived its outcome from the mutant's own
  captured pane using the shipped predicate, and the gate list the captain set did not include it. Declared.
- The live lane ran on `dsh-tui 0.18.0` with the warm `.mpd/sb/tui-admission` root on this host; the
  `absent-fixture` SKIP path was not exercised.
- No `packages/*/src` change; no dist rebuild owed by this row; the Docker lane does not re-run.
- Nothing was mutated in the repository for this review; the only writes are under `review-a6/` and
  `.mpd/verify/evidence/` (probe scripts live under the gitignored `.mpd/recon/qa/rev-a6/`).

## 7. Evidence in this directory

```
00-criteria.md                          criteria frozen BEFORE the fix was read (07:38Z)
gates/00-scope-start.sha256 · 40-scope-end.sha256   identical (07:38:32Z → 07:43:52Z)
gates/10-diff-a5-to-current-tui.diff    8 hunks / 71 lines (A5 image REBUILT, hash 98ff00ec… verified)
gates/11-diff-a5-to-current-skill.diff  one sentence
gates/20-tui-self-static.log            self-test 0 / static-only 0
gates/21-non-vacuity-probe.log          shipped predicate: 2-decision pane → arm5d FALSE; 3-decision → FALSE; 0 → FALSE
gates/22-phase-c-probe.log              MY phase-C: boot 0 decisions → false; check pane 1 decision → TRUE
gates/23-mutant-pane-probe.log          the writer's mutant pane: 0 decisions → arm5d FALSE
gates/23-test-qa.log                    0
gates/24-vendor-expected-red.log        exit 1 — ONLY the skills treeSha
gates/25-dist.log                       exit 1 — ONLY mpd-team-core-plugin STALE (integration item)
gates/30-live.log                       exit 0 — my own three-boot run, `decisions=1`
```
