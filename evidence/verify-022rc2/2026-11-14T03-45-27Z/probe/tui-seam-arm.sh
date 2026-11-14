#!/usr/bin/env bash
# T16 TUI 0.20.0 seam arm — boots the SHIPPED bundle under dsh-tui 0.20.0 on harness 0.2.2-rc.2,
# inside tmux (a pane is the only honest TTY), with a probe row inserted by a `--patch` overlay.
# The anchor is OUTSIDE the checkout (contract A6); no bundle team package is installed into the
# profile, so the rc.2 host supplies the team plane.
set -uo pipefail
REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/verify-022rc2/2026-11-14T03-45-27Z"
ANCHOR=/home/haroldzhao/.t16-verify/tui-020-arm
RUN="$ANCHOR/run"
OUT="$EVID/tui-seam-020"
if [ "${SKIP_INSTALL:-0}" != "1" ]; then rm -rf "$RUN"; fi
mkdir -p "$RUN/dsh-home" "$RUN/user-home" "$RUN/xdg" "$RUN/workspace" "$OUT"

export DSH_HOME="$RUN/dsh-home"
export HOME="$RUN/user-home"
export XDG_RUNTIME_DIR="$RUN/xdg"
export PATH="$REPO/.qa-tmp/tui-020/bin:/home/haroldzhao/.t16-verify/host-rc2/bin:$PATH"
cd "$RUN/workspace" || exit 90

{
  echo "anchor=$ANCHOR (outside checkout: $(case "$ANCHOR" in "$REPO"*) echo NO;; *) echo YES;; esac))"
  echo "dsh=$(command -v dsh) $(dsh --version 2>&1 | head -1)"
  echo "dsh-tui=$(command -v dsh-tui) $((dsh-tui --version 2>&1 || true) | head -1)"
  echo "dsh-home=$DSH_HOME"
} | tee "$OUT/env.log"

if [ "${SKIP_INSTALL:-0}" = "1" ]; then echo "== installs SKIPPED (warm profile) =="; fi
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
echo "== install the TUI host 0.20.0 into a fresh profile =="
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.20.0 > "$OUT/install-host.log" 2>&1
echo "HOST_INSTALL_EXIT=$?" | tee -a "$OUT/install-host.log"

echo "== install THIS bundle (no team package) =="
dsh plugin --profile dsh-tui add "$REPO" > "$OUT/install-bundle.log" 2>&1
echo "BUNDLE_INSTALL_EXIT=$?" | tee -a "$OUT/install-bundle.log"

echo "== install the probe package =="
dsh plugin --profile dsh-tui add "$REPO/.qa-tmp/t1/probe" > "$OUT/install-probe.log" 2>&1
echo "PROBE_INSTALL_EXIT=$?" | tee -a "$OUT/install-probe.log"

fi
realpath "$DSH_HOME/profiles/dsh-tui" | tee -a "$OUT/env.log"

cat > "$RUN/probe-overlay.yml" <<'YML'
- insert:
    - id: t16-probe
      name: 't1-probe'
YML

if [ "${WITH_CREDS:-0}" = "1" ]; then
  # QA isolation discipline: credentials are copied ONCE into the sandbox (never into evidence).
  cp /home/haroldzhao/.dsh/.credentials.yaml "$DSH_HOME/.credentials.yaml"
  mkdir -p "$HOME/.dsh-tui"
  cp /home/haroldzhao/.dsh-tui/onboarding.json "$HOME/.dsh-tui/onboarding.json" 2>/dev/null || true
  cp /home/haroldzhao/.dsh-tui/migrations.json "$HOME/.dsh-tui/migrations.json" 2>/dev/null || true
  echo "credentials+onboarding copied into the sandbox" | tee -a "$OUT/env.log"
fi
echo "== tmux boot (real TTY) =="
tmux -S "$RUN/tmux.sock" kill-server 2>/dev/null
COMMAND="cd $RUN/workspace && env -i HOME=$RUN/user-home DSH_HOME=$RUN/dsh-home XDG_RUNTIME_DIR=$RUN/xdg TERM=xterm-256color LANG=C.UTF-8 PATH=$PATH MPD_T1_PROBE_OUT=$RUN/probe.json MPD_T1_PROBE_SETTLE_MS=20000 DSH_TUI_NO_LAUNCHPAD=1 dsh-tui --patch $RUN/probe-overlay.yml 2> $OUT/tui-boot.raw.log"
tmux -S "$RUN/tmux.sock" new-session -d -s t16 -x 220 -y 50 "$COMMAND"
echo "TMUX_START=$?"

for _ in $(seq 1 180); do [ -f "$RUN/probe.settled.json" ] && break; sleep 1; done
echo "PROBE_SETTLED=$([ -f "$RUN/probe.settled.json" ] && echo yes || echo no)"

tmux -S "$RUN/tmux.sock" capture-pane -p -J -t t16 > "$OUT/pane.txt" 2>"$OUT/pane.err"
tmux -S "$RUN/tmux.sock" kill-server 2>/dev/null

sed -E 's/token=[^ &"[:space:]]+/token=<masked>/g; s/([?&]token=)[^ &"[:space:]]+/\1<masked>/g' \
  "$OUT/tui-boot.raw.log" > "$OUT/tui-boot.log"
rm -f "$OUT/tui-boot.raw.log"

node - "$RUN/probe.settled.json" "$RUN/probe.json" "$OUT" <<'NODE'
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const [settled, plain, outDir] = process.argv.slice(2)
const file = existsSync(settled) ? settled : plain
const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
const entries = report?.entries ?? []
const watched = ['mpd-agent-team', 'mpd-tool-agent-team', 'mpd-ui-agent-team', 'agent-team', 'tool-agent-team', 'ui-agent-team']
const rows = watched.map((id) => {
  const entry = entries.find((candidate) => candidate.id === id)
  return entry === undefined ? { id, present: false } : { id, present: true, name: entry.name, disabled: entry.disabled, active: entry.active }
})
const capabilities = report?.mpdTuiCapabilities ?? null
const seams = capabilities?.seams ?? {}
const bound = Object.keys(seams).filter((key) => seams[key] === true)
const detail = report?.mpdTuiDetail ?? null
const status = (detail?.seamOutcomes ?? []).find((outcome) => outcome.id === 'tuiStatus') ?? null
const summary = {
  probeFile: file,
  settled: file === settled,
  totalEntries: entries.length,
  boundSeamCount: bound.length,
  boundSeams: bound,
  panelSeamBound: detail?.panelSeamBound ?? null,
  tuiStatusOutcome: status,
  watched: rows,
}
writeFileSync(outDir + '/seam-summary.json', JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
NODE

echo "== boot-log signatures =="
{
  for pat in 'already registered' 'Cannot find package' 'did not activate' 'Error:' 'root.effect' 'sessionProjections' 'ERR_MODULE_NOT_FOUND'; do
    printf '%-26s %s\n' "$pat" "$(grep -c -- "$pat" "$OUT/tui-boot.log" 2>/dev/null || true)"
  done
  echo "paneBytes=$(wc -c < "$OUT/pane.txt" 2>/dev/null || echo 0)"
} | tee "$OUT/signatures.txt"
echo "TUI-ARM-DONE"
