# B2 negative control — the unfence tests are falsifiable

**Question:** do the seven `dispatch-unfence.test.ts` arms actually depend on the fence-clearing
decision, or would they pass against an unfence that does nothing?

**Mutation (temporary, in `packages/mpd-cellwork-plugin/src/protocol.ts#unfenceSeats`):** the
fenced/not-fenced decision was inverted

```diff
-      if (row === undefined || row.fenced !== true) {
+      if (row === undefined || row.fenced === true) {
```

**Observed (`negative-control.log`, exit 1):** 6 of 7 arms FAILED —

- unfence removes both fence keys … — fail
- a member that is not fenced answers `not-fenced` … — fail
- the plane seam clears the TEAM row / reports its absence — fail
- `unfence` and `reassign` travel in one call — fail
- the unfence clears the deadlock refusal and the member hands off again — fail
- refusal after an unfence still reports the act + description disclosure — fail
- an unknown name is refused … — PASS, as expected: that path refuses before the fence decision is read.

**Restore:** the source was restored from a workspace copy (`.qa-tmp/protocol-h0.ts`, not `/tmp` — the
shell's `/tmp` is fresh per call, T-23) and its sha256 re-measured:

```
before mutation  9073ebd86cf12c67bd6a76bb7511ee2371a2bd474a8a24697c7cfd952e3d2e52
after restore    9073ebd86cf12c67bd6a76bb7511ee2371a2bd474a8a24697c7cfd952e3d2e52
```

**Re-run after restore:** `bun test packages/mpd-cellwork-plugin/test/dispatch-unfence.test.ts` →
7 pass / 0 fail. The four reported gates in `gates.log` ran AFTER this restore, against the bytes whose
sha256 is quoted above; `.qa-tmp/` was removed afterwards.
