# Plan errata E1b — FINAL text for the wave-2b plan's amendment A1 (supersedes E1; append, never edit the plan body)

Found by the author while re-checking the captain's dispatch wording against the delivered artifact. Two fields differ; nothing else in
the plan changes. The plan body stays byte-identical, which is what the plan review judges.

## ER-1 — label precision: lane B3's clause set is (a)–(e), not (a)–(d)

The authority is captain log **§A-53**, whose own index counts lane B3's `reading_bound.for_wave_2b` clauses **(a)–(e)**. The field
in `evidence/gates/t75-derived-values/20260917T072029Z/result.json` is a SINGLE 2000+-character JSON line, so a line-viewer read
truncates mid-(d) — which is why the plan wrote (a)–(d). **Substance check:** all five things §A-53 attributes to the set ARE
routed by the plan — the three live re-takes of one derived sentence (79 → 81) with the sha-anchored citation that never rotted
(§9 rule 4), the durable-citation form (row id + region ids + registry sha, §9 rule 4), the many-to-one D-row→region relation
(§3, lane B3), the T-92 sibling trap (§5 lane A's T-92 row), and the audit discipline (§3) — so this is a label fix plus one rule
that the plan carried as context and now carries as an ACCEPTANCE constraint (ER-2).

## ER-2 — one missing acceptance constraint: an absence-assertion audit must NAME the directories it covers

Lane B3's clause set includes a predicate the plan carried only as context (§3) and never as an acceptance shape: the T-92 audit's
**two matcher-error directions measured on ONE audit**, with the base rate stated so the scope is recoverable.

**APPEND THIS TO LANE A's T-92 row (and to any lane doing a T-80/T-92 audit):**

> the audit must NAME the directories it covers and report the base rate in each — measured: **`not.toContain(` occurrences = 42,
> 25 under `self-fix-tests/**` + 17 under `test/**`**; scoped to its SUBJECT (`lib/tools.js`) the auditing set is **3**, of which
> **0 reddened**. Two error directions must be declared as such: a **whole-tree literal scan OVER-reports** (16 "reddened", all
> matcher artifacts) and a **glob with a file-type assumption UNDER-reports** (`*.mjs` in both directories read 32 against the true
> 42). So a T-92 (or T-80) audit is admissible only with (i) the directories named, (ii) the occurrence count per directory, and
> (iii) the subject-scoping rule — evaluate an absence assertion against the file its SUBJECT came from (lane A's §8 is the runnable
> form: parse each arm's own binding, then test only assertions on that binding).

**Why it matters for 2b:** T-80 (a driver header's `A<n>` claims unchecked against its own assertion keys) and T-92 are the same
shape from both sides, and 2a paid for both directions of the matcher error on a single audit. A 2b audit that does not name its
directories is the under-report trap waiting to happen.

Authority: captain log **§A-53** (the hand-off index) + lane A's
`evidence/agent-teams/wave2b-notes/20260917T091500Z/2b-refinements.md` §8/§8a (the runnable method) + lane B3's
`reading_bound.for_wave_2b` (c)/(d) + `.mpd/TODO.md` T-92 (row at :907).

**Editorial note:** this file supersedes `20260917T0945Z-wave-2b-plan-ERRATA-E1.md`, whose opening paragraph carried a drafting
fragment; the two files agree on every substantive clause.
