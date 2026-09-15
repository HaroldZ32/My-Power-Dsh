# t55 — TUI coverage in the core docs (bilingual, same commit) — result

Docs-only implementation. Five bilingual pairs edited; every claim cites a shipped artifact.
Raw artifacts: `raw/`. Machine-readable: `result.json`.

## What changed, per pair

| Pair | Change |
|---|---|
| `docs/user-guide.md` / `.zh-CN.md` | **new chapter `## 7. DSH-TUI edition` / `## 7. DSH-TUI 版本`** with §7.1 surfaces-and-counterparts, §7.2 the `/settings` screen + the `mpd.jsonc` bridge, §7.3 `/mpd` + the status line; the former sections 7–10 renumbered to 8–11 in BOTH files, and the four internal cross-references (`see §8`→`§9`, `see §9`→`§10`, plus the two extension references `见 §9`→`§10`) updated so no reference dangles. |
| `docs/architecture.md` / `.zh-CN.md` | **new `## 7b. TUI edition wiring (the counterpart of §7)`** — the profile/host split (host-base → host-tui → this bundle as the third patch layer, `evidence/tui/composition/20260915T053445Z/`), the `mpd-tui` row and its specifier, what the plugin **does** (the seven soft-probed seams, each disposed via `ctx.effect`) and explicitly **does not** (zero filesystem writes; no admitted identity — admission is `waiting_authorization` by design), then the three seam providers in resolution order (settings-section provider with the file-derived base + the write-back trigger; the host-served `tuiSettingsSections` seam; the `tuiStatus` status publisher). |
| `docs/development.md` / `.zh-CN.md` | **six TUI lane rows in the QA case catalog** (`tui-mount`, `tui-panels`, `tui-admission`, `tui-distribution`, `tui-spec-conformance`, `tui-settings-bridge`, each with what it asserts and its exact command) + a **TUI packaging/install** paragraph (`node scripts/pack-mpd.mjs` ships `packages/mpd-tui-plugin/{dist/**, README pair, themes/mpd-tui.json, skills/mpd-tui/SKILL.md}`; the packed `mpd-tui` row stays the resolvable specifier) + a **NOT-CLAIMED discipline** paragraph (no TTY / no browser ⇒ not-claimed, never "passed"). |
| `README.md` / `README.zh-CN.md` | **new `### DSH-TUI edition` / `### DSH-TUI 版本`** in the capability inventory: the install line, the TUI-native surfaces, the `/settings` → `<workspace>/.mpd/mpd.jsonc` bridge with its after-a-restart timing, and the pointer to `docs/tui.md` (+ the zh twin). |
| `docs/index.md` / `.zh-CN.md` | reading-order rows adjusted only enough that the TUI chapter cannot be missed: the `user-guide` row names the DSH-TUI edition chapter, the `architecture` row names the TUI edition wiring (the `tui.md` row already existed). |

Every fragment above names a checkable artifact: the install command and composition
(`docs/tui.md` §2), the surface table and its counterparts (§3), the bridge rules, restart timing and
the two skip cases (§6.2), the duplicate-key rule (§6.5), the row/specifier
(`packages/mpd-bundle/cordis.patch.yml`, `dsh-plugin.json`), the lanes (`skills/dsh-qa/scripts/tui-*.mjs`
and their `SKILL.md` rows), and the packaging set (`scripts/pack-mpd.mjs`, verified by t25).

## VERIFY — what was actually run, raw output in `raw/`

| Command | Result |
|---|---|
| `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --self-test` | exit 0 — `[tui-spec-conformance self-test] ok: matrix mapping two-sided, identity table reproduces on 8 files` (`raw/tui-spec-conformance-selftest.log`) |
| `grep -rln 'zh-CN' scripts/ skills/dsh-qa/ packages/*/test/` (the task's own way to LOCATE the pair gate) | returns exactly `scripts/pack-mpd.mjs` and `skills/dsh-qa/scripts/tui-spec-conformance.mjs` (`raw/doc-pair-gate-locate.log`) |
| `node scripts/pack-mpd.mjs` (run because that file is where the pair is CARRIED) | exit 0, 1125 files staged, and `dist/mpd-package/{README.md,README.zh-CN.md}` both present (`raw/pack-mpd.log`) |
| `node evidence/tui/docs-completeness/<ts>/docs-parity.mjs` (this task's own parity checker, written because the locate step proves the repo gate does not exist) | exit 0 — **87/87 checks** (`raw/docs-parity.log`, `docs-parity.json`): both files exist per pair; the switch link sits within the first 6 lines and points at the twin's basename; **the heading tree (levels + order, code fences excluded) is identical** for all five pairs; the TUI markers this task added are present in BOTH languages; and no RTL/EDA vocabulary appears in any touched doc |
| `grep -n '^#' <en> <zh>` per pair, pasted side by side | `raw/heading-trees-side-by-side.txt` (85 lines, all five pairs) |

**FINDING (reported, not hidden): the repository has NO doc-pair/parity gate.** The locate command
returns only `scripts/pack-mpd.mjs` — which *copies* the README pair and asserts nothing — and
`skills/dsh-qa/scripts/tui-spec-conformance.mjs`, which merely *reads* `docs/tui.md` or its twin for
the `trusted-in-process` disclosure string. Nothing in `scripts/`, `skills/dsh-qa/` or
`packages/*/test/` asserts that a bilingual pair exists, that the switch link is present, or that the
heading trees agree. This task therefore checks those properties with `docs-parity.mjs`
(87 assertions, exit 0) instead of citing a gate that does not exist. Adding such a gate is a
follow-up outside this task's inScope.

## Scope and isolation

Writes are confined to the task's `inScope`: the ten doc files listed under `changedPaths` and
`evidence/tui/docs-completeness/<ts>/`. `docs/tui.md`, `docs/tui.zh-CN.md`,
`docs/tui-edition-report.md`, `docs/plan-*.md`, `packages/`, `skills/`, `scripts/`,
`VENDOR_LOCK.json` and `package.json` were **not** written (the packed `dist/mpd-package/` that
`scripts/pack-mpd.mjs` refreshes is gitignored and is a build artifact, not a source change). No git
command was run.
