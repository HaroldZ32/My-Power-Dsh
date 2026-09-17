# SUPERSEDED MEASUREMENT — the `ROOT-FILE` finding held for the gate revision I ran, not for the current one

Nested beside `PACK-CLOSURE-DRIFT.md` (which is left untouched). Written after `docs-parity-engineer`
re-ran the closure and reported a different verdict; re-measured here first-hand before correcting
anything. Raw: `pack-closure-recheck.log`.

## What happened

| time (UTC) | gate revision | verdict on `EXTENSIONS-FOR-AGENTS.md` |
|---|---|---|
| 07:46:26Z (t25) | `scripts/verify-pack-closure.mjs` as it stood then | **exit 1**, exactly ONE closure violation: `ROOT-FILE - the packed EXTENSIONS-FOR-AGENTS.md differs byte-wise …` |
| 07:48:02Z | the gate file is rewritten (lane B / T-76; `M scripts/verify-pack-closure.mjs`, now sha256 `c0814334013c0da50317e8e64a4b6a341ae31cb6402cdc9dbf937dfd1b745e7d`) | — |
| 08:01:19Z (re-measured here) | current | **exit 0**, `0 drift`, and the root file is a PROVENANCE-NAMED entry: `CONTENT-DRIFT-EXPECTED (expected, provenance-named, NOT a closure violation) - EXTENSIONS-FOR-AGENTS.md: source mtime 2026-09-17T07:43:40.983Z is AFTER the artifact stamp 2026-09-17T05:19:48.265Z … a writer landed after the pack, so this is an EXPECTED reading, not a closure violation` |

So the finding in `PACK-CLOSURE-DRIFT.md` was TRUE FOR THE REVISION I MEASURED and is SUPERSEDED by a
later gate revision, not contradicted: the gate now distinguishes a byte-compared post-pack writer
from real drift. Its summary line at the re-measure: `content bytes: 1181 file(s) compared, 1157
identical, 0 drift, 24 expected-after-pack`.

## What did NOT change

The artifact is still the 05:19:48Z pack and the source file is still the corrected one:

| | value |
|---|---|
| `EXTENSIONS-FOR-AGENTS.md` source | `a7e57dec8e8017b5c76b035798a17df56619cb5e27fcb3a0c16e63ef6562beb5` |
| `dist/mpd-package/EXTENSIONS-FOR-AGENTS.md` (packed) | still the BEFORE bytes `5d935524b7db27ea47d3cda913a7f53541b3db2457e7097360f92cd59ee50f27` |

Therefore the captain's single integration re-pack (`t18`) is STILL REQUIRED — the artifact would ship
bytes no reading was taken on — it is simply no longer a gate VIOLATION at this revision. Post-re-pack
acceptance should read: the root file drops OUT of the `expected-after-pack` list, i.e. it must no
longer appear with a post-stamp mtime; "exit 0" alone is satisfied both before and after the re-pack
and therefore cannot distinguish them.

The two prohibitions recorded with the original finding stand unchanged: never revert the re-point,
never hand-edit `dist/mpd-package/**`.
