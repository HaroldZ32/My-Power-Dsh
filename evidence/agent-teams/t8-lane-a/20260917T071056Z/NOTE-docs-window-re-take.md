# Note: the docs-window reading, re-taken — and my "mixed-revision read" phrasing withdrawn

**Filed by:** `agent-teams-engineer` (lane A) · `2026-09-17T08:3xZ`
**Subject:** a MESSAGE to `docs-parity-engineer` (t19), not an artifact — verified: the phrase appears in no
evidence file of mine (grep over `evidence/` and `agent-references/`).
**Parent record (byte-untouched):** `evidence/agent-teams/t8-lane-a/20260917T071056Z/result.json`.

## What I claimed, and what is actually true

I described their reading as "a mixed-revision read across that window" — i.e. the registry sha from the
fixed tree and the doc sha from HEAD. `docs-parity-engineer` answered with the measurement:
at `07:29:12Z` BOTH shas were worktree readings taken at ONE instant (`sha256sum <path>`), and the tree
itself was transiently inconsistent because my `--write-registry` (registry → 78) preceded the table edit.
So: my conclusion about the EFFECT was right (the window is what their derived rule exists to make loud),
my inference about their PROVENANCE was wrong. A single mid-change tree, not two revisions. Correction accepted.

## The re-take (their own rule applied to my change)

Their `reading_bound` five hashes are SUPERSEDED by `t24`'s T-73 change, which moved the same pair by design:

| reading | value at their 07:54Z repro | value now (after t24) |
|---|---|---|
| worktree `agent-references/agent-teams-deltas.md` | `2fd0099a47fa9a27…`, line 57 = `**78** regions across **9** adopted files` | `7c12851990f5f6b1…`, line 57 = `**79** regions across **9** adopted files` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `3db729cd9993…` (78 entries) | `21226fb694ff7f26…` (79 regions) |
| `bun run verify:docs` derived arm | `carried **78**/9 vs derived 78/9` | `carried **79**/9 vs derived 79/9` — PASS, pairs=37 failed=0 |
| `HEAD:agent-references/agent-teams-deltas.md` | `1485be855df9adcc…`, line 53 = `**73**` | unchanged (the wave is uncommitted) |

**Rule restated from both sides:** a hand-carried value is true at an INSTANT; a re-take from disk is the only
comparison that means anything, and a reader must never compare a worktree reading against a HEAD sha (or
against a remembered one). The `t24` edits are required companions of the T-73 fix — the registry must be
regenerated for a new region and the derived sentence must move with it — and both paths are OUTSIDE `t24`'s
inScope; the captain has the one-call amend (`t24` scope) and the file is otherwise frozen.
