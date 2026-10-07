#!/usr/bin/env python3
"""Preservation audit for the 2026-10-06 AGENTS.md split.

Reads the PRE-SPLIT manual (`AGENTS.md.before`), re-extracts each moved block by its recorded line
range, and asserts the block is present VERBATIM in its destination reference file. Emits JSON (and a
non-zero exit on any failure) so "no text was deleted" is a measurement, not a claim.

Usage: python3 preservation-audit.py   (run from the repository root)
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path("/home/haroldzhao/MyProj/DshProj/My-Power-Dsh")
EVID = ROOT / "evidence/gates/agents-budget/20261006T085805Z"
BEFORE = EVID / "AGENTS.md.before"

# (destination, section, start, end) — the ranges the restructure script used, 1-based inclusive.
MOVES = [
    ("agent-references/overview-and-provenance.md", "§1", 61, 161),
    ("agent-references/verification-flow.md", "§4", 246, 289),
    ("agent-references/plugin-authoring.md", "§6", 337, 491),
    ("agent-references/qa-discipline.md", "§7", 494, 565),
    ("agent-references/installer-and-profiles.md", "§8", 568, 640),
    ("agent-references/glossary.md", "§13", 729, 798),
]


def sha256(text: str) -> str:
    """Hex sha256 of one UTF-8 string, so a moved block can be compared across files."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def census(manual: str) -> list[dict[str, object]]:
    """Per-`## N.`-heading byte size of one manual, so a section-by-section delta is measurable."""
    lines = manual.splitlines(keepends=True)
    heads = [i for i, l in enumerate(lines) if re.match(r"^## ", l)]
    out: list[dict[str, object]] = []
    for n, i in enumerate(heads):
        end = heads[n + 1] if n + 1 < len(heads) else len(lines)
        body = "".join(lines[i:end]).encode("utf-8")
        out.append({"heading": lines[i].rstrip("\n"), "bytes": len(body)})
    return out


def main() -> int:
    """Verify every moved block is verbatim in its destination and print the audit as JSON."""
    before = BEFORE.read_text(encoding="utf-8")
    lines = before.splitlines(keepends=True)
    after = (ROOT / "AGENTS.md").read_text(encoding="utf-8")

    moves: list[dict[str, object]] = []
    ok = True
    for dest_rel, section, start, end in MOVES:
        block = "".join(lines[start - 1:end])
        dest_text = (ROOT / dest_rel).read_text(encoding="utf-8")
        present = block in dest_text
        ok = ok and present
        moves.append({
            "section": section,
            "source_lines": f"{start}-{end}",
            "moved_bytes": len(block.encode("utf-8")),
            "moved_lines": block.count("\n"),
            "sha256": sha256(block),
            "destination": dest_rel,
            "verbatim_in_destination": present,
        })

    # Hand-carried derived values the docs gate reads as SITES (T-75): both must still carry A1–D42.
    sites = {rel: sorted(set(re.findall(r"A1–D\d+", (ROOT / rel).read_text(encoding="utf-8"))))
             for rel in ("AGENTS.md", "agent-references/index.md")}

    out = {
        "manual_before_bytes": len(before.encode("utf-8")),
        "manual_after_bytes": len(after.encode("utf-8")),
        "delta_bytes": len(after.encode("utf-8")) - len(before.encode("utf-8")),
        "headings_before": census(before),
        "headings_after": census(after),
        "moved": moves,
        "moved_total_bytes": sum(int(m["moved_bytes"]) for m in moves),
        "derived_value_sites": sites,
        "verdict": "PASS" if ok else "FAIL",
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
