# Decision ledger (P1–P3 finalized)

| Decision point | Conclusion | Basis |
|---|---|---|
| D1 profile form | Temporarily use "isolated headless + --patch overlay" to complete QA; the production profile template is deferred until P4/P5 when real sessions are needed | P1–P3 equivalence verification is sufficient; the real web profile waits for the user to decide when to merge it in |
| D2 lsp build strategy | **No delay**: lsp-daemon can be built offline with bun build (workspace source only, no external npm dependencies), already delivered | lsp-tools-mcp/lsp-daemon dependency audit |
| D3 first batch of agents | oracle + librarian + prometheus + hephaestus (minimal version) | Follow the plan |
| D4 dual-track primary | deepseek-official as primary track; pi-ai deepseek as compatible track; both tracks pass real smoke tests (7.8s / 7.9s) | evidence/p1/dual-track.md |
| D5 skill list | 7 skills vendored (ulw-plan/init-deep/lsp-setup/git-master/review-work/programming/ast-grep) | P2 |
| D6 tool-presentation | Pending decision at the P4 preset layer | — |
| D7 plugin boundary | Landed: pure assembly = official plugin instantiation (including !!js path resolution); with logic = self-developed cordis plugin (from P4: presets/hephaestus) | P2/P3 |
| D3a (new) runtime prerequisites | ast-grep server requires the sg binary (when missing returns BINARY_NOT_FOUND classified error + install hint); codegraph requires the codegraph binary (when missing returns skip hint); lsp requires a language server (returns daemon-missing hint); git-bash is Windows-only per omo's original design (bundle line gated by platform) | evidence/p3/*-call.log |

## Platform and prerequisite notes (updated 2026-08-26: this machine has network)

- Local toolchain installed (.toolchain/, npm network install, @ast-grep/cli 0.45.2 + @colbymchenry/codegraph 1.5.0):
  - ast-grep: real call PASSed (evidence/dsh-qa/mcp-call/<ts>/call.log: ok=true, 1 match, 4ms);
  - codegraph: OMA_CODEGRAPH_BIN injected, but project policy still returns skip hint (must be initialized inside the project per omo conventions, recorded as a follow-up item);
  - per-language LSP servers: still runtime prerequisites (status is now reachable).
- Global npm fails because the sandbox cache is read-only, so the toolchain is placed inside the repo (.toolchain/ is already gitignored).
- git_bash MCP is Windows-only in omo (run only works on native Windows); this bundle gates it with
  disabled: !!js process.platform === 'win32' ? false : true.

## P5 batch-run findings (F10/F11, fixed)

- F10: provision crashes when codegraph is missing (~/.omo read-only) → bundle defaults to disabled: true; see comments for enable steps.
- F11: golden-test direct run didn't inject the sg path → the mcp-astgrep line's env injects OMO_AST_GREP_SG_PATH (toolchain fallback).

## P4 supplementary decisions (preset delivery path)

- **F9 (research item)**: at headless runtime the agent-presets line's config.roots didn't take effect (ROOTS contains only shipped+user roots; proved by probe),
  inconsistent with the combined dump result — suspected boot-side patch/config semantic difference. **Workaround**: preset delivery goes through DSH's officially supported user root
  '$DSH_HOME/.agent-presets' (auto-scanned; copy() is this path).
- **P4 delivery path**: the 4 presets ship with omo-presets-plugin/presets/; the bootstrap/install step copies them to '$DSH_HOME/.agent-presets/'
  (user root trust=user); QA verifies in a sandbox .agent-presets (preset-register PASS).
- **Preset content**: oracle/librarian/prometheus/hephaestus personas are extracted from the OMO original prompts and adapted for DeepSeek
  (removing Claude-specific wording, mapping tool names to DSH's mcp__ast_grep__*/mcp__lsp__*/web etc.), recorded in tests/prompt-adaptation-log.md;
  persona smoke PASS (Prometheus self-identifies correctly).

## CodeGraph regression (F10 closed → plan finalized)

- **Root cause**: ① serve.js auto-provisions into ~/.omo when the binary is missing (read-only HOME crash); ② the OMO exclusion policy excludes
  projects whose path contains a `.omo` segment or /tmp (**our repo temporarily lives under .omo/port/, so it is naturally excluded**).
- **Plan (verified)**:
  1. Self-developed `omo-codegraph-plugin` (package name @omo-dsh/omo-codegraph-plugin): config.binary/env resolution (supporting
     OMO_CODEGRAPH_BIN + toolchain fallback) -> exact-marker probe -> atomic lock + 15min cooldown + 60s tree timeout
     `codegraph init`; registers the `omo-codegraph` command for manual rerun; any failure only logs and never crashes boot;
  2. Re-enable the bundle's mcp-codegraph line, env injects OMO_CODEGRAPH_BIN (toolchain fallback);
  3. QA temporary project placed at the workspace root level (not .omo, not /tmp) to verify the full chain: init status=ok -> marker ->
     `mcp__codegraph__codegraph_explore` really returns byte-for-byte source (evidence/dsh-qa/codegraph/).
- **User machine note**: production project paths must not contain a `.omo` segment or be under /tmp; clone from Gitee to a normal path (e.g. ~/dshProj/omo-dsh).
