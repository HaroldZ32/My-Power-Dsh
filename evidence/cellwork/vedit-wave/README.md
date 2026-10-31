# Wave evidence — cellwork defects observed in the VEdit project

**Branch:** `fix/cellwork-vedit-wave` (cut from `dev` @ `56873072`)
**Wave date:** 2026-10-31
**Base defect inventory:** 17 defects (D1–D17), see `contract.md` §1 and the PR description.

## What is in this directory

| Path | What it is |
|---|---|
| `contract.md` | The FROZEN wave contract, copied verbatim from the session path `.mpd/plans/cellwork-vedit-wave.md` — the file that path lives in is gitignored, so this copy is the durable anchor every review cites as `§2 C1…C12`, `§6` and `§7 R1…R9`. Read it before any verdict in this directory. |
| `review-d16.md`, `d16/` | Independent review of the mailbox undelivered bound (D16). Verdict: **REQUEST CHANGES**, one High finding **H1** (a read/ack did not free a bound slot), with its red-first log and probe. |
| `review-mail.md`, `mail/` | Independent review of the mail family (D16b, D16c, and the closure of H1). Verdict: **APPROVE**, H1 CLOSED on the re-run probe. |
| `review-lanes-bde.md`, `bde/` | Independent review of lanes B, D and E (C1-validation, C9, C10, C2-server, C3, C4, C5). Verdict: **APPROVE**, two Nits. |
| `review-lane-ac.md`, `ac/` | Independent review of lanes A and C (C6, C7, D6, C1-activate, C2-caller, C8, C11, C12). Verdict: **APPROVE**, one Nit (repaired as T16) and one report-register note. |
| `review-wave-sweep.md`, `sweep/` | The final independent sweep: every wave gate with its observed exit code, the acceptance checklist re-derived against the landed tree, and the user-requested authority items proven end to end. |
| `gates/` | This wave's own gate logs, one file per gate, each ending with the observed `EXIT=` line. |

## Provenance of the defects

The evidence for each defect was collected from two cell-work sessions in the VEdit project under
`@mpd-dsh/mpd@0.16.3`: the active cell `cell-20261031T014507403Z` (223 journal rows, 29 mail rows,
3 handoffs, 48 tasks, 33 verify loops) and the archived cell `cell-20261030T020634155Z` (81 journal rows,
stuck in phase `split`). The installed bundle is the published 0.16.3 tarball, and its cellwork `dist`
carries the same markers at the same dist offsets as this branch's `dist/`, so no defect below is a
stale-build artefact.

Those VEdit runtime files are NOT copied here (they are another project's state); the per-defect
citations are in `contract.md` §1 and in the review files, which quote the exact strings.

## Review discipline used in this wave

Each review seat worked from `contract.md` and the repository documentation, decided a verdict BEFORE
reading any implementation, wrote its own probes (never the writer's tests as proof), and kept a
declined-to-judge list. A FAIL went back to the writer as a repair task; the reviewer never fixed
anything. Scratch copies of a package tree for red-first comparisons live under `mktemp -d` — this
directory must contain no runnable `*.test.ts` (recorded as §7 R9 after one such copy was picked up by a
repository-root test run).
