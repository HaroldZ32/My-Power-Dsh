#!/usr/bin/env python3
"""Emit every added line of this round's diff with its line number in the NEW file, then prove it.

Run from the repo root:
    python3 evidence/skills-dead-tokens/2026-10-25T0355Z/diff/gen-changed-lines.py

Why this exists: the round's contract requires `every changed line with its new text`, and a
diff alone does not carry the line number a reader needs to open the file. `-U0` diff hunks give
the new-file start line for each run of added lines; this script walks those headers, prints
`<path>:<line>: <text>` for every added line, and then RE-READS the working tree at that line and
compares the bytes. It prints `checked=<n> mismatched=<m>` and exits 1 if anything disagrees, so a
stale or hand-edited listing cannot pass as evidence.
"""
import re
import subprocess
import sys

DIFF = ["git", "diff", "-U0", "HEAD", "--", "skills/"]
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
PATH = re.compile(r"^\+\+\+ b/(.*)$")


def added_lines():
    """Return [(path, lineno, text)] for every added line in the -U0 diff against HEAD."""
    out = subprocess.run(DIFF, capture_output=True, text=True, check=True).stdout
    rows = []
    path = None
    lineno = 0
    for raw in out.splitlines():
        line = raw.rstrip("\n")
        m = PATH.match(line)
        if m:
            path = m.group(1)
            continue
        h = HUNK.match(line)
        if h:
            lineno = int(h.group(1))
            continue
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            rows.append((path, lineno, line[1:]))
            lineno += 1
    return rows


def main():
    """Print the listing, re-read each cited line, and exit 1 on any mismatch."""
    rows = added_lines()
    mismatched = 0
    for path, lineno, text in rows:
        print("%s:%d: %s" % (path, lineno, text))
    for path, lineno, text in rows:
        with open(path, encoding="utf-8") as fh:
            actual = fh.read().splitlines()[lineno - 1]
        if actual != text:
            print("MISMATCH %s:%d expected=%r actual=%r" % (path, lineno, text, actual),
                  file=sys.stderr)
            mismatched += 1
    print("checked=%d mismatched=%d" % (len(rows), mismatched))
    return 1 if mismatched else 0


if __name__ == "__main__":
    sys.exit(main())
