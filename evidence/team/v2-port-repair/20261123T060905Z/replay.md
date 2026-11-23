# Runtime repair verification

**PASS for the runtime contract on the repaired 37-file candidate.** The rc.5 host accepted `cellwork_start`, staged and approved the split, dispatched both workers, and recorded their claims on T3 and T4. Pristine dev and the initial port had both stopped before creating a board. The digest of the repaired `product.sha256` is `4d5f94f97d5d844bc14862fc672d8c702e947955cde1049dc45a7b19bb099c81`. The Team dist is `38e7234e75c278cf4fbe5126e6310ad22faa2f697750b4a178124cf27da86300`. The verifier checked the manifest again against the delivery worktree at 06:17:50 UTC.

| Condition | Observed outcome |
|---|---|
| Two workers ended their turns with open claims | Original sessions completed T3 and T4 at attempt 1 after targeted wake. |
| Cold restart | A second host resumed the original captain. Both original worker sessions recorded successful completion receipts at attempt 1. |
| Abrupt host loss | The fixture sent `SIGKILL` to its own first host immediately after both claims were durable. That process exited on `SIGKILL`. The second host exited 0 after both original owners completed attempt 1. |
| Provider restored after one HTTP 401 | Each worker recorded one authentication error, then its original session successfully completed its existing claim. |
| Provider continued returning HTTP 401 | Both sends were accepted. Each worker recorded two 401 turn errors, including the resumed turn. Both rows remained `in_progress` under their original owners. |
| Owner changed between proposal and send | T3's saved proposal was refused with its mailbox still at zero bytes, and the original T3 worker did not complete. The unchanged T4 suggestion was delivered and its original owner completed attempt 1. |
| Reseed board selection | Single-board and stale-planning-pointer controls selected the execution board and preserved attempt 14. Duplicate ownership was refused before launching a replacement. |

`result.json` retains the paired startup and activation call IDs, claim and completion receipts, host exit and per-worker states. All six mounted Cellwork cases used a loopback scripted provider. The three board-selection controls used the real registered handler and simulated compaction and activation.

The Team replay ran the dev-before control and five candidate cases. The repaired candidate rejected an invalid flat draft while only the captain existed and before creating a team record. The valid four-edge DAG dispatched one requirement, two reviews and one join, with four matched owner completions. Nonblocking GOAL arm and no-condition controls each produced six captain requests over 1.86–1.87 s. The arm produced one wake notice and the control produced zero. Each pending in-turn wait recorded zero captain requests and zero new goal rounds over 2.35–2.40 s. All six wait cases preserved the active goal at revision 1. The older rc.2 host passed the already-terminal Web wait. Other older-host cases were unmeasured.

Three initial concurrent attempts ended before producing a usable host session. The stale-owner attempt had zero session logs and the rc.5 ended-team and rc.2 already-terminal attempts timed out waiting for Web readiness. Each passed on a fresh serial run. The startup failures and retries are retained in `result.json`.

Static aggregate (11/11), typecheck, deterministic dist rebuild (35/35 source-backed targets), manual paths, no-host-override and pack closure passed. On this candidate the package suite had 4,220 passes, six skips and three failures. Default root had 4,438 passes, six skips and 23 failures, including 16 errors, while discovering 45 archived test files. The focused three-package command had 1,564 passes and one inherited executor warning assertion failure. Pristine dev and the original port had the same package/root failure signatures. The complete gate and comparison counts are in `result.json`. The verdict covers the repaired runtime scenarios and their scoped acceptance criteria.

## Replay

Start in a fresh Linux checkout of the repaired product with Node 24.21.0, Bun `1.4.0+34cbb9a40`, and DSH `0.2.2-rc.5`. The complete host drivers live in the earlier verification packet. Its wrapper stages a private HOME, DSH_HOME, temporary workspace, loopback model route, and frozen dependencies. Use the repaired manifest for this run.

```bash
set -euo pipefail
export NODE_BIN BUN14 DSH_BIN
packet=$PWD/evidence/team/v2-port-verification/20261123T060249Z
repair=$PWD/evidence/team/v2-port-repair/20261123T060905Z
export EXPECTED_MANIFEST=$repair/product.sha256
bash "$packet/replay.sh.txt" team
bash "$packet/replay.sh.txt" goal
bash "$packet/replay.sh.txt" cell
```

The following commands exercise the three additional arms using the same staged drivers. Copy the raw receipt immediately after each case, since the host driver emits a filename determined by its mode. The abrupt case modifies only its own QA driver and signals only the child it spawned.

```bash
stage=$PWD/.qa-v2-spawn
cp "$stage/drive.mjs" "$stage/abrupt.mjs"
patch "$stage/abrupt.mjs" < "$repair/abrupt-host.patch"
run_extra() {
  env -i HOME="$stage/home" DSH_HOME="$stage/dsh" TMPDIR="$stage/tmp" \
    PATH="$stage/bin:$DSH_BIN:$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
    PINNED_BUN="$stage/bin/bun" LC_ALL=C.UTF-8 TZ=UTC \
    timeout 150 node "$stage/$1.mjs" "$2"
}
run_extra drive turn-end
cp "$stage/turn-end-result.json" "$stage/ordinary-turn-end.json"
run_extra drive provider-error
run_extra abrupt restart
cp "$stage/restart-result.json" "$stage/abrupt-host.json"
```

`bash "$packet/replay.sh.txt" goal wait-already` in a fresh checkout with `DSH_BIN` set to the rc.2 installation replays the measured compatibility arm. The verification plane recorded `rec-20261123T061726-7f16ae`. Its shared-workspace docs and comments gate records are supplemental to the checks in standalone candidate copies.
