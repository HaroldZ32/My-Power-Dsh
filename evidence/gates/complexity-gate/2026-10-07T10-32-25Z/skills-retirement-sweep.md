# The `skills/**` retirement sweep — one line per dropped case / arm, naming the SUBJECT that disappeared

Lane C (the wave's ONLY `skills/**` writer), wave `de-vendor-and-verify-law`, 2026-10-07 UTC.
Trigger: `packages/mpd-agent-teams-plugin/**` is DELETED (the vendored `dsh-agent-teams` body), so every
`safety/**` reference to it is a dead reference. The captain's GO: prefer DELETE over "declare vacuous"
whenever the subject is the retired body; no dead reference may survive, not even in an arm that passes
today; `cases.json` and `SKILL.md` must agree EXACTLY with the scripts left behind.

## Complete enumeration (measured: `grep -rln "mpd-agent-teams-plugin" skills/` → 8 files)

| File | Subject that disappeared | Disposition |
|---|---|---|
| `agent-teams-adopt.ts` | the RETAINED-but-UNMOUNTED adopted body's provenance/patch contract (`D5` retention) | **DELETED** (script + `cases.json` row + `SKILL.md` row) |
| `agent-teams-messaging.ts` | the adopted plugin's `lib/` message channel (the R1 shipped-path lane) | **DELETED** (script + row + table row) |
| `workmate-team-member.ts` | the adopted plugin's member-persona injection + its retired `agent_teams_*` tool table | **DELETED** (script + row + table row) |
| `workmate-library.ts` | ONE check read `lib/members.ts` (`memberPersona workmate injection`); the workmate LIBRARY itself still ships | ARM **DROPPED** with a named comment; the case's other 19 checks stay and the case PASSES |
| `team-watchdog-boot.ts` | the cordis waterfall control imported `_deps/cordis/lib/index.ts`; the RELOCATED implementation still ships at `packages/mpd-schemastery/harness/cordis/lib/index.ts` | **RETARGETED** to the relocation (real subject, control NOT disabled); comments + the C9 detail line updated |
| `team-watchdog-heartbeat.ts` | same vendored-cordis import (it passed today only because the path was contained) | **RETARGETED** to the relocation |
| `watchdog-redesign.ts` | the `reinject` control copied the adopted plugin's `lib/tools.ts`; that tree is gone, so the control could only ever fail | ARM **DROPPED** with a named declaration in `runReinjection`; row (c)'s GREEN criterion lost only the `reinject.rejected` conjunct, and the orphaned `vacuous-hold-row` mutant was deleted with it |
| `SKILL.md` | the three cases' table rows (and one stale cross-reference inside `workmate-library.ts`) | rows REMOVED; `cases.json` 44 → 41 lanes (3 entries removed). NOTE, corrected after the T14 finding: `--check-drift` was NOT green at this point — it exited 1 on 2 PRE-EXISTING unlisted lanes (`goal-bridge`, `tui-deps-ctrla`, both already unlisted in `HEAD`), which the third pass below registers |

## Capability check for the three cases that carried no path reference (captain's addition 1)

| Case | What it verifies | Does the capability still SHIP? | Kept? |
|---|---|---|---|
| `relocate-smoke.ts` | the staged bundle installs + boots with ZERO fixed checkout paths | YES — the relocation/pack path is untouched by the retirement (the packed bundle is what it tests) | KEPT unchanged |
| `web-client-adapt.ts` | the bundle's web client loads and its workmate routes answer | YES — `mpd-bundle-plugin` + the workmate host routes ship | KEPT unchanged |
| `watchdog-redesign.ts` | the watchdog's §9 contract rows (RED→GREEN) | The ROWS ship; the case's REAL arm additionally needs the local `.mpd/red-baseline` scratch tree, which is ABSENT in this checkout, so its `--self-test` (synthetic observations) is what runs — stated here rather than implied | KEPT, with the one dead arm dropped |

## Verification of the sweep

```
$ node scripts/run-qa-lanes.ts --check-drift      # at THIS point: exit 1, 40 listed, 2 unlisted — see the third pass below
$ node skills/dsh-qa/scripts/team-watchdog-boot.ts --self-test      → PASS
$ node skills/dsh-qa/scripts/team-watchdog-heartbeat.ts --self-test → PASS
$ node skills/dsh-qa/scripts/watchdog-redesign.ts --self-test       → PASS (15 checks, 0 failed)
$ node skills/dsh-qa/scripts/workmate-library.ts --self-test        → PASS ("ok: 19 checks")
$ bun run test:qa                                   → see test-qa-after-sweep.out
```

## Known residue, reported rather than edited (NOT this lane's files)

- `scripts/run-qa-lanes.ts` (Lane B's scope) still NAMES the deleted `agent-teams-adopt` lane in three
  comments (the usage example, the measured-red note and the webRoute fence note). They are prose, not
  a registry, and the runner reads its lane list from `cases.json` — but they are stale and Lane B should
  retire them before the captain commits.
- `skills/dsh-qa/SKILL.md`'s prose elsewhere may still describe the retired body; the three deleted
  cases' rows are gone, which is the drift the reviewer checks.

## One accidental artifact, declared

While sweeping, this lane ran `node -e "import('./skills/dsh-qa/scripts/workmate-library.ts')"` as a
syntax check — and that case is NOT entry-guarded, so the import RAN the real lane and wrote
`evidence/plan-f/workmate-library/2026-10-07T10-38-04.837Z/` (`ok=false`: its `files` check is red).
The directory is KEPT rather than deleted (it is a real, reproducible measurement), and it is reported:
the `files` check of `workmate-library` does not hold in a real run on this checkout. The self-test arm
of the same case is green after this lane's dropped arm.

## SECOND PASS — Lane B's relayed list + the captain's rulings (2026-10-07, same lane)

Items my first enumeration did not carry, each now settled with its line:

| Item | Subject that disappeared | Disposition |
|---|---|---|
| `skills/dsh-qa/scripts/lib/watchdog-lane.ts` — `PATHS.fixture` | `packages/mpd-team-watchdog-plugin/test/fixtures/inject.ts` (deleted with the vendored body; its subject was the ADOPTED scheduler + halt path) | FIELD REMOVED (no dead path survives anywhere in `skills/**`; `grep -rn "fixtures/inject\|PATHS.fixture" skills/` → nothing) |
| `team-watchdog-fault.ts` | the VERIFIED fault fixture — the lane's base (1), which mounted the REAL adopted scheduler/tools modules and injected silence | **CASE RETIRED** (deleted): most of its evaluator (STALE_FIXTURE_CASES, F2/F2b/F10 and 8 mutants) is written over the FIXTURE's case results, so retirement is the honest read of the ruling rather than a partial gutting. NAMED LOSS: the fixture-driven WARN→ESCALATE→scene→pause chain over the adopted scheduler, and the §1/§4 in-lane arm that rode with it. ONE FOLLOW-UP: rebuild an equivalent fault fixture for the OFFICIAL runtime (`mpd-team-core` + `mpdTeams`) — new capability work, not de-vendoring |
| `team-watchdog-scene.ts` | the fixture's `escalate-3x` case, which PRODUCED the scene the lane read back with plain fs | **CASE RETIRED** (deleted): its whole subject was fixture-produced. NAMED LOSS: the AC-5/AC-10 scene/hold/incident read-back from a fresh process |
| `team-watchdog-fault.ts`'s `safeSegment` re-implementation | `inject.ts:350`, the copy it mirrored | RESOLVED BY RETIREMENT: the orphaned copy went with the case. (It was never an orphan in the "unused" sense — the in-lane arm called it — but its ONLY written justification was the deleted mirror) |
| `relocate-smoke.ts` | — | **RECHECKED against the NEW adopted-bundle home (`packages/mpd-bundle-plugin/adopted/agent-teams-client.js`): it carries NO reference to it** (its subject is the staged bundle's relocatability, which ships) → KEPT unchanged |
| `web-client-adapt.ts` | — | **RECHECKED**: it names the embedded adopted bundle only in prose; the comment now names the new mpd-owned home. Its subject (the web client + workmate routes) ships → KEPT |
| `--write-registry` against the deleted `scripts/patch-agent-teams-fixes.ts` | — | **MEASURED NONE**: `grep -rln "write-registry\|patch-agent-teams" skills/` → no file. Nothing to do |
| `workmate-team-member.ts`'s dropped-injection rationale | the adopted body's member-persona patch | corrected per the captain's ruling: the automatic injection was a patch on the ADOPTED body, mounted by NO loader row since the **2026-09-27 retirement** — it was ALREADY INERT before this wave, so deleting the code changed NO runtime behaviour. `workmate-library.ts` carries that wording; its CAPTAIN-DRIVEN path (`mpd_workmate_match` → delegate → report → `mpd_workmate_reflect`) is asserted by its live arm. Follow-up (NOT this wave): re-establish the injection on the OFFICIAL path via `mpd-roster-provider-plugin` |

Counts after the second pass: `cases.json` 44 → 40 lanes (FIVE cases retired — `agent-teams-adopt`,
`agent-teams-messaging`, `workmate-team-member`, `team-watchdog-fault`, `team-watchdog-scene` — and ONE added,
`verify-law`), `SKILL.md` row count matches, and `bun run test:qa` reported `all self-tests passed` at that
moment (later runs reddened on OTHER lanes' in-flight edits — `extension-lifecycle.ts` — never on this lane).

## THIRD PASS — the drift gate closed (T14 repair, 2026-10-07)

`node scripts/run-qa-lanes.ts --check-drift` was red BEFORE this wave (measured against `HEAD`:
`git show HEAD:skills/dsh-qa/cases.json` carries NO entry for `goal-bridge` or `tui-deps-ctrla`, while both
scripts exist in `HEAD`) — and a wave may not ship a red drift gate, because the manifest's own rule requires an
entry even for a lane in no suite ("A lane deliberately outside every suite is declared here with
`outsideSuites` instead of being omitted"). Both are now REGISTERED with their real classification:

| Lane | Classification | Row |
|---|---|---|
| `goal-bridge.ts` (C8, the persisted GOAL) | a real isolated headless boot, same shape as `session-start-team` | `suites: ["all"]`, `immutabilityGuard` exempt |
| `tui-deps-ctrla.ts` (the Ctrl+A dependency view on a real TTY) | DSH-TUI edition lane; its own header declares three prerequisites | `suites: []`, `prereq: [absent-dsh-binary, absent-runtime, absent-fixture]`, `outsideSuites` naming the explicit run command |

MEASURED, this moment (2026-10-07T10:47Z):

```
$ node scripts/run-qa-lanes.ts --check-drift ; echo "DRIFT_EXIT=$?"
[run-qa-lanes] discovery: 42 lane script(s) discovered (42 listed, 0 unlisted, 17 outside every suite)
[run-qa-lanes] manifest and disk agree (48 entries, 42 lane script(s) discovered) and the immutability guard is declared
DRIFT_EXIT=0
```

So the FINAL manifest arithmetic for this wave: **44 lanes at `HEAD` → 42 now** (five retired, three added:
`verify-law`, `goal-bridge`, `tui-deps-ctrla`), 0 unlisted, `--check-drift` exit 0.

## The accidental real-lane run — VERDICT (captain's question, answered with commands)

Run the way the suite runs it: `node scripts/run-qa-lanes.ts --only=workmate-library` →
`PASS case=workmate-library evidence=evidence/plan-f/workmate-library/2026-10-07T10-42-03.828Z ms=53853`,
exit 0, with `files: {ok:true, uses:2, noteChars:251, memoryChars:420}`.

So it is **(b) an artifact, NOT a post-sweep defect** — the dropped `memberPersona` arm is an OFFLINE check and
cannot reach the `files` step (which reads the sandbox workmate directory after the boot). The precondition that
was missing is the CASE'S OWN, and it is now fixed at its root:

```
# the accidental run's harness log, verbatim
| 1 | mpd_workmate_init {base:"hephaestus", name:"alice", note:"Verilog counter specialist"}
    | ❌ Error: `unknown base — use a functional NAME from mpd_roles_list (Architect, Researcher, Planner,
      Deep Worker, Senior Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer)`
| 3 | mpd_workmate_spawn {name:"alice", ...} | ❌ Error: `no workmate named "alice" — run mpd_workmate_init first`
| 4 | mpd_workmate_reflect {name:"alice", ...} | ❌ Error: `no workmate named "alice" — …`
```

The case's live PROMPT instructed `base:"hephaestus"` — an internal STABLE ID the roster refuses (§13: a base is
addressed by functional NAME only). The lane therefore passed only when the model silently substituted a valid
name; run it twice and it is a coin flip. FIXED in this lane (my file): the prompt now says
`base:"Deep Worker"`, with a comment naming the measured red. This is a case-level flake the accidental run
surfaced — it is NOT caused by the sweep, and the artifact is kept.

## FOURTH PASS — the law's case re-copied (drift caught by the T14 review, 2026-10-07T10:46Z)

The registered copy had ALREADY drifted: the authored file grew by 23 lines after the first copy (the Lead
added the anti-drift arm), so `skills/` held a strictly weaker body whose own `--self-test` passed because the
arm was absent. RE-COPIED VERBATIM (never hand-merged):

```
$ sha256sum packages/mpd-verify-plugin/qa/verify-law.ts skills/dsh-qa/scripts/verify-law.ts
82531edd6c0be9ab4abb5ea2f59e364cbcfabff145e59ae47cc881b6e3a7e494  packages/mpd-verify-plugin/qa/verify-law.ts
82531edd6c0be9ab4abb5ea2f59e364cbcfabff145e59ae47cc881b6e3a7e494  skills/dsh-qa/scripts/verify-law.ts
$ bun skills/dsh-qa/scripts/verify-law.ts --self-test
[verify-law self-test] ok: the registered copy is byte-identical (82531edd6c0b)
[verify-law self-test] ok: patch row + dist symbols + refusal vocabulary + decision/row arms        # exit 0
```

THE DESIGN POINT, recorded so it cannot be lost: the sweep discovers `skills/dsh-qa/scripts/*.ts`, never the
package path — the anti-drift arm only protects the wave FROM the registered copy, which is why the copy (not a
merge) is the repair.
