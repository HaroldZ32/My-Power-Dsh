# Wave A — per-skill diff summary (pre-merge backup vs shipped corpus)

`added` = shipped now, absent before · `removed` = was shipped, gone now · `changed` = different bytes.
`adaptations-kept` = files whose pre-merge bytes were the base for the merged result (our adaptation only,
or our adaptation re-applied over upstream's content).

## ast-grep

- files shipped: **19** (was 18)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `AGENTS.md`, `SKILL.md`
- adaptations kept (our content driving the merged result): `AGENTS.md`, `install.ps1`, `install.sh`, `scripts/ast_grep_helper.py`, `tests/smoke.sh`
- ours-only files still shipped: `.gitignore`
- ours-only files dropped in this wave (unreferenced + superseded): —

## data-scientist

- files shipped: **12** (was 9)
- added: `ATTRIBUTION.md`, `references/execution-surfaces.md`, `references/placement.md`, `references/polars-lane.md`, `references/visualization.md`, `scripts/ensure-js-deps.sh`, `scripts/ensure-py-deps.sh`
- removed: `references/common-scenarios.md`, `references/execution-templates.md`, `references/integration-patterns.md`, `references/performance-benchmarks.md`
- changed: `references/uv-setup.md`, `SKILL.md`
- adaptations kept (our content driving the merged result): frontmatter + local sections only
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): `references/common-scenarios.md`, `references/execution-templates.md`, `references/integration-patterns.md`, `references/performance-benchmarks.md`

## debugging

- files shipped: **21** (was 20)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `references/methodology/00-setup.md`, `references/methodology/02-investigate.md`, `references/methodology/06-fix.md`, `references/runtimes/go.md`, `references/runtimes/native-binary.md`, `references/runtimes/node.md`, `references/runtimes/python.md`, `references/runtimes/rust.md`, `SKILL.md`
- adaptations kept (our content driving the merged result): `references/methodology/04-oracle-triple.md`, `references/methodology/08-qa.md`, `references/methodology/partial-runtime-evidence.md`, `SKILL.md`
- ours-only files still shipped: `references/tools/playwright-cli.md`
- ours-only files dropped in this wave (unreferenced + superseded): —

## frontend

- files shipped: **30** (was 28)
- added: `references/design/ambience-skill.md`, `references/design/component-catalogs.md`
- removed: —
- changed: `ATTRIBUTION.md`, `references/design/aside.md`, `references/design/clone-from-url.md`, `references/design/design-system-architecture.md`, `references/design/_INDEX.md`, `references/design/interaction-skill.md`, `references/design/layout-skill.md`, `references/design/README.md`, `references/perfection/README.md`, `scripts/perfection/lighthouse-audit.py`, `SKILL.md`
- adaptations kept (our content driving the merged result): `references/design/aside.md`, `references/designpowers/lane-a-direction.md`, `references/designpowers/lane-b-execution.md`, `references/designpowers/lane-d-memory.md`, `references/designpowers/orchestration.md`, `references/designpowers/routing.md`
- ours-only files still shipped: `.gitignore`, `.npmignore`
- ours-only files dropped in this wave (unreferenced + superseded): —

## git-master

- files shipped: **3** (was 2)
- added: `ATTRIBUTION.md`
- removed: —
- changed: —
- adaptations kept (our content driving the merged result): frontmatter + local sections only
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## init-deep

- files shipped: **2** (was 1)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `SKILL.md`
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## lsp-setup

- files shipped: **26** (was 25)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `scripts/verify-lsp.ts`, `SKILL.md`
- adaptations kept (our content driving the merged result): `scripts/detect-lsp.ts`, `scripts/lsp-server-table.ts`, `scripts/verify-lsp.ts`, `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## programming

- files shipped: **79** (was 76)
- added: `ATTRIBUTION.md`, `references/rust/api-design.md`, `references/rust/macros.md`
- removed: —
- changed: `references/rust/async-tokio.md`, `references/rust/axum-stack.md`, `references/rust/cargo-strict.md`, `references/rust/clap-stack.md`, `references/rust/concurrency.md`, `references/rust/libraries.md`, `references/rust/one-liners.md`, `references/rust/proptest-insta.md`, `references/rust/README.md`, `references/rust/type-state.md`, `references/rust-ub/miri-sanitizers-loom.md`, `references/rust-ub/ub-taxonomy.md`, `references/rust/unsafe-discipline.md`, `references/rust/zero-cost-safety.md`, `scripts/rust/check-no-excuse-rules.sh`, `scripts/rust/new-project.py`, `scripts/typescript/check-no-excuse-rules.ts`, `SKILL.md`
- adaptations kept (our content driving the merged result): `references/rust/cargo-strict.md`, `scripts/typescript/check-no-excuse-rules.ts`, `scripts/typescript/new-project.ts`
- ours-only files still shipped: `scripts/rust/check-no-excuse-rules.py`, `scripts/typescript/check-no-excuse-rules.test.ts`, `scripts/typescript/typescript-unstable.d.ts`
- ours-only files dropped in this wave (unreferenced + superseded): —

## refactor

- files shipped: **2** (was 1)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `SKILL.md`
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## remove-ai-slops

- files shipped: **2** (was 1)
- added: `ATTRIBUTION.md`
- removed: —
- changed: —
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## review-work

- files shipped: **2** (was 1)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `SKILL.md`
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## ultimate-browsing

- files shipped: **57** (was 57)
- added: —
- removed: —
- changed: `ATTRIBUTION.md`, `engine/AGENTS.md`, `engine/templates/package.json`, `engine/templates/playwright_mobile_chrome.js`, `engine/templates/playwright_real_chrome.js`, `engine/tests/test_playwright_templates.py`, `references/insane-search/playwright.md`, `references/insane-search/README.md`, `scripts/extract_cookies.py`, `SKILL.md`
- adaptations kept (our content driving the merged result): `engine/tests/test_playwright_templates.py`, `references/chrome-stealth.md`, `scripts/extract_cookies.py`
- ours-only files still shipped: `.gitignore`, `scripts/tests/test_cookie_domain_filter.py`, `scripts/tests/test_extract_cookies.py`
- ours-only files dropped in this wave (unreferenced + superseded): —

## ulw-execute

- files shipped: **2** (was 1)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `SKILL.md`
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## ulw-plan

- files shipped: **7** (was 6)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `references/full-workflow.md`, `references/intent-clear.md`, `references/intent-unclear.md`, `SKILL.md`
- adaptations kept (our content driving the merged result): `references/full-workflow.md`, `SKILL.md`
- ours-only files still shipped: `scripts/scaffold-plan.ts`
- ours-only files dropped in this wave (unreferenced + superseded): —

## ulw-research

- files shipped: **23** (was 2)
- added: `references/deliverable-phase.md`, `references/report-gates.md`, `scripts/cli-support.mjs`, `scripts/contracts.mjs`, `scripts/css-lite.mjs`, `scripts/design-spec.mjs`, `scripts/entities.mjs`, `scripts/entry-guard.mjs`, `scripts/format-extract-css.mjs`, `scripts/format-extract.mjs`, `scripts/gates-figures.mjs`, `scripts/gates-layout.mjs`, `scripts/gates-static.mjs`, `scripts/gates-structure.mjs`, `scripts/gates-text.mjs`, `scripts/html-lite.mjs`, `scripts/layout-probe.mjs`, `scripts/outcome.mjs`, `scripts/repair-tracker.mjs`, `scripts/report-tools-commands.mjs`, `scripts/report-tools.mjs`
- removed: —
- changed: `ATTRIBUTION.md`, `SKILL.md`
- adaptations kept (our content driving the merged result): `SKILL.md`
- ours-only files still shipped: —
- ours-only files dropped in this wave (unreferenced + superseded): —

## visual-qa

- files shipped: **20** (was 19)
- added: `ATTRIBUTION.md`
- removed: —
- changed: `references/agent-browser-setup.md`, `scripts/cli.ts`, `scripts/image-diff.ts`, `scripts/png-decode.ts`, `scripts/tui-grid.ts`, `SKILL.md`
- adaptations kept (our content driving the merged result): `scripts/ansi.ts`, `scripts/cli.ts`, `scripts/east-asian-width.ts`, `scripts/image-diff.ts`, `scripts/png-crc.ts`, `scripts/png-decode.ts`, `scripts/png-synth.ts`, `scripts/tui-grid.ts`, `scripts/types.ts`, `SKILL.md`
- ours-only files still shipped: `references/agent-browser-setup.md`, `scripts/ansi.test.ts`, `scripts/cli.test.ts`, `scripts/east-asian-width.test.ts`, `scripts/image-diff.test.ts`, `scripts/png-decode.test.ts`, `scripts/tui-grid.test.ts`
- ours-only files dropped in this wave (unreferenced + superseded): —
