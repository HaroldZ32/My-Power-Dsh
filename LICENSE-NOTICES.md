# License Notices

This file states where the third-party content that ships in this repository comes from, and what
each component's licence requires. It covers what is in the tree today.

This repository's own code is MIT — [`LICENSE.md`](./LICENSE.md), `Copyright (c) 2026 HaroldZ32`.
Third-party components keep their own licences, reproduced in the files named below.

## Skill corpus — MIT, from `code-yeongyu/lazycodex`

Sixteen skills under `skills/` are the `omo` corpus, sourced from the same author's MIT re-license:

`ast-grep`, `data-scientist`, `debugging`, `frontend`, `git-master`, `init-deep`, `lsp-setup`,
`programming`, `refactor`, `remove-ai-slops`, `review-work`, `ultimate-browsing`,
`autoproject-execute`, `autoproject-plan`, `autoproject-research`, `visual-qa`.

- Repository: <https://github.com/code-yeongyu/lazycodex>
- Source path: `plugins/omo/skills/<name>/`
- Licence: **MIT**, `Copyright (c) 2026 Yeongyu Kim`
- Re-license notice, quoted verbatim from `plugins/omo/components/rules/NOTICE`:

  > Yeongyu Kim (https://github.com/code-yeongyu), author of omo, pi-rules, and this
  > package, licenses the source distributed in this repository under the MIT License.
  > If any source was ported from omo or pi-rules, that ported source is re-licensed
  > here under MIT for distribution as a Codex plugin. See LICENSE for terms.

Each re-sourced skill carries its own `ATTRIBUTION.md` beside its `SKILL.md` — see, for example,
`skills/ast-grep/ATTRIBUTION.md` — with the source path, the full MIT permission text, and the local
adaptations that are this repository's own work. Two further skills — `dsh-qa`
(`skills/dsh-qa/SKILL.md`) and `svn-master` (`skills/svn-master/SKILL.md`) — are written here and
carry no third-party obligation.

### `skills/review-work` — mixed

The orchestration scaffolding is the corpus content above. The review PANEL — the hands-on lane,
three read-only reviewer lanes, the single merge table with `PASS` / `FAIL` / `INCONCLUSIVE`, and the
degrade matrix — is this repository's own work, MIT. The per-file split is recorded in
`skills/review-work/ATTRIBUTION.md`.

### Third-party material inside those skills

- **`skills/frontend`** — brand design-system references from **Open Design**, Apache-2.0. The full
  text ships at `skills/frontend/LICENSE-Apache-2.0.txt`; the taste-skill, ui-ux-db and designpowers
  references are listed in `skills/frontend/ATTRIBUTION.md`.
- **`skills/ast-grep`** — MIT, `Copyright (c) 2026 Yeongyu Kim`, from
  <https://github.com/code-yeongyu/ast-grep-skill>. The carriers `skills/ast-grep/SOURCE` and
  `skills/ast-grep/LICENSE` travel with it.
- **`skills/ultimate-browsing`** — the `engine/**` tree is the **insane-search** engine, MIT,
  `Copyright (c) 2026 fivetaku`, from <https://github.com/fivetaku/insane-search>, modified here. Its
  Tier-2 runtime dependencies are **CloakBrowser** (MIT wrapper; the downloaded Chromium build carries
  a separate binary licence, <https://github.com/CloakHQ/CloakBrowser>) and **agent-browser**
  (Apache-2.0, <https://github.com/vercel-labs/agent-browser>); neither is vendored here. Full texts
  and the runtime pins are in `skills/ultimate-browsing/ATTRIBUTION.md`.

## `skills/cordis-dev` — MIT, adapted from the DeepSeek Harness creation-mode skills

`skills/cordis-dev/SKILL.md` is written for this bundle from the four skills the DeepSeek Harness
ships in its `cordis` agent preset: `cordis-plugin-development`, `editing-cordis-compositions`,
`cordis-composition-reference` and `agent-experience`. Those files ship inside the npm package
`@deepseek-ai/dsh-agent-preset` (<https://github.com/deepseek-ai/deepseek-harness>), **MIT**,
`Copyright (c) 2026 DeepSeek`. No upstream file is redistributed here. What transfers is the loader
patch dialect, the plugin forms, the practices and the verification discipline; the bundle-specific
sections are this repository's own.

## Roster persona texts — permissive seeds

`packages/mpd-roles-plugin/personas/` holds one persona per specialist. Nine are adapted from
permissively licensed public agent prompts (the seed supplied the shape of the discipline, the wording
is new); two are written here.

| Role | Persona file | Adapted from | Licence | Copyright |
|---|---|---|---|---|
| Architect | `oracle.md` | <https://github.com/anthropics/claude-plugins-official/blob/HEAD/plugins/code-modernization/agents/architecture-critic.md> | Apache-2.0 | no copyright line and no `NOTICE` at that path |
| Researcher | `librarian.md` | <https://github.com/VoltAgent/awesome-claude-code-subagents/blob/HEAD/categories/10-research-analysis/research-analyst.md> | MIT | `Copyright (c) 2025 VoltAgent` |
| Planner | `prometheus.md` | <https://github.com/gsd-build/gsd-2/blob/HEAD/src/resources/agents/planner.md> | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Deep Worker | `hephaestus.md` | <https://github.com/gsd-build/gsd-2/blob/HEAD/src/resources/agents/worker.md> | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Senior Engineer | `sisyphus.md` | <https://github.com/VoltAgent/awesome-claude-code-subagents/blob/HEAD/categories/01-core-development/fullstack-developer.md> | MIT | `Copyright (c) 2025 VoltAgent` |
| Lead | `atlas.md` | <https://github.com/VoltAgent/awesome-claude-code-subagents/blob/HEAD/categories/09-meta-orchestration/multi-agent-coordinator.md> | MIT | `Copyright (c) 2025 VoltAgent` |
| Explorer | `explore.md` | <https://github.com/jayminwest/overstory/blob/HEAD/agents/scout.md> | MIT | `Copyright (c) 2026 Jaymin West` |
| Reviewer | `metis.md` | <https://github.com/obra/superpowers/blob/HEAD/skills/requesting-code-review/code-reviewer.md> | MIT | `Copyright (c) 2025 Jesse Vincent` |
| Plan Reviewer | `momus.md` | <https://github.com/VeryGoodOpenSource/vgv-wingspan/blob/HEAD/skills/shared/references/plan-review.md> | MIT | `Copyright (c) 2026 Very Good Ventures` |
| Vision Analyst | `multimodal-looker.md` | written here | — | — |
| Junior Engineer | `sisyphus-junior.md` | written here | — | — |

The seed files and the phrase-overlap measurement are recorded beside the assets in
`packages/mpd-roles-plugin/personas/ATTRIBUTION.md`.

## `packages/mpd-bundle-plugin/adopted/` — AgentTeams browser client (MIT)

`packages/mpd-bundle-plugin/adopted/agent-teams-client.js` (with its source map) is the built browser
client of the dsh-agent-teams project, <https://github.com/NanmiCoder/dsh-agent-teams>, distributed
under the **MIT License**. It is embedded verbatim by `scripts/build-mpd-client.ts` into the shipped
`packages/mpd-bundle-plugin/client.js`, which backs the AgentTeams sidebar tab. The upstream build
carries no copyright line, so none is reproduced here.

## `packages/mpd-schemastery/` — MIT, relocated upstream code

`packages/mpd-schemastery/` holds the schemastery validator plus `cosmokit` (`lib/`) used by the
bundle's schema-declaring plugins, and the DSH framework modules under `harness/` that this
repository's test suite drives. Both upstream works are MIT and both notices are reproduced in full
in `packages/mpd-schemastery/LICENSE`:

- `schemastery`, `cosmokit`, `cordis` — `Copyright (c) 2021-present Shigma`.
- the `@deepseek-ai/dsh-*` modules — `Copyright (c) 2026 DeepSeek`, from
  <https://github.com/deepseek-ai/deepseek-harness>.

## Declared npm dependencies

These are resolved by the package manager at install time and are not redistributed here, except the
CodeGraph server noted below.

| Package | Licence | Copyright | What it powers |
|---|---|---|---|
| `@deepseek-ai/*` harness packages | MIT | `Copyright (c) 2026 DeepSeek` | the harness itself |
| `@dsh-std/sdk` | MIT | `Copyright (c) 2026 DSH Standard contributors` | the DSH-STD protocol client |
| `dsh-better-sidebar` | MIT | `Copyright (c) 2026 dsh-external` | the sidebar host |
| `cclsp` | MIT | `Copyright (c) 2025 ktnyt` | `mcp__lsp__*`, launched by `packages/mpd-mcp-lsp/` |
| `@cyanheads/git-mcp-server` | Apache-2.0 | Casey Hand | git MCP, launched by `packages/mpd-mcp-gitbash/` |
| `mcp-server-commands` | MIT | no copyright line in the package's `LICENSE` | shell MCP, launched by `packages/mpd-mcp-gitbash/` |
| `@colbymchenry/codegraph` | MIT | no copyright line in the installed package; the vendored server carries one, below | the CodeGraph runtime |

`@code-yeongyu/comment-checker` (MIT, <https://github.com/code-yeongyu/go-claude-code-comment-checker>)
is an optional binary installed on demand into `.toolchain`. It is not redistributed here.

## Vendored prebuilt server — CodeGraph

`packages/mpd-mcp-codegraph/dist/serve.js` is a prebuilt server distributed with this repository. Its
licence and notices travel with it:

- `packages/mpd-mcp-codegraph/LICENSE` — MIT, `Copyright (c) 2026 Yeongyu Kim`.
- `packages/mpd-mcp-codegraph/NOTICE` — what the component installs and what it embeds.
- `packages/mpd-mcp-codegraph/NODE-RUNTIME-LICENSES.md` — the Node.js runtime and the bundled
  third-party texts.

## Official Agent Teams plugin set — MIT

Three packages, declared in `dependencies` and mounted by this bundle's `mpd-agent-team`,
`mpd-tool-agent-team` and `mpd-ui-agent-team` rows. None is vendored.

- `@deepseek-ai/dsh-experimental-agent-team` — the team service: roster, durable peer mailbox,
  shared task DAG.
- `@deepseek-ai/dsh-experimental-tool-agent-team` — the model-facing team tools.
- `@deepseek-ai/dsh-experimental-client-ui-agent-team` — the web roster, board and teammate
  navigation client.

All three are **MIT**, `Copyright (c) 2026 DeepSeek`.
