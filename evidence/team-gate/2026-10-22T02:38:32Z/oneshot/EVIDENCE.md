# R2 — one-shot consults: dispose after report + consult wording

- **Wave**: `team-gate-wave` (frozen contract `.mpd/plans/team-gate-wave.md`, R2 section)
- **Lane / writer**: Senior Engineer, shared checkout on `feature/team-gate-wave`
- **Stamp**: 2026-10-22T02:38:32Z (UTC)
- **Write scope actually used**: `packages/mpd-dsh-adapter-plugin/**`,
  `packages/mpd-workmate-plugin/**`. `packages/mpd-roles-plugin/**` was NOT touched (scope
  correction: gate-writer owns it); `skills/**` and `dist/**` were NOT touched.

## What changed (files + symbols)

1. `packages/mpd-dsh-adapter-plugin/src/index.ts`
   - `DshAdapter.spawnAgent` interface doc: CONTINUABLE wording replaced by the ONE-SHOT contract
     plus the honest bound (dispose releases the LIVE activation; the catalog is append-only, so
     the settled child may still list `inactive` / be cold-resumable; a new question = a new
     consult; `startContinuableAgent` stays the separate durable seam).
   - NEW module-level `disposeSettledConsult(activation: unknown): Promise<void>`: reads `dispose`
     off the activation handle, calls it EXACTLY once when callable, awaits it, and swallows both a
     synchronous throw and a rejected promise. A handle without `dispose` (retired generation,
     stub) is a no-op.
   - `createDshAdapter(...).spawnAgent` activation branch: after `activation.result` settles and
     before the report is projected, `await disposeSettledConsult(activation)`.
   - `startContinuableAgent` / `startContinuableChild` are UNCHANGED (team continuity).
2. `packages/mpd-dsh-adapter-plugin/test/adapter-subagent-seam-generations.test.ts`
   - The 0.2.1 double now hands out a REAL activation handle `{ childId, messageId, result, dispose }`
     and records `dispose` with a settlement flag read at call time (ordering proof).
   - New arms: dispose exactly once AND after the result settles; a REJECTING dispose still returns
     the identical report; a THROWING dispose still returns the report; an activation WITHOUT
     `dispose` is tolerated; the RETIRED `start` arm records no dispose; `startContinuableAgent`
     records no dispose (durable seam untouched).
   - Existing 0.2.1 `spawnAgent` arms updated from `["startActivation"]` to
     `["startActivation", "dispose"]`.
3. `packages/mpd-workmate-plugin/src/index.ts` — `mpd_workmate_spawn` description rewritten to the
   one-shot contract (activation disposed after the report; durable continuity lives in the workmate
   RECORD, not the child session; honest append-only catalog bound).
4. `packages/mpd-workmate-plugin/README.md` + `README.zh-CN.md` — `mpd_workmate_spawn` tool-table
   row rewritten to the one-shot contract.
5. `packages/mpd-dsh-adapter-plugin/README.md` + `README.zh-CN.md` — the consult paragraph rewritten
   to the one-shot contract with the honest bound; the team path is explicitly declared unaffected.

## Commands run and observed results

All with the PINNED toolchain where applicable (`.toolchain/node_modules/.bin/bun`, 1.4.0):

| Command | Observed |
|---|---|
| `.toolchain/node_modules/.bin/bun test packages/mpd-dsh-adapter-plugin packages/mpd-workmate-plugin` | `295 pass`, `0 fail`, `1632 expect() calls`, `Ran 295 tests across 19 files. [2.71s]` |
| `.toolchain/node_modules/.bin/bun test packages/mpd-dsh-adapter-plugin/test/adapter-subagent-seam-generations.test.ts` | `20 pass`, `0 fail`, `72 expect() calls` |
| `.toolchain/node_modules/.bin/bun run typecheck` (`tsgo --noEmit`) | exit 0, no diagnostics |
| `.toolchain/node_modules/.bin/bun run verify:comments` | FAIL — 1 violation, **OUTSIDE this lane**: `packages/mpd-project-init-plugin/test/project-init.test.ts:79 parameter-type — fakeAdapter` (R3 writer's in-progress file; not edited here) |
| `.toolchain/node_modules/.bin/bun run verify:docs` | FAIL — 1 violation, **OUTSIDE this lane**: `package-no-readme:packages/mpd-project-init-plugin` (R3 package mid-creation). Both README pairs edited here printed `ok` (`packages/mpd-dsh-adapter-plugin/README.md`, `packages/mpd-workmate-plugin/README.md`) |

The comments gate was re-run after fixing the one violation it found in THIS lane
(`receiver` declaration in the new dispose arm); it now reports no violation in either touched
package.

## Honest bounds / what is NOT verified here

- **dispose does not make the child a true one-shot.** On harness 0.2.1-rc.2 (installed globally:
  `@deepseek-ai/dsh-subagent@0.2.1-rc.2`) `startActivation` always returns a handle whose
  `dispose(): Promise<void>` "stops and releases this activation and its owned descendants" and
  "rejects on teardown failure" (read from the installed package's `README.md` and
  `lib/types/types.d.ts`). The result settles after teardown; `dispose` then releases the live
  activation record. The harness child catalog remains append-only, so the settled child may still
  be LISTED as `inactive` and is technically cold-resumable. The shipped CONTRACT is one-shot: no
  surface tells a caller to reuse the consult, and none does.
- **`dispose` is awaited** so the release is complete when the consult returns; the harness
  documents `result` as settling only after teardown, so the wait is bounded in practice. A
  pathologically hanging `dispose` would delay the report; a rejecting/throwing one cannot change
  or fail it (pinned by the two new arms).
- **No mounting boot was run in this lane** (`preset-conformance`, a live tool call). The
  `mpd_workmate_spawn` change is description TEXT only (parameters/output schema unchanged), and
  it is covered by the package suite compiling/registering the row; the wave's real mounting boot
  is an Integration gate per the plan.
- **`dist/` was NOT rebuilt** (plan: Integration rebuilds every touched `dist/` with the pinned
  bun). Measured after this lane: `node scripts/verify-dist-fresh.ts` → `FAIL - 23 of 33 targets not
  fresh (STALE: 23)`, which includes `packages/mpd-dsh-adapter-plugin/dist/index.js` and
  `packages/mpd-workmate-plugin/dist/index.js` plus every adapter-dependent package (the §6 fan-out:
  `bun build` inlines the adapter). This is the expected pre-rebuild state, owned by Integration.
- `packages/mpd-roles-plugin` was NOT edited; its suite was run READ-ONLY for information:
  `160 pass`, `1 fail` — the failure is
  `F1 shipped artifact > the committed dist is the byte-identical product of a canonical build (T-62)`,
  i.e. the same pre-rebuild `dist/` staleness (that package imports the adapter src, so this lane's
  adapter edit is one contributor). No logic/test failure was observed there. The wave must not
  treat that red as green until Integration rebuilds.

## Exact replacement wording for the captain-routed files (NOT edited here)

### (a) `packages/mpd-roles-plugin/src/index.ts` — `mpd_role_spawn` description

Replace the current sentence
`Run ONE bounded delegation with a specialist and return one report — a single-call consult, not an ephemeral subagent: the harness keeps the child CONTINUABLE, so after the report it stays listed as inactive and ` + "`send_message`" + ` can continue it.`
with:

> Run ONE bounded delegation with a specialist and return one report — a ONE-SHOT single-call
> consult: the adapter disposes the activation once the report settles, so the consult is NOT
> reused — ask a new question with a NEW spawn (the harness catalog is append-only, so a settled
> child may still list as `inactive`, but the contract is one-shot). It carries the role's persona,
> model route and read-only discipline (read-only roles get a write-tool deny filter). Roles, each
> named for what it does: <rosterFunctionList()>. The child is labelled with that name.
> `mpd_workmate_spawn` is the same spawn mechanics for a durable, evolving instance (its
> persona/memory/note — not the child session — carry continuity). For multi-member team work prefer
> the official Agent Teams tools (spawn_teammate + team_task_create) instead of repeated single-call
> consults: a teammate inherits the caller's model route, while THIS path applies the role's
> teamModels slot route.

(The rest of the description is unchanged; the quoted sentence is the only continuity claim.)

### (b) `packages/mpd-roles-plugin/src/delegation-gate.ts` — `delegationRefusal`

Replace the clause
`; ` + "`send_message`" + ` continues an existing continuable child.`
with:

> ; a consult is one-shot — `send_message` continues only an existing TEAM child, never a finished
> consult.

Full replacement function body text:

> "delegation gate: `" + toolName + "` is refused — the official spawn tools are not the delegation"
>   + " path under the MPD discipline. Delegate instead: `mpd_role_spawn` (one-shot single-call roster consult),"
>   + " `mpd_workmate_match` + `mpd_workmate_spawn` (durable instance), or Agent Teams for multi-member work"
>   + " (`agent_teams_plan`, persona from `mpd_role_persona`); a consult is one-shot — `send_message`"
>   + " continues only an existing TEAM child, never a finished consult. The gate covers the captain and"
>   + " every member session. `delegation.gate` in mpd.jsonc: \"captain\" limits it to the top-level"
>   + " session, \"allow\" releases it entirely."

This keeps the substrings `delegation-gate.test.ts` asserts (`send_message`, the three routes, the
knob and both modes).

### (c) `presets/mpd.patch.yml` — the consult clause in the SPECIALISTS AND TEAMS paragraph

Replace `consult them with ` + "`mpd_role_spawn`" + ` (one bounded delegation, one report; the child stays continuable)`
with:

> consult them with `mpd_role_spawn` (one-shot: one bounded delegation, one report, then the
> activation is disposed), take a member's persona text with `mpd_role_persona` …

No other preset line claims consult continuity (the HOW TO DELEGATE line at `~110` and the WORKMATE
LIBRARY line only name the tools).
