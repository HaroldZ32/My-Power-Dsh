# C5 packaged/checkout standing coverage — local evidence (gitignored scratch)

Branch `fix/dshgo-1.0.14-repin`, HEAD `e8a658f7`.
Only file changed: `scripts/verify-dshgo-standard.ts` (+90 lines, 0 deletions).
Arm count unchanged: 46.

## Fold

`assertPinModeSplit()` is called from the EXISTING C5 disagreement arm's `probe`
(`C5 PIN: one perturbed site disagreeing with the seven others`), so no new arm exists.
It asserts, all in memory except one `mkdtemp` probe:

1. readings with the two workflow sites absent, `auditPin(..., false)` → 0 errors,
   exactly 2 `pin-site-skipped` notes on the two workflow paths, `skipped === 2`.
2. the same readings, `auditPin(..., true)` → exactly 2 `pin-site-missing` errors on the
   two workflow paths, `skipped === 0`.
3. `isCheckout(<mkdtemp>/worktree)` with `.git` as a FILE → true;
   `isCheckout(<mkdtemp>/shipped)` with no `.git` → false.
4. one PRESENT but pinless site, packaged mode → exactly one `pin-site-missing` error,
   `skipped === 0` (absence-of-file ≠ absence-of-pin).

## Mutation proofs (copies at `.qa-tmp/c5-mutant-{a,b,c}.ts`, logs beside this file)

(a) `findings.push(checkout` → `findings.push(false)` (absence → NOTE in BOTH modes)
    node .qa-tmp/c5-mutant-a.ts --self-test → EXIT 1
    FAIL  C5 PIN: one perturbed site disagreeing with the seven others — the arm itself threw:
      C5 checkout mode: an absent pin site must produce exactly TWO pin-site-missing errors and
      skipped === 0, got 0 error(s) and skipped 2

(b) `findings.push(checkout` → `findings.push(true)` (absence → ERROR in BOTH modes)
    node .qa-tmp/c5-mutant-b.ts --self-test → EXIT 1
    FAIL  C5 PIN: one perturbed site disagreeing with the seven others — the arm itself threw:
      C5 packaged mode: a packaged tree must report ZERO errors for the absent workflow sites,
      got pin-site-missing@.github/workflows/publish.yml, pin-site-missing@.github/workflows/gates.yml

(c) `return existsSync(join(root, ".git"))` → `return true`
    node .qa-tmp/c5-mutant-c.ts --self-test → EXIT 1
    FAIL  C5 PIN: one perturbed site disagreeing with the seven others — the arm itself threw:
      C5 isCheckout: a directory with no `.git` must read as a packaged tree

## Final gates (logs here)

- `node scripts/verify-dshgo-standard.ts --self-test` → EXIT 0,
  `SELF-TEST PASS — 46 arms (1 clean control + 45 negative controls)`
- `MPD_DSHGO_KIT=$PWD/.mpd/recon/dsh-go node scripts/verify-dshgo-standard.ts` → EXIT 0,
  `PIN: PASS — 8 of 8 site readings agree on f36bf91b0736e81ef40c2a7040b2ec337ca1ab40`
- `env -u MPD_DSHGO_KIT node scripts/verify-dshgo-standard.ts` → EXIT 3 (NOT-PASSED)
- `bun run typecheck` → EXIT 0
- `node scripts/verify-comment-coverage.ts` → EXIT 0, VERDICT PASS
- `git diff --name-only` → `scripts/verify-dshgo-standard.ts` only

## Final file sha256

c69585a91269aa10c8cf0336e4e84413e444fff67fc92de41ff00fdd85d99209  scripts/verify-dshgo-standard.ts

## Bounds

- The `.git`-FILE (worktree) shape is proven only through `isCheckout` on a temp dir; no real
  worktree install was audited in this pass.
- The mutation proofs ran the self-test only; the full gate was not re-run on the mutants.
