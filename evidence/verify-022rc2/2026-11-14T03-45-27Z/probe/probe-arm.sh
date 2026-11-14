#!/usr/bin/env bash
# T16 probe arm — boots an ALREADY-INSTALLED profile with a probe row inserted through a `--patch`
# overlay, so the measurement is the loader's own entry table (id / name / disabled / active), not a
# composition dump. Reuses the run dir the mount arm created (install already done).
#
#   bash probe-arm.sh <rc1-work|rc2-work|rc1-head> <port>
set -uo pipefail
ARM="${1:?usage: probe-arm.sh <rc1-work|rc2-work|rc1-head> <port>}"
PORT="${2:?}"
REPO=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh
EVID="$REPO/evidence/verify-022rc2/2026-11-14T03-45-27Z"
RUN="/home/haroldzhao/.t16-verify/runs/$ARM"
OUT="$EVID/mount-$ARM"
GEN="${ARM%%-*}"
HARNESS="/home/haroldzhao/.t16-verify/host-$GEN"

[ -d "$RUN/dsh-home/profiles/t16" ] || { echo "no installed profile at $RUN" >&2; exit 2; }
export DSH_HOME="$RUN/dsh-home"
export HOME="$RUN/user-home"
export XDG_RUNTIME_DIR="$RUN/xdg"
export PATH="$HARNESS/bin:$PATH"
cd "$RUN/workspace" || exit 90

echo "== install the probe package into the existing profile =="
dsh plugin --profile t16 add "$REPO/.qa-tmp/t1/probe" > "$OUT/probe-install.log" 2>&1
echo "PROBE_INSTALL_EXIT=$?" | tee -a "$OUT/probe-install.log"

cat > "$RUN/probe-overlay.yml" <<'YML'
- insert:
    - id: t16-probe
      name: 't1-probe'
YML

echo "== probe boot (20s) =="
MPD_T1_PROBE_OUT="$RUN/probe.json" MPD_T1_PROBE_SETTLE_MS=8000 \
  timeout --signal=TERM 20 dsh --profile t16 --patch "$RUN/probe-overlay.yml" --port "$PORT" --no-open \
  > "$OUT/probe-boot.raw.log" 2>&1
echo "PROBE_BOOT_EXIT=$?"

sed -E 's/token=[^ &"[:space:]]+/token=<masked>/g; s/([?&]token=)[^ &"[:space:]]+/\1<masked>/g' \
  "$OUT/probe-boot.raw.log" > "$OUT/probe-boot.log"
rm -f "$OUT/probe-boot.raw.log"

node - "$RUN/probe.settled.json" "$RUN/probe.json" "$OUT" <<'NODE'
const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const [settled, plain, outDir] = process.argv.slice(2)
const file = existsSync(settled) ? settled : plain
if (!existsSync(file)) { console.error('NO PROBE OUTPUT'); process.exit(3) }
const report = JSON.parse(readFileSync(file, 'utf8'))
const WATCH = ['mpd-agent-team', 'mpd-tool-agent-team', 'mpd-ui-agent-team', 'agent-team', 'tool-agent-team', 'ui-agent-team', 'preset-mpd', 't16-probe', 'tool-office']
const summary = WATCH.map((id) => {
  const entry = report.entries.find((candidate) => candidate.id === id)
  return entry === undefined
    ? { id, present: false }
    : { id, present: true, name: entry.name, disabled: entry.disabled, active: entry.active }
})
const activeIds = report.entries.filter((entry) => entry.active === true).map((entry) => entry.id).sort()
const out = { reportFile: file, settled: file === settled, totalEntries: report.entries.length, watched: summary, activeCount: activeIds.length }
writeFileSync(outDir + '/probe-summary.json', JSON.stringify({ ...out, activeIds, guardLog: null }, null, 2) + '\n')
for (const row of summary) console.log(JSON.stringify(row))
console.log('TOTAL=' + report.entries.length + ' ACTIVE=' + activeIds.length)
NODE
echo "PROBE-ARM-DONE $ARM"
