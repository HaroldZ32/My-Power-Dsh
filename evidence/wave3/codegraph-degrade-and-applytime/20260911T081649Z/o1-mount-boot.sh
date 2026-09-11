#!/usr/bin/env bash
# Wave-3 t4 evidence: real dsh MOUNT boots (isolated DSH_HOME + sandbox HOME) for
# the O-1 apply-time root, plus the mounting-boot gate (0 apply-crash signatures).
#
# Two boots, same bundle, same sandbox, web profile (a SERVING profile, so the
# MCP rows really spawn and their stderr lands in the log):
#   boot-1 "session-root": DSH_WORKSPACE_ROOT=<session ws>  != process cwd
#          -> the apply-time line must name the SESSION workspace.
#   boot-2 "no-override" : DSH_WORKSPACE_ROOT unset
#          -> the documented last tier: process.cwd().
#
# F-B8-1 (the uncaught-throw degradation) is proven by its own harness
# degrade-launcher.mjs, which drives the real MCP child process against the
# genuinely read-only $HOME/.mdp of this sandbox. Booting an unwritable $HOME/.mdp
# here would require writing to the real home, so this script only records the
# child's behaviour (no uncaught error) as a mount-health check.
#
# This is a MOUNT boot: rows execute. No --dump-config result is cited as load evidence.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
[ -d "$REPO/.git" ] || { echo "FATAL: not the repo root: $REPO" >&2; exit 1; }

RUN="$HERE/boot-run"
rm -rf "$RUN"
mkdir -p "$RUN/project" "$RUN/session-ws/.codegraph" "$RUN/home/.mdp" "$RUN/dsh/store" "$RUN/dsh/profiles/mpd"
: > "$RUN/session-ws/.codegraph/codegraph.db"
PORT=3211

# The boot runs the REAL mcp-codegraph row (the bundle-relative launcher), so the
# mount health reported here is the shipped path; F-B8-1's unresolvable-binary arm
# lives in degrade-launcher.mjs.

SB_DSH="$RUN/dsh"
SB_HOME="$RUN/home"
for f in .credentials.yaml settings.yaml; do [ -f "$HOME/.dsh/$f" ] && cp "$HOME/.dsh/$f" "$SB_HOME/$f"; done

LOG="$HERE/o1-boot.log"
: > "$LOG"
{
  echo "=== wave-3 t4 O-1 mount boots ==="
  echo "repo=$REPO"
  echo "HEAD=$(git -C "$REPO" rev-parse HEAD)"
  echo "date=$(date -u +%FT%TZ)"
  echo "sandbox DSH_HOME=$SB_DSH"
  echo "sandbox HOME=$SB_HOME"
  echo "process cwd of both boots = $RUN/project (session workspace = $RUN/session-ws)"
  echo "MPD_DSH_CODEGRAPH_CLI is NOT set: the real mcp-codegraph row (bundle-relative launcher) is exercised"
  echo "web port=$PORT; each boot waits for the codegraph MCP child line, then is stopped"
  echo
} >> "$LOG"

# Explicit profile manifest (the bundle-lifecycle pattern): the bundle patch is a
# layer of @mpd-dsh/mpd, and the box bundles come from the manifest layer list.
printf '{"name":"dsh-profile-mpd","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}\n' > "$SB_DSH/profiles/mpd/package.json"
env HOME="$SB_HOME" DSH_HOME="$SB_DSH" dsh plugin --profile mpd add --store-dir "$SB_DSH/store" "$REPO" > "$HERE/install.log" 2>&1
echo "[exit=$?] dsh plugin --profile mpd add --store-dir <sb> <repo>" >> "$LOG"

boot() { # $1 = label, $2.. = extra env assignments
  local label="$1"; shift
  local log="$HERE/boot-$label.log"
  (
    cd "$RUN/project" || exit 1
    exec env HOME="$SB_HOME" DSH_HOME="$SB_DSH" \
      "$@" \
      timeout 120 dsh --profile mpd --port "$PORT" --no-open > "$log" 2>&1
  ) &
  local pid=$!
  local deadline=$((SECONDS + 60))
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
    grep -qE "\[CodeGraph MCP\]|CodeGraph MCP skipped" "$log" 2>/dev/null && break
    sleep 1
  done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  sleep 1
  # The web boot prints its local access URL; the token is a credential and must
  # never land in evidence.
  sed -i -E 's/([?&]token=)[A-Za-z0-9_.-]+/\1<redacted>/g' "$log"
  echo "[$label] stopped after $(grep -c "" "$log") log lines (the child line, when emitted, is the wait condition)" >> "$LOG"
}

boot session-root "DSH_WORKSPACE_ROOT=$RUN/session-ws"
boot no-override

EV="$HERE" RUN="$RUN" python3 - <<'PY' >> "$LOG" 2>&1
import json, os, re

ev, run = os.environ["EV"], os.environ["RUN"]
session_ws = os.path.join(run, "session-ws")
process_cwd = os.path.join(run, "project")

def read(label):
    return open(os.path.join(ev, f"boot-{label}.log"), encoding="utf-8", errors="replace").read()

def apply_line(text):
    m = re.search(r"\[mpd-codegraph\] init status=(\S+) binary=(\S+) cwd=(\S+)", text)
    return (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)

crash = r"unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry"
with_root, no_root = read("session-root"), read("no-override")
status1, bin1, cwd1 = apply_line(with_root)
status2, bin2, cwd2 = apply_line(no_root)

res = {
    "proof": "real dsh MOUNT boots (isolated DSH_HOME + sandbox HOME, web profile); no --dump-config cited",
    "boot_with_session_root": {
        "apply_line_cwd": cwd1,
        "session_workspace": session_ws,
        "process_cwd": process_cwd,
        "session_differs_from_process_cwd": session_ws != process_cwd,
        "ok": cwd1 == session_ws and cwd1 != process_cwd,
        "status": status1,
    },
    "boot_without_override": {
        "apply_line_cwd": cwd2,
        "expected_fallback_process_cwd": process_cwd,
        "ok": cwd2 == process_cwd,
        "status": status2,
    },
    "mount": {
        "apply_crash_signatures": len(re.findall(crash, with_root)) + len(re.findall(crash, no_root)),
        "mcp_child_observed": bool(re.search(r"\[CodeGraph MCP\]|CodeGraph MCP skipped", with_root)),
        "child_uncaught_error": bool(re.search(r"ENOTDIR|uncaughtException|Uncaught", with_root)),
        "note": "the MCP child line is INFORMATIONAL: the MCP client spawns its servers asynchronously and may not emit it inside the boot window; F-B8-1's throw/degrade pair is proven by degrade-launcher.mjs",
    },
}
res["ok"] = (res["boot_with_session_root"]["ok"] and res["boot_without_override"]["ok"]
             and res["mount"]["apply_crash_signatures"] == 0
             and not res["mount"]["child_uncaught_error"])
open(os.path.join(ev, "o1-boot.result.json"), "w").write(json.dumps(res, indent=2) + "\n")
print(json.dumps(res, indent=2))
PY
echo "DONE" >> "$LOG"
# The boot needs copied credentials to start; they must never survive in evidence
# or in any sandbox HOME. Remove the whole sandbox (all logs live outside it).
rm -rf "$RUN"
exit 0
