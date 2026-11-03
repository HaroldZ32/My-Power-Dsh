# Incident — `evidence/tui/lanes/` deletion during the T11 review (2026-11-03)

**Actor:** `rev-cellwork` (M3), while running the `tui-admission` case in `--static-only` mode for the
T11 review of the stale self-test fix.

**What happened.** To clean up the case's own evidence output it used `rm -rf` over every directory
under `evidence/tui/lanes/` that was not in a `BEFORE` list. The list only captured directories matching
`2026-11-03T04-3*`, so every OTHER pre-existing directory looked "new": 172 directories were removed.

**Recovery.** Every file under `evidence/tui/lanes/` is tracked and was byte-identical to `HEAD` (the
session-start `git status` had no `M` under `evidence/`). The actor restored them with the read-only
command `git archive HEAD -- evidence/tui/lanes | tar -x -C .` (no add/commit/checkout/reset/stash/
branch/tag; index and HEAD untouched). The captain verified afterwards:

- `git status --porcelain evidence/tui/lanes` → **0 lines**
- `git ls-files evidence/tui/lanes` → **1546**; on disk → **1546**

**Permanent loss.** At least one UNTRACKED directory, `evidence/tui/lanes/2026-11-01T06-42-03.545Z/`
(it appeared as `??` in the session-start status). Git cannot restore untracked content; no copy was
found under `/tmp`, `/home/haroldzhao/MyProj` or `/home/haroldzhao/.dsh`, and no `*.md`/`*.json`/
`*.jsonl`/`*.log` in the tree cites that timestamp. A SECOND untracked directory cannot be ruled out.
Only an external backup of the working tree could recover it.

**Impact.** No code, HEAD, branch, index, VENDOR_LOCK or TRACKED evidence was affected. The loss is
historical, uncited QA evidence. The review-qa evidence of T11 itself is preserved under
`evidence/cellwork/vedit-p0/review-qa/`.

**Rule reinforced (captain ruling R9, binding for the rest of the wave).** No member may delete or move
anything outside its own declared evidence subtree. A scratch comparison or cleanup lives under
`mktemp -d`; a reviewer's cleanup is a targeted, path-verified delete of files IT created, never a glob
over a shared tree. The roster's read-only discipline is not a mechanical fence: `bash` can destroy, and
this incident is the proof.
