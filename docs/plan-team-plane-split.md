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
| W1.1 | branch `feature/team-plane-split`; this work order | branch off the `fix/tui-team-plane-guard` tip so the evidence-backed TUI guard fix rides along |
| W1.2 | `packages/mpd-team-tools-plugin/src/team-store.ts` — the mpd-owned team record: roster, board, mpd-minted short ids (`T1`, `M1`), `kind`/`attempt`/`round`/`verdict`, `blockedBy` edges, executor handles kept BESIDE our ids | `test/team-store.test.ts`, 19 arms |
| W1.2b | `approve` materialises the record BEFORE spawning anything and keeps the executor's handles in `executorRef`; `status` reports the record as the team with the official readout beside it | `test/team-record.test.ts`, 8 arms |
| W1.2c | `ctx.mpdTeams` published — the read surface every other mpd plugin resolves instead of `dsh.teamLiveTeams()` | same file, "the published service is the read surface" |
| W1.5a | `busyTeams()` reads the mpd-owned record layout too, and respects the lifecycle (`endedAt`, settled members) | `rename-delete.test.ts`, 2 new arms |
| — | four dists rebuilt (stale since the `.js`→`.ts` vendored rename), so `verify-dist-fresh` is green for the first time on this branch | `node scripts/verify-dist-fresh.ts` → 23/23 fresh |

### 4.2 Delivered with a caveat

**`verify-dist-fresh` needs the PINNED toolchain.** The repo declares `buildToolchain: bun@1.4.0`;
`PATH`'s bun here is 1.3.14, which emits a different export order, so 23/23 targets read STALE until
bun 1.4.0 is first on `PATH`. The pinned bun is installed at `.toolchain/node_modules/.bin/bun`
(gitignored). **Every dist gate run in this wave MUST prefix the PATH**, or it measures the
toolchain rather than the tree:

```
PATH="$PWD/.toolchain/node_modules/.bin:$PATH" node scripts/verify-dist-fresh.ts
```

Making the gate resolve the pinned toolchain itself is a declared follow-up, not part of W1.

### 4.3 Still open in W1

| Step | What | Why it is not done yet |
|---|---|---|
| W1.3 | host routes `/plugins/mpd-team/{state,plan,task,mail}` | the web body that consumes them is W4; the route lands with its consumer so no dead endpoint ships |
| W1.4 | rewire the TUI, watchdog and compact readers off `dsh.teamLiveTeams()` | the TUI half belongs with W3's scene rewrite (one change to that file, not two) |
| W1.5b | wire the watchdog hold into `agent_teams_dispatch` | needs the hold to be readable per TEAM, not per workspace |
| W1.1b | rename `mpd-team-tools` → `mpd-team-core` | deliberately LAST in W1: the name must not claim a role the package does not hold yet |

## 5. W2–W5 (unchanged from the approved plan)

- **W2** `TeamExecutor` seam in `mpd-dsh-adapter`: `native` (default) + `official` (fallback).
- **W3** the TUI team scene as previewed: boxed DAG, status colours, focus chain, rail fallback,
  mouse + keyboard focus.
- **W4** one adaptive web sidebar body (better-sidebar first, official right sidebar fallback) for
  team and workmate, fed by MPD's own host routes.
- **W5** bilingual docs, full gate sweep, evidence, and removal of the now-unneeded TUI-plane guard.

## 6. Acceptance for W1

1. `bun test packages/mpd-team-tools-plugin packages/mpd-workmate-plugin` green. ✅ 121 pass.
2. `bun run verify:comments` PASS. ✅
3. `PATH=<pinned bun> node scripts/verify-dist-fresh.ts` → 23/23 fresh. ✅
4. `bun run verify:rows` → 33 row ids match. ✅
5. A team approved through the tools leaves an mpd record whose ids are MPD's and whose
   `executorRef`s are the executor's. ✅ `team-record.test.ts`.
6. A workmate named by a member of an mpd-owned record is refused by rename/delete. ✅
   `rename-delete.test.ts`.
