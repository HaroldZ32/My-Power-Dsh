# Wave-2b t26 — CROSS-LANE acceptance-coverage sweep (read-only seat, no shell)

**Seat:** Architect (read-only; mechanically denied `write`/`edit`/`bash`). Written through the platform artifact channel.

**MOMENT — bounded, not asserted.** This seat has no clock, so the reading window is bounded by the readings the sweep itself quotes:
the LATEST quoted reading is **`14:28:21Z`** (t16's `gate-live.log` line, quoted in §Dispositions) and the earliest is t13's evidence stamp
`20260917T141608Z`. The artifact's own stamp (`20260917T1430Z`) is the first round minute after that latest reading — a DECLARED window,
not a measured instant. Every revision below is identified by its own declared stamp (the evidence directory's name) plus a verbatim quote.

**BOUNDS OF THIS SWEEP, stated as the task requires:**
- **NO SHELL.** No gate was re-run and no digest was computed. **THE DIGEST CHANNEL IS `UNAVAILABLE-TO-THIS-SEAT`** — no sha256 is asserted
  anywhere below. Where a digest appears in a quoted line, it is quoted FROM the record that computed it, with that record named, and it is
  never used as this sweep's own evidence of identity.
- **LIVE READS ONLY.** Every file was read with the read/grep tools at this moment. A claim taken from an earlier or injected copy is not a
  reading; the two consistency items below are the calibration (item 1 is CLOSED in the live file and therefore does not appear as a finding).
- **NOT MY JOB:** interior falsification (t19–t24), any non-evidence write, re-pinning, re-packing, git, or editing any lane's files. This
  sweep contains **no fix and no edit suggestion** for a lane's files, and **no verdict on a lane interior** — it reports coverage and the
  union-level gaps only.
- **A criterion I could not resolve is GAP, not PASS.**

---

## TABLE 1 — every frozen criterion → the evidence that answers it → PASS / GAP / NOT-YET-LANDED

The criterion wording is quoted from the lane's frozen acceptance artifact at its own declared stamp. The `answers` column names the artifact or
completion payload and quotes a field from it. `PASS` = the reading the criterion names exists on disk; `NOT-YET-LANDED` = a live task owns it and
has not reached a terminal reading; `GAP` = no reading answers it and no live task is named for it.

### Lane A — `evidence/requirements/wave2b-laneA/20260917T1405Z-wave2b-laneA-acceptance.md` · impl `t13` **FAILED**

| row (§home) | the criterion's own OBSERVABLE (verbatim opening) | answers | status |
|---|---|---|---|
| T-06 (§8.5) | "two status reads straddling one task transition carry different tokens…" | — (t13 lists T-06 in the ten-row PARTIAL table) | **GAP** |
| T-08 (§8.5) | "after seeding a plan, editing it (remove + re-add an item) and re-seeding, untouched tasks keep their ids…" | — (PARTIAL) | **GAP** |
| T-11 (§8.5) | "in a team with a chain (t1 → t2) the view names the ready task for the idle member…" | no task exists for the A/2 carrier | **NOT-YET-LANDED** |
| T-13 (§8.5) | "a deferred task is never offered to a seat, never claimed by the pump…" | t13: "T-13/T-27/T-44 have NO deliverable (not attempted)" | **NOT-YET-LANDED** (t27 pending) |
| T-14 (§8.5) | "for a task with a declared evidence dir, both render sites show the same pre-filled field set…" | — (PARTIAL) | **GAP** |
| T-15 (§8.5) | "two near-duplicate spellings of one clause land in ONE bucket…" | — (PARTIAL) | **GAP** |
| T-27 (§8.5) | "one call returns N contracts, each block naming the id it belongs to…" | t13: no deliverable | **NOT-YET-LANDED** (t27 pending) |
| T-42 (§8.5) | "the same plan file through BOTH paths yields the same task set (ids + subjects)." | — (PARTIAL) | **GAP** |
| T-44 (§8.5) | "a staged plan is approved from the text surface with no Web panel involved…" | t13: no deliverable | **NOT-YET-LANDED** (t27 pending) |
| T-64 (§8.6) | "a dependency naming a nonexistent id (or a cycle) is named in the scheduler/status output…" | t13: "3 of 13 rows satisfied with both readings on disk (T-87, T-84, T-64 — arm-before.out.txt RED 7 failures / arm-after.out.txt GREEN 0)" | **PASS** |
| T-84 (§8.6) | "a task whose contract requires reporting a red completes WITH a labelled reported-red entry…" | same payload line, T-84 named | **PASS** |
| T-87 (§8.6) | "the measured repro no longer reproduces: claim under revision N, amend, complete…" | same payload line, T-87 named | **PASS** |
| T-92 (§8.6) | "a COMMENT naming the pinned identifier does not redden the pin; the identifier in CODE does." | — (PARTIAL; t13 notes the T-64 design avoided needing `test/**`) | **GAP** |
| T-93 (§8.6, MINT) | "for a review carrying findings, the generated repair's assignee is never a seat whose deny list…" | — (PARTIAL) | **GAP** |

live stamp: `evidence/agent-teams/wave2b-laneA/20260917T141608Z/` · t13's registry reading: `--write-registry` reported **88 regions (from 81)**;
`--check` exit 0 **«88 mpd delta region(s) across 9 adopted file(s)»** · `bun run verify:docs` = PASS, derived line **«carried 88/9 vs derived 88/9»**.

### Lane B — `evidence/requirements/wave2b-laneB/20260917T1406Z-…` · impl `t14` **COMPLETED** · evidence `evidence/gates/wave2b-laneB/20260917T141936Z-laneB/`

| row | OBSERVABLE (verbatim opening) | answers | status |
|---|---|---|---|
| T-34 (§5) | "with a staged `skills/**` change and no lock change, the commit is refused…" | t14: "T-34 6/6 arms (hook refuses a staged corpus change without the lock, remedy named, lock byte-unchanged…)" | **PASS** |
| T-41 (§7) | "per toolchain entry … the doctor prints the RESOLVED PATH and VERSION, or an explicit MISSING ⇒ degrades…" | t14: "T-41 7/7 + live exit 0 with each entry NAMED … `MPD_AST_GREP_SG_PATH=/nonexistent/sg` → exit 2 DEGRADED with the entry named" | **PASS** |
| T-66 (§8.6) | "every path-shaped token the manual names is resolved against the worktree and reported PER PATH…" | t14: "T-66 6/6 + live exit 1 (`audited=107 resolved=103 unresolved=4`) with over-report 61 / under-report 61 in separate named buckets" | **PASS** |
| T-68 (§8.6) | "`--self-test` exits 0 on its fixtures and non-zero on a seeded parity violation…" | t14: "T-68 6/6 (seeded missing row → exit 1 + `MISSING … row-d`…)" | **PASS** |
| T-70 (§8.6) | "with one member seeded red, the output carries EVERY member's own verdict…" | t14: "T-70 9/9 + the real aggregate exit 0 reporting ALL FIVE members … the old `&&` chain's short-circuit shown in t70-before-chain.log" | **PASS** |
| T-71 (§8.6) | "a dry run … prints the policy-labelled lines; `--check` still exits 1 on drift and 0 in sync." | t14: "T-71 10/10 with `--check` exit 0 before AND after the wording change" | **PASS** |
| T-77 (§8.6, gitignore half) | "a NEW root dir matching the shape … is ignored, and `git check-ignore -v ./<path>` names the pattern…" | t14: "T-77 shape probe ignored / near-miss visible with the pattern named by git" | **PASS** |
| T-88 (§8.6, RULE) | "every non-integration wave-2b task's `inScope` is free of a derived-surface pattern…" | t14: "T-88 5/5 + live audit exit 0 (no lane covers a derived surface; integration task t25 declares all four) with the fixture-lane-holding-dist red side" | **PASS** |
| T-89 RUNNER HALF (row is D's) | "adding an unlisted `.mjs` to the corpus reddens the runner's own check…" | t14: "T-89 runner half `--check-drift` exit 0 with `discovery: 45 lane script(s) discovered (45 listed, 0 unlisted, 18 outside every suite)`…" | **PASS** |

### Lane B2 — `evidence/requirements/wave2b-laneB2/20260917T1410Z-…` · impl `t15` **COMPLETED** · evidence `evidence/gates/wave2b-laneB2/20260917T142452Z/`

| row | OBSERVABLE | answers | status |
|---|---|---|---|
| T-78 (§8.6) | "the usage text prints the rule, and a run's record carries it, so a reader of EITHER surface finds it…" | t15: "the rule + the exact command are in the checker's own usage block AND in a run record, read back as BYTES by the `negative-control:t78-record-carries-the-rule` arm (7900 B record, rule + command present, exit 0)" | **PASS** |
| T-80 (§8.6) | "for every corpus driver it scans, the header's `A<n>` claim set equals the set of assertion keys…" | t15: "`t80-matching` exit 0 vs `t80-claimed-but-unasserted` exit 1 naming A4 + the driver PATH, and `t80-extra-key-near-miss` exit 1 naming A4 (3/3 arms), plus the live scan (53 files, 2 key-producing drivers, 0 violations…)" | **PASS** |
| T-82 (§8.6) | "after two runs, `diff <runA>/revisions/<file> <runB>/revisions/<file>` is executable and meaningful…" | t15: "the changed pair's diff is non-empty and names the changed line (`// T-82 ARM CHANGE B`), while the unchanged pair's diff is EMPTY — the anti-fake control" | **PASS** |

### Lane B3 — `evidence/requirements/wave2b-laneB3/20260917T1413Z-…` · impl `t16` **COMPLETED** · evidence `evidence/docs/wave2b-laneB3/20260917T141815Z-lane-implementation/`

| row | OBSERVABLE | answers | status |
|---|---|---|---|
| T-28 (§8.5) | "the sentence exists AND is TRUE: a census run's report contains **no** `agent-references/` path…" | t16: "All SEVEN ids closed: T-28 policy sentence (AGENTS.md Language policy)…" | **PASS** |
| T-29 (§8.5) | "`templates/mpd-extension/README.md` + `.zh-CN.md` are reported as a POLICED pair…" | t16: "T-29 declared classification + templates/** discovery + promotion marker (arms x3)" | **PASS** |
| T-30 (§8.5) | "a new historical doc carrying the marker is exempt WITHOUT editing the gate…" | t16: "T-30 in-file exemptions + anticipatory class (arms x3)" | **PASS** |
| T-47 (§8.5, PACKED) | "the corrected prober's per-kind inventory reports 13/13 for the template root…" | t16: "T-47 the templates/mpd-extension README PAIR quoting all 13 manifest values in EN + zh-CN in the same change … prober 2/13 -> 13/13, 0 findings, --self-test 5/5" | **PASS** |
| T-91 (§8.6) | "the table carries the row; the sweep names it; the sentence states the post-`t26` discriminator…" | t16: "T-91 §4 row + bound + §11 sweep … landed against the CORRECT reason per plan amendment A5" | **PASS** |
| T-90 (§8.6, doctrine) | "the three clauses + the bound are stated, and the copy-the-bytes step is named as an action…" | t16: "T-90 and T-88 doctrine in §7" | **PASS** |
| T-88 (§8.6, doctrine half) | "the text names the class, the declare-at-creation rule, and the escape." | t16: same line | **PASS** |

### Lane C — `evidence/requirements/wave2b-laneC/20260917T1416Z-…` (248 lines, ADDENDA A–C) · impl `t17` **IN_PROGRESS**

| row | OBSERVABLE | answers | status |
|---|---|---|---|
| T-79 decisive test | "restart the host … re-run ONE terminal-task replay reusing a recorded shape…" (§A12) | t17 carries the acceptance; `commandsRun`/`acceptanceResults` still empty | **NOT-YET-LANDED** |
| T-25 (instrument leg) | "a naive read … returns **0 events**, while the frame-by-frame reader returns **N > 0**…" | — | **NOT-YET-LANDED** |
| T-41 (probe leg) | "the absent binary is NAMED with what degrades, while the other entries stay `ok`." | — | **NOT-YET-LANDED** |
| `--live` leg (ADDENDUM A) | "run BOTH directions … the mutant being the arm that must redden" | — | **NOT-YET-LANDED** |

### Lane D — `evidence/requirements/wave2b-laneD/20260917T1420Z-…` (204 lines, ADDENDUM A) · impl `t18` **CLAIMED** (attempt 2)

| row | OBSERVABLE | answers | status |
|---|---|---|---|
| T-25 (reader half) | "the arm reports, from the SAME store at the same moment, a naive read … returning 0 events…" | — | **NOT-YET-LANDED** |
| T-69 (lane half) | "a corpus scan reports ZERO raw-flag invocations outside the declared contrast sites…" | — | **NOT-YET-LANDED** |
| T-77 (driver half) | "a scratch dir created by a driver matches the pattern … while a near-miss … does not." | — | **NOT-YET-LANDED** |
| T-80 (arms) | "per driver, the header's claimed keys and the produced keys agree…" | — | **NOT-YET-LANDED** |
| T-74 | "a driver invoked from outside its own task with an explicit `--out` leaves the foreign directory BYTE-IDENTICAL…" | — | **NOT-YET-LANDED** |
| T-89 (corpus half) | "the corpus's invocations use `./` forms; no bare positional path can reach a copy…" | — | **NOT-YET-LANDED** |

**TABLE 1 TALLY (42 register-row criteria + 1 addendum leg = 43 rows):** **PASS 22** (A 3 · B 9 · B2 3 · B3 7) · **NOT-YET-LANDED 14** (A 4 · C 4 · D 6) ·
**GAP 7** (all lane A: T-06, T-08, T-14, T-15, T-42, T-92, T-93).

---

## TABLE 2 — each lane's DECLARED `inScope` (read from the LIVE contract) and whether its verifies stay inside it

| lane | impl task + state | DECLARED inScope (verbatim, live) | reported verify | inside the declared set? |
|---|---|---|---|---|
| A | `t13` **failed** | `packages/mpd-agent-teams-plugin/lib/**`, `…/self-fix-tests/**`, `agent-references/agent-teams-deltas.md`, `scripts/patch-agent-teams-fixes.mjs`, `evidence/agent-teams/wave2b-laneA/**` | `bun test ./packages/mpd-agent-teams-plugin` | **Writes: YES** — its 13 `changedPaths` are all inside (e.g. `lib/{quality-gates,tools,state,mpd-deltas}.js`, the deltas doc, its evidence dir). **Executes outside:** the command also runs `test/**`, which the set excludes — the A4 hop for `test/**` was NOT granted, and t13 records that the T-64 design was changed to avoid needing it. Executing is not writing; the plan's own lane gate names this command. **No GAP.** |
| A/2 | `t27` **pending** | not read in this sweep (a pending task's set is read at its own contract; marked, never guessed) | — | **not assessed** (stated as such) |
| B | `t14` **completed** (contract rev 2) | `scripts/verify-rows-parity.mjs`, `scripts/verify-manual-paths.mjs`, `scripts/verify-gates.mjs`, `scripts/repin-vendor.mjs`, `scripts/run-qa-lanes.mjs`, `scripts/mpd-doctor.mjs`, `scripts/install-git-hooks.mjs`, `scripts/verify-pack-closure.mjs` (the GRANTED hop, rev 2), `.gitignore`, `package.json`, `evidence/gates/wave2b-laneB/**` | `node scripts/verify-rows-parity.mjs` · `node scripts/run-qa-lanes.mjs --check-drift` | **YES** — both commands are files inside the set; all 20 `changedPaths` are inside; `scripts/verify-docs-parity.mjs` (B3's) is absent from both the set and the change list, which the lane's own `write-set-audit.log` states |
| B2 | `t15` **completed** | `scripts/check-citations.mjs`, `evidence/extensions/**`, `evidence/gates/wave2b-laneB2/**` | `node scripts/check-citations.mjs` | **YES** — and its runs wrote `evidence/extensions/docs-claims/runs/run-2026-09-17T14-24-29.334Z/` and `…14-25-20.731Z/`, INSIDE the declared `evidence/extensions/**` (the declaration that makes a plain run in-domain) |
| B3 | `t16` **completed** (rev 2) | `scripts/verify-docs-parity.mjs`, `AGENTS.md`, `agent-references/index.md` (the A6(1) declaration), `templates/**`, `docs/**`, `extensions/**/README.md`, `extensions/**/README.zh-CN.md`, `packages/*/README.md`, `packages/*/README.zh-CN.md`, `evidence/docs/wave2b-laneB3/**` | `node scripts/verify-docs-parity.mjs` | **YES** — every changed path (the gate, `AGENTS.md`, the template pair, six `docs/*.md` process records, its evidence dir) is inside the declared set |
| C | `t17` **in_progress** | `packages/mpd-team-watchdog-plugin/src/**`, `packages/mpd-team-watchdog-plugin/test/**`, `agent-references/troubleshooting.md`, `evidence/team-watchdog/wave2b-laneC/**` | `bun test ./packages/mpd-team-watchdog-plugin` | **YES** — the verify runs that package's own `src/**`+`test/**`, both declared |
| D | `t18` **claimed** (attempt 2, rev 2) | `skills/**`, `evidence/dsh-qa/wave2b-laneD/**` | `node scripts/run-qa-lanes.mjs --check-drift` | **Writes: YES** (no `changedPaths` yet). **Executes outside:** the runner FILE is lane B's (`scripts/run-qa-lanes.mjs`), not in this set — it is executed READ-ONLY, which is exactly A2.1's substitute and why the row is D's while the file is B's. **No GAP.** |

**TABLE 2 VERDICT:** **no lane's reported verify WRITES outside its declared `inScope`.** Two lanes EXECUTE a path they may not write
(A's `test/**`, D's `scripts/run-qa-lanes.mjs`); both are named above with their sanction, and neither is reported as a gap.

---

## DISPOSITIONS — the captain's two consistency items against the LIVE `AGENTS.md`

**(1) §11 release-sweep item — ALREADY CLOSED; it does NOT appear as a finding.** Live reading, line 539 of the current `AGENTS.md`:

> `` `node scripts/verify-dist-fresh.mjs`, `node scripts/verify-pack-closure.mjs` (freshness read from ``

with the bound continuing on the next line and the gate row itself at line 189 (``| Pack closure | `node scripts/verify-pack-closure.mjs` (completeness + the byte identity of files whose sources did not move; `--self-test` is the fixture-driven arm; `--pack-stamp <t>` re-anchors the comparison for a reviewer mutating a copy) |``). — **Closed by the live file.**

**(2) §4 Doc pairs row — THE LIVE STALE BAND (reported as a finding).** Live reading, line 194:

> ``| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.mjs`; ships `--self-test` with a negative control; recursive under `docs/` and `extensions/**/README.md`, and it fails on a zh-only doc or an undocumented package) |``

while the language-policy bullet in the SAME live file (line 12) lists `` `templates/**/README.md` `` among the discovered pairs. One of the two is
stale; T-29's implemented change (t16 closed) makes the POLICY BULLET the one that matches the gate. **Reported, not fixed.**
(*Line numbers are locators for THIS reading of the live file; the durable anchor is the quoted phrase — T-55/T-90.*)

---

## FINDINGS (union-level only; no lane-interior verdict)

**F1 — LANE A'S COVERAGE IS THE SWEEP'S LARGEST GAP.** `t13` is **failed**, reporting "3 of 13 rows satisfied with both readings on disk (T-87, T-84,
T-64) … 10 rows NOT satisfied and reported PARTIAL with the uncovered half named" (its `README.md` §3). Live tasks cover only three of the ten:
**`t27` (impl-A/2) is pending for T-13/T-27/T-44**; **T-11 has no task at all** (the A/2 carrier is created only after impl-A is terminal —
which it now is); and **T-06, T-08, T-14, T-15, T-42, T-92, T-93 have no named successor**.

**F2 — A CROSS-LANE RED AT THE UNION: the closure gate's own self-test is 33/34.** t16's payload names it and routes it: "ONE cross-lane red is
NAMED and routed rather than absorbed: `node scripts/verify-pack-closure.mjs --self-test` exits 1 (33/34 arms; the negative control that must return
exit 1 returned 0) — lane B's gate, recorded under A2.1 and NOT in this lane's verify list." This matters at the union level because:
(a) my r-B acceptance lists that command in lane B's verify set; (b) `t14` is COMPLETED and its own `commandsRun` records only the two
`verify-rows-parity`/`check-drift` commands; (c) `t14`'s write-set audit names `scripts/verify-pack-closure.mjs f59850ba9211c217` as "the GRANTED
hop, contract revision 2" — i.e. the file WAS modified by that task. **A negative control that no longer returns exit 1 is the exact failure mode
this wave's rules exist to catch**, and it is reported here, not fixed. (Digest quoted from t14's audit line; this seat computed nothing.)

**F3 — the §4 Doc pairs band** (Disposition 2).

---

## WHAT THIS SWEEP DOES NOT COVER

Lane interiors (t19–t24 own those), the pack/re-pin/release sweep (t25), any digest or hash identity claim, and any judgement about whether a lane's
PARTIAL reason is acceptable — this sweep reports where the union stands, names the gaps, and stops there.


---

## ADDENDUM (appended after completion; nested, never a rewrite) — F2 CORRECTED as my own stale reading, the PROXY label applied, and disposition (b) settled at the source

**1. F2 IS WITHDRAWN AS A CURRENT RED — and the error is mine, of exactly the class this task was calibrated against.** My F2 rested on
t16's routed red ("`node scripts/verify-pack-closure.mjs --self-test` exits 1 (33/34 arms)"). Reading the OWNER'S record shows a LATER reading:
`evidence/gates/wave2b-laneB/20260917T141936Z-laneB/REPORT.md` §5 documents the cause and the fix — the arm pinned `--pack-stamp` at
`statSync().mtime` (millisecond precision) while the gate compares `statSync().mtimeMs` (sub-millisecond), so a source file at `X.400086 ms`
read NEWER than a pin of `X.400` and the HARD verdict **silently became the EXPECTED class**; the captain granted the hop (contract revision 2
added the file to `inScope`); the pin is now `Math.floor(mtimeMs) + 1` and **`--self-test` is 34/34 with the live read exit 0 — both readings
kept (33/34 before, 34/34 after)**. So the honest statement is: *a real red existed and the sanctioned hop fixed it*, not "a lane shipped a
must-redden arm that stopped reddening".
**WHAT I CANNOT ORDER, stated rather than smoothed:** B3's 33/34 was read at `14:28:21Z`, and B's report lives in a directory stamped
`20260917T141936Z` whose CONTENTS were written after the hop was granted. A directory name is not a file's mtime, and this seat cannot stat —
so **the two readings' order is not establishable from what I can read.** The disposition therefore is: the owner claims the fix with both
readings kept, no one has withdrawn the 33/34 reading, and **rev-B (t20) owns the verdict**. F2 is handed over as a two-reading discrepancy,
not as my finding of a live defect.

**2. THE FOURTH LABEL — `PROXY` — DEFINED AND APPLIED.** `PROXY` = a reading that is not the instrument's own reading (a grep for a prober's
field names is not the prober's run); it must never be counted PASS, and it is not a GAP either. After reading the four instrument outputs
directly, **no PASS row in Table 1 stands on a proxy**, and the named candidate is upgraded:
- **T-47 (lane B3)** — the corrected prober's OWN artifact, `debranding-after.json`: `"probeCount": 13, "quotedCount": 13, "notQuoted": []` for
  `templates/mpd-extension`, and the run's own claim line: *"probed 26 field-probes (skills, flows, roles, mcp) on 2 targets; 26 quoted
  verbatim, 0 reported not-quoted; 0 finding(s). No claim is made about a field this prober did not probe."* → **PASS on the instrument's reading.**
- **Lane A (T-87/T-84/T-64)** — `evidence/agent-teams/wave2b-laneA/20260917T141608Z/README.md`: *"Three of the thirteen rows are CLOSED with
  their red side on disk: T-87, T-84, T-64"*, with the arm pair kept (`arm-before` **RED-SIDE FAILURES: 7** → `arm-after` **0**).
- **Lane B (9 rows)** — `REPORT.md`'s per-row table (e.g. T-34 *"exit 0, 6/6 arms"*, T-70 *"9/9 arms"* + the old `&&` chain's short-circuit in
  `t70-before-chain.log`, T-71 *"10/10 arms"*, T-89 *"discovery: 45 lane script(s) discovered (45 listed, 0 unlisted, 18 outside every suite)"*),
  each with its file's digest as the lane recorded it.
- **Lane B2 (3 rows)** — `result.json`: the T-80 either/or decision recorded as a SUBCOMMAND (inScope-exact), the 3/3 fixture arms, the T-82
  retention diff naming `// T-82 ARM CHANGE B`, and *"25/25 checks passed (was 22/22): +3 wave-2b arms"*.

**3. DISPOSITION (b) SETTLED AT THE SOURCE, and ROUTED — verdict left to t22.** The gate's own code agrees with the policy bullet, not with the
table row: `scripts/verify-docs-parity.mjs` carries `for (const band of ["extensions", "templates"]) {` and the band comment
*"`templates/**` joined the discovery set with this row: the template README pair shipped UNPOLICED."* So `AGENTS.md` line 194's table row is the
stale string, and **rev-B3 (t22) owns the verdict**.

**4. TWO MORE UNION-LEVEL ITEMS, both routed by lane B rather than absorbed — they belong in this sweep because no lane interior owns them:**
(a) `node ./scripts/verify-manual-paths.mjs` → **exit 1**: `AGENTS.md` names **4 paths that do not exist at the repo root** — `dist/validator.js`,
`dist/index.js`, `client`, `node_modules/@mpd-dsh/mpd` — all loose relative / exports-map spellings rather than deleted files; the fix is a DOCS
edit and lane B routed it to **B3** (never an edit from its own set). (b) `scripts/mpd-doctor.mjs` **is not in `dist/mpd-package/`** — the packer
copies only `install-mcp.mjs` and `mpd-ext.mjs` from `scripts/`, so shipping the doctor needs a packer asset-list/`files` edit, which is outside
every lane's set → an **INTEGRATION (t25)** item.

**5. THE CALIBRATION NOTE THE TASK ASKED FOR, with this artifact's own two worked examples:** *a claim taken from an earlier copy of a file —
including the copy an instruction injection hands you — is not a reading.* Item (a) settled **against my own earlier flag** (the §11 sweep line was
closed in the live file before I re-read it), and **F2 above is the second instance: my headline finding was a reading OF A READING** (B3's window)
rather than the owner's latest. Both are the same class as T-55's rotted pointer, one level up: **a rotted COPY rather than a rotted OFFSET — and
the remedy is the same discipline (re-read, stamp what you read, and say when you cannot order two readings).**


---

## ADDENDUM 2 (the captain's post-sweep disposition, applied; nested, never a rewrite)

**A. LANE A — SEVEN ROWS RE-LABELLED `GAP` → `NOT-YET-LANDED`.** The captain's disposition states that lane A's remainder is a **SEQUENTIAL
SLICE QUEUE** — `t27` (T-13, T-27, T-44) is live and the rest are created on each terminal — and gives the rule verbatim in substance:
*"a slice that has not run yet is not a failed reading."* Applied here, Table 1's tally becomes **PASS 22 · NOT-YET-LANDED 21 · GAP 0**:
T-06, T-08, T-14, T-15, T-42, T-92 and T-93 move class; T-11 and the `t27` trio were already NOT-YET-LANDED. **My earlier `GAP` label asserted
more than the state supported** — an absent successor was read as a failure rather than as a queue, which is the same over-claim class this
task's confidence note is about, in the GAP direction instead of the PASS direction.
**LABEL DIFFERENCE, named rather than smoothed:** t13's payload counts *"3 of 13 rows satisfied … 10 rows NOT satisfied"* (T-11 excluded, as the
A/2 carrier), while the captain's disposition says *"3 of 14 rows … the other 11 named PARTIAL"* (T-11 folded in). Both are readings of the same
file; the difference is whether the carrier counts as a row. This table keeps T-11 as its own row and records the difference.

**B. LANE B'S TWO HAND-OFFS NOW HAVE NAMES, so my Table-1 findings are dispositioned rather than open:** (i) the four unresolved `AGENTS.md`
spellings → **`t28`** (docs-parity-engineer); (ii) the unpacked `scripts/mpd-doctor.mjs` → a **MINT CANDIDATE with its measurement kept**, *not* a
closure of any row. So the union's item (b) is a future register row, not a t25 gate fix. Both replace the frozen body's looser phrasings ("routed to
B3", "a t25 item") without rewriting them.

**C. A THIRD INSTANCE OF THE CLASS — the captain's own ledger entry (A-60 → A-61):** it claimed the t21 rebalance landed on `qa-lane-engineer`
while the platform had REFUSED it (`member "qa-lane-engineer" is busy with t18`); the correction sits nested in A-61 rather than rewritten, and the
seat that actually took t21 is the newly added `citation-reviewer`. **A ledger entry is a reading too** — which makes THREE worked examples inside
this one artifact: item (a) settled against my own earlier flag, F2 was a reading OF A READING, and this one is a reading of a platform refusal that
never became a state.

**D. WHAT DID NOT CHANGE:** Table 2's verdict (no lane's reported verify WRITES outside its declared `inScope`; the two execute-outside cases named
with their sanction), the `PROXY` label and its finding that no PASS row stands on a proxy, and every bound — no shell, **DIGEST CHANNEL
`UNAVAILABLE-TO-THIS-SEAT`**, moment bounded by the readings quoted rather than asserted.


---

## ADDENDUM 3 — F2 settled by a measurement this seat could not take, and the INVITED RE-READ (lane C has closed since the sweep)

**1. F2 IS SETTLED, AND IT WAS A STALE RED.** The captain ran the command (this seat has no shell): `node scripts/verify-pack-closure.mjs --self-test` →
**exit 0, `self-test PASS: 34/34 arms`, at `scripts/verify-pack-closure.mjs sha256 f59850ba9211c21747ddcbd103690b83b00f217e4bfd07298b3dff6589c57f45`** —
the exact revision `t14`'s write-set audit names as the granted hop — and the arm I flagged now reads
`negative-control (same mutation, stamp pinned -> hard CONTENT-DRIFT, exit 1) … PASS (exit 1)`. So the red was **true at t16's route (14:18) and fixed by lane B's
A7 hop (14:19)**, and each of my three supporting facts dissolves exactly as the captain states: the command IS in r-B's verify set (true); `t14`'s `commandsRun` carries only its
CONTRACT verifies (correct — a granted hop's readings live in the evidence, not the ledger); and the file WAS changed by that task (**that change IS the fix**).
**MY ONE RESIDUE, confirmed and closed by construction:** the 34/34 reading sits in NO task's ledger; `t25`'s verify list carries BOTH the gate and its `--self-test`, so the
integration's ledger will hold it. Recorded as an **OBSERVABILITY finding about hop readings** — not as a defect.

**2. THE WAVE-LEVEL READING THE SAME COMMAND ANSWERS, recorded here as t25's INPUT rather than as my finding** (the captain's second reading, quoted): the LIVE gate
exits **0** while naming **4 `CONTENT-DRIFT-EXPECTED`** entries — lane A's four `lib/*.js`, source mtimes `14:18:52Z–14:22:50Z`, all after the artifact stamp
`2026-09-17T08:55:57.244Z` (the wave-2a re-pack) — i.e. **the wave's ONE owed re-pack showing up as a provenance-named expectation**, which the integration must drive to zero;
its self-test's positive control independently cross-checked the same writers (1181 compared / 1166 identical / 0 drift / 15 expected-after-pack).

**3. F1's COUNT STANDS, ITS MEANING IS THE QUEUE** (already re-labelled in ADDENDUM 2, now with the platform's own words): the platform refuses a second live write task over one
path set — verbatim **`inScope overlaps t27`** — so lane A's slices are created on each terminal in this order: **T-92/T-93/T-06/T-42 → T-14/T-15/T-08 → T-11's carrier**, with
T-11's carrier being the fourth slice rather than a forgotten row. `NOT-YET-LANDED` is therefore the correct label, and it was already in this table's vocabulary.

**4. THE INVITED RE-READ — lane C closed since the sweep, so four rows MOVE.** `t17` is **COMPLETED** at `evidence/team-watchdog/wave2b-laneC/20260917T1620Z-t17/` with all six
contract criteria passed:
- **T-79's decisive test → PASS (OUTCOME B).** The driver ran with the host restarted and reports **`woken=false` on the kick route, 0 deliveries plus the NAMED decline, red
  side delivering** (`t79-decisive-result.json`, `raw/t79-restart-job.log`, pass2 authoritative). Per §A12, that is the branch that closes the residual as *stale host* while the
  mechanism claim stays **REFUTED-for-a-fresh-process** — said in the lane's own words, not mine.
- **The forbidden framings → PASS:** a census reports 0/0 in `agent-references/troubleshooting.md` and in every lane-authored artifact, with **ONE NAMED EXCEPTION** kept rather
  than smoothed (two verbatim third-party captures carrying the token once inside lane B's static git-bash line; documented in `raw/t41-capture-note.md`, unaltered because the
  acceptance forbids truncating captured output).
- **T-25's leg, T-41's leg and the `--live`/`--mutant` addendum-A leg → PASS**, each with its red side measured (`t25-naive-vs-frame-reader-result.json`,
  `t41-absent-binary-assert-result.json`, `addendum-A/live` + `addendum-A/mutant`).
- **Lane C's derived-surface hygiene → PASS:** `find packages/*/dist dist/mpd-package -newermt 2026-09-17T14:15Z -type f` is EMPTY, so no rebuild was needed and no hop was
  consumed.
**TALLY AFTER THE RE-READ: PASS 26 · NOT-YET-LANDED 17 · GAP 0** (A 3 + B 9 + B2 3 + B3 7 + C 4 = 26), with three qualifiers named rather than folded in:
(i) lane A's three PASS rows now sit **under repair `t29`** — rev-A (`t19`) returned SEVEN findings on them (T-64's cycle, the stale red side, the length-only fallbacks, the
`reported` description) and the captain ruled the ten unimplemented rows OUT of `t13`'s scope; the reading exists, so the status stays PASS, and the open repair is stated beside it;
(ii) **`t27` is now CLAIMED**, not pending — lane A's first slice is live; (iii) **`t28` is claimed by `watchdog-engineer`** per the LIVE contract, which differs from the dispatch
message's "(docs-parity-engineer)" — **a live-vs-message divergence recorded, not reconciled by me**, since the live task record is the authority for who holds it.

**5. THE DISPOSITION RULE THIS SWEEP EARNS, with both directions of the calibration:** a stale **COPY** (§11, read from an injected instruction copy while the live file had moved)
and a stale **RED** (F2, minutes old, inherited from another lane's route) are the same class — **a reading is true at a moment and must cite the revision it read**; so
**a routed red is a HYPOTHESIS until a seat with the instrument re-takes it.** That is why the `UNAVAILABLE-TO-THIS-SEAT` digest channel and the bounded moment are the right form for
anything this seat reports.


---

## ADDENDUM 4 — the routed Doc-pairs band SURVIVES the manual's next revision (status datum, not a new finding)

Re-read on my own surface after `AGENTS.md` took another revision (a path-precision pass over §6/§7/§8: the build line and the dist
paths now read `packages/<pkg>/dist/index.js`, and §8's exports wording was tightened). **The Doc-pairs row was not part of that pass:**
- `AGENTS.md` line 194 (the §4 table row) still reads *"recursive under `docs/` and `extensions/**/README.md`"*;
- `AGENTS.md` line 12 (the Language policy bullet) still lists `` `templates/**/README.md` `` among the discovered pairs;
- the gate source still agrees with the bullet (`scripts/verify-docs-parity.mjs` · `for (const band of ["extensions", "templates"])`).

So the item routed to **rev-B3 (`t22`)** is **still live at this revision** — recorded here so a later reader does not assume the band was
closed by the revision that touched the surrounding sections. This is a status datum on an already-routed reading; the verdict remains t22's,
and no fix is proposed by this seat.

**One methodological note, and it is the reason this addendum exists at all:** the `AGENTS.md` copy that reached this seat between revisions
was an INSTRUCTION INJECTION, and this file's own confidence note says such a copy is not a reading. The paragraph above therefore rests on a
LIVE grep of the on-disk file, and not on the injected copy — the same distinction that produced the first worked example in this artifact's
calibration note (§11 closed against my earlier flag).
