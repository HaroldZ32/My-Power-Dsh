# t23 — INDEPENDENT REVIEW of wave-2b lane C (t17): T-79's decisive host-restart test + the instrument legs

**Seat:** `code-reviewer` (reviewer; read-only on the lane's files) · **task** `t23` · **attempt** `7bac8e0f-2b73-4ae1-9965-1d7fd68473df`
**Object of review:** `evidence/requirements/wave2b-laneC/20260917T1416Z-wave2b-laneC-acceptance.md` (248 lines, read in full)
vs `evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/` (`t17-record.md` 217 lines, `t17-result.json`, the four drivers, raw captures).
**VERDICT: needs_revision — ONE low finding (a non-reproducing count in the record's own pin table). The decisive test itself PASSES on substance: I re-ran it and reproduced the four-leg matrix exactly.**

## 1. PIN (settled; every cited sha verified)

| what | lane's claim | my reading | match |
|---|---|---|---|
| `lib/scheduler.js` | `4b824797195996fa…` | identical | ✅ (also the sha inside my own re-run) |
| `skills/dsh-qa/scripts/lib/session-evidence.mjs` | `73d06d44dcb781df…` | identical | ✅ |
| `scripts/mpd-bg.mjs` | `0b294972b05f5e4e…` | identical | ✅ |
| `scripts/mpd-doctor.mjs` | `21b1db27251d8d44…` | identical | ✅ |
| `skills/dsh-qa/scripts/team-watchdog-config.mjs` | `f9f03ca7e048e207…` | identical | ✅ |
| `agent-references/agent-teams-deltas.md` | `a2120d45fca43ef1…` | identical | ✅ |
| T-79 replay count | 8 MEASURED EVENTS | not re-derived (register row owns it; the record itself says the count moves) | bound |

## 2. THE DECISIVE TEST — RE-RUN BY ME, FOUR LEGS REPRODUCED (criterion 1)

`node ./evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/t79-decisive-driver.mjs --out <my dir>/repro-t79` → **exit 0**; my own `t79-decisive-result.json` (`log-t79-repro.txt`):

| leg | tickets | deliveries | to member | named decline | my reading == lane's |
|---|---|---|---|---|---|
| (0) control, `pending` | 1 | **1** | 1 | 0 | ✅ |
| (1) pure terminal | 0 | **0** | 0 | 0 | ✅ |
| (2) recorded race, forced terminal in-window | 1 | **0** | 0 | **1** | ✅ |
| (3) **red side**, `terminal-dispatch-recheck` region STRIPPED | 1 | **1** | 1 | 0 | ✅ |

- The `outcome` string in my run is **byte-identical** to the lane's, and the discriminator reproduces: `equalityHalfHolds: false`, the compose MINTED FRESH attempt ids in both race legs (mine `298fe18c…` / `ccc5dc81…` vs the lane's `48c3f297…` / `251420e9…` — **the fresh values are the point**, and the stored `7c133ef3-…` never appears on the ticket), `forcedTerminalReadings` both `task-t14-now-completed`.
- **The fixture is COMPETENT, not wrong-reason.** The control DELIVERS (1) and the guard-removed leg DELIVERS (1), so the harness can wake a member and the zeros are readings; the ticket-composing path is `scheduler.kickMember` (the real composer), and the driver asserts its hook anchor is unique before injecting (`source.split(anchor).length - 1 !== 1` → throw). The two wrong-reason fixtures the acceptance names (a bare status read, an idle-edge-only probe) were **not** used.
- The driver's own mechanics are honest: per-leg `mkdtempSync` workspace destroyed in `finally`, a cache-busted fresh `import()` per leg, the region physically removed for the red side, and `teamBytesUnchanged` asserted.

## 3. THE HOST-RESTART PRECONDITION IS REAL (criterion 1)

Measured by me, not read: the lane's `restart` block records `cwd`/`dshHome`/`home` under `<evidence>/sandbox/{ws,dsh,home}` (the three directories exist on disk), `pid 28`, and `moment 2026-09-17T14:28:28.301Z`; the raw job log carries `T79-HOLDING pid=28 for 9000ms` and `T79-DRIVER-EXIT=0`; `raw/t79-restart.pid` holds `27`. My own re-run is itself a new `node` process importing the tree fresh, which is the same operative sense of "restart" the record states (T-21: the loaded revision is a process property) — and it produced the same matrix.

**Observation O1 (not a finding):** the liveness reading's subject is the managed job's TOP process (`sh -c`, pid 27 = the pidfile) while the `restart` block records the DRIVER process (pid 28). Both readings are faithful; the record just does not say they are two subjects. I settled the mechanism myself: `node ./scripts/mpd-bg.mjs run --pid <f> -- node -e …` reports `started pid=54`, the pidfile holds `54` and the child printed `CHILD_SELF_PID=54` — so the pidfile is the spawned process, and `-- sh -c "… node …"` interposes the shell. One clause naming each subject would close it.

## 4. THE WORDING — JUDGED AGAINST THE READINGS (the failure mode this review hunts)

- The record's outcome is the **B-side**, and it does NOT over-claim: "NOT WOKEN on the kick route … the mechanism claim stays REFUTED-for-a-fresh-process … the residual stays **UNRESOLVED** with the named probe cited on `scheduler.js`", plus "what this does and does not move" (the kick route moves UNTESTED → REFUSED-with-a-named-decline; every other wake route stays unmeasured).
- It resolves the acceptance's internal collision (its OUTCOME-B bullet says "the residual closes as stale host" while its FORBIDDEN-WORDING block forbids that wording and names §A-28 + row T-79 as authority) by **following the named authority** — and says so explicitly (`outcomeReadingBothWays.wordingAuthority`). That is the correct reading of the acceptance's own text, and I checked §A-28's wording at its own site: the stale-host reading is **withdrawn**, the residual is UNRESOLVED with the probe, and the probe's bound (module mtime vs newest session dir mtime ⇒ cannot see a long-lived PROCESS) is restated in the record §D and in the result JSON.
- **Token census, run by me over the lane's evidence dir:** `inert in-process` → **0**; `consistent with a stale host` → **0**; the bare token → **2**, exactly **1 + 1** in the two verbatim third-party doctor captures (`raw/t41-baseline.txt`, `raw/t41-pinned.txt`) — matching the lane's §C.1 disclosure precisely. The lane's own prose introduces neither framing (it spells the one token split). **Passed with one named exception, exactly as reported.**
- **Bound respected:** the record never offers a `FRESH` reading as load evidence (no `reload-check` reading is cited anywhere as proof the host loaded the revision).

## 5. EVERY ARM OBSERVED RED BY ME (criterion 3)

| arm | where | my reading |
|---|---|---|
| guard-removed red side | leg (3) of the decisive driver | **DELIVERS 1** where the shipped tree refuses → the guard, not the fixture, is what refuses |
| `--mutant restart-needed` | Addendum A | `mutant restart-needed: DETECTED (the assertion reddened)`, `liveWithoutRestart: false — liveness LOST`, `KNOBS DIVERGE (§7.3) … warnSilenceMs: live=90000 file=900000` |
| T-25 regressed reader | the leg's own driver | `regressionToSingleFrameWouldRedden: true` (first-frame-only returns the naive reading `records=1 / events=0`) |
| T-41 silenced line | re-run on **my own** captures | `negative_control_reddened: true` with four named failing checks |
| T-79 immutability | same `--out` twice | **REFUSED … already exists (immutable evidence)**, exit **3** |

No green in this lane's evidence comes from a command that cannot fail: the `--live` green is paired with its mutant, and the decisive test's zeros are paired with two DELIVERING arms.

## 6. THE INSTRUMENT LEGS (criteria 1 and 3, both reproduced)

- **T-25** (`exit 0`): same store, same moment, byte- and mtime-stable (`sha256Before == sha256After` = `d82ef35d…`): NAIVE one `zstdDecompressSync` → **1 record / 0 events**; regressed reader → identical; shipped frame-by-frame → **26 records / 25 events, 10 frames**; high-level → 26 records / 10 frames. Corpus census 10 found / 10 multi-frame / 10 naive-zero. The row's own wording ("0 events from a naive reader is NOT proof of an empty log") is carried, and the manual's "10 frames, 1 vs 25" reconciles as 1 header RECORD vs 25 EVENT records — stated by the lane as a reconciliation, not as proof it is the same store.
- **T-41** (`exit 0` baseline / `exit 2` absent): the absent binary is NAMED per entry — `ast-grep [OPTIONAL]: MISSING ⇒ degrades: the ast_grep MCP exposes no tools … reason: MPD_AST_GREP_SG_PATH=/nonexistent/ast-grep-absent is set and does not exist` — with `verdict=DEGRADED exit=2 missingOPTIONAL=ast-grep` and the other entries still `ok`. The record's shape note (UPPERCASE `MISSING` vs lowercase `ok`, so a lowercase-only grep misses it) is correct.
- **Addendum A** (both directions, `skills/**` RUN and never edited — correct for the single-corpus-writer rule): `--live` → `mounted=90000 file=900000 sameInstance=900000 fileApplied=true restartRequired=false` / `liveWithoutRestart: true` / PASS; `--mutant restart-needed` → DETECTED (above). The green is not offered alone.

## 7. CLAUSE 4 AND THE WRITE SET

- The lane's verify list is lane-scoped and carries no repo-wide aggregate and nothing that re-derives another lane's value: `bun test ./packages/mpd-team-watchdog-plugin` (my run: **139 pass / 0 fail / 13 files**), its own drivers, `mpd-bg --self-test` (exit 0), `mpd-doctor --self-test` (exit 0). The six forbidden aggregates are absent, named in the record as not-run.
- `packages/*/dist/**` untouched: my own `find packages/*/dist dist/mpd-package -newermt 2026-09-17T14:15Z -type f` → **empty**; the lane reports only a reading about it. Its 27 `changedPaths` are all under its own evidence dir.

## 8. FINDING (structured; it FAILS this review)

**F1 [low] — a count presented as re-measured does not reproduce.** `t17-record.md`'s revision-pin table reports
`agent-references/agent-teams-deltas.md` `a2120d45fca43ef1…`; **89** live unique `mpd-delta <id>` region ids
"(re-counted at this moment)". At those exact bytes the live count is **88** by three independent predicates —
registry entries `88`, `node scripts/patch-agent-teams-fixes.mjs --check` → `88 mpd delta region(s) across 9
adopted file(s)`, and the deltas doc's OWN derived sentence `carried 88/9 vs derived 88/9`. **No live predicate yields 89.** The only command that does is a LINE count of
`lib/mpd-deltas.js` (`grep -c '//#region mpd-delta'` → **89**), which counts the file's own HEADER COMMENT
(line 4, "Generated from the `//#region mpd-delta ...` markers …") as a region. Both files' mtimes (14:22:50Z,
14:26:28Z) precede the lane's write moment (~14:33Z), so the tree was identical when the count was taken: the
number was already wrong at its own moment, not merely stale. *requiredFix:* change to **88** or name the
predicate and note the header line — a one-line edit. This is the acceptance's own §6 count rule ("every count C
quotes … re-take at the write … never inherited") applied to a record whose whole value is that its readings
reproduce. Nothing in the decisive verdict, the token census, the arms or the outcome wording depends on it.

## 9. WHAT I DID NOT VERIFY (explicit bounds)

- **The host PROCESS.** Nothing here observes what a long-lived `dsh` host has loaded: the `reload-check` probe cannot see it (its own bound, restated), and the decisive test's "restart" is a NEW PROCESS importing the tree fresh. My re-run inherits that bound. The pid-namespaced sandbox also cannot see the host's start time (the acceptance forbids claiming it; the record does not).
- **A full booted-dsh team lifecycle** (idle edge, approval/spawn-time dispatch, `memberSelections`, a stale on-disk snapshot read outside the lock) — exactly the routes the lane leaves unmeasured, so the residual stays UNRESOLVED, which I confirm rather than close.
- The register's replay count (8 MEASURED EVENTS) was not re-derived; the record itself warns the count moves.
- I ran no integration aggregate, wrote nothing outside `evidence/review/wave2b-laneC/**`, and ran the lane's drivers with `--out` under my own directory (the lane's archived outputs were never touched — the immutability arm proves a second write is refused).
- Scratch artifacts: the decisive driver's temp workspaces live under `/tmp` and are removed by its own `finally`; my pid-experiment files were written under my evidence dir (`mpd-bg-pidprobe.log`).
