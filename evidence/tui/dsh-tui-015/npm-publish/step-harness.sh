#!/usr/bin/env bash
# step-harness.sh — rehearse every `run:` body of .github/workflows/publish.yml WITHOUT publishing.
#
# WHY THIS EXISTS. `npm stage publish` cannot be rehearsed against the real registry from here (it would
# need the OIDC token GitHub mints, and a stage is a real registry object), so the guards that decide
# whether a publish is ALLOWED are the part that must be proven locally: the tag<->version assertion,
# the empty-tag refusal, the `npm stage` availability check, and the approve-mode preflight. Each of
# those is a shell body taken VERBATIM out of the workflow file, executed with `npm` replaced by a stub
# that records its arguments — so the rehearsal proves the script logic and the argument order, and
# proves nothing about the registry round-trip (stated as a bound, not implied).
#
# Everything is executed with cwd = the real repository root, so the assertion step reads the REAL
# package.json; the stub only ever shadows the `npm` binary.
set -uo pipefail

# The repository root: this script lives at evidence/tui/dsh-tui-015/npm-publish/.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/publish.yml"
WORK="$(mktemp -d)"
STEPS="$WORK/steps"
BIN="$WORK/bin"
mkdir -p "$STEPS" "$BIN"
export NPM_STUB_LOG="$WORK/npm-calls.log"
: > "$NPM_STUB_LOG"

echo "== workflow: $WORKFLOW"
echo "== sha256:   $(sha256sum "$WORKFLOW" | cut -d' ' -f1)"
echo "== scratch:  $WORK"
echo

# ── 1. extract every `run:` body, one file per step, in file order ────────────────────────────────
python3 - "$WORKFLOW" "$STEPS" <<'PY'
import sys, yaml, pathlib, re
doc = yaml.safe_load(open(sys.argv[1]))
out = pathlib.Path(sys.argv[2])
manifest = []
for index, step in enumerate(doc["jobs"]["publish"]["steps"]):
    name = step.get("name", f"step-{index}")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60]
    body = step.get("run")
    if body is None:
        manifest.append(f"{index:02d} USES  {name} -> {step.get('uses')}")
        continue
    # The one `${{ }}` interpolation this workflow puts INSIDE a shell body; GitHub expands it before
    # the shell sees it, so the harness substitutes it the same way.
    body = body.replace("${{ github.event_name }}", "push")
    (out / f"{index:02d}-{slug}.sh").write_text(body)
    manifest.append(f"{index:02d} RUN   {name} -> {out / f'{index:02d}-{slug}.sh'}")
print("\n".join(manifest))
PY
echo

# ── 2. the npm stub: records every call, emulates only the shapes the workflow uses ───────────────
cat > "$BIN/npm" <<'STUB'
#!/usr/bin/env bash
# Records the call, then answers with the minimum shape the workflow's script needs.
echo "npm $*" >> "$NPM_STUB_LOG"
if [ "${NPM_STAGE_UNSUPPORTED:-0}" = "1" ] && [ "$1 $2" = "stage --help" ]; then
  echo "Unknown command: stage" >&2; exit 1
fi
case "$1 $2" in
  "stage --help") echo "usage: npm stage"; exit 0 ;;
  "stage publish") echo "staged @mpd-dsh/mpd@0.13.1 (dist-tag ${4:-latest}) as stage-id-11111111-2222-3333-4444-555555555555"; exit 0 ;;
  "stage list")    echo "stage-id-11111111-2222-3333-4444-555555555555  @mpd-dsh/mpd@0.13.1  latest  2026-10-16"; exit 0 ;;
esac
if [ "$1" = "pack" ]; then
  dest=""; prev=""
  for a in "$@"; do [ "$prev" = "--pack-destination" ] && dest="$a"; prev="$a"; done
  [ -n "$dest" ] || { echo "stub: npm pack without --pack-destination" >&2; exit 2; }
  mkdir -p "$dest"; : > "$dest/mpd-dsh-mpd-0.13.1.tgz"; echo "mpd-dsh-mpd-0.13.1.tgz"; exit 0
fi
[ "$1" = "whoami" ] && exit "${NPM_WHOAMI_EXIT:-1}"
exit 0
STUB
chmod +x "$BIN/npm"

# ── 3. the cases: step file, environment, expected exit code, and why ─────────────────────────────
# A case is "<step-file-glob>|<env assignments>|<expected exit>|<reason>". `real-npm` in the env slot
# means the stub is NOT put on PATH for that case (the npm guard is graded against the real npm).
# EVERY case defines all three job-level variables, because GitHub always does (an unnamed input is the
# EMPTY STRING, never unset) — a case that left one unset would grade the harness, not the workflow.
STAGE="11111111-2222-3333-4444-555555555555"
CASES=(
  "00-*|TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|0|resolve: a tag push resolves to STAGE mode"
  "00-*|TAG= STAGE_ID= DIST_TAG=latest|1|resolve: an EMPTY tag is refused, so a branch can never be staged"
  "00-*|TAG=v0.13.0 STAGE_ID=$STAGE DIST_TAG=latest-1|0|resolve: a filled stage_id resolves to APPROVE mode"
  "03-*|TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|0|assert: v0.13.1 == v<package.json version 0.13.1>"
  "03-*|TAG=v0.13.0 STAGE_ID= DIST_TAG=latest|1|assert: a tag that disagrees with package.json is REFUSED"
  "03-*|TAG=0.13.1 STAGE_ID= DIST_TAG=latest|1|assert: a tag without the leading v is REFUSED"
  "04-*|real-npm TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|0|npm guard: the real npm on this machine knows 'npm stage'"
  "04-*|NPM_STAGE_UNSUPPORTED=1 TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|1|npm guard: an npm without 'npm stage' fails BY NAME"
  "05-*|TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|0|stage mode: mkdir + pack + stage publish"
  "05-*|TAG=v0.13.0 STAGE_ID= DIST_TAG=latest-1|0|stage mode: a backfill carries the dist_tag it was dispatched with"
  "06-*|TAG=v0.13.1 STAGE_ID=$STAGE NPM_WHOAMI_EXIT=1|1|approve mode: no credential -> the bound is stated, not ENEEDAUTH"
  "06-*|TAG=v0.13.1 STAGE_ID=$STAGE NPM_WHOAMI_EXIT=0|0|approve mode: with a credential the approve call runs"
  "07-*|TAG=v0.13.1 STAGE_ID= DIST_TAG=latest|0|list: 'npm stage list' runs last"
)

FAILED=0
for case in "${CASES[@]}"; do
  IFS='|' read -r glob envs expected reason <<< "$case"
  step_file="$(find "$STEPS" -name "$glob" | sort | head -1)"
  if [ -z "$step_file" ]; then echo "MISSING STEP FOR $glob"; FAILED=$((FAILED + 1)); continue; fi
  path="$PATH"
  case "$envs" in *real-npm*) path="$(echo "$PATH" | tr ':' '\n' | grep -v "^$BIN$" | paste -sd:)" ;; *) path="$BIN:$PATH" ;; esac
  clean_envs="${envs/real-npm/}"
  out="$WORK/out.txt"
  # shellcheck disable=SC2086
  env -i PATH="$path" HOME="$WORK/home" GITHUB_STEP_SUMMARY="$WORK/summary.md" \
      NPM_STUB_LOG="$NPM_STUB_LOG" $clean_envs bash "$step_file" > "$out" 2>&1
  actual=$?
  verdict="PASS"; [ "$actual" = "$expected" ] || { verdict="FAIL"; FAILED=$((FAILED + 1)); }
  printf '%s  expected=%s actual=%s  %s\n' "$verdict" "$expected" "$actual" "$reason"
  sed 's/^/        | /' "$out" | head -6
done

# ── 3b. the CALLS themselves: what the script asked npm to do is part of the contract ─────────────
# Each assertion is "<substring that must appear in the recorded npm calls>|<why>".
CALLS=(
  "npm pack --pack-destination /tmp/npm-pack|the staging step packs into the directory the artifact step globs"
  "npm stage publish --access public --tag latest|a tag push stages with an explicit access and tag"
  "npm stage publish --access public --tag latest-1|a backfill stages under the dist_tag it was dispatched with"
  "npm stage approve $STAGE|approve mode passes the stage id through, unmodified"
  "npm stage list|the listing step really is the LAST npm call of a staging run"
)
for call in "${CALLS[@]}"; do
  IFS='|' read -r needle why <<< "$call"
  if grep -qF -- "$needle" "$NPM_STUB_LOG"; then
    printf 'PASS  recorded: %-46s  %s\n' "$needle" "$why"
  else
    printf 'FAIL  MISSING from the recorded calls: %s  (%s)\n' "$needle" "$why"
    FAILED=$((FAILED + 1))
  fi
done

# ── 4. what the stage step actually asked npm to do (argument order is part of the contract) ──────
echo
echo "== recorded npm calls"
sed 's/^/   /' "$NPM_STUB_LOG"
echo
echo "== packed artifact the upload step globs"
ls -la /tmp/npm-pack 2>/dev/null | sed 's/^/   /' || echo "   (none)"
echo
echo "== step summary the stage step wrote"
cat "$WORK/summary.md" 2>/dev/null | sed 's/^/   /' || echo "   (none)"
echo
echo "HARNESS $([ "$FAILED" = 0 ] && echo PASS || echo "FAIL ($FAILED case(s))")"
exit $([ "$FAILED" = 0 ] && echo 0 || echo 1)
