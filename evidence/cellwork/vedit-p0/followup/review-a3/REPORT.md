# Review A3 — the live `tui-admission` re-spec (T1) and the four lane-A Nits (T2)

**Row:** T11 (board), the REPLACEMENT formal review after the `rev-cellwork` seat failed post-write.
**Writer judged:** `se-cellwork` (`99a0e207…`). **Loops:** T1 `loop-20261103T061032-70b5ca`,
T2 `loop-20261103T061032-d4571e`. **Contract:** `.mpd/plans/vedit-p0-followup.md` §F1/§F2 (FROZEN
2026-11-03), judged against `AGENTS.md` §4 (frozen gate table) and §7 (QA discipline: assert a real
artifact, never prose).

**Tree judged** — pinned at **06:53:25Z**, re-hashed at **07:01:07Z**, IDENTICAL (`gates/00-scope-start.sha256`,
`gates/26-scope-end.sha256`): `tui-admission.ts` `f44f1900…`, `surface-pin.ts` `805b2dba…`, `dsh-plugin.json`
`87fdb475…`, `barrier-live-engine.test.ts` `deea1f1a…`, `flow.test.ts` `ea6ff957…`, contract `3e12b6f3…`,
`SKILL.md` `61918a7b…`; HEAD `2230607d`; 15 tracked modifications, none added by this seat.

**Verdicts: T1 — PASS. T2 — PASS.** **Risk level: LOW.** No Blocker/High. One wave-level Medium the
writer DISCLOSED, three Nits, three notes. Nothing in either row is repaired by this seat.

## 1. Assessment

Both rows deliver what the frozen contract asked, and I reproduced the two claims that matter most rather
than accepting them from a report: I drove the re-specified live lane on real TUI boots myself
(`gates/17-live.log`, exit **0**) and replayed all four lane-A mutations in a throwaway copy of the
package (`gates/25-mutations.log`), where each mutation reddens exactly the arm it targets. On the live
side the SHIPPED, permission-less manifest answers `compatible` in both `/plugin check` and `/plugin list`
with NO grants file and NO grants hint, the admission loader admits `com.mpd-dsh.mpd-tui`, a submitted
line renders a real turn, and the grant CLONE produces all four measured states on the host's own
`/plugin check` — ungranted `waiting_authorization` + hint, that row granted `compatible`, the same name
at an undeclared scope still `waiting_authorization`, and a mid-session revoke back to
`waiting_authorization`. Arm 3 is honest where it cannot hold: the artifact records the STRING
`"inapplicable"` (never a folded `true`) with a written reason, and the predicate that gates it is proven
two-sided in the self-test. The `ok` predicate did not shrink — it GAINED `arm1NoHint`, `arm5b`, `arm5c`,
and the static half is byte-identical across T1 (186-line block, equal sha256). On the test side the only
removed `expect(` in 18 is the old `< 500 ms` duration bound, which the contract ordered replaced by an
ORDER assertion, and my mutation replay confirms the replacement discriminates: a registry-first
`engineForBarrier` reddens ONLY the new differing-engine arm (the nine pre-existing arms stay green — the
precise blindness N1 named), a reintroduced config-seam pre-attempt sleep reddens BOTH ORDER arms, an
`interruptAgent` on the promoted path reddens the promoted arm, and a stripped warnings rule reddens the
split-description arm. What I can add is one measured residual on the ORDER probe, three
documentation-accuracy Nits, and the wave-level `SKILL.md` contradiction the writer already reported.

## 2. T1 — the live lane, criterion by criterion

| # | criterion | verdict | evidence (mine, unless named) |
|---|---|---|---|
| a | the shipped posture is asserted with NO grants file: both panes `compatible`, no grants hint | **PASS** | `gates/17-live.log`: `shipped /plugin check -> state=compatible; /plugin list -> state=compatible`, `grants hint absent: true`; `result.json.shipped.arms = {compatible:true, noGrantHint:true, loaderAdmitted:true, ledgerAttribution:"inapplicable", decisionTurn:true}` |
| b | the grant CLONE drives all FOUR states, from the newest decision window, never over the shipped file | **PASS** | my own boot: `ungranted → waiting_authorization hint=true`, `granted → compatible`, `wrong-scope → waiting_authorization`, `revoked → waiting_authorization flipped=true`; clone declares exactly one permission (shipped: zero); `manifestDigest` == `sha256(dsh-plugin.json)` == the hash pinned at 06:53; the self-test asserts the file is byte-identical across `writeGrantClone` |
| c | arm3 recorded as the STRING `"inapplicable"` + reason, and re-arms conditionally | **PASS** | `typeof shipped.arms.ledgerAttribution === "string"` (value `"inapplicable"`); `attributionArmsApplicable` proven BOTH ways in the self-test (permission-less → false; one declaration → true); `arm3 = !applicable \|\| (attributed>0 && binds>0)` |
| d | the live run exits 0 on the settled tree, and a SKIP is not claimed as a pass | **PASS** | `gates/17-live.log` ends `PASS …` + `EXIT=0`; the report §8 states the SKIP path was NOT exercised and lists arm 3 as unmeasured |
| e | no assertion weakened | **PASS** | pre→current diff: **0** `check(` removed, **9** added; the live `ok` predicate keeps every old term and adds three; the old `< 500 ms`-era arms are all named in the report's R2 table |
| f | the static half F1 landed is untouched; `--static-only` / `--self-test` exit 0 | **PASS** | 186-line static block (`staticGrantsOk` + `loadHostAdmission` + `staticAdmission`) byte-identical pre↔current (`gates/pre.staticblock.txt` vs `gates/cur.staticblock.txt`, equal sha256); `gates/16-tui-self-test-and-static.log`: self-test **0**, static-only **0** |
| g | the header names the codes `tuiPrereqs` actually gates | **FAIL (Nit)** | the header still reads `PREREQ: absent-runtime dsh-tui …`; the gate table (`lib/tui-lane.ts`) maps `absent-dsh-binary` → `dsh-tui` and `absent-runtime` → `tmux`, so the code is wrong AND `tmux` has no line. See A3-F3 |
| h | scope: only `tui-admission.ts` + the authorised `surface-pin.ts` ripple; `VENDOR_LOCK.json` untouched; no git write | **PASS** | `git status`: exactly the wave's 15 files, no `VENDOR_LOCK.json`, no commit; the third `skills/` file (`dual-track-smoke.ts`) belongs to F5/T14, outside both loops |

## 3. T2 — the four lane-A Nits, criterion by criterion

| # | criterion | verdict | evidence |
|---|---|---|---|
| a | **N1 differing engine** — registry HOLDS the member and answers a DIFFERENT engine; the handle's engine wins | **PASS** | the arm asserts `harness.adapter.compactionEngineForAgent(MEMBER) === otherEngine` (both seams reachable, different answers), `engine.calls.length===1`, `otherEngine.calls.length===0`; MY m1 (registry-first) reddens **only** this arm: `9 pass / 1 fail` |
| b | **N2 sleep ORDER** — an order, not a duration bound, plus a two-sided control | **PASS, bounded (Nit)** | the `< 500 ms` bound is gone; `timeline[0]==="drive"` and the control sees a real retry delay after the first drive; MY m2 (config-seam pre-sleep reintroduced) reddens **both** arms: `8 pass / 2 fail`. Residual measured by MY m5 (a hard-coded 200 ms pre-sleep): `10 pass / 0 fail` → see A3-F2 |
| c | **N3 split description** — black-box arm on the REGISTERED description | **PASS** | the arm reads the captured definition from the real `apply()` harness and requires `warnings` / `never change` / `writeScopes` / `BEFORE the first write`; MY m4 (rule stripped) reddens it: `36 pass / 1 fail` |
| d | **N4 interrupts** — `interrupts.length === 0` on the promoted path | **PASS** | the assertion sits beside `reseeds.length === 0`; MY m3 (`interruptAgent` added on the promoted path) reddens exactly that arm: `9 pass / 1 fail` |
| e | no test weakened; `packages/mpd-cellwork-plugin/src/**` unchanged | **PASS** | the diff's ONLY removed `expect(` is `toBeLessThan(500)`; 17 added; `git status` for the package shows the two test files only |
| f | N5: the historical red-first log's bytes unchanged and the report NOTES it | **PASS** | `git status` clean for `evidence/cellwork/vedit-p0/lane-a/red-first/d1-barrier-red.log`; line 1 still `# RED-FIRST on HEAD d2032bf3 — d2032bf3 — …`; the lane report §1 records it as NOTE ONLY |

**Package-level reproduction:** `bun test packages/mpd-cellwork-plugin` → **198 pass / 0 fail**, 24 files
(`gates/10-tests-cellwork.log`); in the throwaway copy the baseline is `10 pass / 47 expect` (barrier) and
`37 pass / 421 expect` (flow) — the lane report's exact numbers.

## 4. Findings (ranked)

**A3-F1 — Medium (WAVE-LEVEL, DISCLOSED — not a T1 defect) — `skills/dsh-qa/SKILL.md`'s `tui-admission`
case-table row now CONTRADICTS the case.**
Where: `skills/dsh-qa/SKILL.md`, the `tui-admission` row.
What: it still promises a `NO-GRANT negative-control boot (pane must say waiting_authorization)`, a static
control on "the manifest's own four rows", a `GRANTED boot` proving "applied decision-handler binds", and
"a REAL `tui/input` decision fires on a submitted line". Four statements are now false: the shipped
no-grant boot answers `compatible`; the manifest declares zero rows (the clone carries the one row); arm3
is inapplicable; arm4 claims a rendered turn, not an interception.
Why it matters: that row is how an agent decides what the case proves. The case now measures the OPPOSITE
posture for the shipped manifest, so a future reader would treat a correct green run as a regression.
Disclosed by the writer (`qa-live/report.md` §8) and outside T1's frozen scope — so it is NOT a T1 repair.
Direction: amend the row to the re-specified arms; it rides the SAME commit as the wave's single
`repin-vendor --write`, since `skills/**` is already invalidated by this change (§9 single-writer rule).

**A3-F2 — Nit — the ORDER probe is blind to a HARD-CODED pre-attempt sleep, and the D1 class was a sleep.**
Where: `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts`, both ORDER arms.
What: the patched `setTimeout` records only `ms === idleBarrierDelayMs` (1500 / 40). MY mutation m5 — a
hard-coded `await deps.sleep(200)` before the first attempt — leaves the suite `10 pass / 0 fail`, because
nothing enters the timeline and `timeline[0] === "drive"` still holds.
Why it matters: the Nit this row closes asked for an ORDER because the old `< 500 ms` bound could not see a
200 ms sleep; the new arm sees the *configured* sleep (m2 reddens it) but not a fixed one, so the same
class remains reachable. The lane report §4 declares this bound, and no assertion was weakened.
Direction: record every scheduled `ms` seen in the window (not only the configured one) so ANY timer
scheduled before the first drive reddens.

**A3-F3 — Nit — `tui-admission.ts`'s own `PREREQ:`/Evidence header is stale and mislabels a gate code.**
Where: `skills/dsh-qa/scripts/tui-admission.ts`, the header block.
What: `PREREQ: absent-runtime dsh-tui "npm i -g …"` — the `dsh-tui`-binary code is `absent-dsh-binary`
(`lib/tui-lane.ts` maps `absent-runtime` to `tmux`), and `tmux` has NO line at all. The Evidence line still
points at `negctl/,grants/`, which the re-spec no longer writes (`shipped/`, `clone/`, `grant-clone/`).
Why it matters: a reader who gets `SKIP absent-runtime` (tmux absent) cannot find the remedy here, and the
evidence pointer names directories a run never creates. The gate itself is correct — documentation only.
Direction: lift `tui-mount.ts`'s three `PREREQ:` lines verbatim and re-spell the Evidence line.

**A3-F4 — Nit — the T1 R2 table calls `arm2` "unchanged" while its MEASUREMENT moved.**
Where: `evidence/cellwork/vedit-p0/followup/qa-live/report.md` §2, the `arm2` row.
What: the predicate is unchanged, but it now reads `shipped/host-stderr.log`; the pre-edit arm read the
granted boot's `grants/host-stderr.log` (and the baseline log shows that boot admitted nothing:
`admitted=0 refused=0`). The row says "same line, same redirected stderr".
Why it matters: the R2 convention exists so a reader can tell a MOVED assertion from an untouched one; a
moved measurement labelled "unchanged" defeats exactly that.
Direction: say "the same predicate, now measured on the SHIPPED boot (the only one that admits the
Component)" and why.

**A3-F5 — Note (process) — the `surface-pin.ts` edit is outside both loops' declared write scopes.**
T1's scope is `tui-admission.ts` + its evidence subtree; the report §7 says the captain authorised the
`surface-pin.ts` one-liner in-session. I verified the SUBSTANCE, not the authorisation: the mutation anchor
now spells the live five-verb enum (`halt, resume, fence, unfence, end`), so the control is falsifiable
again (a stale anchor reddens the self-test rather than silently passing), and the pinned action set stays
a SUBSET check. My runs: `--self-test` **0** (EIGHT negative controls), the live case **PASS** **0**
(`gates/24-surface-pin.log`). Direction: record the authorisation in the wave report / PR body — a claimed
authorisation with no durable anchor is not verifiable later (T-90).

**A3-F6 — Note (observation, outside T1/T2) — `surface-pin.ts` does not pin the new `end` verb.**
Its pinned `agent_teams_control` set is `["halt","resume","fence","unfence"]`; the live enum now also
carries `end`, and the check is a deliberate SUBSET test, so removing `end` alone would not redden. The
new comment states the subset rationale; direction: add `end` to the pinned set when lane B's verb is
frozen, so the END verb gets the same protection `fence` has.

**A3-F7 — Note (environment) — the lane's DEFAULT sandbox root now carries a profile.**
`.mpd/recon/qa/tui-lanes/tui-admission` holds `dshhome/profiles/dsh-tui` with the host installed
(provisioned during this wave's experiments), so a NO-ARG run on this checkout no longer SKIPs at
`absent-fixture` — it passes the prerequisite gate and dies on the unix-socket path length (the report §6
bound). Not a defect and `gitignored` runtime state; direction: keep using `--sandbox-root .mpd/sb/…`, or
drop the experimental provisioning. My own run used `.mpd/sb/tui-admission` (65 chars) and booted.

## 5. Declined to judge (nothing disappears silently)

- The two EXPECTED reds — `vendor` on `asset skills treeSha mismatch` ONLY, and `dist` on the ONE
  `mpd-team-core-plugin` target — are scored as EXPECTED, not as regressions (X-b). I confirmed the vendor
  gate emits no second reason and the dist gate names exactly one STALE target.
- `dual-track-smoke.ts` / `dual-track.tsv` (F5/T14) — outside both loops' scope; not read.
- The team-core `end`-verb ripple, `scripts/pack-mpd.ts`, `verify-pack-closure.ts` (lane B) — outside.
- Arm 3's projection edge: `attributionArmsApplicable` keys on the PROJECTED rows, so a declaration whose
  name/scope were non-strings would project to zero rows and mark arm3 inapplicable. Closed upstream — such
  a manifest fails the host validator, so `stat.ok` is already false and the run reds. Not scored.
- `ok` carries `revokedClassification.state !== undefined` while the report calls arm 6 "observed, never
  gated". It is a CAPTURE-liveness gate, not an outcome gate; the outcome is still recorded, not asserted.
  Wording nuance, not scored.
- Whether the live PASS generalises beyond `dsh-tui 0.18.0` on this host — bounded, not claimed.
- The clone's `/plugin check` exercises the host's STATIC admission path only; the lane does not raise a
  live activation of the clone, and the report says so. Not scored.

## 6. Gate evidence (this seat, this tree, both loops)

| loop | gate | id | observed |
|---|---|---|---|
| T1 | `tests` | `ev-20261103T070318-df319e` | exit 0 — `bun test packages`: 3473 tests, 230 files, **0 fail**, 6 skip |
| T1 | `typecheck` | `ev-20261103T070358-ec4f11` | exit 0 (`tsgo --noEmit`) |
| T2 | `tests` | `ev-20261103T065923-e98f07` | exit 0 |
| T2 | `typecheck` | `ev-20261103T070006-677466` | exit 0 |
| T2 | `comments` | `ev-20261103T070007-9e033b` | exit 0 — VERDICT: PASS |

**Verdicts recorded on the loops:** T1 `rec-20261103T070445-4ec5de` **PASS**, T2
`rec-20261103T070451-5ee048` **PASS**.

**The `comments` gate for T1, declared rather than hidden.** The evidence id is per-loop, so only
T1-bound runs count for T1. My 06:59:58Z `comments` run was exit **0** (`ev-20261103T065958-aa7fab`, bound
to T2 and therefore not citable on T1); the 07:03:59Z T1-bound run exited **1** on
`packages/mpd-team-core-plugin/src/{index.ts,team-store.ts}` — lane B's IN-FLIGHT edit (file mtime
07:02:41Z, one minute before the run; the earlier passing run scanned 592 files, the failing one 593). That
is the excluded N3 lane, not either loop under review: no T1/T2 file changed between the two runs (the
scope hashes are identical at 06:53:25Z and 07:01:07Z). The T1 record therefore cites `tests` + `typecheck`
and states this in its notes.

Beyond the frozen table, my own artifacts: `gates/12-test-qa.log` (**0**, `all self-tests passed`),
`gates/16-tui-self-test-and-static.log` (**0 / 0**), `gates/17-live.log` (**0**, real TUI boots),
`gates/24-surface-pin.log` (**0 / 0**), `gates/10-tests-cellwork.log` (198/0), `gates/25-mutations.log`
(m1 9/1, m2 8/2, m3 9/1, m4 36/1, m5 10/0), `gates/14-vendor-expected-red.log` (exit 1, one reason),
`gates/15-dist-fresh-expected-red.log` (exit 1, one STALE target).

## 7. Bounds — what I did NOT read and could NOT run

- **I did not re-create the pre-edit red.** A revert is a git write and the captain alone commits; I cite
  `qa-live/baseline-preedit-live.log` and note it is consistent with the old arms in a2's `pre/` snapshot.
- **I did not read `packages/mpd-cellwork-plugin/src/**` to form the verdict.** The four mutation replays
  needed FOUR narrow anchor locations, quoted in the lane report itself (`engineForBarrier`, the
  `if (attempt > 1)` sleep seam, the promoted-path `injectDirective`, the split description) — a mechanical
  substitution, not a reading pass, and the copy was deleted afterwards. **This is a declared deviation
  from strict blindness** and I state it rather than hiding it.
- **My live run is not clean-room provisioning.** It reused the wave's warm `.mpd/sb/tui-admission` root
  (profile + credentials already staged) and made its own boot; `tui-mount.ts --install` was NOT re-run.
- **The Docker lane was not run.** F1–F4 touch tests/skills/scripts, not `packages/*/src`; the release's
  Docker evidence stands (contract §Gates).
- `verify:docs` / `verify:manifest` / `verify:rows` were not scored: no doc, manifest or row changed in
  these two loops (the manifest is untouched — proven by digest).
- The mutation copy was removed; the only residue of my runs is `evidence/tui/lanes/2026-11-03T06-54-34.840Z`
  (the lane writes it itself), the verify-evidence logs, and `gates/` here.

## 8. Evidence in this directory

```
00-criteria.md                     criteria frozen BEFORE the code was read (06:53Z)
gates/00-scope-start.sha256        06:53:25Z — seven files, by hash
gates/26-scope-end.sha256          07:01:07Z — IDENTICAL (the settled-tree sandwich)
gates/10-tests-cellwork.log        198 pass / 0 fail
gates/11-typecheck.log             0        gates/13-comments.log 0
gates/12-test-qa.log               0        gates/16-tui-self-test-and-static.log 0 / 0
gates/17-live.log                  0 — my own live boots; lane artifact evidence/tui/lanes/2026-11-03T06-54-34.840Z
gates/24-surface-pin.log           0 / 0
gates/25-mutations.log             m1 9/1 · m2 8/2 · m3 9/1 · m4 36/1 · m5 10/0 (the bound probe)
gates/14-vendor-expected-red.log   exit 1 — ONLY `asset skills treeSha mismatch`
gates/15-dist-fresh-expected-red.log exit 1 — ONLY mpd-team-core-plugin STALE
gates/19-diff-tui-admission.diff    the wave diff this review judged
gates/21-diff-pre-to-current.diff   T1 proper (pre-T1 snapshot → current), 0 check( removed / 9 added
gates/22-diff-lane-a-tests.diff     T2, 1 expect( removed (the duration bound) / 17 added
gates/pre.staticblock.txt · cur.staticblock.txt   the byte-identical static half
```
