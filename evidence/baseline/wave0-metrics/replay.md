# Wave 0 measurement replay

From a checkout containing the Wave 0 changes, run with Node 24 or later.

```sh
node evidence/baseline/wave0-metrics/replay.ts
node evidence/baseline/wave0-metrics/coverage-replay.ts
```

The replay writes invented records into an isolated temporary directory and exercises the three command-line entry points. It independently computes the ready-set difference, approval latency, and checkpoint token and ratio distributions. It checks empty boards, missing ready sets, contradictory pairings, a shell-only archive, ambiguous attribution, and a zero-turn checkpoint. The missing-data controls keep unrelated skip reasons, count unknown reasons by task, and preserve known ceremony counts when unreadable or missing candidates make totals unknown. Run `node evidence/baseline/wave0-metrics/replay.ts --findings` to print the synthetic observations used in the repair receipt.

The coverage replay checks that stale or unverified activation pointers stay candidates, a named capture already in the journal set is read once, and a missing, unreadable, or malformed journal leaves checkpoint totals and distributions incomplete. The growth CLI retains its observed rows and statistics, with per-distribution sample counts and coverage. A clean zero-turn checkpoint is counted and skipped for arithmetic. A genuinely empty workspace reports zero checkpoint rows.

The public receipt labels the two experiment workspaces A and B and the shared checkout `integration`. Its numbers summarize the dated local scans. The replay reconciles reported aggregate counts and checks that the two recorded input fingerprints agree. Each fingerprint was computed over a sorted JSON array of relative input paths and their `bytes:sha256` values. Only the resulting aggregate digest and file count are published. Current and historical figures are separate.

The original workspace records, detailed receipts, and their measurement commands are local validation inputs. Their observations require access to those workspaces. The public fixture controls can run from a clean checkout using only its listed files and Node. No host mount is required for this arithmetic replay.

The packet manifest contains every new packet file and the exact source files it executes. Include the manifest itself with those listed files. From the checkout root, `sha256sum -c evidence/baseline/wave0-metrics/public.sha256` checks those bytes.

[Public aggregates](./measurements.json) · [Arithmetic replay](./replay.ts) · [Coverage replay](./coverage-replay.ts) · [Coverage repair receipt](./coverage-receipt.json) · [Original two-finding repair receipt](./repair-receipt.json) · [Exact public paths and checksums](./public.sha256)

[Workspace collector verification](../T0.1/20261123T042200Z/public-summary.md) · [Serialisation CLI](../../../scripts/baseline/serial.ts) · [Ceremony CLI](../../../scripts/baseline/ceremony.ts) · [Context growth CLI](../../../scripts/baseline/growth.ts) · [Shared input reader](../../../scripts/baseline/input.ts)
