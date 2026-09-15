# TUI QA lanes — t7 summary (five lanes + registration)

Owner: `t7` (Lead, attempt 2). In scope: `skills/dsh-qa/**`, `evidence/tui/lanes/**`.
All five lanes are first-class dsh-qa cases: offline `--self-test` + a real lane that writes
`evidence/tui/lanes/<timestamp>/{result.json,output.log,…}`.

## The five lanes

| Case | Command | Self-test | Real run |
|---|---|---|---|
| `tui-mount` | `bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root>` | pass | **PASS** — `evidence/tui/lanes/2026-09-15T06-11-49.573Z/` |
| `tui-panels` | `bun skills/dsh-qa/scripts/tui-panels.mjs --sandbox-root <root>` | pass | **RED on ONE surface** (see finding) — `…T06-24-28.995Z/` |
| `tui-admission` | `bun skills/dsh-qa/scripts/tui-admission.mjs --sandbox-root <root>` | pass | **PASS** — `…T06-26-38.862Z/` |
| `tui-distribution` | `bun skills/dsh-qa/scripts/tui-distribution.mjs --sandbox-root <root>` | pass | **PASS (full)** — `…T06-28-25.515Z/` |
| `tui-spec-conformance` | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --sandbox-root <root>` | pass | **PASS (blocker recorded)** — `…T06-28-03.972Z/` |

Run from the warm sandbox explicitly (`--sandbox-root /root/dshProj/my-power-dsh/.mpd/recon/qa`);
`t8` must re-run from a root of its own (`--fresh` or a new path) — every result records the resolved
root, so a reused cache cannot hide behind an independent claim (F9).

## Measured results

- **tui-mount**: `dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-harness-tui/dsh-tui","@mpd-dsh/mpd"]`;
  `mpd-tui` row composed; tmux pane + raw ANSI log captured; **zero** apply-crash signatures; keyed
  status line `mpd: team …` rendered; the session THIS run created is decoded from the sandbox store
  with `agentPreset: "mpd"`; its session-store key is the sandbox one
  (`--root-dshProj-my-power-dsh-.mpd-recon-qa-ws--`), while an earlier run's repo-keyed store is
  reported separately as inherited.
- **tui-panels**: 6 of 7 seam surfaces render — status line, `/mpd workmates` (proved from the
  harness's own `command/run` + `command/done` records), `/mpd` completion tree, board SCENE,
  `/settings` section, managed DIALOG. **The transcript RENDERER does not render**: the plugin
  appended its log-only `mpd-tui/board-opened` event (8 occurrences in the sandbox store, one per
  board open) and the scene header itself reports `0 transcript row(s)` — so the seam is registered
  and the event exists, but the Channel projects no row. Recorded as a FAILED surface with
  `rendererCrossCheck` in the result; the negative control (`negative/control.json`, expected
  `control.ok === false`) is recorded in the same run.
- **tui-admission**: the host's own pinned `@dsh-std/manifest` parse+projection, the host contract
  index + `validatePlugin` + five-state `negotiate`, three negative controls, input digests (incl.
  the schema + registry/permissions digests and the spec profile version) → static `ok`.
  Live `/plugins check <abs dsh-plugin.json>` inside the real TUI → **`waiting_authorization`**
  (an accepted, explainable state: the four `session.*.intercept` permissions are deny-defaulted with
  no grant row), and none of the forbidden invalid/schema/spec-unavailable markers.
- **tui-distribution**: the protocol repo was copied into the sandbox, `pnpm install --frozen-lockfile`
  and `pnpm build` both exited 0, and the protocol's OWN CLI
  (`packages/conformance/lib/cli.js dsh-distribution.json`) exited 0 → the descriptor is **fully
  validated by the protocol's own tooling** (not the blocked fallback).
- **tui-spec-conformance**: PRIMARY = the host's pinned submodule at **`d28c267`**; the suite was
  copied workspace-locally with the installed payload on its resolution path and executed twice; both
  attempts exit 1 with the recorded blocker
  (`vendor/dsh-std/packages/core/lib/index.js` is not built — the vendored std submodule ships sources
  only), so the suite's own per-requirement matrix (`requirements-v0.15.json`, 7 rows) was evaluated
  against our artifacts with the pinned parser: all seven rows carry a status + artifact. The
  three-way sha256 identity (archive ↔ installed payload ↔ checkout, 8 files) re-measured **true**;
  nothing was extracted (AC-14's resolution).

## Residual for the wave (not a t7 deliverable)

- `bun run test:qa` exits 1 for exactly ONE reason: `skills/dsh-qa/scripts/agent-teams-messaging.mjs`
  fails the VENDOR_LOCK skills-corpus pairing gate — `lock=301/0dd4a6ee68e0`, `tree=307/e510d8c5c6de`.
  That is the designed consequence of ANY `skills/**` change (AGENTS.md §9/§11) and the single re-pin
  is the captain's commit action. **New fingerprint to pin: `fileCount: 307`,
  `treeSha: e510d8c5c6de1fffc3ceb51cd2c8756474702c07b6b2dc4cd8e0576a316a18cf`.**
  Every other self-test in the corpus passes (verified case by case: 27 cases + `scripts/mpd-ext.mjs`
  all exit 0), and the five new lanes pass their own `--self-test`.
- `VENDOR_LOCK.json` was NOT touched by this task (it is outside every task's inScope by design).

## New/changed paths

`skills/dsh-qa/scripts/{tui-mount,tui-panels,tui-admission,tui-distribution,tui-spec-conformance}.mjs`,
`skills/dsh-qa/scripts/lib/tui-lane.mjs`, `skills/dsh-qa/SKILL.md` (five case rows), and the evidence
under `evidence/tui/lanes/`.

## Implementation notes worth reusing (t8/t9, and any future TUI lane)

- `DSH_TUI_WORKSPACE_TARGET=<sandbox>/ws` is REQUIRED for isolation: the host resolves the session
  workspace from `config.workspace ?? DSH_TUI_WORKSPACE_TARGET` (`src/dsh-adapter/plugin.ts:391`,
  `bin/dsh-tui.js:589-593`). Measured: without it the TUI session ran with the REPO as cwd, so
  workspace-scoped reads and the session-store key escaped the sandbox even though `DSH_HOME`/`HOME`
  pointed inside it.
- The TUI localizes its chrome (zh by default here): pane patterns must accept both languages, and the
  `/settings` section renders as `MPD 插件包 (mpd)`.
- The host hands the keyboard to any overlay (settings screen, managed dialog), so a step that needs
  plain chat state must send its own settle keys first; `tmux`'s backspace key name is `BSpace`.
- A command's success text is recorded in the harness's own session store
  (`command/run` → `command/done`), which is the doctrinally correct witness when the pane does not
  show the transcript region.
