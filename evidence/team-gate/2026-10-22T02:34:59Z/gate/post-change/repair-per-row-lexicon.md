# R1 repair 4 — `normal` reproduces the PRE-WAVE predicate (per-row lexicons) — 2026-10-22

The frozen contract says `normal` reproduces the pre-wave behaviour EXACTLY. Thresholds already did;
the shared expanded lexicon did NOT (a text whose only deliverable verbs were wave additions moved
`normal` verdicts — e.g. `latest` counting toward `test`). Fixed in the implementation, not the
contract.

## Implementation (`packages/mpd-roles-plugin/src/complexity-gate.ts`)

- NEW `GateLexiconName = "pre-wave" | "expanded"`, and every `SensitivityThresholds` row now carries
  a `lexicon` selector: `easy`/`strict` → `expanded`, `normal` → `pre-wave`.
- NEW frozen vocabulary, exactly the pre-2026-10-22 sets:
  - `PRE_WAVE_DELIVERABLE_VERB_PATTERN`: the original 8 English (`align|migrate|refactor|audit|
    overhaul|port|rewrite|consolidate`) + the original 24 CJK verbs.
  - `PRE_WAVE_ACTION_VERB_PATTERN`: the original 14 English (`add|align|audit|build|change|check|
    consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify`) + the same 24 CJK verbs.
  - `PRE_WAVE_CLAUSE_ACTION_PATTERN`: the C3 twin of that set.
- The shipped expanded patterns keep their names/contents (`easy`/`strict`); `GateLexicon`,
  `PRE_WAVE_LEXICON`, `EXPANDED_LEXICON`, `GATE_LEXICONS` select a row's three patterns TOGETHER, and
  `evaluateComplexityGate` reads `GATE_LEXICONS[thresholds.lexicon]` for B, C2, C3 and E's verb
  conjunct. `clauseStepCount(text, pattern)` now takes the row's opener pattern.
- Signal F stays easy-only; every threshold number is unchanged.

## Measured consequences (the point of the change)

| text | easy | normal |
|---|---|---|
| `please fix create update and rename the helpers` (4 WAVE-ONLY EN verbs) | `["B"]` | `{trigger:false}` |
| `align, migrate, refactor and audit the module` (PRE-WAVE 4) | `["B","C"]` | `["B","C"]` |
| `修复并验证` (CJK verbs present pre-wave; 2 distinct < 4) | `["B"]` | `{trigger:false}` |
| the user's verbatim first message (77 Han, all verbs are wave additions) | `["B","E"]` | `{trigger:false}` — the measured PRE-CHANGE verdict |
| `Check the tests, build the package, verify the output.` | `["B","C"]` | `["C"]` (the pre-wave predicate) |

## Tests updated (intent updates, not hacks)

- `packages/mpd-roles-plugin/test/team-plane.test.ts`: the threshold-table arm carries `lexicon`; the
  user-message arm now asserts easy = B/E and normal = the PRE-CHANGE `{trigger:false, signals:[]}`;
  NEW arm pins the divergence in both directions (wave-only verbs fire B at easy and are invisible at
  normal; the pre-wave four still fire B at normal; `latest` → `test` only on the expanded row).
  The three wiring arms written against the 4-verb prompt are back to `signals=C` at `normal`, which
  is exactly the pre-wave verdict.
- `skills/dsh-qa/scripts/session-start-team.ts`: its restated row carries `lexicon`; the
  user-first-message arm is easy-only plus a normal-silent (pre-change reproduction) assertion; NEW
  per-row-lexicon contract arm mirroring the unit test; the self-test summary states the per-row
  lexicon.
- `packages/mpd-roles-plugin/README.md` + `README.zh-CN.md`: the sensitivity paragraph now says
  `normal` reproduces the pre-wave PREDICATE — the same numbers AND the pre-wave verb lexicons.

## Observed results (quoted)

$ bun test packages/mpd-roles-plugin
  169 pass
  1 fail
  1364 expect() calls
  Ran 170 tests across 9 files.
  (fail) F1 shipped artifact > the committed dist is the byte-identical product of a canonical build
  — EXPECTED: dist was not rebuilt (the captain rebuilds and amends the commit). Every source/test
  arm is green.

$ bun test packages/mpd-ulw-plugin
  26 pass
  0 fail
  230 expect() calls
  Ran 26 tests across 2 files.

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

$ bun run verify:comments
  VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.

$ bun run verify:docs
  [verify-docs-parity] pairs=49 failed=0 violations=0 links=440 dead=0 — PASS

$ node skills/dsh-qa/scripts/session-start-team.ts --self-test
  exit 0 (corpus table + rows + per-row lexicon + F both ways).

`dist/` NOT rebuilt, as instructed. `AGENTS.md` and `docs/**` not touched (docs lane).
