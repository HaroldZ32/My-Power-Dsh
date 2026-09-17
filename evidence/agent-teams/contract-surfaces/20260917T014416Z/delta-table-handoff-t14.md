# Handoff — delta-table rows for t14 (lane B2)

Owner of the target files: the docs lane (`t39` and its siblings). **I did not edit any doc**: the
delta table lives in `agent-references/agent-teams-deltas.md` (AGENTS.md §6 points there), which is
outside `t14`'s `inScope`. This file carries the exact rows to apply. Measured with
`node scripts/patch-agent-teams-fixes.mjs --check` on 2026-09-17: **59 regions across 9 adopted
files** (was 51).

## 1. New rows

```markdown
| D28 | `lib/tools.js` `agent_teams_update_task` ownership guard | `mpd-delta update-task-amend-owned-task` (**REPLACEMENT-shaped**) | wave 1 (t14), T-02: the guard refused EVERY captain write on a member-owned task, so a wrong acceptance/inScope could only be repaired by a takeover (`reassign_task`) that revokes the live attempt. An `amend` is now exempted (definition-only) and every other write still refuses. REPLACEMENT-shaped: the upstream `if (...)` was rewritten, so a re-materialize REFUSES loudly, file byte-untouched; remedy = restore the region or re-author + `--write-registry`. |
| D29 | `lib/tools.js` `agent_teams_update_task` member amend branch | `mpd-delta member-amend-at-claim-time` (**REPLACEMENT-shaped**, REPLACES the deleted `mpd-delta update-task-amend-captain-only`) | wave 1 (t14), T-02: a member may amend the contract of a task it owns ONLY while that task is `claimed` (contract read, no work recorded yet — exactly when a contradictory contract is discovered). Anywhere else the refusal stays loud (wave-4 DEFECT 2 preserved: never a silent no-op). |
| D30 | `lib/tools.js` `claim_task` success path | `mpd-delta claim-contract-version-stamp` (ADDITIVE → self-heals) | wave 1 (t14), T-02: stamps `attemptContractVersion` on claim so a reviewer can see that an attempt was claimed under an OLDER contract revision than the task now carries. |
| D31 | `lib/tools.js` `taskContractView` + `renderTaskContract` | `mpd-delta task-contract-render` (CHANGED body) | wave 1 (t14), T-02: the view/render expose `contract_version` / `attempt_contract_version` / `contract_amended_by|at`; the render prints "Contract revision: N" and, when the attempt is stale, "AMENDED since this attempt was claimed (claimed under revision M)". |
| D32–D34 | `lib/tools.js` `agent_teams_edit_plan` `add_task` | `mpd-delta edit-plan-quality-contract` (schema, ADDITIVE), `mpd-delta edit-plan-add-task-mutation` (ADDITIVE), `mpd-delta edit-plan-add-task-apply` (ADDITIVE) | wave 1 (t14), T-03: add_task accepts kind/objective/acceptance/inScope/outOfScope/verify, carries them into the staged mutation, and the apply branch runs the SAME `validateCreateTask` gate as `create_task` (same error text). Before this, the apply branch hard-coded `kind: 'work'`, so a staged quality task was silently downgraded to legacy work. |
| D35–D37 | `lib/tools.js` `agent_teams_update_task` terminal path | `mpd-delta terminal-output-append` (parameter, ADDITIVE), `mpd-delta terminal-output-append-guard` (ADDITIVE), `mpd-delta terminal-output-append-apply` (ADDITIVE) | wave 1 (t14), T-52: `output_append` repairs a TERMINAL task's summary APPEND-ONLY (the stored bytes are a prefix of the new value; event `agent-teams/task-output-appended`), refuses a blank append and refuses any append on a non-terminal task; every other terminal write still hits the immutability guard. Measured loss it repairs: a real summary lost on 2026-09-16. |
```

## 2. Changed rows

- `D15` (`mpd-delta update-task-required-attempt-id`) — body CHANGED by t14: an **amend-only** call
  may omit `attempt_id` (the amend branch returns before any write), and the stale check now fires
  only for a SUPPLIED, mismatched id. Still the same id and the same loud REQUIRED wording otherwise.
- `D16–D18` — the amend-region family changed: `mpd-delta update-task-amend-running` now admits a
  member at claim time, treats an IN-FLIGHT task as **attempt-preserving** (nothing invalidated —
  its output does not exist yet) and stamps the contract version; the terminal amend branch
  (`update-task-amend-terminal`) is unchanged in behaviour but the running branch's wording changed.
- **REMOVED**: `mpd-delta update-task-amend-captain-only` no longer exists (replaced by D29). The
  t9 handoff and the current table still list it — reconcile both in this pass.

## 3. Count / duplicate-id paragraph

`The live registry is **51** regions` → `**59** regions` (measured 2026-09-17, `--check` clean). No
duplicate-id pair was added: `mpd-delta watchdog-hold-reader` remains the only historical pair and is
now single-file (`lib/scheduler.js`).
