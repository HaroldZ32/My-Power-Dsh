#!/usr/bin/env bash
# Lane Q-run driver (wave tui-015-adaptation, task T8): the EIGHT registered TUI lanes against the
# installed 0.15.0 host inside the provisioned sandbox root. Sequential on purpose — every TUI lane
# shares the sandbox DSH_HOME/profile and the sandbox HOME's `.dsh-tui` settings document, so two
# concurrent boots would judge different pre-states.
#
# Invocation recipe (evidence/tui/dsh-tui-015/prep/2026-10-14T06-48-13.000Z/):
#   XDG_RUNTIME_DIR inside the sandbox, the npm mirror registry, and the sandbox profile's OWN
#   0.15.0 launcher prepended to PATH (the global `dsh-tui` on PATH stays 0.14.0 and is never touched).
#
# Each lane writes its own evidence dir (where its header says); this driver records the exact
# command, the merged stdout/stderr and the exit code here, and copies the lane's fresh evidence
# dir in beside them.
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
SANDBOX="$REPO/.mpd/recon/qa/tui-lanes/tui-015"
OUT="$REPO/evidence/tui/dsh-tui-015/q-run"
mkdir -p "$OUT"
export XDG_RUNTIME_DIR="$SANDBOX/run"
export pnpm_config_registry="https://registry.npmmirror.com"
export PATH="$SANDBOX/dshhome/profiles/dsh-tui/node_modules/.bin:$PATH"
cd "$REPO" || exit 3

# lane -> its evidence root (relative to the repo)
evidence_root_for() {
  case "$1" in
    tui-team-surface) echo "evidence/tui/team-surface-verify" ;;
    tui-settings-bridge) echo "evidence/mpd-bridge/tui-settings-bridge" ;;
    *) echo "evidence/tui/lanes" ;;
  esac
}

newest_dir() {
  ls -dt "$REPO"/"$1"/*/ 2>/dev/null | head -1
}

LANES="tui-mount tui-deps-ctrla tui-panels tui-team-surface tui-settings-bridge tui-admission tui-distribution tui-spec-conformance"
: > "$OUT/commands.txt"
for lane in $LANES; do
  if [ "$lane" = "tui-settings-bridge" ]; then
    # This lane judges the BUILT dist bytes and takes no sandbox root (its header documents why).
    cmd="bun skills/dsh-qa/scripts/$lane.ts"
  else
    cmd="bun skills/dsh-qa/scripts/$lane.ts --sandbox-root .mpd/recon/qa/tui-lanes/tui-015"
  fi
  root="$(evidence_root_for "$lane")"
  before="$(newest_dir "$root")"
  printf '%s\n' "cd $REPO && $cmd" >> "$OUT/commands.txt"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # shellcheck disable=SC2086
  bash -c "$cmd" > "$OUT/$lane.log" 2>&1
  code=$?
  printf '%s\n' "$code" > "$OUT/$lane.exit"
  after="$(newest_dir "$root")"
  if [ -n "$after" ] && [ "$after" != "$before" ]; then
    rm -rf "$OUT/$lane.evidence"
    cp -r "$after" "$OUT/$lane.evidence"
  fi
  printf '%s exit=%s lane=%s evidence=%s\n' "$started" "$code" "$lane" "${after:-none}"
done
