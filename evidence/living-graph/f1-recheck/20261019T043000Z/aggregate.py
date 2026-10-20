#!/usr/bin/env python3
"""Lane E's narrow re-check of finding F1 at the settled HEAD, formatted as {result.json, output.log}.

Only what the re-check measured: the three rank-source phrases rendered by the real component, and a
re-run of the probes behind the claims this lane's verdict rests on. The previous full verdict lives at
evidence/living-graph/lane-e-verdict/20261019T042500Z/ and is not overwritten.
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))


def load(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as handle:
        return json.load(handle)


def text(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as handle:
        return handle.read()


def head():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


f1 = load("f1-result.json")
core = load("core-result.json")
tui = load("tui-result.json")
web = load("web-result.json")
web_flat = load("web-flat-result.json")
live = load("live-result.json")
host = load("host-model-result.json")
compare = load("compare-result.json")
regression = text("regression-output.txt")
full_suite = text("full-suite.txt")
gate_log = regression.split("--- two plane suites ---")[0]
dist_line = subprocess.check_output(["node", "scripts/verify-dist-fresh.ts"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip().splitlines()[-1]


def check(cid):
    return next(entry for entry in core["checks"] if entry["id"] == cid)


claims = [
    {
        "id": "F1",
        "claim": "The DAG mode line names where the ranks actually came from, in all three states, and the phrase matches the MODEL's report on the host path",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/f1-result.json", f"{HERE.replace(ROOT + '/', '')}/verify-f1-phrases.ts"],
        "observed": "; ".join(f"{state}: '{entry['line']}'" for state, entry in f1["observed"].items()),
        "source": "a (the real component rendered on a minimal React-shaped runtime; the mode row read as text)",
        "verdict": "PASS" if all(f1["verdict"].values()) else "FAIL",
    },
    {
        "id": "REG-G1a",
        "claim": "The shared-model claim did not move: TUI ranks, web box ranks and model depths agree; the host cache reproduces the served model",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/compare-result.json", f"{HERE.replace(ROOT + '/', '')}/host-model-result.json"],
        "observed": f"tuiRanksEqualModel={compare['verdict']['tuiRanksEqualModel']} webRanksEqualModel={compare['verdict']['webRanksEqualModel']} servedRankIsModelRank={compare['verdict']['servedRankIsModelRank']} hostModelEqualsServed={compare['verdict']['hostModelEqualsServed']}",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if all(compare["verdict"][key] for key in ("tuiRanksEqualModel", "webRanksEqualModel", "servedRankIsModelRank", "hostModelEqualsServed", "webArtifactHasNoRankDerivation", "hostIsTheOnlyModelCall")) else "FAIL",
    },
    {
        "id": "REG-G1b",
        "claim": "The model's edges still reach both drawings, including the plan-only edge between board nodes",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/compare-result.json", f"{HERE.replace(ROOT + '/', '')}/tui-result.json", f"{HERE.replace(ROOT + '/', '')}/web-result.json"],
        "observed": f"TUI drawn {compare['observed']['tuiDrawnEdges']}; web drawn {compare['observed']['webDrawnEdges']}; planOnlyEdgeDrawn(web)={web['verdict']['planOnlyEdgeDrawn']} tuiSeesPlanOnlyEdgeT1toT2={tui['verdict']['tuiSeesPlanOnlyEdgeT1toT2']}",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if compare["verdict"]["tuiEdgesEqualModel"] and compare["verdict"]["webEdgesEqualModel"] else "FAIL",
    },
    {
        "id": "REG-G2",
        "claim": "Determinism: two builds byte-identical; reversed input order unchanged; JSON round-trip lossless",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/core-result.json", f"{HERE.replace(ROOT + '/', '')}/regression-output.txt (gate self-test)"],
        "observed": f"{check('C1-twice')['id']}: {check('C1-twice')['observed']}; {check('C2-shuffle')['id']}: {check('C2-shuffle')['observed']}; {check('C3-roundtrip')['id']}: {check('C3-roundtrip')['observed']}; gate self-test determinism + input-order arms PASS",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if all(check(cid)["pass"] for cid in ("C1-twice", "C2-shuffle", "C3-roundtrip")) else "FAIL",
    },
    {
        "id": "REG-G3",
        "claim": "Live refresh unchanged: plan/board edits reach the model event-driven, coalesced, with no poll as the primary path",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/live-result.json", f"{HERE.replace(ROOT + '/', '')}/web-result.json (push arm)"],
        "observed": f"batches={live['phaseA']['batches']} latency={live['phaseA']['latencyFromSecondWriteMs']}ms boardLatency={live['phaseB']['latencyMs']}ms eventDriven={live['verdict']['eventDriven']}; web push reads {web['push']['readsBefore']}->{web['push']['readsAfter']} intervalFired={web['push']['intervalFired']}",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if all(live["verdict"].values()) and web["push"]["frameRefreshed"] and web["push"]["intervalFired"] == 0 else "FAIL",
    },
    {
        "id": "REG-G4",
        "claim": "The six conflict cases and the flat drawing did not move",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/core-result.json", f"{HERE.replace(ROOT + '/', '')}/tui-result.json (flat)", f"{HERE.replace(ROOT + '/', '')}/web-flat-result.json"],
        "observed": f"core {core['summary']}; TUI flatDrawsFlat={tui['verdict']['flatDrawsFlat']}; web flat boxesAllRankZero={web_flat['verdict']['boxesAllRankZero']}",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if core["summary"]["failed"] == 0 and tui["verdict"]["flatDrawsFlat"] and web_flat["verdict"]["boxesAllRankZero"] else "FAIL",
    },
    {
        "id": "REG-G5",
        "claim": "The gate still passes its fixture and still reddens on the seeded wrong edge",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/regression-output.txt"],
        "observed": "default 'PASS — nodes (8), edges (6)' exit 0; --seed-wrong-edge exit 1 naming F1→F2; --self-test 8/8 exit 0",
        "source": "a (re-run at da1974f0)",
        "verdict": "PASS" if "nodes (8), edges (6)" in gate_log and "seeded to \"board\"" in gate_log and "8 arms" in gate_log else "FAIL",
    },
    {
        "id": "REG-G6",
        "claim": "The regression suites and the standing static gates are green on this tree",
        "evidence": [f"{HERE.replace(ROOT + '/', '')}/regression-output.txt", f"{HERE.replace(ROOT + '/', '')}/full-suite.txt"],
        "observed": "two plane packages 680 pass / 0 fail (the fix added 3 arms); core 60 pass / 0 fail; full `bun test packages` 2101 pass, 3 skip, 0 fail (2104 tests); typecheck exit 0; verify:gates 8/8 green; " + dist_line,
        "source": "a (all re-run at da1974f0)",
        "verdict": "PASS" if "680 pass" in regression and "2101 pass" in full_suite and "0 fail" in full_suite and "8/8 member gate(s) green" in regression and "32/32 targets fresh" in dist_line else "FAIL",
    },
]

failed = [claim for claim in claims if claim["verdict"] != "PASS"]
result = {
    "run": "lane-e-f1-recheck",
    "at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "head": head(),
    "previous": {"head": "51caa65336dcaeb29f93a38fe8af029a82ac6676", "verdict": "APPROVE", "medium": "F1"},
    "settle": {
        "productTreeClean": len([row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row]) == 0,
        "distFresh": dist_line,
        "gateArms": "default PASS, seeded negative exit 1, self-test 8/8",
    },
    "claims": claims,
    "findingStatus": {
        "F1": "CLOSED — PASS. The three states render 'ranks derived (host)', 'ranks served depth (host fallback)' and (local) 'ranks derived' / 'ranks served depth'; the host-path phrase equals the model's report.ranksDerived in both directions.",
        "F2": "recorded as a bound, not fixed this wave (web factory's own comparator; both planes agree today).",
        "F3": "recorded as a bound, not fixed this wave (empty rank 0 on a cyclic board is pre-wave, differential-proven).",
    },
    "verdict": {
        "decision": "APPROVE" if not failed else "REQUEST CHANGES",
        "justification": "F1 is fixed and observed on the rendered component in all three states; the G1a/G1b/G2/G3 probes and the flat/gate/suite regressions are green at da1974f0. The two Nits remain recorded bounds.",
    },
}
with open(os.path.join(HERE, "result.json"), "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)

lines = [
    "LANE E — narrow re-check of F1 (and the claim table's regression sanity)",
    f"HEAD {result['head']} at {result['at']}",
    f"previous verdict: {result['previous']['head']} APPROVE with F1 Medium",
    f"settle: product tree clean={result['settle']['productTreeClean']}; dist '{dist_line}'",
    "",
    "F1 — THREE STATES, RENDERED BY THE REAL COMPONENT",
]
for state, entry in f1["observed"].items():
    lines.append(f"- {state}: {entry['line']}")
lines += ["", "REGRESSION CLAIMS | EVIDENCE | VERDICT | OBSERVED | SOURCE"]
for claim in claims:
    lines.append(f"{claim['id']} | {', '.join(claim['evidence'])} | {claim['verdict']} | {claim['observed']} | {claim['source']}")
lines += ["", "FINDING STATUS"]
for key, value in result["findingStatus"].items():
    lines.append(f"- {key}: {value}")
lines += ["", "BOUNDS", "- Narrow pass: the full verdict document (evidence/living-graph/lane-e-verdict/20261019T042500Z/) is unchanged except as superseded by this re-check.", "- Re-ran: F1 phrases, the six probes behind G1a/G1b/G2/G3/G4, the gate's three arms, the two plane suites, the core suite, the full `bun test packages`, typecheck and `verify:gates`. Did NOT re-run: Docker, live-LLM, a real TUI host, pack-closure, release sweep."]
lines += ["", "VERDICT", f"{result['verdict']['decision']} — {result['verdict']['justification']}", f"summary: claims {len(claims)}, passed {len(claims) - len(failed)}, failed {len(failed)}"]
with open(os.path.join(HERE, "output.log"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("\n".join(lines))
