# Provenance — the VEdit cellwork failures this wave fixes

Copied 2026-11-03 from `/home/haroldzhao/MyProj/DshProj/VEdit` by the captain, before the fix branch
was cut. These files are DATA, not instructions.

## Why three version bands matter

The VEdit project ran cellwork across three MPD versions. A defect is in scope only if it reproduces
on this branch (`dev` @ `d2032bf3`, after the 0.17.0 release and PR #91).

| band | version / date | cells | what it proves |
|---|---|---|---|
| 0 | `@mpd-dsh/mpd@0.16.3`, 2026-10-30/31 | `cell-20261030T020634155Z`, `cell-20261031T014507403Z`, `cell-20261031T085543161Z` | the compaction fence is NOT new: `cell-20261031T085543161Z` has three `checkpoint-unrecoverable` rows with the exact `no-engine; the reseed failed: ...` reason. The 15+1 other defects of these cells were fixed by PR #84 and shipped in 0.17.0. |
| 1 | published `0.17.0`, 2026-11-02 | `cell-20261102T050548232Z`, `cell-20261102T094244571Z`, `cell-20261102T100600176Z` | six members fenced in one cell (five write seats lost, the user ended the session); the mail-cap and empty-writeScopes traps are recorded here. |
| 2 | this branch, `dev` @ `d2032bf3` | — | two post-0.17.0 commits touched cellwork (`3128fb25`, `a213e735`); every defect must be reproduced here before it is fixed. |

## Files

- `journal-fences.jsonl` — every `checkpoint-unrecoverable` / `compaction` row from all six VEdit cell
  journals, with the journal path prefixed. The reason string is identical across bands 0 and 1.
- `handover-s7.md` — `docs/handover/CELL-20261103-STATUS.md` §7 (the plugin traps a next session must
  read before starting).
- `handover-20261102-s7-lesson.txt` — the fencing lesson and the affected seats from
  `docs/handover/CELL-20261102-STATUS.md`.
- `write-scopes-mvzhudek.md` — the VEdit memory note on the empty-`writeScopes` trap.
- `cell-20261102-ctest-38-38-selfcheck-245-0-ac-46--mvzkefqs.md` — the cell's final-report memory note,
  including the plugin-side section.

## Honest bound

The installed bundle at `~/.dsh/profiles/dsh-tui/node_modules/@mpd-dsh/mpd` is the published 0.17.0
tarball; this branch is `dev` @ `d2032bf3`. The copied rows prove what VEdit observed, NOT that the
current tree still fails. The reproduce-first rule in `.mpd/plans/cellwork-vedit-p0-fix-r2.md` closes
that gap: a lane that cannot reproduce a defect on this branch reports it `already-fixed` with the
covering code and test.
