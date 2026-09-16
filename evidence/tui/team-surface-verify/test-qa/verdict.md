# bun run test:qa — the two verify commands of task t3

## command 1: node skills/dsh-qa/scripts/tui-team-surface.mjs
PASS -> evidence/tui/team-surface-verify/2026-09-16T14-16-27.925Z (exit 0). Log: 2026-09-16T14-16-27.925Z/output.log

## command 2: bun run test:qa
The sweep is BLOCKED at skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test by the STALE VENDOR_LOCK skills pin:
this task is the wave's single skills writer, so skills/** gained one file and the corpus treeSha moved; AGENTS.md §9/§11 require the re-pin in the SAME commit and the captain owns VENDOR_LOCK.json (out of this task's scope).

Measured now (verify-vendor's own algorithm, replicated and validated against the lock's OLD value 318/a8ba96b8108b):
  BEFORE this task: 318 files / a8ba96b8108b...  == VENDOR_LOCK.json's pinned value (reconstruction reproduced the pin exactly)
  AFTER  this task: 319 files / 303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d
  (recomputed after the LAST lane edit — the prerequisite gate moved ahead of all output; the earlier value 4f02b3981935… was measured one edit earlier and is REPLACED by this one)
  delta: +1 file (skills/dsh-qa/scripts/tui-team-surface.mjs), plus edits to skills/dsh-qa/SKILL.md and skills/dsh-qa/scripts/lib/tui-lane.mjs

Exact blocker output:
[agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=318/a8ba96b8108b tree=319/4f02b3981935 (re-pin in the same commit, AGENTS.md §9)

verify-vendor's own report:
[verify-vendor] FAIL - asset skills count drifted: 319 vs 318
[verify-vendor] FAIL - asset skills treeSha mismatch

## marker-grammar conformance (dsh-qa skill)
The real lane declares its prerequisites (`absent-dsh-binary` / `absent-runtime` / `absent-fixture`) and gates them BEFORE any output, so exactly one `[mpd-qa] SKIP|FAIL` line is the FIRST stdout line, a skipped case never prints PASS, and no evidence directory is created on a skip. Measured: `--sandbox-root /tmp/tts-skip-probe --profile-source /nonexistent` -> one SKIP line + exit 0, evidence dir count unchanged; the same command with `--no-skip` -> one FAIL line + exit 1.

## attempt 2 — BOTH verify commands green (the retry the re-pin unlocked)

VENDOR_LOCK.json re-pinned to skills `319 / 303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d`
— which equals the working tree recomputed with verify-vendor's own algorithm — and the lane bytes are unchanged
from the attempt-1 verdict run (`91a05314c38f263cc8c481174dfa3debd6b7e6914512dc94857c1064f792cf2f`).

1. `node skills/dsh-qa/scripts/tui-team-surface.mjs` -> exit 0
   `[tui-team-surface] PASS -> evidence/tui/team-surface-verify/2026-09-16T14-19-18.574Z`
   result.json: ok true, 13/13 arm-1 items, 7/7 arm-2 items, negativeControl {expected fail, observed fail,
   green true, reds empty:false/wrong-id:false/cancelled:false, discriminatingPower true},
   arm2.record {phase running, approvedAt 1789568377467, planReviewState deleted} = the REAL adopted runtime
   committed the approval from real tmux keystrokes; finding F1 (owner t2) still open by design.
2. `bun run test:qa` -> exit 0, `[test:qa] all self-tests passed`
   (logs committed in this directory: `attempt-2.log`; the earlier sweep-minus-the-lock-gate log is kept as the
   attempt-1 record and is no longer needed to explain the pin.)
