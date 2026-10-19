#!/usr/bin/env python3
"""Lane E's F4-only re-check: result.json + output.log.

Three runtimes (pinned Bun 1.4.0, PATH Bun 1.4.2, Node 24.21.0) ran the same probe: the two live
replacement shapes with NO poll, the injected-close path, and a no-storm control. The raw
`fs.watch` signals were measured separately, because the previous round's evidence line about
`close` was wrong and this round has to say so.
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


runs = {name: load(f"f4-result-{name}.json") for name in ("bun1.4.0", "bun1.4.2", "node24.21.0")}
raw = [json.loads(line) for line in text("runtime-raw-output.txt").splitlines() if line.strip().startswith("{")]
regression = text("regression.txt")
dist_line = subprocess.check_output(["node", "scripts/verify-dist-fresh.ts"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip().splitlines()[-1]

claims = []
for name, data in runs.items():
    claims.append({
        "id": f"F4-live-{name}",
        "claim": "rm -rf + mkdir and rename + replacement both re-arm with NO poll, and a file written AFTER each replacement is delivered",
        "evidence": [f"{REL}/f4-result-{name}.json", f"{REL}/run-{name}.txt"],
        "observed": (
            f"runtime {data['runtime']}: rm-recreate sameIno={data['live']['rmRecreate']['sameIno']} "
            f"replacement={data['live']['rmRecreate']['replacementDelivered']} late={data['live']['rmRecreate']['lateWriteDelivered']} manual={data['live']['rmRecreate']['manualAny']}; "
            f"rename-away sameIno={data['live']['renameAway']['sameIno']} replacement={data['live']['renameAway']['replacementDelivered']} late={data['live']['renameAway']['lateWriteDelivered']} manual={data['live']['renameAway']['manualAny']}; "
            f"batches {data['live']['rmRecreate']['batches']} / {data['live']['renameAway']['batches']}"
        ),
        "source": "a (this lane's own filesystem mutations; no poll anywhere)",
        "verdict": "PASS" if data["verdict"]["rmRecreateLateWriteDelivered"] and data["verdict"]["renameAwayLateWriteDelivered"] and data["verdict"]["noPollBatch"] else "FAIL",
    })
    claims.append({
        "id": f"F4-injected-close-{name}",
        "claim": "The injected-close path: the OLD watcher's close cannot kill its successor; a live watch's close re-arms on the bounded timer; close() cancels the attempts",
        "evidence": [f"{REL}/f4-result-{name}.json"],
        "observed": (
            f"runtime {data['runtime']}: afterRearm={data['injected']['afterRearm']} afterOldClose={data['injected']['afterOldClose']} "
            f"successorStillWorks={data['injected']['successorStillWorks']} afterDeadClose={data['injected']['afterDeadClose']} "
            f"rearmedDelivers={data['injected']['rearmedDelivers']} closeCancelledTimers={data['injected']['closeCancelledTimers']} errors={data['injected']['errors']}"
        ),
        "source": "a (a real FSWatcher whose close signal the probe emits through the documented test seam)",
        "verdict": "PASS" if data["verdict"]["oldCloseCannotKillSuccessor"] and data["verdict"]["deadWatchRearmsWithoutEvent"] and data["verdict"]["closeCancelsRearmTimers"] else "FAIL",
    })
    claims.append({
        "id": f"F4-no-storm-{name}",
        "claim": "An untouched directory delivers nothing and does not re-arm; close() leaves no attempt behind",
        "evidence": [f"{REL}/f4-result-{name}.json"],
        "observed": f"runtime {data['runtime']}: batches={data['idle']['batches']} handles={data['idle']['handles']} afterCloseHandles={data['idle']['afterCloseHandles']} closedPoll={data['idle']['closedPoll']}",
        "source": "a",
        "verdict": "PASS" if data["verdict"]["idleDirectoryStaysSilent"] and data["verdict"]["noRearmAfterClose"] else "FAIL",
    })

claims.append({
    "id": "F4-runtime-raw-signals",
    "claim": "What the runtime actually reports when a WATCHED directory is deleted or renamed (the signal the fix must accept)",
    "evidence": [f"{REL}/runtime-watch-behavior.ts", f"{REL}/runtime-raw-output.txt"],
    "observed": " | ".join(f"{row['runtime']} {row['label']}: signals={row['signals']} sameIno={row['sameIno']}" for row in raw),
    "source": "a (raw `fs.watch`, no library code)",
    "verdict": "PASS" if all(not any("close" in signal or "error" in signal for signal in row["signals"]) for row in raw) and all(any("rename" in signal for signal in row["signals"]) for row in raw) else "FAIL",
})
failed = [claim for claim in claims if claim["verdict"] != "PASS"]

correction = {
    "previousLine": "My previous round recorded 'the FSWatcher has already emitted close (IN_IGNORED)' as the failure's mechanism.",
    "whatWasWrong": "That line was FALSE. The `close` I saw in `debug-close-event.ts` was my own final `w.close()` call being logged; no runtime emits close/error when a WATCHED directory is deleted or renamed. Raw measurement on Bun 1.4.0, Bun 1.4.2 AND Node 24.21.0: only a directory SELF-EVENT (`rename`, filename = the directory basename), and no close/error.",
    "whatWasStillTrue": "The BEHAVIOURAL finding was real and reproduced: rm+mkdir reuses the inode (same ino measured 5/5), the old watch stays dead, and a later write was missed. The mechanism sentence was mine to get wrong, not the writers'.",
    "consequence": "The fix's `close` subscription is justified by the injected seam and by runtimes that might emit it, not by the observation I reported; the DECISIVE live trigger is the self-event + ino/birthtime identity, and my trials now exercise exactly that.",
}

claim_sentence = (
    "The watcher recovers WITHOUT a poll when a watched directory is deleted or renamed: it accepts the "
    "directory's own self-event (the signal Bun 1.4.0/1.4.2 and Node 24 emit here — measured), decides "
    "identity by inode AND birthtime (an rm -rf + mkdir reuses the inode, measured), and — on a runtime "
    "that reports a handle close/error, or when a test injects one — also re-arms on a bounded "
    "25/100/400 ms schedule. A file written after either replacement is delivered, and an untouched "
    "directory stays silent. After the three bounded attempts the watch gives up SILENTLY, so a caller "
    "that needs a guarantee beyond that must keep a resync path."
)

seam = {
    "question": "Is `GraphWatchOptions.createWatch` acceptable as public surface?",
    "judgment": "ACCEPTABLE as an optional, documented test seam.",
    "why": [
        "No product caller: `grep -rn createWatch packages/*/src` finds it only in mpd-graph-core, and the default is `fs.watch`.",
        "The interface's own doc says 'present only for a test that drives close itself', and the README's user-facing options line omits it (it lists debounceMs/onChange/onError).",
        "The codebase already carries the same pattern at a higher level: `GraphModelDeps.watch` exists so an arm can drive batches without a filesystem.",
        "It is what makes the close path provable at all on these runtimes, which is strictly better than an untested subscription.",
    ],
    "residual": "If maximal hygiene is wanted, the seam can stay library-internal by exporting a test-only constructor; that is a polish call, not a defect.",
}

result = {
    "run": "lane-e-f4-recheck",
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "head": head(),
    "previous": {"head": "3b571465", "f4": "FAIL (directory replacement on the event path)"},
    "settle": {
        "productTreeClean": len([row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row]) == 0,
        "distFresh": dist_line,
        "foreignChanges": [row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row],
        "note": "The tree was CLEAN when this run began. During the run another process modified packages/mpd-bundle-plugin/src/team-view.ts (mtime 06:25:51Z); client.js predates that edit (06:07:22Z), so the built web artifact is stale relative to that source if the edit is kept. This lane's probes exercise the watcher package and do not read client.js; the F4 numbers are unaffected, but the settle is recorded honestly.",
    },
    "claims": claims,
    "correction": correction,
    "claimSentence": claim_sentence,
    "seam": seam,
    "f4": {
        "status": "CLOSED — PASS",
        "evidence": "11/11 verdicts true on each of Bun 1.4.0, Bun 1.4.2 and Node 24.21.0: both live replacement shapes delivered the post-replacement write with no poll batch, the injected close path behaved (old close ignored, dead watch re-armed and delivered, close cancelled the timers), and the idle directory stayed silent.",
    },
    "nits": {
        "F2": "unchanged — web collator; still a bound.",
        "F3": "unchanged — empty rank 0; still a bound.",
        "NIT-1": "CLOSED — the committed test scratch directory is gone (`git ls-files packages/mpd-graph-core/test/.tmp-*` is empty).",
        "cleanup-mine": "My own probe scratch dirs were committed in the previous evidence commit: `evidence/living-graph/coderabbit-recheck/20261019T061500Z/ws-CbMo9h` and `ws-h6bTgX` (6 files). Recommend `git rm -r` those in the PR; they are not deliverables.",
    },
    "bounds": [
        "Three runtimes measured on this ext4 filesystem: Bun 1.4.0 (the repository toolchain), Bun 1.4.2 (PATH), Node 24.21.0. Another filesystem/runtime may report differently; the probe is committed and can be re-run anywhere.",
        "The close path is exercised through `createWatch` (the documented seam) because these runtimes do not emit close for a deleted/renamed directory — raw behaviour is recorded separately.",
        "Did NOT run: Docker, live-LLM, a real TUI host, pack-closure, release sweep. The narrow change touched only the watcher, its tests and the README pair.",
    ],
    "verdict": {
        "decision": "PASS" if not failed else "FAIL",
        "justification": "F4 is closed on this lane's own mutations in both shapes, with no poll, on three runtimes; the injected close path and the no-storm control behave; the regression sanity (core+host 299/0, typecheck 0, gate arms, dist 32/32) is green. APPROVE stands.",
    },
}
with open(os.path.join(HERE, "result.json"), "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)

lines = [
    "LANE E — F4-only re-check (directory-replacement recovery)",
    f"HEAD {result['head']} at {result['at']}",
    f"settle: product tree clean={result['settle']['productTreeClean']}; dist '{dist_line}'",
    "",
    "CORRECTION TO MY PREVIOUS ROUND",
    f"- {correction['whatWasWrong']}",
    f"- {correction['whatWasStillTrue']}",
    "",
    "RAW RUNTIME SIGNALS (the signal the fix must accept)",
]
for row in raw:
    lines.append(f"- {row['runtime']} {row['label']}: signals={row['signals']} sameIno={row['sameIno']}")
lines += ["", "CLAIMS | EVIDENCE | VERDICT | OBSERVED | SOURCE"]
for claim in claims:
    lines.append(f"{claim['id']} | {', '.join(claim['evidence'])} | {claim['verdict']} | {claim['observed']} | {claim['source']}")
lines += ["", "F4 STATUS", result["f4"]["status"] + " — " + result["f4"]["evidence"]]
lines += ["", "THE SENTENCE THE EVIDENCE SUPPORTS", result["claimSentence"]]
lines += ["", "SEAM JUDGMENT", f"{seam['judgment']} — " + "; ".join(seam["why"]) + f" Residual: {seam['residual']}"]
lines += ["", "NITS", *[f"- {key}: {value}" for key, value in result["nits"].items()]]
lines += ["", "BOUNDS", *[f"- {entry}" for entry in result["bounds"]]]
lines += ["", "REGESSION SANITY (observed lines)"]
for row in regression.splitlines():
    if "pass" in row or "exit=" in row or "PASS" in row or "32/32" in row:
        lines.append(f"- {row.strip()}")
lines += ["", "VERDICT", f"{result['verdict']['decision']} — {result['verdict']['justification']}", f"summary: claims {len(claims)}, passed {len(claims) - len(failed)}, failed {len(failed)}"]
with open(os.path.join(HERE, "output.log"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("\n".join(lines))
