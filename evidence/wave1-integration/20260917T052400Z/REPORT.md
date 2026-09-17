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

## 2. Merged-tip gate sweep (per-gate exit codes, unpiped)

| # | gate | exit | reading |
|---|---|---|---|
| 1 | `bun test packages` | **1** | **882 pass / 1 fail** across 883 tests, 164 files (27.5 s). The single failure is the T-07 race pin — see §4. **RED, reported as-is.** |
| 2 | `bun run typecheck` | 0 | `tsgo --noEmit`, clean |
| 3 | `bun run test:qa` | 0 | `[mpd-ext] ok` · `[test:qa] all self-tests passed` — the stale-lock lane that reddened pre-re-pin is green |
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
half of `T-05` (PARTIAL, §8.4). *Bounds:* `T-07`'s regression pin is load-sensitive (§4).

**Lane C — QA baseline (`T-58`, `T-59`, `T-60`, `T-53`, `T-32`).**
*Landed:* manifest-driven runner that continues past an unavailable lane (`t15`), credential plumbing, the
immutable-by-default evidence write (`t21`), and the 33-entry board: **31 pass / 0 unavailable / 3 classified
reds**, every verdict pinned `54585cab…` (`t26`). *Falsified by review:* `t32` reproduced the runner's four exit
codes on its own fixture, ran two LIVE lanes green, and scanned 325 files for the host credentials with **0
hits**; no real lane reports `unavailable`, so nothing hides behind one. *Remains:* the three classified reds are
recorded, not repaired (`agent-teams-adopt` zero-exercise refusal, `agent-teams-dispatch` zero-exercise, one
live-model variance). *Bounds:* one sweep on one host; the classified reds are lane-expectation readings.

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
- Classification: **load-sensitive** — the invariant was observed violated once under full-suite concurrency and
  holds in isolation. Recorded as a wave-2 finding (`T-07` is NOT closed on a flaky pin); both observations are
  preserved.

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

## 6. `VENDOR_LOCK.json` — the re-pin delta (reported, not written by this task)

- Corpus delta the re-pin needed: **`assets.skills` 319 files / `c0dab8641697…` → 323 files /
  `68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c`** (the wave's `skills/**` work: four new
  files plus edited lanes; the corpus is frozen, its single writer's window closed).
- **It has landed** (the captain's single step): `VENDOR_LOCK.json` is now `6ca531d2b20afb19`, its locked skills
  asset reads `fileCount: 323` / `treeSha: 68318157…`, and `bun run verify:vendor` → `PASS` (§2 gate 4).
- This task wrote **no** `VENDOR_LOCK.json` content: no `skills/**` file was touched here (out of scope).

## 7. Paths for the captain's commit (deliberate staging)

Full list: `changed-paths.txt` (284 entries: **104 modified + 180 untracked**).

| top-level | entries | note |
|---|---|---|
| `evidence/**` | 154 | lane + review + sweep evidence (this wave's proof) |
| `packages/**` | 67 | dists + lib + tests |
| `skills/**` | 32 | the frozen corpus change the re-pin rides with |
| `scripts/**` | 9 | the new gates + the packer/closure changes |
| `docs/**` | 8 | EN + zh-CN pairs |
| root files | 6 | `VENDOR_LOCK.json`, `package.json`, `.gitignore`, `AGENTS.md`, `EXTENSIONS-FOR-AGENTS.md`, `agent-references/` |
| `.qa-*` scratch | **8** | `T-77`'s staging landmines — **do not stage**: `.qa-before-dir`, `.qa-run-stamp`, `.qa-t15-dir`, `.qa-t17-after`, `.qa-t17-after-runner`, `.qa-t17-dir`, `.qa-t17-final`, `.qa-t21-dir` |

**The single re-pin rule is satisfied:** the corpus change and `VENDOR_LOCK.json` land in the same commit, and
this wave has exactly one re-pin.

## 8. What this task did NOT do / honest bounds

- **Nothing was committed** (no git write command was run; the captain alone commits).
- The register verdicts rest on the lanes' evidence and the reviews' readings; where a lane's claim came from a
  static read, a single observation window, or a 6-boot sample, that bound is carried in `.mpd/TODO.md` §8.7.
- The sweep is **one run on one host** at the pinned settle window; gate 1 is red and quoted as red.
- The `T-07` red is classified load-sensitive on **one** aggregate observation plus three isolated repeats — a
  smaller sample than a frequency claim needs; the register carries it as a finding, not a diagnosis.
- The artifact readings are valid for the stamp quoted; a later pack moves the stamp (the anchor should not move,
  and if it does, that is a finding).
