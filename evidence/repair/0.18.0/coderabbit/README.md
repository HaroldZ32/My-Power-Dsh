# CodeRabbit round 1 — the TWO DOC findings on PR #103

Seat: Senior Engineer (documentation repair only; no code touched).
Branch: `feature/upstream-0.18.0`.
File changed: `agent-references/troubleshooting.md`, section `T-94` (the T-94 / session-gate entry).
Nothing was committed, added or checked out (the captain owns the single git writer, AGENTS.md §5).

Both findings were **VERIFIED against `packages/mpd-roles-plugin/src/session-gate.ts` before editing** and both
are **VALID** — neither is stale, and neither reviewer claim needed correction.

| # | Finding | Verdict |
|---|---|---|
| 1 | Describe auto-end as an attempt | **FIXED** |
| 2 | Qualify when the gate stages a shell | **FIXED** |

Evidence files in this directory:

- `code-verification-f1.log` / `code-verification-f2.log` — the greps of the live source that decided each
  verdict (observed output, not a recollection).
- `change.diff` — the exact documentation diff.
- `result.json` — machine-readable reconciliation.

## Finding 1 — auto-end is an ATTEMPT

**What the code does.** `autoEndCleanTerminal` calls `agent_teams_control {action:"end"}` once. Both the
non-`ok` answer and a thrown/timed-out call take the same shape: one `warn(...)` whose text ends
`— the gate continues`, then `return false`. The caller in the RULE 3 loop awaits it and **discards the
return value**, and `autoEndAttempted` makes the attempt **once per team per process** — the source comment
says a failed call "must not turn every following pre-step into a retry loop". The re-arm path (the
CLEAN-TERMINAL / `ended` branch) is not conditioned on that boolean, so the gate may classify a board as
terminal and re-arm while the team record is still open. The reviewer's description is exactly this.

**New sentences (quotable):**

> `completed`/`cancelled`, none `failed` — which the gate ATTEMPTS to end itself: `autoEndCleanTerminal` issues
> ONE `agent_teams_control end` call per team per process and, if that call fails or times out, logs one warning
> and continues WITHOUT retrying that team — so a board the gate treats as terminal can leave its team open.

## Finding 2 — a shell is staged only under three conditions

**What the code does.** The mode table in the file header: `mechanical` stages, `advisory` "stages nothing",
`off` returns immediately. `stagePlan` returns `{ok:true, alreadyStaged:true}` when the staged-plan probe
positively finds a plan (naming it, creating nothing); it returns `{ok:false, error}` when
`hasStagingTool` is false or the `agent_teams_plan` call fails/throws/times out. The re-team fire computes
`staged = mechanical && outcome.ok && !alreadyStaged`, and the notice for every non-staged route says
`NO team was staged`. The reviewer's three conditions are all present in the code.

**New sentences (quotable):**

> With no live team and `team.reteam.afterConsults` (default 4) COMPLETED `mpd_role_spawn*` /
> `mpd_workmate_spawn` calls since the last fire, the gate fires the re-team rule under the marker
> `[AgentTeams] Re-team rule`, once per record in `<ws>/.mpd/session-gate/<sessionId>.json`. It stages a NEW
> shell only under `team.gate=mechanical`, only when `stagePlan` succeeds, and only when the staged-plan probe
> found none — a plan already staged is NAMED through `alreadyStaged` instead of created, and an unanswerable
> probe stages anyway with one warning. `advisory` mode, a missing `agent_teams_plan` tool and every failed
> call emit the notice only, saying `NO team was staged`. `team.reteam.enabled` (default true) gates only that
> volume trigger.

## Gates

**None.** No gate discovers `agent-references/`. `scripts/verify-docs-parity.ts` states it in the
`linkBand` doc comment — "No new discovery: `agent-references/**` stays out of this gate (T-28)" — and
`discoverPairs` walks the root README pair, `docs/**`, the declared bands and each package; this tree is in
none of them. No other script validates this file's prose (`scripts/verify-pack-closure.ts` checks its BYTES
in the packed artifact, which is the note below). Nothing else was touched, so nothing else needed re-running.

## Integration notes for the captain (outside this seat's write scope)

1. **`AGENTS.md` §1 carries the SAME two statements** — in the paragraph beginning "The gate RE-ARMS
   mid-session (2026-11-05)": "…none failed), which the gate ends itself." and "the gate stages a NEW shell
   under the marker `[AgentTeams] Re-team rule`". That copy needs the same two qualifications. It is
   **budget-bound** (`maxBytes: 65536`, currently **63483 B**, so ~2.0 KiB of headroom), so a MOVE-FIRST
   trim is required by AGENTS.md §3 if the edit grows it materially.
2. **The packed copy is now stale by design.** `dist/mpd-package/agent-references/troubleshooting.md`
   (untracked build output) held the old bytes with the same sha256 as the source
   (`b0470ce3…`); it now differs from the edited source (`19277185…`). The wave's pack step must regenerate
   `dist/mpd-package/` (and re-anchor with `--pack-stamp`) or `verify-pack-closure` will report
   CONTENT-DRIFT. That step belongs to integration, not to this seat.

## Bounds — what was NOT proven

- No live boot, unit test or QA case was run for the gate: both verdicts rest on **source reading** of
  `session-gate.ts` / `complexity-gate.ts`, plus the constants and notice builders quoted in
  `code-verification-f*.log`. The behaviour under a real `agent_teams_control end` failure was not
  reproduced end-to-end.
- No claim is made about the `agent_teams_control` implementation's own failure modes — only about how this
  gate handles them.
