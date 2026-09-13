# review.md — revision changelog (readable companion to the custody record)

**Why this file exists.** `review/review.md` reached its terminal task state (t6 `completed`,
`verdict=pass`) and then changed four more times, each change legitimate, labelled and reported —
but a reader holding only the final file cannot tell "the reviewer refined wording" from "the
reviewer found new evidence". This changelog makes that distinction checkable without archaeology.
The captain froze the deliverable at the revision below; this file is a NEW sibling, not another
revision of it.

## Frozen identity of `review/review.md`

| Field | Value |
|---|---|
| Lines | **395** |
| Bytes | **42475** |
| md5 | `f3c69a63cf6f5275484a94867f73b533` |
| sha256 (prefix) | `826f9c5b83df766ba5c7a50d` (full: `826f9c5b83df766ba5c7a50d2ef549a7053c5303421035808b9960ef64e83e8b`) |
| mtime | 2026-09-13 15:58:04 |
| Verdict | `^verdict: pass` literally present at **L13** and **L395** |

**What a citer may rely on.** Cite *this changelog* whenever a downstream document was synthesised
against an earlier revision of `review.md`: it names which revision carried which claim, so no
consumer has to guess whether a difference from the final file is refinement or new evidence. When
citing the file itself, name the hash you read.

## Revision rows (five)

| # | Revision | Trigger | Classification |
|---|---|---|---|
| 1 | **225 lines** — bytes/hash **not recorded** (no pre-review checksum existed; unprovable by anyone, including the captain) | t6's terminal deliverable: §1–§7, `^verdict: pass` | **BASELINE** |
| 2 | **→ 326 lines** — bytes/hash **not recorded** | §8 Addendum appended after t6's terminal record, on the captain's direction: the R7.7–R7.10 adjudications, the guard blind-spot sweep (Guard-1 `scripts/verify-rows-parity.mjs` prints `ok: 0 row ids …` and exits 0 on an empty subject set; Guard-2 `scripts/verify-vendor.mjs` prints `PASS` with `lock.assets` emptied 7→0; Guard-3 the two skip-capable QA cases), and conditions **C9/C10** | **NEW EVIDENCE** |
| 3 | **→ 333 lines** — **36295 bytes**, md5 `7a346ab7b2c380e38bff01a6f0852414` (measured by the captain; recorded in `captain-attestation.md`; never hashed by me) | §8.1 + §6 C1 re-worded to the R7.7 reconciliation rule ("census coverage kept AND ruling dispositions applied; ruling wins on disagreement"). The earlier "never by the census buckets" phrasing was my overstatement and is retracted on the record | **WORDING REFINEMENT ONLY** |
| 4 | **→ 395 lines** — **42108 bytes**, md5 `a62e5a8e2d3edc6dda52e900cb92fcdb` (measured by me) | §9 Addendum 2: independent adjudication of t5's `verify/addendum-gates-and-criteria.md` (C6 red on BOTH remnants; C7's shipped check vacuous — `grep -c '^\| rtl-verif '` = 73 = file length, strict `'^| rtl-verif '` = 0; the installer/build/pack family; the `layout-skill.md` "RTL" = CSS right-to-left false positive), plus condition **C11** and the **C4/C5 widening**. *Within this same edit sequence the file passed through a transient 338-line state (C4/C5 + C11 landed before §9 and the condition reorder); that state is recorded — with its sha256 `77429cbd…` — in `verify/addendum-manifest.md`'s byte-identity and lineage tables, which are themselves moving (see the caution below), so cite the manifest revision you read* | **NEW EVIDENCE** |
| 5 | **395 lines (in-place) → frozen** — **42475 bytes**, md5 `f3c69a63cf6f5275484a94867f73b533`, sha256 `826f9c5b83df766ba5c7a50d2ef549a7053c5303421035808b9960ef64e83e8b`, mtime 15:58:04 | §9 provenance line pinned both states of t5's addendum (11766 B read at 15:49 vs 12726 B / md5 `186ab3f6…` at 15:57:33). No claim changed | **HASH DISCIPLINE ONLY** |

**Net effect.** The frozen state differs from the 225-line baseline by exactly **two
evidence-bearing changes** — row 2 (§8: sweep + C9/C10) and row 4 (§9: addendum adjudication + C11 +
C4/C5 widening). Row 3 is wording only; row 5 is fingerprint bookkeeping only. No measurement in
§1–§7 was altered by rows 3 or 5.

## The second mover — t5's `verify/addendum-gates-and-criteria.md` (four lines)

* Authoritative revision log: **`verify/raw/addendum-revision-log.txt`** — cite it rather than
  re-deriving the chain.
* **r1** = 144 lines, sha256 `fada192fb3fc0c1c0a0d0cb1bc393afdb5e200e63bea720ac25eae80888e1cb3`
  (the state t13's manifest pins by construction in its byte-identity table — the r1 row).
* **r2** = the C7 "strict check" rendering corrected to the anchored form actually run
  (`'^| rtl-verif '` → 0), with the precision note credited to my §9; the defect is the **shipped
  escaped form**, and the finding must not be widened to "the pattern cannot work".
* **r3** = 181 lines, sha256 `596c26b07fae5faeae38843e672e3de2772f2f6cc79b50954390d8b6ebcb6ac2`
  — header attribution (C11) + a §9 revision log. Findings, severities and t5's `verdict=pass` are
  unchanged across r2/r3; `verify/verdict.md` and `false-negative-probes.md` remain byte-identical to
  what t6 reviewed (re-verified by me against the t13 table).

## Cross-reference caution — the manifest is itself a mover

`verify/addendum-manifest.md` (t13) is a legitimate but evolving index, and it has changed at least
three times while this changelog was being written: **292 lines / sha256 `8954473606b91f3ae4a9161d…`
(mtime 15:59:26)** → an intermediate 314-line state → **336 lines / 38847 B / sha256
`357585a7cd9ec5e1c2cd…` (mtime 16:02:44)**. Earlier revisions pinned the addendum at r1 and recorded
the review lineage only up to 338 lines; the current revision carries both addendum rows (r1 as-indexed
and r3) and both review states (338 measured and 395 frozen, "cite the hash you read"). Because of
that drift this changelog deliberately names **rows, never line numbers**, and the non-stale authority
for the addendum's fingerprints remains `verify/raw/addendum-revision-log.txt`.

**This changelog carries no self-hash on purpose** — a file cannot honestly pin its own fingerprint
(it would change the moment it was written). Its identity is recorded by the custody authority below,
the same pattern the addendum uses by keeping its fingerprints in `verify/raw/addendum-revision-log.txt`.

## Authority

The captain's **`evidence/rtl-extraction-residual/captain-attestation.md`** is the authority for
hashes and revisions across the audit; this changelog is the readable companion for the review
document specifically. If the two ever disagree, the attestation wins and this file is wrong.
