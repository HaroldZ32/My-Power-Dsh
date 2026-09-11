#!/usr/bin/env bash
# t8 verification driver 4e (attempt 2) — CLEAN heal fidelity.
#
# The t13 repair's own test ("a clean tree still heals successfully") only asserts that the heal
# reports applied, inserts the right number of regions, and leaves one pathMatchesScope
# declaration. This driver measures the property that comment implies: after stripping every
# region from OUR file (markers + bodies gone, everything else intact) and healing, the file must
# be BYTE-IDENTICAL to the canonical adoption — otherwise a re-materialize silently diverges and
# both guard passes still report success.
# The live tree is never touched (everything happens in a /tmp sandbox).
set -u
cd "$(dirname "$0")/../../../../../.."
REPO="$(pwd)"
EV="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$EV/check4f-tools-heal-fidelity.log"
: > "$LOG"
sha() { sha256sum "$1" | awk '{print $1}'; }

SB="$(mktemp -d /tmp/mpd-t8-fidelity-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
cp "$REPO/packages/mpd-agent-teams-plugin/lib/tools.js" "$SB/packages/mpd-agent-teams-plugin/lib/tools.js"
cp "$REPO/packages/mpd-agent-teams-plugin/lib/quality-gates.js" "$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
cp "$REPO/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js" "$SB/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"
CANON="$SB/canonical.js"
cp "$SB/packages/mpd-agent-teams-plugin/lib/tools.js" "$CANON"
HEALED="$SB/packages/mpd-agent-teams-plugin/lib/tools.js"

{
    echo "=== clean heal fidelity (strip every region from OUR file, then heal) ==="
    echo "canonical sha256 = $(sha "$CANON")"
    echo
    echo "--- strip every mpd-delta region (markers + bodies) ---"
} >> "$LOG" 2>&1
python3 - "$HEALED" <<'PY' >> "$LOG" 2>&1
import re, sys
p = sys.argv[1]; src = open(p).read().split("\n"); out = []; i = 0; dropped = []
while i < len(src):
    m = re.match(r"\s*//#region (mpd-delta [A-Za-z0-9-]+) \(", src[i])
    if m:
        rid = m.group(1)
        end = next((j for j in range(i + 1, len(src)) if src[j].strip() == f"//#endregion {rid}"), None)
        dropped.append(rid); i = end + 1; continue
    out.append(src[i]); i += 1
open(p, "w").write("\n".join(out))
print("stripped:", len(dropped), "regions ->", ", ".join(dropped))
PY

{
    echo "stripped sha256 = $(sha "$HEALED")"
    echo
    echo "--- --write (the heal) ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ); echo "exit=$?"
    echo
    echo "--- --check after the heal ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ); echo "exit=$?"
    echo
    echo "--- healed sha256 = $(sha "$HEALED")"
    echo "byte-identical-to-canonical=$( [ "$(sha "$HEALED")" = "$(sha "$CANON")" ] && echo yes || echo NO )"
    echo
    echo "--- diff healed vs canonical (line count first, then the diff) ---"
    echo "diff-lines=$(diff "$HEALED" "$CANON" | wc -l)"
    diff "$HEALED" "$CANON"
    echo "diff-exit=$?"
    echo
    echo "--- which region moved? (region begin lines in each file) ---"
    echo "canonical:"; grep -n "^//#region mpd-delta\|^    //#region mpd-delta\|^        //#region mpd-delta" "$CANON" | sed 's/^/  /'
    echo "healed:"; grep -n "^//#region mpd-delta\|^    //#region mpd-delta\|^        //#region mpd-delta" "$HEALED" | sed 's/^/  /'
} >> "$LOG" 2>&1

python3 - "$LOG" "$SB" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
def section(name):
    m = re.search(r"--- " + re.escape(name) + r" ---\n(.*?)(?=\n--- |\Z)", log, re.S)
    return m.group(1).strip() if m else ""
res = {
    "driver": "check4f-tools-heal-fidelity",
    "scenario": "our own file with EVERY region stripped (markers + bodies), then the guard's --write; the canonical adoption is the working-tree file",
    "strip": section("strip every mpd-delta region (markers + bodies)"),
    "heal_write": section("--write (the heal)"),
    "check_after_heal": section("--check after the heal"),
    "identical": "byte-identical-to-canonical=yes" in log,
    "diff": section("diff healed vs canonical (line count first, then the diff)"),
    "regions_canonical": section("which region moved? (region begin lines in each file)"),
}
m = re.search(r"diff-lines=(\d+)", log)
res["diff_lines"] = int(m.group(1)) if m else None
res["heal_exit"] = int(re.search(r"--- --write \(the heal\) ---\n(?:.*\n)*?exit=(\d+)", log).group(1)) if re.search(r"--- --write \(the heal\) ---\n(?:.*\n)*?exit=(\d+)", log) else None
res["check_exit"] = int(re.search(r"--- --check after the heal ---\n(?:.*\n)*?exit=(\d+)", log).group(1)) if re.search(r"--- --check after the heal ---\n(?:.*\n)*?exit=(\d+)", log) else None
res["passed"] = res["identical"] is True
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps({k: v for k, v in res.items() if k not in ("diff", "strip", "heal_write", "check_after_heal", "regions_canonical")}, indent=2))
print("diff (first 1200 chars):"); print((res["diff"] or "")[:1200])
PY
rm -rf "$SB"
