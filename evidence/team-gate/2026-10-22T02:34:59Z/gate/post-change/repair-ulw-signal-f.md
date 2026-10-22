# R1 repair 3 — the ULW gate evaluates signal F (2026-10-22)

Closes the bound reported after repair 2: `/ulw` now runs the SAME workspace-scale probe as the
session-start gate, so a large workspace stages a plan from BOTH gates.

## The change (`packages/mpd-ulw-plugin/src/index.ts`, `evaluateUlwGate`)

```ts
const workspaceScale = SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale
  ? await readWorkspaceScale(workspace)
  : false
const verdict = evaluateComplexityGate(objective, { …., sensitivity, workspaceScale })
```

- The workspace is the one the function ALREADY resolved (`ulwWorkspace(dsh, input.agent)` →
  `dsh.workspaceRoot({agent})` → `session.header.cwd` first) — no second resolution path.
- The probe runs ONLY when the resolved row enables F (`easy`); `normal` / `strict` skip it entirely,
  so their behaviour is byte-identical and they never touch the filesystem here.
- `readWorkspaceScale` is non-throwing by contract (a read error reads `false`), and the whole gate
  is inside the existing `try`/`catch` that degrades to an honest UNEVALUATED report.

## The two (plus two) test arms — and one factual correction

Requested pair: `修复并验证` in a large temp workspace (manifest + project dir + >= 8 visible entries)
must stage with F recorded; the same prompt in a small workspace must stay silent.

CORRECTION, measured: `修复并验证` fires signal **B** on the `easy` row regardless of the workspace
(two distinct deliverable verbs >= 2), so it CANNOT be a silent small-workspace control. The arms
delivered are:

| arm | workspace | prompt | observed |
|---|---|---|---|
| A | LARGE temp root | `修复并验证` | 1 staging call, directive `complexity signals B/F` |
| B | LARGE temp root | `Reply with exactly: hello-ok` (signal-free) | 1 staging call, directive `complexity signals F` — F ALONE |
| C | TINY temp root | the same signal-free prompt | 0 staging calls, `no complexity signal fired for this objective` |
| D | TINY temp root | `修复并验证` | 1 staging call, `complexity signals B` (NOT `B/F`) — documented so A/B/C cannot be misread |

The fake agent carries `session: { header: { cwd } }`, which is where the adapter resolves the
workspace, so the probe reads the TEMP root rather than this checkout (itself a large workspace).

## Observed results (quoted)

$ bun test packages/mpd-ulw-plugin
  26 pass
  0 fail
  230 expect() calls
  Ran 26 tests across 2 files.

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

$ bun run verify:comments
  VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.

$ node skills/dsh-qa/scripts/ulw-command.ts --self-test
  [ulw-command self-test] ok: registry listing + usage + activation + directive order/objective +
  command lifecycle predicates, each with a negative control; shipped directive literal and SKILL.md
  row verified

`dist/` was NOT rebuilt: the captain rebuilds after this edit. The QA probe needed no change (it
mirrors the head only, and the head already moved to A–F in repair 2).
