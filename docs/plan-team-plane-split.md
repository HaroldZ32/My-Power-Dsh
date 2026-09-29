# Plan: the team-plane split (W1–W5)

<!-- docs-parity: exempt process record (AGENTS.md §3) -->

Process record (AGENTS.md §3: `docs/plan-*.md` is exempt from the bilingual rule). English-only.

## 1. The objective

**Separate the mpd agent-team system from the official DSH Agent Teams system COMPLETELY, with the
seam mediated by an adapter.** MPD owns the team; the official plugin becomes one interchangeable
executor backend behind `mpd-dsh-adapter` instead of the system of record.

User's decisions (2026-09-30), binding for this plan:

| Decision | Choice |
|---|---|
| Executor default | **native first**, official `dsh.team*` as fallback |
| Web sidebar hosts | **better-sidebar first**, official right sidebar as fallback (team AND workmate) |
| Sequencing | **wave by wave**, W1 first, report after each |
| TUI graph | boxed layered DAG, status colours, focus-chain highlight, rail fallback, mouse + keyboard focus (previewed and approved) |

## 2. Why the split is needed (measured, not asserted)

1. **The `dsh-tui` composition cannot mount the official service at all.** `TeamService`'s
   constructor ends with `ctx.effect(() => ctx.root.sessionProjections.register(...))`; Cordis binds
   that call to the ROOT context, and the dsh-tui host refuses `root.effect` from a plugin
   activation. `cordis.patch.yml` therefore DISABLES `mpd-agent-team` and `mpd-tool-agent-team` in a
   TUI plane. Consequence: the TUI team scene read `dsh.teamLiveTeams()`, got nothing, and rendered
   `(none in this workspace)` — the whole team plane is dead in TUI today.
2. **The official board has no `kind`, `attempt`, `round` or `verdict` field.** `team-state.ts`
   documents those four as deliberately absent, so the requirement → work → review chain the
   captain's own rules call for cannot be represented, let alone drawn.
3. **`mpd-workmate-plugin`'s in-use gate was blind.** `busyTeams()` scanned
   `.mpd/team/<teamId>/team.json` — the RETIRED vendored layout — while every team approved after
   the 0.1.7 rebase writes `.mpd/team/teams/<teamId>.json`. Rename/delete could take a workmate out
   from under a live teammate.
4. **The watchdog hold was carried but consulted by nobody.** `mpdWatchdog.isHeld()` exists and
   `agent_teams_dispatch` reads only its own `.mpd/team/hold.json`.

## 3. The architecture

```
                        ┌──────────────────────────────────────────┐
   tools ───────────────┤  mpd team system  (OWNS THE TRUTH)       │
   TUI   ───────────────┤  mpd-team-core                           │
   web   ───────────────┤   record  .mpd/team/**                   │
   watchdog ────────────┤   plan · roster · task DAG · contracts   │
   compact ─────────────┤   dispatch · halt · mailbox(sent→delivered→read)
   workmate ────────────┤  service: ctx.mpdTeams                   │
                        └──────────────┬───────────────────────────┘
                                       │  TeamExecutor  (the ONE seam)
                        ┌──────────────┴───────────────────────────┐
                        │  mpd-dsh-adapter  (the only file allowed │
                        │  to touch a harness service)             │
                        ├───────────────────┬──────────────────────┤
                        │ native executor   │ official executor    │
                        │ dsh.spawnAgent    │ dsh.teamSpawnTeammate│
                        │ startContinuable  │ teamCreateTask …     │
                        │ injectAgentMessage│                      │
                        └───────────────────┴──────────────────────┘
                          works in TUI,       only when ctx.agentTeams
                          headless, web       is really mounted
```

## 4. W1 — mpd owns the record

### 4.1 Delivered

| Step | What | Evidence |
|---|---|---|
| W1.1 | branch `feature/team-plane-split`; this work order | off the `fix/tui-team-plane-guard` tip so the evidence-backed TUI guard fix rides along |
| W1.2 | `packages/mpd-team-core-plugin/src/team-store.ts` — the mpd-owned team record: roster, board, mpd-minted short ids (`T1`, `M1`), `kind`/`attempt`/`round`/`verdict`, `blockedBy` edges, executor handles kept BESIDE our ids | `test/team-store.test.ts`, 19 arms |
| W1.2b | `approve` materialises the record BEFORE spawning anything and keeps the executor's handles in `executorRef`; `status` reports the record as the team | `test/team-record.test.ts`, 11 arms |
| W1.2c | `ctx.mpdTeams` published — the read surface every other mpd plugin resolves instead of `dsh.teamLiveTeams()` | same file, "the published service is the read surface" |
| W1.4 | the TUI team scene, the board and the status line read the RECORD first and the official readout only as a fallback — which is what makes the team plane work at all in a `dsh-tui` composition | `test/team-record-source.test.ts`, 7 arms |
| W1.5a | `busyTeams()` reads the mpd-owned record layout too, and respects the lifecycle (`endedAt`, settled members) | `rename-delete.test.ts`, 2 new arms |
| W1.5b | the watchdog's per-team hold now stops `agent_teams_dispatch`; before, it was carried by a service NO shipped gate consulted | `team-record.test.ts`, 3 arms including the lifted-hold falsifier |
| W1.1b | `mpd-team-tools` → `mpd-team-core` (dir, plugin name, row id, package name) — LAST, so the name never claimed a role the package did not hold | `evidence/team-plane-split/w1-rename/` |
| — | four dists rebuilt (stale since the `.js`→`.ts` vendored rename), so `verify-dist-fresh` is green for the first time on this branch | `evidence/team-plane-split/w1-record/` |

### 4.2 The one thing a reader MUST know before trusting a dist gate

**`verify-dist-fresh` needs the PINNED toolchain.** The repo declares `buildToolchain: bun@1.4.0`;
`PATH`'s bun here is 1.3.14, which emits a different export order, so 23/23 targets read STALE until
bun 1.4.0 is first on `PATH`. The pinned bun is installed at `.toolchain/node_modules/.bin/bun`
(gitignored). **Every dist-gate run in this wave MUST prefix the PATH**, or it measures the toolchain
rather than the tree:

```
PATH="$PWD/.toolchain/node_modules/.bin:$PATH" node scripts/verify-dist-fresh.ts
```

Making the gate resolve the pinned toolchain itself is a declared follow-up, not part of W1.

### 4.3 Still open in W1 — one item, by design

| Step | What | Why |
|---|---|---|
| W1.3 | host routes `/plugins/mpd-team/{state,plan,task,mail}` | lands WITH its consumer (W4's web body) so no dead endpoint ships in between |

### 4.4 A decision that was REVERTED, and why it is recorded here

While building the store I "fixed" a failed blocker so it would block its dependents, reasoning that a
task whose prerequisite gave up must not look dispatchable. Grepping for the reason found **OPT-1 — a
USER DECISION recorded 2026-09-13** in `evidence/omo-parity-rate/raw/pinned/state.ts`: *"a FAILED
dependency no longer pins its dependents forever; the dependent stays pending and dispatchable, while
`failedDependencyIds` carries the failure so the view can say so."* Overturning a recorded user decision
inside a refactor is not a refactor. Both copies keep OPT-1 and now carry the decision and its reason in
the code with a `DO NOT "FIX" THIS` marker, because it is exactly what the next reader would "correct".

What changed instead: `summariseTeam` counts `releasedByFailure` APART from `ready`, so "6 ready" can
never hide "3 of them are only ready because a prerequisite failed", and `failed` now means a failed
TASK (which it did not — a failed task fell into `other`).

## 5. W2 — the TeamExecutor seam (LANDED)

`DshTeamExecutor` in `mpd-dsh-adapter`, with two backends and a capability-based choice:

| | native (DEFAULT) | official (FALLBACK) |
|---|---|---|
| spawn | `subagents.startContinuable`, with the **provider and the member's `agentOptions` chosen by the caller** | `agentTeams.spawnTeammate` |
| send | `subagents.sendMessage` (cold-resumes an absent child) | `agentTeams.sendMessage` (adjacency-checked) |
| interrupt | `subagents.interrupt` under `{kind:'ancestor'}` | `agentTeams.interrupt` by NAME |
| membership | this adapter's own registry, keyed by the child session id | asked of the host |

Why the native default is the point of the whole split: the official tool row forwards only
`{ prompt, parent }` to `startContinuable`, so a per-member model route had to arrive through **row
config** (`freshProvider`) and a member's identity had to be encoded in its **teammate description**.
As a spawn argument the route is ordinary data, which is what lets a roster slot, a persona and the
read-only deny list apply to a teammate directly — and what makes the path need nothing from the
official plugin.

**The record is now the board for BOTH backends.** `approve` raises members through the executor and
posts no task anywhere; `dispatch` and `claim` read the record; `mail` delivers to the handle the
executor recorded. W1 still mirrored tasks to the official board, which left two sources of truth for
one team; an arm now asserts the negative directly (the spawn log is exactly
`["startContinuable", "startContinuable"]`, and no task carries a backend handle).

### 5.1 Three findings W2 produced

1. **`subagents` is a HOST-plane service and `mpd-team-core` can apply before it is ACTIVE**, so an
   apply-time read answers "unavailable" in a perfectly healthy composition. The TOOLS were never
   affected — every call re-resolves the executor lazily, which is why that is the design — but the
   boot LINE was, and it now re-reports when the service binds. The boot log carries both lines,
   which is how the ordering was measured rather than guessed.
2. **The D6 gate reported the first version of that deferred binding.** Naming the official service
   by string outside the adapter is exactly what it forbids. Only `subagents` is named now; the GATE
   was right and the CODE changed.
3. **Editing the adapter's source changes the built bytes of 19 other packages** — `bun build`
   inlines the relative imports. Every one had to be rebuilt, and `verify-dist-fresh` names them.

## 5b. W3–W5 (unchanged from the approved plan)

- **W3** the TUI team scene as previewed: boxed DAG, status colours, focus chain, rail fallback,
  mouse + keyboard focus.
- **W4** one adaptive web sidebar body (better-sidebar first, official right sidebar fallback) for
  team and workmate, fed by MPD's own host routes (W1.3).
- **W5** bilingual docs, full gate sweep, evidence, and removal of the now-unneeded TUI-plane guard.

## 6. Acceptance for W1

1. `bun test packages` green. ✅ 1287 pass, 3 skip, 0 fail (119 files).
2. `bun run verify:comments` PASS. ✅
3. `PATH=<pinned bun> node scripts/verify-dist-fresh.ts` → 23/23 fresh. ✅
4. `bun run verify:rows` → 33 row ids match. ✅
5. A team approved through the tools leaves an mpd record whose ids are MPD's and whose
   `executorRef`s are the executor's. ✅ `team-record.test.ts`.
7. A MOUNT boot proves the renamed row activates and registers: the boot log carries
   `[mpd-team-core] team workflow plane: staged=0 hold=none registrations=6`. ✅
   `evidence/team-plane-split/w1-rename/20260929T095301Z/mount-proof.txt`.
8. Every other static gate PASS: `verify:rows` (33 ids), `verify:manifest`, `verify:docs`,
   `verify:comments`, `verify-manual-paths`, `install-profile --dry-run`. ✅
6. A workmate named by a member of an mpd-owned record is refused by rename/delete. ✅
   `rename-delete.test.ts`.
