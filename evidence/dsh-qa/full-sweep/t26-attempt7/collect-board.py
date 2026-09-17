#!/usr/bin/env python3
"""t26 attempt 7 — collect the multi-job board into one stitched summary.

Reads:
  · run 1's record  evidence/dsh-qa/full-sweep/20260917T034900Z-t26-attempt3/result.json   (pin 919656a8…)
  · run 2's record  evidence/dsh-qa/full-sweep/20260917T042800Z-t26-attempt3-run2/result.json (killed; witness)
  · every chunk      evidence/dsh-qa/full-sweep/t26-attempt7/c*/result.json
Emits: board.json + a human summary on stdout. Never claims a single-run complete:true.
"""
import json, os, glob, hashlib, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
RUN1 = os.path.join(BASE, "..", "20260917T034900Z-t26-attempt3", "result.json")
RUN2 = os.path.join(BASE, "..", "20260917T042800Z-t26-attempt3-run2", "result.json")

def load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return None

run1 = load(RUN1)
run2 = load(RUN2)
chunks = []
for p in sorted(glob.glob(os.path.join(BASE, "c*", "result.json"))):
    d = load(p)
    if not d:
        continue
    chunks.append({"dir": os.path.relpath(os.path.dirname(p), BASE), **{k: d.get(k) for k in
        ("manifestSha256", "selected", "startedAt", "finishedAt", "complete", "counts", "exitCode")},
        "lanes": [{"case": l.get("case"), "verdict": l.get("verdict"), "reason": l.get("reason"),
                   "durationMs": l.get("durationMs") or l.get("ms"),
                   "evidencePath": l.get("evidencePath")} for l in d.get("lanes", [])]})

lanes = {}
for c in chunks:
    for l in c["lanes"]:
        lanes[l["case"]] = {**l, "chunk": c["dir"], "runPin": c["manifestSha256"]}
# RUN 1 IS VOID (captain's ruling, 04:50Z): its settled-tree check (03:50:36Z/03:53Z) predates its own
# corpus writes (03:55:59Z cases.json, 03:58:13Z watchdog-redesign.mjs, 04:12:36Z team-watchdog-fault.mjs),
# so its settledness is unverifiable. Its two verdicts are NOT stitched into the board — they stay as
# HISTORICAL readings for the 919656a8… pin, recorded below, and every board verdict comes from a chunk run
# (all pinned 54585cab…, launched at/after 04:37Z, after the last corpus write).
historical_void = {
    "run": "20260917T034900Z-t26-attempt3",
    "pin": (run1 or {}).get("manifestSha256"),
    "killedShell": (run1 or {}).get("complete") is False and (run1 or {}).get("finishedAt") is None,
    "verdicts": [{"case": l.get("case"), "verdict": l.get("verdict"), "durationMs": l.get("durationMs") or l.get("ms")}
                 for l in (run1 or {}).get("lanes", [])],
    "why": "settled-tree check at 03:50:36Z/03:53Z predates its own corpus writes 03:55:59Z/03:58:13Z/04:12:36Z",
}

counts = {"pass": 0, "unavailable": 0, "fail": 0}
for l in lanes.values():
    v = l.get("verdict")
    if v in counts:
        counts[v] += 1

# split the entries into SELECTED (the 33 in suite `all`) vs ADDITIVE (the moved watchdog lane, re-run
# outside the completeness arithmetic per A4)
sel = set()
try:
    m = json.load(open("skills/dsh-qa/cases.json", encoding="utf-8"))
    sel = {x["case"] for x in [*m.get("lanes", []), *m.get("gates", [])] if "all" in (x.get("suites") or [])}
except Exception:
    pass
selected_cases = sorted(c for c in lanes if c in sel)
additive_cases = sorted(c for c in lanes if c not in sel)

# A1 clause 1, self-contained: the canonical-selection definition + its digest (see CANONICAL-SELECTION-PROOF.md)
canonical = {}
try:
    m2 = json.load(open("skills/dsh-qa/cases.json", encoding="utf-8"))
    e2 = [*m2.get("lanes", []), *m2.get("gates", [])]
    sel2 = [x for x in e2 if "all" in (x.get("suites") or [])]
    tuples = [(x["case"], x.get("script"), x.get("args"), x.get("suites")) for x in sel2]
    canonical = {
        "definition": "sha256(json.dumps([(case, script, args, suites) for each selected entry], sort_keys=True))",
        "manifestPins": {"current": hashlib.sha256(open("skills/dsh-qa/cases.json", "rb").read()).hexdigest()},
        "selectedCount": len(sel2),
        "hash": hashlib.sha256(json.dumps(tuples, sort_keys=True).encode()).hexdigest(),
        "corroboration": "watchdog-engineer's --list diff of the two pins: exactly one ADDED lane (watchdog-redesign, suites: []) ⇒ same 33 by (case, suites, script); bound: --list omits args and the old revision was overwritten in place",
    }
except Exception as exc:
    canonical = {"error": str(exc)}

board = {
    "task": "t26", "attemptId": "2cd3bfd1-b6e4-4d33-92d6-41a4f786381e",
    "note": "attempt 9 is the live attempt (the ledger advanced 6 -> 7 -> 9 while this board was being built; the artefacts under t26-attempt7/ are the same work)",
    "generatedAt": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
    "multiJob": True, "singleRunComplete": False,
    "selected": (run1 or {}).get("selected", 33),
    "lanesRun": len(lanes),
    "selectedEntriesCovered": len(selected_cases),
    "additiveEntries": additive_cases,
    "counts": counts,
    "runs": {
        "run1": {"pin": (run1 or {}).get("manifestSha256"), "complete": (run1 or {}).get("complete"),
                 "finishedAt": (run1 or {}).get("finishedAt"), "counts": (run1 or {}).get("counts"),
                 "note": "killed after 2 verdicts; the two verdicts are stitched"},
        "run2": {"pin": (run2 or {}).get("manifestSha256"), "complete": (run2 or {}).get("complete"),
                 "finishedAt": (run2 or {}).get("finishedAt"),
                 "note": "killed inside lane 1 — the bound's witness, no verdicts stitched"},
    },
    "chunks": chunks,
    "canonicalSelection": canonical,
    "historicalVoid": historical_void,
    "lanes": sorted(lanes.values(), key=lambda x: x.get("case") or ""),
}
json.dump(board, open(os.path.join(BASE, "board.json"), "w"), indent=2)

print(f"chunks: {len(chunks)} | lanes in board: {len(lanes)} / selected {board['selected']} | counts {counts}")
for c in chunks:
    print(f"  {c['dir']:28} complete={str(c['complete']):5} finishedAt={c['finishedAt']} pin={(c['manifestSha256'] or '')[:12]} lanes={len(c['lanes'])}")
missing = [x for x in lanes.values() if x.get("verdict") not in ("pass", "unavailable", "fail")]
print("lanes without a verdict:", [x["case"] for x in missing])
print("non-pass lanes:", [(x["case"], x["verdict"], x["reason"]) for x in lanes.values() if x.get("verdict") != "pass"])
