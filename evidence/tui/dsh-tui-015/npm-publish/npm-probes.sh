#!/usr/bin/env bash
# npm-probes.sh — the npm-side measurements the workflow's two corrections rest on.
#
# Every claim in .github/workflows/publish.yml that is NOT about this repository's own scripts is backed
# by one of these probes, run against the npm that ships with the Node this repository develops on.
# Re-run this file to reproduce them; the transcript beside it (npm-probes.log) is one such run.
set -uo pipefail

echo "== node / npm under measurement"
node -v
npm -v
NPMROOT="$(dirname "$(dirname "$(readlink -f "$(command -v npm)")")")"
echo "npm root: $NPMROOT"

echo
echo '== PROBE 1: does `npm pack --pack-destination <dir>` create the directory?'
T="$(mktemp -d)"
mkdir -p "$T/.npmc"
printf '{"name":"probe-fixture","version":"9.9.9","private":false}\n' > "$T/package.json"
echo "x" > "$T/index.js"
( cd "$T" && npm_config_cache="$T/.npmc" npm pack --pack-destination "$T/does-not-exist" )
echo "exit=$?"
echo -n "directory created afterwards: "; [ -d "$T/does-not-exist" ] && echo yes || echo "NO — the destination must exist before npm pack runs"

echo
echo '== PROBE 2: is `npm stage` available on this npm?'
npm stage --help 2>&1 | head -12
echo "exit=$?"

echo
echo "== PROBE 3: does npm itself read NODE_AUTH_TOKEN anywhere?"
# An empty result is the finding: the variable is a setup-node CONVENTION (its `.npmrc` interpolates
# it), not an npm config source. npm's own env mechanism is the `npm_config_*` prefix below.
grep -rln "NODE_AUTH_TOKEN" "$NPMROOT" 2>/dev/null | head -5
echo "matches: $(grep -rln 'NODE_AUTH_TOKEN' "$NPMROOT" 2>/dev/null | wc -l)"
echo "-- the mechanism npm really has:"
grep -n "npm_config_" "$NPMROOT/node_modules/@npmcli/config/lib/index.js" | head -4

echo
echo "== PROBE 4: which npm subcommands perform the OIDC token exchange?"
grep -rln "oidc" "$NPMROOT/lib/commands/" 2>/dev/null
echo "-- and the approve subcommand, in full:"
sed -n '15,32p' "$NPMROOT/lib/commands/stage/approve.js"

echo
echo "== PROBE 5: npm-stage(1) on short-lived trust tokens and on approve"
grep -n "Shortlived tokens\|cannot run\|Requires 2FA\|act of approving" "$NPMROOT/man/man1/npm-stage.1" | head -6
