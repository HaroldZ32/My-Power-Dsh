#!/usr/bin/env bash
# Falsifiability proof for the three new self-test rot guards in skills/dsh-qa/scripts/mcp-call.ts.
# Each mutant is a COPY of the case at the SAME depth inside a scratch "repo root" (so the case's own
# `repoRoot` derivation still finds cordis.patch.yml / package.json / tests), carrying ONE revert:
#   m1  the install flag set loses --legacy-peer-deps / --prefer-offline  (the boot fix)
#   m2  a per-arm npm cache comes back                                     (the doubled cost)
#   m3  the shared-cache function disappears from the arms                 (the shared cache)
# A guard that cannot redden on its own mutant is decoration, so each mutant MUST exit 1 and print its
# guard's FAIL line; the unmutated control MUST exit 0.
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
M="$REPO/.qa-mcp-repro/mutants"
rm -rf "$M"; mkdir -p "$M/control/skills/dsh-qa/scripts"
for m in control m1 m2 m3 m4; do
  mkdir -p "$M/$m/skills/dsh-qa/scripts" "$M/$m/tests"
  ln -sfn "$REPO/cordis.patch.yml" "$M/$m/cordis.patch.yml"
  ln -sfn "$REPO/package.json" "$M/$m/package.json"
  ln -sfn "$REPO/tests/mcp-fixtures" "$M/$m/tests/mcp-fixtures"
  cp "$REPO/skills/dsh-qa/scripts/mcp-call.ts" "$M/$m/skills/dsh-qa/scripts/mcp-call.ts"
  # The case's own imports (./lib/*.ts) must resolve beside the mutant copy.
  ln -sfn "$REPO/skills/dsh-qa/scripts/lib" "$M/$m/skills/dsh-qa/scripts/lib"
done
# m1: the install CALL loses the two added flags (the guard's own needle is split, so this cannot hit it).
perl -0pi -e 's/\Q"--legacy-peer-deps", "--prefer-offline", "--no-audit"\E/"--no-audit"/' "$M/m1/skills/dsh-qa/scripts/mcp-call.ts"
# m2: the per-arm cache comes back (the install no longer receives the shared one).
perl -0pi -e 's/\Q"--cache", npmCache\E/"--cache", join(sandbox, ".npm-cache")/' "$M/m2/skills/dsh-qa/scripts/mcp-call.ts"
# m3: the arms stop going through the shared-cache runner.
perl -0pi -e 's/\Qconst [enumRun, callRun] = runArmsWithSharedCache()\E/const enumRun = realRun(ENUM_JOB, 600000, mkdtempSync(join(tmpdir(), "mpd-dsh-qa-npmcache-")))\n  const callRun = realRun(CALL_JOB, 600000, mkdtempSync(join(tmpdir(), "mpd-dsh-qa-npmcache-")))/' "$M/m3/skills/dsh-qa/scripts/mcp-call.ts"
# m4: the shared-cache runner is deleted outright.
perl -0pi -e 's/\Qfunction runArmsWithSharedCache(): readonly [ArmRun, ArmRun] {\E/function armsRunner(): readonly [ArmRun, ArmRun] {/' "$M/m4/skills/dsh-qa/scripts/mcp-call.ts"
for m in control m1 m2 m3 m4; do
  out=$(node "$M/$m/skills/dsh-qa/scripts/mcp-call.ts" --self-test 2>&1)
  code=$?
  echo "== $m exit=$code"
  echo "$out" | sed 's/^/   /'
done
