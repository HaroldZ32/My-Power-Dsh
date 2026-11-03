# N6 — 0.17.2 carriers + release docs (release/v0.17.2)

- Wave: 0.17.2 team · row **T6** (lane: docs) · owner `je-docs` (Junior Engineer)
- Branch: `release/v0.17.2`, from `dev` at `6f203dea` (includes both follow-up commits). No git write by
  this seat — the captain commits; the working-tree diff below is the whole change.
- Scope written: `package.json`, `dsh-plugin.json`, `dsh-distribution.json`, `README.md`,
  `README.zh-CN.md`, `AGENTS.md`, `CHANGELOG.md`, `packages/mpd-team-core-plugin/README.md`,
  `packages/mpd-team-core-plugin/README.zh-CN.md`, this evidence subtree. No src/test/dist/skills.

## 1. Carriers — all three at 0.17.2

| carrier | change |
|---|---|
| `package.json` | `version` 0.17.1 → 0.17.2 (the only literal in the file) |
| `dsh-plugin.json` | `version` 0.17.1 → 0.17.2, plus the `x-mpd-tui-surfaces.note` self-description ("version 0.17.1") → 0.17.2 |
| `dsh-distribution.json` | `distribution.version` 0.17.1 → 0.17.2 AND all SIX self-urn refs (`bundle`, `plugins`, `mcp-servers`, `skills-corpus`, `web-client`, `tui-edition`) → `@0.17.2` |

Observed: `0.17.2` occurs 1 / 2 / 7 times respectively (7 = version + 6 refs), and no `0.17.1` literal is
left in any carrier (`grep` exit 1). `verify:manifest` independently confirms the coherence:
`version:dsh-plugin.json: version = 0.17.2`, `version:dsh-distribution.json: distribution.version =
0.17.2`, `component-ref-version: 6 self-urn ref(s) compared against distribution.version 0.17.2, 0 stale`.

## 2. Release docs

- `README.md` / `README.zh-CN.md`: version badge → `0.17.2`; a new top table row
  `0.17.2 | 0.2.1-rc.5 | 0.18.0 | the current release` (zh: `本次发布`); the `0.17.1` row demoted
  (EN `previous`, zh `上一版本` — and the zh `0.17.0` row moved to the literal `` `previous` `` so the
  "immediately previous" label follows the table instead of appearing twice); the notes paragraph
  ("The newest row **is** that pair") and the Changelog current-release line → `0.17.2` / **v0.17.2**.
- `AGENTS.md` §8 install line: `dsh plugin --profile web add @mpd-dsh/mpd@0.17.1` →
  `@mpd-dsh/mpd@0.17.2` (one line; the surrounding paragraph is untouched).
- `CHANGELOG.md`: a new RELEASED section `## 0.17.2 — the follow-up wave and the team-end verb` inserted
  ABOVE 0.17.1 and 0.17.1 left byte-intact. It covers, in this order: the supersede sentence (0.17.1's npm
  stage was never approved, nothing was public, `latest` never moved); the `tui-admission` real/static
  grant-arm fix (clone technique, three boots, `attributionArmsApplicable` and the recorded `"inapplicable"`,
  the registration/attribution bound stated not claimed); the `dual-track-smoke` deepseek case fix
  (`llm-pi-ai` block staged, session-log tool evidence instead of a stdout regex, both tracks PASS); the
  new `agent_teams_control {action:"end"}` verb (store-mediated stamping, record kept as history, repeated
  `end` a reported no-op); the identity-plane narrowing (role first, then stored name, LONGEST match, the
  equal-length tie picks no seat); the two CodeRabbit round-1 fixes (endTeam journal containment, the
  recorded-Lead title exclusion with the fork-bound clause); the lane-A/lane-B test arms (seven Nits, none
  weakened, red-first log not rewritten); and the pack-closure `ROOT_FILES` byte checks.
- `packages/mpd-team-core-plugin/README.md` + `.zh-CN.md` (bilingual pair, switch links untouched):
  the control table row gained `fence`, `unfence`, `end`; the "A halt is not an ending" section became
  "A halt is not an ending; `end` is." with the `endTeamRecord`/`writeTeam` terminal-verb text; the intro
  sentence now lists "a halt, an end, and an archive"; the caller shape gained `title?` in both the prose
  sentence and the explicit `{ workspace, sessionId, lineage, title?, agent?, signal? }`; and two new
  bullets carry the identity plane — the `memberIdentityOf` narrowing (role first, then stored name,
  longest match) and the recorded-Lead/fork-bound paragraph — verbatim from
  `evidence/cellwork/vedit-p0/followup/identity-plane/repair/REPORT.md` and
  `.../codereview/fork-bound/REPORT.md`.

## 3. Gates (quoted exits; full logs beside this file)

| command | observed |
|---|---|
| `bun run verify:docs` | `pairs=55 failed=0 violations=0 exempt=24 derived=3 links=500 dead=0 — PASS` — **exit 0** (`01-verify-docs.log`) |
| `bun run verify:manifest` | `version:dsh-plugin.json: version = 0.17.2`, `version:dsh-distribution.json: distribution.version = 0.17.2`, `component-ref-version: 6 self-urn ref(s) … 0 stale`, `packed-content: npm pack --dry-run lists 1219 file(s)`, `VERDICT: PASS` — **exit 0** (`02-verify-manifest.log`) |
| `node scripts/verify-manual-paths.ts` | `PASS resolved=153 over-report=73 under-report=82 declared=2` — **exit 0** (`03-verify-manual-paths.log`) |

## 4. Bounds

- Version literals only: no source, test, `dist/`, `skills/**` or `evidence/` file outside this subtree was
  touched, so the gates that own those surfaces (`verify:dist-fresh`, `verify:vendor`, `bun test`,
  `verify:comments`, pack closure, Docker) are the CAPTAIN's release sweep, not re-run here.
- `CHANGELOG.md` is English-only by policy (it declares itself outside the bilingual band), so it has no
  zh twin to update.
- The 0.17.1 literals that remain in the tree are HISTORICAL and were deliberately kept: the 0.17.1
  CHANGELOG section, `.mpd/plans/**`, `.mpd/memory/**` and `.mpd/goal/anchors.json`.
