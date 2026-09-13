#!/usr/bin/env python3
"""Build the pass-E census for the repo-local RTL residual sweep (t1).

Inputs (all under evidence/rtl-extraction-residual/repo-scan/raw/):
  passA1-tracked-names.log   name hits, tracked files
  passA3-all-names.log       name hits, filesystem-wide (tracked+untracked+ignored)
  passB1-tracked-content.log content hits, broad prescribed keyword set (tracked)
  passB1c-precision-content.log content hits, RTL/EDA-precise tokens (tracked)
Outputs:
  census.tsv     one row per distinct hit path: path, hit_kinds, tracked_status, bucket, verdict, severity
  counts.json    the numbers quoted in findings.md / summary.json
"""
import json, os, re, subprocess, sys, collections

RAW = os.path.dirname(os.path.abspath(__file__))
REPO = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, cwd=RAW).stdout.strip()

def read(path):
    try:
        return open(os.path.join(RAW, path), encoding="utf-8", errors="replace").read().split("\n")
    except FileNotFoundError:
        return []

tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=REPO).stdout.split("\n"))
untracked = set(subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], capture_output=True, text=True, cwd=REPO).stdout.split("\n"))
ignored = set(subprocess.run(["git", "ls-files", "--others", "--ignored", "--exclude-standard"], capture_output=True, text=True, cwd=REPO).stdout.split("\n"))

A1 = [l.strip() for l in read("passA1-tracked-names.log") if l.strip() and not l.startswith("#")]
A3 = [l.strip()[2:] for l in read("passA3-all-names.log") if l.strip() and not l.startswith("#")]
def paths_from_content(log):
    out = set()
    for l in read(log):
        if not l or l.startswith("#") or ":" not in l:
            continue
        cand = l.split(":", 1)[0]
        if cand in ("files", "hits") or " " in cand:
            continue
        out.add(cand)
    return {p for p in out if p}

B1 = paths_from_content("passB1-tracked-content.log")
B1c = paths_from_content("passB1c-precision-content.log")

NAME_PRECISE = re.compile(
    r"(^|[/_.-])rtl([/_.-]|$)|verilog|systemverilog|vhdl|iverilog|verilator|verible|cocotb|(^|[/_.-])uvm([/_.-]|$)"
    r"|mpd-verif|silicon|\.sv$|\.svh$|\.v$|\.vh$|adder4|cnt8|ecap|verible-verilog-ls|slang-server", re.I)

hits = collections.defaultdict(set)   # path -> {'name','content','content-precise'}
for p in A1:
    hits[p].add("name")
for p in A3:
    hits[p].add("name")
for p in B1:
    hits[p].add("content")
for p in B1c:
    hits[p].add("content-precise")

def status(p):
    if p in tracked: return "TRACKED"
    if p in untracked: return "UNTRACKED"
    if p in ignored: return "IGNORED"
    if p.startswith("evidence/rtl-extraction-residual"): return "UNTRACKED"
    return "ABSENT"

def precise(p, kinds):
    return bool(NAME_PRECISE.search(p)) or "content-precise" in kinds

# prefix -> (bucket, verdict, severity)
RULES = [
    ("evidence/rtl-extraction-residual/",                 ("AUDIT-EVIDENCE", "ACCEPTABLE", "none")),
    ("evidence/",                                          ("PROCESS-RECORD", "ACCEPTABLE", "none")),
    ("t5-closure-evidence/",                               ("PROCESS-RECORD", "ACCEPTABLE", "none")),
    (".silicon-extraction/removal.log",                    ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("docs/rtl-verif-guide",                               ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "high")),
    ("docs/rtl-ip-flow-guide",                             ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "high")),
    ("docs/rtl-gap-assessment",                            ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "high")),
    ("skills/dsh-qa/scripts/rtl-verif.mjs",                ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "high")),
    ("skills/dsh-qa/scripts/rtl-ip-profile.mjs",           ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "high")),
    ("packages/mpd-mcp-lsp/templates/rtl-lsp-client.json", ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("packages/mpd-mcp-lsp/README.md",                     ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("packages/mpd-mcp-lsp/README.zh-CN.md",               ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("packages/mpd-bundle/README.md",                      ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("packages/mpd-bundle/README.zh-CN.md",                ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("skills/dsh-qa/SKILL.md",                             ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("docs/index.md",                                      ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("docs/index.zh-CN.md",                                ("FULL-STRIP-DEFECT", "IN-SCOPE-DEFECT", "medium")),
    ("docs/adder4.md",                                     ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("docs/cnt8.md",                                       ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("tests/golden/fixtures/verilog/",                     ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("docs/track-a-report.md",                             ("PROCESS-RECORD", "ACCEPTABLE", "none")),
    ("docs/review-p0-p3.md",                               ("PROCESS-RECORD", "ACCEPTABLE", "none")),
    ("packages/mpd-mcp-lsp/overlay/",                      ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("packages/mpd-mcp-lsp/dist/cli.js",                   ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("skills/lsp-setup/",                                  ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("scripts/verify-rtl-references.mjs",                  ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("scripts/install-mcp.mjs",                            ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("scripts/build-mcp.mjs",                              ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("scripts/pack-mpd.mjs",                               ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("packages/mpd-bundle/cordis.patch.yml",               ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "low")),
    ("package.json",                                       ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "none")),
    ("AGENTS.md",                                          ("PROCESS-RECORD", "ACCEPTABLE", "low")),
    (".gitignore",                                         ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "low")),
    ("PLAN.md",                                            ("PROCESS-RECORD", "ACCEPTABLE", "none")),
    (".venv-rtl/",                                         ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".toolchain/bin/",                                    ("BRIDGE-BY-DESIGN", "ACCEPTABLE", "low")),
    (".toolchain/",                                        ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".mpd/",                                              ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    ("dist/",                                              ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".qa-reloc/",                                         ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".qa-tmp/",                                           ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".qa-web-client/",                                    ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".tmp-cache/",                                        ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".mpd-dsh/",                                          ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".dsh/",                                              ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".codegraph/",                                        ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    ("node_modules/",                                      ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    (".npm-cache/",                                        ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    ("20260911T094211Z.tmp",                               ("UNTRACKED-BUILD-ARTIFACT", "ACCEPTABLE", "low")),
    ("packages/mpd-workmate-plugin/test/",                 ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("packages/mpd-agent-teams-plugin/self-fix-tests/",    ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("packages/mpd-bootstrap-plugin/test/",                ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("packages/mpd-bundle-plugin/test/",                   ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("packages/mpd-qa-roles-probe/",                       ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("skills/dsh-qa/scripts/dual-track-smoke.mjs",         ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("skills/dsh-qa/scripts/workmate-library.mjs",         ("TEST-STRING-DATA", "ACCEPTABLE", "none")),
    ("skills/frontend/references/design/layout-skill.md",  ("KEYWORD-FALSE-POSITIVE", "ACCEPTABLE", "none")),
    ("README.md",                                          ("KEYWORD-FALSE-POSITIVE", "ACCEPTABLE", "none")),
    ("README.zh-CN.md",                                    ("KEYWORD-FALSE-POSITIVE", "ACCEPTABLE", "none")),
]

rows = []
for p in sorted(hits):
    kinds = ",".join(sorted(hits[p]))
    st = status(p)
    if not precise(p, hits[p]):
        bucket, verdict, sev = "KEYWORD-FALSE-POSITIVE", "ACCEPTABLE", "none"
    else:
        bucket = verdict = sev = None
        for pre, rule in RULES:
            if p == pre.rstrip("/") or p.startswith(pre):
                bucket, verdict, sev = rule
                break
        if bucket is None:
            bucket, verdict, sev = "REVIEW", "REVIEW", "review"
    rows.append((p, kinds, st, bucket, verdict, sev))

with open(os.path.join(RAW, "census.tsv"), "w", encoding="utf-8") as f:
    f.write("path\thit_kinds\ttracked_status\tbucket\tverdict\tseverity\n")
    for r in rows:
        f.write("\t".join(r) + "\n")

cnt = collections.Counter()
for r in rows:
    cnt[(r[2], r[4])] += 1
per_bucket = collections.Counter(r[3] for r in rows)
defects = [r for r in rows if r[4] == "IN-SCOPE-DEFECT"]
review = [r for r in rows if r[4] == "REVIEW"]
counts = {
    "head": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=REPO).stdout.strip(),
    "distinctHitPaths": len(rows),
    "trackedHitCount": sum(1 for r in rows if r[2] == "TRACKED"),
    "untrackedHitCount": sum(1 for r in rows if r[2] == "UNTRACKED"),
    "ignoredHitCount": sum(1 for r in rows if r[2] == "IGNORED"),
    "inScopeDefectCount": len(defects),
    "acceptableCount": sum(1 for r in rows if r[4] == "ACCEPTABLE"),
    "reviewCount": len(review),
    "byBucket": dict(per_bucket),
    "defects": [{"path": r[0], "severity": r[5], "why": r[3]} for r in defects],
}
with open(os.path.join(RAW, "counts.json"), "w", encoding="utf-8") as f:
    json.dump(counts, f, indent=2)
print(json.dumps(counts, indent=2))
print("REVIEW rows:")
for r in review:
    print("  ", r)
