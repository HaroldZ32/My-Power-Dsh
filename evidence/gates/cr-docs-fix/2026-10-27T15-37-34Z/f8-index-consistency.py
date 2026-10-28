#!/usr/bin/env python3
"""f8-index-consistency.py — executable criterion for finding F8 (stale asset rows; bilingual parity).

What it asserts, against the REAL docs/index.md + docs/index.zh-CN.md:
  1. every asset row in the index names a file that exists;
  2. every RASTER row (`*.png`) is still referenced by its own README (the "Referenced from" claim);
  3. the two indexes carry the SAME set of asset basenames (a `zh-CN/` prefix is a path, not an asset);
  4. the two rows named by the finding (`tui-team-dag.png`, `web-team-board-v2.png`) are gone.
It prints both sides' asset rows, so the comparison is readable, not just a pass/fail bit.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TABLE_ROW = re.compile(r"^\| \[`([^`]+)`\]\(([^)]+)\)")
README_IMAGE = re.compile(r"\]\(\./docs/assets/images/([^)]+)\)")
STALE = {"tui-team-dag.png", "web-team-board-v2.png"}


def rows(index: Path, heading: str) -> list[tuple[str, str]]:
    """Return (asset name, target) for every row of the index page's image-asset table."""
    found = []
    in_section = False
    for line in index.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            in_section = line.strip() == heading
            continue
        if not in_section:
            continue
        match = TABLE_ROW.match(line)
        if match is not None:
            found.append((match.group(1), match.group(2)))
    return found


def readme_basenames(readme: Path) -> set[str]:
    """Return the basenames of every image the README embeds, using repo-root-relative paths."""
    text = readme.read_text(encoding="utf-8")
    return {Path(ref).name for ref in README_IMAGE.findall(text)}


def main() -> int:
    """Check existence, README reference, bilingual parity and stale-row removal; return an exit code."""
    pairs = [
        ("EN", ROOT / "docs/index.md", ROOT / "README.md", "## Image assets"),
        ("ZH", ROOT / "docs/index.zh-CN.md", ROOT / "README.zh-CN.md", "## 图片资源"),
    ]
    failures: list[str] = []
    per_side: dict[str, set[str]] = {}
    for side, index, readme, heading in pairs:
        table = rows(index, heading)
        per_side[side] = {Path(target).name for name, target in table if not name.endswith("/")}
        print(f"=== {side} asset rows ({index.relative_to(ROOT)}) ===")
        for name, target in table:
            exists = (index.parent / target).exists()
            print(f"  {name:<28} -> {target:<45} exists={str(exists).lower()}")
            if not exists:
                failures.append(f"{side}: {name} target does not exist: {target}")
        referenced = readme_basenames(readme)
        for name, target in table:
            asset = Path(target).name
            if asset.endswith(".png") and asset not in referenced:
                failures.append(f"{side}: {name} is NOT referenced by {readme.name} (stale row)")
        print()
    print(f"EN basenames: {sorted(per_side['EN'])}")
    print(f"ZH basenames: {sorted(per_side['ZH'])}")
    only_en = per_side["EN"] - per_side["ZH"]
    only_zh = per_side["ZH"] - per_side["EN"]
    print(f"only in EN: {sorted(only_en)}; only in ZH: {sorted(only_zh)}")
    if only_en or only_zh:
        failures.append(f"bilingual asset sets differ: only-EN={sorted(only_en)} only-ZH={sorted(only_zh)}")
    for stale in sorted(STALE):
        present = [side for side in per_side if stale in per_side[side]]
        print(f"stale row {stale}: {'present in ' + ','.join(present) if present else 'absent from both indexes'}")
        if present:
            failures.append(f"stale row still present: {stale} in {present}")
    print()
    if failures:
        for failure in failures:
            print(f"  !! {failure}")
        print("F8 FAIL")
        return 1
    print("F8 PASS — rows exist, raster rows are README-referenced, EN/ZH sets match, stale rows gone")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
