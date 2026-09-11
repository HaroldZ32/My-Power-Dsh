# Wave-2 t4 — adopted agent-teams tooling: evidence

Three captain-facing defects in the ADOPTED plugin (`packages/mpd-agent-teams-plugin/lib`),
fixed with in-source `mpd LOCAL ADAPTATION` deltas that survive a re-vendor.

> **A `dsh` restart is required before the new semantics take effect in a live session.**
> This harness has no hot reload of plugin modules: the agent-teams plugin was loaded at
> process boot, so the live session keeps running the PRE-FIX matcher (a glob declared in a
> live contract still classifies as `undeclared` until the restart). All `**` behaviour in
> this evidence is therefore proven by importing the module directly, never by driving the
> live completion gate.

## Defects and wave-1 citations

| # | Defect | Wave-1 evidence | Fix |
|---|---|---|---|
| 1 | inScope `**` not expanded | t3, t4, t7 and t13 each completed with an INCOMPLETE `changedPaths` (a declaration like `packages/mpd-verif-plugin/test/**` was not honoured, every file beneath it reported `undeclared`; four captain-authorized "complete with covered paths only" workarounds) | glob semantics in `pathMatchesScope` with the B5 wildcard-free behaviour kept bit-identical |
| 2 | self-contradicting generated contracts | t13's auto-generated repair contract listed `AGENTS.md` in BOTH inScope and outOfScope, so the gate rejected the edit its own acceptance REQUIRED as `out_of_scope` | `contractContradiction` guard at create time + `repairScopeFromFindings` so the generated scope can never duplicate a path |
| 3 | a running task's contract is unreadable | the captain could not see the contract it was asked to satisfy (no tool exposes it; `agent_teams_edit_plan` is staged-only, `agent_teams_update_task` is owner-only status/output) | read-only `agent_teams_task_contract` (any status, captain or member) |

## Gates (logs in `tests/`)

| Gate | Command | Result |
|---|---|---|
| Plugin suite | `bun test packages/mpd-agent-teams-plugin` | 83 pass / 0 fail (`tests/plugin-suite.log`) |
| Self-fix suite | `bun test packages/mpd-agent-teams-plugin/self-fix-tests` | 26 pass / 0 fail (`tests/self-fix-tests.log`) |
| Full suite | `bun test packages` | 345 pass / 0 fail, 39 files (`tests/full-suite.log`) |
| Typecheck | `bun run typecheck` | exit 0 (`tests/typecheck.log`) |
| Durability guard | `node scripts/patch-agent-teams-fixes.mjs --check` | 7 regions across 2 files (`fix/guard-check.log`) |
| Real vendor refresh | `node scripts/vendor-agent-teams.mjs` with `DSH_HOST_NM=<dsh node_modules>` | exit 0, prints `mpd deltas already-applied (7 regions …)`; its `_deps/` rewrite (out of t4 inScope) was reverted with `git checkout -- packages/mpd-agent-teams-plugin/_deps` |
| Guard failure mode | `fix/guard-failure-exercise.log` | verify-only on a dropped-delta tree REFUSES; anchor-gone REFUSES naming the drift; `--write` restores 7 regions and the next pass verifies byte-identical |
| Mount (isolated boot) | `mpd-headless` profile in a temp `DSH_HOME`+`HOME`, `mount/server-boot.log` | 0 apply-crash signatures (`unsupported JSON schema`, `JsonSchemaError`, `plugin tree failed to load`, `failed to apply loader entry`, `without inject`); boot then stops at `MISSING_CREDENTIAL` because the sandbox has no LLM key (its `.credentials.yaml` carries only an unrelated browser grant) — no live LLM call was possible without copying the real credential store, which QA discipline forbids |

**Load evidence, not composition:** `boot/dump-config.txt` is recorded only to show the row is
COMPOSED (`id: agent-teams` → `packages/mpd-agent-teams-plugin/lib/index.js`, `stateDir: .mpd/team`).
Per AGENTS.md §4 `--dump-config` never proves a plugin load; the load/registration evidence is the
boot log above plus `test/task-contract-tool.test.mjs`, which drives the REAL registration and the
REAL tool against a real team record on disk.

Known pre-existing, out-of-scope observation from the same mount runs: booting the **web** profile
from a legacy `install-profile.mjs` home aborts in `dsh-client-modules` with
`@mpd-dsh/mpd resolves from multiple active Loader sources` (the installer's absolute-path row
collides with the bundle's client row). That failure is in `scripts/install-profile.mjs` /
client-modules, is unrelated to these three defects, and is reported to the captain rather than
folded into t4.

## Adaptation list (marked `mpd-delta` regions; A* pre-existing, D* added by t4)

| Id | File · function/line | Marker | Purpose |
|---|---|---|---|
| A1 | `lib/members.js` `installContinuableSetup` | no | 0.1.5-rc.2+ Live-Setup guard / legacy `registerContinuableSetup` fallback (the only one AGENTS.md §6 names) |
| A2 | `lib/members.js` `installMemberSelectionRuntime` | no | takes the live Agent from the harness payload; never reads `childCtx.agent` |
| A3 | `lib/harness-compat.js:16` delivery probe | no | does not throw when no delivery contract exists; prefers the public `prompt` seam |
| A4 | `lib/members.js:28-78,499` workmate persona injection | no | injects `~/.mpd/workmate` persona/memory (HOME resolved per call, name sanitized) |
| A5 | `lib/session-start.js:170-200` notices | no | default team profile name `mpd` |
| A6 | `lib/client.js` export bridge region | region + own patcher | additive re-exports consumed by mpd client code (`scripts/patch-agent-teams-client.mjs`) |
| D1 | `lib/quality-gates.js` `pathMatchesScope` + glob helpers | `mpd-delta scope-glob` | `**` crosses separators, `*`/`?` single segment |
| D2 | `lib/quality-gates.js` `pathMatchesScopeNormalized` | `mpd-delta scope-glob-core` | keeps the wildcard-free exact/dir-prefix path bit-identical (B5) |
| D3 | `lib/quality-gates.js` `contractContradiction` / `repairScopeFromFindings` | `mpd-delta contract-contradiction` | rejects an unsatisfiable contract; generates a contradiction-free repair scope |
| D4 | `lib/quality-gates.js` `planQualityFollowUp` scope build | `mpd-delta repair-scope` | routes the generated repair scope through D3 |
| D5 | `lib/quality-gates.js` repair object scope fields | `mpd-delta repair-scope-fields` | consumes the narrowed scope |
| D6 | `lib/tools.js` `agent_teams_task_contract` tool | `mpd-delta task-contract` | read-only contract surface, any status, captain or member |
| D7 | `lib/tools.js` `taskContractView` / `renderTaskContract` | `mpd-delta task-contract-render` | contract view + render in the assignment prompt's spelling |
| D8 | `lib/mpd-deltas.js` (new, generated) | n/a | registry of every delta block + its insertion anchor |
| D9 | `scripts/patch-agent-teams-fixes.mjs` (new) | n/a | idempotent applier: `--check` refuses a dropped/rewritten delta; `--write` restores it; `--write-registry` regenerates D8 |
| D10 | `scripts/vendor-agent-teams.mjs` | n/a | calls D9 after the client bridge, so a vendor run cannot silently drop a delta |
| D11 | `self-fix-tests/scope-glob-and-contract.test.mjs` (new) | n/a | the three defects' positive + negative controls and the guard's refusal/restore/idempotence |
| D12 | `test/task-contract-tool.test.mjs` (new) | n/a | real registration + real tool read of a RUNNING task, proof of read-only and of the member path |

## Declared-but-unmatched paths (captain-authorized, outside the recorded inScope)

| Path | Justification |
|---|---|
| `scripts/patch-agent-teams-fixes.mjs` | the durability mechanism itself; the task text requires "add an equivalent" to the `patch-agent-teams-client.mjs` pattern, and only the client patcher is in the declared inScope |
| `packages/mpd-agent-teams-plugin/self-fix-tests/**` | the fork-maintenance test home established by the earlier tooling fixes (its README is the record t10/t11 transcribe); the declared inScope lists `test/` only |
