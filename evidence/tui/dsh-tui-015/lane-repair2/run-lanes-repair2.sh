#!/usr/bin/env bash
# lane-repair2 re-run of the 8 registered TUI lanes after the skills-writer edits E1a/E1b/E2/E3
# (wave tui-015-adaptation).
#
# It is `q-run/run-lanes-step3-final.sh` with the SAME env, SAME lane order, SAME sandbox root and SAME
# per-lane command — the OUT root moved to `lane-repair2/step3/` so the step3-final artifacts stay
# byte-intact for comparison (T-74/T-53: a foreign window is pinned, never overwritten). The two
# declared deviations of the source driver are preserved: (1) OUT is not `q-run/`; (2)
# `tui-settings-bridge` is passed `--out <step3>/…` because its default evidence root
# (`evidence/mpd-bridge/tui-settings-bridge/<ts>/`) is outside this task's declared write scope.
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
SANDBOX="$REPO/.mpd/recon/qa/tui-lanes/tui-015"
OUT="$REPO/evidence/tui/dsh-tui-015/lane-repair2/step3"
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
    # Declared deviation 2: --out keeps this lane's evidence inside evidence/tui/**.
    cmd="bun skills/dsh-qa/scripts/$lane.ts --out evidence/tui/dsh-tui-015/lane-repair2/step3/settings-bridge.evidence.$(date -u +%Y%m%dT%H%M%SZ)"
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
