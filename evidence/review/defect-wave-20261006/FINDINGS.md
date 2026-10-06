# Defect wave 2026-10-06 — the verified finding register

The single source of truth for this wave. Four read-only Architect passes reviewed the bundle's
`src/**` (never `dist/`); every entry below was **independently re-verified by the captain** against
the code before it was accepted, and each carries the symbol that must change. A finding that could
not be re-verified was dropped rather than carried.

Reviewers: 4 × Architect (read-only, one-shot). Verdicts are advice; the captain's re-verification is
the acceptance. Baseline: `dev` @ `82f7663e`.

Severity is IMPACT, not effort: `high` = a shipped safety mechanism silently does nothing;
`med` = a wrong result/state reachable on a normal path, or an untrusted input reaching the filesystem;
`low` = a contract the code does not keep, with bounded blast radius.

## Wave composition (user-set, 2026-10-06)

Three `fix/<slug>` branches cut from `dev`, one PR each, by domain:

| Branch | Scope | Findings |
|---|---|---|
| `fix/team-plane` | the team record, the watchdog, compaction | T1–T6 |
| `fix/edit-tools` | write guard, truncation, anchored edits, memory/boulder/comment state | E1–E8 |
| `fix/surfaces-config` | config, adapters, ext, TUI/web/workmate/codegraph surfaces, and the red gates | S1–S9, G1–G5 |

Rules that bind every branch: rebuild the touched package's `dist/` with the CANONICAL command from
the repo root (`bun build packages/<pkg>/src/index.ts --target node --format esm --outfile
packages/<pkg>/dist/index.js`) — a package-directory build is flagged STALE; every fix carries a
regression test that FAILS before it and passes after; `skills/**` has ONE writer per wave and its
`VENDOR_LOCK.json` re-pin lands in the SAME commit as the change that invalidated it.

---

## Branch 1 — `fix/team-plane`

### T1 — HIGH — the watchdog's preserving hold is invisible to the dispatcher

`packages/mpd-team-core-plugin/src/index.ts#readWatchdogHold` queries
`watchdog.isHeld(record.teamId, workspace)` with the MPD team id minted by
`packages/mpd-team-core-plugin/src/team-store.ts#newTeamId` — `"team-" + <14-digit stamp>`.

The watchdog persists its hold at `holdPath(workspace, stateDir, teamId)`
(`packages/mpd-team-watchdog-plugin/src/paths.ts#holdPath`) and its own team universe is keyed by
`packages/mpd-team-watchdog-plugin/src/team.ts#projectTeamView`'s `id: String(view.teamId ?? "")` —
and `DshTeamView.teamId` is documented in the adapter as "the implicit team identity (**the Lead
Session id** on the host)".

Two id spaces, one lookup: the hold is filed under the Lead session id and read under `team-<stamp>`,
so the lookup MISSES, `readWatchdogHold` answers `{ state: "free" }`, and the pass dispatches into a
team the watchdog deliberately parked. Trigger: any `pause` escalation
(`actionOnEscalate: "pause"`, `engine.ts#performHold(workspace, team.id, …)`), then the very next
`agent_teams_dispatch {action:"run"}`.

Why it matters: this is the exact failure the hold exists to prevent, and the code's own comment
claims the pair are covered ("BOTH stop a pass").

**The unit double hid it**: `packages/mpd-team-core-plugin/test/team-record.test.ts` passes
`isHeld: () => ({ … })` — an argument-blind stub that ignores `teamId`. Any regression test must
assert the ARGUMENTS the gate passes.

Fix direction: make the two planes agree on ONE id. T3/T4 migrate the watchdog to the mpd record, so
the ids coincide; the fix must state which plane owns the id and pin it with an argument-asserting test.

### T2 — MED — dispatch rewrites the whole team record from a stale snapshot

`packages/mpd-team-core-plugin/src/index.ts#agent_teams_dispatch`: the record is read ONCE before the
pair loop (`const opened: TeamRecord = record`), then after each `await executor().send(...)` the
loop does `record = updateTeamTask(record, …)` and `writeTeam(workspace, record)` — a blind whole-file
write with no compare-and-set. `team-store.ts#updateTeamTask` bumps `task.revision`, but
`#writeTeam` never checks it.

Trigger: a pass is in flight (awaiting a `send` to member A) while member B calls
`agent_teams_task {action:"claim"}` — the pass's next `writeTeam` restores its stale snapshot and
erases B's `status: "in_progress"`, `owner` and `attempt`. The board then shows an in-flight task as
pending and its attempt counter regresses, so a later claim reuses the same attempt number.

Fix direction: compare-and-set on the on-disk `revision` (re-read before each write), so a lost
update is either applied to the fresh record or refused loudly — never silently reverted.

### T3 — MED — the watchdog watches nothing on the default (native) executor

`packages/mpd-team-watchdog-plugin/src/team.ts#readTeams` reads `dsh.teamLiveTeams()`, which walks the
OFFICIAL `agentTeams` service (`packages/mpd-dsh-adapter-plugin/src/index.ts#teamLiveTeams`:
`teams.tryMembership(agent)`, keeping only `membership?.role === "lead"`). But the adapter's own
`teamExecutor()` selects **`native`** as the default backend ("native: the default backend — it needs
nothing from the official plugin") and `mpd-team-core` drives teams through that seam
(`executor().spawn` / `executor().send`). A native team is never registered with the official service,
so `tryMembership` never answers `lead`, `readTeams` returns `[]`, and the whole ladder
(WARN → ESCALATE → preserving hold) iterates over zero teams.

Consequence: the watchdog is INERT in the default composition. It is not "quiet" — it is unreachable.

Fix direction: read the MPD record first (`mpdTeams.list(workspace)`), keeping the official fold as a
fallback for compositions that do run the official executor. `teamRepository` is the read seam
(`mpd-team-core-plugin/src/index.ts` — the `MPD_TEAMS_SERVICE` provider).

### T4 — MED — compaction can never fire, same root as T3

`packages/mpd-team-compact-plugin/src/index.ts#readTeams` reads the same official-only readout and its
pass then `continue`s on `members.length === 0 && tasks.length === 0`. On the native executor no team
is ever seen, so `mpd_team_compact_run` reports "no finished team" forever.

Fix direction: same migration as T3, or — if the plugin is deliberately official-plane-only — say so
in its tool description and README instead of promising a capability it cannot reach. Choose ONE and
record which.

### T5 — MED (security) — path traversal through the staged-plan store

`packages/mpd-team-core-plugin/src/plan-store.ts#stagingPath` and `#contractPath` concatenate an
UNsanitised id (`join(dir, sessionId + ".json")`, `join(dir, taskId + ".json")`), while the two sibling
stores DO sanitise (`team-store.ts#sanitizeId`, `mpd-team-watchdog-plugin/src/paths.ts#safeSegment`).

`sessionId` reaches it straight from the web route's query string
(`mpd-team-core-plugin/src/team-web.ts#sessionOf` → `planForSession` → `readPlan` → `stagingPath`), so
`GET /plugins/mpd-team/plan?sessionId=../../../../<any path>.json`-shaped input escapes the `.mpd/team`
root on READ, and `writePlan` escapes it on WRITE. A target that parses as JSON with `version: 1` is
returned as a staged plan.

Fix direction: route BOTH paths through the store's existing sanitising reducer and REJECT an id that
still carries a path separator, rather than silently rewriting it.

### T6 — LOW — a non-finite watermark is persisted as `null`

`packages/mpd-team-watchdog-plugin/src/sidecars.ts#ackIncidents`: `Math.max(current[reader] ?? 0, upTo)`
with `upTo = NaN` yields `NaN`, and `JSON.stringify` writes it as `null`. The next read coalesces
`null` back to 0, so the reader silently replays from zero instead of the call being refused.

Fix direction: reject a non-finite `upTo` with `{ ok: false, error }` before writing.

### T7 — MED — SURFACED BY THIS BRANCH'S OWN SECOND-ORDER REVIEW (not in the original 23)

The dispatch LEDGER has T2's exact mechanism, 60 lines away and in the same file.
`packages/mpd-team-core-plugin/src/index.ts#agent_teams_dispatch` reads the ledger once before the
pair loop (`reconcile(readLedger(workspace), tasks)`), mutates it in memory across each
`await executor().send(...)`, and then writes the WHOLE map back. The same file's
`agent_teams_task { action: "release" }` path is itself a `readLedger` → mutate → `writeLedger`
read-modify-write, so a release that lands while a pass is suspended inside a send is silently
reverted by the pass's final blind write. `writeLedger` was additionally a non-atomic
`writeFileSync`, so a reader can observe a torn file and take the `catch` path (an EMPTY ledger).

Provenance: found by the T1–T6 writer's own review pass, reproduced, then ruled IN by the captain —
fixing T2 in one file while leaving an identical race in the same file would not survive review.

Fix direction (contract-preserving — the tool's OUTPUT SHAPE is unchanged): make the final write a
MERGE against a fresh read (re-`reconcile` the same `tasks`, re-apply ONLY this pass's own `sent`
assignments) and make `writeLedger` atomic (sibling temp + `renameSync`, mirroring
`team-store.ts#writeJson`). Named residual: cross-PROCESS last-writer-wins on `dispatch.json` is not
covered — only the in-process async window is.

---

## Branch 2 — `fix/edit-tools`

### E1 — MED — the write guard resolves a relative path against the wrong root

`packages/mpd-tools-plugin/src/index.ts#apply` (the `write` guard) calls `existsSync(fp)` /
`readFileSync(fp, "utf8")` on the model-supplied `file_path` with no resolution, so a relative path is
taken against the dsh process cwd rather than the calling session's workspace
(`dsh.workspaceRoot(exec)`: session header cwd → `DSH_WORKSPACE_ROOT` → cwd).

Trigger: dsh launched from a directory other than the session workspace. If `<cwd>/notes.md` is absent
while `<cwd>` ≠ `<ws>`, the guard returns `undefined` and the clobber of an existing `<ws>/notes.md`
that it exists to prevent goes through; if `<cwd>/notes.md` exists with different content, an honest
CREATE of `<ws>/notes.md` is denied.

Why it matters: the row's only clobber defence either no-ops or blocks an honest write, and BOTH
directions look like normal behaviour. The sibling row was already repaired for exactly this class —
`packages/mpd-hashline-plugin/test/tool-schema.test.ts` asserts "the guard resolves a RELATIVE
file_path against the session workspace, not process.cwd()" — and `mpd-tools` was not.

Fix direction: resolve through the adapter's `workspaceRoot(exec)`, mirroring the hashline guard, and
port that regression test.

### E2 — MED — the truncation budget can INFLATE the output

`packages/mpd-tools-plugin/src/index.ts#apply` (the truncation waterfall):
`tail = text.slice(-Math.floor(budget * 0.3))`. When `Math.floor(budget * 0.3) === 0`,
`-0 === 0`, so the slice is `slice(0)` — **the entire original text**. `budget = maxBytes -
banner.length`, so `truncateMaxBytes` within 1–3 of the banner length triggers it (a 74-char banner
makes `truncateMaxBytes: 75|76|77` return ≈100,076 chars for a 77-char budget).

The package's own test asserts exactly the invariant that breaks ("truncation output (incl. banner)
never exceeds truncateMaxBytes") but samples only 128/256/512/1024/4096, so the window is untested —
and the result gets LARGER than the input it was meant to cap.

Fix direction: clamp the tail length so a zero-length slice can never mean "everything", and extend
the test across the boundary.

### E3 — MED — the unified-diff hunk header is off by one at the head of a file

`packages/mpd-hashline-plugin/src/vendor/diff-utils.ts#generateUnifiedDiff` uses `0` as an "unset"
sentinel (`aStart === 0 && (aStart = op.a)`), but line index 0 is a legal value, so the start is
overwritten by the SECOND op's index whenever the hunk's first op is the file's line 0.

Traced on old `"a\nb\nc\n"` → new `"A\nb\nc\n"`: ops `[del(a=0), ins(a=1,b=0), eq(1), eq(2), eq(3)]`
set `aStart` to 0 then 1, printing `@@ -2,4 +2,4 @@` where the truth is `@@ -1,4 +1,4 @@`. Any
`mpd_hashline_edit` touching the first lines of a file ships a shifted header in the tool result.

Fix direction: use `-1` (or `undefined`) as the unset sentinel; pin with a test whose hunk starts at
line 0.

### E4 — LOW — the reported line count counts a line that does not exist

`packages/mpd-hashline-plugin/src/index.ts#mpd_hashline_read` and `#mpd_hashline_format` return
`lines: out === "" ? 0 : out.split("\n").length`, but `toHashlineContent` ends with `"\n"` for any
terminated file, so the trailing empty element inflates the count (a 2-line file reports 3, a 1-line
file reports 2). `#editFile`'s own `contentForCount` disagrees with it for the same file.

Fix direction: one shared count for read/format/edit so the three cannot drift.

### E5 — LOW — the CRLF/BOM envelope is exported but never used

`packages/mpd-hashline-plugin/src/vendor/file-text-canonicalization.ts` exports
`canonicalizeFileText` / `restoreFileText`, and `#hash-computation.ts` exports `formatHashLines`, but
`grep` shows the only matches are the vendor re-export sites — `#editFile` writes plain
`writeFileSync`. So a CRLF or BOM-carrying file loses that envelope on an anchored edit.

Fix direction: wire the canonicalize/restore pair through the edit write path (or, if the bypass is
deliberate, state why in the code and the README instead of leaving two exported functions unused).

### E6 — LOW — the reflection transition has no precondition

`packages/mpd-memory-plugin/src/index.ts#apply` (`mpd_memory_reflect_complete`) writes a reflection
entry, increments `reflected_completed_steps`, zeroes `steps_since_last_successful_reflection` and
sets `reservation: {status: "completed"}` with no `triggered` / reservation precondition — so a
completion can be recorded with nothing pending, stranding the state machine's counters.

Fix direction: refuse a completion when no reflection is due/reserved, with the message naming the
state it refused.

### E7 — LOW — the plan-progress tool ignores the resolved plan root

`packages/mpd-boulder-plugin/src/index.ts#mpd_boulder_plan_progress` passes the caller's path verbatim
to `getPlanProgress(planPath)` while `const dir = root(exec)` sits unused, and
`vendor/storage/plan-progress.ts` answers silent zeros for a path it cannot resolve. Every sibling
boulder tool resolves through `resolveBoulderPlanPathForWork` (see `vendor/storage/read-state.ts`
`getWorkResumeOptions`).

Fix direction: resolve through the same helper so a relative/unresolvable plan path is REPORTED rather
than answered with zeros.

### E8 — LOW — the comment-checker hook reads a relative path against cwd

`packages/mpd-comment-checker-plugin/src/index.ts#apply` (the `autoCheck` hook) does
`readFileSync(fp, "utf8")` on `exec.arguments.file_path ?? .path` inside a `try` that returns `out` on
failure — the same class as E1, in a different row.

Fix direction: resolve against the session workspace; keep the degrade, but make it a DECLARED miss.

---

## Branch 3 — `fix/surfaces-config`

### S1 — MED — the config bridge writes a file the config layer never reads

`packages/mpd-config-plugin/src/index.ts#writeBack` and `#migrate` call
`resolveTargets(dsh.workspaceRootsAll())` **without** the row's `projectFile`, so
`bridge.ts#targetFiles` falls back to `<root>/.mpd/mpd.jsonc`. Every other path in the same file goes
through `projectFileFor(root)` — `loadConfig` (read), `reconcile` (override clearing), `watchRoot`.
`resolveTargets`'s own `projectFile` parameter is therefore dead in production; only tests pass it.

Trigger: set the row config `projectFile: "<path>"` (it is in the plugin's exported `Config`, so it is
an editable knob). A front-door edit then writes — and on a fresh workspace CREATES — a file the
config layer never reads, while reporting `written`/`created` for a path the user did not configure;
`reconcile` then compares the override file, so the documented "a file edit wins, clear the stale
override" rule never fires for the file just written.

Fix direction: make `projectFileFor` the SINGLE target resolver used by read, write, reconcile and
watch; delete or wire the dead parameter so an unhonoured knob cannot look honoured again. Bridge test:
with a `projectFile` override, the write target MUST equal the read target.

### S2 — MED — the engine memo never evicts, though its contract says it does

`packages/mpd-dsh-adapter-plugin/src/index.ts#compactionEngineForAgent`: the hit path returns
`engineCache.get(id)` BEFORE consulting `liveAgent(id)`, and `grep engineCache` finds only the
declaration, the read and the set — no `delete`/`clear` anywhere. The contract above it states the
cache "is keyed by agent id AND dropped when the agent leaves the live registry, so a recycled id can
never inherit a previous incarnation's engine".

Trigger: query an agent id once, let that session end, query the same id again (e.g. a second
`mpd_team_compact_run` pass calling `dsh.compactionEngineForAgent(entry.member.id)` for a finished
team). The dead realm's engine is handed out — and the file's own measurement recorded that the
host-plane and member-scoped engines are different objects (`sameObject: false`). The map also grows
one entry per agent id for the process lifetime.

Fix direction: evict when `liveAgent(id)` no longer resolves (or key the memo on the live Agent object
via a `WeakMap`, which evicts for you). Test: end an agent, assert the next query answers `undefined`.

### S3 — MED — a second adapter instance is built silently

`packages/mpd-dsh-adapter-plugin/src/index.ts#resolveDshAdapter` ends in `?? createDshAdapter(ctx)` —
a SECOND adapter instance beside the mounted one — with NO diagnostic and without the non-strict probe
the lazy twin performs. `grep` counts 16 rows calling `resolveDshAdapter(ctx)` against 2 calling
`createLazyDshAdapter(ctx, …)`, and the lazy path is the loud one.

Why it matters: the fallback silently bypasses the mounted adapter (the one-contact-surface rule), does
not inherit the adapter row's config, and keeps its own per-instance caches — the very divergence the
rule exists to prevent.

Fix direction: probe non-strictly first, emit the SAME one-line warning the lazy path emits, and only
then fall back — or route the 16 rows through the lazy helper. Add the same argument-aware test
discipline the lazy path already has.

### S4 — LOW — `adapterIdentity` is frozen at apply, contradicting its contract

`packages/mpd-ext-plugin/src/index.ts`: `service.adapterIdentity = dshAdapterIdentity(ctx)` is an
apply-time value, while the note above it says the identity is read at surface time and never cached
at apply. On a composition where the adapter row mounts later, the reported identity is a stale
`fallback:*`.

Fix direction: expose it as a getter (or drop the field and let a reader call
`dshAdapterIdentity(ctx)`), and pin with a test that mounts the adapter after the row.

### S5 — LOW — the fs watcher's disposer is stored and never invoked

`packages/mpd-config-plugin/src/index.ts#watchRoot` stores the watcher's disposer without registering
it in the row's own scope, so an unload leaves the watcher (and its debounce timer) alive — a leak per
boot in a long-lived process. NOTE: re-verify against the current file before fixing; the finding was
reported from a read of the watch path and the fix is the same either way.

Fix direction: register through `ctx.effect` and have the disposer clear the debounce timer AND close
the watcher.

### S6 — LOW — `capText` exceeds its declared cap

`packages/mpd-workmate-plugin/src/index.ts#capText`: head+tail already sum to `max`, then the
`"…[truncated N chars]…"` marker (~30 B) is appended, so `capText("x".repeat(9000), 8192)` returns
more than 8192 bytes. The caps bound the context injected into a spawned workmate, so the real bound
is `cap + one marker per field` — the written contract is not what the code does.

Fix direction: subtract the marker length from the budget so head+tail+marker really fits.

### S7 — LOW — a REFUSED panel registration reads as "this host exposes no panel seam"

`packages/mpd-tui-plugin/src/panel.ts#registerPanelSurface`: the outcome is chosen by
`panel.id() === undefined` alone, so a host that BINDS `tuiPanels` but REFUSES the frozen descriptor
(the adapter records `state: "refused"`, `finalId` stays undefined) is folded into `"unavailable"`,
whose only sentence is `panel.unavailable` — "this host exposes no panel seam". The boot aggregate
does report the refusal; the `/mpd panel` command line does not.

Fix direction: feed the seam outcome into the sentence so a refusal says refused.

### S8 — LOW — a blank-but-SET env value suppresses its documented alias

`packages/mpd-codegraph-plugin/src/index.ts#resolveBinary` and `#resolveProjectRoot` use
`process.env.MPD_CODEGRAPH_BIN ?? process.env.MPD_DSH_CODEGRAPH_BIN` — `??` only falls through on
null/undefined, so `MPD_CODEGRAPH_BIN=""` (an exported-but-blank variable) blocks the alias and the
blank is then filtered out, i.e. the override is ignored with no miss reported. The launchers already
treat blank as unset (`(env.X ?? "").trim().length === 0`), so the plugin resolver is the inconsistent
one. Same shape for `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD`.

Fix direction: a first-non-blank env helper, matching the launchers.

### S9 — LOW — the sidebar diagnostics snapshot is never republished on the late-bind path

`packages/mpd-bundle-plugin/src/web-client.ts#mountHarnessSidebar` → `#publishSettle`: the
in-callback preference branch (`primary !== undefined → preferred = true; return`) returns before
`publishSettle`, so the module snapshot keeps its apply-time values. Trigger: a profile whose
betterSidebar service is a plugin-fiber service (invisible to the bare `ctx.get` probe at apply time —
the case the file's own comment says the callback exists to catch) → `sidebarDiagnostics()` reports
`{reported:false, host:"", registered:0, preferred:false}` although better-sidebar owns the panels.

Fix direction: call `publishSettle` on that branch too (a test can assert the exported diagnostics).

---

## The red gates (measured on `dev` @ `82f7663e`, 2026-10-06)

Run as one sweep; the observed exit codes are recorded in `gate-sweep.log` beside this file.

| Gate | Verdict | Detail |
|---|---|---|
| `bun run verify:gates` | FAIL (1/8) | ONLY because `verify-vendor` needs an upstream checkout |
| `bun run typecheck` | FAIL | 4 errors, all in the vendored `skills/programming` corpus |
| `bun run test:qa` | FAIL | 3 of 48 cases |
| `node scripts/verify-pack-closure.ts` | FAIL | 2 TREE-DRIFT (stale local pack) |
| everything else | PASS | dist-fresh, rows-parity, docs-parity, preset-conformance, plugin-manifest, comment-coverage, workflows, no-host-override, manual-paths, mpd-ext `--self-test` |

### G1 — `bundle-lifecycle` asserts a RETIRED expectation (dev-only regression)

`skills/dsh-qa/scripts/bundle-lifecycle.ts` line 117 requires a column-0
`- id: agent-preset-registry` in the bundle patch. `master` (v0.11.6) still carried that id-target;
`9e91beb3` ("feat(seams)!: one adapter per plane, zero host overrides, R5 terminal silence",
2026-10-03, DEV-ONLY) removed it as part of the strict zero-override decision, and the dev wave moved
the patch to the repo root without updating this assertion. So the QA case contradicts the shipped
patch — a stale assertion, not a code defect.

Fix direction: assert the SHIPPED contract — the id-target is ABSENT at column 0 (with the reason
named), the retired `@deepseek-ai/dsh-agent-presets` row has not come back, and the `preset-mpd` row
still declares `config.id: mpd`. Keep the case falsifiable: a negative control that re-adds the
id-target must redden it.

### G2 — `extension-lifecycle` "an unavailable seam must be reported LOUDLY on stdout"

`skills/dsh-qa/scripts/extension-lifecycle.ts` requires `/FATAL/` on the row's stdout when a seam is
unavailable, but the observed boot text does not carry it. Investigate BOTH directions before fixing:
the row may have regressed to `ctx.logger.warn`-only (a real defect to fix in `mpd-ext-plugin`), or the
assertion may be testing a spelling that moved. Record which one it was.

### G3 — `preset-register` devFlavor MCP operand mismatch

`skills/dsh-qa/scripts/preset-register.ts` compares the rewritten patch text against the
checkout-absolute `packages/mpd-mcp-gitbash/dist/cli.js` operand and does not find it. Same
discipline as G2: decide whether the rewrite or the expectation moved, then fix THAT side.

### G4 — `typecheck`: 4 errors in the vendored `skills/programming` corpus

All four are in `skills/programming/scripts/typescript/check-no-excuse-rules.ts`:
`TS2307 Cannot find module 'typescript/unstable/ast'` (×2), `'typescript/unstable/async'` (×1), and
`TS7006 Parameter 'm' implicitly has an 'any' type`. The skill targets a TypeScript build exposing
`typescript/unstable/*`; the installed one does not. `tsconfig.json` includes
`skills/*/scripts/**/*.ts`, so the root program is red.

Fix direction: make the skill's import resolve against the INSTALLED toolchain (a guarded dynamic
import with a declared fallback, or a vendored shim), or exclude the file from the root program with
the reason stated in `tsconfig.json` the way the retired adopted package already is. Prefer the
resolution fix; an exclusion is the fallback, and either way the choice must be justified in the
commit and the PR.

### G5 — re-pack the local artifact

`dist/mpd-package` is **gitignored** (`.gitignore:12`), so this is a LOCAL artifact, not a commit: the
pack stamp is `2026-10-04T04:11:29.290Z` and 2 TREE-DRIFT entries name files that landed after it
(`docs/plan-webui-tui-i18n.md` and five `agent-references/*.md`). Re-pack with `npm run pack` and cite
the new `verify-pack-closure` reading.

**The integration bound, stated so no reviewer over-reads a green pack**: the pack is DERIVED from the
source tree, so a re-pack inside ONE branch is current only for THAT branch's tree. After all three
branches merge, one more re-pack must land at integration — the pack cannot be green for three
divergent trees at once.
