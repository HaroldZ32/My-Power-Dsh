#!/usr/bin/env bash
# wave-3 (t9) driver 4j — the OLD-format-registry guard, end to end.
#
# T7-F1: with a pre-migration registry (anchor/anchorOccurrence/anchorMarker and no
# beforeContext/afterContext) the applier used to die with a bare
# `TypeError: Cannot read properties of undefined (reading 'length')` from locateSeam.
# The repair adds a named guard at the TOP of applyAgentTeamsFixes, and — deliberately —
# NOT at module load, because `--write-registry` IS the one-time migration and reads only
# `delta.file` from the old registry. This driver proves both halves:
#   A. old registry + intact tree  -> `--check` exits 1 with the migration message, no TypeError,
#   B. `--write-registry` still migrates (exit 0, entries now carry the context pair),
#   C. the migrated tree verifies (`--check` exit 0).
#
# The live tree is never touched (everything happens in a /tmp sandbox).
set -u
cd "$(dirname "$0")/../../../../.."
REPO="$(pwd)"
EV="${EV_OUT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$EV/check4j-old-registry-guard.log"
: > "$LOG"

SB="$(mktemp -d /tmp/mpd-w3-guard-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
for f in quality-gates.js tools.js mpd-deltas.js; do
    cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
done
REG="$SB/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"

python3 - "$REG" <<'PY' >> "$LOG" 2>&1
import re, sys
p = sys.argv[1]
src = open(p).read()
src = re.sub(r" {8}beforeContext: \[\n(?: {12}.*\n)* {8}\],\n", "", src)
src = re.sub(r" {8}afterContext: \[\n(?: {12}.*\n)* {8}\],\n", "", src)
src = re.sub(r"( {8}id: .*\n)", r'\1        anchor: "    return runtime;",\n        anchorOccurrence: 1,\n        anchorMarker: null,\n', src)
open(p, "w").write(src)
entries = len(re.findall(r" {8}anchorOccurrence: 1,", src))
print(f"fixture: registry rewritten to the OLD anchor format ({entries} entries, beforeContext removed: {'beforeContext: [' not in src})")
PY

{
    echo
    echo "--- A. --check against the OLD registry (must refuse by name, never TypeError) ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ) > "$SB/a.log" 2>&1
    echo "exit=$?"
    sed 's/^/    /' "$SB/a.log"
    echo "    names_migration=$(grep -c 'OLD anchor format' "$SB/a.log")"
    echo "    bare_typeerror=$(grep -c 'TypeError' "$SB/a.log")"
    echo
    echo "--- A2. --write against the OLD registry (same refusal, no partial write) ---"
    SHA_BEFORE="$(sha256sum "$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js" | awk '{print $1}')"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ) > "$SB/a2.log" 2>&1
    echo "exit=$?"
    sed 's/^/    /' "$SB/a2.log"
    SHA_AFTER="$(sha256sum "$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js" | awk '{print $1}')"
    echo "    adopted_files_untouched=$([ "$SHA_BEFORE" = "$SHA_AFTER" ] && echo yes || echo NO)"
    echo
    echo "--- B. --write-registry migrates the OLD registry ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write-registry ) > "$SB/b.log" 2>&1
    echo "exit=$?"
    sed 's/^/    /' "$SB/b.log"
    echo "    migrated_entries_with_pair=$(grep -c '^        beforeContext: \[' "$REG")"
    echo "    residual_old_keys=$(grep -c '^        anchorOccurrence:' "$REG")"
    echo
    echo "--- C. the migrated tree verifies ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ) > "$SB/c.log" 2>&1
    echo "exit=$?"
    sed 's/^/    /' "$SB/c.log"
} >> "$LOG" 2>&1

python3 - "$LOG" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
def section(name):
    m = re.search(r"--- " + re.escape(name) + r" ---\n(.*?)(?=\n--- |\Z)", log, re.S)
    return m.group(1).strip() if m else ""
def exit_of(marker):
    m = re.search(re.escape(marker) + r" ---\n(?:.*\n)*?exit=(\d+)", log)
    return int(m.group(1)) if m else None
res = {
    "driver": "check4j-old-registry-guard",
    "scenario": "pre-migration registry: the applier must refuse by NAME (never a bare TypeError), --write-registry must still migrate, and the migrated tree must verify",
    "check_exit": exit_of("A. --check against the OLD registry (must refuse by name, never TypeError)"),
    "write_exit": exit_of("A2. --write against the OLD registry (same refusal, no partial write)"),
    "migrate_exit": exit_of("B. --write-registry migrates the OLD registry"),
    "post_check_exit": exit_of("C. the migrated tree verifies"),
    "names_migration": "names_migration=1" in log,
    "bare_typeerror_present": "bare_typeerror=1" in log,
    "adopted_files_untouched": "adopted_files_untouched=yes" in log,
    "migrated_entries_with_pair": int(re.search(r"migrated_entries_with_pair=(\d+)", log).group(1)) if re.search(r"migrated_entries_with_pair=(\d+)", log) else None,
    "residual_old_keys": int(re.search(r"residual_old_keys=(\d+)", log).group(1)) if re.search(r"residual_old_keys=(\d+)", log) else None,
    "fixture": section("fixture: registry rewritten to the OLD anchor format"),
}
res["passed"] = (
    res["check_exit"] == 1 and res["write_exit"] == 1
    and res["names_migration"] and not res["bare_typeerror_present"]
    and res["adopted_files_untouched"]
    and res["migrate_exit"] == 0
    and res["migrated_entries_with_pair"] == 12
    and res["residual_old_keys"] == 0
    and res["post_check_exit"] == 0
)
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps(res, indent=2))
PY
rm -rf "$SB"
