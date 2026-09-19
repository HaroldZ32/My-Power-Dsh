#!/usr/bin/env bash
# MEASUREMENT (read-only): which packages/*/dist targets the adapter-src change invalidates.
#
# WHY THIS EXISTS: every mpd plugin resolves the adapter through the AGENTS.md §6 idiom
#   `const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)`
# so their `src/index.ts` imports the adapter's TYPESCRIPT SOURCE
# (`../../mpd-dsh-adapter-plugin/src/index`) and bun BUNDLES that source into each package's
# own `dist/index.js`. Editing the adapter src therefore changes every consumer's fresh build,
# and `node scripts/verify-dist-fresh.mjs` reports each committed consumer dist as STALE.
#
# This script proves the two sets are the same set, twice over:
#   A. the gate's STALE list (from the captured log, or a fresh run), and
#   B. the entries whose FRESH build actually embeds adapter code (grepped for the
#      adapter's own error/message prefix), and
#   C. byte-causality: with HEAD's (pre-change) adapter src, a consumer dist rebuilds
#      byte-identically, so the staleness is caused by THIS change and nothing else.
#
# Usage: bash measure-dist-invalidation.sh [path-to-gate-log]
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$(cd "$(dirname "$0")" && pwd)"
LOG="${1:-$OUT/dist-fresh-after-adapter-src.log}"
cd "$ROOT"

echo "# adapter-src → consumer-dist invalidation (measured $(date -u +%Y-%m-%dT%H:%M:%SZ))"
echo "# repo: $ROOT"
echo "# adapter src sha256: $(sha256sum packages/mpd-dsh-adapter-plugin/src/index.ts | cut -d' ' -f1)"
echo "# committed adapter dist sha256: $(sha256sum packages/mpd-dsh-adapter-plugin/dist/index.js | cut -d' ' -f1)"
echo

echo "## A. verify-dist-fresh STALE set (from $LOG)"
if [ -f "$LOG" ]; then
  grep -E "^  (STALE|FRESH)" "$LOG" | sed -E 's/ — .*//' || true
else
  echo "(no log; run: node scripts/verify-dist-fresh.mjs)"
fi
echo

echo "## B. entries whose FRESH build embeds adapter code (grep for the adapter's message prefix)"
embeds=0
for entry in packages/*/src/index.ts; do
  [ -f "$entry" ] || continue
  pkg="$(echo "$entry" | cut -d/ -f2)"
  tmp="$(mktemp)"
  if ! bun build "$entry" --target node --format esm --outfile "$tmp" >/dev/null 2>&1; then
    echo "BUILD-FAILED  $pkg"
    rm -f "$tmp"
    continue
  fi
  if grep -q "mpd-dsh-adapter:" "$tmp"; then
    echo "EMBEDS-ADAPTER $entry"
    embeds=$((embeds + 1))
  else
    echo "no-adapter     $entry"
  fi
  rm -f "$tmp"
done
echo "# entries embedding adapter code: $embeds"
echo

echo "## C. byte-causality: rebuild a consumer with HEAD's adapter src"
scratch="$(mktemp -d)"
mkdir -p "$scratch/packages/mpd-dsh-adapter-plugin/src"
git show HEAD:packages/mpd-dsh-adapter-plugin/src/index.ts > "$scratch/packages/mpd-dsh-adapter-plugin/src/index.ts"
echo "# HEAD adapter src sha256: $(sha256sum "$scratch/packages/mpd-dsh-adapter-plugin/src/index.ts" | cut -d' ' -f1)"
for pkg in mpd-roles-plugin mpd-tools-plugin; do
  mkdir -p "$scratch/packages/$pkg"
  cp -r "packages/$pkg/src" "$scratch/packages/$pkg/src"
  ( cd "$scratch" && bun build "packages/$pkg/src/index.ts" --target node --format esm --outfile "$scratch/$pkg.js" ) >/dev/null 2>&1
  rebuilt="$(sha256sum "$scratch/$pkg.js" | cut -d' ' -f1)"
  committed="$(sha256sum "packages/$pkg/dist/index.js" | cut -d' ' -f1)"
  if [ "$rebuilt" = "$committed" ]; then
    echo "IDENTICAL $pkg: HEAD-adapter rebuild == committed dist ($committed)"
  else
    echo "DIFFERS   $pkg: HEAD-adapter rebuild $rebuilt != committed dist $committed"
  fi
done
rm -rf "$scratch"
echo

echo "## D. the exact canonical rebuild commands (extracted from the gate's own STALE lines)"
if [ -f "$LOG" ]; then
  grep -E "^  STALE" "$LOG" | sed -E 's/.*: (bun build .*)$/\1/' | sort -u
fi
