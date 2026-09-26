# Wave-2b LANE D — executable acceptance (r-D, frozen BEFORE any implementation)

**Seat:** Architect (requirements, read-only), through the platform artifact channel — the only write a denied seat has.

**Authority:** `.mpd/plans/friction-p2-wave-2b.md` — §4 (lane D row + the §4.1 `skills/**` rule), §5 (lane D table), §6 (the DAG, including
`impl-D` depends on `impl-B`), §7 (serialization: §7.1 the single writer and the single re-pin, §7.5 the `./` rule), **§8's `- D:` line is
SUPERSEDED by A2.1**, §9 (evidence convention), and **A2.1** (the verify substitute), **A2.6** (the D-after-B dependency and the pack order).
Register: `.mpd/TODO.md`. Lane inputs used as INPUT: lane A's note
`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §4e (the six addressing parameters) and §4g (the derived-value rule);
lane C's acceptance (the corpus legs it SPECs here).

**Moment of this freeze:** the `t12` record's own timestamps — `createdAt` 1789653804622 = 2026-09-17T14:03:24Z, `updatedAt`
1789654802837 = **2026-09-17T14:20:02Z** (its claim; read from `.mpd/team/friction-p2-wave/team.json` read-only). The file was written after
that instant; the stamp names the CLAIM, because this seat has no shell and will not invent a clock.

**What is frozen:** the six rows this lane owns, in register order — **T-25** (reader half; §3 detail, §8.5), **T-69**, **T-77** (driver half),
**T-80** (arms), **T-74**, **T-89** (all `§8.6`) — plus **the wave's ONE re-pin** and the single-writer PRECONDITION.

---

## 1. THE SINGLE-WRITER PRECONDITION (stated as a condition, not a promise)

**This lane is the wave's ONLY `skills/**` writer** (plan §4.1). Every corpus edit in 2b arrives here: lane C SPECs its two corpus legs (the
T-25 reader arm and the `--live` pin's arms); **B2 lands the RULE for T-80 while THIS lane lands the arms**; lane B's `.gitignore` SHAPE and this
lane's declared scratch-root convention must AGREE (T-77's two halves); nothing else may write the tree.

**The wave's ONE re-pin is part of THIS lane's deliverable chain, and it is the captain's hand:** the sequence is
`node scripts/repin-vendor.mjs --check` → `node scripts/repin-vendor.mjs --write --i-know-this-is-the-captains-step` →
`node scripts/verify-vendor.mjs`, in the SAME COMMIT as the corpus change that invalidated the lock (plan §7.1, §11). The helper REFUSES the
repository's own lock without the captain's marker, so the lane prepares and the captain writes.

**THE CORPUS DIGEST IS RE-DERIVED AT THE WRITE, NEVER QUOTED:**
1. the value comes from a FRESH `node scripts/repin-vendor.mjs` dry run taken immediately before the write;
2. every superseded preview is NAMED as superseded when the record mentions it (wave 2a retired THREE previews in one afternoon);
3. **the RAW-BYTES value is FORBIDDEN**: the helper prints `locked` / `computed (LF)` / `raw-bytes … <- NEVER write this one`, and its
   self-test asserts that the value it writes equals the LF-normalized one — so only the `computed (LF)` value may be written or quoted, and a
   record that carries the raw-bytes number is a defect even when the lock is right.
4. **THE RE-PIN CAUSE IS NAMED EXACTLY** (2a r5's precedent): the changed corpus paths. In 2b that is the drivers plus
   `skills/dsh-qa/cases.json`; the two non-corpus paths that ride the same wave (`scripts/run-qa-lanes.mjs` — lane B's runner half of T-89 —
   and `scripts/reconcile-register.py`) are NOT corpus and must not be cited as the cause.

---

## 2. VERIFY — A2.1's substitute (and the ONE command this lane must never carry)

- `node scripts/run-qa-lanes.mjs --check-drift` (the drift ledger: manifest vs disk, and the `immutabilityGuard` census)
- `node scripts/run-qa-lanes.mjs --only <the corpus lanes named BEFORE any edit>` — the selection is DECLARED in the task's record BEFORE the
  first edit, and the record carries the list; `--only` accepts both spellings and refuses an unknown case (exit 3)
- the modified drivers' own `--self-test`
- a modified driver's real case run where the row demands one (e.g. the T-25 arm's store read), with an explicit output root

**`bun run test:qa` IS FORBIDDEN HERE by name** (and `test:qa:all` with it): a `test:qa` sweep self-tests every `skills/dsh-qa/scripts/*.mjs`, and
`agent-teams-messaging.mjs` asserts the corpus against `VENDOR_LOCK.json` — which THIS lane's own first edit invalidates until the captain's
single re-pin, so the command cannot be green in-window (A2.1). **A2.1's round-2 correction is carried too:** the lock-asserting lane stays OUT
of the `--only` set, because `expected: "reported"` does NOT exempt a verify command at the platform (`verify failure must fail the task`); that
red is recorded in EVIDENCE only.

**Also forbidden (integration-only):** `bun run verify:gates` · `node scripts/verify-vendor.mjs` · `node scripts/verify-dist-fresh.mjs` ·
`bun run typecheck`.

---

## 3. PER-ROW ACCEPTANCE

### T-25 (READER HALF) — `§3` detail, `§8.5` P2 16 · friction · "Session logs are concatenated-zstd-frame containers"
- **DELIVERABLE:** the corpus documents the SINGLE frame-by-frame reader (`skills/dsh-qa/scripts/lib/session-evidence.mjs`:
  `readSessionEvents` / `findToolCall` / `recordedToolNames` as the declared entry points) and the NAIVE-READER FAILURE is pinned as an arm.
- **OBSERVABLE:** the arm reports, from the SAME store at the same moment, a naive read (`ONE zstdDecompressSync`) returning **0 events** and
  the reader returning **N > 0** — the failure, not the conclusion, is the evidence.
- **DECISIVE:** both readings in one record, with the store path and the reader's module path named.
- **NEG CONTROL:** the arm must REDDEN if the reader regresses to a single-frame read; and the record states that "0 events" from a naive read
  is NOT proof of an empty log.
- **EVIDENCE:** `evidence/dsh-qa/<slug>/<stamp>/`. **Lane C carries the instrument leg**; this lane carries the documentation + the arm.

### T-69 (LANE HALF) — `§8.6` · trap · "A QA lane's own `--dump-config` output carries no composition banner"
- **PREREQUISITE, measured as ALREADY SATISFIED:** the bannered wrapper exists — `scripts/dump-config.mjs` prints `COMPOSITION ONLY — rows
  composed, no plugin code executed.` before the child's output and a recap after it, with `--quiet`/`--json` variants and four self-test arms
  (success, failing child, missing binary, `--json`). So "after B lands the banner" is history, not a dependency.
- **DELIVERABLE:** every corpus lane that composes a profile invokes the WRAPPER, not the raw `dsh --dump-config` flag.
- **OBSERVABLE:** a corpus scan reports ZERO raw-flag invocations outside the declared contrast sites; the wrapper is what the lanes run.
- **DECISIVE:** the scan's own output names each site it inspected; a fixture carrying a raw invocation reddens it.
- **NEG CONTROL:** a CONTRAST passage (the manual's sentence that contrasts the flag, and the wrapper's own warning text) must not be flagged —
  the scan declares its exceptions BY NAME, never by count.
- **EVIDENCE:** the scan + the fixture run. Note `scripts/dump-config.mjs` is in NO 2b write set: a change to the banner itself is a HOP (lane B).

### T-77 (DRIVER HALF) — `§8.6` · friction · "QA scratch paths at the repo root are ignored BY NAME"
- **DELIVERABLE:** the drivers' scratch-root CONVENTION declared in the corpus as ONE shape, agreeing with lane B's `.gitignore` pattern.
- **OBSERVABLE:** a scratch dir created by a driver matches the pattern (`git check-ignore -v ./<path>` names it) while a near-miss
  legitimate root path does not.
- **DECISIVE:** the pair (shape match / near-miss) asserted with `git check-ignore` (read-only).
- **NEG CONTROL:** the near-miss must NOT be ignored. **The agreement with lane B is a PREREQUISITE, not an assumption** — if B's pattern and this
  lane's declared root disagree, the two lanes must settle it before either lands.
- **EVIDENCE:** both readings.

### T-80 (ARMS) — `§8.6` · gap · "A driver header's `A<n>` claims are prose, unchecked against its own assertion keys"
- **DELIVERABLE:** the corpus ARMS that assert each driver header's `A<n>` claims against the driver's own assertion keys (`add("A<n>", …)`);
  **the RULE is lane B2's** (`scripts/check-driver-headers.mjs` or the checker's subcommand) — this lane lands the arms that the rule checks.
- **OBSERVABLE:** per driver, the header's claimed keys and the produced keys agree; a claimed-but-unasserted key is reported with the driver
  path and the key.
- **DECISIVE:** the arm run over the corpus reports agreement per driver; a seeded mismatch reddens.
- **NEG CONTROL:** the near-miss (a key produced but not claimed) is reported per the policy B2 states — the two lanes must not disagree about
  the policy, and the arm's assertion name is quoted rather than paraphrased.
- **EVIDENCE:** the arm run + the seeded mismatch.

### T-74 — `§8.6` · trap · "A verification that runs someone else's EVIDENCE DRIVER writes into that task's window"
- **DELIVERABLE:** (i) every driver that can be invoked from OUTSIDE its own task requires an explicit output root (the verified `--out`
  mitigation) or defaults to a caller-visible path; (ii) the rule sentence lives in the lane docs (`skills/dsh-qa/SKILL.md`), beside T-53's
  immutability rule: *"a verification that runs another task's driver pins its output with `--out` into its own evidence dir"*.
- **OBSERVABLE:** a driver invoked from outside its own task with an explicit `--out` leaves the foreign directory BYTE-IDENTICAL; without
  `--out` it does not silently write there.
- **DECISIVE:** a before/after digest of the foreign directory across a cross-task invocation (the mitigation measured in the register row).
- **NEG CONTROL:** the no-`--out` invocation must either refuse or land in a caller-visible path — never silently inside the other window; and
  the rule sentence must exist in the docs (a byte reading).
- **EVIDENCE:** the digest pair + the doc reading. The measured instance is the foreign `run-<ts>` directory that appeared 12 s before another
  seat's capture.

### T-89 — `§8.6` · trap · "A test runner's positional path argument is a SUBSTRING FILTER"
- **DELIVERABLE (THIS lane's half — the CORPUS):** every path-qualified command in the corpus carries the leading `./`; a driver that keeps a
  scratch copy NAMES its path AND the exact file count the clean command discovers.
- **OBSERVABLE:** the corpus's invocations use `./` forms; no bare positional path can reach a copy lying elsewhere in the tree.
- **DECISIVE:** the scan's report plus the runner's discovered-count assertion (that assertion is **lane B's half**, on
  `scripts/run-qa-lanes.mjs` — the same row, two owners, stated).
- **NEG CONTROL:** an in-tree scratch copy inside a `./`-reachable path must REDDEN the count assertion. The measured failure the arm reproduces:
  a deliberately-reverted copy made the command read **331 ran / 164 failed / 324 errors**, while the `./` form discovered exactly **15 files,
  107/0**; the same accident hit the reviewing seat's own suite (`167/164/324`) until the scratch dirs were renamed and deleted.
- **EVIDENCE:** the scan + the copy-and-redden run. **The CONTRACT half** (every 2b `verify` string uses `./`) is the requirements seats' and is
  checked by the captain at DAG creation (A2.3); **the RUNNER half** is lane B's. The two non-corpus paths (`scripts/run-qa-lanes.mjs`,
  `scripts/reconcile-register.py`) are NOT corpus (plan §7.1).

---

## 4. THE RE-PIN AND THE PACK (the ordering that must not be improvised)

**`skills/**` IS a packed root asset** (`ROOT_ASSET_DIRS` lists `skills`), so **this lane's corpus edits MUST land before the wave's single
pack**, and the single pack must follow the captain's single re-pin (A2.6; plan §7.1). The measurable call: the corpus change and the re-pin land in
ONE commit; the pack comes after; a reader of the packed artifact must be able to see the same drivers the corpus ran.

Evidence the re-pin leaves behind: the fresh dry run's output (the `computed (LF)` value, with any superseded preview named), the `--check`
exit, and the captain's `--write` + `verify-vendor` readings — all under `evidence/dsh-qa/<slug>/<stamp>/`.

---

## 5. FINDINGS

**F1 — the T-69 prerequisite is already satisfied** (the bannered wrapper exists with four self-test arms), so this lane's T-69 half is an
invocation change in the corpus and NOT a dependency on lane B; a record that waits for B here is waiting for something already delivered.

**F2 — the raw-bytes value is the one number that must never appear** in this lane's records, even beside a correct lock: the helper prints it
labelled `NEVER write this one` and its self-test pins the LF-normalized form.

**F3 — the T-89 row has three owners** (corpus = here, runner = lane B, contract = the requirements seats + the captain's DAG check); the
corpus half is not complete without the runner's discovered-count assertion, so this lane's record names the dependency by file.

**F4 — the D-after-B dependency is a REAL one for T-69 only in the sense of the corpus invoking the wrapper**; for every other row this lane's
predecessor is the captain's re-pin.

---

## 6. VERDICT OF THIS FREEZE

Lane D can start: six rows in register order with named deliverables and a red side each, the single-writer PRECONDITION stated as a condition
(including the wave's ONE re-pin and the LF-normalized re-derivation rule with the forbidden raw value), a lane-scoped verify list that cannot be
green while the lock is stale (and does not carry `bun run test:qa`), the SPEC channel from lane C named, and the packed-skill ordering stated so
the corpus, the re-pin and the single pack land in the right order.


---

## ADDENDUM A (appended after completion; nested, never a rewrite) — the re-pin's EXACT readings, the UNION as a predicate, and T-85's constraint on this lane's own corpus

This task's authoritative inputs name four things the frozen body carried only in general terms. Every reading below was READ at its own source; the
numbers are WAVE 2A'S and are cited for the SHAPE — 2b's must be re-taken at its own write.

**1. THE RE-PIN'S THREE-PART READING (2a report §3), which is the shape this lane's record must reproduce:**
| step | the 2a reading |
|---|---|
| dry run at the write | locked `68318157344aafec…`/323 → **computed (LF) `b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620`**/323 (1 file LF-normalized); raw-bytes `357b4bc858ebcb51…` **never written** |
| `--write --i-know-this-is-the-captains-step` | 1 field change (`VENDOR_LOCK.json`), 3434 B → 3434 B |
| `node scripts/repin-vendor.mjs --check` | **GREEN — lock matches the working tree (drift=0, problems=0)** |
The measurable STATE PAIR the acceptance requires is therefore: **before** — `--check` exits **1** and the lock is BYTE-UNCHANGED; **after** — `--check` exits **0** while the lock holds the LF value (never the raw-bytes one). Three previews were superseded in sequence and NAMED as such
(`7aef5fd2…`/`8ea212eb…` → `2c748d48…` → `b9097d11…`), which is why the body forbids quoting a preview as the value.

**2. THE UNION RULE, AS A PREDICATE WITH THE MEASURED NUMBERS (t28 handoff, §5):** t11's 13-file write set ∪ t28's 2 files =
**14 distinct files = 12 CORPUS + 2 NON-CORPUS**, with **`team-watchdog-config.mjs` IN THE OVERLAP** (t11 counted it; t28 changed it again) — so
"11 + 2" double-counts it and "13 + 2" over-states the total. The measured lists: CORPUS = `cases.json`, `extension-lifecycle.mjs`,
`lib/immutable-output.mjs`, `team-watchdog-{boot,config,fault,heartbeat,notify,scene}.mjs`, `tui-settings-bridge.mjs`, `watchdog-redesign.mjs`,
`web-settings-bridge.mjs`; NON-CORPUS = `scripts/run-qa-lanes.mjs`, `scripts/reconcile-register.py`. **File count unchanged (323 → 323).** The predicate:
**|A ∪ B|, never |A| + |B|** — a sum is the defect the number was measured to avoid.

**3. THE PACK'S DISCRIMINATING ACCEPTANCE (2a report §3), restated because "exit 0" is not it:** before the pack — stamp `2026-09-17T05:19:48.265Z`,
`0 drift, 25 expected-after-pack`; the single `node scripts/pack-mpd.mjs` → exit 0, 1190 files mode-normalized; after — stamp
**`2026-09-17T08:55:57.244Z`**, `1181 compared, 1181 identical, 0 drift, **0 expected-after-pack**`, 0 FAIL. The acceptance in the body is met in its
strongest form only when BOTH hold: the absorbed files have LEFT the `expected-after-pack` set (25 → 0) AND every byte matches. **`exit 0` alone proves
nothing** — since the T-76/t26 rewrite the gate exits 0 BEFORE the re-pack too, with the drifted-but-expected class named.

**4. T-85 IS A LIVE CONSTRAINT ON THIS LANE'S OWN CORPUS, not a neighbour's row.** `skills/dsh-qa/scripts/extension-lifecycle.mjs` runs
`node scripts/pack-mpd.mjs` as its "packed" leg **against the real `dist/mpd-package`**, so a lane can write the canonical artifact unannounced (measured:
a `04:37:59Z` pack no task asked for forced a full provenance investigation). The register's §Fix, and therefore this lane's obligation: point the packed
arm at a **SCRATCH out-dir** (the `t70` harness `scratch-pack.mjs` pattern — two rewritten path constants plus a refusal to patch a drifted packer) **or**
exclude pack-leg lanes from the canonical tree; and keep the discriminator — **stamp counting over `dist/mpd-package` yields ONE bucket (1,190 files) for
a full pack versus a few files for a partial patch.** The rule the same measurement produced: **the artifact has exactly ONE WRITER AT A TIME.**

**5. BOUND, carried rather than hidden:** B3's `reading_bound.for_wave_2b` clause **(g)** (the dispatch sizing) exists — probed — but its TEXT is not
readable through a 2000-character line view, so this file cites the clause by its heading and does not quote it (the ER-1/A4 rule).
