#!/usr/bin/env bash
# t6 boot check (acceptance 1): install the bundle into an ISOLATED DSH_HOME with a sandbox HOME,
# then boot it with --dump-config and assert the mpd rows are composed. The real ~/.dsh and the
# real HOME are never touched. Output lands in this evidence directory.
set -u
cd "$(dirname "$0")/../../../.."
REPO="$(pwd)"
EV="evidence/workmate/rename-delete-verify/attempt2-2026-09-10T13-59-50.000Z"
LOG="$EV/boot-check.log"
SB_DSH=$(mktemp -d /tmp/mpd-t6-dsh-XXXXXX)
SB_HOME=$(mktemp -d /tmp/mpd-t6-home-XXXXXX)
{
  echo "=== t6 isolated-DSH_HOME boot check ==="
  echo "repo=$REPO"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "real HOME (must NOT be written)=$HOME"
  echo "HEAD=$(git rev-parse HEAD)"
  echo
  echo "=== install-profile (mpd-headless, isolated) ==="
} > "$LOG"
node scripts/install-profile.mjs --yes --dsh-home "$SB_DSH" --profile mpd-headless --skip-toolchain >> "$LOG" 2>&1
echo "install exit=$?" >> "$LOG"
[ -f "$HOME/.dsh/.credentials.yaml" ] && cp "$HOME/.dsh/.credentials.yaml" "$SB_DSH/.credentials.yaml"
[ -f "$HOME/.dsh/settings.yaml" ] && cp "$HOME/.dsh/settings.yaml" "$SB_DSH/settings.yaml"
{
  echo
  echo "=== dsh --profile mpd-headless --dump-config (isolated DSH_HOME) ==="
} >> "$LOG"
HOME="$SB_HOME" DSH_HOME="$SB_DSH" timeout 300 dsh --profile mpd-headless --dump-config >> "$LOG" 2>&1
echo "dump exit=$?" >> "$LOG"
cp "$LOG" "$EV/dump-config.txt" 2>/dev/null || true
grep -q "id: mpd-roles" "$LOG" && echo "ROLES_ROW=present" >> "$LOG" || echo "ROLES_ROW=MISSING" >> "$LOG"
grep -q "id: mpd-workmate" "$LOG" && echo "WORKMATE_ROW=present" >> "$LOG" || echo "WORKMATE_ROW=MISSING" >> "$LOG"
grep -q "id: mpd-hashline" "$LOG" && echo "HASHLINE_ROW=present" >> "$LOG" || echo "HASHLINE_ROW=MISSING" >> "$LOG"
echo "SANDBOX_DSH_HOME=$SB_DSH" >> "$LOG"
echo "SANDBOX_HOME=$SB_HOME" >> "$LOG"
echo "=== done ===" >> "$LOG"
cat "$LOG" | tail -6
