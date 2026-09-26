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
#      registration instrumentation (docker/probe.mjs) reading the live tool registry.
#
# WHAT IT DELIBERATELY DOES NOT DO: no credential is copied in, read, or written (AGENTS.md §10),
# so no live LLM turn is attempted. That assertion is recorded as `null` WITH ITS REASON rather
# than faked — see docker/README.md.
#
# Every assertion is recorded through docker/lib/record.mjs (argv -> JSON.stringify, so a raw
# witness line survives quoting intact) and the verdict is assembled by docker/lib/report.mjs,
# which emits every assertion the run never reached as `null` + "not reached". A partial run
# therefore still produces a complete, honest result.json.
set -euo pipefail

# ── paths and pins ────────────────────────────────────────────────────────────
SRC_DIR="${MPD_E2E_SRC_DIR:-/src}"
APP_DIR="${MPD_E2E_APP:-/opt/mpd}"
WORK_DIR="${MPD_E2E_WORK:-/work}"
OUT_DIR="${MPD_E2E_OUT:-/out}"
LIB_DIR="${MPD_E2E_LIB:-/opt/mpd-e2e/lib}"
PROBE_SRC="${MPD_E2E_PROBE:-/opt/mpd-e2e/probe.mjs}"
TOOLCHAIN_DIR="${MPD_E2E_TOOLCHAIN:-/opt/toolchain}"
IMAGE="${MPD_E2E_IMAGE:-mpd-docker-e2e:local}"

NODE_VERSION="${MPD_E2E_NODE_VERSION:-24.19.0}"
DSH_VERSION="${MPD_E2E_DSH_VERSION:-0.1.7-rc.2}"
PNPM_VERSION="${MPD_E2E_PNPM_VERSION:-11.23.0}"
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
# docker/lib/report.mjs parses it and turns a corrupt line into a FAILED assertion rather than
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
    printf '  "reporter": "bash fallback: node was never installed, so docker/lib/report.mjs could not run",\n'
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
    node "$LIB_DIR/report.mjs" --work "$WORK_DIR" --out "$OUT_DIR" --image "$IMAGE" --started "$STARTED_EPOCH" || code=$?
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
log "pins         : node=$NODE_VERSION dsh=$DSH_VERSION pnpm=$PNPM_VERSION"

fact stamp "$STAMP"
fact entrypoint "docker/entrypoint.sh"
fact image "$IMAGE"
fact ubuntuImage "$(. /etc/os-release; printf '%s %s (%s)' "$ID" "$VERSION_ID" "$PRETTY_NAME")"
fact pins "node=$NODE_VERSION dsh=$DSH_VERSION pnpm=$PNPM_VERSION"
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
  curl git ca-certificates unzip xz-utils
APT_INSTALL=$STEP_CODE
fact aptSeconds "$(awk -F'\t' '$1 ~ /^01-apt/ {s+=$3} END {print s+0}' "$STEPS_INDEX" 2>/dev/null || echo "?")"
if [ "$APT_UPDATE" -eq 0 ] && [ "$APT_INSTALL" -eq 0 ]; then
  record toolchain.apt true "apt-get update + install curl git ca-certificates unzip xz-utils" "exit=$APT_UPDATE/$APT_INSTALL"
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
run_step 02-node bash -c '
set -euo pipefail
V="$1"; A="$2"
cd /tmp
curl -fsSLO "https://nodejs.org/dist/v${V}/node-v${V}-linux-${A}.tar.xz"
curl -fsSL -o SHASUMS256.txt "https://nodejs.org/dist/v${V}/SHASUMS256.txt"
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
[ -n "$NODE_V" ] || bail "node is not on PATH after the tarball install"

# ── 04. bun (official install script, into the toolchain dir) ─────────────────
log ""
log "----- bun (official install script) -----"
run_step 03-bun bash -c 'set -euo pipefail; curl -fsSL https://bun.sh/install | bash'
ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun
BUN_V="$(bun --version 2>/dev/null || true)"
fact bun "$BUN_V (BUN_INSTALL=$BUN_INSTALL)"
case "$BUN_V" in
  1.*) record toolchain.bun true "bun installed by the official script and asserted on PATH" "$BUN_V" ;;
  *) record toolchain.bun false "bun did not install / did not report a 1.x version" "$BUN_V" ;;
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
for marker in node_modules .git evidence .toolchain dist .qa-recon; do
  [ -e "$SRC_DIR/$marker" ] && CONTEXT_LEAK="$CONTEXT_LEAK$marker,"
done
NESTED_DEPS="$(find "$SRC_DIR" -mindepth 2 -maxdepth 4 -name node_modules -type d 2>/dev/null | head -n 3 | tr '\n' ',' || true)"
CONTEXT_LEAK="$CONTEXT_LEAK$NESTED_DEPS"
if [ -z "$CONTEXT_LEAK" ]; then
  record copy.contextFiltered true "the build context carries no host state, so nothing can pass for a dependency the container should have installed" "absent: node_modules .git evidence .toolchain dist"
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

log ""
log "----- bun install -----"
run_step 07-bun-install bash -c "cd '$APP_DIR' && bun install"
if [ "$STEP_CODE" -eq 0 ]; then
  record build.bunInstall true "bun install resolved the workspace and the dev/optional dependencies" "exit=0"
else
  record build.bunInstall false "bun install failed (exit=$STEP_CODE)" "$(witness "$STEPS_DIR/07-bun-install.log" 'error|Error|failed' 3)"
fi

log ""
log "----- rebuild every packages/*/dist from source (canonical repo-root bun build) -----"
run_step 08-rebuild node "$LIB_DIR/rebuild.mjs" --repo "$APP_DIR" --json "$WORK_DIR/rebuild.json"
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

# ── 08. the REAL client install: one command from the checkout ────────────────
log ""
log "----- dsh plugin --profile web add . (the whole install) -----"
run_step 09-install bash -c "cd '$APP_DIR' && dsh plugin --profile web add ."
INSTALL_CODE=$STEP_CODE
fact obs.installTail "$(tail -n 4 "$STEPS_DIR/09-install.log" 2>/dev/null | tr '\n' ' ')"
if [ "$INSTALL_CODE" -ne 0 ]; then
  record install.exit false "'dsh plugin --profile web add .' exited $INSTALL_CODE" "$(witness "$STEPS_DIR/09-install.log" 'ERR_|error|Error|not found' 3)"
  bail "the client install failed — nothing downstream can be asserted"
fi
record install.exit true "one command installed the bundle into the profile" "exit=0"

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
case "$INSTALL_DEP" in
  link:*|file:*)
    if printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@mpd-dsh/mpd,' \
      && printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@deepseek-ai/dsh-base,' \
      && printf '%s' ",$INSTALL_BUNDLES," | grep -q ',@deepseek-ai/dsh-web-app,'; then
      record install.profileDep true "the profile links the checkout and keeps the box bundles" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    else
      record install.profileDep false "the bundle layer or a box bundle is missing from dsh.profile.bundles" "dep=$INSTALL_DEP bundles=$INSTALL_BUNDLES"
    fi
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

# ── 09. COMPOSITION: what the profile composes (never a load proof, AGENTS.md §4) ──
log ""
log "----- COMPOSITION ONLY: dsh --profile web --dump-config -----"
if [ -f "$APP_DIR/scripts/dump-config.mjs" ]; then
  run_step 10-dump node "$APP_DIR/scripts/dump-config.mjs" --profile web
else
  log "[warn] the repository wrapper scripts/dump-config.mjs is missing; falling back to the raw flag"
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
fact obs.dumpDefaultMpdLines "$DEFAULT_MPD"
if [ -z "$MISSING_ROWS" ] && [ "${DEFAULT_MPD:-0}" -ge 1 ]; then
  record compose.mpdRows true "the mpd host rows compose and the default preset selection is mpd" "rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate default: mpd x$DEFAULT_MPD"
else
  record compose.mpdRows false "composed rows missing: ${MISSING_ROWS:-none}; 'default: mpd' lines: $DEFAULT_MPD" "$(witness "$DUMP_TXT" '^- id: mpd-' 6)"
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
# The official team tools are AGENT-scoped (see docker/probe.mjs), so the root-plane read is an
# OBSERVATION that the plane is what we think it is — the graded read happens after a real agent
# exists, further down.
fact obs.teamToolPlane "root-plane read=$PROBE_TEAM_ROOT (0/9 is the documented shape: @deepseek-ai/dsh-experimental-tool-agent-team registers scoped.tools on agent.ctx per agent); the graded read is AGENT_TEAM_TOOLS below"

if [ -n "$BOOT_APPLIED" ] && [ -n "$BOOT_DONE" ]; then
  record boot.probeApplied true "the probe plugin's apply() ran inside the booted harness — a real MOUNT, not a composition" "[docker-probe] APPLIED=ok"
else
  record boot.probeApplied false "the probe never applied — the profile did not mount" "$(witness "$BOOT_LOG" 'Error|error|did not activate|Cannot find module' 4)"
fi
if [ -n "$BOOT_SERVICE" ]; then
  record boot.adapterService true "the mpd-dsh-adapter row applied and provided the mpdDsh service" "[mpd-dsh-adapter] mpdDsh provided"
else
  record boot.adapterService false "the adapter row did not provide mpdDsh in the booted profile" "$(witness "$BOOT_LOG" '\[mpd-dsh-adapter\]|adapter' 4)"
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
# whose scope holds them, and docker/probe.mjs reports them on `agent/created`.
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
# qualifying agent and prints one line when the listener is ACTUALLY registered. In v0.10.0 the gate
# was MOUNTED BUT NEVER FIRED (three root causes, fixed for v0.10.1), so "the row composed" was never
# evidence for this contract — only this line is. It is emitted on `agent/created`, i.e. for the agent
# the session created above, which is exactly the session the gate must cover.
GATE_LINE=""
GATE_DEADLINE=$(( $(date +%s) + 45 ))
while [ "$(date +%s)" -lt "$GATE_DEADLINE" ]; do
  GATE_LINE="$(grep -m1 -oE '\[mpd-roles\] session gate listener registered for agent "[^"]*" agentPreset=[A-Za-z0-9_-]+' "$BOOT_LOG" 2>/dev/null || true)"
  [ -n "$GATE_LINE" ] && break
  sleep 2
done
fact bootSessionGate "${GATE_LINE:-<no gate registration line>}"
if printf '%s' "$GATE_LINE" | grep -q 'agentPreset=mpd'; then
  record boot.sessionGateListener true "the mpd session gate listener is REGISTERED for the created session — liveness, not composition (the contract that was silently dead in v0.10.0)" "$GATE_LINE"
else
  record boot.sessionGateListener false "no '[mpd-roles] session gate listener registered … agentPreset=mpd' line after session creation" "${GATE_LINE:-<absent>} warn-lines=$(witness "$BOOT_LOG" 'session-start gate not registered' 2)"
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
# (a) the repository's own QA helper `skills/dsh-qa/scripts/lib/credentials.mjs` and (b) the EMPTY
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

# ── 12. the assertion that cannot be made here, stated instead of faked ───────
record boot.llmTurn null \
  "not attempted: a live LLM turn needs provider credentials and this container stages none (AGENTS.md §10). The mount assertions above are the credential-free maximum." \
  "no credentials staged by design"

# ── 13. pin the state the run measured (§7: quote a hash with its measurement moment) ──
{
  sha256sum "$APP_DIR/package.json" "$APP_DIR/packages/mpd-bundle/cordis.patch.yml" 2>/dev/null || true
  [ -f "$APP_DIR/presets/mpd.patch.yml" ] && sha256sum "$APP_DIR/presets/mpd.patch.yml" || true
  find "$APP_DIR/packages" -path '*/dist/index.js' -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum 2>/dev/null | sed "s#$APP_DIR/##" || true
} > "$HASHES_FILE"
fact hashesMeasuredAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

finish
