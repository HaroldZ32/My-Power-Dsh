# 2b notes from lane A (wave 2a close) — refinements that are NOT landed

**Filed by:** `agent-teams-engineer` · `2026-09-17T09:1xZ` · per the captain's decision "take option (b): record the
refinement as a 2b note in your lane's evidence; do NOT open a task for the leaner wording".

**STOP CONDITION (filed by the Architect, and it applies to this file rather than to a rule in it):** the
"pattern AS PASSED" family is SATURATED at five recorded instances of one parameter across two seats and four
mechanisms. A sixth would be evidence about the RULE, not about this note — the rule was stated three ways before the
fifth instance and the fifth still happened — and over-recording has a specific cost: a reader who meets a file that
documents its own slips faster than it documents the system stops reading the slips, after which the honest scars stop
working as scars. **No further exhibits are to be added here** — and the scope is the FAMILY, not the file: a new MECHANISM is not a
sixth exhibit, which is why §4h could arrive under this rule while no further instance of the saturated parameter did. For 2b: cite §4e by section + sha and state the rule
ONCE in the register row — do not reproduce the exhibits, because the note is the evidence and the register is the
decision, and duplicating them upward would give the same text two homes to drift apart in.

**HOW TO QUOTE THIS NOTE (filed by the Architect, and it is this file's own rule turned on itself):** cite
**SECTION + SHA** — never a line number and never this note's own numbers. Every count in §4a–§4g has moved at least
once, and the file showed **AT LEAST eleven revisions and +9,479 B / +91 lines inside one evening** — the unit is
**OBSERVED, not total**: eleven revisions at eleven readings roughly a minute apart, with writes between readings
unobserved (one 60 s window moved the file 1,330 B), so the figure is a lower bound (measured by `code-reviewer`,
head-anchored at the revision then called current; the series has continued since, and the pointer pattern was **0** at
every rung); the phrase, not the position; the sha, not the size.
A reader who wants the current text re-takes `sha256sum` and `git log -1 -- <path>`; a row, plan or report that
quotes a mechanism here should name the section (`§4d`, `§4g`, …) and the revision it read.

## 1. The leaner wording for the T-79 arm comments (NOT landed — text as shipped is correct)

Lane C's suggestion, which I judge better than my own landed text on the merits: a pin file's comment should
state the ARM'S bound and stop, because any version of the live-replay attribution — even one correctly
labelled as an inference — is read by the next agent as background fact. Its minimal form, for both sites in
`self-fix-tests/terminal-rearm-refusal.test.mjs`:

> "the arm's own bound: it measures the refusal in a FRESH process; a long-lived host's LOADED REVISION is
> outside its reach (T-21 — see the register's T-79 note)"

The shipped text is CORRECT (it says "an inference, NOT a measurement" and "UNRESOLVED, with a NAMED PROBE
whose verdict does not support the stale-host reading") — this is lean-ness, not a correctness gap — and the
`result.json` `honest_bound` is a different case where relabelling WAS the right treatment. Authority for the
wording 2b must re-quote: captain log **§A-28** + register row **T-79**, never the row's old title.

## 2. T-89's THIRD PARAMETER (measured; it corrected an over-claim)

* `bun test packages/mpd-roles-plugin/test/adapter-identity.test.ts packages/mpd-ext-plugin/test/adapter-identity.test.ts`
  → 17 pass / 0 fail, **ran 17 tests across 162 files** (bare form) vs **across 2 files** (the `./` form).
* The copies that exist today sit under a **dot-prefixed** path (`.mpd/red-baseline/…`), and dot directories are
  skipped by discovery — so the bare form moved only the **census** (162 vs 2), NOT the executed set (17 tests
  either way). The event that FIRED (331 ran / 164 failed / 324 errors) came from a copy under a **non-dot**
  path (`evidence/review/…`).
* **Consequence for the rule: the census is not the control — the EXECUTED test count and the `./` path form
  are.** A bare-form run that reads the same counts can still have a foreign discovery surface; only the `./`
  form removes it.

## 3. `t8`'s second verify entry (left as-is, deliberately)

`t8` is terminal; its entry is the plain multi-path form and its published reading (17/0) is honest. Re-pinning
would re-run a completed task and its dependents for a reading that is already clean, so the captain's option
(a)+(c) was adopted: leave the terminal entry, and let the integration sweep use the `./` form throughout.

## 4. Predicate discipline for the "inert" census (three numbers, one question)

`.mpd/plans/*.md` holds **16 lines** containing the token, **17 occurrences** of it (one AC-12 row carries it
twice), of which the T-79-family stale SITES are **3** (the D-1(a) sentence, the T-79 STATE-HALF sentence, the
intake line). A phrase grep UNDER-reports the family (one site says "in a long-lived PROCESS"); a bare token
grep OVER-reports it (16 lines, 4 of them the captain log's own rulings quoting the old title to refute it).
Durable pointer set = **the three stale sites + §A-28 + row T-79**, cited by section and sha — never by line
(the delta table's count sentence rotted twice today while the sha-anchored citations did not).

### 4a. Exhibit material for the report's methods table — the AC-12 row (PREPARED TEXT; the rule's home is the register row T-92 + lane B3's clause (d), never here)

**Three rungs in one sentence.** `.mpd/plans/dsh-tui-edition.md`, row **AC-12**, count clause byte-exact
(289 chars, one em dash — extracted from the file, not retyped, not re-wrapped):

> `packages/node_modules` is **excluded**, and the **count must be stated explicitly with the revision classified**: 24 pre-existing package dirs (the number the t2 review measured) plus `packages/mpd-tui-plugin`, which `t4` creates — 25 measured in the tree on 2026-09-15 after `t4` landed.

| rung | the words that carry it |
|---|---|
| 1 · CURRENT value | "**25** measured in the tree" |
| 2 · REVISION it was taken at | "with the **revision classified**" → "on **2026-09-15** after **`t4`** landed" |
| 3 · SUPERSEDED reading, WITH ITS OWNER and the CAUSE of the delta | "**24** pre-existing package dirs (**the number the t2 review measured**) plus `packages/mpd-tui-plugin`, **which `t4` creates**" |

**Anchor precision, MEASURED** (this is the table's own subject, so the anchor cannot be a line number):
durable form **(a) row id + FILE** — `AC-12` **+ `.mpd/plans/dsh-tui-edition.md`** — or **(b) the quoted
sentence** above. The FILE is not decoration, and that is measured twice: the same sentence is carried by
**15 files** (1 live plan, 1 `docs/` twin, 1 packed `dist/mpd-package/`, **12** sandbox/evidence copies), so an
anchor naming only `AC-12` can be satisfied by a stale pack; and `AC-12` alone is ambiguous **inside
`.mpd/plans/` itself** — **3** rows carry that id (`dsh-tui-edition.md`: package classification, the exhibit;
`team-watchdog.md` and `team-watchdog-report.md`: a Web banner). The row id is the same citing form we use for
D-rows; it needs the file for exactly this reason. The `docs/` twin's row is byte-identical to the live row (996 B).

**Second exhibit — the revision rung, this lane's own readings.** Same FILE census, different count, one revision apart:

| revision | evidence file (sha256 prefix) | `self-fix-tests/` | whole plugin |
|---|---|---|---|
| `t31`'s revision (before the seeded lane) | `terminal-redispatch/20260917T072501Z/t31-verify.log` (`3bf9cfe732d4a14e…`) | **108 pass** / 0 fail / 1466 expects / **15 files** | **265 pass** / 0 fail / 2207 expects / **39 files** |
| after `t37`'s seeded lane | `seeded-negative-control/20260917T085849Z/verify.log` (`ec2a60c1bc675916…`) | **109 pass** / 0 fail / 1478 expects / **15 files** | **266 pass** / 0 fail / 2219 expects / **39 files** |

The FILE census is **identical on both sides** (15 and 39), so the delta (+1 test / +12 expects in each scope) is
the added lane, not discovered files — the same tree yields 265 and 266 one revision apart, which is why a count is
quoted WITH its revision. An independent intermediate run re-measured the lower whole-plugin pair exactly
(`pause-surface/20260917T082935Z/final-verify.log`, `96162ac5b8ece44d…`: 265 pass / 0 fail / 2207 expects / 39 files).

TIE-IN: this is also the row that §4's census counts TWICE (measured: **2** occurrences of the token on that one
line) — the line whose token disputed our census is the line that carries the revision rung.

### 4b. Durable-record census of lane A's ≥100-test runs — and the ADDRESS of both transient reds

PREDICATE, so this number cannot be read as another: a *run* = one `Ran N tests across M files.` line,
selected at **N ≥ 100**, classified by that run's own `fail` count, scope `evidence/agent-teams/**/*.log`,
revision = the tree as measured at **2026-09-17T09:38Z**, re-run at the stamp and agreeing (**179** logs, **84** runs found by the parser).

READING: **54 runs ≥ 100 tests — 48 green (0 fail) · 6 non-green**, and the 6 split into two classes that
must not be pooled:

**(a) 3 runs of the 101-test suite at `100 pass / 1 fail`** — three DISTINCT runs six minutes apart, each with
its own header line in its own log (they are not one event recorded thrice: the expect counts differ):

| log (header time) | failing line present in the log | identity |
|---|---|---|
| `final-verify-sweep.log` (**07:39:43Z**) | `(fail) t2: a region heals to its canonical position under partial insertion histories [5662.60ms]` and the reason line `^ this test timed out after 5000ms.` | **NAMED** — the heal test exceeding bun's 5 s default under a full-suite parallel run; `result.json` already records the repair (explicit 30 s timeout; "3.3 s alone / 5.66 s under a full-suite parallel run") |
| `verify-final.log` (**07:41:31Z**) | `(fail) T-07 THE RACE: a task that becomes terminal before the wake is never carried by a wake [6.41ms]` | **NAMED** — the pre-existing flake the ADDENDUM records as repaired and proved at HEAD |
| `settled-sweep.log` (**07:45:51Z**) | **none — this log holds 0 `(fail)` lines** | **ANONYMOUS** — the capture EXISTS (header line carries 07:45:51Z; 100 pass / 1 fail on 101 tests, 1399 expects) but the identity was removed by `tail -4`. This is the ADDENDUM's transient. |

**(b) 3 runs of the T-89 discovery/contamination class** — not suite defects: `composed-ticket-output/…/verify-attempt.log`
(**331 tests discovered across 2430 files**, 164 fail) and `pause-surface/…/suite-{first,second}-run.log`
(264 tests across **3159 files**, 17 / 16 fail). That is what the bare-filter form produces; the `./` form is the control.

RELATION TO THE REPORT'S TEN, stated so ten and fifty-four cannot look like a contradiction: the report's
**TEN controlled GREEN runs** are exactly the ten `101 tests / 0 fail` runs in `t8-lane-a/` (`v1`, `v2`, `v3`,
`verify-1-full`, `load-run/load1..6`) — every one of them present here as green. The census is a **superset under
a different predicate** ("every ≥100-test run on disk, green or not"), never a rival count.

REVISION, because this very predicate has already moved once: the form I circulated earlier was
**32 logs / 29 green / 3 non-green**; re-measured now it is **54 / 48 / 6**. The corpus grew between the two
readings by lane A's own later evidence dirs (`composed-ticket-output`, `pause-surface`). The earlier figure is
not wrong at ITS revision — it just cannot be quoted bare, which is the third instance of the revision rung in
this lane's afternoon (after the AC-12 exhibit in §4a and the 108/109 pair).

**The SECOND transient, addressed — and the address is the finding.** The `1 fail / 2202 expect() calls` run is
captured in **no** log: a repo-wide grep for `2202 expect` reaches only prose ABOUT it
(`evidence/wave2a-integration/20260917T085313Z-sweep-part1/REPORT.md` and
`evidence/review/t34-report-bounds/t34-report-bounds-review.md`, each found by searching the literal `2202 expect`),
never a capture. It is the same recording
error as the settled sweep's (`tail -3` there, `tail -4` here), and t34's review says precisely this: it could not
locate either red capture and flagged §6's "full capture" clause as the one it could not support.
CORRECTION TO MY OWN EARLIER SENTENCE: only ONE of the two transients is anonymous *and* captured; the other has
no capture at all. Both destroyed their detail with a `tail` on the command whose detail mattered — the rule that
follows is "write full output to a file" — the recommendation I filed to the captain for the 2b integration run. MEASURED caveat on my own sentence: the 2b plan of record does not (yet) carry it as a rule — a grep for `full output` / `full capture` over `.mpd/plans/friction-p2-wave-2b.md` and its two errata finds none, so the rule is filed, not enacted.

NESTED, beside the sealed record (the ADDENDUM is not edited): its closing line "the red existed once; its
identity is UNKNOWN" is scoped to the settled sweep and stands; read as a LANE-level count it is refuted by disk —
two sibling reds (07:39:43Z, 07:41:31Z) sit in the same directory, both NAMED, both written before the addendum (07:50Z).

CENSUS STATUS — added after the captain's ruling (**2026-09-17T09:30:24Z**), so no later reader mistakes a ruling
about the REPORT for a doubt about the measurement: the census is **NOT in the report**. The round-3 reviewer's four
grounds, as the captain recorded them: (1) **predicate mismatch** — a controlled set of ten at one revision vs a
threshold census with no revision pinning; (2) **conflation risk** — "3 non-green" sitting beside a two-transient
paragraph; (3) **a census cannot strengthen a bound about two runs it cannot contain**; (4) **provenance** — the
figure reached the captain only through a message, which is precisely the F-3 defect the wave has been repairing.
COMPLIANCE, and the reason this section exists in this shape: the ruling's own precondition for any future use is
"make it durable in your evidence first, then cite it in a separate sentence with the full predicate, labelled as
context". §4b IS that durable home — predicate, scope, revision stamp, the six non-green classified, both transient
addresses, and the superseded 32/29/3 form kept beside the current one — so ground (4) is cured; grounds (1)–(3)
remain rulings about what the report may claim, not findings against the measurement. The captain's own closing:
"Your measurement stands; its home is your note."

### 4c. Post-rollover citation: an archived task id is NOT a live id (candidate register row for the captain)

MEASURED, read-only, **2026-09-17T09:38Z**:
- `agent_teams_status`: "Wave: **w2** (open since 2026-09-17T09:28:54.223Z) · archived: **w1-wave-2a-closed → 42 task(s)**".
- `.mpd/team/friction-p2-wave/team.json`: `wave {label w2, index 2, openedAt 1789637334223}` and
  `waveHistory [{label w1-wave-2a-closed, closedAt 1789637334223, archivedTasks 42, archive
  "friction-p2-wave/waves/w1-wave-2a-closed.json"}]`; live tasks = **`t1` completed** (Planner, the 2b plan) and
  **`t2` in_progress** (Plan Reviewer, "is the wave-2b plan executable?") — i.e. the only live work is `t2`.
- `agent_teams_task_contract("t41")` answers **`task "t41" does not exist in team "friction-p2-wave" (known tasks: t1)`**
  — and names no archive, although the record does exist one directory away.
- The archive holds it: `waves/w1-wave-2a-closed.json` → `t41` **completed** (captain; `changedPaths` = [REPORT.md]),
  `t42` **completed / verdict=pass**, `t40` **completed / verdict=pass**, `counts` `{total 42, completed 38, failed 3, cancelled 1}`.

INSTANCE COUNT — **5 measured instances across 3 seats in ~40 minutes**, and it has TWO triggers worth separating:
- **TRIGGER A, the wave roll (3 instances):** an ARCHIVED id quoted as live loop state — lane A (corrected by the
  Architect), the Architect (corrected by lane A), lane C (corrected by lane A).
- **TRIGGER B, within-wave churn (2 instances, both mine):** a LIVE id quoted with a status that had already
  moved. Measured from the mailbox: my two lines at **09:39:48Z** (to lane C) and **09:39:54Z** (to the captain)
  both read "…`t2` in_progress…, so the only live work is `t2`" — from a 09:38Z read, ~6 seconds apart, with NO
  moment stamp; lane C re-measured `t2` FAILED minutes later, and by 09:47:51Z the list had SIX tasks
  (`t1` completed · `t2`/`t3`/`t4`/`t5` failed · `t6` completed/pass). My stamped line of the same period
  ("measured at 09:38Z…", 09:42:11Z to the captain) did not mislead — the stamp is what carried the protection.
Neither trigger was a false claim about a FILE: the failure is that no surface a reader consults redirects them
(a contract read on an archived id answers only the live list), and a reading of a mutable record travels as
"current" unless its moment travels with it. The two remedies in the candidate row therefore split the same way:
the contract refusal should name the archive, and every state reading should be quoted with its moment —
lane C has independently adopted "timestamp every read" as its standing practice (its A23).

CANDIDATE ROW (the captain mints it; `.mpd/TODO.md` is not this lane's file): after a wave rollover, a contract
read on an archived id says "does not exist" and lists only the live ids, while `waveHistory[0].archive` (in
`team.json`) and the `agent_teams_status` wave line are the ONLY pointers to the record that does exist. Either
the refusal should name the archive, or the rollover must stamp the archive path where the next reading lands.

CITATION RULE, same shape as §4a's anchor: cite an archived task by **id + wave label + archive file** —
`t41` + `w1-wave-2a-closed` + `.mpd/team/friction-p2-wave/waves/w1-wave-2a-closed.json` — because the bare id
resolves to nothing.

AND THE JUSTIFICATION IS NOT TIDINESS: **the id namespace is REUSED across waves**, measured — w1's `t1` is
`kind=requirements`, assignee Architect, "r-A — executable acceptance for lane A (T-61/T-62/T-75/T-79/T-81)"; w2's
`t1` is `kind=work`, assignee Planner, the 2b plan. Same id, two waves, different kind, different owner, different
subject. So the wave label is PART OF THE ID, not a convenience attached to it — and any retrospective line that
says "t38/t41" is readable only while its wave is the obvious context. (And re-verify status from the archive, not from the quote: `t42` was reported to me as
"in_progress, the only open item" while the archive says completed/verdict=pass.)

### 4d. A ledger gate that READS unsatisfiable when the contract declares no verify command (candidate register row; arm run, fix PREPARED not applied)

CONTEXT, from the live wave (read-only): `t3` (Planner, "repair-round-2") delivered its amendment and then
FAILED on a ledger gate — its own finding says "the platform refuses a repair completion without a `passed`
`commandsRun` entry, while this contract's Verify field is EMPTY and this seat is mechanically read-only
(no bash tool, so no command can be run) … the completion gate is unsatisfiable from this seat without
fabricating a command result, which this wave forbids."

MEASURED, in-process against the REAL module (never a copy): arm at
`evidence/agent-teams/repair-ledger-empty-verify/20260917T094347Z/` (`arm.mjs`, `arm.out.txt`, `README.md`,
`PATCH-PROPOSAL.md`), `quality-gates.js` sha256 `1b0eb60e61765f5eb55dfab94bdeed5fff916a4b8d2fb9081fde5ec9ed4f4ad6`.
COVERAGE AT LANDING TIME (the Architect's line): while the plan is pre-A2 (`N1` = 0) **no 2b ROW points at either arm** — and the precision matters
for a landing-time reader: the `regex-hazard/` arm is ALREADY REFERENCED (its `control.txt` is cited in the hazard
discussion above), so what it lacks is a register DECISION, and the correct act for it is a ROW, not a pointer;
when 2b's rows are minted this one earns a **POINTER from T-87** (§4d is its rule home, so it needs no row of its own),
while `regex-hazard/` corrected a RULE rather than adding an example and so earns a row or a clause in the citation-form
block. The mint belongs to whoever writes 2b's rows, not to either seat:
- **case A** (`verify=[]`, `commandsRun` omitted — the `t3` shape) → refused: "repair completion requires a
  passed commandsRun entry for every verify command" — the exact message, reproduced.
- **case B** (`verify=[]`, **`commandsRun: []`**) → **`{"ok":true}`**. `verifyCovered([], [])` is an `every`
  over an empty requirement set, so the gate is SATISFIABLE and the truthful payload for a seat that ran no
  commands is an explicit empty list.
- **controls**: C (a real verify command + no list → the same text, accurate there), D (a FAILED command →
  `{"ok":false,"error":"verify failure must fail the task","requiredStatus":"failed"}`), E (a PASSED command
  → completes). So the branch is not weakened and the behaviour on every pass/fail path is unchanged.

TWO CONSEQUENCES, and they are different kinds of thing:
1. **NO-CODE EXIT** (for `t3` and any future seat of this shape): complete with `commandsRun: []`. `t3` is
   terminal (`failed`), so it must first be re-opened/reassigned by the captain — but the completing seat
   then needs no bash, no fabricated result and no contract amendment. That is cheaper than BOTH remedies
   `t3` offered (reassign-to-captain, or amend the contract).
2. **CANDIDATE REGISTER ROW** (residual, message-level): one branch serves two situations, so the missing-list
   case is reported in the vocabulary of commands that do not exist. Fix prepared as `PATCH-PROPOSAL.md`
   (split the branch, ~7 lines, message-only; the arm's B/D/E cases are its controls) — **NOT applied**:
   lane A holds no task in wave 2b and that file sits inside the plan's write sets, so applying it from here
   would move a path without a contract.

REFINEMENT — the hazard is KIND-SPECIFIC, and it took two seats to say so exactly (2026-09-17T09:52Z).
`code-reviewer` re-measured the gate at the same module revision (`evidence/review/gate-ledger/20260917T095500Z/arm-full.out`);
this lane then re-derived it over ALL SEVEN `TASK_KINDS` (`arm-matrix.mjs` / `arm-matrix.out.txt` in the §4d evidence dir):

| kind | `verify=[]` + `commandsRun` omitted | + `commandsRun: []` | one FAILED command |
|---|---|---|---|
| implementation · verification · **repair** · integration | **REFUSED** ("… requires a passed commandsRun entry for every verify command") | `{"ok":true}` | **REFUSED** (`verify failure must fail the task`, `requiredStatus=failed`) |
| review · requirements | REFUSED — by the **verdict** rule, not the ledger ("… cannot complete without verdict=pass") | same | same |
| **work** · any non-kind value (e.g. `plan`) | `{"ok":true}` | `{"ok":true}` | `{"ok":true}` |

TWO PRECISIONS this adds to the finding above: (i) the no-code exit and the message defect both live in the four
LEDGER-bearing kinds, so the residual is narrower than "a quality-kind task"; (ii) for `review`/`requirements` the
**verdict gate sits in front of** the ledger exemption — "the ledger does not apply" is true, but a payload with no
verdict is still refused; and (iii) **`plan` is not a task kind**: `TASK_KINDS` is
`requirements, implementation, verification, review, repair, integration, work`, so the 2b plan task is `kind=work`,
and the completion gate never validates the kind (it trusts the stored value; `isTaskKind` is a create-time check).

LIVED INSTANCE OF THE ROUTING REMEDY — and the sharpest distinction in this row (lane C, corroborated here from
the ARCHIVE rather than from its message): `t35` (kind=work, assignee `watchdog-engineer`, **completed**) landed a
**non-`evidence/**` deliverable** — `agent-references/troubleshooting.md`, present in its `changedPaths` together with
its own evidence files — because that seat HELD the write tools and the path was inside its `inScope`; the artifact
channel was never the path used. So the `evidence/**` rule binds the **channel**, not the workspace: a capable seat
writes where its contract says, while a read-only seat is locked out of **both** paths for DIFFERENT reasons — the
channel by the `toolDeny` predicate inside `writeTaskArtifact`, the filesystem by the roster's exported deny list
(`write`, `edit`, `mpd_hashline_edit`, `bash`, …). That is the mechanical reason re-scoping unlocks neither, and it is
why the routing remedy is the one with a lived instance rather than a projection.

### 4e. The CARRIER-FROM-PROSE class (exhibit material for the methods table)

The AC-12 exchange turned into a natural experiment: three carriers were copied from PROSE rather than from the
file, by two seats, and each was caught by the other. Homes are measured in the mailbox record
(`.mpd/team/friction-p2-wave/inbox/*.jsonl`), not remembered:

| # | the carrier as it was written | its home (measured) | caught by |
|---|---|---|---|
| 1 | `wi[th …]` — a bracket presenting a PARAPHRASE as an elision of words that are actually different (a SECOND literal, `wi[th its unit]`, also occurs — see the metacharacter trap below) | both mailboxes, measured **2026-09-17T09:55Z**: **8 lines / 10 occurrences** — lane A 6 lines / 7 occ (`architect.jsonl`: `wi[th …]` ×6 + `wi[th its unit]` ×1); the Architect 2 lines / 3 occ (`wi[th …]` ×2 + `wi[th its unit]` ×1). The class grows with every message on the thread, so a reader re-takes this row | the Architect |
| 2 | a code-span ADDED around `t2` that the file does not carry | the Architect's message to me (`agent-teams-engineer.jsonl`, 1 occurrence) | lane A |
| 3 | "with its unit" — the paraphrase itself; the file says "with the revision classified" | messages only: **0** occurrences in my durable files (the two tree-wide hits are other lanes' own phrasing, never a quote of AC-12) | the Architect |

The two variants of instance 2, side by side, because that difference IS the class:

```
as written in the message : (the number the `t2` review measured)
as the file's bytes are   : (the number the t2 review measured)
```

METACHARACTER TRAP, measured, because the row's number was challenged and the challenge was neither right nor
wrong for a reason worth recording — and because my own inference about the challenge was WRONG: the Architect passed
the ESCAPED form (`wi\[th`), which does measure the bracket, and returned 6 lines at that moment; the 8 lines measured
here later is the same pattern at a later moment, the delta being the messages exchanged since (self-inclusion again).
The trap lies in the UNESCAPED spelling, which is what this paragraph measures: the pattern `wi[th` is an **UNCLOSED
character class** in BRE/ERE. `grep 'wi[th'`
does not return a count at all — it **REFUSES**: `grep: Unmatched [, [^, [:, [., or [=` — while a tool that accepts
the same string as a class searches for `wit|wih`, a DIFFERENT carrier. Only the literal (`grep -F 'wi[th'`, or the
escaped `wi\[th`) measures the bracket. So a carrier census must state, every time, SIX parameters: the **literal string**, the
**pattern AS PASSED including its escaping**, the **tool mode** (fixed vs regex), the **unit** (lines vs occurrences),
the **scope** (which mailboxes) and the **moment** — this exchange paid for each of the six in turn (the two-literal
finding sits inside the first parameter, the escaping trap inside the second, the MODE parameter's own inside the
second as well — `grep -cE 'ADMISSION (lane A)'` returned **0** while the string WAS present, because ERE read the
parentheses as a capture group; a fixed-string probe (`-F`) returned **1** — and the moment inside the sixth). CASE
FOLDING BELONGS INSIDE "PATTERN AS PASSED", filed by the Architect after its own near-miss: **a case-insensitive search
is a DIFFERENT pattern, exactly as a fixed-vs-regex search is** — its probe for `surface-independent` returned 0 against
a file that writes `SURFACE-INDEPENDENT`, and my earlier lower-case `file-level pattern` missed the capitalised
`FILE-LEVEL` for the same reason. Two seats, one parameter, paid twice; state the case or you have measured a different
query. AND THE
SPLIT MUST SUM WITH THE TOTAL: the six instances are exhaustively **four purely lane-A, ONE SHARED** (the bracket
carrier — its occurrences span both seats' mailboxes, 6 lines/7 occ lane A and 2/3 the Architect) **and one the
Architect's**; a sentence of mine said "four of them lane A's" and silently dropped the shared instance, which is the
same defect as an unclassified bucket — the total may move, but the split has to move with it. PREDICATE AND MOMENT,
because this claim moved too — and its count is **SELF-INCLUDING**: every occurrence in this note of the wording my
wrong sentence used sits inside the admission clauses that report it (writing the number down would add another), so the
earlier "grep: 0 occurrences" was true at its moment and false bare. The stable reading is the PREDICATE, not the total:
**as a standing assertion / as the split — 0.**


WHAT MAKES THIS EXHIBIT USEFUL: the correct form ("with the revision classified") appears in the mailbox record
as **6 message lines / 9 occurrences**, split **4 lines / 6 occurrences authored by lane A** and
**2 lines / 3 occurrences by the Architect** — and **0** by the captain. The single line in `captain.jsonl` is a
lane-A message TO the captain (id `c842de24`), which is what an author-blind mailbox count gets wrong; and the
number MOVES WITH THE MOMENT, because every message about this census contains the carrier (the message this
sentence answers is itself one of the two Architect lines) — totals stamped **2026-09-17T09:52Z**. THE STRUCTURAL CAVEAT,
added by the Architect after re-reading per file: **a census OF messages is SELF-INCLUDING** — the message that reports
the total adds one to it. Their 5 lines was not a collapsed read but the state immediately BEFORE their own census
message landed (`a45e5f27`), so both totals are correct at their moments and quoting either bare is wrong. Any such
total therefore needs BOTH its moment and the note that the reporting message is itself in the corpus; the observer
effect is the reason this row can never be frozen. Meanwhile the
wrong paraphrases appear **0** times in any durable file of mine — i.e. the class is invisible in exactly the place a reader looks (the artifact) and visible only in
the place a reader trusts least (the message). THE RULE THAT FOLLOWS, and §4a already implements it rather than
merely stating it: **extract the carrier from the file programmatically and assert byte-exactness**, so the quote
carries its own verification (289 chars, one em dash, un-re-wrapped). A prose quote is only as good as the
author's care; the exchange has now demonstrated that failure in both directions.

FOURTH AND FIFTH INSTANCES, all inside THIS paragraph, and the paragraph is therefore the densest exhibit in the
set for the methods table: (4) its first draft wrote the mailbox split as "(2 outbound + 3 inbound + 1 captain)"
where the measurement is not a three-way outbound/inbound/captain split at all, and (5) the punchline counted
occurrences while claiming a mailbox census, and attributed the `captain.jsonl` line to the captain although it is
a lane-A message TO the captain (caught by the Architect, who counted per mailbox). Corrected form, measured twice
(plain `grep` and a JSON parse, agreeing): **6 lines / 9 occurrences — 4/6 lane A, 2/3 Architect, 0 captain**, with
the moment stamped because the total grows every time we discuss it. Both instances are recorded rather than
smoothed: a paragraph about carriers copied from prose re-entered the class twice while describing it.

CARRY-FORWARD FOR 2b (a NOTE, not a request — the owning task is terminal): `agent-references/troubleshooting.md`
already carries the row *"a search that returns nothing is a reading of the SEARCH, not of the tree."* The companion
sentence this thread produced, in the Architect's wording, is **"a count is a reading of the search too: state the
pattern verbatim with its escaping and the tool mode, or the number measures the query rather than the corpus — **and an
ABSENCE recorded in a durable artifact re-takes its own count: state the pattern AS PASSED plus what the reporting
sentence excludes, or the record eats the measurement.**"** (Both halves are measured: this note's own ADMISSION sentence
falsified two of the three patterns whose absence justified it — `file[- ]level` and `0 remaining` each return 1, both
hits being that sentence — while the escaped `\.[a-z]{2,4}:[0-9]{1,4}` still returns 0, because a pattern quoted in
escaped form cannot match the sentence that quotes it. That is the property worth copying: escaping the quote is what
stops a record from eating its own measurement.)
Nobody on this thread owns that file now (lane C's `t35` landed it and is terminal), so this is filed here for the
captain to mint in 2b rather than edited from outside its lane. GATE COST, measured so the 2b dispatch can size it:
`agent-references/**` is **not** a `VENDOR_LOCK.json` asset — the lock's assets are `skills` (323 files), the
agent-teams `_deps` closure and four MCP dist files — so this edit triggers **no corpus re-pin**; only the pack
closure sees it, as the per-file expected drift the wave's single re-pack absorbs.

NOTE ON THE HEADINGS: neither 4e nor 4g carries a count any more. Both grew an instance AFTER their first draft (§4e
from three to six once the self-caught pairs and my misattribution were admitted; §4g from three to four when the
recorded-reading instance arrived, and to five when `code-reviewer`'s gate-matrix instance was filed), so a number in a
heading decayed exactly like the census numbers in 4e's own rule —
the headings now point at the list, and the list carries the count. The removal was safe for a MEASURABLE reason, not a
stylistic one: no durable artifact quotes either heading by its count — every cross-seat citation uses the section id
(§4e, §4g), never a number — so nothing downstream had to move with the heading. THE CLASS IT BELONGS TO, in the Architect's words: **a count may
live only in a carrier that can carry a moment — a heading cannot.**

### 4f. The artifact channel's `evidence/**`-only rule for a DENIED seat — the routing-vs-capability class, mechanism confirmed (candidate register row)

CONTEXT, from the live wave: `t5` (Planner, repair of `R2-F-1`) delivered the staged bytes and then FAILED with
`T5-GATE-1`: "THIRD INSTANCE of the routing-vs-capability class (captain log §A-55) … a generated repair was routed
to a read-only seat whose acceptance requires (a) a write to `.mpd/plans/**` — outside the seat's only sanctioned
channel — and (b) two sha256 digests, which need a shell. **The inScope widening by the captain does NOT unlock the
channel: the refusal is emitted by the platform's artifact writer, not by the inScope validator.**"

MECHANISM, read from the shipped code — cited by SYMBOL and by the refusal string, never by line number (T-55), with
the file revision recorded so the quoted block is checkable: `packages/mpd-agent-teams-plugin/lib/tools.js`, function
`writeTaskArtifact()`, revision sha256 `6021bf6dfce594ed2f0f855cd4b75decb12cc71abc29d17c3b7775c92e32092d`:
- `writeTaskArtifact()` looks up the caller's member entry and its deny list:
  `const denied = new Set(memberEntry?.toolDeny ?? []);`
  `const readOnly = identity.kind !== 'captain' && ARTIFACT_WRITE_NAMES.some((name) => denied.has(name));`
- and then refuses anything outside the evidence tree:
  `if (readOnly && !relativePath.startsWith('evidence/')) throw new Error('a READ-ONLY seat (write/edit/bash denied) may write artifacts only under evidence/** — its sanctioned append-only channel; got "…"');` — the same rule is stated in the tool's own `description` string, so the contract a seat reads and the guard it hits agree.
- The predicate reads **the seat's `toolDeny`**, never `inScope`, and the captain is exempt by `identity.kind`.
  That is exactly why a captain-side inScope widening cannot unlock it — the finding is right for a measurable reason.

COST OF THE CLASS as measured today: four dispatch rounds — `t38` and `t41` in wave 2a (both repaired by the captain
in one turn, refusal reasons in the archive), `t3` and `t5` in wave 2b — each costing an attempt plus a re-dispatch,
with §A-55 naming the class. REMEDY OPTIONS, cheapest first:
1. **Routing-side (no code change, and the shape `t6` already prescribes):** a generated repair whose acceptance
   requires a write outside `evidence/**` (or a shell) must not be routed to a seat whose `toolDeny` names a
   write-capable tool; it is a captain task or a write-capable seat's task BY CONSTRUCTION.
2. **Staged-bytes pattern (demonstrated, one captain turn):** the read-only seat writes the exact bytes under
   `evidence/**` and the captain lands them — `t5` delivered `…-A2-to-land.md` for exactly this, `t6` passed with
   it, and `t6`'s carry-forward is the one-line append plus the two digests.
3. **Channel-side grant (larger, deliberate):** let the task contract carry an explicit artifact-channel allowance
   for a named path. Rejected here as first-line: it would weaken the property that makes the channel safe to hand
   to a denied seat (append-only, `evidence/**`, never the team state dir).

### 4g. A gate that RE-DERIVES from the tree cannot be green inside the window of the writer that invalidates it

RULE, adopted from the Architect's formulation because every instance below is measured: **a gate that re-derives a value
from the working tree cannot be green inside the window of the writer that invalidates it, so that gate belongs to the
INTEGRATION step, not to the lane.**
- **INSTANCE 1 — this lane (the strongest form, because the gate and the writer are the same actor):** editing ANY region
  body invalidates the derived registry until `scripts/patch-agent-teams-fixes.mjs --write-registry` runs; `--check` is
  blind to an unregistered region, so the heal suite (`self-fix-tests/registry-context-heal.test.mjs`) is the instrument
  that catches the miss, and the region count can only be re-derived after the edit.
- **INSTANCE 2 — the corpus lock:** `skills/dsh-qa/scripts/agent-teams-messaging.mjs` holds `LOCK_PATH` and recomputes
  VENDOR_LOCK's `skills` treeSha from the working tree (its own comment says the recompute exists so the self-test can PIN
  the lock), failing with `VENDOR_LOCK skills asset is stale: lock=<count>/<treeSha12>…`; `test:qa` runs every `--self-test`,
  so it cannot be green in the window of the writer that edits the corpus.
- **INSTANCE 3 — the same edit seen from the wave:** the single `skills/**` writer's change invalidates the lock whose
  re-pin is the captain's integration step, which is why A1's remedy follows from the rule rather than from taste — the
  lane runs `run-qa-lanes.mjs --check-drift` plus its selected corpus lanes, carries the lock line as `expected: "reported"`,
  and `test:qa` stays integration-only.

- **INSTANCE 4 — a lane's RECORDED DERIVED READING, added after `code-reviewer`'s pointer:** a corpus digest
  recorded in an evidence file is moment-bound for the same reason, so it must be re-derived at the re-pin write and
  must never be quoted into an amended plan (its `t15` record is the instance; the digest is not wrong, it is
  pre-`write`). This is the rule reaching past gates into READINGS, which is why it is stated here rather than left to
  the lane that paid for it.

- **INSTANCE 5 — a lane's GATE MATRIX pinned to the revision it measured, filed by `code-reviewer`:** its
  `evidence/review/gate-ledger/20260917T095500Z/README.md` carries a section titled "MOMENT-BOUND (the rule applied to
  this reading itself)" binding the matrix to `quality-gates.js` revision sha256 `1b0eb60e…` and instructing that it be
  RE-DERIVED if that file moves and never quoted into an amended plan as a later-revision property. This is the FIRST
  instance in the set where the remedy was applied BEFORE the decay was observed rather than discovered after it — the
  form to copy, and the reason it is filed here as an instance rather than cited as agreement.

- **THE RULE IS SURFACE-INDEPENDENT — code, prose and MESSAGES alike: quote the phrase, never the position.** The
  message surface produced MORE instances in this thread than either file did: "item 4" in a reply is a line number in a
  message and rots the moment the referent moves (one of ours rebutted an already-closed item that way), and two state
  lines of mine carried no moment for the same reason. Quote the phrase, the id or the sha; a POSITION — line number,
  numbered item, offset — is never load-bearing.
  AND THE ADDRESS MUST BE **MATCHABLE**, not merely immutable — filed by `code-reviewer` after its own probe returned 0
  on a sentence that IS present: a phrase WRAPPED across lines cannot be found by a line-based grep (the Architect's
  class sentence returns **0** as a whole sentence and **1** as the fragment `carry a moment`, measured above). THREE AXES, and the SUFFICIENT form — filed by `code-reviewer` after it probed this very clause and got 0 **with
  `-F`**, so the tool mode alone is necessary and not sufficient: (1) decoration, (2) case, and (3) **punctuation the
  quoting MESSAGE introduced** — and its MIRROR, filed by `code-reviewer` against its own probe one turn after this axis
  was filed: **the SOURCE's spelling is part of the pattern too.** A probe for `63775` returned **0** BEFORE this clause
  landed and returns **1** after it — this sentence quotes the comma-less spelling, which is the self-inclusion effect at
  the level of the FILE (a clause that quotes a spelling increments it); the comma form moved from **2 → 3** at the
  revision that filed this clause and back when the clause was reworded to state the MECHANISM instead of quoting the
  string again. That is the treadmill in one sentence: **a clause about quoted spellings changes the counts it reports
  with every edit**, so the durable form is the mechanism plus a date, and the reader PROBES rather than inherits —
  which is why no current total is stated here. The comma is in the text, so the string passed must carry it. A handle is a string with a spelling, and
  punctuation can be lost in either direction — added by a quoting message, or dropped by the prober. `-F` neutralises decoration-as-operator but not a quote mark the message added:
  `grep -cF 'CURRENT IS NOT A CITABLE PROPERTY'` → **0** while the stored bytes are
  `"CURRENT" IS NOT A CITABLE PROPERTY OF A FILE` → **1**. THE SUFFICIENT RULE, measured across all three axes:
  **anchor on the shortest bare TOKEN carrying no markup, no quote marks and no case-folded letters** — `CITABLE`
  matched under every probe; nothing longer did. Quote the
  SHORTEST DISTINCTIVE FRAGMENT that fits one line, or state that the search must be wrap-insensitive — otherwise the
  rule produces unfindable addresses while curing rotted ones, the same class one level up.
  TWO WRAP INCIDENTS in this family, both within one turn of the rule being filed, both "pattern AS PASSED" failures:
  (i) **this lane's** fixed pattern containing a NEWLINE, run against a phrase this file wraps — 0 on present text
  (the seat name added on the Architect's correction: its first item had no attribution while its second named one, so the
  pair read as if both were the same seat's — the TWO FILED victims are one of this lane's and one of the Architect's,
  while the family's THIRD victim (the Architect's inference from a read instead of a probe) is deliberately NOT in this
  list: the stop condition kept it out, per its own scope clause); (ii) the
  Architect's probe for `CASE FOLDING BELONGS` against the case-folding clause, which wraps between `CASE` and
  `FOLDING` — 0 on present text again, and run while verifying the sentence that states the parameter. **AND A WRAPPED PHRASE IS
  MEASURED BY THREE PROBES** — the Architect's instrument, filed as a MECHANISM rather than a sixth instance of this
  family, per the stop condition's own scope clause: **head half → 1**, **tail half → 1**, **joined phrase → 0**, where
  the zero from the JOINED probe is the PROOF of the wrap rather than of absence. A single probe can only report which
  mode it happened to use; the trio is the reproducible form, and it is the six parameters one axis further out — not
  how the pattern is passed, but where the LINE BOUNDARIES fall in the text it addresses. The MODE artifact
  of the same family (`-cE 'ADMISSION (lane A)'` reading the parentheses as a group while the string was present;
  `-F` → 1) sits in the parameter mapping above.
  A DECORATED-ADDRESS HAZARD, filed by `code-reviewer` — **CORRECTED (nested)**: the first version of this paragraph
  called it a "third wrap class" and blamed an unquoted shell `**`; both halves were wrong. The measured mechanism is
  REGEX, not wrapping and not globbing: **`**` reaches `grep` as REGEX OPERATORS** (the second `*` of each pair
  quantifies the space, then `B`), so a plain pattern stops denoting the literal phrase and returns 0 on text that is
  present. My own control arm reproduces the discriminator with single-quoted operands and the shell out of the loop
  (`evidence/agent-teams/regex-hazard/20260917T102003Z/`, `control.txt` = `A **B** C`):
  `grep -cF` → **1**, `grep -c` (BRE) → **0**, `grep -cE` → **0**, escaped `A \*\*B\*\* C` → **1**; and in THIS
  note the same phrase gives `-F` → **1**, BRE → **0** — **UNIT CORRECTED**: an earlier version of this sentence said
  "on the real file … `-F` → 2", which was a **two-file sum** (`phrase.txt` 1 + this note 1) wearing a one-file label;
  each file yields 1, the pair yields 2.
  THE REMEDY THAT SURVIVES MEASUREMENT — **PARTLY SUPERSEDED by the sufficient form filed ABOVE (the three-axis rule:
the shortest bare TOKEN); this list remains the remedy for the REGEX hazard itself**: **use `-F` for a quoted phrase, or escape the asterisks, or match the bare
  token** — not "quote your asterisks" (the shell never touched them: the operands were single-quoted, and the
  unquoted form expands to FILENAMES, which is the separate trap my own test hit). True LINE WRAPPING remains a
  distinct leg and its two instances above still stand; nothing in the decoration instance was wrapped (the phrase is
  one 119-char line). `code-reviewer`'s own audit page called it a wrap class too and is corrected the same way.
  A PROCESS RULE FOR 2b, filed by `code-reviewer` and hereby carried as a 2b candidate rather than a preference:
  **a message that asserts a file's state should carry the SHA IT READ — not "current", not "now", the hash it actually
  saw.** Then a recipient can tell in one comparison whether the message crossed an edit, and a ladder becomes
  diagnostic rather than apologetic. Measured cost that justifies it: **five crossings in one evening** between two
  careful seats on one file, none of them an error and all of them avoidable with the sha in the message. The
  two-homes arrangement is the companion nomination for the report's rules section — copy the arrangement, not the
  content.
- **"CURRENT" IS NOT A CITABLE PROPERTY OF A FILE** — a RULE addition, not a sixth exhibit of the saturated family
  above. A message is written BEFORE it is read, so its top rung is unreachable BY CONSTRUCTION; `code-reviewer`
  measured three reads inside ~60 s (`62b3aa95…` 49,767 B → `e68a54e8…` 50,397 B → `33d62d60…` 51,097 B), i.e. a
  "current" claim 1,330 B and 13 lines behind within a minute. The honest forms are exactly two: **a NAMED revision
  plus "it has moved since"**, or **no revision at all** (record what you READ and claim nothing about current). The
  ladder-in-the-message habit is therefore correct but not sufficient — it names the rungs, never the top one.
  AND A HANDLE YOU DID NOT COMPUTE IS A CITATION OF SOMEONE ELSE'S READING (the Architect's clause): **the sha names the
  content, the WRITER names the reading** — quote such a handle with its author ("as you report") and re-take, as your
  own, every pattern you assert. That is why one seat may publish sizes and shas while the other computes only the
  patterns it quotes: the division is legitimate when the attribution travels with the number. AND SILENCE IS NOT
  CONFIRMATION — `code-reviewer`'s terminal condition, filed because it is a rule about records and not a courtesy: a
  seat that has declared it will stop verifying contributes **no endorsement by saying nothing** (it honoured that
  literally: a whole turn without reading this file, so the revisions after `422d7a850a2b3367…` are THIS LANE'S readings
  and nothing in its record endorses them). A figure quoted upward must therefore carry its author, and an unverified one
  must be marked unverified rather than treated as agreed — the same rule that makes a handle one's own.
  AND AN ORDINAL NEEDS ITS HEAD (filed by `code-reviewer`, and it is the same ladder one rung up): a rung number is
  meaningless without the end you counted from — `58,813 B` is the **TENTH** rung head-anchored at the revision called
  "current" (49,767 B) and the second from the tail, so two seats can both be right and disagree. Bytes need a sha,
  counts need a unit, revisions need a moment, and ORDINALS need a head — AND A RE-COUNT, added by `code-reviewer` after its second off-by-one of the exchange
  (58,588 B labelled "eighth", actually ninth; 67,858 B labelled "twentieth", actually twenty-first): **an append-only
  list is exactly where a label stops matching its position**, so a rung number needs the head AND the enumeration it was
  counted against — which is why its final form is the programmatic one, each rung a distinct measured SIZE rather than a
  label — AND A QUOTED LADDER FIGURE NEEDS ITS RUNG
  (filed by `code-reviewer` after my own summary line quoted its totals without one): its `+14,008 B / +130 lines` was
  measured at the FIFTEENTH rung (63,775 B) and its "thirteen rungs" at about 61,018 B, while at the SEVENTEENTH rung
  (64,689 B) the totals read `+14,922 B / +138 lines`; the file has taken three edits since, so any total here is a
  reading at a rung and never a property — and the FIFTH form, for TOTALS, is the
  preamble's `OBSERVED, not total` unit (two homes, cross-cited; the family is listed here as four plus a pointer rather
  than restated as five, because each form lives where it was paid for).
- **RESIDUAL LIMIT OF THE LADDER — the one thing the protocol cannot cure** (filed by `code-reviewer`): **the READING is on disk
  (the MESSAGES survive — `.mpd/team/friction-p2-wave/inbox/*.jsonl`, 610 records at this revision); the SUBJECT is not**
  (the intermediate working-tree revisions were overwritten in place). CORRECTED from the first form of this bound, which
  said "the ladder survives in the messages; the rungs do not survive on disk" — measurably wrong on both halves: the
  messages ARE on disk, and what fails to survive is what they were readings OF. Arbitrability therefore belonged to the
  MAILBOX, not to the artifact — `62b3aa95` appears in **5 LINES** of this lane's mailbox and **2** of `code-reviewer`'s;
  `63,775` in **7 OCCURRENCES** vs **6**; `62,712` in **6** vs **5** (predicates named, because the two units differ and
  this sentence originally carried three numbers I had not measured at all — corrected against the probes) — and the mailbox is TEAM STATE, which the captain's standing rule archives or
  deletes when a wave lands: **tonight's ladder survives only until the team does, unless the readings are copied into
  the wave's evidence first. AND THE DIRECTION SURVIVES WHEN THE RUNGS DO NOT (added by `code-reviewer` from the same
  series): every later reading was taken against the file's CURRENT bytes and matched them, so a TREND — "it has moved
  since" — is checkable even when no intermediate step is recoverable. That is the most a non-committing reader can
  extract from a moving file, and it is why a ladder still supports claims about direction after its steps are gone. A landing claim becomes arbitrable only by COMMITTING the
  revision (the captain's act) or by keeping a copy; where neither exists, the honest form is "a reading at `<handle>`"
  with the bound named — which is how the two seats closed this one.
CITATION FORM, and it splits by SURFACE (the Architect's distinction, verified here):
- **CODE — symbol + failure string + the file's revision hash.** Line numbers are NOT part of the record (T-55 — one
  drifted from off-by-3 to off-by-15 before a review caught it), which is why §4f's quotes carry the revision sha instead.
- **PROSE — the quoted PHRASE; a line number is optional and never load-bearing.** Measured: the pointer this lane DROPPED from §4b (that
  report's line 147) still landed on `` `1 fail / 2202 expects` `` while that file grew to **289 lines**, so the pointer was accurate AND a rot surface
  (one insertion above it moves it) — while the literal string finds it from any line. The two prose pointers in §4b were
  dropped on this ground: the sentence already carries the search string, so the numbers cost nothing to remove and were
  the last rot surface in that paragraph.
  COUNTER-EXAMPLE, audited by `code-reviewer` in its OWN sealed evidence (the seat that flagged this form): two register
  citations had already rotted — `.mpd/TODO.md` T-19 rows written `:155`/`:517` are now `:163`/`:525` (**+8**, verified
  here) — while a captain-log ruling (`:180`; sha `a7dd677944fd8d92…`) and a tool pin
  (`packages/mpd-team-watchdog-plugin/test/holds-lifecycle.test.ts`, the assertion
  `expect([...ctx.__stub.tools.keys()].sort()).toEqual(["session-watchdog-hold","session-watchdog-resume","session-watchdog-status"])`, sha `133f3c6342961c64…`) still resolves. The
- **RELATIVE QUALIFIERS ROT — a third shape, found by lane B3 while checking a state line:** `(= HEAD)`,
  `current`, `latest` are pointers into a MOVING sequence, so a pin that says "at commit `95324d4` (= HEAD)" becomes
  false the moment someone else commits. Lane B3's clause (f) dropped that qualifier and now reads "at commit `95324d4`
  (immutable commit id — HEAD moves, this pin does not)" — the third variant of the same lesson inside ONE clause, after
  the END (`§4b–§4g`) and the COUNT (`three instances`), each found by reading the clause after a peer's state line.
  The durable rule for all three: **an immutable anchor for anything stable; a moment plus a decay warning for anything
  moving; never a relative position for either.**
  durable index was filed BESIDE the sealed records rather than by editing them:
  `evidence/review/t21-status-line/20260917T083500Z/CITATIONS-durable-form.md`. Deliberately NOT filed as instance 6 of
  this section's derived-value rule: the mechanism is POINTER DRIFT in a citation, not a derived value measured inside a
  writer's window — pooling the two would blur the rule that makes each citable.
  AND THE REASON NOT TO WIDEN THIS HEADING, articulated by `code-reviewer` from the heading rule already applied here:
  the two failures have DIFFERENT remedies (re-derive at integration vs phrase-anchor), so one heading would carry an
  ambiguous remedy — and a heading that names two mechanisms cannot be tested for MEMBERSHIP, which is the same decay a
  count in a heading suffers. One heading, one mechanism; the citation rule's home is `CITATIONS-durable-form.md`, with
  this bullet as corroboration and pointer.
- **ADMISSION (lane A), appended because the Architect read both halves of this section AND the file:** my earlier claim of
  **"0 remaining line-number pointers"** was true for the three CODE sites I had fixed and **FALSE at the file level** — the
  grep had been scoped to code-shaped patterns rather than to the artifact, which is this section's own filtered-read
  defect. The FILE-LEVEL pattern (`\.[a-z]{2,4}:[0-9]{1,4}`) returns **0** at this revision — and it did NOT return 0 an hour
  into this section's life: the counter-example paragraph below reintroduced a pointer — a line number appended to the pin test's filename —
  while documenting the removal of two, so the claim was briefly false and is true only because that pointer was then
  replaced by the assertion text. Stated with its moment, because this is the third time a claim of MINE about pointers was falsified by the paragraph
  that made it. PREDICATE NAMED (the Architect's clarity clause, because two lines below the POST-EDIT STEP counts a
  THREE of its own): this count's subject is **MY CLAIM**, and its three are — (i) my "0 remaining line-number pointers"
  (the §4b prose pointers survived it), (ii) this section's "returns 0" (briefly false while the counter-example carried
  the pin test's line number), and (iii) the descriptive mention that reproduced the shape it described. The two lists
  hold the SAME THREE EVENTS under TWO SUBJECTS — §4b's dropped pointers, the counter-example's reintroduced pointer, and
  the descriptive mention, described once as MY CLAIM and once as the FILE's own zero — so they are two DESCRIPTIONS
  rather than two sets, and what differs is the subject. (Corrected: the earlier form of this sentence said "OVERLAP
  WITHOUT EQUALLING … item (i) differs on each side", which was true of the mapping in which the step's first item was
  this ADMISSION sentence — the item later withdrawn as uncorroborated — and false of the mapping now in place. The
  relation was DERIVED from the list, and the edit that changed the list invalidated it: §4g's rule one rung below its
  own home, inside the paragraph that carries it, and the fourth time tonight that a claim or relation ABOUT THIS
  FILE'S OWN TEXT was undone by its next edit — PREDICATE WIDENED on the Architect's reading, because the enumeration
  is one uncovered claim (the withdrawn identity item: an assertion about a past state, undone when the list it described
  changed) plus three derived sentences (the census claim, the step's three, this relation); under the narrower predicate
  "a DERIVED sentence invalidated by its own source" the tally is THREE. The recurrence, not this instance, is what a 2b
  reader should notice.) CLASSIFIED BY DEFECT, which is this section's per-item form and needs no widened
  predicate to carry an outlier: **(1) a FILTERED READ** — the census claim, false AT ITS MOMENT because the two §4b
  pointers were already on disk and the scoped grep missed them (the later edit made it TRUE, not false); **(2) an
  UNCOVERED CLAIM** — the withdrawn identity item; **(3) a DERIVED ENUMERATION** — the step's three; **(4) a DERIVED
  RELATION** — this sentence. The wide predicate covers (2)–(4) cleanly and (1) only loosely; the classification covers
  all four. AND EACH CLASS HAS ITS OWN REMEDY, which is what the taxonomy is FOR (the Architect's line, and it is
  the register row's payload rather than the tally): a **filtered read** is cured by WIDENING THE PROBE (which is exactly
  what caught it), a **derivation error** by RE-DERIVING AFTER THE WRITE (the post-edit step), an **uncovered claim** by
  MEASURING THE RECORD BEFORE ASSERTING IT, and a **derived enumeration** by RE-TALLYING WHEN ITS MEMBERSHIP MOVES. A
  reader with four labels can act; a reader with one number can only be impressed. Two counts, two
  subjects, two lines apart — named rather than left implicit, which is the six-parameter discipline applied to the
  prose that carries it.
- **POST-EDIT STEP (the guarantee, handed to the 2b reader):** run the file-level pattern
  `\.[a-z]{2,4}:[0-9]{1,4}` **AFTER every edit**, not once as proof-of-fix — this file falsified its own **0** three
  times — enumerated as the record supports them, after the Architect could not corroborate the first item I had listed
  (`BOUND: the ADMISSION sentence is NOT an independent break; it was never measured as one, and a past revision cannot
  be re-measured from this note` — corrected here rather than defended): **(i) §4b's two prose pointers**
  (`…REPORT.md`/`…review.md` + line, which the NARROW pattern matches — the original falsification of the "0 remaining"
  claim, since dropped); **(ii) the counter-example's reintroduced pointer** (a line number appended to the pin test's
  filename); **(iii) the descriptive mention that reproduced the shape while describing its removal**.
  WITNESS STATUS PER ITEM (the Architect's metadata, because the three are NOT equally witnessed): **(i) has an
  INDEPENDENT witness** — the Architect read those two pointers on disk before they were removed — while **(ii) and
  (iii) rest on this lane's report**, with the post-fix zeros as post-hoc support only. Weigh the "three times"
  accordingly when minting the row; the asymmetry is the same computed-vs-reported distinction the handle clause draws. A pattern check whose subject is the file being edited is invalidated by
  the next write, which is §4g's rule one level down: the writer invalidates the gate.
  CHARACTERIZATION FOR A WIDER GREP (filed by `code-reviewer`, who ran one): a broader search of this class will hit
  the prose phrase `line 147` exactly once — in the incident narrative above, not as a locator. That sentence does what
  the rule asks (the narrative carries the moment; the ADDRESS there is the search string `` `1 fail / 2202 expects` ``),
  and its wording is deliberately prose so that the pattern cannot bite on it. Both the narrow pattern and a wider
  `\.[A-Za-z]+:[0-9]+` return **0** at this revision. This
  line also corrects the first version of the paragraph above, which asserted the slip was "recorded beside the rule"
  while the record carried only the rule — a claim about a record made from a message rather than from the record, one
  level up from the slip itself. THE RULE THAT FOLLOWS, so the next reader inherits the imperative and not the anecdote:
  **treat "recorded in §X" as a CENSUS CLAIM — read the record before asserting the record.**

### 4h. The delivery gate cannot distinguish a CONTRACT-CORRECT failure from a broken task (candidate register row; lane A's surface)

MEASURED on `agent_teams_status`, wave `w2`, after `t6` PASSED: the team line carries **`[blocked]`**, `Loop: blocked`, and
**`Delivery: blocked (t2 failed without a follow-up repair; t4 failed without a follow-up repair; t5 failed without a follow-up
repair; t5 has unaudited path …/20260917T0945Z-wave-2b-plan-A2-to-land.md)`** — while the task list is exactly the
contract-correct chain: `t1` completed · `t2` review **failed on `verdict=needs_revision`** (which the completion gate
REQUIRES: "review with verdict=needs_revision cannot complete") · `t3`/`t5` repairs that failed on the **platform's channel
and ledger gates** rather than on content ("the completion contract is unsatisfiable from this seat"; "platform-blocked,
not forgotten") · `t6` review **completed, verdict=pass**.

THE DEFECT: two different terminal meanings put the delivery gate in the same state — **a failure the contract MANDATED**
(a review whose honest verdict is `needs_revision`) and **a failure of the platform's own channel** (a repair whose
deliverable is on disk but whose completion gate cannot be satisfied by its seat) both read as "failed without a follow-up
repair", so the wave cannot reach delivery without an explicit captain closure plus the landing step. Re-dispatch does not
clear it and reproduces the t18/t38/t41 routing pattern instead. The gate's own message is the evidence of the collapse:
it asks for a follow-up REPAIR in a chain whose repairs are precisely what the platform blocked.

CANDIDATE ROW, with the remedies in ascending cost: (1) the gate's message names the CLEARING ACTION (captain closure +
the landing) rather than "a follow-up repair" it cannot accept; (2) a repair whose acceptance is satisfied but whose seat
cannot use the write channel gets a distinct terminal state (`blocked-channel`) that the delivery gate reads as "repair
exists" — **EMITTED BY THE ARTIFACT WRITER, not inferred by the seat** (the Architect's sharpening, and it makes the
remedy implementable in one place): `writeTaskArtifact()` is the component that already knows the channel is unusable
because it is the one that emits the refusal, whereas asking a seat to classify its own channel failure asks it to
perform exactly the read it cannot perform. `t18`/`t38`/`t41` and `t3`/`t5` are then the same shape seen from opposite
sides: the seat cannot write, the platform will not accept. AND THE SYMBOL SHRINKS THE ROW (the Architect's follow-up,
re-verified here): `writeTaskArtifact()` lives in the delta region **`mpd-delta artifact-channel-helper`** (applied into
`tools.js` by the **`artifact-channel-apply`** region; `scripts/patch-agent-teams-fixes.mjs --check` reported **81 regions
across 9 adopted files, in sync, AS READ AT 2026-09-17T10:36:49Z** — a DERIVED value, true only until the next region
edit: a later writer RE-DERIVES it rather than inheriting the number, which is §4g's instance 1 applied to this
paragraph's own count) and it ALREADY COMPUTES the read-only predicate —
`const ARTIFACT_WRITE_NAMES = ['write', 'edit', 'bash']` — so `blocked-channel` is a **RECORD of a decision the emitter
already makes**, not a classifier a seat must run — and the reviewer verified the applied file one step further than the
registry could show: the decision is a NAMED BOOLEAN computed one line above the first throw,
`const readOnly = identity.kind !== 'captain' && ARTIFACT_WRITE_NAMES.some((name) => denied.has(name));`. So a reader
implementing remedy (2) does not have to LOCATE a decision: cite it by symbol — **`readOnly` in `writeTaskArtifact()`,
`lib/tools.js`** — never by line. The implementation site is the region that throws.
(3) if neither lands, the wave's close must carry the closure explicitly, as this one does.
WATCH-LIST (the Architect's, kept because it shapes a future row): naming the implementation site has SHRUNK a remedy
twice tonight rather than decorating it — the emitter region, then this boolean. Two is a coincidence; a third instance
makes *"name the implementation site before writing the remedy"* a RULE, and it would arrive as a rule rather than as
another example. BOUND, as the
Architect stated it: the constant, the docstring and the tool description were read in full; the per-guard throw texts
were read only in part by that seat. (This note's author read the refusal text itself earlier tonight.) 

AND MY OWN OMISSION, recorded because it is the same class: five of my state lines tonight reported "six tasks, unchanged"
from the task list alone and never quoted the `Delivery: blocked` verdict — a reading of ONE surface presented as the state
of the wave. The Architect's report is the correction, and the rule is the one this file already carries: state the surface
you read — and note the UNITS differ, which is why both are needed (the Architect's formulation): a task list is a
**SET of terminal states**, while the delivery verdict is a **STATE of the delivery**, and only the second carries the
block. A line that quotes the set and calls it the wave is this omission verbatim.

## 5. The count sentence's citation form (for any 2b copy of it)

`agent-references/agent-teams-deltas.md`: cite the count by **row id + region ids + the registry sha**
(`lib/mpd-deltas.js`), and RE-TAKE the sentence from disk — its sha changes with the count, so a sentence sha
is not a durable anchor either. The pointer range survives because new regions are folded into existing rows
(D27 = 3 regions, D40 = 2).

## 6. Durable-record status of the UNIT-LADDER instances this lane owns (added after the bounds review)

The bounds review flagged the class "a slip with no durable record" (its F-3). Applied to THIS lane's own two
count slips, the honest status is:

| instance | the wrong statement | durable record | corrected form |
|---|---|---|---|
| byte-vs-character | "+412" reported for a block delta that is **+416 bytes** (an em dash costs 3 bytes for 1 character) | **message-level only** — grep over `evidence/agent-teams/**` finds no record of the slip itself | the t55-era reading (+416 B) and the correction live in that thread and in the workmate persona note, not in an evidence file |
| lines-vs-occurrences | my per-file list summed to **16** and I reported **15** | **message-level only** (corrected in the same exchange) | sections 4 of THIS note carry the corrected ladder: **16 lines / 17 occurrences / family 3** |

Both slips are recorded here now, at the only level at which they can be recorded by this lane (a message is
not an evidence store), with the wrong value, the right value, the unit that separates them, and the reason the
wrong one was produced (an em dash for the first; mis-adding my own printed output for the second). The point is
not the arithmetic: it is that a methods table citing these instances needs a record each, and two of them had
none until this section existed.

## 8. T-92 gets a MECHANICAL audit (and the two scope traps it must avoid)

The docs lane's clause (d) states the rule; this section makes it runnable, because the audit for T-92 has the
same shape as the defect: **the matcher must know its subject**.

Scope rule: an absence assertion must be evaluated **against the file its SUBJECT came from**, not against the
tree. Mechanically: parse each arm for its own binding (`const <var> = readFileSync(join(libDir|LIB_DIR, "<file>"))`),
then test only `expect(<var>).not.toContain("<literal>")` against that file.

Readings (lane A's surfaces, `self-fix-tests/**` + `test/**`, 33 arms scanned):

| reading | value |
|---|---|
| `not.toContain(` occurrences over those two directories | **42** (25 self-fix-tests + 17 test) |
| subject-scoped absence assertions over MODULE sources | **3** (`watchdogHoldOf`, `mpd-delta watchdog-hold-reader`, `watchdog-hold-reader`, all on `lib/tools.js`) |
| of those, REDDENED | **0** — none of the three literals occurs in `tools.js`, code or comment |

TWO SCOPE TRAPS, both paid by me today on this very audit, and both are the class it hunts:
1. **Whole-tree literal scan OVER-reports**: my first version tested every `not.toContain("…")` literal against
   every lib file and returned **16 reddened** — all false, because the assertion's subject was ignored (the
   scheduler legitimately keeps `watchdogHoldOf`, and the pin's subject is `tools.js` only).
2. **A glob with a file-type assumption UNDER-reports the base rate**: my first re-take of the docs lane's 42
   used only `*.mjs` in both directories and read **32**; the true count over both directories (all files,
   including `test/**`'s `.ts`) is **42 = 25 + 17**. The number was right for ITS scope and wrong for the one
   being quoted — the same predicate/scope class as the census/executed-set instance, now in the audit itself.

### 8a. Raw evidence for the packed-artifact census (the measurement §A-52 cites)

Command, then its verbatim output:

```
$ find dist/mpd-package -name '*.test.*' -type f | sort
dist/mpd-package/skills/programming/scripts/typescript/check-no-excuse-rules.test.ts
dist/mpd-package/skills/visual-qa/scripts/ansi.test.ts
dist/mpd-package/skills/visual-qa/scripts/cli.test.ts
dist/mpd-package/skills/visual-qa/scripts/east-asian-width.test.ts
dist/mpd-package/skills/visual-qa/scripts/image-diff.test.ts
dist/mpd-package/skills/visual-qa/scripts/png-decode.test.ts
dist/mpd-package/skills/visual-qa/scripts/tui-grid.test.ts

$ find dist/mpd-package -name '*.test.*' -type f | wc -l
7

$ find dist/mpd-package/packages -name '*.test.*' -type f | wc -l
0
```

SPLIT: **1** under `skills/programming`, **6** under `skills/visual-qa`; **0** anywhere under `dist/mpd-package/packages/`.
READING: the corpus ships its own script tests; no PLUGIN ARM travels. So a sentence of the form "no test ships in
the artifact" is FALSE as measured, while "no plugin arm travels" is true — and lane C re-measured the same seven
independently (its A21). This is the measurement captain log **§A-52** records and report §6 will cite in the
post-`t39` addendum; the RULE (artifact-behaviour vs repo-arm reading) lives there, not here. My own mislabel on
the first run — I labelled this output "(empty = no instrument travels)" — is the reason the raw form is filed
beside the audit rather than summarised.
