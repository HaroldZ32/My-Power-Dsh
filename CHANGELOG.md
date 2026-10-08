# Changelog

Human-readable release notes for **my-power-dsh** (`@mpd-dsh/mpd`). Newest first, one section per
released version, the changes grouped by kind (`Added`, `Changed`, `Fixed`, `Removed`). This file is
English-only and is NOT part of the bilingual docs band (AGENTS.md Language policy polices `docs/**`,
`packages/*/README.md`, `extensions/**`, `templates/**` and the root `README`).

Further reading:

- [`README.md`](./README.md) — what the bundle is, and how to install it;
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development setup, gates and the git model;
- [`docs/index.md`](./docs/index.md) — the documentation hub;
- [Releases](https://github.com/HaroldZ32/My-Power-Dsh/releases) — the annotated tags, newest first;
- [`VENDOR_LOCK.json`](./VENDOR_LOCK.json) — the pinned upstream baseline each release is measured
  against.

## v0.12.0 — the product page, and one bundle on two surfaces

### `README.md` becomes a product page, and the manual moves to the user guide

**Changed.**

- **The root README is rebuilt as a product page** in the shape the `dsh-tui` project's README uses:
  a language switch, three short paragraphs, a hero capture of the running product, `Features`,
  `Install`, `Quick start`, `Usage`, **`Status and known limitations`**, the documentation index, and
  the provenance/license sections. It was 68 524 B of manual; it is 18 429 B, and the long form lives
  where a long form belongs — [`docs/user-guide.md`](./docs/user-guide.md) (57 770 B, with its
  `zh-CN` twin), which already existed and is why **no `docs/manual.md` was created**: a second copy
  would have been a third overlapping document. `README.zh-CN.md` is the 简体中文 twin and is updated
  in the SAME change, as the language policy requires.
- **No section of the old manual was lost.** Every `##`-level section of the pre-wave README maps to
  an existing home — a RETAINED section of the new page, or a named section of the user guide, the
  design document or the parity ledger. The per-section table is
  [`evidence/docs/readme-0.12.0/README-section-map.md`](./evidence/docs/readme-0.12.0/README-section-map.md),
  and the three pieces that existed nowhere else were given a home in this wave: the **MCP
  literal-call recipes** (user guide §13.11, new), the **two symptom rows** for a missing
  `comment-checker` binary and a silent CodeGraph (user guide §11), and the **roster sizing
  guidance** (user guide §4).
- **The dual-surface story is the spine of both files.** A `Web | TUI` comparison table sits in the
  top half of the page: one row per concrete surface — the team roster, the task graph, the watchdog
  banner, plan approval, the workmate library, the settings card, the terminal status line — with the
  Web column, the TUI column, and a parity column. **Every parity claim is one the existing ledger
  already records**, and the rows that are *not* at parity are the ledger's own open deviations,
  named in the table rather than smoothed over. [`docs/tui-parity.md`](./docs/tui-parity.md) stays
  the authority; the README now points at it in the sentence right under the table.
- Long-form content is reachable from the README through `docs/user-guide.md`, `docs/index.md`, the
  design document and the parity ledger; the sections the README used to carry that had no other home
  were moved into `docs/user-guide.md` rather than dropped (see *Content preservation* below).

**Added.**

- **A real screenshot set, captured on a real machine and cropped to THIS bundle's surfaces.** The
  README's images are produced by the Docker UI lane under [`docker/ui/`](./docker/ui/):
  - the **Web** tiles by headless Chromium driving the real app, captured as tight crops around the
    bundle's own Team view, settings card, preset card and plugin row rather than as full-window
    frames of the harness chrome;
  - the **DSH-TUI** tiles by rasterizing the **ANSI byte stream the real TUI emitted on a real PTY**
    (`tmux capture-pane -e`, which carries the TUI's own colours) at the character grid tmux computed
    — previously the TUI was only ever captured as plain text, and the repository shipped **zero**
    terminal images;
  - a paired **hero** composite showing the same bundle on both surfaces side by side;
  - both sets in **English and 简体中文**, so the Chinese README does not show an English app.
- **The images have a stated provenance**, not just a directory: see
  [`evidence/docs/readme-0.12.0/image-provenance.md`](./evidence/docs/readme-0.12.0/image-provenance.md).
  It records the exact method, the fixture that makes every surface render populated, and — stated
  rather than implied — that the terminal tiles' PAGE BACKGROUND is the lane's choice because the TUI
  deliberately never paints one; every foreground colour comes from the byte stream.
  It also records three dead ends a future lane must not re-pay for: this image's X server accepts a
  connection and never answers (`import`, `xwd` and `xdpyinfo` all return exit 124 with zero bytes);
  `xterm -sb 0` is invalid (`-sb` is a boolean, so the `0` becomes the shell argument); and
  `pkill -f <pattern>` self-matches the calling shell.
- `docker/ui/` gains the capture steps that produce the set, so the images are REPRODUCIBLE from the
  tree instead of being hand-taken artifacts. The lane stays an INSPECTION harness: it holds the two
  surfaces open and asserts nothing about the product.

**Fixed — a marker that was not unique to its surface.** The terminal capture gates every scene on a
marker read out of the live pane. The marker first chosen for the team scene — the fixture's team
name — is ALSO printed by the chat screen's keyed status line, so one capture fired on the chat
screen and produced an image of the wrong surface. The shipped tiles were each confirmed by looking
at them; the lesson (a readiness marker must be unique to the surface it gates) is recorded in the
lane's own comments so the next lane inherits it rather than rediscovering it.

**Fixed — a Docker-lane assertion that had been stale for four hours, found by this wave's release
sweep.** `node scripts/docker-e2e.ts --mode source --require-docker` failed 2 of its 94 assertions
(`tui.teamGraphContent` and the abort it caused). It is **not** this wave's doing: the same two arms
fail identically when the same lane is run against the PRE-wave commit, and the mechanism is that
commit `6fdfc012` (12:39 UTC) froze clause AC1 — every node reads `<marker> <id>` and nothing else,
with the subject moved into the pinned detail body — while the lane still asserted the OLD drawing
shape. The last green lane run was 10:58 UTC; nobody re-ran it in between. The arm is repaired to
assert what the contract now says, and strengthened while it was open: the expected ids are read out
of the RECORD the lane itself wrote rather than hard-coded, each id must appear as a NODE LABEL
(which a detail row cannot satisfy), and the record's own subject is asserted where AC1 moved it.
The differential experiment, and the two plausible environment hypotheses it falsifies, are recorded
in [`evidence/docker/lane-staleness/tui-teamGraphContent.md`](./evidence/docker/lane-staleness/tui-teamGraphContent.md).

**A second, WORSE defect found in the same file: an assertion that proved nothing.**
`tui.teamGraphDrawn` claimed to prove the DAG boxes were drawn, but it matched the square corners
`┌ ┐ └ ┘` — and the boxes have been ROUNDED (`╭ ╮ ╰ ╯`) since the same wave. Measured on the lane's
own pane: the square corners appear exactly ONCE each, on the scene FRAME, while the rounded ones
appear three times each, one set per box. So the arm passed on frame chrome and **stayed green with
every box deleted**. It now counts the rounded corners against the record's own task count. The
vacuity is demonstrated rather than asserted: on one pane with the `T2` box removed, the new arm
answers `false` (`corners=╭2 ╮2 ╰2 ╯2 tasksFromRecord=3`) while the OLD arm on that same pane still
answers `true` — and three further mutations (frame-only, a record with one more task than the pane
draws, a pane re-drawn with the pre-wave square corners) flip the new arm while leaving the old one
green. Both graph arms now read their expected values out of the record the lane writes, and both
report measured values (`corners=╭3 ╮3 ╰3 ╯3 tasksFromRecord=3`; `ids=T1,T2,T3 fromRecord=3
labelsExpected=3 missing=[none] pinnedFocus=T1 detail=[T1 · requirement · freeze the contract]`)
instead of the literal strings they used to carry.

**Removed.**

- **The five full-window `docs/assets/images/web-ui-*.png` captures are gone** (476 KB). The new set
  supersedes them: each of the five showed the harness chrome around the part that mattered, and the
  product page now shows the bundle's own surfaces, cropped. Nothing is lost — the raw full-window
  frames stay tracked under `docker/ui/out/shots/` and the deleted files remain in this file's own
  git history. `assets/images/` is a CURATED set documented by `docs/index.md`, so leaving five
  files no table described was rot rather than a safety net.

**Declared bounds (named, not silent).**

- The Web tiles are Chromium at a fixed viewport; a different browser size lays out differently. The
  terminal tiles are one terminal emulator's rendering of the same bytes. The claim is the **facts on
  screen**, not pixel identity — and the README says so in its own *Status and known limitations*.
- The three authored SVG diagrams (`architecture`, `ulw-loop`, `team-lifecycle`) no longer sit in the
  README; they remain in this repository, are still rendered by `docs/index.md`, and are linked from
  the README's documentation index through the documents that own them.

### The vendored `dsh-agent-teams` body is DELETED, and what still ships has moved

**Removed.**

- **`packages/mpd-agent-teams-plugin/**` — 768 files, `_deps/` included — is GONE.** The body had
  already been retired from the composition in 0.1.7 (no loader row mounted it); this wave removes the
  code. Nothing in the tree reads, imports, patches, fingerprints or copies it any more: the whole
  `_deps/` runtime closure, the `agent_teams_*` tools, the prebuilt client sources under `lib/client/`,
  the `self-fix-tests/` suite and the delta registry (`agent-references/agent-teams-deltas.md`) went
  with it, together with the three scripts that existed only to vendor, patch and reclaim it
  (`scripts/vendor-agent-teams.ts`, `scripts/patch-agent-teams-fixes.ts`,
  `scripts/patch-agent-teams-client.ts`, plus `scripts/reclaim-staged-teams.ts` and the ambient shim
  `scripts/lib/vendored-agent-teams.d.ts`).

**Added.**

- **`packages/mpd-schemastery/` — the mpd-owned home of the two pieces the shipped product still
  uses.** `lib/` carries the schemastery validator (the `Config` schema of four SHIPPED plugins), its
  `cosmokit` dependency and the type declarations — including the GLOBAL `Schemastery<T>` interface
  `export const Config: Schemastery<Config>` relies on, which is why the package ships a manifest with
  `exports.types`. `harness/` carries the six DSH framework modules (`cordis`, `dsh-tools`, `dsh-llm`,
  `dsh-session`, `dsh-scope`, `dsh-timeout`) that four TEST files drive directly — they need a real
  dispatcher and a real harness validator, not a double. The eight-file closure is self-contained: no
  network, no new npm dependency, and `cordis`-family `devDependencies` were refused because
  `verify-plugin-manifest` forbids them by name. Both upstream MIT notices are reproduced in
  `packages/mpd-schemastery/LICENSE`.
- **`packages/mpd-bundle-plugin/adopted/agent-teams-client.js`** — the adopted browser bundle (the
  0.1.14 build) and its source map, moved to the bundle package that embeds them. The committed
  `packages/mpd-bundle-plugin/client.js` was rebuilt from the new path and differs from the previous
  bytes by exactly one line and twelve bytes (the `sourceMappingURL` now names the relocated file).
- `docs/independence.md` §5, the pinned-debt entry, is **CLOSED** with the measurement that closed it.

**Changed.**

- The migrated surfaces were re-pointed in the same commit as the deletion: `tsconfig.json` (the
  adopted-suite `exclude` entries are gone), `bun.lock` (one workspace entry swapped),
  `scripts/{pack-mpd,verify-pack-closure,verify-dist-fresh,verify-docs-parity,verify-comment-coverage,install-profile,build-mpd-client}.ts`,
  `docker/**`, the cross-package coupling inventory, the no-terminal-writes band and the watchdog test
  suite.
- `package.json`'s description now reads *upstream reference … historical, no synchronisation owed*.

**Declared bounds (named, not silent).**

- The `verify-docs-parity` derived-value rule (delta range + region count) and its `EXEMPT_PROVENANCE`
  map are VACUOUS in the live tree — they are exercised only by the gate's own `--self-test` fixtures,
  and every run PRINTS that fact instead of passing silently.
- The `mpd-team-watchdog-plugin` fault-injection fixture
  (`test/fixtures/inject.ts`) was deleted with the body it drove; the QA cases reading it are retired by
  the wave's `skills/**` writer.
- The workmate persona-injection hook lived in the deleted body's `memberPersona()`; automatic
  injection into team members no longer fires (see `packages/mpd-workmate-plugin/README.md`).

### DSH-TUI 0.13.0: the sidebar panel seam, and a `Ctrl+A` that is now version-gated

**Changed.**

- **The DSH-TUI edition is adapted to `@deepseek-harness-tui/dsh-tui` 0.13.0, and the adapter adopted
  the release's new sidebar panel seam as the FIFTEENTH `tui*` seam.** 0.13.0 adds `ctx.tuiPanels` (host
  row `dsh-tui-panels`, export `@deepseek-harness-tui/dsh-tui/panels`) and renames the host's own
  `dsh-ecosystem-spec/` directory to `tui-profile/`; the move touched every carrier in one wave — the
  global package and the `dsh-tui` profile, the distribution pin (`dsh-distribution.json`'s `host-tui`
  ref is `pkg:npm/@deepseek-harness-tui/dsh-tui@0.13.0` now) and the QA host spec (`docker/tui-lane.sh`,
  `docker/entrypoint.sh`, `skills/dsh-qa/scripts/tui-mount.ts`'s `TUI_HOST_SPEC`,
  `skills/dsh-qa/scripts/install-dependencies.ts`'s remedy, all defaulting to `0.13.0`).
  `TUI_SEAMS.panels` is bound, probed and degraded like every other seam, and
  `packages/mpd-tui-plugin/src/panel.ts` registers ONE right-sidebar panel whose body is the MERGED view
  — the host's curated subagent snapshot rows first, then the MPD dependency DAG — under a FROZEN
  descriptor: slug `team`, title `MPD`, `minColumns` 32, `order` 10, and **no** `compact`, because
  0.13.0 validates and stores a descriptor's `compact` slot but does not mount its render slot, so
  declaring one would claim a surface that cannot render. The final panel id is DISCOVERED from the
  host's own `list()` read-back (measured `act1:team`), never composed. `alt+a` and the new `/mpd panel`
  subcommand route through `tuiPanels.open()` while the seam is bound and FALL BACK to the existing
  full-screen merged scene (`mpd-tui-subagents`) on any refusal — the one-open-per-plugin-per-5000 ms
  rate limit, an id the host no longer owns, or no live panel consumer — never a silent no-op. The
  legacy `Ctrl+A` host-input takeover is now VERSION-GATED: on a host that offers the panel seam it
  stays INERT and `Ctrl+A` keeps the host's own dashboard meaning, while a host WITHOUT the seam keeps
  the old arming rule (`tui.dashboardKey` on and the workspace team holding ≥1 task); `tui.dashboardKey`
  stays in the config schema and the `/settings` row, documented as meaningful on OLD hosts only.
  `docs/tui.md` and `docs/tui.zh-CN.md` carry all of it in both languages — including a new §11.3
  amendment, with the 0.12.0-era sentences kept readable as history rather than silently rewritten.
  Real-PTY evidence on 0.13.0: mount lane PASS (`evidence/tui/lanes/2026-10-06T10-27-42.389Z/`), the
  surfaces lane with 7 of its 8 surfaces rendered — status line, `/mpd` completion, the `/mpd workmates`
  command, the sidebar panel registration + open, the board scene, the `/settings` section with its
  disclosure, and the managed dialog — with its negative control red as required
  (`…/2026-10-06T10-27-53.571Z/`), and the `Ctrl+A` lane PASS (`…/2026-10-06T10-28-57.807Z/`); the full
  lane report is `evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`. **The bounds are
  stated, not glossed:** (a) the panel's BODY is not observable in a tmux pane capture on this host — a
  320×50 capture was byte-identical before and after a host-ACCEPTED open, so the lane proves
  registration + `open()` + the discovered id, NOT a render (recorded as `panelBodyBound`); (b)
  `tuiRenderers` is still MISSING — the surfaces lane exits 1 on that required surface — a pre-existing
  structural gap already declared in `evidence/tui/EVIDENCE-INDEX.md`, not caused by this wave; (c) no
  0.12.0 PTY arm was obtained in this wave (a clean 0.12.0 sandbox needs `dsh plugin add`, blocked here
  by the read-only pnpm store lock, and the fixture that exists is a mixed-version composition that
  never reaches a chat screen), so the old-host arming path rests on unit arms — `takeoverArmed` in
  `packages/mpd-tui-plugin/test/panel.test.ts` (16 pass / 0 fail on this revision) together with BOTH
  version-gate arms in `packages/mpd-tui-plugin/test/plugin.test.ts` ("the contact stays INERT" and
  "the contact arms", green in the canonical per-package run `bun test packages/mpd-tui-plugin` =
  220 pass / 0 fail; only the explicit FILE-filtered form cannot load them, on a pre-existing vendored
  `_deps` module-resolution error in the retired adopted plugin).

**Changed.**

- **The session-start complexity gate's contract is written down where the model reads it.** The gate
  has been MECHANICAL since the plan plane landed: a trigger STAGES an APPROVABLE PLAN SHELL through
  the `agent_teams_plan` tool (0 members, 0 tasks) and injects ONE notice naming the returned plan id —
  NOTHING is spawned and the plan is INERT until the captain extends it (`add_member` / `create_task`)
  and approves it — while `team.gate` in `mpd.jsonc` selects `mechanical` (the default) | `advisory` |
  `off`. The shipped `mpd` preset, `AGENTS.md` §1, the `mpd-roles-plugin` README pair and the
  `mpd_config_get` consumed-keys list all still described the retired advisory-only behaviour; they now
  state the mechanical contract, the advisory fallback (the ONE notice then says `NO team was staged`),
  and the notice marker `[AgentTeams] Session-start team rule`. The sentence that an explicit `team:` /
  `!team` request was merely "routed to team mode" is gone — such a request now stages the shell too
  (signal A) and has its marker CONSUMED from the goal text. A new drift guard in
  `packages/mpd-roles-plugin/test/team-plane.test.ts` pins that preset text, so the prompt and the
  implementation can no longer diverge silently.
- **Signal D reads an ACTIVE boulder, not a plan file.** The retired probe ("some `.mpd/plans/*.md`
  exists") measurably fired in EVERY session of this workspace, because one plan file outlives the work
  that produced it. D now means an ACTIVE boulder work for the workspace (`status: "active"` in
  `.mpd/boulder.json`), and a plan FILE alone is not a signal.

**Fixed.**

- **The TUI plan scene's approval path is documented as PRESENT again.** The pane has carried the
  typed-phrase gate since W6 — type the exact phrase the pane serves (`approve plan-…`) and press
  `Ctrl+X`, `Ctrl+D` twice within 10 s to discard, `Ctrl+R` to re-read — and it now really acts: the
  action is an `agent_teams_plan {action:"approve"|"delete"}` call carrying the LIVE agent resolved
  from the adapter's own registry (`liveAgent(sessionId)`, else a live entry whose own `session.id`
  matches, else the ONE live agent when the scene carries no id). A caller that cannot be resolved
  REFUSES before calling anything; the live hop on a real TUI host is not yet falsified.
  `packages/mpd-tui-plugin/README.md`, `docs/tui.md` and their `*.zh-CN.md` twins said the approval
  flow was gone; they now state what is true, refusal path included.
- **`docs/design.md` no longer counts `dsh-better-sidebar` among the bundle's runtime
  `dependencies`.** It is an optional peer (+ a `devDependency`) the bundle deliberately does not
  install, and its ABSENCE is a normal, intended composition. Without it the SAME two bodies register
  into the harness's own right sidebar (the Team tab — which lists the WORKSPACE's teams for a session
  that has none — and the Workmate library), and that is the surface which must work; the old text
  promised one warning and "no surface outside the sidebar".

### DSH-TUI 0.14.0: fifteen unchanged seams, an eight-builtin panel bar, and a sidebar that carries two MPD pages

**Changed.**

- **The DSH-TUI edition is adapted to `@deepseek-harness-tui/dsh-tui` 0.14.0, and the adaptation needed
  NO adapter code change for the seam surface.** MEASURED on the installed tree: the fifteen
  plugin-facing `ctx.tui*` seam modules and their declarations under the host's
  `lib/types/dsh-adapter/` (`panels`, `scenes`, `status`, `renderers`, `settings-sections`,
  `shortcuts`, `dialogs`, `command-trees`, `plugin-host`, `toast`, `themes`, `plugin-storage`,
  `message-observer`, `effect-ledger`, `workspaces`, each `.js` + `.d.ts`) are **byte-identical** to
  0.13.0, there is no sixteenth seam, and the harness `peerDependencies` lists still end at
  `0.2.0-rc.2` — so `MPD_E2E_DSH_VERSION` does not move. The release's OWN additions are named because
  a reader meets them on the host: the **Claude backend peer** (`@anthropic-ai/claude-agent-sdk`
  0.3.287, the one peer the release adds), the **`ws` runtime dependency** (`^8.21.3`, absent at
  0.13.0), an **eighth** builtin sidebar panel (`btw`) and the rewritten `PanelBar` below.
- **The host's default enable CSV grew from three builtins to eight, and the bundle's own test now
  pins the INVARIANT rather than a literal.** `DEFAULT_SIDE_PANEL_IDS` is
  `todo,jobs,agents,info,trajectory,workspace,btw,companion` on the installed 0.14.0
  (`lib/types/tuiDisplayPrefs.js`), where 0.13.0 carried `todo,jobs,agents`. The two arms that pinned
  the three-id literal — and therefore reddened when the HOST grew — now assert what the clause is
  for: nothing of ours appears in that default, and every id in it passes the host's own
  `SIDE_PANEL_ID_PATTERN`. The file's premise is that it re-judges itself when the installed host
  changes, so a new literal (old or new) would reintroduce the same defect. Measured on this revision:
  `bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` = **469 pass / 0 fail**, and
  repo-wide the wave's verification record `rec-20261008T030715-f1a2ad` reads **1632 pass / 3 skip /
  2 fail** — the two reds are the declared environment defects, down from the contract's pre-wave
  1615 / 3 / 4.
- **`PanelBar` no longer paints a plugin's declared icon — a HOST fact, and the bundle's icon arm
  follows it.** `components/sidePanel/PanelBar.js` is a carousel on 0.14.0: the active tab's title is
  centred, every other tab is one `○` (`●` with a badge) dot placed by a computed pitch, and the file
  carries no `icon` reference at all (`grep -c icon …/PanelBar.js` = **0**). An `icon` is still
  REQUIRED by the host's validator and still declared by every MPD descriptor (an icon that is not
  exactly one cell is a refusal); it is simply no longer drawn. The collision set read from the host's
  own `builtinPanels.js` is now **eight** icons — `≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`, the new one being `?` for `btw`.
- **The `⤢` bound is re-measured on 0.14.0 and still holds.** `dsh-adapter/panels.js` still freezes a
  plugin definition to `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component,
  compact}` with **no `capabilities`**, while `components/sidePanel/SidePanelColumn.js`'s `canExpand`
  reads `activeEntry?.definition.capabilities?.fullscreen === true`, so the host's own `⤢` remains
  unreachable for a plugin panel and `capabilities` stays undeclared — a dead button is not shipped.
  MPD's own control is what opens its full-screen surface, and that surface carries the page's same
  rich appearance.
- **The 0.14.0 pin moved on every carrier that names the release, in one wave**: `docker/**` (both
  `MPD_E2E_TUI_VERSION` defaults in `docker-compose.yml`, the same key in `docker/ui/docker-compose.yml`,
  `docker/entrypoint.sh`'s `TUI_VERSION`, `docker/ui/entrypoint.sh`'s two `MPD_UI_TUI_VERSION` defaults,
  `docker/tui-lane.sh`'s `TUI_VERSION` and its `PREF_WRITER` probe string), the distribution
  descriptor's `host-tui` ref (`dsh-distribution.json` is
  `pkg:npm/@deepseek-harness-tui/dsh-tui@0.14.0` now) and the seven QA carriers under
  `skills/dsh-qa/scripts/**`. **Two carriers deliberately did NOT move**: `MPD_E2E_DSH_VERSION` keeps its
  `0.2.0-rc.2` default, because the harness peer range is unchanged; and `dsh-plugin.json`'s
  `compat.hosts` stays at `@deepseek-harness-tui/dsh-tui@0.10.1`, because that field records the
  **0.10.1 admission measurement** the bundle was admitted against — not the TUI edition it targets — so
  moving it would falsify a measurement instead of recording a target.
- **The sidebar carries TWO MPD pages — `MPD` and `MPD workmate` — because the rich DAG page and the
  plain merged page collapsed into one.** The user's clause 「将原先的MPD Panel和MPD DAG Panel合并，把MPD与
  Workmate两个panel扔到侧边栏上去」/「DAG页作为MPD面板」 is met by ONE surviving registration:
  `panel.ts`'s slot (slug `team`, title `MPD`, one-cell icon `❖`, `order` 10, `minColumns` 28, no
  `compact`) now RENDERS `panel-dag.ts`'s rich body — bordered frame, header + progress, legend,
  key-hint footer, click-to-pin detail body, three layouts, badge — with the host's curated subagent
  rows drawn ABOVE the drawing inside that same frame, and the separate plain merged renderer is deleted
  rather than kept beside it. The standalone `dag` registration is RETIRED (its `◈` icon is declared by
  nothing now). **No user-visible entry point became a dead end**, which is the clause's own test:
  `/mpd dag` re-aims onto the MPD panel's discovered id, `/mpd panel` / `/mpd subagents` / `alt+a`
  already routed through that slot, `/mpd workmate` keeps its page, and the adapter's recorded id set is
  DISCOVERED from what actually registered — two ids, never a composed three.
- **The full-screen MPD surface is as rich as the page it comes from** (user clause 「试着适配一下全屏
  按钮，还有全屏出来的MPD也要有这种富外观」). The page's own `⤢` opens the rich team scene
  (`mpd-tui-team` — frame, legend, focused-task detail pane, key hints) instead of the merged subagents
  scene, while the ROUTED fallback of `/mpd panel` and `alt+a` stays `mpd-tui-subagents`, the surface
  that carries the host's own rows. `registerPanelSurface` takes them as two separate options, because
  they answer two different questions.
- **The sidebar's enable-list keeper is FEED-FIRST, and the panel-id record now carries PROVENANCE.**
  The keeper installs the host's own `subscribeSidePanelPanels` subscription (released with the injected
  scope, degrades where the host has no such module), so a config re-apply that wipes the CSV is
  repaired as it happens instead of being lost when the bounded ladder ended — the durable form of
  「看起来侧边栏挂掉了」. The stand-down rule is unchanged: a list naming ANY of our ids means a
  configuration has taken a position on this bundle and the keeper stops for good, and our own write
  contains our ids, so it cannot loop. `.mpd/logs/mpd-tui-panels.json` is schema version 2 with
  `provenance {hostRoot, hostVersion, readBack, activation}`, and the recorder REFUSES to write a record
  it cannot trace to an installed host package and a host read-back — MEASURED because a unit test run
  had overwritten the real record with the impossible `act0:*` ids (the installed host's `pluginIdFor`
  fallback counter pre-increments, so the first bare activation is `act1`). **The READ side enforces the
  same proof**, so a polluted record cannot reach a user's profile patch:
  `node scripts/mpd-tui-panels.ts` REFUSES (dry run and `--apply` alike, exit 1) a record carrying no
  `provenance`, a blank `provenance.hostVersion`, no `provenance.readBack`, or
  `provenance.activation === "act0"`, names the field that failed, and points at `--ids a,b,c` as the
  escape. Measured against the polluted version-1 record: `REFUSED …`, exit 1, the record's sha256
  unchanged by the run, `--ids act1:team,act1:workmate` accepted, and `--self-test` green with one arm
  per refusal shape plus a well-formed version-2 record accepted.

**Fixed.**

- **The accumulating legend (`越点越多直到撑爆屏幕`) was a duplicate React key, and it is genuinely
  fixed.** The legend's rows were keyed `legend-${line.slice(0, 24)}`, and the drawing's own state-key
  line and the legend's first wrapped line both begin `✓ completed · ◐ running` — two children sharing
  ONE key, which made React render the collided row again on EVERY re-render. Measured on a mounted
  instance (the host's own React/ink, the pattern the panel suite already uses): the legend row count
  walked `[4,5,5,5,6,6,6,7,7]` across eight clicks, and it is `[4,4,4,4,4,4,4,4,4]` after the fix. The key
  is the row's position now — the same rule applied to the DAG page's detail rows and the workmate
  page's problem rows, which had the same content-derived-key shape — and the new arm keeps the fix
  honest by asserting the legend ROW COUNT is STABLE across N clicks: a re-render of a MOUNTED instance,
  not a direct call of the component function, which is why the pre-existing suite could not see the
  defect at all.

## v0.11.6 — the gate's own comments, and the manual's budget

**Fixed.**

- **The two doc comments the version-coherence rewrite dropped are restored**
  (`checkVersionCoherence`, `checkPackaging` in `scripts/verify-plugin-manifest.ts`). `bun run
  verify:comments` reddened on them on the release line; this patch is what puts the green gate back on
  the default branch.
- `AGENTS.md` is back inside the loader's instruction budget after the version-carrier rule pushed it
  104 bytes past the cap (meaning only: the injected copy was truncated at the tail).

## v0.11.5 — the release version lives in three files, and the gate knows it

**Fixed.**

- **Both shipping descriptors carry the manifest's version again.** `dsh-plugin.json` (the DSH plugin
  descriptor) and `dsh-distribution.json` (the distribution descriptor the TUI case asserts against)
  were still pinned at `0.11.1` after the v0.11.2–v0.11.4 bumps, so `bun run test:qa` reddened inside
  `tui-distribution.ts` on a release that was otherwise complete — the coupling was real and undocumented.

**Added.**

- **`verify-plugin-manifest` now checks version coherence** — one result per carrier, with the
  descriptor's own key path (`version` or `distribution.version`) — plus a sixth `--self-test` arm whose
  control is the real manifest, so bumping `package.json` alone is red in EVERY gate sweep instead of
  three steps later inside a QA case.

## v0.11.4 — the live-install lane judges the command it actually runs

**Fixed.**

- **The one-click lane accepts the `github:` shorthand it drives.** With v0.11.3's fix the live install
  succeeded and the run still failed on one assertion of ours: `install.profileDep` recognised only the
  `git+…` URL pnpm rewrites a spec into, while the lane runs
  `github:HaroldZ32/My-Power-Dsh` — the shorthand the README prints. The arm now accepts both shapes,
  and the driver's offline `--self-test` pins that it does.

**Verified.** The live lane on a clean `ubuntu:24.04`, installing
`github:HaroldZ32/My-Power-Dsh` from the released default branch:
**44 passed / 0 failed**, rows activating, tools registering, the TUI booting on a real PTY and
`agentPreset=mpd` in the harness's own session store.

## v0.11.3 — the one-command install actually completes

**Fixed.**

- **The self-referential dependency is gone.** `dependencies` declared
  `"@mpd-dsh/mpd": "github:HaroldZ32/My-Power-Dsh"`, so a git-hosted install resolved the bundle as a
  dependency OF ITSELF and pnpm 11 refused it (`ERR_PNPM_EXOTIC_SUBDEP … not allowed in subdependencies
  when blockExoticSubdeps is enabled`). Nothing resolves the bundle by name from inside the repository
  (the `@mpd-dsh/mpd` hits in `scripts/` are module-loader id strings), and Node's self-reference
  feature still resolves `@mpd-dsh/mpd/package.json` through the manifest's own name + `exports`.
  Measured after the fix: checkout lane 42 passed / 0 failed, scratch-git one-click lane green, and the
  live `github:` lane green on the released default branch.

## v0.11.2 — a TypeScript plugin, and a verification flow that ends in a real container

**Added.**

- **The Docker real-machine lane is the LAST step of the verification flow** (`bun run verify:docker`,
  `node scripts/docker-e2e.ts`), and it is written into `AGENTS.md` §4/§11 with its skip policy: a
  machine with no **rootless** Docker prints a notice and SKIPS (exit 0, the steps above still had to
  pass), `--allow-rootful-docker` opts a rootful daemon in, and `--require-docker` turns any skip into
  exit 3 for a release sweep. `--spec <install-spec>` drives any spec, including the live `github:` one.
- **The mounting contract is a binding rule** (`AGENTS.md` §2 + §8): a row reaches the harness ONLY
  through `cordis.patch.yml` + the profile mechanism — an independent package the profile references,
  never a DSH source edit, never a hand-written profile, never a row pushed into `<DSH_HOME>`.
- `agent-references/verification-flow.md` carries the ordered flow on demand, so the manual stays inside
  its instruction budget.

**Fixed.**

- **The literal one-command GitHub install now works.** `dsh plugin --profile web add
  github:HaroldZ32/My-Power-Dsh` failed on a clean `ubuntu:24.04` with `ERR_PNPM_IGNORED_BUILDS`; two
  independent causes were measured and closed: a stray untracked `pnpm-workspace.yaml` at the repo root
  carried pnpm's own `allowBuilds` template into the build context (its class is now excluded by
  `docker/Dockerfile.dockerignore`, asserted by the entrypoint's `copy.contextFiltered` and by four new
  `--self-test` arms), and `github:` resolves the repository's DEFAULT BRANCH — it served `master` while
  the build-script-free closure sat on `dev`, so this release is what puts that closure on the default
  branch.
- The TypeScript conversion's own reds: the two source-text `eval` arms in the bundle-plugin tests now
  erase types with the pinned transpiler, and the stale `mountSidebarPages(ctx, teamPage)` source pin
  matches the claim instead of one spelling of its argument.


### A canonical TypeScript plugin, installable in one command

**Changed.**

- **JavaScript is gone from the source tree.** 158 hand-written `.js`/`.mjs` files — every repository
  script and gate, all 54 QA cases, the docker probes, the extension template and example servers, and
  the package test suites — are now `.ts`, executed directly by Node (`node <file>.ts`, type stripping;
  the manifest states `engines.node: ">=22.18"`). Four trees stay JavaScript ON PURPOSE and are named in
  `AGENTS.md` §6: build products (`packages/*/dist/**` and the generated
  `skills/visual-qa/scripts/visual-qa.mjs`), adopted upstream bytes (`packages/mpd-agent-teams-plugin/lib/**`
  and `_deps/**`), and fixture DATA (`skills/ultimate-browsing/engine/templates/*.js`,
  `tests/golden/fixtures/math.js`). Two exceptions to the source rule are deliberate and adjacent to
  those: `skills/programming/scripts/typescript/check-no-excuse-rules.ts` resolves the CALLER project's
  TypeScript 7 API, so the repository's own TypeScript devDependency is declared under the alias
  `typescript5` and never shadows it.
- **Strict typing across the whole source set.** The root `tsconfig.json` now covers `scripts/**`,
  `skills/*/scripts/**`, `docker/**`, `tests/**`, `templates/**`, `extensions/**` and every
  `packages/*/test/**` tree, and `bun run typecheck` (`tsgo --noEmit`) exits 0 with zero diagnostics —
  the conversion of the test trees alone surfaced and closed 84 pre-existing fixture diagnostics.
- **Every declaration documented, and enforced.** `scripts/verify-comment-coverage.ts`
  (`bun run verify:comments`) is a TypeScript-AST gate: a precise comment must sit immediately above
  every declaration in that set, and every named function must write down its parameter and return
  types. It measured **8,376 violations and now measures zero**; inline callbacks, structural
  type-literal members and statements are out of family on purpose, and the report says so.
- **The two install-time rules became a standing gate.** `scripts/verify-plugin-manifest.ts`
  (`bun run verify:manifest`) refuses `cordis` in `dependencies` / `peerDependencies` /
  `optionalDependencies` — by name, and the optional field is NOT an exemption — and refuses any
  `preinstall` / `install` / `postinstall` / `prepare` script name. It also asserts the packaging
  contract the one-command install rests on (declared patch files exist, every row module path resolves,
  the `files` allowlist admits every runtime path, the frozen `evidence/` tree is excluded, and npm's own
  `npm pack --dry-run` list carries them). Both gates are members of `bun run verify:gates` and of the
  new `.github/workflows/gates.yml`, which runs on Node 24 + Bun.
- **The package is publish-ready.** A `files` allowlist takes the packed tarball from **100.9 MB to
  7.6 MB** (879 → 1134 files of source and build output; the 291 MB frozen `evidence/` tree is out),
  `icon.svg` plus `locale/{en,zh}.json` provide the plugin-inventory display metadata, the manifest
  carries repository/homepage/bugs/licence/`engines`/`publishConfig`, and `npm publish --dry-run`
  completes. There is no lifecycle script and no `cordis` dependency, so installing the package runs no
  code from it.
- **One-command install from the published package, verified on a bare `ubuntu:24.04`.** The dependency
  closure was made build-script-free, because pnpm 11 refuses an install whose dependencies have
  unapproved build scripts (`ERR_PNPM_IGNORED_BUILDS`): `dsh-better-sidebar` became an optional PEER
  dependency (still a `devDependency`, so the checkout keeps it; its row already disables itself when the
  host is absent), and the two binary tooling packages left the closure (`@ast-grep/cli`,
  `@code-yeongyu/comment-checker` — their launchers resolve from `PATH`/`.toolchain` and report an
  actionable error otherwise). `docker/docker-compose.yml` now declares an `mpd-oneclick` service beside
  `mpd-client`, and `node scripts/docker-e2e.ts --mode oneclick` runs the user's path end to end:
  `dsh plugin --profile web add git+file://…` (the local stand-in for
  `github:HaroldZ32/My-Power-Dsh`), the allowlist check on the INSTALLED tree, byte identity of the
  shipped `dist/` against the source tree's build, the mounting boot, the preset session and the
  isolation assertions.

**Fixed.**

- `skills/dsh-qa/scripts/wave2b-lane-d.ts` used `require("node:zlib")` inside an ES module, so its
  two-frame zstd arm threw before it could assert anything; the import is now an ESM import and the case
  passes 8/8 arms.
- `skills/lsp-setup/scripts/verify-lsp.ts` used a constructor parameter property, which Node's
  strip-only TypeScript mode REJECTS (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and 22 relative specifiers
  across `skills/visual-qa/scripts/**` and `skills/lsp-setup/scripts/**` omitted their extension, so
  `node <file>.ts` could not resolve them. Both are now erasable-syntax/extension-clean and run under
  Node as well as Bun.
- `docker/tui-lane.sh`'s session-store probe imported `skills/dsh-qa/scripts/lib/session-evidence.ts`,
  which the wave renamed; the TUI lane's preset assertion and its exit verdict were red for that reason
  alone and are green now.
- `scripts/check-citations.ts` accepted only `.mjs` driver files, so its live header scan would have
  found ZERO drivers and passed vacuously after the conversion; the accepted spellings are `.ts` and
  `.mjs`, and the wrong-extension audit is now measured against a separate list.


### One implementation per repeated decision

A consolidation pass with no intended behaviour change. What proves that is not the diff but the
sweep around it: the same unit suite, the same static gates and the same user-facing QA lanes, run
before and after, with the one pre-existing red (`bundle-lifecycle`'s live probe) reproduced
identically on a pristine `HEAD` snapshot.

**Changed.**

- **Pure helpers have one home.** `packages/mpd-dsh-adapter-plugin/src/shared.ts` holds `isRecord`,
  `errorMessage` and `bundleRootOf`, re-exported from the adapter entry. Nine
  identical `message()` bodies, four `isRecord()` bodies and five bundle-root resolutions were
  deleted from the rows that carried them.
- **One adapter resolution.** `resolveDshAdapter(ctx)` replaces the eager
  `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` expression that sixteen rows spelled inline;
  `createLazyDshAdapter(ctx, { label })` stays the choice for a row that must also survive a
  transient "provider not ACTIVE yet" miss.
- **One skill-frontmatter parser.** `packages/mpd-ext-plugin/src/skill-frontmatter.ts` is the single
  implementation of the corpus YAML subset, consumed by the extension skill plane AND by
  `mpd-bootstrap`'s bundle-corpus provider, which loses its ~140-line copy of it.
- **Shared script primitives.** `scripts/lib/repo.ts` (`repoRootFrom`, `readJson`) replaces ten
  hand-written root walks and twenty-eight hand-written JSON reads across the gate/helper scripts.
  The vendored-corpus fingerprint helpers stay duplicated on purpose: `scripts/repin-vendor.ts`
  re-checks its mirror against `scripts/verify-vendor.ts`'s own bytes.

**Fixed.**

- The documentation citations that the moved lines rotted are repaired, and
  `node scripts/check-citations.ts` is green (25/25) where it was 21/25 — including four anchors
  that were already dead before this pass.

### An open-source front door, and captures of the shipped surfaces

**Added.**

- **The repository now reads as a project.** `CONTRIBUTING.md` (setup, build and test commands, the
  gates, the git model) and `SECURITY.md` (how to report privately) join the root set, each with its
  `*.zh-CN.md` twin, and `.github/` carries the docs-parity workflow, a pull-request template, and
  bug-report and feature-request issue templates.
- **Three diagrams and a real documentation hub.** `docs/assets/images/` holds the authored
  `architecture.svg`, `ulw-loop.svg` and `team-lifecycle.svg`; `docs/index.md` is rebuilt as a hub
  with separate reading paths for users, extension authors, contributors and agents.
- **Six captures of the running app** (`docker/ui/`): first run, home, installed plugins, the MPD
  settings section, agent presets and the team panel — taken inside the container, against the bundle
  installed by the real client flow. Five of them are referenced from the README, its zh-CN twin and
  the hub, and the checks behind them are recorded with the run: the `mpd` preset selected, the MPD
  section rendered, a session created with `agentPreset: "mpd"`, the team panel showing its roster,
  and no console or page error.

**Changed.**

- **`README.md` is a product page** — badges, a table of contents, a features table, install and
  quick start, configuration and an FAQ — with `README.zh-CN.md` updated in the same change, as the
  language policy requires. `CHANGELOG.md` gains the same further-reading set.
- **The packer ships the five new root documents** (`ROOT_FILES` in `scripts/pack-mpd.ts`), so the
  README's relative links resolve inside the packed artifact as well as in the checkout.

**Fixed.**

- **The UI capture lane's chromium guard keyed on the wrong thing.** It tested for the playwright
  package directory, so a rebuilt image with a recycled volume skipped the install and the capture
  died with `headless_shell: error while loading shared libraries: libglib-2.0.so.0`; it now keys on
  the shared library itself.

### Evidence files a lane regenerates stay out of the repository

`evidence/**/scratch-pack*/` joins the two sibling `scratch-*` rules: the dsh-qa extension lane
stages a full packed tree under its own evidence directory, and three runs of it added ~40 MB across
~3,700 files that one `node scripts/pack-mpd.ts --out <dir>` reproduces. The lane's own record —
`result.json`, `output.log` and `raw/` — is committed as before, and the earlier waves' already
tracked `scratch-pack` paths stay, forward-only.

## v0.11.1 — mailbox unread

v0.11.0 shipped with this capability listed as a bound: "the official inbox exposes no read state".
That was true of the TEAM SERVICE and false of the HARNESS, so it is implemented instead of documented
away.

**Added.**

- **`agent_teams_mailbox`** — how many messages are WAITING for this agent. The count is the harness's
  own arithmetic, not an estimate: the agent inbox emits `agent/inbox/inserted` when a message enters,
  `agent/inbox/claimed` when the loop takes it and `agent/inbox/discarded` when it is dropped, and
  `inserted − claimed − discarded` is "waiting, not yet taken". `watch: true` attaches the counter to
  the calling agent (idempotent). The count clamps at zero, because a counter attached to an
  already-running session may have missed claims it never saw.
- **`subscribeAgentEvents`** on the adapter — the generic form of `registerAgentPreStep`'s agent-scoped
  registration. The three inbox events are SCOPED (their `dsh-scope` subject resolver is
  `args[0]["agent"]`), so a listener on a row's ctx is filtered out of their dispatch; this seam
  registers on the agent's own scope and never lets a throwing observer break that dispatch.

**Fixed.**

- The team tools' boot line derived neither number: it printed `tools=10` while the plane had grown,
  and then a literal breakdown that said "13 tools" when there were 14.

## v0.11.0 — the team workflow, per-member routing, and a settings surface that reads

The official Agent Teams plugin owns the team RUNTIME and nothing else. This release adds the WORKFLOW
around it, the routing it cannot express, and the GUI/settings work that a Docker view of both shipped
surfaces drove.

**Added — the team workflow (`mpd-team-tools-plugin`).**

- **Staged plan + approval.** `agent_teams_create` / `_add_member` / `_create_task` / `_edit_plan`
  stage a plan; `agent_teams_approve` EXECUTES it — spawns every member through `spawn_teammate`, posts
  every task to the official board, resolves `blocked_by` from planned subjects to posted ids and
  `owner` from staged names to spawned ids, and names where it stopped if it did. `dry_run` reports
  without creating. Nothing is spawned before approval.
- **Task contracts.** `agent_teams_claim_task` claims on the board AND freezes the task's meaning with
  a monotonic `attempt` counter; `agent_teams_task_contract` reads it back. The counter is why the
  sidecar exists: the board's `revision` moves for every mutation, so it cannot stand in for an attempt.
- **Halt / resume.** A hold that stops new dispatch and leaves the team and its members alive —
  deliberately not an ending. `agent_teams_delete` is the ending, and it ARCHIVES.
- **Dispatch.** `agent_teams_dispatch` pairs each READY task with an IDLE member, sends the task, and
  RECORDS the pairing, so a second pass cannot hand the same task to a second teammate (a message is
  not a ledger). Ledger entries for tasks deleted or completed out of band are pruned first, so a
  member is never left busy forever. `agent_teams_dispatch_release` frees one pairing.
- `agent_teams_status` prints the sidecar beside the official roster and board, and `/agent-teams
  <what the team is for>` stages a plan from the current goal.

**Added — per-member model routing (`mpd-roster-provider-plugin`).**

`spawn_teammate` used to inherit the Lead's route: the official TeamService forwards only
`{ prompt, parent }`. The harness itself is not the limitation — `SubagentContinuationManager`
resolves `request.agentOptions` and hands them to the PROVIDER, which constructs the run, and the
provider NAME is row config (`config.freshProvider`). This bundle therefore registers `mpd-roster`, a
provider that delegates to the composition's own and applies the member's `teamModels` slot route, and
points its `mpd-tool-agent-team` row at it. The teammate stays a real, continuable official teammate:
no fork, no contract change. A teammate `description` that NAMES a roster member routes that member;
one that does not inherits the Lead's route — the descriptor label is the only identity channel the
team service forwards. An incomplete slot fails the spawn loudly, naming the member and the slot.

**Added — the team GUI in the harness's own right sidebar (`mpd-bundle-plugin`).**

A Team tab registered through `ctx.sidebarRightTabs`, rendering the Lead session's `agentTeam`
projection: completion, `N of M running · ready · blocked`, members with role and phase, and tasks with
owner and blockers. It lands in the sidebar the harness already ships, so it appears wherever the
harness does.

**Fixed — the settings surface, on BOTH front doors.**

- The MPD section now RENDERS and READS. Harness 0.1.7-rc.2 replaced the namespace registry with the
  Cordis patch editor, so the knobs are declared as the `mpd-config` row's own `Config` with volatile
  flags, and both front doors address the ENTRY (`mpd-config`) rather than a namespace name. Measured:
  20000 / true / 6 / git / .mpd/team in the Web dialog and in the TUI.
- An edit actually REACHES the plugins: the row config is merged as the layer above the files, with
  the routing keys stripped.
- The repeated per-row disclosure is stated ONCE per surface, so eight rows fit where five did.
- The sidebar host mounts on a checkout install. `dsh-better-sidebar` was not resolvable from a
  `link:` profile, so the bundle contributed no sidebar GUI at all; the bundle now reaches its own copy
  through `mpd-better-sidebar-host`.
- The watchdog's three `agent/*` subscriptions and the bootstrap's `fs/observed` go through the
  adapter, and the D6 gate covers event NAMES.

**Fixed — the TUI edition.** A `dsh-tui` profile is now part of the Docker client test, which boots
the real TUI on a tmux PTY and reads the created session's preset from the harness's own store.

## v0.10.2 — TUI preset default, adapter event seams, TUI end-to-end lane

**Fixed.**

- **A `dsh-tui` profile defaulted every session to a preset its composition does not declare.** The
  harness moved preset selection to a registry row and this bundle targeted the web plane's
  `agent-preset-registry` — but `dsh-tui` mints its OWN scoped row (`dsh-tui-agent-preset-registry`,
  stock `default: standard`), and a TUI profile composes no `dsh-web-app` layer, so the web target is
  skipped there while nothing declares `standard`. A second id-target on the scoped TUI row restores
  user decision D10. The QA pin moves to `@deepseek-harness-tui/dsh-tui@0.11.1`, the first release
  whose peer ranges include `0.1.7-rc.2`.
- **Two harness-event subscriptions bypassed the adapter** — `mpd-team-watchdog-plugin`'s
  `agent/pre-step` / `agent/session-start` / `agent/turn-stopping` and `mpd-bootstrap-plugin`'s
  `fs/observed`, all on a raw ctx while neighbouring subscriptions already used `dsh.onEvent`. Both
  are rebased, and the D6 gate gained an event-name rule family so the class cannot return.
- A patch COMMENT that named `disabled: !!js` could displace the real scalar in
  `sidebar-guard-profile-dir.test.ts` and kill the run in `JSON.parse`; the finder now accepts only
  a candidate that really parses.

**Added.**

- The DSH-TUI edition is now exercised END TO END in the Docker client test
  (`docker/tui-lane.sh`): it installs the TUI host, installs this bundle into the `dsh-tui` profile as
  the third patch layer, boots the REAL TUI on a real tmux PTY, and reads the preset the created
  session ACTUALLY ran from the harness's own session store — `agentPreset: "mpd"`. 11 assertions,
  reported as `passed=42 failed=0 null=1` by the driver.

## v0.10.1 — session-start gate delivery, producer-owned message source

**Fixed.**

- **The session-start complexity gate was MOUNTED but NEVER FIRED.** Three root causes, each measured
  on a real boot: (a) `agent/pre-step` is dispatched through the AGENT's scope carrier and `dsh-scope`
  drops a listener registered on a row's ctx, so the handler was never invoked; (b) the harness splices
  its own user-role runtime-context turn onto the pre-step decision, so the gate judged that snapshot
  instead of the goal; (c) the injected notice used the retired `{kind:"plugin"}` message source, which
  harness 0.1.7's format-v4 gate REFUSES — the injection killed the boot. The gate now registers one
  listener per qualifying agent in that agent's own scope through a new adapter seam
  (`registerAgentPreStep`), reads the goal from the payload's raw claimed list, and names its own
  message producer. The frozen properties are unchanged: advisory only, the marker
  `[AgentTeams] Session-start team rule`, the predicate A/B/C/D, mpd-preset scope, settle once,
  contained failure.
- **`/ulw` used the same fatal message source.** A lane-wide grep prompted by the first fix found
  `mpd-ulw-plugin` emitting `{kind:"plugin"}` for its activation directive; it now uses a
  producer-owned kind, and the adapter's doc comment no longer teaches the retired spelling.

**Tests.**

- `skills/dsh-qa/scripts/session-start-team.ts` now splits its live verdict into named
  sub-assertions and asserts the boot's own session-store key plus the row's `sessionGate=advisory`
  report, so "the gate was never mounted" and "the gate is mounted and did not fire" are different
  readings with different owners. Its earlier green was partly vacuous on 3 of 6 sides; that is fixed,
  and it now passes with `simpleNotices [0,0,0]`, `softNotices [1,1]`, `explicitNotices [1]`, every
  triggered side staging nothing.
- A regression test drives the gate through the REAL adapter with the REAL payload shape — no `agent`
  field — which is the test whose absence let this ship.

## v0.10.0 — DeepSeek Harness 0.1.7-rc.2 adaptation, official Agent Teams, Docker client test

**Breaking changes (harness 0.1.7-rc.2).**

- **The preset model was replaced.** `@deepseek-ai/dsh-agent-presets` no longer exists: the deployment
  default now lives on `@deepseek-ai/dsh-agent-preset-registry`, and a preset is an ordinary plugin
  ROW (`@deepseek-ai/dsh-agent-preset`) whose `config.plugins` carries the child entry list inline.
  The `mpd` preset is therefore declared by `presets/mpd.patch.yml` (row `preset-mpd`), the bundle
  id-targets `agent-preset-registry` to `{ default: mpd }`, and the manifest's `dsh.bundle.patch`
  became an ARRAY of two patch files. The retired directory form
  (`presets/mpd/{preset.yml,agent.cordis.yml}`) is gone; `@deepseek-ai/dsh-workflow-worker-thread`
  went with it and the preset now declares `workflow-ptc`, matching the shipped `standard` preset.
- **Agent Teams became an official plugin set.** The bundle now mounts
  `@deepseek-ai/dsh-experimental-agent-team` (+ `-tool-agent-team`, `-client-ui-agent-team`) and the
  model-facing interface is `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` /
  `interrupt_agent` / `team_task_*`. The vendored third-party body
  (`packages/mpd-agent-teams-plugin`, its `agent_teams_*` tools, its `.mpd/team` record and its Web
  activity panel) is RETIRED from the composition and kept in the tree for one release as a declared
  follow-up deletion.
- **Every agent-team interaction goes through `mpd-dsh-adapter`.** The adapter gained a team plane
  (`teamService` / `teamMembership` / `teamListMembers` / `teamListTasks` / `teamCreateTask` /
  `teamGetTask` / `teamUpdateTask` / `teamSendMessage` / `teamSpawnTeammate` / `teamInterrupt` /
  `teamWaitForChange` / `teamLiveTeams` / `registerSubagentProvider`), and a new gate
  (`packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts`) fails on a direct
  `ctx.agentTeams` / `subagents.startContinuable` reference anywhere outside the adapter.

**Capability bound.** `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to
`ctx.subagents.startContinuable`, so a teammate created by `spawn_teammate` inherits the Lead's model
route: per-teammate model routing is impossible on the official plugin. The `teamModels.slot*` settings
keep applying to the one-shot consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an
explicit route. The roster's mechanical read-only discipline is preserved by a tool guard, and the
session-start complexity gate is re-implemented on the official seams by `mpd-roles-plugin`.

**Added.**

- A Docker end-to-end client test: `docker/Dockerfile` (ubuntu:24.04) + `docker/docker-compose.yml` +
  `docker/entrypoint.sh`, driven by `node scripts/docker-e2e.ts`, which installs Node 24, bun and
  `@deepseek-ai/dsh@0.1.7-rc.2` into a clean Ubuntu 24.04 machine, runs the real
  `dsh plugin --profile web add .`, and asserts a mounting boot plus a `session/create` preset mount.
  See `docker/README.md` for what it proves and what it does not.
- `docs/plan-0.1.7-adaptation.md` — the adoption record: measured baseline, the harness changes, the
  decisions, the lanes, and the retired assertions.

**Fixed.**

- `mpd-bootstrap-plugin`'s legacy home-copy cleanup recognised only the retired directory spelling of
  a bundle preset, so a stamped `$DSH_HOME/.agent-presets/mpd` copy survived a boot that was supposed
  to remove it. Both spellings are now recognised.
- `buildToolchain` is recorded as the bun actually used (`bun@1.4.0`) and every committed `dist/` was
  rebuilt from the canonical repo-root command, so `verify-dist-fresh` is green again.

## Earlier releases

Untagged history for 0.1.x … 0.9.1 lives in the git log and in the process records under `docs/`.
