# NESTED CORRECTION (t73 evidence) — the mtime statements in `neutrality` are superseded

**Parent untouched.** `result.json` in this directory is NOT edited; this correction sits beside it,
the form the wave uses for superseding a record (cf. the t66 corrections and t74's addendum).

## What changed and what did not

The captain's wave commit + merge (`684dd3f` fix, `20a635e` merge into dev) checked the tree out at
**2026-09-17 13:42:47 +0800**, which **rewrote mtimes** across `scripts/`, `skills/**` and
`VENDOR_LOCK.json` while **every byte stayed identical**. So the two mtime-based statements in
`result.json → neutrality` are STALE and must not be quoted:

- `runner.mtimeAfter: "2026-09-17 13:29:36 +0800"` — now `13:42:47`;
- `vendor_lock.mtime: "2026-09-17 13:24:25 +0800 (PRE-dates my 13:29:36 edit)"` — now `13:42:47`.

**The neutrality CLAIM is unaffected**, because it was never an mtime claim: it is (a) the corpus
reading identical before and after, (b) the lock not written by this task, (c) the runner outside
`skills/**` and unnamed by the packer. All three are byte statements, and all three still hold.

## The durable, hash-based form (re-measured after the checkout)

| artefact | sha256 (unchanged by the checkout) | size |
|---|---|---|
| `scripts/run-qa-lanes.mjs` | `6bea2b38de2a4ac76ddb672b25bdc5f226e870bdd45cafb9026ae9e3c9c9ded0` | 44,774 B |
| `VENDOR_LOCK.json` | `6ca531d2b20afb19cdc336fa90fcbb7509d2237cfaea62adb2850325d6134992` | 3,434 B |
| `skills/dsh-qa/cases.json` | `54585caba9a571324be85daeae09373622c173dcb660c7d409a0a2d987eebf9e` | — |
| corpus `skills` (LF-normalized) | `68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c` / **323 files** | — |

**Gate reading, re-run after the checkout:** `node scripts/verify-vendor.mjs` → `[verify-vendor] PASS`,
**exit 0** — including `asset OK: skills`. That is the binding form for the corpus: the gate compares
the LF-normalized treeSha, so a byte-identical checkout cannot redden it.

## Lesson recorded (same family as the fold thread)

An mtime is not a revision identity, and this wave has now demonstrated it twice: a checkout can move
every mtime without moving a byte, and a locale can move a digest without moving a byte. A neutrality
(or "untouched") statement must be carried by **hashes of the bytes**, with mtimes only as narration —
docs-gate-engineer filed the same correction independently at
`evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/correction-20260917T134500Z-mtime-and-revision/`.
