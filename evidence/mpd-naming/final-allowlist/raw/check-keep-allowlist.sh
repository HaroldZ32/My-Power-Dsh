#!/usr/bin/env bash
# t13 KEEP-ALLOWLIST VERIFIER — one grep per keep_allowlist entry (rule.json).
# Proves the freeze is EVIDENCE-BASED: every kept literal exists at the cited site at the settled
# revision, and every "MUST-PRESENT" keep is present (so a later deletion pass cannot quietly drop it).
# Usage: bash evidence/mpd-naming/final-allowlist/raw/check-keep-allowlist.sh
set -u
cd "$(dirname "$0")/../../../.." || exit 1
echo "revision: $(git rev-parse HEAD)"
echo

check() { # id, expected-count-or-PRESENT/ABSENT, command
  local id="$1" want="$2"; shift 2
  local out; out="$(bash -c "$*" 2>/dev/null)"
  local n; n="$(printf '%s' "$out" | grep -c . || true)"
  local verdict="?"
  case "$want" in
    PRESENT) [ "$n" -gt 0 ] && verdict=OK || verdict=FAIL ;;
    ABSENT)  [ "$n" -eq 0 ] && verdict=OK || verdict=FAIL ;;
    *)       [ "$n" -eq "$want" ] && verdict=OK || verdict=FAIL ;;
  esac
  echo "[$id] want=$want got=$n $verdict"
  printf '%s\n' "$out" | sed 's/^/     /'
}

# --- provenance ---------------------------------------------------------------
check KP-01 PRESENT "grep -n 'oh-my-openagent' VENDOR_LOCK.json; grep -n 'oh-my-opencode Software' LICENSE.md"
check KP-02 PRESENT "grep -n '@oh-my-opencode' scripts/build-mcp.mjs"
check KP-03 PRESENT "grep -n 'omo-opencode/src/cli/install-ast-grep-sg.ts' skills/ast-grep/AGENTS.md; ls .mpd-dsh/upstream/packages/omo-opencode/src/cli/install-ast-grep-sg.ts"
check KP-04 PRESENT "grep -n 'oh-my-opencode' skills/ast-grep/README.md"
check KP-06-AFTER-T5 ABSENT "grep -nE 'MPD_SCHEMA_URL|schema.json|HARNESS_IDS|\[opencode\]|\[codex\]|harness: \"codex\"' packages/mpd-mcp-codegraph/dist/serve.js"

# --- functional ---------------------------------------------------------------
check KF-01 PRESENT "grep -c 'OMO_DAEMON_PROTOCOL_VERSION\|OMO_AST_GREP_SG_PATH\|omo-git-bash-run-\|OMO_PROVISION_HINT' scripts/build-mcp.mjs"
check KF-02 PRESENT "grep -n 'BRAND_TOKEN_RE' scripts/build-mcp.mjs"
check KF-03 PRESENT "grep -n 'MIGRATION_ID\|\[senpi\]' packages/mpd-mcp-codegraph/dist/serve.js"
check KF-04 PRESENT "grep -n '.codex/lsp-client.json\|.opencode' packages/mpd-mcp-lsp/dist/cli.js"
check KF-05 PRESENT "grep -n 'LSP_TOOLS_MCP_' packages/mpd-mcp-lsp/dist/cli.js"
check KF-06 PRESENT "grep -n 'CODEX_HOME' packages/mpd-mcp-astgrep/dist/cli.js skills/ast-grep/scripts/ast_grep_helper.py"
check KF-07 PRESENT "grep -n 'opencode-go' AGENTS.md skills/dsh-qa/scripts/mcp-call.mjs"
check KF-08 2 "grep -nE 'id: tool-subagent-(codex|claude-code)' presets/mpd/agent.cordis.yml"
check KF-09 PRESENT "grep -n 'senpi' packages/mpd-boulder-plugin/src/vendor/storage/shared.ts packages/mpd-boulder-plugin/test/boulder.test.ts"

# --- historical ---------------------------------------------------------------
check KH-01 PRESENT "grep -rn 'evidence/omo-align\|omo-parity-rate/raw' packages/mpd-team-compact-plugin/src/index.ts skills/dsh-qa/scripts/session-start-team.mjs"
check KH-02 PRESENT "grep -n 'omo-parity-align' docs/index.md"
check KH-03 PRESENT "git ls-files docs/omo-parity-gap.md docs/plan-e.md docs/plan-f.md PLAN.md"
check KH-04 PRESENT "grep -n 'omo-opencode/src/agents/\|omo_agent\|omo/plans' docs/omo-parity-gap.md"

# --- not-a-brand-token --------------------------------------------------------
check KN-01 PRESENT "grep -n 'OMOB_TEST_TOKEN' skills/ultimate-browsing/engine/tests/test_surrogate.py"
check KN-02 PRESENT "grep -n 'Autonomous deep worker' packages/mpd-bundle/cordis.patch.yml"
check KN-03 PRESENT "grep -n 'platformFrmpdOptions' scripts/build-mcp.mjs"
