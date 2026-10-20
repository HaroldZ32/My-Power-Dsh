#!/usr/bin/env python3
"""Lane E's CodeRabbit-round re-check: result.json + output.log.

Claims: the cross-team Major, the three event defects, the parser's declared-lane rule, the gate's
CI membership, and a re-run of the previously-approved claims. Everything is this lane's own run at
the settled HEAD; no writer's mutation log is cited as evidence.
"""
import json
import os
import subprocess
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
REL = os.path.relpath(HERE, ROOT)


def load(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as handle:
        return json.load(handle)


def text(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as handle:
        return handle.read()


def head():
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def check(cid):
    return next(entry for entry in core["checks"] if entry["id"] == cid)


major = load("major-events-result.json")
core = load("core-result.json")
tui = load("tui-result.json")
web = load("web-result.json")
web_flat = load("web-flat-result.json")
live = load("live-result.json")
host = load("host-model-result.json")
compare = load("compare-result.json")
f1 = load("f1-result.json")
regression = text("regression-output.txt")
trials = text("replace-trials.txt")
dist_line = subprocess.check_output(["node", "scripts/verify-dist-fresh.ts"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip().splitlines()[-1]

claims = [
    {
        "id": "MAJOR-cross-team",
        "claim": "A FOREIGN model whose ids collide with the real board (T1..T4 plus its own T5) is REJECTED by the TUI join; the two official-view arms never ask the service; a record arm names its team",
        "evidence": [f"{REL}/major-events-result.json"],
        "observed": f"foreign non-ghost ids {major['major']['foreignNonGhostIds']} vs board {major['major']['realBoardIds']}: rejected={major['major']['foreignRejected']}, matching model accepted={major['major']['matchingAccepted']}, official session/workspace service calls={major['major']['officialSessionCalls']}/{major['major']['officialWorkspaceCalls']}, record arm asked '{major['major']['recordArmTeamId']}'",
        "source": "a (re-run at the settled HEAD, with the service a hostile stub that ignores the team id)",
        "verdict": "PASS" if major["verdict"]["foreignModelRejected"] and major["verdict"]["matchingModelAccepted"] and major["verdict"]["officialArmsNeverAsk"] and major["verdict"]["recordArmNamesItsTeam"] else "FAIL",
    },
    {
        "id": "EVENT-plan-created",
        "claim": "A plan CREATED where none existed changes the served model, through the watcher event path (not a poll)",
        "evidence": [f"{REL}/major-events-result.json"],
        "observed": f"before ghosts {major['eventPlanCreated']['beforeGhosts']} -> after {major['eventPlanCreated']['afterGhosts']}, notify latency {major['eventPlanCreated']['notifyLatencyMs']} ms, notified={major['eventPlanCreated']['notified']}",
        "source": "a (the probe created the file itself and awaited the host cache's notify)",
        "verdict": "PASS" if major["verdict"]["createdPlanReachesModel"] else "FAIL",
    },
    {
        "id": "EVENT-plan-swap",
        "claim": "A plan path that RESOLVES DIFFERENTLY with NO revision bump rebuilds the served model",
        "evidence": [f"{REL}/major-events-result.json"],
        "observed": f"first get planOnly {major['eventPlanSwap']['firstPlanOnly']} -> second get {major['eventPlanSwap']['secondPlanOnly']} with revision constant {major['eventPlanSwap']['revisionConstant']}",
        "source": "a (two state reads, no store write, fixed revision stub)",
        "verdict": "PASS" if major["verdict"]["planSwapRebuilds"] else "FAIL",
    },
    {
        "id": "EVENT-directory-replaced",
        "claim": "A directory REPLACED at the same path is re-armed so LATER files are still reported — the claim this round makes for both a rename-in-place and an rm-and-recreate",
        "evidence": [f"{REL}/major-events-result.json", f"{REL}/replace-trials.txt", f"{REL}/debug-replace.ts", f"{REL}/debug-replace2.ts", f"{REL}/debug-close-event.ts"],
        "observed": f"in-run: replacementDelivered={major['eventDirectoryReplaced']['replacementDelivered']}, postReplaceWriteDelivered={major['eventDirectoryReplaced']['postReplaceWriteDelivered']}; trials: {trials.strip().replace(os.linesep, ' | ')}",
        "source": "a (three replacement shapes re-run by this lane; the writer's arm calls poll(), the product calls none)",
        "verdict": "FAIL",
    },
    {
        "id": "PARSER-lane-marker",
        "claim": "A leading lane marker is stripped only when the lane table DECLARES it",
        "evidence": [f"{REL}/major-events-result.json"],
        "observed": f"undeclared: '{major['parser']['undeclaredTitle']}' (kept verbatim); declared: '{major['parser']['declaredTitle']}' (marker stripped)",
        "source": "a (parsed both documents in this run)",
        "verdict": "PASS" if major["verdict"]["laneMarkerDeclaredOnly"] else "FAIL",
    },
    {
        "id": "GATE-in-ci",
        "claim": "verify:graph-model is a member of the CI aggregate now, and the aggregate is green with nine members",
        "evidence": [f"{REL}/regression-output.txt"],
        "observed": "member graph-model :: node ./scripts/verify-graph-model.ts --self-test; member graph-model: exit=0 PASS; 'PASS - 9/9 member gate(s) green'",
        "source": "a (ran `bun run verify:gates` and read its member list)",
        "verdict": "PASS" if "member graph-model" in regression and "9/9 member gate(s) green" in regression else "FAIL",
    },
    {
        "id": "REGRESSIONS",
        "claim": "The previously-approved claims and F1's fix are unchanged at this HEAD",
        "evidence": [f"{REL}/core-result.json", f"{REL}/tui-result.json", f"{REL}/web-result.json", f"{REL}/web-flat-result.json", f"{REL}/live-result.json", f"{REL}/host-model-result.json", f"{REL}/compare-result.json", f"{REL}/f1-result.json", f"{REL}/regression-output.txt"],
        "observed": f"core {core['summary']}; TUI {tui['verdict']}; web {web['verdict']}; web-flat boxesAllRankZero={web_flat['verdict']['boxesAllRankZero']}; live {live['verdict']}; hostModelEqualsServed={compare['verdict']['hostModelEqualsServed']}; F1 phrases all true={all(f1['verdict'].values())}; two plane packages 684 pass/0 fail; core 68 tests/0 fail; full 2115 pass+3 skip/0 fail (2118); typecheck 0; gate positive PASS/seeded exit 1/self-test 8/8",
        "source": "a (every line re-run at this HEAD)",
        "verdict": "PASS" if core["summary"]["failed"] == 0 and all(f1["verdict"].values()) and "684 pass" in regression and "2115 pass" in regression and "9/9 member gate(s) green" in regression else "FAIL",
    },
]
failed = [claim for claim in claims if claim["verdict"] != "PASS"]

findings = [
    {
        "id": "F4",
        "severity": "Medium",
        "what": "The directory-replacement heal is incomplete on the EVENT path. The `arm()` guard compares only the inode; an `rm -rf <dir>` + `mkdir <dir>` reuses the freed inode on this filesystem, so the dead watch is treated as 'already armed' and kept. The FSWatcher has already emitted `close` (IN_IGNORED) and `watching` still reports true. Rename-away produces no notification at all, so `arm()` never runs; the writer's own arm calls `poll()` explicitly, and NO product caller does.",
        "where": "packages/mpd-graph-core/src/watch.ts — `arm()`'s `ino === entry.ino` check and `armDirectory()` (no `close`/liveness tracking).",
        "why": "The round's own claim says a rename-in-place OR an rm-and-recreate is healed; on this filesystem neither shape is healed without a manual poll. Consequence: after a `.mpd/plans` (or board-dir) replacement, later plan edits fire no notify, the GraphModels cache key (revision + planPath) is unchanged, and the planes serve a stale model silently until a team write or a restart.",
        "evidence": f"replace-trials.txt: rm-recreate 3/3 sameIno=true, replacementDelivered=1, late write delivered=1 (missed); rename-away 2/2 deliveredAfterReplace=0. debug-close-event.ts: the deleted directory's FSWatcher emits 'close' (IN_IGNORED) while our map keeps `watching` true. Writer's arm: `packages/mpd-graph-core/test/watch.test.ts` 'the watch follows the NEW inode' calls `watcher.poll()` between the rename and the new write.",
        "direction": "Track the armed handle's LIVENESS, not just its inode: subscribe to the FSWatcher's `close` event and mark the entry dead so the next `arm()` re-arms it; or compare `birthtimeMs` in addition to `ino`; either way add an arm that uses the rm+recreate shape and does NOT call poll() before the late write.",
        "source": "a (my own mutations) + b (source read)",
    },
    {
        "id": "OBS-residual-same-id-set",
        "severity": "Observation",
        "what": "The bijection guard cannot distinguish two teams whose non-ghost id sets are IDENTICAL (both T1..T4): the model carries no team identity, so such a model is accepted. With the service now addressed by `teamId`, this needs a service bug to occur.",
        "where": "packages/mpd-tui-plugin/src/team-state.ts `attachModel`; packages/mpd-graph-core/src/types.ts `GraphModel` (no team field).",
        "why": "Recording the residual so the guard is not described as stronger than it is. A model-level `teamId` would make the check exact; the current two defences reduce the risk to a service defect.",
        "evidence": f"major-events-result.json: residualSameIdSetAccepted={major['major']['residualSameIdSetAccepted']}",
        "direction": "If exactness is wanted: add the team id to GraphModel and compare it in attachModel. Not required for this round.",
        "source": "a",
    },
    {
        "id": "NIT-1",
        "severity": "Nit",
        "what": "Four test scratch files are COMMITTED under packages/mpd-graph-core/test/.tmp-cFto5E/ (a leftover mkdtemp directory from an aborted watch-test run).",
        "where": "packages/mpd-graph-core/test/.tmp-cFto5E/{board,board-old}/{a,b,c}.json (tracked).",
        "why": "The test cleans up in a `finally`, so this is a crashed-run leftover that was added by a blanket `git add`; the next such run creates a new random `.tmp-*` name, so the pollution can recur and dirty the tree tests expect clean.",
        "evidence": "`git ls-files packages/mpd-graph-core/test/.tmp-cFto5E` lists four tracked files; no `.gitignore` entry covers `.tmp-*`.",
        "direction": "Remove the tracked directory and ignore `packages/*/test/.tmp-*`, or use the OS temp dir for these arms.",
        "source": "a (git ls-files) + b (test source read)",
    },
]

result = {
    "run": "lane-e-coderabbit-recheck",
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "head": head(),
    "previous": {"head": "da1974f0", "verdict": "APPROVE (F1 closed)", "nits": ["F2 web collator", "F3 empty rank 0"]},
    "settle": {
        "productTreeClean": len([row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row]) == 0,
        "distFresh": dist_line,
        "aggregate": "verify:gates PASS with 9/9 members (graph-model added)",
    },
    "claims": claims,
    "findings": findings,
    "nitStatus": {
        "F2": "unchanged — web factory's own numeric collator; still a comparator, both planes agree (recorded as a bound).",
        "F3": "unchanged — empty rank 0 on a cyclic board; differential-proven pre-wave (recorded as a bound).",
        "new": "NIT-1 above (committed test scratch directory).",
    },
    "verdict": {
        "decision": "APPROVE (with F4 to fix)" if not [claim for claim in claims if claim["verdict"] == "FAIL" and claim["id"] != "EVENT-directory-replaced"] else "REQUEST CHANGES",
        "justification": "The Major is fixed and its discriminator is observed; plan creation and plan-path swap are healed; the gate is in CI and the aggregate is 9/9; every previously-approved claim and F1 are unchanged. The directory-replacement claim is only partially true on the event path (F4, Medium) and should be fixed before merge, exactly as F1 was.",
    },
}
with open(os.path.join(HERE, "result.json"), "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)

lines = [
    "LANE E — CodeRabbit-round re-check (cross-team Major, three event defects, gate membership)",
    f"HEAD {result['head']} at {result['at']}",
    f"settle: product tree clean={result['settle']['productTreeClean']}; dist '{dist_line}'",
    "",
    "CLAIM | EVIDENCE | VERDICT | OBSERVED | SOURCE",
]
for claim in claims:
    lines.append(f"{claim['id']} | {', '.join(claim['evidence'])} | {claim['verdict']} | {claim['observed']} | {claim['source']}")
lines += ["", "FINDINGS"]
for finding in findings:
    lines.append(f"{finding['id']} {finding['severity']} | {finding['what']} | where {finding['where']} | observed {finding['evidence']} | direction {finding['direction']}")
lines += ["", "NIT STATUS"]
for key, value in result["nitStatus"].items():
    lines.append(f"- {key}: {value}")
lines += ["", "BOUNDS", "- Read the five fix sites (attachModel + its two call arms, watch.ts, resolve.ts, graph-model.ts, plan.ts, scenes.ts, verify-gates.ts) and the writer's own watch arm; the web halo/pinned-detail change was source-read only and its effect is covered by the unchanged web probe, not re-derived.", "- Re-ran: the Major/events probe, the six previously-approved probes, the F1 phrase arm, the gate's three arms, the two plane suites, the core suite, the full `bun test packages`, typecheck, `verify:gates`, `verify-dist-fresh`. Did NOT run: Docker, live-LLM, a real TUI host, pack-closure, release sweep.", "- Replacement shapes were exercised on THIS filesystem (ext4): rm+recreate reuses the inode 3/3; rename-away yields a new inode 2/2. Another filesystem may differ, which is exactly why the arm must cover the shape rather than the inode."]
lines += ["", "VERDICT", f"{result['verdict']['decision']} — {result['verdict']['justification']}", f"summary: claims {len(claims)}, passed {len(claims) - len(failed)}, failed {len(failed)}"]
with open(os.path.join(HERE, "output.log"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("\n".join(lines))
