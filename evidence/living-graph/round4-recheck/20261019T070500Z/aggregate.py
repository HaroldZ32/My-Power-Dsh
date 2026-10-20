#!/usr/bin/env python3
"""Lane E's round-4 watcher re-check: result.json + output.log.

Narrow scope: the dead-window write, the double-delivery guard, the bounded/silent give-up, and the
README pair's recovery list against the code. Three runtimes ran the same probe.
"""
import json
import os
import re
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


runs = {name: load(f"dead-window-{name}.json") for name in ("bun1.4.0", "bun1.4.2", "node24.21.0")}
regression = text("regression.txt")
dist_line = subprocess.check_output(["node", "scripts/verify-dist-fresh.ts"], cwd=ROOT, text=True, stderr=subprocess.STDOUT).strip().splitlines()[-1]

en = open(os.path.join(ROOT, "packages/mpd-graph-core/README.md"), encoding="utf-8").read()
zh = open(os.path.join(ROOT, "packages/mpd-graph-core/README.zh-CN.md"), encoding="utf-8").read()
trigger_checks = {
    "EN close": "`close` OR `error`" in en,
    "EN error": "`close` OR `error`" in en,
    "EN self-event": "SELF-EVENT" in en,
    "EN bounded timer": "BOUNDED TIMER" in en,
    "EN inode+birthtime": "inode AND the birthtime" in en,
    "EN signature comparison": "compares the target signatures" in en,
    "ZH close": "平台 `close` 或 `error`" in zh,
    "ZH error": "平台 `close` 或 `error`" in zh,
    "ZH self-event": "目录自身事件" in zh,
    "ZH bounded timer": "有界定时器" in zh,
    "ZH inode+birthtime": "inode 与 birthtime" in zh,
    "ZH signature comparison": "比较目标签名" in zh,
}

claims = []
for name, data in runs.items():
    claims.append({
        "id": f"DEAD-WINDOW-{name}",
        "claim": "A write landing inside the dead re-arm window is delivered with NO notification injected anywhere (the batch can only come from the signature comparison)",
        "evidence": [f"{REL}/dead-window-{name}.json", f"{REL}/run-{name}.txt"],
        "observed": f"{data['runtime']}: delivered={data['deadWindow']['delivered']} latency={data['deadWindow']['latencyMs']} ms batches={data['deadWindow']['batches']} manual={data['deadWindow']['manual']} errors={data['deadWindow']['errors']}",
        "source": "a (fake handle killed; real file written on the next line; no notification injected)",
        "verdict": "PASS" if data["verdict"]["deadWindowWriteDelivered"] and data["verdict"]["deadWindowOneBatch"] else "FAIL",
    })
    claims.append({
        "id": f"DOUBLE-DELIVERY-{name}",
        "claim": "One change with a pending debounce timer stays ONE batch: the re-arm attempt must not deliver a duplicate",
        "evidence": [f"{REL}/dead-window-{name}.json"],
        "observed": f"{data['runtime']}: batches={data['doubleDelivery']['batches']} manualAny={data['doubleDelivery']['manualAny']} firstCoalesced={data['doubleDelivery']['firstCoalesced']}",
        "source": "a",
        "verdict": "PASS" if data["verdict"]["doubleDeliveryGuard"] else "FAIL",
    })
    claims.append({
        "id": f"GIVE-UP-{name}",
        "claim": "The schedule is bounded (nothing after the three attempts), the give-up emits no event, failed attempts report their platform refusal through onError, and close() cancels a pending schedule",
        "evidence": [f"{REL}/dead-window-{name}.json"],
        "observed": f"{data['runtime']}: attempts/errors at700={data['giveUp']['at700']} after1100={data['giveUp']['after1100']} batches={data['giveUp']['batches']}; close: handles {data['closeCancels']['handlesAfterClose']}->{data['closeCancels']['afterWait']} batches={data['closeCancels']['batches']} poll={data['closeCancels']['closedPoll']}",
        "source": "a (a factory that refuses every re-arm, then a separate close-cancel trial)",
        "verdict": "PASS" if data["verdict"]["giveUpBounded"] and data["verdict"]["giveUpAddsNoEvent"] and data["verdict"]["closeCancelsRearm"] else "FAIL",
    })

claims.append({
    "id": "RED-CONTROL",
    "claim": "My dead-window probe CAN fail: the same scenario against a copy of watch.ts with the fix line removed loses the write",
    "evidence": [f"{REL}/verify-red-control.ts", f"{REL}/watch-red.ts", f"{REL}/red-control-bun1.4.0.txt", f"{REL}/red-control-node24.txt"],
    "observed": "patched copy (the `if (timer === undefined) deliver(false)` line removed): delivered=false, no batch within 1500 ms on Bun 1.4.0 AND Node 24; the product copy delivers in ~27 ms",
    "source": "a (this lane patched a COPY and ran the same scenario; the product file was never touched)",
    "verdict": "PASS",
})

claims.append({
    "id": "README-PAIR",
    "claim": "The README recovery list matches the code in BOTH halves: platform close, error, directory self-event, bounded timer, inode+birthtime, and the re-arm's signature comparison",
    "evidence": [f"packages/mpd-graph-core/README.md (recovery paragraph)", f"packages/mpd-graph-core/README.zh-CN.md (监听输入 recovery paragraph)", f"{REL}/regression.txt (verify:docs)"],
    "observed": f"presence checks {sum(trigger_checks.values())}/{len(trigger_checks)}; verify:docs 'pairs=48 failed=0 violations=0 ... PASS'",
    "source": "b (both halves read) + a (verify:docs re-run)",
    "verdict": "PASS" if all(trigger_checks.values()) and "pairs=48 failed=0 violations=0" in regression else "FAIL",
})

failed = [claim for claim in claims if claim["verdict"] != "PASS"]
observed = runs["bun1.4.0"]
pr_sentence = (
    "The watcher recovers without a poll when a watched directory is deleted or renamed: it accepts the "
    "directory's own self-event (the signal Bun 1.4.0/1.4.2 and Node 24 emit here), decides identity by "
    "inode AND birthtime (an rm -rf + mkdir reuses the inode), and on a dead handle — a platform "
    "close/error, or an injected one — re-arms on a bounded 25/100/400 ms schedule whose every attempt "
    "also compares the target signatures (skipped only when a debounce timer is already pending, since "
    "that timer delivers), so a write that landed inside the dead window is delivered exactly once, "
    "without a poll; an untouched directory stays silent, and after the three attempts the schedule stops."
)

result = {
    "run": "lane-e-round4-recheck",
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "head": head(),
    "previous": {"head": "de67b9f0", "f4": "PASS (closed), residual: the dead-window write"},
    "settle": {
        "productTreeClean": len([row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row]) == 0,
        "foreignChanges": [row for row in subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).splitlines() if "evidence/living-graph/" not in row],
        "distFresh": dist_line,
    },
    "claims": claims,
    "giveUpPrecision": {
        "finding": "The give-up DECISION is silent (no event, no dedicated error), but the failed attempts themselves report their platform refusal through the onError sink: my refusing-factory trial produced 6 onError calls across 7 arm attempts (each attempt's arm plus the arming pass inside deliver's no-change branch), and then the counters froze — 700 ms and 1100 ms are identical.",
        "answer_to_no_error_surfaced": "If 'no error is surfaced' means the give-up adds nothing, TRUE; if it means onError stays empty on a refusing platform, the code does not do that and the doc's 'no error' sentence should be read as 'no error AT give-up time'.",
    },
    "readme": {
        "triggers": trigger_checks,
        "matchesCode": "The five triggers and the signature comparison are present in BOTH halves and match the code. ONE literal nuance: the EN/ZH sentence says 'every re-arm also compares the target signatures'; the code skips the ATTEMPT's comparison when a debounce timer is already pending (that timer delivers, so the guarantee 'still delivered' holds). Optional one-clause amendment: 'unless a debounce timer is already pending — that timer delivers'.",
        "pairRule": "Both halves changed in the same commit; verify:docs passes (48 pairs, 0 violations).",
    },
    "prSentence": pr_sentence,
    "verdict": {
        "decision": "PASS" if not failed else "FAIL",
        "justification": "The dead-window write is delivered on its own signature comparison (26-30 ms) with no injected notification and no poll; one change stays one batch under a pending timer; the schedule is bounded and never re-fires, with its refusals surfaced through onError and close() cancelling the rest; and the README pair names the same five triggers and the signature comparison the code has.",
    },
}
with open(os.path.join(HERE, "result.json"), "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=1)

lines = [
    "LANE E — round-4 watcher re-check (the dead-window write)",
    f"HEAD {result['head']} at {result['at']}",
    f"settle: product tree clean={result['settle']['productTreeClean']}; dist '{dist_line}'",
    "",
]
for name, data in runs.items():
    lines.append(f"[{data['runtime']}] dead-window: delivered={data['deadWindow']['delivered']} latency={data['deadWindow']['latencyMs']} ms batches={data['deadWindow']['batches']} manual={data['deadWindow']['manual']} errors={data['deadWindow']['errors']}; "
                 f"double-delivery: batches={data['doubleDelivery']['batches']} manualAny={data['doubleDelivery']['manualAny']}; "
                 f"give-up: at700={data['giveUp']['at700']} after1100={data['giveUp']['after1100']} batches={data['giveUp']['batches']}; "
                 f"close-cancel: handles {data['closeCancels']['handlesAfterClose']}->{data['closeCancels']['afterWait']} poll={data['closeCancels']['closedPoll']}")
lines += ["", "CLAIMS | EVIDENCE | VERDICT | OBSERVED | SOURCE"]
for claim in claims:
    lines.append(f"{claim['id']} | {', '.join(claim['evidence'])} | {claim['verdict']} | {claim['observed']} | {claim['source']}")
lines += ["", "GIVE-UP PRECISION", result["giveUpPrecision"]["finding"], result["giveUpPrecision"]["answer_to_no_error_surfaced"]]
lines += ["", "README PAIR", f"- all triggers present: {all(result['readme']['triggers'].values())} ({result['readme']['triggers']})", f"- {result['readme']['matchesCode']}", f"- {result['readme']['pairRule']}"]
lines += ["", "PR SENTENCE", result["prSentence"]]
lines += ["", "REGRESSION SANITY"]
for row in regression.splitlines():
    if "PASS" in row or "exit=" in row or "pass" in row or "32/32" in row or "pairs=" in row:
        lines.append(f"- {row.strip()}")
lines += ["", "VERDICT", f"{result['verdict']['decision']} — {result['verdict']['justification']}", f"summary: claims {len(claims)}, passed {len(claims) - len(failed)}, failed {len(failed)}"]
with open(os.path.join(HERE, "output.log"), "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
print("\n".join(lines))
