# my-power-dsh Documentation

**English** | [中文](index.zh-CN.md)

The documentation hub for the my-power-dsh DeepSeek Harness (DSH) bundle. Start with the
[README](../README.md) if you only want to know what the bundle is and how to install it; come
back here for the full set.

## Reading order

| Doc | Audience | Contents |
|---|---|---|
| [`../README.md`](../README.md) | everyone | The product page: what the bundle is, the capability inventory, one-command install, quick start. |
| [`user-guide.md`](user-guide.md) | users | The task-oriented guide: install/uninstall, the `mpd` preset, tools by job, the specialist roster, the workmate library, team mode, the DSH-TUI edition chapter, the Web GUI, `mpd.jsonc` configuration, extensions from a user's point of view, troubleshooting. |
| [`extensions.md`](extensions.md) | extension authors | **New**: the extension interface — the frozen descriptor contract, the four contribution kinds (skills, flows, MCP servers, roles), the discovery roots and the developer CLI. |
| [`extension-authoring-guide.md`](extension-authoring-guide.md) | extension authors, newcomers | **New**: the task-oriented authoring guide — when an extension is the right instrument, the one plane-selection rule, the isolation posture and its accepted residuals, the lifecycle/restart matrix, the template walkthrough, distribution and troubleshooting. |
| [`../EXTENSIONS-FOR-AGENTS.md`](../EXTENSIONS-FOR-AGENTS.md) | agents writing an extension | **New**: the machine contract, English-only — kind-by-kind requirements, a manifest skeleton that is validated on every docs-check run, plane legality, error signatures, the refusal list and the v1 hard limits. |
| [`extension-adaptation-report.md`](extension-adaptation-report.md) | technical decision-makers | **New**: the current-state report on external-plugin adaptation — the two planes and who should use which, the extension-interface inventory, the runtime and isolation posture, what was live-verified on this tree, risks/gaps, and prioritized P0/P1/P2 recommendations. |
| [`tui.md`](tui.md) | users of a TUI session | **New**: the DSH-TUI edition — the install command, the TUI-native surfaces, the admission and distribution artifacts, the per-package compatibility ledger and the explicit NOT-CLAIMED list. |
| [`architecture.md`](architecture.md) | engineers, curious users | How the bundle is assembled and mounts: patch layers, boot chain, plugin inventory, interaction flows, state layout, web-client wiring, TUI edition wiring. |
| [`development.md`](development.md) | developers | Repo layout, build/test commands, the QA case catalog, gates, packing/installing, vendoring, git model, common pitfalls. |
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
tests only — its README pair is a recorded follow-up — and the adopted
**`mpd-agent-teams-plugin`** keeps upstream's `README.md` verbatim as provenance, which the bilingual
rule exempts.

- **Host plugins** — `mpd-dsh-adapter-plugin` (the single harness-seam adapter every row calls
  through), `mpd-config-plugin`, `mpd-tools-plugin`, `mpd-modelchain-plugin`,
  `mpd-roles-plugin`, `mpd-ext-plugin` (the extension interface), `mpd-ulw-plugin`,
  `mpd-hashline-plugin`, `mpd-boulder-plugin`, `mpd-comment-checker-plugin`,
  `mpd-memory-plugin`, `mpd-codegraph-plugin`, `mpd-workmate-plugin`,
  `mpd-bootstrap-plugin`, `mpd-team-compact-plugin`, `mpd-agent-teams-plugin` (adopted),
  `mpd-bundle-plugin` (bundle web-compat + combined web client),
  `mpd-qa-roles-probe` (QA-only).
- **MCP servers** — `mpd-mcp-astgrep`, `mpd-mcp-gitbash`, `mpd-mcp-lsp`, `mpd-mcp-codegraph`.
- **MCP shared helper** — `mpd-mcp-shared` (binary resolution and the stdio core the four server
  wrappers launch).
- **Aggregation** — `mpd-bundle` (`cordis.patch.yml`).

## Extension assets

- [`../extensions/README.md`](../extensions/README.md) — the bundle-shipped discovery root.
- [`../extensions/mpd-ext-example/`](../extensions/mpd-ext-example) — the disabled reference
  extension: a skill, a flow, a role and a working dependency-free stdio MCP server.
- [`../scripts/mpd-ext.mjs`](../scripts/mpd-ext.mjs) — the developer CLI
  (`validate` / `scaffold` / `list` / `--self-test`).

## Historical planning docs

`docs/plan-{c,d,e,f}.md`, `docs/decisions.md` and the `track-a-report.md` / `bline-report.md`
records document the port decisions and the evidence timeline. They are history, not the current
spec; `AGENTS.md`, `docs/feature-audit.md` and the docs above are current.
`docs/plan-tui-edition.md` and `docs/tui-edition-report.md` are the same kind of record for the
DSH-TUI edition: the frozen acceptance contract, and the delivery report that judges it.

## QA evidence

Real-run evidence lives under `evidence/<domain>/<slug>/<timestamp>/`; each QA case in
[`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md) documents its assertion.
