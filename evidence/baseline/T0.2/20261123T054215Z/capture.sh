#!/bin/sh
# Run from the feature checkout under test. Keep raw host state in unique scratch.
set -eu
repo=$(pwd -P)
packet=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd)
saved=evidence/baseline/T0.2/20261123T054215Z
prior=evidence/cellwork/diag-mount/2026-10-27T02-01Z/registration/request-header-record.json
if [ "$#" -eq 1 ] && [ "$1" = --self-test ]; then
  result=$(mktemp "$repo/.qa-v2-t02-self-test-XXXXXX")
  node scripts/baseline/tool-surface.ts "$saved/member-request-header.json" "$prior" 4 > "$result"
  cmp "$saved/surface.json" "$result"
  printf '%s\n' 'Saved comparison reproduced byte for byte.'
  exit 0
fi
if [ "$#" -ne 2 ] || [ "$1" != --out ]; then
  printf '%s\n' 'Usage: sh capture.sh --out <new-directory> | --self-test' >&2
  exit 2
fi
out=$2
driver=$packet/capture-driver.ts
bun=${PINNED_BUN:-$repo/.toolchain/node_modules/.bin/bun}
dsh=${PINNED_DSH:-$repo/.qa-tmp/dsh-022/bin/dsh}
if [ ! -x "$bun" ] || [ ! -x "$dsh" ] || [ ! -f "$driver" ]; then
  printf '%s\n' 'UNMEASURED: pinned executables or mounted driver unavailable' >&2
  exit 3
fi
if [ "$packet" != "$repo/$saved" ] || [ "$(basename -- "$dsh")" != dsh ]; then
  printf '%s\n' 'Run from the checkout under test and point PINNED_DSH at its dsh executable.' >&2
  exit 2
fi
mkdir -- "$out"
scratch=$(mktemp -d "$repo/.qa-v2-t02-XXXXXX")
mkdir "$scratch/home" "$scratch/dsh" "$scratch/tmp"
snapshot() {
  git rev-parse HEAD
  sha256sum "$saved/capture-driver.ts" "$saved/capture.sh" presets/mpd.patch.yml cordis.patch.yml \
    scripts/install-profile.ts scripts/baseline/input.ts skills/dsh-qa/scripts/cellwork-command.ts \
    skills/dsh-qa/scripts/lib/cellwork-command-probe.ts skills/dsh-qa/scripts/extension-isolation.ts \
    skills/dsh-qa/scripts/lib/session-evidence.ts skills/dsh-qa/scripts/lib/messages-sse.ts \
    packages/mpd-cellwork-plugin/dist/index.js packages/mpd-dsh-adapter-plugin/dist/index.js \
    packages/mpd-team-core-plugin/dist/index.js
  git ls-files -z --cached --others --exclude-standard -- \
    packages/mpd-cellwork-plugin/src packages/mpd-dsh-adapter-plugin/src packages/mpd-team-core-plugin/src \
    | LC_ALL=C sort -zu | xargs -0r sha256sum
}
isolated() {
  env -i HOME="$scratch/home" DSH_HOME="$scratch/dsh" TMPDIR="$scratch/tmp" \
    PATH="$(dirname "$dsh"):$PATH" PINNED_BUN="$bun" "$@"
}
host_version=$(isolated "$dsh" --version)
bun_version=$(isolated "$bun" --version)
node_version=$(isolated node --version)
if [ "$host_version" != 0.2.2-rc.5 ] || [ "$bun_version" != 1.4.0 ]; then
  printf '%s\n' 'UNMEASURED: expected DSH 0.2.2-rc.5 and Bun 1.4.0' >&2
  exit 3
fi
snapshot > "$out/build-before.txt"
if isolated node "$driver" "$scratch" "$host_version" "$bun_version" "$node_version" > "$scratch/driver.stdout" 2> "$scratch/driver.stderr"; then
  status=0
else
  status=$?
fi
snapshot > "$out/build-after.txt"
if ! cmp "$out/build-before.txt" "$out/build-after.txt" || [ "$status" -ne 0 ]; then
  printf 'UNMEASURED: capture failed or checkout changed (driver exit %s); scratch %s\n' "$status" "$scratch" >&2
  exit 3
fi
cp -- "$scratch/member-request-header.json" "$scratch/capture.json" "$out/"
printf 'Mounted driver exit %s. Out %s. Private scratch %s\n' "$status" "$out" "$scratch"
