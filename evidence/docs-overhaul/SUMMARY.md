# Wave impact summary — documentation overhaul (w1)

Objective (user's words, in Chinese): check the project for latent problems and fix them; make the
README the place that tells the user HOW TO USE the bundle (how to use it, how to invoke commands)
with little architecture talk; give explicit acknowledgement to the referenced projects and authors
in the README; write the current architecture as a separate detailed design document referenced from
the README; and make the install state every other plugin that is referenced.

Delivered on `dev` (base commit `a9c3c3e`) by team `MPD Default` wave `w1`: 19 tasks, 11 seats,
review gate round 1 PASS (0 blocker / 0 high findings), ledger in `hash-ledger.md`.

## Clause by clause

| # | User clause | Where it lives now | Verification |
|---|---|---|---|
| 1 | check latent problems and fix them | the defects below | each has its own instrumented task + gate |
| 2 | README = how to use it; detailed usage and command invocation | `README.md` + `.zh-CN`: `## Install` (incl. `### What the install mounts`), `## Quick start`, `## Commands`, 9 `### Tools, by job` subsections with copy-ready calls, `## Team mode` (both approval modes), `## Settings`, `## Where your state lives`, `## Troubleshooting` | t6 PASS (48 links, 0 dead; 37-heading twins; 61 documented tool names, 0 absent); t9 clause table |
| 3 | do not talk much about architecture there | `## Architecture, in one pointer` — one 8-line paragraph linking the design doc; a whole-file mechanics sweep finds no other exposition | t9 clause 3; t10 judgement (a) |
| 4 | a separate detailed design document, referenced from the README | `docs/design.md` (584 lines) + `docs/design.zh-CN.md` (495), replacing `docs/architecture.md`; referenced from README, user guide and docs hub | t3 (27/27 patch ids, 0 invented), t7 re-verify PASS, t10 |
| 5 | explicit acknowledgement of referenced projects and authors in the README | `## Acknowledgements` / `## 鸣谢`: oh-my-openagent (author code-yeongyu, pinned `8c57e46` / v5.0.0-beta.20), dsh-agent-teams (author 程序员阿江 (Relakkes), MIT, `0.1.16-rc.3-mpd`), `@deepseek-ai/*` host packages, ast-grep, codegraph, comment-checker, `dsh-better-sidebar`, plus "written here" | t9 credit table (7 claims, all true, 6 verified on all four axes); t10 judgement (c) |
| 6 | at install, name every other plugin | `### What the install mounts`: the 27 patch entries in two kinds — 25 INSERTED rows grouped as 18 bundle plugins + 4 in-repo MCP servers + the adopted `agent-teams` + 2 remote MCP rows — and the 2 host rows the bundle id-TARGETS (replace, not insert), plus the 3 optional toolchain deps with versions | t6 (row list == patch exactly), t9 clause 6, t10 judgement (b) "EXACT SET MATCH" |

## Problems found and fixed

| # | Defect | Instrument | Fix |
|---|---|---|---|
| 1 | README was a feature/architecture description, not a manual; install never named the mounted plugins; acknowledgements were one sentence inside the licence paragraph | t4 (+ t14 re-anchor) | README pair rewritten (718→734 EN lines), install names all 27 entries by kind, dedicated acknowledgements section |
| 2 | `docs/architecture.md` was a user-level overview with real drift: "13 host plugins" while the patch has 18 `mpd-*` rows; "8 MCP servers" while 6 rows exist (2 are comments); §4 omitted `mpd-team-watchdog`, `mpd-team-compact`, `mpd-tui` | t3 | promoted to `docs/design.md` with a complete 27-entry inventory, a Composition column per row, and the counts taken from the patch |
| 3 | The rename orphaned four live references nobody owned (`docs/index.md`, `docs/index.zh-CN.md`, `AGENTS.md`, a patch comment) | t12 | four one-line repoints; both grep patterns (the `architecture.zh-CN.md` variant is invisible to the naive one) return zero hits in its scope |
| 4 | A documented `agent_teams_edit_plan` recipe used `memberName` where the frozen schema requires `member_name` — the "copy-paste this" promise was false | t8 finding → t17 → t18 | key renamed in both twins; verified against `lib/tools.js`, not the prose |
| 5 | `mpd_config_get`'s tool description advertised three team-model slots while the schema declares four (slot 4 = vision route) | t13 | description + comments corrected, `dist/` rebuilt with the canonical command, `verify-dist-fresh` 20/20 |
| 6 | Design doc attributed the adopted plugin's boot-safety guard to `lib/members.js`; it is implemented in `lib/harness-compat.js` | t7 F1 → t15 | attribution corrected in both languages with source proof |
| 7 | Design doc's known limits cited a scratch directory that does not exist, and instructed an owner to claim/remove a path the captain already rules on | t7 F2 → t15, t16 | bullet deleted from the shipped doc; the evidence record states the resolution |
| 8 | AGENTS.md §3's layout tree omitted three packages that exist (`mpd-team-watchdog-plugin`, `mpd-team-compact-plugin`, `mpd-tui-plugin`) | t10 OBS-1 → t19 | three lines added, comments read from each package's own README |
| 9 | The packed artifact `dist/mpd-package/` was a pre-wave build: it shipped the RETIRED `architecture*.md` and a pre-rewrite README/user-guide | t11 | re-packed; asserted retired names ABSENT and `design*.md` PRESENT, with the pack's README/user-guide hashes equal to the repo's |

## Gates (post-wave, on the settled bytes)

`verify:gates` 5/5 green · `verify-docs-parity` 0 (`pairs=38 failed=0`) · `verify-rows-parity` 0
(25 ids) · `verify:vendor` 0 · `bun run test:qa` 0 · `bun run typecheck` 0 · `pack-mpd` 0 with the
assertions above. Baseline at `a9c3c3e` was the same five static gates green, so these are
re-measurements, not inherited state. Full table + hashes with timestamps: `hash-ledger.md`.

## Deliberately NOT claimed

1. **No live boot, no dump-config, no load claim was made for the design document's claims.** The
   Explorer's verdicts state this limit explicitly; the design doc was verified against the patch,
   the sources and the tree, not by mounting a profile.
2. **`dist/` and `.qa-reloc/` are gitignored scratch/build trees.** A repo-wide grep can still hit a
   retired filename inside them; that is not a dangling source reference, and neither tree is in the
   commit. `dist/mpd-package/` was re-packed so the stale pair is gone there too; `.qa-reloc/`
   (an older QA sandbox) was left untouched.
3. **The t7 stale-reference sweep excluded derived and evidence paths by design.** The pack-level hit
   was therefore OUTSIDE its coverage and was found by a different seat's filesystem hunt — stated
   here so the exclusion is explicit rather than silent.
4. **`evidence/web-card-catalog/20260918T073000Z/sandbox`** is a pre-existing untracked symlink that
   `.gitignore`'s directory-only `evidence/**/sandbox/` rule cannot cover. Excluded from the commit
   (explicit path list, never `git add -A`).
5. **`t8` remains `failed` in the task ledger by design** — it failed on the blocking finding, which
   was then repaired (t17) and re-verified (t18). A terminal failure is immutable; t10's review gate
   consumes t18, not t8. The failure is history, not an open item.
6. **The review gate's OBS-2 (switch-link spelling differs between pairs) was left as is**: both
   `[中文](./x.zh-CN.md)` and the bare `[中文](x.zh-CN.md)` resolve and the docs gate accepts both.
7. **`@deepseek-ai/*` is credited as "the DeepSeek team"** while `LICENSE-NOTICES.md` also names
   Shigma. True but partial; the complete record is linked from the same section.
8. **`dsh-better-sidebar` is credited without a URL** — its role is traceable in-tree
   (`team-page.js`) and the review recorded it as a non-finding.

## Process notes worth carrying

- **The re-dispatch loop cost real turns**: six automatic re-dispatches of already-terminal tasks
  (t13 ×2, t3, t15 ×2, t16), each waking a seat for unclaimable work. Every seat refused correctly;
  the fix is platform-side, and the discipline that kept it harmless was "a terminal payload is the
  answer".
- **Quote a hash with its measurement moment.** Four "stale reading" rounds happened because a lane
  and the captain sampled the same moving file at different instants. The timestamped `start == end`
  sandwich is what distinguishes "settled" from "another lane edited it while I sampled".
- **Attribute by task ownership + content, never by metadata** (AGENTS.md §5). One seat inferred
  ownership from a cluster of recent mtimes and was corrected by the output's owner; the correction
  is recorded rather than dropped.
- **The captain's own instructions were wrong twice** — a `_work` substring sweep that would have
  deleted legitimate `mpd_workmate_*` documentation, and a "F1 still owed" correction against
  superseded bytes. Both were caught by seats refusing to act on an unverified premise; both are
  recorded here as the reason the members' re-measure-before-acting rule exists.


---

## t11 attempt 19 — independent re-measurement (Architect, read-only seat)

Appended 2026-09-19T11:00Z by the seat the scheduler dispatched t11 to after the captain's own pass.
Nothing above was edited; this section only ADDS a second, independent sample of the same claims.

- **Gates re-run by this attempt, each with its exit code** (raw logs in `evidence/docs-overhaul/raw/t11/`):
  `node scripts/verify-gates.mjs` → **0** (`[verify-gates] PASS - 5/5 member gate(s) green` — vendor,
  dist-freshness, rows, docs-parity, preset-conformance) · `bun run test:qa` → **0**
  (`[test:qa] all self-tests passed`) · `bun run typecheck` → **0** (`$ tsgo --noEmit`, no diagnostics).
  Advisory beyond the contract: `node scripts/verify-pack-closure.mjs` → **0**
  (`1184 file(s) compared, 1184 identical, 0 drift, 0 expected-after-pack`; completeness 409 declared /
  408 present / 1 declared exemption / 0 absent; pack stamp `2026-09-19T10:59:47.953Z`).
- **Re-pack re-run** (`node scripts/pack-mpd.mjs`, no script change) → exit **0**. Asserted on the
  fresh artifact: `dist/mpd-package/docs/architecture.md` and `architecture.zh-CN.md` **ABSENT**;
  `design.md` (47579 B) and `design.zh-CN.md` (46793 B) **PRESENT**; and all eight packed doc files
  byte-identical to their sources — README pair, design pair, user-guide pair, index pair.
- **The pre-wave artifact, corroborated from a surviving copy this time** (stronger than the earlier
  timestamp argument): `.qa-reloc/mpd-pkg-relocated/` (ignored by `.gitignore:87 /.qa-*`; file mtimes
  `2026-09-18 00:03`) still holds `docs/architecture.md` (32163 B) + `docs/architecture.zh-CN.md`
  (31912 B) together with a README/user-guide pair (`d919c890…` / `e4f98e89…`) that is NOT the shipped
  pair (`9d58873d…` / `235d01ee…`). The retired names are therefore provable from bytes still on disk.
- **Shipped-file hashes re-sampled independently at 2026-09-19T11:00:02Z: every one identical to
  `hash-ledger.md`** (README/zh, design/zh, index/zh, user-guide/zh, `AGENTS.md` `d74a934d…`, the patch
  `d141f707…`, config-plugin `src` `e43e6a84…` / `dist` `566af9ee…`). `AGENTS.md` was re-sampled again
  at 11:00:32Z, after t19's window, and had not moved.
- **Lane terminality and evidence presence re-checked** (acceptance item 1): the artifacts named by t6
  (`verify-readme.json` 580110 B, checks links/sectionTrees/claims/translation/claimLedger/
  claimCrossChecks/postRulingEdit/evidence all `passed`, `failures: []`, `findings: []`), t7
  (`verify-design-reverify.json` 8990 B — switch links pass; row coverage 27 inventory rows,
  `missing: []`, `invented: []`), t18 (`verify-userguide-reverify.json` 7272 B — `verdict: pass`,
  gates exit 0, `findings: []`) and t9 (`self-review.md` 12116 B — `Verdict: PASS`) are all present and
  were read by this attempt; their headline results are as summarised above.

### The one acceptance item this attempt did NOT satisfy — the commit

`git log` still shows HEAD `a9c3c3e` with the wave dirty, so the commit named by acceptance item 6 does
not exist yet. This seat did not create it and must not: AGENTS.md §5 forbids a teammate from running
`commit`/`add`/`checkout`, and this task's own objective reserves "the final integration and any
commit" to the captain — the ledger's attribution row (`t11 | Captain | … the commit`) says the same.
The exact path list and message skeleton are in the t11 completion payload so the captain can land it
in one command.

### Observation for the captain (not a finding)

The t11 acceptance requires the commit message to name "the user's five clauses", while t9's clause
table — and the clause table above — enumerate **six**. Both enumerations were authored by the captain;
flagged so the commit message matches whichever is authoritative.

**CAPTAIN RULING (2026-09-19T11:00Z): SIX is authoritative.** The objective carries six distinct
clauses — check-and-fix, README as the how-to place with detailed usage and command invocation,
architecture not expanded there, a separate detailed design document referenced from the README,
explicit acknowledgement of the referenced projects and authors, and install naming every referenced
plugin — and the defect work is clause 1's content, not a seventh clause. The phrase "the user's five
clauses" in the t11 acceptance was my shorthand and is superseded by this table; commit `3e45cac`
enumerates the six.
