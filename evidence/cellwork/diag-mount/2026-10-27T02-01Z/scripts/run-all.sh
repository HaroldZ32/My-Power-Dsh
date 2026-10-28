#!/usr/bin/env bash
# One reproducible run: prep -> boot -> registration -> composition -> dump-config -> header extract.
# Every step's real exit code is recorded from the command itself, not from a pipe partner.
set -uo pipefail
WS="$PWD"
SB="$WS/.tmp-cellwork-reverify"
EV=$(cat "$SB/.ev")
RUNLOG="$EV/run.log"
: > "$RUNLOG"
step() {
  local name="$1"; shift
  echo "=== $name ===" | tee -a "$RUNLOG"
  echo "\$ $*" | tee -a "$RUNLOG"
  "$@" > "$SB/.step.out" 2>&1
  local code=$?
  tee -a "$RUNLOG" < "$SB/.step.out" > /dev/null
  echo "[exit=$code]" | tee -a "$RUNLOG"
  echo | tee -a "$RUNLOG"
  return $code
}

step "0 prep: sandbox, byte-identical profile copy, install state" bash "$SB/prep.sh"
gzip -9 -f "$EV/install-state/manifest-source.txt" "$EV/install-state/manifest-copy.txt"
echo "manifests gzipped: $(ls "$EV/install-state" | tr '\n' ' ')" | tee -a "$RUNLOG"

step "1 real boot, no overlay" bun "$SB/phase1.ts" "$SB" "$EV/boot"
step "2 registration surfaces (stub route, palette, one real tool call)" bun "$SB/phase2-registration.ts" "$SB" "$EV/registration"
step "3 composition probe (the host's own loadProfile call + install anchor)" node "$SB/probe-composition.mjs" "$SB/dshhome/profiles/dsh-tui" "$EV/composition" "$SB/dshhome"

echo "=== 4 repo wrapper dump-config (COMPOSITION ONLY) ===" | tee -a "$RUNLOG"
echo "\$ DSH_HOME=\$SB/dshhome HOME=\$SB/home node scripts/dump-config.ts --profile dsh-tui --json" | tee -a "$RUNLOG"
DSH_HOME="$SB/dshhome" HOME="$SB/home" node scripts/dump-config.ts --profile dsh-tui --json > "$EV/composition/dump-config-envelope.json" 2> "$EV/composition/dump-config-banner.log"
echo "[exit=$?]" | tee -a "$RUNLOG"
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const env = JSON.parse(readFileSync(process.argv[1], "utf8"));
const text = env.stdout;
writeFileSync(process.argv[2], text);
const rows = text.split("\n").filter((line) => line.startsWith("- id: "));
console.log("child exit=" + env.exitCode + " source=" + env.exitCodeSource + " stdoutBytes=" + env.stdoutBytes + " bannerEmitted=" + env.bannerEmitted);
console.log("top-level `- id: ` rows=" + rows.length);
console.log("mpd-cellwork present=" + text.includes("mpd-cellwork") + " (dump line " + (text.split("\n").findIndex((l) => l.includes("mpd-cellwork")) + 1) + ")");
' "$EV/composition/dump-config-envelope.json" "$EV/composition/dump-config-stdout.txt" | tee -a "$RUNLOG"
echo | tee -a "$RUNLOG"

step "5 extract the harness request/header record" bun "$SB/extract-header.ts" "$SB" "$EV/registration"

echo "=== 6 profile copy after the boots: which bytes moved ===" | tee -a "$RUNLOG"
( cd "$SB/dshhome/profiles/dsh-tui" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) | gzip -9 > "$EV/install-state/manifest-after-boots.txt.gz"
zcat "$EV/install-state/manifest-after-boots.txt.gz" | sha256sum | tee -a "$RUNLOG"
if zcat "$EV/install-state/manifest-copy.txt.gz" | diff -q - <(zcat "$EV/install-state/manifest-after-boots.txt.gz") > /dev/null; then
  echo "post-boot manifest IDENTICAL to the copy-time manifest" | tee -a "$RUNLOG"
  { echo "# files whose bytes the boots changed or created (copy-time manifest vs post-boot manifest)"; echo "# NONE: the 18721-file manifest is byte-identical after the boots."; } > "$EV/install-state/post-boot-mutations.txt"
else
  echo "post-boot manifest DIFFERS:" | tee -a "$RUNLOG"
  zcat "$EV/install-state/manifest-copy.txt.gz" | diff - <(zcat "$EV/install-state/manifest-after-boots.txt.gz") | head -40 | tee -a "$RUNLOG"
fi
