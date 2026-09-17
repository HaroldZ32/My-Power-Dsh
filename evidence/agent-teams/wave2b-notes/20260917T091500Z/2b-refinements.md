# 2b notes from lane A (wave 2a close) — refinements that are NOT landed

**Filed by:** `agent-teams-engineer` · `2026-09-17T09:1xZ` · per the captain's decision "take option (b): record the
refinement as a 2b note in your lane's evidence; do NOT open a task for the leaner wording".

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
