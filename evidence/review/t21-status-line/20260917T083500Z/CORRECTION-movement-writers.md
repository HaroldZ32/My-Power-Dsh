# CORRECTION (beside my own POST-VERDICT-MOVEMENT.md) — the writer count was wrong; the prefix is byte-identical

**Task:** t32 (review of t21) · **Reviewer:** code-reviewer · **Written:** 2026-09-17 after the captain's clarification
`POST-VERDICT-MOVEMENT.md` and `result.json` are NOT edited; this page is the correction BESIDE them.

## What I got wrong

My `POST-VERDICT-MOVEMENT.md` says the pinned test file changed because "**t37 … and a second case labelled `t41`** … landed in the same window — neither was in my pinned revision". **The `t41` half is false.** `t41` is a **WAVE-1** case (its own comment: "t41 (wave 1): the two REFUSAL PATHS of the now member-visible contract tool") and it sits inside the file's PREFIX.

## The byte-exact proof (measured by me, not inherited)

`afb3233519db7fac…` — my t32 pinned revision of `tool-boundary-hold-and-contract-seat.test.mjs` — is **exactly the file's prefix before t37's block**, in both equivalent forms:

* `sha256(first 457 lines + "\n")` = `afb3233519db7fac…` ✔
* `sha256(first 458 lines, no trailing newline)` = `afb3233519db7fac…` ✔

The wave-2 addition is therefore lines 458–541 only (the dashed separator + t37's comment + its seeded-negative-control lane at the tail). Case `t41` lives at line 394 — inside the prefix — so it was ALREADY in the revision my verdict names, and my own arithmetic confirms it: **7 tests then + t37's 1 = 8 tests now** (79 expects), with the file census unchanged at 15/39.

## What stands, corrected

* **ONE writer** for that file in this window: **t37** (completed, lane A) — additive, tail-only, and itself an instrument for the same inverted guarantee my revert proves.
* Everything else in `POST-VERDICT-MOVEMENT.md` stands unchanged: `lib/tools.js` 6021bf6dfce594ed, `lib/mpd-deltas.js` 6dce6f1f3598c77b, `agent-references/agent-teams-deltas.md` 8716eaf51b0e32b8 — all SAME; the re-verification readings (five states, all four clause checks OK; both T-19 cases plus t37's lane green; the frame assertion at line 170 verified) are unaffected by this correction.
* The captain's disposition is accepted: no new review task is needed for the new revision — the change is additive-only over a byte-identical prefix, my instruments were re-run on the current bytes, and the only new content is another instrument for the same guarantee. This correction exists so a later reader does not infer two writers (or new assertions) where there is one addition.
