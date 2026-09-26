# t10 — Review gate round 1: README / design doc / user guide against the requirement

**Verdict: PASS** — 0 blocker, 0 high findings. 3 low observations (none of them a t3/t4/t5 acceptance
criterion), and 9 first-pass flags that were triaged to false positives of this reviewer's own
checker (recorded in §D so the record shows they were examined, not skipped).

Reviewer: Reviewer (correctness / risk review), attempt 15.
Reviewed task: t4 (with t3 and t5 judged on the same pass, as the contract requires).
Judged on the FILES ON DISK, never on a lane summary.

## 1. Judged revision (hash-anchored)

| File | sha256 (16) | bytes | wc -l |
|---|---|---|---|
| `README.md` | `9d58873d602a9425` | 44472 | 734 |
| `README.zh-CN.md` | `61f7dadf721b0514` | 44181 | 673 |
| `docs/design.md` | `62bd827a9449aa58` | 47579 | 584 |
| `docs/design.zh-CN.md` | `e964888bbb626f5e` | 46793 | 495 |
| `docs/user-guide.md` | `235d01eeb63da62d` | 50699 | 767 |
| `docs/user-guide.zh-CN.md` | `5a4b1b6b2ce4f0ec` | 50395 | 702 |

Every hash agrees with the value the owning lane reported; `docs/architecture.md` and
`docs/architecture.zh-CN.md` are absent from the working tree (the rename landed, captain commits).

## 2. Gates run by this review (contract verify list)

| Command | Exit | Output |
|---|---|---|
| `node scripts/verify-docs-parity.mjs` | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`; lists `ok README.md`, `ok docs/design.md`, `ok docs/user-guide.md` |
| `node scripts/verify-rows-parity.mjs` | 0 | `ok: 25 row ids match the bundle patch insert list` |

Reproducible mechanical sweep: `node evidence/docs-overhaul/review-round1-checks.mjs` (73 checks;
64 PASS, and all 9 FAILs are the false positives triaged in §D). Both gates and the sweep ran on the
hashes in §1 and were not re-run afterwards; no document was modified by this review.

## 3. The three judgements the acceptance names explicitly (the user's own words)

**(a) Does the README still explain architecture beyond a pointer? NO.**
Mechanics sweep over `README.md` for `boot chain|patch layer|adapter seam|treeSha|insert:|cordis|loader`
returns only: the intro sentence pointing at the design doc, the install-section facts a plugin list
necessarily contains (`third patch layer`, row/loader-entry wording, the mount tables), the
documentation-map row and the §Architecture pointer itself. `## Architecture, in one pointer` is one
paragraph (EN 8 lines) linking `docs/design.md` + `docs/design.zh-CN.md`. No boot chain, no
patch-order, no adapter-seam explanation. **Clause satisfied in both twins.**

**(b) Does the install section's plugin list match the patch's insert list? YES — exact set match.**
Parsed `packages/mpd-bundle/cordis.patch.yml` myself: **25 indented `- id:` insert rows** (4 in-repo
MCP + 18 `mpd-*` bundle rows + 1 adopted `agent-teams` + 2 remote MCP) and **2 top-level id-target
rows** (`agent-presets`, `dsh-tui-agent-presets` — replacements, not inserts), i.e. 27 `- id:`
entries total. Against the README pair's first-cell table ids: **patch inserts not listed = none;
listed-but-not-in-patch = only `slot1..slot4`** (settings rows in the team-model table, not plugin
rows). The grouping (18 bundle / 4 MCP / 1 adopted / 2 remote = 25) matches the patch's own insert
blocks, and `mpd-tui` carries the required degrade note. The `docs/design.md` inventory is an even
tighter match: **27 first-cell ids = exactly the 27 patch ids, 0 extra, 0 missing.**

**(c) Are the acknowledgement credits accurate and complete? YES — complete, and each one traceable.**
`## Acknowledgements` (README, both twins) carries all six required credits plus two extras
(`dsh-better-sidebar`, "Written here"), each with a URL and a stated contribution. Independently
verified:

| Credit | Verified against |
|---|---|
| oh-my-openagent / **code-yeongyu**, pinned `8c57e46` (v5.0.0-beta.20) | `VENDOR_LOCK.json` → `code-yeongyu/oh-my-openagent`, commit `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`, version `5.0.0-beta.20` |
| dsh-agent-teams / **程序员阿江 (Relakkes)**, MIT, adopted `0.1.16-rc.3-mpd` | `LICENSE-NOTICES.md`: MIT text `Copyright (c) 2026 程序员阿江(Relakkes)`; package version and URL recorded |
| DSH host packages `@deepseek-ai/*`, MIT, dependencies only | `LICENSE-NOTICES.md` (§ host packages) |
| **ast-grep**, MIT, `@ast-grep/cli@0.45.2`, repo `ast-grep/ast-grep` | installed `node_modules/@ast-grep/cli/package.json`: `license: MIT`, `version 0.45.2`, `repository https://github.com/ast-grep/ast-grep`; version also pinned in `package.json` `optionalDependencies` |
| **codegraph**, MIT, `@colbymchenry/codegraph@1.5.0` | installed package metadata: `license: MIT`, `1.5.0`, `git+https://github.com/colbymchenry/codegraph.git`; `VENDOR_LOCK.json` asset `packages/mpd-mcp-codegraph/dist/serve.js` cites `packages/mpd-mcp-codegraph/LICENSE/NOTICE` |
| **comment-checker**, MIT, `@code-yeongyu/comment-checker@0.8.0` | `LICENSE-NOTICES.md` § `@code-yeongyu/comment-checker (MIT)` with the same URL and version |
| `dsh-better-sidebar` (extra) | live source `packages/mpd-bundle-plugin/client.js` contributes the two sidebar tabs and warns once without it; `mpd-bundle-plugin/client.js` + design §7 |
| "Written here" (extra) | repository's own packages/scripts/docs |

No credit is unverifiable and none is mis-attributed. Handle-plus-URL naming is correct for this
repository (it records handles, not legal names).

## 4. Per-criterion judgement against the files on disk

### 4.1 t3 — design document (5 acceptance items)

| # | Criterion (abridged) | Verdict | Producing command / read |
|---|---|---|---|
| 1 | `docs/design.md` exists as the detailed design document with the named coverage + a known-limits section | PASS | heading tree read: §0 what is designed, §0b principles, §2 structure, §3 patch layer + boot chain, §4 inventory, §5 flows, §6 state, §6b adapter, §6c preset plane, §7 web client, §7b TUI, §8 security, §8b known limits (10 limits) |
| 2 | Inventory complete against the patch (27 ids of two kinds; every doc row exists in the patch) | PASS | `review-round1-checks.mjs` + exact set compare: design 27 first-cell ids == patch 27 ids; 0 missing either direction; insert rows carry a Composition cell, `mpd-tui` annotated, `mcp-gitbash` `disabled: true` |
| 3 | zh twin faithful, same tree, switch link under title | PASS | heading count 20/20 with identical level sequence; 7477 CJK chars; switch link present under the title both ways (see §D for the spelling note) |
| 4 | Factual drift fixed, counts measured, inventory includes `mpd-team-watchdog` / `mpd-team-compact` / `mpd-tui` | PASS | all three ids present (exact set compare); `25 install rows` + `2 id-targets` stated; §8b residual subsection names the fact-base fixes explicitly |
| 5 | Not a user manual; linked FROM README and user-guide | PASS | README `## Architecture, in one pointer` + documentation map row; `docs/user-guide.md` link to `design.md` at the top; link sweep 0 dead |
| 6 | Rename referrers handled (t12/t4/t5 own the rest), renamed pair's own links fixed | PASS | `git grep -nE "architecture(\.zh-CN)?\.md"` scoped to the three pairs: no markdown link to a removed name; 0 dead relative links in all six files (19+19+4+4+11+11) |
| 7 | Residual gaps from the fact base and baseline metrics noted | PASS | §"Residual gaps carried from the fact base and the baseline measurement" carries the composition-evidence limit (no mounting boot), the perishable hash-anchored fact base, and the knob-count/slot ruling |
| 8 | Evidence written with commands + exit codes | PASS (lane evidence) | `evidence/docs-overhaul/design-doc.md` present; cited composition artifacts `evidence/tui/composition/20260915T053445Z/raw/{web-dump-config-final,dsh-tui-dump-config}.txt` both exist |

### 4.2 t4 — README pair (7 acceptance items)

| # | Criterion (abridged) | Verdict | Producing command / read |
|---|---|---|---|
| 1 | Reads as a user manual; a how-to per capability | PASS | 37 headings; `## Install` (Requirements/checkout/TUI/packed/Uninstall/mounts), `## Quick start`, `## Commands`, `## Tools, by job` (9 job sections with literal calls), `## Specialists`, `## Team mode` (start / approve-required / running team / finish), `## Web GUI`, `## The DSH-TUI edition`, `## Settings`, `## Where your state lives`, `## Troubleshooting` |
| 2 | Install names every mounted plugin: all 25 row ids grouped, toolchain versions, all 4 command forms | PASS | exact set compare (§3b); optional deps match `package.json` `optionalDependencies` exactly (`@ast-grep/cli 0.45.2`, `@colbymchenry/codegraph 1.5.0`, `@code-yeongyu/comment-checker 0.8.0`); checkout / packed / `dsh-tui` / uninstall each have an explicit command block |
| 3 | Architecture only a pointer linking `docs/design.md` | PASS | mechanics sweep → pointer + install facts only (§3a) |
| 4 | Acknowledgements section names projects + authors, with links, and what each contributes | PASS | all six required + 2 extra, each verified (§3c) |
| 5 | zh twin same section tree + same credits + switch link under title | PASS | headings 37/37, identical level sequence; 6786 CJK chars; all 8 credit tokens present in both; switch links both ways |
| 6 | Own internal links point at the design document; where-to-go-next table lists it | PASS | link sweep: 19 relative links per file, 0 dead; documentation map row names `docs/design.md` |
| 7 | Evidence written with commands + exit codes | PASS (lane evidence) | `evidence/docs-overhaul/readme.md` re-anchored by t14 to the shipped bytes (266 lines) |

### 4.3 t5 — user-guide pair (5 acceptance items)

| # | Criterion (abridged) | Verdict | Producing command / read |
|---|---|---|---|
| 1 | Gains the command table, recipes, per-knob restart behaviour, attribution facts | PASS | §12 command reference, §13 nine recipe subsections, §9.1 per-knob table, §14 attribution table (11 rows) — all read on disk |
| 2 | Literal copy-pasteable invocations for the complex surfaces | PASS | §13.1 teams in every approval mode + running/finish calls, §13.2 ULW + gates, §13.3 `mpd_role_spawn`, §13.4 workmates, §13.5 hashline, §13.6 boulder, §13.7 memory, §13.8 extensions, §13.9 the `agent_teams_*` leader/member loop; all 40 documented tool tokens resolve against `packages/**` |
| 3 | zh twin same tree/commands/facts + switch link | PASS | headings 47/47 identical level sequence; 7946 CJK chars; both twins carry the same command set |
| 4 | Own links point at the design document; every document links correctly from its own depth | PASS | 11 relative links per file, 0 dead; `design.md` / `design.zh-CN.md` repointed; 10 cross-document pairings resolve |
| 5 | Evidence written with commands + exit codes | PASS (lane evidence) | `evidence/docs-overhaul/user-guide.md`; the repaired recipe re-verified by t18 (`verify-userguide-reverify.json`, PASS) |

### 4.4 Independent spot-probes beyond the lane summaries

| Probe | Result |
|---|---|
| All 8 §12 commands registered? | `/ulw`+`/ultrawork` (`mpd-ulw-plugin/src/index.ts`), `/mpd-codegraph` (`mpd-codegraph-plugin/src/index.ts`), `/agent-teams` + generated `/agent-teams-mpd` (`profileCommandName("mpd")` in `lib/command.js`, profile key declared in the patch), `/mpd` (`COMMAND_ROOT` in `mpd-tui-plugin/src/command-trees.ts`), `/settings` (host screen extended by `mpd-tui-plugin/src/settings.ts`), `/goal` (preset rows `command-goal`/`tool-goal`). Negative claim: `grep` for a `/roster` registration → empty |
| Is the §9.1 "`watchdog.*` is re-read live" claim true? | YES — `refreshKnobs` in `packages/mpd-team-watchdog-plugin/src/engine.ts` re-reads the file live on every tick and lets the layer that MOVED win (the measured T-18 case); the doc's sentence matches the code, including the file-vs-settings precedence |
| `mcp-gitbash` disabled by default? | YES — patch row carries `disabled: true` |
| Every README row→package mapping real? | YES — all `packages/<pkg>` exist (the one apparent miss was my regex reading the id-target table's *Plane* cell `dsh-tui`) |
| Four team-model slots (not three)? | YES — `TEAM_MODEL_SLOTS = slot1..slot4`; README §Settings lists all four with slot 4 = vision model; design §8b says "FOUR — not three" |

## 5. Findings

**No blocker and no high finding is open. The wave does not need a repair round for its three
delivery contracts.** Three low observations are recorded for the captain's routing only.

| id | severity | problem | requiredFix (recommendation) | file |
|---|---|---|---|---|
| OBS-1 | low | `AGENTS.md` §3 repository-layout tree does not list three packages that exist and that the README/design doc document correctly: `mpd-team-watchdog-plugin`, `mpd-team-compact-plugin`, `mpd-tui-plugin` (`mpd-team-compact-plugin` is named nowhere in AGENTS.md). Out of t3/t4/t5 scope — no lane owns AGENTS.md content beyond the t12 rename repoint. | fold into the next AGENTS.md touch (t12 already edits that file) or carry forward as its own small task; do NOT block this wave on it | `AGENTS.md` |
| OBS-2 | low | Switch-link spelling is not uniform across the doc set: the README pair writes `[中文](./README.zh-CN.md)` (the AGENTS.md §Language-policy spelling) while the design and user-guide pairs write the bare `[中文](design.zh-CN.md)`. Both resolve, and the gate's own rule accepts `(?:\./)?`; pre-existing files (`docs/index.md`, `docs/development.md`) also use the bare form. | none required; if uniformity is wanted, align the two pairs when those files are next edited | `docs/design.md`, `docs/user-guide.md` |
| OBS-3 | low | Bookkeeping, not a document defect: task **t8 remains `failed`** in the ledger while its single blocking finding (T8-F1, `memberName` vs `member_name`) is CLOSED on disk (grep `memberName` → 0 hits; `member_name` present in both twins) and was re-verified PASS by t18. The delivery line reads "t8 failed without a follow-up repair". | treat t8 as history for the doc wave; if t11's dispatch is pinned by that failed node, route t11 explicitly rather than opening another repair | task ledger |

Related tasks checked for status, not judged as documentation lanes: **t13** (repair of the stale
`teamModels.slot1|slot2|slot3` string) is COMPLETED with `bun test packages/mpd-config-plugin` and
`node scripts/verify-dist-fresh.mjs` green — that repair is code, outside this review's judgement;
**t12** (rename repoint) is COMPLETED and independently confirms the only remaining `architecture.md`
strings are the deliberate 404-explainer prose in the user-guide pair.

## 6. D. Triaged first-pass flags (negative results kept on record)

My first sweep printed 9 FAILs. Each was investigated; all 9 are artifacts of the sweep's own
patterns, not document defects:

1. **switch link `docs/design.md` / `docs/user-guide.md` pairs (2)** — the checker demanded the `./`
   form; the files use the bare basename, which the gate explicitly accepts (`switchLinkUnderTitle`
   regex `\]\((?:\./)?…\)`) and which pre-existing `docs/index.md` / `docs/development.md` also use.
   Covered by OBS-2 as a consistency note only.
2. **`architecture.md` pointer in the user-guide pair (2)** — the hits are prose inside backticks in
   the upgrade troubleshooting bullet ("the design document was RENAMED … it used to be
   `architecture.md`"), deliberate in both twins, and no markdown link to the removed name exists.
3. **`slot4` / `slot 4` "absent" in design + user-guide zh (3)** — the design pair states the ruling
   in words ("FOUR — not three — `teamModels` slots are authoritative"; zh 权威地是**四**个槽), and
   the zh guide writes `teamModels.slot{1,2,3,4}` + 槽位 4.
4. **design pair "27 absent" (2)** — the total is expressed as the decomposition the contract names:
   "25 `insert` rows" + "2 id-targets"; the exact set compare proves 27/27 ids are covered.

## 7. Reproduction

```bash
cd /root/dshProj/my-power-dsh
node scripts/verify-docs-parity.mjs     # exit 0
node scripts/verify-rows-parity.mjs      # exit 0
node evidence/docs-overhaul/review-round1-checks.mjs   # 73 checks; 9 known false positives (§6)
```
