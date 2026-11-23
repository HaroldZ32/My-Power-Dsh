# Interim integration build

Checkout `fix/team-and-audit-recovery`, base `e86764c0e09b`, timestamp window 2026-11-22 16:07–16:12 UTC. Bun 1.4.0 (`34cbb9a40`) from the root toolchain and Node v24.21.0. Runtime and packaging writers were active during this pass. See `rebuild.md` and `targets.tsv` for the settled-source recipe and inventory.

## Rebuild and pack results

| Command or check | Exit | Observation |
| --- | ---: | --- |
| Two canonical Bun AST builds, then `node scripts/verify-dist-fresh.ts --only mpd-mcp-astgrep` | 0 | Both outputs fresh. `launch.js` SHA-256 `d19facff3ead94a8b31e9cacd8b6e08830492cc9f393a3d0650e89cf70fd3460`. `cli.js` SHA-256 `0f8797a480cc431fa77dcff06f3555a8ef478a4ff4863ebf28434aaeab29ef1b`. Captain and packaging notified. |
| Initial `node scripts/verify-dist-fresh.ts --json` after AST | 1 | 28 stale out of 35. |
| Canonical Bun build for all targets from `targets.tsv` | 0 | 35 builds succeeded at the times they ran. |
| Subsequent `node scripts/verify-dist-fresh.ts` | 1 | Concurrent source work overtook the build. One sample found a workmate build failure and the follow-up reported changed workmate bytes. After rebuilding it, 32/35 were fresh, with bundle, cellwork and modelchain stale in that sample. |
| `node scripts/build-mpd-client.ts` and `node --check` on both browser files | 0 | Combined SHA-256 `5a1222f53a95cb7dd2b0b8ae258708b87045dd6ed7419e6cc245e303a5a554c4` matched the pin when built. It began with all 196,984 bytes of the adopted browser client, SHA-256 `5148bdcb0a838b04bda00703283e94b3d3abad2243dab2befca7ee4bd941f488`. |
| Pinned Bun tests for browser artifact, settings, sidebar, team page, team push and workbench suites | 0 | 152 pass, 0 fail across 7 files. |
| `./.toolchain/node_modules/.bin/bun test ./packages/mpd-bundle-plugin/test` | 1 | 328 pass, 3 fail across 15 files. The source-level DSH-Go panel failures cover the save-memory toast, ready-task text and dispatch action. |
| `node scripts/pack-mpd.ts --out <fresh scratch>/mpd-package` and `node scripts/verify-pack-closure.ts --packed <same path> --require-packed --pack-stamp <cut time>` | 0 | Generated 9-export validator shim. Closure saw 30/30 declared packages, 675/675 identical bytes, 0 drift, 0 expected-after-pack and 0 absent files. The roles-probe distribution was the single declared exemption. Scratch removed. |
| `node scripts/verify-pack-closure.ts --require-packed` and `--self-test` against the existing canonical pack | 1 | Existing canonical stage has 12 manifest omissions across engines, SDK, platform AST packages and sidebar peer metadata. Self-test passed 41/43, with both failing positive controls using that older artifact. Re-stage before final closure self-test. |

The sole uncovered package artifact is CodeGraph `dist/serve.js`, with SHA-256 `ab287cdc058f031cf59347e49dbeecdd2d7d3c08b206c33c13d69d14b0128375` before and after the rebuild, matching `VENDOR_LOCK.json`. The canonical pack, installed profiles and production source were outside this pass’s write scope. No installed harness smoke or independent final verification is claimed here.

## Second pass on the requested subset

The captain requested a second pass while team, config and UI sources continued changing. The pinned Bun build exited 0 for 13 outputs. The freshness check rebuilt each covered target twice and found 12/13 fresh within this subset. `mpd-mcp-lsp/dist/launch.js` was stale because the LSP writer was still editing diagnostics and requested that further rebuilds wait for the final pass. The extension index and SDK were fresh at this sample. Both extension and LSP should be rebuilt in the settled sweep.

| Source group | Fresh outputs at the second sample |
| --- | --- |
| User data | Memory and hashline index bundles |
| Autoproject, goal and cellwork | All three index bundles |
| Developer tools | CodeGraph plugin index, AST CLI and launcher, CodeGraph launcher and Git/shell launcher |
| Extensions | Index bundle and SDK |

The same check reported four stale outputs outside this subset: bundle, config, modelchain and team core. The two prebuilt hashes above still matched and `git diff --check` on the derived paths exited 0. The second pass did not regenerate browsers or a pack while the remaining source writers continued.

## Root test dependency investigation

Corrected discovery includes the skill regression and excludes historical evidence and packed copies. `./.toolchain/node_modules/.bin/bun test ./skills/programming/scripts/typescript/check-no-excuse-rules.test.ts` initially exited 1 at collection with `Cannot find module 'typescript/package.json'` at line 17. `typescript5/package.json` resolved to 5.9.3 and the existing `@typescript/native-preview` package exposed both required `unstable` API entry points.

An isolated exact test copy with TypeScript 5.9.3 under the conventional name collected all three tests and exited 1, 0 pass, 3 fail. The two caller cases hit the TypeScript 7 API guard and the third case expected an obsolete diagnostic. The bare root suite sampled during the temporary TypeScript 5 dependency change exited 1 with 4,231 pass, 6 skip and 16 fail across 278 files, including those three skill tests. Other failing tests were under active source ownership.

The minimal validated fix reuses the existing native preview dependency. The skill fixture resolves `@typescript/native-preview/package.json`, creates `callerDir/node_modules/@typescript`, symlinks the package as `callerDir/node_modules/@typescript/native-preview`, and asserts `cannot resolve the TypeScript 7 API from the caller project` for the missing-dependency case. A scratch test with those exact fixture changes exited 0, 3 pass, 0 fail, with 9 assertions. The captain, packaging owner and single skills owner received the finding. Packaging confirmed removal of its temporary regular TypeScript 5 dependency and regeneration of the lockfile. Scratch copies were removed by their invocations.
