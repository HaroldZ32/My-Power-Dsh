#!/usr/bin/env python3
"""Recompute the VEdit throughput incident measurements from the harness session store.

Reads ONLY the local DSH session store and the VEdit workspace's team records; writes a
machine-readable summary to stdout (JSON). Every number quoted in report.md is produced here.

Usage:
  python3 scan_sessions.py --sessions-root ~/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-VEdit-- \
      --workspace /home/haroldzhao/MyProj/DshProj/VEdit --since 2026-11-04 --until 2026-11-06
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import glob
import json
import os
import subprocess
import sys


def read_session(path: str) -> dict:
    """Decode one concatenated-zstd JSONL session file into its head record and events."""
    out = subprocess.run(["zstd", "-dc", path], capture_output=True, text=True)
    lines = [line for line in out.stdout.splitlines() if line.strip()]
    if not lines:
        return {}
    head = json.loads(lines[0])
    events = []
    for line in lines[1:]:
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"head": head, "events": events}


def event_time(event: dict) -> int | None:
    """Return the epoch-millisecond stamp of a session event, or None."""
    stamp = event.get("time") or event.get("ts")
    return stamp if isinstance(stamp, int) else None


def scan(sessions_root: str, since_ms: int, until_ms: int) -> list[dict]:
    """Summarize every session under the root whose creation falls inside the window."""
    rows = []
    for entry in os.listdir(sessions_root):
        directory = os.path.join(sessions_root, entry)
        path = os.path.join(directory, "session.v4.jsonl.zstd")
        if not os.path.isdir(directory) or not os.path.exists(path):
            continue
        decoded = read_session(path)
        if not decoded:
            continue
        head, events = decoded["head"], decoded["events"]
        created = head.get("createdAt")
        if not isinstance(created, int) or created < since_ms or created >= until_ms:
            continue
        first = last = None
        tools = collections.Counter()
        for event in events:
            stamp = event_time(event)
            if stamp is not None:
                first = first or stamp
                last = stamp
            if event.get("type") == "tool/call":
                name = (event.get("data") or {}).get("name") or ""
                tools[name] += 1
        rows.append(
            {
                "id": head.get("id") or entry,
                "origin": head.get("origin"),
                "parent": head.get("parentSession"),
                "depth": head.get("delegationDepth"),
                "createdAt": created,
                "lastAt": last,
                "durationMinutes": round(((last or created) - created) / 60000.0, 1),
                "toolCalls": sum(tools.values()),
                "tools": dict(tools.most_common(8)),
            }
        )
    rows.sort(key=lambda row: row["createdAt"])
    return rows


def in_flight_at(events: list[dict], mark_ms: int) -> str | None:
    """Return the tool name whose call is still open at mark_ms, or None.

    Pairs tool/call and tool/result by callId, so a call that started before the mark and has
    not returned yet is the only answer. This is the measurement behind the "in-flight bash is
    exempt" rule.
    """
    calls: dict[str, tuple[int, str]] = {}
    results: set[str] = set()
    for event in events:
        stamp = event_time(event)
        if stamp is None:
            continue
        if event.get("type") == "tool/call":
            data = event.get("data") or {}
            calls[str(data.get("callId"))] = (stamp, str(data.get("name") or ""))
        elif event.get("type") == "tool/result":
            source = (event.get("data") or {}).get("source") or {}
            call_id = (event.get("data") or {}).get("toolCallId") or source.get("callId")
            if call_id is not None:
                results.add(str(call_id))
    open_at_mark = [
        (start, name)
        for call_id, (start, name) in calls.items()
        if start <= mark_ms and call_id not in results
    ]
    if not open_at_mark:
        return None
    return max(open_at_mark)[1]


def spawn_gaps(rows: list[dict]) -> list[dict]:
    """Pair consecutive one-shot child sessions with the gap that separates them."""
    pairs = []
    for previous, current in zip(rows, rows[1:]):
        pairs.append(
            {
                "previous": previous["id"],
                "previousMinutes": previous["durationMinutes"],
                "next": current["id"],
                "gapMinutes": round((current["createdAt"] - (previous["lastAt"] or previous["createdAt"])) / 60000.0, 1),
            }
        )
    return pairs


def team_records(workspace: str) -> list[dict]:
    """Summarize every MPD team record in the workspace."""
    out = []
    for path in sorted(glob.glob(os.path.join(workspace, ".mpd", "team", "teams", "*.json"))):
        try:
            record = json.load(open(path))
        except (OSError, json.JSONDecodeError):
            continue
        tasks = record.get("tasks") or []
        out.append(
            {
                "file": os.path.basename(path),
                "name": record.get("name"),
                "phase": record.get("phase"),
                "leadSessionId": record.get("leadSessionId"),
                "createdAt": record.get("createdAt"),
                "endedAt": record.get("endedAt"),
                "members": len(record.get("members") or []),
                "taskCount": len(tasks),
                "taskStatuses": dict(collections.Counter(task.get("status") for task in tasks)),
            }
        )
    return out


def main() -> int:
    """Parse arguments, scan, and print the JSON summary."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions-root", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--since", default="2026-11-04")
    parser.add_argument("--until", default="2026-11-06")
    args = parser.parse_args()

    since_ms = int(dt.datetime.fromisoformat(args.since).timestamp() * 1000)
    until_ms = int(dt.datetime.fromisoformat(args.until).timestamp() * 1000)
    rows = scan(args.sessions_root, since_ms, until_ms)
    durations = [row["durationMinutes"] for row in rows]
    summary = {
        "window": {"since": args.since, "until": args.until},
        "sessions": len(rows),
        "children": len([row for row in rows if row["origin"] == "subagent"]),
        "over15Minutes": len([value for value in durations if value > 15]),
        "longestMinutes": max(durations) if durations else 0,
        "totalChildHours": round(sum(durations) / 60.0, 1),
        "medianMinutes": sorted(durations)[len(durations) // 2] if durations else 0,
        "serialGapPairs": spawn_gaps(rows),
        "teams": team_records(args.workspace),
        "sessionsDetail": rows,
    }
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
