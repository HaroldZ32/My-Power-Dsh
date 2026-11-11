# Round 7 — N3 bound correction and a TRUE round-only diff

## What the prior evidence said, and what is correct

`evidence/cellwork/reseed-fix/2026-11-11T05-12-02Z/result.json` (bounds) described `wave.diff` as
"the CUMULATIVE HEAD->worktree diff (all six rounds)". That wording is WRONG.

- `HEAD` at this wave is `2a5126cd` ("fix(cellwork): the compaction reseed binds the seat or says it
  did not"), which already CONTAINS rounds 1-3.
- `wave.diff` was produced as `git diff HEAD`, so it covers **rounds 4-6 only**, not all six.
- The prior `wave.diff` is still a valid artifact; its correct label is "rounds 4-6 cumulative".

No prior evidence file was modified or overwritten: all seven round directories are intact, and this
note lives in the round-7 directory.

## A true round-7 diff (both halves)

The round-6 end tree was reconstructed byte-exactly:

```sh
git archive HEAD | tar -x -C <tmp>
cd <tmp>
patch -p1 --batch --forward < evidence/cellwork/reseed-fix/2026-11-11T05-12-02Z/wave.diff
sha256sum packages/mpd-cellwork-plugin/src/protocol.ts \
          packages/mpd-cellwork-plugin/src/protocol-core.ts \
          packages/mpd-cellwork-plugin/test/reseed-binding.test.ts \
          packages/mpd-cellwork-plugin/dist/index.js \
          docs/cellwork.md docs/cellwork.zh-CN.md \
          packages/mpd-cellwork-plugin/README.md packages/mpd-cellwork-plugin/README.zh-CN.md
```

All eight hashes matched `05-12-02Z/sha256.txt` exactly (including
`protocol.ts cb22299f530ebbeb9b2ae1f1e39fdd4e322f7e2eab589959d2218f4836c5bfd6`), so the reconstructed
tree is proven to be the exact pre-round-7 baseline. Then:

- `round7-src.diff` — `packages/mpd-cellwork-plugin/src/{protocol.ts,protocol-core.ts,index.ts}`
  against that baseline; only `protocol.ts` has hunks (the other two are byte-identical this round).
- `round7-wave.diff` — the whole declared scope (src, test, dist, docs pair, README pair); seven files
  have hunks, the two untouched src files produce none.

Both files use `a/<path>` / `b/<path>` labels taken from the WORKSPACE-RELATIVE path, applied with
`patch -p1` from the repository root.
