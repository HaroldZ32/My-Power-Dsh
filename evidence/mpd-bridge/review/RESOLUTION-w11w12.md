# t36 addendum — W11/W12 discrepancy RESOLVED (post-t39, settled hashes)

Written after t36 was already terminal as `needs_revision`. The captain asked for the W11/W12
discrepancy to be resolved explicitly rather than guessed; this is that resolution. The t36 verdict is
NOT reopened — it is the honest verdict for the revision it judged — but B1 and B2 are now superseded
by measurement, and B4's card attribution is corrected.

## 1. What W11/W12 assert (quoted from the lane's own source)

`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` (sha256 prefix `4474be1e…`):

```
add("W11", observed.mutate?.resolved === observed.expectedValue,
    "the RESOLVED namespace value the mpd config layer merges changed to " +
    observed.expectedValue + " (descriptor value = " + JSON.stringify(observed.mutate?.resolved) + ")")
add("W12", observed.mutate?.user === observed.expectedValue,
    "the settings USER section (the L3 layer) carries the written value (" +
    JSON.stringify(observed.mutate?.user) + ")")
add("W13", observed.mutate?.base === observed.initialValue,
    "the namespace's BASE is the FILE value " + String(observed.initialValue) + " (" +
    JSON.stringify(observed.mutate?.base) + "), not the schema default 20000 …")
```

Both compare a **scalar** (`expectedValue`, the written number) against the lane's own extraction
`observed.mutate.resolved` / `.user`. They therefore depend entirely on the lane's mapping step, not on
the raw response.

## 2. What the raw response actually carried (my captured line)

In BOTH of my failing runs the same mutate response carried the value nested, not as a scalar:

```
"value":{"hashline":{"maxDiffChars":31415},…},
"user":{"hashline":{"maxDiffChars":31415}},
"revision":1
```

and the failing detail strings read `(descriptor value = undefined)` / `(undefined)` — i.e. the lane's
extraction returned nothing, while the payload demonstrably held 31415. So W11/W12 were red because the
**lane's observation mapping** produced `undefined` at that revision — not because the product failed to
carry the value (the file was rewritten and the response resolved it in the same run: W3 "read back
31415").

## 3. Classification and the settled re-run

**(c) a measurement artifact of the concurrent rewrite, surfacing through the lane's extraction — NOT a
product defect.** Decisive evidence: re-running the write-path arm on a SETTLED revision (hashes
identical before and after) gives

```
[write] W1=ok W2=ok W3=ok W4=ok W5=ok W6=ok W7=ok W8=ok W9=ok W10=ok W11=ok W12=ok W13=ok
[settings-bridge] PASS
```

and that run's payload contains the captain's falsifying number:

```
"base":{"hashline":{"maxDiffChars":35000},"ulw":{"maxRounds":6}},   ← the FILE value, not 20000
"value":{"hashline":{"maxDiffChars":31415},…},"user":{"hashline":{"maxDiffChars":31415}},"revision":1
```

| Observation | Revision it belongs to |
|---|---|
| W11/W12 RED twice (frame hashes frozen DURING each run) | config `src/index.ts` `559eb3e0…`, `dist/index.js` `225c171b…`, lane pre-16:41 |
| W11/W12/W13 GREEN, `[settings-bridge] PASS` | config `src/index.ts` `e8917933…`, `dist/index.js` `15733c1e…`, lane lib `4474be1e…` — SETTLED (hashes unchanged across the run) |

Both lane arms were also rewritten at 16:41 (split into a TUI arm and a write-path arm); the write path
namespace → file → resolved value now lives in the sibling `web-settings-bridge.mjs`. That is the
cheapest probe, and it is the one reported above.

## 4. Consequences for the t36 findings

- **B1 (high) — SUPERSEDED by measurement.** The file-derived base is IMPLEMENTED and re-derived by me:
  `base.hashline.maxDiffChars = 35000` (the file value) where the schema default is 20000 — exactly the
  falsifying observation the captain named, captured from the running host in my own sandbox. The
  overwrite hazard B1 described is closed at this revision.
- **B2 (high) — SUPERSEDED by measurement.** The read-in now agrees end to end: W11 (resolved), W12 (L3
  user section) and W13 (base) all pass in the same run that rewrote the file. The earlier disagreement
  was between the lane's extraction and the raw payload, not between two product surfaces.
- **B3 (medium) — still open** (docs `mpd-tui-plugin/README.md:110-122`, `README.zh-CN.md:101-109`
  still assert the pre-bridge behaviour).
- **B4 (medium) — attribution CORRECTED.** The web card was **cut by the user** ("the user cut the
  card", `tui-settings-bridge.mjs:14`), so its disappearance is a deliberate scope decision, not an
  unexplained removal; the only surviving substance is the general point that the review target was
  being rewritten underneath the review.
- **B5 (low) — still open** (skills corpus tree hash moved; single re-pin still owed).

**Conclusion: the product's write path and read-in are CORRECT at the settled revision `e8917933…` /
`15733c1e…`; the W11/W12 red was a lane-observation artifact measured while t39 rewrote the package.
A pass at this revision would rest on W1-W13 GREEN plus the negative controls, with B3/B5 as the only
open items.**
