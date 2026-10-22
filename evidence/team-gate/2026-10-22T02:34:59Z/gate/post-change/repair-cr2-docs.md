# Repair — CodeRabbit round-2 finding: qualify the activation-release wording (T16)

Task **T16** (repair, owner Senior Engineer), 2026-10-22. Documentation + one model-facing
description; **no logic change**.

## Finding (CR round 2, Minor)

`packages/mpd-workmate-plugin/README.zh-CN.md` line 58 stated that the activation is released
after the report **unconditionally**. That is true on the `startActivation` generation, but the
adapter's RETIRED `start` fallback returns only `run.result` — there is no activation handle and
nothing to dispose. Source: `.mpd/tmp/cr-round2.md`, comment fingerprint
`cr-comment:v1:6129227b1a588d5f1818a833`.

## Fix (workmate package only)

- `README.zh-CN.md`, `mpd_workmate_spawn` row — applied CR's suggested text:
  「在支持 `startActivation` 的宿主上，报告落定后 activation 即被释放；旧版 `start` 回退路径
  不提供 activation，持久连续性保存在 workmate **记录**中，而不是子会话」.
- `README.md`, `mpd_workmate_spawn` row — same qualifier in English:
  "on a host exposing `startActivation` the activation is disposed once the report settles (the
  retired `start` fallback has none to dispose), and durable continuity lives in the workmate
  record, not the child session".
- `src/index.ts`, `mpd_workmate_spawn` **description** — qualified rather than left, because the
  three surfaces would otherwise contradict each other in the SAME package:
  "On a host exposing `startActivation` the adapter disposes that activation once the report settles
  (the retired `start` fallback is inherently one-shot), so the consult is NOT reused: …".
  The clause costs ~90 chars on a ~1.1 KB description — precision, not bloat — and keeps the
  operative instruction (one-shot, not reused, continuity in the RECORD) true on BOTH generations.

Durable-continuity-in-the-record wording preserved in all three places, as required.

## Scope finding — the same claim is still unqualified elsewhere (NOT edited here)

T16's write scope is the workmate package, so these were reported, not touched:

- `packages/mpd-dsh-adapter-plugin/README.md` ("`spawnAgent` disposes the exact activation once
  the report settles"). Suggested qualifier: "…once the report settles on a host that exposes
  `startActivation` (the retired `start` fallback returns only `run.result`, with no activation to
  dispose)".
- `packages/mpd-roles-plugin/README.md` line 31 and `README.zh-CN.md` line 24 ("disposes the
  activation once the report settles"). Suggested qualifier: "on a host exposing
  `startActivation` …; the retired `start` fallback has none".

Both are teammate-owned files; the captain routes the wording (same pattern as the R2 roles/preset
proposals).

## Gates (observed, quoted)

- `bun run verify:docs` → **exit 0**:
  `[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=49 failed=0 violations=0 exempt=24 derived=3 links=440 dead=0 — PASS`
- `.toolchain/node_modules/.bin/bun test packages/mpd-workmate-plugin` → **51 pass, 0 fail**,
  577 expect() calls, 4 files.
- `.toolchain/node_modules/.bin/bun run verify:comments` → **PASS**:
  `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.`
- `node scripts/verify-dist-fresh.ts` → **FAIL, 1 of 33 stale**:
  `packages/mpd-workmate-plugin/dist/index.js` (committed 119147 B vs fresh 119248 B), i.e. exactly
  this description edit. `dist/**` belongs to Integration (T-88); NOT rebuilt here.

## Not touched

No `packages/mpd-dsh-adapter-plugin/**`, no `packages/mpd-roles-plugin/**`, no `dist/**`, no
`skills/**`, no git write command.
