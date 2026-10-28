#!/usr/bin/env bash
# Prep: record the install state (global package removed), copy the dsh-tui profile byte-identically,
# and prove the copy with a full per-file sha256 manifest diff. Every step is logged verbatim.
set -uo pipefail
WS="$PWD"
SB="$WS/.tmp-cellwork-reverify"
EV=$(cat "$SB/.ev")
OUT="$EV/install-state"
SRC="$HOME/.dsh/profiles/dsh-tui"
DST="$SB/dshhome/profiles/dsh-tui"
LOG="$OUT/prep.log"
: > "$LOG"
run() { echo "\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; echo "[exit=$?]" | tee -a "$LOG"; echo | tee -a "$LOG"; }

{
  echo "# install-state + copy fidelity — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "workspace=$WS"
  echo "sandbox=$SB"
  echo "DSH_HOME=$SB/dshhome"
  echo "HOME=$SB/home"
  echo "session workspace=$SB/ws"
  echo
} | tee -a "$LOG"

echo "== 1. global npm state (the removal is the change under test) ==" | tee -a "$LOG"
run npm ls -g --depth=0
echo "== 1b. global @mpd-dsh directory ==" | tee -a "$LOG"
GLOBAL_ROOT=$(npm root -g)
echo "npm root -g=$GLOBAL_ROOT" | tee -a "$LOG"
run ls -la "$GLOBAL_ROOT/@mpd-dsh"

echo "== 2. what the loader's install anchor resolves for @mpd-dsh/mpd ==" | tee -a "$LOG"
ANCHOR="$GLOBAL_ROOT/@deepseek-ai/dsh/package.json"
echo "INSTALL_ANCHOR=$ANCHOR" | tee -a "$LOG"
node -e '
const { createRequire } = require("node:module");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const anchor = process.argv[1];
for (const searchPath of createRequire(anchor).resolve.paths("@mpd-dsh/mpd") ?? []) {
  const candidate = join(searchPath, "@mpd-dsh/mpd");
  const hit = existsSync(join(candidate, "package.json"));
  let version = "-";
  if (hit) { try { version = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")).version } catch {} }
  console.log((hit ? "HIT  " : "miss ") + candidate + (hit ? " version=" + version : ""));
}
' "$ANCHOR" | tee -a "$LOG"

echo "== 3. profile bundle under the sandbox copy ==" | tee -a "$LOG"
BUNDLE="$DST/node_modules/@mpd-dsh/mpd"
node -e '
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = process.argv[1];
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
console.log("bundle version=" + pkg.version);
console.log("cellwork module=" + join(dir, "packages/mpd-cellwork-plugin/dist/index.js"));
' "$BUNDLE" | tee -a "$LOG"
sha256sum "$BUNDLE/cordis.patch.yml" "$BUNDLE/package.json" "$BUNDLE/packages/mpd-cellwork-plugin/dist/index.js" "$DST/package.json" "$DST/cordis.patch.yml" | tee "$OUT/profile-sha256.txt" | tee -a "$LOG"
echo "-- cellwork row in the bundle patch --" | tee -a "$LOG"
grep -n -A 3 -- "- id: mpd-cellwork" "$BUNDLE/cordis.patch.yml" | tee -a "$LOG"
echo "-- cellwork tools in the installed module bytes --" | tee -a "$LOG"
grep -o 'name: *"cellwork_[a-z_]*"' "$BUNDLE/packages/mpd-cellwork-plugin/dist/index.js" | sed -E 's/.*"(cellwork_[a-z_]+)"/\1/' | sort -u | tee "$OUT/cellwork-tools-expected.txt" | tee -a "$LOG"
echo "count=$(wc -l < "$OUT/cellwork-tools-expected.txt")" | tee -a "$LOG"

echo "== 4. copy fidelity: per-file sha256 manifest, source vs copy ==" | tee -a "$LOG"
# Deterministic re-run: the sandbox profile and the workspace state are RESET first, so the manifest
# below always describes exactly one copy of the installed profile (never a merge of two runs).
rm -rf "$DST" "$SB/ws/.mpd" "$SB/ws/AGENT.md" "$SB/dshhome/sessions"
mkdir -p "$SB/dshhome/profiles" "$SB/home/.dsh-tui" "$SB/ws"
cp -a "$SRC" "$DST"
cp "$HOME/.dsh/.credentials.yaml" "$SB/dshhome/.credentials.yaml"
cp "$HOME/.dsh-tui/agent-preset.json" "$SB/home/.dsh-tui/agent-preset.json"
echo "reset+recopy: profile dir replaced, ws/.mpd + sessions cleared, credentials + agent-preset refreshed" | tee -a "$LOG"
( cd "$SRC" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$OUT/manifest-source.txt"
( cd "$DST" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$OUT/manifest-copy.txt"
echo "source files=$(wc -l < "$OUT/manifest-source.txt") bytes=$(du -sb "$SRC" | cut -f1)" | tee -a "$LOG"
echo "copy   files=$(wc -l < "$OUT/manifest-copy.txt") bytes=$(du -sb "$DST" | cut -f1)" | tee -a "$LOG"
if diff -q "$OUT/manifest-source.txt" "$OUT/manifest-copy.txt" > /dev/null; then
  echo "MANIFEST IDENTICAL: every one of the $(wc -l < "$OUT/manifest-source.txt") files has the same sha256" | tee -a "$LOG"
  sha256sum "$OUT/manifest-copy.txt" | tee -a "$LOG"
else
  echo "MANIFEST DIFFERS:" | tee -a "$LOG"
  diff "$OUT/manifest-source.txt" "$OUT/manifest-copy.txt" | head -40 | tee -a "$LOG"
fi

echo "== 5. HOME fixture + credentials ==" | tee -a "$LOG"
echo "agent-preset.json (copied from \$HOME/.dsh-tui): $(cat "$SB/home/.dsh-tui/agent-preset.json")" | tee -a "$LOG"
echo "onboarding.json written: {\"completed\": true, \"version\": 1} (the host's wizard-skip schema; the real HOME has no such file because onboarding is already done)" | tee -a "$LOG"
echo '{"completed":true,"version":1}' > "$SB/home/.dsh-tui/onboarding.json"
echo "credentials copied once into the sandbox: $(stat -c '%a %s bytes' "$SB/dshhome/.credentials.yaml") (values never printed)" | tee -a "$LOG"
echo | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
