# Review CR-docs2 — the T26 de-duplication of the third-boot wording (CR-F1 Nit)

**Row:** T27 (board), re-review of `T26`. **Writer:** `se-cellwork` (`99a0e207…`).
**Loop:** `loop-20261103T081429-a906e2` (T26). **Contract:** the T25 review's Nit
(`evidence/cellwork/vedit-p0/followup/review-cr-docs/REPORT.md` §6, CR-F1); `AGENTS.md` §4/§7.

**Tree judged** — pinned **08:16:58Z**, re-hashed **08:18:08Z**, IDENTICAL (`gates/00-scope-start.sha256`,
`gates/30-scope-end.sha256`): `SKILL.md` `a3777a82…` (was `f9392347…` after T23), `tui-admission.ts`
`2d39c5c5…` (UNCHANGED since T23), `surface-pin.ts` `0d883365…` (UNCHANGED), contract `3e12b6f3…`
(UNCHANGED). The delta was measured against a REBUILT T23 image (rebuilt hash `f9392347…` = the T23 hash):
**ONE hunk, ONE line** — the `tui-admission` row.

**Verdict: PASS.** **Risk level: LOW.** **Zero findings.** Nothing is repaired by this seat.

## 1. Assessment

The Nit is closed properly and nothing factual slipped out with the duplicated words. The row now explains the
third boot exactly once: the STATIC half says the shipped decision "must stay `compatible` with NO grant AND
with that row granted **(the with-grant half is re-checked on the THIRD LIVE BOOT — see LIVE (3))**", and LIVE
item (3) carries the mechanism — the clone's row staged in the grants file BEFORE the boot, ONE
`/plugin check` of the shipped manifest, `compatible` with EXACTLY ONE decision line, so a swallowed step
leaves zero and reddens — and it now carries the REASON too ("a stray grant cannot flip a permission-less
manifest"), which the static clause used to hold. Counted in the row: "EXACTLY ONE decision line" 1,
"BEFORE the boot" 1, "swallowed step" 1, "stray grant" 1, and **"measured twice" 0**. Nothing else moved: the
`tui-admission.ts` hash is unchanged, the row still has 5 pipes, and `surface-pin`'s live case — which asserts
this very case-table row — passes.

## 2. Criteria

| # | criterion | verdict | evidence |
|---|---|---|---|
| 1 | the third boot is explained ONCE; STATIC carries a short pointer, LIVE (3) holds the mechanism | **PASS** | the row's counts: `EXACTLY ONE decision line` **1**, `BEFORE the boot` **1**, `swallowed step` **1** (was 2 each); STATIC half now reads "(the with-grant half is re-checked on the THIRD LIVE BOOT — see LIVE (3))" |
| 2 | nothing factual lost | **PASS** | all present: "must stay `compatible` with NO grant AND with that row granted"; the clone's three states (`waiting_authorization` / `compatible` / `waiting_authorization`) + the revocation clause; arm3 `CONDITIONAL` recorded as the string `inapplicable` and "never reports that arm as a pass"; the `structuredClone` static control; the `stray grant` reason (moved, not dropped) |
| 3 | the row still parses as a 5-pipe table row | **PASS** | `|` count = **5**; `surface-pin` **live PASS** (it asserts the case-table row) and its **self-test exit 0** (EIGHT controls incl. the row) |
| 4 | `measured twice` is gone | **PASS** | occurrences in the row: **0**; and no stale `two`/`TWO`/`twice` anywhere in it |
| 5 | numbering is unambiguous | **PASS** | the row's LIVE list is (1)(2)(3) and the pointer names (3) — the only `(3)` before the list is the pointer itself |
| 6 | gates stay green | **PASS** | `comments` `ev-20261103T081708-639983` (0), `tests` `ev-20261103T081711-f55b92` (0 — whole `bun test packages`), `test:qa` 0, `surface-pin` live 0 + self-test 0, `tui-admission --self-test` 0 |
| 7 | scope | **PASS** | `SKILL.md` only (`tui-admission.ts` unchanged at `2d39c5c5…`); the other modified paths are lane B's; `VENDOR_LOCK.json` untouched; no git write |
| 8 | the expected red | **PASS** | `verify-vendor` exit 1, ONE reason: `asset skills treeSha mismatch` (the captain's second re-pin) |

## 3. Declined to judge

- The STATIC sentence says the with-grant half is "**re-checked** on the THIRD LIVE BOOT". I read that as:
  asserted statically in the same sentence ("with NO grant AND with that row granted"), re-checked live in
  boot 3 — which is exactly what the code does (`grants.manifestGranted` from a direct `negotiate`, plus the
  phase-C boot). Correct as written; not scored.
- The live case was not re-run for a single-row prose edit (the writer says so). The executable surface is
  re-proved by `tests`/`test:qa`/`surface-pin`/`--self-test`, and the lane's behaviour cannot depend on a
  Markdown row. Declined.
- The row's remaining length — it is a dense case-table cell; that is the file's established shape (its
  neighbours are equally dense). Declined.

## 4. Bounds

- Documentation only; no lane re-run (see above). `surface-pin`'s live case IS the mechanical link between this
  row and the case, and it passed.
- No repository file was written by this seat; the scratch tree lived under the gitignored
  `.mpd/recon/qa/rev-crd2/` and was deleted.

## 5. Evidence in this directory

```
00-criteria.md                     the captain's criteria (from the T27 brief)
gates/00-scope-start.sha256 · 30-scope-end.sha256   identical (08:16:58Z → 08:18:08Z)
gates/10-diff-t23-to-now-skill.diff   ONE hunk, ONE line (the row); T23 image rebuilt to f9392347…
gates/20-gates.log                 test:qa 0, surface-pin live 0, surface-pin self-test 0, tui self-test 0
gates/21-vendor-expected-red.log   exit 1 — ONLY the skills treeSha
```
