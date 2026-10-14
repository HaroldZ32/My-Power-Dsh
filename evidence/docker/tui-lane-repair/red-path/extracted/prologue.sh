json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/ }"; s="${s//$'\r'/ }"; s="${s//$'\t'/ }"
  printf '%s' "$s"
}
record() {
  local name="$1" status="$2" reason="${3:-}" raw="${4:-}"
  case "$status" in true|false|null) ;; *) reason="invalid status ${status} refused; ${reason}"; status="null" ;; esac
  printf '{"name":"%s","ok":%s,"reason":"%s","raw":"%s"}\n' \
    "$(json_escape "$name")" "$status" "$(json_escape "$reason")" "$(json_escape "$raw")" >> "$STATE_FILE"
  printf '[record] %s=%s%s\n' "$name" "$status" "${reason:+ — $reason}"
}

# Every failure path must LEAVE A RECORD: a crash that writes nothing would read as "not
# reached" in the report and hide which assertion died. `on_err` restates the failing line
# and exits non-zero, and the entrypoint copies this step's own log into the evidence.
#
# THE ERR TRAP ALONE IS NOT ENOUGH — MEASURED 2026-10-06 in this lane: a `set -u` unbound-variable
# abort (`MERGED_TITLE_HITS: unbound variable`) exited the script WITHOUT running `on_err`, so seven
# arms were reported "not reached" and the driver still printed `ok=true` (evidence
# `evidence/docker/client-install/2026-10-06T11-11-30Z`). That is a false pass, so the EXIT trap below
# is the second net: it leaves the record for any non-zero exit the ERR trap did not already record.
#
# AND THE SECOND NET MUST NOT FIRE ON THE LANE'S OWN RED ENDING — MEASURED 2026-10-08, the mirror image
# of the defect above: the lane performed its whole duty, wrote its last record
# (`tui.laneExit false "the TUI lane finished with failing or missing assertions"`) and then exited 1,
# which fired the EXIT net and published a SECOND, FALSE record claiming the lane aborted and that every
# arm after that point reads as "not reached" (`evidence/docker/client-install/2026-10-08T08-52-23Z/`
# `console.log:3193-3194`, raw at `:3210`). A red run was therefore DOUBLE-reported, and the false
# reading is the one that says a finished run never finished. `LANE_EXIT_RECORDED` is the ONE predicate
# both nets read — it means "this exit already carries a `tui.laneExit` record" — so the terminal red
# path sets it BEFORE exiting, exactly as `on_err` does, and the net keeps firing for the exit NOBODY
# recorded: the ERR trap, or an exit the lane did not itself request.
LANE_EXIT_RECORDED=0
on_err() {
  local code=$?
  LANE_EXIT_RECORDED=1
  record tui.laneExit false "the TUI lane aborted (exit $code) — see this step's log; earlier tui.* records are the assertions that had already run" "line=${BASH_LINENO[0]:-$LINENO}"
  exit "$code"
}
trap 'on_err' ERR
on_exit() {
  local code=$?
  if [ "$code" != "0" ] && [ "$LANE_EXIT_RECORDED" = "0" ]; then
    record tui.laneExit false "the TUI lane exited with $code without the ERR trap seeing it (an immediate abort such as a set -u unbound variable) — earlier tui.* records are the assertions that had already run, and every arm after this point reads as 'not reached'" "abort=exit-$code net=EXIT-trap"
  fi
}
trap 'on_exit' EXIT
