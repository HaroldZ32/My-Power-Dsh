# R-W3D — verdict on the global memory store, the scope parameter and the archive hook

Reviewer: reviewer-a (independent of the W3-D writer). Judged against the frozen contract
`.mpd/plans/autoproject-refactor.md` §4.7, forward note **F1** and **R6**, plus the W3-D task's own
acceptance text — never against the writer's narrative. Every claim below was re-measured.
Measurement instant: **2026-11-02T12:55Z** (20:55 Asia/Shanghai), tree `feature/autoproject-refactor`,
uncommitted, several lanes active in the same worktree.

## Assessment

**Risk level: LOW.** This is a careful implementation of all five deliverables, and the parts that could
have gone silently wrong are the parts I verified hardest. The R6 protection is real and runs BEFORE
anything is created: a sandbox `HOME` is allowed, the real `HOME` is refused, an unset `HOME` is refused
under a `DSH_HOME`-set boot, and a normal session no-ops — and a refused archive write leaves no
directory behind (probe). The F1 containment rule is documented in BOTH README halves with the exact
consequence ("a `memory.globalDir` must live inside the sandbox `$HOME`"), which is option (b) of the
forward note plus the root derived from `HOME` per call. Idempotence is exactly as specified: the same key
twice wrote ONE file and ONE index row with `superseded: 1`, appended
`{"kind":"superseded","by":"cellwork_stop","previous":"boulder_complete",…}` to the journal, and a second
workspace with the same project key produced a different file (workspace-hash suffix) and its own row —
no collision. The three event matchers were verified against the REAL producing code rather than a
fixture: `mpd_boulder_complete` returns `workId`, `cellwork_stop` returns `{ok, cellId}`,
`agent_teams_plan{action:"delete"}` returns `archivedTo`, and `archivedPlans` returns
`{planId, approvedAt?, teamId?, path}` where `path` is `<archiveDir>/plan.json` and `archivePlan` returns
that same directory — so `findArchivedPlan`'s `dirname(path) === resolve(archivedTo)` match is right
end-to-end, and the `approvedAt` filter, the `mpdTeams`-absent degradation (one log line, null) and the
not-in-listing case all behave. The listener always returns `undefined`, contains its own throw, and
returns a no-op disposer when the seam is missing. `scope` defaults to `workspace` (only the literal
`"global"` selects the global store, so a typo stays on the workspace store), the five tool names are
unchanged, and the pre-existing `memory.test.ts` — UNTOUCHED since 2026-10-26 — passes against the
refactored source, which is the strongest available evidence that no existing contract moved. The digest
is model-free and network-free, and an unreadable source is NAMED in an `## Unreadable` section instead of
invented. The one real weakness is that the hook's whole coupling to three other packages is a set of
structural string keys with no pin, so a rename on any producer side would silently disable the feature.

## Ranked findings

### Blocker — none
### High — none

### Medium

**M1. The hook's cross-package coupling is unpinned, and its failure mode is SILENT.**
`packages/mpd-memory-plugin/src/archive.ts :: matchArchiveEvent` / `ArchivedPlanView` /
`TeamsServiceView`. The hook reads `value.workId`, `value.cellId`, `value.archivedTo`, and the plan view's
`path` / `approvedAt` / `teamId` — string keys owned by three OTHER rows (`mpd_boulder_complete`,
`cellwork_stop`, `agent_teams_plan` + `mpdTeams.archivedPlans`). I verified all of them against the live
code today, so there is no current defect — but nothing pins the two sides together: the memory tests drive
the matcher with a FIXTURE (`grep` finds no reference to `mpd-team-core` in
`packages/mpd-memory-plugin/test/`), C1 forbids a src import, and `ArchivedPlanView` is a hand-copied
structural clone of `ArchivedPlanSummary`. A future rename on any producer side (the plan view's `path`,
the stop result's `cellId`, the delete's `archivedTo`) turns the corresponding arm into a no-op that logs
nothing, because a non-match is a legitimate quiet outcome. The user-visible consequence is a project that
closes and leaves no memory entry, discovered only when someone goes looking for it.
Direction: add ONE pin in a place allowed to import across packages — the QA plane (a `dsh-qa` case can
read the three tools' output schemas and the `archivedPlans` shape in one process) or a `test/` file that
imports the real types and asserts assignability — so a producer rename reddens instead of going quiet.
Not a repair of this lane's code: it is the W1-A/W2 team-plane side of the same contract.

### Nit

**N1. A synchronous VCS commit now runs inside the harness's post-execute waterfall.** The hook is
registered on `tools/post-execute`, and on a qualifying event it runs `ensureVcs` + `commitAll` →
`spawnSync("git", ["add","-A"])` + `spawnSync("git", commit)` (and the svn pair for `both`), each with a
**60 s** timeout. So a `mpd_boulder_complete` / `cellwork_stop` / approved-plan delete can be delayed by a
commit over a store that grows monotonically (it accumulates across every project), and a wedged backend
stalls that tool call for up to the timeout per backend. The task explicitly ordered reusing `commitAll`,
and the same pattern already governs a workspace `mpd_memory_write` (where the commit is the tool's own
work) — but here it is piggybacked on another row's tool. Direction: record the bound; if it ever bites,
the cheap fix is an asynchronous fire-and-forget commit for the HOOK path only, leaving the tool path
synchronous.

**N2. The entry FILE NAME is lossy while the index key is exact.** `writeArchiveEntry` keys
`index.json` by `resolve(workspace) + ":" + projectKey` (exact) but names the file
`project-<slug(projectKey)>-<shortHash(workspace)>.md`, where `slugForFile` lowercases, collapses every
non-alphanumeric run to `-` and **caps at 40 characters**. Two distinct project keys that slug identically
inside one workspace (`w_1` vs `w-1`, or two ids sharing a 40-char slugged prefix) therefore map to ONE
file: the second overwrites the first's digest while the index keeps two rows pointing at it, and the loss
is silent. Generated ids (`w-<ts>`, cell ids, team ids) make it theoretical today. Direction: append the
same `shortHash(projectKey)` used for the workspace, so the file name is as identity-bearing as the key.

## Declined to judge

- **`mpd_memory_read`'s pagination (`offset`, `next_offset`, `count` = TOTAL matched)** — that is W4-A6a / board T30's spec (§10 A6), a different task in the same package; I confirmed the tool NAMES are the five and that the untouched pre-existing suite still passes, which is this review's contract.
- **`mpd_memory_status`'s global branch reporting the WORKSPACE agent's reflection counters** — the tool description states it and "reflection stays workspace-scoped" is the contract's own rule; naming an agent's counters beside a shared store is honest, not a defect.
- **The digest's content choices** (12 titles / 20 scopes caps, section wording, `stopReason` also pushed into `open`) — the contract fixes the SECTIONS, not the caps; product choices.
- **Hook propagation to subagent tool calls** — I did not measure whether a row-scoped `tools/post-execute` listener sees a child agent's calls; the contract asks for ONE listener with no scope clause, so a narrower reach would be a bound to record rather than a violation.
- **`mpdTeams.get` being optional in the digest** — absent reads as `unreadable` ("the live team record …"), which is the never-invent rule working as intended.
- **The `both` VCS mode's real svn arms** — skipped in this environment (no `svn`/`svnadmin`), exactly as the package's own suite skips them; the fake-CLI wiring arm passes.
- **The repo-wide `verify:comments` red** — it names `packages/mpd-cellwork-plugin/test/lib/team-actions-double.ts` and `packages/mpd-roles-plugin/test/admission.test.ts` (the latter edited at 20:44 while I reviewed, apparently adding an arm for my R-W4A4 N1). Both are OTHER lanes' files; the memory package's three scanned source files are clean, so this is not a W3-D finding — but it is red in the tree right now and belongs to those lanes.
- **The `git`/`svn` "nothing to commit" path, index corruption tolerance, and `state.json` read-compat** — the existing engine's behaviour, reused unchanged.

## Verdict

**PASS** — every R6/F1 protection is proven by refusal arms that run before any creation (sandbox allowed,
real home refused, HOME unset refused, normal session no-ops, no directory left behind on a refusal), the
three matchers are verified against the real producing tools' return shapes end-to-end, idempotence,
supersede and workspace namespacing are exactly as specified (verified by writing into a mkdtemp sandbox
and reading the resulting `index.json` / `journal.jsonl`), the listener is contained and always returns
`undefined`, `scope` defaults to `workspace` with the untouched pre-existing suite still green, and the
digest is model-free and never invents an unreadable source; the Medium is a cross-package pin that the
team-plane side should add, not a defect in this change.

## Evidence measured (commands and observed results)

| Check | Command | Observed |
|---|---|---|
| package suite | `bun test packages/mpd-memory-plugin` | **23 pass / 2 skip / 0 fail** (skips are the real-`svn`-CLI arms); the pre-existing `memory.test.ts` is unmodified since 2026-10-26 and passes |
| types | `bun run typecheck` | exit 0 |
| docs | `bun run verify:docs` | PASS — 54 pairs, 505 links, 0 dead (both README halves updated) |
| comments | `bun run verify:comments` | repo-wide **RED**, but only on two OTHER packages' test files; the three `mpd-memory-plugin/src` files are in the scanned set (verified with `--list`) and clean |
| guard arms | `probe-guard.ts` (pure) | sandbox HOME → ALLOWED `<sandbox>/.mpd/memory`; real HOME → REFUSED `real-home-refused`; HOME unset → REFUSED; normal session → no-op |
| matcher matrix | `probe-archive.ts` | boulder→`boulder_complete` (result `workId`, arg fallback, `isError`→null); cell→`cellwork_stop` (`ok:false`→null); plan→`team_plan_archive` only on `action:"delete"` + a real `archivedTo` + the listing + non-empty `approvedAt`; `mpdTeams` absent → null + ONE log line; not-in-listing → null + log |
| idempotence | same probe, mkdtemp sandbox | same key twice → one `project-…md`, `superseded: 1`, journal `archive`,`archive`,`superseded(by=cellwork_stop, previous=boulder_complete)`; second workspace → its own file + row |
| entry shape | same probe | frontmatter `{"kind":"fact","scope":"global","tags":["project","archive","<eventKind>"]}`, body sections What was built / Proof / Where / Open (+ `## Unreadable` when needed) |
| listener | same probe | returns `undefined`; disposer is a function and releases; a throwing adapter yields a no-op function; `handleArchiveCall` on a guard-refused path → `null` + one log line |
| cross-package shapes | `grep` the producers | `mpd_boulder_complete` → `{workId,status,…}`; `cellwork_stop` → `{ok:true,cellId}`; `agent_teams_plan delete` → `{archivedTo: archivePlan(...)}` where `archivePlan` returns the DIRECTORY; `archivedPlans` → `{planId,approvedAt?,teamId?,path}` with `path = <dir>/plan.json` — every read matches |
| scope default | `scopeOf` probe | `{}`→`workspace`, `{scope:"global"}`→`global`, `{scope:"Global"}`→`workspace` |
| scope discipline | `git status` | only `packages/mpd-memory-plugin/**` (3 modified, 5 new); `dist` untouched (mtime 17:39); no `skills/**` |

## Bounds of this review

**Not read in full:** `archive.ts` (859 lines) and `store.ts` (348) were read in the regions that carry the
contract — matchers, guard, root derivation, idempotence, digest builders/renderer, index/journal, VCS
reuse — plus the whole of `index.ts`; the JSON readers, the slug/hash helpers and the long digest
`merge*` helpers were grepped and spot-read, not line-audited. The new test files (55 KB) were not read
line by line; the behaviours they claim were re-derived with my own probes instead.
**Not run:** a real mount/session (the hook is only exercised in-process), the Docker lane, any
`packages/*/dist` rebuild (C9), and any git write.
**Not verified:** whether a row-scoped `tools/post-execute` listener also observes a subagent's tool calls;
the `svn`-backed commit path (toolchain absent); and the writer's "17 pass" count, which has since grown
to 23 with the sibling pagination task's arms.
