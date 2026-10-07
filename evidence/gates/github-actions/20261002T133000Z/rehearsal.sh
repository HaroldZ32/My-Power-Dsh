#!/usr/bin/env bash
# CI REHEARSAL — every step of .github/workflows/gates.yml, run on THIS machine in the shape a
# GitHub runner has: a fresh `bun install --frozen-lockfile`, a globally installed harness at the pin
# `package.json` declares, and the pinned upstream checkout the vendor gate needs. The point is to
# reproduce the RUNNER's preconditions rather than the developer's, because the workflow's two
# measured failures (a stale lockfile, and two gate members that read state a bare runner lacks) were
# invisible on a machine that already had a warm `node_modules` and a `dsh` on PATH.
#
# WHAT IT DOES NOT DO: it does not run on GitHub. It reproduces the COMMANDS and asserts their exit
# codes; the runner-specific parts (actions/checkout, actions/setup-node, oven-sh/setup-bun) are
# replaced by this machine's equivalents, and the bun version is the WORKFLOW'S PIN (1.4.0), not the
# newest one, because `verify-dist-fresh` compares BYTES against dists that bun 1.4.0 built.
#
# Usage: bash evidence/gates/github-actions/<stamp>/rehearsal.sh
# Exit:  0 every step exited as the workflow requires; 1 at least one did not.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORK="$REPO/.mpd/ci-rehearsal"
BUN140="$REPO/.mpd/tmp-cache/bun140/bun-linux-x64"
LOG="$REPO/evidence/gates/github-actions/20261002T133000Z/step-exits.tsv"

mkdir -p "$WORK"
: > "$LOG"

# The workflow pins bun 1.4.0 (the recorded build toolchain); fail loudly if it is absent rather than
# silently rehearsing with a different bun, which would redden `verify-dist-fresh` for the wrong reason.
if [ ! -x "$BUN140/bun" ]; then
  echo "FATAL: bun 1.4.0 not staged at $BUN140 (download it before rehearsing)" >&2
  exit 1
fi
export PATH="$BUN140:$PATH"
export BUN_INSTALL_CACHE_DIR="$REPO/.mpd/tmp-cache/bun"
export npm_config_cache="$REPO/.mpd/tmp-cache/npm"

step() {
  local id="$1"; shift
  echo ""
  echo "===== STEP $id ====="
  echo "\$ $*"
  "$@"
  local code=$?
  printf '%s\t%s\n' "$id" "$code" | tee -a "$LOG"
  echo "[step $id] exit=$code"
  return $code
}

overall=0
run() { step "$@" || overall=1; }

echo "bun on PATH: $(bun --version) (workflow pin 1.4.0)"

# ── 1. actions/checkout + setup-node + setup-bun + `bun install --frozen-lockfile` ───────────────
run 01-bun-install bun install --frozen-lockfile

# ── 2. the harness the row-config gate validates against, at the PIN package.json DECLARES ───────
# The workflow derives this rather than restating it; the rehearsal does exactly the same, so a
# divergence between the workflow and this script cannot hide behind a hardcoded version.
HARNESS_VERSION="$(node -p "require('$REPO/package.json').dependencies['@deepseek-ai/dsh-experimental-agent-team']")"
echo "harness pin read from package.json: $HARNESS_VERSION"
rm -rf "$WORK/prefix"
run 02-harness-install npm i -g --prefix "$WORK/prefix" "@deepseek-ai/dsh@${HARNESS_VERSION}"
export PATH="$WORK/prefix/bin:$PATH"
command -v dsh >/dev/null || { echo "FATAL: dsh is not on PATH after the install"; exit 1; }
run 03-harness-version dsh --version

# ── 3. the pinned upstream baseline (the vendor gate's subject) ──────────────────────────────────
UPSTREAM_SLUG="$(node -p "require('$REPO/VENDOR_LOCK.json').upstream")"
UPSTREAM_SHA="$(node -p "require('$REPO/VENDOR_LOCK.json').upstreamCommitSha")"
rm -rf "$WORK/upstream"
mkdir -p "$WORK/upstream"
git -C "$WORK/upstream" init -q
git -C "$WORK/upstream" remote add origin "https://github.com/${UPSTREAM_SLUG}"
run 04-upstream-fetch git -C "$WORK/upstream" fetch -q --depth 1 origin "$UPSTREAM_SHA"
run 05-upstream-checkout git -C "$WORK/upstream" checkout -q FETCH_HEAD
export MPD_UPSTREAM_ROOT="$WORK/upstream"
echo "upstream baseline at $(git -C "$WORK/upstream" rev-parse HEAD)"

# ── 4. the gate steps, in the workflow's order ───────────────────────────────────────────────────
run 06-verify-gates bun run verify:gates
run 07-plugin-manifest node scripts/verify-plugin-manifest.ts
run 08-comment-coverage node scripts/verify-comment-coverage.ts

echo ""
if [ "$overall" -eq 0 ]; then
  echo "[rehearsal] PASS — every workflow step exited 0"
else
  echo "[rehearsal] FAIL — at least one workflow step exited non-zero (see $LOG)"
fi
exit "$overall"
