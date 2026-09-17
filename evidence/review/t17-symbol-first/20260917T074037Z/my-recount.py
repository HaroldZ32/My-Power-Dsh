#!/usr/bin/env python3
# t17 reviewer's INDEPENDENT recount of the anchor-shape split (19 symbol-first / 30 line-dependent).
# Built from the RULE, not from the checker's code: an inline anchor clause is
#   `CLAIM`, `path/to/file.ext[:LINE[-LINE]]`
# and the two accepted shapes are SYMBOL-FIRST (no line) and LINE-DEPENDENT (line present).
import re, json, sys, os

REPO = "/root/dshProj/my-power-dsh"
SUBJECTS = [
    ("docs/extension-authoring-guide.md", None),
    ("docs/extension-authoring-guide.zh-CN.md", None),
    ("EXTENSIONS-FOR-AGENTS.md", None),
    ("docs/extension-adaptation-report.md", re.compile(r"^## 12\.")),
    ("docs/extension-adaptation-report.zh-CN.md", re.compile(r"^## 12\.")),
]
# my own clause regex: claim in backticks, optional comma/space, path (>=1 slash) + optional :line[-line]
CLAUSE = re.compile(r"`([^`]+)`\s*[,，]?\s*\(?\s*`((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?::(\d+)(?:[-–](\d+))?)?`")
# my own bare path citation regex (path with optional :line), used as a cross-check
BARE = re.compile(r"(?<![\w/.-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?")

out = {"instrument": "t17 reviewer independent recount (own regexes)", "subjects": {}, "totals": {}}
tot = {"clauses_line_free": 0, "clauses_line_bearing": 0, "bare_path_citations": 0, "bare_path_citations_with_line": 0}
for path, heading in SUBJECTS:
    text = open(os.path.join(REPO, path), encoding="utf8").read()
    if heading is not None:
        lines = text.split("\n")
        start = next(i for i, line in enumerate(lines) if heading.match(line))
        text = "\n".join(lines[start:])
    clauses = CLAUSE.findall(text)
    line_free = [c for c in clauses if c[2] == ""]
    line_bearing = [c for c in clauses if c[2] != ""]
    bares = BARE.findall(text)
    entry = {
        "doc_lines_analyzed": len(text.split("\n")),
        "clause_line_free": len(line_free),
        "clause_line_bearing": len(line_bearing),
        "bare_path_citations": len(bares),
        "bare_path_citations_with_line": len([b for b in bares if b[1] != ""]),
        "line_free_claims": sorted({c[0] for c in line_free}),
    }
    out["subjects"][path] = entry
    tot["clauses_line_free"] += len(line_free)
    tot["clauses_line_bearing"] += len(line_bearing)
    tot["bare_path_citations"] += len(bares)
    tot["bare_path_citations_with_line"] += len([b for b in bares if b[1] != ""])
out["totals"] = tot
# the checker reports path citations only (dirs/commands are other kinds); a clause is always a path claim
out["comparison"] = {
    "checker_symbol_only_anchors_verified": 19,
    "checker_line_dependent_anchors_verified": 30,
    "recount_line_free_clauses": tot["clauses_line_free"],
    "recount_line_bearing_clauses": tot["clauses_line_bearing"],
    "match_line_free": tot["clauses_line_free"] == 19,
    "match_line_bearing": tot["clauses_line_bearing"] == 30,
}
print(json.dumps(out, indent=2))
