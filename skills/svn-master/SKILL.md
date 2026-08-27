---
name: svn-master
description: "MUST USE whenever a task needs a Subversion commit or SVN-history investigation. Covers atomic commits, status/info reading, diff/blame, merge and conflict handling, branch/tag via copy, svn:ignore and properties, log search, revert discipline, and questions like who changed this or when. Do not use for ordinary code edits unless the user asks for SVN work; use git-master for Git repositories."
metadata:
  short-description: SVN command discipline - atomic commits, history investigation, merge and revert safety
---

# SVN Master

Use this skill when the user asks you to operate on a Subversion working copy or answer an SVN-history question. Be exact, conservative, and evidence-led. Read the working-copy state before you infer anything.

## Mode Gate

Classify the request first:

- **COMMIT** — "commit", "check in", "submit this change" → atomic commit discipline below.
- **HISTORY** — "who changed this", "when was this added", "what was in r123" → history commands, never mutate.
- **BRANCH/TAG** — "create a branch", "tag this release" → copy discipline (SVN branches/tags are directory copies).
- **MERGE** — "merge r456 into trunk", "reintegrate" → merge + conflict flow.
- **SETUP** — "add my helper", "structure a new repo" → layout and properties.

## Core Discipline

1. **Read state before ANY command.** `svn status` (short form), `svn info` (URL/revision), and `svn diff --summarize` when unsure. Never infer the repository state from memory.
2. **Atomic commits.** One logical change per commit; never bundle unrelated edits. If the change must span several files, they are one unit only when they fail together.
3. **Never commit unfinished work** or debug leftovers; `svn status` must show exactly what you intend.
4. **Message discipline.** `svn commit -m "fix(scope): summary of the bug — evidence line"`. Reference the ticket/issue id when the project uses one. No vague messages like "update" or "fix".
5. **Evidence-led.** For history questions, cite `r<rev>` and the author/date from `svn log`; for "who/when", use `svn blame` (with the file's current URL and revision) rather than guessing.
6. **Revert is destructive.** `svn revert` discards local edits irreversibly (and `svn revert -R` applies to a whole tree) — confirm scope first, or copy the file aside when in doubt.
7. **No status-noise in commits.** Exclude local artifacts via `svn:ignore` (see Properties) instead of deleting them; never `svn delete` generated files that belong in the repository policy.

## Command Quick Reference

| Intent | Command |
|---|---|
| See local state | `svn status` (M/A/D/?, C conflicts) |
| See repo state of one path | `svn info <path>` (URL, revision, last-changed) |
| Local diff | `svn diff` / `svn diff -c <rev>` (compared to previous revision) |
| Recent history | `svn log -l 20` / `svn log --search <keyword>` |
| Who/when per line | `svn blame <path>` |
| Add a new file/dir | `svn add <path>` |
| Delete | `svn delete <path>` |
| Commit | `svn commit -m "..."` |
| Discard ONE local edit | `svn revert <path>` |
| Update to latest | `svn update` |
| Resolve conflicts | manual edit → `svn resolve --accept working <path>` (or `mine-full`/`theirs-full` deliberately) |
| Branch (directory copy) | `svn copy <url-of-trunk> <url-of-branch> -m "branch: reason"` |
| Tag | `svn copy <url-of-trunk> <url-of-tags/VERSION> -m "tag: VERSION"` |
| Single-revision merge | `svn merge -c <rev> <url>` (within same branch line) |
| Reintegrate a branch | `svn merge --reintegrate <url-of-branch>` (then commit, delete branch if policy) |
| Ignore pattern | `svn propset svn:ignore '*.log' .` |
| Clean up locks | `svn cleanup` (after interrupted update/merge) |

## Properties (project conventions)

- `svn:eol-style` — set `native` on text files (or `LF`/`CRLF` per policy) when the repository enforces line endings; never apply to binaries or as a blanket default without evidence.
- `svn:mime-type` — set `application/octet-stream` on binaries so diffs stay clean.
- `svn:executable` — set true for scripts the policy runs directly.
- `svn:ignore` — folder-scoped; keep generated/scratch artifacts out of commits.
- Keywords (`$Id$`): only when the project policy requires them; verify what the repository actually expands before assuming.

## Merge and Conflict Flow

1. Update the target working copy FIRST (`svn update`); never merge into a stale tree.
2. Run the merge, then `svn status` — `C` on a path means a conflict.
3. Resolve content conflicts by reading both sides: working copy shows `r*.mine`/`r*.<base>`/`r*.<theirs>` pattern; keep the correct hunk, then `svn resolve --accept working`.
4. `svn merge --reintegrate` works only in modern SVN; a "tree conflict" usually means added/deleted files disagree — resolve deliberately, never delete a side blindly.
5. Commit the merge with a message naming the source revs (`merge -c r123 from <branch-line>`).

## Never Do

- `svn revert` without confirming the exact path set (`svn revert -R .` while other edits are uncommitted).
- Commit a partially resolved conflict: `svn status` must be clean of `C` before commit.
- Blindly `svn delete` a directory with local modifications (deletes are scheduled, not immediate — check `svn status`).
- Mix branch-line revisions into an unrelated trunk commit.
- Claim "who changed this" from a `svn diff` alone — use `svn blame`/`svn log` with the revision.

## Evidence Led

- History questions: state `r<rev>` + date + author, and the command that produced it.
- Commit checks: quote `svn status` output after the commit and the `r<rev>` returned.
- Uncertain about repository state (network, credentials, permissions): say what you could not verify and what would resolve it — never invent revisions.
