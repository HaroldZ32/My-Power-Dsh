# Review A2 — the live `tui-admission` re-spec (T1) and the four lane-A Nits (T2)

**Row:** T4 (board), wave 0.17.2. **Writer judged:** `se-cellwork`.<br>
**Loops:** T1 `loop-20261103T061032-70b5ca` (N1), T2 `loop-20261103T061032-d4571e` (N2).<br>
**Contract:** `.mpd/plans/vedit-p0-followup.md` §F1/§F2 (FROZEN 2026-11-03), judged against `AGENTS.md`
§4 (frozen gate table) and §7 (QA discipline: assert a real artifact, never prose).<br>
**Tree judged:** `fix/vedit-p0-followup`, HEAD `2230607d` + the wave's working tree, pinned by hash
`f44f1900…` (`tui-admission.ts`), `deea1f1a…` (`barrier-live-engine.test.ts`), `ea6ff957…` (`flow.test.ts`)
— identical at 06:39:17Z (start) and 06:48:26Z (end), no change across the review (`18-scope-end.sha256`).

**Verdicts: T1 — PASS. T2 — PASS.** **Risk level: LOW.** No Blocker/High; one wave-level follow-up
(Medium, DISCLOSED by the writer) and four Nits.

## 1. Assessment

Both rows do what the frozen contract asks, and the two hardest claims were reproduced independently in
this seat rather than accepted from the reports. For T1 I ran the re-specified lane myself on real TUI
boots under a short sandbox root (`gates/12-live-shortroot.log`, exit 0): the SHIPPED permission-less
manifest answers `compatible` in both `/plugin check` and `/plugin list`, prints NO grants hint, the
admission loader admits `com.mpd-dsh.mpd-tui`, and a submitted line renders a real chat turn; the grant
CLONE (`dsh-plugin.grant-clone.json` — the shipped file's bytes plus ONE
`session.input.intercept@tui/input` row, never the shipped file) then produces the three-state
discriminator on the host's own `/plugin check`: ungranted → `waiting_authorization` + the host's grants
hint, that row granted → `compatible`, the same name at an undeclared scope → still
`waiting_authorization`, and the mid-session revocation flips back. The arm that cannot exist in a
permission-less world (an APPLIED decision-handler bind) is not folded into a pass: it is recorded as the
STRING `"inapplicable"` plus a reason in `grantArms`, and the predicate that gates it is proven two-sided
in the self-test. Every assertion that moved is named in the T1 report's R2 table, and the static half F1
landed is byte-for-byte untouched. For T2 the four Nits are each pinned by an arm that reddens under its
own defect (m1–m4), the duration bound is gone in favour of an ORDER assertion with a two-sided control,
and the historical red-first log was left alone. What I can add are documentation-accuracy Nits inside
T1's own file and report, plus one wave-level item the writer already disclosed: `SKILL.md`'s case-table
row still describes the pre-fix live arms and is outside T1's frozen scope, so the captain must decide
whether it rides the wave's single skills re-pin.

## 2. T1 — the live lane, criterion by criterion

| # | criterion | verdict | evidence |
|---|---|---|---|
| a | the pre-edit red is reproduced, and it is the permission-less construction | **PASS** | `qa-live/baseline-preedit-live.log`: pre-edit file in a scratch checkout `…/base-repo`, exit 1, `arm3:false, arm5:false`, `negctl … state=compatible`, `revokedState=compatible`; consistent with the old arms in my `pre/` snapshot. I did NOT re-create the red (a revert is a git write — §7) |
| b | the shipped posture is asserted with NO grants file | **PASS** | my own run: `shipped /plugin check -> compatible; /plugin list -> compatible`, `grants hint absent: true`; `result.json.shipped.arms = {compatible, noGrantHint, loaderAdmitted, ledgerAttribution:"inapplicable", decisionTurn}` all true/inapplicable |
| c | the grant CLONE drives the real three states and never touches the shipped manifest | **PASS** | my own run: `ungranted → waiting_authorization hint=true`, `granted → compatible`, `wrong-scope → waiting_authorization`, `revoked → waiting_authorization flipped=true`; the self-test asserts `sha256File(MANIFEST)` is unchanged across `writeGrantClone`, and the run's `manifestDigest` matches the shipped file |
| d | arm3 is declared INAPPLICABLE loudly and re-arms conditionally | **PASS** | the artifact carries `grantArms.applicable=false`, `inapplicable:["arm3-ledger-attribution"]`, a written reason, and `shipped.arms.ledgerAttribution: "inapplicable"` — the STRING, never a folded `true`; `attributionArmsApplicable` is proven two-sided in the self-test, and `arm3 = !applicable \|\| (attributed>0 && binds>0)` |
| e | arm5/arm3/arm4 no longer demand a grant the shipped manifest never has | **PASS** | arm5 moved to the clone (where a declaring manifest exists); arm3 is the conditional above; arm4's assertion (the submitted line renders) is unchanged and its prose no longer claims a live decision handler |
| f | the shipped decision `compatible` is asserted separately | **PASS** | two separate assertions: the live `arm1` (both shipped panes) and the static `grants.manifestDecision === "compatible"` inside `staticGrantsOk` |
| g | no assertion weakened | **PASS** | removed lines: 141, ALL from the old live block; every assertion-bearing removal is a named R2 replacement (old `arm2`, `arm3`, `arm5`, `ok`, the evidence-field assignments). Net ADDITIONS: `arm1NoHint`, `arm5b`, `arm5c`, plus three self-test controls (`lastCheckWindow` two-sided, the clone document, the attribution predicate). The static half (`staticAdmission`) is unchanged — no diff line touches it |
| h | `--static-only` and `--self-test` stay green | **PASS** | my own runs on `f44f1900…`: `gates/10-self-test.log` exit 0, `gates/11-static-only.log` exit 0 (`evidence/tui/lanes/2026-11-03T06-37-38.816Z`) |
| i | the live run's PREREQ/bound is honest | **PASS, bound carried by the report; one Nit on the file's own PREREQ block** | §6 states the two real constraints (short unix-socket root path; warm profile + credentials) and §8 states arm3 and the SKIP path; `gateTuiPrereqs` still SKIPs (exit 0) on an unprovisioned root. Nit F1 below: the file's `PREREQ:` lines mislabel the dsh-tui code and omit the tmux prerequisite |
| j | scope and git hygiene | **PASS** | `skills/` changes: `tui-admission.ts`, `surface-pin.ts` (captain-authorised, §7 of the T1 report), `dual-track-smoke.ts` (T14's F5) — nothing else; `VENDOR_LOCK.json` untouched; no commit |

## 3. T2 — the four lane-A Nits, criterion by criterion

| # | criterion | verdict | evidence |
|---|---|---|---|
| a | N1 — a differing-engine arm proves the LIVE handle wins | **PASS** | new `D1/C1: the LIVE handle's engine WINS over a registry that answers a DIFFERENT engine` + `HarnessOptions.registryEngineOverride`; asserts `otherEngine.calls.length === 0`; mutation **m1** (registry-first) reddens it alone |
| b | N2 — the sleep claim is an ORDER, not a duration | **PASS** | the `< 500 ms` arm is REPLACED by `C1: the FIRST attempt is driven BEFORE any barrier delay is scheduled` (a `drive`/`delay` timeline, `timeline[0] === "drive"`) plus `C1: the ORDER probe SEES the barrier delay when a retry really sleeps`; mutation **m2** reddens both |
| c | N3 — the `cellwork_split` DESCRIPTION states the warnings rule, black-box | **PASS** | new arm in `flow.test.ts` reading the CAPTURED definition from the real `apply()` harness; asserts `warnings`, `never change`, `writeScopes`, `BEFORE the first write`; mutation **m4** reddens it |
| d | N4 — `interrupts.length === 0` on the promoted path | **PASS** | added next to `reseeds.length === 0` in `D1/C6(b,c,d)`; mutation **m3** (an interrupt on the promoted path) reddens that arm |
| e | N5 — the historical red-first log is NOT rewritten and the Nit is noted | **PASS** | `sha256 8af8b7e8…` identical before and after (sandwich), `git status` clean for that path; `lane-a/report.md` §1 N5 records it as note-only |
| f | every moved assertion named; no weakening | **PASS one Nit** | the barrier diff is 93 added / 10 removed, and every removed line is named in the report's R2 table (the old `registryEngine` line; the old sleep arm and its two `expect`s); `flow.test.ts` has ZERO removed content lines. Nit F4: the ORDER probe only records `ms === idleBarrierDelayMs`, so a hard-coded pre-attempt sleep would evade it — the report declares this bound |
| g | no `src` change unless proven | **PASS** | `git status` shows only `packages/mpd-cellwork-plugin/test/**` for this package; no `dist/` rebuild is owed by lane A |
| h | the arms pass on the settled tree | **PASS** | my own runs: `bun test packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts packages/.../flow.test.ts` → 47 pass / 0 fail (10 + 37); `bun test packages/mpd-cellwork-plugin` → 198 pass / 0 fail, 24 files |

## 4. Gate evidence (this seat, this tree)

| loop | gate | id | observed |
|---|---|---|---|
| T1 | `typecheck` | `ev-20261103T064651-966065` | exit 0 |
| T1 | `comments` | `ev-20261103T064655-586285` | exit 0 |
| T1 | `tests` | `ev-20261103T064700-f666d6` | **3467 pass / 6 skip / 0 fail**, 230 files, 34 s, exit 0 |
| T2 | `typecheck` | `ev-20261103T064549-19310e` | exit 0 |
| T2 | `comments` | `ev-20261103T064553-626879` | exit 0 |
| T2 | `tests` | `ev-20261103T064559-ddfa9c` | **3467 pass / 6 skip / 0 fail**, exit 0 |

Artifacts in `gates/`: `10-self-test.log` (0), `11-static-only.log` (0), `12-live-shortroot.log` (**0**, real
TUI boots), `13-test-qa.log` (**0**, `[test:qa] all self-tests passed`), `14-cellwork-package.log` (198/0),
`15-lane-a-tests.log` (47/0), `16-vendor-expected-red.log` (**exit 1, exactly `asset skills treeSha
mismatch`** — expected until the captain's single re-pin), `17-dist-fresh.log` (**exit 1, one stale target
`packages/mpd-team-core-plugin/dist/index.js`** — the in-flight N3 repair, outside both loops).

## 5. Findings (ranked)

**F1 — Nit — `tui-admission.ts`'s own `PREREQ:` block names the wrong gate code and omits a prerequisite,
and its Evidence line lists directories the re-spec no longer writes.**
Where: `skills/dsh-qa/scripts/tui-admission.ts`, the header block.
What: it declares `PREREQ: absent-runtime dsh-tui "npm i -g …"` — the code for the `dsh-tui` binary is
`absent-dsh-binary`; `absent-runtime` is the `tmux` prerequisite and has NO line at all. The closing line
still says `Evidence -> …{…,negctl/,grants/}` while the lane now writes `shipped/`, `clone/`,
`grant-clone/`. The sibling `tui-mount.ts` carries the correct three lines.
Why it matters: a reader who gets `SKIP absent-runtime` (tmux absent) cannot find the matching remedy in
this file, and the evidence pointer names dirs that do not exist after a run. The gate itself
(`tuiPrereqs`) is correct, so this is documentation only — no behaviour changes.
Direction: copy `tui-mount.ts`'s three `PREREQ:` lines verbatim and re-spell the Evidence line.

**F2 — Nit — `arm2` is a MOVED assertion, and the R2 table calls it "unchanged".**
Where: `qa-live/report.md` §2, the `arm2` row.
What: the predicate is unchanged, but its MEASUREMENT moved from the old granted boot's
`grants/host-stderr.log` to the shipped boot's `shipped/host-stderr.log` (and the baseline log shows the
old granted boot could not produce it: `admission loader admitted=0 refused=0`). The row reads "unchanged
(same line, same redirected stderr)", which is factually wrong about the stderr file.
Why it matters: the brief's own rule is that every MOVED assertion is named; a row that says "unchanged"
about a moved measurement is the one thing an R2 table must not do.
Direction: change the row to "arm2 — the same predicate, now read from the SHIPPED boot's stderr (the
granted boot never admitted the Component)" and say why.

**F3 — Nit (T2) — the ORDER probe is blind to a HARD-CODED sleep.**
Where: `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts`, both ORDER arms.
What: the patched `setTimeout` records only `ms === idleBarrierDelayMs` (1500 / 40). A regression that
slept a hard-coded 200 ms before the first attempt would push nothing into the timeline, and
`timeline[0] === "drive"` would still pass — the very D1 class the old `< 500 ms` bound could see.
Why it matters: the Nit asked for an ORDER assertion, and this one is sound for the configured knob
(mutation m2 reddens it); the residual risk class is narrower than before but declared in the report §4.
Direction: record every scheduled `ms` (or a set of them) instead of filtering to the configured value, so
ANY timer scheduled before the first drive reddens.

**F4 — Follow-up (Medium, WAVE-LEVEL, DISCLOSED — not a T1 defect) — `SKILL.md`'s `tui-admission` case-table
row still describes the PRE-fix live arms.**
Where: `skills/dsh-qa/SKILL.md`, the `tui-admission` row.
What: it still says a NO-GRANT boot must show `waiting_authorization`, and a GRANTED boot proves applied
decision-handler binds — both are exactly what the re-spec removed. The writer REPORTED this as a bound
and did not edit it (a skills file outside T1's frozen scope), so nothing is hidden.
Why it matters: that row is how an agent decides what the case proves; it now contradicts the case.
Direction: the captain decides — amend the T1 scope (it rides the wave's SINGLE skills re-pin) or open a
follow-up row. NOT a repair for this reviewer to make.

**F5 — Note (process) — the `surface-pin.ts` edit is outside both loops' declared write scopes.**
The T1 report §7 states it was captain-authorised, and I verified the substance: the negative control's
mutation anchor now spells the five-verb enum (`halt, resume, fence, unfence, end`), so the control is
falsifiable again (`surface-pin --self-test` exit 0, 8 controls; the live case PASS). No assertion is
weakened. Direction: record the authorisation in the wave report / PR body — a claimed authorisation with
no durable artifact anchor is not verifiable by a later reader (T-90).

**F6 — Note (local environment) — the case's DEFAULT sandbox root is now provisioned, so a no-arg run on
this machine fails at tmux instead of SKIPping.**
My own no-arg attempt (06:39:22Z) passed the prereq gate and then died on the unix-socket path
(`.mpd/recon/qa/tui-lanes/tui-admission/…` → 109 chars > 108) with an empty `shipped/` dir; I killed it and
re-ran under `.mpd/sb/tui-admission` (93 chars). The report §6 declares the socket-length bound, but its
sentence "the lane's DEFAULT root has no profile" is stale for this checkout (the root was provisioned at
15:15 local during this wave's experiments). `.mpd/recon/**` is gitignored runtime state, not shipped —
direction: drop that experimental provisioning, or state it beside the bound.

## 6. Declined to judge

- **The registration/attribution gap itself** (no decision-handler ledger record even WITH a declaration,
  measured 2026-10-14) — arm3 is declared inapplicable, so this stays UNMEASURED by the lane; whether the
  gap is a product defect is a product row, not this review.
- **A live ACTIVATION of the clone** — the clone is only run through `/plugin check` (the host's static
  admission path); the lane raises no session on it, and the report says so.
- **The model's answer on the arm4 turn** — the arm asserts the submitted line renders (a chat turn), not
  what the model answered; that is the rewrite's declared scope.
- **`packages/mpd-team-core-plugin` src/dist** — the in-flight N3 repair (T8) leaves one committed `dist/`
  target stale; it is outside both loops and the captain integrates after the repair.
- **The wave's single `repin-vendor --write`** and the three skills files it must cover — the captain's.
- **T14's F5 `dual-track-smoke` work** — not my row (it is in the T14 report).
- **The 0.17.1-vs-0.17.2 version decision and the carriers** — the user's / captain's.
- **Docker lane, `preset-conformance`, `verify:docs`, `verify:manifest`** — not owed by these two rows
  (tests/skills only; `verify:manifest`'s subject is unchanged).

## 7. Bounds of this review

- **I read no `packages/*/src/**`.** My inputs were the frozen contract, the two lane reports, the TESTS
  (allowed by the seat brief), the reviewed QA script itself, the shipped manifest's own decision note,
  `AGENTS.md` §4/§7, and black-box runs. The verdicts were formed from those before any implementation
  would have been read for diagnosis; no FAIL was recorded, so no diagnosis pass was opened.
- **I did not re-create the pre-edit red** (that needs a revert = a git write, the captain's alone); I
  cite the writer's `baseline-preedit-live.log` and state that it is consistent with the old arms in my
  pre-change snapshot.
- **My live run is not a clean-room provisioning.** It reused the wave's warm sandbox root
  `.mpd/sb/tui-admission` (short path, profile + credentials already staged) and made its OWN two boots
  on the settled tree; a from-scratch `tui-mount.ts --install` was not re-run.
- **`tests`/`typecheck`/`comments` are the frozen-table gates I could cite for these rows.** `test:qa` and
  the case's own runs are artifacts, not frozen ids; `dist` is red for the N3 repair (outside), and
  `vendor` is red exactly on the skills `treeSha` (the captain's single re-pin) — neither is scored here.
- **The sandbox `dsh-tui` profile is local state**; the live result is a statement about `dsh-tui 0.18.0`
  on this host, not a general claim.

## 8. Evidence in this directory

```
00-criteria.md                 criteria frozen BEFORE the code was read
pre/                           pre-T1 snapshots (tui-admission.ts, the three test files) + PRE.sha256
gates/00-scope-start.sha256    06:39:17Z — the six files, by hash
gates/18-scope-end.sha256      06:48:26Z — IDENTICAL (the settled-tree sandwich)
gates/10-self-test.log         0   gates/11-static-only.log  0   gates/12-live-shortroot.log  0
gates/12-live.log              my killed no-arg attempt (the socket-length bound, F6)
gates/13-test-qa.log           0   gates/14-cellwork-package.log 198/0   gates/15-lane-a-tests.log 47/0
gates/16-vendor-expected-red.log  exit 1 — ONLY `asset skills treeSha mismatch`
gates/17-dist-fresh.log        exit 1 — team-core dist stale (the N3 repair, outside)
```
Host-side live evidence from my own run: `evidence/tui/lanes/2026-11-03T06-41-38.012Z/`
(`result.json`, `shipped/`, `clone/`, `grant-clone/dsh-plugin.grant-clone.json`).
