# 0.17.3 release prep — carriers + changelog + published-version statements (release/v0.17.3)

- Branch: `release/v0.17.3`, cut from `dev` at `4f102eca`. No git write by this seat — the captain
  commits; the working-tree diff below is the whole change.
- Scope written: `package.json`, `dsh-plugin.json`, `dsh-distribution.json`, `README.md`,
  `README.zh-CN.md`, `AGENTS.md`, `CHANGELOG.md`, this evidence subtree. No src/test/dist/skills.
- Not run by this seat (by contract): the Docker lane, the full release gate sweep, tag, commit, stage.

## 1. Carriers — all three at 0.17.3

| carrier | change |
|---|---|
| `package.json` | `version` 0.17.2 → 0.17.3 (the only literal in the file) |
| `dsh-plugin.json` | `version` 0.17.2 → 0.17.3, plus the `x-mpd-tui-surfaces.note` self-description ("version 0.17.2") → 0.17.3 |
| `dsh-distribution.json` | `distribution.version` 0.17.2 → 0.17.3 AND all SIX self-urn refs (`bundle`, `plugins`, `mcp-servers`, `skills-corpus`, `web-client`, `tui-edition`) → `@0.17.3` |

Observed: `0.17.3` occurs 1 / 2 / 7 times respectively (7 = version + 6 refs). `verify:manifest`
independently confirms the coherence: `version:dsh-plugin.json: version = 0.17.3`,
`version:dsh-distribution.json: distribution.version = 0.17.3`,
`component-ref-version: 6 self-urn ref(s) compared against distribution.version 0.17.3, 0 stale`.

## 2. Release docs

- `README.md` / `README.zh-CN.md`: version badge → `0.17.3`; a new top table row
  `0.17.3 | 0.2.1-rc.5 | 0.18.0 | the current release` (zh: `本次发布`); the `0.17.2` row demoted
  (EN `previous`, zh `上一版本`) and the zh `0.17.1` row moved to the literal `` `previous` `` so the
  "immediately previous" label follows the table instead of appearing twice; the notes paragraph
  ("The newest row **is** that pair") and the Changelog current-release line → `0.17.3` / **v0.17.3**.
- `AGENTS.md` §8 install line: `dsh plugin --profile web add @mpd-dsh/mpd@0.17.2` →
  `@mpd-dsh/mpd@0.17.3` (one line; the surrounding paragraph is untouched).
- `CHANGELOG.md`: a new section `## 0.17.3 — …` inserted ABOVE 0.17.2; 0.17.2 left byte-intact. Three
  paragraphs in the file's bold-lead-in voice, one per shipment, each stating the user-visible
  consequence: `Changed` — the `ulw-*` skills are gone and the trio answers as `autoproject-*`;
  `Fixed` — a member the live team record knows is a member of its cell, `cellwork_dispatch` gains
  `unfence: [names]`, `cellwork_supervise` separates give-up from barrier-owned seats, exact-first
  member resolution; `Fixed` — the compaction fence holds in the dsh-tui 0.18.0 composition
  (`ctx.agentPresets.serviceFor(agent,"compaction")` first door, `agent.ctx.get("compaction")` second,
  `liveAgentExact` + `reseed-parent-unavailable`).

## 3. `docs/**` — searched, nothing to move

`git ls-files 'docs/*' | xargs grep -n "0\.17\.2"` returns NO match, and the only version-shaped
literals under `docs/` are DSH-TUI pins and historical records (`docs/tui*.md`) plus
`docs/market/dsh-go-entry.json` (see the bound below). There is no install/version line in `docs/**`
that states the bundle's current release, so no `docs/` file was touched and no zh twin was owed.

## 4. Gates (quoted exits; full logs beside this file)

| command | observed |
|---|---|
| `bun run verify:docs` | `pairs=55 failed=0 violations=0 exempt=24 derived=3 links=500 dead=0 — PASS` — **exit 0** (`01-verify-docs.log`) |
| `bun run verify:manifest` | `version:dsh-plugin.json: version = 0.17.3`, `version:dsh-distribution.json: distribution.version = 0.17.3`, `component-ref-version: 6 self-urn ref(s) … 0 stale`, `packed-content: npm pack --dry-run lists 1223 file(s)`, `VERDICT: PASS` — **exit 0** (`02-verify-manifest.log`) |
| `node scripts/verify-manual-paths.ts` | `PASS resolved=153 over-report=73 under-report=82 declared=2` — **exit 0** (`03-verify-manual-paths.log`) |

Gate runs were re-executed into these logs AFTER the last edit (AGENTS.md), so the logs describe the
final tree.

## 5. Bounds

- Version/doc literals only: no source, test, `dist/`, `skills/**` or `evidence/` file outside this
  subtree was touched, so the gates that own those surfaces (`verify:dist-fresh`, `verify:vendor`,
  `bun test`, `verify:comments`, pack closure, Docker) remain the captain's release sweep, not re-run
  here.
- `CHANGELOG.md` is English-only by policy (it declares itself outside the bilingual band), so it has no
  zh twin to update.
- The 0.17.2 literals that remain in the tree are HISTORICAL and were deliberately kept: the 0.17.2
  CHANGELOG section and its supersede sentence, the README `0.17.2 | … | previous` row, and the wave
  labels in code comments (`packages/mpd-team-core-plugin/test/team-end.test.ts`, `scripts/pack-mpd.ts`,
  `scripts/verify-pack-closure.ts`, `skills/dsh-qa/scripts/tui-admission.ts`).
- **Noticed-not-touched:** `docs/market/dsh-go-entry.json` names `@mpd-dsh/mpd` `"version": "0.17.0"` —
  it went stale before 0.17.1 and the 0.17.2 prep recorded it as noticed-not-touched in its own wave
  record. It is a market-listing manifest copied into the dsh-Go repository at submission time, not the
  bundle's install/version line, and it carries no `0.17.2` literal, so this contract (change exactly
  the statements that mean the current release, found by searching `0.17.2`) does not cover it. Left as
  found and reported instead.
