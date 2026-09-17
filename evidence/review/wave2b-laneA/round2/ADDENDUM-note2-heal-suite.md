# ADDENDUM (post-verdict, nested — never a rewrite of the sealed round-2 record)

**Added:** 2026-09-17T15:1xZ · **reviewer:** `code-reviewer` · **task:** `t30` (already terminal: `failed`, attempt 3, `verdict=needs_revision`, finding F1)
**Why:** the captain's dispatch (notes 1–4) crossed my completion and asked for ONE reading my review had
declared as a bound: *run the heal/strip suite yourself and quote it*. Taken here.

## The claim (note 2)
"A region that **SPLITS a function** left `--check` GREEN **and** `verify:docs` GREEN while the
**strip/heal suite went SIX RED** (269 → 263)." The doctrine attached: **two green readings are NOT
sufficient evidence of registry health.**

## My reading — CONFIRMED, with a matched-baseline control

Mirror = `packages/mpd-agent-teams-plugin/{lib,self-fix-tests,test,package.json}` + the `_deps` symlink,
outside the workspace, deleted after use (T-89). Same mirror, same call, three states:

| state | plugin package suite | net vs baseline |
|---|---|---|
| **BASELINE** (no split — the mirror's own control) | **254 pass / 4 fail** (the 4 are mirror-environment failures, e.g. repo-level preset/template files the mirror lacks) | — |
| **SHAPE 2** — the region wraps only the fallback `return` pair, BOTH markers inside `acceptanceCovered` (the shape the repair measured) | **234 pass / 24 fail** | **−20** |
| **SHAPE 1** — the region spans the function header and ends mid-body (my own first attempt) | **233 pass / 25 fail** | **−21** |

and in each shape, on the same tree:

- `node scripts/patch-agent-teams-fixes.mjs --write-registry` → `96 regions`, exit 0
- `node scripts/patch-agent-teams-fixes.mjs --check` → **GREEN, exit 0** ← the trap, confirmed
- (their `verify:docs` half: the docs gate reads the registry, not the skeleton — I did not re-run it in
  the mirror; the real-tree docs gate is PASS at the current revision, which my round-2 record already quotes)

**Failing instruments, named:** under SHAPE 2 the *heal file alone* reddens 3 of its 21 tests
(`t2: strip-healing ALL adopted files from the same state is byte-identical`, `t2: a stripped tools.js
heals byte-for-byte…`, `t2: quality-gates.js strip-heal stays byte-identical…`) — and the **full package
suite** reddens ~20, including `t9`/`F3`/`F4`/`durability` arms. **This is the correction of my own
interim reading:** the heal FILE alone was GREEN under SHAPE 1 (21/21), so a single-file heal run is NOT
the instrument either — the full `bun test ./packages/mpd-agent-teams-plugin` is, and that is exactly the
lane's own verify entry.

Numbers differ from the repair's 6 (269 → 263) because the shape and the moment differ (their first
attempt wrapped the same lines at a state where fewer deltas were adjacent); the CLASS is the same and my
matched-baseline delta (−20 / −21 of 258) is the reproducible form of it.

## Consequence for my round-2 verdict — UNCHANGED

The placeholders in my sealed record are unaffected: F1 (the cycle note over-claims for non-blocking
members) still stands, and it is a finding against the **implementation** of the captain's EXTEND ruling,
not a re-litigation of the ruling. This addendum closes the one bound my record named ("the repair's
split-region/heal-suite trap claim — not reproduced by me"), and it strengthens, not weakens, the repair's
own doctrine: **`--check` green + docs green is not registry health; the suite is.**
