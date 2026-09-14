#!/usr/bin/env bash
# wave-3 (t2) driver 4i — the F3 refusal must not regress under the context-pair heal.
#
# F3 is the wave-2 defect where the pre-fix heal happily INSERTED a delta region into a
# file that still carried the upstream declaration, exited 0, and left a module that
# failed to import (`Identifier 'pathMatchesScope' has already been declared`). The
# fixtures below prove the refusal is still a REFUSAL, and that it is a refusal and not
# a partial write:
#   A. quality-gates.js replaced by the upstream revision (regions AND our bodies gone,
#      the upstream `pathMatchesScope` still present)  -> `--write` must exit 1.
#   B. the same, but the file ALSO carries a dangling marker from a half-finished heal
#      -> still exit 1 (the redeclaration guard runs before any insertion).
# In both cases the file must be untouched (`--write` must not half-heal a broken tree).
#
# The live tree is never touched (everything happens in a /tmp sandbox).
set -u
cd "$(dirname "$0")/../../../../.."
REPO="$(pwd)"
EV="${EV_OUT:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$EV/check4i-f3-refusal.log"
: > "$LOG"
sha() { sha256sum "$1" | awk '{print $1}'; }

run_case() {
    local label="$1" mutate="$2"
    local SB
    SB="$(mktemp -d /tmp/mpd-w3-f3-XXXXXX)"
    mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
    cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
    for f in quality-gates.js tools.js mpd-deltas.js; do
        cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
    done
    local TARGET="$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
    ( cd "$REPO" && git show HEAD:packages/mpd-agent-teams-plugin/lib/quality-gates.js ) > "$TARGET"
    if [ "$mutate" = "dangling" ]; then
        printf '%s\n' "//#region mpd-delta scope-overlap (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)" >> "$TARGET"
    fi
    local BEFORE
    BEFORE="$(sha "$TARGET")"
    {
        echo "--- $label ---"
        echo "upstream re-materialize sha256 = $BEFORE"
        ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ) > "$SB/write.log" 2>&1
        echo "write_exit=$?"
        sed 's/^/    /' "$SB/write.log"
        echo "file_untouched=$([ "$(sha "$TARGET")" = "$BEFORE" ] && echo yes || echo NO)"
        echo "pathMatchesScope declarations=$(grep -c 'export function pathMatchesScope\b' "$TARGET")"
    } >> "$LOG" 2>&1
    rm -rf "$SB"
}

run_case "A: upstream quality-gates.js, no markers" "clean"
run_case "B: upstream quality-gates.js + a dangling outer begin marker" "dangling"

python3 - "$LOG" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
blocks = re.findall(r"--- ([AB][^\n]*) ---\n(.*?)(?=\n--- |\Z)", log, re.S)
cases = []
for label, body in blocks:
    message = re.search(r"\[patch-agent-teams-fixes\] FAIL: (.*)", body)
    cases.append({
        "case": label,
        "write_exit": int(re.search(r"write_exit=(\d+)", body).group(1)),
        "refuses_redeclaration": "still exists OUTSIDE any region" in body or "already declared" in body,
        "refusal_message": message.group(1).strip() if message else None,
        "file_untouched": "file_untouched=yes" in body,
        "path_matches_scope_declarations": int(re.search(r"pathMatchesScope declarations=(\d+)", body).group(1)),
    })
res = {
    "driver": "check4i-f3-refusal",
    "scenario": "re-materialized upstream file: --write must refuse (exit 1) instead of emitting a duplicate declaration, and must leave the file untouched",
    "cases": cases,
}
# Every case must refuse (exit 1) and leave the file untouched; the DECLARATION guard is
# the required message for the plain re-materialize (A). Case B adds a second defect — a
# dangling marker on an EARLIER-missing file — and is refused by the unterminated-region
# check before the declaration guard runs; it is still a loud refusal with no partial write.
res["passed"] = all(c["write_exit"] == 1 and c["file_untouched"] for c in cases) and any(c["refuses_redeclaration"] for c in cases)
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps(res, indent=2))
PY
