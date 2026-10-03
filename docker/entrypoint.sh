#!/usr/bin/env bash
# docker/entrypoint.sh — the in-container half of the Docker client-install E2E.
#
# WHAT THIS PROVES, IN ORDER (task lane D, docs/plan-0.1.7-adaptation.md §5):
#   1. a bare ubuntu:24.04 gets its toolchain from the network (apt -> Node 24 -> bun -> pnpm),
#   2. a CLIENT installs the harness itself (`npm i -g @deepseek-ai/dsh@<pin>`) and the version is
#      asserted EXACTLY,
#   3. a COPY of this checkout is installed with the real client flow
#      (`dsh plugin --profile web add .`), after `bun install` and a from-source rebuild of every
#      `packages/*/dist` entry with the canonical repo-root command (AGENTS.md §6),
#   4. the install COMPOSES the mpd rows (labelled composition-only evidence, AGENTS.md §4),
#   5. and the installed profile MOUNTS: a real boot in an isolated HOME/DSH_HOME with
#      registration instrumentation (docker/probe.ts) reading the live tool registry.
#
# WHAT IT DELIBERATELY DOES NOT DO: no credential is copied in, read, or written (AGENTS.md §10),
# so no live LLM turn is attempted. That assertion is recorded as `null` WITH ITS REASON rather
# than faked — see docker/README.md.
#
# Every assertion is recorded by the pure-bash `record()` helper below (argv -> JSON.stringify, so a
# raw witness line survives quoting intact) and the verdict is assembled by docker/lib/report.ts,
# which emits every assertion the run never reached as `null` + "not reached". A partial run
# therefore still produces a complete, honest result.json.
set -euo pipefail

# ── paths and pins ────────────────────────────────────────────────────────────
SRC_DIR="${MPD_E2E_SRC_DIR:-/src}"
APP_DIR="${MPD_E2E_APP:-/opt/mpd}"
WORK_DIR="${MPD_E2E_WORK:-/work}"
OUT_DIR="${MPD_E2E_OUT:-/out}"
LIB_DIR="${MPD_E2E_LIB:-/opt/mpd-e2e/lib}"
PROBE_SRC="${MPD_E2E_PROBE:-/opt/mpd-e2e/probe.ts}"
TOOLCHAIN_DIR="${MPD_E2E_TOOLCHAIN:-/opt/toolchain}"
IMAGE="${MPD_E2E_IMAGE:-mpd-docker-e2e:local}"

# ── which install this run judges ─────────────────────────────────────────────
# `source` (the default) installs the CHECKOUT by path, after `bun install` and a from-source
# rebuild of every `packages/*/dist` entry. `oneclick` installs the PUBLISHED package from a git
# spec with NO build at all — the user-facing `dsh plugin --profile web add github:...` path —
# reproduced locally against a scratch git repository built from the same build context. Both modes
# then share the SAME downstream verdict: composition, a mounting boot with registration
# instrumentation, the preset session and the isolation assertions.
INSTALL_MODE="${MPD_E2E_INSTALL_MODE:-source}"
# The spec handed to `dsh plugin --profile web add`. `.` is the checkout; a git spec is the
# published-package path.
INSTALL_SPEC="${MPD_E2E_INSTALL_SPEC:-.}"
# Scratch "remote" for the one-click mode: a working copy the entrypoint commits, and the bare
# repository the spec clones from. Both live inside the container.
ONE_CLICK_SRC="${MPD_E2E_ONECLICK_SRC:-/opt/oneclick-src}"
ONE_CLICK_REPO="${MPD_E2E_ONECLICK_REPO:-/opt/oneclick.git}"

NODE_VERSION="${MPD_E2E_NODE_VERSION:-24.19.0}"
DSH_VERSION="${MPD_E2E_DSH_VERSION:-0.2.0-rc.2}"
PNPM_VERSION="${MPD_E2E_PNPM_VERSION:-11.23.0}"
# The DSH-TUI host. 0.12.0 is the dsh-tui release whose peer ranges cover the WHOLE band this lane is
# expected to run — its lists end with `|| 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2` — so ONE default
# serves the pinned baseline and any older adaptation run. 0.11.2 stopped at 0.2.0-rc.1, and a
# `dsh plugin --profile dsh-tui add` against a 0.2.0-rc.2 harness is then REFUSED on peer ranges: the
# same failure mode measured 2026-09-29 on the 0.11.1/0.2.0-rc.1 pair, which aborted this lane
# (evidence/docker/client-install/2026-09-29T07-07-01Z).
TUI_VERSION="${MPD_E2E_TUI_VERSION:-0.12.0}"
export TUI_VERSION
PORT="${MPD_E2E_PORT:-3197}"
BOOT_BUDGET="${MPD_E2E_BOOT_BUDGET:-300}"

# ISOLATION (AGENTS.md §7): both the harness home AND the user home are sandboxed, and they are
# redirected BEFORE the toolchain runs, so no tool cache can land in the real home either. The
# `isolation.realHome` assertion at the end checks exactly that.
SANDBOX_HOME=/root/sandbox-home
SANDBOX_DSH=/root/sandbox-dsh
PROFILE_DIR="$SANDBOX_DSH/profiles/web"
REAL_HOME=/root
REAL_HOME_MARKERS=(".dsh" ".mpd" ".npm" ".bun")

STEPS_DIR="$WORK_DIR/steps"
STATE_FILE="$WORK_DIR/assertions.ndjson"
FACTS_FILE="$WORK_DIR/facts.tsv"
HASHES_FILE="$WORK_DIR/hashes.tsv"
STEPS_INDEX="$WORK_DIR/steps.tsv"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"
STEP_CODE=0
STEP_SECONDS=0
BOOT_PID=""

mkdir -p "$STEPS_DIR" "$OUT_DIR" "$APP_DIR" "$TOOLCHAIN_DIR" "$SANDBOX_HOME" "$SANDBOX_DSH"
: > "$STATE_FILE"; : > "$FACTS_FILE"; : > "$HASHES_FILE"; : > "$STEPS_INDEX"

export HOME="$SANDBOX_HOME"
export DSH_HOME="$SANDBOX_DSH"
export NPM_CONFIG_CACHE="$TOOLCHAIN_DIR/npm-cache"
export NPM_CONFIG_PREFIX=/usr/local
export BUN_INSTALL="$TOOLCHAIN_DIR/bun"
export PATH="$BUN_INSTALL/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export CI=1

log() { printf '%s\n' "$*"; }

# fact <key> <value> — one tab-separated line; the reporter splits facts from obs.* observations.
fact() {
  local key="$1"
  local value="${2:-}"
  printf '%s\t%s\n' "$key" "$(printf '%s' "$value" | tr '\n\t' '  ')" >> "$FACTS_FILE"
}

# json_escape <text> — the minimal sufficient escaping for a JSON string body. `fact` already
# normalizes newlines/tabs away; backslash, quote and stray CR are what remain.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   '
}

# record <name> <true|false|null> [reason] [raw] — the ONLY way an assertion enters the report.
#
# PURE BASH ON PURPOSE, and this is not a style choice: the first assertions are recorded BEFORE node
# exists (apt precedes the Node install), so a node-based recorder aborted the very first run at the
# ubuntu.version line with `node: command not found` (measured 2026-09-27). The state file is NDJSON;
# docker/lib/report.ts parses it and turns a corrupt line into a FAILED assertion rather than
# dropping evidence silently.
record() {
  local name="$1" status="$2" reason="${3:-}" raw="${4:-}"
  case "$status" in
    true|false|null) ;;
    *) reason="invalid status ${status} refused; ${reason}"; status="null" ;;
  esac
  printf '{"name":"%s","ok":%s,"reason":"%s","raw":"%s"}\n' \
    "$(json_escape "$name")" "$status" "$(json_escape "$reason")" "$(json_escape "$raw")" >> "$STATE_FILE"
  printf '[record] %s=%s%s\n' "$name" "$status" "${reason:+ — $reason}"
}

# witness <logfile> <ere> [max] — the raw line(s) that justified a verdict, for the failure report.
witness() {
  local file="$1" pattern="$2" max="${3:-2}"
  { grep -nE -- "$pattern" "$file" 2>/dev/null | head -n "$max" | tr '\n' ' ' ; } || true
}

# row_log_line <row> <ere> — the first LINE of an MPD row's OWN file log, naming the file it came from.
#
# R5 (AGENTS.md §6, agent-references/seam-adapters.md) moved every MPD runtime diagnostic OUT of the
# terminal: a row never prints, it appends to `<workspace>/.mpd/logs/<row>.log`. A console grep
# therefore witnesses NOTHING for these rows — measured 2026-10-02 on the client-install run: the
# adapter's boot line and the session-gate registration line both recorded false with an EMPTY raw
# while the boot itself was green (evidence/docker/client-install/2026-10-02T16-14-48Z/result.json).
#
# The candidate roots are the two workspaces this lane really has, in resolution order: the boot
# process's own cwd ($WORK_DIR, the exec-less `rowLogLine` fallback) and the session workspace the
# `/api/session/create` call named ($WORK_DIR/ws). The FIRST file carrying the line wins and the
# printed result NAMES it, so the witness can be re-read by hand instead of trusted, and a line
# absent from every candidate makes the caller record FALSE.
row_log_line() {
  local row="$1" pattern="$2" root file line
  for root in "$WORK_DIR" "$WORK_DIR/ws"; do
    file="$root/.mpd/logs/$row.log"
    [ -f "$file" ] || continue
    line="$(grep -m1 -oE -- "$pattern" "$file" 2>/dev/null || true)"
    if [ -n "$line" ]; then printf '%s (file=%s)' "$line" "$file"; return 0; fi
  done
  return 1
}

append_step() { # id exit seconds logfile cmd
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$STEPS_INDEX"
}

# run_step <id> <cmd...> — run, tee to the step log, never abort (the verdict is the report's).
run_step() {
  local id="$1"; shift
  local logfile="$STEPS_DIR/$id.log"
  local started ended
  started="$(date +%s)"
  log "===== STEP $id ====="
  log "\$ $*"
  set +e
  "$@" >"$logfile" 2>&1
  STEP_CODE=$?
  set -e
  ended="$(date +%s)"
  STEP_SECONDS=$((ended - started))
  cat "$logfile"
  log "[step $id] exit=$STEP_CODE seconds=$STEP_SECONDS"
  append_step "$id" "$STEP_CODE" "$STEP_SECONDS" "$id.log" "$(printf '%s ' "$@" | tr '\n\t' '  ')"
}

# bash_fallback_report — the reporter for a run that never reached the Node install.
# The verdict is still derived from the same NDJSON state (each line is already valid JSON), so even a
# catastrophic apt failure leaves an honest artifact instead of nothing.
bash_fallback_report() {
  local assertions failed
  assertions="$(paste -sd, "$STATE_FILE" 2>/dev/null || true)"
  failed="$(grep -c '"ok":false' "$STATE_FILE" 2>/dev/null || true)"
  [ -n "$failed" ] || failed=0
  {
    printf '{\n  "case": "docker-client-install",\n'
    printf '  "ok": %s,\n  "complete": false,\n' "$([ "$failed" -eq 0 ] && echo true || echo false)"
    printf '  "reporter": "bash fallback: node was never installed, so docker/lib/report.ts could not run",\n'
    printf '  "assertions": [%s]\n}\n' "$assertions"
  } > "$OUT_DIR/result.json"
  {
    printf '===== Docker client-install E2E — bash fallback report =====\n'
    printf 'node was never installed; the raw step logs follow.\n'
    for file in "$STEPS_DIR"/*.log; do
      [ -e "$file" ] || continue
      printf '\n----- %s -----\n' "$(basename "$file")"
      cat "$file"
    done
  } > "$OUT_DIR/output.log"
  printf '[report-fallback] failed=%s -> %s\n' "$failed" "$OUT_DIR/result.json"
  [ "$failed" -eq 0 ] && return 0 || return 1
}

# finish — stop the boot if it is still alive, write the evidence, exit with the report's verdict.
FINISHED=0
FINISH_EXIT=1
finish() {
  if [ "$FINISHED" = "1" ]; then exit "$FINISH_EXIT"; fi
  FINISHED=1
  local code=0
  if [ -n "$BOOT_PID" ] && kill -0 "$BOOT_PID" 2>/dev/null; then
    kill -TERM "$BOOT_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$BOOT_PID" 2>/dev/null || true
    wait "$BOOT_PID" 2>/dev/null || true
  fi
  fact finishedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if command -v node >/dev/null 2>&1; then
    node "$LIB_DIR/report.ts" --work "$WORK_DIR" --out "$OUT_DIR" --image "$IMAGE" --started "$STARTED_EPOCH" || code=$?
  else
    log "[warn] node is not installed — writing the bash fallback report"
    bash_fallback_report || code=$?
  fi
  FINISH_EXIT=$code
  exit "$code"
}

# An unexpected shell failure must still leave the evidence of what was observed, never a bare
# `set -e` exit with no artifact.
on_error() {
  local code=$?
  fact abort "unexpected shell failure (exit $code) near line ${BASH_LINENO[0]:-$LINENO}"
  log "[error] unexpected shell failure (exit $code) — reporting what was observed so far"
  finish
}
trap 'on_error' ERR

# bail <reason> — a prerequisite failed; record the reason and let the reporter null the rest.
bail() {
  fact abort "$1"
  log "[bail] $1 — remaining assertions are reported as null+\"not reached\""
  finish
}

log "===== Docker client-install E2E — $STAMP ====="
log "ubuntu image : $(. /etc/os-release; printf '%s %s' "$ID" "$VERSION_ID")"
log "app dir      : $APP_DIR   (copy of $SRC_DIR)"
log "HOME         : $HOME"
log "DSH_HOME     : $DSH_HOME"
# `nodePin`, NOT `node`: this line prints the TARBALL route's pin, and in image mode the node that
# actually runs is the `node:24-bookworm` one (measured 2026-10-02: the label read `node=24.19.0` while
# the container ran v24.21.0). The effective version is recorded by `fact node` in BOTH routes below.
log "pins         : nodePin=$NODE_VERSION dsh=$DSH_VERSION pnpm=$PNPM_VERSION"

fact stamp "$STAMP"
fact entrypoint "docker/entrypoint.sh"
fact image "$IMAGE"
fact ubuntuImage "$(. /etc/os-release; printf '%s %s (%s)' "$ID" "$VERSION_ID" "$PRETTY_NAME")"
fact pins "nodePin=$NODE_VERSION dsh=$DSH_VERSION pnpm=$PNPM_VERSION"
fact home "$HOME"
fact dshHome "$DSH_HOME"

# ── 01. the distribution itself ───────────────────────────────────────────────
UBUNTU_ID="$(. /etc/os-release; printf '%s' "$ID")"
UBUNTU_VERSION="$(. /etc/os-release; printf '%s' "$VERSION_ID")"
if [ "$UBUNTU_ID" = "ubuntu" ] && [ "$UBUNTU_VERSION" = "24.04" ]; then
  record ubuntu.version true "the base image is ubuntu:24.04" "$UBUNTU_ID $UBUNTU_VERSION"
else
  record ubuntu.version false "the base image is not ubuntu 24.04" "$UBUNTU_ID $UBUNTU_VERSION"
  bail "wrong base image"
fi

# ── 02. apt: the distribution's own prerequisites ─────────────────────────────
log ""
log "----- apt: curl git ca-certificates unzip xz-utils -----"
run_step 01-apt-update apt-get update
APT_UPDATE=$STEP_CODE
run_step 01-apt-install env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  curl git ca-certificates unzip xz-utils tmux
APT_INSTALL=$STEP_CODE
fact aptSeconds "$(awk -F'\t' '$1 ~ /^01-apt/ {s+=$3} END {print s+0}' "$STEPS_INDEX" 2>/dev/null || echo "?")"
if [ "$APT_UPDATE" -eq 0 ] && [ "$APT_INSTALL" -eq 0 ]; then
  record toolchain.apt true "apt-get update + install curl git ca-certificates unzip xz-utils tmux" "exit=$APT_UPDATE/$APT_INSTALL"
else
  record toolchain.apt false "apt-get failed (update=$APT_UPDATE install=$APT_INSTALL)" \
    "$(witness "$STEPS_DIR/01-apt-update.log" '^(E:|Err:|W: Failed)' 3) $(witness "$STEPS_DIR/01-apt-install.log" '^(E:|Err:)' 3)"
  bail "apt-get failed; nothing downstream can run"
fi
log "curl: $(curl --version | head -1)"

# ── 03. Node 24 (official tarball + published SHASUMS256) ─────────────────────
log ""
log "----- Node.js $NODE_VERSION -----"
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *)
    record toolchain.node false "unsupported dpkg architecture for the official Node tarball" "$(dpkg --print-architecture)"
    bail "unsupported architecture"
    ;;
esac
fact nodeArch "$(dpkg --print-architecture) -> linux-$NODE_ARCH"
# ── THE PREINSTALLED NODE IS ASSERTED, NOT RE-FETCHED (default) ───────────────
# The image carries node from the OFFICIAL `node:24-bookworm` image (docker/Dockerfile), because the
# nodejs.org tarball path — the FIRST hard dependency of this run — died on this environment's network
# three times in a row even with `--retry 8 --retry-all-errors`. That path is NOT deleted: set
# `MPD_E2E_NODE_SOURCE=tarball` and the original install runs exactly as it did, so a machine whose
# nodejs.org route holds can still make the stronger claim.
if [ "${MPD_E2E_NODE_SOURCE:-image}" = "tarball" ]; then
fact nodeSource "tarball (nodejs.org, sha256 verified)"
run_step 02-node bash -c '
set -euo pipefail
V="$1"; A="$2"
cd /tmp
# --retry-all-errors, NOT just --retry: curl only retries its own transient failures by default, and
# `curl: (35) Recv failure: Connection reset by peer` is a TRANSPORT error that a plain --retry leaves
# alone. Measured: three consecutive runs died on THIS step, which is the first hard dependency of the
# whole lane, while the same lane had passed twice on the same code when the network held.
curl -fsSLO --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 "https://nodejs.org/dist/v${V}/node-v${V}-linux-${A}.tar.xz"
curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 -o SHASUMS256.txt "https://nodejs.org/dist/v${V}/SHASUMS256.txt"
grep " node-v${V}-linux-${A}.tar.xz\$" SHASUMS256.txt > node.sha256
sha256sum -c node.sha256
tar -xJf "node-v${V}-linux-${A}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
rm -f "node-v${V}-linux-${A}.tar.xz" SHASUMS256.txt node.sha256
node -v
npm -v
' _ "$NODE_VERSION" "$NODE_ARCH"
NODE_V="$(node -v 2>/dev/null || true)"
NPM_V="$(npm -v 2>/dev/null || true)"
fact node "$NODE_V (npm $NPM_V)"
  case "$NODE_V" in
    "v${NODE_VERSION%%.*}"*) record toolchain.node true "install by official tarball, sha256 verified against the published SHASUMS256.txt" "$NODE_V ($(witness "$STEPS_DIR/02-node.log" 'linux-.*tar\.xz: OK' 1))" ;;
    *) record toolchain.node false "node is not the pinned major v${NODE_VERSION}" "$NODE_V" ;;
  esac
else
  # The image's own node. `node -v` and `npm -v` are BOTH asserted: copying `/usr/local` carries npm's
  # module tree with it, and a node that runs while npm does not would fail at the first `dsh plugin`
  # call instead of here where the cause is legible.
  NODE_V="$(node -v 2>/dev/null || true)"
  NPM_V="$(npm -v 2>/dev/null || true)"
  fact nodeSource "image (node:24-bookworm /usr/local)"
  # The EFFECTIVE version is recorded in the image route too, exactly as the tarball route does it: the
  # `pins` line above holds the tarball pin, so without this fact an image-mode result.json states no
  # node version at all (measured 2026-10-02 on the first green run of the multi-stage Dockerfile).
  fact node "$NODE_V (npm $NPM_V)"
  case "$NODE_V" in
    "v${NODE_VERSION%%.*}"*) [ -n "$NPM_V" ] && record toolchain.node true "node $NODE_V and npm $NPM_V come from the OFFICIAL node:24-bookworm image (docker/Dockerfile stage), so this lane no longer depends on nodejs.org" "$NODE_V npm=$NPM_V" || record toolchain.node false "node runs but npm does not — the copied /usr/local is incomplete" "node=$NODE_V npm=missing" ;;
    *) record toolchain.node false "the image's node is not the pinned major v${NODE_VERSION}" "$NODE_V" ;;
  esac
fi
[ -n "$NODE_V" ] || bail "node is not on PATH after the tarball install"

# ── 04. bun (official install script, into the toolchain dir) ─────────────────
log ""
log "----- bun (official install script) -----"
# ── the official script FIRST, npm SECOND, and the route is RECORDED ─────────
# The official script fetches the binary from GITHUB RELEASES, and this environment's route to
# github.com is intermittent: measured twice in one session as
# `curl: (56) Failure when receiving data from the peer` and
# `curl: (28) Failed to connect to github.com port 443 after 135500 ms`, while registry.npmjs.org
# answered 200 in under a second. A flake there REDDENED A LANE WHOSE SUBJECT IS THIS BUNDLE — the
# toolchain is a means, not the thing under test — and a retry passed, which is the definition of an
# assertion that measures the network rather than the artifact. So the fallback exists, and `fact bun`
# names which route produced the binary so a reader is never told the official script ran when it did not.
# `run_step` returns the append's status, NOT the child's — its own contract is "never abort (the
# verdict is the report's)" — so the fallback tests the `STEP_CODE` global it sets. Measured: an
# `|| { ... }` here never fired even though the step exited 1, and the fallback silently did not run.
BUN_ROUTE="official-script"
run_step 03-bun bash -c 'set -euo pipefail; curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 https://bun.sh/install | bash'
if [ "$STEP_CODE" != "0" ]; then
  BUN_ROUTE="npm"
  # `--allow-scripts=bun`: the npm package downloads its platform binary in `install.js`, and npm
  # REFUSES to run a dependency install script by default — measured: `added 2 packages` with
  # `npm warn allow-scripts bun@1.4.2 (postinstall: node install.js)` and NO binary on PATH, so the
  # fallback exited 0 and still left `bun --version` empty. The same class as the pnpm
  # `ERR_PNPM_IGNORED_BUILDS` this repository already documents in AGENTS.md §8.
  run_step 03-bun-npm bash -c 'set -euo pipefail; npm i -g --allow-scripts=bun bun'
fi
# RESOLVE THE BINARY BY SEARCH, not by guessing its layout. The official script installs to
# `$BUN_INSTALL/bin/bun`; the npm package puts its downloaded binary somewhere under its own tree, and
# two attempts to guess that path left `bun --version` EMPTY while the install exited 0. So: prefer the
# script's path, then npm's global bin, and only then search — reporting which one was used, because a
# silent miss here is what made two runs die at the FIRST assertion.
BUN_ON_PATH="$(command -v bun 2>/dev/null || true)"
if [ -z "$BUN_ON_PATH" ] && [ -x "$BUN_INSTALL/bin/bun" ]; then BUN_ON_PATH="$BUN_INSTALL/bin/bun"; fi
if [ -z "$BUN_ON_PATH" ] && [ -x "$(npm prefix -g 2>/dev/null)/bin/bun" ]; then BUN_ON_PATH="$(npm prefix -g)/bin/bun"; fi
if [ -z "$BUN_ON_PATH" ]; then
  # `-print -quit` rather than `| head -1`: pipefail turns the reader's early exit into a SIGPIPE on
  # `find`, which `set -e` then turns into an abort. Measured earlier in this very script.
  BUN_ON_PATH="$(find /usr /opt /root -name bun -type f -perm -u+x -print -quit 2>/dev/null || true)"
fi
[ -n "$BUN_ON_PATH" ] && ln -sf "$BUN_ON_PATH" /usr/local/bin/bun 2>/dev/null || true
fact bunPath "${BUN_ON_PATH:-not-found}"
BUN_V="$(bun --version 2>/dev/null || true)"
fact bun "$BUN_V (route=$BUN_ROUTE, BUN_INSTALL=$BUN_INSTALL)"
case "$BUN_V" in
  1.*) record toolchain.bun true "bun $BUN_V on PATH, installed via $BUN_ROUTE" "$BUN_V" ;;
  *) record toolchain.bun false "bun did not install / did not report a 1.x version (routes tried: official-script, npm)" "$BUN_V" ;;
esac
[ -n "$BUN_V" ] || bail "bun is not usable"

# ── 05. pnpm: a PREREQUISITE OF THE HARNESS, not of this test ─────────────────
# `dsh plugin <args>` forwards to pnpm in the profile directory (@deepseek-ai/dsh/lib/plugin-*.js
# prints "pnpm was not found; install pnpm and make it available on PATH" on exit 127), so a client
# machine without pnpm simply cannot install a bundle. Asserting it here is what makes the next
# step a client path rather than a special case.
log ""
log "----- pnpm $PNPM_VERSION (required by 'dsh plugin') -----"
run_step 04-pnpm npm i -g "pnpm@$PNPM_VERSION"
PNPM_V="$(pnpm --version 2>/dev/null || true)"
fact pnpm "$PNPM_V"
if [ "$STEP_CODE" -eq 0 ] && [ -n "$PNPM_V" ]; then
  record toolchain.pnpm true "required by 'dsh plugin' (it forwards to pnpm), available on PATH" "$PNPM_V"
else
  record toolchain.pnpm false "pnpm install failed (exit=$STEP_CODE) — 'dsh plugin' cannot work without it" "$PNPM_V"
  bail "pnpm missing"
fi

# ── 06. the harness itself, at the exact pin ──────────────────────────────────
log ""
log "----- @deepseek-ai/dsh@$DSH_VERSION -----"
run_step 05-dsh npm i -g "@deepseek-ai/dsh@$DSH_VERSION"
DSH_V="$(dsh --version 2>&1 | tail -n 1 | tr -d '\r' || true)"
fact dsh "$DSH_V ($(command -v dsh || echo 'not on PATH'))"
# The exact harness the WHOLE run certifies, stated as its own fact so no reader has to infer it from
# the assertion list.
fact harnessVersion "$DSH_V"
fact harnessVersionExpected "$DSH_VERSION"
if [ "$STEP_CODE" -eq 0 ] && [ "$DSH_V" = "$DSH_VERSION" ]; then
  record harness.version true "npm i -g then 'dsh --version' printed the pin exactly" "$DSH_V"
else
  record harness.version false "'dsh --version' is not the pin $DSH_VERSION (npm exit=$STEP_CODE)" "$DSH_V"
  bail "harness install failed"
fi

# ── 07. copy the repository and rebuild every dist from source ────────────────
log ""
log "----- build-context filter (did the image carry host state?) -----"
# The image's /src is the build context as `docker/Dockerfile.dockerignore` filtered it. If host state
# leaked in, `bun install` could succeed on the host's own node_modules and this whole run would be a
# fake green — so the filter is asserted, not assumed.
CONTEXT_LEAK=""
# `pnpm-workspace.yaml` / `pnpm-lock.yaml` / `.npmrc` / `.pnpmfile.cjs` are install-affecting CONFIG: a
# stray one makes the container resolve a different graph than a user's fresh clone would, which is a
# false verdict in EITHER direction (measured: an untracked allowBuilds template reported a failure
# that belonged to the host).
for marker in node_modules .git evidence .toolchain dist .qa-recon pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpmfile.cjs; do
  [ -e "$SRC_DIR/$marker" ] && CONTEXT_LEAK="$CONTEXT_LEAK$marker,"
done
NESTED_DEPS="$(find "$SRC_DIR" -mindepth 2 -maxdepth 4 -name node_modules -type d 2>/dev/null | head -n 3 | tr '\n' ',' || true)"
CONTEXT_LEAK="$CONTEXT_LEAK$NESTED_DEPS"
if [ -z "$CONTEXT_LEAK" ]; then
  record copy.contextFiltered true "the build context carries no host state and no install-affecting config, so nothing can pass for a dependency the container should have installed" "absent: node_modules .git evidence .toolchain dist pnpm-workspace.yaml pnpm-lock.yaml .npmrc .pnpmfile.cjs"
else
  record copy.contextFiltered false "the build context carries host state — every build assertion below would be invalid" "$CONTEXT_LEAK"
  bail "the build context was not filtered (docker/Dockerfile.dockerignore)"
fi

log ""
log "----- copy the checkout to $APP_DIR -----"
run_step 06-copy cp -a "$SRC_DIR/." "$APP_DIR/"
COPY_NAME="$(node -e 'process.stdout.write(String(require(process.argv[1]).name))' "$APP_DIR/package.json" 2>/dev/null || true)"
fact copyManifest "$COPY_NAME"
if [ "$STEP_CODE" -eq 0 ] && [ "$COPY_NAME" = "@mpd-dsh/mpd" ] && [ -d "$APP_DIR/packages" ] && [ -d "$APP_DIR/skills" ] && [ -d "$APP_DIR/presets" ]; then
  record copy.repo true "package.json is @mpd-dsh/mpd and packages/, skills/, presets/ are present" "name=$COPY_NAME"
else
  record copy.repo false "the copied tree is not the bundle (exit=$STEP_CODE, name=$COPY_NAME)" "$(witness "$STEPS_DIR/06-copy.log" 'cp: |No such' 2)"
  bail "copy failed"
fi

# ── the scratch "remote" the one-click spec pulls from ───────────────────────
# WHAT THIS REPRODUCES: the files a `github:owner/repo` install would receive. The spec's resolver
# clones and packs the repository through the manifest's `files` allowlist, so the scratch repository
# carries the build context as-is; the assertions after the install then read what actually landed.
if [ "$INSTALL_MODE" = "oneclick" ]; then
  log ""
  log "----- one-click mode: build the scratch git repository the spec will pull -----"
  run_step 06b-oneclick-repo bash -c "rm -rf '$ONE_CLICK_SRC' '$ONE_CLICK_REPO' \
    && mkdir -p '$ONE_CLICK_SRC' \
    && cp -a '$SRC_DIR/.' '$ONE_CLICK_SRC/' \
    && cd '$ONE_CLICK_SRC' \
    && git init -q . \
    && git add -A \
    && git -c user.email=e2e@local -c user.name='mpd e2e' commit -qm 'one-click fixture: the build context as committed' \
    && git clone -q --bare . '$ONE_CLICK_REPO'"
  ONE_CLICK_COMMIT="$(git --git-dir="$ONE_CLICK_REPO" rev-parse HEAD 2>/dev/null || true)"
  fact oneclick.spec "$INSTALL_SPEC"
  fact oneclick.commit "$ONE_CLICK_COMMIT"
  if [ "$STEP_CODE" -eq 0 ] && [ -n "$ONE_CLICK_COMMIT" ]; then
    record oneclick.scratchRepo true "the scratch remote (a git repository of the build context) exists, so the spec resolves through the real git path" "commit=$ONE_CLICK_COMMIT repo=$ONE_CLICK_REPO"
  else
    record oneclick.scratchRepo false "the scratch remote could not be built, so nothing downstream would prove the published-package path" "$(witness "$STEPS_DIR/06b-oneclick-repo.log" 'error|Error|fatal' 3)"
    bail "the one-click fixture repository could not be built"
  fi
fi

log ""
log "----- bun install -----"
if [ "$INSTALL_MODE" = "oneclick" ]; then
  # NOT a gap in the evidence: this lane's whole claim is that a user's install runs NO build, so a
  # from-source rebuild here would repair exactly the staleness the run is meant to expose.
  record build.bunInstall null "not applicable in one-click mode: the published package carries its own dependencies and the install materializes them" "skipped by design"
else
run_step 07-bun-install bash -c "cd '$APP_DIR' && bun install"
if [ "$STEP_CODE" -eq 0 ]; then
  record build.bunInstall true "bun install resolved the workspace and the dev/optional dependencies" "exit=0"
else
  record build.bunInstall false "bun install failed (exit=$STEP_CODE)" "$(witness "$STEPS_DIR/07-bun-install.log" 'error|Error|failed' 3)"
fi
fi

log ""
log "----- rebuild every packages/*/dist from source (canonical repo-root bun build) -----"
if [ "$INSTALL_MODE" = "oneclick" ]; then
  # Same reason as build.bunInstall: the one-click lane asserts that NO build is needed, and a
  # rebuild here would silently repair a stale committed `dist/` that a real user would receive.
  record build.dists null "not applicable in one-click mode: the published package ships its built dist entries, and the mount below is what judges them" "skipped by design"
else
run_step 08-rebuild node "$LIB_DIR/rebuild.ts" --repo "$APP_DIR" --json "$WORK_DIR/rebuild.json"
REBUILD_LINE="$(witness "$STEPS_DIR/08-rebuild.log" '^\[rebuild\] (BUILD_OK|OK)=' 3)"
REBUILD_FAILED="$(grep -m1 '^\[rebuild\] BUILD_FAILED=' "$STEPS_DIR/08-rebuild.log" 2>/dev/null || true)"
REBUILD_OK="$(grep -m1 '^\[rebuild\] OK=' "$STEPS_DIR/08-rebuild.log" 2>/dev/null || true)"
fact rebuildEntries "$(grep -m1 -oE 'ENTRIES=[0-9]+' "$STEPS_DIR/08-rebuild.log" 2>/dev/null || echo 'ENTRIES=?')"
fact obs.rebuildNoSrc "$(grep -m1 -oE 'NO_SRC=.*' "$STEPS_DIR/08-rebuild.log" 2>/dev/null || echo '')"
if [ "$STEP_CODE" -eq 0 ] && [ "$REBUILD_OK" = "[rebuild] OK=true" ]; then
  record build.dists true "every discovered packages/*/dist entry rebuilt with exit 0 and a non-empty artifact" "$(grep -m1 -oE 'BUILD_OK=[0-9]+/[0-9]+' "$STEPS_DIR/08-rebuild.log" || echo "$REBUILD_LINE")"
else
  record build.dists false "at least one dist entry failed to rebuild" "$REBUILD_FAILED $(witness "$STEPS_DIR/08-rebuild.log" '^\[rebuild\] FAIL' 2)"
fi
fi

# ── 08. the REAL client install: one command from the checkout ────────────────
log ""
log "----- dsh plugin --profile web add $INSTALL_SPEC (the whole install, mode=$INSTALL_MODE) -----"
run_step 09-install bash -c "cd '$APP_DIR' && dsh plugin --profile web add '$INSTALL_SPEC'"
INSTALL_CODE=$STEP_CODE
fact obs.installSpec "$INSTALL_SPEC"
fact obs.installTail "$(tail -n 4 "$STEPS_DIR/09-install.log" 2>/dev/null | tr '\n' ' ')"
if [ "$INSTALL_CODE" -ne 0 ]; then
  record install.exit false "'dsh plugin --profile web add $INSTALL_SPEC' exited $INSTALL_CODE" "$(witness "$STEPS_DIR/09-install.log" 'ERR_|error|Error|not found' 3)"
  bail "the client install failed — nothing downstream can be asserted"
fi
record install.exit true "one command installed the bundle into the profile" "exit=0 spec=$INSTALL_SPEC"

if [ -f "$PROFILE_DIR/package.json" ]; then
  node -e '
    const fs = require("node:fs")
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    process.stdout.write("dep=" + String((manifest.dependencies ?? {})["@mpd-dsh/mpd"] ?? "") + "\n")
    process.stdout.write("bundles=" + ((manifest.dsh?.profile?.bundles) ?? []).join(",") + "\n")
  ' "$PROFILE_DIR/package.json" > "$WORK_DIR/manifest.txt" 2>/dev/null || true
fi
INSTALL_DEP="$(grep -m1 '^dep=' "$WORK_DIR/manifest.txt" 2>/dev/null | cut -d= -f2- || true)"
INSTALL_BUNDLES="$(grep -m1 '^bundles=' "$WORK_DIR/manifest.txt" 2>/dev/null | cut -d= -f2- || true)"
fact profileDep "$INSTALL_DEP"
fact profileBundles "$INSTALL_BUNDLES"
# The bundle-layer check is the SAME in both modes — the package name must appear in
# `dsh.profile.bundles` — but the dependency SHAPE differs by design: a checkout install records a
# link, while the published-package install records the git spec pnpm resolved (a `git+…` URL with
# the commit it pinned). Each mode asserts its own shape, so neither can pass on the other's.
if printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@mpd-dsh/mpd,' \
  && printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@deepseek-ai/dsh-base,' \
  && printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@deepseek-ai/dsh-web-app,'; then
  BUNDLE_LAYER_OK=1
else
  BUNDLE_LAYER_OK=0
fi
case "$INSTALL_MODE:$INSTALL_DEP" in
  source:link:*|source:file:*)
    if [ "$BUNDLE_LAYER_OK" -eq 1 ]; then
      record install.profileDep true "the profile links the checkout and keeps the box bundles" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    else
      record install.profileDep false "the bundle layer or a box bundle is missing from dsh.profile.bundles" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    fi
    ;;
  oneclick:git+*|oneclick:git:*|oneclick:github:*)
    # `github:<owner>/<repo>` is the SHORTHAND the README tells a user to type, and it is pinned here
    # because the live lane drives exactly that string; `git+…` is the explicit URL form pnpm rewrites
    # it into. Both are the published-package path, neither is a checkout link.
    if [ "$BUNDLE_LAYER_OK" -eq 1 ]; then
      record install.profileDep true "the profile records the GIT spec pnpm resolved — the published-package path, not a checkout link — and keeps the box bundles" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    else
      record install.profileDep false "the git-installed bundle is not in dsh.profile.bundles, so the layer would never mount" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    fi
    ;;
  oneclick:*)
    record install.profileDep false "one-click mode requires a GIT dependency shape; this profile recorded something else" "dep=$INSTALL_DEP"
    ;;
  *)
    record install.profileDep false "the profile dependency is not a path install" "dep=$INSTALL_DEP"
    ;;
esac
if [ -e "$PROFILE_DIR/node_modules/@mpd-dsh/mpd/package.json" ]; then
  record install.installedTree true "the installed bundle resolves inside the profile" "$PROFILE_DIR/node_modules/@mpd-dsh/mpd"
else
  record install.installedTree false "no installed bundle tree in the profile" "$PROFILE_DIR/node_modules/@mpd-dsh/mpd"
fi

# ── 08b. ONE-CLICK PACKAGING: what the published package actually carried ─────
# WHAT THIS ANSWERS, and why a passing mount is not enough on its own: a mount proves the ROWS
# resolved from the tree that landed, but it cannot tell a package that carried everything from one
# that carried a superset (the frozen `evidence/` tree, the repository's own tests) — and the user's
# download size is exactly that difference. These assertions read the INSTALLED tree: every path a row
# names is present, the `files` allowlist was honoured (no `evidence/`, no `.git`, no `docker/`), and
# the dist entries that landed are BYTE-IDENTICAL to the ones the source tree built.
if [ "$INSTALL_MODE" = "oneclick" ]; then
  INSTALLED_DIR="$PROFILE_DIR/node_modules/@mpd-dsh/mpd"
  log ""
  log "----- one-click packaging: what the published package carried -----"
  ONE_CLICK_MISSING=""
  for rel in cordis.patch.yml presets/mpd.patch.yml \
             packages/mpd-mcp-astgrep/launch.ts packages/mpd-mcp-codegraph/launch.ts \
             packages/mpd-bundle-plugin/client.js icon.svg locale/en.json \
             dsh-plugin.json skills/dsh-qa/SKILL.md; do
    [ -e "$INSTALLED_DIR/$rel" ] || ONE_CLICK_MISSING="$ONE_CLICK_MISSING$rel,"
  done
  if [ -z "$ONE_CLICK_MISSING" ]; then
    record oneclick.requiredPaths true "every path the rows and the display metadata name is present in the installed package" "checked: patch files, MCP launchers, web client, icon, locale, skills corpus"
  else
    record oneclick.requiredPaths false "the installed package is missing a path its own rows name — a real user's install would break the same way" "$ONE_CLICK_MISSING"
  fi

  ONE_CLICK_LEAKED=""
  for rel in evidence .git docker .qa-tmp; do
    [ -e "$INSTALLED_DIR/$rel" ] && ONE_CLICK_LEAKED="$ONE_CLICK_LEAKED$rel,"
  done
  if [ -z "$ONE_CLICK_LEAKED" ]; then
    record oneclick.filesAllowlist true "the files allowlist was honoured: no frozen evidence tree, no git history, no lane scratch in the installed package" "absent: evidence/ .git/ docker/ .qa-tmp/"
  else
    record oneclick.filesAllowlist false "the installed package carries paths the allowlist was meant to exclude, so a user's download is larger than the manifest promises" "$ONE_CLICK_LEAKED"
  fi

  ONE_CLICK_DRIFT=""
  ONE_CLICK_COMPARED=0
  for rel in $(cd "$APP_DIR" 2>/dev/null && ls packages/*/dist/*.js 2>/dev/null | head -40); do
    if [ -f "$INSTALLED_DIR/$rel" ] && [ -f "$APP_DIR/$rel" ]; then
      ONE_CLICK_COMPARED=$((ONE_CLICK_COMPARED + 1))
      cmp -s "$APP_DIR/$rel" "$INSTALLED_DIR/$rel" || ONE_CLICK_DRIFT="$ONE_CLICK_DRIFT$rel,"
    fi
  done
  fact oneclick.distCompared "$ONE_CLICK_COMPARED"
  if [ "$ONE_CLICK_COMPARED" -gt 0 ] && [ -z "$ONE_CLICK_DRIFT" ]; then
    record oneclick.distByteIdentical true "$ONE_CLICK_COMPARED committed dist entry/entries landed byte-identical, so the install ran no build and shipped what the source tree builds" "cmp -s on each entry"
  elif [ "$ONE_CLICK_COMPARED" -eq 0 ]; then
    record oneclick.distByteIdentical null "no dist entry could be compared: either the installed package carries none (its own failure above) or the source tree has none to compare against" "compared=0"
  else
    record oneclick.distByteIdentical false "an installed dist entry differs from the one the source tree builds — the package was rebuilt somewhere, or a stale artifact was published" "$ONE_CLICK_DRIFT"
  fi
fi

# ── 09. COMPOSITION: what the profile composes (never a load proof, AGENTS.md §4) ──
log ""
log "----- COMPOSITION ONLY: dsh --profile web --dump-config -----"
if [ -f "$APP_DIR/scripts/dump-config.ts" ]; then
  run_step 10-dump node "$APP_DIR/scripts/dump-config.ts" --profile web
else
  log "[warn] the repository wrapper scripts/dump-config.ts is missing; falling back to the raw flag"
  run_step 10-dump dsh --profile web --dump-config
fi
DUMP_EXIT=$STEP_CODE
DUMP_TXT="$WORK_DIR/dump.txt"
grep -v '^\[dump-config\]' "$STEPS_DIR/10-dump.log" > "$DUMP_TXT" 2>/dev/null || true
# The banner above is the wrapper's own; this label is OURS, so no reader can mistake the dump for
# a plugin load even if the wrapper's wording changes.
log "[label] the block above is COMPOSITION ONLY — rows composed, no plugin code executed"
if [ "$DUMP_EXIT" -eq 0 ]; then
  record compose.dumpExit true "the sanctioned composer exited 0" "exit=0"
else
  record compose.dumpExit false "dump-config exited $DUMP_EXIT" "$(witness "$STEPS_DIR/10-dump.log" 'error|Error|not found' 3)"
fi

# An id-target row is matched as an EXACT id on its own YAML line, at whatever indentation the
# composer used (nested insert entries are indented). A substring match would let
# `mpd-agent-team` be satisfied by `mpd-agent-teams-plugin` — the retired vendored row.
has_row() { grep -qE "^[[:space:]]*- id: $1[[:space:]]*\$" "$DUMP_TXT" 2>/dev/null; }
has_name() { grep -qE "^[[:space:]]*name: ['\"]?$1['\"]?[[:space:]]*\$" "$DUMP_TXT" 2>/dev/null; }
MISSING_ROWS=""
for row in mpd-dsh-adapter mpd-bootstrap mpd-web-compat mpd-roles mpd-workmate; do
  has_row "$row" || MISSING_ROWS="$MISSING_ROWS$row,"
done
DEFAULT_MPD="$(grep -cE "^[[:space:]]*default: ['\"]?mpd['\"]?[[:space:]]*\$" "$DUMP_TXT" 2>/dev/null || true)"
fact obs.dumpMpdRowIds "$(grep -oE "^[[:space:]]*- id: mpd-[a-z-]+" "$DUMP_TXT" 2>/dev/null | sed 's/^[[:space:]]*- id: //' | sort -u | tr '\n' ',' || true)"
# The bundle no longer selects anything by override (strict zero-override, user decision 2026-10-02),
# so ZERO `default: mpd` lines is the expected shape in the composed tree too. It is an OBSERVATION,
# not a gate: the gate on that contract is the structural scan of the SHIPPED patch below, which names
# the offending line — and this read also covers host layers this bundle does not own.
fact obs.dumpDefaultMpdLines "$DEFAULT_MPD (expected 0: the bundle ships no preset override)"

# ── the SHIPPED patch of the INSTALLED bundle: zero column-0 id-targets ───────────────────────
# WHY THE INSTALLED TREE and not the checkout: the composition above was produced from THIS tree, so
# this is the patch a user's harness actually read (a source-mode profile resolves the very same file
# through its `link:` dependency). An unreadable tree is recorded as a failure below rather than
# silently compared against a copy somewhere else in the image.
BUNDLE_DIR=""
if [ -f "$PROFILE_DIR/node_modules/@mpd-dsh/mpd/cordis.patch.yml" ]; then BUNDLE_DIR="$PROFILE_DIR/node_modules/@mpd-dsh/mpd"; fi
# A TOP-LEVEL `- id: <x>` entry is an ID-TARGET (a per-key replacement of a row some host layer
# declares — the retired `default: mpd` registry override was exactly that); rows inside an `insert:`
# list are the ones this bundle ADDS, which is what the additive-only contract permits. The rule is
# therefore structural and needs no host list: at indent 0, every `- id:` is a violation. Two ships
# two layers (`package.json` dsh.bundle.patch), so both are read.
ID_TARGET_HITS=""
ID_TARGET_LAYERS=0
for layer in cordis.patch.yml presets/mpd.patch.yml; do
  [ -f "$BUNDLE_DIR/$layer" ] || continue
  ID_TARGET_LAYERS=$((ID_TARGET_LAYERS + 1))
  LAYER_HITS="$(grep -nE '^- id: ' "$BUNDLE_DIR/$layer" 2>/dev/null | tr '\n' ';' || true)"
  if [ -n "$LAYER_HITS" ]; then ID_TARGET_HITS="$ID_TARGET_HITS$layer:$LAYER_HITS"; fi
done
# The repo's own gate is a STRONGER witness when it can run: it compares every id-target against the
# ids the host layers on disk actually declare. Three container facts shape HOW it is invoked:
#   * the installed bundle can live UNDER node_modules (the oneclick/pnpm layout), where Node refuses
#     to strip types for a `.ts` file — measured 2026-10-02: the gate died there with no verdict line
#     and this step aborted the whole run. So the gate's source is COPIED out to a scratch dir
#     together with the manifest and the very layers under test: the subject stays the INSTALLED
#     bytes (asserted with `cmp`), only the runner's location changes.
#   * a container copy can resolve zero host layers, and that ONE condition (a vacuous comparison)
#     must not redden an arm whose structural read already ran; `--allow-no-host` downgrades exactly
#     that condition to a NOTE, while a real finding still exits 1.
#   * the gate's own output is PRINTED (into the step log) instead of only grepped: a witness whose
#     failure mode cannot be read is not evidence.
# Classification, so the arm decides on the CONTRACT and never on infrastructure: a verdict line
# naming a violation fails the assertion, an exit 0 is recorded as the witness, and a gate that
# could not run at all is named as UNAVAILABLE in the raw while the structural read still decides.
NO_OVERRIDE_WITNESS="gate=skipped (no node, or the installed tree carries no gate script)"
NO_OVERRIDE_FINDING=0
NO_OVERRIDE_CODE=0
SUBJECT_COPY="not compared"
if command -v node >/dev/null 2>&1 && [ -f "$BUNDLE_DIR/scripts/verify-no-host-override.ts" ] && [ -f "$BUNDLE_DIR/package.json" ]; then
  GATE_DIR="$WORK_DIR/no-host-override-subject"
  rm -rf "$GATE_DIR"
  mkdir -p "$GATE_DIR"
  for rel in package.json cordis.patch.yml presets scripts; do
    cp -a "$BUNDLE_DIR/$rel" "$GATE_DIR/" 2>/dev/null || true
  done
  if cmp -s "$BUNDLE_DIR/cordis.patch.yml" "$GATE_DIR/cordis.patch.yml" \
     && cmp -s "$BUNDLE_DIR/presets/mpd.patch.yml" "$GATE_DIR/presets/mpd.patch.yml"; then
    SUBJECT_COPY="byte-identical"
  fi
  # `|| NO_OVERRIDE_CODE=$?` and NOT `set +e`: this file runs under an ERR trap, which a bare
  # non-zero command fires even with errexit off (the same trap the TUI step below works around).
  NO_OVERRIDE_OUT="$(cd "$GATE_DIR" && node scripts/verify-no-host-override.ts --home "$HOME" --allow-no-host 2>&1)" || NO_OVERRIDE_CODE=$?
  log "----- scripts/verify-no-host-override.ts (subject: a $SUBJECT_COPY copy of the installed patch) -----"
  printf '%s\n' "$NO_OVERRIDE_OUT"
  NO_OVERRIDE_TAIL="$(printf '%s\n' "$NO_OVERRIDE_OUT" | grep -E 'PASS:|NOTE|VIOLATION|FAIL' | tail -n 2 | tr '\n' ' ' || true)"
  if [ "$NO_OVERRIDE_CODE" -eq 0 ]; then
    NO_OVERRIDE_WITNESS="gate exit=0 subject=$SUBJECT_COPY ${NO_OVERRIDE_TAIL:-<no verdict line>}"
  elif printf '%s' "$NO_OVERRIDE_TAIL" | grep -qE 'VIOLATION|FAIL'; then
    NO_OVERRIDE_WITNESS="gate exit=$NO_OVERRIDE_CODE subject=$SUBJECT_COPY ${NO_OVERRIDE_TAIL}(REAL FINDING)"
    NO_OVERRIDE_FINDING=1
  else
    NO_OVERRIDE_WITNESS="gate exit=$NO_OVERRIDE_CODE UNAVAILABLE (this witness decides nothing; the structural read above does) ${NO_OVERRIDE_TAIL:-<no verdict line>}"
  fi
fi
if [ -z "$MISSING_ROWS" ] && [ "$ID_TARGET_LAYERS" -ge 2 ] && [ -z "$ID_TARGET_HITS" ] && [ "$NO_OVERRIDE_FINDING" -eq 0 ]; then
  record compose.mpdRows true "the mpd host rows compose as INSERTS (additive-only) and the SHIPPED patch layers carry ZERO column-0 id-targets, i.e. no host row is overridden — the strict zero-override contract; the preset default is the USER's setting, not the bundle's" "rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate layers=$ID_TARGET_LAYERS idTargets=0 defaultMpdLines=$DEFAULT_MPD $NO_OVERRIDE_WITNESS"
else
  record compose.mpdRows false "the mpd rows did not compose as ADDITIVE-ONLY rows with zero host overrides: rowsMissing=${MISSING_ROWS:-none} bundleLayers=$ID_TARGET_LAYERS/2 column0IdTargets=${ID_TARGET_HITS:-none} bundleDir=${BUNDLE_DIR:-<not installed>} zero-override=$NO_OVERRIDE_WITNESS" "$(witness "$DUMP_TXT" '^- id: mpd-' 6)"
fi

if has_row preset-mpd; then
  record compose.presetRow true "the mpd preset is declared as a @deepseek-ai/dsh-agent-preset row (§4 D1)" "- id: preset-mpd"
else
  record compose.presetRow false "no '- id: preset-mpd' row in the composed tree (the 0.1.7 preset model, §4 D1)" "- id: preset-mpd absent"
fi

TEAM_MISSING=""
for row in mpd-agent-team mpd-tool-agent-team mpd-ui-agent-team; do
  has_row "$row" || TEAM_MISSING="$TEAM_MISSING$row,"
done
TEAM_NAMES_MISSING=""
for name in "@deepseek-ai/dsh-experimental-agent-team" "@deepseek-ai/dsh-experimental-tool-agent-team" "@deepseek-ai/dsh-experimental-client-ui-agent-team"; do
  has_name "$name" || TEAM_NAMES_MISSING="$TEAM_NAMES_MISSING$name,"
done
fact obs.dumpAgentTeamRows "$(grep -oE "^[[:space:]]*- id: mpd-(agent|tool-agent|ui-agent)-team[[:space:]]*\$" "$DUMP_TXT" 2>/dev/null | sed 's/^[[:space:]]*- id: //' | tr '\n' ',' || true)"
if [ -z "$TEAM_MISSING" ] && [ -z "$TEAM_NAMES_MISSING" ]; then
  record compose.agentTeamRows true "the official agent-team rows compose under the mpd-owned ids (§4 D3)" "ids=mpd-agent-team,mpd-tool-agent-team,mpd-ui-agent-team"
else
  record compose.agentTeamRows false "agent-team rows missing: ${TEAM_MISSING:-none}; official package names missing: ${TEAM_NAMES_MISSING:-none}" "$(witness "$DUMP_TXT" '(preset-mpd|agent-team)' 6)"
fi

# ── 10. MOUNT: boot the installed profile with registration instrumentation ────
log ""
log "----- MOUNTING BOOT (registration instrumentation) -----"
printf -- '- insert:\n    - id: mpd-docker-e2e-probe\n      name: "%s"\n' "$PROBE_SRC" > "$WORK_DIR/probe.yml"
BOOT_LOG="$STEPS_DIR/11-boot.log"
: > "$BOOT_LOG"
log "\$ cd $WORK_DIR && dsh --profile web --patch $WORK_DIR/probe.yml --port $PORT --no-open"
BOOT_STARTED="$(date +%s)"
set +e
( cd "$WORK_DIR" && exec dsh --profile web --patch "$WORK_DIR/probe.yml" --port "$PORT" --no-open ) >"$BOOT_LOG" 2>&1 &
BOOT_PID=$!
set -e
BOOT_DEADLINE=$((BOOT_STARTED + BOOT_BUDGET))
while [ "$(date +%s)" -lt "$BOOT_DEADLINE" ]; do
  if grep -q '\[docker-probe\] DONE=1' "$BOOT_LOG" 2>/dev/null; then break; fi
  if ! kill -0 "$BOOT_PID" 2>/dev/null; then break; fi
  sleep 2
done
BOOT_APPLIED="$(grep -m1 -oE '\[docker-probe\] APPLIED=ok' "$BOOT_LOG" 2>/dev/null || true)"
BOOT_DONE="$(grep -m1 -oE '\[docker-probe\] DONE=1' "$BOOT_LOG" 2>/dev/null || true)"
BOOT_SERVICE="$(grep -m1 -oE '\[mpd-dsh-adapter\] mpdDsh provided' "$BOOT_LOG" 2>/dev/null || true)"
PROBE_SERVICE="$(grep -m1 -oE '\[docker-probe\] ADAPTER_SERVICE=[a-z]+' "$BOOT_LOG" 2>/dev/null | cut -d= -f2 || true)"
PROBE_CALL="$(grep -m1 -oE '\[docker-probe\] ADAPTER_TOOL_CALL=.*' "$BOOT_LOG" 2>/dev/null | cut -d= -f2- || true)"
PROBE_CORE="$(grep -m1 -oE '\[docker-probe\] CORE_TOOLS=[0-9]+/[0-9]+' "$BOOT_LOG" 2>/dev/null | cut -d= -f2 || true)"
PROBE_CORE_MISSING="$(grep -m1 -oE '\[docker-probe\] CORE_TOOLS_MISSING=.*' "$BOOT_LOG" 2>/dev/null | cut -d= -f2- || true)"
PROBE_TEAM_ROOT="$(grep -m1 -oE '\[docker-probe\] TEAM_TOOLS_ROOT=[0-9]+/[0-9]+' "$BOOT_LOG" 2>/dev/null | cut -d= -f2 || true)"
PROBE_CAPS="$(grep -m1 -oE '\[docker-probe\] ADAPTER_CAPS=.*' "$BOOT_LOG" 2>/dev/null | cut -d= -f2- || true)"
PROBE_RETIRED="$(grep -m1 -oE '\[docker-probe\] RETIRED_TOOLS_PRESENT=.*' "$BOOT_LOG" 2>/dev/null | cut -d= -f2- || true)"
fact bootCoreTools "$PROBE_CORE"
fact bootTeamToolsRootPlane "$PROBE_TEAM_ROOT"
fact bootAdapterCaps "$PROBE_CAPS"
fact obs.retiredToolsPresent "${PROBE_RETIRED:-<probe did not report>}"
# The official team tools are AGENT-scoped (see docker/probe.ts), so the root-plane read is an
# OBSERVATION that the plane is what we think it is — the graded read happens after a real agent
# exists, further down.
fact obs.teamToolPlane "root-plane read=$PROBE_TEAM_ROOT (0/9 is the documented shape: @deepseek-ai/dsh-experimental-tool-agent-team registers scoped.tools on agent.ctx per agent); the graded read is AGENT_TEAM_TOOLS below"

if [ -n "$BOOT_APPLIED" ] && [ -n "$BOOT_DONE" ]; then
  record boot.probeApplied true "the probe plugin's apply() ran inside the booted harness — a real MOUNT, not a composition" "[docker-probe] APPLIED=ok"
else
  record boot.probeApplied false "the probe never applied — the profile did not mount" "$(witness "$BOOT_LOG" 'Error|error|did not activate|Cannot find module' 4)"
fi
# THE WITNESS IS THE ROW'S OWN FILE (R5). BOOT_SERVICE greps the console log the boot was launched
# with, and since R5 no MPD row prints there at all — so the file is the PRIMARY evidence and the
# console grep is kept as the secondary one. The assertion still has to be falsifiable in the other
# direction: a line absent from BOTH witnesses records false, and the raw then names both places.
SERVICE_LOG_LINE="$(row_log_line mpd-dsh-adapter '\[mpd-dsh-adapter\] mpdDsh provided' || true)"
if [ -n "$SERVICE_LOG_LINE" ] || [ -n "$BOOT_SERVICE" ]; then
  record boot.adapterService true "the mpd-dsh-adapter row applied and provided the mpdDsh service — witnessed in the row's OWN file log <workspace>/.mpd/logs/mpd-dsh-adapter.log (R5: MPD diagnostics never touch the terminal)" "${SERVICE_LOG_LINE:-<file log absent>}${BOOT_SERVICE:+ (console witness also present)}"
else
  record boot.adapterService false "the adapter row did not provide mpdDsh in the booted profile: the line is absent from <workspace>/.mpd/logs/mpd-dsh-adapter.log AND from the console log" "console=$(witness "$BOOT_LOG" '\[mpd-dsh-adapter\]|adapter' 2) file-roots=$WORK_DIR,$WORK_DIR/ws"
fi
if [ "$PROBE_CALL" = "ok" ] && [ "$PROBE_SERVICE" = "present" ]; then
  record boot.adapterToolCall true "an internal tool call through the adapter answered ok" "[docker-probe] ADAPTER_TOOL_CALL=ok"
else
  record boot.adapterToolCall false "the adapter tool call did not answer ok (service=${PROBE_SERVICE:-unknown})" "[docker-probe] ADAPTER_TOOL_CALL=${PROBE_CALL:-<absent>}"
fi
if [ -n "$PROBE_CORE" ] && [ -z "$PROBE_CORE_MISSING" ]; then
  record boot.mpdTools true "every core mpd tool answered from the live registry" "CORE_TOOLS=$PROBE_CORE"
else
  record boot.mpdTools false "core mpd tools are missing from the live registry" "CORE_TOOLS=${PROBE_CORE:-<absent>} MISSING=${PROBE_CORE_MISSING:-<absent>}"
fi

# The SERVICE half of the same row set: `mpd-agent-team` mounts @deepseek-ai/dsh-experimental-agent-team,
# whose plugin provides `ctx.agentTeams` (class TeamService). Composition proves nothing here, so the
# probe reads the mounted service from inside the running process and reports its class.
PROBE_TEAM_SVC="$(grep -m1 -oE '\[docker-probe\] AGENT_TEAMS=[A-Z]+ serviceName=[A-Za-z0-9_]+' "$BOOT_LOG" 2>/dev/null || true)"
PROBE_TEAM_METHODS="$(grep -m1 -oE '\[docker-probe\] AGENT_TEAMS_METHODS=.*' "$BOOT_LOG" 2>/dev/null | cut -d= -f2- || true)"
fact bootAgentTeamsMethods "$PROBE_TEAM_METHODS"
if printf '%s' "$PROBE_TEAM_SVC" | grep -q 'AGENT_TEAMS=MOUNTED serviceName=TeamService'; then
  record boot.agentTeamService true "the official TeamService is mounted in the booted process (its class name is the witness)" "$PROBE_TEAM_SVC methods=$PROBE_TEAM_METHODS"
else
  record boot.agentTeamService false "ctx.get(\"agentTeams\") did not answer the official TeamService" "${PROBE_TEAM_SVC:-[docker-probe] AGENT_TEAMS=<no line>}"
fi
# The third row (`mpd-ui-agent-team`) is a browser-discovered plugin: its host half is a no-op apply()
# and the real body is the client bundle, so there is no server-side registration to witness. Say that
# instead of implying a load proof that does not exist, and record the strongest server-side facts.
# WHERE IT RESOLVES: the profile dependency is a `link:` to the checkout, so a bundle-declared
# dependency resolves through the LINK TARGET's node_modules (`<bundle>/node_modules`, the
# `dsh-better-sidebar` pattern) — a missing profile-side copy is the expected shape, not a defect, and
# the observation must not read like one.
UI_PKG=""
UI_PLACE=""
for candidate in "$PROFILE_DIR/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/package.json" \
                 "$APP_DIR/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/package.json"; do
  if [ -f "$candidate" ]; then UI_PKG="$candidate"; break; fi
done
if [ -n "$UI_PKG" ]; then
  case "$UI_PKG" in
    "$PROFILE_DIR"/*) UI_PLACE="profile node_modules" ;;
    *) UI_PLACE="the bundle's own node_modules (resolved through the link: dependency)" ;;
  esac
  UI_PLATFORM="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).dsh?.client?.platform ?? ""))}catch{process.stdout.write("unreadable")}' "$UI_PKG" 2>/dev/null || true)"
  fact obs.uiTeamRow "resolved in $UI_PLACE at $UI_PKG with dsh.client.platform=$UI_PLATFORM; host half is a no-op apply(), so no server-side registration can witness this browser-discovered plugin — its load is witnessed as resolved+composed+no apply failure (boot.noFatalSignatures)"
else
  fact obs.uiTeamRow "package NOT resolvable in the profile OR the bundle's node_modules; only the composed row is evidenced, so this row's load is NOT witnessed by this run"
fi

# HTTP: the Web app really serving is the difference between "the tree mounted" and "the app runs".
# AUTH IS A SIGNED COOKIE, not the query token: the gateway mints it on a root request that carries a
# valid `?token=` and then admits `/api/*` only with that cookie (measured 2026-09-27: a bare POST to
# /api/session/create answered `401 unauthorized` — dsh-client-connection authenticates "the
# authority-bound browser cookie on a Host request"). The cookie jar below does what a browser does.
#
# THE TOKEN LINE RACES THE BOOT, and it must be polled for INSIDE this loop, not extracted once before
# it: `dsh web: http://…?token=…` is printed only after the whole plugin tree is mounted, so a single
# early read yields an EMPTY token, no cookie is minted, and the session step then answers 401 —
# measured as a green run immediately followed by a red one on unchanged instrumentation
# (cookieJarLines 4 -> 0, same tree, 2026-09-27). The 302 is the documented clean-`./` redirect that
# carries Set-Cookie, so it counts as success here too.
COOKIE_JAR="$WORK_DIR/cookies.txt"
: > "$COOKIE_JAR"
TOKEN=""
COOKIE_CODE=""
COOKIE_DEADLINE=$(( $(date +%s) + 120 ))
while [ "$(date +%s)" -lt "$COOKIE_DEADLINE" ]; do
  [ -z "$TOKEN" ] && TOKEN="$(grep -m1 -oE 'token=[A-Za-z0-9._~-]+' "$BOOT_LOG" 2>/dev/null | cut -d= -f2 || true)"
  if [ -n "$TOKEN" ]; then
    COOKIE_CODE="$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null || true)"
    case "$COOKIE_CODE" in 200|302|303) break ;; esac
  fi
  sleep 2
done
COOKIES_MINTED="$(grep -c . "$COOKIE_JAR" 2>/dev/null || true)"
fact bootCookieJarLines "${COOKIES_MINTED:-0}"
fact bootCookieExchange "http=$COOKIE_CODE tokenPresent=$([ -n "$TOKEN" ] && echo yes || echo no)"
# The app really serving, from either route: the bundle-owned plugin route answers without the session
# token, and the token'd root answers 200 once the cookie is presented.
HTTP_CODE=""
HTTP_ROUTE=""
HTTP_DEADLINE=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$HTTP_DEADLINE" ]; do
  HTTP_CODE="$(curl -s -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/plugins/mpd-workmate/list" 2>/dev/null || true)"
  HTTP_ROUTE="/plugins/mpd-workmate/list"
  [ "$HTTP_CODE" = "200" ] && break
  if [ -n "$TOKEN" ]; then
    HTTP_CODE="$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/?token=$TOKEN" 2>/dev/null || true)"
    HTTP_ROUTE="/?token=<token>"
    [ "$HTTP_CODE" = "200" ] && break
  fi
  sleep 2
done
fact bootHttp "$HTTP_ROUTE -> $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  record boot.servesHttp true "the booted Web app answered 200" "$HTTP_ROUTE -> 200"
else
  record boot.servesHttp false "the booted Web app never answered 200 within the budget" "$HTTP_ROUTE -> ${HTTP_CODE:-no-response}"
fi

# THE PRESET MOUNT PROOF. The composed row list (§4) proves nothing about whether the mpd preset's
# rows ACTIVATE; creating a session with `agentPreset: "mpd"` does, because the gateway refuses the
# request when any row of that preset failed to mount. The cwd is a sandbox workspace, never the repo.
# It is ALSO what makes the agent-scoped team tools observable: session creation produces the agent
# whose scope holds them, and docker/probe.ts reports them on `agent/created`.
#
# THE WIRE SHAPE IS AN RPC ENVELOPE, not a bare body: the connection layer accepts
# `{type:"client-request", rpcId, method, payload}` where `method` is the ENDPOINT — the gateway
# answers `method "create" does not match endpoint "session/create"` when it is only the leaf name
# (measured 2026-09-27), and `gateway/bad-request … expected "client-request"` when the envelope is
# missing entirely. The Remote descriptor for
# `@deepseek-ai/dsh-api-session-controller#session/create` declares ONE parameter (`request`, wire
# name `request`) of `{cwd?, agentPreset?, workspaceId?, sessionId?}`.
SESSION_JSON="$WORK_DIR/session-create.json"
mkdir -p "$WORK_DIR/ws"
SESSION_RPC_ID="rpc-$$-$(date +%s)-$RANDOM"
SESSION_BODY="{\"type\":\"client-request\",\"rpcId\":\"$SESSION_RPC_ID\",\"method\":\"session/create\",\"payload\":{\"args\":{\"request\":{\"cwd\":\"$WORK_DIR/ws\",\"agentPreset\":\"mpd\"}}}}"
SESSION_CODE="$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o "$SESSION_JSON" -w '%{http_code}' --max-time 30 -X POST -H 'content-type: application/json' -d "$SESSION_BODY" "http://127.0.0.1:$PORT/api/session/create" 2>/dev/null || true)"
if [ "$SESSION_CODE" != "200" ] && [ -n "$TOKEN" ]; then
  SESSION_CODE="$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o "$SESSION_JSON" -w '%{http_code}' --max-time 30 -X POST -H 'content-type: application/json' -d "$SESSION_BODY" "http://127.0.0.1:$PORT/api/session/create?token=$TOKEN" 2>/dev/null || true)"
fi
SESSION_VERDICT="$(node -e '
  try {
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
    const value = body?.result?.value
    process.stdout.write(String(body?.result?.ok === true) + "|" + String(value?.agentPreset ?? "") + "|" + String(body?.rpcId ?? "") + "|" + String(body?.type ?? ""))
  } catch { process.stdout.write("false|||parse-failed") }
' "$SESSION_JSON" 2>/dev/null || echo "false|||node-failed")"
SESSION_OK="${SESSION_VERDICT%%|*}"
SESSION_REST="${SESSION_VERDICT#*|}"
SESSION_PRESET="${SESSION_REST%%|*}"
SESSION_REST="${SESSION_REST#*|}"
SESSION_RPC_ECHO="${SESSION_REST%%|*}"
SESSION_TYPE="${SESSION_REST#*|}"
SESSION_RAW="$(head -c 300 "$SESSION_JSON" 2>/dev/null | tr '\n' ' ' || true)"
fact obs.sessionCreate "http=$SESSION_CODE type=$SESSION_TYPE rpcIdEcho=$([ "$SESSION_RPC_ECHO" = "$SESSION_RPC_ID" ] && echo match || echo mismatch) ok=$SESSION_OK agentPreset=$SESSION_PRESET"
if [ "$SESSION_OK" = "true" ] && [ "$SESSION_PRESET" = "mpd" ] && [ "$SESSION_RPC_ECHO" = "$SESSION_RPC_ID" ]; then
  record boot.presetMount true "the gateway created a session with agentPreset=mpd — every row of the mpd preset activated (it refuses on an inactive row)" "POST /api/session/create -> $SESSION_RAW"
elif [ "$SESSION_OK" = "true" ]; then
  record boot.presetMount false "session creation answered ok but not for the mpd preset (agentPreset=$SESSION_PRESET, rpcIdEcho=$SESSION_RPC_ECHO)" "$SESSION_RAW"
else
  record boot.presetMount false "the mpd preset did not mount: session creation did not answer ok+agentPreset=mpd (http=$SESSION_CODE; cookieJarLines=${COOKIES_MINTED:-0} cookieHttp=$COOKIE_CODE)" "$SESSION_RAW"
fi

# THE AGENT-SCOPED TEAM TOOLS. `mpd-tool-agent-team` registers spawn_teammate / send_message /
# list_agents / wait_agent / interrupt_agent / team_task_* into ONE EXACT AGENT SCOPE, so this is the
# plane where they exist — the probe prints one line per agent it sees (existing and created).
AGENT_TOOL_LINE=""
AGENT_TOOL_DEADLINE=$(( $(date +%s) + 45 ))
while [ "$(date +%s)" -lt "$AGENT_TOOL_DEADLINE" ]; do
  AGENT_TOOL_LINE="$(grep -m1 -oE '\[docker-probe\] AGENT_TEAM_TOOLS=[0-9]+/[0-9]+ agent=[^ ]*' "$BOOT_LOG" 2>/dev/null || true)"
  [ -n "$AGENT_TOOL_LINE" ] && break
  sleep 2
done
AGENT_TOOL_MISSING="$(grep -m1 -oE '\[docker-probe\] AGENT_TEAM_TOOLS=[0-9]+/[0-9]+ agent=[^ ]*( MISSING=.*)?' "$BOOT_LOG" 2>/dev/null || true)"
fact bootAgentTeamToolsScoped "${AGENT_TOOL_LINE:-<no agent-scoped line>}"
if [ -n "$AGENT_TOOL_LINE" ] && ! printf '%s' "$AGENT_TOOL_MISSING" | grep -q 'MISSING='; then
  record boot.agentTeamTools true "every official agent-team tool answered from an EXACT AGENT SCOPE after session creation (the plane the official plugin registers them in)" "$AGENT_TOOL_LINE"
else
  record boot.agentTeamTools false "the official agent-team tools were not visible in an agent scope" "${AGENT_TOOL_MISSING:-[docker-probe] AGENT_TEAM_TOOLS=<no line>} root-plane=$(grep -m1 -oE 'TEAM_TOOLS_ROOT=[0-9]+/[0-9]+' "$BOOT_LOG" 2>/dev/null || echo 'n/a')"
fi

# THE SESSION-GATE LIVENESS PROOF. `mpd-roles-plugin` mounts the session-start complexity gate per
# qualifying agent and logs one line when the listener is ACTUALLY registered. In v0.10.0 the gate
# was MOUNTED BUT NEVER FIRED (three root causes, fixed for v0.10.1), so "the row composed" was never
# evidence for this contract — only this line is. It is emitted on `agent/created`, i.e. for the agent
# the session created above, which is exactly the session the gate must cover.
#
# TWO PLACES, ONE FACT (R5): `<workspace>/.mpd/logs/mpd-roles.log` is the PRIMARY witness because the
# row writes there by design; the console log is the secondary one, kept so the arm still passes if a
# future host ever routes a row's diagnostics back to the terminal. Both are polled, because the line
# arrives with the created session and neither destination is guaranteed to flush first. A line
# present in NEITHER is recorded false with both places named.
GATE_LINE=""
GATE_LOG_LINE=""
GATE_DEADLINE=$(( $(date +%s) + 45 ))
while [ "$(date +%s)" -lt "$GATE_DEADLINE" ]; do
  GATE_LINE="$(grep -m1 -oE '\[mpd-roles\] session gate listener registered for agent "[^"]*" agentPreset=[A-Za-z0-9_-]+' "$BOOT_LOG" 2>/dev/null || true)"
  GATE_LOG_LINE="$(row_log_line mpd-roles '\[mpd-roles\] session gate listener registered for agent "[^"]*" agentPreset=[A-Za-z0-9_-]+' || true)"
  if [ -n "$GATE_LINE" ] || [ -n "$GATE_LOG_LINE" ]; then break; fi
  sleep 2
done
fact bootSessionGate "${GATE_LOG_LINE:-${GATE_LINE:-<no gate registration line in the row log or on the console>}}"
if printf '%s' "$GATE_LOG_LINE$GATE_LINE" | grep -q 'agentPreset=mpd'; then
  record boot.sessionGateListener true "the mpd session gate listener is REGISTERED for the created session — witnessed in the row's OWN file log <workspace>/.mpd/logs/mpd-roles.log (R5), liveness not composition (the contract that was silently dead in v0.10.0)" "${GATE_LOG_LINE:-<file log absent>}${GATE_LINE:+ (console witness also present)}"
else
  record boot.sessionGateListener false "no '[mpd-roles] session gate listener registered … agentPreset=mpd' line after session creation — absent from <workspace>/.mpd/logs/mpd-roles.log AND from the console log" "${GATE_LOG_LINE:-<no row-log line>} ${GATE_LINE:-<no console line>} warn-lines=$(witness "$BOOT_LOG" 'session-start gate not registered' 2)"
fi

FATAL_LINES="$(grep -cE 'Cannot find module|did not activate|Unhandled|uncaught|is not a function' "$BOOT_LOG" 2>/dev/null || true)"
if [ "${FATAL_LINES:-0}" -eq 0 ]; then
  record boot.noFatalSignatures true "no fatal apply/module signature in the boot log" "0 matches"
else
  record boot.noFatalSignatures false "the boot log carries $FATAL_LINES fatal signature line(s)" "$(witness "$BOOT_LOG" 'Cannot find module|did not activate|Unhandled|uncaught|is not a function' 3)"
fi
BOOT_ENDED="$(date +%s)"
# The boot is a LONG-LIVED app: the driver terminates it once the assertions above are recorded,
# so its process exit status is an artifact of that termination, not of the boot. The step's exit
# column is recorded as -1 for exactly that reason.
append_step "11-boot" -1 "$((BOOT_ENDED - BOOT_STARTED))" "11-boot.log" "dsh --profile web --patch probe.yml --port $PORT --no-open (background; terminated by the harness after the assertions)"

# ── 10b. the mpd TEAM ROUTES, against the REAL mounted bundle ────────────────
# W4 of the team-plane split added four host routes and this is the only place they meet a REAL
# mounted row: `/plugins/mpd-team/{state,plan,task,mail}`. A 404 here would mean the row never
# registered them — a fact no unit arm can produce, because the arms mount the row themselves.
#
# The session id created just above is passed to `/plan`, because a staged plan is keyed by SESSION:
# asking without one is a legitimate empty answer, and asserting on THAT would prove nothing about the
# lookup.
LIVE_SESSION_ID="$(node -e '
  try {
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
    process.stdout.write(String(body?.result?.value?.sessionId ?? body?.result?.value?.id ?? ""))
  } catch { process.stdout.write("") }
' "$SESSION_JSON" 2>/dev/null || true)"
fact teamRoutesSession "${LIVE_SESSION_ID:-none}"
TEAM_ROUTE_OK=0
TEAM_ROUTE_SEEN=""
for ROUTE in state plan task mail; do
  ROUTE_BODY="$WORK_DIR/route-$ROUTE.json"
  ROUTE_URL="http://127.0.0.1:$PORT/plugins/mpd-team/$ROUTE"
  [ "$ROUTE" = "plan" ] && [ -n "$LIVE_SESSION_ID" ] && ROUTE_URL="$ROUTE_URL?sessionId=$LIVE_SESSION_ID"
  ROUTE_CODE="$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o "$ROUTE_BODY" -w '%{http_code}' --max-time 20 "$ROUTE_URL" 2>/dev/null || true)"
  ROUTE_VERDICT="$(node -e '
    try {
      const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
      process.stdout.write(String(body?.ok === true) + "|" + Object.keys(body).filter((k) => k !== "ok").join(","))
    } catch { process.stdout.write("false|unparseable") }
  ' "$ROUTE_BODY" 2>/dev/null || echo "false|node-failed")"
  ROUTE_OK="${ROUTE_VERDICT%%|*}"
  ROUTE_KEYS="${ROUTE_VERDICT#*|}"
  TEAM_ROUTE_SEEN="$TEAM_ROUTE_SEEN $ROUTE=$ROUTE_CODE/$ROUTE_OK"
  if [ "$ROUTE_CODE" = "200" ] && [ "$ROUTE_OK" = "true" ]; then TEAM_ROUTE_OK=$((TEAM_ROUTE_OK + 1)); fi
  record "team.route.$ROUTE" "$([ "$ROUTE_CODE" = "200" ] && [ "$ROUTE_OK" = "true" ] && echo true || echo false)" \
    "the mpd team route answered a JSON payload from a REAL mounted row" "HTTP $ROUTE_CODE keys=$ROUTE_KEYS"
done
fact teamRoutes "$TEAM_ROUTE_SEEN"
record team.routesAll "$([ "$TEAM_ROUTE_OK" = "4" ] && echo true || echo false)" \
  "all four /plugins/mpd-team routes are registered by the mounted row and answer ok:true" "green=$TEAM_ROUTE_OK/4"
# The PLANNED lookup is asserted apart from the count: a route can answer 200 with `plan: null` for a
# session that staged nothing, so the SHAPE is what says the lookup ran rather than the status.
PLAN_SHAPE="$(node -e '
  try {
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
    process.stdout.write(Object.prototype.hasOwnProperty.call(body, "plan") ? (body.plan === null ? "null" : "object") : "missing")
  } catch { process.stdout.write("unreadable") }
' "$WORK_DIR/route-plan.json" 2>/dev/null || echo unreadable)"
record team.planLookup "$([ "$PLAN_SHAPE" = "null" ] || [ "$PLAN_SHAPE" = "object" ] && echo true || echo false)" \
  "the plan route answered a plan SHAPE for the live session (null when nothing is staged, which is the honest pre-approval answer)" "plan=$PLAN_SHAPE session=${LIVE_SESSION_ID:-none}"

# Stop the boot before the isolation checks (a live session writes workspace state).
if kill -0 "$BOOT_PID" 2>/dev/null; then
  kill -TERM "$BOOT_PID" 2>/dev/null || true
  sleep 2
  kill -KILL "$BOOT_PID" 2>/dev/null || true
  wait "$BOOT_PID" 2>/dev/null || true
fi
BOOT_PID=""

# ── 11. isolation: the real home was never touched, no credentials anywhere ───
log ""
log "----- isolation -----"
if [ "$HOME" = "$SANDBOX_HOME" ] && [ "$DSH_HOME" = "$SANDBOX_DSH" ] && [ -d "$SANDBOX_HOME" ] && [ -d "$SANDBOX_DSH" ]; then
  record isolation.home true "HOME and DSH_HOME stay on the sandbox paths for every harness command" "HOME=$HOME DSH_HOME=$DSH_HOME"
else
  record isolation.home false "isolated HOME/DSH_HOME not in force" "HOME=$HOME DSH_HOME=$DSH_HOME"
fi
REAL_TOUCHED=""
for marker in "${REAL_HOME_MARKERS[@]}"; do
  [ -e "$REAL_HOME/$marker" ] && REAL_TOUCHED="$REAL_TOUCHED$REAL_HOME/$marker,"
done
fact obs.realHomeMarkers "$(ls -A "$REAL_HOME" 2>/dev/null | tr '\n' ',' || echo '<unreadable>')"
if [ -z "$REAL_TOUCHED" ]; then
  record isolation.realHome true "no harness/toolchain marker under the real home ($REAL_HOME)" "absent: ${REAL_HOME_MARKERS[*]}"
else
  record isolation.realHome false "the real home was written to" "$REAL_TOUCHED"
fi
# A FILENAME is not credential material. The first run's naive `-name '*credential*'` scan flagged
# (a) the repository's own QA helper `skills/dsh-qa/scripts/lib/credentials.ts` and (b) the EMPTY
# `.credentials.yaml` the harness materializes in the sandbox home — neither is a secret, and a check
# that reddens on those is a check nobody can trust (measured 2026-09-27). So: inventory every
# credential-shaped file with its size, and judge only CONTENT — a non-empty secret-shaped value.
CRED_INVENTORY=""
CRED_MATERIAL=""
while IFS= read -r file; do
  [ -n "$file" ] || continue
  size="$(stat -c '%s' "$file" 2>/dev/null || echo 0)"
  CRED_INVENTORY="$CRED_INVENTORY$(basename "$file")(${size}B),"
  if [ "${size:-0}" != "0" ] && grep -qE '(_authToken|apiKey|api_key)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9_/+-]{12,}|sk-[A-Za-z0-9_-]{16,}' "$file" 2>/dev/null; then
    CRED_MATERIAL="$CRED_MATERIAL$file,"
  fi
done < <(find "$SANDBOX_DSH" "$SANDBOX_HOME" -maxdepth 4 -type f \( -name '*credential*' -o -name 'settings.yaml' -o -name '.npmrc' -o -name 'auth.json' \) 2>/dev/null | head -n 20)
fact obs.credentialFiles "${CRED_INVENTORY:-none} (sizes only; the CONTENT of a credential-shaped file is deliberately never copied into the evidence — the check is a secret-shape match, not a dump)"
if [ -z "$CRED_MATERIAL" ]; then
  record isolation.noCredentials true "no credential file carries a secret-shaped value, and nothing was staged into the container in the first place (the empty .credentials.yaml the harness materializes in the SANDBOX home is expected)" "inventory=${CRED_INVENTORY:-none}"
else
  record isolation.noCredentials false "a credential file carries a secret-shaped value (AGENTS.md §10)" "$CRED_MATERIAL"
fi

# ── 12. the DSH-TUI edition: the profile a developer host cannot exercise ─────
# The TUI host must be installed from npm and booted on a REAL PTY, and this machine's
# sandbox cannot write a global npm prefix — so the container is the only place the TUI
# profile can be exercised end to end. docker/tui-lane.sh records its own verdicts; a
# missing tmux or a failed boot lands as `false`, never as a silent skip.
log "===== STEP 12-tui ====="
# `|| TUI_STEP=$?` rather than `set +e`: the ERR trap fires on a bare non-zero command even
# with errexit off, so a plain `set +e` around a step that is EXPECTED to be allowed to
# fail would abort the whole run (measured 2026-09-27: the TUI step returned non-zero and
# the trap turned it into "unexpected shell failure", hiding the step's own log).
TUI_STEP=0
# The lane is a SEPARATE process: every path it needs is passed explicitly, because a
# shell variable is not inherited by a child unless it is exported (measured 2026-09-27:
# "STATE_FILE: parameter null or not set" at the lane's first line).
STATE_FILE="$STATE_FILE" FACTS_FILE="$FACTS_FILE" APP_DIR="$APP_DIR" WORK_DIR="$WORK_DIR" \
  TUI_VERSION="$TUI_VERSION" DSH_HOME="$DSH_HOME" HOME="$HOME" PATH="$PATH" \
  OUT_DIR="$OUT_DIR" \
  npm_config_cache="${npm_config_cache:-$HOME/.npm}" \
  bash /opt/mpd-e2e/tui-lane.sh >"$STEPS_DIR/12-tui.log" 2>&1 || TUI_STEP=$?
cat "$STEPS_DIR/12-tui.log" || true
append_step 12-tui "$TUI_STEP" 0 "12-tui.log" "bash docker/tui-lane.sh"

# ── 13. a LIVE LLM turn, when the caller stages a key (opt-in) ────────────────
# THE CREDENTIAL IS NEVER LOGGED OR ECHOED (AGENTS.md §10). The caller forwards it with
# `docker compose run -e DEEPSEEK_API_KEY` — the NAME only, so the value never reaches this
# script's argv or any log line — and it is written straight into the sandbox credentials
# document, which the harness reads as `refs:`. When it is absent the assertion stays the NULL
# it has always been: a credential-free run is the maximum this lane can claim, not a failure.
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  LIVECRED="$DSH_HOME/.credentials.yaml"
  mkdir -p "$DSH_HOME"
  # `version: 1` AND the nested `refs:` mapping: the harness's credential reader REFUSES the
  # pre-release flat layout by name ("uses the pre-release flat layout. Add `version: 1` and nest the
  # existing 1 entry under `refs:`") — measured on the first live attempt, which then had no
  # credentials at all and every dependent row reported `pending (waiting for service: credentials)`.
  { printf 'version: 1\n'; printf 'refs:\n'; printf '  DEEPSEEK_API_KEY: %s\n' "$DEEPSEEK_API_KEY"; } > "$LIVECRED"
  chmod 600 "$LIVECRED"
  fact liveCredentialStaged "refs:DEEPSEEK_API_KEY written to the SANDBOX home (mode 0600); the value is never recorded"

  # ── the task: exercise THIS WAVE's plane end to end, in one turn ────────────
  # A staged plan and its approval are the two steps the team-plane split rebuilt: `approve`
  # materialises the mpd RECORD and raises the member through the NATIVE executor
  # (`ctx.subagents.startContinuable`), which is the whole point of W2.
  LIVE_PROMPT="Use the agent_teams_plan tool twice: first with action \"create\" (name it live-smoke, description \"docker live turn\"), then action \"add_member\" for a member named Reviewer, then action \"create_task\" with subject \"check the mount\". Finally call agent_teams_plan with action \"approve\". Then reply with the single word DONE."
  LIVE_LOG="$STEPS_DIR/13-live.log"
  LIVE_CODE=0
  # THE BUNDLE MUST BE INSTALLED INTO THE PROFILE THE TURN RUNS UNDER, and that is not optional:
  # `--profile headless` alone composes the harness's BASE headless tree, which registers NOTHING of
  # ours. Measured on the first live attempt: the model listed its own tools (bash, create_goal, edit,
  # … read, write) and `agent_teams_plan` was not among them, so it correctly refused to invent a call.
  #
  # A `--patch <installed bundle>` operand does NOT fix that, and the reason is worth writing down:
  # every path-bearing value in the patch resolves through the loader's baseUrl, which is the PROFILE
  # directory — so patching the web profile's copy into a headless run made the loader look for
  # `profiles/headless/node_modules/@mpd-dsh/mpd/packages/mpd-mcp-codegraph/launch.ts` and die with
  # MODULE_NOT_FOUND. Installing the bundle INTO the headless profile is the one-command fix.
  dsh plugin --profile headless add "$APP_DIR" >"$STEPS_DIR/13-live-install.log" 2>&1 || true
  ( cd "$WORK_DIR/ws" && DSH_HOME="$DSH_HOME" HOME="$HOME" PATH="$PATH" dsh --profile headless "$LIVE_PROMPT" ) >"$LIVE_LOG" 2>&1 || LIVE_CODE=$?
  append_step 13-live "$LIVE_CODE" 0 "13-live.log" "dsh --profile headless <team-plane live prompt>"

  # ── the assertion is a REAL ARTIFACT, never the model's prose (§7) ──────────
  # The mpd record is materialised AT approval and carries an `executorRef` for every member the
  # native executor actually raised, so a record on disk with a non-empty handle is a fact only a
  # real tool call could have produced.
  # `-print -quit` instead of `| head -1`: the script runs under `set -o pipefail`, and a `find` whose
  # reader exits after one line takes SIGPIPE — which pipefail turns into a non-zero pipeline and `set
  # -e` turns into an abort. Measured: this line killed the run at `find` and every assertion after it
  # was reported "not reached".
  LIVETEAMS="$(find "$WORK_DIR/ws/.mpd/team/teams" -name '*.json' -type f -print -quit 2>/dev/null || true)"
  if [ -n "$LIVETEAMS" ]; then
    LIVE_MEMBERS="$(node -e 'const d=require(process.argv[1]);const m=(d.members||[]).filter(x=>typeof x.executorRef==="string"&&x.executorRef!=="");console.log(m.length+"/"+(d.members||[]).length)' "$LIVETEAMS" 2>/dev/null || echo "?")"
    LIVE_PHASE="$(node -e 'console.log(require(process.argv[1]).phase||"?")' "$LIVETEAMS" 2>/dev/null || echo "?")"
    record boot.llmTurn true \
      "a live headless turn ran and the team plane committed: the mpd record exists with phase=$LIVE_PHASE and $LIVE_MEMBERS member(s) carrying an executor handle" \
      "tool=agent_teams_plan action=approve"
    record live.teamRecord true "the mpd team record exists after a REAL approval" "file=$(basename "$LIVETEAMS") phase=$LIVE_PHASE"
    record live.nativeExecutor "$([ "${LIVE_MEMBERS%%/*}" != "0" ] && echo true || echo false)" \
      "a member carries an executorRef, i.e. the NATIVE executor raised it through ctx.subagents" "members-with-handle=$LIVE_MEMBERS"
  else
    record boot.llmTurn false \
      "the live turn ran but committed no team record — the model did not reach agent_teams_plan approve (exit $LIVE_CODE)" \
      "see 13-live.log"
  fi
  rm -f "$LIVECRED"
else
  record boot.llmTurn null \
    "not attempted: a live LLM turn needs provider credentials and this container stages none (AGENTS.md §10). The mount assertions above are the credential-free maximum." \
    "no credentials staged by design"
fi

# ── 14. pin the state the run measured (§7: quote a hash with its measurement moment) ──
{
  sha256sum "$APP_DIR/package.json" "$APP_DIR/cordis.patch.yml" 2>/dev/null || true
  [ -f "$APP_DIR/presets/mpd.patch.yml" ] && sha256sum "$APP_DIR/presets/mpd.patch.yml" || true
  find "$APP_DIR/packages" -path '*/dist/index.js' -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sed "s#$APP_DIR/##" || true
} > "$HASHES_FILE"
fact hashesMeasuredAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

finish
