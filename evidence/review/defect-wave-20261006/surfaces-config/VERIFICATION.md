# `fix/surfaces-config` — the verification record

Findings S1–S9 and the red gates G1–G5 of `../FINDINGS.md`. Every number below was measured by the
captain on the branch tip **after both writers stopped and after the wave's single re-pin** — not quoted
from a writer's report.

Baseline `dev` @ `82f7663e`. Branch `fix/surfaces-config`. Measured 2026-10-06.

## Measured on the branch tip

| Check | Was (baseline) | Now |
|---|---|---|
| `bun run test:qa` | **FAIL — 3 of 48** | **`all self-tests passed`** (48/48), exit 0 |
| `bun run typecheck` | **FAIL — 4 errors** | **exit 0** |
| `node scripts/verify-pack-closure.ts` | **FAIL — 2 TREE-DRIFT** | **ok — 0 TREE-DRIFT, 0 drift, 0 expected-after-pack** |
| `bun run verify:gates` | FAIL 1/8 (vendor) | FAIL 1/8 (vendor) — **the same and only** member |
| `node scripts/verify-dist-fresh.ts` | — | `ok: 29/29 targets fresh (each rebuilt twice, byte-identical)` |
| `bun run verify:comments` | — | `VERDICT: PASS` |
| `bun run verify:docs` | — | `pairs=45 failed=0 violations=0 dead=0` PASS |
| `node scripts/verify-rows-parity.ts` | — | `ok: 33 row ids` |
| `node scripts/verify-no-host-override.ts` | — | `PASS: every id-target is bundle-owned` |
| `node scripts/verify-manual-paths.ts` | — | `PASS resolved=142` |
| `bun run verify:manifest` | — | `VERDICT: PASS` |

Suites (captain-run, after both writers stopped): config **94**, adapter **182**, ext **77**,
workmate **46**, tui **222**, codegraph **12**, bundle **141** — **774 pass, 0 fail**.

## The three stale QA cases — which side moved, and the proof

Each was diagnosed rather than made to pass. **In all three it was the CASE that was stale, not the
code** — which is exactly why a green-versus-red reading alone would have misled.

- **G1 `bundle-lifecycle`** asserted a column-0 `- id: agent-preset-registry` that `9e91beb3`
  (zero host overrides, dev-only) deliberately REMOVED, because the id is HOST-owned and
  `verify-no-host-override.ts` fails such a row.
  **Falsifier proven end-to-end**: appending the id-target to the REAL `cordis.patch.yml` made the case
  exit 1 naming it; the file was restored byte-identically (sha256 compared before and after).
- **G2 `extension-lifecycle`** demanded `/FATAL/` on the row's **stdout**. R5 ("no MPD diagnostic may
  reach the terminal") landed later and is itself gated by
  `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` — so a row satisfying the OLD case
  would FAIL the R5 gate. The two are in direct conflict and R5 wins.
  **Falsifier, both directions**: removing the log append reddens the file half; adding ONE `console.log`
  on the FATAL path reddens the terminal half while the file half stays green.
- **G3 `preset-register`**'s fixture still named `packages/mpd-mcp-gitbash/dist/cli.js`; `7c1076f3`
  rewrote that operand to `dist/launch.js` and the other three rows already read `dist/launch.js`. The
  legacy `cli.js` still exists on disk AND is a pinned single-file VENDOR_LOCK asset — which is exactly
  why the loop's `existsSync` leg passed and only the operand match failed.

## G4 — resolution, not exclusion

The 4 `tsgo` errors were all in the vendored `skills/programming/scripts/typescript/check-no-excuse-rules.ts`
(`TS2307 Cannot find module 'typescript/unstable/{ast,async}'`, one implicit `any`). The skill targets a
TypeScript 7 build exposing `unstable/*`, and `tsconfig.json` includes `skills/*/scripts/**/*.ts`.

The loader now tries the caller's own `typescript` FIRST and `@typescript/native-preview` second, and a
new `typescript-unstable.d.ts` maps the same two specifiers on the TYPE side. **Nothing was excluded from
the tsconfig program** — an exclusion was the stated fallback, not the choice.

## The wave's single `VENDOR_LOCK` re-pin (§9)

The `skills/**` edits invalidated the corpus `treeSha`, so the re-pin lands in the SAME commit as the
change that invalidated it — a captain step (`repin-vendor.ts --write` refuses without
`--i-know-this-is-the-captains-step`).

```
skills.fileCount  334 -> 335
skills.treeSha    501534fa38c273a31a42dae9c1977b2da28803fd0880b9597b52bd176f2b0244
               -> f8d30d9665d8ca98fb9f6e052d996b03c15c407840fea5e08ec775022b3cdfb1
_deps             already in sync
```
A dry run after the write reports `0 asset(s) would be re-pinned`. This is the wave's ONE re-pin.

## G5 — the local pack

`npm run pack` → `node scripts/verify-pack-closure.ts` exit 0:
`0 TREE-DRIFT · content bytes 1234 compared / 1234 identical / 0 drift · pack stamp
2026-10-06T13:09:24.542Z` (was `2026-10-04T04:11:29.290Z` with 2 TREE-DRIFT entries).
`dist/mpd-package` is **gitignored** (`.gitignore:12`), so this is a local artifact and produces no
commit. `VENDOR_LOCK.json` is NOT a packed asset (the gate's own root-asset list confirms it), so the
re-pin did not invalidate the pack.

**Integration bound**: the pack is DERIVED from the source tree, so a re-pack inside ONE branch is
current only for THAT branch's tree. After all three branches merge, **one more `npm run pack` must land
at integration** — three divergent trees cannot share one green pack.

## Named residuals (stated, not glossed)

1. **S7** — the `"requested"` state (bound seam, host exposes no panel read-back) still prints the
   "no panel seam" sentence. Pre-existing, outside S7's wording.
2. **The real arms of the G cases remain red in this sandbox** for pre-existing/environmental reasons:
   `extension-lifecycle`'s real run finds no `tool/call` evidence for `mpd_ext_list`, and
   `bundle-lifecycle`'s real install dies on `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (a read-only pnpm
   store under this sandbox). Both reproduce on evidence predating this wave. **Do not read them as
   pass** — the `--self-test` arms are what this branch turns green.
3. `verify-vendor` cannot run at all here (no `MPD_UPSTREAM_ROOT`); it is the only member that reddens
   `verify:gates`.
4. The adapter's `S3` change keeps the fallback SEMANTICS deliberately — the finding was about the
   silence, not about removing the fallback.

## Build toolchain (same trap as the other branches)

`verify-dist-fresh.ts` compares against the PINNED toolchain. PATH bun here is **1.4.2** and renders the
committed dists STALE; the pinned **1.4.0** is `.toolchain/bun/bin/bun`. The adapter edit fanned out to
**22 stale dist targets** (plus `packages/mpd-bundle-plugin/client.js`), all rebuilt with the pin.
