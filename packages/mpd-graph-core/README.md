# mpd-graph-core

**English** | [中文](./README.zh-CN.md)

The shared plan→graph core of wave `living-graph`: one exported rank derivation, one tolerant
task-plan parser, one deterministic merge model and one debounced file watcher, consumed by both the
TUI and the web plane.

A LIBRARY, NOT A PLUGIN. There is no cordis row, no patch entry and no runtime dependency. Both
planes INLINE this package through `bun build`, so there is exactly one implementation of every rule
below. A browser-targeted bundle imports the module it needs (`./rank.ts`, `./types.ts`) rather than
the barrel, because the barrel also carries the two `node:fs` modules; both paths are the same code.

## Why this package exists

Before this package the TUI derived a board's ranks in a private function inside
`mpd-tui-plugin/src/graph.ts` and the web plane derived them again inside `team-view.ts`'s factory
body. Two implementations of one derivation, neither exported: a fix to one could not reach the
other plane, and a test could pin only its own copy.

The user's requirement — a task plan that feeds a live picture, with the web and TUI sharing one
infrastructure, drawn by code and never by a model — is this package plus the two projections that
consume it.

## The model

`buildModel({ board, plan })` merges the LIVE board (`.mpd/team/teams/<id>.json`) with the parsed
task-plan markdown and returns one deterministic, serializable model.

The board is authoritative for live state; the plan is intent that the board may not carry yet.
Where they disagree, the model RENDERS the disagreement and REPORTS it instead of resolving it
silently:

| case | model behaviour |
|---|---|
| id on the board, absent from the plan | drawn from the board; `report.boardOnly` |
| id in the plan, absent from the board | drawn as a GHOST (`planned: true`, `visual: "planned"`), never dropped; `report.planOnly` |
| edge in the plan, absent from the board | drawn with `source: "plan"`; `report.edgePlanOnly` |
| edge on the board, absent from the plan | drawn with `source: "board"`; `report.edgeBoardOnly` |
| both, agreeing | an ordinary edge with `source: "both"`, named by neither list |
| plan line unparseable | `report.planProblems`, one entry per line, never a throw |

The shapes (all plain JSON — no `Map`, no `Set`, no class instance, no function):

```
GraphModel  = { nodes, edges, ranks, cycles, report }
GraphNode   = { id, subject, kind?, visual, assignee?, dependencies, depth, planned, title?, status? }
GraphEdge   = { from, to, source: "board" | "plan" | "both" }
GraphReport = { boardOnly, planOnly, edgePlanOnly, edgeBoardOnly,
                planProblems, unresolved, ranksDerived }
```

`depth` on a node is the RESOLVED column (derived from the blocker graph, or the served-depth
fallback the report names), so a consumer never re-buckets. `planned` is `true` exactly for a GHOST;
a ghost carries both that boolean and `visual: "planned"` on purpose, because a consumer keys on the
boolean while a renderer keys on the string.

**Determinism.** The same board and the same plan produce the same model, byte for byte. Nodes, rank
buckets and both id lists are ordered by the numeric id collator (`T2` before `T10`); edges by
(`from`, then `to`); plan problems by source line and then by text. No collection that reaches the
drawing is ordered by a `Map`/`Set` insertion accident. `JSON.stringify` round-trips the model
unchanged: an absent optional field is an absent key, never an `undefined` value.

**Cycles and flat boards are rendered honestly.** A dependency cycle keeps every rank finite and is
listed in `cycles`; a board whose every `blockedBy` is `[]` draws flat, with one rank and no edges —
that is a true picture, not a defect.

## The plan-markdown subset

This is the exact grammar the parser accepts. Hand-authored fixtures are written from this list.

**Headings.** Two level-2 headings open a tracked section: `## TODOs` and
`## Final Verification Wave` (case-insensitive, optional trailing `#`s). Any other level-1 or level-2
heading closes the open section; level-3 and deeper headings do not. Fenced code blocks (``` or ~~~)
are ignored entirely, so a plan that quotes the grammar declares nothing.

**Task ids.** An item's id comes from its own marker, never from prose: a TODO ordinal `N` becomes
`T<N>`, and a final-verification marker `F<N>` becomes `F<N>`.

**Task item forms** (column 0 only — an indented line is a continuation, never a task):

```
1. title                     - 1. title
- [ ] 1. title               - [x] 1. title
F1. title                    - F1. title                  - [ ] F1. title
```

**Titles.** The text after the marker, with a leading lane marker removed ONLY when the lane table
declares that key: `A. Core work`, `C — parser work`, `P0 · contract work` and
`Lane B (Senior Engineer) — panel work` all yield a lane key (`A`, `C`, `P0`, `B`) and leave the
title behind the marker, provided the document declares those lanes. A marker must be followed by a
separator (`.`, `—`, `–`, `·`, `:`, `(`) or end the title, so ordinary prose is not mistaken for a
lane. A marker-shaped prefix whose key the lane table does NOT declare is reported as a problem and
the title is kept VERBATIM — a tolerant parser must not eat the first token of a real title. A title
is its first line only; deeper continuation lines are ignored rather than reported.

**Lane tables (owners).** Any markdown table whose header carries both a `Lane` cell and an `Owner`
cell supplies owners, at any depth and under any heading. The first row for a key wins. The owner is
the second cell with emphasis markers removed and a trailing qualifier cut (`Junior Engineer (after
C)` becomes `Junior Engineer`). A task's owner is the row matching the lane key its title names; a
task with no lane marker has no plan owner.

**Declared edges.** A line declares blockers in one of two ways:

- parenthesised: `(blocked by 1, 2)`, `(blocked_by Lane A)` — any case, `-` or `_` or a space
  between the words;
- colon-labelled: `blocked_by: 2, F1`, `blocked-by: 2`, `blocked by: 2`, `depends on: T3`.

References are separated by commas, `+`, `&` or `and`. One reference is `T<n>`, `F<n>`, a bare
number (meaning `T<n>`) or a lane reference (`Lane A`, or a bare lane key the plan declares). A lane
reference blocks on every task that lane declares, except the task itself. Bare prose after
`blocked by` does not declare an edge.

**What makes a line a problem.** Never a throw: every problem is reported with its 1-based line, its
verbatim text and a reason, in document order. A line is a problem when it is a CANDIDATE inside a
tracked section — starting at column 0 with a bullet, a bare `N.` or an `F<N>.` — and fails that
section's grammar (a half-typed `- [ ] 2`, a stray bullet, an `F` item under `## TODOs`). Also a
problem: a lane-table row with no lane key or no owner, a declared blocker reference that names no
id and no declared lane, and a duplicate task id (the first one wins and still parses). Prose, blank
lines, headings, table rows and indented continuation lines are NOT problems.

## Plan-file resolution

`resolvePlanFile(workspaceRoot)` is the ONE resolution both consumers use, so the two planes cannot
watch two different files:

1. **Beacon** — the plan of the ACTIVE boulder work in `<workspace>/.mpd/boulder.json`: the work
   `active_work_id` names, when its `status` is `active`, and its file still exists. A terminal
   (for example `completed`) work is deliberately NOT a beacon: its plan is history, and following
   it would pin the live picture to a finished wave. A beacon whose file is gone also falls through.
2. **Newest** — the newest `*.md` under `<workspace>/.mpd/plans/` by modification time, then by name
   on a tie (so two files written in one millisecond resolve the same way on every run). A
   `*.zh-CN.md` twin is never a candidate.
3. **None** — `undefined`, which every caller must treat as "no plan", never as an error.

`readPlanFile(path)` reads tolerantly: `undefined` yields an empty plan with NO problem (a workspace
without a plan is normal), and a path that cannot be read yields one problem at line `0` rather than
a throw.

## Watching the inputs

`watchGraph({ boardDir?, planFile?, plansDir? }, { debounceMs?, onChange?, onError? })` returns ONE
watcher that everything subscribes to — two watchers on one file is the resource waste the
event-driven refresh was chosen to avoid.

```ts
GraphWatcher = {
  subscribe(listener): () => void     // add a batch listener, returned function removes it
  poll(): boolean                     // manual resync: compare now, deliver if anything moved
  close(): void                       // stop every handle, drop every listener
  readonly watching: boolean          // at least one directory handle armed
  readonly closed: boolean
  readonly sequence: number           // batches delivered so far
  readonly coalesced: number          // raw notifications those batches absorbed in total
}
GraphChangeEvent = { paths, manual, sequence, coalesced }
```

**How it stays correct.** The watcher watches the DIRECTORY that holds each target — walking up to
the nearest directory that exists, which is how a target that does not exist yet is still detected
when it is created — and decides whether anything changed by comparing a signature it computes
itself (inode, mtime, ctime and size per file). A rename, a replace, a delete and a create are all
just "the signature moved", so a rename cannot strand the watch on an inode nobody writes to any
more. A missing file or directory is survived; the arming pass re-runs after EVERY debounce, and it
records the identity of the directory each watch attached to. The watcher re-arms on a platform
`close` OR `error`, on a directory SELF-EVENT (some runtimes report a directory's own removal as a
notification named after the directory, with no `close` at all), or on a BOUNDED TIMER, and it
compares the inode AND the birthtime: an `rm -rf` followed by a `mkdir` can reuse the inode, and only
the birthtime still tells the new directory from the one whose watch just died. Every re-arm ALSO
compares the target signatures — skipped only when a debounce timer is already pending, because that
timer delivers — so a write that landed while the watch was dead (and therefore produced no
notification at all) is still delivered instead of waiting for an unrelated event. A directory
REPLACED at the same path is therefore re-armed, because an inotify watch follows the inode rather
than the path and a watch that merely looked "already armed" would silently stop reporting the new
directory's files. The attempts are BOUNDED: when all three fail the watch stays dead and the
schedule gives up with no batch of its own, while a REFUSED attempt is still reported through
`onError`, so "nothing happened" and "it failed and we were told" stay distinguishable.

**A plan that APPEARS is a change.** `plansDir` watches the plans directory as a SET, not as one
file: its signature is every candidate plan file (`*.md`, never `*.zh-CN.md`), so creating a plan
where none existed — or creating a newer one that changes `resolvePlanFile`'s answer — emits a batch
even though the previously watched file did not change. Without that, "a plan edit re-renders" would
silently exclude "a plan created".

**The debounce is observable.** Changes inside one window collapse into ONE batch whose `coalesced`
count says how many raw notifications it absorbed; the watcher carries the running total. A silent
collapse is therefore impossible to miss: `sequence === 1` with `coalesced === 2` is a proven
collapse, and `poll()` is the resync path that uses the same comparison. A listener that throws is
reported through `onError` and cannot stop the batch.

## Public API

```ts
// rank.ts — the derivation, moved verbatim from the TUI module and exported
deriveRanks(tasks, byId): Map<string, number>
servedRank(task): number
bucketRanks(tasks, rankOf): T[][]
rankPlan(tasks, served?): RankPlan<T>
cycleIds(tasks): string[]
ID_ORDER: Intl.Collator

// plan.ts — the tolerant parser
parsePlanMarkdown(text): PlanDocument

// resolve.ts — which file, the tolerant read, and the directory a watcher must name
plansDirectory(workspaceRoot): string
resolvePlanFile(workspaceRoot): string | undefined
readPlanFile(path): PlanDocument

// model.ts — the one model
buildModel({ board?, plan? }): GraphModel

// watch.ts — one watcher
watchGraph(targets, options?): GraphWatcher
```

`rankPlan(tasks, served?)` accepts any structurally compatible row (`{ id, dependencies, depth }`)
and returns the caller's own row type. With `served` present it applies ranks computed elsewhere
(`derived: false`, `rankOf` is that map) while running the same unresolved-reference scan; without
it, it derives the ranks. This is the TUI's path: the host computed the model once, so the layout
applies those columns instead of reconstructing a rank plan of its own. `RankPlan` holds the lookup
`Map`; it is deliberately NOT part of `GraphModel`, which is the value that crosses the wire.

`watchGraph`'s options carry `createWatch?: GraphWatchFactory` as a TEST SEAM: it defaults to
`fs.watch` and exists because a platform may not signal a directory's death at all (Bun emits no
`close` for a removed or renamed directory), so the close-recovery arm cannot be proven without it.
No product caller passes it.

## Building and testing

Build from the REPOSITORY ROOT with the pinned toolchain, so the committed artifact matches the
toolchain the freshness gate rebuilds with:

```
.toolchain/node_modules/.bin/bun build packages/mpd-graph-core/src/index.ts \
  --target node --format esm --outfile packages/mpd-graph-core/dist/index.js
bun test packages/mpd-graph-core
```

The package ships `src/index.ts` (the barrel), this README pair, and `dist/index.js` built by the
command above. It declares no dependency of any kind.
