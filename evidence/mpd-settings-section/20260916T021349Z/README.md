# t83 / w14 — the Web settings dialog gets its own top-level `MPD` section

User request (verbatim): **"web的设置栏请单开一栏MPD设置，别混在插件栏里"**.

The mpd settings form used to ride the **Plugins** tab's keyed per-namespace item slot
(`settings.plugin.item`). It is now a **top-level section** of the settings dialog
(`settings.section`), the same pattern the host's own sections use.

## What changed

| Path | Change |
|---|---|
| `packages/mpd-bundle-plugin/src/settings-card.js` | registration rewritten to the SECTION shape: `ctx.slots.inject("settings.section", …)` → `ctx.slots.register({ name: "settings.section", id: "mpd", order: 20, label: () => dicts.en.nav, locale: "mpdSettings", inject }, Section)`; constants `SECTION_SLOT` / `SECTION_ID` / `SECTION_ORDER` (the old `SLOT = "settings.plugin.item"` is gone); `nav: "MPD"` added to both dictionaries; `children` deliberately omitted; header rewritten (and the stale "six knobs" wording corrected to eleven) |
| `packages/mpd-bundle-plugin/src/web-client.js` | the mount comment now states the section, not the Plugins tab (the mount call itself is unchanged) |
| `packages/mpd-bundle-plugin/test/settings-card.test.mjs` | asserts the SECTION registration shape in source *and* in the built artifact, the absence of the retired `settings.plugin.item` registration, the descriptor via the harness (`id` `order` `label()` `locale`, no `children`, no retired `key`), the deferred `settingsScope` mount, and **negative controls** for both predicates |
| `packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs` | the two slot-list assertions move to `settings.section` (REQUIRED for the suite to be green — **outside this task's declared inScope**, reported to the captain) |
| `packages/mpd-bundle-plugin/client.js` | rebuilt artifact |
| `docs/tui.md` + `docs/tui.zh-CN.md` | §3.1 retitled and rewritten for the section (both languages, same change); the "see it yourself" steps now say **Settings → MPD**, and the stale "six knobs" count is corrected to eleven in both languages |
| `docs/user-guide.md` + `docs/user-guide.zh-CN.md` | the §7.1 counterpart row `Settings → Plugins card` / `Settings → Plugins 卡片` now reads `Settings → MPD section` / `设置 → MPD 栏` (acceptance item 6's "any README/user-guide mention" — these two paths are **outside the declared inScope**, reported to the captain) |

## Evidence in this directory

| Artifact | What it proves |
|---|---|
| `descriptor-probe.result.json` | the **offline hook harness** saw the registration **CALLED** on the built artifact: `name` `settings.section`, `id` `mpd`, `order` 20, `label()` `MPD` (a function), `locale` `mpdSettings`, no `children`, no retired `key`; the injected slot list is `["conversation.chat.commandview","settings.section"]`; all **eleven** knob rows render; mounting/rendering writes nothing through the scope |
| `served-bytes-boot.result.json` | a **real `dsh web` boot** in a sandbox `DSH_HOME` + sandbox `HOME` + sandbox workspace, fetched back over the host's own token/cookie route: the **served** client bytes carry `const SECTION_SLOT = "settings.section"`, `const SECTION_ID = "mpd"`, `const SECTION_ORDER = 20`, the `slots.inject(SECTION_SLOT…)` call and `nav: "MPD"`, and contain **0** occurrences of `settings.plugin.item`; no client-activation fault in the boot log |
| `raw/served-client.served.js` | the served body itself (298386 bytes) — **identical to the repo artifact plus the host's own `;` + `//# sourceMappingURL=…` trailer** (the only 2 extra lines / 85 bytes). Grepping that exact body: `id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav` ×1, `const SECTION_ID = "mpd"` ×1, `nav: "MPD"` ×2 (en + zh dictionaries), `slots.inject(SECTION_SLOT` ×1, `settings.plugin.item` ×**0** |
| `artifact-hashes.md`, `raw/artifact-*.txt` | BEFORE/AFTER size + sha256, and the proof that the build is reproducible: building from the **HEAD** sources reproduces HEAD's committed artifact byte-for-byte, and two builds from the final sources are byte-identical |
| `raw/build-*.log`, `raw/bun-test-bundle-plugin.txt`, `raw/gates-final.txt` | build logs, the bundle suite result, and the final gate exits |
| `raw/src.diff`, `raw/tests.diff`, `raw/docs.diff`, `raw/client.js.diff` | the exact diffs of every changed file |

## Gates

| Gate | Command | Result |
|---|---|---|
| Tests | `bun test packages/mpd-bundle-plugin` | **71 pass / 0 fail / 587 expect() calls** |
| Artifact | `node scripts/build-mpd-client.mjs` (×2) | exit 0, byte-identical (`34f1976f…`, 298301 bytes) |
| Types | `bun run typecheck` | exit 0 |
| Doc pairs | `bun run verify:docs` (re-run after the user-guide rows) | `pairs=34 failed=0 violations=0 exempt=16 — PASS` |
| Harness | `node raw/descriptor-probe.mjs` | `PROBE-OK` |
| Real boot | `node raw/served-bytes-boot.mjs` | `ok: true`, `activationFaults: []` |

## NOT CLAIMED

- **No browser render was witnessed.** No browser binary exists in this environment. What is proven is
  the registration contract, the descriptor, the eleven rendered knob rows and the **served bytes** —
  not the host dispatching the section in a live page, and not a click-driven save. The user sees
  those in their own GUI (the docs say so explicitly).
- The card's field set (eleven knobs), its zh descriptions, the disclosure/never-lost text and the
  read-only-with-reason behaviour were **not changed** by this task; they are re-asserted by the suite.

## Reported, not edited (outside inScope)

- `docs/tui-edition-report.md` §9 (the t50 integration record) still describes the old state — "the Web
  GUI settings card — `ctx.slots.inject("settings.plugin.item", …)` registration with `key: "mpd"`".
  That is an **exempt prior-phase process record** (AGENTS.md §3), so it is left byte-untouched here;
  the captain may want a superseding note in a later doc pass.
- `packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs` is not in this task's declared `inScope`, but
  the suite cannot be green without it (both slot-list assertions name the registered slots).
- `docs/user-guide.md:230` + `docs/user-guide.zh-CN.md:211` are NOT in the declared `inScope`, yet
  acceptance item 6 asks for "any README/user-guide mention" to follow the move. The one-row change
  was applied because the acceptance names it; the captain should amend the scope (or rule otherwise).
