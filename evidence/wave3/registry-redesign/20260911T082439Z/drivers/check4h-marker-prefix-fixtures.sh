#!/usr/bin/env bash
# wave-3 (t2) driver 4h — the marker-prefix fixtures, one per colliding pair.
#
# Three delta ids are prefixes of a sibling: `scope-overlap` ⊂ `scope-overlap-normalize`,
# `repair-scope` ⊂ `repair-scope-fields`, `task-contract` ⊂ `task-contract-render`.
# The pre-fix `findRegion` used `line.includes(marker)`, so for the OUTER id the end
# search resolved to the CHILD's end line. Two measured outcomes:
#   (i)  outer BEGIN marker missing  -> `half-open marker pair` refusal (a MISDIAGNOSIS:
#        the region is merely missing) and no heal;
#   (ii) outer END marker missing    -> the child's end line is taken as the outer's,
#        producing a bogus span and a false "no longer matches the registered block".
# Each case below drives the guard on a copy whose ONLY defect is one dropped outer
# marker line, from the `outer` side of a real colliding pair, and asserts:
#   --check exits 1 with a MISSING diagnostic and never the half-open wording,
#   --write restores the file BYTE-IDENTICALLY to canonical.
# The intact control asserts the resolved span equals the independently grepped lines.
#
# The live tree is never touched (everything happens in /tmp sandboxes).
set -u
cd "$(dirname "$0")/../../../../.."
REPO="$(pwd)"
EV="${EV_OUT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$EV/check4h-marker-prefix-fixtures.log"
: > "$LOG"
sha() { sha256sum "$1" | awk '{print $1}'; }

PAIRS=(
    "mpd-delta scope-overlap|quality-gates.js"
    "mpd-delta repair-scope|quality-gates.js"
    "mpd-delta task-contract|tools.js"
)

mkdir -p "$EV/cases"
{
    echo "=== marker prefix fixtures (one per colliding pair) ==="
    echo "repo = $REPO"
} >> "$LOG" 2>&1

for pair in "${PAIRS[@]}"; do
    ID="${pair%%|*}"
    FILE="${pair##*|}"
    for SHAPE in begin end; do
        SLUG="$(echo "${ID#mpd-delta }-$SHAPE" | tr ' ' '-')"
        SB="$(mktemp -d /tmp/mpd-w3-marker-XXXXXX)"
        mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
        cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
        for f in quality-gates.js tools.js mpd-deltas.js; do
            cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
        done
        CANON="$SB/canonical.js"
        cp "$REPO/packages/mpd-agent-teams-plugin/lib/$FILE" "$CANON"
        TARGET="$SB/packages/mpd-agent-teams-plugin/lib/$FILE"
        python3 - "$TARGET" "$ID" "$SHAPE" <<'PY' >> "$LOG" 2>&1
import sys
path, rid, shape = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().split("\n")
want = f"//#region {rid} (" if shape == "begin" else f"//#endregion {rid}"
find = (lambda line: line.strip().startswith(want)) if shape == "begin" else (lambda line: line.strip() == want)
at = next(i for i, line in enumerate(lines) if find(line))
lines.pop(at)
open(path, "w").write("\n".join(lines))
print(f"  fixture: dropped the outer {shape} marker line {at + 1} for {rid}")
PY
        {
            echo
            echo "--- $SLUG ---"
            echo "check:"
            ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ) > "$SB/check.log" 2>&1
            CHECK_RC=$?
            sed 's/^/    /' "$SB/check.log"
            echo "    check_exit=$CHECK_RC"
            echo "write:"
            ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ) > "$SB/write.log" 2>&1
            WRITE_RC=$?
            sed 's/^/    /' "$SB/write.log"
            echo "    write_exit=$WRITE_RC"
            echo "post:"
            ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ) > "$SB/post.log" 2>&1
            POST_RC=$?
            sed 's/^/    /' "$SB/post.log"
            echo "    post_exit=$POST_RC"
            echo "    diff-lines=$(diff "$TARGET" "$CANON" | wc -l)"
            echo "    byte-identical-to-canonical=$( [ "$(sha "$TARGET")" = "$(sha "$CANON")" ] && echo yes || echo NO )"
        } >> "$LOG" 2>&1
        cp "$LOG" "$EV/cases/$SLUG.log"
        rm -rf "$SB"
    done
done

# intact control: the resolved span equals the independently grepped line numbers
SB="$(mktemp -d /tmp/mpd-w3-marker-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
for f in quality-gates.js tools.js mpd-deltas.js; do
    cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
done
{
    echo
    echo "--- intact control (resolved span must equal the grepped line numbers, 1-based) ---"
    ( cd "$SB" && node -e '
import { readFileSync } from "node:fs";
import { findRegion } from "./scripts/patch-agent-teams-fixes.mjs";
const pairs = [["mpd-delta scope-overlap", "quality-gates.js"], ["mpd-delta repair-scope", "quality-gates.js"], ["mpd-delta task-contract", "tools.js"]];
for (const [id, file] of pairs) {
    const lines = readFileSync("./packages/mpd-agent-teams-plugin/lib/" + file, "utf8").split("\n");
    const found = findRegion(lines, id);
    const begin = lines.findIndex((line) => new RegExp("^\\s*//#region " + id + " \\(").test(line));
    const end = lines.findIndex((line) => line.trim() === "//#endregion " + id);
    const ok = found.begin === begin && found.end === end;
    console.log(`    ${id} @ ${file}: resolved begin/end = ${found.begin + 1}/${found.end + 1} (1-based), grepped = ${begin + 1}/${end + 1}, match=${ok}`);
}
' ) 2>&1
    echo "    control_check:"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ) > "$SB/control.log" 2>&1
    CONTROL_RC=$?
    sed 's/^/    /' "$SB/control.log"
    echo "    control_check_exit=$CONTROL_RC"
} >> "$LOG" 2>&1
rm -rf "$SB"

python3 - "$LOG" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
blocks = re.findall(r"--- ([a-z0-9-]+) ---\n(.*?)(?=\n--- |\n\Z)", log, re.S)
cases = []
for slug, body in blocks:
    if slug == "intact control (resolved span must equal the grepped line numbers, 1-based)":
        continue
    cases.append({
        "case": slug,
        "check_exit": int(re.search(r"check_exit=(\d+)", body).group(1)),
        "write_exit": int(re.search(r"write_exit=(\d+)", body).group(1)),
        "post_exit": int(re.search(r"post_exit=(\d+)", body).group(1)),
        "missing_diagnostic": "MISSING from" in body,
        "half_open_wording": "half-open" in body,
        "diff_lines": int(re.search(r"diff-lines=(\d+)", body).group(1)),
        "byte_identical": "byte-identical-to-canonical=yes" in body,
    })
control_match = len(re.findall(r"match=true", log))
res = {
    "driver": "check4h-marker-prefix-fixtures",
    "scenario": "one fixture per colliding marker pair, both dangling shapes, plus the intact control",
    "cases": cases,
    "control_spans_match_grep": control_match,
    "control_check_exit": int(re.search(r"control_check_exit=(\d+)", log).group(1)) if re.search(r"control_check_exit=(\d+)", log) else None,
}
res["passed"] = all(c["check_exit"] == 1 and not c["half_open_wording"] and c["missing_diagnostic"] and c["write_exit"] == 0 and c["post_exit"] == 0 and c["diff_lines"] == 0 and c["byte_identical"] for c in cases) and res["control_spans_match_grep"] == 3 and res["control_check_exit"] == 0
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps(res, indent=2))
PY
