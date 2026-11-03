# Review A5 — the T18 fix of A4-F1/A4-F2 (shipped-with-grant measured; `end` pinned)

**Row:** T19 (board), re-review of `T18`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T071704-813e2a` (T18). **Contract:** `.mpd/plans/vedit-p0-followup.md` (§F1/§F2) +
the A4 findings (`evidence/cellwork/vedit-p0/followup/review-a4/REPORT.md`). **Gate authority:** `AGENTS.md`
§4, §7.

**Tree judged** — pinned **07:25:00Z**, re-hashed **07:29:47Z**, IDENTICAL (`gates/00-scope-start.sha256`,
`gates/40-scope-end.sha256`): `SKILL.md` `d6d93ca3…`, `tui-admission.ts` `98ff00ec…`, `surface-pin.ts`
`0d883365…`, the team-core enum `f5461b9d…` (lane B's frozen verb), the barrier test `d5e37b40…` (unchanged
since A4), contract `3e12b6f3…`, HEAD `2230607d`. The exact T18 deltas were measured against REBUILT A4 byte
images (`71477fbc…` / `e296420c…` / `805b2dba…`, each rebuilt hash equal to the A4 hash): one row in
`SKILL.md`, one array + comment in `surface-pin.ts`, ten small hunks in `tui-admission.ts`.

**Verdict: PASS.** **Risk level: LOW.** No Blocker/High. One Nit (a vacuity risk in the NEW live arm, shown
below with a measured demonstration) and one process note. Nothing is repaired by this seat.

## 1. Assessment

Both A4 findings are closed, and A4-F1 is closed the harder way: the writer made the claim TRUE instead of
softening the wording. The static plane now negotiates the SHIPPED manifest a second time WITH the clone's
one stray row and requires `compatible`, and that decision (`grants.manifestGranted`) is folded into
`grants.ok`; the live plane re-drives `/plugin check <shipped manifest>` INSIDE the granted boot as a new
`shipped-granted` step and requires `compatible` (`arm5d`). I reproduced all of it on my own boot: the lane
exited 0 with `shipped-with-grant /plugin check -> state=compatible`, my own `admission-static.json` carries
`manifestGranted: "compatible"` with `ok: true`, and my `result.json` carries
`shipped.withGrant = {check:"compatible", arm:true}`. Nothing permission-less moved: the arm definitions
diff shows ONLY `arm5d` added (and its one `say` line), the live `ok` predicate kept every old term and
gained `arm5d`, and `grants.ok` kept its four old conjuncts and gained one. A4-F2 is closed with a real
red-first: with `end` removed from the live enum, the live case exits **1** with `tool agent_teams_control
no longer offers action 'end'` and the self-test exits **1** with the same problem plus its own negative
control, and the source was restored byte-identically. What I can add is one precise caveat about the new
live arm: its expected value equals the immediately preceding decision, so a step that produced NO output
would still read `compatible`.

## 2. (a) A4-F1 — measured on both planes

| # | criterion | verdict | evidence |
|---|---|---|---|
| a1 | STATIC `grants.manifestGranted` (shipped + the clone's row) is `compatible` AND folded into `grants.ok` | **PASS** | the code adds `const shippedGranted = host.negotiate(index, manifest, hostModel(...), [grantRow])`, records `manifestGranted: decisionOf(shippedGranted)` and adds `&& decisionOf(shippedGranted) === "compatible"` to `grants.ok`; MY `--static-only` artifact: `{manifestDecision:"compatible", manifestGranted:"compatible", ungranted:"waiting_authorization", granted:"compatible", wrongScope:"waiting_authorization", ok:true}` |
| a2 | LIVE `shipped.withGrant`/`arm5d` re-checks the SHIPPED manifest inside the GRANTED boot, lane green | **PASS** | the `shipped-granted` step is inserted after `clone-granted` (so the grants file holds the row) with no `before`; MY live run (`gates/30-live.log`, exit **0**) prints `shipped-with-grant /plugin check -> state=compatible`; MY `result.json`: `shipped.withGrant = {check:"compatible", arm:true}`; the captured `clone/shipped-granted.pane.txt` carries a THIRD decision line, after the ungranted and granted ones |
| a3 | no permission-less arm touched; `ok` only GAINED a term | **PASS** | `diff` of the `const arm…` definitions A4↔now: ONLY `+ const arm5d = …`; `say(` lines: only `+ shipped-with-grant …`; live `ok` = the old predicate + `arm5d`; `grants.ok` = the four old conjuncts + one; `manifestDecision`/`ungranted`/`granted`/`wrongScope` byte-identical |
| a4 | `SKILL.md` states the measured pair accurately | **PASS** | the row now says "… must stay `compatible` with NO grant AND with that row granted (measured twice: the static `negotiate` on both grant sets, and a live `/plugin check` re-driven inside the granted boot — a stray grant cannot flip a permission-less manifest)" — exactly the two artifacts |
| a5 | the artifacts carry the new fields | **PASS** | my `admission-static.json` `manifestGranted` + my `result.json` `shipped.withGrant`; the writer's `run-artifacts/` carry the same pair |

**A5-F1 — Nit — the new live arm can pass VACUOUSLY.** `arm5d` asserts
`lastCheckWindow(shippedGrantedPane).verdict.state === "compatible"`, and the step's expected value is the
SAME as the immediately preceding decision (`clone-granted` also answered `compatible`). If the
`shipped-granted` step produced NO new decision — a swallowed keystroke, or the host not finishing inside
`waitMs: 20_000` on a loaded machine — the captured pane is the previous pane and the helper returns the
GRANTED decision. MEASURED demonstration on my own run's artifacts: `clone/clone-granted.pane.txt` carries
2 decisions whose last is `compatible`, and running the helper's own algorithm over it returns
`compatible` → `arm5d` would be TRUE with the shipped check never having run. The other four arms are
self-protecting (their expected values DIFFER from the preceding decision, so a missing step reddens them);
`arm5d` is the only one that is not. Why it matters: A4-F1's whole point was "measure it, do not promise it",
and the artifact records `withGrant.check: "compatible"` as if the live host answered. The claim itself is
still measured on the STATIC plane (which cannot be vacuous — it is a direct `negotiate` with the row), so
this is a live-arm hygiene defect, not a false claim.
Direction: assert the decision produced is NEW — e.g. the pane's decision-line COUNT grew by one relative to
the `clone-granted` capture, or the `shipped-granted` window's line index is greater than the previous
step's — so a step that produced nothing reddens instead of reusing the verdict above it.

## 3. (b) A4-F2 — the `end` verb is pinned and falsifiable

| # | criterion | verdict | evidence |
|---|---|---|---|
| b1 | the pinned set contains `end`, and the live enum offers it | **PASS** | `surface-pin.ts`: `{ source:"teamCore", name:"agent_teams_control", actions:["halt","resume","fence","unfence","end"] }`; the enum at `packages/mpd-team-core-plugin/src/index.ts` reads `enum: ["halt","resume","fence","unfence","end"]` (one occurrence) |
| b2 | **m6 reproduced by me**: removing `end` reddens BOTH planes with that message | **PASS** | my run (`gates/21-pin-end-mutation.log`): baseline live 0 / self-test 0; after removing `end` (1 occurrence) live **exit 1** `[surface-pin] FAIL: 1 surface problem(s) - tool agent_teams_control no longer offers action 'end'`, self-test **exit 1** with the same problem AND `negative control: a removed action verb must redden`; source restored byte-identically (`f5461b9d…`) |
| b3 | the pin stays a SUBSET assertion; nothing else weakened | **PASS** | the check is still `for (const action of expectation.actions ?? []) if (!enumOf(tool.block,"action").includes(action)) problems.push(...)`; the self-test still reports EIGHT negative controls; the A4↔now delta of the file is ONE hunk (the array + its 3-line comment) |
| b4 | the change is minimal | **PASS** | one array literal + a comment; no other edit in the file |

## 4. (c) Gates on the settled tree (this seat)

| gate | id | observed |
|---|---|---|
| `tests` | `ev-20261103T072805-0cf79f` | exit 0 — 3485 tests, 231 files, **0 fail**, 6 skip |
| `typecheck` | `ev-20261103T072705-18a6e6` | exit 0 (`tsgo --noEmit`) |
| `comments` | `ev-20261103T072706-28b19e` | exit 0 — VERDICT: PASS |

Beyond the frozen table: `gates/20-surface-pin.log` (live **0**, self-test **0**, EIGHT controls),
`gates/30-live.log` (**0**, real TUI boots with the new arm), `gates/22-tui-self-static.log` (**0 / 0**),
`gates/23-test-qa.log` (**0**, `all self-tests passed`), `gates/24-vendor-expected-red.log` (**1**, one
reason: `asset skills treeSha mismatch`), `gates/25-dist-expected-red.log` (**1**, ONE stale target:
`mpd-team-core-plugin`). Both reds are the two EXPECTED ones.

## 5. Note (process) — the loop's frozen scope is narrower than the change

`loop-20261103T071704-813e2a` froze `["skills/dsh-qa/SKILL.md", "skills/dsh-qa/scripts/surface-pin.ts",
"packages/mpd-cellwork-plugin/test/**", "evidence/…/review-fix2/**"]` — it does NOT list
`skills/dsh-qa/scripts/tui-admission.ts`, which T18 changed for the LIVE plane of A4-F1 (and which the
writer's own report names in its scope). The substance is reviewed (I judged that file, as the captain asked),
but a later reader of the LOOP record would not see it covered. Direction: widen the loop scope, or note the
amendment in the wave report; not a defect of the work.

## 6. Declined to judge

- The `end` pin tolerates a FUTURE added verb — that is the pin family's declared shape (subset check), and
  the new comment says so. Not scored.
- `surface-pin.ts`'s `teamStore`/`cellwork` surfaces were not re-audited: they are unchanged by T18 (the
  A4↔now delta is one hunk) and their self-test controls still pass.
- Lane B's in-flight `packages/mpd-team-core-plugin/**` test files and the two expected reds — outside.
- The `shipped-granted` step's 20 s `waitMs` is the same as its siblings; whether 20 s is the right budget on
  a loaded host is a lane-wide question, not T18's.
- The live lane's `absent-fixture` SKIP path was not exercised (the warm root has a profile) — declared bound.

## 7. Bounds

- m6 required removing `end` from a file the case READS (`packages/mpd-team-core-plugin/src/index.ts`). It
  ran in ONE shell invocation with an EXIT trap; the restore was verified byte-identical (`f5461b9d…`), and
  the scope hashes are identical at the start and the end of the review. **Declared deviation**, same class
  as A3/A4.
- The live lane was measured on `dsh-tui 0.18.0` with the warm `.mpd/sb/tui-admission` root on THIS host.
- No `packages/*/src` change of the writer's; no dist rebuild owed by this row; the Docker lane does not re-run.

## 8. Evidence in this directory

```
00-criteria.md                        criteria frozen BEFORE the fix was read (07:25Z)
gates/00-scope-start.sha256 · 40-scope-end.sha256   identical (07:25:00Z → 07:29:47Z)
gates/10-diff-a4-to-current-tui.diff  10 hunks, ~40 lines (the A4 images were REBUILT and hash-verified)
gates/11-diff-a4-to-current-skill.diff  ONE row, one sentence
gates/12-diff-a4-to-current-pin.diff    ONE array + 3-line comment
gates/20-surface-pin.log              live 0 / self-test 0
gates/21-pin-end-mutation.log         m6: live 1, self-test 1, source restored f5461b9d…
gates/22-tui-self-static.log          0 / 0
gates/23-test-qa.log                  0
gates/24-vendor-expected-red.log      exit 1 — ONLY the skills treeSha
gates/25-dist-expected-red.log        exit 1 — ONLY mpd-team-core-plugin STALE
gates/30-live.log                     exit 0 — my own boots, incl. `shipped-with-grant … -> compatible`
```
