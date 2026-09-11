#!/usr/bin/env bash
# t8 verification driver 4d — re-vendor HEAL simulation (attempt 2: asserts REFUSAL).
#
# `scripts/vendor-agent-teams.mjs` calls the guard with write:true, i.e. the healing path.
# This driver simulates the hand re-materialize it exists for: our tools.js + mpd-deltas.js,
# quality-gates.js replaced by the upstream revision (`git show HEAD:`), then the healing pass.
#
# After the t13 repair the pass must REFUSE loudly and leave the file UNTOUCHED (the input file
# still carries the upstream declaration the region would redefine). The clean case — our own
# file with regions stripped — must still heal byte-identically; that half is check4's S3b/S3c.
# The live tree is never touched (everything happens in a /tmp sandbox).
set -u
cd "$(dirname "$0")/../../../../../.."
REPO="$(pwd)"
EV="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$EV/check4d-revendor-heal.log"
: > "$LOG"
sha() { sha256sum "$1" | awk '{print $1}'; }

SB="$(mktemp -d /tmp/mpd-t8-heal-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
cp "$REPO/packages/mpd-agent-teams-plugin/lib/tools.js" "$SB/packages/mpd-agent-teams-plugin/lib/tools.js"
cp "$REPO/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js" "$SB/packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"
git -C "$REPO" show HEAD:packages/mpd-agent-teams-plugin/lib/quality-gates.js > "$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
HEALED="$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
SHA_BEFORE="$(sha "$HEALED")"

{
    echo "=== re-vendor heal simulation (attempt 2) ==="
    echo "sandbox=$SB"
    echo "re-vendored quality-gates.js = HEAD revision ($(git -C "$REPO" rev-parse --short HEAD):packages/mpd-agent-teams-plugin/lib/quality-gates.js)"
    echo "input sha256 = $SHA_BEFORE"
    echo
    echo "--- --check before healing (verify-only refuses) ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ); echo "exit=$?"
    echo
    echo "--- --write (what vendor-agent-teams.mjs runs: applyAgentTeamsFixes({write:true})) ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write ); echo "exit=$?"
    echo
    echo "--- --check after the refused heal ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --check ); echo "exit=$?"
    echo
    echo "--- did the refused pass change the file? ---"
    echo "sha256 after = $(sha "$HEALED")"
    echo "file-unchanged=$( [ "$(sha "$HEALED")" = "$SHA_BEFORE" ] && echo yes || echo NO )"
    echo
    echo "--- declared pathMatchesScope occurrences in the (refused) file ---"
    grep -c "^export function pathMatchesScope" "$HEALED" || true
    echo
    echo "--- refusal diagnostic, verbatim ---"
    ( cd "$SB" && node scripts/patch-agent-teams-fixes.mjs --write 2>&1 | head -3 ) || true
} >> "$LOG" 2>&1

SHA_AFTER="$(sha "$HEALED")"
{
    echo "input_sha=$SHA_BEFORE"
    echo "output_sha=$SHA_AFTER"
} >> "$LOG"
rm -rf "$SB"

python3 - "$LOG" <<'PY'
import json, os, re, sys
log = open(sys.argv[1]).read()
def section(name):
    m = re.search(r"--- " + re.escape(name) + r" ---\n(.*?)(?=\n--- |\ninput_sha=|\Z)", log, re.S)
    return m.group(1).strip() if m else ""
def rc(label):
    m = re.search(r"--- " + re.escape(label) + r" ---\n(.*?)\nexit=(\d+)", log, re.S)
    return int(m.group(2)) if m else None
res = {
    "driver": "check4d-revendor-heal",
    "simulation": "our tools.js + mpd-deltas.js, quality-gates.js replaced by the upstream (HEAD) revision, then the guard's healing pass (write:true, exactly what scripts/vendor-agent-teams.mjs runs)",
    "check_before_heal": section("--check before healing (verify-only refuses)"),
    "heal_write": section("--write (what vendor-agent-teams.mjs runs: applyAgentTeamsFixes({write:true}))"),
    "check_after_heal": section("--check after the refused heal"),
    "file_unchanged_by_refused_pass": section("did the refused pass change the file?"),
    "pathMatchesScope_declarations": section("declared pathMatchesScope occurrences in the (refused) file"),
    "refusal_diagnostic": section("refusal diagnostic, verbatim"),
    "exit_codes": {
        "check_before_heal": rc("--check before healing (verify-only refuses)"),
        "heal_write": rc("--write (what vendor-agent-teams.mjs runs: applyAgentTeamsFixes({write:true}))"),
        "check_after_heal": rc("--check after the refused heal"),
    },
}
unchanged = "file-unchanged=yes" in res["file_unchanged_by_refused_pass"]
names_symbol = bool(re.search(r"pathMatchesScope|already been declared|already declared|every region|region", res["refusal_diagnostic"], re.I))
res["passed"] = (
    res["exit_codes"]["check_before_heal"] != 0
    and res["exit_codes"]["heal_write"] != 0
    and unchanged
    and names_symbol
)
json.dump(res, open(os.path.splitext(sys.argv[1])[0] + ".raw.json", "w"), indent=2)
print(json.dumps(res, indent=2)[:3200])
PY
