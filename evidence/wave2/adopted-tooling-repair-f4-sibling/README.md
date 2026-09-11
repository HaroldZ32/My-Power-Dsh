# t15 — F4's sibling (tools.js task-contract position): NOT CLOSED, reverted to the t14-verified state

**Verdict: the task could not be closed within its scope. The tree is deliberately back on t14's
semantics, whose acceptance driver still passes (`identical: true, diff_lines: 0`).** Every change
this attempt made to the applier and the registry was reverted; the only files this task leaves
changed are the ones t14 already changed.

## The open gap (confirmed after the revert)

`lib/tools.js`'s `task-contract` region does not heal to its canonical position. Measured: a full
strip-heal of `tools.js` produces **264 differing lines** (not 0) — the region lands at the next
tool-registration boundary instead of between the `send_message` and `status` registrations.

## Why the obvious approaches do not work (both measured, not guessed)

1. **Anchor at the region's own boundary (t14's `create-contract-gate` trick).** `create-contract-gate`
   became self-anchoring because it WRAPS the block it modifies, so its own first line is the block
   opener. `task-contract` cannot use that shape: it registers a NEW tool, and a live registration
   IIFE wrapper would change the tool's registration timing relative to the other tools.
2. **Anchor at a line BEFORE the region, insert after it.** Rewriting `selectAnchor` to walk BACKWARD
   from the region (the preceding boundary at the block's own indent) and inserting before that line
   produced `region "mpd-delta scope-overlap" has a half-open marker pair (begin@230, end@229)` on
   `quality-gates.js` — i.e. it broke the file that t14 had proven byte-faithful. Inserting AFTER the
   boundary instead kept the markers well-formed but still mis-placed `task-contract`.
3. **Prefer `anchorMarker` in the resolver.** `anchorMarker` is the region's own first line, which is
   *inside* the region, so it is absent in exactly the strip case it would have to serve — the
   resolver then falls through to the repeated anchor and lands on the first occurrence of
   `    ctx.tools.register(defineTool({` (line 545) instead of the region's site (line 1734).
4. **Blind occurrence index.** Rejected by the task itself, and measurably wrong: the anchor line
   occurs 14 times and occurrence counting over a partially-healed file drifts as regions are
   re-inserted.

## What a real fix needs (design change, not a repair)

The registry must address an insertion site by something that is unique AND present after a strip.
Two viable designs, both larger than this repair:

* **Multi-line boundary context**: store the N lines immediately before and after the canonical
  region (`descriptions`/names are unique) and insert between the matched context pair. This is the
  only approach that is exact for a region whose first line duplicates its predecessor.
* **Content-anchored lookup**: locate the unique body line (`name: 'agent_teams_task_contract',`)
  and walk outward to the enclosing `ctx.tools.register(defineTool({` / `    }));` pair — exact, but
  it encodes structural knowledge of the adopted file in the applier.

## Why this was reverted rather than left in progress

The half-open-marker failure showed the redesign can silently damage the file that t14 proved
byte-faithful. Leaving an unproven registry/applier pair in the wave would weaken the property the
wave just established, so the tree was restored to the last proven state:

* `check4e-heal-fidelity` (t14's acceptance driver) → `{"identical": true, "diff_lines": 0, "heal_exit": 0, "check_exit": 0, "passed": true}`
* `bun test packages/mpd-agent-teams-plugin` → 90 pass / 0 fail
* guard `--check` → 9 regions, already applied

The gap is disclosed, not hidden: it is unreachable in normal operation (nothing strips regions day
to day) and cannot affect the live tree; it matters only on the re-materialize path, which t14's
disclosure already flagged.

## A `dsh` restart is still required for the repaired semantics to act on a live session (no module hot reload).

---

## Second attempt (after Lead's independent reproduction) — same outcome, sharper analysis

Lead independently measured the same gap and reported the region healing at **line 1970 instead of
1733** with `tools.js` **60 diff lines** from canonical, agreeing that a self-anchoring wrap is the
right direction. A second attempt tested four more variants against three strip scenarios
(`strip both`, `strip quality-gates.js only`, `strip tools.js only`):

| variant | result |
|---|---|
| self-anchoring WRAP of the whole `ctx.tools.register(…)` statement, anchor after the region | `tools.js` still divergent (region lands one statement late); `quality-gates.js` unchanged |
| anchor = LAST UNIQUE line before the region, insert after it | `quality-gates.js` **broke** with a half-open marker pair (`scope-overlap` begin@249, end@248) because two regions share that anchor and the second insert lands inside the first |
| same, with the block minted VERBATIM (no re-indent) | `tools.js` **still** divergent, and the trace exposed the mechanism: after `task-contract` is re-inserted, the anchor line it carries (`                delivered,`) appears TWICE, so the recorded occurrence (1) picks the wrong one |
| emitter configured to store the picker's occurrence verbatim | removed the occurrence drift for single-region cases, but did not change the multi-region outcome |

**The blocking constraint, stated precisely:** any insertion rule keyed on a LINE (unique text,
occurrence index, or marker) drifts as soon as more than one region is re-inserted — the block
carries a copy of its own anchor, and inserting one region shifts the occurrence counts the next
region was registered against. This is why the same code path produced a *correct* result for
`strip tools.js only` in one variant and a wrong one in another.

**The fix that follows from that:** insertion must be keyed on a CONTEXT PAIR that brackets the
site and is unique in both directions — e.g. store the (unique) lines immediately BEFORE and AFTER
the region in the canonical file and insert between the matched pair, or content-anchor on the
unique body line (`name: 'agent_teams_task_contract',`) and walk outward to the enclosing
`ctx.tools.register(defineTool({` / `    }))` pair. Both are exact under any number of prior
insertions. Both are also a REGISTRY FORMAT CHANGE (anchor → before/after context), which is why
this task could not close it inside a repair's scope.

**State after this attempt (unchanged from the first):** t14-verified — `check4e-heal-fidelity`
`identical: true, diff_lines: 0, passed: true`; plugin 90/0; self-fix 33/0; typecheck 0; guard
`--check` 9 regions. The `tools.js` gap remains disclosed and unreachable in normal operation.
