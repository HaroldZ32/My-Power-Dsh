#!/usr/bin/env python3
"""Reconcile the wave-1 register partition two ways and FAIL LOUDLY on any disagreement.

Direction 1 (internal): every id of T-01…T-60 gets exactly one disposition from
`.mpd/TODO.md` §8.2/§8.3/§8.4/§8.5, and the §8.1 arithmetic is re-derived from those lists.

Direction 2 (coverage): cross-check that partition against the wave's own coverage list in the team
record (`.mpd/team/friction-p1-wave/team.json`, each task's `coverageOf`): every item claimed FIXED
must carry an implementation-class task, and no item listed UNTOUCHED may carry one. Direction 2 is
the check that caught T-52 and T-56 being listed as untouched although lanes B2/C3 had fixed them.

Writes `register-partition-check.log` (human) + `register-partition-check.json` (machine, consumed by
build-result.py so the evidence record derives its numbers instead of repeating them).
Exit code 0 = reconciled, 1 = at least one disagreement.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
IMPL_KINDS = {"implementation", "repair"}


def section(todo: str, n: int) -> str:
    m = re.search(rf"^### 8\.{n}.*?$(.*?)(?=^### 8\.|\Z)", todo, re.M | re.S)
    return m.group(1) if m else ""


def main() -> int:
    todo = (ROOT / ".mpd/TODO.md").read_text(encoding="utf-8")
    team = json.loads((ROOT / ".mpd/team/friction-p1-wave/team.json").read_text(encoding="utf-8"))
    tasks = team.get("tasks") or next(v for v in team.values() if isinstance(v, list) and v and isinstance(v[0], dict) and "id" in v[0])

    coverage: dict[str, list[tuple[str, str, str]]] = {}
    for t in tasks:
        for item in t.get("coverageOf") or []:
            coverage.setdefault(item, []).append((t["id"], t.get("kind", "?"), t.get("status", "?")))

    fixed = re.findall(r"^\| (T-\d+)", section(todo, 2), re.M)
    already = re.findall(r"^- \*\*(T-\d+)", section(todo, 3), re.M)
    partial = re.findall(r"^- \*\*(T-\d+)", section(todo, 4), re.M)
    untouched = sorted(set(re.findall(r"(T-\d+)", section(todo, 5))))
    new_rows = re.findall(r"^- \*\*(T-\d+)", section(todo, 6), re.M)
    touch_new = re.findall(r"T-\d+", section(todo, 5))  # T-67 may sit in §8.5 as a deferred NEW row

    originals = [f"T-{n:02d}" for n in range(1, 61)]
    touched = sorted(set(fixed + already + partial))
    disp = {**{i: "FIXED" for i in fixed}, **{i: "ALREADY" for i in already},
            **{i: "PARTIAL" for i in partial},
            **{i: "UNTOUCHED" for i in untouched if i in originals}}

    problems = []
    for i in originals:
        if i not in disp:
            problems.append(f"{i}: no disposition in §8.2-§8.5")
    for name, ids in (("§8.2", fixed), ("§8.3", already), ("§8.4", partial)):
        dupes = {i for i in ids if ids.count(i) > 1}
        for d in sorted(dupes):
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

    # Direction 3: §8.1's PROSE numbers must equal the values derived from the sections. The first two drafts
    # of §8.1 drifted from its own lists (31/40 against a 34-row table, then 34/42 against 36), so the prose is
    # now checked mechanically instead of trusted.
    prose_patterns = {
        "fixed": (r"FIXED this wave.*?:\s*(\d+)\*\*", n_fixed),
        "touched": (r"Touched by this wave:\s*\*\*(\d+)\*\*", n_fixed + n_already + n_partial),
        "untouched": (r"Untouched:\s*\*\*(\d+)\*\*", n_un),
        "new rows": (r"New rows discovered and appended:\s*\*\*(\d+)\*\*", len(new_rows)),
    }
    prose_seen = {}
    for label, (pattern, derived) in prose_patterns.items():
        m = re.search(pattern, todo, re.S)
        prose_seen[label] = int(m.group(1)) if m else None
        if not m:
            problems.append(f"§8.1 prose: the '{label}' number is not found")
        elif int(m.group(1)) != derived:
            problems.append(f"§8.1 prose says {label}={m.group(1)} but the sections give {derived}")

    lines = [
        f"=== register partition re-check (three directions) — .mpd/TODO.md sha256 "
        f"{__import__('hashlib').sha256((ROOT / '.mpd/TODO.md').read_bytes()).hexdigest()[:16]} ===",
        f"§8.2 FIXED rows            = {n_fixed}",
        f"§8.3 ALREADY-FIXED rows    = {n_already}  -> {' '.join(sorted(set(already)))}",
        f"§8.4 PARTIAL rows          = {n_partial}  -> {' '.join(sorted(set(partial)))}",
        f"touched (union, originals) = {n_fixed + n_already + n_partial}",
        f"§8.5 untouched originals   = {n_un}",
        f"§8.5 also lists            = {' '.join(sorted(set(untouched) - set(originals))) or '(nothing non-original)'}",
        f"ARITHMETIC                 = {n_fixed} + {n_already} + {n_partial} + {n_un} = {total} (must be 60)",
        f"§8.6 new rows              = {len(new_rows)}; ids: {' '.join(new_rows)}",
        f"DIRECTION 1 (internal)     = {'CLEAN' if not problems else 'DISAGREEMENT'}",
        f"DIRECTION 2 (coverage list from team.json) = {'CLEAN' if not problems else 'DISAGREEMENT'}"
        " — every FIXED item carries an implementation task, no UNTOUCHED item does",
        f"DIRECTION 3 (§8.1 prose vs the sections) = {prose_seen}",
        f"DISAGREEMENTS              = {len(problems)}" + ("" if not problems else "\n  - " + "\n  - ".join(problems)),
    ]
    log = "\n".join(lines) + "\n"
    (HERE / "register-partition-check.log").write_text(log, encoding="utf-8")
    (HERE / "register-partition-check.json").write_text(
        json.dumps(
            {
                "todo_sha256_prefix": __import__("hashlib").sha256((ROOT / ".mpd/TODO.md").read_bytes()).hexdigest()[:16],
                "fixed_section_rows": n_fixed,
                "already_fixed": n_already,
                "partial": n_partial,
                "touched_originals": n_fixed + n_already + n_partial,
                "untouched_originals_listed": n_un,
                "sum": total,
                "new_rows_appended": len(new_rows),
                "new_row_ids": new_rows,
                "section_5_non_original_ids": sorted(set(untouched) - set(originals)),
                "direction_1_internal": "clean" if not problems else "disagreement",
                "direction_2_coverage": "clean" if not problems else "disagreement",
                "direction_3_prose": prose_seen,
                "prose_matches_sections": all(prose_seen.get(k) == v for k, (_, v) in prose_patterns.items()),
                "disagreements": problems,
                "section_5_non_original_note": "a §8.6 new row carried in §8.5 as deferred after partial work" if set(untouched) - set(originals) else None,
                "fixed_ids": sorted(set(fixed)),
                "untouched_ids": sorted(i for i in untouched if i in originals),
                "coverage_chain_for_fixed": {i: sorted({t for t, _, _ in coverage.get(i, [])}) for i in sorted(set(fixed))},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(log, end="")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
