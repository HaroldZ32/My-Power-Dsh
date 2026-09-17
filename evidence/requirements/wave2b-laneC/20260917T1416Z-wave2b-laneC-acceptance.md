# Wave-2b LANE C — executable acceptance (r-C, frozen BEFORE any implementation)

**Seat:** Architect (requirements, read-only), through the platform artifact channel — the only write a denied seat has.

**Authority:** `.mpd/plans/friction-p2-wave-2b.md` — §4 (lane C row + A2.3's narrowing), §5 (lane C table), §6 (DAG's impl-C), §7
(serialization), §8 (lane-scoped gates), §9 (evidence convention); `.mpd/plans/friction-p2-wave.md` **§A12 + its addendum** (T-79's
decisive test, quoted below in substance); register `.mpd/TODO.md` **row T-79** (its measured refinements) and the wording authority
**captain log §A-28**. Lane inputs used as INPUT: lane A's note
`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §4f (the `evidence/**`-only channel for a denied seat) and §4g
(the derived-value rule).

**Moment of this freeze:** the `t11` record's own timestamps — `createdAt` 1789653804562 = 2026-09-17T14:03:24Z, `updatedAt`
1789654582065 = **2026-09-17T14:16:22Z** (its claim; read from `.mpd/team/friction-p2-wave/team.json` read-only). The file was written
after that instant; the stamp names the CLAIM, because this seat has no shell and will not invent a clock.

**What is frozen — THREE entries:** **T-79's decisive host-restart test** (the load-bearing carry-forward, plan §A12), **T-25's
instrument leg** (the reader is corpus/D's; C's leg is the failure pin) and **T-41's probe leg** (the instrument is lane B's; C runs it
against a tree with a deliberately absent binary).

---

## 1. WRITE SET — A2.3's narrowing, which is the strictest in the wave

**`evidence/team-watchdog/**` ONLY.** Lane C writes **no tracked script** and **no corpus file**: `skills/**` is lane D's (the wave's
ONE corpus writer), so every corpus-side need is SPECED to D and rides D's single re-pin. The instruments C runs are READ:
`scripts/mpd-bg.mjs` (the managed-job + probe + reload-check helper, lane B's file), `scripts/mpd-doctor.mjs` (T-41's instrument, lane
B's file) and `skills/dsh-qa/scripts/lib/session-evidence.mjs` (the frame-by-frame reader, lane D's file). C's own drivers live beside
their records: `evidence/team-watchdog/<slug>/<stamp>/<driver>.mjs`.

**Excluded (named, so nobody re-globs):** every `scripts/*.mjs` (B/B2/B3), every `skills/**` path (D), `AGENTS.md`/`docs/**`/
`templates/**` (B3), `packages/**` and `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**` (the captain's integration).

**HOP RULE for this lane (T-88's class):** C cannot write `dist/**` or the corpus; when a red belongs to another lane's file,
C reports it WITH the clearing command and the cause (route 3: the hop request — measured at one message and no work) and never drops
the path or rebuilds it undeclared.

---

## 2. VERIFY — lane-scoped, `./`-formed

- the decisive test's own record and its driver: `node ./evidence/team-watchdog/<slug>/<stamp>/<driver>.mjs` (explicit output root; a
  re-run at the same target is REFUSED where the immutable-output helper is imported)
- `node scripts/mpd-bg.mjs --self-test` (the plan's own lane-C gate for the probe/liveness helper)
- `node scripts/mpd-doctor.mjs --self-test` (T-41's instrument must be a real instrument before C runs it live)
- the T-25 leg's driver (evidence-side) with both readings from the same store at the same moment

**FORBIDDEN here, by name:** `bun run test:qa` · `bun run test:qa:all` (A2.1: the corpus lock is dirty from D's first edit until the
captain's single re-pin, so these cannot be green in-window) · `bun run verify:gates` · `node scripts/verify-vendor.mjs` ·
`node scripts/verify-dist-fresh.mjs` (a stale `dist` owned by another lane is a REPORTED cross-lane reading, never C's write) ·
`bun run typecheck`. A red this lane cannot keep green belongs in EVIDENCE, never in a verify list (A2.1; T-84's extended §Fix).

---

## 3. T-79's DECISIVE HOST-RESTART TEST — plan §A12, restated verbatim in substance

**THE TEST:** **restart the host, then re-run ONE terminal-task replay.**

**FIXTURE CONSTRAINT (a real trap):** reuse ONE of the recorded live shapes — **terminal task + idle member + a path that COMPOSES A
TICKET (a kick)** — because a bare status read or an idle-edge-only probe **would go green for the wrong reason**. A ready-made fixture
exists: the seventh measured event, the `t14` review re-dispatched AFTER its completion, terminal, with the attempt id the delivery
carried (`7c133ef3-5e5b-4d95-a3d7-86d0d5661efb`).

**OUTCOME A — the member IS woken for a terminal task:** staleness is **REFUTED as the explanation** and the wake is a LIVE
delivery-boundary hole; the hunt then moves **not** to the re-check (lane C's in-process instrument shows the boundary itself refuses —
0 deliveries plus the named decline, with the stripped-region control delivering) but to the OTHER wake routes: approval/spawn-time
dispatch, the idle edge, `memberSelections`, or a stale on-disk snapshot read by a path that does not re-read under the lock.

**OUTCOME B — not woken:** consistent with the stale-host explanation; the residual closes as "stale host" and the mechanism claim
stays **REFUTED-for-a-fresh-process** exactly as filed.

**BOTH READING SETS ARE REQUIRED WHICHEVER WAY IT LANDS:** the record states the outcome AND what it does and does not move. A record
that reports only the observed branch is incomplete.

**FORBIDDEN WORDING (authority: captain log §A-28 + register row T-79):** `inert` appears nowhere; `consistent with a stale host` is
**not** the residual's wording (the row records the stale-host reading as **WITHDRAWN'); the residual word is **UNRESOLVED with the named
probe cited on `scheduler.js`**; the replays stay labelled **MEASURED EVENTS**; **REFUTED attaches to the MECHANISM claim only**; and 2b
re-quotes A-28's wording, **never the row's old title**. The plan's own historical sentences that still carry the withdrawn framing are
NOT rewritten (sealed-record doctrine) — so a phrase-based grep for `in-process` under-reports the set, because one site says "in a
long-lived PROCESS".

**THE PROBE'S OWN BOUND (must be stated in the record, because the row's evidence chain depends on it):**
`node scripts/mpd-bg.mjs reload-check <module-path>` compares a MODULE's mtime against the **NEWEST SESSION's directory mtime**, so exit
0 `FRESH` means "the module predates the newest session" and **never** "the running host loaded this revision" — it cannot see a
long-lived host PROCESS (T-21: no plugin hot reload). A `FRESH` reading may not be cited as evidence that the fix is loaded.

**THE MECHANICAL DISCRIMINATOR (available now, and cheap):** `delivery.attempt_id == completion.attempt_id` AND the task is terminal —
that is what makes a seat able to answer with a state packet plus a staleness check instead of re-claiming, and it is the predicate a
future fix can refuse the delivery on. The decisive test's record carries this reading in addition to the restart outcome.

**HOST-RESTART MECHANICS AND SANDBOXING:** the restart is a MANAGED background job — `node scripts/mpd-bg.mjs run --log <workspace path> -- <cmd>` (never `nohup`), with an isolated `DSH_HOME`, a sandboxed `HOME`, and an explicit sandbox workspace cwd (AGENTS.md §7);
the record carries the restart's own moment and the kernel-only liveness reading (`node scripts/mpd-bg.mjs probe <pidfile>`).

**WHAT THE TEST MAY NOT DO:** it may not re-claim or re-run the terminal task it replays (terminal work stays terminal; the staleness
check is what makes that safe), and it may not claim the host's start time — that is NOT observable from the pid-namespaced sandbox, a
bound the row already records.

---

## 4. T-25's INSTRUMENT LEG (the reader is corpus/D's; C carries the FAILURE PIN)

- **DELIVERABLE:** the naive-reader FAILURE pinned as evidence, plus the frame-by-frame reader demonstrated on the SAME store; any
  corpus-side documentation or arm is SPECED to lane D.
- **OBSERVABLE:** a naive read (ONE `zstdDecompressSync` over the container) returns **0 events**, while the frame-by-frame reader
  returns **N > 0** on the same store — **the failure, not the conclusion, is the evidence**.
- **DECISIVE:** both readings taken from the same store at the same moment, with the store path and the reader's module path named.
- **NEG CONTROL:** the arm must REDDEN if the reader regresses to a single-frame read; and the record must state that "0 events" from a
  naive reader is NOT proof of an empty log (the row's own wording).
- **EVIDENCE:** `evidence/team-watchdog/<slug>/<stamp>/`.

---

## 5. T-41's PROBE LEG (the instrument is lane B's; the live absent-binary run is C's)

- **DELIVERABLE:** the doctor's output on a tree with a deliberately ABSENT optional binary, plus its degrade sentences.
- **OBSERVABLE:** the absent binary is NAMED with what degrades, while the other entries stay `ok`.
- **DECISIVE:** a per-entry reading of the output (the name is present), not an exit code alone.
- **NEG CONTROL:** the arm that must REDDEN on revert — if the doctor falls silent about an absent binary, C's assertion fails; the
  record must NOT report a green from a command that cannot fail (the contract's own rule).
- **EVIDENCE:** the run's output beside the record.

---

## 6. DERIVED VALUES AND THIS LANE'S VERIFY (plan §4g applied to the lane's own list)

| command | why it cannot be green in-lane | the lane-scoped substitute |
|---|---|---|
| `bun run test:qa` / `test:qa:all` | the corpus lock is dirty from D's first edit until the captain's re-pin | C's own instrument legs, run directly |
| `node scripts/verify-vendor.mjs` | same window | the reading belongs to the integration step |
| `node scripts/verify-dist-fresh.mjs` | a stale `dist` belongs to another lane; C cannot write it (measured refusal) | report the red WITH its cause and clearing command (route 3) |
| `bun run verify:gates` | repo-wide aggregate (plan §7.4) | integration-only |
| every count C quotes (the replay count; a region count) | it MOVES with other lanes' writes | re-take at the write; cite by row id + region ids + registry sha (B3 clause (b)) — never inherited. The replay count is **EIGHT MEASURED EVENTS** (six replays + `t14` + `t33`) at this revision, and it moves |

---

## 7. FINDINGS

**F1 — the probe's semantic bound is part of the acceptance, not a footnote:** `reload-check` cannot see a long-lived host process, so
no `FRESH` reading may be offered as load evidence. The decisive test exists precisely because the probe cannot answer that question.

**F2 — `dist/**` is not this lane's to write:** the measured refusal (`1 changed path(s) not covered by inScope: …`) is why route 3
(request the hop with the exact amendment text) is the working route; the record must carry the clearing command, never a silent drop.

**F3 — the discriminator is available NOW:** `delivery.attempt_id == completion.attempt_id` plus terminality is machine-checkable at
this revision, so the decisive test's record can carry it alongside the restart outcome — which makes the next fix (refuse the delivery
on that predicate) reachable without re-deriving the mechanism.

**F4 — the wording authority chain, stated once:** §A-28 + row T-79 govern the words; the register's own historical framings stay as
written (sealed-record doctrine); and this lane's records must not introduce a fourth framing.

---

## 8. VERDICT OF THIS FREEZE

Lane C can start: three entries with named deliverables, the strictest write set in the wave (evidence only) with its read-only inputs
named, a lane-scoped verify list whose non-green commands are routed with their substitutes, §A12's decisive test restated with BOTH
outcome readings and the fixture constraint EXPLICITLY forbidding the two wrong-reason fixtures, the probe's semantic bound stated, and
a red side named for each leg — including the one that would otherwise ship a green from a command that cannot fail.


---

## ADDENDUM A (appended after the freeze; a nested addition, never a rewrite) — the `--live` assertion's SECOND leg

This task's acceptance names an instrument leg beyond T-25's and T-41's, so it is frozen here explicitly rather than left to be
discovered mid-task.

**THE INSTRUMENT (corpus, lane D's file):** `skills/dsh-qa/scripts/team-watchdog-config.mjs` carries the T-18 regression pin in
command shape — modes `--live` and `--mutant restart-needed` — landed by lane D from lane C's `t10` handoff, and it ships its own
offline verdict arms "exercised in both directions" (`T-18 --live` verdict arms), i.e. the pin's logic is asserted both when liveness
holds and when it is lost.

**LANE C'S LEG:** run BOTH directions on a real tree at the same moment:
- `node ./skills/dsh-qa/scripts/team-watchdog-config.mjs --live --out ./evidence/team-watchdog/<slug>/<stamp>/live` — liveness present;
  the pin's assertion holds, and the reading names the mounted value, the file value passed to the SAME instance, and the
  restart-required flag.
- `node ./skills/dsh-qa/scripts/team-watchdog-config.mjs --mutant restart-needed --out ./evidence/team-watchdog/<slug>/<stamp>/mutant`
  — liveness LOST: **this is the arm that must REDDEN**, with the named reason.

**WHAT IS NOT ACCEPTED:** the `--live` green on its own. A green from a command that cannot fail is exactly what the contract
forbids, so the mutant run is part of the deliverable, not an optional extra.

**WHY THE LANE RUNS IT RATHER THAN EDITS IT:** `skills/**` is lane D's — the wave's ONE corpus writer — so any change to the pin, to its
arms, or to the shared `--out` handling (`skills/dsh-qa/scripts/lib/watchdog-lane.mjs` `evidenceDir(argv, slug)`, a measured clause-1
member of the T-83 set) is SPECED to D in the same channel as T-25's reader half. C's record carries the SPEC plus the readings.

**EVIDENCE:** both run records beside the decisive test's record, in `evidence/team-watchdog/<slug>/<stamp>/`.


---

## ADDENDUM B (appended after completion; nested, never a rewrite) — the lane's OWN prior instruments, the KICK handoff, and the two-verdict reporting shape

Appended because this task's authoritative inputs list four things the frozen body above cites only in general terms. Every pointer below was READ
before it was named; nothing here supersedes the body.

**1. REUSE, DO NOT RE-DERIVE — the lane's own 2a instrument directory:** `evidence/team-watchdog/lane-c-2a/20260917T074144Z/`
contains `lane-c-live.mjs` (the lane's live driver), `output.log`, `kick-arm-handoff.md`, `closure-after-repack.log` and `result.json`. The decisive
test's record should reuse that fixture shape and cite the arm set there, rather than building a second one.

**2. THE KICK-ARM HANDOFF — and one trap it measures.** `kick-arm-handoff.md` freezes (for lane D) the `kick` row of
`skills/dsh-qa/scripts/watchdog-redesign.mjs`: FOUR readings in one process on one fixture (while held → 0 prompts AND the NAMED decline
`the team is held by the team watchdog (hold <holdId> since <ISO> : <cause>)`; while held, `agent_teams_claim_task`/`agent_teams_update_task`
SUCCEED and `team.json` moves while the hold record is byte-unchanged; after `session-watchdog-resume` the SAME kick delivers exactly 1 prompt;
and the refused kick writes nothing), plus TWO red legs — a scratch copy of `lib/` with the hold read neutered delivers 1 while held, and the
wave-1 re-injection literal makes the update THROW. **The trap, measured in that file:** the `.mpd/red-baseline` baseline CANNOT serve as this
control — it already carries `watchdogHoldOf` and the three decline sites (4 hits). **The expected row verdict is frozen there too:** RED = the two
controls, GREEN = the four readings, and the row exits 0 ONLY when both directions are observed — the same both-directions rule this acceptance
gives the `--live` leg. The executable reference is `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts` (describe
`"T-48 — the KICK reading (frozen D-2)"`, three tests); the driver row re-uses its fixture shape.

**3. THE REGISTER SENTENCE THAT MUST NOT BE CARRIED — a citation trap worth naming here.** That handoff records that the register's §8.4
sentence ("never decline … claim_task/update_task/kick") is NOT the frozen reading: the frozen reading is *a hold stops NEW DELIVERY while
claim/update succeed and a kick IS answered with a named decline*. An acceptance that quotes the register sentence as the requirement would
contradict the reviewed text — the same class this wave keeps paying for (cite a thing by its own declaration, not by a remembered title).

**4. THE TWO-VERDICT REPORTING SHAPE (from `evidence/review/t37-seeded-lane/20260917T092122Z/`):** that record's `my-three-legs.txt` shows the form a
coverage boundary takes when it must carry BOTH verdicts — per-state matcher maps (seeded / shipped / unseeded), an explicit
`lane requirements` dictionary of `MUST_BE` values per matcher, and a `lane would pass on` summary that names each fixture state separately. The
decisive test's record should report its two outcomes in that shape: the observed branch, the unobserved branch marked as unobserved, and the
per-reading matcher expectations — never a single collapsed verdict.

**5. THE WORDING AUTHORITIES, by their own sections rather than by count:** captain log **§A-28** ("T-79's register row was corrected a SECOND
time, and the arm-citation rule joined T-55") — its sharpening is quoted at §A-28's own site as *"UNRESOLVED, with a NAMED PROBE whose verdict
does NOT support the stale-host reading"* — and **§A-50** ("the 2b rollover input, enumerated mechanically for the next wave"). Both were verified to
EXIST at the paths this file cites; neither is quoted here beyond what was read.

**6. ONE PRECISION ON THE FIXTURE COUNT:** the rule says "reuse ONE of the six recorded live shapes" while the register now carries EIGHT MEASURED
EVENTS (six replays + the `t14` and `t33` dispatches). The six REPLAYS are the recorded shapes; the seventh/eighth are the FRESHEST and are the
ready-made fixture (terminal task + idle member + ticket-composing path + the attempt id the delivery carried). The count moves — cite the shape and
the event, not the number (the rule this note's own §4e generalised).


---

## ADDENDUM C (nested correction of ADDENDUM B's own citation locus)

ADDENDUM B, point 5, says §A-28's sharpening is "quoted at §A-28's own site". **It is not** — verified by reading the
captain log's section index: the sentence *"UNRESOLVED, with a NAMED PROBE whose verdict does NOT support the stale-host reading"*
appears verbatim in the same file at **§A-41**'s site (the section that records `t31` landing and the tree going quiet), while **§A-28**
is the section titled *"T-79's register row was corrected a SECOND time, and the arm-citation rule joined T-55"*.

**The correction matters for the reason this wave keeps paying for:** a citation that names the right FILE and the wrong SECTION still
fails to resolve for the next reader — the class T-55 (position) and T-90 (anchor) both cover, one level up from the line number.
**§A-28 remains the AUTHORITY for the wording; §A-41 is where the quoted sentence currently reads.**

**And one usable observation from the same read:** the captain log's section index is the fastest route to a ruling, and its TITLES carry the
ruling's subject — so a citation should quote the section TITLE (or the clause's own heading, per the plan's A4 rule) rather than relying on
the section NUMBER alone, which shifts as sections are appended.
