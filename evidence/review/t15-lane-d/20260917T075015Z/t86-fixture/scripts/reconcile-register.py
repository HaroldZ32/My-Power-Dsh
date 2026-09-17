#!/usr/bin/env python3
"""Reconcile the register partition and FAIL LOUDLY on any disagreement (T-86).

This is the DURABLE home of the reconciliation the wave-1 integration ran from
`evidence/wave1-integration/20260917T052400Z/reconcile-register.py` — a sealed record that stays
byte-untouched. Three defects of that copy are fixed here, all measured on 2026-09-17:

  * `:22 ROOT = HERE.parents[2]` was a HARDCODED DEPTH: relocating the script silently re-anchored
    ROOT (a different `.mpd/TODO.md`, or a FileNotFoundError on a path nobody expected). Here the
    root is resolved from a MARKER (walk up until `.mpd/TODO.md` exists) with `git rev-parse
    --show-toplevel` as the fallback — never a fixed number of parents.
  * `:33` hardcoded the team id and the live path, so the standing one-team-per-wave rule (archive on
    merge) REMOVED its own input: on the archived team it died with
    `FileNotFoundError … .mpd/team/friction-p1-wave/team.json`, exit 1. Here the team record is
    resolved from the live dir OR `.mpd/team/archive/<team>/`, or taken explicitly with `--team`.
  * `:120-121` wrote the artifacts only at the END, so a FAILED re-run left the PREVIOUS revision's
    artifacts in place looking current. Here every run reports the paths it read, and a failed run
    writes a FAILURE MARKER (`register-partition-check.FAILED`) beside the artifacts, so a stale
    reading cannot be mistaken for the current one.

Directions (unchanged from the wave-1 script, so the results stay comparable):
  1. INTERNAL  — every id of T-01…T-60 gets exactly one disposition from `.mpd/TODO.md`
                 §8.2/§8.3/§8.4/§8.5, and the §8.1 arithmetic is re-derived from those lists.
  2. COVERAGE  — cross-check that partition against the wave's own coverage list in the team record
                 (each task's `coverageOf`): every item claimed FIXED must carry an implementation
                 task, and no item listed UNTOUCHED may carry one.
  3. PROSE     — §8.1's prose numbers must equal the values derived from the sections.

usage:
  python3 scripts/reconcile-register.py [--team <id>] [--team-file <path>] [--out <dir>]
                                        [--allow-existing] [--quiet]

exit codes: 0 reconciled | 1 at least one disagreement | 3 unusable input or IO (a usage error,
never a silent pass). On any non-zero exit a FAILURE MARKER is written beside the artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

IMPL_KINDS = {"implementation", "repair"}
FAILED_MARKER = "register-partition-check.FAILED"
ARTIFACT_JSON = "register-partition-check.json"
ARTIFACT_LOG = "register-partition-check.log"
DEFAULT_OUT_PARENT = Path("evidence") / "dsh-qa" / "register-reconciliation"


class UnusableInput(Exception):
    """Input the run cannot proceed on: reported, marked, exit 3 — never a traceback."""


def find_root(start: Path) -> Path:
    """RELOCATION-PROOF root: the nearest ancestor carrying the `.mpd/TODO.md` marker.

    Falls back to `git rev-parse --show-toplevel`; a hardcoded depth is never used, because that is
    exactly the defect this script replaces (`:22 ROOT = HERE.parents[2]`).
    """
    for candidate in [start, *start.parents]:
        if (candidate / ".mpd" / "TODO.md").exists():
            return candidate
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start, capture_output=True, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise UnusableInput(
            "no repo root found: no ancestor of " + str(start) + " carries .mpd/TODO.md and "
            "`git rev-parse --show-toplevel` failed (" + type(error).__name__ + ")"
        ) from error
    root = Path(out.stdout.strip())
    if not (root / ".mpd" / "TODO.md").exists():
        raise UnusableInput("git root " + str(root) + " carries no .mpd/TODO.md")
    return root


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def sha256_prefix(path: Path, length: int = 16) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:length]


def section(todo: str, n: int) -> str:
    m = re.search(rf"^### 8\.{n}.*?$(.*?)(?=^### 8\.|\Z)", todo, re.M | re.S)
    return m.group(1) if m else ""


def load_team_record(path: Path) -> list[dict]:
    try:
        team = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise UnusableInput("team record not found: " + str(path))
    except json.JSONDecodeError as error:
        raise UnusableInput("team record is not valid JSON (" + str(path) + "): " + error.msg)
    tasks = team.get("tasks")
    if not isinstance(tasks, list):
        tasks = next((v for v in team.values() if isinstance(v, list) and v and isinstance(v[0], dict) and "id" in v[0]), None)
    if not isinstance(tasks, list):
        raise UnusableInput("team record carries no task list: " + str(path))
    return tasks


def coverage_candidates(root: Path) -> list[tuple[str, str, Path]]:
    """Every team record that carries `coverageOf` entries, as (team, plane, path)."""
    found: list[tuple[str, str, Path]] = []
    for plane, base in (("live", root / ".mpd" / "team"), ("archive", root / ".mpd" / "team" / "archive")):
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir()):
            record = child / "team.json"
            if not record.is_file():
                continue
            try:
                tasks = load_team_record(record)
            except UnusableInput:
                continue
            if any(task.get("coverageOf") for task in tasks):
                found.append((child.name, plane, record))
    return found


def resolve_team(root: Path, team_id: str | None, team_file: str | None) -> tuple[str, str, Path]:
    """The team record to reconcile: explicit file, explicit id (live OR archive), or the unique
    candidate carrying `coverageOf`. Ambiguity is reported with the candidates, never guessed."""
    if team_file:
        path = Path(team_file)
        path = path if path.is_absolute() else (root / path)
        if not path.is_file():
            raise UnusableInput("--team-file does not exist: " + str(path))
        return (path.parent.name, "explicit-file", path)
    if team_id:
        live = root / ".mpd" / "team" / team_id / "team.json"
        archive = root / ".mpd" / "team" / "archive" / team_id / "team.json"
        if live.is_file():
            return (team_id, "live", live)
        if archive.is_file():
            return (team_id, "archive", archive)
        raise UnusableInput(
            "--team " + team_id + " resolves to neither " + str(live) + " nor " + str(archive)
        )
    candidates = coverage_candidates(root)
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise UnusableInput(
            "no team record carries a `coverageOf` list under " + str(root / ".mpd" / "team")
            + " (live or archive) — pass --team <id> or --team-file <path>"
        )
    raise UnusableInput(
        "ambiguous team input: " + str(len(candidates)) + " records carry `coverageOf` ("
        + ", ".join(team + " [" + plane + "]" for team, plane, _ in candidates)
        + ") — pass --team <id> or --team-file <path>"
    )


def write_failure_marker(marker: Path, payload: dict) -> None:
    """A failed run must leave a marker that supersedes whatever artifacts sit beside it."""
    marker.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def analyse(todo: str, tasks: list[dict]) -> dict:
    coverage: dict[str, list[tuple[str, str, str]]] = {}
    for task in tasks:
        for item in task.get("coverageOf") or []:
            coverage.setdefault(item, []).append((task["id"], task.get("kind", "?"), task.get("status", "?")))

    fixed = re.findall(r"^\| (T-\d+)", section(todo, 2), re.M)
    already = re.findall(r"^- \*\*(T-\d+)", section(todo, 3), re.M)
    partial = re.findall(r"^- \*\*(T-\d+)", section(todo, 4), re.M)
    untouched = sorted(set(re.findall(r"(T-\d+)", section(todo, 5))))
    new_rows = re.findall(r"^- \*\*(T-\d+)", section(todo, 6), re.M)

    originals = [f"T-{n:02d}" for n in range(1, 61)]
    touched = sorted(set(fixed + already + partial))
    disp = {**{i: "FIXED" for i in fixed}, **{i: "ALREADY" for i in already},
            **{i: "PARTIAL" for i in partial},
            **{i: "UNTOUCHED" for i in untouched if i in originals}}

    problems: list[str] = []
    for i in originals:
        if i not in disp:
            problems.append(f"{i}: no disposition in §8.2-§8.5")
    for name, ids in (("§8.2", fixed), ("§8.3", already), ("§8.4", partial)):
        for d in sorted({i for i in ids if ids.count(i) > 1}):
            problems.append(f"{d}: listed more than once in {name}")
    # A NEW row (§8.6) may legitimately be carried in §8.5 as "deferred after partial work" (T-67).
    # Only an id that is neither an original nor a §8.6 row is a real error.
    outside = sorted(set(touched + untouched) - set(originals) - set(new_rows))
    for o in outside:
        problems.append(f"{o}: named in §8.2-§8.5 but is neither an original T-01..T-60 item nor a §8.6 new row")
    for i in sorted(set(untouched) - set(originals)):
        if i not in new_rows:
            problems.append(f"{i}: listed as untouched but is not an original item")
    if any(i in already or i in partial or i in fixed for i in new_rows):
        problems.append("a §8.6 NEW row is also claimed as touched in §8.2-§8.4 — new rows are accounted in §8.6")

    for i in sorted(fixed):
        if not any(k in IMPL_KINDS for _, k, _ in coverage.get(i, [])):
            problems.append(f"{i}: called FIXED but no implementation task claims coverageOf it")
    for i in untouched:
        if i in originals and any(k in IMPL_KINDS for _, k, _ in coverage.get(i, [])):
            problems.append(f"{i}: called UNTOUCHED but an implementation task claims coverageOf it")

    n_fixed, n_already, n_partial = len(set(fixed)), len(set(already)), len(set(partial))
    n_un = len([i for i in untouched if i in originals])
    total = n_fixed + n_already + n_partial + n_un

    # Direction 3: §8.1's PROSE numbers must equal the values derived from the sections.
    prose_patterns = {
        "fixed": (r"FIXED this wave.*?:\s*(\d+)\*\*", n_fixed),
        "touched": (r"Touched by this wave:\s*\*\*(\d+)\*\*", n_fixed + n_already + n_partial),
        "untouched": (r"Untouched:\s*\*\*(\d+)\*\*", n_un),
        "new rows": (r"New rows discovered and appended:\s*\*\*(\d+)\*\*", len(new_rows)),
    }
    prose_seen: dict[str, int | None] = {}
    for label, (pattern, derived) in prose_patterns.items():
        m = re.search(pattern, todo, re.S)
        prose_seen[label] = int(m.group(1)) if m else None
        if not m:
            problems.append(f"§8.1 prose: the '{label}' number is not found")
        elif int(m.group(1)) != derived:
            problems.append(f"§8.1 prose says {label}={m.group(1)} but the sections give {derived}")

    return {
        "fixed": fixed, "already": already, "partial": partial, "untouched": untouched,
        "new_rows": new_rows, "n_fixed": n_fixed, "n_already": n_already, "n_partial": n_partial,
        "n_un": n_un, "total": total, "prose_seen": prose_seen, "prose_patterns": prose_patterns,
        "problems": problems, "coverage": coverage, "originals": originals,
        "touched": touched,
    }


def render_log(result: dict, todo_sha: str) -> str:
    lines = [
        f"=== register partition re-check (three directions) — .mpd/TODO.md sha256 {todo_sha} ===",
        f"§8.2 FIXED rows            = {result['n_fixed']}",
        f"§8.3 ALREADY-FIXED rows    = {result['n_already']}  -> {' '.join(sorted(set(result['already'])))}",
        f"§8.4 PARTIAL rows          = {result['n_partial']}  -> {' '.join(sorted(set(result['partial'])))}",
        f"touched (union, originals) = {result['n_fixed'] + result['n_already'] + result['n_partial']}",
        f"§8.5 untouched originals   = {result['n_un']}",
        f"§8.5 also lists            = {' '.join(sorted(set(result['untouched']) - set(result['originals']))) or '(nothing non-original)'}",
        f"ARITHMETIC                 = {result['n_fixed']} + {result['n_already']} + {result['n_partial']} + {result['n_un']} = {result['total']} (must be 60)",
        f"§8.6 new rows              = {len(result['new_rows'])}; ids: {' '.join(result['new_rows'])}",
        f"DIRECTION 1 (internal)     = {'CLEAN' if not result['problems'] else 'DISAGREEMENT'}",
        f"DIRECTION 2 (coverage list from the team record) = {'CLEAN' if not result['problems'] else 'DISAGREEMENT'}"
        " — every FIXED item carries an implementation task, no UNTOUCHED item does",
        f"DIRECTION 3 (§8.1 prose vs the sections) = {result['prose_seen']}",
        f"DISAGREEMENTS              = {len(result['problems'])}" + ("" if not result['problems'] else "\n  - " + "\n  - ".join(result['problems'])),
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reconcile the .mpd/TODO.md register partition against a wave's coverage list (T-86).",
        epilog="exit codes: 0 reconciled | 1 disagreement | 3 unusable input; a non-zero exit writes "
               + FAILED_MARKER + " beside the artifacts.",
    )
    parser.add_argument("--team", help="team id; resolved from .mpd/team/<id>/ or .mpd/team/archive/<id>/")
    parser.add_argument("--team-file", help="explicit path to a team.json (overrides --team)")
    parser.add_argument("--out", help="artifact directory (default: " + str(DEFAULT_OUT_PARENT) + "/<utc-stamp>/)")
    parser.add_argument("--allow-existing", action="store_true", help="allow writing into an --out dir that already holds artifacts")
    parser.add_argument("--quiet", action="store_true", help="do not echo the log to stdout")
    args = parser.parse_args()

    try:
        root = find_root(Path(__file__).resolve().parent)
    except UnusableInput as error:
        print("[reconcile-register] " + str(error), file=sys.stderr)
        return 3

    out_dir = Path(args.out) if args.out else (root / DEFAULT_OUT_PARENT / utc_stamp())
    out_dir = out_dir if out_dir.is_absolute() else (Path.cwd() / out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    marker = out_dir / FAILED_MARKER

    existing = [name for name in (ARTIFACT_JSON, ARTIFACT_LOG) if (out_dir / name).exists()]
    if existing and not args.allow_existing:
        payload = {
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "reason": "--out already holds artifacts (" + ", ".join(existing) + "); pass --allow-existing to supersede them",
            "outDir": str(out_dir),
        }
        write_failure_marker(marker, payload)
        print("[reconcile-register] " + payload["reason"], file=sys.stderr)
        return 3

    try:
        team, plane, team_path = resolve_team(root, args.team, args.team_file)
        todo_path = root / ".mpd" / "TODO.md"
        if not todo_path.is_file():
            raise UnusableInput("register not found: " + str(todo_path))
        todo = todo_path.read_text(encoding="utf-8")
        tasks = load_team_record(team_path)
    except UnusableInput as error:
        payload = {
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "reason": str(error),
            "outDir": str(out_dir),
            "supersedes": existing,
            "note": "this run produced NO current reading; the artifacts beside this marker (if any) are stale",
        }
        write_failure_marker(marker, payload)
        print("[reconcile-register] UNUSABLE INPUT: " + str(error), file=sys.stderr)
        return 3

    todo_sha = sha256_prefix(todo_path)
    result = analyse(todo, tasks)
    problems = result["problems"]
    log = render_log(result, todo_sha)
    (out_dir / ARTIFACT_LOG).write_text(log, encoding="utf-8")
    (out_dir / ARTIFACT_JSON).write_text(
        json.dumps(
            {
                # Every path this reading was taken from, so a reader never has to guess (T-86).
                "todo_path": str(todo_path),
                "todo_sha256_prefix": todo_sha,
                "team_path": str(team_path),
                "team_plane": plane,
                "team_id": team,
                "out_dir": str(out_dir),
                "root": str(root),
                "root_resolution": "marker walk (.mpd/TODO.md) or `git rev-parse --show-toplevel` — never a hardcoded depth",
                "fixed_section_rows": result["n_fixed"],
                "already_fixed": result["n_already"],
                "partial": result["n_partial"],
                "touched_originals": result["n_fixed"] + result["n_already"] + result["n_partial"],
                "untouched_originals_listed": result["n_un"],
                "sum": result["total"],
                "new_rows_appended": len(result["new_rows"]),
                "new_row_ids": result["new_rows"],
                "section_5_non_original_ids": sorted(set(result["untouched"]) - set(result["originals"])),
                "direction_1_internal": "clean" if not problems else "disagreement",
                "direction_2_coverage": "clean" if not problems else "disagreement",
                "direction_3_prose": result["prose_seen"],
                "prose_matches_sections": all(
                    result["prose_seen"].get(k) == v for k, (_, v) in result["prose_patterns"].items()
                ),
                "disagreements": problems,
                "section_5_non_original_note": "a §8.6 new row carried in §8.5 as deferred after partial work"
                if set(result["untouched"]) - set(result["originals"]) else None,
                "fixed_ids": sorted(set(result["fixed"])),
                "untouched_ids": sorted(i for i in result["untouched"] if i in result["originals"]),
                "coverage_chain_for_fixed": {
                    i: sorted({t for t, _, _ in result["coverage"].get(i, [])}) for i in sorted(set(result["fixed"]))
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print("[reconcile-register] root      = " + str(root))
    print("[reconcile-register] register  = " + str(todo_path) + "  sha256 " + todo_sha)
    print("[reconcile-register] team      = " + str(team_path) + "  (" + plane + ", team " + team + ")")
    print("[reconcile-register] artifacts = " + str(out_dir))
    if problems:
        payload = {
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "reason": str(len(problems)) + " disagreement(s)",
            "todo_path": str(todo_path),
            "todo_sha256_prefix": todo_sha,
            "team_path": str(team_path),
            "team_plane": plane,
            "outDir": str(out_dir),
            "disagreements": problems,
            "supersedes": existing,
            "note": "this run FAILED: the artifacts beside this marker are NOT a current reading",
        }
        write_failure_marker(marker, payload)
        if not args.quiet:
            print(log, end="")
        return 1

    marker.unlink(missing_ok=True)
    if not args.quiet:
        print(log, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
