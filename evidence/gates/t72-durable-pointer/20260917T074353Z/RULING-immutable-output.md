# RULING on the second consumer — ROUTING CLOSED (nested note; supersedes the "ROUTED to t11" wording)

The captain ruled after `t25` reached terminal. `ADDENDUM-COMPLIANCE.md` and the task output both say
the second consumer was "ROUTED to `t11`"; **that wording is superseded by this ruling** and is kept
on disk rather than edited in place.

## The ruling

* `skills/dsh-qa/scripts/lib/immutable-output.mjs:14-15` is **DECLARED DELIBERATELY FROZEN** to the
  wave-2b rollover. It could not ride the single re-pin because `t11` reached terminal without
  touching it (re-verified here read-only: `git status --porcelain` for the file is empty, and lines
  14-15 still read "Used by evidence/extensions/docs-claims/check-citations.mjs and
  evidence/extensions/debranding-probe/<ts>/verify-debranding-full.mjs (T-53's named drivers).").
* Classification STANDS as filed: **ACCURATE-BUT-INCOMPLETE** — every word is true; the sentence
  simply does not name the live driver, `scripts/check-citations.mjs`.
* Its natural 2b home is **`T-66`** ("nothing audits the paths the manual names against disk"), which
  will find it by construction.
* The missed deadline is recorded by the captain as a process failure of the ROUTING instruction
  (a deadline-bearing instruction needs a receipt, not a send), **not** as a gap of lane B2.

## What this means for lane B2

Nothing to do: no `skills/**` write, no re-pin contribution, no open attempt. Chain of record for
this site is now: ACCURATE-BUT-INCOMPLETE (t25 evidence) → ROUTED to t11 (ADDENDUM-COMPLIANCE.md) →
**DECLARED DELIBERATELY FROZEN, 2b home T-66 (this note)**.
