# Candidate integration evidence

The product commit is `532520024568a3dcb56635d55576520c679078d5`. At final digest collection the tracked working tree matched that commit. The candidate is `.mpd/artifacts/team-first-routing/532520024568/mpd-dsh-mpd-0.21.0.tgz` (7,672,140 bytes, SHA-256 `ed7ff9d1fd49f7ddb6162a698ab618546a7410b0c5a079d1e00fe459201f9308`). The digest and normal-profile install handoff went to the independent verifier for T4. See [candidate.json](./candidate.json).

## Rebuild and gates

The first `node scripts/verify-dist-fresh.ts` run exited 1 and named 21 stale shared-adapter inliners. T5 rebuilt just those targets from the repository root with `.toolchain/node_modules/.bin/bun build <src> --target node --format esm --outfile <dist>`. The workmate repair author later rebuilt its own final entry. After that repair, the gate exited 0 with `35/35 targets fresh (each rebuilt twice, byte-identical)`. The remaining prebuilt CodeGraph dist is listed outside the rebuild census. Its fingerprint and the seven other vendor assets passed `node scripts/verify-vendor.ts` (exit 0).

Tool versions were Bun `1.4.0` from the repository pin, DSH `0.2.2-rc.5` from `.qa-tmp/dsh-022/bin`, Node `v24.21.0` and npm `11.19.0`. The aggregate prefixed the pinned DSH and Bun directories and set `MPD_DSHGO_KIT=$PWD/.mpd/tmp-dshgo/kit`. The final package suite prefixed only pinned DSH, invoked pinned Bun by explicit path, and used a separate `/tmp/mpd-team-first-unit.*` for fixtures.

| Command | Exit | Observed result |
|---|---:|---|
| `node scripts/verify-dist-fresh.ts` | 0 | 35/35 fresh. |
| `.toolchain/node_modules/.bin/bun run verify:gates` | 0 | 11/11 green, including docs, comments, manifest and DSH Go. |
| `.toolchain/node_modules/.bin/bun run typecheck` | 0 | TypeScript check passed. |
| `.toolchain/node_modules/.bin/bun test ./packages` | 0 | 4,264 passed, 6 skipped, 0 failed across 274 files. Skips were two SVN CLI cases, one real-team projection and three optional comment detector cases. |
| `.toolchain/node_modules/.bin/bun run test:qa` | 0 | 56 passed, 2 skipped, 0 failed. The TUI distribution and spec-conformance fixtures were absent. |
| `git diff --check` | 0 | No whitespace findings. |

The first package run added the Bun toolchain directory to `PATH`. It exited 1 with 4,261 passes and one failure, `REAL toolchain probe: ast-grep passes, the deprecated sg wrapper fails`. At `packages/mpd-mcp-shared/bin-resolve.test.ts:474`, `expect(probeAstGrep(join(binDir, "sg"))).toBe(false)` reported `Expected: false`, `Received: true`. The deprecated wrapper could find `ast-grep` on that added path. The targeted test exited 0 with only pinned DSH prefixed. The final full run used that same environment and included the settled workmate repair.

Raw log digests, with bulk output in the ignored workspace `.mpd/team-first-routing-integration/raw/`:

| Log | SHA-256 |
|---|---|
| `tests.log` (first failure) | `348bec29c792adf544eb0cd4ff9110a31ff55ceee037fe192a9d2158e9b18267` |
| `ast-probe-recheck.log` | `e4736966e20e281724e2cdeb4697bfd778aabdc1efc703e52744832b64cad1af` |
| `dist.t8.log` | `19b462bb85fdd3569cb4223bec18b847f1bbf0bfac36b13a5422455ba974bbc0` |
| `gates.final.log` | `5bab02de5720be91a1906f4c992b5715a68e3033145d99352fb2ab9cf9a76cc6` |
| `typecheck.final.log` | `ae47736bb2a9401aa9743893f2f64b9a605e65a99d78cd991a8021e0f7722d87` |
| `tests.final.log` | `4e165a952a257195ca78ab13a2caee73ec53116cab5dd621a9b8added871554d` |
| `qa.final.log` | `f0d4166ae83f73558da70675a92e3e44303b952939977b1298c34213d394cc63` |
| `closure.final.log` | `fd137a9d4799d5f8aaa000a95b4c965d93298b2c30051151c3101712468fd965` |

## Pack provenance and controls

1. Extracted `git archive --format=tar 532520024568a3dcb56635d55576520c679078d5 -- . ':(exclude)evidence'` into an isolated scratch directory. This takes packer input from tracked files and excludes project evidence and local state.
2. Ran the exported `node scripts/pack-mpd.ts --out <scratch>/staged` (exit 0). Ran the exported `node scripts/verify-pack-closure.ts --source-root <scratch>/source --packed <scratch>/staged --require-packed --pack-stamp 2026-11-22T18:16:33.801288172Z` (exit 0). Closure found 30/30 declared packages, 672/672 compared bytes identical, 0 drift and 0 missing required files. One declared QA-only exemption applied.
3. Ran `npm pack --ignore-scripts --cache <scratch>/npm-cache --pack-destination <scratch>/tar --json <scratch>/staged` (exit 0). The isolated cache is required here because the baseline dry run reported `EROFS` for npm's default home cache.
4. Checked every tar member against the npm JSON report and staged bytes, including archive SHA-1 and SHA-512 integrity. Of 681 members, 679 match their committed source bytes. The packer generated `packages/mpd-ext-plugin/dist/validator.js` and rewrote `package.json`. npm omitted four git/npm ignore metadata files. The tar contains regular files with package-relative paths. The membership check excludes local runtime, operator scratch, evidence, credentials and untracked files. The previous repair tarball kept SHA-256 `b04e85c0ea7cf4bdd6f6c27bfc878299063eda3961c17d89008e706a49383f03`.

Rootless Docker was available. T5 used the tracked-snapshot gates and handed off the exact tarball for the independent isolated installer and runtime replay in T4.
