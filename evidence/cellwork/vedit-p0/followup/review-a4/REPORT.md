# Review A4 — the T14 fix of the A3 findings (SKILL.md row, ORDER probe, header, R2 wording)

**Row:** T15 (board), re-review of `T14`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T070604-6f2ccd` (T14). **Contract:** `.mpd/plans/vedit-p0-followup.md` (§F1/§F2) +
the A3 findings it repairs (`evidence/cellwork/vedit-p0/followup/review-a3/REPORT.md`). **Gate authority:**
`AGENTS.md` §4, §7.

**Tree judged** — pinned at **07:11:16Z** (`gates/00-scope-start.sha256`), re-hashed after the runs: `SKILL.md`
`71477fbc…`, `tui-admission.ts` `e296420c…`, `barrier-live-engine.test.ts` `d5e37b40…`, `flow.test.ts`
`ea6ff957…` (UNCHANGED), `surface-pin.ts` `805b2dba…` (UNCHANGED), contract `3e12b6f3…` (UNCHANGED), HEAD
`2230607d`.

**Verdict: PASS.** **Risk level: LOW.** No Blocker/High. Two Nits, one of which is the A3-F6 deferral the
captain asked me to judge. Nothing in this row is repaired by this seat.

## 1. Assessment

The fix closes the one finding that mattered and closes it with the exact evidence I asked for. I rebuilt the
A3-reviewed byte images from my own saved diffs (both rebuilt hashes are EXACTLY the A3 hashes — `f44f1900…`
for `tui-admission.ts`, `deea1f1a…` for the barrier test), so the T14 delta is not narrated but MEASURED:
`tui-admission.ts` changes in ONE hunk (lines 57–83, the header comment block, zero code lines), the barrier
test changes in ONE hunk (the two ORDER arms), and `SKILL.md` changes in ONE row. Against that settled tree
my own mutation replay reproduces the target: **m5 — a hard-coded `await deps.sleep(200)` before the first
attempt — now REDDENS** (8 pass / 2 fail; it was 10/0 at A3), the configured-seam regression (m2) still
reddens both ORDER arms, and m1/m3/m4 still redden exactly their own arms. The two-sided control still
observes a REAL retry (`timer(40ms)` after the first drive), the duration bound is still gone, `0 ms` ticks
are ignored, the clock is restored in `finally`, and the main arm's two old assertions were replaced by ONE
STRICTER `toEqual(["drive"])` — no assertion was weakened. The header now spells the three codes `tuiPrereqs`
really gates (with the `tmux` line that was missing), records the measured sandbox constraints, and points
the Evidence line at the directories a run actually writes. Both R2 rows I flagged are corrected, with the
reason. What remains is one over-broad sentence in the new `SKILL.md` row and the deferral decision.

## 2. Findings

**(a) `SKILL.md` — the row matches the current arms, with ONE unmeasured promise.**

| check | verdict | evidence |
|---|---|---|
| a1 no stale promise survives | **PASS** | the four false sentences are GONE (grepped against the live row: "manifest's own four rows", "NO-GRANT negative-control boot", "decision-handler binds", "a REAL `tui/input` decision fires" — all absent) |
| a2 the SHIPPED live posture is stated | **PASS** | "both `/plugin` panes … advertise `compatible`, the check pane prints NO `extension-grants.json` hint, the admission-loader debug line admits the Component …, and a submitted line renders a REAL chat turn (it no longer claims a decision interception)" — matches `qa-live/run-artifacts/result.json` |
| a3 the clone's four states + arm3 as the STRING | **PASS** | "no grant → `waiting_authorization` AND the … hint, that row granted → `compatible`, the same name at an undeclared scope → STILL `waiting_authorization`, and a mid-session grant revocation → re-checked and OBSERVED (never gated)" + "recorded as the string `inapplicable` … the lane never reports that arm as a pass" |
| a4 every claim checkable against the artifact | **FAIL (Nit, A4-F1)** | "the SHIPPED manifest's own decision must stay `compatible` **even WITH a grant**" — the static arm negotiates the shipped manifest with `[]` (`host.negotiate(index, manifest, …, [])`), so the claim is NOT measured |

**(b) the header's PREREQ codes.** **PASS.** `absent-dsh-binary dsh-tui` / `absent-runtime tmux` /
`absent-fixture profile`, each matching `lib/tui-lane.ts`'s table, plus a sentence naming the probe each code
uses; the measured constraints are accurate (`<root>/<lane>.sock` under ~107 bytes — my own A3 runs: a 65-char
root booted, the 109-char default died `File name too long`; a WARM profile; `<root>/dshhome/.credentials.yaml`);
the `Evidence ->` line now names `REVISION.json`, `shipped/`, `clone/`, `grant-clone/` instead of the retired
`negctl/`, `grants/`. Byte-proof it is comments-only: the A3→current diff of `tui-admission.ts` is ONE hunk
at `@@ -57,13 +57,27 @@`, zero code lines.

**(c) the ORDER probe is hard-coded-sleep proof.** **PASS** — my own replay, not the writer's log:

| mutation (my copy, repository untouched) | expected | observed |
|---|---|---|
| baseline | green | barrier `10 pass / 46 expect`, flow `37 pass / 421 expect` |
| **m5 — hard-coded `await deps.sleep(200)` before the first attempt** | RED (the A3 residual) | **RED — 8 pass / 2 fail**, both ORDER arms |
| m2 — configured-seam sleep reintroduced | RED | RED — 8 / 2, both ORDER arms |
| m1 — `engineForBarrier` registry-first | only the differing-engine arm | RED — 9 / 1 |
| m3 — `interruptAgent` on the promoted path | only the promoted arm | RED — 9 / 1 |
| m4 — split description's warnings rule stripped | only the description arm | RED — 36 / 1 |

The probe records EVERY timer with `ms > 0` (value in the entry, `timer(200ms)`, so a red names what was
scheduled), ignores `0 ms` ticks, restores `globalThis.setTimeout` in `finally`, and the main arm requires
`toEqual(["drive"])` — strictly stronger than A3's `timeline[0]==="drive"` + `not.toContain("delay")`. The
control arm still proves the probe is not blind: `timer(40ms)` after the first drive.

**(d) the R2 `arm2` row.** **PASS.** `qa-live/report.md` §2 now reads "the SAME predicate, now read from the
**SHIPPED** boot (`shipped/host-stderr.log`)" with the reason (only the permission-less boot admits the
Component; the granted boot's baseline was `admitted=0 refused=0`). `lane-a/report.md` was updated in the same
pass (N2 row names `orderProbe()` and the m5 row, bounds section re-stated), so no lane report describes a
probe that no longer exists.

**(e) nothing else weakened.** **PASS.** The A3→current test delta is ONE hunk (the two ORDER arms): the main
arm's two assertions became one stricter assertion, the control's three are preserved (same three checks, new
entry names), and the `expect()` count moved 47 → 46 solely because of that merge. Suite on the settled tree:
`bun test packages` **3483 tests, 231 files, 0 fail, 6 skip** (gate `tests`); `--self-test` **0**,
`--static-only` **0**, `test:qa` **0**; `typecheck` **0**; `comments` **0**. Scope is what the report claims:
`SKILL.md` + the `tui-admission.ts` HEADER + the barrier test + evidence; `flow.test.ts`, `surface-pin.ts`,
`packages/*/src/**` and `VENDOR_LOCK.json` are untouched (hashes unchanged / `git status` unchanged).

**A4-F1 — Nit — one promise the measurement does not carry.**
Where: `skills/dsh-qa/SKILL.md`, the `tui-admission` row, the static-arm sentence.
What: "while the SHIPPED manifest's own decision must stay `compatible` even WITH a grant". The static arm
computes `manifestDecision` from `host.negotiate(index, manifest, hostModel(...), [])` — NO grants. Nothing in
the static block writes or passes a grant file for the shipped manifest.
Why it matters: the interesting property ("a stray grant cannot flip the permission-less manifest") is worth
measuring, but the row asserts it as measured. It is the same class this row was rewritten to fix.
Direction: either say "with NO grant" (what is measured), or make it true by negotiating the shipped manifest
with the clone's one row and asserting `compatible` — a two-line addition to `staticGrants`.

**A4-F2 — Nit / flag on the A3-F6 deferral (the captain asked for a judgement).**
The writer deferred adding `end` to `surface-pin.ts`'s pinned `agent_teams_control` action set with the
premise "land when lane B's END verb is FROZEN". That premise is now SATISFIED (T10 PASS, T12 done). The
deferral was honest and recorded, and nothing is hidden — but its stated condition has arrived, the change is
ONE array literal in a file that already rides this wave's single skills re-pin, and the pin's purpose is to
catch a REMOVED verb (a subset check tolerates an ADDED one, which is exactly why `end` is invisible today).
Direction: land it in the same commit as the re-pin, or record an explicit captain decision not to. Do NOT
treat this as a T14 repair: it was a Note at A3, and T14 recorded it.

## 3. Declined to judge

- The empty `.mpd/recon/qa/tui-lanes/tui-admission` SKELETON still exists, but its `dshhome/profiles/` is GONE,
  so `profileState` fails at `absent-fixture` and the honest SKIP is restored — A3-F7 is genuinely fixed; the
  leftover empty directories are gitignored runtime scaffolding, not a finding.
- The main arm's `expect()` count fell by one (47 → 46): the merge of two assertions into a stricter
  `toEqual(["drive"])`. Strength went UP, not down — not scored as a removal.
- m5 reddens the CONTROL arm as well as the ORDER arm — correct cascade (a pre-sleep moves the drive behind the
  timer), not a false positive; the control still observes `timer(40ms)` on the retry path.
- The writer did NOT re-run the live TUI lane. I accept that: the only change to the lane is a comment block,
  PROVEN by the rebuilt-A3 hash + one-hunk diff, and I re-ran `--self-test`, `--static-only` and `test:qa`
  myself. My A3 live run stands on byte-identical arm code.
- Lane B's in-flight `packages/mpd-team-core-plugin/**` and the two expected reds — outside this row.
- `surface-pin.ts` is untouched by T14 (hash unchanged), so my A3 self-test/live evidence for it stands.

## 4. Gate evidence (this seat, this tree)

| gate | id | observed |
|---|---|---|
| `tests` | `ev-20261103T071233-a727d1` | exit 0 — `bun test packages`: 3483 tests, 231 files, **0 fail**, 6 skip |
| `typecheck` | `ev-20261103T071308-ffd69c` | exit 0 (`tsgo --noEmit`) |
| `comments` | `ev-20261103T071311-ad8671` | exit 0 — VERDICT: PASS |

Beyond the frozen table: `gates/21-tui-self-test-static.log` (self-test **0**, static-only **0**),
`gates/22-test-qa.log` (`all self-tests passed`, **0**), `gates/20-mutations.log` (m5 8/2, m2 8/2, m1 9/1,
m3 9/1, m4 36/1), `gates/23-vendor-expected-red.log` (**1**, one reason: `asset skills treeSha mismatch`),
`gates/24-dist-expected-red.log` (**1**, one STALE target: `mpd-team-core-plugin`). Both reds are the two
EXPECTED ones, not regressions.

## 5. Bounds

- I did not re-run the live TUI lane (see §3); the header change is comments-only by byte proof.
- The mutation replay needed narrow anchor greps in `packages/mpd-cellwork-plugin/src/{protocol-core,flow}.ts`
  — the same declared deviation as A3; the copy was deleted and the repository src was never written
  (`sha256` unchanged: `protocol-core.ts` `ce162655…`, `flow.ts` `8fdfe446…`).
- `SKILL.md` is documentation: I checked its claims against `result.json`, the arm names and the static code,
  not against a mechanical cross-check (none exists).
- The Docker lane was not run: no `packages/*/src` and no install-path change.

## 6. Evidence in this directory

```
00-criteria.md                     criteria frozen BEFORE the fix was read (07:11Z)
gates/00-scope-start.sha256        07:11:16Z — eight files
gates/13-diff-a3-to-current-tui.diff   ONE hunk, header only (rebuilt A3 == f44f1900…)
gates/14-diff-a3-to-current-test.diff  ONE hunk, the two ORDER arms (rebuilt A3 == deea1f1a…)
gates/10-diff-skill-md.diff        ONE changed row
gates/20-mutations.log             m5 RED (8/2), m2 RED (8/2), m1 9/1, m3 9/1, m4 36/1
gates/21-tui-self-test-static.log  0 / 0      gates/22-test-qa.log 0
gates/23-vendor-expected-red.log   exit 1 — ONLY the skills treeSha
gates/24-dist-expected-red.log     exit 1 — ONLY mpd-team-core-plugin STALE
```
