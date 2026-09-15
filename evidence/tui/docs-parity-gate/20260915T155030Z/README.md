# t60 evidence — the doc-pair parity gate

Task `t60` promoted the docs-task prototype
(`evidence/tui/docs-completeness/20260915T153835Z/docs-parity.mjs`) into a repo gate. No git writes.

| File | What it shows |
|---|---|
| `output.log` | The full run: `--self-test` (7/7), `bun run verify:docs` on the real tree (33 pairs, 0 failed, 15 exempt), `bun run typecheck`, `tui-spec-conformance --self-test`, plus the CLI-level negative control and the npm-script exit-code propagation. |
| `result.json` | Verdict, the census, the exemption list and policy, the findings, the wiring, the gate exits and the negative controls. |
| `negative-cli/` | The deliberately broken fixture (`docs/alpha.md` + a zh twin with no switch link) the CLI negative control points `--root` at. |

## What the gate enforces (per bilingual pair)

1. both files exist; 2. a switch link sits directly under the title and points at the twin;
3. the heading tree (levels + order, fenced code excluded) is identical; 4. the zh-CN file carries
real CJK content (a copy-paste of the English file fails).

## Exemptions (documented in the script, printed by every run, asserted by the self-test)

Adopted upstream `mpd-agent-teams-plugin/README.md`; `packages/mpd-mcp-shared` (no README);
process records `docs/plan-*.md` + `docs/decisions.md`; prior-phase reports (`bline-report`,
`omo-parity-gap`, `review-p0-p3`, `track-a-report`, `ulw-deepseek-optimization`); internal
QA/golden docs (`adder4`, `cnt8`). An exemption suppresses only the missing-twin rule — an exempt
file that gains a zh-CN twin is checked like any other pair.

## Findings on the untouched tree

- **T60-F1 (low)** `docs/tui-edition-report.md` has no zh twin; it is a prior-phase report, the
  class AGENTS.md §3 exempts, but it is not named in that enumeration. Reported by the gate with its
  reason; no translation was authored (that is authoring, not a mechanical repair).
- **T60-F2 (info)** the first census run reported `packages/node_modules` as a package without a
  README; the scanner now skips `node_modules`/dot-directories.

**No mechanical repairs were needed**: the untouched tree passes 33/33, so this task changed no
documentation content.
