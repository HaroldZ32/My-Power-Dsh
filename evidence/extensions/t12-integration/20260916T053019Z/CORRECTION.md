# CORRECTION.md — additive correction to an evidence artifact's line-number field

**Written by**: Lead (task `t12`, integration). **Date**: 2026-09-16, ~05:36Z.
**Nature**: additive, independent re-measurement. **The corrected artifact was NOT edited** — an evidence
artifact records what a run measured, and rewriting the field would destroy exactly that property.
This file is the correction of record; the artifact's digest identifies the uncorrected bytes.

## The correction

| Item | Value |
|---|---|
| Artifact | `evidence/extensions/t7-verify/20260916T045829Z/result.json` |
| Artifact sha256 (uncorrected bytes) | `4c972fb1b64f4d1370e66fe09b61bc77ea186158daf2d56a11d8c3a071f29803` |
| Field | `mountEvidence` (subfields `lifecycleApplyLine`, `mcpBridgeApplyLine`) |
| Class | **line NUMBER wrong; the quoted line TEXT is correct** — the wrong numbers name other rows' lines |
| Measured by | the captain, two other members, and independently re-measured by t12 at 2026-09-16T05:35Z |

### Wrong values carried by the artifact

- `lifecycleApplyLine`: `…/evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/output.log:37  [mpd-ext] mpdExtensions provided (apiVersion 1) | tools: mpd_ext_list, … (the same line repeats for all five boots of that lane)`
- `mcpBridgeApplyLine`: `…/evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/output.log:35 (same apply line)`

### Measured truth (t12's own re-read of the two lane logs)

| Lane log | sha256 | True line of `[mpd-ext] mpdExtensions provided …` | All occurrences |
|---|---|---|---|
| `evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/output.log` | `8c4dfe1569949326b39fe3c78e76372da567956b29a5e7c5e43d30bce1f719df` | **`:40`** | `:40`, `:50`, `:70`, `:80`, `:90` — **5 occurrences**, matching the lane's five boots (so "repeats for all five boots" is right, the first line number is not) |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/output.log` | `560f34b78507efb509267ddf1472c4c60b85406640ad33da8e869a1267267e5d` | **`:38`** | `:38` — 1 occurrence |

### Identity of the lines the wrong numbers actually name

| Cited wrongly | What that line really is |
|---|---|
| lifecycle `output.log:37` | `[mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free)` — the ADAPTER line, not the mpd-ext apply line |
| bridge `output.log:35` | `[mpd-config] settings bridge: registered the "mpd" namespace with the file-derived base (applies:'restart', design §10.1)` — the CONFIG line |
| (adjacent, for completeness) lifecycle `output.log:35` | `=== main arm (exit 0, 9924ms) ===` |
| (adjacent, for completeness) bridge `output.log:37` | `[mpd-ext] extension "qa-mcp-hang" mcp server "qa_mcp_hang" unavailable: …` — an mpd-ext line, but NOT the apply line |

## Propagation is closed

The report pair was corrected under **t23** to cite the MEASURED lines, and re-verified at the settled
revision by **t24** (round-2 PASS) and by t12 now:

- `docs/extension-adaptation-report.md:155` → `` (`output.log:40` lifecycle, `output.log:38` bridge) ``
- `docs/extension-adaptation-report.zh-CN.md:77` → `（lifecycle 的 `output.log:40`、bridge 的 `output.log:38`）`
- `grep -n 'output.log:37\|output.log:35' docs/extension-adaptation-report.md docs/extension-adaptation-report.zh-CN.md` → **no match (exit 1)**: nothing in either twin propagates the wrong numbers.

## Why this is a correction file and not an edit

`evidence/extensions/t7-verify/20260916T045829Z/result.json` is the record of a real verification run
(t7 attempt 2) whose entire value is that it reports what that run observed. Patching a field afterwards
would make the file indistinguishable from a forged record. The honest repair is additive: name the
artifact by digest, state the field, the wrong values, the measured values and the identities of the
misnamed lines — which is what this file does. Any future reader who needs the mount proof should read
`output.log:40` (lifecycle) / `output.log:38` (bridge), not the field's line numbers.
