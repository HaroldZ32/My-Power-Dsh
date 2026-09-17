#!/usr/bin/env python3
# t17 reviewer's replication of the SYMBOL-FIRST counter, to attribute the checker's 19 exactly and
# to separate "an anchor that carries its own symbol-first claim" from "a prose path mention that a
# sibling anchor's document-wide claim happens to verify".
import re, os, json

REPO = "/root/dshProj/my-power-dsh"
SUBJECTS = [
    ("docs/extension-authoring-guide.md", "human guide (EN)", None),
    ("docs/extension-authoring-guide.zh-CN.md", "human guide (zh-CN)", None),
    ("EXTENSIONS-FOR-AGENTS.md", "agent contract", None),
    ("docs/extension-adaptation-report.md", "report status section (EN)", re.compile(r"^## 12\.")),
    ("docs/extension-adaptation-report.zh-CN.md", "report status section (zh-CN)", re.compile(r"^## 12\.")),
]
PATH_RE = re.compile(r"(?<![\w/.-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?")
CLAIM_RE = re.compile(r"`([^`]+)`\s*[,，]?\s*\(?\s*`((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?::(\d+)(?:[-–](\d+))?)?`")
SYMBOL = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$")
QUOTED = re.compile(r'^"(.*)"$')
ANNOT = re.compile(r"citation-check:\s*(pending|illustrative)\s*:?\s*(.*?)\s*-->")

def claim_text(claim):
    m = QUOTED.match(claim)
    if m: return m.group(1)
    if SYMBOL.match(claim): return claim
    return None

report = {"counted_symbol_first": [], "counted_without_own_clause": [], "per_subject": {}}
total = 0
for path, label, heading in SUBJECTS:
    full = open(os.path.join(REPO, path), encoding="utf8").read()
    offset = 0
    text = full
    if heading is not None:
        lines_all = full.split("\n")
        start = next(i for i, line in enumerate(lines_all) if heading.match(line))
        offset = start
        text = "\n".join(lines_all[start:])
    # claims: document-wide, document order (the checker's entry.claims)
    claims = [{"claim": m.group(1), "path": m.group(2), "line": None if m.group(3) is None else int(m.group(3)), "docLine": offset + text[:m.start()].count("\n") + 1} for m in CLAIM_RE.finditer(text)]
    # citations, with the checker's annotation semantics (annotation applies to the NEXT line; a fence carries its opening flag)
    in_fence = False; fence_flag = None; next_flag = None; citations = []
    for index, line in enumerate(text.split("\n")):
        doc_line = offset + index + 1
        if line.startswith("```"):
            if not in_fence:
                fence_flag = next_flag; next_flag = None
            else:
                fence_flag = None
            in_fence = not in_fence
            continue
        flag = fence_flag if in_fence else next_flag
        if not in_fence:
            next_flag = None
            m = ANNOT.search(line)
            if m: next_flag = m.group(1)
        for m in PATH_RE.finditer(line):
            citations.append({"value": m.group(1), "line": None if m.group(2) is None else int(m.group(2)), "docLine": doc_line, "flag": flag})
    sub = {"citations": len(citations), "line_free": 0, "counted": 0, "counted_own_clause": 0, "counted_prose_mention": 0}
    for cit in citations:
        if cit["flag"] is not None:
            continue
        if cit["line"] is not None:
            continue
        sub["line_free"] += 1
        own = [c for c in claims if c["path"] == cit["value"] and c["line"] is None and abs(c["docLine"] - cit["docLine"]) <= 1]
        first = next((c for c in claims if c["path"] == cit["value"] and c["line"] is None), None)
        if first is None:
            continue
        text_claim = claim_text(first["claim"])
        if text_claim is None or len(text_claim) < 2:
            continue
        cited = open(os.path.join(REPO, cit["value"]), encoding="utf8").read() if os.path.exists(os.path.join(REPO, cit["value"])) else ""
        if text_claim not in cited:
            continue
        total += 1
        sub["counted"] += 1
        rec = {"subject": path, "docLine": cit["docLine"], "cited": cit["value"], "claim": first["claim"], "own_clause_at_site": bool(own)}
        report["counted_symbol_first"].append(rec)
        if own: sub["counted_own_clause"] += 1
        else:
            sub["counted_prose_mention"] += 1
            report["counted_without_own_clause"].append(rec)
    report["per_subject"][path] = sub
report["total_counted"] = total
report["checker_reported_symbol_only"] = 19
report["total_matches_checker"] = total == 19
report["counted_own_clause_total"] = sum(s["counted_own_clause"] for s in report["per_subject"].values())
report["counted_prose_mention_total"] = sum(s["counted_prose_mention"] for s in report["per_subject"].values())
print(json.dumps(report, indent=2))
