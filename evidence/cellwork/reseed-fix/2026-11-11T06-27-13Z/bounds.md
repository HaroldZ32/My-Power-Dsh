# Round 8 bounds — PR #109 F1 (M1) + F2 (N1)

## What this round changed

- `packages/mpd-cellwork-plugin/src/protocol.ts` — `handleEvidenceOf` now asks the CURRENT record
  first: a handle named by the TEAM `executorRef` or the CELL row is accepted and can never be
  vetoed by journal recency. The journal decides only when NEITHER current row names a handle; it
  may otherwise classify a refusal (`handle-superseded` vs `handle-unevidenced`) but never turn it
  into a bind. The `handle-superseded` detail no longer says `pass <latest.handle>`; it states the
  record's current handle and the journal's last hand-over and asks for reconciliation. Two markers
  carry the provenance: `handleRecordCurrent` (the record names the requested handle) and
  `journalHandoverOlder` (the record names a different handle AND its write instant is provably
  later than the journal's last hand-over stamp).
- `packages/mpd-cellwork-plugin/test/reseed-binding.test.ts` — A24/A26b now pin the failure-path
  `namedBy` and the refusal outcome/row `previousSessionId`/`previousSessionIdLiveness`; A27 seeds
  the writer's crash window and its record-silent control.
- `docs/cellwork.md`, `docs/cellwork.zh-CN.md`, `packages/mpd-cellwork-plugin/README.md`,
  `packages/mpd-cellwork-plugin/README.zh-CN.md` — state the precedence in both languages:
  **current record wins; the journal only corroborates.**
- `packages/mpd-cellwork-plugin/dist/index.js` — rebuilt with the pinned `.toolchain` bun 1.4.0.

## Declared interpretation (deliberate, not accidental)

A request named by the journal's LATEST row but NOT by either current record is refused
(`handle-unevidenced`) whenever the record names a DIFFERENT handle. F1 says the record is
authoritative and journal recency decides only when the record names NO handle; accepting the
journal over a speaking record would be the same inversion in the other direction. The journal still
decides (and A27's control proves it) when both current rows name no handle at all.

## Marker bounds

`journalHandoverOlder` requires a known record write instant (`updatedAt`, else the file mtime) AND
the journal row's own `at` stamp, and is emitted only when the row provably predates the record.
When either stamp is missing the marker is OMITTED rather than guessed; the record-first acceptance
does not depend on it. An mtime can move without a semantic change, so the marker is reported
evidence, never a decision.

## Answer surface asserted

A27 asserts on the `rebind` entry and the declared render (no older handle, no `pass` direction),
not on the whole `cellwork_dispatch` answer: the dispatch pass may legitimately carry unrelated board
rows that still name the old owner after a terminal row is preserved (F3 history).

## Not touched

`protocol-core.ts` and `src/index.ts` are byte-identical to round 7 (`36aec4e6…`, `855ac943…`); no
adapter/team-core/elastic/staging/split/flow file was edited; no git write operation was run.
