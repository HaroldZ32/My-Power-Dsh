# SRC FREEZE — frozen revision for the final PTY capture

Declared: 2026-10-06 ~22:20Z by the captain (integration task).
Reason: every write lane reported done; a capture before this point measured a build that predates the code.

## Artifacts (sha256, byte size)
packages/mpd-tui-plugin/dist/index.js                c8b87a32dafde0c9  368228 bytes
packages/mpd-bundle-plugin/client.js                 2fbd0e26da6e898c  640774 bytes
packages/mpd-team-core-plugin/dist/index.js          a6b96536dbfdf3bf  136550 bytes

## Build commands (repo root, pinned toolchain)
  ./.toolchain/node_modules/.bin/bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js
  ./.toolchain/node_modules/.bin/bun build packages/mpd-team-core-plugin/src/index.ts --target node --format esm --outfile packages/mpd-team-core-plugin/dist/index.js
  node scripts/build-mpd-client.ts    # writes packages/mpd-bundle-plugin/client.js (Bun cannot run this one)

## Gate state at the freeze
  verify-dist-fresh : ok 29/29 fresh
  tsgo --noEmit     : 0 errors
  verify:comments   : PASS (405 files, 33852 declarations)
  bun test ./packages: 1780 pass / 3 skip / 2 fail (both panel-surface's recorded offset-accumulation arms)
