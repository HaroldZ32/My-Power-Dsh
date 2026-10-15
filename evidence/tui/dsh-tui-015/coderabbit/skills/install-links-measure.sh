#!/usr/bin/env bash
# Proof for finding 1 (mcp-call.ts pack install): a `file:` dependency installed WITHOUT
# `--install-links` is LINKED and never gets the pack's OWN dependencies; WITH `--install-links` the
# pack is materialized as a regular package and its declared closure is installed, so the ast-grep
# launcher's `createRequire` chain finds `@ast-grep/cli`.
#
# Runs two npm installs of the SAME staged pack (the repository's own `dist/mpd-package`), one per
# mode, then measures from the INSTALLED launcher path: is the pack dir a symlink, and does
# `@ast-grep/cli/package.json` resolve from the launcher.
#
# Usage: bash evidence/tui/dsh-tui-015/coderabbit/skills/install-links-measure.sh
set -u
REPO="$(cd "$(dirname "$0")/../../../../.." && pwd)"
SCRATCH="$(mktemp -d /tmp/mpd-install-links-XXXXXX)"
echo "repo=$REPO"
echo "scratch=$SCRATCH"
cp -r "$REPO/dist/mpd-package" "$SCRATCH/staged-pack"
for mode in linked nonlinked; do
  mkdir -p "$SCRATCH/$mode"
  printf '{"name":"probe-%s","private":true,"dependencies":{"@mpd-dsh/mpd":"file:%s/staged-pack"}}\n' "$mode" "$SCRATCH" > "$SCRATCH/$mode/package.json"
done
echo "=== install A: default (file: => LINK) ==="
npm install --prefix "$SCRATCH/linked" --no-audit --no-fund --no-save --cache "$SCRATCH/npm-cache" 2>&1 | tail -5
echo "installA-exit=${PIPESTATUS[0]}"
echo "=== install B: --install-links (materialized) ==="
npm install --prefix "$SCRATCH/nonlinked" --install-links --no-audit --no-fund --no-save --cache "$SCRATCH/npm-cache" 2>&1 | tail -5
echo "installB-exit=${PIPESTATUS[0]}"
echo "=== measurement ==="
SCRATCH="$SCRATCH" node -e '
const { createRequire } = require("node:module");
const { lstatSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const scratch = process.env.SCRATCH;
for (const mode of ["linked", "nonlinked"]) {
  const pack = join(scratch, mode, "node_modules", "@mpd-dsh", "mpd");
  if (!existsSync(pack)) { console.log(mode + ": pack MISSING (install failed)"); continue; }
  const symlink = lstatSync(pack).isSymbolicLink();
  const launcher = join(pack, "packages", "mpd-mcp-astgrep", "dist", "launch.js");
  let astgrep = "UNRESOLVED";
  try { astgrep = createRequire(pathToFileURL(launcher)).resolve("@ast-grep/cli/package.json"); } catch (e) { astgrep = "UNRESOLVED(" + e.code + ")"; }
  let cclsp = "UNRESOLVED";
  try { cclsp = createRequire(pathToFileURL(launcher)).resolve("cclsp/package.json"); } catch (e) { cclsp = "UNRESOLVED(" + e.code + ")"; }
  console.log(mode + ": packSymlink=" + symlink + " launcher=" + existsSync(launcher) + " @ast-grep/cli=" + astgrep + " cclsp=" + cclsp);
}
'
echo "scratch kept at $SCRATCH"
