# Per-package README TUI-coverage audit (t57)

Every package under `packages/` gets a verdict here — including the NOs, because ending that silence
is what this task exists for. Measurements: `measure.json` (same directory). Pairs verified: 23/23
exist, 23/23 carry the switch link under the title, 23/23 have identical heading-level sequences
across the two languages (`measure.mjs`, re-runnable).

**Method note (measurement honesty).** The pre-edit digests were **not captured before editing**;
`before` is therefore *reconstructed* by removing the documented insertion from the current file
(deterministic for these pure insertions, and re-runnable from `measure.mjs`). Every edited file
reports bytes+sha256 before/after, and the reconstructed value is labelled as such. No file other
than the declared paths changed.

## Verdict table

| Package | README pair | TUI-applicable | Evidence for the verdict | Action taken |
|---|---|---|---|---|
| `mpd-tui-plugin` | ✅ | **YES** | `src/index.ts` (the row's surfaces), `src/settings.ts` (`SETTINGS_KNOBS` mapped from `packages/mpd-config-plugin/src/settings-schema`), `dist/index.js` (built artifact the row loads) | **Verified against src + dist, no change needed**: the README already documents the row/specifier, the seven surfaces, the bridged `/settings` section and its restart semantics, zero filesystem writes, and the four-kind contract |
| `mpd-bundle` | ✅ | **YES** | `packages/mpd-bundle/cordis.patch.yml:300-301` (the `mpd-tui` row → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`) and `:93` (`dsh-tui-agent-presets`, the TUI-plane roster default) | Added `## TUI composition` / `## TUI 组合` (504 B / 456 B) |
| `mpd-bundle-plugin` | ✅ | **YES** | `src/settings-card.js:1` ("the browser half of the `mpd` settings namespace"), registered at `src/web-client.js:694`, pinned by `test/settings-card.test.mjs` (asserts the two front doors' knob lists stay identical) | Added a "TUI counterpart" paragraph (733 B / 677 B) |
| `mpd-dsh-adapter-plugin` | ✅ | **YES** | `packages/mpd-tui-plugin/src/index.ts:47` imports `createDshAdapter` from this package; `src/host.ts:58` reads the mounted `mpdDsh` for the workspace-root union | Added one sentence to "Why it exists" / "为什么存在" (206 B / 194 B) |
| `mpd-config-plugin` | ✅ | **YES** | `src/index.ts:544` `applies: "restart"` on the `mpd` namespace registration, the write-back on `settings/document-updated` (`:268`, `:276`, `:327`), the per-call file reads; `docs/tui.md` §6.5 states the duplicate-key rule | **Existing TUI text verified still accurate** (one namespace, `applies:"restart"`, live re-read, the never-lost clause); added the `docs/tui.md` §6.5 pointer (63 B / 56 B) |
| `mpd-bootstrap-plugin` | ✅ | NO | `src/index.ts` serves `<bundle>/skills` and the preset roster by reference; no TUI seam and no client-specific behaviour | none (silence is correct) |
| `mpd-boulder-plugin` | ✅ | NO | model-facing `mpd_boulder_*` tools + a work ledger row; no TUI service. The TUI board *renders* that ledger, but that is `packages/mpd-tui-plugin`'s contribution, not this package's | none |
| `mpd-codegraph-plugin` | ✅ | NO | binary resolve + project init at apply time; client-agnostic | none |
| `mpd-comment-checker-plugin` | ✅ | NO | `mpd_comment_check` tool; profile-agnostic | none |
| `mpd-ext-plugin` | ✅ | NO | extension registry + stdio MCP bridge; its tools appear in any client identically | none |
| `mpd-hashline-plugin` | ✅ | NO | anchored-edit tools; profile-agnostic | none |
| `mpd-mcp-astgrep` | ✅ | NO | stdio MCP server; the TUI shows its tools like any other client | none |
| `mpd-mcp-codegraph` | ✅ | NO | stdio MCP server; profile-agnostic (and excluded by the CodeGraph policy in a `.mpd` path) | none |
| `mpd-mcp-gitbash` | ✅ | NO | row is `disabled: true` under every profile, TUI included | none |
| `mpd-mcp-lsp` | ✅ | NO | stdio MCP server; profile-agnostic | none |
| `mpd-memory-plugin` | ✅ | NO | memory tools + reflection state; no TUI seam | none |
| `mpd-modelchain-plugin` | ✅ | NO | `mpd_modelchain_resolve` + workspace memory tools; profile-agnostic | none |
| `mpd-qa-roles-probe` | ✅ | NO | QA-only probe mounted by an overlay; no row in any profile, TUI included | none |
| `mpd-roles-plugin` | ✅ | NO | roster resolution per call; the team member list is static patch config, not a TUI surface | none |
| `mpd-team-compact-plugin` | ✅ | NO | `mpd_team_compact_*` tools; profile-agnostic | none |
| `mpd-tools-plugin` | ✅ | NO | write guard / truncation / waterfall; owns no tool name and no TUI seam | none |
| `mpd-ulw-plugin` | ✅ | NO | `mpd_ulw` / `mpd_ultrawork` tools; profile-agnostic | none |
| `mpd-workmate-plugin` | ✅ | NO | workmate tools + HTTP routes; the TUI picker that reads them belongs to `packages/mpd-tui-plugin` | none |

## Excluded packages (not audit rows)

| Package | Why |
|---|---|
| `mpd-agent-teams-plugin` | adopted upstream main code; its `README.md` is kept verbatim as provenance (the bilingual rule exempts it) |
| `mpd-mcp-shared` | ships no README at all (documented exception in `docs/index.md`); it is a helper module with no row of its own |
| `mpd-team-watchdog-plugin` | owned by a live task; the directory (and its README) does not exist yet |

## Gates (raw output in this directory)

| Gate | Command | Result |
|---|---|---|
| Spec-conformance self-test | `bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --self-test` | exit 0 — `ok: matrix mapping two-sided, identity table reproduces on 8 files` (`spec-conformance-selftest.log`) |
| Repo doc-pair gate | located via `grep -rln 'zh-CN' scripts/ skills/dsh-qa/ packages/*/test/` → `scripts/pack-mpd.mjs` (copies each shipped package's README pair) | `node scripts/pack-mpd.mjs` exit 0 — `modes normalized: 1125 files`, `staged package -> dist/mpd-package` (`pack-mpd.log`); the pack refreshes the gitignored `dist/mpd-package/**` copy, which now carries the current READMEs |
| Pair parity per edited package | `grep -n '^#' <pkg>/README.md <pkg>/README.zh-CN.md`, compared in `measure.mjs` | 23/23 pairs: same heading-level sequence, switch link present in both files |
