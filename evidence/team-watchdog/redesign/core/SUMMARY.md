# Lane A1 (t8) — evidence index

Task: `t8` — lane A1 of the frozen watchdog redesign: the four-state channel predicate (§1),
the §3 ladder and the §4 degradation, with a status surface that names the active predicate
source. Contract: `.mpd/plans/watchdog-redesign-contract.md` (frozen at HEAD 75018a1).

## Decisive artifacts

| Artifact | What it proves | Decisive line |
|---|---|---|
| `20260917T013000Z/result.json` + `output.log` | §9 rows (a), (b), (d) FAIL on the RED worktree and PASS on the new tree, per row, on SETTLED hashes | `DRIVER RESULT: PASS — every row fails RED and passes GREEN on settled hashes`; `red.machine matches the contract's frozen hash: true`; `red.engine matches the contract's frozen hash: true` |
| `20260917T012445Z/boot/result.json` + `raw/boot.log` | a REAL mounted boot (isolated `DSH_HOME` + sandbox `HOME`, real `dsh`, `agentPreset: mpd`): the row APPLIES, the fold's subscriptions install, no apply-crash signature, no pre-step veto | `[mpd-team-watchdog] applied: enabled=true warnSilenceMs=600000 tickIntervalMs=15000 warnStreakToEscalate=6 actionOnEscalate=warn-only … holdTtlMs=900000 predicate=channel enrichment=on` and `ok B1 … {"enabled":"true","disposers":8,"holdService":"mpdWatchdog"}` |

The boot lane is the pre-existing QA case `skills/dsh-qa/scripts/team-watchdog-boot.mjs`
(run read-only, with `--out` pointed INSIDE this task's evidence directory, so it wrote
nothing into another task's path). It boots a REAL `dsh` and reads the harness's own
session log; `outcome=model-error` means the turn reached the MODEL call and failed on the
missing API key (the credential item T-58 belongs to the QA lane) — which the lane counts as
PASSED FOR THIS INVARIANT, and is explicitly NOT a completed turn.

## The GREEN hashes this evidence is anchored to (settled: identical before/after a 50 s window)

| File | sha256 |
|---|---|
| `packages/mpd-team-watchdog-plugin/src/channel.ts` | `b9d7acaf6350eff96365d75f2272e55db0034c7ae7c4569c7d3be42d11bafd84` |
| `packages/mpd-team-watchdog-plugin/src/machine.ts` | `fbe2db0b790684f6f9ec47b66da00f60fe053fc89c91741f15a7c043b3843eca` |
| `packages/mpd-team-watchdog-plugin/src/engine.ts` | `51c95b95f7f16f51deaa6530664818b5ddf7d2d1300f0e2a72ccb01437782e6b` |
| `packages/mpd-team-watchdog-plugin/dist/index.js` | `a4893187ee13e97dd465b214e0ba12e172bca25e73a5152da5e7ef042a5c4d39` |

The RED side is the contract's pinned worktree (`.mpd/red-baseline`, detached HEAD 75018a1):
`src/machine.ts` `fc10fc41…`, `src/engine.ts` `f529ca2c…`, and NO `src/channel.ts` at all —
both re-measured by the driver itself and reported in its `result.json`.

## Bound on this evidence

* The boot lane's turn ended in a MODEL error (no API key in the sandbox), so the boot proves
  the mount, the subscription installation and the absence of apply-crash/veto signatures —
  NOT a completed assistant turn end to end.
* The rows are driven with each tree's OWN engine, store and adapter seam against an identical
  scenario and an identical injected clock; the scenarios are synthetic event streams, not a
  recorded live session. The permanent pins for the same rows (with the same scenarios) are
  `packages/mpd-team-watchdog-plugin/test/predicate.test.ts` (engine level) and
  `…/test/channel-fold.test.ts` (fold + ladder level).
* §9 row (b)'s GREEN reading is produced by the fold's `PARKED` (a member whose turn has
  closed). The dependency-derived suppression of §8 (T-20) — a member blocked on unfinished
  dependencies while a turn is still open — is the sibling A2 task's (t13) work, not this one.

---

## §0 captain amendment (2026-09-17) — A2 re-measurement and A4 counts

`t8` was already terminal when §0 A1–A7 arrived, so this section records the two items that asked
for measurement in this lane's evidence. Nothing in the implemented behaviour changed: the driver
was extended with the A2 block and re-run end to end (verdict re-anchored on settled hashes).

### A2 — the contract's three baseline hashes, re-measured from BOTH trees

`result.json` now carries `baselineHashes.{before,after}` with, per tree, the three files, the
per-file `matchesContract` boolean and the raw `sha256sum` lines. Reading (settled, 50 s window):

| File | ROOT tree (changes by design) | `.mpd/red-baseline` (75018a1) | contract |
|---|---|---|---|
| `packages/mpd-team-watchdog-plugin/src/machine.ts` | `fbe2db0b…` | `fc10fc41f404d79457660403f9645483fe123e588df6bfe5b8b55c4b8728c1ef` | **matches** |
| `packages/mpd-team-watchdog-plugin/src/engine.ts` | `51c95b95…` | `f529ca2cdef498eca8b60c441824aa5ab898689bc60c3c81ffc7da063f49281b` | **matches** |
| `packages/mpd-agent-teams-plugin/lib/tools.js` | `895523ee…` | `49025f4d9901fb2599f42bbb5233ead2a71837a65f51e1d6d95c567c002422d2` | **matches** |

**A2's premise is refuted by measurement:** the cited hex IS on disk and IS reproducible — from
`.mpd/red-baseline` (detached HEAD `75018a1c80081c2821162fcc8b873c29d79cce66`, worktree clean), all
three files, verbatim. It is the ROOT tree that cannot reproduce them, because the lane's own work
(`src/machine.ts`, `src/engine.ts`) and t9's D2 deletion (`lib/tools.js`) are supposed to move it.
The driver's `redPinned` therefore hashes the RED tree for all three files and asserts
`src/channel.ts` is `(absent)` there (pre-redesign tree).

### A4 — incident counts, measured by this lane (never quoted from the body)

Measured 2026-09-17T01:30:53Z over `.mpd/team/watchdog/incidents.jsonl` (append-only, mtime seconds
before the read — 2 rows landed during the A4 reads themselves, which is why a SNAPSHOT is the only
pinnable artifact):

| Scope | rows | never-started | warn | escalate |
|---|---|---|---|---|
| whole live log | 122 (94 `mpd-default` + 27 `friction-p1-wave` + 1 `mpd-default-8d65a2b2`) | 28 | 68 | 26 |
| `mpd-default` only | 94 | 18 | 56 | 20 |

Escalate rows: 26, of which `hold: "applied"` 18 and `hold: "not-requested"` 8 (the latter all
post-date the row-config change to `actionOnEscalate: warn-only`). The two `incidents.jsonl.bak-*`
snapshots are smaller, earlier states: `.bak-20260916T013347Z` 18 rows,
`.bak-20260916T034935Z` 42 rows / sha256 `c9b39c1d5f52ab425de83c761ee415c4a8d3be6d08e261271947c72799065598`
(30 never-started / 8 warn / 4 escalate, all `mpd-default`, all 4 escalates `hold: applied`). So the
95-row reading belongs to the LIVE log at the captain's measurement time, and the cited T-16 case
lines live in the live log: `:41` is a `never-started` with an EMPTY `attemptId`, and `:88-94` are
warn/warn/warn/escalate then warn/warn/escalate for task `t1` with an empty `attemptId` and silence
10 059 885 ms and 25 015 952 ms — silence measured against a PREVIOUS generation's stamp, i.e. the
T-16 defect exactly. A replay must pin the live log at a recorded row count (this table) rather than
the 85-row body text, which is not the current state.

---

## Revision boundary (annotation added 2026-09-17 after lane A2 / t13 landed)

The GREEN hashes this file pins are the **t8 revision** — `machine.ts fbe2db0b…`,
`engine.ts 51c95b95…`, `channel.ts b9d7acaf…`, `dist a4893187…`. They were measured, settled
(50 s window) and true for that revision, and the driver's verdict is anchored to them.

Lane A2 (`t13`) then extended the same files, so **disk has moved on**. Current revision
(measured 2026-09-17, this annotation):

| File | t8 revision (this file's table) | current revision (t13 → see `../holds/SUMMARY.md`) |
|---|---|---|
| `src/machine.ts` | `fbe2db0b…` | `ce8bd54cba5164dec1740b6a7d0e0d1a55eb3f8d675d0a4010675f30ff0b9a41` |
| `src/engine.ts` | `51c95b95…` | `47c24bd678ae45e0655c10373d1e64655b495c1ba8f136a66e44eda38c177694` |

The six §3 knob VALUES are unchanged by that move (`600000 / 15000 / 6 / warn-only / 900000 /
holdTtlMs 900000`), so a hash mismatch against this table on a later revision is expected —
**a verifier must pin the revision a reading belongs to, never the file as it stands today**.
The table above stays as measured; this note is the boundary, not a rewrite.
