# ARTIFACT REVISIONS READ BY THIS BOARD, and the duration caveat
# t26 attempt 9 · 2026-09-17T05:01Z · docs-gate-engineer · verified on disk, not taken from prose

## 1. ONE OF MY OWN LANES RE-PACKED THE CANONICAL ARTIFACT MID-SWEEP
`skills/dsh-qa/scripts/extension-lifecycle.mjs:376` (`packedArm`) runs the REAL packer:
`runAsync(process.execPath, [join(REPO, "scripts", "pack-mpd.mjs")], …)` — so the lane is an artifact
WRITER by design, and my chunk `c1` (launched 12:37:2x) triggered a re-pack that landed at
**12:37:59.993 +0800 (04:37:59.994Z)**.

Measured on the artifact after that pack:
- packed manifest `dist/mpd-package/package.json` sha256 **`eaa0919702bf5b334…`**, mtime `12:37:59.993745782`;
- **1,190 files** (was 1,188 in the recomposed hybrid);
- both previously-absent declared files present: `EXTENSIONS-FOR-AGENTS.md` (my t68 conversion, sha
  `5d935524b7db27ea…`) and `skills/dsh-qa/scripts/watchdog-redesign.mjs`;
- twin scan on it: `identical=1187 drift=0 missing=0 afterPack=0 ok=true`, `packStamp 04:37:59.994Z`
  ⇒ **the three zeroes**, at instrument `858cd130b6caacad…` (18,056 B, stable across a 12 s paired read).

Attribution: **the 04:37:59 pack was my `c1`/`extension-lifecycle` lane, not `t35`.** `t35` re-packs AFTER
`t26` closes (the wave's pack must be the last writer), so every artifact reading in this board is
**interim** and the report must say so.

### 1a. BOARD LINES SUPERSEDED BY THE RE-PACK (packaging-engineer's refinements, measured 04:44:15Z)
- **The recomposition entry is HISTORICAL, not current.** Use: *"canonical artifact re-packed at
  `04:37:59Z` (manifest `eaa0919702bf5b33`, 1,190 files): closure gate exit 0; twin scan `identical=1187
  drift=0 missing=0 afterPack=[] ok=TRUE` against stamp `04:37:59.994Z`; both formerly-absent files present
  (`EXTENSIONS-FOR-AGENTS.md` byte-equal to source, `watchdog-redesign.mjs` included); zero source writes
  since the pack instant."* The `04:21:54Z` recomposition stays as the **incident record** with its
  `drift=0 / missing=2` figures marked **superseded** — the hybrid no longer exists.
- **`c11`'s `pack-closure` line:** word it *"red at run time (the `02:56:59Z` tree), cleared by the
  `04:37:59Z` re-pack"*; the current canonical run is **exit 0** with `root files 1/1; declared packages
  23/23 present in the artifact`.
- **`afterPack` after `t35`:** a non-empty list must be reported with its two meanings SEPARATED —
  an **external write** vs a **change in the packer's write order** — never merged into one red. The packer
  writes `package.json` LAST, so a real pack yields an EMPTY list (measured on the scratch pack): the
  allowance list is code-level tolerance, never acceptance slack.

## 2. EACH GATE VERDICT LABELLED WITH THE ARTIFACT REVISION IT READ
| chunk | closed | artifact revision it read | `pack-closure` reading |
|---|---|---|---|
| `c11`  | 12:37:35 +0800 | **PRE-pack** (stamp `02:56:59.067Z`, the recomposed hybrid) | **RED** — one finding `ROOT-FILE`: `EXTENSIONS-FOR-AGENTS.md` absent from a pre-t70/t35 artifact |
| `c11b` | 12:43:51 +0800 | **POST-pack** (stamp `04:37:59.994Z`, manifest `eaa0919702bf5b33…`) | **PASS** (68 ms), 6/6 gates green |
Both readings are true of their own revision; neither is quoted as a reading of the other — the same rule
this wave applies to manifest pins and instrument hashes.

Twin readings per revision, for the same reason: pre-04:21:54Z `drift=5 missing=2` (my 04:19:56Z snapshot,
instrument `113e5654…`); 04:21:54Z recomposition `drift=0` **invalid** (mixed tree, `afterPack=5`);
post-04:37:59Z `drift=0 missing=0 afterPack=0 ok=true` (instrument `858cd130…`).

## 3. DURATIONS ARE RAW READINGS, NOT COMPARABLE NUMBERS (contended hour)
The lanes were contended: watchdog-engineer's `agent-teams-adopt` sat at 0 B for **5.5 min** while run 1
measured **110 s** for the same lane, with other seats' lanes writing evidence at 04:38–04:39Z
(`plan-c/c8-vision` 04:38:52, `c6-memory` 04:39:05, `c2-ultrawork` 04:39:11, `plan-c-smoke` 04:38:43,
`session-start-team` 04:38:14); my own 8-way parallel launch caused `bundle-lifecycle`'s boot step to
return nulls (serial re-run green, see `PARALLEL-INTERFERENCE-FINDING.md`).
⇒ the board reports `durationMs` as **raw per-lane readings under contention**, and **no timing-sensitive
verdict is derived from them**; where a duration is quoted at all it is labelled "raw, contended window
04:34–04:45Z".
