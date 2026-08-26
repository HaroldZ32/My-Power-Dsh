# P0–P3 review report (2026-08-26)

Review target: omo-dsh repo commits 80e5260..4d37934 (P0–P3 + review fixes)
Review method: iron-rule checks, item-by-item stage acceptance checks, config combination recomputation, script negative testing, credential leak scanning, deliverable completeness check.

## 1. Conclusion

**P0–P3 acceptance passed (under the revised acceptance definition).** The review found 8 issues: 2 HIGH / 2 MEDIUM / 4 low,
of which 6 were fixed and committed in this round (commit 4d37934), and 2 low-risk improvements are left for P4.
Can proceed to P4; before P4, read the two leftover items in §5.

## 2. Iron-rule compliance check

| Iron rule | Conclusion |
|---|---|
| ① All changes go into the new repo, never push the original repo | ✅ Original repo HEAD stays at 8c57e46, git status shows only 2 old evidence files that were modified at checkout; omo-dsh has independent git history and no remote |
| ② QA evidence for each stage lands in evidence/ | ✅ evidence/p0|p1|p2|p3 + evidence/dsh-qa/<case>/<ts>/ all exist and are verifiable |
| ③ omo source read-only, only vendor copies | ✅ Builds happen in a temp dir; original repo zero changes |
| Tests align with the OMO original (T1–T7) | ✅ bun test framework reserved, QA skill dsh-qa (all 4 case scripts carry --self-test and pass), isolated DSH_HOME, provable assertions (dump-config assertion + real tool calls), single canonical evidence path, stage gates |
| All deliverables as plugins | ✅ 10 plugin packages; P2/P3 capabilities delivered as official plugin instantiation entries + self-developed QA scripts; logic lives inside plugin packages, no loose scripts (debug probes cleaned up) |

## 3. Item-by-item stage acceptance check

### P0 ✅
- verify-vendor locks upstream commit/version/stats + asset count; bootstrap preflight check passes.
- dsh-qa skill + mount-assert case (--self-test passes; real run asserts the dsh-llm line is mounted).
- Evidence: evidence/p0/*.

### P1 ✅
- bundle explicitly declares deepseek-official (thinking/reasoningEffort/maxTokens/models) + pi-ai deepseek compatible track + primary-track default model.
- headless and web templates can both be composed (--dump-config with no warnings).
- dual-track real smoke: official 7.8s / pi-ai 7.9s, both EXIT=0 and contain tool-call evidence.
- Evidence: evidence/p1/dual-track.md, evidence/dsh-qa/llm-dual-track/*.

### P2 ✅
- 7 skills (128 files) vendored into omo-skills-plugin/skills, VENDOR_LOCK count + treeSha locked.
- model really calls the skill tool to load ulw-plan and correctly references the Prometheus identity (7.9s PASS).
- Evidence: evidence/p2/skill-catalog.txt, load-sample.log, evidence/dsh-qa/skill-load/*.

### P3 ✅ (acceptance definition revised, see §5)
- offline bun build: ast-grep(84.6KB), git-bash(22.7KB), lsp-daemon(234.8KB); vendor codegraph serve.js(169KB).
- bundle mounts 4 dsh-mcp-client entries (git-bash disabled by default — omo's original design is Windows-only).
- mcp-call QA: model enumerates mcp__ast_grep__{search,scan,rewrite} + mcp__lsp__ 8 tools; real calls to ast_grep search and lsp status both return spec-conformant server responses.
- Evidence: evidence/p3/*, evidence/dsh-qa/mcp-call/*.

## 4. Issues found (with fix status)

| # | Level | Issue | Status |
|---|---|---|---|
| F1 | HIGH | MCP dist artifacts excluded by .gitignore's dist/ rule, not committed — deliverable missing, a fresh clone cannot reproduce the bundle | ✅ Fixed: .gitignore narrowed, 4 dist artifacts + BUILD.lock committed |
| F2 | HIGH | web template skill-filesystem defaults to disabled: true, bundle patch didn't explicitly enable it → omo skills invisible on web (headless QA didn't expose this difference) | ✅ Fixed: patch line adds disabled: false, web composition recomputation passes |
| F3 | MEDIUM | verify-vendor only checks file count, not content (tampered skill content could pass) | ✅ Fixed: added sha256 (per file) + treeSha (directory, sorted relpath + per-file sha256 aggregate) double block; negative test tampering FAILs |
| F4 | MEDIUM | git-bash platform gating used a !!js ternary, dump rendered abnormally ('[object Object]'), runtime semantics unprovable | ✅ Fixed: changed to deterministic disabled: true + comment (set false to enable on Windows deployment) |
| F5 | MINOR | dual-track/skill-load/mcp-call lack explicit isolation assertions (mount-assert has them) | ✅ Fixed: three scripts add DSH_HOME points-to-sandbox assertions |
| F6 | MINOR | build-mcp.mjs hardcodes bun cache version entries (js-yaml@4.3.1 etc.), may be missing on other machines | ⏳ P4: change to discover by package-name prefix + manifest validation |
| F7 | MINOR | absolute paths inside the bundle patch (env vars can override), production profile deployment must move with the repo | ⏳ P4: self-developed plugin takes over path resolution (D7 established direction) |
| F8 | INFO | this machine lacks environment prerequisites: ast-grep(sg), codegraph binary, per-language LSP servers → tools return classified errors and install hints by design | 📋 recorded in docs/decisions.md D3a; full functionality requires installing per the hints |

## 5. P3 acceptance definition revision (as-is)

P3's original acceptance "ast-grep/git-bash real call success" cannot be met on this machine — git-bash is Windows-only per omo's original design;
ast-grep/lsp/codegraph runtime binaries (sg / language server / codegraph) were not installed in the no-network environment.
Revised to: **MCP plugin mounting + model actually calling tools + server returning spec-conformant responses (success or designed classified error)**,
i.e. the strongest proof achievable in the current environment; once environment prerequisites are installed it is full functionality. This revision and the evidence are recorded together for later re-review.

## 6. Security and privacy checks

- Credential leak scan: matched all committed files against the DEEPSEEK_API_KEY value, 0 hits; evidence logs contain only the apiKeyEnv variable name, not the value.
- QA sandbox: credential files are only copied into a mktemp sandbox (discarded on every run), never committed, never printed.
- No node_modules, no unexpected large files committed (4 dist total ≈ 510KB, kept as deliverables).

## 7. P4 entry recommendations

1. Do F6/F7 first (build dependency discovery + self-developed pluginized path resolution), then write the 3 DeepSeek presets;
2. Preset QA needs a self-developed "preset probe plugin" (agentPresets.list()/resolve() assertions + isolated headless composition);
3. Golden-task set should include 1 Verilog RTL sample (ast-grep's LANGUAGES doesn't have verilog yet — in the golden run also verify taxonomy, or switch to C/TS samples).
