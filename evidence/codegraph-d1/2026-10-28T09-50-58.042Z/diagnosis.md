# T1 — D-1 confirmed mechanism: why `/mpd-codegraph` never reaches the command registry

Wave: `fix/codegraph-reachability` (contract `.mpd/plans/fix-codegraph.md`, D-1, AC-2).
Owner: senior-engineer-codegraph. Task write scope: `evidence/codegraph-d1/`.
Stamp: `2026-10-28T09-50-58.042Z`. Evidence: this directory (`result.json`, `output.log`,
`probe-early.ndjson`, `probe-late.ndjson`, `boot-out.log`, `overlay.yml`) + the probe sources in
`../probe/` and the driver `../probe/run-probe.ts`.

**This task fixed nothing.** The product fix is T2's; this document is the diagnosis and the design.

---

## 1. The confirmed mechanism (one paragraph)

`mpd-codegraph` registers its one command exactly ONCE, at apply time, through the adapter seam
(`packages/mpd-codegraph-plugin/src/index.ts:252` `dsh.registerCommand({…})`, called from
`apply` at `:213`). The adapter resolves the `commands` service LIVE and **strictly** at the moment
of that call (`packages/mpd-dsh-adapter-plugin/src/index.ts:3465-3474` `const service = … ctx.get(name)`;
`:4580` `const commands = service("commands")`) and turns an absent service into a **silent noop**
(`:4583` `if (commands === undefined || commands === null || typeof commands.register !== "function") return noop`).
Cordis's strict read answers only a provider whose fiber is ACTIVE
(`<harness>/node_modules/@deepseek-ai/cordis/lib/index.js` `Context.get` / `Context._getImpl`:
`if (strict && impl.fiber.state !== 2) return`). The row declares `inject = []`
(`packages/mpd-codegraph-plugin/src/index.ts:17`), so the loader applies it in its FIRST concurrent
pass — at which instant the `commands` row provably had not even been given a fiber
(`rows.commands.state = null`, measured). Composition order does not save the row: in the packed
composition `commands` is loader entry 57 of 155 and `mpd-codegraph` entry 137, and the command row
still had no registered service when the codegraph row applied. So the one registration lands in the
adapter's noop, no retry and no deferred queue exist, and the command is absent from the registry for
the whole boot.

The defect is a **boot-order race with a permanent consequence**: the service appears a few
milliseconds later; the noop already swallowed the only attempt.

---

## 2. The measurement that decided it

### 2.1 The boot (checkout-bundle mode, isolated)

```
node evidence/codegraph-d1/probe/run-probe.ts
```

- `scripts/install-profile.ts --yes --dsh-home <sandbox>/dsh-home --profile mpd-headless --skip-toolchain`
  → `exit=0`, "[install-profile] wrote profile/ + home patch (37 rows incl. preset-mpd)".
  Its rows are ABSOLUTE PATHS INTO THE CHECKOUT (`packages/*/dist/index.js`), so this boot measures
  the checkout, not the installed copy. Recorded digests: checkout
  `packages/mpd-codegraph-plugin/dist/index.js` sha256 `8b1321…ce2dfce2` == installed copy sha256
  (the captain's datum, re-measured here rather than trusted).
- `DSH_HOME=/tmp/mpd-codegraph-d1-ORpH2R/dsh-home`, `HOME=/tmp/mpd-codegraph-d1-ORpH2R/run-home`,
  session cwd `/tmp/mpd-codegraph-d1-ORpH2R/ws`; the real `~/.dsh` is never read or written
  (`dshHomeStartsWithRealHome=false`).
- The model step is the shared offline stub (`makeStubModel`); no credential is read or copied.
  `dsh --profile mpd-headless --patch <overlay> "Reply with the single word ok."` → `exit=0`,
  `stubRequests=2`, 138 loader entries.
- The two probe rows are attached through the boot's own USER patch layer (`overlay.yml`,
  `--patch`), never by editing a product row.

### 2.2 The A/B: one variable — the declared dependency

| arm | row | `inject` | `ctx.get("commands")` AT APPLY | registration AT APPLY | in the settled agent listing |
|---|---|---|---|---|---|
| early | `qa-cg-probe-early` | `[]` (mpd-codegraph's shape) | `strict=false, loose=false` | `ok=false` — "strict read answered undefined (no ACTIVE provider) — the adapter returns noop", disposer `noop` | **`qa-cg-early` ABSENT** |
| late | `qa-cg-probe-late` | `["commands"]` | `strict=true, loose=true` | `ok=true`, disposer `effect` | **`qa-cg-inject` PRESENT** |

Both rows call the registry through the SAME strict lookup the adapter uses. The only difference is
`inject`.

### 2.3 The apply moment, timed against the real row

- `mpd-codegraph` writes its own sink line at `2026-10-28T09:51:00.120Z`; it calls `registerCommand`
  immediately after that line (`index.ts:240` then `:252`), with no `await` in between.
- The `inject: []` probe applied at `09:51:00.135Z` — 15 ms LATER — and still read
  `commands: {strict:false, loose:false}`. So at the codegraph row's `registerCommand` the service
  was **not even registered** (`loose=false`: not "registered but inactive").
- `commands` became ACTIVE by `09:51:00.266Z`: that is the instant `inject: ["commands"]` probe row
  was applied by cordis (its apply snapshot shows `commandsState=2`, `mpdDsh strict=true`).
  **Race window ≈ 146 ms, lost.**
- Row states at the inject-free probe's apply: `commands: state=null` (no fiber), `tools: state=null`,
  `mpd-codegraph: state=1` (mid-apply, `runtime=true`), `mpd-dsh-adapter: state=1`,
  `mpd-ulw: state=0 (pending)`, `mpd-team-core: state=0`, `mpd-cellwork: state=0`.

### 2.4 The falsifiers

- **H-A (not yet available at apply) — CONFIRMED.** `loose=false` at apply, `strict=true` 146 ms
  later, the same call from the same ctx succeeding then (`qa-cg-late`, registered at
  `+544 ms`, `sinceApplyMs 544`, is PRESENT in the settled listing).
- **H-B (a different adapter instance / registry nobody reads) — FALSIFIED.** The registration that
  lands at `+544 ms` is made by the SAME inject-free probe row, through its OWN ctx
  (the same lookup, the same adapter seam), and it appears in the SAME per-agent listing as the
  working commands. Had a second registry been involved, `qa-cg-late` would have landed in it and
  stayed invisible — it did not.
- **H-C (registration filtered out by ownership/visibility) — FALSIFIED.** The settled listing for
  the session's agent (`commands.list(agent)`) is:
  `agent-teams, cellwork, compact, feedback, goal, mpd, mpd-model, permission, plan, qa-cg-inject,
  qa-cg-late, ultrawork, ulw` (13 names). A host-plane throwaway name registered after the service
  existed (`qa-cg-late`, `qa-cg-inject`) IS listed beside the six shipped command rows; only the
  name registered during the window (`qa-cg-early`) is missing, and `mpd-codegraph` is missing for
  exactly the same reason. **The defect is reproduced in the checkout composition** (the packed
  composition recorded the same absence on 2026-10-27).

### 2.5 The mechanical comparison with the commands that DO work

All four adapter-registered contributed commands use the same adapter call (`dsh.registerCommand`);
the difference is the declared dependency, and it is visible in the SAME boot:

| command | row (layer) | `inject` | apply deferred? | settled listing |
|---|---|---|---|---|
| `/ulw`, `/ultrawork` | `mpd-ulw` (`cordis.patch.yml`) | `dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS)` — `packages/mpd-ulw-plugin/src/index.ts:52` | yes — `state=0 (pending)` at the race instant | present |
| `/cellwork` | `mpd-cellwork` (`cordis.patch.yml`) | `dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)` — `packages/mpd-cellwork-plugin/src/index.ts:37` | yes — pending | present |
| `/agent-teams` | `mpd-team-core` (`cordis.patch.yml`) | `dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)` — `packages/mpd-team-core-plugin/src/index.ts:139` | yes — pending | present |
| `/mpd-codegraph` | `mpd-codegraph` (`cordis.patch.yml`) | `[]` — `packages/mpd-codegraph-plugin/src/index.ts:17` | **no — first pass** | **ABSENT** |

`/mpd` and `/mpd-model` are a DIFFERENT plane (TUI command-trees, `packages/mpd-tui-plugin/src/command-trees.ts`
`MODEL_COMMAND`), not adapter-registered host rows; they are listed here only because they appear in
the same settled listing. Only the three rows above are the comparable set.

The rows that declare ANY late-activating dependency are simply not applied in the first pass at all:
`mpd-ulw`, `mpd-team-core` and `mpd-cellwork` were `state = 0` (PENDING) at the instant the inject-free
row ran, and all three commands are present at settle. Their applies happened after `commands`
existed — that follows from their own registration having succeeded; their exact instants are not in
the recording (see §4).

### 2.6 Consistency with the recorded packed-profile artifacts

`evidence/gates/user-surface/2026-10-27T16-33-27Z/green/sinks/mpd-dsh-adapter.log`:
`16:35:14.108` is the `mpd-codegraph` init line in `sinks/mpd-codegraph.log`; `14.109–14.112` are four
`ADAPTER NOT YET ACTIVE … (T-50)` lines — the packed boot had the same first-pass picture (the row
applied while siblings had not activated), and `probe.json` at `tick-14` lists 33 commands with no
`mpd-codegraph`. That is CONSISTENCY, not the proof: the primary measurement above is the A/B boot.

---

## 3. Minimal fix design (for T2; nothing here is implemented)

### 3.1 Option A — RECOMMENDED: declare the one seam the registration needs (plugin-local)

Change `packages/mpd-codegraph-plugin/src/index.ts`:

- `:17` `export const inject: string[] = dshSeamInject(DSH_SEAM_COMMANDS)` — same idiom as
  `mpd-cellwork` (`:37`) and `mpd-team-core` (`:139`); the adapter already exports `dshSeamInject`
  (`packages/mpd-dsh-adapter-plugin/src/index.ts:119`) and `DSH_SEAM_COMMANDS` (`:69`).
- `:16` the comment above it must change with it (it currently states the row applies "against zero
  harness services"); after the change it states that the apply waits for the command registry so the
  one registration cannot race it.
- Nothing else in the plugin changes: `apply`, the init block, `logLine` and the registration body
  stay byte-identical. `resolveDshAdapter` stays as-is (measured: at the deferred apply, `mpdDsh` was
  ACTIVE, so the mounted adapter is used and the `ADAPTER NOT YET ACTIVE` fallback warning stops
  firing for this row too — a side effect, not a reason).

Cost and blast radius:

- **No patch row changes**; **no adapter change**; **no `presets/mpd.patch.yml` change**.
- Rebuild exactly ONE target with the pinned toolchain (the plugin's own):
  `.toolchain/node_modules/.bin/bun build packages/mpd-codegraph-plugin/src/index.ts --target node --format esm --outfile packages/mpd-codegraph-plugin/dist/index.js`
  then `node scripts/verify-dist-fresh.ts`. The plugin imports the adapter's SOURCE, so an edit to the
  PLUGIN changes only the plugin's own emitted file; the dist-fresh gate is the authority that no other
  target moved.
- README pair: no inject claim exists in `packages/mpd-codegraph-plugin/README.md` or
  `README.zh-CN.md`, so the bilingual pair needs no edit for this change; `docs/design.md:255` /
  `docs/design.zh-CN.md:227` describe the row's effect, not its dependencies (AC-6's reachability
  wording is a separate, QA-owned change).
- The plugin's unit test (`src/index.test.ts`) does not assert `inject`, so it should survive
  unchanged — T2 must run it, not assume it.

Regression risk, stated plainly:

1. `inject` is a HARD dependency in cordis: a composition that never provides `commands` would leave
   the row PENDING — no apply, so no codegraph init at all. In the shipped compositions `commands` is
   part of the harness base bundle, and the QA row arm would redden on a pending row instead of
   failing silently, which is the honest failure mode. (Today's failure mode is the opposite: the
   init runs and the command silently vanishes.)
2. The apply-time init is delayed by the race window (~146 ms measured). `resolveProjectRoot` is
   resolved at apply from `DSH_WORKSPACE_ROOT`/`process.cwd()`; the delay cannot change it.
3. The other six contributed commands are untouched (adapter unchanged), satisfying AC-7.

Verification T2 must run for this shape: `bun test packages/mpd-codegraph-plugin`,
`bun run typecheck`, `bun run verify:comments`, `node scripts/verify-dist-fresh.ts`,
`bun run verify:rows`, `bun run verify:manifest`, and the packed-profile `user-surface-mount` run per
the captain's recipe (its `userSurface.command.mpd-codegraph` assertion must PASS, not merely stop
being a finding).

### 3.2 Option B — REJECTED for this wave: defer inside the adapter

Make `registerCommand` (`packages/mpd-dsh-adapter-plugin/src/index.ts:4578`) queue the definition
until `commands` is ACTIVE (e.g. a `ctx.inject(["commands"], …)` binding, or a re-probe on the
service-availability event) and return a composite disposer.

Why rejected now: it edits the ONE seam file every plugin imports, so `bun build` inlines it into
EVERY dependent `dist/` (a past adapter edit left 12 of 24 targets STALE); it changes the contract of
`registerCommand` for all six contributed commands plus future rows (AC-7 risk); and it hides the
ordering mistake in the plugin instead of fixing it. It is the right shape only if the wave later
decides that "register at apply, never lose it" must hold for rows beyond this one.

### 3.3 What the fix does NOT depend on (so T2 does not re-litigate them)

- Not on the codegraph binary: the defect reproduces with `status=no-binary` too (the registration is
  after the init block and unconditional).
- Not on the init spawn: the probe applied 15 ms after the row's sink line; the codegraph `init` was
  already finished by then.
- Not on the packed-vs-checkout copy: both dist digests are identical and the packed boot shows the
  same absence (§2.6). The fix therefore cannot be a rebuild-only change — the row has to declare the
  dependency (or the adapter has to defer).

---

## 4. What I could NOT prove

1. **The packed-profile boot was NOT re-instrumented.** The A/B measurement is on the checkout
   composition (`mpd-headless` dev install). The packed composition's artifacts were re-read, not
   re-measured: its `commands=33` listing and the `ADAPTER NOT YET ACTIVE` lines are consistent with
   the mechanism but are not the decisive measurement. AC-1's own evidence must come from the packed
   lane after the fix (captain's recipe), and that run is outside this task.
2. **The `mpd` agent preset never mounted in my boot**: `boot-out.log` says
   `preset-mpd … pending (waiting for service: agentPresets)` — the headless dev composition provides
   no `agentPresets`, so the session ran the harness default preset. The subject (a HOST-plane row's
   registration in the `commands` service, read for the session's agent) is the same plane as the
   packed boot, and the listing contains the same contributed host-plane commands; but the boot is not
   byte-identical to the packed one, and this is the bound.
3. **`row-ctx` (per-row isolation test) came back EMPTY**: the read ran at the horizon while the boot
   was tearing down, so no loader entries were readable. The H-B falsifier therefore rests on
   `qa-cg-late` landing in the SAME listing from the SAME row ctx — which is the stronger evidence —
   not on that block.
4. **Exact activation instants of individual rows** are not measurable from this recording: the poll
   timers were delayed (the first poll landed at +544 ms), so §2.5's "their apply happened after
   `commands` existed" is INFERRED from their successful registration, not timed.
5. **Flakiness is not characterised.** This is a race; the window measured here is ≈146 ms, but I ran
   ONE boot. Whether a slower machine ever wins it (making the defect intermittent) is unmeasured. The
   design does not depend on the answer: the fix removes the race, it does not widen the window.
6. **The other compositions that mount `mpd-codegraph`** (web profile, packed install, a user profile
   with the `commands` row disabled) were not enumerated or booted; the design's stated risk (§3.1
   point 1) is reasoning from cordis's documented `inject` semantics plus this boot, not a survey.

---

## 5. Reproduction, verbatim

```
node evidence/codegraph-d1/probe/run-probe.ts
```

prints `evidence -> <repo>/evidence/codegraph-d1/<stamp>` and writes `result.json`, `output.log`,
`probe-early.ndjson`, `probe-late.ndjson`, `boot-out.log`, `overlay.yml`. Observed result of the run
this diagnosis rests on:

```
early(mpd-codegraph shape): apply commandsRead={"strict":false,"loose":false,"error":""} registerOk=false
late(inject commands)     : apply commandsRead={"strict":true,"loose":true,"error":""} registerOk=true
settled listing (13): agent-teams,cellwork,compact,feedback,goal,mpd,mpd-model,permission,plan,qa-cg-inject,qa-cg-late,ultrawork,ulw
working contributed present: ulw,ultrawork,cellwork,agent-teams
early landed=false lateLanded=true injectedLanded=true
[codegraph-d1] evidence -> /home/haroldzhao/MyProj/DshProj/My-Power-Dsh/evidence/codegraph-d1/2026-10-28T09-50-58.042Z
```
