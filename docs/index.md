# my-power-dsh Documentation

**English** | [中文](index.zh-CN.md)

This is the documentation index for the my-power-dsh DeepSeek Harness (DSH) bundle.
Everything below is the authoritative documentation set; the repository manual is
[`AGENTS.md`](../AGENTS.md) (binding rules for agents and humans) and the public
overview is [`README.md`](../README.md).

## Reading order

| Doc | Audience | Contents |
|---|---|---|
| [`../README.md`](../README.md) | everyone | Short public overview: what the bundle provides, inheritance/provenance. |
| [`feature-audit.md`](feature-audit.md) | engineers | Current engineering baseline: upstream `8c57e46` (v5.0.0-beta.20) spec vs port status (the capability target AGENTS.md §1 points at). |
| [`user-guide.md`](user-guide.md) | users | Install, presets, specialists (roster), workmate library, team mode, GUI panels, configuration. |
| [`architecture.md`](architecture.md) | engineers, curious users | How the bundle is assembled and mounts: patch layers, plugin inventory, model routing, state layout, web-client wiring, interaction flows. |
| [`development.md`](development.md) | developers | Repo layout, build/test commands, QA case catalog, gates, packing/installing, vendoring, git model, common pitfalls. |
| [`../AGENTS.md`](../AGENTS.md) | agents + maintainers | Binding repository manual: conventions, gates, git model, troubleshooting. |
| [`../LICENSE.md`](../LICENSE.md), [`../LICENSE-NOTICES.md`](../LICENSE-NOTICES.md) | everyone | SUL-1.0 license + third-party notices (adopted dsh-agent-teams, comment-checker). |

## Package reference

One README per package under `packages/<name>/README.md`:

- **Host plugins** — `mpd-config-plugin`, `mpd-tools-plugin`, `mpd-modelchain-plugin`,
  `mpd-roles-plugin`, `mpd-ulw-plugin`, `mpd-hashline-plugin`, `mpd-boulder-plugin`,
  `mpd-comment-checker-plugin`, `mpd-memory-plugin`, `mpd-codegraph-plugin`,
  `mpd-dsh-adapter-plugin` (the single harness-seam adapter every row calls through),
  `mpd-workmate-plugin`, `mpd-bootstrap-plugin`, `mpd-agent-teams-plugin` (adopted),
  `mpd-bundle-plugin` (bundle web-compat + combined web client),
  `mpd-qa-roles-probe` (QA-only).
- **MCP servers** — `mpd-mcp-astgrep`, `mpd-mcp-gitbash`, `mpd-mcp-lsp`,
  `mpd-mcp-codegraph`.
- **Aggregation** — `mpd-bundle` (`cordis.patch.yml`).

## Historical planning docs

`docs/plan-{c,d,e,f}.md`, `docs/decisions.md` and the
`track-a-report.md` / `bline-report.md` records document the port decisions and
evidence timeline. They are history, not the current spec; `AGENTS.md`,
`docs/feature-audit.md` and the docs above are current.

## QA evidence

Real-run evidence lives under `evidence/<domain>/<slug>/<timestamp>/`; each QA case
in [`skills/dsh-qa/SKILL.md`](../skills/dsh-qa/SKILL.md) documents its assertion.
