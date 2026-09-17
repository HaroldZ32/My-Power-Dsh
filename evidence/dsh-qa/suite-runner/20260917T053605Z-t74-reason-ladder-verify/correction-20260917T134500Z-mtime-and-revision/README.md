# NESTED CORRECTION to `ADDENDUM-falsification-criterion.md` — the mtime bullet, and this file's revision chain

- **Author**: docs-gate-engineer · **filed**: 2026-09-17T13:45Z · **domain**: dsh-qa/suite-runner/t74
- **Parent**: `../ADDENDUM-falsification-criterion.md` — **byte-untouched by this file** (verified below).
- **Thread**: qa-lane-engineer (author of the ladder repair) asked me to state the falsification criterion of
  the t74 repair in my verdict. I added it as the parent addendum. This file corrects ONE stale bullet in that
  addendum and discloses the parent's revision chain.

## 1. The parent's revisions (both pinned; the parent on disk is exactly rev 2)

| rev | when | sha256 | bytes | state |
|---|---|---|---|---|
| rev 1 | 13:42Z | `b7bc32a7002ae5659c01471fc23ddea8cd22effbbcb37a4978e99a146cafd33d` | 3,653 | **committed** by the captain in `684dd3f` |
| rev 2 | 13:43Z | `42dbf59a0b736f1349880a445d17cdb589adf7fae2ea1835845957d0dd5d1492` | 4,380 | **working tree, on disk now** (uncommitted) |

rev 2 differs from rev 1 by exactly one replacement, with no verdict/criterion/clause change: the clause-(a)
replay line is quoted **byte-exact from the recorded logs** instead of with a hand-elided `…` path prefix, and
rev 2 additionally states that the two signature SHAPES differ — the step signature names the lane's own
evidence **file** with `line: null`, the fence signature a stdout **line** (11).

rev 2 was not hand-typed twice: it was **reconstructed mechanically** from the committed rev 1 plus that one
known replacement and then accepted only because the digest matched, byte for byte —
`reconstructed rev2 sha256 = 42dbf59a0b736f1349880a445d17cdb589adf7fae2ea1835845957d0dd5d1492` (4,380 B), equal to
the digest measured on the working tree *before* this correction was written.

## 2. CORRECTION — the parent's last bullet about mtimes is moment-bound, and its moment has passed

Both rev 1 and rev 2 carry this bullet:

> `VENDOR_LOCK.json` `6ca531d2…`, mtime `13:24:25` (pre-dating the `13:29:36` runner edit), with
> `find skills VENDOR_LOCK.json -newermt 13:29:36` → empty.

**That reading was true when taken (~13:41Z) and is FALSE NOW** — and the cause is the evidence, not a
mistake in the fix:

```
$ date -Is
2026-09-17T13:43:33+08:00
$ git log --oneline -2
20a635e merge: wave 1 of the P1 friction register (fix/todo-register-p1) into dev
684dd3f fix(friction): close the P1 register — watchdog redesign, …
$ find skills VENDOR_LOCK.json -newermt '2026-09-17 13:29:36'   # today: file names come back
skills/dsh-qa/SKILL.md
skills/dsh-qa/cases.json
skills/dsh-qa/scripts/… (many)
$ stat -c '%n %y' VENDOR_LOCK.json
VENDOR_LOCK.json 2026-09-17 13:42:47.104941417 +0800
```

The captain's wave commit + merge **checked the tree out at 13:42:47**, which rewrote mtimes across `skills/**`
and on `VENDOR_LOCK.json` while every byte stayed identical. Two consequences, and the second is the
disciplined one:

1. **Anyone re-running the `-newermt` check today will get file names back** and must not read that as a late
   writer. The `skills/**` single-writer window is not reopened by this.
2. **An mtime is a moment-bound reading and a checkout moves it. The durable form is the CONTENT digest** —
   runner `6bea2b38de2a4ac76ddb672b25bdc5f226e870bdd45cafb9026ae9e3c9c9ded0` (44,774 B), `VENDOR_LOCK.json`
   `6ca531d2b20afb19cdc336fa90fcbb7509d2237cfaea62adb2850325d6134992`, `skills/dsh-qa/cases.json`
   `54585caba9a571324be85daeae09373622c173dcb660c7d409a0a2d987eebf9e`, corpus `68318157…` — plus the git
   history. All four are unchanged by the checkout, and the corpus is re-asserted below by the authoritative
   instrument rather than by an mtime.

**Nothing in the t74 subject depends on a timestamp.** The labels are a function of the lane's RECORDED BYTES;
that is exactly why the proof is a replay and not a live run.

## 3. Re-verification of the parent's remaining claims after the checkout

```
$ node scripts/verify-vendor.mjs            # the canonical instrument, NOT an ad-hoc tree hash
[verify-vendor] commit OK: 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
[verify-vendor] version OK: 5.0.0-beta.20
[verify-vendor] asset OK: skills 323 files
[verify-vendor] PASS                                            # exit 0
$ sha256sum scripts/run-qa-lanes.mjs
6bea2b38de2a4ac76ddb672b25bdc5f226e870bdd45cafb9026ae9e3c9c9ded0  scripts/run-qa-lanes.mjs   # 44,774 B
```

A note on method, since it bit me once in this file: I first recomputed a "skills treeSha" ad hoc and got
`036cfc2c…` against the recorded `68318157…` — that was **my serialization being different, not the corpus**.
The gate's `PASS` on `asset OK: skills 323 files` is the statement with authority; an ad-hoc recomputation of a
gate's digest is not a reading of that gate.

## 4. Self-disclosure: a transient inline revision was authored and retracted

At ~13:44Z I wrote a revision header plus this mtime correction **into the parent itself** (call it rev 3). That
breaks the property the parent should have — a correction that pins digests cannot be self-referential: the act
of adding rev 3's own digest changes it again. I therefore **retracted rev 3** and restored the parent to
byte-exact rev 2, putting the revision table and the correction here instead. rev 3's bytes were never
committed, exist in no record, and were superseded within the same minute; it is disclosed rather than quietly
overwritten, and the parent's digest `42dbf59a…` is verified on disk as of this filing.

## 5. What a reader of the parent should conclude

- Clause (a) **holds**: an independent replay of the recorded bytes yields `reason=step:archive` with
  `unauthorized` confined to `alsoDetected`.
- Clause (b) **holds**: `--self-test` exit 0 keeps `fx-401` (fence text, no step map) at `reason=unauthorized`
  and `fx-expected-fence` at `reason=step:archive` — same fence text, two labels.
- The parent's neutrality pairs are unchanged **as digests**; its mtime wording is corrected by §2 above.
