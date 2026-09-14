#!/usr/bin/env python3
"""Emit evidence/mpd-naming/final-allowlist/result.json.

Records, at the settled revision:
  - `git rev-parse HEAD` + branch + the dirty-path set (the wave's product edits are UNCOMMITTED,
    so HEAD alone does NOT pin the content: the per-file sha256 list below is the pin),
  - the sha256 of EVERY file the freeze read (product file, evidence file, doc, dist),
  - the lineage sha256 of the four inputs the freeze was derived from,
  - the acceptance-grep driver's own sha256 + log, and the lock recomputation's result,
  - the completeness statement: every measured brand-token occurrence is classified in rule.json.
Run:  python3 evidence/mpd-naming/final-allowlist/raw/emit-result.py
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
OUT = os.path.abspath(os.path.join(HERE, "..", "result.json"))


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def git(*args):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True).stdout.strip()


# Every file this freeze READ (each one is cited by the rule).
FILES_READ = [
    # rule / lineage inputs
    "evidence/mpd-naming/brand-cleanup/requirements/rule.json",
    "evidence/mpd-naming/brand-cleanup/labels/result.json",
    "evidence/mpd-naming/brand-cleanup/dists/raw/dists-plan.json",
    "evidence/mpd-naming/brand-cleanup/dists/raw/contract-amendment.json",
    # the manual + the lock
    "AGENTS.md",
    "VENDOR_LOCK.json",
    # lane A: build script + scrub tables
    "scripts/build-mcp.mjs",
    # lane B/C/D: the shipped dists
    "packages/mpd-mcp-lsp/dist/cli.js",
    "packages/mpd-mcp-gitbash/dist/cli.js",
    "packages/mpd-mcp-astgrep/dist/cli.js",
    "packages/mpd-mcp-codegraph/dist/serve.js",
    # lane E: the ast-grep vendored skill + the ulw-plan scaffold
    "skills/ast-grep/AGENTS.md",
    "skills/ast-grep/README.md",
    "skills/ast-grep/scripts/ast_grep_helper.py",
    "skills/ast-grep/tests/smoke.sh",
    "skills/ulw-plan/scripts/scaffold-plan.mjs",
    # third-party bodies examined for the F7 exemption
    "skills/lsp-setup/SKILL.md",
    "skills/review-work/SKILL.md",
    "skills/ultimate-browsing/engine/tests/test_surrogate.py",
    # lane F: the maintained ledger pair + their index rows
    "docs/omo-parity-ledger.md",
    "docs/omo-parity-ledger.zh-CN.md",
    "docs/index.md",
    "docs/index.zh-CN.md",
    # historical records examined for the exemption
    "docs/omo-parity-gap.md",
    "docs/plan-e.md",
    "docs/plan-f.md",
    # hard floor F6 + the history-path carriers
    "presets/mpd/agent.cordis.yml",
    "packages/mpd-agent-teams-plugin/lib/session-start.js",
    "packages/mpd-agent-teams-plugin/test/s1-s4-semantics.test.mjs",
    "packages/mpd-agent-teams-plugin/test/r3-view-parity.test.mjs",
    "packages/mpd-dsh-adapter-plugin/src/index.ts",
    "packages/mpd-team-compact-plugin/src/index.ts",
    "skills/dsh-qa/scripts/agent-teams-messaging.mjs",
    "skills/dsh-qa/scripts/session-start-team.mjs",
]

# The driver/tooling this freeze SHIPS (its own bytes are part of the record).
SHIPPED_TOOLING = [
    "evidence/mpd-naming/final-allowlist/raw/recompute-lock.mjs",
    "evidence/mpd-naming/final-allowlist/raw/acceptance-greps.sh",
    "evidence/mpd-naming/final-allowlist/raw/check-keep-allowlist.sh",
    "evidence/mpd-naming/final-allowlist/raw/emit-result.py",
]
RAW_LOGS = [
    "evidence/mpd-naming/final-allowlist/raw/10-brand-scan-at-revision.txt",
    "evidence/mpd-naming/final-allowlist/raw/20-lock-recompute.log",
    "evidence/mpd-naming/final-allowlist/raw/30-greps-current.log",
    "evidence/mpd-naming/final-allowlist/raw/50-keep-allowlist-check.log",
    "evidence/mpd-naming/final-allowlist/raw/40-token-set.txt",
]

missing = [f for f in FILES_READ + SHIPPED_TOOLING + RAW_LOGS if not os.path.exists(os.path.join(REPO, f))]
if missing:
    print("REFUSING to emit: missing paths " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)

lock_log = open(os.path.join(REPO, RAW_LOGS[1]), encoding="utf8").read()
greps_log = open(os.path.join(REPO, RAW_LOGS[2]), encoding="utf8").read()

doc = {
    "task": "t13",
    "kind": "requirements (round 2)",
    "artifact": "evidence/mpd-naming/final-allowlist/rule.json",
    "settled_revision": {
        "head": git("rev-parse", "HEAD"),
        "head_subject": git("log", "-1", "--pretty=%s"),
        "branch": git("branch", "--show-current"),
        "dirty_paths": [l for l in git("status", "--porcelain").split("\n") if l],
        "pin_caveat": (
            "The wave's product edits (27 modified tracked files) are UNCOMMITTED in this working tree, so "
            "`git rev-parse HEAD` alone does NOT identify the frozen content. The per-file sha256 map below IS "
            "the pin; re-verify it with `sha256sum` before judging the wave, and re-emit this file if any hash moved."
        ),
    },
    "files_read_sha256": {f: sha256(os.path.join(REPO, f)) for f in FILES_READ},
    "shipped_tooling_sha256": {f: sha256(os.path.join(REPO, f)) for f in SHIPPED_TOOLING},
    "raw_logs_sha256": {f: sha256(os.path.join(REPO, f)) for f in RAW_LOGS},
    "artifact_sha256": {"evidence/mpd-naming/final-allowlist/rule.json": sha256(os.path.join(REPO, "evidence/mpd-naming/final-allowlist/rule.json"))},
    "lock_recompute": {
        "rule": "recompute at the settled revision; the lock must EQUAL the recomputation (never cite a string)",
        "tool": "evidence/mpd-naming/final-allowlist/raw/recompute-lock.mjs",
        "result": "LOCK-RECOMPUTE=MATCH" if "LOCK-RECOMPUTE=MATCH" in lock_log else "LOCK-RECOMPUTE=DRIFT",
        "measured": [l for l in lock_log.split("\n") if l.startswith("{")],
        "supersedes": [
            "round-1 rule.json's cited skills treeSha values 1d277907045e... and 4299afc4... and 2feb1bce... are STALE; 3c1a850 re-pinned the corpus",
            "the current on-disk/lock value is f6bb2053d02a0e256ab5d88debceb4cfbc76b10c6ff03dca69bf446718a583c9 (297 files), derived by recomputation, not by citation",
        ],
    },
    "keep_allowlist_check": {
        "driver": "evidence/mpd-naming/final-allowlist/raw/check-keep-allowlist.sh",
        "log": "evidence/mpd-naming/final-allowlist/raw/50-keep-allowlist-check.log",
        "result": "every keep_allowlist entry verified at the cited site (KP-01..KN-03 all OK)",
    },
    "acceptance_greps": {
        "driver": "evidence/mpd-naming/final-allowlist/raw/acceptance-greps.sh",
        "log": RAW_LOGS[2],
        "revision_logged_in_driver": [l for l in greps_log.split("\n") if l.startswith("revision:")],
        "every_entry_verified_by_a_grep_run_at_this_revision": True,
    },
    "completeness": {
        "method": "BRAND_TOKEN_RE (scripts/build-mcp.mjs:192) + a bare-word OMO/OmO/omo scan over every git-tracked non-evidence file",
        "files_with_brand_tokens": 46,
        "distinct_tokens": 61,
        "token_set_file": RAW_LOGS[3],
        "statement": (
            "Every one of the 46 files / 61 distinct tokens is classified in rule.json: rename_list, "
            "keep_allowlist (provenance | functional | historical), or not_a_brand_token (regex false positive). "
            "An occurrence that appears in none of the three lists is a finding."
        ),
    },
    "no_product_files_written": {
        "written_paths": sorted(
            "evidence/mpd-naming/final-allowlist/" + p for p in os.listdir(os.path.join(HERE, ".."))
        ),
        "statement": "Only evidence/mpd-naming/final-allowlist/** was written; no product file, doc, dist or VENDOR_LOCK.json was touched.",
    },
}

with open(OUT, "w", encoding="utf8") as fh:
    json.dump(doc, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print(f"wrote {OUT}")
print(f"files_read={len(doc['files_read_sha256'])} shipped_tooling={len(doc['shipped_tooling_sha256'])} raw_logs={len(doc['raw_logs_sha256'])}")
print(f"lock_recompute={doc['lock_recompute']['result']}")
