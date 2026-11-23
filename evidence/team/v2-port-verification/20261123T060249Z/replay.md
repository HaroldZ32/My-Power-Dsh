# Dev-based runtime port verification

**FAIL on the initial 36-file runtime port.** On DSH `0.2.2-rc.5`, `cellwork_start` reached the Team status tool before creating a planning board. The host rejected its result as `value is not lossless JSON`. The journal recorded `planning-team-partial` and each of the three runs ended with one captain session and zero execution rows. A separate clean `e86764c0` run produced the identical receipt. This blocks the mounted cold restart, persistent provider rejection and stale-owner measurements requested for this candidate.

The Team control verified that dev's invalid draft spawned three children. The port rejected it during preview and approval, leaving just the captain and zero team records. After correction, dispatch delivered one requirement, then two reviews, then one join. The graph contained all four edges. The premature claim was refused and the four completion receipts matched their declared owners. The additional controls exercised explicit independence, incremental review admission, the compatibility warning and a live two-parent append.

Ordinary Team approval armed a real GOAL in the Web host. Both the nonblocking arm and the no-condition control generated five captain requests over their respective 1.86 s and 1.83 s windows. Only the arm produced a host wake notice. The five pending in-turn waits recorded zero captain requests, zero new goal rounds and no host wake notice over 2.36–2.41 s windows. The task, mail, queued human input, next-step steering, ended-team and already-terminal cases all preserved the same active goal at revision 1. An additional `wait-already` run passed on `0.2.2-rc.2`. Other compatibility-host/scenario combinations were unmeasured.

The registered Cellwork barrier handler passed three controls using simulated compaction and activation. A stale planning pointer selected the execution board and retained the replacement at attempt 14. The single-board control agreed. Duplicate ownership refused transfer and fenced the seat. These controls exercise a different entry point from the failed mounted startup.

The runtime candidate passed static checks (11/11), typecheck, dist freshness (35/35 source-backed targets), manual paths, no-host-override and pack closure. The three-package suite had 1,562 passes and one failure on the pre-existing executor warning expectation. The unfiltered root and package suites reproduced dev's failure signatures. The archive-excluded active-root scan reported 4,255 passes, six skips and four failures including one loader error, versus 4,214 passes, six skips and the same four failures on dev. The six skips were the live team-record witness, two SVN cases and three optional comment-detector cases. The prebuilt CodeGraph server is outside the dist rebuild map. Static verification's official-Go and TUI bounds are described in the clean control packet.

## Reproduce

`product.sha256` identifies the 36 changed or added product files on base `e86764c0e09b14ba172839bc9671a2c8f3352c81`. The verifier copied those bytes to a fresh standalone checkout, checked the manifest before and after the runs, and installed local dependencies with the frozen lockfile. No mounted run referenced the shared checkout's runtime distribution. Use a fresh disposable checkout of the corresponding candidate and absolute paths to Node 24.21.0's bin directory (`NODE_BIN`), Bun `1.4.0+34cbb9a40` (`BUN14`), and the pinned host's bin directory (`DSH_BIN`). To replay the clean control, use the same toolchain in a standalone checkout of the base SHA.

```bash
export NODE_BIN BUN14 DSH_BIN
packet=$PWD/evidence/team/v2-port-verification/20261123T060249Z
export EXPECTED_MANIFEST=$packet/product.sha256
bash "$packet/replay.sh.txt" team
bash "$packet/replay.sh.txt" goal
bash "$packet/replay.sh.txt" cell
```

The wrapper also accepts a single case, for example `cell restart` or `goal wait-already`. Each family requires a fresh scratch directory. For the dev comparison, use an absolute `packet` from the candidate, leave `EXPECTED_MANIFEST` unset, and run `cell restart` from the base checkout. The full report for that arm is `.qa-v2-spawn/restart-result.json`. Use the pinned rc.2 host bin directory with `goal wait-already` in a separate clean checkout for the measured older-host case. For static and root-suite commands, use `evidence/baseline/verification-control/20261123T055406Z/replay.md` when present or the repository's `.github/workflows/gates.yml` for the pinned setup. The exact active-root command was `bun test --path-ignore-patterns 'evidence/**' --path-ignore-patterns 'dist/**'`. Run tests before generating host scratch files or packed output.

`host-fixtures.tar.gz` supplies the loopback host drivers, event producers and a frozen test-harness preamble. Its SHA-256 is `2b8497f96e4b091d3ed87df2ea068fab8c6e78dbeb3ef6c29f38375d4da20181`. The provider schedules synthetic actions. Assertions read actual tool receipts, session events, board ownership and graph edges. The isolated cases require no real credentials. The Team assertion retains the original six-case comparisons and writes the current case results. The archived wrapper was also exercised directly on the three barrier controls.

`result.json` retains the counts, timing, observed state, failure receipt IDs and compatibility bound. Shared-workspace `docs` and `comments` gate IDs `ev-20261123T055842-bbe5cb` and `ev-20261123T060137-90da11` accompany the frozen contract. The runtime verification record is `rec-20261123T060249-77a3ef`. The repair record is `rep-20261123T060249-f78541`.
