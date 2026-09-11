#!/usr/bin/env bash
# wave-3 (t2) driver 4g — the case that defeated every wave-2 attempt.
#
# Both adopted files have EVERY mpd-delta region stripped in the SAME sandbox state
# (a full re-materialize of the tree), then ONE `--write` heal runs, and each file is
# compared to its canonical bytes. Wave 2 measured 60 diff lines in tools.js with
# `mpd-delta task-contract` re-inserted at 1970 where canonical is 1733, while
# quality-gates.js healed byte-identically — the two-file pair is the bar, because a
# fix that trades one file for the other is not a fix.
#
# The live tree is never touched (everything happens in a /tmp sandbox).
set -u
cd "$(dirname "$0")/../../../../.."
REPO="$(pwd)"
EV="${EV_OUT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$EV/check4g-strip-both-heal-fidelity.log"
: > "$LOG"
sha() { sha256sum "$1" | awk '{print $1}'; }

SB="$(mktemp -d /tmp/mpd-w3-fidelity-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
for f in quality-gates.js tools.js mpd-deltas.js; do
    cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
done
CANON_DIR="$SB/canonical"
mkdir -p "$CANON_DIR"
cp "$SB/packages/mpd-agent-teams-plugin/lib/tools.js" "$CANON_DIR/tools.js"
cp "$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js" "$CANON_DIR/quality-gates.js"

{
    echo "=== strip-BOTH heal fidelity (both adopted files stripped in the SAME state, ONE heal) ==="
    echo "canonical tools.js         sha256 = $(sha "$CANON_DIR/tools.js")"
    echo "canonical quality-gates.js sha256 = $(sha "$CANON_DIR/quality-gates.js")"
    echo
    echo "--- strip every mpd-delta region from BOTH files ---"
} >> "$LOG" 2>&1

python3 - "$SB" <<'PY' >> "$LOG" 2>&1
import re, sys
sb = sys.argv[1]
for name in ("quality-gates.js", "tools.js"):
    p = f"{sb}/packages/mpd-agent-teams-plugin/lib/{name}"
    src = open(p).read().split("\n"); out = []; i = 0; dropped = []
    while i < len(src):
        m = re.match(r"\s*//#region (mpd-delta [A-Za-z0-9-]+) \(", src[i])
        if m:
            rid = m.group(1)
            end = next((j for j in range(i + 1, len(src)) if src[j].strip() == f"//#endregion {rid}"), None)
            dropped.append(rid); i = end + 1; continue
        out.append(src[i]); i += 1
    open(p, "w").write("\n".join(out))
    print(f"{name}: stripped {len(dropped)} regions -> {', '.join(dropped)}")
PY

{
    echo
    echo "--- --write (the single heal of the stripped state) ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ); echo "exit=$?"
    echo
    echo "--- --check after the heal ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ); echo "exit=$?"
    echo
    for name in tools.js quality-gates.js; do
        echo "--- $name ---"
        echo "diff-lines=$(diff "$SB/packages/mpd-agent-teams-plugin/lib/$name" "$CANON_DIR/$name" | wc -l)"
        echo "byte-identical-to-canonical=$( [ "$(sha "$SB/packages/mpd-agent-teams-plugin/lib/$name")" = "$(sha "$CANON_DIR/$name")" ] && echo yes || echo NO )"
        echo "task-contract region line healed:    $(grep -n 'region mpd-delta task-contract (' "$SB/packages/mpd-agent-teams-plugin/lib/$name" | head -1 | cut -d: -f1)"
        echo "task-contract region line canonical: $(grep -n 'region mpd-delta task-contract (' "$CANON_DIR/$name" | head -1 | cut -d: -f1)"
        diff "$SB/packages/mpd-agent-teams-plugin/lib/$name" "$CANON_DIR/$name" | head -20
    done
} >> "$LOG" 2>&1

python3 - "$LOG" "$SB" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
def section(name):
    m = re.search(r"--- " + re.escape(name) + r" ---\n(.*?)(?=\n--- |\n=== |\Z)", log, re.S)
    return m.group(1).strip() if m else ""
def identity(name):
    body = section(name)
    return "diff-lines=0" in body and "byte-identical-to-canonical=yes" in body
m = re.search(r"--- --write \(the single heal of the stripped state\) ---\n(?:.*\n)*?exit=(\d+)", log)
c = re.search(r"--- --check after the heal ---\n(?:.*\n)*?exit=(\d+)", log)
res = {
    "driver": "check4g-strip-both-heal-fidelity",
    "scenario": "BOTH adopted files have EVERY mpd-delta region stripped in the SAME sandbox state, then ONE --write heal; each file is compared to its canonical bytes",
    "strip": section("strip every mpd-delta region from BOTH files"),
    "heal_write": section("--write (the single heal of the stripped state)"),
    "check_after_heal": section("--check after the heal"),
    "tools_js_byte_identical": identity("tools.js"),
    "quality_gates_js_byte_identical": identity("quality-gates.js"),
    "tools_js_diff_lines": int(re.search(r"--- tools\.js ---\ndiff-lines=(\d+)", log).group(1)) if re.search(r"--- tools\.js ---\ndiff-lines=(\d+)", log) else None,
    "quality_gates_js_diff_lines": int(re.search(r"--- quality-gates\.js ---\ndiff-lines=(\d+)", log).group(1)) if re.search(r"--- quality-gates\.js ---\ndiff-lines=(\d+)", log) else None,
    "heal_exit": int(m.group(1)) if m else None,
    "check_exit": int(c.group(1)) if c else None,
}
res["passed"] = bool(res["tools_js_byte_identical"] and res["quality_gates_js_byte_identical"] and res["heal_exit"] == 0 and res["check_exit"] == 0)
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps({k: v for k, v in res.items() if k not in ("strip", "heal_write", "check_after_heal")}, indent=2))
PY
rm -rf "$SB"
