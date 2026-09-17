# DEFECT — §6's landed t60 sentence conflates two counting conventions (26/24 are DIFF LINES, not path comments)
# docs-gate-engineer · 2026-09-17T03:45Z · server: spot-check of platform-engineer's `line-diff-addendum.json`
# SCOPE: read-only measurement. Temp outfiles only — nothing under `packages/**` was written.
# FOUND BY: verifying the addendum's mpd-tools figure myself instead of folding it into the report.

## WHAT IS IN THE MANUAL NOW (AGENTS.md §6, landed by t60)
  "… `bun build` writes EVERY bundled module's path RELATIVE TO CWD into the artifact's path
   comments — 26 of them in the `mpd-ext-plugin` build (measured; 24 remain after dropping the
   first), not one banner line — and `node scripts/verify-dist-fresh.mjs` reproduces THESE bytes …"

## WHAT IS TRUE (two builds per package, repo-root form vs package-directory form, temp outfiles)
$ bun build packages/<pkg>/src/index.ts --target node --format esm --outfile <tmp>/root.js      # from the repo root
$ (cd packages/<pkg> && bun build src/index.ts --target node --format esm --outfile <tmp>/pkg.js)  # package-dir trap

mpd-ext-plugin:
  root f6097fd3383f2fa7… 152,855 B   pkg a7b843e19656dbe9… 152,579 B   (== the recorded round-trip pair)
  DIFFERING SOURCE LINES (positions)      : 13      after dropping line 1: 12
  diff `<`/`>` OUTPUT lines (the 2× convention) : 26      after dropping the first pair: 24
  non-path-comment differences            : 0
  `// ` comment lines in each artifact    : 13   (entry banner + 12 inlined-module comments)
mpd-tools-plugin:
  DIFFERING SOURCE LINES                  : 3       after dropping line 1: 2
  diff `<`/`>` OUTPUT lines               : 6       after dropping the first pair: 4
  non-path-comment differences            : 0
  size delta                              : −58 B   (matches the addendum byte-for-byte)

⇒ "26 differing lines / 24 after the first" is the **diff-output-line** convention (each differing
  source line contributes one `<` and one `>`). The number of PATH COMMENTS is **13 / 12**, and the
  artifact's own text confirms it (13 `// ` lines). The addendum's "6 / 4" for mpd-tools is the same
  convention artifact (true positions: 3 / 2).
⇒ So the landed sentence OVERSTATES the comment count by exactly 2×, and a reader who counts `// `
  lines in the artifact gets 13 — the same class of error the wave exists to kill (a number that is
  not the thing it names). The rest of the sentence is sound: "not one banner line", the
  foreclosure of banner normalization, the canonical command, the residual and the §4 pointer are
  all correct and unchanged.

## INDEPENDENT CROSS-CHECK THAT THE MEASUREMENT ITSELF IS SOUND
  the root-form artifact reproduced the committed bytes exactly: f6097fd3383f2fa75bc54621c5082ccb5b3192f63c286debd2f96ed8f5428e0a / 152,855 B
  (same pair as evidence/gates/build-form/20260917T032000Z/round-trip.log → the two forms are the
  only variable; the counting convention was the defect, not the builds)

## PROPOSED MINIMAL FIX (one clause; words only; numbers re-measured at edit time per T-55)
  "- **Build — from the REPO ROOT, with path-qualified args**: … This is the CANONICAL form: `bun
   build` writes EVERY bundled module's path RELATIVE TO CWD into the artifact's path comments — the
   entry banner plus one comment per inlined module (13 such comment lines in the `mpd-ext-plugin`
   build, 12 of them after the entry line; measured) — and `node scripts/verify-dist-fresh.mjs`
   reproduces THESE bytes, so normalizing a banner cannot reconcile the two forms: …"
  (the structural clause "the entry banner plus one comment per inlined module" makes the count
  portable — mpd-tools is 3/2 — and leaves no room for the normalization remedy without quoting any
  diff convention at all)

## RE-MEASUREMENT THE FIX NEEDS (cheap, all read-only)
  sha256sum AGENTS.md · bun evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs current=AGENTS.md
  · bun run verify:docs · node scripts/verify-rows-parity.mjs · and the reverse-substitution identity
  check against the CURRENT pre-edit sha so the new diff stays provably one hunk, words only.

## BOUND
  measured on two packages (the largest and one of the smallest divergences), same convention applied
  to both; the classification (every difference a `// <module path>` comment, zero code lines) is
  from the full line-by-line comparison, not a sample.
