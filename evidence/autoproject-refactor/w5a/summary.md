# W5-A — retire the old ulw surface in every human-facing doc (bilingual, RENAME-ONLY)

Lane: Senior Engineer (board row T27), this wave's SINGLE SKILLS WRITER. Contract:
`.mpd/plans/autoproject-refactor.md` §4.1 + §7. This is the RENAME half of W5: old spellings retired,
behaviour prose left for the later engine-description task.

## 1. What was renamed (one table, applied uniformly)

| retired | replacement |
|---|---|
| `mpd_ulw`, `mpd_ultrawork` | `mpd_autoproject` |
| `/ulw`, `/ultrawork` | `/autoproject` |
| `.mpd/ulw` | `.mpd/autoproject` |
| `ulw.maxRounds` / `ulw.planDir` / `ulw.*` | `autoproject.*` |
| `mpd-ulw-plugin`, `mpd-boulder-plugin` | `mpd-autoproject-plugin` |
| `mpd-ulw`, `mpd-boulder` (patch ROW ids / knob owners) | `mpd-autoproject` |
| `ULW_ACTIVATION_DIRECTIVE` | `AUTOPROJECT_ACTIVATION_DIRECTIVE` |
| `ULW`, `ultrawork` in prose (incl. zh `ULW 循环`) | `autoproject` |
| `ulw-loop.svg` | `autoproject-loop.svg` (file RENAMED; both references updated) |

Boulder as a SUBSYSTEM keeps its name and its `mpd_boulder_*` tools; only the separate PACKAGE and ROW
are gone, so `boulder` prose stays and only `mpd-boulder-plugin` / `mpd-boulder` moved.

## 2. Two-to-one collapses repaired by hand (the mechanical sweep could only produce noise here)

The old surface had TWO commands and TWO tools; the new one has ONE of each, so every place that named a
PAIR had to become singular — this was re-read, not merely substituted:

1. `AGENTS.md` §1 — "answers `/autoproject` and `/autoproject`" → **one** `/autoproject` (also the item
   the Lead flagged; re-read for sense).
2. `docs/user-guide.md` §12 + twin — "the **seven** commands this bundle contributes" → **six**, the
   duplicated `/autoproject` row collapsed into ONE row, and the "identical to /autoproject (both
   submit…)" sentence deleted.
3. `docs/user-guide.md` §13.2 + twin — "`mpd_autoproject` is the light alias … ; `mpd_autoproject` runs
   the full discipline" → ONE tool whose `tier` picks the shape (`light` / `heavy`).
4. `docs/user-guide.md` §11 tool table + twin — the `mpd_autoproject` (light) / `mpd_autoproject` (full)
   pair → one tool with the two tiers.
5. `docs/feature-audit.md` + twin — "the seven this bundle contributes … the autoproject pair
   `/autoproject` + `/autoproject`" → **six**, one command; "(`mpd_autoproject`, `mpd_autoproject` light
   alias)" → "ONE tool, whose `tier` picks the shape".
6. `docs/design.md` + twin — the plugin row's duplicated tool/command pair → `mpd_autoproject`,
   `mpd_boulder_*`; command `/autoproject`.
7. `docs/tui.md` + twin — "ulw loop discipline | … tools `mpd_autoproject`, `mpd_autoproject`" →
   "autoproject loop discipline + the merged boulder ledger | tools `mpd_autoproject`, `mpd_boulder_*`".
8. `packages/mpd-autoproject-plugin/README.md` + twin — the "lightweight compatibility alias" sentence
   (false: there is no alias) and the duplicated `/autoproject` command bullets → one command, one tool.

Heading anchors followed the headings: `#132-the-ulw-loop-and-its-gates` →
`#132-the-autoproject-loop-and-its-gates`, and the zh `#132-ulw-循环与它的关卡` → `#132-autoproject-循环与它的关卡`.

## 3. Assets

- `docs/assets/images/ulw-loop.svg` → **`autoproject-loop.svg`**: title/desc/h1/entry/step/state-root
  labels rewritten to the new surface, and the entry line's "… the two commands are equivalent" replaced
  by "one command, one engine". The trailing note was nudged from `x=466` to `x=530` so the LONGER state
  path (`.mpd/autoproject`) does not collide with it.
- `docs/assets/images/architecture.svg`: the host-row chip now reads `adapter · roles · autoproject`
  (dropping `boulder` from THAT 196px chip keeps the label inside its box; boulder stays named in the
  state-roots line beside it), and the state line reads `settings · memory · boulder · autoproject · plans`.

## 4. Bilingual parity

Every EN edit is mirrored in its `*.zh-CN.md` twin in this same change; every switch link stays directly
under the title. `bun run verify:docs` (which polices the pair, the switch link and the heading tree)
PASSES with 54 pairs.

## 5. Observed results

| command | result |
|---|---|
| `bun run verify:docs` | **exit 0** — `pairs=54 failed=0 violations=0 exempt=24 derived=3 links=505 dead=0 — PASS` (the renamed SVG resolves from both index files) |
| `node scripts/verify-manual-paths.ts` | **exit 0** — `PASS resolved=153 over-report=73 under-report=82 declared=2` |
| `wc -c AGENTS.md` | **63,136 → 63,167** (+31, the rename's own byte delta); margin **2,369 B** ≥ 2,048 under 65,536 ✓ and ≤ 63,500 ✓ |
| residue grep (policed band) | **ZERO** retired spellings — `residue-grep.log` |

Files touched — **39**:
- root: `README.md` + `README.zh-CN.md` (2)
- `docs/`: `index`, `user-guide`, `design`, `feature-audit`, `independence`, `tui`, `upstream-parity-ledger` — every one in BOTH languages (14)
- `docs/assets/images/`: `autoproject-loop.svg` (renamed + relabelled), `architecture.svg` (2)
- `packages/`: `mpd-autoproject-plugin`, `mpd-bundle-plugin`, `mpd-bundle`, `mpd-config-plugin`, `mpd-goal-plugin`, `mpd-schemastery`, `mpd-tui-plugin` READMEs, BOTH languages (14)
- `agent-references/`: `overview-and-provenance`, `plugin-authoring`, `repository-layout`, `qa-discipline`, `verification-flow`, `index` (6)
- `AGENTS.md` (§1 GOAL bullet + §6 state-root override list) (1)

## 6. DECLINED — process records whose historical wording stays

| file | reason |
|---|---|
| `docs/bline-report.md`, `docs/omo-parity-gap.md`, `docs/review-p0-p3.md`, `docs/track-a-report.md`, `docs/tui-edition-report.md`, `docs/ulw-deepseek-optimization.md` | prior-phase reports — AGENTS.md §3 exempt list; their wording describes what WAS true then |
| `docs/decisions.md` | the plan/decision file (§3 exempt) |
| `docs/plan-0.1.7-adaptation.md`, `docs/plan-c.md`, `docs/plan-e.md`, `docs/plan-f.md` | the declared `docs/plan-*.md` class (§3) |

Three PROTECTED occurrences remain in the policed band and are NOT the retired surface:
`skills/ulw-research/scripts/*.mjs` (a skill-corpus PATH — the corpus is still named that and is not this
lane), `docs/ulw-deepseek-optimization.md` (the DECLINED report's FILENAME in AGENTS.md's exempt list),
and `mass-ulw` / `massUlw` (an UPSTREAM capability name in `docs/upstream-parity-ledger.md`).

## 7. Handed to the engine-description task (NOT rewritten here)

These are BEHAVIOUR claims the rename did not touch, and they are stale — deliberately left per the
contract ("do NOT rewrite behaviour prose"):

1. `packages/mpd-autoproject-plugin/README.md` + twin — the section "Autonomy policy … An activated
   autoproject run asks the user nothing:" and its numbered clauses still describe the RETIRED blanket
   policy; the shipped directive now stops at three decision points.
2. `docs/user-guide.md` §13.2 + twin — "An activated run asks you nothing: it triages first, stages its
   own team…" (same retirement).
3. `docs/user-guide.md` §13.10 and the README goal bullet still describe a "heavy autoproject run" in the
   goal-anchoring context — accurate, but it now anchors through the boulder ledger as well.

## 8. What I could not prove

- No gate checks DOC PROSE for truth: `verify:docs` proves the PAIR and the LINKS, not that a sentence
  still matches the code. The residue grep is the mechanical proof for the spellings; the behaviour
  claims in §7 are verified by reading only.
- `CHANGELOG.md`, `.mpd/readme-ref/**` and `dist/mpd-package/**` were NOT touched (outside the T27 bands;
  the packed copy is regenerated by the integration pack).
