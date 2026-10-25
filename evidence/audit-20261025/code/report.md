# code-fixer report — audit wave 2026-10-25 (T4, items D-01 … D-19)

Lane: `code-fixer` · branch `fix/audit-20261025` · contract `.mpd/plans/audit-20261025-fixes.md` §4.
No git write command was run: every change below is an uncommitted working-tree edit for the captain.
**`packages/*/dist/**` was NOT rebuilt** (captain's step) — see §6 for the exact stale set.

## 1. Check sweep (final tree, every command run after the last edit)

| Command | Observed | Log |
|---|---|---|
| `bun test packages` | **2457 pass / 6 skip / 0 fail**, 40 673 expect() calls, 148 files, 30.40 s — exit **0** | `test-packages.log` |
| `bun run typecheck` | `$ tsgo --noEmit`, no diagnostics — exit **0** | `typecheck.log` |
| `bun run verify:comments` | 444 files / 39 773 declarations, `VERDICT: PASS` — exit **0** | `verify-comments.log` |
| `bun run verify:manifest` | 14 ok lines incl. the two new `component-ref-*`, `VERDICT: PASS` — exit **0** | `verify-manifest.log` |
| `bun run test:qa` | `[test:qa] all self-tests passed` — exit **0** | (quoted below) |
| `node scripts/verify-dist-fresh.ts` | **FAIL — 6 of 33 targets not fresh** (expected: the captain rebuilds) | §6 |

The 6 skips are declared, not silent: 2 real-svn arms (toolchain absent, D-01), 1 real session-team
record (absent in this clone, D-02), 3 real-detector arms (binary absent, D-12) — each skip title now
NAMES its missing instrument.

## 2. Items

### D-01 — two svn arms reported PASS with zero assertions → SKIP
`packages/mpd-memory-plugin/test/memory.test.ts`, symbol `svnCliAvailable` / `svnAdminAvailable`:
the probes are computed ONCE at module scope (static `spawnSync` import) and both arms are now
`test.skipIf(!probe)(…)` with `SVN_TOOLCHAIN_ABSENT` in the title. No bare early return remains.
Observed: `bun test packages/mpd-memory-plugin` → `4 pass  2 skip  0 fail`;
`(skip) svn backend REAL svn CLI … (svn/svnadmin not installed; the real-CLI arms need the Subversion toolchain)`.

### D-02 — vacuous arm on a fresh clone → SKIP
`packages/mpd-tui-plugin/test/team-surface.test.ts`, symbol `SESSION_TEAM_RECORD` (module scope) +
`test.skipIf(!existsSync(SESSION_TEAM_RECORD))`. Observed: `576 pass / 1 skip` before the D-07 arm was
added, `(skip) … the REAL record of this session's own team …`.

### D-03 — `mpd_memory_status` advertised a facts count that cannot exist
Branch taken: **the README promises no count**, so the smaller reconciliation.
`packages/mpd-memory-plugin/src/index.ts`: the tool `description` now reads "…entry count, journal line
count, reflection counters"; the dead `factsPath` helper is DELETED; the file header states the upstream
facts queue is not carried (README documents the layout slot, no tool reads/writes/counts it).
The package README (EN+zh) already discloses "part of the documented store layout; no tool writes it
yet" — **no README edit is needed**, so no package-lane bounce.

### D-04 — the TUI board rendered "unreadable" as "empty"
`packages/mpd-tui-plugin/src/state.ts`: `readPlans(root, problems)` and `readWorkmates(home, problems)`
now push one bounded note (`problemNote`, capped by `MAX_PROBLEM_CHARS = 120`) on any non-ENOENT
failure (`errnoOf`/`isMissing` helpers); `readBoardState` passes its `problems` array through, and a
workmate `meta.json` that exists but cannot be parsed is a fault (an ORPHAN directory stays silent).
New arm: `packages/mpd-tui-plugin/test/state.test.ts` — "an UNREADABLE plan directory and workmate
entry are reported, never rendered as empty" (a FILE where the plans directory belongs → ENOTDIR;
malformed `meta.json`), plus the existing missing-tree arm now also asserts `problems` is `[]`.
Observed: `(pass) … an UNREADABLE plan directory and workmate entry are reported, never rendered as empty`.

### D-05 — legacy home-copy cleanup swallowed the read error
`packages/mpd-bootstrap-plugin/src/index.ts`, `cleanLegacyCopies`: the bare `catch { ids = [] }` now
`warn(ctx, \`legacy preset cleanup: could not list ${presets}: …\`)`. Non-fatal behaviour unchanged;
`bun test packages/mpd-bootstrap-plugin` → `6 pass / 0 fail`.

### D-06 — the last uninstrumented adapter site
`packages/mpd-team-core-plugin/src/index.ts`, `adapterFor`: returns
`createLazyDshAdapter(ctx, { label: "mpd-team-core" })`; `createDshAdapter` dropped from the import.
Behaviour verified unchanged: `bun test packages/mpd-team-core-plugin` → `344 pass / 0 fail`.
NEW cheap identity assertion: `packages/mpd-team-core-plugin/test/adapter-identity.test.ts` — with no
mounted `mpdDsh` EXACTLY ONE `fallback:createDshAdapter` line appears in
`<ws>/.mpd/logs/mpd-dsh-adapter.log` and it names `mpd-team-core` (the tools land in the ctx's own
registry); with a mount, NO fallback line appears and every tool registers THROUGH the mount.

### D-07 — unbounded `Math.max(…deps)` spread
`packages/mpd-tui-plugin/src/team-state.ts`, `taskDepths` → `depthOf`: the spread is replaced by a loop
with an explicit `deepest` accumulator (`dependencies.length === 0` still yields 0). The frozen §5.5
interface and the bounded read-failure line are untouched.
New arm: `team-surface.test.ts` — "a pathologically WIDE dependency list yields a depth instead of a
stack overflow" (1 000 000 edges; the pre-fix expression throws `RangeError: Maximum call stack size
exceeded` at that width on bun 1.4.2/JSC — measured, see §5). Observed: `(pass) … [67.64ms]`.

### D-08 — the settings card showed `commentChecker.autoCheck` ON while the hook is OFF
`packages/mpd-config-plugin/src/settings-schema.ts`: `commentChecker: z.object({ autoCheck: z.boolean().default(false) })`
(the row ships `autoCheck: false` in `cordis.patch.yml`; `packages/mpd-comment-checker-plugin/README.md`
documents the opt-in posture). README check: `packages/mpd-config-plugin/README.md` only LISTS the key —
no default claim — so **no package-lane edit needed**.
New arm: `packages/mpd-config-plugin/test/settings-defaults.test.ts` (asserts the node's
`meta.default === false`).

### D-09 — `memory.vcs: "both"` was not selectable
`settings-schema.ts`: the union is `z.union([z.const("git"), z.const("svn"), z.const("both")])` and the
`SETTINGS_KNOBS` row offers `["git", "svn", "both"]`. The Web card's mirror
(`packages/mpd-bundle-plugin/src/settings-card.ts` `FIELDS`) was updated in the same wave under the
captain's grant — without it the card/TUI parity pin reddened (measured: the pin passed with the old
array and failed with the new one; the temporary revert was restored byte-identically,
sha256 `27a3eb6f08da…`). New arms: the union's three members + the knob's three options.

### D-10 — `dsh-plugin.json` pointed at gitee
`source.repository` → `https://github.com/HaroldZ32/My-Power-Dsh` (matches `package.json`). Nothing else
changed; `bun run verify:manifest` PASS.

### D-11 — a malformed state file was misreported as a product failure
`skills/dsh-qa/scripts/memory-smoke.ts`: the empty `catch` around `runtime/reflection.json` now records
`problems.push("reflection.json unreadable (agent <slug>): <message>")` (160-char cap), the array is a
field of `steps.memory` in `result.json`, and each entry is PRINTED on its own line (outside the
220-char per-step slice). Self-test: `[memory-smoke self-test] ok: bundle row + dist symbols + unit
suite verified`.

### D-12 — the comment-checker contract had no arm without the binary
`packages/mpd-comment-checker-plugin/test/comment-checker.test.ts`: the three detector arms now carry
`SKIP_REASON` in their titles ("skipped: detector binary absent — run the installer with
--with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN"), and a new binary-free describe block pins
what needs no detector: the `hookInputFor` PostToolUse payload, `resolveBinary`'s explicit-override
precedence, and `runCheck`'s exit-code → verdict mapping (`0` clean and empty, `2` detected with the
binary's own text, `7` "unexpected exit 7") driven through a 3-line shell stub, with the same declared
win32 shell-stub bound the sibling arm states. Observed: `4 pass / 3 skip / 0 fail`.

### D-13 — YAML flows were called a follow-up in code
`packages/mpd-ext-plugin/src/flows.ts` header: "v1 is JSON only BY DESIGN (zero-dependency rule); YAML is
NOT planned" + the technical reason (the runtime must never gain a YAML parser dependency).
`bun test packages/mpd-ext-plugin` → `77 pass / 0 fail`.

### D-14 — eight stale extension evidence dirs still looked current
Created `evidence/extensions/SUPERSEDED.md` (no historical record touched): names the boundary commit
`c239407` (2026-09-15 09:17:55 +0800), lists the NINE stamps / EIGHT directories (F6's inventory,
including the two outside `evidence/extensions/`: `extensions-repair/t16-pins-and-plane-guard`,
`mpd-ext-repair/roles-report`), states that none supports a current-state claim, names the two later
green artifacts with their honest scope (`evidence/gates/qa-selftest-repair/20261022T172600Z/` = the
T18 self-test repair; `evidence/docker/client-install-oneclick/2026-10-25T09-51-46Z/` = install+boot,
108/122 assertions, `complete:false`, 14 NULL) and states the rule: re-run the two lanes into a fresh
stamp before citing any of them.

### D-15 — `verify-debranding.ts` printed a claim it did not probe
`evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.ts`: the header bullet, the per-doc `ok()`
detail and a new `bounds` field in the emitted report now state exactly what was compared (skill
description + frontmatter name + the four flow keys) and that the `mcp` / `roles` snippet fields were
NOT probed, with the reason (the tree it measured is gone → a new arm would pass on absence). Not
re-run, per the contract; syntax checked with `node --check` (exit 0).

### D-16 — R11 has no test home → recorded follow-up
`PLUGIN_PKGS` is NOT exported: it is a module-local `const` in `scripts/pack-mpd.ts` (outside
`packages/*`), so a `packages/*/test/**` assertion would have to scrape that script's source; the parse
already exists in `scripts/verify-pack-closure.ts`. Cheap unblock later: export the constant (or move it
to a shared module) and add one arm. Not done here: the required export is a source change in
`scripts/`, which no lane owns in this wave.

### D-17 — `verify-plugin-manifest.ts` did not gate component refs → DONE as D-19
### D-18 (captain-added) — the blanket "no restart" disclosure was FALSE
### D-19 (captain-added) — `dsh-distribution.json` component refs dangled

## 3. D-18 in detail

**Class split, derived from the consumers (each symbol opened in this session):**

| Class | Knobs | Why |
|---|---|---|
| LIVE | `teamModels.slot*`, `modelchain.*`, `watchdog.*`, `team.stateDir`, `team.gate`, `team.sensitivity`, `captain.investigation`, `delegation.gate` | read per spawn / per tick / per call (`createDshAdapter`'s slot resolver; the watchdog's `resolveLiveKnobs` re-reads the namespace each tick; `mpd-bundle/src/index.ts` reads `team.stateDir` per call; the three gate modules document the live read "picked up LIVE, T-18") |
| ONE-WAY | `tui.dashboardKey` | a saved false disables the Ctrl+A takeover at once; a saved true cannot arm a takeover the row config disabled |
| MOUNT-CAPTURED | `hashline.*`, `commentChecker.*`, `ulw.*`, `memory.*`, `boulder.dir`, `goal.*` | each plugin does `const cfg = mergedConfig(ctx, config)` inside its own `apply()` (and the `autoCheck` hook is registered — or not — at apply) |

**Final text (byte-identical in `mpd-config-plugin/src/settings-schema.ts` and the browser mirror
`mpd-bundle-plugin/src/settings-card.ts`, which cannot import the module):**

`BRIDGE_DISCLOSURE` =
> a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s); the config service
> re-resolves on every settings save and on a watched edit of the project file, and WHICH knobs take the
> new value in the RUNNING process — no restart — depends on how each one reads it: teamModels.slot\*,
> modelchain.\*, watchdog.\*, team.stateDir, team.gate, team.sensitivity, captain.investigation and
> delegation.gate are read per use, and tui.dashboardKey is live ONE WAY (a saved false disables the
> Ctrl+A takeover at once; a saved true cannot arm a takeover the row config disabled)

`BRIDGE_RESTART_LIMIT` =
> the other half of that list, so nobody reads it as a blanket: hashline.\*, commentChecker.\*, ulw.\*,
> memory.\*, boulder.dir and goal.\* are captured by their plugins at mount instead of reading the live
> config service per use, so a new value for any of them waits for the next dsh boot (the file and the
> settings document still receive it at once, and each row names the key it writes)

`BRIDGE_NOT_LOST` — **unchanged** (the "settings-only save is never a lost save" sentence).

`BRIDGE_SECTION_NOTICE` = `BRIDGE_DISCLOSURE + " " + BRIDGE_RESTART_LIMIT + " " + BRIDGE_NOT_LOST`
(both halves, then the not-lost clause — the notice previously omitted the restart half).

**Surfaces.** The Web card renders all four paragraphs (`bridge`, `restart`, `not-lost`, `workspace`) —
verified by `R2-D1`'s rendered-tree arm, not assumed. The TUI builds `SECTION_NOTICE` from the same three
constants (`packages/mpd-tui-plugin/src/settings.ts`) and uses it for the section description in BOTH
locales, so the exception is on screen there too; the new arm
`settings section disclosure (t21) > every row names its mpd.jsonc key, and the SURFACE states the
disclosure once` asserts the RENDERED description contains `hashline.*` and `commentChecker.*` in both
locales.

**`states().applies`: `"live"` → `"restart"`** (`packages/mpd-config-plugin/src/index.ts`, the service's
`states()` answer). Reason: the host's `applies` option is PER NAMESPACE (one word, no per-knob channel)
and both registrations already say `restart` (`settingsRegister(SETTINGS_NS, …, { applies: "restart" })`,
`tui.registerSettingsNamespace(…, { applies: "restart" })`). The other two `applies` fields are a
DIFFERENT surface and stay `"live"`: `BridgeReport.applies` in `bridge.ts` records that the resolved
value reached the running config layer per save, which is still true. The pin
`settings-wiring.test.ts` (U17) was updated to `"restart"`.
**→ `docs/tui.md` cites `applies: 'live'` in one sentence; the docs lane must align it.**

**Cross-package coupling:** the TUI now imports `BRIDGE_RESTART_LIMIT` from the same sibling module it
already imported, so the frozen literal in
`packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` was **re-frozen** to the
new line text (one entry replaced, count unchanged, dated D-18 comment). Not a new edge: same file, same
module, one more symbol.

## 4. D-19 in detail

`dsh-distribution.json`: **SIX** self-urn refs (`urn:dsh:distribution:mpd:my-power-dsh`, and
`urn:dsh:component:mpd:{plugins,mcp-servers,skills-corpus,web-client,tui-edition}`) were pinned at
`@0.15.1` while `distribution.version` (and `package.json` / `dsh-plugin.json`) read `0.15.4`; all six
are now `@0.15.4`. Ids, `dependsOn` and every other byte are untouched. `host-tui`'s
`pkg:npm/@deepseek-harness-tui/dsh-tui@0.16.1` is deliberately out of scope (the host's version is the
host's).

`scripts/verify-plugin-manifest.ts`: new predicate `checkComponentRefs` (+
`distributionComponentsOf`) with two results —
`component-ref-version` (every `urn:dsh:*:mpd:*@<v>` equals `distribution.version`) and
`component-ref-dependencies` (every `dependsOn` names a declared id); wired into the scan and into
`--self-test` as a **7th arm** whose mutant trips BOTH predicates and whose control is the repository's
real document. Observed:
`ok component-ref-version: 6 self-urn ref(s) compared against distribution.version 0.15.4, 0 stale`;
`ok component-ref-dependencies: 8 declared component id(s), 0 dangling dependsOn edge(s)`;
`self-test PASS (7 arms, each with a clean control)`.

## 5. F3 — the QA lanes that pinned the retired sentence (all rewritten)

- `skills/dsh-qa/scripts/lib/settings-bridge-lane.ts`
  `export const TUI_DISCLOSURE_LIVE` / `TUI_DISCLOSURE_CAPTURED` / `TUI_BLANKET_RETIRED`: BYTE COPIES of
  the final constants (no import — this lane judges the BUILT bytes and must not pull a
  `packages/<pkg>/src` graph), and `selfTest()` re-reads `settings-schema.ts` so a drift FAILS.
  Arms: static `S2` (live half) + **new `S2b`** (captured half) + `S3` (not-bridged claim absent) +
  **new `S3b`** (retired blanket sentence ABSENT); TUI surface `T2` + **new `T2b`** + `T3` + **new
  `T3b`** — same pair, same absence. The `static` fixture and `greenTui.dist` now carry the NEW text
  verbatim, and the `T2` mutant was retargeted (`TUI_DISCLOSURE_LIVE` → "waits for a restart"); new
  mutants `S2b`/`S3b`/`T2b`/`T3b` prove each new arm can flip.
  Observed: `[tui-settings-bridge self-test] ok: 21 web-arm + 10 TUI-arm + 4 client-shape injected
  faults each flip their own check; all three synthetic green artifacts pass`.
- `skills/dsh-qa/scripts/tui-panels.ts`: the `/settings` row asserts `take the new value in the RUNNING
  process` AND `captured by their plugins at mount` AND `never lost`, and the row now declares
  `absentPatterns: [/takes effect in the RUNNING process — no restart/]`. The judge gained the
  `absentPatterns` field (a hit keeps the row UNRENDERED and is recorded in `foundRetired`), a
  falsifier (a probe row that must redden on a present retired sentence and stay green on an absent
  one), and the reference `settings` pane fixture was rewritten to the new text (it also still named the
  deleted `agentRoutes` table). Observed: `[tui-panels self-test] ok: 8 surfaces asserted, negative
  controls fail as required`.
- `skills/dsh-qa/scripts/tui-settings-bridge.ts`: header rewritten to the scoped truth (disclosure
  stated ONCE per section, both halves, per-knob effect).
  **The real case READS `packages/*/dist`** (`settings-bridge-lane` reads
  `packages/mpd-tui-plugin/dist/index.js` and `packages/mpd-config-plugin/dist/index.js`), so it MUST be
  run after the rebuild — today's stale dist still carries the retired sentence and would pass for the
  wrong reason.

## 6. NOT fixed / bounds

- **D-16** recorded follow-up (see above): `PLUGIN_PKGS` is not exported.
- **`packages/*/dist/**` is STALE by instruction.** `node scripts/verify-dist-fresh.ts` (pinned
  toolchain bun 1.4.0) reports **6 of 33 stale**: `mpd-bootstrap-plugin` (D-05),
  `mpd-config-plugin` (D-08/D-09/D-18), `mpd-memory-plugin` (D-03), `mpd-team-core-plugin` (D-06),
  `mpd-tui-plugin` (D-04/D-07/D-18), and `mpd-roster-provider-plugin` — that last one has NO edit of
  its own: it imports `TEAM_MODEL_SLOT_GROUPS` from `mpd-config-plugin/src/settings-schema`, so the
  settings-schema edit is INLINED into its bundle (the AGENTS.md §6 adapter-fan-out trap).
  `mpd-ext-plugin` stays FRESH (its only edit is a comment, stripped by the build); `dist/mpd-bundle-plugin/client.js`
  carries the FINAL disclosure bytes — the source mirror was re-synced to the artifact's own text, which
  is why the rendered-card arms are green without another rebuild.
- **Not re-verified by me:** the live TUI screen (`tui-panels`/`tui-settings-bridge` real runs are the
  captain's post-rebuild step), the Docker lane, and any Windows-specific arm (the shell-stub arms carry
  their declared win32 bound).
- **`docs/**`, `README*`, `VENDOR_LOCK.json`, every historical `result.json`/`output.log`: untouched.**
