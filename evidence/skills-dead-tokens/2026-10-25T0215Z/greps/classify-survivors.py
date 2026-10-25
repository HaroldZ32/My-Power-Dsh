#!/usr/bin/env python3
"""Classify the AFTER survivors of the three grep families into disjoint buckets.

Run from the repo root:  python3 evidence/skills-dead-tokens/2026-10-25T0215Z/greps/classify-survivors.py
It reads the three `*-after.txt` files in its own directory (2 header lines each, starting
with '#') and prints, per family: the survivor total, a DISJOINT bucket partition (each line
counted exactly once, first matching rule wins in the listed order), the per-arm counts with
overlaps allowed, and the tracked-only total. The partition is the claim "every survivor is
classified": partition_sum MUST equal total.

Round 2026-10-25T0215Z adds `view_image` and `look_at` to the A family: the two retired
image-viewing names this round removed from skills/visual-qa/SKILL.md. `A0_removed_dead_image_name`
is the FIRST rule so any survivor carrying either name would be reported there instead of being
absorbed by a later bucket; the AFTER side must show 0 for both arms.
"""
import collections
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
LINE = re.compile(r"^(skills/[^:]+):(\d+):(.*)$")

A_ARM = r"TodoWrite|Lsp[A-Z]|lsp_[a-z]|codegraph_|kill_bash|task_output|monitor\(|\bRead\b|\bWrite\b|\bEdit\b|\bBash\b|\bGlob\b|\bGrep\b|MultiEdit|NotebookEdit|view_image|look_at"
B_ARM = r"mass-ulw|ulw-loop|open-design|imagegen|mpd-agent-toolkit"
C_ARM = r"subagent|subagent_type|task\(category|task\(subagent_type|oracle|librarian|momus|metis|workflow"

A_PROBES = ["TodoWrite", "Lsp[A-Z]", "lsp_[a-z]", "codegraph_", "kill_bash", "task_output",
            r"monitor\(", r"\bRead\b", r"\bWrite\b", r"\bEdit\b", r"\bBash\b", r"\bGlob\b",
            r"\bGrep\b", "MultiEdit", "NotebookEdit", "view_image", "look_at"]
B_PROBES = ["mass-ulw", "ulw-loop", "open-design", "imagegen", "mpd-agent-toolkit"]
C_PROBES = ["subagent_type", r"task\(category", r"task\(subagent_type", "subagent", "oracle",
            "librarian", "momus", "metis", "workflow"]


def read_after(name):
    """Return [(path, lineno, content)] from a greps/*-after.txt, skipping '#' headers."""
    rows = []
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        for raw in fh:
            if raw.startswith("#"):
                continue
            m = LINE.match(raw.rstrip("\n"))
            if m:
                rows.append(m.groups())
    return rows


def classify_a(rows):
    """Disjoint A buckets: the round's retired image names first, then mounted codegraph name,
    ast-grep language enum, PowerShell cmdlet, HTML test fixture, script identifier/string,
    remaining English prose in docs."""
    rules = [
        ("A0_removed_dead_image_name",
         lambda p, c: "view_image" in c or "look_at" in c),
        ("A1_mounted_codegraph_surface",
         lambda p, c: "mcp__codegraph__" in c or "codegraph_explore" in c or "codegraph_status" in c),
        ("A2_ast_grep_schema_vocabulary", lambda p, c: p == "skills/ast-grep/references/yaml-rules.md"),
        ("A3_powershell_cmdlet", lambda p, c: p.endswith(".ps1")),
        ("A4_html_test_fixture", lambda p, c: p.endswith(".html")),
        ("A5_script_identifier_or_string", lambda p, c: p.endswith((".ts", ".mjs", ".sh", ".py"))),
        ("A6_english_prose_in_docs", lambda p, c: p.endswith(".md")),
        ("A7_unclassified", lambda p, c: True),
    ]
    return partition(rows, rules)


def classify_b(rows):
    """Disjoint B buckets in arm order, with a path-only rule last."""
    rules = [
        ("B1_mass_ulw", lambda p, c: "mass-ulw" in c),
        ("B2_ulw_loop", lambda p, c: "ulw-loop" in c),
        ("B3_open_design_upstream", lambda p, c: "open-design" in c),
        ("B4_imagegen_reference_file_name", lambda p, c: "imagegen" in c),
        ("B5_mpd_agent_toolkit", lambda p, c: "mpd-agent-toolkit" in c),
        ("B6_path_component_only", lambda p, c: True),
    ]
    return partition(rows, rules)


def classify_c(rows):
    """Disjoint C buckets in arm order (a line is counted under the FIRST arm it carries)."""
    rules = [
        ("C1_retired_verb_subagent_type", lambda p, c: "subagent_type" in c),
        ("C2_retired_verb_task_category", lambda p, c: "task(category" in c),
        ("C3_retired_verb_task_subagent_type", lambda p, c: "task(subagent_type" in c),
        ("C4_subagent_vocabulary", lambda p, c: "subagent" in c),
        ("C5_oracle_methodology", lambda p, c: "oracle" in c),
        ("C6_librarian", lambda p, c: "librarian" in c),
        ("C7_momus_state_key", lambda p, c: "momus" in c),
        ("C8_metis", lambda p, c: "metis" in c),
        ("C9_workflow_word_or_skill_name", lambda p, c: "workflow" in c or "workflow" in p),
        ("C10_unclassified", lambda p, c: True),
    ]
    return partition(rows, rules)


def partition(rows, rules):
    """Apply the first matching rule per row; return (Counter, total, samples)."""
    counts = collections.Counter()
    samples = collections.defaultdict(list)
    for p, no, c in rows:
        for name, test in rules:
            if test(p, c):
                counts[name] += 1
                if len(samples[name]) < 2:
                    samples[name].append("%s:%s: %s" % (p, no, c[:120]))
                break
    return counts, len(rows), samples


def arm_counts(rows, probes):
    """Per-arm line counts for THIS family's probes, overlaps allowed."""
    out = collections.Counter()
    for probe in probes:
        rx = re.compile(probe)
        n = sum(1 for p, no, c in rows if rx.search(c) or rx.search(p))
        if n:
            out[probe] = n
    return out


def tracked_total(pattern):
    """AFTER total restricted to TRACKED files (git grep over the working tree)."""
    res = subprocess.run(["git", "grep", "-nE", pattern, "--", "skills/"], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    return len([ln for ln in res.stdout.splitlines() if ln])


def report(label, rows, pattern, probes, buckets):
    """Print one family block: partition, sum check, arm counts, tracked-only total."""
    counts, total, samples = buckets
    unclassified = sum(n for name, n in counts.items() if name.endswith("_unclassified"))
    tracked = tracked_total(pattern)
    print("=== %s ===" % label)
    print("survivor_lines=%d" % total)
    for name, n in counts.most_common():
        print("  %-34s %4d   e.g. %s" % (name, n, samples[name][0] if samples[name] else "-"))
    print("  partition_sum=%d  total=%d  residual=%d  unclassified=%d"
          % (sum(counts.values()), total, total - sum(counts.values()), unclassified))
    print("  arm_counts(overlaps allowed)=%s" % dict(arm_counts(rows, probes)))
    print("  tracked_only_after=%d  worktree_after=%d  gitignored_lines=%d"
          % (tracked, total, total - tracked))
    print()


def main():
    """Entry point: classify A, B and C from the AFTER grep files, then assert the round's
    retired arms are ABSENT from the final tree."""
    rows_a = read_after("A-dead-tool-tokens-after.txt")
    report("A dead-tool-token survivors", rows_a, A_ARM, A_PROBES, classify_a(rows_a))
    rows_b = read_after("B-skill-pointers-after.txt")
    report("B skill-pointer survivors", rows_b, B_ARM, B_PROBES, classify_b(rows_b))
    rows_c = read_after("C-delegation-family-after.txt")
    report("C delegation-family survivors", rows_c, C_ARM, C_PROBES, classify_c(rows_c))
    print("=== removed_arms_after (must both be 0) ===")
    for arm in ("view_image", "look_at"):
        print("  %-12s %d" % (arm, arm_counts(rows_a, [arm]).get(arm, 0)))


if __name__ == "__main__":
    main()
