#!/usr/bin/env bash
# REBUILD the 17 adapter-DEPENDENT consumer dists invalidated by the adapter-src change.
#
# OWNERSHIP: these paths are NOT in the adapter task's inScope (T-88: `packages/*/dist/**`
# belongs to the integration task's inScope at plan time, and a lane must not declare a
# `dist/**` pattern for itself). Running this script is the WORK of the amendment the
# captain has to land — it is prepared here so the remedy is one command, and it writes
# nothing until someone with the amended scope runs it.
#
# WHY IT IS NEEDED (measured, see dist-invalidation-proof.txt):
# every mpd plugin resolves the adapter through the AGENTS.md §6 idiom
#   `const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)`
# so its `src/index.ts` imports `../../mpd-dsh-adapter-plugin/src/index` and bun BUNDLES the
# adapter's TS source into that package's own `dist/index.js`. Changing the adapter src
# therefore changes all 17 consumer builds; with HEAD's adapter src each of them rebuilds
# byte-identically to its committed bytes (proved for mpd-roles-plugin and mpd-tools-plugin),
# so the invalidation is caused by this change and nothing else.
#
# The canonical form is the repo-root path-qualified one (AGENTS.md §6); a package-directory
# build is flagged STALE by the gate because bun writes module paths relative to cwd.
set -euo pipefail
cd "$(cd "$(dirname "$0")/../../../.." && pwd)"

TARGETS=(
  packages/mpd-bootstrap-plugin
  packages/mpd-boulder-plugin
  packages/mpd-codegraph-plugin
  packages/mpd-comment-checker-plugin
  packages/mpd-config-plugin
  packages/mpd-ext-plugin
  packages/mpd-hashline-plugin
  packages/mpd-memory-plugin
  packages/mpd-modelchain-plugin
  packages/mpd-qa-roles-probe
  packages/mpd-roles-plugin
  packages/mpd-team-compact-plugin
  packages/mpd-team-watchdog-plugin
  packages/mpd-tools-plugin
  packages/mpd-tui-plugin
  packages/mpd-ulw-plugin
  packages/mpd-workmate-plugin
)

echo "[rebuild] $(sha256sum packages/mpd-dsh-adapter-plugin/src/index.ts)"
for pkg in "${TARGETS[@]}"; do
  echo "[rebuild] $pkg"
  bun build "$pkg/src/index.ts" --target node --format esm --outfile "$pkg/dist/index.js"
done

echo "[rebuild] verify-dist-fresh:"
node scripts/verify-dist-fresh.mjs
echo "[rebuild] done — the gate above must read: PASS"
