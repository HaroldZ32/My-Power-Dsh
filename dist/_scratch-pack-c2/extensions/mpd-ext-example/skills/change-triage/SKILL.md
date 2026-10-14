---
name: change-triage
description: "Reference extension skill: triage a code change before review (what changed, what it touches, which risks deserve a reader). Use when a code diff needs a first pass before a human or reviewer looks at it."
---

# change-triage

Reference skill shipped by `extensions/mpd-ext-example`. It exists to prove that a
data-plane extension can contribute a skill with zero code, and to show the shape a
real per-area skill takes.

## Inputs

- The change under triage (`git diff`, a patch file, or the list of touched files).
- The area's notes or ownership map when they exist.

## Steps

1. List the touched files and, for each, whether it is a leaf or a call site.
2. Separate **functional** changes from **editorial** ones (comments, formatting, renaming).
3. For every functional change, name the contract it can break: input and output
   behaviour, error handling, boundary conditions, resource limits, consumer expectations.
4. Rank the risks by blast radius, not by diff size, and name the file and line for each.
5. State what was NOT checked, so the reader knows where the triage stops.

## Output

A short ranked list of risks plus an explicit "not checked" section. Never claim a
sign-off: this skill triages, it does not approve.
