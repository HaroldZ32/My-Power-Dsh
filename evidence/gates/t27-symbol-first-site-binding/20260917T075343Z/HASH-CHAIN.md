# HASH CHAIN of the durable checker (why a quoted hash in an older record now differs)

The durable checker's `sha256` is a LIVE value; a hash hand-copied into an older record is a snapshot
of the moment it was taken. This note is the chain, so a reviewer comparing records does not read the
difference as a defect. (Nested beside t27's `result.json`; no older record was edited.)

| revision of `scripts/check-citations.mjs` | sha256 | who moved it | what changed |
|---|---|---|---|
| t16 durable home (660 lines, 38946 B) | `d64dfeb52d3b6c9d18acee5c7e9d8685c82b847e44a4f6f4ef94f21eb1f45c13` | `t16` | the durable home itself: site-paired claims, the `lineNumberOnlyProblem()` ROT verdict, `content:rot`, the new counters, `checker{path,sha256,supersedes}` |
| t27 repair (41870 B) | `c86f00cc978863ea28354f4f7ea45ad3a628a84b54b7008082d2d8e581ac5112` | `t27` | F3: `symbolOnlyClaimCheck()` resolves through `claimForSite()` (site-preferring, document-wide fallback kept for claim-less anchors); F1: the hard-coded `attempt_id` removed |

The frozen evidence-side revision is untouched by both: `evidence/extensions/docs-claims/check-citations.mjs`
= `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c` (30345 B).

Records that quote `d64dfeb5…` and are therefore SNAPSHOTS, not stale claims:
`evidence/extensions/docs-claims/SUPERSEDED-check-citations.md` (t16's nested correction, which also
describes the durable home correctly) and the t25 evidence pages that quoted the durable hash while it
was current.

**Standing rule for any future citation of this value:** quote the hash from a RUN RECORD, never by
hand — every run already carries `checker{path, sha256, supersedes}` (`result.json.checker`), which is
why t16 added that field: the checker's intermediate revisions are meant to be diffable, not merely
hash-comparable.
