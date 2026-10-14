# Zero-write triage — the rebuilt `packages/mpd-tui-plugin/dist/index.js` (wave tui-015)

Subject: the lane finding *"the TUI dist performs ZERO filesystem writes (offenders:
`["writeFileSync","appendFileSync","mkdirSync","rmSync"]`)"*, measured against the rebuilt
`mpd-tui-plugin` dist. Code is cited by SYMBOL and package path (T-55). Nothing under
`packages/*/src` was edited: no defect was confirmed, so this is a triage record only.

## Verdict

**YES, the rebuilt dist legitimately contains file-write calls — and none of them belongs to this
package's own source.** All 13 write-API occurrences are build-time INLINES of two dependency
modules, `bun build` having inlined every import of the entry. The zero-write invariant is TRUE for
`packages/mpd-tui-plugin/src/**` (0 occurrences, 0 own-module offenders) and FALSE for the whole
bundle's bytes, and it was always going to be false for an entry that imports the adapter whose
declared job is to own the file sink. A whole-bundle grep for the four names is therefore not a
sound form of this assertion; the lane's own attribution-aware judge
(`ownModuleWriteOffenders`, `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`) returns `[]` on
these very bytes.

## Where the symbols are: path + symbol + purpose

| # | Module the bytes sit in (dist banner) | Symbols present | What it is |
|---|---|---|---|
| 1 | `packages/mpd-tui-adapter-plugin/src/index.ts` | `mkdirSync`×4, `writeFileSync`×3, `appendFileSync`×2 | Two writers, both by design (below) |
| 2 | `packages/mpd-mcp-shared/log-sink.ts` | `mkdirSync`×2, `rmSync`×2 | The R5 terminal-silence rotating sink |
| 3 | `packages/mpd-tui-plugin/src/**` (all 26 of the package's own modules in this bundle) | **none** | The package consumes a `DiagnosticSink`; `src/log.ts` states the invariant |
| 4 | `packages/mpd-team-core-plugin/src/**` | **not inlined at all** | the entry imports `TeamRecord` as `import type`; the bundler erases it |

The bundle carries 33 distinct module segments (36 banner lines): 26 of them are
`packages/mpd-tui-plugin/src/**`, and 7 are borrowed — `packages/mpd-tui-adapter-plugin/src/index.ts`,
`packages/mpd-dsh-adapter-plugin/src/{index,shared}.ts`, `packages/mpd-mcp-shared/log-sink.ts`,
`packages/mpd-schemastery/lib/{index,cosmokit}.ts` and `packages/mpd-config-plugin/src/settings-schema.ts`.
Of those seven, only the TWO named in the table carry a write API; the other five carry none.

**1a — the diagnostics file sink: `createFileSink` (`packages/mpd-tui-adapter-plugin/src/index.ts`).**
Writes `<workspace-root>/.mpd/logs/<name>` (default `DEFAULT_LOG_NAME = "mpd-tui.log"`, cap
`DEFAULT_LOG_CAP_BYTES = 1_048_576`): `mkdirSync` of the directory, a rotate-by-half `writeFileSync`
past the cap, `appendFileSync` of each line. Reached by `defaultHostInputLog` (the one degradation
line of a failed host-input probe) and by `apply()`'s two boot lines. This is the module §6 designates
as the ONE owner of the file sink on this plane — `packages/mpd-tui-plugin/src/log.ts` says so in
words and takes the sink as a parameter, which is exactly why no writer appears in this package.

**1b — the panel-id provenance record writer: `recordPanelIds` (`packages/mpd-tui-adapter-plugin/src/index.ts`).**
Writes `<workspace-root>/.mpd/logs/mpd-tui-panels.json` (`PANEL_IDS_RECORD_NAME`), a version-3 JSON
record `{version, panelIds, slugs, updatedAt, provenance, history}`, via `mkdirSync` + `writeFileSync`.
It is GATED: `panelRecordProvenance` refuses (and nothing is written) when no installed host package
can be named (root + version), when the host read-back or the id set is empty, when the ids do not
share one activation, or when the activation is the impossible `act0`. The file exists so the
`scripts/mpd-tui-panels.ts` remedy can read back which ids a boot really registered; it is written
from the mounted row's keeper `onChange` closure, never by a unit test.

**2 — the rotating sink: `openLogSink` (`packages/mpd-mcp-shared/log-sink.ts`).**
Takes the MCP child's stderr away from the TUI's alternate screen (requirement R5): `mkdirSync`, an
fd-based `openSync(file, "a")` writer, and rotation through `rmSync(<file>.1)`. It reaches this dist
transitively — `packages/mpd-dsh-adapter-plugin/src/index.ts` imports `openLogSink`, and the
tui-plugin imports the tui adapter. Borrowed bytes twice over.

## The keeper's C2 stand-down path on a ≥ 0.15.0 host

Code path: the keeper's `runTick` probes through `loadPrefs`, evaluates
`hostSelfHealsPanelCsv(probe.hostVersion)` against `PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"`, and on true
calls `standDownToHostUnion(probe.prefs, version)` and **returns before either repair path** — so
`enterFeed` and `decide` are not reached on that tick. The keeper's only writer of the host's enable
list is `writeList` → `prefs.applySidePanelPanels(csv)` (`TuiHostPrefsLike`'s one write member), and
all three of its call sites live inside `decide`. `standDownToHostUnion`'s own body performs no
filesystem call: it settles its state, cancels the ladder, logs one line, and installs the
observe-only belt (`subscribeSidePanelPanels` → `getSidePanelPanels` → release) purely to report
whether the host's union kept our ids.

**So, precisely:**

- **TRUE in the claim's own sense:** the C2 stand-down writes NOTHING into the host's enable CSV and
  never re-asserts a panel id. `applySidePanelPanels` is unreachable from it, so a ≥ 0.15.0 host's
  own union remains the only writer. This is the reading the docstring means ("…the host's own
  `applyConfiguredSidePanelPanels` union is the only writer our ids need").
- **FALSE as a whole-boot filesystem claim:** the same tick still reaches TWO adapter-owned writers.
  `settle()` calls `announce()`, which calls `options.onChange(...)`; on the mounted row
  (`apply()` → `createTuiAdapter(ctx, { probeHostContact: true, keepPanelEnable: true })`) that
  closure calls `recordPanelIds`, so `.mpd/logs/mpd-tui-panels.json` is written when the provenance
  gate proves it. And `options.log` is `defaultHostInputLog` → `createFileSink(...).write(...)`,
  which appends the stand-down line to `.mpd/logs/mpd-tui.log`.
- **Doc precision (reported, not a defect):** the sentence "THE KEEPER WRITES NOTHING on this path"
  is scoped to the enable list by its surrounding paragraph, but read alone it can be taken as
  filesystem silence, which it is not. No code change is proposed here — the two writers are the
  adapter's documented, provenance-gated, `try`-wrapped design.

## Bounds — what this triage does NOT prove

1. **Read, not a runtime observation.** No boot was mounted and no TUI keystroke surface was driven
   for this task. The C2 conclusion is an inspection of `packages/mpd-tui-adapter-plugin/src/index.ts`
   (symbols `hostSelfHealsPanelCsv`, `standDownToHostUnion`, `writeList`, `decide`, `settle`,
   `announce`, `recordPanelIds`, `panelRecordProvenance`) plus the arithmetic of the C2 gate.
2. **Reachability of `recordPanelIds` on the stand-down tick is inferred from the call chain**, not
   witnessed in a live boot: I did not observe the file being written. It is additionally conditional
   on `panelRecordProvenance` not refusing (ids non-empty and traceable).
3. **Observed asymmetry, reported as a BOUND, not as a defect** (I could not demonstrate
   reachability, so I did not raise it as a finding): `standDown()` retires the keeper with
   `cancelLadder()` + `releaseFeedNow()` + `releaseBeltNow()`, while `standDownToHostUnion()` cancels
   the ladder and manages only the belt. A change feed armed by an EARLIER tick — which requires that
   tick to have seen an empty/unparseable/older version from the same `probeHostPrefs` answer while a
   later tick reads a ≥ 0.15.0 version — would survive the C2 stand-down and could still reach
   `decide` → `writeList`. I found no way to reach that state on a stable host (version and store
   come from the SAME probe, and the same tick that reads ≥ 0.15.0 stands the keeper down before
   `enterFeed`), so it is a bound for the verifier, not a claim.
4. The pre-rebuild *working-tree* dist can no longer be re-measured (it was overwritten by the
   rebuild). For provenance I checked the committed blob instead: `git show HEAD:…/dist/index.js`
   already carried the same 13 occurrences (405189 B, 36 banner lines) — the borrowed writers are not
   a regression introduced by this rebuild. `git log -S` puts the adapter bytes into this dist at
   `9e91beb3` (2026-10-03, "feat(seams)!: one adapter per plane…"), after the lane's green runs of
   2026-09-16.

## Lane history (for the single skills writer)

The zero-write `T7` exists ONLY in the settings-bridge lane (`evaluateTuiSurface` in
`skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`); the sibling TUI lanes' `result.json` files carry
no `checks` table at all, so none of them reddens on this assertion.

- `evidence/mpd-bridge/tui-settings-bridge/20260916T142330Z` and `…142859Z` (2026-10-02 mtime):
  `T7` PASS, naive wording — true then, because the adapter was not yet inlined into this dist.
- `evidence/mpd-bridge/tui-settings-bridge/20261014T091837Z` (09:18 UTC): `T7` FAIL, naive wording,
  offenders `["writeFileSync","appendFileSync","mkdirSync","rmSync"]` — the finding triaged here.
- `evidence/tui/dsh-tui-015/q-run/step3-final/settings-bridge.evidence.20261014T102006Z` (10:20 UTC):
  `T7` PASS with the ATTRIBUTION wording ("the TUI package's OWN modules … offenders: []"), i.e. the
  lane's judge in the current tree is already attribution-aware.
- All three were measured on the PRE-rebuild dist (this rebuild landed at 10:27 UTC). Running the
  lane's own `ownModuleWriteOffenders` on the REBUILT bytes returns `[]` as well, so the repaired
  assertion holds on the fresh artifact — the naive byte-absence form does not, and must not be
  restored.

## Honest markers a lane can assert (see `markers.json`, content-free)

Rebuilt artifacts (pinned `bun 1.4.0`, `.toolchain/node_modules/.bin/bun`, canonical repo-root
commands):

- `packages/mpd-tui-plugin/dist/index.js` — sha256
  `8639a39b2c7c9ace6d4c509825f25c053d4e72b358b02994d1e7c229c6a240b1`, 413053 B, 34 modules bundled,
  36 banner lines / 33 distinct modules; from `packages/mpd-tui-plugin/src/index.ts`
  (`9552ca8d4dc07f84f6525a6b511442a38fe9c48a20c1ba62c1002452f1d92bfc`).
- `packages/mpd-tui-adapter-plugin/dist/index.js` — sha256
  `52cbbf2bbd6ae010f0f4c00bf20cdddd95a18edf61bbd8452ed35dae87a5a8bc`, 51702 B; from
  `packages/mpd-tui-adapter-plugin/src/index.ts`
  (`6c6cd5c06acda45999528a1d885c7aea91658a9b3d423d2354fe43935a08d0ab`).

Assertable, and TRUE of these bytes:

- whole-dist presence: `writeFileSync` 3, `appendFileSync` 2, `mkdirSync` 6, `rmSync` 2; `cpSync`,
  `unlinkSync`, `createWriteStream` 0. **Assert presence, never absence** — an "absence" arm is false.
- `ownModuleWriteOffenders(dist) === []` for the TUI dist (the lane's own function, run on these
  bytes), i.e. **0 occurrences inside any `// packages/mpd-tui-plugin/src/**` segment** — the honest
  form of "the TUI package's own modules write nothing".
- attribution budget: 13 attributed occurrences = 13 raw whole-dist occurrences, 0 unattributed
  (fail-closed), split exactly into `packages/mpd-mcp-shared/log-sink.ts`
  {`mkdirSync` 2, `rmSync` 2} and `packages/mpd-tui-adapter-plugin/src/index.ts`
  {`writeFileSync` 3, `appendFileSync` 2, `mkdirSync` 4}.
- `// packages/mpd-team-core-plugin/` is ABSENT from the TUI dist (type-only import, erased) — safe
  as an absence assertion.
- the adapter dist's own module DOES carry `writeFileSync` 3, `appendFileSync` 2, `mkdirSync` 3 — by
  design, since that package is the one owner of the sink; do not assert absence there.
