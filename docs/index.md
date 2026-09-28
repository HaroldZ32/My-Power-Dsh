# my-power-dsh Documentation

**English** | [中文](index.zh-CN.md)

The documentation hub for the **my-power-dsh** DeepSeek Harness (DSH) bundle. Start with the
[README](../README.md) if you only want to know what the bundle is and how to install it; come back
here for the full set.

![Layered architecture diagram: the DeepSeek Harness host, the bundle's two patch layers, the single adapter seam, the user surfaces and the state roots.](./assets/images/architecture.svg)

*The shape of the bundle: a DSH host, two patch layers, one adapter seam, the surfaces a user touches and the state roots. The full assembly is [`design.md`](design.md).*

## Reading paths

### For users

1. [README](../README.md) — the product page: features, install, quick start, configuration, FAQ.
2. [`user-guide.md`](user-guide.md) — the long-form task-oriented guide.
3. [`tui.md`](tui.md) — the DSH-TUI edition, if you work in a terminal.
4. [README § FAQ](../README.md#faq) — the symptom → fix index.

### For extension authors

1. [`extension-authoring-guide.md`](extension-authoring-guide.md) — when an extension is the right
   instrument, and the template walkthrough.
2. [`extensions.md`](extensions.md) — the frozen contract, the four contribution kinds, the CLI.
3. [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) — the machine contract for an agent
   writing an extension (English-only).
4. [`../extensions/README.md`](../extensions/README.md) — the shipped discovery root.

### For contributors

1. [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — setup, build and test commands, gates, the git model.
2. [`development.md`](development.md) — the repository's own working detail: layout, QA lanes,
   packing, vendoring, release flow.
3. [`design.md`](design.md) — how the bundle is assembled and mounts; read it before changing
   anything under `packages/`.
4. [`../AGENTS.md`](../AGENTS.md) — the binding repository manual (English-only).
5. [`../CHANGELOG.md`](../CHANGELOG.md) — what changed in each release.
6. [`../SECURITY.md`](../SECURITY.md) — how to report a vulnerability privately.

### For agents

1. [`../AGENTS.md`](../AGENTS.md) — the binding manual: conventions, gates, git model.
2. [`../agent-references/troubleshooting.md`](../agent-references/troubleshooting.md) — the full
   symptom → cause → fix table.
3. [`../agent-references/agent-teams-deltas.md`](../agent-references/agent-teams-deltas.md) — the
   adopted agent-teams delta registry (only when touching that package).

`agent-references/**` is agent-facing and English-only by policy; it is deliberately outside the
bilingual band this hub documents.

## Documentation index

| Doc | Audience | Contents |
|---|---|---|
| [`../README.md`](../README.md) | everyone | The product page: what the bundle is, the capability inventory, the install steps, quick start, configuration, FAQ. |
| [`user-guide.md`](user-guide.md) | users | The task-oriented guide: install/uninstall, the `mpd` preset, tools by job, the specialist roster, the workmate library, team mode, the DSH-TUI edition chapter, the Web GUI, `mpd.jsonc` configuration, extensions from a user's point of view, troubleshooting. |
| [`extensions.md`](extensions.md) | extension authors | The extension interface — the frozen descriptor contract, the four contribution kinds (skills, flows, MCP servers, roles), the discovery roots and the developer CLI. |
| [`extension-authoring-guide.md`](extension-authoring-guide.md) | extension authors, newcomers | The task-oriented authoring guide — when an extension is the right instrument, the one plane-selection rule, the isolation posture and its accepted residuals, the lifecycle/restart matrix, the template walkthrough, distribution and troubleshooting. |
| [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) | agents writing an extension | The machine contract, English-only — kind-by-kind requirements, a manifest skeleton that is validated on every docs-check run, plane legality, error signatures, the refusal list and the v1 hard limits. |
| [`extension-adaptation-report.md`](extension-adaptation-report.md) | technical decision-makers | The current-state report on external-plugin adaptation — the two planes and who should use which, the extension-interface inventory, the runtime and isolation posture, what was live-verified on this tree, risks/gaps, and prioritized P0/P1/P2 recommendations. |
| [`tui.md`](tui.md) | users of a TUI session | The DSH-TUI edition — the install command, the TUI-native surfaces, the admission and distribution artifacts, the per-package compatibility ledger and the explicit NOT-CLAIMED list. |
| [`design.md`](design.md) | engineers, curious users | How the bundle is assembled and mounts: patch layers, boot chain, plugin inventory, interaction flows, state layout, web-client wiring, TUI edition wiring. |
| [`development.md`](development.md) | developers | Repo layout, build/test commands, the QA case catalog, gates, packing/installing, vendoring, git model, common pitfalls. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | contributors | How to contribute: development setup, gates, the git model, documentation rules, evidence, pull requests. |
| [`../SECURITY.md`](../SECURITY.md) | reporters | The security policy: supported versions, the private reporting path, and which code is in scope. |
| [`../CHANGELOG.md`](../CHANGELOG.md) | everyone | Release notes, newest first, one section per released version. |
| [`../AGENTS.md`](../AGENTS.md) | agents + maintainers | The binding repository manual: conventions, gates, git model, troubleshooting. |
| [`../extensions/README.md`](../extensions/README.md) | extension authors | The bundle-shipped discovery root: the three roots, their lifecycles and the shipped reference extension. |

Maintainer material — the current working spec rather than history:

| Doc | Audience | Contents |
|---|---|---|
| [`feature-audit.md`](feature-audit.md) | engineers | The engineering baseline: pinned upstream `8c57e46` (v5.0.0-beta.20) spec vs port status (the capability target `AGENTS.md` §1 points at). |
| [`upstream-parity-ledger.md`](upstream-parity-ledger.md) | maintainers, reviewers | The maintained specialist-parity ledger against the pinned baseline, in both languages ([中文](upstream-parity-ledger.zh-CN.md)). |

## Package reference

Each package under `packages/<name>/` carries a bilingual `README.md` + `README.zh-CN.md`, with two
stated exceptions: **`mpd-mcp-shared`** (the helper module shared by the MCP servers) ships source and
tests only — its README pair is a recorded follow-up — and the RETIRED
**`mpd-agent-teams-plugin`** keeps upstream's `README.md` verbatim as provenance, which the bilingual
rule exempts.

- **Host plugins** — `mpd-dsh-adapter-plugin` (the single harness-seam adapter every row calls
  through), `mpd-config-plugin`, `mpd-tools-plugin`, `mpd-modelchain-plugin`,
  `mpd-roles-plugin`, `mpd-ext-plugin` (the extension interface), `mpd-ulw-plugin`,
  `mpd-hashline-plugin`, `mpd-boulder-plugin`, `mpd-comment-checker-plugin`,
  `mpd-memory-plugin`, `mpd-codegraph-plugin`, `mpd-workmate-plugin`,
  `mpd-bootstrap-plugin`, `mpd-team-compact-plugin`, `mpd-agent-teams-plugin` (retained
  provenance — NO row mounts it),
  `mpd-bundle-plugin` (bundle web-compat + combined web client),
  `mpd-qa-roles-probe` (QA-only).
- **MCP servers** — `mpd-mcp-astgrep`, `mpd-mcp-gitbash`, `mpd-mcp-lsp`, `mpd-mcp-codegraph`.
- **MCP shared helper** — `mpd-mcp-shared` (binary resolution and the stdio core the four server
  wrappers launch).
- **Aggregation** — `mpd-bundle` (`cordis.patch.yml`).

## Image assets

All documentation images live under [`assets/images/`](./assets/images). They are diagrams
(authored as SVG so the labels stay selectable and diffable) and captures of the shipped Web UI:

| Asset | Referenced from | Shows |
|---|---|---|
| [`architecture.svg`](./assets/images/architecture.svg) | this hub, [README](../README.md#architecture) | The bundle's layers: DSH host → patch layer 1 → patch layer 2 → adapter seam → surfaces → state roots. |
| [`ulw-loop.svg`](./assets/images/ulw-loop.svg) | [README](../README.md#drive-long-work-the-ulw-loop) | One ultrawork run: triage, optional plan, round-by-round execution through `pin → red → green → surface → clean`, the verification gate and the quality gate. |
| [`team-lifecycle.svg`](./assets/images/team-lifecycle.svg) | [README](../README.md#team-mode) | One team wave end to end, plus the guardrails (read-only tool denial, durable mailbox, compare-and-set board, advisory write scopes). |
| [`web-ui-session.png`](./assets/images/web-ui-session.png) | [README](../README.md) | A live session on the MPD preset with the Agent Teams roster and shared task board open. |
| [`web-ui-home.png`](./assets/images/web-ui-home.png) | [README](../README.md#quick-start) | The workspace landing: the composer already on the MPD preset, with the model route beside it. |
| [`web-ui-plugins.png`](./assets/images/web-ui-plugins.png) | [README](../README.md#what-the-install-mounts) | The Plugins page after the one install: `@mpd-dsh/mpd` under **Installed**, enabled. |
| [`web-ui-agent-presets.png`](./assets/images/web-ui-agent-presets.png) | [README](../README.md#project-rules-and-the-main-agent) | The Agent presets page: the `mpd` preset badged **New task default**. |
| [`web-ui-settings.png`](./assets/images/web-ui-settings.png) | [README](../README.md#configuration) | The MPD settings card in the Web GUI — the same knobs as `.mpd/mpd.jsonc`. |

The five PNG captures were taken from the shipped bundle by the Docker UI lane and copied here from
`docker/ui/out/shots/` (`06-team-panel.png`, `02-home.png`, `03-plugins.png`,
`05-settings-agent-presets.png`, `04-settings-mpd.png`); the SVG diagrams are authored in this
repository.

## Extension assets

- [`../extensions/README.md`](../extensions/README.md) — the bundle-shipped discovery root.
- [`../extensions/mpd-ext-example/`](../extensions/mpd-ext-example) — the disabled reference
  extension: a skill, a flow, a role and a working dependency-free stdio MCP server.
- [`../scripts/mpd-ext.ts`](../scripts/mpd-ext.ts) — the developer CLI
  (`validate` / `scaffold` / `list` / `--self-test`).

## Process records

`docs/plan-{c,d,e,f}.md`, `docs/decisions.md` and the `track-a-report.md` / `bline-report.md`
records document the port decisions and the evidence timeline. They are history, not the current
spec; `AGENTS.md`, `docs/feature-audit.md` and the docs above are current.
`docs/plan-tui-edition.md` and `docs/tui-edition-report.md` are the same kind of record for the
DSH-TUI edition: the frozen acceptance contract, and the delivery report that judges it. These files
are exempt from the bilingual rule by policy (`AGENTS.md` §3), and each carries its own exemption
marker or matches a declared pattern.

## QA evidence

Real-run evidence lives under `evidence/<domain>/<slug>/<timestamp>/`; each QA case in
[`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md) documents its assertion.
