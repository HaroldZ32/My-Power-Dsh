# t29 evidence — byte verification of the t27 repairs + the `/mpd` commands-service disclosure

Task `t29` (repair, round 3) was dispatched as a **verification-first** repair: t27 had already
landed the documentation repair, so the contract asked for verification against the bytes, not a
re-edit, plus one carry-over from t28 (`T28-MANIFEST-1`, low).

| File | What it shows |
|---|---|
| `doc-assertion-t29.mjs` / `doc-assertion.json` | 13 checks re-derived from the files on disk: the frozen anchors are unmoved (manifest `84ed4a5d…`, entry `5dce2563…`), the `tuiRenderers` disclosure and its softened assertions exist in **both** languages with both citations and the honest limits, no superseded `710d3eef` is inline, the §11 binding points at the delivered digests plus the t8/t9 lane evidence with no "panels pending" row, the chain is recorded as history in `REVISION-BINDING.md`, the `/mpd` commands-service rationale is present in `docs/tui.md`, and the switch links / R8 keys / wording guards hold. |
| `zh-6.4-snippet.md` | The ready-to-paste Chinese mirror of the new §6.4 and its §4.1 pointer, for the one open gap below. |
| `result.json` | Disposition, anchors, doc digests, gates and the block `t14` must carry. |
| `typecheck.log`, `rows-parity.log`, `preset-conformance.log` | The three contract verify commands verbatim. |

## Disposition

- **Item 1 (tuiRenderers NOT-CLAIMED + softening)** — already satisfied by t27; verified against the
  bytes at `docs/tui.md` `1afda0fd…` / `docs/tui.zh-CN.md` `6e7a61a9…`. Not re-edited.
- **Item 2 (revision binding)** — already satisfied by t27; verified (both docs, delivered digests,
  delivered lane evidence per row, zero inline `710d3eef`). Not re-edited.
- **Item 3 (`/mpd` command vs manifest rationale)** — **not** satisfied on disk when t29 started:
  neither doc mentioned the harness `commands` service. `dsh-plugin.json` was **not** edited (its
  digest is the frozen anchor for t9/t12/t13); the rationale is now sharpened docs-side in
  `docs/tui.md` §6.4, citing `src/commands.ts:53-60`, the `commands.dsh/v1alpha1` contract, the
  `commands.invoke` registry permission, `contributes.commands: []`'s truthfulness, the
  `undeclared` ledger consequence and t12's disposition (`evidence/tui/review/t12/REVIEW.md:62`).

## Open gap (disclosed, not hidden)

`docs/tui.zh-CN.md` does **not** yet carry the §6.4 mirror. It is not in t29's declared inScope
(`dsh-plugin.json`, `packages/mpd-bundle/cordis.patch.yml`, `presets/`, `evidence/tui/composition/`,
`scripts/install-profile.mjs`, `docs/tui.md`) and the dispatch instruction is to work only in-scope
paths, so the mirror was prepared rather than written. Paste `zh-6.4-snippet.md`, or amend the
inScope and re-dispatch one bilingual pass.
