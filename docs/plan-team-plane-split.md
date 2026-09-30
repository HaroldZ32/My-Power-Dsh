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
| W1.3 | host routes `/plugins/mpd-team/{state,plan,task,mail}` | **CLOSED (2026-09-30)** — `state` landed with W4's web body; the other three landed when a consumer was named. See §5f. |

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

## 5b. W3 — the TUI team scene (LANDED)

`packages/mpd-tui-plugin/src/graph.ts` is a PURE renderer: a board and a width in, text plus tones
out. The scene consumes it, which is what makes the drawing testable without a terminal, a React
reconciler or a team.

| view | when | what it is |
|---|---|---|
| `boxes` | the default | the layered DAG; rank (longest dependency path) is the vertical axis, edges drawn with box-drawing junctions |
| `rail` | a rank too wide for the viewport | an indented forest; a multi-blocker task names the extras inline (`⇠ T4+T6`) rather than losing an edge |
| `list` | a board too dense to lay out | a rank-grouped table |

`layoutBoxes` REFUSES rather than squeezing below its minimum, so the fallback is a fact about the
geometry instead of a guess about the terminal. Colour is a MEANING: a span carries a `GraphTone`
and `GRAPH_THEME` maps it to a dsh-tui theme key, so the drawing follows the palette and a test can
assert the semantics rather than a hex value.

**Mouse is additive.** The graph Box declares `onMouseEnter`/`onClick`/`onWheel`, and `hitTest`
resolves a pointer by RECTANGLE against the layout that was actually drawn — no second geometry to
drift. Hover previews · click pins · `esc` unpins (the second `esc` closes). A host without mouse
tracking never fires the handlers and the keyboard path is untouched.

### 5b.1 Five bugs the arms caught, all fixed

1. **`layoutRail` recursed forever on a cyclic board** — its "draw a task reached by no root"
   fallback re-entered the cycle. A visited set makes the forest one row per task: the correct
   output AND the termination proof.
2. **The rail overflowed a 24-cell viewport at 31 cells** because its label floor outranked the
   tail. `clampSpans` now enforces "never exceeds the width" STRUCTURALLY, in all three layouts.
3. **Untouched cells were labelled `dim`**, so a drawing with nothing dimmed still reported that
   tone — which made the focus's dimming signal unreadable.
4. **An absent `kind` left a double space** in the boxes view and not in the rail; one `labelOf`
   builder now serves all three.
5. **The scene rewrite dropped the team id** from the header, which `approve <teamId>` needs. Two
   existing arms caught it — the second through the control character it carries.

## 5c. W4 — the adaptive web sidebar (LANDED)

**The last official coupling in the browser is gone.** The Web team tab read
`state.projectionsBySession[leadId].values.agentTeam` — the official client projection, and a store
that is EMPTY in exactly the compositions the split exists for, because a client store can only carry
what a mounted service projected.

- **`mpd-team-core-plugin/src/team-web.ts`** — `/plugins/mpd-team/state`, registered through the
  adapter's `webServerOf()` and re-attempted when the web server binds late. `buildTeamState()` is
  PURE, so the client contract is a value rather than a running handler, and the payload carries what
  the official board has no column for: `kind`, `attempt`, `round`, `verdict`, and the resolved
  per-member route. The VISUAL state comes from the same store function the TUI uses.
- **`mpd-bundle-plugin/src/team-view.ts`** — ONE body both hosts render. They are different extension
  APIs with different prop shapes, and a view written against either works only there; both can
  `fetch`, so both read our route.
- **The preference** (user decision, 2026-09-30): `dsh-better-sidebar` first, the harness's own right
  sidebar as the fallback, applied at the one moment the answer is knowable — when the official
  sidebar is ready to accept a registration. Both the team view and the workmate library register
  there; the workmate one is why this mattered, since `dsh-better-sidebar` is an optional peer a
  checkout install does not resolve.

### 5c.1 Four defects this wave produced, all fixed

1. **The settings-card splice anchor never matched.** Type stripping replaces a removed annotation
   with SPACES to keep offsets stable, so `function loadSettingsCard(): SettingsCardModule {` arrives
   as `function loadSettingsCard()                     {` — 21 spaces — and the anchor demanded
   exactly one. The splice had been dropped from every rebuild since the TypeScript conversion.
2. **The splice guards could not fail.** They tested `includes("MPD_SETTINGS_CARD")`, which the source
   satisfies with its OWN declaration and call site. They now check the declaration.
3. **Runtime code in the ambient-only zone.** The module is spliced as ONE ARROW EXPRESSION, so
   anything after the factory's closing brace lands OUTSIDE the module wrapper. `declare` survives
   that; runtime code does not.
4. **A preference arm that passed for the wrong reason.** The harness's `locale` double had no `bind`,
   so `mountHarnessSidebar` returned early in every arm and the official sidebar had never been
   exercised; and its scoped ctx exposed injected services only through `get`, while cordis reads them
   as PROPERTIES. Both are modelled faithfully now.

**A syntax error in `client.js` is invisible to every static gate in this repo** — it cost all 60 arms
that evaluate the served bytes. The evidence therefore records `node --check` on the artifact plus the
presence of both splices.

## 5d. W5 — close-out (LANDED)

### The TUI-plane guard is KEPT, with its justification RE-SCOPED

The approved plan said this wave removes the "now-unneeded" guard. **It is not unneeded, and removing
it would be a regression**, so the decision is recorded rather than executed on autopilot:

- **What the split fixed:** the mpd team no longer needs that official row. It is its own record
  (`mpd-team-core-plugin`, `.mpd/team/teams/<id>.json`, served as `mpdTeams`) plus its own executor
  (`mpd-dsh-adapter`'s `TeamExecutor`, **native** by default over `ctx.subagents.startContinuable`),
  and the native path reads nothing from the official plugin.
- **What it cannot fix:** why the row cannot mount. `TeamService`'s ROOT-bound
  `ctx.root.sessionProjections.register` is refused by the dsh-tui host — a property of the HOST's
  capability wrapper, measured at harness 0.2.0-rc.1 + dsh-tui 0.11.2 and **identical** in the
  0.1.7-rc.2 copy this bundle pins. Enabling those rows in a TUI composition does not give it a team
  service; it gives it the same activation error on every boot.

So the guard now says *"a row that cannot mount in this composition would print an activation error on
every boot, and disabling it costs the TUI plane nothing"* — true, and **measurable**, because the team
works either way. The runtime warning tells the operator the team is unaffected and why.

### The stale claim it was hiding, corrected in both languages

`docs/tui.md` §10 item 11 said **"No teammate can be spawned in a TUI session"** — false since W2.
It now separates what still cannot happen (the official service activating) from what now can (a
teammate being spawned), and carries the boot line that proves it. §3.2 gains the same distinction in
EN and zh-CN and names the W3 scene. `AGENTS.md` §1 names `mpdTeams`, the route, the `TeamExecutor`
seam with native-as-default, and both rebuilt surfaces.

### The sweep

| gate | result |
|---|---|
| `bun test packages` | **1337 pass, 3 skip, 0 fail** (122 files, 13122 assertions) |
| `verify-dist-fresh` | 23/23 fresh |
| `verify:comments` · `verify:rows` · `verify:manifest` · `verify:docs` · `verify-manual-paths` · D6 | all PASS |
| `bun run test:qa` · `install-profile --dry-run` · `preset-conformance` | all PASS |
| `typecheck` | the same 4 pre-existing `skills/` errors |
| `verify-vendor` | exit 1 — **environment prerequisite** (`MPD_UPSTREAM_ROOT` absent here), not a regression; no `skills/**` file changed this wave, so no re-pin is due |

**Not claimed, and stated so no reader assumes more:** no TUI real-machine lane (`tui-mount` and
`tui-team-surface` both SKIP for an absent dsh-tui profile fixture — the TUI surface is carried by its
47 arms, not by a live PTY); no live teammate was ever spawned (this environment holds no credentials,
and §7 forbids writing any); no browser profile was booted.

## 5e. OPEN after W5 — found by the real-host TUI lane (2026-09-30)

The real-machine lane was repaired and run for the first time since the split
(`evidence/tui/lane-repair/20260930T013130Z/`). `tui-mount` **PASSES** on a real PTY — triple layer in
order, `crashes=[]`, `preset=mpd`, `isolationOffenders=0`. `tui-team-surface` runs and fails 10
assertions, and the failures resolve to THREE findings rather than ten defects. They are recorded here
because each is a consequence of the split that was not carried through.

### (a) The fixture writes the PRE-SPLIT record layout — one root cause

`skills/dsh-qa/scripts/tui-team-surface.ts` `writeTeamFixture()` writes
`<workspace>/.mpd/team/<id>/team.json`. W1 moved the record to
`<workspace>/.mpd/team/teams/<teamId>.json` plus the index `.mpd/team/teams.json`, so the scene reads
NO team and renders `MPD plan approval — (none)`. A4–A8, B2, B3, H1, H3 and H4 all fail as a
**cascade from that**, not independently.

No unit arm could have caught it: the arms build their fixtures through the STORE, so they write the new
layout by construction. Only a case that hand-writes a record and drives a real host can see the two
disagree.

### (b) The plan scene cannot approve — and the reason is deeper than a stale tool name

**DECISION TAKEN (user, 2026-09-30): the phrase gate moves to the plan id, keeping the deliberate typed
confirmation.** What follows is what that costs, measured while starting it.

Two layers, and only the first is a copy problem:

1. `packages/mpd-tui-plugin/src/scenes.ts` exports `PLAN_MUTATION_UNAVAILABLE`, whose comment says the
   approval tool is "GONE with the plugin that registered them". True of the RETIRED vendored plugin and
   FALSE of this bundle: `mpd-team-core` registers **`agent_teams_plan`** with an **`approve`** action,
   which raises the team through the NATIVE executor. `createPlanActions` returns a permanently
   unavailable executor on that stale premise.
2. **THE ACTUAL BLOCKER — the TUI cannot FIND the thing it would approve.** A staged plan is
   SESSION-scoped: `.mpd/team/staging/<sessionId>.json` (`plan-store.ts`). The TUI surfaces are
   WORKSPACE-scoped — `grep sessionId packages/mpd-tui-plugin/src/scenes.ts` returns NOTHING — so the
   plan scene has no key to read a staged plan with, and no `planId` to demand in its phrase gate.

   The team RECORD is not a substitute: it is materialised **at** approval, so before one there is no
   record, which is exactly why the panel renders `MPD approval — (none)`.

So the phrase-gate change is the SMALL half. The large half is giving the `mpd-tui` row a SESSION
resolver, and that carries its own design question: one host serves many sessions with different
workspaces, and the row currently resolves only the workspace (`dsh.workspaceRoot`). Picking "the
calling session" needs the same per-call discipline §6 already demands for the workspace root — and it
must not become a cached module-level value.

**Not started. Starting it and stopping would leave an approval path that nothing can reach, which is
worse than the honest refusal it has today.** The route family (§5f) already serves the staged plan to
the Web side, so the same `planId` decision is answerable there first if that is the cheaper order.

### (c) `mpd-team-core`'s own copy named tools nothing registers — FIXED

Its `/agent-teams` usage lines told the user to approve "with `agent_teams_approve`" and to add members
"with `agent_teams_add_member`" / tasks "with `agent_teams_create_task`". None of those three is
registered — the real surface is the `action` enum on `agent_teams_plan`. Both strings now name the
registered calls (`agent_teams_plan {action: "approve" | "add_member" | "create_task"}`), so a user
following the sentence looks up a tool that exists.

**Neither open item is a reason to doubt the split itself** — the record, the executor and both rebuilt
surfaces are proven by their own arms and by `tui-mount`. They are the last mile of the surface
migration, and (b) is the one that matters: a captain reading the TUI is told approval is impossible
when it is one call away.

## 5f. W1.3 CLOSED — the route family, and the distinction that matters

Four routes, registered together as one family so a panel cannot find one and miss another
(`TEAM_ROUTES` is the single declaration both the server and, later, the client read):

| route | serves | identity |
|---|---|---|
| `/plugins/mpd-team/state` | the mpd **RECORD** — the team as it exists after approval | `teamId` |
| `/plugins/mpd-team/plan` | the **STAGED PLAN** — what exists before one | `planId` |
| `/plugins/mpd-team/task` | the frozen acceptance contracts and the workspace hold | `taskId` |
| `/plugins/mpd-team/mail` | the mailbox fold | message id |

### Why `/plan` is not part of `/state`

This is the fact the TUI plan surface got wrong, and it is worth stating plainly: **the team record is
materialised AT approval.** Before one there is no record, so a surface that reads only records shows
nothing — which is exactly why the TUI panel rendered `MPD plan approval — (none)` and concluded that
approval was impossible when `agent_teams_plan {action:"approve"}` was one call away.

The staged plan lives in `.mpd/team/staging/<sessionId>.json` and carries its OWN identity, `planId`
(`plan-<instant>`), which is what an approval gate must demand.

### Three projections that were WRONG on the first pass, and how

Each was caught by asserting the payload against the STORE's own types rather than against the shape I
had imagined — the lesson being that a projection is a claim about someone else's data structure:

1. `StagedMember`/`StagedTask` carry **no** `provider`, `model` or `kind` — routing and task kind are
   resolved AT approval by the roster slot. Projecting them would have invented columns.
2. `TaskContract` carries `subject`/`description`/`claimedBy`/`claimedAt`/`attempt`/`blockedBy` — there
   is no separate `owner` or `acceptance` key.
3. `MailMessage` carries `fromName`/`toName`/`subject`/`body`/`sentAt` (+ optional `deliveredAt`/
   `readAt`) — there is no `from`/`to`/`content`/`ts`. The invented names yielded a payload of empty
   strings and `read: false` for every message, i.e. a mailbox of blank unread rows.

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
