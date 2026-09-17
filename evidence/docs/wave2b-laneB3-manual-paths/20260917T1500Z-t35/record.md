# t35 (impl-B3/3) — the DECLARED anticipatory class in `scripts/verify-manual-paths.mjs` (red arm kept)

**Seat:** watchdog-engineer. **Attempt 1**, attempt_id `151b71d0-a870-45ec-8dee-4f90ff592f3e`.
**Write set:** `scripts/verify-manual-paths.mjs`, `evidence/docs/wave2b-laneB3-manual-paths/20260917T1500Z-t35/**`.
**Instrument after the change:** `scripts/verify-manual-paths.mjs` sha256 `6b3095ce97e9d127…`, 35,668 bytes (untracked — see §4).
**Manual untouched this task:** `AGENTS.md` sha256 `32a297191e12fdaba0021c35b732ab367d0828002564e426713a6a4cb8349d7a`, 53,464 B — the same revision both readings below were taken at.

---

## §1 WHAT WAS BUILT — a declared, reasoned class, not an ignore list

`scripts/verify-docs-parity.mjs` already prints the two anticipatory paths as `ANTICIPATORY — not a live path`.
This task teaches the path checker the **same class**, in the instrument, from the policy sentence that declares it —
`AGENTS.md` §3: *"the two ANTICIPATORY paths (`docs/adder4.md`, `docs/cnt8.md`) are kept by design and printed as their
own class so an exemption for a file that does not exist can never rot silently."*

| # | change | why |
|---|---|---|
| 1 | `ANTICIPATORY_PATHS` — a `Map` of the two rel paths to their REASONS, with a header comment citing AGENTS.md §3 and the docs gate's print form | the class is **declared and reasoned inside the instrument** |
| 2 | two buckets: `anticipatory` (direction `declared`) and `declared-unreferenced` (the **rot guard**) | the class is **named and counted**, and can never rot silently |
| 3 | one branch in `audit()`: a mention is classed `anticipatory` **only when the file really is absent AND the manual spells that exact rel path** | it can hold back nothing else |
| 4 | the rot-guard loop: a declared entry the manual no longer names is pushed to `declared-unreferenced` and printed | an exemption for a file that does not exist is reported every run |
| 5 | `render()`: `census family=declared …` line; `reportExit()`: `NOTE declared-unreferenced=N` + a `PASS … declared=N` clause | the class has its own family, counted apart from the audited subjects and from `unresolved` |
| 6 | **four** self-test arms (§3) + `arm.args` passthrough + the test-only `--no-anticipatory` flag | the class is falsifiable in the shipped self-test |
| 7 | `usage()` documents the hook and says it "can only remove an exemption, never add one" | the test surface is declared, not hidden |

**Nothing in the matcher moved:** `classify()`, the candidate/shape/anchor rules and the existence test are byte-for-byte
as they were; the class is consulted *after* `existsSync` says the file is absent (change 3).

---

## §2 BOTH READINGS (same manual revision)

| | before | after |
|---|---|---|
| instrument | the old one | this one |
| command | `node ./scripts/verify-manual-paths.mjs` | same |
| exit | **1** | **0** |
| subjects | `audited=111 (resolved=109 unresolved=2)` | `audited=109 (resolved=109 unresolved=0)` |
| the two names | `unresolved AGENTS.md:14 -> docs/adder4.md`, `… docs/cnt8.md` | `anticipatory AGENTS.md:14 -> docs/adder4.md [ANTICIPATORY — not a live path: kept by design (AGENTS.md §3) …]` (and the same for `docs/cnt8.md`) |
| families | over 65/6 · under 79/7 | over **65**/6 · under **79**/7 · **declared 2**/2 |
| capture | `../20260917T1455Z-t28/raw/verify-manual-paths-after2.log` (kept beside this) | `raw/after-in-place.log` |

`PASS resolved=109 over-report=65 under-report=79 declared=2 (every audited path exists; the DECLARED anticipatory class
is named with its reason and counted apart; the two matcher-error directions above are reported, not merged)`.

---

## §3 THE RED ARMS — all four EXECUTED

| arm | construction | exit | reading |
|---|---|---|---|
| **removal** (`--no-anticipatory`) | the shipped hook empties the class; the real manual | **1** | `unresolved=2` — `docs/adder4.md`, `docs/cnt8.md` — i.e. **removing an entry from the class RETURNS it to failing** (`raw/removal-arm.log`) |
| **t28's own arm, replayed** | scratch copy (outside the workspace) + ONE injected wrong code span `docs/this-path-does-not-exist.md` | **1** | `unresolved=1`, the injected path **named**; the class suppressed only its own two (`raw/red-arm-t28-arm.log`) |
| **a NEW bad path** | same construction, `docs/this-path-was-never-there.md` | **1** | `unresolved=1`, named — the class does not widen (`raw/red-arm-new-bad-path.log`) |
| **self-test arms 7–10** | `anticipatory-class-green` · `anticipatory-does-not-widen` · `anticipatory-removed-fails` · `anticipatory-rot-guard` | 0/1/1/0 as asserted | `--self-test` → **10/10 arms PASS** (the six pre-existing arms included, untouched) |

Arm 7 asserts the class prints with its count and reason and the run passes; arm 8 asserts an **undeclared** missing path
still lands in `unresolved` and still fails; arm 9 asserts the class-emptied run fails on both names; arm 10 asserts the
**rot guard** fires (`declared-unreferenced=1`) when a declared entry is no longer named, as a NOTE and not a failure.

---

## §4 "THE MATCHER WAS NOT LOOSENED" — MEASURED, because no byte diff exists

The instrument is **UNTRACKED** (`git status --porcelain` → `?? scripts/verify-manual-paths.mjs`), so `git diff` is
necessarily empty, and no pre-edit copy was archived by lane B — so this claim is proven by measurement instead:

`node t35-census-compare.mjs` (this dir) reads three archived runs and asserts, with **exit 0 / verdict PASS**
(`t35-census-equivalence.json`):

1. the NEW instrument with the class **emptied** is **census-identical to the OLD instrument on all 16 buckets it
   printed** — `audited=111`, `resolved=109`, `unresolved=2`, `over-report:bare=13`, `:fragment=34`, `:notRoot=11`,
   `:npm=6`, `:trailing=1`, `:url=0`, `under-report:absolute=2`, `:elided=4`, `:glob=39`, `:home=10`, `:outside=1`,
   `:placeholder=23`, `:prose=0`;
2. the buckets this change **adds** (`anticipatory`, `declared-unreferenced`) are **both 0** in that run;
3. the matcher-error **families are equal** (over 65 · under 79), with the added `declared` family at 0;
4. the emptied-class run **still FAILS on the same two names** (`unresolved=2`);
5. the class-**active** run is green with `unresolved=0` and `PASS {resolved:109, over:65, under:79, declared:2}`;
6. **the movement is fully accounted for**: `0 unresolved + 2 anticipatory + 0 unreferenced = 2 = before.unresolved`;
7. **the class touches nothing outside itself**: `resolved 109 → 109`, `over 65 → 65`, `under 79 → 79`, `audited 111 → 109`;
8. both declared entries are named with their reason and the `declared` family reads 2.

**Bound, stated plainly:** this is a *measurement* equivalence (census-level, on this manual), not a byte diff — no
committed baseline for this file exists to diff against, which is itself a fact of the wave (the checker is new).

---

## §5 CENSUS MOVEMENT, EXPLAINED RATHER THAN ABSORBED

The acceptance quotes **t28's own audit** (over-report 65 across 6 buckets, placeholder 19, glob 37, under-report 73,
audited 115). Those are the readings **before t28's manual edits**, and two independent steps moved them — neither absorbed:

| step | placeholder | glob | under-report | audited | over-report | unresolved |
|---|---|---|---|---|---|---|
| t28's before (acceptance's numbers) | 19 | 37 | 73 | 115 | 65/6 | 7 |
| after **t28's AGENTS.md edits** (the four re-spellings + the §4 row) | **23** (+4) | **39** (+2) | **79** (+6) | **111** (−4) | 65/6 (±0) | 2 |
| after **this task's instrument change** | 23 (±0) | 39 (±0) | 79 (±0) | **109** (−2) | 65/6 (±0) | **0**, with `anticipatory=2` |

Every delta is attributed: t28's edits moved the audited/placeholder/glob counts (its own record documents each), and
this change moved exactly the 2 refusals into the `declared` family — with `resolved`, both matcher-error families and
every other bucket **unchanged** (§4's equivalence driver states them bucket by bucket).

---

## §6 VERIFY (all `./`-formed, full output kept under `raw/`)

| command | exit | reading |
|---|---|---|
| `node ./scripts/verify-manual-paths.mjs` | **0** | `resolved=109 … declared=2` — the class printed with its count and reason, `unresolved=0` (`raw/after-in-place.log`) |
| `node ./scripts/verify-manual-paths.mjs --self-test` | **0** | **10/10 arms PASS** — six pre-existing + four new (`raw/selftest.log`) |
| `node t35-census-compare.mjs --out .` | **0** | verdict PASS, 8/8 checks (`t35-census-equivalence.json`) |
| `node ./scripts/verify-manual-paths.mjs --no-anticipatory` | 1 | the removal arm, by design (`raw/removal-arm.log`) |
| `bun run ./scripts/verify-docs-parity.mjs` | **0** | unaffected by this task, checked anyway: `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |

---

## §7 NON-GOALS HONOURED AND THE RESIDUAL BOUNDS

- **No manual text edited**: `AGENTS.md` is untouched by this task (same sha as the before reading); the two anticipatory
  mentions stay in the manual.
- **No silent or hand-maintained ignore**: the class is declared with reasons, printed per-site with its reason, counted in
  its own bucket and family, and guarded by a rot report — and the shipped self-test fails loudly if the class widens.
- **No matcher widening**: measured in §4; the class is consulted only after the existence test says absent.
- **Residual bounds:** (a) the rot guard is a NOTE, not a failure — a declared entry the manual stops naming is reported
  every run, and whether that should ever fail is a policy call this task did not take unilaterally; (b) the
  `--no-anticipatory` hook exists for the removal arm and can only *remove* an exemption; (c) the equivalence in §4 is
  census-level on this manual, not a byte diff.
