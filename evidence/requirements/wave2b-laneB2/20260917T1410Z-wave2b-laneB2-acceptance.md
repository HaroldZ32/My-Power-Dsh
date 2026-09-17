# Wave-2b LANE B2 — executable acceptance (r-B2, frozen BEFORE any implementation)

**Seat:** Architect (requirements, read-only), through the platform artifact channel — the only write a denied seat has.

**Authority:** `.mpd/plans/friction-p2-wave-2b.md` — body byte-identical at sha256 `0dd3d2fd4744802d37031477…` (cited as the plan
cites it; the tail is abbreviated there and NOT reconstructed here) — §4 (lane map), §5 (lane B2 table), §6 (DAG), §7 (serialization),
§8 (lane-scoped gates), §9 (evidence convention), **A2.5** (the NEW-artifact list) and **A2.4** (ER-2's audit discipline). Register:
`.mpd/TODO.md`. Lane inputs used as INPUT: lane A's `evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §4e (the six
addressing parameters + the measured probe artifacts) and §8 (the runnable T-92 audit); B3's
`evidence/gates/t75-derived-values/20260917T072029Z/result.json` → `reading_bound.for_wave_2b`; and the reviewers' two-seat probe record
`evidence/review/t-4g-address/20260917T101512Z/` (`LADDER-AND-BOOKKEEPING.md`, `probe-matrix.txt`, `probe-matrix-CORRECTION.txt`).

**Moment of this freeze:** the `t9` record's own timestamps — `createdAt` 1789653786091 = 2026-09-17T14:03:06Z, `updatedAt`
1789654211620 = **2026-09-17T14:10:11Z** (its claim; read from `.mpd/team/friction-p2-wave/team.json` read-only). The file was written
after that instant; the stamp names the CLAIM because this seat has no shell and will not invent a clock.

**What is frozen:** the DONE-WHEN for lane B2's three rows, in register order — **T-78, T-80, T-82** (all `§8.6`).

---

## 1. WRITE SET — file-exact (plan §4's B2 row; A2.5's NEW list)

- `scripts/check-citations.mjs` — exists; the durable home of the t21/t9 checker (T-72)
- `scripts/check-driver-headers.mjs` — **NEW** for T-80, **or the same file's subcommand** (the plan allows either; the path is
  verified ABSENT at this revision, so a separate file is the measurement and a subcommand is the alternative)

**NOT in this set, named so nobody re-globs it:** `scripts/verify-docs-parity.mjs` is **LANE B3's ONLY**; every `scripts/verify-*.mjs`
that lane B owns (`verify-rows-parity.mjs`, `verify-manual-paths.mjs`, `verify-gates.mjs`, `repin-vendor.mjs`, `run-qa-lanes.mjs`,
`mpd-doctor.mjs`, `install-git-hooks.mjs`, `.gitignore`, `package.json`) is lane B's; `skills/**` is lane D's (the drivers and their
headers/arms); `docs/**`, `AGENTS.md` and `templates/**` are B3's; `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`,
`.mpd/plans/**` are the captain's integration surfaces.

**HOP CANDIDATES (named, never silently dropped — plan §7.8):** (i) `skills/dsh-qa/**` — T-80's DRIVER side is corpus; a header that
must change is D's edit, and this lane delivers the RULE plus a failing report, never the corpus edit; (ii) `docs/**` or `AGENTS.md` if
T-78's rule needs a human-facing table (B3); (iii) `package.json` if the new checker entry needs an npm alias (lane B).

---

## 2. VERIFY — lane-scoped, `./`-formed (T-89's contract half discharged here)

- `node scripts/check-citations.mjs --self-test` (the arms: ROT line-number-only in three shapes, symbol-first right-then-wrong, the
  positive control, and the fixture-repo green/red pair spawned as `--citations-only` children under `DOCS_CLAIMS_REPO`)
- `node scripts/check-citations.mjs --out ./evidence/gates/<slug>/<stamp>/run` (the scoped citation run on this lane's own tree)
- `node scripts/check-driver-headers.mjs --self-test` (T-80; or the equivalent subcommand's self-test if the checker keeps it inline)

**FORBIDDEN here, by name:** `node scripts/check-citations.mjs --gates` — that flag spawns **B3's** `scripts/verify-docs-parity.mjs`, a
cross-lane command whose subject another lane edits (plan §7.4) · `bun run verify:gates` · `bun run test:qa` · `bun run test:qa:all` ·
`node scripts/verify-vendor.mjs` · `node scripts/verify-dist-fresh.mjs` · `bun run typecheck`. A red this lane cannot keep green belongs
in EVIDENCE, never in a verify list (A2.1's round-2 rule; T-84's extended §Fix).

---

## 3. THE OUTPUT-DOMAIN RULE (measured — this is what makes the lane executable)

The checker's output base is HARD-CODED to `evidence/extensions/docs-claims/` (`OUT_BASE = <repo>/evidence/extensions/docs-claims`,
with `OUT_ROOT = resolveOutputDir(OUT_EXPLICIT, OUT_BASE, "run")`), while **this lane's declared evidence domain is
`evidence/gates/**`** (plan §4's B2 row). A plain run therefore writes a path this lane does not own, which is the measured T-88 shape:
the platform refuses the completion on an undeclared write (`1 changed path(s) not covered by inScope: …`).

**Requirement:** every run recorded by this lane passes an explicit `--out ./evidence/gates/<slug>/<stamp>/…` (the override exists and is
honoured), and the acceptance's evidence is that run directory. Two consequences worth writing down:
1. this also satisfies T-74's explicit-output-root rule for a lane that runs a foreign tool;
2. a SECOND run aimed at the same `--out` must be REFUSED, not overwritten — the checker already imports
   `skills/dsh-qa/scripts/lib/immutable-output.mjs` (`resolveOutputDir`/`writeImmutable`/`refuseOverwrite`), and that refusal is the
   ready-made red arm for the immutability of this lane's own evidence.

If the captain prefers the checker's historical home instead, the alternative is declaring `evidence/extensions/docs-claims/**` on the
B2 task's `inScope` — a captain decision, stated as such rather than improvised in the lane.

---

## 4. PER-ROW ACCEPTANCE

### T-78 — `§8.6` · gap · P2 · "A doc-rewrite task's verify list omitted its own citation driver." (plan §5's shape: "the rule is stated AND mechanically reachable (the checker's own docs/table)")
- **DELIVERABLE:** (i) the RULE TEXT in the checker's own surface — its header/usage block AND the run record — naming the exact command
  a doc-rewrite task must carry (`node scripts/check-citations.mjs --out <dir>`); (ii) the mechanical reachability: that command is
  single-invocation, offline, deterministic (all true today, measured in the checker's own header).
- **OBSERVABLE:** the usage text prints the rule, and a run's record carries it, so a reader of EITHER surface finds it without prose.
- **DECISIVE:** an arm READS the record this lane's run wrote and asserts the rule string and the command are present (asserted against
  the record's bytes, not against a comment somebody might reword).
- **NEG CONTROL:** the doc-rewrite fixture pair the checker already owns — a mis-anchored citation under `DOCS_CLAIMS_REPO`
  (`--citations-only` child) exits **1** with `does not carry the claim`, while the correct fixture exits **0**. An omitted driver is
  therefore not a silent state: running it is what catches the rot.
- **EVIDENCE:** `evidence/gates/<slug>/<stamp>/` with the `--out` run dir + its `result.json`.
- **Hand-off:** if the rule belongs in a human-facing table, `docs/**` is B3's (hop iii).

### T-80 — `§8.6` · gap · P2 · "A driver header's `A<n>` claims are prose, unchecked against its own assertion keys."
- **DELIVERABLE:** the header-claim check — `scripts/check-driver-headers.mjs` (NEW) or a subcommand of the checker (plan's either/or).
- **OBSERVABLE:** for every corpus driver it scans, the header's `A<n>` claim set equals the set of assertion keys the driver actually
  produces (measured shape: `add("A1", …)` / `add("A1-apply", …)` with headers that speak of ranges like a lane's acceptance items),
  and a claimed-but-unasserted key is reported with the driver path and the key.
- **DECISIVE:** a fixture driver whose header CLAIMS A4 while its code asserts only A1–A3 → non-zero, with the key and the driver named;
  a matching fixture → 0.
- **NEG CONTROL (two arms, both required):** (a) the near-miss — a header claiming A1–A3 whose code asserts A1–A4: the extra key must be
  reported (or explicitly allowed by a rule stated in the checker); either policy is acceptable, silence is not; (b) the AUDIT must name
  the directories it covers and their per-directory split, and must declare BOTH matcher-error directions (ER-2: a whole-tree scan
  over-reports, a `*.mjs`-only glob under-reports) — and it must NOT inherit lane A's `self-fix-tests`/`test` split (25/17 = 42), which
  measures a DIFFERENT audit.
- **EVIDENCE:** the two fixture runs + the live scan (whose moment is stated). The DRIVER-side conformance is lane D's (hop i).

### T-82 — `§8.6` · gap · P2 · "The checker's intermediate revisions are not retained (drift is hash-comparable, not diffable)."
- **DELIVERABLE:** each run RETAINS the revision bytes it measured — the checker's own file AND the frozen revision it supersedes (both
  already hashed into the record as `checker.sha256` / `checker.supersedes.sha256`) — as files INSIDE the run directory, so two runs
  become DIFFABLE rather than only hash-comparable.
- **OBSERVABLE:** after two runs, `diff <runA>/revisions/<file> <runB>/revisions/<file>` is executable and meaningful, while the record
  keeps the hash view unchanged.
- **DECISIVE:** the arm runs the checker twice with a one-line change between the runs (a fixture copy of the checker, or the checker
  against a mutated fixture subject) and asserts (a) both retained files exist, (b) the diff for the CHANGED pair is non-empty and names
  the changed line, (c) the diff for an unchanged pair is EMPTY.
- **NEG CONTROL:** the unchanged pair (c) is the control against a "retention" that simply copies the CURRENT file into both run dirs —
  the arm must fail if the two retained copies are byte-identical when a change existed.
- **EVIDENCE:** both run dirs + the diff transcript.
- **NOTE (a claim already in the file):** the checker's own record block asserts "the checker's intermediate revisions are diffable, not
  merely hash-comparable" while the record carries SHAs only. The acceptance therefore has two acceptable closes: make that sentence
  TRUE (retention), or correct it. Leaving a false sentence beside the fix is the one outcome not accepted — and it is exactly the class
  this lane exists to police.

---

## 5. NEGATIVE CONTROLS PER ROW/INSTRUMENT

| row | the arm that MUST redden |
|---|---|
| T-78 | a mis-anchored citation in a fixture doc → `--citations-only` child exit 1, `does not carry the claim` |
| T-80 | a header claiming an `A<n>` its code never asserts → non-zero + the key named; and the near-miss extra-key arm |
| T-82 | the changed pair's non-empty diff; the unchanged pair's empty diff (the anti-fake control) |
| immutability (all runs) | a second run at the same `--out` → REFUSED (the imported `immutable-output` guard) |

Every arm is a spawned CHILD of the checker with an asserted exit code and an asserted message — the shape this checker already uses,
never a prose claim (report §5 rule 7).

---

## 6. FINDINGS

**F1 — the output-domain mismatch (§3):** the checker's hard-coded `OUT_BASE` is outside this lane's declared evidence domain. The
`--out` requirement above is the lane-scoped fix; the alternative (declaring the legacy path) is a captain decision.

**F2 — a sentence that must become true or go (T-82's note):** the record claims diffability the code does not yet provide.

**F3 — `--gates` is a cross-lane command** inside this lane's own checker: it spawns B3's `verify-docs-parity.mjs`, so it stays out of
this lane's verify list even though the flag lives in this lane's file.

**F4 — B3's clause label (carried from r-A):** `reading_bound.for_wave_2b` carries **(a)–(g)** — probed by matching `\(f\)` and
`\(g\)` in the field's line while a 2000-character line view shows only (a)–(e) — but the plan's A1/A2.4 still say "(a)–(e)". The
B2 rows cite clauses (b) and (c) by id; the exact text of (f)/(g) is NOT readable through a line view, so any acceptance that needs it
must re-take the field with a JSON-aware reader (ER-1's recorded cause, one generation later).

**F5 — the citation family's parameter set:** lane A's note §4e fixed six addressing parameters (the literal string · the pattern AS
PASSED including escaping and case · the tool mode · the unit · the scope · the moment). Every rule this lane makes mechanical must be
stated in those terms, and the reviewers' two-seat probe record (`evidence/review/t-4g-address/20260917T101512Z/`) is the reference for
how a citation claim is measured on two seats. A checker whose failure message names none of the six is not accepted.

---

## 7. VERDICT OF THIS FREEZE

Lane B2 can start: three rows with named deliverables, a file-exact write set, a lane-scoped verify list (with `--gates` and the
repo-wide aggregates excluded), an explicit `--out` requirement that keeps its evidence inside its own declared domain, and a red arm
named for every row — including the two the checker already owns, which must stay green while the new ones are added.


---

## ADDENDUM A (appended after the freeze; a nested addition, never a rewrite)

**T-90's measured instance, cited because this task's acceptance names it explicitly.** The durable-anchor rule (2a report §5 rule 1;
register row **T-90**): an artifact path IS the anchor, a relay is secondary, and **a mailbox record id is not a link at all** — the
measured instance is an inbox record id that became unretrievable the moment its mailbox was cleared (`ee9ec16…`), which is why the
rule is class-based ("no pointers to mailbox records") rather than a shape scan. For THIS lane it bites in two concrete places:

1. **T-78's rule text** must name the DRIVER command and the ARTIFACT path shape (`evidence/gates/<slug>/<stamp>/…`) as what proves a
   citation was checked — never a mailbox or message id.
2. **T-80's report** (and the header check's own diagnostics) must name driver files by PATH and, when they cite a driver's own header
   claim, quote the header PHRASE — never a position in it (T-55's anchor discipline: a derived claim is re-taken, never inherited;
   the checker's own `supersedes`/`sha256` pair is the hash view, never a substitute for the retained revision of T-82).
3. The absence of any mailbox-id-shaped anchor in the records this lane writes is CHECKABLE, not a promise: run the checker over the
   lane's own run directory with the pattern named and the moment stated (F5's six parameters), and report the result as EVIDENCE.

With this addendum, every measured instance the task's acceptance names — T-55 (anchor by symbol/phrase), T-90 (durable anchors vs
mailbox ids), T-92 (the absence-pin audit with its 42 = 25 + 17 split, subject-scoped 3 with 0 reddened, both matcher-error directions)
— is cited where it bites in this lane rather than restated as a rule.
