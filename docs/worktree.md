# Agent worktrees

**English** | [中文](./worktree.zh-CN.md)

A team or cellwork member is a separate session, but by default it edits files in the captain's
checkout. Two write-capable members then share one `.git/HEAD`, and a stray `reset` in one seat moves
the branch under every other seat. The worktree feature gives each write-capable member its own git
worktree and its own branch, forwarded as the child's EFFECTIVE working directory (`cwd`), so members
write and commit in parallel and the captain merges their branches into the wave branch in task order.

## The concept

- A worktree is a second checkout of the SAME repository with its own `HEAD`. A member worktree lives
  under `<workspace>/.mpd/worktrees/<teamId>/<memberSlug>` and is created on branch
  `agent/<teamId>/<memberSlug>`, based on the main checkout's `HEAD` at creation time.
- Only the EFFECTIVE working directory moves. The session's state root does not (see D1 below), so the
  team record, mail, verify loops and journal stay in the parent workspace and every member reads the
  same board the captain reads.
- A worktree belongs to a MEMBER, not to a task: the same seat keeps its worktree across the tasks it
  works on. Read-only seats (Explorer, Researcher, the analyst lanes) never get one — they cannot
  write, so a checkout would be overhead.
- Creation is automatic at member spawn / activation through the `mpdWorktree` service
  (`createForMember`). The manual `mpd_worktree_*` tools drive the same index for a hand-started
  checkout, a merge or a cleanup.

## Guarantees

### State stays shared in the parent workspace

D1: a child session's `session.header.cwd` is copied from the parent and is immutable; passing `cwd` at
spawn moves only the effective working directory. The child's state root — and the sandbox boundary —
therefore remain the parent workspace. Consequence: `.mpd/team/`, cell mail, verify records and the
journal are shared under `<workspace>/.mpd`, never copied into the worktree, and a member's board edits
are visible to the captain immediately.

### The worktree lives inside the workspace root

D2: a worktree MUST be under the parent workspace root — the default is
`<workspace>/.mpd/worktrees/<teamId>/<memberSlug>`. Creation resolves the path and refuses a target
outside the root with the D2 reason; the plugin never registers such a path.

### Outside-root worktrees are read-only to members

The member runs under the `workspace-write` sandbox, whose fence is the parent workspace and
re-canonicalises paths (symlinked grants are refused). A worktree checked out outside the root is
therefore unwritable by the member, even when the path is handed to it: it is read-only in practice.
Allowing one needs a HOST-level `sandbox-policy.additionalWritableRoots` row, which is
deployment-owned and out of scope for this bundle.

## The member workflow

1. **Create** — at spawn (or on demand with `mpd_worktree_create`) the member gets its worktree and
   branch, both recorded in `<workspace>/.mpd/worktrees/index.json`.
2. **cwd** — the spawn request carries the worktree path as the member's effective working directory.
   A compaction/reseed re-supplies the same path, so the reseeded seat stays in its worktree.
3. **Work and commit** — the member edits, runs its gates and commits on `agent/<teamId>/<memberSlug>`.
   It owns that HEAD; it never commits in the main checkout.
4. **Merge** — the captain merges the member's branch into the wave branch with `mpd_worktree_merge`
   (default target: the main checkout's current branch) after the review verdict.
5. **Remove** — `mpd_worktree_remove` deletes the worktree and its branch once it is merged, or with
   `force` when it is not.

**The merge is manual and captain-driven.** There is no merge queue and no gate runs automatically
after a merge: the captain decides the order, runs the merge and re-runs the wave gates on the merged
tip. `mpd_worktree_merge` refuses a detached or tracked-dirty main checkout, refuses a protected
branch (`master`, `dev`) without `force: true`, and on a conflict runs `git merge --abort`, reports the
conflicting files and changes nothing.

## Tools

| Tool | What it does |
|---|---|
| `mpd_worktree_create { name, teamId?, member?, base?, branch?, repo? }` | creates a worktree and branch; `slug` must match `[a-z0-9][a-z0-9._-]{0,79}`, the path must be inside the workspace root, the path must not exist and the name must not already be registered; returns `{ name, path, branch, base, repo }` |
| `mpd_worktree_list {}` | joins `git worktree list --porcelain` with the index; per entry `{ name, path, branch, repo, exists, dirty, ahead, behind, merged }` |
| `mpd_worktree_status { name }` | the same record for one entry; an unknown name is a structured error |
| `mpd_worktree_merge { name, into?, force? }` | `git merge --no-ff` of the member branch into `into` (default: the main checkout's current branch); refuses the conditions above; on success marks the entry merged and returns the commit, on conflict aborts and returns `{ merged: false, conflicts: [...] }` |
| `mpd_worktree_remove { name, force? }` | removes the worktree and deletes the branch; refuses a dirty or unmerged worktree without `force`; a path that is already gone is pruned, not an error |

The branch defaults to `<branchPrefix><slug>` (`agent/` by default). A member created through the
service uses the D3 shape `agent/<teamId>/<memberSlug>`; `base` defaults to the main checkout's
current `HEAD` (the branch name, or the SHA when detached).

## Configuration

The knobs are row config on the `mpd-worktree` mount row in `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | master switch; `false` spawns every member in the shared checkout |
| `dir` | `<workspace>/.mpd/worktrees` | root directory for worktrees |
| `repo` | the workspace root when it is a git repository | repository a worktree is created from |
| `base` | the main checkout's `HEAD` | base ref/branch for a new worktree |
| `branchPrefix` | `"agent/"` | prefix of the default branch name |
| `protectedBranches` | `["master","dev"]` | branches `mpd_worktree_merge` refuses unless `force: true` |
| `max` | `32` | maximum number of registered worktrees |

## The degrade rule

Default ON, degrade never fail. If the workspace (or the configured `repo`) is not a git repository, if
creation fails, or if the plugin is disabled, the member is spawned WITHOUT a `cwd` — exactly today's
shared-checkout behaviour — and ONE line is logged through the adapter's row logger. A degraded spawn is
never an error and never blocks the board.

The official-executor fallback is a declared bound: the official `teams.spawnTeammate` path cannot
carry a `cwd`, so the member runs in the shared checkout with one log line. The same applies to
read-only members, which are skipped by design.

## Declared bounds

- Merge is manual and captain-driven; there is no automatic merge queue and no automatic gate run after
  a merge.
- A worktree outside the workspace root is read-only to members until the host adds an
  `additionalWritableRoots` entry; this bundle does not ship one.
- The official executor fallback cannot set `cwd`, so such a member runs in the shared checkout.
- Worktrees are not destroyed automatically when a team ends; `mpd_worktree_remove` is explicit.
- Only the native in-process subagent backend is covered. External/SDK subagent providers were not
  traced and are not claimed.
