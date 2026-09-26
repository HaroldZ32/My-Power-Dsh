# SUPERSEDED — the "checklist not executed" caveat on t32's output is now CLOSED by t40

**Written:** 2026-09-17, after wave 2a rolled over (so the t32 task record can no longer be appended to; this note goes BESIDE the evidence instead).

## What was stale

The `output_append` on t32's record concluded the falsifier's checklist for the additive tail with:

> "… offered by lane A; NOT executed by me — it needs a new task and I own none …"

That was true when written. It is **no longer true**: the task arrived as **t40** and **I executed the checklist myself**, adversarially, at `verdict=pass` (attempt `5364e48a-c550-469b-aa10-aa9614106334`, 0 findings).

## Where the execution lives

`evidence/review/t37-seeded-lane/20260917T092122Z/` — `result.json`, `my-three-leg-driver.mjs`, `my-three-legs.json`/`.txt`, `pin-full.out`, `tmp-*.txt`:

* **(a)** both legs reproduced by MY driver in one run: seeded `{prefix TRUE, framing FALSE, peer FALSE, deferral FALSE}` (plus the `not active` while-held falsehood); shipped all four TRUE; the author's lane cited only (full-output run, never a tail: 8 pass / 0 fail, 79 expects — it prints no readings).
* **(b)** the unseeded attempt FAILS: an unseeded copy byte-identical to shipped gives all four TRUE where the lane requires three FALSE; guard precondition verified (the shipped line occurs exactly 1×).
* **(c)** scratch discipline verified empirically (single shell call, /tmp before/after): no `mpd-t19-seed-*` residue; the only leak is an EMPTY `mpd-t9-home-*` from the file's prefix (line 241) → recorded as t40's O1, not the tail.
* **(d)** additive-only re-confirmed after the runs: prefix(457 lines + "\n") == `afb3233519db7fac…`; current file sha `1145f15bcc52765c…`.

## Coverage, closed

**t32 = the pinned prefix; t40 = the additive tail (lines 458–541); together the whole file.** No future task is needed on that file unless its bytes move again.

## Wave state at the time of writing (for the record)

`.mpd/team/friction-p2-wave/waves/w1-wave-2a-closed.json` (743 KB) archives wave 2a: my seven tasks (t12, t14, t15, t17, t32, t33, t40) all **completed/pass**; the wave's three failed tasks are **t13** (watchdog-engineer), **t34** and **t39** (Plan Reviewer) — none of them mine, and the report arithmetic findings lane A mentioned belong to t39's owners. Wave **w2 (2b)** opened 2026-09-17T09:28:54Z with a single task (the 2b plan, claimed by the Planner).
