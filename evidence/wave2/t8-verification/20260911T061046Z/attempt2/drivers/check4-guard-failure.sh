#!/usr/bin/env bash
# t8 verification driver 4/4 — vendor-refresh durability guard, WITH its failure mode exercised.
#
# Runs the real guard CLI (`scripts/patch-agent-teams-fixes.mjs`) against:
#   S1  the REAL tree (verify-only, must be green) — read-only, nothing is written
#   S2+ a SANDBOX copy that is byte-identical to the live files (sha256-compared below),
#       where the failure modes are actually triggered and then restored.
# The live adopted tree is never mutated by this driver: other members are working in it.
#
# Usage: bash check4-guard-failure.sh
set -u
cd "$(dirname "$0")/../../../../../.."
REPO="$(pwd)"
EV="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$EV/check4-guard.log"
RESULT="$EV/check4-guard.raw.json"
: > "$LOG"
# sha256sum everywhere below is a coreutils tool; keep one invocation helper.
sha() { sha256sum "$1" | awk '{print $1}'; }

SB="$(mktemp -d /tmp/mpd-t8-guard-XXXXXX)"
mkdir -p "$SB/scripts" "$SB/packages/mpd-agent-teams-plugin/lib"
cp "$REPO/scripts/patch-agent-teams-fixes.mjs" "$SB/scripts/"
for f in quality-gates.js tools.js mpd-deltas.js; do
    cp "$REPO/packages/mpd-agent-teams-plugin/lib/$f" "$SB/packages/mpd-agent-teams-plugin/lib/$f"
done

G="$REPO/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
S="$SB/packages/mpd-agent-teams-plugin/lib/quality-gates.js"
PRISTINE="$SB/quality-gates.pristine.js"
cp "$S" "$PRISTINE"

run() { # run <label> <cwd> <args...>
    local label="$1"; shift
    local cwd="$1"; shift
    local out rc
    out="$(cd "$cwd" && node scripts/patch-agent-teams-fixes.mjs "$@" 2>&1)"
    rc=$?
    {
        echo "### $label"
        echo "cmd: node scripts/patch-agent-teams-fixes.mjs $*   (cwd=$cwd)"
        echo "exit=$rc"
        echo "$out"
        echo
    } >> "$LOG"
    printf '%s' "$rc"
}

echo "=== t8 durability guard exercise ===" >> "$LOG"
echo "repo=$REPO" >> "$LOG"
echo "sandbox=$SB" >> "$LOG"
echo "live    sha256 quality-gates.js = $(sha "$G")" >> "$LOG"
echo "sandbox sha256 quality-gates.js = $(sha "$S")" >> "$LOG"
echo "sandbox-binds-live=$( [ "$(sha "$G")" = "$(sha "$S")" ] && echo yes || echo NO )" >> "$LOG"
echo >> "$LOG"

RC_S1="$(run "S1 real tree --check (read-only)" "$REPO" --check)"
RC_S2="$(run "S2 sandbox pristine --check" "$SB" --check)"

# --- S3: drop the region (a re-vendor that loses our markers) ---
python3 - "$S" <<'PY' >> "$LOG" 2>&1
import sys
p=sys.argv[1]; src=open(p).read().split("\n")
out=[]; i=0; dropped=[]
while i < len(src):
    if "//#region mpd-delta " in src[i]:
        rid=src[i].split("//#region ")[1].split(" (")[0]
        end=next((j for j in range(i+1,len(src)) if src[j].strip()==f"//#endregion {rid}"), None)
        if end is None:
            raise SystemExit("unterminated region "+rid)
        dropped.append(rid); i=end+1; continue
    out.append(src[i]); i+=1
open(p,"w").write("\n".join(out))
print("stripped regions:", ", ".join(dropped))
PY
RC_S3="$(run "S3 sandbox, scope-glob region STRIPPED, --check must REFUSE" "$SB" --check)"
RC_S3W="$(run "S3b same stripped tree, --write must RESTORE it" "$SB" --write)"
S3_RESTORED="$( [ "$(sha "$S")" = "$(sha "$PRISTINE")" ] && echo yes || echo no )"
RC_S3V="$(run "S3c restored tree, --check must verify byte-identical" "$SB" --check)"

# --- S4: drop the region AND its anchor line (adopted-file drift) ---
ANCHOR="$(cd "$REPO" && node -e 'import("./packages/mpd-agent-teams-plugin/lib/mpd-deltas.js").then((m)=>{const d=m.MPD_DELTAS.find((x)=>x.id==="mpd-delta scope-glob");process.stdout.write(d.anchor)})')"
python3 - "$S" "$ANCHOR" <<'PY' >> "$LOG" 2>&1
import sys
p=sys.argv[1]; anchor=sys.argv[2]
src=open(p).read().split("\n")
out=[]; i=0; dropped=[]; anchor_hits=0
while i < len(src):
    if src[i] == anchor:
        anchor_hits += 1; i += 1; continue           # the anchor line is GONE (renamed upstream)
    if "//#region mpd-delta " in src[i]:
        rid=src[i].split("//#region ")[1].split(" (")[0]
        end=next((j for j in range(i+1,len(src)) if src[j].strip()==f"//#endregion {rid}"), None)
        dropped.append(rid); i=end+1; continue
    out.append(src[i]); i+=1
open(p,"w").write("\n".join(out))
print("stripped regions:", ", ".join(dropped), "| anchor line removed:", anchor_hits, "| anchor=", repr(anchor.strip()[:80]))
PY
RC_S4C="$(run "S4 drift: region + anchor gone, --check" "$SB" --check)"
RC_S4="$(run "S4b drift: region + anchor gone, --write must REFUSE naming the drift" "$SB" --write)"

# --- S5: region kept but its body rewritten (silent edit) ---
# The target region is DISCOVERED from the file, never hard-coded: attempt 1 hard-coded
# `scope-glob-core`, which the repair merged into `scope-glob`, so a hard-coded driver
# would silently no-op here instead of exercising the mismatch.
cp "$PRISTINE" "$S"
python3 - "$S" <<'PY' >> "$LOG" 2>&1
import re, sys
p=sys.argv[1]; src=open(p).read().split("\n")
for i,line in enumerate(src):
    m=re.match(r"\s*//#region (mpd-delta [A-Za-z0-9-]+) \(", line)
    if not m:
        continue
    rid=m.group(1)
    end=next((j for j in range(i+1,len(src)) if src[j].strip()==f"//#endregion {rid}"), None)
    if end is None:
        raise SystemExit(f"unterminated region {rid}")
    # mutate the first executable line INSIDE the region (a silent post-vendor edit)
    j=next((k for k in range(i+1,end) if "return" in src[k]), None)
    if j is None:
        continue
    src[j] = src[j].replace("return", "return /*drift*/", 1)
    print(f"mutated region {rid} body at line {j+1} -> {src[j].strip()[:110]}")
    break
else:
    raise SystemExit("no mutable mpd-delta region found in quality-gates.js")
open(p,"w").write("\n".join(src))
PY
RC_S5="$(run "S5 region present but body edited, --check must REFUSE a mismatch" "$SB" --check)"
cp "$PRISTINE" "$S"
RC_S6="$(run "S6 pristine restored, --check green again" "$SB" --check)"

echo "live    sha256 AFTER all exercises = $(sha "$G")" >> "$LOG"
echo "sandbox sha256 AFTER all exercises = $(sha "$S")" >> "$LOG"

RC_S1="$RC_S1" RC_S2="$RC_S2" RC_S3="$RC_S3" RC_S3W="$RC_S3W" RC_S3V="$RC_S3V" \
RC_S4C="$RC_S4C" RC_S4="$RC_S4" RC_S5="$RC_S5" RC_S6="$RC_S6" \
S3_RESTORED="$S3_RESTORED" SB="$SB" LOG="$LOG" RESULT="$RESULT" \
LIVE_SHA_BEFORE="$(sha "$G")" \
python3 - <<'PY'
import json, os, re
log = open(os.environ["LOG"]).read()
def section(label):
    m = re.search(r"### " + re.escape(label) + r"\n(.*?)(?=\n### |\Z)", log, re.S)
    return m.group(1).strip() if m else ""
def rc_value(name):
    return int(os.environ[name])
res = {
    "driver": "check4-guard-failure",
    "live_tree_mutated": False,
    "sandbox": os.environ["SB"],
    "steps": [
        {"step": "S1 real tree --check (read-only)", "exit": rc_value("RC_S1"), "expected": "0 (already applied)", "output": section("S1 real tree --check (read-only)")},
        {"step": "S2 sandbox byte-identical --check", "exit": rc_value("RC_S2"), "expected": "0", "output": section("S2 sandbox pristine --check")},
        {"step": "S3 region stripped -> --check must REFUSE", "exit": rc_value("RC_S3"), "expected": "1 + MISSING", "output": section("S3 sandbox, scope-glob region STRIPPED, --check must REFUSE")},
        {"step": "S3b --write restores", "exit": rc_value("RC_S3W"), "expected": "0 + applied", "output": section("S3b same stripped tree, --write must RESTORE it")},
        {"step": "S3c restored --check", "exit": rc_value("RC_S3V"), "expected": "0", "output": section("S3c restored tree, --check must verify byte-identical")},
        {"step": "S4 drift: region+anchor gone -> --check", "exit": rc_value("RC_S4C"), "expected": "1", "output": section("S4 drift: region + anchor gone, --check")},
        {"step": "S4b drift: --write must REFUSE", "exit": rc_value("RC_S4"), "expected": "1 + anchor gone", "output": section("S4b drift: region + anchor gone, --write must REFUSE naming the drift")},
        {"step": "S5 region body edited -> --check must REFUSE", "exit": rc_value("RC_S5"), "expected": "1 + no longer matches", "output": section("S5 region present but body edited, --check must REFUSE a mismatch")},
        {"step": "S6 pristine restored -> --check", "exit": rc_value("RC_S6"), "expected": "0", "output": section("S6 pristine restored, --check green again")},
    ],
    "sandbox_restored_byte_identical": os.environ["S3_RESTORED"] == "yes",
    "live_sha256_before": os.environ["LIVE_SHA_BEFORE"],
    "live_sha256_after": [line.split("=")[-1].strip() for line in log.splitlines() if line.startswith("live    sha256 AFTER")][0],
}
res["live_untouched"] = res["live_sha256_before"] == res["live_sha256_after"]
passed = all(row["exit"] == int(row["expected"].split()[0]) for row in res["steps"]) and res["sandbox_restored_byte_identical"] and res["live_untouched"]
res["passed"] = passed
open(os.environ["RESULT"], "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps({k: v for k, v in res.items() if k != "steps"}, indent=2))
for row in res["steps"]:
    first = row["output"].splitlines()
    tail = first[3] if len(first) > 3 else (first[-1] if first else "")
    print(f"  {row['exit']} (want {row['expected']:<28}) {row['step']:<52} {tail[:90]}")
PY
rm -rf "$SB"
