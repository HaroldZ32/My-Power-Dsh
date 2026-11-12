# mpd-worktree-plugin

**English** | [中文](./README.zh-CN.md)

Per-member git worktrees for team and cellwork write agents. Every write-capable member can get its
own worktree and branch, forwarded as the child session's EFFECTIVE working directory, so members
write in parallel without sharing `.git/HEAD`. The captain merges their branches into the wave branch
by hand.

The frozen contract this package implements is `.mpd/plans/agent-worktrees.md` §3 Lane A. The
repository-wide rules it obeys are in [AGENTS.md](../../AGENTS.md) §5 (git model) and §6 (plugin
authoring).

## Tools

| Tool | What it does |
|---|---|
| `mpd_worktree_create { name, teamId?, member?, base?, branch?, repo? }` | Creates `<worktree dir>/<name>` on a new branch (`agent/<name>` by default) from the main checkout's HEAD, and records it. Refuses an existing path, an already-registered name and an existing branch. |
| `mpd_worktree_list {}` | Every live record joined with `git worktree list --porcelain`: `name, path, branch, repo, exists, dirty, ahead, behind, merged`. |
| `mpd_worktree_status { name }` | The same record for ONE worktree. An unknown name is a structured refusal listing the known names. |
| `mpd_worktree_merge { name, into?, force? }` | `git merge --no-ff` of the branch into the main checkout's current branch. A conflict aborts and returns `{ merged: false, conflicts }`, changing nothing. |
| `mpd_worktree_remove { name, force? }` | Removes the worktree directory and deletes its branch. Refuses a dirty or unmerged worktree without `force: true`; a missing directory is pruned, not an error. |

`merged` means the branch is an ancestor of the main checkout's current branch. `ahead`/`behind`
come from `git rev-list --left-right --count <branch>...<main>`.

## Service

Besides the tools, the row publishes the cordis service `mpdWorktree` — the ONLY surface the
team-core and cellwork lanes may call:

- `createForMember(exec, { teamId, member }) -> { path, branch } | undefined` — idempotent per
  `{teamId, member}`; places the worktree at `<worktree dir>/<teamId>/<member slug>` on
  `agent/<teamId>/<member slug>`.
- `cwdForMember(exec, { teamId, member }) -> string | undefined` — the read-only lookup a compaction
  reseed uses.

Both methods NEVER throw. A non-repository workspace, a disabled row or a failed create returns
`undefined` and writes exactly ONE line to the row log; the member then spawns in the shared checkout
— today's behaviour.

## Config

Row config in `cordis.patch.yml` (the mounted row ships `config: {}`):

```yaml
- id: mpd-worktree
  name: '@mpd-dsh/mpd/packages/mpd-worktree-plugin/dist/index.js'
  config:
    enabled: true                      # default true; false registers no tools and no service
    dir: .mpd/worktrees                # relative to the workspace root (the default)
    repo: .                            # repository; default the workspace root if it is a git repo
    base: main                         # base ref for new branches; default the main checkout's HEAD
    branchPrefix: "agent/"             # default
    protectedBranches: ["master", "dev"]  # creation refuses the name; recorded branches remove/merge refuse; merge targets need force: true
    max: 32                            # cap on simultaneously ACTIVE worktrees
```

When `mpd-config-plugin` is composed, the same leaves may be set in the workspace's `.mpd/mpd.jsonc`
under a `worktree` section (`worktree.enabled`, `worktree.dir`, …); the file wins per key. Without
that service the row is **row-config-only** — it does not read `mpd.jsonc` on its own.

## State

The durable state is `<workspace>/.mpd/worktrees/index.json`, version 1:

```json
{ "version": 1, "worktrees": [
  { "key": "plan-abc/senior-engineer", "name": "plan-abc/senior-engineer",
    "teamId": "plan-abc", "member": "Senior Engineer", "repo": "/abs/repo",
    "path": "/abs/ws/.mpd/worktrees/plan-abc/senior-engineer",
    "branch": "agent/plan-abc/senior-engineer", "base": "main",
    "createdAt": "2026-11-12T00:00:00.000Z", "status": "active" }
] }
```

`key` is `<teamId>/<member>` for a team member and `manual/<name>` otherwise. `status` is `active`,
`merged` or `removed`. Writes are atomic (a sibling temp file plus `rename`); a corrupt or absent
file reads as an EMPTY index instead of wedging every operation, and a malformed record is dropped.

## Guarantees

- **D1 — state stays shared.** A child's state root is the parent's workspace (`session.header.cwd`
  is copied and immutable); only the EFFECTIVE directory moves. Team records, mail and verify loops
  therefore stay under `<parent workspace>/.mpd`. This package never changes a state root.
- **D2 — the worktree lives INSIDE the workspace.** The default is
  `<workspace>/.mpd/worktrees/<teamId>/<member>`, and a create whose resolved path leaves the
  workspace root is refused with the D2 reason. An outside-root worktree would be unwritable by the
  member under `workspace-write`; opening one needs a host-level
  `sandbox-policy.additionalWritableRoots` row, which is deployment-owned and out of scope here.
- **D3 — one worktree per MEMBER**, branch `agent/<teamId>/<memberSlug>`, based on the main
  checkout's current HEAD at creation time.
- **D5 — one git writer PER WORKTREE.** A member may run git writes only inside its own worktree (a
  separate HEAD); the captain alone writes the main checkout and merges.
- **Protected branches.** `mpd_worktree_merge` refuses a target listed in `protectedBranches` unless
  `force: true` (default `["master","dev"]`), so a member branch cannot land on a release line by
  accident. Before either operation uses the recorded branch, `mpd_worktree_remove` and
  `mpd_worktree_merge` revalidate it against the symbolic branch git reports for that worktree
  (`git symbolic-ref --quiet HEAD`, stripped of the `refs/heads/` prefix) and refuse a
  `protectedBranches` entry for BOTH operations, even with `force: true`. A vanished worktree directory
  cannot answer for HEAD: remove prunes the stale record without a live comparison (`branchDeleted:
  false` when the branch is already gone), while merge still refuses. Creation applies the same list
  before any `git worktree add`: `mpd_worktree_create` and the member-service reattach recovery refuse
  a `protectedBranches` name with `protected-branch`, and take a SHORT branch name only (a `refs/...`
  spelling is refused with `invalid-branch` before any branch, HEAD, worktree or index mutation), so a
  worktree can never be created on a protected branch and then stranded by that revalidation.
- **Conflict abort.** A conflicting merge runs `git merge --abort`, returns the conflicted paths and
  changes nothing — HEAD unmoved, no merge in progress, no conflict markers.

## Manual merge workflow

1. A member creates or receives its worktree and commits on `agent/<teamId>/<memberSlug>`.
2. The captain checks the worktree (`mpd_worktree_status`), then merges:
   `mpd_worktree_merge { name }` — the target is the main checkout's CURRENT branch.
3. The captain removes the worktree when the wave lands: `mpd_worktree_remove { name }` (the record
   is kept as a `removed` tombstone).

There is NO automatic merge queue and NO automatic gate run after a merge.

## Bounds (declared)

- The official-executor fallback cannot set a child's cwd (contract D7); such a member runs in the
  shared checkout, and the log says so.
- Members still run inside the parent workspace's sandbox boundary; see D2 above.
- A worktree REPOSITORY must live at or under the workspace root: the plugin canonicalises the repo's
  git top level and refuses a repo outside the workspace root with `repo-outside-workspace`. A
  workspace that is itself a subdirectory of a larger git repository is therefore refused; a repo at
  the workspace root or nested under it is supported.
- Worktrees are NOT destroyed when a team ends; `mpd_worktree_remove` is explicit.
- External/SDK subagent providers were not traced; only the native in-process backend is claimed.
- The `.mpd/mpd.jsonc` `worktree.*` overlay requires the composed `mpdConfig` service; on its own the
  row reads its row config only.

## Build / test

Build from the repository root with the PINNED toolchain (a PATH `bun` is the measured trap; see
AGENTS.md §6):

```sh
.toolchain/node_modules/.bin/bun build packages/mpd-worktree-plugin/src/index.ts \
  --target node --format esm --outfile packages/mpd-worktree-plugin/dist/index.js
bun test packages/mpd-worktree-plugin
```

The suite drives a REAL temporary git repository through the same operations the tools register:
create, list/status fields, duplicate refusal, outside-root refusal, merge success, conflict abort
with a clean main checkout, protected branches, remove with and without `force`, index persistence
and corrupt-read tolerance, and the never-throwing member service.
