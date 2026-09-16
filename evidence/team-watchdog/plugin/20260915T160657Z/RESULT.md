# t54 — w3 watchdog core plugin: result

- **Task**: t54 (`implementation`, Deep Worker, attempt 2)
- **Deliverable**: `packages/mpd-team-watchdog-plugin/` (src + dist + test + bilingual README), the
  `mpd-team-watchdog` bundle row, and this evidence directory.
- **Evidence**: `evidence/team-watchdog/plugin/20260915T160657Z/`
  (`result.json` = the structured acceptance mapping, `output.log` = every raw log concatenated,
  `raw/` = the per-command logs and the fixture workspace left on disk).
- **Zero adopted edits**: `git status --porcelain packages/mpd-agent-teams-plugin` printed nothing.

## What was built

| Path | Role |
|---|---|
| `src/index.ts` | the cordis row: `name` / `Config` (type + schemastery schema, every key defaulted) / `apply`, no default export, `.js` relative imports, `ctx.effect` cleanup, adapter-only harness contact |
| `src/engine.ts` | the writers (step / POST tool / turn boundaries), the single tick, the WARN→ESCALATE fan-out |
| `src/machine.ts` | the five `mpd`-namespace knobs and the per-task+attempt streak arithmetic |
| `src/store.ts` | the heartbeat JSONL files, their rotation, atomic writes, torn-line tolerance |
| `src/team.ts` | READ-ONLY view over the adopted team record |
| `src/scene.ts` | the AC-5 scene document, its atomic/idempotent write, the unread mirror |
| `src/sidecars.ts` | the preserving hold, the incident log, the per-reader read watermark |
| `src/actions.ts` | `session-watchdog-hold` / `-resume` / `-status` |
| `src/paths.ts` | every path, resolved per call from the calling session's workspace |

## The five declared verify commands (raw tails)

```
$ bun run typecheck
$ tsgo --noEmit
exit=0
```

```
$ bun test packages/mpd-team-watchdog-plugin
 42 pass
 0 fail
 178 expect() calls
Ran 42 tests across 10 files. [206.00ms]
exit=0
```

```
$ node scripts/verify-rows-parity.mjs
[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (agent-teams, mcp-astgrep,
  mcp-codegraph, mcp-context7, mcp-gitbash, mcp-grepapp, mcp-lsp, mpd-bootstrap, mpd-boulder,
  mpd-codegraph, mpd-comment-checker, mpd-config, mpd-dsh-adapter, mpd-ext, mpd-hashline, mpd-memory,
  mpd-modelchain, mpd-roles, mpd-team-compact, mpd-team-watchdog, mpd-tools, mpd-tui, mpd-ulw,
  mpd-web-compat, mpd-workmate)
exit=0
```

```
$ bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
  boot: {"ok":true,"http":true, ...}
[bundle-lifecycle] PASS
exit=0
```

```
$ node skills/dsh-qa/scripts/preset-conformance.mjs
  conformance: {"ok":true,"checked":31,"schemaFree":6,"parity":{"reference":31,"ours":31,"missing":[],"extra":[]},"problems":[]}
  bootLog: {"ok":true,"signatures":[]}
  negativeControl: {"ok":true, ...}
[preset-conformance] PASS
exit=0
```

Extra gates run on top: `bun test packages` → **676 pass / 0 fail** (the whole suite, so this package
cannot have broken a sibling), and `node scripts/verify-docs-parity.mjs` → **pairs=34 failed=0**
(the new bilingual README pair).

## The mount that really applied the row (AC-1)

`bundle-lifecycle` installs the bundle from this checkout into an isolated `DSH_HOME` + sandbox
`HOME` with `dsh plugin --profile w add <repo>`, then BOOTS it. Its boot log line 4:

```
[mpd-team-watchdog] applied: enabled=true warnSilenceMs=90000 tickIntervalMs=15000 warnStreakToEscalate=3 actionOnEscalate=pause stateDir=.mpd/team disposers=5
```

and the crash-signature scan over the whole boot log
(`unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry|did not activate|pending (waiting`)
found **nothing** (`raw/mount-crash-scan.log`). `--dump-config` is cited nowhere in this evidence:
composition is not a load.

## The fresh-process read-back (AC-1/AC-2/AC-5)

`driver.mjs` runs the **real** plugin code (the real `apply()`, the real installed event handlers,
the real tick at an injected `now`) against a fixture workspace under `raw/ws`, then spawns
`reader.mjs` — a **separate `node` process that imports no plugin code at all** — which reads the
files from disk and exits 0 with `failures: []`:

```
heartbeat/architect.jsonl : >= 3 distinct `step` timestamps + one `kind:'tool'` stamp naming the tool
heartbeat/captain.jsonl   : both kinds (the captain is an ordinary agent here)
scene/team-a/latest.json  : the full AC-5 field set, hold non-null on the escalation scene
hold/team-a.json          : {id, teamId, since, cause, taskId:'t1', attemptId:'att-1', sceneAt}
incidents.jsonl           : warn, warn, escalate — each WARN with its scene path
read-watermark.json       : {web: <ts>}
```

The fixture uses an explicit `stateDir: state/team` rather than the shipped `.mpd/team`: `.mpd/` is
gitignored at any depth, and these artifacts have to stay committed for a reader to inspect. The
shipped default IS exercised — the mounted boot's apply line carries `stateDir=.mpd/team`, and the
unit suite uses the default too.

Tick shape and counters from the same run:

```
tickShape = {tick1:['warn'], tick2:['warn'], tick3:['escalate'], tick4:[]}
engineStats = {ticks:4, tickErrors:0, tickSkips:0, heartbeatWrites:8, heartbeatFailures:0,
               scenes:3, sceneFailures:0, holdsApplied:1, holdsFailed:0, incidents:3,
               incidentFailures:0, neverStarted:1}
adoptedRecordUnchanged = {sha256Before == sha256After, identical:true}
```

The Senior Engineer's `claimed` task stamped **nothing**, and it is reported once as
`never-started` — a dispatch observation that never escalates.

## The knobs (AC-11 semantics)

A second real `apply()` with a namespace that disagrees with the row config proves the namespace is
the authority (the row config is only the defaults layer), and a `settings/document-updated` re-read
moves all four without a restart:

```
readAtApply        : warnSilenceMs=1234 tickIntervalMs=111 warnStreakToEscalate=7 actionOnEscalate=warn-only  (intervalMs 111)
readAfterLiveEdit  : warnSilenceMs=4321 tickIntervalMs=222 warnStreakToEscalate=2 actionOnEscalate=pause
```

The real boot also carries `[mpd-config] settings bridge: registered the "mpd" namespace with the
file-derived base (applies:'restart', design §10.1)`, i.e. the namespace this row reads exists in the
mounted composition. **Limit**: the re-read was driven through the adapter's own
`onSettingsDocumentUpdated` seam, not by an authenticated settings write against a mounted host —
that belongs to AC-11's config lane (a later task).

## Row parity — a conflict this task REPORTED instead of silently reaching outside its scope

Adding a patch `- insert:` row breaks `node scripts/verify-rows-parity.mjs` unless
`scripts/install-profile.mjs` gains the mirror. That file is NOT in t54's inScope, so this task did
not touch it; it reported the measured failure to the captain (`MISSING from
scripts/install-profile.mjs: mpd-team-watchdog`) and another writer landed the mirror while this
task kept working. `git diff scripts/install-profile.mjs` shows that added block is the only change
and it matches this row's config. `result.json → filesOutsideThisTask` records the same.

## Fail-safe (AC-15, `bun test`)

* a throwing tick body is caught and counted (`tick threw 1 time(s)`), and the next tick still runs;
* exactly ONE interval owns the cadence (a patched `setInterval` census: 1 created, and a live
  cadence change clears it and creates one more — never two live);
* a tick that starts while the previous one still runs is SKIPPED, never queued;
* a tick with no state change writes nothing (the watchdog tree's file count is unchanged over 5
  ticks);
* an unwritable heartbeat location and an unwritable scene location both degrade to a counted
  failure plus a named warning, and the hold is still attempted and the incident still recorded;
* the kill switch works from the row config and from `MPD_DSH_TEAM_WATCHDOG=off`.
