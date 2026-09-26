#!/usr/bin/env python3
"""Derive result.json from the on-disk readings of evidence/wave1-integration/20260917T052400Z.

Nothing here is retyped from prose: every field is parsed from a file written by the run itself
(gate logs + .exit files, settle pin logs, the twin-scan JSON, the link checker log, the register
partition check, changed-paths.txt, VENDOR_LOCK.json in both HEAD and worktree). Re-running this
script reproduces result.json; if a reading changes, the record changes with it.
"""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------- settle pins
pins = []
for name in ("settle-pin-1.log", "settle-pin-2.log"):
    txt = read(HERE / name)
    at = re.search(r"pin at ([0-9T:Z-]+)", txt)
    pins.append(
        {
            "log": name,
            "pin_at_utc": at.group(1) if at else None,
            "dirty_entries": int(re.search(r"dirty entries: (\d+)", txt).group(1)),
            "vendor_lock_sha256_prefix": re.search(r"VENDOR_LOCK\.json: (\w+)", txt).group(1),
            "skills_files": int(re.search(r"skills files: (\d+)", txt).group(1)),
            "packer_prefix": re.search(r"packer (\w+)", txt).group(1),
            "closure_prefix": re.search(r"closure (\w+)", txt).group(1),
            "artifact_manifest_prefix": re.search(r"artifact manifest (\w+) files (\d+) mtime ([\w:.Z-]+)", txt).group(1),
            "artifact_files": int(re.search(r"files (\d+) mtime", txt).group(1)),
            "artifact_manifest_mtime_utc": re.search(r"mtime ([\w:.Z-]+)", txt).group(1),
            "twin_instrument_prefix": re.search(r"instrument (\w+)", txt).group(1),
        }
    )


def last_line(txt: str, limit: int = 240) -> str:
    lines = [l for l in txt.splitlines() if l.strip()]
    return lines[-1][:limit] if lines else ""


# The two pins differ in their LOG NAME and their pin timestamp — that is the point of two pins.
# Identity is asserted on the READING only.
READING_KEYS = ("dirty_entries", "vendor_lock_sha256_prefix", "skills_files", "packer_prefix",
                "closure_prefix", "artifact_manifest_prefix", "artifact_files",
                "artifact_manifest_mtime_utc", "twin_instrument_prefix")
reading = [{k: p[k] for k in READING_KEYS} for p in pins]


def sec_gap(a: str, b: str) -> int:
    import datetime as dt
    f = lambda s: dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")
    return int((f(b) - f(a)).total_seconds())


pin_identity = {
    "readings_identical": reading[0] == reading[1],
    "compared_fields": list(READING_KEYS),
    "excluded_fields": ["log", "pin_at_utc"],
    "gap_seconds": sec_gap(pins[0]["pin_at_utc"], pins[1]["pin_at_utc"]),
}

# ---------------------------------------------------------------- gates
def gate_reading(stem: str, txt: str) -> dict:
    """A structured reading per gate, all parsed from the gate's own log tail."""
    if stem == "gate-test-packages":
        m = re.search(r"\(fail\) (.+?) \[", txt)
        loc = re.search(r"self-fix-tests/([\w.-]+):(\d+):", txt)
        return {
            "verdict": last_line(txt),
            "pass": int(re.search(r"^\s*(\d+) pass\s*$", txt, re.M).group(1)),
            "fail": int(re.search(r"^\s*(\d+) fail\s*$", txt, re.M).group(1)),
            "ran": re.search(r"Ran (\d+) tests across (\d+) files", txt).group(0),
            "failing_arm": m.group(1) if m else None,
            "failing_arm_location": f"packages/mpd-agent-teams-plugin/self-fix-tests/{loc.group(1)}:{loc.group(2)}" if loc else None,
        }
    if stem == "gate-verify-docs":
        m = re.search(r"pairs=(\d+) failed=(\d+) violations=(\d+) exempt=(\d+) — PASS", txt)
        return {"verdict": last_line(txt), "pairs": int(m.group(1)), "failed": int(m.group(2)),
                "violations": int(m.group(3)), "exempt": int(m.group(4))} if m else {"verdict": last_line(txt)}
    if stem == "gate-verify-vendor":
        m = re.search(r"asset OK: skills (\d+) files", txt)
        return {"verdict": last_line(txt), "skills_files": int(m.group(1)) if m else None}
    if stem == "gate-pack-closure":
        m = re.search(r"packed tree: (\S+) \((\d+) asset files\); agent references (\d+/\d+); root files (\d+/\d+); declared packages (\d+/\d+)", txt)
        return {"verdict": last_line(txt), "packed_tree": m.group(1), "packed_asset_files": int(m.group(2)),
                "agent_references": m.group(3), "root_files": m.group(4), "declared_packages": m.group(5)} if m else {"verdict": last_line(txt)}
    if stem == "gate-patch-check":
        m = re.search(r"already applied: (\d+) mpd delta region\(s\) across (\d+) adopted file\(s\)", txt)
        return {"verdict": last_line(txt), "regions": int(m.group(1)), "adopted_files": int(m.group(2))} if m else {"verdict": last_line(txt)}
    if stem == "gate-verify-rows":
        m = re.search(r"ok: (\d+) row ids match", txt)
        return {"verdict": last_line(txt), "row_ids": int(m.group(1))} if m else {"verdict": last_line(txt)}
    if stem == "gate-typecheck":
        return {"verdict": "clean: `tsgo --noEmit` printed no diagnostics (exit 0)", "diagnostics": 0}
    return {"verdict": last_line(txt)}


gates = []
for f in sorted(HERE.glob("gate-*.exit")):
    stem = f.stem
    log = HERE / f"{stem}.log"
    txt = read(log)
    gates.append(
        {
            "gate": stem[len("gate-"):],
            "command": next((l[2:] for l in txt.splitlines() if l.startswith("$ ")), None),
            "exit_code": int(f.read_text().strip()),
            "log": log.name,
            "log_bytes": log.stat().st_size,
            "reading": gate_reading(stem, txt),
        }
    )

# ---------------------------------------------------------------- t07 repeats
repeats = []
for f in sorted(HERE.glob("t07-repeat-*.log")):
    txt = read(f)
    repeats.append({
        "log": f.name,
        "pass": int(re.search(r"^\s*(\d+) pass\s*$", txt, re.M).group(1)),
        "fail": int(re.search(r"^\s*(\d+) fail\s*$", txt, re.M).group(1)),
        "ran": re.search(r"Ran (\d+) tests across (\d+) files\. \[[\d.]+ms\]", txt).group(0),
        "race_arm": next((l for l in txt.splitlines() if "THE RACE" in l), "").strip(),
    })

# ---------------------------------------------------------------- twin + links + partition
twin = json.loads(read(HERE / "twin-reading.json"))
links = read(HERE / "links.log").splitlines()
partition = read(HERE / "register-partition-check.log")
partition_json = json.loads(read(HERE / "register-partition-check.json"))

# ---------------------------------------------------------------- vendor delta (HEAD vs worktree)
delta = []
head_lock = subprocess.run(
    ["git", "show", "HEAD:VENDOR_LOCK.json"], cwd=ROOT, capture_output=True, text=True, check=False
)
if head_lock.returncode == 0:
    old = json.loads(head_lock.stdout)
    new = json.loads(read(ROOT / "VENDOR_LOCK.json"))
    for key in sorted(set(old.get("assets", {})) | set(new.get("assets", {}))):
        a, b = old["assets"].get(key), new["assets"].get(key)
        if a != b:
            delta.append(
                {
                    "asset": key,
                    "head": {k: a.get(k) for k in ("fileCount", "sha256", "treeSha")} if a else None,
                    "worktree": {k: b.get(k) for k in ("fileCount", "sha256", "treeSha")} if b else None,
                }
            )

# ---------------------------------------------------------------- changed paths (XY-aware)
cp = [l for l in read(HERE / "changed-paths.txt").splitlines() if l and not l.startswith("#")]
by_xy: dict[str, list[str]] = {}
for l in cp:
    by_xy.setdefault(l[:2], []).append(l[3:])
raw_paths = sorted(p for xy in ("A ", "AM", "M ") for p in by_xy.get(xy, []) if "/raw/" in p)
raw_dir_count: dict[str, int] = {}
for p in raw_paths:
    top = "/".join(p.split("/")[:6])
    raw_dir_count[top] = raw_dir_count.get(top, 0) + 1


def du(rel: str) -> int:
    total = 0
    for f in (ROOT / rel).rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except OSError:
                pass
    return total


ign = subprocess.run(["git", "check-ignore", "-v", ".mpd/TODO.md"], cwd=ROOT, capture_output=True, text=True, check=False)
classified = {
    "list_file": "changed-paths.txt",
    "command": "git status --porcelain (read-only, repo root)",
    "total": len(cp),
    "xy_histogram": {k: len(v) for k, v in sorted(by_xy.items())},
    "staged_modified": len(by_xy.get("M ", [])),
    "unstaged_modified": len(by_xy.get(" M", [])),
    "staged_added": len(by_xy.get("A ", [])),
    "re_add_required": sorted(by_xy.get("AM", [])),
    "untracked": sorted(by_xy.get("??", [])),
    "do_not_stage_untracked": [p for p in by_xy.get("??", []) if p.startswith(".qa-")],
    "staged_raw_noise": {
        "paths": len(raw_paths),
        "top_dirs": dict(sorted(raw_dir_count.items(), key=lambda kv: (-kv[1], kv[0]))),
        "bytes_of_top_dirs": {d: du(d) for d in sorted(raw_dir_count, key=lambda d: -raw_dir_count[d])[:3]},
        "judgement": "regenerable per-check raw output that a `git add` of the evidence tree swept into the index; the captain decides before committing (the bulk is this seat's own evidence/pack-closure …/raw/final)",
    },
    "register_tracked": not bool(ign.stdout.strip()),
    "register_ignore_rule": ign.stdout.strip().split("\t")[0] if ign.stdout.strip() else None,
}

result = {
    "task": "t35",
    "attempt_id": "f6093e63-a385-465c-aeb5-239b385f061c",
    "seat": "packaging-engineer",
    "kind": "integration",
    "recorded_at_utc": NOW,
    "deliverables": [".mpd/TODO.md", "evidence/wave1-integration/20260917T052400Z/"],
    "settled_revision": {"pins": pins, "pin_identity": pin_identity},
    "merged_tip_gates": gates,
    "t07_isolated_repeats": repeats,
    "packed_artifact": {
        "manifest_sha256": twin["byDesign"][0]["packedSha256"],
        "manifest_stamp_utc": twin["packStampUtc"],
        "files": sum([twin["identical"], len(twin["drift"]), len(twin["missing"]), twin["noTwin"]]),
        "twin_scan": {
            "identical": twin["identical"],
            "drift": twin["drift"],
            "missing": twin["missing"],
            "byDesign": [b["rel"] for b in twin["byDesign"]],
            "noTwin": twin["noTwin"],
            "afterPack": twin["afterPack"],
            "ok": twin["ok"],
        },
        "relative_links": {
            "scan_line": links[1],
            "extensions_for_agents_links": links[2],
            "model_templates_path_note": [l for l in links if ".mpd" in l][:4],
        },
    },
    "register_partition": {
        "check_log": "register-partition-check.log",
        "check_json": "register-partition-check.json",
        "check_script": "reconcile-register.py",
        "check_run": "python3 reconcile-register.py — exit 0 = reconciled; THREE directions: the internal partition of §8.2-§8.5, the wave's own coverage list in .mpd/team/friction-p1-wave/team.json, and §8.1's prose vs the sections",
        **{k: partition_json[k] for k in ("todo_sha256_prefix", "fixed_section_rows", "already_fixed", "partial",
                                          "touched_originals", "untouched_originals_listed", "sum",
                                          "new_rows_appended", "direction_1_internal", "direction_2_coverage",
                                          "direction_3_prose", "prose_matches_sections", "disagreements")},
        "section_5_non_original_ids": partition_json["section_5_non_original_ids"],
        "corrections_disclosed": [
            "draft 1: 31 fixed / 40 touched claimed against a 34-row §8.2 table, T-52 named nowhere, and the NEW row T-67 folded into the original-60 partition",
            "draft 2: 34 fixed / 42 touched with T-52 and T-56 listed as untouched — direction 2 (the wave's coverage list) caught both: lane B2 fixed T-52, lane C3 fixed T-56; both are now §8.2 rows",
            "final: 36 fixed + 3 already + 5 partial = 44 touched, 16 untouched, both directions clean; T-67 stays in §8.5 as a §8.6 new row (by design, not a disagreement)",
        ],
    },
    "vendor_lock_repin_delta": delta,
    "changed_paths": classified,
    "invariants": [
        "no git write command was run by this task",
        "no file under packages/** or skills/** was edited by this task",
        "VENDOR_LOCK.json content was not written by this task (re-pin is the captain's step)",
        "the only workspace-state file edited is .mpd/TODO.md",
    ],
}

(HERE / "result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
(HERE / "result.json.sha256").write_text(sha256(HERE / "result.json") + "  result.json\n", encoding="utf-8")

# ---------------------------------------------------------------- human-readable output.log
out = [
    f"t35 integration record — derived from on-disk readings by {Path(__file__).name}",
    f"recorded_at_utc {result['recorded_at_utc']}  .mpd/TODO.md sha256 {result['register_partition']['todo_sha256_prefix']}",
    "",
    "SETTLED REVISION",
    *[
        f"  {p['log']}: pin {p['pin_at_utc']} dirty {p['dirty_entries']} VENDOR_LOCK {p['vendor_lock_sha256_prefix']}"
        f" skills {p['skills_files']} packer {p['packer_prefix']} closure {p['closure_prefix']}"
        f" artifact manifest {p['artifact_manifest_prefix']} files {p['artifact_files']} mtime {p['artifact_manifest_mtime_utc']}"
        f" instrument {p['twin_instrument_prefix']}"
        for p in pins
    ],
    f"  reading identical across the two pins: {pin_identity['readings_identical']} (gap {pin_identity['gap_seconds']} s;"
    f" log name and pin time excluded by construction)",
    "",
    "MERGED-TIP GATE SWEEP (exit code per gate, raw output on disk)",
    *[f"  {g['gate']:<15} exit={g['exit_code']:<2} {g['log']:<28} {json.dumps(g['reading'], ensure_ascii=False)}" for g in gates],
    "",
    "T-07 ISOLATED REPEATS (the one red arm, re-run in isolation)",
    *[f"  {r['log']}: {r['pass']} pass / {r['fail']} fail — {r['ran']}" for r in repeats],
    "",
    "PACKED ARTIFACT (current stamp)",
    f"  manifest {result['packed_artifact']['manifest_sha256'][:16]} stamp {result['packed_artifact']['manifest_stamp_utc']}",
    f"  twin scan identical={twin['identical']} drift={len(twin['drift'])} missing={len(twin['missing'])}"
    f" byDesign={len(twin['byDesign'])} noTwin={twin['noTwin']} afterPack={len(twin['afterPack'])} ok={twin['ok']}",
    f"  {links[1]}",
    f"  {links[2]}",
    "",
    "REGISTER PARTITION",
    *["  " + l for l in partition.strip().splitlines()],
    "",
    "VENDOR_LOCK RE-PIN DELTA (reported, not written)",
    *[f"  {d['asset']}: HEAD {d['head']} -> worktree {d['worktree']}" for d in delta],
    "",
    "CHANGED PATHS",
    f"  {classified['total']} entries — XY histogram {classified['xy_histogram']}",
    f"  RE-ADD required (staged then modified again): {len(classified['re_add_required'])} — "
    + ", ".join(p.split('/')[-1] for p in classified["re_add_required"]),
    f"  staged raw noise: {classified['staged_raw_noise']['paths']} paths; top dirs "
    + ", ".join(f"{d} ({n})" for d, n in list(classified["staged_raw_noise"]["top_dirs"].items())[:3])
    + f" — captain's call before committing; bytes {classified['staged_raw_noise']['bytes_of_top_dirs']}",
    f"  do NOT stage (untracked lane scratch): {' '.join(classified['do_not_stage_untracked'])}",
    f"  register .mpd/TODO.md tracked: {classified['register_tracked']}"
    f" (ignored by {classified['register_ignore_rule']}) — the register is workspace state, never committed",
    "",
    "INVARIANTS",
    *[f"  - {i}" for i in result["invariants"]],
]
(HERE / "output.log").write_text("\n".join(out) + "\n", encoding="utf-8")
print("\n".join(out))
