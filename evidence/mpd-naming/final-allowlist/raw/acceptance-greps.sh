#!/usr/bin/env bash
# t13 ACCEPTANCE-GREP DRIVER — re-runnable at any settled revision.
# Every grep below is the artifact the wave is judged by. The expected result is stated next to each
# command; the driver prints the ACTUAL result at the revision it ran on.
# Usage: bash evidence/mpd-naming/final-allowlist/raw/acceptance-greps.sh
set -u
cd "$(dirname "$0")/../../../.." || exit 1
echo "revision: $(git rev-parse HEAD)"
echo "branch:   $(git branch --show-current)"
echo "dirty:    $(git status --porcelain | wc -l) path(s)"
echo

SHIPPED="git ls-files | grep -v '^evidence/'"
HIST_EXCL="^evidence/|^(docs/(plan-[a-f]|omo-parity-gap|bline-report|review-p0-p3|track-a-report|ulw-deepseek-optimization)\.md|PLAN\.md|tests/golden/out/)"

run() {
  local id="$1"; local expect="$2"; shift 2
  local out; out="$(bash -c "$*" 2>/dev/null)"
  local n; n="$(printf '%s' "$out" | grep -c . || true)"
  echo "### $id  (expected: $expect)"
  echo "\$ $*"
  printf '%s\n' "$out" | sed 's/^/    /'
  echo "    -> lines=$n"
  echo
}

run G1-zero "0 lines" \
  "$SHIPPED | grep -vE '$HIST_EXCL' | xargs grep -nE 'OMO-origin|OMO-derived|OMO specialists|OMO roster|OMO 起源|OMO 名册|OMO 角色|the OMO |upstream omo |\bOmO\b' || true"

run G2-allowlisted "only allowlisted brand tokens (raw list for the allowlist diff)" \
  "git ls-files | grep -v '^evidence/' | xargs grep -lE '(^|[^A-Za-z0-9_])_?omo([^A-Za-z0-9_]|\$)' 2>/dev/null || true"

run G3-foreign-surface-allowlisted "only allowlisted foreign literals" \
  "$SHIPPED | xargs grep -nE 'CODEX_HOME|LSP_TOOLS_MCP|OPENCODE_CONFIG_DIR|OCX_PROFILE|OPENCODE_HOME|SENPI_CODING_AGENT_DIR|multi_agent_v1|subagent_codex' 2>/dev/null || true"

run G4-omo-gone "0 lines" \
  "grep -n '_omo' packages/mpd-mcp-lsp/dist/cli.js || true"

run G5-omocodex-gone "0 lines" \
  "$SHIPPED | xargs grep -n 'OMO_CODEX' 2>/dev/null || true"

run G6-astgrep-identifiers-gone "0 lines" \
  "git ls-files skills/ast-grep | xargs grep -nE 'omo_env_binary|omo_runtime_slug|omo_runtime_binary|omoRoot|omoReal|OMO runtime|OMO caches' 2>/dev/null || true"

run G7-ledger-path-gone "0 lines (outside evidence/**)" \
  "git ls-files | grep -v '^evidence/' | xargs grep -n 'omo-parity-ledger' 2>/dev/null || true"

run G8-omo-bare-word-allowlisted "only allowlisted bare-word sites" \
  "$SHIPPED | xargs grep -nE '(^|[^A-Za-z0-9_])OMO([^A-Za-z0-9_]|\$)' 2>/dev/null || true"

run G9-evidence-untouched "only the new evidence/mpd-naming/** entries" \
  "git status --porcelain evidence/ || true"

run G10-codegraph-keeps-present "MIGRATION_ID + [senpi] migration read PRESENT (never deleted)" \
  "grep -n 'MIGRATION_ID\|\[senpi\]' packages/mpd-mcp-codegraph/dist/serve.js || true"

run G11-lsp-discovery-defaults-present "the .codex discovery defaults PRESENT (never deleted)" \
  "grep -n '\.codex/lsp-client.json\|\.codex/lsp-install-decisions.json' packages/mpd-mcp-lsp/dist/cli.js || true"

run G12-astgrep-scrub-targets "the MPD-worded bytes PRESENT (scrub outcome), 0 OMO" \
  "grep -nE 'an MPD session|MPD runtime|an OMO session|OMO runtime' packages/mpd-mcp-astgrep/dist/cli.js || true"

run G13-preset-bridge-rows-present "2 rows (hard floor F6)" \
  "grep -nE 'id: tool-subagent-(codex|claude-code)' presets/mpd/agent.cordis.yml || true"

run G17-codegraph-foreign-absent "0 lines (must-absent: t5 deleted HARNESS_IDS / [opencode] / [codex] / the \$schema URL)" \
  "grep -nE 'HARNESS_IDS|\[opencode\]|\[codex\]|harness: \"codex\"|MPD_SCHEMA_URL' packages/mpd-mcp-codegraph/dist/serve.js || true"

run G14-journal-lock-rule "LOCK-RECOMPUTE=MATCH" \
  "node evidence/mpd-naming/final-allowlist/raw/recompute-lock.mjs || true"
