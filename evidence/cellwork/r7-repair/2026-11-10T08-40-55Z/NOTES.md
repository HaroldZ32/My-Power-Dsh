# R7 repair — writer's verification record (CodeRabbit round 1 on PR #107)

Writer: Senior Engineer (subagent). Contract: `.mpd/plans/cellwork-coderabbit-round1.md` (frozen).
HEAD at start: `4c4671010a6cf9923ad4ca9a752291e078acd99f`, branch `feature/cellwork-async-delegation`.
This file is the WRITER's digest of commands and observed output; it is not a verifier verdict.

## Per-finding disposition (all 12 VALID against the code; none STALE)

| # | Disposition | Where |
|---|---|---|
| R7.1 | FIXED | `packages/mpd-bundle-plugin/client.js` rebuilt + `VENDOR_LOCK.json` client.js sha refreshed (one-line diff) |
| R7.2 | FIXED | `packages/mpd-cellwork-plugin/src/protocol.ts:2114-2121` (predicate), `:2140-2160` (journal), `:2179` (reseed row) |
| R7.3 | FIXED | `packages/mpd-cellwork-plugin/src/protocol.ts:481` (`livenessOf`) and its one call site in `forceReadingOf` |
| R7.4 | FIXED | `packages/mpd-bundle-plugin/src/team-view.ts:1473` (`isoInstantOf`), used at `:3448` |
| R7.5 | FIXED (cancel + journal) | `packages/mpd-cellwork-plugin/src/consults.ts:646-668`; `flow.ts:232`; README EN `:428-434`, zh `:342-348` |
| R7.6 | FIXED | `packages/mpd-team-core-plugin/src/team-store.ts:937` (`staleRunning`) + terminal-field carry |
| R7.7 | FIXED | `packages/mpd-tui-plugin/src/panel-dag.ts:768` (`isoInstantOf`) + elapsed guard in `consultDetailLines` |
| R7.8 | FIXED | `packages/mpd-cellwork-plugin/README.md:175` and `README.zh-CN.md:144` |
| R7.9 | FIXED | `packages/mpd-tui-plugin/src/panel-dag.ts:1687-1694` |
| R7.10 | FIXED | `packages/mpd-bundle-plugin/src/team-view.ts:3446` |
| R7.11 | FIXED | `packages/mpd-cellwork-plugin/src/protocol.ts:442-452` (`SeatLiveness` comment) |
| R7.12 | FIXED | `packages/mpd-team-core-plugin/test/consult-nodes.test.ts` (different clocks + populated terminal fields) |

## R7.1 — the vendor member (DEVIATION, stated)

The frozen contract's step (`repin-vendor --check` -> `--write --i-know-this-is-the-captains-step` -> `--check`)
CANNOT refresh this asset: `repin-vendor.ts` classifies a single-file `sha256` asset as POLICY and never
rewrites it. Observed, in order:

```
$ node scripts/repin-vendor.ts --check        # BEFORE the direct refresh, with the rebuilt artifact in place
[repin-vendor] CHECK     : GREEN - lock matches the working tree (drift=0, problems=0)   exit=0
$ node scripts/verify-vendor.ts
[verify-vendor] FAIL - asset packages/mpd-bundle-plugin/client.js sha256 mismatch        exit=1
$ node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step
[repin-vendor] packages/mpd-bundle-plugin/client.js: POLICY (not a failure) - single-file sha256 asset -
               a build artifact, so re-pin it by rebuilding the package that emits it, never by rewriting the lock
[repin-vendor] WRITE     : nothing to re-pin - .../VENDOR_LOCK.json left byte-identical   exit=0
```

So the fingerprint line was refreshed DIRECTLY (one line, paired with the rebuild) — the same shape commit
`f8d7bfea` used for this asset. Diff vs HEAD is exactly:

```
-      "sha256": "17bd1d3155fc218f3875a937fa6ed05ae362b69b6bc55d970123d81bb5504ecd",
+      "sha256": "5a1222f53a95cb7dd2b0b8ae258708b87045dd6ed7419e6cc245e303a5a554c4",
```

`node scripts/verify-vendor.ts` -> exit 0 (`PASS - 8 shipped asset(s) fingerprinted`).
`node scripts/repin-vendor.ts --check` -> exit 0 (GREEN).

## R7.2 — field truth the verifier must check

- Predicate (ONE place): `barrierRow = memberAfterBarrier(fresh.state.members[member] ?? member, result, config.compactionRetries)`;
  `cellReopened = barrierRow.fenced !== true`; `reopenPlaneSeat` is awaited ONLY when `cellReopened`.
- `memberAfterBarrier` fences iff `!reopened && (outcome === "refused" || (previous.barrierFailures ?? 0) + 1 >= retryBound)`
  where `reopened = outcome === "promoted"` (`protocol-core.ts:608-640`).
- Therefore: promoted -> reopen; reseeded below the bound -> reopen; reseeded AT/above the bound -> FENCED and
  the plane is NOT called; refused -> fenced, plane not called (and `checkpoint-unrecoverable` is written).
- The fenced run's journal: event `plane-reopen-skipped`, `by:"barrier"`, `plane:"skipped-fenced"` (+ reason);
  the `member-reseeded` row also carries `plane:"skipped-fenced"`. No `member-unfenced` row is written.
- Arms:
  - `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts`: "R7.2: a reseed that hits the RETRY BOUND
    fences the CELL row and does NOT reopen the plane" (default `compactionRetries: 1`, one reseed; asserts
    `planeUnfences === []`, fenced row, skipped row).
  - Complement (reopen direction): "R4.1: a PROMOTED barrier reopens the TEAM seat..." and
    "R5.1/R4.7: a RESEED retires the ORIGINAL session..." (`compactionRetries: 3`, asserts one plane unfence).
- Residual bound (disclosed): the decision row is computed from the PRE-plane read. A concurrent writer that
  raises `barrierFailures` INSIDE the awaited plane call could still make the persisted row fenced while the
  plane was reopened. The alternative order (write, then plane) would break the R5.3 merge discipline and the
  journal ordering, so the race is disclosed rather than closed.

## R7.3 — field truth the verifier must check

- `livenessOf(sessionId, anchorSessionId)` order: (1) no `liveAgentExact` -> `unknown`; (2) target resolves ->
  `live`; (3) `capabilities().agents !== true` -> `unknown`; (4) anchor `""` or unresolved -> `unknown`;
  (5) otherwise -> `dead`.
- The anchor is the CELL record's `captainSessionId` (passed from `forceReadingOf`'s `cell`).
- `unknown` licenses nothing on the liveness axis: `suspect` requires `liveness === "dead"`, `deadReseed`
  requires `dead`, and the `dead-session` bound requires `dead`. A forced clear can still stand on its OTHER
  written bounds (`retry-budget` / `stale`), which is the truth R7.11's comment now states.
- Arms:
  - "R4.2: a reseeded seat whose recorded session is NOT live is reported `suspect` with its age" — fixture
    now resolves `CAPTAIN_SESSION`, target absent -> `dead` (direction: anchor resolved + target absent).
  - "R7.3: a PRESENT registry that cannot resolve the captain anchor is UNKNOWN, never `dead`" — capability
    true, anchor unresolved -> `unknown`, no suspect, no closed seat (direction: capability true only).
  - "R4.2: an ABSENT agents registry is UNKNOWN" — capability false -> `unknown`.
  - `dispatch-unfence.test.ts` dead-reseed arms now include `CAPTAIN_SESSION` in `liveSessions`; the
    `supervise-lossless` fake registry gained an `agents.get` (the real adapter's identity seam) so its
    perceived-dead premise stays provable.

## Commands + observed results (final run, 2026-11-10T08:40Z)

| Command | exit | Observed |
|---|---|---|
| `node scripts/build-mpd-client.ts` (twice) | 0 | 908071 bytes both times, sha256 `5a1222f5…` (byte-identical) |
| `node scripts/verify-vendor.ts` | 0 | `PASS - 8 shipped asset(s) fingerprinted` |
| `node scripts/repin-vendor.ts --check` | 0 | `GREEN - lock matches the working tree (drift=0, problems=0)` |
| `bun run typecheck` | 0 | `$ tsgo --noEmit` (no output) |
| `bun test packages/mpd-cellwork-plugin` | 0 | 311 pass / 0 fail, 30 files |
| `bun test packages/mpd-team-core-plugin` | 0 | 633 pass / 0 fail, 45 files |
| `bun test packages/mpd-tui-plugin` | 0 | 698 pass / 1 skip / 0 fail, 31 files |
| `bun test packages/mpd-bundle-plugin` | 0 | 331 pass / 0 fail, 15 files |
| `bun run verify:comments` | 0 | `VERDICT: PASS — …56627 declaration(s)…` |
| `node scripts/verify-dist-fresh.ts` | 0 | `ok: 34/34 targets fresh … 1 NOT COVERED` |
| `bun run verify:docs` | 0 | `pairs=59 failed=0 violations=0 … PASS` |
| `bun run verify:rows` | 0 | `ok: 36 row ids match the 2-file bundle patch layer` |
| `PATH=.qa-tmp/dsh-022/bin bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | 0 | `PASS` |
| `PATH=.qa-tmp/dsh-022/bin node skills/dsh-qa/scripts/preset-conformance.ts` | 0 | `PASS` |
| `PATH=… MPD_DSHGO_KIT=… bun run verify:gates` | 0 | `PASS - 11/11 member gate(s) green` |

## Artifact hashes (rebuilt with `.toolchain/node_modules/.bin/bun` from the repo root)

- `packages/mpd-cellwork-plugin/dist/index.js` `a7b82567000ac8b66ba4b883d6ded473633d12fbd8cf0727b12cc9a514170354`
- `packages/mpd-team-core-plugin/dist/index.js` `abafd2250ff61d77eb7f2ae1f712620d1d27dc366e0302f66cab21d5000eb607`
- `packages/mpd-tui-plugin/dist/index.js` `d48d76064e052cdc8c6ce8968bb15b1b2e315b18c011af0d4e36058b31b331bf`
- `packages/mpd-bundle-plugin/client.js` `5a1222f53a95cb7dd2b0b8ae258708b87045dd6ed7419e6cc245e303a5a554c4`
- `packages/mpd-bundle-plugin/dist/index.js` UNCHANGED (team-view.ts reaches only the spliced client).

## Final addendum

- The stop hook is wired at `packages/mpd-cellwork-plugin/src/index.ts:705` (runs for a forced stop too);
  its comment now names the interruption half. That edit is a comment only and the cellwork dist hash is
  unchanged (`bun build` strips comments) — `verify-dist-fresh` re-run: 34/34 fresh.
- Re-ran after that last edit: `bun test packages/mpd-cellwork-plugin` 311/0, `bun run typecheck` 0,
  `bun run verify:comments` PASS, `verify:gates` 11/11 PASS, `bundle-lifecycle` PASS, `preset-conformance`
  PASS.
- Not run by this writer: `verify:docker` (release sweep only) and `bun run verify:pack-closure` (no pack
  was produced). `client.js` is outside `verify-dist-fresh`'s target list (it prints as NOT COVERED only
  for `mpd-mcp-codegraph/dist/serve.js`), so its freshness is evidenced by the two byte-identical builds
  plus the vendor fingerprint check.
