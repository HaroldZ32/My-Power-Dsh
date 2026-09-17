# REPIN RECORD #2 — the CORRECTING write (wave 2b, 2026-09-17T17:0xZ)

**Why a second write exists at all.** The wave's first re-pin (record: `REPIN-RECORD.md`, this directory) was taken
**PREMATURELY**: it was written as a response to a scheduled milestone (lane D terminal, t39 PASS) rather than to a settled
corpus, and the gate whose assertion that pin charges — `bun run test:qa` — had not yet been measured. Measured afterwards: it
was still RED, for a SECOND cause hidden under the comfortable first one (the `VENDOR_LOCK` staleness it was pinned for). Full
account: `.mpd/plans/friction-p2-wave-captain-log.md` §A-118; register row **T-118**; the plan's restatement of F3 is
**A8.2** ("one corpus STATE at the commit, not one write").

**The corpus change that required this write.** `t54` (lane D, the wave's SINGLE `skills/**` writer) rebuilt the RED arm's
member revert in `skills/dsh-qa/scripts/agent-teams-messaging.mjs` — an edit that moves the corpus `treeSha` while leaving the
file count unchanged (324 → 324). t54 is TERMINAL and no other open task declares a `skills/**` path, so the corpus is quiet.

**AUTHORITY — a FRESH `node scripts/repin-vendor.mjs` dry run immediately before the write, and nothing inherited from #1.**
Exit **0** (the plain dry run is informational; `--check` is the asserting mode and exits 1 on drift — the two modes are not
interchangeable and this record states which one was run):

```
skills          locked       5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a  324 files
                computed(LF) 2c039e4c49b9fd32546974c590a54cd53d148946cf6ac26b59b02f1afa39651e  324 files (1 file LF-normalized)
                raw-bytes    3ce41c5c128e1a0802a1300d02c15b21b025ffa8e02894606ce7bafb01c1d513       <- NEVER written
_deps           in sync (d1d106032b19… / 635) — no change
```

**INDEPENDENT AGREEMENT.** `t54` computed the same value from its own run and reported it in the same words before this write
(`2c039e4c49b9fd32546974c590a54cd53d148946cf6ac26b59b02f1afa39651e` / 324, raw never written) — two independent computations
of the same corpus state, not one value quoted twice.

**A MEASURED NON-EFFECT, kept because it proves the guard is atomic.** The first attempt at this write was issued with the
override flag MISSPELLED (`--i-know-this-is-the-captain-step`, without the `s`). The helper refused loudly
(`unknown flag: …` + usage) and exited **1**, and `VENDOR_LOCK.json` was **byte-identical before and after**
(`271258241bc6b997760ebd0819eeb05499ef025f8275a3b59148d85dbdff09ff` both sides): a refused captain step writes nothing. The
manual names the flag identically in §4 (line 186) and §11 (line 536) and the helper's `OVERRIDE_FLAG` agrees — **the error was
the captain's typing, not the documentation**, and it is recorded here so the refusal is not later read as a helper defect.

**THE WRITE (the accepted spelling `--i-know-this-is-the-captains-step`):**
```
WRITE : applied 1 field change(s)
  skills.treeSha: 5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a -> 2c039e4c49b9fd32546974c590a54cd53d148946cf6ac26b59b02f1afa39651e
  (line 22) linesChanged=1  bytes 3434 -> 3434  differingBytes=59
```
**STATE PAIR.** `VENDOR_LOCK.json` sha256: `271258241bc6b997760ebd0819eeb05499ef025f8275a3b59148d85dbdff09ff` →
`cfc8005d56bc3e3fb5ebfa74c30b86a609c85eb56439547fc79f117722ca1256`.

**THE GATE AFTER IT:** `node scripts/verify-vendor.mjs` → **exit 0**, with `asset skills 324 files` OK beside the five other
assets (`_deps` 635 files OK; the four MCP build artifacts OK). First time this wave the vendor gate has been green with the
corpus in its final state.

**WHAT F3 REQUIRES OF THE COMMIT, restated (A8.2):** ONE commit carries (a) every `skills/**` change of the wave, (b) this
lock state, and (c) nothing after it. The COUNT of writes is 2 and is recorded rather than hidden; the corpus STATE at the
commit is single, and an independent recomputation of it equals the value written above.
