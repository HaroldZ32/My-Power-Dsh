#!/usr/bin/env python3
"""rev-B2 review: independent re-measurement of T-80's audit numbers.

My own scanner (NOT an import of the checker): the reviewer's job is to test the recorded numbers,
so this file re-derives them from the tree with its own code and prints the file lists behind them.
    python3 evidence/review/wave2b-laneB2/<stamp>/raw/audit-remeasure.py
"""
import json
import pathlib
import re

REPO = pathlib.Path("/root/dshProj/my-power-dsh")
KEY = re.compile(r'add\(\s*"A(\d+)')
TOK = re.compile(r"\bA(\d+)\b")
RANGE = re.compile(r"\bA(\d+)\s*[–-]\s*A?(\d+)\b")
MARK = re.compile(r"\b(claims?|claimed|asserts?|asserted|checks?|checked|covers?|covered|arms?|keys?|proves?|proof|must|expects?|expected)\b", re.I)
REF = re.compile(r"(design|acceptance|\bplan\b|§|\bt\d+\b)", re.I)
SKIP = {"node_modules", ".git"}


def walk(root, suffix):
    out = []
    for path in sorted(root.rglob(f"*{suffix}")):
        if any(part in SKIP for part in path.parts):
            continue
        if path.is_file():
            out.append(path)
    return out


def header_lines(text):
    kept = []
    for line in text.split("\n"):
        if line.startswith("#!") or not line.strip() or line.lstrip().startswith("//"):
            kept.append(re.sub(r"^\s*//\s?", "", line))
        else:
            break
    return kept


def keys(text):
    return sorted({int(m.group(1)) for m in KEY.finditer(text)})


def claims(text, naive=False):
    found = set()
    scope = False
    for body in header_lines(text):
        trimmed = body.strip()
        if trimmed == "":
            scope = False
            continue
        if not naive:
            if MARK.search(trimmed):
                scope = True
            if not scope or REF.search(trimmed):
                continue
        for m in RANGE.finditer(trimmed):
            lo, hi = int(m.group(1)), int(m.group(2))
            if hi >= lo and hi - lo <= 20:
                found.update(range(lo, hi + 1))
        for m in TOK.finditer(trimmed):
            found.add(int(m.group(1)))
    return found


scope_dir = REPO / "skills/dsh-qa/scripts"
recursive = [p for p in walk(scope_dir, ".mjs") if keys(p.read_text(errors="replace"))]
top = [p for p in sorted(scope_dir.glob("*.mjs")) if p.is_file() and keys(p.read_text(errors="replace"))]
js_assumption = [p for p in walk(scope_dir, ".js") if keys(p.read_text(errors="replace"))]
repo_wide = [p for p in walk(REPO, ".mjs") if keys(p.read_text(errors="replace"))]

rows = []
for path in recursive:
    text = path.read_text(errors="replace")
    k, c, n = keys(text), claims(text), claims(text, naive=True)
    rows.append({
        "path": str(path.relative_to(REPO)),
        "keys": k,
        "claims": sorted(c),
        "naive_claims": sorted(n),
        "claimed_but_unasserted": sorted(set(c) - set(k)),
        "asserted_but_unclaimed": sorted(set(k) - set(c)),
        "naive_claimed_but_unasserted": sorted(set(n) - set(k)),
        "naive_asserted_but_unclaimed": sorted(set(k) - set(n)),
    })

summary = {
    "recursive_key_producers_in_scope": [str(p.relative_to(REPO)) for p in recursive],
    "non_recursive_glob_key_producers": [str(p.relative_to(REPO)) for p in top],
    "js_assumption_key_producers": [str(p.relative_to(REPO)) for p in js_assumption],
    "repo_wide_mjs_key_producers_count": len(repo_wide),
    "repo_wide_mjs_key_producers": [str(p.relative_to(REPO)) for p in repo_wide],
    "naive_files_flagged": [r["path"] for r in rows if r["naive_claimed_but_unasserted"] or r["naive_asserted_but_unclaimed"]],
    "naive_keys_reported": sum(len(r["naive_claimed_but_unasserted"]) + len(r["naive_asserted_but_unclaimed"]) for r in rows),
    "precise_violations": sum(len(r["claimed_but_unasserted"]) + len(r["asserted_but_unclaimed"]) for r in rows),
    "rows": rows,
}
print(json.dumps(summary, indent=2))
