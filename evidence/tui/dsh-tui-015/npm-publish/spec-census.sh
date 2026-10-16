#!/usr/bin/env bash
# spec-census.sh — grade .github/workflows/publish.yml against the guards the captain's spec names.
#
# WHY THIS EXISTS. `verify-workflows.ts` grades the SHAPE every workflow must have (loadable YAML, a
# job/step shape GitHub will accept); it says nothing about whether THIS workflow still carries the
# guards it was specified with. This census is that second, spec-level reading: no secret anywhere,
# the tag<->version assertion before the first publish call, the two deliberate modes, `always()` on the
# listing step, no `registry-url` on setup-node, `--tag <dist_tag>` on the staging call, and the note
# that approving in ascending version order is what keeps `latest` on the newest release. Each check
# prints what it looked for; one miss fails the run.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FILE="$ROOT/.github/workflows/publish.yml"
FAILED=0

# check <label> <grep-pattern> <expect: yes|no>   — a regex read of the file, quoted so it is literal.
check() {
  if grep -qE -- "$2" "$FILE"; then found=yes; else found=no; fi
  if [ "$found" = "$3" ]; then
    printf 'PASS  %-58s (%s: %s)\n' "$1" "$3" "$found"
  else
    printf 'FAIL  %-58s (want %s, got %s)\n' "$1" "$3" "$found"
    FAILED=$((FAILED + 1))
  fi
}

echo "== spec census of $FILE"
echo "== sha256: $(sha256sum "$FILE" | cut -d' ' -f1)"
echo

check "no secret material is referenced anywhere"            'secrets\.'                          no
# The literal token name may appear in PROSE explaining why it is not used (the header does exactly
# that); what must not exist is an ASSIGNMENT or a secret reference that would feed npm a credential.
check "no npm token is assigned anywhere"                    '_authToken=|NODE_AUTH_TOKEN='       no
check "workflow-level contents: read"                        '^  contents: read$'                 yes
check "workflow-level id-token: write (the OIDC exchange)"   '^  id-token: write$'                yes
check "setup-node is called WITHOUT registry-url"            'registry-url:'                      no
check "setup-node targets Node 24"                           'node-version: "24"'                 yes
check "the npm-stage availability guard is present"          'npm stage --help'                   yes
check "the pack destination is created before npm pack"      'mkdir -p /tmp/npm-pack'             yes
check "npm pack writes into /tmp/npm-pack"                   'npm pack --pack-destination /tmp/npm-pack' yes
check "staging publishes with an explicit access"            'npm stage publish --access public'  yes
check "staging passes the dist-tag through"                  'npm stage publish --access public --tag "\$DIST_TAG"' yes
check "approve mode calls npm stage approve"                 'npm stage approve "\$STAGE_ID"'     yes
check "the listing step runs under always()"                 'if: \$\{\{ always\(\) \}\}'          yes
check "the listing step is continue-on-error"                'continue-on-error: true'            yes
check "the tarball is uploaded only when staging"            'always\(\) && env.STAGE_ID == ..'   yes
check "the upload tolerates an absent tarball"               'if-no-files-found: ignore'          yes
check "the package-name assertion is present"                "@mpd-dsh/mpd"                       yes
check "the tag<->version assertion is present"               'expected .v\$VERSION'               yes
check "the header says why the file exists (npm lagged)"     'npm LAGGED BEHIND GITHUB'           yes
check "the header names the trusted publisher / OIDC"        'TRUSTED PUBLISHER = OIDC'           yes
check "the header explains dist_tag for backfills"           'dist_tag. input exists for exactly that case|backfill' yes
check "the header states the ascending-approval rule"        'APPROVE IN ASCENDING VERSION ORDER' yes
check "the approve-mode bound is stated in the step"         'cannot run .npm stage. subcommands' yes

# ORDERING is the guard that cannot be read off a grep: the assertion step must come BEFORE the first
# step that talks to the registry, or a wrong version would already be staged when it reddens.
# Both greps are anchored to the line's OWN shape — the step declaration and a line indented as a
# `run:` body — because the header comment narrates `npm stage publish` too, and an unanchored grep
# read the prose as the publish call (measured: it reported "publish at line 25").
assert_line="$(grep -nE '^      - name: "Assert v' "$FILE" | cut -d: -f1 | head -1)"
stage_line="$(grep -nE '^          npm stage publish --access public' "$FILE" | cut -d: -f1 | head -1)"
if [ -n "$assert_line" ] && [ -n "$stage_line" ] && [ "$assert_line" -lt "$stage_line" ]; then
  printf 'PASS  %-58s (assert at line %s, publish at line %s)\n' "the assertion precedes any publish call" "$assert_line" "$stage_line"
else
  printf 'FAIL  %-58s (assert=%s publish=%s)\n' "the assertion precedes any publish call" "${assert_line:-none}" "${stage_line:-none}"
  FAILED=$((FAILED + 1))
fi

echo
echo "CENSUS $([ "$FAILED" = 0 ] && echo PASS || echo "FAIL ($FAILED check(s))")"
exit $([ "$FAILED" = 0 ] && echo 0 || echo 1)
