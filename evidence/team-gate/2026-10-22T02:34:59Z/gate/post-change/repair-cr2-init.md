# Repair — CodeRabbit round-2 finding, project-init disposal test (PR #59)

Task: T14 (repair), owner init-writer, 2026-10-22. Scope: `packages/mpd-project-init-plugin` only.
TEST-ONLY change: no `src/` edit survives this task, no dist rebuild, no git write command.

## Finding (round 2, Trivial)

`packages/mpd-project-init-plugin/test/project-init.test.ts`, the disposal case: the fake adapter's
`registerAgentPreStep` returned a NO-OP disposer and recorded nothing. The test therefore passed when
`release()` removed both map entries WITHOUT invoking the disposer — the exact regression class it was
written to catch.

## Fix

- `FakeAdapter` gains `disposedAgents: unknown[]` — one entry per DISPOSER INVOCATION, appended by the
  disposer the fake returns from `registerAgentPreStep`.
- The disposal test now asserts, in order:
  1. `fake.disposedAgents.length === 0` BEFORE the `agent/disposed` payload (the disposer must not have
     run while the agent was live);
  2. `fake.disposedAgents` DEEP-EQUALS `[captain]` after the payload — exactly ONE call;
  3. `acted` and `disposers` no longer hold the handle (the original assertions are KEPT);
  4. a SECOND disposal payload leaves the count at `1` — teardown is idempotent, so a double dispatch
     cannot invoke the disposer twice.

## Negative control (the assertion is not vacuous)

Seeded mutation in the same shell: `release()`'s `dispose()` call replaced by
`void dispose // MUTATION: negative control, disposer deliberately not invoked`, then:

- `bun test packages/mpd-project-init-plugin` → **exit 1**, `17 pass / 1 fail`, and the failing case is
  exactly `installProjectInit > a disposed agent is dropped from BOTH the acted set and the disposer map`
  (`Expected -11 / Received +1` — the empty recorded array against `[captain]`).
- Source restored from a byte copy; `sha256sum` BEFORE and AFTER the mutation window:
  `1ce4c2dfb121729f495ddc22d9fddf43bbb2003f8615e1cf0aab9e90ce41e8ac` both times → **RESTORED IDENTICAL**.

## Gates (observed, not claimed)

- `bun test packages/mpd-project-init-plugin` → **exit 0**, `18 pass / 0 fail`, 72 `expect()` calls.
- `bun run typecheck` → **exit 0**, `$ tsgo --noEmit` with no diagnostics.
- `bun run verify:comments` → **exit 0**,
  `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature`
  (429 files, 37899 declarations).
- `node scripts/verify-dist-fresh.ts` → this package is **FRESH**
  (`packages/mpd-project-init-plugin/dist/index.js sha 56967f05e29f…`, rebuilt by integration after T6).
  Test-only change, so that freshness is unaffected; nothing to rebuild for T14.

## Working-tree delta

`git status --porcelain packages/mpd-project-init-plugin` → exactly one line:
` M packages/mpd-project-init-plugin/test/project-init.test.ts`.

Not touched: `src/index.ts` (hash unchanged, quoted above), `dist/`, `cordis.patch.yml`, `scripts/**`,
`skills/**`; no git write command.
