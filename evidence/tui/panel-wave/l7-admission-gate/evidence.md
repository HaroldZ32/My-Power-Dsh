# L7 — admission gate evidence (T4)

Wave: `feature/tui-panel-wave`, lane L7. Contract: `.mpd/plans/tui-panel-wave.md` §5.A6 + decision D5.
Instrument: `scripts/verify-tui-admission.ts` (NEW), wired as `bun run verify:tui-admission` and as the
`tui-admission` member of `bun run verify:gates`.

## Files changed (lane write scope only)

- `scripts/verify-tui-admission.ts` — NEW: static hard arms + the host's own admission chain + host-free
  `--self-test` with a negative control.
- `package.json` — `verify:tui-admission` script row.
- `scripts/verify-gates.ts` — `tui-admission` member of `DECLARED_MEMBERS` (10 members resolved).
- `docs/tui-admission.md`, `docs/tui-admission.zh-CN.md` — §1 table row + §7 (bilingual pair, same
  heading tree).
- `skills/dsh-qa/scripts/tui-admission.ts` — header note naming the hard gate (comment only).
- `skills/dsh-qa/SKILL.md` — the `tui-admission` case row now names the hard gate.

Nothing under `packages/` was touched by this lane.

## Commands and observed results

| Command | Exit | Observed |
|---|---|---|
| `node scripts/verify-tui-admission.ts --self-test` | 0 | `self-test PASS: 13/13 arms`. The negative control's transcript shows 10 red arms on the deliberately broken fixture and `REPORT: FAIL` (`self-test.log`). |
| `node scripts/verify-tui-admission.ts --json …/result.json` | 0 | `REPORT: PASS — 43 arms passed, 1 allowed deviation(s), 5 bound(s)`; host `@deepseek-harness-tui/dsh-tui 0.18.0`; `H.chain:bundle` and `H.chain:package` both `compatible` (`output.log`, `result.json`: 49 arms = 43 pass + 1 deviation + 5 bounds). |
| `node scripts/verify-tui-admission.ts --host-dir /tmp/l7-absent-host` | 3 | `REPORT: NOT PASSED — the host arm did NOT run`; every discovery candidate and the remedy are printed; a skip is never a pass (`no-host.log`). |
| `node scripts/verify-tui-admission.ts --static-only` | 3 | prints `NOT PASSED … a skip is never a pass (D5)` and the static summary; never a green partial. |
| `bun run verify:docs` | 0 | `pairs=56 failed=0 violations=0 … — PASS`. |
| `bun run test:qa` | 0 | every QA case self-test passed, including the edited `tui-admission` case. |
| `bun run verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` (609 files). |
| `bun run typecheck` | 0 | `tsgo --noEmit` clean over the whole program. |
| `node scripts/verify-gates.ts --list` | 0 | `10 member gate(s) resolved`, `tui-admission` last. |
| `node scripts/verify-gates.ts --self-test` | 0 | `self-test PASS: 9/9 arms`. |
| `node scripts/verify-vendor.ts` | 1 | `FAIL - asset skills treeSha mismatch` — caused by this lane's two `skills/**` edits. Per AGENTS.md §9 the wave's SINGLE re-pin (`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`) must land in the same commit; this lane did not run it (captain's step). |

## What the gate decides (and what it does not)

Static arms (host-free), derived from `docs/tui-admission.md` §4 (A–G) and §5 (R1–R7) plus the
committed guide copy: `A.schema`, `A.manifest-version`, `A.id`, `A.host-facet`, `A.host-entry`,
`A.facets`, `A.licence`, `A.id-parity`, `A.identity-parity`, `A.packed-copy`, `B.contracts`,
`B.no-provides`, `B.permissions`, `B.subscriptions`, `B.commands`, `C.no-backend`,
`R1.subscriptions-empty`, `R2.credentials`, `R3.stdout`, `R7.cell-width`, `D.apply-export`,
`D.cleanup-test`, `R5.records`, `R5.allowance` (printed `ALLOWED-DEVIATION`, never PASS),
`R5.no-dsh-tui-writes`. Bounds: `A6.no-digest`, `D.residual` (the `effectOn` comment-only catch must
still be there), `E.residual` (the pinned matrix must still lack a `TUI-OBS-002` row), `F.residual`,
`G.market`.

Host arm (host-bound): the installed payload's own `parseManifest` (never `JSON.parse`) →
`loadSpecData` + `verifyRegistry`/`verifyContractProfiles` → `createContractIndex` → `validatePlugin` →
`projectManifest` → `negotiate` against the host's own `buildLegacyHostDescriptor` from
`HOST_SUPPORTED_CONTRACTS`. Both manifests must answer `compatible`.

Honest bounds: static admission plus the host's own negotiation. NOT a live TTY mount, NOT the host's
`/plugin check` (that stays `skills/dsh-qa/scripts/tui-admission.ts`), and NO artifact digest — so no
"Verified" claim is made anywhere. The negotiated descriptor is the host's legacy-compatibility
descriptor, not live probe evidence. The `R5.no-dsh-tui-writes` scan is line-based (declared bound): a
write built on a different line from the path would escape it.

## Findings for the captain (outside this lane's scope)

1. `skills/**` changed here → the wave needs its ONE vendor re-pin in the same commit (§9).
2. AGENTS.md §4 still says `verify:gates` aggregates "nine members"; it is now TEN. AGENTS.md is outside
   every lane's write scope — the captain should amend that sentence.
