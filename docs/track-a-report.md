# Track A report (P0–P5 first round)

## DoD status (S1–S7)

| # | Standard | Status | Evidence |
|---|---|---|---|
| S1 | Reproducible bundle build | Partially achieved | bootstrap/verify-vendor/build-mcp pass; production profile install (dsh plugin/pnpm) awaits user-side execution — see "Leftovers" |
| S2 | Official API headless+web both ends | headless achieved / web pending manual test | dual-track 7.8s/7.9s PASS; web composition dump passes, real GUI pending manual test |
| S3 | >=3 skills, >=2 MCP, >=3 presets | Exceeded | 7 skills, 2 callable MCPs (ast-grep real success, lsp chain, codegraph disabled by default), 4 presets |
| S4 | Golden pass rate >=80%, including >=2 hardware | Achieved | 9/9=100%, hardware G2(adder4)/G9(cnt8) two tasks |
| S5 | Original repo zero changes zero pushes | Achieved | full-run check; only 2 evidence files modified that existed at checkout |
| S6 | License compliance | Achieved | LICENSE-NOTICES (SUL-1.0 internal-use statement) |
| S7 | All plugins + test/QA evidence | Basically achieved | all capabilities delivered as plugin packages/official plugin entries; 5 QA scripts carry --self-test; plugin source-level bun test still to be added |

## Leftovers (user-side / follow-up)

1. Production profile install: dsh plugin --profile omo add this bundle + bootstrap copies presets to $DSH_HOME/.agent-presets (install script to be added);
2. web GUI preset manual test: select mpd-oracle/librarian/prometheus/hephaestus presets and run each once (DSH UI preset selector);
3. add source-level unit tests inside plugin packages (bun test dir) — finish before line B;
4. keep tracking F9 (config.roots semantic difference under headless); F12 golden design correction.

## Prompt adaptation conclusions

- DeepSeek adapts upstream original personas well: Prometheus (planning discipline), Oracle (evidence-chain review + refusing overreach), task-level tool discipline all empirically verified;
- adaptation log in tests/prompt-adaptation-log.md; future iterations follow rubric failure items (no failures this round).
