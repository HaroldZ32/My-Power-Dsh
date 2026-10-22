# Repair — CodeRabbit findings F-CR3 / F-CR2 (PR #59, project-init)

Task: T6 (repair), owner init-writer, 2026-10-22. Scope: `packages/mpd-project-init-plugin` only.
No dist rebuild by instruction (captain owns the integration rebuild); no git write command.

## F-CR3 — `acted`-set retention on agent disposal (VALID, fixed)

**Finding.** The `agent/disposed` path released the scope listener (`disposers.delete`) but left the
agent handle in `acted`, retaining a dead agent — its session header, messages and scope — for the life
of the process.

**Fix.** `release(agent)` in `packages/mpd-project-init-plugin/src/index.ts` now clears BOTH
registries, unconditionally and in this order: `acted.delete(agent)` first, then the disposer lookup +
`disposers.delete` + `dispose()`. Clearing first means a handle that never registered a listener is not
retained either, and a throwing disposer cannot skip the `acted` cleanup. The `ProjectInitInstall.acted`
doc comment now states that a disposed handle is removed. No behaviour change for live sessions: the
`acted` guard still allows exactly ONE inspection per live agent.

**Focused test** (`test/project-init.test.ts`, fake adapter now records lifecycle handlers):
`a disposed agent is dropped from BOTH the acted set and the disposer map` — fires the captain's
pre-step (asserts `acted.has(captain) === true`), dispatches the recorded `agent/disposed` payload
(`{ agent: captain }`), then asserts `acted.has(captain) === false` and `disposers.has(captain) === false`.

## F-CR2 — `.ts` extension on the two adapter imports (STALE, imports unchanged)

**Adjudication: STALE — no edit.** The request would add an explicit `.ts` to the `mpd-dsh-adapter-plugin/src/index`
specifiers, but `packages/*/src` is the BUNDLE-BUILT band, whose declared spelling is EXTENSIONLESS.
Evidence measured in this checkout (2026-10-22, `packages/*/src`, 61 adapter-source mentions):

| spelling | count |
|---|---|
| extensionless (`…/src/index`) | **46** |
| `…/src/index.js` | 15 |
| `…/src/index.ts` | **0** |

- `AGENTS.md` §6: "`packages/*/src` differs in FORM only (`bun build` → `dist/*.js`, **extensionless
  specifiers**)"; the `.ts`-extension rule applies to files Node runs directly, not to this band.
- `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` (comment immediately
  above its own import): "it imports `DSH_SEAM_NAMES` from the adapter's own `src/index.ts`, and
  `packages/*/src` speaks the bundle's **extensionless specifier form**, which node's type stripping
  cannot resolve."
- The spelling never reaches runtime: `bun build` inlines every imported module into `dist/index.js`.
  Adding `.ts` would create the tree's ONLY `.ts` adapter import in the src band — pure churn, and it
  would contradict the convention the coupling inventory documents.

## Gates (observed, not claimed)

- `bun test packages/mpd-project-init-plugin` → **exit 0**, `18 pass / 0 fail`, 69 `expect()` calls
  (was 17 / 66 before the focused test).
- `bun run typecheck` → **exit 0**, `$ tsgo --noEmit` with no diagnostics.
- `bun run verify:comments` → **exit 0**,
  `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature`
  (429 files, 37877 declarations).

## Dist bound (declared, per captain instruction)

`dist/index.js` was NOT rebuilt (instruction: "No dist rebuild (captain)"), so it still carries the
pre-fix bytes. Observed `node scripts/verify-dist-fresh.ts` after this repair:
`1 of 33 targets not fresh` and it is exactly this package —
committed `80497 B, sha 3aa826ab83ce38e8…` vs fresh build `80522 B, sha 56967f05e29fe440…`.
The exact integration command (pinned toolchain, repo root):

```sh
.toolchain/node_modules/.bin/bun build packages/mpd-project-init-plugin/src/index.ts --target node --format esm --outfile packages/mpd-project-init-plugin/dist/index.js
```

Every other target is FRESH; this is the only dist red left in the tree as of this note.

## Not touched

The two adapter imports are UNCHANGED (F-CR2 STALE). No other source file, no `dist/`, no
`cordis.patch.yml`, no `scripts/**`, no `skills/**`, no git write command.
