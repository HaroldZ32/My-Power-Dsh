# T6 Lane F — blind review basis (recorded BEFORE any implementation read)

Recorded 2026-11-12T03:0xZ by reviewer, before opening any file under `packages/*/src`
or `packages/*/test`.

## Documents the verdict will rest on

- `.mpd/plans/agent-worktrees.md` (frozen contract; §1 objective, §2 D1–D8, §3 Lane A tool contract,
  Lane B/C/D/E, §4 acceptance 1–7, §5 known bounds)
- `docs/worktree.md` + `docs/worktree.zh-CN.md` (new, Lane D)
- `docs/cellwork.md` §"Member worktrees" (diff)
- `agent-references/git-model.md` §1 amendment (one writer per worktree) and §5 move
- `AGENTS.md` diff (captain budget edit; §5 pointers)
- `AGENTS.md` §4 gate table (which gate runs for which change), §6 build discipline

## Arms the review will judge (from the contract text alone)

Tool contract (`mpd-worktree-plugin`, Lane A):
1. create: slug `[a-z0-9][a-z0-9._-]{0,79}`; repo precedence arg → config → workspace root when
   `git rev-parse --show-toplevel` succeeds; path = resolve(config.dir, slug) MUST be under workspace
   root else refuse with the D2 reason; refuse existing path; refuse registered name; branch default
   `<branchPrefix><slug>` validated by `git check-ref-format --branch`; base default main checkout HEAD
   (SHA when detached); `git worktree add <path> -b <branch> <base>`; record index; return
   `{ name, path, branch, base, repo }`.
2. list: joins `git worktree list --porcelain` with index; fields
   `{name,path,branch,repo,exists,dirty,ahead,behind,merged}`; `merged` = ancestor of main current
   branch; ahead/behind via `rev-list --left-right --count`.
3. status: same record for one; unknown name = structured error.
4. merge: `into` default main current branch; REFUSE detached main; REFUSE tracked-dirty main; REFUSE
   protected `into` without `force`; `into` must be checked out in main; `merge --no-ff … -m
   "merge(<teamId>/<member>): <branch>"`; conflict → `merge --abort`, `{merged:false,conflicts:[…]}`,
   nothing changed; success → index `merged`, `{merged:true,branch,into,commit}`.
5. remove: refuse dirty/unmerged without force; `worktree remove [--force]`; `branch -d|-D`; index
   `removed`; missing path pruned not an error.
6. Service `mpdWorktree` with `createForMember(exec,{teamId,member})` idempotent, never throws, degrade
   with ONE log line, and `cwdForMember(exec,{teamId,member})`; the ONLY surface Lane C may call.
7. Config schema defaults: enabled true, dir `<ws>/.mpd/worktrees`, branchPrefix `agent/`,
   protectedBranches ["master","dev"], max 32.
8. State `<ws>/.mpd/worktrees/index.json` atomic write (tmp+rename), tolerant read, version 1, key
   `<teamId>/<member>` | `manual/<name>`, status active|merged|removed.
9. Tests listed in the contract (create/refusals/merge/conflict/protected/remove/index).

Wiring (Lane B/C):
10. Adapter `DshSpawnSpec`/`DshTeamSpawnRequest` optional `cwd`; forwarded ONLY when supplied; official
    fallback logs ONE line and spawns without cwd, never throws.
11. team-core: EVERY member spawn site resolves `ctx.get("mpdWorktree", false)`; NON-read-only member
    gets cwd; read-only skipped by the dispatch guard's predicate (no second list); absent/disabled/
    non-git/failed create → spawn unchanged with exactly one log line.
12. cellwork reseed: `startContinuableAgent` request gains the member's worktree cwd from the service;
    absent → request unchanged.

Acceptance (wave): 1 cwd+branch+commit; 2 state stays shared; 3 degrade paths; 4 tools incl conflict
abort + protected; 5 reseed keeps worktree; 6 all Lane E gates pass with evidence + Reviewer PASS;
7 docs bilingual, verify:docs green.

## What "independent" means here

The writer's own tests are NOT acceptance evidence on their own. Each contract arm must be proven by
(a) a gate run I performed myself, or (b) my own probe through the built `dist/` surface, or (c) a
test arm I read and whose assertion I can see fails when the property is absent. A shape-move (updated
arm) is not behaviour-restored evidence and will be named as such.
