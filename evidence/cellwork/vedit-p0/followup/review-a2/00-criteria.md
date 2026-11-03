# Review A2 — criteria frozen BEFORE the code was read (2026-11-03T06:21Z)

**Rows:** N4 (board T4), loop T1 `loop-20261103T061032-70b5ca` (N1, live `tui-admission` re-spec) and
loop T2 `loop-20261103T061032-d4571e` (N2, lane-A test Nits). Writer: `se-cellwork`.
**Contract:** `.mpd/plans/vedit-p0-followup.md` §F1/§F2 (FROZEN 2026-11-03). **Gate authority:** `AGENTS.md`
§4 (frozen `mpd_verify_*` table), §7 (QA discipline: assert a real artifact, never prose).

This file states what I will judge, and how a wrong answer would be caught, before I look at any of the
writer's new code. It is derived from the contract, the T14 report, and the review-a report's Nits.

## T1 (N1) — the live `tui-admission` lane re-specified for a permission-less manifest

The shipped manifest is `permissions: []` **by measured decision** (`dsh-plugin.json`'s own
`x-mpd-tui.decisionEvents` note: with the four intercept permissions → `waiting_authorization /
PERMISSION_NOT_GRANTED`; with the minimal declaration → the same run answers `compatible` and the
identity path is open). Therefore, on the live lane:

| # | criterion | what would falsify it |
|---|---|---|
| T1-a | `arm5` (no-grant negative control) no longer requires `waiting_authorization`/`PERMISSION_NOT_GRANTED`, and instead asserts the shipped posture (the no-grant boot is `compatible`) | any surviving `negativeVerdict.state === "waiting_authorization"` gate, or a `waiting_authorization` requirement folded into `ok` |
| T1-b | `arm3` no longer requires an `applied` `decision-handler` bind (impossible without the permission), and asserts the attribution posture reachable in a permission-less world | `handlerBinds.length > 0` still in the `ok` predicate; or arm3 removed instead of re-specified |
| T1-c | `arm4` no longer claims our handler was live on a real `tui/input` decision; it asserts what the permission-less run can actually prove | the old "handler live on a tui/input decision" claim kept in prose only, or arm4 deleted (weakening) |
| T1-d | the SHIPPED manifest's own decision `compatible` is asserted **separately** (not folded into the clone arms) | only the clone's `granted` arm proving `compatible`; the shipped `manifestDecision` unasserted |
| T1-e | no assertion weakened: every deleted/changed assertion is named with its replacement; the static-F1 controls (m1–m5 mutation arms) still hold; the `ok` predicate is not loosened by dropping a condition | a removed `check(`/`ok` term with no named replacement; a control arm deleted |
| T1-f | `--static-only` exit 0 and `--self-test` exit 0 on the settled tree | either exits non-zero |
| T1-g | the live run's PREREQ/bound is honest: the header names the codes `tuiPrereqs` actually gates (`absent-dsh-binary` for `dsh-tui`, `absent-runtime` for `tmux`, `absent-fixture`), and the report states that a prerequisite SKIP (exit 0) is NOT a live pass and what was actually measured | the header keeping the mislabeled `absent-runtime dsh-tui` line; a report claiming a live pass off a SKIP; no statement of the live bound |
| T1-h | scope: only `skills/dsh-qa/scripts/tui-admission.ts` (+ this wave's `skills/dsh-qa/scripts/dual-track-smoke.ts`, owned by T14) under `skills/`; `VENDOR_LOCK.json` untouched (captain re-pins); no git write | any other `skills/**` file, a touched `VENDOR_LOCK.json`, a commit |

## T2 (N2) — the four lane-A Nits (review-a report §4 N1–N4) + N5 bookkeeping

| # | criterion | what would falsify it |
|---|---|---|
| T2-a | N1: one arm where the registry HOLDS the member and answers a **different** engine, asserting the handle's engine is the one driven | the new arm passing under a `registry-first` implementation (e.g. both engines the same object, or only the reachable one asserted) |
| T2-b | N2: the no-pre-attempt-sleep claim is asserted as an **ORDER** (sequence/injected clock), not a duration bound | a `< 500 ms` style bound kept as the discriminator; an order arm that a 200 ms pre-sleep would still pass |
| T2-c | N3: a black-box arm proves the registered `cellwork_split` DESCRIPTION states the warnings rule (the shape `mail-bound-config.test.ts` uses for `cellwork_send`) | an arm reading source text, or asserting a description captured from a tool the flow plugin never registered |
| T2-d | N4: `harness.interrupts.length === 0` asserted on the promoted path | the promoted arm still asserting only `reseeds.length === 0` |
| T2-e | N5: the historical `lane-a/red-first/d1-barrier-red.log` is NOT rewritten (tracked bytes unchanged) and the follow-up report NOTES the duplicated-hash Nit | a modified red-first log; a report silent on N5 |
| T2-f | no test weakened: every moved/replaced assertion is NAMED in the lane report with OLD → NAMED REPLACEMENT (the R2 convention); additions only elsewhere; the suite still green | an unnamed edit in the diff; a deleted assertion; a red suite |
| T2-g | scope: only `packages/mpd-cellwork-plugin/{test,src}/**` (F2 says no production change unless a defect is found) + its evidence subtree; if `src/**` moved, a stated reason and `verify-dist-fresh` evidence | an unstated `src` change, or a stale `dist/**` |
| T2-h | the wave gates on the settled tree: `bun test packages`, `bun run typecheck`, `verify:comments` all exit 0 | any of them red for a reason owned by these changes |

## Bounds declared in advance

- The live lane needs a warm sandbox `dsh-tui` profile + a real TTY. This checkout's default root
  (`.mpd/recon/qa/tui-lanes/tui-admission`) now carries an installed profile (`package.json` with both
  bundles, `node_modules/@deepseek-harness-tui`), so a live attempt is POSSIBLE; if it cannot complete in
  the review window I will say so rather than score it.
- I will not read `packages/*/src/**` before the verdict is recorded; tests, the QA script, the docs and
  black-box runs are my inputs.
- I do not re-create the red state (a revert is a git write, the captain's alone).
