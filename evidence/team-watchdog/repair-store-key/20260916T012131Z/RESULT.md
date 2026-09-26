# t79 (r2) — team-scoped heartbeat READ, per-team rotation, and the ledger's two missing legs

- **Task**: t79 (r2), attempt 1, attempt_id `5668fc6f-3fa0-476d-b97d-765b6442e139`
- **Revision**: the tree at the run; see `raw/revision.log`
- **Evidence**: this directory. `no skills/** file was edited` (proved in `raw/skills-status.log`),
  and the adopted tree is untouched (`--check` exit 0 at 53 regions / 9 files).

## The defect, and the fix

`heartbeatPath()` builds `<watchdogRoot>/heartbeat/<memberKey>.jsonl` with **no team segment**, and
`memberKey` is the member NAME, so two teams in ONE workspace whose members share a name append to
ONE file. `candidateFor` filtered that file by task id (+attempt) but **not by team**, so team A's
stamp satisfied team B's candidate: a **wedged member looked alive** and the watchdog stayed
silent — the one failure mode this wave exists to prevent.

**The fix is read-side** (`src/machine.ts`): a candidate's stamps are filtered by the stamp's own
`teamId`, which the writer has recorded since day one — no store migration. A stamp that carries NO
team (`undefined`/`null`/`""`) cannot contradict and is kept, the same permissive convention t73
used for the attempt; the docstring states the rule and why that half exists. `scene.ts`'s per-task
`lastSeen` got the same scoping (its twin had the identical contamination).

## BOTH directions, on the SHIPPED artifact (`raw/before-fix.json` vs `result.json`)

The before observation is genuine, not a model: the **pre-rebuild dist** still carried the un-scoped
filter, and the fixture's wedged team reported the OTHER team's recent stamp and raised **nothing**:

```
BEFORE  dist sha 2e196de9… (115720 bytes)
  candidates: team-alpha lastSeen 1000000000000 · team-beta lastSeen 1000000000000   ← team-beta is WEDGED
  decisions : []                                                                     ← FALSE NEGATIVE

AFTER   dist sha 275e6afe… (116353 bytes)
  decisions : [{"type":"warn","teamId":"team-beta","taskId":"t1","silenceMs":900001}] ← the wedge is caught
            (team-alpha, whose own stamp is recent, stays silent — no false WARN)
```

Probe checks (7/7, `probe.mjs`): A1 one file holds both teams' stamps; B1 the removed predicate
reproduced as a labelled model; C1/C2 the real `candidateFor` judges each team on its own stamp;
C3 the shipped engine warns for the wedged team only; **D1 a member's OWN recent stamp in the same
team still suppresses the WARN** (the fix is not a mute); **D2 a stamp carrying NO team is still
counted** (the permissive convention).

## The store-layout question — ANSWERED, with a second mechanism found by asking it

**No, the heartbeat FILE key does not need to become team-scoped.** The read-side filter is the
complete fix for the contamination, because the stamp already carries `teamId`.

But asking the question exposed a **second mechanism in the same shared file**: `rotateHeartbeats`
was **global** — "keep the last N generations" of the FILE — so one team's turnover evicted the other
team's evidence: team-beta's ONLY stamp went **1 → 0** after team-alpha turned over four times, and
team-beta's candidate then has no stamps, so its wedge reports `never-started` instead of `silence` —
a **missed wedge**, the same false-negative class by a different route.

Fixed **without a layout change** (`src/store.ts`): rotation groups lines by the stamp's own
`teamId` and bounds each team to `keep` generations, preserving file order. Measured in both
directions by `raw/rotation.mjs` → `raw/rotation.json`: the removed rule is modelled on the same
13-line input (kept 9, team-beta 1 → **0** = evicted) while the REAL `rotateHeartbeats` keeps 10
(team-beta 1 → **1**, team-alpha still bounded to 3 generations). A unit test pins it
(`test/heartbeat.test.ts`, "rotation is PER TEAM…").

**Process disclosure:** my first post-fix re-run of the earlier rotation script overwrote the file
that held the PRE-fix capture, so that capture no longer exists on disk. Rather than keep a
mislabelled file I deleted it and replaced it with `raw/rotation.mjs`, which models the removed rule
EXPLICITLY (same input, same rule, labelled as a model) and calls the real function for the fixed
behaviour.

If a future consumer wants a team-scoped FILE anyway, it is a pure migration whose blast radius is
`heartbeatPath`'s callers (the engine's writers, `rotateHeartbeats`, `listHeartbeatKeys`, the
status tool's listing, the w8 fixture's documented injection path, and the README pair) plus the
orphaning of every existing `<member>.jsonl`. With both mechanisms closed and the team already on
every stamp, that cost buys nothing today — **not worth it now**.

## The ledger's two missing legs (in the w8 harness, `test/fixtures/inject.mjs`)

```
second-team-dispatch  (AC-7)  hold applied on one team; same window: 0 deliveries to the HELD team
                              1 delivery to the NEIGHBOUR; the held team's decline line present;
                              neighbour task -> claimed, neighbour not halted, one hold file on disk
disabled-control      (AC-10) knobs.enabled false; every tick reports skipped "disabled";
                              0 WARN / 0 scene / 0 incident / 0 hold; no scene dir, no hold dir,
                              no incidents file on disk; team record byte-identical
```

The whole harness is green: **12/12** cases (`harness.json`), including all ten pre-existing ones.

## Gates

```
$ bun test packages/mpd-team-watchdog-plugin   65 pass / 0 fail  (was 64: the rotation unit test)
$ bun test packages                            709 pass / 0 fail
$ bun run typecheck                            exit 0
$ node scripts/patch-agent-teams-fixes.mjs --check
        already applied: 53 mpd delta region(s) across 9 adopted file(s)   exit 0
$ bun skills/dsh-qa/scripts/team-watchdog-fault.mjs
        cases: second-team-dispatch, disabled-control, never-started-recorded, completed-turn-idle,
               mid-turn-stall, member-stops-stepping, captain-wedge, warn-90s, escalate-3x,
               pause-preserves, pause-preserves-halt-control, scene-restore
        PASS — 11 checks, 0 failed
$ bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --self-test   exit 0
```

**The lane needed NO edit**: it enumerates `fixture.CASES` dynamically and its `F1` check is a
subset test, so the two new legs flowed through it — hence no `skills/**` change, no corpus
`treeSha`/`fileCount` re-pin from this task.

## Dist rebuild (before/after recorded)

| | size | sha256 |
|---|---|---|
| before (pre-repair) | 115720 | `2e196de99a98973f21673e24c9194aff16fa39e55c6182d355d10caabc6d55fe` |
| after (final) | 116353 | `275e6afe7ade5c22405f3243439a68c1b4105039daf8032495c41bb137f9f7b5` |

## Changed paths

```
packages/mpd-team-watchdog-plugin/src/machine.ts        the team filter on a candidate's stamps
packages/mpd-team-watchdog-plugin/src/scene.ts          the same scoping for the scene's per-task lastSeen
packages/mpd-team-watchdog-plugin/src/store.ts          rotation is now PER TEAM
packages/mpd-team-watchdog-plugin/test/heartbeat.test.ts  the per-team rotation unit test
packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs  AC-7 + AC-10 legs, and a second live member agent
packages/mpd-team-watchdog-plugin/dist/index.js         rebuilt (figures above)
evidence/team-watchdog/repair-store-key/20260916T012131Z/
```

## Not claimed / honest limits

- **W-3 stands**: every case injects silence on an injected clock; no live model turn and no real
  provider wedge anywhere here.
- The cross-team scenario is reproduced **in-process** against the real store, machine and shipped
  dist; the production shape (two teams, same-named members, one workspace) is quoted from the code,
  not observed on a live host.
- `raw/before-fix.json` was captured from the pre-rebuild dist **in this same tree**, so it is a real
  before, not a model — but it is the artifact, not a second process.
- The heartbeat file's `members[].lastSeen` in a scene still reflects the newest stamp of that
  member NAME in the workspace (the file's own granularity); only the per-task `lastSeen` and the
  decision path are team-scoped. Recorded, not hidden.
- `store.ts`'s exported generic `newestForTask(stamps, taskId, attemptId)` remains team-agnostic: it
  is a pure utility used by a unit test, and the two DECISION/diagnostic paths that needed scoping
  were fixed. A future caller that knows the team must scope it itself.
