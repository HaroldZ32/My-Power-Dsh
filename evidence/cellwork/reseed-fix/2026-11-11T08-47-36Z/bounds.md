# Bounds — round 10 (arms + docs + evidence metadata; NO behaviour change)

## What is proven

- The delivered SOURCE is byte-identical to the round-9 baseline: `protocol.ts 5cd5521d…`,
  `protocol-core.ts eda5a476…`, `index.ts 855ac943…`, `dist/index.js d6e2d49b…`
  (`round9-baseline-check.log`: every source line OK; only the three files this round edits report
  FAILED because they moved).
- The pinned rebuild (`bun 1.4.0` from `.toolchain`) emitted the SAME `dist/index.js` bytes
  (`dist-before.sha256.txt` = `dist-after.sha256.txt`), and `verify-dist-fresh` reports 34/34 fresh.
- 45 arms in `reseed-binding.test.ts` pass (490 expects); the package suite is 414 pass / 0 fail; the
  whole `packages` suite is 4046 pass / 6 skip / 0 fail.
- A30, A31 and the A28 field assertions are falsifiable: three source mutations on a COPY each turn the
  arm that pins that rule red, while the control arms stay green (`fail-before.md`).
- The pre-round bytes of the three edited files were reconstructed and MATCH the round-9 final hashes
  (`e8cbb873…`, `c9a74991…`, `52105782…`); the this-round diffs are therefore exact
  (`this-round-*.diff`).

## What is NOT proven / declared limits

1. **A30's failure injection needs a non-root, owning process.** The arm removes the write bit from the
   cell directory; observed `uid=1000`. Under a root-run suite the write would succeed and A30 would fail
   LOUDLY on `cellRow` (it cannot silently pass), but the arm is then measuring the environment, not the
   code. No root-run was executed here.
2. **The microtask heal is ordering-dependent by design.** The write bit is restored in a
   `queueMicrotask`, i.e. at the first `await` after the mirror's synchronous write. The green run and the
   two A30 red runs exercise this order; no separate test asserts the ordering itself.
3. **The documentation sentences are not asserted by a test.** `verify:docs` checks the EN/zh pair, the
   switch link, the heading tree and link resolution — not that the two sentences now agree.
4. **`m6` covers the two READ states, not every unreadable shape.** It drives a missing record file
   (`no-team-record`) and an unparsable one (`team-record-unreadable`) through `rebind`'s own filesystem
   read. A plane that throws while the file is readable is a different branch (A7 covers that shape for
   the barrier, not for `rebind`).
5. **The arms assert the fields they name, not the whole answer object.** `unfenceWithheld.members` is the
   call's RESOLVED, de-duplicated unfence target list; A31 proves completeness and order for the two seats
   it declares.
6. **No git write was run.** HEAD is still `84f6dd47`; the wave is uncommitted by design. The mutation
   exercise lived only in `.qa-tmp/reseed-mutation/` (gitignored) and its restore hashes are recorded.
7. **A30 pre-creates the cell journal** so the read-only directory cannot conflate "the STATE write
   failed" with "the journal file did not exist yet". A real cell always has its journal by the time a
   dispatch runs; the arm models that.
8. **The old evidence directory is untouched.** The metadata correction is documented in this directory
   (`metadata-correction.md`) and the corrected baseline is named for the round it describes.
