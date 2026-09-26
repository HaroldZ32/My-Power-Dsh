#!/bin/sh
# t8 (Reviewer) — build MY OWN sandbox root from scratch.
# F9: the profile under test must not be the implementer's cached one. This script
# creates it from zero, using the same environment shape as tui-lane.mjs
# `sandboxEnv()` so the lanes can then run against a genuinely fresh, self-installed
# profile. The lane's own `--install` path was measured to be unreachable
# (prereq gate runs first and exits 0 with SKIP) — see findings in the t8 result.
set -u
ROOT="$1"
mkdir -p "$ROOT"/{dshhome,home,npm-cache,pnpm-home,config,data,ws}
run() {
  echo "### $*"
  env -i \
    PATH="$PATH" \
    DSH_HOME="$ROOT/dshhome" \
    HOME="$ROOT/home" \
    npm_config_cache="$ROOT/npm-cache" \
    PNPM_HOME="$ROOT/pnpm-home" \
    XDG_CONFIG_HOME="$ROOT/config" \
    XDG_DATA_HOME="$ROOT/data" \
    dsh "$@"
  echo "### exit=$?"
}
run plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.10.1
run plugin --profile dsh-tui add /root/dshProj/my-power-dsh
echo "### profile manifest"
cat "$ROOT/dshhome/profiles/dsh-tui/package.json"
