#!/usr/bin/env bash
# t3 mounted-session evidence (B3 + captain-authorized compile.ts extension).
# Boots the SHIPPED checkout plugin in an isolated DSH_HOME and calls the real
# tools through the host boundary. This is the only proof that the harness's
# lossless-JSON output check (dsh-tools snapshotToolValue) accepts the result:
# --dump-config cannot execute plugin code, and function-level tests never cross
# the host boundary (which is exactly how this defect stayed latent).
#
# NOTE (infrastructure gap found while building this evidence):
# scripts/install-profile.mjs (legacy dev/QA installer) builds a HARDCODED row
# list that omits the `mpd-verif` row, so a legacy-installed profile never
# mounts the eight mpd_verif_* tools. The bundle patch (packages/mpd-bundle/
# cordis.patch.yml) DOES carry the row. This script therefore adds the bundle's
# own row through a QA `--patch` overlay; the product path (dsh plugin add .)
# needs no overlay.
#
# Usage: bash mounted-calls.sh <evidence-dir>
# Environment precondition on this machine: iverilog + verilator present under
# /opt/osscad/oss-cad-suite, vcs absent — so `backend:"vcs"` is the falsifier.
set -u
REPO=/root/dshProj/my-power-dsh
EV="$(cd "$1" && pwd)"
SB=$(mktemp -d /tmp/mpd-t3-mount-XXXXXX)
mkdir -p "$SB/ws"

cp "$HOME/.dsh/.credentials.yaml" "$SB/.credentials.yaml" || { echo "FATAL: no credentials"; exit 9; }
[ -f "$HOME/.dsh/settings.yaml" ] && cp "$HOME/.dsh/settings.yaml" "$SB/settings.yaml"

cat > "$SB/ws/dut.v" <<'VEOF'
module dut(input wire a, output wire y);
  assign y = a;
endmodule
VEOF

cat > "$EV/mpd-verif-overlay.yml" <<YEOF
# QA overlay for t3 evidence (see mounted-calls.sh header): the legacy
# install-profile row list omits mpd-verif, the bundle patch carries it.
- insert:
    - id: mpd-verif
      name: $REPO/packages/mpd-verif-plugin/dist/index.js
      config: {}
YEOF

echo "sandbox: $SB"
cd "$REPO" || exit 9
export DSH_HOME="$SB"
node scripts/install-profile.mjs --yes --dsh-home "$SB" --profile mpd-headless --skip-toolchain > "$EV/install-profile.log" 2>&1
echo "install-profile exit: $?"

# Composition check only (never a load proof): the overlay must add the row.
dsh --profile mpd-headless --patch "$EV/mpd-verif-overlay.yml" --dump-config 2>/dev/null | grep -A2 "id: mpd-verif" | head -5

PROMPT_A='Call the mpd_verif_backends tool exactly three times, in this order: first with {"backend":"iverilog"}, then with {"backend":"all"}, then with {"backend":"vcs"}. Do not call any other tool. Then paste verbatim, one call per line, the exact rendered result line(s) of each call, each line prefixed by "BACKENDS1:", "BACKENDS2:" and "BACKENDS3:" respectively.'
PROMPT_B="Call the mpd_verif_lint tool once with {\"backend\":\"iverilog\",\"sources\":[\"$SB/ws/dut.v\"]}, then call the mpd_verif_compile tool once with {\"backend\":\"iverilog\",\"sources\":[\"$SB/ws/dut.v\"],\"top\":\"dut\"}. Do not call any other tool. Then paste verbatim the exact rendered result lines of each call, prefixed \"LINT:\" and \"COMPILE:\" respectively."

( cd "$SB/ws" && timeout 900 dsh --profile mpd-headless --patch "$EV/mpd-verif-overlay.yml" "$PROMPT_A" > "$EV/mounted-backends.log" 2>&1 </dev/null )
echo "mounted backends exit: $?"
( cd "$SB/ws" && timeout 900 dsh --profile mpd-headless --patch "$EV/mpd-verif-overlay.yml" "$PROMPT_B" > "$EV/mounted-lint-compile.log" 2>&1 </dev/null )
echo "mounted lint/compile exit: $?"

echo "precondition:"
for b in iverilog verilator vcs; do printf '  %s -> %s\n' "$b" "$(command -v "$b" || echo ABSENT)"; done
echo "sandbox kept for inspection: $SB"
