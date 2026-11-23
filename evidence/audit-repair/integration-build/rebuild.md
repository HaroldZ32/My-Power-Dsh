# Settled integration build recipe

Run from the repository root after the captain confirms all runtime, packaging and skill writers are settled and the wave’s asset re-pin has landed. Record the current revision, Node and Bun versions, start and end hashes, command exits and decisive output. Give the separate verifier this recipe and the frozen acceptance contract. The artifact evidence below is an input to verification.

## Rebuild and check the checkout artifacts

```bash
set -euo pipefail
bun_bin=./.toolchain/node_modules/.bin/bun
[[ $("$bun_bin" --version) == 1.4.0 ]]
node --version

targets=$(node --input-type=module -e '
  import { discoverTargets } from "./scripts/verify-dist-fresh.ts"
  const { targets } = discoverTargets(process.cwd())
  if (!targets.length) process.exit(1)
  for (const { src, dist } of targets) console.log(`${src}\t${dist}`)
')
while IFS=$'\t' read -r src out; do
  [[ "$src" == packages/*/src/*.ts && "$out" == packages/*/dist/*.js ]]
  [[ "$out" != packages/mpd-mcp-codegraph/dist/serve.js && -f "$src" ]]
  "$bun_bin" build "$src" --target node --format esm --outfile "$out"
done <<< "$targets"

node scripts/build-mpd-client.ts
node --check packages/mpd-bundle-plugin/client.js
node --check packages/mpd-bundle-plugin/adopted/agent-teams-client.js
node scripts/verify-dist-fresh.ts
node scripts/verify-vendor.ts
"$bun_bin" test
"$bun_bin" run typecheck
```

At the interim inventory, discovery found 35 covered destinations and one uncovered prebuilt. See `targets.tsv` for the source-to-output mapping. AST uses two commands in that list. The server entry is `packages/mpd-mcp-astgrep/src/cli.ts` and the output is `packages/mpd-mcp-astgrep/dist/cli.js`. The launcher is `launch.ts` to `launch.js`. The CodeGraph launcher is a covered target. Its `dist/serve.js` is a fingerprinted prebuilt supplied to the packer. The browser generator reads `packages/mpd-bundle-plugin/adopted/agent-teams-client.js` verbatim and writes `packages/mpd-bundle-plugin/client.js`. Both files ship. The adopted file is the vendor-pinned input and has no current local generator.

## Assemble and check the relocatable pack

The packaging owner runs this block after the checkout artifacts are current. The packer replaces the canonical `dist/mpd-package` directory. Run it from the root and verify that destination resolves to the intended staging path before invoking it.

```bash
set -euo pipefail
pack_dir="$PWD/dist/mpd-package"
[[ $(realpath -m -- "$pack_dir") == "$pack_dir" ]]
node scripts/pack-mpd.ts
pack_stamp=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
node scripts/verify-pack-closure.ts --packed "$pack_dir" --require-packed --pack-stamp "$pack_stamp"
node scripts/verify-pack-closure.ts --self-test
node scripts/verify-plugin-manifest.ts --pack
```

Require zero unexpected drift and zero `expected-after-pack` files for the settled sweep. The latter count matters because closure classifies sources edited after the pack stamp separately. The packer copies the declared runtime distributions, both browsers, declared patch layers and root assets. It generates the CLI shim at `dist/mpd-package/packages/mpd-ext-plugin/dist/validator.js` and carries a named closure exemption for the QA-only roles probe distribution.

For the separate npm release tarball, use the publish workflow’s root `npm pack` command after the required DSH-Go gate. This is also the package that the isolated release tarball smoke consumes. Put the tarball and smoke logs in a fresh scratch directory and keep the tarball hash with the result. Run real mount and remaining wave gates under the pinned harness with an isolated DSH home, home directory and workspace.

```bash
set -euo pipefail
: "${MPD_DSHGO_KIT:?Set the path to the pinned DSH-Go kit}"
node scripts/verify-dshgo-standard.ts
release_scratch=$(mktemp -d)
filename=$(npm pack --quiet --ignore-scripts --pack-destination "$release_scratch")
tarball="$release_scratch/$filename"
test -f "$tarball"
sha256sum -- "$tarball"
: "${DSH_PINNED_BIN_DIR:?Set the directory containing the pinned dsh executable}"
host_version=$(node -p 'require("./dsh-distribution.json").protocols.flatMap(p => p.spec?.components ?? []).find(c => c.id === "host-base").ref.split("@").at(-1)')
host_report=$("$DSH_PINNED_BIN_DIR/dsh" --version)
printf '%s\n' "$host_report"
[[ " $host_report " == *" $host_version "* ]]
PATH="$DSH_PINNED_BIN_DIR:$PATH" bash docker/verify-release-tarball.sh "$tarball" "$release_scratch/smoke"
```
