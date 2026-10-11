# fix/sidebar-defects — REPAIR ROUND R1 (CodeRabbit PR #35, six findings)

- **Writer:** Senior Engineer (repair-round R1 lane). **Branch:** `fix/sidebar-defects` (already checked out; the
  captain owns every git write — **no git command was run by this lane**).
- **Frozen acceptance:** `.mpd/plans/fix-sidebar-defects.md`, section **“Repair round R1”** (ll. 146–186).
- **Findings (raw review data, verified against the code before fixing):** `.mpd/plans/pr35-comments.json`.
- **Evidence root:** `evidence/tui/sidebar-defects-r1/20261011T130904Z/` (machine-readable summary: `result.json`).
- **Write scopes touched:** `packages/mpd-tui-adapter-plugin/**`, `packages/mpd-tui-plugin/**`,
  `scripts/mpd-tui-panels.ts`, `docs/tui.md`, `docs/tui.zh-CN.md`, `evidence/tui/**`.
- **Discipline:** red-first arm for every fix (observed red, then the minimal fix, then observed green),
  `verify:comments` on every touched declaration (English-only), dist rebuilt for **every touched package with
  the PINNED toolchain from the repo root**, then the full gate list below.

## 1. What changed (by finding)

### R1.1 (Major) / R1.2 (Major) — slug ownership → **PROVENANCE ownership** — VALID, FIXED

The old predicate (`panelTokenIsStaleMine`) was wrong in **both** directions at once: it pruned a **live foreign**
`act9:team` because its *slug* matched ours, and it **never** pruned our own dead id whose page had been retired
because no live slug matched it.

- `packages/mpd-tui-adapter-plugin/src/index.ts`
  - `PANEL_ID_HISTORY_LIMIT = 32` — the bound, **documented at the constant** (last N ids, newest last, oldest
    evicted; ~10 boots of slack against a host that renumbers the activation half on every boot).
  - `panelHistoryAfter(current, past)` (NEW, exported, pure) — the fold: the previous record's history **plus its
    own current ids**, minus everything live now, filtered to the host's composed `act<N>:<slug>` shape, capped.
  - `panelTokenIsStaleMine(token, ours, past)` — now act-shaped **and** `past.includes(token)` **and**
    `!ours.includes(token)`. A never-ours token fails the second condition and is never pruned.
  - `PanelIdsRecord` → **schema v3**: `history: string[]` alongside `panelIds`/`slugs`/`provenance`; the recorder
    (`recordPanelIds`) folds the previous record through `panelHistoryAfter` and writes `version: 3`.
  - `readPanelIdRecordPast(root)` (NEW, exported) — the reader both the keeper and the recorder use. It enforces
    the **writer's own provenance rules** over the record's current ids (no `provenance` / blank `hostRoot` /
    blank `hostVersion` / no `readBack` / `act0` ⇒ **no proven past at all**), so a polluted file contributes
    **zero** ownership evidence. Never throws.
  - `mergePanelEnableIds(existing, ours, past)` — third parameter; the prune reads the same evidence.
  - Keeper wiring: `PanelEnableKeeperOptions.pastIds` is **required** (the mounted row passes
    `readPanelIdRecordPast()`, read **per decision**, never cached; a unit arm must state its own past, so no arm
    can silently read the machine's real record).
- `scripts/mpd-tui-panels.ts`
  - `panelTokenIsStaleMine(token, ids, past)` + `mergePanelIds(existing, ids, past)` — the same two conditions,
    restated for a standalone Node entry point that cannot import a bundled package's source.
  - `readIdRecord` now also answers the **past** set (record `history` ∪ its current ids, shape-filtered, deduped,
    lowercased) — and only from a record that passed the provenance rules; `--ids` overrides the ids but **not**
    the past, so the escape hatch still cleans up.
  - The AC/DC bound is stated, not hidden: a **foreign DEAD** id lingering in the list is not ours to clean.

### R1.3 (Major) — prune provably-dead past ids **before** standing down — VALID, FIXED

- The keeper's `present > 0` branch now performs a **prune-only write** (`merge.kept.join(",")`, **never**
  appending) when a provably-dead past id is present, then settles and stands down for good. At the arm-time read
  the same prune runs, and the arm-time rule (never stand down on the host's own append) is unchanged.
- One write/one announce per decision preserved: the new `writeList(prefs, csv)` helper owns the echo guard and
  the read-back and settles **only** on refusal, so the caller owns the single settle line.
- Docs updated in **both** languages: `docs/tui.md` (the keeper bullet, the script bullet, the record paragraph,
  §11.6 lines) and `docs/tui.zh-CN.md` (the same four places).

### R1.4 (Major) — import specifier form — VALID, FIXED (with a reported wording conflict)

`./panel-core.js` → `./panel-core.ts` in `packages/mpd-tui-plugin/src/index.ts:58` and `scenes.ts:52`;
`./panel-core.js` no longer exists in either file (grep, exit 1 = no match). Dist rebuilt; `verify-dist-fresh`
green.

**The measured conflict, reported rather than hidden:** the finding and AGENTS.md §6 say `.ts`
(“every relative specifier carries the explicit `.ts` extension”; `tsconfig` enables
`allowImportingTsExtensions` + `Bundler`, and 72 `.ts` specifiers already ship under `packages/*/src`), while the
contract’s “match the files’ other imports” is **not** satisfiable with `.ts`: those two files’ other relative
imports are `.js` (158 `.js` / 0 `.ts` in the whole package source; repo-wide `packages/*/src` = 200 `.js` /
72 `.ts`). The contract’s hard clause (`./panel-core.js` must not survive) and the manual’s rule were honoured;
**the package-internal `.js` majority is a PRE-EXISTING inconsistency reported as a finding, not absorbed** —
this round did not rewrite the other 158 specifiers.

### R1.5 (Minor) — `setWheelInvertRead` reader — VALID, FIXED

The reader now catches a `configHandle.get()` throw **inside the reader** and returns `resolved.wheelInvert` (the
row config floor), instead of letting `wheelInvertOn()`’s outer catch clamp a knob the row config turned ON to
`false`.

### R1.6 (Minor) — wrong leaf — VALID, FIXED

`blockPanelCsv` and `writePanelsIntoDocument` now share **ONE** leaf walk (`panelsLeafSite`): `config:` →
`sidePanel:` → `panels:` at the block’s own indents, stopping where `sidePanel:` closes (a key at the section’s
indent or shallower), with blank/comment lines transparent. The read-back therefore reads exactly the leaf the
writer edits. Extra evidence: `r16-real-document-probe.ts` runs the exported functions over the **real**
host-written profile patch (`~/.dsh/profiles/dsh-tui/cordis.patch.yml`, in memory only) — real leaf
`todo,jobs,agents`, a decoy `panels:` inserted before `sidePanel:` **skipped**, write/read-back pair **PASS**,
decoy section untouched.

### Outside the six findings (tightening only, each documented)

- `panelRecordProvenance` treats **whitespace-only** `hostRoot`/`hostVersion`/`readBack` as absent — the rule the
  consumer side already applied; the two sides of the record must agree on the same bytes.
- The script’s `unprovableProvenance` now also refuses a blank `provenance.hostRoot`, making its own documented
  claim (“the same conditions the adapter refuses to WRITE a record under”) true.
- The script’s now-dead `panelSlugOf` helper was deleted (its only callers were the slug rule); the adapter keeps
  its own because the record’s `slugs` field uses it.

## 2. Red → green (observed)

| Fix | RED (before) | GREEN (after) |
|---|---|---|
| R1.1 | `red-keeper.log`: 1 failed arm on the write path; `red-script-selftest.log`: `FAIL (R1.1) a LIVE foreign act9:team … is never pruned` | `green-tui-plugin-tests.log`, `green-script-selftest.log` |
| R1.2 | `red-keeper.log`: `FAIL R1.2 a RETIRED page's id … is pruned`; `red-script-selftest.log`: 2 FAIL arms | same |
| R1.3 | `red-keeper.log`: `FAIL R1.3 a CURRENT id of ours no longer protects a provably-dead past id` (nothing written) | `green-tui-plugin-tests.log` |
| R1.4 | `red-r14-import-form.log`: two `from "./panel-core.js"` lines | `final-gates-and-r14.log`: no match (exit 1), both files now `.ts` |
| R1.5 | `red-plugin-test.log`: `FAIL R1.5 … still scrolls inverted` | `green-tui-plugin-tests.log` |
| R1.6 | `red-script-selftest.log`: 3 FAIL arms | `green-script-selftest.log`; `r16-real-document-probe.log` over the real patch |

RED run of the touched suites before the fix: **4 keeper/plugin arms + 6 script arms failed**; after: **0 fail**.
The record-level arms added to `adapter-hosts.test.ts` (`panelHistoryAfter` bound/fold/shape, `readPanelIdRecordPast`
refusals + negative control) could not exist before the API did — their red is the absent export, and that is
stated rather than dressed up as an assertion failure.

## 3. Gates (real tails; full logs in the evidence dir)

| Command | Exit | Observed |
|---|---|---|
| `bun test packages` | 0 | `1812 pass` `3 skip` `0 fail` — `23753 expect() calls` — `1815 tests across 112 files [20.56s]` |
| `bun run typecheck` | 0 | `tsgo --noEmit`, no diagnostics |
| `bun run verify:comments` | 0 | `scanned 385 TypeScript file(s) of 385 … 34122 declaration(s) … VERDICT: PASS` |
| `.toolchain/node_modules/.bin/bun build packages/mpd-tui-adapter-plugin/src/index.ts …` | 0 | `Bundled 1 module … index.js 47.29 KB` |
| `.toolchain/node_modules/.bin/bun build packages/mpd-tui-plugin/src/index.ts …` | 0 | `Bundled 34 modules … index.js 0.39 MB` |
| `node scripts/verify-dist-fresh.ts` | 0 | `ok: 31/31 targets fresh (each rebuilt twice, byte-identical)` — both touched packages `FRESH` |
| `bun run verify:docs` | 0 | `pairs=47 failed=0 violations=0 links=436 dead=0 — PASS` |
| `bun run verify:gates` | 0 | `PASS - 8/8 member gate(s) green` (vendor, dist-fresh, rows-parity, docs-parity, preset-conformance, plugin-manifest, comment-coverage, workflows) |
| `node scripts/mpd-tui-panels.ts --self-test` | 0 | `SELF-TEST PASS (all arms held)` — 43 ok arms |
| `node skills/dsh-qa/scripts/tui-panels.ts --self-test` | 0 | `ok: 8 surfaces asserted, negative controls fail as required` |
| `node skills/dsh-qa/scripts/tui-panels.ts` | 0 | **DOCUMENTED SKIP**: `[mpd-qa] SKIP case=tui-panels lane=real reason=absent-fixture prereq=tui profile in the sandbox root remedy="bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"` — the contract’s 2026-10-11 amendment admits this marker with the captured remedy |

## 4. What I could NOT prove (honest bounds)

1. **No real TUI boot in this lane.** The keeper’s arms drive a store double; the QA lane’s real case printed its
   documented `SKIP` marker. The live proof is the **M4 docker lane**, which is the captain’s step.
2. **No live `tuiPanels.list()` read-back was exercised here.** The provenance/read-back path is the wave’s,
   unchanged, and its existing arms still pass — but this round did not re-measure it against a mounted host.
3. **The workspace’s real `.mpd/logs/mpd-tui-panels.json` was not rewritten** (no boot ran): the v3 shape is
   proven by unit arms and by the writer/reader pair, not by a real boot’s bytes.
4. **The prune only matches `act<N>:<slug>`** (the host’s composed form for a loader row). A future host that
   composes our row id in another shape would stop pruning — a documented, pre-existing bound kept on purpose.
5. **A hand edit of the record’s `history` can name ids this bundle never registered**; the shape filter cannot
   tell, and the provenance rules are the guard against the **MEASURED** pollution class, not against a
   deliberate local edit of a file the user owns.
6. **R1.4’s form conflict** (finding/manual `.ts` vs the files’ `.js` neighbours) is a decision carried with its
   measurement, not a provable equivalence.

## 5. Evidence index (`evidence/tui/sidebar-defects-r1/20261011T130904Z/`)

`result.json` (machine-readable disposition) · `red-keeper.log` · `red-script-selftest.log` ·
`red-plugin-test.log` · `red-r14-import-form.log` · `green-tui-plugin-tests.log` · `green-packages-tests.log` ·
`green-adapter-tests.log` · `green-script-selftest.log` · `build-dist.log` · `typecheck-and-comments.log` ·
`verify-dist-fresh.log` · `verify-docs.log` · `verify-gates.log` · `final-sweep.log` ·
`final-gates-and-r14.log` · `qa-lane-selftest.log` · `qa-lane-real.log` · `r16-real-document-probe.ts` ·
`r16-real-document-probe.log` · `bun-test.log`

## 6. Working-tree hygiene

- **No git command was run** (branch, index and history untouched by this lane).
- Files modified outside this evidence dir are exactly: the two adapter files (src + rebuilt dist), the three
  adapter test files, the three tui-plugin source files (two of them for R1.4/R1.5) + its rebuilt dist, the two
  tui-plugin test files, `scripts/mpd-tui-panels.ts` and the two `docs/tui*.md` — every path inside the declared
  write scopes.
- One scratch side effect of running the documented QA lane: `.qa-tmp/npm-cache/**` (gitignored) — the lane's own
  cache while it probed for its fixture; it then printed its documented `SKIP` marker. `dist/mpd-package/**`
  (20:35) and `.mpd/plans/**` (21:00/21:04) predate this session and were **not** touched here.
