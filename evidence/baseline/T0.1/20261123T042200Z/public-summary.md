# Workspace collector verification

The independent verifier exercised the public `node scripts/baseline/collect.ts <workspace>` entry point against two read-only workspaces on 2026-11-23. The capture times were 04:30:38 UTC for MailCollect and 04:30:39 UTC for VEdit. Each independent inventory matched a second read, and the five delivered source and test files matched between checkouts. The scoped verdict was `rec-20261123T045011-81dbe7`.

| Measurement | MailCollect | VEdit |
|---|---:|---:|
| Boards / cells | 9 / 4 | 30 / 10 |
| Member rows / task rows | 66 / 229 | 215 / 745 |
| Confirmed nonterminal rows with an executor handle owner | 3 | 9 |
| Claimed or in-progress assignments | 4 | 15 |
| Checkpoints | 4 | 21 |
| Recorded decisions to fall back to reseeding | 4 | 23 |
| Refused fallback decisions | 1 | 18 |
| Recorded dispatch reassign calls | 44 | 69 |

The two retained inputs lacked assignment-specific session receipts for all 19 open claims. The collector reported their last successful action, subsequent handoff and next captain observation as unknown. The actual number of host spawn calls was also unknown. The independent verifier reproduced board sizes, explicit cell-to-board relationships, unmatched boards and the assignment identities. VEdit contained one additional unresolved owner.

## Reproduce with synthetic inputs

From the repository root, with Python 3, zstd, Node 24 and the pinned Bun 1.4.0 toolchain installed, run the commands below. The generator creates fresh `positive`, `linked`, `unknown`, `malformed` and `empty` directories. All session IDs and task payloads in those fixtures are synthetic. The independent workspace counter can also be run on an operator-supplied workspace using `python3 "$receipts/independent-recount.py.txt" "$workspace"`.

```sh
receipts=evidence/baseline/T0.1/20261123T042200Z
scratch=$(mktemp -d)
python3 "$receipts/independent-controls.py.txt" "$scratch/cases"
for arm in positive linked unknown malformed empty; do
  node scripts/baseline/collect.ts "$scratch/cases/$arm" > "$scratch/$arm.json"
done
.toolchain/node_modules/.bin/bun test ./scripts/baseline/collect.test.ts
```

The linked control produced the successful worker result at 00:00:01Z, the handoff at 00:00:03Z and the first matching captain observation at 00:00:05Z. The negative control excluded a pre-claim result, another executor, another board or revision and a denied action with a positive watchdog marker. Truncated session data and external session symlinks yielded diagnostics and unknown progress. An empty workspace returned a single JSON report and exit 0.

## Gate results

Five targeted tests passed. Type checking, declaration comments and distribution freshness passed in the integrated checkout. The pinned static aggregate passed 11/11. The native aggregate lacked `MPD_DSHGO_KIT`, and the native parent package suite recorded 4,304 passed, six skipped and one failure because its idle-ledger assertion encountered an active Boulder. The feature worktree's pinned package suite passed 4,180 with six skips. In an isolated copy of the integrated parent, two existing shipped-dist assertions produced bytes matching a nested ambient Bun 1.4.2 build. The signed-off scope was the collector's eight measurements and their error handling. The private project records, per-assignment details and raw session stores remain in their original capture environment.
