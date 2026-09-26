# t19 — review round 2 (Reviewer seat): verdict PASS

- Task: `t19` review round 2, attempt `c05a2e2e-2dbe-440a-ad84-f5fda5ac1882`, reviewed task `t18`.
- Round-1 review: `t9` (verdict `needs_revision`, findings T9-R1 medium / T9-R2 low).
- Date: 2026-09-18, ~02:00–02:08 UTC.

## Revision judged (pinned + settled)

- HEAD `5aa222a144e4238b67453731c5decd806db6db94`, branch `dev`, dirty wave tree.
- Pinned `2026-09-18T02:00:26Z`; re-checked `2026-09-18T02:01:43Z` (77 s >= the 50 s settle window) — byte-identical:

| file | sha256 |
|---|---|
| `packages/mpd-ulw-plugin/src/index.ts` | `1480131fcec6d18e5cc8b6bdf6afb74fd7fff916ee6f037d561df3036da2c2ea` |
| `packages/mpd-ulw-plugin/test/engine.test.ts` | `7db8496ef6d124570401f019471b5c320526b2af957d04433ad4efb66437658e` |
| `packages/mpd-ulw-plugin/test/commands.test.ts` | `5b4935f5521a3257af4e55953ffb0e6cb75cae1ad2df187f260b5fbbe016a406` |
| `packages/mpd-dsh-adapter-plugin/src/index.ts` | `d3dbf438332c933768f756cd59f70072cd145c9f330130e3291abe301bb6f80f` |
| `AGENTS.md` | `43b38e0d1197a90e9de14228c64b0daff5263ee26ca945e005e75b0647310ad6` |

These hashes equal the ones t18 recorded in `fileHashesSha256`
(`evidence/ulw/l2d-review-repairs/t18-20260918T015650Z/result.json`), so the repair and this review
measured the same bytes.

## T9-R1 — CLOSED

`packages/mpd-ulw-plugin/test/engine.test.ts`, case
`quality gate: a FAIL lane blocks completion and stamps the ledger row`:

- `makeCtx(overrides)` spreads the override AFTER the shared canned arms, so the completed-run case
  (`engine policy: plan -> round -> verify -> quality gate with ledger`) stays the positive control
  with its defaults untouched.
- The new case overrides only `-gate` with `hands-on QA = FAIL` and asserts `res.status === "blocked"`,
  `res.verdict === "approve"`, the `hands-on QA` ledger lane verdict `FAIL`, `state.json` status
  `blocked`, and the ledger file rows `"lane":"quality-hands-on QA","verdict":"FAIL"` plus the two
  PASS rows.
- Falsifiable, and proven so on disk: `evidence/ulw/l2d-review-repairs/t18-20260918T015650Z/mutation-control.log`
  records the blocking rule neutralized (mutated sha256 `a144142f…`) → `14 pass / 1 fail`, the single
  RED being exactly this test, then a byte-exact restore to `1480131f…`.

## T9-R2 — CLOSED

`packages/mpd-ulw-plugin/src/index.ts`: `ULW_COMMAND_DESCRIPTION` is now a per-name function and the
registration map passes the OTHER spelling. Independently reproduced here with this session's own
`apply()` against a fake harness (no file written):

```
ulw       :: Run the ULW discipline for an objective, fully autonomously (identical alias: /ultrawork)
ultrawork :: Run the ULW discipline for an objective, fully autonomously (identical alias: /ulw)
```

`test/commands.test.ts` locks it positively (description contains the other spelling) and negatively
(description must not contain `/` + its own name + `)`).

## t16 schema repair still holds (not re-filed)

- The engine return still omits the key when null:
  `return { status, rounds: used, ...(planFile === null ? {} : { planFile }), verdict, ledger: gateLedger, finalReport, stateFile }`.
- `engine.test.ts` still binds the DECLARED output schema object to real `plan=false` / `plan=true`
  results through the harness's own `assertSupportedJsonSchema` / `validateJsonSchemaValue`, with a
  negative control that rejects the retired `planFile: null` shape.

## Original review bars re-checked on this revision

- **Clause-2 equivalence against the REGISTERED handlers** — ONE handler (`runUlwCommand`) registered
  twice through `dsh.registerCommand` for bare names `ulw` / `ultrawork`; behavioural identity is
  asserted (equal result object, equal directive bytes) and the live registry lists both names.
- **Autonomy directive, clause by clause** — six clauses in order in the source constant
  (TRIAGE FIRST → GATE (A–D, explicit flag OR any matched signal) → TEAM WHEN WARRANTED
  (`agent_teams_create(approval="automatic", profile="mpd")`) → LOOP TO COMPLETION → FIX ON SIGHT →
  CLOSE OUT ON PROOF); the live case probes all six from the real injected message (`numbered=6`).
- **Adapter seam rule** — `packages/mpd-ulw-plugin/src/**` has no `ctx.commands`,
  `ctx.get("commands")`, `ctx.on(` and no bare `@deepseek-ai/*` import. (The only `ctx.on` hits are
  inside the STALE `dist/index.js` bundle, which inlines the adapter's own sanctioned code — the
  integration rebuild owns that artifact, see carry-forward.)
- **Prose-only claims** — every t18 claim is backed by an on-disk artifact (mutation control,
  registered-descriptions log, result.json hashes) and was independently reproduced here.
- **Anti-false-positive (`matchedSignals >= 2`)** — the string does not occur in the reviewed
  surfaces (`packages/mpd-ulw-plugin/src`, its README pair, `AGENTS.md`); no finding filed.

## Commands run

| command | result |
|---|---|
| `bun test packages/mpd-ulw-plugin packages/mpd-dsh-adapter-plugin` | 69 pass / 0 fail |
| `bun test packages/mpd-ulw-plugin` | 15 pass / 0 fail (was 14; the new FAIL-lane case is the +1) |
| `bun run typecheck` | exit 0 |
| `node skills/dsh-qa/scripts/ulw-command.mjs --self-test` | ok, exit 0 |
| `node skills/dsh-qa/scripts/ultrawork-smoke.mjs --self-test` | ok, exit 0 |
| `node skills/dsh-qa/scripts/ulw-command.mjs` (live, isolated `DSH_HOME` + sandboxed `HOME`/workspace) | PASS, exit 0 — durable evidence: `evidence/ulw/l6-verification/ulw-command-2026-09-18T02-01-51.924Z/{result.json,output.log,raw/**}` |
| seam grep over `packages/mpd-ulw-plugin/src` | no hits |
| live per-name descriptions via `apply()` (inline, no file written) | `ulw → /ultrawork`, `ultrawork → /ulw` |

Live-run facts from the durable artifact above: registry listing
`[agent-teams, agent-teams-mpd, compact, feedback, goal, mpd, permission, plan, ultrawork, ulw]`;
empty invocation → `kind=error` usage naming both forms; `/ultrawork <obj>` → `kind=success`
`ULW activated: <obj>`; session lifecycle `runs=[ulw, ultrawork]`, `kinds=[error, success]`;
injected directive carries all six clauses (`numbered=6`); gesture arm `rewritten=true`,
`clauses=6`, `commandRuns=0`; `crossLaneFindings=[]`; `workspacesSandboxed.ok=true`.

## Carry-forward (NOT a finding)

`packages/mpd-ulw-plugin/dist/**` (and the other stale package dists) stay stale until the
integration rebuild (T-88), so the case's shipped-composition arm is `ok=false` while the
src-built "resolved" arm is the gating one — expected pre-`t8`, exactly as disclosed.
