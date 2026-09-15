# t27 evidence — tuiRenderers disclosure + revision binding (docs, both languages)

Task `t27` (repair, round 2) carried t13's findings T13-DOCS-1/T13-DOCS-2 into the bilingual TUI
docs. This directory is its evidence; no git write was performed.

| File | What it proves |
|---|---|
| `doc-assertion.json` / `doc-assertion.mjs` | The documentation assertion (28 checks). It fails if either language lacks the `tuiRenderers` disclosure (surface named, `"tuiRenderers": false` from the lane result, `T8-LIVE-VERIFY.md:19`, the 6-of-7 statement, the H1/H2 limit), still contains the superseded digest `710d3eef`, lacks the delivered digest `5dce2563` or the manifest digest `84ed4a5d`, does not point at the revision-binding note, still calls the panels lane pending, or regresses the switch link, the R8 NOT-CLAIMED keys, the forbidden wording or the required vocabulary. |
| `result.json` | The deliverable digests, the revision binding, the per-file edit list and the block `t14` must carry into the delivery report. |
| `typecheck.log`, `rows-parity.log`, `preset-conformance.log` | The three contract verify commands, verbatim with exit codes. |
| `citations-check.log` | Every `evidence/...` path cited by either doc exists (10 paths, 0 missing). |
| `doc-assertion.err` | Empty; kept so an unexpected stderr cannot hide. |

Delivered revision and chain: `evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md`.

Note on the `710d3eef` exclusion: the intermediate digest is deliberately **not** repeated inline in
either doc (the assertion forbids it, because an inline intermediate digest is how a reader gets sent
to a superseded artifact). The full three-step chain `695f68c4 → 710d3eef → 5dce2563` is named, as
history, in the revision-binding note that both docs point at, and in `result.json`.
