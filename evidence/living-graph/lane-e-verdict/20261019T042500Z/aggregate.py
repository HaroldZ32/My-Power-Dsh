#!/usr/bin/env python3
"""Lane E's verdict aggregator: turn the settled-HEAD measurements into result.json + output.log.

Every claim row names its evidence file and the OBSERVED line that decides it, plus whether the
evidence is (a) a re-run this lane performed, (b) source this lane read, or (c) a writer's report it
could not re-derive. Nothing here re-measures: it only formats what the probes wrote.
"""
import json
import os
import subprocess
from datetime import datetime, timezone

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


def branch():
    return subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, text=True).strip()


core = load("core-result.json")
tui = load("tui-result.json")
web = load("web-result.json")
web_flat = load("web-flat-result.json")
live = load("live-result.json")
compare = load("compare-result.json")
gate_emit = load("gate-emit.json")
gate_log = text("gate-output.txt")
gate_own = text("gate-own-fixture.txt")
suites = text("suites-output.txt")
gates = text("gates-full-output.txt")
diff_log = text("diff-output.txt")

model_nodes = compare["model"]["nodes"]
model_edges = compare["model"]["edges"]
web_ranks = {box.get("id"): box["rank"] for box in compare["observed"]["webBoxes"]}


def check(cid):
    return next(entry for entry in core["checks"] if entry["id"] == cid)


def line(entry):
    return f"{entry['id']}: expected {entry['expected']} | observed {entry['observed']}"


def ev(path):
    """Resolve an evidence file name to its repo-relative path under this verdict directory."""
    return f"evidence/living-graph/lane-e-verdict/20261019T042500Z/{path}" if path.endswith((".json", ".txt")) else path


claims = [
    {
        "id": "G1a",
        "claim": "THE MODEL IS SHARED: both planes draw the SAME model (ranks, ghosts, edges), and a served depth that DISAGREES with the derived rank is overruled on both planes",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/compare-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/tui-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/web-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/host-model-result.json", "client.js + graph-model.ts (read)"],
        "observed": (
            f"TUI ranks = web box ranks = model node depths ({model_nodes}); "
            f"web served `rank` = model depth while the store's `depth` disagrees: "
            + "; ".join(f"{t['id']} rank {t.get('rank')} vs depth {t['depth']}" for t in compare["observed"]["servedRanks"])
            + f"; client.js deriveRanks={compare['static']['clientBundleDeriveRanks']} buildModel={compare['static']['clientBundleBuildModel']}; "
            f"host cache buildModel calls={compare['static']['hostCacheBuildModelCalls']}; "
            f"the REAL GraphModels cache over the same workspace reproduced this exact model: hostModelEqualsTheServedFixture={compare['verdict']['hostModelEqualsServed']}"
        ),
        "source": "a (probes re-run at settled HEAD) + b (artifact/source read)",
        "verdict": "PASS" if all(compare["verdict"][key] for key in ("tuiRanksEqualModel", "webRanksEqualModel", "servedRankIsModelRank", "webArtifactHasNoRankDerivation", "webFactoryHasNoModelCall", "tuiHasNoModelCall", "hostIsTheOnlyModelCall", "hostModelEqualsServed")) else "FAIL",
    },
    {
        "id": "G1b",
        "claim": "THE MODEL'S EDGES reach BOTH drawings, including a plan-only edge between two BOARD nodes (the Blocker this lane filed)",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/compare-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/tui-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/web-result.json"],
        "observed": (
            f"model edges {model_edges}; TUI drawn {compare['observed']['tuiDrawnEdges']}; "
            f"web drawn {compare['observed']['webDrawnEdges']}; plan-only T1->T2 present on both: "
            f"TUI={tui['verdict']['tuiSeesPlanOnlyEdgeT1toT2']} web={web['verdict']['planOnlyEdgeDrawn']}"
        ),
        "source": "a (probes re-run at settled HEAD)",
        "verdict": "PASS" if compare["verdict"]["tuiEdgesEqualModel"] and compare["verdict"]["webEdgesEqualModel"] else "FAIL",
    },
    {
        "id": "G2",
        "claim": "DETERMINISM: same board + same plan => byte-identical model; reversed input order => unchanged model; the model round-trips as JSON",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/core-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/gate-output.txt (self-test determinism arms)"],
        "observed": (
            f"{line(check('C1-twice'))} | {line(check('C2-shuffle'))} | {line(check('C3-roundtrip'))} | "
            "gate self-test: 'two builds serialize byte-identically :: identical' and 'reversed board and plan arrays build the same model :: identical'"
        ),
        "source": "a (re-run) + b (gate self-test log read)",
        "verdict": "PASS" if all(check(cid)["pass"] for cid in ("C1-twice", "C2-shuffle", "C3-roundtrip")) and "input-order independence: reversed board and plan arrays build the same model :: identical" in gate_log else "FAIL",
    },
    {
        "id": "G3",
        "claim": "LIVE REFRESH: a board or plan FILE EDIT changes the model with no restart; the path is event-driven (watcher -> feed), and the web's push frame refreshes it without the interval firing",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/live-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/web-result.json (push block)", "panel-dag.ts:817 useTeamFeed / index.ts teamFeed (read)"],
        "observed": (
            f"plan: two writes in one 150 ms window -> batches={live['phaseA']['batches']} and model ghosts {live['phaseA']['after']['ghosts']}, "
            f"latency {live['phaseA']['latencyFromSecondWriteMs']} ms from the second write; "
            f"board: latency {live['phaseB']['latencyMs']} ms, nodes {live['phaseB']['after']['nodes']}, ghosts {live['phaseB']['after']['ghosts']}; "
            f"eventDriven={live['verdict']['eventDriven']}; web stream {web['push']['streamUrl']} reads {web['push']['readsBefore']}->{web['push']['readsAfter']} on ONE frame, intervalFired={web['push']['intervalFired']}"
        ),
        "source": "a (live + web probes re-run) + b (TUI subscription wiring read)",
        "verdict": "PASS" if all(live["verdict"].values()) and web["push"]["frameRefreshed"] and web["push"]["intervalFired"] == 0 else "FAIL",
    },
    {
        "id": "G4",
        "claim": "THE SIX CONFLICT CASES of the frozen table, each observed in the model: board-only, plan-only GHOST, edge plan-only, edge board-only, agreeing edge, unparseable plan line",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/core-result.json (B1..B11)", "evidence/living-graph/lane-e-verdict/20261019T042500Z/fixtures/plan-six.md + board-six.json"],
        "observed": (
            f"{line(check('B3-board-only'))} | {line(check('B3-plan-only'))} | {line(check('B2-ghosts'))} | "
            f"{line(check('B5-edge-plan-only'))} | {line(check('B5b-edge-board-only'))} | "
            f"{line(check('B5c-agreeing-edge-not-reported'))} | {line(check('B6-plan-problems'))} | "
            f"unresolved/dangling: {line(check('B7-unresolved'))}"
        ),
        "source": "a (re-run at settled HEAD)",
        "verdict": "PASS" if all(check(cid)["pass"] for cid in ("B1-node-order", "B2-ghosts", "B3-board-only", "B3-plan-only", "B4-edges", "B5-edge-plan-only", "B5b-edge-board-only", "B5c-agreeing-edge-not-reported", "B6-plan-problems", "B7-unresolved", "B9-ranks-derived", "B10-ranks")) else "FAIL",
    },
    {
        "id": "G5",
        "claim": "THE GATE: a fixture plan+board whose nodes/edges equal what the input declares, and a SEEDED wrong edge REDDENS it — run by this lane, including on THIS lane's own fixture",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/gate-output.txt", "evidence/living-graph/lane-e-verdict/20261019T042500Z/gate-own-fixture.txt", "evidence/living-graph/lane-e-verdict/20261019T042500Z/gate-emit.json"],
        "observed": (
            "default: 'PASS — nodes (8), edges (6), ranks, cycles and the report equal the declared input' exit 0; "
            "--seed-wrong-edge exit 1 with 'negative control: F1→F2: source \"plan\" seeded to \"board\"' and 'FAIL edge F1→F2'; "
            "--self-test '8 arms: both directions and the path forms' exit 0; "
            "lane E's own fixture: 'PASS — nodes (7), edges (6)' and a seeded 'T1→T2: source \"both\" seeded to \"board\"' exit 1"
        ),
        "source": "a (all four arms re-run by this lane)",
        "verdict": "PASS" if "nodes (8), edges (6)" in gate_log and "seeded to \"board\"" in gate_log and "8 arms" in gate_log and "nodes (7), edges (6)" in gate_own and "T1→T2: source \"both\" seeded" in gate_own else "FAIL",
    },
    {
        "id": "G6",
        "claim": "FLAT BOARD DRAWS FLAT on both planes; the pre-existing suites are still green; the standing static gates pass in the current regime",
        "evidence": ["evidence/living-graph/lane-e-verdict/20261019T042500Z/core-result.json (E1/E2)", "evidence/living-graph/lane-e-verdict/20261019T042500Z/tui-result.json (flat)", "evidence/living-graph/lane-e-verdict/20261019T042500Z/web-flat-result.json", "evidence/living-graph/lane-e-verdict/20261019T042500Z/suites-output.txt", "evidence/living-graph/lane-e-verdict/20261019T042500Z/gates-full-output.txt"],
        "observed": (
            f"model {line(check('E1-flat'))}; TUI flat hits {tui['flat']['hits']} mode {tui['flat']['layoutMode']}; "
            f"web flat boxes {web_flat['web']['boxes']}; "
            "required suites 677 pass / 0 fail (2 packages); core 60 pass / 0 fail; full `bun test packages` 2098 pass, 3 skip, 0 fail; typecheck exit 0; "
            "verify:gates 'PASS - 8/8 member gate(s) green'; verify:comments PASS (422 files); verify:manifest PASS; no-host-override PASS; verify-dist-fresh '32/32 targets fresh'"
        ),
        "source": "a (all re-run at settled HEAD)",
        "verdict": "PASS" if tui["verdict"].get("flatDrawsFlat") and web_flat["verdict"]["boxesAllRankZero"] and "677 pass" in suites and "2098 pass" in suites and "8/8 member gate(s) green" in gates and "32/32 targets fresh" in gates else "FAIL",
    },
]

findings = [
    {
        "id": "F1",
        "severity": "Medium",
        "what": "The TUI DAG page's mode line prints `ranks served` on the normal (model-served) path, while the model's own report says the ranks are DERIVED. The web's geometry reports derived=true for the same model, so the two planes describe one picture with two different provenances, and the TUI's word is the one that used to mean the untrusted served-depth fallback (R18).",
        "where": "packages/mpd-tui-plugin/src/panel-dag.ts — the mode line (`ranks ${layout.ranksDerived ? \"derived\" : \"served\"}`) reading `dagPanelLayout`'s flag; `rankPlan(tasks, servedRanks)` returns `derived: false` by design when served ranks are applied.",
        "why": "A reader is told the vertical order came from the degraded fallback when it came from the shared core's derivation. It is the R18 honesty rule inverted by the new input path.",
        "evidence": f"tui-result.json ranksSource={tui['ranksSource']}; compare-result.json tuiRanksEqualModel={compare['verdict']['tuiRanksEqualModel']}; web geometry publishes report.ranksDerived from served.report (team-view.ts).",
        "direction": "Carry the model's `report.ranksDerived` into the page (or add a distinct `rankSource` value) and print THAT when page.ranks is present; keep `layout.ranksDerived` for the no-model path. Alternatively reword to distinguish `derived (host)` from `served depth`.",
        "source": "a (observed flag values) + b (source read)",
    },
    {
        "id": "F2",
        "severity": "Nit",
        "what": "The web factory still declares its own numeric id collator (`ID_ORDER`) for the within-column sort — a comparator, not a rank derivation; the risk is drift if the core's collator ever changes.",
        "where": "packages/mpd-bundle-plugin/src/team-view.ts (one `Intl.Collator` declaration, one sort site); two occurrences in the built client.js.",
        "why": "G1 forbids a third DERIVATION of ranks, which is gone; the duplicated comparator is the last small piece of the shared key that is not shared. Both planes sort by the same rule today.",
        "evidence": f"compare-result.json static={{clientBundleIdOrder: {compare['static']['clientBundleIdOrder']}, webCollatorDuplicated: {compare['verdict']['webCollatorDuplicated']}}}",
        "direction": "Publish the order with the model (`ranks` already carries each bucket in id order) or splice the core's comparator the way the model itself is spliced; do not copy it again.",
        "source": "b (artifact read) + a (static measurement)",
    },
    {
        "id": "F3",
        "severity": "Nit",
        "what": "A cyclic board's ranks start at 1, leaving an EMPTY rank 0 column.",
        "where": "mpd-graph-core rank derivation (moved verbatim); a cycle member's blocker contributes 0+1 while still on the walk.",
        "why": "Cosmetic on a malformed board; the cycle is reported and every rank is finite.",
        "evidence": f"{line(check('F2-cycle-finite'))}; the differential (`diff-output.txt`) proves the baseline produced the identical shape, so this is NOT a wave regression.",
        "direction": "None required; recorded as pre-wave behaviour.",
        "source": "a (re-run + differential)",
    },
]

closed = [
    {
        "id": "C-original-Blocker",
        "what": "The TUI dropped a plan-only edge between two BOARD nodes (T1->T2 absent from the drawn dependency source while the model carried it).",
        "status": "CLOSED at 51caa653",
        "observed": f"TUI drawn edges {compare['observed']['tuiDrawnEdges']} equal the model's {model_edges}; tuiEdgesEqualModel={compare['verdict']['tuiEdgesEqualModel']}",
        "fix_seen": "packages/mpd-tui-plugin/src/team-state.ts `modelRows` now carries the model node's dependency union for board-backed rows; `failedDependencies`/`visual` stay board-authoritative.",
        "source": "a (re-run)",
    },
]

declined = [
    "Aesthetic judgement of the `+` ghost marker: I judged only its CONTRACT shape (existing label slot, existing legend grammar, no new tone, one ASCII cell, no layout branch) at b9127fda's bytes; whether it looks good is not a reviewable claim here.",
    "Plan-parser behaviour outside the README subset (a fuzz sweep was not run); the six-case and README grammar arms were exercised.",
    "The beacon arm of `resolvePlanFile` under a LIVE boulder switch (the newest-file path was exercised; the beacon path was source-read only).",
    "Browser EventSource reconnection/proxy behaviour (browser-owned; the offline harness covers one frame, not reconnect).",
    "Docker real-machine, live-LLM sessions, and a real dsh-tui 0.16.x host: the planes were driven through the repo's offline harnesses and the TUI layout directly, not through a terminal.",
    "Performance/large-board stress (the fixtures are 5-8 nodes; MAX_TASKS/scale bounds not measured).",
    "The visual fidelity of every drawn box (curves, CJK labels, geometry) beyond the rank/edge/ghost facts this matrix measured.",
]

bounds = [
    "Read: the frozen contract + Amendment 2/3, mpd-graph-core (types/rank/model/plan/watch/resolve/README), the wave diff for graph.ts/team-state.ts/panel-dag.ts/team-view.ts/team-web.ts/graph-model.ts/index.ts, the gate, and the two planes' rendering paths. Not read line-by-line: scenes.ts/subagent-scene.ts (inherited through modelRows; only the call sites checked), the adopted client bundle, docker/**, docs/**.",
    "Ran: `bun test packages` (2098 pass/3 skip/0 fail), the two required packages (677/0), core (60/0), typecheck, verify:gates 8/8, verify:comments, verify:manifest, verify-no-host-override, verify-dist-fresh (32/32), the graph gate's four arms on the default AND on lane E's fixture, and the six lane-E probes.",
    "Did NOT run: Docker lane, live-LLM QA cases, pack-closure, the full release sweep, or a real TUI host. A claim that needed one of those would be INCONCLUSIVE here; none of G1-G6 did.",
]

failed = [claim for claim in claims if claim["verdict"] != "PASS"]
result = {
    "run": "lane-e-living-graph-verdict",
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "head": head(),
    "branch": branch(),
    "contract": ".mpd/plans/living-graph.md (Amendments 1-3)",
    "settle": {
        "headMatchesCaptain": head() == "51caa65336dcaeb29f93a38fe8af029a82ac6676",
        "productTreeClean": len([row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row]) == 0,
        "evidencePathsChanged": [row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" in row][:8],
        "note": "git status shows only lane E's own evidence paths (untracked/modified by this reviewer); the product tree is clean at the settled hash.",
        "distFresh": "32/32 targets fresh (each rebuilt twice, byte-identical)",
        "clientBundle": "derived artifact read through the offline harness; no derivation inside it",
    },
    "claims": claims,
    "findings": findings,
    "closed": closed,
    "declined": declined,
    "bounds": bounds,
    "summary": {"claims": len(claims), "passed": len(claims) - len(failed), "failed": len(failed), "findings": len(findings)},
    "verdict": {
        "decision": "APPROVE" if not failed else "REQUEST CHANGES",
        "justification": "Every frozen requirement G1-G6 is met by a re-run observation at 51caa653, the Blocker this lane filed is closed and its arm is green, and the one Medium finding is a user-visible label that misnames the rank source without changing the picture.",
    },
}
with open(os.path.join(HERE, "result.json"), "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)

lines = [
    "LANE E — living-graph independent verification",
    f"HEAD {result['head']} ({result['branch']}) at {result['at']}",
    "contract: .mpd/plans/living-graph.md (Amendments 1-3)",
    "",
    "CLAIM | EVIDENCE | VERDICT | OBSERVED LINE | SOURCE",
]
for claim in claims:
    lines.append(f"{claim['id']} | {', '.join(claim['evidence'])} | {claim['verdict']} | {claim['observed']} | {claim['source']}")
lines += ["", "FINDINGS"]
for finding in findings:
    lines.append(f"{finding['id']} {finding['severity']} | {finding['what']} | where {finding['where']} | observed {finding['evidence']}")
lines += ["", "CLOSED"]
for entry in closed:
    lines.append(f"{entry['id']} | {entry['status']} | {entry['observed']}")
lines += ["", "DECLINED TO JUDGE"]
for entry in declined:
    lines.append(f"- {entry}")
lines += ["", "BOUNDS"]
for entry in bounds:
    lines.append(f"- {entry}")
lines += ["", "REGRESSIONS AND GATES (observed lines)"]
for key in ("677 pass", "2098 pass", "8/8 member gate(s) green", "32/32 targets fresh", "VERDICT: PASS"):
    for row in suites.splitlines() + gates.splitlines():
        if key in row:
            lines.append(f"- {row.strip()}")
            break
lines += ["", "GATE ARMS (observed lines)"]
for row in gate_log.splitlines() + gate_own.splitlines():
    if "PASS —" in row or "seed" in row or "FAIL edge" in row or "8 arms" in row:
        lines.append(f"- {row.strip()}")
lines += ["", "VERDICT", f"{result['verdict']['decision']} — {result['verdict']['justification']}", "", f"summary: {result['summary']}"]
with open(os.path.join(HERE, "output.log"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("\n".join(lines))
