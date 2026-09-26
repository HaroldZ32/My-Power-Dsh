# Wave 1 (P1 friction register) — integration report

**Written by:** `t35` (packaging-engineer, integration seat) · **attempt 7** · `2026-09-17`
**Scope:** `.mpd/TODO.md` (register verdicts) + `evidence/wave1-integration/` (this report, the sweep logs, the
readings). Nothing was committed; no `packages/**` or `skills/**` file was touched by this task.

---

## 1. Method and the settle discipline

The sweep ran on a **settled tree**: two pins 45 s apart (`settle-pin-1.log`, `settle-pin-2.log`) are
byte-identical except their timestamp line.

| pinned at | git dirty entries | VENDOR_LOCK.json | skills corpus | artifact | instrument |
|---|---|---|---|---|---|
| 05:25:30Z | 284 | `6ca531d2b20afb19` | 323 files, newest `skills/dsh-qa/SKILL.md` 05:24:26Z | manifest `eaa0919702bf5b33`, 1,190 files, stamp 05:19:48Z | `858cd130…` |
| 05:26:15Z | 284 | identical | identical | identical | identical |

Raw sweep output: `gate-<name>.log` + `gate-<name>.exit` beside this file.

**Sources, grepped at write time (never quoted from memory).** The wave's journal
`.mpd/plans/friction-p1-wave.md` runs to **`L185`** with **four gaps: `L132`, `L149`, `L150`, `L182`** — the
captain's dispatch named three (it predated `L182`), and the grep is what settled it. Entries this report rests on:
`L135`–`L137`, `L139`–`L147`, `L148`–`L155`, `L156`–`L166`, `L167`–`L172`, `L173`–`L175`, **`L176`** (the range
discipline itself), **`L177`** (the five-rung fold ladder), `L178`/`L180`/`L181`/`L183` (the runner-label defect,
`t73`'s repair, `t74`'s verification), `L184` (`t61` PASS — the artifact may ship on the final bytes) and `L185`
(the wave committed and merged). The register's own citation was corrected to the same range
(`.mpd/TODO.md` §8 preamble) rather than left at `L117`–`L176`.

## 2. Merged-tip gate sweep (per-gate exit codes, unpiped)

| # | gate | exit | reading |
|---|---|---|---|
| 1 | `bun test packages` | **1** | **882 pass / 1 fail** across 883 tests, 164 files (27.5 s). The single failure is the T-07 race pin — see §4. **RED, reported as-is.** |
| 2 | `bun run typecheck` | 0 | `tsgo --noEmit`, clean |
| 3 | `bun run test:qa` | 0 | **45/45**: 45 `[test:qa]` case invocations, 0 `FAILED`, loop closed with `[test:qa] all self-tests passed` (counted from the log, not assumed). **Both states named:** the pre-re-pin reading was **44 PASS / 1 FAIL with a fail-fast abort** at the stale-lock lane, whose own message named the pending re-pin as the cause — superseded by the landed re-pin (`evidence/dsh-qa/final-skills-freeze/agent-teams-messaging-postrepin-command.md` + `selftest-loop.log`). |
| 4 | `bun run verify:vendor` | 0 | `[verify-vendor] PASS` (the re-pin landed; §6) |
| 5 | `bun run verify:rows` | 0 | `25 row ids match the bundle patch insert list` |
| 6 | `bun run verify:docs` | 0 | `pairs=37 failed=0 violations=0 exempt=17 — PASS` |
| 7 | `node scripts/verify-pack-closure.mjs` | 0 | all rows resolve; `18 PLUGIN_PKGS + 4 MCP_PKGS entries all exist`; root assets present; `root files 1/1`; `declared packages 23/23` |
| 8 | `node scripts/patch-agent-teams-fixes.mjs --check` | 0 | `already applied: 73 mpd delta region(s) across 9 adopted file(s)` |

Gate 1 is the wave's one red and is **not** smoothed: `t35` does not mark T-07 closed (§4).

## 3. Per-lane integration (what landed · what review falsified · what remains · bounds)

Source of the verdicts: the lane tasks `t8`–`t23`, their verification tasks `t25`–`t28`, and the independent
reviews `t29`–`t34`; the register rows with evidence paths live in `.mpd/TODO.md` §8.2–§8.6.

**Register partition — re-derived AND cross-checked, not asserted** (`reconcile-register.py` →
`register-partition-check.{log,json}`, both directions CLEAN; `.mpd/TODO.md` sha256 `26604c7488b15419…` at write
time). Direction 1 (internal): §8.2 fixed **36** + §8.3 already-fixed **3** + §8.4 partial **5** = **44** touched
originals; §8.5 lists the **16** untouched P2 items; 44 + 16 = **60**, with 0 originals missing a disposition,
0 duplicates, 0 extra. §8.6 appends **20** new rows (T-61…T-72, T-75…T-82), accounted separately from the
original-60 partition, with `T-67` carried in §8.5 as the new row deferred after partial work. Direction 2
(coverage): every §8.2 item carries an implementation task in the team record's own `coverageOf`, and no §8.5 item
does — disagreements **0**.
**Three defects in my own drafts, caught by these checks and corrected rather than smoothed over.** (1) Draft 1
claimed 31 fixed / 40 touched against its own 34-row §8.2 table, named **no** disposition for **`T-52`**, and folded
the new row `T-67` into the original-60 partition. (2) Draft 2 (34 fixed / 42 touched) listed **`T-52`** and
**`T-56`** as untouched — but lane B2 fixed T-52 (append-only terminal repair, pinned green by `t31`'s independent
review) and lane C3 fixed T-56 (the QA case imports the product's tool-name formula instead of copying it;
`t26`-verified, `t32`-reviewed) — direction 2 is what caught both. (3) The correction is on disk: both are now
§8.2 rows with their evidence paths, and every count in §8.1 is derived from the lists. `build-result.py`
regenerates `result.json`/`output.log` from the on-disk readings and from the reconciliation's JSON twin, so no
number in this record is retyped from prose.

**Lane A — watchdog redesign (`T-48`, `T-16`, `T-17`, `T-18`, `T-19`, `T-20`).**
*Landed:* the four-state channel fold, §3 ladder, §4 report-only degradation, PARKED derivation and the status
source (`t8`/`t13`); generation-scoped self-clearing holds; three-layer knob agreement + honest restart
disclosure (`t10`); the RED→GREEN driver (`t24`). *Falsified by review:* the KICK clause has **no instrument** —
`t29` recorded V1 (medium) and the register now carries `T-48` as **PARTIAL** with that bound in words; `t30`
reproduced every other reading in fresh processes (19/0, `settled=true`, same four fingerprints). *Remains:* the
kick arm (wave 2). *Bounds:* single observation windows; the driver's red tree is a reconstruction, not a live
incident (upper bound).

**Lane B — adopted agent-teams deltas (`T-01`…`T-05`, `T-07`, `T-09`, `T-10`, `T-12`, `T-46`, `T-49`).**
*Landed:* D2 (both tool-boundary hold guards deleted; claim/update succeed under a live hold), the contract tool
on every seat, amend without takeover + stamp, `edit_plan` quality preservation, artifact/append channel,
read-only durable path, ownership query + wave rollover (`t9`/`t14`/`t19`/`t20`). *Falsified by review:* `t31`
found **no false greens**, but it reproduced the D2 half with its own negative control (re-injecting the deleted
guard makes the same call fail) and confirmed dispatch stays held (`deliveries: 0`). *Remains:* the wake-noise
half of `T-05` (PARTIAL, §8.4). *Bounds:* `T-07`'s regression pin is an **UNSTABLE ARM** (one red under load, four green isolated, 883/0 on the
staged tree) — "load-sensitive" is an inference, not a measured mechanism (§4).

**Lane C — QA baseline (`T-58`, `T-59`, `T-60`, `T-53`, `T-32`).**
*Landed:* manifest-driven runner that continues past an unavailable lane (`t15`), credential plumbing, the
immutable-by-default evidence write (`t21`), and the 33-entry board: **31 pass / 0 unavailable / 3 classified
reds**, every verdict pinned `54585cab…` (`t26`). *Falsified by review:* `t32` reproduced the runner's four exit
codes on its own fixture, ran two LIVE lanes green, and scanned 325 files for the host credentials with **0
hits**; no real lane reports `unavailable`, so nothing hides behind one. *Remains:* the three classified reds are
recorded, not repaired (`agent-teams-adopt` zero-exercise refusal, `agent-teams-dispatch` zero-exercise, one
live-model variance).
**`t32`'s two findings, folded (O1 into the register, O2 into this gloss).** **O1 (medium) — T-53 is
INSTRUMENT-scoped:** exactly **1 of 45** lane drivers imports `immutable-output.mjs` (the checker; its refusal
works), while an unmigrated driver (`team-watchdog-fault.mjs --out <dir>`, run twice) **rewrites its own
`result.json`**. No `t21` claim is false — its criterion named "the two named drivers" and both refuse — so the
honest form is a one-line bound (§8.2's T-53 row + §8.7) **and** a wave-2 coverage row (**T-83**). **O2 (low) —
the runner's reason-matcher** drew `reason=unauthorized` from a **PASSING** step (disclosed by `t26`); the
mandatory gloss, kept where the three reds are described: **`agent-teams-adopt` is red on `archive`, a
headless-turn artefact; the board's `reason=unauthorized` names text found in a PASSING step**. **O2's carrier is
`t73`** — kind `repair`, `sourceTaskId t32`, inScope `scripts/run-qa-lanes.mjs` — and it is **LANDED**
(`completed`): the runner reads **`6bea2b38de2a…`** and its reason LADDER now asks the lane's own structured step
map for the failing step **before** any whole-log text scan (rungs 2/3 in `scripts/run-qa-lanes.mjs` with their own
`--self-test` fixtures). The diagnostic spec is on disk at
`evidence/dsh-qa/suite-runner/2026-09-17T05-22-19Z-reason-label-defect/result.json`; **`t74` independently
verified the repair (verdict pass**, `evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify`;
`L180`/`L181`/`L183`).
*Bounds:* one sweep on one host; the classified reds are lane-expectation readings; **the runner's bytes were
`f60ef2b5…` — the ONLY copy on disk** (git holds no earlier revision and the author's `d90dc10b…` build is
unrecoverable), so every reading exercised the on-disk bytes, never a reconstruction.

**Lane D — docs & gates (`T-22`, `T-31`, `T-33`, `T-37`, `T-39`, `T-40`, `T-57`).**
*Landed:* the budget split (43,258 B, `truncated []`), the three new gates with their negative arms, the manual
wiring, and the cwd-hermetic test. *Falsified by review:* `t33` passed the lane with **three non-blocking
findings**, all three now register rows: **F1 → T-69** (lane-produced `--dump-config` artifacts still carry no
banner), **F2 → T-70** (`verify:gates` short-circuits, live while two vendor blockers existed — now one), **F3 →
T-67** (the docs name the gate but not the build form). *Remains:* those three rows. *Bounds:* `t33` could not
execute the T-57 case and read the executor's logs and the test source instead.

**Lane E — packaging (`T-35`, `T-36`, `T-45`, `T-51`).**
*Landed:* the artifact ships `templates/` + `docs/` + `agent-references/` + the extension CLI with its compiled
validator, and the closure rule is loud (`t11`); `t70` added the authoring contract `EXTENSIONS-FOR-AGENTS.md` as
a REQUIRED packed root file and the declared-package existence arm. *Falsified by review:* `t34` reproduced
everything and found **no false green**, seeding its own two omissions (template manifest removed → `TEMPLATES` +
`TREE-DRIFT`; half doc pair → `DOC-PAIR`). *Remains:* `T-63`/`T-65`/`T-76` (content-staleness, completeness,
presence-vs-bytes for `agent-references/`). *Bounds:* the packed readings are stamp-bound (§5).

**Lane F — harness-close + adapter (`T-21`, `T-23`, `T-24`, `T-26`, `T-43`, `T-50`, `T-54`, `T-55`).**
*Landed:* `mpd-bg` (`run`/`probe`/`check-write`/`reload-check`, 13 self-test arms), the workmate-home guard, the
documentation pointers, and lazy adapter resolution with an honest two-mode warning (`t12`/`t23`). *Falsified by
review:* `t34` reproduced `mpd-bg` and the workmate suite (28/0) with the real `~/.mpd/workmate` byte-identical
before and after; `t28` found **no false green** and kept `T-50`'s production-boot observation as a **bound**.
*Remains:* the static-read bounds on `T-50`'s window. *Bounds:* six consecutive clean boots (6/6) bound frequency,
not impossibility.

## 4. The one red: the T-07 race pin

- `bun test packages` → **1 fail / 882 pass**: `packages/mpd-agent-teams-plugin/self-fix-tests/terminal-dispatch.test.mjs`,
  arm **“T-07 THE RACE: a task that becomes terminal before the wake is never carried by a wake”**. The failed
  assertion is its stated invariant (`deliveries.filter(terminal statusAtDelivery) === []`); the received value
  carries one delivery with `statusAtDelivery: "completed"` for `t1`.
- **Three isolated repeats of the same file: 4/4 pass each** (`t07-repeat-{1,2,3}.log`).
- **The classification is an INFERENCE, not a measured mechanism:** one arm failed once under load
  (`terminal-dispatch.test.mjs:176`) and passed **four times green in isolation** — "load-sensitive" is the
  reading's own suggested explanation, and a further observation is consistent with an intermittent arm rather than
  with a broken guard: the captain's staged-tree sweep immediately before the commit read **883 pass / 0 fail**
  (plan `L185`), i.e. the same suite fully green on the staged tree.
- The two claims stay SEPARATE: **`T-07`'s content stays ALREADY-FIXED** (it predates the wave) while its **ARM is
  not a stable pin** — neither claim borrows the other's authority. Both readings are preserved
  (`gate-test-packages.{log,exit}`, `t07-repeat-{1,2,3}.log`).

## 5. Packed-artifact readings (stamp-bound, re-derived)

| reading | value |
|---|---|
| manifest anchor | `eaa0919702bf5b334332d5b701b6a2a85ab5aa0a84cc4ccd9b4faa6636ebf61c` |
| stamp | `2026-09-17T05:19:48.266Z` (the wave's earlier reading was `04:37:59.994Z`) |
| files | 1,190 |
| twin scan (instrument `858cd130…`, hash paired) | `identical=1187 drift=0 missing=0 afterPack=[] byDesign=2 noTwin=1 ok=true` |
| closure gate | exit 0 (see §2 gate 7) |
| relative links | `10 (resolving: 10, broken: 0)` |

The **anchor is unchanged across the two stamps** (`04:37:59.994Z` → `05:19:48.266Z`), and a scratch re-pack of
the same inputs is **byte-identical** to the artifact (1,190 == 1,190 files, per-file `sha256sum` diff EMPTY) —
i.e. the packer's content determinism is measured, not assumed.

**Provenance of the `04:37:59Z` artifact — it was the WAVE's pack, not a stray one.** It was invoked by
`skills/dsh-qa/scripts/extension-lifecycle.mjs` inside the sweep's own chunk `c1` — the only lane that invokes the
packer — so no outside writer produced it; the later pack that moved the stamp to `05:19:48.266Z` left the anchor
unchanged, and the byte-identical scratch re-pack makes a further re-pack a no-op on these inputs (the question was
raised because a `cp -al` recomposition had touched the artifact earlier in the wave; that is why the record keeps
both stamps and the anchor).

**Who packed the stamp that moved (`05:19:48.266Z`)?** The QA lane's `extension-lifecycle` case —
`evidence/extensions/extension-lifecycle/2026-09-17T05-18-51.805Z/result.json` records `packExit: 0`,
`packedRoot …/dist/mpd-package`, `packerExitGated: true`, and its log stages **1,190 files** — the same driver that
produced the `04:37:59.994Z` stamp (plan `L152`). So: two packs, one driver, the same anchor; neither pack was
this seat's, and none of them was a manual re-pack.

## 6. `VENDOR_LOCK.json` — the re-pin delta (reported, not written by this task)

- Corpus delta the re-pin needed: **`assets.skills` 319 files / `c0dab8641697…` → 323 files /
  `68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c`** (the wave's `skills/**` work: four new
  files plus edited lanes; the corpus is frozen, its single writer's window closed).
- **It has landed** (the captain's single step): `VENDOR_LOCK.json` is now `6ca531d2b20afb19`, its locked skills
  asset reads `fileCount: 323` / `treeSha: 68318157…`, and `bun run verify:vendor` → `PASS` (§2 gate 4).
- This task wrote **no** `VENDOR_LOCK.json` content: no `skills/**` file was touched here (out of scope).
- **The delta note is SATISFIED, not pending.** Beyond `verify:vendor` green, the decisive proof is the stale-lock
  lane restored to green: `agent-teams-messaging --self-test` now exits 0 where its own failure message had named the
  pending re-pin as the cause. `VENDOR_LOCK.json` stayed byte-identical (`6ca531d2b20afb19…`) across every later
  edit — which is exactly why this sweep read `verify:vendor` green on the worktree.

## 7. Paths for the captain's commit (deliberate staging)

Full list: `changed-paths.txt`, regenerated at write time with a header naming its command (`git status
--porcelain`, read-only) and the XY legend. **It reports 4,305 entries because the index has been staged since the
first capture** (4,185 `A ` + 104 `M ` + 7 `AM` + 9 `??`) — the earlier 284-entry pre-staging view no longer
described the tree, so the file was regenerated rather than left stale.

| top-level (staged set) | entries | note |
|---|---|---|
| `evidence/**` | 4,172 | includes **2,686 `/raw/` paths** swept in when the evidence tree was staged — see warning 1 |
| `packages/**` | 67 | dists + lib + tests |
| `skills/**` | 32 | the frozen corpus change the re-pin rides with |
| `scripts/**` | 9 | the new gates + the packer/closure changes |
| `docs/**` | 8 | EN + zh-CN pairs |
| root/other | 6 | `VENDOR_LOCK.json`, `package.json`, `.gitignore`, `AGENTS.md`, `EXTENSIONS-FOR-AGENTS.md`, `agent-references/` |

**Four staging warnings — the captain decides before committing.**
1. **2,686 staged `/raw/` paths (≈29 MB in one directory)** are regenerable per-check raw output:
   `evidence/pack-closure/impl/20260917T011849Z/raw/final` alone is **2,410 paths / 29,186,126 bytes** (this seat's
   own closure evidence), plus ~2.6 MB of watchdog `lane/*/raw` per-run sandboxes. `.gitignore` does not cover them
   (only `evidence/**/raw/scratch/` is), so staging the evidence tree sweeps them in. Recommendation: unstage that
   tree (and decide the watchdog `raw/` copies), or add one ignore rule.
2. **7 files changed after they were staged** (`AM`) and need a re-add to be committed as they now stand: this
   task's `changed-paths.txt`, `output.log`, `register-partition-check.{log,json}`, `result.json`,
   `result.json.sha256`, plus the QA lane's `evidence/dsh-qa/full-sweep/t26-attempt7/RED-CLASSIFICATION.md`.
3. **`.mpd/TODO.md` is NOT tracked** (`.gitignore:21:.mpd/`): the register — every §8 verdict and every correction
   in this report — is workspace state and never enters the commit. Read it from disk.
4. **Do not stage the 8 untracked `.qa-*` lane scratch paths** (`T-77`): `.qa-before-dir`, `.qa-run-stamp`,
   `.qa-t15-dir`, `.qa-t17-after`, `.qa-t17-after-runner`, `.qa-t17-dir`, `.qa-t17-final`, `.qa-t21-dir`.

**Post-commit status of this section (read after the captain landed the wave).** The wave is committed as
`684dd3f` + merge `20a635e` (4,299 files / 863,737 insertions) — and warning 1 landed with it: `git ls-files`
counts **2,428 tracked `evidence/pack-closure/…/raw/final` paths** and **4,582 tracked `/raw/` paths** in total,
so the regenerable raw trees are now in `dev`'s history. Removing them means a history rewrite before the branch is
pushed (captain's call; tag a backup ref first), otherwise they stay as a 29 MB+ artifact of this wave. The
corrections in this report are **NOT** in that commit: at write time the worktree shows
`M REPORT.md, changed-paths.txt, output.log, result.json, result.json.sha256` plus the untracked
`POST-COMPLETION-append-channel-unreachable.md`, so a small follow-up commit is needed for the corrected numbers.
`.mpd/TODO.md` stays untracked by design (warning 3).

**The single re-pin rule is satisfied:** the corpus change and `VENDOR_LOCK.json` land in the same commit, and
this wave has exactly one re-pin.

## 8. What this task did NOT do / honest bounds

- **Nothing was committed** (no git write command was run; the captain alone commits).
- The register verdicts rest on the lanes' evidence and the reviews' readings; where a lane's claim came from a
  static read, a single observation window, or a 6-boot sample, that bound is carried in `.mpd/TODO.md` §8.7.
- The sweep is **one run on one host** at the pinned settle window; gate 1 is red and quoted as red.
- The `T-07` red: **one** aggregate observation, three isolated repeats and the commit-time staged-tree sweep
  (883/0) — "load-sensitive" is an inference about the arm, **not** a measured mechanism, and the sample is smaller
  than a frequency claim needs; the register carries it as a finding, not a diagnosis.
- The artifact readings are valid for the stamp quoted; a later pack moves the stamp (the anchor should not move,
  and if it does, that is a finding).

**Invariants of `t73`'s repair — measured here, not assumed.** (1) **Pack- and corpus-neutral:** the repaired file
is `scripts/run-qa-lanes.mjs`, which is neither under `skills/**` nor named by the packer (the packer copies only
`scripts/install-mcp.mjs` and `scripts/mpd-ext.mjs`, and `dist/mpd-package` contains **no** `run-qa-lanes.mjs`), so
`VENDOR_LOCK.json` is untouched: its sha256 reads `6ca531d2b20afb19…` and the skills pair `323 files /
68318157344aafec…` — byte-identical to the settled reading taken before the repair, i.e. the landed re-pin stays
exactly as it landed. (2) **It cannot move a lane's meaning:** the change is label PRECISION only (which failing
step a red names), pinned by an arm inside the runner's own `--self-test` (rung 2's fixture prints the same fence
string while a step is PASSING), and `t74`'s independent replay confirmed the untouched rungs stayed untouched.
