#!/usr/bin/env bash
# f2-arms.sh — offline arms for FINDING F2 (backticks in a fact string are COMMAND SUBSTITUTION).
#
# Runs no Docker and touches no network. It proves, on the SHIPPED bytes of docker/entrypoint.sh:
#   arm 1  a quote-aware scan finds ZERO command-substitution backticks left in docker/*.sh, and the
#          scanner is falsifiable (arm 1b plants the pre-fix bytes plus a single-quoted JavaScript
#          template literal and requires exactly 1 hit + 0 false positives);
#   arm 2  `bash -n` is clean for every docker/*.sh;
#   arm 3  the extracted `obs.npmrc` block, run for real with a stub `fact()`, prints the whole
#          observation text (the words `dsh plugin` survive) and prints NOTHING to stderr — while the
#          SAME block with the pre-fix bytes loses the words and INVOKES a stub `dsh` instead;
#   arm 4  the same for the extracted `obs.caseEngineTree` line (`file:` survives).
# The extraction is by LINE PATTERN from the shipped file, never a copy, so the bytes under test are
# the bytes that ship.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO" || exit 2
ENTRY="docker/entrypoint.sh"
HERE="evidence/tui/dsh-tui-015/docker-repair2"
SCAN="$HERE/f2-shell-backtick-scan.mjs"
FAILED=0

echo "=== arm 1: command-substitution backticks left in docker/*.sh (quote-aware scan) ==="
node "$SCAN" docker/entrypoint.sh docker/tui-lane.sh || FAILED=1
echo "  (a hit is a backtick the SHELL executes: outside single quotes, unescaped. Backticks inside single-quoted node -e arguments are literal and are not reported.)"

echo
echo "=== arm 1b: the scanner's own control — planted pre-fix bytes + a single-quoted JS template literal ==="
PLANT="$(mktemp -d)"
{
  printf 'fact obs.npmrc "every `dsh plugin` resolves"\n'
  printf "node -e 'const s = \`x ok\`; console.log(s)'\n"
} > "$PLANT/planted.sh"
sed 's/^/    /' "$PLANT/planted.sh"
CONTROL_OUT="$(node "$SCAN" "$PLANT/planted.sh")"
CONTROL_CODE=$?
echo "$CONTROL_OUT" | sed 's/^/  /'
echo "  scanner exit=$CONTROL_CODE (expected 1: the planted pair is two executed backticks)"
case "$CONTROL_OUT" in
  *"TOTAL_SUBSTITUTION_SITES=2"*) echo "  OK: both planted backticks are caught" ;;
  *) echo "  FAIL: the scanner control did not report exactly two sites"; FAILED=1 ;;
esac
case "$CONTROL_OUT" in
  *"const s ="*) echo "  FAIL: a single-quoted node -e argument was reported (false positive)"; FAILED=1 ;;
  *) echo "  OK: the single-quoted node -e argument is inert and is NOT reported" ;;
esac

echo
echo "=== arm 2: bash -n over every docker/*.sh ==="
for f in docker/*.sh; do
  if bash -n "$f"; then echo "  OK bash -n $f (exit 0)"; else echo "  FAIL bash -n $f"; FAILED=1; fi
done

echo
echo "=== arm 3: the obs.npmrc block, EXTRACTED from $ENTRY, run with a stub fact() ==="
START="$(grep -n '^if \[ -s "\$HOME/.npmrc" \]; then$' "$ENTRY" | awk -F: '{print $1}')"
END="$(awk -v s="$START" 'NR > s && /^fi$/ {print NR; exit}' "$ENTRY")"
echo "  extracted lines $START..$END"
BLOCK="$(mktemp -d)/block.sh"
sed -n "${START},${END}p" "$ENTRY" > "$BLOCK"
SANDBOX_HOME="$(mktemp -d)"
printf 'registry=https://registry.example.invalid/\n' > "$SANDBOX_HOME/.npmrc"
OUT="$(HOME="$SANDBOX_HOME" NPM_REGISTRY="https://registry.example.invalid" bash -c '
  set -uo pipefail
  fact() { printf "FACT %s = %s\n" "$1" "$2"; }
  source "$1"
' _ "$BLOCK" 2>"$SANDBOX_HOME/arm3.stderr")"
echo "  exit=$? stderrBytes=$(wc -c <"$SANDBOX_HOME/arm3.stderr" | tr -d ' ')"
echo "  $OUT"
case "$OUT" in
  *"every \`dsh plugin\` — resolves through the FILE"*) echo "  OK: the words survive, quoted as code spans" ;;
  *) echo "  FAIL: the observation text did not survive"; FAILED=1 ;;
esac
if [ ! -s "$SANDBOX_HOME/arm3.stderr" ]; then echo "  OK: nothing on stderr"; else echo "  FAIL: stderr is not empty"; cat "$SANDBOX_HOME/arm3.stderr"; FAILED=1; fi
echo "  --- negative control: the SAME block with the pre-fix (unescaped) bytes, and a stub 'dsh' on PATH ---"
STUB="$(mktemp -d)"
printf '#!/usr/bin/env bash\necho "STUB-DSH-INVOKED argv=[$*]" >&2\nexit 0\n' > "$STUB/dsh"
chmod +x "$STUB/dsh"
sed 's/\\`/`/g' "$BLOCK" > "$SANDBOX_HOME/block.pre.sh"
OUT_PRE="$(HOME="$SANDBOX_HOME" NPM_REGISTRY="https://registry.example.invalid" PATH="$STUB:$PATH" bash -c '
  set -uo pipefail
  fact() { printf "FACT %s = %s\n" "$1" "$2"; }
  source "$1"
' _ "$SANDBOX_HOME/block.pre.sh" 2>"$SANDBOX_HOME/arm3pre.stderr")"
echo "  $OUT_PRE"
echo "  stderr: $(cat "$SANDBOX_HOME/arm3pre.stderr")"
case "$OUT_PRE" in
  *"every  — resolves"*) echo "  OK (control): the pre-fix text loses the words, so the arm above is falsifiable" ;;
  *) echo "  FAIL (control): the pre-fix bytes did not lose the words"; FAILED=1 ;;
esac
case "$(cat "$SANDBOX_HOME/arm3pre.stderr")" in
  *STUB-DSH-INVOKED*) echo "  OK (control): a real command ran in the substitution's place" ;;
  *) echo "  FAIL (control): the substitution did not execute a command"; FAILED=1 ;;
esac

echo
echo "=== arm 4: the obs.caseEngineTree line, EXTRACTED from $ENTRY, run with a stub fact() ==="
LINE_NO="$(grep -n '^fact obs.caseEngineTree ' "$ENTRY" | awk -F: '{print $1}')"
sed -n "${LINE_NO}p" "$ENTRY" > "$SANDBOX_HOME/arm4.sh"
OUT4="$(CASE_ENGINE_TREE=/work/dist/mpd-package bash -c '
  set -uo pipefail
  fact() { printf "FACT %s = %s\n" "$1" "$2"; }
  source "$1"
' _ "$SANDBOX_HOME/arm4.sh" 2>"$SANDBOX_HOME/arm4.stderr")"
echo "  exit=$? stderrBytes=$(wc -c <"$SANDBOX_HOME/arm4.stderr" | tr -d ' ')"
echo "  $OUT4"
case "$OUT4" in
  *'npm `file:` into its sandbox profile'*) echo "  OK: the words survive" ;;
  *) echo "  FAIL: the observation text did not survive"; FAILED=1 ;;
esac

echo
if [ "$FAILED" -eq 0 ]; then echo "F2 ARMS: ALL PASS"; else echo "F2 ARMS: FAILURES ABOVE"; fi
exit "$FAILED"
