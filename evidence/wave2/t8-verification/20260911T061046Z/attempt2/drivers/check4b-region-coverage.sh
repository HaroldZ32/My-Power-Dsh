#!/usr/bin/env bash
# t8 verification driver 4b (attempt 2) — region coverage of the adopted-file diff.
#
# Every ADDED line in `git diff --unified=0 HEAD -- <adopted file>` must fall inside a registered
# `mpd-delta` region span; an added executable line outside every region is unmarked and therefore
# unrestorable by the re-applier (t4 acceptance 4 / finding F2). Read-only.
set -u
cd "$(dirname "$0")/../../../../../.."
REPO="$(pwd)"
EV="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$REPO" "$EV" <<'PY'
import json, re, subprocess, sys
repo, ev = sys.argv[1], sys.argv[2]
files = [
    "packages/mpd-agent-teams-plugin/lib/quality-gates.js",
    "packages/mpd-agent-teams-plugin/lib/tools.js",
]
out = {"driver": "check4b-region-coverage", "files": {}, "added_lines_outside_regions": 0}
for f in files:
    src = open(f"{repo}/{f}").read().split("\n")
    regions = []
    i = 0
    while i < len(src):
        m = re.match(r"\s*//#region (mpd-delta [A-Za-z0-9-]+) \(mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes\.mjs\)", src[i])
        if m:
            rid = m.group(1)
            end = next((j for j in range(i + 1, len(src)) if src[j].strip() == f"//#endregion {rid}"), None)
            regions.append({"id": rid, "begin": i + 1, "end": end + 1})
            i = end + 1
            continue
        i += 1
    diff = subprocess.run(["git", "diff", "--unified=0", "HEAD", "--", f], cwd=repo, capture_output=True, text=True).stdout
    added, outside, hunk = [], [], None
    for line in diff.splitlines():
        m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if m:
            hunk = int(m.group(1))
            continue
        if line.startswith("+") and not line.startswith("+++"):
            added.append(hunk)
            if not any(r["begin"] <= hunk <= r["end"] for r in regions):
                outside.append({"line": hunk, "text": line[1:][:110]})
            hunk += 1
        elif line.startswith(" ") and hunk is not None:
            hunk += 1
    out["files"][f] = {"regions": regions, "added_lines": len(added), "outside": outside}
    out["added_lines_outside_regions"] += len(outside)
    print(f"{f}: regions={len(regions)} added={len(added)} outside={len(outside)}")
    for r in regions:
        print("   ", r["id"], f"L{r['begin']}-{r['end']}")
    for o in outside[:12]:
        print("    OUTSIDE:", o["line"], repr(o["text"]))
out["passed"] = out["added_lines_outside_regions"] == 0
json.dump(out, open(f"{ev}/check4b-region-coverage.raw.json", "w"), indent=2)
print(json.dumps({"passed": out["passed"], "added_lines_outside_regions": out["added_lines_outside_regions"]}))
PY
