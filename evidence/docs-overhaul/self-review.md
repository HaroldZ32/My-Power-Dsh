# t9 — Requirement-coverage self-review (adversarial) + independent credit verification

**Task:** t9 (kind=review, attempt 12) · **Reviewer:** Plan Reviewer · **Reviewed task:** t4
**Verdict: PASS** — every clause of the user's requirement is satisfied by a named section, and
every acknowledgement credit that makes a factual claim is independently true.

## Reviewed revision — hash sandwich (start == end)

| File | sha256 | Lines | Bytes | mtime |
|---|---|---|---|---|
| `README.md` | `9d58873d602a94259ea5777e2524edfc45ba3294c41e084dcc0303ff2767e8db` | 734 (`wc -l`) | 44472 | 2026-09-19 18:31:15 +0800 |
| `README.zh-CN.md` | `61f7dadf721b0514f153cd5faf0efa789b6496316f291cc15a589cb26c42c68a` | 673 (`wc -l`) | 44181 | 2026-09-19 18:31:30 +0800 |
| `docs/design.md` (clause 4 target) | `62bd827a9449aa58900f0baf6df23ddf4fdfdc636641a4106b50f57d3c946228` | 584 | — | — |
| `docs/design.zh-CN.md` | `e964888bbb626f5e6ab3483f77a69efdf1955c4fe3c953bc6d8142c831726e6a` | 495 | — | — |

All four hashes are IDENTICAL at the start and at the end of this review, so the bytes judged are the
bytes shipped. (Line-count convention: `split(/\r?\n/).length` = `wc -l` + 1, which is why t6's
735/674 and t14's 734/673 describe the SAME revision — stated here so it cannot read as drift.)

Gate on these bytes: `node scripts/verify-docs-parity.mjs` **exit 0** —
`[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`,
with `ok   README.md` (the root pair) among the 38.

## Clause-by-clause judgement (the user's requirement, as written)

| # | Clause | Verdict | The section that satisfies it | How it was judged |
|---|---|---|---|---|
| 1 | README is the how-to place and goes deep on usage | **PASS** | `README.md` L20–L734: *What you get*, *Install* (L36–190), *Quick start* (L192), *The main agent and your project rules* (L207), *Commands* (L223), *Tools, by job* with 9 subsections (L237–438), *Specialists* (L439), *Team mode* (L464–532), *Web GUI* (L533), *DSH-TUI* (L550), *Settings* (L568), *Where your state lives* (L630), *Troubleshooting* (L650), *Documentation map* (L668) | 734 lines / 17 top-level sections; every capability in *What you get* resolves to a section that tells the reader to **type something**. Twin: `README.zh-CN.md` mirrors 37/37 headings. |
| 2 | The README explains HOW to use, including how to call commands | **PASS** | *Commands* table L227–L235 (7 slash commands + the `team:`/`!team` gesture, each with its argument form and what happens); literal call blocks: L255–L271 (MCP), L286–L294 (hashline), L306–L308 (ULW), L472–L479 (team), and one per *Tools, by job* subsection; *Quick start* L192–L205 is a 6-step worked path | Spot-read the calls against the parameters the tools actually register (e.g. `agent_teams_create {name, description, profile, approval}`); the README's `agent_teams_edit_plan` prose (L492) deliberately does not repeat the recipe, and the §13 recipe that once carried a wrong key lives in the user-guide pair, not here. |
| 3 | Architecture is NOT the README's business beyond a pointer | **PASS** | *Architecture, in one pointer* L682–L689 — 8 lines, pointing at `docs/design.md` (+ its zh twin) | Whole-file keyword sweep for `boot chain`, `patch layer(s)`, `cordis`, `adapter seam`, `treeSha`, `VENDOR_LOCK`, `insert:`: the only architecture exposition is that 8-line pointer. The remaining hits are (a) the intro sentence naming where the internal assembly lives, (b) the install fact "third patch layer" (L69), (c) the mount tables (product/install information, required by clause 6), (d) one troubleshooting row about the `mcp-git_bash__*` row flag, (e) the documentation-map row for `docs/design.md`. No boot chain, no layer order, no state layout. |
| 4 | A dedicated detailed design document exists and the README links to it | **PASS** | `docs/design.md` (584 lines) + `docs/design.zh-CN.md` (495 lines); links at `README.md:673` (documentation map), `README.md:687–688` (the pointer, EN file + zh twin) and `README.zh-CN.md:623,636–637` | Both targets exist on disk; the links are relative and resolve from the README's own directory; the design doc is itself a pair and passes the docs gate (pairs=38 failed=0). |
| 5 | The README carries a plain acknowledgement for the referenced engineering projects and their authors | **PASS** | *Acknowledgements* L691–L726 — 8 bullets, plain prose, no jargon; each names the project and (where the project records one) its author/team, plus a closing "Written here" bullet and the licence pointer L728–L734 | Every bullet checked against in-tree records — see the credit table below. No bullet claims a licence, version, URL or author that the tree does not record. |
| 6 | The install section names every other plugin referenced by the installed artifact | **PASS** | *What the install mounts* L111–L190: **18 bundle host plugins**, **4 in-repo MCP servers**, **1 adopted plugin**, **2 remote MCP rows** = 25 inserts; then **host rows id-targeted (replace, not insert) — 2**; then 3 optional toolchain dependencies | Programmatic comparison: the patch's 25 nested `- id:` entries + its 2 top-level `- id:` entries are ALL present in the install section (`missing = []`); 18+4+1+2 = 25 = the insert list `verify-rows-parity` asserts; the two `@deepseek-ai/dsh-agent-presets` rows are described as REPLACES with a per-plane table, not counted as inserts; the `@deepseek-ai/*` host packages are explicitly explained as DSH dependencies rather than rows; optional-dependency versions match `package.json` exactly (`@ast-grep/cli` 0.45.2, `@colbymchenry/codegraph` 1.5.0, `@code-yeongyu/comment-checker` 0.8.0). The zh twin carries the same grouping with its own headings (18/4/1/2 + the id-target table with a 平面/Plane column). |

## Credit verification (independent of the t4 summary)

| README credit | Claim as written | Independent in-tree evidence | Verdict |
|---|---|---|---|
| **oh-my-openagent** (L695–700) | URL `github.com/code-yeongyu/oh-my-openagent`; author `code-yeongyu`; pinned commit `8c57e46`; `v5.0.0-beta.20` | `LICENSE-NOTICES.md:3-4` records the same URL, commit `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` and `v5.0.0-beta.20`; `VENDOR_LOCK.json` `upstream` = `code-yeongyu/oh-my-openagent`, `upstreamCommitSha` = the same sha, `upstreamVersion` = `5.0.0-beta.20` | **VERIFIED** (URL, author, commit, version) |
| **dsh-agent-teams** (L701–706) | URL `github.com/NanmiCoder/dsh-agent-teams`; author 程序员阿江 (Relakkes); MIT; adopted version `0.1.16-rc.3-mpd`; notices in `LICENSE-NOTICES.md` | `LICENSE-NOTICES.md:9-18` (same URL, MIT, `0.1.16-rc.3-mpd`, `0.1.14` body with the audited `0.1.16-rc.3` deltas); `packages/mpd-agent-teams-plugin/package.json` = version `0.1.16-rc.3-mpd`, `license: MIT`, `repository: git+https://github.com/NanmiCoder/dsh-agent-teams.git`, `author: 程序员阿江 (Relakkes)`; MIT copyright line at `LICENSE-NOTICES.md:57` | **VERIFIED** (project, URL, author, licence, version) |
| **@deepseek-ai/**\* host packages (L707–709) | "the DeepSeek team, MIT"; referenced as dependencies only | `LICENSE-NOTICES.md:7` ("DSH packages (@deepseek-ai/*) are MIT licensed and referenced as dependencies only") and `:27` ("MIT, Copyright (c) 2021-present Shigma and the DeepSeek team") | **VERIFIED** (licence, role); see OBS-1 for the completeness note |
| **ast-grep** (L710–711) | URL `github.com/ast-grep/ast-grep`; MIT; optional dependency `@ast-grep/cli@0.45.2` | `package.json` `optionalDependencies` pins `0.45.2`; the installed `node_modules/@ast-grep/cli/package.json` reports version `0.45.2`, `license: MIT`, `repository: https://github.com/ast-grep/ast-grep` | **VERIFIED** (URL, licence, version) |
| **codegraph** (L712–714) | URL `github.com/colbymchenry/codegraph`; MIT; optional dependency `@colbymchenry/codegraph@1.5.0` | `package.json` pins `1.5.0`; installed package reports `1.5.0`, `license: MIT`, `repository: git+https://github.com/colbymchenry/codegraph.git`; `packages/mpd-mcp-codegraph/LICENSE` is the MIT text (Copyright (c) 2026 Yeongyu Kim) and `NOTICE` names `@colbymchenry/codegraph@1.5.0` | **VERIFIED** (URL, licence, version) |
| **comment-checker** (L715–717) | URL `github.com/code-yeongyu/go-claude-code-comment-checker`; MIT; optional dependency `@code-yeongyu/comment-checker@0.8.0` | `LICENSE-NOTICES.md:77-83` records the same project, URL, the `0.8.0` version and MIT, and states it is not redistributed; `package.json` pins `0.8.0`; installed package reports `0.8.0`, MIT, the same repository | **VERIFIED** (project, URL, licence, version) |
| **dsh-better-sidebar** (L718–720) | community sidebar bundle hosting the AgentTeams/Workmates tabs; pages contributed to it; the tools work without it | No URL/licence/version is claimed (nothing false to check). Name and role traceable in the tree: `packages/mpd-bundle-plugin/src/team-page.js:4` ("DSH-better-sidebar is the ONLY GUI surface for AgentTeams now"), the guarded/degrading tab registration in the same file, `agent-references/troubleshooting.md`, `skills/dsh-qa/SKILL.md` | **VERIFIED as named** (claim-by-claim); see OBS-2 |
| **Written here** (L721–723) | the DSH plumbing, TUI edition, QA suite, docs and extension interface are this project's own | `AGENTS.md` §1 ("What is ours") and the per-package `src/` | **VERIFIED** (internal claim) |
| **License** (L728–734) | repository SUL-1.0 inherited; upstream copyright code-yeongyu + OMO contributors; adopted agent-teams keeps MIT, covering that component only | `LICENSE.md` (SUL-1.0) + `LICENSE-NOTICES.md:5` and `:9-34` | **VERIFIED** |

Seven credits carry a factual claim; all seven are true as written. Six were verified on all four axes
(project, URL, author, licence) — the acceptance asked for at least three.

## Observations (recorded, NOT raised as findings)

- **OBS-1 (informational):** the host-package bullet credits "the DeepSeek team"; the full copyright line in
  `LICENSE-NOTICES.md:27` is "Copyright (c) 2021-present Shigma and the DeepSeek team". The README's
  statement is true but partial, and the bullet's own reader is pointed at `LICENSE-NOTICES.md` three lines
  later as the complete record — so this is completeness, not a wrong attribution. No action requested.
- **OBS-2 (informational):** the `dsh-better-sidebar` bullet carries no repository URL or licence, while most
  other bullets do. Nothing is claimed that could be false, and the acceptance's four-axis check applies to
  credits that MAKE those claims; no action requested.
- **OBS-3 (environment):** an untracked/ignored `.qa-reloc/` relocation scratch tree exists in the workspace
  and contains OLD copies of `docs/architecture*.md`; it is not git-tracked (`git status --porcelain .qa-reloc`
  is empty) and is not part of the shipped docs set, so a whole-tree grep for the retired filename can hit it.
  Same disposition as t15's `_work/` non-change: captain-owned scratch, not a documentation defect — flagged
  only so a later whole-tree link sweep is not surprised by it.

## Findings

**None.** 0 blocking findings, 0 low findings. Verdict: **pass**.

## Method and honest limits

- Judged the FILES on disk at the pinned hashes above, never the implementation summary: clause 6's row list
  was compared programmatically against `packages/mpd-bundle/cordis.patch.yml`, and every credit against
  `LICENSE-NOTICES.md`, `VENDOR_LOCK.json`, `package.json`, the vendored `packages/mpd-mcp-codegraph/{LICENSE,NOTICE}`
  and the installed `node_modules` manifests.
- NOT verified here: the runtime behaviour of the GUI tabs behind the `dsh-better-sidebar` credit (no boot was
  run in this review; the claim is checked as a documentation claim, and the code path is guarded/degrading),
  and the licence of any host package that is not recorded in this tree (the README's own pointer to
  `LICENSE-NOTICES.md` is the record for those).
- No file outside `evidence/**` was written: the docs under review are out of this task's scope and were only read.
