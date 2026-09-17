# CANONICAL-SELECTION PROOF (A1 clause 1) — the definition, my hash, and an independent second method
# t26 attempt 9 · 2026-09-17T04:58Z · docs-gate-engineer

## WHY THIS FILE EXISTS
watchdog-engineer reported, correctly, that the cited canonical hash `58128ebd1ed1c748` was **not
reproducible from the manifest**: eight candidate canonicalizations produced eight other digests, because
the DEFINITION lived only in an ad-hoc invocation of mine and never on disk. That is now fixed, and the
substance is proven twice over by two different methods.

## METHOD 1 — the definition, stated exactly (and re-verified just now)
```python
import json, hashlib
m   = json.load(open("skills/dsh-qa/cases.json", encoding="utf-8"))
sel = [e for e in [*m.get("lanes", []), *m.get("gates", [])] if "all" in (e.get("suites") or [])]
tup = [(e["case"], e.get("script"), e.get("args"), e.get("suites")) for e in sel]   # ← NO defaults: .get() -> None
h   = hashlib.sha256(json.dumps(tup, sort_keys=True).encode()).hexdigest()
```
### VERBATIM OUTPUT (run 2026-09-17T05:09Z, on pin `54585caba9a57132…`)
    selected: 33
    first tuple:  ('agent-teams-adopt', 'skills/dsh-qa/scripts/agent-teams-adopt.mjs', None, ['all'])
    a gate tuple: ('qa-lane-drift', None, None, ['all'])
    json.dumps(...)[:120]: [["agent-teams-adopt", "skills/dsh-qa/scripts/agent-teams-adopt.mjs", null, ["all"]], ["agent-teams-dispatch", "skills/d…
    sha256: 58128ebd1ed1c7488f5adb99da2d0ad22a54ee504827186bcfb39f3ab89eecc7

### WHY A THIRD SEAT'S VARIANTS MISSED IT (the preimage's four attributes, all load-bearing)
- **`args` default is `None`, NOT `[]`.** `.get("args")` yields JSON `null` for every entry; `.get("args", [])`
  yields `[]` and is a DIFFERENT preimage — that single difference is the whole gap (that variant hashes to
  `3d4a3e73094e22ce…`, measured). Same for `script` on GATE entries: `null`, never omitted or replaced by `argv`.
- **Container type:** a JSON **list of 4-element LISTS** (`json.dumps` of a list of tuples). Dicts with the same
  fields, `repr()`/`str()` forms, and `script or argv` gate-aware substitutions are different preimages.
- **Ordering:** the LIST is in **manifest order** (`lanes` then `gates`, filtered by `"all" in suites`);
  `sort_keys=True` sorts only OBJECT KEYS, of which this preimage has none — it does NOT reorder the list.
- **Encoding:** `str.encode()` default UTF-8; `json.dumps` default separators (`", "`, `": "`).
### MINIMAL REPRODUCIBLE DEFINITION (watchdog-engineer's refinement, measured in one run)
**Three load-bearing attributes + the value** — and one INERT argument that must not be mistaken for one:
1. **manifest order** (a JSON list of 4-element lists over `[*lanes, *gates]` filtered by `"all" in suites`);
2. **`.get` → `None`, no defaults** (`args` and gates' `script` are `null`; `[]` gives `3d4a3e73094e22ce…`);
3. **UTF-8 + `json.dumps` DEFAULT separators** (compact separators give `cae6faab3cc23843…`).
- **`sort_keys=True` is INERT here:** the preimage contains no object keys, so removing it yields the SAME
  digest `58128ebd1ed1c748…` (verified independently). Kept for readability, labelled non-load-bearing —
  naming an inert argument as load-bearing is its own small confusion.

## DISPOSITION (captain's ruling, superseded by the reproduction below) — CLAUSE 1 IS CHECKABLE END TO END
**The drafted caveat ("a third seat did not reproduce it") is FALSE as of the reproduction recorded below and
must not be quoted.** The accurate board line is:

> *"the two pins' selections are the same 33 entries — proven by the `--list` diff (exactly one ADDED,
> UNSELECTED lane, `watchdog-redesign`, `suites: []`) AND by the canonical digest
> `58128ebd1ed1c7488f5adb99da2d0ad22a54ee504827186bcfb39f3ab89eecc7`, whose definition is on disk with its
> load-bearing attributes named (4-element lists in manifest order; `.get` → `None`, no defaults; UTF-8 with
> `json.dumps` default separators) and which a third seat reproduced independently; `sort_keys=True` is inert."*

### THE SEQUENCE, KEPT AS THE LESSON'S HAPPY ENDING (not its failure)
The FIRST definition did not reproduce — ~33 attempts across two implementations; the CORRECTED one did, and
the entire difference was **one null-handling default** (`args` `[]` vs `None`). Both halves of the rule are
now demonstrated in one thread: **a value travels only with a recipe a third seat has RUN** — and a definition
published beside a value is not that until somebody else's run says so.


**Recorded honestly, and then closed (no further variants):** the recipe reproduced HERE, twice, with the
verbatim output pasted above; the third seat's closest variant differed by exactly one documented default
(`args` = `[]` instead of `None`, digest `3d4a3e73094e22ce…`), and its other variants by container type or
gate fallback.

## THIRD-SEAT REPRODUCTION — CONFIRMED (watchdog-engineer, 05:1xZ), so the premise of the disposition changed
An independent seat ran the recipe and reported the SAME digest, with the same preimage rule:
```
sel = [e for e in [*m["lanes"], *m["gates"]] if "all" in (e.get("suites") or [])]
json.dumps([[e.get("case"), e.get("script"), e.get("args"), e.get("suites")] for e in sel], sort_keys=True)
→ sha256 = 58128ebd1ed1c7488f5adb99da2d0ad22a54ee504827186bcfb39f3ab89eecc7   (33 selected, pin 54585caba9a57132…)
```
and named the single cause of its own 33 earlier misses: `e.get("args", [])` (**empty list**) versus
`e.get("args")` → **`null`**, with gates' missing `script` likewise `null` rather than omitted.
⇒ The rule the wave adopted is now satisfied FOR THIS VALUE: **it travels with the recipe that reproduces
it** (definition + value + a third seat's independent run), and the `--list` diff independently proves the
substance. The board therefore states the substance FIRST and may cite the digest WITH its recipe; the
earlier "not reproducible by a third seat" caveat is superseded by this reproduction and must not be quoted.
Lesson kept either way: **a hash pins its data AND its serializer AND its null-handling** — "the definition"
must include all three to be checkable.

recomputed on the current manifest (`skills/dsh-qa/cases.json`, pin `54585caba9a57132…`, 51 entries,
**33 selected**):

    canonical hash = 58128ebd1ed1c7488f5adb99da2d0ad22a54ee504827186bcfb39f3ab89eecc7

The same computation reproduced the same digest at 03:53Z against the then-current file **and** against the
run-start copy preserved inside the artifact, which is how the board could claim the two pins' selections
were identical in the first place.

## METHOD 2 — watchdog-engineer's independent proof (no digest involved)
Diffing the two pins' own `--list` outputs (the old pin `919656a8cac1…` taken from t15's handover copy vs
the current `54585caba9a5`) differs by **exactly one line** — an ADDED lane `watchdog-redesign`, whose
manifest entry carries **`suites: []`** and is therefore NOT selected. So both pins select the same 33 by
`(case, suites, script)`.
**Bound, stated not hidden:** `--list` does not print `args`, and the older manifest revision was
overwritten in place by the 04:37:59 re-pack, so the `args` surface across pins cannot be compared by this
method. Method 1 (which does include `args`) remains the primary proof; Method 2 corroborates its scope.

## CONTENTION WINDOW (affects any duration claim, not the verdicts)
watchdog-engineer measured other seats' lanes writing evidence concurrently with the 04:34–04:40Z window
(`plan-c/c8-vision` 04:38:52, `c6-memory` 04:39:05, `c2-ultrawork` 04:39:11, `plan-c-smoke` 04:38:43,
`session-start-team` 04:38:14) and their `agent-teams-adopt` produced 0 B in 5.5 min where run 1 measured
110 s for the same lane. My own chunks overlapped that window and my 8-way parallel launch caused one
interference red (`bundle-lifecycle`, recorded in `PARALLEL-INTERFERENCE-FINDING.md`, re-run serially and
green). ⇒ **timing numbers in this board are noise; the verdicts are not** (each lane's verdict comes from
its own run and its own record).

## THEIR ATTEMPT-6 ARTEFACTS (handed over, origin + pin named)
`evidence/dsh-qa/full-sweep/20260917T043325Z-t26-attempt6/` — `drive-chunks.mjs` (their chunk driver: launches
via the T-23 helper, WAITS inside the job, 13-min budget, `died-with-chunk` for re-run, env-overridable
attemptId), its single chunk `01-…` = **`died-with-chunk`, no `result.json`** (0-byte lane log — the
helper-as-foreground trap), and `output.log` with the canonical-selection proof, the witness correction and
the contention measurement. Their 45 s probe of the helper left a **0-byte log, no marker, DEAD pid**: the
detached child does not survive the sandbox. None of it contributes a verdict to this board; all of it is
cited as their attempt's history.
