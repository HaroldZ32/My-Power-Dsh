# V2 Wave 0 report replay · 23 November 2026

The synthesis replay ran in the dev-based feature Git checkout and finished at 06:20:06 UTC. It used Node `v24.21.0`, Python `3.14.4`, and Zstandard CLI `1.5.7`. Bun `1.4.0` was used for the targeted collector test suite. The independently observed tool-surface mount used DSH `0.2.2-rc.5` and Bun `1.4.0`. [Per-workspace baseline report](../../../reports/baseline-v2-wave0-20261123T062006Z.md) · [Independent mount receipt](../../T0.2/20261123T054215Z/independent-verification.md)

## Public replay commands

Run from the feature checkout root. Use a Git checkout so the historical header is available. The repository archive excludes it.

```sh
set -eu
scratch=$(mktemp -d)
collector=evidence/baseline/T0.1/20261123T042200Z
surface=evidence/baseline/T0.2/20261123T054215Z
prior=evidence/cellwork/diag-mount/2026-10-27T02-01Z/registration/request-header-record.json
metrics=evidence/baseline/wave0-metrics
python3 "$collector/independent-controls.py.txt" "$scratch/collector-cases" > "$scratch/fixture-root"
for arm in positive linked unknown malformed empty; do
  node scripts/baseline/collect.ts "$scratch/collector-cases/$arm" > "$scratch/collector-$arm.json"
done
node --input-type=module - "$scratch" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => JSON.parse(readFileSync(`${process.argv[2]}/collector-${name}.json`, 'utf8'));
const linked = read('linked').workerLoss.assignments[0];
assert.deepEqual([linked.lastSuccessfulAction.callId, linked.subsequentHandoffOrTerminal.callId,
  linked.nextCaptainObservation.callId], ['matched', 'handoff', 'captain-status']);
assert.equal(read('unknown').workerLoss.assignments[0].lastSuccessfulAction, 'unknown');
assert.equal(read('malformed').checkpoints.complete, false);
assert.deepEqual(read('empty').teamRecords, { observed: 0, complete: true });
console.log('PASS collector fixtures');
NODE
sh "$surface/capture.sh" --self-test
sh "$surface/repair-controls.sh"
node scripts/baseline/tool-surface.ts "$surface/member-request-header.json" "$prior" 4 > "$scratch/surface.json"
cmp "$surface/surface.json" "$scratch/surface.json"
node "$metrics/replay.ts"
node "$metrics/coverage-replay.ts"
sha256sum -c "$metrics/public.sha256"
.toolchain/node_modules/.bin/bun test ./scripts/baseline/collect.test.ts
```

| Replay | Exit | Observed result |
| --- | ---: | --- |
| Collector fixture generator, five calls, and assertions | 0 | Linked worker action, handoff, and captain observation matched. Unknown, malformed, and empty controls retained their expected coverage. |
| Saved capture self-test and explicit `cmp` | 0 | Comparison reproduced byte for byte at SHA-256 `c8ed2f548a4eaecbf7bc9032b1a4bc2ac2aa4dbc5eaef4e97bfe787102156546`. |
| Tool-surface repair wrapper | 0 | Its malformed UTF-8, overflow, and one-sided overflow controls exited 3 as expected. The replacement character and fractional-ratio controls exited 0. |
| Dispatch, ceremony, and growth arithmetic replay | 0 | Synthetic controls and public aggregate arithmetic passed. |
| Final coverage replay | 0 | Activation provenance, duplicate pass source, partial growth, and zero-turn controls passed. |
| SHA-256 manifest | 0 | All 21 entries matched. The manifest’s SHA-256 was `83dd88b712bc3175c94e55f790364d64cbabca1869ac8c3614412a4086c98a83`. |
| Pinned collector tests | 0 | Six passed and zero failed. |

[Collector fixtures](../../T0.1/20261123T042200Z/public-summary.md) · [Tool-surface controls](../../T0.2/20261123T054215Z/repair-controls.md) · [Public replay guide](../../wave0-metrics/replay.md) · [Exact input manifest](../../wave0-metrics/public.sha256)

## Dated sources and invalidation bounds

For authorized local reproduction, repeat these read-only commands for each original workspace, with `workspace` set to that workspace directory. The retained workspace records, report command outputs, and measurement-time fingerprints are local controls. The public receipts carry aggregate values and input fingerprints. A live workspace may legitimately produce different totals on a later read.

```sh
node scripts/baseline/collect.ts "$workspace"
node scripts/baseline/serial.ts "$workspace"
node scripts/baseline/ceremony.ts "$workspace"
node scripts/baseline/growth.ts "$workspace"
```

Use the separate mount instructions to sample a fresh working member. They require installed checkout dependencies, Node `v24.21.0`, `PINNED_BUN` for Bun `1.4.0`, and `PINNED_DSH` for DSH `0.2.2-rc.5`. The command runs its isolated workspace with pre/post source and distribution inventories. Counts from that run apply to its captured request. The saved comparison and the mounted replay certify different inputs. [Mounted working-member commands](../../T0.2/20261123T054215Z/replay.md)

The synthesis values apply to the cited capture clocks and exact input hashes. If a source hash, capture identity, toolchain pin, or launcher composition changes, replay the affected instrument and record a separate observation. A successful public synthetic replay checks the measurement logic and the published reductions. It cannot recover an absent journal, a private capture, or an unrecorded composition. Independent T8 review covers this synthesis separately from the instrument verdicts. [Final independent instrumentation verdict](../../wave0-metrics/independent-verification.md)

## Report staging scope

- `evidence/reports/baseline-v2-wave0-20261123T062006Z.md`
- `evidence/baseline/T0.6/20261123T062006Z/report.md`

Referenced instrument packets are already covered by their own staging scopes. The two report files require those packets in the same feature checkout.
