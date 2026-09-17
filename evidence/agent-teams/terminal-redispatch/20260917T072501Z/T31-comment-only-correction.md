# t31 — comment-only correction of the refuted T-79 framing in the arm (2 sites)

**Filed by:** `agent-teams-engineer` · `2026-09-17T08:5xZ` · task `t31` (attempt 2), inScope covers exactly
`packages/mpd-agent-teams-plugin/self-fix-tests/terminal-rearm-refusal.test.mjs` + this directory.

## The measured-versus-inferred split, stated verbatim (the captain's wording)

> in a FRESH process the re-check refuses DETERMINISTICALLY (green on the real tree; exactly one terminal
> delivery on a region-stripped copy), while the wave-2 live replays are only CONSISTENT with a host process
> predating the fix (T-21 class) because the host start time is not readable from a pid-namespaced sandbox —
> so the state is **UNRESOLVED with a named probe**, never "inert".

The register's own ruling (`.mpd/plans/friction-p2-wave-captain-log.md` §A-28) sharpens the same pair, and the
comment text follows BOTH: the wording now landed is "**UNRESOLVED, with a NAMED PROBE whose verdict does NOT
support the stale-host reading**" — the probe being `node scripts/mpd-bg.mjs reload-check <module-path>`, whose
semantics ARE the bound (it compares a module mtime against the **NEWEST SESSION's** directory mtime, so
`FRESH` never means "the running host loaded this revision"). Consistency is not support: nothing here claims
the stale-host reading as established, and the refuted "inert in-process" framing is not repeated.

## What changed (wording only, both sites)

| site (by symbol, not by line — T-55) | before | after |
|---|---|---|
| the file header's bound sentence (the comment block that closes "…the restart leg is a CHILD PROCESS…") | "the honest bound being that the pre-restart inertness of a long-lived process (T-21) is the measured defect, not a regression of this fix" | the ATTRIBUTED-inference wording + the named probe + its own semantics as the bound + "UNRESOLVED, with a NAMED PROBE whose verdict does not support the stale-host reading — never 'inert in-process', and never 'consistent with a stale host'" + what the file DOES measure |
| the comment above the restart-leg assertion (the case that spawns a fresh child process) | "the in-process inertness of a long-lived session is T-21's measured defect, not this fix's" | "this reading is what proves it IN-PROCESS … stays UNRESOLVED … the measured half: in a fresh process the delivery re-check refuses DETERMINISTICALLY — green on the real tree, exactly ONE terminal delivery on a region-stripped copy" |

## The proof that nothing else moved

| reading | value |
|---|---|
| arm sha256 BEFORE | `4c77cf321e32b9270271989ca84aa97d83a22786d3fad8829547adf76e39d4fe` |
| arm sha256 AFTER | `fad07bfb7d26e5cccd4de83738645b011ba6b23a42c10eb3994605fd8d08fa98` |
| changed lines / non-comment changed lines | **21 / 0** → verdict **COMMENT-ONLY** (`comment-only-proof.txt`, difflib over the reconstructed pre-t31 revision; every changed line starts with `//`) |
| tests / `expect(` calls in the arm | 6 / 44 — IDENTICAL before and after |
| the arm's own reading | 6 pass / 0 fail, 44 expect() calls (unchanged) |

The pre-t31 revision is reconstructed by reversing the two comment replacements (the file is untracked, so
`git show HEAD:` has no revision of it); the reversal is asserted (exactly one occurrence each) before the
diff is taken.

## What was deliberately NOT touched

- `evidence/agent-teams/terminal-redispatch/20260917T072501Z/result.json` — **unedited**: its `honest_bound`
  keeps the original wording, and `CORRECTION-inert-in-process.md` (same directory) stays the correction of
  record for it, per the wave's doctrine (nested corrections beside sealed records, never over them).
- No assertion, fixture, arm name, reading or expectation moved; no git command was run (the captain is the
  single writer).

## Verify (the contract's path form, T-89)

| command | reading |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/` | **108 pass / 0 fail, exit 0** |
| `bun test ./packages/mpd-agent-teams-plugin/` | **265 pass / 0 fail, exit 0** |

Raw log: `t31-verify.log`.
