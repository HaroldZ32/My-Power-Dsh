#!/usr/bin/env bash
# Install the release tarball in two fresh profiles and exercise the mounted AST tool.
set -euo pipefail

check_result() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs"
    const result = JSON.parse(readFileSync(process.argv[1], "utf8"))
    if (!Array.isArray(result) || result.length !== 2 || result[0]?.count !== 1 || result[1]?.count !== 0) {
      console.error("Expected the mounted AST tool to find one match and then zero:", JSON.stringify(result))
      process.exitCode = 1
    } else {
      console.log("mcp__ast_grep__search matched one fixture declaration and zero for the negative control")
    }
  ' "$1"
}

if [[ ${1:-} == --self-test ]]; then
  check_result <(printf '%s\n' '[{"count":1},{"count":0}]')
  if check_result <(printf '%s\n' '[{"count":1},{"count":1}]') || \
     check_result <(printf '%s\n' '[{"failure":"BINARY_NOT_FOUND"},{"count":0}]'); then
    echo 'FAIL: accepted a broken AST tool result' >&2
    exit 1
  fi
  echo 'PASS: the result gate rejected an echoed answer and a missing engine'
  exit 0
fi

if [[ $# != 2 ]]; then
  echo 'usage: bash docker/verify-release-tarball.sh <tarball.tgz> <output-dir>' >&2
  exit 2
fi
archive="$(realpath -- "$1")"
[[ -f "$archive" && "$archive" == *.tgz ]]
out="$(realpath -m -- "$2")"
mkdir -- "$out"
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/mpd-release-smoke.XXXXXX")"
child=""
cleanup() {
  if [[ -n "$child" ]]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  if [[ "$sandbox" == /*/mpd-release-smoke.* && -d "$sandbox" ]]; then
    rm -rf -- "$sandbox"
  fi
}
trap cleanup EXIT

# The distribution names the harness and TUI versions that this bundle supports together.
mapfile -t hosts < <(node -e '
  const components = require(process.argv[1]).protocols.flatMap(p => p.spec?.components ?? [])
  for (const id of ["host-base", "host-tui"]) {
    const ref = components.find(c => c.id === id)?.ref
    if (!ref?.startsWith("pkg:npm/")) process.exit(1)
    console.log(ref.slice("pkg:npm/".length))
  }
' "$repo/dsh-distribution.json")
[[ ${#hosts[@]} == 2 ]]
sha256sum -- "$archive" | tee "$out/tarball.sha256"
printf -- '- insert:\n    - id: mpd-release-tarball-probe\n      name: %s\n' "$(node -p 'JSON.stringify(process.argv[1])' "$repo/docker/probe.ts")" > "$sandbox/probe.yml"

# Whitelist the runner's executables and locale, with no user settings or search engine override.
clean_path="$(dirname -- "$(command -v dsh)"):$(dirname -- "$(command -v pnpm)"):$(dirname -- "$(command -v node)"):/usr/bin:/bin"
for profile in web dsh-tui; do
  lane="$sandbox/$profile"
  mkdir -p -- "$lane"/{home,work,tmp}
  printf 'export const SEARCH_TOOL_NAME = "release smoke"\n' > "$lane/work/fixture.ts"
  clean=(env -i "PATH=$clean_path" TERM=xterm-256color LANG=C.UTF-8 "HOME=$lane/home" "DSH_HOME=$lane/dsh" \
    "TMPDIR=$lane/tmp" "DSH_WORKSPACE_ROOT=$lane/work" "MPD_RELEASE_PROBE_RESULT=$out/$profile.json" \
    "DSH_TUI_WORKSPACE_TARGET=$lane/work" DSH_TUI_NO_LAUNCHPAD=1)
  (
    cd -- "$lane/work"
    host_version="$("${clean[@]}" dsh --version)"
    [[ "$host_version" == "${hosts[0]##*@}" ]]
    printf '%s node=%s pnpm=%s dsh=%s tui=%s\n' "$profile" "$("${clean[@]}" node --version)" "$("${clean[@]}" pnpm --version)" "$host_version" "${hosts[1]##*@}"
    # Fail if an ambient engine could have satisfied the search. Linux's setgroups sg is allowed.
    if "${clean[@]}" bash -c 'command -v ast-grep || { command -v sg && sg --version 2>&1 | grep -qi ast-grep; }' > "$out/$profile-path.log"; then
      echo "Unexpected ambient ast-grep in the clean $profile environment" >&2
      exit 1
    fi
    if [[ "$profile" == dsh-tui ]]; then
      "${clean[@]}" timeout -k 5s 180s dsh plugin --profile "$profile" add "${hosts[1]}" > "$out/tui-host.log" 2>&1
    fi
    "${clean[@]}" timeout -k 5s 180s dsh plugin --profile "$profile" add "$archive" > "$out/$profile-install.log" 2>&1
    bundle="$(realpath -- "$lane/dsh/profiles/$profile/node_modules/@mpd-dsh/mpd")"
    [[ "$bundle" == "$lane/dsh/"* && -f "$bundle/cordis.patch.yml" && ! -e "$bundle/.toolchain" ]]
    # Verify the launcher under test came from the archive, even if the profile symlinks packages.
    launcher=packages/mpd-mcp-astgrep/dist/launch.js
    tar -xOzf "$archive" "package/$launcher" | cmp -s - "$bundle/$launcher"
    printf 'Installed %s from %s (AST launcher bytes match)\n' "$profile" "$archive"
  )
  (
    cd -- "$lane/work"
    if [[ "$profile" == web ]]; then
      # Port 0 asks the Web host for an ephemeral loopback listener.
      exec "${clean[@]}" timeout -k 5s 130s dsh --profile web --patch "$sandbox/probe.yml" --host 127.0.0.1 --port 0 --no-open
    else
      # Use the profile's own pinned TUI launcher and a real PTY. Quote for script's shell.
      printf -v launch '%q ' node "$lane/dsh/profiles/dsh-tui/node_modules/${hosts[1]%@*}/bin/dsh-tui.js" --patch "$sandbox/probe.yml"
      exec "${clean[@]}" timeout -k 5s 130s script -q -e -c "$launch" /dev/null
    fi
  ) > "$out/$profile-boot.log" 2>&1 &
  child=$!
  deadline=$((SECONDS + 125))
  while [[ ! -s "$out/$profile.json" ]] && kill -0 "$child" 2>/dev/null && (( SECONDS < deadline )); do
    sleep 1
  done
  if [[ ! -s "$out/$profile.json" ]]; then
    echo "The $profile boot produced no AST result. See $out/$profile-boot.log and install logs." >&2
    exit 1
  fi
  printf '%s: ' "$profile"
  check_result "$out/$profile.json"
  # Timeout forwards termination to its process group, including the booted host.
  kill "$child" 2>/dev/null || true
  wait "$child" || true
  child=""
  "${clean[@]}" node --input-type=module -e '
    const [helper, dshHome, root] = process.argv.slice(1)
    const { assertSessionsSandboxed } = await import(helper)
    const verdict = assertSessionsSandboxed(dshHome, root)
    console.log(`Isolated session store: ${verdict.checked} workspace key(s) checked`)
  ' "$repo/skills/dsh-qa/scripts/lib/workspace-isolation.ts" "$lane/dsh" "$lane"
  sha256sum --check -- "$out/tarball.sha256"
done
