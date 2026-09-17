# Expected pack-closure drift created by t25's re-point (measured, nested note)

`result.json` in this directory is left untouched; this note sits BESIDE it, per the wave's
"supersede beside a sealed record" rule.

## The measurement

```
$ node scripts/verify-pack-closure.mjs          # 2026-09-17T07:46:26Z, AFTER t25 landed
[verify-pack-closure] FAIL - 1 closure violation(s)
  ROOT-FILE - the packed EXTENSIONS-FOR-AGENTS.md differs byte-wise from
              /root/dshProj/my-power-dsh/EXTENSIONS-FOR-AGENTS.md —
              the artifact would ship bytes no reading was taken on
exit=1
```

Raw log: `pack-closure-after-repoint.log`. **It is the ONLY closure violation in the run**; every
other post-pack writer appears as `CONTENT-DRIFT-EXPECTED … NOT a closure violation` (mtime-anchored:
`agent-references/troubleshooting.md`, `packages/mpd-agent-teams-plugin/lib/{mpd-deltas,quality-gates,state,tools}.js`,
`packages/mpd-team-watchdog-plugin/dist/index.js`). The Architect's sequencing prediction
(`EXTENSIONS-FOR-AGENTS.md` is `REQUIRED_ROOT_FILES[0]` in `scripts/verify-pack-closure.mjs` and the
packed rule BYTE-COMPARES it) is therefore confirmed exactly: root files get a byte comparison, not
the mtime anchor, so a one-token source edit reddens the gate by construction.

## Provenance of the drift

| fact | value |
|---|---|
| packed artifact stamp | 2026-09-17T05:19:48.265Z |
| `EXTENSIONS-FOR-AGENTS.md` source hash before t25 | `5d935524b7db27ea47d3cda913a7f53541b3db2457e7097360f92cd59ee50f27` |
| `EXTENSIONS-FOR-AGENTS.md` source hash after t25 | `a7e57dec8e8017b5c76b035798a17df56619cb5e27fcb3a0c16e63ef6562beb5` |
| t25 landed | 2026-09-17T07:43:53Z |
| `dist/mpd-package/EXTENSIONS-FOR-AGENTS.md` | still the pre-t25 bytes (the 05:19:48 pack) |

So the artifact is not wrong about anything it CLAIMS — it is simply older than one reading that has
since been corrected. This is an expected pre-integration state, not a defect of the re-point.

## Ordering (the one thing that matters now)

The required order is **re-point → re-pack**, and it holds: the re-point is already on disk and the
integration re-pack (`t18`) has not run. The remedy is the captain's single re-pack, which absorbs
this drift together with the other post-pack writers; **there is no revert** (reverting the one-token
re-point would restore a stale pointer to the superseded checker and re-open the T-55-class defect).

Nobody should hand-edit `dist/mpd-package/**` to silence this finding: the artifact is regenerated
by `node scripts/pack-mpd.mjs`, and the gate exists precisely to prove the artifact was re-derived
from the sources rather than patched.
