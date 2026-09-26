# Wave 2a report — the P1 batch of the friction register, closed on measured readings

**Author of record:** the captain (MPD) · **team:** `friction-p2-wave` (wave w1, one team for the wave) · **tree:**
`.mpd/team/friction-p2-wave` · HEAD at the start `c826f16` · every reading below carries the moment it was taken and the
record it rests on. **Report written by the captain; its honest-bounds section is reviewed independently under `t34` by a
seat that authored none of it.**

---

## 1. What this wave closed

**19 register items** (§8.6 rows) — the 10 P1-class rows, the 5 uncovered PARTIAL halves, plus **T-83/T-85/T-86** and
**T-73** (added to the batch mid-wave when the wave-1 journal refuted its "unused" label). Dispositions are on disk in
**`.mpd/TODO.md` §8.8`**, one row each with its task(s) and evidence pointer: **18 FIXED + T-79 PARTIAL** with the
uncovered half named. Six lanes ran: A (agent-teams tooling) · B (packaging + closure gates) · B2 (citation checker) ·
B3 (docs parity) · C (watchdog arms) · D (QA instruments, the wave's **single `skills/**` writer**).

**Eight register rows were added while the wave ran** — **six new ids minted from field measurements**: **T-87** (a
claim-time payload template vs an amended contract) · **T-88** (a cross-lane red whose only fix is outside the reddened
lane's `inScope`) · **T-89** (`bun test <dir>` is a SUBSTRING FILTER) · **T-90** (a citation to a mailbox record rots by
clearing) · **T-91** (the manual's gate table omits the closure gate) · **T-92** (a negative-assertion pin makes an
identifier unusable in prose) — **plus T-73 and T-74, registered from the wave-1 journal** (which declares its own
numbering authoritative; that reading is captain log §A-6(1)). Predicate: **§8.6 grew 24 → 32 rows**, i.e. six new ids
plus two rows whose ids already existed in wave 1's numbering. §8.1's mechanically-checked prose moved with each.

## 2. The gate sweep — every exit code, on the settled tree

Evidence dir: `evidence/wave2a-integration/20260917T085313Z-sweep-part1/` (full captures, never a `tail`).

| gate | command | reading |
|---|---|---|
| vendor | `node scripts/verify-vendor.mjs` | **exit 0 · PASS** (after the single re-pin) |
| dist freshness | `node scripts/verify-dist-fresh.mjs` | **exit 0 · 20/20 fresh** (each rebuilt twice, byte-identical); 7 NOT COVERED named |
| row parity | `node scripts/verify-rows-parity.mjs` | **exit 0 · 25 row ids match** the bundle patch insert list |
| doc pairs | `node scripts/verify-docs-parity.mjs` | **exit 0 · pairs=37 failed=0 violations=0 exempt=17 derived=3**, derived arm `carried 81/9 vs derived 81/9` |
| preset conformance | `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | **exit 0 · 31 harness rows conform**, persona prefix=true |
| extension CLI | `bun scripts/mpd-ext.mjs --self-test` | **exit 0 · 53 checks** (validator: source) |
| QA self-tests | `bun run test:qa` | **exit 0 · all self-tests passed** |
| package tests | `bun test ./packages` (**`./` path form**, T-89) | **exit 0 · 920 pass / 0 fail / 6526 expects across 87 files** (post-`t37`, `bun-test-packages.post-t37.full.log`; the pre-`t37` reading was 919/0/6514, `bun-test-packages.full.log` — a count carries its revision) |
| pack closure (before) | `node scripts/verify-pack-closure.mjs` | exit 0 · `1181 compared, 1156 identical, 0 drift, 25 expected-after-pack` |
| pack closure (after) | same, post-re-pack | **exit 0 · `1181 compared, 1181 identical, 0 drift, 0 expected-after-pack`**, **0 FAIL lines** |

`bun run verify:gates` was deliberately NOT used as the sweep: it short-circuits on the first red (T-70), so each gate was
run and recorded on its own. Every test command used the **path form** (`bun test ./packages`) because the bare form is a
substring filter (T-89).

## 3. The single re-pin, and the single re-pack

**Re-pin (the wave's headline deliverable).** The authority is the dry run immediately before the write:

| step | reading |
|---|---|
| dry run at the write | locked `68318157344aafec…`/323 → **computed (LF) `b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620`**/323 (1 file LF-normalized); raw-bytes `357b4bc858ebcb51…` **never written** |
| `--write --i-know-this-is-the-captains-step` | 1 field change, `VENDOR_LOCK.json` line 22, 3434 B → 3434 B |
| `node scripts/repin-vendor.mjs --check` | **GREEN — lock matches the working tree (drift=0, problems=0)** |

Three previews were **superseded in sequence and named as such** (`7aef5fd2…`/`8ea212eb…` → `2c748d48…` at t11's moment →
`b9097d11…` at t28's). **Cause: 12 CORPUS files, a UNION not a sum** — lane D's changed set is 14 distinct = 12 corpus + 2
non-corpus, with `team-watchdog-config.mjs` in the overlap (change count 13, file count 12). The corpus was frozen behind
the write by **path ownership**: lane D was the single `skills/**` writer and its queue was empty.

**Re-pack.** Exactly ONE, by the captain, after every writer was quiet:

- before: stamp `2026-09-17T05:19:48.265Z`, `0 drift, 25 expected-after-pack`;
- `node scripts/pack-mpd.mjs` → **exit 0**, `modes normalized: 1190 files`;
- after: stamp **`2026-09-17T08:55:57.244Z`**, `1181 compared, 1181 identical, **0 drift, 0 expected-after-pack**`, 0 FAIL.

**The discriminating acceptance is MET in its strongest form:** not merely that the absorbed files left the EXPECTED set
(25 → **0**), but that every byte now matches. `exit 0` alone would have proven nothing — since the T-76/t26 rewrite the
gate exits 0 *before* the re-pack too, with the drifted-but-expected class named.

## 4. Register reconciliation — a TWO-RUN reading

| run | input | reading |
|---|---|---|
| ARCHIVED `--team friction-p1-wave` | `.mpd/team/archive/friction-p1-wave/team.json` | **exit 0 · 0 disagreements · three directions CLEAN** · arithmetic `36 + 3 + 5 + 16 = 60` · §8.6 = 32 rows |
| LIVE `--team friction-p2-wave` | `.mpd/team/friction-p2-wave/team.json` | **exit 1 · EXACTLY 36 disagreements, every one the ARCHIVE-BOUNDARY class**; **zero name a wave-2 row** |

The live run's 36 are all *"called FIXED but no implementation task claims coverageOf it"* for §8.2 rows the **archived**
wave-1 team fixed — a property of the one-team-per-wave rule, not a register defect, and the **same 36 before and after**
the closure. The post-closure discriminator (no disagreement may name a row the LIVE team fixed) is satisfied: a grep for
`T-6x/T-7x/T-8x/T-9x` over the disagreement list returns **0**.

## 5. Evidence rules this wave earned (carry them into 2b)

1. **Anchors in artifacts, pointers in messages** (T-90): durable records cite paths, symbols and digests; a citation to a
   **mailbox record** rots by clearing (archive-first, so nothing is hard-deleted — the citation rots operationally).
   Class-based: a task `attemptId`/session id is **data**; only mailbox ids are pointers (a shape scan scores ~100%
   false-positive here: 7/7 UUIDs found were legitimate, reconciled by two independent scans).
   **Owner record + moment:** the rot was measured in this wave's own inbox (a reviewer's filing cited by message id was
   no longer retrievable within the hour) and the FACT was moved into **lane D's `t11` nested correction**, which is the
   durable home; the class clause and the 7-occurrence calibration (two independent scans, reconciled) are **register row
   T-90**, and the corpus the scans ran on is the team's own task records.
2. **Cite a thing by its own declaration** (T-55 as extended): symbols not line numbers · **arms by LABEL + assertion**,
   never by position or adjacency · **full paths**, never abbreviations (measured: the abbreviations fail `-e` while the
   full paths resolve) · a null search result is *"no match under pattern `<the pattern>`"*, never "absent".
3. **Sentence provenance**: *cite the reading AND the sentence that carries it; when the sentence is not the reader's, say
   whose it is* — with the ADDENDUM 11/14 three-way split as the worked example (first-party reading / first-party runs /
   the second-hand sentence, marked not-reviewed).
4. **A derived value is RE-TAKEN, never INHERITED**: one derived count sentence was rewritten **four times in one
   afternoon** (78 → 79 → 81), each re-take recorded as *"a later revision, re-read"* rather than "still green".
5. **A count must carry its predicate AND its counter's semantics** — the wave's **eight** citation/count slips are eight
   SHAPES of one failure mode (arm by position · arm by adjacency · an 11-vs-12 double-count · relay-as-authorship · a
   tally inverting its own instances · a line citation from recollection · an occurrence census over an unenumerated field
   set · a population inferred from a generation counter). **The catcher provenance was measured on the SIX instances then
   known: five were caught independently and the sixth by the author — but only after a peer's challenge on the same
   construct** (captain log §A-32: "five of six … the 5+1 form is the report's text"); **the two later shapes carry their
   own provenance** — the occurrence census (§A-42) and the population-from-generation-counter slip, which is the
   requirements seat's own and is recorded at §A-38(4). **And the failure mode reappeared inside the sentence that counted
   its own instances**, which is the measured case for keeping requirement, work and review in separate seats.
6. **A recorded imperfection with a PRE-WRITTEN fix is nearly free; an unrecorded one costs a re-discovery** (earned twice
   in one session: a one-word imprecision in the two new table rows, filed with its pricing and its ready replacement, and
   the earlier `EXTENSIONS-FOR-AGENTS.md` path precision). Both were small enough that a task would have cost more than
   the word, which is why the pre-written replacement is the only part of the disposition that matters. On-disk instances:
   the table rows at their `t35` revision (`5f0b4b3659bad486…`, 41,863 B / 75 lines / 62 rows, diff `44a45,46`) plus
   `evidence/team-watchdog/t55-t90-rows/20260917T084753Z-t35/NOTE.log` ADDENDUM 2 and
   `evidence/team-watchdog/lane-c-2a/20260917T074144Z/raw/readings.log` ADDENDUM 16.
7. **Reproducibility comes from including the FAILURE, not the conclusion.** The worked example is the null-result row: it
   carries the **exact failing glob** beside the exact paths that DO resolve, so a doubter re-runs the narrow form, watches
   it return nothing, and sees the files exist. A row that merely said "a search can return nothing while the file exists"
   would not be re-runnable — **the failure is the evidence; the conclusion is only its summary.**

## 6. HONEST BOUNDS — mechanisms separated from inferences

- **T-79 is PARTIAL, and its mechanism claim is UNRESOLVED with a NAMED PROBE** (`node scripts/mpd-bg.mjs reload-check
  <module-path>`), whose verdict does **not** support the stale-host reading: the probe compares a module mtime against
  the **newest session's** directory mtime, so `FRESH` never means "the running host loaded this revision". Eight
  terminal-redispatch events are measured; the state half (`t8`) and delivery half (`t10`) landed; the decisive 2b test is
  written as **plan §A12** (restart the host, re-run ONE terminal-task replay reusing a recorded shape, with the fixture
  constraint that the wake needs a ticket-composing path). **Starvation was never observed.**
- **The closure gate no longer certifies artifact freshness or integrity by itself.** After the ROOT-FILE byte rule moved
  into the provenance-named class, the discriminator is **TIMESTAMP ORDER** — the class cannot attribute a cause but is
  loud by construction (file, source mtime, artifact stamp, anchor; printed in both branches; the hard direction stays
  reachable, **arm 20a green / 20c red**). Freshness is the EXPECTED-set drop-out, integrity is timestamp order plus
  `--pack-stamp`. **A reviewer who mutates an artifact copy must pin `--pack-stamp` or restore mtimes.** Both halves are
  invisible to a reader who sees only "closure: exit 0", which is why this report states them beside the exit code.
  **Owner record + moment:** the red was measured by **lane B2 at 08:01:19Z**
  (`evidence/gates/t72-durable-pointer/20260917T074353Z/CLOSURE-GATE-SUPERSEDED.md`, with `PACK-CLOSURE-DRIFT.md` left on
  disk beside it as the then-true earlier reading), the class was read **at source** in `scripts/verify-pack-closure.mjs`
  (the arm-20 comment block: "the discriminator is the TIMESTAMP ORDER, not content provenance"; the "20a green, 20c red"
  pair is the comment's own naming), and captain log **§A-25(1)** ("exit 0 and 0 drift are TRUE BEFORE the re-pack too …
  the post-re-pack acceptance is **membership**") plus **§A-26(2)** (the count corrected into a membership test) carry the
  trade's architecture, with **§A-29** carrying its second half (integrity: timestamp order + `--pack-stamp`).
- **The FAIL-line rule is PER COMMAND**: zero FAIL lines is the condition for a plain gate run; the gate's own
  `--self-test` log carries **16** FAIL-shaped lines BY DESIGN. A bare `grep FAIL` is a documented false red.
- **Two never-reproduced transients** on `bun test ./packages/mpd-agent-teams-plugin/` (`100 pass / 1 fail` at 07:45:51Z;
  `1 fail / 2202 expects` during a post-completion re-verification) against **TEN controlled GREEN runs, recorded** — four
  sequential plus six concurrent under load, enumerated in
  `evidence/agent-teams/t8-lane-a/20260917T071056Z/ADDENDUM-transient-red.md` (v1/v2/v3/verify-1-full + `load-run/load1..6`)
  and counted the same way in `t8`'s own `acceptanceResults` ("Ten full-suite runs are green (four sequential + six
  concurrent…)") — with **no foreign writer** touching the package and the shape fitting a window-dependent arm (the T-07
  race class). **The bound on the RED side, stated precisely: the two red RUNS' captures were never preserved** — the
  failing line was piped through a `tail` both times, so they stay **unnamed by observation, not for lack of trying**. The
  integration run itself captured full output: **920 pass / 0 fail / 6526 expects** (post-`t37`,
  `bun-test-packages.post-t37.full.log`). Unresolved, named, and 2b-shaped.
  *(A further six runs were REPORTED in a message while this revision was being written; no durable record enumerates
  them, so they are excluded from the count rather than cited — T-90's rule applied to our own tally.)*
- **Declared reds, all expected and named:** the pre-re-pack `CONTENT-DRIFT-EXPECTED` lines (absorbed); the live
  reconciliation's 36 archive-boundary rows (a rule property, unchanged by the closure); and `verify-gates`' repo-wide red
  before the re-pin, recorded in lane B's driver as `expected: "reported"` so it can never gate a lane's exit code.
- **Non-blocking observations carried, not buried:** the T-73 region sentence over-states the mechanism
  (`activateTaskAttempt` still clears itself for the cross-assignee shape; every outcome matches) · `t10`'s `verify` field
  lists a repo-wide aggregate its acceptance calls a reading · the named dispatch decline reaches the caller through the
  `logger.warn` seam rather than the kick's return value · `agent_teams_halt` is **not** a registered tool name (it is the
  external mechanism; the watchdog registers exactly its three names and the plugin's 20 `agent_teams_*` tools are
  unchanged) — so the older clause "both tools stay registered" is re-stated as *"the watchdog's three names stay
  registered and the agent-teams tool list is unchanged"* · `t32` filed an explicit **NOT-VERIFIED** page (eight gaps,
  each with what stands in for it) so an unmeasured surface cannot be mistaken for a verified one.
- **Deviations and self-corrections are on the record, not smoothed:** every lane's nested corrections beside sealed
  records (never over them) · one lane's overstated hygiene claim corrected in its own artifact · one arm-count movement
  (33 → 34) quoted with its revision · one captain instruction that went stale before execution and was caught by the
  executor · one `t8` verify entry left in the bare form because its reading is honest and the copies today sit in a
  dot-directory (latent, not firing) with the `./` form used everywhere in this sweep.

**The T-19 pin now carries its own falsification** (`t37`, landed AFTER the re-pack and free in gate terms — the packer
excludes `test/` and `self-fix-tests/` and the closure sweep never mentions them, so the edit could not invalidate the
artifact, create a drift line, or force a second pack). Readings: on the restored TRUE wave-1 line (condition
`team.halted`, not the new `team.pause.active`) the pin's matchers read prefix `true`, single-mechanism framing `false`,
**both drift guards `false`**, and the seeded copy reproduces the diagnostic falsehood the collapse fixed (`halt not
active` while HELD); on the shipped module all four read `true`; and a revert reddens the lane at the SEED step, so it is
falsifiable in both directions. **The additive-only claim is proved by HASH rather than promised**: cutting the file at
the lane's marker hashes to `afb3233519db7fac…` — the exact revision `t32` reviewed — so every shipped assertion and the
whole five-state coverage are byte-identical to what the reviewer verified. **A measurement correction is filed with it**
(`evidence/agent-teams/seeded-negative-control/20260917T085849Z/result.json` → `measurement_correction_disclosed`): the
earlier message-level seeding used a **HYBRID** line (the OLD tail with the NEW condition), so its "prefix reads true" leg
rested on the hybrid rendering ACTIVE while the hold was live — the three drift-guard conclusions are unaffected, and the
durable lane restores the true wave-1 line. Post-`t37` suite reading, full capture: **`bun test ./packages` → 920 pass /
0 fail / 6526 expects across 87 files**.

## 7. Rollover to wave 2b

**2b rolls 34 ids, minting from T-93**: the 27 originally-planned P2 items plus **T-74, T-87, T-88, T-89, T-90, T-91,
T-92**, and two named carry-forwards — **T-79's decisive host-restart test** (plan §A12) and **the seeded
negative-control lane** for the requalified T-19 pin (`t36`, cancelled as an optional hardening whose proof already stands
at message level). The register's §8.8 names the 19 closed items; §8.6 carries the 32 new rows with their measurements.

## 8. Discipline that made the wave auditable

**ONE `skills/**` writer** (lane D) and **exactly ONE re-pin**, in the commit that carries the change that invalidated the
corpus `treeSha` · **ONE git writer** (the captain) · evidence on disk for every claim, with the moment stated · nested
corrections beside sealed records · a task's write set **declared before it is needed** (two cross-lane fixes were
unblocked by amending the TARGET's contract rather than shrinking a completed donor's, and one potential collision was
split into two exact files *before* the validator could refuse it) · and a report whose bounds a seat that authored none of
it reviews independently (`t34`).

## 9. DECLARED ADDENDUM — the repair of `t34`'s four findings (post-review, and the boundary is stated)

**This section was added AFTER `t34` returned `needs_revision`** (review of record:
`evidence/review/t34-report-bounds/t34-report-bounds-review.md`, verdict on the 181-line revision of this file). The review's
verdict therefore judges the bytes it read; every change below is either the fix it asked for (F-1…F-4) or an item the
captain had **already dispositioned as post-review** before the verdict. Nothing else in the file was rewritten quietly —
§1, §2's package-test row and §5's rules 1 and 5 carry their corrections inline, and F-4's parts are carried here.

**F-4(a) — THE WRITERS THE ONE RE-PACK ABSORBED, named (the gate's own 25-entry `expected-after-pack` set at
`pre-pack-state.txt`, grouped by owner):**
- **lane A** (`t8`/`t21`/`t24`/`t31`/`t37`): `packages/mpd-agent-teams-plugin/lib/{tools.js, quality-gates.js, state.js,
  mpd-deltas.js}` + `agent-references/agent-teams-deltas.md` (the derived count sentence).
- **lane B2** (`t25`): `EXTENSIONS-FOR-AGENTS.md` (the root-file re-point).
- **lane B3** (`t19`/`t20`): `packages/mpd-team-watchdog-plugin/README.md` + `README.zh-CN.md`,
  `docs/extension-adaptation-report.md` + `.zh-CN.md`, `agent-references/index.md`.
- **lane C** (`t10`/`t35`): `packages/mpd-team-watchdog-plugin/dist/index.js` + `agent-references/troubleshooting.md`.
- **lane D** (`t11`/`t28`), the wave's single `skills/**` writer: the 12 corpus files `skills/dsh-qa/cases.json`,
  `scripts/extension-lifecycle.mjs`, `scripts/lib/immutable-output.mjs`, the eight migrated drivers, and
  `watchdog-redesign.mjs`.
- **Not in the byte set but packed anyway:** lane B's gate scripts under `scripts/` (`pack-mpd.mjs`,
  `verify-dist-fresh.mjs`, `verify-docs-parity.mjs`, `verify-pack-closure.mjs`) and lane B2's durable checker
  `scripts/check-citations.mjs` — the closure sweep compares `agent-references/**`, `docs/**`, `packages/**`, `skills/**`
  and the required root files, not `scripts/`, so lane B's edits never produced an EXPECTED line. **The four late writers,
  as §A-25's items read** — the log labels SECOND and THIRD explicitly and names a FOURTH in passing, with no FIRST
  label, so each entry below names the item it comes from: **FIRST (in this enumeration, from §A-25(4))** = lane D's
  self-caught evidence repair (a header whose file count was stale while the hash file beside it listed the right one);
  **SECOND** = lane B3's README pair (`t20`); **THIRD** = lane C's digest row in
  `agent-references/troubleshooting.md`; **FOURTH** = lane C's own honest addendum
  correcting an unmeasured "55 rows". **The set this re-pack absorbed is the five OWNER groups above, not the same four** —
  `agent-references/index.md` and the two `docs/` files are lane B3's as well (plan: "D-5 adopted into `t19`"), and lane B's
  gate scripts are packed without ever entering the byte sweep.

**F-4(b) — `t30`'s four declared bounds, QUOTED rather than paraphrased, each with the reading that grounds it** (record dir `evidence/pack-closure/review-B/20260917T084000Z-t30/`, supplied verbatim by the lane that filed them):
1. *"the repaired driver requires the output dir to exist (loud throw, exit 1) rather than creating it"* — grounded by
   `broken-harness/run.log`: `Error: output directory does not exist: …`, exit 1 (loud, never silent).
2. *"`digests` mixes run-written and inherited-but-eligible files; the header documents the rule and exclusions carry
   reasons, but there is no per-entry run-written flag"* — grounded by the two planted probes in `fresh-run/result.json`
   (`planted-empty.tmp` → `digests_skipped` with its reason; `planted-old.txt`, mtime 07:00Z → digested by the rule).
3. *"`verify-gates` exit 1 is lane D's corpus condition, recorded as `expected: \"reported\"` (t18 owns the aggregate)"* —
   grounded by `result.json` → `steps`: `verify-gates` exitCode 1 with `expected: "reported"` while every lane-scoped step
   is 0.
4. *"no live dsh boot; no `skills/**` write; no git write; canonical artifact never written"* — grounded by
   `falsification.json` → `artifact_read_only.identical: true` and `result.json` → `revision.artifact_untouched` (the
   artifact stamp `ff5f96da7c43a056` / 1190 unchanged before and after every leg).
None gates the wave; all four travel with it.

**F-4(c)** is discharged inline, not here: §5.1 now names **lane D's `t11` nested correction + register row T-90** as the
mailbox-rot rule's owner record, and §6's closure-gate bullet names **lane B2's 08:01:19Z measurement**
(`evidence/gates/t72-durable-pointer/20260917T074353Z/CLOSURE-GATE-SUPERSEDED.md`) and the **arm-20 comment block** of
`scripts/verify-pack-closure.mjs` as the source of the timestamp-order mechanism.

**Items dispositioned BEFORE the verdict, added here rather than in a silent edit:**
- **The shipping bound (§A-48):** every instrument this wave built is durable **in the repo, never in the shipped
  artifact** — the watchdog package ships only `dist/ README.md README.zh-CN.md`; the agent-teams package ships whole
  **minus `test|self-fix-tests`** (the packer's own filter); `evidence/**` does not ship at all; and lane C's arms cannot
  run from a packed tree even in principle because they import `../src/…`. **Consequence for 2b:** packed-install
  verification can assert the artifact's BEHAVIOUR and can run these arms from the repo, but can never cite them as
  artifact-internal evidence — every such claim must be labelled *artifact-behaviour* or *repo-arm reading*. **And one
  exception, measured on the packed tree (so nobody generalises the bound to "no test ships"): the SKILLS corpus ships its
  own SEVEN `*.test.*` files — `skills/programming/…/check-no-excuse-rules.test.ts` plus six under
  `skills/visual-qa/scripts/` — while `find dist/mpd-package/packages -name '*.test.*'` is 0.** Corpus assets are not
  plugin instruments; the bound above is about the wave's instruments, and it holds for every one of them.
- **The count discipline, in the review seat's own form:** *a count is only meaningful with its UNIT and its REVISION* —
  the 15/39 file census is identical across the two `t37`-adjacent revisions, which is exactly why files alone cannot tell
  a reader what they are looking at. This is why §2 now quotes the package-test reading with both revisions.
- **The shipped half, confirmed post-pack (lane C's reading, `closure-after-repack.log`):** closure exit 0 with
  `1181 compared, 1181 identical, 0 drift, 0 expected-after-pack` (0 FAIL) at stamp `2026-09-17T08:55:57.244Z`, and
  `dist/mpd-package/agent-references/troubleshooting.md` **byte-identical to its source** (`5f0b4b3659bad486…`) carrying
  both new rows — the number moved **by the pack, not by a rewrite**.

**Two further UNIT-ladder instances, enumerated where they live rather than duplicated here:** lane A filed, in
`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §6, a table for two slips of the same family that
had no durable record until then — **byte-vs-character** (a "+412" where the delta is **+416 BYTES**, an em dash costing
three bytes for one character) and a **mis-added line census** (16 reported as 15) — each with the wrong value, the right
value, the UNIT that separates them and the mechanism that produced the error. The report's family list stays at **eight
SHAPES**; the instances are enumerated in that lane record, which is the pointer to use.

**[post-`t42`] Two additions after the round-3 verdict, marked so the boundary stays explicit:** (i) §9(a)'s enumeration
now reads *"as §A-25's items read"* — the exact form the reviewer recorded as a note (the log labels SECOND and THIRD
explicitly and names a FOURTH in passing, with **no FIRST label**), with each entry naming the item it comes from;
(ii) the shipping bound gained its measured **EXCEPTION** — the skills corpus ships its own **seven** `*.test.*` files
(`find dist/mpd-package -name '*.test.*'` → 7; the same find under `packages/` → 0), so *"no test ships"* is false while
*"no plugin ARM travels"* holds. **`t42`'s PASS judges the 275-line revision; these two additions are post-verdict and are
the only changes since it.**
