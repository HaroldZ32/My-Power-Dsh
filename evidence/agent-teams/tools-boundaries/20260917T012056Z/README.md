# t9 — lane B1 evidence (adopted agent-teams plugin, wave `friction-p1-wave`)

Timestamp dir: `20260917T012056Z`. Task `t9`, attempt `2dcbbdaf-1273-4f56-82a8-a481fe6af050`.

## What changed (inScope only)

| File | Change |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/tools.js` | **D2**: the two TOOL-boundary hold guards are DELETED (`mpd-delta claim-task-hold-guard`, `mpd-delta update-task-hold-guard`) and so is this file's copy of the `mpd-delta watchdog-hold-reader` region (dead once its two call sites went). **T-19**: a new registered region `mpd-delta status-pause-mechanisms` makes `agent_teams_status` NAME both pause mechanisms and DEFER the watchdog hold to `session-watchdog-status` (no new resume verb). |
| `packages/mpd-agent-teams-plugin/lib/tool-names.js` | **T-49**: `agent_teams_task_contract` joined `MEMBER_TOOL_NAMES` (marker-less adaptation, same documented class as A1–A4). Both deny computations derive from the pair of lists, so one edit heals both. |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | **generated**: `--write-registry` re-run after the edits — 53 → 51 regions. Never hand-edited. |
| `packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` | NEW: 5 tests covering the deletion, the live-hold behaviour, a re-injection NEGATIVE CONTROL, both deny computations, and the status render. |
| `lib/scheduler.js` | NOT touched — it keeps its own `watchdog-hold-reader` copy and its three dispatch-side call sites (that is the half that still holds). |

## Gates (all green, logs in this directory)

- `bun test packages/mpd-agent-teams-plugin` → **225 pass / 0 fail** (`test.log`)
- `node scripts/patch-agent-teams-fixes.mjs --check` → **51 regions, clean** (`check.log`)
- `bun run typecheck` → **exit 0** (`typecheck.log`)
- `bun test packages/mpd-team-watchdog-plugin` → **107 pass / 0 fail** (`watchdog-dispatch-half.log`) — the
  DISPATCH half still holds: the fixture drives the REAL `lib/scheduler.js` with a live hold and keeps
  `deliveriesWhileHeld: 0` + a byte-unchanged team record across held kicks.

## Mounted boot (T-49's decisive leg)

`driver.mjs` (model stub + a real `dsh --profile mpd-headless` boot in a sandbox DSH_HOME/HOME/workspace
INSIDE this directory) drives create → add_member (Architect + the seven-name read-only deny) →
create_task → approve, and the member's own turn calls `agent_teams_task_contract`.

Measured (`result.json`): **the read-only member's 83-tool list INCLUDES
`agent_teams_task_contract`** and excludes `agent_teams_approve` and the write tools (`bash`,
`write`); the member's harness session log records `tool/call agent_teams_task_contract` with a
non-error `tool/result` carrying the real contract text; the tool result was returned to the member's
model. Session stores are kept under `raw/sessions/`; the rest of the sandbox was trimmed after
capture (2.8 MB → 232 KB) — `result.json` still names the live sandbox paths it used.

Bounds: ONE boot window, ONE stub-driven read-only member, ONE task; the read is proven from the
harness's own log and request payloads, but the model was a local stub, so this measures whether the
seat CAN read the contract, never a real model's choice to.

## Handoffs I could NOT perform (outside `inScope`)

1. `delta-table-handoff.md` — the exact replacement rows for `agent-references/agent-teams-deltas.md`
   (D23–D26 → the narrowed surviving rows + D25–D26 "REMOVED" + D27 for the new region + the
   marker-less `tool-names.js` row) and the 53 → 51 count/duplicate-id paragraph update.
2. `test/r3-view-parity.test.mjs:98` — the stale captain-only pin was updated by the CAPTAIN (not by
   me) in response to my blocker message: `CAPTAIN_TOOL_NAMES` → `MEMBER_TOOL_NAMES`. Recorded in
   `resolution-diff.patch`; the suite went 224/1 → 225/0 without any further change of mine.

## Reproduction

```
cd <repo>
bun test packages/mpd-agent-teams-plugin
node scripts/patch-agent-teams-fixes.mjs --check
bun run typecheck
node evidence/agent-teams/tools-boundaries/20260917T012056Z/driver.mjs   # rewrites result.json/output.log
```

Settled hashes of every file the verdict rests on: `settled-hashes.txt`.
