# Evidence-metadata correction — `round8-baseline.sha256.txt`

**Scope of the correction:** THIS round's evidence only. The previous directory
(`../2026-11-11T08-12-09Z/`) is NOT modified: it is the record of what round 9 wrote, and rewriting it
would destroy the very defect this file documents.

## What was wrong

Round 9's `result.json` says (verbatim):

> `"baseline": "round 8 final sources: protocol.ts 573c05d6…, protocol-core.ts 36aec4e6… (see ../2026-11-11T06-27-13Z/final-sources.sha256.txt)"`

But the file it shipped beside that result, `round8-baseline.sha256.txt`, contained:

```
f15ce3b452163248d7439cb2ddebc313044c4266435bdd3e9c82e17161caf9a7  evidence/cellwork/reseed-fix/2026-11-11T06-27-13Z/round7-src/protocol.ts
36aec4e6a07ab5cf3f7bc729e0683c33e822e180315308566ebdc03b3d9b6cd6  evidence/cellwork/reseed-fix/2026-11-11T06-27-13Z/round7-src/protocol-core.ts
```

`f15ce3b4…` is **not** the round-8 `protocol.ts`; it is the **round-7** source, kept at
`06-27-13Z/round7-src/protocol.ts`, which was round 8's own fail-before input. The name said
"round 8", the bytes were round 7 — a reader could not tell which contract the file described.

## The facts, re-measured this round (`round8-baseline-check.log`)

| file | sha256 | what it is |
|---|---|---|
| `06-27-13Z/round7-src/protocol.ts` | `f15ce3b4…` | round-7 source (round 8's fail-before input) |
| `06-27-13Z/round8-protocol.ts` | `573c05d6…` | **round-8 final** `protocol.ts` |
| `06-27-13Z/round7-src/protocol-core.ts` | `36aec4e6…` | same bytes the round-8 final list records (the file did not move in round 8) |
| `06-27-13Z/final-sources.sha256.txt` | — | the round-8 final source list (protocol.ts `573c05d6…`) |

The old file's **bytes** were honest, its **name** was not.

## What this round does instead

- `round9-baseline.sha256.txt` names the round it actually describes and is a verbatim copy of
  `../2026-11-11T08-12-09Z/final-sources.sha256.txt` (round 9's final sources), with a header that
  states the correction.
- `round9-baseline-check.log` runs `sha256sum -c` against the live tree: the three files that move THIS
  round (`test/reseed-binding.test.ts`, both docs) report FAILED; every other line — including all three
  source files and `dist/index.js` — reports OK. That is the proof that this round's delivered source is
  byte-identical to the round-9 baseline, so no behaviour changed.
- `result.json` in this directory cites the same baseline and the same file name, so the two can no
  longer disagree.
