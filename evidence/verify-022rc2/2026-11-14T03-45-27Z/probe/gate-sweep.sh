#!/usr/bin/env bash
# T16 gate sweep, sequential, one log per command. Pinned rc.2 harness on PATH, a discoverable
# 0.20.0 dsh-tui host, and the dsh-Go kit. Every exit code is written into its own log's last line.
set -u
cd /home/haroldzhao/MyProj/DshProj/My-Power-Dsh || exit 90
D=evidence/verify-022rc2/2026-11-14T03-45-27Z
L="$D/logs"
mkdir -p "$L"

export PATH="$PWD/.qa-tmp/dsh-022rc2/bin:$PATH"
export MPD_DSHGO_KIT="$PWD/.mpd/tmp-dshgo/kit"
export MPD_DSH_TUI_HOST="$PWD/.qa-tmp/tui-020/lib/node_modules/@deepseek-harness-tui/dsh-tui"

{
  echo "cwd=$PWD"
  echo "dsh=$(command -v dsh)"
  echo "dsh-version=$(dsh --version 2>&1 | head -1)"
  echo "node=$(node --version)"
  echo "bun=$(bun --version)"
  echo "MPD_DSHGO_KIT=$MPD_DSHGO_KIT"
  echo "MPD_DSH_TUI_HOST=$MPD_DSH_TUI_HOST"
  echo "git-head=$(git rev-parse HEAD)"
  echo "git-status-sha=$(git status --porcelain | sha256sum | cut -d' ' -f1)"
} | tee "$L/environment.log"

run() {
  name="$1"; shift
  echo "=== $name : $* ==="
  "$@" > "$L/$name.log" 2>&1
  code=$?
  echo "EXIT=$code" >> "$L/$name.log"
  echo "=== $name EXIT=$code ==="
  return 0
}

run verify-gates bun run verify:gates
run typecheck bun run typecheck
run no-host-override node scripts/verify-no-host-override.ts
run manual-paths node scripts/verify-manual-paths.ts
run preset-conformance-selftest node skills/dsh-qa/scripts/preset-conformance.ts --self-test
run dshgo-standard node scripts/verify-dshgo-standard.ts
run vendor node scripts/verify-vendor.ts
run dist-fresh node scripts/verify-dist-fresh.ts
run install-profile-selftest node scripts/install-profile.ts --self-test
run verify-rows bun run verify:rows

{
  echo "git-status-sha-after=$(git status --porcelain | sha256sum | cut -d' ' -f1)"
} | tee -a "$L/environment.log"
echo SWEEP-DONE
