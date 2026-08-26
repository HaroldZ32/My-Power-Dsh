# Prompt Adaptation Log (omo -> DeepSeek)

| Iteration | Target | Change | Basis |
|---|---|---|---|
| P4-1 | omo-oracle | Extracted identity/expertise/decision framework/output spec from ORACLE_DEFAULT_PROMPT; XML->Markdown; removed Claude-specific phrasing; added deepseek_notes (internalize thinking, no chain-of-thought exposure, compact structure) | Aligned with the OMO original + DeepSeek thinking adaptation |
| P4-1 | omo-librarian | Extracted identity + evidence discipline + date awareness from the LIBRARIAN prompt; mapped the tools section to the existing DSH surface (mcp__ast_grep__*, mcp__lsp__*, web search, bash); kept the PHASE 0 classification (abbreviated version) and "conclusion-first + evidence citations + uncertainty annotation" | Aligned with the OMO original + the DSH tool surface |
| P4-1 | omo-prometheus | Ported prometheus/default.md essentially unchanged (its dependency, the ulw-plan skill, is already in the bundle) | The OMO original is already model-agnostic |
| P4-1 | omo-hephaestus | Wrote a DeepSeek-native "configuration manager" persona based on the Hephaestus agent's responsibilities (read-only + diff + risk notes + DSH terminology) | Minimal definition |
| P4-1 | All | Added: runs on DeepSeek; plans/output must be "decision-complete/compact"; no chain-of-thought exposure | persona smoke test (Prometheus self-identification) PASS |

TODO (after the P5 golden pass): iterate <=3 rounds on rubric failures and append records to this table.
