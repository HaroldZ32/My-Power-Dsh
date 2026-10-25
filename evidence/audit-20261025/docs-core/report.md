# docs-core lane — audit wave 2026-10-25

Lane: `docs-core` (team `audit-20261025`, shared task **T1**).
Contract: `.mpd/plans/audit-20261025-fixes.md` §5, items **A-01 … A-10**; **A-08(b) excluded** (the
captain closes it at integration — it was NOT touched).
Branch: `fix/audit-20261025`. No git write command was run by this lane.
Date of every measurement below: **2026-10-25** (Asia/Shanghai session, UTC stamps quoted where the
artifact carries one).

Edited paths (18 files, all inside the lane scope `README*.md`, `docs/**`, `AGENTS.md`):

```
AGENTS.md
README.md, README.zh-CN.md
docs/design.md, docs/design.zh-CN.md
docs/development.md, docs/development.zh-CN.md
docs/extensions.md, docs/extensions.zh-CN.md
docs/independence.md, docs/independence.zh-CN.md
docs/plan-webui-tui-i18n.md
docs/tui.md, docs/tui.zh-CN.md
docs/tui-parity.md, docs/tui-parity.zh-CN.md
docs/user-guide.md, docs/user-guide.zh-CN.md
```

## Checks run (quoted, with exit codes)

| Check | Command | Observed |
|---|---|---|
| Doc pairs / links | `bun run verify:docs` | `[verify-docs-parity] root=… pairs=50 failed=0 violations=0 exempt=24 derived=3 links=447 dead=0 — PASS` — **exit 0** |
| Manual paths | `node scripts/verify-manual-paths.ts` | `PASS resolved=153 over-report=74 under-report=78 declared=2 (every audited path exists; …)` — **exit 0** |
| Manual size | `wc -c AGENTS.md` | **63902** bytes (was **63763** before this lane; budget is ≤ 65024 — `65024 − 63902 = 1122` B of headroom) |
| Row parity (for A-04's quoted line) | `bun run verify:rows` | `[verify-rows-parity] ok: 36 row ids match the 2-file bundle patch layer` — **exit 0** |

**Repair pass 2 (A-11 / A-12 / A-13) re-ran both gates on the final tree:** `bun run verify:docs` →
`pairs=50 failed=0 violations=0 exempt=24 derived=3 links=449 dead=0 — PASS`, **exit 0** (449 links: the
two new §9.1 pointers); `node scripts/verify-manual-paths.ts` → `PASS resolved=153 over-report=74
under-report=78 declared=2`, **exit 0**; `wc -c AGENTS.md` → **63902** (AGENTS.md unchanged in this
pass).

Bound on the `AGENTS.md` size: the manual's §3 asks for "at least 2 KB below the 65536 cut" in
addition to the ≤ 65024 target. This lane ends at 63902 B, i.e. **1634 B below the cut** — 414 B
short of the 2 KB advisory. The pre-edit file was already 63763 B (1773 B below the cut), so the
shortfall mostly pre-dates this lane; A-07 itself is byte-neutral (57→58, 33→34) and the +139 B come
from the captain-approved A-05/G-§8 registry correction.

## Item-by-item

### A-01 — TUI default preset claim (HIGH) — DONE

Changed `docs/tui.md` §1 table row "TUI composition", §2 row-count sentence and §2 preset paragraph;
`docs/tui.zh-CN.md` the three twin places.

- Deleted: "A TUI session defaults to the **mpd** preset, carried by the id-targeted
  `agent-preset-registry` row (`default: mpd`) …".
- Replaced with the measured truth: the default row is HOST-declared (`agent-preset-registry` by
  `@deepseek-ai/dsh-web-app` on the web plane, `dsh-tui-agent-preset-registry` by
  `@deepseek-harness-tui/dsh-tui` on the TUI plane); the bundle ships no id-target against either;
  `mpd` is opt-in through `/preset mpd` (host `presetPrefs.js` → `~/.dsh-tui/agent-preset.json`),
  an explicit `preset: mpd` / `DSH_TUI_PRESET=mpd`, the Web Settings `selectedDefault`, or
  `node scripts/set-default-preset.ts --yes` (dry-run by default).
- Row count: "24 rows" → **36** (35 in `cordis.patch.yml` + 1 in `presets/mpd.patch.yml`).

Code evidence opened this session:
`cordis.patch.yml` — the "preset selection: the deployment default is HOST-OWNED and never
id-targeted" comment block (both removed blocks `agent-preset-registry` and
`dsh-tui-agent-preset-registry` are recorded there, "REMOVED (strict zero-override, user decision
2026-10-02)"); `scripts/verify-no-host-override.ts` header (the gate's subject and its failure rule);
`scripts/set-default-preset.ts` header + `--yes` usage (dry-run default; `presetPrefs.js`,
`agent-preset.json`); `docs/preset-default.md` §1 and `docs/user-guide.md` §7 as the already-true
wording. Row count: `grep -c '^    - id:' cordis.patch.yml` → **35**, same for
`presets/mpd.patch.yml` → **1**, and the gate prints **36** (above).

Not fixed (outside the item's §2 letter, reported): `docs/tui.md` §"settlement ledger" still carries
two derived-claim rows that repeat the removed design — see **Out-of-scope findings** below.

### A-02 — deleted MCP build step documented as current (HIGH) — DONE

Changed `docs/development.md` §1 layout entry, §2 paragraph, §8 first bullet; same three places in
`docs/development.zh-CN.md`.

- Removed the dead `scripts/build-mcp.ts` layout entry and the dead `vendor/mcp-src/**` snapshot
  sentence.
- New §2 text: **no MCP build step** — the servers are DECLARED npm packages started by thin
  launchers (`resolveDependencyEntry` in `packages/mpd-mcp-shared/dependency-entry.ts` for `cclsp`,
  `@cyanheads/git-mcp-server`, `mcp-server-commands`; the adopted ast-grep/codegraph artifacts ship
  beside their launchers in each `dist/`), and the one runtime-resolved executable is the `ast-grep`
  binary through `resolveAstGrepBinary` (`packages/mpd-mcp-shared/bin-resolve.ts`): caller env pin →
  `$MPD_AST_GREP_BIN_DIR/{ast-grep,sg}` → the package's own `bin` via `createRequire` →
  `<bundle>/.toolchain/node_modules/.bin` → `<bundle>/node_modules/.bin` → unset (adopted
  `BINARY_NOT_FOUND`).

Code evidence: `package.json` (`optionalDependencies` = `@colbymchenry/codegraph`, `cclsp`,
`@cyanheads/git-mcp-server`, `mcp-server-commands`); `packages/mpd-mcp-lsp/src/launch.ts` and
`packages/mpd-mcp-gitbash/src/launch.ts` headers (what replaced what; `resolveDependencyEntry`);
`packages/mpd-mcp-astgrep/src/launch.ts` + `packages/mpd-mcp-shared/bin-resolve.ts` (five tiers);
`ls scripts/build-mcp.ts` and `ls -d vendor` both **ENOENT**; `packages/mpd-mcp-astgrep/dist/cli.js`,
`packages/mpd-mcp-codegraph/dist/serve.js` exist beside `dist/launch.js`.

### A-03 — wrong team-messaging argument name (HIGH) — DONE

Changed `docs/user-guide.md` §6 code block + durable-message prose + "call shapes" block, §13.1(d),
§13.9; every twin location in `docs/user-guide.zh-CN.md`.

- `send_message { target … }` → `{ agent_id … }`: the §6 signature line plus **4** JSON bodies in
  EN (and the same 5 places in zh); `interrupt_agent { target }` → `{ agent_id }`: the §6 signature
  line plus **3** JSON bodies in EN (same 4 places in zh); plus the durable-message prose
  ("`list_agents` reports each member's `target`" → `agent_id`) and the `# targets + availability`
  comment → `# agent ids + availability` (both languages). Verified by `grep -n agent_id` over both
  files: EN 10 lines / zh 11 lines, zero remaining team-messaging `target`.
- (a) §12 "**five** commands … Nothing else exists" → "**six** commands …" and a new `/mpd-model` row.
  Evidence: `packages/mpd-tui-plugin/src/commands.ts` `registerCommands` calls
  `tui.registerCommand({ name: MODEL_COMMAND, … handler: actions.openModelMenu })`;
  `packages/mpd-tui-plugin/src/command-trees.ts` `MODEL_COMMAND = "mpd-model"`; the menu's own
  contract in `packages/mpd-tui-plugin/src/model-menu.ts` (slot → provider → model → effort, writes
  `teamModels.<slot>.<leaf>`, cancel writes nothing, absent dialogs seam says so). The row is marked
  **TUI only** because it is registered through the TUI command seam.
- (b) §1 "**three** runtime dependencies" → "**four**" naming `@dsh-std/sdk`; evidence `package.json`
  `dependencies` (3 agent-team packages + `@dsh-std/sdk@0.1.1-rc.2`) and
  `node_modules/@dsh-std/sdk/package.json` description ("Scoped TypeScript helpers for DSH Standard
  facet activation modules").
- (c) §14 ast-grep attribution row: no longer claims `@ast-grep/cli` is an `optionalDependencies`
  entry; states the runtime resolution chain (`resolveAstGrepBinary`) and points at
  `packages/mpd-mcp-shared/bin-resolve.ts`.

`wait_agent` parameter (contract asked me to verify before touching): left as
`wait_agent { timeout_ms }`. The mounted official tool package
`node_modules/@deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js` registers `wait_agent` with
`parameters: { timeout_ms: { type: "integer", … from 10000 through 3600000. Defaults to 30000 } }` —
the docs' claim is true.

Declared basis for `agent_id` (and one tension, recorded not hidden): the HOST's own package
`@deepseek-ai/dsh-tool-subagent-control` (installed harness, `README.md` §"generated schemas") states
"`send_message` takes `agent_id` and `message`; `interrupt_agent` takes `agent_id`; `list_agents`
takes no parameters", and this session's own tool pack exposes exactly those shapes. **Tension:** the
official Agent Teams tool package above registers its OWN `send_message`/`interrupt_agent` with
`target`. Both rows are in this preset's composition (AGENTS.md §5 rule 5 names the base rows as the
ones that stay), so which duplicate-name registration a live session actually sees is a composition
question this lane did **not** boot-verify; the frozen contract instructs `agent_id`, the host package
that documents it is the base control package, and the repo's own skills spell `send_message(agent_id=…)`.

### A-04 — stale dependency/row counts in design.md (MEDIUM) — DONE

Changed `docs/design.md` §2 (two places: the "what is added" bullet and the "it contributes" bullet),
§2 manifest-invariants bullet, §4 opening paragraph; twins in `docs/design.zh-CN.md`.

- "33 inserted plugin rows (6 MCP client rows, 23 `mpd-*` …)" → **35 (7 MCP client rows, 24
  `mpd-*` plugin rows …)**, keeping the 3 official Agent Teams rows and the `mpd-better-sidebar` row
  as separate classes: **7 + 24 + 3 + 1 = 35**.
- §2 "THREE `dependencies` entries" → **FOUR**, plus `@dsh-std/sdk` (`0.1.1-rc.2`).
- §4 "33 `insert` rows … `ok: 34 row ids match`" → **35** and the gate's real line
  `ok: 36 row ids match the 2-file bundle patch layer`, i.e. 35 + `preset-mpd`.

Measurements: `grep -c '^    - id:' cordis.patch.yml` = 35; the 7 mcp-client ids are
`mcp-astgrep, mcp-git, mcp-shell, mcp-lsp, mcp-codegraph, mcp-context7, mcp-grepapp`; the file still
has **5** top-level `insert:` lists (the count method sentence stays true); `bun run verify:rows`
quoted above; `package.json` `dependencies` (4).

### A-05 — stale release + install section (MEDIUM) — DONE with a contract amendment

Changed `README.md` badge + Changelog sentence, `README.zh-CN.md` badge + Changelog sentence.

- `version-0.15.1` → `version-0.15.4` (both badges); "the current release is **v0.15.1**" →
  **v0.15.4** (both languages).
- Evidence for 0.15.4: `package.json` `.version`, `dsh-plugin.json` `.version`,
  `dsh-distribution.json` `.distribution.version` all read **0.15.4**; `CHANGELOG.md` top section
  `## v0.15.4`.

**Contract premise corrected by measurement (captain AMENDMENT 1, received mid-lane).** The contract
asked to make the GitHub spec the primary install and demote `@mpd-dsh/mpd` to "once published".
The captain measured `npm view … @mpd-dsh/mpd version` → **0.15.4**, i.e. the package IS published.
The amendment kept the registry spec primary. I had already applied the contract's original text and
**reverted it**: `README.md` / `README.zh-CN.md` now carry the original registry install block
unchanged (`git diff` on the two files is exactly the two version lines each), and the checkout
install stays the repository-tracking alternative. I also corrected `AGENTS.md` §8's stale
parenthetical (captain-approved optional): it now reads "`dsh plugin --profile web add @mpd-dsh/mpd`
— LIVE on the registry at **0.15.4** (measured 2026-10-25); `dsh plugin --profile web add
github:HaroldZ32/My-Power-Dsh` is the same one command from the repository (and the Docker lane's
proof spec, §4)."

### A-06 — independence census drifted (MEDIUM) — DONE

Changed `docs/independence.md` §1.1 (both paragraphs) and `docs/independence.zh-CN.md` §1.1.

- "Measured 2026-10-02: **30 package directories, 26 …**" → "Measured 2026-10-25: **34 package
  directories, 31 of them carrying their own `package.json`**", with the method quoted inline
  (`ls -d packages/*/ | wc -l`; `ls packages/*/package.json | wc -l`).
- "The four that carry none … `mpd-tui-adapter-plugin` is being created by this same wave" → "The
  **three** that carry none": `mpd-codegraph-plugin` (mounted through the root `exports` wildcard
  `./packages/*`), `mpd-mcp-codegraph` (started through the `dist/launch.js` built from its own
  `src/launch.ts`, named by the `mcp-codegraph` row), `mpd-mcp-shared` (shared source module tree the
  launchers import relatively, inlined into each consumer's `dist/`).
- "zero `@mpd-dsh/*` specifiers across all 26 manifests" → re-measured **31 manifests, 0 cross-package
  `@mpd-dsh/*` dependency declarations** (script over `dependencies` / `devDependencies` /
  `peerDependencies` / `optionalDependencies`; the 31 raw `@mpd-dsh/` hits in the grep are each
  manifest's own `name`).

Measurements: `ls -d packages/*/ | wc -l` → 34; `ls packages/*/package.json | wc -l` → 31;
missing-manifest loop → `packages/mpd-codegraph-plugin/`, `packages/mpd-mcp-codegraph/`,
`packages/mpd-mcp-shared/`; `node -e` manifest scan → 31 manifests, 0 cross-mpd deps; root
`package.json` `exports` carries `./packages/*`; `cordis.patch.yml` `mcp-codegraph` row args build
`…/node_modules/@mpd-dsh/mpd/packages/mpd-mcp-codegraph/dist/launch.js`.

Not fixed (outside A-06's §1.1 letter): §1.2 of the same doc quotes "23 distinct
`packages/*/dist/*.js` row targets" — measured **28** today; see Out-of-scope findings.

### A-07 — JavaScript census off by one (LOW) — DONE

Changed `AGENTS.md` §6 bullet: "**57 files** … 33 `packages/*/dist/**` build artifacts" → "**58
files** … 34 `packages/*/dist/**` build artifacts", same sentence shape, no added budget (the two
numerals are byte-identical in length).

Measurement (re-run): `git ls-files 'packages/*/dist/*.js' | wc -l` → **34**; `git ls-files
'*.js'` under `packages/mpd-bundle-plugin` → the 2 browser bundles (`client.js`,
`adopted/agent-teams-client.js`); `git ls-files 'skills/**/*.mjs' | wc -l` → **20** plus the 2
`skills/ultimate-browsing/engine/templates/*.js` → 22 skill-corpus files. 34 + 2 + 22 = **58**.

`wc -c AGENTS.md` after both AGENTS.md edits: **63902** (quoted above).

Not fixed (outside A-07's scope): `agent-references/troubleshooting.md` still says "exactly **57**
remain (measured 2026-10-21) … 33 `packages/*/dist/**`". That file is agent-facing and not in this
lane's editable scope — flagged for the captain.

### A-08(a) — tui-parity D2 label (LOW) — DONE; A-08(b) NOT TOUCHED

Changed `docs/tui-parity.md` D2 heading "STILL OPEN" → "CLOSED-BY-DE-VENDOR — no subject left" and
the zh twin (`docs/tui-parity.zh-CN.md`: "仍未修复" → "已由去 vendor 波次关闭 —— 已无主体"). The D2
history sentence (the measured tree `packages/mpd-agent-teams-plugin/lib/client.js` was deleted by
the de-vendor wave; the row is anchored to the nearest measured surface) is kept verbatim.

**A-08(b) deliberately untouched** per the brief: `docs/tui-parity.md` §5's "CONTAINED, NOT FIXED"
bound is the captain's integration-time closure; this lane neither read the code-fixer's
`taskDepths()` change for a verdict nor re-labelled the sentence.

### A-09 — plan §8-final four stale "STILL OPEN" items (LOW) — DONE

Changed `docs/plan-webui-tui-i18n.md` §8-final only: the section lead "**STILL OPEN, …**" →
"**RESOLVED SINCE — each item keeps its original cause … and names the measured artifact that closed
it:**", and one **Closed by:** sentence appended to each of items 1–4. The items' history text and
the rest of the plan are untouched (the §8-i18n-gap section after it is untouched).

Artifacts verified before writing (not merely cited):

1. `evidence/gates/qa-selftest-repair/20261022T172600Z/result.json` — `gates[]` entry
   `.toolchain/node_modules/.bin/bun run test:qa`, `exit: 0`, observed `51 runner entries (49 case
   scripts + 2 extensions/mpd-ext CLI steps), every one green, final line [test:qa] all self-tests
   passed`.
2. `evidence/docker/client-install-oneclick/2026-10-25T09-51-46Z/result.json` — `ok: true`,
   `summary` = 122 total / **108 passed / 0 failed / 14 null**; all **22 `tui.*`** assertions true,
   including the three the item named (`tui.noDirectTuiSeam`, `tui.boot`, `tui.mergedPanelOrder`);
   the 14 nulls are `build.*`, `pack.distFreshRebuild*`, `ui.*` (declared bounds, no TUI arm).
   `driver.json` shows this really is the oneclick lane:
   `MPD_E2E_INSTALL_MODE=oneclick`, `MPD_E2E_INSTALL_SPEC=github:HaroldZ32/My-Power-Dsh#v0.15.4`,
   service `mpd-oneclick`, status 0.
3. Oneclick lane existence: `scripts/docker-e2e.ts`'s `caseSlug` routes `--mode oneclick` to
   `client-install-oneclick`; that directory holds **54** stamps, **29 green**, first
   `2026-09-28T16-32-12Z`, latest `2026-10-25T09-51-46Z` (counted by script over `result.json`).
4. Pack: `dist/mpd-package/package.json` `.version` = **0.15.4** = root `.version` (measured
   2026-10-25). The item's own text already states byte freshness is the closure gate's subject, and
   the appended sentence repeats that bound instead of claiming freshness.

### A-10 — YAML flows called a follow-up (LOW) — DONE

Changed `docs/extensions.md` §11 bullet and the `docs/extensions.zh-CN.md` twin: "YAML flows are a
follow-up" → "**JSON flow files only, BY DESIGN** — a closed product decision, not a pending one: a
flow corpus is read with `JSON.parse`, the zero-dependency rule forbids the runtime ever gaining a
YAML parser, and YAML is **not planned**", keeping the declarative/no-state-machine sentence.

Code evidence: `packages/mpd-ext-plugin/src/flows.ts` header — "v1 is JSON only BY DESIGN
(zero-dependency rule); YAML is NOT planned. A flow corpus is read with `JSON.parse`, and the runtime
must never gain a YAML parser dependency — so this is a closed product decision, not a pending one."

### A-11 — blanket "no restart" settings claim (HIGH, repair pass 2) — DONE

Changed `docs/tui.md` §settings — the "base is fixed for the process lifetime" paragraph and the
"Timing" bullet — and both twins in `docs/tui.zh-CN.md`. The blanket sentence ("the shipped sentence
now says the save **takes effect in the RUNNING process — no restart**") is replaced by the scoped
truth:

- LIVE (no restart): `teamModels.slot*`, `modelchain.*`, `watchdog.*`, `team.stateDir`, `team.gate`,
  `team.sensitivity`, `captain.investigation`, `delegation.gate`; `tui.dashboardKey` is ONE-WAY (its
  per-press read can turn the Ctrl+A takeover OFF live, but the contact is registered at `apply()`, so
  turning it back ON waits for a boot).
- RESTART (captured inside a row's own `apply()`): `hashline.*`, `commentChecker.*`, `ulw.*`,
  `memory.*`, `boulder.dir`, `goal.*`, `extensions.*`.
- The paragraph now points at `docs/user-guide.md` §9.1 as the canonical per-knob table; **§9.1 was
  NOT edited** (`git diff -- docs/user-guide.md` contains only the A-03/A-05 hunks; no §9.1 line).

Code evidence opened this session: `packages/mpd-config-plugin/src/settings-schema.ts`
`BRIDGE_DISCLOSURE` ("takes effect in the RUNNING process — no restart: … the model routes
(teamModels, modelchain) are read per use") and `BRIDGE_RESTART_LIMIT` ("a captured knob keeps its
captured value until the next dsh boot"); `packages/mpd-tui-plugin/src/settings.ts`
`SECTION_NOTICE = BRIDGE_DISCLOSURE + BRIDGE_NOT_LOST` and the header's "one class only: a knob some
plugin CAPTURED at its own mount"; `packages/mpd-roles-plugin/src/captain-investigation.ts` and
`delegation-gate.ts` headers ("mounted `mpdConfig` service first … picked up LIVE, T-18");
`packages/mpd-roles-plugin/src/session-gate.ts` ("the per-call config read (`team.gate`,
`team.sensitivity`, …)"); `packages/mpd-tui-plugin/src/index.ts` `dashboardKeyEnabled` (per-press read)
vs the apply-time registration under `dashboardKey`.

**Source finding for the CODE lane (not a doc defect):** the TUI `/settings` section description
renders `SECTION_NOTICE` — `BRIDGE_DISCLOSURE` + `BRIDGE_NOT_LOST` — and NOT `BRIDGE_RESTART_LIMIT`
(the Web card does render the limit, `settings-card.ts`). The blanket reading therefore has a code
origin in the TUI hint; a docs-only pass can scope the PAGE (done) but not the on-screen string.
`packages/**` is outside this lane — reported, not changed.

Docs-band grep after the rewrite (`grep -rn "no restart\|无需重启\|no-restart" docs/*.md`): remaining
hits are (a) the new scoped sentences, (b) `docs/extension-authoring-guide.md` project-plane
skills/flows sentence — already scoped by the table above it (project plane = per call; user/bundle =
restart) and about the extension corpus rather than these knobs, (c)
`docs/plan-team-watchdog-report.md`'s process record (exempt; watchdog knobs ARE live).

### A-12 — stale tui.md ledger rows (MEDIUM, repair pass 2) — DONE

Changed `docs/tui.md` §6 `mpd-bundle` ledger row and the statement-group row "Install / triple
layering / 24 rows / … / mpd preset default", plus both `docs/tui.zh-CN.md` twins. Each keeps its
history and is re-labelled as superseded by §2: the ledger row now says the `agent-preset-registry`
id-target was REMOVED on 2026-10-02 under strict zero-override; the statement row now reads **36 rows**
(35 `cordis.patch.yml` + 1 `presets/mpd.patch.yml`) and "mpd preset AVAILABLE (not the default)",
keeping the t5/t8/t9 backing for the layering and crash-signature halves only.

### A-13 — independence §1.2 row-target count (LOW, repair pass 2) — DONE, with a number correction

Changed `docs/independence.md` §1.2 and `docs/independence.zh-CN.md` §1.2. Measured 2026-10-25:
**24** distinct `packages/*/dist/*.js` row targets by `name:` value —
`grep -oE "name: '@mpd-dsh/mpd/packages/[a-z0-9-]+/dist/[A-Za-z0-9._-]+\.js'" cordis.patch.yml | sort -u | wc -l`
→ **24**. The **28** in my first report was the count of *every* `dist/` path occurrence in the file;
the four extra are the MCP launchers' `dist/launch.js` paths inside row `args:` (`mcp-astgrep`,
`mcp-gitbash` on two rows, `mcp-lsp`, `mcp-codegraph`), which are not row targets. The page now states
the number AND the counting method, so the distinction is visible.

---

## Out-of-scope findings

Measured 2026-10-25, each in a file this lane edited but in a section the original item did not name.
Items 1–3 were **later promoted into this lane** by the captain's repair pass and are now FIXED as
A-12 and A-13; item 4 stays open and outside the lane.

1. **FIXED (A-12).** `docs/tui.md` settlement-ledger row: "composed config rows incl. `mpd-tui` and the
   `agent-preset-registry` id-target" — was false (the bundle ships no id-target); re-labelled as
   superseded by §2.
2. **FIXED (A-12).** `docs/tui.md` / `docs/tui.zh-CN.md` settlement-ledger row: "Install / triple
   layering / 24 rows / 0 crash signatures / mpd preset default" — now 36 rows and "mpd preset
   AVAILABLE (not the default)", history kept.
3. **FIXED (A-13), with a number correction.** `docs/independence.md` §1.2 said "23 distinct
   `packages/*/dist/*.js` row targets". The corrected figure is **24** by `name:` value
   (`grep -oE "name: '@mpd-dsh/mpd/packages/[a-z0-9-]+/dist/[A-Za-z0-9._-]+\.js'" cordis.patch.yml |
   sort -u | wc -l` → 24); my first report's **28** counted every `dist/` path occurrence, which
   includes the `dist/launch.js` paths in row `args:` — not row targets. The page now states 24 AND
   the counting method.
4. **OPEN, outside the lane.** `agent-references/troubleshooting.md` still says 57 JS files / 33 dist
   targets (A-07's number; the file is agent-facing and outside this lane's editable scope).

### T8 — development.md QA-row quoted the retired restart claim (repair pass 3) — DONE

Changed the `docs/development.md` §"QA case" table rows `tui-settings-bridge` and `tui-panels`, plus the
`docs/development.zh-CN.md` twins.

- `tui-settings-bridge` row: the quoted disclosure `a save writes <workspace>/.mpd/mpd.jsonc … after a
  restart` is the RETIRED text. The row now states what the case actually asserts, against the built
  bytes: the bridge disclosure (`a save writes <workspace>/.mpd/mpd.jsonc`) AND its LIVE half
  (`takes effect in the RUNNING process` — a dist that dropped it for `waits for a restart` is what the
  negative control rejects), the "not bridged" sentence DELETED, the `no-live-session` notice present
  AND wired into the status line, the "never lost" clause, and zero filesystem writes by the package's
  OWN modules. It also says the lane asserts NO per-knob restart bound (that is user-guide §9.1).
- `tui-panels` row (adjacent, same stale class — reported): "bridge+restart disclosure" → "bridge +
  live-refresh + 'never lost' disclosure", because the TUI section description is
  `SECTION_NOTICE = BRIDGE_DISCLOSURE + BRIDGE_NOT_LOST` and carries no restart sentence.

Code evidence opened this session: `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`
`evaluateTuiSurface` — T1 `dist.includes("a save writes <workspace>/.mpd/mpd.jsonc")`; T2
`dist.includes("takes effect in the RUNNING process")` ("a save is served in-process, never 'after a
restart'"); T3 absence of `not bridged: a save here does not rewrite`; T4 the §D.2 notice; T5
`NO_LIVE_SESSION_NOTICE` + `statusLine(`; T8 "never lost" + "applies it to every workspace
immediately"; T7 `ownModuleWriteOffenders` = 0. The `static` arm repeats the string checks as S1–S3,
and the self-test arms swap the live half for `waits for a restart` (T2/S2) or inject the stale `not
bridged` sentence (T3/S3), so falsifiability is recorded. `skills/dsh-qa/scripts/tui-settings-bridge.ts`
header states the same three claims.

Grep of the docs band for `after a restart` after the edit: remaining hits are the per-knob §9.1 table
(canonical, NOT edited), the new retired-quote sentence in this row, `docs/preset-default.zh-CN.md`
(a persisted preference that survives restarts — a different claim), and
`docs/tui-edition-report.md` (a prior-phase PROCESS RECORD whose historical wording is intentionally not
rewritten).

Re-ran `bun run verify:docs` on this tree: `pairs=50 failed=0 violations=0 exempt=24 derived=3
links=449 dead=0 — PASS`, **exit 0**.

### T9 — tui.md conflated the two `applies` answers (repair pass 4) — DONE

Changed the `docs/tui.md` §settings "Timing" bullet and the `docs/tui.zh-CN.md` twin.

- Deleted the claim that the `apply()`-captured consumers are "the exception the bridge report's
  `applies: 'live'` documents" — the report does not document that exception.
- Replaced with the two-literal truth: `BridgeReport.applies` is TYPED `"live"`
  (`packages/mpd-config-plugin/src/bridge.ts`) because the VALUE is served in the RUNNING process,
  while the namespace registration answers the HOST with `applies: "restart"` —
  `dsh.settingsRegister(…)` in `packages/mpd-config-plugin/src/index.ts` and this package's
  `settings.ts` `registerSettingsNamespace(…)` both pass that literal. The bullet now says the
  report's `live` does NOT cover every consumer's behaviour, that the `apply()`-captured knobs need a
  `dsh` restart, and that `docs/user-guide.md` §9.1 is the canonical per-knob table (NOT edited).

Code evidence opened this session: `settingsRegister(SETTINGS_NS, SettingsSchema, { base, applies:
"restart" })` in `packages/mpd-config-plugin/src/index.ts` (also logged: "registered the "mpd"
namespace with the file-derived base (applies:'restart', design §10.1)"); `registerSettingsNamespace(
SETTINGS_NS, SettingsSchema, { applies: "restart" })` in `packages/mpd-tui-plugin/src/settings.ts`;
`BridgeReport` `readonly applies: "live"` plus every `return { …, applies: "live" }` in `bridge.ts`;
`skills/dsh-qa/scripts/lib/settings-bridge-lane.ts` W9 asserts `report.applies === "live"` for the
mutate reports (the VALUE claim) and its self-test treats `"restart"` there as the retired-timing
negative control.

Grep: no other docs page cites the bridge report's `live` as covering behaviour; the two process
records that mention `applies:"restart"` (`docs/plan-team-watchdog.md`, `docs/tui-edition-report.md`)
already agree with the code.

Re-ran `bun run verify:docs`: `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=449 dead=0 —
PASS`, **exit 0**.

#### T9 addendum — D-18 landed `states().applies` and `BRIDGE_SECTION_NOTICE`; folded in

Read the post-D-18 code and updated both places (EN+zh):

- **`docs/tui.md` §settings "Timing" bullet** now distinguishes THREE surfaces instead of picking one:
  `BridgeReport.applies` stays `"live"` (`packages/mpd-config-plugin/src/bridge.ts`) and records, per
  save, that the RESOLVED VALUE reaches the running process; the NAMESPACE-level answer is `"restart"`
  on every surface that carries one — the service's own `states().applies` (D-18 comment in
  `packages/mpd-config-plugin/src/index.ts`: "THE NAMESPACE-LEVEL ANSWER IS 'restart', not 'live'"),
  `dsh.settingsRegister(…)` in that same row, and `tui.registerSettingsNamespace(…)` in
  `packages/mpd-tui-plugin/src/settings.ts`. The bullet's last sentence now says the TUI section notice
  carries **all three** halves (`SECTION_NOTICE` = `BRIDGE_DISCLOSURE` + `BRIDGE_RESTART_LIMIT` +
  `BRIDGE_NOT_LOST`; `packages/mpd-tui-plugin/src/settings.ts`, and the same triple is
  `BRIDGE_SECTION_NOTICE` in `packages/mpd-config-plugin/src/settings-schema.ts:305`).
- **`docs/development.md` / `docs/development.zh-CN.md` `tui-panels` row**: now says the `/settings`
  section's notice renders ALL THREE disclosure halves (`BRIDGE_DISCLOSURE` + `BRIDGE_RESTART_LIMIT` +
  `BRIDGE_NOT_LOST`: bridge + live-refresh + mount-captured exception + "never lost"). It claims no
  per-knob table — §9.1 owns that.
  NOTE (concurrent writer): between the T8 pass and this pass another writer had already replaced that
  row's "bridge + live-refresh + 'never lost'" wording with "bridge + live-refresh + mount-captured
  exception + 'never lost'". This pass kept that meaning and only added the three symbols/composition;
  the EN and zh rows now agree.

Re-ran `bun run verify:docs` after both edits: `pairs=50 failed=0 violations=0 exempt=24 derived=3
links=449 dead=0 — PASS`, **exit 0**.

## Bounds of this lane's evidence

- No git command was run; the captain commits. Nothing under `packages/**`, `.mpd/**`, `skills/**` or
  `dist/**` was modified by this lane.
- Verification here is **documentation verification**: every new sentence is traced to a symbol/file
  opened in this session (cited above), and the two documentation gates pass. I did **not** boot a
  session or run a Docker lane; the runtime claims reused from A-02/A-03/A-09 rest on the sources and
  artifacts cited, not on a new measurement by me.
- The `send_message` duplicate-name tension in A-03 is declared, not resolved: proving which
  registration a live top-level session receives needs a mounting boot, which is outside this lane.
- The 2 KB advisory margin under the 65536 `AGENTS.md` cut is not met (1634 B); see the bound at the
  top. The binding ≤ 65024 target IS met (1122 B of headroom).
