# Integration gate sweep — `feature/tui-panel-wave`

Tree state: all wave lanes closed, no writer active. Every command below was run by the captain from the
repository root on the FINAL tree (2026-11-07, ~00:55–01:05 +08:00).

| Gate | Command | Observed |
|---|---|---|
| Aggregate static gates | `bun run verify:gates` | **PASS — 10/10 member gates green** (vendor, dist freshness, row parity, doc pairs, preset conformance, plugin manifest, comment coverage, graph model, workflows, **tui admission**) |
| Typecheck | `bun run typecheck` | exit 0, no diagnostics |
| Declaration comments | `bun run verify:comments` | exit 0 — "VERDICT: PASS — every declaration in the family carries a precise comment and a full signature." |
| Plugin manifest | `bun run verify:manifest` | exit 0 — "VERDICT: PASS — the install-time rules and the packaging contract hold." |
| No host override | `node scripts/verify-no-host-override.ts` | exit 0 — "PASS: every id-target is bundle-owned (0 of 0 collide with the 214 host-declared row ids)" |
| Manual paths | `node scripts/verify-manual-paths.ts` | exit 0 — "PASS resolved=159 over-report=72 under-report=82 declared=2" |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | exit 0 — "ok: 34/34 targets fresh (each rebuilt twice, byte-identical)", 1 NOT COVERED (sha-pinned prebuilt) |
| Vendor | `node scripts/verify-vendor.ts` | exit 0 — "PASS - 7 shipped asset(s) fingerprinted, upstream identity not checked" |
| QA self-tests | `bun run test:qa` | exit 0 |
| Full test sweep | `bun test packages` | exit 0 — **3673 pass / 6 skip / 0 fail, 3679 tests across 245 files** |
| New hard gate, standalone | `node scripts/verify-tui-admission.ts` | exit 0 — "REPORT: PASS — 43 arms passed, 1 allowed deviation(s), 5 bound(s)"; both manifests negotiated to `compatible` by the host's OWN chain |

## The new gate's own falsifiability (produced by the L7 lane, cited not re-run)

- `--self-test` → exit 0, 13/13 arms, of which the spawned NEGATIVE control exits 1 with 10 red arms.
- `--host-dir <absent>` → exit 3 with the discovery candidates and the remedy printed.
- `--static-only` → exit 3: a skip is never a pass (decision D5).

## What this sweep does NOT cover

- No live TTY capture of any new surface (contract §7.1). The proof is unit-render + the package suites +
  these gates.
- The Docker real-machine lane is a RELEASE step and was not run here.
- `node scripts/verify-pack-closure.ts` is a post-pack step; this wave does not pack.
