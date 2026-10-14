#!/usr/bin/env bash
# f1-arms.sh — offline arms for FINDING F1 (`ui.replyRendered` greened without a reply).
#
# Runs no Docker, no browser and no network. It proves:
#   arm 1  the shared classifier's self-test: 9 arms, every one of them passing, exit 0 (and its own
#          negative control — the PRE-FIX predicate must still green on both fixtures this module refuses);
#   arm 2  the browser lane still LOADS with its new import, from a COPIED pair exactly as the container
#          stages it (`$LIB_DIR` -> `$UI_DIR`, a different cwd), and records `ui.replyRendered` as `null`;
#   arm 3  the negative control: with that module missing, the lane fails to load — so the entrypoint's
#          new `cp` line is load-bearing and this arm is falsifiable;
#   arm 4  the pre-fix predicate is GONE from the lane (no `/\bDONE\b/` reply test, no length-growth test).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO" || exit 2
HERE="evidence/tui/dsh-tui-015/docker-repair2"
FAILED=0

echo "=== arm 1: node docker/lib/reply-verdict.ts --self-test ==="
node docker/lib/reply-verdict.ts --self-test | tail -n 4
if node docker/lib/reply-verdict.ts --self-test >/dev/null 2>&1; then echo "  OK exit 0"; else echo "  FAIL exit non-zero"; FAILED=1; fi

echo
echo "=== arm 2: the lane loads from a COPIED pair (the container's own layout) ==="
SANDBOX="$(mktemp -d)"
mkdir -p "$SANDBOX/ui" "$SANDBOX/out"
cp docker/lib/browser-lane.ts docker/lib/reply-verdict.ts "$SANDBOX/ui/" || FAILED=1
echo "  copied: $(ls "$SANDBOX/ui" | tr '\n' ' ')"
LANE_OUT="$(cd "$SANDBOX" && node "$SANDBOX/ui/browser-lane.ts" --state "$SANDBOX/assertions.ndjson" --out "$SANDBOX/out" \
  --unavailable "not attempted: offline arm, no container" 2>&1)"
LANE_CODE=$?
echo "$LANE_OUT" | sed 's/^/  /'
echo "  lane exit=$LANE_CODE"
case "$LANE_OUT" in
  *"ui.replyRendered=null"*) echo "  OK: the lane loaded and recorded ui.replyRendered as null" ;;
  *) echo "  FAIL: the lane did not record ui.replyRendered"; FAILED=1 ;;
esac
if [ "$LANE_CODE" = "0" ]; then echo "  OK: exit 0"; else echo "  FAIL: the lane's own exit is not 0"; FAILED=1; fi
echo "  rows recorded: $(grep -c '"name":"ui\.' "$SANDBOX/assertions.ndjson" 2>/dev/null || echo 0)"

echo
echo "=== arm 3: negative control — the same copy WITHOUT reply-verdict.ts must fail to load ==="
rm "$SANDBOX/ui/reply-verdict.ts"
set +e
MISSING_OUT="$(cd "$SANDBOX" && node "$SANDBOX/ui/browser-lane.ts" --state "$SANDBOX/assertions2.ndjson" --out "$SANDBOX/out" --unavailable "control" 2>&1)"
MISSING_CODE=$?
set -e
echo "$MISSING_OUT" | head -n 3 | sed 's/^/  /'
echo "  lane exit=$MISSING_CODE"
case "$MISSING_OUT" in
  *ERR_MODULE_NOT_FOUND*|*Cannot\ find\ module*) echo "  OK (control): the import is real, so the entrypoint's cp line is load-bearing" ;;
  *) echo "  FAIL (control): the lane loaded without its classifier"; FAILED=1 ;;
esac

echo
echo "=== arm 4: the pre-fix predicate is gone from the lane ==="
if grep -q 'transcript did not change after the send' docker/lib/browser-lane.ts; then
  echo "  FAIL: the old growth test is still in the lane"; FAILED=1
else
  echo "  OK: the old 'transcript did not change' growth test is gone"
fi
if grep -qE 'if \(/\\bDONE\\b/\.test\(seen\)' docker/lib/browser-lane.ts; then
  echo "  FAIL: the lane still breaks on the prompt's own DONE"; FAILED=1
else
  echo "  OK: the lane no longer decides the row on /\\bDONE\\b/ over the whole transcript"
fi
if grep -q 'judgeReply' docker/lib/browser-lane.ts; then echo "  OK: the row is judged by the shared classifier"; else echo "  FAIL: the lane does not use the classifier"; FAILED=1; fi

echo
echo "=== arm 5: bash -n docker/entrypoint.sh (the new cp line) ==="
if bash -n docker/entrypoint.sh; then echo "  OK exit 0"; else echo "  FAIL"; FAILED=1; fi

echo
echo "=== arm 6: what a DECLARED BOUND does to the driver's verdict (shipped pure functions) ==="
node -e '
(async () => {
  const m = await import("./scripts/docker-e2e.ts")
  const result = { ok: true, complete: false, assertions: [
    { name: "ui.loads", ok: true, reason: "r", raw: "x" },
    { name: "ui.replyRendered", ok: null, reason: "DECLARED BOUND — MISSING_CREDENTIAL", raw: "before=225 after=619 done=false" },
  ] }
  const browserOn = m.unmeasuredRequired(result, ["ui."])
  const browserOff = m.unmeasuredRequired(result, ["live.", "boot.llmTurn"])
  console.log("  browser lane ON (the default): unmeasured=" + JSON.stringify(browserOn) + " finalExit=" + (browserOn.length > 0 ? 3 : m.decideExit(result)))
  console.log("  --no-browser:                  unmeasured=" + JSON.stringify(browserOff) + " finalExit=" + (browserOff.length > 0 ? 3 : m.decideExit(result)))
})()
'
echo "  (this is the CONSEQUENCE the report states: a null ui arm is a MISSING PREREQUISITE under the browser lane's required prefix, so the next credential-free run exits 3, not 0)"

echo
if [ "$FAILED" -eq 0 ]; then echo "F1 ARMS: ALL PASS"; else echo "F1 ARMS: FAILURES ABOVE"; fi
exit "$FAILED"
